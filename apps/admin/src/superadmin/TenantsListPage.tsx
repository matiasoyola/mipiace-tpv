import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Plus, Search } from "lucide-react";

import { superApi, SuperAdminApiError } from "./api.js";
import { SuperAdminShell } from "./SuperAdminShell.js";
import type {
  HoldedConnectionStatus,
  TenantListItem,
  TenantListResponse,
} from "./types.js";
import { BUSINESS_TYPE_LABEL } from "./types.js";

function StatusBadge({ state }: { state: "ok" | "warning" | "blocked" }) {
  const cls =
    state === "blocked"
      ? "bg-red-100 text-red-700 border-red-200"
      : state === "warning"
        ? "bg-amber-100 text-amber-700 border-amber-200"
        : "bg-emerald-100 text-emerald-700 border-emerald-200";
  const label =
    state === "blocked" ? "Bloqueado" : state === "warning" ? "Atención" : "OK";
  return (
    <span
      className={
        "inline-flex items-center px-2 py-0.5 rounded-md text-[11.5px] font-medium border " +
        cls
      }
    >
      {label}
    </span>
  );
}

// v1.9.1 · badge de la columna HOLDED. Antes era un boolean (key
// guardada sí/no) que mostraba "Conectado" con la suscripción de Holded
// suspendida por impago (caso Thalia, HTTP 402). SUSPENDED va en rojo
// con badge porque el sync está parado y requiere acción del cliente.
function HoldedBadge({ status }: { status: HoldedConnectionStatus }) {
  if (status === "SUSPENDED") {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11.5px] font-medium border bg-red-100 text-red-700 border-red-200">
        Suscripción suspendida
      </span>
    );
  }
  if (status === "ERROR") {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11.5px] font-medium border bg-amber-100 text-amber-700 border-amber-200">
        Error de sync
      </span>
    );
  }
  if (status === "CONNECTED") {
    return <span className="text-emerald-700 text-[12px]">Conectado</span>;
  }
  return <span className="text-slate-400 text-[12px]">Sin conectar</span>;
}

// B-OnboardingV2: badge del onboardingState + flag ready. Cuando un
// tenant DRAFT pasa la heurística de salud, lo marcamos en ámbar
// "Listo para activar"; mientras no, gris "En configuración". Tenants
// ACTIVE se ven en verde "Operativo".
function OnboardingBadge({
  state,
  ready,
}: {
  state: "DRAFT" | "ACTIVE";
  ready: boolean | null;
}) {
  if (state === "ACTIVE") {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11.5px] font-medium border bg-emerald-100 text-emerald-700 border-emerald-200">
        Operativo
      </span>
    );
  }
  if (ready) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11.5px] font-medium border bg-amber-100 text-amber-800 border-amber-200">
        Listo para activar
      </span>
    );
  }
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11.5px] font-medium border bg-slate-100 text-slate-600 border-slate-200">
      En configuración
    </span>
  );
}

export function TenantsListPage() {
  const [items, setItems] = useState<TenantListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"" | "ok" | "warning" | "blocked">("");

  useEffect(() => {
    let cancelled = false;
    async function load(): Promise<void> {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        if (search.trim()) params.set("q", search.trim());
        if (statusFilter) params.set("status", statusFilter);
        const res = await superApi<TenantListResponse>(
          `/super-admin/tenants${params.toString() ? `?${params}` : ""}`,
        );
        if (!cancelled) setItems(res.items);
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof SuperAdminApiError ? err.message : "Error inesperado",
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    const t = setTimeout(load, search.length > 0 ? 300 : 0);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [search, statusFilter]);

  return (
    <SuperAdminShell title="Cuentas">
      <div className="flex items-center gap-3 mb-6">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nombre o email del OWNER"
            className="w-full h-10 pl-10 pr-3 border border-slate-300 rounded-lg text-[13.5px] focus:outline-none focus:border-slate-500"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
          className="h-10 px-3 border border-slate-300 rounded-lg text-[13px] bg-white"
        >
          <option value="">Todos</option>
          <option value="ok">OK</option>
          <option value="warning">Atención</option>
          <option value="blocked">Bloqueados</option>
        </select>
        <Link
          to="/superadmin/tenants/new"
          className="ml-auto inline-flex items-center gap-1.5 h-10 px-4 bg-slate-900 text-white rounded-lg text-[13px] font-medium hover:bg-slate-800"
        >
          <Plus className="w-4 h-4" /> Crear cuenta
        </Link>
      </div>

      {loading ? (
        <div className="text-slate-500 text-[13.5px]">Cargando…</div>
      ) : error ? (
        <div className="text-red-600 text-[13.5px]">{error}</div>
      ) : items.length === 0 ? (
        <div className="text-slate-500 text-[13.5px]">No hay cuentas.</div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full text-[13px]">
            <thead className="bg-slate-50 text-slate-600 text-[11.5px] uppercase tracking-wide">
              <tr>
                <th className="text-left px-4 py-3 font-medium">Cuenta</th>
                <th className="text-left px-4 py-3 font-medium">Onboarding</th>
                <th className="text-left px-4 py-3 font-medium">Owner</th>
                <th className="text-left px-4 py-3 font-medium">Holded</th>
                <th className="text-left px-4 py-3 font-medium">7d</th>
                <th className="text-left px-4 py-3 font-medium">Errores</th>
                <th className="text-left px-4 py-3 font-medium">Estado</th>
              </tr>
            </thead>
            <tbody>
              {items.map((t) => (
                <tr key={t.id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <Link
                      to={`/superadmin/tenants/${t.id}`}
                      className="font-medium text-slate-900 hover:text-slate-700"
                    >
                      {t.name}
                    </Link>
                    {/* B-Hardening A · U11: tipo de negocio como chip
                        compacto bajo el nombre. Permite identificar
                        de un vistazo cuáles son hostelería/retail/
                        servicios sin añadir columna nueva. */}
                    <div className="text-[11.5px] text-slate-500 flex items-center gap-1.5 mt-0.5">
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 font-medium text-[10.5px]">
                        {BUSINESS_TYPE_LABEL[t.businessType]}
                      </span>
                      <span>·</span>
                      <span>
                        {t.fiscalNif ?? "Sin NIF"}
                        {t.plan ? ` · ${t.plan}` : ""}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <OnboardingBadge state={t.onboardingState} ready={t.onboardingReady} />
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {t.ownerEmail ?? "—"}
                    {t.ownerLastLoginAt && (
                      <div className="text-[11.5px] text-slate-400">
                        Último login: {new Date(t.ownerLastLoginAt).toLocaleDateString()}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <HoldedBadge status={t.holdedStatus} />
                  </td>
                  <td className="px-4 py-3 tabular-nums">{t.metrics.ticketsLast7d}</td>
                  <td className="px-4 py-3">
                    {t.metrics.ticketsSyncFailed > 0 || t.metrics.ticketsEmailFailed > 0 ? (
                      <span className="text-amber-700 text-[12px]">
                        {t.metrics.ticketsSyncFailed} sync · {t.metrics.ticketsEmailFailed} email
                      </span>
                    ) : (
                      <span className="text-slate-400 text-[12px]">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge state={t.metrics.degraded.state} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </SuperAdminShell>
  );
}
