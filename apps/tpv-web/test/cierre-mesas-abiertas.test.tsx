// v1.22-el-terminal-del-bar · §5 · hallazgo B2 (vivo desde el 02-09).
//
// SABOTAJE que tiene que caer: quitar el aviso de mesas abiertas del
// cierre → el test con un DRAFT de mesa vivo, que exige que el cierre lo
// enumere CON SU IMPORTE.
//
// Lo que pasó el 06-10 en La Maestranza: se cerró el día con la M4
// abierta y 55,00 € en sala y no avisó nadie — ni «Cerrar el día», ni el
// arqueo, ni el Z, ni la apertura del turno siguiente. El 02-09 había
// pasado igual con 19,60 €.

import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiMock = vi.hoisted(() => ({ apiWithCashier: vi.fn() }));

vi.mock("../src/api.js", async () => {
  const actual = await vi.importActual<typeof import("../src/api.js")>(
    "../src/api.js",
  );
  return { ...actual, apiWithCashier: apiMock.apiWithCashier };
});
vi.mock("../src/lib/outbox.js", () => ({
  outboxAdd: vi.fn(),
  outboxCounts: vi.fn(async () => ({ pending: 0, rejected: 0, done: 0 })),
  outboxList: vi.fn(async () => []),
}));

import { CloseShiftModal } from "../src/pages/CloseShiftModal.js";
import { ShiftOpenScreen } from "../src/pages/ShiftOpenScreen.js";
import { summarizeOpenTables } from "../src/lib/openTables.js";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

// El estado real del terminal el 06-10: la M4 abierta con 55,00 €.
function mesa(
  id: string,
  name: string,
  total: number | null,
  extra: { groupedIntoTableId?: string | null } = {},
) {
  return {
    id,
    name,
    capacity: 4,
    zone: "SALON",
    positionX: null,
    positionY: null,
    width: null,
    height: null,
    barSeatIndex: null,
    groupedIntoTableId: extra.groupedIntoTableId ?? null,
    state: total == null ? "FREE" : "OPEN",
    activeTicket:
      total == null
        ? null
        : {
            id: `draft-${id}`,
            total: String(total),
            diners: 2,
            openedAt: new Date().toISOString(),
            openedByEmail: null,
            openedByAlias: "Matías",
            lineCount: 11,
          },
    createdAt: new Date().toISOString(),
  };
}

const MESAS = [
  mesa("t1", "M1", null),
  mesa("t2", "M2", null),
  mesa("t3", "M3", null),
  mesa("t4", "M4", 55),
  mesa("t5", "M5", null),
  mesa("t6", "M6", null),
];

const RESUMEN = {
  shift: {
    id: "shift-1",
    registerId: "reg-1",
    registerName: "Caja 1",
    storeName: "La Maestranza",
    openedAt: new Date(Date.now() - 6 * 3600_000).toISOString(),
    closedAt: null,
    closeReason: "MANUAL" as const,
    cashOpening: 0,
    cashCounted: null,
    zReportPdfPath: null,
    zReportStale: false,
    summaryAckAt: null,
    cashierLabel: "Matías",
    closedByLabel: null,
  },
  ticketsCount: 2,
  refundsCount: 0,
  breakdown: {
    methods: [
      { method: "CASH", gross: 5.5, refunds: 0, net: 5.5 },
      { method: "CARD", gross: 4, refunds: 0, net: 4 },
    ],
    grossSales: 9.5,
    refundsTotal: 0,
    netSales: 9.5,
    cashTheoretical: 5.5,
  },
  cashTheoretical: 5.5,
  descuadre: null,
};

let container: HTMLDivElement;
let root: Root;
let mesasDeLaCaja = MESAS;

