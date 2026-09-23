// F1 · la hoja de abajo. Todo lo que no es el botón vive aquí: corregir,
// el historial, la pregunta de la salida olvidada.
//
// Abajo y no centrada: en un móvil sujeto con una mano, el pulgar llega
// al tercio inferior y no al centro. Misma regla que el `ConfirmSheet` del
// TPV (tokens.md §5).

import { useEffect } from "react";
import { X } from "lucide-react";

export function Sheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-mipiace-ink/40 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
    >
      <div
        // max-h + scroll: lo encontró el bucle visual. A 390x760 con el
        // selector de hora abierto, la hoja medía más que la pantalla y el
        // título y el botón de guardar se quedaban fuera, sin forma de
        // llegar a ellos.
        className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-white p-6 pb-8 sm:max-h-[86vh] sm:rounded-3xl sm:pb-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-start justify-between gap-3">
          <h2 className="text-[20px] font-semibold tracking-[-0.01em] text-mipiace-ink">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="-mr-2 -mt-2 flex h-touch w-touch items-center justify-center rounded-2xl text-slate-400 hover:bg-mipiace-stone hover:text-mipiace-ink"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
