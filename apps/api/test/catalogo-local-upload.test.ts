// catalogo-local · PUERTA 3 — un producto LOCAL nunca entra en el payload
// de Holded, y si lo intenta FALLA RUIDOSAMENTE.
//
// Por qué importa tanto que sea ruidoso: si una línea llega a Holded sin
// identificador que allí resuelva (`serviceId` para servicios, `sku` para
// productos), Holded NO la rechaza — la acepta con `price = 0`. El total
// deja de cuadrar, el GET-back lo caza como `silent_reject` y el ticket
// entero se cae. Le pasó a Peluquería Sole el 10-06-2026 (ticket 000022,
// 17,50 € cobrados contra 27,40 € reales) y está documentado dentro de
// `buildTicketSalesreceiptPayload`.
//
// Lo que este fichero fija:
//   · el corte pasa ANTES del POST (no se llama a Holded siquiera),
//   · el ticket queda SYNC_FAILED con un motivo que se lee,
//   · el motivo lleva el producto y el ticket, para saber CUÁL se coló,
//   · y no se tumba ninguna venta: el cobro ya ocurrió.

import { randomBytes } from "node:crypto";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.REDIS_URL = "redis://localhost:6379";
process.env.JWT_ACCESS_SECRET = "a".repeat(40);
process.env.JWT_REFRESH_SECRET = "b".repeat(40);
process.env.HOLDED_KEY_ENCRYPTION_SECRET = randomBytes(32).toString("base64");

import { beforeEach, describe, expect, it, vi } from "vitest";

import { encryptSecret } from "../src/crypto.js";

interface Line {
  id: string;
  nameSnapshot: string;
  sku: string;
  product: {
    id: string;
    name: string;
    kind: "PRODUCT" | "SERVICE";
    holdedProductId: string | null;
    source: "HOLDED" | "LOCAL";
  } | null;
}

let ticketRow: {
  id: string;
  externalId: string;
  tenantId: string;
  status: string;
  total: number;
  lines: Line[];
};
let uploadRow: { externalId: string; status: string; lastError: unknown };
let tenantKey: string;

const fakePrisma = {
  ticket: {
    findUnique: vi.fn(async ({ where }: any) => {
      if (where.externalId !== ticketRow.externalId) return null;
      return {
        ...ticketRow,
        total: { toString: () => String(ticketRow.total) },
        paidAt: new Date("2026-09-13T10:00:00Z"),
        holdedDocumentId: null,
        holdedDocNumber: null,
        notes: null,
        lines: ticketRow.lines.map((l) => ({
          ...l,
          units: { toString: () => "1" },
          unitPrice: { toString: () => "10" },
          discountPct: { toString: () => "0" },
          taxRate: { toString: () => "21" },
        })),
        payments: [{ method: "CASH", amount: { toString: () => String(ticketRow.total) } }],
        tenant: { id: ticketRow.tenantId, holdedApiKeyCiphertext: tenantKey },
        register: { numSerieHolded: null },
        user: { isTestCashier: false },
      };
    }),
    update: vi.fn(async ({ data }: any) => {
      Object.assign(ticketRow, data);
      return ticketRow;
    }),
  },
  holdedUpload: {
    update: vi.fn(async ({ data }: any) => {
      Object.assign(uploadRow, data);
      return uploadRow;
    }),
    updateMany: vi.fn(async ({ data }: any) => {
      if (data.status != null) uploadRow.status = data.status;
      if (data.lastError !== undefined) uploadRow.lastError = data.lastError;
      return { count: 1 };
    }),
  },
  ticketEmailJob: { findFirst: vi.fn(async () => null) },
  $transaction: vi.fn(async (ops: any[]) =>
    Promise.all(ops.map((o) => (typeof o === "function" ? o(fakePrisma) : o))),
  ),
} as const;

