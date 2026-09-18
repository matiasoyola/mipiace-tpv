// B-reservas-mostrador F2 · el contraste del tinte, con números.
//
// El bloque promete que la tarjeta de la cita se tiñe con el color de la
// profesional SIN perder legibilidad, y que eso vale «con el color real de
// cada profesional y con uno oscuro y uno muy claro». Eso no se comprueba
// mirando: se comprueba con la fórmula de WCAG, que es lo que hay aquí.
//
// Los dos textos de la tarjeta y el filete del estado tienen cada uno su
// umbral:
//   · texto normal      → 4,5:1  (WCAG 1.4.3 AA)
//   · componente no textual (el filete) → 3:1 (WCAG 1.4.11)

import { describe, expect, it } from "vitest";

import { STATUS_COLOR, type AppointmentStatus } from "../src/lib/agenda.js";
import {
  LUMINANCIA_MAX_CABECERA,
  LUMINANCIA_MAX_ESTADO,
  LUMINANCIA_TINTE,
  colorDeCabecera,
  colorDeProfesional,
  contraste,
  luminanciaRelativa,
  parseHex,
  tinteClaro,
  tinteDeProfesional,
  tonoDeEstado,
} from "../src/lib/staffColor.js";

/** Los estados que la rejilla llega a pintar. CANCELLED no: las citas
 *  canceladas se saltan (`AgendaPage.tsx`, el `continue` de `apptsByStaff`). */
const ESTADOS_PINTABLES = (
  Object.keys(STATUS_COLOR) as AppointmentStatus[]
).filter((s) => s !== "CANCELLED");

// Los dos textos de la tarjeta, tal y como los pinta `StaffColumn`.
const INK = "#1f2937"; // `text-mipiace-ink`, primera línea
const SLATE_600 = "#475569"; // `text-slate-600`, segunda línea
const SLATE_500 = "#64748b"; // lo que había antes

// Colores de verdad: el morado del banco visual, el rosa, el azul, uno
// casi negro y uno casi blanco.
const COLORES_REALES = [
  "#8b5cf6",
  "#ec4899",
  "#0ea5e9",
  "#4c1d95", // el caso oscuro
  "#fef9c3", // el caso clarísimo
  "#111827",
  "#fffde7",
  "#10b981",
];

describe("la luminancia relativa es la de WCAG", () => {
  it("el blanco es 1 y el negro es 0", () => {
    expect(luminanciaRelativa(parseHex("#ffffff")!)).toBeCloseTo(1, 6);
    expect(luminanciaRelativa(parseHex("#000000")!)).toBeCloseTo(0, 6);
  });

  it("el contraste blanco/negro es 21:1", () => {
    expect(contraste("#ffffff", "#000000")).toBeCloseTo(21, 4);
  });

  it("acepta la forma corta de tres dígitos", () => {
    expect(parseHex("#fff")).toEqual([255, 255, 255]);
    expect(parseHex("#abc")).toEqual([170, 187, 204]);
  });

  it("un color que no se entiende no revienta: devuelve null", () => {
    expect(parseHex("morado")).toBeNull();
    expect(parseHex("")).toBeNull();
    expect(parseHex(null)).toBeNull();
    expect(parseHex("#12345")).toBeNull();
  });
});

describe("por qué la segunda línea pasa de slate-500 a slate-600", () => {
  it("slate-500 pasa AA sobre BLANCO: no era un fallo hasta ahora", () => {
    expect(contraste(SLATE_500, "#ffffff")).toBeGreaterThanOrEqual(4.5);
  });

  it("pero NO lo pasa sobre un tinte que se vea: por eso el color no cabía", () => {
    // Para que slate-500 pasara AA el fondo tendría que estar en L ≥ 0,943,
    // que es un tinte indistinguible del blanco. Con el tinte del bloque, no.
    expect(contraste(SLATE_500, tinteClaro("#8b5cf6"))).toBeLessThan(4.5);
  });

  it("slate-600 sí lo pasa sobre el tinte, y con margen", () => {
    expect(contraste(SLATE_600, tinteClaro("#8b5cf6"))).toBeGreaterThan(5);
    expect(contraste(SLATE_600, "#ffffff")).toBeGreaterThan(7);
  });
});

