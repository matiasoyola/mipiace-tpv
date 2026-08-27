// Bloque soporte-cajeros-superadmin · panel de la ficha de tenant.
//
// La llamada de soporte más frecuente de un TPV es "no puedo entrar".
// Este panel la contesta sin abrir una sesión de OWNER: quién está dado
// de alta, con qué alias, si puede entrar, y cuándo entró por última
// vez.
//
// Es de LECTURA. No hay botón de resetear PIN aquí y no se le ha
// olvidado a nadie: cambiar el PIN de un cajero es decisión del OWNER y
// se hace desde su sesión. La frase del panel lo dice para que el de
// soporte no se quede buscando un botón que no existe.

import { useEffect, useState } from "react";
import { FlaskConical, RefreshCw } from "lucide-react";

import { superApi, SuperAdminApiError } from "./api.js";
import { humanizeError } from "./error-messages.js";
import type {
  CashierAccessStatus,
  TenantCashier,
  TenantCashiersResponse,
} from "./types.js";

// Mismo criterio que TenantDetailPage: SuperAdminApiError trae el code
// de la API y lo humanizamos; cualquier otra cosa cae al mensaje crudo
// o al fallback.
function errToHuman(err: unknown): string {
  if (err instanceof SuperAdminApiError) {
    return humanizeError({ error: err.code, message: err.message });
  }
  if (err instanceof Error) return err.message;
  return humanizeError(err);
}

const CASHIER_STATUS_LABEL: Record<CashierAccessStatus, string> = {
  ACTIVE: "Puede entrar",
  NO_PIN: "Sin PIN",
  REVOKED: "Dado de baja",
};

const CASHIER_STATUS_CLS: Record<CashierAccessStatus, string> = {
  ACTIVE: "bg-emerald-50 text-emerald-800 border-emerald-200",
  NO_PIN: "bg-amber-50 text-amber-900 border-amber-200",
  REVOKED: "bg-slate-100 text-slate-500 border-slate-200",
};

const CASHIER_ROLE_LABEL: Record<TenantCashier["role"], string> = {
  OWNER: "Propietario",
  MANAGER: "Encargado",
  CASHIER: "Cajero",
};

// Las fechas se dicen ENTERAS. Nada de "hace 3 días" sobre algo de
// julio: ese error ya lo hemos pagado dos veces. "23 de julio de 2026,
// 9:04" se lee por teléfono tal cual y cierra la llamada.
function fullDateTime(iso: string): string {
  return new Date(iso).toLocaleString("es-ES", {
    dateStyle: "long",
    timeStyle: "short",
  });
}

export function CashiersPanel({ tenantId }: { tenantId: string }) {
  const [data, setData] = useState<TenantCashiersResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  async function load(): Promise<void> {
    setLoading(true);
    setErr(null);
    try {
      setData(
        await superApi<TenantCashiersResponse>(
          `/super-admin/tenants/${tenantId}/cashiers`,
        ),
      );
    } catch (e) {
      setErr(errToHuman(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  const cashiers = data?.cashiers ?? [];

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-6 mb-6">
      <div className="flex items-start justify-between gap-4 mb-2">
        <h3 className="font-semibold text-slate-900">
          Cajeros{data ? ` (${cashiers.length})` : ""}
        </h3>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="flex items-center gap-1.5 text-[12px] text-slate-600 hover:text-slate-900 disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          Actualizar
        </button>
      </div>

      <p className="text-[12.5px] text-slate-600 mb-4">
        Quién puede entrar en las cajas de esta cuenta y cuándo entró por
        última vez. <strong>El PIN no se muestra ni se cambia desde aquí</strong>
        {" "}— si un cajero lo ha perdido, se lo cambia el propietario desde su
        sesión. Cada consulta queda registrada en la auditoría.
      </p>

      {err && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-[12.5px] text-red-800">
          {err}
        </div>
      )}

      {!err && loading && !data && (
        <p className="text-[12.5px] text-slate-500">Cargando cajeros…</p>
      )}

      {!err && data && cashiers.length === 0 && (
        <p className="text-[12.5px] text-slate-500">
          Esta cuenta no tiene ningún cajero dado de alta todavía. Los crea
          el propietario desde su panel.
        </p>
      )}

      {!err && cashiers.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead className="text-slate-500 text-[11.5px] uppercase">
              <tr>
                <th className="text-left py-2">Alias</th>
                <th className="text-left py-2">Email (con el que entra)</th>
                <th className="text-left py-2">Rol</th>
                <th className="text-left py-2">Estado</th>
                <th className="text-left py-2">Último acceso</th>
              </tr>
            </thead>
            <tbody>
              {cashiers.map((c) => (
                <tr
                  key={c.id}
                  className={`border-t border-slate-100 align-top ${
                    c.status === "REVOKED" ? "text-slate-400" : ""
                  }`}
                >
                  <td className="py-2.5 pr-3">
                    {/* Los alias largos se recortan con ellipsis y el
                        completo queda en el title — la tabla no se
                        descuadra por un "matias.oyola.sanchez". */}
                    <div
                      className="max-w-[180px] truncate font-medium"
                      title={c.alias ?? c.email}
                    >
                      {c.alias ?? (
                        <span className="text-slate-400 font-normal">
                          Sin alias
                        </span>
                      )}
                    </div>
                    {c.isTestCashier && (
                      <span className="inline-flex items-center gap-1 mt-1 text-[11px] text-violet-700">
                        <FlaskConical className="w-3 h-3" />
                        Cajero de pruebas
                      </span>
                    )}
                  </td>
                  <td className="py-2.5 pr-3">
                    <div
                      className="max-w-[230px] truncate text-slate-600"
                      title={c.email}
                    >
                      {c.email}
                    </div>
                  </td>
                  <td className="py-2.5 pr-3 text-slate-600">
                    {CASHIER_ROLE_LABEL[c.role]}
                  </td>
                  <td className="py-2.5 pr-3">
                    <span
                      className={`inline-block px-2 py-0.5 rounded-md border text-[11.5px] ${
                        CASHIER_STATUS_CLS[c.status]
                      }`}
                    >
                      {CASHIER_STATUS_LABEL[c.status]}
                    </span>
                  </td>
                  <td className="py-2.5">
                    {c.lastLoginAt ? (
                      <>
                        <div className="text-slate-700">
                          {fullDateTime(c.lastLoginAt)}
                        </div>
                        {/* El campo lo comparten el login del TPV y el
                            del admin web. Para un cajero sólo puede ser
                            el TPV; para propietario/encargado no lo
                            sabemos, y decirlo vale más que fingir que
                            sí. */}
                        {c.lastLoginSource === "TPV_O_ADMIN" && (
                          <div className="text-[11px] text-slate-400">
                            en el TPV o en el panel de administración
                          </div>
                        )}
                      </>
                    ) : (
                      <span className="text-slate-400">
                        No ha entrado nunca
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
