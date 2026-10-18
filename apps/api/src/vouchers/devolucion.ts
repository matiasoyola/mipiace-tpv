// B-reservas-8 · devolver la venta de un bono.
//
// La regla, de la decisión de Dirección del 18-10: **se devuelve sólo si no
// se ha tocado ninguna sesión.** Una sesión consumida es un trabajo hecho y
// una sesión apartada es una cita dada; devolver el dinero entero en
// cualquiera de los dos casos es regalar trabajo.
//
// Y va por el **camino de devoluciones de siempre**: no hay un botón
// «anular bono» en ningún sitio. Se devuelve la línea del ticket que lo
// vendió, y el bono queda `ANULADO` en el mismo paso y en la misma
// transacción. Si el bono se pudiera anular por su cuenta, habría un bono
// anulado con su dinero cobrado y nadie sabría por qué.
//
// El «por qué no» lo contesta `porQueNoDevolvible()` de `@mipiacetpv/bonos`,
// **la misma función que usa el botón del TPV**. Si el botón decidiera por
// su cuenta aparecería el caso de siempre: el TPV deja pulsar, el servidor
// contesta 409, y la cajera se queda mirando un mensaje que no esperaba
// después de haberla paseado por todo el modal.

import { porQueNoDevolvible, type NoDevolvible } from "@mipiacetpv/bonos";
import type { Prisma } from "@mipiacetpv/db";

import { escribirLinea } from "./libro.js";

export interface BonoDeUnaLinea {
  id: string;
  code: string;
  status: string;
  sesionesConsumidas: number;
  sesionesApartadas: number;
  sesionesLibres: number;
  tieneVenta: boolean;
  esPrueba: boolean;
}

/**
 * Los bonos que nacieron de estas líneas de ticket, con lo que hace falta
 * para decidir si se pueden devolver.
 *
 * Las sesiones consumidas y apartadas se cuentan **del libro** y no de las
 * columnas de caché: es la decisión de la que depende si se devuelve
 * dinero, y en esa no manda la caché.
 */
export async function bonosDeLasLineas(
  tx: Prisma.TransactionClient,
  tenantId: string,
  ticketLineIds: string[],
): Promise<BonoDeUnaLinea[]> {
  if (ticketLineIds.length === 0) return [];
  const filas = await tx.$queryRaw<
    Array<{
      id: string;
      code: string;
      status: string;
      sessions_left: number;
      sold_ticket_id: string | null;
      es_prueba: boolean;
      consumidas: bigint;
      apartadas: bigint;
    }>
  >`
    SELECT v."id",
           v."code",
           v."status",
           v."sessions_left",
           v."sold_ticket_id",
           v."es_prueba",
           COALESCE(SUM(CASE WHEN m."tipo" = 'CONSUMIDA' THEN 1 ELSE 0 END), 0) AS consumidas,
           COALESCE(SUM(
             CASE m."tipo"
               WHEN 'APARTADA'  THEN 1
               WHEN 'LIBERADA'  THEN -1
               WHEN 'CONSUMIDA' THEN (CASE WHEN m."appointment_id" IS NOT NULL THEN -1 ELSE 0 END)
               ELSE 0
             END), 0) AS apartadas
      FROM "vouchers" v
      LEFT JOIN "voucher_movements" m ON m."voucher_id" = v."id"
     WHERE v."tenant_id" = ${tenantId}::uuid
       AND v."sold_ticket_line_id" = ANY(${ticketLineIds}::uuid[])
     GROUP BY v."id"
     FOR UPDATE OF v`;
  return filas.map((f) => ({
    id: f.id,
    code: f.code,
    status: f.status,
    sesionesConsumidas: Number(f.consumidas),
    sesionesApartadas: Number(f.apartadas),
    sesionesLibres: Number(f.sessions_left),
    tieneVenta: f.sold_ticket_id != null,
    esPrueba: f.es_prueba,
  }));
}

/** El primer «no» de la lista, o `null` si todos se pueden devolver. Con el
 *  código del bono delante, que es lo que la cajera tiene en la mano. */
export function primerRechazo(
  bonos: BonoDeUnaLinea[],
): (NoDevolvible & { code: string }) | null {
  for (const b of bonos) {
    const no = porQueNoDevolvible(b);
    if (no) return { ...no, code: b.code, mensaje: `${b.code}: ${no.mensaje}` };
  }
  return null;
}

/**
 * Anula los bonos de estas líneas, en la transacción de la devolución.
 *
 * El `ANULADO` del libro se lleva las sesiones LIBRES a cero —y como no
 * puede haber consumidas ni apartadas (lo acaba de comprobar
 * `primerRechazo`), eso deja el total a cero, que es la verdad: el centro
 * ya no debe nada.
 */
export async function anularLosBonos(
  tx: Prisma.TransactionClient,
  input: {
    tenantId: string;
    bonos: BonoDeUnaLinea[];
    refundInternalNumber: string;
    userId: string | null;
    ahora: Date;
  },
): Promise<string[]> {
  const anulados: string[] = [];
  for (const b of input.bonos) {
    await tx.$executeRaw`
      UPDATE "vouchers"
         SET "status" = 'ANULADO',
             "sessions_left" = 0,
             "updated_at" = ${input.ahora}
       WHERE "id" = ${b.id}::uuid
         AND "tenant_id" = ${input.tenantId}::uuid`;
    await escribirLinea(tx, {
      tenantId: input.tenantId,
      voucherId: b.id,
      tipo: "ANULADO",
      sesiones: -b.sesionesLibres,
      detalle: `Anulado al devolver su venta (abono ${input.refundInternalNumber}).`,
      canal: "tpv",
      userId: input.userId,
      actor: input.userId == null ? "Migración" : null,
      esPrueba: b.esPrueba,
      createdAt: input.ahora,
    });
    anulados.push(b.code);
  }
  return anulados;
}
