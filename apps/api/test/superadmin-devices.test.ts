// A5 · Frente 2 · el inventario de terminales del panel.
//
// Lo que importa aquí, por orden:
//
//   - sin sesión de super-admin no se ve nada (es la flota entera de todos los
//     clientes, con sus IPs y sus turnos),
//   - `online` sale del registro de canales, NO de comparar fechas: un terminal
//     que latió hace 20 s pero cuyo socket acaba de caerse está offline,
//   - «desactualizado» se calcula contra el índice de A3, y sin índice NADIE
//     está desactualizado — si no, en dev y en CI saldrían quince en rojo y la
//     columna dejaría de mirarse,
//   - el filtro por tenant filtra de verdad.

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";

const RELEASES_DIR = mkdtempSync(join(tmpdir(), "mipiacetpv-a5-releases-"));

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.REDIS_URL = "redis://localhost:6379";
process.env.JWT_ACCESS_SECRET = "a".repeat(40);
process.env.JWT_REFRESH_SECRET = "b".repeat(40);
process.env.SUPER_ADMIN_JWT_SECRET = "s".repeat(40);
process.env.HOLDED_KEY_ENCRYPTION_SECRET = randomBytes(32).toString("base64");
process.env.RELEASES_DIR = RELEASES_DIR;

import Fastify, { type FastifyInstance } from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";

const SA_ID = randomUUID();
const TENANT_A = randomUUID();
const TENANT_B = randomUUID();
const DEVICE_A = randomUUID();
const DEVICE_B = randomUUID();

interface FakeDeviceRow {
  id: string;
  name: string | null;
  tenantId: string;
  pairedAt: Date;
  lastSeenAt: Date | null;
  revokedAt: Date | null;
  tenant: { id: string; name: string };
  register: {
    id: string;
    name: string;
    storeId: string;
    store: { id: string; name: string };
  };
  heartbeat: Record<string, unknown> | null;
}

const rows: FakeDeviceRow[] = [];

const fakePrisma = {
  device: {
    findMany: vi.fn(async ({ where }: any) => {
      return rows.filter((r) => {
        if (where?.tenantId && r.tenantId !== where.tenantId) return false;
        if (where?.register?.storeId && r.register.storeId !== where.register.storeId)
          return false;
        if (where?.revokedAt === null && r.revokedAt !== null) return false;
        return true;
      });
    }),
  },
  superAdminUser: {
    findUnique: vi.fn(async () => ({
      id: SA_ID,
      tokenVersion: 1,
      deletedAt: null,
      isRoot: true,
    })),
  },
} as any;

vi.mock("../src/context.js", () => ({
  getPrisma: () => fakePrisma,
  getRedis: () => ({}),
  shutdown: async () => undefined,
}));

const { registerSuperAdminDevicesRoutes, isOutdated, isStale } = await import(
  "../src/superadmin/devices.js"
);
const { getDeviceChannelRegistry } = await import(
  "../src/devices/channel-registry.js"
);
const { signSuperAdminAccessToken } = await import("../src/superadmin/tokens.js");

function saBearer(): string {
  return `Bearer ${signSuperAdminAccessToken({ sub: SA_ID, tv: 1, isRoot: true })}`;
}

function heartbeat(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    reportedAt: new Date(),
    appVersionName: "1.14.1",
    appVersionCode: 11401,
    bundleBuildHash: "336f24b",
    bundleTarget: "android",
    platform: "android",
    shiftOpen: true,
    shiftOpenedAt: new Date(),
    outboxPending: 0,
    outboxRejected: 0,
    outboxStuckSince: null,
    network: "wifi",
    localIp: "192.168.1.17",
    clockSkewSeconds: 0,
    bootedAt: new Date(),
    deviceTime: new Date(),
    ...over,
  };
}

