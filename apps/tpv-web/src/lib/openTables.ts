// v1.22-el-terminal-del-bar · §5 (hallazgo B2, vivo desde el 02-09).
//
// Lo que pasó el 06-10 en La Maestranza: se cerró el día con la M4
// abierta y 55,00 € en sala, y no avisó NADIE — ni «Cerrar el día», ni
// el arqueo, ni el Z, ni la apertura del turno siguiente. El 02-09 había
// pasado igual con 19,60 €.
//
// El dato ya existía: la cabecera del mapa dice «N abiertas · M libres ·
// X,XX € en sala» desde la misma respuesta de `/tpv/tables`. Este módulo
// la saca de `TableMapScreen` para que el cierre y la apertura usen
// EXACTAMENTE la misma regla. Si el criterio de "abierta" cambiara en el
// mapa y no en el cierre, el aviso diría un número y la cabecera otro,
// que es peor que no avisar.
//
// Sin endpoint nuevo y sin cálculo nuevo en servidor: es el requisito
// del bloque.
//
// AVISA, NO BLOQUEA. `docs/normas/cierre-caja-diario.md` está a punto de
// cambiar el modelo de cierre (día de negocio, cierre automático), así
// que aquí no se mete ninguna regla de bloqueo ni de traspaso de mesas
// que luego haya que deshacer.

export interface OpenTableLike {
  id: string;
  name: string;
  state: "FREE" | "OPEN" | "BILLING";
  groupedIntoTableId: string | null;
  activeTicket: { total: string | number } | null;
}

export interface OpenTableRow {
  id: string;
  name: string;
  total: number;
}

export interface OpenTablesSummary {
  /** Mesas abiertas, en el orden en que las devuelve el servidor. */
  rows: OpenTableRow[];
  /** Cuántas. Puede ser mayor que `rows.length` si alguna no tiene DRAFT. */
  count: number;
  /** Lo que suman los DRAFT vivos. */
  total: number;
}

/**
 * "Abierta" = no libre y no absorbida por otra mesa (una mesa unida a su
 * principal no cuenta aparte: su importe ya va en la principal). Es la
 * regla literal de la cabecera del mapa.
 *
 * "€ en sala" = la suma de los totales de los DRAFT visibles, con la
 * misma condición de no-absorbida.
 */
export function summarizeOpenTables(
  tables: readonly OpenTableLike[],
): OpenTablesSummary {
  const abiertas = tables.filter(
    (t) => t.state !== "FREE" && !t.groupedIntoTableId,
  );
  const rows: OpenTableRow[] = abiertas.map((t) => ({
    id: t.id,
    name: t.name,
    total: t.activeTicket ? Number(t.activeTicket.total) : 0,
  }));
  // Céntimos para no sumar flotantes: el aviso enseña el importe y una
  // mesa de 55,00 no puede salir como 54,999999.
  const cents = rows.reduce((sum, r) => sum + Math.round(r.total * 100), 0);
  return { rows, count: abiertas.length, total: cents / 100 };
}

/**
 * Pregunta por las mesas abiertas. Best-effort a propósito: un fallo de
 * red no puede impedir cerrar el turno ni abrirlo (ver
 * [[cobrar-siempre-se-puede]]: una invariante rota nunca tumba una
 * operación de caja). Devuelve `null` cuando no se sabe, que el llamante
 * distingue de "no hay ninguna".
 */
export async function fetchOpenTables(): Promise<OpenTablesSummary | null> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return null;
  }
  try {
    const { apiWithCashier } = await import("../api.js");
    const res = await apiWithCashier<{ tables: OpenTableLike[] }>("/tpv/tables");
    return summarizeOpenTables(res.tables ?? []);
  } catch {
    return null;
  }
}
