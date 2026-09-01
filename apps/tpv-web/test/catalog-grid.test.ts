// v1.14.1-el-catalogo-manda · §1. La aritmética de la rejilla, sin DOM.
//
// jsdom no hace layout, así que "caben tres filas de producto a
// 1280 × 800" no se puede comprobar montando el componente: hay que
// calcularlo sobre constantes MEDIDAS en el navegador. El circuito se
// cierra en `sale-catalog-grid.test.tsx`, que comprueba que la tarjeta
// declara el mismo alto que entra aquí.

import { describe, expect, it } from "vitest";

import {
  catalogRowsVisible,
  CATEGORY_CHIP_BLOCK_HEIGHT,
  PRODUCT_CARD_MIN_HEIGHT,
} from "../src/lib/catalogGrid.js";

describe("v1.14.1 · §1 · caben tres filas de producto a 1280×800", () => {
  // SABOTAJE del bloque: devolver el placeholder de 125 px a la tarjeta.
  it("SABOTAJE placeholder de 125 px · con él sólo caben dos filas", () => {
    // Como está: cuatro filas completas, que es el doble de lo que había
    // y una más de las tres que pide el bloque.
    expect(catalogRowsVisible(800)).toBe(4);
    expect(catalogRowsVisible(800)).toBeGreaterThanOrEqual(3);

    // Con el icono de vuelta (206 px de tarjeta): dos, que es justo lo
    // que enseña la captura del AP11.
    expect(catalogRowsVisible(800, PRODUCT_CARD_MIN_HEIGHT + 125)).toBe(2);
  });

  // El otro sabotaje del mismo eje: recuperar la segunda fila de chips.
  it("la segunda fila de chips se comería una fila de producto", () => {
    const dosFilas = CATEGORY_CHIP_BLOCK_HEIGHT + 48 + 8;
    expect(catalogRowsVisible(800, PRODUCT_CARD_MIN_HEIGHT, dosFilas)).toBe(3);
  });

});


describe("catalogRowsVisible · casos de borde", () => {
  it("una ventana baja no devuelve filas negativas", () => {
    expect(catalogRowsVisible(200)).toBe(0);
  });

  it("más alto de ventana nunca enseña menos filas (monotonía)", () => {
    let previo = 0;
    for (let h = 300; h <= 1200; h += 50) {
      const filas = catalogRowsVisible(h);
      expect(filas).toBeGreaterThanOrEqual(previo);
      previo = filas;
    }
  });

  it("a 800 de alto no se cuenta como visible una fila que se corta", () => {
    // Cuatro filas de 104 más tres huecos de 14 son 458 de los 504
    // disponibles: la quinta asoma 32 px y NO cuenta como completa.
    const disponible = 800 - 128 - 96 - CATEGORY_CHIP_BLOCK_HEIGHT;
    expect(disponible).toBe(504);
    const cuatro = 4 * PRODUCT_CARD_MIN_HEIGHT + 3 * 14;
    expect(cuatro).toBeLessThanOrEqual(disponible);
    const cinco = 5 * PRODUCT_CARD_MIN_HEIGHT + 4 * 14;
    expect(cinco).toBeGreaterThan(disponible);
  });
});
