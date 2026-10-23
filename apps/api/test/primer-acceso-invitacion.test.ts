// primer-acceso · EL BANCO DE LA INVITACIÓN.
//
// Lo que este fichero fija, punto por punto del «cómo se cierra»:
//
//   1. El token vale UNA vez.
//   2. Caducado → 410 con su código.
//   3. Reenviar anula el anterior.
//   4. Aceptar deja la sesión iniciada y `mustChangePassword = false`.
//   5. El reset limpia `mustChangePassword`.
//   6. El reenvío público es neutro: la misma respuesta exista el email o
//      no, y no manda nada a quien ya eligió su contraseña.
//
// ── Y LOS SABOTAJES ────────────────────────────────────────────────
//
//   · reutilizar un token usado
//   · usar uno de reset como invitación Y AL REVÉS
//   · cambiar la hora para alargar uno caducado
//   · pedir reenvío para un email que no existe (respuesta idéntica)
//   · buscar la contraseña o el token en los logs
//
// El fake de la tabla de tokens **respeta el `type`**, y eso es lo que
// hace que el sabotaje cruzado sea de verdad: con un fake que ignorara el
// campo, «un token de reset no vale como invitación» pasaría en verde sin
// que el código lo cumpliera.

import { randomBytes, randomUUID } from "node:crypto";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.REDIS_URL = "redis://localhost:6379";
process.env.JWT_ACCESS_SECRET = "a".repeat(40);
process.env.JWT_REFRESH_SECRET = "b".repeat(40);
process.env.HOLDED_KEY_ENCRYPTION_SECRET = randomBytes(32).toString("base64");
process.env.PUBLIC_ADMIN_URL = "http://localhost:5173";

import Fastify, { type FastifyInstance } from "fastify";
import jwt from "jsonwebtoken";
import { beforeEach, describe, expect, it, vi } from "vitest";

interface FakeUser {
  id: string;
  tenantId: string;
  email: string;
  alias: string | null;
  role: "OWNER" | "MANAGER" | "CASHIER";
  passwordHash: string | null;
  tokenVersion: number;
  mustChangePasswordAt: Date | null;
  deletedAt: Date | null;
}

interface FakeToken {
  id: string;
  userId: string;
  tokenHash: string;
  type: "RESET" | "INVITE";
  expiresAt: Date;
  usedAt: Date | null;
}

const TENANT_ID = "22222222-2222-2222-2222-222222222222";
const OWNER_ID = "11111111-1111-1111-1111-111111111111";
const OWNER_EMAIL = "carmen@jardindegredos.es";

const users = new Map<string, FakeUser>();
const tokens: FakeToken[] = [];

const tenant = {
  id: TENANT_ID,
  name: "Jardín de Gredos",
  fiscalProfile: { legalName: "Jardín de Gredos, S.A." },
  residenciaEnabled: true,
  holdedApiKeyCiphertext: null as string | null,
};

function matchToken(t: FakeToken, where: any): boolean {
  if (!where) return true;
  if (where.id && t.id !== where.id) return false;
  if (where.userId && t.userId !== where.userId) return false;
  // EL campo del sabotaje cruzado.
  if (where.type && t.type !== where.type) return false;
  if (where.usedAt === null && t.usedAt != null) return false;
  if (where.expiresAt?.gt && !(t.expiresAt > where.expiresAt.gt)) return false;
  return true;
}

function matchUser(u: FakeUser, where: any): boolean {
  if (!where) return true;
  if (where.id && u.id !== where.id) return false;
  if (where.email && u.email !== where.email) return false;
  if (where.tenantId && u.tenantId !== where.tenantId) return false;
  if (where.role && u.role !== where.role) return false;
  if (where.deletedAt === null && u.deletedAt != null) return false;
  return true;
}

function conTenant(u: FakeUser, select: any) {
  const fila: any = { ...u };
  if (select?.tenant) fila.tenant = { ...tenant };
  return fila;
}

