// residencia-2 · EL SELECTOR DE FRECUENCIA, a pulsaciones.
//
// Lo usan las tres pantallas del bloque (Controles, Plantillas y el plan
// de un residente), y vive aparte por eso: una frecuencia mal construida
// es un 400 del servidor, y tres copias de este componente darían tres
// formas distintas de equivocarse.
//
// ── «Mucho clic y poco escribir» ─────────────────────────────────────
//
// `metodologia-front-mipiace`. Aquí no se teclea NADA: el tipo son
// botones, los turnos son botones, los momentos son botones, los días de
// la semana son siete letras y las horas son los seis divisores de 24. El
// único número que se escribe es «cada N días» y el día del mes, y los dos
// con un `<input type="number">` acotado.
//
// ── Sólo ofrece lo que el producto permite ───────────────────────────
//
// `permitidas` viene de la API (`puedeElegir.frecuencias`) y no de esta
// pantalla. Es la frontera estándar / centro: el día que una guía retire
// una frecuencia, el botón desaparece sin desplegar el panel. Si se
// cablearan aquí las ocho, la pantalla ofrecería algo que el servidor
// rechaza — y el usuario no sabría por qué.

import {
  DIAS_SEMANA_UI,
  FRECUENCIA_LABEL,
  HORAS_OFRECIDAS,
  type FrecuenciaUI,
  type MomentoDelDia,
  type TipoDeFrecuencia,
  type TurnoCorto,
} from "./lib.js";

/** Un botón de elección, el mismo que usan las demás pantallas del centro. */
export function Pastilla({
  activo,
  onClick,
  children,
  title,
}: {
  activo: boolean;
  onClick: () => void;
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`min-h-[44px] rounded-xl border px-3.5 text-[13.5px] transition-colors ${
        activo
          ? "border-mipiace-coral bg-mipiace-coral/10 font-medium text-mipiace-ink"
          : "border-slate-200 text-slate-600 hover:bg-slate-50"
      }`}
    >
      {children}
    </button>
  );
}

/**
 * Lo que hace falta para construir una frecuencia de un `kind` dado, con
 * los campos que ese `kind` usa y **ninguno más**.
 *
 * Los que no usa salen a `undefined` y no se quedan del tipo anterior: es
 * lo que el CHECK `…_frecuencia_coherente` de la base exige, y el error
 * más fácil de cometer aquí («cambio de tipo y me dejo los turnos
 * marcados») se evita construyendo la frecuencia desde cero en cada
 * cambio de tipo en vez de mutando la anterior.
 */
function conTipo(
  kind: TipoDeFrecuencia,
  turnos: TurnoCorto[],
  momentos: MomentoDelDia[],
): FrecuenciaUI {
  const primerTurno = turnos[0]?.code ?? "M";
  switch (kind) {
    case "EVERY_SHIFT":
      return { kind, shiftCodes: turnos.map((t) => t.code) };
    case "DAILY":
      return { kind, shiftCodes: [primerTurno] };
    case "MOMENTS":
      return { kind, momentCodes: momentos.length > 0 ? [momentos[0]!.code] : [] };
    case "EVERY_N_HOURS":
      return { kind, everyNHours: 3 };
    case "WEEKDAYS":
      return { kind, weekdays: [1, 3, 5], shiftCodes: [primerTurno] };
    case "EVERY_N_DAYS":
      return { kind, everyNDays: 7, shiftCodes: [primerTurno] };
    case "MONTHLY":
      return { kind, monthDay: 1, shiftCodes: [primerTurno] };
    case "ON_DEMAND":
      return { kind };
  }
}

