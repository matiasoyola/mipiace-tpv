// Las dos comprobaciones del art. 7.i de la Orden HAC/1177/2024, y la
// regla que las gobierna: nunca interrumpen la facturación.

import { describe, expect, it } from "vitest";

import {
  type CabezaDeCadena,
  comprobarAntesDeGenerar,
  siguienteChainIndex,
  siguienteNumero,
  TOLERANCIA_RELOJ_MS,
} from "../src/cadena.js";
import { buildHuellaInputAlta, huellaSha256 } from "../src/huella.js";
import { instanteDeFechaHoraHuso } from "../src/formato.js";

const FECHA_GEN = "2026-09-24T10:00:00+02:00";

async function cabezaSana(
  overrides: Partial<CabezaDeCadena> = {},
): Promise<CabezaDeCadena> {
  const huellaInput = buildHuellaInputAlta({
    idEmisorFactura: "B45902186",
    numSerieFactura: "C1/000001",
    fechaExpedicionFactura: "24-09-2026",
    tipoFactura: "F2",
    cuotaTotal: "2.10",
    importeTotal: "12.10",
    huellaAnterior: null,
    fechaHoraHusoGenRegistro: FECHA_GEN,
  });
  return {
    chainIndex: 1,
    idEmisorFactura: "B45902186",
    numSerieFactura: "C1/000001",
    fechaExpedicion: "2026-09-24",
    huella: await huellaSha256(huellaInput),
    fechaHoraHusoGenRegistro: FECHA_GEN,
    huellaInput,
    ultimoNumero: 1,
    serie: "C1",
    ...overrides,
  };
}

describe("el primer registro de la cadena", () => {
  it("no comprueba nada y usa el reloj", async () => {
    const ahora = new Date("2026-09-24T08:30:00Z");
    const r = await comprobarAntesDeGenerar({ cabeza: null, ahora });
    expect(r.anomalias).toEqual([]);
    expect(instanteDeFechaHoraHuso(r.fechaHoraHusoGenRegistro).getTime()).toBe(
      ahora.getTime(),
    );
  });
});

describe("1.º · el último registro está correctamente encadenado", () => {
  it("con una cabeza sana no dice nada", async () => {
    const r = await comprobarAntesDeGenerar({
      cabeza: await cabezaSana(),
      ahora: new Date("2026-09-24T09:00:00Z"),
    });
    expect(r.anomalias).toEqual([]);
  });

  it("detecta que la huella del anterior no es la de su contenido", async () => {
    const cabeza = await cabezaSana();
    const r = await comprobarAntesDeGenerar({
      cabeza: { ...cabeza, huella: `0${cabeza.huella.slice(1)}` },
      ahora: new Date("2026-09-24T09:00:00Z"),
    });
    expect(r.anomalias.map((a) => a.codigo)).toEqual([
      "HUELLA_ANTERIOR_NO_CUADRA",
    ]);
  });

  it("detecta que un solo carácter del contenido cambió", async () => {
    const cabeza = await cabezaSana();
    const r = await comprobarAntesDeGenerar({
      cabeza: {
        ...cabeza,
        huellaInput: cabeza.huellaInput!.replace("12.10", "12.11"),
      },
      ahora: new Date("2026-09-24T09:00:00Z"),
    });
    expect(r.anomalias.map((a) => a.codigo)).toEqual([
      "HUELLA_ANTERIOR_NO_CUADRA",
    ]);
  });

  it("dice que no puede comprobarlo si no guarda la cadena de entrada", async () => {
    const cabeza = await cabezaSana();
    const r = await comprobarAntesDeGenerar({
      cabeza: { ...cabeza, huellaInput: undefined },
      ahora: new Date("2026-09-24T09:00:00Z"),
    });
    expect(r.anomalias.map((a) => a.codigo)).toEqual([
      "HUELLA_ANTERIOR_NO_COMPROBABLE",
    ]);
  });

  it("aun con la cadena rota, devuelve una hora con la que seguir facturando", async () => {
    // FAQ §15.2: «será preciso generar el siguiente RF, ya que la
    // facturación por este motivo NUNCA debe interrumpirse».
    const cabeza = await cabezaSana();
    const r = await comprobarAntesDeGenerar({
      cabeza: { ...cabeza, huella: `0${cabeza.huella.slice(1)}` },
      ahora: new Date("2026-09-24T09:00:00Z"),
    });
    expect(r.fechaHoraHusoGenRegistro).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/,
    );
  });
});

describe("2.º · la fecha del anterior contra el reloj", () => {
  it("que el nuevo sea MUCHO posterior no es ningún problema", async () => {
    // Es lo normal y la FAQ §15.3 lo dice expresamente.
    const r = await comprobarAntesDeGenerar({
      cabeza: await cabezaSana(),
      ahora: new Date("2026-09-25T09:00:00Z"),
    });
    expect(r.anomalias).toEqual([]);
  });

  it("un reloj atrasado dentro de la tolerancia pasa", async () => {
    const anterior = instanteDeFechaHoraHuso(FECHA_GEN);
    const r = await comprobarAntesDeGenerar({
      cabeza: await cabezaSana(),
      ahora: new Date(anterior.getTime() - (TOLERANCIA_RELOJ_MS - 1_000)),
    });
    expect(r.anomalias).toEqual([]);
  });

  it("un reloj atrasado de más lo marca y NO retrocede la cadena", async () => {
    const anterior = instanteDeFechaHoraHuso(FECHA_GEN);
    const r = await comprobarAntesDeGenerar({
      cabeza: await cabezaSana(),
      ahora: new Date(anterior.getTime() - 60 * 60_000), // una hora atrás
    });
    expect(r.anomalias.map((a) => a.codigo)).toEqual(["RELOJ_ATRASADO"]);
    const usada = instanteDeFechaHoraHuso(r.fechaHoraHusoGenRegistro);
    expect(usada.getTime()).toBe(anterior.getTime() + 1_000);
  });

  it("al corregir conserva el huso del registro anterior", async () => {
    const anterior = instanteDeFechaHoraHuso(FECHA_GEN);
    const r = await comprobarAntesDeGenerar({
      cabeza: await cabezaSana(),
      ahora: new Date(anterior.getTime() - 60 * 60_000),
    });
    expect(r.fechaHoraHusoGenRegistro).toBe("2026-09-24T10:00:01+02:00");
  });

  it("conserva también un huso negativo", async () => {
    const fecha = "2026-01-15T08:00:00-05:00";
    const cabeza = await cabezaSana({ fechaHoraHusoGenRegistro: fecha });
    const r = await comprobarAntesDeGenerar({
      cabeza,
      ahora: new Date(instanteDeFechaHoraHuso(fecha).getTime() - 3_600_000),
    });
    expect(r.fechaHoraHusoGenRegistro).toBe("2026-01-15T08:00:01-05:00");
  });
});

describe("los contadores", () => {
  it("sin cadena, el primero es el 1", () => {
    expect(siguienteNumero(null)).toBe(1);
    expect(siguienteChainIndex(null)).toBe(1);
  });

  it("con cadena, avanzan de uno en uno", async () => {
    const cabeza = await cabezaSana({ chainIndex: 7, ultimoNumero: 5 });
    expect(siguienteChainIndex(cabeza)).toBe(8);
    // 7 registros y 5 facturas: dos anulaciones por el medio. La posición
    // de la cadena y el número de la serie NO son el mismo contador.
    expect(siguienteNumero(cabeza)).toBe(6);
  });
});
