// Panel de Personal + horarios (B-reservas-3). Gestiona los profesionales
// (extensión del `user` existente — ADR-R1), la matriz de servicios que da
// cada uno y sus turnos (semana tipo `rrule` + validez). Gate por
// `agendaEnabled` (ADR-R6). Vocabulario neutro: "profesional".

import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { AdminShell } from "../AdminShell.js";
import { api, ApiError, clearTokens, readEffectiveAuth } from "../api.js";
import {
  CenteredLoader,
  FieldError,
  OutlineButton,
  PrimaryButton,
} from "../ui.js";

// ── Tipos del contrato de la API ─────────────────────────────────────
interface StaffProfile {
  userId: string;
  displayName: string;
  active: boolean;
  color: string | null;
}
interface StaffRow {
  userId: string;
  alias: string | null;
  email: string;
  role: "OWNER" | "MANAGER" | "CASHIER";
  profile: StaffProfile | null;
  serviceIds: string[];
  skillCount: number;
}
interface ServiceRow {
  id: string;
  name: string;
}
type ShiftKind = "REGULAR" | "REINFORCEMENT" | "SWAP";
interface Shift {
  id: string;
  rrule: string;
  startTime: string;
  endTime: string;
  validFrom: string;
  validUntil: string | null;
  kind: ShiftKind;
}

// Días RFC 5545 en orden L→D con etiqueta corta ES.
const WEEKDAYS: Array<{ code: string; label: string }> = [
  { code: "MO", label: "L" },
  { code: "TU", label: "M" },
  { code: "WE", label: "X" },
  { code: "TH", label: "J" },
  { code: "FR", label: "V" },
  { code: "SA", label: "S" },
  { code: "SU", label: "D" },
];
const KIND_LABEL: Record<ShiftKind, string> = {
  REGULAR: "Regular",
  REINFORCEMENT: "Refuerzo",
  SWAP: "Cambio",
};
// Paleta de colores sugeridos para pintar la columna en la agenda.
const COLOR_PRESETS = [
  "#e8663c",
  "#3c8ce8",
  "#2fb686",
  "#b65fd6",
  "#d6a13c",
  "#5f6bd6",
];

function parseByday(rrule: string): string[] {
  const m = /BYDAY=([^;]+)/i.exec(rrule);
  return m ? m[1]!.split(",").map((d) => d.trim().toUpperCase()) : [];
}

function shiftSummary(s: Shift): string {
  const days = parseByday(s.rrule)
    .map((code) => WEEKDAYS.find((w) => w.code === code)?.label ?? code)
    .join(" ");
  const range = s.validUntil
    ? `${s.validFrom} → ${s.validUntil}`
    : `desde ${s.validFrom}`;
  return `${days || "(sin días)"} · ${s.startTime}–${s.endTime} · ${range}`;
}

