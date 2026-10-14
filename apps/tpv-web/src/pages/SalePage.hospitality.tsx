// v2-H1-venta-y-sala · la pantalla de venta de HOSTELERÍA, en oscuro.
//
// Es un componente HERMANO de `SaleWorkspace`, no una rama dentro de él.
// La razón es la restricción más dura del bloque: **RETAIL y SERVICES no
// cambian**. Thalía, Cachictos y Sole usan la misma `SalePage`, y un
// `if (isHospitality)` repartido por las 800 líneas de `SaleWorkspace`
// es exactamente la forma de que un retoque en la venta del bar le mueva
// la pantalla a una peluquería seis meses después. Con dos componentes,
// el test de «RETAIL se sigue pintando en claro» es trivial y el riesgo
// de arrastre es cero.
//
// Lo que se comparte de verdad —los sheets (modificadores, línea, mover,
// partir, agrupar, cobro), el carrito, el envío a cocina— no se duplica:
// sigue viviendo en `SalePage` y llega aquí por props, con las mismas
// firmas que usa `SaleWorkspace`.
//
// EL REPARTO DE LA PANTALLA, Y POR QUÉ NO HAY BARRA SUPERIOR
//
// La maqueta revisada con Matías no tiene barra superior: la pantalla
// son dos columnas, comanda (420 px) y catálogo. Pero la barra superior
// de hoy es la puerta de nueve destinos de un toque (menú, mapa,
// búsqueda, cámara, refrescar, Tickets, Deudas, Clientes, Agenda) y el
// alcance del bloque exige que todo lo que hoy existe siga llegando «con
// el mismo número de toques o menos».
//
// Conservarla en lo alto costaba 68 px de ALTO del catálogo, y ése es un
// presupuesto que no da: a 1280 × 800 la cuadrícula bajaría de siete
// filas a seis, la capacidad de 35 a 30 productos, y **los 31 Licores de
// La Maestranza dejarían de caber** — justo el caso que §3b prohíbe
// paginar. Medido con `hospitalityGrid`, no estimado.
//
// Así que la barra se va DENTRO de la comanda, como segunda fila de su
// cabecera: el coste sale de la lista de líneas, que es flexible y
// sobra (512 px para ocho o nueve líneas), y no del catálogo, que es
// donde el requisito es duro. «Mapa» es la flecha de volver de la
// maqueta, que es un toque igual que hoy.
//
// Los banners de salud (`Sincronizando…`, `Sin conexión`) van por el
// mismo camino y por el mismo motivo: a ancho completo costaban otros
// ~40 px del catálogo y habrían roto el mismo requisito justo cuando se
// cae la red. Dentro de la comanda quedan a la altura de los ojos, bajo
// el nombre de la mesa.

import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { ChevronLeft, X } from "lucide-react";

import type { CartLine } from "../lib/cart.js";
import type { CatalogProduct } from "../lib/catalog.js";
import { formatEur } from "../lib/money.js";
import {
  gridHeight,
  gridShapeFor,
  gridWidth,
  maxGridRows,
  FAMILY_BAR_COLUMNS,
  FAMILY_BAR_COLUMNS_HANDHELD,
  GRID_GAP,
  PRODUCT_COLUMNS_HANDHELD,
} from "../lib/hospitalityGrid.js";
import {
  CORAL,
  COBRAR_HEIGHT_PX,
  COBRAR_LABEL_PX,
  DARK_CANVAS,
  DARK_LINE_HIGHLIGHT,
  DARK_ON_CORAL,
  DARK_PANEL,
  DARK_QTY_BADGE,
  DARK_SURFACE,
  DARK_SURFACE_KEY,
  DARK_SURFACE_RAISED,
  DARK_TEXT,
  DARK_TEXT_MUTED,
  DARK_TEXT_SOFT,
  ENVIAR_HEIGHT_PX,
  ENVIAR_LABEL_PX,
  EYEBROW_PX,
  EYEBROW_TRACKING,
  FAMILY_BUTTON_PX,
  FAMILY_LABEL_PX,
  FAMILY_TEXT,
  MIN_TOUCH_PX,
  ORDER_PANEL_WIDTH,
  PENDING_LINE_AMOUNT_PX,
  PENDING_LINE_NAME_PX,
  PENDING_LINE_QTY_PX,
  PRESS_FEEDBACK_CLASS,
  QTY_KEY_HEIGHT_PX,
  QTY_KEY_WIDTH_PX,
  TOTAL_PX,
  familyFillFor,
  type FamilyTone,
} from "../lib/hospitalityTheme.js";
import {
  etiquetaEnCocina,
  partirComanda,
  puedeCorregirEnviado,
  sillaDeLinea,
  tiempoDeLinea,
  tiemposPorMarchar,
  unidadesEnCocina,
  type EstadoCocinaMesa,
} from "../lib/kitchenComanda.js";
import {
  AccionesCocina,
  ChipsDeLinea,
  FilaDeTiempos,
  SentLineCocina,
} from "../kitchen/tpv/ComandaCocina.js";
import {
  DeshacerToast,
  type AnulacionPendiente,
} from "../kitchen/tpv/DeshacerToast.js";
import { ListoBanner, type AvisoListo } from "../kitchen/tpv/ListoBanner.js";

/**
 * La fila «Cantidad» va de 1 a 6 (decisión 3c).
 *
 * Seis y no nueve: el prompt lo fija, y la cuenta lo sostiene — a 64 px
 * por tecla, seis teclas más el rótulo «CANTIDAD» caben en una fila de
 * la columna del catálogo sin comerle ancho a la cuadrícula. Más de seis
 * unidades del mismo producto es una ronda, y para eso está el `+` de la
 * línea, que no tiene techo.
 */
export const QUANTITIES = [1, 2, 3, 4, 5, 6] as const;

/**
 * ¿Estamos en handheld (< `sm`)?
 *
 * Hace falta en JS y no sólo en CSS porque el número de columnas de la
 * barra de familias y de la cuadrícula entra por `grid-template-columns`
 * calculado: el JIT de Tailwind no compila `grid-cols-${n}` y el reparto
 * de la cuadrícula es dinámico por definición (depende de cuántos
 * productos tenga la familia).
 *
 * Con `matchMedia` y su listener, no con `window.innerWidth` leído en el
 * render: leído en el render, girar la tablet o abrir el teclado del
 * sistema no vuelve a pintar y la rejilla se queda con las columnas del
 * tamaño anterior. `ux-principles` §3.6 pide justamente que la pantalla
 * se reorganice sola al cambiar de orientación.
 *
 * `matchMedia` puede no existir (jsdom sin stub): ahí se asume terminal,
 * que es el caso para el que están medidos los números.
 */
