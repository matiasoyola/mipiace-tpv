// clinica-2 · la pantalla del sanitario: revisar la valoración y validarla.
//
// Es el modo «Podóloga · validar» del mockup validado
// (`docs/mockups/clinica-2-valoracion.html`), con sus cinco piezas en su
// orden:
//
//   1. cabecera con la pill de estado («por validar» / «validada»),
//   2. la FRANJA DE ALERTAS,
//   3. «Respuestas del test», con la del paciente en naranja y la
//      corrección en oscuro,
//   4. «Antes del primer tratamiento», con las tres confirmaciones,
//   5. «Validar valoración» DESACTIVADO CON EL MOTIVO ESCRITO AL LADO
//      mientras falte algo. Tras validar, el aviso verde con la autora, su
//      colegiado y la hora.
//
// ── Lo del paciente y lo de la clínica, a la vez ──────────────────────
//
// La fila de cada pregunta enseña las DOS cosas cuando hay corrección: la
// respuesta del paciente con borde naranja y la corrección en relleno
// oscuro. No es estética. Si un paciente dijo «no tomo anticoagulantes» y
// resultó que sí, lo que hay que poder demostrar es que lo dijo — borrarlo
// convierte un malentendido del paciente en un error de la clínica. Y la
// leyenda de arriba lo explica sin que nadie tenga que deducirlo.
//
// ── Quién decide si el botón se activa ────────────────────────────────
//
// `puedeValidarse`, la MISMA función pura que usa la API
// (`@mipiacetpv/clinica-valoracion`). El servidor manda —vuelve a
// decidirlo al recibir la petición— y aquí se usa para pintar el botón y
// el motivo sin ir y volver. Con dos cálculos, el día que se separaran el
// botón se activaría para una validación que la API va a rechazar.
//
// Las tres casillas viven EN MEMORIA y viajan con la validación: media
// validación guardada (dos casillas y nadie que firme) no significa nada.

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Check,
  Loader2,
  Mail,
  RefreshCw,
  Tablet,
} from "lucide-react";

import {
  CONFIRMACIONES_VACIAS,
  cuestionarioDeVersion,
  preguntaDe,
  preguntasEnJuego,
  puedeValidarse,
  type Alertas,
  type Confirmaciones,
  type Correccion,
  type Cuestionario,
  type EstadoValoracion,
  type Respuesta,
  type Validable,
} from "@mipiacetpv/clinica-valoracion";

import { ApiError, apiWithCashier } from "../api.js";

// ── La forma que devuelve la API ─────────────────────────────────────

export interface VistaValoracion {
  valoracion: {
    id: string;
    estado: EstadoValoracion;
    canal: "EMAIL" | "TABLET";
    version: number;
    creadaEn: string;
    origen: "APPOINTMENT" | "MANUAL";
    pedidaPor: string | null;
    respondidaEn: string | null;
    respondioPor: "PACIENTE" | "FAMILIAR" | null;
    validadaEn: string | null;
    validadaPor: { nombre: string; colegiado: string | null } | null;
    confirmaciones: Confirmaciones;
    enlace: { activo: boolean; caducaEn: string | null } | null;
  } | null;
  cuestionario: Cuestionario | null;
  respuestasPaciente: Record<string, Respuesta>;
  detalles: Record<string, string[]>;
  correcciones: Correccion[];
  alertas: Alertas;
  validable: Validable;
  anteriores: Array<{
    id: string;
    estado: EstadoValoracion;
    validadaEn: string | null;
  }>;
  primerTratamiento:
    | { puede: true; valoracionId: string; validadaEn: string }
    | { puede: false; motivo: string; mensaje: string };
  textosConfirmacion: Record<keyof Confirmaciones, string>;
}

const ETIQUETA: Record<Respuesta, string> = {
  SI: "Sí",
  NO: "No",
  NO_SE: "No lo sé",
};

