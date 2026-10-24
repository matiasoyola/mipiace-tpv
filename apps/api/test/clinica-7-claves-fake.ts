// clinica-7 · el llavero, en memoria, para los fakes de Prisma de los
// tests de unidad.
//
// Los siete ficheros de tests clínicos de unidad traen su propio Prisma a
// mano. Desde clinica-7 todos necesitan la MISMA pieza nueva
// (`clinicalTenantKey`), y copiarla siete veces habría sido siete sitios
// donde se desincroniza con la tabla de verdad.
//
// Lo que este fake imita del motor, y es lo que los tests necesitan de él:
//
//   · la primaria es `tenant_id`, así que `create` de una clave que ya
//     existe **falla** — es el cierre de carrera de `asegurarDek`;
//   · una clave destruida no se resucita;
//   · `update` y `updateMany` se comportan como los de Prisma.
//
// Lo que NO imita: los triggers. Eso lo prueba el e2e contra Postgres de
// verdad (`clinica-7.e2e.ts`), que es justamente lo que un fake no puede
// probar.
//
// ── Y la KEK de los tests ────────────────────────────────────────────
//
// `kekDePrueba()` pone una KEK aleatoria en `process.env` ANTES de que
// `loadEnv` la lea. Aleatoria por fichero y no fija: una constante en un
// fichero de test es una clave que alguien copia a producción «para
// probar».

import { randomBytes } from "node:crypto";

/** Pone una `CLINICAL_KEK` de 32 bytes aleatorios. Hay que llamarla al
 *  principio del fichero, junto a las otras `process.env`. */
export function kekDePrueba(): string {
  const kek = randomBytes(32).toString("base64");
  process.env.CLINICAL_KEK = kek;
  process.env.CLINICAL_KEK_ID = "test";
  return kek;
}

export interface FilaDeClave {
  tenantId: string;
  kekId: string;
  dekWrapped: string | null;
  canary: string | null;
  createdAt: Date;
  rewrappedAt: Date | null;
  destroyedAt: Date | null;
  destroyedReason: string | null;
}

export interface LlaveroFake {
  /** El modelo, para meterlo en el objeto `prisma` del fichero. */
  modelo: {
    findUnique: (args: { where: { tenantId: string } }) => Promise<unknown>;
    findMany: (args?: unknown) => Promise<unknown[]>;
    count: (args?: unknown) => Promise<number>;
    create: (args: { data: Partial<FilaDeClave> }) => Promise<unknown>;
    update: (args: {
      where: { tenantId: string };
      data: Partial<FilaDeClave>;
    }) => Promise<unknown>;
    updateMany: (args: {
      where: { tenantId: string; destroyedAt?: null };
      data: Partial<FilaDeClave>;
    }) => Promise<{ count: number }>;
  };
  /** Las filas, para que un test pueda mirarlas o vaciarlas. */
  filas: Map<string, FilaDeClave>;
  /** Para el `beforeEach`. */
  reset: () => void;
}

export function llaveroFake(): LlaveroFake {
  const filas = new Map<string, FilaDeClave>();

  return {
    filas,
    reset: () => filas.clear(),
    modelo: {
      findUnique: async ({ where }) => filas.get(where.tenantId) ?? null,
      findMany: async () => [...filas.values()],
      count: async () => filas.size,
      create: async ({ data }) => {
        const tenantId = data.tenantId!;
        // La primaria. `asegurarDek` depende de que esto FALLE: es lo que
        // hace que dos escrituras simultáneas del primer día no creen dos
        // claves y dejen ilegible lo que cifró la primera.
        if (filas.has(tenantId)) {
          throw new Error("Unique constraint failed on the fields: (tenant_id)");
        }
        const fila: FilaDeClave = {
          tenantId,
          kekId: data.kekId!,
          dekWrapped: data.dekWrapped ?? null,
          canary: data.canary ?? null,
          createdAt: new Date(),
          rewrappedAt: null,
          destroyedAt: null,
          destroyedReason: null,
        };
        filas.set(tenantId, fila);
        return fila;
      },
      update: async ({ where, data }) => {
        const fila = filas.get(where.tenantId);
        if (!fila) throw new Error("Record to update not found");
        const nueva = { ...fila, ...data };
        filas.set(where.tenantId, nueva);
        return nueva;
      },
      updateMany: async ({ where, data }) => {
        const fila = filas.get(where.tenantId);
        if (!fila) return { count: 0 };
        // `destroyedAt: null` en el WHERE es lo que hace idempotente a
        // `destruirDek`: un segundo intento no pisa la fecha del primero.
        if (where.destroyedAt === null && fila.destroyedAt != null) {
          return { count: 0 };
        }
        filas.set(where.tenantId, { ...fila, ...data });
        return { count: 1 };
      },
    },
  };
}