function useIsHandheld(): boolean {
  const [handheld, setHandheld] = useState(() => {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia("(max-width: 639px)").matches;
  });
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(max-width: 639px)");
    const onChange = (e: MediaQueryListEvent) => setHandheld(e.matches);
    setHandheld(mq.matches);
    // `addEventListener` sobre MediaQueryList existe desde Chrome 39, así
    // que el WebView 101 del D8 lo tiene de sobra; el `addListener`
    // legacy no hace falta.
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return handheld;
}

/** Una acción de la barra de chrome que vive dentro de la comanda. */
export interface ChromeAction {
  key: string;
  /** Rótulo accesible. En esta barra los botones son sólo icono. */
  label: string;
  icon: ReactNode;
  onClick: () => void;
  /** El refresco de catálogo gira mientras trabaja. */
  spinning?: boolean;
}

export interface HospitalityWorkspaceProps {
  /** Productos ya filtrados por la búsqueda. */
  products: CatalogProduct[];
  searchQuery: string;
  catalogError: string | null;
  lines: CartLine[];
  totals: { total: number; itemCount: number };
  tableName: string | null;
  tableMeta: string | null;
  /** Las familias del catálogo, en el orden en que se pintan. */
  families: string[];
  familyLabels: Record<string, string>;
  familyTones: Record<string, FamilyTone>;
  /** De qué familia es un producto. UNA sola regla, compartida. */
  familyOf: (p: CatalogProduct) => string;
  /** Los 20 de «Ahora», ya resueltos contra el catálogo local. */
  ahora: CatalogProduct[];
  /**
   * kds-1-cocina · EL ESTADO DE COCINA DE ESTA MESA, tal como lo dice el
   * servidor.
   *
   * Sustituye a `sentLineIds` de v2-H1, que era un conjunto de ids en
   * `localStorage` porque `TicketLine` no tenía marca de envío. Ahora la
   * verdad es `TicketLine.sentUnits` y viene de la API, así que dos
   * terminales ven lo mismo y recargar no inventa nada.
   *
   * Va SIEMPRE, también con el módulo «Cocina» apagado: el envío por
   * diferencias es un arreglo del servidor y aplica igual. Lo que el
   * módulo enciende es `enabled`.
   */
  kitchen: ComandaCocinaWiring;
  /** ISO del último envío con éxito, para el rótulo «EN COCINA · hh:mm». */
  lastSentAt: string | null;
  lastTouchedLine: { id: string; nonce: number } | null;
  /** La barra de destinos que la maqueta no tiene sitio para pintar arriba. */
  chromeActions: ChromeAction[];
  /** Banners de salud y de red. Se pintan dentro de la comanda. */
  banners: ReactNode;
  /**
   * El campo de búsqueda. Llega montado desde `SalePage` porque es el
   * mismo input que el TPV claro: plegado vive fuera de cuadro con
   * `inputMode="none"` y es donde aterriza el lector USB-HID (N1 de
   * v1.22). Si esta pantalla no lo montara, la venta del bar perdería
   * el lector y la protección del teclado del sistema.
   */
  searchField: ReactNode;
  onBackToMap: (() => void) | null;
  onClickProduct: (p: CatalogProduct, units: number) => void;
  onClickLine: (line: CartLine) => void;
  onUpdateLineUnits: (id: string, units: number) => void;
  onRemoveLine: (id: string) => void;
  onClickCheckout: () => void;
  onSendToKitchen: () => void;
  kitchenBusy: boolean;
  kitchenLastRevision: number;
}

/**
 * kds-1-cocina · todo lo que la cocina añade a la comanda, en un objeto.
 *
 * En uno y no en catorce props sueltas porque son catorce cosas que se
 * mueven juntas, y porque con el módulo apagado lo que se apaga es el
 * objeto entero: `enabled: false` deja la comanda como la dejó v2-H1,
 * salvo que lo enviado sale de `sentUnits` y no de `localStorage`.
 *
 * Lo que NO depende de `enabled`: las **alergias** y la **silla** del
 * plato. La decisión 10 las pone de serie en todo TPV de hostelería porque
 * informar de alérgenos es una obligación legal, no una función que se
 * vende. Sin pantalla, la alergia sale en el papel de la comanda.
 */
export interface ComandaCocinaWiring {
  /** `Tenant.kitchenDisplayEnabled`. */
  enabled: boolean;
  estado: EstadoCocinaMesa;
  courseMode: "ESPERA" | "TIEMPOS";
  seatMode: "ALERGIA" | "SIEMPRE";
  /** El tiempo elegido en la fila del modo «Por tiempos». Se queda puesto. */
  courseElegido: number;
  onCourseElegido: (course: number) => void;
  urgentePendiente: boolean;
  onUrgentePendiente: () => void;
  onMarchar: (course: number) => void;
  onSilla: (lineId: string, seat: number | null) => void;
  onTiempo: (lineId: string, course: number) => void;
  /** El `−` de una línea YA ENVIADA. Arranca el «Deshacer» de 5 s. */
  onAnularEnviado: (lineId: string, nombre: string, units: number) => void;
  onAbrirAlergias: () => void;
  /** Las bandas «M4 · listo para servir», y el toque que marca «Servido». */
  avisosListo: AvisoListo[];
  onServido: (orderId: string) => void;
  /** Las anulaciones dentro de su ventana de 5 s, con su «Deshacer». */
  anulaciones: AnulacionPendiente[];
  onDeshacer: (key: string) => void;
  /** Decisión 9 · alguna sección tiene pantalla y la pantalla no responde. */
  cocinaNoRecibe: boolean;
  /** `Store.kitchenReadyBeep`. Apagado de serie (decisión 8). */
  readyBeep: boolean;
}

/**
 * La vista elegida. `null` = «Ahora», que es la que abre por defecto
 * (decisión 4). **No hay vista «Todos»**: familia primero, producto
 * después, como todos los TPV de bar.
 */
type View = { kind: "ahora" } | { kind: "family"; tag: string };

