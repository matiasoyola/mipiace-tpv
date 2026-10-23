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
import { avisarAjustesCambiados } from "../hooks/useDeviceBootstrap.js";
import { useStoreEventStream } from "../hooks/useStoreEventStream.js";
import {
  getCachedBusinessType,
  getCachedCreditSalesEnabled,
  refreshCatalog,
} from "../lib/catalog.js";
import { ConfirmSheet } from "../components/ConfirmSheet.js";
import { computeCart } from "../lib/cart.js";
import { totalAparcadoEnVentaRapida } from "../lib/mostrador.js";
import { loadPersistedCartLines } from "../lib/persistedCart.js";
import type { CartLine, CartTotals } from "../lib/cart.js";
import { mapServerDraftLines } from "../lib/tableDraft.js";
import type { ServerDraft } from "../lib/tableDraft.js";
import { outboxBlockedTableIds, subscribeOutbox } from "../lib/outbox.js";
import {
  CABECERA_DE_ZONA_PX,
  ROOM_GRID_GAP,
  repartoDeSala,
  SUELO_LETRA_MANO_PX,
  ZONE_GAP,
  TABLE_SHAPE_RADIUS,
  TABLE_SHAPE_SIZE,
  tamanoDeMesaPara,
  type RoomZone,
  roundTableChordWidth,
} from "../lib/roomGrid.js";
import { useAparatoDeMano } from "../hooks/useAparatoDeMano.js";
import {
  BAR_COUNTER_FILL,
  CORAL,
  DARK_CANVAS,
  DARK_INK,
  DARK_ON_CORAL,
  DARK_SURFACE,
  DARK_SURFACE_RAISED,
  DARK_TEXT,
  DARK_TEXT_MUTED,
  DARK_TEXT_SOFT,
  EYEBROW_PX,
  EYEBROW_TRACKING,
  MIN_TOUCH_PX,
  PRESS_FEEDBACK_CLASS,
  TABLE_BILLING_FILL,
  TABLE_BILLING_TEXT,
  TABLE_BUSY_FILL,
  TABLE_BUSY_TEXT,
  TABLE_FREE_FILL,
  TABLE_POR_RECOGER_FILL,
  TABLE_POR_RECOGER_TEXT,
  TABLE_FREE_TEXT,
  TABLE_LATE_RING,
  TABLE_LATE_RING_WIDTH,
  TABLE_NAME_PX,
} from "../lib/hospitalityTheme.js";
import { syncNow } from "../lib/syncNow.js";
import {
  guardarZonasPlegadas,
  leerZonasPlegadas,
  type ResumenDeZona,
  resumenDeZona,
  rotuloDeZonaPlegada,
  zonasSePliegan,
} from "../lib/zonasPlegadas.js";
import { CloseShiftModal } from "./CloseShiftModal.js";
import { summarizeOpenTables } from "../lib/openTables.js";
import { VERDE_LISTA, VERDE_LISTA_TEXT } from "../lib/kitchenTheme.js";
import {
  hojaDeLaMesa,
  type ListaDeCocina,
} from "../lib/avisosListos.js";
import { HojaDeListo } from "../kitchen/tpv/HojaDeListo.js";
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
  /** auditoria-sirope (#14) · POR_RECOGER: pagada y sin recoger. */
  state: "FREE" | "OPEN" | "BILLING" | "POR_RECOGER";
  /** auditoria-sirope (#14) · cuándo se cobró (ISO), para los minutos. */
  porRecogerDesde?: string | null;
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
  /**
   * n1-hosteleria-2 · hallazgo 9 · lo listo CON SU DETALLE, para que la
   * etiqueta LISTO de una mesa abra la hoja en vez de servir en el acto.
   */
  avisosListo?: ListaDeCocina[];
  /** El «Hecho» de la hoja: sirve todas las comandas de la mesa. */
  onServidas?: (orderIds: string[]) => void;
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
  // auditoria-sirope (#11) · lo que hay aparcado en venta rápida. Se
  // vuelve a leer en cada repintado del mapa (lo mismo que hace `load`
  // con las mesas) porque el carrito y el borrador los escribe la otra
  // pantalla: aquí sólo se miran.
  const aparcadoEnVentaRapida = (() => {
    const lineas = loadPersistedCartLines(
      "mipiacetpv-cart-in-progress:quick-sale",
    );
    return totalAparcadoEnVentaRapida(lineas, computeCart(lineas).total);
  })();
  // n1-hosteleria · el umbral ÚNICO del bloque. De aquí cuelga todo lo
  // que cambia en un aparato de mano; por encima de 640 px `reparto` es
  // `REPARTO_TERMINAL` y esta pantalla es exactamente la de v2-H1.
  const deMano = useAparatoDeMano();
  const reparto = repartoDeSala(deMano);

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
  // auditoria-sirope (#14) · la mesa POR RECOGER que se acaba de tocar.
  const [porRecoger, setPorRecoger] = useState<ApiTable | null>(null);
  // n1-hosteleria-2 · hallazgo 9 · qué mesa tiene la hoja de «listo»
  // abierta. Antes la etiqueta servía en el acto; ahora abre esto.
  const [mesaListaAbierta, setMesaListaAbierta] = useState<string | null>(null);
  /**
   * n1-hosteleria-2 · hallazgo 2 · qué zonas están plegadas.
   *
   * El inicial se LEE del aparato en el `useState`, no en un efecto: con
   * un efecto habría un primer pintado con las tres zonas abiertas y el
   * mapa daría un salto en cuanto se recordara el pliegue — justo en la
   * pantalla que el camarero está mirando para decidir adónde va.
   */
  const [zonasPlegadas, setZonasPlegadas] = useState<Set<string>>(() =>
    leerZonasPlegadas(),
  );

  const alternarZona = useCallback((zona: string) => {
    setZonasPlegadas((prev) => {
      const siguiente = new Set(prev);
      if (siguiente.has(zona)) siguiente.delete(zona);
      else siguiente.add(zona);
      guardarZonasPlegadas(siguiente);
      return siguiente;
    });
  }, []);
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
  const wsStatus = useStoreEventStream(data?.storeId ?? null, (ev) => {
    // auditoria-sirope (#20) · un cambio de ajustes del tenant no es un
    // cambio del mapa: lo que hay que volver a pedir es `/devices/me`.
    if (ev.type === "tenant.settings_changed") {
      avisarAjustesCambiados();
      return;
    }
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

  // auditoria-sirope (#13) · EL TAMAÑO DE MESA SALE DEL ANCHO QUE HAY.
  //
  // `TABLE_SHAPE_SIZE` era un número fijo (144) calculado para el peor
  // caso de La Maestranza a 1280 × 800. En el D8 de Sirope, con tres
  // zonas de pocas mesas, dejaba ≈ 190 px muertos a la derecha. La regla
  // de v1.23 no se toca —todas las mesas miden lo mismo—: lo que cambia
  // es que el número se elige en vez de estar escrito.
  const ladoDeMesa = (() => {
    if (typeof window === "undefined") return TABLE_SHAPE_SIZE;
    const porZona = countByZone(tables);
    const zonas: RoomZone[] = (
      ["BARRA", "SALON", "TERRAZA", "RESERVADO"] as const
    )
      .filter((z) => (porZona[z] ?? 0) > 0)
      .map((z) => ({ tables: porZona[z] ?? 0, isBar: z === "BARRA" }));
    return tamanoDeMesaPara(
      zonas,
      window.innerWidth,
      window.innerHeight,
      reparto,
    );
  })();

  async function dejarLibre(mesa: ApiTable): Promise<void> {
    try {
      await apiWithCashier(`/tables/${mesa.id}/recogida`, {
        method: "POST",
        body: {},
      });
    } catch {
      // Una mesa que no se pudo marcar como recogida sigue ahí y se
      // vuelve a tocar: no hay dinero en juego y un error modal por
      // esto sería peor que el aviso que ya da el repoll.
    }
    void load();
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
        lado={ladoDeMesa}
        deMano={deMano}
        amountFontPx={reparto.amountFontPx}
        onRecogida={setPorRecoger}
        // n1-hosteleria-2 · hallazgo 9 · la etiqueta ABRE la hoja de esa
        // mesa. Tocar y que desaparezca dejaba al camarero con el nombre
        // de una mesa y sin saber qué tenía que coger del pase.
        onServido={() => setMesaListaAbierta(t.id)}
        onPick={props.onPickTable}
        onCobrar={openCobro}
      />
    );
  };

  // n1-hosteleria · los controles de la cabecera, sueltos, para poder
  // componerlos en UNA fila (terminal) o en DOS (mano) sin duplicar
  // ninguno. Ver la nota larga del `<header>`.
  const botonMenu = (
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
  );

  const bloqueTitulo = (
    // En la mano `flex-1 min-w-0`: es el único hijo que CEDE, y es lo que
    // impide que la fila pida más ancho que la ventana. 22/15 px en vez
    // de 28/17 para que las dos líneas entren en los 56 de la fila.
    <div className={deMano ? "flex-1 min-w-0" : "min-w-0"}>
      <div
        className="font-semibold leading-tight truncate"
        style={{
          fontSize: deMano ? 22 : 28,
          letterSpacing: "-0.015em",
        }}
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
        style={{ fontSize: deMano ? 15 : 17, color: DARK_TEXT_MUTED }}
      >
        {/* «1 abierta», no «1 abiertas». Lo cazó el bucle visual en
            la sala de Sirope, que tenía una sola mesa ocupada. */}
        {openCount} {openCount === 1 ? "abierta" : "abiertas"} ·{" "}
        {formatEur(salaTotal)}
      </div>
    </div>
  );

  const botonTickets = (
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
  );

  const botonCajero = (
    <button
      type="button"
      onClick={props.onLogoutCashier}
      title={`Bloquear (${props.cashierLabel})`}
      // En la mano `max-w-[22vw]` (79 px a 360) en vez de 20vw: con 72 px
      // el nombre del cajero de Sirope se quedaba en dos letras. Sigue
      // truncando, y sigue midiendo 44 de alto.
      className={`shrink-0 rounded-[14px] truncate ${
        deMano ? "px-3 max-w-[22vw]" : "px-4 max-w-[20vw]"
      }`}
      style={{
        height: MIN_TOUCH_PX,
        background: DARK_SURFACE,
        color: DARK_TEXT_SOFT,
        fontSize: 15,
      }}
    >
      {props.cashierLabel.split("@")[0]}
    </button>
  );

  // auditoria-sirope (#11) · LA VENTA RÁPIDA APARCADA SE VE.
  // El 18-10 quedó una de 3 € a medias y desde el mapa no había forma de
  // saberlo: el botón decía «Venta rápida» igual que si no hubiera nada.
  // Una mesa abierta se ve de lejos; ésta sólo aparecía sola al cerrar el
  // turno.
  const botonVentaRapida = (
    <button
      type="button"
      onClick={props.onQuickSale}
      data-testid="boton-venta-rapida"
      // En la mano 16 px y `px-3.5`: con el importe aparcado el rótulo
      // mide ~183 px de los 360, y lo que queda es para el desplazador de
      // los chips. El importe NO se quita — es el hallazgo #11.
      className={`shrink-0 rounded-2xl font-semibold ${
        deMano ? "px-3.5" : "px-5"
      }`}
      style={{
        height: MIN_TOUCH_PX,
        background: CORAL,
        color: DARK_ON_CORAL,
        fontSize: deMano ? 16 : 19,
      }}
    >
      {aparcadoEnVentaRapida > 0
        ? `Venta rápida · ${formatEur(aparcadoEnVentaRapida)}`
        : "Venta rápida"}
    </button>
  );

  return (
    <div
      data-testid="room-screen"
      data-theme="dark"
      // n1-hosteleria · `h-screen` en la mano y `min-h-screen` en el
      // terminal, y la diferencia es el «alto total 4.020 px» que midió
      // la pasada: con `min-h-screen`, si el contenido es más alto que la
      // pantalla el contenedor CRECE, el `flex-1` del `<main>` crece con
      // él y su `overflow-y-auto` no tiene nada que recortar — así que
      // desplaza la PÁGINA y la cabecera se va hacia arriba. Con
      // `h-screen` la altura queda clavada, y lo que desplaza es el
      // lienzo con la cabecera y los chips de zona siempre puestos.
      //
      // Se elige en JS y no con `sm:` a propósito: la regla
      // `body.con-banda-ensayo .h-screen` del `index.css` tiene más
      // especificidad que una utilidad `sm:`, así que un `sm:h-auto`
      // habría dejado la altura clavada también en el terminal.
      className={`${deMano ? "h-screen" : "min-h-screen"} flex flex-col font-sans`}
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
      {/* ── Cabecera ──────────────────────────────────────────────────
          En el TERMINAL: UNA fila de 80 px con todo —identidad, contador
          de sala, filtros de zona y «Venta rápida»—. La cabecera clara
          repartía lo mismo en TRES bloques (barra de app, fila «Sala · N
          abiertas…» y leyenda) que sumaban 212 px antes de la primera
          mesa. Esos 108 px recuperados son los que permiten que la mesa
          crezca de 19.824 a 20.736 px² sin que la sala desplace.

          EN LA MANO: DOS filas de 56. Y no es estética — es el hallazgo 1
          de la pasada del 18-10 (🔴).

          Esa fila única lleva a TODOS sus hijos en `shrink-0`, así que su
          ancho de contenido mínimo es la suma de todos: ~845 px. El
          WebView de Android ensancha el viewport de maquetación hasta el
          mínimo que le pide el contenido, y medido en el N1 eso daba
          `innerWidth` 845 con `documentElement.clientWidth` 360 — 485 px
          fuera de la pantalla, SÓLO en esta pantalla (en el resto del TPV
          era 360 × 720). Con ellos se iban «Salón» (termina en x=402) y
          «Terraza» (x=512), y la página no desplaza en horizontal
          (`scrollLeft` se quedaba en 0): dos de las cuatro zonas,
          inalcanzables.

          Lo que lo arregla no es repartir en dos filas por sí mismo, sino
          que NINGUNA fila pida más que la ventana:

            · fila 1 · el bloque del título es `flex-1 min-w-0` y trunca,
              así que cede;
            · fila 2 · los chips viven en su PROPIO desplazador
              horizontal (`overflow-x-auto` + `min-w-0`), que es lo que
              permite que la fila mida 0 de mínimo y que «Terraza» se
              alcance deslizando los chips, sin mover la página.

          Reparto: arriba lo que identifica y lo que se consulta (menú,
          sala, Tickets, cajero); abajo lo que se usa en cada servicio
          (las zonas y «Venta rápida», que se queda a la derecha y a mano
          del pulgar). Los cuatro objetivos siguen midiendo 44. */}
      <header
        className={
          deMano
            ? "shrink-0 flex flex-col border-b"
            : "shrink-0 flex items-center gap-4 px-5 border-b"
        }
        style={{
          height: reparto.headerHeight,
          borderColor: DARK_SURFACE_RAISED,
        }}
      >
        {deMano ? (
          <>
            <div
              data-testid="room-header-fila-1"
              className="flex items-center gap-2.5 px-4 min-w-0"
              style={{ height: reparto.headerHeight / 2 }}
            >
              {botonMenu}
              {bloqueTitulo}
              {botonTickets}
              {botonCajero}
            </div>
            <div
              data-testid="room-header-fila-2"
              className="flex items-center gap-2.5 px-4 min-w-0"
              style={{ height: reparto.headerHeight / 2 }}
            >
              {/* El desplazador propio de los chips. `min-w-0` para que
                  la fila no herede su ancho de contenido, y
                  `overscroll-contain` para que al llegar al último chip
                  el gesto no siga hacia la página. */}
              <div
                data-testid="zone-chips-scroller"
                className="flex-1 min-w-0 overflow-x-auto overscroll-contain"
              >
                <ZoneChips
                  zoneFilter={zoneFilter}
                  setZoneFilter={setZoneFilter}
                  counts={counts}
                  deMano
                />
              </div>
              {botonVentaRapida}
            </div>
          </>
        ) : (
          <>
            {botonMenu}
            {bloqueTitulo}
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
            {botonTickets}
            {botonCajero}
            {botonVentaRapida}
          </>
        )}
      </header>

      {/* v1.9.2-mesas-concurrencia · banner inline de expulsión / éxito.
          Autocierre 4 s, cerrable a mano. Nada de modales en el flujo. */}
      {/* auditoria-sirope (#15) · EL AVISO FLOTA, NO EMPUJA.
          «Mesa cobrada · Ticket 000024» era una franja en el flujo: al
          aparecer bajaba el mapa entero y cortaba la leyenda por abajo
          (capturas 29 y 73). Un aviso que se va solo a los cuatro
          segundos no puede recolocar la pantalla debajo —y menos la
          pantalla que el camarero está mirando para sentar a alguien—.

          Flotante y arriba del todo: se lee sin tapar las mesas (ocupa
          una franja estrecha centrada) y se va solo. */}
      {notice && (
        <div
          data-testid="room-notice"
          className={`fixed top-3 left-1/2 -translate-x-1/2 z-50 max-w-[92vw] rounded-2xl shadow-lg px-4 py-3 border flex items-start gap-3 ${
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
          paddingLeft: reparto.sidePadding,
          paddingRight: reparto.sidePadding,
          paddingTop: reparto.topPadding,
          paddingBottom: reparto.sidePadding,
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
              // n1-hosteleria-2 · hallazgo 2 · en la mano y en «Todas»,
              // cada zona es una sección que se pliega de un toque. Ver
              // `lib/zonasPlegadas.ts`.
              const plegable = zonasSePliegan({ deMano, filtro: zoneFilter });
              const plegada = plegable && zonasPlegadas.has(zone);
              const cabecera = plegable ? (
                <ZoneHeader
                  zona={zone}
                  label={ZONE_LABEL[zone].toUpperCase()}
                  plegada={plegada}
                  resumen={resumenDeZona(zoneTables, props.mesasListas)}
                  onAlternar={() => alternarZona(zone)}
                />
              ) : null;
              if (zone === "BARRA") {
                return (
                  <BarZone
                    key={zone}
                    tables={zoneTables}
                    renderCard={renderRoomCard}
                    zonePadding={reparto.zonePadding}
                    deMano={deMano}
                    cabecera={cabecera}
                    plegada={plegada}
                  />
                );
              }
              return (
                <ZoneFrame
                  key={zone}
                  label={ZONE_LABEL[zone].toUpperCase()}
                  zonePadding={reparto.zonePadding}
                  cabecera={cabecera}
                  plegada={plegada}
                >
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
          {/* auditoria-sirope (#14) · el estado nuevo, en la leyenda. */}
          <LegendDot fill={TABLE_POR_RECOGER_FILL} label="Por recoger" />
          <LegendDot
            fill={TABLE_BUSY_FILL}
            ring={TABLE_LATE_RING}
            // auditoria-sirope (#16) · y el aro deja de compartir color
            // con «pide la cuenta»: aquí se ve al lado.
            dashed
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
      {/* auditoria-sirope (#14) · los dos toques de una mesa por recoger.
          «Dejar libre» la deja lista sin sentar a nadie; «Abrir cuenta
          nueva» la ocupa directamente —y la limpia de paso, que es lo
          que pasa de verdad cuando llega el siguiente cliente—. */}
      {/* n1-hosteleria-2 · hallazgo 8 · LA ACCIÓN MÁS PROBABLE, PRIMERO.
          «Dejar libre» y «Abrir cuenta nueva» se cambian de sitio, y las
          dos razones apuntan al mismo lado:

            · FRECUENCIA. El estado POR RECOGER existe para decirle al
              camarero «ve a recoger ésta»: lo crea el cobro y lo deshace
              la recogida. Durante el servicio se mira el mapa buscando
              mesas que recoger, no mesas que abrir — abrir pasa cuando
              llega gente, y entonces se mira la mesa LIBRE.
            · COSTE DE EQUIVOCARSE. «Abrir cuenta nueva» sin querer deja
              un borrador abierto que luego hay que anular (en el ensayo
              del 23-10 quedaron tres). «Dejar libre» sin querer no
              cuesta nada: se vuelve a tocar y se abre.

          Lo que NO cambia es el contrato de `ConfirmSheet`: el botón de
          relleno sigue siendo «lo que va a pasar» y la salida neutra
          sigue abajo y sigue siendo lo que hace el atrás de Android.
          auditoria-sirope (#14) había puesto «Abrir cuenta nueva»
          delante porque «es lo que pasa de verdad cuando llega el
          siguiente cliente», y eso sigue siendo cierto: por eso se queda
          como segunda acción, con su botón entero, y no como el texto
          gris que era «Dejar libre». */}
      {/* n1-hosteleria-2 · hallazgo 9 · la hoja de lo que está listo en
          una mesa, con sus líneas y el «Hecho». Ver `lib/avisosListos.ts`. */}
      {mesaListaAbierta != null &&
        (() => {
          const mesa = hojaDeLaMesa(props.avisosListo ?? [], mesaListaAbierta);
          if (!mesa) return null;
          return (
            <HojaDeListo
              mesa={mesa}
              deMano={deMano}
              onHecho={(ids) => {
                setMesaListaAbierta(null);
                if (props.onServidas) props.onServidas(ids);
                else for (const id of ids) props.onServido?.(id);
                void load();
              }}
              onCerrar={() => setMesaListaAbierta(null)}
            />
          );
        })()}
      {porRecoger && (
        <ConfirmSheet
          title={`${porRecoger.name} · por recoger`}
          body={`Se cobró hace ${minutosDesde(porRecoger.porRecogerDesde)}. ¿Qué hacemos con ella?`}
          confirmLabel="Dejar libre"
          cancelLabel="Volver"
          altLabel="Abrir cuenta nueva"
          onCancel={() => setPorRecoger(null)}
          onConfirm={() => {
            const mesa = porRecoger;
            setPorRecoger(null);
            void dejarLibre(mesa);
          }}
          onAlt={() => {
            const mesa = porRecoger;
            setPorRecoger(null);
            props.onPickTable(mesa);
          }}
        />
      )}
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
  deMano = false,
}: {
  zoneFilter: TableZone | "ALL";
  setZoneFilter: (z: TableZone | "ALL") => void;
  counts: Record<TableZone, number>;
  /**
   * n1-hosteleria · en la mano los chips viven dentro de un desplazador
   * horizontal propio (ver la nota del `<header>`) y SUBEN de 52 a
   * `MIN_TOUCH_PX` = 56, que es el suelo táctil de estas pantallas: los
   * 52 del terminal se tocan con el ratón o con la tablet apoyada, y
   * aquí se tocan en marcha. El rótulo baja a 16 px y el relleno a
   * `px-4` para que quepan más chips antes de deslizar.
   */
  deMano?: boolean;
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
            className={`rounded-[14px] shrink-0 font-medium ${
              deMano ? "px-4" : "px-5"
            }`}
            style={{
              height: deMano ? MIN_TOUCH_PX : 52,
              fontSize: deMano ? 16 : 18,
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
  zonePadding,
  cabecera,
  plegada = false,
}: {
  label: string;
  children: ReactNode;
  /**
   * n1-hosteleria-2 · la cabecera plegable de la mano. Cuando la hay,
   * sustituye al rótulo flotante del marco: dos rótulos de la misma zona
   * en la misma caja es ruido, y el flotante es el que no se toca.
   */
  cabecera?: ReactNode;
  /** Plegada, la zona es sólo su cabecera. */
  plegada?: boolean;
  /**
   * n1-hosteleria · 12 px en la mano y 18 en el terminal
   * (`RepartoDeSala.zonePadding`). Los 6 px por lado son los que hacen
   * que quepan TRES mesas de 88 en los 328 útiles de 360.
   */
  zonePadding: number;
  /** El mostrador dibujado de la Barra. */
  extraTop?: ReactNode;
}) {
  // n1-hosteleria-2 · hallazgo 2 · CON CABECERA NO HAY MARCO.
  //
  // Y no es estética: es lo que paga la cabecera. Una franja de 48 px
  // encima de cada zona, por sí sola, baja de 11 mesas a la vista a 8 —
  // medido con las 23 de Sirope a 360 × 720—. Lo que las devuelve es que
  // el marco discontinuo y su rótulo flotante se vayan: entre los dos
  // cuestan 2 × 12 de relleno más 1,5 de borde por zona, y una cabecera
  // sólida con el nombre dentro ya dice dónde empieza y dónde acaba la
  // zona. Dos cosas diciendo lo mismo, y se queda la que se toca.
  //
  // El cálculo está en `CABECERA_DE_ZONA_PX` y lo mide
  // `n1-zonas-plegables.test.ts`, no este comentario.
  //
  // Por encima del umbral de mano no hay cabecera, así que el marco y el
  // rótulo flotante se quedan exactamente como estaban: es la
  // restricción del bloque.
  const conCabecera = cabecera != null;
  return (
    <section
      data-testid="zone-frame"
      data-zone-label={label}
      data-plegada={plegada ? "true" : "false"}
      data-con-marco={conCabecera ? "false" : "true"}
      className={
        conCabecera
          ? "relative"
          : "relative rounded-[22px] border-[1.5px] border-dashed"
      }
      style={
        conCabecera
          ? undefined
          : { padding: zonePadding, borderColor: DARK_SURFACE_RAISED }
      }
    >
      {cabecera ?? (
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
      )}
      {!plegada && (
        <div className={conCabecera ? "pt-2" : undefined}>
          {extraTop}
          {children}
        </div>
      )}
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
  lado,
  deMano,
  amountFontPx,
  onRecogida,
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
  /** auditoria-sirope (#13) · el lado de la caja, que ya no es fijo. */
  lado: number;
  /**
   * n1-hosteleria · la forma pequeña (88 px) de un aparato de mano.
   *
   * QUÉ SE QUEDA Y QUÉ SE VA, que es la decisión que pedía el bloque.
   * `principio-cobro-en-mesa` manda: «el total visible en la tarjeta» y
   * «cobrar directo desde la tarjeta de mesa, sin entrar a la venta». Así
   * que de la forma de 88 px NO se van ni el número de mesa, ni el
   * importe, ni el botón de cobro.
   *
   * Lo que se va es la META: el «hace 12 min» / «cuenta» de debajo del
   * importe. Y se va porque es lo único que el lienzo ya dice sin
   * palabras — el relleno distingue libre / ocupada / pide la cuenta, y
   * el aro discontinuo es «+45 min sin atender», que es el único umbral
   * de tiempo que se actúa. El minuto exacto se consulta abriendo la
   * mesa, que es donde se decide algo con él.
   */
  deMano: boolean;
  /** `RepartoDeSala.amountFontPx`: 14 en la mano, 22 en el terminal. */
  amountFontPx: number;
  /** auditoria-sirope (#14) · un toque en una mesa POR RECOGER. */
  onRecogida: (t: ApiTable) => void;
  onServido: () => void;
  onPick: (t: ApiTable) => void;
  onCobrar: (t: ApiTable) => void;
}) {
  const elapsed = useElapsedTime(table.activeTicket?.openedAt);
  const minutes = useElapsedMinutes(table.activeTicket?.openedAt);
  const absorbed = !!table.groupedIntoTableId;
  const disabled = offline || pendingCheckout || anyOpening;
  // El radio sigue siendo lo único que distingue una zona de otra, pero
  // el de los círculos es la MITAD DEL LADO: con un lado variable, un
  // radio fijo de 72 convertiría la mesa en un rectángulo de esquinas
  // redondas en cuanto el lado creciera.
  const esCirculo = TABLE_SHAPE_RADIUS[table.zone] >= TABLE_SHAPE_SIZE / 2;
  const radius = esCirculo ? lado / 2 : TABLE_SHAPE_RADIUS[table.zone];
  const box = {
    width: lado,
    height: lado,
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
        {/* n1-hosteleria-2 · R4 · al suelo en la mano. La tarjeta entera
            va a `opacity-55`, así que lo medido es la tinta ya mezclada
            con el lienzo: **7,18:1** el nombre y **6,16:1** esta línea.
            El contraste nunca fue el problema aquí; el tamaño sí. */}
        <span
          className="font-medium"
          style={{
            fontSize: deMano ? SUELO_LETRA_MANO_PX : 14,
            opacity: 0.9,
          }}
        >
          unida a {principal?.name ?? "grupo"}
        </span>
      </button>
    );
  }

  const isFree = table.state === "FREE";
  const isBilling = table.state === "BILLING";
  // auditoria-sirope (#14) · pagada y todavía con el servicio encima.
  const porRecoger = table.state === "POR_RECOGER";
  const olvidada =
    !isFree &&
    !porRecoger &&
    minutes != null &&
    minutes >= FORGOTTEN_TABLE_MINUTES;
  const pax =
    table.capacity + groupedChildren.reduce((s, c) => s + c.capacity, 0);
  const groupBadge =
    groupedChildren.length > 0
      ? "+" + groupedChildren.map((c) => c.name).join(", ")
      : null;

  const fill = pendingCheckout
    ? DARK_SURFACE_RAISED
    : porRecoger
      ? TABLE_POR_RECOGER_FILL
      : isFree
        ? TABLE_FREE_FILL
        : isBilling
          ? TABLE_BILLING_FILL
          : TABLE_BUSY_FILL;
  // n1-hosteleria-2 · R4 · EL BLANCO SOBRE EL CORAL NO LLEGA A 4,5:1.
  //
  // `TABLE_BUSY_TEXT` es blanco y `TABLE_BUSY_FILL` es el coral de la
  // casa (#E97058): medido, **3,03:1**. Pasa de milagro el umbral de
  // «texto grande» (3,0:1) con el nombre a 20 px en negrita, y NO pasa
  // con el importe, que es texto normal y es justo el dato que el
  // camarero va a comprobar contra el efectivo.
  //
  // Lo que se cambia es la TINTA y no el relleno: el coral es la marca y
  // es lo que dice «ocupada» de un vistazo en el lienzo. Con `DARK_INK`
  // encima sube a **5,92:1**, y de paso es la misma pareja tinta/relleno
  // que ya usan «pide la cuenta» (ámbar con #1B1500) y «por recoger»
  // (azul con #16202A), así que las tres mesas con cuenta abierta se
  // leen igual.
  //
  // Sólo en la mano: en el terminal el blanco sobre coral se queda como
  // está, que es la restricción del bloque. Queda anotado en el `-done`
  // que el AP11 y el D8 siguen a 3,03:1.
  const text = pendingCheckout
    ? DARK_TEXT_MUTED
    : porRecoger
      ? TABLE_POR_RECOGER_TEXT
      : isFree
        ? TABLE_FREE_TEXT
        : isBilling
          ? TABLE_BILLING_TEXT
          : deMano
            ? DARK_INK
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
          // n1-hosteleria-2 · R3 y R4 · dos arreglos en la misma
          // etiqueta, y los dos salen de medirla:
          //
          //  · el color era `#FFFFFF` sobre `VERDE_LISTA` (#8FD9A8):
          //    **1,66:1**. No es «poco contraste», es texto invisible, y
          //    estaba pintado así desde kds-1 con la constante buena
          //    —`VERDE_LISTA_TEXT`— exportada al lado y sin usar. Con
          //    ella sube a **10,82:1**.
          //  · medía 30 px de alto, y R3 pide 48 para todo lo que se
          //    toca. Un toque aquí marca «Servido» en todos los TPV del
          //    local, así que de los objetivos de esta pantalla es
          //    justamente el que no se puede fallar.
          //
          // En el terminal se queda en 30 px (la restricción), pero el
          // color se arregla en los dos: 1,66:1 no es una decisión de
          // reparto que un tamaño de pantalla pueda justificar. Queda
          // dicho en el `-done` que esto SÍ se ve en el diff del AP11.
          className="absolute z-10 rounded-[10px] px-2.5 font-bold flex items-center"
          style={{
            top: -8,
            left: 6,
            height: deMano ? 48 : 30,
            background: VERDE_LISTA,
            color: VERDE_LISTA_TEXT,
            fontSize: SUELO_LETRA_MANO_PX,
          }}
        >
          LISTO
        </button>
      )}
      <button
        type="button"
        // auditoria-sirope (#14) · en una mesa POR RECOGER, un toque no
        // abre cuenta: pregunta qué se hace con ella. Abrir cuenta sin
        // querer en una mesa sin recoger es sentar a alguien en el
        // servicio del anterior.
        onClick={() => (porRecoger ? onRecogida(table) : onPick(table))}
        disabled={disabled}
        data-testid="table-shape"
        data-zone={table.zone}
        data-state={
          pendingCheckout
            ? "pending"
            : porRecoger
              ? "por-recoger"
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
          // auditoria-sirope (#16) · el aro de «+45 min» pasa a ROJO y
          // DISCONTINUO: con el ámbar de «pide la cuenta» eran la misma
          // señal y el aro se leía como medio relleno. Va por `outline`
          // y no por `box-shadow` porque un `box-shadow` no puede ser
          // discontinuo; el `outline` sigue el `border-radius` desde
          // Chrome 94, y el WebView más viejo del parque es el 101.
          outline: olvidada
            ? `${TABLE_LATE_RING_WIDTH}px dashed ${TABLE_LATE_RING}`
            : undefined,
          outlineOffset: olvidada ? 2 : undefined,
        }}
      >
        <span
          data-testid="table-name"
          // n1-hosteleria · con el botón de cobro de 56 px ocupando de 26
          // a 82 de los 88, un nombre centrado cae justo encima. Anclado
          // arriba cuando hay botón; centrado en todo lo demás, como
          // siempre. Ver la nota de `COBRAR_HEIGHT_MANO`.
          className={`font-semibold leading-none ${
            deMano && showCobrar ? "absolute top-1.5 inset-x-0 text-center" : ""
          }`}
          style={{
            // n1-hosteleria · 20 px en la forma de 88. Con los 28 del
            // terminal, «M12» más el importe de 14 suman 34 px de tinta
            // en un círculo cuya cuerda útil a esa altura no llega a 80:
            // el nombre se comía el sitio del dinero.
            fontSize: deMano ? (showCobrar ? 18 : 20) : TABLE_NAME_PX,
            letterSpacing: "-0.015em",
          }}
        >
          {table.name}
        </span>
        {porRecoger ? (
          // auditoria-sirope (#14) · lo que hay que saber de un vistazo:
          // que está pagada y cuánto lleva esperando. El importe no —ya
          // se cobró— y los pax tampoco: nadie se sienta aquí todavía.
          // n1-hosteleria-2 · hallazgo 7 · ESTE es el estado que Matías
          // no pudo leer, y medido no era el contraste: la tinta sobre
          // el azul da **7,69:1**, de sobra. Era el tamaño. «Por
          // recoger» estaba a **13 px**, el único texto de estado del
          // mapa por debajo del suelo de R4.
          //
          // Y al subirlo a 15 las dos líneas ya no caben en un círculo
          // de 88 con el nombre encima, así que manda R4: **se enseña
          // menos, no más pequeño**. Se van los MINUTOS, por la misma
          // razón por la que `n1-hosteleria` quitó la meta de la mesa
          // ocupada (§2.2): el minuto exacto no se actúa desde el mapa
          // —se actúa decidiendo si se recoge— y la hoja de opciones,
          // que es el toque siguiente, lo dice entero y con letra
          // grande («Se cobró hace 12 min»).
          //
          // En el terminal siguen las dos líneas: la mesa mide 136–152 y
          // caben.
          <>
            <span
              data-testid="table-por-recoger"
              className="font-semibold uppercase"
              style={{
                fontSize: deMano ? SUELO_LETRA_MANO_PX : 13,
                letterSpacing: "0.06em",
              }}
            >
              Por recoger
            </span>
            {!deMano && (
              <span
                className="font-medium"
                style={{ fontSize: 15, opacity: 0.8 }}
              >
                {minutosDesde(table.porRecogerDesde)}
              </span>
            )}
          </>
        ) : isFree ? (
          // n1-hosteleria-2 · R4 · 13 px en la mano era lo mismo que
          // «Por recoger»: por debajo del suelo. A 15 px con la opacidad
          // de siempre el contraste medido sobre el relleno claro es
          // **5,18:1**, así que sube sin tocar el color. El terminal se
          // queda en 14.
          <span
            className="font-medium"
            style={{
              fontSize: deMano ? SUELO_LETRA_MANO_PX : 14,
              opacity: 0.65,
            }}
          >
            {pax} pax
          </span>
        ) : pendingCheckout && deMano ? (
          // Ver la nota de `pendingCheckout` más abajo: en la mano el
          // estado se queda con la línea del importe, que es la única
          // que tiene cuerda para leerse.
          <span
            data-testid="table-pendiente"
            className="font-semibold uppercase"
            style={{
              fontSize: SUELO_LETRA_MANO_PX,
              letterSpacing: "0.04em",
            }}
          >
            Pendiente
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
                  style={{ fontSize: amountFontPx }}
                >
                  {formatEur(Number(table.activeTicket.total))}
                </span>
              )}
              {/* La meta cede su sitio al botón «Cobrar X €» cuando lo
                  hay: el botón ya dice qué pasa con esta mesa, y en una
                  forma de 144 px las dos cosas se pisan (medido en el
                  bucle visual, T2 de La Maestranza). */}
              {/* n1-hosteleria · en la mano esta línea no se pinta. Ver
                  la nota del prop `deMano`: el relleno ya dice el estado
                  y el aro discontinuo ya dice «+45 min». */}
              {!showCobrar && !deMano && (
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
        {/* n1-hosteleria-2 · R4 · los 10 px suben al suelo en la mano.
            Sigue truncando, que es lo que debe hacer: «+M5, M6» a 15 px
            pide ~63 px y la cuerda a esa altura del círculo de 88 da 66,
            así que con tres mesas unidas se corta — y cortar el nombre de
            la tercera es mejor que no poder leer ninguno. */}
        {groupBadge && (
          <span
            className="absolute top-1.5 inset-x-0 font-bold truncate px-2"
            style={{
              fontSize: deMano ? SUELO_LETRA_MANO_PX : 10,
              letterSpacing: "0.06em",
              opacity: 0.8,
            }}
          >
            {groupBadge}
          </span>
        )}
        {/* n1-hosteleria-2 · R4 · «cobro pendiente» a 10 px era el texto
            más pequeño del mapa, y es el que avisa de que ESTA mesa tiene
            un cobro sin subir y está bloqueada en este aparato.
            Al suelo no cabe donde estaba: pegado a `bottom-2` de un
            círculo de 88 el ancho real no es el lado sino la cuerda a esa
            altura, ~53 px, y «PENDIENTE» a 15 px pide 76. Así que, como
            manda R4, se enseña menos y en otro sitio: la palabra pasa a
            la LÍNEA del importe —centrada, donde la cuerda da 85,7— y el
            importe no se pinta. Lo que hay que saber de esta mesa no es
            cuánto llevaba: es que no se puede tocar hasta que suba.
            En el terminal se queda exactamente como estaba. */}
        {pendingCheckout && !deMano && (
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
            bottom: deMano ? COBRAR_BOTTOM_MANO : COBRAR_BOTTOM,
            maxWidth: cobrarMaxWidth(
              table.zone,
              lado,
              deMano ? COBRAR_HEIGHT_MANO : COBRAR_HEIGHT,
              deMano ? COBRAR_BOTTOM_MANO : COBRAR_BOTTOM,
              deMano ? COBRAR_MARGEN_MANO : undefined,
            ),
            paddingLeft: deMano ? COBRAR_PADDING_X_MANO : 10,
            paddingRight: deMano ? COBRAR_PADDING_X_MANO : 10,
            height: deMano ? COBRAR_HEIGHT_MANO : COBRAR_HEIGHT,
            fontSize: 15,
            background: TABLE_BILLING_TEXT,
            color: TABLE_BILLING_FILL,
          }}
        >
          {cobroBusy ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : deMano ? (
            // Dos renglones, los dos al suelo de R4. Ver la nota de
            // `COBRAR_HEIGHT_MANO`: 15 + 2 + 15 = 32 px de tinta en un
            // botón de 56, y el ancho lo manda la cuerda.
            <span className="flex flex-col items-center leading-none gap-0.5">
              <span
                className="font-semibold uppercase"
                style={{
                  fontSize: SUELO_LETRA_MANO_PX,
                  letterSpacing: "0.02em",
                }}
              >
                Cobrar
              </span>
              <span
                className="font-semibold tabular-nums"
                style={{ fontSize: COBRAR_AMOUNT_FONT_PX_MANO }}
              >
                {formatEur(Number(table.activeTicket.total))}
              </span>
            </span>
          ) : (
            <>Cobrar {formatEur(Number(table.activeTicket.total))}</>
          )}
        </button>
      )}
    </div>
  );
}

