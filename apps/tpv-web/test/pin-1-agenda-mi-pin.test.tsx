// pin-1 · «CAMBIAR MI PIN» EN LA CABECERA DE LA AGENDA.
//
// La sanitaria sin caja entra al TPV con su PIN y lo único que ve es la
// agenda: no tiene el cajón de la venta, que es donde «Cambiar mi PIN»
// está para todos los demás, y al panel no entra —el login se lo dice con
// `CASHIER_NOT_ALLOWED_IN_ADMIN`—. Sin este botón sería **la única
// persona que entra con PIN y no puede cambiarlo**.
//
// En la primera pasada de pin-1 el botón era un flotante colgado de
// `LoggedInWrapper`, porque `AgendaPage` era de la rama `agenda-1` esa
// tarde. Con agenda-1 en master, se va a donde le toca: la cabecera.
//
// Lo que este fichero fija:
//
//   1. **sin el prop no hay botón.** La cabecera de la agenda no tiene
//      píxeles de sobra a 390 (la lección de B-reservas-5 F8 es que lo
//      que se cortaba era la acción principal), así que a la cajera
//      —que ya lo tiene en el cajón— no se le quita sitio;
//   2. **con el prop, el botón está en la BARRA de la cabecera**, con su
//      nombre accesible y el área de toque de la casa;
//   3. **pulsarlo llama al callback**;
//   4. **la rama de la sanitaria lo PASA de verdad**, y abre la hoja del
//      PIN. Un prop que nadie pasa es un botón que no existe.
//
// ── Tabla de sabotajes (cada uno visto en rojo, fichero entero) ──────
//
//   1. el botón se pinta siempre (sin mirar el prop) ··········· cae 1
//   2. el botón no se pinta nunca ····························· caen 7
//   3. `AgendaDelSanitario` deja de pasar `onCambiarMiPin` ····· caen 2
//   4. el botón usa `title` en vez de `aria-label` ············· cae 1
//   5. el botón se pinta FUERA de la barra, suelto en la raíz ·· cae 1
//   6. el botón vuelve al FINAL de la barra (donde se cae a 390) · cae 1
//
// El 5 salió verde a la primera y por eso está escrito: la comprobación
// de «está en la barra» usaba `querySelector` sobre el padre, y la raíz
// de la pantalla contiene la cabecera entera. Se compara el padre
// INMEDIATO.
//
// Lo que este banco NO puede ver: si el botón cabe a 390 px. Eso lo
// contestan las capturas del bloque.

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

vi.mock("../src/lib/catalog.js", () => ({
  loadCatalogFromCache: async () => [],
  productImageUrl: () => null,
  getCachedClinicaEnabled: () => true,
  // `LoggedInWrapper` lee el ensayo de la caché para decidir si pinta la
  // banda. Aquí no está en ensayo: la banda no es de este fichero.
  getCachedEnsayo: () => false,
}));

vi.mock("../src/lib/clients.js", () => ({
  clientFullName: () => "",
  loadClientsFromCache: async () => [],
  asegurarClientesEnCache: async () => false,
}));

vi.mock("../src/hooks/useClientPicker.js", () => ({
  useClientPicker: () => ({
    open: () => {},
    close: () => {},
    isOpen: false,
    element: null,
  }),
}));

import { ApiError } from "../src/api.js";
import { __resetOutboxForTests } from "../src/lib/outbox.js";
import { AgendaPage } from "../src/pages/AgendaPage.js";
import { AgendaDelSanitario } from "../src/App.js";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const AHORA = new Date("2026-10-27T09:40:00.000Z");
const HOY = "2026-10-27";

const ROSARIO = {
  userId: "00000000-0000-0000-0000-0000000000r1",
  displayName: "Rosario",
  color: "#e8663c",
  active: true,
};

function dia(fecha: string) {
  const tramo = [{ startTime: "09:00", endTime: "14:00" }];
  return {
    date: fecha,
    open: tramo,
    closed: null,
    specialName: null,
    staffOpen: { [ROSARIO.userId]: tramo },
    absences: [],
  };
}