const fakePrisma: any = {
  user: {
    findUnique: vi.fn(async ({ where, select }: any) => {
      const u = where.id
        ? users.get(where.id)
        : [...users.values()].find((x) => x.email === where.email);
      return u ? conTenant(u, select) : null;
    }),
    findFirst: vi.fn(async ({ where, select }: any) => {
      const u = [...users.values()].find((x) => matchUser(x, where));
      return u ? conTenant(u, select) : null;
    }),
    update: vi.fn(async ({ where, data, select }: any) => {
      const u = users.get(where.id);
      if (!u) throw new Error("user not found");
      for (const k of ["passwordHash", "mustChangePasswordAt", "alias"]) {
        if (data[k] !== undefined) (u as any)[k] = data[k];
      }
      if (data.tokenVersion?.increment != null)
        u.tokenVersion += data.tokenVersion.increment;
      return conTenant(u, select);
    }),
  },
  passwordResetToken: {
    create: vi.fn(async ({ data }: any) => {
      const row: FakeToken = {
        id: randomUUID(),
        userId: data.userId,
        tokenHash: data.tokenHash,
        type: data.type ?? "RESET",
        expiresAt: data.expiresAt,
        usedAt: data.usedAt ?? null,
      };
      tokens.push(row);
      return { ...row };
    }),
    findMany: vi.fn(async ({ where }: any) =>
      tokens.filter((t) => matchToken(t, where)).map((t) => ({ ...t })),
    ),
    findFirst: vi.fn(async ({ where, select }: any) => {
      const vivos = tokens
        .filter((t) => matchToken(t, where))
        .sort((a, b) => b.expiresAt.getTime() - a.expiresAt.getTime());
      const t = vivos[0];
      if (!t) return null;
      return select?.expiresAt ? { expiresAt: t.expiresAt } : { ...t };
    }),
    update: vi.fn(async ({ where, data }: any) => {
      const t = tokens.find((x) => x.id === where.id);
      if (!t) throw new Error("token not found");
      if (data.usedAt !== undefined) t.usedAt = data.usedAt;
      return { ...t };
    }),
    updateMany: vi.fn(async ({ where, data }: any) => {
      let n = 0;
      for (const t of tokens) {
        if (!matchToken(t, where)) continue;
        if (data.usedAt !== undefined) t.usedAt = data.usedAt;
        n++;
      }
      return { count: n };
    }),
  },
  $transaction: vi.fn(async (fn: any) => fn(fakePrisma)),
};

const redisStore = new Map<string, { value: string; expiresAt: number }>();
const fakeRedis: any = {
  incr: vi.fn(async (key: string) => {
    const e = redisStore.get(key);
    const fresh = !e || e.expiresAt <= Date.now();
    const value = fresh ? 1 : Number(e!.value) + 1;
    redisStore.set(key, {
      value: String(value),
      expiresAt: e?.expiresAt ?? Date.now() + 24 * 60 * 60 * 1000,
    });
    return value;
  }),
  expire: vi.fn(async (key: string, seconds: number) => {
    const e = redisStore.get(key);
    if (!e) return 0;
    e.expiresAt = Date.now() + seconds * 1000;
    return 1;
  }),
  ttl: vi.fn(async (key: string) => {
    const e = redisStore.get(key);
    if (!e) return -2;
    const ms = e.expiresAt - Date.now();
    return ms <= 0 ? -2 : Math.ceil(ms / 1000);
  }),
  get: vi.fn(async (key: string) => redisStore.get(key)?.value ?? null),
  set: vi.fn(async () => "OK"),
  del: vi.fn(async () => 1),
};

vi.mock("../src/context.js", () => ({
  getPrisma: () => fakePrisma,
  getRedis: () => fakeRedis,
  initContext: vi.fn(),
  closeContext: vi.fn(),
  shutdown: async () => undefined,
}));

