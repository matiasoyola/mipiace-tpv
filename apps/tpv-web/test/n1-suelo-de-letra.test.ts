// n1-hosteleria-2 · R4 · TEST DE GUARDIA DEL SUELO DE LETRA.
//
// R4 fija un tamaño mínimo de letra para la mano y lo fija UNA vez:
// `SUELO_LETRA_MANO_PX` = 15 (la cuenta de los minutos de arco está en
// su propio comentario). El problema de una regla así no es aplicarla
// hoy: es que dentro de tres bloques alguien escriba otro `deMano ? 13`
// para que algo quepa, que es exactamente cómo llegaron los 13 px de
// «POR RECOGER» y los 10 de «cobro pendiente» — ninguno de los dos se
// escribió por descuido, los dos se escribieron para que cupiera algo.
//
// Así que este banco recorre el fuente de las pantallas de sala y venta
// y mira cada `fontSize` que tenga una rama DE MANO. Si la rama de mano
// baja del suelo, falla aquí.
//
// Lo que NO puede ver, y se dice en voz alta: un `fontSize` constante
// —sin `deMano`— que se pinte sólo en la mano. Esos se revisan a mano y
// su medida está en la tabla del navegador del `-done`. Lo que este
// banco cierra es la puerta por la que se cuela la regresión barata.
//
// La fila de la tabla de sabotajes:
//   | Una mesa vuelve a 13 px en la mano | este banco

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { SUELO_LETRA_MANO_PX } from "../src/lib/roomGrid.js";
import { EYEBROW_PX } from "../src/lib/hospitalityTheme.js";

const SRC = findSrc(process.cwd());

function findSrc(from: string): string {
  let dir = resolve(from);
  for (;;) {
    const candidate = join(dir, "apps", "tpv-web", "src");
    if (existsSync(candidate)) return candidate;
    if (existsSync(join(dir, "src", "pages", "SalePage.tsx"))) {
      return join(dir, "src");
    }
    const parent = dirname(dir);
    if (parent === dir) throw new Error("no encuentro apps/tpv-web/src");
    dir = parent;
  }
}

/**
 * Las pantallas que R4 cubre: «todas las pantallas de venta y sala del
 * N1». Se listan a mano y no se descubren solas: la lista ES el alcance
 * de la regla, y que haya que añadir un fichero aquí al meter una
 * pantalla nueva de sala es la señal de que hay que medirla.
 */
const PANTALLAS = [
  "pages/TableMapScreen.tsx",
  "pages/SalePage.hospitality.tsx",
  "pages/CartLineItem.tsx",
  "kitchen/tpv/ListoBanner.tsx",
  // La hoja de opciones de una mesa (hallazgo 8). No es «de sala» por su
  // nombre, pero en la mano es lo que sale al tocar una mesa.
  "components/ConfirmSheet.tsx",
];

/**
 * Los nombres que valen como «ya es el suelo o más». Un `fontSize` que
 * use la constante no hace falta leerlo: por eso existe la constante.
 */
const SIMBOLOS_PERMITIDOS = new Set([
  "SUELO_LETRA_MANO_PX",
  "TABLE_AMOUNT_FONT_PX_MANO",
  "COBRAR_AMOUNT_FONT_PX_MANO",
  "TABLE_NAME_PX",
  "MIN_TOUCH_PX",
  // El total del pie en la mano: 34 px, muy por encima del suelo. Entró
  // con el adelgazamiento del pie del hallazgo 1, y este banco lo cazó
  // en la pasada completa — que es exactamente para lo que está.
  "TOTAL_PX_MANO",
]);

/**
 * `fontSize: deMano ? A : B` y `fontSize: handheld ? A : B`, con A y B
 * un número o un identificador. La rama de mano es la primera.
 */
const TERNARIO =
  /fontSize:\s*(?:deMano|handheld)\s*\?\s*([A-Za-z_][\w.]*|\d+(?:\.\d+)?)\s*:/g;

describe("n1-hosteleria-2 · R4 · ningún fontSize de mano baja del suelo", () => {
  for (const rel of PANTALLAS) {
    it(rel, () => {
      const file = join(SRC, rel);
      expect(existsSync(file)).toBe(true);
      const src = readFileSync(file, "utf8");
      const culpables: string[] = [];
      for (const m of src.matchAll(TERNARIO)) {
        const rama = m[1]!;
        if (SIMBOLOS_PERMITIDOS.has(rama)) continue;
        // Los eyebrows están exentos por R4: no se leen, se reconocen
        // por su posición. Se nombran, no se cuelan.
        if (rama === "EYEBROW_PX") continue;
        const n = Number(rama);
        if (Number.isNaN(n)) {
          culpables.push(
            `«${rama}» no es un número ni una constante conocida: añádela a ` +
              `SIMBOLOS_PERMITIDOS si es ≥ el suelo, o usa SUELO_LETRA_MANO_PX`,
          );
          continue;
        }
        if (n < SUELO_LETRA_MANO_PX) {
          culpables.push(
            `${n} px en la rama de mano, y el suelo de R4 es ` +
              `${SUELO_LETRA_MANO_PX}. Si no cabe, se enseña menos, no más ` +
              `pequeño.`,
          );
        }
      }
      expect(culpables).toEqual([]);
    });
  }

  it("el suelo es 15 y el eyebrow sigue por debajo a propósito", () => {
    expect(SUELO_LETRA_MANO_PX).toBe(15);
    // Si el eyebrow subiera al suelo, el rótulo del marco de zona
    // dejaría de caber en los 22 px que tiene de hueco flotante. Está
    // exento porque se reconoce, no porque se haya olvidado.
    expect(EYEBROW_PX).toBeLessThan(SUELO_LETRA_MANO_PX);
  });

  it("SABOTAJE · un `deMano ? 13` se caza", () => {
    // El mismo recorrido sobre un fuente de mentira, para que no haya
    // que creerse que el regex funciona.
    const falso = 'style={{ fontSize: deMano ? 13 : 14 }}';
    const encontrados = [...falso.matchAll(TERNARIO)].map((m) =>
      Number(m[1]),
    );
    expect(encontrados).toEqual([13]);
    expect(encontrados[0]).toBeLessThan(SUELO_LETRA_MANO_PX);
  });
});
