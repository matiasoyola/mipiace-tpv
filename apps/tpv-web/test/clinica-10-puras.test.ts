// clinica-10 · lo puro del paso 33: QUE EL NOMBRE SE LEA ENTERO.
//
// La pasada del 27-10 (captura 33) con el catálogo de Rosario en la
// pantalla de venta: tres tarjetas diciendo «biomecánic» —la palabra
// recortada a mitad de letra— y el rail de categorías diciendo
// «Biomecáni…».
//
// Lo que se prueba aquí es la decisión, con los nombres de verdad: el
// CSV de Rosario entero (`docs/implantaciones/rosario/catalogo-tpv.csv`)
// y sus cinco categorías. Que lo elegido se PINTE es de la pantalla; que
// con el cuerpo elegido quepa, es esto.

import { describe, expect, it } from "vitest";

import {
  ANCHO_UTIL_RAIL,
  ANCHO_UTIL_TARJETA,
  CUERPOS_DE_RAIL,
  CUERPOS_DE_TARJETA,
  anchoAproximado,
  cuerpoQueCabe,
  palabraMasLarga,
} from "../src/lib/ancho-del-texto.js";

/** Los 17 servicios del CSV de Rosario, tal cual. */
const CATALOGO_DE_ROSARIO = [
  "Consulta diagnóstico",
  "Quiropodia básica",
  "Quiropodia completa",
  "Quiropodia extra",
  "Quiropodia a domicilio",
  "Cura",
  "Sesión papiloma",
  "Exploración biomecánica",
  "Revisión biomecánica adultos",
  "Revisión biomecánica niños",
  "Entrega de órtesis plantares",
  "Órtesis de silicona pequeña",
  "Órtesis de silicona mediana",
  "Órtesis de silicona grande",
  "Cirugía fenol 1 borde",
  "Cirugía fenol 2 bordes",
  "Avulsión ungueal",
];

/** Y sus cinco categorías, como las pinta el rail (capitalizadas). */
const CATEGORIAS_DE_ROSARIO = [
  "Consulta",
  "Quiropodia",
  "Cirugía",
  "Biomecánica",
  "Órtesis",
];

describe("clinica-10 (33) · el catálogo de Rosario cabe en la tarjeta", () => {
  it("ni un nombre se queda sin caber con el cuerpo que se le da", () => {
    for (const nombre of CATALOGO_DE_ROSARIO) {
      const palabra = palabraMasLarga(nombre);
      const cuerpo = cuerpoQueCabe(
        palabra,
        ANCHO_UTIL_TARJETA,
        CUERPOS_DE_TARJETA,
      );
      expect(
        anchoAproximado(palabra, cuerpo),
        `«${palabra}» (de «${nombre}») no cabe ni a ${cuerpo} px`,
      ).toBeLessThanOrEqual(ANCHO_UTIL_TARJETA);
    }
  });

  it("y sólo encoge lo que hace falta: «biomecánica» sí, «diagnóstico» no", () => {
    // Las dos tienen once letras y no ocupan lo mismo: una lleva una `m`
    // y la otra tres astas finas. Con un ancho medio por letra, o se
    // recorta la una o se encoge la otra sin motivo.
    const deTarjeta = (n: string) =>
      cuerpoQueCabe(palabraMasLarga(n), ANCHO_UTIL_TARJETA, CUERPOS_DE_TARJETA);
    expect(deTarjeta("Exploración biomecánica")).toBeLessThan(
      CUERPOS_DE_TARJETA[0],
    );
    expect(deTarjeta("Consulta diagnóstico")).toBe(CUERPOS_DE_TARJETA[0]);
    expect(deTarjeta("Quiropodia básica")).toBe(CUERPOS_DE_TARJETA[0]);
    expect(deTarjeta("Cura")).toBe(CUERPOS_DE_TARJETA[0]);
  });

  it("los tres pares que sólo se distinguen por la última palabra", () => {
    // Es lo que clinica-8 (fase B, 19) arregló con la tercera línea, y
    // lo que el recorte volvía a romper: «Revisión biomecánica adultos»
    // y «… niños» se leían las dos como «Revisión biomecánic».
    for (const par of [
      ["Revisión biomecánica adultos", "Revisión biomecánica niños"],
      ["Órtesis de silicona pequeña", "Órtesis de silicona grande"],
      ["Cirugía fenol 1 borde", "Cirugía fenol 2 bordes"],
    ]) {
      for (const nombre of par) {
        const palabra = palabraMasLarga(nombre);
        const cuerpo = cuerpoQueCabe(
          palabra,
          ANCHO_UTIL_TARJETA,
          CUERPOS_DE_TARJETA,
        );
        expect(anchoAproximado(palabra, cuerpo)).toBeLessThanOrEqual(
          ANCHO_UTIL_TARJETA,
        );
      }
    }
  });
});

