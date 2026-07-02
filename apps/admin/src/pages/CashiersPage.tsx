// CRUD de cajeros / encargados (B3 §1.4 ampliado). Sólo OWNER edita.

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronDown, Users } from "lucide-react";

import { AdminShell } from "../AdminShell.js";
import { api, ApiError, clearTokens, readCurrentRole } from "../api.js";
import {
  CenteredLoader,
  FieldError,
  formatRelative,
  OutlineButton,
  PrimaryButton,
  SuccessBanner,
  TextField,
} from "../ui.js";

interface CashierRow {
  id: string;
  email: string;
  // v1.7-alias-cajeros: nombre visible. Null sólo en users legacy
  // creados antes del bloque (el backfill de la migración lo rellena,
  // pero el cliente tolera null igualmente).
  alias: string | null;
  role: "MANAGER" | "CASHIER";
  lastLoginAt: string | null;
  createdAt: string;
}

function displayName(c: CashierRow): string {
  return c.alias?.trim() || c.email;
}

export function CashiersPage() {
  const navigate = useNavigate();
  const [cashiers, setCashiers] = useState<CashierRow[] | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [resetting, setResetting] = useState<CashierRow | null>(null);
  const [editing, setEditing] = useState<CashierRow | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refresh() {
    try {
      const res = await api<{ cashiers: CashierRow[] }>("/cashiers");
      setCashiers(res.cashiers);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        clearTokens();
        navigate("/login", { replace: true });
      } else if (err instanceof ApiError) {
        setError(err.message);
      }
    }
  }

  async function onRevoke(cashier: CashierRow) {
    if (
      !window.confirm(
        `¿Revocar el acceso de ${displayName(cashier)}? Sus turnos y tickets se preservan.`,
      )
    )
      return;
    try {
      await api(`/cashiers/${cashier.id}`, { method: "DELETE" });
      setSuccess(`Acceso de ${displayName(cashier)} revocado.`);
      refresh();
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
    }
  }

  if (!cashiers) return <CenteredLoader label="Cargando cajeros…" />;
  const isOwner = readCurrentRole() === "OWNER";

  return (
    <AdminShell title="Cajeros">
      <p className="text-[13.5px] text-slate-500 mb-5 -mt-2">
        Cajeros (rol CASHIER) y encargados (rol MANAGER) que operan el TPV.
        {isOwner
          ? " Sólo tú creas y revocas estos accesos."
          : " Sólo el propietario crea o revoca accesos. Los encargados podéis cambiar PINs."}
      </p>

      {success && <SuccessBanner message={success} />}
      {error && <FieldError message={error} />}

      <div className="mb-5 flex items-center justify-between gap-3">
        <h2 className="text-[16px] font-semibold text-mipiace-ink">
          {cashiers.length === 0
            ? "Sin cajeros activos"
            : `${cashiers.length} cajero${cashiers.length === 1 ? "" : "s"}`}
        </h2>
        {isOwner && (
          <PrimaryButton
            type="button"
            onClick={() => setShowCreate(true)}
            className="!w-auto !h-10 !px-4 !text-[13.5px]"
          >
            Añadir cajero
          </PrimaryButton>
        )}
      </div>

      {cashiers.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-7 text-center">
          <Users className="w-8 h-8 text-slate-300 mx-auto mb-2" strokeWidth={1.6} />
          <p className="text-[13.5px] text-slate-500">
            Crea al menos un cajero para que pueda iniciar sesión en el TPV
            con su PIN.
          </p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {cashiers.map((c) => (
            <CashierCard
              key={c.id}
              cashier={c}
              canRevoke={isOwner}
              canEdit={isOwner}
              onResetPin={() => setResetting(c)}
              onEdit={() => setEditing(c)}
              onRevoke={() => onRevoke(c)}
            />
          ))}
        </div>
      )}

      {showCreate && (
        <CreateCashierModal
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            setSuccess("Cajero creado.");
            refresh();
          }}
        />
      )}

      {resetting && (
        <ResetPinModal
          cashier={resetting}
          onClose={() => setResetting(null)}
          onReset={() => {
            setResetting(null);
            setSuccess("PIN actualizado. Comunícaselo al cajero.");
          }}
        />
      )}

      {editing && (
        <EditAliasModal
          cashier={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            setSuccess("Alias actualizado.");
            refresh();
          }}
        />
      )}
    </AdminShell>
  );
}

function CashierCard({
  cashier,
  canRevoke,
  canEdit,
  onResetPin,
  onEdit,
  onRevoke,
}: {
  cashier: CashierRow;
  canRevoke: boolean;
  canEdit: boolean;
  onResetPin: () => void;
  onEdit: () => void;
  onRevoke: () => void;
}) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-4 flex items-center gap-4">
      <span className="h-10 w-10 rounded-xl bg-mipiace-stone text-mipiace-ink flex items-center justify-center text-[13px] font-semibold uppercase">
        {displayName(cashier).slice(0, 2)}
      </span>
      <div className="flex-1 min-w-0">
        {/* v1.7-alias-cajeros: alias primero, email secundario en gris. */}
        <div className="text-[14px] font-medium text-mipiace-ink truncate">
          {displayName(cashier)}
        </div>
        <div className="text-[12.5px] text-slate-500 mt-0.5 truncate">
          {cashier.email}
          {" · "}
          {cashier.role === "MANAGER" ? "Encargado" : "Cajero"}
          {" · "}
          {cashier.lastLoginAt
            ? `Último acceso ${formatRelative(cashier.lastLoginAt)}`
            : "Sin acceso registrado"}
        </div>
      </div>
      {canEdit && (
        <OutlineButton onClick={onEdit} className="!h-9 !text-[12.5px]">
          Editar
        </OutlineButton>
      )}
      <OutlineButton onClick={onResetPin} className="!h-9 !text-[12.5px]">
        Cambiar PIN
      </OutlineButton>
      {canRevoke && (
        <OutlineButton
          onClick={onRevoke}
          className="!h-9 !text-[12.5px] !text-mipiace-coral-dark hover:!bg-mipiace-coral-soft !border-mipiace-coral/30"
        >
          Revocar
        </OutlineButton>
      )}
    </div>
  );
}

function CreateCashierModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [email, setEmail] = useState("");
  const [alias, setAlias] = useState("");
  const [role, setRole] = useState<"MANAGER" | "CASHIER">("CASHIER");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmedAlias = alias.trim();
    if (trimmedAlias.length === 0) {
      setError("El alias no puede estar vacío");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api("/cashiers", {
        method: "POST",
        body: { email, alias: trimmedAlias, role, pin },
      });
      onCreated();
    } catch (err) {
      // El 409 ALIAS_TAKEN llega con mensaje humano ("Ya hay un cajero
      // llamado María") — se muestra tal cual.
      if (err instanceof ApiError) setError(err.message);
      else setError("Error inesperado");
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
          Añadir cajero
        </h2>
        <p className="text-[13px] text-slate-500 mb-5">
          Comunica el PIN inicial al cajero por canal seguro. Podrás
          cambiárselo cuando quieras desde esta misma pantalla.
        </p>
        <form onSubmit={onSubmit} className="space-y-4">
          <TextField
            id="cashierAlias"
            label="Alias (nombre visible en TPV y tickets)"
            autoComplete="off"
            value={alias}
            onChange={(v) => setAlias(v.slice(0, 40))}
            required
          />
          <TextField
            id="cashierEmail"
            label="Email (credencial de acceso)"
            type="email"
            autoComplete="off"
            value={email}
            onChange={setEmail}
            required
          />
          <div>
            <label className="block text-[13px] font-medium text-mipiace-ink-soft mb-1.5">
              Rol
            </label>
            <div className="relative">
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as "MANAGER" | "CASHIER")}
                className="w-full h-12 px-3.5 pr-9 rounded-xl bg-mipiace-stone border border-transparent text-[14.5px] text-mipiace-ink appearance-none focus:bg-white focus:border-mipiace-coral/30 focus:ring-2 focus:ring-mipiace-coral/30 focus:outline-none"
              >
                <option value="CASHIER">Cajero (ventas)</option>
                <option value="MANAGER">Encargado (todo lo del cajero + autorizar descuentos, cierres forzados)</option>
              </select>
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
            </div>
          </div>
          <TextField
            id="cashierPin"
            label="PIN inicial (4-8 dígitos)"
            value={pin}
            onChange={setPin}
            required
            inputMode="numeric"
            pattern="^[0-9]{4,8}$"
            minLength={4}
            autoComplete="off"
          />
          <div className="flex gap-2.5">
            <OutlineButton onClick={onClose} disabled={busy} className="!w-full">
              Cancelar
            </OutlineButton>
            <PrimaryButton busy={busy}>Crear</PrimaryButton>
          </div>
          <FieldError message={error} />
        </form>
      </div>
    </div>
  );
}

// v1.7-alias-cajeros: edición del alias (PATCH /cashiers/:id). El
// email no se edita — es la credencial.
function EditAliasModal({
  cashier,
  onClose,
  onSaved,
}: {
  cashier: CashierRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [alias, setAlias] = useState(cashier.alias ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = alias.trim();
    if (trimmed.length === 0) {
      setError("El alias no puede estar vacío");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api(`/cashiers/${cashier.id}`, {
        method: "PATCH",
        body: { alias: trimmed },
      });
      onSaved();
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
      else setError("Error inesperado");
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
          Editar alias
        </h2>
        <p className="text-[13px] text-slate-500 mb-5">
          Es el nombre que aparece en el TPV, en los tickets impresos y en
          las comandas. El email ({cashier.email}) no cambia.
        </p>
        <form onSubmit={onSubmit} className="space-y-4">
          <TextField
            id="editAlias"
            label="Alias"
            autoComplete="off"
            value={alias}
            onChange={(v) => setAlias(v.slice(0, 40))}
            required
          />
          <div className="flex gap-2.5">
            <OutlineButton onClick={onClose} disabled={busy} className="!w-full">
              Cancelar
            </OutlineButton>
            <PrimaryButton busy={busy}>Guardar</PrimaryButton>
          </div>
          <FieldError message={error} />
        </form>
      </div>
    </div>
  );
}

function ResetPinModal({
  cashier,
  onClose,
  onReset,
}: {
  cashier: CashierRow;
  onClose: () => void;
  onReset: () => void;
}) {
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(`/cashiers/${cashier.id}/pin`, {
        method: "PATCH",
        body: { pin },
      });
      onReset();
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
      else setError("Error inesperado");
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
          Cambiar PIN
        </h2>
        <p className="text-[13px] text-slate-500 mb-5">
          Asigna un PIN nuevo para {displayName(cashier)}. El anterior queda
          inservible inmediatamente.
        </p>
        <form onSubmit={onSubmit} className="space-y-4">
          <TextField
            id="newPin"
            label="Nuevo PIN (4-8 dígitos)"
            value={pin}
            onChange={setPin}
            required
            inputMode="numeric"
            pattern="^[0-9]{4,8}$"
            minLength={4}
            autoComplete="off"
          />
          <div className="flex gap-2.5">
            <OutlineButton onClick={onClose} disabled={busy} className="!w-full">
              Cancelar
            </OutlineButton>
            <PrimaryButton busy={busy}>Actualizar</PrimaryButton>
          </div>
          <FieldError message={error} />
        </form>
      </div>
    </div>
  );
}
