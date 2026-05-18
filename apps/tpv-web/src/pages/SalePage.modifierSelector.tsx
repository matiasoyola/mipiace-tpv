// B-Bar-Modifiers · modal de selección de modificadores al añadir línea.
//
// Se abre al pulsar un tile de producto que tiene grupos asociados.
// Cabecera: nombre + precio base. Cuerpo: un grupo por sección — radios
// si `exclusive`, checkboxes si no. Footer: subtotal en vivo + botón
// "Añadir al ticket" (deshabilitado si algún grupo `required` queda sin
// selección).

import { useEffect, useMemo, useState } from "react";

import type { CatalogProduct } from "../lib/catalog.js";
import type {
  CatalogModifier,
  CatalogModifierGroup,
} from "../lib/modifiers.js";
import type { ModifierSelection } from "../lib/cart.js";

const formatEur = (n: number) => n.toFixed(2).replace(".", ",") + " €";

function formatDelta(cents: number): string | null {
  if (cents === 0) return null;
  const sign = cents > 0 ? "+ " : "− ";
  return `${sign}${formatEur(Math.abs(cents) / 100)}`;
}

export interface ModifierSelectorProps {
  product: CatalogProduct;
  groups: CatalogModifierGroup[];
  onCancel: () => void;
  onConfirm: (selections: ModifierSelection[]) => void;
}

// Estado interno: por cada grupo, un Set de modifierIds seleccionados.
// Defaults: en grupos exclusive con un modifier marcado isDefault, lo
// pre-seleccionamos. En el resto, vacío.
function initialSelection(
  groups: CatalogModifierGroup[],
): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const g of groups) {
    const set = new Set<string>();
    if (g.exclusive) {
      const def = g.modifiers.find((m) => m.isDefault);
      if (def) set.add(def.id);
    }
    map.set(g.id, set);
  }
  return map;
}

export function ModifierSelector({
  product,
  groups,
  onCancel,
  onConfirm,
}: ModifierSelectorProps) {
  const [selection, setSelection] = useState<Map<string, Set<string>>>(() =>
    initialSelection(groups),
  );

  // Resetear cuando cambia el producto (no debería pasar mientras el modal
  // está abierto, pero defensivo).
  useEffect(() => {
    setSelection(initialSelection(groups));
  }, [groups, product.id]);

  function toggle(group: CatalogModifierGroup, modifierId: string): void {
    setSelection((curr) => {
      const next = new Map(curr);
      const set = new Set(next.get(group.id) ?? []);
      if (group.exclusive) {
        // Radio: una sola selección activa.
        if (set.has(modifierId)) {
          // Click sobre la opción ya marcada: si NO es required, permite
          // deseleccionar; si es required, ignoramos para no dejar el
          // grupo vacío.
          if (!group.required) set.delete(modifierId);
        } else {
          set.clear();
          set.add(modifierId);
        }
      } else {
        if (set.has(modifierId)) set.delete(modifierId);
        else set.add(modifierId);
      }
      next.set(group.id, set);
      return next;
    });
  }

  // Lista final de selections desnormalizadas.
  const selections = useMemo<ModifierSelection[]>(() => {
    const out: ModifierSelection[] = [];
    for (const g of groups) {
      const set = selection.get(g.id);
      if (!set) continue;
      for (const m of g.modifiers) {
        if (set.has(m.id)) {
          out.push({
            groupId: g.id,
            groupName: g.name,
            modifierId: m.id,
            label: m.label,
            priceDeltaCents: m.priceDeltaCents,
          });
        }
      }
    }
    return out;
  }, [groups, selection]);

  const missingRequired = useMemo(() => {
    for (const g of groups) {
      if (!g.required) continue;
      const set = selection.get(g.id);
      if (!set || set.size === 0) return g;
    }
    return null;
  }, [groups, selection]);

  // Precio bruto del producto + sum deltas seleccionados (CON IVA).
  const deltaCents = selections.reduce((acc, s) => acc + s.priceDeltaCents, 0);
  const subtotalWithIva =
    product.priceGross + (deltaCents / 100) * (1 + product.taxRate / 100);
  const baseLabelWithIva = formatEur(product.priceGross);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-slate-900/40"
      onClick={onCancel}
      role="dialog"
      aria-modal="true"
      aria-label={`Modificadores de ${product.name}`}
    >
      <div
        className="w-full md:max-w-lg bg-white rounded-t-2xl md:rounded-2xl shadow-xl flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="px-5 md:px-6 py-4 border-b border-slate-100">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-[16.5px] md:text-[17.5px] font-semibold text-mipiace-ink leading-tight">
              {product.name}
            </h2>
            <span className="text-[14px] text-slate-500 tabular-nums shrink-0">
              {baseLabelWithIva}
            </span>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto px-5 md:px-6 py-4 space-y-5">
          {groups.map((group) => (
            <GroupSection
              key={group.id}
              group={group}
              selectedIds={selection.get(group.id) ?? new Set()}
              onToggle={(mid) => toggle(group, mid)}
            />
          ))}
        </div>

        <footer className="px-5 md:px-6 py-4 border-t border-slate-100 flex items-center gap-3">
          <div className="flex-1">
            <div className="text-[12px] text-slate-500 leading-tight">
              Subtotal
            </div>
            <div className="text-[20px] font-semibold text-mipiace-ink tabular-nums leading-tight">
              {formatEur(subtotalWithIva)}
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="h-11 px-4 rounded-xl text-[14px] font-medium text-mipiace-ink bg-mipiace-stone hover:bg-slate-100"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => onConfirm(selections)}
            disabled={missingRequired != null}
            className="h-11 px-4 rounded-xl text-[14px] font-semibold text-white bg-mipiace-ink hover:bg-slate-700 disabled:bg-slate-300 disabled:cursor-not-allowed"
            title={
              missingRequired
                ? `Selecciona una opción de "${missingRequired.name}"`
                : "Añadir al ticket"
            }
          >
            Añadir al ticket
          </button>
        </footer>
      </div>
    </div>
  );
}

