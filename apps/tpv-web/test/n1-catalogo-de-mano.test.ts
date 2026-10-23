// n1-hosteleria · QUIÉN TIENE EL SITIO EN EL CATÁLOGO (2, 7) Y LA HOJA
// DE LA COMANDA AL SALIR DE LA VENTA (8).
//
// La pasada del 18-10, en el N1 con la carta de Sirope:
//
//   · 🟡 (2) con «tost» escrito y el teclado abierto —ventana 360 × 449—
//     las seis familias ocupaban la pantalla y el primero de los 25
//     resultados caía en y=592. Ni un resultado a la vista.
//   · 🟡 (7) con «Cafe» elegida, el primer producto en y=833 con ventana
//     de 648. Parecía que tocar la familia no había hecho nada.
//
// Las dos filas de la tabla de sabotajes que viven aquí:
//
//   | Con texto en el buscador se pintan las familias   | el banco de búsqueda
//   | Con familia elegida no se pliega la rejilla        | el banco de familia elegida
//   | La hoja de la comanda no se cierra al ir a Tickets | el banco de navegación

import { describe, expect, it } from "vitest";

import {
  hojaDeComandaVisible,
  repartoDelCatalogo,
  type VistaDelCatalogo,
} from "../src/lib/hospitalityGrid.js";

const AHORA: VistaDelCatalogo = { kind: "ahora" };
const CAFE: VistaDelCatalogo = { kind: "family", tag: "cafe" };

describe("n1-hosteleria · buscando, las familias ceden el sitio", () => {
  it("con texto en el buscador NO se pinta ni la rejilla ni la tira", () => {
    expect(
      repartoDelCatalogo({
        deMano: true,
        buscando: true,
        vista: AHORA,
        rejillaAbierta: false,
      }),
    ).toEqual({ rejilla: false, tira: false, cantidad: false });
  });

  it("y tampoco con una familia elegida de antes", () => {
    // Manda la búsqueda: `products` llega ya filtrado por ella, así que
    // la familia no pinta nada mientras se busca.
    expect(
      repartoDelCatalogo({
        deMano: true,
        buscando: true,
        vista: CAFE,
        rejillaAbierta: false,
      }),
    ).toEqual({ rejilla: false, tira: false, cantidad: false });
  });

  it("al borrar la búsqueda vuelve lo que tocaba", () => {
    expect(
      repartoDelCatalogo({
        deMano: true,
        buscando: false,
        vista: AHORA,
        rejillaAbierta: false,
      }),
    ).toEqual({ rejilla: true, tira: false, cantidad: true });
    expect(
      repartoDelCatalogo({
        deMano: true,
        buscando: false,
        vista: CAFE,
        rejillaAbierta: false,
      }),
    ).toEqual({ rejilla: false, tira: true, cantidad: true });
  });
});

describe("n1-hosteleria · con familia elegida, la rejilla se pliega", () => {
  it("elegida «Cafe» se pinta la TIRA y no la rejilla", () => {
    expect(
      repartoDelCatalogo({
        deMano: true,
        buscando: false,
        vista: CAFE,
        rejillaAbierta: false,
      }),
    ).toEqual({ rejilla: false, tira: true, cantidad: true });
  });

  it("«Cambiar» devuelve la rejilla sin perder la familia", () => {
    // `rejillaAbierta` no cambia la vista: la familia sigue elegida y su
    // azulejo sigue marcado dentro de la rejilla.
    expect(
      repartoDelCatalogo({
        deMano: true,
        buscando: false,
        vista: CAFE,
        rejillaAbierta: true,
      }),
    ).toEqual({ rejilla: true, tira: false, cantidad: true });
  });

  it("en «Ahora» la rejilla está, que es la vista de entrada", () => {
    expect(
      repartoDelCatalogo({
        deMano: true,
        buscando: false,
        vista: AHORA,
        rejillaAbierta: false,
      }),
    ).toEqual({ rejilla: true, tira: false, cantidad: true });
    // Y «Ahora» no se pliega nunca: no hay familia que poner en la tira.
    expect(
      repartoDelCatalogo({
        deMano: true,
        buscando: false,
        vista: AHORA,
        rejillaAbierta: true,
      }),
    ).toEqual({ rejilla: true, tira: false, cantidad: true });
  });
});

