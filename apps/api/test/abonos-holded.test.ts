// Bloque abonos-holded · un abono llega a Holded con su importe, o no llega.
//
// Los seis puntos de la tabla de sabotaje del bloque, en orden:
//
//   1. abono de un SERVICIO → la línea lleva `serviceId`
//   2. abono de un PRODUCTO con SKU AUTO-* → la línea lleva `sku`
//   3. venta y abono de la MISMA línea (override + modificadores) →
//      mismo precio y misma línea salvo el signo
//   4. `silent_reject` tras un POST que sí creó documento → el
//      `holdedDocumentId` queda guardado
//   5. reintentar un abono con documento guardado → cero POST nuevos
//   6. las seis devoluciones reales de Peluquería Sole del 10-09-2026
//
// Y el punto que ningún criterio pedía pero que el ensayo contra Holded
// destapó: el precio unitario que Holded lee es `subtotal`, no `price`.

import { randomBytes, randomUUID } from "node:crypto";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.REDIS_URL = "redis://localhost:6379";
process.env.JWT_ACCESS_SECRET = "a".repeat(40);
process.env.JWT_REFRESH_SECRET = "b".repeat(40);
process.env.HOLDED_KEY_ENCRYPTION_SECRET = randomBytes(32).toString("base64");

import { beforeEach, describe, expect, it, vi } from "vitest";

import { encryptSecret } from "../src/crypto.js";

// ── Fake Prisma (mismo patrón que upload-ticket.test.ts) ──────────────

interface FakeRefund {
  id: string;
  externalId: string;
  tenantId: string;
  status: string;
  total: number;
  method: string | null;
  createdAt: Date;
  holdedDocumentId: string | null;
  holdedDocNumber: string | null;
  syncedAt: Date | null;
  syncError: unknown;
  lines: FakeRefundLine[];
}
interface FakeRefundLine {
  nameSnapshot: string;
  sku: string;
  units: number;
  unitPrice: number;
  taxRate: number;
  discountPct: number;
  ticketLine: {
    unitPrice: number;
    unitPriceOverride: number | null;
    modifiers: unknown;
    product: { kind: "PRODUCT" | "SERVICE"; holdedProductId: string | null } | null;
  };
}
interface FakeUpload {
  externalId: string;
  status: string;
  attempts: number;
  holdedDocumentId: string | null;
  lastError: unknown;
}

const refunds = new Map<string, FakeRefund>();
const uploads = new Map<string, FakeUpload>();
let tenantKey = "";

const dec = (n: number) => ({ toString: () => String(n) }) as never;

const fakePrisma = {
  refund: {
    findUnique: vi.fn(async ({ where }: any) => {
      const r = refunds.get(where.externalId);
      if (!r) return null;
      return {
        ...r,
        total: dec(r.total),
        lines: r.lines.map((l) => ({
          nameSnapshot: l.nameSnapshot,
          sku: l.sku,
          units: dec(l.units),
          unitPrice: dec(l.unitPrice),
          taxRate: dec(l.taxRate),
          discountPct: dec(l.discountPct),
          ticketLine: {
            unitPrice: dec(l.ticketLine.unitPrice),
            unitPriceOverride:
              l.ticketLine.unitPriceOverride == null
                ? null
                : dec(l.ticketLine.unitPriceOverride),
            modifiers: l.ticketLine.modifiers,
            product: l.ticketLine.product,
          },
        })),
        originalTicket: {
          id: "ticket-1",
          holdedDocumentId: "doc-original",
          holdedDocNumber: "T260900",
        },
        tenant: { id: r.tenantId, holdedApiKeyCiphertext: tenantKey },
        register: { numSerieHolded: null },
      };
    }),
    update: vi.fn(async ({ where, data }: any) => {
      const r = refunds.get(where.externalId);
      if (!r) throw new Error("not found");
      Object.assign(r, data);
      return r;
    }),
  },
  holdedUpload: {
    update: vi.fn(async ({ where, data }: any) => {
      const u = uploads.get(where.externalId);
      if (!u) throw new Error("not found");
      Object.assign(u, data);
      return u;
    }),
    updateMany: vi.fn(async ({ where, data }: any) => {
      const u = uploads.get(where.externalId);
      if (!u) return { count: 0 };
      if (data.attempts?.increment != null) u.attempts += data.attempts.increment;
      if (data.status != null) u.status = data.status;
      if (data.lastError !== undefined) u.lastError = data.lastError;
      if (data.holdedDocumentId !== undefined) u.holdedDocumentId = data.holdedDocumentId;
      return { count: 1 };
    }),
  },
  $transaction: vi.fn(async (ops: any[]) =>
    Promise.all(ops.map((p) => (typeof p === "function" ? p(fakePrisma) : p))),
  ),
} as const;

