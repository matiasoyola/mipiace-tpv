// kds-1-cocina · LAS FUNCIONES PURAS DE LA PANTALLA.
//
// Cuatro filas de la tabla de sabotajes del bloque, probadas con números y
// sin navegador:
//
//   | Orden por columnas | las 4 primeras en el DOM, en orden de lectura,
//   | son las 4 más antiguas (urgentes delante)
//   | Cortar una tarjeta | ninguna tarjeta visible se sale del área; las
//   | que no caben van a «+N»
//   | El semáforo cuenta desde la nota | tiempo 2 marchado a los 30 min →
//   | 0 min al marchar
//   | Parpadeo de 1 s | la animación dura ≥ 2,5 s
//
// Y las tres de kds-1c, que son del MISMO reparto:
//
//   | Quitar el ordenado en la pantalla | lista barajada → las visibles son
//   | las N más antiguas (urgentes delante) y en orden de lectura
//   | Ordenar por `sentAt` en vez de por la marcha | un tiempo 2 marchado
//   | tarde se coloca por su marcha
//   | Que «+N» use otro orden que la rejilla | los ocultos son siempre más
//   | nuevos que el último visible
//
// Puras y no dentro del componente por lo de siempre en esta casa: así un
// sabotaje se ve en rojo sin mirar una captura. jsdom no hace layout
// (`getBoundingClientRect` devuelve ceros), así que el reparto de tarjetas
// NO se podría comprobar sobre el DOM ni queriendo — y es precisamente
// por eso que la altura se CALCULA de los tokens en vez de medirse.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  altoTarjeta,
  colorMasN,
  cuentaMasN,
  masNParpadea,
  mesasMasN,
  ordenarParaLaPantalla,
  repartirTarjetas,
  TARJETAS_NORMALES_A_1280,
  type TarjetaMedible,
} from "../src/lib/kitchenLayout.js";
import {
  cruzoARojo,
  etiquetaMinutos,
  minutosDesdeMarchado,
  tonoSemaforo,
} from "../src/lib/kitchenSemaforo.js";
import {
  ALERGIA_PX,
  COLUMNAS_A_1280,
  NOTA_PX,
  PULSO_CLASS_AMBAR,
  PULSO_CLASS_NUEVA,
  PULSO_CLASS_ROJO,
  PULSO_CLASS_TARJETA,
  PULSO_MS,
  TARJETA_ANCHO_PX,
  TARJETA_HUECO_PX,
  VISTO_HEIGHT_PX,
  LISTA_HEIGHT_PX,
  MIN_TOUCH_COCINA_PX,
} from "../src/lib/kitchenTheme.js";

const UMBRALES = { greenMaxMin: 10, amberMaxMin: 20 };

/**
 * La zona de CONTENIDO a 1280 × 800, que es lo que `repartirTarjetas`
 * recibe de la pantalla:
 *
 *   ancho = 1280 − 160 («Listas») − 60 (la franja «+N») − 24 (padding)
 *   alto  = 800 − 60 (la barra superior) − 24 (padding)
 */
const ZONA_1280 = { ancho: 1036, alto: 716 };

/** La hora contra la que se cuentan los minutos en estos tests. */
const AHORA = "2026-10-08T14:00:00.000Z";
const haceMin = (m: number) =>
  new Date(Date.parse(AHORA) - m * 60_000).toISOString();

function linea(over: Partial<TarjetaMedible["lines"][number]> = {}) {
  return {
    // Doce caracteres: un nombre que cabe en una línea a 22 px en una
    // tarjeta de cuatro columnas. Los que no caben se parten, y eso lo
    // mide `altoTarjeta` — tiene su propio test más abajo.
    name: "Croquetas",
    notes: [],
    carries: [],
    allergyWarning: null,
    seat: null,
    voidPending: false,
    changePending: false,
    fired: true,
    ...over,
  };
}

function tarjeta(over: Partial<TarjetaMedible> = {}): TarjetaMedible {
  return {
    id: "t1",
    tableName: "M5",
    number: 1,
    urgent: false,
    isNew: false,
    firedAt: AHORA,
    lateArrival: false,
    allergyBands: [],
    lines: [linea()],
    ...over,
  };
}

