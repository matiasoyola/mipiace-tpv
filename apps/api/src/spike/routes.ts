// Endpoints del super-mini-MVP single-tenant. Mantienen viva la
// experiencia del spike (apps/tpv-web-spike) mientras B2-B4 construyen
// el flujo multi-tenant definitivo. No usar para nada productivo.

import { randomUUID } from "node:crypto";

import type { FastifyInstance } from "fastify";
import { z } from "zod";

import {
  ApiKeyClient,
  createSalesreceiptApproved,
  HoldedApiError,
  HoldedInvalidResponseError,
  HoldedSilentRejectError,
  listProductsPage,
  parseTaxRateFromId,
  registerPaymentWithGetBack,
} from "@mipiacetpv/holded-client";

const TpvProductShape = z.object({
  id: z.string(),
  name: z.string(),
  sku: z.string(),
  price: z.number(),
  total: z.number(),
  tax: z.number(),
});
type TpvProduct = z.infer<typeof TpvProductShape>;

const CATALOG_SIZE = 5;

export async function registerSpikeRoutes(
  app: FastifyInstance,
  apiKey: string,
  baseUrl: string,
): Promise<void> {
  const client = new ApiKeyClient(apiKey, { baseUrl });

  // Carga un catálogo reducido vendible (filtros idénticos al super-mini-MVP).
  const catalog = await loadCatalog(client);
  if (catalog.length === 0) {
    app.log.warn(
      "[spike] catálogo vendible vacío (ningún producto con forSale=1, stock>0, sku!='', taxes parseables)",
    );
  }

  app.get("/products", async () => catalog);

  app.post(
    "/tickets",
    {
      schema: {
        body: {
          type: "object",
          required: ["lines"],
          additionalProperties: false,
          properties: {
            lines: {
              type: "array",
              minItems: 1,
              items: {
                type: "object",
                required: ["productId", "units"],
                additionalProperties: false,
                properties: {
                  productId: { type: "string", minLength: 1 },
                  units: { type: "number", minimum: 0.001 },
                },
              },
            },
            cashAmount: { type: "number", minimum: 0 },
          },
        },
      },
    },
    async (request, reply) => {
      const body = request.body as {
        lines: Array<{ productId: string; units: number }>;
        cashAmount?: number;
      };
      const resolved = body.lines.map((line) => {
        const product = catalog.find((p) => p.id === line.productId);
        if (!product) {
          throw Object.assign(new Error(`productId desconocido ${line.productId}`), {
            tag: "VALIDATE",
          });
        }
        return { ...product, units: line.units };
      });
      const expectedTotal = resolved.reduce(
        (acc, l) => acc + l.price * l.units * (1 + l.tax / 100),
        0,
      );
      const externalId = randomUUID();
      const now = Math.floor(Date.now() / 1000);
      try {
        const { documentId, stored } = await createSalesreceiptApproved(
          client,
          {
            approveDoc: true,
            date: now,
            notes: `TPV-uuid: ${externalId}`,
            items: resolved.map((l) => ({
              name: l.name,
              units: l.units,
              price: l.price,
              tax: l.tax,
              discount: 0,
              sku: l.sku,
            })),
          },
          { externalId, expectedTotal },
        );
        await registerPaymentWithGetBack(client, documentId, {
          date: now,
          amount: Number(stored.total ?? expectedTotal),
          desc: "TPV efectivo",
        });
        return {
          externalId,
          holdedDocumentId: documentId,
          docNumber: stored.docNumber,
          total: stored.total,
        };
      } catch (err) {
        const detail = serializeError(err);
        if (err instanceof HoldedSilentRejectError) {
          return reply.code(502).send({
            error: "HOLDED_SILENT_REJECT",
            message: err.message,
            detail,
          });
        }
        if (err instanceof HoldedApiError) {
          return reply.code(502).send({
            error: "HOLDED_API_ERROR",
            message: err.message,
            detail,
          });
        }
        if (err instanceof HoldedInvalidResponseError) {
          return reply.code(502).send({
            error: "HOLDED_INVALID_RESPONSE",
            message: err.message,
            detail,
          });
        }
        if (err instanceof Error && (err as { tag?: string }).tag === "VALIDATE") {
          return reply.code(400).send({ error: "VALIDATE", message: err.message });
        }
        request.log.error(err);
        return reply.code(500).send({ error: "INTERNAL", message: String(err) });
      }
    },
  );
}

async function loadCatalog(client: ApiKeyClient): Promise<TpvProduct[]> {
  // 1ª página (500 ítems) basta para el spike.
  const raw = await listProductsPage(client, 1);
  const result: TpvProduct[] = [];
  for (const p of raw) {
    if (result.length >= CATALOG_SIZE) break;
    if (p.forSale !== 1) continue;
    if (typeof p.stock !== "number" || p.stock <= 0) continue;
    if (typeof p.sku !== "string" || p.sku.length === 0) continue;
    if (typeof p.price !== "number" || !(p.price > 0)) continue;
    const tax = parseTaxRateFromId(p.taxes?.[0]);
    if (tax === null) continue;
    if (typeof p.total !== "number") continue;
    result.push({
      id: p.id,
      name: p.name,
      sku: p.sku,
      price: p.price,
      total: p.total,
      tax,
    });
  }
  return result;
}

function serializeError(err: unknown): Record<string, unknown> {
  if (err instanceof HoldedSilentRejectError)
    return { kind: err.name, mismatches: err.mismatches };
  if (err instanceof HoldedApiError)
    return { kind: err.name, status: err.status, url: err.url, body: err.body };
  if (err instanceof HoldedInvalidResponseError)
    return {
      kind: err.name,
      status: err.status,
      url: err.url,
      contentType: err.contentType,
      bodyPreview: err.bodyPreview,
    };
  if (err instanceof Error) return { kind: "Error", message: err.message };
  return { kind: "unknown", value: String(err) };
}
