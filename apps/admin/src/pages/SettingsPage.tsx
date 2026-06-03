// Ajustes de tenant (B6 §4). El propietario edita aquí los flags
// que hasta ahora vivían sólo en BD con defaults sensatos. El MANAGER
// puede ver los valores actuales pero no editarlos.

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { AdminShell } from "../AdminShell.js";
import {
  api,
  ApiError,
  clearTokens,
  readEffectiveAuth,
  readonlyReasonLabel,
} from "../api.js";
import {
  CenteredLoader,
  FieldError,
  OutlineButton,
  PrimaryButton,
  SuccessBanner,
} from "../ui.js";

interface TenantSettings {
  cashierAutoLogoutMinutes: number;
  requireManagerPinForForceClose: boolean;
  requireOwnerPinForCashClose: boolean;
  deviceNewLoginAlertEnabled: boolean;
  discountThresholdPct: number;
  cashierSearchableContacts: boolean;
}

const AUTO_LOGOUT_MIN = 5;
const AUTO_LOGOUT_MAX = 60;

export function SettingsPage() {
  const navigate = useNavigate();
  const [settings, setSettings] = useState<TenantSettings | null>(null);
  const [form, setForm] = useState<TenantSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // v1.4-Bugs-Operativos Lote 2: usamos `readEffectiveAuth` para que la
  // impersonación full del super-admin pueda editar (canEdit=true) y la
  // readonly muestre el tooltip explícito en vez de un genérico "sólo
  // propietario".
  const effective = readEffectiveAuth();
  const canEdit = effective.canEdit;
  const readonlyTip = readonlyReasonLabel(effective.readonlyReason);

  useEffect(() => {
    api<{ settings: TenantSettings }>("/admin/tenant/settings")
      .then((res) => {
        setSettings(res.settings);
        setForm(res.settings);
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) {
          clearTokens();
          navigate("/login", { replace: true });
        } else if (err instanceof ApiError) {
          setError(err.message);
        }
      });
  }, [navigate]);

  async function onSave() {
    if (!form) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await api<{ settings: TenantSettings }>(
        "/admin/tenant/settings",
        { method: "POST", body: form },
      );
      setSettings(res.settings);
      setForm(res.settings);
      setSuccess("Ajustes guardados.");
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
      else setError("Error inesperado");
    } finally {
      setBusy(false);
    }
  }

  const dirty =
    !!form &&
    !!settings &&
    JSON.stringify(form) !== JSON.stringify(settings);

  if (!form || !settings) return <CenteredLoader label="Cargando ajustes…" />;

  return (
    <AdminShell title="Ajustes">
      <p className="text-[13.5px] text-slate-500 mb-5 -mt-2">
        Configura cómo opera el TPV. Estos ajustes aplican a todo el negocio.
        {!canEdit && readonlyTip && " " + readonlyTip + "."}
      </p>

      {success && <SuccessBanner message={success} />}
      {error && <FieldError message={error} />}

      <Section title="Cajeros" subtitle="Cómo se comporta la sesión del cajero en el TPV.">
        <SliderField
          id="autoLogout"
          label="Auto-logout por inactividad"
          unit="minutos"
          min={AUTO_LOGOUT_MIN}
          max={AUTO_LOGOUT_MAX}
          step={5}
          value={form.cashierAutoLogoutMinutes}
          disabled={!canEdit}
          onChange={(v) =>
            setForm({ ...form, cashierAutoLogoutMinutes: v })
          }
          help="Tras X minutos sin actividad la PWA pide PIN de nuevo. El turno sigue abierto."
        />
        <ToggleField
          id="searchableContacts"
          label="Cajeros pueden buscar contactos Holded"
          checked={form.cashierSearchableContacts}
          disabled={!canEdit}
          onChange={(v) =>
            setForm({ ...form, cashierSearchableContacts: v })
          }
          help="Si lo desactivas, sólo encargados y propietario pueden asociar contactos a un ticket."
        />
      </Section>

      <Section
        title="Seguridad"
        subtitle="Reglas que protegen los turnos y los dispositivos."
      >
        <ToggleField
          id="forceClosePin"
          label="PIN encargado para cerrar turnos de otro cajero"
          checked={form.requireManagerPinForForceClose}
          disabled={!canEdit}
          onChange={(v) =>
            setForm({ ...form, requireManagerPinForForceClose: v })
          }
          help="Cuando un cajero cierra un turno que no abrió (colgado), pedimos PIN del encargado."
        />
        <ToggleField
          id="ownerPinForCashClose"
          label="Sólo el propietario/encargado puede cerrar caja"
          checked={form.requireOwnerPinForCashClose}
          disabled={!canEdit}
          onChange={(v) =>
            setForm({ ...form, requireOwnerPinForCashClose: v })
          }
          help="Por defecto el cajero cierra con su propio PIN. Actívalo si prefieres que sólo OWNER o MANAGER puedan autorizar el cierre."
        />
        <ToggleField
          id="deviceAlertEmail"
          label="Email cuando un dispositivo nuevo se vincula"
          checked={form.deviceNewLoginAlertEnabled}
          disabled={!canEdit}
          onChange={(v) =>
            setForm({ ...form, deviceNewLoginAlertEnabled: v })
          }
          help="Te avisamos al primer login y cuando un dispositivo conocido cambia de país."
        />
      </Section>

      <Section
        title="Ventas"
        subtitle="Límites y autorizaciones operativas en la pantalla de venta."
      >
        <SliderField
          id="discountThreshold"
          label="Umbral de descuento sin autorización"
          unit="%"
          min={0}
          max={100}
          step={1}
          value={form.discountThresholdPct}
          disabled={!canEdit}
          onChange={(v) =>
            setForm({ ...form, discountThresholdPct: v })
          }
          help="Si el cajero aplica un descuento superior, el TPV pide PIN del encargado para autorizarlo."
        />
      </Section>

      {canEdit && (
        <div className="flex gap-2.5 mt-6">
          <PrimaryButton
            type="button"
            onClick={onSave}
            busy={busy}
            disabled={!dirty}
          >
            Guardar cambios
          </PrimaryButton>
          <OutlineButton
            type="button"
            onClick={() => setForm(settings)}
            disabled={!dirty || busy}
          >
            Descartar
          </OutlineButton>
        </div>
      )}
    </AdminShell>
  );
}

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-white rounded-2xl border border-slate-200 p-6 md:p-7 mb-5">
      <h2 className="text-[17px] font-semibold text-mipiace-ink tracking-tight">
        {title}
      </h2>
      {subtitle && (
        <p className="text-[13px] text-slate-500 mt-1 mb-5">{subtitle}</p>
      )}
      <div className="space-y-5">{children}</div>
    </section>
  );
}

