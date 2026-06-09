// v1.2-Lite-fix1 Lote 3 (F2-UX): controles inline en cada línea del
// ticket. Antes de esto, cambiar cantidad o eliminar una línea costaba
// 3-4 clics (abrir modal, editar, aplicar). Ahora la zona de la línea
// se divide en tres áreas táctiles:
//
//   - Stepper a la izquierda (`−` cantidad `+`) → cambio inline,
//     optimista.
//   - Click central (nombre + breakdown) → abre el LineSheet completo
//     (precio, descuento, modificadores, nota).
//   - Papelera a la derecha con "armado" por doble tap: el primer tap
//     pone el botón en estado "confirmar" 1.5s; el segundo tap dentro
//     de esa ventana elimina. Sin segundo tap, vuelve a inerte. Evita
//     borrados accidentales sin meter un modal de confirmación.
//
// Touch targets ≥ 44 px (Apple HIG / Material). El stepper en `−` con
// cantidad 1 NO baja a 0 silenciosamente — resalta brevemente la
// papelera como hint visual de la forma correcta de eliminar.

import { useCallback, useEffect, useRef, useState } from "react";
import { Minus, Plus, Trash2 } from "lucide-react";

import { computeLine, type CartLine } from "../lib/cart.js";
import { ModifierBreakdown } from "./SalePage.cartLineHelpers.js";

const formatEur = (n: number) => n.toFixed(2).replace(".", ",") + " €";

// Ventana de tiempo que la papelera permanece "armada" tras el primer
// tap. 1.5s es el punto medio entre "lo suficientemente largo para que
// el cajero apunte sin estrés" y "lo suficientemente corto para que no
// quede una papelera roja zombi en pantalla".
const TRASH_ARM_WINDOW_MS = 1500;
// Hint visual cuando el cajero pulsa `−` en cantidad 1: el botón
// papelera parpadea ese tiempo para sugerirle el flujo correcto.
const TRASH_HINT_WINDOW_MS = 1200;

export interface CartLineItemProps {
  line: CartLine;
  onClick: () => void;
  onUnitsChange: (units: number) => void;
  onRemove: () => void;
}

