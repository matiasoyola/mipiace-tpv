// S1-sello · la vía de corrección, del lado de la aplicación.
//
// La regla del bloque: **ninguna ruta, worker ni script escribe una
// columna sellada directamente.** Se llama a esto, que por debajo llama a
// `record_ticket_correction(...)` en Postgres — la función que lee el
// valor anterior, deja la fila en `ticket_corrections` y HACE el UPDATE,
// todo en la misma transacción. El trigger no abre la puerta de otra
// forma: sin fila de traza con el mismo `txid_current()`, el UPDATE
// revienta.
//
// Por qué la función vive en el motor y no aquí: porque el agujero que
// cierra este bloque es precisamente que la aplicación no es la única
// puerta a la base de datos. Una vía de corrección implementada en
// TypeScript sería otra vez disciplina de la aplicación.

import { Prisma } from "@mipiacetpv/db";

/** Las tres tablas económicas. Coincide con el CHECK de la migración. */
export type CorrectableTable = "tickets" | "ticket_lines" | "ticket_payments";

export interface CorrectionInput {
  table: CorrectableTable;
  rowId: string;
  field: string;
  /** El valor nuevo en texto. `null` escribe NULL en la columna. */
  newValue: string | null;
  /** Obligatorio y en texto libre. El motor rechaza el blanco. */
  reason: string;
  /** Etiqueta legible de quién corrige. Para lo que no es una persona,
   *  el convenio es `script:<nombre>` (ver `backfill-vuelta.ts`). */
  author: string;
  /** Usuario del tenant, cuando lo hay. */
  userId?: string | null;
}

/** Lo que devuelve el error del motor cuando se intenta corregir mal.
 *  Se distingue de un fallo cualquiera para que las rutas puedan
 *  responder 400 en vez de 500. */
export class CorrectionRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CorrectionRejectedError";
  }
}

interface RawCapable {
  $queryRaw: <T = unknown>(
    query: TemplateStringsArray | Prisma.Sql,
    ...values: unknown[]
  ) => Promise<T>;
}

/**
 * Escribe la corrección y aplica el cambio. Devuelve el id de la fila de
 * traza.
 *
 * Funciona igual con el cliente y con una `$transaction`: cuando se pasa
 * una tx, la traza y el resto del trabajo de esa tx comparten destino.
 */
export async function recordTicketCorrection(
  db: RawCapable,
  input: CorrectionInput,
): Promise<string> {
  const reason = input.reason?.trim() ?? "";
  if (reason === "") {
    // El motor también lo rechaza (CHECK + RAISE); esto sólo evita el
    // viaje y da un mensaje en el idioma de la ruta.
    throw new CorrectionRejectedError(
      "Una corrección necesita un motivo. Escribe por qué se cambia el dato.",
    );
  }
  try {
    const rows = await db.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT record_ticket_correction(
        ${input.table},
        ${input.rowId}::uuid,
        ${input.field},
        ${input.newValue},
        ${reason},
        ${input.author},
        ${input.userId ?? null}::uuid
      )::text AS id
    `);
    const id = rows[0]?.id;
    if (!id) throw new Error("record_ticket_correction no devolvió id");
    return id;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/CORRECCION_|SELLO_VIOLADO/.test(message)) {
      throw new CorrectionRejectedError(cleanPgMessage(message));
    }
    throw err;
  }
}

/** El mensaje del RAISE, sin el ruido que Prisma le cuelga alrededor. */
export function cleanPgMessage(raw: string): string {
  const m = raw.match(/(SELLO_VIOLADO|CORRECCION_[A-Z_]+):\s*([^\n]*)/);
  return m ? `${m[1]}: ${m[2]!.trim()}` : raw;
}

export interface CorrectionRow {
  id: string;
  tableName: string;
  rowId: string;
  field: string;
  oldValue: string | null;
  newValue: string | null;
  reason: string;
  author: string;
  userId: string | null;
  createdAt: Date;
}

/** Las correcciones de un ticket, la más reciente primero. Sin esto la
 *  tabla no sirve para lo único que existe: que alguien la mire. */
export async function listTicketCorrections(
  db: RawCapable,
  ticketId: string,
): Promise<CorrectionRow[]> {
  return db.$queryRaw<CorrectionRow[]>(Prisma.sql`
    SELECT id::text        AS "id",
           table_name      AS "tableName",
           row_id::text    AS "rowId",
           field           AS "field",
           old_value       AS "oldValue",
           new_value       AS "newValue",
           reason          AS "reason",
           author          AS "author",
           user_id::text   AS "userId",
           created_at      AS "createdAt"
      FROM ticket_corrections
     WHERE ticket_id = ${ticketId}::uuid
     ORDER BY created_at DESC, id DESC
  `);
}