function GroupSection({
  group,
  selectedIds,
  onToggle,
}: {
  group: CatalogModifierGroup;
  selectedIds: Set<string>;
  onToggle: (modifierId: string) => void;
}) {
  return (
    <section>
      <header className="flex items-baseline justify-between mb-2">
        <h3 className="text-[14px] font-semibold text-mipiace-ink">
          {group.name}
          {group.required && (
            <span className="ml-2 text-[12px] font-normal text-mipiace-coral">
              · obligatorio
            </span>
          )}
        </h3>
        <span className="text-[12px] text-slate-400">
          {group.exclusive ? "Elige uno" : "Elige varios"}
        </span>
      </header>
      <div className="space-y-1">
        {group.modifiers.map((m) => (
          <ModifierRow
            key={m.id}
            modifier={m}
            checked={selectedIds.has(m.id)}
            exclusive={group.exclusive}
            onToggle={() => onToggle(m.id)}
          />
        ))}
      </div>
    </section>
  );
}

function ModifierRow({
  modifier,
  checked,
  exclusive,
  onToggle,
}: {
  modifier: CatalogModifier;
  checked: boolean;
  exclusive: boolean;
  onToggle: () => void;
}) {
  const deltaLabel = formatDelta(modifier.priceDeltaCents);
  const Indicator = exclusive ? RadioDot : CheckBox;
  return (
    <button
      type="button"
      onClick={onToggle}
      role={exclusive ? "radio" : "checkbox"}
      aria-checked={checked}
      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-colors ${
        checked
          ? "bg-mipiace-stone"
          : "bg-white hover:bg-slate-50"
      }`}
    >
      <Indicator checked={checked} />
      <span className="flex-1 text-[14px] text-mipiace-ink">
        {modifier.label}
      </span>
      {deltaLabel && (
        <span
          className={`text-[13px] tabular-nums ${
            modifier.priceDeltaCents > 0
              ? "text-mipiace-ink"
              : "text-mipiace-coral"
          }`}
        >
          {deltaLabel}
        </span>
      )}
    </button>
  );
}

function RadioDot({ checked }: { checked: boolean }) {
  return (
    <span
      className={`h-5 w-5 rounded-full border-2 shrink-0 flex items-center justify-center ${
        checked ? "border-mipiace-ink" : "border-slate-300"
      }`}
      aria-hidden
    >
      {checked && <span className="h-2.5 w-2.5 rounded-full bg-mipiace-ink" />}
    </span>
  );
}

function CheckBox({ checked }: { checked: boolean }) {
  return (
    <span
      className={`h-5 w-5 rounded-md border-2 shrink-0 flex items-center justify-center ${
        checked
          ? "border-mipiace-ink bg-mipiace-ink"
          : "border-slate-300 bg-white"
      }`}
      aria-hidden
    >
      {checked && (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 12 12"
          className="h-3 w-3 text-white"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M2 6.5l2.5 2.5L10 3.5" />
        </svg>
      )}
    </span>
  );
}
