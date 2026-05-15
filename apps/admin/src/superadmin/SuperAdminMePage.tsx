import { useEffect, useState } from "react";

import { superApi, SuperAdminApiError } from "./api.js";
import { SuperAdminShell } from "./SuperAdminShell.js";
import type { SuperAdminMe } from "./types.js";

interface EnrollResponse {
  qrDataUrl: string;
  secret: string;
  recoveryCodes: string[];
}

export function SuperAdminMePage() {
  const [me, setMe] = useState<SuperAdminMe | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const [enroll, setEnroll] = useState<EnrollResponse | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");

  async function reload(): Promise<void> {
    try {
      const res = await superApi<SuperAdminMe>("/super-admin/auth/me");
      setMe(res);
    } catch (err) {
      setError(err instanceof SuperAdminApiError ? err.message : "Error");
    }
  }

  useEffect(() => {
    void reload();
  }, []);

  async function startEnroll(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const res = await superApi<EnrollResponse>(
        "/super-admin/auth/totp/enable",
        { method: "POST" },
      );
      setEnroll(res);
    } catch (err) {
      setError(err instanceof SuperAdminApiError ? err.message : "Error");
    } finally {
      setBusy(false);
    }
  }

  async function confirmEnroll(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await superApi("/super-admin/auth/totp/confirm", {
        method: "POST",
        body: { code },
      });
      setActionMessage("2FA activado correctamente.");
      setEnroll(null);
      setCode("");
      await reload();
    } catch (err) {
      setError(err instanceof SuperAdminApiError ? err.message : "Error");
    } finally {
      setBusy(false);
    }
  }

  async function changePassword(): Promise<void> {
    setBusy(true);
    setError(null);
    setActionMessage(null);
    try {
      await superApi("/super-admin/auth/change-password", {
        method: "POST",
        body: { currentPassword: currentPw, newPassword: newPw },
      });
      setActionMessage("Contraseña actualizada. Vuelve a iniciar sesión.");
      setCurrentPw("");
      setNewPw("");
    } catch (err) {
      setError(err instanceof SuperAdminApiError ? err.message : "Error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <SuperAdminShell title="Mi cuenta">
      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-900 text-[13px]">
          {error}
        </div>
      )}
      {actionMessage && (
        <div className="mb-4 p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-emerald-900 text-[13px]">
          {actionMessage}
        </div>
      )}
      {!me ? (
        <div className="text-slate-500 text-[13.5px]">Cargando…</div>
      ) : (
        <>
          <div className="bg-white border border-slate-200 rounded-xl p-6 mb-5">
            <h3 className="font-semibold text-slate-900 mb-3">Cuenta</h3>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-[13px]">
              <Dt>Email</Dt>
              <Dd>{me.email}</Dd>
              <Dt>2FA</Dt>
              <Dd>
                {me.twoFactorEnabled
                  ? `Activado (${me.recoveryCodesRemaining} códigos restantes)`
                  : "No activado"}
              </Dd>
              <Dt>Último login</Dt>
              <Dd>
                {me.lastLoginAt ? new Date(me.lastLoginAt).toLocaleString() : "—"}
              </Dd>
            </dl>
          </div>

          {!me.twoFactorEnabled && (
            <div className="bg-white border border-slate-200 rounded-xl p-6 mb-5">
              <h3 className="font-semibold text-slate-900 mb-3">Activar 2FA</h3>
              {!enroll ? (
                <button
                  onClick={startEnroll}
                  disabled={busy}
                  className="h-10 px-4 bg-slate-900 text-white rounded-lg text-[13px] font-medium hover:bg-slate-800 disabled:opacity-50"
                >
                  Empezar configuración
                </button>
              ) : (
                <div className="space-y-3">
                  <p className="text-[13px] text-slate-600">
                    Escanea este QR con Google Authenticator / 1Password /
                    similar.
                  </p>
                  <img
                    src={enroll.qrDataUrl}
                    alt="QR 2FA"
                    className="w-48 h-48 border border-slate-200 rounded-lg"
                  />
                  <p className="text-[12px] text-slate-500 font-mono break-all">
                    Secret: {enroll.secret}
                  </p>
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                    <p className="text-[12.5px] text-amber-900 font-medium mb-1.5">
                      Códigos de recuperación (guárdalos en lugar seguro)
                    </p>
                    <div className="grid grid-cols-2 gap-1 font-mono text-[12px]">
                      {enroll.recoveryCodes.map((c) => (
                        <span key={c}>{c}</span>
                      ))}
                    </div>
                  </div>
                  <input
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    placeholder="Código de 6 dígitos"
                    className="w-full h-11 px-3 border border-slate-300 rounded-lg text-[14px] font-mono text-center tracking-widest"
                  />
                  <button
                    onClick={confirmEnroll}
                    disabled={busy || code.length !== 6}
                    className="w-full h-11 bg-slate-900 text-white rounded-lg text-[13.5px] font-medium hover:bg-slate-800 disabled:opacity-50"
                  >
                    Confirmar y activar
                  </button>
                </div>
              )}
            </div>
          )}

          <div className="bg-white border border-slate-200 rounded-xl p-6">
            <h3 className="font-semibold text-slate-900 mb-3">Cambiar contraseña</h3>
            <div className="space-y-3 max-w-sm">
              <input
                type="password"
                value={currentPw}
                onChange={(e) => setCurrentPw(e.target.value)}
                placeholder="Contraseña actual"
                className="w-full h-11 px-3 border border-slate-300 rounded-lg text-[14px]"
              />
              <input
                type="password"
                value={newPw}
                onChange={(e) => setNewPw(e.target.value)}
                placeholder="Nueva contraseña (≥12 chars)"
                className="w-full h-11 px-3 border border-slate-300 rounded-lg text-[14px]"
              />
              <button
                onClick={changePassword}
                disabled={busy || !currentPw || newPw.length < 12}
                className="h-10 px-4 bg-slate-900 text-white rounded-lg text-[13px] font-medium hover:bg-slate-800 disabled:opacity-50"
              >
                Cambiar
              </button>
            </div>
          </div>
        </>
      )}
    </SuperAdminShell>
  );
}

function Dt({ children }: { children: React.ReactNode }) {
  return (
    <dt className="text-[11.5px] uppercase tracking-wide text-slate-500">
      {children}
    </dt>
  );
}

function Dd({ children }: { children: React.ReactNode }) {
  return <dd className="text-slate-900">{children}</dd>;
}
