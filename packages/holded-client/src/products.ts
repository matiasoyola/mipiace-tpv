import type { HoldedClient } from "./client.js";
import { HoldedSilentRejectError } from "./errors.js";
import type { SilentRejectMismatch } from "./errors.js";
import { detectImageMime } from "./image-magic.js";

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
  // B-ProductImages (spike §13): URL/array de imagen(es) del producto.
  // Declaramos los campos candidatos como opcionales; el helper
  // `extractImageUrl` decide cuál usar con prioridad fija. Si el spike
  // contra la cuenta piloto muestra que Holded usa otro nombre, se
  // añade aquí y se actualiza el helper — sin migración.
  mainImage?: string | { url?: string; [k: string]: unknown } | null;
  image?: string | { url?: string; [k: string]: unknown } | null;
  thumbnail?: string | null;
  pictures?: Array<string | { url?: string; [k: string]: unknown }>;
  images?: Array<string | { url?: string; [k: string]: unknown }>;
  // Inv-1 (v1.1 Thalia): el equipo subió foto desde la app móvil de
  // Holded y Holded la sirve bajo `attachment` (singular) o
  // `attachments` (array) en algunas cuentas. Defensivo: probamos
  // estos campos también antes de declarar "sin imagen".
  attachment?: string | { url?: string; [k: string]: unknown } | null;
  attachments?: Array<string | { url?: string; [k: string]: unknown }>;
  // Campos que Holded pueda añadir y no quieran perderse en raw.
  [extra: string]: unknown;
}

// Extrae la URL canónica de imagen de un producto Holded.
//
// Spike §13: el campo exacto depende de la cuenta (Holded ha mutado
// históricamente entre `mainImage`, `image` y arrays anidados). Probamos
// en orden de mayor confianza y devolvemos la primera URL válida.
// Devuelve null si:
//   - ningún campo candidato está presente,
//   - el campo está pero es array vacío / string vacío / objeto sin
//     URL anidada.
//
// La validación del MIME real (image/jpeg|png|webp) se hace en el
// worker tras descargar — aquí sólo extraemos el string http(s).
export function extractImageUrl(raw: HoldedProduct): string | null {
  const candidates: Array<unknown> = [
    raw.mainImage,
    raw.image,
    raw.thumbnail,
    raw.pictures,
    raw.images,
    raw.attachment,
    raw.attachments,
  ];
  for (const c of candidates) {
    const url = firstHttpUrl(c);
    if (url) return url;
  }
  return null;
}

// Inv-1 (v1.1 Thalia): diagnóstico cuando un producto Holded NO devuelve
// imagen reconocible. Lista las claves del raw cuyo nombre sugiere
// imagen pero no han pasado `extractImageUrl` (porque Holded los
// expone con estructura inesperada o son strings no-http). Si Thalia
// reporta "subí foto y no aparece", grepea estos logs para descubrir
// el campo que falta declarar arriba — sin tener que pedir un dump de
// la API por slack.
export function listUnrecognizedImageKeys(raw: HoldedProduct): string[] {
  const known = new Set([
    "mainImage",
    "image",
    "thumbnail",
    "pictures",
    "images",
    "attachment",
    "attachments",
  ]);
  const out: string[] = [];
  for (const key of Object.keys(raw)) {
    if (known.has(key)) continue;
    const lower = key.toLowerCase();
    if (
      lower.includes("image") ||
      lower.includes("picture") ||
      lower.includes("photo") ||
      lower.includes("thumb") ||
      lower.includes("attach") ||
      lower.includes("media") ||
      lower.includes("foto")
    ) {
      out.push(key);
    }
  }
  return out;
}

