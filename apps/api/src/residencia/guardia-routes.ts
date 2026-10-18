// residencia-4 (D-66) · **EL MÓVIL DE GUARDIA, DE PARTE DEL SERVIDOR.**
//
// Siete rutas y ni una más:
//
//   1. `POST /residencia/guardia/pairing-codes`      — el admin genera el
//      código de 6 dígitos de un móvil, con su canal.
//   2. `GET  /residencia/guardia/me`                 — el móvil, ya
//      emparejado, pregunta de qué canal es y quién está de guardia.
//   3. `POST /residencia/guardia/pin`                — «estoy de
//      guardia». Abre la guardia y devuelve el token.
//   4. `POST /residencia/guardia/terminar`           — la suelta.
//   5. `GET  /residencia/guardia/avisos`             — lo que tiene que
//      sonar ahora, y lo del turno.
//   6. `POST /residencia/guardia/avisos/:id/acuse`   — «Voy», firmado.
//   7. `POST /residencia/guardia/avisos/:id/llamada` — se llamó (o no) al
//      servicio sanitario de guardia.
//
// Más la foto del residente, que es la misma de la puerta con la misma
// regla de consentimiento (D-64).
//
// ── NADA DE SALUD ANTES DEL PIN ─────────────────────────────────────
//
// `GET /residencia/guardia/me` contesta el nombre del centro, el canal y
// **quién está de guardia** — nada más. Ni un aviso, ni una habitación,
// ni un nombre de residente. Un móvil de guardia es un teléfono que se
// queda en una mesa, y la pantalla en reposo la ve cualquiera que pase.
//
// Lo que la notificación del sistema dice con la pantalla bloqueada está
// acotado en el mismo sitio y por lo mismo: **«Aviso N2 · habitación
// 112»**, y ni una palabra más. Lo decide la APK, y el servidor no le
// manda por el socket nada que no quepa en esa frase: el evento lleva el
// nivel y el id, y el detalle se pide con el GET detrás de la sesión.
//
// ── POR QUÉ EL CÓDIGO NO SE PIDE POR `/admin/registers/...` ─────────
//
// Por lo mismo que la puerta (residencia-1): esa ruta lleva
// `ensureCajaEnabled` y un tenant de residencia tiene la caja apagada
// (D-48). Y además un móvil de guardia no cuelga de ninguna caja ni de
// ninguna habitación — su `register_id` y su `room_id` son los dos NULL,
// que es la tercera rama del CHECK `devices_register_o_habitacion`.

import { randomInt } from "node:crypto";

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import type { GuardChannel } from "@mipiacetpv/db";
import {
  FRASE_PIN_POR_RENOVAR,
  diaDelTurno,
  turnoDe,
} from "@mipiacetpv/residencia-plan";

import { getPrisma } from "../context.js";
import { requireOwnerOrManager } from "../auth/middleware.js";
import { inspect, registerFailure, reset } from "../auth/rate-limit.js";
import { dekONada } from "../clinica/claves.js";
import { negativaClinica } from "../clinica/contrato.js";
import { ensureClinicaEnabled } from "../clinica/gate.js";
import { apuntarAcceso } from "../clinica/registro.js";
import { leerFichero, MIME_DE_FOTO } from "../clinica/ficheros.js";
import { leerJson, leerTexto } from "../clinica/cripto-campos.js";
import {
  sitioDescripcionDeIncidencia,
  sitioValorDeRegistro,
} from "../clinica/cripto-campos.js";
import { avisosVivos, configuracionDeGuardia } from "./aviso.js";
import { NOMBRE_DEL_TIPO } from "./catalogo/plantilla-de-gravedad.js";
import { ensureResidenciaEnabled } from "./gate.js";
import { getBusDeGuardia } from "./guardia-bus.js";
import { requireGuardiaDevice } from "./guardia-auth.js";
import { requireGuardiaSesion, signGuardiaSesion } from "./guardia-sesion.js";
import { escribirAccion } from "./incidencias.js";
import { resolverPinDeCuidado } from "./pin-de-cuidado.js";
import { dekParaLeer, nombreDeQuienFirma } from "./registro.js";