describe("kds-1 · SABOTAJE · el semáforo cuenta desde la nota", () => {
  it("un tiempo retenido (`firedAt` null) no tiene minutos NI semáforo", () => {
    expect(minutosDesdeMarchado(null, new Date().toISOString())).toBeNull();
    expect(tonoSemaforo(null, UMBRALES)).toBe("espera");
    expect(etiquetaMinutos(null)).toBe("EN ESPERA");
  });

  it("marchado a los 30 min de enviarse → 0 min, no 30", () => {
    const ahora = new Date("2026-10-08T14:30:00.000Z");
    const enviado = new Date("2026-10-08T14:00:00.000Z");
    const marchado = ahora;
    // Si contara desde el envío, serían 30 min y la tarjeta estaría roja.
    expect(minutosDesdeMarchado(enviado.toISOString(), ahora.toISOString())).toBe(30);
    expect(minutosDesdeMarchado(marchado.toISOString(), ahora.toISOString())).toBe(0);
    expect(tonoSemaforo(0, UMBRALES)).toBe("verde");
  });

  it("los tres tonos caen donde dice la decisión 3", () => {
    expect(tonoSemaforo(0, UMBRALES)).toBe("verde");
    expect(tonoSemaforo(9, UMBRALES)).toBe("verde");
    expect(tonoSemaforo(10, UMBRALES)).toBe("ambar");
    expect(tonoSemaforo(20, UMBRALES)).toBe("ambar");
    expect(tonoSemaforo(21, UMBRALES)).toBe("rojo");
  });

  it("los minutos van AL SUELO: a los 59 s dice «0 min», que es la verdad", () => {
    const t0 = "2026-10-08T14:00:00.000Z";
    expect(minutosDesdeMarchado(t0, "2026-10-08T14:00:59.000Z")).toBe(0);
    expect(minutosDesdeMarchado(t0, "2026-10-08T14:01:00.000Z")).toBe(1);
  });

  it("y los umbrales son POR RESTAURANTE, no constantes del código", () => {
    const aLaCarta = { greenMaxMin: 25, amberMaxMin: 45 };
    expect(tonoSemaforo(20, aLaCarta)).toBe("verde");
    expect(tonoSemaforo(20, UMBRALES)).toBe("ambar");
  });

  it("«al pasar a rojo, UN SOLO pulso»: sólo en la transición", () => {
    expect(cruzoARojo("ambar", "rojo")).toBe(true);
    // Ya estaba roja: no vuelve a pulsar. Una tarjeta roja que parpadea
    // para siempre deja de señalar nada en cuanto hay dos.
    expect(cruzoARojo("rojo", "rojo")).toBe(false);
    // Primer pintado: no se sabe de dónde viene, así que no pulsa.
    expect(cruzoARojo(undefined, "rojo")).toBe(false);
    expect(cruzoARojo("verde", "ambar")).toBe(false);
  });
});

describe("kds-1 · SABOTAJE · orden por columnas", () => {
  it("el reparto pinta en ORDEN DE LECTURA, de izquierda a derecha", () => {
    // El `grid` pinta en orden del DOM, de izquierda a derecha y luego la
    // fila de abajo, así que el orden del array ES el orden de lectura.
    const orden = ["urgente", "vieja", "media", "nueva", "ultima"];
    const tarjetas = orden.map((id, i) =>
      tarjeta({ id, urgent: id === "urgente", firedAt: haceMin(20 - i) }),
    );
    const r = repartirTarjetas(tarjetas, { ancho: 1016, alto: 2000 });
    expect(r.visibles.map((t) => t.id)).toEqual(orden);
  });

  it("el reparto conserva el orden también cuando va al «+N»", () => {
    const orden = Array.from({ length: 10 }, (_, i) => `t${i}`);
    const r = repartirTarjetas(
      orden.map((id, i) =>
        tarjeta({
          id,
          firedAt: haceMin(30 - i),
          lines: [linea(), linea(), linea()],
        }),
      ),
      ZONA_1280,
    );
    expect([...r.visibles, ...r.extra].map((t) => t.id)).toEqual(orden);
  });
});

// ── kds-1c · LA PANTALLA ORDENA SOLA ─────────────────────────────────
//
// Las tres filas de la tabla de sabotajes de kds-1c, apartado 1. El
// defecto que vienen a cerrar es el de la captura de kds-1b: T4 → M5 → M1
// → **M2**, con la M4 de 26 min escondida en el «+7» mientras la M1 de 4
// se veía.
describe("kds-1c · SABOTAJE · quitar el ordenado en la pantalla", () => {
  /** El servicio de la captura de kds-1b, EN EL ORDEN EN QUE LLEGÓ. */
  const DESORDENADO = [
    tarjeta({ id: "o-t4", tableName: "T4", urgent: true, firedAt: haceMin(2) }),
    tarjeta({ id: "o-m5", tableName: "M5", firedAt: haceMin(7) }),
    tarjeta({ id: "o-m1", tableName: "M1", firedAt: haceMin(4) }),
    tarjeta({ id: "o-m2", tableName: "M2", firedAt: haceMin(14) }),
    tarjeta({ id: "o-m4", tableName: "M4", firedAt: haceMin(26) }),
    tarjeta({ id: "o-t2", tableName: "T2", firedAt: haceMin(9) }),
  ];

  it("la lista barajada se ordena: urgentes delante, luego de la más antigua", () => {
    expect(ordenarParaLaPantalla(DESORDENADO).map((t) => t.tableName)).toEqual([
      // La urgente, aunque lleve 2 min: es una decisión del camarero.
      "T4",
      // Y después de la que más espera a la que menos.
      "M4",
      "M2",
      "T2",
      "M5",
      "M1",
    ]);
  });

  it("y las VISIBLES son las más antiguas: la M4 de 26 min no se esconde", () => {
    // El defecto de la captura, literal: con sitio para cuatro, la M1 de 4
    // min se veía y la M4 de 26 estaba en el «+N».
    const r = repartirTarjetas(DESORDENADO, {
      ancho: ZONA_1280.ancho,
      alto: altoTarjeta(DESORDENADO[0]!),
    });
    expect(r.visibles.map((t) => t.tableName)).toEqual(["T4", "M4", "M2", "T2"]);
    expect(r.extra.map((t) => t.tableName)).toEqual(["M5", "M1"]);
  });

  it("el reparto ordena ÉL, sin que nadie le pase la lista ordenada", () => {
    // Es la prueba de que ordena la pantalla y no el servidor: la misma
    // lista barajada entra y sale colocada.
    const r = repartirTarjetas(DESORDENADO, { ancho: ZONA_1280.ancho, alto: 4000 });
    expect(r.visibles.map((t) => t.tableName)).toEqual([
      "T4",
      "M4",
      "M2",
      "T2",
      "M5",
      "M1",
    ]);
  });
});