vi.mock("../src/context.js", () => ({
  getPrisma: () => fakePrisma,
  getRedis: () => ({}),
  shutdown: async () => undefined,
}));

import { ApiKeyClient } from "@mipiacetpv/holded-client";

import {
  buildHoldedLineItem,
  REFUND_SIGN,
  SALE_SIGN,
  type HoldedLineSnapshot,
} from "../src/tickets/holded-line.js";
import {
  buildRefundSalesreceiptPayload,
  uploadRefund,
} from "../src/tickets/upload-refund.js";
import { buildTicketSalesreceiptPayload } from "../src/tickets/upload-ticket.js";

beforeEach(() => {
  refunds.clear();
  uploads.clear();
  vi.clearAllMocks();
  tenantKey = encryptSecret("test-api-key", process.env.HOLDED_KEY_ENCRYPTION_SECRET!);
});

// ── Helpers de fixtures ───────────────────────────────────────────────

const SERVICE_LINE: FakeRefundLine = {
  nameSnapshot: "CHAMPU TRATAMIENTO",
  sku: "AUTO-67d737a6e4",
  units: 1,
  unitPrice: 2.4793,
  taxRate: 21,
  discountPct: 0,
  ticketLine: {
    unitPrice: 2.4793,
    unitPriceOverride: null,
    modifiers: null,
    product: { kind: "SERVICE", holdedProductId: "67d737a6e40a87be3b0a4858" },
  },
};

const PRODUCT_LINE: FakeRefundLine = {
  nameSnapshot: "SPRAY Nº2 SALERM 250ml",
  sku: "AUTO-6819ba02",
  units: 1,
  unitPrice: 8.18,
  taxRate: 21,
  discountPct: 0,
  ticketLine: {
    unitPrice: 8.18,
    unitPriceOverride: null,
    modifiers: null,
    product: { kind: "PRODUCT", holdedProductId: "6819ba02f51229758b009fd0" },
  },
};

function refundFixture(lines: FakeRefundLine[], total: number, externalId: string) {
  return {
    externalId,
    createdAt: new Date("2026-09-10T11:05:00Z"),
    total: dec(total),
    lines: lines.map((l) => ({
      nameSnapshot: l.nameSnapshot,
      sku: l.sku,
      units: dec(l.units),
      unitPrice: dec(l.unitPrice),
      taxRate: dec(l.taxRate),
      discountPct: dec(l.discountPct),
      ticketLine: {
        unitPrice: dec(l.ticketLine.unitPrice),
        unitPriceOverride:
          l.ticketLine.unitPriceOverride == null
            ? null
            : dec(l.ticketLine.unitPriceOverride),
        modifiers: l.ticketLine.modifiers,
        product: l.ticketLine.product,
      },
    })),
    originalTicket: { holdedDocumentId: "doc-original", holdedDocNumber: "T260900" },
    register: { numSerieHolded: null },
  };
}

function seedRefund(
  externalId: string,
  lines: FakeRefundLine[],
  total: number,
  overrides: Partial<FakeRefund> = {},
): void {
  refunds.set(externalId, {
    id: "refund-1",
    externalId,
    tenantId: "tenant-1",
    status: "PENDING_SYNC",
    total,
    method: "CASH",
    createdAt: new Date("2026-09-10T11:05:00Z"),
    holdedDocumentId: null,
    holdedDocNumber: null,
    syncedAt: null,
    syncError: null,
    lines,
    ...overrides,
  });
  uploads.set(externalId, {
    externalId,
    status: "PENDING",
    attempts: 0,
    holdedDocumentId: null,
    lastError: null,
  });
}

