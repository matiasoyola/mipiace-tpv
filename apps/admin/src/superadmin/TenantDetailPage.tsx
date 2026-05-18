import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  AlertTriangle,
  Check,
  Copy,
  Eye,
  FlaskConical,
  LockKeyhole,
  LockOpen,
  LogOut,
  Power,
  RefreshCw,
  Sparkles,
  X,
} from "lucide-react";

import { superApi, SuperAdminApiError } from "./api.js";
import { SuperAdminShell } from "./SuperAdminShell.js";
import type {
  ActivateTenantResponse,
  ImpersonateResponse,
  TenantDetail,
  TestCashierTokenResponse,
} from "./types.js";

// B-OnboardingV2 · Frente 8 · Detalle de tenant con onboarding supervisado.
//
// La página tiene dos modos:
//   - tenant DRAFT: panel "Datos fiscales" (read-only), panel
//     "Validación de onboarding" con readinessChecks, panel "Modo
//     prueba" con botón Probar TPV, panel "Activar" con modal.
//   - tenant ACTIVE: el panel clásico de B-SuperAdmin (block/unblock/
//     force-logout/resync/impersonate).
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
  const [showActivateModal, setShowActivateModal] = useState(false);
  const [ownerEmail, setOwnerEmail] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [activated, setActivated] = useState<ActivateTenantResponse | null>(null);
  const [copiedPwd, setCopiedPwd] = useState(false);
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
      setActionError(err instanceof SuperAdminApiError ? err.message : "Error inesperado");
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
      setActionError(err instanceof SuperAdminApiError ? err.message : "Error inesperado");
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
      setActionError(err instanceof SuperAdminApiError ? err.message : "Error inesperado");
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
      // Recargamos a los 2 s para reflejar el cambio de status.
      setTimeout(() => void reload(), 2000);
    } catch (err) {
      setActionError(err instanceof SuperAdminApiError ? err.message : "Error inesperado");
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
      const url = `${window.location.origin}/?impersonationToken=${encodeURIComponent(
        r.impersonationToken,
      )}`;
      window.open(url, "_blank", "noopener,noreferrer");
      setActionMessage(
        `Sesión de impersonación abierta. Caduca el ${new Date(r.expiresAt).toLocaleTimeString()}.`,
      );
    } catch (err) {
      setActionError(err instanceof SuperAdminApiError ? err.message : "Error inesperado");
    } finally {
      setBusy(false);
    }
  }

  async function onTestTpv(): Promise<void> {
    if (!id) return;
    setBusy(true);
    setActionError(null);
    setActionMessage(null);
    try {
      const r = await superApi<TestCashierTokenResponse>(
        `/super-admin/tenants/${id}/test-cashier-token`,
        { method: "POST" },
      );
      const url =
        (import.meta.env.VITE_TPV_URL ?? "/") +
        `?testCashierToken=${encodeURIComponent(r.cashierSessionToken)}` +
        `&testDeviceToken=${encodeURIComponent(r.deviceToken)}`;
      window.open(url, "_blank", "noopener,noreferrer");
      setActionMessage(
        `Modo prueba abierto en ${r.store.name} · ${r.register.name}. Caduca el ${new Date(r.expiresAt).toLocaleString()}.`,
      );
    } catch (err) {
      setActionError(err instanceof SuperAdminApiError ? err.message : "Error inesperado");
    } finally {
      setBusy(false);
    }
  }

  async function onActivate(): Promise<void> {
    if (!id || !ownerEmail.trim() || !ownerName.trim()) return;
    setBusy(true);
    setActionError(null);
    setActionMessage(null);
    try {
      const r = await superApi<ActivateTenantResponse>(
        `/super-admin/tenants/${id}/activate`,
        {
          method: "POST",
          body: {
            ownerEmail: ownerEmail.trim().toLowerCase(),
            ownerName: ownerName.trim(),
          },
        },
      );
      setActivated(r);
      setShowActivateModal(false);
      await reload();
    } catch (err) {
      setActionError(err instanceof SuperAdminApiError ? err.message : "Error inesperado");
    } finally {
      setBusy(false);
    }
  }

  async function copyPwd(): Promise<void> {
    if (!activated) return;
    try {
      await navigator.clipboard.writeText(activated.tempPassword);
      setCopiedPwd(true);
      setTimeout(() => setCopiedPwd(false), 2500);
    } catch {
      /* clipboard puede fallar */
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
  const isDraft = tenant.onboardingState === "DRAFT";

  return (
    <SuperAdminShell title={tenant.name}>
      {activated && (
        <div className="mb-5 p-5 bg-emerald-50 border border-emerald-200 rounded-xl">
          <div className="flex items-center gap-2 mb-3">
            <Sparkles className="w-5 h-5 text-emerald-700" />
            <h3 className="font-semibold text-emerald-900">
              Tenant activado. El propietario recibe el email ahora.
            </h3>
          </div>
          <p className="text-[13px] text-emerald-900 mb-3">
            Datos purgados: {activated.purge.ticketsTestPurged} ticket(s) de
            prueba, {activated.purge.emailJobsPurged} email job(s) limpios,
            cashier técnico {activated.purge.cashierDeleted ? "borrado" : "no encontrado"},
            device {activated.purge.deviceRevoked ? "revocado" : "no encontrado"}.
          </p>
          <div className="text-[12px] uppercase tracking-wide text-emerald-700 mb-1">
            Contraseña temporal del OWNER
          </div>
          <div className="flex items-center gap-2">
            <code className="font-mono bg-slate-900 text-white rounded-lg px-3 py-2 text-[14px] tracking-wide">
              {activated.tempPassword}
            </code>
            <button
              onClick={copyPwd}
              className="inline-flex items-center gap-1 h-9 px-3 border border-emerald-300 rounded-lg text-[12.5px] hover:bg-emerald-100 text-emerald-800"
            >
              <Copy className="w-3.5 h-3.5" />
              {copiedPwd ? "Copiado" : "Copiar"}
            </button>
          </div>
          <p className="text-[11.5px] text-emerald-700 mt-2">
            Sólo se muestra una vez. Si el email no llega, pásasela al cliente
            por canal seguro.
          </p>
        </div>
      )}

      {blocked && (
        <div className="mb-5 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-red-600 mt-0.5" />
          <div className="flex-1">
            <p className="font-medium text-red-900 text-[13.5px]">Tenant bloqueado</p>
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

      <StateHeader state={tenant.onboardingState} />

      <div className="bg-white border border-slate-200 rounded-xl p-6 mb-6">
        <h3 className="font-semibold text-slate-900 mb-4">Datos fiscales</h3>
        <p className="text-[12px] text-slate-500 mb-3">
          Extraídos de la cuenta Holded del cliente. Read-only.
        </p>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-[13px]">
          <div>
            <dt className="text-[11.5px] uppercase text-slate-500">Razón social</dt>
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
            <dt className="text-[11.5px] uppercase text-slate-500">Holded</dt>
            <dd className="text-slate-900">
              {tenant.holdedConnected ? "Conectado" : "Sin conectar"}
            </dd>
          </div>
        </dl>
      </div>

      {isDraft ? (
        <>
          <HealthPanel
            tenant={tenant}
            busy={busy}
            onResync={onResync}
          />
          <TestPanel
            tenant={tenant}
            busy={busy}
            onTestTpv={onTestTpv}
          />
          <ActivatePanel
            tenant={tenant}
            busy={busy}
            onAskActivate={() => setShowActivateModal(true)}
          />
        </>
      ) : (
        <ActiveTenantActions
          blocked={blocked}
          tenant={tenant}
          busy={busy}
          onBlock={() => setShowBlockModal(true)}
          onUnblock={onUnblock}
          onForceLogout={onForceLogout}
          onResync={onResync}
          onImpersonate={onImpersonate}
        />
      )}

      <div className="bg-white border border-slate-200 rounded-xl p-6 mb-6">
        <h3 className="font-semibold text-slate-900 mb-4">
          Usuarios ({tenant.users.length})
        </h3>
        {tenant.users.length === 0 ? (
          <p className="text-[12.5px] text-slate-500">
            Sin usuarios reales. El propietario se crea al activar el tenant.
          </p>
        ) : (
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
        )}
      </div>

      {showBlockModal && (
        <Modal onClose={() => setShowBlockModal(false)}>
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
        </Modal>
      )}

      {showActivateModal && (
        <Modal onClose={() => setShowActivateModal(false)}>
          <h3 className="font-semibold text-slate-900 mb-2">Activar tenant</h3>
          <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg text-[12.5px] text-amber-900">
            Al confirmar: se creará la cuenta del propietario y se le enviará
            email con sus credenciales. Los tickets de prueba se borrarán y el
            cajero técnico quedará revocado.
          </div>
          <label className="block text-[12.5px] font-medium text-slate-700 mb-1.5">
            Email del propietario <span className="text-red-500">*</span>
          </label>
          <input
            type="email"
            value={ownerEmail}
            onChange={(e) => setOwnerEmail(e.target.value)}
            placeholder="propietario@negocio.es"
            className="w-full h-11 px-3 border border-slate-300 rounded-lg text-[14px] mb-3 focus:outline-none focus:border-slate-500"
          />
          <label className="block text-[12.5px] font-medium text-slate-700 mb-1.5">
            Nombre del propietario <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={ownerName}
            onChange={(e) => setOwnerName(e.target.value)}
            placeholder="María Pérez"
            maxLength={200}
            className="w-full h-11 px-3 border border-slate-300 rounded-lg text-[14px] focus:outline-none focus:border-slate-500"
          />
          <div className="flex gap-2 mt-4">
            <button
              onClick={onActivate}
              disabled={busy || !ownerEmail.trim() || !ownerName.trim()}
              className="flex-1 h-10 bg-emerald-600 text-white rounded-lg text-[13px] font-medium hover:bg-emerald-700 disabled:opacity-50"
            >
              {busy ? "Activando…" : "Confirmar activación"}
            </button>
            <button
              onClick={() => setShowActivateModal(false)}
              className="flex-1 h-10 border border-slate-300 rounded-lg text-[13px] hover:bg-slate-50"
            >
              Cancelar
            </button>
          </div>
        </Modal>
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

function StateHeader({ state }: { state: "DRAFT" | "ACTIVE" }) {
  if (state === "ACTIVE") return null;
  return (
    <div className="mb-5 p-4 bg-slate-50 border border-slate-200 rounded-lg flex items-start gap-3">
      <FlaskConical className="w-5 h-5 text-slate-700 mt-0.5" />
      <div>
        <p className="font-medium text-slate-900 text-[13.5px]">
          En configuración (DRAFT)
        </p>
        <p className="text-[12.5px] text-slate-600 mt-0.5">
          Sin propietario todavía. Tu equipo prueba el TPV con un cajero
          técnico. Cuando todo pase, "Activar tenant" crea el OWNER y le
          envía el email.
        </p>
      </div>
    </div>
  );
}

function HealthPanel({
  tenant,
  busy,
  onResync,
}: {
  tenant: TenantDetail;
  busy: boolean;
  onResync: () => void;
}) {
  const h = tenant.onboardingHealth;
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-6 mb-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="font-semibold text-slate-900">Validación de onboarding</h3>
          <p className="text-[12px] text-slate-500 mt-0.5">
            Cuando todos los checks pasen, podrás activar el tenant.
          </p>
        </div>
        <button
          onClick={onResync}
          disabled={busy || !tenant.holdedConnected}
          className="inline-flex items-center gap-1.5 h-9 px-3 border border-slate-300 rounded-lg text-[12.5px] hover:bg-slate-50 disabled:opacity-40"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Re-sync
        </button>
      </div>
      <ul className="space-y-2 mb-5">
        {h.readinessChecks.map((c) => (
          <li
            key={c.id}
            className={`flex items-start gap-2 p-2.5 rounded-lg ${
              c.ok ? "bg-emerald-50" : "bg-amber-50"
            }`}
          >
            <span
              className={`mt-0.5 inline-flex items-center justify-center w-5 h-5 rounded-full ${
                c.ok ? "bg-emerald-600" : "bg-amber-500"
              }`}
            >
              {c.ok ? (
                <Check className="w-3 h-3 text-white" strokeWidth={3} />
              ) : (
                <X className="w-3 h-3 text-white" strokeWidth={3} />
              )}
            </span>
            <div className="flex-1">
              <div className="text-[13px] text-slate-900">{c.label}</div>
              {c.value && (
                <div className="text-[11.5px] text-slate-500 mt-0.5 font-mono">
                  {c.value}
                </div>
              )}
            </div>
          </li>
        ))}
      </ul>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-[12px]">
        <Stat label="Productos" value={`${h.products.sellable}/${h.products.total}`} />
        <Stat label="Servicios" value={`${h.services.total}`} />
        <Stat label="Taxes" value={`${h.taxes.withValidRate}/${h.taxes.total}`} />
        <Stat label="Contactos" value={`${h.contacts.total}`} />
      </div>
      {h.initialSync.errorMessage && (
        <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-[12.5px] text-red-900">
          Último error de sync: {h.initialSync.errorMessage}
        </div>
      )}
    </div>
  );
}

function TestPanel({
  tenant,
  busy,
  onTestTpv,
}: {
  tenant: TenantDetail;
  busy: boolean;
  onTestTpv: () => void;
}) {
  const h = tenant.onboardingHealth;
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-6 mb-6">
      <h3 className="font-semibold text-slate-900 mb-2">Modo prueba</h3>
      <p className="text-[12.5px] text-slate-500 mb-4">
        Abre el TPV con un cajero técnico interno. Los tickets generados
        aquí NO se suben a Holded ni mandan email. Al activar el tenant se
        purgan.
      </p>
      <div className="flex items-center gap-3">
        <button
          onClick={onTestTpv}
          disabled={busy || !h.testCashierProvisioned}
          className="inline-flex items-center gap-2 h-10 px-4 bg-slate-900 text-white rounded-lg text-[13px] font-medium hover:bg-slate-800 disabled:opacity-40"
        >
          <FlaskConical className="w-4 h-4" />
          Probar TPV
        </button>
        <div className="text-[12.5px] text-slate-600">
          <div>
            Tickets prueba: <strong className="tabular-nums">{h.ticketsTest.total}</strong>
          </div>
          {h.ticketsTest.lastAt && (
            <div className="text-[11.5px] text-slate-400">
              Último: {new Date(h.ticketsTest.lastAt).toLocaleString()}
            </div>
          )}
        </div>
      </div>
      {!h.testCashierProvisioned && (
        <p className="mt-3 text-[12px] text-amber-700">
          Esperando a que el sync inicial termine para provisionar el cajero
          técnico.
        </p>
      )}
    </div>
  );
}

function ActivatePanel({
  tenant,
  busy,
  onAskActivate,
}: {
  tenant: TenantDetail;
  busy: boolean;
  onAskActivate: () => void;
}) {
  const ready = tenant.onboardingHealth.ready;
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-6 mb-6">
      <h3 className="font-semibold text-slate-900 mb-2">Activar tenant</h3>
      <p className="text-[12.5px] text-slate-500 mb-4">
        Crea la cuenta del propietario y envía email con credenciales.
        Borra los datos de prueba. <strong>Irreversible.</strong>
      </p>
      <button
        onClick={onAskActivate}
        disabled={busy || !ready}
        className="inline-flex items-center gap-2 h-10 px-4 bg-emerald-600 text-white rounded-lg text-[13px] font-medium hover:bg-emerald-700 disabled:opacity-40"
      >
        <Power className="w-4 h-4" />
        Activar tenant
      </button>
      {!ready && (
        <p className="mt-3 text-[12px] text-slate-500">
          Aún hay checks de salud pendientes. Resuélvelos antes de activar.
        </p>
      )}
    </div>
  );
}

function ActiveTenantActions({
  blocked,
  tenant,
  busy,
  onBlock,
  onUnblock,
  onForceLogout,
  onResync,
  onImpersonate,
}: {
  blocked: boolean;
  tenant: TenantDetail;
  busy: boolean;
  onBlock: () => void;
  onUnblock: () => void;
  onForceLogout: () => void;
  onResync: () => void;
  onImpersonate: () => void;
}) {
  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <CardMetric label="Tickets últimos 7 días" value={tenant.metrics.ticketsLast7d} />
        <CardMetric
          label="Tickets en SYNC_FAILED"
          value={tenant.metrics.ticketsSyncFailed}
          accent={tenant.metrics.ticketsSyncFailed > 0 ? "warning" : "neutral"}
        />
        <CardMetric
          label="Tickets con email fallido"
          value={tenant.metrics.ticketsEmailFailed}
          accent={tenant.metrics.ticketsEmailFailed > 0 ? "warning" : "neutral"}
        />
        <CardMetric label="Stores" value={tenant.metrics.storesCount} />
        <CardMetric label="Turnos abiertos" value={tenant.metrics.activeShifts} />
        <CardMetric
          label="Holded"
          value={tenant.holdedConnected ? "Conectado" : "Sin conectar"}
          accent={tenant.holdedConnected ? "ok" : "warning"}
        />
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-6 mb-6">
        <h3 className="font-semibold text-slate-900 mb-4">Acciones</h3>
        <div className="flex flex-wrap gap-2">
          {blocked ? (
            <Action onClick={onUnblock} busy={busy} icon={LockOpen} label="Desbloquear" tone="primary" />
          ) : (
            <Action onClick={onBlock} busy={busy} icon={LockKeyhole} label="Bloquear" tone="danger" />
          )}
          <Action onClick={onForceLogout} busy={busy} icon={LogOut} label="Force logout" />
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
    </>
  );
}

function CardMetric({
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
      <div className="text-[20px] font-semibold text-slate-900 tabular-nums">{value}</div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 p-2.5 bg-white">
      <div className="text-[10.5px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className="text-[15px] font-semibold text-slate-900 tabular-nums">{value}</div>
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

function Modal({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 bg-slate-900/50 flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