const sentEmails: Array<{ to: string; subject: string; text: string; html?: string }> = [];
vi.mock("../src/email/sender.js", () => ({
  getEmailSender: () => ({
    async send(email: any) {
      sentEmails.push(email);
    },
  }),
  setEmailSender: () => undefined,
}));

const { registerInvitacionRoutes } = await import(
  "../src/auth/invitacion-routes.js"
);
const { registerPasswordResetRoutes } = await import(
  "../src/auth/password-reset.js"
);
const { crearInvitacion } = await import("../src/auth/invitacion.js");
const { hashPassword, verifyPassword } = await import("../src/auth/passwords.js");

// Lo que el log recoge, para el sabotaje de «buscar el token en los logs».
const lineasDeLog: string[] = [];

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    trustProxy: 1,
    logger: {
      level: "info",
      // Un stream que se queda con TODO lo que la API escribiría: es la
      // única forma de comprobar de verdad que el token no sale por ahí.
      stream: {
        write(linea: string) {
          lineasDeLog.push(linea);
        },
      },
    },
  });
  await registerInvitacionRoutes(app);
  await registerPasswordResetRoutes(app);
  await app.ready();
  return app;
}

/** Un OWNER recién activado: sin contraseña y con la invitación viva. */
async function sembrarInvitado(): Promise<string> {
  users.set(OWNER_ID, {
    id: OWNER_ID,
    tenantId: TENANT_ID,
    email: OWNER_EMAIL,
    alias: "Carmen",
    role: "OWNER",
    passwordHash: null,
    tokenVersion: 0,
    mustChangePasswordAt: null,
    deletedAt: null,
  });
  const { plain } = await crearInvitacion(fakePrisma, OWNER_ID);
  return plain;
}

beforeEach(() => {
  users.clear();
  tokens.length = 0;
  sentEmails.length = 0;
  redisStore.clear();
  lineasDeLog.length = 0;
  tenant.residenciaEnabled = true;
  tenant.holdedApiKeyCiphertext = null;
});

// ════════════════════════════════════════════════════════════════════
//  La página de bienvenida
// ════════════════════════════════════════════════════════════════════

describe("POST /auth/invitacion/consultar", () => {
  it("devuelve el nombre y el email, para pintarlos sin poder editarlos", async () => {
    const token = await sembrarInvitado();
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/auth/invitacion/consultar",
      payload: { token },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      nombre: "Carmen",
      email: OWNER_EMAIL,
      centro: "Jardín de Gredos",
    });
  });

  it("410 con su código cuando el token no existe", async () => {
    await sembrarInvitado();
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/auth/invitacion/consultar",
      payload: { token: "inventado" },
    });
    expect(res.statusCode).toBe(410);
    expect(res.json().code).toBe("INVITACION_CADUCADA_O_USADA");
  });
});

// ════════════════════════════════════════════════════════════════════
//  Aceptar
// ════════════════════════════════════════════════════════════════════

