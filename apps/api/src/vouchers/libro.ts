// B-reservas-8 · EL LIBRO: leerlo y escribir en él.
//
// Las definiciones de QUÉ significa el saldo viven en `@mipiacetpv/bonos`
// (`saldo.ts`), porque las comparten la API, el TPV y el panel. Aquí está
// sólo lo que necesita una base de datos: la lectura ordenada del libro de
// un bono y el único `INSERT` que escribe en `voucher_movements`.
//
// **Nadie inserta en esa tabla fuera de este fichero.** El libro es de solo
// inserción (trigger `voucher_movements_append_only`) y el convenio del
// signo lo obliga un CHECK, así que una escritura suelta no corrompería el
// saldo —la base la rechazaría—, pero sí dejaría una línea sin `detalle`
// legible o sin `canal`, y el libro existe para que recepción lo lea.

import { Prisma } from "@mipiacetpv/db";
import type {
  CanalMovimiento,
  LineaDelLibro,
  MotivoCorreccion,
  TipoMovimiento,
} from "@mipiacetpv/bonos";

export type { CanalMovimiento, LineaDelLibro, MotivoCorreccion, TipoMovimiento };

/** Lee el libro de un bono, en orden y dentro de la transacción que decide.
 *  `id` desempata: apartar y consumir pueden caer en el mismo milisegundo. */
export async function leerLibro(
  tx: Prisma.TransactionClient,
  voucherId: string,
): Promise<LineaDelLibro[]> {
  const filas = await tx.$queryRaw<
    Array<{ tipo: string; sesiones: number; appointment_id: string | null }>
  >`
    SELECT "tipo", "sesiones", "appointment_id"
      FROM "voucher_movements"
     WHERE "voucher_id" = ${voucherId}::uuid
     ORDER BY "created_at", "id"`;
  return filas.map((f) => ({
    tipo: f.tipo,
    sesiones: Number(f.sesiones),
    appointmentId: f.appointment_id,
  }));
}

/** Lo que hace falta para escribir una línea. `detalle` nunca vacío (la
 *  base lo rechaza) y `userId` o `actor`, uno de los dos. */
export interface LineaNueva {
  tenantId: string;
  voucherId: string;
  tipo: TipoMovimiento;
  sesiones: number;
  appointmentId?: string | null;
  ticketLineId?: string | null;
  compensaA?: string | null;
  detalle: string;
  motivo?: MotivoCorreccion | null;
  canal: CanalMovimiento;
  userId?: string | null;
  actor?: string | null;
  esPrueba: boolean;
  /** UTC DESDE EL CÓDIGO. Sin `now()` de Postgres: el negocio no se fecha
   *  con el reloj del servidor de base de datos. */
  createdAt: Date;
}

/**
 * Escribe una línea del libro. Devuelve su id, que es lo que `compensaA`
 * necesita para enlazar una corrección con lo que corrige.
 */
export async function escribirLinea(
  tx: Prisma.TransactionClient,
  linea: LineaNueva,
): Promise<string> {
  const filas = await tx.$queryRaw<Array<{ id: string }>>`
    INSERT INTO "voucher_movements"
      ("id", "tenant_id", "voucher_id", "tipo", "sesiones", "appointment_id",
       "ticket_line_id", "compensa_a", "detalle", "motivo", "canal",
       "user_id", "actor", "es_prueba", "created_at")
    VALUES
      (gen_random_uuid(), ${linea.tenantId}::uuid, ${linea.voucherId}::uuid,
       ${linea.tipo}, ${linea.sesiones}, ${linea.appointmentId ?? null}::uuid,
       ${linea.ticketLineId ?? null}::uuid, ${linea.compensaA ?? null}::uuid,
       ${linea.detalle}, ${linea.motivo ?? null}, ${linea.canal},
       ${linea.userId ?? null}::uuid, ${linea.actor ?? null},
       ${linea.esPrueba}, ${linea.createdAt})
    RETURNING "id"`;
  return filas[0]!.id;
}
