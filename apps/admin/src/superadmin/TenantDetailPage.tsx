import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  AlertTriangle,
  Eye,
  LockKeyhole,
  LockOpen,
  LogOut,
  RefreshCw,
} from "lucide-react";

import { superApi, SuperAdminApiError } from "./api.js";
import { SuperAdminShell } from "./SuperAdminShell.js";
import type { ImpersonateResponse, TenantDetail } from "./types.js";

export function TenantDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [tenant, setTenant] = useState<TenantDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const [showBlockModal, setShowBlockModal] = useState(false);
  const [blockReason, setBlockReason] = useState("");
  const [busy, setBusy] = useState(false);

  async function reload(): Promise<void> {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const res = await superApi<TenantDetail>(`/super-admin/tenants/${id}`);
      setTenant(res);
    } catch (err) {
      setError(err instanceof SuperAdminApiError ? err.message : "Error inesperado");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function onBlock(): Promise<void> {
    if (!id || !blockReason.trim()) return;
    setBusy(true);
    setActionError(null);
    setActionMessage(null);
    try {
      await superApi(`/super-admin/tenants/${id}/status`, {
        method: "PATCH",
        body: { blocked: true, reason: blockReason.trim() },
      });
      setShowBlockModal(false);
      setBlockReason("");
      setActionMessage("Tenant bloqueado. Sus usuarios reciben 423 en su próxima request.");
      await reload();
    } catch (err) {
      setActionError(
        err instanceof SuperAdminApiError ? err.message : "Error inesperado",
      );
    } finally {
      setBusy(false);
    }
  }

  async function onUnblock(): Promise<void> {
    if (!id) return;
    setBusy(true);
    setActionError(null);
    setActionMessage(null);
    try {
      await superApi(`/super-admin/tenants/${id}/status`, {
        method: "PATCH",
        body: { blocked: false },
      });
      setActionMessage("Tenant desbloqueado.");
      await reload();
    } catch (err) {
      setActionError(
        err instanceof SuperAdminApiError ? err.message : "Error inesperado",
      );
    } finally {
      setBusy(false);
    }
  }

  async function onForceLogout(): Promise<void> {
    if (!id) return;
    if (!confirm("Cerrará la sesión de TODOS los usuarios del tenant. ¿Continuar?")) return;
    setBusy(true);
    setActionError(null);
    setActionMessage(null);
    try {
      const r = await superApi<{ usersAffected: number }>(
        `/super-admin/tenants/${id}/force-logout`,
        { method: "POST" },
      );
      setActionMessage(`Sesión invalidada para ${r.usersAffected} usuario(s).`);
    } catch (err) {
      setActionError(
        err instanceof SuperAdminApiError ? err.message : "Error inesperado",
      );
    } finally {
      setBusy(false);
    }
  }

  async function onResync(): Promise<void> {
    if (!id) return;
    setBusy(true);
    setActionError(null);
    setActionMessage(null);
    try {
      const r = await superApi<{ syncJobId: string }>(
        `/super-admin/tenants/${id}/resync`,
        { method: "POST" },
      );
      setActionMessage(`Sync encolado. Job: ${r.syncJobId}`);
    } catch (err) {
      setActionError(
        err instanceof SuperAdminApiError ? err.message : "Error inesperado",
      );
    } finally {
      setBusy(false);
    }
  }

  async function onImpersonate(): Promise<void> {
    if (!id) return;
    setBusy(true);
    setActionError(null);
    setActionMessage(null);
    try {
      const r = await superApi<ImpersonateResponse>(
        `/super-admin/tenants/${id}/impersonate`,
        { method: "POST" },
      );
      // Abrir el admin per-tenant en pestaña nueva con el token.
      const url = `${window.location.origin}/?impersonationToken=${encodeURIComponent(
        r.impersonationToken,
      )}`;
      window.open(url, "_blank", "noopener,noreferrer");
      setActionMessage(
        `Sesión de impersonación abierta. Caduca el ${new Date(r.expiresAt).toLocaleTimeString()}.`,
      );
    } catch (err) {
      setActionError(
        err instanceof SuperAdminApiError ? err.message : "Error inesperado",
      );
    } finally {
      setBusy(false);
    }
  }

  if (loading || !tenant) {
    return (
      <SuperAdminShell title="Tenant">
        {loading ? (
          <div className="text-slate-500 text-[13.5px]">Cargando…</div>
        ) : (
          <div className="text-red-600 text-[13.5px]">{error ?? "Sin datos"}</div>
        )}
      </SuperAdminShell>
    );
  }

  const blocked = tenant.blockedAt != null;

  return (
    <SuperAdminShell title={tenant.name}>
      {blocked && (
        <div className="mb-5 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-red-600 mt-0.5" />
          <div className="flex-1">
            <p className="font-medium text-red-900 text-[13.5px]">
              Tenant bloqueado
            </p>
            <p className="text-[12.5px] text-red-700 mt-0.5">
              Razón: {tenant.blockedReason ?? "Sin razón"}. Bloqueado{" "}
              {new Date(tenant.blockedAt!).toLocaleString()}.
            </p>
          </div>
        </div>
      )}

      {actionMessage && (
        <div className="mb-4 p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-emerald-900 text-[13px]">
          {actionMessage}
        </div>
      )}
      {actionError && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-900 text-[13px]">
          {actionError}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <Card label="Tickets últimos 7 días" value={tenant.metrics.ticketsLast7d} />
        <Card label="Tickets en SYNC_FAILED" value={tenant.metrics.ticketsSyncFailed} accent={tenant.metrics.ticketsSyncFailed > 0 ? "warning" : "neutral"} />
        <Card label="Tickets con email fallido" value={tenant.metrics.ticketsEmailFailed} accent={tenant.metrics.ticketsEmailFailed > 0 ? "warning" : "neutral"} />
        <Card label="Stores" value={tenant.metrics.storesCount} />
        <Card label="Turnos abiertos" value={tenant.metrics.activeShifts} />
        <Card
          label="Holded"
          value={tenant.holdedConnected ? "Conectado" : "Sin conectar"}
          accent={tenant.holdedConnected ? "ok" : "warning"}
        />
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-6 mb-6">
        <h3 className="font-semibold text-slate-900 mb-4">Datos fiscales</h3>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-[13px]">
          <div>
            <dt className="text-[11.5px] uppercase text-slate-500">Nombre</dt>
            <dd className="text-slate-900">{tenant.name}</dd>
          </div>
          <div>
            <dt className="text-[11.5px] uppercase text-slate-500">NIF</dt>
            <dd className="text-slate-900 font-mono">{tenant.fiscalNif ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-[11.5px] uppercase text-slate-500">Plan</dt>
            <dd className="text-slate-900">{tenant.plan ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-[11.5px] uppercase text-slate-500">Creado</dt>
            <dd className="text-slate-900">{new Date(tenant.createdAt).toLocaleDateString()}</dd>
          </div>
          <div>
            <dt className="text-[11.5px] uppercase text-slate-500">Owner</dt>
            <dd className="text-slate-900">{tenant.ownerEmail ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-[11.5px] uppercase text-slate-500">Último sync</dt>
            <dd className="text-slate-900">
              {tenant.lastIncrementalSyncAt
                ? new Date(tenant.lastIncrementalSyncAt).toLocaleString()
                : "—"}
            </dd>
          </div>
        </dl>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-6 mb-6">
        <h3 className="font-semibold text-slate-900 mb-4">Acciones</h3>
        <div className="flex flex-wrap gap-2">
          {blocked ? (
            <Action
              onClick={onUnblock}
              busy={busy}
              icon={LockOpen}
              label="Desbloquear"
              tone="primary"
            />
          ) : (
            <Action
              onClick={() => setShowBlockModal(true)}
              busy={busy}
              icon={LockKeyhole}
              label="Bloquear"
              tone="danger"
            />
          )}
          <Action
            onClick={onForceLogout}
            busy={busy}
            icon={LogOut}
            label="Force logout"
          />
          <Action
            onClick={onResync}
            busy={busy}
            icon={RefreshCw}
            label="Resync Holded"
            disabled={!tenant.holdedConnected}
          />
          <Action
            onClick={onImpersonate}
            busy={busy}
            icon={Eye}
            label="Impersonar (sólo lectura)"
            disabled={!tenant.ownerEmail || blocked}
          />
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-6 mb-6">
        <h3 className="font-semibold text-slate-900 mb-4">Usuarios ({tenant.users.length})</h3>
        <table className="w-full text-[13px]">
          <thead className="text-slate-500 text-[11.5px] uppercase">
            <tr>
              <th className="text-left py-2">Email</th>
              <th className="text-left py-2">Rol</th>
              <th className="text-left py-2">2FA</th>
              <th className="text-left py-2">Último login</th>
              <th className="text-left py-2">Estado</th>
            </tr>
          </thead>
          <tbody>
            {tenant.users.map((u) => (
              <tr key={u.id} className="border-t border-slate-100">
                <td className="py-2.5">{u.email}</td>
                <td className="py-2.5">{u.role}</td>
                <td className="py-2.5">
                  {u.twoFactorEnabled ? (
                    <span className="text-emerald-700">Sí</span>
                  ) : (
                    <span className="text-slate-400">No</span>
                  )}
                </td>
                <td className="py-2.5 text-slate-600">
                  {u.lastLoginAt
                    ? new Date(u.lastLoginAt).toLocaleString()
                    : "Nunca"}
                </td>
                <td className="py-2.5">
                  {u.mustChangePassword ? (
                    <span className="text-amber-700 text-[12px]">
                      Pendiente de cambiar password
                    </span>
                  ) : (
                    <span className="text-slate-400 text-[12px]">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showBlockModal && (
        <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md">
            <h3 className="font-semibold text-slate-900 mb-2">Bloquear tenant</h3>
            <p className="text-[13px] text-slate-600 mb-4">
              Todos los usuarios del tenant recibirán 423 Locked en sus
              requests. Indica la razón (queda registrada en auditoría).
            </p>
            <textarea
              value={blockReason}
              onChange={(e) => setBlockReason(e.target.value)}
              rows={3}
              placeholder="Ej: Cliente dejó de pagar"
              className="w-full p-3 border border-slate-300 rounded-lg text-[13.5px] focus:outline-none focus:border-slate-500"
            />
            <div className="flex gap-2 mt-4">
              <button
                onClick={onBlock}
                disabled={busy || !blockReason.trim()}
                className="flex-1 h-10 bg-red-600 text-white rounded-lg text-[13px] font-medium hover:bg-red-700 disabled:opacity-50"
              >
                Bloquear
              </button>
              <button
                onClick={() => {
                  setShowBlockModal(false);
                  setBlockReason("");
                }}
                className="flex-1 h-10 border border-slate-300 rounded-lg text-[13px] hover:bg-slate-50"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      <button
        onClick={() => navigate("/superadmin/tenants")}
        className="text-[12.5px] text-slate-500 hover:text-slate-700"
      >
        ← Volver al listado
      </button>
    </SuperAdminShell>
  );
}

function Card({
  label,
  value,
  accent = "neutral",
}: {
  label: string;
  value: number | string;
  accent?: "neutral" | "ok" | "warning";
}) {
  const tone =
    accent === "warning"
      ? "border-amber-200 bg-amber-50"
      : accent === "ok"
        ? "border-emerald-200 bg-emerald-50"
        : "border-slate-200 bg-white";
  return (
    <div className={`rounded-xl border p-4 ${tone}`}>
      <div className="text-[11.5px] uppercase tracking-wide text-slate-500 mb-1">
        {label}
      </div>
      <div className="text-[20px] font-semibold text-slate-900 tabular-nums">
        {value}
      </div>
    </div>
  );
}

function Action({
  onClick,
  busy,
  icon: Icon,
  label,
  tone = "neutral",
  disabled = false,
}: {
  onClick: () => void;
  busy: boolean;
  icon: typeof Eye;
  label: string;
  tone?: "neutral" | "primary" | "danger";
  disabled?: boolean;
}) {
  const cls =
    tone === "danger"
      ? "border-red-300 text-red-700 hover:bg-red-50"
      : tone === "primary"
        ? "border-emerald-300 text-emerald-800 hover:bg-emerald-50"
        : "border-slate-300 text-slate-700 hover:bg-slate-50";
  return (
    <button
      onClick={onClick}
      disabled={busy || disabled}
      className={`inline-flex items-center gap-1.5 h-10 px-3.5 border rounded-lg text-[13px] font-medium disabled:opacity-40 disabled:cursor-not-allowed ${cls}`}
    >
      <Icon className="w-4 h-4" />
      {label}
    </button>
  );
}
