import { describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";

import { decryptSecret, encryptSecret } from "../src/crypto.js";

const KEY = randomBytes(32).toString("base64");

describe("encryptSecret / decryptSecret", () => {
  it("round-trip de una API key típica", () => {
    const plaintext = "abcdef1234567890_abcdef1234567890_abc";
    const blob = encryptSecret(plaintext, KEY);
    expect(blob.startsWith("v1:")).toBe(true);
    expect(blob).not.toContain(plaintext);
    expect(decryptSecret(blob, KEY)).toBe(plaintext);
  });

  it("dos cifrados del mismo plaintext producen blobs distintos (IV aleatorio)", () => {
    const plaintext = "secret";
    const a = encryptSecret(plaintext, KEY);
    const b = encryptSecret(plaintext, KEY);
    expect(a).not.toBe(b);
    expect(decryptSecret(a, KEY)).toBe(plaintext);
    expect(decryptSecret(b, KEY)).toBe(plaintext);
  });

  it("decrypt con clave distinta falla", () => {
    const blob = encryptSecret("x", KEY);
    const otherKey = randomBytes(32).toString("base64");
    expect(() => decryptSecret(blob, otherKey)).toThrow();
  });

  it("decrypt detecta formato desconocido", () => {
    expect(() => decryptSecret("v2:lol", KEY)).toThrow(/formato desconocido/);
  });

  it("encrypt rechaza clave de longitud incorrecta", () => {
    const shortKey = Buffer.from("too-short").toString("base64");
    expect(() => encryptSecret("x", shortKey)).toThrow();
  });
});
