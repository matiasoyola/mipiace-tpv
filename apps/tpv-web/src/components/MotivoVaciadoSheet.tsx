// auditoria-sirope (#18) · POR QUÉ SE VACÍA ESTA MESA.
//
// El 18-10 se vaciaron cinco mesas con consumo y no quedó rastro de
// ninguna: ni motivo, ni importe en el Z, ni nada que mirar al día
// siguiente. Vaciar una mesa con platos dentro es comida que salió de la
// cocina y no se cobró, y hay tres formas muy distintas de que eso pase.
//
// ── Por qué no es un campo de texto ──────────────────────────────────
//
// Porque lo que se hace con el dato es contarlo: «este mes hemos
// invitado por 240 €» es una frase que se puede decir con cuatro
// opciones y no con texto libre, donde «invitacion», «Invitación» e
// «invit.» son tres cosas distintas. «Otro» existe para lo que no entra
// en las tres, y es el que avisa de que falta una opción el día que se
// use mucho.
//
// ── Por qué cuatro botones grandes y no un desplegable ───────────────
//
// Esto se contesta con una mesa de gente delante y a veces de pie. Un
// `<select>` son dos toques y una lista que tapa la pantalla; cuatro
// botones de 56 px son uno.

import { useState } from "react";

import { useBackGuard } from "../hooks/useBackGuard.js";

export type MotivoVaciado =
  | "INVITACION"
  | "ERROR_DE_COMANDA"
  | "SE_FUERON_SIN_PAGAR"
  | "OTRO";

const MOTIVOS: Array<{ valor: MotivoVaciado; label: string; hint: string }> = [
  {
    valor: "INVITACION",
    label: "Invitación",
    hint: "La casa invita: un detalle, una queja resuelta, un amigo.",
  },
  {
    valor: "ERROR_DE_COMANDA",
    label: "Error de comanda",
    hint: "Se pidió mal o se marcó en la mesa que no era.",
  },
  {
    valor: "SE_FUERON_SIN_PAGAR",
    label: "Se fueron sin pagar",
    hint: "Consumieron y se marcharon.",
  },
  { valor: "OTRO", label: "Otro", hint: "Ninguna de las anteriores." },
];

export function MotivoVaciadoSheet({
  tableName,
  total,
  onCancel,
  onConfirm,
}: {
  tableName: string;
  /** Lo que vale lo que se va a tirar, ya formateado. */
  total: string;
  onCancel: () => void;
  onConfirm: (motivo: MotivoVaciado) => void;
}) {
  const [elegido, setElegido] = useState<MotivoVaciado | null>(null);
  // El Atrás del sistema es la salida neutra, nunca vaciar.
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
        aria-label="Por qué se vacía la mesa"
        data-testid="motivo-vaciado"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md bg-white rounded-3xl border border-slate-200 p-5 sm:p-6"
      >
        <h2 className="text-[18px] font-semibold text-mipiace-ink tracking-tight mb-1">
          Vaciar {tableName}
        </h2>
        <p className="text-[14px] text-slate-500 leading-relaxed mb-4">
          Se tiran <strong className="text-mipiace-ink">{total}</strong> de
          consumo y la mesa queda libre. ¿Qué ha pasado?
        </p>
        <div className="space-y-2 mb-5">
          {MOTIVOS.map((m) => (
            <button
              key={m.valor}
              type="button"
              data-testid={`motivo-${m.valor}`}
              aria-pressed={elegido === m.valor}
              onClick={() => setElegido(m.valor)}
              className={`w-full min-h-touch rounded-2xl border px-4 py-2.5 text-left ${
                elegido === m.valor
                  ? "border-mipiace-coral bg-mipiace-coral-soft"
                  : "border-slate-200 hover:bg-slate-50"
              }`}
            >
              <span className="block text-[14.5px] font-medium text-mipiace-ink">
                {m.label}
              </span>
              <span className="block text-[12.5px] text-slate-500">
                {m.hint}
              </span>
            </button>
          ))}
        </div>
        <div className="flex flex-col-reverse sm:flex-row gap-2.5">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 h-touch rounded-2xl border border-slate-200 hover:bg-slate-50 text-[14px] font-medium text-mipiace-ink-soft"
          >
            Volver
          </button>
          <button
            type="button"
            disabled={elegido == null}
            data-testid="motivo-confirmar"
            onClick={() => elegido && onConfirm(elegido)}
            className="flex-1 h-touch rounded-2xl bg-mipiace-coral hover:bg-mipiace-coral-dark disabled:opacity-40 text-white text-[14px] font-medium"
          >
            Vaciar la mesa
          </button>
        </div>
      </div>
    </div>
  );
}
