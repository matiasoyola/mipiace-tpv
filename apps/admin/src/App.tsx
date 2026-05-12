import { useEffect, useState } from "react";
import { Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { AlertCircle, Check, Eye, EyeOff, KeyRound, Loader2, RotateCcw } from "lucide-react";

import { AdminShell } from "./AdminShell.js";
import { Logo } from "./Logo.js";
import { api, ApiError, clearTokens, readTokens, storeTokens } from "./api.js";

interface MeResponse {
  user: { id: string; email: string; role: string };
  tenant: {
    id: string;
    name: string;
    hasHoldedKey: boolean;
    initialSyncStatus: "PENDING" | "RUNNING" | "DONE" | "FAILED";
    fiscalProfile: Record<string, string> | null;
    lastIncrementalSyncAt: string | null;
  };
}

export function App() {
  return (
    <Routes>
      <Route path="/" element={<RootRouter />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/signup" element={<SignupPage />} />
      <Route path="/onboarding" element={<ConnectHoldedPage />} />
      <Route path="/onboarding/sync" element={<SyncProgressPage />} />
      <Route path="/onboarding/done" element={<SyncSummaryPage />} />
      <Route path="/admin/account" element={<AccountPage />} />
      <Route path="/admin/products" element={<SkuReviewPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function RootRouter() {
  const navigate = useNavigate();
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!readTokens()) {
        navigate("/login", { replace: true });
        return;
      }
      try {
        const me = await api<MeResponse>("/auth/me");
        if (cancelled) return;
        if (!me.tenant.hasHoldedKey) navigate("/onboarding", { replace: true });
        else if (me.tenant.initialSyncStatus === "DONE")
          navigate("/admin/account", { replace: true });
        else navigate("/onboarding/sync", { replace: true });
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          clearTokens();
          navigate("/login", { replace: true });
        } else {
          throw err;
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [navigate]);
  return <CenteredLoader label="Cargando…" />;
}

// ── Centered helpers ─────────────────────────────────────────────────

function CenteredCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-mipiace-stone font-sans px-4">
      <div className="w-full max-w-md">
        <div className="flex justify-center mb-8">
          <Logo size={32} />
        </div>
        <div className="bg-white rounded-3xl border border-slate-200 p-7 md:p-8">{children}</div>
      </div>
    </div>
  );
}

function CenteredLoader({ label }: { label: string }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-mipiace-stone font-sans">
      <div className="flex flex-col items-center gap-3 text-slate-500">
        <Loader2 className="w-5 h-5 animate-spin" />
        <span className="text-[13.5px]">{label}</span>
      </div>
    </div>
  );
}

// Inputs y botones siguen los tokens de docs/design/tokens.md §5.
function TextField({
  id,
  label,
  type = "text",
  value,
  onChange,
  autoComplete,
  required,
  minLength,
  spellCheck,
}: {
  id: string;
  label: string;
  type?: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete?: string;
  required?: boolean;
  minLength?: number;
  spellCheck?: boolean;
}) {
  return (
    <div>
      <label
        htmlFor={id}
        className="block text-[13px] font-medium text-mipiace-ink-soft mb-1.5"
      >
        {label}
      </label>
      <input
        id={id}
        type={type}
        autoComplete={autoComplete}
        spellCheck={spellCheck}
        required={required}
        minLength={minLength}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full h-12 px-3.5 rounded-xl bg-mipiace-stone border border-transparent text-[14.5px] text-mipiace-ink focus:bg-white focus:border-mipiace-coral/30 focus:ring-2 focus:ring-mipiace-coral/30 focus:outline-none"
      />
    </div>
  );
}

function PrimaryButton({
  children,
  busy,
  disabled,
  type = "submit",
  onClick,
}: {
  children: React.ReactNode;
  busy?: boolean;
  disabled?: boolean;
  type?: "submit" | "button";
  onClick?: () => void;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={busy || disabled}
      className="w-full h-12 rounded-2xl bg-mipiace-coral hover:bg-mipiace-coral-dark text-white text-[14.5px] font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
    >
      {busy && <Loader2 className="w-4 h-4 animate-spin" />}
      {children}
    </button>
  );
}

function OutlineButton({
  children,
  onClick,
  busy,
  className = "",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  busy?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className={`h-11 px-4 rounded-2xl border border-slate-200 hover:bg-slate-50 text-[13.5px] text-mipiace-ink-soft font-medium transition-colors flex items-center justify-center gap-2 disabled:opacity-50 ${className}`}
    >
      {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
      {children}
    </button>
  );
}

function FieldError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className="mt-3 flex items-start gap-2 text-[13px] text-red-700 bg-red-50 rounded-xl px-3.5 py-2.5">
      <AlertCircle className="w-4 h-4 mt-px shrink-0" />
      <span>{message}</span>
    </div>
  );
}

