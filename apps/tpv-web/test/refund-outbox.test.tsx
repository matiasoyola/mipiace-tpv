// RefundOverlay + outbox (v1.5-consistencia-C · punto 5).
//
// POST /refunds es idempotente por externalId (apps/api routes.ts),
// así que aplica el mismo patrón que el cobro: persistir antes de
// enviar, red caída → pendiente de enviar, error de validación →
// inline sin item residual. El externalId es estable por overlay (ya
// no se genera uno por intento) para que los reintentos no dupliquen.

import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiMock = vi.hoisted(() => ({ apiWithCashier: vi.fn() }));

vi.mock("../src/api.js", async () => {
  const actual = await vi.importActual<typeof import("../src/api.js")>("../src/api.js");
  return { ...actual, apiWithCashier: apiMock.apiWithCashier };
});

import { ApiError } from "../src/api.js";
import { __resetOutboxForTests, outboxList } from "../src/lib/outbox.js";
import { RefundOverlay } from "../src/pages/RefundPage.js";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const ticket = {
  id: "t-1",
  internalNumber: "000042",
  total: 1.54,
  lines: [
    {
      id: "tl-1",
      nameSnapshot: "Café",
      units: 2,
      total: 3.08,
      unitPrice: 1.4,
      discountPct: 0,
      taxRate: 10,
    },
  ],
  payments: [{ id: "pay-1", method: "CASH", amount: 3.08 }],
};

let container: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  await __resetOutboxForTests();
  (globalThis as Record<string, unknown>).indexedDB = new IDBFactory();
  apiMock.apiWithCashier.mockReset();
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function renderOverlay(onConfirmed = vi.fn()) {
  root = createRoot(container);
  await act(async () => {
    root.render(
      <RefundOverlay ticket={ticket} onClose={vi.fn()} onConfirmed={onConfirmed} />,
    );
  });
  return onConfirmed;
}

function findButton(text: string): HTMLButtonElement {
  const btn = Array.from(container.querySelectorAll("button")).find((b) =>
    b.textContent?.includes(text),
  );
  if (!btn) throw new Error(`botón "${text}" no encontrado`);
  return btn as HTMLButtonElement;
}

async function pickOneUnitAndSubmit() {
  // El "+" de la primera línea es el segundo botón del par −/+.
  const plus = container.querySelectorAll("main button")[1] as HTMLButtonElement;
  await act(async () => {
    plus.click();
  });
  await act(async () => {
    findButton("Confirmar").click();
  });
  for (let i = 0; i < 20; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

describe("RefundOverlay · outbox offline", () => {
  it("red OK: persiste antes del POST, borra al confirmar y llama onConfirmed", async () => {
    let outboxSizeAtPostTime = -1;
    apiMock.apiWithCashier.mockImplementation(
      async (_path: string, opts?: { body?: { externalId?: string } }) => {
        const items = await outboxList();
        outboxSizeAtPostTime = items.filter(
          (i) => i.externalId === opts?.body?.externalId,
        ).length;
        return { refund: { id: "r1", internalNumber: "R-0001", status: "PENDING_SYNC", total: 1.54 } };
      },
    );
    const onConfirmed = await renderOverlay();
    await pickOneUnitAndSubmit();

    expect(outboxSizeAtPostTime).toBe(1);
    expect(onConfirmed).toHaveBeenCalledTimes(1);
    expect(await outboxList()).toHaveLength(0);
    const body = apiMock.apiWithCashier.mock.calls[0]![1].body;
    expect(body.lines).toEqual([{ ticketLineId: "tl-1", units: 1 }]);
  });

  it("red caída: 'pendiente de enviar', item queda pending kind=refund", async () => {
    apiMock.apiWithCashier.mockRejectedValue(new TypeError("Failed to fetch"));
    const onConfirmed = await renderOverlay();
    await pickOneUnitAndSubmit();

    expect(
      container.querySelector('[data-testid="pending-refund-pending"]'),
    ).not.toBeNull();
    expect(onConfirmed).not.toHaveBeenCalled();

    const items = await outboxList();
    expect(items).toHaveLength(1);
    expect(items[0]!.kind).toBe("refund");
    expect(items[0]!.status).toBe("pending");
    expect(items[0]!.lockedAt).toBeNull();

    await act(async () => {
      findButton("Aceptar").click();
    });
    expect(onConfirmed).toHaveBeenCalledTimes(1);
  });

  it("422: error inline, sin item residual en el outbox", async () => {
    apiMock.apiWithCashier.mockRejectedValue(
      new ApiError(422, "Unidades superan lo devolvible", "REFUND_UNITS"),
    );
    const onConfirmed = await renderOverlay();
    await pickOneUnitAndSubmit();

    expect(container.textContent).toContain("Unidades superan lo devolvible");
    expect(onConfirmed).not.toHaveBeenCalled();
    expect(await outboxList()).toHaveLength(0);
  });
});