describe("POST /auth/invitacion/aceptar", () => {
  it("deja la SESIÓN INICIADA y mustChangePassword a false", async () => {
    const token = await sembrarInvitado();
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/auth/invitacion/aceptar",
      payload: { token, password: "elegidapor-carmen-2026" },
    });
    expect(res.statusCode).toBe(200);
    const { accessToken, refreshToken } = res.json();
    // Una sesión de verdad: el access token es un `type: "access"` con su
    // tenant y su rol, el mismo que emite `/auth/login`.
    const payload = jwt.verify(accessToken, process.env.JWT_ACCESS_SECRET!) as any;
    expect(payload).toMatchObject({
      sub: OWNER_ID,
      tid: TENANT_ID,
      role: "OWNER",
      type: "access",
    });
    expect(refreshToken).toBeTruthy();

    const owner = users.get(OWNER_ID)!;
    expect(owner.mustChangePasswordAt).toBeNull();
    expect(await verifyPassword(owner.passwordHash!, "elegidapor-carmen-2026")).toBe(
      true,
    );
    // Y las sesiones viejas quedan invalidadas.
    expect(owner.tokenVersion).toBe(1);
  });

  it("el token vale UNA vez: el segundo intento es 410", async () => {
    const token = await sembrarInvitado();
    const app = await buildApp();
    const primera = await app.inject({
      method: "POST",
      url: "/auth/invitacion/aceptar",
      payload: { token, password: "elegidapor-carmen-2026" },
    });
    expect(primera.statusCode).toBe(200);
    const segunda = await app.inject({
      method: "POST",
      url: "/auth/invitacion/aceptar",
      payload: { token, password: "otra-cualquiera-2026" },
    });
    expect(segunda.statusCode).toBe(410);
    expect(segunda.json().code).toBe("INVITACION_CADUCADA_O_USADA");
    // Y la contraseña sigue siendo la primera: el 410 no es cosmético.
    const owner = users.get(OWNER_ID)!;
    expect(await verifyPassword(owner.passwordHash!, "elegidapor-carmen-2026")).toBe(
      true,
    );
  });

  it("410 cuando el enlace ya caducó", async () => {
    const token = await sembrarInvitado();
    // Lo caducamos moviendo la fila, que es lo que hace el tiempo.
    tokens[0]!.expiresAt = new Date(Date.now() - 1000);
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/auth/invitacion/aceptar",
      payload: { token, password: "elegidapor-carmen-2026" },
    });
    expect(res.statusCode).toBe(410);
    expect(res.json().code).toBe("INVITACION_CADUCADA_O_USADA");
  });

  it("400 y el enlace INTACTO cuando la contraseña no cumple", async () => {
    const token = await sembrarInvitado();
    const app = await buildApp();
    const corta = await app.inject({
      method: "POST",
      url: "/auth/invitacion/aceptar",
      payload: { token, password: "corta1" },
    });
    expect(corta.statusCode).toBe(400);
    expect(corta.json().error).toBe("PASSWORD_TOO_WEAK");
    // LO QUE IMPORTA: el token NO se ha quemado. Una errata de tecleo no
    // puede dejar a Carmen fuera con el correo ya gastado.
    expect(tokens[0]!.usedAt).toBeNull();
    const buena = await app.inject({
      method: "POST",
      url: "/auth/invitacion/aceptar",
      payload: { token, password: "elegidapor-carmen-2026" },
    });
    expect(buena.statusCode).toBe(200);
  });

  it("400 cuando la contraseña es larga pero no lleva número", async () => {
    const token = await sembrarInvitado();
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/auth/invitacion/aceptar",
      payload: { token, password: "todoletrassinnumeros" },
    });
    expect(res.statusCode).toBe(400);
  });
});

// ════════════════════════════════════════════════════════════════════
//  Reenviar
// ════════════════════════════════════════════════════════════════════

