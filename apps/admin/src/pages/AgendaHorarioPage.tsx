// Ajustes de agenda · Horario del centro (B-reservas-7a).
//
// Cuatro cosas, en el orden en que se configuran:
//
//   1. LA SEMANA TIPO — mañana y tarde por día. Es el TECHO: recorta por
//      arriba el turno de cualquier profesional. Un día sin horas está
//      cerrado; un centro sin NINGUNA hora no tiene techo y se comporta
//      como antes de este bloque.
//   2. LOS DÍAS ESPECIALES — o cierre con nombre (un festivo, "vacaciones
//      de agosto"), o un horario propio de ese día con nombre ("boda
//      Marta"). SUSTITUYE al horario semanal de ese día; no se suma.
//   3. LA RETÍCULA — cada cuántos minutos empieza una cita: 15 o 30.
//   4. EL REFUERZO — si el día especial abre antes que el turno de todo el
//      personal, la pantalla lo dice y ofrece añadir un turno de un día con
//      la API de turnos de B3 (`kind: REINFORCEMENT`, `validFrom` =
//      `validUntil`). NO se toca el contrato de `StaffShift`.
//
// LAS CITAS YA DADAS NO SE MUEVEN. Antes de guardar cualquiera de los tres
// cambios, la pantalla pregunta a `/admin/agenda/hours/impact` qué citas
// vivas quedarían fuera y las enseña: "se quedan como están, avísalas".
//
// Gate por `agendaEnabled` (ADR-R6), en la UI y en la ruta.

import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { AdminShell } from "../AdminShell.js";
import { api, ApiError, clearTokens, readEffectiveAuth } from "../api.js";
import {
  CenteredLoader,
  FieldError,
  OutlineButton,
  PrimaryButton,
  SuccessBanner,
} from "../ui.js";

// ── Contrato de la API ───────────────────────────────────────────────

interface WeekRow {
  id: string;
  weekday: number; // 1 = lunes … 7 = domingo
  openTime: string;
  closeTime: string;
}
interface SpecialDay {
  id: string;
  date: string;
  closed: boolean;
  name: string;
  openTime: string | null;
  closeTime: string | null;
}
interface HoursResponse {
  slotMinutes: number;
  week: WeekRow[];
  days: SpecialDay[];
}
interface ImpactAppointment {
  id: string;
  date: string;
  wallTime: string;
  clientName: string | null;
  reason: "CLOSED" | "OUT_OF_HOURS" | "OFF_GRID";
}
interface ImpactResponse {
  count: number;
  appointments: ImpactAppointment[];
  scannedFrom: string;
  scannedTo: string;
}
interface Coverage {
  covered: boolean;
  staff: Array<{ userId: string; displayName: string }>;
  candidates: Array<{ userId: string; displayName: string }>;
}

// ISO-8601: lunes primero, que es como se lee un horario en español.
const WEEKDAYS: Array<{ n: number; label: string; corto: string }> = [
  { n: 1, label: "Lunes", corto: "L" },
  { n: 2, label: "Martes", corto: "M" },
  { n: 3, label: "Miércoles", corto: "X" },
  { n: 4, label: "Jueves", corto: "J" },
  { n: 5, label: "Viernes", corto: "V" },
  { n: 6, label: "Sábado", corto: "S" },
  { n: 7, label: "Domingo", corto: "D" },
];

// La fila de la tabla semanal: dos tramos por día, que es como trabaja un
// centro con horario partido. Vacío = ese tramo no existe.
interface DayForm {
  m1: string;
  m2: string; // mañana
  t1: string;
  t2: string; // tarde
}
const VACIO: DayForm = { m1: "", m2: "", t1: "", t2: "" };

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

function weekToForm(rows: WeekRow[]): Record<number, DayForm> {
  const out: Record<number, DayForm> = {};
  for (const { n } of WEEKDAYS) out[n] = { ...VACIO };
  for (const { n } of WEEKDAYS) {
    const tramos = rows
      .filter((r) => r.weekday === n)
      .sort((a, b) => a.openTime.localeCompare(b.openTime));
    if (tramos[0]) {
      out[n]!.m1 = tramos[0].openTime;
      out[n]!.m2 = tramos[0].closeTime;
    }
    if (tramos[1]) {
      out[n]!.t1 = tramos[1].openTime;
      out[n]!.t2 = tramos[1].closeTime;
    }
  }
  return out;
}

