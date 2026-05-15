import { describe, expect, it } from "vitest";

import { validateSpanishTaxId } from "../src/spanish-tax-id.js";

describe("validateSpanishTaxId", () => {
  describe("NIF (persona física)", () => {
    it("acepta NIFs válidos", () => {
      // 12345678 % 23 = 14 → Z
      expect(validateSpanishTaxId("12345678Z")).toEqual({
        valid: true,
        type: "NIF",
      });
      // 00000001 % 23 = 1 → R
      expect(validateSpanishTaxId("00000001R")).toEqual({
        valid: true,
        type: "NIF",
      });
    });

    it("rechaza letra incorrecta", () => {
      expect(validateSpanishTaxId("12345678A")).toEqual({
        valid: false,
        type: null,
      });
    });

    it("normaliza guiones y espacios", () => {
      expect(validateSpanishTaxId("12345678-Z")).toEqual({
        valid: true,
        type: "NIF",
      });
      expect(validateSpanishTaxId(" 12345678 Z ")).toEqual({
        valid: true,
        type: "NIF",
      });
    });
  });

  describe("NIE", () => {
    it("acepta NIEs válidos", () => {
      // X 0000001 → como NIF "00000001" → R
      expect(validateSpanishTaxId("X0000001R")).toEqual({
        valid: true,
        type: "NIE",
      });
      // Y 1234567 → como NIF "11234567" → 11234567 % 23 = 10 → X
      expect(validateSpanishTaxId("Y1234567X")).toEqual({
        valid: true,
        type: "NIE",
      });
    });

    it("rechaza prefijo inválido", () => {
      expect(validateSpanishTaxId("A0000001R")).toEqual({
        valid: false,
        type: null,
      });
    });

    it("rechaza letra incorrecta", () => {
      expect(validateSpanishTaxId("X0000001A")).toEqual({
        valid: false,
        type: null,
      });
    });
  });

  describe("CIF", () => {
    it("acepta CIF con control dígito (letra inicial B)", () => {
      // B 1234567 + control.
      // digits = "1234567"
      // i=0 n=1 doubled=2 → 2; i=1 n=2 → +2; i=2 n=3 doubled=6 → 6;
      // i=3 n=4 → +4; i=4 n=5 doubled=10 → 1; i=5 n=6 → +6; i=6 n=7 doubled=14 → 5
      // sum = 2+2+6+4+1+6+5 = 26 → 26 % 10 = 6 → control = 10-6 = 4
      expect(validateSpanishTaxId("B12345674")).toEqual({
        valid: true,
        type: "CIF",
      });
    });

    it("rechaza CIF con control incorrecto", () => {
      expect(validateSpanishTaxId("B12345670")).toEqual({
        valid: false,
        type: null,
      });
    });

    it("acepta CIF con control letra (letra inicial P)", () => {
      // P 1234567 + control letra correspondiente.
      // sum = 26 → control digit 4 → letra D (JABCDEFGHI[4])
      expect(validateSpanishTaxId("P1234567D")).toEqual({
        valid: true,
        type: "CIF",
      });
    });

    it("rechaza CIF con letra inicial donde el control debe ser dígito y se da letra", () => {
      // Inicial B exige dígito; con letra D rechaza aunque la letra
      // sería la correcta para una inicial flexible.
      expect(validateSpanishTaxId("B1234567D")).toEqual({
        valid: false,
        type: null,
      });
    });

    it("rechaza letra inicial inválida", () => {
      // O no es letra válida de CIF.
      expect(validateSpanishTaxId("O12345674")).toEqual({
        valid: false,
        type: null,
      });
    });
  });

  describe("formato", () => {
    it("rechaza string vacío", () => {
      expect(validateSpanishTaxId("")).toEqual({ valid: false, type: null });
    });

    it("rechaza longitud incorrecta", () => {
      expect(validateSpanishTaxId("1234567Z")).toEqual({
        valid: false,
        type: null,
      });
      expect(validateSpanishTaxId("123456789Z")).toEqual({
        valid: false,
        type: null,
      });
    });

    it("rechaza no-string", () => {
      // @ts-expect-error — testeamos defensa runtime
      expect(validateSpanishTaxId(null)).toEqual({ valid: false, type: null });
      // @ts-expect-error
      expect(validateSpanishTaxId(undefined)).toEqual({
        valid: false,
        type: null,
      });
      // @ts-expect-error
      expect(validateSpanishTaxId(12345678)).toEqual({
        valid: false,
        type: null,
      });
    });
  });
});