function SuccessBanner({ message }: { message: string }) {
  return (
    <div className="mt-3 flex items-start gap-2 text-[13px] text-emerald-700 bg-emerald-50 rounded-xl px-3.5 py-2.5">
      <Check className="w-4 h-4 mt-px shrink-0" />
      <span>{message}</span>
    </div>
  );
}

// ── Login / Signup ───────────────────────────────────────────────────

function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const tokens = await api<{ accessToken: string; refreshToken: string }>("/auth/login", {
        method: "POST",
        body: { email, password, remember },
      });
      storeTokens(tokens, { remember });
      navigate("/", { replace: true });
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
      else throw err;
    } finally {
      setBusy(false);
    }
  }

  return (
    <CenteredCard>
      <h1 className="text-[22px] font-semibold text-mipiace-ink tracking-tight">
        Entra a mipiacetpv
      </h1>
      <p className="text-[13.5px] text-slate-500 mt-1 mb-6">Acceso del propietario.</p>
      <form onSubmit={onSubmit} className="space-y-4">
        <TextField
          id="email"
          label="Email"
          type="email"
          autoComplete="username"
          value={email}
          onChange={setEmail}
          required
        />
        <TextField
          id="password"
          label="Contraseña"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={setPassword}
          required
        />
        <label className="flex items-center gap-2.5 text-[13.5px] text-mipiace-ink-soft cursor-pointer select-none">
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-mipiace-coral focus:ring-mipiace-coral/30"
          />
          <span>
            Recuérdame en este dispositivo
            <span className="block text-[12px] text-slate-400">
              La sesión sobrevive al cierre del navegador.
            </span>
          </span>
        </label>
        <PrimaryButton busy={busy}>{busy ? "Entrando…" : "Entrar"}</PrimaryButton>
        <FieldError message={error} />
      </form>
      <p className="mt-6 text-[13px] text-slate-500">
        ¿Aún no tienes cuenta?{" "}
        <a href="/signup" className="text-mipiace-coral-dark font-medium hover:underline">
          Crea tu negocio
        </a>
      </p>
    </CenteredCard>
  );
}

function SignupPage() {
  const navigate = useNavigate();
  const [businessName, setBusinessName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const tokens = await api<{ accessToken: string; refreshToken: string }>("/auth/signup", {
        method: "POST",
        body: { businessName, email, password },
      });
      storeTokens(tokens);
      navigate("/onboarding", { replace: true });
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
      else throw err;
    } finally {
      setBusy(false);
    }
  }

  return (
    <CenteredCard>
      <h1 className="text-[22px] font-semibold text-mipiace-ink tracking-tight">
        Crea tu negocio
      </h1>
      <p className="text-[13.5px] text-slate-500 mt-1 mb-6">
        Necesitarás una cuenta de Holded activa para sincronizar tu catálogo.
      </p>
      <form onSubmit={onSubmit} className="space-y-4">
        <TextField
          id="businessName"
          label="Nombre del negocio"
          value={businessName}
          onChange={setBusinessName}
          required
        />
        <TextField
          id="email"
          label="Email"
          type="email"
          autoComplete="username"
          value={email}
          onChange={setEmail}
          required
        />
        <TextField
          id="password"
          label="Contraseña"
          type="password"
          autoComplete="new-password"
          minLength={10}
          value={password}
          onChange={setPassword}
          required
        />
        <PrimaryButton busy={busy}>{busy ? "Creando…" : "Crear cuenta"}</PrimaryButton>
        <FieldError message={error} />
      </form>
      <p className="mt-6 text-[13px] text-slate-500">
        ¿Ya la tienes?{" "}
        <a href="/login" className="text-mipiace-coral-dark font-medium hover:underline">
          Entra
        </a>
      </p>
    </CenteredCard>
  );
}

