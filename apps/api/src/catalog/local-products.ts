// catalogo-local · el CRUD del catálogo propio (ADR-017).
//
// Hasta este bloque no existía NINGUNA ruta de escritura de producto en
// el panel: la única pantalla bajo "Productos" era la bandeja de SKUs
// que Holded silenció, que es una bandeja de revisión y no un CRUD. Un
// cliente con caja no podía vender nada que no estuviera en Holded.
//
//   GET   /catalog/products          → listado del catálogo del tenant,
//                                      locales y de Holded juntos.
//   GET   /catalog/products/sku-suggestion → un SKU libre que proponer.
//   POST  /catalog/products          → alta de un producto LOCAL.
//   PATCH /catalog/products/:id      → edición de un producto LOCAL.
//
// ── Las dos reglas que gobiernan este fichero ──────────────────────────
//
// 1. **Sólo se escribe LOCAL.** Un producto `source = HOLDED` se LISTA
//    pero no se toca: su autoridad es Holded y cualquier cosa que
//    escribiéramos aquí la pisaría el sync incremental a los 15 minutos.
//    Editarlo devolvería un 200 mentiroso.
//
// 2. **El SKU es obligatorio y no es negociable.** Es la llave del
//    casamiento el día que ese comercio encienda Holded. Sale gratis
//    ahora y cuesta carísimo después, cliente a cliente y a mano.
//
// La puerta del alta (`ensureLocalCatalogWritable`) cierra la escritura
// cuando el tenant TIENE Holded. El listado no la lleva: mirar el
// catálogo propio vale para cualquier comercio con caja.

import { Prisma } from "@mipiacetpv/db";
import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";

import { requireOwnerOrManager } from "../auth/middleware.js";
import { getPrisma } from "../context.js";
import { ensureCajaEnabled } from "../lib/caja-gate.js";
import {
  ensureLocalCatalogWritable,
  localCatalogIsClosed,
} from "../lib/catalogo-local-gate.js";
import { buildLocalSku } from "../onboarding/auto-sku.js";

// catalogo-local · el tipo de IVA del alta local (addendum 2).
//
// De dónde NO sale: de `TenantTax`. Esa tabla es el cache del catálogo
// fiscal de Holded y la pueblan los dos syncs (`initial-sync.ts:129`,
// `incremental-sync.ts:185`). El comercio que nos ocupa tiene CERO filas
// ahí por definición, así que el desplegable no tendría de dónde salir.
//
// De dónde sale: esta constante. Los cuatro tramos peninsulares —general,
// reducido, superreducido y exento—, con el 21 por delante porque es el
// caso normal de los verticales de hoy.
//
// Y no es una lista cerrada: el handler acepta CUALQUIER tipo entre 0 y
// 100 con dos decimales (ver `normalizeTaxRate`). Las dos mitades tienen
// su motivo y son opuestas a propósito:
//
//   · La LISTA existe porque teclear `2,1` en vez de `21` se cobraría mal
//     en todos los tickets hasta que alguien lo notara, y el papel no lo
//     canta. Cuatro botones no se equivocan.
//   · La VÍA DE ESCAPE existe porque el IGIC canario (7, 3, 0 %) —y
//     cualquier tipo que cambie por ley— dejaría al cliente parado, sin
//     poder dar de alta su producto, esperando a que toquemos código y
//     despleguemos.
//
// Esto aplica SÓLO al alta local. Un `source = HOLDED` sigue trayendo su
// `taxRate` del sync, exactamente igual que antes del bloque.
export const LOCAL_TAX_RATES = [21, 10, 4, 0] as const;

// Dos decimales, que es la precisión de la columna (`Decimal(5,2)`).
// Más allá, la base redondearía en silencio y el producto quedaría con
// un IVA distinto del que el propietario tecleó.
const TAX_RATE_DECIMALS = 2;

/**
 * Valida el tipo de IVA de un producto local. Fuera de rango es 400 con
 * una frase, nunca un 500 y nunca un redondeo callado.
 */