describe("POST /auth/invitacion/reenviar", () => {
  it("manda uno nuevo y ANULA el anterior", async () => {
    const viejo = await sembrarInvitado();
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/auth/invitacion/reenviar",
      payload: { email: OWNER_EMAIL },
    });
    expect(res.statusCode).toBe(200);
    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0]!.text).toContain("/bienvenida?token=");

    // El viejo ya no vale.
    const conElViejo = await app.inject({
      method: "POST",
      url: "/auth/invitacion/aceptar",
      payload: { token: viejo, password: "elegidapor-carmen-2026" },
    });
    expect(conElViejo.statusCode).toBe(410);

    // El nuevo sí. Se saca del propio correo, que es de donde lo saca
    // Carmen: comprobar el enlace del email es comprobar el camino real.
    const nuevo = sentEmails[0]!.text.match(/\/bienvenida\?token=([^\s]+)/)![1]!;
    const conElNuevo = await app.inject({
      method: "POST",
      url: "/auth/invitacion/aceptar",
      payload: { token: nuevo, password: "elegidapor-carmen-2026" },
    });
    expect(conElNuevo.statusCode).toBe(200);
  });

  it("el correo de una residencia NO dice «Mipiacetpv»", async () => {
    await sembrarInvitado();
    const app = await buildApp();
    await app.inject({
      method: "POST",
      url: "/auth/invitacion/reenviar",
      payload: { email: OWNER_EMAIL },
    });
    expect(sentEmails[0]!.text).not.toMatch(/Mipiacetpv/);
    expect(sentEmails[0]!.text).toContain("Jardín de Gredos, S.A.");
  });

  it("el de un comercio SÍ, y con la razón social dentro", async () => {
    tenant.residenciaEnabled = false;
    await sembrarInvitado();
    const app = await buildApp();
    await app.inject({
      method: "POST",
      url: "/auth/invitacion/reenviar",
      payload: { email: OWNER_EMAIL },
    });
    expect(sentEmails[0]!.text).toMatch(/Mipiacetpv/);
  });

  it("no le manda nada a quien YA eligió su contraseña", async () => {
    await sembrarInvitado();
    users.get(OWNER_ID)!.passwordHash = await hashPassword("la-suya-de-siempre-1");
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/auth/invitacion/reenviar",
      payload: { email: OWNER_EMAIL },
    });
    // La misma respuesta neutra: el que pregunta no se entera de nada.
    expect(res.statusCode).toBe(200);
    expect(sentEmails).toHaveLength(0);
  });
});

// ════════════════════════════════════════════════════════════════════
//  El reset limpia mustChangePassword (decisión 4)
// ════════════════════════════════════════════════════════════════════

