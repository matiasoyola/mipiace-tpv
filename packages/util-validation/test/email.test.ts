// Sole · la regla de email, la misma en las tres capas.
//
// El caso 0 de este fichero es el incidente: "abc" no es un email. Todo
// lo demás está aquí para que arreglarlo no rompa a nadie que hoy sí
// recibe su ticket.

import { describe, expect, it } from "vitest";

import {
  EMAIL_MAX_LENGTH,
  isValidEmail,
  normalizeEmail,
  validEmailOrNull,
} from "../src/email.js";

describe("isValidEmail", () => {
  it("el 000257 · 'abc' no es un email", () => {
    expect(isValidEmail("abc")).toBe(false);
  });

  it("acepta las direcciones que usa la gente de verdad", () => {
    const buenos = [
      "ana@ejemplo.com",
      "ana.garcia@ejemplo.com",
      "ana+peluqueria@gmail.com",
      "ANA@EJEMPLO.COM",
      "a@b.co",
      "maria-jose@mi-dominio.es",
      "sole_tpv@sub.dominio.co.uk",
      "n1234@hotmail.com",
    ];
    for (const email of buenos) {
      expect(isValidEmail(email), email).toBe(true);
    }
  });

  it("rechaza lo que no se puede entregar", () => {
    const malos = [
      "",
      "   ",
      "abc",
      "ana",
      "ana@",
      "@ejemplo.com",
      "ana@ejemplo", // dominio sin punto
      "ana@localhost", // válido para el RFC, basura para una clienta
      "ana@ejemplo.c", // TLD de una letra
      "ana ejemplo.com", // falta la arroba
      "ana@ejemplo .com", // espacio en el dominio
      "ana garcia@ejemplo.com", // espacio en el local part
      "ana@@ejemplo.com",
      "ana..garcia@ejemplo.com", // puntos consecutivos
      ".ana@ejemplo.com",
      "ana.@ejemplo.com",
      "ana@-ejemplo.com",
      "ana@ejemplo-.com",
      "ana@ejemplo..com",
    ];
    for (const email of malos) {
      expect(isValidEmail(email), email).toBe(false);
    }
  });

  it("no se traga null ni undefined ni cosas que no son texto", () => {
    expect(isValidEmail(null)).toBe(false);
    expect(isValidEmail(undefined)).toBe(false);
    expect(isValidEmail(123 as unknown as string)).toBe(false);
  });

  it("recorta antes de validar · el dedo gordo en una pantalla de 10 pulgadas", () => {
    expect(isValidEmail("  ana@ejemplo.com  ")).toBe(true);
    expect(isValidEmail("\tana@ejemplo.com\n")).toBe(true);
  });

  it("tiene tope · el mismo maxLength que los schemas de la API", () => {
    const localPart = "a".repeat(EMAIL_MAX_LENGTH);
    expect(isValidEmail(`${localPart}@ejemplo.com`)).toBe(false);
  });
});

describe("normalizeEmail", () => {
  it("recorta y deja el resto intacto", () => {
    expect(normalizeEmail("  ana@ejemplo.com ")).toBe("ana@ejemplo.com");
    expect(normalizeEmail("ANA@Ejemplo.com")).toBe("ANA@Ejemplo.com");
  });

  it("lo que no es texto es cadena vacía, no una excepción", () => {
    expect(normalizeEmail(null)).toBe("");
    expect(normalizeEmail(undefined)).toBe("");
  });
});

describe("validEmailOrNull", () => {
  it("devuelve lo que se va a guardar, ya recortado", () => {
    expect(validEmailOrNull("  ana@ejemplo.com ")).toBe("ana@ejemplo.com");
  });

  it("y null cuando no hay nada que guardar", () => {
    expect(validEmailOrNull("abc")).toBeNull();
    expect(validEmailOrNull("")).toBeNull();
    expect(validEmailOrNull(null)).toBeNull();
  });
});
