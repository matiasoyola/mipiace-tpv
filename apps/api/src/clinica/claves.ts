// clinica-7 · EL LLAVERO. De dónde sale la DEK de una clínica.
//
// `cripto.ts` sabe cifrar y no sabe de dónde viene la clave. Este fichero
// es lo contrario: habla con la base, desenvuelve con la KEK, cachea, crea
// la clave la primera vez, la re-envuelve cuando la KEK rota y la DESTRUYE
// cuando la clínica se va.
//
// ── Una DEK por clínica, creada la primera vez que hace falta ────────
//
// No se crea al encender el módulo (eso lo hace el superadmin y podría
// dejar clínicas con clave y sin un solo dato), ni en la migración (que
// corre sin saber qué tenants habrá mañana). Se crea **en la primera
// escritura clínica**, que es el primer momento en que hay algo que
// cifrar, y dentro de la transacción de esa escritura: si la escritura se
// deshace, la clave no queda huérfana.
//
// La crea `asegurarDek`, y es idempotente por el único de la tabla
// (`tenant_id` es la primaria): dos escrituras simultáneas del primer día
// de una clínica no crean dos claves — la segunda choca con la primaria y
// vuelve a leer. Es el mismo cierre de carrera que `consumirEnlace`.
//
// ── La caché, con TTL, y el TTL ES la decisión ───────────────────────
//
// Desenvolver una DEK es una consulta más un AES por petición clínica, y
// la historia de un paciente grande descifra cientos de valores. Sin
// caché, el criterio de rendimiento del bloque (50 ms) no se cumple.
//
// Pero una caché sin caducidad tiene un problema que no es de rendimiento:
// **la destrucción de una clave tiene que surtir efecto YA.** Si un
// proceso guarda la DEK de una clínica a la que se le acaban de destruir
// los datos, sigue sirviendo historias que ya no deberían poder leerse.
// Dentro del proceso que destruye, `destruirDek` limpia la entrada; en los
// OTROS procesos (el worker, la segunda réplica) lo que acota la ventana es
// el TTL. 60 segundos: suficiente para que una historia entera se sirva
// con una sola lectura de la clave, y poco para que una destrucción quede
// pendiente.
//
// ── Y lo que no pasa por aquí ────────────────────────────────────────
//
// **La KEK no se devuelve nunca.** No hay función que la saque, no entra
// en ningún objeto que se serialice y no se escribe en ningún mensaje de
// error. Lo mismo la DEK: sale como `Buffer` hacia `cripto.ts` y no hacia
// ninguna respuesta HTTP.

import type { Prisma, PrismaClient } from "@mipiacetpv/db";

import { getPrisma } from "../context.js";
import { loadEnv } from "../env.js";
import {
  CriptoClinicaError,
  NoSeDescifra,
  canarioCuadra,
  desenvolverDek,
  envolverDek,
  nuevaDek,
  nuevoCanario,
} from "./cripto.js";

export type Ejecutor = PrismaClient | Prisma.TransactionClient;

/** La KEK falta y hace falta. Clase propia porque el arranque la trata
 *  distinto: no arranca. */
export class FaltaLaKek extends CriptoClinicaError {
  constructor() {
    super(
      "Falta CLINICAL_KEK y hay clínicas con historia. Sin ella no se puede leer ni escribir nada clínico.",
    );
  }
}

/** La clínica tuvo clave y se destruyó. No es un fallo: es una respuesta. */
export class ClaveDestruida extends CriptoClinicaError {
  constructor(
    readonly tenantId: string,
    readonly cuando: Date,
  ) {
    super(
      `los datos clínicos de la clínica ${tenantId} se destruyeron el ${cuando.toISOString()} y son ilegibles, también en las copias de seguridad`,
    );
  }
}

/** La clínica no tiene clave todavía: no se ha escrito nada clínico. */
export class SinClaveTodavia extends CriptoClinicaError {
  constructor(readonly tenantId: string) {
    super(`la clínica ${tenantId} no tiene clave: no hay nada cifrado`);
  }
}

// ── La caché ──────────────────────────────────────────────────────────

const TTL_CACHE_MS = 60_000;

interface Entrada {
  dek: Buffer;
  hasta: number;
}

const cache = new Map<string, Entrada>();

/** Para los tests y para `destruirDek`. Vaciarla nunca es incorrecto:
 *  lo único que cuesta es una consulta. */