function fila(
  id: string,
  tenantId: string,
  tenantName: string,
  over: Partial<FakeDeviceRow> = {},
): FakeDeviceRow {
  return {
    id,
    name: null,
    tenantId,
    pairedAt: new Date("2026-08-01T10:00:00.000Z"),
    lastSeenAt: new Date(),
    revokedAt: null,
    tenant: { id: tenantId, name: tenantName },
    register: {
      id: randomUUID(),
      name: "Barra",
      storeId: randomUUID(),
      store: { id: randomUUID(), name: "Tienda principal" },
    },
    heartbeat: heartbeat(),
    ...over,
  };
}

function publicarIndice(versionCode: number, versionName: string): void {
  writeFileSync(
    join(RELEASES_DIR, "releases.json"),
    JSON.stringify([
      {
        versionCode,
        versionName,
        fileName: `mipiacetpv-${versionName}-${versionCode}.apk`,
        sha256: "a".repeat(64),
        size: 1234,
        publishedAt: "2026-09-01T10:00:00.000Z",
        gitSha: "336f24b",
      },
    ]),
  );
}

function borrarIndice(): void {
  writeFileSync(join(RELEASES_DIR, "releases.json"), "[]");
}

let app: FastifyInstance;

beforeEach(async () => {
  vi.clearAllMocks();
  rows.length = 0;
  getDeviceChannelRegistry().__resetForTests();
  borrarIndice();
  app = Fastify({ logger: false });
  await registerSuperAdminDevicesRoutes(app);
  await app.ready();
});

describe("isOutdated", () => {
  it("sin índice publicado NADIE está desactualizado", () => {
    // En dev y en CI el directorio de releases está vacío. Si esto devolviera
    // true, el panel pintaría los quince terminales en rojo y la columna
    // dejaría de significar algo.
    expect(isOutdated(11401, null)).toBeNull();
  });

  it("un terminal que nunca dijo su versión no se marca en rojo", () => {
    expect(isOutdated(null, 11500)).toBeNull();
  });

  it("versión anterior a la publicada → desactualizado", () => {
    expect(isOutdated(11401, 11500)).toBe(true);
  });

  it("misma versión, o una más nueva que la publicada, no lo está", () => {
    expect(isOutdated(11500, 11500)).toBe(false);
    // Pasa de verdad: el terminal de laboratorio lleva un build que todavía no
    // se ha publicado. No es un problema y no debe pintarse como tal.
    expect(isOutdated(11600, 11500)).toBe(false);
  });
});

describe("isStale", () => {
  const AHORA = new Date("2026-09-04T12:00:00.000Z");

  it("un terminal que nunca se anunció está stale", () => {
    expect(isStale(null, AHORA)).toBe(true);
  });

  it("un latido reciente no lo está", () => {
    expect(isStale(new Date(AHORA.getTime() - 20_000), AHORA)).toBe(false);
  });

  it("un latido de hace días sí", () => {
    expect(isStale(new Date(AHORA.getTime() - 3 * 86_400_000), AHORA)).toBe(true);
  });
});

