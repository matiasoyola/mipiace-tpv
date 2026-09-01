// A3-distribución · límite de intentos de POST /apk por IP.
//
// Seis dígitos son un millón de combinaciones y el endpoint es PÚBLICO: sin
// esto, un script prueba el espacio entero. Con 10 intentos cada 10 minutos,
// agotar un millón de códigos lleva casi dos años por IP.
//
// Umbrales distintos a los del login (5 / 5 min / 15 min) a propósito: el
// instalador teclea mal con prisa en un bar, y bloquearle 15 minutos a la
// tercera es peor negocio que darle diez intentos. De ahí los overrides que
// A3 añadió a auth/rate-limit.ts.
//
// Los intentos fallidos cuentan AUNQUE EL CÓDIGO NO EXISTA: si sólo contaran
// los códigos reales, probar el millón saldría gratis.

import type { RateLimitConfig } from "../auth/rate-limit.js";

export const APK_MAX_ATTEMPTS = 10;
export const APK_ATTEMPT_WINDOW_SECONDS = 10 * 60;
export const APK_LOCK_SECONDS = 30 * 60;

export const apkDownloadRateLimit = (ip: string): RateLimitConfig => ({
  attemptsKey: `apk-download-attempts:${ip}`,
  lockKey: `apk-download-locked:${ip}`,
  maxAttempts: APK_MAX_ATTEMPTS,
  attemptTtlSeconds: APK_ATTEMPT_WINDOW_SECONDS,
  lockTtlSeconds: APK_LOCK_SECONDS,
});