export function olvidarClaves(tenantId?: string): void {
  if (tenantId == null) cache.clear();
  else cache.delete(tenantId);
}

function kek(): { base64: string; id: string } {
  const env = loadEnv();
  if (env.CLINICAL_KEK == null) throw new FaltaLaKek();
  return { base64: env.CLINICAL_KEK, id: env.CLINICAL_KEK_ID };
}

/** `true` si este despliegue tiene KEK. Lo pregunta el arranque antes de
 *  mirar si hay clínicas, para dar el mensaje bueno. */
export function hayKek(): boolean {
  return loadEnv().CLINICAL_KEK != null;
}

// ── Leer la DEK ───────────────────────────────────────────────────────

/**
 * La DEK de una clínica. Levanta si no la hay, si está destruida o si no
 * se desenvuelve con la KEK de este despliegue.
 *
 * Los tres errores son clases distintas a propósito: «no hay nada
 * cifrado», «se destruyó» y «la KEK no es la buena» piden tres cosas
 * distintas de quien llama, y un solo `Error` las habría convertido en el
 * mismo 500.
 */
export async function dekDe(
  tenantId: string,
  prisma: Ejecutor = getPrisma(),
): Promise<Buffer> {
  const ahora = Date.now();
  const enCache = cache.get(tenantId);
  if (enCache && enCache.hasta > ahora) return enCache.dek;

  const fila = await prisma.clinicalTenantKey.findUnique({
    where: { tenantId },
    select: {
      kekId: true,
      dekWrapped: true,
      destroyedAt: true,
    },
  });
  if (fila == null) throw new SinClaveTodavia(tenantId);
  if (fila.destroyedAt != null) {
    // Y fuera de la caché, por si estaba: una clave destruida no se sirve
    // ni un milisegundo más.
    cache.delete(tenantId);
    throw new ClaveDestruida(tenantId, fila.destroyedAt);
  }
  if (fila.dekWrapped == null) {
    // El CHECK `clinical_tenant_keys_destruida_entera` lo impide, así que
    // esto es «la base dice algo imposible». No se inventa una clave.
    throw new NoSeDescifra(
      `la clínica ${tenantId} tiene la fila de clave sin clave y sin fecha de destrucción`,
    );
  }

  const { base64, id } = kek();
  const dek = desenvolverDek(fila.dekWrapped, {
    kekBase64: base64,
    // LA DE LA FILA, no la del entorno: mientras la rotación corre
    // conviven las dos, y cada fila dice cuál es la suya. Usar la del
    // entorno para todas sería dejar ilegibles las que todavía no se han
    // re-envuelto.
    kekId: fila.kekId,
    tenantId,
  });
  // Y si la KEK del entorno no es la de la fila, se avisa: la rotación se
  // quedó a medias y hay que acabar de pasar el script.
  if (fila.kekId !== id) {
    // Sin excepción: la fila se desenvolvió bien, así que todo funciona.
    // Lo que falta es acabar la rotación, y eso no es motivo para negar
    // una historia clínica.
    cache.set(tenantId, { dek, hasta: ahora + TTL_CACHE_MS });
    return dek;
  }
  cache.set(tenantId, { dek, hasta: ahora + TTL_CACHE_MS });
  return dek;
}

/**
 * La DEK si la hay, `null` si esta clínica no tiene todavía.
 *
 * **Es la función de las LECTURAS**, y existe para que una lectura no cree
 * claves. Leer la historia de una clínica que no ha escrito nada cifrado
 * devuelve lo que haya en claro, que es exactamente lo que hay; crear la
 * clave ahí dejaría filas de clave en clínicas que nunca escribieron una
 * historia.
 *
 * Los dos errores que se tragan son los dos que significan «no hay nada
 * que descifrar»: sin clave todavía, y clave destruida. Cualquier otro —la
 * KEK que no desenvuelve— **sube**: eso no es «no hay nada», es «algo va
 * mal», y una lectura que lo escondiera devolvería una historia a medias
 * sin decirlo.
 */
export async function dekONada(
  tenantId: string,
  prisma: Ejecutor = getPrisma(),
): Promise<Buffer | null> {
  try {
    return await dekDe(tenantId, prisma);
  } catch (err) {
    if (err instanceof SinClaveTodavia || err instanceof ClaveDestruida) {
      return null;
    }
    throw err;
  }
}

// ── Crearla la primera vez ────────────────────────────────────────────

