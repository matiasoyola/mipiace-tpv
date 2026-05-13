// Endpoints de contactos (B2 §3).
//
//   GET  /contacts/search?q=<query>   — busca primero en BD local; si
//                                       vacío Y la query parece teléfono,
//                                       llama a Holded como fallback y
//                                       upserta lo que llega.
//   POST /contacts                    — crea contacto on-the-fly desde el
//                                       TPV. Llama a Holded con GET-back
//                                       (ADR-010). Upserta local.
//
// Limitación de la API de Holded (verificada en doc oficial,
// developers.holded.com): el listado `GET /invoicing/v1/contacts` SÓLO
// acepta filtros `phone`, `mobile` y `customId`. No hay query param
// para nombre, email o NIF. Por eso la búsqueda libre se resuelve
// localmente y el fallback a Holded sólo aplica para teléfonos.
// Ver `docs/spike-holded.md` §10 para el findings.

import type { FastifyInstance } from "fastify";

import {
  ApiKeyClient,
  HoldedApiError,
  HoldedInvalidResponseError,
  HoldedSilentRejectError,
  createContactWithGetBack,
  listContactsByPhone,
  type CreateContactBody,
  type HoldedContact,
} from "@mipiacetpv/holded-client";

import { requireOwnerOrCashier } from "../auth/middleware.js";
import { getPrisma } from "../context.js";
import { decryptSecret } from "../crypto.js";
import { loadEnv } from "../env.js";

// Heurística simple: dígitos + opcional `+`, espacios o guiones, al
// menos 6 dígitos en total. Suficiente para distinguir un teléfono
// de un nombre o un email.
function looksLikePhone(q: string): boolean {
  if (q.length === 0) return false;
  const digits = q.replace(/\D/g, "");
  if (digits.length < 6) return false;
  return /^[+\d\s.-]+$/.test(q);
}

async function buildHoldedClient(tenantId: string): Promise<ApiKeyClient | null> {
  const prisma = getPrisma();
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { holdedApiKeyCiphertext: true },
  });
  if (!tenant?.holdedApiKeyCiphertext) return null;
  const env = loadEnv();
  const apiKey = decryptSecret(tenant.holdedApiKeyCiphertext, env.HOLDED_KEY_ENCRYPTION_SECRET);
  return new ApiKeyClient(apiKey, { baseUrl: env.HOLDED_BASE_URL });
}

function pickString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

async function upsertHoldedContact(
  tenantId: string,
  remote: HoldedContact,
): Promise<{ id: string; tenantId: string; holdedContactId: string; name: string; nif: string | null; email: string | null; phone: string | null }> {
  const prisma = getPrisma();
  const name = pickString(remote.name) ?? "(sin nombre)";
  const nif = pickString(remote.code);
  const email = pickString(remote.email);
  const phone = pickString(remote.phone) ?? pickString(remote.mobile);
  return prisma.contact.upsert({
    where: { tenantId_holdedContactId: { tenantId, holdedContactId: remote.id } },
    create: {
      tenantId,
      holdedContactId: remote.id,
      name,
      nif,
      email,
      phone,
      raw: remote as unknown as object,
    },
    update: {
      name,
      nif,
      email,
      phone,
      raw: remote as unknown as object,
      lastSyncedAt: new Date(),
    },
    select: {
      id: true,
      tenantId: true,
      holdedContactId: true,
      name: true,
      nif: true,
      email: true,
      phone: true,
    },
  });
}

