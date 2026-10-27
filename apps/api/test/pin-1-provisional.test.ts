// pin-1 (punto 3) · UN PIN PROVISIONAL NO SIRVE MÁS QUE PARA ELEGIR EL
// TUYO.
//
// Es la mitad del bloque que más fácil se rompe por omisión, porque hay
// **cinco puertas** que verifican un `pin_hash` y el filtro tiene que
// estar en las cinco. Que falte en una es un PIN prestado que cobra.
//
// Las cinco, y qué pasa si falta en cada una:
//
//   1. `POST /shift/cashier-login` → emitiría sesión. La pantalla de
//      elegir PIN deja de existir y el punto 3 entero se cae.
//   2. `POST /tables/:id/void` (`managerPin`) → un PIN prestado anula
//      una mesa cobrada.
//   3. `POST /shift/:id/close` (`managerPin`) → firma un cierre con
//      incidencia.
//   4. `POST /admin/manager-authorize` → autoriza un descuento.
//   5. `GET /shift/offline-bundle` → viaja al terminal, y entonces basta
//      con quitar la wifi para saltarse la pantalla que obliga a elegir.
//
// Y las dos que lo PONEN: el alta de personal y el reset de PIN desde
// Cajeros. Más la que lo QUITA: elegir el propio.
//
// Sabotajes que este fichero pone en rojo: quitar `pinProvisionalAt`
// de cualquiera de los cinco `where`/`if`, quitar el `mustChoosePin` del
// login, o dejar que `/shift/cashier-pin` escriba sin comprobar que el
// PIN sigue siendo provisional.

import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
const DEVICE = "55555555-5555-5555-5555-555555555555";
const REGISTER = "66666666-6666-6666-6666-666666666666";
const DEVICE_TOKEN = "tok_" + randomBytes(24).toString("base64url");
const EMAIL_CAJERA = "marta@sirope.es";

interface Fila {
  id: string;
  tenantId: string;
  email: string;
  alias: string | null;
  role: "OWNER" | "MANAGER" | "CASHIER" | "CLINICIAN";
  pinHash: string | null;
  pinProvisionalAt: Date | null;
  deletedAt: Date | null;
  isClinician: boolean;
  isTestCashier: boolean;
  isSystemActor: boolean;
}

const filas = new Map<string, Fila>();
const registro: Array<Record<string, unknown>> = [];

/** El `where` de Prisma que de verdad nos importa aquí. */
function casa(f: Fila, where: any): boolean {
  if (!where) return true;
  if (where.id && f.id !== where.id) return false;
  if (where.tenantId && f.tenantId !== where.tenantId) return false;
  if (where.email && f.email !== where.email) return false;
  if (where.role?.in && !where.role.in.includes(f.role)) return false;
  if (where.deletedAt === null && f.deletedAt !== null) return false;
  if (where.pinHash?.not === null && f.pinHash === null) return false;
  // LA LÍNEA DE ESTE FICHERO. Si el handler deja de mandarla, el falso
  // deja de filtrar y los tests de abajo se ponen rojos.
  if (where.pinProvisionalAt === null && f.pinProvisionalAt !== null) {
    return false;
  }
  if (where.isSystemActor === false && f.isSystemActor) return false;
  // El alias cuenta: sin esto, la colisión de alias del alta casa con
  // cualquiera y el 201 se convierte en un 409 que no es del código.
  if (where.alias?.equals !== undefined) {
    if ((f.alias ?? "").toLowerCase() !== where.alias.equals.toLowerCase()) {
      return false;
    }
  }
  if (where.isTestCashier === false && f.isTestCashier) return false;
  if (where.NOT?.email?.endsWith && f.email.endsWith(where.NOT.email.endsWith)) {
    return false;
  }
  return true;
}

