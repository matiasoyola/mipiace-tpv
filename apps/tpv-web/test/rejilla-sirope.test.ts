// auditoria-sirope (#6 + #7) · QUE EL NOMBRE QUEPA ENTERO.
//
// Los dos hallazgos de la rejilla del 18-10, sobre la función pura:
//
//   #6 · «Croissantysandwich» se salía del botón de familia.
//   #7 · dos desayunos distintos pintaban EXACTAMENTE el mismo texto —
//        «Desayuno 1 · Café + Tostada…»— porque el `line-clamp-2`
//        cortaba justo donde se diferencian.
//
// La fila de la tabla de sabotajes que vive aquí:
//
//   | Dos nombres distintos pintan el mismo texto

import { describe, expect, it } from "vitest";

import {
  cabeEnLineas,
  nombresQueColisionan,
  PRODUCT_NAME_FLOOR_PX,
  tamanoNombreProducto,
} from "../src/lib/hospitalityGrid.js";

/** La carta de Sirope, con los dos desayunos del hallazgo. */
const CARTA = [
  "Desayuno 1 · Café + Tostada con mantequilla y mermelada",
  "Desayuno 1 · Café + Tostada (Sin glúten)",
  "Café con leche",
  "Tostada con tomate",
];

/** Un botón de la rejilla del D8: cuatro columnas en 1442 px. */
const ANCHO_BOTON = 300;

describe("#7 · el nombre manda sobre el tamaño", () => {
  it("un nombre corto se queda en el techo de la rejilla", () => {
    expect(tamanoNombreProducto("Café con leche", ANCHO_BOTON, 3, 24)).toBe(24);
  });

  it("un nombre largo BAJA hasta que cabe, nunca por debajo del suelo", () => {
    const px = tamanoNombreProducto(CARTA[0]!, ANCHO_BOTON, 3, 24);
    expect(px).toBeLessThan(24);
    expect(px).toBeGreaterThanOrEqual(PRODUCT_NAME_FLOOR_PX);
    // Y con ese tamaño, cabe de verdad en tres líneas.
    expect(cabeEnLineas(CARTA[0]!, ANCHO_BOTON, px, 3)).toBe(true);
  });

  it("dos productos de nombre distinto NUNCA pintan el mismo texto", () => {
    expect(nombresQueColisionan(CARTA, ANCHO_BOTON, 3)).toEqual([]);
  });

  it("y tampoco en el botón ESTRECHO, que es donde chocaban", () => {
    // El choque del 18-10 no pasó en un botón ancho: pasó en uno de
    // ~170 px, donde dos líneas son unas 24 letras y los dos desayunos
    // se quedan los dos en «Desayuno 1 · Café + Tost».
    //
    // EL SABOTAJE: volver al `line-clamp-2` de tamaño fijo. Se puede
    // escribir aquí mismo, porque la regla vieja es esta función con el
    // techo puesto a mano y dos líneas:
    const VIEJO = nombresQueColisionan(CARTA, 170, 2, 24);
    expect(VIEJO.length).toBeGreaterThan(0);
    // Y con la regla nueva —tres líneas y el tamaño que haga falta— no
    // hay dos botones que se lean igual.
    expect(nombresQueColisionan(CARTA, 170, 3)).toEqual([]);
  });

  it("y la red lo CANTA cuando de verdad colisionan", () => {
    // Un botón estrechísimo: la función tiene que detectarlo, no
    // callarlo. Es lo que la hace valer como red.
    const choques = nombresQueColisionan(CARTA, 60, 1);
    expect(choques.length).toBeGreaterThan(0);
  });
});

describe("#6 · el rótulo de familia cabe en su botón", () => {
  // Seis columnas en el D8: ~215 px por botón, ~195 útiles.
  const ANCHO_FAMILIA = 195;

  it("«Croissantysandwich» entra en dos líneas sin salirse", () => {
    const px = tamanoNombreProducto("Croissantysandwich", ANCHO_FAMILIA, 2, 21);
    expect(cabeEnLineas("Croissantysandwich", ANCHO_FAMILIA, px, 2)).toBe(true);
    expect(px).toBeGreaterThanOrEqual(PRODUCT_NAME_FLOOR_PX);
  });

  it("una familia corta no encoge: «Cafe» se queda a 21", () => {
    expect(tamanoNombreProducto("Cafe", ANCHO_FAMILIA, 2, 21)).toBe(21);
  });

  it("una palabra que no cabe entera en la línea NO se da por buena", () => {
    // Es exactamente lo que pasaba: una palabra sola más ancha que el
    // botón no se parte, se desborda.
    expect(cabeEnLineas("Croissantysandwich", 80, 21, 2)).toBe(false);
  });
});
