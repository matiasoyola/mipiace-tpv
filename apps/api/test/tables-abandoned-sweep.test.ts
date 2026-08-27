// v1.12-mesas-abandonadas · el barrido que suelta las mesas que nadie
// cerró, contra un prisma falso.
//
// El criterio de "funciona" del bloque, traducido a tests:
//   - las cuatro mesas de Sirope (DRAFT vacío del 9 de julio) quedan libres;
//   - una cuenta CON CONSUMO no se toca pase el tiempo que pase;
//   - una mesa abierta hoy no se toca;
//   - un fallo en una mesa no deja las demás sin barrer.

import { randomBytes } from "node:crypto";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.REDIS_URL = "redis://localhost:6379";
process.env.JWT_ACCESS_SECRET = "a".repeat(40);
process.env.JWT_REFRESH_SECRET = "b".repeat(40);
process.env.HOLDED_KEY_ENCRYPTION_SECRET = randomBytes(32).toString("base64");

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  listAbandonedTables,
  runAbandonedTableSweep,
} from "../src/tables/abandoned.js";

// Los datos son los de producción: Cafetería Sirope, corte a las 05:00
// (default), mesas abiertas el 9 de julio de 2026 y nunca cerradas.
const SIROPE = "tenant-sirope";
const STORE = "store-sirope";
const EL_9_DE_JULIO = new Date("2026-07-09T18:12:00.000Z");
// La pasada de las 05:00 locales del 27 de agosto (03:00 UTC en CEST).
const AHORA = new Date("2026-08-27T03:00:30.000Z");

interface FakeTicket {
  id: string;
  tenantId: string;
  tableId: string | null;
  tableName?: string;
  storeId: string;
  dayCutHour: number;
  createdAt: Date;
  status: "DRAFT" | "VOIDED" | "PAID";
  lines: number;
  total: number;
  notes: string | null;
  voidReason?: string | null;
  voidedAt?: Date | null;
  voidedByUserId?: string | null;
  userEmail?: string | null;
  userAlias?: string | null;
}

function ticket(over: Partial<FakeTicket> & { id: string }): FakeTicket {
  return {
    tenantId: SIROPE,
    tableId: `mesa-${over.id}`,
    tableName: over.id.toUpperCase(),
    storeId: STORE,
    dayCutHour: 5,
    createdAt: EL_9_DE_JULIO,
    status: "DRAFT",
    lines: 0,
    total: 0,
    notes: null,
    userEmail: "gemmamgc72@sirope.example",
    userAlias: "Gemma",
    ...over,
  };
}

function project(t: FakeTicket) {
  return {
    id: t.id,
    tenantId: t.tenantId,
    tableId: t.tableId,
    createdAt: t.createdAt,
    notes: t.notes,
    total: { toString: () => t.total.toFixed(4) },
    register: { storeId: t.storeId },
    tenant: { id: t.tenantId, dayCutHour: t.dayCutHour },
    table: t.tableId ? { name: t.tableName ?? null, storeId: t.storeId } : null,
    user: { email: t.userEmail ?? null, alias: t.userAlias ?? null },
    _count: { lines: t.lines },
  };
}