function formToRows(
  form: Record<number, DayForm>,
): Array<{ weekday: number; openTime: string; closeTime: string }> {
  const out: Array<{ weekday: number; openTime: string; closeTime: string }> =
    [];
  for (const { n } of WEEKDAYS) {
    const f = form[n] ?? VACIO;
    for (const [a, b] of [
      [f.m1, f.m2],
      [f.t1, f.t2],
    ]) {
      if (!a && !b) continue;
      out.push({ weekday: n, openTime: a!, closeTime: b! });
    }
  }
  return out;
}

/** El primer problema del formulario, o `null`. Se valida aquí además de en
 *  el servidor para que el operador no pierda lo escrito en un 400. */
function validarForm(form: Record<number, DayForm>): string | null {
  for (const { n, label } of WEEKDAYS) {
    const f = form[n] ?? VACIO;
    for (const [a, b, cual] of [
      [f.m1, f.m2, "la mañana"],
      [f.t1, f.t2, "la tarde"],
    ] as const) {
      if (!a && !b) continue;
      if (!a || !b) {
        return `${label}: ${cual} necesita hora de apertura y de cierre.`;
      }
      if (!HHMM.test(a) || !HHMM.test(b)) {
        return `${label}: las horas se escriben como HH:MM (09:00).`;
      }
      if (a >= b) {
        return `${label}: ${cual} cierra antes de abrir.`;
      }
    }
    if (f.m2 && f.t1 && f.t1 < f.m2) {
      return `${label}: la tarde empieza antes de que acabe la mañana.`;
    }
  }
  return null;
}

const REASON_LABEL: Record<ImpactAppointment["reason"], string> = {
  CLOSED: "ese día el centro cierra",
  OUT_OF_HOURS: "queda fuera del horario",
  OFF_GRID: "no cae en la retícula nueva",
};

export function AgendaHorarioPage() {
  const navigate = useNavigate();
  const [agendaEnabled, setAgendaEnabled] = useState<boolean | null>(null);
  const [data, setData] = useState<HoursResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const canEdit = readEffectiveAuth().canEdit;

  const refresh = useCallback(async () => {
    setData(await api<HoursResponse>("/admin/agenda/hours"));
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const settings = await api<{ settings: { agendaEnabled: boolean } }>(
          "/admin/tenant/settings",
        );
        setAgendaEnabled(settings.settings.agendaEnabled);
        if (!settings.settings.agendaEnabled) return;
        await refresh();
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          clearTokens();
          navigate("/login", { replace: true });
        } else if (err instanceof ApiError) {
          setError(err.message);
        } else throw err;
      }
    })();
  }, [navigate, refresh]);

  function flash(msg: string) {
    setOk(msg);
    setError(null);
    window.setTimeout(() => setOk(null), 4000);
  }

  if (agendaEnabled === null) return <CenteredLoader label="Cargando…" />;

  if (!agendaEnabled) {
    return (
      <AdminShell title="Agenda · Horario">
        <div className="bg-white rounded-2xl border border-slate-200 p-7 text-center">
          <h2 className="text-[16px] font-semibold text-mipiace-ink">
            El módulo de agenda está desactivado
          </h2>
          <p className="text-[13.5px] text-slate-500 mt-1 mb-4">
            Actívalo en Ajustes para poner el horario del centro, los días
            especiales y la retícula.
          </p>
          <PrimaryButton type="button" onClick={() => navigate("/admin/settings")}>
            Ir a Ajustes
          </PrimaryButton>
        </div>
      </AdminShell>
    );
  }

  return (
    <AdminShell title="Agenda · Horario">
      <p className="text-[13.5px] text-slate-500 mb-5 -mt-2">
        El horario del centro es el <strong>techo</strong> de la agenda:
        recorta por arriba el turno de cualquier profesional. Mientras no
        pongas ninguna hora, la agenda se comporta como hasta ahora y sólo
        mira los turnos del personal.
      </p>
      {error && <FieldError message={error} />}
      {ok && <SuccessBanner message={ok} />}
      {!data ? (
        <CenteredLoader label="Cargando horario…" />
      ) : (
        <div className="space-y-4">
          <WeekCard
            data={data}
            canEdit={canEdit}
            onSaved={async (msg) => {
              await refresh();
              flash(msg);
            }}
            onError={setError}
          />
          <SpecialDaysCard
            data={data}
            canEdit={canEdit}
            onSaved={async (msg) => {
              await refresh();
              flash(msg);
            }}
            onError={setError}
          />
          <SlotCard
            data={data}
            canEdit={canEdit}
            onSaved={async (msg) => {
              await refresh();
              flash(msg);
            }}
            onError={setError}
          />
        </div>
      )}
    </AdminShell>
  );
}