function firstHttpUrl(v: unknown): string | null {
  if (typeof v === "string") {
    const t = v.trim();
    return t.startsWith("http://") || t.startsWith("https://") ? t : null;
  }
  if (Array.isArray(v)) {
    for (const it of v) {
      const u = firstHttpUrl(it);
      if (u) return u;
    }
    return null;
  }
  if (v && typeof v === "object") {
    for (const val of Object.values(v as Record<string, unknown>)) {
      const u = firstHttpUrl(val);
      if (u) return u;
    }
  }
  return null;
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

// v1.2-Lite · Bug-Imagenes-Holded: el endpoint `/invoicing/v1/products`
// (listado) NO devuelve campos de imagen en cuentas como Thalia (26
// campos en raw, ninguno image/picture/photo/thumb/attach). El detalle
// individual a veces sí los trae (patrón común en Holded). Este helper
// dispara N llamadas al endpoint individual con concurrencia limitada y
// devuelve un Map<holdedProductId, imageUrl|null> usando `extractImageUrl`
// sobre cada detalle. Pensado para llamarse SÓLO sobre los productos
// donde el listado ya devolvió null — sería desperdicio re-pinchar los
// que ya traen URL desde la lista.
export interface FetchProductImageDetailsOptions {
  // Concurrencia máxima de llamadas en vuelo. 5 da ~25 req/s con
  // latencia típica de 200ms, dentro de márgenes razonables sin libreria
  // de token-bucket. Defaultea a 5 si no se pasa.
  concurrency?: number;
  // Callback opcional para warnings (mismo patrón que el resto del
  // sync). Por defecto consola; en tests, mockeable.
  onWarn?: (message: string, extra?: unknown) => void;
}

export interface FetchProductImageDetailResult {
  // Productos cuyo detalle devolvió URL extraíble.
  resolved: Map<string, string>;
  // Productos sondeados que SIGUIERON sin URL en el detalle: candidatos
  // a investigar (¿la cuenta usa otro endpoint? ¿attachments?).
  stillEmpty: string[];
  // Productos cuya petición al detalle falló (HTTP, red, etc.). El
  // caller decide si reintenta en el siguiente sync; no propagamos para
  // que un fallo aislado no aborte el backfill entero.
  failed: Array<{ id: string; reason: string }>;
}

export async function fetchProductImageDetails(
  client: HoldedClient,
  holdedProductIds: readonly string[],
  options: FetchProductImageDetailsOptions = {},
): Promise<FetchProductImageDetailResult> {
  const concurrency = Math.max(1, options.concurrency ?? 5);
  const onWarn = options.onWarn ?? defaultWarn;
  const resolved = new Map<string, string>();
  const stillEmpty: string[] = [];
  const failed: FetchProductImageDetailResult["failed"] = [];

  // Cola simple con N workers. Sin librería externa: una promise pool
  // basada en índice atómico es suficiente para 5-10 workers.
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < holdedProductIds.length) {
      const idx = cursor++;
      const id = holdedProductIds[idx];
      if (!id) continue;
      try {
        const detail = await getProduct(client, id);
        const url = extractImageUrl(detail);
        if (url) {
          resolved.set(id, url);
        } else {
          stillEmpty.push(id);
          const unknownKeys = listUnrecognizedImageKeys(detail);
          if (unknownKeys.length > 0) {
            onWarn(
              "producto sin imagen reconocida tras detalle, pero raw tiene claves image-like",
              { holdedProductId: id, candidateKeys: unknownKeys },
            );
          }
        }
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        failed.push({ id, reason });
        onWarn("fetch detalle producto falló durante backfill imagen", {
          holdedProductId: id,
          error: reason,
        });
      }
    }
  }

  const workers: Array<Promise<void>> = [];
  for (let i = 0; i < concurrency; i += 1) workers.push(worker());
  await Promise.all(workers);

  return { resolved, stillEmpty, failed };
}

function defaultWarn(message: string, extra?: unknown): void {
  console.warn(`[holded-client] ${message}`, extra ?? "");
}

// v1.2-Lite-fix1 Bug-Imagenes-Holded: el endpoint binario de imágenes.
// Spike 2026-05-22 (ver `docs/auditorias/bug-imagenes-holded.md`)
// confirmó que `GET /invoicing/v1/products/{id}/image` devuelve:
//
//   - El binario real de la foto (JPEG/PNG/GIF/WEBP) cuando el producto
//     tiene una en Holded. Status 200, `content-type: text/html` en el
//     header (sí, Holded miente — HEAD también devuelve text/html con
//     `content-length: null`), pero los magic bytes son los del binario.
//   - El HTML catch-all del frontend Next.js cuando el producto NO
//     tiene foto. Status 200, body que empieza por `<!doctype...`.
//
// Por eso:
//   * NO HEAD: el HEAD miente, gastaríamos un round-trip sin sacar
//     información útil.
//   * NO confiar en `content-type`: siempre devuelve text/html.
//   * Detección por magic bytes (`detectImageMime`) y null si HTML.
//   * Throw si bytes raros (binario que no es imagen reconocida): no
//     silenciar, es señal de algo cambió en Holded y queremos saberlo.
//
// Tamaño máximo y timeout son parámetros — el caller los configura
// según su contexto (sync usa el mismo límite que el image-cache-worker).
export type FetchedProductImage =
  | { bytes: Buffer; mime: "image/jpeg" | "image/png" | "image/gif" | "image/webp" }
  | null;

