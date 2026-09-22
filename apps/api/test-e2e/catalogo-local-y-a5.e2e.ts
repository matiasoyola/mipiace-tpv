// El cruce de catalogo-local con A5, contra Postgres DE VERDAD.
//
// POR QUÉ ESTE FICHERO EXISTE. Los dos bloques se escribieron sin verse:
// `catalogo-local` salió de la base común y A5 entró en `master` después.
// Cada uno tiene su suite y las dos están en verde, y aun así nadie había
// ejecutado NUNCA la pregunta que este fichero hace:
//
//   ¿el comercio SIN Holded —el comercio del bloque— puede vincular un
//   terminal, abrir el canal de soporte y salir en la pantalla Terminales
//   igual que uno con Holded?
//
// La pregunta no es retórica. A5 dejó anotado en su done (§10.6, pendiente
// 3) que el cruce con H1 SÍ se rompe: una empresa sin caja no abre el canal
// porque su terminal aterriza en `cajaDisabled`. Ese precedente es el que
// obliga a mirar éste, porque `holdedEnabled` se escribió imitando a
// `cajaEnabled` y podría haber heredado el mismo efecto sin querer.
//
// La respuesta, ejecutada y no razonada, es que NO se rompe: `holdedEnabled`
// no gatea ninguna ruta de `devices/`, y el camino sin Holded del TPV no
// crea ningún estado terminal nuevo en `useDeviceBootstrap`. El comercio sin
// Holded se comporta EXACTAMENTE como el que tiene Holded en todo lo que es
// de A5. Este fichero lo fija para que deje de ser cierto por casualidad.
//
// Y fija también el contraste, que es lo que le da sentido: el mismo
// recorrido con la caja apagada se para, y se para ANTES de lo que decía el
// done de A5 —no en el canal, sino en el código de emparejamiento—. Sin ese
// caso rojo, los verdes de arriba no probarían nada.

import { randomBytes, randomUUID } from "node:crypto";

import Fastify, { type FastifyInstance } from "fastify";
import websocket from "@fastify/websocket";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { E2E_DATABASE_URL, e2eEnabled, SKIP_MESSAGE } from "./e2e-env.js";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = E2E_DATABASE_URL || "postgresql://e2e:e2e@127.0.0.1:5432/e2e";
process.env.REDIS_URL = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";
process.env.JWT_ACCESS_SECRET = "e".repeat(40);
process.env.JWT_REFRESH_SECRET = "f".repeat(40);
process.env.SUPER_ADMIN_JWT_SECRET = "g".repeat(48);
process.env.HOLDED_KEY_ENCRYPTION_SECRET = randomBytes(32).toString("base64");

// La alerta de dispositivo manda correo y consulta geolocalización. Ni una
// cosa ni la otra son el objeto de este fichero.
vi.mock("../src/email/sender.js", () => ({
  getEmailSender: () => ({ send: async () => undefined }),
}));

const { getPrisma, shutdown } = await import("../src/context.js");
const { registerDeviceRoutes } = await import("../src/devices/routes.js");
const { registerDeviceWebSocketRoute } = await import("../src/devices/ws-route.js");
const { registerSuperAdminDevicesRoutes } = await import(
  "../src/superadmin/devices.js"
);
const { registerErrorHandler } = await import("../src/lib/error-handler.js");
const { signAccessToken } = await import("../src/auth/tokens.js");
const { hashPassword } = await import("../src/auth/passwords.js");
const jwtLib = (await import("jsonwebtoken")).default;

interface Comercio {
  tenantId: string;
  ownerId: string;
  registerId: string;
  storeId: string;
}

