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
// v1.23-las-mesas-miden-lo-mismo (2026-10-06): el tamaño de la tarjeta
// deja de depender de la zona. Lo de v1.9.3 daba cuatro tamaños al mismo
// objeto —508 × 118 en Salón, 124 × 118 en Terraza, 84 × 84 en Barra,
// medido en el AP13— porque el ancho lo fijaba el lienzo
// (`grid-cols-[minmax(0,1fr)_300px]`) y no las mesas. Ahora el tamaño
// sale de `lib/roomGrid.ts` y es uno solo; las zonas fluyen con
// `flex-wrap` y las columnas salen del ancho disponible. La Barra
// conserva el mostrador dibujado, pero sus sitios son la misma tarjeta.
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
import {
  ROOM_GRID_GAP,
  ROOM_HEADER_DARK,
  ROOM_SIDE_PADDING_DARK,
  ROOM_TOP_PADDING_DARK,
  TABLE_AMOUNT_FONT_PX_DARK,
  ZONE_GAP,
  TABLE_SHAPE_RADIUS,
  TABLE_SHAPE_SIZE,
  ZONE_PADDING,
  roundTableChordWidth,
} from "../lib/roomGrid.js";
import {
  BAR_COUNTER_FILL,
  CORAL,
  DARK_CANVAS,
  DARK_ON_CORAL,
  DARK_SURFACE,
  DARK_SURFACE_RAISED,
  DARK_TEXT,
  DARK_TEXT_MUTED,
  DARK_TEXT_SOFT,
  EYEBROW_PX,
  EYEBROW_TRACKING,
  MIN_TOUCH_PX,
  TABLE_BILLING_FILL,
  TABLE_BILLING_TEXT,
  TABLE_BUSY_FILL,
  TABLE_BUSY_TEXT,
  TABLE_FREE_FILL,
  TABLE_FREE_TEXT,
  TABLE_LATE_RING,
  TABLE_LATE_RING_WIDTH,
  TABLE_NAME_PX,
} from "../lib/hospitalityTheme.js";
import { syncNow } from "../lib/syncNow.js";
import { CloseShiftModal } from "./CloseShiftModal.js";
import { summarizeOpenTables } from "../lib/openTables.js";
import { VERDE_LISTA } from "../lib/kitchenTheme.js";
import { TicketsHistoryPage } from "./TicketsHistoryPage.js";
import { formatEur } from "../lib/money.js";
import type { CashierRole } from "../lib/offlineAuth.js";

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

// v1.23-las-mesas-miden-lo-mismo · orden de las zonas en el lienzo. El
// camarero lee la sala siempre en el mismo orden, esté filtrando o no.
//
// v2-H1-venta-y-sala · decisión 8 · **la Barra es la primera.**
//
// Iba la última desde v1.9.3 y eso era un residuo de cuando sus sitios
// eran taburetes de 84 px: la zona de más rotación del bar, la que se
// atiende de pie y sin sentarse, estaba al final de la lectura y en el
// AP13 empezaba fuera de pantalla (hallazgo E1 de la auditoría del
// 2026-09-02). En un bar la barra es lo primero que se mira porque es lo
// que más veces se cobra en un turno.
const ZONE_ORDER: TableZone[] = ["BARRA", "SALON", "TERRAZA", "RESERVADO"];