// Los mismos números que `devices/routes.ts` y `puerta-routes.ts`. Si uno
// cambia, los tres.
const PAIRING_CODE_TTL_MINUTES = 60;
const PAIRING_CODE_MAX_ATTEMPTS = 8;

function newSixDigitCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

// ── El rate-limit del PIN · POR MÓVIL, y con los números de la puerta ─
//
// Diez intentos en cinco minutos, dos de candado. Y aquí la razón del
// candado corto es todavía más fuerte que en la puerta: **un móvil
// candado es un móvil que nadie puede ponerse de guardia**, y en un turno
// de noche eso es el centro entero sin enfermera localizable.
const PIN_MAX_INTENTOS = 10;
const PIN_VENTANA_S = 5 * 60;
const PIN_CANDADO_S = 2 * 60;

function limiteDelPin(tenantId: string, deviceId: string) {
  return {
    attemptsKey: `guardia-pin-attempts:${tenantId}:${deviceId}`,
    lockKey: `guardia-pin-locked:${tenantId}:${deviceId}`,
    maxAttempts: PIN_MAX_INTENTOS,
    attemptTtlSeconds: PIN_VENTANA_S,
    lockTtlSeconds: PIN_CANDADO_S,
  };
}

/** Quién está de guardia AHORA en este centro, por canal. */
async function quienEstaDeGuardia(tenantId: string) {
  const filas = await getPrisma().guardShiftSession.findMany({
    where: { tenantId, endedAt: null },
    orderBy: { startedAt: "asc" },
    select: {
      id: true,
      channel: true,
      startedAt: true,
      deviceId: true,
      user: { select: { alias: true, email: true } },
      careRole: { select: { careRole: { select: { name: true } } } },
      centerShift: { select: { code: true, name: true } },
    },
  });
  return filas.map((f) => ({
    id: f.id,
    canal: f.channel,
    deviceId: f.deviceId,
    nombre: nombreDeQuienFirma(f.user),
    rol: f.careRole.careRole.name,
    turno: f.centerShift?.name ?? null,
    desde: f.startedAt.toISOString(),
  }));
}

