import { describe, expect, it, vi } from "vitest";

import {
  createSalesreceiptApproved,
  HoldedSilentRejectError,
  registerPaymentWithGetBack,
  type HoldedClient,
} from "../src/index.js";

function mockClient(responses: Array<unknown>): HoldedClient {
  const queue = [...responses];
  return {
    request: vi.fn(async () => {
      if (queue.length === 0) throw new Error("mockClient: ran out of responses");
      return queue.shift();
    }) as HoldedClient["request"],
  };
}

const VALID_EXTERNAL_ID = "1045ab0c-0e40-4618-b508-f5179988bced";
const VALID_PAYLOAD = {
  approveDoc: true as const,
  date: 1746979200,
  notes: `TPV-uuid: ${VALID_EXTERNAL_ID}`,
  items: [
    {
      name: "Precinto",
      units: 1,
      // `subtotal` es el precio unitario que Holded lee de verdad (bloque
      // abonos-holded); `price` va con el mismo valor.
      subtotal: 2.27273,
      price: 2.27273,
      tax: 21,
      discount: 0,
      sku: "8430173203748",
    },
  ],
};

describe("createSalesreceiptApproved", () => {
  it("happy path: documento aprobado con docNumber, total, notes correctos", async () => {
    const client = mockClient([
      { id: "doc-1" }, // POST
      {
        id: "doc-1",
        docNumber: "T260530",
        approvedAt: 1746979200,
        draft: null,
        total: 2.75,
        subtotal: 2.27,
        tax: 0.48,
        discount: 0,
        notes: `TPV-uuid: ${VALID_EXTERNAL_ID}`,
        paymentsTotal: 0,
        paymentsPending: 2.75,
        products: [],
      },
    ]);
    const result = await createSalesreceiptApproved(client, VALID_PAYLOAD, {
      externalId: VALID_EXTERNAL_ID,
      expectedTotal: 2.75,
    });
    expect(result.documentId).toBe("doc-1");
    expect(result.stored.docNumber).toBe("T260530");
  });

  it("lanza HoldedSilentRejectError si docNumber es null (no aprobado)", async () => {
    const client = mockClient([
      { id: "doc-2" },
      {
        id: "doc-2",
        docNumber: null,
        approvedAt: null,
        draft: true,
        total: 0,
        notes: `TPV-uuid: ${VALID_EXTERNAL_ID}`,
        paymentsTotal: 0,
        paymentsPending: 0,
        products: [],
      },
    ]);
    await expect(
      createSalesreceiptApproved(client, VALID_PAYLOAD, {
        externalId: VALID_EXTERNAL_ID,
        expectedTotal: 2.75,
      }),
    ).rejects.toBeInstanceOf(HoldedSilentRejectError);
  });

  it("lanza HoldedSilentRejectError si total no cuadra ±0.05", async () => {
    const client = mockClient([
      { id: "doc-3" },
      {
        id: "doc-3",
        docNumber: "T260531",
        approvedAt: 1,
        draft: null,
        total: 9.99,
        notes: `TPV-uuid: ${VALID_EXTERNAL_ID}`,
        paymentsTotal: 0,
        paymentsPending: 9.99,
        products: [],
      },
    ]);
    await expect(
      createSalesreceiptApproved(client, VALID_PAYLOAD, {
        externalId: VALID_EXTERNAL_ID,
        expectedTotal: 2.75,
      }),
    ).rejects.toBeInstanceOf(HoldedSilentRejectError);
  });

  it("lanza HoldedSilentRejectError si notes no contiene externalId", async () => {
    const client = mockClient([
      { id: "doc-4" },
      {
        id: "doc-4",
        docNumber: "T260532",
        approvedAt: 1,
        draft: null,
        total: 2.75,
        notes: "TPV-uuid: otro-uuid",
        paymentsTotal: 0,
        paymentsPending: 2.75,
        products: [],
      },
    ]);
    await expect(
      createSalesreceiptApproved(client, VALID_PAYLOAD, {
        externalId: VALID_EXTERNAL_ID,
        expectedTotal: 2.75,
      }),
    ).rejects.toBeInstanceOf(HoldedSilentRejectError);
  });

  it("lanza si el payload.notes no contiene el externalId (defensa programador)", async () => {
    const client = mockClient([]);
    await expect(
      createSalesreceiptApproved(
        client,
        { ...VALID_PAYLOAD, notes: "sin uuid" },
        { externalId: VALID_EXTERNAL_ID, expectedTotal: 2.75 },
      ),
    ).rejects.toThrow(/payload.notes debe contener/);
  });
});

