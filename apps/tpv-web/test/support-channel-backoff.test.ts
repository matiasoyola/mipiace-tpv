// A5 · Frente 1 · el backoff del canal de soporte, y sobre todo su jitter.
//
// El jitter no es un adorno del backoff: es la mitad del mecanismo. Cuando la
// API se reinicia, los quince terminales pierden el socket EN EL MISMO
// INSTANTE. Sin dispersión, los quince vuelven en el mismo instante, y en la
// ronda siguiente también, y en la siguiente: el backoff exponencial solo
// mantiene el rebaño junto, sólo que cada vez más espaciado.
//
// Por eso hay un test que compara quince terminales entre sí y no uno solo
// consigo mismo. Quitar el jitter deja ese test rojo.

import { describe, expect, it } from "vitest";

import {
  BACKOFF_BASE_MS,
  BACKOFF_MAX_MS,
  backoffDelayMs,
} from "../src/lib/supportChannel/backoff.js";

/** Quince terminales, cada uno con su propio `Math.random()`. */
function esperasDeQuinceTerminales(intento: number): number[] {
  return Array.from({ length: 15 }, (_, i) =>
    // Valores repartidos por [0,1) y distintos entre sí: simula quince
    // terminales sacando cada uno su número.
    backoffDelayMs(intento, () => (i + 0.5) / 15),
  );
}

describe("backoffDelayMs · dispersión", () => {
  it("quince terminales NO reconectan a la vez", () => {
    const esperas = esperasDeQuinceTerminales(3);
    const distintas = new Set(esperas);
    expect(
      distintas.size,
      "sin jitter los quince terminales caen en el mismo milisegundo",
    ).toBeGreaterThan(10);
  });

  it("la dispersión es de verdad, no de un puñado de milisegundos", () => {
    // Con `exp` = 4 s en el intento 3, la ventana aleatoria es de 2 s. Si
    // alguien sustituye el jitter por un ±50 ms «para que quede ordenado»,
    // esto se pone rojo: 50 ms no reparte a quince terminales.
    const esperas = esperasDeQuinceTerminales(3);
    const ancho = Math.max(...esperas) - Math.min(...esperas);
    expect(ancho).toBeGreaterThan(1_000);
  });

  it("la ventana de dispersión crece con los intentos", () => {
    const ancho = (intento: number) => {
      const e = esperasDeQuinceTerminales(intento);
      return Math.max(...e) - Math.min(...e);
    };
    expect(ancho(4)).toBeGreaterThan(ancho(2));
  });
});

describe("backoffDelayMs · crecimiento y techo", () => {
  it("el primer reintento es corto: es soporte, no una venta", () => {
    expect(backoffDelayMs(1, () => 0)).toBe(BACKOFF_BASE_MS / 2);
    expect(backoffDelayMs(1, () => 0.999)).toBeLessThanOrEqual(BACKOFF_BASE_MS);
  });

  it("nunca devuelve 0: un terminal no puede machacar la API en bucle", () => {
    for (let intento = 1; intento <= 30; intento += 1) {
      expect(backoffDelayMs(intento, () => 0)).toBeGreaterThan(0);
    }
  });

  it("crece con los intentos hasta el techo", () => {
    const medio = (n: number) => backoffDelayMs(n, () => 0.5);
    expect(medio(2)).toBeGreaterThan(medio(1));
    expect(medio(5)).toBeGreaterThan(medio(3));
    expect(medio(50)).toBeLessThanOrEqual(BACKOFF_MAX_MS);
  });

  it("un contador que lleva horas subiendo no desborda", () => {
    // 2**1000 es Infinity. El acotado va ANTES de multiplicar precisamente
    // para que un terminal olvidado toda la noche no acabe con un setTimeout
    // de NaN, que en la práctica es «no reintentes nunca más».
    const espera = backoffDelayMs(1_000, () => 0.5);
    expect(Number.isFinite(espera)).toBe(true);
    expect(espera).toBeLessThanOrEqual(BACKOFF_MAX_MS);
  });

  it("un intento absurdo (0, negativo) se trata como el primero", () => {
    expect(backoffDelayMs(0, () => 0.5)).toBe(backoffDelayMs(1, () => 0.5));
    expect(backoffDelayMs(-3, () => 0.5)).toBe(backoffDelayMs(1, () => 0.5));
  });
});