export async function registerResidenciaGuardiaRoutes(
  app: FastifyInstance,
): Promise<void> {
  // ════════════════════════════════════════════════════════════════
  //  1 · El código de emparejamiento de un móvil de guardia
  // ════════════════════════════════════════════════════════════════
  app.post(
    "/residencia/guardia/pairing-codes",
    {
      preHandler: [
        requireOwnerOrManager,
        ensureClinicaEnabled,
        ensureResidenciaEnabled,
      ],
      schema: {
        body: {
          type: "object",
          required: ["canal"],
          additionalProperties: false,
          properties: {
            // **El canal lo decide el código**, no el aparato. Si lo
            // decidiera el cuerpo de `POST /devices/pair`, cualquiera con
            // un código se pondría en el canal de enfermería y recibiría
            // los avisos de salud del centro.
            canal: { type: "string", enum: ["ENFERMERIA", "RESPONSABLE"] },
            name: { type: "string", maxLength: 80 },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const { canal } = request.body as { canal: GuardChannel; name?: string };
      const prisma = getPrisma();

      const expiresAt = new Date(
        Date.now() + PAIRING_CODE_TTL_MINUTES * 60 * 1000,
      );
      for (let intento = 0; intento < PAIRING_CODE_MAX_ATTEMPTS; intento++) {
        const code = newSixDigitCode();
        const existing = await prisma.pairingCode.findUnique({
          where: { tenantId_code: { tenantId: auth.tenantId, code } },
          select: { consumedAt: true, expiresAt: true },
        });
        const vivo =
          existing &&
          existing.consumedAt == null &&
          existing.expiresAt > new Date();
        if (vivo) continue;
        if (existing) {
          await prisma.pairingCode.delete({
            where: { tenantId_code: { tenantId: auth.tenantId, code } },
          });
        }
        const creado = await prisma.pairingCode.create({
          data: {
            tenantId: auth.tenantId,
            // Ni caja ni habitación: la tercera rama del CHECK.
            registerId: null,
            roomId: null,
            code,
            createdByUserId: auth.userId,
            expiresAt,
            kind: "GUARD",
            guardChannel: canal,
          },
          select: { code: true, expiresAt: true, kind: true, guardChannel: true },
        });
        return reply.code(201).send({
          code: creado.code,
          expiresAt: creado.expiresAt.toISOString(),
          kind: creado.kind,
          canal: creado.guardChannel,
        });
      }
      return reply.code(503).send({
        error: "CODE_COLLISION",
        message: "No se pudo generar un código único, reintenta",
      });
    },
  );

  // ════════════════════════════════════════════════════════════════
  //  2 · `GET /residencia/guardia/me` · LA PANTALLA EN REPOSO
  // ════════════════════════════════════════════════════════════════
  //
  // «De guardia: Lucía · enfermería · turno de tarde» o «Nadie de
  // guardia». Sin sesión, porque es lo que se pinta ANTES del PIN.
  app.get(
    "/residencia/guardia/me",
    { preHandler: [requireGuardiaDevice] },
    async (request: FastifyRequest) => {
      const ctx = request.guardia!;
      const prisma = getPrisma();
      const ahora = new Date();

      const [tenant, turnos, deGuardia, config] = await Promise.all([
        prisma.tenant.findUniqueOrThrow({
          where: { id: ctx.tenantId },
          select: { name: true },
        }),
        prisma.centerShift.findMany({
          where: { tenantId: ctx.tenantId },
          orderBy: [{ sortOrder: "asc" }, { startsAt: "asc" }],
          select: { id: true, code: true, name: true, startsAt: true, endsAt: true },
        }),
        quienEstaDeGuardia(ctx.tenantId),
        configuracionDeGuardia(prisma, ctx.tenantId),
      ]);

      await prisma.device.update({
        where: { id: ctx.deviceId },
        data: { lastSeenAt: ahora },
      });

      const turno = turnoDe(ahora, turnos);
      return {
        device: { id: ctx.deviceId, name: ctx.deviceName },
        centro: { id: ctx.tenantId, nombre: tenant.name },
        canal: ctx.canal,
        turno: turno ? { id: turno.id, code: turno.code, name: turno.name } : null,
        turnos,
        // Quién está de guardia en TODOS los canales, no sólo en el suyo:
        // la dirección tiene que poder ver desde su móvil que esta noche
        // no hay enfermera, que es la mitad de por qué D-66 existe.
        deGuardia,
        /** Si ESTE móvil está cogido, y por quién. */
        esteMovil: deGuardia.find((g) => g.deviceId === ctx.deviceId) ?? null,
        servicio: config.servicio,
        serverTime: ahora.toISOString(),
      };
    },
  );

  // ════════════════════════════════════════════════════════════════
  //  3 · `POST /residencia/guardia/pin` · «ESTOY DE GUARDIA»
  // ════════════════════════════════════════════════════════════════
  //
  // Teclear el PIN aquí **no es entrar en una pantalla**: es hacerse
  // cargo del teléfono. Abre una `GuardShiftSession`, que es lo que le
  // dice al sistema si hay enfermera de guardia en este turno — y por eso
  // no hace falta cuadrante (D-66).
  //
  // Y **releva al anterior de ESTE móvil**: si alguien se lo dejó
  // abierto, el que lo coge ahora cierra aquella guardia en la misma
  // transacción. Lo clava el índice parcial
  // `guard_shift_sessions_una_viva_key`; si el `UPDATE` no corriera, el
  // `INSERT` revienta ahí en vez de dejar dos personas «de guardia» en el
  // mismo aparato.
  app.post(
    "/residencia/guardia/pin",
    {
      preHandler: [requireGuardiaDevice],
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
      const ctx = request.guardia!;
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
          error: "GUARDIA_PIN_BLOQUEADO",
          message: `Demasiados intentos en este móvil. Prueba en ${Math.ceil(
            previo.retryAfterSeconds / 60,
          )} min.`,
          retryAfterSeconds: previo.retryAfterSeconds,
        });
      }

      const res = await resolverPinDeCuidado(prisma, {
        tenantId: ctx.tenantId,
        pin,
        ahora,
      });
      if (!res.ok && res.motivo === "SIN_CLAVE") {
        return reply.code(409).send({
          error: "GUARDIA_SIN_PIN_CONFIGURADO",
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
      // residencia-6 (D-68) · el PIN es bueno y **se quedó corto**: tiene
      // cuatro cifras y esta persona ha pasado a tener un rol que ve todo
      // el centro. No cuenta como intento fallido —el PIN es el suyo— y
      // la frase es la MISMA que en la puerta y en la sala, porque quien
      // la lee está de pie y tiene que saber a dónde ir.
      if (!res.ok && res.motivo === "POR_RENOVAR") {
        await reset(limite);
        return reply.code(403).send({
          error: "PIN_POR_RENOVAR",
          message: FRASE_PIN_POR_RENOVAR,
        });
      }
      if (!res.ok) {
        // El PIN es bueno y no tiene rol vigente. No cuenta como intento
        // fallido: decirle «PIN incorrecto» la dejaría tecleándolo otra
        // vez. Mismo criterio exacto que la puerta.
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
        const encontrado = quien.roles.find(
          (r) => r.assignmentId === careRoleAssignmentId,
        );
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

      const turnos = await prisma.centerShift.findMany({
        where: { tenantId: ctx.tenantId },
        orderBy: [{ sortOrder: "asc" }],
        select: { id: true, code: true, name: true, startsAt: true, endsAt: true },
      });
      const turno = turnoDe(ahora, turnos);
      const careDay = diaDelTurno(ahora, turno);

      const guardia = await prisma.$transaction(async (tx) => {
        await tx.guardShiftSession.updateMany({
          where: { deviceId: ctx.deviceId, endedAt: null },
          data: { endedAt: ahora, endedByUserId: quien.userId },
        });
        return tx.guardShiftSession.create({
          data: {
            tenantId: ctx.tenantId,
            deviceId: ctx.deviceId,
            channel: ctx.canal,
            userId: quien.userId,
            careRoleAssignmentId: elegido.assignmentId,
            startedAt: ahora,
            centerShiftId: turno?.id ?? null,
            careDay,
          },
          select: { id: true },
        });
      });

      const tenant = await prisma.tenant.findUniqueOrThrow({
        where: { id: ctx.tenantId },
        select: { cashierSessionTtlMinutes: true },
      });
      const token = signGuardiaSesion(
        {
          sub: quien.userId,
          tid: ctx.tenantId,
          did: ctx.deviceId,
          can: ctx.canal,
          caid: elegido.assignmentId,
          crc: elegido.code,
          gsid: guardia.id,
        },
        tenant.cashierSessionTtlMinutes,
      );

      return reply.code(200).send({
        token,
        guardiaId: guardia.id,
        canal: ctx.canal,
        usuario: { id: quien.userId, nombre: quien.nombre },
        rol: {
          assignmentId: elegido.assignmentId,
          code: elegido.code,
          name: elegido.name,
        },
        turno: turno ? { id: turno.id, code: turno.code, name: turno.name } : null,
        careDay,
      });
    },
  );

  // ════════════════════════════════════════════════════════════════
  //  4 · `POST /residencia/guardia/terminar` · SOLTAR EL MÓVIL
  // ════════════════════════════════════════════════════════════════
  //
  // No cierra la sesión del token: cierra la GUARDIA. Son dos cosas y el
  // orden importa — después de esto, un N2 de este centro ya no espera
  // cinco minutos a la enfermería: suena en dirección al momento, porque
  // ya no hay nadie de guardia.
  app.post(
    "/residencia/guardia/terminar",
    { preHandler: [requireGuardiaDevice, requireGuardiaSesion] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const ctx = request.guardia!;
      const sesion = request.guardiaSesion!;
      const prisma = getPrisma();
      const { count } = await prisma.guardShiftSession.updateMany({
        where: { deviceId: ctx.deviceId, endedAt: null },
        data: { endedAt: new Date(), endedByUserId: sesion.userId },
      });
      return reply.code(200).send({ cerradas: count });
    },
  );

  // ════════════════════════════════════════════════════════════════
  //  5 · `GET /residencia/guardia/avisos` · LO QUE TIENE QUE SONAR
  // ════════════════════════════════════════════════════════════════
  //
  // **Es la ruta que hace que el aviso no se pierda.** El socket es el
  // camino rápido; éste es el que no falla: el móvil lo pide al conectar,
  // al reconectar y cada quince segundos. Un socket caído retrasa un
  // aviso hasta el siguiente sondeo, no lo pierde.
  //
  // Devuelve **lo justo para actuar**: habitación, residente, qué pasa y
  // nivel. La descripción va descifrada —es la pantalla de quien tiene
  // que ir— y deja su línea en el registro de accesos, residente a
  // residente, igual que la puerta.
  app.get(
    "/residencia/guardia/avisos",
    { preHandler: [requireGuardiaDevice, requireGuardiaSesion] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const ctx = request.guardia!;
      const sesion = request.guardiaSesion!;
      const prisma = getPrisma();
      const ahora = new Date();

      const negativa = await negativaClinica(ctx.tenantId, "LEER");
      if (negativa) {
        return reply
          .code(423)
          .send({ error: negativa.code, code: negativa.code, message: negativa.message });
      }

      const vivos = await avisosVivos(prisma, ctx.tenantId, ctx.canal);
      const dek = await dekParaLeer(ctx.tenantId, prisma);
      const config = await configuracionDeGuardia(prisma, ctx.tenantId);

      // ¿De quién se puede enseñar la cara? (D-64) La misma regla que en
      // la puerta: fichero Y consentimiento de imagen vigente. El móvil
      // no sabe de consentimientos — pide la foto si esto es `true` y
      // pinta las iniciales si no— y la ruta de la foto lo vuelve a
      // comprobar, que es la mitad que de verdad protege.
      const clientIdsConAviso = [
        ...new Set(
          vivos
            .map((a) => a.incident.clientId)
            .filter((x): x is string => x != null),
        ),
      ];
      const [perfiles, consentimientos] = await Promise.all([
        prisma.residentProfile.findMany({
          where: { tenantId: ctx.tenantId, clientId: { in: clientIdsConAviso } },
          select: { clientId: true, photoFileName: true },
        }),
        prisma.clientConsent.findMany({
          where: {
            tenantId: ctx.tenantId,
            clientId: { in: clientIdsConAviso },
            kind: "IMAGE",
          },
          select: { id: true, clientId: true, revokesConsentId: true },
        }),
      ]);
      const revocados = new Set(
        consentimientos
          .map((c) => c.revokesConsentId)
          .filter((x): x is string => x != null),
      );
      const conConsentimiento = new Set(
        consentimientos
          .filter((c) => c.revokesConsentId == null && !revocados.has(c.id))
          .map((c) => c.clientId),
      );
      const conFichero = new Set(
        perfiles.filter((p) => p.photoFileName != null).map((p) => p.clientId),
      );

      // La línea del registro de accesos, uno por residente y una sola
      // vez por petición: el móvil sondea cada quince segundos y una
      // línea por sondeo haría el registro ilegible. Se apunta por los
      // residentes CUYO AVISO se está sirviendo.
      const vistos = new Set<string>();
      for (const a of vivos) {
        const clientId = a.incident.clientId;
        if (clientId == null || vistos.has(clientId)) continue;
        vistos.add(clientId);
        await apuntarAcceso({
          tenantId: ctx.tenantId,
          userId: sesion.userId,
          clientId,
          action: "READ",
          outcome: "ALLOWED",
          deviceId: ctx.deviceId,
          route: "GET /residencia/guardia/avisos",
        });
      }

      // Que se han entregado. No es el acuse: es que llegaron, y sirve
      // para contestar «¿sonó?» cuando nadie lo acusó.
      const sinEntregar = vivos
        .filter((a) => a.state === "PENDING")
        .map((a) => a.id);
      if (sinEntregar.length > 0) {
        await prisma.guardAlert.updateMany({
          where: { id: { in: sinEntregar }, state: "PENDING" },
          data: { state: "DELIVERED", deliveredAt: ahora },
        });
      }

      return reply.code(200).send({
        canal: ctx.canal,
        servicio: config.servicio,
        avisos: vivos.map((a) => {
          const inc = a.incident;
          const valor =
            inc.sourceRecord != null
              ? (leerJson(
                  { cifrado: inc.sourceRecord.valueCifrado, claro: null },
                  dek,
                  sitioValorDeRegistro(
                    inc.sourceRecord.tenantId,
                    inc.sourceRecord.id,
                  ),
                ) as { numero?: unknown; unidad?: unknown } | null)
              : null;
          return {
            id: a.id,
            canal: a.channel,
            nivel: a.severity,
            estado: a.state,
            // Los DOS instantes. El retraso se ve restando, y es lo que
            // la pantalla pinta cuando el aviso llegó tarde por falta de
            // red en la puerta (alcance 8).
            apuntadoEn: a.queuedAt.toISOString(),
            salidoEn: a.createdAt.toISOString(),
            escalado: a.escalatedFromId != null,
            incidencia: {
              id: inc.id,
              tipo: inc.incidentType,
              nombreDelTipo: NOMBRE_DEL_TIPO[inc.incidentType] ?? inc.incidentType,
              nivel: inc.severity,
              origen: inc.origin,
              abiertaEn: inc.openedAt.toISOString(),
              habitacion: inc.room
                ? { numero: inc.room.number, nombre: inc.room.name }
                : null,
              residente: inc.client
                ? {
                    id: inc.clientId,
                    nombre: `${inc.client.firstName} ${inc.client.lastName}`.trim(),
                  }
                : null,
              tieneFoto:
                inc.clientId != null &&
                conFichero.has(inc.clientId) &&
                conConsentimiento.has(inc.clientId),
              descripcion: leerTexto(
                { cifrado: inc.descriptionCifrado, claro: null },
                dek,
                sitioDescripcionDeIncidencia(ctx.tenantId, inc.id),
              ),
              // La medida que lo abrió, descifrada: «38,6 °C» es lo que
              // la enfermera necesita ver antes de salir corriendo.
              medida:
                valor && typeof valor.numero === "number"
                  ? {
                      control: inc.sourceRecord!.controlCode,
                      numero: valor.numero,
                      unidad:
                        typeof valor.unidad === "string" ? valor.unidad : null,
                    }
                  : null,
            },
          };
        }),
        serverTime: ahora.toISOString(),
      });
    },
  );

  // ════════════════════════════════════════════════════════════════
  //  6 · `POST /residencia/guardia/avisos/:id/acuse` · «VOY»
  // ════════════════════════════════════════════════════════════════
  //
  // Firma persona + capacidad + hora (D-31). **No es un botón de
  // «leído»**: es quien se hace cargo, y es lo que la puerta que lo
  // originó pinta («Aviso recibido por Lucía · 10:43»).
  //
  // Acusa el aviso de ESTE canal y **no cancela el otro**: si la
  // dirección ya lo tiene delante, lo que ve es que va alguien — el
  // evento del socket se lo dice— y eso es mejor que quitárselo de la
  // pantalla sin explicación.
  app.post(
    "/residencia/guardia/avisos/:id/acuse",
    {
      preHandler: [requireGuardiaDevice, requireGuardiaSesion],
      schema: {
        params: {
          type: "object",
          required: ["id"],
          additionalProperties: false,
          properties: { id: { type: "string", format: "uuid" } },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const ctx = request.guardia!;
      const sesion = request.guardiaSesion!;
      const { id } = request.params as { id: string };
      const prisma = getPrisma();
      const ahora = new Date();

      const negativa = await negativaClinica(ctx.tenantId, "ESCRIBIR");
      if (negativa) {
        return reply
          .code(423)
          .send({ error: negativa.code, code: negativa.code, message: negativa.message });
      }

      const aviso = await prisma.guardAlert.findFirst({
        where: { id, tenantId: ctx.tenantId },
        select: {
          id: true,
          channel: true,
          state: true,
          incidentId: true,
          ackedAt: true,
          ackedBy: { select: { alias: true, email: true } },
        },
      });
      if (!aviso) {
        return reply.code(404).send({
          error: "AVISO_NO_ENCONTRADO",
          message: "Ese aviso no es de este centro.",
        });
      }
      if (aviso.channel !== ctx.canal) {
        // 403 y no 404: el aviso existe, lo que no es es de este canal.
        // Un móvil de enfermería no acusa por la dirección.
        return reply.code(403).send({
          error: "AVISO_DE_OTRO_CANAL",
          message: "Ese aviso es de otro canal.",
        });
      }
      if (aviso.ackedAt != null) {
        // Dos personas que pulsan «Voy» a la vez. Gana la primera y la
        // segunda ve quién va: contestar un error sin nombre la dejaría
        // sin saber si tiene que ir ella.
        return reply.code(409).send({
          error: "YA_ACUSADO",
          message: `Ya lo ha acusado ${
            aviso.ackedBy ? nombreDeQuienFirma(aviso.ackedBy) : "otra persona"
          }.`,
          acusadoPor: aviso.ackedBy ? nombreDeQuienFirma(aviso.ackedBy) : null,
          acusadoEn: aviso.ackedAt.toISOString(),
        });
      }
      if (aviso.state === "CANCELLED") {
        return reply.code(409).send({
          error: "AVISO_CANCELADO",
          message: "Esa incidencia ya se cerró.",
        });
      }

      await prisma.guardAlert.update({
        where: { id: aviso.id },
        data: {
          state: "ACKED",
          ackedAt: ahora,
          ackedByUserId: sesion.userId,
          ackedByCareRoleAssignmentId: sesion.caid,
          ackedByDeviceId: ctx.deviceId,
          // Y deja de escalar: alguien va.
          escalateAt: null,
        },
      });
      await escribirAccion(prisma, {
        tenantId: ctx.tenantId,
        incidentId: aviso.incidentId,
        kind: "ALERT",
        firma: {
          userId: sesion.userId,
          careRoleAssignmentId: sesion.caid,
        },
        at: ahora,
      });

      const usuario = await prisma.user.findUniqueOrThrow({
        where: { id: sesion.userId },
        select: { alias: true, email: true },
      });
      const nombre = nombreDeQuienFirma(usuario);
      // A los otros móviles del MISMO canal, para que lo quiten de la
      // pantalla; y al otro canal, para que la dirección vea que va
      // alguien sin tener que preguntar.
      const bus = getBusDeGuardia();
      for (const canal of ["ENFERMERIA", "RESPONSABLE"] as const) {
        bus.emitir(ctx.tenantId, canal, {
          type: "acuse",
          alertId: aviso.id,
          incidentId: aviso.incidentId,
          porNombre: nombre,
          at: ahora.toISOString(),
        });
      }

      return reply.code(200).send({
        id: aviso.id,
        acusadoEn: ahora.toISOString(),
        acusadoPor: nombre,
      });
    },
  );

  // ════════════════════════════════════════════════════════════════
  //  7 · `POST /residencia/guardia/avisos/:id/llamada` · D-33
  // ════════════════════════════════════════════════════════════════
  //
  // **El sistema no llama a nadie.** En N3 y N4 el móvil muestra
  // «Recomendado: llamar a …» con un botón que abre el marcador del
  // teléfono; la llamada la hace la persona. Esta ruta sólo apunta si se
  // llamó o no, como acción de la incidencia.
  //
  // Y las dos respuestas valen, por la misma lógica de denominador que el
  // «como siempre» (D-15): «no se llamó porque ya estaba la médica
  // delante» es una decisión, y sin apuntarla no se distingue de «nadie
  // se acordó».
  app.post(
    "/residencia/guardia/avisos/:id/llamada",
    {
      preHandler: [requireGuardiaDevice, requireGuardiaSesion],
      schema: {
        params: {
          type: "object",
          required: ["id"],
          additionalProperties: false,
          properties: { id: { type: "string", format: "uuid" } },
        },
        body: {
          type: "object",
          required: ["llamado"],
          additionalProperties: false,
          properties: {
            llamado: { type: "boolean" },
            nota: { type: ["string", "null"], maxLength: 500 },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const ctx = request.guardia!;
      const sesion = request.guardiaSesion!;
      const { id } = request.params as { id: string };
      const { llamado, nota } = request.body as {
        llamado: boolean;
        nota?: string | null;
      };
      const prisma = getPrisma();

      const negativa = await negativaClinica(ctx.tenantId, "ESCRIBIR");
      if (negativa) {
        return reply
          .code(423)
          .send({ error: negativa.code, code: negativa.code, message: negativa.message });
      }

      const aviso = await prisma.guardAlert.findFirst({
        where: { id, tenantId: ctx.tenantId, channel: ctx.canal },
        select: { incidentId: true },
      });
      if (!aviso) {
        return reply.code(404).send({
          error: "AVISO_NO_ENCONTRADO",
          message: "Ese aviso no es de este centro.",
        });
      }
      const accionId = await escribirAccion(prisma, {
        tenantId: ctx.tenantId,
        incidentId: aviso.incidentId,
        kind: "CALL",
        called: llamado,
        texto: nota ?? null,
        firma: { userId: sesion.userId, careRoleAssignmentId: sesion.caid },
      });
      return reply.code(201).send({ id: accionId, llamado });
    },
  );

  // ── La foto del residente, con su consentimiento (D-64) ───────────
  //
  // La misma regla que en la puerta y por lo mismo: **404 y no 403** sin
  // consentimiento, porque un 403 diría «esta persona tiene foto y no te
  // la damos». Lo que cambia es el filtro: la puerta sólo sirve la de SU
  // habitación; el móvil, la de un residente que **tiene un aviso vivo de
  // su canal**. Sin eso, un móvil de guardia sería una ventana a la cara
  // de los 49 residentes del centro.
  app.get(
    "/residencia/guardia/residentes/:clientId/foto",
    {
      preHandler: [requireGuardiaDevice, requireGuardiaSesion],
      schema: {
        params: {
          type: "object",
          required: ["clientId"],
          additionalProperties: false,
          properties: { clientId: { type: "string", format: "uuid" } },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const ctx = request.guardia!;
      const { clientId } = request.params as { clientId: string };
      const prisma = getPrisma();
      const SIN_FOTO = { error: "SIN_FOTO", message: "No hay foto que enseñar." };

      const conAviso = await prisma.guardAlert.findFirst({
        where: {
          tenantId: ctx.tenantId,
          channel: ctx.canal,
          state: { in: ["PENDING", "DELIVERED", "ESCALATED", "ACKED"] },
          incident: { clientId },
        },
        select: { id: true },
      });
      if (!conAviso) return reply.code(404).send(SIN_FOTO);

      const perfil = await prisma.residentProfile.findFirst({
        where: { clientId, tenantId: ctx.tenantId },
        select: { photoFileName: true, photoSha256: true, photoMimeType: true },
      });
      const consentimientos = await prisma.clientConsent.findMany({
        where: { tenantId: ctx.tenantId, clientId, kind: "IMAGE" },
        select: { id: true, revokesConsentId: true },
      });
      const revocados = new Set(
        consentimientos
          .map((c) => c.revokesConsentId)
          .filter((x): x is string => x != null),
      );
      const tieneConsentimiento = consentimientos.some(
        (c) => c.revokesConsentId == null && !revocados.has(c.id),
      );
      if (!perfil?.photoFileName || !tieneConsentimiento) {
        return reply.code(404).send(SIN_FOTO);
      }
      const dek = await dekONada(ctx.tenantId, prisma);
      const leido = await leerFichero(
        "RESIDENTE",
        perfil.photoFileName,
        perfil.photoSha256,
        { tenantId: ctx.tenantId, dek },
      );
      if (!leido) return reply.code(404).send(SIN_FOTO);
      return reply
        .code(200)
        .header("Content-Type", perfil.photoMimeType ?? MIME_DE_FOTO)
        .header("X-Huella-Cuadra", leido.huellaCuadra ? "si" : "no")
        .header("Cache-Control", "no-store")
        .send(leido.contenido);
    },
  );
}
