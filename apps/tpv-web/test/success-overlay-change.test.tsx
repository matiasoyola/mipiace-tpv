// v1.15-la-vuelta-existe §4 · hallazgo C1 de la auditoría del
// 2026-09-02: se cobran 3,00 €, el cliente da 5, y la pantalla "Ticket
// emitido" enseñaba número interno, badge PRUEBA, aviso de impresora y
// cuatro acciones — ni total, ni entregado, ni cambio.
//
// Lo que fija este archivo: con exceso en efectivo se pinta CAMBIO y es
// el número más grande de la pantalla; sin exceso no se pinta nada
// nuevo; y ninguna de las acciones existentes desaparece.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/api.js", async () => {
  const actual = await vi.importActual<typeof import("../src/api.js")>(
    "../src/api.js",
  );
  return {
    ...actual,
    // El cambio no puede depender del servidor: es lo primero que hay
    // que leer y el TPV puede estar offline. Aquí las dos llamadas del
    // overlay fallan y el bloque tiene que salir igual.
    apiWithCashier: vi.fn(async () => {
      throw new Error("offline");
    }),
  };
});
vi.mock("../src/lib/catalog.js", () => ({
  getCachedBusinessType: () => "HOSPITALITY" as const,
  getCachedCrmEnabled: () => false,
  getCachedAgendaEnabled: () => false,
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

async function render(cash?: {
  total: number;
  received: number;
  change: number;
}) {
  root = createRoot(container);
  await act(async () => {
    root.render(
      <SuccessOverlay
        ticketId="t-1"
        internalNumber="000020"
        cash={cash}
        onDone={() => {}}
      />,
    );
  });
}

function px(sel: string): number {
  const el = container.querySelector(sel) as HTMLElement | null;
  if (!el) throw new Error(`no existe ${sel}`);
  const cls = el.getAttribute("class") ?? "";
  const m = cls.match(/text-\[(\d+)px\]/);
  if (!m) throw new Error(`sin tamaño explícito: ${cls}`);
  return Number(m[1]);
}

beforeEach(() => {
  vi.useFakeTimers();
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
});

describe("SuccessOverlay · la vuelta se ve", () => {
  it("con exceso en efectivo pinta TOTAL, ENTREGADO y CAMBIO", async () => {
    // El caso de la auditoría: ticket de 3,00 € y billete de 5.
    await render({ total: 3, received: 5, change: 2 });
    const block = container.querySelector('[data-testid="change-due"]');
    expect(block).not.toBeNull();
    expect(block!.textContent).toContain("Cambio");
    expect(
      container.querySelector('[data-testid="change-due-amount"]')!.textContent,
    ).toBe("2,00 €");
    expect(
      container.querySelector('[data-testid="change-due-total"]')!.textContent,
    ).toBe("3,00 €");
    expect(
      container.querySelector('[data-testid="change-due-received"]')!
        .textContent,
    ).toBe("5,00 €");
  });

  it("el CAMBIO manda: es el número más grande de la pantalla", async () => {
    await render({ total: 3, received: 5, change: 2 });
    const change = px('[data-testid="change-due-amount"]');
    expect(change).toBe(48); // ux-principles §1.5
    expect(change).toBeGreaterThan(px('[data-testid="change-due-total"]'));
    expect(change).toBeGreaterThan(px('[data-testid="change-due-received"]'));
    // Y por encima de cualquier otro tamaño declarado del overlay.
    const sizes = [...container.querySelectorAll("[class]")]
      .flatMap(
        (el) => (el.getAttribute("class") ?? "").match(/text-\[(\d+)px\]/g) ?? [],
      )
      .map((c) => Number(c.match(/(\d+)/)![1]));
    expect(Math.max(...sizes)).toBe(change);
  });

  it("sin exceso no se pinta la línea", async () => {
    await render({ total: 3, received: 3, change: 0 });
    expect(container.querySelector('[data-testid="change-due"]')).toBeNull();
    expect(container.textContent).toContain("Número interno");
  });

  it("un cobro sin efectivo tampoco la pinta", async () => {
    await render({ total: 3, received: 0, change: 0 });
    expect(container.querySelector('[data-testid="change-due"]')).toBeNull();
  });

  it("sin datos de cobro (compatibilidad) el overlay sigue montando", async () => {
    await render(undefined);
    expect(container.querySelector('[data-testid="change-due"]')).toBeNull();
    expect(container.textContent).toContain("emitido");
  });

  it("no se quita ninguna acción existente", async () => {
    await render({ total: 3, received: 5, change: 2 });
    expect(container.textContent).toContain("Número interno");
    expect(container.textContent).toContain("#000020");
    expect(container.textContent).toContain("Nueva venta");
  });

  it("con vuelta el autocierre da 8 s, no 4", async () => {
    // 4 s no llegan para abrir el cajón y contar las monedas.
    const onDone = vi.fn();
    root = createRoot(container);
    await act(async () => {
      root.render(
        <SuccessOverlay
          ticketId="t-1"
          internalNumber="000020"
          cash={{ total: 3, received: 5, change: 2 }}
          onDone={onDone}
        />,
      );
    });
    await act(async () => {
      vi.advanceTimersByTime(5000);
    });
    expect(onDone).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(3500);
    });
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});