function hora(iso: string): string {
  return new Date(iso).toLocaleTimeString("es-ES", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function dia(iso: string): string {
  return new Date(iso).toLocaleDateString("es-ES", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export function ValoracionSanitario(props: {
  clientId: string;
  /** Lo puede abrir alguien que no es sanitario (la recepcionista ve la
   *  ficha); con esto la pantalla no pide la valoración y enseña sólo lo
   *  que esa persona sí puede hacer: mandar el test y abrir la tablet. */
  puedeLeer: boolean;
}) {
  const [vista, setVista] = useState<VistaValoracion | null>(null);
  const [cargando, setCargando] = useState(props.puedeLeer);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [confirmaciones, setConfirmaciones] = useState<Confirmaciones>(
    CONFIRMACIONES_VACIAS,
  );

  const cargar = useCallback(async () => {
    if (!props.puedeLeer) return;
    setError(null);
    try {
      setVista(
        await apiWithCashier<VistaValoracion>(
          `/clinica/clients/${props.clientId}/valoracion`,
        ),
      );
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "No se pudo cargar la valoración.",
      );
    } finally {
      setCargando(false);
    }
  }, [props.clientId, props.puedeLeer]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function accion(
    camino: "enviar" | "tablet",
  ): Promise<void> {
    if (ocupado) return;
    setOcupado(true);
    setError(null);
    setAviso(null);
    try {
      const res = await apiWithCashier<{
        enviado?: boolean;
        motivoNoEnviado?: string;
        token?: string;
        caducaEn?: string | null;
      }>(`/clinica/clients/${props.clientId}/valoracion/${camino}`, {
        method: "POST",
      });
      if (camino === "tablet" && res.token) {
        // La tablet navega al test. Se sustituye la entrada del historial
        // para que el gesto «atrás» del navegador NO devuelva al TPV con
        // el paciente delante: el modo paciente no tiene puerta de vuelta
        // más que el PIN.
        window.location.replace(`/valoracion/${res.token}`);
        return;
      }
      if (res.enviado) {
        setAviso("Test enviado por email.");
      } else {
        setAviso(mensajeNoEnviado(res.motivoNoEnviado));
      }
      await cargar();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "No se pudo completar.",
      );
    } finally {
      setOcupado(false);
    }
  }

  async function corregir(preguntaId: string, valor: Respuesta) {
    if (ocupado) return;
    setOcupado(true);
    setError(null);
    try {
      setVista(
        await apiWithCashier<VistaValoracion>(
          `/clinica/clients/${props.clientId}/valoracion/correcciones`,
          { method: "POST", body: { preguntaId, valor } },
        ),
      );
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "No se pudo corregir.",
      );
    } finally {
      setOcupado(false);
    }
  }

  async function validar() {
    if (ocupado) return;
    setOcupado(true);
    setError(null);
    try {
      setVista(
        await apiWithCashier<VistaValoracion>(
          `/clinica/clients/${props.clientId}/valoracion/validar`,
          { method: "POST", body: { confirmaciones } },
        ),
      );
      setConfirmaciones(CONFIRMACIONES_VACIAS);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "No se pudo validar.",
      );
    } finally {
      setOcupado(false);
    }
  }

  // El veredicto que pinta el botón: lo que el servidor dice que está
  // listo, Y las tres casillas de AQUÍ. Con la misma función pura que usa
  // la API, así que no pueden discrepar.
  const veredicto: Validable = useMemo(() => {
    if (!vista?.valoracion) {
      return {
        puede: false,
        motivo: "NO_RESPONDIDA",
        mensaje: "Este paciente no tiene valoración inicial todavía.",
      };
    }
    if (!vista.validable.puede) return vista.validable;
    return puedeValidarse({
      cuestionario: cuestionarioDeVersion(vista.valoracion.version),
      estado: vista.valoracion.estado,
      confirmaciones,
      respuestasPaciente: vista.respuestasPaciente,
      correcciones: vista.correcciones,
    });
  }, [vista, confirmaciones]);

  if (!props.puedeLeer) {
    return (
      <div className="space-y-3">
        <p className="text-[13px] text-slate-500 leading-relaxed">
          Las respuestas de la valoración sólo las ve el personal sanitario
          con acceso a este paciente. Lo que sí puedes hacer es mandarle el
          test o abrírselo en la tablet.
        </p>
        <BotonesDelTest ocupado={ocupado} onAccion={accion} />
        {aviso && <Aviso>{aviso}</Aviso>}
        {error && <Error>{error}</Error>}
      </div>
    );
  }

  if (cargando) {
    return (
      <div className="flex items-center gap-2 text-[13px] text-slate-500 py-8 justify-center">
        <Loader2 className="w-4 h-4 animate-spin motion-reduce:animate-none" />
        Cargando…
      </div>
    );
  }

  if (error && !vista) return <Error>{error}</Error>;
  if (!vista) return null;

  const v = vista.valoracion;
  const validada = v?.estado === "VALIDADA";

  return (
    <div className="space-y-4">
      {/* ── 1 · estado ─────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-3">
        <div className="text-[13px] text-slate-500 leading-relaxed">
          {!v && "Sin valoración inicial."}
          {v && (
            <>
              Valoración {v.origen === "APPOINTMENT" ? "creada al dar la cita" : `pedida por ${v.pedidaPor ?? "—"}`}
              {" · "}
              {dia(v.creadaEn)}
              {v.respondidaEn && (
                <>
                  <br />
                  Rellenada el {dia(v.respondidaEn)} a las{" "}
                  {hora(v.respondidaEn)}{" "}
                  {v.canal === "TABLET"
                    ? "en la tablet de la sala"
                    : "desde el enlace del email"}
                  {v.respondioPor === "FAMILIAR" && " · respondió un familiar"}
                </>
              )}
            </>
          )}
        </div>
        {v && (
          <span
            className={`shrink-0 inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[12.5px] font-medium ${
              validada
                ? "bg-emerald-50 text-emerald-700"
                : "bg-amber-50 text-amber-700"
            }`}
          >
            {validada ? "Valoración validada" : "Valoración por validar"}
          </span>
        )}
      </div>

      {error && <Error>{error}</Error>}
      {aviso && <Aviso>{aviso}</Aviso>}

      {/* ── Sin valoración: los dos caminos para crearla ───────────── */}
      {!v && (
        <>
          <p className="text-[13px] text-slate-500 leading-relaxed">
            Antes del primer tratamiento hace falta la valoración inicial.
            Mándale el test por email o ábrele la tablet de la sala.
          </p>
          <BotonesDelTest ocupado={ocupado} onAccion={accion} />
        </>
      )}

      {/* ── 2 · la franja de alertas ───────────────────────────────── */}
      {v && <FranjaDeAlertas alertas={vista.alertas} validada={validada} />}

      {/* ── El aviso verde de después de validar ───────────────────── */}
      {v && validada && (
        <div className="flex gap-3 items-start bg-emerald-50 text-emerald-700 rounded-2xl px-4 py-3.5 text-[14px] leading-snug">
          <Check className="w-5 h-5 shrink-0 mt-0.5" strokeWidth={2.25} />
          <span>
            Validada el {dia(v.validadaEn!)} a las {hora(v.validadaEn!)} por{" "}
            {v.validadaPor?.nombre}
            {v.validadaPor?.colegiado ? ` (${v.validadaPor.colegiado})` : ""}.
            {vista.primerTratamiento.puede &&
              " Ya puedes registrar el primer tratamiento."}
          </span>
        </div>
      )}

      {/* ── El enlace vivo, y reenviarlo ───────────────────────────── */}
      {v && v.estado === "PENDIENTE_PACIENTE" && (
        <div className="bg-amber-50 text-amber-700 rounded-2xl px-4 py-3.5 text-[13.5px] leading-snug space-y-3">
          <div>
            El paciente todavía no ha contestado.
            {v.enlace?.activo && v.enlace.caducaEn && (
              <> El enlace que se le mandó vale hasta el {dia(v.enlace.caducaEn)}.</>
            )}
          </div>
          <BotonesDelTest
            ocupado={ocupado}
            onAccion={accion}
            reenviar={v.canal === "EMAIL"}
          />
        </div>
      )}

      {/* ── 3 · las respuestas ─────────────────────────────────────── */}
      {v && v.estado !== "PENDIENTE_PACIENTE" && vista.cuestionario && (
        <FilasDeRespuestas
          vista={vista}
          cuestionario={vista.cuestionario}
          bloqueado={validada || ocupado}
          onCorregir={corregir}
        />
      )}

      {/* ── 4 y 5 · las tres confirmaciones y el botón ─────────────── */}
      {v && v.estado === "RESPONDIDA" && (
        <div className="bg-white border border-slate-200 rounded-3xl px-5 py-5">
          <h2 className="text-[17px] font-semibold tracking-[-0.01em] m-0">
            Antes del primer tratamiento
          </h2>
          <p className="text-[13px] text-slate-500 mt-1 mb-3">
            Confírmalo con el paciente delante.
          </p>
          <div className="grid gap-2.5">
            {(
              Object.keys(vista.textosConfirmacion) as Array<
                keyof Confirmaciones
              >
            ).map((k) => (
              <button
                key={k}
                type="button"
                aria-pressed={confirmaciones[k]}
                onClick={() =>
                  setConfirmaciones((c) => ({ ...c, [k]: !c[k] }))
                }
                className="flex items-center gap-3 min-h-touch-pad px-4 bg-mipiace-stone rounded-2xl text-[14.5px] text-left text-mipiace-ink"
              >
                <span
                  className={`w-6 h-6 rounded-lg border-2 flex items-center justify-center shrink-0 ${
                    confirmaciones[k]
                      ? "bg-mipiace-coral border-mipiace-coral"
                      : "bg-white border-slate-300"
                  }`}
                >
                  {confirmaciones[k] && (
                    <Check className="w-3.5 h-3.5 text-white" strokeWidth={3} />
                  )}
                </span>
                {vista.textosConfirmacion[k]}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-4 mt-5 flex-wrap">
            <button
              type="button"
              disabled={!veredicto.puede || ocupado}
              onClick={validar}
              className="min-h-touch-lg px-7 rounded-[18px] bg-mipiace-coral text-white text-[16px] font-medium disabled:opacity-45 disabled:cursor-not-allowed"
            >
              {ocupado ? "Validando…" : "Validar valoración"}
            </button>
            {/* EL MOTIVO, ESCRITO AL LADO. Un botón gris sin explicación es
                una pantalla que no dice nada, y quien la usa se queda
                tocándolo. */}
            {!veredicto.puede && (
              <span className="text-[13.5px] text-amber-700">
                {veredicto.mensaje}
              </span>
            )}
          </div>
        </div>
      )}

      {/* ── Lo que queda escrito, y cómo se repasa ─────────────────── */}
      {v && validada && (
        <p className="text-[13px] text-slate-500 leading-relaxed">
          Queda en la historia: lo que respondió{" "}
          {v.respondioPor === "FAMILIAR" ? "el familiar" : "el paciente"}, cada
          corrección con su autora y la hora de validación. No se puede
          editar; si algo cambia, se repasa con una valoración nueva.
        </p>
      )}

      {v && vista.anteriores.length > 0 && (
        <p className="text-[13px] text-slate-500">
          Este paciente tiene {vista.anteriores.length + 1} valoraciones en su
          historia.
        </p>
      )}
    </div>
  );
}

// ── La franja de alertas ─────────────────────────────────────────────

function FranjaDeAlertas(props: { alertas: Alertas; validada: boolean }) {
  const { alertas, sinResolver } = props.alertas;
  if (alertas.length === 0 && sinResolver.length === 0) {
    return (
      <div className="bg-mipiace-stone text-slate-500 rounded-2xl px-3.5 py-3 text-[13px]">
        Sin alertas
      </div>
    );
  }
  return (
    <div className="bg-red-50 rounded-2xl px-3.5 py-3 flex flex-wrap gap-2 items-center">
      <span className="text-[11px] uppercase tracking-[0.08em] text-red-700 font-medium mr-1">
        Alertas
      </span>
      {alertas.map((a) => (
        <span
          key={a.preguntaId}
          className="bg-white text-red-700 rounded-xl px-3 py-1.5 text-[13px] font-medium"
        >
          {a.texto}
        </span>
      ))}
      {/* «Por validar» va en la franja y no escondiendo las alertas: una
          podóloga que ve «Anticoagulación · por validar» sabe lo que tiene
          delante; una que no ve nada porque falta un visto bueno, no. */}
      {!props.validada && alertas.length > 0 && (
        <span className="text-[12px] text-red-700/80">· por validar</span>
      )}
      {sinResolver.length > 0 && (
        <span className="inline-flex items-center gap-1.5 text-[12.5px] text-amber-700 bg-amber-50 rounded-xl px-2.5 py-1">
          <AlertTriangle className="w-3.5 h-3.5" strokeWidth={2.25} />
          {sinResolver.length === 1
            ? "1 respuesta sin resolver"
            : `${sinResolver.length} respuestas sin resolver`}
        </span>
      )}
    </div>
  );
}

// ── Las filas de respuestas ──────────────────────────────────────────

function FilasDeRespuestas(props: {
  vista: VistaValoracion;
  cuestionario: Cuestionario;
  bloqueado: boolean;
  onCorregir: (preguntaId: string, valor: Respuesta) => void;
}) {
  const { vista, cuestionario } = props;
  const vigentes = useMemo(() => {
    const m = new Map<string, Correccion>();
    for (const c of vista.correcciones) {
      const previa = m.get(c.preguntaId);
      if (!previa || c.creadaEn >= previa.creadaEn) m.set(c.preguntaId, c);
    }
    return m;
  }, [vista.correcciones]);

  const filas = preguntasEnJuego(
    cuestionario,
    (id) => vigentes.get(id)?.valor ?? vista.respuestasPaciente[id],
  );

  return (
    <div className="bg-white border border-slate-200 rounded-3xl px-5 py-5">
      <h2 className="text-[17px] font-semibold tracking-[-0.01em] m-0">
        Respuestas del test
      </h2>
      <p className="text-[13px] text-slate-500 mt-1 mb-3">
        {props.bloqueado
          ? "Validada: ya no se corrige."
          : "Toca para corregir."}
      </p>
      <div className="flex gap-4 flex-wrap text-[12.5px] text-slate-500 mb-2">
        <span className="inline-flex items-center gap-1.5">
          <i className="inline-block w-3.5 h-3.5 rounded-[5px] bg-mipiace-coral" />
          Lo que respondió el paciente
        </span>
        <span className="inline-flex items-center gap-1.5">
          <i className="inline-block w-3.5 h-3.5 rounded-[5px] bg-mipiace-ink" />
          Tu corrección
        </span>
      </div>

      {filas.map((p, i) => {
        const delPaciente = vista.respuestasPaciente[p.id];
        const correccion = vigentes.get(p.id);
        const valor = correccion?.valor ?? delPaciente ?? "NO_SE";
        const corregida =
          correccion != null && correccion.valor !== delPaciente;
        const detalle = vista.detalles[p.id];
        const preguntaReal = preguntaDe(cuestionario, p.id) ?? p;
        return (
          <div
            key={p.id}
            className={`grid grid-cols-[1fr_auto] gap-3 items-center py-3 ${
              i > 0 ? "border-t border-slate-100" : ""
            } ${
              valor === "SI"
                ? "-mx-5 px-5 bg-gradient-to-r from-mipiace-coral-soft to-transparent to-60%"
                : ""
            }`}
          >
            <div>
              <div
                className={`text-[14.5px] ${
                  valor === "NO_SE" ? "text-amber-700 font-medium" : ""
                }`}
              >
                {preguntaReal.corto}
                {detalle && detalle.length > 0 && ` (${detalle.join(", ")})`}
              </div>
              <div className="text-[12px] text-slate-500 mt-0.5">
                {corregida
                  ? `Paciente: ${ETIQUETA[delPaciente ?? "NO_SE"]} · corregido por ${correccion!.autorNombre}`
                  : vista.valoracion?.respondioPor === "FAMILIAR"
                    ? "Respondió un familiar"
                    : "Respondió el paciente"}
              </div>
            </div>
            <div className="inline-flex bg-mipiace-stone rounded-2xl p-1 gap-1">
              {(["SI", "NO", "NO_SE"] as const).map((opcion) => (
                <button
                  key={opcion}
                  type="button"
                  disabled={props.bloqueado}
                  aria-label={ETIQUETA[opcion]}
                  onClick={() => props.onCorregir(p.id, opcion)}
                  className={`min-w-[56px] h-11 rounded-[11px] text-[14px] font-medium disabled:cursor-not-allowed ${estiloDeBoton(
                    opcion,
                    valor,
                    delPaciente,
                    corregida,
                  )}`}
                >
                  {opcion === "NO_SE" ? "?" : ETIQUETA[opcion]}
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * El color de cada botón de la fila, y es LA pieza visual del bloque:
 *
 *   · sin corrección → el valor del paciente en CORAL RELLENO;
 *   · con corrección → la corrección en OSCURO relleno, y la del paciente
 *     con BORDE CORAL, para que las dos se vean a la vez.
 *
 * Está en una función y no en el JSX porque son cuatro casos y la regla
 * —qué se ve cuando hay corrección— es la decisión de producto 5, no un
 * detalle de estilo.
 */
function estiloDeBoton(
  opcion: Respuesta,
  valor: Respuesta,
  delPaciente: Respuesta | undefined,
  corregida: boolean,
): string {
  if (corregida) {
    if (opcion === valor) return "bg-mipiace-ink text-white font-semibold";
    if (opcion === delPaciente) {
      return "bg-white text-mipiace-coral-dark font-semibold shadow-[inset_0_0_0_2px_#E97058]";
    }
    return "bg-transparent text-slate-400";
  }
  if (opcion === valor) return "bg-mipiace-coral text-white font-semibold";
  return "bg-transparent text-slate-400";
}

// ── Piezas sueltas ───────────────────────────────────────────────────

function BotonesDelTest(props: {
  ocupado: boolean;
  onAccion: (c: "enviar" | "tablet") => void;
  reenviar?: boolean;
}) {
  return (
    <div className="flex gap-2 flex-wrap">
      <button
        type="button"
        disabled={props.ocupado}
        onClick={() => props.onAccion("enviar")}
        className="inline-flex items-center gap-2 min-h-touch px-4 rounded-2xl bg-white border border-slate-200 text-[13.5px] font-medium text-mipiace-ink disabled:opacity-50"
      >
        {props.reenviar ? (
          <RefreshCw className="w-4 h-4" strokeWidth={2.25} />
        ) : (
          <Mail className="w-4 h-4" strokeWidth={2.25} />
        )}
        {props.reenviar ? "Reenviar el test" : "Enviar el test"}
      </button>
      <button
        type="button"
        disabled={props.ocupado}
        onClick={() => props.onAccion("tablet")}
        className="inline-flex items-center gap-2 min-h-touch px-4 rounded-2xl bg-white border border-slate-200 text-[13.5px] font-medium text-mipiace-ink disabled:opacity-50"
      >
        <Tablet className="w-4 h-4" strokeWidth={2.25} />
        Test en la tablet
      </button>
    </div>
  );
}

function mensajeNoEnviado(motivo: string | undefined): string {
  switch (motivo) {
    case "SIN_EMAIL":
      return "Este paciente no tiene email. Ábrele la tablet de la sala: el test queda listo igual.";
    case "EMAIL_INVALIDO":
      return "La dirección de email no es válida. Corrígela en la ficha, o ábrele la tablet.";
    case "FALLO_DEL_CORREO":
      return "No se pudo mandar el correo, pero el test queda preparado. Prueba a reenviarlo o dale la tablet.";
    default:
      return "El test queda preparado.";
  }
}

function Aviso(props: { children: React.ReactNode }) {
  return (
    <div className="text-[13px] text-emerald-700 bg-emerald-50 rounded-xl px-3 py-2.5 leading-snug">
      {props.children}
    </div>
  );
}

function Error(props: { children: React.ReactNode }) {
  return (
    <div
      role="alert"
      className="text-[13px] text-red-700 bg-red-50 rounded-xl px-3 py-2.5 leading-snug"
    >
      {props.children}
    </div>
  );
}
