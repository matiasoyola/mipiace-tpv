// S1-sello · La lista de columnas económicas vive AQUÍ y en ningún otro
// sitio.
//
// Tres consumidores leen de este módulo:
//
//   1. `apps/api/src/tickets/seal.ts` — construye el payload que se
//      hashea al cobrar.
//   2. La migración `s1_sello_de_la_venta` — el cuerpo del trigger de
//      Postgres se GENERA desde aquí (`buildSealedGuardSql`) y el test
//      `sello-lista-columnas.test.ts` compara el fichero .sql commiteado
//      con lo que genera este módulo: si alguien toca la lista y no
//      regenera la migración, el test se pone rojo.
//   3. `sello-lista-columnas.test.ts` — comprueba además que NINGUNA
//      columna de importe del `schema.prisma` se queda fuera sin una
//      excusa escrita (`NOT_SEALED_MONEY_COLUMNS`).
//
// Por qué nombres de columna SQL y no campos Prisma: el trigger vive en
// el motor y el motor no sabe de camelCase. El mapeo a campo Prisma está
// en `PRISMA_FIELD_BY_COLUMN` para que el constructor del payload no
// tenga que adivinarlo.

/** Escala decimal de cada columna monetaria, tal cual la declara el
 *  esquema. El payload del sello formatea con ESTA escala: `12.3` y
 *  `12.3000` tienen que producir el mismo hash o el sello no vale.
 *
 *  No todas las columnas selladas son importes (`shift_id`, `sku`,
 *  `paid_at`…): aquí sólo están las que sí. */
export const SEALED_DECIMAL_SCALE: Readonly<Record<string, number>> = {
  // tickets
  total: 4,
  total_tax: 4,
  total_discount: 4,
  cash_amount: 4,
  // ticket_lines
  units: 3,
  unit_price: 4,
  unit_price_override: 4,
  discount_pct: 2,
  tax_rate: 2,
  subtotal: 4,
  // ticket_payments
  amount: 4,
};

/**
 * Las columnas que el sello cubre, por tabla.
 *
 * `tickets` es la única lista que el trigger consulta columna a columna:
 * la fila del ticket sigue viva después del cobro (status, syncedAt, los
 * tres de Holded…) y hay que dejar pasar lo operativo. En `ticket_lines`
 * y `ticket_payments` el trigger es más duro que esta lista —bloquea
 * CUALQUIER columna— porque esas dos filas no tienen vida operativa: una
 * vez cobradas no se tocan nunca. La lista sigue existiendo para ellas
 * porque es la que entra en el hash.
 */
export const SEALED_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  tickets: [
    "internal_number",
    // El turno al que se imputa la venta. Es económico aunque no sea un
    // importe: `loadShiftBreakdownSums` agrupa los pagos por
    // `ticket: { shiftId }`, así que mover un ticket de turno mueve la
    // venta entera de un Z a otro. Dejarlo fuera sería incoherente con
    // `ticket_payments.collected_in_shift_id`, que sí está sellado.
    //
    // No estorba a nadie: la imputación (`shift/impute.ts`) decide el
    // turno ANTES de crear el ticket, y no hay un solo `ticket.update`
    // en el repo que escriba esta columna.
    "shift_id",
    "total",
    "total_tax",
    "total_discount",
    "cash_amount",
    "paid_at",
  ],
  ticket_lines: [
    "product_id",
    "variant_id",
    "holded_product_id",
    "sku",
    "name_snapshot",
    "units",
    "unit_price",
    "unit_price_override",
    "discount_pct",
    "tax_rate",
    "subtotal",
    "total",
    "modifiers",
  ],
  ticket_payments: [
    "method",
    "amount",
    "meta",
    "external_id",
    "collected_in_shift_id",
  ],
};

/** Campo Prisma ← columna SQL, sólo para las columnas selladas. */
export const PRISMA_FIELD_BY_COLUMN: Readonly<Record<string, string>> = {
  internal_number: "internalNumber",
  shift_id: "shiftId",
  total: "total",
  total_tax: "totalTax",
  total_discount: "totalDiscount",
  cash_amount: "cashAmount",
  paid_at: "paidAt",
  product_id: "productId",
  variant_id: "variantId",
  holded_product_id: "holdedProductId",
  sku: "sku",
  name_snapshot: "nameSnapshot",
  units: "units",
  unit_price: "unitPrice",
  unit_price_override: "unitPriceOverride",
  discount_pct: "discountPct",
  tax_rate: "taxRate",
  subtotal: "subtotal",
  modifiers: "modifiers",
  method: "method",
  amount: "amount",
  meta: "meta",
  external_id: "externalId",
  collected_in_shift_id: "collectedInShiftId",
};

/**
 * Columnas DECIMAL de las tres tablas económicas que NO entran en el
 * sello, con el motivo escrito. El test de completitud sólo perdona una
 * columna de importe si está aquí: olvidarse de una da rojo, sacarla a
 * propósito obliga a escribir por qué.
 */
export const NOT_SEALED_MONEY_COLUMNS: Readonly<Record<string, string>> = {
  "tickets.credit_pending":
    "ADR-015 §5.1 · campo derivado que baja con cada cobro de deuda. La verdad son los TicketPayment, que se crean como filas nuevas.",
};

/** Tablas que el trigger vigila, en el orden en que se crean. */
export const SEALED_TABLES = ["tickets", "ticket_lines", "ticket_payments"] as const;

/** Columnas que nunca se corrigen: la identidad de la fila. */
export const NEVER_CORRECTABLE_COLUMNS = ["id", "ticket_id", "tenant_id"] as const;

function sqlArray(values: readonly string[]): string {
  return `ARRAY[${values.map((v) => `'${v}'`).join(", ")}]`;
}

/**
 * El fragmento de la migración que depende de la lista. Se genera aquí y
 * se pega tal cual entre los marcadores del `migration.sql`; el test lo
 * compara byte a byte.
 */
export function buildSealedGuardSql(): string {
  return [
    "-- ── GENERADO desde packages/db/src/sealed-fields.ts ─────────────────",
    "-- No editar a mano: `sello-lista-columnas.test.ts` compara este bloque",
    "-- con buildSealedGuardSql() y se pone rojo si difieren.",
    "CREATE OR REPLACE FUNCTION mipiacetpv_sealed_columns(p_table text)",
    "RETURNS text[]",
    "LANGUAGE sql IMMUTABLE AS $fn$",
    "  SELECT CASE p_table",
    ...SEALED_TABLES.map(
      (t) => `    WHEN '${t}' THEN ${sqlArray(SEALED_COLUMNS[t]!)}::text[]`,
    ),
    "    ELSE ARRAY[]::text[]",
    "  END;",
    "$fn$;",
    "-- ── FIN GENERADO ───────────────────────────────────────────────────",
  ].join("\n");
}
