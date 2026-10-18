// v1.11-cierre-de-dia · la pantalla de la mañana y el cierre invertido.
//
// Sustituye a `shift-force-close-sync-pending.test.tsx` (v1.5-hotfix2): la
// pantalla que testeaba era `ShiftForceCloseScreen`, que este bloque
// convierte en `ShiftResumeScreen`. La regresión que aquel test guardaba
// —turno colgado + tickets SYNC_FAILED = negocio bloqueado— sigue cubierta
// aquí, en su casa nueva (el cierre pasa ahora por `CloseShiftModal`).
//
// Lo que se verifica:
//   1. "Reanudar turno" es la acción primaria y NO cierra nada: el cajero
//      puede vender antes de arquear. Es el criterio del bloque.
//   2. Cerrar el día enseña el RESUMEN primero, no la tabla de
//      denominaciones, y confirma con un solo botón (POST /close-day).
//   3. Con tickets sin sincronizar: lista, checkbox, botón bloqueado hasta
//      aceptar, y reenvío con `syncFailureAccepted: true`.
//
// Mismo patrón sin testing-library que error-boundary.test.tsx:
// createRoot + act + eventos nativos.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiMock = vi.hoisted(() => ({ apiWithCashier: vi.fn() }));

vi.mock("../src/api.js", async () => {
  const actual = await vi.importActual<typeof import("../src/api.js")>("../src/api.js");
  return { ...actual, apiWithCashier: apiMock.apiWithCashier };
});
// El modal consulta la cola local al abrir el cierre Z. En jsdom no hay
// IndexedDB útil: devolvemos una cola vacía para que el único motivo de
// aviso sea el que manda el server.
vi.mock("../src/lib/outbox.js", () => ({
  outboxAdd: vi.fn(),
  outboxCounts: vi.fn(async () => ({ pending: 0, rejected: 0 })),
  outboxList: vi.fn(async () => []),
}));
vi.mock("../src/lib/offlineShift.js", () => ({
  getLocalShift: vi.fn(async () => null),
  closeLocalShift: vi.fn(async () => undefined),
}));

import { ApiError } from "../src/api.js";
import { ShiftResumeScreen } from "../src/pages/ShiftResumeScreen.js";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const shift = {
  id: "shift-1",
  openedAt: "2026-08-19T07:22:25.000Z",
  lastActivityAt: "2026-08-19T18:15:31.000Z",
  cashOpening: "50",
};

// Resumen que devuelve GET /shift/:id/summary para el turno abierto de
// ayer: 420 € vendidos, 120 en efectivo sobre un fondo de 50.
const summary = {
  shift: {
    id: "shift-1",
    registerId: "reg-1",
    registerName: "Caja 1",
    storeName: "Peluquería Sole",
    openedAt: shift.openedAt,
    closedAt: null,
    closeReason: "MANUAL" as const,
    cashOpening: 50,
    cashCounted: null,
    zReportPdfPath: null,
    zReportStale: false,
    summaryAckAt: null,
    cashierLabel: "Sole",
    closedByLabel: null,
  },
  ticketsCount: 12,
  refundsCount: 0,
  breakdown: {
    methods: [
      { method: "CASH", gross: 120, refunds: 0, net: 120 },
      { method: "CARD", gross: 300, refunds: 0, net: 300 },
    ],
    grossSales: 420,
    refundsTotal: 0,
    netSales: 420,
    cashTheoretical: 170,
  },
  cashTheoretical: 170,
  descuadre: null,
};

