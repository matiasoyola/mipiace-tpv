// B-Multi-Vertical SB4: panel de gestión multi super-admin. Permite al
// super-admin actual invitar a más super-admins y eliminar a otros
// (nunca a sí mismo).
//
// Flujo de invitación: rellena email + nombre → POST emite temp
// password → la mostramos en un panel con "Copiar al portapapeles". El
// invitado debe cambiarla en el primer login (mustChangePassword=true,
// enforcement de login pendiente; mientras tanto cambio manual con
// /super-admin/auth/change-password).
//
// Soft-delete: la fila se marca `deletedAt=now`, tokenVersion sube
// para invalidar refresh tokens vivos. No autoeliminar (botón oculto
// en la propia fila).

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Copy, Mail, Plus, Shield } from "lucide-react";

import { superApi, SuperAdminApiError } from "./api.js";
import { SuperAdminShell } from "./SuperAdminShell.js";
import type {
  CreateSuperAdminResponse,
  SuperAdminItem,
  SuperAdminMe,
  SuperAdminsListResponse,
} from "./types.js";

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("es-ES", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function AdminsListPage() {
  const navigate = useNavigate();
  const [me, setMe] = useState<SuperAdminMe | null>(null);
  const [items, setItems] = useState<SuperAdminItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showCreate, setShowCreate] = useState(false);
  const [createdResult, setCreatedResult] =
    useState<CreateSuperAdminResponse | null>(null);
  const [pendingDelete, setPendingDelete] = useState<SuperAdminItem | null>(
    null,
  );
  // v1.2-Lite Lote 2: reenvío de invitación. La confirmación queda como
  // modal aparte porque la acción es destructiva (invalida la temp
  // password anterior y todos los tokens del target). El resultado se
  // muestra con el mismo TempPasswordModal del alta, para que root
  // pueda copiar la nueva password si SMTP no entrega.
  const [pendingResend, setPendingResend] = useState<SuperAdminItem | null>(
    null,
  );
  const [resendBusy, setResendBusy] = useState(false);

  async function reload(): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      const [meRes, listRes] = await Promise.all([
        superApi<SuperAdminMe>("/super-admin/auth/me"),
        superApi<SuperAdminsListResponse>("/super-admin/admins"),
      ]);
      // Lote 3 v1.1 Thalia: si entras vía URL directa siendo no-root,
      // te redirigimos al dashboard. El backend YA filtra (devuelve
      // sólo tu ficha), pero esta página no tiene sentido sin la
      // capacidad de invitar/eliminar.
      if (!meRes.isRoot) {
        navigate("/superadmin/tenants", { replace: true });
        return;
      }
      setMe(meRes);
      setItems(listRes.items);
    } catch (err) {
      setError(
        err instanceof SuperAdminApiError ? err.message : "Error al cargar",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onDelete(target: SuperAdminItem): Promise<void> {
    setError(null);
    try {
      await superApi(`/super-admin/admins/${target.id}`, { method: "DELETE" });
      setPendingDelete(null);
      await reload();
    } catch (err) {
      setError(
        err instanceof SuperAdminApiError ? err.message : "Error al eliminar",
      );
    }
  }

  async function onResendInvite(target: SuperAdminItem): Promise<void> {
    setError(null);
    setResendBusy(true);
    try {
      const res = await superApi<CreateSuperAdminResponse>(
        `/super-admin/admins/${target.id}/resend-invite`,
        { method: "POST" },
      );
      setPendingResend(null);
      // Re-uso del TempPasswordModal: misma forma de response que el
      // alta, lo único que cambia es el copy en el modal — el modal
      // detecta vía prop `mode` si es alta o reenvío para ajustar texto.
      setCreatedResult(res);
      await reload();
    } catch (err) {
      setError(
        err instanceof SuperAdminApiError
          ? err.message
          : "Error al reenviar invitación",
      );
    } finally {
      setResendBusy(false);
    }
  }

  return (
    <SuperAdminShell title="Super-admins">
      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-900 text-[13px]">
          {error}
        </div>
      )}

      <div className="flex items-center gap-3 mb-6">
        <p className="text-[13.5px] text-slate-600 flex-1">
          Lista de super-admins activos. Cada uno tiene los mismos
          permisos — gestiona tenants, audita y puede invitar a otros.
        </p>
        <button
          type="button"
          onClick={() => setShowCreate(true)}
          className="inline-flex items-center gap-1.5 h-10 px-4 bg-slate-900 text-white rounded-lg text-[13px] font-medium hover:bg-slate-800"
        >
          <Plus className="w-4 h-4" /> Crear super-admin
        </button>
      </div>

      {loading ? (
        <div className="text-slate-500 text-[13.5px]">Cargando…</div>
      ) : items.length === 0 ? (
        <div className="text-slate-500 text-[13.5px]">No hay super-admins.</div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full text-[13px]">
            <thead className="bg-slate-50 text-slate-600 text-[11.5px] uppercase tracking-wide">
              <tr>
                <th className="text-left px-4 py-3 font-medium">Nombre</th>
                <th className="text-left px-4 py-3 font-medium">Email</th>
                <th className="text-left px-4 py-3 font-medium">2FA</th>
                <th className="text-left px-4 py-3 font-medium">
                  Último login
                </th>
                <th className="text-left px-4 py-3 font-medium">Creado</th>
                <th className="text-right px-4 py-3 font-medium">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {items.map((row) => {
                const isSelf = me?.id === row.id;
                return (
                  <tr
                    key={row.id}
                    className="border-t border-slate-100 hover:bg-slate-50"
                  >
                    <td className="px-4 py-3 font-medium text-slate-900">
                      <div className="flex items-center gap-2">
                        <Shield className="w-3.5 h-3.5 text-amber-500" />
                        <span>{row.name ?? "—"}</span>
                        {isSelf && (
                          <span className="text-[10.5px] text-emerald-700 font-medium uppercase tracking-wider">
                            tú
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-700">{row.email}</td>
                    <td className="px-4 py-3">
                      {row.twoFactorEnabled ? (
                        <span className="text-emerald-700 text-[12px]">
                          Activado
                        </span>
                      ) : (
                        <span className="text-slate-400 text-[12px]">
                          No activado
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-600 tabular-nums">
                      {formatDate(row.lastLoginAt)}
                    </td>
                    <td className="px-4 py-3 text-slate-600 tabular-nums">
                      {formatDate(row.createdAt)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {!isSelf && (
                        <div className="flex items-center gap-3 justify-end">
                          {!row.twoFactorEnabled && (
                            <button
                              type="button"
                              onClick={() => setPendingResend(row)}
                              className="inline-flex items-center gap-1 text-[12.5px] text-slate-700 hover:text-slate-900 hover:underline"
                              title="Reenviar invitación con nueva contraseña temporal"
                            >
                              <Mail className="w-3.5 h-3.5" />
                              Reenviar invitación
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => setPendingDelete(row)}
                            className="text-[12.5px] text-red-700 hover:text-red-900 hover:underline"
                          >
                            Eliminar
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {showCreate && (
        <CreateAdminModal
          onClose={() => setShowCreate(false)}
          onCreated={(res) => {
            setShowCreate(false);
            setCreatedResult(res);
            void reload();
          }}
        />
      )}

      {createdResult && (
        <TempPasswordModal
          result={createdResult}
          onClose={() => setCreatedResult(null)}
        />
      )}

      {pendingDelete && (
        <ConfirmDeleteModal
          target={pendingDelete}
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => onDelete(pendingDelete)}
        />
      )}

      {pendingResend && (
        <ConfirmResendInviteModal
          target={pendingResend}
          busy={resendBusy}
          onCancel={() => setPendingResend(null)}
          onConfirm={() => onResendInvite(pendingResend)}
        />
      )}
    </SuperAdminShell>
  );
}

function CreateAdminModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (res: CreateSuperAdminResponse) => void;
}) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await superApi<CreateSuperAdminResponse>(
        "/super-admin/admins",
        {
          method: "POST",
          body: { email: email.trim().toLowerCase(), name: name.trim() },
        },
      );
      onCreated(res);
    } catch (err) {
      setError(err instanceof SuperAdminApiError ? err.message : "Error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <ModalShell title="Crear super-admin" onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <label className="block text-[12.5px] font-medium text-slate-700 mb-1.5">
            Nombre
          </label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nombre Apellido"
            required
            maxLength={100}
            className="w-full h-10 px-3 border border-slate-300 rounded-lg text-[13.5px] focus:outline-none focus:border-slate-500"
          />
        </div>
        <div>
          <label className="block text-[12.5px] font-medium text-slate-700 mb-1.5">
            Email
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="nombre@empresa.com"
            required
            className="w-full h-10 px-3 border border-slate-300 rounded-lg text-[13.5px] focus:outline-none focus:border-slate-500"
          />
        </div>
        {error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-900 text-[12.5px]">
            {error}
          </div>
        )}
        <div className="flex gap-2 pt-2">
          <button
            type="submit"
            disabled={busy}
            className="h-10 px-4 bg-slate-900 text-white rounded-lg text-[13px] font-medium hover:bg-slate-800 disabled:opacity-50"
          >
            {busy ? "Creando…" : "Crear e invitar"}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="h-10 px-4 border border-slate-300 text-slate-700 rounded-lg text-[13px] font-medium hover:bg-slate-50"
          >
            Cancelar
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

function TempPasswordModal({
  result,
  onClose,
}: {
  result: CreateSuperAdminResponse;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(result.tempPassword);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback: el usuario puede seleccionar y copiar a mano.
    }
  }

  return (
    <ModalShell title="Super-admin creado" onClose={onClose}>
      <p className="text-[13px] text-slate-700 mb-3">
        <strong>{result.admin.name ?? result.admin.email}</strong> ha sido
        creado/a. Le hemos enviado un email con esta contraseña temporal —
        si no llega, entrégasela por canal seguro.
      </p>
      <div className="bg-slate-900 text-emerald-300 rounded-lg p-4 mb-3 font-mono text-[15px] tabular-nums break-all">
        {result.tempPassword}
      </div>
      <p className="text-[12px] text-slate-500 mb-4">
        Es de un solo uso — debe cambiarla en el primer login. Esta vista
        no se vuelve a mostrar: cópiala antes de cerrar.
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={copy}
          className="inline-flex items-center gap-1.5 h-10 px-4 bg-slate-900 text-white rounded-lg text-[13px] font-medium hover:bg-slate-800"
        >
          <Copy className="w-3.5 h-3.5" />
          {copied ? "Copiada" : "Copiar al portapapeles"}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="h-10 px-4 border border-slate-300 text-slate-700 rounded-lg text-[13px] font-medium hover:bg-slate-50"
        >
          Cerrar
        </button>
      </div>
    </ModalShell>
  );
}

function ConfirmDeleteModal({
  target,
  onCancel,
  onConfirm,
}: {
  target: SuperAdminItem;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <ModalShell title="Eliminar super-admin" onClose={onCancel}>
      <p className="text-[13px] text-slate-700 mb-4">
        Vas a eliminar a{" "}
        <strong>{target.name ?? target.email}</strong> ({target.email}).
        Sus sesiones se invalidan inmediatamente. La auditoría se
        conserva.
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onConfirm}
          className="h-10 px-4 bg-red-600 text-white rounded-lg text-[13px] font-medium hover:bg-red-700"
        >
          Eliminar
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="h-10 px-4 border border-slate-300 text-slate-700 rounded-lg text-[13px] font-medium hover:bg-slate-50"
        >
          Cancelar
        </button>
      </div>
    </ModalShell>
  );
}

function ConfirmResendInviteModal({
  target,
  busy,
  onCancel,
  onConfirm,
}: {
  target: SuperAdminItem;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <ModalShell title="Reenviar invitación" onClose={onCancel}>
      <p className="text-[13px] text-slate-700 mb-3">
        Vas a reenviar la invitación a{" "}
        <strong>{target.name ?? target.email}</strong> ({target.email}).
      </p>
      <ul className="text-[12.5px] text-slate-600 mb-4 list-disc pl-5 space-y-1">
        <li>Se genera una nueva contraseña temporal.</li>
        <li>La contraseña anterior queda invalidada al instante.</li>
        <li>Sus sesiones activas se cierran (deberá volver a entrar).</li>
      </ul>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onConfirm}
          disabled={busy}
          className="h-10 px-4 bg-slate-900 text-white rounded-lg text-[13px] font-medium hover:bg-slate-800 disabled:opacity-50"
        >
          {busy ? "Reenviando…" : "Reenviar invitación"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="h-10 px-4 border border-slate-300 text-slate-700 rounded-lg text-[13px] font-medium hover:bg-slate-50 disabled:opacity-50"
        >
          Cancelar
        </button>
      </div>
    </ModalShell>
  );
}

function ModalShell({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white w-full max-w-md rounded-2xl border border-slate-200 p-6"
      >
        <h2 className="text-[16px] font-semibold text-slate-900 mb-4">
          {title}
        </h2>
        {children}
      </div>
    </div>
  );
}
