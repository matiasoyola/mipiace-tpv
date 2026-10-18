// puesta-en-marcha (ADR-021) · la pantalla de «Puesta en marcha».
//
// Dos acciones y una sola previsualización, porque las dos se deciden
// mirando lo mismo: qué hay de ensayo en esta cuenta, qué se conserva, y
// cómo están las cajas.
//
//   · **Resetear ensayo** — se puede mientras la cuenta no facture, tantas
//     veces como haga falta.
//   · **Empezar a facturar** — una sola vez, con el cliente delante, y no se
//     deshace. Por eso va en rojo y abajo, separada, y por eso enseña sus
//     bloqueos arriba cuando los hay.
//
// Las dos piden teclear el nombre del comercio, igual que «Dejar Holded»
// (ADR-020): un «¿seguro?» se pulsa sin leer, y aquí lo que está en juego es
// cuándo empieza a facturar un negocio.
//
// ── Por qué un panel y no un modal ────────────────────────────────────
//
// Lo mismo que en ADR-020: hay que LEERLO, y en un móvil de 320 px un modal
// con esta cantidad de información es una caja con scroll dentro de otra
// caja con scroll. El panel se abre debajo de «Acciones» y crece hacia
// abajo.

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  Check,
  Loader2,
  Receipt,
  RotateCcw,
  X,
} from "lucide-react";

import { superApi, SuperAdminApiError } from "./api.js";
import { humanizeError } from "./error-messages.js";
import type {
  DejarHoldedBloqueo,
  EmpezarAFacturarResultado,
  PuestaEnMarchaPreview,
  ResetearEnsayoResultado,
} from "./types.js";

// Los estados del ticket en cristiano. El reseteo los borra todos, así que
// la pantalla tiene que poder nombrarlos todos — incluidos los que en una
// cuenta en ensayo no deberían existir (`PAID`, `SYNCED`), que si aparecen
// son justo lo que hay que mirar.
const ETIQUETA_ESTADO: Record<string, string> = {
  TEST: "de ensayo",
  DRAFT: "borradores (mesas abiertas)",
  VOIDED: "anulados",
  PAID: "cobrados",
  PENDING_SYNC: "cobrados, pendientes de subir",
  SYNCED: "cobrados y subidos a Holded",
  SYNC_FAILED: "cobrados, con la subida fallida",
  ON_CREDIT: "fiados con deuda viva",
};

