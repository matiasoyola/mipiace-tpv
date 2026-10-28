// Cache de catálogo en IndexedDB con fallback a localStorage si el
// navegador no expone IDB (privacidad estricta). El TPV pinta sin esperar
// a la red; al primer login (o cuando el tenant emita el banner
// "Sincronizando"), refresca contra `/tpv/catalog/products`.

import type { CausaExencion } from "@mipiacetpv/ticket-model";

import { apiWithCashier } from "../api.js";

export interface CatalogProduct {
  id: string;
  // catalogo-local · NULLABLE desde el escalón 2. Un producto que nació
  // en la BD no tiene enlace con Holded y nunca lo tendrá en este
  // bloque. Estaba tipado como `string` y el dato ya llegaba null: el
  // carrito (`cart.ts`) sí lo tenía bien y por eso no reventaba nada,
  // pero el tipo mentía y el siguiente que escriba `p.holdedProductId!`
  // se lo cree.
  holdedProductId: string | null;
  name: string;
  sku: string;
  barcode: string | null;
  basePrice: number;
  priceGross: number;
  taxRate: number;
  // bloque iva-exento-sanitario · causa de exención de la lista L10 (hoy
  // sólo E1, «Exento · sanitario») o null/ausente si la operación es
  // SUJETA. Opcional porque el TPV cachea el catálogo en IndexedDB: un
  // terminal que no ha refrescado todavía tiene fichas del contrato
  // anterior, y una ficha sin el campo es exactamente una ficha sujeta.
  exemptionCause?: CausaExencion | null;
  // kds-1-cocina (decisión 3, capa 3) · los alérgenos del plato, de los 14
  // del anexo II. **Opcional, y vacío NO significa «sin alérgenos»**:
  // significa «no informado». Un terminal con el catálogo cacheado de
  // antes de este bloque tiene fichas sin el campo, y la capa 3 se apaga
  // sola para ellas — las capas 1 y 2 (la alergia de la mesa y la silla
  // del plato) siguen avisando igual.
  //
  // Éste es el camino por el que el TPV puede avisar «¡Lleva gluten!» en
  // el momento en que el camarero asigna las bravas a la silla de la
  // celíaca, SIN BLOQUEAR: a veces la cocina tiene la versión sin gluten.
  allergens?: string[];
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
  // B-reservas-2: duración de agenda (minutos) del servicio. Sólo la traen
  // los servicios con overlay `service_scheduling`; null en productos y
  // servicios sin scheduling. El TPV la pinta informativa por línea de
  // servicio cuando el tenant tiene `agendaEnabled` (base visual para B4).
  durationMin?: number | null;
  /**
   * agenda-1 · ¿es ESTE el servicio con el que se empieza?
   *
   * La marca «Es la primera valoración» de Agenda · Catálogo (clinica-8),
   * que vive en `service_scheduling.primera_valoracion`. En la Clínica
   * demo la lleva «Consulta diagnóstico».
   *
   * Con ella, «¿Qué viene a hacer?» le propone a una paciente SIN citas
   * anteriores su primera visita YA MARCADA, en vez de dejarle la lista
   * entera delante. Es el único dato del sistema que dice cuál es: sin
   * esta marca no se puede adivinar, y adivinarla sería peor que no
   * proponer nada.
   *
   * Opcional como `esBono` y `allergens`: un terminal con el catálogo
   * cacheado de antes del bloque no la trae, y ausente se lee `false` —
   * que es lo que era todo servicio hasta ahora.
   */
  primeraValoracion?: boolean;
  // B-reservas-8 · ¿este producto ES un bono de sesiones? Opcional por lo
  // mismo que `allergens`: un terminal con el catálogo cacheado de antes
  // del bloque no lo trae, y ausente se lee como `false` — que es lo que
  // era todo producto hasta ahora.
  esBono?: boolean;
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
// v1.8-Fiado · flag de venta a crédito del tenant. El TPV lo cachea para
// mostrar el botón "Fiado" en checkout y la entrada a la pantalla Deudas.
const CREDIT_SALES_KEY = "mipiacetpv-catalog-credit-sales";
// B-reservas-1 · capability flag del CRM / ficha de cliente (ADR-R6). El
// TPV lo cachea para mostrar/ocultar la sección Clientes y el atajo F1.
const CRM_ENABLED_KEY = "mipiacetpv-catalog-crm-enabled";
// B-reservas-2 · capability flag de la agenda (ADR-R6). El TPV lo cachea
// para pintar (o no) la duración por línea de servicio en el ticket.
const AGENDA_ENABLED_KEY = "mipiacetpv-catalog-agenda-enabled";
// clinica-2 · capability flag de la HISTORIA CLÍNICA. Mismo patrón que
// sus hermanos, y el default al no saberlo es APAGADA: la columna es
// `@default(false)` y «no lo sé» se parece mucho más a «no lo tiene».
// Fallar hacia encendido pintaría una pestaña «Valoración» en la ficha de
// un cliente de bar, que es contarle que este sistema guarda datos de
// salud de otros. Es la misma dirección de fallo que el gate del servidor
// (clinica-1 §1), y lo contrario que la caja.
const CLINICA_ENABLED_KEY = "mipiacetpv-catalog-clinica-enabled";
// H1 (ADR-016) · capability flag de la CAJA. Lo cacheamos igual que sus
// hermanos, pero con una diferencia que importa: el default al no
// saberlo es ENCENDIDA, porque `caja_enabled` es `@default(true)` y un
// TPV que se esconde a sí mismo por no tener el flag en localStorage
// sería el peor fallo posible. La puerta de verdad es el 403
// CAJA_DISABLED del servidor; esto es sólo para que la PWA pinte la
// frase sin esperar a la red.
const CAJA_ENABLED_KEY = "mipiacetpv-catalog-caja-enabled";
// catalogo-local (addendum 3) · ¿está previsto que el comercio use
// Holded? Mismo default ASIMÉTRICO que `CAJA_ENABLED_KEY`: se compara
// con "0", porque la columna nace en `true` y un TPV que aún no haya
// refrescado tiene que comportarse como antes del bloque.
const HOLDED_ENABLED_KEY = "mipiacetpv-catalog-holded-enabled";

// puesta-en-marcha (ADR-021) · ¿esta cuenta está EN ENSAYO?
//
// Default ASIMÉTRICO al revés que sus vecinas, y es la decisión de esta
// clave: se compara con "1", así que un TPV que todavía no sepa nada se
// comporta como una cuenta que factura. El error de este lado es no pintar
// la banda en un ensayo —se arregla al primer refresco, y el servidor no
// emite nada de todas formas—; el del otro sería pintar «estos cobros no son
// facturas» encima de la venta de Sole, que es mentira y le asusta a la
// clienta.
//
// Quien la escribe de verdad es el LOGIN, no el catálogo: la banda tiene que
// estar puesta antes de que nadie pueda cobrar.
const ENSAYO_KEY = "mipiacetpv-tenant-ensayo";

// B-reservas-8 · ¿está PUESTO el candado de primer uso de la numeración de
// bonos? Mientras lo esté, el centro no puede vender ninguno.
//
// Default ASIMÉTRICO como el de la banda de ensayo, y al revés que
// `CAJA_ENABLED_KEY`: se compara con "1", así que un TPV que todavía no
// sepa nada deja añadir el bono y es **el servidor quien lo para** con su
// 409. El error de este lado es dejar tocar un bono que el servidor va a
// rechazar —con su frase, y sin haber cobrado nada—; el del otro sería
// esconderle el bono a un centro que SÍ lo tiene confirmado, y eso es una
// venta que no se hace.
const BONOS_CANDADO_KEY = "mipiacetpv-bonos-candado";

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

// v1.8-Fiado · true sólo si el tenant tiene la venta a crédito activada.
export function getCachedCreditSalesEnabled(): boolean {
  return localStorage.getItem(CREDIT_SALES_KEY) === "1";
}

export function setCachedCreditSalesEnabled(value: boolean): void {
  localStorage.setItem(CREDIT_SALES_KEY, value ? "1" : "0");
}

// B-reservas-1 · true sólo si el tenant tiene el CRM activado (ADR-R6).
export function getCachedCrmEnabled(): boolean {
  return localStorage.getItem(CRM_ENABLED_KEY) === "1";
}

export function setCachedCrmEnabled(value: boolean): void {
  localStorage.setItem(CRM_ENABLED_KEY, value ? "1" : "0");
}

// clinica-2 · true sólo si el tenant tiene la historia clínica encendida.
export function getCachedClinicaEnabled(): boolean {
  return localStorage.getItem(CLINICA_ENABLED_KEY) === "1";
}

export function setCachedClinicaEnabled(value: boolean): void {
  localStorage.setItem(CLINICA_ENABLED_KEY, value ? "1" : "0");
}

// B-reservas-2 · true sólo si el tenant tiene la agenda activada (ADR-R6).
export function getCachedAgendaEnabled(): boolean {
  return localStorage.getItem(AGENDA_ENABLED_KEY) === "1";
}

export function setCachedAgendaEnabled(value: boolean): void {
  localStorage.setItem(AGENDA_ENABLED_KEY, value ? "1" : "0");
}

// H1 · `true` salvo que el servidor haya dicho explícitamente que no.
// Ojo a la asimetría con sus hermanos: aquí el default es `true` (ver la
// nota de `CAJA_ENABLED_KEY`), así que se compara con "0" y no con "1".
export function getCachedCajaEnabled(): boolean {
  return localStorage.getItem(CAJA_ENABLED_KEY) !== "0";
}

export function setCachedCajaEnabled(value: boolean): void {
  localStorage.setItem(CAJA_ENABLED_KEY, value ? "1" : "0");
}

// catalogo-local (addendum 3) · `true` salvo que el servidor haya dicho
// explícitamente que no. Misma asimetría que `getCachedCajaEnabled`.
export function getCachedHoldedEnabled(): boolean {
  return localStorage.getItem(HOLDED_ENABLED_KEY) !== "0";
}

export function setCachedHoldedEnabled(value: boolean): void {
  localStorage.setItem(HOLDED_ENABLED_KEY, value ? "1" : "0");
}

// puesta-en-marcha (ADR-021) · `false` salvo que el servidor haya dicho
// explícitamente que sí. Ver la nota de `ENSAYO_KEY`.
export function getCachedEnsayo(): boolean {
  return localStorage.getItem(ENSAYO_KEY) === "1";
}

// B-reservas-8 · `true` sólo si el catálogo trajo el candado PUESTO. Ver
// la nota de `BONOS_CANDADO_KEY` para el porqué del default.
export function getCachedBonosCandadoPuesto(): boolean {
  return localStorage.getItem(BONOS_CANDADO_KEY) === "1";
}

export function setCachedBonosCandadoPuesto(value: boolean): void {
  localStorage.setItem(BONOS_CANDADO_KEY, value ? "1" : "0");
}

export function setCachedEnsayo(value: boolean): void {
  localStorage.setItem(ENSAYO_KEY, value ? "1" : "0");
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
  let lastCreditSales: boolean | undefined = undefined;
  let lastCrmEnabled: boolean | undefined = undefined;
  let lastClinicaEnabled: boolean | undefined = undefined;
  let lastAgendaEnabled: boolean | undefined = undefined;
  let lastCajaEnabled: boolean | undefined = undefined;
  let lastHoldedEnabled: boolean | undefined = undefined;
  let lastEnsayo: boolean | undefined = undefined;
  let lastBonosCandado: boolean | undefined = undefined;
  for (let safety = 0; safety < 200; safety++) {
    const res = await apiWithCashier<{
      items: CatalogProduct[];
      nextCursor: string | null;
      tenantId: string;
      businessType?: BusinessType;
      tpvIconPreset?: string | null;
      tagAliases?: Array<{ slug: string; label: string }>;
      creditSalesEnabled?: boolean;
      crmEnabled?: boolean;
      agendaEnabled?: boolean;
      clinicalRecordsEnabled?: boolean;
      cajaEnabled?: boolean;
      holdedEnabled?: boolean;
      ensayo?: boolean;
      bonosEnabled?: boolean;
      bonosCandadoPuesto?: boolean;
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
    if (res.creditSalesEnabled !== undefined) {
      lastCreditSales = res.creditSalesEnabled;
    }
    if (res.crmEnabled !== undefined) {
      lastCrmEnabled = res.crmEnabled;
    }
    if (res.agendaEnabled !== undefined) {
      lastAgendaEnabled = res.agendaEnabled;
    }
    if (res.clinicalRecordsEnabled !== undefined) {
      lastClinicaEnabled = res.clinicalRecordsEnabled;
    }
    if (res.cajaEnabled !== undefined) {
      lastCajaEnabled = res.cajaEnabled;
    }
    if (res.holdedEnabled !== undefined) {
      lastHoldedEnabled = res.holdedEnabled;
    }
    // puesta-en-marcha (ADR-021) · esto es lo que QUITA la banda sin salir
    // de la sesión el día de la visita: el super-admin pulsa «Empezar a
    // facturar» y el siguiente refresco del catálogo lo trae.
    if (res.ensayo !== undefined) {
      lastEnsayo = res.ensayo;
    }
    // B-reservas-8 · esto es lo que ABRE el candado sin salir de la sesión:
    // el encargado confirma el número de arranque en Ajustes y el siguiente
    // refresco del catálogo lo trae.
    if (res.bonosCandadoPuesto !== undefined) {
      lastBonosCandado = res.bonosCandadoPuesto;
    }
    if (!res.nextCursor) break;
    cursor = res.nextCursor;
  }
  await writeAll(acc);
  setCatalogMeta({ lastFetchedAt: new Date().toISOString(), count: acc.length });
  if (lastTenantId) localStorage.setItem(TENANT_ID_KEY, lastTenantId);
  if (lastBusinessType) setCachedBusinessType(lastBusinessType);
  if (lastIconPreset !== undefined) setCachedIconPreset(lastIconPreset);
  if (lastCreditSales !== undefined) setCachedCreditSalesEnabled(lastCreditSales);
  if (lastCrmEnabled !== undefined) setCachedCrmEnabled(lastCrmEnabled);
  if (lastClinicaEnabled !== undefined) {
    setCachedClinicaEnabled(lastClinicaEnabled);
  }
  if (lastAgendaEnabled !== undefined) setCachedAgendaEnabled(lastAgendaEnabled);
  if (lastCajaEnabled !== undefined) setCachedCajaEnabled(lastCajaEnabled);
  if (lastHoldedEnabled !== undefined) setCachedHoldedEnabled(lastHoldedEnabled);
  if (lastEnsayo !== undefined) setCachedEnsayo(lastEnsayo);
  if (lastBonosCandado !== undefined) setCachedBonosCandadoPuesto(lastBonosCandado);
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
