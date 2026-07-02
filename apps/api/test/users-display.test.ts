// v1.7-alias-cajeros: fallback alias→email del label de cajero. Es el
// único punto de decisión que usan print.ts, send-to-kitchen.ts,
// kitchen-dispatch.ts y el informe Z.

import { describe, expect, it } from "vitest";

import { cashierLabelFrom } from "../src/users/display.js";

describe("cashierLabelFrom", () => {
  it("con alias → alias tal cual", () => {
    expect(cashierLabelFrom({ alias: "María", email: "m.garcia.1987@gmail.com" })).toBe(
      "María",
    );
  });

  it("alias con espacios alrededor → trim", () => {
    expect(cashierLabelFrom({ alias: "  María ", email: "a@b.es" })).toBe("María");
  });

  it("sin alias (user legacy) → local-part del email", () => {
    expect(cashierLabelFrom({ alias: null, email: "m.garcia.1987@gmail.com" })).toBe(
      "m.garcia.1987",
    );
  });

  it("alias vacío o sólo espacios → fallback al email recortado", () => {
    expect(cashierLabelFrom({ alias: "", email: "ana@bar.es" })).toBe("ana");
    expect(cashierLabelFrom({ alias: "   ", email: "ana@bar.es" })).toBe("ana");
  });

  it("email sin @ (defensivo) → email entero", () => {
    expect(cashierLabelFrom({ alias: null, email: "sin-arroba" })).toBe("sin-arroba");
  });
});