export async function registerContactsRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/contacts/search",
    {
      preHandler: requireOwnerOrCashier,
      schema: {
        querystring: {
          type: "object",
          required: ["q"],
          additionalProperties: false,
          properties: { q: { type: "string", minLength: 1, maxLength: 120 } },
        },
      },
    },
    async (request, reply) => {
      const auth = request.auth!;
      const { q } = request.query as { q: string };
      const prisma = getPrisma();
      const trimmed = q.trim();

      // BD local: LIKE por name/email/nif/phone. Limitamos a 25
      // resultados — el front filtra incremental conforme escribe.
      const local = await prisma.contact.findMany({
        where: {
          tenantId: auth.tenantId,
          OR: [
            { name: { contains: trimmed, mode: "insensitive" } },
            { email: { contains: trimmed, mode: "insensitive" } },
            { nif: { contains: trimmed, mode: "insensitive" } },
            { phone: { contains: trimmed, mode: "insensitive" } },
          ],
        },
        take: 25,
        orderBy: { name: "asc" },
        select: {
          id: true,
          holdedContactId: true,
          name: true,
          nif: true,
          email: true,
          phone: true,
        },
      });

      if (local.length > 0) {
        return { results: local, source: "local", holdedFallback: null };
      }

      // Local vacío. Sólo intentamos fallback a Holded si la query
      // parece un teléfono (único filtro server-side soportado).
      if (!looksLikePhone(trimmed)) {
        return {
          results: [],
          source: "local",
          holdedFallback: "name_search_not_supported",
        };
      }

      const client = await buildHoldedClient(auth.tenantId);
      if (!client) {
        return {
          results: [],
          source: "local",
          holdedFallback: "no_holded_key",
        };
      }

      try {
        const remote = await listContactsByPhone(client, trimmed);
        const upserted = [];
        for (const r of remote) {
          if (typeof r.id !== "string") continue;
          const row = await upsertHoldedContact(auth.tenantId, r);
          upserted.push({
            id: row.id,
            holdedContactId: row.holdedContactId,
            name: row.name,
            nif: row.nif,
            email: row.email,
            phone: row.phone,
          });
        }
        return { results: upserted, source: "holded", holdedFallback: null };
      } catch (err) {
        if (err instanceof HoldedApiError || err instanceof HoldedInvalidResponseError) {
          request.log.warn(
            { tenantId: auth.tenantId },
            `holded contacts fallback falló: ${err.message}`,
          );
          return { results: [], source: "local", holdedFallback: "holded_error" };
        }
        throw err;
      }
    },
  );

  app.post(
    "/contacts",
    {
      preHandler: requireOwnerOrCashier,
      schema: {
        body: {
          type: "object",
          required: ["name"],
          additionalProperties: false,
          properties: {
            name: { type: "string", minLength: 1, maxLength: 200 },
            nif: { type: "string", maxLength: 32 },
            email: { type: "string", maxLength: 320 },
            phone: { type: "string", maxLength: 32 },
            mobile: { type: "string", maxLength: 32 },
          },
        },
      },
    },
    async (request, reply) => {
      const auth = request.auth!;
      const body = request.body as {
        name: string;
        nif?: string;
        email?: string;
        phone?: string;
        mobile?: string;
      };

      const client = await buildHoldedClient(auth.tenantId);
      if (!client) {
        return reply.code(409).send({
          error: "NO_HOLDED_KEY",
          message: "Conecta tu cuenta de Holded antes de crear contactos.",
        });
      }

      const holdedBody: CreateContactBody = {
        name: body.name,
        type: "client", // TPV crea clientes; suppliers/leads no aplican.
        code: body.nif,
        email: body.email,
        phone: body.phone,
        mobile: body.mobile,
      };

      let remote: HoldedContact;
      try {
        remote = await createContactWithGetBack(client, holdedBody, {
          expect: {
            name: body.name,
            code: body.nif,
            email: body.email,
            phone: body.phone,
          },
        });
      } catch (err) {
        if (err instanceof HoldedSilentRejectError) {
          // Holded aceptó la creación pero descartó campos clave.
          // Devolvemos 502 con detalle para que el front pueda mostrar
          // exactamente qué se perdió (el contacto YA existe en Holded;
          // el caller decide si lo recupera por id o lo borra).
          return reply.code(502).send({
            error: "HOLDED_SILENT_REJECT",
            message: "Holded aceptó el contacto pero descartó algún campo.",
            mismatches: err.mismatches,
          });
        }
        if (err instanceof HoldedApiError) {
          return reply.code(502).send({
            error: "HOLDED_ERROR",
            message: `Holded rechazó la creación: ${err.message}`,
          });
        }
        if (err instanceof HoldedInvalidResponseError) {
          return reply.code(502).send({
            error: "HOLDED_INVALID_RESPONSE",
            message: "Holded devolvió una respuesta que no es JSON.",
          });
        }
        request.log.error(
          { tenantId: auth.tenantId },
          `crear contacto falló: ${err instanceof Error ? err.message : String(err)}`,
        );
        return reply.code(502).send({
          error: "HOLDED_UNREACHABLE",
          message: "No hemos podido contactar con Holded.",
        });
      }

      const upserted = await upsertHoldedContact(auth.tenantId, remote);
      return reply.code(201).send({ contact: upserted });
    },
  );
}