describe.skipIf(!e2eEnabled)(
  "e2e · el comercio sin Holded y el acceso remoto de A5",
  () => {
    if (!e2eEnabled) console.warn(`\n${SKIP_MESSAGE}\n`);

    const prisma = getPrisma();
    let app: FastifyInstance;
    let superAdminId = "";

    // El comercio del bloque: CON caja y SIN Holded.
    let sinHolded: Comercio;
    // El comercio de hoy, que es la vara de medir: con Holded y con caja.
    let conHolded: Comercio;
    // El de H1, para el contraste: SIN caja.
    let sinCaja: Comercio;

    const ownerAuth = (c: Comercio) => ({
      authorization: `Bearer ${signAccessToken({
        sub: c.ownerId,
        tid: c.tenantId,
        role: "OWNER",
      })}`,
    });

    const saAuth = () => ({
      authorization: `Bearer ${jwtLib.sign(
        { sub: superAdminId, purpose: "super-admin", tv: 0, type: "access" },
        process.env.SUPER_ADMIN_JWT_SECRET!,
        { expiresIn: "1h" },
      )}`,
    });

    async function crearComercio(opts: {
      etiqueta: string;
      holdedEnabled: boolean;
      cajaEnabled: boolean;
    }): Promise<Comercio> {
      const tenant = await prisma.tenant.create({
        data: {
          name: `${opts.etiqueta} ${randomUUID().slice(0, 8)}`,
          holdedEnabled: opts.holdedEnabled,
          cajaEnabled: opts.cajaEnabled,
          initialSyncStatus: opts.holdedEnabled ? "DONE" : "NOT_APPLICABLE",
          holdedApiKeyCiphertext: opts.holdedEnabled ? "v1:loquesea" : null,
        },
      });
      const owner = await prisma.user.create({
        data: {
          tenantId: tenant.id,
          email: `owner-${randomUUID().slice(0, 8)}@ejemplo.es`,
          passwordHash: await hashPassword("Irrelevante1!"),
          role: "OWNER",
        },
      });
      const store = await prisma.store.create({
        data: { tenantId: tenant.id, name: "Tienda" },
      });
      const register = await prisma.register.create({
        data: { storeId: store.id, name: "Caja 1" },
      });
      return {
        tenantId: tenant.id,
        ownerId: owner.id,
        storeId: store.id,
        registerId: register.id,
      };
    }

    /** Pide un código por la ruta REAL y lo canjea por la ruta REAL. */
    async function vincularTerminal(
      c: Comercio,
      nombre: string,
    ): Promise<{ deviceId: string; deviceToken: string }> {
      const codeRes = await app.inject({
        method: "POST",
        url: `/admin/registers/${c.registerId}/pairing-codes`,
        headers: ownerAuth(c),
        payload: {},
      });
      expect(
        codeRes.statusCode,
        `${nombre}: generar el código de emparejamiento`,
      ).toBe(201);
      const code = codeRes.json().code as string;

      const pairRes = await app.inject({
        method: "POST",
        url: "/devices/pair",
        payload: { code, deviceName: nombre },
      });
      expect(pairRes.statusCode, `${nombre}: canjear el código`).toBe(201);
      return {
        deviceId: pairRes.json().deviceId,
        deviceToken: pairRes.json().deviceToken,
      };
    }

    /**
     * Abre `/ws/device` y espera al `ready`. Rechaza si el socket se cierra
     * antes: un canal que no llega a `ready` no es un canal.
     */
    async function abrirCanal(
      token: string,
      status?: Record<string, unknown>,
    ): Promise<any> {
      const ws = await app.injectWS("/ws/device");
      const ready = new Promise<void>((resolve, reject) => {
        ws.on("message", (data: Buffer) => {
          const msg = JSON.parse(data.toString());
          if (msg.type === "ready") resolve();
        });
        ws.on("close", (code: number) =>
          reject(new Error(`el canal se cerró con ${code} antes del ready`)),
        );
      });
      ws.send(JSON.stringify({ type: "hello", token, status }));
      await ready;
      return ws;
    }

    const tick = (ms = 40) => new Promise((r) => setTimeout(r, ms));

    async function esperarA(cond: () => Promise<boolean>, timeoutMs = 2_000) {
      const limite = Date.now() + timeoutMs;
      while (Date.now() < limite) {
        if (await cond()) return;
        await tick(25);
      }
    }

    beforeAll(async () => {
      app = Fastify({ logger: false });
      registerErrorHandler(app);
      await app.register(websocket);
      await registerDeviceRoutes(app);
      await registerDeviceWebSocketRoute(app);
      await registerSuperAdminDevicesRoutes(app);
      await app.ready();

      superAdminId = randomUUID();
      await prisma.superAdminUser.create({
        data: {
          id: superAdminId,
          email: `cruce-${superAdminId.slice(0, 8)}@mipiacetpv.tech`,
          passwordHash: await hashPassword("Irrelevante1!"),
        },
      });

      sinHolded = await crearComercio({
        etiqueta: "Peluquería local",
        holdedEnabled: false,
        cajaEnabled: true,
      });
      conHolded = await crearComercio({
        etiqueta: "Thalia Eventos",
        holdedEnabled: true,
        cajaEnabled: true,
      });
      sinCaja = await crearComercio({
        etiqueta: "Colegio de Talavera",
        holdedEnabled: false,
        cajaEnabled: false,
      });
    });

    afterAll(async () => {
      await app?.close();
      await shutdown();
    });

    // ── 1 · vincular un terminal sin Holded ──────────────────────────────

    describe("vincular", () => {
      it("el comercio SIN Holded genera código y vincula un terminal", async () => {
        const { deviceId } = await vincularTerminal(sinHolded, "TPV sin Holded");
        const d = await prisma.device.findUniqueOrThrow({
          where: { id: deviceId },
        });
        expect(d.tenantId).toBe(sinHolded.tenantId);
        expect(d.revokedAt).toBeNull();

        // Y el interruptor sigue apagado: vincular no lo enciende por el
        // camino. Si esto cambiara, el TPV volvería a mandar a Holded al
        // comercio que no lo usa.
        const t = await prisma.tenant.findUniqueOrThrow({
          where: { id: sinHolded.tenantId },
        });
        expect(t.holdedEnabled).toBe(false);
      });

      it("EL CONTRASTE · el comercio SIN CAJA no llega ni al código", async () => {
        // Esto es el pendiente 3 del §10.6 de A5, ejecutado. Y afina lo que
        // aquel done dejó escrito: el terminal de una empresa sin caja no es
        // que "no abra el canal", es que NO EXISTE — `ensureCajaEnabled`
        // cierra la generación del código, así que nunca hay nada que
        // vincular. Por eso no sale en Terminales.
        const res = await app.inject({
          method: "POST",
          url: `/admin/registers/${sinCaja.registerId}/pairing-codes`,
          headers: ownerAuth(sinCaja),
          payload: {},
        });
        expect(res.statusCode).toBe(403);
        expect(res.json().error).toBe("CAJA_DISABLED");
      });
    });

    // ── 2 · el arranque del TPV ──────────────────────────────────────────

    describe("el arranque del TPV", () => {
      it("`/devices/me` contesta 200 sin Holded: el terminal llega a `paired`", async () => {
        // `paired` es la precondición EXACTA del canal de A5: el efecto que
        // llama a `startSupportChannel` exige `state.kind === "paired"`. Un
        // 403 aquí dejaría al terminal en un estado terminal y el canal no
        // se abriría nunca — que es justo lo que le pasa al de H1.
        const { deviceToken } = await vincularTerminal(
          sinHolded,
          "TPV bootstrap",
        );
        const res = await app.inject({
          method: "GET",
          url: "/devices/me",
          headers: { "x-device-token": deviceToken },
        });
        expect(res.statusCode).toBe(200);
        expect(res.json().tenant.id).toBe(sinHolded.tenantId);
      });

      it("el de CON Holded contesta lo mismo: el interruptor no cambia el arranque", async () => {
        const { deviceToken } = await vincularTerminal(conHolded, "TPV Thalia");
        const res = await app.inject({
          method: "GET",
          url: "/devices/me",
          headers: { "x-device-token": deviceToken },
        });
        expect(res.statusCode).toBe(200);
        expect(res.json().tenant.id).toBe(conHolded.tenantId);
      });

      it("`/devices/me` no manda el interruptor: el bootstrap no puede ramificar por él", async () => {
        const { deviceToken } = await vincularTerminal(sinHolded, "TPV payload");
        const res = await app.inject({
          method: "GET",
          url: "/devices/me",
          headers: { "x-device-token": deviceToken },
        });
        // Red estructural: el día que alguien meta `holdedEnabled` en este
        // payload, el TPV podrá ramificar por él en el arranque y este
        // fichero entero dejará de significar lo que dice. Que salte.
        //
        // Se busca el interruptor por su nombre y no /holded/i: el payload
        // YA lleva `register.numSerieHolded`, que es el número de serie de
        // facturación y no tiene nada que ver con esto.
        expect(JSON.stringify(res.json())).not.toMatch(/holdedEnabled/);
      });
    });

    // ── 3 · el canal de soporte ──────────────────────────────────────────

    describe("el canal de soporte", () => {
      it("un terminal SIN Holded abre canal y su latido llega a la BD", async () => {
        const { deviceId, deviceToken } = await vincularTerminal(
          sinHolded,
          "TPV canal",
        );
        const ws = await abrirCanal(deviceToken, {
          platform: "android",
          appVersionCode: 1170,
          appVersionName: "1.17.0",
          outboxPending: 0,
          shiftOpen: false,
        });
        try {
          await esperarA(async () => {
            const hb = await prisma.deviceHeartbeat.findUnique({
              where: { deviceId },
            });
            return hb != null;
          });
          const hb = await prisma.deviceHeartbeat.findUniqueOrThrow({
            where: { deviceId },
          });
          expect(hb.appVersionCode).toBe(1170);
          expect(hb.platform).toBe("android");
        } finally {
          ws.close();
        }
      });

      it("el `status` posterior también se guarda, como en cualquier terminal", async () => {
        const { deviceId, deviceToken } = await vincularTerminal(
          sinHolded,
          "TPV status",
        );
        const ws = await abrirCanal(deviceToken);
        try {
          ws.send(
            JSON.stringify({
              type: "status",
              platform: "android",
              outboxPending: 7,
              network: "wifi",
            }),
          );
          await esperarA(async () => {
            const hb = await prisma.deviceHeartbeat.findUnique({
              where: { deviceId },
            });
            return hb?.outboxPending === 7;
          });
          const hb = await prisma.deviceHeartbeat.findUniqueOrThrow({
            where: { deviceId },
          });
          expect(hb.outboxPending).toBe(7);
          expect(hb.network).toBe("wifi");
          expect(hb.outboxStuckSince).not.toBeNull();
        } finally {
          ws.close();
        }
      });
    });

    // ── 4 · la pantalla Terminales ───────────────────────────────────────

    describe("la pantalla Terminales", () => {
      it("el terminal del comercio SIN Holded sale, y sale ONLINE", async () => {
        const { deviceId, deviceToken } = await vincularTerminal(
          sinHolded,
          "TPV inventario",
        );
        const ws = await abrirCanal(deviceToken, { outboxPending: 0 });
        try {
          const res = await app.inject({
            method: "GET",
            url: `/super-admin/devices?tenantId=${sinHolded.tenantId}`,
            headers: saAuth(),
          });
          expect(res.statusCode).toBe(200);
          const fila = res
            .json()
            .devices.find((d: any) => d.id === deviceId);
          expect(fila, "el terminal sin Holded tiene que salir en Terminales").toBeTruthy();
          expect(fila.online).toBe(true);
          expect(fila.tenantId).toBe(sinHolded.tenantId);
        } finally {
          ws.close();
        }
      });

      it("el listado SIN filtro mezcla los dos comercios: Terminales no separa por Holded", async () => {
        const a = await vincularTerminal(sinHolded, "TPV mezcla local");
        const b = await vincularTerminal(conHolded, "TPV mezcla Thalia");
        const res = await app.inject({
          method: "GET",
          url: "/super-admin/devices",
          headers: saAuth(),
        });
        expect(res.statusCode).toBe(200);
        const ids = res.json().devices.map((d: any) => d.id);
        expect(ids).toContain(a.deviceId);
        expect(ids).toContain(b.deviceId);
      });

      it("EL CONTRASTE · el comercio sin caja no tiene NINGÚN terminal que listar", async () => {
        const res = await app.inject({
          method: "GET",
          url: `/super-admin/devices?tenantId=${sinCaja.tenantId}`,
          headers: saAuth(),
        });
        expect(res.statusCode).toBe(200);
        expect(res.json().devices).toEqual([]);
      });
    });

    // ── 5 · la red estructural ───────────────────────────────────────────

    describe("red estructural", () => {
      it("nada de `devices/` mira `holdedEnabled`", async () => {
        // Ésta es la que sobrevive a un refactor. Los tests de arriba dicen
        // que HOY el camino sin Holded no se rompe; ésta dice por qué, y
        // salta el día que alguien meta una puerta de Holded en el acceso
        // remoto sin darse cuenta de que deja fuera al comercio del bloque.
        const { readFileSync, readdirSync } = await import("node:fs");
        const { join } = await import("node:path");
        const dir = new URL("../src/devices/", import.meta.url).pathname;
        const culpables: string[] = [];
        for (const f of readdirSync(dir)) {
          if (!f.endsWith(".ts")) continue;
          const src = readFileSync(join(dir, f), "utf8");
          if (/holdedEnabled|holded_enabled/.test(src)) culpables.push(f);
        }
        expect(
          culpables,
          "el acceso remoto no puede depender del interruptor de Holded: " +
            "un comercio de catálogo local también se atiende",
        ).toEqual([]);
      });
    });
  },
);