export function SelectorDeFrecuencia({
  valor,
  permitidas,
  turnos,
  momentos,
  onChange,
}: {
  valor: FrecuenciaUI;
  permitidas: TipoDeFrecuencia[];
  turnos: TurnoCorto[];
  momentos: MomentoDelDia[];
  onChange: (f: FrecuenciaUI) => void;
}) {
  const unTurno = (code: string) => onChange({ ...valor, shiftCodes: [code] });

  return (
    <div className="space-y-4">
      <div>
        <p className="mb-1.5 text-[13px] text-slate-500">Cada cuánto</p>
        <div className="flex flex-wrap gap-2">
          {permitidas.map((k) => (
            <Pastilla
              key={k}
              activo={valor.kind === k}
              onClick={() => onChange(conTipo(k, turnos, momentos))}
            >
              {FRECUENCIA_LABEL[k]}
            </Pastilla>
          ))}
        </div>
        {permitidas.length === 1 && (
          <p className="mt-1.5 text-[12.5px] text-slate-400">
            Este control sólo admite esta frecuencia.
          </p>
        )}
      </div>

      {/* ── Varios turnos: «cada turno» ───────────────────────────── */}
      {valor.kind === "EVERY_SHIFT" && (
        <div>
          <p className="mb-1.5 text-[13px] text-slate-500">En qué turnos</p>
          <div className="flex flex-wrap gap-2">
            {turnos.map((t) => {
              const puesto = (valor.shiftCodes ?? []).includes(t.code);
              return (
                <Pastilla
                  key={t.code}
                  activo={puesto}
                  onClick={() =>
                    onChange({
                      ...valor,
                      shiftCodes: puesto
                        ? (valor.shiftCodes ?? []).filter((c) => c !== t.code)
                        : [...(valor.shiftCodes ?? []), t.code],
                    })
                  }
                >
                  {t.name}
                </Pastilla>
              );
            })}
          </div>
          {(valor.shiftCodes ?? []).length === 0 && (
            <p className="mt-1.5 text-[13px] text-amber-700">
              Elige al menos un turno: si no, no tocaría nunca.
            </p>
          )}
        </div>
      )}

      {/* ── Un turno solo: diario, días de la semana, cada N días, mensual ── */}
      {["DAILY", "WEEKDAYS", "EVERY_N_DAYS", "MONTHLY"].includes(valor.kind) && (
        <div>
          <p className="mb-1.5 text-[13px] text-slate-500">En qué turno</p>
          <div className="flex flex-wrap gap-2">
            {turnos.map((t) => (
              <Pastilla
                key={t.code}
                activo={(valor.shiftCodes ?? [])[0] === t.code}
                onClick={() => unTurno(t.code)}
              >
                {t.name}
              </Pastilla>
            ))}
          </div>
        </div>
      )}

      {/* ── Los momentos del día ──────────────────────────────────── */}
      {valor.kind === "MOMENTS" && (
        <div>
          <p className="mb-1.5 text-[13px] text-slate-500">En qué momentos</p>
          <div className="flex flex-wrap gap-2">
            {momentos.map((m) => {
              const puesto = (valor.momentCodes ?? []).includes(m.code);
              return (
                <Pastilla
                  key={m.code}
                  activo={puesto}
                  onClick={() =>
                    onChange({
                      ...valor,
                      momentCodes: puesto
                        ? (valor.momentCodes ?? []).filter((c) => c !== m.code)
                        : [...(valor.momentCodes ?? []), m.code],
                    })
                  }
                >
                  {/* La hora va en el botón: «Desayuno 09:00». Es lo que
                      convierte el momento en algo comprobable — la
                      dirección ve si el desayuno está puesto a su hora sin
                      abrir otra pantalla. */}
                  {m.name}{" "}
                  <span className="tabular-nums text-slate-400">{m.atTime}</span>
                </Pastilla>
              );
            })}
          </div>
          {(valor.momentCodes ?? []).length === 0 && (
            <p className="mt-1.5 text-[13px] text-amber-700">
              Elige al menos un momento del día.
            </p>
          )}
        </div>
      )}

      {/* ── Cada N horas · sólo divisores de 24 ───────────────────── */}
      {valor.kind === "EVERY_N_HOURS" && (
        <div>
          <p className="mb-1.5 text-[13px] text-slate-500">Cada cuántas horas</p>
          <div className="flex flex-wrap gap-2">
            {HORAS_OFRECIDAS.map((h) => (
              <Pastilla
                key={h}
                activo={valor.everyNHours === h}
                onClick={() => onChange({ ...valor, everyNHours: h })}
              >
                {h} h
              </Pastilla>
            ))}
          </div>
          <p className="mt-1.5 text-[12.5px] text-slate-400">
            Las rondas van a las mismas horas todos los días, empezando a
            medianoche. También de noche.
          </p>
        </div>
      )}

      {/* ── Los siete días ────────────────────────────────────────── */}
      {valor.kind === "WEEKDAYS" && (
        <div>
          <p className="mb-1.5 text-[13px] text-slate-500">Qué días</p>
          <div className="flex flex-wrap gap-2">
            {DIAS_SEMANA_UI.map((d) => {
              const puesto = (valor.weekdays ?? []).includes(d.iso);
              return (
                <Pastilla
                  key={d.iso}
                  activo={puesto}
                  onClick={() =>
                    onChange({
                      ...valor,
                      weekdays: puesto
                        ? (valor.weekdays ?? []).filter((x) => x !== d.iso)
                        : [...(valor.weekdays ?? []), d.iso],
                    })
                  }
                >
                  <span className="w-3 text-center">{d.corto}</span>
                </Pastilla>
              );
            })}
          </div>
          {(valor.weekdays ?? []).length === 0 && (
            <p className="mt-1.5 text-[13px] text-amber-700">Elige al menos un día.</p>
          )}
        </div>
      )}

      {valor.kind === "EVERY_N_DAYS" && (
        <div>
          <label
            htmlFor="frec-n-dias"
            className="mb-1.5 block text-[13px] text-slate-500"
          >
            Cada cuántos días
          </label>
          <input
            id="frec-n-dias"
            type="number"
            min={1}
            max={365}
            value={valor.everyNDays ?? 7}
            onChange={(e) =>
              onChange({ ...valor, everyNDays: Number(e.target.value) || 1 })
            }
            className="h-11 w-28 rounded-xl border border-slate-200 px-3 text-[14px] tabular-nums"
          />
          <p className="mt-1.5 text-[12.5px] text-slate-400">
            Se cuenta desde el día en que se le pone, no desde el calendario.
          </p>
        </div>
      )}

      {valor.kind === "MONTHLY" && (
        <div>
          <label
            htmlFor="frec-dia-mes"
            className="mb-1.5 block text-[13px] text-slate-500"
          >
            Qué día del mes
          </label>
          <input
            id="frec-dia-mes"
            type="number"
            min={1}
            max={28}
            value={valor.monthDay ?? 1}
            onChange={(e) =>
              onChange({ ...valor, monthDay: Number(e.target.value) || 1 })
            }
            className="h-11 w-28 rounded-xl border border-slate-200 px-3 text-[14px] tabular-nums"
          />
          <p className="mt-1.5 text-[12.5px] text-slate-400">
            Hasta el 28: con el 29, el 30 o el 31 no tocaría en febrero.
          </p>
        </div>
      )}

      {valor.kind === "ON_DEMAND" && (
        <p className="text-[13px] text-slate-500">
          No tiene agenda: el botón estará en la puerta de la habitación y se
          apunta cuando pase. No sale como pendiente ni como incumplido.
        </p>
      )}
    </div>
  );
}
