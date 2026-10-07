// clinica-3 · la lista de pendientes de cobro de la recepción.
//
// Las sesiones que la podóloga ha cerrado y todavía no se han cobrado, con
// la cita, el paciente y las líneas con su precio.
//
// ── Y NADA DE LA HISTORIA ────────────────────────────────────────────
//
// Prompt §4: ni lesiones, ni dolor, ni evolución, ni consejos, ni la nota,
// ni las alertas. Y eso no lo decide esta pantalla: **la respuesta de la
// API no las trae**, porque el tipo con el que se construye no tiene sitio
// para llevarlas (`clinica/sesion-view.ts`). Aquí no hay un `if` que
// esconda nada; no hay nada que esconder.
//
// La diferencia importa: una pantalla que filtrara sería una pantalla que
// algún día deja de filtrar. Un endpoint que no lo manda no puede.
//
// ── Quién la ve ──────────────────────────────────────────────────────
//
// Quien cobra. El sanitario sin caja no ve importes en ninguna parte y
// esto es todo importes — la ruta lo rechaza con un 403
// (`ensureNoEsSanitarioSinCaja`), y el TPV no le pinta el botón que abre
// esta hoja. Esconder el botón es por no ofrecer una acción que siempre
// falla; la frontera está en la API.

import { useCallback, useEffect, useState } from "react";
import { Loader2, X } from "lucide-react";

import { ApiError, apiWithCashier } from "../api.js";
import { euros } from "./SesionPodologia.js";

interface CobroPendiente {
  appointmentId: string;
  empieza: string;
  paciente: { id: string; nombre: string };
  servicios: string[];
  lineas: Array<{ nombre: string; precio: number; iva: number }>;
  total: number;
  ivaTexto: string | null;
  cerradaEn: string;
}

export function CobrosPendientes(props: {
  /** `YYYY-MM-DD`, el día que la agenda está mirando. */
  fecha: string;
  onCerrar: () => void;
  onCobrar: (appointmentId: string) => void;
  puedeCobrar: boolean;
}) {
  const [cobros, setCobros] = useState<CobroPendiente[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setError(null);
    try {
      const r = await apiWithCashier<{ cobros: CobroPendiente[] }>(
        `/agenda/cobros-pendientes?from=${props.fecha}`,
      );
      setCobros(r.cobros);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "No se pudo cargar la lista de cobros.",
      );
      setCobros([]);
    }
  }, [props.fecha]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end font-sans">
      {/* El scrim: se toca fuera y se cierra. En el mostrador se abre y se
          cierra veinte veces al día. */}
      <button
        type="button"
        onClick={props.onCerrar}
        aria-label="Cerrar la lista de cobros"
        className="absolute inset-0 bg-mipiace-ink/30"
      />
      <div
        data-test="panel-cobros"
        className="relative w-full md:w-[420px] bg-white h-full flex flex-col shadow-xl"
      >
        <div className="flex items-center gap-2 h-16 px-4 border-b border-slate-200 shrink-0">
          <h2 className="text-[17px] font-semibold text-mipiace-ink flex-1">
            Por cobrar
            {cobros && cobros.length > 0 && (
              <span className="text-slate-400 font-normal"> · {cobros.length}</span>
            )}
          </h2>
          <button
            onClick={props.onCerrar}
            className="h-11 w-11 rounded-2xl hover:bg-slate-100 flex items-center justify-center"
            aria-label="Cerrar"
          >
            <X className="w-5 h-5" strokeWidth={2.25} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {cobros == null && (
            <div className="flex items-center gap-2 text-[13px] text-slate-500 py-8 justify-center">
              <Loader2 className="w-4 h-4 animate-spin motion-reduce:animate-none" />
              Cargando…
            </div>
          )}
          {error && (
            <div className="bg-red-50 text-red-700 rounded-2xl px-4 py-3 text-[13.5px]">
              {error}
            </div>
          )}
          {cobros != null && cobros.length === 0 && !error && (
            <p className="text-[13.5px] text-slate-500 leading-relaxed py-6 text-center">
              No queda nada por cobrar de este día.
            </p>
          )}
          {cobros?.map((c) => (
            <div
              key={c.appointmentId}
              className="border border-slate-200 rounded-3xl p-4"
            >
              <div className="flex justify-between items-start gap-3">
                <div>
                  <div className="font-medium text-[15px] text-mipiace-ink">
                    {c.paciente.nombre}
                  </div>
                  <div className="text-[12.5px] text-slate-500">
                    {hora(c.empieza)}
                    {c.servicios.length > 0 && ` · ${c.servicios.join(" + ")}`}
                  </div>
                </div>
                <div className="text-[16px] font-semibold tabular-nums shrink-0">
                  {euros(c.total)}
                </div>
              </div>
              <div className="mt-2.5 text-[13.5px]">
                {c.lineas.map((l, i) => (
                  <div
                    key={`${l.nombre}-${i}`}
                    className="flex justify-between py-1 border-t border-slate-100 first:border-t-0"
                  >
                    <span>{l.nombre}</span>
                    <span className="tabular-nums">
                      {/* «Incluido» es un precio de 0 en el catálogo. */}
                      {l.precio === 0 ? "incluido" : euros(l.precio)}
                    </span>
                  </div>
                ))}
              </div>
              {c.ivaTexto && (
                <div className="text-[12px] text-slate-500 mt-1">
                  {c.ivaTexto}
                </div>
              )}
              {props.puedeCobrar && (
                <button
                  type="button"
                  onClick={() => props.onCobrar(c.appointmentId)}
                  className="mt-3 w-full h-touch rounded-2xl bg-mipiace-coral text-white font-semibold text-[15px]"
                >
                  Cobrar en caja
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function hora(iso: string): string {
  return new Date(iso).toLocaleTimeString("es-ES", {
    hour: "2-digit",
    minute: "2-digit",
  });
}
