// residencia-5 · **LA TABLA DE LA CONFIRMACIÓN Y DEL ALCANCE.**
//
// Lo que el prompt pide comprobar del parte: «el confirmado exige una
// confirmación por zona con contenido o una de alcance total; la DUE de
// turno confirma el suyo; una auxiliar no ve zonas que no son suyas;
// confirmar dos veces no duplica» (lo último lo garantiza un índice
// único y tiene su sabotaje en el e2e).
//
// Y los tres casos que salieron al escribirla: la planta sin contenido
// que no necesita confirmación, la zona «del centro» que sólo cubre un
// alcance total, y el parte sin novedades.

import { describe, expect, it } from "vitest";

import {
  alcanceDe,
  estaConfirmado,
  recortarAlAlcance,
  zonasSinConfirmar,
} from "../src/relevo-confirmacion.js";

const PRIMERA = "planta-1";
const SEGUNDA = "planta-2";
/** La zona «del centro»: lo que no es de ninguna planta. */
const CENTRO = null;

const AUXILIAR_PRIMERA = { alcanceTotal: false, floorIds: [PRIMERA] };
const AUXILIAR_SEGUNDA = { alcanceTotal: false, floorIds: [SEGUNDA] };
const LA_DUE = { alcanceTotal: true, floorIds: [] };

// ── 1 · Cuándo está confirmado ───────────────────────────────────────

describe("un parte está confirmado cuando cada zona con contenido lo está", () => {
  it("sin ninguna confirmación, NO", () => {
    expect(estaConfirmado([{ floorId: PRIMERA }], [])).toBe(false);
  });

  it("una planta con contenido y la auxiliar de esa planta → SÍ", () => {
    expect(estaConfirmado([{ floorId: PRIMERA }], [AUXILIAR_PRIMERA])).toBe(true);
  });

  it("dos plantas con contenido y sólo una auxiliar → NO", () => {
    expect(
      estaConfirmado([{ floorId: PRIMERA }, { floorId: SEGUNDA }], [AUXILIAR_PRIMERA]),
    ).toBe(false);
    expect(
      zonasSinConfirmar(
        [{ floorId: PRIMERA }, { floorId: SEGUNDA }],
        [AUXILIAR_PRIMERA],
      ).map((z) => z.floorId),
    ).toEqual([SEGUNDA]);
  });

  it("dos plantas y las dos auxiliares → SÍ", () => {
    expect(
      estaConfirmado(
        [{ floorId: PRIMERA }, { floorId: SEGUNDA }],
        [AUXILIAR_PRIMERA, AUXILIAR_SEGUNDA],
      ),
    ).toBe(true);
  });

  it("**una de alcance total cubre todas** — la DUE de turno", () => {
    // D-58: «la DUE confirma el suyo si está de turno». Su confirmación
    // vale por el parte entero, incluida la zona del centro.
    expect(
      estaConfirmado(
        [{ floorId: PRIMERA }, { floorId: SEGUNDA }, { floorId: CENTRO }],
        [LA_DUE],
      ),
    ).toBe(true);
    expect(
      zonasSinConfirmar([{ floorId: PRIMERA }, { floorId: CENTRO }], [LA_DUE]),
    ).toEqual([]);
  });

  it("la auxiliar de la primera NO cubre la de la segunda", () => {
    expect(estaConfirmado([{ floorId: SEGUNDA }], [AUXILIAR_PRIMERA])).toBe(false);
  });

  it("y una auxiliar NO cubre la zona DEL CENTRO", () => {
    // Una avería del office o una queja sin residente no es de ninguna
    // auxiliar: sólo la cubre alguien con alcance total.
    expect(estaConfirmado([{ floorId: CENTRO }], [AUXILIAR_PRIMERA])).toBe(false);
    expect(estaConfirmado([{ floorId: CENTRO }], [LA_DUE])).toBe(true);
  });

  it("una planta SIN contenido no necesita confirmación", () => {
    // Sólo hay fila de `handover_zones` para las zonas con contenido.
    // Exigir confirmación de una planta vacía dejaría el parte «sin
    // confirmar» para siempre, y un indicador que nunca llega al verde
    // deja de mirarse.
    expect(estaConfirmado([{ floorId: PRIMERA }], [AUXILIAR_PRIMERA])).toBe(true);
  });

  it("un parte SIN NOVEDADES se confirma con una confirmación cualquiera", () => {
    // El denominador cuenta tanto como lo que pasa (D-16): lo que se
    // demuestra es que alguien del turno que entra lo miró.
    expect(estaConfirmado([], [AUXILIAR_PRIMERA])).toBe(true);
    expect(estaConfirmado([], [LA_DUE])).toBe(true);
    // Pero sin NINGUNA, no: «turno sin novedades» también se confirma.
    expect(estaConfirmado([], [])).toBe(false);
  });

  it("una confirmación con una zona que no está en el parte no sobra ni falta", () => {
    // La auxiliar de la segunda confirma un parte que sólo tiene
    // contenido en la primera: no lo confirma, y tampoco lo rompe.
    expect(estaConfirmado([{ floorId: PRIMERA }], [AUXILIAR_SEGUNDA])).toBe(false);
  });
});

