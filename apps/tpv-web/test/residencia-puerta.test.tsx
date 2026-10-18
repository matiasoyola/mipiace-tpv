// residencia-1 (D-52) · EL MODO PUERTA DE LA APK.
//
// Dos cosas, y las dos son del front:
//
//   1. **La señal.** El 403 `ROOM_DEVICE_NOT_ALLOWED` de `/devices/me` no
//      es un error: es la respuesta correcta —el corte vive en la puerta de
//      todas las rutas del TPV— y es lo que hace que esta tablet arranque
//      en modo puerta. Si cayera en `retry`, se quedaría en el spinner para
//      siempre; si cayera en `purge`, se desemparejaría sola.
//   2. **El turno, calculado EN LA TABLET.** Es la copia de la regla del
//      servidor, y está escrita dos veces a propósito: en residencia-3 la
//      tablet tendrá que adscribir un registro a un turno SIN RED. Las dos
//      copias tienen su test.
//
// Y una tercera que es lo que el bloque promete: **la pantalla no pinta ni
// un dato de salud**.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ApiError } from "../src/api.js";
import { decideAfterBootstrapError } from "../src/hooks/bootstrap-decision.js";
import {
  PuertaScreen,
  turnoDeLaTablet,
} from "../src/residencia/PuertaScreen.js";
import type { PuertaMeResponse } from "../src/hooks/useDeviceBootstrap.js";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const TURNOS = [
  { id: "t-m", code: "M", name: "Mañana", startsAt: "08:00", endsAt: "15:00" },
  { id: "t-t", code: "T", name: "Tarde", startsAt: "15:00", endsAt: "22:00" },
  { id: "t-n", code: "N", name: "Noche", startsAt: "22:00", endsAt: "08:00" },
];

const ME: PuertaMeResponse = {
  device: { id: "d-1", name: "Tablet 112" },
  habitacion: {
    id: "h-112",
    number: "112",
    name: "Sol",
    active: true,
    plantaId: "p-1",
    plantaName: "Primera",
  },
  ocupantes: [
    { bedId: "b-a", bedLabel: "A", nombre: "Carmen Gómez" },
    { bedId: "b-b", bedLabel: "B", nombre: null },
  ],
  turnos: TURNOS,
  serverTime: "2026-10-14T10:00:00.000Z",
};

describe("residencia-1 · el 403 de la puerta es la SEÑAL del modo puerta", () => {
  it("`ROOM_DEVICE_NOT_ALLOWED` → `room`", () => {
    const err = new ApiError(403, "no vende", "ROOM_DEVICE_NOT_ALLOWED");
    expect(decideAfterBootstrapError(err)).toBe("room");
  });

  it("y NO se confunde con el de la cocina", () => {
    const cocina = new ApiError(403, "x", "KITCHEN_DEVICE_NOT_ALLOWED");
    expect(decideAfterBootstrapError(cocina)).toBe("kitchen");
  });

  it("NO es `purge`: la tablet está perfectamente emparejada", () => {
    // Si fuera `purge`, cada arranque de cada tablet de habitación la
    // desemparejaría y el centro tendría que teclear 30 códigos.
    const err = new ApiError(403, "no vende", "ROOM_DEVICE_NOT_ALLOWED");
    expect(decideAfterBootstrapError(err)).not.toBe("purge");
  });

  it("NO es `retry`: eso la dejaría en el spinner para siempre", () => {
    const err = new ApiError(403, "no vende", "ROOM_DEVICE_NOT_ALLOWED");
    expect(decideAfterBootstrapError(err)).not.toBe("retry");
  });

  it("un 403 de la caja sigue siendo `caja-disabled`, y un 401 revocado `purge`", () => {
    // Las tres salidas de antes del bloque no cambian.
    expect(
      decideAfterBootstrapError(new ApiError(403, "x", "CAJA_DISABLED")),
    ).toBe("caja-disabled");
    expect(
      decideAfterBootstrapError(new ApiError(401, "x", "DEVICE_REVOKED")),
    ).toBe("purge");
    expect(decideAfterBootstrapError(new Error("red")))
      .toBe("retry");
  });
});