function normalizeTaxRate(
  raw: number,
): { ok: true; taxRate: number } | { ok: false; message: string } {
  if (!Number.isFinite(raw)) {
    return { ok: false, message: "El tipo de IVA no es un número válido." };
  }
  if (raw < 0 || raw > 100) {
    return { ok: false, message: "El tipo de IVA tiene que estar entre 0 y 100." };
  }
  const rounded = Math.round(raw * 10 ** TAX_RATE_DECIMALS) / 10 ** TAX_RATE_DECIMALS;
  if (rounded !== raw) {
    return {
      ok: false,
      message: "El tipo de IVA admite como mucho dos decimales.",
    };
  }
  return { ok: true, taxRate: rounded };
}

const SKU_MAX = 64;
const NAME_MAX = 200;
const BARCODE_MAX = 64;
const TAG_MAX = 40;
const TAGS_MAX = 12;
const PAGE_SIZE_DEFAULT = 50;
const PAGE_SIZE_MAX = 200;

// Precio máximo por unidad. La columna es Decimal(12,4), así que el
// techo de verdad son 99.999.999,9999 €; este límite es de producto, no
// de base de datos: un precio de siete cifras en un TPV de barrio es un
// dedo en el teclado numérico, no una venta.
const PRICE_MAX = 999999.99;

interface ProductBody {
  name: string;
  sku: string;
  basePrice: number;
  taxRate: number;
  kind?: "PRODUCT" | "SERVICE";
  barcode?: string | null;
  tags?: string[];
  active?: boolean;
}

const PRODUCT_BODY_PROPERTIES = {
  name: { type: "string", minLength: 1, maxLength: NAME_MAX },
  sku: { type: "string", minLength: 1, maxLength: SKU_MAX },
  basePrice: { type: "number", minimum: 0, maximum: PRICE_MAX },
  // El esquema deja pasar todo el rango; los dos decimales y el mensaje
  // los pone `normalizeTaxRate`, que puede explicar el porqué. Un `enum`
  // aquí habría cerrado la puerta al IGIC.
  taxRate: { type: "number", minimum: 0, maximum: 100 },
  kind: { type: "string", enum: ["PRODUCT", "SERVICE"] },
  barcode: { type: ["string", "null"], maxLength: BARCODE_MAX },
  tags: {
    type: "array",
    maxItems: TAGS_MAX,
    items: { type: "string", minLength: 1, maxLength: TAG_MAX },
  },
  active: { type: "boolean" },
} as const;

const PRODUCT_SELECT = {
  id: true,
  name: true,
  sku: true,
  barcode: true,
  basePrice: true,
  taxRate: true,
  kind: true,
  active: true,
  tags: true,
  source: true,
  sellableViaTpv: true,
  holdedProductId: true,
} as const;

type ProductRow = {
  id: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  basePrice: Prisma.Decimal;
  taxRate: Prisma.Decimal;
  kind: "PRODUCT" | "SERVICE";
  active: boolean;
  tags: string[];
  source: "HOLDED" | "LOCAL";
  sellableViaTpv: boolean;
  holdedProductId: string | null;
};

// `escribible` es si la PUERTA del alta local está abierta para este
// tenant (`holdedEnabled === false`). Se pasa desde fuera porque es del
// tenant, no del producto.
//
// catalogo-local (addendum 3) · lo encontró el bucle visual: en un
// comercio con Holded que arrastra productos locales de antes, la
// pantalla pintaba "Editar" en cada uno y el PATCH respondía 403. El
// botón es cortesía y el 403 es la puerta, pero una cortesía que miente
// es peor que no tenerla.
function serialize(p: ProductRow, escribible: boolean) {
  return {
    id: p.id,
    name: p.name,
    sku: p.sku,
    barcode: p.barcode,
    basePrice: Number(p.basePrice),
    taxRate: Number(p.taxRate),
    kind: p.kind,
    active: p.active,
    tags: p.tags,
    source: p.source,
    // Lo que el TPV necesita para venderlo. Se manda para que la
    // pantalla pueda avisar de "creado pero no vendible" sin tener que
    // deducirlo de tres campos.
    sellableViaTpv: p.sellableViaTpv,
    // Las DOS condiciones que el PATCH comprueba, en el mismo orden:
    // que la ficha sea local, y que la puerta esté abierta.
    editable: p.source === "LOCAL" && escribible,
  };
}