interface RecordedCall {
  path: string;
  method: string;
}

function mockHoldedClient(responses: unknown[]): {
  client: ApiKeyClient;
  calls: RecordedCall[];
} {
  const queue = [...responses];
  const calls: RecordedCall[] = [];
  const client = {
    request: vi.fn(async (path: string, init?: { method?: string }) => {
      calls.push({ path, method: (init?.method ?? "GET").toUpperCase() });
      if (queue.length === 0) throw new Error(`client exhausted on ${path}`);
      const next = queue.shift();
      if (next instanceof Error) throw next;
      return next;
    }),
  } as unknown as ApiKeyClient;
  return { client, calls };
}

// El POST que CREA un documento nuevo: colección, sin id detrás.
function creationPosts(calls: RecordedCall[]): RecordedCall[] {
  return calls.filter(
    (c) => c.method === "POST" && c.path === "/invoicing/v1/documents/salesreceipt",
  );
}

// ── 1 y 2 · el identificador de la línea del abono ────────────────────

describe("1 y 2 · identificador de la línea en el abono", () => {
  it("SERVICIO → la línea lleva serviceId y nunca sku", () => {
    const payload = buildRefundSalesreceiptPayload(
      refundFixture([SERVICE_LINE], 3, randomUUID()),
    );
    expect(payload.items[0]).toMatchObject({
      serviceId: "67d737a6e40a87be3b0a4858",
    });
    expect(payload.items[0]).not.toHaveProperty("sku");
  });

  it("PRODUCTO con SKU AUTO-* → la línea lleva ese sku", () => {
    const payload = buildRefundSalesreceiptPayload(
      refundFixture([PRODUCT_LINE], 9.9, randomUUID()),
    );
    expect(payload.items[0]).toMatchObject({ sku: "AUTO-6819ba02" });
    expect(payload.items[0]).not.toHaveProperty("serviceId");
  });

  it("el precio unitario viaja en `subtotal` (es el campo que Holded lee)", () => {
    // Probe K/S del 26-09-2026 contra PRUEBAS MIPIACE: sin `subtotal`,
    // Holded pone el precio del catálogo o 0. Con `subtotal`, el nuestro.
    const payload = buildRefundSalesreceiptPayload(
      refundFixture([SERVICE_LINE], 3, randomUUID()),
    );
    expect(payload.items[0]!.subtotal).toBe(2.4793);
    expect(payload.items[0]!.price).toBe(2.4793);
  });

  it("las unidades del abono van en negativo y el precio en positivo", () => {
    const payload = buildRefundSalesreceiptPayload(
      refundFixture([{ ...SERVICE_LINE, units: 2 }], 6, randomUUID()),
    );
    expect(payload.items[0]!.units).toBe(-2);
    expect(payload.items[0]!.subtotal).toBeGreaterThan(0);
  });
});

// ── 3 · venta y abono, la misma línea ─────────────────────────────────