describe("kds-1c · SABOTAJE · ordenar por `sentAt` en vez de por la marcha", () => {
  it("un tiempo 2 marchado TARDE se coloca por su marcha, no por su envío", () => {
    // La mesa pidió hace media hora y el camarero acaba de marchar el
    // segundo: la tarjeta pinta «1 min», y ése es el sitio que le toca.
    // Ordenada por el envío se colaría delante de una mesa que lleva
    // veinte esperando de verdad.
    const tiempo2 = tarjeta({ id: "tiempo2", tableName: "T2", firedAt: haceMin(1) });
    const vieja = tarjeta({ id: "vieja", tableName: "M4", firedAt: haceMin(20) });
    expect(ordenarParaLaPantalla([tiempo2, vieja]).map((t) => t.id)).toEqual([
      "vieja",
      "tiempo2",
    ]);
    // Y los minutos que pinta la tarjeta dicen lo mismo que el orden.
    expect(minutosDesdeMarchado(tiempo2.firedAt, AHORA)).toBe(1);
    expect(minutosDesdeMarchado(vieja.firedAt, AHORA)).toBe(20);
  });

  it("un tiempo RETENIDO va al final: no ha empezado a contar", () => {
    const retenida = tarjeta({ id: "retenida", firedAt: null });
    const nueva = tarjeta({ id: "nueva", firedAt: haceMin(1) });
    expect(ordenarParaLaPantalla([retenida, nueva]).map((t) => t.id)).toEqual([
      "nueva",
      "retenida",
    ]);
  });

  it("y con la misma marca manda el id, para que no salten de sitio", () => {
    const a = tarjeta({ id: "a", firedAt: haceMin(5) });
    const b = tarjeta({ id: "b", firedAt: haceMin(5) });
    expect(ordenarParaLaPantalla([b, a]).map((t) => t.id)).toEqual(["a", "b"]);
    expect(ordenarParaLaPantalla([a, b]).map((t) => t.id)).toEqual(["a", "b"]);
  });

  it("ordenar no toca la lista que le dan", () => {
    // Si mutara el array del `feed`, el repintado siguiente ordenaría sobre
    // lo ya ordenado y el sabotaje no se vería nunca.
    const entrada = [
      tarjeta({ id: "b", firedAt: haceMin(1) }),
      tarjeta({ id: "a", firedAt: haceMin(9) }),
    ];
    ordenarParaLaPantalla(entrada);
    expect(entrada.map((t) => t.id)).toEqual(["b", "a"]);
  });
});

describe("kds-1c · SABOTAJE · que «+N» use otro orden que la rejilla", () => {
  it("los ocultos son SIEMPRE más nuevos que el último visible", () => {
    // Un servicio entero con marcas repartidas, y la lista barajada a
    // propósito: el id no sigue al reloj.
    const servicio = Array.from({ length: 14 }, (_, i) =>
      tarjeta({
        id: `c${i}`,
        tableName: `M${i}`,
        // `5 × i mod 14` recorre los catorce restos (5 y 14 son primos
        // entre sí): minutos todos distintos y en un orden que NO sigue al
        // id, que es lo que el sabotaje necesita para delatarse.
        firedAt: haceMin(((i * 5) % 14) + 1),
        lines: [linea(), linea(), linea()],
      }),
    );
    const r = repartirTarjetas(servicio, ZONA_1280);
    expect(r.extra.length).toBeGreaterThan(0);
    // Más NUEVA = marca MÁS GRANDE, así que la más nueva de las visibles es
    // el MÁXIMO. Ninguna oculta puede ser más antigua que ella: si lo
    // fuera, el «+N» estaría escondiendo lo que más espera.
    const masNuevaVisible = Math.max(
      ...r.visibles.map((t) => Date.parse(t.firedAt!)),
    );
    for (const oculta of r.extra) {
      expect(
        Date.parse(oculta.firedAt!),
        `${oculta.tableName} oculta`,
      ).toBeGreaterThanOrEqual(masNuevaVisible);
    }
  });

  it("«rojo oculto» queda para cuando hay MÁS ROJAS DE LAS QUE CABEN", () => {
    // La consecuencia del orden único: si una oculta está en rojo, todas
    // las visibles no urgentes están en rojo también —son más antiguas—.
    // Ya no puede salir un «+7» rojo con una verde de 4 min en pantalla.
    const servicio = Array.from({ length: 14 }, (_, i) =>
      tarjeta({
        id: `c${i}`,
        tableName: `M${i}`,
        // De 29 a 2 min, barajadas por el id.
        firedAt: haceMin(((i * 5) % 14) * 2 + 2),
        lines: [linea(), linea(), linea()],
      }),
    );
    const r = repartirTarjetas(servicio, ZONA_1280);
    if (colorMasN(r.extra, UMBRALES, AHORA) === "rojo") {
      for (const visible of r.visibles.filter((t) => !t.urgent)) {
        expect(
          tonoSemaforo(minutosDesdeMarchado(visible.firedAt, AHORA), UMBRALES),
        ).toBe("rojo");
      }
    }
    // Y con las rojas cabiendo, la franja NO va en rojo: la M4 de 26 min
    // está en pantalla, que es lo que pide la decisión 7.
    const pocasRojas = [
      tarjeta({ id: "a", tableName: "M4", firedAt: haceMin(26) }),
      ...Array.from({ length: 13 }, (_, i) =>
        tarjeta({
          id: `n${i}`,
          tableName: `M${i}`,
          firedAt: haceMin(3),
          lines: [linea(), linea(), linea()],
        }),
      ),
    ];
    const r2 = repartirTarjetas(pocasRojas, ZONA_1280);
    expect(r2.visibles[0]!.tableName).toBe("M4");
    expect(colorMasN(r2.extra, UMBRALES, AHORA)).toBe("neutro");
  });
});

