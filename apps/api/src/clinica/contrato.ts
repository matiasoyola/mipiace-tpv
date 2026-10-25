// clinica-7 · EL CONTRATO DE ENCARGADO EN LA API.
//
// El paquete `@mipiacetpv/contrato-encargado` tiene el texto y **la
// función pura que decide el estado**. Este fichero es lo que la base
// aporta: leer las filas, aceptar, revocar y armar el PDF.
//
// ── Una sola función decide, y está en el paquete ───────────────────
//
// `estadoDelTenant` lee las filas y llama a `estadoDelModuloClinico`. No
// hay ni un `if` sobre versiones ni sobre revocaciones en este fichero: si
// lo hubiera, sería una segunda implementación del estado, y entonces la
// API y la pantalla podrían discrepar sobre si se puede escribir — que es
// el fallo que el paquete existe para cerrar.
//
// ── La caché, y por qué esta SÍ y la de la clave también ────────────
//
// El estado se consulta en CADA petición clínica (lo pregunta el guard de
// escritura) y en cada alta de cita de un tenant clínico. Son dos
// consultas por petición sin caché.
//
// Se cachea 30 s, la mitad que las claves, y la diferencia es deliberada:
// aceptar el contrato tiene que surtir efecto **en cuanto la dueña toca el
// botón**, con ella delante de la pantalla y la paciente esperando. Media
// vuelta de reloj es lo máximo que se le puede pedir. Y la invalidación
// explícita de `aceptar` y `revocar` hace que, en el proceso que atiende
// a la dueña, el efecto sea inmediato.

import {
  CONTRATO_VIGENTE,
  VERSION_VIGENTE,
  contratoDe,
  estadoDelModuloClinico,
  negativaDelContrato,
  permiteEscribirHistoria,
  textoCanonico,
  type EstadoDelModuloClinico,
  type FilaDelContrato,
} from "@mipiacetpv/contrato-encargado";
import { createHash } from "node:crypto";

import { getPrisma } from "../context.js";
import { nombreParaMostrar } from "../lib/nombre-para-mostrar.js";
import { clinicaIsEnabled } from "./gate.js";
import type { Ejecutor } from "./claves.js";

/** La huella del texto de una versión. La calcula la API porque el paquete
 *  es puro y no tiene `node:crypto` — mismo reparto que las plantillas de
 *  consentimiento de clinica-4. */
export function huellaDelContrato(version: number): string | null {
  const contrato = contratoDe(version);
  if (contrato == null) return null;
  return createHash("sha256")
    .update(textoCanonico(contrato), "utf8")
    .digest("hex");
}

/** La huella de la versión vigente, que es la que se graba al aceptar. */
export function huellaVigente(): string {
  return huellaDelContrato(VERSION_VIGENTE)!;
}

// ── El estado ─────────────────────────────────────────────────────────

const TTL_MS = 30_000;
const cache = new Map<string, { estado: EstadoDelModuloClinico; hasta: number }>();

/** La invalidan `aceptar` y `revocar`, y los tests. */
export function olvidarEstado(tenantId?: string): void {
  if (tenantId == null) cache.clear();
  else cache.delete(tenantId);
}

const SELECT_FILA = {
  id: true,
  version: true,
  revokesAgreementId: true,
} as const;

/**
 * EL estado del módulo clínico de un tenant.
 *
 * Dos consultas (la capability y las filas) y una función pura. Las filas
 * se traen TODAS: son una por aceptación y una por revocación, y en cinco
 * años de una clínica serán media docena. Paginarlas habría sido optimizar
 * una tabla que no crece.
 */
export async function estadoDelTenant(
  tenantId: string,
  prisma: Ejecutor = getPrisma(),
): Promise<EstadoDelModuloClinico> {
  const ahora = Date.now();
  const cacheado = cache.get(tenantId);
  if (cacheado && cacheado.hasta > ahora) return cacheado.estado;

  const encendida = await clinicaIsEnabled(tenantId);
  // Con el módulo apagado NO se leen las filas: la función pura tampoco
  // las mira, y una consulta por cada petición de un bar es una consulta
  // que no hace falta.
  if (!encendida) {
    const estado: EstadoDelModuloClinico = { estado: "APAGADO" };
    cache.set(tenantId, { estado, hasta: ahora + TTL_MS });
    return estado;
  }

  const filas = await prisma.clinicalProcessorAgreement.findMany({
    where: { tenantId },
    select: SELECT_FILA,
  });
  const estado = estadoDelModuloClinico({
    clinicaEncendida: true,
    filas: filas as FilaDelContrato[],
    versionVigente: VERSION_VIGENTE,
  });
  cache.set(tenantId, { estado, hasta: ahora + TTL_MS });
  return estado;
}

