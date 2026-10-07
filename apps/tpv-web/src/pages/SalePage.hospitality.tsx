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
import { ChevronLeft } from "lucide-react";

import type { CartLine } from "../lib/cart.js";
import type { CatalogProduct } from "../lib/catalog.js";
import { formatEur } from "../lib/money.js";
import {
  gridHeight,
  gridShapeFor,
  gridWidth,
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
  SENT_LINE_AMOUNT_PX,
  SENT_LINE_NAME_PX,
  TOTAL_PX,
  familyFillFor,
  type FamilyTone,
} from "../lib/hospitalityTheme.js";
import { kitchenSectionLabel, splitComanda } from "../lib/kitchenSentLines.js";

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
  /** Ids de línea que la cocina ya tiene. */
  sentLineIds: Set<string>;
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

  const { sent, pending } = splitComanda(props.lines, props.sentLineIds);

  return (
    <div
      data-testid="hospitality-workspace"
      data-theme="dark"
      className="flex-1 min-h-0 flex flex-col lg:flex-row font-sans"
      style={{ background: DARK_CANVAS, color: DARK_TEXT }}
    >
      {/* ── La comanda ──────────────────────────────────────────────── */}
      <div
        data-testid="comanda"
        className="flex flex-col shrink-0 w-full lg:w-[var(--comanda-w)] lg:border-r"
        style={
          {
            "--comanda-w": `${ORDER_PANEL_WIDTH}px`,
            background: DARK_PANEL,
            borderColor: DARK_SURFACE_RAISED,
          } as React.CSSProperties
        }
      >
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

        {props.searchField}
        {props.banners}

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
              {/* ── En cocina ── Atenuadas y SIN −/+: quitar algo ya
                  enviado sigue siendo la anulación de siempre, que vive
                  en la hoja de la línea (decisión 3d). */}
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
                    {kitchenSectionLabel(props.lastSentAt)}
                  </div>
                  {sent.map((l) => (
                    <button
                      key={l.id}
                      type="button"
                      data-testid="comanda-linea-enviada"
                      data-line-id={l.id}
                      onClick={() => props.onClickLine(l)}
                      className="flex items-center gap-3 min-h-[52px] px-2.5 rounded-xl text-left w-full"
                      style={{ color: DARK_TEXT_MUTED }}
                    >
                      <span
                        className="w-7 shrink-0 font-semibold tabular-nums"
                        style={{ fontSize: SENT_LINE_AMOUNT_PX }}
                      >
                        {l.units}
                      </span>
                      <span
                        className="flex-grow min-w-0 truncate font-medium"
                        style={{ fontSize: SENT_LINE_NAME_PX }}
                      >
                        {l.nameSnapshot}
                      </span>
                      <span
                        className="shrink-0 font-medium tabular-nums whitespace-nowrap"
                        style={{ fontSize: SENT_LINE_AMOUNT_PX }}
                      >
                        {formatEur(lineGross(l))}
                      </span>
                    </button>
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
                  {pending.map((l) => (
                    <PendingLine
                      key={l.id}
                      line={l}
                      highlighted={props.lastTouchedLine?.id === l.id}
                      onClick={() => props.onClickLine(l)}
                      onLess={() => {
                        // Decisión 3d · un toque = UNA unidad. Con una
                        // sola unidad, el `−` quita la línea: dejarla a
                        // cero sería una línea fantasma en la comanda.
                        if (l.units <= 1) props.onRemoveLine(l.id);
                        else props.onUpdateLineUnits(l.id, l.units - 1);
                      }}
                      onMore={() => props.onUpdateLineUnits(l.id, l.units + 1)}
                    />
                  ))}
                </>
              )}
            </>
          )}
        </div>

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

      {/* ── El catálogo ─────────────────────────────────────────────── */}
      <div className="flex-grow min-w-0 flex flex-col p-4 gap-3.5 box-border min-h-0">
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
        <div
          data-testid="qty-row"
          className="shrink-0 flex items-center gap-2"
          style={{ height: QTY_KEY_HEIGHT_PX }}
        >
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
                  width: QTY_KEY_WIDTH_PX,
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
          <span
            className="ml-2.5 hidden xl:inline"
            style={{ fontSize: 15, color: DARK_TEXT_MUTED }}
          >
            toca el número y luego el producto · vuelve a 1
          </span>
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
            gridAutoRows: `minmax(${shape.cardHeight}px, 1fr)`,
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
  highlighted,
  onClick,
  onLess,
  onMore,
}: {
  line: CartLine;
  highlighted: boolean;
  onClick: () => void;
  onLess: () => void;
  onMore: () => void;
}) {
  return (
    <div
      data-testid="comanda-linea-pendiente"
      data-line-id={line.id}
      className="flex items-center gap-2.5 min-h-[68px] px-2 rounded-[14px]"
      style={highlighted ? { background: DARK_LINE_HIGHLIGHT } : undefined}
    >
      <StepperKey label="Una menos" onClick={onLess} glyph="−" />
      <span
        data-testid="pendiente-qty"
        className="shrink-0 w-[30px] text-center font-semibold tabular-nums"
        style={{ fontSize: PENDING_LINE_QTY_PX }}
      >
        {line.units}
      </span>
      <StepperKey label="Una más" onClick={onMore} glyph="+" />
      {/* El nombre abre la hoja de la línea (modificadores, descuento,
          anular). Es el mismo toque que en el panel claro. */}
      <button
        type="button"
        onClick={onClick}
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
        {formatEur(lineGross(line))}
      </span>
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
