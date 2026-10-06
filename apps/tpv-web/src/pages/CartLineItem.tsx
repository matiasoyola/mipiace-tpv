// v1.2-Lite-fix1 Lote 3 (F2-UX): controles inline en cada línea del
// ticket. Antes de esto, cambiar cantidad o eliminar una línea costaba
// 3-4 clics (abrir modal, editar, aplicar). Ahora la zona de la línea
// se divide en tres áreas táctiles:
//
//   - Stepper a la izquierda (`−` cantidad `+`) → cambio inline,
//     optimista.
//   - Click central (nombre + breakdown) → abre el LineSheet completo
//     (precio, descuento, modificadores, nota).
//   - Papelera a la derecha: borra al primer toque.
//
// v1.10.3-barra (hallazgo #2 de la simulación de hora punta del
// 2026-08-20): la papelera exigía un SEGUNDO toque dentro de 1,5 s y,
// pasada la ventana, se desarmaba sin decir nada — con la mano ocupada
// parecía un botón muerto. Se ha sustituido por el patrón UX de la
// casa: borrado directo + banner "Deshacer" de 4 s, que vive en
// `SalePage` (es quien tiene las líneas y sabe reponerlas). Un target
// de 44 px no debería exigir puntería cronometrada.
//
// Touch targets ≥ 44 px (Apple HIG / Material). El stepper en `−` con
// cantidad 1 NO baja a 0 silenciosamente — resalta brevemente la
// papelera como hint visual de la forma correcta de eliminar.
//
// ── v1.22-el-terminal-del-bar · §3 (B4 + N3 + N5 + C8) ──────────────
//
// Medido en el AP13 (1443 × 812): la línea medía 90 px de alto y en el
// panel se veían TRES. Una mesa de seis cosas ya pedía desplazar para
// comprobarla antes de cobrar. Y de los 302 px de contenido de la
// lista, el nombre se quedaba con 95 en UNA sola línea, mientras el
// stepper se llevaba 88 y el cluster de la derecha 99.
//
// El reparto nuevo, con los tres números medidos en el navegador:
//
//   [− 48][ 2 ][+ 48]   nombre hasta 2 líneas      [🗑 48]
//    122 px            112 px                      48 px
//                      1,60 € ud.        5,00 €
//
//   · El stepper pasa de VERTICAL (88 × 66, con −/+ de 44 × 36) a
//     HORIZONTAL con las dos teclas a 48 × 48. Cuesta 34 px de ancho y
//     es lo que cumple C8 sin inventarse un token: 48 es el peldaño
//     `touch` de `tokens.md` §4.
//   · Los dos importes bajan DEBAJO del nombre, en la misma columna. Es
//     lo que libera los 59 px que el nombre necesitaba: con el total
//     todavía en su propia celda, el nombre se quedaba en 50 px y el
//     arreglo de B4 era imposible a 360 px de panel.
//   · El alto de la fila lo marcan los objetivos táctiles (48) o el
//     bloque de texto (2 líneas + importes ≈ 52), no el padding: `py-1`
//     y un separador de 1 px en vez de los 20-24 px de aire de antes.
//     Resultado medido: 60-61 px de línea → CINCO líneas a 812 px y
//     cinco a 800. Antes tres.
//   · La papelera queda al otro extremo de la fila, con los 112 px del
//     nombre entre ella y el `−`. El borrado sigue siendo directo con
//     "Deshacer" de 4 s detrás.

import { useCallback, useEffect, useRef, useState } from "react";
import { Minus, Plus, Trash2 } from "lucide-react";

import { computeLine, type CartLine } from "../lib/cart.js";
import { ModifierBreakdown } from "./SalePage.cartLineHelpers.js";
import { formatEur } from "../lib/money.js";
import { LINE_NAME_MAX_LINES, lineNameDisplay } from "../lib/lineName.js";

// Hint visual cuando el cajero pulsa `−` en cantidad 1: el botón
// papelera parpadea ese tiempo para sugerirle el flujo correcto.
const TRASH_HINT_WINDOW_MS = 1200;

export interface CartLineItemProps {
  line: CartLine;
  onClick: () => void;
  onUnitsChange: (units: number) => void;
  onRemove: () => void;
  // B-reservas-2: duración de agenda del servicio (minutos), informativa.
  // Sólo llega cuando el tenant tiene `agendaEnabled` y la línea es un
  // servicio con overlay de scheduling. undefined/null → no se pinta.
  // Base visual para B4 (agenda).
  durationMin?: number | null;
  // v1.14-la-comanda-se-ve · confirmación visual de "se ha añadido".
  // Hallazgo C1 de la auditoría del 2026-09-01: al tocar un producto la
  // línea nacía fuera de la vista y el camarero volvía a tocar, con el
  // cliente pagando dos cafés. La línea recién tocada se pinta en
  // `coral-soft` y vuelve a transparente al apagarse el flag — la
  // transición de 700 ms hace el desvanecido sin animación propia ni
  // `key` que remonte el nodo (remontarlo perdería el scroll).
  highlighted?: boolean;
}

