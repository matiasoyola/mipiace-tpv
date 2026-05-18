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
  CircleAlert,
  Coffee,
  Plus,
  RotateCw,
  Search,
  ShoppingBag,
  Star,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";

import { ApiError } from "../api.js";
import { Logo } from "../Logo.js";
import {
  computeCart,
  computeLine,
  getSuspendedCarts,
  removeSuspendedCart,
  saveSuspendedCart,
  type CartLine,
  type SuspendedCart,
} from "../lib/cart.js";
import {
  findByBarcode,
  fuzzySearch,
  loadCatalogFromCache,
  loadWildcards,
  refreshCatalog,
  type CatalogProduct,
  type Wildcard,
} from "../lib/catalog.js";
import { ContactSheet, type ContactRef } from "./SalePage.contact.js";
import { CheckoutOverlay } from "./CheckoutPage.js";
import { CloseShiftModal } from "./CloseShiftModal.js";
import { LineSheet } from "./SalePage.lineSheet.js";
import { ModifierSelector } from "./SalePage.modifierSelector.js";
import { TicketsHistoryPage } from "./TicketsHistoryPage.js";
import { useElapsedTime } from "../hooks/useElapsedTime.js";
import type { ModifierSelection } from "../lib/cart.js";
import {
  buildGroupsByProduct,
  loadModifierGroups,
  type CatalogModifierGroup,
} from "../lib/modifiers.js";

const formatEur = (n: number) => n.toFixed(2).replace(".", ",") + " €";

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
  onLogoutCashier: () => void;
  onCloseShift: () => void;
}