function ConnectHoldedPage() {
  const navigate = useNavigate();
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api("/onboarding/connect-holded", { method: "POST", body: { apiKey } });
      navigate("/onboarding/sync", { replace: true });
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
      else throw err;
    } finally {
      setBusy(false);
    }
  }

  return (
    <CenteredCard>
      <h1 className="text-[22px] font-semibold text-mipiace-ink tracking-tight">
        Conecta tu Holded
      </h1>
      <p className="text-[13.5px] text-slate-500 mt-1 mb-6">
        Genera una API Key en <em>Configuración → API → Crear API Key</em> en tu admin de Holded y
        pégala aquí. La guardamos cifrada.
      </p>
      <form onSubmit={onSubmit} className="space-y-4">
        <TextField
          id="apiKey"
          label="API Key de Holded"
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={apiKey}
          onChange={setApiKey}
          required
        />
        <PrimaryButton busy={busy}>{busy ? "Validando…" : "Conectar"}</PrimaryButton>
        <FieldError message={error} />
      </form>
    </CenteredCard>
  );
}

// ── Sync inicial (B1) ───────────────────────────────────────────────

interface SyncStatusResponse {
  status: "PENDING" | "RUNNING" | "DONE" | "FAILED";
  startedAt: string | null;
  completedAt: string | null;
  stats: SyncStats | null;
  errors: Array<{ step: string; message: string }>;
}

interface SyncStats {
  productsCount: number;
  servicesCount: number;
  warehousesCount: number;
  taxesCount: number;
  autoSkuFixed: number;
  autoSkuNeedsReview: number;
  wildcardsCreated: number;
  wildcardsReused: number;
  productPagesProcessed: number;
  servicePagesProcessed: number;
  currentStep?: string;
}

function SyncProgressPage() {
  const navigate = useNavigate();
  const [data, setData] = useState<SyncStatusResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function tick() {
      try {
        const s = await api<SyncStatusResponse>("/onboarding/sync-status");
        if (cancelled) return;
        setData(s);
        if (s.status === "DONE") {
          navigate("/onboarding/done", { replace: true });
          return;
        }
        if (s.status === "FAILED") return;
      } catch {
        // tolera errores puntuales, sigue polleando
      }
      if (!cancelled) setTimeout(tick, 1500);
    }
    tick();
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  const step = data?.stats?.currentStep ?? "Inicializando…";
  return (
    <CenteredCard>
      <h1 className="text-[22px] font-semibold text-mipiace-ink tracking-tight">
        Sincronizando con Holded
      </h1>
      <p className="text-[13.5px] text-slate-500 mt-1 mb-6">
        Estamos descargando tu catálogo. Esto puede tardar unos minutos en catálogos grandes — no
        cierres la pestaña.
      </p>
      <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
        <div
          className="h-full bg-mipiace-coral transition-all"
          style={{ width: data?.status === "DONE" ? "100%" : "60%" }}
        />
      </div>
      <p className="mt-3 text-[13px] text-slate-500">{step}</p>
      {data?.stats && (
        <div className="grid grid-cols-2 gap-2.5 mt-5">
          <StatTile value={data.stats.productsCount} label="productos" />
          <StatTile value={data.stats.servicesCount} label="servicios" />
          <StatTile value={data.stats.warehousesCount} label="almacenes" />
          <StatTile value={data.stats.taxesCount} label="tipos de IVA" />
        </div>
      )}
      {data?.status === "FAILED" && (
        <FieldError message="La sincronización ha fallado. Revisa el log del servidor." />
      )}
    </CenteredCard>
  );
}