describe("registerPaymentWithGetBack", () => {
  it("happy path: paymentsPending pasa a 0", async () => {
    const client = mockClient([
      // Pre-check idempotente (v1.3-hotfix10): doc aún sin pagar.
      {
        id: "doc-1",
        docNumber: "T260530",
        total: 2.75,
        paymentsTotal: 0,
        paymentsPending: 2.75,
        notes: `TPV-uuid: ${VALID_EXTERNAL_ID}`,
        products: [],
      },
      { status: 1, paymentId: "p1" },
      {
        id: "doc-1",
        docNumber: "T260530",
        total: 2.75,
        paymentsTotal: 2.75,
        paymentsPending: 0,
        notes: `TPV-uuid: ${VALID_EXTERNAL_ID}`,
        products: [],
      },
    ]);
    const stored = await registerPaymentWithGetBack(client, "doc-1", {
      date: 1,
      amount: 2.75,
    });
    expect(stored.paymentsPending).toBe(0);
  });

  it("lanza HoldedSilentRejectError si paymentsPending sigue > 0", async () => {
    const client = mockClient([
      // Pre-check idempotente (v1.3-hotfix10): doc aún sin pagar.
      {
        id: "doc-1",
        total: 2.75,
        paymentsTotal: 0,
        paymentsPending: 2.75,
        products: [],
      },
      { status: 1 },
      {
        id: "doc-1",
        total: 2.75,
        paymentsTotal: 0,
        paymentsPending: 2.75,
        products: [],
      },
    ]);
    await expect(
      registerPaymentWithGetBack(client, "doc-1", { date: 1, amount: 2.75 }),
    ).rejects.toBeInstanceOf(HoldedSilentRejectError);
  });
});

// ── bloque abonos-holded ──────────────────────────────────────────────

const REFUND_EXTERNAL_ID = "3f02a454-508c-47da-a4da-364b6e72bc30";
const REFUND_PAYLOAD = {
  approveDoc: true as const,
  date: 1789000000,
  notes: `TPV-refund-uuid: ${REFUND_EXTERNAL_ID} · original: T261131`,
  items: [
    {
      name: "CORTAR NIÑOS",
      units: -1,
      subtotal: 7.9339,
      price: 7.9339,
      tax: 21,
      discount: 0,
      serviceId: "696777c96aace215d9063740",
    },
  ],
};

describe("createSalesreceiptApproved · abonos (total negativo)", () => {
  it("acepta un documento con total negativo cuando el esperado es negativo", async () => {
    // Antes la comprobación era `!(storedTotal > 0)`: daba por roto TODO
    // abono, incluso uno perfecto. Los valores son los del ensayo real
    // contra Holded del 26-09-2026.
    const client = mockClient([
      { id: "doc-abono" },
      {
        id: "doc-abono",
        docNumber: "T2614967",
        approvedAt: 1789000000,
        draft: null,
        total: -9.6,
        subtotal: -7.93,
        tax: -1.67,
        discount: 0,
        notes: REFUND_PAYLOAD.notes,
        paymentsTotal: 0,
        paymentsPending: -9.6,
        products: [],
      },
    ]);
    const res = await createSalesreceiptApproved(client, REFUND_PAYLOAD, {
      externalId: REFUND_EXTERNAL_ID,
      expectedTotal: -9.6,
    });
    expect(res.documentId).toBe("doc-abono");
    expect(res.stored.total).toBe(-9.6);
  });

  it("un abono que Holded deja a 0 sigue siendo silent_reject y trae el documento", async () => {
    const client = mockClient([
      { id: "doc-huerfano" },
      {
        id: "doc-huerfano",
        docNumber: "T2600123",
        approvedAt: 1789000000,
        draft: null,
        total: 0,
        subtotal: 0,
        tax: 0,
        discount: 0,
        notes: REFUND_PAYLOAD.notes,
        paymentsTotal: 0,
        paymentsPending: 0,
        products: [],
      },
    ]);
    const err = await createSalesreceiptApproved(client, REFUND_PAYLOAD, {
      externalId: REFUND_EXTERNAL_ID,
      expectedTotal: -9.6,
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HoldedSilentRejectError);
    const silent = err as HoldedSilentRejectError;
    expect(silent.mismatches).toEqual([
      { field: "total", expected: -9.6, actual: 0 },
    ]);
    // El documento existe en Holded: el error lo dice, para que el caller
    // pueda guardarlo y nadie tenga que buscarlo a mano.
    expect(silent.document).toEqual({ id: "doc-huerfano", docNumber: "T2600123" });
  });

  it("una venta con total negativo sigue siendo silent_reject (el signo importa)", async () => {
    const client = mockClient([
      { id: "doc-x" },
      {
        id: "doc-x",
        docNumber: "T1",
        approvedAt: 1,
        draft: null,
        total: -2.75,
        notes: `TPV-uuid: ${VALID_EXTERNAL_ID}`,
        paymentsTotal: 0,
        paymentsPending: -2.75,
        products: [],
      },
    ]);
    const err = await createSalesreceiptApproved(client, VALID_PAYLOAD, {
      externalId: VALID_EXTERNAL_ID,
      expectedTotal: 2.75,
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HoldedSilentRejectError);
  });
});

describe("registerPaymentWithGetBack · cobro negativo", () => {
  it("el pre-check idempotente también ve un abono ya pagado (paymentsTotal negativo)", async () => {
    // Con la condición anterior (`paymentsTotal > 0`) el pre-check no
    // disparaba nunca en un abono y el reintento duplicaba el pago.
    const yaPagado = {
      id: "doc-abono",
      docNumber: "T2614967",
      total: -9.6,
      paymentsTotal: -9.6,
      paymentsPending: 0,
      notes: REFUND_PAYLOAD.notes,
      products: [],
    };
    const client = mockClient([yaPagado]);
    const stored = await registerPaymentWithGetBack(client, "doc-abono", {
      date: 1789000000,
      amount: -9.6,
    });
    expect(stored.paymentsPending).toBe(0);
    // Una sola petición: el GET del pre-check. Ningún POST /pay.
    expect((client.request as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(1);
  });
});