describe("clinica-10 (33) · y las categorías caben en el rail", () => {
  it("las cinco de Rosario, con el cuerpo que se les da", () => {
    for (const etiqueta of CATEGORIAS_DE_ROSARIO) {
      const cuerpo = cuerpoQueCabe(etiqueta, ANCHO_UTIL_RAIL, CUERPOS_DE_RAIL);
      expect(
        anchoAproximado(etiqueta, cuerpo),
        `«${etiqueta}» no cabe en el rail ni a ${cuerpo} px`,
      ).toBeLessThanOrEqual(ANCHO_UTIL_RAIL);
    }
  });

  it("«Biomecánica» es la que obliga a bajar, y a 14 px no cabía", () => {
    expect(anchoAproximado("Biomecánica", CUERPOS_DE_RAIL[0])).toBeGreaterThan(
      ANCHO_UTIL_RAIL,
    );
    expect(
      cuerpoQueCabe("Biomecánica", ANCHO_UTIL_RAIL, CUERPOS_DE_RAIL),
    ).toBeLessThan(CUERPOS_DE_RAIL[0]);
  });

  it("las cortas se quedan donde estaban", () => {
    for (const corta of ["Todos", "Consulta", "Cirugía", "Órtesis"]) {
      expect(cuerpoQueCabe(corta, ANCHO_UTIL_RAIL, CUERPOS_DE_RAIL)).toBe(
        CUERPOS_DE_RAIL[0],
      );
    }
  });
});

describe("clinica-10 (33) · cómo se comporta la estimación", () => {
  it("la `m` cuenta más que la `i`, que es de lo que iba todo esto", () => {
    expect(anchoAproximado("m", 16)).toBeGreaterThan(anchoAproximado("i", 16));
  });

  it("de un nombre de varias palabras manda la MÁS LARGA", () => {
    // En una tarjeta de tres líneas, entre palabras el texto ya se parte
    // solo: lo que no cabe es una palabra suelta.
    expect(palabraMasLarga("Entrega de órtesis plantares")).toBe("plantares");
    expect(palabraMasLarga("Cura")).toBe("Cura");
  });

  it("si no cabe ni con el suelo, se devuelve el suelo y no se sigue bajando", () => {
    // Encoger sin fin haría ilegible lo que se quería poder leer. Para
    // ese caso está el `break-words` del elemento, que parte la palabra
    // en vez de recortarla.
    const imposible = "Mmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmm";
    expect(
      cuerpoQueCabe(imposible, ANCHO_UTIL_TARJETA, CUERPOS_DE_TARJETA),
    ).toBe(CUERPOS_DE_TARJETA[CUERPOS_DE_TARJETA.length - 1]);
  });

  it("y un texto vacío no cuesta nada", () => {
    expect(anchoAproximado("", 16)).toBe(0);
    expect(cuerpoQueCabe("", ANCHO_UTIL_TARJETA, CUERPOS_DE_TARJETA)).toBe(
      CUERPOS_DE_TARJETA[0],
    );
  });
});