function StatTile({ value, label }: { value: number; label: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 px-4 py-3 bg-mipiace-stone/40">
      <div className="text-[20px] font-semibold text-mipiace-ink tabular-nums leading-none">
        {value}
      </div>
      <div className="text-[12px] text-slate-500 mt-1">{label}</div>
    </div>
  );
}

function SyncSummaryPage() {
  const navigate = useNavigate();
  const [data, setData] = useState<SyncStatusResponse | null>(null);
  useEffect(() => {
    api<SyncStatusResponse>("/onboarding/sync-status").then(setData);
  }, []);
  if (!data) return <CenteredLoader label="Cargando resumen…" />;
  const stats = data.stats;
  return (
    <CenteredCard>
      <h1 className="text-[22px] font-semibold text-mipiace-ink tracking-tight">
        Sincronización completada
      </h1>
      <SuccessBanner message="Tu Holded está conectado y el catálogo descargado." />
      {stats && (
        <div className="grid grid-cols-2 gap-2.5 mt-5">
          <StatTile value={stats.productsCount} label="productos" />
          <StatTile value={stats.servicesCount} label="servicios" />
          <StatTile value={stats.warehousesCount} label="almacenes" />
          <StatTile value={stats.taxesCount} label="tipos de IVA" />
          <StatTile value={stats.autoSkuFixed} label="SKUs auto-asignados" />
          <StatTile value={stats.autoSkuNeedsReview} label="pendientes de revisión" />
        </div>
      )}
      <div className="mt-6">
        <PrimaryButton type="button" onClick={() => navigate("/admin/account")}>
          Ir a mi cuenta
        </PrimaryButton>
      </div>
    </CenteredCard>
  );
}

// ── Mi cuenta ────────────────────────────────────────────────────────

type FiscalProfile = {
  businessName?: string;
  nif?: string;
  address?: string;
  postalCode?: string;
  city?: string;
  province?: string;
  country?: string;
  source?: string;
  name?: string; // legado: del almacén default lo guarda como "name".
};

function AccountPage() {
  const navigate = useNavigate();
  const [me, setMe] = useState<MeResponse | null>(null);
  // Estado de "Probar conexión" + "Cambiar API Key".
  const [testing, setTesting] = useState(false);
  const [testMessage, setTestMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [rotating, setRotating] = useState(false);
  const [showRotateModal, setShowRotateModal] = useState(false);

  useEffect(() => {
    api<MeResponse>("/auth/me")
      .then(setMe)
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) {
          clearTokens();
          navigate("/login", { replace: true });
        }
      });
  }, [navigate]);

  async function onTestConnection() {
    setTesting(true);
    setTestMessage(null);
    try {
      await api<{ ok: true; validatedAt: string }>("/auth/me/test-holded-connection", {
        method: "POST",
        body: {},
      });
      setTestMessage({ ok: true, text: "Conexión OK. Holded responde correctamente." });
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Error al probar la conexión.";
      setTestMessage({ ok: false, text: msg });
    } finally {
      setTesting(false);
    }
  }

  if (!me) return <CenteredLoader label="Cargando cuenta…" />;
  const fp: FiscalProfile = me.tenant.fiscalProfile ?? {};
  const localPart = me.user.email.split("@")[0] ?? "MO";
  const initials = localPart
    .split(/[._-]/)
    .map((s) => s[0])
    .filter(Boolean)
    .join("");

  return (
    <AdminShell title="Mi cuenta" initials={initials}>
      <FiscalProfileSection
        initial={fp}
        onSaved={(updated) => {
          setMe({ ...me, tenant: { ...me.tenant, fiscalProfile: updated } });
        }}
      />

      <section className="bg-white rounded-2xl border border-slate-200 p-6 md:p-7 mb-5">
        <h2 className="text-[17px] font-semibold text-mipiace-ink tracking-tight mb-1">
          Conexión con Holded
        </h2>
        <p className="text-[13px] text-slate-500 mb-5">
          El TPV se sincroniza cada 15 minutos con tu cuenta Holded.
        </p>
        <div className="bg-mipiace-stone rounded-xl p-4 flex items-center gap-4 mb-4">
          <span className="h-10 w-10 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center">
            <Check className="w-5 h-5" strokeWidth={2.5} />
          </span>
          <div className="flex-1 min-w-0">
            <div className="text-[14.5px] font-medium text-mipiace-ink">
              {me.tenant.hasHoldedKey ? "Conectada correctamente" : "No conectada"}
            </div>
            <div className="text-[12.5px] text-slate-500 mt-0.5 truncate">
              {me.tenant.lastIncrementalSyncAt
                ? `Última sincronización ${formatRelative(me.tenant.lastIncrementalSyncAt)}`
                : "Aún sin sincronización incremental"}
            </div>
          </div>
          {me.tenant.hasHoldedKey && (
            <span className="text-[11px] text-emerald-700 font-medium uppercase tracking-wider px-2.5 py-1 rounded-lg bg-emerald-100 shrink-0">
              Activa
            </span>
          )}
        </div>
        <div className="grid sm:grid-cols-2 gap-2.5">
          <OutlineButton onClick={onTestConnection} busy={testing}>
            <RotateCcw className="w-3.5 h-3.5" />
            Probar conexión
          </OutlineButton>
          <OutlineButton onClick={() => setShowRotateModal(true)}>
            <KeyRound className="w-3.5 h-3.5" />
            Cambiar API Key
          </OutlineButton>
        </div>
        {testMessage &&
          (testMessage.ok ? (
            <SuccessBanner message={testMessage.text} />
          ) : (
            <FieldError message={testMessage.text} />
          ))}
      </section>

      {showRotateModal && (
        <RotateKeyModal
          onClose={() => setShowRotateModal(false)}
          busy={rotating}
          setBusy={setRotating}
          onSuccess={() => {
            setShowRotateModal(false);
            setTestMessage({ ok: true, text: "API Key actualizada y validada." });
          }}
        />
      )}

    </AdminShell>
  );
}