/**
 * Normaliza y valida un SKU de producto local.
 *
 * Las reglas son las del prompt del bloque, y cada una tiene su razón:
 *
 *  · **No vacío.** Es la regla madre: sin SKU el TPV no lo vende
 *    (`tpv-catalog/routes.ts` filtra `sku: { not: null }`) y el día del
 *    casamiento con Holded no hay por dónde casarlo.
 *  · **Sin espacios en los extremos.** Se recortan en silencio en vez de
 *    rechazar: un espacio pegado al pegar desde un Excel no es un error
 *    del propietario, es ruido del portapapeles.
 *  · **Sin espacios interiores.** Éste sí se rechaza. Un SKU con un
 *    espacio dentro viaja como identificador de línea a Holded y a la
 *    impresora térmica, y ahí parte el campo.
 */
function normalizeSku(raw: string): { ok: true; sku: string } | { ok: false; message: string } {
  const sku = raw.trim();
  if (sku.length === 0) {
    return { ok: false, message: "El SKU es obligatorio." };
  }
  if (/\s/.test(sku)) {
    return {
      ok: false,
      message: "El SKU no puede llevar espacios. Usa guiones si necesitas separar.",
    };
  }
  return { ok: true, sku };
}

// Los tags se guardan como Holded los entrega —lowercase y sin
// duplicados— para que los chips de categoría del TPV salgan iguales
// vengan de donde vengan. La misma normalización que hacen los dos
// syncs; el TPV capitaliza al pintar.
function normalizeTags(raw: string[] | undefined): string[] {
  if (!raw) return [];
  return Array.from(
    new Set(raw.map((t) => t.trim().toLowerCase()).filter((t) => t.length > 0)),
  ).slice(0, TAGS_MAX);
}

function normalizeBarcode(raw: string | null | undefined): string | null {
  const v = (raw ?? "").trim();
  return v.length === 0 ? null : v;
}

// ¿El error de Prisma es el choque del índice único parcial de SKU
// local? P2002 es "unique constraint failed"; el `target` trae el nombre
// del índice. Se comprueba el nombre y no sólo el código porque
// `products` tiene DOS índices únicos y el otro —el del enlace con
// Holded— significa una cosa completamente distinta.
function isLocalSkuConflict(err: unknown): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (err.code !== "P2002") return false;
  const target = err.meta?.target;
  const asText = Array.isArray(target) ? target.join(",") : String(target ?? "");
  return asText.includes("products_tenant_id_sku_local_key") || asText.includes("sku");
}

const SKU_CONFLICT = {
  error: "SKU_ALREADY_EXISTS",
  message: "Ya tienes otro producto con ese SKU. Cambia uno de los dos.",
};