export function HospitalityWorkspace(props: HospitalityWorkspaceProps) {
  // «Ahora» abre por defecto. Es un `useState` con inicial fijo y no un
  // efecto: con un efecto habría un primer pintado con otra vista y la
  // pantalla parpadearía al entrar en cada mesa.
  const [view, setView] = useState<View>({ kind: "ahora" });
  const handheld = useIsHandheld();
  // Handheld: la comanda vive en un bottom-sheet. Cerrarlo no toca nada
  // —las líneas viven en `SalePage`—, así que es sólo abierto/cerrado.
  const [sheetOpen, setSheetOpen] = useState(false);

  // Decisión 3c · la cantidad se elige ANTES del producto y **vuelve a 1
  // tras cada producto**. Que vuelva sola es el requisito: un «3» pegado
  // convierte el siguiente café en tres cafés sin que nadie lo haya
  // pedido, y eso se descubre al cobrar.
  const [qty, setQty] = useState(1);

  // Si la familia elegida desaparece del catálogo (el propietario la
  // borró en Holded y llegó un sync), se vuelve a «Ahora» en vez de
  // dejar una rejilla vacía.
  useEffect(() => {
    if (view.kind === "family" && !props.families.includes(view.tag)) {
      setView({ kind: "ahora" });
    }
  }, [view, props.families]);

  // Con búsqueda activa manda la búsqueda: `products` ya llega filtrado
  // y filtrar además por familia dejaría «no hay resultados» con el
  // producto a la vista en otra familia.
  const searching = props.searchQuery.trim().length > 0;

  const visibleProducts = useMemo(() => {
    if (searching) return props.products;
    if (view.kind === "ahora") return props.ahora;
    return props.products.filter((p) => props.familyOf(p) === view.tag);
  }, [searching, props.products, props.ahora, view, props.familyOf]);

  // Decisión 6 · la cantidad va DENTRO del botón del producto mientras
  // esté en la comanda de esta mesa, enviada o sin enviar. Se suman las
  // unidades de todas las líneas de ese producto: dos cafés en una línea
  // y uno en otra (con modificador distinto) son «×3» en el botón,
  // porque lo que el camarero comprueba es cuántos lleva la mesa.
  const unitsByProduct = useMemo(() => {
    const map = new Map<string, number>();
    for (const l of props.lines) {
      if (!l.productId) continue;
      map.set(l.productId, (map.get(l.productId) ?? 0) + l.units);
    }
    return map;
  }, [props.lines]);

  // El reparto de la cuadrícula se calcula sobre la caja REAL, medida en
  // el navegador, y cae a la aritmética de 1280 × 800 cuando no hay
  // medida (primer render, jsdom). Mismo patrón que la fila de chips de
  // v1.14: sin medida, el número del test y el de la pantalla podrían
  // separarse sin que nada se pusiera rojo.
  const gridRef = useRef<HTMLDivElement | null>(null);
  const [gridBox, setGridBox] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    const el = gridRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (!r) return;
      setGridBox((prev) =>
        prev && Math.abs(prev.w - r.width) < 1 && Math.abs(prev.h - r.height) < 1
          ? prev
          : { w: r.width, h: r.height },
      );
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const familyButtonCount = props.families.length + 1; // +1 por «Ahora»
  const shape = useMemo(
    () =>
      gridShapeFor(
        visibleProducts.length,
        gridBox?.w ?? gridWidth(1280),
        gridBox?.h ?? gridHeight(800, familyButtonCount),
      ),
    [visibleProducts.length, gridBox, familyButtonCount],
  );

  // Las filas que se pintan de verdad: nunca más de las que caben con el
  // mínimo de 64 px. `gridShapeFor` ya lo calcula, pero el componente lo
  // vuelve a acotar contra la caja MEDIDA, que es la que manda sobre el
  // papel.
  const paintedRows = Math.max(
    1,
    Math.min(
      shape.rows,
      maxGridRows(gridBox?.h ?? gridHeight(800, familyButtonCount)),
    ),
  );

  // kds-1-cocina · la comanda se parte POR UNIDADES y no por líneas: una
  // misma línea puede estar con 2 unidades en «EN COCINA» y 1 en «SIN
  // ENVIAR», que es lo que la decisión 6 pide leer («2 en cocina + 1 sin
  // enviar») y lo que hace que cada mitad se corrija distinto.
  const { sent, pending } = partirComanda(props.lines, props.kitchen.estado);

  return (
    <div
      data-testid="hospitality-workspace"
      data-theme="dark"
      className="flex-1 min-h-0 flex flex-col lg:flex-row font-sans"
      style={{ background: DARK_CANVAS, color: DARK_TEXT }}
    >
      {/* ── La comanda ──────────────────────────────────────────────────
          En terminal es la columna izquierda. En handheld NO: ahí el
          catálogo va primero y la comanda vive en el bottom-sheet que
          abre la barra inferior, igual que en el TPV claro desde
          v1.0-handheld. Con la comanda arriba y a ancho completo, añadir
          un producto obligaba a bajar a la rejilla y volver a subir para
          ver el total — y la barra inferior con el total siempre a la
          vista es lo que v1.0-handheld puso ahí para evitarlo. */}
      {!handheld && <Comanda {...props} sent={sent} pending={pending} />}

      {/* ── El catálogo ─────────────────────────────────────────────── */}
      <div className="flex-grow min-w-0 flex flex-col p-4 gap-3.5 box-border min-h-0">
        {/* En handheld la cabecera y el buscador viven AQUÍ y no en la
            comanda: la comanda es una hoja que arranca cerrada, y dentro
            quedarían encerrados la flecha de volver a la sala, la lupa y
            —lo más grave— el campo donde aterriza el lector USB-HID con
            su `inputMode="none"` (N1 de v1.22). Plegado, el campo está
            fuera de cuadro y no cuesta ni un píxel. */}
        {handheld && (
          <div className="shrink-0 -mx-4 -mt-4">
            <ComandaHeader {...props} />
          </div>
        )}
        {handheld && props.searchField}
        {/* Barra de familias. «Ahora» PRIMERO y sin vista «Todos». */}
        <div
          data-testid="family-bar"
          data-columns={handheld ? FAMILY_BAR_COLUMNS_HANDHELD : FAMILY_BAR_COLUMNS}
          className="shrink-0 grid gap-2"
          style={{
            gridTemplateColumns: `repeat(${
              handheld ? FAMILY_BAR_COLUMNS_HANDHELD : FAMILY_BAR_COLUMNS
            }, minmax(0, 1fr))`,
          }}
        >
          <FamilyButton
            label="Ahora"
            active={view.kind === "ahora"}
            special
            onClick={() => setView({ kind: "ahora" })}
          />
          {props.families.map((tag) => (
            <FamilyButton
              key={tag}
              label={props.familyLabels[tag] ?? tag}
              fill={familyFillFor(tag, props.familyTones)}
              active={view.kind === "family" && view.tag === tag}
              onClick={() => setView({ kind: "family", tag })}
            />
          ))}
        </div>

        <div
          className="h-px shrink-0"
          style={{ background: DARK_SURFACE_RAISED }}
        />

        {/* Decisión 3c · la cantidad va ENTRE las familias y los
            productos. Ahí es donde la mano ya está: se toca la familia,
            se toca el número, se toca el producto. Debajo de la
            cuadrícula obligaría a subir y bajar. */}
        {/* La fila de cantidad.
            En el terminal es una fila: rótulo, seis teclas de 64 × 56 y
            la pista. En handheld NO cabe —seis teclas de 56 más sus
            huecos piden 376 px y a 390 hay 358, y a 320 (el suelo del
            bucle visual) hay 288—, así que pasa a una rejilla de TRES
            columnas y dos filas, con la tecla llenando su celda. El
            rótulo y la pista se van: en una pantalla estrecha el sitio
            es para las teclas, y los números del 1 al 6 encima de la
            cuadrícula no necesitan que les pongan nombre.
            Lo encontró el bucle visual: las teclas 5 y 6 se salían de la
            pantalla por la derecha, que es scroll horizontal y está
            prohibido por `ux-principles` §1.8. */}
        <div
          data-testid="qty-row"
          data-columns={handheld ? 3 : 6}
          className={
            handheld
              ? "shrink-0 grid grid-cols-3 gap-2"
              : "shrink-0 flex items-center gap-2"
          }
          style={handheld ? undefined : { height: QTY_KEY_HEIGHT_PX }}
        >
          {!handheld && (
            <span
              className="font-medium mr-1.5 shrink-0"
              style={{
                fontSize: EYEBROW_PX,
                letterSpacing: EYEBROW_TRACKING,
                color: DARK_TEXT_MUTED,
              }}
            >
              CANTIDAD
            </span>
          )}
          {QUANTITIES.map((n) => {
            const active = qty === n;
            return (
              <button
                key={n}
                type="button"
                onClick={() => setQty(n)}
                aria-pressed={active}
                data-testid="qty-key"
                data-qty={n}
                className={`shrink-0 rounded-xl border-0 font-semibold tabular-nums ${PRESS_FEEDBACK_CLASS}`}
                style={{
                  // En handheld la tecla llena su celda; en el terminal
                  // mide los 64 px de la maqueta. Nunca por debajo del
                  // suelo táctil: a 320 px, un tercio de la fila son 93.
                  width: handheld ? "100%" : QTY_KEY_WIDTH_PX,
                  minWidth: MIN_TOUCH_PX,
                  height: QTY_KEY_HEIGHT_PX,
                  fontSize: 22,
                  background: active ? DARK_TEXT : DARK_SURFACE,
                  color: active ? DARK_CANVAS : DARK_TEXT_SOFT,
                }}
              >
                {n}
              </button>
            );
          })}
          {!handheld && (
            <span
              className="ml-2.5 hidden xl:inline"
              style={{ fontSize: 15, color: DARK_TEXT_MUTED }}
            >
              toca el número y luego el producto · vuelve a 1
            </span>
          )}
        </div>

        {/* La cuadrícula. §3b · NUNCA paginación: ni páginas, ni flechas,
            ni «Más (N)», ni scroll dentro de la rejilla. El reparto se
            adapta al número de productos y lo decide `gridShapeFor`. */}
        <div
          ref={gridRef}
          data-testid="product-grid"
          data-columns={shape.columns}
          data-rows={shape.rows}
          data-fits={shape.fits ? "true" : "false"}
          className="flex-grow min-h-0 grid"
          style={{
            gap: GRID_GAP,
            gridTemplateColumns: `repeat(${
              handheld ? PRODUCT_COLUMNS_HANDHELD : shape.columns
            }, minmax(0, 1fr))`,
            // Filas FRACCIONARIAS y explícitas, como la maqueta
            // (`repeat(5, minmax(0, 1fr))`).
            //
            // La primera versión usaba `gridAutoRows: minmax(Npx, 1fr)`
            // con la N que salía del reparto, y el bucle visual la pilló:
            // ese `minmax` tiene un SUELO, así que cuando la caja medida
            // y la caja real discrepaban aunque fuera por unos píxeles,
            // la rejilla crecía por encima de su contenedor y la última
            // fila quedaba cortada por el borde de la pantalla. Medido a
            // 1443 × 812: «Agua» y «Rioja» partidas a la altura del
            // viewport.
            //
            // Con `1fr` las filas se reparten EXACTAMENTE el alto que
            // haya, así que no hay forma de desbordar. Que ese alto no
            // baje de 64 px no lo garantiza el CSS: lo garantiza
            // `gridShapeFor`, que es quien decide cuántas filas caben —y
            // quien dice `fits: false` cuando no caben—.
            gridTemplateRows: handheld
              ? undefined
              : `repeat(${paintedRows}, ${shape.cardHeight}px)`,
            gridAutoRows: handheld ? `minmax(${shape.cardHeight}px, auto)` : undefined,
            // Las filas se pegan ARRIBA. Con el alto acotado, una familia
            // de cuatro productos deja hueco abajo en vez de repartirlo:
            // centrado, la rejilla «flotaría» y el primer botón cambiaría
            // de sitio al cambiar de familia, que es justo lo que rompe
            // el reconocimiento por posición.
            alignContent: handheld ? undefined : "start",
          }}
        >
          {visibleProducts.map((p) => (
            <ProductButton
              key={p.id}
              product={p}
              fill={familyFillFor(props.familyOf(p), props.familyTones)}
              nameSizePx={shape.nameSizePx}
              units={unitsByProduct.get(p.id) ?? 0}
              onClick={() => {
                props.onClickProduct(p, qty);
                // Vuelve a 1 SIEMPRE, incluso si el producto abre el
                // modal de modificadores: la cantidad ya viajó con la
                // intención y dejarla puesta es el fallo que el sabotaje
                // «la cantidad no vuelve a 1» describe.
                setQty(1);
              }}
            />
          ))}
          {visibleProducts.length === 0 && (
            <p
              className="col-span-full self-start py-8"
              style={{ fontSize: 16, color: DARK_TEXT_MUTED }}
            >
              {props.catalogError
                ? props.catalogError
                : searching
                  ? `Sin resultados para «${props.searchQuery.trim()}».`
                  : "Esta familia no tiene productos."}
            </p>
          )}
        </div>
      </div>

      {/* ── Handheld: barra inferior + bottom-sheet ──────────────────────
          Lo que v1.0-handheld puso en el TPV claro, en oscuro y con lo
          que este bloque añade: el número de líneas, el total siempre a
          la vista y «Comanda» en contexto mesa. Sin esto, en un móvil
          había que bajar a la rejilla para marcar y volver a subir para
          ver cuánto llevaba la mesa.

          Sólo se monta en handheld, así que la comanda existe UNA vez en
          el árbol: o como columna o como hoja, nunca las dos. */}
      {handheld && (
        <>
          <div
            data-testid="handheld-bar"
            className="fixed inset-x-0 z-40 px-3 py-2 flex items-center gap-2 border-t"
            style={{
              bottom: "var(--keyboard-offset, 0px)",
              background: DARK_PANEL,
              borderColor: DARK_SURFACE_RAISED,
            }}
          >
            {props.onBackToMap && (
              <button
                type="button"
                onClick={props.onSendToKitchen}
                disabled={props.lines.length === 0 || props.kitchenBusy}
                className={`shrink-0 px-3.5 rounded-2xl border font-semibold disabled:opacity-40 ${PRESS_FEEDBACK_CLASS}`}
                style={{
                  height: MIN_TOUCH_PX,
                  fontSize: 15,
                  borderColor: "#3A404A",
                  background: "transparent",
                  color: DARK_TEXT,
                }}
              >
                {props.kitchenBusy
                  ? "Enviando…"
                  : props.kitchenLastRevision > 0
                    ? "Reenviar"
                    : "Comanda"}
              </button>
            )}
            <button
              type="button"
              onClick={() => setSheetOpen(true)}
              aria-label="Abrir la comanda"
              className={`flex-1 min-w-0 rounded-2xl flex items-center justify-between px-4 ${PRESS_FEEDBACK_CLASS}`}
              style={{
                height: MIN_TOUCH_PX,
                background: CORAL,
                color: DARK_ON_CORAL,
              }}
            >
              <span className="font-medium truncate" style={{ fontSize: 15 }}>
                {props.tableName ? `${props.tableName} · ` : ""}
                {props.lines.length}{" "}
                {props.lines.length === 1 ? "línea" : "líneas"}
              </span>
              <span
                className="font-semibold tabular-nums"
                style={{ fontSize: 20 }}
              >
                {formatEur(props.totals.total)}
              </span>
            </button>
          </div>
          {/* Hueco para que la barra fija no tape la última fila. */}
          <div className="h-20 shrink-0" aria-hidden />
          {sheetOpen && (
            <div className="fixed inset-0 z-40">
              <div
                className="absolute inset-0"
                style={{ background: "rgba(0,0,0,0.55)" }}
                onClick={() => setSheetOpen(false)}
              />
              <div
                role="dialog"
                aria-modal="true"
                aria-label="Comanda"
                className="absolute inset-x-0 bottom-0 max-h-[88dvh] rounded-t-3xl flex flex-col overflow-hidden"
                style={{
                  background: DARK_PANEL,
                  paddingBottom: "var(--keyboard-offset, 0px)",
                }}
              >
                <div className="flex items-center justify-between px-4 pt-3 pb-1 shrink-0">
                  <span className="w-11" aria-hidden />
                  <span
                    className="h-1.5 w-10 rounded-full"
                    style={{ background: DARK_SURFACE_KEY }}
                    aria-hidden
                  />
                  <button
                    type="button"
                    onClick={() => setSheetOpen(false)}
                    aria-label="Cerrar la comanda"
                    className="h-11 w-11 rounded-xl flex items-center justify-center"
                    style={{ color: DARK_TEXT_MUTED }}
                  >
                    <X className="w-4 h-4" strokeWidth={2.25} />
                  </button>
                </div>
                <Comanda {...props} sent={sent} pending={pending} inSheet />
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/**
 * El importe bruto de una línea.
 *
 * Se calcula aquí y no se recibe para que la comanda no dependa de que
 * alguien le pase un total por línea: `units × priceGross` con el
 * descuento de la línea es lo que el panel claro ya pinta, y es lo que
 * el camarero compara contra la carta.
 */
function lineGross(l: CartLine): number {
  const unit =
    l.unitPriceOverride != null
      ? l.unitPriceOverride * (1 + l.taxRate / 100)
      : l.priceGross;
  const deltas = (l.modifierSelections ?? []).reduce(
    (s, m) => s + m.priceDeltaCents / 100,
    0,
  );
  return (unit + deltas) * l.units * (1 - l.discountPct / 100);
}

/**
 * Un botón de familia.
 *
 * Decisión 3 · **relleno del color de su familia en TODO el botón**, no
 * una raya de 4 px. La activa se marca con un ARO y no cambiando el
 * relleno: si la selección cambiara el color, el camarero perdería la
 * única pista que tiene para encontrar la familia sin leer.
 */
function FamilyButton({
  label,
  fill,
  active,
  special,
  onClick,
}: {
  label: string;
  fill?: string;
  active: boolean;
  /** «Ahora» es la vista especial y la única que lleva el claro/coral. */
  special?: boolean;
  onClick: () => void;
}) {
  // El aro se pinta con dos sombras: la primera del color del fondo
  // (separa el aro del relleno) y la segunda del propio relleno. Es lo
  // que hace la maqueta, y con `outline` el aro quedaría por fuera de la
  // celda del grid y se solaparía con el botón de al lado.
  const ring = active ? `0 0 0 3px ${DARK_CANVAS}, 0 0 0 6px ${
    special ? DARK_TEXT : (fill ?? DARK_TEXT)
  }` : undefined;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      data-testid="family-button"
      data-active={active ? "true" : "false"}
      className={`border-0 rounded-[14px] font-semibold cursor-pointer ${PRESS_FEEDBACK_CLASS}`}
      style={{
        height: FAMILY_BUTTON_PX,
        fontSize: FAMILY_LABEL_PX,
        background: special ? DARK_TEXT : fill,
        color: special ? DARK_CANVAS : FAMILY_TEXT,
        boxShadow: ring,
      }}
    >
      {label}
    </button>
  );
}

/**
 * Un botón de producto.
 *
 * Decisión 1 · **plano, con el color de la familia en todo el botón**.
 * Sin dibujos ni fotos: se probaron y se descartaron porque no ayudan a
 * comandar y afean. Decisión 6 · la cantidad va dentro, como `×N`,
 * mientras el producto esté en la comanda de esta mesa.
 */
function ProductButton({
  product,
  fill,
  nameSizePx,
  units,
  onClick,
}: {
  product: CatalogProduct;
  fill: string;
  nameSizePx: number;
  units: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid="product-button"
      data-product-id={product.id}
      className={`relative border-0 rounded-xl box-border flex items-center justify-between gap-2.5 text-left cursor-pointer overflow-hidden ${PRESS_FEEDBACK_CLASS}`}
      style={{
        padding: "0 16px",
        background: fill,
        color: FAMILY_TEXT,
      }}
    >
      {/* Dos líneas como máximo y elipsis. El «nombre corto de botón»
          editable es v2-H2 (lleva migración); aquí el botón usa el
          nombre actual del catálogo. */}
      <span
        data-testid="product-name"
        className="line-clamp-2 font-semibold"
        style={{
          fontSize: nameSizePx,
          lineHeight: 1.1,
          letterSpacing: "-0.01em",
        }}
      >
        {product.name}
      </span>
      {units > 0 && (
        <span
          data-testid="product-units"
          className="shrink-0 box-border rounded-[10px] flex items-center justify-center font-semibold tabular-nums"
          style={{
            minWidth: 40,
            height: 40,
            padding: "0 8px",
            background: DARK_QTY_BADGE,
            color: DARK_ON_CORAL,
            fontSize: 20,
          }}
        >
          ×{units}
        </span>
      )}
    </button>
  );
}

/**
 * Una línea «Sin enviar», con los `−` y `+` de 56 × 56 de la decisión 3d
 * («editar las cantidades sobre la lista de seleccionados… con un − y +
 * grande para un pulso de dedo»).
 *
 * El reparto de la fila, en los 388 px útiles de una comanda de 420:
 * 8 de padding + 56 + 10 + 30 de cantidad + 10 + 56 + 10 + nombre +
 * 10 + importe + 8. **El nombre se recorta con elipsis; el importe
 * nunca** — es la misma lección que v1.22 aprendió en la tarjeta de
 * mesa, donde `shrink-0` sin fila propia no recortaba sino que
 * desbordaba y el € acabó fuera de la tarjeta.
 */
function PendingLine({
  line,
  units,
  highlighted,
  onClick,
  onLess,
  onMore,
  chips,
}: {
  line: CartLine;
  /**
   * kds-1-cocina · las unidades DE ESTE TROZO, que con una línea partida
   * («2 en cocina + 1 sin enviar») no son las de la línea.
   *
   * El importe también se pinta sobre ellas: el bloque «SIN ENVIAR» tiene
   * que decir lo que cuesta lo que todavía no ha salido, no lo que cuesta
   * la línea entera — que ya está contado arriba.
   */
  units: number;
  highlighted: boolean;
  onClick: () => void;
  onLess: () => void;
  onMore: () => void;
  /** Los chips de silla y de tiempo, bajo la fila. */
  chips?: React.ReactNode;
}) {
  return (
    <div
      data-testid="comanda-linea-pendiente"
      data-line-id={line.id}
      className="rounded-[14px]"
      style={highlighted ? { background: DARK_LINE_HIGHLIGHT } : undefined}
    >
      <div className="flex items-center gap-2.5 min-h-[68px] px-2">
      {/* El rótulo accesible dice lo que el botón VA a hacer, que con
          una sola unidad no es restar sino quitar la línea (decisión
          3d). En el panel claro el `−` se deshabilita a una unidad y
          manda a la papelera; aquí no hay papelera porque el `−` ES la
          papelera, y el lector de pantalla tiene que poder distinguirlo. */}
      <StepperKey
        label={units <= 1 ? "Quitar la línea" : "Restar una unidad"}
        onClick={onLess}
        glyph="−"
      />
      <span
        data-testid="pendiente-qty"
        className="shrink-0 w-[30px] text-center font-semibold tabular-nums"
        style={{ fontSize: PENDING_LINE_QTY_PX }}
      >
        {units}
      </span>
      {/* MISMO rótulo que el `+` del panel claro: es la misma acción y un
          sólo contrato para quien lo busca. */}
      <StepperKey label="Sumar una unidad" onClick={onMore} glyph="+" />
      {/* El nombre abre la hoja de la línea (modificadores, descuento,
          anular). Es el mismo toque que en el panel claro. */}
      <button
        type="button"
        onClick={onClick}
        data-testid="cart-line-name"
        className="flex-grow min-w-0 text-left font-semibold truncate"
        style={{ fontSize: PENDING_LINE_NAME_PX, color: DARK_TEXT }}
      >
        {line.nameSnapshot}
      </button>
      <span
        data-testid="pendiente-importe"
        className="shrink-0 font-semibold tabular-nums whitespace-nowrap"
        style={{ fontSize: PENDING_LINE_AMOUNT_PX }}
      >
        {formatEur(lineGross({ ...line, units }))}
      </span>
      </div>
      {chips}
    </div>
  );
}

function StepperKey({
  label,
  glyph,
  onClick,
}: {
  label: string;
  glyph: "−" | "+";
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      data-testid={glyph === "−" ? "stepper-menos" : "stepper-mas"}
      className={`shrink-0 rounded-[14px] border-0 flex items-center justify-center font-semibold ${PRESS_FEEDBACK_CLASS}`}
      style={{
        // El tamaño va por `style` con la MISMA constante que lee el
        // test: con una clase suelta, el 56 de la pantalla y el del test
        // podrían separarse sin que nada se pusiera rojo.
        width: MIN_TOUCH_PX,
        height: MIN_TOUCH_PX,
        background: DARK_SURFACE_KEY,
        color: DARK_ON_CORAL,
        fontSize: 30,
        lineHeight: 1,
      }}
    >
      {glyph}
    </button>
  );
}

/**
 * La comanda: cabecera de la mesa, chrome, búsqueda, avisos, las dos
 * secciones de líneas y el pie con el total y las dos acciones.
 *
 * Es un componente y no JSX en línea porque se monta en DOS sitios y
 * nunca en los dos a la vez: la columna izquierda del terminal y el
 * bottom-sheet de handheld. Duplicar 260 líneas de JSX habría sido la
 * forma de que el bar en tablet y el bar en móvil dejaran de decir lo
 * mismo.
 */
function Comanda({
  sent,
  pending,
  inSheet = false,
  ...props
}: HospitalityWorkspaceProps & {
  // kds-1-cocina · trozos y no líneas: una línea puede estar en los dos
  // bloques con unidades distintas en cada uno.
  sent: Array<{ line: CartLine; units: number }>;
  pending: Array<{ line: CartLine; units: number }>;
  /** `true` dentro del bottom-sheet de handheld. */
  inSheet?: boolean;
}) {
  return (
    <div
      data-testid="comanda"
      className={
        inSheet
          ? // En la hoja la comanda ocupa lo que le dé la hoja y la
            // lista es lo que scrollea (`min-h-0` lo hace posible).
            "flex flex-col flex-1 min-h-0 w-full"
          : "flex flex-col shrink-0 w-full lg:w-[var(--comanda-w)] lg:border-r"
      }
      style={
        {
          "--comanda-w": `${ORDER_PANEL_WIDTH}px`,
          background: DARK_PANEL,
          borderColor: DARK_SURFACE_RAISED,
        } as React.CSSProperties
      }
    >
      {/* Cabecera (identidad + destinos). Sólo cuando la comanda ES la
          columna del terminal: en handheld va arriba del catálogo, porque
          la hoja arranca cerrada y dejar ahí la flecha de volver y la
          lupa las haría inalcanzables. */}
      {!inSheet && <ComandaHeader {...props} />}

      {/* El buscador sólo aquí cuando la comanda ES la columna del
          terminal. En handheld la comanda vive en una hoja que arranca
          CERRADA, y el campo tiene que estar montado siempre: es donde
          aterriza el lector USB-HID y es el `inputMode="none"` que le
          cierra la puerta al teclado de Android (N1 de v1.22). Allí lo
          monta el propio workspace, fuera de la hoja. */}
      {!inSheet && props.searchField}
      {props.banners}

      {/* kds-1-cocina · decisión 5 · la banda «M4 · listo para servir»,
          apilada de más antigua a más nueva. Un toque = «Servido», y el
          aviso desaparece en TODOS los TPV de la tienda (lo hace el evento
          del bus). Sólo con el módulo encendido: es lo que se cobra. */}
      {props.kitchen.enabled && (
        <ListoBanner
          avisos={props.kitchen.avisosListo}
          beep={props.kitchen.readyBeep}
          onServido={props.kitchen.onServido}
        />
      )}

      {/* kds-1-cocina · decisión 6 · «Bravas −1 · Deshacer» durante 5 s.
          Si se deshace a tiempo no se llama a ninguna ruta y la cocina no
          ve ni un parpadeo. */}
      <DeshacerToast
        pendientes={props.kitchen.anulaciones}
        onDeshacer={props.kitchen.onDeshacer}
      />

      {/* kds-1-cocina · decisión 9 · «Cocina no recibe». No bloquea el
          envío: avisa, y al enviar sale además el papel por la USB del
          terminal. Lo que no se puede es que la comanda se quede sin
          camino y nadie lo diga. */}
      {props.kitchen.enabled && props.kitchen.cocinaNoRecibe && (
        <div
          data-testid="cocina-no-recibe"
          className="shrink-0 mx-3 mt-2 rounded-[12px] px-4 py-2.5 font-semibold"
          style={{ background: "#7E2318", color: "#FFFFFF", fontSize: 18 }}
        >
          Cocina no recibe · al enviar saldrá en papel
        </div>
      )}

      {/* Las líneas. Es el único bloque flexible de la comanda. */}
      <div
        data-testid="comanda-lineas"
        className="flex-grow min-h-0 overflow-y-auto overscroll-contain px-3 pb-1 flex flex-col gap-1"
      >
        {props.lines.length === 0 ? (
          <p
            className="py-10 text-center"
            style={{ fontSize: 15, color: DARK_TEXT_MUTED }}
          >
            Toca una familia y luego el producto
          </p>
        ) : (
          <>
            {/* ── En cocina ──────────────────────────────────────────
                kds-1-cocina · decisión 6 · **esto REVIERTE a propósito la
                regla de v2-H1**, y sólo donde hay pantalla.

                v2-H1 quitó el `−`/`+` de lo enviado por un motivo
                concreto: sin pantalla, un `−` quitaba el plato de la
                cuenta mientras el papel seguía en la plancha y cocina
                nunca se enteraba. Con pantalla la anulación LLEGA, así que
                ese motivo desaparece y queda sólo el riesgo del dedo
                gordo, que cubre el «Deshacer» de 5 s.

                Sin pantalla (impresora o nada) el motivo sigue en pie y se
                mantiene lo de v2-H1: sin `−`/`+`, y «Anular» en la hoja de
                la línea con el aviso «cocina ya tiene el papel: díselo».
                Es por SECCIÓN, porque una mesa puede tener las dos cosas:
                las bravas a la pantalla de cocina y las cañas a la
                impresora de la barra. */}
            {sent.length > 0 && (
              <>
                <div
                  data-testid="comanda-eyebrow-cocina"
                  className="px-2 py-1.5 font-medium"
                  style={{
                    fontSize: EYEBROW_PX,
                    letterSpacing: EYEBROW_TRACKING,
                    color: DARK_TEXT_MUTED,
                  }}
                >
                  {etiquetaEnCocina(props.lastSentAt)}
                </div>
                {sent.map(({ line: l, units }) => (
                  <SentLineCocina
                    key={`sent-${l.id}`}
                    lineId={l.id}
                    nombre={l.nameSnapshot}
                    units={units}
                    importe={formatEur(lineGross({ ...l, units }))}
                    puedeCorregir={puedeCorregirEnviado(props.kitchen.estado, l.id)}
                    onClick={() => props.onClickLine(l)}
                    onAnular={() =>
                      props.kitchen.onAnularEnviado(l.id, l.nameSnapshot, 1)
                    }
                    onSumar={() => props.onUpdateLineUnits(l.id, l.units + 1)}
                    chips={
                      <ChipsDeLinea
                        lineId={l.id}
                        enviada
                        alergenosDelPlato={l.allergens ?? []}
                        seat={sillaDeLinea(props.kitchen.estado, l.id)}
                        course={tiempoDeLinea(props.kitchen.estado, l.id)}
                        estado={props.kitchen.estado}
                        courseMode={props.kitchen.courseMode}
                        seatMode={props.kitchen.seatMode}
                        diners={props.kitchen.estado.diners}
                        onSilla={(seat) => props.kitchen.onSilla(l.id, seat)}
                        onTiempo={(c) => props.kitchen.onTiempo(l.id, c)}
                      />
                    }
                  />
                ))}
              </>
            )}

            {/* ── Sin enviar ── Destacadas, con −/+ de 56 px. */}
            {pending.length > 0 && (
              <>
                <div
                  data-testid="comanda-eyebrow-sin-enviar"
                  className="px-2 pt-3 pb-1.5 font-medium"
                  style={{
                    fontSize: EYEBROW_PX,
                    letterSpacing: EYEBROW_TRACKING,
                    // Coral, no gris: es el bloque sobre el que se
                    // actúa. El §4 del principio prohíbe el gris claro
                    // para información que se usa.
                    color: "#F2A08F",
                  }}
                >
                  SIN ENVIAR
                </div>
                {pending.map(({ line: l, units }) => (
                  <PendingLine
                    key={`pend-${l.id}`}
                    line={l}
                    units={units}
                    highlighted={props.lastTouchedLine?.id === l.id}
                    onClick={() => props.onClickLine(l)}
                    onLess={() => {
                      // Decisión 3d · un toque = UNA unidad. Con una
                      // sola unidad, el `−` quita la línea: dejarla a
                      // cero sería una línea fantasma en la comanda.
                      //
                      // kds-1-cocina · «una sola unidad» es ahora «una sola
                      // unidad SIN ENVIAR». Una línea con 2 en cocina y 1
                      // sin enviar baja a 2 y se queda: el `−` de aquí
                      // nunca toca lo que la cocina ya tiene, que es lo que
                      // anula el `−` del bloque de arriba.
                      if (units <= 1 && unidadesEnCocina(props.kitchen.estado, l.id) === 0) {
                        props.onRemoveLine(l.id);
                      } else {
                        props.onUpdateLineUnits(l.id, l.units - 1);
                      }
                    }}
                    onMore={() => props.onUpdateLineUnits(l.id, l.units + 1)}
                    chips={
                      <ChipsDeLinea
                        lineId={l.id}
                        alergenosDelPlato={l.allergens ?? []}
                        seat={sillaDeLinea(props.kitchen.estado, l.id)}
                        course={tiempoDeLinea(props.kitchen.estado, l.id)}
                        estado={props.kitchen.estado}
                        courseMode={props.kitchen.courseMode}
                        seatMode={props.kitchen.seatMode}
                        diners={props.kitchen.estado.diners}
                        onSilla={(seat) => props.kitchen.onSilla(l.id, seat)}
                        onTiempo={(c) => props.kitchen.onTiempo(l.id, c)}
                      />
                    }
                  />
                ))}
              </>
            )}
          </>
        )}
      </div>

      {/* kds-1-cocina · decisión 3 · la fila de tiempos del modo «Por
          tiempos», que **SE QUEDA PUESTA**: los productos que se pulsen
          después van a ese tiempo hasta que se cambie. Comandar una mesa de
          cuatro a la carta cuesta 2-3 toques más, no uno por plato.

          Va justo encima del pie y debajo de las líneas, que es donde está
          la fila de cantidad del catálogo: el camarero elige el tiempo y
          sigue pulsando productos sin mover la mano de zona. */}
      {props.kitchen.enabled && props.kitchen.courseMode === "TIEMPOS" && (
        <FilaDeTiempos
          course={props.kitchen.courseElegido}
          onCourse={props.kitchen.onCourseElegido}
        />
      )}

      {/* kds-1-cocina · «Urgente», «Marchar 2º» y «Alergias».
          «Alergias» va SIEMPRE (de serie en hostelería, decisión 10); las
          otras dos sólo con el módulo encendido. */}
      <AccionesCocina
        moduloEncendido={props.kitchen.enabled}
        estado={props.kitchen.estado}
        urgentePendiente={props.kitchen.urgentePendiente}
        onUrgente={props.kitchen.onUrgentePendiente}
        porMarchar={
          props.kitchen.enabled
            ? tiemposPorMarchar(props.kitchen.estado)
            : []
        }
        onMarchar={props.kitchen.onMarchar}
        onAlergias={props.kitchen.onAbrirAlergias}
        alergias={props.kitchen.estado.allergies.length}
      />

      {/* El pie: total y las dos acciones. */}
      <div
        data-testid="comanda-pie"
        className="shrink-0 px-4 pt-3.5 pb-4 flex flex-col gap-3 border-t"
        style={{ borderColor: DARK_SURFACE_RAISED }}
      >
        <div className="flex items-baseline justify-between gap-3">
          <span
            className="font-medium"
            style={{
              fontSize: EYEBROW_PX,
              letterSpacing: EYEBROW_TRACKING,
              color: DARK_TEXT_MUTED,
            }}
          >
            TOTAL
          </span>
          <span
            data-testid="comanda-total"
            className="font-semibold tabular-nums"
            style={{ fontSize: TOTAL_PX, letterSpacing: "-0.025em" }}
          >
            {formatEur(props.totals.total)}
          </span>
        </div>
        {/* La jerarquía la construyen las TRES variables a la vez
            —ancho (`flex` 1 contra 1.3), relleno (borde contra coral
            pleno) y rótulo—, que es lo que v1.14.1 midió en el panel
            claro: con una sola variable los dos se siguen leyendo como
            una pareja de iguales. El alto es el mismo (68) porque en
            oscuro el contraste del relleno ya separa de sobra, y
            bajarle 20 px a «Enviar» lo dejaba por debajo del botón de
            una línea de la comanda, que es menos importante que él. */}
        <div className="flex gap-2.5">
          <button
            type="button"
            onClick={props.onSendToKitchen}
            disabled={props.lines.length === 0 || props.kitchenBusy}
            data-testid="comanda-enviar"
            title={
              props.kitchenLastRevision > 0
                ? `Reenviar la comanda (la cocina ya recibió la nº ${props.kitchenLastRevision}).`
                : "Imprime una comanda por sección (barra/cocina/salón)."
            }
            className={`flex-1 rounded-2xl border font-semibold disabled:opacity-40 ${PRESS_FEEDBACK_CLASS}`}
            style={{
              height: ENVIAR_HEIGHT_PX,
              fontSize: ENVIAR_LABEL_PX,
              borderColor: "#3A404A",
              background: "transparent",
              color: DARK_TEXT,
            }}
          >
            {props.kitchenBusy
              ? "Enviando…"
              : props.kitchenLastRevision > 0
                ? `Reenviar (nº ${props.kitchenLastRevision + 1})`
                : "Enviar"}
          </button>
          <button
            type="button"
            onClick={props.onClickCheckout}
            disabled={props.lines.length === 0}
            data-testid="comanda-cobrar"
            className={`rounded-2xl border-0 font-semibold disabled:opacity-40 ${PRESS_FEEDBACK_CLASS}`}
            style={{
              flex: 1.3,
              height: COBRAR_HEIGHT_PX,
              fontSize: COBRAR_LABEL_PX,
              background: CORAL,
              color: DARK_ON_CORAL,
            }}
          >
            Cobrar
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * La cabecera de la comanda: quién es esta cuenta y a dónde se puede ir.
 *
 * Vive en un componente porque se monta en DOS sitios y nunca en los dos
 * a la vez: dentro de la comanda cuando es la columna del terminal, y
 * arriba del catálogo en handheld —donde la comanda es una hoja que
 * arranca cerrada, así que la flecha de volver a la sala y la lupa
 * estarían encerradas dentro de algo que hay que abrir para poder salir.
 */
function ComandaHeader(props: HospitalityWorkspaceProps) {
  return (
    <>
      {/* Fila 1: volver al mapa + identidad de la mesa. */}
      <div className="h-[72px] shrink-0 flex items-center gap-3 px-4">
        {props.onBackToMap && (
          <button
            type="button"
            onClick={props.onBackToMap}
            aria-label="Volver a la sala"
            title="Volver a la sala"
            data-testid="comanda-back"
            className={`shrink-0 rounded-[14px] flex items-center justify-center ${PRESS_FEEDBACK_CLASS}`}
            style={{
              width: MIN_TOUCH_PX,
              height: MIN_TOUCH_PX,
              background: DARK_SURFACE_RAISED,
              color: DARK_TEXT,
            }}
          >
            <ChevronLeft className="w-[22px] h-[22px]" strokeWidth={2.25} />
          </button>
        )}
        <div className="flex flex-col min-w-0">
          <span
            className="font-semibold leading-tight truncate"
            style={{ fontSize: 26, letterSpacing: "-0.015em" }}
          >
            {props.tableName ?? "Venta rápida"}
          </span>
          {props.tableMeta && (
            <span
              className="truncate"
              style={{ fontSize: 15, color: DARK_TEXT_MUTED }}
            >
              {props.tableMeta}
            </span>
          )}
        </div>
      </div>

      {/* Fila 2: los destinos que la maqueta no tiene sitio para poner
          arriba. Sólo icono, `MIN_TOUCH_PX` cada uno, y `flex-wrap`
          para el tenant que lleva Agenda, Clientes y Deudas activados
          a la vez (ahí baja a dos filas, que las paga la lista). */}
      {props.chromeActions.length > 0 && (
        <div
          data-testid="comanda-chrome"
          className="shrink-0 flex flex-wrap items-center gap-2 px-4 pb-3"
        >
          {props.chromeActions.map((a) => (
            <button
              key={a.key}
              type="button"
              onClick={a.onClick}
              aria-label={a.label}
              title={a.label}
              data-chrome-action={a.key}
              className={`shrink-0 rounded-[14px] flex items-center justify-center ${PRESS_FEEDBACK_CLASS}`}
              style={{
                width: MIN_TOUCH_PX,
                height: MIN_TOUCH_PX,
                background: DARK_SURFACE,
                color: DARK_TEXT_SOFT,
              }}
            >
              <span className={a.spinning ? "animate-spin" : undefined}>
                {a.icon}
              </span>
            </button>
          ))}
        </div>
      )}
    </>
  );
}
