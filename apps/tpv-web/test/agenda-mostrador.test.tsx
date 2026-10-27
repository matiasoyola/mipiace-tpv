// B-reservas-mostrador · lo que la recepcionista ve en el mostrador.
//
// Los cuatro hallazgos del 13-09 en el AP11 (tenant PRUEBAS MIPIACE), en el
// orden del daño:
//
//   F1 · «Reservar» es el primario; «Reservar y cobrar» sólo en una cita de
//        HOY. Un cobro entra en el turno abierto: reservar el jueves y cobrar
//        por inercia descuadra el arqueo de hoy Y el del día de la devolución.
//   F2 · la tarjeta se tiñe con el color de la profesional y sigue diciendo
//        hora, cliente y servicio; la local y la rechazada de 6a NO se tiñen.
//   F4 · ningún botón desactivado es mudo, y sin servicios no hay «fin».
//   F5 · el nombre de la clienta aparece aunque el cliente llegue al caché
//        con la agenda ya abierta; si no se sabe, no se dice «Cliente».
//
// Mismo patrón que `agenda-horario.test.tsx` y `agenda-suelo.test.tsx`:
// createRoot + act + eventos nativos, sin testing-library.

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

// El catálogo y los clientes viven en un caché que el test controla: el
// frente 5 va justamente de que la agenda los RELEA, así que la caché falsa
// es mutable y se cuenta cuántas veces se ha leído.
const cacheMock = vi.hoisted(() => ({
  servicios: [] as unknown[],
  clientes: [] as unknown[],
  lecturasDeClientes: 0,
  lecturasDeCatalogo: 0,
}));

vi.mock("../src/lib/catalog.js", () => ({
  loadCatalogFromCache: async () => {
    cacheMock.lecturasDeCatalogo++;
    return cacheMock.servicios;
  },
  productImageUrl: () => null,
  // clinica-8 · el TPV abre en la agenda cuando el centro tiene historia
  // clínica. Esta peluquería no la tiene, así que abre donde abría ayer.
  getCachedClinicaEnabled: () => false,
}));

const clientesMock = vi.hoisted(() => ({ elegido: null as unknown }));

vi.mock("../src/lib/clients.js", () => ({
  clientFullName: (c: { firstName: string; lastName: string }) =>
    `${c.firstName} ${c.lastName}`.trim(),
  loadClientsFromCache: async () => {
    cacheMock.lecturasDeClientes++;
    return cacheMock.clientes;
  },
  // agenda-lista · la agenda ya no espera a que alguien abra Clientes:
  // al abrirse se asegura de tener los nombres. Aquí no se prueba eso
  // (lo hace `agenda-lista-clientes-cache.test.ts`), así que basta con
  // que el doble exista y no baje nada.
  asegurarClientesEnCache: async () => false,
}));

// El selector es de B1 y tiene sus propios tests: aquí sólo hace falta poder
// disparar su `onSelect` para comprobar que la agenda se entera (F5).
vi.mock("../src/hooks/useClientPicker.js", () => ({
  useClientPicker: () => ({
    open: (onSelect: (c: unknown) => void) => {
      if (clientesMock.elegido) onSelect(clientesMock.elegido);
    },
    close: () => {},
    isOpen: false,
    element: null,
  }),
}));

import { __resetOutboxForTests } from "../src/lib/outbox.js";
import { STATUS_COLOR } from "../src/lib/agenda.js";
import {
  LUMINANCIA_TINTE,
  colorDeCabecera,
  contraste,
  luminanciaRelativa,
  parseHex,
  tinteDeProfesional,
  tonoDeEstado,
} from "../src/lib/staffColor.js";
import { AgendaPage, pxPorMinuto } from "../src/pages/AgendaPage.js";

/** jsdom devuelve los colores en `rgb(...)`, no en hex. */
function hexARgb(hex: string): string {
  const [r, g, b] = parseHex(hex)!;
  return `rgb(${r}, ${g}, ${b})`;
}

/** `rgb(r, g, b)` → "#rrggbb". "" si el elemento no tiene fondo propio. */
function rgbAHex(rgb: string): string {
  const m = /^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/.exec(rgb.trim());
  if (!m) return "";
  const dos = (n: string) => Number(n).toString(16).padStart(2, "0");
  return `#${dos(m[1]!)}${dos(m[2]!)}${dos(m[3]!)}`;
}

/** EL FONDO DE VERDAD de una tarjeta: lo que el navegador va a pintar, no un
 *  atributo `data-` que el test se haya puesto a sí mismo. Sin esto el
 *  sabotaje «tarjeta sin el tinte» pasaba en verde. */
function fondoDe(el: HTMLElement): string {
  return rgbAHex(el.style.backgroundColor);
}

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

// Martes 15-09-2026, 11:10 de pared en Madrid (CEST, UTC+2): con el centro ya
// abierto, para que el suelo de 6a deje reservar a las 12:00 de hoy.
const AHORA = new Date("2026-09-15T09:10:00.000Z");
const HOY = "2026-09-15";
const MANANA = "2026-09-16";

const SOLE = {
  userId: "00000000-0000-0000-0000-0000000000s1",
  displayName: "Sole",
  // Morado oscuro: el caso duro del tinte.
  color: "#4c1d95",
  active: true,
};
const ANA = {
  userId: "00000000-0000-0000-0000-0000000000a1",
  displayName: "Ana",
  // Amarillo clarísimo: el otro caso duro.
  color: "#fef9c3",
  active: true,
};
const ISA = {
  userId: "00000000-0000-0000-0000-0000000000i1",
  displayName: "Isa",
  // Sin color: la agenda le da uno estable derivado de su id.
  color: null,
  active: true,
};

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

const TINTE = { ...CORTE, id: "p-tinte", sku: "SVC-TINTE", name: "Tinte", durationMin: 90 };

