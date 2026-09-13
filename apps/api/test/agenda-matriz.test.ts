// B-reservas-9 · La matriz servicio × profesional, editable desde los dos
// lados.
//
// Lo que se prueba: que los dos lados escriben LO MISMO (la prueba que
// justifica que haya un solo módulo de escritura), que ninguna de las dos
// vistas esconde el dato que sigue gobernando el comportamiento, que la
// cajera puede mirar y no tocar, y el aislamiento por tenant.

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
const OWNER_ID = "11111111-1111-1111-1111-111111111111";
const SOLE = "22222222-2222-2222-2222-222222222222";
const NURIA = "33333333-3333-3333-3333-333333333333";

interface FakeProduct {
  id: string;
  tenantId: string;
  name: string;
  kind: "PRODUCT" | "SERVICE";
  active: boolean;
}
interface FakeSched {
  productId: string;
  tenantId: string;
  staffRequired: number;
}
interface FakeSkill {
  userId: string;
  serviceId: string;
  tenantId: string;
}
interface FakeProfile {
  userId: string;
  tenantId: string;
  displayName: string;
  active: boolean;
}
interface FakeUser {
  id: string;
  tenantId: string;
  alias: string | null;
  email: string;
  deletedAt: Date | null;
}

const products: FakeProduct[] = [];
const scheduling: FakeSched[] = [];
const skills: FakeSkill[] = [];
const profiles: FakeProfile[] = [];
const users: FakeUser[] = [];
let agendaEnabled = true;

const fakePrisma: any = {
  $transaction: (ops: Promise<unknown>[]) => Promise.all(ops),
  tenant: {
    findUnique: vi.fn(async () => ({ agendaEnabled, agendaSlotMinutes: 15 })),
  },
  product: {
    findMany: vi.fn(async ({ where }: any) => {
      let rows = products.filter(
        (p) => p.tenantId === where.tenantId && p.kind === where.kind,
      );
      if (where.active !== undefined)
        rows = rows.filter((p) => p.active === where.active);
      if (where.id?.in) rows = rows.filter((p) => where.id.in.includes(p.id));
      return rows
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((p) => ({ id: p.id, name: p.name, active: p.active }));
    }),
  },
  serviceScheduling: {
    findMany: vi.fn(async ({ where }: any) =>
      scheduling.filter((s) => s.tenantId === where.tenantId),
    ),
  },
  staffSkill: {
    findMany: vi.fn(async ({ where }: any) =>
      skills.filter(
        (s) =>
          s.tenantId === where.tenantId &&
          (where.userId === undefined || s.userId === where.userId) &&
          (where.serviceId === undefined || s.serviceId === where.serviceId),
      ),
    ),
    deleteMany: vi.fn(async ({ where }: any) => {
      let n = 0;
      for (let i = skills.length - 1; i >= 0; i--) {
        const s = skills[i]!;
        if (
          s.tenantId === where.tenantId &&
          (where.userId === undefined || s.userId === where.userId) &&
          (where.serviceId === undefined || s.serviceId === where.serviceId)
        ) {
          skills.splice(i, 1);
          n++;
        }
      }
      return { count: n };
    }),
    createMany: vi.fn(async ({ data }: any) => {
      for (const d of data) skills.push({ ...d });
      return { count: data.length };
    }),
  },
  staffProfile: {
    findMany: vi.fn(async ({ where }: any) =>
      profiles.filter(
        (p) =>
          p.tenantId === where.tenantId &&
          (where.userId?.in ? where.userId.in.includes(p.userId) : true),
      ),
    ),
  },
  user: {
    findMany: vi.fn(async ({ where }: any) =>
      users
        .filter((u) => u.tenantId === where.tenantId && u.deletedAt === null)
        .map((u) => ({ id: u.id, alias: u.alias, email: u.email })),
    ),
  },
};

