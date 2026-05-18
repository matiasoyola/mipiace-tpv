// Bottom sheet de edición de una línea del carrito (B4 §2.2): cantidad
// ±, descuento por línea (% o importe), modificadores rápidos,
// eliminar. Reutiliza la misma estética de las sheets de SalePage.

import { useState } from "react";
import { Minus, Plus, Trash2, X } from "lucide-react";

import { computeLine, type CartLine } from "../lib/cart.js";

const formatEur = (n: number) => n.toFixed(2).replace(".", ",") + " €";

export function LineSheet({
  line,
  onClose,
  onChange,
  onRemove,
}: {
  line: CartLine;
  onClose: () => void;
  onChange: (patch: Partial<CartLine>) => void;
  onRemove: () => void;
}) {
  const [units, setUnits] = useState(String(line.units));
  const [discountPct, setDiscountPct] = useState(String(line.discountPct));
  const [modifierDraft, setModifierDraft] = useState("");
  const computed = computeLine({
    units: Number(units) || 0,
    unitPrice: line.unitPrice,
    discountPct: Number(discountPct) || 0,
    taxRate: line.taxRate,
  });

  function commit() {
    onChange({
      units: Math.max(0.001, Number(units) || 1),
      discountPct: Math.min(100, Math.max(0, Number(discountPct) || 0)),
    });
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-mipiace-ink/40 flex items-end sm:items-center justify-center p-4 font-sans"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white w-full max-w-md rounded-3xl border border-slate-200 p-6 md:p-7"
      >
        <div className="flex items-start justify-between mb-1">
          <div className="min-w-0 flex-1">
            <div className="text-[18px] font-semibold text-mipiace-ink truncate">
              {line.nameSnapshot}
            </div>
            <div className="text-[12.5px] text-slate-500 mt-0.5 tabular-nums">
              {formatEur(line.priceGross)} ud. · IVA {line.taxRate}%
            </div>
          </div>
          <button
            onClick={onClose}
            className="h-9 w-9 rounded-xl hover:bg-slate-50 text-slate-500 flex items-center justify-center"
            aria-label="Cerrar"
          >
            <X className="w-4 h-4" strokeWidth={2.25} />
          </button>
        </div>

        <div className="mt-5">
          <label className="block text-[13px] font-medium text-mipiace-ink-soft mb-2">
            Cantidad
          </label>
          <div className="flex items-stretch gap-2">
            <button
              onClick={() => setUnits(String(Math.max(0.001, (Number(units) || 1) - 1)))}
              className="h-14 w-14 rounded-2xl bg-mipiace-stone hover:bg-slate-100 flex items-center justify-center text-slate-600"
            >
              <Minus className="w-5 h-5" />
            </button>
            <input
              value={units}
              onChange={(e) => setUnits(e.target.value)}
              inputMode="decimal"
              className="flex-1 h-14 px-4 text-[24px] font-semibold tracking-tight bg-mipiace-stone border border-transparent rounded-2xl focus:bg-white focus:border-mipiace-coral/30 focus:ring-2 focus:ring-mipiace-coral/40 tabular-nums text-center focus:outline-none"
            />
            <button
              onClick={() => setUnits(String((Number(units) || 0) + 1))}
              className="h-14 w-14 rounded-2xl bg-mipiace-stone hover:bg-slate-100 flex items-center justify-center text-slate-600"
            >
              <Plus className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="mt-4">
          <label className="block text-[13px] font-medium text-mipiace-ink-soft mb-2">
            Descuento (%)
          </label>
          <input
            value={discountPct}
            onChange={(e) => setDiscountPct(e.target.value)}
            inputMode="decimal"
            className="w-full h-12 px-3.5 rounded-xl bg-mipiace-stone border border-transparent text-[14.5px] focus:bg-white focus:border-mipiace-coral/30 focus:ring-2 focus:ring-mipiace-coral/30 focus:outline-none tabular-nums text-right"
            placeholder="0"
          />
        </div>

        <div className="mt-4">
          <label className="block text-[13px] font-medium text-mipiace-ink-soft mb-2">
            Modificadores
          </label>
          {/* Modifiers estructurados (catálogo) — sólo lectura. Para cambiar
              la selección hay que quitar la línea y volver a añadir el
              producto desde el grid. */}
          {line.modifierSelections && line.modifierSelections.length > 0 && (
            <div className="mb-2 space-y-1 bg-mipiace-stone rounded-xl p-2">
              {line.modifierSelections.map((s, i) => (
                <div
                  key={`${s.groupId}-${s.modifierId}-${i}`}
                  className="text-[12.5px] text-mipiace-ink flex items-baseline gap-2"
                >
                  <span className="text-slate-400">└</span>
                  <span className="flex-1">
                    {s.groupName} · {s.label}
                  </span>
                  {s.priceDeltaCents !== 0 && (
                    <span
                      className={`tabular-nums text-[12px] ${
                        s.priceDeltaCents > 0
                          ? "text-slate-500"
                          : "text-mipiace-coral"
                      }`}
                    >
                      {s.priceDeltaCents > 0 ? "+" : "−"}{" "}
                      {(Math.abs(s.priceDeltaCents) / 100)
                        .toFixed(2)
                        .replace(".", ",")}{" "}
                      €
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
          <div className="flex flex-wrap gap-1.5 mb-2">
            {line.modifiers.map((m, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-mipiace-coral-soft text-mipiace-coral-dark text-[12.5px] font-medium"
              >
                {m}
                <button
                  onClick={() =>
                    onChange({
                      modifiers: line.modifiers.filter((x) => x !== m),
                    })
                  }
                  className="text-mipiace-coral-dark hover:text-mipiace-coral"
                  aria-label="Quitar"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
            {line.modifiers.length === 0 &&
              (!line.modifierSelections || line.modifierSelections.length === 0) && (
                <span className="text-[12.5px] text-slate-400">Sin modificadores.</span>
              )}
          </div>
          <div className="flex gap-2">
            <input
              value={modifierDraft}
              onChange={(e) => setModifierDraft(e.target.value)}
              placeholder="Nota ad-hoc (ej.: sin azúcar)"
              className="flex-1 h-10 px-3 rounded-xl bg-mipiace-stone border border-transparent text-[13px] focus:bg-white focus:border-mipiace-coral/30 focus:ring-2 focus:ring-mipiace-coral/30 focus:outline-none"
            />
            <button
              onClick={() => {
                if (modifierDraft.trim().length === 0) return;
                onChange({
                  modifiers: [...line.modifiers, modifierDraft.trim()],
                });
                setModifierDraft("");
              }}
              className="h-10 px-4 rounded-xl bg-mipiace-coral text-white text-[13px] font-medium"
            >
              Añadir
            </button>
          </div>
          <p className="text-[11.5px] text-slate-400 mt-1.5">
            Las notas ad-hoc aparecen en el ticket y en la descripción del
            item enviada a Holded.
          </p>
        </div>

        <div className="mt-5 bg-mipiace-stone rounded-xl p-4 flex items-center justify-between">
          <span className="text-[13.5px] text-slate-500">Total línea</span>
          <span className="text-[20px] font-semibold tabular-nums text-mipiace-ink">
            {formatEur(computed.totalGross)}
          </span>
        </div>

        <div className="flex gap-2.5 mt-5">
          <button
            onClick={onRemove}
            className="h-12 px-4 rounded-2xl border border-slate-200 hover:bg-red-50 hover:text-red-700 text-[13.5px] text-slate-500 font-medium flex items-center gap-2"
          >
            <Trash2 className="w-4 h-4" /> Eliminar
          </button>
          <button
            onClick={commit}
            className="flex-1 h-12 rounded-2xl bg-mipiace-coral hover:bg-mipiace-coral-dark text-white text-[14px] font-medium"
          >
            Aplicar
          </button>
        </div>
      </div>
    </div>
  );
}