describe("el tinte lleva CUALQUIER color a la misma luminancia", () => {
  for (const color of COLORES_REALES) {
    it(`${color} → luminancia ${LUMINANCIA_TINTE}`, () => {
      const t = tinteClaro(color);
      // Banda, no igualdad: la bisección es exacta pero el color acaba en
      // canales de 8 bits y redondear mueve la luminancia un pelo.
      const l = luminanciaRelativa(parseHex(t)!);
      expect(l).toBeGreaterThan(LUMINANCIA_TINTE - 0.005);
      expect(l).toBeLessThan(LUMINANCIA_TINTE + 0.005);
    });

    it(`${color} teñido pasa AA con las dos líneas de la tarjeta`, () => {
      const t = tinteClaro(color);
      expect(contraste(INK, t)).toBeGreaterThanOrEqual(4.5);
      expect(contraste(SLATE_600, t)).toBeGreaterThanOrEqual(4.5);
    });

    it(`el filete del ESTADO se distingue encima del tinte de ${color}`, () => {
      const t = tinteClaro(color);
      expect(ESTADOS_PINTABLES).toHaveLength(5);
      for (const estado of ESTADOS_PINTABLES) {
        expect(
          contraste(tonoDeEstado(STATUS_COLOR[estado]), t),
        ).toBeGreaterThanOrEqual(3);
      }
    });
  }

  it("un color oscurísimo se ACLARA y uno clarísimo se BAJA, los dos al mismo peso", () => {
    const oscuro = luminanciaRelativa(parseHex(tinteClaro("#111827"))!);
    const claro = luminanciaRelativa(parseHex(tinteClaro("#fffde7"))!);
    expect(Math.abs(oscuro - claro)).toBeLessThan(0.01);
  });

  it("el tono sobrevive: el tinte de un rojo sigue teniendo el rojo por encima", () => {
    const [r, g, b] = parseHex(tinteClaro("#dc2626"))!;
    expect(r).toBeGreaterThan(g);
    expect(r).toBeGreaterThan(b);
  });

  it("un color que no se entiende cae en blanco, no en una excepción", () => {
    expect(tinteClaro(null)).toBe("#ffffff");
    expect(tinteClaro("chorizo")).toBe("#ffffff");
  });
});