const fakePrisma: any = {
  user: {
    findFirst: vi.fn(async ({ where, select }: any) => {
      for (const f of filas.values()) {
        if (!casa(f, where)) continue;
        // La revocación pide `_count` para contar lo que conserva. Sin
        // él, el handler revienta con un 500 y el rojo sería del falso.
        return select?._count ? { ...f, _count: { shifts: 0, tickets: 0 } } : f;
      }
      return null;
    }),
    findMany: vi.fn(async ({ where }: any) =>
      [...filas.values()].filter((f) => casa(f, where)),
    ),
    findUnique: vi.fn(async ({ where }: any) => {
      for (const f of filas.values()) {
        if (where.id ? f.id === where.id : f.email === where.email) return f;
      }
      return null;
    }),
    findUniqueOrThrow: vi.fn(async ({ where }: any) => {
      const f = filas.get(where.id);
      if (!f) throw new Error("no está");
      return f;
    }),
    update: vi.fn(async ({ where, data }: any) => {
      const f = filas.get(where.id)!;
      if (data.pinHash !== undefined) f.pinHash = data.pinHash;
      if (data.pinProvisionalAt !== undefined) {
        f.pinProvisionalAt = data.pinProvisionalAt;
      }
      if (data.email !== undefined) f.email = data.email;
      return f;
    }),
    create: vi.fn(async ({ data }: any) => {
      const f: Fila = {
        id: randomUUID(),
        tenantId: data.tenantId,
        email: data.email,
        alias: data.alias ?? null,
        role: data.role,
        pinHash: data.pinHash ?? null,
        pinProvisionalAt: data.pinProvisionalAt ?? null,
        deletedAt: null,
        isClinician: false,
        isTestCashier: false,
        isSystemActor: false,
      };
      filas.set(f.id, f);
      // El alta devuelve `createdAt` en la respuesta.
      return { ...f, createdAt: new Date() };
    }),
  },
  pinChange: {
    create: vi.fn(async ({ data }: any) => {
      registro.push(data);
      return { id: randomUUID(), ...data };
    }),
  },
  tenant: {
    findUnique: vi.fn(async () => ({ cajaEnabled: true })),
    findUniqueOrThrow: vi.fn(async () => ({
      cajaEnabled: true,
      cashierSessionTtlMinutes: 720,
      cashierAutoLogoutMinutes: 10,
      requireCashCountOnClose: false,
      facturaDesde: new Date("2026-01-01"),
    })),
  },
  device: {
    findUnique: vi.fn(async ({ where }: any) =>
      where.deviceTokenHash === hashDeviceToken(DEVICE_TOKEN)
        ? {
            id: DEVICE,
            tenantId: TENANT,
            registerId: REGISTER,
            deviceTokenHash: where.deviceTokenHash,
            revokedAt: null,
          }
        : null,
    ),
  },
  shift: { findFirst: vi.fn(async () => null) },
  staffProfile: { updateMany: vi.fn(async () => ({ count: 0 })) },
  $transaction: vi.fn(async (arg: any) =>
    typeof arg === "function" ? arg(fakePrisma) : Promise.all(arg),
  ),
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

const { registerCashierAuthRoutes } = await import("../src/shift/cashier-auth.js");
const { registerCashiersRoutes } = await import("../src/cashiers/routes.js");
const { registerManagerAuthorizationRoutes } = await import(
  "../src/admin/manager-authorize.js"
);
const { hashPassword, verifyPassword } = await import("../src/auth/passwords.js");
const { hashDeviceToken } = await import("../src/devices/auth.js");
const { signAccessToken } = await import("../src/auth/tokens.js");
const { signCashierSession } = await import("../src/shift/cashier-session.js");

const comoDuena = {
  authorization: `Bearer ${signAccessToken({
    sub: DUENA,
    tid: TENANT,
    role: "OWNER",
  })}`,
};
const comoCajeraEnElTpv = {
  authorization: `Bearer ${signCashierSession(
    { sub: CAJERA, tid: TENANT, did: DEVICE, rid: REGISTER, role: "CASHIER" },
    720,
  )}`,
};

async function buildApp() {
  const app = Fastify();
  await registerCashierAuthRoutes(app);
  await registerCashiersRoutes(app);
  await registerManagerAuthorizationRoutes(app);
  await app.ready();
  return app;
}

function nueva(over: Partial<Fila> & { id: string; email: string }): Fila {
  return {
    tenantId: TENANT,
    alias: null,
    role: "CASHIER",
    pinHash: null,
    pinProvisionalAt: null,
    deletedAt: null,
    isClinician: false,
    isTestCashier: false,
    isSystemActor: false,
    ...over,
  } as Fila;
}

beforeEach(async () => {
  filas.clear();
  registro.length = 0;
  redisStore.clear();
  vi.clearAllMocks();
  filas.set(
    DUENA,
    nueva({
      id: DUENA,
      email: "carmen@sirope.es",
      alias: "Carmen",
      role: "OWNER",
      pinHash: await hashPassword("9473"),
    }),
  );
  filas.set(
    CAJERA,
    nueva({
      id: CAJERA,
      email: EMAIL_CAJERA,
      alias: "Marta",
      pinHash: await hashPassword("5061"),
      // El caso del bloque: le acaban de reponer el PIN.
      pinProvisionalAt: new Date(),
    }),
  );
});

const conDevice = { "x-device-token": DEVICE_TOKEN };

async function entrarAlTpv(pin: string, email = EMAIL_CAJERA) {
  const app = await buildApp();
  const res = await app.inject({
    method: "POST",
    url: "/shift/cashier-login",
    headers: conDevice,
    payload: { email, pin },
  });
  await app.close();
  return res;
}

// ── 1 · LA PUERTA DEL TPV ───────────────────────────────────────────

describe("el login con un PIN prestado NO emite sesión", () => {
  it("contesta mustChoosePin, sin sessionToken", async () => {
    const res = await entrarAlTpv("5061");
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.mustChoosePin).toBe(true);
    // Lo que importa: NO hay con qué operar.
    expect(body.sessionToken).toBeUndefined();
    expect(body.shiftState).toBeUndefined();
    expect(typeof body.pendingPinChangeToken).toBe("string");
    // Y sabe a quién saludar.
    expect(body.user.alias).toBe("Marta");
  });

  it("con el PIN prestado MAL, el 401 de siempre: no se filtra nada", async () => {
    // La bifurcación va DESPUÉS de comprobar el PIN. Al revés, cualquiera
    // sabría que ese email existe y que acaban de reponerle el PIN.
    const res = await entrarAlTpv("0000");
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe("INVALID_CREDENTIALS");
    expect(res.json().mustChoosePin).toBeUndefined();
  });

  it("no cuenta como acceso: `lastLoginAt` no se toca", async () => {
    // «Último acceso» en Cajeros tiene que seguir queriendo decir
    // «entró». Quien se queda en la pantalla de elegir PIN no ha entrado.
    await entrarAlTpv("5061");
    const escrituras = fakePrisma.user.update.mock.calls.filter(
      ([args]: any[]) => args.data?.lastLoginAt !== undefined,
    );
    expect(escrituras).toHaveLength(0);
  });

  it("con un PIN PROPIO entra como siempre", async () => {
    filas.get(CAJERA)!.pinProvisionalAt = null;
    const res = await entrarAlTpv("5061");
    expect(res.statusCode).toBe(200);
    expect(typeof res.json().sessionToken).toBe("string");
    expect(res.json().mustChoosePin).toBeUndefined();
  });
});

