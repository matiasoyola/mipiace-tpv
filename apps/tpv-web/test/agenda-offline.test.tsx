// B-reservas-6a · frente O · el alta creada sin red NO desaparece.
//
// Lo que había antes de este frente, medido: `mergePendingLocal` era un
// stub (`return day.appointments`) con un comentario que decía que
// conservaba las citas optimistas. No conservaba nada. Una cita escrita
// sin red se guardaba en el outbox, la cajera veía un aviso de 3,5
// segundos, **la agenda no la pintaba** y lo único que quedaba era el chip
// de abajo a la derecha. Si al reconectar el servidor la rechazaba, la
// cita no había existido nunca en la pantalla.
//
// Ahora:
//   · la cita encolada se pinta en su hueco, marcada "sin enviar";
//   · la rechazada se queda pintada en rojo con "rechazada", y la agenda
//     enseña un aviso que NO se va solo, con el motivo y "Reintentar";
//   · tocarlas no abre el detalle del servidor —esa cita no está allí—,
//     cuenta en qué estado están.

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

const CORTE = {
  id: "00000000-0000-0000-0000-0000000000p1",
  holdedProductId: "h-corte",
  sku: "SVC-CORTE",
  name: "Corte de pelo",
  basePrice: 14.876,
  priceGross: 18,
  taxRate: 21,
  tags: [] as string[],
  kind: "SERVICE" as const,
  durationMin: 30,
};

vi.mock("../src/lib/catalog.js", () => ({
  loadCatalogFromCache: async () => [CORTE],
  productImageUrl: () => null,
  // clinica-8 · el TPV abre en la agenda cuando el centro tiene historia
  // clínica. Esta peluquería no la tiene, así que abre donde abría ayer.
  getCachedClinicaEnabled: () => false,
}));
vi.mock("../src/lib/clients.js", () => ({
  clientFullName: () => "Rosa Marín",
  loadClientsFromCache: async () => [],
  // agenda-lista · la agenda ya no espera a que alguien abra Clientes:
  // al abrirse se asegura de tener los nombres. Aquí no se prueba eso
  // (lo hace `agenda-lista-clientes-cache.test.ts`), así que basta con
  // que el doble exista y no baje nada.
  asegurarClientesEnCache: async () => false,
}));
vi.mock("../src/hooks/useClientPicker.js", () => ({
  useClientPicker: () => ({ open: () => {}, element: null }),
}));

import {
  __resetOutboxForTests,
  outboxAdd,
  outboxList,
} from "../src/lib/outbox.js";
import { AgendaPage, pxPorMinuto } from "../src/pages/AgendaPage.js";
import { DEFAULT_SLOT_MINUTES } from "../src/lib/agenda.js";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

// 11:10 de pared en Madrid del 15-09-2026 (CEST, UTC+2).
const AHORA = new Date("2026-09-15T09:10:00.000Z");
// agenda-1 · DOS PROFESIONALES, a propósito: lo que este fichero mide es
// la TARJETA de la rejilla (a rayas, en la mitad derecha, con su alto
// real), y la rejilla es el día de VARIAS desde la decisión D1 de Matías.
// Que la cita encolada y la rechazada se vean en la LISTA de una sola
// profesional lo fija `agenda-1-dia-lista.test.tsx`.
const BEA = {
  userId: "00000000-0000-0000-0000-0000000000s9",
  displayName: "Bea",
  color: "#0ea5e9",
  active: true,
};

const SOLE = {
  userId: "00000000-0000-0000-0000-0000000000s1",
  displayName: "Sole",
  color: "#8b5cf6",
  active: true,
};
// Las 11:00 de pared = la franja EN CURSO.
const ONCE = "2026-09-15T09:00:00.000Z";

let container: HTMLDivElement;
let root: Root;

async function encolarAlta(
  extra: { status?: "pending" | "rejected"; lastError?: string } = {},
) {
  const externalId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  await outboxAdd({
    externalId,
    kind: "appointment",
    path: "/agenda/appointments",
    body: {
      externalId,
      clientId: "cl-1",
      items: [{ serviceId: CORTE.id, staffUserId: SOLE.userId }],
      start: ONCE,
      source: "PRESENCIAL",
      notes: null,
    },
    label: "Cita 11:00",
    total: 0,
    durationMin: 30,
  });
  if (extra.status === "rejected") {
    // Lo que deja el outbox cuando el servidor contesta un 4xx.
    const [item] = await outboxList();
    const db = indexedDB.open("mipiacetpv-outbox");
    await new Promise<void>((resolve) => {
      db.onsuccess = () => {
        const tx = db.result.transaction("outbox", "readwrite");
        tx.objectStore("outbox").put({
          ...item,
          status: "rejected",
          lastError: extra.lastError ?? "BOOKING_IN_PAST: Esa hora ya ha pasado.",
        });
        tx.oncomplete = () => {
          db.result.close();
          resolve();
        };
      };
    });
  }
  return externalId;
}