/** Alto del botón «Cobrar X €» de una mesa en BILLING. */
export const COBRAR_HEIGHT = 36;

/** A qué altura del borde inferior se ancla. */
export const COBRAR_BOTTOM = 18;

/**
 * n1-hosteleria · el botón de cobro en la forma de 88 px.
 *
 * El bloque pide «el cobro desde la tarjeta (estado cuenta) sigue
 * existiendo **con su objetivo de 44 px**». Se le da MÁS: 56, que es
 * `MIN_TOUCH_PX`, el suelo táctil que `hospitalityTheme.ts` fija para la
 * venta y la sala. Los 36 del terminal están por debajo de las dos
 * cifras; aquí no se repite.
 *
 * La geometría sale de la cuerda:
 *
 *   bottom 6 + alto 56  →  centro del botón a 34 del borde
 *   offset del centro de la mesa = 44 − 34 = 10
 *   cuerda a 10 = 2·√(44² − 10²) = 85,7  →  81 px de ancho útil
 *
 * Y obliga a algo más: con el botón ocupando de 26 a 82 px de los 88, el
 * nombre de la mesa YA NO PUEDE IR CENTRADO —se solaparía—, así que en
 * la mano se ancla arriba cuando hay botón de cobro.
 *
 * En ese ancho no entra «Cobrar 12,50 €» en UNA línea (14 caracteres a
 * 15 px piden ~113 px), así que va en DOS renglones: «Cobrar» encima del
 * importe. La palabra se queda —un botón que sólo enseñara el importe se
 * lee como una etiqueta, no como una acción— y el importe también, que
 * es lo que el camarero compara con el efectivo.
 *
 * n1-hosteleria-2 · los dos renglones estaban a **10 y 12 px**, por
 * debajo del suelo de R4, y suben a **15**. Verticalmente sobra:
 * 15 + 2 de hueco + 15 = 32 px de tinta en un botón de 56.
 *
 * Horizontalmente no sobra, y es lo que fija
 * `LONGEST_TABLE_AMOUNT_MANO`: con `bottom` 6, el margen de cuerda de 4
 * y el relleno lateral bajado a 2,
 *
 *   ancho útil           = cuerda(10, 88) − 4 = 85,70 − 4 = 81,70
 *   8 caracteres a 15 px = 72,63 + 2 · 2 = 76,63  →  5,07 de margen
 *   9 caracteres a 15 px = 81,71 + 2 · 2 = 85,71  →  NO entra
 *
 * Lo mide `n1-sala-de-mano.test.ts`, no este comentario.
 */