export interface FetchProductImageOptions {
  signal?: AbortSignal;
  maxBytes?: number;
  // 15 s por request en el sync (Holded contesta típicamente en
  // 200-400 ms, pero hay colas largas en horas pico).
  timeoutMs?: number;
}

export async function fetchProductImage(
  client: HoldedClient,
  holdedProductId: string,
  options: FetchProductImageOptions = {},
): Promise<FetchedProductImage> {
  if (!client.fetchBinary) {
    throw new Error(
      "fetchProductImage: el cliente no implementa fetchBinary (mock incompleto en tests?)",
    );
  }
  const path = `/invoicing/v1/products/${holdedProductId}/image`;
  const { bytes } = await client.fetchBinary(path, {
    signal: options.signal,
    maxBytes: options.maxBytes,
    timeoutMs: options.timeoutMs ?? 15000,
  });
  const mime = detectImageMime(bytes);
  if (mime === "text/html") {
    // Producto sin foto en Holded — Holded sirve el catch-all del
    // frontend. Caller distingue por `null`.
    return null;
  }
  if (mime === "unknown") {
    // Magic bytes no reconocidos: ni imagen válida ni HTML. Puede ser
    // un cambio en Holded (¿AVIF? ¿algún wrapper nuevo?) o un proxy
    // intermedio interfiriendo. Throw para que el caller lo loguee
    // como FAILED y el siguiente sync lo reintente.
    const preview = bytes.subarray(0, 8).toString("hex");
    throw new Error(
      `fetchProductImage(${holdedProductId}): magic bytes no reconocidos (${preview})`,
    );
  }
  return { bytes, mime };
}

export interface FetchProductImagesBatchOptions {
  concurrency?: number;
  // Pasthrough a `fetchProductImage`.
  maxBytes?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  onWarn?: (message: string, extra?: unknown) => void;
  // Callback de progreso: se llama tras cada producto. Útil para que
  // el sync pueda emitir telemetría intermedia sin esperar al batch
  // entero.
  onProgress?: (event: {
    holdedProductId: string;
    outcome: "resolved" | "none" | "failed";
  }) => void;
}

export interface FetchProductImagesBatchResult {
  // Productos con imagen descargada y MIME detectado.
  resolved: Map<string, { bytes: Buffer; mime: string }>;
  // Productos verificados sin foto en Holded (HTML catch-all). Sentinel:
  // el caller los marca como "imageCachedAt = now AND imageMime = NULL"
  // para no re-pinchar en cada sync.
  none: string[];
  // Errores de red, timeout, magic bytes raros. Caller decide si reintenta.
  failed: Array<{ id: string; reason: string }>;
}

export async function fetchProductImagesBatch(
  client: HoldedClient,
  holdedProductIds: readonly string[],
  options: FetchProductImagesBatchOptions = {},
): Promise<FetchProductImagesBatchResult> {
  const concurrency = Math.max(1, options.concurrency ?? 5);
  const onWarn = options.onWarn ?? defaultWarn;
  const resolved: FetchProductImagesBatchResult["resolved"] = new Map();
  const none: string[] = [];
  const failed: FetchProductImagesBatchResult["failed"] = [];

  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < holdedProductIds.length) {
      const idx = cursor++;
      const id = holdedProductIds[idx];
      if (!id) continue;
      try {
        const result = await fetchProductImage(client, id, {
          maxBytes: options.maxBytes,
          timeoutMs: options.timeoutMs,
          signal: options.signal,
        });
        if (result === null) {
          none.push(id);
          options.onProgress?.({ holdedProductId: id, outcome: "none" });
        } else {
          resolved.set(id, { bytes: result.bytes, mime: result.mime });
          options.onProgress?.({ holdedProductId: id, outcome: "resolved" });
        }
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        failed.push({ id, reason });
        onWarn("fetchProductImage falló durante backfill binario", {
          holdedProductId: id,
          error: reason,
        });
        options.onProgress?.({ holdedProductId: id, outcome: "failed" });
      }
    }
  }

  const workers: Array<Promise<void>> = [];
  for (let i = 0; i < concurrency; i += 1) workers.push(worker());
  await Promise.all(workers);

  return { resolved, none, failed };
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
