// residencia-5 (D-67) · **LAS RUTAS DE LA TABLET DE LA SALA.**
//
// Cinco, y el reparto de auth es el de la puerta (residencia-3):
//
//   1. `GET  /residencia/sala/me`        — la pantalla en REPOSO. Device
//      token y nada más: es lo que se pinta antes del PIN.
//   2. `GET  /residencia/sala/arranque`  — el paquete OFFLINE: los turnos,
//      el roster con las huellas de PIN y **el parte congelado**. Device
//      token, sin sesión.
//   3. `POST /residencia/sala/pin`       — quién está delante.
//   4. `GET  /residencia/sala/relevo`    — el parte **recortado a su
//      alcance** (D-51), con lo que llegó tarde y el estado de
//      confirmación. Sesión.
//   5. `POST /residencia/sala/relevo/:id/confirmar` — «Leído y recibido».
//
// ── NADA DE SALUD EN REPOSO (decisión de producto 3) ────────────────
//
// El prompt lo dice con esas palabras: *«en reposo no enseña nada de
// salud: centro, turno, hora y "Relevo de la mañana · 3 por
// confirmar"»*. La 1 devuelve exactamente eso y un test mira el payload
// crudo, igual que `/residencia/puerta/me` de residencia-1.
//
// El **recuento** sí sale, y es la decisión fina: «3 por confirmar» es un
// número de zonas, no de residentes, y no dice de quién es nada. Lo que
// hace es que el turno que entra vea desde la puerta de la sala que tiene
// algo que leer — que es para lo que está la tablet ahí.
//
// ── Y EL ARRANQUE SÍ TRAE EL PARTE, por lo mismo que en la puerta ───
//
// Sin red, el servidor no puede contestar nada: el parte tiene que estar
// ya en la tablet. Así que el arranque lo trae y la pantalla **no lo
// pinta hasta el PIN** — el mismo reparto exacto que el arranque de la
// puerta, que trae el plan de cuidados de dos personas y no lo enseña en
// reposo (residencia-3 §7). La caché se vacía al revocar el dispositivo.
//
// El RECORTE por alcance se hace en los dos sitios: aquí para la
// respuesta con red, y en la tablet para la de la caché. Dos sitios con
// la MISMA función (`recortarAlAlcance`), que es la única forma de que no
// se separen.

import { randomInt } from "node:crypto";

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import type { PrismaClient } from "@mipiacetpv/db";
import { diaDelTurno, turnoDe } from "@mipiacetpv/residencia-plan";

import { getPrisma } from "../context.js";
import { requireOwnerOrManager } from "../auth/middleware.js";
import { ensureClinicaEnabled } from "../clinica/gate.js";
import { ensureResidenciaEnabled } from "./gate.js";
import { dekONada } from "../clinica/claves.js";
import { subclaveDePinDePuerta } from "../clinica/cripto.js";
import { negativaClinica } from "../clinica/contrato.js";
import { apuntarAcceso } from "../clinica/registro.js";
import { requireSalaDevice } from "./sala-auth.js";
import {
  MINUTOS_SIN_TOCAR_EN_LA_SALA,
  requireSalaSesion,
  signSalaSesion,
} from "./sala-sesion.js";
import { resolverPinDeCuidado } from "./pin-de-cuidado.js";
import { inspect, registerFailure, reset } from "../auth/rate-limit.js";
import {
  alcanceDe,
  estaConfirmado,
  recortarAlAlcance,
  zonasSinConfirmar,
} from "./relevo-confirmacion.js";
import { leerAnadidosTardios, leerParteCongelado } from "./relevo.js";

// Los mismos números que `devices/routes.ts`, `puerta-routes.ts` y
// `guardia-routes.ts`. Si uno cambia, los cuatro.
const PAIRING_CODE_TTL_MINUTES = 60;
const PAIRING_CODE_MAX_ATTEMPTS = 8;

// ── El rate-limit del PIN · POR TABLET, con los números de la puerta ──
//
// Diez intentos en cinco minutos, dos de candado. Los mismos que la
// puerta y el móvil de guardia, y la razón del candado corto es la misma
// por el otro lado: **una sala candada es un relevo que no se puede
// confirmar**, con seis personas delante esperando.
const PIN_MAX_INTENTOS = 10;
const PIN_VENTANA_S = 5 * 60;
const PIN_CANDADO_S = 2 * 60;

