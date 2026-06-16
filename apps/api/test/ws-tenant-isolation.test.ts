// v1.5-D · Frente 4: aislamiento de la suscripción WebSocket.
//
// El binding del WS (ws-route.ts) ata la suscripción al store real del
// register del cashier: `register.findFirst({ id: payload.rid, storeId })`
// → cierra 4403 si el register del cashier no pertenece al storeId pedido.
// Más el bus está indexado por storeId (UUID). Aquí probamos a nivel de
// ruta que:
//   1. Un cashier de A NO puede suscribirse a un store de B (cierre 4403).
//   2. Un cashier suscrito a su store no recibe eventos de otro store.
//
// El aislamiento del bus en sí (entrega sólo al store correcto) ya está
// cubierto en store-event-bus.test.ts; esto cierra el extremo de la ruta.

import { randomBytes, randomUUID } from "node:crypto";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.REDIS_URL = "redis://localhost:6379";
process.env.JWT_ACCESS_SECRET = "a".repeat(40);
process.env.JWT_REFRESH_SECRET = "b".repeat(40);
process.env.HOLDED_KEY_ENCRYPTION_SECRET = randomBytes(32).toString("base64");

import Fastify from "fastify";
import websocket from "@fastify/websocket";
import jwt from "jsonwebtoken";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Tenant A: register RID_A vive en el store STORE_A.
const STORE_A = randomUUID();
const STORE_B = randomUUID();
const RID_A = randomUUID();

// Fake register.findFirst FIEL: sólo devuelve el register si el storeId
// pedido coincide con el store real del register (STORE_A). Pedir STORE_B
// con el register de A → null → la ruta cierra 4403.
const fakePrisma = {
  register: {
    findFirst: vi.fn(async ({ where }: any) => {
      if (where.id === RID_A && where.storeId === STORE_A) {
        return { id: RID_A, storeId: STORE_A };
      }
      return null;
    }),
  },
} as const;

vi.mock("../src/context.js", () => ({
  getPrisma: () => fakePrisma,
  getRedis: () => ({ ping: async () => "PONG" }),
  shutdown: async () => undefined,
}));

const { registerStoreWebSocketRoute } = await import("../src/realtime/ws-route.js");
const { getStoreEventBus } = await import("../src/realtime/store-event-bus.js");

function cashierTokenA() {
  return jwt.sign(
    {
      sub: randomUUID(),
      tid: randomUUID(),
      did: randomUUID(),
      rid: RID_A,
      role: "CASHIER",
      type: "cashier",
    },
    process.env.JWT_ACCESS_SECRET!,
    { expiresIn: "30m" },
  );
}

let app: ReturnType<typeof Fastify>;

beforeEach(async () => {
  vi.clearAllMocks();
  app = Fastify({ logger: false });
  await app.register(websocket);
  await registerStoreWebSocketRoute(app);
  await app.ready();
});

afterEach(async () => {
  await app.close();
});

describe("WS · aislamiento de tenant/store", () => {
  it("cashier de A NO puede suscribirse a un store de B (cierre 4403)", async () => {
    const token = cashierTokenA();
    const ws = await app.injectWS(`/ws/store/${STORE_B}?token=${token}`);

    const closeCode = await new Promise<number>((resolve) => {
      if (ws.readyState === ws.CLOSED) {
        resolve((ws as any)._closeCode ?? 0);
        return;
      }
      ws.on("close", (code: number) => resolve(code));
    });

    expect(closeCode).toBe(4403);
  });

  it("cashier suscrito a su store no recibe eventos de otro store", async () => {
    const token = cashierTokenA();
    const ws = await app.injectWS(`/ws/store/${STORE_A}?token=${token}`);

    const received: any[] = [];
    ws.on("message", (data: Buffer) => received.push(JSON.parse(data.toString())));

    // Damos un tick para que el handler complete la suscripción.
    await new Promise((r) => setTimeout(r, 20));

    const bus = getStoreEventBus();
    const eventForB = {
      type: "table.opened" as const,
      tableId: randomUUID(),
      ticketId: randomUUID(),
      byEmail: "cajero-b@test.es",
      at: new Date().toISOString(),
    };
    const eventForA = {
      type: "table.opened" as const,
      tableId: randomUUID(),
      ticketId: randomUUID(),
      byEmail: "cajero-a@test.es",
      at: new Date().toISOString(),
    };
    // Evento al store de B: el cashier de A NO debe recibirlo.
    bus.broadcast(STORE_B, eventForB);
    // Evento al store de A: sí debe llegar (control positivo).
    bus.broadcast(STORE_A, eventForA);

    await new Promise((r) => setTimeout(r, 30));

    const ticketIds = received.map((e) => e.ticketId);
    expect(ticketIds).toContain(eventForA.ticketId);
    expect(ticketIds).not.toContain(eventForB.ticketId);

    ws.close();
  });
});
