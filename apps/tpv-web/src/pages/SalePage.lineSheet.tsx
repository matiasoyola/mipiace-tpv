// Bottom sheet de edición de una línea del carrito (B4 §2.2): cantidad
// ±, descuento por línea (% o importe), modificadores rápidos,
// eliminar. Reutiliza la misma estética de las sheets de SalePage.

import { useState } from "react";
import { Minus, Pencil, Plus, RotateCcw, Trash2, X } from "lucide-react";

import { computeLine, type CartLine } from "../lib/cart.js";

const formatEur = (n: number) => n.toFixed(2).replace(".", ",") + " €";

// v1.2-Lite Lote 4.B: parsea precio escrito por el cajero. Soporta
// coma o punto como separador decimal. Devuelve null si el input está
// vacío (= sin override) o si no parsea. NaN o negativo → null
// también: validamos en commit que se haya pulsado guardar con valor
// razonable.
function parsePriceInput(raw: string): number | null {
  const t = raw.trim().replace(",", ".");
  if (t.length === 0) return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100) / 100;
}

export function LineSheet({
  line,
  onClose,
  onChange,
  onRemove,
  allowPriceOverride = true,
  onMoveToTable,
}: {
  line: CartLine;
  onClose: () => void;
  onChange: (patch: Partial<CartLine>) => void;
  onRemove: () => void;
  // v1.0-mesas-frontend: en contexto mesa la línea vive en el servidor
  // y el PATCH no admite override de precio puntual — ocultamos el
  // lápiz para no prometer algo que no se persistiría.
  allowPriceOverride?: boolean;
  // v1.0-mesas-frontend: mover ESTA línea a otra mesa (endpoint
  // /tickets/:id/lines/move). Sólo en contexto mesa.
  onMoveToTable?: () => void;
}) {
  const [units, setUnits] = useState(String(line.units));
  const [discountPct, setDiscountPct] = useState(String(line.discountPct));
  const [modifierDraft, setModifierDraft] = useState("");
  // v1.2-Lite Lote 4.B · T-5: edición puntual de precio. UX:
  //   - Por defecto colapsado: muestra el precio base + botón lápiz.
  //   - Al pulsar el lápiz se despliega un input prellenado con el
  //     precio actual (override o base).
  //   - "Restaurar" vuelve al precio del catálogo (limpia el override).
  // Mantenemos el override en el patch del onChange sólo si difiere
  // del base (evita persistir overrides "iguales al catálogo" que
  // confundirían la auditoría).
  const [showPriceEditor, setShowPriceEditor] = useState(
    line.unitPriceOverride != null,
  );
  const [priceInput, setPriceInput] = useState(
    line.unitPriceOverride != null
      ? line.unitPriceOverride.toFixed(2).replace(".", ",")
      : line.unitPrice.toFixed(2).replace(".", ","),
  );
  const effectiveUnitPrice =
    line.unitPriceOverride != null ? line.unitPriceOverride : line.unitPrice;
  const previewUnitPrice = showPriceEditor
    ? (parsePriceInput(priceInput) ?? effectiveUnitPrice)
    : effectiveUnitPrice;
  const computed = computeLine({
    units: Number(units) || 0,
    unitPrice: line.unitPrice,
    unitPriceOverride:
      showPriceEditor && previewUnitPrice !== line.unitPrice
        ? previewUnitPrice
        : null,
    discountPct: Number(discountPct) || 0,
    taxRate: line.taxRate,
  });

  function commit() {
    const parsed = showPriceEditor ? parsePriceInput(priceInput) : null;
    const nextOverride =
      showPriceEditor && parsed != null && parsed !== line.unitPrice
        ? parsed
        : null;
    onChange({
      units: Math.max(0.001, Number(units) || 1),
      discountPct: Math.min(100, Math.max(0, Number(discountPct) || 0)),
      unitPriceOverride: nextOverride,
    });
    onClose();
  }

  // v1.2-Lite-fix1 Lote 2 (F1-UX): el sheet se rompía en monitores
  // cortos (Eliminar/Aplicar caían fuera del viewport). Lo
  // estructuramos en flex column con tres zonas:
  //   - Header fijo (título + precio bruto + cerrar).
  //   - Body scrollable (precio override, cantidad, descuento, modifiers).
  //   - Footer sticky (Eliminar | Cancelar | Aplicar), siempre visible.
  // Altura tope `min(100vh - 48px, 720px)` para que en mobile use casi
  // todo el alto y en monitores grandes no haya hueco innecesario.
  return (
    <div
      className="fixed inset-0 z-50 bg-mipiace-ink/40 flex items-end sm:items-center justify-center p-4 font-sans"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white w-full max-w-md rounded-3xl border border-slate-200 flex flex-col overflow-hidden"
        style={{ maxHeight: "min(calc(100vh - 48px), 720px)" }}
      >
        <div className="flex items-start justify-between px-6 md:px-7 pt-6 md:pt-7 pb-3 shrink-0 border-b border-slate-100">
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
            className="h-9 w-9 rounded-xl hover:bg-slate-50 text-slate-500 flex items-center justify-center shrink-0"
            aria-label="Cerrar"
          >
            <X className="w-4 h-4" strokeWidth={2.25} />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-6 md:px-7 pt-4 pb-6">
        {/* v1.2-Lite Lote 4.B · T-5: editor de precio puntual.
            Colapsado por defecto; al pulsar el lápiz se abre un input
            prellenado con el precio efectivo. "Restaurar" vuelve al
            precio del catálogo limpiando el override. Cualquier cajero
            puede tocarlo — la auditoría queda en BD vía
            unitPriceOverride. */}
        {onMoveToTable && (
          <button
            type="button"
            onClick={onMoveToTable}
            className="w-full h-12 mb-4 rounded-xl bg-mipiace-stone hover:bg-slate-100 text-[13.5px] font-medium text-mipiace-ink"
          >
            Mover esta línea a otra mesa
          </button>
        )}
        <div>
          <label className="block text-[13px] font-medium text-mipiace-ink-soft mb-2">
            Precio unitario
          </label>
          {!showPriceEditor ? (
            <div className="flex items-center gap-2">
              <div className="flex-1 h-12 px-3.5 rounded-xl bg-mipiace-stone text-[14.5px] tabular-nums flex items-center">
                {line.unitPriceOverride != null ? (
                  <span className="flex items-center gap-2">
                    <span className="text-amber-700 font-semibold">
                      {formatEur(line.unitPriceOverride)}
                    </span>
                    <span className="text-[11.5px] text-slate-500 line-through">
                      {formatEur(line.unitPrice)}
                    </span>
                  </span>
                ) : (
                  <span className="text-mipiace-ink">
                    {formatEur(line.unitPrice)}
                  </span>
                )}
              </div>
              {allowPriceOverride && (
                <button
                  type="button"
                  onClick={() => setShowPriceEditor(true)}
                  className="h-12 px-3.5 rounded-xl bg-mipiace-stone hover:bg-slate-100 text-slate-600 flex items-center gap-1.5 text-[13px] font-medium"
                  aria-label="Modificar precio"
                >
                  <Pencil className="w-3.5 h-3.5" />
                  Modificar
                </button>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <input
                value={priceInput}
                onChange={(e) => setPriceInput(e.target.value)}
                inputMode="decimal"
                className="flex-1 h-12 px-3.5 rounded-xl bg-mipiace-stone border border-transparent text-[14.5px] focus:bg-white focus:border-mipiace-coral/30 focus:ring-2 focus:ring-mipiace-coral/30 focus:outline-none tabular-nums text-right"
                placeholder="0,00"
                onKeyDown={(e) => {
                  if (e.key === "Enter") commit();
                }}
              />
              <button
                type="button"
                onClick={() => {
                  setShowPriceEditor(false);
                  setPriceInput(line.unitPrice.toFixed(2).replace(".", ","));
                }}
                className="h-12 px-3 rounded-xl bg-mipiace-stone hover:bg-slate-100 text-slate-600 flex items-center gap-1.5 text-[12.5px] font-medium"
                aria-label="Restaurar precio del catálogo"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Restaurar
              </button>
            </div>
          )}
          {showPriceEditor && (
            <p className="text-[11.5px] text-slate-400 mt-1.5">
              Pulsa Aplicar para guardar el precio. Se enviará a Holded
              tal cual lo cobres. Precio del catálogo:{" "}
              <span className="tabular-nums">{formatEur(line.unitPrice)}</span>.
            </p>
          )}
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
        </div>

        {/* Footer sticky: Eliminar a la izquierda con color rojo
            (acción destructiva, separada), Cancelar outline, Aplicar
            coral primario. Touch target >= 56px porque la cajera está
            apresurada y no queremos errores por dedos gordos. */}
        <div className="shrink-0 border-t border-slate-100 bg-white px-6 md:px-7 py-4 flex items-center gap-2.5">
          <button
            onClick={onRemove}
            className="h-14 px-4 rounded-2xl border border-slate-200 hover:bg-red-50 hover:text-red-700 text-[13.5px] text-slate-500 font-medium flex items-center gap-2 min-h-[56px]"
          >
            <Trash2 className="w-4 h-4" /> Eliminar
          </button>
          <button
            onClick={onClose}
            className="h-14 px-4 rounded-2xl border border-slate-200 hover:bg-slate-50 text-mipiace-ink-soft text-[13.5px] font-medium min-h-[56px]"
          >
            Cancelar
          </button>
          <button
            onClick={commit}
            className="flex-1 h-14 rounded-2xl bg-mipiace-coral hover:bg-mipiace-coral-dark text-white text-[14px] font-medium min-h-[56px]"
          >
            Aplicar
          </button>
        </div>
      </div>
    </div>
  );
}
