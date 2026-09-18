// A5 · cuánto espera un terminal antes de reintentar el canal de soporte.
//
// Quince terminales reintentando a la vez contra una API que acaba de
// reiniciarse es un ataque a nosotros mismos: todos pierden el socket en el
// mismo instante (el proceso murió), así que sin dispersión todos vuelven en el
// mismo instante, y en cada ronda siguiente también. El backoff exponencial
// solo NO lo arregla — mantiene el rebaño junto, sólo que cada vez más
// espaciado.
//
// La dispersión la da el jitter, y es la mitad del mecanismo, no un adorno.
// Usamos «equal jitter» (AWS Architecture Blog): mitad fija, mitad aleatoria.
//
//   espera = exp/2 + random()*exp/2
//
// La mitad fija garantiza que la espera crece de verdad con los intentos (con
// jitter completo un terminal puede sacar 0 diez veces seguidas y machacar);
// la mitad aleatoria reparte a los quince por una ventana que crece con ellos.
//
// El reintento NO se rinde nunca: un terminal apagado toda la noche tiene que
// volver solo por la mañana sin que nadie toque nada. Lo que se acota es el
// intervalo máximo, no el número de intentos.

/** Primer intento: ~0,5–1 s. Es un canal de soporte, no hay prisa. */
export const BACKOFF_BASE_MS = 1_000;

/** Techo del intervalo. Un terminal caído reaparece como mucho un minuto tarde. */
export const BACKOFF_MAX_MS = 60_000;

/**
 * Espera antes del intento número `attempt` (1 = primer reintento tras caer).
 *
 * `random` es parámetro para poder probarlo: la dispersión es justo lo que hay
 * que verificar, y con `Math.random()` incrustado no se puede afirmar nada.
 */
export function backoffDelayMs(
  attempt: number,
  random: () => number = Math.random,
): number {
  const n = Math.max(1, Math.floor(attempt));
  // 2**n crece rápido; se acota ANTES de multiplicar para no pasar por
  // Infinity con un contador que lleve horas subiendo.
  const exponent = Math.min(n - 1, 20);
  const exp = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** exponent);
  const half = exp / 2;
  return Math.round(half + random() * half);
}