// Prisma falso mínimo: sólo `ticket.findMany` (el barrido y la lista),
// `ticket.findFirst` y `ticket.updateMany` (la anulación de
// `void-draft.ts`). Guardamos los updates para asertar sobre ellos.
function fakePrisma(tickets: FakeTicket[]) {
  const updates: Array<{ id: string; data: Record<string, unknown> }> = [];
  return {
    tickets,
    updates,
    client: {
      ticket: {
        findMany: vi.fn(async (args: { where: Record<string, unknown> }) => {
          const where = args.where ?? {};
          return tickets
            .filter((t) => {
              if (where.status && t.status !== where.status) return false;
              if (where.tenantId && t.tenantId !== where.tenantId) return false;
              if (where.tableId && t.tableId === null) return false;
              const created = where.createdAt as { lt?: Date } | undefined;
              if (created?.lt && t.createdAt.getTime() >= created.lt.getTime()) {
                return false;
              }
              const table = where.table as { storeId?: string } | undefined;
              if (table?.storeId && t.storeId !== table.storeId) return false;
              return true;
            })
            .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
            .map(project);
        }),
        findFirst: vi.fn(async (args: { where: Record<string, unknown> }) => {
          const where = args.where ?? {};
          const hit = tickets.find((t) => {
            if (where.id && t.id !== where.id) return false;
            if (where.tenantId && t.tenantId !== where.tenantId) return false;
            if (where.status && t.status !== where.status) return false;
            return true;
          });
          return hit ? project(hit) : null;
        }),
        updateMany: vi.fn(
          async (args: {
            where: Record<string, unknown>;
            data: Record<string, unknown>;
          }) => {
            const where = args.where ?? {};
            const hit = tickets.filter((t) => {
              if (where.id && t.id !== where.id) return false;
              if (where.tenantId && t.tenantId !== where.tenantId) return false;
              if (where.status && t.status !== where.status) return false;
              // `lines: { none: {} }` — la red de seguridad de la carrera.
              if (where.lines && t.lines > 0) return false;
              return true;
            });
            for (const t of hit) {
              updates.push({ id: t.id, data: args.data });
              Object.assign(t, args.data);
            }
            return { count: hit.length };
          },
        ),
      },
    },
  };
}

const log = { info: vi.fn(), error: vi.fn() };

beforeEach(() => {
  log.info.mockClear();
  log.error.mockClear();
});

function sweep(db: ReturnType<typeof fakePrisma>, now = AHORA) {
  return runAbandonedTableSweep({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    prisma: db.client as any,
    log,
    now,
  });
}