describe("kds-1b · SABOTAJE · tres columnas a 1280 px", () => {
  it("a 1280 × 800 entran CUATRO columnas, no tres", () => {
    // Era el cuarto defecto de kds-1b: con tres sólo caben 3 comandas por
    // fila y se escondían mesas que cabían. El ancho de la cuarta sale de
    // «Listas» (240 → 160) y del indicador (96 → 60).
    const r = repartirTarjetas([tarjeta()], ZONA_1280);
    expect(r.columnas).toBe(4);
    expect(COLUMNAS_A_1280).toBe(4);
    // La cuenta: 4 × 248 + 3 × 10 = 1.022 ≤ 1.036.
    expect(
      COLUMNAS_A_1280 * TARJETA_ANCHO_PX + (COLUMNAS_A_1280 - 1) * TARJETA_HUECO_PX,
    ).toBeLessThanOrEqual(ZONA_1280.ancho);
  });

  it("y la primera fila lleva CUATRO comandas normales", () => {
    // El sabotaje, literal: cuatro comandas normales de tres platos tienen
    // que caber las cuatro en la primera fila.
    const cuatro = ["M1", "M2", "M3", "M4"].map((n) =>
      tarjeta({ id: n, tableName: n, lines: [linea(), linea(), linea()] }),
    );
    const r = repartirTarjetas(cuatro, ZONA_1280);
    expect(r.columnas).toBe(4);
    expect(r.visibles.map((t) => t.id)).toEqual(["M1", "M2", "M3", "M4"]);
    expect(r.extra).toHaveLength(0);
  });
});

describe("kds-1 · SABOTAJE · cortar una tarjeta", () => {
  it("lo que no cabe ENTERO va al «+N», no se corta", () => {
    // Nueve tarjetas de un plato en una zona que sólo da para dos filas.
    const tarjetas = Array.from({ length: 9 }, (_, i) => tarjeta({ id: `t${i}` }));
    const alto = altoTarjeta(tarjetas[0]!);
    const zona = { ancho: ZONA_1280.ancho, alto: alto * 2 + TARJETA_HUECO_PX };
    const r = repartirTarjetas(tarjetas, zona);
    // Dos filas de cuatro = ocho visibles; una a la franja «+N».
    expect(r.visibles).toHaveLength(8);
    expect(r.extra).toHaveLength(1);
    // Y lo visible CABE: la suma de las filas no pasa del alto.
    const filas = Math.ceil(r.visibles.length / r.columnas);
    const usado = filas * alto + (filas - 1) * TARJETA_HUECO_PX;
    expect(usado).toBeLessThanOrEqual(zona.alto);
  });

  it("media tarjeta dentro, nunca: con sitio para fila y media, 4 y 4", () => {
    const tarjetas = Array.from({ length: 8 }, (_, i) => tarjeta({ id: `t${i}` }));
    const alto = altoTarjeta(tarjetas[0]!);
    // Sitio para una fila y media. La segunda fila empieza DEBAJO de la
    // primera, así que a media tarjeta no le toca ninguna.
    const r = repartirTarjetas(tarjetas, {
      ancho: ZONA_1280.ancho,
      alto: alto + TARJETA_HUECO_PX + Math.floor(alto / 2),
    });
    expect(r.visibles).toHaveLength(4);
    expect(r.extra).toHaveLength(4);
  });

  it("ni con una sola tarjeta enorme se corta: va al «+N»", () => {
    const enorme = tarjeta({
      id: "enorme",
      lines: Array.from({ length: 40 }, () => linea()),
    });
    const r = repartirTarjetas([enorme], { ancho: ZONA_1280.ancho, alto: 400 });
    expect(r.visibles).toHaveLength(0);
    expect(r.extra.map((t) => t.id)).toEqual(["enorme"]);
  });

  it("a 1280 × 800 caben las OCHO comandas normales de la decisión 7", () => {
    // **Ya no hay diferencia con la decisión 7.** Pedía «unas 8 comandas
    // normales en 1280 × 800 sin desplazar»; con tres columnas de 320 px
    // entraban 6 y había que explicarlo en el `-done`. Con los tokens de
    // la maqueta —cuatro columnas de ~251, plato a 22 px— entran las 8.
    //
    // El número vive en el test a propósito: si alguien engorda la
    // cabecera o el pie y bajan a cuatro, esto se pone rojo en vez de
    // descubrirse en la pared de una cocina.
    const normales = Array.from({ length: 12 }, (_, i) =>
      tarjeta({
        id: `n${i}`,
        tableName: `M${i}`,
        // De más antigua a más nueva: el reparto ORDENA (kds-1c), así que
        // la M0 es la que más espera y la M11 la que menos.
        firedAt: haceMin(24 - i),
        lines: [linea(), linea(), linea()],
      }),
    );
    const r = repartirTarjetas(normales, ZONA_1280);
    expect(r.visibles).toHaveLength(TARJETAS_NORMALES_A_1280);
    expect(TARJETAS_NORMALES_A_1280).toBeGreaterThanOrEqual(8);
    expect(r.extra).toHaveLength(4);
    // Y las que faltan se nombran en la franja.
    expect(cuentaMasN(r.extra)).toBe("+4");
    expect(mesasMasN(r.extra)).toEqual(["M8", "M9", "M10", "…"]);
  });

  it("un nombre largo se PARTE EN DOS, y la estimación lo cuenta", () => {
    // El cuarto defecto de kds-1b decía «un nombre largo pasa a dos
    // líneas; no se corta ni baja de 22 px». Eso cuesta alto, y si la
    // estimación no lo contara el reparto creería que la fila cabe y la
    // tarjeta SE CORTARÍA, que es lo que la decisión 7 prohíbe.
    const corto = tarjeta({ lines: [linea({ name: "Torrezno" })] });
    const largo = tarjeta({
      lines: [linea({ name: "Croquetas de jamón (sin gluten)" })],
    });
    expect(altoTarjeta(largo)).toBeGreaterThan(altoTarjeta(corto));
  });

  it("la franja nombra las mesas y parpadea si alguna es nueva", () => {
    const extra = [
      tarjeta({ id: "a", tableName: "M1", isNew: false }),
      tarjeta({ id: "b", tableName: "T2", isNew: true }),
    ];
    expect(cuentaMasN(extra)).toBe("+2");
    expect(mesasMasN(extra)).toEqual(["M1", "T2"]);
    expect(masNParpadea(extra)).toBe(true);
    expect(masNParpadea([extra[0]!])).toBe(false);
    expect(cuentaMasN([])).toBe("");
    expect(mesasMasN([])).toEqual([]);
  });

  it("con más de tres, la franja corta: dejaría de ser una pista", () => {
    const extra = ["M1", "M2", "M3", "M4", "M5"].map((n, i) =>
      tarjeta({ id: `x${i}`, tableName: n }),
    );
    expect(cuentaMasN(extra)).toBe("+5");
    expect(mesasMasN(extra)).toEqual(["M1", "M2", "M3", "…"]);
  });

  it("una venta rápida sin mesa se nombra por su nº de comanda", () => {
    expect(mesasMasN([tarjeta({ tableName: null, number: 7 })])).toEqual(["#7"]);
  });
});

