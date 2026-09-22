// A5 · Frentes 3 y 4 · comandos con lista blanca y capturas con caducidad.
//
// Un canal permanente contra quince cajas en casa de clientes sólo es
// defendible si lo que puede viajar por él está escrito y es corto. Esto prueba
// esa frase:
//
//   - un comando fuera de la lista NO sale, y queda auditado,
//   - TODO comando deja registro, y se escribe ANTES de mandarlo,
//   - si la auditoría falla, el comando no sale,
//   - un comando que no vuelve se ve como que no volvió,
//   - un terminal no puede contestar por otro,
//   - una captura se guarda con motivo, dueño y caducidad, y una caducada NO se
//     sirve aunque el fichero siga en disco,
//   - el barrido borra fichero y fila.

import { mkdtempSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";

const SCREENSHOT_DIR = mkdtempSync(join(tmpdir(), "mipiacetpv-a5-shots-"));
const RELEASES_DIR = mkdtempSync(join(tmpdir(), "mipiacetpv-a5-rel-"));

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.REDIS_URL = "redis://localhost:6379";
process.env.JWT_ACCESS_SECRET = "a".repeat(40);
process.env.JWT_REFRESH_SECRET = "b".repeat(40);
process.env.SUPER_ADMIN_JWT_SECRET = "s".repeat(40);
process.env.HOLDED_KEY_ENCRYPTION_SECRET = randomBytes(32).toString("base64");
process.env.DEVICE_SCREENSHOT_DIR = SCREENSHOT_DIR;
process.env.RELEASES_DIR = RELEASES_DIR;

import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const SA_ID = randomUUID();
const TENANT_A = randomUUID();
const DEVICE_A = randomUUID();
const DEVICE_B = randomUUID();

// PNG de 1×1 real: el guardado comprueba la firma del fichero, no lo que diga
// el terminal.
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

interface ScreenshotRow {
  id: string;
  deviceId: string;
  tenantId: string;
  requestedBySuperAdminId: string;
  commandId: string;
  reason: string;
  fileName: string;
  bytes: number;
  mimeType: string;
  createdAt: Date;
  expiresAt: Date;
}

const audits: Array<{ action: string; metadata: Record<string, unknown> }> = [];
const screenshots = new Map<string, ScreenshotRow>();
const devices = new Map<string, { id: string; tenantId: string; revokedAt: Date | null }>();

// Interruptor para el sabotaje "la auditoría falla": el comando NO debe salir.
let auditFalla = false;

const fakePrisma = {
  device: {
    findUnique: vi.fn(async ({ where }: any) => devices.get(where.id) ?? null),
  },
  superAdminUser: {
    findUnique: vi.fn(async () => ({
      id: SA_ID,
      tokenVersion: 1,
      deletedAt: null,
      isRoot: true,
    })),
  },
  superAdminAudit: {
    create: vi.fn(async ({ data }: any) => {
      if (auditFalla) throw new Error("BD de auditoría caída");
      audits.push({ action: data.action, metadata: data.metadata });
      return data;
    }),
  },
  deviceScreenshot: {
    create: vi.fn(async ({ data }: any) => {
      screenshots.set(data.id, data as ScreenshotRow);
      return data;
    }),
    findUnique: vi.fn(async ({ where }: any) => screenshots.get(where.id) ?? null),
    findMany: vi.fn(async ({ where }: any) => {
      const now = where?.expiresAt?.gt ?? where?.expiresAt?.lte;
      return [...screenshots.values()].filter((s) => {
        if (where?.deviceId && s.deviceId !== where.deviceId) return false;
        if (where?.expiresAt?.gt) return s.expiresAt.getTime() > now.getTime();
        if (where?.expiresAt?.lte) return s.expiresAt.getTime() <= now.getTime();
        return true;
      });
    }),
    deleteMany: vi.fn(async ({ where }: any) => {
      let count = 0;
      for (const id of where.id.in as string[]) {
        if (screenshots.delete(id)) count += 1;
      }
      return { count };
    }),
  },
} as any;

vi.mock("../src/context.js", () => ({
  getPrisma: () => fakePrisma,
  getRedis: () => ({}),
  shutdown: async () => undefined,
}));

const {
  registerSuperAdminDeviceCommandRoutes,
  registerSuperAdminScreenshotRoutes,
} = await import("../src/superadmin/devices.js");
const { getDeviceChannelRegistry } = await import(
  "../src/devices/channel-registry.js"
);
const { resolverComando, enviarComando, __resetComandosForTests, COMANDOS } =
  await import("../src/devices/commands.js");
const { purgarCapturasCaducadas } = await import("../src/devices/screenshots.js");
const { signSuperAdminAccessToken } = await import("../src/superadmin/tokens.js");

function saBearer(): string {
  return `Bearer ${signSuperAdminAccessToken({ sub: SA_ID, tv: 1 })}`;
}

/**
 * Registra un canal falso que contesta lo que se le diga. `respuesta: null`
 * simula el terminal que se queda callado.
 */
function canalFalso(
  deviceId: string,
  respuesta: ((accion: string) => unknown) | null,
): { enviados: Array<Record<string, unknown>> } {
  const enviados: Array<Record<string, unknown>> = [];
  getDeviceChannelRegistry().register({
    deviceId,
    tenantId: TENANT_A,
    registerId: randomUUID(),
    connectedAt: new Date(),
    send(payload: unknown) {
      const msg = payload as { commandId: string; action: string };
      enviados.push(msg as never);
      if (respuesta) {
        // Como el terminal de verdad: contesta en otro tick.
        setTimeout(() => {
          resolverComando(deviceId, msg.commandId, {
            estado: "ok",
            datos: respuesta(msg.action),
          });
        }, 5);
      }
      return true;
    },
    close() {},
  });
  return { enviados };
}

let app: FastifyInstance;

beforeEach(async () => {
  vi.clearAllMocks();
  audits.length = 0;
  screenshots.clear();
  devices.clear();
  auditFalla = false;
  getDeviceChannelRegistry().__resetForTests();
  __resetComandosForTests();
  devices.set(DEVICE_A, { id: DEVICE_A, tenantId: TENANT_A, revokedAt: null });
  devices.set(DEVICE_B, { id: DEVICE_B, tenantId: TENANT_A, revokedAt: null });

  app = Fastify({ logger: false });
  await registerSuperAdminDeviceCommandRoutes(app);
  await registerSuperAdminScreenshotRoutes(app);
  await app.ready();
});

afterEach(async () => {
  await app.close();
});

function mandar(deviceId: string, action: string, reason = "Thalía llama") {
  return app.inject({
    method: "POST",
    url: `/super-admin/devices/${deviceId}/commands`,
    headers: { authorization: saBearer() },
    payload: { action, reason },
  });
}

describe("A5 · la lista blanca", () => {
  it("tiene exactamente los seis comandos del bloque", () => {
    expect([...COMANDOS]).toEqual([
      "recargar",
      "volcar-logs",
      "captura-de-pantalla",
      "forzar-sync",
      "reiniciar-app",
      "decir-version",
    ]);
  });

  it("un comando fuera de la lista se rechaza Y queda auditado", async () => {
    const canal = canalFalso(DEVICE_A, () => ({}));
    const res = await mandar(DEVICE_A, "borrar-turno");

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("COMANDO_DESCONOCIDO");
    expect(canal.enviados, "no puede salir NADA al terminal").toHaveLength(0);

    const rechazo = audits.find((a) => a.action === "device_command_rejected");
    expect(rechazo, "el intento tiene que quedar registrado").toBeTruthy();
    expect(rechazo!.metadata.accionSolicitada).toBe("borrar-turno");
  });

  it("no hay comando genérico: 'eval' tampoco cuela", async () => {
    const canal = canalFalso(DEVICE_A, () => ({}));
    for (const intento of ["eval", "exec", "sh", "shell", ""]) {
      const res = await mandar(DEVICE_A, intento);
      expect([400, 404]).toContain(res.statusCode);
    }
    expect(canal.enviados).toHaveLength(0);
  });

  it("sin sesión de super-admin no se manda nada", async () => {
    const canal = canalFalso(DEVICE_A, () => ({}));
    const res = await app.inject({
      method: "POST",
      url: `/super-admin/devices/${DEVICE_A}/commands`,
      payload: { action: "recargar", reason: "porque sí" },
    });
    expect(res.statusCode).toBe(401);
    expect(canal.enviados).toHaveLength(0);
  });

  it("un comando sin motivo no se manda", async () => {
    const canal = canalFalso(DEVICE_A, () => ({}));
    const res = await app.inject({
      method: "POST",
      url: `/super-admin/devices/${DEVICE_A}/commands`,
      headers: { authorization: saBearer() },
      payload: { action: "recargar" },
    });
    expect(res.statusCode).toBe(400);
    expect(canal.enviados).toHaveLength(0);
  });
});

describe("A5 · sin registro no hay comando", () => {
  it("todo comando deja registro, y el de intención va ANTES del envío", async () => {
    canalFalso(DEVICE_A, () => ({ ok: 1 }));
    const res = await mandar(DEVICE_A, "decir-version", "revisando versión");
    expect(res.statusCode).toBe(200);

    const acciones = audits.map((a) => a.action);
    expect(acciones).toContain("device_command");
    expect(acciones).toContain("device_command_result");
    // El de intención primero: si el terminal no contestara, ése es el único
    // que existiría, y es el que hay que poder investigar.
    expect(acciones.indexOf("device_command")).toBeLessThan(
      acciones.indexOf("device_command_result"),
    );

    const intencion = audits.find((a) => a.action === "device_command")!;
    expect(intencion.metadata.motivo).toBe("revisando versión");
    expect(intencion.metadata.deviceId).toBe(DEVICE_A);
  });

  it("si la auditoría falla, el comando NO sale", async () => {
    const canal = canalFalso(DEVICE_A, () => ({}));
    auditFalla = true;
    const res = await mandar(DEVICE_A, "recargar");
    expect(res.statusCode).toBe(500);
    expect(
      canal.enviados,
      "sin traza no se toca el terminal de un cliente",
    ).toHaveLength(0);
  });
});

describe("A5 · el comando que no vuelve", () => {
  it("se ve como 'sin-respuesta', no se queda en enviando", async () => {
    canalFalso(DEVICE_A, null); // el terminal se calla
    // Por la función y no por HTTP: el timeout real son 25 s y esperarlos en un
    // test no prueba nada más que la paciencia de quien lo corre.
    const enviado = await enviarComando({
      prisma: fakePrisma,
      superAdminId: SA_ID,
      deviceId: DEVICE_A,
      tenantId: TENANT_A,
      accion: "volcar-logs",
      motivo: "no arranca",
      signals: { ipAddress: null, userAgent: null },
      timeoutMs: 50,
    });
    expect(enviado.resultado.estado).toBe("sin-respuesta");
    expect(
      audits.find((a) => a.action === "device_command_result")!.metadata.resultado,
    ).toBe("sin-respuesta");
  });

  it("si el canal se cae al enviar, se contesta ya y se audita el resultado", async () => {
    getDeviceChannelRegistry().register({
      deviceId: DEVICE_A,
      tenantId: TENANT_A,
      registerId: randomUUID(),
      connectedAt: new Date(),
      send: () => false, // el socket se cerró entre el get y el send
      close() {},
    });
    const res = await mandar(DEVICE_A, "recargar");
    expect(res.json().status).toBe("error");
    expect(audits.find((a) => a.action === "device_command_result")!.metadata
      .resultado).toBe("error");
  });

  it("un terminal offline no acepta comandos", async () => {
    const res = await mandar(DEVICE_A, "recargar");
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("TERMINAL_OFFLINE");
  });

  it("un terminal revocado tampoco, y con su propio error", async () => {
    devices.get(DEVICE_A)!.revokedAt = new Date();
    const res = await mandar(DEVICE_A, "recargar");
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("DEVICE_REVOKED");
  });

  it("un terminal no puede contestar por el comando de otro", async () => {
    canalFalso(DEVICE_A, null);
    const canalB = canalFalso(DEVICE_B, null);

    const enviando = enviarComando({
      prisma: fakePrisma,
      superAdminId: SA_ID,
      deviceId: DEVICE_B,
      tenantId: TENANT_A,
      accion: "decir-version",
      motivo: "aislamiento",
      signals: { ipAddress: null, userAgent: null },
      timeoutMs: 200,
    });
    await new Promise((r) => setTimeout(r, 20));

    const commandId = String(canalB.enviados[0]!.commandId);
    // A intenta contestar por el comando que se le mandó a B, con el id
    // correcto. El `deviceId` del canal es lo que lo impide.
    expect(
      resolverComando(DEVICE_A, commandId, { estado: "ok", datos: "robado" }),
      "el terminal A no puede contestar por B ni con el id correcto",
    ).toBe(false);

    const enviado = await enviando;
    expect(enviado.resultado.estado).toBe("sin-respuesta");
  });
});

describe("A5 · capturas de pantalla", () => {
  it("se guardan con dueño, motivo y caducidad, y no devuelven el binario", async () => {
    canalFalso(DEVICE_A, () => ({
      pngBase64: PNG_1X1.toString("base64"),
      width: 1,
      height: 1,
    }));

    const res = await mandar(DEVICE_A, "captura-de-pantalla", "pantalla en blanco");
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe("ok");
    // El PNG NO viaja en la respuesta: sale por su propio endpoint, con sesión
    // y auditado. Si viajara aquí, la imagen quedaría suelta en una respuesta
    // HTTP sin dueño ni caducidad.
    expect(body.data.screenshotId).toBeTruthy();
    expect(body.data).not.toHaveProperty("pngBase64");
    expect(new Date(body.data.expiresAt).getTime()).toBeGreaterThan(Date.now());

    const fila = screenshots.get(body.data.screenshotId)!;
    expect(fila.reason).toBe("pantalla en blanco");
    expect(fila.requestedBySuperAdminId).toBe(SA_ID);
    expect(existsSync(join(SCREENSHOT_DIR, fila.fileName))).toBe(true);

    const traza = audits.find((a) => a.action === "device_screenshot")!;
    expect(traza.metadata.motivo).toBe("pantalla en blanco");
  });

  it("lo que no es un PNG no se guarda", async () => {
    canalFalso(DEVICE_A, () => ({
      pngBase64: Buffer.from("<html>no soy una imagen</html>").toString("base64"),
    }));
    const res = await mandar(DEVICE_A, "captura-de-pantalla", "probando");
    expect(res.json().status).toBe("error");
    expect(screenshots.size).toBe(0);
  });

  it("abrir una captura se audita aparte de haberla pedido", async () => {
    canalFalso(DEVICE_A, () => ({ pngBase64: PNG_1X1.toString("base64") }));
    const creada = await mandar(DEVICE_A, "captura-de-pantalla", "mirando");
    const id = creada.json().data.screenshotId;
    audits.length = 0;

    const res = await app.inject({
      method: "GET",
      url: `/super-admin/devices/screenshots/${id}`,
      headers: { authorization: saBearer() },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("image/png");
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(audits.map((a) => a.action)).toContain("device_screenshot_viewed");
  });

  it("sin sesión de super-admin no se abre una captura", async () => {
    canalFalso(DEVICE_A, () => ({ pngBase64: PNG_1X1.toString("base64") }));
    const creada = await mandar(DEVICE_A, "captura-de-pantalla", "mirando");
    const id = creada.json().data.screenshotId;

    const res = await app.inject({
      method: "GET",
      url: `/super-admin/devices/screenshots/${id}`,
    });
    expect(res.statusCode).toBe(401);
  });

  it("una captura CADUCADA no se sirve aunque el fichero siga en disco", async () => {
    canalFalso(DEVICE_A, () => ({ pngBase64: PNG_1X1.toString("base64") }));
    const creada = await mandar(DEVICE_A, "captura-de-pantalla", "mirando");
    const id = creada.json().data.screenshotId;

    // Se adelanta la caducidad sin tocar el disco: el barrido todavía no ha
    // pasado. La retención es una promesa sobre el ACCESO, no sobre el cron.
    const fila = screenshots.get(id)!;
    fila.expiresAt = new Date(Date.now() - 1000);
    expect(existsSync(join(SCREENSHOT_DIR, fila.fileName))).toBe(true);

    const res = await app.inject({
      method: "GET",
      url: `/super-admin/devices/screenshots/${id}`,
      headers: { authorization: saBearer() },
    });
    expect(res.statusCode).toBe(404);
  });

  it("el barrido borra el fichero Y la fila", async () => {
    canalFalso(DEVICE_A, () => ({ pngBase64: PNG_1X1.toString("base64") }));
    const creada = await mandar(DEVICE_A, "captura-de-pantalla", "mirando");
    const id = creada.json().data.screenshotId;
    const fila = screenshots.get(id)!;
    fila.expiresAt = new Date(Date.now() - 1000);

    const r = await purgarCapturasCaducadas({
      prisma: fakePrisma,
      dir: SCREENSHOT_DIR,
    });

    expect(r.filasBorradas).toBe(1);
    expect(r.ficherosBorrados).toBe(1);
    expect(
      existsSync(join(SCREENSHOT_DIR, fila.fileName)),
      "si el fichero se queda, la retención de 24 h es una frase y no un hecho",
    ).toBe(false);
    expect(screenshots.has(id)).toBe(false);
  });

  it("el barrido NO toca las capturas vivas", async () => {
    canalFalso(DEVICE_A, () => ({ pngBase64: PNG_1X1.toString("base64") }));
    const creada = await mandar(DEVICE_A, "captura-de-pantalla", "mirando");
    const id = creada.json().data.screenshotId;

    const r = await purgarCapturasCaducadas({
      prisma: fakePrisma,
      dir: SCREENSHOT_DIR,
    });
    expect(r.filasBorradas).toBe(0);
    expect(screenshots.has(id)).toBe(true);
  });

  it("un fichero que ya no está no bloquea el borrado de la fila", async () => {
    // Pasa si el barrido se solapa consigo mismo, o si alguien limpió a mano.
    screenshots.set("huerfana", {
      id: "huerfana",
      deviceId: DEVICE_A,
      tenantId: TENANT_A,
      requestedBySuperAdminId: SA_ID,
      commandId: randomUUID(),
      reason: "x",
      fileName: `${randomUUID()}-aaaaaaaaaaaa.png`,
      bytes: 1,
      mimeType: "image/png",
      createdAt: new Date(),
      expiresAt: new Date(Date.now() - 1000),
    });
    const r = await purgarCapturasCaducadas({
      prisma: fakePrisma,
      dir: SCREENSHOT_DIR,
    });
    expect(r.filasBorradas).toBe(1);
    expect(r.errores).toBe(0);
    expect(screenshots.has("huerfana")).toBe(false);
  });
});

// Deja el directorio de releases con un índice vacío para no ensuciar otros
// tests que compartan tmpdir.
writeFileSync(join(RELEASES_DIR, "releases.json"), "[]");
