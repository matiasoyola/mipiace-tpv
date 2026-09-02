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
  CHIP_FALLBACK_ROW_WIDTH,
  CHIP_MAX_ROWS,
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
