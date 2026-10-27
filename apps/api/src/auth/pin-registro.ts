// pin-1 (punto 7) · ESCRIBIR EL PIN Y REGISTRARLO SON LA MISMA ESCRITURA.
//
// Las cinco rutas que cambian un PIN pasan por aquí, y lo hacen en una
// transacción con dos sentencias: el `pin_hash` nuevo y la fila de
// `pin_changes`. O las dos, o ninguna.
//
// Por qué atómico y no «registra después, y si falla lo loguea»: porque
// el registro es el punto 7 del bloque, no un extra. Un PIN cambiado sin
// fila es exactamente el agujero del 27-10 —dos regeneraciones del PIN de
// la propietaria en una mañana y nada escrito— y «lo intentamos y si
// falla seguimos» lo reabre el día que la tabla esté llena o la conexión
// se corte a mitad.
//
// El riesgo que esto asume: si `pin_changes` no se puede escribir, nadie
// puede cambiar su PIN. Es el mismo riesgo que ya tiene `users`, que es
// la otra mitad de la misma transacción.
//
// **Aquí no entra el PIN.** La función recibe el hash ya calculado y lo
// que registra es el hecho; ni el PIN ni el hash llegan a `pin_changes`
// porque no hay columna donde ponerlos.

import type { PinChangeKind, PinChangeSource } from "@mipiacetpv/db";

import { getPrisma } from "../context.js";

export interface CambioDePin {
  /** A quién se le cambia. */
  targetUserId: string;
  tenantId: string;
  /** Quién lo cambia. El mismo que `targetUserId` cuando es «el mío». */
  actorUserId: string;
  /** El argon2id ya calculado. */
  pinHash: string;
  /**
   * `PROPIO` lo eligió la persona y vale para todo; `PROVISIONAL` se lo
   * pusieron y sólo sirve para entrar una vez a elegir el suyo.
   */
  kind: PinChangeKind;
  source: PinChangeSource;
}

export async function escribirPinYRegistrarlo(cambio: CambioDePin): Promise<void> {
  const prisma = getPrisma();
  await prisma.$transaction([
    prisma.user.update({
      where: { id: cambio.targetUserId },
      data: {
        pinHash: cambio.pinHash,
        // La marca se PONE o se QUITA en la misma escritura, nunca se
        // deja como estaba: elegir el propio PIN sobre uno provisional
        // tiene que limpiar la marca, y poner uno provisional sobre un
        // PIN propio tiene que ponerla. Dejarla «como estaba» convierte
        // los dos casos en bugs silenciosos — uno deja a la cajera
        // eligiendo PIN cada vez que entra, el otro le da un PIN
        // prestado que cobra.
        pinProvisionalAt: cambio.kind === "PROVISIONAL" ? new Date() : null,
      },
    }),
    prisma.pinChange.create({
      data: {
        tenantId: cambio.tenantId,
        targetUserId: cambio.targetUserId,
        actorUserId: cambio.actorUserId,
        kind: cambio.kind,
        source: cambio.source,
      },
    }),
  ]);
}