describe("GET /super-admin/devices", () => {
  it("sin sesión de super-admin no se ve la flota", async () => {
    rows.push(fila(DEVICE_A, TENANT_A, "Sirope"));
    const res = await app.inject({ method: "GET", url: "/super-admin/devices" });
    expect(res.statusCode).toBe(401);
  });

  it("`online` sale del canal abierto, no de la última fecha vista", async () => {
    // Latido de hace 20 s pero sin canal: el socket se acaba de caer y el panel
    // tiene que decir offline. Si esto se calculara con `lastSeenAt`, un
    // terminal apagado seguiría pintándose vivo hasta medio minuto después.
    rows.push(
      fila(DEVICE_A, TENANT_A, "Sirope", {
        heartbeat: heartbeat({ reportedAt: new Date(Date.now() - 20_000) }),
      }),
    );
    const res = await app.inject({
      method: "GET",
      url: "/super-admin/devices",
      headers: { authorization: saBearer() },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().devices[0].online).toBe(false);

    getDeviceChannelRegistry().register({
      deviceId: DEVICE_A,
      tenantId: TENANT_A,
      registerId: randomUUID(),
      connectedAt: new Date(),
      send: () => true,
      close: () => {},
    });

    const res2 = await app.inject({
      method: "GET",
      url: "/super-admin/devices",
      headers: { authorization: saBearer() },
    });
    expect(res2.json().devices[0].online).toBe(true);
  });

  it("marca quién está desactualizado contra el índice de A3", async () => {
    publicarIndice(11500, "1.15.0");
    rows.push(fila(DEVICE_A, TENANT_A, "Sirope"));
    rows.push(
      fila(DEVICE_B, TENANT_B, "Las Lomas", {
        heartbeat: heartbeat({ appVersionCode: 11500, appVersionName: "1.15.0" }),
      }),
    );

    const res = await app.inject({
      method: "GET",
      url: "/super-admin/devices",
      headers: { authorization: saBearer() },
    });
    const body = res.json();
    expect(body.latestRelease).toEqual({ versionCode: 11500, versionName: "1.15.0" });
    const porId = Object.fromEntries(
      body.devices.map((d: any) => [d.id, d.outdated]),
    );
    expect(porId[DEVICE_A], "1.14.1 contra 1.15.0 publicada").toBe(true);
    expect(porId[DEVICE_B]).toBe(false);
  });

  it("sin índice publicado, nadie sale en rojo", async () => {
    rows.push(fila(DEVICE_A, TENANT_A, "Sirope"));
    const res = await app.inject({
      method: "GET",
      url: "/super-admin/devices",
      headers: { authorization: saBearer() },
    });
    const body = res.json();
    expect(body.latestRelease).toBeNull();
    expect(body.devices[0].outdated).toBeNull();
  });

  it("el filtro por cuenta filtra de verdad", async () => {
    rows.push(fila(DEVICE_A, TENANT_A, "Sirope"));
    rows.push(fila(DEVICE_B, TENANT_B, "Las Lomas"));
    const res = await app.inject({
      method: "GET",
      url: `/super-admin/devices?tenantId=${TENANT_A}`,
      headers: { authorization: saBearer() },
    });
    const ids = res.json().devices.map((d: any) => d.id);
    expect(ids).toEqual([DEVICE_A]);
  });

  it("los revocados no salen salvo que se pidan", async () => {
    rows.push(fila(DEVICE_A, TENANT_A, "Sirope"));
    rows.push(
      fila(DEVICE_B, TENANT_B, "Las Lomas", { revokedAt: new Date(), heartbeat: null }),
    );

    const sinRevocados = await app.inject({
      method: "GET",
      url: "/super-admin/devices",
      headers: { authorization: saBearer() },
    });
    expect(sinRevocados.json().devices.map((d: any) => d.id)).toEqual([DEVICE_A]);

    const conRevocados = await app.inject({
      method: "GET",
      url: "/super-admin/devices?incluirRevocados=true",
      headers: { authorization: saBearer() },
    });
    expect(conRevocados.json().devices).toHaveLength(2);
  });

  it("delata un bundle ajeno a la APK (la lección de A4, en una columna)", async () => {
    rows.push(
      fila(DEVICE_A, TENANT_A, "Sirope", {
        heartbeat: heartbeat({ platform: "android", bundleTarget: "" }),
      }),
    );
    const res = await app.inject({
      method: "GET",
      url: "/super-admin/devices",
      headers: { authorization: saBearer() },
    });
    expect(res.json().devices[0].heartbeat.foreignBundle).toBe(true);
  });

  it("un terminal que nunca se anunció sale igual, con la instantánea vacía", async () => {
    // Un terminal vinculado con una APK vieja (sin canal) tiene que aparecer en
    // el inventario: es justo el que hay que ir a actualizar.
    rows.push(
      fila(DEVICE_A, TENANT_A, "Sirope", { heartbeat: null, lastSeenAt: null }),
    );
    const res = await app.inject({
      method: "GET",
      url: "/super-admin/devices",
      headers: { authorization: saBearer() },
    });
    const d = res.json().devices[0];
    expect(d.heartbeat).toBeNull();
    expect(d.online).toBe(false);
    expect(d.stale).toBe(true);
  });
});
