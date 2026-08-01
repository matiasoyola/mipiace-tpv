// A1-Android · Frente 1 · registro de transportes de impresión.
//
// Cubre: registro por canal, get, sobreescritura, available() y el
// transporte WiFi (server-mediated: print(bytes) no aplica → UNSUPPORTED).

import { describe, expect, it } from "vitest";

import { DefaultPrinterRegistry } from "../src/platform/printer/registry.js";
import {
  PrinterError,
  type PrinterDescriptor,
  type PrinterTransport,
  type PrintResult,
} from "../src/platform/printer/PrinterTransport.js";
import { WifiBackendTransport } from "../src/platform/printer/WifiBackendTransport.js";

function fakeTransport(channel: PrinterTransport["channel"]): PrinterTransport {
  const descriptor: PrinterDescriptor = { channel, label: channel, address: "x" };
  return {
    channel,
    isSupported: () => true,
    pair: async () => descriptor,
    connect: async () => undefined,
    isPaired: async () => true,
    print: async (): Promise<PrintResult> => ({
      ok: true,
      printedAt: "2026-08-01T00:00:00.000Z",
    }),
    openCashDrawer: async () => undefined,
    forget: async () => undefined,
    disconnect: async () => undefined,
  };
}

describe("DefaultPrinterRegistry", () => {
  it("registra y recupera por canal", () => {
    const reg = new DefaultPrinterRegistry();
    const usb = fakeTransport("usb");
    reg.register(usb);
    expect(reg.get("usb")).toBe(usb);
  });

  it("get de un canal no registrado → null (fallback lo decide el caller)", () => {
    const reg = new DefaultPrinterRegistry();
    reg.register(fakeTransport("wifi"));
    expect(reg.get("usb")).toBeNull();
    expect(reg.get("bluetooth")).toBeNull();
  });

  it("available() lista los canales registrados", () => {
    const reg = new DefaultPrinterRegistry();
    reg.register(fakeTransport("usb"));
    reg.register(fakeTransport("wifi"));
    expect(reg.available().sort()).toEqual(["usb", "wifi"]);
  });

  it("registrar el mismo canal sobreescribe (no duplica)", () => {
    const reg = new DefaultPrinterRegistry();
    const a = fakeTransport("usb");
    const b = fakeTransport("usb");
    reg.register(a);
    reg.register(b);
    expect(reg.get("usb")).toBe(b);
    expect(reg.available()).toEqual(["usb"]);
  });

  it("clear() vacía el registro", () => {
    const reg = new DefaultPrinterRegistry();
    reg.register(fakeTransport("usb"));
    reg.clear();
    expect(reg.available()).toEqual([]);
  });
});

describe("WifiBackendTransport", () => {
  it("está siempre soportado y no requiere emparejar", async () => {
    const wifi = new WifiBackendTransport();
    expect(wifi.isSupported()).toBe(true);
    expect(await wifi.isPaired()).toBe(true);
    expect((await wifi.pair()).channel).toBe("wifi");
  });

  it("print(bytes) no aplica al canal WiFi → PrinterError UNSUPPORTED", async () => {
    const wifi = new WifiBackendTransport();
    await expect(wifi.print(new Uint8Array([1, 2, 3]))).rejects.toMatchObject({
      code: "UNSUPPORTED",
    });
    await expect(wifi.print(new Uint8Array())).rejects.toBeInstanceOf(
      PrinterError,
    );
  });
});
