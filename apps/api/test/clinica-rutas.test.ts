// clinica-1 · las rutas clínicas, con Prisma en memoria.
//
// Lo que se prueba aquí y no en el e2e: lo que decide la APLICACIÓN. El
// motor (que no se borra, que no se edita, que el registro es append-only)
// lo prueba `clinica-historia.e2e.ts` contra Postgres de verdad, porque
// eso es justamente lo que un fake no puede probar.
//
// Las cuatro garantías de este fichero:
//
//   1. Con el módulo apagado, las rutas contestan 404 — y la 404 es
//      INDISTINGUIBLE de una ruta que no existe.
//   2. Cada lectura deja su línea en el registro. **Y la denegada
//      también.**
//   3. La anotación nace con autor, y no hay forma de editarla (no hay
//      ruta).
//   4. Dar y revocar acceso a mano es sólo de la dueña o el encargado, y
//      revocar NO borra.

import { randomBytes, randomUUID } from "node:crypto";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.REDIS_URL = "redis://localhost:6379";
process.env.JWT_ACCESS_SECRET = "a".repeat(40);
process.env.JWT_REFRESH_SECRET = "b".repeat(40);
process.env.HOLDED_KEY_ENCRYPTION_SECRET = randomBytes(32).toString("base64");

import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";

const TENANT_ID = "00000000-0000-0000-0000-000000000001";
const OTRO_TENANT = "00000000-0000-0000-0000-000000000002";
const DUENA_ID = "11111111-1111-1111-1111-111111111111";
const SANITARIA_ID = "22222222-2222-2222-2222-222222222222";
const CAJERA_ID = "33333333-3333-3333-3333-333333333333";
const PACIENTE_ID = "44444444-4444-4444-4444-444444444444";

// ── Prisma en memoria ────────────────────────────────────────────────

let clinicaEncendida = true;

interface FakeUser {
  id: string;
  tenantId: string;
  role: "OWNER" | "MANAGER" | "CASHIER" | "CLINICIAN";
  isClinician: boolean;
  clinicalScope: "ALL" | "SELECTION";
  alias: string | null;
  email: string;
  deletedAt: Date | null;
}
const users = new Map<string, FakeUser>();

interface FakeAccess {
  id: string;
  tenantId: string;
  clinicianUserId: string;
  clientId: string;
  source: "APPOINTMENT" | "MANUAL";
  grantedAt: Date;
  grantedByUserId: string | null;
  revokedAt: Date | null;
  revokedByUserId: string | null;
}
const accesos: FakeAccess[] = [];

interface FakeLog {
  id: string;
  tenantId: string;
  userId: string;
  clientId: string;
  action: string;
  outcome: string;
  at: Date;
  deviceId: string | null;
  route: string | null;
}
const registro: FakeLog[] = [];

interface FakeEntry {
  id: string;
  tenantId: string;
  clientId: string;
  authorUserId: string;
  appointmentId: string | null;
  kind: string;
  body: unknown;
  createdAt: Date;
}
const entradas: FakeEntry[] = [];
const anotaciones: Array<{
  id: string;
  tenantId: string;
  entryId: string;
  authorUserId: string;
  body: unknown;
  createdAt: Date;
}> = [];

const clientes = new Map<string, { id: string; tenantId: string; firstName: string; lastName: string }>();

function autorDe(id: string) {
  const u = users.get(id);
  return { id, alias: u?.alias ?? null, email: u?.email ?? "x@x.com" };
}

// Si este flag se pone, el `create` del registro revienta. Es el sabotaje
// de «la línea no se puede escribir» de la tabla del bloque.
let registroRoto = false;