describe("el color del ESTADO cierra un defecto que ya estaba en master", () => {
  it("STATUS_COLOR tal cual NO llega a 3:1 ni contra la tarjeta BLANCA de hoy", () => {
    // Es el defecto preexistente que el tinte destapa, no uno que cree.
    expect(contraste(STATUS_COLOR.IN_SERVICE, "#ffffff")).toBeLessThan(3);
    expect(contraste(STATUS_COLOR.PENDING, "#ffffff")).toBeLessThan(3);
    // Y el chip del detalle pinta texto BLANCO encima de ese ámbar.
    expect(contraste(STATUS_COLOR.PENDING, "#ffffff")).toBeLessThan(4.5);
  });

  it("el tono derivado sí llega, contra el tinte Y contra el blanco del chip", () => {
    for (const estado of ESTADOS_PINTABLES) {
      const tono = tonoDeEstado(STATUS_COLOR[estado]);
      expect(luminanciaRelativa(parseHex(tono)!)).toBeLessThanOrEqual(
        LUMINANCIA_MAX_ESTADO + 0.005,
      );
      // filete sobre el tinte (componente no textual, 3:1)
      expect(contraste(tono, tinteClaro("#8b5cf6"))).toBeGreaterThanOrEqual(3);
      // chip del detalle: texto blanco encima (texto normal, 4,5:1)
      expect(contraste(tono, "#ffffff")).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("los cinco estados siguen siendo cinco colores distintos", () => {
    const tonos = new Set(
      ESTADOS_PINTABLES.map((e) => tonoDeEstado(STATUS_COLOR[e])),
    );
    expect(tonos.size).toBe(5);
  });

  it("un estado que ya estaba por debajo del techo no se toca", () => {
    // COMPLETED (#64748b) está justo por encima; CANCELLED es claro y se baja.
    expect(tonoDeEstado("#000000")).toBe("#000000");
    expect(tonoDeEstado("#1f2937")).toBe("#1f2937");
  });
});

describe("el filete de la CABECERA se ve sobre blanco", () => {
  const ID = "00000000-0000-0000-0000-0000000000a1";

  it("un amarillo casi blanco se baja hasta que se distingue", () => {
    const crudo = "#fef9c3";
    expect(contraste(crudo, "#ffffff")).toBeLessThan(3); // el defecto
    const filete = colorDeCabecera(ID, crudo);
    expect(filete).not.toBe(crudo);
    expect(contraste(filete, "#ffffff")).toBeGreaterThanOrEqual(3);
    expect(luminanciaRelativa(parseHex(filete)!)).toBeLessThanOrEqual(
      LUMINANCIA_MAX_CABECERA + 0.005,
    );
  });

  it("un color que ya se veía NO se toca", () => {
    expect(colorDeCabecera(ID, "#4c1d95")).toBe("#4c1d95");
    expect(colorDeCabecera(ID, "#8b5cf6")).toBe("#8b5cf6");
  });

  it("y el de una profesional SIN color también se ve", () => {
    for (const id of ["a", "b", "c", ID, "st-sole", "st-marta", "st-nuria"]) {
      expect(contraste(colorDeCabecera(id, null), "#ffffff")).toBeGreaterThanOrEqual(3);
    }
  });

  it("el tono del filete conserva el tono del tinte: es la misma columna", () => {
    // Los dos salen del mismo color base, así que el amarillo sigue siendo
    // amarillo arriba y abajo.
    const [r, g, b] = parseHex(colorDeCabecera(ID, "#fef9c3"))!;
    expect(r).toBeGreaterThan(b);
    expect(g).toBeGreaterThan(b);
  });
});

describe("por qué el marcador «Sin nombre» no puede ir en gris claro", () => {
  it("slate-400 sobre el tinte es ilegible: por eso hereda el color de la línea", () => {
    // El número que cerró la discusión en el bucle visual.
    expect(contraste("#94a3b8", tinteClaro("#8b5cf6"))).toBeLessThan(2.5);
  });
});

describe("una profesional sin color tiene un color ESTABLE", () => {
  const ISA = "00000000-0000-0000-0000-0000000000i1";

  it("el mismo id da siempre el mismo color", () => {
    const a = colorDeProfesional(ISA, null);
    for (let i = 0; i < 50; i++) expect(colorDeProfesional(ISA, null)).toBe(a);
  });

  it("y su tinte también, que es lo que se pinta", () => {
    expect(tinteDeProfesional(ISA, null)).toBe(tinteDeProfesional(ISA, null));
    expect(tinteDeProfesional(ISA, undefined)).toBe(tinteDeProfesional(ISA, null));
  });

  it("el color por defecto también pasa AA al teñirse", () => {
    for (const id of ["a", "b", "c", ISA, "st-sole", "st-marta", "st-nuria"]) {
      const t = tinteDeProfesional(id, null);
      expect(contraste(INK, t)).toBeGreaterThanOrEqual(4.5);
      expect(contraste(SLATE_600, t)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("si la profesional SÍ tiene color, gana el suyo", () => {
    expect(colorDeProfesional(ISA, "#8b5cf6")).toBe("#8b5cf6");
    expect(tinteDeProfesional(ISA, "#8b5cf6")).toBe(tinteClaro("#8b5cf6"));
  });

  it("ids distintos reparten por la paleta y no caen todos en el mismo", () => {
    const ids = Array.from({ length: 40 }, (_, i) => `staff-${i}`);
    const distintos = new Set(ids.map((id) => colorDeProfesional(id, null)));
    expect(distintos.size).toBeGreaterThanOrEqual(6);
  });
});
