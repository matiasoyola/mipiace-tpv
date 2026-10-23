// n1-hosteleria-2 · R4 · EL CONTRASTE DE CADA ESTADO DE MESA.
//
// El hallazgo 7 de Matías (23-10) fue «en la mesa por recoger no se lee
// lo que hay en el círculo», y el bloque pide revisar **todos** los
// estados, no sólo ése. Medidos, el reparto de culpas no era el que
// parecía:
//
//   · «Por recoger» da **7,69:1**. El contraste nunca fue el problema
//     ahí: era el tamaño, 13 px, y eso lo ata `n1-sala-de-mano`;
//   · la etiqueta «LISTO» daba **1,66:1** —blanco sobre verde pálido—,
//     que es texto invisible, y nadie la había mencionado;
//   · el importe de una mesa ocupada daba **3,03:1**, blanco sobre el
//     coral de la casa.
//
// O sea: de los tres fallos reales de contraste del mapa, el que se
// denunció no era ninguno. Por eso esta tabla se recorre entera y con
// una función, en vez de a ojo sobre una captura.
//
// Las filas de la tabla de sabotajes que viven aquí:
//
//   | La etiqueta LISTO vuelve al blanco            | 1,66:1
//   | El importe de la mesa ocupada vuelve al blanco | 3,03:1

import { describe, expect, it } from "vitest";

import {
  AA_TEXTO_NORMAL,
  contraste,
  esTextoGrande,
  mezcla,
} from "../src/lib/contraste.js";
import {
  DARK_CANVAS,
  DARK_INK,
  DARK_ON_CORAL,
  DARK_SURFACE_RAISED,
  DARK_TEXT_MUTED,
  TABLE_BILLING_FILL,
  TABLE_BILLING_TEXT,
  TABLE_BUSY_FILL,
  TABLE_BUSY_TEXT,
  TABLE_FREE_FILL,
  TABLE_FREE_TEXT,
  TABLE_POR_RECOGER_FILL,
  TABLE_POR_RECOGER_TEXT,
} from "../src/lib/hospitalityTheme.js";
import { VERDE_LISTA, VERDE_LISTA_TEXT } from "../src/lib/kitchenTheme.js";
import { SUELO_LETRA_MANO_PX } from "../src/lib/roomGrid.js";

/**
 * Cada texto que una mesa puede pintar EN LA MANO, con el color que lo
 * pinta de verdad y la opacidad con la que sale. Si mañana se añade un
 * estado, se añade su fila y el banco dice si se lee.
 */
const ESTADOS: Array<{
  estado: string;
  texto: string;
  tinta: string;
  relleno: string;
  opacidad: number;
  px: number;
  negrita: boolean;
}> = [
  // ── libre ───────────────────────────────────────────────────────────
  {
    estado: "libre",
    texto: "nombre",
    tinta: TABLE_FREE_TEXT,
    relleno: TABLE_FREE_FILL,
    opacidad: 1,
    px: 20,
    negrita: true,
  },
  {
    estado: "libre",
    texto: "N pax",
    tinta: TABLE_FREE_TEXT,
    relleno: TABLE_FREE_FILL,
    opacidad: 0.65,
    px: SUELO_LETRA_MANO_PX,
    negrita: false,
  },
  // ── ocupada · la tinta la cambia este bloque ───────────────────────
  {
    estado: "ocupada",
    texto: "nombre",
    tinta: DARK_INK,
    relleno: TABLE_BUSY_FILL,
    opacidad: 1,
    px: 20,
    negrita: true,
  },
  {
    estado: "ocupada",
    texto: "importe",
    tinta: DARK_INK,
    relleno: TABLE_BUSY_FILL,
    opacidad: 1,
    px: SUELO_LETRA_MANO_PX,
    negrita: true,
  },
  // ── pide la cuenta ─────────────────────────────────────────────────
  {
    estado: "cuenta",
    texto: "nombre",
    tinta: TABLE_BILLING_TEXT,
    relleno: TABLE_BILLING_FILL,
    opacidad: 1,
    px: 18,
    negrita: true,
  },
  {
    estado: "cuenta",
    texto: "«Cobrar» del botón",
    tinta: TABLE_BILLING_FILL,
    relleno: TABLE_BILLING_TEXT,
    opacidad: 1,
    px: SUELO_LETRA_MANO_PX,
    negrita: true,
  },
  {
    estado: "cuenta",
    texto: "importe del botón",
    tinta: TABLE_BILLING_FILL,
    relleno: TABLE_BILLING_TEXT,
    opacidad: 1,
    px: SUELO_LETRA_MANO_PX,
    negrita: true,
  },
  // ── por recoger · el que se denunció, y el que estaba bien ─────────
  {
    estado: "por recoger",
    texto: "nombre",
    tinta: TABLE_POR_RECOGER_TEXT,
    relleno: TABLE_POR_RECOGER_FILL,
    opacidad: 1,
    px: 20,
    negrita: true,
  },
  {
    estado: "por recoger",
    texto: "«POR RECOGER»",
    tinta: TABLE_POR_RECOGER_TEXT,
    relleno: TABLE_POR_RECOGER_FILL,
    opacidad: 1,
    px: SUELO_LETRA_MANO_PX,
    negrita: true,
  },
  // ── cobro pendiente de subir ───────────────────────────────────────
  {
    estado: "cobro pendiente",
    texto: "«Pendiente»",
    tinta: DARK_TEXT_MUTED,
    relleno: DARK_SURFACE_RAISED,
    opacidad: 1,
    px: SUELO_LETRA_MANO_PX,
    negrita: true,
  },
  // ── unida a un grupo · la tarjeta entera va a 0,55 ─────────────────
  {
    estado: "unida",
    texto: "nombre",
    tinta: DARK_ON_CORAL,
    relleno: mezcla(TABLE_BUSY_FILL, DARK_CANVAS, 0.55),
    opacidad: 1,
    px: 20,
    negrita: true,
  },
  {
    estado: "unida",
    texto: "«unida a X»",
    tinta: DARK_ON_CORAL,
    relleno: mezcla(TABLE_BUSY_FILL, DARK_CANVAS, 0.55),
    opacidad: 0.9,
    px: SUELO_LETRA_MANO_PX,
    negrita: false,
  },
  // ── algo listo en el pase ──────────────────────────────────────────
  {
    estado: "listo",
    texto: "etiqueta LISTO",
    tinta: VERDE_LISTA_TEXT,
    relleno: VERDE_LISTA,
    opacidad: 1,
    px: SUELO_LETRA_MANO_PX,
    negrita: true,
  },
];

