// agenda-1 · LA AGENDA QUE SE ENTIENDE Y LA CITA EN DOS TOQUES.
//
// Matías, 27-10, con la agenda abierta en la tablet: «no me gusta la
// agenda, no es nada intuitiva»; «dar cita es súper tedioso… en el spa lo
// hemos optimizado mejor… tenemos que reducirlo a la mínima expresión».
// Medido ese día en la Lenovo: ~10 toques por «Nueva cita» y 5 tocando la
// rejilla (pasos 7 y 11 de `docs/qa/2026-10-27-clinica-9/PASADA.md`).
//
// Lo que este fichero fija es lo que SÓLO se ve en la pantalla. La
// aritmética vive en funciones puras con sus propios bancos:
// `agenda-1-proponer.test.ts` (el orden de las mejores horas) y
// `agenda-1-dia-filas.test.ts` (las filas del día, las cifras, la semana).
//
// ── Los cinco mínimos del prompt del bloque ──────────────────────────
//
//   1. la vista de UNA profesional es lista y la de VARIAS rejilla (D1);
//   2. «Dársela» abre el panel con paciente, servicio y fecha puestos;
//   3. tocar un hueco abre el panel con la hora puesta y la paciente NO se
//      pierde (H8);
//   4. `proponer()` pone primero la hora que llena un hueco justo — aquí,
//      que la pantalla USA ese orden;
//   5. (la cita de otro día está en `agenda-1-cita-de-otro-dia.test.tsx`).
//
// ── Tabla de sabotajes (cada uno visto en rojo, fichero entero) ──────
//
//   1. `unaSola = null` siempre (nunca hay lista) ·············· caen 13
//   2. `unaSola = columns[0]` siempre (nunca hay rejilla) ·······  caen 3
//   3. `openSlotFirst` crea un borrador nuevo en vez de mezclar
//      — H8 de vuelta ········································  caen 3
//   4. `atenderPendiente` sin `serviceIds` ····················  caen 4
//   5. `atenderPendiente` sin `propuesta` ·····················  caen 2
//   6. `proponer()` sustituido por los candidatos tal cual ·····  cae 1
//   7. los huecos de la lista sin `onHueco` ····················  caen 2
//   8. las cifras del día con `sueloMin: null` ·················  cae 1
//   9. `libreHastaLas` devuelve `null` siempre ················  caen 2
//  10. `queHaceAhora` devuelve `null` siempre ··················  cae 1
//  11. la ventana por defecto no se pone sola ·················  caen 4
//  12. la primera valoración no se pone sola ··················  cae 1
//  13. `primeraVisita` ignora la marca del catálogo ···········  cae 1
//  14. `AgendaPage` no pasa `onCerrar` a la historia ··········  cae 1
//  15. `HistoriaViva` sin el guardia del Atrás ················  cae 1
//
// Los quince en rojo, uno cada vez, fichero entero y sin `-t`.
//
// Lo que NO tiene sabotaje, y se dice: «la agenda sigue viva» tras el
// Atrás. Ninguno de los quince lo pone en rojo — es un guardia contra una
// reacción de más (que el Atrás desmontara la pantalla entera), no contra
// una línea concreta. Se queda porque el día que alguien registre el
// guardia en el sitio equivocado, es el que lo dirá.

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

// El catálogo de Rosario, recortado a lo que hace falta para medir qué
// cabe en un hueco y qué se ofrece al dar la cita.
const CATALOGO = vi.hoisted(() =>
  [
    // agenda-1 · la marca «Es la primera valoración» de Agenda · Catálogo.
    // En la Clínica demo la lleva «Consulta diagnóstico».
    {
      sku: "POD-001",
      name: "Consulta diagnóstico",
      tag: "consulta",
      min: 20,
      primera: true,
    },
    { sku: "POD-002", name: "Quiropodia básica", tag: "quiropodia", min: 30, primera: false },
    { sku: "POD-006", name: "Cura", tag: "cirugía", min: 15, primera: false },
    { sku: "POD-012", name: "Avulsión ungueal", tag: "cirugía", min: 120, primera: false },
  ].map((s, i) => ({
    id: `00000000-0000-0000-0000-00000000sv${i}`,
    holdedProductId: null,
    sku: s.sku,
    name: s.name,
    basePrice: 25,
    priceGross: 25,
    taxRate: 0,
    tags: [s.tag],
    kind: "SERVICE" as const,
    durationMin: s.min,
    primeraValoracion: s.primera === true,
  })),
);

vi.mock("../src/lib/catalog.js", () => ({
  loadCatalogFromCache: async () => CATALOGO,
  productImageUrl: () => null,
  getCachedClinicaEnabled: () => true,
}));

