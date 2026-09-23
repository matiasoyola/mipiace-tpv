// F1 · "Mis fichajes" (ADR-018).
//
// El derecho del trabajador a ver SU registro, cubierto aquí: los días del
// mes con entrada, salida y total, cada uno tocable para corregirlo, y los
// corregidos marcados. No hay nada más — ni otros empleados, ni ajustes.

import { ChevronRight, CloudOff, PencilLine } from "lucide-react";

import { diaCorto, duracion } from "../lib/format.js";
import type { DayView, EntryView, MonthView } from "../lib/tipos.js";

export function MisFichajes({
  month,
  timeZone,
  onTocar,
}: {
  month: MonthView;
  timeZone: string;
  onTocar: (entry: EntryView) => void;
}) {
  return (
    <section className="mt-9" aria-labelledby="mis-fichajes">
      <div className="mb-3 flex items-baseline justify-between">
        <h2
          id="mis-fichajes"
          className="text-[17px] font-semibold tracking-[-0.01em] text-mipiace-ink"
        >
          Mis fichajes
        </h2>
        <span className="text-[13px] tabular-nums text-slate-500">
          {duracion(month.totalMinutes)} este mes
        </span>
      </div>

      {month.days.length === 0 ? (
        <p className="rounded-2xl bg-white px-4 py-6 text-center text-[14px] text-slate-500">
          Todavía no has fichado este mes.
        </p>
      ) : (
        <ul className="space-y-2">
          {[...month.days].reverse().map((dia) => (
            <Dia key={dia.date} dia={dia} timeZone={timeZone} onTocar={onTocar} />
          ))}
        </ul>
      )}
    </section>
  );
}

function Dia({
  dia,
  timeZone,
  onTocar,
}: {
  dia: DayView;
  timeZone: string;
  onTocar: (entry: EntryView) => void;
}) {
  const enCurso = dia.entries.some((e) => e.open);
  return (
    <li className="overflow-hidden rounded-2xl bg-white">
      <div className="flex items-baseline justify-between px-4 pt-3">
        <span className="text-[13px] font-medium text-mipiace-ink-soft">
          {diaCorto(dia.date, timeZone)}
        </span>
        <span className="text-[13px] font-medium tabular-nums text-mipiace-ink">
          {enCurso && dia.totalMinutes === 0 ? (
            // "0h 00m" para un día que todavía se está trabajando es la
            // pega que este bloque le pone a Holded. Mientras el tramo
            // esté abierto, el día no tiene total: está en curso.
            <span className="text-mipiace-coral-dark">En curso</span>
          ) : (
            duracion(dia.totalMinutes)
          )}
        </span>
      </div>
      <ul>
        {dia.entries.map((e) => (
          <li key={e.id}>
            <button
              type="button"
              onClick={() => onTocar(e)}
              className="flex min-h-touch w-full items-center gap-3 px-4 py-2 text-left hover:bg-mipiace-stone"
            >
              <span className="text-[16px] tabular-nums text-mipiace-ink">
                {e.startedLocal}
                <span className="mx-1.5 text-slate-300">→</span>
                {e.endedLocal ?? (
                  <span className="text-mipiace-coral-dark">sin salida</span>
                )}
              </span>
              <span className="ml-auto flex items-center gap-1.5">
                {e.offline && (
                  <CloudOff
                    className="h-4 w-4 text-slate-400"
                    aria-label="Enviado sin conexión"
                  />
                )}
                {e.corrected && (
                  <span className="inline-flex items-center gap-1 rounded-xl bg-mipiace-coral-soft px-2 py-0.5 text-[11px] font-medium text-mipiace-coral-dark">
                    <PencilLine className="h-3 w-3" />
                    Corregido
                  </span>
                )}
                <ChevronRight className="h-4 w-4 text-slate-300" />
              </span>
            </button>
          </li>
        ))}
      </ul>
    </li>
  );
}