describe("n1-hosteleria-2 · R4 · todos los estados de mesa llegan a 4,5:1", () => {
  for (const f of ESTADOS) {
    it(`${f.estado} · ${f.texto}`, () => {
      const r = contraste(f.tinta, f.relleno, f.opacidad);
      expect(r).toBeGreaterThanOrEqual(AA_TEXTO_NORMAL);
    });
  }

  it("y ninguno se acoge al umbral de «texto grande» para aprobar", () => {
    // El blanco sobre coral daba 3,03:1 y se salvaba por el nombre en
    // negrita a 20 px. El importe de al lado, texto normal, no se
    // salvaba con nada — y era el número. Así que en este bloque la
    // excepción de WCAG para texto grande no se usa: todo pasa el 4,5.
    for (const f of ESTADOS) {
      const r = contraste(f.tinta, f.relleno, f.opacidad);
      if (r < AA_TEXTO_NORMAL) {
        throw new Error(
          `${f.estado}/${f.texto} sólo llega a ${r.toFixed(2)}:1 y estaría ` +
            `apoyándose en texto grande (${esTextoGrande(f.px, f.negrita)})`,
        );
      }
    }
  });
});

describe("n1-hosteleria-2 · los dos contrastes que este bloque arregla", () => {
  it("SABOTAJE · la etiqueta LISTO en blanco es texto invisible", () => {
    // Lo que había desde kds-1, con la constante buena al lado y sin
    // usar. 1,66:1 sobre un umbral de 4,5.
    const roto = contraste("#FFFFFF", VERDE_LISTA);
    expect(roto).toBeLessThan(2);
    expect(roto).toBeLessThan(AA_TEXTO_NORMAL);
    // Y lo que hay ahora.
    expect(contraste(VERDE_LISTA_TEXT, VERDE_LISTA)).toBeGreaterThan(10);
  });

  it("SABOTAJE · el blanco sobre el coral no llega a 4,5:1", () => {
    const roto = contraste(TABLE_BUSY_TEXT, TABLE_BUSY_FILL);
    expect(roto).toBeLessThan(AA_TEXTO_NORMAL);
    expect(roto).toBeGreaterThan(3);
    // La tinta oscura sobre el MISMO coral sí llega: lo que cambia es el
    // texto y no el relleno, que es la marca y lo que dice «ocupada».
    expect(
      contraste(DARK_INK, TABLE_BUSY_FILL),
    ).toBeGreaterThanOrEqual(AA_TEXTO_NORMAL);
  });

  it("la meta de la mesa ocupada NO se mide: en la mano no se pinta", () => {
    // `n1-hosteleria` §2.2 ya la quitó de la forma pequeña. Si volviera,
    // volvería con 2,46:1 — blanco al 80% sobre coral—, así que queda
    // escrito aquí por qué no está en la tabla de arriba.
    expect(
      contraste(DARK_ON_CORAL, TABLE_BUSY_FILL, 0.8),
    ).toBeLessThan(AA_TEXTO_NORMAL);
  });
});
