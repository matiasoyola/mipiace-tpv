// v1.14-la-comanda-se-ve · reparto de los chips de categoría (hallazgo
// M1 de la auditoría del 2026-09-01).
//
// v1.14.1-el-catalogo-manda §2 · eran DOS filas y ahora es UNA. Medido
// sobre la captura del AP11 con v1.14 desplegado: las dos filas costaban
// ~100 px de alto en una pantalla donde sólo cabían dos filas de
// producto, y con "Más (3)" seguían sin verse todas las categorías. Si
// de todas formas hay un sheet que las tiene todas, la segunda fila se
// paga con espacio del catálogo y no compra nada.
//
// El scroll horizontal sin affordance es un anti-patrón prohibido por
// `docs/ux-principles.md` §1.8. Estos tests fijan que el reparto es una
// función pura del ancho y de las etiquetas: sin DOM, sin reflow y sin
// oscilaciones.

import { describe, expect, it } from "vitest";

import {
  ANCHO_FILA_ESTRECHA,
  CHIP_FALLBACK_ROW_WIDTH,
  CHIP_MAX_ROWS,
  CHIP_MAX_ROWS_ESTRECHO,
  filasDeChips,
  estimateChipWidth,
  layoutChips,
} from "../src/lib/chipRows.js";

const AP11_CATALOG_COLUMN = CHIP_FALLBACK_ROW_WIDTH; // 840 px a 1280×800

describe("layoutChips · una fila y 'Más (N)'", () => {
  // SABOTAJE del bloque v1.14.1: devolver `CHIP_MAX_ROWS` a 2. Este es
  // el test que cae — el invariante es "una fila", no "pocas filas".
  it("el máximo es UNA fila", () => {
    expect(CHIP_MAX_ROWS).toBe(1);
  });

  it("las ocho de Sirope ya no caben todas: las que se pintan caben en UNA fila", () => {
    // Las que la ronda 2 midió en el terminal, donde el octavo chip
    // terminaba en x=1876 de 1920 tocando el borde. En dos filas cabían
    // las ocho; en una no, y eso es el precio declarado del bloque: lo
    // que no cabe se va al sheet, que las tiene todas.
    const ocho = [
      "Cafés",
      "Bollería",
      "Refrescos",
      "Cervezas",
      "Vinos",
      "Tostadas",
      "Bocadillos",
      "Postres",
    ];
    const layout = layoutChips(ocho, AP11_CATALOG_COLUMN, ["Todos"]);
    expect(layout.visibleCount + layout.overflowCount).toBe(8);
    expect(layout.overflowCount).toBeGreaterThan(0);
    // Lo pintado cabe de verdad en una fila, contando "Más (N)".
    const widths = [
      estimateChipWidth("Todos"),
      ...ocho.slice(0, layout.visibleCount).map(estimateChipWidth),
      estimateChipWidth(`Más (${layout.overflowCount})`),
    ];
    expect(rowsNeeded(widths, AP11_CATALOG_COLUMN)).toBe(1);
  });

  it("20 categorías → se recortan y sale el chip 'Más (N)'", () => {
    const veinte = Array.from({ length: 20 }, (_, i) => `Categoría ${i + 1}`);
    const layout = layoutChips(veinte, AP11_CATALOG_COLUMN, ["Todos"]);
    expect(layout.overflowCount).toBeGreaterThan(0);
    expect(layout.visibleCount + layout.overflowCount).toBe(20);
    // Y lo que queda a la vista cabe de verdad en la fila, contando el
    // sitio que ocupa el propio chip "Más (N)".
    const widths = [
      estimateChipWidth("Todos"),
      ...veinte
        .slice(0, layout.visibleCount)
        .map((l) => estimateChipWidth(l)),
      estimateChipWidth(`Más (${layout.overflowCount})`),
    ];
    expect(rowsNeeded(widths, AP11_CATALOG_COLUMN)).toBeLessThanOrEqual(
      CHIP_MAX_ROWS,
    );
  });

  it("el toggle Servicios/Productos come sitio de la primera fila", () => {
    const tags = Array.from({ length: 12 }, (_, i) => `Tratamiento ${i + 1}`);
    const sinToggle = layoutChips(tags, AP11_CATALOG_COLUMN, ["Todos"]);
    const conToggle = layoutChips(tags, AP11_CATALOG_COLUMN, [
      "Todos",
      "Servicios",
      "Productos",
    ]);
    expect(conToggle.visibleCount).toBeLessThan(sinToggle.visibleCount);
  });

  it("etiquetas larguísimas no rompen el reparto (los chips truncan)", () => {
    const largas = Array.from(
      { length: 10 },
      (_, i) => `Una categoría con un nombre absurdamente largo ${i}`,
    );
    const layout = layoutChips(largas, AP11_CATALOG_COLUMN, ["Todos"]);
    expect(layout.visibleCount + layout.overflowCount).toBe(10);
    expect(layout.overflowCount).toBeGreaterThan(0);
  });

  it("sin medida real cae al ancho de diseño (1280×800), no a cero", () => {
    const tags = ["Cafés", "Vinos", "Postres"];
    expect(layoutChips(tags, 0, ["Todos"])).toEqual(
      layoutChips(tags, CHIP_FALLBACK_ROW_WIDTH, ["Todos"]),
    );
  });

  it("sin categorías no hay chip de desbordamiento", () => {
    expect(layoutChips([], AP11_CATALOG_COLUMN, ["Todos"])).toEqual({
      visibleCount: 0,
      overflowCount: 0,
    });
  });

  it("una columna estrecha recorta más que una ancha (monotonía)", () => {
    const tags = Array.from({ length: 14 }, (_, i) => `Cat ${i + 1}`);
    const ancho = layoutChips(tags, 1200, ["Todos"]).visibleCount;
    const estrecho = layoutChips(tags, 400, ["Todos"]).visibleCount;
    expect(estrecho).toBeLessThanOrEqual(ancho);
  });
});