export function CartLineItem({
  line,
  onClick,
  onUnitsChange,
  onRemove,
  durationMin,
  highlighted = false,
}: CartLineItemProps) {
  const total = computeLine(line);
  const [trashHint, setTrashHint] = useState(false);
  const hintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (hintTimerRef.current) clearTimeout(hintTimerRef.current);
    };
  }, []);

  const triggerHint = useCallback(() => {
    setTrashHint(true);
    if (hintTimerRef.current) clearTimeout(hintTimerRef.current);
    hintTimerRef.current = setTimeout(() => setTrashHint(false), TRASH_HINT_WINDOW_MS);
  }, []);

  function handleDecrement(e: React.MouseEvent) {
    e.stopPropagation();
    if (line.units <= 1) {
      // Cantidad mínima 1: en lugar de bajar a 0 silenciosamente, le
      // recordamos al cajero la papelera. Si REALMENTE quiere eliminar
      // usa el botón rojo (un tap arma, el siguiente confirma).
      triggerHint();
      return;
    }
    onUnitsChange(line.units - 1);
  }

  function handleIncrement(e: React.MouseEvent) {
    e.stopPropagation();
    onUnitsChange(line.units + 1);
  }

  function handleTrashClick(e: React.MouseEvent) {
    e.stopPropagation();
    // Borrado directo: la red de seguridad es el "Deshacer" de 4 s que
    // pinta SalePage, no un segundo toque contrarreloj.
    onRemove();
  }

  return (
    <div
      // `data-line-id` es el asa con la que el panel del ticket hace
      // scroll hasta la línea recién añadida sin guardar un ref por
      // línea.
      data-line-id={line.id}
      data-highlighted={highlighted ? "true" : undefined}
      // El destaque ENTRA de golpe y sólo SALE con transición.
      //
      // Con `transition-colors` en los dos estados, el fondo coral se
      // desvanecía hacia dentro durante 700 ms: medido en el navegador a
      // los 150 ms del toque, el alfa iba por 0,004 — o sea, invisible
      // justo en el instante en que hay que confirmar que la línea se ha
      // añadido. El principio §1.3 pide feedback claro en menos de
      // 100 ms, así que el estado destacado va sin transición y es el
      // apagado el que se desvanece.
      className={
        // v1.22 §3 · `py-1` y un separador de 1 px en vez de 20-24 px de
        // aire: el alto de la fila lo marcan los objetivos táctiles, y
        // cada 6 px de padding cuesta media línea en el panel. El
        // separador se come con el destaque, que lleva fondo propio.
        (highlighted
          ? "bg-mipiace-coral-soft transition-none border-transparent"
          : "bg-transparent transition-colors duration-700 border-slate-100") +
        " flex items-center gap-2 md:gap-2.5 py-1 px-2 -mx-2 rounded-xl border-b last:border-b-0"
      }
    >
      {/* v1.22 §3 · stepper HORIZONTAL con las dos teclas a 48 × 48
          (`h-touch`/`w-touch` de `tokens.md` §4; C8 medía 44 × 36). El
          vertical de v1.4-hotfix5 ahorraba ancho, pero con teclas de
          48 px de alto pedía 96 px de ALTO de fila y el panel se
          quedaba en tres líneas. La cantidad va entre las dos teclas,
          que es donde se busca con la vista al corregir una. */}
      <div className="flex items-center bg-mipiace-stone rounded-xl shrink-0">
        <button
          type="button"
          onClick={handleDecrement}
          aria-label={line.units <= 1 ? "Mínimo 1 — usa la papelera para eliminar" : "Restar una unidad"}
          className="h-touch w-touch flex items-center justify-center text-slate-600 hover:text-mipiace-ink active:bg-slate-200/60 rounded-l-xl"
        >
          <Minus className="w-4 h-4" strokeWidth={2.25} />
        </button>
        <span className="min-w-[26px] text-center text-[16px] font-semibold tabular-nums text-mipiace-ink select-none">
          {line.units}
        </span>
        <button
          type="button"
          onClick={handleIncrement}
          aria-label="Sumar una unidad"
          className="h-touch w-touch flex items-center justify-center text-slate-600 hover:text-mipiace-ink active:bg-slate-200/60 rounded-r-xl"
        >
          <Plus className="w-4 h-4" strokeWidth={2.25} />
        </button>
      </div>

      {/* Zona central clickable → abre LineSheet. Nombre arriba (hasta
          dos líneas) e importes debajo, en la MISMA columna: es lo que
          libera el ancho que el nombre necesitaba (ver la cabecera). */}
      <button
        type="button"
        onClick={onClick}
        className="flex-1 min-w-0 text-left"
      >
        <div className="text-[14px] md:text-[14.5px] font-medium text-mipiace-ink leading-tight flex items-start gap-1.5">
          {/* v1.22 §3 · B4 · dos líneas y, si hace falta cortar, por el
              MEDIO: lo que distingue la carta de un bar ("especial",
              "tercio", "Etiqueta Negra") está al final, que es lo que
              se lleva una elipsis por el final. El corte lo decide
              `lineName.ts`, que es puro y testeable; el `line-clamp` de
              aquí es el cinturón por si la estimación se pasa.
              `break-words` para que un nombre de una sola palabra
              larguísima no desborde la caja. */}
          <span
            data-testid="cart-line-name"
            className="min-w-0 break-words"
            style={{
              display: "-webkit-box",
              WebkitBoxOrient: "vertical",
              WebkitLineClamp: LINE_NAME_MAX_LINES,
              overflow: "hidden",
            }}
            title={line.nameSnapshot}
          >
            {lineNameDisplay(line.nameSnapshot)}
          </span>
          {/* v1.2-Lite-fix1 Lote 3: indicador discreto de precio
              modificado, alternativa compacta al chip "Precio
              modificado" del breakdown — la papelera roba poco
              espacio y el cajero ya tiene contexto en la zona
              central. */}
          {line.unitPriceOverride != null && (
            <span
              className="text-amber-700 text-[14px] leading-none shrink-0 mt-0.5"
              title={`Precio modificado (catálogo ${formatEur(line.priceGross)})`}
              aria-label="Precio modificado"
            >
              •
            </span>
          )}
        </div>
        {/* v1.22 §3 · la fila de importes: unitario a la izquierda y
            total de la línea a la derecha, los dos `tabular-nums`. El
            total pesa más (14,5/500 contra 12/400): es la cifra que se
            comprueba antes de cobrar. */}
        <div className="flex items-baseline justify-between gap-2 leading-none mt-0.5">
          <span className="min-w-0 truncate text-[12px]">
            {line.modifiers.length > 0 &&
            (!line.modifierSelections || line.modifierSelections.length === 0) ? (
              <span className="text-slate-500">{line.modifiers.join(" · ")}</span>
            ) : line.unitPriceOverride != null ? (
              <span className="text-amber-700 tabular-nums">
                {formatEur(line.unitPriceOverride * (1 + line.taxRate / 100))} ud.
              </span>
            ) : line.discountPct > 0 ? (
              <span className="text-mipiace-coral tabular-nums">
                {formatEur(line.priceGross)} ud. · −{line.discountPct}%
              </span>
            ) : (
              <span className="text-slate-400 tabular-nums">
                {formatEur(line.priceGross)} ud.
              </span>
            )}
            {/* B-reservas-2: duración del servicio, informativa. Vuelve
                a compartir fila, pero con los importes y no con el
                nombre: lo que no puede perder sitio es el nombre. */}
            {durationMin != null && durationMin > 0 && (
              <span className="text-slate-500 tabular-nums"> · {durationMin} min</span>
            )}
          </span>
          <span className="shrink-0 text-[14px] md:text-[14.5px] font-medium text-mipiace-ink tabular-nums">
            {formatEur(total.totalGross)}
          </span>
        </div>
        {/* El desglose de modificadores es multi-línea por naturaleza
            (un `└ Grupo · opción` por elección) y va en su propio
            bloque: meterlo en la fila de importes rompía el reparto a
            dos columnas. Una línea con modificadores es más alta que
            una sin ellos, y eso es honesto. */}
        {line.modifierSelections && line.modifierSelections.length > 0 && (
          <ModifierBreakdown selections={line.modifierSelections} />
        )}
      </button>

      {/* Papelera, al otro extremo de la fila: los 112 px del nombre la
          separan del `−`, que es lo que pedía C8. 48 × 48. */}
      <button
        type="button"
        onClick={handleTrashClick}
        aria-label={`Eliminar ${line.nameSnapshot}`}
        title="Eliminar la línea (podrás deshacerlo durante 4 s)"
        className={
          "h-touch w-touch shrink-0 rounded-xl flex items-center justify-center " +
          (trashHint
            ? "bg-red-50 text-red-500 animate-pulse"
            : "text-slate-400 hover:bg-red-50 hover:text-red-500 active:bg-red-100 transition-colors")
        }
      >
        <Trash2 className="w-4 h-4" strokeWidth={2} />
      </button>
    </div>
  );
}
