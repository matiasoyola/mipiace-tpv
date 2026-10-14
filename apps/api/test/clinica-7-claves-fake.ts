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
