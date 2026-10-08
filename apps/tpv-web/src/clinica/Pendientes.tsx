// clinica-5 · «HOY TOCA», «PARA LA PRÓXIMA VISITA» y el diálogo del
// cierre.
//
// Las tres piezas de la decisión 10, que es la que convierte la sesión en
// una cadena: lo que se deja apuntado hoy sale arriba la próxima vez, se
// marca hecho solo al hacerlo, y si al cerrar sigue sin hacerse, el
// programa pregunta.
//
// ── La banda se PULSA, y por qué ─────────────────────────────────────
//
// El mockup la pinta como un botón y lo es: tocarla marca el pendiente
// hecho a mano. Hace falta porque el cierre automático sólo cubre lo que
// el programa puede ver —tocar la zona, valorar la herida, marcar el
// tipo— y hay maneras de revisar una uña que no pasan por ninguna de las
// tres («la miré, está perfecta, no toco nada»).
//
// Lo que NO se puede hacer desde aquí es desmarcar lo que se cerró SOLO:
// si la podóloga ha tocado la zona, la zona está tocada, y un botón que
// permitiera decir que no sería un botón para mentirle a la historia. El
// servidor tampoco lo aceptaría — recalcula el cierre automático con las
// marcas de verdad.

import { Check, Clock } from "lucide-react";

import {
  pendienteLegible,
  type PendienteCreado,
  type FormaDeCierre,
} from "@mipiacetpv/clinica-sesion";

import { Chip, Seccion, cuantoHace } from "./piezas.js";

/** Un pendiente con lo que la pantalla necesita saber de él. */
export interface PendienteEnPantalla {
  pendiente: PendienteCreado;
  /** Cómo se cerró solo, o `null`. */
  solo: FormaDeCierre | null;
  /** `true` si la podóloga lo ha marcado a mano. */
  aMano: boolean;
}

// ── La banda de arriba ───────────────────────────────────────────────

