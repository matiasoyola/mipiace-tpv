// Integration test de Personal + horarios (B-reservas-3): /staff, skills,
// turnos y expansión de rrule. Prisma en memoria; valida el gate por
// `agendaEnabled`, el aislamiento por tenant, la matriz de skills, el CRUD
// de turnos con validación de rrule RFC 5545 y la expansión de la semana
// tipo a franjas concretas (esta última con la librería rrule.js real).

import { randomBytes, randomUUID } from "node:crypto";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.REDIS_URL = "redis://localhost:6379";
process.env.JWT_ACCESS_SECRET = "a".repeat(40);
process.env.JWT_REFRESH_SECRET = "b".repeat(40);
process.env.HOLDED_KEY_ENCRYPTION_SECRET = randomBytes(32).toString("base64");

import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Estado en memoria ────────────────────────────────────────────────
interface FakeUser {
  id: string;
  tenantId: string;
  alias: string | null;
  email: string;
  role: "OWNER" | "MANAGER" | "CASHIER";
  deletedAt: Date | null;
  isTestCashier: boolean;
}
interface FakeProfile {
  userId: string;
  tenantId: string;
  displayName: string;
  active: boolean;
  color: string | null;
}
interface FakeSkill {
  userId: string;
  serviceId: string;
  tenantId: string;
}
interface FakeShift {
  id: string;
  userId: string;
  tenantId: string;
  rrule: string;
  startTime: string;
  endTime: string;
  validFrom: Date;
  validUntil: Date | null;
  kind: "REGULAR" | "REINFORCEMENT" | "SWAP";
}
interface FakeProduct {
  id: string;
  tenantId: string;
  name: string;
  kind: "PRODUCT" | "SERVICE";
  active: boolean;
}

const userStore: FakeUser[] = [];
const profileStore = new Map<string, FakeProfile>();
const skillStore: FakeSkill[] = [];
const shiftStore = new Map<string, FakeShift>();
const productStore: FakeProduct[] = [];
let agendaEnabled = true;

const fakePrisma: any = {
  $transaction: (ops: Promise<unknown>[]) => Promise.all(ops),
  tenant: {
    findUnique: vi.fn(async () => ({ agendaEnabled })),
  },
  user: {
    findFirst: vi.fn(async ({ where }: any) =>
      userStore.find(
        (u) =>
          u.id === where.id &&
          u.tenantId === where.tenantId &&
          u.deletedAt === null &&
          u.isTestCashier === false,
      ) ?? null,
    ),
    findMany: vi.fn(async ({ where }: any) => {
      const rows = userStore.filter(
        (u) =>
          u.tenantId === where.tenantId &&
          where.role.in.includes(u.role) &&
          u.deletedAt === null &&
          u.isTestCashier === false,
      );
      return rows.map((u) => ({
        id: u.id,
        alias: u.alias,
        email: u.email,
        role: u.role,
        staffProfile: profileStore.get(u.id) ?? null,
        staffSkills: skillStore
          .filter((s) => s.userId === u.id)
          .map((s) => ({ serviceId: s.serviceId })),
      }));
    }),
  },
  product: {
    findMany: vi.fn(async ({ where }: any) => {
      let rows = productStore.filter(
        (p) => p.tenantId === where.tenantId && p.kind === where.kind,
      );
      if (where.active !== undefined)
        rows = rows.filter((p) => p.active === where.active);
      if (where.id?.in) rows = rows.filter((p) => where.id.in.includes(p.id));
      return rows.map((p) => ({ id: p.id, name: p.name }));
    }),
  },
  staffProfile: {
    findFirst: vi.fn(async ({ where }: any) => {
      const p = profileStore.get(where.userId);
      return p && p.tenantId === where.tenantId ? p : null;
    }),
    upsert: vi.fn(async ({ where, create, update }: any) => {
      const existing = profileStore.get(where.userId);
      if (existing) {
        Object.assign(existing, update);
        return existing;
      }
      const row: FakeProfile = {
        userId: create.userId,
        tenantId: create.tenantId,
        displayName: create.displayName,
        active: create.active ?? true,
        color: create.color ?? null,
      };
      profileStore.set(row.userId, row);
      return row;
    }),
    deleteMany: vi.fn(async ({ where }: any) => {
      const p = profileStore.get(where.userId);
      if (p && p.tenantId === where.tenantId) profileStore.delete(where.userId);
      return { count: p ? 1 : 0 };
    }),
  },
  staffSkill: {
    findMany: vi.fn(async ({ where }: any) =>
      skillStore.filter(
        (s) => s.userId === where.userId && s.tenantId === where.tenantId,
      ),
    ),
    deleteMany: vi.fn(async ({ where }: any) => {
      let n = 0;
      for (let i = skillStore.length - 1; i >= 0; i--) {
        if (
          skillStore[i]!.userId === where.userId &&
          skillStore[i]!.tenantId === where.tenantId
        ) {
          skillStore.splice(i, 1);
          n++;
        }
      }
      return { count: n };
    }),
    createMany: vi.fn(async ({ data }: any) => {
      for (const d of data) skillStore.push({ ...d });
      return { count: data.length };
    }),
  },
  staffShift: {
    findMany: vi.fn(async ({ where }: any) => {
      let rows = [...shiftStore.values()].filter(
        (s) => s.tenantId === where.tenantId,
      );
      if (where.userId) rows = rows.filter((s) => s.userId === where.userId);
      // Filtro de solape de validez (availability-template).
      if (where.validFrom?.lte) {
        const lte = where.validFrom.lte as Date;
        rows = rows.filter((s) => s.validFrom.getTime() <= lte.getTime());
      }
      if (where.OR) {
        const gte = where.OR[1]?.validUntil?.gte as Date | undefined;
        rows = rows.filter(
          (s) => s.validUntil === null || (gte ? s.validUntil.getTime() >= gte.getTime() : true),
        );
      }
      return rows;
    }),
    create: vi.fn(async ({ data }: any) => {
      const row: FakeShift = {
        id: randomUUID(),
        userId: data.userId,
        tenantId: data.tenantId,
        rrule: data.rrule,
        startTime: data.startTime,
        endTime: data.endTime,
        validFrom: data.validFrom,
        validUntil: data.validUntil ?? null,
        kind: data.kind ?? "REGULAR",
      };
      shiftStore.set(row.id, row);
      return row;
    }),
    findFirst: vi.fn(async ({ where }: any) => {
      const s = shiftStore.get(where.id);
      return s && s.userId === where.userId && s.tenantId === where.tenantId
        ? s
        : null;
    }),
    update: vi.fn(async ({ where, data }: any) => {
      const s = shiftStore.get(where.id)!;
      Object.assign(s, data);
      return s;
    }),
    deleteMany: vi.fn(async ({ where }: any) => {
      const s = shiftStore.get(where.id);
      if (
        s &&
        s.userId === where.userId &&
        s.tenantId === where.tenantId
      ) {
        shiftStore.delete(where.id);
        return { count: 1 };
      }
      return { count: 0 };
    }),
  },
};