const ZONE_LABEL: Record<TableZone | "ALL", string> = {
  ALL: "Todas",
  SALON: "Salón",
  TERRAZA: "Terraza",
  BARRA: "Barra",
  RESERVADO: "Reservados",
};

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
  // clinica-1 · el tipo compartido (ver la nota de CloseShiftModal).
  cashierRole?: CashierRole;
  // v1.9.2-mesas-concurrencia · banner de expulsión / éxito. El padre
  // (App) lo setea al navegar de vuelta al mapa por un evento remoto.
  notice?: MapNotice | null;
  // v1.0-mesas-frontend: el padre abre la mesa server-side ANTES de
  // entrar a SalePage. Mientras el POST está en vuelo, la mesa tocada
  // queda con spinner; si falla, el error se pinta en el banner.
  pickBusyTableId?: string | null;
  pickError?: string | null;
  /**
   * kds-1-cocina (decisión 5) · las mesas con algo LISTO en el pase.
   *
   * La etiqueta verde «LISTO» de la mesa. **Verde y no coral**: el coral ya
   * significa «ocupada» y «Cobrar», y un tercer significado para el mismo
   * color convierte el color en ruido. El verde es el de «Lista» de la
   * pantalla de cocina, que es de donde viene el aviso.
   *
   * Lo pasa el padre (`TpvHome`) desde `useAvisosListo`, que es de la
   * TIENDA: la misma lista que alimenta la banda de arriba en todos los
   * TPV. Un toque en la etiqueta marca «Servido», igual que la banda.
   */
  mesasListas?: Set<string>;
  onServido?: (orderId: string) => void;
  /** `tableId → orderId` de la comanda más antigua lista de esa mesa. */
  comandaListaPorMesa?: Map<string, string>;
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
  //
  // v1.22 §5 · la regla se ha mudado a `lib/openTables.ts` porque ahora
  // la usan también el cierre del día y la apertura de turno (hallazgo
  // B2). Si viviera en dos sitios, el aviso del cierre podría decir un
  // número y esta cabecera otro.
  const openSummary = summarizeOpenTables(tables);
  const openCount = openSummary.count;
  // v2-H1 · ya no se pinta («N abiertas · X €», decisión 8) pero el
  // cálculo se queda: sale de `summarizeOpenTables`, que es el módulo
  // que v1.22 comparte con el aviso de mesas abiertas del cierre, y el
  // prompt dice explícitamente que ese cálculo no se toca. Si mañana la
  // cabecera vuelve a querer el dato, está aquí y dice lo mismo que el
  // cierre.
  void (tables.length - openCount);
  const salaTotal = openSummary.total;

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
        lista={props.mesasListas?.has(t.id) === true}
        onServido={() => {
          const orderId = props.comandaListaPorMesa?.get(t.id);
          if (orderId && props.onServido) props.onServido(orderId);
        }}
        onPick={props.onPickTable}
        onCobrar={openCobro}
      />
    );
  };

  return (
    <div
      data-testid="room-screen"
      data-theme="dark"
      className="min-h-screen flex flex-col font-sans"
      style={{ background: DARK_CANVAS, color: DARK_TEXT }}
    >
      {/* ── Cabecera ──────────────────────────────────────────────────
          UNA fila de 80 px con todo: identidad, el contador de sala, los
          filtros de zona y «Venta rápida». La cabecera clara repartía lo
          mismo en TRES bloques —barra de app, fila «Sala · N abiertas…»
          y leyenda— que sumaban 212 px antes de la primera mesa. Esos
          108 px recuperados son los que permiten que la mesa crezca de
          19.824 a 20.736 px² sin que la sala empiece a desplazar.

          El menú, Tickets y el cajero siguen a un toque, a la izquierda,
          como hasta ahora. */}
      <header
        className="shrink-0 flex items-center gap-4 px-5 border-b"
        style={{ height: ROOM_HEADER_DARK, borderColor: DARK_SURFACE_RAISED }}
      >
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          title="Abrir menú"
          aria-label="Abrir menú"
          className="shrink-0 rounded-[14px] flex items-center justify-center"
          style={{
            width: MIN_TOUCH_PX,
            height: MIN_TOUCH_PX,
            background: DARK_SURFACE,
            color: DARK_TEXT_SOFT,
          }}
        >
          <Menu className="w-5 h-5" strokeWidth={2.1} />
        </button>
        <div className="min-w-0">
          <div
            className="font-semibold leading-tight"
            style={{ fontSize: 28, letterSpacing: "-0.015em" }}
          >
            Sala
          </div>
          {/* «N abiertas · X €», tal cual lo pide la decisión 8.
              El «M libres» de la cabecera clara se va: con la mesa libre
              siendo ahora lo MÁS claro del lienzo, contarlas es repetir
              con un número lo que la sala ya dice de un vistazo. El
              cálculo no se toca —sigue siendo `summarizeOpenTables`, que
              comparte con el aviso del cierre de v1.22— y `freeCount`
              sigue saliendo de él, sólo que ya no se pinta aquí. */}
          <div
            data-testid="room-counter"
            className="tabular-nums truncate"
            style={{ fontSize: 17, color: DARK_TEXT_MUTED }}
          >
            {/* «1 abierta», no «1 abiertas». Lo cazó el bucle visual en
                la sala de Sirope, que tenía una sola mesa ocupada. */}
            {openCount} {openCount === 1 ? "abierta" : "abiertas"} ·{" "}
            {formatEur(salaTotal)}
          </div>
        </div>
        {offline && (
          <span
            className="hidden md:flex items-center gap-1.5 shrink-0"
            style={{ fontSize: 14, color: "#F2A08F" }}
          >
            <WifiOff className="w-4 h-4" /> Sin conexión
          </span>
        )}
        <div className="flex-grow" />
        <ZoneChips
          zoneFilter={zoneFilter}
          setZoneFilter={setZoneFilter}
          counts={counts}
        />
        <button
          type="button"
          onClick={() => {
            setHistoryQuery(undefined);
            setShowHistory(true);
          }}
          title="Tickets pasados"
          aria-label="Tickets pasados"
          className="shrink-0 rounded-[14px] flex items-center justify-center"
          style={{
            width: MIN_TOUCH_PX,
            height: MIN_TOUCH_PX,
            background: DARK_SURFACE,
            color: DARK_TEXT_SOFT,
          }}
        >
          <ReceiptText className="w-[19px] h-[19px]" strokeWidth={2.25} />
        </button>
        <button
          type="button"
          onClick={props.onLogoutCashier}
          title={`Bloquear (${props.cashierLabel})`}
          className="shrink-0 rounded-[14px] px-4 max-w-[20vw] truncate"
          style={{
            height: MIN_TOUCH_PX,
            background: DARK_SURFACE,
            color: DARK_TEXT_SOFT,
            fontSize: 15,
          }}
        >
          {props.cashierLabel.split("@")[0]}
        </button>
        <button
          type="button"
          onClick={props.onQuickSale}
          className="shrink-0 rounded-2xl px-5 font-semibold"
          style={{
            height: MIN_TOUCH_PX,
            background: CORAL,
            color: DARK_ON_CORAL,
            fontSize: 19,
          }}
        >
          Venta rápida
        </button>
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

      <main
        className="flex-1 flex flex-col overflow-y-auto"
        style={{
          paddingLeft: ROOM_SIDE_PADDING_DARK,
          paddingRight: ROOM_SIDE_PADDING_DARK,
          paddingTop: ROOM_TOP_PADDING_DARK,
          paddingBottom: ROOM_SIDE_PADDING_DARK,
        }}
      >
        {offline && (
          <DarkRoomNotice tone="red" testid="room-offline">
            <span className="font-semibold">
              Sin conexión · operativa de mesas bloqueada
            </span>
            <br />
            No se pueden abrir, retomar ni cobrar mesas hasta que vuelva la red.
            La venta rápida sigue disponible.
          </DarkRoomNotice>
        )}
        {error && <DarkRoomNotice tone="red">{error}</DarkRoomNotice>}
        {props.pickError && (
          <DarkRoomNotice tone="red">{props.pickError}</DarkRoomNotice>
        )}

        {tables.length === 0 ? (
          <EmptyState />
        ) : (
          // v1.23-las-mesas-miden-lo-mismo · UN solo lienzo, el mismo
          // para la vista «Todas» y para la filtrada por zona (antes la
          // filtrada metía Salón, Terraza y Reservados en un único marco
          // de dos columnas: el mismo problema con otra forma).
          //
          // Las zonas son cajas que miden lo que piden sus mesas y el
          // `flex-wrap` las va colocando: la que no cabe en la línea en
          // curso baja a la siguiente. Se acabó el
          // `lg:grid-cols-[minmax(0,1fr)_300px]`, que daba a Salón todo
          // el ancho sobrante y encerraba Terraza y Reservados en 300 px
          // fijos.
          //
          // Por debajo de `sm` (handheld) las zonas se apilan y las
          // mesas van a una columna, como hasta ahora.
          <div
            data-testid="room-canvas"
            className="flex flex-col sm:flex-row sm:flex-wrap sm:items-start"
            style={{ gap: ZONE_GAP }}
          >
            {ZONE_ORDER.map((zone) => {
              const zoneTables = visible.filter((t) => t.zone === zone);
              if (zoneTables.length === 0) return null;
              if (zone === "BARRA") {
                return (
                  <BarZone
                    key={zone}
                    tables={zoneTables}
                    renderCard={renderRoomCard}
                  />
                );
              }
              return (
                <ZoneFrame key={zone} label={ZONE_LABEL[zone].toUpperCase()}>
                  <RoomGrid>{zoneTables.map(renderRoomCard)}</RoomGrid>
                </ZoneFrame>
              );
            })}
          </div>
        )}

        {/* ── Leyenda, al PIE ───────────────────────────────────────────
            Sube del medio de la pantalla al pie por una razón de
            reparto: intercalada entre la cabecera y la primera mesa
            costaba 43 px de los que el lienzo necesita, y lo que explica
            no se consulta cada vez — se aprende una vez y se olvida.
            Abajo sigue estando para quien la necesite el primer día. */}
        <div
          data-testid="room-legend"
          className="mt-auto pt-5 flex flex-wrap items-center gap-x-6 gap-y-2"
          style={{ fontSize: 15, color: DARK_TEXT_MUTED }}
        >
          <LegendDot fill={TABLE_FREE_FILL} label="Libre" />
          <LegendDot fill={TABLE_BUSY_FILL} label="Ocupada" />
          <LegendDot fill={TABLE_BILLING_FILL} label="Pide la cuenta" />
          <LegendDot
            fill={TABLE_BUSY_FILL}
            ring={TABLE_LATE_RING}
            label="+45 min sin atender"
          />
        </div>
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
              className="h-touch w-touch rounded-xl hover:bg-slate-100 flex items-center justify-center text-slate-500"
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
          en modo mesa (draftTicketId/tableId) — mismo endpoint, misma
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
            draftTicketId={cobro.ticketId}
            draftLabel="Mesa"
            tableId={cobro.table.id}
            creditSalesEnabled={getCachedCreditSalesEnabled()}
            onRefetchDraft={async () => {
              const res = await apiWithCashier<{ ticket: ServerDraft }>(
                `/tickets/${cobro.ticketId}`,
              );
              const l = mapServerDraftLines(res.ticket.lines);
              setCobro((c) =>
                c ? { ...c, lines: l, totals: computeCart(l) } : c,
              );
            }}
            onDraftClosedElsewhere={(text) => {
              setCobro(null);
              setNotice({ text, tone: "info" });
              void load();
            }}
            onDraftPaidExit={({ internalNumber, ticketQuery }) => {
              setCobro(null);
              // B-reservas-5 F2 · el aviso lo redacta quien sabe qué se
              // cobró. Aquí siempre es una mesa.
              setNotice({
                text: internalNumber
                  ? `Mesa cobrada · Ticket ${internalNumber}`
                  : "Mesa cobrada",
                tone: "success",
                ticketQuery,
              });
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
  // El orden de los chips sigue a `ZONE_ORDER`: Barra primero, como el
  // lienzo. Con un orden aquí y otro abajo, el camarero aprendería dos.
  const items: Array<{ id: TableZone | "ALL"; label: string; count?: number }> =
    [
      { id: "ALL", label: ZONE_LABEL.ALL },
      ...ZONE_ORDER.map((z) => ({
        id: z,
        label: ZONE_LABEL[z],
        count: counts[z],
      })),
    ];
  return (
    <div className="flex gap-2 shrink-0">
      {items.map((item) => {
        if (item.id !== "ALL" && (item.count ?? 0) === 0) return null;
        const active = zoneFilter === item.id;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => setZoneFilter(item.id)}
            aria-pressed={active}
            data-testid="zone-chip"
            data-zone={item.id}
            className="rounded-[14px] px-5 shrink-0 font-medium"
            style={{
              height: 52,
              fontSize: 18,
              fontWeight: active ? 600 : 500,
              background: active ? DARK_TEXT : DARK_SURFACE,
              color: active ? DARK_CANVAS : DARK_TEXT_SOFT,
            }}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Marco de zona: rótulo flotante y borde discontinuo, como v1.9.3, en
 * oscuro. La zona mide lo que piden sus mesas (v1.23): no se estira.
 */
function ZoneFrame({
  label,
  children,
  extraTop,
}: {
  label: string;
  children: ReactNode;
  /** El mostrador dibujado de la Barra. */
  extraTop?: ReactNode;
}) {
  return (
    <section
      data-testid="zone-frame"
      data-zone-label={label}
      className="relative rounded-[22px] border-[1.5px] border-dashed"
      style={{ padding: ZONE_PADDING, borderColor: DARK_SURFACE_RAISED }}
    >
      <span
        className="absolute -top-[9px] left-[22px] px-2 font-medium"
        style={{
          background: DARK_CANVAS,
          color: DARK_TEXT_MUTED,
          fontSize: EYEBROW_PX,
          letterSpacing: EYEBROW_TRACKING,
        }}
      >
        {label}
      </span>
      {extraTop}
      {children}
    </section>
  );
}

/**
 * La rejilla de una zona. Sigue siendo la de v1.23: `flex-wrap` con
 * mesas de tamaño fijo, de modo que **el número de columnas sale del
 * ancho** y no de un `grid-cols-N` escrito a mano. Lo único que cambia
 * es que la mesa es cuadrada.
 */
function RoomGrid({ children }: { children: ReactNode }) {
  return (
    <div
      data-testid="room-grid"
      className="flex flex-wrap"
      style={{ gap: ROOM_GRID_GAP }}
    >
      {children}
    </div>
  );
}

/**
 * Una mesa.
 *
 * v2-H1 · **una sola caja para toda mesa** (`TABLE_SHAPE_SIZE`), y lo
 * único que cambia por zona es el radio: círculo en Barra y Terraza,
 * rectángulo de esquina blanda en Salón y Reservados. El razonamiento
 * —por qué la maqueta pinta tres tamaños y aquí hay uno— está en
 * `roomGrid.ts`, junto a la constante.
 *
 * Libre = relleno claro, que es LO MÁS claro del lienzo: en un bar lo
 * que se busca de un vistazo es dónde sentar a cuatro. Ocupada = coral
 * con el importe grande y los minutos. Cuenta = ámbar. +45 min = el aro.
 */
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
  lista,
  onServido,
  onPick,
  onCobrar,
}: {
  table: ApiTable;
  principal: ApiTable | null;
  groupedChildren: ApiTable[];
  offline: boolean;
  pendingCheckout: boolean;
  opening: boolean;
  anyOpening: boolean;
  cobroBusy: boolean;
  canCobrar: boolean;
  /** kds-1-cocina (decisión 5) · hay algo de esta mesa listo en el pase. */
  lista: boolean;
  onServido: () => void;
  onPick: (t: ApiTable) => void;
  onCobrar: (t: ApiTable) => void;
}) {
  const elapsed = useElapsedTime(table.activeTicket?.openedAt);
  const minutes = useElapsedMinutes(table.activeTicket?.openedAt);
  const absorbed = !!table.groupedIntoTableId;
  const disabled = offline || pendingCheckout || anyOpening;
  const radius = TABLE_SHAPE_RADIUS[table.zone];
  const box = {
    width: TABLE_SHAPE_SIZE,
    height: TABLE_SHAPE_SIZE,
    borderRadius: radius,
  };

  // ── Mesa absorbida: atenuada, con puente hacia la principal. ───────
  if (absorbed) {
    return (
      <button
        type="button"
        onClick={() => onPick(principal ?? table)}
        disabled={disabled}
        data-testid="table-shape"
        data-zone={table.zone}
        data-state="grouped"
        title={principal ? `Unida a ${principal.name}` : "Mesa unida a un grupo"}
        className="relative box-border flex flex-col items-center justify-center gap-1 opacity-55 disabled:cursor-not-allowed"
        style={{ ...box, background: TABLE_BUSY_FILL, color: TABLE_BUSY_TEXT }}
      >
        <span
          className="absolute -left-[14px] top-1/2 w-[14px] h-[3px]"
          style={{ background: TABLE_BUSY_FILL }}
        />
        <span className="font-semibold" style={{ fontSize: TABLE_NAME_PX }}>
          {table.name}
        </span>
        <span className="font-medium" style={{ fontSize: 14, opacity: 0.9 }}>
          unida a {principal?.name ?? "grupo"}
        </span>
      </button>
    );
  }

  const isFree = table.state === "FREE";
  const isBilling = table.state === "BILLING";
  const olvidada =
    !isFree && minutes != null && minutes >= FORGOTTEN_TABLE_MINUTES;
  const pax =
    table.capacity + groupedChildren.reduce((s, c) => s + c.capacity, 0);
  const groupBadge =
    groupedChildren.length > 0
      ? "+" + groupedChildren.map((c) => c.name).join(", ")
      : null;

  const fill = pendingCheckout
    ? DARK_SURFACE_RAISED
    : isFree
      ? TABLE_FREE_FILL
      : isBilling
        ? TABLE_BILLING_FILL
        : TABLE_BUSY_FILL;
  const text = pendingCheckout
    ? DARK_TEXT_MUTED
    : isFree
      ? TABLE_FREE_TEXT
      : isBilling
        ? TABLE_BILLING_TEXT
        : TABLE_BUSY_TEXT;

  const alias =
    table.activeTicket?.openedByAlias ??
    table.activeTicket?.openedByEmail ??
    null;
  const showCobrar =
    isBilling && canCobrar && !offline && !pendingCheckout && !anyOpening;

  return (
    <div className="relative" style={{ ...box }}>
      {/* kds-1-cocina · decisión 5 · la etiqueta «LISTO» VERDE.
          Encima de la forma, arriba a la izquierda, y un toque marca
          «Servido» sin entrar en la mesa: lo que el camarero hace al pasar
          por delante es coger el plato, no abrir la cuenta.

          Verde y no coral porque el coral ya dice «ocupada» y «Cobrar», y
          un tercer significado para el mismo color convierte el color en
          ruido. */}
      {lista && (
        <button
          type="button"
          data-testid="table-listo"
          onClick={(e) => {
            // Que no se propague al botón de la mesa: tocar la etiqueta es
            // «Servido», no «abrir la mesa».
            e.stopPropagation();
            onServido();
          }}
          className="absolute z-10 rounded-[10px] px-2.5 font-bold"
          style={{
            top: -8,
            left: 6,
            height: 30,
            background: VERDE_LISTA,
            color: "#FFFFFF",
            fontSize: 15,
          }}
        >
          LISTO
        </button>
      )}
      <button
        type="button"
        onClick={() => onPick(table)}
        disabled={disabled}
        data-testid="table-shape"
        data-zone={table.zone}
        data-state={
          pendingCheckout
            ? "pending"
            : isFree
              ? "free"
              : isBilling
                ? "billing"
                : "busy"
        }
        data-late={olvidada ? "true" : "false"}
        data-lista={lista ? "true" : "false"}
        // v2-H1 · el alias del camarero sale de la FORMA y se queda en
        // el `title`.
        //
        // Es una pérdida respecto a v1.23 y se dice en voz alta: ahí la
        // tarjeta de 168 × 118 enseñaba nombre, PAX, minutos, cajero e
        // importe. En una forma de 144 px caben tres líneas —nombre a
        // 28, importe a 22 y la meta a 15— y la decisión 8 pide
        // exactamente esas tres («ocupada = relleno coral con importe
        // grande y minutos»). Una cuarta línea obligaba a bajar el
        // importe de 22 px, que es el dato que se comprueba.
        //
        // El cajero sigue a un toque: la cabecera de la comanda lo pinta
        // («Salón · 2 comensales · Gemma») en cuanto se entra en la mesa.
        title={
          offline
            ? "Sin conexión · operativa de mesas bloqueada"
            : pendingCheckout
              ? "Cobro pendiente de subir · mesa bloqueada en este dispositivo"
              : alias
                ? `${table.name} · abierta hace ${elapsed} por ${aliasName(alias)}`
                : undefined
        }
        className="relative w-full h-full box-border flex flex-col items-center justify-center gap-0.5 text-center disabled:opacity-50 disabled:cursor-not-allowed"
        style={{
          ...box,
          background: fill,
          color: text,
          // El aro de «+45 min sin atender». Va por `box-shadow` y no por
          // `ring` de Tailwind para que siga el radio de la forma: en un
          // círculo, un aro cuadrado sería un marco alrededor de la mesa.
          boxShadow: olvidada
            ? `0 0 0 ${TABLE_LATE_RING_WIDTH}px ${TABLE_LATE_RING}`
            : undefined,
        }}
      >
        <span
          data-testid="table-name"
          className="font-semibold leading-none"
          style={{ fontSize: TABLE_NAME_PX, letterSpacing: "-0.015em" }}
        >
          {table.name}
        </span>
        {isFree ? (
          <span
            className="font-medium"
            style={{ fontSize: 14, opacity: 0.65 }}
          >
            {pax} pax
          </span>
        ) : (
          table.activeTicket && (
            <>
              {/* El importe NUNCA se recorta: va en su propia línea, sin
                  encogerse y sin compartir fila con nada. Es la lección
                  de v1.22, donde `shrink-0` sin fila propia no recortaba
                  sino que desbordaba y el € acabó fuera de la tarjeta.
                  Que entre en el círculo lo comprueba
                  `roundTableAmountFits` con la cuerda, no con el lado. */}
              {!showCobrar && (
                <span
                  data-testid="table-card-amount"
                  className="font-semibold tabular-nums whitespace-nowrap"
                  style={{ fontSize: TABLE_AMOUNT_FONT_PX_DARK }}
                >
                  {formatEur(Number(table.activeTicket.total))}
                </span>
              )}
              {/* La meta cede su sitio al botón «Cobrar X €» cuando lo
                  hay: el botón ya dice qué pasa con esta mesa, y en una
                  forma de 144 px las dos cosas se pisan (medido en el
                  bucle visual, T2 de La Maestranza). */}
              {!showCobrar && (
                <span
                  title={`Abierta hace ${elapsed}`}
                  className="font-medium truncate max-w-full px-2"
                  style={{ fontSize: 15, opacity: 0.85 }}
                >
                  {isBilling ? "cuenta" : elapsed}
                </span>
              )}
            </>
          )
        )}
        {groupBadge && (
          <span
            className="absolute top-1.5 inset-x-0 font-bold truncate px-2"
            style={{ fontSize: 10, letterSpacing: "0.06em", opacity: 0.8 }}
          >
            {groupBadge}
          </span>
        )}
        {pendingCheckout && (
          <span
            className="absolute bottom-2 inset-x-0 font-semibold uppercase"
            style={{ fontSize: 10, letterSpacing: "0.08em" }}
          >
            cobro pendiente
          </span>
        )}
        {opening && (
          <span
            className="absolute inset-0 flex items-center justify-center"
            style={{ background: "rgba(14,16,19,0.45)", borderRadius: radius }}
          >
            <Loader2 className="w-5 h-5 animate-spin" style={{ color: DARK_TEXT }} />
          </span>
        )}
      </button>

      {/* Cobro directo (sólo BILLING). Botón separado —no anidado—. */}
      {showCobrar && table.activeTicket && (
        <button
          type="button"
          onClick={() => onCobrar(table)}
          disabled={cobroBusy}
          data-testid="table-cobrar"
          className="absolute rounded-xl font-semibold tabular-nums inline-flex items-center justify-center gap-1.5 disabled:opacity-60 whitespace-nowrap"
          style={{
            // El botón se centra y se acota al ancho REAL de la forma a
            // su altura. En una mesa redonda ese ancho no es el lado: es
            // la cuerda, y con `inset-x-2` el botón salía por los dos
            // lados del círculo colgando como una etiqueta (medido en el
            // bucle visual, T2 de La Maestranza a 1443 × 812).
            left: "50%",
            transform: "translateX(-50%)",
            bottom: COBRAR_BOTTOM,
            maxWidth: cobrarMaxWidth(table.zone),
            paddingLeft: 10,
            paddingRight: 10,
            height: COBRAR_HEIGHT,
            fontSize: 15,
            background: TABLE_BILLING_TEXT,
            color: TABLE_BILLING_FILL,
          }}
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

/** Alto del botón «Cobrar X €» de una mesa en BILLING. */
const COBRAR_HEIGHT = 36;

/** A qué altura del borde inferior se ancla. */
const COBRAR_BOTTOM = 18;

/**
 * Ancho máximo del botón «Cobrar» dentro de la forma.
 *
 * En Salón y Reservados es el lado menos un margen. En Barra y Terraza
 * —que son círculos— es la CUERDA a la altura del centro del botón: un
 * círculo de 144 px mide 144 en su eje pero mucho menos a 36 px del
 * borde, y ahí es donde el botón se apoya.
 */
function cobrarMaxWidth(zone: TableZone): number {
  if (TABLE_SHAPE_RADIUS[zone] < TABLE_SHAPE_SIZE / 2) {
    return TABLE_SHAPE_SIZE - 16;
  }
  const centroDelBoton = COBRAR_BOTTOM + COBRAR_HEIGHT / 2;
  const offset = TABLE_SHAPE_SIZE / 2 - centroDelBoton;
  return Math.floor(roundTableChordWidth(offset) - 8);
}

/**
 * Zona BARRA: el mostrador dibujado y, encima, los taburetes ordenados
 * por `barSeatIndex`.
 *
 * El mostrador es lo que da identidad a la zona —v1.23 ya lo conservaba
 * al quitarle a los taburetes su tamaño propio—, y ahora además los
 * sitios vuelven a ser redondos, que es lo que son: taburetes. Lo que NO
 * vuelve es que midan menos que una mesa.
 */
function BarZone({
  tables,
  renderCard,
}: {
  tables: ApiTable[];
  renderCard: (t: ApiTable) => ReactNode;
}) {
  const sorted = tables
    .slice()
    .sort((a, b) => (a.barSeatIndex ?? 0) - (b.barSeatIndex ?? 0));
  return (
    <ZoneFrame
      label={ZONE_LABEL.BARRA.toUpperCase()}
      extraTop={
        <div
          data-testid="bar-counter"
          className="rounded-[11px] mb-4"
          style={{ height: 22, background: BAR_COUNTER_FILL }}
        />
      }
    >
      <RoomGrid>{sorted.map(renderCard)}</RoomGrid>
    </ZoneFrame>
  );
}

/** Un punto de la leyenda. */
function LegendDot({
  fill,
  ring,
  label,
}: {
  fill: string;
  ring?: string;
  label: string;
}) {
  return (
    <span className="flex items-center gap-2">
      <span
        className="w-3.5 h-3.5 rounded-[4px] shrink-0"
        style={{
          background: fill,
          boxShadow: ring ? `0 0 0 3px ${ring}` : undefined,
        }}
      />
      {label}
    </span>
  );
}

/** Un aviso de la sala oscura. Mismo criterio que el de la comanda. */
function DarkRoomNotice({
  tone,
  testid,
  children,
}: {
  tone: "amber" | "red";
  testid?: string;
  children: ReactNode;
}) {
  const fill = tone === "red" ? "rgba(233,112,88,0.14)" : "rgba(226,178,58,0.14)";
  const color = tone === "red" ? "#F2A08F" : TABLE_BILLING_FILL;
  return (
    <div
      role="status"
      data-testid={testid}
      className="mb-4 rounded-2xl px-4 py-3 shrink-0"
      style={{ background: fill, color, fontSize: 14.5 }}
    >
      {children}
    </div>
  );
}

function EmptyState() {
  return (
    <div
      className="rounded-2xl p-6 text-center"
      style={{
        background: DARK_SURFACE,
        color: DARK_TEXT_MUTED,
        fontSize: 15,
      }}
    >
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

// v2-H1 · aquí vivía `avatarInitials`, las dos letras del alias para el
// avatar cuadrado del pie de la tarjeta. Se va con el avatar: en una
// forma de 144 px el cajero se queda en el `title` (ver la nota de
// `TableCard`), y un avatar de 20 px con dos letras dentro de un círculo
// de mesa competía con el importe sin decir nada que no estuviera a un
// toque. `aliasName` sigue, porque el `title` lo usa.