function FiscalProfileSection({
  initial,
  onSaved,
}: {
  initial: FiscalProfile;
  onSaved: (fp: FiscalProfile) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<FiscalProfile>(initial);
  // Cuando se actualiza initial desde fuera (e.g. tras save), sincronizamos.
  useEffect(() => setForm(initial), [initial]);

  async function onSave() {
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, string> = {};
      for (const k of [
        "businessName",
        "nif",
        "address",
        "postalCode",
        "city",
        "province",
        "country",
      ] as const) {
        const v = form[k];
        if (typeof v === "string" && v.length > 0) body[k] = v;
      }
      const res = await api<{ fiscalProfile: FiscalProfile }>(
        "/auth/me/fiscal-profile",
        { method: "PUT", body },
      );
      onSaved(res.fiscalProfile);
      setEditing(false);
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
      else throw err;
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="bg-white rounded-2xl border border-slate-200 p-6 md:p-7 mb-5">
      <div className="flex items-start justify-between mb-1">
        <div>
          <h2 className="text-[17px] font-semibold text-mipiace-ink tracking-tight">
            Datos fiscales del negocio
          </h2>
          <p className="text-[13px] text-slate-500 mt-1">
            Estos datos van impresos al pie de cada ticket.
          </p>
        </div>
        {!editing && (
          <OutlineButton onClick={() => setEditing(true)} className="!h-9 text-[13px]">
            Editar
          </OutlineButton>
        )}
      </div>
      {editing ? (
        <div className="space-y-4 mt-5">
          <div className="grid sm:grid-cols-2 gap-4">
            <TextField
              id="businessName"
              label="Razón social"
              value={form.businessName ?? ""}
              onChange={(v) => setForm({ ...form, businessName: v })}
            />
            <TextField
              id="nif"
              label="NIF / CIF"
              value={form.nif ?? ""}
              onChange={(v) => setForm({ ...form, nif: v })}
            />
          </div>
          <TextField
            id="address"
            label="Dirección"
            value={form.address ?? ""}
            onChange={(v) => setForm({ ...form, address: v })}
          />
          <div className="grid sm:grid-cols-3 gap-4">
            <TextField
              id="postalCode"
              label="Código postal"
              value={form.postalCode ?? ""}
              onChange={(v) => setForm({ ...form, postalCode: v })}
            />
            <TextField
              id="city"
              label="Ciudad"
              value={form.city ?? ""}
              onChange={(v) => setForm({ ...form, city: v })}
            />
            <TextField
              id="province"
              label="Provincia"
              value={form.province ?? ""}
              onChange={(v) => setForm({ ...form, province: v })}
            />
          </div>
          <TextField
            id="country"
            label="País"
            value={form.country ?? "España"}
            onChange={(v) => setForm({ ...form, country: v })}
          />
          <div className="flex gap-2.5 pt-2">
            <PrimaryButton type="button" onClick={onSave} busy={busy}>
              Guardar
            </PrimaryButton>
            <OutlineButton onClick={() => setEditing(false)}>Cancelar</OutlineButton>
          </div>
          <FieldError message={error} />
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 gap-x-6 gap-y-4 mt-5">
          <ReadOnlyField label="Razón social" value={form.businessName ?? form.name ?? "—"} />
          <ReadOnlyField label="NIF / CIF" value={form.nif ?? "—"} tabular />
          <ReadOnlyField
            label="Dirección"
            value={
              [form.address, form.postalCode, form.city, form.province]
                .filter(Boolean)
                .join(", ") || "—"
            }
            wide
          />
        </div>
      )}
    </section>
  );
}

function ReadOnlyField({
  label,
  value,
  tabular,
  wide,
}: {
  label: string;
  value: string;
  tabular?: boolean;
  wide?: boolean;
}) {
  return (
    <div className={wide ? "sm:col-span-2" : ""}>
      <div className="text-[11.5px] uppercase tracking-wider text-slate-400 font-medium mb-1">
        {label}
      </div>
      <div
        className={`text-[14.5px] text-mipiace-ink font-medium ${tabular ? "tabular-nums" : ""}`}
      >
        {value}
      </div>
    </div>
  );
}

function RotateKeyModal({
  onClose,
  busy,
  setBusy,
  onSuccess,
}: {
  onClose: () => void;
  busy: boolean;
  setBusy: (b: boolean) => void;
  onSuccess: () => void;
}) {
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/auth/me/rotate-holded-key", { method: "POST", body: { apiKey } });
      onSuccess();
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
      else throw err;
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-mipiace-ink/40 flex items-end sm:items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white w-full max-w-md rounded-3xl border border-slate-200 p-6 md:p-7"
      >
        <h2 className="text-[18px] font-semibold text-mipiace-ink tracking-tight">
          Cambiar API Key
        </h2>
        <p className="text-[13px] text-slate-500 mt-1 mb-5">
          Validamos la nueva contra Holded antes de sobreescribir la actual. Si la nueva falla,
          mantenemos la antigua.
        </p>
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="newApiKey"
              className="block text-[13px] font-medium text-mipiace-ink-soft mb-1.5"
            >
              Nueva API Key
            </label>
            <div className="relative">
              <input
                id="newApiKey"
                type={showKey ? "text" : "password"}
                autoComplete="off"
                spellCheck={false}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                required
                minLength={10}
                className="w-full h-12 pl-3.5 pr-12 rounded-xl bg-mipiace-stone border border-transparent text-[14.5px] focus:bg-white focus:border-mipiace-coral/30 focus:ring-2 focus:ring-mipiace-coral/30 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => setShowKey((s) => !s)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-mipiace-ink"
                aria-label={showKey ? "Ocultar" : "Mostrar"}
              >
                {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
          <div className="flex gap-2.5">
            <PrimaryButton type="submit" busy={busy}>
              Validar y guardar
            </PrimaryButton>
            <OutlineButton onClick={onClose}>Cancelar</OutlineButton>
          </div>
          <FieldError message={error} />
        </form>
      </div>
    </div>
  );
}

// ── Bandeja SKU ─────────────────────────────────────────────────────

interface SkuReviewItem {
  id: string;
  holdedProductId: string;
  name: string;
  basePrice: number;
  taxRate: number;
  currentSku: string | null;
  suggestedSku: string;
  sellableViaTpv: boolean;
}

function SkuReviewPage() {
  const navigate = useNavigate();
  const [items, setItems] = useState<SkuReviewItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ items: SkuReviewItem[] }>("/catalog/sku-review")
      .then((res) => setItems(res.items))
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) {
          clearTokens();
          navigate("/login", { replace: true });
        } else if (err instanceof ApiError) {
          setError(err.message);
        }
      });
  }, [navigate]);

  function onAssigned(productId: string) {
    setItems((curr) => (curr ?? []).filter((it) => it.id !== productId));
  }

  if (!items) return <CenteredLoader label="Cargando bandeja…" />;
  return (
    <AdminShell title="Productos pendientes de SKU">
      <p className="text-[13.5px] text-slate-500 mb-5 -mt-2">
        Productos cuyo SKU automático fue descartado silenciosamente por Holded. Asigna un SKU
        manual para volver a venderlos en el TPV.
      </p>
      {error && <FieldError message={error} />}
      {items.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-7 text-center">
          <div className="h-12 w-12 mx-auto rounded-2xl bg-emerald-100 text-emerald-700 flex items-center justify-center mb-3">
            <Check className="w-6 h-6" />
          </div>
          <h2 className="text-[16px] font-semibold text-mipiace-ink">No hay productos pendientes</h2>
          <p className="text-[13.5px] text-slate-500 mt-1">
            Todos los productos tienen un SKU asignado.
          </p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {items.map((item) => (
            <SkuReviewRow key={item.id} item={item} onAssigned={() => onAssigned(item.id)} />
          ))}
        </div>
      )}
    </AdminShell>
  );
}