// Anchos REALES medidos en el navegador a 1280×800 durante el bucle
// visual del bloque (chips de categoría con icono, `h-touch px-5`,
// DM Sans 14px/500). Este es el test que faltaba en la primera versión:
// la estimación se quedaba un 10 % corta, el reparto creía que cabían
// diez chips y "Más (N)" caía a una fila de más. Los tests de reparto
// no lo veían porque usaban la MISMA estimación equivocada a los dos
// lados de la comparación.
const ANCHOS_MEDIDOS: ReadonlyArray<[string, number]> = [
  ["Todos", 101.6],
  ["Arroces", 119.8],
  ["Batidos", 117.9],
  ["Bolleria", 116.4],
  ["Cafes", 105.8],
  ["Carnes", 114.8],
  ["Cervezas", 128.4],
  ["Cocteles", 126.7],
  ["Ensaladas", 134.1],
  ["Hamburguesas", 166.9],
  ["Más (10)", 123],
  ["Croissantysandwich", 200],
];

describe("estimateChipWidth · calibración contra el navegador", () => {
  it("nunca estima MENOS de lo que el chip mide de verdad", () => {
    // Pasarse enseña un chip menos; quedarse corto abre una tercera
    // fila. Sólo uno de los dos errores rompe el invariante del bloque.
    for (const [label, medido] of ANCHOS_MEDIDOS) {
      expect(estimateChipWidth(label)).toBeGreaterThanOrEqual(medido);
    }
  });

  it("tampoco se pasa tanto como para vaciar la barra", () => {
    for (const [label, medido] of ANCHOS_MEDIDOS) {
      expect(estimateChipWidth(label)).toBeLessThanOrEqual(medido * 1.25 + 8);
    }
  });

  it("el catálogo real de 20 categorías cabe en UNA fila CON sus anchos reales", () => {
    // El caso que se coló: se reparte con la estimación y se comprueba
    // con los anchos medidos.
    const veinte = [
      "Arroces", "Batidos", "Bolleria", "Cafes", "Carnes", "Cervezas",
      "Cocteles", "Croissantysandwich", "Ensaladas", "Hamburguesas",
      "Helados", "Infusiones", "Licores", "Pescados", "Pizzas",
      "Postres", "Raciones", "Refrescos", "Tostadas", "Vinos",
    ];
    const layout = layoutChips(veinte, AP11_CATALOG_COLUMN, ["Todos"]);
    const medido = (l: string) =>
      ANCHOS_MEDIDOS.find(([n]) => n === l)?.[1] ?? estimateChipWidth(l);
    const reales = [
      medido("Todos"),
      ...veinte.slice(0, layout.visibleCount).map(medido),
      medido(`Más (${layout.overflowCount})`),
    ];
    expect(rowsNeeded(reales, AP11_CATALOG_COLUMN)).toBeLessThanOrEqual(
      CHIP_MAX_ROWS,
    );
  });
});

/** Cuántas filas necesita esta secuencia de anchos. */
function rowsNeeded(widths: number[], rowWidth: number): number {
  let rows = 1;
  let used = 0;
  for (const w of widths) {
    const need = used === 0 ? w : used + 8 + w;
    if (need <= rowWidth) {
      used = need;
    } else {
      rows += 1;
      used = w;
    }
  }
  return rows;
}

