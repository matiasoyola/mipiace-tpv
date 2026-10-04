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

// catalogo-en-alta · las reglas ya no viven aquí.
//
// Este fichero era el único que daba de alta un producto local, así que
// las reglas estaban dentro. Ahora el super-admin carga el catálogo de
// un comercio desde un fichero (`superadmin/tenant-catalog.ts`) y las
// dos rutas tienen que validar y escribir IGUAL — no parecido. Lo que
// se comparte está en `local-product-rules.ts`, con el por qué de cada
// regla y con la conversión del precio.
import {
  brutoDesdeNeto,
  buildLocalProductCreateData,
  isLocalSkuConflict,
  normalizeBarcode,
  normalizeName,
  normalizePrice,
  normalizeSku,
  normalizeTags,
  normalizeTaxRate,
  PRODUCT_BODY_PROPERTIES,
  SKU_CONFLICT,
  validateLocalProduct,
} from "./local-product-rules.js";

export { LOCAL_TAX_RATES } from "./local-product-rules.js";

// Lo único que es de esta ruta y no de la regla: el tamaño de página del
// listado. Los límites del producto viven en `local-product-rules.ts`.
const PAGE_SIZE_DEFAULT = 50;
const PAGE_SIZE_MAX = 200;

interface ProductBody {
  name: string;
  sku: string;
  // Una de las dos, no las dos. Lo exige `normalizePrice`.
  basePrice?: number;
  priceGross?: number;
  taxRate: number;
  kind?: "PRODUCT" | "SERVICE";
  barcode?: string | null;
  tags?: string[];
  active?: boolean;
}

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
    // catalogo-en-alta · el precio CON IVA, calculado en el servidor con
    // la misma función que usa el TPV (`brutoDesdeNeto`). La pantalla lo
    // pinta tal cual en un campo que se llama "Precio con IVA" y lo
    // devuelve tal cual al guardar: ida y vuelta sin perder un céntimo,
    // y sin que el front tenga una copia de la fórmula del IVA.
    priceGross: brutoDesdeNeto(Number(p.basePrice), Number(p.taxRate)),
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
          //
          // catalogo-en-alta · el precio sale de `required` porque ahora
          // puede llegar por dos nombres. Que venga exactamente uno de
          // los dos lo exige `normalizePrice`, con una frase que se
          // entiende; un `oneOf` en el esquema contesta "body/ debe
          // coincidir con exactamente un esquema en oneOf".
          required: ["name", "sku", "taxRate"],
          additionalProperties: false,
          properties: PRODUCT_BODY_PROPERTIES,
        },
      },
    },
    async (request, reply) => {
      const auth = request.auth!;
      const body = request.body as ProductBody;
      const prisma = getPrisma();

      // catalogo-en-alta · LA misma función que usa la carga de fichero
      // del super-admin. Nombre, SKU, IVA, precio (con la conversión de
      // bruto a neto), etiquetas, código de barras y límites: todo con
      // un solo `validateLocalProduct`.
      const valid = validateLocalProduct(body);
      if (!valid.ok) {
        // El `error` nombrado se conserva campo a campo: la pantalla del
        // catálogo los distingue y no todos se arreglan igual.
        const code =
          valid.field === "sku"
            ? "INVALID_SKU"
            : valid.field === "taxRate"
              ? "INVALID_TAX_RATE"
              : valid.field === "price"
                ? "INVALID_PRICE"
                : "INVALID_NAME";
        return reply.code(400).send({ error: code, message: valid.message });
      }

      try {
        const row = await prisma.product.create({
          data: buildLocalProductCreateData(auth.tenantId, valid.fields),
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
        // catalogo-en-alta · el IVA ACTUAL hace falta para convertir un
        // `priceGross` que llegue solo. Ver abajo.
        select: { id: true, source: true, taxRate: true },
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
        const name = normalizeName(body.name);
        if (!name.ok) {
          return reply.code(400).send({ error: "INVALID_NAME", message: name.message });
        }
        data.name = name.value;
      }
      if (body.sku !== undefined) {
        const sku = normalizeSku(body.sku);
        if (!sku.ok) {
          return reply.code(400).send({ error: "INVALID_SKU", message: sku.message });
        }
        data.sku = sku.value;
      }
      // catalogo-en-alta · el IVA se resuelve ANTES del precio, porque el
      // precio con IVA se convierte con él.
      //
      // Y el IVA que manda es el de la petición si viene, y el de la
      // ficha si no: la pantalla edita un producto que ya tiene IVA, y
      // cambiar sólo el precio no puede reinterpretarlo con un 21 por
      // defecto. Un café al 10 % guardado como si fuera al 21 se cobra
      // mal el resto de su vida.
      let taxRate = Number(existing.taxRate);
      if (body.taxRate !== undefined) {
        const tax = normalizeTaxRate(body.taxRate);
        if (!tax.ok) {
          return reply.code(400).send({ error: "INVALID_TAX_RATE", message: tax.message });
        }
        taxRate = tax.value;
        data.taxRate = new Prisma.Decimal(tax.value);
      }
      // Cambiar SÓLO el IVA deja el neto quieto a propósito: es lo que el
      // propietario está diciendo —"esto va al 10, no al 21"— y mover el
      // neto para conservar el precio de escaparate sería tomar por él
      // una decisión fiscal. La pantalla manda los dos campos juntos.
      if (body.basePrice !== undefined || body.priceGross !== undefined) {
        const price = normalizePrice({
          basePrice: body.basePrice,
          priceGross: body.priceGross,
          taxRate,
        });
        if (!price.ok) {
          return reply.code(400).send({ error: "INVALID_PRICE", message: price.message });
        }
        data.basePrice = new Prisma.Decimal(price.value);
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
