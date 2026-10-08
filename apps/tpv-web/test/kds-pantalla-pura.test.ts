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
  etiquetaMasN,
  masNParpadea,
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
  PULSO_CLASS_AMBAR,
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

function tarjeta(over: Partial<TarjetaMedible> = {}): TarjetaMedible {
  return {
    id: "t1",
    tableName: "M5",
    number: 1,
    urgent: false,
    isNew: false,
    allergyBands: [],
    lines: [
      {
        notes: [],
        allergyWarning: null,
        seat: null,
        voidPending: false,
        changePending: false,
        fired: true,
      },
    ],
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
  it("el reparto conserva el ORDEN DE LA LISTA, que es el de lectura", () => {
    // La lista llega ordenada del servidor (urgentes primero, luego por
    // llegada). Lo que este reparto NO puede hacer es reordenarla: el
    // `flex-wrap` pinta en orden del DOM, de izquierda a derecha y luego la
    // fila de abajo, así que el orden del array ES el orden de lectura.
    const orden = ["urgente", "vieja", "media", "nueva", "ultima"];
    const tarjetas = orden.map((id) => tarjeta({ id }));
    const r = repartirTarjetas(tarjetas, { ancho: 1016, alto: 2000 });
    expect(r.visibles.map((t) => t.id)).toEqual(orden);
  });

  it("a 1280 × 800 entran TRES columnas", () => {
    const r = repartirTarjetas([tarjeta()], { ancho: 1016, alto: 700 });
    expect(r.columnas).toBe(3);
    // La cuenta: 3 × 320 + 2 × 16 = 992 ≤ 1016.
    expect(3 * TARJETA_ANCHO_PX + 2 * TARJETA_HUECO_PX).toBeLessThanOrEqual(1016);
  });
});