// ─────────────────────────────────────────────────────────────────────
// n1-vertical · el aparato de mano, donde una sola fila deja las
// familias INALCANZABLES.
// ─────────────────────────────────────────────────────────────────────

/** La fila de chips del N1 en vertical, medida en el aparato. */
const N1_FILA = 328;

/** Las ocho familias de la carta de Sirope, las mismas de arriba. */
const OCHO_DE_SIROPE = [
  "Cafés",
  "Bollería",
  "Refrescos",
  "Cervezas",
  "Vinos",
  "Tostadas",
  "Bocadillos",
  "Postres",
];

/** Los chips fijos de un catálogo de servicios. */
const FIJOS = ["Todos", "Servicios", "Productos"];

describe("n1-vertical · dos filas SÓLO en estrecho", () => {
  it("el terminal sigue en UNA fila", () => {
    expect(filasDeChips(AP11_CATALOG_COLUMN)).toBe(CHIP_MAX_ROWS);
    expect(filasDeChips(840)).toBe(1);
    // Y sin medida (primer render, jsdom) se defiende el terminal.
    expect(filasDeChips(0)).toBe(1);
  });

  it("el N1 pasa a DOS filas", () => {
    expect(filasDeChips(N1_FILA)).toBe(CHIP_MAX_ROWS_ESTRECHO);
    expect(CHIP_MAX_ROWS_ESTRECHO).toBe(2);
  });

  it("el umbral está donde deja de caber lo fijo más «Más (N)»", () => {
    expect(filasDeChips(ANCHO_FILA_ESTRECHA)).toBe(1);
    expect(filasDeChips(ANCHO_FILA_ESTRECHA - 1)).toBe(2);
    // Lo medido en el N1: los fijos más el chip del resto suman 437, así
    // que el umbral tiene que estar por encima de eso.
    const fijos = FIJOS.map(estimateChipWidth).reduce((a, b) => a + b, 0);
    const conMas = fijos + estimateChipWidth("Más (8)") + 8 * 3;
    expect(conMas).toBeGreaterThan(N1_FILA);
    expect(ANCHO_FILA_ESTRECHA).toBeGreaterThan(conMas - 50);
  });

  it("en el N1 el chip que abre las ocho CABE, que antes era lo que fallaba", () => {
    // Con UNA fila el reparto daba 0 visibles y aun así no cabía: el
    // «Más (8)» se salía hasta x=453 en una fila de 328 y, con
    // `overflow-hidden`, no había forma de tocarlo. Las ocho familias
    // eran inalcanzables.
    const unaFila = layoutChips(OCHO_DE_SIROPE, N1_FILA, FIJOS, 1);
    expect(unaFila.visibleCount).toBe(0);
    const anchoFijos = FIJOS.map(estimateChipWidth).reduce((a, b) => a + b, 0);
    const conMas = anchoFijos + 8 * 3 + estimateChipWidth("Más (8)");
    expect(conMas).toBeGreaterThan(N1_FILA); // 437 > 328: no cabe. Medido.

    // Con DOS filas sí entra, que es lo que arregla el bloque: la puerta
    // al sheet con las ocho está en pantalla y se puede tocar.
    const dosFilas = layoutChips(OCHO_DE_SIROPE, N1_FILA, FIJOS);
    expect(dosFilas.overflowCount).toBeGreaterThan(0);
    expect(dosFilas.visibleCount + dosFilas.overflowCount).toBe(
      OCHO_DE_SIROPE.length,
    );
    // Y lo pintado cabe de verdad en dos filas, contando el «Más (N)».
    const anchos = [
      ...FIJOS.map(estimateChipWidth),
      ...OCHO_DE_SIROPE.slice(0, dosFilas.visibleCount).map(estimateChipWidth),
      estimateChipWidth(`Más (${dosFilas.overflowCount})`),
    ];
    let filas = 1;
    let usado = 0;
    for (const w of anchos) {
      const necesita = usado === 0 ? w : usado + 8 + w;
      if (necesita <= N1_FILA) {
        usado = necesita;
      } else {
        filas += 1;
        usado = w;
      }
    }
    expect(filas).toBeLessThanOrEqual(2);
  });

  it("ninguna familia se pierde por el camino, quepa lo que quepa", () => {
    for (const ancho of [300, 328, 360, 420, 519, 520, 700, 840]) {
      const l = layoutChips(OCHO_DE_SIROPE, ancho, FIJOS);
      expect(l.visibleCount + l.overflowCount).toBe(OCHO_DE_SIROPE.length);
    }
  });
});
