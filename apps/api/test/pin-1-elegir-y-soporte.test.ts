// pin-1 (puntos 2 y 5) · OLVIDÉ MI PIN (LA PROPIETARIA), Y EL ÚLTIMO
// RECURSO DE SOPORTE.
//
// Son las dos caras de lo mismo, y por eso van en el mismo fichero: la
// pregunta es **quién puede dejar un PIN DEFINITIVO en esta cuenta**.
//
//   · La propietaria, sobre sí misma, sin el PIN actual: su contraseña
//     ya la ha identificado para llegar al panel. Es lo que sustituye a
//     «Regenerar PIN».
//   · Mi Piace, desde «Configurar como OWNER», **no**: sólo puede dejar
//     uno PROVISIONAL. Que el botón no se le pinte a la dueña no cierra
//     nada; la negativa está en las dos rutas.
//
// Sabotajes que pone en rojo:
//   · quitar el `isImpersonation === true` de `/auth/me/pin/elegir`
//     (soporte dejaría PINs definitivos en cuentas ajenas);
//   · quitar el `isImpersonation !== true` de `regenerate-owner-pin`
//     (vuelve el número al azar que sólo se enseña una vez, que es lo
//     que el bloque viene a quitar);
//   · que `regenerate` deje el PIN como PROPIO en vez de PROVISIONAL;
//   · dejar que un MANAGER elija PIN sin el actual.

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
const ENCARGADO = "33333333-3333-3333-3333-333333333333";
const SUPER_ADMIN = "99999999-9999-9999-9999-999999999999";

interface Fila {
  id: string;
  tenantId: string;
  email: string;
  role: "OWNER" | "MANAGER";
  pinHash: string | null;
  pinProvisionalAt: Date | null;
}

const filas = new Map<string, Fila>();
const registro: Array<Record<string, unknown>> = [];

const fakePrisma: any = {
  user: {
    findUnique: vi.fn(async ({ where }: any) => filas.get(where.id) ?? null),
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
  // Cada mutación en modo «Configurar como OWNER» deja su línea de
  // `impersonate_write` ANTES de ejecutarse, y falla cerrado.
  superAdminAudit: { create: vi.fn(async () => ({ id: "a" })) },
  $transaction: vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
};

const redisStore = new Map<string, string>();
const fakeRedis = {
  ping: async () => "PONG",
  incr: vi.fn(async (k: string) => {
    const v = Number(redisStore.get(k) ?? "0") + 1;
    redisStore.set(k, String(v));
    return v;
  }),
  expire: vi.fn(async () => 1),
  ttl: vi.fn(async () => -2),
  set: vi.fn(async () => "OK"),
  get: vi.fn(async (k: string) => redisStore.get(k) ?? null),
  del: vi.fn(async (...ks: string[]) => {
    let n = 0;
    for (const k of ks) if (redisStore.delete(k)) n++;
    return n;
  }),
};

vi.mock("../src/context.js", () => ({
  getPrisma: () => fakePrisma,
  getRedis: () => fakeRedis,
  shutdown: async () => undefined,
}));

const { registerAuthRoutes } = await import("../src/auth/routes.js");
const { hashPassword, verifyPassword } = await import("../src/auth/passwords.js");
const { signAccessToken } = await import("../src/auth/tokens.js");
const { signImpersonationToken } = await import("../src/superadmin/tokens.js");

const comoDuena = {
  authorization: `Bearer ${signAccessToken({
    sub: DUENA,
    tid: TENANT,
    role: "OWNER",
  })}`,
};
const comoEncargado = {
  authorization: `Bearer ${signAccessToken({
    sub: ENCARGADO,
    tid: TENANT,
    role: "MANAGER",
  })}`,
};
const comoSoporte = {
  authorization: `Bearer ${signImpersonationToken({
    sub: DUENA,
    tid: TENANT,
    tv: 0,
    by: SUPER_ADMIN,
    mode: "full",
  })}`,
};

async function buildApp() {
  const app = Fastify();
  await registerAuthRoutes(app);
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
    email: "carmen@sirope.es",
    role: "OWNER",
    pinHash: await hashPassword("9473"),
    pinProvisionalAt: null,
  });
  filas.set(ENCARGADO, {
    id: ENCARGADO,
    tenantId: TENANT,
    email: "luis@sirope.es",
    role: "MANAGER",
    pinHash: await hashPassword("5061"),
    pinProvisionalAt: null,
  });
});