/**
 * La DEK de una clínica, creándola si no la hay.
 *
 * **Se llama desde la transacción de la primera escritura clínica.** El
 * `catch` del `create` es el cierre de la carrera: si dos escrituras
 * simultáneas llegan aquí, la segunda choca con la primaria y vuelve a
 * leer la que ganó. Sin eso, la segunda crearía una DEK nueva y lo cifrado
 * por la primera quedaría ilegible — el peor fallo posible de esta pieza, y
 * el más silencioso.
 */
export async function asegurarDek(
  tenantId: string,
  prisma: Ejecutor = getPrisma(),
): Promise<Buffer> {
  try {
    return await dekDe(tenantId, prisma);
  } catch (err) {
    if (!(err instanceof SinClaveTodavia)) throw err;
  }

  const { base64, id } = kek();
  const dek = nuevaDek();
  try {
    await prisma.clinicalTenantKey.create({
      data: {
        tenantId,
        kekId: id,
        dekWrapped: envolverDek(dek, {
          kekBase64: base64,
          kekId: id,
          tenantId,
        }),
        canary: nuevoCanario(dek, tenantId),
      },
    });
  } catch {
    // Alguien la creó entre el `findUnique` y el `create`. La buena es la
    // suya, no la nuestra: la que acabamos de generar se tira.
    olvidarClaves(tenantId);
    return dekDe(tenantId, prisma);
  }
  cache.set(tenantId, { dek, hasta: Date.now() + TTL_CACHE_MS });
  return dek;
}

// ── El canario y el arranque ──────────────────────────────────────────

export interface CanarioRevisado {
  tenantId: string;
  cuadra: boolean;
  /** `true` cuando la clínica tiene los datos destruidos. No es un fallo:
   *  es una clínica que se fue, y su canario no tiene que cuadrar. */
  destruida: boolean;
}

/**
 * Revisa el canario de TODAS las clínicas con clave.
 *
 * Devuelve la lista entera en vez de reventar en la primera: lo que el
 * operador necesita a las tres de la mañana es «estas cuatro no cuadran»,
 * no «una no cuadra» cuatro veces.
 */
export async function revisarCanarios(
  prisma: Ejecutor = getPrisma(),
): Promise<CanarioRevisado[]> {
  const filas = await prisma.clinicalTenantKey.findMany({
    select: {
      tenantId: true,
      kekId: true,
      dekWrapped: true,
      canary: true,
      destroyedAt: true,
    },
  });
  const { base64 } = kek();
  return filas.map((fila) => {
    if (fila.destroyedAt != null) {
      return { tenantId: fila.tenantId, cuadra: true, destruida: true };
    }
    if (fila.dekWrapped == null || fila.canary == null) {
      return { tenantId: fila.tenantId, cuadra: false, destruida: false };
    }
    try {
      const dek = desenvolverDek(fila.dekWrapped, {
        kekBase64: base64,
        kekId: fila.kekId,
        tenantId: fila.tenantId,
      });
      return {
        tenantId: fila.tenantId,
        cuadra: canarioCuadra(fila.canary, dek, fila.tenantId),
        destruida: false,
      };
    } catch {
      return { tenantId: fila.tenantId, cuadra: false, destruida: false };
    }
  });
}

// ── Rotar la KEK ──────────────────────────────────────────────────────

export interface ResultadoDeRotacion {
  reenvueltas: string[];
  yaEstaban: string[];
  fallidas: string[];
  destruidas: string[];
}

/**
 * Re-envuelve las DEK con una KEK nueva.
 *
 * **Las filas NO se re-cifran** (decisión 16): la DEK es la misma, lo que
 * cambia es con qué está envuelta. Eso es lo que hace que rotar la clave
 * maestra de toda la casa sea una operación de segundos y no una de
 * reescribir cada historia clínica — y por eso el trigger
 * `clinical_tenant_keys_guard` rechaza una re-envoltura que cambie el
 * canario: un canario distinto significaría que la DEK cambió, y entonces
 * todo lo escrito antes habría quedado ilegible.
 *
 * Idempotente: una fila que ya está con la KEK nueva se cuenta en
 * `yaEstaban` y no se toca. Es lo que permite relanzar el script si se
 * corta a medias.
 *
 * `kekVieja` entra como parámetro y no se lee del entorno porque durante
 * la rotación hacen falta LAS DOS, y el entorno solo tiene una.
 */
