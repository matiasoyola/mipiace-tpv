import "dotenv/config";
import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import cors from "@fastify/cors";
import { z } from "zod";

import {
  ApiKeyClient,
  HoldedApiError,
  HoldedInvalidResponseError,
} from "./holded-client.js";

const Env = z.object({
  HOLDED_API_KEY: z.string().min(1, "Falta HOLDED_API_KEY en apps/api/.env"),
  HOLDED_BASE_URL: z.string().url().default("https://api.holded.com/api"),
  PORT: z.coerce.number().int().positive().default(3001),
});

type AnyRec = Record<string, unknown>;

// Producto en bruto tal como lo expone Holded en /invoicing/v1/products.
interface HoldedProduct {
  id: string;
  name: string;
  sku?: string | null;
  price?: number;
  total?: number;
  stock?: number;
  forSale?: number;
  taxes?: string[];
}

// Producto tal como lo consume el TPV.
interface TpvProduct {
  id: string;
  name: string;
  sku: string;
  price: number;
  total: number;
  tax: number;
}

const CATALOG_SIZE = 5;
const TOTAL_TOLERANCE_EUR = 0.05;

// "s_iva_21" → 21, "s_iva_4" → 4. Devuelve null si no matchea.
function parseTaxRate(taxId: string | undefined): number | null {
  if (!taxId) return null;
  const m = taxId.match(/^s_iva_(\d+)$/);
  return m && m[1] ? Number(m[1]) : null;
}

