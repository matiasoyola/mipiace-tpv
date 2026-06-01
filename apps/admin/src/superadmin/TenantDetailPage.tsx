import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  AlertTriangle,
  Check,
  Copy,
  ExternalLink,
  Eye,
  FlaskConical,
  LockKeyhole,
  LockOpen,
  LogOut,
  Power,
  RefreshCw,
  Settings,
  Sparkles,
  Tags,
  X,
} from "lucide-react";

import { superApi, SuperAdminApiError } from "./api.js";
import { humanizeError } from "./error-messages.js";
import { SuperAdminShell } from "./SuperAdminShell.js";
import type {
  ActivateTenantResponse,
  BusinessType,
  ImpersonateResponse,
  ImpersonationMode,
  TenantDetail,
  TestCashierTokenResponse,
} from "./types.js";
import { BUSINESS_TYPE_LABEL } from "./types.js";

// B-Hardening B · U1: helper local para convertir una excepción de
// superApi en mensaje humano. Si es SuperAdminApiError (lleva code +
// message de la API), pasamos un objeto a humanizeError(); si es
// cualquier otra cosa (Error genérico, string, etc.) caemos al
// fallback "Error inesperado".
function errToHuman(err: unknown): string {
  if (err instanceof SuperAdminApiError) {
    return humanizeError({ error: err.code, message: err.message });
  }
  if (err instanceof Error) return err.message;
  return humanizeError(err);
}

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
  // v1.3-piloto-feedback · Lote 1: feedback separado al copiar el PIN
  // del OWNER (TPV) — coexiste con el feedback de la contraseña admin.
  const [copiedPin, setCopiedPin] = useState(false);
  const [busy, setBusy] = useState(false);
  // T-6a (v1.1 Thalia): modal de edición de datos fiscales.
  const [showFiscalModal, setShowFiscalModal] = useState(false);
  // v1.3-SuperAdmin-Hub Lote 1: modal de confirmación para impersonate
  // mode=full ("Configurar como OWNER"). El readonly entra directo.
  const [showConfigureModal, setShowConfigureModal] = useState(false);

  async function reload(): Promise<void> {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const res = await superApi<TenantDetail>(`/super-admin/tenants/${id}`);
      setTenant(res);
    } catch (err) {
      setError(errToHuman(err));
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
      setActionMessage("Cuenta bloqueada. Sus usuarios reciben 423 en su próxima request.");
      await reload();
    } catch (err) {
      setActionError(errToHuman(err));
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
      setActionMessage("Cuenta desbloqueada.");
      await reload();
    } catch (err) {
      setActionError(errToHuman(err));
    } finally {
      setBusy(false);
    }
  }

  async function onForceLogout(): Promise<void> {
    if (!id) return;
    if (!confirm("Cerrará la sesión de TODOS los usuarios de la cuenta. ¿Continuar?")) return;
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
      setActionError(errToHuman(err));
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
      setActionError(errToHuman(err));
    } finally {
      setBusy(false);
    }
  }

  // v1.3-Operativa-Extra · Lote 3: dedupe tags duplicados con/sin tilde
  // (papelería ≡ papeleria). Modifica `products.tags` del tenant in
  // situ. Confirm dialog porque es una mutación masiva.
  async function onDedupeTags(): Promise<void> {
    if (!id) return;
    if (
      !confirm(
        "Esto modifica products.tags del tenant para unificar duplicados (papelería ≡ papeleria). ¿Continuar?",
      )
    ) {
      return;
    }
    setBusy(true);
    setActionError(null);
    setActionMessage(null);
    try {
      const r = await superApi<{
        productsScanned: number;
        productsUpdated: number;
        duplicatesRemoved: number;
      }>(`/super-admin/tenants/${id}/dedupe-tags`, { method: "POST" });
      setActionMessage(
        `Dedupe OK: ${r.productsUpdated}/${r.productsScanned} productos actualizados, ${r.duplicatesRemoved} duplicados eliminados.`,
      );
    } catch (err) {
      setActionError(errToHuman(err));
    } finally {
      setBusy(false);
    }
  }

  async function onImpersonate(mode: ImpersonationMode): Promise<void> {
    if (!id) return;
    setBusy(true);
    setActionError(null);
    setActionMessage(null);
    try {
      const r = await superApi<ImpersonateResponse>(
        `/super-admin/tenants/${id}/impersonate`,
        { method: "POST", body: { mode } },
      );
      const url = `${window.location.origin}/?impersonationToken=${encodeURIComponent(
        r.impersonationToken,
      )}`;
      window.open(url, "_blank", "noopener,noreferrer");
      setActionMessage(
        mode === "full"
          ? `Sesión de configuración abierta. Caduca el ${new Date(r.expiresAt).toLocaleTimeString()}. Cada acción quedará en el log.`
          : `Sesión de impersonación abierta. Caduca el ${new Date(r.expiresAt).toLocaleTimeString()}.`,
      );
    } catch (err) {
      setActionError(errToHuman(err));
    } finally {
      setBusy(false);
      setShowConfigureModal(false);
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
      setActionError(errToHuman(err));
    } finally {
      setBusy(false);
    }
  }

  // T-6a: guarda datos fiscales editados. El endpoint hace el merge
  // server-side preservando cualquier otro campo no enviado.
  async function onSaveFiscal(input: {
    legalName: string;
    taxId: string;
    address: string;
    phone: string;
  }): Promise<void> {
    if (!id) return;
    setBusy(true);
    setActionError(null);
    setActionMessage(null);
    try {
      const payload: {
        legalName?: string;
        taxId?: string;
        address?: string;
        phone?: string;
      } = {};
      const ln = input.legalName.trim();
      const tx = input.taxId.trim();
      const ad = input.address.trim();
      const ph = input.phone.trim();
      if (ln) payload.legalName = ln;
      if (tx) payload.taxId = tx;
      if (ad) payload.address = ad;
      if (ph) payload.phone = ph;

      if (Object.keys(payload).length === 0) {
        setShowFiscalModal(false);
        return;
      }

      await superApi(`/super-admin/tenants/${id}`, {
        method: "PATCH",
        body: { fiscalProfile: payload },
      });
      setActionMessage("Datos fiscales actualizados.");
      setShowFiscalModal(false);
      await reload();
    } catch (err) {
      setActionError(errToHuman(err));
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
      setActionError(errToHuman(err));
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

  async function copyPin(): Promise<void> {
    if (!activated) return;
    try {
      await navigator.clipboard.writeText(activated.ownerPin);
      setCopiedPin(true);
      setTimeout(() => setCopiedPin(false), 2500);
    } catch {
      /* clipboard puede fallar */
    }
  }

  if (loading || !tenant) {
    return (
      <SuperAdminShell title="Cuenta">
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
            Contraseña temporal del OWNER (admin)
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
          {/* v1.3-piloto-feedback · Lote 1: PIN del OWNER como cajero
              en el TPV. Se enseña sólo aquí; el OWNER lo puede regenerar
              desde "Mi cuenta" cuando entre al admin. */}
          <div className="text-[12px] uppercase tracking-wide text-emerald-700 mt-4 mb-1">
            PIN del OWNER (TPV / cajero)
          </div>
          <div className="flex items-center gap-2">
            <code className="font-mono bg-slate-900 text-white rounded-lg px-3 py-2 text-[14px] tracking-wide">
              {activated.ownerPin}
            </code>
            <button
              onClick={copyPin}
              className="inline-flex items-center gap-1 h-9 px-3 border border-emerald-300 rounded-lg text-[12.5px] hover:bg-emerald-100 text-emerald-800"
            >
              <Copy className="w-3.5 h-3.5" />
              {copiedPin ? "Copiado" : "Copiar"}
            </button>
          </div>
          <p className="text-[11.5px] text-emerald-700 mt-2">
            Contraseña y PIN se muestran una sola vez. Si el email no llega,
            pásaselos al cliente por canal seguro.
          </p>
        </div>
      )}

      {blocked && (
        <div className="mb-5 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-red-600 mt-0.5" />
          <div className="flex-1">
            <p className="font-medium text-red-900 text-[13.5px]">Cuenta bloqueada</p>
            <p className="text-[12.5px] text-red-700 mt-0.5">
              Razón: {tenant.blockedReason ?? "Sin razón"}. Bloqueado{" "}
              {new Date(tenant.blockedAt!).toLocaleString()}.
            </p>
          </div>
        </div>
      )}

      {/* B-Hardening B · U10: banners dismissables. Antes el banner
          de error/success se quedaba clavado hasta que cambiabas de
          página, lo que generaba ruido visual cuando ya habías
          asimilado el mensaje. Ahora se pueden cerrar con X. */}
      {actionMessage && (
        <div className="mb-4 p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-emerald-900 text-[13px] flex items-start gap-2">
          <Check className="w-4 h-4 mt-0.5 flex-shrink-0 text-emerald-700" />
          <span className="flex-1">{actionMessage}</span>
          <button
            type="button"
            onClick={() => setActionMessage(null)}
            aria-label="Cerrar"
            className="text-emerald-700/70 hover:text-emerald-900 flex-shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
      {actionError && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-900 text-[13px] flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0 text-red-700" />
          <span className="flex-1">{actionError}</span>
          <button
            type="button"
            onClick={() => setActionError(null)}
            aria-label="Cerrar"
            className="text-red-700/70 hover:text-red-900 flex-shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      <StateHeader state={tenant.onboardingState} />

      <div className="bg-white border border-slate-200 rounded-xl p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-slate-900">Datos fiscales</h3>
          <button
            onClick={() => setShowFiscalModal(true)}
            disabled={busy}
            className="h-8 px-3 text-[12.5px] border border-slate-300 rounded-lg hover:bg-slate-50 text-slate-700 disabled:opacity-50"
          >
            Editar
          </button>
        </div>
        <p className="text-[12px] text-slate-500 mb-3">
          Datos que aparecen en cabecera de ticket. Si Holded los expone,
          el sync inicial los rellena; aquí puedes editarlos o añadirlos
          manualmente.
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
            <dt className="text-[11.5px] uppercase text-slate-500">Tipo de negocio</dt>
            <dd>
              <BusinessTypeEditor
                tenantId={tenant.id}
                current={tenant.businessType}
                onChange={(bt) => setTenant({ ...tenant, businessType: bt })}
              />
            </dd>
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
          onImpersonateReadonly={() => void onImpersonate("readonly")}
          onAskConfigure={() => setShowConfigureModal(true)}
          onDedupeTags={onDedupeTags}
        />
      )}

      <HoldedAccountIdPanel
        tenantId={tenant.id}
        current={tenant.holdedAccountId}
        onSaved={(next) => setTenant({ ...tenant, holdedAccountId: next })}
      />

      <ReceiptFooterPanel
        tenantId={tenant.id}
        current={tenant.receiptFooter}
        onSaved={(next) => setTenant({ ...tenant, receiptFooter: next })}
      />

      <IconPresetPanel
        tenantId={tenant.id}
        current={tenant.tpvIconPreset}
        businessType={tenant.businessType}
        onSaved={(next) => setTenant({ ...tenant, tpvIconPreset: next })}
      />

      {/* v1.3-piloto-feedback · Lote 2: cambiar el OWNER de un tenant
          activo. Sólo visible en ACTIVE; en DRAFT basta con activar
          directamente con el email correcto. */}
      {!isDraft && (
        <TransferOwnerPanel
          tenantId={tenant.id}
          currentOwnerEmail={tenant.ownerEmail}
          onTransferred={() => void reload()}
        />
      )}

      <div className="bg-white border border-slate-200 rounded-xl p-6 mb-6">
        <h3 className="font-semibold text-slate-900 mb-4">
          Usuarios ({tenant.users.length})
        </h3>
        {tenant.users.length === 0 ? (
          <p className="text-[12.5px] text-slate-500">
            Sin usuarios reales. El propietario se crea al activar la cuenta.
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

      {showFiscalModal && (
        <FiscalProfileModal
          tenant={tenant}
          busy={busy}
          onCancel={() => setShowFiscalModal(false)}
          onSave={onSaveFiscal}
        />
      )}

      {showBlockModal && (
        <Modal onClose={() => setShowBlockModal(false)}>
          <h3 className="font-semibold text-slate-900 mb-2">Bloquear cuenta</h3>
          <p className="text-[13px] text-slate-600 mb-4">
            Todos los usuarios de la cuenta recibirán 423 Locked en sus
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

      {showConfigureModal && (
        <Modal onClose={() => setShowConfigureModal(false)}>
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="w-5 h-5 text-amber-600" />
            <h3 className="font-semibold text-slate-900">
              Configurar como OWNER
            </h3>
          </div>
          <p className="text-[13px] text-slate-700 mb-3">
            Vas a entrar al panel del cliente con permisos de escritura.
            Todo lo que hagas quedará registrado en el log de auditoría.
            ¿Continuar?
          </p>
          <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg text-[12.5px] text-amber-900">
            Cada acción se firma con tu identidad de super-admin y queda
            en <code className="font-mono">impersonate_write</code>. Sal
            de la sesión cuando termines.
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => void onImpersonate("full")}
              disabled={busy}
              className="flex-1 h-10 bg-amber-600 text-white rounded-lg text-[13px] font-medium hover:bg-amber-700 disabled:opacity-50"
            >
              {busy ? "Abriendo…" : "Sí, configurar"}
            </button>
            <button
              onClick={() => setShowConfigureModal(false)}
              disabled={busy}
              className="flex-1 h-10 border border-slate-300 rounded-lg text-[13px] hover:bg-slate-50"
            >
              Cancelar
            </button>
          </div>
        </Modal>
      )}

      {showActivateModal && (
        <Modal onClose={() => setShowActivateModal(false)}>
          <h3 className="font-semibold text-slate-900 mb-2">Activar cuenta</h3>
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
          técnico. Cuando todo pase, "Activar cuenta" crea el OWNER y le
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
            Cuando todos los checks pasen, podrás activar la cuenta.
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
        aquí NO se suben a Holded ni mandan email. Al activar la cuenta se
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
      <h3 className="font-semibold text-slate-900 mb-2">Activar cuenta</h3>
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
        Activar cuenta
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
  onImpersonateReadonly,
  onAskConfigure,
  onDedupeTags,
}: {
  blocked: boolean;
  tenant: TenantDetail;
  busy: boolean;
  onBlock: () => void;
  onUnblock: () => void;
  onForceLogout: () => void;
  onResync: () => void;
  onImpersonateReadonly: () => void;
  onAskConfigure: () => void;
  onDedupeTags: () => void;
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
            onClick={onDedupeTags}
            busy={busy}
            icon={Tags}
            label="Limpiar tags duplicados"
          />
          <Action
            onClick={onImpersonateReadonly}
            busy={busy}
            icon={Eye}
            label="Impersonar (sólo lectura)"
            disabled={!tenant.ownerEmail || blocked}
          />
          <Action
            onClick={onAskConfigure}
            busy={busy}
            icon={Settings}
            label="Configurar como OWNER"
            tone="warning"
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
  tone?: "neutral" | "primary" | "danger" | "warning";
  disabled?: boolean;
}) {
  const cls =
    tone === "danger"
      ? "border-red-300 text-red-700 hover:bg-red-50"
      : tone === "primary"
        ? "border-emerald-300 text-emerald-800 hover:bg-emerald-50"
        : tone === "warning"
          ? "border-amber-400 text-amber-800 bg-amber-50 hover:bg-amber-100"
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

// T-6a (v1.1 Thalia): edición de datos fiscales del tenant. El backend
// hace merge server-side preservando cualquier campo no enviado. Si
// el campo viene vacío, no se envía al PATCH (no pisa valor previo).
function FiscalProfileModal({
  tenant,
  busy,
  onCancel,
  onSave,
}: {
  tenant: TenantDetail;
  busy: boolean;
  onCancel: () => void;
  onSave: (input: {
    legalName: string;
    taxId: string;
    address: string;
    phone: string;
  }) => void;
}) {
  // Pre-rellenamos con lo que ya hay. Si el tenant nunca tuvo el
  // campo, queda vacío y el placeholder ayuda.
  const fp = (tenant.fiscalProfile ?? {}) as Record<string, unknown>;
  const initial = {
    legalName: typeof fp.legalName === "string" ? fp.legalName : "",
    taxId:
      (typeof fp.taxId === "string" && fp.taxId) ||
      (typeof fp.nif === "string" && fp.nif) ||
      tenant.fiscalNif ||
      "",
    address: typeof fp.address === "string" ? fp.address : "",
    phone: typeof fp.phone === "string" ? fp.phone : "",
  };
  const [legalName, setLegalName] = useState(initial.legalName);
  const [taxId, setTaxId] = useState(initial.taxId);
  const [address, setAddress] = useState(initial.address);
  const [phone, setPhone] = useState(initial.phone);

  return (
    <Modal onClose={onCancel}>
      <h3 className="font-semibold text-slate-900 mb-2">Editar datos fiscales</h3>
      <p className="text-[12.5px] text-slate-600 mb-3">
        Los campos vacíos no se modifican (no pisan el valor previo).
        Los datos no se envían a Holded.
      </p>
      {tenant.holdedConnected && (
        <div className="mb-3 p-2.5 bg-amber-50 border border-amber-200 rounded-lg text-[11.5px] text-amber-900">
          ⚠ Holded está conectado. El sync inicial sólo lo lanza una vez;
          tras él, el fiscalProfile se mantiene tal cual hasta que tú o
          el propietario lo editen. Si modificas algo en Holded, no se
          reflejará aquí automáticamente.
        </div>
      )}
      <label className="block text-[12.5px] font-medium text-slate-700 mb-1.5">
        Razón social
      </label>
      <input
        type="text"
        value={legalName}
        onChange={(e) => setLegalName(e.target.value)}
        placeholder={tenant.name}
        maxLength={200}
        className="w-full h-10 px-3 border border-slate-300 rounded-lg text-[14px] mb-3 focus:outline-none focus:border-slate-500"
      />
      <label className="block text-[12.5px] font-medium text-slate-700 mb-1.5">
        NIF / CIF / NIE
      </label>
      <input
        type="text"
        value={taxId}
        onChange={(e) => setTaxId(e.target.value)}
        placeholder="B12345678"
        maxLength={32}
        className="w-full h-10 px-3 border border-slate-300 rounded-lg text-[14px] mb-3 font-mono focus:outline-none focus:border-slate-500"
      />
      <label className="block text-[12.5px] font-medium text-slate-700 mb-1.5">
        Dirección
      </label>
      <input
        type="text"
        value={address}
        onChange={(e) => setAddress(e.target.value)}
        placeholder="Calle Mayor 12, 28013 Madrid"
        maxLength={300}
        className="w-full h-10 px-3 border border-slate-300 rounded-lg text-[14px] mb-3 focus:outline-none focus:border-slate-500"
      />
      <label className="block text-[12.5px] font-medium text-slate-700 mb-1.5">
        Teléfono
      </label>
      <input
        type="text"
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        placeholder="+34 912 345 678"
        maxLength={32}
        className="w-full h-10 px-3 border border-slate-300 rounded-lg text-[14px] focus:outline-none focus:border-slate-500"
      />
      <div className="flex gap-2 mt-4">
        <button
          onClick={() => onSave({ legalName, taxId, address, phone })}
          disabled={busy}
          className="flex-1 h-10 bg-slate-900 text-white rounded-lg text-[13px] font-medium hover:bg-slate-800 disabled:opacity-50"
        >
          {busy ? "Guardando…" : "Guardar"}
        </button>
        <button
          onClick={onCancel}
          disabled={busy}
          className="flex-1 h-10 border border-slate-300 rounded-lg text-[13px] hover:bg-slate-50"
        >
          Cancelar
        </button>
      </div>
    </Modal>
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

// B-Multi-Vertical: editor inline del tipo de negocio. 3 chips
// pequeños; click dispara PATCH /super-admin/tenants/:id con el
// nuevo businessType. El componente padre actualiza el state local
// vía onChange para evitar refetch completo.
function BusinessTypeEditor({
  tenantId,
  current,
  onChange,
}: {
  tenantId: string;
  current: BusinessType;
  onChange: (bt: BusinessType) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // B-Hardening B · U3: micro-toast inline para el editor. Antes el
  // cambio era silencioso (la chip cambia de estilo y ya) — los
  // implantadores no estaban seguros de si había guardado o no.
  // Mostramos "✓ Guardado" durante 2.5s y luego limpiamos.
  const [savedFlash, setSavedFlash] = useState<string | null>(null);

  async function save(bt: BusinessType): Promise<void> {
    if (bt === current || busy) return;
    setBusy(true);
    setErr(null);
    setSavedFlash(null);
    try {
      await superApi(`/super-admin/tenants/${tenantId}`, {
        method: "PATCH",
        body: { businessType: bt },
      });
      onChange(bt);
      setSavedFlash(`Tipo cambiado a ${BUSINESS_TYPE_LABEL[bt]}`);
      window.setTimeout(() => setSavedFlash(null), 2500);
    } catch (e) {
      setErr(errToHuman(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-1.5">
      <div className="flex gap-1">
        {(["HOSPITALITY", "RETAIL", "SERVICES"] as BusinessType[]).map((bt) => {
          const active = bt === current;
          return (
            <button
              key={bt}
              type="button"
              onClick={() => save(bt)}
              disabled={busy}
              className={
                "px-2.5 py-1 rounded-md text-[12px] font-medium border transition-colors " +
                (active
                  ? "bg-slate-900 text-white border-slate-900"
                  : "bg-white text-slate-700 border-slate-200 hover:border-slate-400 disabled:opacity-50")
              }
            >
              {BUSINESS_TYPE_LABEL[bt]}
            </button>
          );
        })}
      </div>
      {err && <div className="text-[11px] text-red-600">{err}</div>}
      {savedFlash && (
        <div className="text-[11px] text-emerald-700 inline-flex items-center gap-1">
          <Check className="w-3 h-3" />
          {savedFlash}
        </div>
      )}
    </div>
  );
}

// v1.3-Thalia Lote 6 · pie de ticket editable. Vive en su propio panel
// porque conceptualmente es algo del comercio (mensaje al cliente),
// no de los datos fiscales. Textarea con contador 0/200 + vista
// previa monoespacio que aproxima cómo se imprimirá (38 caracteres
// por línea, igual que el renderer del PDF). Botón "Guardar" sólo
// activo si cambió.
const RECEIPT_FOOTER_MAX = 200;
const RECEIPT_FOOTER_LINE = 38;

function ReceiptFooterPanel({
  tenantId,
  current,
  onSaved,
}: {
  tenantId: string;
  current: string | null;
  onSaved: (next: string | null) => void;
}) {
  const [value, setValue] = useState(current ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState<string | null>(null);

  const trimmed = value.trim();
  const nextValue = trimmed === "" ? null : trimmed;
  const dirty = nextValue !== current;

  async function save(): Promise<void> {
    if (busy || !dirty) return;
    setBusy(true);
    setErr(null);
    setSavedFlash(null);
    try {
      await superApi(`/super-admin/tenants/${tenantId}`, {
        method: "PATCH",
        body: { receiptFooter: trimmed },
      });
      onSaved(nextValue);
      setSavedFlash("Pie actualizado. Próximos tickets impresos lo incluirán.");
      window.setTimeout(() => setSavedFlash(null), 4000);
    } catch (e) {
      setErr(errToHuman(e));
    } finally {
      setBusy(false);
    }
  }

  // Vista previa: partimos por líneas (38 chars/linea) igual que el
  // renderer del PDF. No envuelve por palabras — sólo replica el
  // wrap del renderer que sí lo hace, pero como aprox visual basta.
  const previewLines: string[] = [];
  for (const paragraph of trimmed.split(/\n/)) {
    if (paragraph.length === 0) {
      previewLines.push("");
      continue;
    }
    let remaining = paragraph;
    while (remaining.length > RECEIPT_FOOTER_LINE) {
      previewLines.push(remaining.slice(0, RECEIPT_FOOTER_LINE));
      remaining = remaining.slice(RECEIPT_FOOTER_LINE);
    }
    previewLines.push(remaining);
  }

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-6 mb-6">
      <h3 className="font-semibold text-slate-900 mb-2">Pie de ticket</h3>
      <p className="text-[12.5px] text-slate-600 mb-3">
        Texto libre que se imprime al final de cada ticket, entre
        "Gracias por tu visita" y el QR. Útil para condiciones de cambio
        o un mensaje propio del comercio. Vacío = sin pie custom.
      </p>
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value.slice(0, RECEIPT_FOOTER_MAX))}
        rows={3}
        placeholder="Gracias por su compra. Cambios hasta 14 días con ticket."
        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-[14px] focus:outline-none focus:border-slate-500 resize-none"
      />
      <div className="flex items-center justify-between mt-1.5">
        <span className="text-[11.5px] text-slate-500">
          {value.length}/{RECEIPT_FOOTER_MAX}
        </span>
        {trimmed.length > 0 && (
          <span className="text-[11.5px] text-slate-400">Vista previa abajo</span>
        )}
      </div>
      {trimmed.length > 0 && (
        <pre className="mt-3 bg-slate-50 border border-dashed border-slate-300 rounded-lg p-3 text-[12px] font-mono text-slate-700 whitespace-pre overflow-x-auto">
          {previewLines.map((l) => l || " ").join("\n")}
        </pre>
      )}
      <div className="flex items-center gap-2 mt-3">
        <button
          onClick={save}
          disabled={busy || !dirty}
          className="h-9 px-4 bg-slate-900 text-white rounded-lg text-[13px] font-medium hover:bg-slate-800 disabled:opacity-50"
        >
          {busy ? "Guardando…" : current === null ? "Guardar pie" : "Actualizar"}
        </button>
        {savedFlash && (
          <span className="text-[12px] text-emerald-700 inline-flex items-center gap-1">
            <Check className="w-3.5 h-3.5" />
            {savedFlash}
          </span>
        )}
        {err && <span className="text-[12px] text-red-700">{err}</span>}
      </div>
    </div>
  );
}

// v1.3-hotfix6 · panel para elegir el icono placeholder del TPV cuando
// un servicio/producto no tiene imagen. Aplica sobre todo a SERVICES:
// la peluquería ve tijeras, la clínica un estetoscopio, el taller una
// llave inglesa. RETAIL/HOSPITALITY rara vez lo cambian (cafetería ya
// pinta una taza por defecto). Texto libre en BD para permitir añadir
// presets desde el TPV sin migración.
const ICON_PRESETS: Array<{ value: string; label: string; hint: string }> = [
  { value: "", label: "Genérico (según vertical)", hint: "Café · Caja · Maletín, según businessType" },
  { value: "haircut", label: "Peluquería · Tijeras", hint: "Corte, barbería, estética del cabello" },
  { value: "medical", label: "Clínica · Estetoscopio", hint: "Salud, fisioterapia, dental" },
  { value: "auto_repair", label: "Taller · Llave inglesa", hint: "Mecánico, chapa, reparaciones" },
  { value: "beauty", label: "Belleza · Sparkles", hint: "Estética, manicura, spa, masajes" },
  { value: "fitness", label: "Gimnasio · Pesa", hint: "Entrenamiento personal, deporte" },
  { value: "education", label: "Educación · Birrete", hint: "Academia, formación, clases particulares" },
];

function IconPresetPanel({
  tenantId,
  current,
  businessType,
  onSaved,
}: {
  tenantId: string;
  current: string | null;
  businessType: BusinessType;
  onSaved: (next: string | null) => void;
}) {
  const [value, setValue] = useState(current ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState<string | null>(null);

  const nextValue = value === "" ? null : value;
  const dirty = nextValue !== current;

  async function save(): Promise<void> {
    if (busy || !dirty) return;
    setBusy(true);
    setErr(null);
    setSavedFlash(null);
    try {
      await superApi(`/super-admin/tenants/${tenantId}`, {
        method: "PATCH",
        body: { tpvIconPreset: value },
      });
      onSaved(nextValue);
      setSavedFlash("Icono actualizado. El TPV lo verá tras recargar el catálogo.");
      window.setTimeout(() => setSavedFlash(null), 4000);
    } catch (e) {
      setErr(errToHuman(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-6 mb-6">
      <h3 className="font-semibold text-slate-900 mb-2">Icono del catálogo en el TPV</h3>
      <p className="text-[12.5px] text-slate-600 mb-3">
        Cuando un producto o servicio no tiene imagen en Holded, el TPV
        pinta un icono placeholder. Elige el que mejor encaje con el
        negocio del cliente. Aplica sobre todo a cuentas SERVICES
        (peluquería, clínica, taller); en RETAIL/HOSPITALITY el icono
        genérico ya suele bastar.
      </p>
      <select
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="w-full h-10 px-3 rounded-lg border border-slate-300 text-[13.5px] bg-white"
      >
        {ICON_PRESETS.map((p) => (
          <option key={p.value || "default"} value={p.value}>
            {p.label}
          </option>
        ))}
      </select>
      <p className="text-[11.5px] text-slate-500 mt-1.5">
        {ICON_PRESETS.find((p) => p.value === value)?.hint ?? ""}
      </p>
      <p className="text-[11.5px] text-slate-400 mt-1">
        Vertical actual: <strong>{businessType}</strong>.
      </p>
      <div className="mt-4 flex items-center gap-2">
        <button
          onClick={save}
          disabled={busy || !dirty}
          className="h-9 px-4 bg-slate-900 text-white rounded-lg text-[13px] font-medium hover:bg-slate-800 disabled:opacity-50"
        >
          {busy ? "Guardando…" : "Guardar"}
        </button>
        {savedFlash && (
          <span className="text-[12px] text-emerald-700 inline-flex items-center gap-1">
            <Check className="w-3.5 h-3.5" />
            {savedFlash}
          </span>
        )}
        {err && <span className="text-[12px] text-red-700">{err}</span>}
      </div>
    </div>
  );
}

// v1.3-piloto-feedback · Lote 2: cambiar el email del OWNER de un
// tenant activo. Soporta el flow "pre-activar con email controlado y
// entregar al cliente real luego" del equipo de implantación. Sigue el
// patrón inline de ReceiptFooterPanel/IconPresetPanel — sin modal
// pesado, sólo un panel desplegable con confirmación visible antes de
// pulsar.
function TransferOwnerPanel({
  tenantId,
  currentOwnerEmail,
  onTransferred,
}: {
  tenantId: string;
  currentOwnerEmail: string | null;
  onTransferred: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [newName, setNewName] = useState("");
  const [resetPassword, setResetPassword] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<
    | null
    | {
        ownerEmail: string;
        tempPassword?: string;
      }
  >(null);
  const [copiedPwd, setCopiedPwd] = useState(false);

  const trimmedEmail = newEmail.trim().toLowerCase();
  const trimmedName = newName.trim();
  const canSubmit =
    trimmedEmail.length > 0 &&
    /.+@.+\..+/.test(trimmedEmail) &&
    trimmedName.length > 0 &&
    trimmedEmail !== currentOwnerEmail?.toLowerCase();

  async function submit(): Promise<void> {
    if (busy || !canSubmit) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await superApi<{
        ownerId: string;
        ownerEmail: string;
        ownerName: string;
        tempPassword?: string;
      }>(`/super-admin/tenants/${tenantId}/transfer-owner`, {
        method: "POST",
        body: {
          newOwnerEmail: trimmedEmail,
          newOwnerName: trimmedName,
          resetPassword,
        },
      });
      setResult({ ownerEmail: r.ownerEmail, tempPassword: r.tempPassword });
      onTransferred();
    } catch (e) {
      setErr(errToHuman(e));
    } finally {
      setBusy(false);
    }
  }

  async function copyPwd(): Promise<void> {
    if (!result?.tempPassword) return;
    try {
      await navigator.clipboard.writeText(result.tempPassword);
      setCopiedPwd(true);
      setTimeout(() => setCopiedPwd(false), 2500);
    } catch {
      /* clipboard puede fallar */
    }
  }

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-6 mb-6">
      <h3 className="font-semibold text-slate-900 mb-2">Propietario de la cuenta</h3>
      <p className="text-[12.5px] text-slate-600 mb-3">
        Cambia el email del OWNER cuando entregamos la cuenta al cliente
        real (por ejemplo, activaste con un email del equipo y ahora la
        pasas al propietario definitivo). La sesión actual del OWNER se
        invalida automáticamente.
      </p>
      <div className="text-[12.5px] text-slate-700 mb-3">
        OWNER actual: <code className="font-mono">{currentOwnerEmail ?? "—"}</code>
      </div>
      {!open && !result && (
        <button
          onClick={() => setOpen(true)}
          className="h-9 px-4 bg-slate-900 text-white rounded-lg text-[13px] font-medium hover:bg-slate-800"
        >
          Cambiar propietario
        </button>
      )}
      {open && !result && (
        <>
          <label className="block text-[12.5px] font-medium text-slate-700 mb-1.5 mt-2">
            Nuevo email <span className="text-red-500">*</span>
          </label>
          <input
            type="email"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            placeholder="cliente@negocio.es"
            className="w-full h-11 px-3 border border-slate-300 rounded-lg text-[14px] mb-3 focus:outline-none focus:border-slate-500"
          />
          <label className="block text-[12.5px] font-medium text-slate-700 mb-1.5">
            Nombre <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="María Pérez"
            maxLength={200}
            className="w-full h-11 px-3 border border-slate-300 rounded-lg text-[14px] mb-3 focus:outline-none focus:border-slate-500"
          />
          <label className="flex items-center gap-2 text-[12.5px] text-slate-700 mb-3">
            <input
              type="checkbox"
              checked={resetPassword}
              onChange={(e) => setResetPassword(e.target.checked)}
              className="rounded border-slate-300"
            />
            Enviar email con nueva contraseña al nuevo propietario
          </label>
          <div className="text-[12px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3 mb-3">
            Esto invalida la sesión actual del propietario en admin y TPV.
            {resetPassword
              ? " Se generará una nueva contraseña temporal."
              : " La contraseña actual sigue siendo válida tras el cambio."}
          </div>
          <div className="flex gap-2">
            <button
              onClick={submit}
              disabled={busy || !canSubmit}
              className="h-9 px-4 bg-emerald-600 text-white rounded-lg text-[13px] font-medium hover:bg-emerald-700 disabled:opacity-50"
            >
              {busy ? "Cambiando…" : "Confirmar cambio"}
            </button>
            <button
              onClick={() => {
                setOpen(false);
                setNewEmail("");
                setNewName("");
                setErr(null);
              }}
              disabled={busy}
              className="h-9 px-4 border border-slate-300 rounded-lg text-[13px] hover:bg-slate-50"
            >
              Cancelar
            </button>
          </div>
          {err && (
            <div className="mt-3 text-[12px] text-red-700 bg-red-50 border border-red-200 rounded-lg p-2.5">
              {err}
            </div>
          )}
        </>
      )}
      {result && (
        <div className="mt-1 p-4 bg-emerald-50 border border-emerald-200 rounded-lg">
          <div className="flex items-center gap-2 mb-2">
            <Check className="w-4 h-4 text-emerald-700" />
            <span className="text-[13px] font-medium text-emerald-900">
              Propietario cambiado a <code className="font-mono">{result.ownerEmail}</code>
            </span>
          </div>
          {result.tempPassword && (
            <>
              <div className="text-[12px] uppercase tracking-wide text-emerald-700 mb-1 mt-2">
                Nueva contraseña temporal
              </div>
              <div className="flex items-center gap-2">
                <code className="font-mono bg-slate-900 text-white rounded-lg px-3 py-2 text-[14px] tracking-wide">
                  {result.tempPassword}
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
                Sólo se muestra una vez. Si el email no llega, pásasela al
                cliente por canal seguro.
              </p>
            </>
          )}
          <button
            onClick={() => {
              setResult(null);
              setOpen(false);
              setNewEmail("");
              setNewName("");
            }}
            className="mt-3 h-9 px-4 border border-slate-300 rounded-lg text-[13px] hover:bg-slate-50"
          >
            Hecho
          </button>
        </div>
      )}
    </div>
  );
}

// v1.3-SuperAdmin-Hub Lote 3 · panel para editar el id del panel Holded
// del cliente. El implantador suele teclearlo al crear, pero a veces
// se equivoca o lo pega con la URL entera; este panel le permite
// corregirlo sin tener que crear el tenant de cero. Si está vacío en
// BD (tenants antiguos sin backfill), pintamos un aviso amarillo para
// que el implantador sepa que falta — el hub depende de este campo
// para enlazar a Holded directamente.
function HoldedAccountIdPanel({
  tenantId,
  current,
  onSaved,
}: {
  tenantId: string;
  current: string | null;
  onSaved: (next: string | null) => void;
}) {
  const [value, setValue] = useState(current ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState<string | null>(null);

  // Mismo helper que en CreateTenantPage: extrae el id si pegan la URL
  // completa, recorta espacios y trailing "/". Lo hacemos en el
  // onSubmit, no en cada keystroke, para no sobreescribir lo que el
  // implantador está tecleando manualmente.
  function normalize(raw: string): string {
    const match = raw.match(/accounts\/([^/?#]+)/i);
    if (match && match[1]) return match[1];
    return raw.trim().replace(/\/+$/, "");
  }

  const normalized = normalize(value);
  const nextValue = normalized === "" ? null : normalized;
  const dirty = nextValue !== current;
  const deepLink = current
    ? `https://app.holded.com/accounts/${encodeURIComponent(current)}`
    : null;

  async function save(): Promise<void> {
    if (busy || !dirty) return;
    setBusy(true);
    setErr(null);
    setSavedFlash(null);
    try {
      await superApi(`/super-admin/tenants/${tenantId}`, {
        method: "PATCH",
        body: { holdedAccountId: normalized },
      });
      onSaved(nextValue);
      // Sincronizamos input con valor persistido (por si normalize
      // recortó algo respecto a lo tecleado).
      setValue(normalized);
      setSavedFlash("ID Holded actualizado.");
      window.setTimeout(() => setSavedFlash(null), 3000);
    } catch (e) {
      setErr(errToHuman(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-6 mb-6">
      <h3 className="font-semibold text-slate-900 mb-2">ID de cuenta Holded</h3>
      <p className="text-[12.5px] text-slate-600 mb-3">
        Lo encuentras en la URL del panel Holded del cliente
        (<code className="font-mono">app.holded.com/accounts/<strong>&lt;id&gt;</strong>/…</code>).
        El hub usa este id para abrir Holded directamente. Puedes pegar
        la URL completa: recortamos al id automáticamente.
      </p>
      {current === null && (
        <div className="mb-3 p-2.5 bg-amber-50 border border-amber-200 rounded-lg text-[11.5px] text-amber-900">
          ⚠ Sin ID de cuenta. El hub no podrá enlazar al panel Holded
          de este cliente hasta que lo añadas.
        </div>
      )}
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        maxLength={300}
        autoComplete="off"
        spellCheck={false}
        placeholder="65f1234567890abcdef… o pega la URL completa"
        className="w-full h-10 px-3 border border-slate-300 rounded-lg text-[14px] font-mono focus:outline-none focus:border-slate-500"
      />
      {/* Si lo tecleado se va a normalizar a un valor distinto, lo
          mostramos en pequeñito para que el implantador vea qué se
          guardará realmente. */}
      {value.trim().length > 0 && normalized !== value.trim() && (
        <p className="text-[11.5px] text-slate-500 mt-1.5">
          Se guardará como: <code className="font-mono">{normalized}</code>
        </p>
      )}
      <div className="flex items-center gap-2 mt-3 flex-wrap">
        <button
          onClick={save}
          disabled={busy || !dirty || normalized.length === 0}
          className="h-9 px-4 bg-slate-900 text-white rounded-lg text-[13px] font-medium hover:bg-slate-800 disabled:opacity-50"
        >
          {busy ? "Guardando…" : current === null ? "Guardar ID" : "Actualizar"}
        </button>
        {deepLink && (
          <a
            href={deepLink}
            target="_blank"
            rel="noopener noreferrer"
            className="h-9 px-3 inline-flex items-center gap-1.5 border border-slate-300 rounded-lg text-[12.5px] text-slate-700 hover:bg-slate-50"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            Abrir en Holded
          </a>
        )}
        {savedFlash && (
          <span className="text-[12px] text-emerald-700 inline-flex items-center gap-1">
            <Check className="w-3.5 h-3.5" />
            {savedFlash}
          </span>
        )}
        {err && <span className="text-[12px] text-red-700">{err}</span>}
      </div>
    </div>
  );
}

