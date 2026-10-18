// n1-vertical · cuánto tapa el teclado del sistema, y a partir de cuándo
// decimos que está abierto.
//
// La cuenta ya existía dentro de `startVisualViewportSync` (alimenta
// `--keyboard-offset`); este bloque la saca a una función para poder
// preguntarla desde React y para poder probarla aquí, sin navegador.
//
// Lo que fija este banco:
//
//   1. El offset es `innerHeight - visualViewport.height - offsetTop`, y
//      nunca negativo.
//   2. El umbral de "hay teclado" es 120 px y NO `> 0`: en el WebView el
//      viewport visual se encoge unos pocos píxeles sin teclado (barras
//      de sistema del modo inmersivo al reaparecer, rebote del scroll
//      elástico que deja `offsetTop` ≠ 0). Con el umbral en 0, la barra
//      inferior del ticket parpadearía al desplazar el catálogo.
//   3. Las medidas reales del N1 (viewport 360×648, teclado ~290 px)
//      caen del lado de "abierto" con margen.
//
// Sabotajes que este fichero pone en rojo (tabla del done):
//   · umbral a 0 → el ruido de 8 px pasa por teclado
//   · umbral por encima de 120 → un teclado numérico corto no se detecta
//   · quitar el `Math.max(0, …)` → offset negativo

import { describe, expect, it } from "vitest";

import {
  offsetDelTeclado,
  tecladoTapaLaPantalla,
  UMBRAL_TECLADO_PX,
  ventanaEncogio,
} from "../src/lib/visualViewportSync.js";

describe("n1-vertical · offsetDelTeclado", () => {
  it("es lo que el viewport visual perdió por abajo", () => {
    // N1 en vertical: ventana de 648, viewport visual de 358 con el
    // teclado puesto.
    expect(offsetDelTeclado(648, 358, 0)).toBe(290);
  });

  it("descuenta también el desplazamiento del viewport", () => {
    // Con el viewport visual desplazado hacia abajo (el navegador sube
    // la página para que el campo enfocado se vea), lo tapado por
    // ABAJO es menos: esos píxeles están arriba, fuera de la ventana.
    expect(offsetDelTeclado(648, 358, 100)).toBe(190);
  });

  it("nunca es negativo", () => {
    // Pasa de verdad: durante el rebote del scroll elástico el viewport
    // visual se declara más alto que la ventana. Un offset negativo
    // metido en `bottom: var(--keyboard-offset)` empujaría la barra del
    // ticket POR DEBAJO del borde de la pantalla.
    expect(offsetDelTeclado(648, 700, 0)).toBe(0);
    expect(offsetDelTeclado(648, 648, 40)).toBe(0);
  });
});

describe("n1-vertical · tecladoTapaLaPantalla", () => {
  it("el umbral es 120 px y no cero", () => {
    expect(UMBRAL_TECLADO_PX).toBe(120);
  });

  it("el teclado del N1 (290 px) está abierto", () => {
    expect(tecladoTapaLaPantalla(648, 358, 0)).toBe(true);
  });

  it("el ruido del WebView sin teclado NO cuenta como teclado", () => {
    // Las barras de sistema al reaparecer: 8 px.
    expect(tecladoTapaLaPantalla(648, 640, 0)).toBe(false);
    // El rebote del scroll: el viewport entero desplazado 24 px.
    expect(tecladoTapaLaPantalla(648, 624, 24)).toBe(false);
    // Nada tapado: pantalla limpia.
    expect(tecladoTapaLaPantalla(648, 648, 0)).toBe(false);
  });

  it("un teclado numérico corto en apaisado sigue pasando el umbral", () => {
    // El caso estrecho: 720×360 y un teclado de 150 px. Si el umbral
    // subiera de 150, este teclado dejaría la barra puesta encima de
    // los resultados, que es el fallo que arregla el bloque.
    expect(tecladoTapaLaPantalla(360, 210, 0)).toBe(true);
  });

  it("justo en el umbral cuenta como abierto", () => {
    expect(tecladoTapaLaPantalla(648, 648 - UMBRAL_TECLADO_PX, 0)).toBe(true);
    expect(tecladoTapaLaPantalla(648, 648 - UMBRAL_TECLADO_PX + 1, 0)).toBe(
      false,
    );
  });
});

describe("n1-vertical · ventanaEncogio (el caso del N1)", () => {
  it("el teclado del N1 encoge la VENTANA, y eso también es teclado", () => {
    // Medido en el aparato el 2026-10-18: innerHeight 720 → 449 con el
    // viewport visual encogido lo mismo, así que la resta de
    // `tecladoTapaLaPantalla` da cero y hace falta esta otra señal.
    expect(tecladoTapaLaPantalla(449, 449, 0)).toBe(false);
    expect(ventanaEncogio(449, 720)).toBe(true);
  });

  it("una ventana que no ha encogido no es teclado", () => {
    expect(ventanaEncogio(720, 720)).toBe(false);
  });

  it("el ruido de las barras del sistema tampoco", () => {
    expect(ventanaEncogio(712, 720)).toBe(false);
    // Justo en el umbral: 720 − 600 = 120.
    expect(ventanaEncogio(601, 720)).toBe(false);
    expect(ventanaEncogio(600, 720)).toBe(true);
  });
});