export function CartLineItem({
  line,
  onClick,
  onUnitsChange,
  onRemove,
}: CartLineItemProps) {
  const total = computeLine(line);
  const [trashArmed, setTrashArmed] = useState(false);
  const [trashHint, setTrashHint] = useState(false);
  const armTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (armTimerRef.current) clearTimeout(armTimerRef.current);
      if (hintTimerRef.current) clearTimeout(hintTimerRef.current);
    };
  }, []);

  const disarm = useCallback(() => {
    if (armTimerRef.current) {
      clearTimeout(armTimerRef.current);
      armTimerRef.current = null;
    }
    setTrashArmed(false);
  }, []);

  const triggerHint = useCallback(() => {
    setTrashHint(true);
    if (hintTimerRef.current) clearTimeout(hintTimerRef.current);
    hintTimerRef.current = setTimeout(() => setTrashHint(false), TRASH_HINT_WINDOW_MS);
  }, []);

  function handleDecrement(e: React.MouseEvent) {
    e.stopPropagation();
    disarm();
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
    disarm();
    onUnitsChange(line.units + 1);
  }

  function handleTrashClick(e: React.MouseEvent) {
    e.stopPropagation();
    if (trashArmed) {
      // Segundo tap dentro de la ventana → eliminamos.
      disarm();
      onRemove();
      return;
    }
    setTrashArmed(true);
    if (armTimerRef.current) clearTimeout(armTimerRef.current);
    armTimerRef.current = setTimeout(() => {
      setTrashArmed(false);
      armTimerRef.current = null;
    }, TRASH_ARM_WINDOW_MS);
  }

  return (
    <div className="flex items-center gap-2 md:gap-2.5 py-2.5 md:py-3">
      {/* Stepper vertical: cantidad arriba, − y + en fila debajo.
          v1.4-hotfix5: cambio del stepper horizontal previo para
          ganar ~45 px de ancho que iban al título del artículo
          (problema visto en tablet apaisada de Sole). Mantiene
          targets táctiles de 44 px en − y +. */}
      <div className="flex flex-col items-stretch bg-mipiace-stone rounded-xl shrink-0 w-[88px]">
        <span className="text-center pt-1 pb-0.5 text-[16px] font-semibold tabular-nums text-mipiace-ink select-none">
          {line.units}
        </span>
        <div className="flex">
          <button
            type="button"
            onClick={handleDecrement}
            aria-label={line.units <= 1 ? "Mínimo 1 — usa la papelera para eliminar" : "Restar una unidad"}
            className="h-9 w-11 flex items-center justify-center text-slate-600 hover:text-mipiace-ink active:bg-slate-200/60 rounded-bl-xl"
          >
            <Minus className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={handleIncrement}
            aria-label="Sumar una unidad"
            className="h-9 w-11 flex items-center justify-center text-slate-600 hover:text-mipiace-ink active:bg-slate-200/60 rounded-br-xl"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Zona central clickable → abre LineSheet */}
      <button
        type="button"
        onClick={onClick}
        className="flex-1 min-w-0 text-left py-1"
      >
        <div className="text-[14px] md:text-[14.5px] font-medium text-mipiace-ink leading-tight flex items-center gap-1.5">
          <span className="truncate">{line.nameSnapshot}</span>
          {/* v1.2-Lite-fix1 Lote 3: indicador discreto de precio
              modificado, alternativa compacta al chip "Precio
              modificado" del breakdown — la papelera roba poco
              espacio y el cajero ya tiene contexto en la zona
              central. */}
          {line.unitPriceOverride != null && (
            <span
              className="text-amber-700 text-[14px] leading-none shrink-0"
              title={`Precio modificado (catálogo ${formatEur(line.priceGross)})`}
              aria-label="Precio modificado"
            >
              •
            </span>
          )}
        </div>
        {line.modifierSelections && line.modifierSelections.length > 0 ? (
          <ModifierBreakdown selections={line.modifierSelections} />
        ) : line.modifiers.length > 0 ? (
          <div className="text-[12.5px] text-slate-500 mt-0.5 truncate">
            {line.modifiers.join(" · ")}
          </div>
        ) : line.unitPriceOverride != null ? (
          <div className="text-[12.5px] text-amber-700 mt-0.5 tabular-nums">
            {formatEur(line.unitPriceOverride * (1 + line.taxRate / 100))} ud.{" "}
            <span className="text-slate-400 line-through">
              {formatEur(line.priceGross)}
            </span>
          </div>
        ) : line.discountPct > 0 ? (
          <div className="text-[12.5px] text-mipiace-coral mt-0.5 tabular-nums">
            {formatEur(line.priceGross)} ud. · −{line.discountPct}%
          </div>
        ) : (
          <div className="text-[12.5px] text-slate-400 tabular-nums mt-0.5">
            {formatEur(line.priceGross)} ud.
          </div>
        )}
      </button>

      {/* Total + papelera */}
      <div className="flex items-center gap-2 shrink-0">
        <span className="text-[14px] md:text-[14.5px] font-medium text-mipiace-ink tabular-nums">
          {formatEur(total.totalGross)}
        </span>
        <button
          type="button"
          onClick={handleTrashClick}
          aria-label={trashArmed ? "Pulsa de nuevo para eliminar la línea" : "Eliminar línea"}
          className={
            trashArmed
              ? "h-11 w-11 rounded-xl flex items-center justify-center bg-red-500 text-white scale-105 transition-transform"
              : trashHint
                ? "h-11 w-11 rounded-xl flex items-center justify-center bg-red-50 text-red-500 animate-pulse"
                : "h-11 w-11 rounded-xl flex items-center justify-center text-slate-400 hover:bg-red-50 hover:text-red-500 transition-colors"
          }
        >
          <Trash2 className="w-4 h-4" strokeWidth={2} />
        </button>
      </div>
    </div>
  );
}
