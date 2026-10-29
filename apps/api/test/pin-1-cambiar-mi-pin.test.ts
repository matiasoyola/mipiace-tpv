// pin-1 (puntos 1 y 6) · CAMBIAR MI PIN.
//
// Un endpoint, `POST /auth/me/pin`, y las dos puertas por las que se
// llega: la sesión del PANEL (access token de la propietaria o del
// encargado) y la sesión de CAJERO del TPV. Es el mismo acto, así que
// es el mismo sitio.
//
// Lo que este fichero fija:
//
//   1. **El PIN actual es obligatorio** y se comprueba de verdad. Sin
//      esto, cualquiera con una sesión abierta —un terminal que se queda
//      desbloqueado en la barra— se queda con la credencial.
//   2. **Un PIN trivial se rechaza**, y el 400 dice por qué.
//   3. **El bloqueo cuenta los fallos del PIN actual**, y en el MISMO
//      cubo que el login del TPV. Si fueran dos cubos, adivinar el PIN
//      desde aquí saldría gratis mientras el login se queda bloqueado.
//   4. **Un cajero no puede cambiar el PIN de otro.** La ruta no tiene
//      `:userId`: escribe siempre sobre el usuario de la sesión. Y la
//      que sí lo tiene (`PATCH /cashiers/:id/pin`) no acepta una sesión
//      de cajero.
//   5. **El cambio queda registrado** (punto 7), sin el PIN, en la misma
//      transacción que lo escribe.
//
// Sabotajes que pone en rojo (ver la tabla del `-done`):
//   · quitar el `verifyPassword(user.pinHash, currentPin)`;
//   · quitar el `motivoPinTrivial` de la ruta;
//   · usar un cubo de rate-limit distinto del login del TPV;
//   · no llamar a `registerFailure` cuando el PIN actual falla;
//   · meter un `:userId` en la ruta y escribir sobre él;
//   · sacar el `pinChange.create` de la transacción.

import { randomBytes, randomUUID } from "node:crypto";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.REDIS_URL = "redis://localhost:6379";
process.env.JWT_ACCESS_SECRET = "a".repeat(40);
process.env.JWT_REFRESH_SECRET = "b".repeat(40);
process.env.HOLDED_KEY_ENCRYPTION_SECRET = randomBytes(32).toString("base64");

import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";

const TENANT = "11111111-1111-1111-1111-111111111111";
const DUENA = "22222222-2222-2222-2222-222222222222";
const CAJERA = "33333333-3333-3333-3333-333333333333";
const OTRA = "44444444-4444-4444-4444-444444444444";
const DEVICE = "55555555-5555-5555-5555-555555555555";
const REGISTER = "66666666-6666-6666-6666-666666666666";

interface Fila {
  id: string;
  tenantId: string;
  email: string;
  role: "OWNER" | "MANAGER" | "CASHIER" | "CLINICIAN";
  pinHash: string | null;
  pinProvisionalAt: Date | null;
}

const filas = new Map<string, Fila>();
/** Lo que se escribió en `pin_changes`. */
const registro: Array<Record<string, unknown>> = [];

const fakePrisma: any = {
  user: {
    findUnique: vi.fn(async ({ where }: any) => filas.get(where.id) ?? null),
    findFirst: vi.fn(async ({ where }: any) => {
      for (const f of filas.values()) {
        if (where.id && f.id !== where.id) continue;
        if (where.tenantId && f.tenantId !== where.tenantId) continue;
        return f;
      }
      return null;
    }),
    update: vi.fn(async ({ where, data }: any) => {
      const f = filas.get(where.id)!;
      if (data.pinHash !== undefined) f.pinHash = data.pinHash;
      if (data.pinProvisionalAt !== undefined) {
        f.pinProvisionalAt = data.pinProvisionalAt;
      }
      return f;
    }),
  },
  pinChange: {
    create: vi.fn(async ({ data }: any) => {
      registro.push(data);
      return { id: randomUUID(), ...data };
    }),
  },
  tenant: { findUnique: vi.fn(async () => ({ cajaEnabled: true })) },
  // La forma de array: el PIN y su línea de registro se escriben juntos.
  $transaction: vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
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
      expiresAt: e?.expiresAt ?? Date.now() + 300_000,
    });
    return valor;
  }),
  expire: vi.fn(async () => 1),
  ttl: vi.fn(async (key: string) => {
    const e = redisStore.get(key);
    if (!e) return -2;
    const ms = e.expiresAt - Date.now();
    return ms <= 0 ? -2 : Math.ceil(ms / 1000);
  }),
  set: vi.fn(async (key: string, value: string, _ex: string, secs: number) => {
    redisStore.set(key, { value, expiresAt: Date.now() + secs * 1000 });
    return "OK";
  }),
  get: vi.fn(async (key: string) => {
    const e = redisStore.get(key);
    return !e || e.expiresAt <= Date.now() ? null : e.value;
  }),
  del: vi.fn(async (...keys: string[]) => {
    let n = 0;
    for (const k of keys) if (redisStore.delete(k)) n++;
    return n;
  }),
};