const fakePrisma = {
  tenant: {
    findUnique: vi.fn(async () => ({
      clinicalRecordsEnabled: clinicaEncendida,
    })),
  },
  user: {
    findFirst: vi.fn(async ({ where }: any) => {
      const u = users.get(where.id);
      if (!u) return null;
      if (where.tenantId && u.tenantId !== where.tenantId) return null;
      if (where.deletedAt === null && u.deletedAt !== null) return null;
      return u;
    }),
  },
  client: {
    findFirst: vi.fn(async ({ where }: any) => {
      const c = clientes.get(where.id);
      if (!c || c.tenantId !== where.tenantId) return null;
      return { id: c.id };
    }),
  },
  clinicalAccess: {
    findFirst: vi.fn(async ({ where }: any) => {
      const f = accesos.find(
        (a) =>
          a.tenantId === where.tenantId &&
          a.clinicianUserId === where.clinicianUserId &&
          a.clientId === where.clientId &&
          a.revokedAt === null,
      );
      return f ? { id: f.id } : null;
    }),
    findMany: vi.fn(async ({ where }: any) =>
      accesos
        .filter(
          (a) =>
            a.tenantId === where.tenantId &&
            a.clinicianUserId === where.clinicianUserId &&
            a.revokedAt === null,
        )
        .map((a) => ({
          ...a,
          client: {
            firstName: clientes.get(a.clientId)?.firstName ?? "?",
            lastName: clientes.get(a.clientId)?.lastName ?? "?",
          },
        })),
    ),
    create: vi.fn(async ({ data }: any) => {
      const row: FakeAccess = {
        id: randomUUID(),
        tenantId: data.tenantId,
        clinicianUserId: data.clinicianUserId,
        clientId: data.clientId,
        source: data.source,
        grantedAt: new Date(),
        grantedByUserId: data.grantedByUserId ?? null,
        revokedAt: null,
        revokedByUserId: null,
      };
      accesos.push(row);
      return { id: row.id };
    }),
    update: vi.fn(async ({ where, data }: any) => {
      const row = accesos.find((a) => a.id === where.id)!;
      row.revokedAt = data.revokedAt;
      row.revokedByUserId = data.revokedByUserId;
      return { id: row.id };
    }),
  },
  clinicalAccessLog: {
    create: vi.fn(async ({ data }: any) => {
      if (registroRoto) throw new Error("append-only table unavailable");
      const row: FakeLog = {
        id: randomUUID(),
        tenantId: data.tenantId,
        userId: data.userId,
        clientId: data.clientId,
        action: data.action,
        outcome: data.outcome,
        at: new Date(),
        deviceId: data.deviceId ?? null,
        route: data.route ?? null,
      };
      registro.push(row);
      return row;
    }),
    findMany: vi.fn(async ({ where }: any) =>
      registro
        .filter(
          (r) => r.tenantId === where.tenantId && r.clientId === where.clientId,
        )
        .slice()
        .reverse()
        .map((r) => ({ ...r, user: autorDe(r.userId) })),
    ),
  },
  clinicalEntry: {
    findFirst: vi.fn(async ({ where }: any) => {
      const e = entradas.find(
        (x) => x.id === where.id && x.tenantId === where.tenantId,
      );
      return e ? { id: e.id, clientId: e.clientId } : null;
    }),
    findMany: vi.fn(async ({ where }: any) =>
      entradas
        .filter(
          (e) => e.tenantId === where.tenantId && e.clientId === where.clientId,
        )
        .slice()
        .reverse()
        .map((e) => ({
          ...e,
          author: autorDe(e.authorUserId),
          addenda: anotaciones
            .filter((a) => a.entryId === e.id)
            .map((a) => ({ ...a, author: autorDe(a.authorUserId) })),
        })),
    ),
    create: vi.fn(async ({ data }: any) => {
      const row: FakeEntry = {
        id: randomUUID(),
        tenantId: data.tenantId,
        clientId: data.clientId,
        authorUserId: data.authorUserId,
        appointmentId: data.appointmentId ?? null,
        kind: data.kind ?? "NOTE",
        body: data.body,
        createdAt: new Date(),
      };
      entradas.push(row);
      return { ...row, author: autorDe(row.authorUserId) };
    }),
  },
  clinicalAddendum: {
    create: vi.fn(async ({ data }: any) => {
      const row = {
        id: randomUUID(),
        tenantId: data.tenantId,
        entryId: data.entryId,
        authorUserId: data.authorUserId,
        body: data.body,
        createdAt: new Date(),
      };
      anotaciones.push(row);
      return { ...row, author: autorDe(row.authorUserId) };
    }),
  },
  appointment: {
    findFirst: vi.fn(async () => null),
  },
} as const;

vi.mock("../src/context.js", () => ({
  getPrisma: () => fakePrisma,
  getRedis: () => ({ ping: async () => "PONG" }),
  shutdown: async () => undefined,
}));

const { registerClinicaRoutes } = await import("../src/clinica/routes.js");
const { signAccessToken } = await import("../src/auth/tokens.js");