let container: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ["Date"] });
  vi.setSystemTime(AHORA);
  (globalThis as Record<string, unknown>).indexedDB = new IDBFactory();
  await __resetOutboxForTests();
  localStorage.clear();
  Element.prototype.scrollIntoView = function () {} as unknown as never;

  apiMock.apiWithCashier.mockReset();
  apiMock.apiWithCashier.mockImplementation(async (path: string) => {
    if (path.startsWith("/agenda?")) {
      const q = new URLSearchParams(path.slice(path.indexOf("?")));
      return {
        staff: [ROSARIO],
        appointments: [],
        slotMinutes: 15,
        days: [dia(q.get("date") ?? HOY)],
        valoracionesPendientes: [],
        sesionesPorCobrar: [],
        proximasCitas: [],
        cobradoPorCita: {},
      };
    }
    if (path === "/agenda/availability") return { slots: [] };
    if (path === "/agenda/health") {
      return { generatedAt: AHORA.toISOString(), cards: [] };
    }
    if (path === "/agenda/skill-matrix") {
      return { editable: true, services: [], staff: [], skills: [] };
    }
    if (path === "/clinica/contrato") {
      return { aceptado: true, version: 2, debeAceptar: false };
    }
    if (path.includes("/history")) return { appointments: [] };
    if (path.includes("/historia")) {
      throw new ApiError(404, "sin historia", "NOT_FOUND");
    }
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

async function asentar() {
  for (let i = 0; i < 25; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

async function pintar(nodo: React.ReactElement) {
  root = createRoot(container);
  await act(async () => root.render(nodo));
  await asentar();
}

function boton(): HTMLButtonElement | null {
  return container.querySelector<HTMLButtonElement>(
    '[data-test="cambiar-mi-pin"]',
  );
}

async function pulsar(el: Element) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await asentar();
}

// ── 1 · SIN EL PROP NO HAY BOTÓN ────────────────────────────────────

describe("el botón sólo existe para quien no tiene otro camino", () => {
  it("sin `onCambiarMiPin` no se pinta: la cajera ya lo tiene en el cajón", async () => {
    // El sabotaje: pintarlo siempre. La cabecera de la agenda es la barra
    // que B-reservas-5 F8 tuvo que rescatar a 390 px; un control más para
    // todo el mundo es la vuelta a ese problema.
    await pintar(<AgendaPage onClose={() => {}} esSanitario />);
    expect(boton()).toBeNull();
  });

  it("con `onCambiarMiPin`, el botón está", async () => {
    await pintar(
      <AgendaPage onClose={() => {}} esSanitario onCambiarMiPin={() => {}} />,
    );
    expect(boton()).not.toBeNull();
  });
});

// ── 2 · DÓNDE ESTÁ Y CÓMO SE LLAMA ──────────────────────────────────

describe("está en la barra de la cabecera, y se llama", () => {
  beforeEach(async () => {
    await pintar(
      <AgendaPage onClose={() => {}} esSanitario onCambiarMiPin={() => {}} />,
    );
  });

  it("vive en la MISMA barra que «Volver» y «Dar cita»", async () => {
    // No vale con que exista: tiene que estar donde se mira.
    //
    // Y se compara el padre INMEDIATO, no `barra.querySelector(...)`: con
    // la búsqueda por descendientes, un botón colgado suelto de la raíz
    // de la pantalla pasaba en verde —la raíz contiene la cabecera, así
    // que «Dar cita» se encontraba igual—. Medido con el sabotaje A5, que
    // sacaba el botón de la barra y no ponía nada rojo.
    const barra = boton()!.parentElement;
    const barraDeDarCita = container.querySelector(
      '[data-test="dar-cita"]',
    )!.parentElement;
    const barraDeVolver = container.querySelector(
      '[aria-label="Volver"]',
    )!.parentElement;
    expect(barra).toBe(barraDeDarCita);
    expect(barra).toBe(barraDeVolver);
  });

  it("dice cómo se llama, y con `aria-label` — en la agenda no hay tooltips", async () => {
    // ux-principles §6: los tooltips están prohibidos en la agenda (en una
    // tablet no existe el hover). El icono solo no es un nombre.
    expect(boton()!.getAttribute("aria-label")).toBe("Cambiar mi PIN");
    expect(boton()!.getAttribute("title")).toBeNull();
  });

  it("va pegado a «Volver», no al final de la barra", async () => {
    // Y esto es una medida, no un gusto. A 390 px la barra de la agenda
    // mide 567 y «Dar cita» ya se sale por la derecha SIN este botón
    // (medido en el banco visual el 28-10). Un botón más al final sería
    // el primero en caerse, y el de la sanitaria es justo el que no
    // puede caerse: no tiene otro camino.
    //
    // Se mira el ORDEN en el documento, que es lo que decide quién se
    // cae cuando la barra no cabe.
    const barra = boton()!.parentElement!;
    const hijos = [...barra.children];
    const iVolver = hijos.findIndex((h) => h.matches('[aria-label="Volver"]'));
    const iPin = hijos.indexOf(boton()!);
    const iDarCita = hijos.findIndex((h) =>
      h.matches('[data-test="dar-cita"]'),
    );
    expect(iVolver).toBeGreaterThanOrEqual(0);
    expect(iPin).toBe(iVolver + 1);
    expect(iPin).toBeLessThan(iDarCita);
  });

  it("mide lo que mide un objetivo táctil de la casa", async () => {
    // 44 px (ux-principles §1.2). Es el mismo `h-11 w-11` que el ⋯ de las
    // ausencias y el botón de Volver, que son sus vecinos.
    expect(boton()!.className).toContain("h-11");
    expect(boton()!.className).toContain("w-11");
  });
});

describe("pulsarlo llama al callback", () => {
  it("una vez, y con el botón de la cabecera", async () => {
    const abrir = vi.fn();
    await pintar(
      <AgendaPage onClose={() => {}} esSanitario onCambiarMiPin={abrir} />,
    );
    await pulsar(boton()!);
    expect(abrir).toHaveBeenCalledTimes(1);
  });
});

// ── 3 · Y LA RAMA DE LA SANITARIA LO PASA ───────────────────────────

describe("el TPV de la sanitaria lo pasa de verdad", () => {
  const SANITARIA = {
    id: ROSARIO.userId,
    email: "rosario@clinica.es",
    alias: "Rosario",
    role: "CLINICIAN" as const,
    isClinician: true,
  };

  async function suTpv() {
    await pintar(
      <AgendaDelSanitario
        cashier={SANITARIA}
        autoLogoutMinutes={10}
        onSalir={() => {}}
      />,
    );
  }

  it("el botón llega a su pantalla", async () => {
    // El sabotaje: quitar `onCambiarMiPin={...}` de `AgendaDelSanitario`.
    // El prop seguiría existiendo y `AgendaPage` seguiría sabiendo
    // pintarlo — y nadie lo pasaría. Es «verde pero nadie la llama».
    await suTpv();
    expect(boton()).not.toBeNull();
  });

  it("y al pulsarlo se abre la hoja del PIN, con su nombre", async () => {
    await suTpv();
    expect(container.querySelector('[data-testid="cambiar-pin"]')).toBeNull();
    await pulsar(boton()!);
    const hoja = container.querySelector('[data-testid="cambiar-pin"]');
    expect(hoja).not.toBeNull();
    // Modo «cambiar»: pide el PIN actual. La de «elegir» (sin el actual)
    // es la del login tras un PIN provisional, y es otra cosa.
    expect(hoja!.textContent).toContain("Cambiar mi PIN");
    expect(hoja!.textContent).toContain("PIN actual");
  });

  it("y no hay ningún botón flotante suelto: el de antes se fue", async () => {
    // La primera pasada de pin-1 lo colgaba de `LoggedInWrapper` con este
    // testid. Si vuelve, hay dos sitios desde los que abrir lo mismo.
    await suTpv();
    expect(
      container.querySelector('[data-testid="sanitario-cambiar-mi-pin"]'),
    ).toBeNull();
  });
});

// ── clinica-11 · Y LA BARRA, QUE A 390 NO CABÍA ─────────────────────
//
// pin-1 dejó medido que a 390 px esta barra mide 547 dentro de 390 y que
// «Dar cita» se salía por la derecha. Lo que la medición del 29-10 añadió
// —navegador, no a ojo— es que detrás de «Dar cita» se iba también el
// conmutador Día | Semana, que es el único modo de llegar a la vista de
// semana:
//
//   agenda            390 → contenido 547 · fuera: Vista, Dar cita
//   agenda-sanitaria  390 → contenido 599 · fuera: Vista, Dar cita
//
// El arreglo es que la barra ENVUELVA: el rótulo de la fecha se queda
// entero en la primera fila y lo que no cabe baja a la segunda. **Sin
// `flex-nowrap` a ningún ancho**, que es la segunda cosa que enseñó la
// medición: con el corte puesto en `md` (768), la barra medía 820 en
// 768 y «Dar cita» se salía en una tablet. Un breakpoint elegido a ojo
// es otro ancho roto; sin él, la barra es una fila mientras quepa.
//
// A 1280×800 cabe todo, así que no envuelve, y `lg:min-h-[72px]` da la
// misma altura que el `h-[72px]` de antes: la barra es idéntica a la de
// ayer, comprobado midiendo antes y después (ver el `-done`).
//
// Lo que este banco puede ver desde jsdom es lo que decide eso, y es por
// lo que estos asserts son de clases y no de píxeles: jsdom no hace
// layout. **Las medidas de verdad están en las capturas del bloque.**
//
// Sabotajes: quitar `flex-wrap` → cae 1; volver a poner un `flex-nowrap`
// → cae 1; pintar «Dar cita» dos veces (una por fila) → cae 1.
describe("clinica-11 · la barra envuelve cuando no cabe", () => {
  async function barra(): Promise<HTMLElement> {
    const h1 = [...container.querySelectorAll("h1")].find(
      (h) => h.textContent?.trim() === "Agenda",
    );
    expect(h1).toBeDefined();
    return h1!.parentElement as HTMLElement;
  }

  it("puede envolver, y a NINGÚN ancho se lo impide un flex-nowrap", async () => {
    await pintar(<AgendaPage onClose={() => {}} esSanitario />);
    const clases = (await barra()).className;
    // Lo que no cabe baja de fila en vez de salirse.
    expect(clases).toContain("flex-wrap");
    // Y nada se lo prohíbe: un `flex-nowrap` con breakpoint es otro ancho
    // roto (a 768 la barra medía 820 y «Dar cita» se salía).
    expect(clases).not.toContain("flex-nowrap");
    // La altura de la fila única se pide con un MÍNIMO, no con una fija:
    // una altura fija recortaría la segunda fila.
    expect(clases).toContain("lg:min-h-[72px]");
    // `(^|\s)` y no `\b`: en «min-h-[72px]» el guión es un no-palabra, así
    // que `\bh-` casaría con la clase buena y este assert sería verde
    // siempre.
    expect(clases).not.toMatch(/(^|\s)h-\[72px\]/);
  });

  it("el separador elástico sólo existe en una fila", async () => {
    // Envolviendo, un `flex-1` en la primera fila la estira y manda el
    // conmutador a la segunda incluso cuando cabría.
    await pintar(<AgendaPage onClose={() => {}} esSanitario />);
    const hijos = [...(await barra()).children];
    const separador = hijos.find((el) => el.className.includes("flex-1"));
    expect(separador).toBeDefined();
    expect(separador!.className).toContain("hidden");
    expect(separador!.className).toContain("lg:block");
  });

  it("«Dar cita» se pinta UNA vez, y se va a la derecha de su fila", async () => {
    // Dos nodos con el mismo `data-test` (uno por fila, con un `hidden`
    // encima) es la trampa que este assert cierra: el banco encontraría
    // el invisible y el `querySelector` del bucle visual también.
    await pintar(<AgendaPage onClose={() => {}} esSanitario />);
    const botones = container.querySelectorAll('[data-test="dar-cita"]');
    expect(botones).toHaveLength(1);
    expect(botones[0]!.className).toContain("ml-auto");
    expect(botones[0]!.className).toContain("lg:ml-0");
    // Y sigue siendo hija directa de la barra: no se ha montado un
    // flotante colgado de la raíz.
    expect(botones[0]!.parentElement).toBe(await barra());
  });
});
