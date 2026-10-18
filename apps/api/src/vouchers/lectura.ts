// B-reservas-8 · las LECTURAS del módulo: el bono, su libro y los bonos de
// una ficha.
//
// Separadas de la puerta a propósito: la puerta escribe y bloquea filas,
// esto sólo lee. Mezclarlas acaba en una lectura de pantalla que bloquea la
// fila de un bono mientras alguien mira la ficha.
//
// Las dos ponen al día la columna `status` de lo caducado
// (`marcarCaducados`) antes de leer. **No hay job**: la verdad es
// `expires_at` y la puerta la mira siempre, así que un bono caducado nunca
// se aparta ni se consume por mucho que su columna diga `ACTIVO`. Lo que
// esto consigue es que la ficha y los informes digan «caducado» sin que
// cada uno repita la comparación — y se hace donde ya se iba a leer, así
// que no añade una consulta a nadie.

import type { Prisma, PrismaClient } from "@mipiacetpv/db";

import { marcarCaducados } from "./gate.js";
import type { FilaDeBono, LineaLegible } from "./vistas.js";

const SELECT_BONO = `
  "id", "code", "client_id", "name_snapshot", "sessions_total",
  "sessions_left", "sessions_reserved", "valor_carta_cents", "cobrado_cents",
  "expires_at", "status", "origen", "es_prueba", "sold_ticket_id", "created_at"`;

interface FilaCruda {
  id: string;
  code: string;
  client_id: string;
  name_snapshot: string;
  sessions_total: number;
  sessions_left: number;
  sessions_reserved: number;
  valor_carta_cents: number;
  cobrado_cents: number;
  expires_at: Date | null;
  status: string;
  origen: string;
  es_prueba: boolean;
  sold_ticket_id: string | null;
  created_at: Date;
}

function aFila(f: FilaCruda): FilaDeBono {
  return {
    id: f.id,
    code: f.code,
    clientId: f.client_id,
    nameSnapshot: f.name_snapshot,
    sessionsTotal: Number(f.sessions_total),
    sessionsLeft: Number(f.sessions_left),
    sessionsReserved: Number(f.sessions_reserved),
    valorCartaCents: Number(f.valor_carta_cents),
    cobradoCents: Number(f.cobrado_cents),
    expiresAt: f.expires_at,
    status: f.status,
    origen: f.origen,
    esPrueba: f.es_prueba,
    soldTicketId: f.sold_ticket_id,
    createdAt: f.created_at,
  };
}

/** Los bonos de una ficha, los de prueba al final. Ordenados por número
 *  descendente: el último que se vendió es el que recepción busca. */
export async function bonosDeLaFicha(
  prisma: PrismaClient,
  tenantId: string,
  clientId: string,
  ahora: Date,
): Promise<FilaDeBono[]> {
  await marcarCaducados(prisma as unknown as Prisma.TransactionClient, tenantId, ahora);
  const filas = await prisma.$queryRawUnsafe<FilaCruda[]>(
    `SELECT ${SELECT_BONO}
       FROM "vouchers"
      WHERE "tenant_id" = $1::uuid AND "client_id" = $2::uuid
      ORDER BY "es_prueba" ASC, "number" DESC`,
    tenantId,
    clientId,
  );
  return filas.map(aFila);
}

/** Un bono por id. */
export async function bonoPorId(
  prisma: PrismaClient,
  tenantId: string,
  id: string,
  ahora: Date,
): Promise<FilaDeBono | null> {
  await marcarCaducados(prisma as unknown as Prisma.TransactionClient, tenantId, ahora);
  const filas = await prisma.$queryRawUnsafe<FilaCruda[]>(
    `SELECT ${SELECT_BONO}
       FROM "vouchers"
      WHERE "tenant_id" = $1::uuid AND "id" = $2::uuid
      LIMIT 1`,
    tenantId,
    id,
  );
  const f = filas[0];
  return f ? aFila(f) : null;
}

/**
 * LA TRAZA: el libro de un bono, legible.
 *
 * Qué cita apartó, qué ticket consumió, quién corrigió y por qué. Con el
 * NOMBRE de la persona y no su uuid: esto lo lee recepción, y un uuid en
 * una pantalla es una celda que nadie mira.
 */