function SkuReviewRow({
  item,
  onAssigned,
}: {
  item: SkuReviewItem;
  onAssigned: () => void;
}) {
  const [sku, setSku] = useState(item.currentSku ?? item.suggestedSku);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit() {
    setBusy(true);
    setError(null);
    try {
      await api(`/catalog/sku-review/${item.id}/assign`, {
        method: "POST",
        body: { sku },
      });
      onAssigned();
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
      else throw err;
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5">
      <div className="flex items-start justify-between gap-4 mb-3">
        <div className="min-w-0 flex-1">
          <div className="text-[14.5px] font-medium text-mipiace-ink truncate">{item.name}</div>
          <div className="text-[12.5px] text-slate-500 mt-0.5 tabular-nums">
            {item.basePrice.toFixed(2)} € · IVA {item.taxRate}% · ID Holded {item.holdedProductId.slice(0, 8)}…
          </div>
        </div>
      </div>
      <div className="flex flex-col sm:flex-row gap-2.5">
        <input
          value={sku}
          onChange={(e) => setSku(e.target.value)}
          placeholder={item.suggestedSku}
          className="flex-1 h-11 px-3.5 rounded-xl bg-mipiace-stone border border-transparent text-[14px] focus:bg-white focus:border-mipiace-coral/30 focus:ring-2 focus:ring-mipiace-coral/30 focus:outline-none tabular-nums"
        />
        <button
          onClick={onSubmit}
          disabled={busy || sku.trim().length === 0}
          className="h-11 px-5 rounded-2xl bg-mipiace-coral hover:bg-mipiace-coral-dark text-white text-[13.5px] font-medium disabled:opacity-50 flex items-center justify-center gap-2 transition-colors"
        >
          {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          Asignar y subir
        </button>
      </div>
      <FieldError message={error} />
    </div>
  );
}

// ── Utilidades ───────────────────────────────────────────────────────

function formatRelative(iso: string): string {
  const diffMin = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (diffMin < 1) return "hace un momento";
  if (diffMin < 60) return `hace ${diffMin} min`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `hace ${diffHr} h`;
  const diffDays = Math.round(diffHr / 24);
  return `hace ${diffDays} día${diffDays === 1 ? "" : "s"}`;
}
