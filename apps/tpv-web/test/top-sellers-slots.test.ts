// v1.14.1-el-catalogo-manda · §3. Cuántos atajos de "lo que más sale"
// caben en el panel del ticket, sin DOM.
//
// La regla tiene DOS consumidores: la carga del ranking (`SalePage` no
// pide el ranking si no va a pintar nada) y el pintado del hueco. Por
// eso es una función y no dos condiciones sueltas: si divergieran, el
// panel pediría atajos que nadie ha cargado —o al revés— y el síntoma
// sería un hueco silencioso, que es exactamente el defecto que este
// bloque viene a arreglar.

import { describe, expect, it } from "vitest";

import { topSellersSlotsFor } from "../src/lib/topSellers.js";

describe("topSellersSlotsFor · el hueco del desglose", () => {
  // Los números salen de MEDIR el panel a 1280 × 800, no de sumar sobre
  // el papel: lista de 304 px, línea de ticket de 90, atajo de hasta 71
  // (el nombre va a `line-clamp-2`, así que 71 es techo) y 43 px entre
  // separación y rótulo.
  it("con el ticket vacío son los cinco: es el estado vacío de v1.14", () => {
    expect(topSellersSlotsFor(0)).toBe(5);
  });

  it("con una línea sobran 190 px: una fila de dos", () => {
    expect(topSellersSlotsFor(1)).toBe(2);
  });

  // Dos filas de atajos piden 193 px sobre 190 disponibles. Que falte
  // por TRES píxeles no es motivo para apretar los márgenes hasta que
  // entren: v1.14 ya cortó por abajo el quinto atajo del estado vacío
  // haciendo eso, y un atajo cortado es peor que un atajo que no está.
  it("con una línea NO se fuerzan dos filas por tres píxeles", () => {
    expect(topSellersSlotsFor(1)).toBeLessThan(4);
  });

  it("con dos líneas ya no cabe la fila (114 px sobre 100)", () => {
    expect(topSellersSlotsFor(2)).toBe(0);
  });

  it("con el ticket crecido no se pinta ninguno", () => {
    for (const n of [3, 4, 8, 12, 40]) {
      expect(topSellersSlotsFor(n)).toBe(0);
    }
  });

  // Se equivoca del lado bueno: de menos, nunca de más. Un atajo que no
  // está sólo cuesta un viaje a la rejilla; un atajo cortado por abajo
  // es una promesa rota en el sitio donde hay prisa.
  it("nunca crece al crecer el ticket (monotonía decreciente)", () => {
    let previo = topSellersSlotsFor(0);
    for (let n = 1; n <= 20; n++) {
      const slots = topSellersSlotsFor(n);
      expect(slots).toBeLessThanOrEqual(previo);
      previo = slots;
    }
  });

  it("un recuento negativo o absurdo no rompe: cae al estado vacío", () => {
    expect(topSellersSlotsFor(-1)).toBe(5);
  });
});
