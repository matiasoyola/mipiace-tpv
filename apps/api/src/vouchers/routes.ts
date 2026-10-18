// B-reservas-8 · las rutas de los bonos.
//
//   TPV (sesión de cajero):
//     GET    /bonos/consultar                           — la puerta, por código
//     GET    /clients/:id/bonos-que-cubren              — para ofrecerlo al citar
//     GET    /tickets/:ticketId/bonos                   — qué líneas se pueden canjear
//     POST   /tickets/:ticketId/lines/:lineId/bono      — marcar el canje
//     DELETE /tickets/:ticketId/lines/:lineId/bono       — quitarlo (libera)
//
//   Ficha y panel (sesión de empresa o de cajero):
//     GET    /bonos/:id                                 — el bono y su TRAZA
//     POST   /bonos/:id/correcciones                    — sesiones de más o de menos
//     POST   /bonos/:id/caducidad                       — prolongar, con motivo
//     POST   /bonos/alta-inicial                        — el bono de papel
//
// Todas detrás de `ensureBonosEnabled` (404 con el módulo apagado: a una
// librería no se le cuenta que esto existe). Multi-tenant por fila: toda
// consulta filtra por el tenant de la sesión.
//
// ── Lo que NINGUNA de estas rutas hace ─────────────────────────────────
//
// Tocar las tablas de bonos por su cuenta. Escriben llamando a la puerta
// (`gate.ts`) o a los dos módulos que la envuelven (`venta.ts`, `caja.ts`),
// y leen por `lectura.ts`. Es la regla del bloque: la puerta es la única
// forma de tocar un bono.

import {
  mensajeDeEstado,
  MOTIVOS_CORRECCION,
  porQueNoDevolvible,
  seArreglaEnElMomento,
  type MotivoCorreccion,
} from "@mipiacetpv/bonos";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import { requireOwnerOrCashier } from "../auth/middleware.js";
import { getPrisma } from "../context.js";
import { esSanitarioSinCaja } from "../lib/caja-gate.js";
import {
  calcularCaducidad,
  diaDeCaducidad,
  prolongarCaducidad,
} from "./caducidad.js";
import {
  desmarcarLinea,
  marcarLineaConBono,
  propuestasParaElTicket,
} from "./caja.js";
import { ensureBonosEnabled } from "./gate-tenant.js";
import { bonosQueCubren, consultar, marcarCaducados } from "./gate.js";
import { bonoPorId, libroLegible } from "./lectura.js";
import { escribirLinea } from "./libro.js";
import { codigoDeNumero, normalizarCodigo, siguienteNumero } from "./numero.js";
import { serviciosACubrir } from "./servicios.js";
import { bonoConDinero, bonoSinDinero } from "./vistas.js";

/** El canal de la línea del libro: el mostrador o el panel de la empresa. */
function canalDe(request: FastifyRequest): "tpv" | "panel" {
  return request.cashier ? "tpv" : "panel";
}

