// puesta-en-marcha parte C (ADR-021 §5) · la baja de un cliente.
//
// Dos pasos, y el orden es la precondición:
//
//   1. **Descargar el export.** Un ZIP con las facturas (con su huella y su
//      encadenamiento), las ventas, las devoluciones y los fichajes. Es lo
//      que el titular tiene que conservar cuatro años y se le entrega a él.
//   2. **Eliminar.** El botón NO EXISTE hasta que el export está descargado,
//      y el servidor lo vuelve a comprobar contra el registro de auditoría:
//      la pantalla no es la puerta.
//
// Las cuentas nuestras de pruebas se eliminan sin export: no hay titular a
// quien entregarle nada.

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  Check,
  Download,
  Loader2,
  Trash2,
  X,
} from "lucide-react";

import { superApi, superApiBlob, SuperAdminApiError } from "./api.js";
import { humanizeError } from "./error-messages.js";
import type {
  DejarHoldedBloqueo,
  EliminarCuentaPreview,
  EliminarCuentaResultado,
} from "./types.js";

export function EliminarCuentaPanel({
  tenantId,
  tenantName,
  onCerrar,
  onEliminada,
}: {
  tenantId: string;
  tenantName: string;
  onCerrar: () => void;
  onEliminada: (r: EliminarCuentaResultado) => void;
}) {
  const [previa, setPrevia] = useState<EliminarCuentaPreview | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmacion, setConfirmacion] = useState("");
  const [descargando, setDescargando] = useState(false);
  const [borrando, setBorrando] = useState(false);
  const [bloqueosDelPost, setBloqueosDelPost] = useState<
    DejarHoldedBloqueo[] | null
  >(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    setBloqueosDelPost(null);
    try {
      setPrevia(
        await superApi<EliminarCuentaPreview>(
          `/super-admin/tenants/${tenantId}/eliminar-cuenta`,
        ),
      );
    } catch (e) {
      setError(humanizeError(e));
    } finally {
      setCargando(false);
    }
  }, [tenantId]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function descargar(): Promise<void> {
    setDescargando(true);
    setError(null);
    try {
      const blob = await superApiBlob(
        `/super-admin/tenants/${tenantId}/export.zip`,
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${tenantName.replace(/[^a-zA-Z0-9]+/g, "-").toLowerCase()}-${new Date()
        .toISOString()
        .slice(0, 10)}.zip`;
      a.click();
      URL.revokeObjectURL(url);
      // Y se recarga: el servidor acaba de apuntar la descarga, y es ese
      // apunte —no esta pantalla— el que habilita el borrado.
      await cargar();
    } catch (e) {
      setError(humanizeError(e));
    } finally {
      setDescargando(false);
    }
  }

  async function eliminar(): Promise<void> {
    setBorrando(true);
    setError(null);
    setBloqueosDelPost(null);
    try {
      const r = await superApi<EliminarCuentaResultado>(
        `/super-admin/tenants/${tenantId}/eliminar-cuenta`,
        { method: "POST", body: { confirmacion } },
      );
      onEliminada(r);
    } catch (e) {
      const cuerpo =
        e instanceof SuperAdminApiError
          ? (e.detail as { bloqueos?: DejarHoldedBloqueo[] } | null)
          : null;
      if (cuerpo?.bloqueos != null) {
        setBloqueosDelPost(cuerpo.bloqueos);
        await cargar();
      } else {
        setError(humanizeError(e));
      }
    } finally {
      setBorrando(false);
    }
  }

  const bloqueos = bloqueosDelPost ?? previa?.bloqueos ?? [];
  const nombreOk = confirmacion.trim() === tenantName.trim();
  const puede = previa?.puedeEliminar === true && bloqueosDelPost == null;
  const c = previa?.contenido;

  return (
    <div
      className="bg-white border-2 border-red-300 rounded-xl p-4 sm:p-6 mb-6"
      data-testid="eliminar-cuenta-panel"
    >
      <div className="flex items-start justify-between gap-3 mb-1">
        <h3 className="font-semibold text-slate-900 flex items-center gap-2 text-[15px]">
          <Trash2 className="w-4.5 h-4.5 text-red-700" />
          Eliminar cuenta
        </h3>
        <button
          onClick={onCerrar}
          className="shrink-0 text-slate-400 hover:text-slate-700"
          aria-label="Cerrar"
        >
          <X className="w-4.5 h-4.5" />
        </button>
      </div>
      <p className="text-[12.5px] text-slate-600 mb-4">
        La baja de un cliente. Borra el comercio y TODO lo que cuelga de él —
        sus facturas incluidas — y no se puede deshacer. Hazlo sólo a petición
        escrita del titular, y después de entregarle su copia.
      </p>

      {cargando && (
        <div className="flex items-center gap-2 text-[13px] text-slate-500 py-4">
          <Loader2 className="w-4 h-4 animate-spin" />
          Midiendo lo que hay en esta cuenta…
        </div>
      )}

      {error != null && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-[12.5px] text-red-800">
          {error}
        </div>
      )}

      {previa != null && !cargando && c != null && (
        <>
          {bloqueos.length > 0 && (
            <div
              className="mb-5 p-3 sm:p-4 bg-red-50 border border-red-200 rounded-lg"
              data-testid="eliminar-cuenta-bloqueos"
            >
              <p className="flex items-center gap-2 font-semibold text-red-900 text-[13px] mb-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                Todavía no se puede
              </p>
              <ul className="space-y-2">
                {bloqueos.map((b, i) => (
                  <li key={`${b.codigo}-${i}`} className="text-[12.5px] text-red-800">
                    {b.mensaje}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <Seccion titulo="Lo que se borra">
            <Dato
              etiqueta="Registros de facturación"
              valor={`${c.registrosFiscales}`}
              detalle="Sus facturas. Van en el export y después aquí no queda ninguna."
              tono={c.registrosFiscales > 0 ? "danger" : "neutral"}
            />
            <Dato etiqueta="Ventas" valor={`${c.tickets}`} />
            <Dato etiqueta="Devoluciones" valor={`${c.devoluciones}`} />
            <Dato etiqueta="Turnos" valor={`${c.turnos}`} />
            <Dato etiqueta="Productos y servicios" valor={`${c.productos}`} />
            <Dato etiqueta="Contactos" valor={`${c.contactos}`} />
            <Dato etiqueta="Clientes (ficha)" valor={`${c.clientes}`} />
            <Dato etiqueta="Citas" valor={`${c.citas}`} />
            <Dato
              etiqueta="Empleados y fichajes"
              valor={`${c.empleados} / ${c.fichajes}`}
              detalle="El registro de jornada va en el export: son cuatro años que conserva la empresa."
            />
            <Dato etiqueta="Enlaces públicos" valor={`${c.enlacesPublicos}`} />
            <Dato
              etiqueta="Usuarios, terminales, tiendas y cajas"
              valor={`${c.usuarios} / ${c.terminales} / ${c.tiendas} / ${c.cajas}`}
            />
          </Seccion>

          {/* ── Paso 1: el export ────────────────────────────────────── */}
          <Seccion titulo="1 · La copia del titular">
            {previa.exportNoHaceFalta ? (
              <p className="text-[12.5px] text-slate-600">
                Es una cuenta de pruebas del equipo: no hay titular a quien
                entregarle nada, así que el export no hace falta. Puedes
                descargarlo igual si quieres mirar lo que había.
              </p>
            ) : previa.exportDescargadoAt != null ? (
              <p className="flex items-start gap-2 text-[12.5px] text-emerald-800">
                <Check className="w-4 h-4 shrink-0 mt-0.5" />
                Descargado el{" "}
                {new Date(previa.exportDescargadoAt).toLocaleString("es-ES")}.
                Asegúrate de que el titular lo tiene ANTES de seguir.
              </p>
            ) : (
              <p className="text-[12.5px] text-slate-600">
                Descarga el paquete y entrégaselo al titular. Lleva sus
                facturas con la comprobación de la cadena, sus ventas, sus
                devoluciones y sus fichajes, más un LEEME con qué tiene que
                conservar y cuánto tiempo.
              </p>
            )}
            <button
              onClick={() => void descargar()}
              disabled={descargando || borrando}
              data-testid="eliminar-cuenta-export"
              className="inline-flex items-center gap-1.5 h-11 px-4 rounded-lg text-[13px] font-medium bg-slate-700 text-white hover:bg-slate-800 disabled:opacity-40"
            >
              {descargando ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Download className="w-4 h-4" />
              )}
              Descargar el export
            </button>
          </Seccion>

          {/* ── Paso 2: eliminar ─────────────────────────────────────── */}
          <div className="pt-4 border-t border-slate-200">
            <h4 className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold mb-2">
              2 · Eliminar
            </h4>
            {puede ? (
              <>
                <label className="block text-[12.5px] text-slate-700 mb-1.5">
                  Escribe <strong className="font-semibold">{tenantName}</strong>{" "}
                  para confirmar
                </label>
                <input
                  value={confirmacion}
                  onChange={(e) => setConfirmacion(e.target.value)}
                  className="w-full h-11 px-3 border border-slate-300 rounded-lg text-[13px] mb-3"
                  placeholder={tenantName}
                  autoComplete="off"
                  data-testid="eliminar-cuenta-confirmacion"
                />
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => void eliminar()}
                    disabled={!nombreOk || borrando || descargando}
                    data-testid="eliminar-cuenta-confirmar"
                    className="inline-flex items-center gap-1.5 h-11 px-4 rounded-lg text-[13px] font-medium bg-red-600 text-white hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {borrando ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Trash2 className="w-4 h-4" />
                    )}
                    Eliminar la cuenta para siempre
                  </button>
                  <button
                    onClick={onCerrar}
                    disabled={borrando}
                    className="h-11 px-4 border border-slate-300 rounded-lg text-[13px] font-medium text-slate-700 hover:bg-slate-50"
                  >
                    Cancelar
                  </button>
                </div>
              </>
            ) : (
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => void cargar()}
                  className="h-11 px-4 border border-slate-300 rounded-lg text-[13px] font-medium text-slate-700 hover:bg-slate-50"
                  data-testid="eliminar-cuenta-revisar"
                >
                  Volver a comprobar
                </button>
                <button
                  onClick={onCerrar}
                  className="h-11 px-4 border border-slate-300 rounded-lg text-[13px] font-medium text-slate-700 hover:bg-slate-50"
                >
                  Cerrar
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function Seccion({
  titulo,
  children,
}: {
  titulo: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-5">
      <h4 className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold mb-2">
        {titulo}
      </h4>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function Dato({
  etiqueta,
  valor,
  detalle,
  tono = "neutral",
}: {
  etiqueta: string;
  valor: string;
  detalle?: string;
  tono?: "neutral" | "ok" | "warning" | "danger";
}) {
  const cls =
    tono === "danger"
      ? "text-red-700"
      : tono === "warning"
        ? "text-amber-700"
        : tono === "ok"
          ? "text-emerald-700"
          : "text-slate-900";
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="text-[12.5px] text-slate-700">{etiqueta}</p>
        {detalle != null && (
          <p className="text-[11.5px] text-slate-500 leading-snug">{detalle}</p>
        )}
      </div>
      <span className={`shrink-0 text-[15px] font-semibold tabular-nums ${cls}`}>
        {valor}
      </span>
    </div>
  );
}