export function StaffPage() {
  const navigate = useNavigate();
  const [agendaEnabled, setAgendaEnabled] = useState<boolean | null>(null);
  const [staff, setStaff] = useState<StaffRow[] | null>(null);
  const [services, setServices] = useState<ServiceRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  const canEdit = readEffectiveAuth().canEdit;

  const refresh = useCallback(async () => {
    const res = await api<{ staff: StaffRow[] }>("/staff");
    setStaff(res.staff);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const settings = await api<{ settings: { agendaEnabled: boolean } }>(
          "/admin/tenant/settings",
        );
        setAgendaEnabled(settings.settings.agendaEnabled);
        if (!settings.settings.agendaEnabled) return;
        const [staffRes, svcRes] = await Promise.all([
          api<{ staff: StaffRow[] }>("/staff"),
          api<{ services: ServiceRow[] }>("/staff/services"),
        ]);
        setStaff(staffRes.staff);
        setServices(svcRes.services);
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          clearTokens();
          navigate("/login", { replace: true });
        } else if (err instanceof ApiError) {
          setError(err.message);
        } else throw err;
      }
    })();
  }, [navigate]);

  if (agendaEnabled === null) return <CenteredLoader label="Cargando…" />;

  if (!agendaEnabled) {
    return (
      <AdminShell title="Personal">
        <div className="bg-white rounded-2xl border border-slate-200 p-7 text-center">
          <h2 className="text-[16px] font-semibold text-mipiace-ink">
            El módulo de agenda está desactivado
          </h2>
          <p className="text-[13.5px] text-slate-500 mt-1 mb-4">
            Actívalo en Ajustes para gestionar profesionales, servicios que da
            cada uno y sus turnos.
          </p>
          <PrimaryButton type="button" onClick={() => navigate("/admin/settings")}>
            Ir a Ajustes
          </PrimaryButton>
        </div>
      </AdminShell>
    );
  }

  return (
    <AdminShell title="Personal">
      <p className="text-[13.5px] text-slate-500 mb-5 -mt-2">
        Da de alta a tus profesionales, marca qué servicios da cada uno y
        define su semana tipo. Es la base de la agenda.
      </p>
      {error && <FieldError message={error} />}
      {!staff ? (
        <CenteredLoader label="Cargando personal…" />
      ) : staff.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-7 text-center text-[13.5px] text-slate-500">
          No hay usuarios en este negocio todavía. Crea cajeros o encargados en
          la sección Cajeros.
        </div>
      ) : (
        <div className="space-y-3">
          {staff.map((row) => (
            <ProfessionalCard
              key={row.userId}
              row={row}
              services={services}
              canEdit={canEdit}
              onChanged={refresh}
              onError={setError}
            />
          ))}
        </div>
      )}
    </AdminShell>
  );
}