/**
 * Lo que el guard de `conHistoria` necesita: `null` si esta acción se
 * puede hacer, y el código y el mensaje del 423 si no.
 *
 * **Lee Y escribe pasan por aquí**, y es lo que un test encontró: con el
 * contrato NUNCA aceptado, la decisión 4 dice «ni una ruta clínica
 * responde con datos» — lectura incluida. El guard original solo miraba
 * las escrituras, así que una clínica recién encendida servía la historia
 * entera antes de que nadie aceptara nada.
 */
export async function negativaClinica(
  tenantId: string,
  accion: "LEER" | "ESCRIBIR",
  prisma?: Ejecutor,
): Promise<{ code: string; message: string } | null> {
  return negativaDelContrato(await estadoDelTenant(tenantId, prisma), accion);
}

/** Atajo para quien solo quiere el sí o el no de escribir. */
export async function puedeEscribirClinico(
  tenantId: string,
  prisma?: Ejecutor,
): Promise<boolean> {
  return permiteEscribirHistoria(await estadoDelTenant(tenantId, prisma));
}

// ── Aceptar ───────────────────────────────────────────────────────────

export type MotivoDeNoAceptar =
  | "SOLO_LA_DUENA"
  | "VERSION_DESCONOCIDA"
  | "YA_ESTABA_ACEPTADA"
  // contrato-lectura-completa · la pantalla no dice que el texto completo
  // se recorriera hasta el final. Ver `aceptarContrato`.
  | "TEXTO_NO_RECORRIDO";

export type ResultadoDeAceptar =
  | { ok: true; aceptacionId: string; version: number; aceptadoEn: string }
  | { ok: false; motivo: MotivoDeNoAceptar; mensaje: string };

/**
 * contrato-lectura-completa · el instante en que el final del texto llegó
 * a la pantalla, **saneado**.
 *
 * Lo mide la pantalla (es la única que sabe cuándo se vio el centinela) y
 * viaja en el cuerpo de la petición, así que el reloj que lo estampa es el
 * del aparato — y el reloj de una tablet miente. Un instante del futuro, o
 * de hace más de un día, no es «cuándo bajó hasta el final»: es un reloj
 * mal puesto, y en una prueba jurídica eso se cambia por la hora del
 * servidor en vez de guardarse tal cual.
 *
 * No se RECHAZA por eso: el reloj de su tablet no es motivo para no poder
 * aceptar un contrato (misma dirección que el user-agent largo, que se
 * recorta en vez de rechazarse). Lo que se pierde al sanearlo son los
 * segundos entre llegar al final y marcar la casilla, y eso no es lo que
 * la fila demuestra.
 */
function instanteDelFinal(reportado: Date | null, ahora: Date): Date {
  if (reportado == null) return ahora;
  const t = reportado.getTime();
  if (!Number.isFinite(t)) return ahora;
  const DIA_MS = 24 * 60 * 60 * 1000;
  if (t > ahora.getTime() || t < ahora.getTime() - DIA_MS) return ahora;
  return reportado;
}

/**
 * La dueña acepta el contrato. **Una fila nueva, nunca un UPDATE.**
 *
 * `esDuena` lo resuelve la ruta con el rol del JWT y el de la base, y se
 * pasa aquí: esta función no consulta roles por su cuenta para no tener
 * dos sitios que decidan lo mismo, pero **sí se niega** si le dicen que
 * no. La negativa vive en el camino de escritura, no sólo en la pantalla.
 * Es el mismo reparto que `hayConsentimiento` en `guardarFoto`.
 */
