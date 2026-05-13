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
}

const DB_NAME = "mipiacetpv-catalog";
const STORE = "products";
const VERSION = 1;
const LS_KEY = "mipiacetpv-catalog-fallback";
const META_KEY = "mipiacetpv-catalog-meta";

interface CatalogMeta {
  lastFetchedAt: string;
  count: number;
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
  for (let safety = 0; safety < 200; safety++) {
    const res = await apiWithCashier<{
      items: CatalogProduct[];
      nextCursor: string | null;
    }>(
      `/tpv/catalog/products${cursor ? `?cursor=${cursor}&limit=500` : "?limit=500"}`,
    );
    acc.push(...res.items);
    if (!res.nextCursor) break;
    cursor = res.nextCursor;
  }
  await writeAll(acc);
  setCatalogMeta({ lastFetchedAt: new Date().toISOString(), count: acc.length });
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
