// Sección de seguridad del propietario (B3 §5). Tres áreas:
//   - 2FA enable / disable
//   - "Cerrar sesión en todos los dispositivos"
//   - (Notificaciones de nuevo dispositivo se controlan por toggle del
//     tenant; el endpoint no existe aún en B3 — se documenta como
//     "configurable en B4 ajustes de tienda")

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertCircle, Copy, Shield } from "lucide-react";

import { AdminShell } from "../AdminShell.js";
import { api, ApiError, clearTokens } from "../api.js";
import { LogoutEverywhereModal } from "../components/LogoutEverywhereModal.js";
import {
  CenteredLoader,
  FieldError,
  OutlineButton,
  PrimaryButton,
  SuccessBanner,
  TextField,
} from "../ui.js";

interface MeResponse {
  user: {
    id: string;
    email: string;
    role: string;
    twoFactorEnabled?: boolean;
    recoveryCodesRemaining?: number;
  };
  tenant: { id: string; name: string };
}

export function SecurityPage() {
  const navigate = useNavigate();
  const [me, setMe] = useState<MeResponse | null>(null);
  const [enrolling, setEnrolling] = useState<{
    qrDataUrl: string;
    secret: string;
    recoveryCodes: string[];
  } | null>(null);
  const [confirmCode, setConfirmCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [disableModalOpen, setDisableModalOpen] = useState(false);
  const [logoutAllOpen, setLogoutAllOpen] = useState(false);

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

  async function onStartEnroll() {
    setBusy(true);
    setError(null);
    try {
      const res = await api<{
        qrDataUrl: string;
        secret: string;
        recoveryCodes: string[];
      }>("/auth/me/2fa/enable", { method: "POST", body: {} });
      setEnrolling(res);
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function onConfirm() {
    setBusy(true);
    setError(null);
    try {
      await api("/auth/me/2fa/confirm", {
        method: "POST",
        body: { code: confirmCode.trim() },
      });
      setSuccess("2FA activado correctamente.");
      setEnrolling(null);
      setConfirmCode("");
      const next = await api<MeResponse>("/auth/me");
      setMe(next);
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (!me) return <CenteredLoader label="Cargando seguridad…" />;

  return (
    <AdminShell title="Seguridad">
      {success && <SuccessBanner message={success} />}
      {error && <FieldError message={error} />}

      <section className="bg-white rounded-2xl border border-slate-200 p-6 md:p-7 mb-5">
        <div className="flex items-start justify-between gap-4 mb-1">
          <div className="flex-1 min-w-0">
            <h2 className="text-[17px] font-semibold text-mipiace-ink tracking-tight mb-1">
              Verificación en dos pasos
            </h2>
            <p className="text-[13px] text-slate-500 max-w-md">
              Añade una capa extra: tras meter contraseña, pediremos un código
              TOTP de tu app autenticadora (Google Authenticator, 1Password,
              Authy, Bitwarden).
            </p>
            {!me.user.twoFactorEnabled && (
              <div className="flex items-center gap-2 mt-3 text-[12.5px] text-amber-700">
                <AlertCircle className="w-3.5 h-3.5" />
                <span>Recomendado si tienes tu API Key de Holded conectada.</span>
              </div>
            )}
            {me.user.twoFactorEnabled && (
              <div className="flex items-center gap-2 mt-3 text-[12.5px] text-emerald-700">
                <Shield className="w-3.5 h-3.5" />
                <span>
                  Activo · {me.user.recoveryCodesRemaining ?? 0} códigos de
                  recuperación sin usar
                </span>
              </div>
            )}
          </div>
          {me.user.twoFactorEnabled ? (
            <OutlineButton
              onClick={() => setDisableModalOpen(true)}
              className="!h-10 !text-[13px] !text-mipiace-coral-dark !border-mipiace-coral/30 hover:!bg-mipiace-coral-soft"
            >
              Desactivar
            </OutlineButton>
          ) : enrolling ? null : (
            <PrimaryButton
              type="button"
              onClick={onStartEnroll}
              busy={busy}
              className="!w-auto !h-10 !px-4 !text-[13.5px]"
            >
              Activar 2FA
            </PrimaryButton>
          )}
        </div>

        {enrolling && (
          <div className="mt-5 pt-5 border-t border-slate-100">
            <p className="text-[13.5px] text-mipiace-ink font-medium mb-3">
              1 · Escanea el QR con tu app autenticadora
            </p>
            <div className="flex justify-center mb-4">
              <img
                src={enrolling.qrDataUrl}
                alt="QR de 2FA"
                className="rounded-xl border border-slate-200"
                style={{ width: 200, height: 200 }}
              />
            </div>
            <p className="text-[12.5px] text-slate-500 mb-3">
              ¿No puedes escanearlo? Introduce manualmente este secret:
              <span className="ml-2 text-mipiace-ink font-medium tabular-nums break-all">
                {enrolling.secret}
              </span>
            </p>
            <p className="text-[13.5px] text-mipiace-ink font-medium mb-3 mt-5">
              2 · Guarda estos códigos de recuperación
            </p>
            <p className="text-[12.5px] text-slate-500 mb-3">
              Son de un solo uso. Te servirán si pierdes el acceso a la app
              autenticadora. Guárdalos en un lugar seguro — no podremos
              volver a enseñártelos.
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-1.5 mb-2 font-mono text-[13px] tabular-nums text-mipiace-ink">
              {enrolling.recoveryCodes.map((code) => (
                <div
                  key={code}
                  className="bg-mipiace-stone rounded-lg px-2.5 py-2 text-center"
                >
                  {code}
                </div>
              ))}
            </div>
            <OutlineButton
              onClick={() => {
                navigator.clipboard?.writeText(enrolling.recoveryCodes.join("\n"));
              }}
              className="!w-full mt-2 !text-[12.5px]"
            >
              <Copy className="w-3.5 h-3.5" /> Copiar todos al portapapeles
            </OutlineButton>

            <p className="text-[13.5px] text-mipiace-ink font-medium mb-3 mt-5">
              3 · Confirma con un código de la app
            </p>
            <div className="flex gap-2.5">
              <TextField
                id="confirmCode"
                label=""
                value={confirmCode}
                onChange={setConfirmCode}
                inputMode="numeric"
                pattern="^[0-9]{6}$"
                placeholder="000000"
                autoComplete="one-time-code"
              />
              <PrimaryButton
                type="button"
                onClick={onConfirm}
                busy={busy}
                className="!w-auto !h-12 !px-5"
              >
                Confirmar
              </PrimaryButton>
            </div>
          </div>
        )}
      </section>

      <section className="bg-white rounded-2xl border border-slate-200 p-6 md:p-7">
        <h2 className="text-[17px] font-semibold text-mipiace-ink tracking-tight mb-1">
          Cerrar sesión en todos los dispositivos
        </h2>
        <p className="text-[13px] text-slate-500 mb-5 max-w-md">
          Útil si has perdido un dispositivo o sospechas que alguien tiene
          acceso. Todas las sesiones del admin caen inmediatamente y tendrás
          que iniciar sesión de nuevo.
        </p>
        <OutlineButton
          onClick={() => setLogoutAllOpen(true)}
          className="!text-mipiace-coral-dark !border-mipiace-coral/30 hover:!bg-mipiace-coral-soft"
        >
          Cerrar todas las sesiones
        </OutlineButton>
      </section>

      <LogoutEverywhereModal
        open={logoutAllOpen}
        onClose={() => setLogoutAllOpen(false)}
      />

      {disableModalOpen && (
        <DisableTwoFactorModal
          onClose={() => setDisableModalOpen(false)}
          onDisabled={() => {
            setDisableModalOpen(false);
            setSuccess("2FA desactivado.");
            api<MeResponse>("/auth/me").then(setMe);
          }}
        />
      )}
    </AdminShell>
  );
}

function DisableTwoFactorModal({
  onClose,
  onDisabled,
}: {
  onClose: () => void;
  onDisabled: () => void;
}) {
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/auth/me/2fa/disable", {
        method: "POST",
        body: { password, code: code.trim() },
      });
      onDisabled();
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
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
        <h2 className="text-[18px] font-semibold text-mipiace-ink mb-1">
          Desactivar 2FA
        </h2>
        <p className="text-[13px] text-slate-500 mb-5">
          Confirma tu contraseña y un código TOTP (o recovery code) para
          desactivar la verificación en dos pasos.
        </p>
        <form onSubmit={onSubmit} className="space-y-4">
          <TextField
            id="disablePwd"
            label="Contraseña"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={setPassword}
            required
          />
          <TextField
            id="disableCode"
            label="Código TOTP o recovery"
            value={code}
            onChange={setCode}
            required
            autoComplete="one-time-code"
            placeholder="123456 o XXXXXXXXXX"
          />
          <div className="flex gap-2.5">
            <OutlineButton onClick={onClose} disabled={busy} className="!w-full">
              Cancelar
            </OutlineButton>
            <PrimaryButton busy={busy}>Desactivar</PrimaryButton>
          </div>
          <FieldError message={error} />
        </form>
      </div>
    </div>
  );
}
