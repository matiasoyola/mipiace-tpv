// v1.0-pilotos · Lote 5 (#19): el borrado de impresora en el admin
// debe propagarse al estado local del TPV. syncUsbPairingWithServerConfig
// limpia el pairing WebUSB de localStorage cuando el servidor ya no
// tiene impresora USB configurada para el register.

import { beforeEach, describe, expect, it } from "vitest";

import { syncUsbPairingWithServerConfig } from "../src/lib/escposPrint.js";

const STORAGE_KEY = "mipiacetpv-tpv-printer-usb";

function seedPairing(): void {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ vendorId: 1208, productId: 514, serialNumber: "ABC1" }),
  );
}

beforeEach(() => {
  localStorage.clear();
});

describe("syncUsbPairingWithServerConfig", () => {
  it("impresora borrada en el admin (null) → pairing local eliminado", () => {
    seedPairing();
    syncUsbPairingWithServerConfig(null);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("config cambiada a WIFI → pairing USB eliminado", () => {
    seedPairing();
    syncUsbPairingWithServerConfig({ mode: "WIFI" });
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("config USB vigente → pairing intacto (re-alta no fuerza re-emparejar)", () => {
    seedPairing();
    syncUsbPairingWithServerConfig({ mode: "USB" });
    expect(localStorage.getItem(STORAGE_KEY)).not.toBeNull();
  });

  it("sin pairing previo → no-op", () => {
    syncUsbPairingWithServerConfig(null);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});
