// contrato-lectura-completa (punto 6) · **SIN CAJA NO HAY PIN DE RESPALDO.**
//
// Lo encontró el primer acceso real de una residencia, el 24-10-2026: a la
// directora de Jardín de Gredos, al entrar por primera vez, la primera
// pantalla del programa le dijo «te hemos asignado un PIN de respaldo de 4
// dígitos… lo usarás para autorizar descuentos o cierres con incidencia
// desde el TPV» — en una cuenta sin caja, sin TPV y que no lo va a tener.
//
// El panel ya escondía la sección de «Mi cuenta» con `cajaEnabled` desde
// H1, y `activate` ya no lo generaba. Lo que quedaba suelto eran las dos
// rutas: el LOGIN (que es por donde entra todo el mundo el primer día) y
// la de regenerarlo. Esconder no es gatear.
//
// Sabotajes que este fichero pone en rojo:
//   · quitar el gate del login (vuelve la pantalla del PIN a la
//     directora);
//   · quitar el gate de `regenerate-owner-pin` (una cuenta sin TPV sigue
//     teniendo una ruta que le genera un PIN de TPV);
//   · gatear con `!tenant.cajaEnabled` en vez de `=== false` (dejaría sin
//     PIN a las cuentas donde la columna no se puede leer, que es la
//     dirección de fallo equivocada: ver la cabecera de `caja-gate.ts`).

import { randomBytes } from "node:crypto";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.REDIS_URL = "redis://localhost:6379";
process.env.JWT_ACCESS_SECRET = "a".repeat(40);
process.env.JWT_REFRESH_SECRET = "b".repeat(40);
process.env.HOLDED_KEY_ENCRYPTION_SECRET = randomBytes(32).toString("base64");

import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";

const TENANT = "00000000-0000-0000-0000-000000000001";
const DUENA = "11111111-1111-1111-1111-111111111111";
const EMAIL = "carmen@jardindegredos.es";
const PASSWORD = "jardindegredos2026";

/** `null` = la columna no se puede leer (el caso que tiene que fallar
 *  hacia ENCENDIDO). */
let cajaEnabled: boolean | null = true;
let pinHash: string | null = null;

const fakePrisma: any = {
  user: {
    findUnique: vi.fn(async ({ where }: any) => {
      if (where.email != null && where.email !== EMAIL) return null;
      if (where.id != null && where.id !== DUENA) return null;
      return {
        id: DUENA,
        tenantId: TENANT,
        email: EMAIL,
        passwordHash: await hashPassword(PASSWORD),
        role: "OWNER",
        tokenVersion: 0,
        pinHash,
        mustChangePasswordAt: null,
        twoFactorEnabledAt: null,
      };
    }),
    update: vi.fn(async ({ data }: any) => {
      if (data.pinHash != null) pinHash = data.pinHash;
      return { id: DUENA, tenantId: TENANT, role: "OWNER", tokenVersion: 0 };
    }),
  },
  tenant: {
    findUnique: vi.fn(async () =>
      cajaEnabled == null ? null : { cajaEnabled },
    ),
  },
};

const redisStore = new Map<string, { value: string; expiresAt: number }>();
const fakeRedis = {
  ping: async () => "PONG",
  incr: vi.fn(async (key: string) => {
    const e = redisStore.get(key);
    const fresco = !e || e.expiresAt <= Date.now();
    const valor = fresco ? 1 : Number(e!.value) + 1;
    redisStore.set(key, {
      value: String(valor),
      expiresAt: e?.expiresAt ?? Date.now() + 86_400_000,
    });
    return valor;
  }),
  expire: vi.fn(async () => 1),
  ttl: vi.fn(async () => -2),
  set: vi.fn(async () => "OK"),
  get: vi.fn(async () => null),
  del: vi.fn(async () => 0),
};

vi.mock("../src/context.js", () => ({
  getPrisma: () => fakePrisma,
  getRedis: () => fakeRedis,
  shutdown: async () => undefined,
}));

const { registerAuthRoutes } = await import("../src/auth/routes.js");
const { hashPassword } = await import("../src/auth/passwords.js");
const { signAccessToken } = await import("../src/auth/tokens.js");

const comoDuena = {
  authorization: `Bearer ${signAccessToken({
    sub: DUENA,
    tid: TENANT,
    role: "OWNER",
  })}`,
};

async function buildApp() {
  const app = Fastify();
  await registerAuthRoutes(app);
  await app.ready();
  return app;
}

beforeEach(() => {
  cajaEnabled = true;
  pinHash = null;
  redisStore.clear();
});

async function entrar() {
  const app = await buildApp();
  const res = await app.inject({
    method: "POST",
    url: "/auth/login",
    payload: { email: EMAIL, password: PASSWORD },
  });
  await app.close();
  return res;
}

// ── 1 · EL LOGIN ────────────────────────────────────────────────────

describe("el PIN de respaldo al primer login", () => {
  it("una cuenta SIN CAJA no recibe PIN ni la pantalla que lo enseña", async () => {
    cajaEnabled = false;
    const res = await entrar();
    expect(res.statusCode).toBe(200);
    // Sin `ownerPinGenerated` en la respuesta, el panel no pinta la
    // pantalla «Tu PIN de respaldo»: es lo único que la dispara.
    expect(res.json().ownerPinGenerated).toBeUndefined();
    // Y no se ha generado NADA: tampoco un PIN guardado y no enseñado.
    expect(pinHash).toBeNull();
    // La sesión sí: no tener caja no es no poder entrar.
    expect(typeof res.json().accessToken).toBe("string");
  });

  it("una cuenta CON caja lo sigue recibiendo, igual que antes", async () => {
    const res = await entrar();
    expect(res.statusCode).toBe(200);
    expect(res.json().ownerPinGenerated).toMatch(/^\d{4}$/);
    expect(pinHash).not.toBeNull();
  });

  it("y si la fila del tenant no se puede leer, también: falla hacia ENCENDIDO", async () => {
    // La otra cara de la nota 2 de `caja-gate.ts`. Una capability que no
    // se puede leer deja el comportamiento de master; fallar hacia
    // «apagado» dejaría sin PIN a una dueña que cobra, y el PIN es lo que
    // autoriza un descuento con la clienta delante.
    cajaEnabled = null;
    const res = await entrar();
    expect(res.json().ownerPinGenerated).toMatch(/^\d{4}$/);
  });

  it("quien ya tiene PIN no recibe otro (el caso de siempre)", async () => {
    pinHash = "ya-tengo-uno";
    const res = await entrar();
    expect(res.json().ownerPinGenerated).toBeUndefined();
    expect(pinHash).toBe("ya-tengo-uno");
  });
});

// ── 2 · REGENERARLO ─────────────────────────────────────────────────

describe("regenerar el PIN de respaldo", () => {
  it("una cuenta SIN CAJA recibe 403 y no se escribe nada", async () => {
    cajaEnabled = false;
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/auth/me/regenerate-owner-pin",
      headers: comoDuena,
      payload: {},
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("CAJA_DISABLED");
    expect(pinHash).toBeNull();
    await app.close();
  });

  it("y una CON caja lo regenera, igual que antes", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/auth/me/regenerate-owner-pin",
      headers: comoDuena,
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().pin).toMatch(/^\d{4}$/);
    expect(pinHash).not.toBeNull();
    await app.close();
  });
});
