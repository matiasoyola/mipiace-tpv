// A1-Android · Frente 1 · refactor de lib/escposPrint.ts al registry.
//
// El objetivo del refactor: las pantallas del TPV siguen llamando a
// `printEscposUsb`/`pairUsbPrinter`/etc., pero ahora esas funciones
// DELEGAN en el transporte USB del registry (WebUSB en navegador, nativo
// en Android) en vez de tocar WebUSB directamente. Mockeamos el registry
// y verificamos la delegación + que se entregan los MISMOS bytes.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PrinterTransport } from "../src/platform/printer/PrinterTransport.js";

const transportMock = vi.hoisted(() => ({ current: null as PrinterTransport | null }));

vi.mock("../src/platform/printer/bootstrap.js", () => ({
  usbTransport: () => transportMock.current,
  wifiTransport: () => null,
  bootstrapPrinters: () => undefined,
  ensurePrintersBootstrapped: () => undefined,
}));

import {
  getPairedUsbPrinter,
  isWebUsbSupported,
  openUsbCashDrawer,
  pairUsbPrinter,
  printEscposUsb,
} from "../src/lib/escposPrint.js";

function makeTransport(): PrinterTransport & {
  print: ReturnType<typeof vi.fn>;
  pair: ReturnType<typeof vi.fn>;
  openCashDrawer: ReturnType<typeof vi.fn>;
} {
  return {
    channel: "usb",
    isSupported: vi.fn(() => true),
    pair: vi.fn(async () => ({ channel: "usb", label: "POS-80", address: "a" })),
    connect: vi.fn(async () => undefined),
    isPaired: vi.fn(async () => true),
    print: vi.fn(async () => ({ ok: true, printedAt: "2026-08-01T00:00:00.000Z" })),
    openCashDrawer: vi.fn(async () => undefined),
    forget: vi.fn(async () => undefined),
    disconnect: vi.fn(async () => undefined),
  } as never;
}

let t: ReturnType<typeof makeTransport>;

beforeEach(() => {
  t = makeTransport();
  transportMock.current = t;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("escposPrint delega en el registry (canal USB)", () => {
  it("printEscposUsb entrega los MISMOS bytes al transporte", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    await printEscposUsb(bytes);
    expect(t.print).toHaveBeenCalledTimes(1);
    expect(t.print).toHaveBeenCalledWith(bytes);
  });

  it("pairUsbPrinter delega en transport.pair", async () => {
    await pairUsbPrinter();
    expect(t.pair).toHaveBeenCalledTimes(1);
  });

  it("getPairedUsbPrinter delega en isPaired y devuelve booleano", async () => {
    expect(await getPairedUsbPrinter()).toBe(true);
    expect(t.isPaired).toHaveBeenCalled();
  });

  it("isWebUsbSupported refleja transport.isSupported", () => {
    expect(isWebUsbSupported()).toBe(true);
    expect(t.isSupported).toHaveBeenCalled();
  });

  it("openUsbCashDrawer delega en transport.openCashDrawer", async () => {
    await openUsbCashDrawer();
    expect(t.openCashDrawer).toHaveBeenCalledTimes(1);
  });

  it("sin transporte USB → printEscposUsb lanza UNSUPPORTED", async () => {
    transportMock.current = null;
    await expect(printEscposUsb(new Uint8Array([1]))).rejects.toMatchObject({
      code: "UNSUPPORTED",
    });
  });

  it("sin transporte USB → getPairedUsbPrinter devuelve false (no lanza)", async () => {
    transportMock.current = null;
    expect(await getPairedUsbPrinter()).toBe(false);
  });
});
