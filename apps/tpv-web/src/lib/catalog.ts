// Cache de catálogo en IndexedDB con fallback a localStorage si el
// navegador no expone IDB (privacidad estricta). El TPV pinta sin esperar
// a la red; al primer login (o cuando el tenant emita el banner
// "Sincronizando"), refresca contra `/tpv/catalog/products`.

import { apiWithCashier } from "../api.js";

export interface CatalogProduct {
  id: string;
  holdedProductId: string;
  name: string;
  sku: string;
  barcode: string | null;
  basePrice: number;
  priceGross: number;
  taxRate: number;
  kind: "PRODUCT" | "SERVICE";
  // B-ProductImages: MIME del binario cacheado por el worker. Null si
  // Holded no expone imagen o si el worker aún no descargó. El TPV usa
  // este flag como gate para renderizar `<img>` vs. placeholder.
  imageMime: string | null;
  // B-Categorias-via-Tags: lista de tags Holded del producto. El TPV
  // las usa como pseudo-categorías para construir los chips de filtro
  // arriba de la grid. Si el propietario no tagueó en Holded, el array
  // viene vacío. Se ordena alfabéticamente al renderizar los chips —
  // se preserva el orden de Holded en el array.
  tags: string[];
}

const DB_NAME = "mipiacetpv-catalog";
const STORE = "products";
// Bump por el campo tags (B-Categorias-via-Tags). IndexedDB sobrevive
// con onupgradeneeded; los registros viejos quedan sin tags hasta el
// próximo refresh, que el banner "Sincronizando" disparará.
const VERSION = 3;
const LS_KEY = "mipiacetpv-catalog-fallback";
const META_KEY = "mipiacetpv-catalog-meta";
const TENANT_ID_KEY = "mipiacetpv-catalog-tenant";
// B-Multi-Vertical SB3: vertical del tenant cacheado. El TPV lo usa
// para decidir icono placeholder y si renderiza el mapa de mesas.
const BUSINESS_TYPE_KEY = "mipiacetpv-catalog-business-type";
// v1.3-hotfix6 · subvertical/icon preset del tenant (peluquería,
// clínica, taller…). null = usar icono genérico del businessType.
const ICON_PRESET_KEY = "mipiacetpv-catalog-icon-preset";
// v1.3-Operativa-Extra · Lote 1: alias slug→label editable desde el
// admin. Se cachea en localStorage para que el TPV resuelva el chip
// sin esperar a la red; refresca al siguiente pull completo del
// catálogo (banner "Sincronizando").
const TAG_ALIASES_KEY = "mipiacetpv-catalog-tag-aliases";

export type BusinessType = "HOSPITALITY" | "RETAIL" | "SERVICES";

function isBusinessType(v: unknown): v is BusinessType {
  return v === "HOSPITALITY" || v === "RETAIL" || v === "SERVICES";
}

interface CatalogMeta {
  lastFetchedAt: string;
  count: number;
}

// Mapa MIME → extensión usado al construir la URL del binario en el
// volumen `product_images`. Tiene que estar alineado con el worker
// (apps/api/src/workers/image-cache-worker.ts `extFromMime`).
export function extFromImageMime(mime: string): string {
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  return "bin";
}

export function getCachedTenantId(): string | null {
  return localStorage.getItem(TENANT_ID_KEY);
}

export function getCachedBusinessType(): BusinessType | null {
  const raw = localStorage.getItem(BUSINESS_TYPE_KEY);
  return isBusinessType(raw) ? raw : null;
}

export function setCachedBusinessType(value: BusinessType): void {
  localStorage.setItem(BUSINESS_TYPE_KEY, value);
}

export function getCachedIconPreset(): string | null {
  return localStorage.getItem(ICON_PRESET_KEY);
}

export function setCachedIconPreset(value: string | null): void {
  if (value === null || value === "") {
    localStorage.removeItem(ICON_PRESET_KEY);
  } else {
    localStorage.setItem(ICON_PRESET_KEY, value);
  }
}

// v1.3-Operativa-Extra · Lote 1: lee el mapa de aliases cacheado en
// localStorage. Devuelve `{}` si no hay nada cacheado o si el JSON está
// corrupto — el TPV se comporta entonces como antes (cae al
// capitalizeTag).
export function getCachedTagAliases(): Record<string, string> {
  const raw = localStorage.getItem(TAG_ALIASES_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, string>;
    }
    return {};
  } catch {
    return {};
  }
}

export function setCachedTagAliases(value: Record<string, string>): void {
  localStorage.setItem(TAG_ALIASES_KEY, JSON.stringify(value));
}

export function productImageUrl(p: CatalogProduct, tenantId: string): string | null {
  if (!p.imageMime) return null;
  return `/product-images/${tenantId}/${p.id}.${extFromImageMime(p.imageMime)}`;
}

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id" });
        store.createIndex("sku", "sku", { unique: false });
        store.createIndex("barcode", "barcode", { unique: false });
      }
    };
    req.onerror = () => resolve(null);
    req.onsuccess = () => resolve(req.result);
  });
}