/**
 * El cuerpo EN CLARO de una fila del doble, descifrándolo.
 *
 * Existe para los tests que afirman cosas sobre el CONTENIDO de una
 * entrada de historia («aquí no hay ni un precio», «la sesión guarda el
 * nombre del tratamiento»). Desde clinica-7 esas filas tienen el centinela
 * en `body` y el dato en `bodyCifrado`, así que leerlo a pelo afirmaría
 * sobre el centinela — o sea, sobre nada.
 *
 * Y descifrar en el test es MEJOR que lo que había: lo que se afirma pasa a
 * ser lo que de verdad se guardó, no lo que la aplicación dijo que iba a
 * guardar.
 */
export async function cuerpoClaroDe(
  fila: { id: string; tenantId: string; body: unknown; bodyCifrado: string | null },
  prisma: unknown,
): Promise<any> {
  const { dekONada } = await import("../src/clinica/claves.js");
  const { cuerpoDeEntrada } = await import("../src/clinica/cripto-campos.js");
  const dek = await dekONada(fila.tenantId, prisma as never);
  return cuerpoDeEntrada(fila as never, dek) as any;
}

// ── El contrato de encargado, en memoria ─────────────────────────────
//
// Los siete ficheros de tests clínicos de unidad dan por hecho una clínica
// que FUNCIONA, y desde clinica-7 una clínica que funciona es una que tiene
// el contrato aceptado: sin él, `conHistoria` contesta 423 a toda
// escritura. Así que este doble **nace con el contrato aceptado**, que es
// el estado normal, y deja revocarlo al test que quiera probar el 423.
//
// Nace aceptado y no vacío a propósito: lo contrario habría significado
// añadir una línea de `aceptar()` a los sesenta `beforeEach` de la casa, y
// el que se la olvidara vería 423 en un test que no va del contrato.

import { createHash } from "node:crypto";

import {
  CONTRATO_VIGENTE,
  textoCanonico,
  VERSION_VIGENTE,
} from "@mipiacetpv/contrato-encargado";

export interface FilaDeContrato {
  id: string;
  tenantId: string;
  version: number;
  textSha256: string;
  userId: string;
  at: Date;
  deviceId: string | null;
  ip: string | null;
  userAgent: string | null;
  revokesAgreementId: string | null;
  /** contrato-lectura-completa · cuándo llegó el final del texto a la
   *  pantalla. `null` por defecto en las filas SEMBRADAS: representan las
   *  aceptaciones de hoy, que son anteriores a la regla y donde nadie
   *  midió nada. Las que escribe la ruta sí lo traen. */
  textoRecorridoEn: Date | null;
}

export interface ContratoFake {
  modelo: {
    findMany: (args: any) => Promise<any[]>;
    findFirst: (args: any) => Promise<any>;
    create: (args: any) => Promise<any>;
    createMany: (args: any) => Promise<{ count: number }>;
  };
  filas: FilaDeContrato[];
  /** La huella del texto vigente, la de verdad. */
  huella: string;
  /** Lo deja aceptado (es el estado de partida del `reset`). */
  aceptar: (opciones?: {
    version?: number;
    userId?: string;
    textoRecorridoEn?: Date | null;
  }) => FilaDeContrato;
  /** Lo revoca: una fila nueva por cada aceptación viva. */
  revocar: () => void;
  /** Lo deja SIN aceptar nunca. */
  vaciar: () => void;
  reset: () => void;
}