describe("residencia-1 · el turno, calculado en la tablet", () => {
  function aLas(hh: number, mm = 0): Date {
    // El reloj de la tablet ES el de la pared del centro, así que aquí se
    // construye con hora local a propósito: es la diferencia con la función
    // del servidor, que tiene que convertir desde UTC.
    const d = new Date(2026, 9, 14, hh, mm, 0);
    return d;
  }

  it("las 09:30 son de la mañana y las 18:00 de la tarde", () => {
    expect(turnoDeLaTablet(aLas(9, 30), TURNOS)?.code).toBe("M");
    expect(turnoDeLaTablet(aLas(18), TURNOS)?.code).toBe("T");
  });

  it("LAS 02:30 DE LA MADRUGADA SON DE LA NOCHE", () => {
    // La misma regla que el servidor: la noche es una disyunción, no un
    // rango. Escrita como rango, la madrugada se quedaría sin turno.
    expect(turnoDeLaTablet(aLas(2, 30), TURNOS)?.code).toBe("N");
    expect(turnoDeLaTablet(aLas(0, 0), TURNOS)?.code).toBe("N");
    expect(turnoDeLaTablet(aLas(23, 10), TURNOS)?.code).toBe("N");
  });

  it("el límite es semiabierto: las 15:00 son de la tarde", () => {
    expect(turnoDeLaTablet(aLas(15), TURNOS)?.code).toBe("T");
    expect(turnoDeLaTablet(aLas(14, 59), TURNOS)?.code).toBe("M");
  });

  it("y cubre las 1.440 minutos del día sin hueco ni solape", () => {
    for (let m = 0; m < 1440; m++) {
      const t = turnoDeLaTablet(aLas(Math.floor(m / 60), m % 60), TURNOS);
      expect(t).not.toBeNull();
    }
  });

  it("sin turnos configurados devuelve `null` y la pantalla lo dice", () => {
    expect(turnoDeLaTablet(aLas(12), [])).toBeNull();
  });
});

describe("residencia-1 · la pantalla de la puerta", () => {
  let container: HTMLDivElement;
  let root: Root | undefined;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    if (root) {
      act(() => root!.unmount());
      root = undefined;
    }
    container.remove();
  });

  async function pintar(me: PuertaMeResponse = ME) {
    root = createRoot(container);
    await act(async () => {
      root!.render(<PuertaScreen me={me} />);
    });
  }

  it("enseña el número de habitación, la planta y quién la ocupa", async () => {
    await pintar();
    const texto = container.textContent ?? "";
    expect(texto).toContain("112");
    expect(texto).toContain("Primera");
    expect(texto).toContain("Sol");
    expect(texto).toContain("Carmen Gómez");
  });

  it("NI UN DATO DE SALUD, y la cama libre no inventa un nombre", async () => {
    // Una tablet colgada en un pasillo la ve la familia de la 110, el
    // técnico del ascensor y el inspector de la Consejería.
    await pintar();
    const texto = container.textContent ?? "";
    for (const prohibido of [
      "Dependiente",
      "Semiasistido",
      "grado",
      "Concertada",
      "Privada",
      "DNI",
    ]) {
      expect(texto).not.toContain(prohibido);
    }
    // La cama B está libre: no se pinta una fila vacía con su letra.
    expect(texto).not.toContain("null");
  });

  it("una habitación VACÍA lo dice, no se queda en blanco", async () => {
    await pintar({
      ...ME,
      ocupantes: [{ bedId: "b-a", bedLabel: "A", nombre: null }],
    });
    expect(container.textContent).toContain("Habitación libre");
  });

  it("si los turnos del centro no cubren esta hora, lo dice", async () => {
    await pintar({ ...ME, turnos: [] });
    expect(container.textContent).toContain("Sin turno configurado");
  });

  it("en una habitación INDIVIDUAL no pinta la letra de la cama", async () => {
    // «A» en una individual es ruido: el personal dice «la 112».
    //
    // residencia-3 · el selector pasa de `li span` a buscar «Cama», y la
    // razón es que esta pantalla ganó la foto (D-64): el hueco de las
    // iniciales es otro `span` dentro del mismo `li`, así que contar
    // `span` contaba la foto. Lo que el test SIGUE comprobando es lo
    // mismo: que la letra de la cama no se pinta cuando sobra.
    await pintar({
      ...ME,
      ocupantes: [{ bedId: "b-a", bedLabel: "A", nombre: "Carmen Gómez" }],
    });
    expect(container.textContent).toContain("Carmen Gómez");
    expect(container.textContent).not.toContain("Cama");
  });

  it("y en una DOBLE sí, con la palabra delante", async () => {
    await pintar({
      ...ME,
      ocupantes: [
        { bedId: "b-a", bedLabel: "A", nombre: "Carmen Gómez" },
        { bedId: "b-b", bedLabel: "B", nombre: "Luis Núñez" },
      ],
    });
    expect(container.textContent).toContain("Cama A");
    expect(container.textContent).toContain("Cama B");
  });
});
