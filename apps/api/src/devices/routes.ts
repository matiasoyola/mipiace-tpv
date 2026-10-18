import { randomInt } from "node:crypto";

import type { FastifyInstance } from "fastify";

import { getPrisma } from "../context.js";
import { requireOwnerOrManager } from "../auth/middleware.js";
import { evaluateDeviceAlert } from "./alerts.js";
import { ensureCajaEnabled } from "../lib/caja-gate.js";
import { getDeviceChannelRegistry, WS_CLOSE } from "./channel-registry.js";
import {
  generateDeviceToken,
  hashDeviceToken,
  requireDeviceToken,
} from "./auth.js";

const PAIRING_CODE_TTL_MINUTES = 60;
const PAIRING_CODE_MAX_ATTEMPTS = 8;

function newSixDigitCode(): string {
  // randomInt evita bias.  Six dígitos con leading zeros conservados.
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

export async function registerDeviceRoutes(app: FastifyInstance): Promise<void> {
  // Genera código de emparejamiento (owner o manager — B6 §1 cierra el
  // TODO heredado de B3/B4: el MANAGER puede generar códigos desde la
  // pantalla de Dispositivos).
  app.post(
    "/admin/registers/:registerId/pairing-codes",
    {
      preHandler: [requireOwnerOrManager, ensureCajaEnabled],
      schema: {
        params: {
          type: "object",
          required: ["registerId"],
          properties: { registerId: { type: "string", format: "uuid" } },
        },
        body: {
          type: "object",
          additionalProperties: false,
          properties: {
            name: { type: "string", maxLength: 80 },
            // kds-1-cocina (decisión 1) · QUÉ se va a emparejar con este
            // código. Lo decide quien lo genera —propietario o encargado,
            // autenticado— y NO el aparato que se empareja.
            //
            // Si `POST /devices/pair` aceptase `kind` del cuerpo,
            // cualquiera con un código de caja podría emparejarse como
            // pantalla de cocina. Y una pantalla no releva al terminal, así
            // que el resultado sería una caja con dos aparatos vivos donde
            // el segundo no factura y nadie se enteró.
            kind: { type: "string", enum: ["TERMINAL", "KITCHEN"] },
            // Las secciones de la pantalla (decisión 2): COCINA, BARRA o
            // las dos. Obligatorias y no vacías con `kind: KITCHEN`, y
            // prohibidas en lo demás — lo garantiza el CHECK
            // `pairing_codes_kitchen_sections` de la base, y aquí se
            // responde con un mensaje en vez de con un 500.
            kitchenSections: {
              type: "array",
              minItems: 1,
              maxItems: 3,
              uniqueItems: true,
              items: { type: "string", enum: ["BARRA", "COCINA", "SALON"] },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const auth = request.auth!;
      const { registerId } = request.params as { registerId: string };
      const body = (request.body ?? {}) as {
        name?: string;
        kind?: "TERMINAL" | "KITCHEN";
        kitchenSections?: Array<"BARRA" | "COCINA" | "SALON">;
      };
      const kind = body.kind ?? "TERMINAL";
      const kitchenSections = kind === "KITCHEN" ? (body.kitchenSections ?? []) : [];
      if (kind === "KITCHEN" && kitchenSections.length === 0) {
        return reply.code(400).send({
          error: "KITCHEN_SECTIONS_REQUIRED",
          message:
            "Una pantalla de cocina tiene que decir qué secciones muestra: cocina, barra o las dos.",
        });
      }
      if (kind === "KITCHEN") {
        const tenant = await getPrisma().tenant.findUniqueOrThrow({
          where: { id: auth.tenantId },
          select: { kitchenDisplayEnabled: true },
        });
        if (!tenant.kitchenDisplayEnabled) {
          return reply.code(403).send({
            error: "KITCHEN_MODULE_DISABLED",
            message:
              "El módulo de cocina no está activo en esta cuenta. Lo enciende Mi Piace.",
          });
        }
      }
      const prisma = getPrisma();

      const register = await prisma.register.findFirst({
        where: { id: registerId, store: { tenantId: auth.tenantId } },
        select: { id: true },
      });
      if (!register) {
        return reply
          .code(404)
          .send({ error: "REGISTER_NOT_FOUND", message: "Caja no encontrada" });
      }

      // Generar código único por (tenant, code). Si colisiona,
      // reintenta hasta MAX_ATTEMPTS — el espacio es 1M y la ventana
      // de validez 1h, así que en la práctica nunca colisiona, pero
      // defensa cinturón.
      const expiresAt = new Date(
        Date.now() + PAIRING_CODE_TTL_MINUTES * 60 * 1000,
      );
      for (let attempt = 0; attempt < PAIRING_CODE_MAX_ATTEMPTS; attempt++) {
        const code = newSixDigitCode();
        const existing = await prisma.pairingCode.findUnique({
          where: { tenantId_code: { tenantId: auth.tenantId, code } },
          select: { consumedAt: true, expiresAt: true },
        });
        // Considerar colisión sólo si el anterior sigue vivo y no
        // consumido. Los caducados pueden reutilizarse (el unique
        // compuesto permite re-INSERT tras DELETE, no upsert).
        const alive =
          existing &&
          existing.consumedAt == null &&
          existing.expiresAt > new Date();
        if (alive) continue;
        if (existing) {
          // Caducado o consumido — lo borramos para permitir el
          // re-INSERT con el mismo `code`.
          await prisma.pairingCode.delete({
            where: { tenantId_code: { tenantId: auth.tenantId, code } },
          });
        }
        const created = await prisma.pairingCode.create({
          data: {
            tenantId: auth.tenantId,
            registerId,
            code,
            createdByUserId: auth.userId,
            expiresAt,
            kind,
            kitchenSections,
          },
          select: { code: true, expiresAt: true, kind: true, kitchenSections: true },
        });
        return reply.code(201).send({
          code: created.code,
          expiresAt: created.expiresAt.toISOString(),
          kind: created.kind,
          kitchenSections: created.kitchenSections,
        });
      }
      return reply.code(503).send({
        error: "CODE_COLLISION",
        message: "No se pudo generar un código único, reintenta",
      });
    },
  );

  // Lista de dispositivos del tenant + sus pairing codes activos.
  app.get(
    "/admin/devices",
    { preHandler: [requireOwnerOrManager, ensureCajaEnabled] },
    async (request) => {
      const auth = request.auth!;
      const prisma = getPrisma();
      const devices = await prisma.device.findMany({
        where: { tenantId: auth.tenantId },
        select: {
          id: true,
          name: true,
          pairedAt: true,
          lastSeenAt: true,
          userAgent: true,
          revokedAt: true,
          lastKnownIpCountry: true,
          // kds-1-cocina · QUÉ es cada aparato. El panel lo necesita para
          // distinguir la pantalla de cocina del terminal de la caja: las
          // dos conviven en la misma caja y sólo una factura, así que quien
          // mire esta lista buscando «por qué no cobra» tiene que ver de un
          // golpe cuál es cuál.
          kind: true,
          kitchenSections: true,
          register: {
            select: { id: true, name: true, store: { select: { name: true } } },
          },
          // residencia-1 · la puerta de una habitación no tiene caja, y
          // tiene habitación. Esta pantalla lleva el gate de la caja, así
          // que un tenant de residencia no la ve nunca; se pinta igual para
          // que un centro MIXTO —si algún día lo hay— no vea una fila con
          // la caja vacía y sin explicación.
          room: { select: { id: true, number: true } },
        },
        orderBy: [{ revokedAt: "asc" }, { lastSeenAt: "desc" }],
      });
      return {
        devices: devices.map((d) => ({
          id: d.id,
          name: d.name,
          pairedAt: d.pairedAt.toISOString(),
          lastSeenAt: d.lastSeenAt?.toISOString() ?? null,
          userAgent: d.userAgent,
          revokedAt: d.revokedAt?.toISOString() ?? null,
          lastKnownIpCountry: d.lastKnownIpCountry,
          kind: d.kind,
          kitchenSections: d.kitchenSections,
          // residencia-1 · nullables desde que `register_id` lo es. Lo
          // único que llega aquí sin caja es un `ROOM`.
          registerId: d.register?.id ?? null,
          registerName: d.register?.name ?? null,
          storeName: d.register?.store.name ?? null,
          roomId: d.room?.id ?? null,
          roomNumber: d.room?.number ?? null,
        })),
      };
    },
  );

  // Pairing codes activos (no consumidos, no caducados).
  app.get(
    "/admin/pairing-codes",
    { preHandler: [requireOwnerOrManager, ensureCajaEnabled] },
    async (request) => {
      const auth = request.auth!;
      const prisma = getPrisma();
      const now = new Date();
      const codes = await prisma.pairingCode.findMany({
        where: {
          tenantId: auth.tenantId,
          consumedAt: null,
          expiresAt: { gt: now },
        },
        select: {
          id: true,
          code: true,
          expiresAt: true,
          register: { select: { id: true, name: true } },
          // residencia-1 · ver la nota de `/admin/devices`.
          room: { select: { id: true, number: true } },
        },
        orderBy: { expiresAt: "asc" },
      });
      return {
        codes: codes.map((c) => ({
          id: c.id,
          code: c.code,
          expiresAt: c.expiresAt.toISOString(),
          registerId: c.register?.id ?? null,
          registerName: c.register?.name ?? null,
          roomId: c.room?.id ?? null,
          roomNumber: c.room?.number ?? null,
        })),
      };
    },
  );

  // POST /devices/pair — sin auth, body con código.
  app.post(
    "/devices/pair",
    {
      schema: {
        body: {
          type: "object",
          required: ["code"],
          additionalProperties: false,
          properties: {
            code: { type: "string", pattern: "^[0-9]{6}$" },
            deviceName: { type: "string", maxLength: 80 },
            userAgent: { type: "string", maxLength: 512 },
          },
        },
      },
    },
    async (request, reply) => {
      const { code, deviceName, userAgent } = request.body as {
        code: string;
        deviceName?: string;
        userAgent?: string;
      };
      const prisma = getPrisma();
      const now = new Date();

      // Buscar código en cualquier tenant — el unique es por
      // (tenantId, code), así que pueden coexistir el mismo "123456"
      // en dos tenants. Aceptamos sólo el que esté vivo y no
      // consumido.
      const candidates = await prisma.pairingCode.findMany({
        where: { code, consumedAt: null, expiresAt: { gt: now } },
        select: {
          id: true,
          tenantId: true,
          registerId: true,
          // kds-1-cocina · lo que el código dice que se empareja.
          kind: true,
          kitchenSections: true,
          register: {
            select: {
              id: true,
              name: true,
              store: { select: { name: true } },
            },
          },
          // residencia-1 · y la habitación, cuando el código es de una
          // puerta. Se copia al dispositivo igual que `kind` y
          // `kitchenSections`: lo decide el código, que lo creó alguien
          // autenticado, y NO el cuerpo de esta petición — que no lleva
          // sesión. Si la habitación viniera del cuerpo, cualquiera con un
          // código se emparejaría como la puerta de la 112.
          roomId: true,
          room: { select: { id: true, number: true, name: true } },
        },
      });
      if (candidates.length === 0) {
        return reply.code(404).send({
          error: "INVALID_PAIRING_CODE",
          message: "Código inválido o caducado",
        });
      }
      // Si por accidente hubiera más de uno (colisión RNG entre
      // tenants), tomamos el primero. Espacio 1M × validez 1h hace
      // que sea operacionalmente imposible.
      const target = candidates[0]!;

      // v1.3-hotfix11 · pairing code de un solo uso.
      //
      // El SELECT anterior es informativo (para devolver register/store en
      // la respuesta). El claim atómico se hace AQUÍ con updateMany — si
      // dos requests llegan con el mismo code en paralelo, sólo la
      // primera obtiene count===1. La segunda devuelve count===0 →
      // tratamos como código ya consumido (404). Bug detectado
      // 2026-05-27: la transacción Prisma por defecto (READ COMMITTED)
      // permitía que ambas SELECTs viesen consumedAt=null antes del commit
      // de la primera, creando 2 devices con el mismo code.
      const claimed = await prisma.pairingCode.updateMany({
        where: {
          id: target.id,
          consumedAt: null,
          expiresAt: { gt: now },
        },
        data: { consumedAt: now },
      });
      if (claimed.count === 0) {
        return reply.code(404).send({
          error: "INVALID_PAIRING_CODE",
          message: "Código inválido o caducado",
        });
      }

      const { plain, hash } = generateDeviceToken();
      const device = await prisma.$transaction(async (tx) => {
        const d = await tx.device.create({
          data: {
            tenantId: target.tenantId,
            registerId: target.registerId,
            // residencia-1 · la habitación de la puerta. NULL en todo lo
            // demás, y el CHECK `devices_register_o_habitacion` lo exige en
            // los dos sentidos: un `ROOM` sin habitación no entra, y un
            // TERMINAL con habitación tampoco.
            roomId: target.roomId,
            name: deviceName ?? null,
            deviceTokenHash: hash,
            userAgent: userAgent ?? null,
            // kds-1-cocina · copiados del código, no leídos del cuerpo.
            //
            // Y el trigger `devices_revoke_previous` NO releva al terminal
            // de esta caja cuando esto es `KITCHEN`, porque filtra
            // `kind = 'TERMINAL'` desde verifactu-1. Igual que el índice
            // parcial `devices_one_active_per_register_key`. O sea: tres
            // aparatos vivos en la misma caja (el terminal, la pantalla de
            // cocina y la de barra) y sólo uno factura. Se prueba, no se
            // supone: es su fila en la tabla de sabotajes del bloque.
            kind: target.kind,
            kitchenSections: target.kitchenSections,
          },
          select: { id: true },
        });
        // Enlazar el code al device recién creado (consumedAt ya está
        // marcado por el updateMany de arriba).
        await tx.pairingCode.update({
          where: { id: target.id },
          data: { consumedByDeviceId: d.id },
        });
        return d;
      });

      // Disparar alerta async — no bloquea la respuesta.
      void evaluateDeviceAlert({
        deviceId: device.id,
        ip: request.ip,
        now,
      }).catch((err) => request.log.error(err, "evaluateDeviceAlert falló"));

      return reply.code(201).send({
        deviceToken: plain,
        deviceId: device.id,
        tenantId: target.tenantId,
        // residencia-1 · las tres de la caja son NULL en una puerta de
        // habitación, y las dos de la habitación son NULL en todo lo demás.
        // Se mandan planas y nullables en vez de en dos formas distintas de
        // respuesta: la APK ya elige pantalla por `kind`, y una respuesta
        // con dos formas obligaría a que también eligiera parser.
        registerId: target.registerId,
        registerName: target.register?.name ?? null,
        storeName: target.register?.store.name ?? null,
        roomId: target.roomId,
        roomNumber: target.room?.number ?? null,
        // kds-1-cocina · la APK lee esto para decidir si arranca en modo
        // TPV o en «modo cocina». residencia-1 añade el tercer valor,
        // `ROOM`, y el «modo puerta». Es la misma APK (decisión 1 de kds-1,
        // D-52 de la residencia): lo que cambia es la pantalla que pinta al
        // arrancar.
        kind: target.kind,
        kitchenSections: target.kitchenSections,
      });
    },
  );

  // GET /devices/me — la PWA lo llama al arrancar.
  app.get(
    "/devices/me",
    { preHandler: [requireDeviceToken, ensureCajaEnabled] },
    async (request, reply) => {
      const ctx = request.device!;
      const prisma = getPrisma();
      const now = new Date();
      const device = await prisma.device.findUniqueOrThrow({
        where: { id: ctx.deviceId },
        select: {
          id: true,
          name: true,
          pairedAt: true,
          kind: true,
          kitchenSections: true,
          register: {
            select: {
              id: true,
              name: true,
              store: {
                select: {
                  id: true,
                  name: true,
                  // kds-1-cocina · los ajustes de cocina POR RESTAURANTE.
                  // El TPV los necesita al arrancar para saber si pinta
                  // «Espera» o la fila de tiempos, si el botón de silla va
                  // siempre visible y si el «LISTO» pita.
                  kitchenCourseMode: true,
                  kitchenSeatMode: true,
                  kitchenGreenMaxMin: true,
                  kitchenAmberMaxMin: true,
                  kitchenReadyBeep: true,
                },
              },
              numSerieHolded: true,
            },
          },
          tenant: {
            select: {
              id: true,
              name: true,
              cashierAutoLogoutMinutes: true,
              // v1.11-cierre-de-dia · el TPV necesita saber si este negocio
              // obliga a cuadrar caja ANTES de pintar el cierre: con el flag
              // ON va directo a la tabla de denominaciones; con el flag OFF
              // (default) enseña la tarjeta de resumen y un botón.
              requireCashCountOnClose: true,
              // kds-1-cocina · la capability del módulo «Cocina». Apagada,
              // el TPV no pinta nada de cocina: ni «Urgente», ni «Espera»,
              // ni la banda «LISTO». Lo único que sobrevive al apagado es
              // el envío por diferencias, que es un arreglo del servidor.
              kitchenDisplayEnabled: true,
              // B-reservas-8 · si este centro tiene bonos, y CÓMO LOS
              // LLAMA. El TPV necesita las dos al arrancar: la primera
              // para no pedir propuestas de canje en una cuenta que no los
              // tiene, y la segunda porque el spa dice «programa» y la
              // clínica «bono» — y una etiqueta que llegue tarde se ve
              // como un parpadeo en la pantalla de cobro.
              bonosEnabled: true,
              bonoEtiqueta: true,
            },
          },
        },
      });
      await prisma.device.update({
        where: { id: ctx.deviceId },
        data: { lastSeenAt: now },
      });
      // residencia-1 · `register` es nullable desde que lo es la columna, y
      // aquí no puede ser null: `requireDeviceToken` ya rechazó al `ROOM`
      // —que es lo único sin caja— con un 403 antes de llegar. El `if`
      // existe para que el tipo lo diga en vez de para arreglar un caso:
      // la alternativa era un `!` por cada una de las nueve lecturas de
      // abajo, y un `!` es una afirmación que nadie vuelve a comprobar.
      const register = device.register;
      if (register == null) {
        return reply.code(401).send({
          error: "DEVICE_REVOKED",
          message: "Dispositivo revocado o desconocido",
        });
      }
      return {
        device: {
          id: device.id,
          name: device.name,
          pairedAt: device.pairedAt.toISOString(),
        },
        register: {
          id: register.id,
          name: register.name,
          numSerieHolded: register.numSerieHolded,
        },
        store: {
          id: register.store.id,
          name: register.store.name,
        },
        tenant: {
          id: device.tenant.id,
          name: device.tenant.name,
          cashierAutoLogoutMinutes: device.tenant.cashierAutoLogoutMinutes,
          requireCashCountOnClose: device.tenant.requireCashCountOnClose,
          kitchenDisplayEnabled: device.tenant.kitchenDisplayEnabled,
          // B-reservas-8 · ver el `select`.
          bonosEnabled: device.tenant.bonosEnabled,
          bonoEtiqueta: device.tenant.bonoEtiqueta,
        },
        // kds-1-cocina · los ajustes de cocina de ESTA tienda. Van planos y
        // no dentro de `store` para no cambiarle la forma a quien ya lo
        // lee; `null` cuando el módulo está apagado, porque lo que no se
        // compró no tiene por qué llegar a la pantalla.
        kitchen: device.tenant.kitchenDisplayEnabled
          ? {
              courseMode: register.store.kitchenCourseMode,
              seatMode: register.store.kitchenSeatMode,
              greenMaxMin: register.store.kitchenGreenMaxMin,
              amberMaxMin: register.store.kitchenAmberMaxMin,
              readyBeep: register.store.kitchenReadyBeep,
            }
          : null,
      };
    },
  );

  // POST /admin/devices/:deviceId/revoke
  app.post(
    "/admin/devices/:deviceId/revoke",
    {
      preHandler: [requireOwnerOrManager, ensureCajaEnabled],
      schema: {
        params: {
          type: "object",
          required: ["deviceId"],
          properties: { deviceId: { type: "string", format: "uuid" } },
        },
      },
    },
    async (request, reply) => {
      const auth = request.auth!;
      const { deviceId } = request.params as { deviceId: string };
      const prisma = getPrisma();
      const device = await prisma.device.findFirst({
        where: { id: deviceId, tenantId: auth.tenantId },
        select: { id: true, revokedAt: true },
      });
      if (!device) {
        return reply
          .code(404)
          .send({ error: "DEVICE_NOT_FOUND", message: "Dispositivo no encontrado" });
      }
      if (device.revokedAt) {
        return reply.code(200).send({ ok: true, alreadyRevoked: true });
      }
      await prisma.device.update({
        where: { id: deviceId },
        data: { revokedAt: new Date() },
      });
      // A5 · si ese terminal tenía el canal de soporte abierto, se le cierra
      // AHORA. Sin esto, un device revocado seguiría latiendo y aceptando
      // comandos por un canal que abrió cuando todavía valía, hasta que se
      // reiniciara la app o se cayera la red. La revocación tiene que valer en
      // el momento en que se pulsa, que es cuando alguien ha decidido que ese
      // terminal ya no es de fiar.
      const canalCerrado = getDeviceChannelRegistry().closeDevice(
        deviceId,
        WS_CLOSE.REVOKED,
        "device revoked",
      );
      return reply
        .code(200)
        .send({ ok: true, alreadyRevoked: false, canalCerrado });
    },
  );

  // ── auditoria-sirope (#23) · CAMBIAR LAS SECCIONES DE UNA PANTALLA ──
  //
  // Hasta este bloque, las secciones de una pantalla de cocina se
  // decidían al generar su código de emparejamiento y no se podían tocar
  // más: para pasar una pantalla de «Cocina» a «Cocina + Barra» había que
  // REVOCARLA y volver a emparejarla con un código nuevo, con el
  // implantador tecleando seis dígitos en una tablet colgada de la pared.
  //
  // No hay nada que lo justifique: la sección no es una credencial, es
  // una preferencia. El token del aparato no cambia, la tablet sigue
  // emparejada y el siguiente GET de la pantalla ya trae lo suyo.
  //
  // Lo que sí se mantiene: una pantalla SIN secciones no existe —no
  // recibiría nada y el cocinero miraría una pantalla en blanco— y sólo
  // se le cambian a un `KITCHEN`.
  app.patch(
    "/admin/devices/:deviceId/kitchen-sections",
    {
      preHandler: [requireOwnerOrManager, ensureCajaEnabled],
      schema: {
        params: {
          type: "object",
          required: ["deviceId"],
          properties: { deviceId: { type: "string", format: "uuid" } },
        },
        body: {
          type: "object",
          required: ["kitchenSections"],
          additionalProperties: false,
          properties: {
            kitchenSections: {
              type: "array",
              minItems: 1,
              maxItems: 3,
              uniqueItems: true,
              items: { type: "string", enum: ["BARRA", "COCINA", "SALON"] },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const auth = request.auth!;
      const { deviceId } = request.params as { deviceId: string };
      const body = request.body as {
        kitchenSections: Array<"BARRA" | "COCINA" | "SALON">;
      };
      const prisma = getPrisma();
      const device = await prisma.device.findFirst({
        where: { id: deviceId, tenantId: auth.tenantId },
        select: { id: true, kind: true, revokedAt: true },
      });
      if (!device) {
        return reply
          .code(404)
          .send({ error: "DEVICE_NOT_FOUND", message: "Dispositivo no encontrado" });
      }
      if (device.kind !== "KITCHEN") {
        return reply.code(409).send({
          error: "NOT_A_KITCHEN_DEVICE",
          message: "Sólo una pantalla de cocina tiene secciones.",
        });
      }
      if (device.revokedAt) {
        return reply.code(409).send({
          error: "DEVICE_REVOKED",
          message:
            "Esta pantalla está revocada: hay que volver a emparejarla.",
        });
      }
      const actualizado = await prisma.device.update({
        where: { id: deviceId },
        data: { kitchenSections: body.kitchenSections },
        select: { id: true, kitchenSections: true },
      });
      return reply.code(200).send({
        device: {
          id: actualizado.id,
          kitchenSections: actualizado.kitchenSections,
        },
      });
    },
  );
}

// Re-export para que cashier-login pueda hashear tokens si lo necesita
// (no debería — sólo lo usa /devices/me, pero se documenta export).
export { hashDeviceToken };