function fechaCorta(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()}`;
}

export function PuestaEnMarchaPanel({
  tenantId,
  tenantName,
  onCerrar,
  onReseteado,
  onArrancado,
}: {
  tenantId: string;
  tenantName: string;
  onCerrar: () => void;
  onReseteado: (r: ResetearEnsayoResultado) => void;
  onArrancado: (r: EmpezarAFacturarResultado) => void;
}) {
  const [previa, setPrevia] = useState<PuestaEnMarchaPreview | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmacion, setConfirmacion] = useState("");
  const [enviando, setEnviando] = useState<null | "reset" | "arrancar">(null);
  // Los bloqueos que devuelve el POST cuando algo ha cambiado entre la
  // previsualización y el botón. Se pintan igual que los de la previa: el que
  // pulsó tiene que leer LO MISMO, no un 409 genérico.
  const [bloqueosDelPost, setBloqueosDelPost] = useState<
    DejarHoldedBloqueo[] | null
  >(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    setBloqueosDelPost(null);
    try {
      setPrevia(
        await superApi<PuestaEnMarchaPreview>(
          `/super-admin/tenants/${tenantId}/puesta-en-marcha`,
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

  async function resetear(): Promise<void> {
    setEnviando("reset");
    setError(null);
    try {
      const r = await superApi<ResetearEnsayoResultado>(
        `/super-admin/tenants/${tenantId}/resetear-ensayo`,
        { method: "POST", body: { confirmacion } },
      );
      setConfirmacion("");
      onReseteado(r);
      await cargar();
    } catch (e) {
      setError(humanizeError(e));
      await cargar();
    } finally {
      setEnviando(null);
    }
  }

  async function arrancar(): Promise<void> {
    setEnviando("arrancar");
    setError(null);
    setBloqueosDelPost(null);
    try {
      const r = await superApi<EmpezarAFacturarResultado>(
        `/super-admin/tenants/${tenantId}/empezar-a-facturar`,
        { method: "POST", body: { confirmacion } },
      );
      onArrancado(r);
    } catch (e) {
      const cuerpo =
        e instanceof SuperAdminApiError
          ? (e.detail as { bloqueos?: DejarHoldedBloqueo[] } | null)
          : null;
      if (cuerpo?.bloqueos != null) {
        setBloqueosDelPost(cuerpo.bloqueos);
        // Y se recarga: la pantalla tiene que volver a enseñar la verdad de
        // ahora, no la de hace treinta segundos.
        await cargar();
      } else {
        setError(humanizeError(e));
      }
    } finally {
      setEnviando(null);
    }
  }

  const bloqueos = bloqueosDelPost ?? previa?.bloqueos ?? [];
  const nombreOk = confirmacion.trim() === tenantName.trim();
  const enEnsayo = previa?.estado === "ensayo";
  const puedeArrancar = previa?.puedeArrancar === true && bloqueosDelPost == null;

  return (
    <div
      className="bg-white border-2 border-sky-300 rounded-xl p-4 sm:p-6 mb-6"
      data-testid="puesta-en-marcha-panel"
    >
      <div className="flex items-start justify-between gap-3 mb-1">
        <h3 className="font-semibold text-slate-900 flex items-center gap-2 text-[15px]">
          <Receipt className="w-4.5 h-4.5 text-sky-700" />
          Puesta en marcha
        </h3>
        <button
          onClick={onCerrar}
          className="shrink-0 text-slate-400 hover:text-slate-700"
          aria-label="Cerrar"
        >
          <X className="w-4.5 h-4.5" />
        </button>
      </div>

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

      {previa != null && !cargando && (
        <>
          {/* ── El estado, lo primero ──────────────────────────────── */}
          <div
            className={`mb-5 p-3 rounded-lg border text-[13px] ${
              enEnsayo
                ? "bg-sky-50 border-sky-200 text-sky-950"
                : "bg-emerald-50 border-emerald-200 text-emerald-900"
            }`}
            data-testid="puesta-en-marcha-estado"
          >
            {enEnsayo ? (
              <>
                <strong>En ensayo.</strong> Esta cuenta vende con normalidad
                desde cualquier terminal, y nada de lo que cobra es una
                factura: los tickets nacen de prueba, no suben a Holded, no
                mandan email y no llevan registro de facturación. El TPV lo
                dice en una banda fija y el papel sale marcado.
                {previa.tenant.esDePruebas && (
                  <>
                    {" "}
                    Es una <strong>cuenta de pruebas del equipo</strong>: se
                    queda en ensayo para siempre.
                  </>
                )}
              </>
            ) : (
              <>
                <strong>
                  Facturando desde el {fechaCorta(previa.facturaDesde!)}.
                </strong>{" "}
                Cada venta es una factura con su número. El ensayo ya no se
                puede resetear: su histórico es contabilidad.
              </>
            )}
          </div>

          {/* ── Lo que impide arrancar ─────────────────────────────── */}
          {enEnsayo && bloqueos.length > 0 && (
            <div
              className="mb-5 p-3 sm:p-4 bg-red-50 border border-red-200 rounded-lg"
              data-testid="puesta-en-marcha-bloqueos"
            >
              <p className="flex items-center gap-2 font-semibold text-red-900 text-[13px] mb-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                {bloqueos.some((b) => b.codigo === "VENTA_REAL_EN_ENSAYO")
                  ? "Aquí hay algo que no debería estar"
                  : "Todavía no puede empezar a facturar"}
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

          {/* ── Lo que se borra ────────────────────────────────────── */}
          <Seccion titulo="Lo que borra el reseteo">
            <Dato
              etiqueta="TODOS los tickets de la cuenta"
              valor={`${previa.ensayo.ticketsTotales}`}
              detalle="Con sus líneas, sus pagos, sus comandas de cocina y sus envíos de email. En una cuenta en ensayo no hay ninguna venta real: por eso se van todos y no sólo los de prueba."
              tono={previa.ensayo.ticketsTotales > 0 ? "warning" : "neutral"}
            />
            {/* El desglose POR ESTADO, que es lo que hace que nadie pulse sin
                saber qué se va: «20 anuladas» no se lee igual que «3 de
                ensayo». Lo enseñó la foto de producción del 18-10. */}
            {previa.ensayo.ticketsPorEstado.length > 0 && (
              <ul className="text-[11.5px] text-slate-600 font-mono space-y-0.5 pl-1">
                {previa.ensayo.ticketsPorEstado.map((p) => (
                  <li key={p.estado} className="flex justify-between gap-3">
                    <span>{ETIQUETA_ESTADO[p.estado] ?? p.estado}</span>
                    <span className="tabular-nums">{p.cuantos}</span>
                  </li>
                ))}
              </ul>
            )}
            <Dato
              etiqueta="Devoluciones"
              valor={`${previa.ensayo.devoluciones}`}
            />
            <Dato
              etiqueta="Turnos"
              valor={`${previa.ensayo.turnos}`}
              detalle={`${previa.ensayo.turnosAbiertos} abierto(s) · ${previa.ensayo.arqueos} arqueo(s) · ${previa.ensayo.informesZ} informe(s) Z`}
            />
            {previa.ensayo.mesasUnidas > 0 && (
              <Dato
                etiqueta="Mesas unidas"
                valor={`${previa.ensayo.mesasUnidas}`}
                detalle="Se desagrupan. Las mesas NO se borran."
              />
            )}
            {previa.ensayo.contadoresDeTicket.length > 0 && (
              <p className="text-[11.5px] text-slate-500 leading-relaxed">
                Y el contador de referencia interna vuelve a cero:{" "}
                {previa.ensayo.contadoresDeTicket
                  .map((c) => `${c.caja} va por ${c.contador}`)
                  .join(" · ")}
                . La primera venta de verdad será la 000001.
              </p>
            )}
          </Seccion>

          {/* ── Lo que se conserva ─────────────────────────────────── */}
          <Seccion titulo="Lo que se conserva">
            <Dato etiqueta="Productos y servicios" valor={`${previa.conserva.productos}`} />
            <Dato etiqueta="Mesas de la sala" valor={`${previa.conserva.mesas}`} />
            <Dato etiqueta="Cajeros" valor={`${previa.conserva.cajeros}`} />
            <Dato etiqueta="Terminales emparejados" valor={`${previa.conserva.terminales}`} />
            <Dato etiqueta="Impresoras configuradas" valor={`${previa.conserva.impresoras}`} />
            <Dato etiqueta="Contactos" valor={`${previa.conserva.contactos}`} />
            <Dato
              etiqueta="Datos fiscales"
              valor={previa.conserva.datosFiscales ? "completos" : "incompletos"}
              tono={previa.conserva.datosFiscales ? "ok" : "danger"}
              detalle="Razón social y NIF. Hacen falta para poder emitir."
            />
            <p className="text-[11.5px] text-slate-500 leading-relaxed">
              Todo lo que cuesta una tarde de implantación se queda. Y no se
              toca ningún registro de facturación: en una cuenta en ensayo no
              hay ninguno.
            </p>
          </Seccion>

          {/* ── Las cajas ──────────────────────────────────────────── */}
          <Seccion titulo="Cajas">
            {previa.cajas.length === 0 && (
              <p className="text-[12.5px] text-red-800">
                Esta cuenta no tiene ninguna caja.
              </p>
            )}
            {previa.cajas.map((c) => (
              <div key={c.id} className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[12.5px] text-slate-700 truncate">
                    {c.nombre} · {c.tienda}
                  </p>
                  <p className="text-[11.5px] text-slate-500 font-mono truncate">
                    serie {c.serie ?? "—"} · instalación {c.numeroInstalacion ?? "—"}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p
                    className={`text-[12.5px] font-semibold tabular-nums ${
                      c.registrosFiscales === 0 ? "text-emerald-700" : "text-red-700"
                    }`}
                  >
                    {c.registrosFiscales} registro(s)
                  </p>
                  <p className="text-[11.5px] text-slate-500 tabular-nums">
                    {c.terminalesEmparejados} terminal(es)
                  </p>
                </div>
              </div>
            ))}
          </Seccion>

          {/* ── Las dos acciones ───────────────────────────────────── */}
          {enEnsayo ? (
            <div className="pt-4 border-t border-slate-200">
              <label className="block text-[12.5px] text-slate-700 mb-1.5">
                Escribe <strong className="font-semibold">{tenantName}</strong>{" "}
                para confirmar cualquiera de las dos acciones
              </label>
              <input
                value={confirmacion}
                onChange={(e) => setConfirmacion(e.target.value)}
                className="w-full h-11 px-3 border border-slate-300 rounded-lg text-[13px] mb-4"
                placeholder={tenantName}
                autoComplete="off"
                data-testid="puesta-en-marcha-confirmacion"
              />

              <div className="flex flex-wrap gap-2 mb-5">
                <button
                  onClick={() => void resetear()}
                  disabled={
                    !nombreOk || enviando != null || previa.puedeResetear !== true
                  }
                  data-testid="puesta-en-marcha-resetear"
                  className="inline-flex items-center gap-1.5 h-11 px-4 rounded-lg text-[13px] font-medium bg-slate-700 text-white hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {enviando === "reset" ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <RotateCcw className="w-4 h-4" />
                  )}
                  Resetear ensayo
                </button>
                <button
                  onClick={onCerrar}
                  disabled={enviando != null}
                  className="h-11 px-4 border border-slate-300 rounded-lg text-[13px] font-medium text-slate-700 hover:bg-slate-50"
                >
                  Cerrar
                </button>
              </div>

              <div className="p-3 sm:p-4 bg-red-50 border border-red-200 rounded-lg">
                <p className="text-[13px] font-semibold text-red-900 mb-1">
                  Empezar a facturar
                </p>
                <p className="text-[12.5px] text-red-800 mb-3 leading-relaxed">
                  Resetea el ensayo y, desde ese momento, cada venta de este
                  comercio es una factura con su número: la primera será la{" "}
                  <strong>
                    {previa.cajas[0]?.serie
                      ? `${previa.cajas[0].serie}/1`
                      : "primera de su serie"}
                  </strong>
                  . <strong>No se puede deshacer.</strong> Hazlo en el local,
                  con el cliente delante.
                </p>
                <button
                  onClick={() => void arrancar()}
                  disabled={!nombreOk || !puedeArrancar || enviando != null}
                  data-testid="puesta-en-marcha-arrancar"
                  className="inline-flex items-center gap-1.5 h-11 px-4 rounded-lg text-[13px] font-medium bg-red-600 text-white hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {enviando === "arrancar" ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Check className="w-4 h-4" />
                  )}
                  Empezar a facturar
                </button>
              </div>
            </div>
          ) : (
            <div className="pt-4 border-t border-slate-200 flex flex-wrap gap-2">
              <button
                onClick={() => void cargar()}
                className="h-11 px-4 border border-slate-300 rounded-lg text-[13px] font-medium text-slate-700 hover:bg-slate-50"
                data-testid="puesta-en-marcha-revisar"
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
