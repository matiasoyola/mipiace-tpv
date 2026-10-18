// auditoria-sirope (#25) · EL BORRADOR DE LA VENTA DE MOSTRADOR Y SU Nº.
//
// Lo que faltaba para que «Enviar» en venta rápida llegara a la cocina:
// un ticket. `POST /mostrador/draft` lo crea sin mesa y con su número del
// día, y la tarjeta de la pantalla se titula con él.

import { randomBytes, randomUUID } from "node:crypto";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.REDIS_URL = "redis://localhost:6379";
process.env.JWT_ACCESS_SECRET = "a".repeat(40);
process.env.JWT_REFRESH_SECRET = "b".repeat(40);
process.env.HOLDED_KEY_ENCRYPTION_SECRET = randomBytes(32).toString("base64");

import Fastify from "fastify";
import jwt from "jsonwebtoken";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { etiquetaDeMostrador, tituloDeComanda } from "../src/kitchen/titulo.js";

const TENANT = "00000000-0000-0000-0000-000000000001";
const CASHIER = "00000000-0000-0000-0000-000000000002";
const REGISTER = "00000000-0000-0000-0000-000000000003";
const DEVICE = "00000000-0000-0000-0000-000000000004";

function dec(n: number) {
  return { toString: () => String(n) };
}

/** El mayor `counterNumber` de hoy en esta caja, lo que contesta el
 *  `aggregate`. `null` = todavía no hay ninguna venta de mostrador. */
let maxCounterHoy: number | null = null;
let hayTurno = true;
const ticketsCreados: Array<Record<string, unknown>> = [];
const lineasCreadas: Array<Record<string, unknown>> = [];

const fakePrisma = {
  register: {
    findFirst: vi.fn(async () => ({ id: REGISTER, storeId: "store-1" })),
  },
  shift: {
    findFirst: vi.fn(async () => (hayTurno ? { id: "shift-1" } : null)),
  },
  modifierGroup: { findMany: vi.fn(async () => []) },
  productModifierGroup: { findMany: vi.fn(async () => []) },
  ticket: {
    aggregate: vi.fn(async () => ({ _max: { counterNumber: maxCounterHoy } })),
    create: vi.fn(async ({ data }: any) => {
      ticketsCreados.push(data);
      return { id: "ticket-mostrador" };
    }),
    update: vi.fn(async ({ data }: any) => ({
      id: "ticket-mostrador",
      status: "DRAFT",
      externalId: "ext-1",
      tableId: null,
      table: null,
      diners: null,
      total: dec(Number(data.total)),
      totalTax: dec(Number(data.totalTax)),
      totalDiscount: dec(Number(data.totalDiscount)),
      createdAt: new Date(),
      lastSentAt: null,
      lastSentRevision: 0,
      lines: lineasCreadas.map((l) => ({
        id: l.id,
        productId: l.productId ?? null,
        variantId: null,
        holdedProductId: null,
        sku: l.sku,
        nameSnapshot: l.nameSnapshot,
        units: dec(Number(l.units)),
        unitPrice: dec(Number(l.unitPrice)),
        discountPct: dec(Number(l.discountPct)),
        taxRate: dec(Number(l.taxRate)),
        subtotal: dec(Number(l.subtotal)),
        total: dec(Number(l.total)),
        modifiers: null,
      })),
    })),
    findUniqueOrThrow: vi.fn(async () => ({
      counterNumber: ticketsCreados[0]?.counterNumber ?? null,
    })),
  },
  ticketLine: {
    create: vi.fn(async ({ data }: any) => {
      lineasCreadas.push(data);
      return data;
    }),
    findMany: vi.fn(async () =>
      lineasCreadas.map((l) => ({
        units: dec(Number(l.units)),
        unitPrice: dec(Number(l.unitPrice)),
        discountPct: dec(Number(l.discountPct)),
        taxRate: dec(Number(l.taxRate)),
        modifiers: null,
      })),
    ),
  },
  $transaction: vi.fn(async (fn: any) => fn(fakePrisma)),
} as const;

vi.mock("../src/context.js", () => ({
  getPrisma: () => fakePrisma,
  getRedis: () => ({ ping: async () => "PONG" }),
  shutdown: async () => undefined,
}));

const { registerMostradorRoutes } = await import("../src/tickets/mostrador.js");

function cashierToken() {
  return jwt.sign(
    {
      sub: CASHIER,
      tid: TENANT,
      did: DEVICE,
      rid: REGISTER,
      role: "CASHIER",
      type: "cashier",
    },
    process.env.JWT_ACCESS_SECRET!,
    { expiresIn: "30m" },
  );
}

async function buildApp() {
  const app = Fastify({ logger: false });
  await registerMostradorRoutes(app);
  return app;
}

async function postDraft(app: any, lines?: unknown[]) {
  return app.inject({
    method: "POST",
    url: "/mostrador/draft",
    headers: { authorization: `Bearer ${cashierToken()}` },
    payload: {
      lines: lines ?? [
        {
          nameSnapshot: "Tostada con tomate",
          sku: "TOS1",
          units: 1,
          unitPrice: 2.2,
          discountPct: 0,
          taxRate: 10,
          lineExternalId: randomUUID(),
        },
      ],
    },
  });
}

beforeEach(() => {
  maxCounterHoy = null;
  hayTurno = true;
  ticketsCreados.length = 0;
  lineasCreadas.length = 0;
  vi.clearAllMocks();
});

describe("POST /mostrador/draft (#25)", () => {
  it("crea un DRAFT SIN mesa y con el nº 1 del día", async () => {
    const app = await buildApp();
    const res = await postDraft(app);

    expect(res.statusCode).toBe(201);
    const creado = ticketsCreados[0]!;
    expect(creado.status).toBe("DRAFT");
    // Sin mesa: esto es lo que lo convierte en mostrador.
    expect(creado.tableId).toBeNull();
    expect(creado.counterNumber).toBe(1);
    expect(res.json().counterLabel).toBe("Mostrador nº 1");
    expect(lineasCreadas).toHaveLength(1);
  });

  it("el número sigue al último de HOY en esta caja", async () => {
    maxCounterHoy = 7;
    const app = await buildApp();
    await postDraft(app);
    expect(ticketsCreados[0]!.counterNumber).toBe(8);
  });

  it("sin turno abierto no se abre ninguna venta", async () => {
    hayTurno = false;
    const app = await buildApp();
    const res = await postDraft(app);

    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("SHIFT_NOT_OPEN");
    expect(ticketsCreados).toHaveLength(0);
  });

  it("sin líneas no se abre nada: una comanda vacía no es una comanda", async () => {
    const app = await buildApp();
    const res = await postDraft(app, []);
    expect(res.statusCode).toBe(400);
    expect(ticketsCreados).toHaveLength(0);
  });
});

describe("el título de la comanda (#25)", () => {
  it("una mesa se titula con su nombre", () => {
    expect(tituloDeComanda({ table: { name: "T6" }, counterNumber: null })).toBe(
      "T6",
    );
  });

  it("un mostrador, con su número", () => {
    expect(tituloDeComanda({ table: null, counterNumber: 3 })).toBe(
      "Mostrador nº 3",
    );
    expect(etiquetaDeMostrador(3)).toBe("Mostrador nº 3");
  });

  it("una venta rápida de antes del bloque sigue sin título", () => {
    // La tarjeta cae a «#1», que es lo que hacía siempre.
    expect(tituloDeComanda({ table: null, counterNumber: null })).toBeNull();
  });
});
