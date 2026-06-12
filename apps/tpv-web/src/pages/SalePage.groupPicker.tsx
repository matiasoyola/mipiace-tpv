// v1.0-mesas-frontend · picker para agrupar mesas (B7 grouping).
//
// Se abre desde el chip "Agrupar" del SalePage en contexto mesa: la
// mesa actual actúa como PRINCIPAL y el cajero marca una o varias
// mesas ocupadas para absorber sus cuentas (POST /tables/:id/group).
// Sólo son seleccionables las mesas OCUPADAS con cuenta propia (no
// agrupadas ya, no la actual): absorber una mesa libre no aporta nada
// y el backend igualmente la ignoraría.

import { useEffect, useState } from "react";
import { Check, Loader2, X } from "lucide-react";

import { apiWithCashier, ApiError } from "../api.js";

type TableZone = "SALON" | "TERRAZA" | "BARRA" | "RESERVADO";

interface ApiTable {
  id: string;
  name: string;
  zone: TableZone;
  capacity: number;
  state: "FREE" | "OPEN" | "BILLING";
  activeTicket: { id: string; total: string } | null;
  groupedIntoTableId: string | null;
}

const ZONE_LABEL: Record<TableZone, string> = {
  SALON: "Salón",
  TERRAZA: "Terraza",
  BARRA: "Barra",
  RESERVADO: "Reservados",
};

export interface GroupTablesPickerProps {
  currentTableId: string;
  currentTableName: string;
  busy: boolean;
  onClose: () => void;
  // Confirmación con las mesas marcadas. El padre llama al endpoint y
  // gestiona el 409 (TABLE_ALREADY_GROUPED) con toast.
  onConfirm: (tablesToAbsorbIds: string[]) => void;
}

export function GroupTablesPicker(props: GroupTablesPickerProps) {
  const [tables, setTables] = useState<ApiTable[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    let cancelled = false;
    apiWithCashier<{ tables: ApiTable[] }>("/tpv/tables")
      .then((res) => {
        if (cancelled) return;
        setTables(res.tables);
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof ApiError) setError(err.message);
        else setError("No se pudieron cargar las mesas.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const candidates = (tables ?? []).filter(
    (t) =>
      t.id !== props.currentTableId &&
      t.groupedIntoTableId === null &&
      t.state !== "FREE" &&
      t.activeTicket !== null,
  );
  const byZone: Record<TableZone, ApiTable[]> = {
    SALON: [],
    TERRAZA: [],
    BARRA: [],
    RESERVADO: [],
  };
  for (const t of candidates) byZone[t.zone].push(t);
  const zonesWithTables = (Object.keys(byZone) as TableZone[]).filter(
    (z) => byZone[z].length > 0,
  );

  function toggle(id: string): void {
    setSelected((curr) => {
      const next = new Set(curr);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-mipiace-ink/70 flex items-center justify-center p-4 font-sans"
      onClick={props.onClose}
    >
      <div
        className="bg-white rounded-3xl max-w-4xl w-full max-h-[85vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 md:px-7 pt-5 md:pt-6 pb-4 border-b border-slate-100">
          <div>
            <h2 className="text-[18px] md:text-[20px] font-semibold text-mipiace-ink tracking-tight">
              Agrupar mesas en {props.currentTableName}
            </h2>
            <p className="text-[13px] text-slate-500 mt-0.5">
              Marca las mesas ocupadas cuyas cuentas quieres unir a esta.
              Al cobrar o desagrupar, vuelven a quedar libres.
            </p>
          </div>
          <button
            type="button"
            onClick={props.onClose}
            className="h-9 w-9 rounded-full bg-mipiace-stone text-slate-500 flex items-center justify-center"
            aria-label="Cerrar"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 md:px-7 py-5">
          {error && (
            <div className="mb-4 text-[13px] text-red-700 bg-red-50 rounded-xl px-3.5 py-2.5">
              {error}
            </div>
          )}
          {!tables && !error && (
            <div className="py-10 text-center text-slate-400">
              <Loader2 className="w-6 h-6 mx-auto animate-spin" />
            </div>
          )}
          {tables && candidates.length === 0 && (
            <div className="py-10 text-center text-[13px] text-slate-500">
              No hay otras mesas ocupadas que se puedan agrupar.
            </div>
          )}
          {zonesWithTables.length > 0 && (
            <div className="space-y-6">
              {zonesWithTables.map((zone) => (
                <div key={zone}>
                  <div className="text-[11px] uppercase tracking-wider font-medium text-slate-400 mb-2">
                    {ZONE_LABEL[zone]}
                  </div>
                  <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2.5">
                    {byZone[zone].map((t) => {
                      const isSelected = selected.has(t.id);
                      return (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => toggle(t.id)}
                          title={`${t.name} · ${Number(t.activeTicket!.total).toFixed(2)} €`}
                          className={
                            isSelected
                              ? "relative h-16 rounded-2xl border-2 border-mipiace-coral bg-mipiace-coral-soft text-mipiace-coral-dark text-[14px] font-medium"
                              : "relative h-16 rounded-2xl border border-slate-200 bg-white hover:bg-mipiace-coral-soft/40 hover:border-mipiace-coral/40 text-mipiace-ink text-[14px] font-medium transition-colors"
                          }
                        >
                          {isSelected && (
                            <span className="absolute top-1.5 right-1.5 h-4 w-4 rounded-full bg-mipiace-coral text-white flex items-center justify-center">
                              <Check className="w-3 h-3" strokeWidth={3} />
                            </span>
                          )}
                          <div>{t.name}</div>
                          <div className="text-[11px] opacity-70 mt-0.5 tabular-nums">
                            {Number(t.activeTicket!.total).toFixed(2)} €
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="shrink-0 border-t border-slate-100 px-5 md:px-7 py-4 flex items-center gap-2.5">
          <button
            type="button"
            onClick={props.onClose}
            className="h-12 px-5 rounded-2xl border border-slate-200 hover:bg-slate-50 text-mipiace-ink-soft text-[13.5px] font-medium"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={selected.size === 0 || props.busy}
            onClick={() => props.onConfirm([...selected])}
            className="flex-1 h-12 rounded-2xl bg-mipiace-coral hover:bg-mipiace-coral-dark disabled:opacity-50 text-white text-[14px] font-medium flex items-center justify-center gap-2"
          >
            {props.busy && <Loader2 className="w-4 h-4 animate-spin" />}
            Agrupar {selected.size > 0 ? `${selected.size} ` : ""}
            {selected.size === 1 ? "mesa" : "mesas"}
          </button>
        </div>
      </div>
    </div>
  );
}
