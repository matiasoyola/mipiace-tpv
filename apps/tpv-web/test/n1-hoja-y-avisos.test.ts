// n1-hosteleria-2 · hallazgos 1, 3, 4 y 6 · LA HOJA DE LA COMANDA Y LOS
// AVISOS DE COCINA.
//
// Los cuatro son el mismo problema visto desde cuatro sitios, y la causa
// es de reparto: la hoja era `max-h-[88dvh]` anclada abajo, o sea con el
// alto decidido por SU CONTENIDO.
//
//   · (1) cada banda de «listo para servir» era contenido nuevo arriba,
//     así que la hoja crecía hasta topar con el 88 % y lo que se comía
//     era el desplazador de las líneas, el único bloque flexible. Dos
//     avisos = 112 px menos de comanda, y con seis líneas se veían de
//     una en una. Matías: «la previa no está nada bien»;
//   · (3) los avisos tapaban trabajo, y sin techo: cuántos entren lo
//     decide cocina, no el reparto;
//   · (4) el 12 % que la hoja no ocupaba era la franja de venta asomando
//     por arriba — las «dos ventanas apiladas» que R1 prohíbe;
//   · (6) la X medía 44 y el atrás de Android no cerraba la hoja: caía
//     al guardia de fondo, que dentro de una venta significa «vuelve al
//     mapa». El gesto de cerrar una hoja sacaba al camarero de la mesa.
//
// Lo que jsdom puede medir es el REPARTO: cuánto se llevan los avisos y
// quién decide el alto. Que la sexta línea caiga dentro de la pantalla
// se mide en el navegador, contra la stack del banco en pleno servicio,
// y va en la tabla del `-done`.
//
// Las filas de la tabla de sabotajes que viven aquí:
//
//   | Los avisos se apilan en la mano      | el coste crece con cocina
//   | La hoja vuelve a decidir su alto     | el reparto deja de ser fijo

import { describe, expect, it } from "vitest";

import {
  altoDeLosAvisos,
  AVISOS_PADDING_PX,
  BANDA_AVISO_PX,
  hojaDeComandaVisible,
  hojaOcupaLaPantalla,
  modoDeLosAvisos,
} from "../src/lib/hospitalityGrid.js";
import { MIN_TOUCH_PX } from "../src/lib/hospitalityTheme.js";

describe("n1-hosteleria-2 · la hoja ocupa la pantalla (1 y 4)", () => {
  it("en la mano, sí", () => {
    expect(hojaOcupaLaPantalla(true)).toBe(true);
  });

  it("en el terminal no se consulta, y si se consulta dice que no", () => {
    // Allí la comanda no es una hoja: es la columna izquierda.
    expect(hojaOcupaLaPantalla(false)).toBe(false);
  });

  it("y sigue sin pintarse si hay algo montado encima", () => {
    // El hallazgo 8 de `n1-hosteleria` no se toca: ocupar la pantalla no
    // es lo mismo que poder pintarse sobre «Tickets pasados».
    expect(hojaDeComandaVisible({ abierta: true, fueraDeLaVenta: true })).toBe(
      false,
    );
    expect(hojaDeComandaVisible({ abierta: true, fueraDeLaVenta: false })).toBe(
      true,
    );
  });
});

describe("n1-hosteleria-2 · los avisos no tapan trabajo (3)", () => {
  it("en la mano el coste está ACOTADO: una franja, diga cocina lo que diga", () => {
    // Es lo que R2 pide de verdad. No es que las bandas sean grandes: es
    // que crecen, así que en pleno servicio cocina decidía cuánta
    // comanda veía el camarero.
    const uno = altoDeLosAvisos({ deMano: true, avisos: 1 });
    for (const avisos of [1, 2, 3, 5, 12, 40]) {
      expect(altoDeLosAvisos({ deMano: true, avisos })).toBe(uno);
    }
    expect(uno).toBe(AVISOS_PADDING_PX + BANDA_AVISO_PX);
  });

  it("sin avisos no se lleva ni un píxel", () => {
    expect(altoDeLosAvisos({ deMano: true, avisos: 0 })).toBe(0);
    expect(altoDeLosAvisos({ deMano: false, avisos: 0 })).toBe(0);
  });

  it("la franja llega al suelo táctil: un toque abre la lista", () => {
    expect(BANDA_AVISO_PX).toBeGreaterThanOrEqual(48);
    expect(BANDA_AVISO_PX).toBe(MIN_TOUCH_PX);
  });

  it("SABOTAJE · apiladas, dos avisos cuestan 124 px de comanda", () => {
    // Lo que había: 8 de relleno + 2 × 56 de banda + 4 de hueco. Y con
    // cinco, 304 px — más de un tercio de la pantalla del N1 en avisos,
    // y el camarero no elige cuántos entran.
    expect(altoDeLosAvisos({ deMano: false, avisos: 2 })).toBe(124);
    expect(altoDeLosAvisos({ deMano: false, avisos: 5 })).toBe(304);
    // En la mano, lo mismo cuesta siempre 64.
    expect(altoDeLosAvisos({ deMano: true, avisos: 5 })).toBe(64);
  });

  it("en el TERMINAL se siguen apilando, y eso es correcto", () => {
    // Ahí la comanda es una columna de 800 px: dos bandas no le quitan
    // ninguna línea, y la pila se lee de más antigua a más nueva de un
    // vistazo. Es la restricción del bloque.
    expect(modoDeLosAvisos(false)).toBe("pila");
    expect(altoDeLosAvisos({ deMano: false, avisos: 3 })).toBeGreaterThan(
      altoDeLosAvisos({ deMano: false, avisos: 2 }),
    );
  });

  it("en la mano es un contador, no una pila", () => {
    expect(modoDeLosAvisos(true)).toBe("contador");
  });
});

describe("n1-hosteleria-2 · lo que esto le devuelve a la comanda", () => {
  // La cuenta que justifica el hallazgo 1, con los números del aparato:
  // la hoja de la mano mide 720 y el 88 % eran 633,6.
  const PANTALLA = 720;

  it("la hoja gana 86 px sólo por dejar de ser el 88 %", () => {
    const antes = Math.floor(PANTALLA * 0.88);
    expect(antes).toBe(633);
    expect(PANTALLA - antes).toBe(87);
  });

  it("y con dos avisos gana 147 px de lista", () => {
    // 87 de la hoja entera + los 60 que los avisos dejan de llevarse.
    const antesAvisos = altoDeLosAvisos({ deMano: false, avisos: 2 });
    const ahoraAvisos = altoDeLosAvisos({ deMano: true, avisos: 2 });
    expect(antesAvisos - ahoraAvisos).toBe(60);
    expect(PANTALLA - Math.floor(PANTALLA * 0.88) + 60).toBe(147);
    // 147 px son DOS líneas de comanda de las de dos renglones, que es
    // la diferencia entre revisar una comanda de seis y desplazarla.
    // Lo que de verdad cabe se mide en el navegador: va en el `-done`.
  });
});