// ── kds-1d · LA SEGUNDA FILA ENSEÑA LO QUE CABE ──────────────────────
//
// Las cuatro filas de la tabla de sabotajes de kds-1d. El defecto que
// vienen a cerrar es el de la captura de kds-1c: cuatro tarjetas en la
// primera fila y **390 px de pantalla vacía** debajo, con la T2 y la M7
// —cortas, caben— escondidas en el «+7» porque la M5 del celíaco (~486 px)
// no cabía y se llevaba la fila entera.
describe("kds-1d · SABOTAJE · esconder la fila entera si una no cabe", () => {
  /**
   * **EL SERVICIO DE LA CAPTURA, tarjeta por tarjeta.**
   *
   * No son tarjetas de laboratorio: es el banco del bucle visual
   * (`docs/blocks/kds-1-cocina-shots/banco.mjs`, `COMANDAS`) con lo que el
   * reparto mide de cada una —platos, notas, franjas, sillas, el eyebrow
   * del tiempo 2 y el bloque de espera—, y en el MISMO orden desordenado
   * en que llega. Así el test dice lo que dirá la captura.
   */
  const SERVICIO = [
    tarjeta({
      id: "o-t4",
      tableName: "T4",
      urgent: true,
      isNew: true,
      firedAt: haceMin(2),
      lines: [linea(), linea({ name: "Calamares", notes: ["Sin limón"] })],
    }),
    // La de la alergia por silla con cruce: ~486 px pintados, la que no
    // cabe en la segunda fila.
    tarjeta({
      id: "o-m5",
      tableName: "M5",
      number: 2,
      isNew: true,
      firedAt: haceMin(7),
      allergyBands: [{ titulo: "SILLA 3 · CELÍACO", alergenos: "Gluten" }],
      lines: [
        linea({ name: "Magro con tomate", seat: 3 }),
        linea({ name: "Patatas bravas", seat: 3, allergyWarning: "¡LLEVA GLUTEN!" }),
        linea({ carries: ["lleva gluten"] }),
      ],
    }),
    tarjeta({
      id: "o-m1",
      tableName: "M1",
      firedAt: haceMin(4),
      lines: [
        linea({ name: "Ensaladilla rusa" }),
        linea({ name: "Jamón serrano" }),
        linea({ name: "Queso curado" }),
      ],
    }),
    tarjeta({
      id: "o-m2",
      tableName: "M2",
      firedAt: haceMin(14),
      lines: [
        linea({ name: "Calamares", notes: ["Punto: poco hecho"] }),
        linea({ name: "Chopitos" }),
      ],
    }),
    tarjeta({
      id: "o-m4",
      tableName: "M4",
      number: 2,
      firedAt: haceMin(26),
      lines: [linea({ voidPending: true }), linea({ name: "Alitas de pollo" })],
    }),
    tarjeta({
      id: "o-t2",
      tableName: "T2",
      firedAt: haceMin(9),
      lines: [
        linea({ name: "Patatas alioli" }),
        linea({ name: "Filete de ternera", fired: false }),
      ],
    }),
    tarjeta({
      id: "o-m6",
      tableName: "M6",
      firedAt: haceMin(11),
      lines: [linea({ name: "Hamburguesa especial", notes: ["Sin cebolla"] })],
    }),
    tarjeta({
      id: "o-b1",
      tableName: "B1",
      isNew: true,
      firedAt: haceMin(3),
      lines: [linea({ name: "Torrezno" }), linea({ name: "Fingers de pollo" })],
    }),
    tarjeta({
      id: "o-b3",
      tableName: "B3",
      isNew: true,
      firedAt: haceMin(1),
      lines: [linea({ name: "Ensaladilla rusa" })],
    }),
    tarjeta({
      id: "o-t1",
      tableName: "T1",
      firedAt: haceMin(6),
      lines: [linea({ name: "Queso curado" }), linea({ name: "Torrezno especial" })],
    }),
    tarjeta({
      id: "o-m7",
      tableName: "M7",
      firedAt: haceMin(8),
      lines: [linea({ name: "Gambas al ajillo" })],
    }),
  ];

  it("con el banco de la captura se ven SEIS, no cuatro", () => {
    // El número de la captura: antes 4 (T4 · M4 · M2 · M6) con casi media
    // pantalla vacía; ahora la segunda fila enseña la T2 y la M7, que son
    // cortas y caben en el hueco que dejaba la primera.
    const r = repartirTarjetas(SERVICIO, ZONA_1280);
    expect(r.visibles.map((t) => t.tableName)).toEqual([
      "T4",
      "M4",
      "M2",
      "M6",
      "T2",
      "M7",
    ]);
  });

  it("y el «+N» empieza en la PRIMERA que no cupo: la M5", () => {
    // Si el corte no empezara ahí, el «+N» estaría escondiendo algo más
    // antiguo que lo que ya hay dentro —el defecto de kds-1c—.
    const r = repartirTarjetas(SERVICIO, ZONA_1280);
    expect(r.extra.map((t) => t.tableName)[0]).toBe("M5");
    expect(mesasMasN(r.extra)).toEqual(["M5", "T1", "M1", "…"]);
  });

  it("NO se salta a una más corta de detrás: el orden manda", () => {
    // [corta, ALTA, corta] en la segunda fila. Rellenar el hueco con la
    // corta de detrás adelantaría una comanda más nueva a una más antigua,
    // que es justo lo que kds-1c vino a cerrar.
    const corta = (id: string) => tarjeta({ id, tableName: id, lines: [linea()] });
    const primeraFila = ["a1", "a2", "a3", "a4"].map(corta);
    // El id ordena a los que empatan en la marca, así que los de la
    // segunda fila van `b1 · b2 · b3` y la ALTA es la de en medio.
    const alta = tarjeta({
      id: "b2",
      tableName: "ALTA",
      lines: Array.from({ length: 4 }, () => linea()),
    });
    const segundaFila = [corta("b1"), alta, corta("b3")];
    const altoCorta = altoTarjeta(primeraFila[0]!);
    // Sitio para la primera fila y para UNA corta debajo, pero no para la
    // ALTA.
    const alto = altoCorta + TARJETA_HUECO_PX + altoCorta;
    expect(altoTarjeta(alta)).toBeGreaterThan(altoCorta);
    const r = repartirTarjetas(
      // Con la misma marca manda el id, así que el orden es el del array.
      [...primeraFila, ...segundaFila],
      { ancho: ZONA_1280.ancho, alto },
    );
    expect(r.visibles.map((t) => t.tableName)).toEqual([
      "a1",
      "a2",
      "a3",
      "a4",
      "b1",
    ]);
    expect(r.extra.map((t) => t.tableName)).toEqual(["ALTA", "b3"]);
  });

  it("nada de lo visible se sale del área: ni la fila de abajo", () => {
    // La aritmética del reparto, repetida aquí sobre `visibles`: cada fila
    // empieza donde acaba la más alta de la de arriba, y la última tiene
    // que caber ENTERA. Es el sabotaje «cortar una tarjeta» medido sobre el
    // reparto nuevo, que es el que puede dejar filas a medias.
    const r = repartirTarjetas(SERVICIO, ZONA_1280);
    let filaTop = 0;
    let altoDeLaFila = 0;
    r.visibles.forEach((t, i) => {
      if (i > 0 && i % r.columnas === 0) {
        filaTop += altoDeLaFila + TARJETA_HUECO_PX;
        altoDeLaFila = 0;
      }
      const alto = altoTarjeta(t);
      altoDeLaFila = Math.max(altoDeLaFila, alto);
      expect(filaTop + alto, `${t.tableName} se sale`).toBeLessThanOrEqual(
        ZONA_1280.alto,
      );
    });
  });
});

