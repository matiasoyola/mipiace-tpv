// primer-acceso · los requisitos de la contraseña.
//
// Son los que la página de bienvenida marca EN VIVO y los que el servidor
// exige al aceptar la invitación, y están aquí para que sean los mismos:
// este banco es lo que pone en rojo el día que alguien cambie uno de los
// dos lados y no el otro.

import { describe, expect, it } from "vitest";

import {
  CONTRASENA_MIN,
  contrasenaValida,
  requisitosDeContrasena,
} from "../src/contrasena.js";

describe("requisitosDeContrasena", () => {
  it("devuelve SIEMPRE los tres, para poderlos pintar desde el primer carácter", () => {
    expect(requisitosDeContrasena("")).toHaveLength(3);
    expect(requisitosDeContrasena("jardindegredos2026")).toHaveLength(3);
    // En blanco, ninguno cumplido: nada de un tic verde de regalo.
    expect(requisitosDeContrasena("").every((r) => !r.cumple)).toBe(true);
  });

  it("los textos son los que se enseñan, con el mínimo dentro", () => {
    const textos = requisitosDeContrasena("").map((r) => r.texto);
    expect(textos).toEqual([
      `Al menos ${CONTRASENA_MIN} caracteres`,
      "Alguna letra",
      "Algún número",
    ]);
  });
});

describe("contrasenaValida", () => {
  it("acepta doce caracteres con letra y número", () => {
    expect(contrasenaValida("jardindegredos2026")).toBe(true);
    // Exactamente el mínimo: el límite se prueba EN el límite.
    expect("abcdefghijk1").toHaveLength(CONTRASENA_MIN);
    expect(contrasenaValida("abcdefghijk1")).toBe(true);
    expect(contrasenaValida("abcdefghij1")).toBe(false);
  });

  it("rechaza lo que no lleva número", () => {
    expect(contrasenaValida("todoletrassinnumeros")).toBe(false);
  });

  it("rechaza lo que no lleva letra", () => {
    expect(contrasenaValida("1234567890123")).toBe(false);
  });

  it("una letra acentuada o con ñ CUENTA como letra", () => {
    // `/\p{L}/u` y no `/[a-z]/i`: «añoenlaresidencia» es una contraseña
    // razonable de una directora española, y rechazarla por la ñ sería
    // una norma escrita para otro idioma.
    expect(contrasenaValida("añoenlaresidencia1")).toBe(true);
    expect(contrasenaValida("JARDÍNDEGREDOS2026")).toBe(true);
  });

  it("los espacios cuentan como caracteres: una frase vale", () => {
    // Longitud antes que ornamento: «mi gato se llama 7» es más fuerte
    // que «Abc123!» y más fácil de recordar.
    expect(contrasenaValida("mi gato se llama 7")).toBe(true);
  });
});