export const COBRAR_HEIGHT_MANO = MIN_TOUCH_PX;
export const COBRAR_BOTTOM_MANO = 6;
/**
 * El importe DENTRO del botón de cobro de la forma pequeña.
 *
 * n1-hosteleria-2 · sube de 12 al suelo de R4 (`SUELO_LETRA_MANO_PX`), y
 * con él la palabra «Cobrar», que estaba a 10. Es el dato que el camarero
 * compara con el efectivo que le dan: si hay un número en esta pantalla
 * que no puede estar por debajo del suelo, es éste.
 *
 * Lo que cuesta está contado en `LONGEST_TABLE_AMOUNT_MANO`: el peor
 * importe del botón pasa a ser de 8 caracteres y no de 9, porque la
 * cuerda del círculo a la altura del botón da 81,70 px de ancho útil y
 * nueve caracteres a 15 px piden 81,71. No hay sitio donde ponerlo que
 * gane esos 9 px — la cuerda es máxima en el centro, y ahí el botón se
 * come el nombre.
 *
 * El relleno lateral baja de 4 a 2 por lo mismo: son 4 px de los 81,70,
 * y el botón ya está separado del borde por los 4 px de
 * `COBRAR_MARGEN_MANO.circulo`.
 */
export const COBRAR_AMOUNT_FONT_PX_MANO = SUELO_LETRA_MANO_PX;
/** Relleno lateral del botón en la mano. Ver `COBRAR_AMOUNT_FONT_PX_MANO`. */
export const COBRAR_PADDING_X_MANO = 2;

