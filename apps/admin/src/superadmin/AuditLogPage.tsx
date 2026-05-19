import { useEffect, useState } from "react";

import { superApi, SuperAdminApiError } from "./api.js";
import { SuperAdminShell } from "./SuperAdminShell.js";
import type { AuditLogItem, AuditLogResponse } from "./types.js";

const ACTIONS = [
  { value: "", label: "Todas" },
  { value: "create_tenant", label: "Crear cuenta" },
  { value: "update_tenant", label: "Editar cuenta" },
  { value: "block_tenant", label: "Bloquear" },
  { value: "unblock_tenant", label: "Desbloquear" },
  { value: "force_logout", label: "Force logout" },
  { value: "resync", label: "Resync" },
  { value: "impersonate", label: "Impersonar" },
];

export function AuditLogPage() {
  const [items, setItems] = useState<AuditLogItem[]>([]);
  const [action, setAction] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load(): Promise<void> {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        if (action) params.set("action", action);
        const res = await superApi<AuditLogResponse>(
          `/super-admin/audit${params.toString() ? `?${params}` : ""}`,
        );
        if (!cancelled) setItems(res.items);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof SuperAdminApiError ? err.message : "Error inesperado");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [action]);

  return (
    <SuperAdminShell title="Auditoría">
      <div className="flex items-center gap-3 mb-5">
        <select
          value={action}
          onChange={(e) => setAction(e.target.value)}
          className="h-10 px-3 border border-slate-300 rounded-lg text-[13px] bg-white"
        >
          {ACTIONS.map((a) => (
            <option key={a.value} value={a.value}>
              {a.label}
            </option>
          ))}
        </select>
      </div>

      {loading ? (
        <div className="text-slate-500 text-[13.5px]">Cargando…</div>
      ) : error ? (
        <div className="text-red-600 text-[13.5px]">{error}</div>
      ) : items.length === 0 ? (
        <div className="text-slate-500 text-[13.5px]">Sin entradas.</div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full text-[13px]">
            <thead className="bg-slate-50 text-slate-600 text-[11.5px] uppercase">
              <tr>
                <th className="text-left px-4 py-3 font-medium">Cuándo</th>
                <th className="text-left px-4 py-3 font-medium">Acción</th>
                <th className="text-left px-4 py-3 font-medium">Super-admin</th>
                <th className="text-left px-4 py-3 font-medium">Tenant</th>
                <th className="text-left px-4 py-3 font-medium">Metadata</th>
              </tr>
            </thead>
            <tbody>
              {items.map((row) => (
                <tr key={row.id} className="border-t border-slate-100 align-top">
                  <td className="px-4 py-3 text-slate-600 whitespace-nowrap">
                    {new Date(row.createdAt).toLocaleString()}
                  </td>
                  <td className="px-4 py-3 font-medium text-slate-900">
                    {row.action}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {row.superAdminEmail}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {row.tenantId
                      ? row.tenantId.slice(0, 8) + "…"
                      : "—"}
                  </td>
                  <td className="px-4 py-3 text-slate-500 max-w-md">
                    <code className="text-[11.5px] whitespace-pre-wrap break-all">
                      {row.metadata ? JSON.stringify(row.metadata, null, 0) : ""}
                    </code>
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
