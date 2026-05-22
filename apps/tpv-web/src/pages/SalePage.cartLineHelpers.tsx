// Helpers visuales compartidos entre el grid del carrito (SalePage.tsx
// LinesPanel) y el componente extraído de cada línea (CartLineItem.tsx).
// Lote 3 (v1.2-Lite-fix1) sacó esto a su propio módulo para evitar el
// import circular SalePage ↔ CartLineItem.

import type { ModifierSelection } from "../lib/cart.js";

const formatEur = (n: number) => n.toFixed(2).replace(".", ",") + " €";

// Desglose visual del carrito para una línea con modifiers
// estructurados. Cada selección sale en una sub-línea con sangría —
// formato `└ Grupo · Etiqueta   + 0,50 €`.
export function ModifierBreakdown({
  selections,
}: {
  selections: ModifierSelection[];
}) {
  return (
    <div className="text-[12.5px] text-slate-500 mt-0.5 space-y-0.5">
      {selections.map((s, i) => {
        const sign = s.priceDeltaCents > 0 ? "+" : "−";
        const delta =
          s.priceDeltaCents !== 0
            ? ` ${sign} ${formatEur(Math.abs(s.priceDeltaCents) / 100)}`
            : "";
        return (
          <div
            key={`${s.groupId}-${s.modifierId}-${i}`}
            className="flex items-baseline gap-1"
          >
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
