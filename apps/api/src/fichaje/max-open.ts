// hotfix-fichaje-medianoche · el máximo de horas abiertas DEL TENANT.
//
// `esSalidaOlvidada` (en `time.ts`) es puro y no sabe de base de datos.
// Esto es lo único que le falta: de dónde sale su tercer argumento. Vive
// aparte para que las tres superficies —cierre, pantalla del empleado y
// panel— lo lean igual, y para que `time.ts` siga sin importar Prisma.
//
// Falla hacia el DEFAULT, no hacia un error. El mismo razonamiento que
// `fichajeIsEnabled` hace hacia "apagado", aplicado a un entero: si la
// columna no se puede leer —cliente de Prisma viejo, migración sin
// aplicar, fila que desapareció— lo peor que puede pasar es tratar a ese
// tenant como a los demás. Tumbar un cierre de turno porque no se pudo
// leer un ajuste que casi nadie toca sería exactamente al revés.

import { getPrisma } from "../context.js";
import { MAX_OPEN_HOURS_DEFAULT, normalizeMaxOpenHours } from "./time.js";

export async function maxOpenHoursFor(tenantId: string): Promise<number> {
  const model = getPrisma().tenant as
    | {
        findUnique?: (args: unknown) => Promise<{ fichajeMaxOpenHours?: unknown } | null>;
        findUniqueOrThrow?: (args: unknown) => Promise<{ fichajeMaxOpenHours?: unknown }>;
      }
    | undefined;
  const read = model?.findUnique ?? model?.findUniqueOrThrow;
  if (typeof read !== "function") return MAX_OPEN_HOURS_DEFAULT;
  try {
    const tenant = await read.call(model, {
      where: { id: tenantId },
      select: { fichajeMaxOpenHours: true },
    });
    return normalizeMaxOpenHours(tenant?.fichajeMaxOpenHours);
  } catch {
    return MAX_OPEN_HOURS_DEFAULT;
  }
}