export function contratoFake(
  tenantId: string,
  duenaId: string,
): ContratoFake {
  const huella = createHash("sha256")
    .update(textoCanonico(CONTRATO_VIGENTE), "utf8")
    .digest("hex");
  let filas: FilaDeContrato[] = [];
  let n = 0;

  const aceptar = (
    opciones: {
      version?: number;
      userId?: string;
      textoRecorridoEn?: Date | null;
    } = {},
  ) => {
    const fila: FilaDeContrato = {
      id: `acuerdo-${++n}`,
      tenantId,
      version: opciones.version ?? VERSION_VIGENTE,
      textSha256: huella,
      userId: opciones.userId ?? duenaId,
      at: new Date("2026-10-14T08:00:00.000Z"),
      deviceId: null,
      ip: null,
      userAgent: null,
      revokesAgreementId: null,
      textoRecorridoEn: opciones.textoRecorridoEn ?? null,
    };
    filas.push(fila);
    return fila;
  };

  const revocar = () => {
    const revocadas = new Set(
      filas.map((f) => f.revokesAgreementId).filter((x): x is string => x != null),
    );
    for (const viva of filas.filter(
      (f) => f.revokesAgreementId == null && !revocadas.has(f.id),
    )) {
      filas.push({
        ...viva,
        id: `revoca-${++n}`,
        at: new Date("2026-10-14T09:00:00.000Z"),
        revokesAgreementId: viva.id,
        // Una revocación no acepta nada: nunca trae el recorrido. Es lo
        // que el CHECK de la migración exige.
        textoRecorridoEn: null,
      });
    }
  };

  const api: ContratoFake = {
    filas,
    huella,
    aceptar,
    revocar,
    vaciar: () => {
      filas.length = 0;
    },
    reset: () => {
      filas.length = 0;
      n = 0;
      aceptar();
    },
    modelo: {
      // La usa el PDF del contrato: «¿quién aceptó esta versión y cuándo?».
      findFirst: async ({ where, orderBy }: any) => {
        let xs = filas.filter(
          (f) =>
            f.tenantId === where.tenantId &&
            (where.version == null || f.version === where.version) &&
            (where.revokesAgreementId !== null || f.revokesAgreementId == null),
        );
        if (orderBy?.at === "desc") {
          xs = xs.slice().sort((a, b) => +b.at - +a.at);
        }
        const f = xs[0];
        return f == null
          ? null
          : { ...f, user: { alias: null, email: "d@d.es" } };
      },
      findMany: async ({ where, select, orderBy }: any) => {
        let xs = filas.filter((f) => f.tenantId === where.tenantId);
        if (orderBy?.at === "desc") {
          xs = xs.slice().sort((a, b) => +b.at - +a.at);
        }
        return xs.map((f) => ({
          ...f,
          ...(select?.user ? { user: { alias: null, email: "d@d.es" } } : {}),
          ...(select?.device ? { device: null } : {}),
        }));
      },
      create: async ({ data }: any) => {
        const fila: FilaDeContrato = {
          id: `acuerdo-${++n}`,
          tenantId: data.tenantId,
          version: data.version,
          textSha256: data.textSha256,
          userId: data.userId,
          at: data.at ?? new Date(),
          deviceId: data.deviceId ?? null,
          ip: data.ip ?? null,
          userAgent: data.userAgent ?? null,
          revokesAgreementId: data.revokesAgreementId ?? null,
          textoRecorridoEn: data.textoRecorridoEn ?? null,
        };
        filas.push(fila);
        return fila;
      },
      createMany: async ({ data }: any) => {
        for (const d of data) {
          filas.push({
            id: `revoca-${++n}`,
            tenantId: d.tenantId,
            version: d.version,
            textSha256: d.textSha256,
            userId: d.userId,
            at: d.at ?? new Date(),
            deviceId: d.deviceId ?? null,
            ip: d.ip ?? null,
            userAgent: d.userAgent ?? null,
            revokesAgreementId: d.revokesAgreementId ?? null,
            textoRecorridoEn: d.textoRecorridoEn ?? null,
          });
        }
        return { count: data.length };
      },
    },
  };
  // El estado de partida: aceptado.
  aceptar();
  return api;
}