vi.mock("../src/context.js", () => ({
  getPrisma: () => fakePrisma,
  getRedis: () => fakeRedis,
  shutdown: async () => undefined,
}));

const { registerAuthRoutes } = await import("../src/auth/routes.js");
const { registerCashiersRoutes } = await import("../src/cashiers/routes.js");
const { hashPassword, verifyPassword } = await import("../src/auth/passwords.js");
const { signAccessToken } = await import("../src/auth/tokens.js");
const { signCashierSession } = await import("../src/shift/cashier-session.js");

const EMAIL_DUENA = "carmen@sirope.es";
const EMAIL_CAJERA = "marta@sirope.es";

function comoDuena() {
  return {
    authorization: `Bearer ${signAccessToken({
      sub: DUENA,
      tid: TENANT,
      role: "OWNER",
    })}`,
  };
}

function comoCajera(userId = CAJERA) {
  return {
    authorization: `Bearer ${signCashierSession(
      { sub: userId, tid: TENANT, did: DEVICE, rid: REGISTER, role: "CASHIER" },
      720,
    )}`,
  };
}

async function buildApp() {
  const app = Fastify();
  await registerAuthRoutes(app);
  await registerCashiersRoutes(app);
  await app.ready();
  return app;
}

beforeEach(async () => {
  filas.clear();
  registro.length = 0;
  redisStore.clear();
  vi.clearAllMocks();
  filas.set(DUENA, {
    id: DUENA,
    tenantId: TENANT,
    email: EMAIL_DUENA,
    role: "OWNER",
    pinHash: await hashPassword("9473"),
    pinProvisionalAt: null,
  });
  filas.set(CAJERA, {
    id: CAJERA,
    tenantId: TENANT,
    email: EMAIL_CAJERA,
    role: "CASHIER",
    pinHash: await hashPassword("5061"),
    pinProvisionalAt: null,
  });
  filas.set(OTRA, {
    id: OTRA,
    tenantId: TENANT,
    email: "ana@sirope.es",
    role: "CASHIER",
    pinHash: await hashPassword("8305"),
    pinProvisionalAt: null,
  });
});

async function cambiar(
  headers: Record<string, string>,
  body: Record<string, unknown>,
) {
  const app = await buildApp();
  const res = await app.inject({
    method: "POST",
    url: "/auth/me/pin",
    headers,
    payload: body,
  });
  await app.close();
  return res;
}

// ── 1 · EL CAMINO QUE TIENE QUE FUNCIONAR ───────────────────────────