function cliente(id: string, firstName: string, lastName: string) {
  return {
    id,
    externalId: null,
    firstName,
    lastName,
    phone: null,
    email: null,
    birthdate: null,
    holdedContactId: null,
    marketingOptIn: false,
    notes: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

const CARMEN = cliente("cl-carmen", "Carmen", "Ruiz");

/** ISO UTC de una hora de pared de Madrid de un día dado (CEST = UTC+2). */
function madrid(date: string, hhmm: string): string {
  const [hh, mm] = hhmm.split(":").map(Number);
  return new Date(
    `${date}T${String((hh ?? 0) - 2).padStart(2, "0")}:${String(mm ?? 0).padStart(2, "0")}:00.000Z`,
  ).toISOString();
}

// agenda-1 · la escala ya no es una constante: sale de la retícula, para
// que la franja más pequeña que se puede reservar sea tocable.
function pxPorMin(): number {
  return pxPorMinuto(respuesta.slotMinutes ?? 15);
}

function cita(
  id: string,
  clientId: string | null,
  staffUserId: string,
  status: string,
  hhmm: string,
  durationMin = 30,
  extra: Record<string, unknown> = {},
) {
  const start = madrid(HOY, hhmm);
  return {
    id,
    clientId,
    status,
    source: "PRESENCIAL",
    start,
    end: new Date(new Date(start).getTime() + durationMin * 60_000).toISOString(),
    ticketId: null,
    notes: null,
    items: [{ id: `${id}-i0`, serviceId: CORTE.id, durationMin, sortOrder: 0, startOffsetMin: 0 }],
    assignments: [{ reservableType: "STAFF" as const, staffUserId, resourceId: null }],
    ...extra,
  };
}

interface Dia {
  date?: string;
  open: Array<{ startTime: string; endTime: string }> | null;
  closed: { name: string | null } | null;
  specialName: string | null;
  staffOpen: Record<string, Array<{ startTime: string; endTime: string }>>;
  absences: Array<{
    id: string | null;
    staffUserId: string | null;
    startTime: string;
    endTime: string;
    reason: string | null;
  }>;
}

function diaAbierto(staff: Array<{ userId: string }>): Dia {
  const tramo = [{ startTime: "09:00", endTime: "20:00" }];
  return {
    open: tramo,
    closed: null,
    specialName: null,
    staffOpen: Object.fromEntries(staff.map((s) => [s.userId, tramo])),
    absences: [],
  };
}

let respuesta: {
  staff: Array<typeof SOLE>;
  appointments: unknown[];
  slotMinutes?: number;
  dia: Dia;
};
let llamadas: Array<{ path: string; init?: unknown }>;
let slotsDeBusqueda: Array<{ start: string; end: string; options: number }>;

let container: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ["Date"] });
  vi.setSystemTime(AHORA);
  (globalThis as Record<string, unknown>).indexedDB = new IDBFactory();
  await __resetOutboxForTests();
  llamadas = [];
  slotsDeBusqueda = [];
  cacheMock.servicios = [CORTE, TINTE];
  cacheMock.clientes = [CARMEN];
  cacheMock.lecturasDeClientes = 0;
  cacheMock.lecturasDeCatalogo = 0;
  clientesMock.elegido = null;
  // agenda-1 · DOS PROFESIONALES por defecto, a propósito: desde la
  // decisión D1 de Matías el día de UNA es una LISTA y la REJILLA —que es
  // lo que casi todo este fichero mide (el tinte de la tarjeta, el toque
  // en una franja, la cabecera con su color)— es el día de VARIAS. Lo que
  // Rosario ve en su lista lo fija `agenda-1-dia-lista.test.tsx`.
  respuesta = {
    staff: [SOLE, ANA],
    appointments: [],
    slotMinutes: 15,
    dia: diaAbierto([SOLE, ANA]),
  };
  apiMock.apiWithCashier.mockReset();
  apiMock.apiWithCashier.mockImplementation(
    async (path: string, init?: unknown) => {
      llamadas.push({ path, init });
      if (path.startsWith("/agenda?")) {
        // El día que pinta la agenda es el que ha pedido: así `dayInfo`
        // existe también cuando se cambia de día con las flechas.
        //
        // agenda-1 · y la vista de SEMANA pide un RANGO (`from`+`to`, que
        // `GET /agenda` ya aceptaba desde B4): entonces se devuelve un
        // `days[]` por fecha, que es lo que el servidor hace.
        const q = new URLSearchParams(path.slice(path.indexOf("?")));
        const desde = q.get("from");
        const hasta = q.get("to");
        if (desde && hasta) {
          const fechas: string[] = [];
          for (let t = Date.parse(`${desde}T12:00:00Z`); t <= Date.parse(`${hasta}T12:00:00Z`); t += 86_400_000) {
            fechas.push(new Date(t).toISOString().slice(0, 10));
          }
          return {
            ...respuesta,
            days: fechas.map((date) => ({ ...respuesta.dia, date })),
          };
        }
        const pedido = q.get("date") ?? HOY;
        return { ...respuesta, days: [{ ...respuesta.dia, date: pedido }] };
      }
      if (path === "/agenda/availability") return { slots: slotsDeBusqueda };
      if (path === "/agenda/health") return { generatedAt: AHORA.toISOString(), cards: [] };
      if (path === "/agenda/appointments") {
        return { appointment: cita("ap-nueva", null, SOLE.userId, "CONFIRMED", "12:00") };
      }
      throw new Error(`ruta no mockeada: ${path}`);
    },
  );
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

async function click(el: Element) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await settle();
}

function texto(): string {
  return container.textContent ?? "";
}

