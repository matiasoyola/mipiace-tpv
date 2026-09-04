// A5 · Frente 1 · el canal de soporte del terminal (`GET /ws/device`).
//
// Lo que se prueba aquí es la puerta, que es lo único que separa «quince
// terminales nuestros» de «cualquiera con un socket»:
//
//   - un token que no vale NO abre canal,
//   - un device revocado NO abre canal,
//   - un device revocado MIENTRAS habla se queda sin canal en ese momento,
//   - un socket que no dice `hello` se cierra solo,
//   - el token NO viaja en la URL (es el motivo de todo el handshake),
//   - un terminal no puede escribir el estado de otro.
//
// Fake Prisma con Map, mismo patrón que pairing-route.test.ts. La revocación se
// dispara por la ruta REAL (`POST /admin/devices/:id/revoke`) con un JWT de
// OWNER firmado de verdad: lo que importa es que el camino que usa un humano
// cierre el canal, no que una función interna funcione.

import { createHash, randomBytes, randomUUID } from "node:crypto";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.REDIS_URL = "redis://localhost:6379";
process.env.JWT_ACCESS_SECRET = "a".repeat(40);
process.env.JWT_REFRESH_SECRET = "b".repeat(40);
process.env.HOLDED_KEY_ENCRYPTION_SECRET = randomBytes(32).toString("base64");
process.env.PUBLIC_ADMIN_URL = "http://localhost:5173";

import Fastify, { type FastifyInstance } from "fastify";
import websocket from "@fastify/websocket";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TENANT_A = randomUUID();
const TENANT_B = randomUUID();
const OWNER_A = randomUUID();
const REGISTER_A = randomUUID();
const REGISTER_B = randomUUID();

const DEVICE_A = randomUUID();
const DEVICE_B = randomUUID();
const TOKEN_A = "token-de-terminal-a-con-entropia-de-sobra";
const TOKEN_B = "token-de-terminal-b-con-entropia-de-sobra";

function sha256(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

interface FakeDevice {
  id: string;
  tenantId: string;
  registerId: string;
  deviceTokenHash: string;
  revokedAt: Date | null;
  lastSeenAt: Date | null;
}

interface FakeHeartbeat {
  deviceId: string;
  outboxPending: number;
  outboxStuckSince: Date | null;
  bundleBuildHash: string | null;
  clockSkewSeconds: number | null;
  [k: string]: unknown;
}

const devices = new Map<string, FakeDevice>();
const heartbeats = new Map<string, FakeHeartbeat>();

const fakePrisma = {
  device: {
    findUnique: vi.fn(async ({ where }: any) => {
      if (where.id) return devices.get(where.id) ?? null;
      if (where.deviceTokenHash) {
        for (const d of devices.values()) {
          if (d.deviceTokenHash === where.deviceTokenHash) return d;
        }
      }
      return null;
    }),
    findFirst: vi.fn(async ({ where }: any) => {
      const d = devices.get(where.id);
      if (!d) return null;
      if (where.tenantId && d.tenantId !== where.tenantId) return null;
      return d;
    }),
    update: vi.fn(async ({ where, data }: any) => {
      const d = devices.get(where.id);
      if (!d) throw new Error("device no existe");
      if (data.lastSeenAt) d.lastSeenAt = data.lastSeenAt;
      if (data.revokedAt) d.revokedAt = data.revokedAt;
      return d;
    }),
  },
  deviceHeartbeat: {
    findUnique: vi.fn(async ({ where }: any) => heartbeats.get(where.deviceId) ?? null),
    upsert: vi.fn(async ({ where, create, update }: any) => {
      const existing = heartbeats.get(where.deviceId);
      const row = existing
        ? { ...existing, ...update }
        : ({ ...create } as FakeHeartbeat);
      heartbeats.set(where.deviceId, row);
      return row;
    }),
  },
  $transaction: vi.fn(async (fn: any) => fn(fakePrisma)),
} as const;

vi.mock("../src/context.js", () => ({
  getPrisma: () => fakePrisma,
  getRedis: () => ({}),
  shutdown: async () => undefined,
}));

vi.mock("../src/devices/alerts.js", () => ({
  evaluateDeviceAlert: async () => ({ alertSent: false }),
}));

const { registerDeviceWebSocketRoute } = await import("../src/devices/ws-route.js");
const { registerDeviceRoutes } = await import("../src/devices/routes.js");
const { getDeviceChannelRegistry } = await import(
  "../src/devices/channel-registry.js"
);
const { signAccessToken } = await import("../src/auth/tokens.js");

// Corto a propósito: el test del silencio no puede esperarse los 5 s reales.
const HELLO_TIMEOUT_TEST_MS = 120;

function ownerBearer(): string {
  return `Bearer ${signAccessToken({ sub: OWNER_A, tid: TENANT_A, role: "OWNER" })}`;
}

let app: FastifyInstance;

beforeEach(async () => {
  vi.clearAllMocks();
  devices.clear();
  heartbeats.clear();
  getDeviceChannelRegistry().__resetForTests();
  devices.set(DEVICE_A, {
    id: DEVICE_A,
    tenantId: TENANT_A,
    registerId: REGISTER_A,
    deviceTokenHash: sha256(TOKEN_A),
    revokedAt: null,
    lastSeenAt: null,
  });
  devices.set(DEVICE_B, {
    id: DEVICE_B,
    tenantId: TENANT_B,
    registerId: REGISTER_B,
    deviceTokenHash: sha256(TOKEN_B),
    revokedAt: null,
    lastSeenAt: null,
  });

  app = Fastify({ logger: false });
  await app.register(websocket);
  await registerDeviceWebSocketRoute(app, {
    helloTimeoutMs: HELLO_TIMEOUT_TEST_MS,
  });
  await registerDeviceRoutes(app);
  await app.ready();
});

afterEach(async () => {
  await app.close();
});

function waitForClose(ws: any): Promise<number> {
  return new Promise((resolve) => {
    if (ws.readyState === ws.CLOSED) {
      resolve(ws._closeCode ?? 0);
      return;
    }
    ws.on("close", (code: number) => resolve(code));
  });
}

/** Abre el canal y espera al `ready`. Rechaza si el socket se cierra antes. */
async function openChannel(
  token: string,
  status?: Record<string, unknown>,
): Promise<any> {
  const ws = await app.injectWS("/ws/device");
  const ready = new Promise<void>((resolve, reject) => {
    ws.on("message", (data: Buffer) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === "ready") resolve();
    });
    ws.on("close", (code: number) => reject(new Error(`cerrado con ${code}`)));
  });
  ws.send(JSON.stringify({ type: "hello", token, status }));
  await ready;
  return ws;
}