vi.mock("../src/context.js", () => ({
  getPrisma: () => fakePrisma,
  getRedis: () => ({ ping: async () => "PONG" }),
  shutdown: async () => undefined,
}));

const { registerAgendaRoutes } = await import("../src/agenda/routes.js");
const { signAccessToken } = await import("../src/auth/tokens.js");

const ownerAuth = {
  authorization: `Bearer ${signAccessToken({
    sub: OWNER_ID,
    tid: TENANT_ID,
    role: "OWNER",
  })}`,
};
const cajeraAuth = {
  authorization: `Bearer ${signAccessToken({
    sub: NURIA,
    tid: TENANT_ID,
    role: "CASHIER",
  })}`,
};

async function buildApp() {
  const app = Fastify();
  await registerAgendaRoutes(app, { prisma: fakePrisma, store: {} as any });
  return app;
}

function seedServicio(
  opts: Partial<FakeProduct & FakeSched> & { agendable?: boolean } = {},
): string {
  const id = opts.id ?? randomUUID();
  products.push({
    id,
    tenantId: opts.tenantId ?? TENANT_ID,
    name: opts.name ?? "Servicio",
    kind: "SERVICE",
    active: opts.active ?? true,
  });
  if (opts.staffRequired !== undefined || opts.agendable !== false) {
    scheduling.push({
      productId: id,
      tenantId: opts.tenantId ?? TENANT_ID,
      staffRequired: opts.staffRequired ?? 1,
    });
  }
  return id;
}

function seedProfesional(userId: string, opts: Partial<FakeProfile> = {}): void {
  users.push({
    id: userId,
    tenantId: opts.tenantId ?? TENANT_ID,
    alias: opts.displayName ?? "Pro",
    email: `${userId}@x.com`,
    deletedAt: null,
  });
  profiles.push({
    userId,
    tenantId: opts.tenantId ?? TENANT_ID,
    displayName: opts.displayName ?? "Profesional",
    active: opts.active ?? true,
  });
}

beforeEach(() => {
  products.length = 0;
  scheduling.length = 0;
  skills.length = 0;
  profiles.length = 0;
  users.length = 0;
  agendaEnabled = true;
});

describe("GET /agenda/skill-matrix", () => {
  it("403 cuando la agenda está apagada", async () => {
    agendaEnabled = false;
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/agenda/skill-matrix",
      headers: ownerAuth,
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  // Regla nº 1 de la auditoría: lo oculto que sigue gobernando está
  // prohibido. Un servicio apagado que conserva profesionales se enseña.
  it("enseña el servicio apagado que conserva sus profesionales", async () => {
    const apagado = seedServicio({ name: "Spa capilar", active: false });
    seedProfesional(SOLE, { displayName: "Sole" });
    skills.push({ userId: SOLE, serviceId: apagado, tenantId: TENANT_ID });
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/agenda/skill-matrix",
      headers: ownerAuth,
    });
    await app.close();
    const svc = res.json().services.find((s: any) => s.id === apagado);
    expect(svc).toBeDefined();
    expect(svc.active).toBe(false);
    expect(svc.staffUserIds).toEqual([SOLE]);
  });

  // El otro lado del mismo principio: una casilla marcada de alguien que el
  // motor ignora se sigue viendo, marcada como lo que es.
  it("enseña al profesional con perfil inactivo y al que no tiene perfil", async () => {
    const svc = seedServicio({ name: "Maderoterapia" });
    seedProfesional(SOLE, { displayName: "Sole", active: false });
    users.push({
      id: NURIA,
      tenantId: TENANT_ID,
      alias: "Nuria",
      email: "n@x.com",
      deletedAt: null,
    });
    skills.push({ userId: SOLE, serviceId: svc, tenantId: TENANT_ID });
    skills.push({ userId: NURIA, serviceId: svc, tenantId: TENANT_ID });
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/agenda/skill-matrix",
      headers: ownerAuth,
    });
    await app.close();
    const staff = res.json().staff;
    const sole = staff.find((s: any) => s.userId === SOLE);
    const nuria = staff.find((s: any) => s.userId === NURIA);
    expect(sole).toMatchObject({ active: false, hasProfile: true });
    expect(nuria).toMatchObject({ active: false, hasProfile: false });
    expect(nuria.displayName).toBe("Nuria");
  });

  it("no se ve la matriz de otro centro", async () => {
    seedServicio({ name: "De otro", tenantId: OTRO_TENANT });
    seedProfesional(SOLE, { displayName: "Ajena", tenantId: OTRO_TENANT });
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/agenda/skill-matrix",
      headers: ownerAuth,
    });
    await app.close();
    expect(res.json().services).toEqual([]);
    expect(res.json().staff).toEqual([]);
  });

  it("la cajera la ve, pero no editable", async () => {
    seedServicio({ name: "Maderoterapia" });
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/agenda/skill-matrix",
      headers: cajeraAuth,
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json().editable).toBe(false);
    expect(res.json().services).toHaveLength(1);
  });
});