export async function registerVoucherRoutes(
  app: FastifyInstance,
): Promise<void> {
  // ══════════════════════════════════════════════════════════════════
  // LA PUERTA, POR CÓDIGO
  // ══════════════════════════════════════════════════════════════════
  //
  // Lo que teclea recepción en el mostrador. Acepta `B87`, `b 87`, `87` y
  // `B-87`: quien lo escribe está leyendo un papel.
  app.get(
    "/bonos/consultar",
    {
      preHandler: [requireOwnerOrCashier, ensureBonosEnabled],
      schema: {
        querystring: {
          type: "object",
          required: ["texto"],
          additionalProperties: false,
          properties: {
            texto: { type: "string", minLength: 1, maxLength: 40 },
            clienteId: { type: "string", format: "uuid" },
            servicioId: { type: "string", format: "uuid" },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const q = request.query as {
        texto: string;
        clienteId?: string;
        servicioId?: string;
      };
      const prisma = getPrisma();
      const ahora = new Date();
      const servicios = q.servicioId
        ? await serviciosACubrir(prisma, auth.tenantId, [q.servicioId])
        : [];
      const res = await consultar(prisma, {
        tenantId: auth.tenantId,
        texto: q.texto,
        clienteId: q.clienteId ?? null,
        servicio: servicios[0] ?? null,
        ahora,
      });
      // El sanitario sin caja ve sesiones y nunca euros. No se oculta en el
      // front: NO SE MANDA.
      const sinDinero = await esSanitarioSinCaja(request);
      return reply.send({
        estado: res.estado,
        // La frase, hecha en el servidor para que el TPV y el panel digan
        // la misma. Vacía con `ok`.
        mensaje: mensajeDeEstado(res.estado),
        // Si esto se arregla en el mostrador o hay que mirarlo. Ordena la
        // pantalla: los primeros salen con la acción al lado.
        seArreglaEnElMomento: seArreglaEnElMomento(res.estado),
        porQueCubre: res.porQueCubre,
        bono: res.bono,
        // El bono con su dinero sólo para quien tiene caja.
        detalle: res.bono
          ? await detalleDelBono(auth.tenantId, res.bono.id, sinDinero, ahora)
          : null,
      });
    },
  );

  // ══════════════════════════════════════════════════════════════════
  // QUÉ BONOS DE ESTA FICHA CUBREN ESTOS SERVICIOS
  // ══════════════════════════════════════════════════════════════════
  //
  // Lo que la agenda pide para ofrecer el bono YA MARCADO al dar la cita.
  // **No elige**: si hay dos, devuelve dos y el front pregunta.
  app.get(
    "/clients/:id/bonos-que-cubren",
    {
      preHandler: [requireOwnerOrCashier, ensureBonosEnabled],
      schema: {
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", format: "uuid" } },
        },
        querystring: {
          type: "object",
          required: ["serviceIds"],
          additionalProperties: false,
          properties: {
            // Lista separada por comas: es un GET y los servicios de una
            // visita son dos o tres.
            serviceIds: { type: "string", minLength: 36, maxLength: 400 },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const { id } = request.params as { id: string };
      const q = request.query as { serviceIds: string };
      const ids = q.serviceIds
        .split(",")
        .map((x) => x.trim())
        .filter((x) => x.length > 0);
      if (ids.length === 0) {
        return reply
          .code(400)
          .send({ error: "SIN_SERVICIOS", message: "Indica al menos un servicio." });
      }
      const prisma = getPrisma();
      const ahora = new Date();
      await marcarCaducados(prisma, auth.tenantId, ahora);
      const servicios = await serviciosACubrir(prisma, auth.tenantId, ids);
      const bonos = await bonosQueCubren(prisma, {
        tenantId: auth.tenantId,
        clientId: id,
        servicios,
        ahora,
      });
      return reply.send({
        // El contrato dice EXPLÍCITAMENTE que puede venir más de uno, y el
        // front tiene que preguntar. Nombrarlo en plural es la mitad de
        // esa garantía; la otra es que el servidor no ordene por nada que
        // parezca una preferencia (va por caducidad y número, que es un
        // orden estable, no una recomendación).
        bonos: bonos.map((b) => ({
          id: b.id,
          code: b.code,
          nombre: b.nombre,
          sesionesLibres: b.sesionesLibres,
          sesionesApartadas: b.sesionesApartadas,
          caducaEl: b.caducaAt ? b.caducaAt.toISOString() : null,
        })),
        // Para que la pantalla sepa que tiene que preguntar sin contar.
        hayQuePreguntar: bonos.length > 1,
      });
    },
  );

  // ══════════════════════════════════════════════════════════════════
  // EL CANJE EN CAJA
  // ══════════════════════════════════════════════════════════════════

  app.get(
    "/tickets/:ticketId/bonos",
    {
      preHandler: [requireOwnerOrCashier, ensureBonosEnabled],
      schema: {
        params: {
          type: "object",
          required: ["ticketId"],
          properties: { ticketId: { type: "string", format: "uuid" } },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const { ticketId } = request.params as { ticketId: string };
      const propuestas = await propuestasParaElTicket(getPrisma(), {
        tenantId: auth.tenantId,
        ticketId,
        ahora: new Date(),
      });
      return reply.send({ propuestas });
    },
  );

  app.post(
    "/tickets/:ticketId/lines/:lineId/bono",
    {
      preHandler: [requireOwnerOrCashier, ensureBonosEnabled],
      schema: {
        params: {
          type: "object",
          required: ["ticketId", "lineId"],
          properties: {
            ticketId: { type: "string", format: "uuid" },
            lineId: { type: "string", format: "uuid" },
          },
        },
        body: {
          type: "object",
          required: ["voucherId"],
          additionalProperties: false,
          properties: { voucherId: { type: "string", format: "uuid" } },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const { ticketId, lineId } = request.params as {
        ticketId: string;
        lineId: string;
      };
      const body = request.body as { voucherId: string };
      const res = await marcarLineaConBono(getPrisma(), {
        tenantId: auth.tenantId,
        ticketId,
        ticketLineId: lineId,
        voucherId: body.voucherId,
        userId: auth.userId,
        canal: canalDe(request),
        ahora: new Date(),
      });
      if (!res.ok) {
        return reply
          .code(res.status)
          .send({ error: res.error, code: res.error, message: res.message });
      }
      return reply.send({
        bono: res.bono,
        importeCents: res.importeCents,
      });
    },
  );

  app.delete(
    "/tickets/:ticketId/lines/:lineId/bono",
    {
      preHandler: [requireOwnerOrCashier, ensureBonosEnabled],
      schema: {
        params: {
          type: "object",
          required: ["ticketId", "lineId"],
          properties: {
            ticketId: { type: "string", format: "uuid" },
            lineId: { type: "string", format: "uuid" },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const { ticketId, lineId } = request.params as {
        ticketId: string;
        lineId: string;
      };
      const res = await desmarcarLinea(getPrisma(), {
        tenantId: auth.tenantId,
        ticketId,
        ticketLineId: lineId,
        userId: auth.userId,
        canal: canalDe(request),
        ahora: new Date(),
      });
      if (!res.ok) {
        return reply
          .code(res.status)
          .send({ error: res.error, code: res.error, message: res.message });
      }
      return reply.send({ ok: true });
    },
  );

  // ══════════════════════════════════════════════════════════════════
  // EL BONO Y SU TRAZA
  // ══════════════════════════════════════════════════════════════════

  app.get(
    "/bonos/:id",
    {
      preHandler: [requireOwnerOrCashier, ensureBonosEnabled],
      schema: {
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", format: "uuid" } },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const { id } = request.params as { id: string };
      const sinDinero = await esSanitarioSinCaja(request);
      const detalle = await detalleDelBono(auth.tenantId, id, sinDinero, new Date());
      if (!detalle) {
        return reply
          .code(404)
          .send({ error: "BONO_NOEXISTE", message: "No existe ese bono." });
      }
      return reply.send(detalle);
    },
  );

  // ══════════════════════════════════════════════════════════════════
  // CORREGIR: SESIONES DE MÁS O DE MENOS
  // ══════════════════════════════════════════════════════════════════
  //
  // Motivo OBLIGATORIO de lista cerrada. Con `otro`, la nota es obligatoria
  // y **sin mínimo de caracteres oculto** (`07` pieza 5: un mínimo
  // escondido bloqueó una invitación real en el spa). Deja una línea en el
  // libro con el antes y el después; nada se edita.
  app.post(
    "/bonos/:id/correcciones",
    {
      preHandler: [requireOwnerOrCashier, ensureBonosEnabled],
      schema: {
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", format: "uuid" } },
        },
        body: {
          type: "object",
          required: ["sesiones", "motivo"],
          additionalProperties: false,
          properties: {
            // ± sesiones. Cero no es una corrección.
            sesiones: { type: "integer", minimum: -100, maximum: 100 },
            motivo: { type: "string", enum: [...MOTIVOS_CORRECCION] },
            nota: { type: "string", maxLength: 300 },
            // La línea que esta compensa, si corrige una concreta.
            compensaA: { type: "string", format: "uuid" },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const { id } = request.params as { id: string };
      const body = request.body as {
        sesiones: number;
        motivo: MotivoCorreccion;
        nota?: string;
        compensaA?: string;
      };
      if (body.sesiones === 0) {
        return reply.code(400).send({
          error: "CORRECCION_DE_CERO",
          message: "Una corrección de cero sesiones no corrige nada.",
        });
      }
      // La nota es obligatoria SÓLO con `otro`, y basta con que no esté
      // vacía: ningún mínimo de caracteres.
      const nota = (body.nota ?? "").trim();
      if (body.motivo === "otro" && nota.length === 0) {
        return reply.code(400).send({
          error: "NOTA_OBLIGATORIA",
          message: "Con el motivo «Otro» hace falta escribir qué pasó.",
        });
      }
      const prisma = getPrisma();
      const ahora = new Date();
      const resultado = await prisma.$transaction(async (tx) => {
        const filas = await tx.$queryRaw<
          Array<{
            id: string;
            code: string;
            sessions_total: number;
            sessions_left: number;
            sessions_reserved: number;
            status: string;
            es_prueba: boolean;
          }>
        >`
          SELECT "id", "code", "sessions_total", "sessions_left",
                 "sessions_reserved", "status", "es_prueba"
            FROM "vouchers"
           WHERE "id" = ${id}::uuid AND "tenant_id" = ${auth.tenantId}::uuid
           FOR UPDATE`;
        const b = filas[0];
        if (!b) return { ok: false as const, error: "BONO_NOEXISTE" as const };
        if (b.status === "ANULADO") return { ok: false as const, error: "BONO_ANULADO" as const };
        // Una línea ya compensada no se vuelve a compensar (`05` §4.2).
        if (body.compensaA) {
          const ya = await tx.$queryRaw<Array<{ uno: number }>>`
            SELECT 1 AS uno
              FROM "voucher_movements"
             WHERE "tenant_id" = ${auth.tenantId}::uuid
               AND "compensa_a" = ${body.compensaA}::uuid
             LIMIT 1`;
          if (ya.length > 0) return { ok: false as const, error: "YA_COMPENSADA" as const };
        }
        const antesTotal = Number(b.sessions_total);
        const antesLibres = Number(b.sessions_left);
        const despuesTotal = antesTotal + body.sesiones;
        const despuesLibres = antesLibres + body.sesiones;
        // Quitar más sesiones de las que quedan LIBRES es dejar el bono en
        // un estado imposible (el CHECK de la base lo rechazaría): se dice
        // qué falta en vez de reventar.
        if (despuesLibres < 0 || despuesTotal < 0) {
          return {
            ok: false as const,
            error: "CORRECCION_IMPOSIBLE" as const,
            libres: antesLibres,
          };
        }
        await tx.$executeRaw`
          UPDATE "vouchers"
             SET "sessions_total" = ${despuesTotal},
                 "sessions_left" = ${despuesLibres},
                 "status" = CASE
                   WHEN ${despuesLibres} = 0 AND "sessions_reserved" = 0
                     THEN 'AGOTADO' ELSE 'ACTIVO'
                 END,
                 "updated_at" = ${ahora}
           WHERE "id" = ${id}::uuid`;
        const signo = body.sesiones > 0 ? "+" : "";
        const movimientoId = await escribirLinea(tx, {
          tenantId: auth.tenantId,
          voucherId: id,
          tipo: "CORRECCION",
          sesiones: body.sesiones,
          compensaA: body.compensaA ?? null,
          // El ANTES y el DESPUÉS en el `detalle`, que es lo que lee
          // recepción. Y la nota detrás, cuando la hay.
          detalle:
            `Corrección ${signo}${body.sesiones} ${
              Math.abs(body.sesiones) === 1 ? "sesión" : "sesiones"
            }: ` +
            `de ${antesTotal} a ${despuesTotal} en total, de ${antesLibres} a ${despuesLibres} libres.` +
            (nota.length > 0 ? ` ${nota}` : ""),
          motivo: body.motivo,
          canal: canalDe(request),
          userId: auth.userId,
          esPrueba: b.es_prueba,
          createdAt: ahora,
        });
        return { ok: true as const, movimientoId, code: b.code };
      });
      if (!resultado.ok) {
        return reply.code(resultado.error === "BONO_NOEXISTE" ? 404 : 409).send({
          error: resultado.error,
          code: resultado.error,
          message: mensajeDeCorreccion(resultado),
        });
      }
      const sinDinero = await esSanitarioSinCaja(request);
      return reply.send({
        movimientoId: resultado.movimientoId,
        bono: await detalleDelBono(auth.tenantId, id, sinDinero, new Date()),
      });
    },
  );

  // ══════════════════════════════════════════════════════════════════
  // PROLONGAR LA CADUCIDAD
  // ══════════════════════════════════════════════════════════════════
  //
  // Lo puede hacer el encargado, con motivo, y queda en el libro. **Lo
  // caducado no se borra**: sigue en la ficha con su línea.
  app.post(
    "/bonos/:id/caducidad",
    {
      preHandler: [requireOwnerOrCashier, ensureBonosEnabled],
      schema: {
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", format: "uuid" } },
        },
        body: {
          type: "object",
          required: ["mesesMas", "motivo"],
          additionalProperties: false,
          properties: {
            // Meses de CALENDARIO, no días (`07` pieza 18).
            mesesMas: { type: "integer", minimum: 1, maximum: 120 },
            motivo: { type: "string", enum: [...MOTIVOS_CORRECCION] },
            nota: { type: "string", maxLength: 300 },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const { id } = request.params as { id: string };
      const body = request.body as {
        mesesMas: number;
        motivo: MotivoCorreccion;
        nota?: string;
      };
      const nota = (body.nota ?? "").trim();
      if (body.motivo === "otro" && nota.length === 0) {
        return reply.code(400).send({
          error: "NOTA_OBLIGATORIA",
          message: "Con el motivo «Otro» hace falta escribir qué pasó.",
        });
      }
      const prisma = getPrisma();
      const ahora = new Date();
      const resultado = await prisma.$transaction(async (tx) => {
        const filas = await tx.$queryRaw<
          Array<{
            id: string;
            code: string;
            expires_at: Date | null;
            status: string;
            es_prueba: boolean;
            sessions_left: number;
            sessions_reserved: number;
          }>
        >`
          SELECT "id", "code", "expires_at", "status", "es_prueba",
                 "sessions_left", "sessions_reserved"
            FROM "vouchers"
           WHERE "id" = ${id}::uuid AND "tenant_id" = ${auth.tenantId}::uuid
           FOR UPDATE`;
        const b = filas[0];
        if (!b) return { ok: false as const, error: "BONO_NOEXISTE" as const };
        if (b.status === "ANULADO") return { ok: false as const, error: "BONO_ANULADO" as const };
        const nueva = prolongarCaducidad(b.expires_at, body.mesesMas, ahora);
        // Un bono CADUCADO que se prolonga vuelve a estar vivo. Y uno
        // AGOTADO sigue agotado: prolongar no regala sesiones.
        const nuevoStatus =
          Number(b.sessions_left) === 0 && Number(b.sessions_reserved) === 0
            ? "AGOTADO"
            : "ACTIVO";
        await tx.$executeRaw`
          UPDATE "vouchers"
             SET "expires_at" = ${nueva},
                 "status" = ${nuevoStatus},
                 "updated_at" = ${ahora}
           WHERE "id" = ${id}::uuid`;
        const movimientoId = await escribirLinea(tx, {
          tenantId: auth.tenantId,
          voucherId: id,
          tipo: "CADUCIDAD_CAMBIADA",
          sesiones: 0,
          detalle:
            `Caducidad prolongada ${body.mesesMas} ${
              body.mesesMas === 1 ? "mes" : "meses"
            }: ` +
            `de ${diaDeCaducidad(b.expires_at) ?? "sin caducidad"} a ${diaDeCaducidad(nueva)}.` +
            (nota.length > 0 ? ` ${nota}` : ""),
          motivo: body.motivo,
          canal: canalDe(request),
          userId: auth.userId,
          esPrueba: b.es_prueba,
          createdAt: ahora,
        });
        return { ok: true as const, movimientoId };
      });
      if (!resultado.ok) {
        return reply.code(resultado.error === "BONO_NOEXISTE" ? 404 : 409).send({
          error: resultado.error,
          code: resultado.error,
          message: mensajeDeCorreccion(resultado),
        });
      }
      const sinDinero = await esSanitarioSinCaja(request);
      return reply.send({
        movimientoId: resultado.movimientoId,
        bono: await detalleDelBono(auth.tenantId, id, sinDinero, new Date()),
      });
    },
  );

  // ══════════════════════════════════════════════════════════════════
  // ALTA INICIAL: EL BONO DE PAPEL
  // ══════════════════════════════════════════════════════════════════
  //
  // Los centros que vienen de papel traen bonos a medio gastar. Se dan de
  // alta a mano con su SALDO (lo que queda, no lo que se vendió), su número
  // del papel y su caducidad si la tiene. **Sin ticket de venta**: no se
  // inventa un cobro que no pasó por esta caja —y por eso `cobrado_cents`
  // es 0 y el libro lo dice con una línea `ALTA_INICIAL`.
  app.post(
    "/bonos/alta-inicial",
    {
      preHandler: [requireOwnerOrCashier, ensureBonosEnabled],
      schema: {
        body: {
          type: "object",
          required: ["clientId", "nombre", "sesiones"],
          additionalProperties: false,
          properties: {
            clientId: { type: "string", format: "uuid" },
            nombre: { type: "string", minLength: 1, maxLength: 120 },
            // LO QUE QUEDA, no lo que se vendió: el papel viene a medias.
            sesiones: { type: "integer", minimum: 1, maximum: 100 },
            // De una plantilla del catálogo (y entonces hereda su
            // cobertura) o a mano con servicios/categorías.
            templateId: { type: "string", format: "uuid" },
            coversServiceIds: {
              type: "array",
              maxItems: 50,
              items: { type: "string", format: "uuid" },
            },
            coversTagSlugs: {
              type: "array",
              maxItems: 50,
              items: { type: "string", minLength: 1, maxLength: 60 },
            },
            // El NÚMERO DEL PAPEL. Si viene, manda: el centro sigue su
            // talonario. Se acepta `B87`, `b 87` o `87`.
            codigo: { type: "string", minLength: 1, maxLength: 40 },
            // Meses de calendario desde hoy, o nada.
            caducidadMeses: { type: "integer", minimum: 1, maximum: 120 },
            valorCartaCents: { type: "integer", minimum: 0, maximum: 10_000_000 },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const body = request.body as {
        clientId: string;
        nombre: string;
        sesiones: number;
        templateId?: string;
        coversServiceIds?: string[];
        coversTagSlugs?: string[];
        codigo?: string;
        caducidadMeses?: number;
        valorCartaCents?: number;
      };
      const prisma = getPrisma();
      const ahora = new Date();
      const resultado = await prisma.$transaction(async (tx) => {
        const cliente = await tx.client.findFirst({
          where: { id: body.clientId, tenantId: auth.tenantId },
          select: { id: true },
        });
        if (!cliente) return { ok: false as const, error: "CLIENTE_NOEXISTE" as const };

        // La cobertura: de la plantilla, o la que venga a mano.
        let coversServiceIds = body.coversServiceIds ?? [];
        let coversTagSlugs = body.coversTagSlugs ?? [];
        let caducidadMeses = body.caducidadMeses ?? null;
        if (body.templateId) {
          const t = await tx.voucherTemplate.findFirst({
            where: { id: body.templateId, tenantId: auth.tenantId },
            select: {
              coversServiceIds: true,
              coversTagSlugs: true,
              expiresMonths: true,
            },
          });
          if (!t) return { ok: false as const, error: "PLANTILLA_NOEXISTE" as const };
          coversServiceIds = t.coversServiceIds;
          coversTagSlugs = t.coversTagSlugs;
          caducidadMeses = body.caducidadMeses ?? t.expiresMonths ?? null;
        }
        if (coversServiceIds.length === 0 && coversTagSlugs.length === 0) {
          return { ok: false as const, error: "SIN_COBERTURA" as const };
        }

        // El número. Si el centro trae el del papel, manda ése; si no, el
        // contador —que puede estar con el candado puesto.
        let numero: number;
        let code: string;
        if (body.codigo) {
          const n = normalizarCodigo(body.codigo);
          if (n == null) return { ok: false as const, error: "CODIGO_ILEGIBLE" as const };
          numero = n;
          code = codigoDeNumero(n);
          const choque = await tx.$queryRaw<Array<{ uno: number }>>`
            SELECT 1 AS uno FROM "vouchers"
             WHERE "tenant_id" = ${auth.tenantId}::uuid
               AND ("number" = ${numero} OR "code" = ${code})
             LIMIT 1`;
          if (choque.length > 0) return { ok: false as const, error: "CODIGO_OCUPADO" as const };
        } else {
          const n = await siguienteNumero(tx, auth.tenantId);
          if (!n.ok) return { ok: false as const, error: "CANDADO_SIN_CONFIRMAR" as const };
          numero = n.numero;
          code = n.code;
        }

        // Un alta inicial de una cuenta EN ENSAYO es de prueba, igual que
        // una venta: el reseteo se la lleva.
        const tenant = await tx.tenant.findUniqueOrThrow({
          where: { id: auth.tenantId },
          select: { facturaDesde: true },
        });
        const esPrueba = tenant.facturaDesde == null;
        const expiresAt = calcularCaducidad(ahora, caducidadMeses);
        const filas = await tx.$queryRaw<Array<{ id: string }>>`
          INSERT INTO "vouchers"
            ("id", "tenant_id", "client_id", "code", "number", "template_id",
             "type", "sessions_total", "sessions_left", "sessions_reserved",
             "covers_service_ids", "covers_tag_slugs", "name_snapshot",
             "valor_carta_cents", "cobrado_cents", "sold_ticket_id",
             "sold_ticket_line_id", "expires_at", "status", "origen",
             "es_prueba", "created_at", "updated_at")
          VALUES
            (gen_random_uuid(), ${auth.tenantId}::uuid, ${body.clientId}::uuid,
             ${code}, ${numero}, ${body.templateId ?? null}::uuid,
             'SESSIONS', ${body.sesiones}, ${body.sesiones}, 0,
             ${coversServiceIds}::uuid[], ${coversTagSlugs}::text[],
             ${body.nombre.trim()},
             ${body.valorCartaCents ?? 0}, 0,
             NULL, NULL, ${expiresAt}, 'ACTIVO', 'ALTA_INICIAL',
             ${esPrueba}, ${ahora}, ${ahora})
          RETURNING "id"`;
        const voucherId = filas[0]!.id;
        await escribirLinea(tx, {
          tenantId: auth.tenantId,
          voucherId,
          tipo: "ALTA_INICIAL",
          sesiones: body.sesiones,
          detalle:
            `Alta inicial · ${body.nombre.trim()} · ${code} · ` +
            `${body.sesiones} ${body.sesiones === 1 ? "sesión" : "sesiones"} que quedaban del papel.`,
          canal: canalDe(request),
          userId: auth.userId,
          esPrueba,
          createdAt: ahora,
        });
        return { ok: true as const, voucherId, code };
      });
      if (!resultado.ok) {
        return reply.code(statusDelAlta(resultado.error)).send({
          error: resultado.error,
          code: resultado.error,
          message: mensajeDelAlta(resultado.error),
        });
      }
      const sinDinero = await esSanitarioSinCaja(request);
      return reply.code(201).send({
        bono: await detalleDelBono(
          auth.tenantId,
          resultado.voucherId,
          sinDinero,
          new Date(),
        ),
      });
    },
  );
}

// ══════════════════════════════════════════════════════════════════════
// PIEZAS COMPARTIDAS
// ══════════════════════════════════════════════════════════════════════

/**
 * El bono, su traza y si se puede devolver.
 *
 * `sinDinero` es la vista del sanitario sin caja: **no se ocultan los
 * importes, no se construyen**. Ver `vistas.ts`.
 */
async function detalleDelBono(
  tenantId: string,
  voucherId: string,
  sinDinero: boolean,
  ahora: Date,
) {
  const prisma = getPrisma();
  const fila = await bonoPorId(prisma, tenantId, voucherId, ahora);
  if (!fila) return null;
  const libro = await libroLegible(prisma, tenantId, voucherId);
  const vista = sinDinero ? bonoSinDinero(fila) : bonoConDinero(fila);
  // El «por qué no se puede devolver», con LA MISMA función que el botón
  // del TPV. Las sesiones se cuentan del libro, que es lo que manda.
  const consumidas = libro.filter((l) => l.tipo === "CONSUMIDA").length;
  const apartadas =
    libro.filter((l) => l.tipo === "APARTADA").length -
    libro.filter((l) => l.tipo === "LIBERADA").length -
    libro.filter((l) => l.tipo === "CONSUMIDA" && l.appointmentId != null).length;
  return {
    bono: vista,
    traza: libro,
    noDevolvible: porQueNoDevolvible({
      status: fila.status,
      sesionesConsumidas: consumidas,
      sesionesApartadas: apartadas,
      tieneVenta: fila.soldTicketId != null,
    }),
  };
}

function mensajeDeCorreccion(r: {
  error: string;
  libres?: number;
}): string {
  switch (r.error) {
    case "BONO_NOEXISTE":
      return "No existe ese bono en este negocio.";
    case "BONO_ANULADO":
      return "Ese bono se anuló al devolver su venta: ya no se corrige.";
    case "YA_COMPENSADA":
      return "Esa línea del libro ya está compensada: no se compensa dos veces.";
    case "CORRECCION_IMPOSIBLE":
      return `No se pueden quitar más sesiones de las que quedan libres (${r.libres ?? 0}). Libera las apartadas anulando sus citas.`;
    default:
      return "No se pudo corregir el bono.";
  }
}

function statusDelAlta(error: string): number {
  if (error === "CLIENTE_NOEXISTE" || error === "PLANTILLA_NOEXISTE") return 404;
  if (error === "CODIGO_ILEGIBLE" || error === "SIN_COBERTURA") return 400;
  return 409;
}

function mensajeDelAlta(error: string): string {
  switch (error) {
    case "CLIENTE_NOEXISTE":
      return "No existe esa ficha en este negocio.";
    case "PLANTILLA_NOEXISTE":
      return "No existe esa plantilla de bono.";
    case "SIN_COBERTURA":
      return "Un bono tiene que valer para algo: elige servicios, categorías, o una plantilla del catálogo.";
    case "CODIGO_ILEGIBLE":
      return "Ese número no se entiende. Escribe el número del papel (por ejemplo B87, o 87).";
    case "CODIGO_OCUPADO":
      return "Ya hay un bono con ese número en este negocio. Mira el papel y comprueba el número.";
    case "CANDADO_SIN_CONFIRMAR":
      return "Este negocio todavía no ha confirmado por qué número empieza su numeración de bonos. Hazlo en Ajustes, o escribe aquí el número del papel.";
    default:
      return "No se pudo dar de alta el bono.";
  }
}