// ── 2 · DONDE SE ELIGE EL PROPIO ────────────────────────────────────

describe("elegir el PIN propio con el token del login", () => {
  async function elegir(token: string, newPin: string) {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/shift/cashier-pin",
      headers: conDevice,
      payload: { pendingPinChangeToken: token, newPin },
    });
    await app.close();
    return res;
  }

  it("deja el PIN PROPIO, y el prestado deja de valer", async () => {
    const token = (await entrarAlTpv("5061")).json().pendingPinChangeToken;
    const res = await elegir(token, "8305");
    expect(res.statusCode).toBe(200);
    const marta = filas.get(CAJERA)!;
    expect(await verifyPassword(marta.pinHash!, "8305")).toBe(true);
    expect(await verifyPassword(marta.pinHash!, "5061")).toBe(false);
    // Y la marca se va: es lo que la deja entrar la próxima vez.
    expect(marta.pinProvisionalAt).toBeNull();
  });

  it("y a partir de ahí, el login entra de verdad", async () => {
    const token = (await entrarAlTpv("5061")).json().pendingPinChangeToken;
    await elegir(token, "8305");
    const dentro = await entrarAlTpv("8305");
    expect(typeof dentro.json().sessionToken).toBe("string");
  });

  it("un PIN trivial se rechaza también aquí", async () => {
    const token = (await entrarAlTpv("5061")).json().pendingPinChangeToken;
    const res = await elegir(token, "1234");
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("PIN_DEMASIADO_FACIL");
    expect(filas.get(CAJERA)!.pinProvisionalAt).not.toBeNull();
  });

  it("el token NO es un pase para cambiarlo cuando se quiera", async () => {
    // El sabotaje: no releer `pinProvisionalAt` de la base. Entonces el
    // token que sobró de la primera vez serviría para cambiar el PIN sin
    // saber el actual — que es justo lo que `/auth/me/pin` sí pide.
    const token = (await entrarAlTpv("5061")).json().pendingPinChangeToken;
    expect((await elegir(token, "8305")).statusCode).toBe(200);
    const segunda = await elegir(token, "9473");
    expect(segunda.statusCode).toBe(409);
    expect(segunda.json().code).toBe("PIN_YA_ELEGIDO");
    expect(await verifyPassword(filas.get(CAJERA)!.pinHash!, "8305")).toBe(true);
  });

  it("un token inventado no abre nada", async () => {
    const res = await elegir("no.es.un.token", "8305");
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe("PIN_ELECCION_CADUCADA");
    expect(filas.get(CAJERA)!.pinProvisionalAt).not.toBeNull();
  });

  it("queda registrado como PROPIO y por el TPV", async () => {
    const token = (await entrarAlTpv("5061")).json().pendingPinChangeToken;
    await elegir(token, "8305");
    expect(registro.at(-1)).toMatchObject({
      targetUserId: CAJERA,
      actorUserId: CAJERA,
      kind: "PROPIO",
      source: "TPV",
    });
  });
});