describe("cambiar mi PIN, por las dos puertas", () => {
  it("desde el PANEL: con el actual correcto, queda el nuevo", async () => {
    const res = await cambiar(comoDuena(), {
      currentPin: "9473",
      newPin: "5061",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
    const duena = filas.get(DUENA)!;
    expect(await verifyPassword(duena.pinHash!, "5061")).toBe(true);
    // Y el viejo deja de valer en el mismo instante.
    expect(await verifyPassword(duena.pinHash!, "9473")).toBe(false);
  });

  it("desde el TPV: la misma ruta, con la sesión de cajero", async () => {
    const res = await cambiar(comoCajera(), {
      currentPin: "5061",
      newPin: "8305",
    });
    expect(res.statusCode).toBe(200);
    expect(await verifyPassword(filas.get(CAJERA)!.pinHash!, "8305")).toBe(true);
  });

  it("y queda PROPIO: si era provisional, la marca se limpia", async () => {
    filas.get(CAJERA)!.pinProvisionalAt = new Date();
    await cambiar(comoCajera(), { currentPin: "5061", newPin: "8305" });
    expect(filas.get(CAJERA)!.pinProvisionalAt).toBeNull();
  });
});

// ── 2 · EL PIN ACTUAL ───────────────────────────────────────────────

describe("el PIN actual es obligatorio, y se comprueba", () => {
  it("sin él, el schema contesta 400 y no se escribe nada", async () => {
    const antes = filas.get(DUENA)!.pinHash;
    const res = await cambiar(comoDuena(), { newPin: "5061" });
    expect(res.statusCode).toBe(400);
    expect(filas.get(DUENA)!.pinHash).toBe(antes);
  });

  it("con el actual EQUIVOCADO: 401 y el PIN se queda como estaba", async () => {
    // El sabotaje principal del punto 1: quitar el `verifyPassword`.
    const antes = filas.get(DUENA)!.pinHash;
    const res = await cambiar(comoDuena(), {
      currentPin: "0000",
      newPin: "5061",
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe("PIN_ACTUAL_INCORRECTO");
    expect(filas.get(DUENA)!.pinHash).toBe(antes);
    expect(registro).toHaveLength(0);
  });

  it("quien NO tiene PIN recibe 409, no un PIN nuevo", async () => {
    // Dejar pasar un `currentPin` cualquiera cuando no hay PIN puesto
    // sería dar credencial desde la ruta que promete comprobarla.
    filas.get(DUENA)!.pinHash = null;
    const res = await cambiar(comoDuena(), {
      currentPin: "9473",
      newPin: "5061",
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("SIN_PIN_TODAVIA");
    expect(filas.get(DUENA)!.pinHash).toBeNull();
    // Y el mensaje le dice por dónde SÍ.
    expect(res.json().message).toMatch(/Mi cuenta/);
  });
});

// ── 3 · LOS TRIVIALES ───────────────────────────────────────────────

describe("un PIN demasiado fácil se rechaza, con el porqué", () => {
  it.each(["0000", "1234", "4321", "1212", "2580"])(
    "%s → 400 PIN_DEMASIADO_FACIL y nada escrito",
    async (facil) => {
      const antes = filas.get(DUENA)!.pinHash;
      const res = await cambiar(comoDuena(), {
        currentPin: "9473",
        newPin: facil,
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe("PIN_DEMASIADO_FACIL");
      expect(res.json().message.length).toBeGreaterThan(30);
      expect(filas.get(DUENA)!.pinHash).toBe(antes);
    },
  );

  it("el filtro va DESPUÉS de comprobar el actual", async () => {
    // Al revés, un desconocido con una sesión robada sabría si «1234» es
    // trivial antes de demostrar que conoce el PIN. No es grave, pero el
    // orden correcto es: primero demuestra quién eres.
    const res = await cambiar(comoDuena(), {
      currentPin: "0000",
      newPin: "1234",
    });
    expect(res.json().code).toBe("PIN_ACTUAL_INCORRECTO");
  });
});

// ── 4 · EL BLOQUEO (punto 6) ────────────────────────────────────────

describe("el bloqueo por intentos cuenta los fallos del PIN actual", () => {
  it("cada fallo gasta un intento, y el quinto bloquea 15 min", async () => {
    const restantes: number[] = [];
    for (let i = 0; i < 4; i++) {
      const res = await cambiar(comoDuena(), {
        currentPin: "0000",
        newPin: "5061",
      });
      expect(res.statusCode).toBe(401);
      restantes.push(res.json().attemptsRemaining);
    }
    expect(restantes).toEqual([4, 3, 2, 1]);
    // El quinto cierra el candado.
    const quinto = await cambiar(comoDuena(), {
      currentPin: "0000",
      newPin: "5061",
    });
    expect(quinto.statusCode).toBe(401);
    // Y el sexto ya no llega al argon2: 429.
    const sexto = await cambiar(comoDuena(), {
      currentPin: "9473",
      newPin: "5061",
    });
    expect(sexto.statusCode).toBe(429);
    expect(sexto.json().error).toBe("RATE_LIMITED");
    // Ni siquiera con el PIN BUENO: el candado es del contador, no del
    // intento.
    expect(filas.get(DUENA)!.pinHash).not.toBeNull();
    expect(registro).toHaveLength(0);
  });

  it("es el MISMO cubo que el login del TPV, no uno paralelo", async () => {
    // El sabotaje: darle a esta ruta su propia clave de rate-limit.
    // Entonces se podrían gastar cinco intentos aquí y otros cinco en el
    // login, que es el doble de lo que el punto 6 concede.
    await cambiar(comoDuena(), { currentPin: "0000", newPin: "5061" });
    const claves = [...redisStore.keys()];
    expect(claves).toContain(`cashier-login-attempts:${TENANT}:${EMAIL_DUENA}`);
  });

  it("acertar el PIN actual limpia el contador", async () => {
    await cambiar(comoDuena(), { currentPin: "0000", newPin: "5061" });
    expect(
      redisStore.has(`cashier-login-attempts:${TENANT}:${EMAIL_DUENA}`),
    ).toBe(true);
    const ok = await cambiar(comoDuena(), {
      currentPin: "9473",
      newPin: "5061",
    });
    expect(ok.statusCode).toBe(200);
    expect(
      redisStore.has(`cashier-login-attempts:${TENANT}:${EMAIL_DUENA}`),
    ).toBe(false);
  });
});

// ── 5 · EL PIN DE OTRO ──────────────────────────────────────────────

describe("un cajero no puede cambiar el PIN de otro", () => {
  it("colar un `userId` en el cuerpo no hace nada: cambia el SUYO", async () => {
    // El sabotaje: meter un `userId` en la ruta y hacerle caso.
    //
    // Y la forma de la garantía importa: `additionalProperties: false`
    // **no contesta 400**, contesta 200 y borra el campo antes de que el
    // handler lo vea (es como se comporta Fastify, y por eso se mide el
    // EFECTO y no el código). Así que lo que este test fija no es que se
    // rechace la petición: es que el PIN de Ana sigue siendo el de Ana.
    const res = await cambiar(comoCajera(), {
      currentPin: "5061",
      newPin: "8305",
      userId: OTRA,
    });
    expect(res.statusCode).toBe(200);
    // La cajera cambió el suyo…
    expect(await verifyPassword(filas.get(CAJERA)!.pinHash!, "8305")).toBe(true);
    // …y el de Ana no se ha tocado: sigue siendo el que tenía.
    expect(await verifyPassword(filas.get(OTRA)!.pinHash!, "8305")).toBe(true);
    expect(registro).toHaveLength(1);
    expect(registro[0]).toMatchObject({ targetUserId: CAJERA });
  });

  it("con el PIN de OTRA como «actual», tampoco: es 401", async () => {
    const res = await cambiar(comoCajera(), {
      currentPin: "8305", // el de Ana
      newPin: "9473",
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe("PIN_ACTUAL_INCORRECTO");
  });

  it("y la ruta que SÍ lleva a quién no acepta una sesión de cajero", async () => {
    // `PATCH /cashiers/:id/pin` es `requireOwnerOrManager`: una sesión de
    // cajero no es un access token y no pasa.
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/cashiers/${OTRA}/pin`,
      headers: comoCajera(),
      payload: { pin: "9473" },
    });
    expect(res.statusCode).toBe(401);
    expect(await verifyPassword(filas.get(OTRA)!.pinHash!, "8305")).toBe(true);
    await app.close();
  });
});

// ── 6 · EL REGISTRO (punto 7) ───────────────────────────────────────

describe("cada cambio queda registrado, sin el PIN", () => {
  it("quién, a quién, propio o prestado, y por dónde", async () => {
    await cambiar(comoCajera(), { currentPin: "5061", newPin: "8305" });
    expect(registro).toHaveLength(1);
    expect(registro[0]).toMatchObject({
      tenantId: TENANT,
      targetUserId: CAJERA,
      actorUserId: CAJERA,
      kind: "PROPIO",
      source: "TPV",
    });
  });

  it("desde el panel, la fuente es PANEL", async () => {
    await cambiar(comoDuena(), { currentPin: "9473", newPin: "5061" });
    expect(registro[0]).toMatchObject({ source: "PANEL", kind: "PROPIO" });
  });

  it("ni el PIN ni su hash caben en la fila", async () => {
    await cambiar(comoDuena(), { currentPin: "9473", newPin: "5061" });
    const fila = JSON.stringify(registro[0]);
    expect(fila).not.toContain("5061");
    expect(fila).not.toContain("9473");
    expect(fila).not.toContain("argon2");
  });

  it("va en la MISMA transacción que el PIN", async () => {
    // El sabotaje: sacar el `create` de la transacción y dejarlo
    // «best-effort». Un PIN cambiado sin fila es el agujero del 27-10.
    await cambiar(comoDuena(), { currentPin: "9473", newPin: "5061" });
    expect(fakePrisma.$transaction).toHaveBeenCalledTimes(1);
  });
});

// ── 7 · LA PUERTA DE LA CAJA ────────────────────────────────────────

describe("sin caja no hay PIN que cambiar", () => {
  it("403 CAJA_DISABLED, y el PIN intacto", async () => {
    fakePrisma.tenant.findUnique.mockResolvedValueOnce({ cajaEnabled: false });
    const antes = filas.get(DUENA)!.pinHash;
    const res = await cambiar(comoDuena(), {
      currentPin: "9473",
      newPin: "5061",
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("CAJA_DISABLED");
    expect(filas.get(DUENA)!.pinHash).toBe(antes);
  });
});