vi.mock("../src/context.js", () => ({
  getPrisma: () => fakePrisma,
  getRedis: () => ({ ping: async () => "PONG" }),
  shutdown: async () => undefined,
}));

const { registerStaffRoutes } = await import("../src/staff/routes.js");
const { signAccessToken } = await import("../src/auth/tokens.js");

const TENANT_ID = "00000000-0000-0000-0000-000000000001";
const OTHER_TENANT = "00000000-0000-0000-0000-000000000002";
const OWNER_ID = "11111111-1111-1111-1111-111111111111";
const PRO_ID = "22222222-2222-2222-2222-222222222222";
const TOKEN = signAccessToken({ sub: OWNER_ID, tid: TENANT_ID, role: "OWNER" });
const auth = { authorization: `Bearer ${TOKEN}` };

async function buildApp() {
  const app = Fastify();
  await registerStaffRoutes(app);
  return app;
}

function seedUser(opts: Partial<FakeUser>): FakeUser {
  const row: FakeUser = {
    id: opts.id ?? randomUUID(),
    tenantId: opts.tenantId ?? TENANT_ID,
    alias: opts.alias ?? "Pro",
    email: opts.email ?? `${randomUUID()}@x.com`,
    role: opts.role ?? "CASHIER",
    deletedAt: opts.deletedAt ?? null,
    isTestCashier: opts.isTestCashier ?? false,
  };
  userStore.push(row);
  return row;
}
function seedProduct(opts: Partial<FakeProduct>): FakeProduct {
  const row: FakeProduct = {
    id: opts.id ?? randomUUID(),
    tenantId: opts.tenantId ?? TENANT_ID,
    name: opts.name ?? "Servicio",
    kind: opts.kind ?? "SERVICE",
    active: opts.active ?? true,
  };
  productStore.push(row);
  return row;
}
function seedProfile(userId: string, opts: Partial<FakeProfile> = {}): FakeProfile {
  const row: FakeProfile = {
    userId,
    tenantId: opts.tenantId ?? TENANT_ID,
    displayName: opts.displayName ?? "Profesional",
    active: opts.active ?? true,
    color: opts.color ?? null,
  };
  profileStore.set(userId, row);
  return row;
}

