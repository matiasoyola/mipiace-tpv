// El importe de una mesa ocupada no se corta nunca.
//
// Hallazgo del hierro (AP13, 07-10-2026 22:08): en la tarjeta de M2 el
// «37,30 €» salía cortado por la derecha, compartiendo fila con el
// camarero «m.oyola+mae…». Medido con PIL sobre la captura del propio
// terminal a 1443 × 812: el borde derecho de la tarjeta caía en x=1006
// (físicos) y la tinta del importe llegaba a x=1031 — 25 px físicos,
// 19 px CSS, de dinero fuera de la tarjeta. Lo mismo en M2 (26 px).
//
// Este fichero fija la aritmética del arreglo con el importe más largo
// que la mesa tiene que aguantar.
//
// v2-H1-venta-y-sala · la mesa pasa a ser una FORMA de 144 px —cuadrada,
// con el radio cambiando por zona (decisión 8)— y eso cambia la cuenta
// en dos sitios, los dos a peor, así que se mide de nuevo en vez de
// heredar el verde:
//
//   1. **El importe sube de 19 px a 22** (escala TPV, `tokens.md` §3.1),
//      así que ocupa un 16 % más de ancho.
//   2. **En una mesa REDONDA el ancho útil no es el lado, es la
//      cuerda.** A la altura del importe —20 px por debajo del centro,
//      con el nombre encima— un círculo de 144 deja 138,3 px, no 144.
//      Medir contra el lado daría «cabe» a un importe que el círculo
//      recorta por los lados, que es justo la clase de error que este
//      fichero existe para no repetir.
//
// El caso de la mesa rectangular (Salón, Reservados) sale cubierto por
// construcción: su ancho útil es el lado entero, que es MAYOR que la
// cuerda, así que si entra en el círculo entra en el rectángulo.
//
// Lo que ya no aplica: `handheldCardWidth` y los 153 px de tarjeta del
// handheld de v1.23. La mesa mide 144 en handheld igual que en el
// terminal —el tamaño dejó de depender de la celda— así que hay un solo
// ancho que comprobar, no dos.

import { describe, expect, it } from "vitest";

import { formatEur } from "../src/lib/money.js";
import {
  LONGEST_TABLE_AMOUNT,
  TABLE_AMOUNT_CHAR_WIDTH,
  TABLE_AMOUNT_FONT_PX,
  TABLE_AMOUNT_FONT_PX_DARK,
  TABLE_AMOUNT_OFFSET_DARK,
  TABLE_SHAPE_SIZE,
  roundTableAmountFits,
  roundTableChordWidth,
} from "../src/lib/roomGrid.js";

/** Ancho que ocupa un importe pintado a 22 px, en px. */
function anchoDelImporte(amount: string): number {
  const porCaracter =
    (TABLE_AMOUNT_CHAR_WIDTH * TABLE_AMOUNT_FONT_PX_DARK) /
    TABLE_AMOUNT_FONT_PX;
  return amount.length * porCaracter;
}

describe("El importe de la mesa cabe en la forma", () => {
  it("la mesa mide 144 en todas las pantallas", () => {
    // Si esto cambia, los números de abajo dejan de ser los del bucle
    // visual y hay que volver a medir, no ajustar el umbral.
    expect(TABLE_SHAPE_SIZE).toBe(144);
  });

  it("el importe más largo es el que de verdad pinta formatEur", () => {
    // Si el formateador empieza a separar millares, el importe gana un
    // carácter y esta medida se queda corta. Que salte aquí.
    expect(formatEur(1234.5)).toBe(LONGEST_TABLE_AMOUNT);
  });

  it("el ancho útil de una mesa REDONDA es la cuerda, no el lado", () => {
    // El error que esta función evita: en el centro el círculo vale el
    // diámetro, pero el importe no va en el centro —va debajo del
    // nombre— y ahí vale menos.
    expect(roundTableChordWidth(0)).toBe(TABLE_SHAPE_SIZE);
    expect(roundTableChordWidth(TABLE_AMOUNT_OFFSET_DARK)).toBeLessThan(
      TABLE_SHAPE_SIZE,
    );
    expect(roundTableChordWidth(TABLE_AMOUNT_OFFSET_DARK)).toBeCloseTo(
      138.3,
      1,
    );
  });

  it("el importe más largo cabe entero en la mesa redonda", () => {
    expect(roundTableAmountFits(LONGEST_TABLE_AMOUNT)).toBe(true);
  });

  it("el importe del hallazgo (37,30 €) cabe de sobra", () => {
    expect(roundTableAmountFits("37,30 €")).toBe(true);
  });

  it("queda margen, no cabe por los pelos", () => {
    // Si el margen se comiera entero, el siguiente retoque tipográfico
    // volvería a sacar el dinero de la forma sin que nadie se entere.
    const holgura =
      roundTableChordWidth(TABLE_AMOUNT_OFFSET_DARK) -
      anchoDelImporte(LONGEST_TABLE_AMOUNT);
    expect(holgura).toBeGreaterThanOrEqual(5);
  });

  it("un importe absurdo NO cabe: la función mide, no dice que sí siempre", () => {
    // El contrapunto del test anterior. Sin esto, un `return true`
    // pasaría todo lo de arriba.
    expect(roundTableAmountFits("1.234.567,89 €")).toBe(false);
  });

  it("subir el importe de 22 px sin tocar nada más lo sacaría de la forma", () => {
    // La escala TPV sube el importe de 19 a 22 px y eso ya cuesta un
    // 16 % de ancho. El siguiente peldaño no cabe, y es mejor que lo
    // diga un test que una captura.
    expect(roundTableAmountFits(LONGEST_TABLE_AMOUNT, TABLE_SHAPE_SIZE, 28)).toBe(
      false,
    );
  });

  it("encoger la mesa recorta el dinero, que es el dato que se comprueba", () => {
    expect(roundTableAmountFits(LONGEST_TABLE_AMOUNT, 120)).toBe(false);
  });

  it("el ancho por carácter no subestima el dígito tabular del D8", () => {
    // Medido sobre la captura: ~11,4 px por dígito a 19 px / 700. La
    // calibración se queda en 19 y se escala, porque es la misma fuente
    // con `tabular-nums` y el ancho por carácter es lineal con el
    // tamaño.
    expect(TABLE_AMOUNT_CHAR_WIDTH).toBeGreaterThanOrEqual(11.4);
    expect(TABLE_AMOUNT_FONT_PX).toBe(19);
    expect(TABLE_AMOUNT_FONT_PX_DARK).toBe(22);
  });
});