export async function aceptarContrato(
  prisma: Ejecutor,
  input: {
    tenantId: string;
    userId: string;
    esDuena: boolean;
    deviceId: string | null;
    ip: string | null;
    userAgent: string | null;
    version?: number;
    /** contrato-lectura-completa · lo que la pantalla afirma: el texto
     *  completo se mostró y se recorrió hasta el final. Sin esto no se
     *  acepta. */
    textoMostradoCompleto?: boolean;
    /** Cuándo llegó el final a la pantalla, según el aparato. `null` =
     *  no lo dijo, y entonces vale la hora del servidor. */
    finalDelTextoEn?: Date | null;
    ahora?: Date;
  },
): Promise<ResultadoDeAceptar> {
  if (!input.esDuena) {
    return {
      ok: false,
      motivo: "SOLO_LA_DUENA",
      mensaje:
        "El contrato de tratamiento de datos lo acepta la dueña del centro, no el personal.",
    };
  }
  // contrato-lectura-completa · **no se acepta sin haber pasado por todo
  // el texto**, y la negativa vive AQUÍ y no sólo en la pantalla.
  //
  // La pantalla desactiva la casilla y el botón hasta que el final del
  // texto ha llegado a la vista. Eso es la mitad que se ve; esta es la que
  // vale. Lo que la fila tiene que poder decir el día que alguien diga «yo
  // eso no lo leí» es que el texto completo se mostró y se recorrió, y una
  // regla que sólo vive en el navegador no lo puede decir: un `curl` con el
  // token de la dueña escribiría la misma fila sin haber pintado una letra.
  //
  // Mismo reparto que `esDuena` dos líneas arriba, y que `hayConsentimiento`
  // en `guardarFoto`.
  if (input.textoMostradoCompleto !== true) {
    return {
      ok: false,
      motivo: "TEXTO_NO_RECORRIDO",
      mensaje:
        "Baja hasta el final del contrato antes de aceptarlo: la aceptación guarda que el texto completo se mostró entero.",
    };
  }
  const version = input.version ?? VERSION_VIGENTE;
  const huella = huellaDelContrato(version);
  if (huella == null) {
    // Aceptar una versión que este despliegue no conoce dejaría una fila
    // con una huella inventada. Mejor negarse: el texto que no se puede
    // enseñar no se puede aceptar.
    return {
      ok: false,
      motivo: "VERSION_DESCONOCIDA",
      mensaje:
        "Esa versión del contrato no existe en este programa. Recarga la pantalla y vuelve a intentarlo.",
    };
  }

  // Ya aceptada y viva: no se escribe otra fila. Dos aceptaciones del
  // mismo texto el mismo día no son más prueba, son una pregunta — la
  // misma decisión que clinica-4 tomó con un consentimiento ya firmado.
  const estado = await estadoDelTenant(input.tenantId, prisma);
  if (
    estado.estado === "VIGENTE" &&
    estado.versionAceptada >= version
  ) {
    return {
      ok: false,
      motivo: "YA_ESTABA_ACEPTADA",
      mensaje: "El contrato de tratamiento de datos ya estaba aceptado.",
    };
  }

  const fila = await prisma.clinicalProcessorAgreement.create({
    data: {
      tenantId: input.tenantId,
      version,
      textSha256: huella,
      userId: input.userId,
      deviceId: input.deviceId,
      // Recortados al ancho de la columna en vez de rechazados: un
      // user-agent largo no es motivo para no poder aceptar un contrato.
      ip: input.ip?.slice(0, 45) ?? null,
      userAgent: input.userAgent?.slice(0, 300) ?? null,
      // contrato-lectura-completa · la prueba de que el texto pasó entero
      // por la pantalla. Ver `instanteDelFinal` sobre el reloj del aparato.
      textoRecorridoEn: instanteDelFinal(
        input.finalDelTextoEn ?? null,
        input.ahora ?? new Date(),
      ),
    },
    select: { id: true, at: true },
  });
  olvidarEstado(input.tenantId);
  return {
    ok: true,
    aceptacionId: fila.id,
    version,
    aceptadoEn: fila.at.toISOString(),
  };
}

// ── Revocar ───────────────────────────────────────────────────────────

export type MotivoDeNoRevocar = "SOLO_LA_DUENA" | "NO_HAY_NADA_VIGENTE";

export type ResultadoDeRevocarContrato =
  | { ok: true; revocaciones: number; revocadoEn: string }
  | { ok: false; motivo: MotivoDeNoRevocar; mensaje: string };

/**
 * La dueña revoca. **Una fila de revocación por cada aceptación viva.**
 *
 * Una por cada y no una sola: el mecanismo es «una revocación apunta a UNA
 * aceptación», y con dos aceptaciones vivas (la v1 y la v2) una sola fila
 * dejaría la otra en pie. Y así la lista se lee entera — cada aceptación
 * con su revocación al lado.
 *
 * Lo que esto NO toca: la agenda, la caja, los datos. La historia pasa a
 * SOLO LECTURA; todo lo escrito sigue ahí y se puede leer, imprimir y
 * exportar. Decisión 4.
 */