beforeEach(() => {
  userStore.length = 0;
  profileStore.clear();
  skillStore.length = 0;
  shiftStore.clear();
  productStore.length = 0;
  agendaEnabled = true;
  // El OWNER autenticado también es un usuario del tenant.
  seedUser({ id: OWNER_ID, role: "OWNER", alias: "Jefa" });
  seedUser({ id: PRO_ID, role: "CASHIER", alias: "María" });
});

describe("gate por agendaEnabled", () => {
  it("403 cuando la agenda está apagada", async () => {
    agendaEnabled = false;
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/staff", headers: auth });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("AGENDA_DISABLED");
    await app.close();
  });

  it("401 sin token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/staff" });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});

describe("GET /staff", () => {
  it("lista usuarios del tenant con perfil null si no son profesionales", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/staff", headers: auth });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.staff).toHaveLength(2);
    expect(body.staff.every((s: any) => s.profile === null)).toBe(true);
    expect(body.staff[0].skillCount).toBe(0);
    await app.close();
  });

  it("no ve usuarios de otro tenant", async () => {
    seedUser({ tenantId: OTHER_TENANT });
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/staff", headers: auth });
    expect(res.json().staff).toHaveLength(2);
    await app.close();
  });
});

describe("PUT /staff/:userId (perfil)", () => {
  it("crea y luego actualiza el perfil", async () => {
    const app = await buildApp();
    const create = await app.inject({
      method: "PUT",
      url: `/staff/${PRO_ID}`,
      headers: auth,
      payload: { displayName: "María Estilista", color: "#ff8800" },
    });
    expect(create.statusCode).toBe(200);
    expect(create.json().profile.displayName).toBe("María Estilista");
    expect(create.json().profile.active).toBe(true);

    const update = await app.inject({
      method: "PUT",
      url: `/staff/${PRO_ID}`,
      headers: auth,
      payload: { displayName: "María", active: false },
    });
    expect(update.json().profile.active).toBe(false);
    expect(update.json().profile.displayName).toBe("María");
    await app.close();
  });

  it("404 para usuario de otro tenant", async () => {
    const alien = seedUser({ tenantId: OTHER_TENANT });
    const app = await buildApp();
    const res = await app.inject({
      method: "PUT",
      url: `/staff/${alien.id}`,
      headers: auth,
      payload: { displayName: "X" },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});

describe("PUT /staff/:userId/skills", () => {
  it("409 si el usuario no tiene perfil", async () => {
    const svc = seedProduct({});
    const app = await buildApp();
    const res = await app.inject({
      method: "PUT",
      url: `/staff/${PRO_ID}/skills`,
      headers: auth,
      payload: { serviceIds: [svc.id] },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("NO_STAFF_PROFILE");
    await app.close();
  });

  it("fija el set de servicios que da el profesional", async () => {
    seedProfile(PRO_ID);
    const a = seedProduct({ name: "Corte" });
    const b = seedProduct({ name: "Tinte" });
    const app = await buildApp();
    const res = await app.inject({
      method: "PUT",
      url: `/staff/${PRO_ID}/skills`,
      headers: auth,
      payload: { serviceIds: [a.id, b.id] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().serviceIds).toHaveLength(2);
    expect(skillStore.filter((s) => s.userId === PRO_ID)).toHaveLength(2);

    // Reemplazo: dejar sólo uno.
    const res2 = await app.inject({
      method: "PUT",
      url: `/staff/${PRO_ID}/skills`,
      headers: auth,
      payload: { serviceIds: [a.id] },
    });
    expect(res2.json().serviceIds).toEqual([a.id]);
    expect(skillStore.filter((s) => s.userId === PRO_ID)).toHaveLength(1);
    await app.close();
  });

  it("400 si un serviceId no es servicio del tenant", async () => {
    seedProfile(PRO_ID);
    const app = await buildApp();
    const res = await app.inject({
      method: "PUT",
      url: `/staff/${PRO_ID}/skills`,
      headers: auth,
      payload: { serviceIds: [randomUUID()] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("INVALID_SERVICE_ID");
    await app.close();
  });

  it("rechaza un producto que no es SERVICE", async () => {
    seedProfile(PRO_ID);
    const prod = seedProduct({ kind: "PRODUCT" });
    const app = await buildApp();
    const res = await app.inject({
      method: "PUT",
      url: `/staff/${PRO_ID}/skills`,
      headers: auth,
      payload: { serviceIds: [prod.id] },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});

describe("turnos (shifts)", () => {
  it("crea un turno válido y lo lista", async () => {
    seedProfile(PRO_ID);
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/staff/${PRO_ID}/shifts`,
      headers: auth,
      payload: {
        rrule: "FREQ=WEEKLY;BYDAY=MO,TU",
        startTime: "09:30",
        endTime: "14:30",
        validFrom: "2026-08-01",
        kind: "REGULAR",
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().shift.rrule).toBe("FREQ=WEEKLY;BYDAY=MO,TU");

    const list = await app.inject({
      method: "GET",
      url: `/staff/${PRO_ID}/shifts`,
      headers: auth,
    });
    expect(list.json().shifts).toHaveLength(1);
    await app.close();
  });

  it("409 crear turno sin perfil", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/staff/${PRO_ID}/shifts`,
      headers: auth,
      payload: { rrule: "FREQ=WEEKLY;BYDAY=MO", startTime: "09:00", endTime: "14:00", validFrom: "2026-08-01" },
    });
    expect(res.statusCode).toBe(409);
    await app.close();
  });

  it("400 rrule inválida", async () => {
    seedProfile(PRO_ID);
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/staff/${PRO_ID}/shifts`,
      headers: auth,
      payload: { rrule: "esto-no-es-rrule", startTime: "09:00", endTime: "14:00", validFrom: "2026-08-01" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("INVALID_SHIFT");
    await app.close();
  });

  it("400 hora fin <= inicio", async () => {
    seedProfile(PRO_ID);
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/staff/${PRO_ID}/shifts`,
      headers: auth,
      payload: { rrule: "FREQ=WEEKLY;BYDAY=MO", startTime: "14:00", endTime: "09:00", validFrom: "2026-08-01" },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("edita y borra un turno", async () => {
    seedProfile(PRO_ID);
    const app = await buildApp();
    const created = await app.inject({
      method: "POST",
      url: `/staff/${PRO_ID}/shifts`,
      headers: auth,
      payload: { rrule: "FREQ=WEEKLY;BYDAY=MO", startTime: "09:00", endTime: "14:00", validFrom: "2026-08-01" },
    });
    const shiftId = created.json().shift.id;

    const patched = await app.inject({
      method: "PATCH",
      url: `/staff/${PRO_ID}/shifts/${shiftId}`,
      headers: auth,
      payload: { endTime: "15:00", kind: "REINFORCEMENT" },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().shift.endTime).toBe("15:00");
    expect(patched.json().shift.kind).toBe("REINFORCEMENT");

    const del = await app.inject({
      method: "DELETE",
      url: `/staff/${PRO_ID}/shifts/${shiftId}`,
      headers: auth,
    });
    expect(del.statusCode).toBe(200);
    expect(shiftStore.size).toBe(0);
    await app.close();
  });
});

describe("GET /staff/:userId/availability-template", () => {
  it("expande la rrule semanal a franjas concretas del rango", async () => {
    seedProfile(PRO_ID);
    shiftStore.set("s1", {
      id: "s1",
      userId: PRO_ID,
      tenantId: TENANT_ID,
      rrule: "FREQ=WEEKLY;BYDAY=MO",
      startTime: "09:00",
      endTime: "14:00",
      validFrom: new Date("2026-08-03"),
      validUntil: null,
      kind: "REGULAR",
    });
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/staff/${PRO_ID}/availability-template?from=2026-08-01&to=2026-08-31`,
      headers: auth,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    // Lunes de agosto 2026: 3, 10, 17, 24, 31.
    expect(body.slots).toHaveLength(5);
    expect(body.slots.map((s: any) => s.date)).toEqual([
      "2026-08-03",
      "2026-08-10",
      "2026-08-17",
      "2026-08-24",
      "2026-08-31",
    ]);
    expect(body.slots[0].startTime).toBe("09:00");
    expect(body.slots[0].shiftId).toBe("s1");
    await app.close();
  });

  it("respeta la ventana de validez del turno", async () => {
    seedProfile(PRO_ID);
    shiftStore.set("s2", {
      id: "s2",
      userId: PRO_ID,
      tenantId: TENANT_ID,
      rrule: "FREQ=WEEKLY;BYDAY=MO",
      startTime: "09:00",
      endTime: "14:00",
      validFrom: new Date("2026-08-03"),
      validUntil: new Date("2026-08-17"),
      kind: "REGULAR",
    });
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/staff/${PRO_ID}/availability-template?from=2026-08-01&to=2026-08-31`,
      headers: auth,
    });
    // Sólo 3, 10, 17 (validUntil inclusive).
    expect(res.json().slots.map((s: any) => s.date)).toEqual([
      "2026-08-03",
      "2026-08-10",
      "2026-08-17",
    ]);
    await app.close();
  });

  it("400 si el rango es demasiado grande", async () => {
    seedProfile(PRO_ID);
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/staff/${PRO_ID}/availability-template?from=2024-01-01&to=2026-01-01`,
      headers: auth,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("RANGE_TOO_LARGE");
    await app.close();
  });
});
