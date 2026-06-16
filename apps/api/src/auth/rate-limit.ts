import { Redis } from "ioredis";

import { getRedis } from "../context.js";

// Rate-limiting de logins (§17.1) y throttle de password reset (§17.6).
//
// Patrón "5 intentos en 5 min → bloqueo de 15 min con candado separado":
//   - inspect: lee estado sin tocar nada (devuelve si está bloqueado).
//   - registerFailure: incrementa contador, activa candado al cruzar umbral.
//   - reset: limpia contador y candado al lograr autenticación.
//
// Patrón "throttle puro" para password reset (ventana móvil, sin candado):
//   - throttle: incrementa y devuelve si superó el límite.

const ATTEMPT_TTL_SECONDS = 5 * 60;
const LOCK_TTL_SECONDS = 15 * 60;
const MAX_ATTEMPTS = 5;
const PWD_RESET_TTL_SECONDS = 5 * 60;
const PWD_RESET_MAX = 5;
// v1.5-D · Frente 3: throttle de los endpoints de CONFIRMACIÓN (consumo
// de token / verificación de código), no sólo de solicitud. Sin esto, el
// token de reset y el código 2FA de 6 dígitos son fuerza-bruteables
// dentro de la ventana de validez.
const PWD_RESET_CONFIRM_TTL_SECONDS = 15 * 60;
const PWD_RESET_CONFIRM_MAX = 10;
const TWO_FA_VERIFY_TTL_SECONDS = 15 * 60;
const TWO_FA_VERIFY_MAX = 5;

export interface RateLimitConfig {
  attemptsKey: string;
  lockKey: string;
}

export interface RateLimitState {
  locked: boolean;
  retryAfterSeconds: number;
  attemptsRemaining: number;
}

export async function inspect(
  config: RateLimitConfig,
  redis: Redis = getRedis(),
): Promise<RateLimitState> {
  const lockTtl = await redis.ttl(config.lockKey);
  if (lockTtl > 0) {
    return { locked: true, retryAfterSeconds: lockTtl, attemptsRemaining: 0 };
  }
  const attempts = Number((await redis.get(config.attemptsKey)) ?? "0");
  return {
    locked: false,
    retryAfterSeconds: 0,
    attemptsRemaining: Math.max(0, MAX_ATTEMPTS - attempts),
  };
}

export async function registerFailure(
  config: RateLimitConfig,
  redis: Redis = getRedis(),
): Promise<RateLimitState> {
  const attempts = await redis.incr(config.attemptsKey);
  if (attempts === 1) {
    await redis.expire(config.attemptsKey, ATTEMPT_TTL_SECONDS);
  }
  if (attempts >= MAX_ATTEMPTS) {
    await redis.set(config.lockKey, "1", "EX", LOCK_TTL_SECONDS);
    return {
      locked: true,
      retryAfterSeconds: LOCK_TTL_SECONDS,
      attemptsRemaining: 0,
    };
  }
  return {
    locked: false,
    retryAfterSeconds: 0,
    attemptsRemaining: MAX_ATTEMPTS - attempts,
  };
}

export async function reset(
  config: RateLimitConfig,
  redis: Redis = getRedis(),
): Promise<void> {
  await redis.del(config.attemptsKey, config.lockKey);
}

export interface ThrottleState {
  exceeded: boolean;
  count: number;
  retryAfterSeconds: number;
}

// Throttle puro por contador en ventana. Devuelve `exceeded: true`
// cuando la N+1-ésima llamada cae en la misma ventana, y `retryAfterSeconds`
// con el TTL restante de la clave.
export async function throttle(
  key: string,
  limit: number,
  windowSeconds: number,
  redis: Redis = getRedis(),
): Promise<ThrottleState> {
  const count = await redis.incr(key);
  if (count === 1) {
    await redis.expire(key, windowSeconds);
  }
  const ttl = await redis.ttl(key);
  return {
    exceeded: count > limit,
    count,
    retryAfterSeconds: ttl > 0 ? ttl : 0,
  };
}

export const ownerLoginRateLimit = (email: string): RateLimitConfig => ({
  attemptsKey: `owner-login-attempts:${email}`,
  lockKey: `owner-login-locked:${email}`,
});

export const cashierLoginRateLimit = (
  tenantId: string,
  userId: string,
): RateLimitConfig => ({
  attemptsKey: `cashier-login-attempts:${tenantId}:${userId}`,
  lockKey: `cashier-login-locked:${tenantId}:${userId}`,
});

export async function passwordResetThrottle(
  email: string,
  redis: Redis = getRedis(),
): Promise<ThrottleState> {
  return throttle(`pwd-reset-req:${email}`, PWD_RESET_MAX, PWD_RESET_TTL_SECONDS, redis);
}

// Throttle del consumo de token de password-reset. La clave es SÓLO la IP
// (`request.ip`, que con `trustProxy: 1` en el server es el salto real que
// añade Caddy, no falsificable por el primer token de X-Forwarded-For). El
// email no se conoce hasta validar el token, y meter un prefijo del token
// en la clave la haría inútil (cada intento lleva un token distinto →
// bucket distinto). El token es de 256 bits (no adivinable), así que aquí
// el throttle sólo acota el coste del argon2 por token.
export async function passwordResetConfirmThrottle(
  ip: string,
  redis: Redis = getRedis(),
): Promise<ThrottleState> {
  return throttle(
    `pwd-reset-confirm:${ip}`,
    PWD_RESET_CONFIRM_MAX,
    PWD_RESET_CONFIRM_TTL_SECONDS,
    redis,
  );
}

// Throttle de la verificación de código 2FA en el login (segundo paso).
// Clave por (scope, sub) — SIN IP a propósito: el objetivo es acotar la
// fuerza bruta del código de 6 dígitos contra una cuenta concreta
// independientemente de la IP de origen (un atacante con IPs rotativas no
// debe conseguir buckets infinitos). `sub` es estable para la víctima;
// `scope` separa owner de super-admin. Riesgo asumido: alguien puede
// quemar los 5 intentos de una víctima (bloqueo 15 min, sólo el paso 2FA;
// el dueño legítimo acierta a la primera).
export async function twoFactorVerifyThrottle(
  scope: "owner" | "super-admin",
  sub: string,
  redis: Redis = getRedis(),
): Promise<ThrottleState> {
  return throttle(
    `2fa-verify:${scope}:${sub}`,
    TWO_FA_VERIFY_MAX,
    TWO_FA_VERIFY_TTL_SECONDS,
    redis,
  );
}
