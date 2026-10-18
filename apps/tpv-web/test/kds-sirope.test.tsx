// auditoria-sirope · la pantalla de cocina del AP11, el 18-10.
//
//   #26 · en una pantalla compartida (Cocina + Barra), la sección se
//         distinguía por una palabra de 13 px dentro del eyebrow. Había
//         que LEER cada tarjeta para saber si era tuya. (Captura 60.)
//   #24 · 90 px muertos entre la rejilla y «Listas»: la franja «+N» se
//         pintaba siempre, vacía incluida. (Capturas 51 y 60.)

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiMock = vi.hoisted(() => ({ apiWithDevice: vi.fn() }));
vi.mock("../src/api.js", async () => {
  const actual = await vi.importActual<typeof import("../src/api.js")>(
    "../src/api.js",
  );
  return { ...actual, apiWithDevice: apiMock.apiWithDevice };
});
vi.mock("../src/storage.js", async () => {
  const actual = await vi.importActual<typeof import("../src/storage.js")>(
    "../src/storage.js",
  );
  return { ...actual, getDeviceToken: () => "token-de-la-pantalla" };
});

import { KitchenScreen } from "../src/kitchen/KitchenScreen.js";
import type { Comanda, KitchenMe, VistaCocina } from "../src/kitchen/types.js";
import { SECCION_COLOR } from "../src/lib/kitchenTheme.js";

function rgb(hex: string): string {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const AHORA = "2026-10-18T14:20:00.000Z";

/** El AP11 de Sirope: una sola pantalla para Cocina y Barra. */
const AP11: KitchenMe = {
  device: { id: "dev-ap11", name: "AP11-1006" },
  store: { id: "store-1", name: "Sirope" },
  sections: ["COCINA", "BARRA"],
  settings: { greenMaxMin: 10, amberMaxMin: 20, readyBeep: false },
};

/** Y una pantalla de una sola sección, para la otra mitad de la regla. */
const SOLO_COCINA: KitchenMe = { ...AP11, sections: ["COCINA"] };

function comanda(over: Partial<Comanda> = {}): Comanda {
  const sentAt = over.sentAt ?? AHORA;
  return {
    id: "o1",
    section: "COCINA",
    ticketId: "t1",
    tableId: "m1",
    tableName: "T6",
    number: 1,
    urgent: false,
    lateArrival: false,
    sentAt,
    firedAt: sentAt,
    orderAt: sentAt,
    readyAt: null,
    servedAt: null,
    recoveredAt: null,
    isNew: false,
    allergyBands: [],
    lines: [
      {
        id: "l1",
        name: "Tostada con tomate",
        units: 1,
        unitsOriginal: null,
        notes: [],
        course: 1,
        seat: null,
        fired: true,
        done: false,
        voidedUnits: 0,
        voidPending: false,
        doneBeforeVoid: false,
        changeNote: null,
        changePending: false,
        carries: [],
        seatAllergy: null,
        allergyWarning: null,
      },
    ],
    ...over,
  };
}

function vista(orders: Comanda[], ready: Comanda[] = []): VistaCocina {
  return {
    serverTime: AHORA,
    settings: AP11.settings,
    sections: ["COCINA", "BARRA"],
    orders,
    ready,
  };
}

let container: HTMLDivElement;
let root: Root;

function monta(v: VistaCocina) {
  apiMock.apiWithDevice.mockImplementation(async (path: string) => {
    if (path === "/kitchen/comandas") return v;
    if (path === "/kitchen/comandas/hoy") return { ...v, orders: [], ready: [] };
    return { ok: true };
  });
}

beforeEach(() => {
  apiMock.apiWithDevice.mockReset();
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(async () => {
  try {
    await act(async () => root.unmount());
  } catch {
    /* ya desmontado */
  }
  container.remove();
});

async function settle() {
  for (let i = 0; i < 6; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function render(me: KitchenMe = AP11) {
  root = createRoot(container);
  await act(async () => {
    root.render(<KitchenScreen me={me} />);
  });
  await settle();
}

const $$ = <T extends HTMLElement>(sel: string): T[] => [
  ...container.querySelectorAll<T>(sel),
];
const $ = <T extends HTMLElement>(sel: string): T | null =>
  container.querySelector<T>(sel);

describe("#26 · la sección se ve sin leerla", () => {
  it("cada tarjeta lleva su franja, con el color de SU sección", async () => {
    // EL SABOTAJE: volver la sección a una palabra del eyebrow deja la
    // pantalla sin franjas y las dos secciones iguales.
    monta(
      vista([
        comanda({ id: "o-cocina", section: "COCINA", tableName: "T6" }),
        comanda({ id: "o-barra", section: "BARRA", tableName: "Mostrador nº 3" }),
      ]),
    );
    await render();

    const franjas = $$('[data-testid="kds-franja-seccion"]');
    expect(franjas).toHaveLength(2);
    const cocina = franjas.find((f) => f.dataset.seccion === "COCINA")!;
    const barra = franjas.find((f) => f.dataset.seccion === "BARRA")!;
    expect(cocina.textContent).toBe("COCINA");
    expect(barra.textContent).toBe("BARRA");
    // Colores DISTINTOS, y ninguno es el del semáforo.
    expect(cocina.style.background).toBe(rgb(SECCION_COLOR.COCINA!));
    expect(barra.style.background).toBe(rgb(SECCION_COLOR.BARRA!));
    expect(cocina.style.background).not.toBe(barra.style.background);
  });

  it("la franja es grande: no es una palabra de eyebrow", async () => {
    monta(vista([comanda()]));
    await render();
    const franja = $('[data-testid="kds-franja-seccion"]')!;
    expect(Number.parseInt(franja.style.fontSize, 10)).toBeGreaterThanOrEqual(18);
    expect(Number.parseInt(franja.style.height, 10)).toBeGreaterThanOrEqual(30);
  });

  it("con UNA sola sección no hay franja: la pantalla entera ya lo dice", async () => {
    monta(vista([comanda()]));
    await render(SOLO_COCINA);
    expect($$('[data-testid="kds-franja-seccion"]')).toHaveLength(0);
  });

  it("el tiempo va en su pastilla, aparte del rótulo", async () => {
    monta(vista([comanda()]));
    await render();
    const minutos = $('[data-testid="kds-minutos"]')!;
    expect(minutos.style.borderRadius).toBe("999px");
    expect(minutos.style.border).toMatch(/2px solid/);
  });
});

describe("#24 · la franja «+N» no se pinta vacía", () => {
  it("con todo a la vista no hay franja muerta", async () => {
    // EL SABOTAJE: volver a pintarla siempre devuelve los 90 px muertos.
    monta(vista([comanda()]));
    await render();
    expect($('[data-testid="kds-mas-n"]')).toBeNull();
  });

  it("sin comandas tampoco", async () => {
    monta(vista([]));
    await render();
    expect($('[data-testid="kds-mas-n"]')).toBeNull();
    expect($('[data-testid="kds-vacio"]')).not.toBeNull();
  });
});
