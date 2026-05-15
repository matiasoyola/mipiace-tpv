import type { RateLimitConfig } from "../auth/rate-limit.js";

// Rate limit para login super-admin (5 intentos / 15 min). Reutiliza el
// helper `inspect`/`registerFailure`/`reset` de `../auth/rate-limit.js`
// con keys diferenciadas.
export const superAdminLoginRateLimit = (
  email: string,
  ip: string,
): RateLimitConfig => ({
  attemptsKey: `super-admin-login-attempts:${email}:${ip}`,
  lockKey: `super-admin-login-locked:${email}:${ip}`,
});
