// H1 · el TPV con la caja apagada (ADR-016).
//
// Lo que este banco fija:
//
//   1. Un 403 CAJA_DISABLED en el arranque NO es `retry`. Antes del
//      bloque lo era, y sin `device-me` cacheado el hook se quedaba en
//      `loading` reintentando cada 3 s: spinner infinito. Eso es la
//      "pantalla en blanco" que el prompt prohíbe.
//   2. Tampoco es `purge`: el terminal sigue emparejado. El día que le
//      enciendan la caja a la empresa, recargar basta.
//   3. El flag viaja en el catálogo y se cachea, con el default al revés
//      que sus hermanos: sin dato, la caja está ENCENDIDA.
//   4. Los otros 403 y los 401 ambiguos siguen decidiendo lo de siempre.
//
// Sabotajes que este fichero pone en rojo (§3 del done):
//   · que `cajaEnabled` no llegue al TPV (nº 5)
//   · devolver `retry` ante CAJA_DISABLED (vuelve el bucle)
//   · invertir el default de la caché (el TPV se esconde solo)

import { beforeEach, describe, expect, it } from "vitest";

import { ApiError } from "../src/api.js";
import { decideAfterBootstrapError } from "../src/hooks/bootstrap-decision.js";
import {
  getCachedCajaEnabled,
  setCachedCajaEnabled,
} from "../src/lib/catalog.js";

const CAJA_KEY = "mipiacetpv-catalog-caja-enabled";

beforeEach(() => {
  localStorage.clear();
});

describe("H1 · decideAfterBootstrapError con la caja apagada", () => {
  it("403 CAJA_DISABLED → caja-disabled (ni bucle ni desemparejar)", () => {
    const err = new ApiError(
      403,
      "Esta empresa no tiene el módulo de caja activado.",
      "CAJA_DISABLED",
    );
    expect(decideAfterBootstrapError(err)).toBe("caja-disabled");
  });

  it("NO es purge: el dispositivo sigue emparejado", () => {
    const err = new ApiError(403, "x", "CAJA_DISABLED");
    expect(decideAfterBootstrapError(err)).not.toBe("purge");
  });

  it("NO es retry: el bucle de 3 s es justo lo que se arregla", () => {
    const err = new ApiError(403, "x", "CAJA_DISABLED");
    expect(decideAfterBootstrapError(err)).not.toBe("retry");
  });

  it("otro 403 sigue siendo retry (no todo 403 es la caja)", () => {
    expect(decideAfterBootstrapError(new ApiError(403, "x", "FORBIDDEN"))).toBe(
      "retry",
    );
    expect(decideAfterBootstrapError(new ApiError(403, "x"))).toBe("retry");
  });

  it("un 401 CAJA_DISABLED mal formado no cuela: la puerta manda 403", () => {
    expect(decideAfterBootstrapError(new ApiError(401, "x", "CAJA_DISABLED"))).toBe(
      "retry",
    );
  });

  it("los casos de master no se mueven", () => {
    expect(
      decideAfterBootstrapError(new ApiError(401, "x", "DEVICE_REVOKED")),
    ).toBe("purge");
    expect(decideAfterBootstrapError(new ApiError(500, "boom"))).toBe("retry");
    expect(decideAfterBootstrapError(new Error("network down"))).toBe("retry");
  });
});

describe("H1 · la caché del flag en el TPV", () => {
  it("sin dato en localStorage, la caja está ENCENDIDA", () => {
    // Al revés que crmEnabled/agendaEnabled, y a propósito: la columna es
    // @default(true) y un TPV que se esconde a sí mismo por no tener el
    // flag cacheado sería el peor fallo posible.
    expect(getCachedCajaEnabled()).toBe(true);
  });

  it("guarda y lee el apagado", () => {
    setCachedCajaEnabled(false);
    expect(localStorage.getItem(CAJA_KEY)).toBe("0");
    expect(getCachedCajaEnabled()).toBe(false);
  });

  it("guarda y lee el encendido", () => {
    setCachedCajaEnabled(false);
    setCachedCajaEnabled(true);
    expect(getCachedCajaEnabled()).toBe(true);
  });

  it("un valor basura se lee como encendida, no como apagada", () => {
    localStorage.setItem(CAJA_KEY, "quizá");
    expect(getCachedCajaEnabled()).toBe(true);
  });
});
