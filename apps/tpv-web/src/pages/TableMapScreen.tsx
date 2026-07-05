// Mapa de sala del vertical bar. Punto de entrada del cajero cuando la
// tienda tiene mesas configuradas.
//
// v1.9.3-mapa-visual (2026-07-05): rediseño del lienzo según
// docs/mockups/mapa-sala-visual.html (la spec). Principio de producto
// (Matías): el cobro nace en la mesa; el camarero ejecuta, no piensa.
//   - Zonas como ÁREAS ESPACIALES: marcos con borde discontinuo y label
//     flotante. Salón (grid 2 col), Terraza (marco propio), Barra
//     (mostrador dibujado + taburetes circulares por barSeatIndex).
//   - Tarjeta con estados libre / ocupada / BILLING(cuenta), grupos
//     fundidos (absorbida atenuada + puente hacia la principal), y
//     alerta de "mesa olvidada" (>45 min → halo ámbar interior).
//   - Cobro DESDE LA TARJETA en estado BILLING: botón «Cobrar X €» que
//     abre el modal de cobro ACTUAL (CheckoutOverlay) con la proyección
//     fresca del DRAFT (GET /tickets/:id) sin pasar por SalePage. Mismo
//     endpoint, mismo modal, misma idempotencia — cero cambios de flujo
//     de dinero. Al cobrar: banner de confirmación de v1.9.2.
//   - Cabecera de sala: «N abiertas · M libres · X,XX € en sala».
//
// Conserva el header/banners/drawer que dejó v1.9.2 (Tickets +
// hamburguesa en el mapa, banners de concurrencia, Arqueo/Cerrar turno).
//
// Hasta tener WebSockets sanos, refrescamos con polling de respaldo.
//
// El tap-flow se delega al padre (`App`) vía callbacks:
//   - onPickTable(table) cuando el cajero toca una mesa (abre server-side
//     y entra a SalePage). Para una mesa absorbida, se le pasa la
//     principal (el click lleva a la principal).
//   - onQuickSale() para venta rápida.

