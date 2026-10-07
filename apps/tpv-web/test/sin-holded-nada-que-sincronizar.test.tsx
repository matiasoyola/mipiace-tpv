// N4 · «Sincronizando con Holded…» eterno en un comercio SIN Holded.
//
// La Maestranza va sin Holded (checklist del 04-10). En la API eso está
// resuelto a propósito: `paidTicketStatus` hace nacer la venta `PAID`
// —no `PENDING_SYNC`— porque sin destino no hay nada que esperar y
// dejarla pendiente rompería devoluciones y cierre de día.
//
// El front no se enteró: la pantalla "Ticket emitido" sólo trataba
// `SYNCED`, `SYNC_FAILED` y `TEST`, así que `PAID` caía en el último
// `else` y pintaba el spinner con "Sincronizando con Holded…" en CADA
// venta, para siempre, en un comercio que no tiene Holded.
//
// Y de paso: el `if` que debía parar el polling leía `status` del primer
// render (deps `[ticketId]`), o sea "PENDING_SYNC" siempre, así que
// gastaba sus 60 peticiones aunque el ticket ya fuese final.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const holdedMock = vi.hoisted(() => ({ enabled: true }));
const apiMock = vi.hoisted(() => ({
  status: "PENDING_SYNC",
  ticketCalls: 0,
}));

vi.mock("../src/api.js", async () => {
  const actual = await vi.importActual<typeof import("../src/api.js")>(
    "../src/api.js",
  );
  return {
    ...actual,
    apiWithCashier: vi.fn(async (path: string) => {
      if (/^\/tickets\/[^/]+$/.test(path)) {
        apiMock.ticketCalls += 1;
        return { ticket: { holdedDocNumber: null, status: apiMock.status } };
      }
      // el payload digital no es de este test
      throw new Error("offline");
    }),
  };
});
vi.mock("../src/lib/catalog.js", () => ({
  getCachedBusinessType: () => "HOSPITALITY" as const,
  getCachedCrmEnabled: () => false,
  getCachedAgendaEnabled: () => false,
  getCachedHoldedEnabled: () => holdedMock.enabled,
}));
vi.mock("../src/lib/escposPrint.js", () => ({
  fetchTicketEscposBinary: vi.fn(),
  getPairedUsbPrinter: vi.fn(async () => null),
  isWebUsbSupported: () => false,
  pairUsbPrinter: vi.fn(),
  printEscposUsb: vi.fn(),
  printTicketWifi: vi.fn(),
  openCashDrawerIfAvailable: vi.fn(),
  syncUsbPairingWithServerConfig: vi.fn(async () => {}),
}));
vi.mock("@mipiacetpv/ticket-pdf", () => ({
  renderTicketPdf: vi.fn(async () => new Uint8Array()),
}));
vi.mock("qrcode", () => ({
  default: { toDataURL: vi.fn(async () => "data:image/png;base64,") },
}));

import { SuccessOverlay } from "../src/pages/CheckoutPage.successOverlay.js";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

async function render() {
  root = createRoot(container);
  await act(async () => {
    root.render(
      <SuccessOverlay
        ticketId="t-1"
        internalNumber="000001"
        onDone={() => {}}
      />,
    );
  });
}

function texto(): string {
  return container.textContent ?? "";
}

beforeEach(() => {
  vi.useFakeTimers();
  container = document.createElement("div");
  document.body.appendChild(container);
  holdedMock.enabled = true;
  apiMock.status = "PENDING_SYNC";
  apiMock.ticketCalls = 0;
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
});

describe("N4 · sin Holded no se menciona Holded", () => {
  it("comercio SIN Holded y venta PAID → no dice «Sincronizando con Holded»", async () => {
    holdedMock.enabled = false;
    apiMock.status = "PAID";
    await render();

    expect(texto()).not.toContain("Sincronizando con Holded");
    expect(
      container.querySelector("[data-testid='sin-holded-nada-que-sincronizar']"),
    ).not.toBeNull();
    expect(texto()).toContain("Nada pendiente de sincronizar");
  });

  it("sin Holded el mensaje falso no se asoma ni antes de la 1ª respuesta", async () => {
    // La rama se elige por `holdedEnabled`, no por el estado, así que ni
    // en el primer render —cuando `status` vale todavía "PENDING_SYNC"—
    // puede aparecer el spinner de Holded.
    holdedMock.enabled = false;
    apiMock.status = "PENDING_SYNC";
    await render();

    expect(texto()).not.toContain("Sincronizando con Holded");
  });

  it("comercio CON Holded y venta PENDING_SYNC → el spinner sigue igual", async () => {
    holdedMock.enabled = true;
    apiMock.status = "PENDING_SYNC";
    await render();

    expect(texto()).toContain("Sincronizando con Holded");
    expect(
      container.querySelector("[data-testid='sin-holded-nada-que-sincronizar']"),
    ).toBeNull();
  });

  it("una venta PAID no deja 60 peticiones colgando del endpoint", async () => {
    holdedMock.enabled = false;
    apiMock.status = "PAID";
    await render();

    const trasElPrimerTick = apiMock.ticketCalls;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(90_000);
    });

    expect(trasElPrimerTick).toBe(1);
    expect(apiMock.ticketCalls).toBe(1);
  });

  it("CON Holded el polling sigue hasta que el ticket cierra", async () => {
    holdedMock.enabled = true;
    apiMock.status = "PENDING_SYNC";
    await render();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    expect(apiMock.ticketCalls).toBeGreaterThan(1);

    const antes = apiMock.ticketCalls;
    apiMock.status = "SYNCED";
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    const alCerrar = apiMock.ticketCalls;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });

    expect(alCerrar).toBeGreaterThan(antes);
    expect(apiMock.ticketCalls).toBe(alCerrar);
  });
});
