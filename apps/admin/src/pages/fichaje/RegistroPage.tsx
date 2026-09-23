// F1 · "Registro": lo que se le enseña a la Inspección (ADR-018).
//
// Por mes, por empleado o de todos, con entrada, salida, total diario y
// total del mes. Y las marcas: corregido, sin salida, enviado sin
// conexión.
//
// Por EMPLEADO y no en una lista plana: el registro que firma cada
// trabajador es el suyo, y así se lee igual en la pantalla y en el PDF.
//
// Se corrige y se añade desde aquí, por la misma función y con el mismo
// motivo obligatorio que usa el empleado desde su móvil. La empresa no
// tiene la ventana de 30 días: es quien puede cruzar un fichaje viejo con
// lo que pasó ese día, y es a quien le piden el registro.

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  ChevronLeft,
  ChevronRight,
  CloudOff,
  Download,
  FileText,
  PencilLine,
  Plus,
  X,
} from "lucide-react";

import { AdminShell } from "../../AdminShell.js";
import { api, ApiError, readTokens } from "../../api.js";
import {
  CenteredLoader,
  FieldError,
  OutlineButton,
  PrimaryButton,
} from "../../ui.js";
import {
  componerLocal,
  diaCorto,
  diaLargo,
  duracion,
  horaLocal,
  mesActual,
  mesLargo,
  mesVecino,
  REASONS,
  reasonLabel,
  type CorrectionRow,
  type EntryRow,
  type ReasonCode,
  type RegistroResponse,
} from "./lib.js";