vi.mock("../src/context.js", () => ({
  getPrisma: () => fakePrisma,
  getRedis: () => ({}),
  shutdown: async () => undefined,
}));
vi.mock("../src/queues/ticket-email.js", () => ({
  enqueueTicketEmail: async () => undefined,
}));

// Espía de Sentry: la alerta es medio entregable de la puerta.
const captured: Array<{ message: string; ctx: any }> = [];
vi.mock("../src/lib/sentry.js", () => ({
  captureAlert: (message: string, ctx: any) => captured.push({ message, ctx }),
  captureError: () => undefined,
  initSentry: () => false,
}));

// Si esto se llama, la puerta ha fallado: significa que hemos hablado
// con Holded con un producto local dentro.
const createSalesreceipt = vi.fn();
vi.mock("@mipiacetpv/holded-client", async () => {
  const actual = await vi.importActual<typeof import("@mipiacetpv/holded-client")>(
    "@mipiacetpv/holded-client",
  );
  return {
    ...actual,
    ApiKeyClient: vi.fn().mockImplementation(() => ({})) as any,
    createSalesreceiptApproved: (...args: unknown[]) => createSalesreceipt(...args),
    registerPaymentWithGetBack: vi.fn(async () => ({})),
  };
});

const { uploadTicket } = await import("../src/tickets/upload-ticket.js");

const silent = { info: () => undefined, warn: () => undefined, error: () => undefined };

function holdedLine(id: string): Line {
  return {
    id,
    nameSnapshot: "Champú Salerm",
    sku: "SKU-1",
    product: {
      id: `p-${id}`,
      name: "Champú Salerm",
      kind: "PRODUCT",
      holdedProductId: "6819ba02aaa",
      source: "HOLDED",
    },
  };
}