// ── El aviso de las citas que se quedan como están ───────────────────

function ImpactNotice({
  impact,
  onConfirm,
  onCancel,
  saving,
}: {
  impact: ImpactResponse;
  onConfirm: () => void;
  onCancel: () => void;
  saving: boolean;
}) {
  // Tres citas y "y N más": lo que cabe en una frase que el operador lee
  // antes de decidir. La lista entera está debajo si quiere mirarla.
  const primeras = impact.appointments.slice(0, 3);
  const resto = impact.count - primeras.length;
  return (
    <div
      data-impacto={String(impact.count)}
      className="mt-3 rounded-2xl border border-amber-300 bg-amber-50 p-4"
    >
      <p className="text-[13.5px] text-amber-900">
        {impact.count === 1
          ? "Hay 1 cita que quedaría fuera:"
          : `Hay ${impact.count} citas que quedarían fuera:`}{" "}
        {primeras
          .map(
            (a) =>
              `${a.wallTime} ${a.clientName ?? "sin cliente"} (${a.date})`,
          )
          .join(", ")}
        {resto > 0 ? ` y ${resto} más` : ""}.
      </p>
      <p className="text-[13px] font-semibold text-amber-900 mt-1">
        Se quedan como están: no se cancela ni se mueve ninguna. Avísalas tú.
      </p>
      <p className="text-[12px] text-amber-700 mt-1">
        Revisado del {impact.scannedFrom} al {impact.scannedTo}.
      </p>
      <ul className="mt-2 max-h-40 overflow-auto text-[12.5px] text-amber-800">
        {impact.appointments.map((a) => (
          <li key={a.id} className="tabular-nums">
            {a.date} {a.wallTime} · {a.clientName ?? "sin cliente"} ·{" "}
            {REASON_LABEL[a.reason]}
          </li>
        ))}
      </ul>
      <div className="flex gap-2 mt-3">
        <PrimaryButton type="button" onClick={onConfirm} disabled={saving}>
          {saving ? "Guardando…" : "Guardar de todas formas"}
        </PrimaryButton>
        <OutlineButton type="button" onClick={onCancel}>
          Cancelar
        </OutlineButton>
      </div>
    </div>
  );
}

// ── 1 · La semana tipo ───────────────────────────────────────────────