function limiteDelPin(tenantId: string, deviceId: string) {
  return {
    attemptsKey: `sala-pin-attempts:${tenantId}:${deviceId}`,
    lockKey: `sala-pin-locked:${tenantId}:${deviceId}`,
    maxAttempts: PIN_MAX_INTENTOS,
    attemptTtlSeconds: PIN_VENTANA_S,
    lockTtlSeconds: PIN_CANDADO_S,
  };
}

/**
 * El parte que la sala enseña: **el último congelado**.
 *
 * El último y no «el del turno anterior al de ahora», y la diferencia es
 * real: si la tarea programada no corrió —la API estaba caída al cambiar
 * el turno— el del turno anterior no existe, y lo que el turno que entra
 * tiene que leer es el último que haya. Con «el del turno anterior» la
 * sala enseñaría una pantalla vacía justo el día que algo falló.
 */
async function ultimoParteCongelado(
  prisma: PrismaClient,
  tenantId: string,
): Promise<{
  id: string;
  careDay: string;
  lineas: number;
  sinNovedades: boolean;
  frozenAt: Date;
  confirmedAt: Date | null;
  centerShift: { id: string; code: string; name: string };
} | null> {
  return prisma.handover.findFirst({
    where: { tenantId },
    orderBy: { frozenAt: "desc" },
    select: {
      id: true,
      careDay: true,
      lineas: true,
      sinNovedades: true,
      frozenAt: true,
      confirmedAt: true,
      centerShift: { select: { id: true, code: true, name: true } },
    },
  });
}

/** Las zonas con contenido y las confirmaciones de un parte. */
async function zonasYAcuses(
  prisma: PrismaClient,
  tenantId: string,
  handoverId: string,
) {
  const [zonas, acuses] = await Promise.all([
    prisma.handoverZone.findMany({
      where: { tenantId, handoverId },
      select: { floorId: true, lineas: true, floor: { select: { name: true } } },
    }),
    prisma.handoverAck.findMany({
      where: { tenantId, handoverId },
      orderBy: { at: "asc" },
      select: {
        id: true,
        at: true,
        alcanceTotal: true,
        user: { select: { id: true, alias: true, email: true } },
        careRoleAssignment: { select: { careRole: { select: { name: true } } } },
        zones: { select: { floorId: true, floor: { select: { name: true } } } },
      },
    }),
  ]);
  return { zonas, acuses };
}

/** Las confirmaciones en la forma que pide `estaConfirmado`. */
function alcancesDe(
  acuses: Array<{ alcanceTotal: boolean; zones: Array<{ floorId: string }> }>,
) {
  return acuses.map((a) => ({
    alcanceTotal: a.alcanceTotal,
    floorIds: a.zones.map((z) => z.floorId),
  }));
}

function nombreCorto(u: { alias: string | null; email: string }): string {
  return u.alias ?? (u.email.split("@")[0] ?? u.email);
}