function tokenDe(userId: string, role: FakeUser["role"], tid = TENANT_ID) {
  return signAccessToken({ sub: userId, tid, role });
}
const comoDuena = { authorization: `Bearer ${tokenDe(DUENA_ID, "OWNER")}` };
const comoSanitaria = {
  authorization: `Bearer ${tokenDe(SANITARIA_ID, "CLINICIAN")}`,
};
const comoCajera = { authorization: `Bearer ${tokenDe(CAJERA_ID, "CASHIER")}` };

async function buildApp() {
  const app = Fastify();
  await registerClinicaRoutes(app);
  return app;
}

beforeEach(() => {
  clinicaEncendida = true;
  registroRoto = false;
  users.clear();
  accesos.length = 0;
  registro.length = 0;
  entradas.length = 0;
  anotaciones.length = 0;
  clientes.clear();

  users.set(DUENA_ID, {
    id: DUENA_ID,
    tenantId: TENANT_ID,
    role: "OWNER",
    // La dueña del caso: NO sanitaria. Administra y no ve historias.
    isClinician: false,
    clinicalScope: "SELECTION",
    alias: "Pilar",
    email: "pilar@clinica.es",
    deletedAt: null,
  });
  users.set(SANITARIA_ID, {
    id: SANITARIA_ID,
    tenantId: TENANT_ID,
    role: "CLINICIAN",
    isClinician: true,
    clinicalScope: "SELECTION",
    alias: "Lucía",
    email: "lucia@clinica.es",
    deletedAt: null,
  });
  users.set(CAJERA_ID, {
    id: CAJERA_ID,
    tenantId: TENANT_ID,
    role: "CASHIER",
    isClinician: false,
    clinicalScope: "SELECTION",
    alias: "Marta",
    email: "marta@clinica.es",
    deletedAt: null,
  });
  clientes.set(PACIENTE_ID, {
    id: PACIENTE_ID,
    tenantId: TENANT_ID,
    firstName: "Antonio",
    lastName: "Gil",
  });
});

function daleAcceso(clinicianUserId: string, clientId = PACIENTE_ID) {
  accesos.push({
    id: randomUUID(),
    tenantId: TENANT_ID,
    clinicianUserId,
    clientId,
    source: "APPOINTMENT",
    grantedAt: new Date(),
    grantedByUserId: null,
    revokedAt: null,
    revokedByUserId: null,
  });
}

// ── 1 · con el módulo apagado, no existe ─────────────────────────────