function makeSyncPendingError() {
  return new ApiError(
    409,
    "Hay tickets sin sincronizar con Holded.",
    "SYNC_PENDING",
    {
      pendingSync: 0,
      failed: 1,
      failedTickets: [
        {
          id: "t-22",
          kind: "ticket",
          internalNumber: "000022",
          total: 27.4,
          createdAt: "2026-08-19T09:21:23.000Z",
          errorSummary: "silent_reject",
        },
      ],
      failedRefunds: [],
    },
  );
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  apiMock.apiWithCashier.mockReset();
  Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function renderScreen(handlers?: {
  onResumed?: ReturnType<typeof vi.fn>;
  onClosed?: ReturnType<typeof vi.fn>;
}) {
  const onResumed = handlers?.onResumed ?? vi.fn();
  const onClosed = handlers?.onClosed ?? vi.fn();
  root = createRoot(container);
  await act(async () => {
    root.render(
      <ShiftResumeScreen
        shift={shift}
        cashierRole="MANAGER"
        onResumed={onResumed}
        onClosed={onClosed}
      />,
    );
  });
  return { onResumed, onClosed };
}

function buttonWith(text: string): HTMLButtonElement {
  const btn = Array.from(container.querySelectorAll("button")).find((b) =>
    b.textContent?.includes(text),
  );
  if (!btn) throw new Error(`botón "${text}" no encontrado`);
  return btn;
}

// Abre el modal de cierre con el resumen ya cargado.
async function openCloseWithSummary() {
  apiMock.apiWithCashier.mockResolvedValueOnce(summary); // GET summary
  await act(async () => {
    buttonWith("Cerrar el día de ayer").click();
  });
}

describe("v1.11 · el turno deja de ser un muro", () => {
  it("'Reanudar turno' es la acción primaria y no cierra nada", async () => {
    apiMock.apiWithCashier.mockResolvedValueOnce({
      shift: { id: "shift-1", openedAt: shift.openedAt, cashOpening: "50" },
    });
    const { onResumed, onClosed } = await renderScreen();

    // La tabla de denominaciones NO está en pantalla. Ni un campo de
    // efectivo. Eso es el bloque entero en una aserción.
    // auditoria-sirope (#28) · ver la nota de `close-shift-reason`.
    expect(container.querySelector('[data-testid="cuadre-diarias"]')).toBeNull();
    expect(container.querySelector('input[placeholder="0,00"]')).toBeNull();

    await act(async () => {
      buttonWith("Reanudar turno").click();
    });

    expect(onResumed).toHaveBeenCalledTimes(1);
    expect(onClosed).not.toHaveBeenCalled();
    expect(apiMock.apiWithCashier).toHaveBeenCalledTimes(1);
    expect(apiMock.apiWithCashier.mock.calls[0]![0]).toBe("/shift/shift-1/resume");
  });

  it("si la red se cae al reanudar, se entra igual (v1.10: sin red se sigue vendiendo)", async () => {
    apiMock.apiWithCashier.mockRejectedValueOnce(new Error("Failed to fetch"));
    const { onResumed } = await renderScreen();
    await act(async () => {
      buttonWith("Reanudar turno").click();
    });
    expect(onResumed).toHaveBeenCalledTimes(1);
    expect(onResumed.mock.calls[0]![0].id).toBe("shift-1");
  });

  it("si el corte de día ya cerró el turno, no hay nada que reanudar", async () => {
    apiMock.apiWithCashier.mockRejectedValueOnce(
      new ApiError(409, "El turno ya está cerrado.", "SHIFT_ALREADY_CLOSED"),
    );
    const { onResumed, onClosed } = await renderScreen();
    await act(async () => {
      buttonWith("Reanudar turno").click();
    });
    expect(onResumed).not.toHaveBeenCalled();
    expect(onClosed).toHaveBeenCalledTimes(1);
  });
});

describe("v1.11 · cerrar el día enseña el resumen, no el arqueo", () => {
  it("el modal abre en el resumen con el efectivo esperado y un solo botón", async () => {
    await renderScreen();
    await openCloseWithSummary();

    expect(apiMock.apiWithCashier.mock.calls[0]![0]).toBe("/shift/shift-1/summary");
    expect(container.textContent).toContain("Ventas del día");
    expect(container.textContent).toContain("420,00 €");
    expect(container.textContent).toContain("Efectivo esperado en el cajón");
    expect(container.textContent).toContain("170,00 €");
    // Contar sigue existiendo, como enlace. No como requisito.
    expect(container.textContent).toContain("Cuadrar caja");
    // auditoria-sirope (#28) · ver la nota de `close-shift-reason`.
    expect(container.querySelector('[data-testid="cuadre-diarias"]')).toBeNull();
  });

  it("confirmar cierra sin contar (POST /close-day) y termina en la misma tarjeta", async () => {
    const { onClosed } = await renderScreen();
    await openCloseWithSummary();

    const closed = {
      ...summary,
      shift: { ...summary.shift, closedAt: "2026-08-20T07:05:00.000Z" },
    };
    apiMock.apiWithCashier
      .mockResolvedValueOnce(closed) // POST /close-day
      .mockResolvedValueOnce(closed); // GET /summary del turno cerrado
    await act(async () => {
      buttonWith("Cerrar turno").click();
    });

    const paths = apiMock.apiWithCashier.mock.calls.map((c) => c[0]);
    expect(paths).toContain("/shift/shift-1/close-day");
    expect(container.textContent).toContain("Turno cerrado");

    apiMock.apiWithCashier.mockResolvedValueOnce({});
    await act(async () => {
      buttonWith("Hecho").click();
    });
    expect(onClosed).toHaveBeenCalledTimes(1);
  });

  it("'Cuadrar caja' abre la tabla de siempre con el esperado delante", async () => {
    await renderScreen();
    await openCloseWithSummary();
    await act(async () => {
      buttonWith("Cuadrar caja").click();
    });
    expect(
      container.querySelector('[data-testid="cuadre-diarias"]'),
    ).not.toBeNull();
    expect(container.textContent).toContain("Efectivo esperado en el cajón");
    expect(container.textContent).toContain("170,00 €");
  });

  // ── auditoria-sirope · el cierre del día del 18-10 ─────────────────
  //
  // Las filas de la tabla de sabotajes que viven aquí:
  //
  //   | «Cuadrar caja» vuelve a ser un enlace (#27)
  //   | Las denominaciones vuelven a empezar por 500 (#28)
  //   | Descuadre 0 sin «Cuadra» (#28)
  //   | «Cancelar» fuera de la hoja (#29)

  it("#27 · «Cuadrar caja» es un BOTÓN al lado de «Cerrar turno»", async () => {
    await renderScreen();
    await openCloseWithSummary();
    const cuadrar = container.querySelector<HTMLElement>(
      '[data-testid="cuadrar-caja"]',
    );
    const cerrar = container.querySelector<HTMLElement>(
      '[data-testid="cerrar-turno"]',
    );
    expect(cuadrar).not.toBeNull();
    expect(cerrar).not.toBeNull();
    // Al mismo nivel: misma fila y mismo alto. Era un enlace subrayado
    // en gris debajo, o sea «esto no hace falta».
    expect(cuadrar!.parentElement).toBe(cerrar!.parentElement);
    expect(cuadrar!.className).toContain("h-14");
    expect(cuadrar!.className).not.toContain("underline");
    // Y «Cerrar turno» sigue siendo el principal: decisión de v1.11 que
    // este bloque NO cambia.
    expect(cerrar!.className).toContain("bg-mipiace-coral");
  });

  it("#29 · «Cancelar» está DENTRO de la hoja", async () => {
    await renderScreen();
    await openCloseWithSummary();
    const cancelar = container.querySelector<HTMLElement>(
      '[data-testid="cerrar-dia-cancelar"]',
    );
    expect(cancelar).not.toBeNull();
    // En la misma fila que las acciones, no colgando debajo de la
    // tarjeta (donde a 811 px asomaba cortado por el borde).
    expect(
      cancelar!.parentElement!.querySelector('[data-testid="cerrar-turno"]'),
    ).not.toBeNull();
  });

  it("#28 · las denominaciones empiezan por las de todos los días", async () => {
    await renderScreen();
    await openCloseWithSummary();
    await act(async () => {
      buttonWith("Cuadrar caja").click();
    });
    const filas = [
      ...container.querySelectorAll<HTMLElement>(
        '[data-testid="cuadre-diarias"] [data-testid="cuadre-fila"]',
      ),
    ].map((el) => el.dataset.denominacion);
    expect(filas[0]).toBe("50");
    expect(filas).toContain("0.01");
    // Y los tres grandes NO están en la lista de todos los días.
    expect(filas).not.toContain("500");
    expect(filas).not.toContain("200");
    expect(filas).not.toContain("100");
    // Están, pero plegados.
    const grandes = container.querySelector<HTMLDetailsElement>(
      '[data-testid="cuadre-grandes"]',
    );
    expect(grandes).not.toBeNull();
    expect(grandes!.open).toBe(false);
    // Doce en dos columnas son seis filas: eso es lo que cabe sin
    // scroll. La caja ya no scrollea.
    expect(filas).toHaveLength(12);
  });

  it("#28 · descuadre 0 dice «Cuadra», y en verde", async () => {
    await renderScreen();
    await openCloseWithSummary();
    await act(async () => {
      buttonWith("Cuadrar caja").click();
    });
    // El esperado son 170 €: 3 billetes de 50 y uno de 20.
    await contar("50", "3");
    await contar("20", "1");
    const linea = container.querySelector<HTMLElement>(
      '[data-testid="cuadre-descuadre"]',
    );
    expect(linea).not.toBeNull();
    expect(linea!.dataset.cuadra).toBe("1");
    expect(linea!.textContent).toContain("Cuadra");
    expect(linea!.className).toContain("emerald");

    // Y un billete de más deja de cuadrar, con su cifra.
    await contar("50", "4");
    const desc = container.querySelector<HTMLElement>(
      '[data-testid="cuadre-descuadre"]',
    )!;
    expect(desc.dataset.cuadra).toBe("0");
    expect(desc.textContent).toContain("50,00");
    expect(desc.className).not.toContain("emerald");
  });
});

/** Teclea `cantidad` en la denominación `key` con el CashPad. */
async function contar(key: string, cantidad: string): Promise<void> {
  const campo = container
    .querySelector(`[data-denominacion="${key}"]`)!
    .querySelector("input")!;
  await act(async () => {
    campo.click();
  });
  const pad = container.querySelector('[data-testid="cash-pad"]')!;
  const tecla = (label: string) =>
    [...pad.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === label,
    )!;
  for (const ch of cantidad) {
    await act(async () => {
      tecla(ch).click();
    });
  }
}

describe("v1.5-hotfix2 (vigente) · turno colgado con SYNC_PENDING", () => {
  it("muestra los tickets fallidos y NO deja cerrar sin aceptar", async () => {
    await renderScreen();
    await openCloseWithSummary();

    apiMock.apiWithCashier.mockRejectedValueOnce(makeSyncPendingError());
    await act(async () => {
      buttonWith("Cerrar turno").click();
    });

    expect(container.textContent).toContain("000022");
    // v1.12 · base de integración: los importes de esta lista pasan por
    // `formatEur` desde v1.10.3 (coma decimal), como el resto de la app.
    expect(container.textContent).toContain("27,40 €");
    expect(container.textContent).toContain("cerrar el turno igualmente");
    expect(buttonWith("Cerrar turno").disabled).toBe(true);
  });

  it("tras marcar la aceptación reenvía con syncFailureAccepted: true", async () => {
    await renderScreen();
    await openCloseWithSummary();

    apiMock.apiWithCashier.mockRejectedValueOnce(makeSyncPendingError());
    await act(async () => {
      buttonWith("Cerrar turno").click();
    });

    const checkbox = container.querySelector('input[type="checkbox"]');
    expect(checkbox).not.toBeNull();
    await act(async () => {
      (checkbox as HTMLInputElement).click();
    });
    expect(buttonWith("Cerrar turno").disabled).toBe(false);

    const closed = {
      ...summary,
      shift: { ...summary.shift, closedAt: "2026-08-20T07:05:00.000Z" },
    };
    apiMock.apiWithCashier.mockResolvedValueOnce(closed).mockResolvedValueOnce(closed);
    await act(async () => {
      buttonWith("Cerrar turno").click();
    });

    const closeCall = apiMock.apiWithCashier.mock.calls.find(
      (c) => c[0] === "/shift/shift-1/close-day" && c[1]?.body?.syncFailureAccepted,
    );
    expect(closeCall).toBeDefined();
    expect(closeCall![1].body.syncFailureAccepted).toBe(true);
  });
});