// ── 3 · LAS PUERTAS QUE UN PIN PRESTADO NO ABRE ─────────────────────

describe("un PIN prestado no autoriza nada", () => {
  it("no entra en el roster offline (si no, basta con quitar la wifi)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/shift/offline-bundle",
      headers: conDevice,
    });
    expect(res.statusCode).toBe(200);
    const emails = res.json().roster.map((u: { email: string }) => u.email);
    expect(emails).toContain("carmen@sirope.es");
    expect(emails).not.toContain(EMAIL_CAJERA);
    await app.close();
  });

  it("y en cuanto elige el suyo, vuelve al roster", async () => {
    filas.get(CAJERA)!.pinProvisionalAt = null;
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/shift/offline-bundle",
      headers: conDevice,
    });
    const emails = res.json().roster.map((u: { email: string }) => u.email);
    expect(emails).toContain(EMAIL_CAJERA);
    await app.close();
  });

  it("no autoriza un descuento (manager-authorize)", async () => {
    // La encargada con PIN prestado: el PIN es correcto y aun así no
    // firma. El 401 es el genérico de siempre — no se revela por qué.
    filas.get(DUENA)!.pinProvisionalAt = new Date();
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/admin/auth/manager-authorize",
      headers: comoCajeraEnElTpv,
      payload: {
        managerEmail: "carmen@sirope.es",
        managerPin: "9473",
        reason: "discount_over_threshold",
      },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe("INVALID_MANAGER_CREDENTIALS");
    await app.close();
  });

  it("con el PIN propio, la misma autorización sí sale", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/admin/auth/manager-authorize",
      headers: comoCajeraEnElTpv,
      payload: {
        managerEmail: "carmen@sirope.es",
        managerPin: "9473",
        reason: "discount_over_threshold",
      },
    });
    expect(res.statusCode).toBe(200);
    await app.close();
  });
});

// ── 4 · QUIÉN LO PONE ───────────────────────────────────────────────