describe("clinica-1 · con el módulo apagado las rutas NO EXISTEN", () => {
  it("404 y no 403: un bar no se entera de que el módulo existe", async () => {
    clinicaEncendida = false;
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/clinica/clients/${PACIENTE_ID}/entries`,
      headers: comoSanitaria,
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("la 404 es INDISTINGUIBLE de la de una ruta que no existe", async () => {
    // Si el cuerpo se separara del de Fastify, bastaría comparar dos
    // respuestas para saber que el módulo está ahí. Eso es destaparlo.
    clinicaEncendida = false;
    const app = await buildApp();
    const gateada = await app.inject({
      method: "GET",
      url: `/clinica/clients/${PACIENTE_ID}/entries`,
      headers: comoSanitaria,
    });
    const inexistente = await app.inject({
      method: "GET",
      url: `/clinica/clients/${PACIENTE_ID}/entriez`,
      headers: comoSanitaria,
    });
    expect(gateada.statusCode).toBe(inexistente.statusCode);
    expect(Object.keys(gateada.json()).sort()).toEqual(
      Object.keys(inexistente.json()).sort(),
    );
    expect(gateada.json().error).toBe(inexistente.json().error);
    expect(gateada.json().message).toMatch(/^Route GET:.*not found$/);
    await app.close();
  });

  it("y no deja ni una línea en el registro: no hubo acceso que apuntar", async () => {
    clinicaEncendida = false;
    const app = await buildApp();
    await app.inject({
      method: "GET",
      url: `/clinica/clients/${PACIENTE_ID}/entries`,
      headers: comoSanitaria,
    });
    expect(registro).toHaveLength(0);
    await app.close();
  });
});

// ── 2 · todo acceso se apunta, también el denegado ───────────────────

describe("clinica-1 · cada acceso deja su línea en el registro", () => {
  it("la lectura permitida deja una línea ALLOWED con la ruta", async () => {
    daleAcceso(SANITARIA_ID);
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/clinica/clients/${PACIENTE_ID}/entries`,
      headers: comoSanitaria,
    });
    expect(res.statusCode).toBe(200);
    expect(registro).toHaveLength(1);
    expect(registro[0]).toMatchObject({
      userId: SANITARIA_ID,
      clientId: PACIENTE_ID,
      action: "READ",
      outcome: "ALLOWED",
    });
    expect(registro[0]!.route).toBe(
      `GET /clinica/clients/${PACIENTE_ID}/entries`,
    );
    await app.close();
  });

  it("LA DENEGADA TAMBIÉN: la cajera lo intenta y queda escrito", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/clinica/clients/${PACIENTE_ID}/entries`,
      headers: comoCajera,
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("NO_SANITARIO");
    expect(registro).toHaveLength(1);
    expect(registro[0]).toMatchObject({
      userId: CAJERA_ID,
      outcome: "DENIED",
      action: "READ",
    });
    await app.close();
  });

  it("la sanitaria SIN acceso a ese paciente: 403 y línea DENIED", async () => {
    // Tiene acceso a otro paciente, no a éste.
    daleAcceso(SANITARIA_ID, randomUUID());
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/clinica/clients/${PACIENTE_ID}/entries`,
      headers: comoSanitaria,
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("SIN_ACCESO_AL_PACIENTE");
    expect(registro[0]!.outcome).toBe("DENIED");
    await app.close();
  });

  it("la DUEÑA NO sanitaria no ve la historia, y su intento queda escrito", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/clinica/clients/${PACIENTE_ID}/entries`,
      headers: comoDuena,
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("NO_SANITARIO");
    expect(registro[0]).toMatchObject({
      userId: DUENA_ID,
      outcome: "DENIED",
    });
    await app.close();
  });

  it("si la línea NO se puede escribir, la petición falla y no se lee nada", async () => {
    // Trazabilidad por encima de disponibilidad: aquí nadie pierde nada
    // si la lectura no ocurre, y lo que no se puede perder es la prueba
    // de que ocurrió. (Al contrario que un cobro — ver la cabecera de
    // `registro.ts`.)
    daleAcceso(SANITARIA_ID);
    registroRoto = true;
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/clinica/clients/${PACIENTE_ID}/entries`,
      headers: comoSanitaria,
    });
    expect(res.statusCode).toBe(500);
    expect(res.json().code).toBe("CLINICAL_ACCESS_LOG_FAILED");
    await app.close();
  });

  it("escribir también se apunta, y como WRITE", async () => {
    daleAcceso(SANITARIA_ID);
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/clinica/clients/${PACIENTE_ID}/entries`,
      headers: comoSanitaria,
      payload: { body: { texto: "Desbridamiento zona 3" } },
    });
    expect(res.statusCode).toBe(201);
    expect(registro[0]).toMatchObject({ action: "WRITE", outcome: "ALLOWED" });
    await app.close();
  });

  it("un paciente de OTRO tenant es 404 antes de apuntar nada", async () => {
    // El aislamiento va ANTES de la autorización clínica: un id de otro
    // tenant no debe ni generar una línea, porque "intentó ver la
    // historia de X" sería mentira — X no es de esta clínica.
    clientes.set("55555555-5555-5555-5555-555555555555", {
      id: "55555555-5555-5555-5555-555555555555",
      tenantId: OTRO_TENANT,
      firstName: "Ajeno",
      lastName: "Ajeno",
    });
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/clinica/clients/55555555-5555-5555-5555-555555555555/entries",
      headers: comoSanitaria,
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("CLIENT_NOT_FOUND");
    expect(registro).toHaveLength(0);
    await app.close();
  });
});

// ── 3 · la historia nace con autor y no se edita ─────────────────────

describe("clinica-1 · la anotación tiene autor y no se edita", () => {
  it("la entrada guarda al autor, y lo devuelve con su nombre visible", async () => {
    daleAcceso(SANITARIA_ID);
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/clinica/clients/${PACIENTE_ID}/entries`,
      headers: comoSanitaria,
      payload: { body: { texto: "Primera visita" } },
    });
    expect(res.statusCode).toBe(201);
    expect(entradas[0]!.authorUserId).toBe(SANITARIA_ID);
    expect(res.json().entry.author.name).toBe("Lucía");
    await app.close();
  });

  it("NO hay ruta para editar ni para borrar una entrada", async () => {
    // La inmutabilidad de verdad la hace el trigger (e2e). Esto prueba la
    // otra mitad: que la aplicación no ofrece la puerta.
    daleAcceso(SANITARIA_ID);
    const app = await buildApp();
    await app.inject({
      method: "POST",
      url: `/clinica/clients/${PACIENTE_ID}/entries`,
      headers: comoSanitaria,
      payload: { body: { texto: "x" } },
    });
    const id = entradas[0]!.id;
    for (const method of ["PATCH", "PUT", "DELETE"] as const) {
      const res = await app.inject({
        method,
        url: `/clinica/entries/${id}`,
        headers: comoSanitaria,
        payload: { body: { texto: "cambiado" } },
      });
      expect(res.statusCode).toBe(404);
    }
    expect(entradas[0]!.body).toEqual({ texto: "x" });
    await app.close();
  });

  it("corregir es AÑADIR: la anotación cuelga con su propio autor", async () => {
    daleAcceso(SANITARIA_ID);
    const app = await buildApp();
    await app.inject({
      method: "POST",
      url: `/clinica/clients/${PACIENTE_ID}/entries`,
      headers: comoSanitaria,
      payload: { body: { texto: "Zona 2" } },
    });
    const entryId = entradas[0]!.id;
    const res = await app.inject({
      method: "POST",
      url: `/clinica/entries/${entryId}/addenda`,
      headers: comoSanitaria,
      payload: { body: { texto: "Era la zona 3" } },
    });
    expect(res.statusCode).toBe(201);
    expect(anotaciones).toHaveLength(1);
    expect(anotaciones[0]!.authorUserId).toBe(SANITARIA_ID);
    // Y la entrada original sigue diciendo lo que decía.
    expect(entradas[0]!.body).toEqual({ texto: "Zona 2" });
    await app.close();
  });

  it("el cuerpo vacío no entra (la base también lo rechazaría)", async () => {
    daleAcceso(SANITARIA_ID);
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/clinica/clients/${PACIENTE_ID}/entries`,
      headers: comoSanitaria,
      payload: { body: {} },
    });
    expect(res.statusCode).toBe(400);
    expect(entradas).toHaveLength(0);
    await app.close();
  });

  it("anotar una entrada comprueba el acceso SOBRE SU paciente, no sobre uno que diga el llamante", async () => {
    // La entrada da el `clientId`. Si lo diera la URL, el llamante podría
    // elegir contra qué paciente se comprueba su acceso.
    entradas.push({
      id: "66666666-6666-6666-6666-666666666666",
      tenantId: TENANT_ID,
      clientId: PACIENTE_ID,
      authorUserId: SANITARIA_ID,
      appointmentId: null,
      kind: "NOTE",
      body: { texto: "x" },
      createdAt: new Date(),
    });
    // La sanitaria tiene acceso a OTRO paciente.
    daleAcceso(SANITARIA_ID, randomUUID());
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/clinica/entries/66666666-6666-6666-6666-666666666666/addenda",
      headers: comoSanitaria,
      payload: { body: { texto: "no" } },
    });
    expect(res.statusCode).toBe(403);
    expect(registro[0]).toMatchObject({
      clientId: PACIENTE_ID,
      outcome: "DENIED",
    });
    await app.close();
  });
});

// ── 4 · dar y revocar acceso a mano ──────────────────────────────────

describe("clinica-1 · dar y revocar acceso es de la dueña o el encargado", () => {
  it("la dueña NO sanitaria SÍ gestiona accesos (administra, no mira)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/clinica/clinicians/${SANITARIA_ID}/clients`,
      headers: comoDuena,
      payload: { clientId: PACIENTE_ID },
    });
    expect(res.statusCode).toBe(201);
    expect(accesos[0]).toMatchObject({
      source: "MANUAL",
      grantedByUserId: DUENA_ID,
      revokedAt: null,
    });
    await app.close();
  });

  it("la cajera no, y la SANITARIA tampoco se da acceso a sí misma", async () => {
    const app = await buildApp();
    for (const headers of [comoCajera, comoSanitaria]) {
      const res = await app.inject({
        method: "POST",
        url: `/clinica/clinicians/${SANITARIA_ID}/clients`,
        headers,
        payload: { clientId: PACIENTE_ID },
      });
      expect(res.statusCode).toBe(403);
    }
    expect(accesos).toHaveLength(0);
    await app.close();
  });

  it("dos toques seguidos no crean dos accesos", async () => {
    const app = await buildApp();
    const a = await app.inject({
      method: "POST",
      url: `/clinica/clinicians/${SANITARIA_ID}/clients`,
      headers: comoDuena,
      payload: { clientId: PACIENTE_ID },
    });
    const b = await app.inject({
      method: "POST",
      url: `/clinica/clinicians/${SANITARIA_ID}/clients`,
      headers: comoDuena,
      payload: { clientId: PACIENTE_ID },
    });
    expect(a.json().created).toBe(true);
    expect(b.statusCode).toBe(200);
    expect(b.json().created).toBe(false);
    expect(accesos).toHaveLength(1);
    await app.close();
  });

  it("dar acceso a quien NO es sanitario se niega con su motivo", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/clinica/clinicians/${CAJERA_ID}/clients`,
      headers: comoDuena,
      payload: { clientId: PACIENTE_ID },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("NOT_A_CLINICIAN");
    await app.close();
  });

  it("REVOCAR NO BORRA: rellena la fecha y firma quién", async () => {
    daleAcceso(SANITARIA_ID);
    const app = await buildApp();
    const res = await app.inject({
      method: "DELETE",
      url: `/clinica/clinicians/${SANITARIA_ID}/clients/${PACIENTE_ID}`,
      headers: comoDuena,
    });
    expect(res.statusCode).toBe(200);
    // La fila SIGUE AHÍ. Es el histórico: dice quién pudo ver qué y hasta
    // cuándo.
    expect(accesos).toHaveLength(1);
    expect(accesos[0]!.revokedAt).not.toBeNull();
    expect(accesos[0]!.revokedByUserId).toBe(DUENA_ID);
    await app.close();
  });

  it("tras revocar, la sanitaria ya no ve la historia", async () => {
    daleAcceso(SANITARIA_ID);
    const app = await buildApp();
    await app.inject({
      method: "DELETE",
      url: `/clinica/clinicians/${SANITARIA_ID}/clients/${PACIENTE_ID}`,
      headers: comoDuena,
    });
    const res = await app.inject({
      method: "GET",
      url: `/clinica/clients/${PACIENTE_ID}/entries`,
      headers: comoSanitaria,
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it("la selección dice de dónde vino cada paciente", async () => {
    daleAcceso(SANITARIA_ID); // source APPOINTMENT
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/clinica/clinicians/${SANITARIA_ID}/clients`,
      headers: comoDuena,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().clients).toHaveLength(1);
    expect(res.json().clients[0]).toMatchObject({
      clientId: PACIENTE_ID,
      name: "Antonio Gil",
      source: "APPOINTMENT",
    });
    await app.close();
  });

  it("el registro de accesos es para la dueña, no para la sanitaria", async () => {
    const app = await buildApp();
    const deLaDuena = await app.inject({
      method: "GET",
      url: `/clinica/clients/${PACIENTE_ID}/access-log`,
      headers: comoDuena,
    });
    expect(deLaDuena.statusCode).toBe(200);
    const deLaSanitaria = await app.inject({
      method: "GET",
      url: `/clinica/clients/${PACIENTE_ID}/access-log`,
      headers: comoSanitaria,
    });
    expect(deLaSanitaria.statusCode).toBe(403);
    await app.close();
  });

  it("y el registro enseña los DENEGADOS, que son los que interesan", async () => {
    const app = await buildApp();
    await app.inject({
      method: "GET",
      url: `/clinica/clients/${PACIENTE_ID}/entries`,
      headers: comoCajera,
    });
    const res = await app.inject({
      method: "GET",
      url: `/clinica/clients/${PACIENTE_ID}/access-log`,
      headers: comoDuena,
    });
    const linea = res
      .json()
      .accesses.find((a: { outcome: string }) => a.outcome === "DENIED");
    expect(linea).toBeDefined();
    expect(linea.user.name).toBe("Marta");
    await app.close();
  });

  it("con el módulo apagado, gestionar accesos también es 404", async () => {
    clinicaEncendida = false;
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/clinica/clinicians/${SANITARIA_ID}/clients`,
      headers: comoDuena,
      payload: { clientId: PACIENTE_ID },
    });
    // 404 y no 403: el gate corre ANTES del guard de rol, para que el 403
    // no destape el módulo.
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});