async function pedir(
  url: string,
  headers: Record<string, string>,
  payload: Record<string, unknown> = {},
) {
  const app = await buildApp();
  const res = await app.inject({ method: "POST", url, headers, payload });
  await app.close();
  return res;
}

// ── 1 · LA PROPIETARIA ELIGE EL SUYO, SIN EL ACTUAL ─────────────────

describe("la propietaria autenticada con contraseña elige PIN sin el actual", () => {
  it("queda puesto el que teclea, y es PROPIO", async () => {
    const res = await pedir("/auth/me/pin/elegir", comoDuena, {
      newPin: "8305",
    });
    expect(res.statusCode).toBe(200);
    const carmen = filas.get(DUENA)!;
    expect(await verifyPassword(carmen.pinHash!, "8305")).toBe(true);
    expect(carmen.pinProvisionalAt).toBeNull();
    // No le dan un PIN: lo pone ella. Así que no vuelve nada que
    // apuntar.
    expect(res.json().pin).toBeUndefined();
  });

  it("funciona aunque no tuviera ninguno (el primer día)", async () => {
    filas.get(DUENA)!.pinHash = null;
    const res = await pedir("/auth/me/pin/elegir", comoDuena, {
      newPin: "8305",
    });
    expect(res.statusCode).toBe(200);
    expect(filas.get(DUENA)!.pinHash).not.toBeNull();
  });

  it("y sobre un PIN PROVISIONAL de soporte: lo convierte en suyo", async () => {
    filas.get(DUENA)!.pinProvisionalAt = new Date();
    await pedir("/auth/me/pin/elegir", comoDuena, { newPin: "8305" });
    expect(filas.get(DUENA)!.pinProvisionalAt).toBeNull();
  });

  it("un trivial se rechaza igual", async () => {
    const antes = filas.get(DUENA)!.pinHash;
    const res = await pedir("/auth/me/pin/elegir", comoDuena, {
      newPin: "1111",
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("PIN_DEMASIADO_FACIL");
    expect(filas.get(DUENA)!.pinHash).toBe(antes);
  });

  it("limpia el candado que se ganó probando el que no recordaba", async () => {
    // Sin esto, tendría el PIN nuevo en la mano y la caja cerrada quince
    // minutos — que es exactamente el momento en que lo necesita.
    redisStore.set(`cashier-login-attempts:${TENANT}:carmen@sirope.es`, "4");
    redisStore.set(`cashier-login-locked:${TENANT}:carmen@sirope.es`, "1");
    await pedir("/auth/me/pin/elegir", comoDuena, { newPin: "8305" });
    expect(
      redisStore.has(`cashier-login-locked:${TENANT}:carmen@sirope.es`),
    ).toBe(false);
  });

  it("queda registrado como PROPIO, desde el PANEL", async () => {
    await pedir("/auth/me/pin/elegir", comoDuena, { newPin: "8305" });
    expect(registro).toHaveLength(1);
    expect(registro[0]).toMatchObject({
      targetUserId: DUENA,
      actorUserId: DUENA,
      kind: "PROPIO",
      source: "PANEL",
    });
  });

  it("un ENCARGADO no llega: su camino es el PIN provisional", async () => {
    // Decisión del bloque: el punto 2 dice «la propietaria»; el personal
    // —y un encargado es personal de la caja— va por el punto 3.
    const res = await pedir("/auth/me/pin/elegir", comoEncargado, {
      newPin: "8305",
    });
    expect(res.statusCode).toBe(403);
    expect(await verifyPassword(filas.get(ENCARGADO)!.pinHash!, "5061")).toBe(
      true,
    );
  });
});

// ── 2 · SOPORTE NO ELIGE EL PIN DE NADIE ────────────────────────────

describe("desde «Configurar como OWNER» no se elige un PIN definitivo", () => {
  it("403, y el PIN de la dueña intacto", async () => {
    // El sabotaje: quitar el `isImpersonation === true`. `requireOwner`
    // acepta el JWT de impersonación COMO SI fuera el OWNER desde
    // v1.3-SuperAdmin-Hub, así que sin esta línea Mi Piace podría dejarle
    // a la propietaria un PIN definitivo elegido por Mi Piace.
    const antes = filas.get(DUENA)!.pinHash;
    const res = await pedir("/auth/me/pin/elegir", comoSoporte, {
      newPin: "8305",
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("SOPORTE_NO_ELIGE_PIN");
    expect(filas.get(DUENA)!.pinHash).toBe(antes);
    expect(registro).toHaveLength(0);
  });

  it("y el mensaje dice por dónde SÍ", async () => {
    const res = await pedir("/auth/me/pin/elegir", comoSoporte, {
      newPin: "8305",
    });
    expect(res.json().message).toMatch(/Regenerar PIN/);
    expect(res.json().message).toMatch(/provisional/);
  });
});

// ── 3 · «REGENERAR PIN», EL ÚLTIMO RECURSO ──────────────────────────

describe("regenerar el PIN sólo desde soporte, y deja uno PROVISIONAL", () => {
  it("desde soporte: 200, cuatro cifras, y PROVISIONAL", async () => {
    const res = await pedir("/auth/me/regenerate-owner-pin", comoSoporte);
    expect(res.statusCode).toBe(200);
    expect(res.json().pin).toMatch(/^\d{4}$/);
    // La respuesta lo DICE, para que quien lo lea por teléfono sepa que
    // la dueña va a tener que elegir el suyo.
    expect(res.json().provisional).toBe(true);
    expect(filas.get(DUENA)!.pinProvisionalAt).not.toBeNull();
  });

  it("el PIN que genera nunca es de los fáciles", async () => {
    // Cinco vueltas y no treinta: cada una hashea con argon2id (64 MB,
    // t=3) y el banco se iba a los cinco segundos. Lo que aquí se mide
    // es que la ruta llama al generador filtrado; la prueba de verdad
    // está en `pin-1-reglas.test.ts`, con un generador amañado que
    // devuelve 1234 siempre.
    const { motivoPinTrivial } = await import("../src/auth/pin.js");
    for (let i = 0; i < 5; i++) {
      const res = await pedir("/auth/me/regenerate-owner-pin", comoSoporte);
      expect(motivoPinTrivial(res.json().pin)).toBeNull();
    }
  });

  it("LA PROPIETARIA no puede usarlo: 403 y el PIN intacto", async () => {
    // El sabotaje: quitar el `isImpersonation !== true`. Entonces vuelve
    // a existir el camino «el sistema me genera un número y me lo enseña
    // una vez», que es el que hizo perder el PIN dos veces el 27-10.
    const antes = filas.get(DUENA)!.pinHash;
    const res = await pedir("/auth/me/regenerate-owner-pin", comoDuena);
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("PIN_AL_AZAR_SOLO_SOPORTE");
    expect(res.json().message).toMatch(/Elegir PIN/);
    expect(filas.get(DUENA)!.pinHash).toBe(antes);
    expect(registro).toHaveLength(0);
  });

  it("queda registrado como PROVISIONAL y por SOPORTE", async () => {
    await pedir("/auth/me/regenerate-owner-pin", comoSoporte);
    expect(registro.at(-1)).toMatchObject({
      targetUserId: DUENA,
      kind: "PROVISIONAL",
      source: "SOPORTE",
    });
    // Y la fila no tiene DÓNDE guardar el PIN: se enumeran sus claves en
    // vez de buscar cuatro cifras en el JSON, que es lo que parecía
    // obvio y no vale —los UUID están llenos de tramos de cuatro
    // cifras—. Lo que esto pone en rojo es añadirle una columna que
    // guarde el PIN o su hash.
    expect(Object.keys(registro.at(-1)!).sort()).toEqual([
      "actorUserId",
      "kind",
      "source",
      "targetUserId",
      "tenantId",
    ]);
  });
});