beforeEach(async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ["Date"] });
  vi.setSystemTime(AHORA);
  (globalThis as Record<string, unknown>).indexedDB = new IDBFactory();
  await __resetOutboxForTests();
  apiMock.apiWithCashier.mockReset();
  apiMock.apiWithCashier.mockImplementation(async (path: string) => {
    // El servidor NO conoce la cita: sigue en el outbox.
    if (path.startsWith("/agenda?")) return { staff: [SOLE, BEA], appointments: [] };
    throw new Error(`ruta no mockeada: ${path}`);
  });
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
});

async function settle() {
  for (let i = 0; i < 20; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

async function render() {
  root = createRoot(container);
  await act(async () => {
    root.render(<AgendaPage onClose={() => {}} />);
  });
  await settle();
}

function tarjetas(): HTMLButtonElement[] {
  return Array.from(
    container.querySelectorAll<HTMLButtonElement>("[data-columna] button"),
  );
}

describe("la cita creada sin red se ve en la agenda", () => {
  it("encolada: se pinta en su hueco y dice 'sin enviar'", async () => {
    await encolarAlta();
    await render();
    const card = tarjetas().find((b) => b.textContent?.includes("11:00"));
    expect(card).toBeTruthy();
    expect(card!.textContent).toContain("sin enviar");
    // A rayas: no es una cita del centro todavía.
    expect(card!.className).toContain("border-dashed");
  });

  it("y con su alto real, no una raya de 22 px", async () => {
    await encolarAlta();
    await render();
    const card = tarjetas().find((b) => b.textContent?.includes("11:00"));
    // Sale de `durationMin`, que viaja en el item del outbox y NO se
    // envía al servidor.
    //
    // agenda-1 · y la escala ya no es 1,1 px/min: se deriva de la
    // retícula para que la franja más pequeña que se puede reservar sea
    // tocable. Se importa en vez de copiarse.
    expect(card!.style.height).toBe(
      `${30 * pxPorMinuto(DEFAULT_SLOT_MINUTES)}px`,
    );
  });

  it("el servidor manda: cuando la devuelve, no se pinta dos veces", async () => {
    const externalId = await encolarAlta();
    apiMock.apiWithCashier.mockImplementation(async (path: string) => {
      if (path.startsWith("/agenda?")) {
        return {
          staff: [SOLE, BEA],
          appointments: [
            {
              id: externalId,
              clientId: "cl-1",
              status: "CONFIRMED",
              source: "PRESENCIAL",
              start: ONCE,
              end: "2026-09-15T09:30:00.000Z",
              ticketId: null,
              notes: null,
              items: [],
              assignments: [
                {
                  reservableType: "STAFF",
                  staffUserId: SOLE.userId,
                  resourceId: null,
                },
              ],
            },
          ],
        };
      }
      throw new Error(`ruta no mockeada: ${path}`);
    });
    await render();
    const conLas11 = tarjetas().filter((b) => b.textContent?.includes("11:00"));
    expect(conLas11).toHaveLength(1);
    expect(conLas11[0]!.textContent).not.toContain("sin enviar");
  });
});

describe("la cita que el servidor rechaza NO desaparece en silencio", () => {
  it("se queda pintada, en rojo y diciendo 'rechazada'", async () => {
    await encolarAlta({ status: "rejected" });
    await render();
    const card = tarjetas().find((b) => b.textContent?.includes("11:00"));
    expect(card).toBeTruthy();
    expect(card!.textContent).toContain("rechazada");
    expect(card!.className).toContain("border-red-300");
  });

  it("y la agenda enseña el motivo en un aviso que NO se va solo", async () => {
    await encolarAlta({
      status: "rejected",
      lastError: "BOOKING_IN_PAST: Esa hora ya ha pasado.",
    });
    await render();
    expect(container.textContent).toContain("no se pudo guardar");
    expect(container.textContent).toContain("Esa hora ya ha pasado");
    // Un toast se apaga a los 3,5 s; esto es parte de la pantalla.
    await act(async () => {
      vi.setSystemTime(new Date(AHORA.getTime() + 60_000));
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(container.textContent).toContain("no se pudo guardar");
  });

  it("el aviso trae 'Reintentar', que es la acción que se quiere", async () => {
    await encolarAlta({ status: "rejected" });
    await render();
    const btn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "Reintentar",
    );
    expect(btn).toBeTruthy();
  });

  it("tocar una cita local no abre el detalle del servidor", async () => {
    await encolarAlta({ status: "rejected" });
    await render();
    const card = tarjetas().find((b) => b.textContent?.includes("11:00"))!;
    await act(async () => {
      card.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await settle();
    // El detalle ofrecería "Cobrar en caja" sobre algo que el servidor no
    // tiene. En su lugar, se cuenta qué le pasó.
    expect(
      Array.from(container.querySelectorAll("h2")).some(
        (h) => h.textContent?.trim() === "Detalle",
      ),
    ).toBe(false);
    expect(container.textContent).toContain("No se pudo guardar");
  });
});
