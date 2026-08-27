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

// Bloque soporte-cajeros-superadmin · throttle de LECTURA de la lista
// de cajeros de un tenant. Hasta este bloque el super-admin no tenía
// rate-limit en ninguna ruta de lectura — sólo en el login. La clave es
// por super-admin y no por (super-admin, tenant) a propósito: lo que
// queremos topar es que alguien con un token válido barra la base de
// cajeros de todos los clientes, no que soporte refresque la ficha de
// uno mientras habla por teléfono.
export const superAdminCashierReadThrottleKey = (superAdminId: string): string =>
  `super-admin-cashier-read:${superAdminId}`;