export function SalePage(props: SalePageProps) {
  const [showCloseShift, setShowCloseShift] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [catalog, setCatalog] = useState<CatalogProduct[] | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [wildcards, setWildcards] = useState<Wildcard[]>([]);
  const [refreshing, setRefreshing] = useState(false);

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
      if (!cancelled) setTimeout(tick, 30_000);
    }
    tick();
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Foco permanente al input de búsqueda para el scanner USB-HID ───
  useEffect(() => {
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
  const onSearchKey = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key !== "Enter") return;
      const value = query.trim();
      if (!value || !catalog) return;
      const byBarcode = findByBarcode(catalog, value);
      if (byBarcode) {
        addProduct(byBarcode);
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
  function newId(): string {
    return crypto.randomUUID();
  }

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
        name: "Cliente",
      });
    }
    removeSuspendedCart(cart.id);
  }

  const totals = useMemo(() => computeCart(lines), [lines]);
  const filtered = useMemo(() => {
    if (!catalog) return [];
    if (query.trim().length === 0) {
      return catalog.slice(0, 40);
    }
    return fuzzySearch(catalog, query, 40);
  }, [catalog, query]);

  // ── Render ─────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-mipiace-stone flex flex-col font-sans">
      <div className="flex-1 flex max-w-[1680px] w-full mx-auto bg-white">
        <aside className="hidden md:flex w-[88px] xl:w-[240px] shrink-0 border-r border-slate-200 flex-col px-3 xl:px-5 py-5">
          <div className="mb-7 xl:mb-8 flex justify-center xl:justify-start">
            <div className="hidden xl:block">
              <Logo size={28} />
            </div>
          </div>
          <nav className="space-y-1.5">
            <button
              title="Venta"
              className="w-full h-12 flex items-center xl:gap-3 px-3 xl:px-4 rounded-xl bg-mipiace-coral-soft text-mipiace-coral-dark text-[14.5px] font-medium justify-center xl:justify-start"
            >
              <ShoppingBag
                className="w-[19px] h-[19px] text-mipiace-coral shrink-0"
                strokeWidth={2.1}
              />
              <span className="hidden xl:inline">Venta</span>
            </button>
          </nav>
          <div className="mt-auto hidden xl:block">
            <button
              onClick={() => setShowCloseShift(true)}
              className="text-[12px] text-slate-400 hover:text-mipiace-coral-dark font-medium text-left w-full px-2 py-2"
            >
              Cerrar turno
            </button>
            <button
              onClick={props.onLogoutCashier}
              className="text-[12px] text-slate-400 hover:text-mipiace-coral-dark font-medium text-left w-full px-2 py-2"
            >
              Bloquear ({props.cashierEmail})
            </button>
          </div>
        </aside>

        <div className="flex-1 flex flex-col min-w-0">
          <header className="h-[88px] md:h-[100px] border-b border-slate-200 flex items-center px-4 md:px-7 gap-3 shrink-0">
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
                  placeholder="Buscar producto, código de barras o SKU…"
                  className="h-12 md:h-14 w-full pl-11 md:pl-12 pr-4 text-[14px] md:text-[14.5px] bg-mipiace-stone border border-transparent rounded-2xl focus:outline-none focus:ring-2 focus:ring-mipiace-coral/40 focus:bg-white focus:border-mipiace-coral/30"
                />
              </div>
            </div>
            <div className="flex items-center gap-2 md:gap-2.5 ml-auto">
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
                title="Ventas suspendidas"
                className="h-12 md:h-14 px-3 md:px-5 rounded-2xl bg-mipiace-coral-soft border border-mipiace-coral/25 flex items-center gap-2 text-[13.5px] md:text-[14px] font-medium text-mipiace-coral-dark hover:bg-mipiace-coral/15"
              >
                <Bookmark className="w-[17px] h-[17px]" strokeWidth={2.25} />
                <span className="hidden sm:inline">Suspendidos ({getSuspendedCarts().length})</span>
              </button>
              <button
                onClick={clearCart}
                title="Nueva venta"
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
            tableContext={props.tableContext ?? null}
            onBackToMap={props.onBackToMap ?? null}
            onClickProduct={addProduct}
            onClickFreeLine={() => setOpenSheet({ kind: "freeLine" })}
            onClickLine={(line) => setOpenSheet({ kind: "line", line })}
            onClickDiscountGlobal={() => setOpenSheet({ kind: "discountGlobal" })}
            onClickNotes={() => setOpenSheet({ kind: "notes" })}
            onClickContact={() => setOpenSheet({ kind: "contact" })}
            onClickCheckout={() => setOpenSheet({ kind: "checkout" })}
            onSuspend={() => suspendCart("")}
            onCancel={() => {
              if (lines.length === 0 || confirm("¿Cancelar la venta en curso?")) {
                clearCart();
              }
            }}
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
          onClose={() => setShowCloseShift(false)}
          onClosed={() => {
            setShowCloseShift(false);
            props.onCloseShift();
          }}
        />
      )}
      {showHistory && (
        <TicketsHistoryPage onClose={() => setShowHistory(false)} />
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

// Desglose visual del carrito para una línea con modifiers
// estructurados. Cada selección sale en una sub-línea con sangría —
// formato `└ Grupo · Etiqueta   + 0,50 €`.
function ModifierBreakdown({ selections }: { selections: ModifierSelection[] }) {
  return (
    <div className="text-[12.5px] text-slate-500 mt-0.5 space-y-0.5">
      {selections.map((s, i) => {
        const sign = s.priceDeltaCents > 0 ? "+" : "−";
        const delta =
          s.priceDeltaCents !== 0
            ? ` ${sign} ${formatEur(Math.abs(s.priceDeltaCents) / 100)}`
            : "";
        return (
          <div key={`${s.groupId}-${s.modifierId}-${i}`} className="flex items-baseline gap-1">
            <span className="text-slate-300">└</span>
            <span className="flex-1 truncate">
              {s.groupName} · {s.label}
            </span>
            {delta && (
              <span
                className={`tabular-nums shrink-0 ${
                  s.priceDeltaCents > 0 ? "text-slate-500" : "text-mipiace-coral"
                }`}
              >
                {delta}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

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
  tableContext,
  onBackToMap,
  onClickProduct,
  onClickFreeLine,
  onClickLine,
  onClickDiscountGlobal,
  onClickNotes,
  onClickContact,
  onClickCheckout,
  onSuspend,
  onCancel,
}: {
  products: CatalogProduct[];
  wildcards: Wildcard[];
  catalogError: string | null;
  lines: CartLine[];
  contact: ContactRef | null;
  notes: string;
  totals: ReturnType<typeof computeCart>;
  cashierRole: "MANAGER" | "CASHIER";
  tableContext: TableContext | null;
  onBackToMap: (() => void) | null;
  onClickProduct: (p: CatalogProduct) => void;
  onClickFreeLine: () => void;
  onClickLine: (line: CartLine) => void;
  onClickDiscountGlobal: () => void;
  onClickNotes: () => void;
  onClickContact: () => void;
  onClickCheckout: () => void;
  onSuspend: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="flex-1 grid lg:grid-cols-[1fr_460px] gap-4 lg:gap-6 p-4 md:p-7 min-h-0">
      <section className="flex flex-col min-w-0 order-2 lg:order-1">
        <div className="flex items-center gap-2 mb-4 md:mb-6 overflow-x-auto">
          <button className="h-11 md:h-12 px-4 md:px-5 rounded-2xl bg-mipiace-coral text-white text-[13.5px] md:text-[14px] font-medium flex items-center gap-2 shrink-0">
            <Star className="w-3.5 h-3.5 fill-white" strokeWidth={2.5} />
            Todos
          </button>
        </div>
        {catalogError && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-2xl p-4 mb-4 text-[13px]">
            {catalogError}
          </div>
        )}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-3 md:gap-3.5 mb-5 md:mb-6">
          {products.map((p) => (
            <button
              key={p.id}
              onClick={() => onClickProduct(p)}
              className="group bg-white rounded-2xl border border-slate-200 overflow-hidden text-left hover:border-mipiace-coral/50 hover:shadow-sm transition-all"
            >
              <div className="aspect-[5/4] flex items-center justify-center bg-stone-100 text-stone-600">
                <Coffee className="w-10 h-10 md:w-12 md:h-12 opacity-80" strokeWidth={1.4} />
              </div>
              <div className="px-3 md:px-3.5 py-2.5 md:py-3">
                <div className="text-[13px] md:text-[13.5px] font-medium text-mipiace-ink truncate">
                  {p.name}
                </div>
                <div className="text-[12.5px] md:text-[13px] text-slate-500 mt-0.5 tabular-nums">
                  {formatEur(p.priceGross)}
                </div>
              </div>
            </button>
          ))}
          <button
            onClick={onClickFreeLine}
            className="bg-transparent rounded-2xl border-2 border-dashed border-slate-300 hover:border-mipiace-coral/50 hover:bg-mipiace-coral-soft/40 flex flex-col items-center justify-center gap-2 text-slate-400 hover:text-mipiace-coral-dark text-[13px] font-medium min-h-[140px] md:min-h-[180px]"
          >
            <Plus className="w-6 h-6" strokeWidth={2} />
            Línea libre
          </button>
        </div>
        <div className="grid grid-cols-4 gap-2 md:gap-3 mt-auto">
          <button
            onClick={onClickDiscountGlobal}
            className="h-12 md:h-14 bg-mipiace-stone hover:bg-slate-100 rounded-2xl flex items-center justify-center gap-2 text-[13px] md:text-[14px] font-medium text-mipiace-ink"
          >
            <span>Descuento</span>
          </button>
          <button
            onClick={onClickNotes}
            className="h-12 md:h-14 bg-mipiace-stone hover:bg-slate-100 rounded-2xl flex items-center justify-center gap-2 text-[13px] md:text-[14px] font-medium text-mipiace-ink"
          >
            <span>Nota{notes ? " ●" : ""}</span>
          </button>
          <button
            onClick={onClickContact}
            className="h-12 md:h-14 bg-mipiace-stone hover:bg-slate-100 rounded-2xl flex items-center justify-center gap-2 text-[13px] md:text-[14px] font-medium text-mipiace-ink truncate"
          >
            <span className="truncate">
              {contact ? `Cliente: ${contact.name.split(" ")[0]}` : "Cliente"}
            </span>
          </button>
          <button
            onClick={onCancel}
            className="h-12 md:h-14 bg-mipiace-stone hover:bg-slate-100 rounded-2xl flex items-center justify-center gap-2 text-[13px] md:text-[14px] font-medium text-mipiace-ink"
          >
            <span>Cancelar</span>
          </button>
        </div>
      </section>

      {/* B5 §3.1: el panel del ticket se ajusta al contenido (no
          sticky-bottom). Con pocas líneas el botón Cobrar queda cerca
          del foco visual; si hay muchas, el panel crece y la PÁGINA
          (no el panel) se scrollea normal. */}
      <aside className="bg-white rounded-3xl border border-slate-200 flex flex-col order-1 lg:order-2 self-start">
        <div className="flex items-center justify-between px-5 md:px-7 pt-5 md:pt-6 pb-4 md:pb-5 border-b border-slate-100">
          <div className="min-w-0">
            <h2 className="text-[18px] md:text-[20px] font-semibold text-mipiace-ink tracking-tight truncate">
              {tableContext ? `Mesa ${tableContext.name}` : "Ticket de venta"}
            </h2>
            <div className="text-[12.5px] text-slate-500 mt-0.5">
              {tableContext ? (
                <TableContextLine
                  table={tableContext}
                  itemCount={totals.itemCount}
                />
              ) : (
                <>
                  {totals.itemCount}{" "}
                  {totals.itemCount === 1 ? "unidad" : "unidades"}
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
        <div className="px-5 md:px-7 py-1">
          {lines.length === 0 ? (
            <div className="py-10 text-center text-[13px] text-slate-400">
              Pulsa un producto o escanea un código para empezar.
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {lines.map((l) => {
                const t = computeLine(l);
                return (
                  <button
                    key={l.id}
                    onClick={() => onClickLine(l)}
                    className="group w-full flex items-center gap-3 md:gap-3.5 py-3.5 md:py-4 text-left"
                  >
                    <span className="shrink-0 h-9 w-9 rounded-xl bg-mipiace-stone text-mipiace-ink text-[14px] font-semibold tabular-nums flex items-center justify-center">
                      {l.units}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="text-[14px] md:text-[14.5px] font-medium text-mipiace-ink leading-tight">
                        {l.nameSnapshot}
                      </div>
                      {l.modifierSelections && l.modifierSelections.length > 0 ? (
                        <ModifierBreakdown selections={l.modifierSelections} />
                      ) : l.modifiers.length > 0 ? (
                        <div className="text-[12.5px] text-slate-500 mt-0.5">
                          {l.modifiers.join(" · ")}
                        </div>
                      ) : l.discountPct > 0 ? (
                        <div className="text-[12.5px] text-mipiace-coral mt-0.5 tabular-nums">
                          {formatEur(l.priceGross)} ud. · −{l.discountPct}%
                        </div>
                      ) : l.units > 1 ? (
                        <div className="text-[12.5px] text-slate-400 tabular-nums mt-0.5">
                          {formatEur(l.priceGross)} ud.
                        </div>
                      ) : null}
                    </div>
                    <div className="text-right shrink-0">
                      <span className="text-[14px] md:text-[14.5px] font-medium text-mipiace-ink tabular-nums">
                        {formatEur(t.totalGross)}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <div className="px-5 md:px-7 py-4 md:py-5 border-t border-slate-100 space-y-2">
          <div className="flex justify-between text-[13.5px] md:text-[14px]">
            <span className="text-slate-500">Subtotal</span>
            <span className="text-mipiace-ink tabular-nums">{formatEur(totals.subtotalNet)}</span>
          </div>
          {totals.discount > 0 && (
            <div className="flex justify-between text-[13.5px] md:text-[14px]">
              <span className="text-slate-500">Descuento</span>
              <span className="text-mipiace-coral tabular-nums font-medium">
                −{formatEur(totals.discount)}
              </span>
            </div>
          )}
          <div className="flex justify-between text-[13.5px] md:text-[14px]">
            <span className="text-slate-500">IVA</span>
            <span className="text-mipiace-ink tabular-nums">{formatEur(totals.tax)}</span>
          </div>
        </div>
        <div className="px-5 md:px-7 pt-4 md:pt-5 pb-5 md:pb-6 border-t border-slate-200">
          <div className="flex items-baseline justify-between mb-4 md:mb-5">
            <span className="text-[17px] md:text-[18px] font-semibold text-mipiace-ink">Total</span>
            <span className="text-[30px] md:text-[36px] font-semibold text-mipiace-ink tabular-nums tracking-tight">
              {formatEur(totals.total)}
            </span>
          </div>
          <div
            className={
              tableContext
                ? "grid grid-cols-1 gap-2 md:gap-3"
                : "grid grid-cols-[120px_1fr] md:grid-cols-[160px_1fr] gap-2 md:gap-3"
            }
          >
            {/* En modo mesa, "Suspender" no aplica: la mesa abierta ya
                es "venta suspendida" por naturaleza (bar.md §4.4). */}
            {!tableContext && (
              <button
                onClick={onSuspend}
                disabled={lines.length === 0}
                className="h-14 md:h-16 border border-mipiace-coral/30 text-mipiace-coral-dark hover:bg-mipiace-coral-soft hover:border-mipiace-coral/50 disabled:opacity-50 font-medium text-[14px] md:text-[15px] gap-2 rounded-2xl flex items-center justify-center"
              >
                <Bookmark className="w-[16px] md:w-[17px] h-[16px] md:h-[17px]" strokeWidth={2.25} />
                Guardar
              </button>
            )}
            <button
              onClick={onClickCheckout}
              disabled={lines.length === 0}
              className="h-14 md:h-16 bg-mipiace-coral hover:bg-mipiace-coral-dark disabled:opacity-50 text-white font-medium text-[14px] md:text-[15px] flex items-center justify-between px-4 md:px-5 rounded-2xl"
            >
              <span>Cobrar</span>
              <span className="tabular-nums">{formatEur(totals.total)}</span>
            </button>
          </div>
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
  return (
    <SheetWrap onClose={onClose} title="Descuento global">
      <p className="text-[13px] text-slate-500 mb-4">
        Aplica un porcentaje a todas las líneas del ticket. El cajero puede llegar al 10% sin autorización (núcleo §6.3).
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
  return (
    <SheetWrap onClose={onClose} title="Notas de venta">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={5}
        className="w-full px-3.5 py-2.5 rounded-xl bg-mipiace-stone border border-transparent text-[14px] focus:bg-white focus:border-mipiace-coral/30 focus:ring-2 focus:ring-mipiace-coral/30 focus:outline-none"
        placeholder="Comentarios visibles en el ticket impreso y en Holded."
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
          Guardar nota
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
  return (
    <SheetWrap onClose={onClose} title="Ventas suspendidas">
      {carts.length === 0 ? (
        <p className="text-[13px] text-slate-500">No hay ventas suspendidas.</p>
      ) : (
        <ul className="space-y-2">
          {carts.map((c) => (
            <li
              key={c.id}
              className="flex items-center gap-3 p-3 rounded-xl border border-slate-200"
            >
              <div className="flex-1 min-w-0">
                <div className="text-[14px] font-medium text-mipiace-ink truncate">{c.label}</div>
                <div className="text-[12.5px] text-slate-500">
                  {c.lines.length} línea{c.lines.length === 1 ? "" : "s"} ·{" "}
                  {new Date(c.createdAt).toLocaleTimeString("es-ES")}
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
