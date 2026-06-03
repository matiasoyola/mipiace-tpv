import { useEffect, useState } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { Check, Eye, EyeOff, KeyRound, RotateCcw } from "lucide-react";

import { AdminShell } from "./AdminShell.js";
import { ImpersonationBootstrap } from "./components/ImpersonationBootstrap.js";
import { CashiersPage } from "./pages/CashiersPage.js";
import { DevicesPage } from "./pages/DevicesPage.js";
import { GiftReceiptsPage } from "./pages/GiftReceiptsPage.js";
import { HoldedPage } from "./pages/HoldedPage.js";
import { ForgotPasswordPage, ResetPasswordPage } from "./pages/PasswordResetPages.js";
import { PrintersPage } from "./pages/PrintersPage.js";
import { SecurityPage } from "./pages/SecurityPage.js";
import { SettingsPage } from "./pages/SettingsPage.js";
import { StoreDetailPage, StoresPage } from "./pages/StoresPage.js";
import { TagAliasesPage } from "./pages/TagAliasesPage.js";
import { TagSectionsPage } from "./pages/TagSectionsPage.js";
import { TicketsErrorsPage } from "./pages/TicketsErrorsPage.js";
import { AdminsListPage } from "./superadmin/AdminsListPage.js";
import { AuditLogPage } from "./superadmin/AuditLogPage.js";
import { CreateTenantPage } from "./superadmin/CreateTenantPage.js";
import { HubPage } from "./superadmin/HubPage.js";
import { SuperAdminGate } from "./superadmin/SuperAdminGate.js";
import { SuperAdminLoginPage } from "./superadmin/SuperAdminLoginPage.js";
import { SuperAdminMePage } from "./superadmin/SuperAdminMePage.js";
import { TenantDetailPage } from "./superadmin/TenantDetailPage.js";
import { TenantsListPage } from "./superadmin/TenantsListPage.js";
import {
  api,
  ApiError,
  clearTokens,
  readEffectiveAuth,
  readTokens,
  storeTokens,
} from "./api.js";
import {
  CenteredCard,
  CenteredLoader,
  FieldError,
  formatDireccion,
  formatRelative,
  OutlineButton,
  PrimaryButton,
  ReadOnlyField,
  SuccessBanner,
  TextField,
} from "./ui.js";

interface MeResponse {
  user: {
    id: string;
    email: string;
    role: string;
    twoFactorEnabled?: boolean;
    recoveryCodesRemaining?: number;
  };
  tenant: {
    id: string;
    name: string;
    hasHoldedKey: boolean;
    initialSyncStatus: "PENDING" | "RUNNING" | "DONE" | "FAILED";
    fiscalProfile: Record<string, unknown> | null;
    lastIncrementalSyncAt: string | null;
  };
}