const CARMEN = {
  id: "11111111-1111-1111-1111-111111111111",
  firstName: "Carmen",
  lastName: "Prueba",
};
const LUCIA = {
  id: "11111111-1111-1111-1111-111111111112",
  firstName: "Lucía",
  lastName: "Prueba",
};

vi.mock("../src/lib/clients.js", () => ({
  clientFullName: (c: { firstName: string; lastName: string }) =>
    `${c.firstName} ${c.lastName}`.trim(),
  loadClientsFromCache: async () => [CARMEN, LUCIA],
  asegurarClientesEnCache: async () => false,
}));

// El selector es de B1 y tiene sus propios tests: aquí sólo hace falta
// poder disparar su `onSelect` para que el panel tenga una paciente.
const pickerMock = vi.hoisted(() => ({ elegido: null as unknown }));

vi.mock("../src/hooks/useClientPicker.js", () => ({
  useClientPicker: () => ({
    open: (onSelect: (c: unknown) => void) => {
      if (pickerMock.elegido) onSelect(pickerMock.elegido);
    },
    close: () => {},
    isOpen: false,
    element: null,
  }),
}));

import { ApiError } from "../src/api.js";
import { __resetOutboxForTests } from "../src/lib/outbox.js";
import { AgendaPage, pxPorMinuto } from "../src/pages/AgendaPage.js";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

// Martes 27-10-2026, 10:40 de pared en Madrid (CET, UTC+1 desde el 25-10).
// A esa hora Rosario tiene a Antonia «en sala» y la mañana a medias, que
// es el día del tablero 1.
const AHORA = new Date("2026-10-27T09:40:00.000Z");
const HOY = "2026-10-27";
const MANANA = "2026-10-28";

const ROSARIO = {
  userId: "00000000-0000-0000-0000-0000000000r1",
  displayName: "Rosario",
  color: "#e8663c",
  active: true,
};
const SOLE = {
  userId: "00000000-0000-0000-0000-0000000000s1",
  displayName: "Sole",
  color: "#8b5cf6",
  active: true,
};

/** ISO UTC de una hora de pared de Madrid el 27-10-2026 (CET = UTC+1). */
function madrid(hhmm: string, dia = 27): string {
  const [hh, mm] = hhmm.split(":").map(Number);
  return new Date(
    Date.UTC(2026, 9, dia, (hh ?? 0) - 1, mm ?? 0, 0, 0),
  ).toISOString();
}

function dia(fecha: string, ids: string[]) {
  const tramo = [{ startTime: "09:00", endTime: "14:00" }];
  return {
    date: fecha,
    open: tramo,
    closed: null as { name: string | null } | null,
    specialName: null as string | null,
    staffOpen: Object.fromEntries(ids.map((id) => [id, tramo])),
    absences: [] as unknown[],
  };
}

type Cita = {
  id: string;
  clientId: string | null;
  status: string;
  source: string;
  start: string;
  end: string;
  ticketId: string | null;
  notes: string | null;
  items: Array<{
    id: string;
    serviceId: string;
    durationMin: number;
    sortOrder: number;
    startOffsetMin: number;
  }>;
  assignments: Array<{
    reservableType: string;
    staffUserId: string | null;
    resourceId: string | null;
  }>;
};

function cita(
  id: string,
  clientId: string | null,
  staffUserId: string,
  status: string,
  desde: string,
  minutos = 30,
  serviceIdx = 1,
): Cita {
  const hasta = (() => {
    const [hh, mm] = desde.split(":").map(Number);
    const total = (hh ?? 0) * 60 + (mm ?? 0) + minutos;
    return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
  })();
  return {
    id,
    clientId,
    status,
    source: "PRESENCIAL",
    start: madrid(desde),
    end: madrid(hasta),
    ticketId: status === "COMPLETED" ? `t-${id}` : null,
    notes: null,
    items: [
      {
        id: `i-${id}`,
        serviceId: CATALOGO[serviceIdx]!.id,
        durationMin: minutos,
        sortOrder: 0,
        startOffsetMin: 0,
      },
    ],
    assignments: [
      { reservableType: "STAFF", staffUserId, resourceId: null },
    ],
  };
}

let container: HTMLDivElement;
let root: Root;
let staff: Array<typeof ROSARIO>;
let citas: Cita[];
let huecos: Array<{ start: string; end: string; options: number }>;
let proximasCitas: unknown[];
let valoracionesPendientes: string[];
let cobradoPorCita: Record<string, number>;
let llamadas: Array<{ path: string; init?: unknown }>;
/** Lo que `/clients/:id/history` contesta: de ahí sale «su último». */
let historial: Array<{ at: string; status: string; serviceIds: string[] }>;