describe("la matriz escribe igual desde los dos lados", () => {
  it("el mismo par (profesional, servicio) sale igual por las dos vías", async () => {
    const svc = seedServicio({ name: "Maderoterapia" });
    seedProfesional(SOLE, { displayName: "Sole" });
    const app = await buildApp();

    // Lado B · desde el servicio.
    const porServicio = await app.inject({
      method: "PUT",
      url: `/agenda/skill-matrix/service/${svc}`,
      headers: ownerAuth,
      payload: { staffUserIds: [SOLE] },
    });
    expect(porServicio.statusCode).toBe(200);
    const filasPorServicio = skills.map((s) => ({ ...s }));

    // Se deshace y se hace lo mismo por el otro lado.
    skills.length = 0;
    const porProfesional = await app.inject({
      method: "PUT",
      url: `/agenda/skill-matrix/staff/${SOLE}`,
      headers: ownerAuth,
      payload: { serviceIds: [svc] },
    });
    await app.close();
    expect(porProfesional.statusCode).toBe(200);

    expect(skills).toEqual(filasPorServicio);
    expect(skills).toEqual([
      { userId: SOLE, serviceId: svc, tenantId: TENANT_ID },
    ]);
  });

  it("quitar desde el servicio quita lo mismo que quitar desde el profesional", async () => {
    const svc = seedServicio({ name: "Maderoterapia" });
    seedProfesional(SOLE, { displayName: "Sole" });
    skills.push({ userId: SOLE, serviceId: svc, tenantId: TENANT_ID });
    const app = await buildApp();
    await app.inject({
      method: "PUT",
      url: `/agenda/skill-matrix/service/${svc}`,
      headers: ownerAuth,
      payload: { staffUserIds: [] },
    });
    expect(skills).toEqual([]);

    skills.push({ userId: SOLE, serviceId: svc, tenantId: TENANT_ID });
    await app.inject({
      method: "PUT",
      url: `/agenda/skill-matrix/staff/${SOLE}`,
      headers: ownerAuth,
      payload: { serviceIds: [] },
    });
    await app.close();
    expect(skills).toEqual([]);
  });

  // No se borra y se recrea el tramo entero: una celda que ya estaba no se
  // toca (conserva su `created_at`).
  it("no reescribe las celdas que ya estaban", async () => {
    const uno = seedServicio({ name: "Uno" });
    const dos = seedServicio({ name: "Dos" });
    seedProfesional(SOLE, { displayName: "Sole" });
    skills.push({ userId: SOLE, serviceId: uno, tenantId: TENANT_ID });
    const app = await buildApp();
    fakePrisma.staffSkill.createMany.mockClear();
    fakePrisma.staffSkill.deleteMany.mockClear();
    await app.inject({
      method: "PUT",
      url: `/agenda/skill-matrix/staff/${SOLE}`,
      headers: ownerAuth,
      payload: { serviceIds: [uno, dos] },
    });
    await app.close();
    expect(fakePrisma.staffSkill.deleteMany).not.toHaveBeenCalled();
    expect(fakePrisma.staffSkill.createMany).toHaveBeenCalledWith({
      data: [{ userId: SOLE, serviceId: dos, tenantId: TENANT_ID }],
    });
  });
});