function SliderField({
  id,
  label,
  unit,
  min,
  max,
  step,
  value,
  onChange,
  help,
  disabled,
}: {
  id: string;
  label: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
  help?: string;
  disabled?: boolean;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <label
          htmlFor={id}
          className="block text-[14px] font-medium text-mipiace-ink"
        >
          {label}
        </label>
        <span className="text-[13.5px] text-mipiace-ink tabular-nums">
          {value}
          <span className="text-slate-400 ml-1">{unit}</span>
        </span>
      </div>
      <input
        id={id}
        name={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        disabled={disabled}
        className="mt-2 w-full accent-mipiace-coral disabled:opacity-50"
      />
      {help && <p className="text-[12px] text-slate-400 mt-1.5">{help}</p>}
    </div>
  );
}

function ToggleField({
  id,
  label,
  checked,
  onChange,
  help,
  disabled,
}: {
  id: string;
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  help?: string;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <label
        htmlFor={id}
        className="text-[14px] font-medium text-mipiace-ink flex-1 cursor-pointer"
      >
        {label}
        {help && (
          <span className="block text-[12px] text-slate-400 mt-0.5 font-normal">
            {help}
          </span>
        )}
      </label>
      <input
        id={id}
        name={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-1 h-5 w-5 rounded border-slate-300 text-mipiace-coral focus:ring-mipiace-coral/30 disabled:opacity-50"
      />
    </div>
  );
}
