// v1.6-Precio-Sobre-Total: el cajero de Frutos Secos Cachictos teclea el
// precio final con IVA incluido (bruto). El modelo/contrato siguen en
// neto, así que el editor convierte bruto→neto (4 dec) al persistir. Este
// test blinda el round-trip crítico: netToGross(grossToNet(gross)) debe
// re-redondear EXACTO al bruto tecleado — si no, el total que ve el
// cajero no cuadraría con lo que tecleó.

import { describe, expect, it } from "vitest";

import { grossToNet, netToGross, round2 } from "../src/lib/cart.js";

// Tipos de IVA españoles reales (21 general, 10 reducido, 5.2 eléctrico
// transitorio, 4 superreducido, 0 exento).
const SPANISH_RATES = [21, 10, 5.2, 4, 0];

// Importes puñeteros: céntimos impares, terminaciones x,x5 (borde de
// redondeo), y valores pequeños donde el drift de 1 céntimo pica más.
const TRICKY_GROSS = [
  0.01, 0.05, 0.07, 0.09, 0.13, 0.15, 0.25, 0.99, 1.0, 1.05, 1.15, 1.23,
  1.25, 1.99, 2.35, 3.45, 4.7, 5.55, 6.66, 7.77, 9.95, 10.05, 12.34, 19.99,
  23.45, 99.95, 100.0, 123.45,
];

describe("v1.6 · round-trip bruto→neto→bruto (helpers puros)", () => {
  for (const rate of SPANISH_RATES) {
    for (const gross of TRICKY_GROSS) {
      it(`IVA ${rate}% · ${gross} € re-redondea exacto tras convertir a neto`, () => {
        const net = grossToNet(gross, rate);
        // El neto se guarda con precisión Decimal(12,4) → como mucho 4 dec.
        expect(Number(net.toFixed(4))).toBe(net);
        // El round-trip debe devolver el céntimo tecleado.
        expect(netToGross(net, rate)).toBe(round2(gross));
      });
    }
  }

  it("IVA 0% · bruto === neto (sin caso especial)", () => {
    for (const gross of TRICKY_GROSS) {
      expect(grossToNet(gross, 0)).toBe(round2(gross));
      expect(netToGross(gross, 0)).toBe(round2(gross));
    }
  });

  it("barrido exhaustivo 0,01–50,00 € a 21% y 10% no rompe el round-trip", () => {
    for (const rate of [21, 10]) {
      for (let cents = 1; cents <= 5000; cents++) {
        const gross = cents / 100;
        const net = grossToNet(gross, rate);
        expect(netToGross(net, rate)).toBe(gross);
      }
    }
  });

  it("netToGross redondea a céntimo", () => {
    // 3.8843 × 1.21 = 4.700003 → 4.70
    expect(netToGross(3.8843, 21)).toBe(4.7);
    // 3.8843 × 1.10 = 4.27273 → 4.27
    expect(netToGross(3.8843, 10)).toBe(4.27);
  });
});