describe("runAbandonedTableSweep · las cuatro mesas de Sirope", () => {
  it("suelta el draft vacío de antes del corte y deja constancia de quién y por qué", async () => {
    const db = fakePrisma([
      ticket({ id: "m1" }),
      ticket({ id: "m2" }),
      ticket({ id: "m4" }),
      ticket({ id: "t1" }),
    ]);

    const res = await sweep(db);

    expect(res.released).toHaveLength(4);
    expect(res.failed).toBe(0);
    // Las cuatro mesas quedan libres: sin DRAFT, no hay ocupación.
    expect(db.tickets.every((t) => t.status === "VOIDED")).toBe(true);
    const m1 = db.updates.find((u) => u.id === "m1");
    expect(m1?.data.status).toBe("VOIDED");
    // La columna dice POR QUÉ, no sólo que pasó (criterio de v1.11).
    expect(m1?.data.voidReason).toBe("AUTO_ABANDONED_EMPTY");
    expect(m1?.data.voidedAt).toEqual(AHORA);
    // Y QUIÉN: NULL = SISTEMA. No se lo atribuimos a ninguna persona.
    expect(m1?.data.voidedByUserId).toBeNull();
    expect(String(m1?.data.notes)).toContain("[LIBERADA]");
    expect(log.info).toHaveBeenCalledWith(
      expect.objectContaining({ event: "tables.abandoned.released" }),
      expect.any(String),
    );
  });

  it("una cuenta CON LÍNEAS no se toca jamás, tenga 43 días o 400", async () => {
    const conConsumo = ticket({ id: "m7", lines: 3, total: 84.6 });
    const db = fakePrisma([conConsumo]);

    const res = await sweep(db);

    expect(res.released).toHaveLength(0);
    expect(res.keptWithLines).toBe(1);
    expect(db.updates).toHaveLength(0);
    expect(conConsumo.status).toBe("DRAFT");
  });

  it("la mesa abierta hoy, después del corte, sigue ocupada", async () => {
    // 06:30 locales de hoy; el último corte fue a las 05:00.
    const deHoy = ticket({
      id: "m9",
      createdAt: new Date("2026-08-27T04:30:00.000Z"),
    });
    const db = fakePrisma([deHoy]);

    const res = await sweep(db);

    expect(res.released).toHaveLength(0);
    expect(db.updates).toHaveLength(0);
    expect(deHoy.status).toBe("DRAFT");
  });

  it("respeta la hora de corte de CADA tenant", async () => {
    // Abierta a las 04:00 locales de hoy. Para el tenant con corte a las
    // 05:00 es de ayer (cruzó el corte); para el de corte a las 03:00,
    // es de hoy y no se toca.
    const alaCuatro = new Date("2026-08-27T02:00:00.000Z");
    const cortaALas5 = ticket({ id: "a", createdAt: alaCuatro, dayCutHour: 5 });
    const cortaALas3 = ticket({
      id: "b",
      tenantId: "tenant-otro",
      createdAt: alaCuatro,
      dayCutHour: 3,
    });
    const db = fakePrisma([cortaALas5, cortaALas3]);

    const res = await sweep(db);

    expect(res.released.map((r) => r.ticketId)).toEqual(["a"]);
    expect(cortaALas3.status).toBe("DRAFT");
  });

  it("si le meten la primera línea durante la pasada, la comanda se salva", async () => {
    const m3 = ticket({ id: "m3" });
    const db = fakePrisma([m3]);
    // El barrido lo lee vacío y, antes de la reclamación, un camarero
    // teclea "1 caña". El `lines: { none: {} }` del WHERE deja de casar.
    db.client.ticket.findFirst.mockImplementationOnce(async () => {
      // La foto que ve el barrido: vacía. Justo después, la caña.
      const comoSeLeyo = project(m3);
      m3.lines = 1;
      m3.total = 2.5;
      return comoSeLeyo;
    });

    const res = await sweep(db);

    expect(res.released).toHaveLength(0);
    expect(res.failed).toBe(0);
    expect(m3.status).toBe("DRAFT");
    expect(log.info).toHaveBeenCalledWith(
      expect.objectContaining({ event: "tables.abandoned.skipped" }),
      expect.any(String),
    );
  });

  it("un fallo en una mesa no impide soltar las demás", async () => {
    const db = fakePrisma([ticket({ id: "rota" }), ticket({ id: "buena" })]);
    db.client.ticket.updateMany.mockImplementationOnce(async () => {
      throw new Error("deadlock");
    });

    const res = await sweep(db);

    expect(res.failed).toBe(1);
    expect(res.released.map((r) => r.ticketId)).toEqual(["buena"]);
    expect(log.error).toHaveBeenCalledWith(
      expect.objectContaining({ event: "tables.abandoned.failed" }),
      expect.any(String),
    );
  });
});

describe("listAbandonedTables · lo que ve el encargado en el admin", () => {
  it("lista sólo las cuentas con consumo y más de 24 h, con su importe y quién la abrió", async () => {
    const db = fakePrisma([
      ticket({ id: "vieja-con-consumo", lines: 2, total: 12.4 }),
      ticket({ id: "vieja-vacia" }),
      ticket({
        id: "de-hace-un-rato",
        lines: 4,
        total: 31,
        createdAt: new Date(AHORA.getTime() - 2 * 60 * 60 * 1000),
      }),
    ]);

    const rows = await listAbandonedTables(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      db.client as any,
      SIROPE,
      STORE,
      AHORA,
    );

    expect(rows.map((r) => r.ticketId)).toEqual(["vieja-con-consumo"]);
    expect(rows[0]).toMatchObject({
      tableName: "VIEJA-CON-CONSUMO",
      lineCount: 2,
      openedByAlias: "Gemma",
    });
    expect(Number(rows[0]!.total)).toBe(12.4);
    expect(rows[0]!.openedAt).toBe(EL_9_DE_JULIO.toISOString());
  });
});