import { Suspense, lazy, useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import {
  Calculator,
  Check,
  CheckCircle2,
  Loader2,
  Lock,
  Menu,
  Plus,
  PowerOff,
  ReceiptText,
  RotateCw,
  WifiOff,
  X,
} from "lucide-react";

import { apiWithCashier, ApiError } from "../api.js";
import { Logo } from "../Logo.js";
import { useElapsedTime, useElapsedMinutes } from "../hooks/useElapsedTime.js";
import { useStoreEventStream } from "../hooks/useStoreEventStream.js";
import {
  getCachedBusinessType,
  getCachedCreditSalesEnabled,
  refreshCatalog,
} from "../lib/catalog.js";
import { computeCart } from "../lib/cart.js";
import type { CartLine, CartTotals } from "../lib/cart.js";
import { mapServerDraftLines } from "../lib/tableDraft.js";
import type { ServerDraft } from "../lib/tableDraft.js";
import { outboxBlockedTableIds, subscribeOutbox } from "../lib/outbox.js";
import { syncNow } from "../lib/syncNow.js";
import { CloseShiftModal } from "./CloseShiftModal.js";
import { TicketsHistoryPage } from "./TicketsHistoryPage.js";

// El modal de cobro arrastra un grafo de dependencias grande (impresión,
// outbox, overlays). Se carga en diferido para no engordar el arranque
// del mapa: sólo se necesita cuando el cajero pulsa «Cobrar X €».
const CheckoutOverlay = lazy(() =>
  import("./CheckoutPage.js").then((m) => ({ default: m.CheckoutOverlay })),
);

// v1.9.3-mapa-visual · umbral de "mesa olvidada" constante en el front
// (sin setting por tenant — decisión explícita del bloque).
const FORGOTTEN_TABLE_MINUTES = 45;

type TableZone = "SALON" | "TERRAZA" | "BARRA" | "RESERVADO";

export interface ApiTable {
  id: string;
  name: string;
  capacity: number;
  zone: TableZone;
  positionX: number | null;
  positionY: number | null;
  width: number | null;
  height: number | null;
  barSeatIndex: number | null;
  groupedIntoTableId: string | null;
  state: "FREE" | "OPEN" | "BILLING";
  activeTicket: {
    id: string;
    total: string;
    diners: number | null;
    openedAt: string;
    // v1.7-alias-cajeros: alias preferente para el chip de operador;
    // el email queda como fallback (users legacy o API vieja).
    openedByEmail: string | null;
    openedByAlias: string | null;
    lineCount: number;
  } | null;
  createdAt: string;
}

interface ApiResponse {
  storeId: string | null;
  registerId: string;
  tables: ApiTable[];
}

const ZONE_LABEL: Record<TableZone | "ALL", string> = {
  ALL: "Todas",
  SALON: "Salón",
  TERRAZA: "Terraza",
  BARRA: "Barra",
  RESERVADO: "Reservados",
};

const formatEur = (n: number) => n.toFixed(2).replace(".", ",") + " €";

// v1.9.2-mesas-concurrencia · Frente 1/2/3: aviso inline que el mapa
// muestra cuando el cajero es EXPULSADO de una mesa (cobrada/absorbida
// desde otra caja) o tras cobrar una mesa desde este dispositivo. Se
// autocierra a los 4 s y es cerrable a mano. `tone` cambia el color;
// `ticketQuery` (sólo en el banner de éxito) habilita "Ver ticket".
export interface MapNotice {
  text: string;
  tone?: "info" | "success";
  ticketQuery?: string | null;
}

export interface TableMapScreenProps {
  // v1.7-alias-cajeros: label de display (alias con fallback a email).
  cashierLabel: string;
  storeName: string;
  registerName: string;
  // v1.9.3-mapa-visual: necesario para el cobro desde la tarjeta
  // (CheckoutOverlay exige registerId).
  registerId?: string;
  onPickTable: (table: ApiTable) => void;
  onQuickSale: () => void;
  onLogoutCashier: () => void;
  onCloseShift: () => void;
  // v1.9.2-mesas-concurrencia · Frente 3.3: el header del mapa ofrece
  // ahora Arqueo X y Cerrar turno sin pasar por venta rápida. Requiere
  // el turno y el rol del cajero.
  shiftId?: string;
  cashierRole?: "MANAGER" | "CASHIER";
  // v1.9.2-mesas-concurrencia · banner de expulsión / éxito. El padre
  // (App) lo setea al navegar de vuelta al mapa por un evento remoto.
  notice?: MapNotice | null;
  // v1.0-mesas-frontend: el padre abre la mesa server-side ANTES de
  // entrar a SalePage. Mientras el POST está en vuelo, la mesa tocada
  // queda con spinner; si falla, el error se pinta en el banner.
  pickBusyTableId?: string | null;
  pickError?: string | null;
}

// v1.9.3-mapa-visual · estado del cobro directo desde tarjeta: mesa +
// proyección fresca del DRAFT lista para el CheckoutOverlay.
interface CobroState {
  table: ApiTable;
  ticketId: string;
  lines: CartLine[];
  totals: CartTotals;
}

export function TableMapScreen(props: TableMapScreenProps) {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  // v1.9.2-mesas-concurrencia · Frente 3.3: menú de caja y Tickets
  // accesibles desde el mapa (antes exigía pasar por venta rápida).
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [historyQuery, setHistoryQuery] = useState<string | undefined>(
    undefined,
  );
  const [showCloseShift, setShowCloseShift] = useState(false);
  const [showArqueoX, setShowArqueoX] = useState(false);
  const [syncState, setSyncState] = useState<"idle" | "running" | "done">(
    "idle",
  );
  // v1.9.3-mapa-visual · cobro desde tarjeta (sólo BILLING).
  const [cobro, setCobro] = useState<CobroState | null>(null);
  const [cobroBusyId, setCobroBusyId] = useState<string | null>(null);
  // Aviso inline de expulsión / éxito. Copia local del prop para poder
  // autocerrarlo a los 4 s sin depender del padre.
  const [notice, setNotice] = useState<MapNotice | null>(props.notice ?? null);
  useEffect(() => {
    setNotice(props.notice ?? null);
  }, [props.notice]);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 4_000);
    return () => clearTimeout(t);
  }, [notice]);
  // Esc cierra el drawer del mapa.
  useEffect(() => {
    if (!drawerOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setDrawerOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [drawerOpen]);
  // v1.0-mesas-frontend · Lote 2: mesas con un checkout en tránsito en
  // ESTE dispositivo (item en el outbox local). Quedan bloqueadas hasta
  // que el reenvío confirme (el item desaparece) — reabrirlas podría
  // duplicar la cuenta que ya está "cobrada" para el cajero.
  const [blockedTableIds, setBlockedTableIds] = useState<Set<string>>(
    () => new Set(),
  );
  useEffect(() => {
    let cancelled = false;
    const reload = () => {
      outboxBlockedTableIds()
        .then((ids) => {
          if (!cancelled) setBlockedTableIds(ids);
        })
        .catch(() => {
          /* IndexedDB no disponible (modo privado) — sin bloqueo local */
        });
    };
    reload();
    const unsubscribe = subscribeOutbox(() => reload());
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await apiWithCashier<ApiResponse>("/tpv/tables");
      setData(res);
      setError(null);
      setOffline(false);
    } catch (err) {
      if (err instanceof ApiError && err.status === 0) setOffline(true);
      else if (err instanceof ApiError) setError(err.message);
      else setError("Error inesperado");
    }
  }, []);

  useEffect(() => {
    void load();
    // Polling de respaldo cada 30s. Con WebSocket sano apenas hace
    // falta; en degraded confirma que el render no quede congelado.
    const id = setInterval(() => void load(), 30_000);
    return () => clearInterval(id);
  }, [load]);

  // WebSocket multi-terminal: cada vez que llega un evento del store
  // refrescamos el listado. Es el patrón más simple y mantiene el
  // mapa coherente sin lógica de merge granular en el cliente.
  const wsStatus = useStoreEventStream(data?.storeId ?? null, () => {
    void load();
  });
  useEffect(() => {
    if (wsStatus === "degraded") setOffline(true);
    else if (wsStatus === "open") setOffline(false);
  }, [wsStatus]);

  const tables = data?.tables ?? [];
  const [zoneFilter, setZoneFilter] = useState<TableZone | "ALL">("ALL");

  const counts = countByZone(tables);
  // Cabecera de sala: "abiertas" = mesas no-absorbidas con ticket vivo;
  // "libres" = el resto (las absorbidas quedan del lado de "no abierta",
  // igual que el mockup). "€ en sala" = suma de totales de los DRAFTs
  // visibles — trazable a la misma respuesta de /tpv/tables, sin cálculo
  // nuevo en server.
  const openCount = tables.filter(
    (t) => t.state !== "FREE" && !t.groupedIntoTableId,
  ).length;
  const freeCount = tables.length - openCount;
  const salaTotal = tables.reduce(
    (sum, t) =>
      t.activeTicket && !t.groupedIntoTableId
        ? sum + Number(t.activeTicket.total)
        : sum,
    0,
  );

  const visible =
    zoneFilter === "ALL" ? tables : tables.filter((t) => t.zone === zoneFilter);

  // Mesas absorbidas → nombre de la principal para el texto "— unida a X"
  // y para redirigir el click. Índice por id sobre TODAS las mesas (la
  // principal puede estar en otra zona / fuera del filtro).
  const byId = new Map(tables.map((t) => [t.id, t]));
  const childrenByPrincipal = new Map<string, ApiTable[]>();
  for (const t of tables) {
    if (t.groupedIntoTableId) {
      const arr = childrenByPrincipal.get(t.groupedIntoTableId) ?? [];
      arr.push(t);
      childrenByPrincipal.set(t.groupedIntoTableId, arr);
    }
  }

  const salon = visible.filter((t) => t.zone === "SALON");
  const terraza = visible.filter((t) => t.zone === "TERRAZA");
  const reservado = visible.filter((t) => t.zone === "RESERVADO");
  const bar = visible.filter((t) => t.zone === "BARRA");

  const canCobrar = !!props.shiftId && !!props.registerId;

  // Cobro directo: trae la proyección FRESCA del DRAFT y abre el modal de
  // cobro actual. Sin pasar por SalePage; mismo endpoint/idempotencia.
  async function openCobro(table: ApiTable) {
    const ticketId = table.activeTicket?.id;
    if (!ticketId || !canCobrar || offline) return;
    setCobroBusyId(table.id);
    setError(null);
    try {
      const res = await apiWithCashier<{ ticket: ServerDraft }>(
        `/tickets/${ticketId}`,
      );
      const lines = mapServerDraftLines(res.ticket.lines);
      setCobro({ table, ticketId, lines, totals: computeCart(lines) });
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
      else
        setError(
          "Sin conexión. El cobro de mesa necesita red — reinténtalo cuando vuelva.",
        );
    } finally {
      setCobroBusyId(null);
    }
  }

  const renderRoomCard = (t: ApiTable) => {
    const principal = t.groupedIntoTableId
      ? (byId.get(t.groupedIntoTableId) ?? null)
      : null;
    const children = childrenByPrincipal.get(t.id) ?? [];
    return (
      <TableCard
        key={t.id}
        table={t}
        principal={principal}
        groupedChildren={children}
        offline={offline}
        pendingCheckout={blockedTableIds.has(t.id)}
        opening={props.pickBusyTableId === t.id}
        anyOpening={props.pickBusyTableId != null}
        cobroBusy={cobroBusyId === t.id}
        canCobrar={canCobrar}
        onPick={props.onPickTable}
        onCobrar={openCobro}
      />
    );
  };

  return (
    <div className="min-h-screen bg-mipiace-stone flex flex-col font-sans">
      <header className="bg-white border-b border-slate-200 px-5 md:px-7 py-3.5 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          {/* v1.9.2-mesas-concurrencia · Frente 3.3: menú de caja
              (Arqueo X, Cerrar turno, Sincronizar catálogo, Bloquear)
              accesible desde el mapa. */}
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            title="Abrir menú"
            aria-label="Abrir menú"
            className="h-10 w-10 shrink-0 rounded-xl hover:bg-slate-100 flex items-center justify-center text-slate-600"
          >
            <Menu className="w-5 h-5" strokeWidth={2.1} />
          </button>
          <Logo />
          <div className="hidden sm:block text-[12.5px] text-slate-500">
            {props.storeName} · {props.registerName}
          </div>
        </div>
        <div className="flex items-center gap-3">
          {offline && (
            <span className="hidden md:flex items-center gap-1.5 text-[12px] text-red-600">
              <WifiOff className="w-3.5 h-3.5" /> Sin conexión
            </span>
          )}
          {/* v1.9.2-mesas-concurrencia · Frente 3.3: "Tickets" en el
              header del mapa (mismo peso que en venta rápida). */}
          <button
            type="button"
            onClick={() => {
              setHistoryQuery(undefined);
              setShowHistory(true);
            }}
            title="Tickets pasados"
            className="h-9 px-3 rounded-lg bg-mipiace-stone hover:bg-slate-100 flex items-center gap-2 text-[12.5px] font-medium text-mipiace-ink"
          >
            <ReceiptText className="w-[17px] h-[17px]" strokeWidth={2.25} />
            <span className="hidden sm:inline">Tickets</span>
          </button>
          <button
            type="button"
            onClick={props.onLogoutCashier}
            className="h-9 px-3 rounded-lg bg-mipiace-stone hover:bg-slate-100 text-[12.5px] text-mipiace-ink max-w-[45vw] truncate"
          >
            {props.cashierLabel.split("@")[0]}
          </button>
        </div>
      </header>

      {/* v1.9.2-mesas-concurrencia · banner inline de expulsión / éxito.
          Autocierre 4 s, cerrable a mano. Nada de modales en el flujo. */}
      {notice && (
        <div
          className={`px-5 md:px-7 py-3 border-b flex items-start gap-3 ${
            notice.tone === "success"
              ? "bg-emerald-50 border-emerald-200 text-emerald-800"
              : "bg-amber-50 border-amber-200 text-amber-900"
          }`}
          role="status"
        >
          {notice.tone === "success" ? (
            <CheckCircle2 className="w-5 h-5 mt-0.5 shrink-0" />
          ) : (
            <WifiOff className="w-5 h-5 mt-0.5 shrink-0 opacity-0" />
          )}
          <div className="flex-1 text-[13.5px] font-medium leading-snug">
            {notice.text}
          </div>
          {notice.ticketQuery && (
            <button
              type="button"
              onClick={() => {
                setHistoryQuery(notice.ticketQuery ?? undefined);
                setShowHistory(true);
                setNotice(null);
              }}
              className="text-[12.5px] font-semibold underline underline-offset-2 shrink-0"
            >
              Ver ticket
            </button>
          )}
          <button
            type="button"
            onClick={() => setNotice(null)}
            aria-label="Cerrar aviso"
            className="h-6 w-6 shrink-0 rounded-md hover:bg-black/5 flex items-center justify-center"
          >
            <X className="w-4 h-4" strokeWidth={2.1} />
          </button>
        </div>
      )}

      <main className="flex-1 p-4 md:p-7 overflow-y-auto">
        {offline && (
          <div className="mb-5 flex items-start gap-3 rounded-2xl border border-red-300 bg-red-50 text-red-800 px-4 py-3">
            <WifiOff className="w-5 h-5 mt-0.5 shrink-0" />
            <div className="text-[13.5px] leading-snug">
              <div className="font-semibold">
                Sin conexión · operativa de mesas bloqueada
              </div>
              <div className="text-[12.5px] opacity-90 mt-0.5">
                No se pueden abrir, retomar ni cobrar mesas hasta que vuelva la
                red. La venta rápida sigue disponible.
              </div>
            </div>
          </div>
        )}

        {/* ── Cabecera de sala ─────────────────────────────────────── */}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3 mb-4">
          <h1 className="text-[22px] md:text-[24px] font-semibold text-mipiace-ink tracking-tight">
            Sala
          </h1>
          <div className="text-[13px] text-slate-500 tabular-nums">
            <span className="font-semibold text-mipiace-ink">{openCount}</span>{" "}
            abiertas ·{" "}
            <span className="font-semibold text-mipiace-ink">{freeCount}</span>{" "}
            libres ·{" "}
            <span className="font-semibold text-mipiace-ink">
              {formatEur(salaTotal)}
            </span>{" "}
            en sala
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <ZoneChips
              zoneFilter={zoneFilter}
              setZoneFilter={setZoneFilter}
              counts={counts}
            />
            <button
              type="button"
              onClick={props.onQuickSale}
              className="h-9 px-3.5 rounded-full bg-mipiace-coral hover:bg-mipiace-coral-dark text-white text-[13px] font-medium flex items-center gap-1.5 shrink-0"
            >
              <Plus className="w-4 h-4" strokeWidth={2.25} />
              Nueva venta rápida
            </button>
          </div>
        </div>

        {/* Leyenda */}
        <div className="flex flex-wrap items-center gap-4 mb-6 text-[12.5px] text-slate-500">
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-[4px] border border-slate-300 bg-white" />{" "}
            Libre
          </div>
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-[4px] bg-mipiace-coral-soft border border-mipiace-coral/45" />{" "}
            Ocupada
          </div>
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-[4px] bg-amber-100 border border-amber-500/50" />{" "}
            Pidiendo cuenta
          </div>
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-[4px] bg-white ring-2 ring-inset ring-amber-500" />{" "}
            +45 min sin atender
          </div>
        </div>

        {error && (
          <div className="mb-4 text-[13px] text-red-700 bg-red-50 rounded-xl px-3.5 py-2.5">
            {error}
          </div>
        )}
        {props.pickError && (
          <div className="mb-4 text-[13px] text-red-700 bg-red-50 rounded-xl px-3.5 py-2.5">
            {props.pickError}
          </div>
        )}

        {tables.length === 0 ? (
          <EmptyState />
        ) : zoneFilter !== "ALL" ? (
          // Filtro de una zona: un único marco a ancho completo.
          <div>
            {bar.length > 0 ? (
              <BarZone
                tables={bar}
                offline={offline}
                blockedTableIds={blockedTableIds}
                pickBusyTableId={props.pickBusyTableId ?? null}
                onPick={props.onPickTable}
              />
            ) : (
              (salon.length > 0 ||
                terraza.length > 0 ||
                reservado.length > 0) && (
                <ZoneFrame label={ZONE_LABEL[zoneFilter]}>
                  <RoomGrid>
                    {[...salon, ...terraza, ...reservado].map(renderRoomCard)}
                  </RoomGrid>
                </ZoneFrame>
              )
            )}
          </div>
        ) : (
          // Lienzo espacial: Salón dominante a la izquierda, Terraza /
          // Reservados apilados a la derecha, Barra a lo ancho abajo.
          // En handheld todo se apila (una columna).
          <div className="space-y-4 lg:space-y-0 lg:grid lg:grid-cols-[minmax(0,1fr)_300px] lg:gap-[18px]">
            {salon.length > 0 && (
              <ZoneFrame label="SALÓN" className="lg:col-start-1 lg:row-start-1">
                <RoomGrid>{salon.map(renderRoomCard)}</RoomGrid>
              </ZoneFrame>
            )}
            {(terraza.length > 0 || reservado.length > 0) && (
              <div className="space-y-4 lg:space-y-[18px] lg:col-start-2 lg:row-start-1">
                {terraza.length > 0 && (
                  <ZoneFrame label="TERRAZA">
                    <RoomGrid>{terraza.map(renderRoomCard)}</RoomGrid>
                  </ZoneFrame>
                )}
                {reservado.length > 0 && (
                  <ZoneFrame label="RESERVADOS">
                    <RoomGrid>{reservado.map(renderRoomCard)}</RoomGrid>
                  </ZoneFrame>
                )}
              </div>
            )}
            {bar.length > 0 && (
              <BarZone
                className="lg:col-span-2"
                tables={bar}
                offline={offline}
                blockedTableIds={blockedTableIds}
                pickBusyTableId={props.pickBusyTableId ?? null}
                onPick={props.onPickTable}
              />
            )}
          </div>
        )}
      </main>

      {/* v1.9.2-mesas-concurrencia · Frente 3.3: drawer de caja del mapa,
          espejo del de SalePage (Sincronizar catálogo, Arqueo X, Cerrar
          turno, Bloquear). */}
      <div
        className={`fixed inset-0 z-50 ${drawerOpen ? "pointer-events-auto" : "pointer-events-none"}`}
        aria-hidden={!drawerOpen}
      >
        <div
          onClick={() => setDrawerOpen(false)}
          className={`absolute inset-0 bg-mipiace-ink/30 transition-opacity ${
            drawerOpen ? "opacity-100" : "opacity-0"
          }`}
        />
        <aside
          className={`absolute inset-y-0 left-0 w-[280px] max-w-[85vw] bg-white shadow-2xl p-5 transition-transform ${
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
              onClick={async () => {
                if (syncState === "running") return;
                setSyncState("running");
                try {
                  await syncNow(async () => {
                    await refreshCatalog();
                  });
                  setSyncState("done");
                  setTimeout(() => setSyncState("idle"), 1500);
                } catch {
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
            {props.shiftId && props.cashierRole && (
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
            )}
            <button
              onClick={() => {
                setDrawerOpen(false);
                // Con turno/rol conocidos usamos el modal Z in situ; si
                // no llegaron (defensivo) caemos al callback del padre.
                if (props.shiftId && props.cashierRole) setShowCloseShift(true);
                else props.onCloseShift();
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
              title={`Bloquear (${props.cashierLabel})`}
              className="w-full h-12 flex items-center gap-3 px-4 rounded-xl text-slate-600 hover:bg-slate-50 text-[14.5px] font-medium"
            >
              <Lock
                className="w-[19px] h-[19px] text-slate-500 shrink-0"
                strokeWidth={2.1}
              />
              <span className="truncate">Bloquear ({props.cashierLabel})</span>
            </button>
          </nav>
        </aside>
      </div>

      {showHistory && (
        <TicketsHistoryPage
          onClose={() => setShowHistory(false)}
          onGoToMap={() => setShowHistory(false)}
          initialQuery={historyQuery}
        />
      )}
      {showCloseShift && props.shiftId && props.cashierRole && (
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
      {showArqueoX && props.shiftId && props.cashierRole && (
        <CloseShiftModal
          shiftId={props.shiftId}
          cashierRole={props.cashierRole}
          mode="X"
          onClose={() => setShowArqueoX(false)}
          onClosed={() => setShowArqueoX(false)}
        />
      )}

      {/* v1.9.3-mapa-visual · cobro directo desde la tarjeta BILLING.
          El modal de cobro ES el mismo que en SalePage (CheckoutOverlay),
          en modo mesa (tableTicketId/tableId) — mismo endpoint, misma
          idempotencia, cero cambios de flujo de dinero. */}
      {cobro && props.shiftId && props.registerId && (
        <Suspense
          fallback={
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-mipiace-ink/30">
              <Loader2 className="w-6 h-6 animate-spin text-white" />
            </div>
          }
        >
          <CheckoutOverlay
            shiftId={props.shiftId}
            registerId={props.registerId}
            lines={cobro.lines}
            totals={cobro.totals}
            contact={null}
            notes=""
            businessType={getCachedBusinessType()}
            tableTicketId={cobro.ticketId}
            tableId={cobro.table.id}
            creditSalesEnabled={getCachedCreditSalesEnabled()}
            onRefetchTable={async () => {
              const res = await apiWithCashier<{ ticket: ServerDraft }>(
                `/tickets/${cobro.ticketId}`,
              );
              const l = mapServerDraftLines(res.ticket.lines);
              setCobro((c) =>
                c ? { ...c, lines: l, totals: computeCart(l) } : c,
              );
            }}
            onTableClosedElsewhere={(text) => {
              setCobro(null);
              setNotice({ text, tone: "info" });
              void load();
            }}
            onTablePaidExit={({ notice: text, ticketQuery }) => {
              setCobro(null);
              setNotice({ text, tone: "success", ticketQuery });
              void load();
            }}
            onClose={() => setCobro(null)}
            onConfirmed={() => {
              setCobro(null);
              void load();
            }}
          />
        </Suspense>
      )}
    </div>
  );
}

function ZoneChips({
  zoneFilter,
  setZoneFilter,
  counts,
}: {
  zoneFilter: TableZone | "ALL";
  setZoneFilter: (z: TableZone | "ALL") => void;
  counts: Record<TableZone, number>;
}) {
  const items: Array<{ id: TableZone | "ALL"; label: string; count?: number }> =
    [
      { id: "ALL", label: ZONE_LABEL.ALL },
      { id: "SALON", label: ZONE_LABEL.SALON, count: counts.SALON },
      { id: "TERRAZA", label: ZONE_LABEL.TERRAZA, count: counts.TERRAZA },
      { id: "BARRA", label: ZONE_LABEL.BARRA, count: counts.BARRA },
      { id: "RESERVADO", label: ZONE_LABEL.RESERVADO, count: counts.RESERVADO },
    ];
  return (
    <div className="flex gap-2 overflow-x-auto lg:flex-wrap lg:overflow-x-visible">
      {items.map((item) => {
        if (item.id !== "ALL" && (item.count ?? 0) === 0) return null;
        const active = zoneFilter === item.id;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => setZoneFilter(item.id)}
            className={`h-9 px-3.5 shrink-0 rounded-full text-[13px] font-medium transition-colors flex items-center gap-1.5 ${
              active
                ? "bg-mipiace-coral-soft text-mipiace-coral-dark border border-mipiace-coral/40"
                : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-50"
            }`}
          >
            {item.label}
            {typeof item.count === "number" && (
              <span className="text-[11px] text-slate-400 font-medium">
                {item.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// Marco de zona: borde discontinuo con label flotante, tal cual el
// mockup (.zona + .zona>label).
function ZoneFrame({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      className={`relative rounded-[22px] border-[1.5px] border-dashed border-slate-300 p-[18px] bg-gradient-to-b from-white/50 to-transparent ${className ?? ""}`}
    >
      <span className="absolute -top-[9px] left-[22px] bg-mipiace-stone px-2 text-[11px] tracking-[0.12em] font-semibold text-slate-500">
        {label}
      </span>
      {children}
    </section>
  );
}

function RoomGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-3.5">{children}</div>;
}

function TableCard({
  table,
  principal,
  groupedChildren,
  offline,
  pendingCheckout,
  opening,
  anyOpening,
  cobroBusy,
  canCobrar,
  onPick,
  onCobrar,
}: {
  table: ApiTable;
  // Si la mesa está absorbida, `principal` es la mesa que la absorbió.
  principal: ApiTable | null;
  // Mesas absorbidas EN esta mesa (cuando es la principal de un grupo).
  groupedChildren: ApiTable[];
  offline: boolean;
  // v1.0-mesas-frontend: checkout en tránsito en este dispositivo —
  // la mesa queda bloqueada localmente hasta que el outbox confirme.
  pendingCheckout: boolean;
  opening: boolean;
  anyOpening: boolean;
  cobroBusy: boolean;
  canCobrar: boolean;
  onPick: (t: ApiTable) => void;
  onCobrar: (t: ApiTable) => void;
}) {
  const elapsed = useElapsedTime(table.activeTicket?.openedAt);
  const minutes = useElapsedMinutes(table.activeTicket?.openedAt);
  const absorbed = !!table.groupedIntoTableId;
  // v1.0-pilotos · Lote 1: sin conexión, la operativa de mesas se
  // bloquea ENTERA (abrir, retomar, mover, cobrar).
  const disabled = offline || pendingCheckout || anyOpening;

  // ── Mesa absorbida: atenuada, con puente hacia la principal y sin
  //    contenido. El click lleva a la principal. ──────────────────────
  if (absorbed) {
    return (
      <button
        type="button"
        onClick={() => onPick(principal ?? table)}
        disabled={disabled}
        title={
          principal ? `Unida a ${principal.name}` : "Mesa unida a un grupo"
        }
        className="relative rounded-[18px] border-2 border-mipiace-coral/45 bg-mipiace-coral-soft min-h-[118px] p-3.5 flex flex-col text-left opacity-55 disabled:cursor-not-allowed"
      >
        {/* puente visual hacia la principal (a su izquierda) */}
        <span className="absolute -left-[18px] top-1/2 w-[18px] h-[3px] bg-mipiace-coral/45" />
        <span className="text-[19px] font-bold tracking-tight text-mipiace-coral-dark">
          {table.name}
        </span>
        <span className="text-[10.5px] uppercase tracking-wider font-semibold text-slate-500 mt-1">
          — unida a {principal?.name ?? "grupo"}
        </span>
      </button>
    );
  }

  const isFree = table.state === "FREE";
  const isBilling = table.state === "BILLING";
  const olvidada =
    !isFree && minutes != null && minutes >= FORGOTTEN_TABLE_MINUTES;
  // Pax mostrado: la propia capacidad + la de las mesas absorbidas
  // (grupo fundido → pax sumados).
  const pax =
    table.capacity + groupedChildren.reduce((s, c) => s + c.capacity, 0);
  const groupBadge =
    groupedChildren.length > 0
      ? "+" + groupedChildren.map((c) => c.name).join(", ")
      : null;

  const stateClass = pendingCheckout
    ? "bg-slate-100 border-slate-300"
    : isFree
      ? "bg-white border-slate-200 hover:border-slate-300"
      : isBilling
        ? "bg-amber-100 border-amber-500/50"
        : "bg-mipiace-coral-soft border-mipiace-coral/45";
  const nameColor = pendingCheckout
    ? "text-slate-500"
    : isFree
      ? "text-mipiace-ink"
      : isBilling
        ? "text-amber-700"
        : "text-mipiace-coral-dark";
  const totalColor = isBilling ? "text-amber-700" : "text-mipiace-coral-dark";
  const alias =
    table.activeTicket?.openedByAlias ??
    table.activeTicket?.openedByEmail ??
    null;
  const showCobrar =
    isBilling && canCobrar && !offline && !pendingCheckout && !anyOpening;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => onPick(table)}
        disabled={disabled}
        title={
          offline
            ? "Sin conexión · operativa de mesas bloqueada"
            : pendingCheckout
              ? "Cobro pendiente de subir · mesa bloqueada en este dispositivo"
              : undefined
        }
        className={`relative w-full rounded-[18px] border-2 min-h-[118px] p-3.5 flex flex-col text-left transition-transform hover:scale-[1.015] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 ${stateClass} ${
          olvidada ? "ring-2 ring-inset ring-amber-500" : ""
        }`}
      >
        {/* nombre + badge de grupo/cuenta en línea */}
        <div className="pr-14">
          <span className={`text-[19px] font-bold tracking-tight ${nameColor}`}>
            {table.name}
          </span>
          {groupBadge && (
            <span className="ml-2 align-[2px] inline-flex items-center text-[9px] tracking-wider font-bold px-1.5 py-0.5 rounded-md bg-mipiace-coral/15 text-mipiace-coral-dark">
              {groupBadge}
            </span>
          )}
          {isBilling && (
            <span className="ml-2 align-[2px] inline-flex items-center text-[9px] tracking-wider font-bold px-1.5 py-0.5 rounded-md bg-amber-500/20 text-amber-700">
              CUENTA
            </span>
          )}
        </div>

        {/* pax arriba-dcha */}
        <span className="absolute top-2.5 right-3 text-[10px] uppercase tracking-wider font-semibold text-slate-500">
          {pax} PAX
        </span>
        {/* pendingCheckout badge bajo pax (compat v1.7) */}
        {pendingCheckout && (
          <span className="absolute top-[30px] right-3 text-[9px] font-semibold uppercase tracking-wider bg-slate-200 text-slate-700 px-1.5 py-0.5 rounded">
            cobro pendiente
          </span>
        )}
        {/* tiempo abierto bajo pax (ámbar si olvidada) */}
        {!isFree && !pendingCheckout && (
          <span
            className={`absolute top-[30px] right-3 text-[11px] font-semibold tabular-nums ${
              olvidada ? "text-amber-700" : "text-slate-500"
            }`}
          >
            {elapsed}
          </span>
        )}

        {/* pie: camarero (avatar+alias) + total */}
        {!isFree && table.activeTicket && (
          <div className="mt-auto flex items-end justify-between gap-2">
            {alias ? (
              <span className="flex items-center gap-1.5 text-[11.5px] text-slate-500 min-w-0">
                <span className="w-5 h-5 rounded-[7px] bg-mipiace-ink text-white text-[9.5px] font-bold inline-flex items-center justify-center shrink-0">
                  {avatarInitials(alias)}
                </span>
                <span className="truncate">{aliasName(alias)}</span>
              </span>
            ) : (
              <span />
            )}
            {/* En BILLING el total cede su sitio al botón Cobrar (overlay
                a la derecha); reservamos el hueco. */}
            {!showCobrar && (
              <span
                className={`text-[19px] font-bold tabular-nums tracking-tight ${totalColor}`}
              >
                {formatEur(Number(table.activeTicket.total))}
              </span>
            )}
          </div>
        )}

        {opening && (
          <span className="absolute inset-0 flex items-center justify-center bg-white/60 rounded-[18px]">
            <Loader2 className="w-5 h-5 animate-spin text-slate-500" />
          </span>
        )}
      </button>

      {/* Cobro directo (sólo BILLING). Botón separado —no anidado— sobre
          el pie de la tarjeta. */}
      {showCobrar && table.activeTicket && (
        <button
          type="button"
          onClick={() => onCobrar(table)}
          disabled={cobroBusy}
          className="absolute bottom-3 right-3 h-8 px-3 rounded-[10px] bg-amber-700 hover:bg-amber-800 text-white text-[13px] font-semibold tabular-nums inline-flex items-center gap-1.5 disabled:opacity-60"
        >
          {cobroBusy ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <>Cobrar {formatEur(Number(table.activeTicket.total))}</>
          )}
        </button>
      )}
    </div>
  );
}

// Zona BARRA: mostrador dibujado + taburetes circulares, ordenados por
// barSeatIndex (mockup .barrazona / .mostrador / .taburetes / .tab).
function BarZone({
  tables,
  offline,
  blockedTableIds,
  pickBusyTableId,
  onPick,
  className,
}: {
  tables: ApiTable[];
  offline: boolean;
  blockedTableIds: Set<string>;
  pickBusyTableId: string | null;
  onPick: (t: ApiTable) => void;
  className?: string;
}) {
  const sorted = tables
    .slice()
    .sort((a, b) => (a.barSeatIndex ?? 0) - (b.barSeatIndex ?? 0));
  return (
    <div
      className={`relative rounded-[22px] border-[1.5px] border-dashed border-slate-300 px-[22px] pt-4 pb-5 ${className ?? ""}`}
    >
      <span className="absolute -top-[9px] left-[22px] bg-mipiace-stone px-2 text-[11px] tracking-[0.12em] font-semibold text-slate-500">
        BARRA
      </span>
      {/* mostrador */}
      <div className="h-[26px] rounded-[10px] bg-gradient-to-b from-[#EADFCE] to-[#DFD0B8] border border-[#D5C4A8] mb-4" />
      <div className="flex flex-wrap gap-x-[22px] gap-y-4 pl-3.5">
        {sorted.map((t) => (
          <BarStool
            key={t.id}
            table={t}
            offline={offline}
            pendingCheckout={blockedTableIds.has(t.id)}
            anyOpening={pickBusyTableId !== null}
            onPick={onPick}
          />
        ))}
      </div>
    </div>
  );
}

function BarStool({
  table,
  offline,
  pendingCheckout,
  anyOpening,
  onPick,
}: {
  table: ApiTable;
  offline: boolean;
  pendingCheckout: boolean;
  anyOpening: boolean;
  onPick: (t: ApiTable) => void;
}) {
  const disabled = offline || pendingCheckout || anyOpening;
  const isFree = table.state === "FREE";
  const isBilling = table.state === "BILLING";
  const stateClass = pendingCheckout
    ? "bg-slate-100 border-slate-300"
    : isFree
      ? "bg-white border-slate-200 hover:border-slate-300"
      : isBilling
        ? "bg-amber-100 border-amber-500/50"
        : "bg-mipiace-coral-soft border-mipiace-coral/45";
  return (
    <button
      type="button"
      onClick={() => onPick(table)}
      disabled={disabled}
      title={
        offline
          ? "Sin conexión · operativa de mesas bloqueada"
          : pendingCheckout
            ? "Cobro pendiente de subir · mesa bloqueada en este dispositivo"
            : undefined
      }
      className={`w-[84px] h-[84px] rounded-full border-2 ${stateClass} flex flex-col items-center justify-center transition-transform hover:scale-[1.05] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100`}
    >
      <span
        className={`text-[15px] font-bold ${isFree ? "text-mipiace-ink" : isBilling ? "text-amber-700" : "text-mipiace-coral-dark"}`}
      >
        {table.name}
      </span>
      {table.activeTicket && (
        <span
          className={`text-[13px] font-bold tabular-nums ${isBilling ? "text-amber-700" : "text-mipiace-coral-dark"}`}
        >
          {formatEur(Number(table.activeTicket.total))}
        </span>
      )}
    </button>
  );
}

function EmptyState() {
  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-6 text-center text-[13.5px] text-slate-500">
      Esta tienda aún no tiene mesas. Pide al propietario que las configure
      desde el panel de admin.
    </div>
  );
}

function countByZone(tables: ApiTable[]): Record<TableZone, number> {
  const acc: Record<TableZone, number> = {
    SALON: 0,
    TERRAZA: 0,
    BARRA: 0,
    RESERVADO: 0,
  };
  for (const t of tables) acc[t.zone] += 1;
  return acc;
}

// Nombre corto del camarero para el pie de la tarjeta: alias tal cual
// (primer token si trae varios) o el local-part del email como fallback.
function aliasName(label: string): string {
  const local = label.includes("@") ? (label.split("@")[0] ?? label) : label;
  return local.trim();
}

// 2 iniciales del alias para el avatar (fallback email). "Matías Tapia"
// → "MT"; "Matías" → "MA"; "matias.oyola@…" → "MO".
function avatarInitials(label: string): string {
  const local = label.includes("@") ? (label.split("@")[0] ?? "") : label;
  const parts = local.trim().split(/[\s._-]+/).filter(Boolean);
  const a = parts[0];
  const b = parts[1];
  if (a && b) return (a[0]! + b[0]!).toUpperCase();
  return ((a ?? "").slice(0, 2) || "?").toUpperCase();
}
