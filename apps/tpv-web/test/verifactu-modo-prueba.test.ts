// verifactu-1b · el modo prueba no factura, y tampoco pisa al que sí.
//
// El registro nace en el dispositivo. La primera puerta, por tanto, está
// aquí: en modo prueba el módulo fiscal no lee, no escribe, no pregunta al
// servidor y no genera. Dos razones, y las dos importan:
//
//   1. Una venta de prueba no puede gastar número ni entrar en la cadena.
//      `fiscal_records` es append-only y el modo prueba purga sus tickets
//      al activar el comercio: lo que quedaría es un número gastado que
//      apunta a un ticket que ya no existe, o una factura de prueba en la
//      cadena real del cliente. Ninguna de las dos se deshace.
//   2. El estado fiscal vive en `localStorage`, que el modo prueba comparte
//      con las sesiones reales del mismo navegador — sus tokens van en
//      `sessionStorage` justo para no contaminarlas. Si el modo prueba
//      escribiera ahí, le dejaría al terminal real de ese navegador la
//      configuración y la cabeza de cadena equivocadas.
//
// Sabotajes que este fichero pone en rojo:
//   · quitar la guarda de `generarRegistroDeVenta` → el modo prueba genera
//     un registro y gasta número
//   · quitar la guarda de `escribirEstado` → el `refreshFiscalHead` del modo
//     prueba pisa la cabeza de cadena del terminal real
//   · quitar la guarda de `clearFiscalState` → salir del modo prueba deja al
//     terminal real sin configuración fiscal

import { beforeEach, describe, expect, it, vi } from "vitest";

const apiWithCashier = vi.fn();
vi.mock("../src/api.js", () => ({
  apiWithCashier: (...args: unknown[]) => apiWithCashier(...args),
  ApiError: class extends Error {},
}));
vi.mock("../src/lib/sentry.js", () => ({ captureError: vi.fn() }));

import {
  clearFiscalState,
  FiscalNoConfiguradoError,
  generarRegistroDeAnulacion,
  generarRegistroDeVenta,
  getCabezaDeCadena,
  getFiscalConfig,
  refreshFiscalHead,
} from "../src/lib/fiscal.js";

const REGISTER_ID = "33333333-3333-3333-3333-333333333333";

const HEAD_QUE_EMITE = {
  emite: true,
  nif: "B45902186",
  razonSocial: "PELUQUERÍA SOLE SL",
  serie: "C1",
  numeroInstalacion: "3f7c1f6e-2b4a-4a8e-9c1d-5e6f7a8b9c0d",
  version: "1.16.0",
  entorno: "PRUEBAS" as const,
  businessType: "SERVICES",
  cabeza: null,
};

const VENTA = {
  registerId: REGISTER_ID,
  buckets: [{ rate: 21, base: 10, tax: 2.1 }],
  subtotal: 10,
  total: 12.1,
};

// El par que el super-admin mete en la query string. El `purpose` es lo que
// `readTestModeState` exige para dar el modo prueba por bueno.
function jwtDePrueba(): string {
  const payload = {
    purpose: "test-cashier",
    tid: "11111111-1111-1111-1111-111111111111",
    exp: Math.floor(Date.now() / 1000) + 3600,
  };
  const b64 = btoa(JSON.stringify(payload)).replace(/\+/g, "-").replace(/\//g, "_");
  return `cabecera.${b64}.firma`;
}

function entrarEnModoPrueba(): void {
  sessionStorage.setItem("mipiacetpv-test-cashier-token", jwtDePrueba());
  sessionStorage.setItem("mipiacetpv-test-device-token", "un-device-token");
}

/** Un terminal REAL de este mismo navegador, ya configurado y con la cadena
 *  empezada. Es lo que el modo prueba no puede tocar. */
async function terminalRealConfigurado() {
  apiWithCashier.mockResolvedValueOnce(HEAD_QUE_EMITE);
  await refreshFiscalHead(REGISTER_ID);
  const registro = await generarRegistroDeVenta(VENTA);
  apiWithCashier.mockReset();
  return registro;
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  apiWithCashier.mockReset();
});

describe("el modo prueba no factura", () => {
  it("no le pregunta al servidor por la cabeza de la cadena", async () => {
    entrarEnModoPrueba();
    const config = await refreshFiscalHead(REGISTER_ID);
    expect(config).toBeNull();
    // Ni una llamada: el servidor también contestaría `emite: false`, pero
    // el corte es local para no depender de que haya red.
    expect(apiWithCashier).not.toHaveBeenCalled();
  });

  it("no genera el registro de una venta, y dice por qué", async () => {
    entrarEnModoPrueba();
    await expect(generarRegistroDeVenta(VENTA)).rejects.toBeInstanceOf(
      FiscalNoConfiguradoError,
    );
    await expect(generarRegistroDeVenta(VENTA)).rejects.toThrow(/modo prueba/);
  });

  it("tampoco genera un registro de anulación", async () => {
    entrarEnModoPrueba();
    await expect(
      generarRegistroDeAnulacion({
        registerId: REGISTER_ID,
        numSerieFactura: "C1/000001",
        fechaExpedicion: "2026-09-24",
        sinRegistroPrevio: true,
      }),
    ).rejects.toThrow(/modo prueba/);
  });

  it("y aunque haya un terminal real configurado en este navegador", async () => {
    await terminalRealConfigurado();
    entrarEnModoPrueba();
    expect(getFiscalConfig(REGISTER_ID)).toBeNull();
    expect(getCabezaDeCadena(REGISTER_ID)).toBeNull();
    await expect(generarRegistroDeVenta(VENTA)).rejects.toThrow(/modo prueba/);
  });
});

describe("y no contamina al terminal real del mismo navegador", () => {
  it("el refresh del modo prueba no pisa la cabeza de la cadena", async () => {
    const primera = await terminalRealConfigurado();
    expect(primera.numSerieFactura).toBe("C1/000001");

    // El modo prueba arranca y refresca. Si escribiera, dejaría el estado
    // en `emite: false` y sin cabeza.
    entrarEnModoPrueba();
    apiWithCashier.mockResolvedValueOnce({ emite: false });
    await refreshFiscalHead(REGISTER_ID);
    sessionStorage.clear();
    apiWithCashier.mockReset();

    // El terminal real vuelve: sigue emitiendo y la cadena sigue donde
    // estaba — la siguiente factura es la 2, no la 1 otra vez.
    expect(getFiscalConfig(REGISTER_ID)?.emite).toBe(true);
    expect(getCabezaDeCadena(REGISTER_ID)?.chainIndex).toBe(1);
    const segunda = await generarRegistroDeVenta(VENTA);
    expect(segunda.numSerieFactura).toBe("C1/000002");
  });

  it("salir del modo prueba no le borra la configuración", async () => {
    await terminalRealConfigurado();
    entrarEnModoPrueba();
    clearFiscalState();
    sessionStorage.clear();
    expect(getFiscalConfig(REGISTER_ID)?.serie).toBe("C1");
    expect(getCabezaDeCadena(REGISTER_ID)?.chainIndex).toBe(1);
  });

  it("fuera del modo prueba, `clearFiscalState` sí borra", async () => {
    await terminalRealConfigurado();
    clearFiscalState();
    expect(getFiscalConfig(REGISTER_ID)).toBeNull();
  });
});