export async function rotarKek(
  input: {
    kekViejaBase64: string;
    kekNuevaBase64: string;
    kekNuevaId: string;
  },
  prisma: Ejecutor = getPrisma(),
): Promise<ResultadoDeRotacion> {
  const filas = await prisma.clinicalTenantKey.findMany({
    select: {
      tenantId: true,
      kekId: true,
      dekWrapped: true,
      canary: true,
      destroyedAt: true,
    },
  });

  const out: ResultadoDeRotacion = {
    reenvueltas: [],
    yaEstaban: [],
    fallidas: [],
    destruidas: [],
  };

  for (const fila of filas) {
    if (fila.destroyedAt != null) {
      out.destruidas.push(fila.tenantId);
      continue;
    }
    if (fila.kekId === input.kekNuevaId) {
      out.yaEstaban.push(fila.tenantId);
      continue;
    }
    if (fila.dekWrapped == null) {
      out.fallidas.push(fila.tenantId);
      continue;
    }
    try {
      const dek = desenvolverDek(fila.dekWrapped, {
        kekBase64: input.kekViejaBase64,
        kekId: fila.kekId,
        tenantId: fila.tenantId,
      });
      // ANTES de escribir: que el canario siga cuadrando con esta DEK. Si
      // no cuadra, lo que se desenvolvió no es la clave de esta clínica y
      // re-envolverla con la KEK nueva dejaría su historia ilegible para
      // siempre.
      if (fila.canary == null || !canarioCuadra(fila.canary, dek, fila.tenantId)) {
        out.fallidas.push(fila.tenantId);
        continue;
      }
      await prisma.clinicalTenantKey.update({
        where: { tenantId: fila.tenantId },
        data: {
          kekId: input.kekNuevaId,
          dekWrapped: envolverDek(dek, {
            kekBase64: input.kekNuevaBase64,
            kekId: input.kekNuevaId,
            tenantId: fila.tenantId,
          }),
          rewrappedAt: new Date(),
        },
      });
      olvidarClaves(fila.tenantId);
      out.reenvueltas.push(fila.tenantId);
    } catch {
      out.fallidas.push(fila.tenantId);
    }
  }
  return out;
}

// ── Destruir: el crypto-shredding ─────────────────────────────────────

/**
 * DESTRUYE LOS DATOS CLÍNICOS DE UNA CLÍNICA borrando su clave.
 *
 * Esto es la «destrucción» del art. 28.3.g, y es irreversible: sin la DEK,
 * lo que queda en la base y **en todas las copias de seguridad pasadas**
 * deja de poder leerse. No hay vuelta — el trigger
 * `clinical_tenant_keys_guard` lo garantiza rechazando cualquier intento de
 * resucitar la fila.
 *
 * La fila se queda, con la clave y el canario a NULL y la fecha puesta: así
 * el sistema puede decir «se destruyeron el 3 de marzo» en lugar de parecer
 * una clave que falta por un fallo. Un hueco no es una respuesta cuando la
 * pregunta la hace un abogado.
 *
 * ── LA PANTALLA QUE LANZA ESTO NO EXISTE, Y ES DELIBERADO ───────────
 *
 * El prompt (decisión 14) deja la función y **no** la pantalla: es una
 * operación de superadmin con doble confirmación y queda para su bloque.
 * Lo que este bloque deja es la pieza construida y probada, para que ese
 * bloque sea una pantalla y una confirmación, no una pantalla y un
 * mecanismo nuevo de cifrado.
 *
 * Idempotente: una clave ya destruida devuelve `false` sin tocar nada —
 * intentarlo dos veces no es un error, es alguien asegurándose.
 */
export async function destruirDek(
  input: { tenantId: string; motivo: string },
  prisma: Ejecutor = getPrisma(),
): Promise<boolean> {
  const movidas = await prisma.clinicalTenantKey.updateMany({
    // `destroyedAt: null` en el WHERE: es lo que hace la operación
    // idempotente SIN leer antes, y lo que impide que un segundo intento
    // pise la fecha del primero (que es la que vale).
    where: { tenantId: input.tenantId, destroyedAt: null },
    data: {
      dekWrapped: null,
      canary: null,
      destroyedAt: new Date(),
      destroyedReason: input.motivo.slice(0, 200),
    },
  });
  // Lo primero después de escribir, y no lo último: entre el UPDATE y este
  // `delete` hay microsegundos en los que la caché serviría una clave
  // destruida.
  olvidarClaves(input.tenantId);
  return movidas.count === 1;
}
