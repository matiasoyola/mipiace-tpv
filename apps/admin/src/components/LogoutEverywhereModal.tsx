// Modal de confirmación reutilizable. Lo dispara el sidebar y la
// pantalla de Seguridad. Centraliza la copy y el behaviour.

import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { api, ApiError, clearTokens } from "../api.js";
import { FieldError, OutlineButton, PrimaryButton } from "../ui.js";

export function LogoutEverywhereModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  async function onConfirm() {
    setBusy(true);
    setError(null);
    try {
      await api("/auth/logout-everywhere", { method: "POST", body: {} });
      clearTokens();
      navigate("/login", { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        // El backend acepta sólo OWNER. Si el token está expirado el
        // refresh ya se intentó automáticamente; cualquier 401 cae a
        // login limpio igualmente.
        clearTokens();
        navigate("/login", { replace: true });
      } else {
        setError("No se pudo completar la operación. Reintenta.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 bg-mipiace-ink/40 flex items-end sm:items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white w-full max-w-md rounded-3xl border border-slate-200 p-6 md:p-7"
      >
        <h2 className="text-[18px] font-semibold text-mipiace-ink tracking-tight mb-1">
          ¿Cerrar sesión en todos los dispositivos?
        </h2>
        <p className="text-[13.5px] text-slate-500 leading-relaxed mb-6">
          Esto cerrará tu sesión en este dispositivo y en cualquier otro
          donde hayas iniciado sesión. Tendrás que volver a entrar.
        </p>
        <div className="flex gap-2.5">
          <OutlineButton onClick={onClose} disabled={busy} className="!w-full">
            Cancelar
          </OutlineButton>
          <PrimaryButton type="button" onClick={onConfirm} busy={busy}>
            Sí, cerrar todas
          </PrimaryButton>
        </div>
        <FieldError message={error} />
      </div>
    </div>
  );
}