describe("el reset limpia mustChangePassword", () => {
  it("quien elige su contraseña con un enlace de reset no vuelve a cambiarla", async () => {
    // El caso de hoy: un OWNER del flujo viejo, con provisional y aviso.
    users.set(OWNER_ID, {
      id: OWNER_ID,
      tenantId: TENANT_ID,
      email: OWNER_EMAIL,
      alias: "Carmen",
      role: "OWNER",
      passwordHash: await hashPassword("provisional-rara-16"),
      tokenVersion: 0,
      mustChangePasswordAt: new Date(),
      deletedAt: null,
    });
    const app = await buildApp();
    await app.inject({
      method: "POST",
      url: "/auth/password-reset/request",
      payload: { email: OWNER_EMAIL },
    });
    const enlace = sentEmails.at(-1)!.text.match(/\/admin\/reset\?token=([^\s]+)/)![1]!;
    const res = await app.inject({
      method: "POST",
      url: "/auth/password-reset/confirm",
      payload: { token: enlace, newPassword: "la-que-ella-elige-1" },
    });
    expect(res.statusCode).toBe(200);
    expect(users.get(OWNER_ID)!.mustChangePasswordAt).toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════════
//  SABOTAJES
// ════════════════════════════════════════════════════════════════════

describe("sabotajes", () => {
  it("un token de RESET no vale como invitación", async () => {
    users.set(OWNER_ID, {
      id: OWNER_ID,
      tenantId: TENANT_ID,
      email: OWNER_EMAIL,
      alias: "Carmen",
      role: "OWNER",
      passwordHash: await hashPassword("la-suya-de-siempre-1"),
      tokenVersion: 0,
      mustChangePasswordAt: null,
      deletedAt: null,
    });
    const app = await buildApp();
    await app.inject({
      method: "POST",
      url: "/auth/password-reset/request",
      payload: { email: OWNER_EMAIL },
    });
    const deReset = sentEmails.at(-1)!.text.match(/\/admin\/reset\?token=([^\s]+)/)![1]!;
    for (const url of [
      "/auth/invitacion/consultar",
      "/auth/invitacion/aceptar",
    ]) {
      const res = await app.inject({
        method: "POST",
        url,
        payload: { token: deReset, password: "elegidapor-carmen-2026" },
      });
      expect(res.statusCode).toBe(410);
    }
  });

  it("una INVITACIÓN no vale como enlace de reset", async () => {
    const invitacion = await sembrarInvitado();
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/auth/password-reset/confirm",
      payload: { token: invitacion, newPassword: "la-que-ella-elige-1" },
    });
    expect(res.statusCode).toBe(410);
    expect(res.json().error).toBe("TOKEN_EXPIRED_OR_USED");
    // Y sigue sirviendo como invitación: el intento no la ha quemado.
    const buena = await app.inject({
      method: "POST",
      url: "/auth/invitacion/aceptar",
      payload: { token: invitacion, password: "elegidapor-carmen-2026" },
    });
    expect(buena.statusCode).toBe(200);
  });

  it("NO hay forma de que el cliente alargue un enlace caducado", async () => {
    const token = await sembrarInvitado();
    tokens[0]!.expiresAt = new Date(Date.now() - 60_000);
    const app = await buildApp();
    // El sabotaje es intentar mandar la hora. Y el punto es que **no hay
    // ningún campo donde ponerla**: la caducidad vive en la columna
    // `expires_at` y la comparación la hace el servidor con su reloj.
    //
    // Fastify, con `additionalProperties: false`, no devuelve un 400 por
    // estos campos: los BORRA y sigue (es su comportamiento, y por eso
    // este test no comprueba un 400 sino el 410 de después). Da igual lo
    // que se mande: la respuesta es la misma que sin mandar nada.
    const conHoraInventada = await app.inject({
      method: "POST",
      url: "/auth/invitacion/aceptar",
      payload: {
        token,
        password: "elegidapor-carmen-2026",
        ahora: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
        expiresAt: new Date(Date.now() + 999_999_999).toISOString(),
      },
    });
    expect(conHoraInventada.statusCode).toBe(410);
    const sinNada = await app.inject({
      method: "POST",
      url: "/auth/invitacion/aceptar",
      payload: { token, password: "elegidapor-carmen-2026" },
    });
    expect(sinNada.statusCode).toBe(410);
    expect(conHoraInventada.body).toBe(sinNada.body);
    // Y la contraseña sigue sin existir: el caducado no entra por ningún
    // camino.
    expect(users.get(OWNER_ID)!.passwordHash).toBeNull();
  });

  it("pedir reenvío de un email que no existe contesta EXACTAMENTE lo mismo", async () => {
    await sembrarInvitado();
    const app = await buildApp();
    const existe = await app.inject({
      method: "POST",
      url: "/auth/invitacion/reenviar",
      payload: { email: OWNER_EMAIL },
    });
    const noExiste = await app.inject({
      method: "POST",
      url: "/auth/invitacion/reenviar",
      payload: { email: "nadie@ninguna-parte.es" },
    });
    expect(noExiste.statusCode).toBe(existe.statusCode);
    expect(noExiste.body).toBe(existe.body);
  });

  it("ni el token ni la contraseña salen por los logs", async () => {
    const token = await sembrarInvitado();
    const app = await buildApp();
    await app.inject({
      method: "POST",
      url: "/auth/invitacion/consultar",
      payload: { token },
    });
    await app.inject({
      method: "POST",
      url: "/auth/invitacion/aceptar",
      payload: { token, password: "elegidapor-carmen-2026" },
    });
    await app.inject({
      method: "POST",
      url: "/auth/invitacion/reenviar",
      payload: { email: OWNER_EMAIL },
    });
    const log = lineasDeLog.join("\n");
    expect(log).not.toContain(token);
    expect(log).not.toContain("elegidapor-carmen-2026");
    // Y tampoco el enlace, que lleva el token dentro.
    for (const email of sentEmails) {
      const enlace = email.text.match(/\/bienvenida\?token=([^\s]+)/)?.[1];
      if (enlace) expect(log).not.toContain(enlace);
    }
  });
});
