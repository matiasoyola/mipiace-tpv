// Pantalla de venta rápida (B4 §2). Tres áreas:
//   - Topbar: búsqueda, identidad de cajero, banners de estado sync.
//   - Workspace izquierdo: chips de categorías, grid de productos,
//     quick actions (Desc., Nota, Cliente, Más).
//   - Aside derecha: ticket panel con líneas, totales, botón Cobrar.
//
// Datos: catálogo cacheado en IndexedDB (lib/catalog.ts), refresh
// asíncrono al primer mount. Carrito en useState, persistido a través
// de suspender/recuperar.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bookmark,
  Briefcase,
  Calculator,
  Check,
  CircleAlert,
  Coffee,
  Dumbbell,
  GraduationCap,
  Loader2,
  Lock,
  Menu,
  Package,
  Plus,
  PowerOff,
  RotateCw,
  ScanLine,
  Scissors,
  Search,
  ShoppingBag,
  Sparkles,
  Star,
  Stethoscope,
  Wifi,
  WifiOff,
  Wrench,
  X,
} from "lucide-react";

import { ApiError } from "../api.js";
import { Logo } from "../Logo.js";
import {
  computeCart,
  getSuspendedCarts,
  removeSuspendedCart,
  saveSuspendedCart,
  type CartLine,
  type SuspendedCart,
} from "../lib/cart.js";
import {
  findByBarcode,
  fuzzySearch,
  getCachedBusinessType,
  getCachedIconPreset,
  getCachedTagAliases,
  getCachedTenantId,
  loadCatalogFromCache,
  loadWildcards,
  productImageUrl,
  refreshCatalog,
  type BusinessType,
  type CatalogProduct,
  type Wildcard,
} from "../lib/catalog.js";
import { CartLineItem } from "./CartLineItem.js";
import { CameraScanModal, hasCameraSupport } from "./SalePage.cameraScan.js";
import { ContactSheet, type ContactRef } from "./SalePage.contact.js";
import { CheckoutOverlay } from "./CheckoutPage.js";
import { CloseShiftModal } from "./CloseShiftModal.js";
import { LineSheet } from "./SalePage.lineSheet.js";
import { ModifierSelector } from "./SalePage.modifierSelector.js";
import { MoveTablePicker } from "./SalePage.movePicker.js";
import { SplitBillSheet } from "./SalePage.splitBill.js";
import { TicketsHistoryPage } from "./TicketsHistoryPage.js";
import { useElapsedTime } from "../hooks/useElapsedTime.js";
import { useStoreEventStream } from "../hooks/useStoreEventStream.js";
import type { ModifierSelection } from "../lib/cart.js";
import { newId } from "../lib/ids.js";
import {
  buildGroupsByProduct,
  loadModifierGroups,
  type CatalogModifierGroup,
} from "../lib/modifiers.js";
import { syncNow } from "../lib/syncNow.js";
import { vocab } from "../lib/vocab.js";

const formatEur = (n: number) => n.toFixed(2).replace(".", ",") + " €";