function columna(userId: string): HTMLElement {
  const col = container.querySelector<HTMLElement>(`[data-columna="${userId}"]`);
  if (!col) throw new Error(`no hay columna de ${userId}`);
  return col;
}

function origenMin(): number {
  const primera = container.querySelector<HTMLElement>("[data-hora]");
  if (!primera) throw new Error("la regla no tiene horas");
  return Number(primera.dataset.hora!.slice(0, 2)) * 60;
}

async function tocarFranja(userId: string, hhmm: string) {
  const col = columna(userId);
  vi.spyOn(col, "getBoundingClientRect").mockReturnValue({
    top: 0, left: 0, right: 200, bottom: 2000, width: 200, height: 2000,
    x: 0, y: 0, toJSON: () => ({}),
  } as DOMRect);
  const [hh, mm] = hhmm.split(":").map(Number);
  const y = ((hh ?? 0) * 60 + (mm ?? 0) - origenMin()) * pxPorMin();
  await act(async () => {
    col.dispatchEvent(new MouseEvent("click", { bubbles: true, clientY: y }));
  });
  await settle();
}

/**
 * Cambia de día.
 *
 * agenda-1 · la tira de SIETE chips se fue de la cabecera (decisión de
 * Matías, 27-10: «fuera los chips de días»), y su trabajo —ver y comparar
 * varios días— lo hace ahora la vista de Semana. Para moverse un día están
 * las flechas, que ya NO son `hidden sm:flex`: eran redundantes con la tira
 * y sin ella son el único modo. Y la vuelta a HOY es su propio botón, que
 * sólo aparece cuando el día no es hoy.
 */
async function irAlDia(date: string) {
  if (date === HOY) {
    const hoy = container.querySelector<HTMLButtonElement>(
      '[data-test="volver-a-hoy"]',
    );
    if (hoy) await click(hoy);
    return;
  }
  const dias = Math.round(
    (Date.parse(`${date}T12:00:00Z`) - Date.parse(`${HOY}T12:00:00Z`)) /
      86_400_000,
  );
  const flecha = porEtiqueta(dias > 0 ? "Día siguiente" : "Día anterior");
  for (let i = 0; i < Math.abs(dias); i++) await click(flecha);
}