export async function registerLocalCatalogRoutes(app: FastifyInstance): Promise<void> {
  // ── Listado ───────────────────────────────────────────────────────
  //
  // Devuelve locales y de Holded JUNTOS y marcados. Enseñar sólo los
  // locales escondería la mitad del catálogo del comercio mixto y haría
  // imposible entender por qué un SKU choca.
  app.get(
    "/catalog/products",
    {
      preHandler: [requireOwnerOrManager, ensureCajaEnabled],
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            search: { type: "string", maxLength: 120 },
            source: { type: "string", enum: ["HOLDED", "LOCAL"] },
            includeInactive: { type: "boolean" },
            page: { type: "integer", minimum: 1 },
            pageSize: { type: "integer", minimum: 1, maximum: PAGE_SIZE_MAX },
          },
        },
      },
    },
    async (request) => {
      const auth = request.auth!;
      const q = request.query as {
        search?: string;
        source?: "HOLDED" | "LOCAL";
        includeInactive?: boolean;
        page?: number;
        pageSize?: number;
      };
      const prisma = getPrisma();
      const page = q.page ?? 1;
      const pageSize = q.pageSize ?? PAGE_SIZE_DEFAULT;
      const search = q.search?.trim();

      const where: Prisma.ProductWhereInput = {
        tenantId: auth.tenantId,
        ...(q.source ? { source: q.source } : {}),
        ...(q.includeInactive ? {} : { active: true }),
        ...(search
          ? {
              OR: [
                { name: { contains: search, mode: "insensitive" } },
                { sku: { contains: search, mode: "insensitive" } },
                { barcode: { contains: search, mode: "insensitive" } },
              ],
            }
          : {}),
      };

      const [rows, total, localCount, cerrada] = await Promise.all([
        prisma.product.findMany({
          where,
          // Los locales primero: en el comercio mixto son los que el
          // propietario viene a tocar, y son los menos. Dentro de cada
          // grupo, alfabético.
          orderBy: [{ source: "desc" }, { name: "asc" }],
          skip: (page - 1) * pageSize,
          take: pageSize,
          select: PRODUCT_SELECT,
        }),
        prisma.product.count({ where }),
        prisma.product.count({ where: { tenantId: auth.tenantId, source: "LOCAL" } }),
        // Si no se puede saber, se asume cerrada: misma dirección que el
        // gate (`lib/catalogo-local-gate.ts`). Esconder un botón que
        // funciona es un incordio; enseñar uno que devuelve 403 es un
        // error del que el propietario no sabe salir.
        localCatalogIsClosed(auth.tenantId).catch(() => true),
      ]);

      return {
        items: rows.map((r) => serialize(r, !cerrada)),
        total,
        page,
        pageSize,
        // La pantalla distingue "no tienes productos todavía" de "tu
        // búsqueda no ha encontrado nada", que son dos estados vacíos
        // que se parecen y no se tratan igual.
        localCount,
      };
    },
  );

  // ── Sugerencia de SKU ─────────────────────────────────────────────
  //
  // La pide la pantalla al abrir el formulario de alta. Se comprueba
  // contra la base para no proponer uno que ya esté cogido; con 8
  // caracteres de un UUID la colisión es remota, pero "remota" no es
  // "imposible" y el propietario no tiene por qué enterarse.
  app.get(
    "/catalog/products/sku-suggestion",
    { preHandler: [requireOwnerOrManager, ensureCajaEnabled] },
    async (request) => {
      const auth = request.auth!;
      const prisma = getPrisma();
      for (let i = 0; i < 5; i += 1) {
        const candidate = buildLocalSku(randomUUID());
        const taken = await prisma.product.findFirst({
          where: { tenantId: auth.tenantId, sku: candidate },
          select: { id: true },
        });
        if (!taken) return { sku: candidate };
      }
      // Cinco colisiones seguidas no pasa. Si pasara, la pantalla
      // enseña el campo vacío y el propietario escribe el suyo: el SKU
      // sugerido es una comodidad, no un requisito.
      return { sku: null };
    },
  );

  // ── Alta ──────────────────────────────────────────────────────────
  app.post(
    "/catalog/products",
    {
      preHandler: [requireOwnerOrManager, ensureCajaEnabled, ensureLocalCatalogWritable],
      schema: {
        body: {
          type: "object",
          // El SKU va en `required` además de validarse en el handler.
          // La doble puerta es deliberada: el esquema es lo que hace que
          // un POST sin `sku` sea imposible por la API aunque alguien
          // toque el handler mañana.
          required: ["name", "sku", "basePrice", "taxRate"],
          additionalProperties: false,
          properties: PRODUCT_BODY_PROPERTIES,
        },
      },
    },
    async (request, reply) => {
      const auth = request.auth!;
      const body = request.body as ProductBody;
      const prisma = getPrisma();

      const name = body.name.trim();
      if (name.length === 0) {
        return reply.code(400).send({ error: "INVALID_NAME", message: "El nombre es obligatorio." });
      }
      const sku = normalizeSku(body.sku);
      if (!sku.ok) {
        return reply.code(400).send({ error: "INVALID_SKU", message: sku.message });
      }
      const tax = normalizeTaxRate(body.taxRate);
      if (!tax.ok) {
        return reply.code(400).send({ error: "INVALID_TAX_RATE", message: tax.message });
      }

      try {
        const row = await prisma.product.create({
          data: {
            tenantId: auth.tenantId,
            // Lo que define el bloque entero. Sin enlace con Holded y
            // con la autoridad en casa.
            source: "LOCAL",
            holdedProductId: null,
            name,
            sku: sku.sku,
            barcode: normalizeBarcode(body.barcode),
            basePrice: new Prisma.Decimal(body.basePrice),
            taxRate: new Prisma.Decimal(tax.taxRate),
            kind: body.kind ?? "PRODUCT",
            active: body.active ?? true,
            tags: normalizeTags(body.tags),
            // Nace vendible: tiene SKU obligatorio, que es la única
            // condición que el TPV pone (`tpv-catalog/routes.ts`).
            sellableViaTpv: true,
            // Un producto local no pasa por el auto-SKU ni por la
            // bandeja de revisión: su SKU lo puso una persona.
            needsSkuReview: false,
            skuAutoAssignedAt: null,
          },
          select: PRODUCT_SELECT,
        });
        request.log.info(
          { tenantId: auth.tenantId, productId: row.id, sku: row.sku },
          "producto local creado",
        );
        // Ha pasado por `ensureLocalCatalogWritable`, así que la puerta
        // está abierta por definición.
        return reply.code(201).send({ product: serialize(row, true) });
      } catch (err) {
        if (isLocalSkuConflict(err)) {
          // 409 y una frase, no un 500. El choque de SKU es la
          // equivocación más probable de esta pantalla y tiene que
          // leerse como lo que es.
          return reply.code(409).send(SKU_CONFLICT);
        }
        throw err;
      }
    },
  );

  // ── Edición ───────────────────────────────────────────────────────
  app.patch(
    "/catalog/products/:productId",
    {
      preHandler: [requireOwnerOrManager, ensureCajaEnabled, ensureLocalCatalogWritable],
      schema: {
        params: {
          type: "object",
          required: ["productId"],
          properties: { productId: { type: "string", format: "uuid" } },
        },
        body: {
          type: "object",
          // En el PATCH nada es obligatorio salvo que, si mandas `sku`,
          // tenga que ser válido. Lo que NO se puede es borrarlo: el
          // esquema no admite `null` en `sku`.
          additionalProperties: false,
          minProperties: 1,
          properties: PRODUCT_BODY_PROPERTIES,
        },
      },
    },
    async (request, reply) => {
      const auth = request.auth!;
      const { productId } = request.params as { productId: string };
      const body = request.body as Partial<ProductBody>;
      const prisma = getPrisma();

      const existing = await prisma.product.findFirst({
        where: { id: productId, tenantId: auth.tenantId },
        select: { id: true, source: true },
      });
      if (!existing) {
        return reply
          .code(404)
          .send({ error: "PRODUCT_NOT_FOUND", message: "Producto no encontrado." });
      }
      // LA regla 1 de la cabecera, en código. No es un campo
      // deshabilitado en la pantalla: es un 409 del servidor.
      if (existing.source !== "LOCAL") {
        return reply.code(409).send({
          error: "PRODUCT_NOT_EDITABLE",
          message:
            "Este producto viene de Holded y se edita allí. Si lo cambias aquí, la próxima sincronización lo devolvería a como está en Holded.",
        });
      }

      const data: Prisma.ProductUpdateInput = {};
      if (body.name !== undefined) {
        const name = body.name.trim();
        if (name.length === 0) {
          return reply
            .code(400)
            .send({ error: "INVALID_NAME", message: "El nombre es obligatorio." });
        }
        data.name = name;
      }
      if (body.sku !== undefined) {
        const sku = normalizeSku(body.sku);
        if (!sku.ok) {
          return reply.code(400).send({ error: "INVALID_SKU", message: sku.message });
        }
        data.sku = sku.sku;
      }
      if (body.basePrice !== undefined) data.basePrice = new Prisma.Decimal(body.basePrice);
      if (body.taxRate !== undefined) {
        const tax = normalizeTaxRate(body.taxRate);
        if (!tax.ok) {
          return reply.code(400).send({ error: "INVALID_TAX_RATE", message: tax.message });
        }
        data.taxRate = new Prisma.Decimal(tax.taxRate);
      }
      if (body.kind !== undefined) data.kind = body.kind;
      if (body.barcode !== undefined) data.barcode = normalizeBarcode(body.barcode);
      if (body.tags !== undefined) data.tags = normalizeTags(body.tags);
      if (body.active !== undefined) data.active = body.active;

      try {
        const row = await prisma.product.update({
          where: { id: existing.id },
          data,
          select: PRODUCT_SELECT,
        });
        return reply.code(200).send({ product: serialize(row, true) });
      } catch (err) {
        if (isLocalSkuConflict(err)) {
          return reply.code(409).send(SKU_CONFLICT);
        }
        throw err;
      }
    },
  );
}
