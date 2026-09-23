// F1 · corregir un fichaje, y ver por qué está corregido (ADR-018).
//
// Dos hojas en un fichero porque son la misma pieza vista desde los dos
// lados: la marca "Corregido" abre el historial, y el historial lleva al
// botón de volver a corregir.
//
// Sin circuito de aprobación: el trabajador corrige lo suyo y queda
// trazado. Lo que impide que eso sea un agujero no es un jefe que aprueba,
// es que el valor anterior no se puede borrar (ADR-018 §3).

import { useEffect, useState } from "react";

import { ficharApi, FicharApiError } from "../lib/api.js";
import { diaLargo, horaLocal } from "../lib/format.js";
import { reasonLabel, type CorrectionView, type EntryView, type ReasonCode } from "../lib/tipos.js";
import { ReasonPicker } from "../components/ReasonPicker.js";
import { Sheet } from "../components/Sheet.js";
import { TimeWheel } from "../components/TimeWheel.js";

/** "HH:MM" del día local del fichaje → instante ISO. Se compone con la
 *  fecha del propio fichaje, no con "hoy": corregir la salida de ayer
 *  tiene que quedarse en ayer. */
function componer(fecha: string, hora: string, timeZone: string): string {
  // Se busca el instante cuya hora de pared en `timeZone` es la pedida.
  // Dos pasadas bastan para el borde del cambio de hora, igual que en
  // `agenda/time.ts` del servidor.
  const [hh, mm] = hora.split(":").map(Number);
  const [y, mo, d] = fecha.split("-").map(Number);
  const guess = Date.UTC(y!, mo! - 1, d!, hh!, mm!);
  const off = (t: number) => {
    const s = new Intl.DateTimeFormat("en-US", {
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
    for (const p of s) if (p.type !== "literal") m[p.type] = Number(p.value);
    const hour = m.hour === 24 ? 0 : m.hour!;
    return (
      Date.UTC(m.year!, m.month! - 1, m.day!, hour, m.minute!, m.second!) - t
    );
  };
  let r = guess - off(guess);
  const off2 = off(r);
  if (off2 !== off(guess)) r = guess - off2;
  return new Date(r).toISOString();
}

export function CorregirSheet({
  entry,
  timeZone,
  onClose,
  onHecho,
}: {
  entry: EntryView;
  timeZone: string;
  onClose: () => void;
  onHecho: () => void;
}) {
  const [campo, setCampo] = useState<"started_at" | "ended_at">(
    entry.open ? "started_at" : "ended_at",
  );
  const [hora, setHora] = useState(
    (entry.open ? entry.startedLocal : entry.endedLocal) ?? entry.startedLocal,
  );
  const [motivo, setMotivo] = useState<ReasonCode | null>(null);
  const [texto, setTexto] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [verHistorial, setVerHistorial] = useState(false);

  function cambiarCampo(next: "started_at" | "ended_at") {
    setCampo(next);
    setHora(
      (next === "started_at" ? entry.startedLocal : entry.endedLocal) ??
        entry.startedLocal,
    );
  }

  async function guardar() {
    if (!motivo) {
      setError("Elige un motivo.");
      return;
    }
    setEnviando(true);
    setError(null);
    try {
      await ficharApi(`/fichaje/v1/entries/${entry.id}/corrections`, {
        method: "POST",
        body: {
          field: campo,
          value: componer(entry.date, hora, timeZone),
          reasonCode: motivo,
          ...(motivo === "OTRO" ? { reasonText: texto } : {}),
        },
      });
      onHecho();
    } catch (err) {
      setError(
        err instanceof FicharApiError ? err.message : "No se ha podido guardar.",
      );
      setEnviando(false);
    }
  }

  if (verHistorial) {
    return (
      <HistorialSheet
        entry={entry}
        timeZone={timeZone}
        onClose={() => setVerHistorial(false)}
      />
    );
  }

  return (
    <Sheet title={diaLargo(entry.date, timeZone)} onClose={onClose}>
      <div className="space-y-5">
        {entry.corrected && (
          <button
            type="button"
            onClick={() => setVerHistorial(true)}
            className="flex min-h-touch w-full items-center justify-between rounded-2xl bg-mipiace-coral-soft px-4 text-left text-[14px] font-medium text-mipiace-coral-dark"
          >
            Este fichaje está corregido
            <span className="text-[13px] font-normal">Ver historial</span>
          </button>
        )}

        <div className="grid grid-cols-2 gap-2" role="group" aria-label="Qué corrijo">
          {(
            [
              ["started_at", "Entrada", entry.startedLocal],
              ["ended_at", "Salida", entry.endedLocal ?? "—"],
            ] as const
          ).map(([id, label, valor]) => (
            <button
              key={id}
              type="button"
              disabled={id === "ended_at" && entry.open}
              onClick={() => cambiarCampo(id)}
              aria-pressed={campo === id}
              className={`min-h-touch rounded-2xl px-3 py-2 text-left transition-colors disabled:opacity-40 ${
                campo === id
                  ? "bg-mipiace-coral-soft ring-1 ring-mipiace-coral/40"
                  : "bg-mipiace-stone"
              }`}
            >
              <span className="block text-[11px] uppercase tracking-[0.08em] text-slate-500">
                {label}
              </span>
              <span className="text-[18px] font-medium tabular-nums text-mipiace-ink">
                {valor}
              </span>
            </button>
          ))}
        </div>

        <TimeWheel value={hora} onChange={setHora} />

        <ReasonPicker
          value={motivo}
          text={texto}
          onChange={setMotivo}
          onTextChange={setTexto}
        />

        {error && (
          <p role="alert" className="text-[13.5px] text-mipiace-coral-dark">
            {error}
          </p>
        )}

        {/* Pegado al borde inferior de la hoja: con el selector abierto en
            un móvil de 390, el botón quedaba por debajo del pliegue y
            había que scrollear para guardar lo que ya estaba elegido.
            Segunda pasada del bucle visual. */}
        <div className="sticky bottom-0 -mx-6 -mb-8 bg-white px-6 pb-8 pt-3 sm:-mb-6 sm:pb-6">
          <button
            type="button"
            onClick={guardar}
            disabled={enviando}
            className="h-touch-lg w-full rounded-2xl bg-mipiace-coral text-[16px] font-medium text-white transition-colors hover:bg-mipiace-coral-dark disabled:opacity-60"
          >
            {enviando ? "Guardando…" : "Guardar corrección"}
          </button>
        </div>
      </div>
    </Sheet>
  );
}

export function HistorialSheet({
  entry,
  timeZone,
  onClose,
}: {
  entry: EntryView;
  timeZone: string;
  onClose: () => void;
}) {
  const [items, setItems] = useState<CorrectionView[] | null>(null);
  useEffect(() => {
    let vivo = true;
    ficharApi<{ corrections: CorrectionView[] }>(
      `/fichaje/v1/entries/${entry.id}/corrections`,
    )
      .then((r) => vivo && setItems(r.corrections))
      .catch(() => vivo && setItems([]));
    return () => {
      vivo = false;
    };
  }, [entry.id]);

  return (
    <Sheet title="Historial de cambios" onClose={onClose}>
      {items === null ? (
        <p className="py-6 text-center text-[14px] text-slate-500">Cargando…</p>
      ) : items.length === 0 ? (
        <p className="py-6 text-center text-[14px] text-slate-500">
          Este fichaje no se ha tocado.
        </p>
      ) : (
        <ol className="space-y-3">
          {items.map((c) => (
            <li key={c.id} className="rounded-2xl bg-mipiace-stone p-4">
              <div className="text-[15px] text-mipiace-ink">
                {c.kind === "ALTA" ? (
                  <>
                    <span className="font-medium">
                      {c.field === "started_at" ? "Entrada" : "Salida"}
                    </span>{" "}
                    añadida:{" "}
                    <span className="tabular-nums">
                      {c.newValue ? horaLocal(c.newValue, timeZone) : "—"}
                    </span>
                  </>
                ) : (
                  <>
                    <span className="font-medium">
                      {c.field === "started_at" ? "Entrada" : "Salida"}
                    </span>{" "}
                    <span className="tabular-nums text-slate-500 line-through">
                      {c.oldValue ? horaLocal(c.oldValue, timeZone) : "sin poner"}
                    </span>
                    <span className="mx-1.5 text-slate-300">→</span>
                    <span className="font-medium tabular-nums">
                      {c.newValue ? horaLocal(c.newValue, timeZone) : "—"}
                    </span>
                  </>
                )}
              </div>
              <div className="mt-1 text-[13px] text-slate-500">
                {reasonLabel(c.reasonCode)}
                {c.reasonText ? ` · ${c.reasonText}` : ""}
              </div>
              <div className="mt-0.5 text-[12px] text-slate-400">
                {c.author}
                {c.authorKind === "PANEL" ? " (empresa)" : ""} ·{" "}
                {diaLargo(c.createdAt.slice(0, 10), timeZone)} a las{" "}
                {horaLocal(c.createdAt, timeZone)}
              </div>
            </li>
          ))}
        </ol>
      )}
    </Sheet>
  );
}
