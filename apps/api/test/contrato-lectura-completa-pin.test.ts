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
// ── pin-1 · LA MISMA INVARIANTE, POR OTRO CAMINO ────────────────────
//
// El login ya NO genera ningún PIN para nadie, con caja o sin ella: el
// bloque pin-1 se llevó esa rama entera (el PIN lo elige la persona). Lo
// que este fichero guardaba del login pasa a ser más fuerte y más fácil
// de decir — **no hay camino que le genere un PIN a nadie**, así que
// tampoco a la directora de Jardín de Gredos.
//
// Y las rutas que ESCRIBEN un PIN del TPV siguen gateadas por la caja,
// que es la otra mitad de lo que el punto 6 cerró. Ahora son tres:
// cambiar el mío, elegirlo sin el actual, y el regenerar de soporte.
//
// Sabotajes que este fichero pone en rojo:
//   · que el login vuelva a generar un PIN (vuelve la pantalla del PIN a
//     la directora);
//   · quitar el gate de caja de `/auth/me/pin`, de `/auth/me/pin/elegir`
//     o de `regenerate-owner-pin` (una cuenta sin TPV teniendo rutas que
//     le ponen un PIN de TPV);
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
// pin-1 · «Regenerar PIN» sólo corre desde una sesión de soporte, que va
// firmada con el secreto del super-admin.
process.env.SUPER_ADMIN_JWT_SECRET = "s".repeat(40);

import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";

const TENANT = "00000000-0000-0000-0000-000000000001";
const DUENA = "11111111-1111-1111-1111-111111111111";
const EMAIL = "carmen@jardindegredos.es";
const PASSWORD = "jardindegredos2026";
const SUPER_ADMIN = "99999999-9999-9999-9999-999999999999";

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
  // pin-1 · el registro del punto 7 va en la misma transacción que el
  // PIN, así que el falso tiene que saber escribirlo o ninguna ruta de
  // PIN llega al final.
  pinChange: { create: vi.fn(async () => ({ id: "pc" })) },
  // Cada mutación en modo «Configurar como OWNER» deja su línea de
  // `impersonate_write` ANTES de ejecutarse, y falla cerrado: sin esto,
  // la ruta de soporte contesta 500 en vez de lo que se está midiendo.
  superAdminAudit: { create: vi.fn(async () => ({ id: "a" })) },
  $transaction: vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
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
const { signImpersonationToken } = await import("../src/superadmin/tokens.js");

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

describe("el PIN al primer login", () => {
  it("una cuenta SIN CAJA no recibe PIN ni la pantalla que lo enseña", async () => {
    cajaEnabled = false;
    const res = await entrar();
    expect(res.statusCode).toBe(200);
    // Sin `ownerPinGenerated` en la respuesta, el panel no pinta la
    // pantalla «Tu PIN de respaldo»: es lo único que la disparaba.
    expect(res.json().ownerPinGenerated).toBeUndefined();
    // Y no se ha generado NADA: tampoco un PIN guardado y no enseñado.
    expect(pinHash).toBeNull();
    // La sesión sí: no tener caja no es no poder entrar.
    expect(typeof res.json().accessToken).toBe("string");
  });

  // pin-1 · y ahora TAMPOCO CON CAJA. Es el sabotaje principal del punto
  // 4: si alguien devuelve la rama de auto-generar al login, la
  // propietaria vuelve a recibir cuatro cifras al azar que sólo se
  // enseñan una vez — que es lo que el bloque viene a quitar.
  it("una cuenta CON caja TAMPOCO: el login no genera PIN para nadie", async () => {
    const res = await entrar();
    expect(res.statusCode).toBe(200);
    expect(res.json().ownerPinGenerated).toBeUndefined();
    expect(pinHash).toBeNull();
    expect(typeof res.json().accessToken).toBe("string");
  });

  it("y si la fila del tenant no se puede leer, tampoco", async () => {
    cajaEnabled = null;
    const res = await entrar();
    expect(res.json().ownerPinGenerated).toBeUndefined();
    expect(pinHash).toBeNull();
  });

  it("quien ya tiene PIN se queda con el suyo, intacto", async () => {
    pinHash = "ya-tengo-uno";
    const res = await entrar();
    expect(res.json().ownerPinGenerated).toBeUndefined();
    expect(pinHash).toBe("ya-tengo-uno");
  });
});

// ── 2 · LAS RUTAS QUE ESCRIBEN UN PIN DEL TPV ───────────────────────
//
// Las tres llevan el gate de la caja, y las tres por lo mismo: una
// cuenta sin TPV no puede tener una ruta que le ponga un PIN de TPV.
// Esconder el botón en el panel no cierra la ruta.

describe("elegir el PIN (la propietaria, sin el actual)", () => {
  it("una cuenta SIN CAJA recibe 403 y no se escribe nada", async () => {
    cajaEnabled = false;
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/auth/me/pin/elegir",
      headers: comoDuena,
      payload: { newPin: "9473" },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("CAJA_DISABLED");
    expect(pinHash).toBeNull();
    await app.close();
  });

  it("y una CON caja deja puesto el PIN que la dueña teclea", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/auth/me/pin/elegir",
      headers: comoDuena,
      payload: { newPin: "9473" },
    });
    expect(res.statusCode).toBe(200);
    expect(pinHash).not.toBeNull();
    // Y el PIN NO vuelve en la respuesta: lo tecleó ella, ya lo sabe.
    expect(res.json().pin).toBeUndefined();
    await app.close();
  });

  it("con la columna ilegible también: falla hacia ENCENDIDO", async () => {
    cajaEnabled = null;
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/auth/me/pin/elegir",
      headers: comoDuena,
      payload: { newPin: "9473" },
    });
    expect(res.statusCode).toBe(200);
    await app.close();
  });
});

describe("cambiar mi PIN (con el actual)", () => {
  it("una cuenta SIN CAJA recibe 403 y no se escribe nada", async () => {
    cajaEnabled = false;
    pinHash = await hashPassword("9473");
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/auth/me/pin",
      headers: comoDuena,
      payload: { currentPin: "9473", newPin: "5061" },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("CAJA_DISABLED");
    await app.close();
  });
});

describe("regenerar el PIN (el último recurso de soporte)", () => {
  // pin-1 (punto 5) · la ruta se queda, pero SÓLO desde una sesión de
  // «Configurar como OWNER». Una dueña de verdad tiene «Elegir PIN».
  const comoSoporte = {
    authorization: `Bearer ${signImpersonationToken({
      sub: DUENA,
      tid: TENANT,
      tv: 0,
      by: SUPER_ADMIN,
      mode: "full",
    })}`,
  };

  it("una cuenta SIN CAJA recibe 403 y no se escribe nada", async () => {
    cajaEnabled = false;
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/auth/me/regenerate-owner-pin",
      headers: comoSoporte,
      payload: {},
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("CAJA_DISABLED");
    expect(pinHash).toBeNull();
    await app.close();
  });

  it("y una CON caja lo regenera, dejándolo PROVISIONAL", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/auth/me/regenerate-owner-pin",
      headers: comoSoporte,
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().pin).toMatch(/^\d{4}$/);
    expect(res.json().provisional).toBe(true);
    expect(pinHash).not.toBeNull();
    await app.close();
  });
});