export async function revocarContrato(
  prisma: Ejecutor,
  input: {
    tenantId: string;
    userId: string;
    esDuena: boolean;
    deviceId: string | null;
    ip: string | null;
    userAgent: string | null;
    ahora?: Date;
  },
): Promise<ResultadoDeRevocarContrato> {
  if (!input.esDuena) {
    return {
      ok: false,
      motivo: "SOLO_LA_DUENA",
      mensaje:
        "El contrato de tratamiento de datos lo revoca la dueña del centro, no el personal.",
    };
  }
  const ahora = input.ahora ?? new Date();
  const filas = await prisma.clinicalProcessorAgreement.findMany({
    where: { tenantId: input.tenantId },
    select: { id: true, version: true, textSha256: true, revokesAgreementId: true },
  });
  const revocadas = new Set(
    filas
      .map((f) => f.revokesAgreementId)
      .filter((x): x is string => x != null),
  );
  const vivas = filas.filter(
    (f) => f.revokesAgreementId == null && !revocadas.has(f.id),
  );
  if (vivas.length === 0) {
    return {
      ok: false,
      motivo: "NO_HAY_NADA_VIGENTE",
      mensaje: "No hay ningún contrato aceptado que revocar.",
    };
  }

  await prisma.clinicalProcessorAgreement.createMany({
    data: vivas.map((v) => ({
      tenantId: input.tenantId,
      // La revocación COPIA versión y huella de la fila que revoca: es lo
      // que hace que la lista se lea sin cruzar dos filas para pintar una
      // (decisión 4 de clinica-4, el mismo movimiento).
      version: v.version,
      textSha256: v.textSha256,
      userId: input.userId,
      at: ahora,
      deviceId: input.deviceId,
      ip: input.ip?.slice(0, 45) ?? null,
      userAgent: input.userAgent?.slice(0, 300) ?? null,
      revokesAgreementId: v.id,
    })),
  });
  olvidarEstado(input.tenantId);
  return {
    ok: true,
    revocaciones: vivas.length,
    revocadoEn: ahora.toISOString(),
  };
}

// ── La sección del panel ──────────────────────────────────────────────

export interface AceptacionEnPantalla {
  id: string;
  version: number;
  /** La huella del texto. Se enseña: es lo que demuestra QUÉ se aceptó, y
   *  la pantalla la pone al lado del botón de descargar el PDF. */
  huella: string;
  aceptadoEn: string;
  /** Quién. El alias o el email, como en el resto de la casa. */
  quien: string;
  /** Desde dónde, para la prueba. `null` cuando se aceptó desde el panel
   *  (que no tiene aparato dado de alta). */
  aparato: string | null;
  revocado: boolean;
  revocadoEn: string | null;
  revocadoPor: string | null;
  /** `true` si este despliegue sabe enseñar el texto de esa versión. Con
   *  `false`, la pantalla enseña la huella y la fecha —que es verdad— y no
   *  ofrece el PDF. */
  textoDisponible: boolean;
  /** contrato-lectura-completa · cuándo llegó el final del texto a la
   *  pantalla, antes de aceptar. `null` en las aceptaciones anteriores a la
   *  regla: entonces NO SE MIDIÓ, y la pantalla no afirma nada sobre
   *  ellas. */
  textoRecorridoEn: string | null;
}

export interface VistaDelContrato {
  estado: EstadoDelModuloClinico;
  versionVigente: number;
  /** `true` mientras el texto no lo haya revisado un abogado. La pantalla
   *  enseña el aviso ámbar. */
  pendienteDeValidar: boolean;
  /** El texto de la versión vigente, para la pantalla de aceptación. */
  titulo: string;
  apartados: readonly { encabezado: string; parrafos: readonly string[] }[];
  huellaVigente: string;
  /** Todo lo que pasó, de lo más reciente a lo más antiguo. Las
   *  revocaciones NO salen como filas propias: salen marcando su
   *  aceptación, igual que las revocaciones de consentimiento de
   *  clinica-4. Dos líneas por el mismo contrato se leerían como dos
   *  contratos. */
  aceptaciones: readonly AceptacionEnPantalla[];
}

// clinica-8 (fase B, 11) · el nombre, no el email. Era una copia local
// que caía al email entero; ahora es `lib/nombre-para-mostrar.ts`.
const nombreDe = nombreParaMostrar;

