// residencia-6 (D-68) · **LA TABLA DEL LARGO DEL PIN.**
//
// La regla entera son veinte líneas y vive en el paquete puro porque la
// ejecutan cuatro sitios: la puerta sin red, la sala, el móvil de guardia
// y la pantalla de Personal del admin. Este fichero es su tabla.
//
// Lo que fija, en el orden en que importa:
//
//   1. **Auxiliar → 4. DUE, médico, calidad, dirección → 6.** Y quien
//      lleva de los dos tipos de rol, 6.
//   2. **El caso que D-68 nombra**: a una auxiliar con PIN de 4 se le da
//      el rol de DUE y su PIN queda POR RENOVAR. Nadie le ha tocado el
//      PIN, y desde ese momento no abre nada.
//   3. **Un PIN más largo del necesario vale.** Si no, el rechazo caería
//      sobre la auxiliar que se puso seis cifras porque quiso.
//   4. **El revés no es simétrico**: a quien le quitan el rol de DUE, su
//      PIN de 6 sigue valiendo. Un PIN largo nunca está «por renovar»
//      hacia abajo, y obligarla a volver a 4 sería pedirle que se baje
//      la seguridad.

import { describe, expect, it } from "vitest";

import {
  LARGO_DE_ALCANCE_TOTAL,
  LARGO_MAXIMO,
  LARGO_POR_ZONA,
  largoDePinRequerido,
  pinPorRenovar,
  problemaDelPinNuevo,
} from "../src/pin-por-alcance.js";

const AUXILIAR = { alcanceTotal: false };
const LIMPIEZA = { alcanceTotal: false };
const DUE = { alcanceTotal: true };
const MEDICO = { alcanceTotal: true };

describe("cuántas cifras le tocan", () => {
  const casos: Array<{
    quien: string;
    roles: Array<{ alcanceTotal: boolean }>;
    largo: number;
  }> = [
    { quien: "una auxiliar", roles: [AUXILIAR], largo: 4 },
    { quien: "la limpiadora", roles: [LIMPIEZA], largo: 4 },
    { quien: "dos roles de zona", roles: [AUXILIAR, LIMPIEZA], largo: 4 },
    { quien: "la DUE", roles: [DUE], largo: 6 },
    { quien: "el médico", roles: [MEDICO], largo: 6 },
    // D-68, literal: «Quien tenga los dos tipos de rol, 6.»
    { quien: "auxiliar Y DUE a la vez", roles: [AUXILIAR, DUE], largo: 6 },
    { quien: "DUE y auxiliar, en el otro orden", roles: [DUE, AUXILIAR], largo: 6 },
    // Sin roles, cuatro: la ruta del PIN ya lo para antes por otro motivo
    // («dale primero un rol de cuidado que registre»), y pedirle seis
    // cifras a alguien a quien no se le va a dejar poner PIN sería una
    // frase que no se puede cumplir.
    { quien: "nadie, sin roles", roles: [], largo: 4 },
  ];

  for (const c of casos) {
    it(`${c.quien} → ${c.largo}`, () => {
      expect(largoDePinRequerido(c.roles)).toBe(c.largo);
    });
  }

  it("las dos constantes son las de D-68", () => {
    expect(LARGO_POR_ZONA).toBe(4);
    expect(LARGO_DE_ALCANCE_TOTAL).toBe(6);
    // Y el techo sigue siendo el de residencia-3: un centro puede
    // alargarlo sin migración.
    expect(LARGO_MAXIMO).toBe(8);
  });
});

describe("el PIN que se quedó corto", () => {
  it("a una auxiliar con PIN de 4 se le da el rol de DUE · POR RENOVAR", () => {
    // **El caso de D-68.** Nadie le ha tocado el PIN: la dirección ha
    // tocado los roles, y el PIN de cuatro cifras ha pasado a abrir todo
    // el centro.
    expect(pinPorRenovar({ largoDelPin: 4, roles: [AUXILIAR] })).toBe(false);
    expect(pinPorRenovar({ largoDelPin: 4, roles: [AUXILIAR, DUE] })).toBe(true);
  });

  it("con seis cifras no está por renovar", () => {
    expect(pinPorRenovar({ largoDelPin: 6, roles: [DUE] })).toBe(false);
  });

  it("y a la auxiliar de siempre no le pasa nada", () => {
    expect(pinPorRenovar({ largoDelPin: 4, roles: [AUXILIAR] })).toBe(false);
  });

  it("un PIN MÁS LARGO del necesario nunca está por renovar", () => {
    // Ni al perder el rol de DUE. Obligar a volver a cuatro sería pedirle
    // que se baje la seguridad, y un PIN de ocho se teclea donde haya
    // teclado completo.
    expect(pinPorRenovar({ largoDelPin: 6, roles: [AUXILIAR] })).toBe(false);
    expect(pinPorRenovar({ largoDelPin: 8, roles: [AUXILIAR] })).toBe(false);
  });

  it("cinco cifras NO bastan para alcance total", () => {
    // El límite es «al menos seis», no «par» ni «distinto de cuatro».
    expect(pinPorRenovar({ largoDelPin: 5, roles: [DUE] })).toBe(true);
  });
});

describe("qué se le dice a la dirección al ponerlo", () => {
  it("cuatro cifras a una auxiliar: nada que decir", () => {
    expect(problemaDelPinNuevo("4071", [AUXILIAR])).toBeNull();
  });

  it("seis a una DUE: nada que decir", () => {
    expect(problemaDelPinNuevo("918256", [DUE])).toBeNull();
  });

  it("CUATRO a una DUE: se rechaza, y la frase dice por qué", () => {
    const frase = problemaDelPinNuevo("9182", [DUE]);
    expect(frase).not.toBeNull();
    // La frase no es «PIN inválido»: dice qué pasa y cuánto cuesta no
    // hacerlo. Quien la lee es quien decide.
    expect(frase).toContain("6 cifras");
    expect(frase).toContain("todo el centro");
  });

  it("seis a una auxiliar: vale, no se le obliga a cuatro", () => {
    expect(problemaDelPinNuevo("918256", [AUXILIAR])).toBeNull();
  });

  it("tres cifras no valen para nadie", () => {
    expect(problemaDelPinNuevo("407", [AUXILIAR])).toContain("4 cifras");
  });

  it("nueve cifras tampoco", () => {
    expect(problemaDelPinNuevo("123456789", [DUE])).toContain("8 cifras");
  });

  it("y lo que no son cifras, menos", () => {
    expect(problemaDelPinNuevo("40a1", [AUXILIAR])).toBe("El PIN son sólo cifras.");
    expect(problemaDelPinNuevo("", [AUXILIAR])).toBe("El PIN son sólo cifras.");
  });
});
