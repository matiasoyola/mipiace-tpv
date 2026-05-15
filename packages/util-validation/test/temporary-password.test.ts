import { describe, expect, it } from "vitest";

import {
  generateTemporaryPassword,
  TEMPORARY_PASSWORD_ALPHABET,
} from "../src/temporary-password.js";

describe("generateTemporaryPassword", () => {
  it("devuelve 16 caracteres", () => {
    expect(generateTemporaryPassword()).toHaveLength(16);
  });

  it("no contiene caracteres ambiguos", () => {
    const forbidden = "0OoIl1\"'`/\\ ";
    for (let i = 0; i < 200; i++) {
      const pw = generateTemporaryPassword();
      for (const ch of pw) {
        expect(forbidden.includes(ch)).toBe(false);
      }
    }
  });

  it("todos los caracteres pertenecen al alfabeto declarado", () => {
    for (let i = 0; i < 100; i++) {
      const pw = generateTemporaryPassword();
      for (const ch of pw) {
        expect(TEMPORARY_PASSWORD_ALPHABET.includes(ch)).toBe(true);
      }
    }
  });

  it("alfabeto sin duplicados", () => {
    const set = new Set(TEMPORARY_PASSWORD_ALPHABET);
    expect(set.size).toBe(TEMPORARY_PASSWORD_ALPHABET.length);
  });

  it("genera passwords distintas en llamadas consecutivas", () => {
    const a = generateTemporaryPassword();
    const b = generateTemporaryPassword();
    expect(a).not.toBe(b);
  });
});