async function writeAll(items: CatalogProduct[]): Promise<void> {
  const db = await openDb();
  if (!db) {
    localStorage.setItem(LS_KEY, JSON.stringify(items));
    return;
  }
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
    const store = tx.objectStore(STORE);
    store.clear();
    for (const it of items) store.put(it);
  });
}

async function readAll(): Promise<CatalogProduct[]> {
  const db = await openDb();
  if (!db) {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [];
    try {
      return JSON.parse(raw) as CatalogProduct[];
    } catch {
      return [];
    }
  }
  return await new Promise<CatalogProduct[]>((resolve) => {
    const tx = db.transaction(STORE, "readonly");
    const store = tx.objectStore(STORE);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result as CatalogProduct[]);
    req.onerror = () => resolve([]);
  });
}

export function getCatalogMeta(): CatalogMeta | null {
  const raw = localStorage.getItem(META_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as CatalogMeta;
  } catch {
    return null;
  }
}

function setCatalogMeta(meta: CatalogMeta): void {
  localStorage.setItem(META_KEY, JSON.stringify(meta));
}

export async function loadCatalogFromCache(): Promise<CatalogProduct[]> {
  return readAll();
}

// Trae el catálogo entero del backend paginando por cursor. Si el cliente
// está offline, devuelve lo que tenga cacheado en IDB y propaga el error.
export async function refreshCatalog(): Promise<CatalogProduct[]> {
  const acc: CatalogProduct[] = [];
  let cursor: string | undefined;
  let lastTenantId: string | null = null;
  let lastBusinessType: BusinessType | null = null;
  let lastIconPreset: string | null | undefined = undefined;
  let lastTagAliases: Array<{ slug: string; label: string }> | undefined = undefined;
  for (let safety = 0; safety < 200; safety++) {
    const res = await apiWithCashier<{
      items: CatalogProduct[];
      nextCursor: string | null;
      tenantId: string;
      businessType?: BusinessType;
      tpvIconPreset?: string | null;
      tagAliases?: Array<{ slug: string; label: string }>;
    }>(
      `/tpv/catalog/products${cursor ? `?cursor=${cursor}&limit=500` : "?limit=500"}`,
    );
    acc.push(...res.items);
    lastTenantId = res.tenantId;
    if (res.businessType && isBusinessType(res.businessType)) {
      lastBusinessType = res.businessType;
    }
    // v1.3-hotfix6 · sólo viene en la primera página (cursor vacío),
    // de ahí el check `undefined` para no pisar la cache si vino en
    // una página posterior por algún motivo.
    if (res.tpvIconPreset !== undefined) {
      lastIconPreset = res.tpvIconPreset;
    }
    // v1.3-Operativa-Extra · Lote 1: mismo patrón — sólo en la primera
    // página. Si el OWNER añade un alias, el TPV lo verá tras el próximo
    // refresh completo (banner "Sincronizando").
    if (res.tagAliases !== undefined) {
      lastTagAliases = res.tagAliases;
    }
    if (!res.nextCursor) break;
    cursor = res.nextCursor;
  }
  await writeAll(acc);
  setCatalogMeta({ lastFetchedAt: new Date().toISOString(), count: acc.length });
  if (lastTenantId) localStorage.setItem(TENANT_ID_KEY, lastTenantId);
  if (lastBusinessType) setCachedBusinessType(lastBusinessType);
  if (lastIconPreset !== undefined) setCachedIconPreset(lastIconPreset);
  if (lastTagAliases !== undefined) {
    const map: Record<string, string> = {};
    for (const a of lastTagAliases) map[a.slug] = a.label;
    setCachedTagAliases(map);
  }
  return acc;
}

export interface Wildcard {
  id: string;
  holdedProductId: string;
  name: string;
  sku: string;
  basePrice: number;
  taxRate: number;
}

export async function loadWildcards(): Promise<Wildcard[]> {
  const res = await apiWithCashier<{ items: Wildcard[] }>(
    "/tpv/catalog/wildcards",
  );
  return res.items;
}

export function findByBarcode(items: CatalogProduct[], barcode: string): CatalogProduct | null {
  const needle = barcode.trim();
  if (needle.length === 0) return null;
  return items.find((p) => p.barcode === needle) ?? null;
}

export function findBySku(items: CatalogProduct[], sku: string): CatalogProduct | null {
  const needle = sku.trim();
  if (needle.length === 0) return null;
  return items.find((p) => p.sku === needle) ?? null;
}

export function fuzzySearch(items: CatalogProduct[], q: string, limit = 25): CatalogProduct[] {
  const needle = q.trim().toLowerCase();
  if (needle.length === 0) return [];
  const out: Array<{ p: CatalogProduct; score: number }> = [];
  for (const p of items) {
    const n = p.name.toLowerCase();
    let score = 0;
    if (n === needle) score = 1000;
    else if (n.startsWith(needle)) score = 800;
    else if (n.includes(needle)) score = 500;
    else if (p.sku.toLowerCase().includes(needle)) score = 300;
    if (score > 0) out.push({ p, score });
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, limit).map((x) => x.p);
}
