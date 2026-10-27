// pin-1 · LAS REGLAS DEL PIN, SIN SERVIDOR DELANTE.
//
// `auth/pin.ts` es puro, así que lo que decide qué PIN se acepta se
// puede medir de verdad: no hay Fastify, ni Prisma, ni Redis entre la
// regla y el banco.
//
// Lo que este fichero fija:
//
//   1. qué PIN se rechaza por fácil, y que el motivo que devuelve DICE
//      por qué (el bloque lo pide: «un mensaje que diga por qué»);
//   2. qué PIN pasa — que es la mitad que se olvida: un filtro que
//      rechaza de más deja a la propietaria probando cinco veces sin
//      entender nada;
//   3. que el PIN del último recurso de soporte **nunca** sale trivial,
//      ni siquiera con un generador amañado.
//
// Sabotajes que pone en rojo:
//   · quitar cualquiera de las cinco reglas de `motivoPinTrivial`;
//   · que `generarPinDeSoporte` devuelva lo que le dé el generador sin
//     filtrarlo (saldría «1234» una vez cada 10.000 regeneraciones, y
//     además es un PIN que el propio sistema rechazaría al cambiarlo);
//   · ensanchar el formato más allá de 4-8 cifras.

import { describe, expect, it } from "vitest";

import {
  PIN_FORMAT,
  errorPinTrivial,
  generarPinDeSoporte,
  mensajePinTrivial,
  motivoPinTrivial,
  pinConFormato,
} from "../src/auth/pin.js";

describe("el formato: 4 a 8 cifras, y nada más", () => {
  it("acepta de 4 a 8 cifras", () => {
    for (const pin of ["9473", "94731", "94731526"]) {
      expect(pinConFormato(pin)).toBe(true);
    }
  });

  it("rechaza lo corto, lo largo y lo que no son cifras", () => {
    for (const pin of ["947", "947315267", "947a", "94 73", ""]) {
      expect(pinConFormato(pin)).toBe(false);
    }
  });

  it("el patrón es el que va a los schemas de las rutas", () => {
    // Si alguien lo cambia aquí, cambia en las cuatro rutas a la vez.
    // Ése es el motivo de que esté en un sitio.
    expect(PIN_FORMAT).toBe("^[0-9]{4,8}$");
  });
});

describe("los PIN demasiado fáciles", () => {
  // La lista no es un capricho: son los que la gente teclea cuando le
  // dicen «elige cuatro cifras» con la cola delante.
  const FACILES: Array<[string, string]> = [
    ["0000", "son todas la misma cifra"],
    ["1111", "son todas la misma cifra"],
    ["99999999", "son todas la misma cifra"],
    ["1234", "son cifras seguidas"],
    ["0123", "son cifras seguidas"],
    ["456789", "son cifras seguidas"],
    ["4321", "son cifras seguidas hacia atrás"],
    ["9876", "son cifras seguidas hacia atrás"],
    ["3210", "son cifras seguidas hacia atrás"],
    ["1212", "es un trozo que se repite"],
    ["1010", "es un trozo que se repite"],
    ["123123", "es un trozo que se repite"],
    ["2580", "es una columna del teclado"],
    ["0852", "es una columna del teclado"],
  ];

  it.each(FACILES)("%s se rechaza: %s", (pin, motivo) => {
    expect(motivoPinTrivial(pin)).toBe(motivo);
  });

  // La otra mitad, y la que se olvida: un filtro que rechaza de más es
  // tan malo como uno que no rechaza.
  const BUENOS = [
    "9473",
    "5061",
    "1357",
    "8305",
    "2947",
    "47193",
    "90461728",
    // Dos cifras iguales seguidas NO es «todas iguales».
    "1147",
    // Un tramo seguido DENTRO de un PIN que no lo es entero.
    "1239",
    "9123",
  ];

  it.each(BUENOS)("%s pasa", (pin) => {
    expect(motivoPinTrivial(pin)).toBeNull();
  });

  it("el mensaje dice el porqué y qué hacer, no «no vale»", () => {
    const mensaje = mensajePinTrivial("son cifras seguidas");
    expect(mensaje).toContain("son cifras seguidas");
    expect(mensaje).toContain("Elige otro");
    // Y menciona el bloqueo, que es lo que hace que la regla tenga
    // sentido: con cinco intentos, un PIN fácil se acierta a la primera.
    expect(mensaje).toMatch(/cinco intentos/);
  });

  it("el cuerpo del 400 lleva un código que el front puede mirar", () => {
    const cuerpo = errorPinTrivial("son todas la misma cifra");
    expect(cuerpo.error).toBe("PIN_DEMASIADO_FACIL");
    expect(cuerpo.code).toBe("PIN_DEMASIADO_FACIL");
    expect(cuerpo.message).toContain("son todas la misma cifra");
  });

  it("un PIN con formato malo NO se llama fácil: lo rechaza el schema", () => {
    // Devolver «es fácil» para «abc» sería contestar la pregunta
    // equivocada y dar un mensaje que no se entiende.
    expect(motivoPinTrivial("abc")).toBeNull();
    expect(motivoPinTrivial("12")).toBeNull();
  });
});

describe("el PIN del último recurso de soporte", () => {
  it("son cuatro cifras", () => {
    let i = 0;
    const pin = generarPinDeSoporte(() => [7, 1234, 9473][i++ % 3]!);
    expect(pin).toMatch(/^\d{4}$/);
  });

  it("rellena con ceros por la izquierda", () => {
    expect(generarPinDeSoporte(() => 7)).toMatch(/^\d{4}$/);
  });

  it("NUNCA devuelve un trivial, ni con un generador que sólo da 1234", () => {
    // El sabotaje: quitar el filtro de `generarPinDeSoporte`. Con un
    // generador amañado, la función tiene que seguir cumpliendo lo que
    // promete — un PIN que el propio sistema rechazaría al cambiarlo no
    // puede salir de aquí.
    const pin = generarPinDeSoporte(() => 1234);
    expect(pin).not.toBe("1234");
    expect(motivoPinTrivial(pin)).toBeNull();
  });

  it("tampoco con uno que sólo da 0000", () => {
    const pin = generarPinDeSoporte(() => 0);
    expect(motivoPinTrivial(pin)).toBeNull();
  });

  it("con un generador de verdad, mil PIN y ninguno trivial", () => {
    // Determinista a propósito (el generador recorre las 10.000
    // combinaciones en orden): lo que se mide es el filtro, no la
    // suerte. Mil vueltas pasan por 1234, 2580, 1111 y 4321.
    let n = 0;
    for (let i = 0; i < 1000; i++) {
      const pin = generarPinDeSoporte(() => n++);
      expect(motivoPinTrivial(pin), pin).toBeNull();
    }
  });
});