/**
 * Ancho máximo del botón «Cobrar» dentro de la forma.
 *
 * En Salón y Reservados es el lado menos un margen. En Barra y Terraza
 * —que son círculos— es la CUERDA a la altura del centro del botón: un
 * círculo de 144 px mide 144 en su eje pero mucho menos a 36 px del
 * borde, y ahí es donde el botón se apoya.
 */
export function cobrarMaxWidth(
  zone: TableZone,
  lado: number = TABLE_SHAPE_SIZE,
  // n1-hosteleria · la geometría del botón entra por parámetro porque en
  // la mano es 44/8 y no 36/18. Los valores por defecto son los del
  // terminal, así que no se mueve nada de v2-H1.
  alto: number = COBRAR_HEIGHT,
  desdeAbajo: number = COBRAR_BOTTOM,
  // En la forma de 88 los márgenes de v2-H1 (16 en el rectángulo, 8 en
  // el círculo) se llevan un 18% del ancho útil. A 88 px bastan la mitad
  // y siguen separando el botón del borde.
  margen: { recto: number; circulo: number } = { recto: 16, circulo: 8 },
): number {
  if (TABLE_SHAPE_RADIUS[zone] < TABLE_SHAPE_SIZE / 2) {
    return lado - margen.recto;
  }
  const centroDelBoton = desdeAbajo + alto / 2;
  const offset = lado / 2 - centroDelBoton;
  return Math.floor(roundTableChordWidth(offset, lado) - margen.circulo);
}