export async function libroLegible(
  prisma: PrismaClient,
  tenantId: string,
  voucherId: string,
): Promise<LineaLegible[]> {
  const filas = await prisma.$queryRaw<
    Array<{
      id: string;
      tipo: string;
      sesiones: number;
      detalle: string;
      motivo: string | null;
      canal: string;
      actor: string | null;
      alias: string | null;
      email: string | null;
      appointment_id: string | null;
      ticket_line_id: string | null;
      compensa_a: string | null;
      es_prueba: boolean;
      created_at: Date;
    }>
  >`
    SELECT m."id", m."tipo", m."sesiones", m."detalle", m."motivo", m."canal",
           m."actor", u."alias" AS alias, u."email" AS email,
           m."appointment_id", m."ticket_line_id", m."compensa_a",
           m."es_prueba", m."created_at"
      FROM "voucher_movements" m
      LEFT JOIN "users" u ON u."id" = m."user_id"
     WHERE m."tenant_id" = ${tenantId}::uuid
       AND m."voucher_id" = ${voucherId}::uuid
     ORDER BY m."created_at" ASC, m."id" ASC`;
  return filas.map((f) => ({
    id: f.id,
    tipo: f.tipo,
    sesiones: Number(f.sesiones),
    detalle: f.detalle,
    motivo: f.motivo,
    canal: f.canal,
    // El ALIAS del cajero («María»), su email, o el actor del sistema.
    // Mismo orden de preferencia que el resto del TPV (v1.7-alias-cajeros:
    // el alias sustituye al email en todos los puntos de display). Nunca el
    // uuid: si no hay ninguno de los tres, se dice que no se sabe, que es
    // la verdad.
    quien: f.alias?.trim() || f.email || f.actor || "(no consta)",
    appointmentId: f.appointment_id,
    ticketLineId: f.ticket_line_id,
    compensaA: f.compensa_a,
    esPrueba: f.es_prueba,
    cuando: f.created_at.toISOString(),
  }));
}

/**
 * El libro de TODOS los bonos de una ficha, en una consulta.
 *
 * Es lo que rellena el `voucherMovements[]` que la ficha publica desde
 * B-reservas-1. Una consulta y no una por bono: una clienta del spa con
 * cuatro programas y treinta sesiones serían cuatro viajes por pantalla.
 */
export async function libroDeLaFicha(
  prisma: PrismaClient,
  tenantId: string,
  clientId: string,
): Promise<Array<LineaLegible & { voucherId: string; code: string }>> {
  const filas = await prisma.$queryRaw<
    Array<{
      id: string;
      voucher_id: string;
      code: string;
      tipo: string;
      sesiones: number;
      detalle: string;
      motivo: string | null;
      canal: string;
      actor: string | null;
      alias: string | null;
      email: string | null;
      appointment_id: string | null;
      ticket_line_id: string | null;
      compensa_a: string | null;
      es_prueba: boolean;
      created_at: Date;
    }>
  >`
    SELECT m."id", m."voucher_id", v."code", m."tipo", m."sesiones",
           m."detalle", m."motivo", m."canal", m."actor",
           u."alias" AS alias, u."email" AS email,
           m."appointment_id", m."ticket_line_id", m."compensa_a",
           m."es_prueba", m."created_at"
      FROM "voucher_movements" m
      JOIN "vouchers" v ON v."id" = m."voucher_id"
      LEFT JOIN "users" u ON u."id" = m."user_id"
     WHERE m."tenant_id" = ${tenantId}::uuid
       AND v."client_id" = ${clientId}::uuid
     ORDER BY m."created_at" DESC, m."id" DESC
     LIMIT 500`;
  return filas.map((f) => ({
    id: f.id,
    voucherId: f.voucher_id,
    code: f.code,
    tipo: f.tipo,
    sesiones: Number(f.sesiones),
    detalle: f.detalle,
    motivo: f.motivo,
    canal: f.canal,
    quien: f.alias?.trim() || f.email || f.actor || "(no consta)",
    appointmentId: f.appointment_id,
    ticketLineId: f.ticket_line_id,
    compensaA: f.compensa_a,
    esPrueba: f.es_prueba,
    cuando: f.created_at.toISOString(),
  }));
}