describe("las dos vías fallan igual", () => {
  it("409 si el profesional no tiene perfil de agenda (los dos lados)", async () => {
    const svc = seedServicio({ name: "Maderoterapia" });
    users.push({
      id: NURIA,
      tenantId: TENANT_ID,
      alias: "Nuria",
      email: "n@x.com",
      deletedAt: null,
    });
    const app = await buildApp();
    const a = await app.inject({
      method: "PUT",
      url: `/agenda/skill-matrix/staff/${NURIA}`,
      headers: ownerAuth,
      payload: { serviceIds: [svc] },
    });
    const b = await app.inject({
      method: "PUT",
      url: `/agenda/skill-matrix/service/${svc}`,
      headers: ownerAuth,
      payload: { staffUserIds: [NURIA] },
    });
    await app.close();
    expect(a.statusCode).toBe(409);
    expect(b.statusCode).toBe(409);
    expect(a.json().error).toBe("NO_STAFF_PROFILE");
    expect(b.json().error).toBe(a.json().error);
    expect(b.json().message).toBe(a.json().message);
    expect(skills).toEqual([]);
  });

  it("400 con un servicio de otro centro (los dos lados)", async () => {
    const ajeno = seedServicio({ name: "Ajeno", tenantId: OTRO_TENANT });
    seedProfesional(SOLE, { displayName: "Sole" });
    const app = await buildApp();
    const a = await app.inject({
      method: "PUT",
      url: `/agenda/skill-matrix/staff/${SOLE}`,
      headers: ownerAuth,
      payload: { serviceIds: [ajeno] },
    });
    const b = await app.inject({
      method: "PUT",
      url: `/agenda/skill-matrix/service/${ajeno}`,
      headers: ownerAuth,
      payload: { staffUserIds: [SOLE] },
    });
    await app.close();
    expect(a.statusCode).toBe(400);
    expect(b.statusCode).toBe(400);
    expect(a.json().error).toBe("INVALID_SERVICE_ID");
    expect(b.json().error).toBe("INVALID_SERVICE_ID");
    expect(skills).toEqual([]);
  });

  it("403 a la cajera en los dos lados, y no escribe nada", async () => {
    const svc = seedServicio({ name: "Maderoterapia" });
    seedProfesional(SOLE, { displayName: "Sole" });
    const app = await buildApp();
    const a = await app.inject({
      method: "PUT",
      url: `/agenda/skill-matrix/staff/${SOLE}`,
      headers: cajeraAuth,
      payload: { serviceIds: [svc] },
    });
    const b = await app.inject({
      method: "PUT",
      url: `/agenda/skill-matrix/service/${svc}`,
      headers: cajeraAuth,
      payload: { staffUserIds: [SOLE] },
    });
    await app.close();
    expect(a.statusCode).toBe(403);
    expect(b.statusCode).toBe(403);
    expect(skills).toEqual([]);
  });

  it("un profesional de otro centro no se puede asignar", async () => {
    const svc = seedServicio({ name: "Maderoterapia" });
    seedProfesional(SOLE, { displayName: "Ajena", tenantId: OTRO_TENANT });
    const app = await buildApp();
    const res = await app.inject({
      method: "PUT",
      url: `/agenda/skill-matrix/service/${svc}`,
      headers: ownerAuth,
      payload: { staffUserIds: [SOLE] },
    });
    await app.close();
    expect(res.statusCode).toBe(409);
    expect(skills).toEqual([]);
  });
});
