// Tres pantallas del flujo de recuperación de contraseña (B3 §4.3):
//   - /forgot-password: pide email.
//   - Confirmación neutra tras submit (misma copy haya o no email en BD).
//   - /admin/reset?token=...: nueva contraseña.

import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { api, ApiError } from "../api.js";
import {
  CenteredCard,
  FieldError,
  PrimaryButton,
  SuccessBanner,
  TextField,
} from "../ui.js";

export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/auth/password-reset/request", {
        method: "POST",
        body: { email },
      });
      setSent(true);
    } catch (err) {
      // El backend devuelve siempre 200 — pero si la red falla,
      // mensaje claro.
      if (err instanceof ApiError) setError(err.message);
      else setError("No se pudo enviar la petición. Reintenta.");
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <CenteredCard>
        <h1 className="text-[22px] font-semibold text-mipiace-ink tracking-tight mb-1">
          Revisa tu email
        </h1>
        <p className="text-[13.5px] text-slate-500 leading-relaxed mt-2">
          Si el email existe en nuestra base, te hemos enviado un enlace de
          recuperación. Caduca en 1 hora y sólo puede usarse una vez.
        </p>
        <p className="text-[13px] text-slate-400 mt-5">
          ¿No te llega? Revisa la carpeta de spam. Si sigues sin verlo, puede
          que el email no esté registrado.
        </p>
        <div className="mt-7">
          <a
            href="/login"
            className="text-[13.5px] text-mipiace-coral-dark hover:underline font-medium"
          >
            Volver al inicio de sesión
          </a>
        </div>
      </CenteredCard>
    );
  }

  return (
    <CenteredCard>
      <h1 className="text-[22px] font-semibold text-mipiace-ink tracking-tight mb-1">
        Recuperar contraseña
      </h1>
      <p className="text-[13.5px] text-slate-500 mt-1 mb-6 leading-relaxed">
        Introduce el email de tu cuenta de propietario y te enviaremos un
        enlace para restablecer la contraseña.
      </p>
      <form onSubmit={onSubmit} className="space-y-4">
        <TextField
          id="forgotEmail"
          label="Email"
          type="email"
          autoComplete="username"
          value={email}
          onChange={setEmail}
          required
        />
        <PrimaryButton busy={busy}>Enviar enlace</PrimaryButton>
        <FieldError message={error} />
      </form>
      <div className="mt-6 text-center">
        <a
          href="/login"
          className="text-[13px] text-slate-500 hover:text-mipiace-coral-dark font-medium"
        >
          Cancelar
        </a>
      </div>
    </CenteredCard>
  );
}

export function ResetPasswordPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const token = useMemo(() => {
    const params = new URLSearchParams(location.search);
    return params.get("token") ?? "";
  }, [location.search]);

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) setError("Enlace inválido. Solicita uno nuevo.");
  }, [token]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      setError("Las contraseñas no coinciden.");
      return;
    }
    if (password.length < 8) {
      setError("La contraseña debe tener al menos 8 caracteres.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api("/auth/password-reset/confirm", {
        method: "POST",
        body: { token, newPassword: password },
      });
      navigate("/login", { replace: true, state: { justReset: true } });
    } catch (err) {
      if (err instanceof ApiError && err.status === 410) {
        setError(
          "Enlace caducado o ya usado. Solicita uno nuevo en /forgot-password.",
        );
      } else if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError("Error inesperado.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <CenteredCard>
      <h1 className="text-[22px] font-semibold text-mipiace-ink tracking-tight mb-1">
        Nueva contraseña
      </h1>
      <p className="text-[13.5px] text-slate-500 mt-1 mb-6 leading-relaxed">
        Elige una contraseña de al menos 8 caracteres. Al guardar, cerraremos
        todas tus sesiones por seguridad.
      </p>
      <form onSubmit={onSubmit} className="space-y-4">
        <TextField
          id="newPassword"
          label="Nueva contraseña"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={setPassword}
          required
          minLength={8}
        />
        <TextField
          id="confirmPassword"
          label="Repite la contraseña"
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={setConfirm}
          required
          minLength={8}
        />
        <PrimaryButton busy={busy} disabled={!token}>
          Actualizar contraseña
        </PrimaryButton>
        <FieldError message={error} />
        {!token && (
          <SuccessBanner message="Solicita un enlace nuevo desde /forgot-password" />
        )}
      </form>
    </CenteredCard>
  );
}
