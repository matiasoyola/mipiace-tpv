// A1-Android · Frente 2 · transporte USB nativo (lado JS).
//
// No se puede testear hardware USB en CI, así que mockeamos el plugin
// Capacitor (global `Capacitor.registerPlugin`) y verificamos que:
//   - print() serializa los bytes a base64 y se los pasa al plugin,
//   - los códigos de error nativos se mapean a PrinterError,
//   - pair() construye el descriptor a partir del device nativo,
//   - isSupported/isPaired reflejan el plugin.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PrinterError } from "../src/platform/printer/PrinterTransport.js";
import { UsbNativeTransport } from "../src/platform/printer/UsbNativeTransport.js";

interface FakePlugin {
  isAvailable: ReturnType<typeof vi.fn>;
  pair: ReturnType<typeof vi.fn>;
  isPaired: ReturnType<typeof vi.fn>;
  print: ReturnType<typeof vi.fn>;
  openCashDrawer: ReturnType<typeof vi.fn>;
  forget: ReturnType<typeof vi.fn>;
}

let plugin: FakePlugin;

function makePlugin(): FakePlugin {
  return {
    isAvailable: vi.fn(async () => ({ available: true })),
    pair: vi.fn(async () => ({
      vendorId: 0x0416,
      productId: 0x5011,
      serialNumber: "SN9",
      productName: "POS-80",
    })),
    isPaired: vi.fn(async () => ({ paired: true })),
    print: vi.fn(async () => ({ ok: true })),
    openCashDrawer: vi.fn(async () => undefined),
    forget: vi.fn(async () => undefined),
  };
}

function setCapacitor(withPlugin: boolean): void {
  (globalThis as unknown as { Capacitor?: unknown }).Capacitor = withPlugin
    ? {
        isNativePlatform: () => true,
        getPlatform: () => "android",
        registerPlugin: () => plugin,
      }
    : undefined;
}

beforeEach(() => {
  plugin = makePlugin();
  setCapacitor(true);
});

afterEach(() => {
  setCapacitor(false);
  vi.restoreAllMocks();
});

describe("UsbNativeTransport", () => {
  it("isSupported true sólo con plugin presente", () => {
    expect(new UsbNativeTransport().isSupported()).toBe(true);
    setCapacitor(false);
    expect(new UsbNativeTransport().isSupported()).toBe(false);
  });

  it("print() pasa los bytes al plugin en base64 (round-trip exacto)", async () => {
    const t = new UsbNativeTransport();
    const bytes = new Uint8Array([0x1b, 0x40, 0x41, 0x42, 0x0a, 0xff]);
    const res = await t.print(bytes);
    expect(res.ok).toBe(true);
    expect(plugin.print).toHaveBeenCalledTimes(1);
    const arg = plugin.print.mock.calls[0]![0] as { data: string };
    // El plugin nativo recibe base64; decodificado debe ser byte-idéntico.
    const decoded = Uint8Array.from(atob(arg.data), (c) => c.charCodeAt(0));
    expect(Array.from(decoded)).toEqual(Array.from(bytes));
  });

  it("pair() construye descriptor usb desde el device nativo", async () => {
    const desc = await new UsbNativeTransport().pair();
    expect(desc).toEqual({
      channel: "usb",
      label: "POS-80",
      address: "1046:20497:SN9",
    });
  });

  it("isPaired() refleja el plugin", async () => {
    expect(await new UsbNativeTransport().isPaired()).toBe(true);
    plugin.isPaired.mockResolvedValueOnce({ paired: false });
    expect(await new UsbNativeTransport().isPaired()).toBe(false);
  });

  it("mapea PERMISSION_DENIED del plugin a PrinterError con code", async () => {
    const err = Object.assign(new Error("Permiso USB denegado."), {
      code: "PERMISSION_DENIED",
    });
    plugin.print.mockRejectedValueOnce(err);
    const t = new UsbNativeTransport();
    await expect(t.print(new Uint8Array([1]))).rejects.toMatchObject({
      code: "PERMISSION_DENIED",
      message: "Permiso USB denegado.",
    });
  });

  it("mapea NOT_PAIRED en pair()", async () => {
    plugin.pair.mockRejectedValueOnce(
      Object.assign(new Error("no printer"), { code: "NOT_PAIRED" }),
    );
    await expect(new UsbNativeTransport().pair()).rejects.toMatchObject({
      code: "NOT_PAIRED",
    });
  });

  it("código desconocido del plugin → PrinterError UNKNOWN", async () => {
    plugin.print.mockRejectedValueOnce(
      Object.assign(new Error("weird"), { code: "WAT" }),
    );
    await expect(
      new UsbNativeTransport().print(new Uint8Array([1])),
    ).rejects.toMatchObject({ code: "UNKNOWN" });
  });

  it("sin plugin (navegador) → print lanza UNSUPPORTED", async () => {
    setCapacitor(false);
    await expect(
      new UsbNativeTransport().print(new Uint8Array([1])),
    ).rejects.toBeInstanceOf(PrinterError);
    await expect(
      new UsbNativeTransport().print(new Uint8Array([1])),
    ).rejects.toMatchObject({ code: "UNSUPPORTED" });
  });

  it("openCashDrawer() delega en el plugin", async () => {
    await new UsbNativeTransport().openCashDrawer();
    expect(plugin.openCashDrawer).toHaveBeenCalledTimes(1);
  });
});