describe("kds-1b · SABOTAJE · «+N» en rojo sin ninguna oculta en rojo", () => {
  it("con nuevas escondidas pero ninguna pasada, la franja va en VERDE", () => {
    // Era el cuarto defecto de kds-1b: la franja salía en rojo en cuanto
    // había algo escondido. «+2 · M1 · T2» no es una urgencia, es una
    // pista — y una franja roja permanente le quita el crédito al rojo de
    // la franja «URGENTE» de al lado.
    const extra = [
      tarjeta({ id: "a", tableName: "M1", isNew: true, firedAt: haceMin(2) }),
      tarjeta({ id: "b", tableName: "T2", isNew: false, firedAt: haceMin(5) }),
    ];
    expect(colorMasN(extra, UMBRALES, AHORA)).toBe("verde");
  });

  it("sin nuevas y sin ninguna pasada, NEUTRA", () => {
    const extra = [tarjeta({ isNew: false, firedAt: haceMin(5) })];
    expect(colorMasN(extra, UMBRALES, AHORA)).toBe("neutro");
  });

  it("y sin nada escondido, también neutra", () => {
    expect(colorMasN([], UMBRALES, AHORA)).toBe("neutro");
  });

  it("rojo SÓLO si una de las escondidas ya pasó a rojo en el semáforo", () => {
    // Ése es el único caso en que la franja puede ir en rojo: hay una mesa
    // que lleva 25 minutos y no se ve.
    const extra = [
      tarjeta({ id: "a", tableName: "M1", isNew: true, firedAt: haceMin(2) }),
      tarjeta({ id: "b", tableName: "T2", isNew: false, firedAt: haceMin(25) }),
    ];
    expect(colorMasN(extra, UMBRALES, AHORA)).toBe("rojo");
  });

  it("un tiempo RETENIDO escondido no pone la franja en rojo", () => {
    // `firedAt` null = EN ESPERA: no ha empezado a contar, así que no
    // puede estar «pasado».
    const extra = [tarjeta({ isNew: false, firedAt: null })];
    expect(colorMasN(extra, UMBRALES, AHORA)).toBe("neutro");
  });
});