const tick = (ms = 40) => new Promise((r) => setTimeout(r, ms));

/** Espera activa acotada: el cierre del socket viaja por el event loop. */
async function esperarA(cond: () => boolean, timeoutMs = 1_000): Promise<void> {
  const limite = Date.now() + timeoutMs;
  while (!cond() && Date.now() < limite) await tick(10);
}

describe("A5 · /ws/device · la puerta", () => {
  it("un device token inválido NO abre canal", async () => {
    const ws = await app.injectWS("/ws/device");
    ws.send(
      JSON.stringify({ type: "hello", token: "no-existe-este-token-pero-es-largo" }),
    );
    const code = await waitForClose(ws);
    expect(code, "token inválido: NO puede abrir canal").toBe(4401);
    expect(getDeviceChannelRegistry().size()).toBe(0);
  });

  it("un JWT de cashier-session NO abre canal (el inventario es de terminales)", async () => {
    const ws = await app.injectWS("/ws/device");
    // Tres segmentos = JWT. `requireDeviceToken` los acepta en HTTP para el
    // "Probar TPV" del super-admin; el canal no, porque eso no es un terminal.
    ws.send(
      JSON.stringify({ type: "hello", token: "aaaaaaaaaa.bbbbbbbbbb.cccccccccc" }),
    );
    const code = await waitForClose(ws);
    expect(code).toBe(4401);
    expect(getDeviceChannelRegistry().size()).toBe(0);
  });

  it("un device REVOCADO no conecta", async () => {
    devices.get(DEVICE_A)!.revokedAt = new Date();
    const ws = await app.injectWS("/ws/device");
    ws.send(JSON.stringify({ type: "hello", token: TOKEN_A }));
    const code = await waitForClose(ws);
    expect(code, "device revocado: NO puede abrir canal").toBe(4403);
    expect(getDeviceChannelRegistry().size()).toBe(0);
  });

  it("un socket que no dice `hello` se cierra solo", async () => {
    const ws = await app.injectWS("/ws/device");
    const code = await waitForClose(ws);
    expect(code, "socket anónimo: tiene que cerrarse solo").toBe(4401);
    expect(getDeviceChannelRegistry().size()).toBe(0);
  });

  it("el token NO se acepta por query string", async () => {
    // Es el motivo de que exista el handshake: en la URL el token acabaría en
    // los logs de Caddy, y el device token no caduca nunca. Si alguien
    // «arregla» esto por consistencia con /ws/store, este test se pone rojo.
    const ws = await app.injectWS(`/ws/device?token=${TOKEN_A}`);
    const code = await waitForClose(ws);
    expect(code, "token por query: no autentica nada").toBe(4401);
    expect(getDeviceChannelRegistry().size()).toBe(0);
  });

  it("un device válido abre canal y queda registrado", async () => {
    const ws = await openChannel(TOKEN_A);
    expect(getDeviceChannelRegistry().isOnline(DEVICE_A)).toBe(true);
    // Al cerrar el terminal, el servidor tiene que darlo de baja: si no, el
    // panel pintaría como vivo a un terminal apagado.
    ws.terminate();
    await esperarA(() => !getDeviceChannelRegistry().isOnline(DEVICE_A));
    expect(getDeviceChannelRegistry().isOnline(DEVICE_A)).toBe(false);
  });
});

