// v1.22-el-terminal-del-bar · §3 · hallazgo B4 (vivo desde el 02-09).
//
// SABOTAJE que tiene que caer: volver la línea del ticket a `truncate`
// (una línea, elipsis por el final). Con la carta REAL de La Maestranza,
// dos productos de distinto precio se leían igual después de pulsarlos:
// «Hamburgu…» era tanto la hamburguesa de 5,00 € como la de 7,00 €.
//
// El test no usa un catálogo de juguete: lee
// `docs/implantaciones/maestranza/catalogo-tpv.csv`, que es la carta que
// se va a cargar en el terminal del bar. Si mañana entra un producto que
// colisiona con otro, el test lo dice antes que el camarero.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  LINE_NAME_BOX_WIDTH,
  LINE_NAME_MAX_LINES,
  lineNameDisplay,
  truncateMiddle,
  wrapLines,
} from "../src/lib/lineName.js";

// La suite corre desde la raíz del repo (ver `vitest.workspace.ts`).
const CSV = "docs/implantaciones/maestranza/catalogo-tpv.csv";

/** El CSV trae un campo entrecomillado con comas dentro. */
function splitCsv(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (const ch of line) {
    if (ch === '"') {
      quoted = !quoted;
      continue;
    }
    if (ch === "," && !quoted) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

function cartaMaestranza(): string[] {
  return readFileSync(CSV, "utf8")
    .replace(/\r/g, "")
    .trim()
    .split("\n")
    .slice(1)
    .map((l) => splitCsv(l)[1]!.trim())
    .filter(Boolean);
}

// La geometría de ANTES del bloque, medida en el AP13 el 06-10: una
// sola línea de 86–100 px con elipsis por el final (`truncate`). Se usa
// 95, que es lo que midió la caja del nombre con tres líneas en el
// panel.
const CAJA_VIEJA = 95;
const UNA_LINEA = 1;

describe("v1.22 §3 · la carta de La Maestranza se lee en la línea", () => {
  const carta = cartaMaestranza();

  it("la carta del test es la de verdad", () => {
    expect(carta.length).toBeGreaterThan(100);
    expect(carta).toContain("Hamburguesa normal");
    expect(carta).toContain("Hamburguesa especial");
  });

  it("ningún par de productos se lee igual en la línea", () => {
    const porTexto = new Map<string, string>();
    const colisiones: string[] = [];
    for (const nombre of carta) {
      const visible = lineNameDisplay(nombre);
      const previo = porTexto.get(visible);
      if (previo !== undefined && previo !== nombre) {
        colisiones.push(`${previo} ≡ ${nombre} → "${visible}"`);
      } else {
        porTexto.set(visible, nombre);
      }
    }
    expect(colisiones).toEqual([]);
  });

  // El sabotaje, escrito: con UNA línea y corte por el final —que es lo
  // que hacía `truncate`— la carta colisiona. Si este test deja de ver
  // colisiones, es que el corte por el final ha dejado de ser un
  // problema… o que el ancho de la caja ha cambiado sin actualizar el
  // módulo. Las dos cosas hay que mirarlas.
  it("con UNA línea y elipsis por el final, la carta SÍ colisionaba", () => {
    const porTexto = new Map<string, string>();
    const colisiones: string[] = [];
    for (const nombre of carta) {
      // Corte por el final a una línea, como el `truncate` de v1.21.
      let visible = nombre;
      while (wrapLines(visible, CAJA_VIEJA) > UNA_LINEA) {
        visible = visible.slice(0, -1);
      }
      if (visible !== nombre) visible = visible.trimEnd() + "…";
      const previo = porTexto.get(visible);
      if (previo !== undefined && previo !== nombre) {
        colisiones.push(`${previo} ≡ ${nombre}`);
      } else {
        porTexto.set(visible, nombre);
      }
    }
    expect(colisiones.length).toBeGreaterThan(0);
    expect(colisiones.join(" | ")).toContain("Hamburguesa");
  });

  it("los pares del bloque van enteros, sin recortar", () => {
    for (const par of [
      ["Hamburguesa normal", "Hamburguesa especial"],
      ["Bocadillo", "Bocadillo especial"],
      ["Montado", "Montado especial"],
    ]) {
      for (const n of par) expect(lineNameDisplay(n)).toBe(n);
    }
  });

  it("lo que se recorta conserva la cola, que es lo que distingue", () => {
    // Las dos etiquetas de Johnnie Walker son el caso extremo: 28 y 29
    // caracteres que sólo se diferencian en la última palabra. Por el
    // final las dos serían "Johnnie Walker Etiqueta…".
    const negra = lineNameDisplay("Johnnie Walker Etiqueta Negra");
    const roja = lineNameDisplay("Johnnie Walker Etiqueta Roja");
    expect(negra).not.toBe(roja);
    expect(negra).toMatch(/Negra$/);
    expect(roja).toMatch(/Roja$/);
  });

  it("nada de lo que se pinta desborda las dos líneas", () => {
    // Cortar DOS veces —por el medio aquí y por el final con el
    // `line-clamp` de CSS— es el fallo que este módulo viene a evitar:
    // la segunda tijera se lleva la cola.
    for (const nombre of carta) {
      expect(wrapLines(lineNameDisplay(nombre))).toBeLessThanOrEqual(
        LINE_NAME_MAX_LINES,
      );
    }
  });
});

describe("v1.22 §3 · el ajuste por palabras, simulado", () => {
  it("una palabra más ancha que la caja ocupa ceil, no floor, de líneas", () => {
    // 20 caracteres a 7,5 px son 150 px en una caja de 112: dos líneas,
    // no una. Con `floor` el modelo decía dos líneas totales donde el
    // navegador pintaba tres, y el nombre salía cortado otra vez.
    expect(wrapLines("abcdefghijklmnopqrst", 112, 7.5)).toBe(2);
    expect(wrapLines("Croissant abcdefghijklmnopqrst", 112, 7.5)).toBe(3);
    // Y una palabra que entra justa NO abre línea nueva.
    expect(wrapLines("abcdefghijklmn", 112, 7.5)).toBe(1);
  });

  it("la elipsis cuenta doble: es un glifo ancho", () => {
    // 13 letras caben en una línea (97,5 px de 112); las mismas 13 con
    // elipsis pasan de 112 porque el glifo cuenta por dos.
    expect(wrapLines("abcdefghijklm", 112, 7.5)).toBe(1);
    expect(wrapLines("abcdefghijklm…", 112, 7.5)).toBe(2);
  });

  it("un texto vacío ocupa una línea y no se cuelga", () => {
    expect(wrapLines("")).toBe(1);
    expect(lineNameDisplay("")).toBe("");
  });
});

describe("v1.22 §3 · el corte por el medio", () => {
  it("reparte 60 % cabeza y 40 % cola", () => {
    // Presupuesto 12 → 11 útiles: cola 4 (40 % redondeado) y cabeza 7.
    expect(truncateMiddle("Hamburguesa especial", 12)).toBe("Hamburg…cial");
  });

  it("no deja un espacio pegado a la elipsis", () => {
    expect(truncateMiddle("Tostada de jamón ibérico", 14)).not.toMatch(/ …| …/);
  });

  it("lo que cabe no se toca", () => {
    expect(truncateMiddle("Caña mediana", 40)).toBe("Caña mediana");
  });

  it("con un presupuesto ridículo no inventa nada", () => {
    expect(truncateMiddle("Hamburguesa especial", 3)).toBe("Ha…");
  });
});