/** Los márgenes del botón de cobro en la forma pequeña. */
export const COBRAR_MARGEN_MANO = { recto: 8, circulo: 4 };

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
  zonePadding,
  deMano = false,
  cabecera,
  plegada = false,
}: {
  tables: ApiTable[];
  renderCard: (t: ApiTable) => ReactNode;
  zonePadding: number;
  /** n1-hosteleria-2 · la cabecera plegable. Ver `ZoneFrame`. */
  cabecera?: ReactNode;
  plegada?: boolean;
  /**
   * n1-hosteleria · el mostrador se queda —es lo que da identidad a la
   * zona— pero COMPACTO: 14 px de alto y `mb-2.5` en vez de 22 y `mb-4`.
   * El bloque lo pide así («la Barra mantiene el mostrador dibujado,
   * pero compacto») y son 18 px menos por delante de la primera fila de
   * taburetes, que en 529 px de alto útil es casi un cuarto de mesa.
   */
  deMano?: boolean;
}) {
  const sorted = tables
    .slice()
    .sort((a, b) => (a.barSeatIndex ?? 0) - (b.barSeatIndex ?? 0));
  return (
    <ZoneFrame
      label={ZONE_LABEL.BARRA.toUpperCase()}
      zonePadding={zonePadding}
      cabecera={cabecera}
      plegada={plegada}
      extraTop={
        <div
          data-testid="bar-counter"
          className={`rounded-[11px] ${deMano ? "mb-2.5" : "mb-4"}`}
          style={{
            height: deMano ? 14 : 22,
            background: BAR_COUNTER_FILL,
          }}
        />
      }
    >
      <RoomGrid>{sorted.map(renderCard)}</RoomGrid>
    </ZoneFrame>
  );
}

