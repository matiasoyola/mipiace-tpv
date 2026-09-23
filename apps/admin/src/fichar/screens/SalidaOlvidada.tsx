// F1 · la salida olvidada, como CASO PRINCIPAL (ADR-018).
//
// Si hay un tramo abierto de un día anterior, esto es lo PRIMERO que el
// empleado ve. No el botón: la pregunta.
//
// Con hora propuesta —la mediana de sus últimas 30 salidas— se contesta de
// un toque. Sin historial no se propone nada y se elige: inventarse una
// hora con una muestra de cero sería exactamente lo que este bloque no
// hace. Y mientras nadie conteste, el tramo SIGUE ABIERTO; la empresa lo
// ve marcado "sin salida". Nunca se cierra solo.

import { useState } from "react";

import { ficharApi, FicharApiError } from "../lib/api.js";
import { diaLargo, hoyLocal, horaLocal } from "../lib/format.js";
import { TimeWheel } from "../components/TimeWheel.js";
import type { MeResponse } from "../lib/tipos.js";

function componerLocal(fecha: string, hora: string, timeZone: string): string {
  const [hh, mm] = hora.split(":").map(Number);
  const [y, mo, d] = fecha.split("-").map(Number);
  const guess = Date.UTC(y!, mo! - 1, d!, hh!, mm!);
  const off = (t: number) => {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).formatToParts(new Date(t));
    const m: Record<string, number> = {};
    for (const p of parts) if (p.type !== "literal") m[p.type] = Number(p.value);
    const hour = m.hour === 24 ? 0 : m.hour!;
    return Date.UTC(m.year!, m.month! - 1, m.day!, hour, m.minute!, m.second!) - t;
  };
  let r = guess - off(guess);
  const off2 = off(r);
  if (off2 !== off(guess)) r = guess - off2;
  return new Date(r).toISOString();
}

/**
 * "Ayer" cuando es ayer, y el día con nombre cuando es más atrás.
 *
 * Lo encontró el bucle visual: "Martes, 22 de septiembre no fichaste la
 * salida" obliga a hacer la cuenta mental de qué día fue ése. El caso
 * normal —y con diferencia el más frecuente— es ayer, y "ayer" se entiende
 * sin pensar.
 */
export function titular(fecha: string, timeZone: string, ahora = new Date()): string {
  const ayer = hoyLocal(timeZone, new Date(ahora.getTime() - 86_400_000));
  if (fecha === ayer) return "Ayer";
  return `El ${diaLargo(fecha, timeZone).toLowerCase()}`;
}

export function SalidaOlvidada({
  pendingExit,
  timeZone,
  onResuelta,
}: {
  pendingExit: NonNullable<MeResponse["pendingExit"]>;
  timeZone: string;
  onResuelta: () => void;
}) {
  const propuesta = pendingExit.suggestedEndAt
    ? horaLocal(pendingExit.suggestedEndAt, timeZone)
    : null;
  const [eligiendo, setEligiendo] = useState(propuesta === null);
  const [hora, setHora] = useState(propuesta ?? "17:00");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirmar(h: string) {
    setEnviando(true);
    setError(null);
    try {
      await ficharApi(`/fichaje/v1/entries/${pendingExit.entryId}/corrections`, {
        method: "POST",
        body: {
          field: "ended_at",
          value: componerLocal(pendingExit.date, h, timeZone),
          reasonCode: "OLVIDO",
        },
      });
      onResuelta();
    } catch (err) {
      setError(
        err instanceof FicharApiError
          ? err.message
          : "No se ha podido guardar. Inténtalo otra vez.",
      );
      setEnviando(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-md px-5 py-8">
      <div className="rounded-3xl bg-white p-6">
        <h1 className="text-[22px] font-semibold leading-tight tracking-[-0.01em] text-mipiace-ink">
          {titular(pendingExit.date, timeZone)} no fichaste la salida.
        </h1>
        <p className="mt-1.5 text-[15px] text-slate-500">
          Entraste a las{" "}
          <span className="tabular-nums">
            {horaLocal(pendingExit.startedAt, timeZone)}
          </span>
          . ¿A qué hora saliste?
        </p>

        {!eligiendo && propuesta ? (
          <>
            <div className="my-7 text-center">
              <div className="text-[56px] font-semibold leading-none tabular-nums tracking-[-0.025em] text-mipiace-ink">
                {propuesta}
              </div>
              <div className="mt-2 text-[13px] text-slate-400">
                Es tu hora de salida habitual
              </div>
            </div>
            <button
              type="button"
              onClick={() => confirmar(propuesta)}
              disabled={enviando}
              className="h-touch-lg w-full rounded-2xl bg-mipiace-coral text-[17px] font-medium text-white transition-colors hover:bg-mipiace-coral-dark disabled:opacity-60"
            >
              {enviando ? "Guardando…" : `Salí a las ${propuesta}`}
            </button>
            <button
              type="button"
              onClick={() => setEligiendo(true)}
              className="mt-2 h-touch w-full rounded-2xl text-[15px] font-medium text-mipiace-coral-dark hover:bg-mipiace-coral-soft"
            >
              Fue a otra hora
            </button>
          </>
        ) : (
          <>
            <div className="my-6">
              <TimeWheel value={hora} onChange={setHora} />
            </div>
            <button
              type="button"
              onClick={() => confirmar(hora)}
              disabled={enviando}
              className="h-touch-lg w-full rounded-2xl bg-mipiace-coral text-[17px] font-medium text-white transition-colors hover:bg-mipiace-coral-dark disabled:opacity-60"
            >
              {enviando ? "Guardando…" : `Salí a las ${hora}`}
            </button>
          </>
        )}

        {error && (
          <p role="alert" className="mt-3 text-center text-[13.5px] text-mipiace-coral-dark">
            {error}
          </p>
        )}
      </div>
      <p className="mt-4 px-2 text-center text-[13px] text-slate-400">
        Queda guardado como corrección, con el motivo &laquo;se me olvidó
        fichar&raquo;. Tu fichaje original no se borra.
      </p>
    </div>
  );
}
