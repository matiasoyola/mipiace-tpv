// v1.0-pilotos · Lote 3 (#28): desglose del arqueo Z por método de
// pago. Función pura — la consumen el cierre de turno (Z PDF), el
// arqueo X y el frontend vía la respuesta de /shift/:id/cash-count.
//
// Por método: ventas brutas (Σ TicketPayment.amount del turno),
// devoluciones (Σ Refund.total del turno por Refund.method) y neto.
// El teórico de caja = fondo inicial + neto CASH (las devoluciones en
// efectivo SALEN del cajón — antes no se restaban y el descuadre
// culpaba al cajero).

// Orden canónico de presentación. Cualquier método extra que aparezca
// en BD (enum nuevo) se añade al final por orden alfabético.
const METHOD_ORDER = ["CASH", "CARD", "BIZUM", "VOUCHER", "OTHER"] as const;

export interface ZMethodRow {
  method: string;
  gross: number;
  refunds: number;
  net: number;
  // Importe contado/declarado por el cajero, si lo reportó (CASH
  // siempre; el resto sólo en el flujo legacy /shift/:id/close).
  counted?: number;
}

// v1.8-Fiado · una fila de "Cobros de deuda": importe cobrado por método
// en ESTE turno de fiados vendidos (quizá en otro día). No lleva la
// dimensión devoluciones — un cobro de deuda no se devuelve por aquí.
export interface ZCreditCollectionRow {
  method: string;
  amount: number;
}

export interface ZBreakdown {
  methods: ZMethodRow[];
  grossSales: number;
  refundsTotal: number;
  netSales: number;
  // fondo inicial + neto CASH (ventas) + efectivo de cobros de deuda de
  // este turno. El descuadre del cierre = contado − esto.
  cashTheoretical: number;
  // v1.8-Fiado · sección "Ventas a crédito (no cobradas)": fiados
  // vendidos en este turno. NO suman a caja (no entró dinero).
  creditSales: { count: number; total: number };
  // v1.8-Fiado · sección "Cobros de deuda": ingresos de fiados cobrados
  // en este turno (imputados por collectedInShiftId). SÍ suman a caja.
  creditCollections: ZCreditCollectionRow[];
  creditCollectionsTotal: number;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function computeZBreakdown(input: {
  cashOpening: number;
  paymentsByMethod: Record<string, number>;
  refundsByMethod: Record<string, number>;
  counted?: Partial<Record<string, number>>;
  // v1.8-Fiado · cobros de deuda de este turno por método (imputados por
  // collectedInShiftId) y fiados vendidos en este turno (no cobrados).
  creditCollectionsByMethod?: Record<string, number>;
  creditSales?: { count: number; total: number };
}): ZBreakdown {
  const methods = new Set<string>([
    ...Object.keys(input.paymentsByMethod),
    ...Object.keys(input.refundsByMethod),
  ]);
  // CASH y CARD se muestran siempre aunque estén a 0 — son los que el
  // cajero espera ver en el Z de un bar/tienda.
  methods.add("CASH");
  methods.add("CARD");

  const ordered = [...methods].sort((a, b) => {
    const ia = METHOD_ORDER.indexOf(a as (typeof METHOD_ORDER)[number]);
    const ib = METHOD_ORDER.indexOf(b as (typeof METHOD_ORDER)[number]);
    if (ia !== -1 && ib !== -1) return ia - ib;
    if (ia !== -1) return -1;
    if (ib !== -1) return 1;
    return a.localeCompare(b);
  });

  const rows: ZMethodRow[] = ordered.map((method) => {
    const gross = round2(input.paymentsByMethod[method] ?? 0);
    const refunds = round2(input.refundsByMethod[method] ?? 0);
    const counted = input.counted?.[method];
    return {
      method,
      gross,
      refunds,
      net: round2(gross - refunds),
      ...(counted != null ? { counted } : {}),
    };
  });

  const grossSales = round2(rows.reduce((acc, r) => acc + r.gross, 0));
  const refundsTotal = round2(rows.reduce((acc, r) => acc + r.refunds, 0));
  const cashNet = rows.find((r) => r.method === "CASH")?.net ?? 0;

  // v1.8-Fiado · cobros de deuda por método (orden canónico). El efectivo
  // cobrado SÍ entra al cajón → suma al teórico. El resto de métodos
  // aparece en su sección propia pero no afecta al teórico de CASH.
  const collections = input.creditCollectionsByMethod ?? {};
  const creditCollections: ZCreditCollectionRow[] = Object.keys(collections)
    .filter((m) => round2(collections[m] ?? 0) !== 0)
    .sort((a, b) => {
      const ia = METHOD_ORDER.indexOf(a as (typeof METHOD_ORDER)[number]);
      const ib = METHOD_ORDER.indexOf(b as (typeof METHOD_ORDER)[number]);
      if (ia !== -1 && ib !== -1) return ia - ib;
      if (ia !== -1) return -1;
      if (ib !== -1) return 1;
      return a.localeCompare(b);
    })
    .map((method) => ({ method, amount: round2(collections[method] ?? 0) }));
  const creditCollectionsTotal = round2(
    creditCollections.reduce((acc, r) => acc + r.amount, 0),
  );
  const creditCashCollected = round2(collections.CASH ?? 0);

  return {
    methods: rows,
    grossSales,
    refundsTotal,
    netSales: round2(grossSales - refundsTotal),
    cashTheoretical: round2(input.cashOpening + cashNet + creditCashCollected),
    creditSales: input.creditSales ?? { count: 0, total: 0 },
    creditCollections,
    creditCollectionsTotal,
  };
}