// v1.2-Lite Lote 3.A: los tags se persisten en lowercase para evitar
// duplicados visuales (Thalia tenía chips "Papelería"/"papeleria" como
// dos entradas distintas). Al renderizar capitalizamos la primera letra
// para que el chip se siga viendo bonito. No usamos toTitleCase porque
// algunos tags llevan acrónimos (BBQ, IPA) que no queremos partir; con
// upper-on-first respetamos eso.
//
// v1.3-hotfix5: muchos clientes usan prefijo numérico para ordenar las
// tags en Holded ("01cortesypeinados", "02depilc"…). El número no
// aporta nada en el TPV — sólo es orden de visualización. Lo quitamos
// al renderizar. Si el tag tiene separadores (-, _, espacios), se
// capitaliza palabra a palabra; si no, sólo la primera letra.
function capitalizeTag(tag: string): string {
  if (tag.length === 0) return tag;
  // 1. Quitar prefijo numérico de orden (con opcional separador después).
  const withoutPrefix = tag.replace(/^\d+[-_.\s]?/, "");
  const clean = withoutPrefix.length > 0 ? withoutPrefix : tag;
  // 2. Si hay separadores, capitalizar cada palabra. Si no, sólo la
  //    primera letra (caso "cortesypeinados" → "Cortesypeinados", el
  //    cliente puede editar el tag en Holded a "01-cortes-peinados"
  //    para que salga "Cortes Peinados" si quiere refinar).
  if (/[-_.\s]/.test(clean)) {
    return clean
      .split(/[-_.\s]+/)
      .filter((w) => w.length > 0)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
  }
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

// v1.3-Operativa-Extra · Lote 1: si el OWNER ha mapeado este slug
// en /admin/tag-aliases, gana sobre la capitalización automática.
// El mapa lo refresca refreshCatalog() junto al catálogo, así que
// alta/edición de alias se ve tras el siguiente "Sincronizando".
function renderTagLabel(tag: string, aliases: Record<string, string>): string {
  const aliased = aliases[tag];
  if (typeof aliased === "string" && aliased.length > 0) return aliased;
  return capitalizeTag(tag);
}

// B-Multi-Vertical SB3: icono del placeholder según vertical. Fallback
// a Package (retail genérico) si el tenant aún no ha refrescado el
// catálogo desde el deploy de SB3.
const PLACEHOLDER_ICON_BY_TYPE: Record<BusinessType, typeof Package> = {
  HOSPITALITY: Coffee,
  RETAIL: Package,
  SERVICES: Briefcase,
};

// v1.3-hotfix6 · presets de subvertical configurables desde super-admin
// (campo Tenant.tpvIconPreset). Si el cliente elige uno, gana sobre el
// icono genérico del businessType (peluquería ve tijeras, clínica ve
// estetoscopio, etc.). Cualquier valor no listado cae al icono del
// businessType — permite añadir presets futuros sin tocar este código
// (sólo añadir entrada al map).
const PLACEHOLDER_ICON_BY_PRESET: Record<string, typeof Package> = {
  haircut: Scissors,
  medical: Stethoscope,
  auto_repair: Wrench,
  beauty: Sparkles,
  fitness: Dumbbell,
  education: GraduationCap,
};

function placeholderIconFor(
  type: BusinessType | null,
  preset: string | null,
): typeof Package {
  if (preset && PLACEHOLDER_ICON_BY_PRESET[preset]) {
    return PLACEHOLDER_ICON_BY_PRESET[preset];
  }
  if (!type) return Package;
  return PLACEHOLDER_ICON_BY_TYPE[type] ?? Package;
}

interface HealthStatus {
  // B6 §3: el backend devuelve `level` + `reason` calculados (no
  // recalculamos en el cliente para mantener el cliente "tonto" y
  // consistente entre admin/TPV).
  level: "ok" | "warning" | "blocked";
  reason: string;
  hasHoldedKey: boolean;
  lastIncrementalSyncAt: string | null;
  lastSyncAgeMs: number | null;
  blockedAt: string | null;
  pendingSyncCount: number;
  syncFailedCount: number;
}

// Resumen mínimo de la mesa abierta cuando el TPV viene del mapa
// de sala (B7 §4). Define el header del panel de ticket y oculta el
// botón "Suspender" (la mesa abierta YA es "venta suspendida" por
// naturaleza). La conexión real con los endpoints `POST /tables/...` y
// la persistencia se cablea en F4.
export interface TableContext {
  id: string;
  name: string;
  zone: "SALON" | "TERRAZA" | "BARRA" | "RESERVADO";
  capacity: number;
  diners: number | null;
  openedAt: string | null;
  openedByEmail: string | null;
  activeTicketId: string | null;
}

export interface SalePageProps {
  shiftId: string;
  cashierEmail: string;
  cashierRole: "MANAGER" | "CASHIER";
  registerName: string;
  registerId: string;
  storeName: string;
  // Si la pantalla se abre desde el mapa de sala (B7), recibe el
  // contexto de la mesa. Si es venta rápida (retail o "café para
  // llevar" en bar), queda null/undefined.
  tableContext?: TableContext | null;
  // Sólo provisto cuando la tienda tiene mesas configuradas — permite
  // al cajero volver al mapa con un toque. Null en modo retail puro.
  onBackToMap?: (() => void) | null;
  // v1.4-Bar-Operativa-MVP Lote 3 · al mover un ticket DRAFT a otra
  // mesa, el SalePage delega al padre cómo actualizar `tableContext`.
  // El padre carga `/tpv/tables`, encuentra la mesa destino y vuelve
  // a renderizar SalePage con el contexto nuevo. Null en retail puro.
  onTicketMovedToTable?: ((newTableId: string) => void) | null;
  onLogoutCashier: () => void;
  onCloseShift: () => void;
}

// P-1 (v1.1 peluquería): persistencia del toggle Servicios/Productos
// para verticales SERVICES.
const KIND_FILTER_KEY = "mipiacetpv-sale-kind-filter";

export function SalePage(props: SalePageProps) {
  // v1.3-Servicios-Pinta · Lote 1: vertical del tenant, cacheada al
  // último refresh del catálogo. Decide el copy del topbar, sheets y
  // panel del ticket. Si aún no se ha llenado (sesión preexistente al
  // deploy), `vocab()` cae al copy de RETAIL — comportamiento idéntico
  // al de hoy.
  const businessType = getCachedBusinessType();
  const [showCloseShift, setShowCloseShift] = useState(false);
  // v1.3 Lote 4 · arqueo X intermedio. Reusa el mismo modal con `mode="X"`.
  const [showArqueoX, setShowArqueoX] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  // v1.3 Lote 5 · modal cámara para escanear barcode. Sólo se monta
  // tras pulsar el botón porque la inicialización pide permiso de
  // cámara y abre el LED del iPad — no queremos esto al cargar la
  // pantalla.
  const [showCameraScan, setShowCameraScan] = useState(false);
  // v1.3-UX-Iteración Lote 1: sidebar reemplazado por drawer off-canvas.
  // En apaisado tablet la columna fija comía ancho útil del catálogo,
  // así que ahora el menú lateral aparece desde la izquierda al pulsar
  // el botón hamburger del topbar y se cierra al pulsar fuera, al
  // pulsar Esc o al pulsar cualquier acción del drawer. No persiste:
  // el estado por defecto es cerrado.
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Esc cierra el drawer (accesibilidad teclado). Sólo escuchamos
  // mientras está abierto para no contaminar el resto de listeners.
  useEffect(() => {
    if (!drawerOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setDrawerOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [drawerOpen]);
  // v1.3-UX-Iteración Lote 3 · estado del botón "Sincronizar
  // catálogo" del drawer. Tres fases: idle (texto normal),
  // running (spinner), done (check 1.5s). El feedback efímero
  // confirma al cajero que pulsó el botón sin necesidad de un
  // toast aparte.
  const [syncState, setSyncState] = useState<"idle" | "running" | "done">(
    "idle",
  );
  const [catalog, setCatalog] = useState<CatalogProduct[] | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [wildcards, setWildcards] = useState<Wildcard[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  // v1.4-Bar-Operativa-MVP Lote 2 · estado del envío de comanda.
  // `kitchenBusy` deshabilita el botón mientras el backend responde
  // y se generan los PDFs; `kitchenRevision` arranca a 0 y se sube
  // tras cada envío exitoso (el TPV no relee el ticket entre
  // mensajes — los DRAFT no se serializan hacia este componente,
  // así que mantenemos el contador en memoria mientras dure la mesa).
  // Al cambiar de mesa o cerrar sesión, el state se reinicializa.
  const [kitchenBusy, setKitchenBusy] = useState(false);
  const [kitchenRevision, setKitchenRevision] = useState(0);
  const [kitchenToast, setKitchenToast] = useState<{
    sections: Array<{ section: string; lineCount: number }>;
    revision: number;
  } | null>(null);
  const [kitchenError, setKitchenError] = useState<string | null>(null);

  // v1.4-Bar-Operativa-MVP Lote 3 · estado del mover-mesa.
  const [showMoveTable, setShowMoveTable] = useState(false);
  const [moveBusy, setMoveBusy] = useState(false);
  const [moveError, setMoveError] = useState<string | null>(null);

  // v1.4-Bar-Operativa-MVP Lote 4 · sheet partir cuenta (Modo A).
  const [showSplitBill, setShowSplitBill] = useState(false);

  // Cuando el cajero cambia de mesa o sale del modo mesa, reiniciamos
  // el contador local de comandas. El backend mantiene la verdad
  // (Ticket.lastSentRevision), pero como SalePage no recarga el
  // ticket DRAFT entre interacciones, este state es el que decide
  // si el botón rotula "Enviar" o "Reenviar".
  const activeTicketId = props.tableContext?.activeTicketId ?? null;
  useEffect(() => {
    setKitchenRevision(0);
    setKitchenToast(null);
    setKitchenError(null);
  }, [activeTicketId]);

  const [lines, setLines] = useState<CartLine[]>([]);
  const [contact, setContact] = useState<ContactRef | null>(null);
  const [notes, setNotes] = useState<string>("");

  const [query, setQuery] = useState("");
  const [openSheet, setOpenSheet] = useState<
    | { kind: "line"; line: CartLine }
    | { kind: "discountGlobal" }
    | { kind: "freeLine" }
    | { kind: "contact" }
    | { kind: "suspended" }
    | { kind: "checkout" }
    | { kind: "notes" }
    | null
  >(null);

  // B-Bar-Modifiers · catálogo de grupos. Se descarga en paralelo al
  // catálogo principal. Si falla, el TPV sigue funcionando — los
  // productos con modifiers simplemente se añaden directamente sin
  // pasar por el modal (degradación graceful).
  const [modifierGroups, setModifierGroups] = useState<CatalogModifierGroup[]>(
    [],
  );
  const groupsByProduct = useMemo(
    () => buildGroupsByProduct(modifierGroups),
    [modifierGroups],
  );
  const [selectorState, setSelectorState] = useState<
    { product: CatalogProduct; groups: CatalogModifierGroup[] } | null
  >(null);

  const searchRef = useRef<HTMLInputElement | null>(null);

  // ── Carga inicial del catálogo ─────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const cached = await loadCatalogFromCache();
      if (!cancelled && cached.length > 0) setCatalog(cached);
      // refresh en background — no bloquea la UI.
      try {
        const fresh = await refreshCatalog();
        if (!cancelled) setCatalog(fresh);
      } catch (err) {
        if (!cancelled && cached.length === 0) {
          setCatalogError(
            err instanceof ApiError
              ? err.message
              : "No se pudo cargar el catálogo. Verifica la conexión.",
          );
        }
      }
      try {
        const w = await loadWildcards();
        if (!cancelled) setWildcards(w);
      } catch {
        /* sin comodines: ignoramos, el cajero no podrá hacer línea libre */
      }
      try {
        const mods = await loadModifierGroups();
        if (!cancelled) setModifierGroups(mods);
      } catch {
        /* sin modifiers: el TPV sigue añadiendo líneas directo (B-Bar-Modifiers) */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Banner de salud Holded (polling cada 30s) ──────────────────────
  const [health, setHealth] = useState<HealthStatus | null>(null);

  // Mejora-02: contador de tickets del turno actual. Lo refrescamos
  // junto al polling de salud (cada 30s) para que tras cobrar un
  // ticket nuevo aparezca el incremento sin recargar la página.
  // El endpoint /shift/current devuelve `shift.ticketsCount` con el
  // total NO-DRAFT NO-VOIDED del turno.
  const [shiftTicketsCount, setShiftTicketsCount] = useState<number | null>(null);
  const refreshShiftTicketsCount = useCallback(async () => {
    try {
      const { apiWithCashier } = await import("../api.js");
      const res = await apiWithCashier<{
        shift: { id: string; ticketsCount: number } | null;
      }>("/shift/current");
      if (res.shift) setShiftTicketsCount(res.shift.ticketsCount);
    } catch {
      /* tolera puntuales — el contador es informativo */
    }
  }, []);
  useEffect(() => {
    void refreshShiftTicketsCount();
  }, [refreshShiftTicketsCount]);

  // Lote 4 v1.1 Thalia: subscripción al bus realtime para que dos
  // cajas del mismo store vean los tickets cobrados/devueltos por la
  // otra sin esperar al polling de 30s. Necesitamos el storeId del
  // cashier — /tpv/tables ya lo devuelve para cualquier vertical.
  const [storeId, setStoreId] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { apiWithCashier } = await import("../api.js");
        const res = await apiWithCashier<{ storeId: string | null }>("/tpv/tables");
        if (!cancelled) setStoreId(res.storeId);
      } catch {
        /* sin storeId, el WS no abrirá — degrada a polling */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  const [crossCajaToast, setCrossCajaToast] = useState<{
    text: string;
    expiresAt: number;
  } | null>(null);
  useStoreEventStream(storeId, (ev) => {
    if (ev.type === "ticket.paid") {
      // Si soy yo el que cobró, el contador ya se refresca por su
      // propio camino (polling tras checkout). Ignoramos eco-events.
      if (ev.registerId === props.registerId) return;
      void refreshShiftTicketsCount();
      setCrossCajaToast({
        text: `Otra caja cobró un ticket (${ev.totalEur.toFixed(2)} €)`,
        expiresAt: Date.now() + 4_000,
      });
    } else if (ev.type === "ticket.refunded") {
      void refreshShiftTicketsCount();
      setCrossCajaToast({
        text: `Devolución registrada en otra caja (${ev.totalEur.toFixed(2)} €)`,
        expiresAt: Date.now() + 4_000,
      });
    }
  });
  useEffect(() => {
    if (!crossCajaToast) return;
    const remaining = crossCajaToast.expiresAt - Date.now();
    if (remaining <= 0) {
      setCrossCajaToast(null);
      return;
    }
    const t = setTimeout(() => setCrossCajaToast(null), remaining);
    return () => clearTimeout(t);
  }, [crossCajaToast]);

  useEffect(() => {
    let cancelled = false;
    async function tick() {
      try {
        const { apiWithCashier } = await import("../api.js");
        const res = await apiWithCashier<HealthStatus>("/tpv/health/holded");
        if (!cancelled) setHealth(res);
      } catch {
        /* tolera puntuales */
      }
      if (!cancelled) {
        // Refrescamos también el contador de tickets del turno en
        // cada tick — barato comparado con el polling principal.
        void refreshShiftTicketsCount();
        setTimeout(tick, 30_000);
      }
    }
    tick();
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Foco permanente al input de búsqueda para el scanner USB-HID ───
  // v1.3-UX-Iteración-fixes Fix 2: en tablets táctiles (Android piloto)
  // este refocus se disparaba al montar y en cada tap del cajero,
  // abriendo el IME constantemente. Lo limitamos a dispositivos con
  // pointer fino (mouse o lector USB-HID, donde el patrón original sí
  // tiene sentido). En táctil el cajero tiene que tocar el input
  // explícitamente para escribir, y el scan se hace con cámara
  // (botón Escanear del header).
  useEffect(() => {
    if (
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(pointer: coarse)").matches
    ) {
      return;
    }
    function refocus() {
      if (
        document.activeElement === document.body ||
        !document.activeElement
      ) {
        searchRef.current?.focus();
      }
    }
    refocus();
    document.addEventListener("click", refocus);
    return () => document.removeEventListener("click", refocus);
  }, []);

  // ── Scanner barcode: si el texto pegado termina en Enter y matchea
  //    un barcode, añadir y vaciar. En este flujo NO interceptamos con
  //    el modal de modifiers — el cajero está escaneando, querrá la
  //    línea directa. Si el producto requiere selección, abrimos el
  //    modal igual (no podemos asumir cuándo es "scan" vs "fuzzy
  //    teclado").
  // v1.3 Lote 5 · factorizado para que el lector cámara reutilice el
  // MISMO camino que el USB-HID. Devuelve true si encontró producto.
  const addByBarcode = useCallback(
    (code: string): boolean => {
      const value = code.trim();
      if (!value || !catalog) return false;
      const byBarcode = findByBarcode(catalog, value);
      if (byBarcode) {
        addProduct(byBarcode);
        return true;
      }
      return false;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [catalog, groupsByProduct],
  );
  const onSearchKey = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key !== "Enter") return;
      const value = query.trim();
      if (!value || !catalog) return;
      if (addByBarcode(value)) {
        setQuery("");
        return;
      }
      const hits = fuzzySearch(catalog, value, 1);
      if (hits[0]) {
        addProduct(hits[0]);
        setQuery("");
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [query, catalog, groupsByProduct],
  );

  // ── Operaciones sobre el carrito ───────────────────────────────────
  // v1.3-hotfix · `crypto.randomUUID` no existe en Chrome < 92 (Android
  // 11 stock WebView). `newId` ahora vive en `../lib/ids` con fallback.

  // Inserta el producto en el carrito sin pasar por el modal de modifiers.
  // Usado por barcode scan, fuzzy search Enter, y por el confirm del modal.
  function pushProductLine(
    p: CatalogProduct,
    options: {
      units?: number;
      modifierSelections?: ModifierSelection[];
    } = {},
  ): void {
    const units = options.units ?? 1;
    const sels = options.modifierSelections ?? [];
    setLines((curr) => {
      // Agrupar con línea previa sólo si NINGUNA tiene modifiers — dos
      // cafés "Con leche desnatada" pueden agruparse, pero un "Con
      // desnatada" y uno "Con entera" no.
      const existing =
        sels.length === 0
          ? curr.find(
              (l) =>
                l.productId === p.id &&
                l.modifiers.length === 0 &&
                (!l.modifierSelections || l.modifierSelections.length === 0),
            )
          : null;
      if (existing) {
        return curr.map((l) =>
          l.id === existing.id ? { ...l, units: l.units + units } : l,
        );
      }
      const newLine: CartLine = {
        id: newId(),
        productId: p.id,
        variantId: null,
        holdedProductId: p.holdedProductId,
        sku: p.sku,
        nameSnapshot: p.name,
        units,
        unitPrice: p.basePrice,
        unitPriceOverride: null,
        priceGross: p.priceGross,
        discountPct: 0,
        taxRate: p.taxRate,
        modifiers: [],
        modifierSelections: sels.length > 0 ? sels : undefined,
      };
      return [...curr, newLine];
    });
  }

  // Punto de entrada general: si el producto tiene grupos asociados,
  // abre el modal; si no, añade directo. Para barcode scans y atajos
  // del teclado preferimos no interrumpir el flow, así que ahí se
  // llama a `pushProductLine` directo.
  function addProduct(p: CatalogProduct, units = 1): void {
    const groups = groupsByProduct.get(p.id);
    if (groups && groups.length > 0) {
      setSelectorState({ product: p, groups });
      return;
    }
    pushProductLine(p, { units });
  }

  function addFreeLine(input: {
    name: string;
    price: number; // bruto con IVA, el cajero introduce precio final
    taxRate: number;
  }): void {
    const wc = wildcards.find((w) => Math.abs(w.taxRate - input.taxRate) < 0.01);
    if (!wc) return;
    const basePrice = input.price / (1 + input.taxRate / 100);
    const newLine: CartLine = {
      id: newId(),
      productId: null,
      variantId: null,
      holdedProductId: wc.holdedProductId,
      sku: wc.sku,
      nameSnapshot: input.name,
      units: 1,
      unitPrice: Math.round(basePrice * 100) / 100,
      unitPriceOverride: null,
      priceGross: input.price,
      discountPct: 0,
      taxRate: input.taxRate,
      modifiers: [],
    };
    setLines((curr) => [...curr, newLine]);
  }

  function updateLine(id: string, patch: Partial<CartLine>): void {
    setLines((curr) => curr.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }

  function removeLine(id: string): void {
    setLines((curr) => curr.filter((l) => l.id !== id));
  }

  function applyGlobalDiscount(pct: number): void {
    setLines((curr) =>
      curr.map((l) => ({
        ...l,
        discountPct: Math.min(100, Math.max(0, pct)),
      })),
    );
  }

  function clearCart(): void {
    setLines([]);
    setContact(null);
    setNotes("");
  }

  function suspendCart(label: string): void {
    const cart: SuspendedCart = {
      id: newId(),
      label: label || `Ticket ${new Date().toLocaleTimeString("es-ES")}`,
      createdAt: new Date().toISOString(),
      lines,
      contactHoldedId: contact?.holdedContactId,
      contactName: contact?.name,
      notes,
    };
    saveSuspendedCart(cart);
    clearCart();
  }

  function recoverCart(cart: SuspendedCart): void {
    setLines(cart.lines);
    setNotes(cart.notes ?? "");
    if (cart.contactHoldedId) {
      setContact({
        id: "recovered",
        holdedContactId: cart.contactHoldedId,
        name: cart.contactName ?? "Cliente",
      });
    }
    removeSuspendedCart(cart.id);
  }

  // v1.4-Bar-Operativa-MVP Lote 2 · envía la comanda al backend, que
  // genera un PDF por sección. Abrimos cada PDF en una pestaña/iframe
  // nueva — el navegador/PWA lo manda a la impresora del register al
  // pulsar imprimir. Cuando llegue el agente local (v1.5),
  // sustituiremos el `window.open` por un POST al daemon que
  // imprimirá en la térmica de cada sección sin diálogo del SO.
  // v1.4-Impresoras-Fase-1 Lote 3 · llama al endpoint ESC/POS que
  // manda la comanda por TCP a la impresora WIFI de cada sección.
  // Sustituye el flujo anterior de PDFs por pestaña (legible pero
  // requería un clic por sección).
  async function sendToKitchen(): Promise<void> {
    const tableContext = props.tableContext;
    if (!tableContext?.activeTicketId) return;
    setKitchenBusy(true);
    setKitchenError(null);
    try {
      const { apiWithCashier } = await import("../api.js");
      const res = await apiWithCashier<{
        revision: number;
        sentAt: string;
        sections: Array<{
          section: "BARRA" | "COCINA" | "SALON";
          ok: boolean;
          lineCount: number;
          error?: string;
        }>;
      }>(`/tickets/${tableContext.activeTicketId}/send-to-kitchen/escpos`, {
        method: "POST",
      });
      setKitchenRevision(res.revision);
      setKitchenToast({
        sections: res.sections.map((s) => ({
          section: s.section,
          lineCount: s.lineCount,
        })),
        revision: res.revision,
      });
      // Si alguna sección falló pero otras imprimieron, lo flageamos
      // como error parcial para que el cajero vea qué no llegó.
      const failed = res.sections.filter((s) => !s.ok);
      if (failed.length > 0) {
        setKitchenError(
          `Comanda no enviada: ${failed
            .map((f) => `${f.section}${f.error ? ` (${f.error})` : ""}`)
            .join(", ")}`,
        );
      }
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.message
          : "No se pudo enviar la comanda. Reinténtalo.";
      setKitchenError(msg);
    } finally {
      setKitchenBusy(false);
    }
  }

  // v1.4-Bar-Operativa-MVP Lote 3 · llama al endpoint move-to-table y
  // delega al padre el cambio de `tableContext`. El padre se encarga
  // de recargar el listado de mesas y montar SalePage con la nueva.
  // No limpiamos `lines`/`contact`/`notes` aquí porque el ticket es
  // el mismo (sólo cambia tableId server-side) y el remontaje del
  // padre traerá un useEffect que recargue el DRAFT si hace falta.
  async function moveToTable(destination: { id: string; name: string }) {
    const ticketId = props.tableContext?.activeTicketId;
    if (!ticketId) {
      setMoveError("No hay ticket abierto en esta mesa.");
      return;
    }
    setMoveBusy(true);
    setMoveError(null);
    try {
      const { apiWithCashier } = await import("../api.js");
      await apiWithCashier<{ ticketId: string; newTableId: string }>(
        `/tickets/${ticketId}/move-to-table`,
        { method: "POST", body: { newTableId: destination.id } },
      );
      setShowMoveTable(false);
      if (props.onTicketMovedToTable) {
        props.onTicketMovedToTable(destination.id);
      }
    } catch (err) {
      // 409 → mesa destino ocupada (carrera con otra tablet).
      const msg =
        err instanceof ApiError
          ? err.message
          : "No se pudo mover el ticket. Reinténtalo.";
      setMoveError(msg);
    } finally {
      setMoveBusy(false);
    }
  }

  const totals = useMemo(() => computeCart(lines), [lines]);
  const filtered = useMemo(() => {
    if (!catalog) return [];
    if (query.trim().length === 0) {
      // v1.3-hotfix12 · ANTES había `catalog.slice(0, 40)` "para evitar
      // renderizar muchos tiles". Con cuentas reales (Peluquería Sole,
      // 86 productos) recortaba los servicios/productos posteriores a la
      // M alfabética → bug visible (chips de "Tinte y color" mostraban
      // 1 de 10 servicios). Devolvemos el catálogo completo; los chips
      // de categoría y el toggle Servicios/Productos ya limitan el grid
      // visible. Si en el futuro tenemos cuentas con >500 productos,
      // virtualizamos el grid en vez de truncar.
      return catalog;
    }
    return fuzzySearch(catalog, query, 40);
  }, [catalog, query]);

  // ── Render ─────────────────────────────────────────────────────────
  return (
    <div
      className="h-screen overflow-hidden bg-mipiace-stone flex flex-col font-sans"
      // v1.3-UX-Iteración Lote 2: el padding-bottom dinámico empuja el
      // contenido hacia arriba cuando aparece el teclado virtual, así
      // los elementos críticos (footer del ticket, sheets) quedan
      // visibles en vez de ocultos detrás del teclado.
      style={{ paddingBottom: "var(--keyboard-offset, 0px)" }}
    >
      {/* Lote 4 v1.1 Thalia: toast cross-caja. Aparece cuando otra
          caja del mismo store cobra o devuelve, para que el cajero
          actual no intente cobrar dos veces. Top-right, auto-dismiss
          en 4s. */}
      {crossCajaToast && (
        <div className="fixed top-4 right-4 z-[60] max-w-[320px] bg-slate-900 text-white rounded-xl px-4 py-3 shadow-lg text-[13px] font-medium pointer-events-none">
          {crossCajaToast.text}
        </div>
      )}
      <div className="flex-1 min-h-0 flex max-w-[1680px] w-full mx-auto bg-white">
        <div className="flex-1 flex flex-col min-w-0">
          <header className="h-[88px] md:h-[100px] border-b border-slate-200 flex items-center px-4 md:px-7 gap-3 shrink-0">
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              title="Abrir menú"
              aria-label="Abrir menú"
              className="h-10 w-10 shrink-0 rounded-xl hover:bg-slate-100 flex items-center justify-center text-slate-600"
            >
              <Menu className="w-5 h-5" strokeWidth={2.1} />
            </button>
            <div className="md:hidden">
              <Logo size={24} />
            </div>
            <div className="flex-1 max-w-3xl">
              <div className="relative">
                <Search
                  className="absolute left-4 md:left-5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400"
                  strokeWidth={2.25}
                />
                <input
                  ref={searchRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={onSearchKey}
                  type="search"
                  inputMode="search"
                  enterKeyHint="search"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  placeholder={
                    businessType === "SERVICES"
                      ? "Buscar servicio o cliente…"
                      : "Buscar producto, código de barras o SKU…"
                  }
                  className="h-12 md:h-14 w-full pl-11 md:pl-12 pr-4 text-[14px] md:text-[14.5px] bg-mipiace-stone border border-transparent rounded-2xl focus:outline-none focus:ring-2 focus:ring-mipiace-coral/40 focus:bg-white focus:border-mipiace-coral/30"
                />
              </div>
            </div>
            <div className="flex items-center gap-2 md:gap-2.5 ml-auto">
              {/* v1.3 Lote 5 · botón "Escanear" para iPad sin USB
                  scanner. Oculto si el navegador no expone cámara
                  (no tiene sentido pintar un botón que siempre va a
                  fallar). El modal full-screen lleva el preview y
                  cuadro guía; usa `addByBarcode` para mantener una
                  sola ruta de catalog lookup. */}
              {hasCameraSupport() && (
                <button
                  onClick={() => setShowCameraScan(true)}
                  title="Escanear con cámara"
                  className="h-12 md:h-14 w-12 md:w-14 rounded-2xl bg-mipiace-stone hover:bg-slate-100 flex items-center justify-center text-slate-600"
                >
                  <ScanLine className="w-[18px] h-[18px]" strokeWidth={2.25} />
                </button>
              )}
              <button
                onClick={async () => {
                  setRefreshing(true);
                  try {
                    const fresh = await refreshCatalog();
                    setCatalog(fresh);
                  } catch {
                    /* mantener cache */
                  } finally {
                    setRefreshing(false);
                  }
                }}
                title="Refrescar catálogo"
                className="h-12 md:h-14 w-12 md:w-14 rounded-2xl bg-mipiace-stone hover:bg-slate-100 flex items-center justify-center text-slate-600"
              >
                <RotateCw
                  className={`w-[18px] h-[18px] ${refreshing ? "animate-spin" : ""}`}
                  strokeWidth={2.25}
                />
              </button>
              <button
                onClick={() => setShowHistory(true)}
                title="Tickets pasados"
                className="h-12 md:h-14 px-3 md:px-5 rounded-2xl bg-mipiace-stone hover:bg-slate-100 flex items-center gap-2 text-[13.5px] md:text-[14px] font-medium text-mipiace-ink"
              >
                <span className="hidden sm:inline">Tickets</span>
              </button>
              <button
                onClick={() => setOpenSheet({ kind: "suspended" })}
                title={businessType === "SERVICES" ? "Servicios pendientes" : "Ventas pendientes"}
                className="h-12 md:h-14 px-3 md:px-5 rounded-2xl bg-mipiace-coral-soft border border-mipiace-coral/25 flex items-center gap-2 text-[13.5px] md:text-[14px] font-medium text-mipiace-coral-dark hover:bg-mipiace-coral/15"
              >
                <Bookmark className="w-[17px] h-[17px]" strokeWidth={2.25} />
                <span className="hidden sm:inline">Pendientes ({getSuspendedCarts().length})</span>
              </button>
              <button
                onClick={clearCart}
                title={businessType === "SERVICES" ? "Nuevo servicio" : "Nueva venta"}
                className="h-12 md:h-14 w-12 md:w-14 rounded-2xl bg-mipiace-coral hover:bg-mipiace-coral-dark flex items-center justify-center text-white"
              >
                <Plus className="w-[20px] h-[20px]" strokeWidth={2.25} />
              </button>
            </div>
          </header>

          <HealthBanner health={health} />

          <SaleWorkspace
            products={filtered}
            wildcards={wildcards}
            catalogError={catalogError}
            lines={lines}
            contact={contact}
            notes={notes}
            totals={totals}
            cashierRole={props.cashierRole}
            shiftTicketsCount={shiftTicketsCount}
            tableContext={props.tableContext ?? null}
            onBackToMap={props.onBackToMap ?? null}
            onClickProduct={addProduct}
            onClickFreeLine={() => setOpenSheet({ kind: "freeLine" })}
            onClickLine={(line) => setOpenSheet({ kind: "line", line })}
            onUpdateLineUnits={(id, units) => updateLine(id, { units })}
            onRemoveLine={removeLine}
            onClickDiscountGlobal={() => setOpenSheet({ kind: "discountGlobal" })}
            onClickNotes={() => setOpenSheet({ kind: "notes" })}
            onClickContact={() => setOpenSheet({ kind: "contact" })}
            onClickCheckout={() => setOpenSheet({ kind: "checkout" })}
            onSuspend={() => suspendCart("")}
            onCancel={() => {
              const inProgress =
                businessType === "SERVICES" ? "el servicio" : "la venta";
              if (lines.length === 0 || confirm(`¿Cancelar ${inProgress} en curso?`)) {
                clearCart();
              }
            }}
            onSendToKitchen={() => void sendToKitchen()}
            kitchenBusy={kitchenBusy}
            kitchenLastRevision={kitchenRevision}
            onClickMoveTable={() => setShowMoveTable(true)}
            onClickSplitBill={() => setShowSplitBill(true)}
          />

          <footer className="h-[56px] md:h-[68px] border-t border-slate-200 grid grid-cols-3 items-center px-4 md:px-7 text-[12px] md:text-[13px] shrink-0">
            <div className="flex items-center gap-2.5">
              <span className="w-2.5 h-2.5 bg-emerald-500 rounded-full" />
              <span className="text-mipiace-ink font-medium hidden sm:inline">
                Caja abierta · {props.registerName}
              </span>
            </div>
            <div className="text-center text-slate-600 font-medium truncate">
              {props.cashierEmail}
            </div>
            <div className="flex items-center justify-end gap-3 text-slate-500">
              <span className="tabular-nums font-medium hidden sm:inline">
                {new Date().toLocaleString("es-ES", {
                  weekday: "short",
                  day: "2-digit",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
              {navigator.onLine ? (
                <Wifi className="w-4 h-4 text-emerald-500" strokeWidth={2.25} />
              ) : (
                <WifiOff className="w-4 h-4 text-red-500" strokeWidth={2.25} />
              )}
            </div>
          </footer>
        </div>
      </div>

      {/* Sheets / overlays */}
      {openSheet?.kind === "line" && (
        <LineSheet
          line={openSheet.line}
          onClose={() => setOpenSheet(null)}
          onChange={(patch) => updateLine(openSheet.line.id, patch)}
          onRemove={() => {
            removeLine(openSheet.line.id);
            setOpenSheet(null);
          }}
        />
      )}
      {openSheet?.kind === "discountGlobal" && (
        <DiscountGlobalSheet
          currentPct={lines[0]?.discountPct ?? 0}
          onApply={(pct) => {
            applyGlobalDiscount(pct);
            setOpenSheet(null);
          }}
          onClose={() => setOpenSheet(null)}
        />
      )}
      {openSheet?.kind === "freeLine" && (
        <FreeLineSheet
          wildcards={wildcards}
          onClose={() => setOpenSheet(null)}
          onAdd={(line) => {
            addFreeLine(line);
            setOpenSheet(null);
          }}
        />
      )}
      {openSheet?.kind === "notes" && (
        <NotesSheet
          value={notes}
          onClose={() => setOpenSheet(null)}
          onSave={(v) => {
            setNotes(v);
            setOpenSheet(null);
          }}
        />
      )}
      {openSheet?.kind === "contact" && (
        <ContactSheet
          current={contact}
          onClose={() => setOpenSheet(null)}
          onSelect={(c) => {
            setContact(c);
            setOpenSheet(null);
          }}
          onClear={() => {
            setContact(null);
            setOpenSheet(null);
          }}
        />
      )}
      {openSheet?.kind === "suspended" && (
        <SuspendedSheet
          onClose={() => setOpenSheet(null)}
          onRecover={(cart) => {
            recoverCart(cart);
            setOpenSheet(null);
          }}
        />
      )}
      {openSheet?.kind === "checkout" && (
        <CheckoutOverlay
          shiftId={props.shiftId}
          registerId={props.registerId}
          lines={lines}
          totals={totals}
          contact={contact}
          notes={notes}
          businessType={businessType}
          // v1.3-Servicios-Pinta · Lote 4: el nudge "Servicio sin
          // cliente" salta al modal de búsqueda existente. Cerramos
          // el overlay (CheckoutOverlay también llama onClose) y
          // abrimos ContactSheet en su lugar.
          onRequestAssignContact={() => setOpenSheet({ kind: "contact" })}
          onClose={() => setOpenSheet(null)}
          onConfirmed={() => {
            clearCart();
            setOpenSheet(null);
          }}
        />
      )}
      {showCloseShift && (
        <CloseShiftModal
          shiftId={props.shiftId}
          cashierRole={props.cashierRole}
          mode="Z"
          onClose={() => setShowCloseShift(false)}
          onClosed={() => {
            setShowCloseShift(false);
            props.onCloseShift();
          }}
        />
      )}
      {showArqueoX && (
        <CloseShiftModal
          shiftId={props.shiftId}
          cashierRole={props.cashierRole}
          mode="X"
          onClose={() => setShowArqueoX(false)}
          // El arqueo X no cierra el turno — onClosed nunca se dispara
          // (el modal sólo enseña el resultado y se cierra manualmente).
          onClosed={() => setShowArqueoX(false)}
        />
      )}
      {showCameraScan && (
        <CameraScanModal
          onClose={() => setShowCameraScan(false)}
          onScanned={(code) => addByBarcode(code)}
        />
      )}
      {showHistory && (
        <TicketsHistoryPage onClose={() => setShowHistory(false)} />
      )}
      {kitchenToast && (
        <KitchenToast
          sections={kitchenToast.sections}
          revision={kitchenToast.revision}
          onClose={() => setKitchenToast(null)}
        />
      )}
      {kitchenError && (
        <KitchenErrorBanner
          message={kitchenError}
          onClose={() => setKitchenError(null)}
        />
      )}
      {showMoveTable && (
        <MoveTablePicker
          currentTableId={props.tableContext?.id ?? null}
          onClose={() => setShowMoveTable(false)}
          onPick={(dest) => {
            if (!moveBusy) void moveToTable(dest);
          }}
        />
      )}
      {moveError && (
        <KitchenErrorBanner
          message={moveError}
          onClose={() => setMoveError(null)}
        />
      )}
      {showSplitBill && props.tableContext?.activeTicketId && (
        <SplitBillSheet
          ticketId={props.tableContext.activeTicketId}
          onClose={() => setShowSplitBill(false)}
        />
      )}
      {selectorState && (
        <ModifierSelector
          product={selectorState.product}
          groups={selectorState.groups}
          onCancel={() => setSelectorState(null)}
          onConfirm={(selections) => {
            pushProductLine(selectorState.product, {
              modifierSelections: selections,
            });
            setSelectorState(null);
          }}
        />
      )}

      {/* v1.3-UX-Iteración Lote 1: drawer off-canvas con las acciones
          que antes vivían en el sidebar fijo. Aparece sólo al pulsar
          el hamburger; libera ~240px de ancho útil al catálogo en
          apaisado. Cierra al pulsar fuera, al pulsar cualquier acción
          o con Esc (gestionado por useEffect). */}
      <div
        className={`fixed inset-0 z-50 ${drawerOpen ? "pointer-events-auto" : "pointer-events-none"}`}
        aria-hidden={!drawerOpen}
      >
        <div
          onClick={() => setDrawerOpen(false)}
          className={`absolute inset-0 bg-slate-900/40 transition-opacity duration-150 ${
            drawerOpen ? "opacity-100" : "opacity-0"
          }`}
        />
        <aside
          role="dialog"
          aria-modal="true"
          aria-label="Menú del TPV"
          className={`absolute inset-y-0 left-0 w-[280px] bg-white shadow-xl flex flex-col px-5 py-5 transition-transform duration-150 ${
            drawerOpen ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          <div className="mb-7 flex items-center justify-between">
            <Logo size={28} />
            <button
              type="button"
              onClick={() => setDrawerOpen(false)}
              title="Cerrar menú"
              aria-label="Cerrar menú"
              className="h-9 w-9 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-500"
            >
              <X className="w-4 h-4" strokeWidth={2.1} />
            </button>
          </div>
          <nav className="space-y-1.5">
            <button
              onClick={() => setDrawerOpen(false)}
              title={vocab("saleNoun", businessType)}
              className="w-full h-12 flex items-center gap-3 px-4 rounded-xl bg-mipiace-coral-soft text-mipiace-coral-dark text-[14.5px] font-medium"
            >
              <ShoppingBag
                className="w-[19px] h-[19px] text-mipiace-coral shrink-0"
                strokeWidth={2.1}
              />
              <span>{vocab("saleNoun", businessType)}</span>
            </button>
            {/* v1.3-UX-Iteración Lote 3 · Sincronizar catálogo: borra
                runtime caches del SW + repuebla IDB desde la red. No
                cierra el drawer mientras corre — el cajero ve el
                spinner y el check; cierra automático al volver a
                idle si quiere seguir trabajando. */}
            <button
              onClick={async () => {
                if (syncState === "running") return;
                setSyncState("running");
                try {
                  const fresh = await (async () => {
                    let result: CatalogProduct[] = [];
                    await syncNow(async () => {
                      result = await refreshCatalog();
                    });
                    return result;
                  })();
                  setCatalog(fresh);
                  setSyncState("done");
                  setTimeout(() => setSyncState("idle"), 1500);
                } catch {
                  // Si refreshCatalog falla (sin red, sesión caída),
                  // mantenemos el catálogo en memoria y volvemos a
                  // idle. El cajero puede reintentar.
                  setSyncState("idle");
                }
              }}
              title="Forzar refresco del catálogo y borrar caché del Service Worker"
              className="w-full h-12 flex items-center gap-3 px-4 rounded-xl text-slate-600 hover:bg-slate-50 text-[14.5px] font-medium"
            >
              {syncState === "running" ? (
                <Loader2
                  className="w-[19px] h-[19px] text-slate-500 shrink-0 animate-spin"
                  strokeWidth={2.1}
                />
              ) : syncState === "done" ? (
                <Check
                  className="w-[19px] h-[19px] text-emerald-600 shrink-0"
                  strokeWidth={2.1}
                />
              ) : (
                <RotateCw
                  className="w-[19px] h-[19px] text-slate-500 shrink-0"
                  strokeWidth={2.1}
                />
              )}
              <span>
                {syncState === "running"
                  ? "Sincronizando…"
                  : syncState === "done"
                  ? "Catálogo actualizado"
                  : "Sincronizar catálogo"}
              </span>
            </button>
            <button
              onClick={() => {
                setDrawerOpen(false);
                setShowArqueoX(true);
              }}
              title="Arqueo X (control sin cerrar turno)"
              className="w-full h-12 flex items-center gap-3 px-4 rounded-xl text-slate-600 hover:bg-slate-50 text-[14.5px] font-medium"
            >
              <Calculator
                className="w-[19px] h-[19px] text-slate-500 shrink-0"
                strokeWidth={2.1}
              />
              <span>Arqueo X</span>
            </button>
            <button
              onClick={() => {
                setDrawerOpen(false);
                setShowCloseShift(true);
              }}
              title="Cerrar turno"
              className="w-full h-12 flex items-center gap-3 px-4 rounded-xl text-slate-600 hover:bg-slate-50 text-[14.5px] font-medium"
            >
              <PowerOff
                className="w-[19px] h-[19px] text-slate-500 shrink-0"
                strokeWidth={2.1}
              />
              <span>Cerrar turno</span>
            </button>
            <button
              onClick={() => {
                setDrawerOpen(false);
                props.onLogoutCashier();
              }}
              title={`Bloquear (${props.cashierEmail})`}
              className="w-full h-12 flex items-center gap-3 px-4 rounded-xl text-slate-600 hover:bg-slate-50 text-[14.5px] font-medium"
            >
              <Lock
                className="w-[19px] h-[19px] text-slate-500 shrink-0"
                strokeWidth={2.1}
              />
              <span className="truncate">Bloquear ({props.cashierEmail})</span>
            </button>
          </nav>
        </aside>
      </div>
    </div>
  );
}

function HealthBanner({ health }: { health: HealthStatus | null }) {
  if (!health) return null;
  // Rojo bloqueante (B6 §3.3): >48h sin sync o sin API key. Abrir/cerrar
  // turno está deshabilitado en backend (409 TENANT_BLOCKED) y la UI lo
  // anuncia aquí. La venta sigue operativa: el cobro local nunca se
  // bloquea para no dejar al negocio sin caja.
  if (health.level === "blocked") {
    const hours = health.lastSyncAgeMs
      ? Math.round(health.lastSyncAgeMs / 3_600_000)
      : null;
    return (
      <Banner color="red">
        <strong>TPV bloqueado · </strong>
        {health.reason === "no_api_key"
          ? "La cuenta de Holded no está conectada. Contacta al propietario para reanudar la operativa."
          : `Llevamos ${hours ?? "+48"} h sin sincronizar con Holded. Abrir y cerrar turno está deshabilitado. Contacta soporte.`}
      </Banner>
    );
  }
  // Ámbar de aviso (B6 §3.3): >24h sin sync. Operativa normal.
  if (health.level === "warning") {
    const hours = health.lastSyncAgeMs
      ? Math.round(health.lastSyncAgeMs / 3_600_000)
      : null;
    return (
      <Banner color="amber">
        Sincronización pendiente · llevamos {hours ?? "—"} h sin contacto con Holded.
      </Banner>
    );
  }
  if (health.pendingSyncCount > 0 || health.syncFailedCount > 0) {
    return (
      <Banner color="amber">
        Sincronizando {health.pendingSyncCount} ticket(s) con Holded
        {health.syncFailedCount > 0 ? ` · ${health.syncFailedCount} con error` : ""}.
      </Banner>
    );
  }
  return null;
}

// `ModifierBreakdown` se extrajo a `SalePage.cartLineHelpers.tsx`
// (v1.2-Lite-fix1 Lote 3) para compartirlo con `CartLineItem` sin
// crear un import circular.

function Banner({ color, children }: { color: "amber" | "red"; children: React.ReactNode }) {
  const style =
    color === "red"
      ? "bg-red-50 border-red-200 text-red-800"
      : "bg-amber-50 border-amber-200 text-amber-800";
  return (
    <div className={`border-b ${style} px-4 md:px-7 py-2.5 text-[13px] flex items-center gap-2`}>
      <CircleAlert className="w-4 h-4 shrink-0" strokeWidth={2.1} />
      <span>{children}</span>
    </div>
  );
}

function SaleWorkspace({
  products,
  catalogError,
  lines,
  contact,
  notes,
  totals,
  cashierRole: _cashierRole,
  shiftTicketsCount,
  tableContext,
  onBackToMap,
  onClickProduct,
  onClickFreeLine,
  onClickLine,
  onUpdateLineUnits,
  onRemoveLine,
  onClickDiscountGlobal,
  onClickNotes,
  onClickContact,
  onClickCheckout,
  onSuspend,
  onCancel,
  onSendToKitchen,
  kitchenBusy,
  kitchenLastRevision,
  onClickMoveTable,
  onClickSplitBill,
}: {
  products: CatalogProduct[];
  wildcards: Wildcard[];
  catalogError: string | null;
  lines: CartLine[];
  contact: ContactRef | null;
  notes: string;
  totals: ReturnType<typeof computeCart>;
  cashierRole: "MANAGER" | "CASHIER";
  // Mejora-02: contador de tickets emitidos en el turno actual (no
  // DRAFT, no VOIDED). null si aún no se ha resuelto el primer fetch.
  shiftTicketsCount: number | null;
  tableContext: TableContext | null;
  onBackToMap: (() => void) | null;
  onClickProduct: (p: CatalogProduct) => void;
  onClickFreeLine: () => void;
  onClickLine: (line: CartLine) => void;
  // v1.2-Lite-fix1 Lote 3 (F2-UX): cambios inline desde cada línea
  // del carrito (stepper +/− y papelera). Los pasamos como callbacks
  // específicos en lugar de exponer `updateLine` entero para mantener
  // el contrato del panel acotado.
  onUpdateLineUnits: (id: string, units: number) => void;
  onRemoveLine: (id: string) => void;
  onClickDiscountGlobal: () => void;
  onClickNotes: () => void;
  onClickContact: () => void;
  onClickCheckout: () => void;
  onSuspend: () => void;
  onCancel: () => void;
  // v1.4-Bar-Operativa-MVP Lote 2 · enviar comanda. Sólo se invoca
  // cuando hay tableContext y al menos una línea. Si `kitchenBusy`
  // es true, el botón muestra "Enviando…" deshabilitado. Si
  // `kitchenLastRevision > 0`, el botón rotula "Reenviar comanda"
  // y queda discreto (la cocina ya tiene un papel; reenvío es la
  // operación menos común).
  onSendToKitchen: () => void;
  kitchenBusy: boolean;
  kitchenLastRevision: number;
  // v1.4-Bar-Operativa-MVP Lote 3 · abre el picker de mesa destino.
  // Sólo se invoca cuando hay tableContext.
  onClickMoveTable: () => void;
  // v1.4-Bar-Operativa-MVP Lote 4 · abre el sheet partir cuenta.
  onClickSplitBill: () => void;
}) {
  // B-ProductImages: tenantId cacheado tras el último refresh del
  // catálogo. Si por alguna razón viene null (primer arranque y aún
  // sin sync), todos los tiles caen al placeholder — no rompe.
  const tenantId = getCachedTenantId();
  // B-Multi-Vertical SB3: icono del placeholder según vertical del
  // tenant. Cache que se llena al primer refresh del catálogo; si aún
  // está vacío (sesión preexistente al deploy), Package es el default
  // — mismo comportamiento que B-UX-Pulido F3.
  const businessType = getCachedBusinessType();
  // v1.3-hotfix6 · subvertical para refinar el icono placeholder.
  const iconPreset = getCachedIconPreset();
  const PlaceholderIcon = placeholderIconFor(businessType, iconPreset);
  // P-1 (v1.1 peluquería): para verticales SERVICES, ofrecer un toggle
  // "Servicios" / "Productos" delante de los chips de tag. Para
  // RETAIL/HOSPITALITY los items se siguen mezclando (caso típico:
  // bar que vende botellas de aceite junto con cafés).
  //
  // v1.3-Servicios-Pinta · Lote 5: ocultamos el toggle si el catálogo
  // sólo tiene servicios (no hay nada que toggle-ar). El pelo a otro
  // tenant SERVICES que sí venda producto (champús, geles) sí lo verá.
  const hasAnyProductKind = useMemo(
    () => products.some((p) => p.kind === "PRODUCT"),
    [products],
  );
  const showKindToggle = businessType === "SERVICES" && hasAnyProductKind;
  const [kindFilter, setKindFilter] = useState<"SERVICE" | "PRODUCT">(() => {
    if (!showKindToggle) return "SERVICE"; // valor inerte
    const stored = localStorage.getItem(KIND_FILTER_KEY);
    return stored === "PRODUCT" ? "PRODUCT" : "SERVICE";
  });
  useEffect(() => {
    if (showKindToggle) localStorage.setItem(KIND_FILTER_KEY, kindFilter);
  }, [showKindToggle, kindFilter]);
  // B-Categorias-via-Tags: filtro por tag/pseudo-categoría. null = ver
  // todos. Se calcula desde los productos actualmente visibles (que
  // ya pueden venir filtrados por búsqueda) para que los chips
  // reflejen sólo lo relevante en cada momento. Si el propietario no
  // tagueó nada en Holded, availableTags queda vacío y los chips no
  // se renderizan — el espacio del header simplemente se contrae.
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  // P-1: si SERVICES, los tags se calculan sobre los productos del kind
  // seleccionado — no queremos chips de tags que no existan dentro de
  // la pestaña actual.
  const productsForTags = useMemo(
    () =>
      showKindToggle ? products.filter((p) => p.kind === kindFilter) : products,
    [products, showKindToggle, kindFilter],
  );
  const availableTags = useMemo(
    () => Array.from(new Set(productsForTags.flatMap((p) => p.tags))).sort(),
    [productsForTags],
  );
  // v1.2-Lite Lote 4.A · T-9 favoritos.
  //
  // El tag reservado `favoritos` (lowercase tras Lote 3.A) marca
  // productos que el propietario quiere ver siempre arriba como atajo.
  // Aparecen en una sub-grid antes de los chips de categoría, máximo 8.
  // Excluimos el tag de la lista de chips para no duplicar visualmente
  // (los favoritos ya están arriba; no tiene sentido un chip "Favoritos"
  // que filtre a lo mismo).
  const FAVORITES_TAG = "favoritos";
  const MAX_FAVORITES = 8;
  const favoriteProducts = useMemo(
    () =>
      productsForTags
        .filter((p) => p.tags.includes(FAVORITES_TAG))
        .slice(0, MAX_FAVORITES),
    [productsForTags],
  );
  const displayTags = useMemo(
    () => availableTags.filter((t) => t !== FAVORITES_TAG),
    [availableTags],
  );
  // v1.3-Operativa-Extra · Lote 1: mapa slug→label editable. Se relee
  // cada vez que cambian los tags (refreshCatalog actualiza ambos), así
  // que un alias nuevo aparece tras el próximo "Sincronizando" sin tocar
  // este componente.
  const tagAliases = useMemo(() => getCachedTagAliases(), [displayTags]);
  // Si el tag seleccionado deja de existir en el catálogo (el
  // propietario lo quitó en Holded y vino un sync, o el toggle de
  // kind cambió), volvemos a "Todos" automáticamente.
  useEffect(() => {
    if (selectedTag && !displayTags.includes(selectedTag)) {
      setSelectedTag(null);
    }
  }, [selectedTag, displayTags]);
  const visibleProducts = useMemo(() => {
    let list = products;
    if (showKindToggle) list = list.filter((p) => p.kind === kindFilter);
    if (selectedTag) list = list.filter((p) => p.tags.includes(selectedTag));
    return list;
  }, [products, selectedTag, showKindToggle, kindFilter]);
  return (
    <div className="flex-1 grid lg:grid-cols-[1fr_360px] gap-4 lg:gap-6 p-4 md:p-7 min-h-0 lg:overflow-hidden">
      {/* v1.3-UX-Iteración Lote 1: en apaisado el catálogo tiene su
          propio scroll interno (lg:overflow-y-auto) para que el ticket
          de la derecha permanezca fijo en pantalla mientras el cajero
          busca productos. En móvil/vertical mantenemos el comportamiento
          actual (apilado, scroll global) porque no hay espacio para
          dos columnas. */}
      <section className="flex flex-col min-w-0 order-2 lg:order-1 lg:h-full lg:min-h-0">
        {/* v1.3-UX-Iteración-fixes Fix 1: la barra de chips va FUERA del
            área de scroll vertical (antes desaparecía al scrollear el
            grid). El bloque chips queda fijo arriba; favoritos + grid
            van en un sub-contenedor con su propio overflow-y. */}
        <div className="flex items-center gap-2 mb-4 md:mb-6 overflow-x-auto flex-shrink-0">
          {/* P-1 (v1.1 peluquería): toggle Servicios/Productos para
              verticales SERVICES. Va delante de los chips de tag y
              está separado visualmente por un divisor sutil. */}
          {showKindToggle && (
            <>
              <button
                onClick={() => setKindFilter("SERVICE")}
                className={
                  kindFilter === "SERVICE"
                    ? "h-11 md:h-12 px-4 md:px-5 rounded-2xl bg-mipiace-ink text-white text-[13.5px] md:text-[14px] font-medium shrink-0"
                    : "h-11 md:h-12 px-4 md:px-5 rounded-2xl bg-white border border-slate-200 text-slate-700 text-[13.5px] md:text-[14px] font-medium shrink-0 hover:border-mipiace-ink/40"
                }
              >
                Servicios
              </button>
              <button
                onClick={() => setKindFilter("PRODUCT")}
                className={
                  kindFilter === "PRODUCT"
                    ? "h-11 md:h-12 px-4 md:px-5 rounded-2xl bg-mipiace-ink text-white text-[13.5px] md:text-[14px] font-medium shrink-0"
                    : "h-11 md:h-12 px-4 md:px-5 rounded-2xl bg-white border border-slate-200 text-slate-700 text-[13.5px] md:text-[14px] font-medium shrink-0 hover:border-mipiace-ink/40"
                }
              >
                Productos
              </button>
              <div className="w-px h-8 bg-slate-200 mx-1 shrink-0" aria-hidden />
            </>
          )}
          {/* B-Categorias-via-Tags: chip "Todos" siempre presente +
              un chip por cada tag único del catálogo. El estado activo
              se pinta con el coral del producto; los inactivos con
              estilo neutro. overflow-x-auto del contenedor permite
              scroll horizontal cuando hay muchas categorías. */}
          <button
            onClick={() => setSelectedTag(null)}
            className={
              selectedTag === null
                ? "h-11 md:h-12 px-4 md:px-5 rounded-2xl bg-mipiace-coral text-white text-[13.5px] md:text-[14px] font-medium flex items-center gap-2 shrink-0"
                : "h-11 md:h-12 px-4 md:px-5 rounded-2xl bg-white border border-slate-200 text-slate-700 text-[13.5px] md:text-[14px] font-medium flex items-center gap-2 shrink-0 hover:border-mipiace-coral/50"
            }
          >
            <Star
              className={
                selectedTag === null
                  ? "w-3.5 h-3.5 fill-white"
                  : "w-3.5 h-3.5 text-slate-400"
              }
              strokeWidth={2.5}
            />
            Todos
          </button>
          {displayTags.map((tag) => {
            const active = selectedTag === tag;
            return (
              <button
                key={tag}
                onClick={() => setSelectedTag(tag)}
                className={
                  active
                    ? "h-11 md:h-12 px-4 md:px-5 rounded-2xl bg-mipiace-coral text-white text-[13.5px] md:text-[14px] font-medium shrink-0"
                    : "h-11 md:h-12 px-4 md:px-5 rounded-2xl bg-white border border-slate-200 text-slate-700 text-[13.5px] md:text-[14px] font-medium shrink-0 hover:border-mipiace-coral/50"
                }
              >
                {renderTagLabel(tag, tagAliases)}
              </button>
            );
          })}
        </div>
        {/* Zona scrollable: favoritos + grid + estados vacíos. min-h-0
            es crítico para que flex-1 + overflow-y funcionen dentro de
            un flex container. */}
        <div className="flex-1 min-h-0 lg:overflow-y-auto">
        {/* v1.2-Lite Lote 4.A · T-9 Atajos: sub-grid de favoritos arriba.
            Sólo aparece si hay productos con el tag reservado `favoritos`.
            Se respeta el toggle Servicios/Productos (productsForTags ya
            filtra por kind). El usuario pulsa el tile como en el grid
            principal — mismo handler onClickProduct. */}
        {favoriteProducts.length > 0 && (
          <div className="mb-5 md:mb-6">
            <div className="flex items-center gap-2 mb-2.5">
              <Star
                className="w-3.5 h-3.5 text-amber-500 fill-amber-400"
                strokeWidth={2}
              />
              <h3 className="text-[12.5px] font-semibold uppercase tracking-wider text-slate-600">
                Atajos
              </h3>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-3 md:gap-3.5">
              {favoriteProducts.map((p) => {
                const imgSrc = tenantId ? productImageUrl(p, tenantId) : null;
                return (
                  <button
                    key={`fav-${p.id}`}
                    onClick={() => onClickProduct(p)}
                    className="group bg-white rounded-2xl border border-amber-200 overflow-hidden text-left hover:border-amber-400 hover:shadow-sm transition-all"
                  >
                    <div className="aspect-[5/4] flex items-center justify-center bg-stone-100 text-stone-600 overflow-hidden">
                      {imgSrc ? (
                        <img
                          src={imgSrc}
                          alt=""
                          loading="lazy"
                          decoding="async"
                          draggable={false}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <PlaceholderIcon
                          className="w-10 h-10 md:w-12 md:h-12 opacity-80"
                          strokeWidth={1.4}
                        />
                      )}
                    </div>
                    <div className="px-3 md:px-3.5 py-2.5 md:py-3">
                      <div className="text-[13px] md:text-[13.5px] font-medium text-mipiace-ink line-clamp-2 min-h-[2.6em] leading-tight">
                        {p.name}
                      </div>
                      <div className="text-[12.5px] md:text-[13px] text-slate-500 mt-0.5 tabular-nums">
                        {formatEur(p.priceGross)}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}
        {catalogError && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-2xl p-4 mb-4 text-[13px]">
            {catalogError}
          </div>
        )}
        {showKindToggle &&
          products.length > 0 &&
          visibleProducts.length === 0 &&
          !selectedTag && (
            <div className="text-[13px] text-slate-500 bg-slate-50 border border-slate-200 rounded-2xl p-4 mb-4">
              No hay {kindFilter === "PRODUCT" ? "productos físicos" : "servicios"}{" "}
              en el catálogo. Crea uno en Holded para verlo aquí.
            </div>
          )}
        {/* v1.3-Servicios-Pinta · Lote 5: empty state general del grid.
            Aparece cuando NO hay productos cargados todavía y no hay
            error de catálogo (que ya pinta su propio bloque arriba).
            Copy adaptado por vertical para que el dueño SERVICES no
            vea "productos" cuando vende servicios. */}
        {!catalogError &&
          products.length === 0 &&
          (businessType === "SERVICES" ? (
            <div className="text-[13px] text-slate-500 bg-slate-50 border border-slate-200 rounded-2xl p-4 mb-4">
              Aún no has cargado servicios. Configúralos en Holded o
              sincroniza para verlos aquí.
            </div>
          ) : (
            <div className="text-[13px] text-slate-500 bg-slate-50 border border-slate-200 rounded-2xl p-4 mb-4">
              Aún no has cargado productos. Configúralos en Holded o
              sincroniza para verlos aquí.
            </div>
          ))}
        {/* v1.3-Servicios-Pinta · Lote 5: filtro vacío (búsqueda, tag
            o ambos) con catálogo no vacío. SERVICES dice "servicios";
            RETAIL/HOSPITALITY mantienen "productos". */}
        {!catalogError &&
          products.length > 0 &&
          visibleProducts.length === 0 &&
          favoriteProducts.length === 0 &&
          !(showKindToggle && !selectedTag) && (
            <div className="text-[13px] text-slate-500 bg-slate-50 border border-slate-200 rounded-2xl p-4 mb-4">
              {businessType === "SERVICES"
                ? "No hay servicios que coincidan con la búsqueda."
                : "No hay productos que coincidan con la búsqueda."}
            </div>
          )}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-3 md:gap-3.5 mb-5 md:mb-6">
          {visibleProducts.map((p) => {
            const imgSrc = tenantId ? productImageUrl(p, tenantId) : null;
            return (
              <button
                key={p.id}
                onClick={() => onClickProduct(p)}
                className="group bg-white rounded-2xl border border-slate-200 overflow-hidden text-left hover:border-mipiace-coral/50 hover:shadow-sm transition-all"
              >
                <div className="aspect-[5/4] flex items-center justify-center bg-stone-100 text-stone-600 overflow-hidden">
                  {imgSrc ? (
                    <img
                      src={imgSrc}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      draggable={false}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    // B-Multi-Vertical SB3: icono según vertical
                    // (Coffee HOSPITALITY, Package RETAIL, Briefcase
                    // SERVICES). Fallback Package para sesiones sin
                    // businessType cacheado.
                    <PlaceholderIcon
                      className="w-10 h-10 md:w-12 md:h-12 opacity-80"
                      strokeWidth={1.4}
                    />
                  )}
                </div>
                <div className="px-3 md:px-3.5 py-2.5 md:py-3">
                  {/* B-UX-Pulido F3: dos líneas con line-clamp para
                      catálogos con nombres largos (Thalia tiene
                      productos tipo "Abre y descubre el espacio4"
                      que se truncaban antes). min-h reserva siempre
                      el alto de 2 líneas para que el grid no salte. */}
                  <div className="text-[13px] md:text-[13.5px] font-medium text-mipiace-ink line-clamp-2 min-h-[2.6em] leading-tight">
                    {p.name}
                  </div>
                  <div className="text-[12.5px] md:text-[13px] text-slate-500 mt-0.5 tabular-nums">
                    {formatEur(p.priceGross)}
                  </div>
                </div>
              </button>
            );
          })}
          <button
            onClick={onClickFreeLine}
            className="bg-transparent rounded-2xl border-2 border-dashed border-slate-300 hover:border-mipiace-coral/50 hover:bg-mipiace-coral-soft/40 flex flex-col items-center justify-center gap-2 text-slate-400 hover:text-mipiace-coral-dark text-[13px] font-medium min-h-[140px] md:min-h-[180px]"
          >
            <Plus className="w-6 h-6" strokeWidth={2} />
            Línea libre
          </button>
        </div>
        {/* Report D: la antigua fila de 4 botones (Descuento / Nota /
            Cliente / Cancelar) se ha mudado al panel del ticket de la
            derecha como chips secundarios agrupados con el resto de
            acciones del ticket. El workspace izquierdo queda solo con
            el grid de productos. */}
        </div>
      </section>

      {/* Report A+D · Rediseño v2 del panel del ticket. Layout en bloques:
          1. Header compacto (título + número, sin "unidades")
          2. Chips de acciones secundarias del ticket (Cliente · Descuento
             · Observaciones · Cancelar) — ya no viven en el workspace
             izquierdo, son parte del contexto del ticket.
          3. Total grande + Guardar/Cobrar — arriba (Report A rectifica
             Mejora-01 sticky-bottom: el user prefiere ver el botón al
             empezar y mantenerlo accesible sin que dependa del scroll).
          4. Lista de líneas (flex-1, scroll interno).
          5. Subtotal/IVA al pie como info detallada. */}
      <aside className="bg-white rounded-3xl border border-slate-200 flex flex-col order-1 lg:order-2 lg:h-full lg:overflow-y-auto">
        {/* 1 · Header */}
        <div className="flex items-center justify-between px-5 md:px-7 pt-5 md:pt-6 pb-3 md:pb-4 border-b border-slate-100 shrink-0">
          <div className="min-w-0">
            <h2 className="text-[18px] md:text-[20px] font-semibold text-mipiace-ink tracking-tight truncate">
              {tableContext
                ? `Mesa ${tableContext.name}`
                : `${vocab("ticketNoun", businessType)} de ${vocab("saleNoun", businessType).toLowerCase()}`}
            </h2>
            {/* Mejora-02: contador de tickets del turno actual. Aparece
                a la derecha del subtítulo como "Turno · #N" para que
                el cajero vea de un vistazo en qué ticket va. shift
                ticketsCount + 1 = el ticket que está a punto de emitir
                ahora mismo (lo que tiene en pantalla). */}
            <div className="text-[12.5px] text-slate-500 mt-0.5 flex items-center gap-1.5">
              {tableContext ? (
                <TableContextLine
                  table={tableContext}
                  itemCount={totals.itemCount}
                />
              ) : (
                <>{vocab("ticketNoun", businessType)} · {totals.itemCount}</>
              )}
              {shiftTicketsCount !== null && (
                <>
                  <span className="text-slate-300">·</span>
                  <span title={`${shiftTicketsCount} ${vocab("ticketNoun", businessType).toLowerCase()}${shiftTicketsCount === 1 ? "" : "s"} ya emitido${shiftTicketsCount === 1 ? "" : "s"} en este turno`}>
                    Turno · #{shiftTicketsCount + 1}
                  </span>
                </>
              )}
            </div>
          </div>
          {onBackToMap && (
            <button
              type="button"
              onClick={onBackToMap}
              className="h-9 px-3 text-[12.5px] rounded-lg bg-mipiace-stone hover:bg-slate-100 text-mipiace-ink"
              title="Volver al mapa de sala"
            >
              Mapa
            </button>
          )}
        </div>

        {/* 2 · Chips de acciones del ticket. "Cancelar" en último
             lugar con estilo destructivo más suave para no competir
             visualmente con "Cobrar". */}
        <div className="px-5 md:px-7 py-3 border-b border-slate-100 flex flex-wrap gap-1.5 shrink-0">
          <button
            onClick={onClickContact}
            className="h-8 px-3 rounded-lg bg-mipiace-stone hover:bg-slate-100 text-[12.5px] font-medium text-mipiace-ink max-w-[180px] truncate"
            title={contact ? `Cliente: ${contact.name}` : "Asignar cliente al ticket"}
          >
            {contact ? `Cliente: ${contact.name.split(" ")[0]}` : "Cliente"}
          </button>
          <button
            onClick={onClickDiscountGlobal}
            className="h-8 px-3 rounded-lg bg-mipiace-stone hover:bg-slate-100 text-[12.5px] font-medium text-mipiace-ink"
            title="Aplicar descuento global al ticket"
          >
            Descuento
          </button>
          <button
            onClick={onClickNotes}
            className="h-8 px-3 rounded-lg bg-mipiace-stone hover:bg-slate-100 text-[12.5px] font-medium text-mipiace-ink"
            title={`Observaciones internas del ${vocab("ticketNoun", businessType).toLowerCase()}`}
          >
            Observaciones{notes ? " ●" : ""}
          </button>
          {/* v1.4-Bar-Operativa-MVP Lote 3 · "Mover mesa" sólo en
              mesa abierta. Mismo tamaño que los demás chips. */}
          {tableContext && (
            <button
              onClick={onClickMoveTable}
              className="h-8 px-3 rounded-lg bg-mipiace-stone hover:bg-slate-100 text-[12.5px] font-medium text-mipiace-ink"
              title="Llevar este ticket a otra mesa"
            >
              Mover mesa
            </button>
          )}
          {/* v1.4-Bar-Operativa-MVP Lote 4 · "Partir cuenta" (Modo A):
              registra cobros parciales sobre el DRAFT de mesa. */}
          {tableContext && (
            <button
              onClick={onClickSplitBill}
              className="h-8 px-3 rounded-lg bg-mipiace-stone hover:bg-slate-100 text-[12.5px] font-medium text-mipiace-ink"
              title="Cobrar parte ahora y dejar el resto pendiente"
            >
              Partir cuenta
            </button>
          )}
          <button
            onClick={onCancel}
            disabled={lines.length === 0 && !contact && !notes}
            className="h-8 px-3 rounded-lg bg-red-50 hover:bg-red-100 text-[12.5px] font-medium text-red-700 disabled:opacity-50 disabled:cursor-not-allowed ml-auto"
            title={`Cancelar y vaciar el ${vocab("ticketNoun", businessType).toLowerCase()}`}
          >
            Cancelar
          </button>
        </div>

        {/* 3 · Resumen + Cobrar STICKY TOP del aside. v1.4-hotfix3
             2026-06-04: Matías lo prefiere arriba para que el botón
             Cobrar esté siempre visible y el listado del desglose
             quede debajo con scroll si no cabe. El sticky top-0
             pega este bloque a la cabecera al scrollear el aside. */}
        <div className="px-5 md:px-7 pt-4 md:pt-5 pb-5 md:pb-6 border-b border-slate-100 shrink-0 sticky top-0 bg-white z-10">
          <div className="space-y-1.5 mb-3 md:mb-4">
            <div className="flex justify-between text-[12.5px] md:text-[13px]">
              <span className="text-slate-500">Subtotal</span>
              <span className="text-slate-700 tabular-nums">{formatEur(totals.subtotalNet)}</span>
            </div>
            {totals.discount > 0 && (
              <div className="flex justify-between text-[12.5px] md:text-[13px]">
                <span className="text-slate-500">Descuento</span>
                <span className="text-mipiace-coral tabular-nums font-medium">
                  −{formatEur(totals.discount)}
                </span>
              </div>
            )}
            <div className="flex justify-between text-[12.5px] md:text-[13px]">
              <span className="text-slate-500">IVA</span>
              <span className="text-slate-700 tabular-nums">{formatEur(totals.tax)}</span>
            </div>
          </div>
          <div className="flex items-baseline justify-between mb-3 md:mb-4">
            <span className="text-[15px] md:text-[16px] font-semibold text-mipiace-ink">Total</span>
            <span className="text-[28px] md:text-[34px] font-semibold text-mipiace-ink tabular-nums tracking-tight">
              {formatEur(totals.total)}
            </span>
          </div>
          <div
            className={
              tableContext
                ? "grid grid-cols-1 gap-2"
                : "grid grid-cols-[110px_1fr] md:grid-cols-[140px_1fr] gap-2"
            }
          >
            {!tableContext && (
              <button
                onClick={onSuspend}
                disabled={lines.length === 0}
                className="h-12 md:h-14 border border-mipiace-coral/30 text-mipiace-coral-dark hover:bg-mipiace-coral-soft hover:border-mipiace-coral/50 disabled:opacity-50 font-medium text-[13.5px] md:text-[14.5px] gap-2 rounded-2xl flex items-center justify-center"
              >
                <Bookmark className="w-[15px] md:w-[16px] h-[15px] md:h-[16px]" strokeWidth={2.25} />
                Guardar
              </button>
            )}
            {/* v1.4-Bar-Operativa-MVP Lote 2 · botón "Enviar comanda"
                sólo en mesa. Primer envío rotula como acción primaria
                (texto coral suave); reenvíos quedan más discretos
                (texto gris) porque ya hay una comanda física en la
                cocina y el caso normal es no reenviar. */}
            {tableContext && (
              <button
                onClick={onSendToKitchen}
                disabled={lines.length === 0 || kitchenBusy}
                className={
                  kitchenLastRevision > 0
                    ? "h-12 md:h-14 border border-slate-200 hover:bg-slate-50 disabled:opacity-50 text-slate-600 font-medium text-[13.5px] md:text-[14px] rounded-2xl flex items-center justify-center gap-2"
                    : "h-12 md:h-14 border border-mipiace-coral/40 text-mipiace-coral-dark hover:bg-mipiace-coral-soft disabled:opacity-50 font-medium text-[13.5px] md:text-[14.5px] rounded-2xl flex items-center justify-center gap-2"
                }
                title={
                  kitchenLastRevision > 0
                    ? `Reenviar la comanda (la cocina ya recibió la nº ${kitchenLastRevision}).`
                    : "Imprime una comanda por sección (barra/cocina/salón) y la lleva el camarero."
                }
              >
                {kitchenBusy
                  ? "Enviando…"
                  : kitchenLastRevision > 0
                    ? `Reenviar comanda (nº ${kitchenLastRevision + 1})`
                    : "Enviar comanda"}
              </button>
            )}
            <button
              onClick={onClickCheckout}
              disabled={lines.length === 0}
              className="h-12 md:h-14 bg-mipiace-coral hover:bg-mipiace-coral-dark disabled:opacity-50 text-white font-medium text-[14px] md:text-[15px] flex items-center justify-between px-4 md:px-5 rounded-2xl"
            >
              <span>{vocab("saleAction", businessType)}</span>
              <span className="tabular-nums">{formatEur(totals.total)}</span>
            </button>
          </div>
        </div>

        {/* 4 · Lista de líneas debajo del Cobrar. flex-1 + min-h
             para garantizar 3-4 líneas visibles en cualquier viewport;
             el aside ya tiene overflow-y-auto que da scroll natural
             cuando hay muchas líneas. */}
        <div className="px-5 md:px-7 py-3 flex-1 min-h-[160px]">
          {lines.length === 0 ? (
            <div className="py-10 text-center text-[13px] text-slate-400">
              Pulsa un {vocab("itemNoun", businessType).toLowerCase()} o escanea un código para empezar.
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {/* v1.2-Lite-fix1 Lote 3 (F2-UX): cada línea es un
                  componente extraído con stepper inline y papelera
                  armada por doble tap. El click central sigue
                  abriendo el LineSheet para edición avanzada (precio,
                  descuento, modifiers, nota). */}
              {lines.map((l) => (
                <CartLineItem
                  key={l.id}
                  line={l}
                  onClick={() => onClickLine(l)}
                  onUnitsChange={(units) => onUpdateLineUnits(l.id, units)}
                  onRemove={() => onRemoveLine(l.id)}
                />
              ))}
            </div>
          )}
        </div>

      </aside>
    </div>
  );
}

// ── Sheets pequeñas ───────────────────────────────────────────────────

function DiscountGlobalSheet({
  currentPct,
  onApply,
  onClose,
}: {
  currentPct: number;
  onApply: (pct: number) => void;
  onClose: () => void;
}) {
  const [pct, setPct] = useState(String(currentPct));
  const bt = getCachedBusinessType();
  return (
    <SheetWrap onClose={onClose} title="Descuento global">
      <p className="text-[13px] text-slate-500 mb-4">
        Aplica un porcentaje a todas las líneas del {vocab("ticketNoun", bt).toLowerCase()}. El cajero puede llegar al 10% sin autorización (núcleo §6.3).
      </p>
      <label className="block text-[13px] font-medium text-mipiace-ink mb-2">% sobre el subtotal</label>
      <input
        type="number"
        value={pct}
        onChange={(e) => setPct(e.target.value)}
        min={0}
        max={100}
        className="w-full h-14 px-4 text-[20px] font-semibold bg-mipiace-stone border border-transparent rounded-2xl focus:ring-2 focus:ring-mipiace-coral/40 focus:border-mipiace-coral/30 focus:bg-white tabular-nums text-right focus:outline-none mb-4"
      />
      <div className="grid grid-cols-4 gap-2 mb-5">
        {[5, 10, 15, 20].map((v) => (
          <button
            key={v}
            onClick={() => setPct(String(v))}
            className="h-11 rounded-xl bg-mipiace-stone hover:bg-slate-100 text-[13px] font-medium text-mipiace-ink tabular-nums"
          >
            {v}%
          </button>
        ))}
      </div>
      <div className="flex gap-2.5">
        <button
          onClick={onClose}
          className="flex-1 h-12 rounded-2xl border border-slate-200 hover:bg-slate-50 text-[13.5px] text-mipiace-ink-soft font-medium"
        >
          Cancelar
        </button>
        <button
          onClick={() => onApply(Number(pct) || 0)}
          className="flex-1 h-12 rounded-2xl bg-mipiace-coral hover:bg-mipiace-coral-dark text-white text-[14px] font-medium"
        >
          Aplicar
        </button>
      </div>
    </SheetWrap>
  );
}

function FreeLineSheet({
  wildcards,
  onClose,
  onAdd,
}: {
  wildcards: Wildcard[];
  onClose: () => void;
  onAdd: (line: { name: string; price: number; taxRate: number }) => void;
}) {
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [taxRate, setTaxRate] = useState<number>(
    wildcards.find((w) => Math.abs(w.taxRate - 21) < 0.01)?.taxRate ?? wildcards[0]?.taxRate ?? 21,
  );
  const valid = name.length > 0 && Number(price.replace(",", ".")) > 0;
  return (
    <SheetWrap onClose={onClose} title="Línea libre">
      <p className="text-[13px] text-slate-500 mb-4">
        Va contra el comodín TPV-OTROS-{taxRate} de Holded (núcleo §6.1). El nombre lo verás en el ticket.
      </p>
      <label className="block text-[13px] font-medium text-mipiace-ink mb-2">Concepto</label>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="w-full h-12 mb-4 px-3.5 rounded-xl bg-mipiace-stone border border-transparent text-[14.5px] focus:bg-white focus:border-mipiace-coral/30 focus:ring-2 focus:ring-mipiace-coral/30 focus:outline-none"
        placeholder="Ej.: Bandeja personalizada"
      />
      <label className="block text-[13px] font-medium text-mipiace-ink mb-2">Precio (con IVA)</label>
      <input
        value={price}
        onChange={(e) => setPrice(e.target.value)}
        inputMode="decimal"
        className="w-full h-14 mb-4 px-4 text-[20px] font-semibold bg-mipiace-stone border border-transparent rounded-2xl focus:ring-2 focus:ring-mipiace-coral/40 focus:border-mipiace-coral/30 focus:bg-white tabular-nums text-right focus:outline-none"
        placeholder="0,00"
      />
      <label className="block text-[13px] font-medium text-mipiace-ink mb-2">IVA</label>
      <div className="grid grid-cols-4 gap-2 mb-5">
        {wildcards.length === 0
          ? [21, 10, 4, 0]
          : Array.from(new Set(wildcards.map((w) => w.taxRate))).sort((a, b) => b - a)}
        {wildcards.length === 0 && (
          <div className="col-span-4 text-[12.5px] text-amber-700 bg-amber-50 rounded-xl p-3">
            Aún no se han creado comodines TPV-OTROS-{`{IVA}`}. Lanza un sync.
          </div>
        )}
        {wildcards.length > 0 &&
          Array.from(new Set(wildcards.map((w) => w.taxRate)))
            .sort((a, b) => b - a)
            .map((r) => (
              <button
                key={r}
                onClick={() => setTaxRate(r)}
                className={
                  Math.abs(r - taxRate) < 0.01
                    ? "h-11 rounded-xl bg-mipiace-coral text-white text-[13px] font-medium tabular-nums"
                    : "h-11 rounded-xl bg-mipiace-stone hover:bg-slate-100 text-[13px] font-medium text-mipiace-ink tabular-nums"
                }
              >
                {r}%
              </button>
            ))}
      </div>
      <div className="flex gap-2.5">
        <button
          onClick={onClose}
          className="flex-1 h-12 rounded-2xl border border-slate-200 hover:bg-slate-50 text-[13.5px] text-mipiace-ink-soft font-medium"
        >
          Cancelar
        </button>
        <button
          onClick={() =>
            onAdd({
              name,
              price: Number(price.replace(",", ".")),
              taxRate,
            })
          }
          disabled={!valid || wildcards.length === 0}
          className="flex-1 h-12 rounded-2xl bg-mipiace-coral hover:bg-mipiace-coral-dark disabled:opacity-50 text-white text-[14px] font-medium"
        >
          Añadir línea
        </button>
      </div>
    </SheetWrap>
  );
}

function NotesSheet({
  value,
  onClose,
  onSave,
}: {
  value: string;
  onClose: () => void;
  onSave: (v: string) => void;
}) {
  const [text, setText] = useState(value);
  const bt = getCachedBusinessType();
  return (
    <SheetWrap onClose={onClose} title={`Observaciones del ${vocab("ticketNoun", bt).toLowerCase()}`}>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={5}
        className="w-full px-3.5 py-2.5 rounded-xl bg-mipiace-stone border border-transparent text-[14px] focus:bg-white focus:border-mipiace-coral/30 focus:ring-2 focus:ring-mipiace-coral/30 focus:outline-none"
        placeholder="Observaciones internas (cliente alérgico, reserva pendiente, instrucciones de cocina, etc.). Visibles en el ticket impreso y en Holded."
      />
      <div className="flex gap-2.5 mt-5">
        <button
          onClick={onClose}
          className="flex-1 h-12 rounded-2xl border border-slate-200 hover:bg-slate-50 text-[13.5px] text-mipiace-ink-soft font-medium"
        >
          Cancelar
        </button>
        <button
          onClick={() => onSave(text)}
          className="flex-1 h-12 rounded-2xl bg-mipiace-coral hover:bg-mipiace-coral-dark text-white text-[14px] font-medium"
        >
          Guardar observaciones
        </button>
      </div>
    </SheetWrap>
  );
}

function SuspendedSheet({
  onClose,
  onRecover,
}: {
  onClose: () => void;
  onRecover: (cart: SuspendedCart) => void;
}) {
  const [carts, setCarts] = useState<SuspendedCart[]>(getSuspendedCarts());
  const bt = getCachedBusinessType();
  const title = bt === "SERVICES" ? "Servicios pendientes" : "Ventas pendientes";
  return (
    <SheetWrap onClose={onClose} title={title}>
      {carts.length === 0 ? (
        <p className="text-[13px] text-slate-500">No hay {title.toLowerCase()}.</p>
      ) : (
        <ul className="space-y-2">
          {carts.map((c) => (
            <li
              key={c.id}
              className="flex items-center gap-3 p-3 rounded-xl border border-slate-200"
            >
              <div className="flex-1 min-w-0">
                <div className="text-[14px] font-medium text-mipiace-ink truncate">{c.label}</div>
                <div className="text-[12.5px] text-slate-500 truncate">
                  {c.lines.length} línea{c.lines.length === 1 ? "" : "s"} ·{" "}
                  {new Date(c.createdAt).toLocaleTimeString("es-ES")}
                  {c.contactName ? ` · ${c.contactName}` : ""}
                </div>
              </div>
              <button
                onClick={() => onRecover(c)}
                className="h-9 px-3 rounded-lg bg-mipiace-coral text-white text-[13px] font-medium"
              >
                Recuperar
              </button>
              <button
                onClick={() => {
                  removeSuspendedCart(c.id);
                  setCarts(getSuspendedCarts());
                }}
                className="h-9 w-9 rounded-lg hover:bg-slate-50 text-slate-500 flex items-center justify-center"
                aria-label="Borrar"
              >
                <X className="w-4 h-4" strokeWidth={2.1} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </SheetWrap>
  );
}

function SheetWrap({
  onClose,
  title,
  children,
}: {
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 bg-mipiace-ink/40 flex items-end sm:items-center justify-center p-4 font-sans"
      onClick={onClose}
      // v1.3-UX-Iteración Lote 2: la sheet se centra/abajo según
      // breakpoint; cuando aparece el teclado en apaisado, el
      // padding-bottom dinámico empuja la caja hacia arriba para que
      // los botones de acción no queden ocultos.
      style={{ paddingBottom: "calc(1rem + var(--keyboard-offset, 0px))" }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white w-full max-w-md rounded-3xl border border-slate-200 p-6 md:p-7"
      >
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-[18px] font-semibold text-mipiace-ink">{title}</h2>
          <button
            onClick={onClose}
            className="h-9 w-9 rounded-xl hover:bg-slate-50 text-slate-500 flex items-center justify-center"
            aria-label="Cerrar"
          >
            <X className="w-4 h-4" strokeWidth={2.25} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function TableContextLine({
  table,
  itemCount,
}: {
  table: TableContext;
  itemCount: number;
}) {
  const elapsed = useElapsedTime(table.openedAt);
  const parts: string[] = [];
  if (table.diners != null && table.diners > 0) {
    parts.push(`${table.diners} comensales`);
  }
  if (elapsed) parts.push(elapsed);
  if (table.openedByEmail) parts.push(table.openedByEmail.split("@")[0]!);
  parts.push(`${itemCount} ${itemCount === 1 ? "ud." : "uds."}`);
  return <>{parts.join(" · ")}</>;
}

const SECTION_LABEL_ES: Record<string, string> = {
  BARRA: "BARRA",
  COCINA: "COCINA",
  SALON: "SALÓN",
};

function KitchenToast({
  sections,
  revision,
  onClose,
}: {
  sections: Array<{ section: string; lineCount: number }>;
  revision: number;
  onClose: () => void;
}) {
  // Auto-cierre a los 5s — el cajero quiere ver el feedback pero no
  // que le tape la UI mientras gestiona la mesa.
  useEffect(() => {
    const t = setTimeout(onClose, 5_000);
    return () => clearTimeout(t);
  }, [onClose]);
  return (
    <div className="fixed top-5 right-5 z-50 bg-emerald-50 border border-emerald-300 text-emerald-900 px-4 py-3 rounded-2xl shadow-sm max-w-sm">
      <div className="text-[13.5px] font-semibold mb-1">
        Comanda nº {revision} enviada
      </div>
      <div className="text-[12.5px] space-y-0.5">
        {sections.map((s) => (
          <div key={s.section}>
            {SECTION_LABEL_ES[s.section] ?? s.section}: {s.lineCount}{" "}
            {s.lineCount === 1 ? "línea" : "líneas"}
          </div>
        ))}
      </div>
    </div>
  );
}

function KitchenErrorBanner({
  message,
  onClose,
}: {
  message: string;
  onClose: () => void;
}) {
  useEffect(() => {
    const t = setTimeout(onClose, 7_000);
    return () => clearTimeout(t);
  }, [onClose]);
  return (
    <div className="fixed top-5 right-5 z-50 bg-red-50 border border-red-300 text-red-900 px-4 py-3 rounded-2xl shadow-sm max-w-sm">
      <div className="text-[13.5px] font-semibold mb-1">
        No se pudo enviar la comanda
      </div>
      <div className="text-[12.5px]">{message}</div>
    </div>
  );
}
