import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Plus, Search } from "lucide-react";

import { superApi, SuperAdminApiError } from "./api.js";
import { SuperAdminShell } from "./SuperAdminShell.js";
import type { TenantListItem, TenantListResponse } from "./types.js";

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
    <SuperAdminShell title="Tenants">
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
          <Plus className="w-4 h-4" /> Crear tenant
        </Link>
      </div>

      {loading ? (
        <div className="text-slate-500 text-[13.5px]">Cargando…</div>
      ) : error ? (
        <div className="text-red-600 text-[13.5px]">{error}</div>
      ) : items.length === 0 ? (
        <div className="text-slate-500 text-[13.5px]">No hay tenants.</div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full text-[13px]">
            <thead className="bg-slate-50 text-slate-600 text-[11.5px] uppercase tracking-wide">
              <tr>
                <th className="text-left px-4 py-3 font-medium">Tenant</th>
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
                    <div className="text-[11.5px] text-slate-500">
                      {t.fiscalNif ?? "Sin NIF"}
                      {t.plan ? ` · ${t.plan}` : ""}
                    </div>
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
                    {t.holdedConnected ? (
                      <span className="text-emerald-700 text-[12px]">Conectado</span>
                    ) : (
                      <span className="text-slate-400 text-[12px]">Sin conectar</span>
                    )}
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
