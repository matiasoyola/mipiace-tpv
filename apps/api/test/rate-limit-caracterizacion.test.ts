// A3-distribución · red de seguridad ANTES de parametrizar auth/rate-limit.ts.
//
// El Frente 3 necesita un limitador por IP para POST /apk con umbrales
// distintos (10 intentos / 10 min → bloqueo de 30 min). Los actuales son
// constantes de módulo: MAX_ATTEMPTS=5, ventana 5 min, candado 15 min. Para
// añadir overrides hay que tocar el fichero por el que pasan TODAS las puertas
// de autenticación del producto:
//
//   - login del OWNER          → auth/routes.ts:133
//   - login del CAJERO         → shift/cashier-auth.ts:51,79,84,90
//   - login del SUPER-ADMIN    → superadmin/auth.ts:64
//   - password reset (petición y confirmación) → auth/password-reset.ts:54,128
//   - verificación 2FA (owner y super-admin)   → auth/routes.ts:695, superadmin/auth.ts:154
//   - throttles sueltos (sync de catálogo, cajeros de un tenant)
//
// Este test NO describe lo que queremos: clava lo que HAY. Si al parametrizar
// cambia un umbral, una ventana o un TTL, esto se pone rojo. Los números están
// escritos a mano a propósito — importar las constantes haría que el test
// siguiera al código en vez de vigilarlo.

import { randomBytes } from "node:crypto";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.REDIS_URL = "redis://localhost:6379";
process.env.JWT_ACCESS_SECRET = "a".repeat(40);
process.env.JWT_REFRESH_SECRET = "b".repeat(40);
process.env.SUPER_ADMIN_JWT_SECRET = "s".repeat(40);
process.env.HOLDED_KEY_ENCRYPTION_SECRET = randomBytes(32).toString("base64");

import { beforeEach, describe, expect, it, vi } from "vitest";

// Fake Redis con contador y TTL reales (mismo patrón que
// super-admin-2fa-throttle.test.ts, que ya avisa de que un `incr → 1` fijo
// nunca dispara el límite y por tanto no prueba nada).
interface Entry {
  value: string;
  expiresAt: number | null;
}
const store = new Map<string, Entry>();

function alive(key: string): Entry | null {
  const e = store.get(key);
  if (!e) return null;
  if (e.expiresAt !== null && e.expiresAt <= Date.now()) {
    store.delete(key);
    return null;
  }
  return e;
}

const fakeRedis = {
  incr: vi.fn(async (key: string) => {
    const e = alive(key);
    const value = e ? Number(e.value) + 1 : 1;
    store.set(key, { value: String(value), expiresAt: e?.expiresAt ?? null });
    return value;
  }),
  get: vi.fn(async (key: string) => alive(key)?.value ?? null),
  set: vi.fn(async (key: string, value: string, _ex: string, seconds: number) => {
    store.set(key, { value, expiresAt: Date.now() + seconds * 1000 });
    return "OK";
  }),
  expire: vi.fn(async (key: string, seconds: number) => {
    const e = alive(key);
    if (!e) return 0;
    e.expiresAt = Date.now() + seconds * 1000;
    return 1;
  }),
  ttl: vi.fn(async (key: string) => {
    const e = alive(key);
    if (!e) return -2;
    if (e.expiresAt === null) return -1;
    return Math.ceil((e.expiresAt - Date.now()) / 1000);
  }),
  del: vi.fn(async (...keys: string[]) => {
    let n = 0;
    for (const k of keys) if (store.delete(k)) n++;
    return n;
  }),
};

vi.mock("../src/context.js", () => ({
  getPrisma: () => ({}),
  getRedis: () => fakeRedis,
  shutdown: async () => undefined,
}));

const {
  inspect,
  registerFailure,
  reset,
  throttle,
  ownerLoginRateLimit,
  cashierLoginRateLimit,
  passwordResetThrottle,
  passwordResetConfirmThrottle,
  twoFactorVerifyThrottle,
} = await import("../src/auth/rate-limit.js");
const { superAdminLoginRateLimit } = await import(
  "../src/superadmin/rate-limit.js"
);

const redis = fakeRedis as unknown as Parameters<typeof inspect>[1];

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
});

