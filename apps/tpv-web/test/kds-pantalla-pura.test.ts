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
  colorMasN,
  cuentaMasN,
  masNParpadea,
  mesasMasN,
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

  it("el reparto conserva el orden también cuando va al «+N»", () => {
    const orden = Array.from({ length: 10 }, (_, i) => `t${i}`);
    const r = repartirTarjetas(
      orden.map((id) => tarjeta({ id, lines: [linea(), linea(), linea()] })),
      ZONA_1280,
    );
    expect([...r.visibles, ...r.extra].map((t) => t.id)).toEqual(orden);
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

  it("se corta por FILAS: media fila fuera rompería el orden de lectura", () => {
    const tarjetas = Array.from({ length: 8 }, (_, i) => tarjeta({ id: `t${i}` }));
    const alto = altoTarjeta(tarjetas[0]!);
    // Sitio para una fila y media.
    const r = repartirTarjetas(tarjetas, {
      ancho: ZONA_1280.ancho,
      alto: alto + TARJETA_HUECO_PX + Math.floor(alto / 2),
    });
    expect(r.visibles).toHaveLength(4);
    expect(r.extra).toHaveLength(4);
  });

  it("cada fila mide lo que su tarjeta MÁS ALTA (decisión 7, literal)", () => {
    const corta = tarjeta({ id: "corta" });
    const larga = tarjeta({
      id: "larga",
      allergyBands: [{ titulo: "SILLA 3 · CELÍACO", alergenos: "Gluten" }],
      lines: Array.from({ length: 6 }, () =>
        linea({
          notes: ["Sin cebolla", "Poco hecho"],
          allergyWarning: "¡LLEVA GLUTEN!",
          seat: 3,
          voidPending: true,
        }),
      ),
    });
    expect(altoTarjeta(larga)).toBeGreaterThan(altoTarjeta(corta));
    // Con sitio justo para la CORTA, la fila entera se va: la larga no
    // cabe y partir la fila rompería el orden de lectura.
    const r = repartirTarjetas([corta, larga, corta], {
      ancho: ZONA_1280.ancho,
      alto: altoTarjeta(corta),
    });
    expect(r.visibles).toHaveLength(0);
    expect(r.extra).toHaveLength(3);
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
    // La pantalla sólo usa el pulso NEUTRO, y sólo en la franja «+N», que
    // es una caja de 60 px del borde. La clase roja ni se importa aquí:
    // vive en la tarjeta, en el plato que lleva el alérgeno de su silla.
    const usos = [...pantalla.matchAll(/PULSO_CLASS_\w+/g)].map((m) => m[0]);
    expect(usos).toEqual(["PULSO_CLASS_TARJETA", "PULSO_CLASS_TARJETA"]);
    expect(usos).not.toContain("PULSO_CLASS_ROJO");
    expect(pantalla).toMatch(/data-testid="kds-mas-n"[\s\S]{0,400}PULSO_CLASS_TARJETA/);
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
