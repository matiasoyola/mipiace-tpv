import { useEffect, useState } from "react";
import { Navigate, Route, Routes, useNavigate } from "react-router-dom";

import { api, ApiError, clearTokens, readTokens, storeTokens } from "./api.js";

interface MeResponse {
  user: { id: string; email: string; role: string };
  tenant: {
    id: string;
    name: string;
    hasHoldedKey: boolean;
    initialSyncStatus: "PENDING" | "RUNNING" | "DONE" | "FAILED";
  };
}

export function App() {
  return (
    <div className="app">
      <Routes>
        <Route path="/" element={<RootRouter />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignupPage />} />
        <Route path="/onboarding" element={<ConnectHoldedPage />} />
        <Route path="/onboarding/sync" element={<SyncProgressPage />} />
        <Route path="/onboarding/done" element={<SyncSummaryPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
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
          navigate("/onboarding/done", { replace: true });
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
  return <p className="muted">Cargando…</p>;
}

function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const tokens = await api<{ accessToken: string; refreshToken: string }>(
        "/auth/login",
        { method: "POST", body: { email, password } },
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

  return (
    <>
      <h1>Entra a mipiacetpv</h1>
      <p className="muted">Acceso del propietario.</p>
      <form onSubmit={onSubmit}>
        <div className="field">
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>
        <div className="field">
          <label htmlFor="password">Contraseña</label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        <button className="primary" type="submit" disabled={busy}>
          {busy ? "Entrando…" : "Entrar"}
        </button>
        {error && <div className="error">{error}</div>}
      </form>
      <p style={{ marginTop: "1.5rem", fontSize: "0.875rem" }}>
        ¿Aún no tienes cuenta?{" "}
        <a href="/signup">Crea tu negocio</a>
      </p>
    </>
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
      const tokens = await api<{ accessToken: string; refreshToken: string }>(
        "/auth/signup",
        { method: "POST", body: { businessName, email, password } },
      );
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
    <>
      <h1>Crea tu negocio</h1>
      <p className="muted">
        Necesitarás una cuenta de Holded activa para sincronizar tu catálogo.
      </p>
      <form onSubmit={onSubmit}>
        <div className="field">
          <label htmlFor="businessName">Nombre del negocio</label>
          <input
            id="businessName"
            value={businessName}
            onChange={(e) => setBusinessName(e.target.value)}
            required
          />
        </div>
        <div className="field">
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>
        <div className="field">
          <label htmlFor="password">Contraseña</label>
          <input
            id="password"
            type="password"
            autoComplete="new-password"
            minLength={10}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        <button className="primary" type="submit" disabled={busy}>
          {busy ? "Creando…" : "Crear cuenta"}
        </button>
        {error && <div className="error">{error}</div>}
      </form>
      <p style={{ marginTop: "1.5rem", fontSize: "0.875rem" }}>
        ¿Ya la tienes? <a href="/login">Entra</a>
      </p>
    </>
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
      await api("/onboarding/connect-holded", {
        method: "POST",
        body: { apiKey },
      });
      navigate("/onboarding/sync", { replace: true });
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
      else throw err;
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h1>Conecta tu Holded</h1>
      <p className="muted">
        Genera una API Key en{" "}
        <em>Configuración → API → Crear API Key</em> en tu admin de Holded y
        pégala aquí. La guardamos cifrada y solo la usamos en tu nombre.
      </p>
      <form onSubmit={onSubmit}>
        <div className="field">
          <label htmlFor="apiKey">API Key de Holded</label>
          <input
            id="apiKey"
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            required
          />
        </div>
        <button className="primary" type="submit" disabled={busy}>
          {busy ? "Validando…" : "Conectar"}
        </button>
        {error && <div className="error">{error}</div>}
      </form>
    </>
  );
}

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
  // Progreso indeterminado: páginas leídas hasta ahora. Falta total
  // porque Holded no expone X-Total-Count (spike §02.B).
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
    <>
      <h1>Sincronizando con Holded</h1>
      <p className="muted">
        Estamos descargando tu catálogo. Esto puede tardar unos minutos en
        catálogos grandes — no cierres la pestaña.
      </p>
      <div className="progress">
        <div className="bar">
          <div style={{ width: data?.status === "DONE" ? "100%" : "60%" }} />
        </div>
        <p style={{ marginTop: "0.5rem", fontSize: "0.875rem", color: "#475569" }}>
          {step}
        </p>
        {data?.stats && (
          <div className="summary-grid">
            <div>
              <strong>{data.stats.productsCount}</strong>
              <span>productos</span>
            </div>
            <div>
              <strong>{data.stats.servicesCount}</strong>
              <span>servicios</span>
            </div>
            <div>
              <strong>{data.stats.warehousesCount}</strong>
              <span>almacenes</span>
            </div>
            <div>
              <strong>{data.stats.taxesCount}</strong>
              <span>tipos de IVA</span>
            </div>
          </div>
        )}
      </div>
      {data?.status === "FAILED" && (
        <div className="error">
          La sincronización ha fallado. Revisa el log del servidor.
        </div>
      )}
    </>
  );
}

function SyncSummaryPage() {
  const [data, setData] = useState<SyncStatusResponse | null>(null);
  useEffect(() => {
    api<SyncStatusResponse>("/onboarding/sync-status").then(setData);
  }, []);
  if (!data) return <p className="muted">Cargando resumen…</p>;
  const stats = data.stats;
  return (
    <>
      <h1>Sincronización completada</h1>
      <div className="success">
        Tu Holded está conectado y el catálogo descargado.
      </div>
      {stats && (
        <div className="summary-grid">
          <div>
            <strong>{stats.productsCount}</strong>
            <span>productos</span>
          </div>
          <div>
            <strong>{stats.servicesCount}</strong>
            <span>servicios</span>
          </div>
          <div>
            <strong>{stats.warehousesCount}</strong>
            <span>almacenes</span>
          </div>
          <div>
            <strong>{stats.taxesCount}</strong>
            <span>tipos de IVA</span>
          </div>
          <div>
            <strong>{stats.autoSkuFixed}</strong>
            <span>SKUs auto-asignados</span>
          </div>
          <div>
            <strong>{stats.autoSkuNeedsReview}</strong>
            <span>pendientes de revisión</span>
          </div>
          <div>
            <strong>{stats.wildcardsCreated}</strong>
            <span>comodines TPV-OTROS creados</span>
          </div>
          <div>
            <strong>{stats.wildcardsReused}</strong>
            <span>comodines reutilizados</span>
          </div>
        </div>
      )}
      <p className="muted" style={{ marginTop: "1.5rem" }}>
        Próximo bloque (B2): crear tu primera tienda y dar de alta cajas.
      </p>
    </>
  );
}
