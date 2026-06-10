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
    { name: "Precinto", units: 1, price: 2.27273, tax: 21, discount: 0, sku: "8430173203748" },
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
