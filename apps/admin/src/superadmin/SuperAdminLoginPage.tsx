import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ShieldAlert } from "lucide-react";

import {
  storeSuperAdminTokens,
  superApi,
  SuperAdminApiError,
} from "./api.js";
import { PasswordField } from "../ui.js";

interface LoginResponse {
  accessToken?: string;
  refreshToken?: string;
  requires2fa?: boolean;
  pendingToken?: string;
}

interface TwoFactorResponse {
  accessToken: string;
  refreshToken: string;
}

export function SuperAdminLoginPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState<"credentials" | "2fa">("credentials");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pendingToken, setPendingToken] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onLogin(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await superApi<LoginResponse>("/super-admin/auth/login", {
        method: "POST",
        body: { email, password },
      });
      if (res.requires2fa && res.pendingToken) {
        setPendingToken(res.pendingToken);
        setStep("2fa");
        return;
      }
      if (res.accessToken && res.refreshToken) {
        storeSuperAdminTokens({
          accessToken: res.accessToken,
          refreshToken: res.refreshToken,
        });
        navigate("/superadmin/tenants", { replace: true });
      }
    } catch (err) {
      setError(err instanceof SuperAdminApiError ? err.message : "Error inesperado");
    } finally {
      setBusy(false);
    }
  }

  async function onSubmit2fa(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await superApi<TwoFactorResponse>("/super-admin/auth/login-2fa", {
        method: "POST",
        body: { pendingToken, code },
      });
      storeSuperAdminTokens(res);
      navigate("/superadmin/tenants", { replace: true });
    } catch (err) {
      setError(err instanceof SuperAdminApiError ? err.message : "Error inesperado");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-900 px-4">
      <div className="w-full max-w-sm bg-white rounded-xl shadow-xl p-8">
        <div className="mb-6 flex items-center gap-2">
          <ShieldAlert className="w-5 h-5 text-amber-500" />
          <h1 className="text-[18px] font-semibold text-slate-900">
            Acceso super-admin
          </h1>
        </div>
        {step === "credentials" ? (
          <form onSubmit={onLogin} className="space-y-4">
            <div>
              <label className="block text-[12.5px] font-medium text-slate-700 mb-1.5">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
                className="w-full h-11 px-3 border border-slate-300 rounded-lg text-[14px] focus:outline-none focus:border-amber-500"
              />
            </div>
            <PasswordField
              id="superAdminPassword"
              label="Contraseña"
              autoComplete="current-password"
              value={password}
              onChange={setPassword}
              required
            />
            {error && (
              <p className="text-[12.5px] text-red-600 font-medium">{error}</p>
            )}
            <button
              type="submit"
              disabled={busy}
              className="w-full h-11 bg-slate-900 text-white text-[14px] font-medium rounded-lg hover:bg-slate-800 disabled:opacity-50"
            >
              {busy ? "Entrando…" : "Iniciar sesión"}
            </button>
          </form>
        ) : (
          <form onSubmit={onSubmit2fa} className="space-y-4">
            <p className="text-[13px] text-slate-600">
              Introduce el código de tu autenticador (6 dígitos) o un código
              de recuperación.
            </p>
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              required
              autoFocus
              placeholder="000000"
              className="w-full h-11 px-3 border border-slate-300 rounded-lg text-[18px] tracking-widest text-center font-mono focus:outline-none focus:border-amber-500"
            />
            {error && (
              <p className="text-[12.5px] text-red-600 font-medium">{error}</p>
            )}
            <button
              type="submit"
              disabled={busy}
              className="w-full h-11 bg-slate-900 text-white text-[14px] font-medium rounded-lg hover:bg-slate-800 disabled:opacity-50"
            >
              {busy ? "Verificando…" : "Verificar"}
            </button>
            <button
              type="button"
              onClick={() => {
                setStep("credentials");
                setCode("");
              }}
              className="w-full h-9 text-[12.5px] text-slate-500 hover:text-slate-700"
            >
              Volver
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