function pickCatalog(raw: HoldedProduct[]): TpvProduct[] {
  const result: TpvProduct[] = [];
  for (const p of raw) {
    if (result.length >= CATALOG_SIZE) break;
    if (p.forSale !== 1) continue;
    if (typeof p.stock !== "number" || p.stock <= 0) continue;
    if (typeof p.sku !== "string" || p.sku.length === 0) continue;
    if (typeof p.price !== "number" || !(p.price > 0)) continue;
    const tax = parseTaxRate(p.taxes?.[0]);
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

async function loadCatalog(holded: ApiKeyClient): Promise<TpvProduct[]> {
  const raw = await holded.request<HoldedProduct[]>("/invoicing/v1/products");
  if (!Array.isArray(raw)) {
    throw new Error(
      `GET /invoicing/v1/products devolvió algo que no es array: ${typeof raw}`,
    );
  }
  return pickCatalog(raw);
}

// ── Body del POST /tickets ───────────────────────────────────────────
const TicketBody = z.object({
  lines: z
    .array(
      z.object({
        productId: z.string().min(1),
        units: z.number().positive(),
      }),
    )
    .min(1, "Carrito vacío"),
  cashAmount: z.number().nonnegative().optional(),
});

type TicketBody = z.infer<typeof TicketBody>;

// ── Errores del orquestador ──────────────────────────────────────────
class TicketError extends Error {
  constructor(
    public readonly stage:
      | "validate"
      | "post-salesreceipt"
      | "get-back-salesreceipt"
      | "post-pay"
      | "get-back-pay",
    public readonly detail: unknown,
    message: string,
  ) {
    super(message);
    this.name = "TicketError";
  }
}

interface TicketResult {
  externalId: string;
  holdedDocumentId: string;
  docNumber: string;
  total: number;
}

async function createTicket(
  holded: ApiKeyClient,
  catalog: TpvProduct[],
  body: TicketBody,
): Promise<TicketResult> {
  // 1. Resolver líneas contra el catálogo.
  const resolved = body.lines.map((line) => {
    const product = catalog.find((p) => p.id === line.productId);
    if (!product) {
      throw new TicketError(
        "validate",
        { productId: line.productId },
        `productId desconocido: ${line.productId}`,
      );
    }
    return { ...product, units: line.units };
  });

  // 2. Calcular total esperado.
  const expectedTotal = resolved.reduce(
    (acc, l) => acc + l.price * l.units * (1 + l.tax / 100),
    0,
  );

  // 3. Generar externalId y payload.
  const externalId = randomUUID();
  const now = Math.floor(Date.now() / 1000);
  const payload: AnyRec = {
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
  };

  // 4. POST salesreceipt.
  let postResponse: AnyRec;
  try {
    postResponse = await holded.request<AnyRec>(
      "/invoicing/v1/documents/salesreceipt",
      { method: "POST", body: JSON.stringify(payload) },
    );
  } catch (err) {
    throw new TicketError(
      "post-salesreceipt",
      serializeHoldedError(err),
      "Holded rechazó el POST salesreceipt",
    );
  }
  const documentId = typeof postResponse.id === "string" ? postResponse.id : null;
  if (!documentId) {
    throw new TicketError(
      "post-salesreceipt",
      { response: postResponse },
      "POST salesreceipt 2xx pero sin id",
    );
  }

  // 5. GET-back salesreceipt, validar invariantes.
  let stored: AnyRec;
  try {
    stored = await holded.request<AnyRec>(
      `/invoicing/v1/documents/salesreceipt/${documentId}`,
    );
  } catch (err) {
    throw new TicketError(
      "get-back-salesreceipt",
      { documentId, error: serializeHoldedError(err) },
      "GET-back tras crear el ticket falló",
    );
  }
  const docNumber = stored.docNumber;
  const approvedAt = stored.approvedAt;
  const draft = stored.draft;
  const storedTotal = Number(stored.total ?? 0);

  const isApproved =
    docNumber != null && docNumber !== "" && approvedAt != null && draft !== true;
  const totalOk =
    storedTotal > 0 && Math.abs(storedTotal - expectedTotal) < TOTAL_TOLERANCE_EUR;
  if (!isApproved || !totalOk) {
    throw new TicketError(
      "get-back-salesreceipt",
      {
        documentId,
        expectedTotal,
        storedTotal,
        docNumber,
        approvedAt,
        draft,
      },
      "El documento se creó pero no cumple las invariantes (regla del 2xx mentiroso · ADR-010)",
    );
  }

  // 6. POST .../pay.
  const payPayload: AnyRec = {
    date: now,
    amount: storedTotal,
    desc: "TPV efectivo",
  };
  try {
    await holded.request<AnyRec>(
      `/invoicing/v1/documents/salesreceipt/${documentId}/pay`,
      { method: "POST", body: JSON.stringify(payPayload) },
    );
  } catch (err) {
    throw new TicketError(
      "post-pay",
      { documentId, error: serializeHoldedError(err) },
      "Holded rechazó el POST /pay",
    );
  }

  // 7. GET-back pay, validar paymentsPending == 0.
  let paid: AnyRec;
  try {
    paid = await holded.request<AnyRec>(
      `/invoicing/v1/documents/salesreceipt/${documentId}`,
    );
  } catch (err) {
    throw new TicketError(
      "get-back-pay",
      { documentId, error: serializeHoldedError(err) },
      "GET-back tras /pay falló",
    );
  }
  const paymentsPending = Number(paid.paymentsPending ?? -1);
  if (Math.abs(paymentsPending) > 0.01) {
    throw new TicketError(
      "get-back-pay",
      { documentId, paymentsPending, expected: 0 },
      "Cobro registrado pero paymentsPending != 0",
    );
  }

  return {
    externalId,
    holdedDocumentId: documentId,
    docNumber: String(docNumber),
    total: storedTotal,
  };
}

function serializeHoldedError(err: unknown): AnyRec {
  if (err instanceof HoldedApiError) {
    return { kind: "HoldedApiError", status: err.status, url: err.url, body: err.body };
  }
  if (err instanceof HoldedInvalidResponseError) {
    return {
      kind: "HoldedInvalidResponseError",
      status: err.status,
      url: err.url,
      contentType: err.contentType,
      bodyPreview: err.bodyPreview,
    };
  }
  if (err instanceof Error) return { kind: "Error", message: err.message };
  return { kind: "unknown", value: String(err) };
}

// ── Bootstrap ────────────────────────────────────────────────────────
async function main() {
  const env = Env.parse(process.env);

  const app = Fastify({
    logger: {
      transport: { target: "pino-pretty", options: { translateTime: "HH:MM:ss" } },
    },
  });

  await app.register(cors, { origin: true });

  const holded = new ApiKeyClient(env.HOLDED_API_KEY, env.HOLDED_BASE_URL);

  app.log.info("Cargando catálogo desde Holded…");
  const catalog = await loadCatalog(holded);
  if (catalog.length === 0) {
    app.log.warn(
      "⚠ El catálogo vendible está vacío (ningún producto cumple forSale===1 && stock>0 && sku!=='' && taxes parseables). El TPV no tendrá productos para vender.",
    );
  } else {
    app.log.info(
      { count: catalog.length },
      `Catálogo cargado (${catalog.length} producto${catalog.length === 1 ? "" : "s"} vendible${catalog.length === 1 ? "" : "s"}):`,
    );
    for (const p of catalog) {
      app.log.info(`  · ${p.name} · sku=${p.sku} · ${p.total.toFixed(2)} € (IVA ${p.tax}%)`);
    }
  }

  app.get("/health", async () => ({ ok: true }));

  app.get("/products", async () => catalog);

  app.post("/tickets", async (req, reply) => {
    const parsed = TicketBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "INVALID_BODY",
        detail: parsed.error.flatten(),
      });
    }
    try {
      const result = await createTicket(holded, catalog, parsed.data);
      app.log.info(
        { docNumber: result.docNumber, total: result.total, externalId: result.externalId },
        "Ticket creado en Holded",
      );
      return result;
    } catch (err) {
      if (err instanceof TicketError) {
        app.log.error({ stage: err.stage, detail: err.detail }, err.message);
        return reply.code(err.stage === "validate" ? 400 : 502).send({
          error: err.stage.toUpperCase().replace(/-/g, "_"),
          message: err.message,
          detail: err.detail,
        });
      }
      app.log.error(err);
      return reply.code(500).send({ error: "INTERNAL", message: String(err) });
    }
  });

  try {
    await app.listen({ port: env.PORT, host: "127.0.0.1" });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