describe("kds-1 · SABOTAJE · cortar una tarjeta", () => {
  it("lo que no cabe ENTERO va al «+N», no se corta", () => {
    // Nueve tarjetas de un plato en una zona que sólo da para dos filas.
    const tarjetas = Array.from({ length: 9 }, (_, i) => tarjeta({ id: `t${i}` }));
    const alto = altoTarjeta(tarjetas[0]!);
    const zona = { ancho: 1016, alto: alto * 2 + TARJETA_HUECO_PX };
    const r = repartirTarjetas(tarjetas, zona);
    // Dos filas de tres = seis visibles; tres al indicador.
    expect(r.visibles).toHaveLength(6);
    expect(r.extra).toHaveLength(3);
    // Y lo visible CABE: la suma de las filas no pasa del alto.
    const filas = Math.ceil(r.visibles.length / r.columnas);
    const usado = filas * alto + (filas - 1) * TARJETA_HUECO_PX;
    expect(usado).toBeLessThanOrEqual(zona.alto);
  });

  it("se corta por FILAS: media fila fuera rompería el orden de lectura", () => {
    const tarjetas = Array.from({ length: 6 }, (_, i) => tarjeta({ id: `t${i}` }));
    const alto = altoTarjeta(tarjetas[0]!);
    // Sitio para una fila y media.
    const r = repartirTarjetas(tarjetas, {
      ancho: 1016,
      alto: alto + TARJETA_HUECO_PX + Math.floor(alto / 2),
    });
    expect(r.visibles).toHaveLength(3);
    expect(r.extra).toHaveLength(3);
  });

  it("cada fila mide lo que su tarjeta MÁS ALTA (decisión 7, literal)", () => {
    const corta = tarjeta({ id: "corta" });
    const larga = tarjeta({
      id: "larga",
      allergyBands: ["⚠ SILLA 3 · SIN GLUTEN"],
      lines: Array.from({ length: 6 }, () => ({
        notes: ["Sin cebolla", "Poco hecho"],
        allergyWarning: "¡LLEVA GLUTEN!",
        seat: 3,
        voidPending: true,
        changePending: false,
        fired: true,
      })),
    });
    expect(altoTarjeta(larga)).toBeGreaterThan(altoTarjeta(corta));
    // Con sitio justo para la CORTA, la fila entera se va: la larga no
    // cabe y partir la fila rompería el orden de lectura.
    const r = repartirTarjetas([corta, larga, corta], {
      ancho: 1016,
      alto: altoTarjeta(corta),
    });
    expect(r.visibles).toHaveLength(0);
    expect(r.extra).toHaveLength(3);
  });

  it("ni con una sola tarjeta enorme se corta: va al «+N»", () => {
    const enorme = tarjeta({
      id: "enorme",
      lines: Array.from({ length: 40 }, () => ({
        notes: [],
        allergyWarning: null,
        seat: null,
        voidPending: false,
        changePending: false,
        fired: true,
      })),
    });
    const r = repartirTarjetas([enorme], { ancho: 1016, alto: 400 });
    expect(r.visibles).toHaveLength(0);
    expect(r.extra.map((t) => t.id)).toEqual(["enorme"]);
  });

  it("a 1280 × 800 caben SEIS comandas normales, y las demás van al «+N»", () => {
    // **La diferencia con la decisión 7, medida y clavada aquí.**
    //
    // La decisión 7 pide «unas 8». Con 320 px de ancho de tarjeta y 56 px
    // de línea de plato caben SEIS, y la 7ª y la 8ª van al indicador, que
    // es el mecanismo que la propia decisión 7 manda usar en vez de
    // paginar. El porqué de no subirlo a ocho —haría falta bajar la
    // tarjeta a 244 px, donde «Croquetas de jamón» a 26 px ya no cabe en
    // una línea— está en `TARJETAS_NORMALES_A_1280`.
    //
    // El número vive en el test a propósito: si alguien engorda la
    // cabecera o el pie y bajan a cinco, esto se pone rojo en vez de
    // descubrirse en la pared de una cocina.
    //
    // La zona real a 1280 × 800: 1280 − 240 (columna «Listas») − 24 de
    // padding ≈ 1016 de ancho, y 800 − 72 (barra) − 32 ≈ 696 de alto.
    const normales = Array.from({ length: 12 }, (_, i) =>
      tarjeta({
        id: `n${i}`,
        lines: Array.from({ length: 3 }, () => ({
          notes: [],
          allergyWarning: null,
          seat: null,
          voidPending: false,
          changePending: false,
          fired: true,
        })),
      }),
    );
    const r = repartirTarjetas(normales, { ancho: 1016, alto: 696 });
    expect(r.visibles).toHaveLength(TARJETAS_NORMALES_A_1280);
    expect(r.extra).toHaveLength(6);
    // Y las que faltan se nombran en el indicador.
    expect(etiquetaMasN(r.extra)).toMatch(/^\+6 · M5 · M5 · M5 · …$/);
  });

  it("el indicador nombra las mesas y parpadea si alguna es nueva", () => {
    const extra = [
      tarjeta({ id: "a", tableName: "M1", isNew: false }),
      tarjeta({ id: "b", tableName: "T2", isNew: true }),
    ];
    expect(etiquetaMasN(extra)).toBe("+2 · M1 · T2");
    expect(masNParpadea(extra)).toBe(true);
    expect(masNParpadea([extra[0]!])).toBe(false);
    expect(etiquetaMasN([])).toBe("");
  });

  it("con más de tres, el indicador corta: dejaría de ser una pista", () => {
    const extra = ["M1", "M2", "M3", "M4", "M5"].map((n, i) =>
      tarjeta({ id: `x${i}`, tableName: n }),
    );
    expect(etiquetaMasN(extra)).toBe("+5 · M1 · M2 · M3 · …");
  });

  it("una venta rápida sin mesa se nombra por su nº de comanda", () => {
    expect(etiquetaMasN([tarjeta({ tableName: null, number: 7 })])).toBe("+1 · #7");
  });
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

  it("las tres animaciones del CSS usan ESE número", () => {
    for (const clase of [PULSO_CLASS_TARJETA, PULSO_CLASS_ROJO, PULSO_CLASS_AMBAR]) {
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
    // La pantalla sólo usa la clase roja en el indicador «+N», que es una
    // caja pequeña del borde.
    const usos = [...pantalla.matchAll(/PULSO_CLASS_\w+/g)].map((m) => m[0]);
    expect(usos).toEqual(["PULSO_CLASS_ROJO", "PULSO_CLASS_ROJO"]);
    expect(pantalla).toMatch(/data-testid="kds-mas-n"[\s\S]{0,200}masNParpadea/);
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
