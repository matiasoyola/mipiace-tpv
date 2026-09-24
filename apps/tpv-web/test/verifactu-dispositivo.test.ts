// V1-verifactu · el registro nace en el dispositivo.
//
// Lo que este banco fija:
//
//   1. Un cobro SIN RED genera su registro, su serie, su número y su QR.
//      Ni una llamada a la API.
//   2. La cadena avanza sola y encadena: la huella de cada registro entra
//      en la entrada del siguiente.
//   3. El número no se reutiliza NUNCA. Una anulación ocupa posición en la
//      cadena y no gasta número.
//   4. La cuota del registro es la MISMA que imprime el papel (mismo
//      `cuadrarDesglose`).
//   5. Al resincronizar con el servidor gana quien va por delante.
//
// Sabotajes que este fichero pone en rojo:
//   · reutilizar un número de factura tras un rechazo
//   · dejar que la cabeza del servidor pise una cola local sin subir
//   · calcular la cuota del registro por separado de la del papel

import { cuadrarDesglose } from "@mipiacetpv/ticket-model";
import { huellaSha256 } from "@mipiacetpv/verifactu";
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

const CABEZA_VACIA = {
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

async function configurar(over: Record<string, unknown> = {}) {
  apiWithCashier.mockResolvedValueOnce({ ...CABEZA_VACIA, ...over });
  await refreshFiscalHead(REGISTER_ID);
  apiWithCashier.mockReset();
}

const VENTA = {
  registerId: REGISTER_ID,
  buckets: [{ rate: 21, base: 10, tax: 2.1 }],
  subtotal: 10,
  total: 12.1,
};

beforeEach(() => {
  localStorage.clear();
  apiWithCashier.mockReset();
});

describe("cobrar sin red", () => {
  it("genera el registro completo sin llamar a la API", async () => {
    await configurar();
    const r = await generarRegistroDeVenta(VENTA);
    expect(apiWithCashier).not.toHaveBeenCalled();
    expect(r.numSerieFactura).toBe("C1/000001");
    expect(r.body.kind).toBe("ALTA");
    expect(r.body.chainIndex).toBe(1);
    expect(r.body.numero).toBe(1);
    expect(r.avisos).toEqual([]);
  });

  it("el registro lleva su huella, y es la de su propia cadena de entrada", async () => {
    await configurar();
    const r = await generarRegistroDeVenta(VENTA);
    const huella = (r.body.payload as { Huella: string }).Huella;
    expect(huella).toMatch(/^[0-9A-F]{64}$/);
    expect(await huellaSha256(r.body.huellaInput)).toBe(huella);
  });

  it("el QR apunta al entorno de PRUEBAS con los cuatro parámetros", async () => {
    await configurar();
    const r = await generarRegistroDeVenta(VENTA);
    expect(r.qrUrl).toContain("https://prewww2.aeat.es/wlpl/TIKE-CONT/ValidarQR?");
    expect(r.qrUrl).toContain("nif=B45902186");
    expect(r.qrUrl).toContain("numserie=C1%2F000001");
    expect(r.qrUrl).toContain("importe=12.10");
  });

  it("el importe del QR es el del registro, con dos decimales", async () => {
    await configurar();
    const r = await generarRegistroDeVenta({ ...VENTA, total: 12.1 });
    expect((r.body.payload as { ImporteTotal: string }).ImporteTotal).toBe("12.10");
    expect(r.qrUrl).toContain("importe=12.10");
  });
});

describe("la cadena avanza y encadena", () => {
  it("el segundo registro lleva la huella del primero", async () => {
    await configurar();
    const uno = await generarRegistroDeVenta(VENTA);
    const dos = await generarRegistroDeVenta(VENTA);
    const huellaUno = (uno.body.payload as { Huella: string }).Huella;
    expect(dos.body.chainIndex).toBe(2);
    expect(dos.body.numero).toBe(2);
    expect(dos.body.huellaInput).toContain(`Huella=${huellaUno}&`);
    expect(
      (dos.body.payload as { Encadenamiento: { RegistroAnterior: { Huella: string } } })
        .Encadenamiento.RegistroAnterior.Huella,
    ).toBe(huellaUno);
  });

  it("el primero declara PrimerRegistro y el segundo ya no", async () => {
    await configurar();
    const uno = await generarRegistroDeVenta(VENTA);
    const dos = await generarRegistroDeVenta(VENTA);
    expect((uno.body.payload as any).Encadenamiento).toEqual({ PrimerRegistro: "S" });
    expect((dos.body.payload as any).Encadenamiento.PrimerRegistro).toBeUndefined();
  });

  it("la cabeza guardada es la del último registro", async () => {
    await configurar();
    await generarRegistroDeVenta(VENTA);
    const dos = await generarRegistroDeVenta(VENTA);
    const cabeza = getCabezaDeCadena(REGISTER_ID);
    expect(cabeza?.chainIndex).toBe(2);
    expect(cabeza?.ultimoNumero).toBe(2);
    expect(cabeza?.huella).toBe((dos.body.payload as { Huella: string }).Huella);
  });
});

describe("el número no se reutiliza", () => {
  it("SABOTAJE · tras anular un número gastado, la siguiente venta NO lo repite", async () => {
    await configurar();
    const gastado = await generarRegistroDeVenta(VENTA);
    expect(gastado.numSerieFactura).toBe("C1/000001");

    // El servidor rechazó la venta: el número se anula.
    const anulacion = await generarRegistroDeAnulacion({
      registerId: REGISTER_ID,
      numSerieFactura: gastado.numSerieFactura,
      fechaExpedicion: gastado.fechaExpedicionIso,
      sinRegistroPrevio: true,
    });
    expect(anulacion.body.kind).toBe("ANULACION");
    expect((anulacion.body.payload as any).SinRegistroPrevio).toBe("S");
    // Ocupa posición en la cadena…
    expect(anulacion.body.chainIndex).toBe(2);

    // …y la siguiente venta sigue la serie, sin volver al 1.
    const siguiente = await generarRegistroDeVenta(VENTA);
    expect(siguiente.numSerieFactura).toBe("C1/000002");
    expect(siguiente.body.chainIndex).toBe(3);
  });

  it("la anulación encadena con lo anterior", async () => {
    await configurar();
    const alta = await generarRegistroDeVenta(VENTA);
    const anulacion = await generarRegistroDeAnulacion({
      registerId: REGISTER_ID,
      numSerieFactura: alta.numSerieFactura,
      fechaExpedicion: alta.fechaExpedicionIso,
      sinRegistroPrevio: true,
    });
    const huellaAlta = (alta.body.payload as { Huella: string }).Huella;
    expect(anulacion.body.huellaInput).toContain(`Huella=${huellaAlta}&`);
  });
});

describe("la cuota del registro es la del papel", () => {
  it("SABOTAJE · el desglose sale del MISMO cuadre que imprime el ticket", async () => {
    await configurar();
    // Dos tramos que obligan a repartir el céntimo residual.
    const buckets = [
      { rate: 21, base: 3.33, tax: 0.699_3 },
      { rate: 10, base: 3.34, tax: 0.334 },
    ];
    const venta = { registerId: REGISTER_ID, buckets, subtotal: 6.67, total: 7.7 };
    const r = await generarRegistroDeVenta(venta);
    const cuadrado = cuadrarDesglose({ subtotal: 6.67, buckets, total: 7.7 });

    const payload = r.body.payload as {
      CuotaTotal: string;
      ImporteTotal: string;
      Desglose: { DetalleDesglose: { CuotaRepercutida: string }[] };
    };
    expect(payload.CuotaTotal).toBe(cuadrado.cuotaTotal.toFixed(2));
    expect(
      payload.Desglose.DetalleDesglose.map((d) => d.CuotaRepercutida),
    ).toEqual(cuadrado.buckets.map((b) => b.tax.toFixed(2)));
    // Y la suma cuadra con el total impreso, al céntimo.
    const suma =
      cuadrado.subtotal + cuadrado.buckets.reduce((a, b) => a + b.tax, 0);
    expect(Math.round(suma * 100)).toBe(770);
    expect(payload.ImporteTotal).toBe("7.70");
  });
});

describe("resincronizar con el servidor", () => {
  it("el servidor por delante gana: cambiar de tablet continúa la cadena", async () => {
    await configurar();
    apiWithCashier.mockResolvedValueOnce({
      ...CABEZA_VACIA,
      cabeza: {
        chainIndex: 7,
        idEmisorFactura: "B45902186",
        numSerieFactura: "C1/000007",
        fechaExpedicion: "2026-09-24",
        huella: "A".repeat(64),
        fechaHoraHusoGenRegistro: "2026-09-24T10:00:00+02:00",
        huellaInput: "x",
        ultimoNumero: 7,
        serie: "C1",
      },
    });
    await refreshFiscalHead(REGISTER_ID);
    expect(getCabezaDeCadena(REGISTER_ID)?.chainIndex).toBe(7);
  });

  it("SABOTAJE · el dispositivo por delante NO lo pisa el servidor", async () => {
    await configurar();
    // Tres ventas sin subir todavía.
    await generarRegistroDeVenta(VENTA);
    await generarRegistroDeVenta(VENTA);
    await generarRegistroDeVenta(VENTA);
    // Vuelve la red y el servidor sólo ha visto la primera.
    apiWithCashier.mockResolvedValueOnce({
      ...CABEZA_VACIA,
      cabeza: {
        chainIndex: 1,
        idEmisorFactura: "B45902186",
        numSerieFactura: "C1/000001",
        fechaExpedicion: "2026-09-24",
        huella: "A".repeat(64),
        fechaHoraHusoGenRegistro: "2026-09-24T10:00:00+02:00",
        huellaInput: "x",
        ultimoNumero: 1,
        serie: "C1",
      },
    });
    await refreshFiscalHead(REGISTER_ID);
    // Si ganara el servidor, la siguiente venta reemitiría el número 2,
    // que ya se entregó a un cliente.
    expect(getCabezaDeCadena(REGISTER_ID)?.ultimoNumero).toBe(3);
    const siguiente = await generarRegistroDeVenta(VENTA);
    expect(siguiente.numSerieFactura).toBe("C1/000004");
  });

  it("sin red se queda con lo cacheado en vez de reventar", async () => {
    await configurar();
    apiWithCashier.mockRejectedValueOnce(new Error("offline"));
    const config = await refreshFiscalHead(REGISTER_ID);
    expect(config?.serie).toBe("C1");
  });
});

describe("lo que NO genera registro", () => {
  it("un comercio con Holded no tiene nada que generar", async () => {
    await configurar({ emite: false, serie: null, numeroInstalacion: null, nif: null, razonSocial: null });
    expect(getFiscalConfig(REGISTER_ID)?.emite).toBe(false);
    await expect(generarRegistroDeVenta(VENTA)).rejects.toThrow(
      FiscalNoConfiguradoError,
    );
  });

  it("una caja sin configuración cacheada no inventa una", async () => {
    clearFiscalState();
    await expect(generarRegistroDeVenta(VENTA)).rejects.toThrow(
      FiscalNoConfiguradoError,
    );
  });

  it("faltando el NIF no se genera un registro a medias", async () => {
    await configurar({ nif: null });
    await expect(generarRegistroDeVenta(VENTA)).rejects.toThrow(
      FiscalNoConfiguradoError,
    );
  });
});
