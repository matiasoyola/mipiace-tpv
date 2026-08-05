// Endpoints del CRM / ficha de cliente (B-koibox-1).
//
//   GET   /clients?query=&sort=az&cursor=  — búsqueda A–Z por nombre/
//                                            teléfono/email, paginado.
//   POST  /clients                         — alta (idempotente por
//                                            externalId para el outbox).
//   GET   /clients/:id                     — ficha completa (+ consents,
//                                            + ficha técnica).
//   PATCH /clients/:id                     — edición.
//   GET   /clients/:id/history             — historial unificado: compras
//                                            (tickets del contacto Holded)
//                                            + citas (vacío hasta B4) +
//                                            movimientos de bono (vacío
//                                            hasta B5), contrato estable.
//   GET   /clients/:id/vouchers            — saldo de bonos (vacío hasta
//                                            B5, contrato estable).
//   POST  /clients/:id/consents            — alta manual de consentimiento
//                                            RGPD (firma digital = fase 2).
//   POST  /clients/:id/technical-notes     — alta de ficha técnica por
//                                            servicio.
//
// ADR-K2: el CRM es LOCAL, fuente de verdad propia. `holdedContactId` es
// sólo un enlace fiscal perezoso — aquí NUNCA se crea contacto en Holded
// ni se vuelca historial / ficha técnica / RGPD. El enlace lo rellena el
// camino de cobro existente cuando hace falta factura (ADR-010, intacto).
//
// Aislamiento por fila: toda query filtra por `auth.tenantId`. Las tablas
// hijas (consents, ficha técnica) se acceden SIEMPRE a través de un
// cliente previamente validado como perteneciente al tenant.

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ClientConsentKind, type Prisma } from "@mipiacetpv/db";

import { requireOwnerOrCashier } from "../auth/middleware.js";
import { getPrisma } from "../context.js";

