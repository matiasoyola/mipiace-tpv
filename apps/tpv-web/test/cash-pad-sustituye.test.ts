// v1.22-el-terminal-del-bar · §2 · hallazgo C2.
//
// Dos SABOTAJES tienen que caer aquí:
//
//   · Volver `applyKey` a ignorar el dígito con dos decimales ya
//     puestos → el test de "pre-relleno 6,90, pulsar 4 → 4".
//   · Que la sustitución dure más de una tecla → el test de "6,90,
//     pulsar 4 y 5 → 45".
//
// Lo medido en el AP13 el 06-10: en el mixto la segunda forma llega
// pre-rellena con el resto (6,90) y pulsar 4 no hacía NADA; borrando un
// dígito quedaba 6,9 y el 4 se pegaba detrás (6,94). En el fondo de
// apertura, igual con 0,00. Había que pulsar "C" primero, y la ayuda del
// campo del cobro decía «escribe encima si no cuadra».

import { describe, expect, it } from "vitest";

import { applyKey } from "../src/components/CashPad.js";

/** Teclea una ráfaga, con la sustitución SÓLO en la primera tecla. */
function teclea(prerelleno: string, teclas: string[], maxDecimals = 2): string {
  let v = prerelleno;
  teclas.forEach((k, i) => {
    v = applyKey(v, k, maxDecimals, { replace: i === 0 });
  });
  return v;
}

describe("v1.22 §2 · el primer dígito sustituye el pre-relleno", () => {
  it("6,90 + 4 → 4 (antes: 6,90, el dígito se ignoraba)", () => {
    expect(applyKey("6,90", "4", 2, { replace: true })).toBe("4");
  });

  it("la sustitución dura UNA tecla: 6,90 + 4 + 5 → 45", () => {
    expect(teclea("6,90", ["4", "5"])).toBe("45");
  });

  it("y sigue escribiendo normal: 6,90 + 4 + , + 5 + 0 → 4,50", () => {
    expect(teclea("6,90", ["4", ",", "5", "0"])).toBe("4,50");
  });

  it("el fondo de apertura: 0,00 + 1 + 0 + 0 → 100", () => {
    expect(teclea("0,00", ["1", "0", "0"])).toBe("100");
  });

  it("la coma también sustituye: 6,90 + , → 0,", () => {
    expect(applyKey("6,90", ",", 2, { replace: true })).toBe("0,");
  });

  it("'00' sobre un pre-relleno deja el campo vacío, no '00'", () => {
    // Vacío es "no introducido" y bloquea el botón de la acción, que es
    // lo honesto cuando el cajero acaba de borrar el importe que había.
    expect(applyKey("6,90", "00", 2, { replace: true })).toBe("");
  });

  it("en conteos enteros (arqueo) también sustituye: 12 + 3 → 3", () => {
    expect(applyKey("12", "3", 0, { replace: true })).toBe("3");
    expect(teclea("12", ["3", "4"], 0)).toBe("34");
  });

  it("sin `replace` el comportamiento es EXACTAMENTE el de antes", () => {
    // Esta es la red de seguridad del sabotaje al revés: si alguien
    // pusiera `replace` por defecto, el pad escribiría encima siempre y
    // no se podría teclear un importe de dos cifras.
    expect(applyKey("6,90", "4")).toBe("6,90");
    expect(applyKey("6,9", "4")).toBe("6,94");
    expect(applyKey("4", "5")).toBe("45");
    expect(applyKey("", "4")).toBe("4");
  });

  it("'C' y borrar siguen como hoy, con replace o sin él", () => {
    expect(applyKey("6,90", "C", 2, { replace: true })).toBe("");
    expect(applyKey("6,90", "back", 2, { replace: true })).toBe("6,9");
    expect(applyKey("6,90", "back")).toBe("6,9");
  });

  it("los decimales siguen topados: 4,50 + 7 no mete un tercer decimal", () => {
    expect(teclea("6,90", ["4", ",", "5", "0", "7"])).toBe("4,50");
  });
});