function WeekCard({
  data,
  canEdit,
  onSaved,
  onError,
}: {
  data: HoursResponse;
  canEdit: boolean;
  onSaved: (msg: string) => void | Promise<void>;
  onError: (msg: string) => void;
}) {
  const [form, setForm] = useState<Record<number, DayForm>>(() =>
    weekToForm(data.week),
  );
  const [impact, setImpact] = useState<ImpactResponse | null>(null);
  const [saving, setSaving] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  function set(n: number, campo: keyof DayForm, valor: string) {
    setForm((f) => ({ ...f, [n]: { ...(f[n] ?? VACIO), [campo]: valor } }));
    setImpact(null);
  }

  async function pedirImpacto() {
    const invalid = validarForm(form);
    if (invalid) {
      setLocalError(invalid);
      return;
    }
    setLocalError(null);
    try {
      const rows = formToRows(form);
      const res = await api<ImpactResponse>("/admin/agenda/hours/impact", {
        method: "POST",
        body: { week: rows },
      });
      if (res.count === 0) {
        await guardar();
        return;
      }
      setImpact(res);
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "Error al comprobar.");
    }
  }

  async function guardar() {
    setSaving(true);
    try {
      const rows = formToRows(form);
      await api("/admin/agenda/hours/week", { method: "PUT", body: { rows } });
      setImpact(null);
      await onSaved(
        rows.length === 0
          ? "Horario borrado: la agenda vuelve a mirar sólo los turnos."
          : "Horario del centro guardado.",
      );
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "Error al guardar.");
    } finally {
      setSaving(false);
    }
  }

  const sinHoras = formToRows(form).length === 0;

  return (
    <section className="bg-white rounded-2xl border border-slate-200 p-5">
      <h2 className="text-[15px] font-semibold text-mipiace-ink">
        Horario semanal
      </h2>
      <p className="text-[13px] text-slate-500 mt-1 mb-4">
        Deja un día en blanco para cerrarlo. La tarde es opcional: úsala sólo
        si cierras a mediodía.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-left text-slate-500">
              <th className="font-medium pb-2 pr-3">Día</th>
              <th className="font-medium pb-2 pr-3" colSpan={2}>
                Mañana
              </th>
              <th className="font-medium pb-2" colSpan={2}>
                Tarde
              </th>
            </tr>
          </thead>
          <tbody>
            {WEEKDAYS.map(({ n, label }) => {
              const f = form[n] ?? VACIO;
              const cerrado = !f.m1 && !f.m2 && !f.t1 && !f.t2;
              return (
                <tr key={n} data-dia={n} className="border-t border-slate-100">
                  <td className="py-2 pr-3 whitespace-nowrap">
                    <span className="font-medium text-mipiace-ink">{label}</span>
                    {cerrado && !sinHoras && (
                      <span className="ml-2 text-[11.5px] rounded-md bg-slate-100 text-slate-500 px-1.5 py-0.5">
                        cerrado
                      </span>
                    )}
                  </td>
                  {(
                    [
                      ["m1", "abre"],
                      ["m2", "cierra"],
                      ["t1", "abre"],
                      ["t2", "cierra"],
                    ] as Array<[keyof DayForm, string]>
                  ).map(([campo, ph]) => (
                    <td key={campo} className="py-2 pr-3">
                      <input
                        type="time"
                        step={300}
                        aria-label={`${label} ${campo} ${ph}`}
                        data-hora={`${n}-${campo}`}
                        disabled={!canEdit}
                        value={f[campo]}
                        onChange={(e) => set(n, campo, e.target.value)}
                        className="h-9 w-[104px] px-2 rounded-xl bg-mipiace-stone border border-slate-200 text-[13px] tabular-nums disabled:opacity-60"
                      />
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {localError && <FieldError message={localError} />}
      {sinHoras && (
        <p className="text-[12.5px] text-slate-500 mt-3">
          Sin ninguna hora puesta el centro <strong>no tiene techo</strong>: la
          agenda ofrece lo que digan los turnos, como hasta ahora.
        </p>
      )}
      {canEdit && !impact && (
        <div className="mt-4">
          <PrimaryButton type="button" onClick={pedirImpacto} disabled={saving}>
            Guardar horario
          </PrimaryButton>
        </div>
      )}
      {impact && (
        <ImpactNotice
          impact={impact}
          saving={saving}
          onConfirm={guardar}
          onCancel={() => setImpact(null)}
        />
      )}
    </section>
  );
}

// ── 2 · Los días especiales ──────────────────────────────────────────

function SpecialDaysCard({
  data,
  canEdit,
  onSaved,
  onError,
}: {
  data: HoursResponse;
  canEdit: boolean;
  onSaved: (msg: string) => void | Promise<void>;
  onError: (msg: string) => void;
}) {
  const [date, setDate] = useState("");
  const [name, setName] = useState("");
  // Cerrado por defecto: el caso corriente es el festivo, y así el alta
  // cabe en dos toques (fecha y Guardar).
  const [closed, setClosed] = useState(true);
  const [openTime, setOpenTime] = useState("08:30");
  const [closeTime, setCloseTime] = useState("14:00");
  const [impact, setImpact] = useState<ImpactResponse | null>(null);
  const [coverage, setCoverage] = useState<Coverage | null>(null);
  const [saving, setSaving] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  function reset() {
    setDate("");
    setName("");
    setClosed(true);
    setImpact(null);
    setCoverage(null);
    setLocalError(null);
  }

  async function pedirImpacto() {
    if (!date) {
      setLocalError("Elige la fecha.");
      return;
    }
    if (!name.trim()) {
      setLocalError("Ponle nombre: es lo que la agenda enseña ese día.");
      return;
    }
    if (!closed && openTime >= closeTime) {
      setLocalError("La hora de cierre tiene que ser posterior a la de apertura.");
      return;
    }
    setLocalError(null);
    try {
      const body = {
        date,
        closed,
        name: name.trim(),
        openTime: closed ? null : openTime,
        closeTime: closed ? null : closeTime,
      };
      const res = await api<ImpactResponse>("/admin/agenda/hours/impact", {
        method: "POST",
        body: { day: body },
      });
      if (res.count === 0) {
        await guardar();
        return;
      }
      setImpact(res);
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "Error al comprobar.");
    }
  }

  async function guardar() {
    setSaving(true);
    try {
      await api("/admin/agenda/hours/days", {
        method: "POST",
        body: {
          date,
          closed,
          name: name.trim(),
          openTime: closed ? null : openTime,
          closeTime: closed ? null : closeTime,
        },
      });
      // Si el día ABRE, hay que mirar si alguien tiene turno a esa hora: el
      // techo recorta, pero NO crea turno. Sin esto, el owner marca el
      // sábado de la boda de 8:30 y la agenda sigue sin ofrecer las 8:30.
      if (!closed) {
        try {
          const cov = await api<Coverage>(
            `/admin/agenda/hours/coverage?date=${date}&time=${openTime}`,
          );
          if (!cov.covered) {
            setCoverage(cov);
            setImpact(null);
            setSaving(false);
            await onSaved("Día especial guardado.");
            return;
          }
        } catch {
          /* la cobertura es un aviso, no un bloqueo */
        }
      }
      reset();
      await onSaved("Día especial guardado.");
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "Error al guardar.");
    } finally {
      setSaving(false);
    }
  }

  async function borrar(id: string) {
    try {
      await api(`/admin/agenda/hours/days/${id}`, { method: "DELETE" });
      await onSaved("Día especial quitado.");
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "Error al quitar.");
    }
  }

  return (
    <section className="bg-white rounded-2xl border border-slate-200 p-5">
      <h2 className="text-[15px] font-semibold text-mipiace-ink">
        Días especiales
      </h2>
      <p className="text-[13px] text-slate-500 mt-1 mb-4">
        Un festivo, unas vacaciones, o un día con horario propio. Un día
        especial <strong>sustituye</strong> al horario semanal de ese día; no
        se suma.
      </p>

      {data.days.length === 0 ? (
        <p className="text-[13px] text-slate-500 mb-4">
          Todavía no hay ninguno.
        </p>
      ) : (
        <ul className="mb-4 divide-y divide-slate-100">
          {data.days.map((d) => (
            <li
              key={d.id}
              data-dia-especial={d.date}
              // `flex-wrap` + un ancho mínimo para el NOMBRE. A 320 px el
              // `flex-1 truncate` lo aplastaba a cero: la fila quedaba en
              // "2026-09-15 · cerrado · Quitar" y el nombre —que es lo que
              // este bloque existe para poder decir— desaparecía, con el
              // botón saliéndose de la tarjeta. Lo cogió el bucle visual.
              className="flex items-center gap-x-3 gap-y-1 py-2 flex-wrap"
            >
              <span className="text-[13px] tabular-nums text-slate-500 w-24 shrink-0">
                {d.date}
              </span>
              <span className="text-[13.5px] font-medium text-mipiace-ink flex-1 min-w-[9rem] truncate">
                {d.name}
              </span>
              <span className="text-[12.5px] text-slate-500 shrink-0">
                {d.closed ? "cerrado" : `${d.openTime}–${d.closeTime}`}
              </span>
              {canEdit && (
                <OutlineButton type="button" onClick={() => void borrar(d.id)}>
                  Quitar
                </OutlineButton>
              )}
            </li>
          ))}
        </ul>
      )}

      {canEdit && (
        <div className="rounded-2xl bg-mipiace-stone p-4">
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-[12.5px] text-slate-500">Fecha</span>
              <input
                type="date"
                data-nuevo-dia-fecha
                value={date}
                onChange={(e) => {
                  setDate(e.target.value);
                  setImpact(null);
                }}
                className="h-10 px-2 rounded-xl bg-white border border-slate-200 text-[13.5px]"
              />
            </label>
            <label className="flex flex-col gap-1 flex-1 min-w-[180px]">
              <span className="text-[12.5px] text-slate-500">Nombre</span>
              <input
                data-nuevo-dia-nombre
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setImpact(null);
                }}
                maxLength={120}
                placeholder="Virgen del Prado"
                className="h-10 px-3 rounded-xl bg-white border border-slate-200 text-[13.5px]"
              />
            </label>
            <label className="flex items-center gap-2 h-10">
              <input
                type="checkbox"
                data-nuevo-dia-cerrado
                checked={closed}
                onChange={(e) => {
                  setClosed(e.target.checked);
                  setImpact(null);
                }}
                className="w-4 h-4"
              />
              <span className="text-[13.5px] text-mipiace-ink">Cerrado</span>
            </label>
            {!closed && (
              <>
                <label className="flex flex-col gap-1">
                  <span className="text-[12.5px] text-slate-500">Abre</span>
                  <input
                    type="time"
                    step={300}
                    data-nuevo-dia-abre
                    value={openTime}
                    onChange={(e) => setOpenTime(e.target.value)}
                    className="h-10 px-2 rounded-xl bg-white border border-slate-200 text-[13.5px] tabular-nums"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[12.5px] text-slate-500">Cierra</span>
                  <input
                    type="time"
                    step={300}
                    data-nuevo-dia-cierra
                    value={closeTime}
                    onChange={(e) => setCloseTime(e.target.value)}
                    className="h-10 px-2 rounded-xl bg-white border border-slate-200 text-[13.5px] tabular-nums"
                  />
                </label>
              </>
            )}
            {!impact && (
              <PrimaryButton
                type="button"
                onClick={pedirImpacto}
                disabled={saving}
              >
                Guardar
              </PrimaryButton>
            )}
          </div>
          {localError && <FieldError message={localError} />}
          {impact && (
            <ImpactNotice
              impact={impact}
              saving={saving}
              onConfirm={guardar}
              onCancel={() => setImpact(null)}
            />
          )}
          {coverage && (
            <ReinforcementNotice
              date={date}
              time={openTime}
              endTime={closeTime}
              coverage={coverage}
              onDone={async (msg) => {
                reset();
                await onSaved(msg);
              }}
              onError={onError}
            />
          )}
        </div>
      )}
    </section>
  );
}

// ── 4 · El refuerzo de un día ────────────────────────────────────────

function ReinforcementNotice({
  date,
  time,
  endTime,
  coverage,
  onDone,
  onError,
}: {
  date: string;
  time: string;
  endTime: string;
  coverage: Coverage;
  onDone: (msg: string) => void | Promise<void>;
  onError: (msg: string) => void;
}) {
  const [quien, setQuien] = useState(coverage.candidates[0]?.userId ?? "");
  const [saving, setSaving] = useState(false);

  async function añadir() {
    if (!quien) return;
    setSaving(true);
    try {
      // La API de turnos de B3, tal cual. `kind: REINFORCEMENT` y
      // `validFrom = validUntil` = ese día: un turno de un día, que no toca
      // la semana tipo de nadie. NO se toca el contrato de `StaffShift`.
      const byday = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"][
        (new Date(`${date}T12:00:00.000Z`).getUTCDay() + 6) % 7
      ]!;
      await api(`/staff/${quien}/shifts`, {
        method: "POST",
        body: {
          rrule: `FREQ=WEEKLY;BYDAY=${byday}`,
          startTime: time,
          endTime,
          validFrom: date,
          validUntil: date,
          kind: "REINFORCEMENT",
        },
      });
      await onDone("Refuerzo añadido: ese día ya hay quien abra.");
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "Error al añadir el refuerzo.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      data-refuerzo
      className="mt-3 rounded-2xl border border-sky-300 bg-sky-50 p-4"
    >
      <p className="text-[13.5px] text-sky-900">
        Nadie tiene turno a las {time} ese día. El horario del centro{" "}
        <strong>recorta</strong> el turno de cada profesional, pero no lo crea:
        tal como está, la agenda no ofrecerá las {time}.
      </p>
      {coverage.candidates.length === 0 ? (
        <p className="text-[13px] text-sky-800 mt-2">
          No hay profesionales activos a los que añadir un refuerzo. Dalos de
          alta en Personal.
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-2 mt-3">
          <select
            data-refuerzo-quien
            value={quien}
            onChange={(e) => setQuien(e.target.value)}
            className="h-10 px-2 rounded-xl bg-white border border-sky-200 text-[13.5px]"
          >
            {coverage.candidates.map((c) => (
              <option key={c.userId} value={c.userId}>
                {c.displayName}
              </option>
            ))}
          </select>
          <PrimaryButton type="button" onClick={añadir} disabled={saving}>
            {saving
              ? "Añadiendo…"
              : `Añadir refuerzo de ${time} a ${endTime}, sólo ese día`}
          </PrimaryButton>
        </div>
      )}
    </div>
  );
}

// ── 3 · La retícula ──────────────────────────────────────────────────

function SlotCard({
  data,
  canEdit,
  onSaved,
  onError,
}: {
  data: HoursResponse;
  canEdit: boolean;
  onSaved: (msg: string) => void | Promise<void>;
  onError: (msg: string) => void;
}) {
  const [slot, setSlot] = useState(data.slotMinutes);
  const [impact, setImpact] = useState<ImpactResponse | null>(null);
  const [saving, setSaving] = useState(false);

  async function pedirImpacto(nuevo: number) {
    setSlot(nuevo);
    if (nuevo === data.slotMinutes) {
      setImpact(null);
      return;
    }
    try {
      const res = await api<ImpactResponse>("/admin/agenda/hours/impact", {
        method: "POST",
        body: { slotMinutes: nuevo },
      });
      if (res.count === 0) {
        await guardar(nuevo);
        return;
      }
      setImpact(res);
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "Error al comprobar.");
    }
  }

  async function guardar(nuevo: number) {
    setSaving(true);
    try {
      await api("/admin/agenda/hours/slot", {
        method: "PUT",
        body: { slotMinutes: nuevo },
      });
      setImpact(null);
      await onSaved(`Retícula puesta en ${nuevo} minutos.`);
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "Error al guardar.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="bg-white rounded-2xl border border-slate-200 p-5">
      <h2 className="text-[15px] font-semibold text-mipiace-ink">Retícula</h2>
      <p className="text-[13px] text-slate-500 mt-1 mb-4">
        Cada cuántos minutos puede empezar una cita. Con <strong>30</strong> la
        agenda ofrece y en punto y y media, y deja de ofrecer y cuarto y menos
        cuarto — al listar, al tocar la rejilla y al reservar.
      </p>
      <div className="flex gap-2">
        {[15, 30].map((n) => (
          <button
            key={n}
            type="button"
            data-reticula={n}
            disabled={!canEdit || saving}
            onClick={() => void pedirImpacto(n)}
            className={`h-11 px-5 rounded-2xl text-[14px] font-medium border ${
              slot === n
                ? "bg-mipiace-ink text-white border-mipiace-ink"
                : "bg-white text-mipiace-ink border-slate-200 hover:bg-slate-50"
            } disabled:opacity-60`}
          >
            {n} minutos
          </button>
        ))}
      </div>
      <p className="text-[12.5px] text-amber-700 mt-3">
        Cambia la retícula <strong>después</strong> de actualizar la app del
        TPV. Con la app vieja, el terminal seguiría ofreciendo inicios a y
        cuarto y el servidor los rechazaría.
      </p>
      {impact && (
        <ImpactNotice
          impact={impact}
          saving={saving}
          onConfirm={() => void guardar(slot)}
          onCancel={() => {
            setSlot(data.slotMinutes);
            setImpact(null);
          }}
        />
      )}
    </section>
  );
}