describe("A5 · /ws/device · revocación en caliente", () => {
  it("revocar desde admin cierra el canal abierto en ese momento", async () => {
    const ws = await openChannel(TOKEN_A);
    expect(getDeviceChannelRegistry().isOnline(DEVICE_A)).toBe(true);

    const closed = waitForClose(ws);
    const res = await app.inject({
      method: "POST",
      url: `/admin/devices/${DEVICE_A}/revoke`,
      headers: { authorization: ownerBearer() },
      payload: {},
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().canalCerrado, "la revocación tiene que cerrar el canal").toBe(
      true,
    );
    expect(await closed).toBe(4403);
    expect(getDeviceChannelRegistry().isOnline(DEVICE_A)).toBe(false);
  });

  it("si se revoca por otra vía, el canal se cae al siguiente latido", async () => {
    const ws = await openChannel(TOKEN_A);
    // Nadie llamó a la ruta: la revocación llegó por el worker o a mano en el
    // VPS. El canal tiene que enterarse igual.
    devices.get(DEVICE_A)!.revokedAt = new Date();
    const closed = waitForClose(ws);
    ws.send(JSON.stringify({ type: "status", outboxPending: 0 }));
    expect(await closed).toBe(4403);
  });
});

describe("A5 · /ws/device · el latido", () => {
  it("guarda la instantánea y toca lastSeenAt", async () => {
    const ws = await openChannel(TOKEN_A, {
      bundleBuildHash: "a1b2c3d",
      bundleTarget: "android",
      platform: "android",
      appVersionName: "1.15.0",
      appVersionCode: 11500,
      outboxPending: 3,
      shiftOpen: true,
    });
    await tick();

    const hb = heartbeats.get(DEVICE_A);
    expect(hb?.bundleBuildHash).toBe("a1b2c3d");
    expect(hb?.outboxPending).toBe(3);
    expect(devices.get(DEVICE_A)!.lastSeenAt).toBeInstanceOf(Date);
    ws.close();
  });

  it("un estado con basura no tira el canal ni se guarda", async () => {
    const ws = await openChannel(TOKEN_A, { outboxPending: 1 });
    await tick();
    ws.send(JSON.stringify({ type: "status", outboxPending: "muchos" }));
    await tick();
    // Sigue online y con la instantánea buena: preferimos un terminal visible
    // con datos de hace un minuto a un terminal invisible.
    expect(getDeviceChannelRegistry().isOnline(DEVICE_A)).toBe(true);
    expect(heartbeats.get(DEVICE_A)!.outboxPending).toBe(1);
    ws.close();
  });

  it("un terminal no puede escribir el estado de otro tenant", async () => {
    const a = await openChannel(TOKEN_A, { outboxPending: 1 });
    const b = await openChannel(TOKEN_B, { outboxPending: 99 });
    await tick();

    // El canal no acepta un deviceId en el payload: el device sale del token y
    // de nada más. Aunque el terminal de B lo intente, escribe en su fila.
    b.send(
      JSON.stringify({ type: "status", deviceId: DEVICE_A, outboxPending: 77 }),
    );
    await tick();

    expect(heartbeats.get(DEVICE_A)!.outboxPending).toBe(1);
    expect(heartbeats.get(DEVICE_B)!.outboxPending).toBe(99);
    a.close();
    b.close();
  });

  it("una reconexión sustituye al canal viejo, no lo duplica", async () => {
    const primero = await openChannel(TOKEN_A);
    const cerrado = waitForClose(primero);
    const segundo = await openChannel(TOKEN_A);

    expect(await cerrado, "el canal viejo tiene que caerse").toBe(4409);
    expect(getDeviceChannelRegistry().size()).toBe(1);
    expect(getDeviceChannelRegistry().isOnline(DEVICE_A)).toBe(true);
    segundo.close();
  });
});