beforeEach(() => {
  (globalThis as Record<string, unknown>).indexedDB = new IDBFactory();
  localStorage.clear();
  mesasDeLaCaja = MESAS;
  apiMock.apiWithCashier.mockReset();
  apiMock.apiWithCashier.mockImplementation(async (path: string) => {
    if (path === "/tpv/tables") {
      return { storeId: "store-1", registerId: "reg-1", tables: mesasDeLaCaja };
    }
    if (path.endsWith("/summary")) return RESUMEN;
    return {};
  });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function settle() {
  for (let i = 0; i < 20; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

async function abreCierre(mode: "X" | "Z" = "Z") {
  await act(async () => {
    root.render(
      <CloseShiftModal
        shiftId="shift-1"
        cashierRole="MANAGER"
        mode={mode}
        onClose={vi.fn()}
        onClosed={vi.fn()}
      />,
    );
  });
  await settle();
}

function aviso(): HTMLElement | null {
  return container.querySelector('[data-testid="open-tables-notice"]');
}

function botonPorTexto(texto: string): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll("button")).find(
    (b) => (b.textContent ?? "").trim() === texto,
  ) as HTMLButtonElement | undefined;
}

describe("v1.22 §5 · «Cerrar el día» con una mesa abierta", () => {
  it("enumera la mesa con su importe, antes del botón de cerrar", async () => {
    await abreCierre();
    const a = aviso();
    expect(a).not.toBeNull();
    expect(a!.textContent).toContain("1 mesa abierta");
    expect(a!.textContent).toContain("M4");
    expect(a!.textContent).toContain("55,00 €");
  });

  it("el aviso va ANTES del botón de cerrar, no colgando debajo", async () => {
    await abreCierre();
    const cerrar = botonPorTexto("Cerrar turno")!;
    expect(cerrar).toBeDefined();
    // `DOCUMENT_POSITION_FOLLOWING`: el botón viene DESPUÉS del aviso.
    expect(
      aviso()!.compareDocumentPosition(cerrar) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("AVISA, no bloquea: «Cerrar turno» sigue habilitado", async () => {
    await abreCierre();
    // La norma de cierre va a cambiar el modelo entero; este bloque no
    // mete reglas nuevas de bloqueo que luego haya que deshacer.
    expect(botonPorTexto("Cerrar turno")!.disabled).toBe(false);
  });

  it("también aparece en «Cuadrar caja»", async () => {
    await abreCierre();
    await act(async () => botonPorTexto("Cuadrar caja")!.click());
    await settle();
    expect(aviso()).not.toBeNull();
    expect(aviso()!.textContent).toContain("M4");
  });

  it("y en el arqueo X", async () => {
    await abreCierre("X");
    expect(aviso()).not.toBeNull();
    expect(aviso()!.textContent).toContain("55,00 €");
  });

  it("sin mesas abiertas no pinta nada", async () => {
    mesasDeLaCaja = MESAS.map((m) => mesa(m.id, m.name, null));
    await abreCierre();
    expect(aviso()).toBeNull();
  });

  it("si /tpv/tables falla, el cierre sigue adelante sin aviso", async () => {
    apiMock.apiWithCashier.mockImplementation(async (path: string) => {
      if (path === "/tpv/tables") throw new Error("sin red");
      if (path.endsWith("/summary")) return RESUMEN;
      return {};
    });
    await abreCierre();
    expect(aviso()).toBeNull();
    expect(botonPorTexto("Cerrar turno")).toBeDefined();
  });
});

describe("v1.22 §5 · abrir turno con mesas heredadas", () => {
  it("la pantalla de apertura también lo dice", async () => {
    await act(async () => {
      root.render(
        <ShiftOpenScreen
          cashierLabel="caja1@lamaestranza.es"
          registerName="Caja 1"
          storeName="La Maestranza"
          onOpened={vi.fn()}
          onBack={vi.fn()}
        />,
      );
    });
    await settle();
    const a = aviso();
    expect(a).not.toBeNull();
    expect(a!.textContent).toContain("del turno anterior");
    expect(a!.textContent).toContain("M4");
    expect(a!.textContent).toContain("55,00 €");
  });
});

describe("v1.22 §5 · la regla es la MISMA que la cabecera del mapa", () => {
  it("abierta = no libre y no absorbida por otra mesa", async () => {
    const r = summarizeOpenTables(MESAS);
    expect(r.count).toBe(1);
    expect(r.total).toBe(55);
    expect(r.rows.map((x) => x.name)).toEqual(["M4"]);
  });

  it("una mesa unida a su principal no cuenta aparte", async () => {
    // Su importe ya va en la principal: contarla sería cobrarla dos
    // veces en el aviso.
    const conUnida = [
      ...MESAS,
      mesa("t7", "M7", 12, { groupedIntoTableId: "t4" }),
    ];
    const r = summarizeOpenTables(conUnida);
    expect(r.count).toBe(1);
    expect(r.total).toBe(55);
  });

  it("suma en céntimos: tres mesas de 0,10 son 0,30", async () => {
    const r = summarizeOpenTables([
      mesa("a", "M1", 0.1),
      mesa("b", "M2", 0.1),
      mesa("c", "M3", 0.1),
    ]);
    expect(r.total).toBe(0.3);
  });

  it("una mesa abierta SIN draft cuenta como abierta y suma cero", async () => {
    const sinDraft = { ...mesa("z", "M9", 10), activeTicket: null };
    const r = summarizeOpenTables([sinDraft]);
    expect(r.count).toBe(1);
    expect(r.total).toBe(0);
  });
});
