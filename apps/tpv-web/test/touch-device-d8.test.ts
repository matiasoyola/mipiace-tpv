// v1.22-el-terminal-del-bar · §1 · hallazgo N1.
//
// SABOTAJE que tiene que caer: volver la detección de táctil a sólo
// `(pointer: coarse)`. El entorno del Kozen D8 —`pointer: fine`,
// `any-pointer: none`, `hover: none`, `maxTouchPoints 5`— tiene que dar
// TÁCTIL, y con la consulta sola da `false`.
//
// Los números no son inventados: salen de interrogar el WebView 101 del
// AP13 por CDP el 2026-10-06 (`docs/qa/2026-10-06-ap13-usabilidad.md`).

import { describe, expect, it } from "vitest";

import { isTouchDevice, type PointerEnvironment } from "../src/lib/touchDevice.js";

/** Un entorno de medios de mentira, con las consultas que se le hacen. */
function env(
  medias: Record<string, boolean>,
  maxTouchPoints = 0,
): PointerEnvironment {
  return {
    matchMedia: (q: string) => ({ matches: medias[q] === true }),
    navigator: { maxTouchPoints },
  };
}

// El terminal que va a La Maestranza. Pantalla goodix táctil
// (`INPUT_PROP_DIRECT`) y un WebView que dice que el puntero es fino.
const KOZEN_D8 = env(
  {
    "(pointer: coarse)": false,
    "(pointer: fine)": true,
    "(any-pointer: coarse)": false,
    "(hover: none)": true,
  },
  5,
);

describe("v1.22 §1 · ¿es táctil?", () => {
  it("el Kozen D8 es táctil aunque diga que su puntero es fino", () => {
    expect(isTouchDevice(KOZEN_D8)).toBe(true);
  });

  it("el AP11 y cualquier táctil honrado siguen siendo táctiles", () => {
    expect(
      isTouchDevice(
        env(
          {
            "(pointer: coarse)": true,
            "(any-pointer: coarse)": true,
            "(hover: none)": true,
          },
          5,
        ),
      ),
    ).toBe(true);
  });

  it("un terminal con dedo Y ratón conectado cuenta como táctil", () => {
    // El puntero PRIMARIO es el ratón, pero hay dedo disponible: el
    // refoco permanente abriría el teclado cada vez que se toca.
    expect(
      isTouchDevice(
        env(
          {
            "(pointer: coarse)": false,
            "(pointer: fine)": true,
            "(any-pointer: coarse)": true,
            "(hover: none)": false,
          },
          10,
        ),
      ),
    ).toBe(true);
  });

  it("un escritorio con ratón NO es táctil: el refoco del lector sigue vivo", () => {
    expect(
      isTouchDevice(
        env(
          {
            "(pointer: coarse)": false,
            "(pointer: fine)": true,
            "(any-pointer: coarse)": false,
            "(hover: none)": false,
          },
          0,
        ),
      ),
    ).toBe(false);
  });

  it("un portátil con pantalla táctil usado con trackpad NO es táctil", () => {
    // `maxTouchPoints > 0` por sí solo daría positivo aquí y le quitaría
    // el refoco del lector USB-HID a quien sí lo quiere. Por eso hace
    // falta `(hover: none)` a la vez.
    expect(
      isTouchDevice(
        env(
          {
            "(pointer: coarse)": false,
            "(pointer: fine)": true,
            "(any-pointer: coarse)": false,
            "(hover: none)": false,
          },
          10,
        ),
      ),
    ).toBe(false);
  });

  it("sin señales (SSR, jsdom pelado) se comporta como un escritorio", () => {
    expect(isTouchDevice({})).toBe(false);
    expect(isTouchDevice({ navigator: { maxTouchPoints: 5 } })).toBe(false);
  });

  it("un matchMedia que revienta no tumba la pantalla de venta", () => {
    expect(
      isTouchDevice({
        matchMedia: () => {
          throw new Error("consulta no soportada");
        },
        navigator: { maxTouchPoints: 5 },
      }),
    ).toBe(false);
  });
});