describe("kds-1b · SABOTAJE · la franja de alergia y las notas", () => {
  it("la franja de la alergia no baja de 21 px", () => {
    // El sabotaje, literal: «franja de alergia con menos de 21 px». Es el
    // tamaño de la maqueta, y la franja es lo que condiciona cómo se
    // cocina todo lo demás de esa mesa.
    expect(ALERGIA_PX).toBeGreaterThanOrEqual(21);
  });

  it("un modificador no baja de 17 px", () => {
    // «El cocinero que no lee "sin limón" lo pone.» En gris y a 13 px era
    // una etiqueta de sistema.
    expect(NOTA_PX).toBeGreaterThanOrEqual(17);
  });
});

describe("kds-1b · la estimación de altura, contra lo que mide el navegador", () => {
  /**
   * **EL CIERRE DEL BUCLE VISUAL, dentro de la suite.**
   *
   * `altoTarjeta` ESTIMA la altura de los tokens en vez de medirla con el
   * DOM (ver su cabecera: medir pide dos pasadas y parpadea en cada
   * cambio). La estimación tiene que ir POR LO ALTO: por lo bajo, el
   * reparto cree que una fila cabe cuando no cabe y una tarjeta SE CORTA,
   * que es lo que la decisión 7 prohíbe.
   *
   * El bucle visual deja en `medidas.json` el alto REAL de cada tarjeta
   * pintada a 1280 × 800 y lo bastante para rehacerla. Este test las
   * rehace y comprueba la desigualdad. Así el bucle visual no es algo que
   * haya que acordarse de correr: su medida queda vigilada en cada
   * `pnpm test`.
   *
   * La primera versión de kds-1b se quedó CORTA en dos tarjetas —29 px en
   * una de tres platos y 52 en la de la alergia— porque sumaba los 8 + 8
   * de relleno de la maqueta FUERA del mínimo táctil de 56 px y porque no
   * contaba la pastilla «lleva gluten». Esto es lo que lo enseñó.
   */
  const MEDIDAS = JSON.parse(
    readFileSync(
      path.join(
        path.dirname(fileURLToPath(import.meta.url)),
        "..",
        "..",
        "..",
        "docs",
        "blocks",
        "kds-1-cocina-shots",
        "medidas.json",
      ),
      "utf8",
    ),
  ) as {
    "cocina-1280x800": {
      alturasReales: Array<{
        id: string;
        alto: number;
        urgente: boolean;
        bandas: number;
        eyebrow: number;
        platos: Array<{
          name: string;
          notes: number;
          carries: number;
          seat: boolean;
          lleva: boolean;
          anulado: boolean;
          espera: boolean;
        }>;
      }>;
    };
  };

  const reales = MEDIDAS["cocina-1280x800"].alturasReales;

  it("hay tarjetas medidas: si no, el bucle visual no corrió", () => {
    expect(reales.length).toBeGreaterThan(0);
  });

  for (const r of reales) {
    it(`la estimación de ${r.id} queda por encima de sus ${r.alto} px reales`, () => {
      const rehecha: TarjetaMedible = {
        id: r.id,
        tableName: r.id,
        // El eyebrow se cuenta por `number > 1`, que es cómo lo pinta la
        // tarjeta; el bucle visual guarda si salió.
        number: r.eyebrow > 0 ? 2 : 1,
        urgent: r.urgente,
        isNew: false,
        firedAt: AHORA,
        lateArrival: false,
        allergyBands: Array.from({ length: r.bandas }, () => ({})),
        lines: r.platos.map((p) => ({
          name: p.name,
          notes: Array.from({ length: p.notes }, (_, i) => `n${i}`),
          carries: Array.from({ length: p.carries }, (_, i) => `c${i}`),
          allergyWarning: p.lleva ? "¡LLEVA GLUTEN!" : null,
          seat: p.seat ? 3 : null,
          voidPending: p.anulado,
          changePending: false,
          fired: !p.espera,
        })),
      };
      expect(altoTarjeta(rehecha)).toBeGreaterThanOrEqual(r.alto);
    });
  }
});