describe("n1-hosteleria · la restricción: en el terminal no cambia nada", () => {
  it("la rejilla está SIEMPRE, pase lo que pase", () => {
    // Trece familias a seis columnas son dos filas de 76 px: en el D8 y
    // el AP13 sobra pantalla, y plegarlas sería quitarle al cajero el
    // mapa de la carta que ya tiene aprendido.
    for (const buscando of [true, false]) {
      for (const vista of [AHORA, CAFE]) {
        for (const rejillaAbierta of [true, false]) {
          expect(
            repartoDelCatalogo({
              deMano: false,
              buscando,
              vista,
              rejillaAbierta,
            }),
          ).toEqual({ rejilla: true, tira: false, cantidad: true });
        }
      }
    }
  });
});

describe("n1-hosteleria · la hoja de la comanda no sobrevive a salir (8)", () => {
  // La pasada del 18-10: abierta la comanda, «Tickets pasados», ficha de
  // un ticket y volver — la hoja seguía abierta debajo, y bloqueó DOS
  // veces los toques de la búsqueda y de las familias.
  //
  // La fila de la tabla de sabotajes:
  //   | La hoja de la comanda no se cierra al ir a Tickets | este banco

  it("abierta y en la venta, se pinta", () => {
    expect(
      hojaDeComandaVisible({ abierta: true, fueraDeLaVenta: false }),
    ).toBe(true);
  });

  it("abierta pero con algo encima, NO se pinta", () => {
    // «Tickets pasados», la ficha de un ticket, el cajón, la agenda,
    // «Cerrar el día» y el arqueo X entran todos por aquí.
    expect(
      hojaDeComandaVisible({ abierta: true, fueraDeLaVenta: true }),
    ).toBe(false);
  });

  it("cerrada, no se pinta pase lo que pase", () => {
    expect(
      hojaDeComandaVisible({ abierta: false, fueraDeLaVenta: false }),
    ).toBe(false);
    expect(
      hojaDeComandaVisible({ abierta: false, fueraDeLaVenta: true }),
    ).toBe(false);
  });
});

describe("n1-hosteleria · buscando, la fila de cantidad también cede (hierro 23-10)", () => {
  // La pasada del 23-10 en el N1: con «tost» y el teclado abierto
  // (ventana 449) la rejilla de familias SÍ cedía, pero la fila de
  // cantidad no, y mide 120 px en estrecho. El primer resultado caía en
  // 425 … 493, fuera. Cediendo pasa a 291 … 359 y caben dos.
  //
  // La fila de la tabla de sabotajes:
  //   | Buscando se sigue pintando la fila de cantidad | este banco

  it("buscando en la mano, la fila de cantidad NO se pinta", () => {
    expect(
      repartoDelCatalogo({
        deMano: true,
        buscando: true,
        vista: AHORA,
        rejillaAbierta: false,
      }).cantidad,
    ).toBe(false);
  });

  it("sin buscar sí se pinta, con rejilla o con tira", () => {
    for (const vista of [AHORA, CAFE]) {
      expect(
        repartoDelCatalogo({
          deMano: true,
          buscando: false,
          vista,
          rejillaAbierta: false,
        }).cantidad,
      ).toBe(true);
    }
  });

  it("en el TERMINAL se pinta siempre, también buscando", () => {
    // La restricción: el D8 y el AP13 no se mueven. Ahí la fila cabe en
    // una sola línea de 56 px y no le quita el sitio a nada.
    for (const buscando of [true, false]) {
      expect(
        repartoDelCatalogo({
          deMano: false,
          buscando,
          vista: AHORA,
          rejillaAbierta: false,
        }).cantidad,
      ).toBe(true);
    }
  });
});
