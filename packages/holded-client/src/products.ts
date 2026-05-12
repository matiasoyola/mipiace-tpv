import type { HoldedClient } from "./client.js";
import { HoldedSilentRejectError } from "./errors.js";
import type { SilentRejectMismatch } from "./errors.js";

// Producto en bruto tal como lo expone Holded en /invoicing/v1/products.
// Sólo declaramos los campos que el TPV consume; el resto va en `raw`
// jsonb a nivel BD.
export interface HoldedProduct {
  id: string;
  kind?: string;
  name: string;
  desc?: string;
  sku?: string | null;
  barcode?: string | null;
  price?: number;
  total?: number;
  taxes?: string[];
  hasStock?: boolean;
  stock?: number;
  forSale?: number;
  forPurchase?: number;
  tags?: string[];
  categoryId?: string;
  warehouseId?: string | null;
  attributes?: Array<{ id: string; value: string; name: string }>;
  variants?: HoldedProductVariant[];
  // Campos que Holded pueda añadir y no quieran perderse en raw.
  [extra: string]: unknown;
}

export interface HoldedProductVariant {
  id: string;
  name?: string;
  sku?: string | null;
  barcode?: string | null;
  price?: number;
  stock?: number;
  [extra: string]: unknown;
}

// Paginación de /products: spike §02.B. Sólo `page=N`; el tamaño es fijo a
// 500 ítems; fin = array vacío.
export const HOLDED_PRODUCTS_PAGE_SIZE = 500;

export async function listProductsPage(
  client: HoldedClient,
  page: number,
): Promise<HoldedProduct[]> {
  if (!Number.isInteger(page) || page < 1) {
    throw new RangeError(`listProductsPage: page debe ser entero ≥1 (got ${page})`);
  }
  const result = await client.request<unknown>(
    `/invoicing/v1/products?page=${page}`,
  );
  if (!Array.isArray(result)) {
    throw new TypeError(
      `GET /invoicing/v1/products?page=${page} devolvió algo que no es array`,
    );
  }
  return result as HoldedProduct[];
}

// Iterador async que devuelve cada página hasta encontrar array vacío.
// Permite hacer streaming sin cargar el catálogo entero en memoria.
export async function* iterateAllProducts(
  client: HoldedClient,
): AsyncGenerator<{ page: number; products: HoldedProduct[] }, void, void> {
  let page = 1;
  while (true) {
    const products = await listProductsPage(client, page);
    if (products.length === 0) return;
    yield { page, products };
    page += 1;
  }
}

export async function getProduct(
  client: HoldedClient,
  holdedProductId: string,
): Promise<HoldedProduct> {
  return client.request<HoldedProduct>(
    `/invoicing/v1/products/${holdedProductId}`,
  );
}

// PUT /products/{id} y GET-back para validar (ADR-010).
// Lanza HoldedSilentRejectError si el GET-back demuestra que Holded
// descartó el campo. Usado por el script auto-SKU.
export async function updateProductWithGetBack<TBody extends Record<string, unknown>>(
  client: HoldedClient,
  holdedProductId: string,
  body: TBody,
  options: {
    // Campos a verificar tras el PUT. Para auto-SKU, sería { sku: "AUTO-..." }.
    expect: Partial<Record<keyof TBody | string, unknown>>;
  },
): Promise<HoldedProduct> {
  const path = `/invoicing/v1/products/${holdedProductId}`;
  await client.request<unknown>(path, {
    method: "PUT",
    body: JSON.stringify(body),
  });

  const stored = await client.request<HoldedProduct>(path);

  const mismatches: SilentRejectMismatch[] = [];
  for (const [field, expected] of Object.entries(options.expect)) {
    const actual = (stored as Record<string, unknown>)[field];
    if (!shallowEqual(expected, actual)) {
      mismatches.push({ field, expected, actual });
    }
  }
  if (mismatches.length > 0) {
    throw new HoldedSilentRejectError(
      `PUT product ${holdedProductId}`,
      path,
      mismatches,
      stored,
    );
  }
  return stored;
}

export interface CreateProductBody {
  name: string;
  sku: string;
  // Tipos de IVA: número (Holded mapea bidi a "s_iva_<n>", spike §05.D).
  tax: number;
  // Precio base sin IVA.
  price?: number;
  kind?: "simple" | string;
  // forSale=1 para que aparezca como vendible.
  forSale?: number;
  desc?: string;
  // Holded acepta campos extra que ignora.
  [extra: string]: unknown;
}

// POST /products. Devuelve el producto creado. NO hace GET-back: la
// creación es por sku y barcode únicos; si el sku ya existe Holded
// devuelve error explícito en lugar de silenciar. (Si en práctica
// resulta que Holded silencia campos en POST, añadir GET-back aquí.)
export async function createProduct(
  client: HoldedClient,
  body: CreateProductBody,
): Promise<HoldedProduct> {
  const response = await client.request<HoldedProduct & { status?: number; info?: string }>(
    `/invoicing/v1/products`,
    { method: "POST", body: JSON.stringify(body) },
  );
  return response;
}

function shallowEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (typeof a === "number" && typeof b === "number") {
    return Math.abs(a - b) < 1e-9;
  }
  // Comparación profunda mínima para arrays/objetos planos.
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => shallowEqual(v, b[i]));
  }
  if (a && b && typeof a === "object" && typeof b === "object") {
    const ka = Object.keys(a as object);
    const kb = Object.keys(b as object);
    if (ka.length !== kb.length) return false;
    return ka.every((k) =>
      shallowEqual(
        (a as Record<string, unknown>)[k],
        (b as Record<string, unknown>)[k],
      ),
    );
  }
  return false;
}