export function BandaDeHoyToca(props: {
  pendientes: readonly PendienteEnPantalla[];
  mapaVersion: number;
  onMarcar: (p: PendienteCreado) => void;
}) {
  if (props.pendientes.length === 0) return null;
  return (
    <div className="space-y-2" data-test="hoy-toca">
      {props.pendientes.map((x) => {
        const l = pendienteLegible(x.pendiente, { mapa: props.mapaVersion });
        const hecho = x.solo != null || x.aMano;
        return (
          <button
            key={`${l.id}|${x.pendiente.zona ?? ""}`}
            type="button"
            aria-pressed={hecho}
            // Lo cerrado SOLO no se puede desmarcar: ver la cabecera.
            disabled={x.solo != null}
            onClick={() => props.onMarcar(x.pendiente)}
            className={`w-full text-left flex items-center gap-3 rounded-[18px] px-4 py-3 ${
              hecho
                ? "bg-emerald-50 text-emerald-800"
                : "bg-gradient-to-br from-[#FF9A76] to-mipiace-coral text-white shadow-[0_8px_20px_rgba(233,112,88,0.3)]"
            } disabled:cursor-default`}
          >
            <span
              className={`w-9 h-9 rounded-xl shrink-0 flex items-center justify-center ${
                hecho ? "bg-white/90" : "bg-white/95"
              }`}
            >
              {hecho ? (
                <Check
                  className="w-5 h-5 text-emerald-700"
                  strokeWidth={3}
                  aria-hidden
                />
              ) : (
                <Clock
                  className="w-5 h-5 text-mipiace-coral-dark"
                  strokeWidth={2.5}
                  aria-hidden
                />
              )}
            </span>
            <span className="min-w-0">
              <b className="block text-[16px] font-semibold">
                {hecho ? `Hecho: ${l.titulo.toLowerCase()}` : `Hoy toca: ${l.titulo}`}
              </b>
              <span className="block text-[13px] opacity-90">
                {hecho
                  ? textoDelCierre(x)
                  : [
                      l.zona,
                      l.nota,
                      `apuntado ${cuantoHace(l.desde)}`,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

function textoDelCierre(x: PendienteEnPantalla): string {
  switch (x.solo) {
    case "ZONA":
      return "Se ha marcado solo al tocar esa zona del pie";
    case "HERIDA":
      return "Se ha marcado solo al valorar la herida";
    case "TIPO":
      return "Se ha marcado solo por el tipo de visita de hoy";
    default:
      return "Marcado a mano. Se quita del resumen del paciente";
  }
}

// ── «Para la próxima visita» ─────────────────────────────────────────

export interface PendienteNuevo {
  id: string;
  zona: string | null;
  nota: string | null;
}

export function ParaLaProxima(props: {
  clases: readonly {
    id: string;
    label: string;
    pideZona: boolean;
    pideNota: boolean;
  }[];
  elegidos: readonly PendienteNuevo[];
  /** La zona abierta en el mapa, si hay alguna: es la que se le pone al
   *  pendiente que pide zona. */
  zonaAbierta: string | null;
  nombreDeZona: (clave: string) => string;
  onAlternar: (id: string) => void;
  onNota: (id: string, nota: string) => void;
}) {
  return (
    <Seccion titulo="Para la próxima visita">
      <div className="flex flex-wrap gap-2">
        {props.clases.map((c) => {
          const puesto = props.elegidos.find((e) => e.id === c.id);
          // Una clase que pide zona y no hay ninguna tocada no se puede
          // apuntar: «revisar la uña operada» sin decir cuál no se cierra
          // sola nunca, porque no hay zona que tocar. Es mejor pedir el
          // toque que guardar un pendiente que no se puede cumplir.
          const sinZona = c.pideZona && props.zonaAbierta == null && !puesto;
          return (
            <Chip
              key={c.id}
              on={puesto != null}
              suave
              disabled={sinZona}
              onClick={() => props.onAlternar(c.id)}
            >
              {c.label}
              {puesto?.zona && (
                <span className="font-normal opacity-80">
                  {" "}
                  · {props.nombreDeZona(puesto.zona)}
                </span>
              )}
            </Chip>
          );
        })}
      </div>
      {props.clases.some((c) => c.pideZona) &&
        props.zonaAbierta == null &&
        !props.elegidos.some((e) => e.zona != null) && (
          <p className="text-[12.5px] text-slate-500 mt-2 leading-relaxed">
            Toca primero la zona del pie para apuntar lo de la uña o los
            puntos: si no, la próxima vez no se podría marcar hecho solo.
          </p>
        )}
      {props.elegidos
        .filter((e) => props.clases.find((c) => c.id === e.id)?.pideNota)
        .map((e) => (
          <input
            key={e.id}
            value={e.nota ?? ""}
            onChange={(ev) => props.onNota(e.id, ev.target.value)}
            maxLength={200}
            placeholder="Qué queda pendiente (una línea)"
            className="w-full h-touch rounded-2xl border border-slate-200 bg-mipiace-stone px-3 text-[16px] mt-2"
          />
        ))}
    </Seccion>
  );
}

// ── El diálogo del cierre ────────────────────────────────────────────

/**
 * «¿Has revisado la uña operada?» · Sí, revisada / Todavía no.
 *
 * Sale al pulsar «Cerrar sesión» con un pendiente sin hacer, y pregunta de
 * uno en uno. La podóloga no puede cerrar sin contestar, y es el punto:
 * el prompt pide que *no le deje cerrar sin haber hecho lo que tocaba hoy
 * **sin preguntárselo***.
 *
 * Contestar «todavía no» SÍ cierra la sesión — lo que hace es que el
 * pendiente pase a la siguiente. No es un bloqueo: es que nadie se entere
 * tarde.
 */
export function DialogoDePendiente(props: {
  pendiente: PendienteCreado;
  mapaVersion: number;
  /** Cuántos quedan después de éste, para que se sepa que hay más. */
  quedan: number;
  ocupado: boolean;
  onSi: () => void;
  onNo: () => void;
}) {
  const l = pendienteLegible(props.pendiente, { mapa: props.mapaVersion });
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={l.pregunta}
      data-test="dialogo-de-pendiente"
      className="fixed inset-0 z-50 bg-slate-900/45 flex items-center justify-center p-5"
    >
      <div className="bg-white rounded-[26px] p-6 max-w-[440px] w-full">
        <h3 className="text-[20px] font-semibold m-0 text-mipiace-ink">
          {l.pregunta}
        </h3>
        <p className="text-[14px] text-mipiace-ink-soft mt-1.5 leading-relaxed">
          Estaba pendiente para hoy
          {l.zona ? ` · ${l.zona}` : ""} · apuntado {cuantoHace(l.desde)}.
          {l.nota ? ` «${l.nota}».` : ""}
          {props.quedan > 0 &&
            ` Quedan ${props.quedan} más por contestar.`}
        </p>
        <div className="flex gap-2 mt-4">
          <button
            type="button"
            onClick={props.onNo}
            disabled={props.ocupado}
            className="flex-1 h-touch-lg rounded-2xl bg-mipiace-stone text-mipiace-ink font-medium text-[15px] disabled:opacity-45"
          >
            Todavía no
          </button>
          <button
            type="button"
            onClick={props.onSi}
            disabled={props.ocupado}
            className="flex-1 h-touch-lg rounded-2xl bg-mipiace-coral text-white font-medium text-[15px] disabled:opacity-45"
          >
            Sí, hecho
          </button>
        </div>
        <p className="text-[12.5px] text-slate-500 mt-3 leading-relaxed">
          Con «todavía no» la sesión se cierra igual y esto pasa a la
          próxima visita. No se pierde.
        </p>
      </div>
    </div>
  );
}