export async function registerResidenciaSalaRoutes(
  app: FastifyInstance,
): Promise<void> {
  // ════════════════════════════════════════════════════════════════
  //  0 · El código de emparejamiento de una tablet de sala
  // ════════════════════════════════════════════════════════════════
  //
  // Lo genera dirección desde el admin, igual que el de la puerta y el
  // del móvil de guardia. **El `kind` lo decide el código**, no el
  // aparato: si `POST /devices/pair` aceptara `kind: "HANDOVER"` del
  // cuerpo, cualquiera con un código de caja se emparejaría como la
  // tablet de la sala y leería el parte de relevo del centro.
  //
  // Y aquí NO hay nada más que decidir —ni habitación, ni canal—, porque
  // la tablet de la sala es del centro (ver `sala-auth.ts`).
  app.post(
    "/residencia/sala/pairing-codes",
    {
      preHandler: [requireOwnerOrManager, ensureClinicaEnabled, ensureResidenciaEnabled],
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          properties: { name: { type: "string", maxLength: 80 } },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const prisma = getPrisma();
      const expiresAt = new Date(Date.now() + PAIRING_CODE_TTL_MINUTES * 60 * 1000);
      for (let intento = 0; intento < PAIRING_CODE_MAX_ATTEMPTS; intento++) {
        const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
        const existing = await prisma.pairingCode.findUnique({
          where: { tenantId_code: { tenantId: auth.tenantId, code } },
          select: { consumedAt: true, expiresAt: true },
        });
        const vivo =
          existing && existing.consumedAt == null && existing.expiresAt > new Date();
        if (vivo) continue;
        if (existing) {
          await prisma.pairingCode.delete({
            where: { tenantId_code: { tenantId: auth.tenantId, code } },
          });
        }
        const creado = await prisma.pairingCode.create({
          data: {
            tenantId: auth.tenantId,
            // Ni caja ni habitación: la cuarta rama del CHECK.
            registerId: null,
            roomId: null,
            code,
            createdByUserId: auth.userId,
            expiresAt,
            kind: "HANDOVER",
          },
          select: { code: true, expiresAt: true, kind: true },
        });
        return reply.code(201).send({
          code: creado.code,
          expiresAt: creado.expiresAt.toISOString(),
          kind: creado.kind,
        });
      }
      return reply.code(503).send({
        error: "CODE_COLLISION",
        message: "No se pudo generar un código único, reintenta",
      });
    },
  );

  // ════════════════════════════════════════════════════════════════
  //  1 · `GET /residencia/sala/me` · LA PANTALLA EN REPOSO
  // ════════════════════════════════════════════════════════════════
  //
  // Centro, turno, hora y «Relevo de la mañana · 3 por confirmar». **Nada
  // de salud**: ni un nombre de residente, ni un nivel, ni una línea del
  // parte.
  app.get(
    "/residencia/sala/me",
    { preHandler: [requireSalaDevice] },
    async (request: FastifyRequest) => {
      const ctx = request.sala!;
      const prisma = getPrisma();
      const ahora = new Date();

      const [tenant, turnos, parte] = await Promise.all([
        prisma.tenant.findUniqueOrThrow({
          where: { id: ctx.tenantId },
          select: { name: true },
        }),
        prisma.centerShift.findMany({
          where: { tenantId: ctx.tenantId },
          orderBy: [{ sortOrder: "asc" }, { startsAt: "asc" }],
          select: { id: true, code: true, name: true, startsAt: true, endsAt: true },
        }),
        ultimoParteCongelado(prisma, ctx.tenantId),
      ]);

      await prisma.device.update({
        where: { id: ctx.deviceId },
        data: { lastSeenAt: ahora },
      });

      const turno = turnoDe(ahora, turnos);
      let relevo: {
        id: string;
        turno: string;
        careDay: string;
        lineas: number;
        sinNovedades: boolean;
        confirmado: boolean;
        zonasPorConfirmar: number;
        congeladoEn: string;
      } | null = null;
      if (parte != null) {
        const { zonas, acuses } = await zonasYAcuses(prisma, ctx.tenantId, parte.id);
        const pendientes = zonasSinConfirmar(zonas, alcancesDe(acuses));
        relevo = {
          id: parte.id,
          // El nombre del turno y no su código: en la sala se lee «Relevo
          // de la mañana», no «Relevo M».
          turno: parte.centerShift.name,
          careDay: parte.careDay,
          lineas: parte.lineas,
          sinNovedades: parte.sinNovedades,
          confirmado: estaConfirmado(zonas, alcancesDe(acuses)),
          zonasPorConfirmar: pendientes.length,
          congeladoEn: parte.frozenAt.toISOString(),
        };
      }

      return {
        device: { id: ctx.deviceId, name: ctx.deviceName },
        centro: { id: ctx.tenantId, nombre: tenant.name },
        turno: turno ? { id: turno.id, code: turno.code, name: turno.name } : null,
        turnos,
        relevo,
        minutosSinTocar: MINUTOS_SIN_TOCAR_EN_LA_SALA,
        serverTime: ahora.toISOString(),
      };
    },
  );

  // ════════════════════════════════════════════════════════════════
  //  2 · `GET /residencia/sala/arranque` · EL PAQUETE OFFLINE
  // ════════════════════════════════════════════════════════════════
  //
  // Lo que la tablet necesita para funcionar con el wifi caído: los
  // turnos, el roster con las huellas de PIN **y sus zonas**, y el parte
  // congelado ENTERO. El recorte por alcance lo hace la tablet con la
  // misma función que el servidor.
  //
  // El roster lleva las zonas de cada persona y su `alcanceTotal`, que es
  // lo que la tablet necesita para recortar sin red. Es más de lo que el
  // roster de la puerta lleva, y la razón es que allí el recorte lo hace
  // el servidor residente a residente.
  app.get(
    "/residencia/sala/arranque",
    { preHandler: [requireSalaDevice] },
    async (request: FastifyRequest) => {
      const ctx = request.sala!;
      const prisma = getPrisma();
      const ahora = new Date();

      const [tenant, turnos, pins, parte] = await Promise.all([
        prisma.tenant.findUniqueOrThrow({
          where: { id: ctx.tenantId },
          select: { name: true },
        }),
        prisma.centerShift.findMany({
          where: { tenantId: ctx.tenantId },
          orderBy: [{ sortOrder: "asc" }],
          select: { id: true, code: true, name: true, startsAt: true, endsAt: true },
        }),
        // El roster, igual que en la puerta y con la misma exposición
        // dicha allí (residencia-3 §2): lo que una tablet robada permite
        // es probar las diez mil combinaciones. Por eso la caché se vacía
        // al revocar el dispositivo.
        prisma.carePin.findMany({
          where: { tenantId: ctx.tenantId },
          select: {
            userId: true,
            pinLookup: true,
            user: {
              select: {
                id: true,
                alias: true,
                email: true,
                careRoleAssignments: {
                  where: { revokedAt: null, careRole: { active: true, recordsCare: true } },
                  select: {
                    id: true,
                    fromAt: true,
                    toAt: true,
                    careRole: { select: { code: true, name: true, fullScope: true } },
                  },
                },
                careZoneAssignments: {
                  where: { toAt: null },
                  select: { floorId: true },
                },
              },
            },
          },
        }),
        ultimoParteCongelado(prisma, ctx.tenantId),
      ]);

      await prisma.device.update({
        where: { id: ctx.deviceId },
        data: { lastSeenAt: ahora },
      });

      const dek = await dekONada(ctx.tenantId, prisma);
      const subclave =
        dek == null
          ? null
          : subclaveDePinDePuerta(dek, ctx.tenantId).toString("base64");

      let relevo: unknown = null;
      if (parte != null) {
        const contenido = await leerParteCongelado(prisma, ctx.tenantId, parte.id);
        const { zonas, acuses } = await zonasYAcuses(prisma, ctx.tenantId, parte.id);
        const tardios = await leerAnadidosTardios(prisma, ctx.tenantId, parte.id);
        relevo = {
          id: parte.id,
          careDay: parte.careDay,
          congeladoEn: parte.frozenAt.toISOString(),
          confirmado: estaConfirmado(zonas, alcancesDe(acuses)),
          zonas: zonas.map((z) => ({
            floorId: z.floorId,
            nombre: z.floor?.name ?? "Del centro",
            lineas: z.lineas,
          })),
          acuses: acuses.map((a) => ({
            userId: a.user.id,
            nombre: nombreCorto(a.user),
            rol: a.careRoleAssignment.careRole.name,
            at: a.at.toISOString(),
            alcanceTotal: a.alcanceTotal,
            zonas: a.zones.map((z) => z.floor.name),
          })),
          tardios,
          parte: contenido,
        };
      }

      return {
        centro: { id: ctx.tenantId, nombre: tenant.name },
        device: { id: ctx.deviceId, name: ctx.deviceName },
        turnos,
        roster: pins.map((p) => ({
          userId: p.userId,
          nombre: nombreCorto(p.user),
          pinLookup: p.pinLookup,
          roles: p.user.careRoleAssignments
            .filter((a) => a.fromAt <= ahora && (a.toAt == null || a.toAt > ahora))
            .map((a) => ({
              assignmentId: a.id,
              code: a.careRole.code,
              name: a.careRole.name,
              alcanceTotal: a.careRole.fullScope,
            })),
          // Las zonas vigentes. `null` dentro de la lista = «todo el
          // centro», que es la segunda forma de tener alcance total.
          zonas: p.user.careZoneAssignments.map((z) => z.floorId),
        })),
        pinSubclave: subclave,
        relevo,
        minutosSinTocar: MINUTOS_SIN_TOCAR_EN_LA_SALA,
        // La hora del SERVIDOR, para que la tablet mida su desvío de
        // reloj: sin eso, una confirmación encolada sin red saldría con
        // una hora que no es.
        serverTime: ahora.toISOString(),
      };
    },
  );

  // ════════════════════════════════════════════════════════════════
  //  3 · `POST /residencia/sala/pin` · QUIÉN ESTÁ DELANTE
  // ════════════════════════════════════════════════════════════════
  //
  // Sólo el PIN, igual que en la puerta (D-64): la huella lo encuentra en
  // una consulta indexada y argon2id lo verifica contra ESA fila. Con dos
  // roles de cuidado vivos se le pregunta con cuál entra, porque la
  // capacidad es la mitad de la firma (D-31).
  //
  // El rate-limit es **por tablet** y dura dos minutos, igual que en la
  // puerta y por lo mismo por el otro lado: una sala candada es un relevo
  // que no se puede confirmar.
  app.post(
    "/residencia/sala/pin",
    {
      preHandler: [requireSalaDevice],
      schema: {
        body: {
          type: "object",
          required: ["pin"],
          additionalProperties: false,
          properties: {
            pin: { type: "string", pattern: "^[0-9]{4,8}$" },
            careRoleAssignmentId: { type: "string", format: "uuid" },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const ctx = request.sala!;
      const { pin, careRoleAssignmentId } = request.body as {
        pin: string;
        careRoleAssignmentId?: string;
      };
      const prisma = getPrisma();
      const ahora = new Date();

      const limite = limiteDelPin(ctx.tenantId, ctx.deviceId);
      const previo = await inspect(limite);
      if (previo.locked) {
        return reply.code(429).send({
          error: "SALA_PIN_BLOQUEADO",
          message: `Demasiados intentos en esta tablet. Prueba en ${Math.ceil(
            previo.retryAfterSeconds / 60,
          )} min.`,
          retryAfterSeconds: previo.retryAfterSeconds,
        });
      }

      const res = await resolverPinDeCuidado(prisma, { tenantId: ctx.tenantId, pin, ahora });
      if (!res.ok && res.motivo === "SIN_CLAVE") {
        return reply.code(409).send({
          error: "SALA_SIN_PIN_CONFIGURADO",
          message:
            "En este centro todavía no hay ningún PIN de cuidado. Dirección los pone desde Personal.",
        });
      }
      if (!res.ok && res.motivo === "NO_CUADRA") {
        const estado = await registerFailure(limite);
        return reply.code(401).send({
          error: "PIN_INCORRECTO",
          message: "Ese PIN no es correcto.",
          attemptsRemaining: estado.attemptsRemaining,
        });
      }
      if (!res.ok) {
        // PIN bueno y sin rol de cuidado vigente. No cuenta como intento
        // fallido: decirle «PIN incorrecto» la dejaría tecleándolo otra
        // vez. Mismo criterio que la puerta y que el móvil de guardia.
        await reset(limite);
        return reply.code(403).send({
          error: "SIN_ROL_DE_CUIDADO",
          message:
            "Tu PIN es correcto pero no tienes ningún rol de cuidado vigente. Avisa a dirección.",
        });
      }

      const quien = res.quien;
      let elegido = quien.roles[0]!;
      if (quien.roles.length > 1) {
        if (!careRoleAssignmentId) {
          await reset(limite);
          return reply.code(200).send({
            necesitaElegirRol: true,
            nombre: quien.nombre,
            roles: quien.roles.map((r) => ({
              assignmentId: r.assignmentId,
              code: r.code,
              name: r.name,
            })),
          });
        }
        const encontrado = quien.roles.find((r) => r.assignmentId === careRoleAssignmentId);
        if (!encontrado) {
          return reply.code(400).send({
            error: "ROL_NO_VIGENTE",
            message: "Ese rol de cuidado ya no está vigente. Vuelve a entrar.",
          });
        }
        elegido = encontrado;
      } else if (careRoleAssignmentId && careRoleAssignmentId !== elegido.assignmentId) {
        return reply.code(400).send({
          error: "ROL_NO_VIGENTE",
          message: "Ese rol de cuidado ya no está vigente. Vuelve a entrar.",
        });
      }

      await reset(limite);

      // El alcance con el que entra, que es lo que decide qué parte ve y
      // qué zonas cubre su confirmación. Se calcula **al entrar y no al
      // confirmar**: si cambiara entre las dos cosas, lo que se leyó y lo
      // que se firma no serían lo mismo.
      const [rol, zonas, tenant] = await Promise.all([
        prisma.careRoleAssignment.findUniqueOrThrow({
          where: { id: elegido.assignmentId },
          select: { careRole: { select: { fullScope: true } } },
        }),
        prisma.careZoneAssignment.findMany({
          where: { tenantId: ctx.tenantId, userId: quien.userId, toAt: null },
          select: { floorId: true },
        }),
        prisma.tenant.findUniqueOrThrow({
          where: { id: ctx.tenantId },
          select: { cashierSessionTtlMinutes: true },
        }),
      ]);
      const alcance = alcanceDe({ roles: [rol.careRole], zonas });

      const token = signSalaSesion(
        {
          sub: quien.userId,
          tid: ctx.tenantId,
          did: ctx.deviceId,
          caid: elegido.assignmentId,
          crc: elegido.code,
          tot: alcance.alcanceTotal,
        },
        tenant.cashierSessionTtlMinutes,
      );

      const turnos = await prisma.centerShift.findMany({
        where: { tenantId: ctx.tenantId },
        orderBy: [{ sortOrder: "asc" }],
        select: { id: true, code: true, name: true, startsAt: true, endsAt: true },
      });
      const turno = turnoDe(ahora, turnos);

      return reply.code(200).send({
        token,
        usuario: { id: quien.userId, nombre: quien.nombre },
        rol: {
          assignmentId: elegido.assignmentId,
          code: elegido.code,
          name: elegido.name,
        },
        alcanceTotal: alcance.alcanceTotal,
        zonas: alcance.floorIds,
        turno: turno ? { id: turno.id, code: turno.code, name: turno.name } : null,
        careDay: diaDelTurno(ahora, turno),
        minutosSinTocar: MINUTOS_SIN_TOCAR_EN_LA_SALA,
      });
    },
  );

  // ════════════════════════════════════════════════════════════════
  //  4 · `GET /residencia/sala/relevo` · EL PARTE
  // ════════════════════════════════════════════════════════════════
  //
  // El último congelado, **recortado al alcance de quien lo pide** (D-51),
  // con lo que llegó tarde y con quién lo ha confirmado ya.
  app.get(
    "/residencia/sala/relevo",
    { preHandler: [requireSalaDevice, requireSalaSesion] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const ctx = request.sala!;
      const sesion = request.salaSesion!;
      const prisma = getPrisma();

      // clinica-7 · el contrato de encargado. Para LEER, igual que en la
      // puerta: con el contrato nunca aceptado, ni una ruta clínica
      // responde con datos.
      const negativa = await negativaClinica(ctx.tenantId, "LEER");
      if (negativa) {
        return reply
          .code(423)
          .send({ error: negativa.code, code: negativa.code, message: negativa.message });
      }

      const parte = await ultimoParteCongelado(prisma, ctx.tenantId);
      if (parte == null) {
        // No es un error: un centro que acaba de encender el módulo no
        // tiene ningún parte hasta que cierre su primer turno. La pantalla
        // dice eso en vez de un error.
        return reply.code(200).send({ relevo: null });
      }

      const [contenido, { zonas, acuses }, tardios, zonasDelUsuario] = await Promise.all([
        leerParteCongelado(prisma, ctx.tenantId, parte.id),
        zonasYAcuses(prisma, ctx.tenantId, parte.id),
        leerAnadidosTardios(prisma, ctx.tenantId, parte.id),
        prisma.careZoneAssignment.findMany({
          where: { tenantId: ctx.tenantId, userId: sesion.userId, toAt: null },
          select: { floorId: true },
        }),
      ]);

      // El alcance se vuelve a leer de la base y **no se cree del token**:
      // una sesión dura doce horas y una zona se puede retirar a mitad de
      // turno. El `tot` del token es para la tablet sin red; con red manda
      // la base, que es el mismo reparto que el PIN.
      const rol = await prisma.careRoleAssignment.findUnique({
        where: { id: sesion.caid },
        select: { revokedAt: true, careRole: { select: { fullScope: true } } },
      });
      if (rol == null || rol.revokedAt != null) {
        return reply.code(403).send({
          error: "SIN_ROL_DE_CUIDADO",
          message: "Tu rol de cuidado ya no está vigente. Vuelve a entrar.",
        });
      }
      const alcance = alcanceDe({ roles: [rol.careRole], zonas: zonasDelUsuario });

      const recortado =
        contenido == null ? null : recortarAlAlcance(contenido, alcance);

      // ── LA LÍNEA EN EL REGISTRO DE ACCESOS, residente a residente ──
      //
      // El parte lleva salud de varias personas, así que se apunta un
      // acceso por cada residente que sale en LO QUE ESTA PERSONA VE. No
      // por el parte entero: «miró el relevo» no contesta «¿quién ha
      // estado mirando la historia de doña Carmen?», que es la pregunta
      // que el art. 28.3.g y una inspección hacen.
      const vistos = new Set(
        (recortado?.zonas ?? []).flatMap((z) => z.residentes.map((r) => r.clientId)),
      );
      for (const clientId of vistos) {
        await apuntarAcceso({
          tenantId: ctx.tenantId,
          userId: sesion.userId,
          clientId,
          action: "READ",
          outcome: "ALLOWED",
          deviceId: ctx.deviceId,
          route: "GET /residencia/sala/relevo",
        });
      }

      const mios = alcance.alcanceTotal
        ? zonas
        : zonas.filter((z) => z.floorId != null && alcance.floorIds.includes(z.floorId));

      return reply.code(200).send({
        relevo: {
          id: parte.id,
          careDay: parte.careDay,
          turno: parte.centerShift,
          congeladoEn: parte.frozenAt.toISOString(),
          confirmado: estaConfirmado(zonas, alcancesDe(acuses)),
          // Las zonas que a ESTA persona le toca confirmar: las suyas con
          // contenido que nadie ha cubierto todavía. Es lo que el botón
          // dice que va a firmar.
          misZonasPorConfirmar: zonasSinConfirmar(mios, alcancesDe(acuses)).map((z) => ({
            floorId: z.floorId,
          })),
          yaConfirmado: acuses.some((a) => a.user.id === sesion.userId),
          acuses: acuses.map((a) => ({
            userId: a.user.id,
            nombre: nombreCorto(a.user),
            rol: a.careRoleAssignment.careRole.name,
            at: a.at.toISOString(),
            alcanceTotal: a.alcanceTotal,
            zonas: a.zones.map((z) => z.floor.name),
          })),
          // Lo que llegó después, también recortado: un añadido de una
          // planta que no es suya no sale.
          tardios: tardios.filter(
            (t) =>
              alcance.alcanceTotal ||
              (t.floorId != null && alcance.floorIds.includes(t.floorId)),
          ),
          parte: recortado,
          /** `true` cuando el parte existe y no se pudo descifrar. La
           *  pantalla pinta el hueco marcado en vez de un parte vacío
           *  (clinica-7: esconderlo sería borrar la única pista). */
          ilegible: contenido == null,
        },
        alcanceTotal: alcance.alcanceTotal,
      });
    },
  );

  // ════════════════════════════════════════════════════════════════
  //  5 · `POST …/confirmar` · «LEÍDO Y RECIBIDO» (D-19)
  // ════════════════════════════════════════════════════════════════
  //
  // Firma persona + capacidad + hora, y deja dicho **qué zonas abarcaba
  // lo que vio**. La sesión ES la firma (ver `sala-sesion.ts`), así que el
  // cuerpo no lleva ninguna.
  //
  // ── `at` VIENE DE LA TABLET, y por qué ─────────────────────────────
  //
  // Sin red la confirmación se encola y sale después. Lo que manda es
  // **cuándo la persona dijo que lo había leído**, no cuándo llegó aquí:
  // las dos quedan (`at` y `received_at`), igual que los dos instantes de
  // un `CareRecord`. Se acota con los mismos márgenes de la puerta: nada
  // del futuro y nada de hace más de una semana.
  //
  // ── CONFIRMAR DOS VECES NO DUPLICA ────────────────────────────────
  //
  // Se comprueba antes —para que una tablet que reintenta sin red no
  // reciba un error— y el índice único `(handover_id, user_id)` lo
  // garantiza. La respuesta de la segunda vez es la de la primera.
  app.post(
    "/residencia/sala/relevo/:id/confirmar",
    {
      preHandler: [requireSalaDevice, requireSalaSesion],
      schema: {
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", format: "uuid" } },
        },
        body: {
          type: "object",
          additionalProperties: false,
          properties: { at: { type: "string" } },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const ctx = request.sala!;
      const sesion = request.salaSesion!;
      const { id } = request.params as { id: string };
      const { at } = (request.body ?? {}) as { at?: string };
      const prisma = getPrisma();
      const ahora = new Date();

      const parte = await prisma.handover.findFirst({
        where: { id, tenantId: ctx.tenantId },
        select: { id: true, confirmedAt: true },
      });
      if (parte == null) {
        return reply.code(404).send({
          error: "RELEVO_NO_ENCONTRADO",
          message: "Ese parte de relevo no existe en este centro.",
        });
      }

      // El instante de la tablet, con los márgenes de la puerta.
      let instante = ahora;
      if (at != null) {
        const t = new Date(at);
        if (Number.isNaN(t.getTime())) {
          return reply.code(400).send({
            error: "INSTANTE_INVALIDO",
            message: "La hora de la confirmación no es una fecha.",
          });
        }
        if (t.getTime() > ahora.getTime() + 5 * 60_000) {
          return reply.code(400).send({
            error: "CONFIRMACION_EN_EL_FUTURO",
            message:
              "Esta confirmación viene con una hora del futuro. La tablet tiene el reloj mal puesto: avisa a dirección.",
          });
        }
        if (t.getTime() < ahora.getTime() - 7 * 24 * 3_600_000) {
          return reply.code(400).send({
            error: "CONFIRMACION_DEMASIADO_VIEJA",
            message:
              "Esta confirmación lleva más de siete días esperando en la tablet. Avisa a dirección.",
          });
        }
        instante = t;
      }

      // Ya confirmada por esta persona: se contesta la que había.
      const ya = await prisma.handoverAck.findUnique({
        where: { handoverId_userId: { handoverId: id, userId: sesion.userId } },
        select: { id: true, at: true },
      });
      if (ya != null) {
        const estado = await estadoDeConfirmacion(prisma, ctx.tenantId, id);
        return reply.code(200).send({
          ackId: ya.id,
          at: ya.at.toISOString(),
          yaEstaba: true,
          ...estado,
        });
      }

      // El alcance, de la base y en el momento de firmar.
      const [rol, zonasDelUsuario] = await Promise.all([
        prisma.careRoleAssignment.findUnique({
          where: { id: sesion.caid },
          select: { revokedAt: true, careRole: { select: { fullScope: true } } },
        }),
        prisma.careZoneAssignment.findMany({
          where: { tenantId: ctx.tenantId, userId: sesion.userId, toAt: null },
          select: { floorId: true },
        }),
      ]);
      if (rol == null || rol.revokedAt != null) {
        return reply.code(403).send({
          error: "SIN_ROL_DE_CUIDADO",
          message: "Tu rol de cuidado ya no está vigente. Vuelve a entrar.",
        });
      }
      const alcance = alcanceDe({ roles: [rol.careRole], zonas: zonasDelUsuario });

      const ackId = await prisma.$transaction(async (tx) => {
        const ack = await tx.handoverAck.create({
          data: {
            tenantId: ctx.tenantId,
            handoverId: id,
            userId: sesion.userId,
            careRoleAssignmentId: sesion.caid,
            deviceId: ctx.deviceId,
            at: instante,
            alcanceTotal: alcance.alcanceTotal,
          },
          select: { id: true },
        });
        // Las zonas que abarcaba. Vacío con alcance total: ver el
        // comentario de `HandoverAckZone` en el esquema.
        for (const floorId of alcance.floorIds) {
          await tx.handoverAckZone.create({
            data: { tenantId: ctx.tenantId, ackId: ack.id, floorId },
          });
        }

        // ── Y si con esto queda CONFIRMADO, se marca ────────────────
        //
        // Dentro de la misma transacción: una confirmación escrita y un
        // parte que sigue diciendo «sin confirmar» es exactamente lo que
        // el panel enseñaría en rojo sin motivo.
        const [zonas, acuses] = await Promise.all([
          tx.handoverZone.findMany({
            where: { tenantId: ctx.tenantId, handoverId: id },
            select: { floorId: true },
          }),
          tx.handoverAck.findMany({
            where: { tenantId: ctx.tenantId, handoverId: id },
            select: { alcanceTotal: true, zones: { select: { floorId: true } } },
          }),
        ]);
        if (estaConfirmado(zonas, alcancesDe(acuses))) {
          // `updateMany` con `confirmedAt: null` en el `where` y no
          // `update`: el trigger `handovers_inmutable` rechaza cambiar un
          // `confirmed_at` que ya estaba puesto, y dos personas
          // confirmando a la vez llegarían aquí las dos.
          await tx.handover.updateMany({
            where: { id, confirmedAt: null },
            data: { confirmedAt: instante },
          });
        }
        return ack.id;
      });

      const estado = await estadoDeConfirmacion(prisma, ctx.tenantId, id);
      return reply.code(201).send({
        ackId,
        at: instante.toISOString(),
        yaEstaba: false,
        alcanceTotal: alcance.alcanceTotal,
        zonas: alcance.floorIds,
        ...estado,
      });
    },
  );
}

/** «¿Está confirmado y qué falta?», para la respuesta de la sala. */
async function estadoDeConfirmacion(
  prisma: PrismaClient,
  tenantId: string,
  handoverId: string,
): Promise<{ confirmado: boolean; zonasPorConfirmar: number }> {
  const [zonas, acuses] = await Promise.all([
    prisma.handoverZone.findMany({
      where: { tenantId, handoverId },
      select: { floorId: true },
    }),
    prisma.handoverAck.findMany({
      where: { tenantId, handoverId },
      select: { alcanceTotal: true, zones: { select: { floorId: true } } },
    }),
  ]);
  const alcances = acuses.map((a) => ({
    alcanceTotal: a.alcanceTotal,
    floorIds: a.zones.map((z) => z.floorId),
  }));
  return {
    confirmado: estaConfirmado(zonas, alcances),
    zonasPorConfirmar: zonasSinConfirmar(zonas, alcances).length,
  };
}