function ProfessionalCard({
  row,
  services,
  canEdit,
  onChanged,
  onError,
}: {
  row: StaffRow;
  services: ServiceRow[];
  canEdit: boolean;
  onChanged: () => Promise<void>;
  onError: (m: string | null) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const displayName =
    row.profile?.displayName ?? row.alias ?? row.email.split("@")[0] ?? "—";
  const isPro = row.profile !== null;

  return (
    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="w-full flex items-center gap-3 p-4 text-left hover:bg-slate-50"
      >
        <span
          className="h-9 w-9 rounded-xl flex items-center justify-center text-white text-[13px] font-medium shrink-0"
          style={{ backgroundColor: row.profile?.color ?? "#94a3b8" }}
        >
          {displayName.slice(0, 2).toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[14.5px] font-medium text-mipiace-ink truncate">
            {displayName}
            {isPro && !row.profile!.active && (
              <span className="ml-2 text-[11px] text-slate-400">(inactivo)</span>
            )}
          </div>
          <div className="text-[12.5px] text-slate-500 truncate">
            {row.email} · {row.role.toLowerCase()}
          </div>
        </div>
        {isPro ? (
          <span className="text-[11.5px] text-slate-500 shrink-0">
            {row.skillCount} servicio{row.skillCount === 1 ? "" : "s"}
          </span>
        ) : (
          <span className="text-[11.5px] text-mipiace-coral-dark font-medium shrink-0">
            Sin perfil
          </span>
        )}
      </button>

      {expanded && (
        <div className="border-t border-slate-100 p-4 space-y-6">
          <ProfileEditor
            row={row}
            canEdit={canEdit}
            onChanged={onChanged}
            onError={onError}
          />
          {isPro && (
            <>
              <SkillsEditor
                row={row}
                services={services}
                canEdit={canEdit}
                onChanged={onChanged}
                onError={onError}
              />
              <ShiftsEditor
                userId={row.userId}
                canEdit={canEdit}
                onError={onError}
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}

function ProfileEditor({
  row,
  canEdit,
  onChanged,
  onError,
}: {
  row: StaffRow;
  canEdit: boolean;
  onChanged: () => Promise<void>;
  onError: (m: string | null) => void;
}) {
  const [displayName, setDisplayName] = useState(
    row.profile?.displayName ?? row.alias ?? "",
  );
  const [color, setColor] = useState(row.profile?.color ?? COLOR_PRESETS[0]!);
  const [active, setActive] = useState(row.profile?.active ?? true);
  const [busy, setBusy] = useState(false);

  async function save() {
    onError(null);
    setBusy(true);
    try {
      await api(`/staff/${row.userId}`, {
        method: "PUT",
        body: { displayName: displayName.trim(), color, active },
      });
      await onChanged();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "Error al guardar");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <h3 className="text-[13px] font-semibold text-mipiace-ink mb-3">Perfil</h3>
      <div className="grid sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-[13px] font-medium text-mipiace-ink-soft mb-1.5">
            Nombre en la agenda
          </label>
          <input
            value={displayName}
            disabled={!canEdit}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder={row.alias ?? "Nombre"}
            className="w-full h-11 px-3.5 rounded-xl bg-mipiace-stone border border-transparent text-[14px] focus:bg-white focus:border-mipiace-coral/30 focus:ring-2 focus:ring-mipiace-coral/30 focus:outline-none disabled:opacity-50"
          />
        </div>
        <div>
          <label className="block text-[13px] font-medium text-mipiace-ink-soft mb-1.5">
            Color
          </label>
          <div className="flex items-center gap-2 flex-wrap">
            {COLOR_PRESETS.map((c) => (
              <button
                key={c}
                type="button"
                disabled={!canEdit}
                onClick={() => setColor(c)}
                aria-label={`Color ${c}`}
                className={
                  "h-8 w-8 rounded-lg border-2 " +
                  (color === c ? "border-mipiace-ink" : "border-transparent")
                }
                style={{ backgroundColor: c }}
              />
            ))}
            <input
              type="color"
              value={color}
              disabled={!canEdit}
              onChange={(e) => setColor(e.target.value)}
              className="h-8 w-10 rounded-lg border border-slate-200 bg-white disabled:opacity-50"
            />
          </div>
        </div>
      </div>
      <label className="flex items-center gap-2.5 mt-4 text-[13.5px] text-mipiace-ink cursor-pointer">
        <input
          type="checkbox"
          checked={active}
          disabled={!canEdit}
          onChange={(e) => setActive(e.target.checked)}
          className="h-4.5 w-4.5 rounded border-slate-300 text-mipiace-coral focus:ring-mipiace-coral/30"
        />
        Activo en la agenda
      </label>
      {canEdit && (
        <div className="mt-4">
          <PrimaryButton
            type="button"
            onClick={save}
            busy={busy}
            disabled={displayName.trim().length === 0}
            className="!w-auto px-5 !h-10 !text-[13.5px]"
          >
            {row.profile ? "Guardar perfil" : "Dar de alta como profesional"}
          </PrimaryButton>
        </div>
      )}
    </section>
  );
}

function SkillsEditor({
  row,
  services,
  canEdit,
  onChanged,
  onError,
}: {
  row: StaffRow;
  services: ServiceRow[];
  canEdit: boolean;
  onChanged: () => Promise<void>;
  onError: (m: string | null) => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(row.serviceIds),
  );
  const [busy, setBusy] = useState(false);
  const dirty = useMemo(() => {
    const a = new Set(row.serviceIds);
    if (a.size !== selected.size) return true;
    for (const id of selected) if (!a.has(id)) return true;
    return false;
  }, [row.serviceIds, selected]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function save() {
    onError(null);
    setBusy(true);
    try {
      await api(`/staff/${row.userId}/skills`, {
        method: "PUT",
        body: { serviceIds: [...selected] },
      });
      await onChanged();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "Error al guardar");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <h3 className="text-[13px] font-semibold text-mipiace-ink mb-3">
        Servicios que da
      </h3>
      {services.length === 0 ? (
        <p className="text-[13px] text-slate-500">
          No hay servicios en el catálogo. Márcalos como servicio en Holded y
          sincroniza.
        </p>
      ) : (
        <div className="grid sm:grid-cols-2 gap-x-4 gap-y-2">
          {services.map((svc) => (
            <label
              key={svc.id}
              className="flex items-center gap-2.5 text-[13.5px] text-mipiace-ink cursor-pointer"
            >
              <input
                type="checkbox"
                checked={selected.has(svc.id)}
                disabled={!canEdit}
                onChange={() => toggle(svc.id)}
                className="h-4 w-4 rounded border-slate-300 text-mipiace-coral focus:ring-mipiace-coral/30"
              />
              <span className="truncate">{svc.name}</span>
            </label>
          ))}
        </div>
      )}
      {canEdit && (
        <div className="mt-4">
          <OutlineButton
            type="button"
            onClick={save}
            busy={busy}
            disabled={!dirty}
            className="!w-auto px-5 !h-10 !text-[13.5px]"
          >
            Guardar servicios
          </OutlineButton>
        </div>
      )}
    </section>
  );
}

function ShiftsEditor({
  userId,
  canEdit,
  onError,
}: {
  userId: string;
  canEdit: boolean;
  onError: (m: string | null) => void;
}) {
  const [shifts, setShifts] = useState<Shift[] | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api<{ shifts: Shift[] }>(`/staff/${userId}/shifts`);
      setShifts(res.shifts);
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "Error al cargar turnos");
    }
  }, [userId, onError]);

  useEffect(() => {
    void load();
  }, [load]);

  async function remove(shiftId: string) {
    if (!window.confirm("¿Borrar este turno?")) return;
    onError(null);
    try {
      await api(`/staff/${userId}/shifts/${shiftId}`, { method: "DELETE" });
      await load();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "Error al borrar");
    }
  }

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[13px] font-semibold text-mipiace-ink">
          Turnos (semana tipo)
        </h3>
        {canEdit && !adding && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="text-[12.5px] text-mipiace-coral-dark font-medium hover:underline"
          >
            + Añadir turno
          </button>
        )}
      </div>
      {shifts === null ? (
        <p className="text-[13px] text-slate-400">Cargando turnos…</p>
      ) : shifts.length === 0 && !adding ? (
        <p className="text-[13px] text-slate-500">
          Sin turnos. Añade la semana tipo del profesional.
        </p>
      ) : (
        <div className="space-y-2">
          {shifts.map((s) => (
            <div
              key={s.id}
              className="flex items-center gap-3 rounded-xl bg-mipiace-stone px-3.5 py-2.5"
            >
              <span className="text-[11px] uppercase tracking-wide text-slate-500 shrink-0">
                {KIND_LABEL[s.kind]}
              </span>
              <span className="text-[13px] text-mipiace-ink flex-1 min-w-0 truncate tabular-nums">
                {shiftSummary(s)}
              </span>
              {canEdit && (
                <button
                  type="button"
                  onClick={() => remove(s.id)}
                  className="text-[12px] text-slate-400 hover:text-red-600 shrink-0"
                >
                  Borrar
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      {adding && (
        <ShiftForm
          userId={userId}
          onError={onError}
          onDone={async (saved) => {
            setAdding(false);
            if (saved) await load();
          }}
        />
      )}
    </section>
  );
}

function ShiftForm({
  userId,
  onError,
  onDone,
}: {
  userId: string;
  onError: (m: string | null) => void;
  onDone: (saved: boolean) => Promise<void>;
}) {
  const [days, setDays] = useState<Set<string>>(new Set());
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("14:00");
  const [validFrom, setValidFrom] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [kind, setKind] = useState<ShiftKind>("REGULAR");
  const [busy, setBusy] = useState(false);

  function toggleDay(code: string) {
    setDays((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }

  async function save() {
    onError(null);
    if (days.size === 0) {
      onError("Elige al menos un día de la semana.");
      return;
    }
    if (!validFrom) {
      onError("Indica desde cuándo rige el turno.");
      return;
    }
    // Orden canónico L→D en la rrule.
    const byday = WEEKDAYS.filter((w) => days.has(w.code))
      .map((w) => w.code)
      .join(",");
    setBusy(true);
    try {
      await api(`/staff/${userId}/shifts`, {
        method: "POST",
        body: {
          rrule: `FREQ=WEEKLY;BYDAY=${byday}`,
          startTime,
          endTime,
          validFrom,
          validUntil: validUntil || null,
          kind,
        },
      });
      await onDone(true);
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "Error al crear el turno");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 rounded-xl border border-slate-200 p-4">
      <div className="mb-3">
        <div className="text-[12.5px] font-medium text-mipiace-ink-soft mb-2">
          Días
        </div>
        <div className="flex gap-1.5">
          {WEEKDAYS.map((w) => (
            <button
              key={w.code}
              type="button"
              onClick={() => toggleDay(w.code)}
              className={
                "h-9 w-9 rounded-lg text-[13px] font-medium " +
                (days.has(w.code)
                  ? "bg-mipiace-coral text-white"
                  : "bg-mipiace-stone text-slate-500 hover:bg-slate-100")
              }
            >
              {w.label}
            </button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Field label="Desde (hora)">
          <input
            type="time"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
            className="w-full h-10 px-3 rounded-lg bg-mipiace-stone border border-transparent text-[13.5px] tabular-nums focus:bg-white focus:border-mipiace-coral/30 focus:outline-none"
          />
        </Field>
        <Field label="Hasta (hora)">
          <input
            type="time"
            value={endTime}
            onChange={(e) => setEndTime(e.target.value)}
            className="w-full h-10 px-3 rounded-lg bg-mipiace-stone border border-transparent text-[13.5px] tabular-nums focus:bg-white focus:border-mipiace-coral/30 focus:outline-none"
          />
        </Field>
        <Field label="Válido desde">
          <input
            type="date"
            value={validFrom}
            onChange={(e) => setValidFrom(e.target.value)}
            className="w-full h-10 px-3 rounded-lg bg-mipiace-stone border border-transparent text-[13.5px] tabular-nums focus:bg-white focus:border-mipiace-coral/30 focus:outline-none"
          />
        </Field>
        <Field label="Válido hasta (opcional)">
          <input
            type="date"
            value={validUntil}
            onChange={(e) => setValidUntil(e.target.value)}
            className="w-full h-10 px-3 rounded-lg bg-mipiace-stone border border-transparent text-[13.5px] tabular-nums focus:bg-white focus:border-mipiace-coral/30 focus:outline-none"
          />
        </Field>
      </div>
      <div className="mt-3">
        <Field label="Tipo">
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as ShiftKind)}
            className="w-full sm:w-48 h-10 px-3 rounded-lg bg-mipiace-stone border border-transparent text-[13.5px] focus:bg-white focus:border-mipiace-coral/30 focus:outline-none"
          >
            <option value="REGULAR">Regular</option>
            <option value="REINFORCEMENT">Refuerzo</option>
            <option value="SWAP">Cambio</option>
          </select>
        </Field>
      </div>
      <div className="flex gap-2.5 mt-4">
        <PrimaryButton
          type="button"
          onClick={save}
          busy={busy}
          className="!w-auto px-5 !h-10 !text-[13.5px]"
        >
          Crear turno
        </PrimaryButton>
        <OutlineButton
          type="button"
          onClick={() => void onDone(false)}
          className="!w-auto px-5 !h-10 !text-[13.5px]"
        >
          Cancelar
        </OutlineButton>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-[12px] font-medium text-slate-500 mb-1">
        {label}
      </label>
      {children}
    </div>
  );
}
