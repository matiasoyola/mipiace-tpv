// F1 · la vía de corrección, del lado de la aplicación (ADR-018).
//
// La regla del bloque, calcada de S1: **ninguna ruta, worker ni script
// escribe `started_at` ni `ended_at` directamente.** Se llama a esto, que
// por debajo llama a `record_time_entry_correction(...)` en Postgres — la
// función que lee el valor anterior, deja la fila en
// `time_entry_corrections` y HACE el UPDATE, todo en la misma
// transacción. El trigger no abre la puerta de otra forma: sin fila de
// traza con el mismo `txid_current()`, el UPDATE revienta.
//
// Por qué la función vive en el motor y no aquí: porque lo que hace
// defendible el registro ante la Inspección no puede depender de que el
// código se porte bien. Una vía de corrección implementada en TypeScript
// sería otra vez disciplina de la aplicación.

import { Prisma } from "@mipiacetpv/db";

/** Las dos columnas corregibles. Coincide con el CHECK de la migración. */
export type CorrectableField = "started_at" | "ended_at";

export const CORRECTION_REASONS = ["OLVIDO", "ERROR_HORA", "OTRO"] as const;
export type CorrectionReason = (typeof CORRECTION_REASONS)[number];

export interface TimeCorrectionInput {
  entryId: string;
  field: CorrectableField;
  /** El valor nuevo. Nunca null: una hora no se corrige a vacío. */
  value: Date;
  reasonCode: CorrectionReason;
  /** Obligatorio sólo con `OTRO`. El motor también lo exige (CHECK). */
  reasonText?: string | null;
  /** Quién firma. `EMPLOYEE` exige `employeeId`; `PANEL`, `userId`. */
  authorKind: "EMPLOYEE" | "PANEL";
  /** Nombre legible, congelado en la traza. */
  author: string;
  employeeId?: string | null;
  userId?: string | null;
}

/** El motor rechazó la corrección. Se distingue de un fallo cualquiera
 *  para que las rutas respondan 400 con la frase, no 500. */
export class TimeCorrectionRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TimeCorrectionRejectedError";
  }
}

interface RawCapable {
  $queryRaw: <T = unknown>(
    query: TemplateStringsArray | Prisma.Sql,
    ...values: unknown[]
  ) => Promise<T>;
}

export async function recordTimeEntryCorrection(
  db: RawCapable,
  input: TimeCorrectionInput,
): Promise<string> {
  const reasonText = input.reasonText?.trim() ?? "";
  // El motor lo rechaza igual; esto evita el viaje y da la frase en el
  // idioma de la pantalla, que es la que el empleado va a leer.
  if (input.reasonCode === "OTRO" && reasonText === "") {
    throw new TimeCorrectionRejectedError(
      'Has elegido "Otro": di en una línea qué pasó.',
    );
  }
  try {
    const rows = await db.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT record_time_entry_correction(
        ${input.entryId}::uuid,
        ${input.field},
        ${input.value}::timestamptz,
        ${input.reasonCode},
        ${reasonText === "" ? null : reasonText},
        ${input.authorKind},
        ${input.author},
        ${input.employeeId ?? null}::uuid,
        ${input.userId ?? null}::uuid
      )::text AS id
    `);
    const id = rows[0]?.id;
    if (!id) throw new Error("record_time_entry_correction no devolvió id");
    return id;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/CORRECCION_|REGISTRO_VIOLADO|time_entries_ended_after_started/.test(message)) {
      throw new TimeCorrectionRejectedError(cleanPgMessage(message));
    }
    throw err;
  }
}

/** El mensaje del RAISE, sin el ruido que Prisma le cuelga alrededor. */
export function cleanPgMessage(raw: string): string {
  if (/time_entries_ended_after_started/.test(raw)) {
    return "La salida no puede ser anterior a la entrada.";
  }
  const m = raw.match(/(REGISTRO_VIOLADO|CORRECCION_[A-Z_]+):\s*([^\n]*)/);
  return m ? m[2]!.trim() : raw;
}

export interface TimeCorrectionRow {
  id: string;
  field: string;
  oldValue: string | null;
  newValue: string | null;
  reasonCode: string;
  reasonText: string | null;
  authorKind: string;
  author: string;
  createdAt: Date;
}

/** Las correcciones de un fichaje, la más antigua primero: se lee como
 *  una historia, no como un log. Sin esto la tabla no sirve para lo único
 *  que existe, que es que alguien la mire. */
export async function listTimeEntryCorrections(
  db: RawCapable,
  entryId: string,
): Promise<TimeCorrectionRow[]> {
  return db.$queryRaw<TimeCorrectionRow[]>(Prisma.sql`
    SELECT id::text      AS "id",
           field         AS "field",
           old_value     AS "oldValue",
           new_value     AS "newValue",
           reason_code::text AS "reasonCode",
           reason_text   AS "reasonText",
           author_kind::text AS "authorKind",
           author        AS "author",
           created_at    AS "createdAt"
      FROM time_entry_corrections
     WHERE time_entry_id = ${entryId}::uuid
     ORDER BY created_at ASC
  `);
}

/** Las correcciones de un periodo, para el export a la Inspección. */
export async function listTenantCorrections(
  db: RawCapable,
  args: { tenantId: string; from: Date; to: Date; employeeId?: string | null },
): Promise<Array<TimeCorrectionRow & { employeeName: string; entryStartedAt: Date }>> {
  const employeeFilter = args.employeeId
    ? Prisma.sql`AND te.employee_id = ${args.employeeId}::uuid`
    : Prisma.empty;
  return db.$queryRaw(Prisma.sql`
    SELECT c.id::text        AS "id",
           c.field           AS "field",
           c.old_value       AS "oldValue",
           c.new_value       AS "newValue",
           c.reason_code::text AS "reasonCode",
           c.reason_text     AS "reasonText",
           c.author_kind::text AS "authorKind",
           c.author          AS "author",
           c.created_at      AS "createdAt",
           e.name            AS "employeeName",
           te.started_at     AS "entryStartedAt"
      FROM time_entry_corrections c
      JOIN time_entries te ON te.id = c.time_entry_id
      JOIN employees   e  ON e.id  = te.employee_id
     WHERE c.tenant_id = ${args.tenantId}::uuid
       AND te.started_at >= ${args.from}
       AND te.started_at <  ${args.to}
       ${employeeFilter}
     ORDER BY c.created_at ASC
  `);
}