describe("3 · la venta y el abono construyen la MISMA línea salvo el signo", () => {
  // Línea con lápiz del cajero (override 9,50 sobre un catálogo de 8,18) y
  // dos modificadores, uno con recargo de 50 céntimos.
  const LINE_WITH_EVERYTHING: HoldedLineSnapshot = {
    nameSnapshot: "CORTE + TINTE",
    sku: "AUTO-696777c96a",
    units: 3,
    unitPrice: 8.18,
    unitPriceOverride: 9.5,
    taxRate: 21,
    discountPct: 10,
    product: { kind: "SERVICE", holdedProductId: "696777c96aace215d9063740" },
    modifiers: [
      { groupId: "g1", groupName: "Largo", modifierId: "m1", label: "Media melena", priceDeltaCents: 0 },
      { groupId: "g2", groupName: "Extras", modifierId: "m2", label: "Mascarilla", priceDeltaCents: 50 },
    ],
  };

  it("mismo item, mismo precio, y sólo `units` cambia de signo", () => {
    const sale = buildHoldedLineItem(LINE_WITH_EVERYTHING, SALE_SIGN);
    const refund = buildHoldedLineItem(LINE_WITH_EVERYTHING, REFUND_SIGN);
    expect(refund).toEqual({ ...sale, units: -sale.units });
    // Y el precio es el COBRADO: override 9,50 + 0,50 de modificador.
    expect(sale.subtotal).toBe(10);
    expect(refund.subtotal).toBe(10);
  });

  it("los dos builders de payload coinciden línea a línea", () => {
    const ticketPayload = buildTicketSalesreceiptPayload({
      externalId: "00000000-0000-4000-8000-0000000000aa",
      notes: null,
      paidAt: new Date("2026-09-10T11:00:00Z"),
      lines: [LINE_WITH_EVERYTHING],
      register: { numSerieHolded: null },
    });
    const refundPayload = buildRefundSalesreceiptPayload(
      refundFixture(
        [
          {
            nameSnapshot: LINE_WITH_EVERYTHING.nameSnapshot,
            sku: LINE_WITH_EVERYTHING.sku,
            units: 3,
            unitPrice: 10,
            taxRate: 21,
            discountPct: 10,
            ticketLine: {
              unitPrice: 8.18,
              unitPriceOverride: 9.5,
              modifiers: LINE_WITH_EVERYTHING.modifiers,
              product: LINE_WITH_EVERYTHING.product!,
            },
          },
        ],
        // 10 € × 0,9 × 3 × 1,21 = 32,67 €
        32.67,
        randomUUID(),
      ),
    );
    const sale = ticketPayload.items[0]!;
    const refunded = refundPayload.items[0]!;
    expect(refunded).toEqual({ ...sale, units: -sale.units });
    expect(refunded.desc).toBe("(Largo: Media melena; Extras: Mascarilla)");
  });
});

// ── 4 · el documento no se pierde ─────────────────────────────────────

describe("4 · silent_reject tras un POST que sí creó documento", () => {
  it("guarda holdedDocumentId y número, y el panel puede contarlo", async () => {
    const externalId = randomUUID();
    seedRefund(externalId, [SERVICE_LINE], 3);
    const { client, calls } = mockHoldedClient([
      { id: "doc-huerfano" }, // POST salesreceipt → Holded CREA el documento
      {
        // GET-back: aprobado y numerado… pero a 0 €.
        id: "doc-huerfano",
        docNumber: "T2600123",
        approvedAt: 1789000000,
        draft: null,
        total: 0,
        notes: `TPV-refund-uuid: ${externalId}`,
        paymentsTotal: 0,
        paymentsPending: 0,
        products: [],
      },
    ]);
    const res = await uploadRefund({
      externalId,
      prisma: fakePrisma as any,
      buildClient: () => client,
      logger: { info: () => {}, warn: () => {}, error: () => {} },
    });
    expect(res).toEqual({ kind: "permanent_failure", reason: "silent_reject" });
    const stored = refunds.get(externalId)!;
    expect(stored.status).toBe("SYNC_FAILED");
    // LO IMPORTANTE: el documento existe en Holded y su id está en casa.
    expect(stored.holdedDocumentId).toBe("doc-huerfano");
    expect(stored.holdedDocNumber).toBe("T2600123");
    expect(uploads.get(externalId)!.holdedDocumentId).toBe("doc-huerfano");
    const err = stored.syncError as Record<string, unknown>;
    expect(err.holdedDocumentId).toBe("doc-huerfano");
    expect(String(err.message)).toContain("T2600123");
    expect(String(err.message)).toContain("anularlo en Holded");
    expect(creationPosts(calls)).toHaveLength(1);
  });
});

// ── 5 · un reintento nunca duplica ────────────────────────────────────

