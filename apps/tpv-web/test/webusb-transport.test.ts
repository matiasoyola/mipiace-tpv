// A1-Android · Frente 1 · transporte WebUSB (rama web).
//
// Verifica que, en navegador, la impresión USB SIGUE pasando por WebUSB y
// entrega EXACTAMENTE los bytes al endpoint bulk OUT (regresión cero) y
// que los fallos se mapean a `PrinterError`.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PrinterError } from "../src/platform/printer/PrinterTransport.js";
import { WebUsbTransport } from "../src/platform/printer/WebUsbTransport.js";

// --- Fakes de WebUSB -------------------------------------------------

class FakeUsbDevice {
  opened = false;
  configuration: unknown = {
    interfaces: [
      {
        interfaceNumber: 0,
        alternates: [
          {
            endpoints: [
              { direction: "out", type: "bulk", endpointNumber: 1 },
            ],
          },
        ],
      },
    ],
  };
  sent: Uint8Array[] = [];
  claimed = false;
  transferStatus: "ok" | "stall" = "ok";
  transferThrows: Error | null = null;

  constructor(
    public vendorId = 0x0416,
    public productId = 0x5011,
    public serialNumber: string | null = "SN123",
    public productName: string | null = "POS-80",
  ) {}

  async open() {
    this.opened = true;
  }
  async close() {
    this.opened = false;
  }
  async selectConfiguration() {}
  async claimInterface() {
    this.claimed = true;
  }
  async releaseInterface() {
    this.claimed = false;
  }
  async transferOut(_ep: number, data: ArrayBuffer) {
    if (this.transferThrows) throw this.transferThrows;
    this.sent.push(new Uint8Array(data.slice(0)));
    return { status: this.transferStatus };
  }
}

class FakeUsb {
  devices: FakeUsbDevice[] = [];
  requestThrows: Error | null = null;
  nextDevice: FakeUsbDevice | null = null;

  async getDevices() {
    return this.devices;
  }
  async requestDevice() {
    if (this.requestThrows) throw this.requestThrows;
    const d = this.nextDevice!;
    this.devices.push(d);
    return d;
  }
}

let usb: FakeUsb;

function setUsb(u: FakeUsb | undefined): void {
  Object.defineProperty(navigator, "usb", {
    value: u,
    configurable: true,
    writable: true,
  });
}

beforeEach(() => {
  usb = new FakeUsb();
  setUsb(usb);
  localStorage.clear();
});

afterEach(() => {
  setUsb(undefined);
  vi.restoreAllMocks();
});

describe("WebUsbTransport", () => {
  it("isSupported refleja navigator.usb", () => {
    expect(new WebUsbTransport().isSupported()).toBe(true);
    setUsb(undefined);
    expect(new WebUsbTransport().isSupported()).toBe(false);
  });

  it("pair() abre diálogo, persiste el device y devuelve descriptor usb", async () => {
    const dev = new FakeUsbDevice();
    usb.nextDevice = dev;
    const t = new WebUsbTransport();
    const desc = await t.pair();
    expect(desc.channel).toBe("usb");
    expect(desc.label).toBe("POS-80");
    expect(desc.address).toBe("1046:20497:SN123");
    // Persistido bajo la clave legacy → una impresora ya emparejada
    // sobrevive al refactor.
    expect(localStorage.getItem("mipiacetpv-tpv-printer-usb")).toContain(
      '"vendorId":1046',
    );
  });

  it("pair() cancelado por el usuario → PrinterError NOT_PAIRED", async () => {
    usb.requestThrows = new Error("The user did not select any device.");
    const t = new WebUsbTransport();
    await expect(t.pair()).rejects.toMatchObject({ code: "NOT_PAIRED" });
  });

  it("isPaired() true sólo si el device autorizado sigue presente", async () => {
    const t = new WebUsbTransport();
    expect(await t.isPaired()).toBe(false); // nada guardado
    const dev = new FakeUsbDevice();
    usb.nextDevice = dev;
    await t.pair();
    expect(await t.isPaired()).toBe(true);
    usb.devices = []; // desconectada físicamente
    expect(await t.isPaired()).toBe(false);
  });

  it("print() entrega EXACTAMENTE los bytes al bulk OUT", async () => {
    const dev = new FakeUsbDevice();
    usb.nextDevice = dev;
    const t = new WebUsbTransport();
    await t.pair();
    const bytes = new Uint8Array([0x1b, 0x40, 0x41, 0x42, 0x0a]);
    const res = await t.print(bytes);
    expect(res.ok).toBe(true);
    expect(dev.sent).toHaveLength(1);
    expect(Array.from(dev.sent[0]!)).toEqual(Array.from(bytes));
    expect(dev.opened).toBe(true);
    expect(dev.claimed).toBe(false); // liberado en finally
  });

  it("print() sin impresora emparejada → PrinterError NOT_PAIRED", async () => {
    const t = new WebUsbTransport();
    await expect(t.print(new Uint8Array([1]))).rejects.toMatchObject({
      code: "NOT_PAIRED",
    });
  });

  it("print() con transferOut fallido → PrinterError UNREACHABLE", async () => {
    const dev = new FakeUsbDevice();
    dev.transferThrows = new Error("device disconnected");
    usb.nextDevice = dev;
    const t = new WebUsbTransport();
    await t.pair();
    await expect(t.print(new Uint8Array([1]))).rejects.toBeInstanceOf(
      PrinterError,
    );
    await expect(t.print(new Uint8Array([1]))).rejects.toMatchObject({
      code: "UNREACHABLE",
    });
  });

  it("openCashDrawer() envía el pulso kick ESC/POS estándar", async () => {
    const dev = new FakeUsbDevice();
    usb.nextDevice = dev;
    const t = new WebUsbTransport();
    await t.pair();
    await t.openCashDrawer();
    expect(Array.from(dev.sent[0]!)).toEqual([0x1b, 0x70, 0x00, 0x19, 0xfa]);
  });

  it("forget() borra el emparejamiento persistido", async () => {
    const dev = new FakeUsbDevice();
    usb.nextDevice = dev;
    const t = new WebUsbTransport();
    await t.pair();
    await t.forget();
    expect(localStorage.getItem("mipiacetpv-tpv-printer-usb")).toBeNull();
  });
});