// Vista pública de un cliente para el TPV. No incluye `raw` ni metadatos
// internos; el front cachea esto en Dexie para la búsqueda offline.
function toClientView(c: {
  id: string;
  externalId: string | null;
  firstName: string;
  lastName: string;
  phone: string | null;
  email: string | null;
  birthdate: Date | null;
  holdedContactId: string | null;
  marketingOptIn: boolean;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: c.id,
    externalId: c.externalId,
    firstName: c.firstName,
    lastName: c.lastName,
    phone: c.phone,
    email: c.email,
    // Sólo la fecha (YYYY-MM-DD); el campo es @db.Date.
    birthdate: c.birthdate ? c.birthdate.toISOString().slice(0, 10) : null,
    holdedContactId: c.holdedContactId,
    marketingOptIn: c.marketingOptIn,
    notes: c.notes,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

const CLIENT_SELECT = {
  id: true,
  externalId: true,
  firstName: true,
  lastName: true,
  phone: true,
  email: true,
  birthdate: true,
  holdedContactId: true,
  marketingOptIn: true,
  notes: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ClientSelect;

// Carga un cliente validando que pertenece al tenant del actor. Devuelve
// null (→ 404 en el handler) si no existe o es de otro tenant. Es la
// puerta de aislamiento para todas las operaciones sobre hijas.
async function loadOwnedClient(tenantId: string, id: string) {
  const prisma = getPrisma();
  return prisma.client.findFirst({
    where: { id, tenantId },
    select: CLIENT_SELECT,
  });
}

function notFound(reply: FastifyReply) {
  return reply.code(404).send({
    error: "CLIENT_NOT_FOUND",
    message: "Cliente no encontrado.",
  });
}

export async function registerCrmRoutes(app: FastifyInstance): Promise<void> {
  // ── Lista / búsqueda A–Z ────────────────────────────────────────────
  app.get(
    "/clients",
    {
      preHandler: requireOwnerOrCashier,
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            query: { type: "string", maxLength: 120 },
            sort: { type: "string", enum: ["az"] },
            cursor: { type: "string", format: "uuid" },
            limit: { type: "integer", minimum: 1, maximum: 200 },
          },
        },
      },
    },
    async (request: FastifyRequest) => {
      const auth = request.auth!;
      const q = request.query as {
        query?: string;
        sort?: "az";
        cursor?: string;
        limit?: number;
      };
      const prisma = getPrisma();
      const limit = q.limit ?? 50;
      const trimmed = (q.query ?? "").trim();

      const where: Prisma.ClientWhereInput = { tenantId: auth.tenantId };
      if (trimmed.length > 0) {
        where.OR = [
          { firstName: { contains: trimmed, mode: "insensitive" } },
          { lastName: { contains: trimmed, mode: "insensitive" } },
          { phone: { contains: trimmed, mode: "insensitive" } },
          { email: { contains: trimmed, mode: "insensitive" } },
        ];
      }

      const rows = await prisma.client.findMany({
        where,
        // A–Z estable: apellido, nombre y desempate por id (cursor).
        orderBy: [{ lastName: "asc" }, { firstName: "asc" }, { id: "asc" }],
        take: limit + 1,
        ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
        select: CLIENT_SELECT,
      });
      const hasMore = rows.length > limit;
      const page = hasMore ? rows.slice(0, limit) : rows;
      return {
        items: page.map(toClientView),
        nextCursor: hasMore ? page[page.length - 1]!.id : null,
      };
    },
  );

  // ── Alta ────────────────────────────────────────────────────────────
  app.post(
    "/clients",
    {
      preHandler: requireOwnerOrCashier,
      schema: {
        body: {
          type: "object",
          required: ["firstName", "lastName"],
          additionalProperties: false,
          properties: {
            // Idempotencia del alta offline (outbox). Si ya existe un
            // cliente con este externalId en el tenant, se devuelve tal
            // cual (200) en vez de duplicar.
            externalId: { type: "string", format: "uuid" },
            firstName: { type: "string", minLength: 1, maxLength: 120 },
            lastName: { type: "string", minLength: 1, maxLength: 120 },
            phone: { type: "string", maxLength: 32 },
            email: { type: "string", maxLength: 320 },
            // YYYY-MM-DD (@db.Date).
            birthdate: { type: "string", format: "date" },
            holdedContactId: { type: "string", maxLength: 64 },
            marketingOptIn: { type: "boolean" },
            notes: { type: "string", maxLength: 2000 },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const body = request.body as {
        externalId?: string;
        firstName: string;
        lastName: string;
        phone?: string;
        email?: string;
        birthdate?: string;
        holdedContactId?: string;
        marketingOptIn?: boolean;
        notes?: string;
      };
      const prisma = getPrisma();

      // Idempotencia: si el outbox reintenta el alta, no dupliques.
      if (body.externalId) {
        const existing = await prisma.client.findFirst({
          where: { tenantId: auth.tenantId, externalId: body.externalId },
          select: CLIENT_SELECT,
        });
        if (existing) {
          return reply
            .code(200)
            .send({ client: toClientView(existing), duplicate: true });
        }
      }

      // Aviso de teléfono duplicado (no bloqueante — familias comparten
      // número; ADR-K2 no impone unicidad de teléfono). El front decide
      // si mostrar el aviso.
      let phoneWarning: Array<{ id: string; name: string }> | null = null;
      const phone = body.phone?.trim();
      if (phone) {
        const dups = await prisma.client.findMany({
          where: { tenantId: auth.tenantId, phone },
          select: { id: true, firstName: true, lastName: true },
          take: 5,
        });
        if (dups.length > 0) {
          phoneWarning = dups.map((d) => ({
            id: d.id,
            name: `${d.firstName} ${d.lastName}`.trim(),
          }));
        }
      }

      const created = await prisma.client.create({
        data: {
          tenantId: auth.tenantId,
          externalId: body.externalId ?? null,
          firstName: body.firstName.trim(),
          lastName: body.lastName.trim(),
          phone: phone || null,
          email: body.email?.trim() || null,
          birthdate: body.birthdate ? new Date(body.birthdate) : null,
          holdedContactId: body.holdedContactId?.trim() || null,
          marketingOptIn: body.marketingOptIn ?? false,
          notes: body.notes?.trim() || null,
        },
        select: CLIENT_SELECT,
      });
      return reply.code(201).send({
        client: toClientView(created),
        ...(phoneWarning ? { phoneWarning } : {}),
      });
    },
  );

  // ── Ficha completa ──────────────────────────────────────────────────
  app.get(
    "/clients/:id",
    { preHandler: requireOwnerOrCashier },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const { id } = request.params as { id: string };
      const client = await loadOwnedClient(auth.tenantId, id);
      if (!client) return notFound(reply);
      const prisma = getPrisma();
      const [consents, technicalNotes] = await Promise.all([
        prisma.clientConsent.findMany({
          where: { clientId: id, tenantId: auth.tenantId },
          orderBy: { grantedAt: "desc" },
          select: { id: true, kind: true, grantedAt: true, docRef: true },
        }),
        prisma.clientTechnicalNote.findMany({
          where: { clientId: id, tenantId: auth.tenantId },
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            serviceId: true,
            body: true,
            createdByUserId: true,
            createdAt: true,
          },
        }),
      ]);
      return {
        client: toClientView(client),
        consents: consents.map((c) => ({
          id: c.id,
          kind: c.kind,
          grantedAt: c.grantedAt.toISOString(),
          docRef: c.docRef,
        })),
        technicalNotes: technicalNotes.map((n) => ({
          id: n.id,
          serviceId: n.serviceId,
          body: n.body,
          createdByUserId: n.createdByUserId,
          createdAt: n.createdAt.toISOString(),
        })),
      };
    },
  );

  // ── Edición ─────────────────────────────────────────────────────────
  app.patch(
    "/clients/:id",
    {
      preHandler: requireOwnerOrCashier,
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          properties: {
            firstName: { type: "string", minLength: 1, maxLength: 120 },
            lastName: { type: "string", minLength: 1, maxLength: 120 },
            phone: { type: ["string", "null"], maxLength: 32 },
            email: { type: ["string", "null"], maxLength: 320 },
            birthdate: { type: ["string", "null"], format: "date" },
            holdedContactId: { type: ["string", "null"], maxLength: 64 },
            marketingOptIn: { type: "boolean" },
            notes: { type: ["string", "null"], maxLength: 2000 },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const { id } = request.params as { id: string };
      const body = request.body as {
        firstName?: string;
        lastName?: string;
        phone?: string | null;
        email?: string | null;
        birthdate?: string | null;
        holdedContactId?: string | null;
        marketingOptIn?: boolean;
        notes?: string | null;
      };
      const existing = await loadOwnedClient(auth.tenantId, id);
      if (!existing) return notFound(reply);
      const prisma = getPrisma();

      const data: Prisma.ClientUpdateInput = {};
      if (body.firstName !== undefined) data.firstName = body.firstName.trim();
      if (body.lastName !== undefined) data.lastName = body.lastName.trim();
      if (body.phone !== undefined) data.phone = body.phone?.trim() || null;
      if (body.email !== undefined) data.email = body.email?.trim() || null;
      if (body.birthdate !== undefined)
        data.birthdate = body.birthdate ? new Date(body.birthdate) : null;
      if (body.holdedContactId !== undefined)
        data.holdedContactId = body.holdedContactId?.trim() || null;
      if (body.marketingOptIn !== undefined)
        data.marketingOptIn = body.marketingOptIn;
      if (body.notes !== undefined) data.notes = body.notes?.trim() || null;

      const updated = await prisma.client.update({
        where: { id },
        data,
        select: CLIENT_SELECT,
      });
      return { client: toClientView(updated) };
    },
  );

  // ── Historial unificado ─────────────────────────────────────────────
  // Compras (tickets del contacto Holded enlazado) + citas (vacío hasta
  // B4) + movimientos de bono (vacío hasta B5). Array único ordenado por
  // fecha desc, cada entrada con `kind` para que B4/B5 añadan sus tipos
  // sin romper el contrato del front. Cada entrada es trazable a su
  // origen (ticketId / internalNumber) — principio UX de auditabilidad.
  app.get(
    "/clients/:id/history",
    { preHandler: requireOwnerOrCashier },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const { id } = request.params as { id: string };
      const client = await loadOwnedClient(auth.tenantId, id);
      if (!client) return notFound(reply);
      const prisma = getPrisma();

      const purchases = client.holdedContactId
        ? await prisma.ticket.findMany({
            where: {
              tenantId: auth.tenantId,
              contactHoldedId: client.holdedContactId,
              status: { in: ["PAID", "PENDING_SYNC", "SYNCED", "SYNC_FAILED"] },
            },
            orderBy: { createdAt: "desc" },
            take: 100,
            select: {
              id: true,
              internalNumber: true,
              total: true,
              status: true,
              holdedDocNumber: true,
              createdAt: true,
              paidAt: true,
            },
          })
        : [];

      const entries = purchases.map((t) => ({
        kind: "PURCHASE" as const,
        id: t.id,
        at: (t.paidAt ?? t.createdAt).toISOString(),
        // Trazabilidad al origen.
        ticketId: t.id,
        internalNumber: t.internalNumber,
        holdedDocNumber: t.holdedDocNumber,
        status: t.status,
        total: Number(t.total),
      }));

      return {
        // Array unificado; hoy sólo compras. B4 añade entradas
        // `kind:"APPOINTMENT"` y B5 `kind:"VOUCHER_MOVEMENT"`.
        entries,
        // Contratos estables vacíos para que B4/B5 los rellenen sin tocar
        // el front (que ya itera `entries`).
        appointments: [] as unknown[],
        voucherMovements: [] as unknown[],
      };
    },
  );

  // ── Saldo de bonos (contrato estable, vacío hasta B5) ───────────────
  app.get(
    "/clients/:id/vouchers",
    { preHandler: requireOwnerOrCashier },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const { id } = request.params as { id: string };
      const client = await loadOwnedClient(auth.tenantId, id);
      if (!client) return notFound(reply);
      return {
        // Saldo agregado. B5 lo rellena; el front ya pinta "0" / vacío.
        balance: { sessionsLeft: 0, amountLeftCents: 0 },
        vouchers: [] as unknown[],
      };
    },
  );

  // ── Alta manual de consentimiento RGPD ──────────────────────────────
  app.post(
    "/clients/:id/consents",
    {
      preHandler: requireOwnerOrCashier,
      schema: {
        body: {
          type: "object",
          required: ["kind"],
          additionalProperties: false,
          properties: {
            kind: { type: "string", enum: ["DATA", "TREATMENT"] },
            docRef: { type: "string", maxLength: 500 },
            grantedAt: { type: "string", format: "date-time" },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const { id } = request.params as { id: string };
      const body = request.body as {
        kind: "DATA" | "TREATMENT";
        docRef?: string;
        grantedAt?: string;
      };
      const client = await loadOwnedClient(auth.tenantId, id);
      if (!client) return notFound(reply);
      const prisma = getPrisma();
      const consent = await prisma.clientConsent.create({
        data: {
          tenantId: auth.tenantId,
          clientId: id,
          kind: ClientConsentKind[body.kind],
          docRef: body.docRef?.trim() || null,
          ...(body.grantedAt ? { grantedAt: new Date(body.grantedAt) } : {}),
        },
        select: { id: true, kind: true, grantedAt: true, docRef: true },
      });
      return reply.code(201).send({
        consent: {
          id: consent.id,
          kind: consent.kind,
          grantedAt: consent.grantedAt.toISOString(),
          docRef: consent.docRef,
        },
      });
    },
  );

  // ── Alta de ficha técnica por servicio ──────────────────────────────
  app.post(
    "/clients/:id/technical-notes",
    {
      preHandler: requireOwnerOrCashier,
      schema: {
        body: {
          type: "object",
          required: ["body"],
          additionalProperties: false,
          properties: {
            // id de servicio de Holded (no FK dura). Opcional: una nota
            // general no tiene servicio asociado.
            serviceId: { type: "string", maxLength: 64 },
            body: { type: "string", minLength: 1, maxLength: 4000 },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const { id } = request.params as { id: string };
      const body = request.body as { serviceId?: string; body: string };
      const client = await loadOwnedClient(auth.tenantId, id);
      if (!client) return notFound(reply);
      const prisma = getPrisma();
      const note = await prisma.clientTechnicalNote.create({
        data: {
          tenantId: auth.tenantId,
          clientId: id,
          serviceId: body.serviceId?.trim() || null,
          body: body.body.trim(),
          createdByUserId: auth.userId,
        },
        select: {
          id: true,
          serviceId: true,
          body: true,
          createdByUserId: true,
          createdAt: true,
        },
      });
      return reply.code(201).send({
        technicalNote: {
          id: note.id,
          serviceId: note.serviceId,
          body: note.body,
          createdByUserId: note.createdByUserId,
          createdAt: note.createdAt.toISOString(),
        },
      });
    },
  );
}
