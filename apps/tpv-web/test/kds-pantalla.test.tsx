// kds-1-cocina · LA PANTALLA DE COCINA, montada.
//
// Las filas de la tabla de sabotajes que viven aquí:
//
//   | Orden por columnas | las 4 primeras EN EL DOM son las 4 más
//   | antiguas (urgentes delante)
//   | Alergia sin silla que no sale en cocina | franja «⚠ TODA LA MESA»
//   | No marcar el plato de la silla que lleva su alérgeno | bravas (GL) a
//   | la silla 3 celíaca → «¡LLEVA GLUTEN!»
//   | Anulado que desaparece sin «Visto» | sigue en la tarjeta hasta «Visto»
//   | Sonido en cocina | la pantalla no reproduce audio
//
// jsdom NO hace layout, así que el reparto de tarjetas (qué cabe y qué va
// al «+N») se prueba sobre la función pura en `kds-pantalla-pura.test.ts`.
// Aquí se prueba el ORDEN DEL DOM, que es lo que de verdad decide el orden
// de lectura, y lo que la tarjeta dice.

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
import {
  PULSO_CLASS_ROJO,
  PULSO_CLASS_TARJETA,
  TARJETA_CUERPO,
} from "../src/lib/kitchenTheme.js";

/** De «#1A1D23» a «rgb(26, 29, 35)», que es lo que devuelve el DOM. */
function rgb(hex: string): string {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const AHORA = "2026-10-08T12:00:00.000Z";

const ME: KitchenMe = {
  device: { id: "dev-1", name: "Pase" },
  store: { id: "store-1", name: "La Maestranza" },
  sections: ["COCINA"],
  settings: { greenMaxMin: 10, amberMaxMin: 20, readyBeep: false },
};

function comanda(over: Partial<Comanda> = {}): Comanda {
  const sentAt = over.sentAt ?? AHORA;
  return {
    id: "o1",
    section: "COCINA",
    ticketId: "t1",
    tableId: "m1",
    tableName: "M5",
    number: 1,
    urgent: false,
    lateArrival: false,
    sentAt,
    firedAt: sentAt,
    orderAt: sentAt,
    readyAt: null,
    servedAt: null,
    recoveredAt: null,
    isNew: true,
    allergyBands: [],
    lines: [
      {
        id: "l1",
        name: "Patatas bravas",
        units: 2,
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
    settings: ME.settings,
    sections: ["COCINA"],
    orders,
    ready,
  };
}

let container: HTMLDivElement;
let root: Root;
const llamadas: Array<{ path: string; method?: string; body?: unknown }> = [];

function monta(v: VistaCocina) {
  apiMock.apiWithDevice.mockImplementation(
    async (path: string, o?: { method?: string; body?: unknown }) => {
      llamadas.push({ path, method: o?.method, body: o?.body });
      if (path === "/kitchen/comandas") return v;
      if (path === "/kitchen/comandas/hoy") return { ...v, orders: [], ready: [] };
      return { ok: true };
    },
  );
}

beforeEach(() => {
  llamadas.length = 0;
  apiMock.apiWithDevice.mockReset();
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(async () => {
  try {
    await act(async () => root.unmount());
  } catch {
    /* ya estaba desmontado */
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

async function render(me: KitchenMe = ME) {
  root = createRoot(container);
  await act(async () => {
    root.render(<KitchenScreen me={me} />);
  });
  await settle();
}

async function click(el: Element | null | undefined) {
  if (!el) throw new Error("elemento no encontrado");
  await act(async () => {
    (el as HTMLButtonElement).click();
  });
  await settle();
}

const $$ = <T extends HTMLElement>(sel: string): T[] => [
  ...container.querySelectorAll<T>(sel),
];
const $ = <T extends HTMLElement>(sel: string): T | null =>
  container.querySelector<T>(sel);

// ──────────────────────────────────────────────────────────────────────

describe("kds-1 · SABOTAJE · orden por columnas", () => {
  it("el ORDEN DEL DOM es el de lectura: urgentes delante y luego por llegada", async () => {
    // El servidor las devuelve ordenadas y la pantalla las pinta en un
    // `flex-wrap`, así que el orden del DOM ES el de lectura: izquierda a
    // derecha y después la fila de abajo. En columnas (`columns-*`) el ojo
    // se saltaba la segunda más antigua, que es la corrección del 08-10.
    const t = (min: number) =>
      new Date(Date.parse(AHORA) - min * 60_000).toISOString();
    monta(
      vista([
        comanda({ id: "urgente", tableName: "T4", urgent: true, sentAt: t(1), firedAt: t(1), orderAt: t(1) }),
        comanda({ id: "vieja", tableName: "M1", sentAt: t(30), firedAt: t(30), orderAt: t(30) }),
        comanda({ id: "media", tableName: "M2", sentAt: t(20), firedAt: t(20), orderAt: t(20) }),
        comanda({ id: "nueva", tableName: "M3", sentAt: t(5), firedAt: t(5), orderAt: t(5) }),
      ]),
    );
    await render();
    expect(
      $$('[data-testid="kds-comanda"]').map((c) => c.dataset.comandaId),
    ).toEqual(["urgente", "vieja", "media", "nueva"]);
  });

  it("y el semáforo pinta cada una con su tono", async () => {
    const t = (min: number) =>
      new Date(Date.parse(AHORA) - min * 60_000).toISOString();
    monta(
      vista([
        comanda({ id: "verde", sentAt: t(3), firedAt: t(3), orderAt: t(3) }),
        comanda({ id: "ambar", sentAt: t(15), firedAt: t(15), orderAt: t(15) }),
        comanda({ id: "rojo", sentAt: t(40), firedAt: t(40), orderAt: t(40) }),
        comanda({ id: "espera", sentAt: t(40), firedAt: null, orderAt: t(40) }),
      ]),
    );
    await render();
    const tonos = new Map(
      $$('[data-testid="kds-comanda"]').map((c) => [
        c.dataset.comandaId,
        c.dataset.tono,
      ]),
    );
    expect(tonos.get("verde")).toBe("verde");
    expect(tonos.get("ambar")).toBe("ambar");
    expect(tonos.get("rojo")).toBe("rojo");
    // Un tiempo retenido NO lleva semáforo: gris.
    expect(tonos.get("espera")).toBe("espera");
  });
});

describe("kds-1 · lo que la tarjeta dice y lo que no", () => {
  it("mesa, nº de comanda y platos; sin precios ni camarero", async () => {
    monta(vista([comanda({ number: 2 })]));
    await render();
    const tarjeta = $('[data-testid="kds-comanda"]')!;
    expect(tarjeta.textContent).toMatch(/M5/);
    expect(tarjeta.textContent).toMatch(/2ª COMANDA/);
    // La cantidad va en su propia columna de 30 px, para que los nombres
    // de los platos alineen entre líneas (la maqueta).
    expect(tarjeta.textContent).toMatch(/2Patatas bravas/);
    expect(tarjeta.textContent).not.toMatch(/€|EUR|caja1|Salomé|comensal/i);
  });

  it("los modificadores y las notas van BIEN VISIBLES bajo el plato", async () => {
    monta(
      vista([
        comanda({
          lines: [
            {
              ...comanda().lines[0]!,
              notes: ["Sin pimentón", "Punto: poco hecho"],
            },
          ],
        }),
      ]),
    );
    await render();
    const notas = $$('[data-testid="kds-nota"]').map((n) => n.textContent);
    // Con «— » delante, como la maqueta. Con «·» se leían como una lista
    // de etiquetas del sistema y no como lo que el camarero escribió.
    expect(notas).toEqual(["— Sin pimentón", "— Punto: poco hecho"]);
  });

  it("«⚡ URGENTE» arriba, en blanco sobre rojo, y la tarjeta con borde rojo", async () => {
    monta(vista([comanda({ urgent: true })]));
    await render();
    const franja = $('[data-testid="kds-franja-urgente"]')!;
    // El rayo es un SVG, como en la maqueta; el texto es «URGENTE».
    expect(franja.textContent).toBe("URGENTE");
    expect(franja.querySelector("svg")).not.toBeNull();
    expect(franja.style.fontSize).toBe("26px");
    expect(franja.style.color).toMatch(/#FFFFFF|rgb\(255, 255, 255\)/);
    // El anillo de 4 px va por `box-shadow` y no por `border`: con cuatro
    // columnas, 8 px de borde serían un nombre de plato partido.
    expect($('[data-testid="kds-comanda"]')!.style.boxShadow).toMatch(/4px/);
  });

  it("«LLEGÓ TARDE» cuando la comanda llegó al volver la red (decisión 9)", async () => {
    monta(vista([comanda({ lateArrival: true })]));
    await render();
    expect($('[data-testid="kds-tarde"]')!.textContent).toBe("LLEGÓ TARDE");
  });

  it("el bloque «EN ESPERA» va al final y su plato no se puede tachar", async () => {
    monta(
      vista([
        comanda({
          lines: [
            { ...comanda().lines[0]!, id: "marchado", fired: true },
            {
              ...comanda().lines[0]!,
              id: "retenido",
              name: "Filete de ternera",
              fired: false,
              course: 2,
            },
          ],
        }),
      ]),
    );
    await render();
    expect($('[data-testid="kds-bloque-espera"]')!.textContent).toBe(
      "EN ESPERA · SALE CUANDO LO MARCHEN",
    );
    const retenida = $$('[data-testid="kds-linea"]').find(
      (l) => l.dataset.lineaId === "retenido",
    )!;
    expect(retenida.dataset.espera).toBe("1");
    // El botón del plato está deshabilitado: no se cocina lo que no marchó.
    expect(retenida.querySelector("button")!.disabled).toBe(true);
  });
});

describe("kds-1 · SABOTAJE · la alergia en cocina", () => {
  it("una alergia SIN silla sale como «⚠ TODA LA MESA» y PARPADEA en rojo", async () => {
    monta(vista([comanda({
        allergyBands: [{ titulo: "TODA LA MESA · CELÍACO", alergenos: "Gluten" }],
      })]));
    await render();
    const franja = $('[data-testid="kds-franja-alergia"]')!;
    expect($('[data-testid="kds-franja-alergia-titulo"]')!.textContent).toBe(
      "TODA LA MESA · CELÍACO",
    );
    expect($('[data-testid="kds-franja-alergia-alergeno"]')!.textContent).toBe(
      "Gluten",
    );
    // El icono de aviso, y la franja en rojo de ancho completo.
    expect(franja.querySelector("svg")).not.toBeNull();
    expect(franja.style.background).toBe("rgb(200, 16, 46)");
    expect(
      $('[data-testid="kds-franja-alergia-titulo"]')!.style.fontSize,
    ).toBe("21px");
  });

  it("el plato de la silla alérgica que lleva SU alérgeno: recuadro y «¡LLEVA GLUTEN!»", async () => {
    monta(
      vista([
        comanda({
          allergyBands: [{ titulo: "SILLA 3 · CELÍACO", alergenos: "Gluten" }],
          lines: [
            {
              ...comanda().lines[0]!,
              seat: 3,
              seatAllergy: "SIN GLUTEN",
              allergyWarning: "¡LLEVA GLUTEN!",
            },
          ],
        }),
      ]),
    );
    await render();
    // UNA línea para las dos cosas, como dice la decisión 3 («SILLA 3 ·
    // SIN GLUTEN»). En dos líneas cada plato asignado costaba 79 px de
    // alto y una mesa con tres se comía la pantalla — lo midió el bucle
    // visual.
    expect($('[data-testid="kds-silla"]')!.textContent).toBe(
      "SILLA 3 · ¡LLEVA GLUTEN!",
    );
    expect($$('[data-testid="kds-lleva"]')).toHaveLength(0);
    const linea = $('[data-testid="kds-linea"]')!;
    // La caja ENTERA en rojo y parpadeando: es lo único que no puede
    // esperar. Y el pulso va de rojo a rojo, no de rojo a carbón.
    expect(linea.dataset.alarma).toBe("1");
    expect(linea.style.background).toBe("rgb(200, 16, 46)");
    expect(linea.className).toContain(PULSO_CLASS_ROJO);
  });

  it("y un plato de la silla alérgica que NO choca va recuadrado, no relleno", async () => {
    monta(
      vista([
        comanda({
          allergyBands: [{ titulo: "SILLA 3 · CELÍACO", alergenos: "Gluten" }],
          lines: [
            {
              ...comanda().lines[0]!,
              name: "Magro con tomate",
              seat: 3,
              seatAllergy: "SIN GLUTEN",
            },
          ],
        }),
      ]),
    );
    await render();
    // El «SIN GLUTEN» que kds-1b sacó de la franja: aquí es una
    // instrucción sobre un plato, y en la franja era una repetición.
    expect($('[data-testid="kds-silla"]')!.textContent).toBe("SILLA 3 · SIN GLUTEN");
    const linea = $('[data-testid="kds-linea"]')!;
    expect(linea.dataset.alarma).toBe("0");
    expect(linea.style.border).toMatch(/2px solid/);
    expect(linea.className).not.toContain(PULSO_CLASS_ROJO);
  });

  it("un plato que lleva el alérgeno pero SIN silla avisa en ámbar, no en rojo", async () => {
    // La regla del rojo: el rojo es para lo que no puede esperar. Un plato
    // sin silla de una mesa alérgica es un aviso —no se sabe de quién es—,
    // no una alarma.
    monta(
      vista([
        comanda({
          allergyBands: [{ titulo: "TODA LA MESA · CELÍACO", alergenos: "Gluten" }],
          lines: [
            { ...comanda().lines[0]!, seat: null, carries: ["lleva gluten"] },
          ],
        }),
      ]),
    );
    await render();
    expect($('[data-testid="kds-carries"]')!.textContent).toBe("lleva gluten");
    expect($('[data-testid="kds-linea"]')!.dataset.alarma).toBe("0");
    expect($$('[data-testid="kds-lleva"]')).toHaveLength(0);
    expect($('[data-testid="kds-linea"]')!.className).not.toContain(
      PULSO_CLASS_ROJO,
    );
  });
});

describe("kds-1 · SABOTAJE · anulado que desaparece sin «Visto»", () => {
  it("«ERAN 3 · −1» con su botón «Visto», y el plato NO desaparece", async () => {
    monta(
      vista([
        comanda({
          lines: [
            {
              ...comanda().lines[0]!,
              units: 2,
              unitsOriginal: 3,
              voidedUnits: 1,
              voidPending: true,
            },
          ],
        }),
      ]),
    );
    await render();
    expect($('[data-testid="kds-anulado"]')!.textContent).toBe("ERAN 3 · −1");
    expect($('[data-testid="kds-visto"]')).not.toBeNull();
    // El plato sigue ahí, con sus 2 unidades vivas.
    expect($('[data-testid="kds-linea"]')!.textContent).toMatch(/2Patatas bravas/);
  });

  it("un anulado COMPLETO dice «ANULADO» y queda tachado", async () => {
    monta(
      vista([
        comanda({
          lines: [
            {
              ...comanda().lines[0]!,
              units: 0,
              unitsOriginal: 2,
              voidedUnits: 2,
              voidPending: true,
            },
          ],
        }),
      ]),
    );
    await render();
    expect($('[data-testid="kds-anulado"]')!.textContent).toBe("ANULADO");
  });

  it("y si la cocina ya lo había tachado, lo dice: es MERMA", async () => {
    monta(
      vista([
        comanda({
          lines: [
            {
              ...comanda().lines[0]!,
              units: 1,
              unitsOriginal: 2,
              voidedUnits: 1,
              voidPending: true,
              doneBeforeVoid: true,
            },
          ],
        }),
      ]),
    );
    await render();
    expect($('[data-testid="kds-anulado"]')!.textContent).toMatch(
      /YA ESTABA HECHO/,
    );
  });

  it("«CAMBIO» en ÁMBAR, no en rojo: hay que verlo pero no está en la plancha", async () => {
    monta(
      vista([
        comanda({
          lines: [
            {
              ...comanda().lines[0]!,
              changeNote: "Sin pimentón",
              changePending: true,
            },
          ],
        }),
      ]),
    );
    await render();
    expect($('[data-testid="kds-cambio"]')!.textContent).toBe(
      "CAMBIO · Sin pimentón",
    );
    expect($('[data-testid="kds-linea"]')!.className).toContain("kds-pulso-ambar");
  });

  it("«Visto» llama a su ruta", async () => {
    monta(
      vista([
        comanda({
          lines: [
            { ...comanda().lines[0]!, voidedUnits: 1, voidPending: true, unitsOriginal: 3 },
          ],
        }),
      ]),
    );
    await render();
    await click($('[data-testid="kds-visto"]'));
    expect(llamadas.map((l) => l.path)).toContain("/kitchen/lineas/l1/visto");
  });
});

describe("kds-1 · decisión 8 · el parpadeo", () => {
  it("una comanda NUEVA parpadea; una con algo tachado, no", async () => {
    monta(
      vista([
        comanda({ id: "nueva", isNew: true }),
        comanda({ id: "tocada", isNew: false }),
      ]),
    );
    await render();
    const porId = new Map(
      $$('[data-testid="kds-comanda"]').map((c) => [c.dataset.comandaId, c]),
    );
    expect(porId.get("nueva")!.className).toContain(PULSO_CLASS_TARJETA);
    expect(porId.get("tocada")!.className).not.toContain(PULSO_CLASS_TARJETA);
  });

  it("una nueva CON alergia parpadea en NEUTRO, no en rojo", async () => {
    // **Era el primer defecto de kds-1b.** El pulso rojo se ponía en la
    // tarjeta entera, así que el cuerpo de la M5 salía rojo oscuro y la
    // franja de la alergia dejaba de destacar sobre él: la regla del rojo
    // deshecha por su propio aviso.
    monta(
      vista([
        comanda({
          isNew: true,
          allergyBands: [{ titulo: "SILLA 3 · CELÍACO", alergenos: "Gluten" }],
        }),
      ]),
    );
    await render();
    const tarjeta = $('[data-testid="kds-comanda"]')!;
    expect(tarjeta.className).toContain(PULSO_CLASS_TARJETA);
    expect(tarjeta.className).not.toContain(PULSO_CLASS_ROJO);
  });
});

describe("kds-1b · SABOTAJE · fondo rojo en el cuerpo de una tarjeta", () => {
  it("el cuerpo va NEUTRO en la urgente, en la de la alergia y en la normal", async () => {
    monta(
      vista([
        comanda({ id: "urgente", urgent: true, isNew: true }),
        comanda({
          id: "alergia",
          isNew: true,
          allergyBands: [{ titulo: "SILLA 3 · CELÍACO", alergenos: "Gluten" }],
        }),
        comanda({ id: "normal", isNew: false }),
      ]),
    );
    await render();
    for (const tarjeta of $$('[data-testid="kds-comanda"]')) {
      // El fondo declarado, que es el que manda: la animación de lo nuevo
      // va del cuerpo a un verde apagado, nunca a un rojo.
      expect(tarjeta.style.background, tarjeta.dataset.comandaId).toBe(
        rgb(TARJETA_CUERPO),
      );
      expect(tarjeta.className).not.toContain(PULSO_CLASS_ROJO);
    }
  });
});

describe("kds-1b · SABOTAJE · la franja de alergia y los modificadores", () => {
  it("la franja de la mesa va en ROJO y a 21 px, con el alérgeno debajo", async () => {
    monta(
      vista([
        comanda({
          allergyBands: [{ titulo: "SILLA 3 · CELÍACO", alergenos: "Gluten" }],
        }),
      ]),
    );
    await render();
    const franja = $('[data-testid="kds-franja-alergia"]')!;
    expect(franja.style.background).toBe("rgb(200, 16, 46)");
    const titulo = $('[data-testid="kds-franja-alergia-titulo"]')!;
    expect(titulo.textContent).toBe("SILLA 3 · CELÍACO");
    // 21 a pelo, por lo mismo: contra `ALERGIA_PX` el sabotaje se
    // llevaría el listón consigo.
    expect(Number.parseInt(titulo.style.fontSize, 10)).toBeGreaterThanOrEqual(21);
    expect($('[data-testid="kds-franja-alergia-alergeno"]')!.textContent).toBe(
      "Gluten",
    );
  });

  it("los modificadores van en ÁMBAR y a 17 px, no en gris y pequeños", async () => {
    monta(
      vista([
        comanda({
          lines: [{ ...comanda().lines[0]!, notes: ["Sin limón"] }],
        }),
      ]),
    );
    await render();
    // **LOS NÚMEROS, A PELO.** Contra el token no valdría: bajar
    // `NOTA_PX` a 13 bajaría también el listón del test y el sabotaje
    // pasaría en verde. Es la misma debilidad que encontró el sabotaje de
    // «la alergia llega a `Client`» en kds-1 (§4.1).
    const nota = $('[data-testid="kds-nota"]')!;
    expect(nota.textContent).toBe("— Sin limón");
    expect(Number.parseInt(nota.style.fontSize, 10)).toBeGreaterThanOrEqual(17);
    expect(nota.style.color).toBe("rgb(246, 207, 122)");
    expect(nota.style.fontWeight).toBe("600");
  });
});

describe("kds-1 · tachar y «Lista»", () => {
  it("un toque en el plato llama a `hecho`", async () => {
    monta(vista([comanda()]));
    await render();
    await click($('[data-testid="kds-linea"]')!.querySelector("button"));
    const l = llamadas.find((x) => x.path === "/kitchen/lineas/l1/hecho");
    expect(l).toBeTruthy();
    expect(l!.body).toEqual({ done: true });
  });

  it("«Lista» mide 56 px y llama a su ruta", async () => {
    monta(vista([comanda()]));
    await render();
    const lista = $('[data-testid="kds-lista"]')!;
    expect(lista.style.minHeight).toBe("56px");
    await click(lista);
    expect(llamadas.map((l) => l.path)).toContain("/kitchen/comandas/o1/lista");
  });

  it("la columna «Listas» enseña lo que espera el camarero", async () => {
    monta(
      vista([], [comanda({ id: "lista1", tableName: "M4", readyAt: AHORA })]),
    );
    await render();
    expect($$('[data-testid="kds-lista-item"]')).toHaveLength(1);
    expect($('[data-testid="kds-listas"]')!.textContent).toMatch(/Listas · 1/);
    expect($('[data-testid="kds-lista-item"]')!.textContent).toMatch(/M4/);
  });
});

describe("kds-1 · decisión 9 · sin conexión", () => {
  it("la pantalla ENTERA se pone en rojo cuando el GET falla", async () => {
    apiMock.apiWithDevice.mockImplementation(async (path: string) => {
      if (path === "/kitchen/comandas") throw new Error("ECONNREFUSED");
      return { ok: true };
    });
    await render();
    const aviso = $('[data-testid="kds-sin-conexion"]')!;
    expect(aviso).not.toBeNull();
    expect(aviso.textContent).toMatch(/SIN CONEXIÓN/);
    expect(aviso.textContent).toMatch(/las comandas no llegan/);
    // Y la barra de arriba lo dice también.
    expect($('[data-testid="kds-en-linea"]')!.textContent).toMatch(
      /SIN CONEXIÓN/,
    );
  });

  it("con el GET bien, dice «En línea» y no hay aviso rojo", async () => {
    monta(vista([comanda()]));
    await render();
    expect($$('[data-testid="kds-sin-conexion"]')).toHaveLength(0);
    expect($('[data-testid="kds-en-linea"]')!.textContent).toMatch(/En línea/);
  });

  it("un 403 del módulo apagado NO es «sin conexión»: el servidor contestó", async () => {
    const { ApiError } = await import("../src/api.js");
    apiMock.apiWithDevice.mockImplementation(async (path: string) => {
      if (path === "/kitchen/comandas") {
        throw new ApiError(403, "módulo apagado", "KITCHEN_MODULE_DISABLED");
      }
      return { ok: true };
    });
    await render();
    expect($$('[data-testid="kds-sin-conexion"]')).toHaveLength(0);
  });
});

describe("kds-1 · SABOTAJE · sonido en cocina", () => {
  it("montar la pantalla no crea ningún AudioContext ni reproduce nada", async () => {
    // El complemento del test de código fuente de `kds-pantalla-pura`:
    // aquí se vigila el RUNTIME, no el fichero. Si alguien importara un
    // módulo que suena, esto lo vería.
    const AudioCtx = vi.fn();
    const play = vi.fn();
    const vibrate = vi.fn();
    (globalThis as Record<string, unknown>).AudioContext = AudioCtx;
    (globalThis as Record<string, unknown>).webkitAudioContext = AudioCtx;
    const playOriginal = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = play as never;
    (navigator as Navigator & { vibrate?: unknown }).vibrate = vibrate;

    monta(vista([comanda({ urgent: true, isNew: true })]));
    await render();
    await click($('[data-testid="kds-linea"]')!.querySelector("button"));

    expect(AudioCtx).not.toHaveBeenCalled();
    expect(play).not.toHaveBeenCalled();
    expect(vibrate).not.toHaveBeenCalled();
    expect(container.querySelector("audio")).toBeNull();

    HTMLMediaElement.prototype.play = playOriginal;
    delete (globalThis as Record<string, unknown>).AudioContext;
    delete (globalThis as Record<string, unknown>).webkitAudioContext;
  });
});

describe("kds-1 · decisión 7 · «Hoy»", () => {
  it("abre la hoja y pide lo terminado del día", async () => {
    monta(vista([comanda()]));
    await render();
    await click($('[data-testid="kds-hoy"]'));
    expect($('[data-testid="kds-hoy-hoja"]')).not.toBeNull();
    expect(llamadas.map((l) => l.path)).toContain("/kitchen/comandas/hoy");
  });
});