export function RegistroPage() {
  const [params, setParams] = useSearchParams();
  const mes = params.get("mes") ?? mesActual();
  const empleado = params.get("empleado") ?? "";
  const [data, setData] = useState<RegistroResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [corrigiendo, setCorrigiendo] = useState<{
    entry: EntryRow;
    empleado: string;
  } | null>(null);
  const [anadiendo, setAnadiendo] = useState(false);

  const recargar = useCallback(async () => {
    try {
      const q = new URLSearchParams({ month: mes });
      if (empleado) q.set("employeeId", empleado);
      setData(await api<RegistroResponse>(`/admin/fichaje/entries?${q}`));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Error inesperado");
    }
  }, [mes, empleado]);

  useEffect(() => {
    void recargar();
  }, [recargar]);

  function mover(delta: number) {
    const next = new URLSearchParams(params);
    next.set("mes", mesVecino(mes, delta));
    setParams(next, { replace: true });
    setData(null);
  }

  function cambiarEmpleado(id: string) {
    const next = new URLSearchParams(params);
    if (id) next.set("empleado", id);
    else next.delete("empleado");
    setParams(next, { replace: true });
    setData(null);
  }

  // El export se baja por `fetch` + blob y NO por `window.open`.
  //
  // `window.open` no lleva cabeceras, así que habría que meter el access
  // token en la URL — y una URL con un token dentro acaba en el historial
  // del navegador, en los logs de Caddy y en el portapapeles de quien la
  // copie. El registro de jornada de una empresa entera no vale eso.
  const [bajando, setBajando] = useState<"pdf" | "csv" | null>(null);
  async function exportar(formato: "pdf" | "csv") {
    setBajando(formato);
    try {
      const q = new URLSearchParams({ month: mes });
      if (empleado) q.set("employeeId", empleado);
      const res = await fetch(`/api/admin/fichaje/export.${formato}?${q}`, {
        headers: { Authorization: `Bearer ${readTokens()?.accessToken ?? ""}` },
      });
      if (!res.ok) throw new Error("No se ha podido generar el documento.");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `registro-jornada-${mes}.${formato}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error inesperado");
    } finally {
      setBajando(null);
    }
  }

  if (error && !data) {
    return (
      <AdminShell title="Control horario · Registro">
        <FieldError message={error} />
      </AdminShell>
    );
  }
  if (!data) return <CenteredLoader label="Cargando registro…" />;

  return (
    <AdminShell title="Control horario · Registro">
      <p className="-mt-2 mb-5 text-[13.5px] text-slate-500">
        El registro de jornada del mes. Es lo que se le enseña a la Inspección:
        exportable en PDF y en CSV, con las correcciones al final.
      </p>

      {error && <FieldError message={error} />}

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => mover(-1)}
            aria-label="Mes anterior"
            className="flex h-10 w-10 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-500 hover:bg-mipiace-stone"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="min-w-[150px] text-center text-[15px] font-semibold text-mipiace-ink">
            {mesLargo(mes)}
          </span>
          <button
            type="button"
            onClick={() => mover(1)}
            aria-label="Mes siguiente"
            className="flex h-10 w-10 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-500 hover:bg-mipiace-stone"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        <select
          value={empleado}
          onChange={(e) => cambiarEmpleado(e.target.value)}
          aria-label="Empleado"
          className="h-10 rounded-2xl border border-slate-200 bg-white px-3 text-[13.5px] text-mipiace-ink"
        >
          <option value="">Todos los empleados</option>
          {data.employees.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
              {e.active ? "" : " (de baja)"}
            </option>
          ))}
        </select>

        <div className="ml-auto flex items-center gap-2">
          <OutlineButton
            type="button"
            onClick={() => setAnadiendo(true)}
            className="!h-10 !w-auto !px-3 !text-[13.5px]"
          >
            <span className="inline-flex items-center gap-1.5">
              <Plus className="h-4 w-4" />
              Añadir fichaje
            </span>
          </OutlineButton>
          <OutlineButton
            type="button"
            onClick={() => exportar("csv")}
            disabled={bajando !== null}
            className="!h-10 !w-auto !px-3 !text-[13.5px]"
          >
            <span className="inline-flex items-center gap-1.5">
              <Download className="h-4 w-4" />
              {bajando === "csv" ? "Generando…" : "CSV"}
            </span>
          </OutlineButton>
          <PrimaryButton
            type="button"
            onClick={() => exportar("pdf")}
            disabled={bajando !== null}
            className="!h-10 !w-auto !px-3 !text-[13.5px]"
          >
            <span className="inline-flex items-center gap-1.5">
              <FileText className="h-4 w-4" />
              {bajando === "pdf" ? "Generando…" : "PDF"}
            </span>
          </PrimaryButton>
        </div>
      </div>

      {data.blocks.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center text-[13.5px] text-slate-500">
          No hay fichajes en {mesLargo(mes).toLowerCase()}.
        </div>
      ) : (
        <div className="space-y-6">
          {data.blocks.map((b) => (
            <section key={b.employeeId}>
              <div className="mb-2 flex items-baseline justify-between">
                <h2 className="text-[16px] font-semibold text-mipiace-ink">
                  {b.employeeName}
                </h2>
                <span className="text-[14px] font-medium tabular-nums text-mipiace-ink">
                  {duracion(b.totalMinutes)}
                </span>
              </div>
              <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                {b.days.map((d) => {
                  // Un día con UN tramo es UNA fila. Con la cabecera de
                  // grupo, "vie 11 · 7h 00m" seguido de "08:00 → 15:00 ·
                  // 7h 00m" repetía el total dos veces en cada línea de un
                  // documento que se lee de arriba abajo — y el 90% de los
                  // días tienen un solo tramo. Lo enseñó el bucle visual.
                  const agrupado = d.entries.length > 1;
                  return (
                  <div key={d.date} className="border-b border-slate-100 last:border-0">
                    {agrupado && (
                      <div className="flex items-baseline justify-between bg-mipiace-stone/60 px-4 py-1.5">
                        <span className="text-[12.5px] font-medium text-mipiace-ink-soft">
                          {diaCorto(d.date, data.timeZone)}
                        </span>
                        <span className="text-[12.5px] font-medium tabular-nums text-mipiace-ink-soft">
                          {d.entries.some((e) => e.open) && d.totalMinutes === 0
                            ? "En curso"
                            : duracion(d.totalMinutes)}
                        </span>
                      </div>
                    )}
                    {d.entries.map((e) => (
                      <button
                        key={e.id}
                        type="button"
                        onClick={() =>
                          setCorrigiendo({ entry: e, empleado: b.employeeName })
                        }
                        className="flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-mipiace-stone"
                      >
                        {!agrupado && (
                          <span className="w-[62px] shrink-0 text-[12.5px] text-slate-500">
                            {diaCorto(d.date, data.timeZone)}
                          </span>
                        )}
                        <span className="text-[14.5px] tabular-nums text-mipiace-ink">
                          {e.startedLocal}
                          <span className="mx-1.5 text-slate-300">→</span>
                          {e.endedLocal ?? (
                            <span className="text-mipiace-coral-dark">sin salida</span>
                          )}
                        </span>
                        <span className="ml-auto flex items-center gap-1.5">
                          {e.startSource === "PANEL" && (
                            <span
                              className="hidden rounded-xl bg-mipiace-stone px-2 py-0.5 text-[11px] text-slate-500 sm:inline"
                              title="Lo metió la empresa"
                            >
                              Lo metió la empresa
                            </span>
                          )}
                          {e.offline && (
                            <CloudOff
                              className="h-4 w-4 text-slate-400"
                              aria-label="Enviado sin conexión"
                            />
                          )}
                          {e.corrected && (
                            <span
                              className="inline-flex items-center gap-1 rounded-xl bg-mipiace-coral-soft px-2 py-0.5 text-[11px] font-medium text-mipiace-coral-dark"
                              title="Corregido"
                            >
                              <PencilLine className="h-3 w-3" />
                              {/* A 390 el badge con texto empujaba el total
                                  fuera de la fila y se leía "10h 10". El
                                  icono solo dice lo mismo en el móvil. */}
                              <span className="hidden sm:inline">Corregido</span>
                            </span>
                          )}
                          <span className="w-[70px] text-right text-[13px] tabular-nums text-slate-500">
                            {e.minutes !== null
                              ? duracion(e.minutes)
                              : e.open
                                ? "En curso"
                                : ""}
                          </span>
                        </span>
                      </button>
                    ))}
                  </div>
                  );
                })}
              </div>
            </section>
          ))}
          <div className="flex items-baseline justify-between border-t border-slate-200 pt-3">
            <span className="text-[14px] text-slate-500">Total del mes</span>
            <span className="text-[16px] font-semibold tabular-nums text-mipiace-ink">
              {duracion(data.totalMinutes)}
            </span>
          </div>
        </div>
      )}

      {corrigiendo && (
        <CorregirModal
          entry={corrigiendo.entry}
          empleado={corrigiendo.empleado}
          timeZone={data.timeZone}
          onClose={() => setCorrigiendo(null)}
          onHecho={() => {
            setCorrigiendo(null);
            void recargar();
          }}
        />
      )}
      {anadiendo && (
        <AnadirModal
          empleados={data.employees}
          preseleccion={empleado}
          timeZone={data.timeZone}
          onClose={() => setAnadiendo(false)}
          onHecho={() => {
            setAnadiendo(false);
            void recargar();
          }}
        />
      )}
    </AdminShell>
  );
}

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-mipiace-ink/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
    >
      <div
        className="max-h-[88vh] w-full max-w-md overflow-y-auto rounded-3xl bg-white p-6"
        onClick={(ev) => ev.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <h2 className="text-[18px] font-semibold text-mipiace-ink">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="-mr-2 -mt-1 flex h-9 w-9 items-center justify-center rounded-2xl text-slate-400 hover:bg-mipiace-stone hover:text-mipiace-ink"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function MotivoPicker({
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
      <div className="mb-1.5 text-[13px] font-medium text-mipiace-ink-soft">
        Motivo
      </div>
      <div className="grid gap-1.5">
        {REASONS.map((r) => (
          <button
            key={r.code}
            type="button"
            onClick={() => onChange(r.code)}
            aria-pressed={value === r.code}
            className={`min-h-touch rounded-2xl px-4 text-left text-[14px] ${
              value === r.code
                ? "bg-mipiace-coral-soft font-medium text-mipiace-coral-dark ring-1 ring-mipiace-coral/40"
                : "bg-mipiace-stone text-mipiace-ink hover:bg-slate-100"
            }`}
          >
            {r.label}
          </button>
        ))}
      </div>
      {value === "OTRO" && (
        <input
          autoFocus
          value={text}
          onChange={(e) => onTextChange(e.target.value)}
          maxLength={300}
          placeholder="En una línea: qué pasó"
          aria-label="Explica qué pasó"
          className="mt-1.5 h-touch w-full rounded-2xl border border-transparent bg-mipiace-stone px-4 text-[14px] outline-none placeholder:text-slate-400 focus:border-mipiace-coral/30 focus:bg-white focus:ring-2 focus:ring-mipiace-coral/40"
        />
      )}
    </div>
  );
}

function CorregirModal({
  entry,
  empleado,
  timeZone,
  onClose,
  onHecho,
}: {
  entry: EntryRow;
  empleado: string;
  timeZone: string;
  onClose: () => void;
  onHecho: () => void;
}) {
  const [campo, setCampo] = useState<"started_at" | "ended_at">(
    entry.open ? "ended_at" : "ended_at",
  );
  const [hora, setHora] = useState(entry.endedLocal ?? entry.startedLocal);
  const [motivo, setMotivo] = useState<ReasonCode | null>(null);
  const [texto, setTexto] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [historial, setHistorial] = useState<CorrectionRow[] | null>(null);

  useEffect(() => {
    if (!entry.corrected) return;
    api<{ corrections: CorrectionRow[] }>(
      `/admin/fichaje/entries/${entry.id}/corrections`,
    )
      .then((r) => setHistorial(r.corrections))
      .catch(() => setHistorial([]));
  }, [entry.id, entry.corrected]);

  function elegirCampo(next: "started_at" | "ended_at") {
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
    setBusy(true);
    setError(null);
    try {
      await api(`/admin/fichaje/entries/${entry.id}/corrections`, {
        method: "POST",
        body: {
          field: campo,
          value: componerLocal(entry.date, hora, timeZone),
          reasonCode: motivo,
          ...(motivo === "OTRO" ? { reasonText: texto } : {}),
        },
      });
      onHecho();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Error inesperado");
      setBusy(false);
    }
  }

  return (
    <Modal title={`${empleado} · ${diaLargo(entry.date, timeZone)}`} onClose={onClose}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-2">
          {(
            [
              ["started_at", "Entrada", entry.startedLocal],
              ["ended_at", "Salida", entry.endedLocal ?? "—"],
            ] as const
          ).map(([id, label, valor]) => (
            <button
              key={id}
              type="button"
              onClick={() => elegirCampo(id)}
              aria-pressed={campo === id}
              className={`min-h-touch rounded-2xl px-3 py-2 text-left ${
                campo === id
                  ? "bg-mipiace-coral-soft ring-1 ring-mipiace-coral/40"
                  : "bg-mipiace-stone"
              }`}
            >
              <span className="block text-[11px] uppercase tracking-[0.08em] text-slate-500">
                {label}
              </span>
              <span className="text-[17px] font-medium tabular-nums text-mipiace-ink">
                {valor}
              </span>
            </button>
          ))}
        </div>

        <label className="block">
          <span className="mb-1.5 block text-[13px] font-medium text-mipiace-ink-soft">
            Hora nueva
          </span>
          <input
            type="time"
            value={hora}
            step={60}
            onChange={(e) => setHora(e.target.value)}
            className="h-touch w-full rounded-2xl border border-transparent bg-mipiace-stone px-4 text-[17px] tabular-nums outline-none focus:border-mipiace-coral/30 focus:bg-white focus:ring-2 focus:ring-mipiace-coral/40"
          />
        </label>

        <MotivoPicker
          value={motivo}
          text={texto}
          onChange={setMotivo}
          onTextChange={setTexto}
        />

        {error && <FieldError message={error} />}

        <PrimaryButton type="button" onClick={guardar} disabled={busy}>
          {busy ? "Guardando…" : "Guardar corrección"}
        </PrimaryButton>

        {entry.corrected && (
          <div className="border-t border-slate-100 pt-4">
            <h3 className="mb-2 text-[14px] font-semibold text-mipiace-ink">
              Historial de cambios
            </h3>
            {historial === null ? (
              <p className="text-[13px] text-slate-400">Cargando…</p>
            ) : (
              <ol className="space-y-2">
                {historial.map((c) => (
                  <li key={c.id} className="rounded-2xl bg-mipiace-stone p-3">
                    <div className="text-[13.5px] text-mipiace-ink">
                      {c.kind === "ALTA" ? (
                        <>
                          <strong>
                            {c.field === "started_at" ? "Entrada" : "Salida"}
                          </strong>{" "}
                          añadida:{" "}
                          <span className="tabular-nums">
                            {c.newValue ? horaLocal(c.newValue, timeZone) : "—"}
                          </span>
                        </>
                      ) : (
                        <>
                          <strong>
                            {c.field === "started_at" ? "Entrada" : "Salida"}
                          </strong>{" "}
                          <span className="tabular-nums text-slate-500 line-through">
                            {c.oldValue
                              ? horaLocal(c.oldValue, timeZone)
                              : "sin poner"}
                          </span>{" "}
                          <span className="text-slate-300">→</span>{" "}
                          <span className="font-medium tabular-nums">
                            {c.newValue ? horaLocal(c.newValue, timeZone) : "—"}
                          </span>
                        </>
                      )}
                    </div>
                    <div className="mt-0.5 text-[12.5px] text-slate-500">
                      {reasonLabel(c.reasonCode)}
                      {c.reasonText ? ` · ${c.reasonText}` : ""}
                    </div>
                    <div className="text-[12px] text-slate-400">
                      {c.author}
                      {c.authorKind === "PANEL" ? " (empresa)" : " (el empleado)"} ·{" "}
                      {new Date(c.createdAt).toLocaleString("es-ES", {
                        day: "numeric",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                        timeZone,
                      })}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

function AnadirModal({
  empleados,
  preseleccion,
  timeZone,
  onClose,
  onHecho,
}: {
  empleados: Array<{ id: string; name: string; active: boolean }>;
  preseleccion: string;
  timeZone: string;
  onClose: () => void;
  onHecho: () => void;
}) {
  const hoy = new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date());
  const [employeeId, setEmployeeId] = useState(preseleccion || empleados[0]?.id || "");
  const [fecha, setFecha] = useState(hoy);
  const [entrada, setEntrada] = useState("08:00");
  const [salida, setSalida] = useState("15:00");
  const [motivo, setMotivo] = useState<ReasonCode | null>(null);
  const [texto, setTexto] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function guardar() {
    if (!employeeId) {
      setError("Elige a quién.");
      return;
    }
    if (!motivo) {
      setError("Elige un motivo.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api("/admin/fichaje/entries", {
        method: "POST",
        body: {
          employeeId,
          startedAt: componerLocal(fecha, entrada, timeZone),
          ...(salida ? { endedAt: componerLocal(fecha, salida, timeZone) } : {}),
          reasonCode: motivo,
          ...(motivo === "OTRO" ? { reasonText: texto } : {}),
        },
      });
      onHecho();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Error inesperado");
      setBusy(false);
    }
  }

  return (
    <Modal title="Añadir un fichaje que falta" onClose={onClose}>
      <p className="mb-4 text-[13px] text-slate-500">
        Queda marcado como metido por la empresa, con su motivo. El registro
        tiene que poder decir de dónde salió cada jornada.
      </p>
      <div className="space-y-3">
        <label className="block">
          <span className="mb-1.5 block text-[13px] font-medium text-mipiace-ink-soft">
            Empleado
          </span>
          <select
            value={employeeId}
            onChange={(e) => setEmployeeId(e.target.value)}
            className="h-touch w-full rounded-2xl border border-transparent bg-mipiace-stone px-4 text-[14.5px] outline-none focus:border-mipiace-coral/30 focus:bg-white"
          >
            {empleados.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
                {e.active ? "" : " (de baja)"}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1.5 block text-[13px] font-medium text-mipiace-ink-soft">
            Día
          </span>
          <input
            type="date"
            value={fecha}
            max={hoy}
            onChange={(e) => setFecha(e.target.value)}
            className="h-touch w-full rounded-2xl border border-transparent bg-mipiace-stone px-4 text-[14.5px] tabular-nums outline-none focus:border-mipiace-coral/30 focus:bg-white"
          />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1.5 block text-[13px] font-medium text-mipiace-ink-soft">
              Entrada
            </span>
            <input
              type="time"
              value={entrada}
              onChange={(e) => setEntrada(e.target.value)}
              className="h-touch w-full rounded-2xl border border-transparent bg-mipiace-stone px-4 text-[16px] tabular-nums outline-none focus:border-mipiace-coral/30 focus:bg-white"
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[13px] font-medium text-mipiace-ink-soft">
              Salida
            </span>
            <input
              type="time"
              value={salida}
              onChange={(e) => setSalida(e.target.value)}
              className="h-touch w-full rounded-2xl border border-transparent bg-mipiace-stone px-4 text-[16px] tabular-nums outline-none focus:border-mipiace-coral/30 focus:bg-white"
            />
          </label>
        </div>

        <MotivoPicker
          value={motivo}
          text={texto}
          onChange={setMotivo}
          onTextChange={setTexto}
        />

        {error && <FieldError message={error} />}

        <PrimaryButton type="button" onClick={guardar} disabled={busy}>
          {busy ? "Guardando…" : "Añadir fichaje"}
        </PrimaryButton>
      </div>
    </Modal>
  );
}