describe("caracterización · umbrales del candado de login", () => {
  const cfg = { attemptsKey: "attempts:x", lockKey: "lock:x" };

  it("clave virgen → 5 intentos disponibles y sin candado", async () => {
    await expect(inspect(cfg, redis)).resolves.toEqual({
      locked: false,
      retryAfterSeconds: 0,
      attemptsRemaining: 5,
    });
  });

  it("los 4 primeros fallos NO bloquean y descuentan de 5", async () => {
    const restantes: number[] = [];
    for (let i = 0; i < 4; i++) {
      const state = await registerFailure(cfg, redis);
      expect(state.locked).toBe(false);
      restantes.push(state.attemptsRemaining);
    }
    expect(restantes).toEqual([4, 3, 2, 1]);
  });

  it("el 5º fallo bloquea 15 min (900 s)", async () => {
    for (let i = 0; i < 4; i++) await registerFailure(cfg, redis);
    await expect(registerFailure(cfg, redis)).resolves.toEqual({
      locked: true,
      retryAfterSeconds: 900,
      attemptsRemaining: 0,
    });
  });

  it("una vez bloqueado, inspect lo reporta con el TTL del candado", async () => {
    for (let i = 0; i < 5; i++) await registerFailure(cfg, redis);
    const state = await inspect(cfg, redis);
    expect(state.locked).toBe(true);
    expect(state.attemptsRemaining).toBe(0);
    expect(state.retryAfterSeconds).toBeGreaterThan(890);
    expect(state.retryAfterSeconds).toBeLessThanOrEqual(900);
  });

  it("la ventana de intentos es de 5 min (300 s) y se fija en el PRIMER fallo", async () => {
    await registerFailure(cfg, redis);
    expect(fakeRedis.expire).toHaveBeenCalledWith(cfg.attemptsKey, 300);
    fakeRedis.expire.mockClear();
    await registerFailure(cfg, redis);
    // El segundo fallo NO reabre la ventana: si lo hiciera, un atacante la
    // mantendría viva indefinidamente.
    expect(fakeRedis.expire).not.toHaveBeenCalled();
  });

  it("reset limpia contador y candado a la vez", async () => {
    for (let i = 0; i < 5; i++) await registerFailure(cfg, redis);
    await reset(cfg, redis);
    expect(fakeRedis.del).toHaveBeenCalledWith(cfg.attemptsKey, cfg.lockKey);
    await expect(inspect(cfg, redis)).resolves.toEqual({
      locked: false,
      retryAfterSeconds: 0,
      attemptsRemaining: 5,
    });
  });

  it("cada config es un bucket independiente", async () => {
    const otra = { attemptsKey: "attempts:y", lockKey: "lock:y" };
    for (let i = 0; i < 5; i++) await registerFailure(cfg, redis);
    expect((await inspect(cfg, redis)).locked).toBe(true);
    expect((await inspect(otra, redis)).locked).toBe(false);
  });
});

describe("caracterización · forma de las claves de los 3 logins", () => {
  it("owner: por email, sin IP", () => {
    expect(ownerLoginRateLimit("a@b.es")).toEqual({
      attemptsKey: "owner-login-attempts:a@b.es",
      lockKey: "owner-login-locked:a@b.es",
    });
  });

  it("cajero: por tenant + usuario", () => {
    expect(cashierLoginRateLimit("t1", "u1")).toEqual({
      attemptsKey: "cashier-login-attempts:t1:u1",
      lockKey: "cashier-login-locked:t1:u1",
    });
  });

  it("super-admin: por email + IP", () => {
    expect(superAdminLoginRateLimit("a@b.es", "1.2.3.4")).toEqual({
      attemptsKey: "super-admin-login-attempts:a@b.es:1.2.3.4",
      lockKey: "super-admin-login-locked:a@b.es:1.2.3.4",
    });
  });
});

describe("caracterización · throttles con ventana móvil", () => {
  it("throttle genérico: excede en la llamada N+1, no en la N", async () => {
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await throttle("k", 3, 60, redis));
    expect(results.map((r) => r.exceeded)).toEqual([false, false, false, true]);
    expect(results.map((r) => r.count)).toEqual([1, 2, 3, 4]);
  });

  it("throttle: la ventana se fija en la primera llamada", async () => {
    await throttle("k", 3, 60, redis);
    expect(fakeRedis.expire).toHaveBeenCalledWith("k", 60);
    fakeRedis.expire.mockClear();
    await throttle("k", 3, 60, redis);
    expect(fakeRedis.expire).not.toHaveBeenCalled();
  });

  it("password reset (petición): 5 por email en 5 min", async () => {
    for (let i = 0; i < 5; i++) {
      expect((await passwordResetThrottle("a@b.es", redis)).exceeded).toBe(false);
    }
    expect((await passwordResetThrottle("a@b.es", redis)).exceeded).toBe(true);
    expect(fakeRedis.expire).toHaveBeenCalledWith("pwd-reset-req:a@b.es", 300);
  });

  it("password reset (confirmación): 10 por IP en 15 min", async () => {
    for (let i = 0; i < 10; i++) {
      expect(
        (await passwordResetConfirmThrottle("1.2.3.4", redis)).exceeded,
      ).toBe(false);
    }
    expect((await passwordResetConfirmThrottle("1.2.3.4", redis)).exceeded).toBe(
      true,
    );
    expect(fakeRedis.expire).toHaveBeenCalledWith("pwd-reset-confirm:1.2.3.4", 900);
  });

  it("2FA: 5 por cuenta en 15 min, y owner/super-admin no comparten bucket", async () => {
    for (let i = 0; i < 5; i++) {
      expect((await twoFactorVerifyThrottle("owner", "sub-1", redis)).exceeded).toBe(
        false,
      );
    }
    expect((await twoFactorVerifyThrottle("owner", "sub-1", redis)).exceeded).toBe(
      true,
    );
    // Mismo sub, otro scope → contador limpio.
    expect(
      (await twoFactorVerifyThrottle("super-admin", "sub-1", redis)).exceeded,
    ).toBe(false);
    expect(fakeRedis.expire).toHaveBeenCalledWith("2fa-verify:owner:sub-1", 900);
  });
});