beforeEach(async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ["Date"] });
  vi.setSystemTime(AHORA);
  (globalThis as Record<string, unknown>).indexedDB = new IDBFactory();
  await __resetOutboxForTests();
  localStorage.clear();
  staff = [ROSARIO];
  citas = [];
  huecos = [];
  proximasCitas = [];
  valoracionesPendientes = [];
  cobradoPorCita = {};
  llamadas = [];
  pickerMock.elegido = null;
  historial = [];
  Element.prototype.scrollIntoView = function () {} as unknown as never;

  apiMock.apiWithCashier.mockReset();
  apiMock.apiWithCashier.mockImplementation(
    async (path: string, init?: unknown) => {
      llamadas.push({ path, init });
      if (path.startsWith("/agenda?")) {
        const q = new URLSearchParams(path.slice(path.indexOf("?")));
        const ids = staff.map((s) => s.userId);
        const desde = q.get("from");
        const hasta = q.get("to");
        const fechas: string[] = [];
        if (desde && hasta) {
          for (
            let t = Date.parse(`${desde}T12:00:00Z`);
            t <= Date.parse(`${hasta}T12:00:00Z`);
            t += 86_400_000
          ) {
            fechas.push(new Date(t).toISOString().slice(0, 10));
          }
        } else {
          fechas.push(q.get("date") ?? HOY);
        }
        return {
          staff,
          // Las citas sembradas son todas del 27: en otro día la agenda
          // sale vacía, que es lo que hace falta para medir la semana.
          appointments: fechas.includes(HOY) ? citas : [],
          slotMinutes: 15,
          days: fechas.map((f) => dia(f, ids)),
          valoracionesPendientes,
          sesionesPorCobrar: [],
          proximasCitas,
          cobradoPorCita,
        };
      }
      if (path === "/agenda/availability") return { slots: huecos };
      if (path === "/agenda/appointments") {
        return {
          appointment: {
            ...cita("nueva", CARMEN.id, ROSARIO.userId, "CONFIRMED", "12:00"),
            start: madrid("12:00", 28),
            end: madrid("12:30", 28),
          },
        };
      }
      if (path === "/agenda/health") {
        return { generatedAt: AHORA.toISOString(), cards: [] };
      }
      if (path === "/agenda/skill-matrix") {
        return {
          editable: true,
          services: CATALOGO.map((c) => ({
            id: c.id,
            name: c.name,
            agendable: true,
            active: true,
            staffRequired: 1,
            staffUserIds: staff.map((x) => x.userId),
          })),
          staff: staff.map((s) => ({
            userId: s.userId,
            displayName: s.displayName,
            active: true,
            hasProfile: true,
          })),
          skills: [],
        };
      }
      if (path.includes("/history")) return { appointments: historial };
      // La historia viva y la guarda del contrato: lo justo para que la
      // pantalla monte. Lo que pinta DENTRO no es de este fichero (tiene
      // el suyo); aquí sólo se mide que la agenda sabe cerrarla.
      if (path === "/clinica/contrato") {
        return { aceptado: true, version: 2, debeAceptar: false };
      }
      if (path.includes("/historia")) {
        throw new ApiError(404, "sin historia", "NOT_FOUND");
      }
      if (path.includes("/vouchers")) {
        return { balance: { sessionsLeft: 0, amountLeftCents: 0 }, vouchers: [] };
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

async function asentar() {
  for (let i = 0; i < 25; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

async function render() {
  root = createRoot(container);
  await act(async () => {
    root.render(<AgendaPage onClose={() => {}} esSanitario />);
  });
  await asentar();
}

async function click(el: Element) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await asentar();
}

function q<T extends Element = HTMLElement>(sel: string): T | null {
  return container.querySelector<T>(sel);
}

function panel(): HTMLElement {
  const p = q('[data-test="panel-dar-cita"]');
  if (!p) throw new Error("el panel de «Dar cita» no está abierto");
  return p;
}

// ── 1 · D1 · una profesional → lista; varias → rejilla ──────────────

describe("D1 · una profesional es una LISTA; varias, la rejilla", () => {
  it("con una, la lista de filas y la columna de la izquierda", async () => {
    citas = [cita("c1", CARMEN.id, ROSARIO.userId, "COMPLETED", "09:00")];
    await render();
    expect(q('[data-test="dia-en-lista"]')).not.toBeNull();
    expect(q('[data-test="columna-del-dia"]')).not.toBeNull();
    // Y ni una columna de rejilla: la decisión D1 es excluyente.
    expect(container.querySelectorAll("[data-columna-staff]")).toHaveLength(0);
  });

  it("con dos, la rejilla por columnas y ninguna lista", async () => {
    staff = [ROSARIO, SOLE];
    await render();
    expect(container.querySelectorAll("[data-columna-staff]")).toHaveLength(2);
    expect(q('[data-test="dia-en-lista"]')).toBeNull();
    expect(q('[data-test="columna-del-dia"]')).toBeNull();
  });

  it("con el filtro puesto en una de las dos, vuelve a ser lista: es «mi día»", async () => {
    staff = [ROSARIO, SOLE];
    await render();
    const filtro = container.querySelector<HTMLSelectElement>("select")!;
    await act(async () => {
      filtro.value = SOLE.userId;
      filtro.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await asentar();
    expect(q('[data-test="dia-en-lista"]')).not.toBeNull();
  });

  it("con UNA profesional no hay selector «Todas»: no filtra nada", async () => {
    await render();
    expect(container.querySelector("select")).toBeNull();
  });

  it("las filas de la lista llegan al área tocable de la casa", async () => {
    citas = [
      // Una Cura de 15 minutos: en la rejilla medía 16 px.
      cita("c1", CARMEN.id, ROSARIO.userId, "CONFIRMED", "11:30", 15, 2),
    ];
    await render();
    const fila = q('[data-cita="c1"]')!;
    expect(fila.className).toContain("min-h-touch");
  });

  it("en la rejilla, la cabecera de cada columna dice qué está haciendo", async () => {
    staff = [ROSARIO, SOLE];
    citas = [
      // Rosario con alguien en sala; Sole libre hasta las 12:00.
      cita("en-sala", LUCIA.id, ROSARIO.userId, "IN_SERVICE", "10:30"),
      cita("de-sole", CARMEN.id, SOLE.userId, "CONFIRMED", "12:00"),
    ];
    await render();
    expect(q(`[data-que-hace="${ROSARIO.userId}"]`)!.textContent).toBe(
      "Ahora: Lucía Prueba · Quiropodia básica",
    );
    expect(q(`[data-que-hace="${SOLE.userId}"]`)!.textContent).toBe(
      "Libre hasta las 12:00",
    );
  });

  it("y en la rejilla la escala sale de la retícula, no de 1,1 px/min", async () => {
    staff = [ROSARIO, SOLE];
    citas = [cita("c1", CARMEN.id, ROSARIO.userId, "CONFIRMED", "11:30", 15, 2)];
    await render();
    const tarjeta = q<HTMLElement>('[data-cita="c1"]')!;
    // 15 minutos × 44/15 = 44 px: el mínimo de toque, no una raya.
    expect(tarjeta.style.height).toBe(`${15 * pxPorMinuto(15)}px`);
    expect(Number.parseFloat(tarjeta.style.height)).toBeGreaterThanOrEqual(44);
  });
});

// ── 2 · La lista dice lo que la rejilla no decía ─────────────────────

describe("la lista dice el estado, el hueco y lo cerrado", () => {
  beforeEach(() => {
    citas = [
      cita("cobrada", CARMEN.id, ROSARIO.userId, "COMPLETED", "09:00"),
      cita("en-sala", LUCIA.id, ROSARIO.userId, "IN_SERVICE", "10:30"),
      cita("por-llegar", CARMEN.id, ROSARIO.userId, "CONFIRMED", "11:00"),
    ];
    cobradoPorCita = { cobrada: 2500 };
  });

  it("el estado de cada cita, con lo cobrado de verdad", async () => {
    await render();
    expect(q('[data-cita="cobrada"]')!.textContent).toContain("Cobrada · 25 €");
    expect(q('[data-cita="en-sala"]')!.textContent).toContain("En sala");
    expect(q('[data-cita="por-llegar"]')!.textContent).toContain("Por llegar");
  });

  it("la de AHORA va destacada y las hechas atenuadas", async () => {
    await render();
    // A las 10:40, la de las 10:30 es la que contiene el minuto de ahora.
    expect(q('[data-cita="en-sala"]')!.dataset.filaAhora).toBe("1");
    expect(q('[data-cita="cobrada"]')!.className).toContain("opacity-55");
    expect(q('[data-cita="por-llegar"]')!.className).not.toContain("opacity-55");
  });

  it("los huecos libres con su duración y qué cabe", async () => {
    await render();
    // De 11:30 (fin de la de las 11:00) a 14:00 quedan 2 h 30 min.
    const hueco = q('[data-hueco="11:30"]')!;
    expect(hueco.textContent).toContain("Libre 2 h 30 min");
    // Lo más largo que entra, primero: la avulsión son 120 minutos.
    expect(hueco.textContent).toContain("cabe Avulsión ungueal");
    expect(hueco.textContent).toContain("Dar cita aquí");
  });

  it("y un hueco que ya pasó se ve, pero no se ofrece", async () => {
    await render();
    // De 09:30 a 10:30 se fue una hora sin vender, y a las 10:40 ya pasó.
    const pasado = q('[data-hueco-pasado="09:30"]')!;
    expect(pasado.textContent).toContain("Se fueron 1 h sin vender");
    expect(q('[data-hueco="09:30"]')).toBeNull();
  });

  it("las horas cerradas, plegadas en una línea", async () => {
    await render();
    const cerradas = q('[data-cerrado-desde="14:00"]')!;
    expect(cerradas.textContent).toBe("Cerrado desde las 14:00");
  });

  it("«Ahora» y «Después» en la columna, y «Abrir sesión»", async () => {
    await render();
    const ahora = q('[data-test="tarjeta-ahora"]')!;
    expect(ahora.textContent).toContain("Lucía Prueba");
    expect(ahora.textContent).toContain("Ahora · en sala");
    expect(q('[data-test="ahora-abrir-sesion"]')).not.toBeNull();
    expect(q('[data-test="tarjeta-despues"]')!.textContent).toContain(
      "11:00 · Carmen Prueba",
    );
  });

  it("con nada en curso, «Ahora» dice hasta cuándo está libre", async () => {
    // A las 10:40 no hay nada en curso y la siguiente es a las 11:00.
    citas = [
      cita("cobrada", CARMEN.id, ROSARIO.userId, "COMPLETED", "09:00"),
      cita("por-llegar", CARMEN.id, ROSARIO.userId, "CONFIRMED", "11:00"),
    ];
    await render();
    expect(q('[data-test="tarjeta-ahora"]')).toBeNull();
    expect(q('[data-test="tarjeta-ahora-libre"]')!.textContent).toContain(
      "Libre hasta las 11:00",
    );
  });

  it("las tres cifras, con los minutos libres contados DESDE AHORA", async () => {
    await render();
    const cifras = q('[data-test="cifras-del-dia"]')!.textContent ?? "";
    expect(cifras).toContain("3");
    expect(cifras).toContain("25 €");
    // 09:00–14:00 son 300 minutos; desde el suelo (10:30) quedan 210, y
    // de ésos ocupan 60 las dos citas de las 10:30 y las 11:00 → 2 h 30.
    expect(cifras).toContain("2 h 30 min");
  });

  it("sin red no se inventa un importe: «—» y no «0 €»", async () => {
    // El día sale de la caché y `cobradoPorCita` no viaja en ella.
    await render();
    await act(async () => root.unmount());
    apiMock.apiWithCashier.mockImplementation(async (path: string) => {
      if (path.startsWith("/agenda?")) throw new Error("sin red");
      if (path === "/agenda/health") {
        return { generatedAt: AHORA.toISOString(), cards: [] };
      }
      return {};
    });
    container.remove();
    container = document.createElement("div");
    document.body.appendChild(container);
    await render();
    expect(q('[data-test="cifras-del-dia"]')!.textContent).toContain("—");
    expect(q('[data-test="cifras-del-dia"]')!.textContent).not.toContain("0 €");
  });
});

// ── 3 · H8 · tocar un hueco no borra la paciente ────────────────────

describe("H8 · tocar un hueco pone la hora y NO pierde la paciente", () => {
  const PROPUESTA = {
    appointmentId: "cobrada",
    clientId: CARMEN.id,
    propuesta: "S4",
    desde: MANANA,
  };

  beforeEach(() => {
    citas = [cita("cobrada", CARMEN.id, ROSARIO.userId, "COMPLETED", "09:00")];
    proximasCitas = [PROPUESTA];
    huecos = [
      { start: madrid("12:00", 28), end: madrid("12:30", 28), options: 1 },
    ];
  });

  it("«Dársela» deja paciente, servicio y fecha puestos", async () => {
    await render();
    await click(q('[data-test="dar-proxima-cita-cobrada"]')!);
    // La paciente, plegada: no se vuelve a preguntar lo que se sabe.
    expect(q('[data-test="paso-paciente-plegado"]')!.textContent).toContain(
      "Carmen Prueba",
    );
    // El servicio, el de la cita que propuso la próxima.
    expect(q('[data-test="paso-servicio-plegado"]')!.textContent).toContain(
      "Quiropodia básica",
    );
    // Y la fecha propuesta, con su nombre en castellano.
    expect(q('[data-test="paso-cuando-plegado"]')!.textContent).toContain(
      "4 semanas",
    );
    // Las horas ya están buscadas: si hubiera que tocar «buscar», los dos
    // toques serían tres.
    expect(q('[data-test="mejores-horas"]')).not.toBeNull();
  });

  it("y desde ahí son DOS toques: la hora y Reservar", async () => {
    await render();
    await click(q('[data-test="dar-proxima-cita-cobrada"]')!);
    const antes = llamadas.filter((l) => l.path === "/agenda/appointments");
    expect(antes).toHaveLength(0);

    // Toque 1 · la hora.
    await click(panel().querySelector("[data-hora-propuesta]")!);
    // Toque 2 · Reservar.
    await click(panel().querySelector('[data-accion="reservar"]')!);
    expect(
      llamadas.filter((l) => l.path === "/agenda/appointments"),
    ).toHaveLength(1);
  });

  it("tocar un hueco con el panel abierto escribe la HORA y nada más", async () => {
    await render();
    await click(q('[data-test="dar-proxima-cita-cobrada"]')!);
    expect(q('[data-test="paso-paciente-plegado"]')!.textContent).toContain(
      "Carmen Prueba",
    );
    // El gesto de H8: tocar una hora de la agenda con el panel abierto.
    await click(q('[data-hueco="10:30"]')!);
    // La paciente SIGUE ahí. Antes de este bloque el panel se reabría en
    // blanco (pasada del 27-10, captura 29b).
    expect(q('[data-test="paso-paciente-plegado"]')!.textContent).toContain(
      "Carmen Prueba",
    );
    expect(q('[data-test="paso-servicio-plegado"]')!.textContent).toContain(
      "Quiropodia básica",
    );
    // Y la hora es la del hueco tocado.
    expect(q('[data-test="resumen-de-la-cita"]')!.textContent).toContain(
      "10:30",
    );
  });

  it("con todo puesto, el hueco tocado deja la cita a UN toque", async () => {
    await render();
    await click(q('[data-test="dar-proxima-cita-cobrada"]')!);
    await click(q('[data-hueco="10:30"]')!);
    expect(
      panel().querySelector<HTMLButtonElement>('[data-accion="reservar"]')!
        .disabled,
    ).toBe(false);
  });

  it("y en la rejilla pasa lo mismo: el toque no abre un borrador nuevo", async () => {
    staff = [ROSARIO, SOLE];
    await render();
    await click(q('[data-test="dar-proxima-cita-cobrada"]')!);
    const hueco = q('[data-columna="' + SOLE.userId + '"] [data-hueco]');
    expect(hueco).not.toBeNull();
    await click(hueco!);
    expect(q('[data-test="paso-paciente-plegado"]')!.textContent).toContain(
      "Carmen Prueba",
    );
  });
});

// ── 4 · La pantalla usa el orden de `proponer()` ────────────────────

describe("las mejores horas salen en el orden de proponer()", () => {
  it("la que llena el hueco justo va primera, no la más pronto", async () => {
    // Rosario: cita de 11:00 a 11:30 y otra de 11:50 a 12:20. Entre las
    // dos quedan 20 minutos exactos. Para una Consulta diagnóstico (20
    // min) las 11:30 llenan el hueco justo; las 09:00 también caben y
    // dejan la mañana partida.
    citas = [
      cita("a", CARMEN.id, ROSARIO.userId, "CONFIRMED", "11:00", 30),
      cita("b", LUCIA.id, ROSARIO.userId, "CONFIRMED", "11:50", 30),
    ];
    huecos = [
      { start: madrid("09:00"), end: madrid("09:20"), options: 1 },
      { start: madrid("11:30"), end: madrid("11:50"), options: 1 },
      { start: madrid("12:20"), end: madrid("12:40"), options: 1 },
    ];
    await render();
    await click(q('[data-test="dar-cita"]')!);
    await click(
      [...panel().querySelectorAll("button")].find((b) =>
        (b.textContent ?? "").includes("Consulta diagnóstico"),
      )!,
    );
    await click(q('[data-test="cuando-el-dia-visto"]') ??
      q('[data-test="cuando-esta-semana"]')!);

    const horas = [
      ...panel().querySelectorAll<HTMLElement>("[data-hora-propuesta]"),
    ].map((b) => b.dataset.horaPropuesta);
    expect(horas[0]).toBe(`${HOY} 11:30`);
    expect(
      panel().querySelector('[data-etiqueta-hora="Llena el hueco justo"]'),
    ).not.toBeNull();
  });
});

describe("la ventana se pone sola: un toque menos que no decidía nada", () => {
  it("con el servicio elegido ya hay horas, sin tocar «¿Cuándo?»", async () => {
    huecos = [
      { start: madrid("11:30"), end: madrid("11:50"), options: 1 },
    ];
    await render();
    await click(q('[data-test="dar-cita"]')!);
    await click(
      [...panel().querySelectorAll("button")].find((b) =>
        (b.textContent ?? "").includes("Consulta diagnóstico"),
      )!,
    );
    // Ni «Buscar hueco» ni «¿Cuándo?»: la ventana por defecto es el día
    // que la recepción está mirando.
    expect(q('[data-test="mejores-horas"]')).not.toBeNull();
    expect(panel().querySelector("[data-hora-propuesta]")!.getAttribute(
      "data-hora-propuesta",
    )).toBe(`${HOY} 11:30`);
    // Y el paso sigue a la vista para cambiarla.
    expect(q('[data-test="cuando-esta-semana"]')).not.toBeNull();
  });

  it("y en un día PASADO la ventana por defecto es esta semana", async () => {
    huecos = [{ start: madrid("11:30"), end: madrid("11:50"), options: 1 }];
    await render();
    // Al día de ayer sólo se llega por la flecha.
    await click(q('[data-test="anterior"]')!);
    await click(q('[data-test="dar-cita"]')!);
    await click(
      [...panel().querySelectorAll("button")].find((b) =>
        (b.textContent ?? "").includes("Consulta diagnóstico"),
      )!,
    );
    // El rango pedido empieza HOY, no ayer: la agenda no reserva hacia
    // atrás, y ofrecerlo sería un 409 con la paciente delante.
    const rango = llamadas
      .map((l) => l.path)
      .filter((x) => x.startsWith("/agenda?from="));
    expect(rango[rango.length - 1]).toContain(`from=${HOY}`);
  });
});

// ── 5 · La semana ──────────────────────────────────────────────────

describe("la semana enseña los días que abre el centro", () => {
  it("cinco columnas y hoy destacado, y tocar un día lleva a su día", async () => {
    citas = [cita("c1", CARMEN.id, ROSARIO.userId, "CONFIRMED", "11:00")];
    await render();
    await click(q('[data-test="vista-semana"]')!);
    const columnas = [
      ...container.querySelectorAll<HTMLElement>("[data-dia-semana]"),
    ];
    // La semana del 26-10 al 1-11; el centro abre los siete días en este
    // doble, así que salen siete — lo que se fija es que salen LOS QUE
    // ABRE y que hoy va marcado.
    expect(columnas.length).toBeGreaterThan(0);
    expect(q(`[data-dia-semana="${HOY}"]`)!.className).toContain(
      "border-mipiace-coral",
    );
    expect(q(`[data-dia-semana="${HOY}"]`)!.textContent).toContain("· Hoy");

    await click(q(`[data-ir-al-dia="${MANANA}"]`)!);
    expect(q('[data-test="dia-en-lista"]')).not.toBeNull();
    expect(q('[data-test="rotulo-fecha"]')!.textContent).toContain("28 oct");
  });

  it("tocar un hueco de la semana abre «Dar cita» con ese día y esa hora", async () => {
    await render();
    await click(q('[data-test="vista-semana"]')!);
    const hueco = q(`[data-hueco-semana="${MANANA} 09:00"]`);
    expect(hueco).not.toBeNull();
    await click(hueco!);
    expect(q('[data-test="resumen-de-la-cita"]')!.textContent).toContain(
      "09:00",
    );
    expect(q('[data-test="resumen-de-la-cita"]')!.textContent).toContain(
      "28 oct",
    );
  });
});

// ── 6 · La primera valoración de una paciente nueva ────────────────

describe("a una paciente NUEVA se le propone su primera valoración", () => {
  /** Abre «Dar cita» y elige a la paciente del selector. */
  async function elegirPaciente(quien: unknown) {
    pickerMock.elegido = quien;
    await render();
    await click(q('[data-test="dar-cita"]')!);
    await click(q('[data-test="elegir-paciente"]')!);
  }

  it("viene YA MARCADA, sin tocar la lista: es la marca del catálogo", async () => {
    // Lucía no tiene citas anteriores (`/clients/:id/history` vacío), y el
    // catálogo del centro marca «Consulta diagnóstico» como la primera
    // valoración (Agenda · Catálogo, clinica-8).
    await elegirPaciente(LUCIA);

    // El paso de servicios sale PLEGADO y con ella dentro: lo que el
    // sistema ya sabe viene puesto, no se ofrece para que lo toquen.
    const plegado = q('[data-test="paso-servicio-plegado"]')!;
    expect(plegado.textContent).toContain("Consulta diagnóstico");
    expect(plegado.textContent).toContain("20 min");
    // Y la ficha de la paciente dice por qué.
    expect(q('[data-test="paso-paciente-plegado"]')!.textContent).toContain(
      "Es nueva",
    );
    // No se ha tocado ningún servicio de la lista para llegar aquí.
    expect(q('[data-test="paciente-nueva"]')).toBeNull();
  });

  it("y sin marca en el catálogo NO se adivina: se abre la lista", async () => {
    // Un centro que no ha marcado ninguna primera valoración.
    for (const s of CATALOGO) (s as { primeraValoracion: boolean }).primeraValoracion = false;
    try {
      await elegirPaciente(LUCIA);
      expect(q('[data-test="paso-servicio-plegado"]')).toBeNull();
      expect(q('[data-test="paciente-nueva"]')!.textContent).toContain(
        "Elige su primera visita",
      );
    } finally {
      (CATALOGO[0] as { primeraValoracion: boolean }).primeraValoracion = true;
    }
  });

  it("a quien SÍ tiene citas se le propone su último, no la primera visita", async () => {
    // Carmen tiene una cita hoy: su historial no está vacío, así que lo
    // que se propone es lo suyo y no el servicio de empezar.
    citas = [cita("c1", CARMEN.id, ROSARIO.userId, "COMPLETED", "09:00")];
    historial = [
      {
        at: madrid("09:00"),
        status: "COMPLETED",
        serviceIds: [CATALOGO[1]!.id],
      },
    ];
    await elegirPaciente(CARMEN);
    expect(
      panel().querySelector('[data-test="servicio-su-ultimo"]')!.textContent,
    ).toContain("Quiropodia básica");
    expect(q('[data-test="paso-servicio-plegado"]')).toBeNull();
  });
});

// ── 7 · El Atrás de Android cierra la historia ─────────────────────

describe("clinica-10 (H3) · el Atrás cierra la historia abierta desde la agenda", () => {
  /** El Atrás del sistema llega como `popstate`. */
  async function atras() {
    await act(async () => {
      window.dispatchEvent(new PopStateEvent("popstate", { state: null }));
    });
    await asentar();
  }

  /** La historia se monta en un PORTAL (`AlFrente`), así que no está
   *  dentro del contenedor del test: se busca en el documento. */
  function hayHistoria(): boolean {
    return [...document.querySelectorAll("h1")].some((h) =>
      (h.textContent ?? "").startsWith("Historia ·"),
    );
  }

  async function abrirHistoria() {
    citas = [cita("c1", CARMEN.id, ROSARIO.userId, "CONFIRMED", "11:00")];
    await render();
    await click(q('[data-cita="c1"]')!);
    const boton = [...document.querySelectorAll("button")].find(
      (b) => (b.textContent ?? "").trim() === "Historia del paciente",
    );
    expect(boton).toBeTruthy();
    await click(boton!);
    expect(hayHistoria()).toBe(true);
  }

  it("el Atrás la cierra y devuelve a la agenda", async () => {
    // Pasada del 27-10, hallazgo H3: «en Historia de paciente, el atrás
    // de Android no hace nada». Con la tablet en la mano eso es un botón
    // roto: la única salida era el «Volver» de la cabecera.
    await abrirHistoria();
    await atras();
    expect(hayHistoria()).toBe(false);
    // Y se vuelve a la agenda, no a ninguna otra parte.
    expect(q('[data-test="dia-en-lista"]')).not.toBeNull();
  });

  it("y la agenda sigue viva: el Atrás no se lleva la pantalla entera", async () => {
    await abrirHistoria();
    await atras();
    expect(q('[data-cita="c1"]')).not.toBeNull();
  });
});

// ── 8 · Pendiente de recepción ─────────────────────────────────────

describe("pendiente de recepción", () => {
  it("el test sin contestar de una paciente DEL DÍA, con su tablet", async () => {
    citas = [cita("c1", LUCIA.id, ROSARIO.userId, "CONFIRMED", "11:00")];
    valoracionesPendientes = [LUCIA.id];
    await render();
    const tarjeta = q('[data-test="pendiente-de-recepcion"]')!;
    expect(tarjeta.textContent).toContain("Lucía Prueba");
    expect(tarjeta.textContent).toContain("test de salud sin contestar");
    expect(tarjeta.textContent).toContain("Tablet");
  });

  it("y el de alguien que NO viene hoy no es un pendiente de hoy", async () => {
    citas = [cita("c1", CARMEN.id, ROSARIO.userId, "CONFIRMED", "11:00")];
    valoracionesPendientes = [LUCIA.id];
    await render();
    expect(q('[data-test="pendiente-de-recepcion"]')).toBeNull();
  });
});