/** Lo que la sección «Contrato de tratamiento de datos» pinta, de una
 *  vez. */
export async function vistaDelContrato(
  tenantId: string,
  prisma: Ejecutor = getPrisma(),
): Promise<VistaDelContrato> {
  const [estado, filas] = await Promise.all([
    estadoDelTenant(tenantId, prisma),
    prisma.clinicalProcessorAgreement.findMany({
      where: { tenantId },
      orderBy: { at: "desc" },
      select: {
        id: true,
        version: true,
        textSha256: true,
        at: true,
        revokesAgreementId: true,
        textoRecorridoEn: true,
        user: { select: { alias: true, email: true } },
        device: { select: { name: true } },
      },
    }),
  ]);

  const revocacionDe = new Map<string, (typeof filas)[number]>();
  for (const f of filas) {
    if (f.revokesAgreementId != null) revocacionDe.set(f.revokesAgreementId, f);
  }

  return {
    estado,
    versionVigente: VERSION_VIGENTE,
    pendienteDeValidar: CONTRATO_VIGENTE.pendienteDeValidar,
    titulo: CONTRATO_VIGENTE.titulo,
    apartados: CONTRATO_VIGENTE.apartados,
    huellaVigente: huellaVigente(),
    aceptaciones: filas
      .filter((f) => f.revokesAgreementId == null)
      .map((f) => {
        const rev = revocacionDe.get(f.id) ?? null;
        return {
          id: f.id,
          version: f.version,
          huella: f.textSha256,
          aceptadoEn: f.at.toISOString(),
          quien: nombreDe(f.user),
          aparato: f.device?.name ?? null,
          revocado: rev != null,
          revocadoEn: rev?.at.toISOString() ?? null,
          revocadoPor: rev ? nombreDe(rev.user) : null,
          textoDisponible: contratoDe(f.version) != null,
          textoRecorridoEn: f.textoRecorridoEn?.toISOString() ?? null,
        };
      }),
  };
}

// ── primer-acceso · lo que `/auth/me` necesita para decidir la entrada ──
//
// Punto 3 del bloque: «si la cuenta tiene la clínica encendida y el
// contrato no está vigente, y ella es la propietaria, la primera pantalla
// es el contrato».
//
// Vive aquí y no en `routes.ts` del auth por lo mismo que todo lo demás de
// este fichero: el estado lo calcula `estadoDelTenant`, que es la MISMA
// función que decide el 423. Un `if` sobre versiones en la ruta de `/me`
// habría sido la segunda implementación del estado que `estado.ts` existe
// para evitar — y el síntoma habría sido mandar a la dueña al contrato
// cuando el servidor ya la deja escribir, o al revés.

export interface ContratoEnLaEntrada {
  /** El nombre del estado, tal cual. `APAGADO` incluido: el panel lo trata
   *  como «aquí no hay nada que aceptar» y entra donde entraba. */
  estado: EstadoDelModuloClinico["estado"];
  /** `true` cuando hay que llevar a esta persona al contrato antes que a
   *  cualquier otra pantalla. */
  falta: boolean;
  /** `true` si ESTA persona puede aceptarlo. Lo decide el servidor con el
   *  rol de la base, igual que `GET /clinica/contrato`, y no el rol del
   *  token: así la pantalla no ofrece un botón que la ruta va a negar. */
  puedeAceptar: boolean;
}

export async function estadoDelContratoParaElPanel(
  tenantId: string,
  userId: string,
  prisma: Ejecutor = getPrisma(),
): Promise<ContratoEnLaEntrada> {
  const estado = await estadoDelTenant(tenantId, prisma);
  if (estado.estado === "APAGADO") {
    return { estado: "APAGADO", falta: false, puedeAceptar: false };
  }
  const fila = await prisma.user.findFirst({
    where: { id: userId, tenantId, deletedAt: null },
    select: { role: true },
  });
  return {
    estado: estado.estado,
    // `VIGENTE` es el único estado en el que no falta nada. `SOLO_LECTURA`
    // también manda al contrato: hay una versión nueva sin aceptar o está
    // revocado, y en los dos casos lo siguiente que hay que hacer es
    // mirarlo — no chocar con el 423 tres pantallas más adelante.
    falta: estado.estado !== "VIGENTE",
    puedeAceptar: fila?.role === "OWNER",
  };
}
