// F1 · el motivo, de un toque (ADR-018).
//
// Tres opciones y sólo una pide escribir. El motivo es obligatorio —lo
// exige la base de datos, no el formulario— pero obligar a redactar
// convierte cada corrección en un "." y la traza deja de valer. Con tres
// botones grandes se contesta de verdad.

import { CORRECTION_REASONS, type ReasonCode } from "../lib/tipos.js";

export function ReasonPicker({
  value,
  text,
  onChange,
  onTextChange,
}: {
  value: ReasonCode | null;
  text: string;
  onChange: (r: ReasonCode) => void;
  onTextChange: (t: string) => void;
}) {
  return (
    <div>
      <div className="mb-2 text-[13px] font-medium text-mipiace-ink-soft">
        ¿Qué pasó?
      </div>
      <div className="grid gap-2">
        {CORRECTION_REASONS.map((r) => {
          const activo = value === r.code;
          return (
            <button
              key={r.code}
              type="button"
              onClick={() => onChange(r.code)}
              aria-pressed={activo}
              className={`flex min-h-touch items-center rounded-2xl px-4 text-left text-[15px] transition-colors ${
                activo
                  ? "bg-mipiace-coral-soft font-medium text-mipiace-coral-dark ring-1 ring-mipiace-coral/40"
                  : "bg-mipiace-stone text-mipiace-ink hover:bg-slate-100"
              }`}
            >
              {r.label}
            </button>
          );
        })}
      </div>
      {value === "OTRO" && (
        <input
          autoFocus
          value={text}
          onChange={(e) => onTextChange(e.target.value)}
          maxLength={300}
          placeholder="En una línea: qué pasó"
          aria-label="Explica qué pasó"
          className="mt-2 h-touch w-full rounded-2xl border border-transparent bg-mipiace-stone px-4 text-[15px] text-mipiace-ink outline-none placeholder:text-slate-400 focus:border-mipiace-coral/30 focus:bg-white focus:ring-2 focus:ring-mipiace-coral/40"
        />
      )}
    </div>
  );
}
