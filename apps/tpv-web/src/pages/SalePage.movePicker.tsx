// v1.4-Bar-Operativa-MVP Lote 3 · picker para mover un ticket DRAFT a
// otra mesa. Lo abre el SalePage desde el menú overflow del aside.
// Renderizamos un grid simple con mesas libres tappables; las
// ocupadas salen en gris con tooltip. No replicamos el detalle del
// TableMapScreen (zonas, barra horizontal, etc.) porque el caso de
// uso es decisión rápida — el camarero ya tiene en la cabeza a qué
// mesa lleva al cliente, sólo necesita confirmarlo.

import { useEffect, useState } from "react";
import { Loader2, X } from "lucide-react";

import { apiWithCashier, ApiError } from "../api.js";

type TableZone = "SALON" | "TERRAZA" | "BARRA" | "RESERVADO";

interface ApiTable {
  id: string;
  name: string;
  zone: TableZone;
  capacity: number;
  state: "FREE" | "OPEN" | "BILLING";
  activeTicket: {
    id: string;
  } | null;
  groupedIntoTableId: string | null;
}

interface ApiResponse {
  storeId: string | null;
  tables: ApiTable[];
}

const ZONE_LABEL: Record<TableZone, string> = {
  SALON: "Salón",
  TERRAZA: "Terraza",
  BARRA: "Barra",
  RESERVADO: "Reservados",
};

export interface MoveTablePickerProps {
  // Mesa actual del ticket — se pinta como "origen" para que el
  // camarero distinga visualmente y no la confunda con otra libre.
  currentTableId: string | null;
  // v1.0-mesas-frontend: al mover LÍNEAS sueltas (no el ticket entero)
  // el destino puede estar ocupado — las líneas se fusionan en la
  // cuenta existente. Para mover el ticket completo sigue bloqueado.
  allowOccupied?: boolean;
  // Título opcional (por defecto el de mover ticket).
  title?: string;
  subtitle?: string;
  onClose: () => void;
  // Se invoca con el id+name de la mesa destino al confirmar la
  // selección. El padre (SalePage) llama al endpoint y maneja error
  // de carrera (mesa ocupada justo antes — 409 del backend).
  onPick: (destination: { id: string; name: string }) => void;
}

export function MoveTablePicker(props: MoveTablePickerProps) {
  const [tables, setTables] = useState<ApiTable[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiWithCashier<ApiResponse>("/tpv/tables")
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

  // Particionamos por zona para que el camarero encuentre destino
  // rápido. Ocultamos mesas agrupadas (groupedIntoTableId != null) —
  // esas no son tappables porque ya pertenecen a otra cuenta.
  const byZone: Record<TableZone, ApiTable[]> = {
    SALON: [],
    TERRAZA: [],
    BARRA: [],
    RESERVADO: [],
  };
  for (const t of tables ?? []) {
    if (t.groupedIntoTableId) continue;
    byZone[t.zone].push(t);
  }
  const zonesWithTables = (Object.keys(byZone) as TableZone[]).filter(
    (z) => byZone[z].length > 0,
  );

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
              {props.title ?? "Mover a otra mesa"}
            </h2>
            <p className="text-[13px] text-slate-500 mt-0.5">
              {props.subtitle ??
                "Elige la mesa destino. Las libres son seleccionables; las ocupadas quedan grises."}
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
          {tables && tables.length === 0 && (
            <div className="py-10 text-center text-[13px] text-slate-500">
              Esta tienda no tiene mesas configuradas.
            </div>
          )}
          {tables && zonesWithTables.length > 0 && (
            <div className="space-y-6">
              {zonesWithTables.map((zone) => (
                <div key={zone}>
                  <div className="text-[11px] uppercase tracking-wider font-medium text-slate-400 mb-2">
                    {ZONE_LABEL[zone]}
                  </div>
                  <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2.5">
                    {byZone[zone].map((t) => {
                      const isCurrent = t.id === props.currentTableId;
                      const isOccupied =
                        t.state !== "FREE" && !props.allowOccupied;
                      const disabled = isCurrent || isOccupied;
                      return (
                        <button
                          key={t.id}
                          type="button"
                          disabled={disabled}
                          onClick={() =>
                            props.onPick({ id: t.id, name: t.name })
                          }
                          title={
                            isCurrent
                              ? "El ticket ya está en esta mesa."
                              : isOccupied
                                ? "Mesa ocupada por otra cuenta."
                                : `Mover a ${t.name}`
                          }
                          className={
                            isCurrent
                              ? "h-16 rounded-2xl border border-mipiace-coral/40 bg-mipiace-coral-soft text-mipiace-coral-dark text-[14px] font-medium opacity-60 cursor-not-allowed"
                              : isOccupied
                                ? "h-16 rounded-2xl border border-slate-200 bg-slate-50 text-slate-400 text-[14px] font-medium cursor-not-allowed"
                                : "h-16 rounded-2xl border border-slate-200 bg-white hover:bg-mipiace-coral-soft hover:border-mipiace-coral/40 text-mipiace-ink text-[14px] font-medium transition-colors"
                          }
                        >
                          <div>{t.name}</div>
                          <div className="text-[11px] opacity-70 mt-0.5">
                            {isCurrent
                              ? "actual"
                              : isOccupied
                                ? "ocupada"
                                : `${t.capacity}p`}
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
      </div>
    </div>
  );
}