describe("el alta y el reset de personal dejan el PIN PROVISIONAL", () => {
  it("el alta: nace con la marca puesta y su línea de registro", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/cashiers",
      headers: comoDuena,
      payload: {
        email: "nueva@sirope.es",
        alias: "Lucía",
        role: "CASHIER",
        pin: "8305",
      },
    });
    expect(res.statusCode).toBe(201);
    const creada = [...filas.values()].find((f) => f.email === "nueva@sirope.es")!;
    expect(creada.pinProvisionalAt).not.toBeNull();
    expect(registro.at(-1)).toMatchObject({
      targetUserId: creada.id,
      actorUserId: DUENA,
      kind: "PROVISIONAL",
      source: "PERSONAL",
    });
    await app.close();
  });

  it("el alta rechaza un PIN trivial", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/cashiers",
      headers: comoDuena,
      payload: {
        email: "nueva@sirope.es",
        alias: "Lucía",
        role: "CASHIER",
        pin: "1234",
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("PIN_DEMASIADO_FACIL");
    expect([...filas.values()].some((f) => f.email === "nueva@sirope.es")).toBe(
      false,
    );
    await app.close();
  });

  it("el reset: la respuesta lo DICE, para que la dueña lo sepa", async () => {
    filas.get(CAJERA)!.pinProvisionalAt = null;
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/cashiers/${CAJERA}/pin`,
      headers: comoDuena,
      payload: { pin: "8305" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().provisional).toBe(true);
    expect(filas.get(CAJERA)!.pinProvisionalAt).not.toBeNull();
    expect(registro.at(-1)).toMatchObject({
      targetUserId: CAJERA,
      actorUserId: DUENA,
      kind: "PROVISIONAL",
      source: "PERSONAL",
    });
    await app.close();
  });

  it("revocar limpia la marca con el PIN (el CHECK no admite una sin otro)", async () => {
    // Sin esto, revocar a alguien con PIN provisional —que es TODO el
    // personal recién dado de alta— revienta contra la base.
    const app = await buildApp();
    const res = await app.inject({
      method: "DELETE",
      url: `/cashiers/${CAJERA}`,
      headers: comoDuena,
    });
    expect(res.statusCode).toBe(200);
    const marta = filas.get(CAJERA)!;
    expect(marta.pinHash).toBeNull();
    expect(marta.pinProvisionalAt).toBeNull();
    await app.close();
  });
});

// ── 5 · EL INVENTARIO DE LAS CINCO PUERTAS ──────────────────────────
//
// Las tres de arriba se miden ejercitándolas. Las otras dos —anular una
// mesa y cerrar un turno con incidencia, las dos con `managerPin`— viven
// detrás de media pantalla de venta: montarlas aquí serían doscientas
// líneas de falsos para comprobar un `where`.
//
// Así que se miden como `h1-caja-gate.test.ts` mide la puerta de la
// caja: contando el filtro en el fuente, con la lista enumerada. Y con
// un barrido que CAZA LA SEXTA — el día que alguien escriba una ruta
// nueva que verifique un `pin_hash`, este banco se pone rojo hasta que
// decida qué hace con los PIN prestados.
//
// Es el patrón de «un comentario que promete sin cumplir»: la cabecera
// de este fichero dice cinco, así que hay cinco contadas.

const SRC = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "src",
);

/** Las puertas, y cuántas veces filtra cada fichero. */
const PUERTAS: Array<[string, number]> = [
  // El login y el roster offline, los dos en el mismo fichero: el
  // login lo mira con un `if` (para contestar `mustChoosePin`) y el
  // roster con un `where`.
  ["shift/cashier-auth.ts", 1],
  // Cerrar el turno con el PIN de un encargado.
  ["shift/routes.ts", 1],
  // Anular una mesa con el PIN de un encargado.
  ["tables/routes.ts", 1],
  // Autorizar un descuento o la anulación de un fiado.
  ["admin/manager-authorize.ts", 1],
];

describe("el filtro está en las cinco puertas, y no hay una sexta", () => {
  it.each(PUERTAS)("%s filtra el PIN prestado %i vez/veces", (rel, n) => {
    const src = readFileSync(path.join(SRC, rel), "utf8");
    // En posición de `where`/dato, no el nombre suelto: los comentarios
    // también lo nombran.
    const hits = src.match(/pinProvisionalAt: null/g) ?? [];
    expect(hits.length, rel).toBe(n);
  });

  it("el login además contesta `mustChoosePin` en vez de emitir sesión", () => {
    const src = readFileSync(path.join(SRC, "shift/cashier-auth.ts"), "utf8");
    expect(src).toMatch(/user\.pinProvisionalAt != null/);
    expect(src).toContain("mustChoosePin: true");
  });

  it("y NINGÚN otro fichero verifica un `pin_hash` sin decidir", () => {
    // El barrido. Recorre `src` entero buscando quien compruebe un PIN
    // de `users`, y exige que esté en la lista de arriba o en la de
    // exenciones — con su razón escrita.
    const EXENTOS = new Map<string, string>([
      // Las dos rutas que ESCRIBEN el PIN propio: comprueban el actual
      // (`/auth/me/pin`) o el token del login. Un PIN prestado tiene que
      // poder cambiarse — es justo para lo que sirve.
      ["auth/routes.ts", "cambiar el mío: el PIN prestado SÍ se cambia"],
      // El PIN de PUERTA de la residencia es otra tabla (`care_pins`) y
      // otras reglas. El bloque no lo toca.
      ["residencia/pin-de-cuidado.ts", "PIN de puerta, otra tabla"],
      ["residencia/puerta-registro-routes.ts", "PIN de puerta, otra tabla"],
      ["residencia/ficha-routes.ts", "PIN de puerta, otra tabla"],
    ]);

    const sospechosos: string[] = [];
    const recorrer = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const abs = path.join(dir, e.name);
        if (e.isDirectory()) {
          recorrer(abs);
          continue;
        }
        if (!e.name.endsWith(".ts")) continue;
        const src = readFileSync(abs, "utf8");
        // Quien hace `verifyPassword(<algo>pinHash<algo>, …)`.
        if (!/verifyPassword\([^)]*pinHash/.test(src)) continue;
        const rel = path.relative(SRC, abs).split(path.sep).join("/");
        if (PUERTAS.some(([p]) => p === rel)) continue;
        if (EXENTOS.has(rel)) continue;
        sospechosos.push(rel);
      }
    };
    recorrer(SRC);
    expect(sospechosos).toEqual([]);
  });
});