/**
 * n1-hosteleria-2 · hallazgo 2 · LA CABECERA DE UNA ZONA PLEGABLE.
 *
 * Un objetivo de `MIN_TOUCH_PX` a todo el ancho del marco con el nombre
 * de la zona, lo que hay dentro y el signo de plegado.
 *
 * **48 px, los del hallazgo, y aquí la casa pierde.** A todo lo demás
 * este bloque le ha dado `MIN_TOUCH_PX` = 56 (la X de la comanda, el
 * botón de cobro, la etiqueta LISTO), pero esta franja se mide tres
 * veces en la pantalla y a 56 **cuesta tres mesas**: BARRA se lleva tres
 * filas de 88 y deja a SALÓN asomando justo en el límite, así que 8 px
 * por zona empujan su primera fila fuera. R3 pide ≥ 48 y 48 cumple R3.
 * La cuenta está en `CABECERA_DE_ZONA_PX`.
 *
 * El rótulo de la zona va SIEMPRE a la izquierda y en el mismo sitio,
 * plegada o desplegada: es lo que permite recorrer la sala con el pulgar
 * sin leer. Lo que cambia a la derecha es el resumen, y sólo cuando está
 * plegada — desplegada, lo que hay dentro ya se ve.
 */
function ZoneHeader({
  zona,
  label,
  plegada,
  resumen,
  onAlternar,
}: {
  zona: string;
  label: string;
  plegada: boolean;
  resumen: ResumenDeZona;
  onAlternar: () => void;
}) {
  return (
    <button
      type="button"
      data-testid="zone-header"
      data-zone={zona}
      data-plegada={plegada ? "true" : "false"}
      onClick={onAlternar}
      aria-expanded={!plegada}
      aria-label={`${label} · ${rotuloDeZonaPlegada(resumen)} · ${
        plegada ? "desplegar" : "plegar"
      }`}
      className={`w-full flex items-center gap-3 rounded-[16px] px-4 ${PRESS_FEEDBACK_CLASS}`}
      style={{
        height: CABECERA_DE_ZONA_PX,
        background: DARK_SURFACE,
        color: DARK_TEXT_SOFT,
      }}
    >
      {/* El signo, y no un icono: una punta de flecha de 16 px en una
          fila de 56 es lo que el camarero mira para saber si lo que no
          ve es que no hay o que está plegado. */}
      <span
        className="shrink-0 font-bold"
        style={{ fontSize: 15, color: DARK_TEXT_MUTED, lineHeight: 1 }}
        aria-hidden
      >
        {plegada ? "▸" : "▾"}
      </span>
      <span
        className="shrink-0 font-semibold"
        style={{
          fontSize: SUELO_LETRA_MANO_PX + 2,
          letterSpacing: "-0.01em",
        }}
      >
        {label}
      </span>
      {/* Plegada dice lo que hay dentro; desplegada, nada: se ve. */}
      {plegada && (
        <span
          data-testid="zone-header-resumen"
          className="flex-1 min-w-0 truncate text-right"
          style={{ fontSize: SUELO_LETRA_MANO_PX, color: DARK_TEXT_MUTED }}
        >
          {rotuloDeZonaPlegada(resumen)}
        </span>
      )}
    </button>
  );
}

/** Un punto de la leyenda. */
function LegendDot({
  fill,
  ring,
  dashed,
  label,
}: {
  fill: string;
  ring?: string;
  /** auditoria-sirope (#16) · el aro de «+45 min» es discontinuo, y la
   *  leyenda tiene que enseñarlo igual que la mesa. */
  dashed?: boolean;
  label: string;
}) {
  return (
    <span className="flex items-center gap-2">
      <span
        className="w-3.5 h-3.5 rounded-[4px] shrink-0"
        style={{
          background: fill,
          ...(ring
            ? dashed
              ? { outline: `2px dashed ${ring}`, outlineOffset: 2 }
              : { boxShadow: `0 0 0 3px ${ring}` }
            : {}),
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

/**
 * auditoria-sirope (#14) · «hace 7 min», desde que se cobró.
 *
 * Minutos y no una hora: lo que se pregunta mirando una mesa sin
 * recoger es cuánto lleva así, no a qué hora fue. Y se redondea a
 * minutos porque los segundos en un mapa de sala son ruido que cambia
 * solo.
 */
function minutosDesde(iso: string | null | undefined): string {
  if (!iso) return "hace un momento";
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 60_000) return "hace menos de 1 min";
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  return `hace ${h} h ${min % 60} min`;
}