export function App() {
  return (
    <>
      <ImpersonationBootstrap />
      <Routes>
        <Route path="/" element={<RootRouter />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignupPage />} />
        <Route path="/change-password-initial" element={<ChangePasswordInitialPage />} />
        <Route path="/onboarding" element={<ConnectHoldedPage />} />
        <Route path="/onboarding/sync" element={<SyncProgressPage />} />
        <Route path="/onboarding/done" element={<SyncSummaryPage />} />
        <Route path="/admin/account" element={<AccountPage />} />
        <Route path="/admin/products" element={<SkuReviewPage />} />
        <Route path="/admin/devices" element={<DevicesPage />} />
        <Route path="/admin/cashiers" element={<CashiersPage />} />
        <Route path="/admin/security" element={<SecurityPage />} />
        <Route path="/admin/stores" element={<StoresPage />} />
        <Route path="/admin/stores/:storeId" element={<StoreDetailPage />} />
        <Route path="/admin/tickets-errors" element={<TicketsErrorsPage />} />
        <Route path="/admin/settings" element={<SettingsPage />} />
        <Route path="/admin/tag-aliases" element={<TagAliasesPage />} />
        <Route path="/admin/tag-sections" element={<TagSectionsPage />} />
        <Route path="/admin/printers" element={<PrintersPage />} />
        <Route path="/admin/holded" element={<HoldedPage />} />
        <Route path="/admin/gift-receipts" element={<GiftReceiptsPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/admin/reset" element={<ResetPasswordPage />} />
        {/* B-SuperAdmin: consola super-admin (shell propio, sesión separada) */}
        <Route path="/superadmin/login" element={<SuperAdminLoginPage />} />
        {/* v1.3-SuperAdmin-Hub Lote 2: el hub es ahora la landing por
            defecto del super-admin (antes navegaba a /tenants). */}
        <Route path="/superadmin" element={<SuperAdminGate><Navigate to="/superadmin/hub" replace /></SuperAdminGate>} />
        <Route path="/superadmin/hub" element={<SuperAdminGate><HubPage /></SuperAdminGate>} />
        <Route path="/superadmin/tenants" element={<SuperAdminGate><TenantsListPage /></SuperAdminGate>} />
        <Route path="/superadmin/tenants/new" element={<SuperAdminGate><CreateTenantPage /></SuperAdminGate>} />
        <Route path="/superadmin/tenants/:id" element={<SuperAdminGate><TenantDetailPage /></SuperAdminGate>} />
        <Route path="/superadmin/audit" element={<SuperAdminGate><AuditLogPage /></SuperAdminGate>} />
        <Route path="/superadmin/admins" element={<SuperAdminGate><AdminsListPage /></SuperAdminGate>} />
        <Route path="/superadmin/me" element={<SuperAdminGate><SuperAdminMePage /></SuperAdminGate>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
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
        // B6 §1: el MANAGER nunca pasa por onboarding (no puede conectar
        // Holded ni mover el sync inicial). Va directo a la bandeja de
        // tickets-errors, que es su pantalla operativa principal.
        if (me.user.role === "MANAGER") {
          navigate("/admin/tickets-errors", { replace: true });
          return;
        }
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

// Componentes UI compartidos viven en `./ui.tsx`. CenteredCard,
// PrimaryButton, OutlineButton, etc. se importan desde allí.

// ── Login / Signup ───────────────────────────────────────────────────

function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Paso 2 cuando el backend pide código TOTP / recovery code.
  const [pendingToken, setPendingToken] = useState<string | null>(null);
  const [twoFactorCode, setTwoFactorCode] = useState("");
  // B7 §9: si el OWNER no tenía PIN, el backend lo auto-genera y lo
  // devuelve UNA VEZ en el login response. Lo mostramos en un modal
  // antes de navegar; el cajero pega el PIN en el TPV para autorizar.
  const [ownerPinJustGenerated, setOwnerPinJustGenerated] = useState<
    string | null
  >(null);

  // Banner verde post-reset, si venimos de `/admin/reset?token=...` OK.
  const justReset = location.state && (location.state as { justReset?: boolean }).justReset;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await api<
        | {
            accessToken: string;
            refreshToken: string;
            ownerPinGenerated?: string;
          }
        | { requires2fa: true; pendingToken: string }
        | { mustChangePassword: true; pendingPasswordChangeToken: string }
      >("/auth/login", {
        method: "POST",
        body: { email, password, remember },
      });
      // B-SuperAdmin: OWNER recién creado por consola super-admin con
      // password temporal — debe cambiarla antes de obtener sesión real.
      if ("mustChangePassword" in res && res.mustChangePassword) {
        navigate("/change-password-initial", {
          state: { pendingPasswordChangeToken: res.pendingPasswordChangeToken },
          replace: true,
        });
        return;
      }
      if ("requires2fa" in res && res.requires2fa) {
        setPendingToken(res.pendingToken);
        return;
      }
      const tokens = res as {
        accessToken: string;
        refreshToken: string;
        ownerPinGenerated?: string;
      };
      storeTokens(
        { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken },
        { remember },
      );
      if (tokens.ownerPinGenerated) {
        setOwnerPinJustGenerated(tokens.ownerPinGenerated);
        return;
      }
      navigate("/", { replace: true });
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
      else throw err;
    } finally {
      setBusy(false);
    }
  }

  async function on2faSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!pendingToken) return;
    setError(null);
    setBusy(true);
    try {
      const tokens = await api<{
        accessToken: string;
        refreshToken: string;
        usedRecoveryCode: boolean;
      }>("/auth/login/2fa", {
        method: "POST",
        body: { pendingToken, code: twoFactorCode.trim().toUpperCase() },
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

  if (ownerPinJustGenerated) {
    return (
      <CenteredCard>
        <h1 className="text-[22px] font-semibold text-mipiace-ink tracking-tight">
          Tu PIN de respaldo
        </h1>
        <p className="text-[13.5px] text-slate-500 mt-1 mb-6">
          Como propietario, te hemos asignado un PIN de respaldo de 4
          dígitos. Lo usarás para autorizar descuentos o cierres con
          incidencia desde el TPV cuando no haya encargado disponible.
          Apúntalo: <strong>sólo se muestra una vez</strong>. Si lo
          pierdes, puedes regenerarlo en "Mi cuenta".
        </p>
        <div className="rounded-2xl bg-mipiace-stone py-6 mb-5 text-center">
          <div className="text-[44px] font-semibold tracking-[0.3em] text-mipiace-ink tabular-nums">
            {ownerPinJustGenerated}
          </div>
        </div>
        <button
          type="button"
          onClick={() => {
            setOwnerPinJustGenerated(null);
            navigate("/", { replace: true });
          }}
          className="w-full h-12 rounded-2xl bg-mipiace-coral hover:bg-mipiace-coral-dark text-white text-[14.5px] font-medium"
        >
          He apuntado mi PIN, continuar
        </button>
      </CenteredCard>
    );
  }

  if (pendingToken) {
    return (
      <CenteredCard>
        <h1 className="text-[22px] font-semibold text-mipiace-ink tracking-tight">
          Verificación en dos pasos
        </h1>
        <p className="text-[13.5px] text-slate-500 mt-1 mb-6">
          Introduce el código de 6 dígitos de tu app autenticadora. Si no la
          tienes a mano, puedes usar uno de tus códigos de recuperación.
        </p>
        <form onSubmit={on2faSubmit} className="space-y-4">
          <TextField
            id="twoFactor"
            label="Código"
            value={twoFactorCode}
            onChange={setTwoFactorCode}
            autoComplete="one-time-code"
            required
            placeholder="123456 o XXXXXXXXXX"
          />
          <PrimaryButton busy={busy}>Verificar</PrimaryButton>
          <FieldError message={error} />
        </form>
        <button
          type="button"
          onClick={() => {
            setPendingToken(null);
            setTwoFactorCode("");
            setError(null);
          }}
          className="mt-5 text-[13px] text-slate-500 hover:text-mipiace-coral-dark font-medium"
        >
          Volver al inicio de sesión
        </button>
      </CenteredCard>
    );
  }

  return (
    <CenteredCard>
      <h1 className="text-[22px] font-semibold text-mipiace-ink tracking-tight">
        Entra a mipiacetpv
      </h1>
      <p className="text-[13.5px] text-slate-500 mt-1 mb-6">Acceso del propietario.</p>
      {justReset && (
        <SuccessBanner message="Contraseña actualizada · inicia sesión de nuevo" />
      )}
      <form onSubmit={onSubmit} className="space-y-4 mt-3">
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
        <div className="flex items-start justify-between gap-3">
          <label htmlFor="loginRemember" className="flex items-center gap-2.5 text-[13.5px] text-mipiace-ink-soft cursor-pointer select-none">
            <input
              id="loginRemember"
              name="remember"
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
          <a
            href="/forgot-password"
            className="text-[13px] text-mipiace-coral-dark hover:underline font-medium whitespace-nowrap mt-1"
          >
            ¿Olvidaste tu contraseña?
          </a>
        </div>
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

// B-SuperAdmin: el OWNER recién creado por la consola super-admin tiene
// must_change_password_at != null y al hacer login recibe sólo un
// pendingPasswordChangeToken. Esta pantalla cambia la temporal y emite
// la sesión real (access + refresh).
function ChangePasswordInitialPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const pendingToken =
    (location.state as { pendingPasswordChangeToken?: string } | null)
      ?.pendingPasswordChangeToken ?? null;

  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!pendingToken) navigate("/login", { replace: true });
  }, [pendingToken, navigate]);

  async function onSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    if (newPassword !== confirm) {
      setError("Las contraseñas no coinciden.");
      return;
    }
    if (newPassword.length < 12) {
      setError("La nueva contraseña debe tener al menos 12 caracteres.");
      return;
    }
    setBusy(true);
    try {
      const tokens = await api<{ accessToken: string; refreshToken: string }>(
        "/auth/change-password-initial",
        {
          method: "POST",
          body: {
            pendingPasswordChangeToken: pendingToken,
            newPassword,
          },
        },
      );
      storeTokens(tokens);
      navigate("/", { replace: true });
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
      else throw err;
    } finally {
      setBusy(false);
    }
  }

  if (!pendingToken) return null;

  return (
    <CenteredCard>
      <h1 className="text-[22px] font-semibold text-mipiace-ink tracking-tight">
        Cambia tu contraseña inicial
      </h1>
      <p className="text-[13.5px] text-slate-500 mt-1 mb-6">
        Por seguridad, define una contraseña personal antes de continuar. La
        contraseña temporal que recibiste por email queda desactivada.
      </p>
      <form onSubmit={onSubmit} className="space-y-4">
        <TextField
          id="newPassword"
          label="Nueva contraseña (mín. 12 caracteres)"
          type="password"
          autoComplete="new-password"
          minLength={12}
          value={newPassword}
          onChange={setNewPassword}
          required
        />
        <TextField
          id="confirmPassword"
          label="Repite la contraseña"
          type="password"
          autoComplete="new-password"
          minLength={12}
          value={confirm}
          onChange={setConfirm}
          required
        />
        <PrimaryButton busy={busy}>Guardar y continuar</PrimaryButton>
        <FieldError message={error} />
      </form>
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
  // Cuando viene del almacén default Holded, `direccion` puede ser un
  // objeto `{ calle, cp, ciudad, provincia, pais }`. Cuando es manual,
  // los campos vienen separados (`address`, `postalCode`, `city`,
  // `province`, `country`). `formatDireccion` cubre ambos.
  direccion?: unknown;
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
  // v1.4-Bugs-Operativos Lote 2: la impersonación full del super-admin
  // debe poder rotar API Key y editar perfil fiscal; readEffectiveAuth
  // devuelve canEdit=true en ese caso. En `readonly`, canEdit=false.
  const canEdit = readEffectiveAuth().canEdit;

  return (
    <AdminShell title="Mi cuenta" initials={initials}>
      <FiscalProfileSection
        initial={fp}
        readOnly={!canEdit}
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
          {canEdit && (
            <OutlineButton onClick={() => setShowRotateModal(true)}>
              <KeyRound className="w-3.5 h-3.5" />
              Cambiar API Key
            </OutlineButton>
          )}
        </div>
        {!canEdit && (
          <p className="mt-3 text-[12px] text-slate-400">
            Sólo el propietario puede rotar la API Key o editar los datos
            fiscales.
          </p>
        )}
        {testMessage &&
          (testMessage.ok ? (
            <SuccessBanner message={testMessage.text} />
          ) : (
            <FieldError message={testMessage.text} />
          ))}
      </section>

      {canEdit && <OwnerPinSection />}

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

function OwnerPinSection() {
  const [busy, setBusy] = useState(false);
  const [newPin, setNewPin] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function regenerate() {
    if (
      !window.confirm(
        "¿Generar un PIN de respaldo nuevo? El anterior dejará de funcionar.",
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ pin: string }>(
        "/auth/me/regenerate-owner-pin",
        { method: "POST", body: {} },
      );
      setNewPin(res.pin);
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
      else setError("Error inesperado");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="bg-white rounded-2xl border border-slate-200 p-6 md:p-7 mb-5">
      <div className="flex items-start justify-between gap-4 mb-1">
        <div>
          <h2 className="text-[17px] font-semibold text-mipiace-ink tracking-tight">
            PIN de respaldo del propietario
          </h2>
          <p className="text-[13px] text-slate-500 mt-1 max-w-xl">
            Sirve para autorizar descuentos y cierres con incidencia
            desde el TPV cuando no hay encargado. Generamos uno
            automáticamente al primer login. Si lo olvidas, regenéralo
            aquí — el anterior dejará de funcionar.
          </p>
        </div>
        <OutlineButton onClick={regenerate} busy={busy} className="!h-9">
          Regenerar PIN
        </OutlineButton>
      </div>
      {newPin && (
        <div className="rounded-2xl bg-mipiace-stone py-5 mt-4 text-center">
          <div className="text-[12px] uppercase tracking-wider text-slate-500 mb-1">
            Nuevo PIN (sólo se muestra una vez)
          </div>
          <div className="text-[34px] font-semibold tracking-[0.25em] text-mipiace-ink tabular-nums">
            {newPin}
          </div>
        </div>
      )}
      {error && <FieldError message={error} />}
    </section>
  );
}

function FiscalProfileSection({
  initial,
  onSaved,
  readOnly,
}: {
  initial: FiscalProfile;
  onSaved: (fp: FiscalProfile) => void;
  readOnly?: boolean;
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
        {!editing && !readOnly && (
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
              // Si hay address en string (manual), úsalo. Si no, intenta
              // serializar `direccion` (objeto del almacén default).
              form.address
                ? [form.address, form.postalCode, form.city, form.province]
                    .filter(Boolean)
                    .join(", ")
                : formatDireccion(form.direccion)
            }
            wide
          />
        </div>
      )}
    </section>
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
  skuReviewAttempts: number;
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

  function onResolved(productId: string) {
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
            <SkuReviewRow
              key={item.id}
              item={item}
              onAssigned={() => onResolved(item.id)}
              onMarkedUnsellable={() => onResolved(item.id)}
            />
          ))}
        </div>
      )}
    </AdminShell>
  );
}