describe("5 · reintento de un abono con documento guardado", () => {
  it("documento guardado con total 0 → cero POST y motivo legible", async () => {
    const externalId = randomUUID();
    seedRefund(externalId, [SERVICE_LINE], 3, {
      status: "PENDING_SYNC", // tal como lo deja el botón Reintentar
      holdedDocumentId: "doc-huerfano",
      holdedDocNumber: "T2600123",
    });
    const { client, calls } = mockHoldedClient([
      {
        // GET del documento guardado: sigue ahí, sigue a 0 €.
        id: "doc-huerfano",
        docNumber: "T2600123",
        total: 0,
        paymentsTotal: 0,
        paymentsPending: 0,
        notes: `TPV-refund-uuid: ${externalId}`,
        products: [],
      },
    ]);
    const res = await uploadRefund({
      externalId,
      prisma: fakePrisma as any,
      buildClient: () => client,
      logger: { info: () => {}, warn: () => {}, error: () => {} },
    });
    expect(res).toEqual({
      kind: "permanent_failure",
      reason: "holded_document_total_mismatch",
    });
    expect(creationPosts(calls)).toHaveLength(0);
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(0);
    expect(String((refunds.get(externalId)!.syncError as any).message)).toContain(
      "T2600123",
    );
  });

  it("documento guardado correcto → salta el POST y sólo registra el cobro", async () => {
    const externalId = randomUUID();
    seedRefund(externalId, [SERVICE_LINE], 3, {
      holdedDocumentId: "doc-bueno",
      holdedDocNumber: "T2600124",
    });
    const negativo = {
      id: "doc-bueno",
      docNumber: "T2600124",
      total: -3,
      paymentsTotal: 0,
      paymentsPending: -3,
      notes: `TPV-refund-uuid: ${externalId}`,
      products: [],
    };
    const { client, calls } = mockHoldedClient([
      negativo, // FASE 0: inspección del documento guardado
      negativo, // pre-check idempotente del /pay
      { status: 1, paymentId: "pay-1" },
      { ...negativo, paymentsTotal: -3, paymentsPending: 0 },
    ]);
    const res = await uploadRefund({
      externalId,
      prisma: fakePrisma as any,
      buildClient: () => client,
      logger: { info: () => {}, warn: () => {}, error: () => {} },
    });
    expect(res.kind).toBe("success");
    expect(creationPosts(calls)).toHaveLength(0);
    expect(refunds.get(externalId)!.status).toBe("SYNCED");
  });

  it("documento borrado en Holded → se olvida el id y se crea el bueno", async () => {
    // Éste es el camino de la regularización: el propietario borra el
    // documento de 0 € en Holded y le da a Reintentar.
    const externalId = randomUUID();
    seedRefund(externalId, [SERVICE_LINE], 3, {
      holdedDocumentId: "doc-borrado",
      holdedDocNumber: "T2600123",
    });
    const { HoldedApiError } = await import("@mipiacetpv/holded-client");
    const bueno = {
      id: "doc-nuevo",
      docNumber: "T2600130",
      approvedAt: 1789000000,
      draft: null,
      total: -3,
      notes: `TPV-refund-uuid: ${externalId}`,
      paymentsTotal: 0,
      paymentsPending: -3,
      products: [],
    };
    const { client, calls } = mockHoldedClient([
      // Holded contesta 400 + {"status":0,"info":"not found"} a un
      // documento borrado (comprobado el 26-09-2026).
      new HoldedApiError(400, "/x", { status: 0, info: "not found" }),
      { id: "doc-nuevo" },
      bueno,
      bueno,
      { status: 1, paymentId: "pay-2" },
      { ...bueno, paymentsTotal: -3, paymentsPending: 0 },
    ]);
    const res = await uploadRefund({
      externalId,
      prisma: fakePrisma as any,
      buildClient: () => client,
      logger: { info: () => {}, warn: () => {}, error: () => {} },
    });
    expect(res.kind).toBe("success");
    expect(creationPosts(calls)).toHaveLength(1);
    expect(refunds.get(externalId)!.holdedDocumentId).toBe("doc-nuevo");
    expect(refunds.get(externalId)!.status).toBe("SYNCED");
  });
});

// ── 6 · las seis devoluciones reales de Peluquería Sole ───────────────