// ── 2 · Qué ve cada uno (D-51) ───────────────────────────────────────

describe("el parte se recorta al alcance de quien lo mira", () => {
  const parte = {
    lineas: 9,
    sinNovedades: false,
    zonas: [
      { floorId: PRIMERA, lineas: 5, nombre: "Primera" },
      { floorId: SEGUNDA, lineas: 3, nombre: "Segunda" },
      { floorId: CENTRO, lineas: 1, nombre: "Del centro" },
    ],
  };

  it("la DUE lo ve entero, sin tocar nada", () => {
    expect(recortarAlAlcance(parte, LA_DUE)).toBe(parte);
  });

  it("la auxiliar de la primera ve SÓLO su planta", () => {
    const suyo = recortarAlAlcance(parte, AUXILIAR_PRIMERA);
    expect(suyo.zonas.map((z) => z.floorId)).toEqual([PRIMERA]);
    // **Y el recuento se recalcula.** Si saliera «9 líneas» en una
    // pantalla que enseña cinco, el recuento ya estaría diciendo algo de
    // residentes que no le corresponden.
    expect(suyo.lineas).toBe(5);
    expect(suyo.sinNovedades).toBe(false);
  });

  it("y la zona DEL CENTRO no se la queda ninguna auxiliar", () => {
    const suyo = recortarAlAlcance(parte, AUXILIAR_PRIMERA);
    expect(suyo.zonas.some((z) => z.floorId === null)).toBe(false);
  });

  it("una auxiliar de una planta sin contenido lee «turno sin novedades»", () => {
    // Y es lo correcto: para ella no hay nada, y lo que firma es que lo
    // miró. Arrastrar el `sinNovedades` del parte entero le diría «hay 9
    // líneas» sin enseñarle ninguna.
    const tercera = { alcanceTotal: false, floorIds: ["planta-3"] };
    const suyo = recortarAlAlcance(parte, tercera);
    expect(suyo.zonas).toEqual([]);
    expect(suyo.lineas).toBe(0);
    expect(suyo.sinNovedades).toBe(true);
  });

  it("una auxiliar con DOS plantas ve las dos", () => {
    const suyo = recortarAlAlcance(parte, {
      alcanceTotal: false,
      floorIds: [PRIMERA, SEGUNDA],
    });
    expect(suyo.zonas.map((z) => z.floorId)).toEqual([PRIMERA, SEGUNDA]);
    expect(suyo.lineas).toBe(8);
  });
});

// ── 3 · El alcance, de los roles y las zonas ─────────────────────────

describe("de dónde sale el alcance de una persona", () => {
  it("un rol con `fullScope` → total", () => {
    // DUE, médico, calidad y dirección (D-51).
    expect(alcanceDe({ roles: [{ fullScope: true }], zonas: [] })).toEqual({
      alcanceTotal: true,
      floorIds: [],
    });
  });

  it("una zona de «todo el centro» (floorId null) → total, también", () => {
    // Las DOS formas cuentan, igual que en `resolverEstadoResidencia`.
    expect(
      alcanceDe({ roles: [{ fullScope: false }], zonas: [{ floorId: null }] }),
    ).toEqual({ alcanceTotal: true, floorIds: [] });
  });

  it("una auxiliar con su planta → esa planta", () => {
    expect(
      alcanceDe({ roles: [{ fullScope: false }], zonas: [{ floorId: PRIMERA }] }),
    ).toEqual({ alcanceTotal: false, floorIds: [PRIMERA] });
  });

  it("sin zonas y sin `fullScope` → no cubre nada", () => {
    // Legítimo: alguien con rol de cuidado y sin zona asignada todavía.
    // Lo que no puede es confirmar un parte con contenido.
    const alcance = alcanceDe({ roles: [{ fullScope: false }], zonas: [] });
    expect(alcance).toEqual({ alcanceTotal: false, floorIds: [] });
    expect(estaConfirmado([{ floorId: PRIMERA }], [alcance])).toBe(false);
    // Pero sí uno sin novedades: lo miró.
    expect(estaConfirmado([], [alcance])).toBe(true);
  });

  it("las zonas repetidas no se cuentan dos veces", () => {
    expect(
      alcanceDe({
        roles: [{ fullScope: false }],
        zonas: [{ floorId: PRIMERA }, { floorId: PRIMERA }],
      }).floorIds,
    ).toEqual([PRIMERA]);
  });

  it("dos roles y uno con `fullScope` → total", () => {
    // Ana Isabel es TO + Calidad (rama §8): calidad ve todo.
    expect(
      alcanceDe({
        roles: [{ fullScope: false }, { fullScope: true }],
        zonas: [{ floorId: PRIMERA }],
      }).alcanceTotal,
    ).toBe(true);
  });
});