function SkuReviewRow({
  item,
  onAssigned,
  onMarkedUnsellable,
}: {
  item: SkuReviewItem;
  onAssigned: () => void;
  onMarkedUnsellable: () => void;
}) {
  const [sku, setSku] = useState(item.currentSku ?? item.suggestedSku);
  const [busy, setBusy] = useState(false);
  const [busyUnsellable, setBusyUnsellable] = useState(false);
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

  async function onMarkUnsellable() {
    setBusyUnsellable(true);
    setError(null);
    try {
      await api(`/catalog/sku-review/${item.id}/mark-unsellable`, {
        method: "POST",
        body: {},
      });
      onMarkedUnsellable();
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
      else throw err;
    } finally {
      setBusyUnsellable(false);
    }
  }

  const attemptsBadge = item.skuReviewAttempts >= 3;

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5">
      <div className="flex items-start justify-between gap-4 mb-3">
        <div className="min-w-0 flex-1">
          <div className="text-[14.5px] font-medium text-mipiace-ink truncate">{item.name}</div>
          <div className="text-[12.5px] text-slate-500 mt-0.5 tabular-nums">
            {item.basePrice.toFixed(2)} € · IVA {item.taxRate}% · ID Holded {item.holdedProductId.slice(0, 8)}…
          </div>
          {item.skuReviewAttempts > 0 && (
            <div className="mt-2 flex items-center gap-2">
              <span
                className={
                  attemptsBadge
                    ? "inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-amber-50 text-amber-700 text-[11.5px] font-medium"
                    : "inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-slate-50 text-slate-500 text-[11.5px] font-medium"
                }
              >
                {item.skuReviewAttempts} {item.skuReviewAttempts === 1 ? "intento" : "intentos"}
                {attemptsBadge && " · necesita atención de soporte"}
              </span>
            </div>
          )}
        </div>
      </div>
      <div className="flex flex-col sm:flex-row gap-2.5">
        <input
          value={sku}
          onChange={(e) => setSku(e.target.value)}
          placeholder={item.suggestedSku}
          className="flex-1 h-11 px-3.5 rounded-xl bg-mipiace-stone border border-transparent text-[14px] focus:bg-white focus:border-mipiace-coral/30 focus:ring-2 focus:ring-mipiace-coral/30 focus:outline-none tabular-nums"
        />
        <PrimaryButton
          type="button"
          onClick={onSubmit}
          busy={busy}
          disabled={sku.trim().length === 0}
          className="!w-auto !h-11 px-5 !text-[13.5px]"
        >
          Asignar y subir
        </PrimaryButton>
      </div>
      {attemptsBadge && (
        <OutlineButton
          onClick={onMarkUnsellable}
          busy={busyUnsellable}
          className="mt-3 !w-full !h-10 !text-[13px] !text-amber-700 hover:!bg-amber-50 !border-amber-200"
        >
          Marcar como no vendible
        </OutlineButton>
      )}
      <FieldError message={error} />
    </div>
  );
}

// ── Utilidades ───────────────────────────────────────────────────────
// (formatRelative + formatDireccion viven en ./ui.tsx)