// Reconstruidas de la copia de producción `prod-2026-09-24.dump`. Sin
// datos personales: nombre de servicio, sku e importe. Las tres columnas
// que importan son las que el payload usa.
const SOLE = [
  { num: "R-000219", ext: "492a8c07-b0bc-47e0-91af-3c700ee79153", name: "CHAMPU TRATAMIENTO", sku: "AUTO-67d737a6e4", svc: "67d737a6e40a87be3b0a4858", net: 2.4793, total: 3.0 },
  { num: "R-000220", ext: "8b060780-a564-4ee8-be52-50e0e3bed387", name: "CHAMPU TRATAMIENTO", sku: "AUTO-67d737a6e4", svc: "67d737a6e40a87be3b0a4858", net: 2.4793, total: 3.0 },
  { num: "R-000221", ext: "2daad459-8cc7-4183-8b35-08201380c195", name: "CHAMPU TRATAMIENTO", sku: "AUTO-67d737a6e4", svc: "67d737a6e40a87be3b0a4858", net: 2.4793, total: 3.0 },
  { num: "R-000222", ext: "92b0f1a4-4d95-4225-9ea9-0729eb0b758e", name: "ESPUMA", sku: "AUTO-67d737927b", svc: "67d737927bfb0ff8650a51b4", net: 1.8182, total: 2.2 },
  { num: "R-000223", ext: "6908dd60-d1a0-4f79-83f8-8492a66eb1de", name: "ESPUMA", sku: "AUTO-67d737927b", svc: "67d737927bfb0ff8650a51b4", net: 1.8182, total: 2.2 },
  { num: "R-000227", ext: "3f02a454-508c-47da-a4da-364b6e72bc30", name: "CORTAR NIÑOS", sku: "AUTO-696777c96a", svc: "696777c96aace215d9063740", net: 7.9339, total: 9.6 },
] as const;

// El constructor TAL CUAL estaba antes de este bloque. Se conserva aquí
// para demostrar sobre los datos reales qué se mandaba: `sku` en una
// línea de SERVICIO y el precio en `price`. Contra Holded eso da
// price=0 → total 0 (probe C del 26-09-2026, idéntico al
// `{"actual":0,"expected":-9.6}` que guardó producción).
function buildRefundPayloadAntesDelArreglo(l: (typeof SOLE)[number]) {
  return {
    items: [
      {
        name: l.name,
        units: -1,
        price: l.net,
        tax: 21,
        discount: 0,
        sku: l.sku,
      },
    ],
  };
}

describe("6 · las seis devoluciones de Peluquería Sole (10-09-2026)", () => {
  it.each(SOLE.map((r) => [r.num, r] as const))(
    "%s · el payload de antes iba sin serviceId y sin subtotal",
    (_num, l) => {
      const antes = buildRefundPayloadAntesDelArreglo(l);
      // Línea de SERVICIO con un sku que en Holded no resuelve, y el
      // precio en el campo que Holded ignora: las dos causas del 0 €.
      expect(antes.items[0]).toHaveProperty("sku", l.sku);
      expect(antes.items[0]).not.toHaveProperty("serviceId");
      expect(antes.items[0]).not.toHaveProperty("subtotal");
    },
  );

  it.each(SOLE.map((r) => [r.num, r] as const))(
    "%s · con el arreglo lleva serviceId, subtotal y cuadra con el importe",
    (_num, l) => {
      const payload = buildRefundSalesreceiptPayload(
        refundFixture(
          [
            {
              nameSnapshot: l.name,
              sku: l.sku,
              units: 1,
              unitPrice: l.net,
              taxRate: 21,
              discountPct: 0,
              ticketLine: {
                unitPrice: l.net,
                unitPriceOverride: null,
                modifiers: null,
                product: { kind: "SERVICE", holdedProductId: l.svc },
              },
            },
          ],
          l.total,
          l.ext,
        ),
      );
      const item = payload.items[0]!;
      expect(item.serviceId).toBe(l.svc);
      expect(item).not.toHaveProperty("sku");
      expect(item.subtotal).toBe(l.net);
      expect(item.units).toBe(-1);
      // El total del documento que Holded emitirá: -importe del abono.
      const totalConIva = Math.round(item.subtotal * item.units * 1.21 * 100) / 100;
      expect(totalConIva).toBeCloseTo(-l.total, 2);
      // Y las notas siguen llevando el uuid con el que se le encuentra.
      expect(payload.notes).toContain(`TPV-refund-uuid: ${l.ext}`);
    },
  );

  it("los seis suman los 23,00 € que salieron del cajón", () => {
    const suma = SOLE.reduce((acc, r) => acc + r.total, 0);
    expect(Math.round(suma * 100) / 100).toBe(23);
  });
});