describe("kds-1 · SABOTAJE · parpadeo de 1 s o de pantalla entera", () => {
  const CSS = readFileSync(
    path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "..",
      "src",
      "index.css",
    ),
    "utf8",
  );

  it("el token dice 2.500 ms, y es ≥ 2,5 s", () => {
    expect(PULSO_MS).toBeGreaterThanOrEqual(2500);
  });

  it("las cuatro animaciones del CSS usan ESE número", () => {
    for (const clase of [
      PULSO_CLASS_TARJETA,
      PULSO_CLASS_NUEVA,
      PULSO_CLASS_ROJO,
      PULSO_CLASS_AMBAR,
    ]) {
      const bloque = CSS.match(
        new RegExp(`\\.${clase}\\s*\\{([\\s\\S]*?)\\}`),
      );
      expect(bloque, `falta la clase ${clase}`).toBeTruthy();
      const dur = bloque![1]!.match(/animation:[^;]*?(\d+)ms/);
      expect(dur, `${clase} sin duración`).toBeTruthy();
      expect(Number(dur![1])).toBeGreaterThanOrEqual(PULSO_MS);
    }
  });

  it("0,4 destellos por segundo: muy por debajo del umbral de 3/s (WCAG 2.3.1)", () => {
    expect(1000 / PULSO_MS).toBeLessThan(3);
  });

  it("y respeta `prefers-reduced-motion` sin quedarse sin aviso", () => {
    expect(CSS).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
    const bloque = CSS.match(
      /@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/,
    );
    expect(bloque).toBeTruthy();
    // Sin animación, pero CON el fondo del extremo: se queda sin
    // movimiento, no sin aviso.
    expect(bloque![1]).toMatch(/animation: none/);
    expect(bloque![1]).toMatch(/background-color/);
  });

  it("el parpadeo es de la TARJETA o de la LÍNEA, nunca de la pantalla", () => {
    // Las tres clases se ponen en `<article>` (la tarjeta) y en `<li>` (la
    // línea). Si alguien las pusiera en el contenedor de página, este test
    // no lo vería — lo que sí garantiza es que NINGUNA de ellas está en el
    // selector de la pantalla.
    const pantalla = readFileSync(
      path.join(
        path.dirname(fileURLToPath(import.meta.url)),
        "..",
        "src",
        "kitchen",
        "KitchenScreen.tsx",
      ),
      "utf8",
    );
    // La pantalla sólo usa el pulso de la franja «+N», que es una caja de
    // 60 px del borde. La clase roja ni se importa aquí: vive en la
    // tarjeta, en el plato que lleva el alérgeno de su silla.
    const usos = [...pantalla.matchAll(/PULSO_CLASS_\w+/g)].map((m) => m[0]);
    expect(usos).toEqual(["PULSO_CLASS_NUEVA", "PULSO_CLASS_NUEVA"]);
    expect(usos).not.toContain("PULSO_CLASS_ROJO");
    expect(pantalla).toMatch(/data-testid="kds-mas-n"[\s\S]{0,400}PULSO_CLASS_NUEVA/);
  });
});

describe("kds-1 · SABOTAJE · sonido en cocina", () => {
  it("ningún fichero de `src/kitchen/` reproduce audio ni vibra", () => {
    // No es una opinión de estilo: la decisión 8 es «SIN SONIDOS; avisa el
    // parpadeo». Un `<audio>` o un `AudioContext` en esta carpeta sería la
    // decisión 8 deshecha.
    //
    // `kitchen/tpv/` queda FUERA a propósito: ahí vive el pitido del
    // «LISTO» del TPV, que es un ajuste por restaurante apagado de serie
    // (decisión 8, último punto). Lo que no puede sonar es la PANTALLA.
    const dir = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "..",
      "src",
      "kitchen",
    );
    const ficheros = [
      "KitchenScreen.tsx",
      "ComandaCard.tsx",
      "useKitchenFeed.ts",
      "types.ts",
      "secciones.ts",
    ];
    for (const f of ficheros) {
      // Sin comentarios: los de estos ficheros nombran `AudioContext`
      // precisamente para decir que NO está, y un test que mire el fichero
      // entero se pondría rojo por su propia documentación.
      const src = readFileSync(path.join(dir, f), "utf8")
        .split("\n")
        .filter((l) => !l.trimStart().startsWith("//") && !l.trimStart().startsWith("*"))
        .join("\n");
      expect(src, `${f} reproduce audio`).not.toMatch(
        /new Audio|AudioContext|webkitAudioContext|<audio|navigator\.vibrate/,
      );
    }
  });
});

describe("kds-1 · los objetivos táctiles de la cocina", () => {
  it("nada por debajo de 56 px, y «Visto» 44 como mínimo", () => {
    expect(MIN_TOUCH_COCINA_PX).toBe(56);
    expect(LISTA_HEIGHT_PX).toBe(56);
    // La única excepción de la restricción del bloque, y está acotada:
    // vive DENTRO de una línea que ya es de 56.
    expect(VISTO_HEIGHT_PX).toBeGreaterThanOrEqual(44);
    expect(VISTO_HEIGHT_PX).toBeLessThan(MIN_TOUCH_COCINA_PX);
  });
});
