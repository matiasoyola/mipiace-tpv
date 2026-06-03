// v1.4-Bugs-Operativos Lote 3 · cubre la lógica que decide si un error
// del backend desempareja el dispositivo o sólo reintenta.
//
// Regresión: antes del Lote 3, CUALQUIER 401 (incluyendo los que
// vienen de un proxy o reinicio puntual del backend) limpiaba el
// localStorage del TPV. Resultado: cada vez que Sole reabría el
// navegador y el primer GET /devices/me daba un 401 ambiguo, el
// dispositivo aparecía como "vinculado" en el admin pero el TPV pedía
// reemparejar.

import { describe, expect, it } from "vitest";

import { ApiError } from "../src/api.js";
import { decideAfterBootstrapError } from "../src/hooks/bootstrap-decision.js";

describe("decideAfterBootstrapError", () => {
  it("401 DEVICE_REVOKED → purge (limpia localStorage)", () => {
    const err = new ApiError(401, "Dispositivo revocado", "DEVICE_REVOKED");
    expect(decideAfterBootstrapError(err)).toBe("purge");
  });

  it("401 DEVICE_TOKEN_EXPIRED → purge", () => {
    const err = new ApiError(401, "Token caducado", "DEVICE_TOKEN_EXPIRED");
    expect(decideAfterBootstrapError(err)).toBe("purge");
  });

  it("401 sin código → retry (no desempareja en errores transitorios)", () => {
    const err = new ApiError(401, "Unauthorized");
    expect(decideAfterBootstrapError(err)).toBe("retry");
  });

  it("401 con código desconocido → retry", () => {
    const err = new ApiError(401, "Other", "SOME_OTHER_CODE");
    expect(decideAfterBootstrapError(err)).toBe("retry");
  });

  it("500 del backend → retry", () => {
    const err = new ApiError(500, "boom");
    expect(decideAfterBootstrapError(err)).toBe("retry");
  });

  it("Error de red genérico → retry", () => {
    const err = new Error("network down");
    expect(decideAfterBootstrapError(err)).toBe("retry");
  });

  it("Cierre y reapertura del TPV: si /devices/me da 401 sin código tras un restart, el token NO se borra (decisión es retry)", () => {
    // Simulamos la secuencia: el navegador se reabre, el backend ha
    // sido redeployed y devuelve un 401 sin body durante la ventana de
    // arranque. La PWA NO debe limpiar el deviceToken — debe retry.
    const transientError = new ApiError(401, "");
    expect(decideAfterBootstrapError(transientError)).toBe("retry");
  });
});