/** Un botón por su `aria-label` (los que sólo llevan icono). */
function porEtiqueta(label: string): HTMLButtonElement {
  const b = container.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`);
  if (!b) throw new Error(`no hay botón con aria-label "${label}"`);
  return b;
}

function botonPorTexto(text: string): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll("button")).find(
    (b) => (b.textContent ?? "").trim() === text,
  ) as HTMLButtonElement | undefined;
}

function accion(nombre: string): HTMLButtonElement | null {
  return container.querySelector<HTMLButtonElement>(`[data-accion="${nombre}"]`);
}

function servicio(nombre: string): HTMLButtonElement {
  const btn = Array.from(container.querySelectorAll("button")).find((b) =>
    (b.textContent ?? "").includes(nombre),
  );
  if (!btn) throw new Error(`no hay servicio "${nombre}"`);
  return btn as HTMLButtonElement;
}

/** El pie del panel de «Dar cita»: lo que mide es lo que no puede saltar. */
function pieDelPanel(): HTMLElement {
  const pie = container.querySelector<HTMLElement>(
    '[data-test="pie-del-panel"]',
  );
  if (!pie) throw new Error("el panel de «Dar cita» no está abierto");
  return pie;
}

/** La columna de botones del pie: «Reservar» y la ranura del secundario. */
function botonesDelPie(): HTMLElement {
  return accion("reservar")!.parentElement as HTMLElement;
}

/** Abre «Dar cita» desde la cabecera. */
async function abrirDarCita() {
  await click(
    container.querySelector<HTMLButtonElement>('[data-test="dar-cita"]')!,
  );
}

// ── F1 · el botón que no descuadra dos arqueos ────────────────────────

describe("F1 · «Reservar» es el primario y «Reservar y cobrar» sólo es de hoy", () => {
  it("el primario es «Reservar», y va PRIMERO en el DOM", async () => {
    await render();
    await tocarFranja(SOLE.userId, "12:00");

    const reservar = accion("reservar")!;
    const cobrar = accion("reservar-y-cobrar")!;
    expect(reservar.textContent?.trim()).toBe("Reservar");
    expect(cobrar.textContent?.trim()).toBe("Reservar y cobrar");

    // Primario = el coral de la casa. El secundario, borde gris.
    expect(reservar.className).toContain("bg-mipiace-coral");
    expect(cobrar.className).not.toContain("bg-mipiace-coral");

    // Y el orden del DOM, que es el orden del tabulador.
    expect(
      reservar.compareDocumentPosition(cobrar) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("en una cita de OTRO DÍA no hay «Reservar y cobrar» en ninguna forma", async () => {
    await render();
    await irAlDia(MANANA);
    await tocarFranja(SOLE.userId, "12:00");

    expect(accion("reservar")).not.toBeNull();
    expect(accion("reservar-y-cobrar")).toBeNull();
    expect(botonPorTexto("Reservar y cobrar")).toBeUndefined();
    expect(texto()).toContain("Se cobra el día de la cita.");
  });

  it("el pie mide lo mismo con y sin el secundario: no hay salto de layout", async () => {
    await render();
    await tocarFranja(SOLE.userId, "12:00");
    const conBoton = pieDelPanel().innerHTML;
    const piezasHoy = pieDelPanel().children.length;
    const botonesHoy = botonesDelPie().children.length;

    await irAlDia(MANANA);
    await tocarFranja(SOLE.userId, "12:00");

    expect(conBoton).toContain("Reservar y cobrar");
    // agenda-1 · el pie es el del tablero 3: el resumen a la izquierda y
    // la columna de botones a la derecha. Dos piezas, y las dos están
    // SIEMPRE — con la cita de hoy y con la de otro día.
    expect(pieDelPanel().children.length).toBe(piezasHoy);
    expect(piezasHoy).toBe(2);
    // Y la ranura del secundario conserva su alto aunque el botón no
    // exista: si desapareciera, «Reservar» subiría de golpe justo cuando
    // la recepción va a tocarlo.
    expect(botonesDelPie().children.length).toBe(botonesHoy);
    expect(botonesHoy).toBe(2);
    const ranura = botonesDelPie().children[1] as HTMLElement;
    expect(ranura.className).toContain("h-11");
    expect(ranura.textContent).toContain("Se cobra el día de la cita.");
  });

  it("ningún atajo lleva a cobrar: el panel no tiene form ni submit", async () => {
    await render();
    await tocarFranja(SOLE.userId, "12:00");
    expect(container.querySelector("form")).toBeNull();
    expect(container.querySelector('[type="submit"]')).toBeNull();
    // Y ninguno de los botones del pie es el botón por defecto del navegador.
    for (const b of [accion("reservar")!, accion("reservar-y-cobrar")!]) {
      expect(b.getAttribute("type")).not.toBe("submit");
    }
  });

  it("volver a HOY devuelve el botón, y sigue sin ser el primario", async () => {
    await render();
    await irAlDia(MANANA);
    await tocarFranja(SOLE.userId, "12:00");
    expect(accion("reservar-y-cobrar")).toBeNull();

    await irAlDia(HOY);
    await tocarFranja(SOLE.userId, "12:00");
    expect(accion("reservar-y-cobrar")).not.toBeNull();
    expect(accion("reservar")!.className).toContain("bg-mipiace-coral");
    expect(accion("reservar-y-cobrar")!.className).not.toContain("bg-mipiace-coral");
  });

  it("«Reservar» guarda SIN pasar por caja", async () => {
    await render();
    await tocarFranja(SOLE.userId, "12:00");
    await click(servicio("Corte de pelo"));
    await click(accion("reservar")!);

    const rutas = llamadas.map((l) => l.path);
    expect(rutas).toContain("/agenda/appointments");
    expect(rutas.some((p) => p.includes("/checkout"))).toBe(false);
  });
});

// ── F2 · la cita se ve y se sabe de quién es ──────────────────────────

/** Las tarjetas de cita de una columna, en orden. */
function tarjetas(userId: string): HTMLButtonElement[] {
  return Array.from(
    columna(userId).querySelectorAll<HTMLButtonElement>("button[data-cita]"),
  );
}

function tarjetaDe(hhmm: string): HTMLButtonElement {
  // agenda-1 · por `[data-cita]` y no por el texto: desde este bloque los
  // HUECOS LIBRES de la rejilla también son botones que empiezan por su
  // hora («11:00 · libre 1 h»), y buscar por texto cogería el hueco.
  const t = Array.from(
    container.querySelectorAll<HTMLButtonElement>("button[data-cita]"),
  ).find((b) => (b.textContent ?? "").startsWith(hhmm));
  if (!t) throw new Error(`no hay tarjeta de las ${hhmm}`);
  return t;
}

describe("F2 · la tarjeta se tiñe con el color de la profesional", () => {
  beforeEach(() => {
    respuesta.staff = [SOLE, ANA, ISA];
    respuesta.dia = diaAbierto([SOLE, ANA, ISA]);
    respuesta.appointments = [
      cita("ap-sole", CARMEN.id, SOLE.userId, "CONFIRMED", "12:00"),
      cita("ap-ana", CARMEN.id, ANA.userId, "PENDING", "13:00"),
      cita("ap-isa", CARMEN.id, ISA.userId, "IN_SERVICE", "14:00"),
    ];
  });

  it("cada columna tiñe SUS citas, y tres profesionales dan tres tintes", async () => {
    await render();
    const tinteSole = fondoDe(tarjetaDe("12:00"));
    const tinteAna = fondoDe(tarjetaDe("13:00"));
    const tinteIsa = fondoDe(tarjetaDe("14:00"));

    expect(tinteSole).toBe(tinteDeProfesional(SOLE.userId, SOLE.color));
    expect(tinteAna).toBe(tinteDeProfesional(ANA.userId, ANA.color));
    expect(new Set([tinteSole, tinteAna, tinteIsa]).size).toBe(3);
    // Y ninguno es blanco: la tarjeta deja de ser blanca sobre blanco.
    for (const t of [tinteSole, tinteAna, tinteIsa]) {
      expect(t).not.toBe("#ffffff");
    }
  });

  it("el morado OSCURO y el amarillo CLARÍSIMO acaban con el mismo peso visual", async () => {
    await render();
    const lSole = luminanciaRelativa(parseHex(fondoDe(tarjetaDe("12:00")))!);
    const lAna = luminanciaRelativa(parseHex(fondoDe(tarjetaDe("13:00")))!);
    expect(Math.abs(lSole - lAna)).toBeLessThan(0.01);
    expect(lSole).toBeGreaterThan(LUMINANCIA_TINTE - 0.01);
  });

  it("la profesional SIN color tiene tinte, y el mismo en cada repintado", async () => {
    await render();
    const primero = fondoDe(tarjetaDe("14:00"));
    expect(primero).toBeTruthy();
    expect(primero).not.toBe("#ffffff");
    // Repintar (cambiar de día y volver) no le cambia el color.
    await irAlDia(MANANA);
    await irAlDia(HOY);
    expect(fondoDe(tarjetaDe("14:00"))).toBe(primero);
  });

  it("el color es un REFUERZO: la tarjeta sigue diciendo hora, cliente y servicio", async () => {
    // Una cita larga, que es cuando la tarjeta da para las dos líneas
    // (`CARD_TWO_LINE_MIN_H` de B-5 F8: por debajo se pinta sólo la primera,
    // y eso no lo cambia este bloque).
    respuesta.appointments = [
      cita("ap-sole", CARMEN.id, SOLE.userId, "CONFIRMED", "12:00", 90),
    ];
    await render();
    const t = tarjetaDe("12:00");
    expect(fondoDe(t)).toBe(tinteDeProfesional(SOLE.userId, SOLE.color));
    expect(t.textContent).toContain("12:00");
    expect(t.textContent).toContain("Carmen Ruiz");
    expect(t.textContent).toContain("Corte de pelo");
  });

  it("el filete del ESTADO sigue ahí, con su tono legible encima del tinte", async () => {
    await render();
    const t = tarjetaDe("12:00");
    const esperado = tonoDeEstado(STATUS_COLOR.CONFIRMED);
    expect(t.style.borderLeft).toContain("4px solid");
    // jsdom normaliza el hex a rgb(): se compara por el color resuelto.
    expect(t.style.borderLeftColor).toBe(hexARgb(esperado));
    expect(contraste(esperado, fondoDe(t))).toBeGreaterThanOrEqual(3);
  });

  it("la cita LOCAL y la RECHAZADA de 6a NO se tiñen: siguen distinguiéndose", async () => {
    respuesta.appointments = [
      cita("ap-sole", CARMEN.id, SOLE.userId, "CONFIRMED", "12:00"),
      cita("ap-local", CARMEN.id, SOLE.userId, "PENDING", "15:00", 30, {
        pendingOffline: true,
      }),
      cita("ap-rech", CARMEN.id, SOLE.userId, "PENDING", "16:00", 30, {
        pendingOffline: true,
        outboxStatus: "rejected",
        outboxError: "TAKEN: El hueco ya no está disponible.",
      }),
    ];
    await render();

    expect(fondoDe(tarjetaDe("12:00"))).toBeTruthy();
    const local = tarjetaDe("15:00");
    const rechazada = tarjetaDe("16:00");
    // Sin fondo propio: el suyo lo ponen sus clases (`bg-amber-50` /
    // `bg-red-50`), que es lo que las distingue de una cita de verdad.
    expect(fondoDe(local)).toBe("");
    expect(fondoDe(rechazada)).toBe("");
    // Y siguen con sus rayas discontinuas en la mitad derecha.
    for (const el of [local, rechazada]) {
      expect(el.className).toContain("border-dashed");
      expect(el.className).toContain("left-1/2");
    }
    expect(local.className).toContain("amber");
    expect(rechazada.className).toContain("red");
  });

  it("el rayado de «no reservable» pesa MENOS que antes, y sigue estando", async () => {
    respuesta.dia = {
      ...diaAbierto([SOLE, ANA, ISA]),
      open: [{ startTime: "10:00", endTime: "17:00" }],
      staffOpen: Object.fromEntries(
        [SOLE, ANA, ISA].map((s) => [s.userId, [{ startTime: "10:00", endTime: "17:00" }]]),
      ),
    };
    await render();
    const banda = container.querySelector<HTMLElement>("[data-no-reservable]");
    expect(banda).not.toBeNull();
    // La opacidad del rayado baja de 0,18 a 0,09, y el fondo de 100 a 50.
    expect(banda!.className).toContain("rgba(148,163,184,0.09)");
    expect(banda!.className).not.toContain("0.18");
    expect(banda!.className).toContain("bg-slate-50");
  });

  it("la cabecera de la columna lleva el color de la profesional", async () => {
    await render();
    const cabecera = container.querySelector<HTMLElement>(
      `[data-ausencia-menu="${ISA.userId}"]`,
    )!.parentElement!;
    expect(cabecera.style.borderTop).toContain(
      hexARgb(colorDeCabecera(ISA.userId, ISA.color)),
    );
  });

  it("y un color CLARÍSIMO no desaparece sobre el blanco de la cabecera", async () => {
    // Ana tiene un amarillo casi blanco (#fef9c3). Con el color crudo, el
    // filete de 3 px se perdía y la columna se quedaba sin marca. Lo cogió
    // el bucle visual.
    await render();
    const cabecera = container.querySelector<HTMLElement>(
      `[data-ausencia-menu="${ANA.userId}"]`,
    )!.parentElement!;
    const filete = rgbAHex(
      cabecera.style.borderTopColor || cabecera.style.borderColor,
    );
    expect(filete).not.toBe(ANA.color);
    expect(contraste(filete, "#ffffff")).toBeGreaterThanOrEqual(3);
  });
});

// ── F4 · ningún botón mudo ────────────────────────────────────────────

function motivo(cual: string): HTMLElement | null {
  return container.querySelector<HTMLElement>(`[data-motivo="${cual}"]`);
}

describe("F4 · un botón apagado dice qué le falta, en texto", () => {
  // agenda-1 · «Buscar hueco» YA NO EXISTE. La búsqueda sale de contestar
  // «¿Cuándo?», que es un toque menos y es el objetivo del bloque. Así que
  // ya no hay un botón apagado que explicar: lo que hay es un paso que NO
  // SE OFRECE hasta que tiene sentido. El invariante de F4 sigue entero —
  // nada apagado y mudo, ningún tooltip, el motivo en texto visible— y es
  // lo que estos tests fijan sobre la superficie nueva.

  /** ¿Está el paso «¿Cuándo?» a la vista? */
  function hayPasoCuando(): boolean {
    return (
      container.querySelector('[data-test="cuando-esta-semana"]') !== null
    );
  }

  it("sin servicio no se ofrece «¿Cuándo?»: no hay botón mudo que apagar", async () => {
    await render();
    await abrirDarCita();
    expect(hayPasoCuando()).toBe(false);
    expect(motivo("reservar")!.textContent).toBe(
      "Faltan el servicio y la hora.",
    );
  });

  it("con un servicio elegido aparece «¿Cuándo?» y el motivo se queda en la hora", async () => {
    await render();
    await abrirDarCita();
    await click(servicio("Corte de pelo"));
    expect(hayPasoCuando()).toBe(true);
    expect(motivo("reservar")!.textContent).toBe("Falta la hora.");
  });

  it("en un día PASADO lo dice, aunque el servicio ya esté elegido", async () => {
    await render();
    // Al día de ayer sólo se llega por la flecha. El panel se abre por el
    // botón de la cabecera, porque tocar una franja de un día pasado no
    // abre nada (el suelo de 6a, intacto).
    await click(porEtiqueta("Día anterior"));
    await abrirDarCita();
    await click(servicio("Corte de pelo"));
    // Con el servicio YA elegido, el motivo no puede seguir siendo el
    // servicio: la causa de verdad es el día.
    expect(motivo("dia-pasado")!.textContent).toContain("ya ha pasado");
  });

  it("y el día pasado no se ofrece como «el día que estás viendo»", async () => {
    await render();
    await click(porEtiqueta("Día anterior"));
    await abrirDarCita();
    await click(servicio("Corte de pelo"));
    // Ofrecerlo sería ofrecer una hora que el motor va a rechazar.
    expect(
      container.querySelector('[data-test="cuando-el-dia-visto"]'),
    ).toBeNull();
  });

  it("el motivo NUNCA va en un tooltip: ux-principles §6 los prohíbe", async () => {
    await render();
    await abrirDarCita();
    for (const b of Array.from(container.querySelectorAll("button"))) {
      expect(b.hasAttribute("title")).toBe(false);
    }
    // Y el motivo es texto que se lee sin tocar nada.
    expect(texto()).toContain("Faltan el servicio y la hora.");
  });

  it("«Reservar» sin servicio lo dice, y se calla al elegirlo", async () => {
    await render();
    await tocarFranja(SOLE.userId, "12:00");
    expect(accion("reservar")!.disabled).toBe(true);
    expect(motivo("reservar")!.textContent).toBe("Falta el servicio.");

    await click(servicio("Corte de pelo"));
    expect(accion("reservar")!.disabled).toBe(false);
    expect(motivo("reservar")).toBeNull();
  });

  it("sin hora y sin servicio, lo dice de los dos de una vez", async () => {
    await render();
    await abrirDarCita();
    expect(motivo("reservar")!.textContent).toBe(
      "Faltan el servicio y la hora.",
    );
  });

  it("con servicio pero sin hora, sólo la hora", async () => {
    await render();
    await abrirDarCita();
    await click(servicio("Corte de pelo"));
    expect(motivo("reservar")!.textContent).toBe("Falta la hora.");
  });

  it("NO nombra el cliente: una cita sin cliente es legal desde B4", async () => {
    await render();
    await tocarFranja(SOLE.userId, "12:00");
    await click(servicio("Corte de pelo"));
    // Sin cliente y con servicio y hora: se reserva.
    expect(accion("reservar")!.disabled).toBe(false);
    expect(motivo("reservar")).toBeNull();
    expect(texto()).not.toContain("Falta el cliente");
  });

  it("el motivo NO vive en la columna de los botones: no los puede mover", async () => {
    await render();
    await tocarFranja(SOLE.userId, "12:00");
    // agenda-1 · antes era una ranura de alto fijo encima del primario;
    // ahora el motivo está en la OTRA mitad del pie (el resumen), así que
    // aparecer o irse no puede mover el botón — el invariante se cumple
    // por la forma y no por un alto a mano.
    expect(botonesDelPie().contains(motivo("reservar"))).toBe(false);
    const botones = botonesDelPie().children.length;

    await click(servicio("Corte de pelo"));
    expect(motivo("reservar")).toBeNull();
    expect(botonesDelPie().children.length).toBe(botones);
  });
});

// ── F4 · sin duración no hay «fin» ────────────────────────────────────

describe("F4 · «fin» sólo existe si hay algo que dure", () => {
  // agenda-1 · el fin se dice en el RESUMEN del pie («Mar 15 sept ·
  // 12:00–12:30»), que es lo que la recepción le lee a la clienta antes de
  // tocar «Reservar». El invariante es el del AP11 y no cambia: una hora
  // de fin falsa es peor que ninguna.
  function resumen(): string {
    return (
      container.querySelector('[data-test="resumen-de-la-cita"]')
        ?.textContent ?? ""
    );
  }

  it("con la hora puesta y CERO servicios no se dice ningún fin", async () => {
    await render();
    await tocarFranja(SOLE.userId, "12:00");
    // Éste es el fallo del AP11: decía «fin 12:00» para una cita que
    // empieza a las 12:00 (docs/qa/2026-09-13-ap11/20-lunes-cita.png).
    expect(resumen()).not.toContain("12:00–");
    expect(resumen()).not.toContain("min");
  });

  it("al elegir un servicio aparece el fin de verdad", async () => {
    await render();
    await tocarFranja(SOLE.userId, "12:00");
    await click(servicio("Corte de pelo")); // 30 min
    expect(resumen()).toContain("12:00–12:30");
    expect(resumen()).toContain("30 min");
  });

  it("dos servicios encadenados suman, y el fin lo dice", async () => {
    await render();
    await tocarFranja(SOLE.userId, "12:00");
    await click(servicio("Corte de pelo")); // 30
    await click(servicio("Tinte")); // 90
    expect(resumen()).toContain("12:00–14:00");
    expect(resumen()).toContain("2 h");
  });

  it("quitar el último servicio se lleva el fin con él", async () => {
    await render();
    await tocarFranja(SOLE.userId, "12:00");
    await click(servicio("Corte de pelo"));
    expect(resumen()).toContain("12:00–12:30");
    await click(servicio("Corte de pelo")); // lo deselecciona
    expect(resumen()).not.toContain("12:00–");
  });
});

// ── F5 · el nombre de la clienta siempre ──────────────────────────────

describe("F5 · el nombre real aparece aunque el cliente llegue después", () => {
  beforeEach(() => {
    respuesta.appointments = [
      cita("ap-sole", CARMEN.id, SOLE.userId, "CONFIRMED", "12:00", 90),
    ];
  });

  it("el cliente que YA estaba en el caché se pinta con su nombre", async () => {
    await render();
    expect(tarjetaDe("12:00").textContent).toContain("Carmen Ruiz");
  });

  it("un cliente que llega al caché DESPUÉS de montar aparece al recargar el día", async () => {
    // Arranca sin ese cliente en el caché: es lo que pasa cuando la ficha se
    // crea desde otro terminal, o cuando el sync la trae con la agenda ya
    // abierta.
    cacheMock.clientes = [];
    await render();
    expect(tarjetaDe("12:00").textContent).toContain("Sin nombre");

    // Llega al caché y se recarga el día (cambiar de día y volver, o el
    // repintado que dispara el outbox).
    cacheMock.clientes = [CARMEN];
    await irAlDia(MANANA);
    await irAlDia(HOY);
    expect(tarjetaDe("12:00").textContent).toContain("Carmen Ruiz");
    expect(tarjetaDe("12:00").textContent).not.toContain("Sin nombre");
  });

  it("el caché de clientes se RELEE en cada carga del día, no sólo al montar", async () => {
    await render();
    const alMontar = cacheMock.lecturasDeClientes;
    expect(alMontar).toBeGreaterThan(0);
    await irAlDia(MANANA);
    expect(cacheMock.lecturasDeClientes).toBeGreaterThan(alMontar);
  });

  it("y el del CATÁLOGO también: un servicio nuevo deja de ser «Servicio»", async () => {
    // El mismo patrón «cargar una vez al montar» estaba en el catálogo.
    cacheMock.servicios = [];
    await render();
    expect(tarjetaDe("12:00").textContent).toContain("Servicio");
    expect(tarjetaDe("12:00").textContent).not.toContain("Corte de pelo");

    cacheMock.servicios = [CORTE, TINTE];
    await irAlDia(MANANA);
    await irAlDia(HOY);
    expect(tarjetaDe("12:00").textContent).toContain("Corte de pelo");
  });

  it("elegir un cliente en el selector lo enseña SIN recargar nada", async () => {
    cacheMock.clientes = [];
    respuesta.appointments = [];
    clientesMock.elegido = CARMEN;
    await render();
    await tocarFranja(SOLE.userId, "12:00");

    // Al abrir el selector, el mock dispara `onSelect` con Carmen.
    await click(container.querySelector<HTMLButtonElement>('[data-test="elegir-paciente"]')!);
    expect(texto()).toContain("Carmen Ruiz");

    // Y la cita que se cree con ella ya sale con su nombre, sin esperar a
    // que el caché se vuelva a leer.
    respuesta.appointments = [
      cita("ap-nueva", CARMEN.id, SOLE.userId, "CONFIRMED", "12:00", 90),
    ];
    await click(servicio("Corte de pelo"));
    await click(accion("reservar")!);
    expect(tarjetaDe("12:00").textContent).toContain("Carmen Ruiz");
  });
});

describe("F5 · «Cliente» deja de leerse como un nombre", () => {
  it("un id que no se conoce se lee como un dato que FALTA, apagado", async () => {
    cacheMock.clientes = [];
    respuesta.appointments = [
      cita("ap-x", "cl-desconocida", SOLE.userId, "CONFIRMED", "12:00", 90),
    ];
    await render();

    const marca = container.querySelector<HTMLElement>("[data-cliente-desconocido]");
    expect(marca).not.toBeNull();
    expect(marca!.textContent).toBe("Sin nombre");
    // Lo que lo distingue de un nombre de verdad es la CURSIVA y el peso
    // normal — NO un gris claro. Sobre el tinte de la tarjeta, `slate-400`
    // da 1,95:1: ilegible. Lo cogió el bucle visual, no un test.
    expect(marca!.className).toContain("italic");
    expect(marca!.className).toContain("font-normal");
    expect(marca!.className).not.toContain("text-slate-400");
    expect(marca!.className).not.toContain("text-slate-300");
    // Y ya no dice «Cliente», que es lo que engañaba.
    expect(tarjetaDe("12:00").textContent).not.toContain("· Cliente");
  });

  it("una cita SIN cliente sigue diciendo «Sin cliente», que es otra cosa", async () => {
    respuesta.appointments = [
      cita("ap-sin", null, SOLE.userId, "CONFIRMED", "12:00", 90),
    ];
    await render();
    expect(tarjetaDe("12:00").textContent).toContain("Sin cliente");
    // «Sin cliente» NO es un dato que falte: es una cita que no tiene ficha
    // asociada a propósito (la reserva por teléfono de B4).
    expect(
      container.querySelector("[data-cliente-desconocido]"),
    ).toBeNull();
  });

  it("el detalle de la cita marca lo mismo", async () => {
    cacheMock.clientes = [];
    respuesta.appointments = [
      cita("ap-x", "cl-desconocida", SOLE.userId, "CONFIRMED", "12:00", 90),
    ];
    await render();
    await click(tarjetaDe("12:00"));

    const marcas = container.querySelectorAll("[data-cliente-desconocido]");
    // Una en la tarjeta y otra en el panel de detalle.
    expect(marcas.length).toBe(2);
    expect(texto()).toContain("Sin nombre");
  });

  it("con el nombre sabido, el detalle NO marca nada", async () => {
    respuesta.appointments = [
      cita("ap-sole", CARMEN.id, SOLE.userId, "CONFIRMED", "12:00", 90),
    ];
    await render();
    await click(tarjetaDe("12:00"));
    expect(texto()).toContain("Carmen Ruiz");
    expect(container.querySelector("[data-cliente-desconocido]")).toBeNull();
  });
});

// ── La rutina de Sole · reservas a SEMANAS vista ──────────────────────
//
// No sale de las capturas del 13-09 sino de cruzar lo que cubre la suite
// con cómo trabaja el centro: Sole reserva con semanas de antelación.
//
// B-reservas-mostrador lo resolvió con un `type="date"` en la cabecera.
// agenda-1 lo QUITA por decisión de Matías (27-10: «fuera el campo de
// fecha, los chips de días y el selector Todos con una profesional») y lo
// sustituye por la vista de SEMANA, que además enseña lo que hay dentro de
// cada día en vez de sólo llevarte a él. El requisito que el campo
// cumplía sigue en pie y es lo que estos tests miden:
//
//   · un día de dentro de tres semanas se alcanza en pocos toques;
//   · el camino NO desaparece en compacto (las flechas dejaron de ser
//     `hidden sm:flex` justo por esto);
//   · la vuelta a HOY es un toque;
//   · ningún control de la barra se come el área tocable de «Dar cita»;
//   · y la agenda no ofrece reservar hacia atrás — el `min` del día vive
//     ahora donde se pide una fecha de CITA: «¿Cuándo?» → «Otra fecha».

describe("se llega a un día de dentro de tres semanas", () => {
  const DENTRO_DE_TRES_SEMANAS = "2026-10-06";

  function pedidos(): string[] {
    return llamadas
      .filter((l) => l.path.startsWith("/agenda?"))
      .map((l) => l.path);
  }

  async function verSemana() {
    await click(
      container.querySelector<HTMLButtonElement>('[data-test="vista-semana"]')!,
    );
  }

  it("por la semana: tres toques de flecha y el día, no veintiuno", async () => {
    await render();
    await verSemana();
    // 15-09 es martes; tres semanas adelante es la semana del 05-10, y el
    // martes de esa semana es el 06-10.
    for (let i = 0; i < 3; i++) await click(porEtiqueta("Semana siguiente"));
    const dia = container.querySelector<HTMLButtonElement>(
      `[data-ir-al-dia="${DENTRO_DE_TRES_SEMANAS}"]`,
    );
    expect(dia).not.toBeNull();
    await click(dia!);
    // El día pedido, no el último pedido que haya: tocar el día lleva a la
    // vista de día Y la semana sigue cargando en paralelo, así que el
    // orden de llegada no dice nada.
    expect(
      pedidos().some((x) => x.includes(`date=${DENTRO_DE_TRES_SEMANAS}`)),
    ).toBe(true);
    // Y la cabecera lo dice: 6 de octubre, y ya no «Hoy».
    const rotulo = container.querySelector('[data-test="rotulo-fecha"]')!;
    expect(rotulo.textContent).toContain("6 oct");
    expect(rotulo.textContent).not.toContain("Hoy");
  });

  it("y el camino NO desaparece en compacto, como pasaba con las flechas", async () => {
    await render();
    // Las flechas de día dejaron de ser `hidden sm:flex` al irse la tira
    // de chips: son el único modo de moverse un día.
    expect(porEtiqueta("Día anterior").className).not.toContain("hidden");
    expect(porEtiqueta("Día siguiente").className).not.toContain("hidden");
    const semana = container.querySelector<HTMLElement>(
      '[data-test="vista-semana"]',
    )!;
    expect(semana.className).not.toContain("hidden");
  });

  it("no ofrece días pasados donde se pide una fecha de cita", async () => {
    await render();
    await abrirDarCita();
    await click(servicio("Corte de pelo"));
    const otra = container.querySelector<HTMLInputElement>(
      '[data-test="cuando-otra-fecha"]',
    )!;
    expect(otra.getAttribute("min")).toBe(HOY);
  });

  it("el área tocable de las flechas llega al peldaño de la casa", async () => {
    await render();
    for (const l of ["Día anterior", "Día siguiente"]) {
      expect(porEtiqueta(l).className).toContain("h-11");
    }
  });

  it("la vuelta a HOY es UN toque, y sólo hay un «Hoy» que tocar", async () => {
    await render();
    await click(porEtiqueta("Día siguiente"));
    const vuelta = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).filter((b) => (b.textContent ?? "").trim() === "Hoy");
    expect(vuelta).toHaveLength(1);
    await click(vuelta[0]!);
    expect(pedidos()[pedidos().length - 1]).toContain(HOY);
  });

  it("y en HOY no hay botón «Hoy»: no se ofrece lo que ya está hecho", async () => {
    await render();
    expect(
      container.querySelector('[data-test="volver-a-hoy"]'),
    ).toBeNull();
    // El rótulo sí lo dice, que es la mitad informativa.
    expect(
      container.querySelector('[data-test="rotulo-fecha"]')!.textContent,
    ).toContain("Hoy");
  });

  it("nada de la barra le quita su área tocable a «Dar cita»", async () => {
    await render();
    const dar = container.querySelector<HTMLElement>('[data-test="dar-cita"]')!;
    // El estándar de la casa (`tailwind.config.js`, peldaño `touch-lg`) y
    // la lección de B-5 F8: nada de esta barra puede encogerse por debajo
    // de su área tocable para hacerle sitio a otra cosa.
    expect(dar.className).toContain("shrink-0");
    expect(dar.className).toContain("h-touch-lg");
    expect(porEtiqueta("Volver").className).toContain("shrink-0");
  });
});