function localLine(id: string, kind: "PRODUCT" | "SERVICE" = "PRODUCT"): Line {
  return {
    id,
    nameSnapshot: "Corte de pelo",
    sku: "LOC-AB12CD34",
    product: {
      id: `p-${id}`,
      name: "Corte de pelo",
      kind,
      // Lo que define un producto local: sin ficha en Holded.
      holdedProductId: null,
      source: "LOCAL",
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  captured.length = 0;
  tenantKey = encryptSecret("k", process.env.HOLDED_KEY_ENCRYPTION_SECRET!);
  ticketRow = {
    id: "ticket-uuid-1",
    externalId: "ext-1",
    tenantId: "tenant-1",
    status: "PENDING_SYNC",
    total: 12.1,
    lines: [holdedLine("l1")],
  };
  uploadRow = { externalId: "ext-1", status: "PENDING", lastError: null };
});

describe("catalogo-local · el upload a Holded nunca ve un producto local", () => {
  it("una línea LOCAL corta la subida antes del POST", async () => {
    ticketRow.lines = [localLine("l1")];

    const res = await uploadTicket({
      externalId: "ext-1",
      prisma: fakePrisma as any,
      logger: silent,
    });

    expect(res).toEqual({
      kind: "permanent_failure",
      reason: "local_product_in_holded_payload",
    });
    // LO QUE MÁS IMPORTA: no se ha hablado con Holded.
    expect(createSalesreceipt).not.toHaveBeenCalled();
  });

  it("el ticket queda SYNC_FAILED con el motivo dentro, no en silencio", async () => {
    ticketRow.lines = [localLine("l1")];

    await uploadTicket({ externalId: "ext-1", prisma: fakePrisma as any, logger: silent });

    expect(ticketRow.status).toBe("SYNC_FAILED");
    expect((ticketRow as any).syncError).toMatchObject({
      reason: "local_product_in_holded_payload",
    });
    expect(uploadRow.status).toBe("FAILED");
  });

  it("la alerta dice CUÁL se coló y en qué ticket, no sólo que se coló", async () => {
    ticketRow.lines = [localLine("l1")];

    await uploadTicket({ externalId: "ext-1", prisma: fakePrisma as any, logger: silent });

    expect(captured).toHaveLength(1);
    const alert = captured[0]!;
    expect(alert.message).toContain("producto LOCAL");
    expect(alert.ctx.tenantId).toBe("tenant-1");
    expect(alert.ctx.extra.externalId).toBe("ext-1");
    expect(alert.ctx.extra.ticketId).toBe("ticket-uuid-1");
    expect(alert.ctx.extra.offenders).toEqual([
      {
        productId: "p-l1",
        productName: "Corte de pelo",
        sku: "LOC-AB12CD34",
        lineId: "l1",
      },
    ]);
  });

  it("un ticket MIXTO tampoco sube: una línea local contamina el documento entero", async () => {
    // El total del salesreceipt es del documento. Subir sólo las líneas
    // de Holded daría un total distinto del cobrado, que es exactamente
    // el silent_reject del que esta puerta protege.
    ticketRow.lines = [holdedLine("l1"), localLine("l2")];

    const res = await uploadTicket({
      externalId: "ext-1",
      prisma: fakePrisma as any,
      logger: silent,
    });

    expect(res).toMatchObject({ reason: "local_product_in_holded_payload" });
    expect(createSalesreceipt).not.toHaveBeenCalled();
  });

  it("un SERVICIO local también corta: es la rama que costó dinero en Sole", async () => {
    // La rama SERVICE de `buildTicketSalesreceiptPayload` manda
    // `serviceId` con el holdedProductId. Con `null`, la línea viajaría
    // SIN identificador → price = 0 → silent_reject.
    ticketRow.lines = [localLine("l1", "SERVICE")];

    const res = await uploadTicket({
      externalId: "ext-1",
      prisma: fakePrisma as any,
      logger: silent,
    });

    expect(res).toMatchObject({ reason: "local_product_in_holded_payload" });
    expect(createSalesreceipt).not.toHaveBeenCalled();
  });

  it("lista TODAS las líneas locales, no sólo la primera", async () => {
    ticketRow.lines = [localLine("l1"), holdedLine("l2"), localLine("l3")];

    await uploadTicket({ externalId: "ext-1", prisma: fakePrisma as any, logger: silent });

    expect(captured[0]!.ctx.extra.offenders).toHaveLength(2);
    expect(captured[0]!.ctx.extra.offenders.map((o: any) => o.lineId)).toEqual(["l1", "l3"]);
  });

  it("un ticket SÓLO de Holded pasa de largo: la puerta no estorba a quien ya vendía", async () => {
    // El criterio 4 del bloque: Sole, Cachitos, Thalía y La Maestranza se
    // comportan exactamente igual que antes.
    createSalesreceipt.mockResolvedValueOnce({
      documentId: "doc-1",
      stored: { docNumber: "000042" },
    });
    ticketRow.lines = [holdedLine("l1")];

    const res = await uploadTicket({
      externalId: "ext-1",
      prisma: fakePrisma as any,
      logger: silent,
    });

    expect(createSalesreceipt).toHaveBeenCalledTimes(1);
    expect(res.kind).toBe("success");
    expect(captured).toHaveLength(0);
  });

  it("una línea libre (TPV-OTROS-*, sin producto) sigue subiendo como siempre", async () => {
    // `product: null` es el comodín del §2.6 del núcleo. No es local: es
    // una línea sin catálogo detrás, y lleva subiendo desde B4.
    createSalesreceipt.mockResolvedValueOnce({
      documentId: "doc-2",
      stored: { docNumber: "000043" },
    });
    ticketRow.lines = [
      { id: "l1", nameSnapshot: "Otros 21%", sku: "TPV-OTROS-21", product: null },
    ];

    const res = await uploadTicket({
      externalId: "ext-1",
      prisma: fakePrisma as any,
      logger: silent,
    });

    expect(res.kind).toBe("success");
    expect(captured).toHaveLength(0);
  });
});
