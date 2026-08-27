// v1.12-manos-de-camarero · confirmación de acciones destructivas
// (hallazgo H5 del 2026-08-27).
//
// Lo que había: `confirm("¿Vaciar la mesa? La cuenta se cancela.")`. En
// el terminal sale como *"mipiacetpv.com dice: ¿Vaciar la mesa?"* con
// botones azules de Chrome — rompe la marca — y, peor, con dos
// "Cancelar" que significan cosas opuestas: cancelar la cuenta y
// cancelar el diálogo. El camarero no puede leer dos veces en barra.
//
// Reglas del componente:
//   - Verbos explícitos en los dos botones. Nunca "Sí/No", nunca
//     "Aceptar/Cancelar".
//   - Los dos botones NO empiezan por la misma palabra: "Cancelar la
//     cuenta" / "Seguir con la cuenta", no "Cancelar" / "Cancelar".
//   - La acción destructiva en coral; la salida, neutra.
//   - Objetivos táctiles de la escala `touch` (48 px), que es lo que
//     mide un dedo con prisa.

import { useBackGuard } from "../hooks/useBackGuard.js";

export function ConfirmSheet({
  title,
  body,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
}: {
  title: string;
  body?: string;
  // Verbo de lo que va a pasar: "Vaciar mesa", "Cancelar la cuenta".
  confirmLabel: string;
  // Verbo de quedarse como está: "Volver", "Seguir con la cuenta".
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  // El Atrás del sistema equivale a la salida neutra, nunca a la
  // acción destructiva.
  useBackGuard(onCancel);

  return (
    <div
      className="fixed inset-0 z-[70] bg-mipiace-ink/50 flex items-end sm:items-center justify-center p-3 sm:p-4 font-sans"
      onClick={onCancel}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md bg-white rounded-3xl border border-slate-200 p-5 sm:p-6"
      >
        <h2 className="text-[18px] font-semibold text-mipiace-ink tracking-tight mb-1.5">
          {title}
        </h2>
        {body && (
          <p className="text-[14px] text-slate-500 leading-relaxed mb-5">
            {body}
          </p>
        )}
        <div className="flex flex-col-reverse sm:flex-row gap-2.5">
          {/* La salida va primero en el DOM y a la izquierda en fila:
              en móvil queda ABAJO, que es donde cae el pulgar por
              defecto. Salir de una acción destructiva tiene que ser lo
              barato. */}
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 h-touch rounded-2xl border border-slate-200 hover:bg-slate-50 text-[14px] font-medium text-mipiace-ink-soft"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="flex-1 h-touch rounded-2xl bg-mipiace-coral hover:bg-mipiace-coral-dark text-white text-[14px] font-medium"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
