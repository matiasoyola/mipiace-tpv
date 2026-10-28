// agenda-1 · LA SEMANA EN COLUMNAS DE DÍA (tablero 2).
//
// «¿Cuándo tienes hueco?» es media agenda de un centro de cita previa, y
// hasta este bloque se contestaba tocando día por día y acordándose de lo
// que se había visto. Esto lo pone todo delante: los días que ABRE el
// centro en columnas, con las citas y los huecos dentro, hoy destacado.
//
// Dos gestos y nada más:
//   · tocar la CABECERA de un día → su vista de día;
//   · tocar un HUECO → «Dar cita» con ese día y esa hora puestos.
//
// ── Las tarjetas son de altura mínima tocable ────────────────────────
//
// Y por tanto NO son proporcionales al tiempo. Una semana a escala es la
// rejilla, y la rejilla a cinco días deja las citas de 15 minutos en rayas
// de 11 px — el fallo que este bloque va a arreglar, repetido cinco veces.
// Lo que la semana tiene que contestar no es «cuánto dura» sino «qué día
// está más vacío», y para eso basta el orden y la cifra de la cabecera.
//
// ── Sin red no se pinta, y lo dice ───────────────────────────────────
//
// `fetchAgendaRange` no pasa por la caché offline (ver su nota). La semana
// es una pantalla de planificar, no de atender: la que hay que poder mirar
// sin red es la del día, y ésa sigue saliendo de la caché.

import { Loader2, Plus } from "lucide-react";

import { duracionHumana, filasDelDia, type Tramo } from "../lib/agenda-dia.js";
import {
  diaCortoDeLaSemana,
  resumenDeDia,
} from "../lib/agenda-semana.js";
import type {
  AgendaAbsence,
  AgendaAppointment,
  OpenRange,
} from "../lib/agenda.js";

/** Lo que la semana necesita de cada día. */
export interface DiaDeLaSemana {
  fecha: string;
  /** Turno ∩ centro de las columnas que se pintan. `null` = sin horario. */
  abiertos: OpenRange[] | null;
  cerrado: { name: string | null } | null;
  ausencias: AgendaAbsence[];
  citas: AgendaAppointment[];
}

function minOf(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

function hhmm(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}

function tramosDe(abiertos: OpenRange[] | null | undefined): Tramo[] {
  return (abiertos ?? []).map((r) => ({
    desdeMin: minOf(r.startTime),
    hastaMin: minOf(r.endTime),
  }));
}

export interface SemanaProps {
  dias: DiaDeLaSemana[];
  hoy: string;
  /** El día que se estaba viendo, para marcarlo si no es hoy. */
  elegido: string;
  cargando: boolean;
  /** `null` = hay semana. Si no, el motivo por el que no se pinta. */
  error: string | null;
  clienteDe: (a: AgendaAppointment) => { nombre: string; desconocido: boolean };
  servicioDe: (a: AgendaAppointment) => string;
  minutosDe: (a: AgendaAppointment) => { desdeMin: number; hastaMin: number };
  /** El suelo de cada día: `null` = futuro, `Infinity` = ya pasó. */
  sueloDe: (fecha: string) => number | null;
  /** ¿Está cobrada? Para teñir la tarjeta como en el diseño. */
  cobradaDe: (a: AgendaAppointment) => boolean;
  onDia: (fecha: string) => void;
  onHueco: (fecha: string, minutos: number) => void;
  onCita: (a: AgendaAppointment) => void;
}

export function SemanaEnColumnas(props: SemanaProps) {
  if (props.cargando) {
    return (
      <div className="flex-1 flex items-center justify-center gap-2 text-[13.5px] text-slate-500">
        <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> Cargando la
        semana…
      </div>
    );
  }
  if (props.error) {
    return (
      <div
        data-test="semana-sin-red"
        className="flex-1 flex items-center justify-center p-8 text-center text-[14px] text-slate-500 max-w-md mx-auto"
      >
        {props.error}
      </div>
    );
  }
  // Los días que ABRE el centro. Una semana de vacaciones no son cinco
  // columnas vacías: es una frase.
  const abiertos = props.dias.filter(
    (d) => !d.cerrado && tramosDe(d.abiertos).length > 0,
  );
  if (abiertos.length === 0) {
    return (
      <div
        data-test="semana-cerrada"
        className="flex-1 flex items-center justify-center p-8 text-center text-[14px] text-slate-500 max-w-md mx-auto"
      >
        Esta semana el centro no abre ningún día.
      </div>
    );
  }
  return (
    <div
      data-test="semana"
      className="flex-1 min-h-0 grid gap-2.5 p-3 md:p-5 overflow-x-auto"
      // Columnas de verdad, una por día que abre. `minmax(0, 1fr)` para
      // que los nombres largos no ensanchen la columna: ver la nota de
      // `min-w-0` más abajo.
      style={{
        gridTemplateColumns: `repeat(${abiertos.length}, minmax(160px, 1fr))`,
      }}
    >
      {abiertos.map((d) => (
        <ColumnaDeDia key={d.fecha} dia={d} {...props} />
      ))}
    </div>
  );
}

function ColumnaDeDia(props: SemanaProps & { dia: DiaDeLaSemana }) {
  const { dia } = props;
  const esHoy = dia.fecha === props.hoy;
  const pasado = dia.fecha < props.hoy;
  const tramos = dia.citas.map((a) => ({ id: a.id, ...props.minutosDe(a) }));
  const porId = new Map(dia.citas.map((a) => [a.id, a]));
  const filas = filasDelDia({
    citas: tramos,
    abiertos: tramosDe(dia.abiertos),
    ausencias: dia.ausencias.map((ab) => ({
      desdeMin: minOf(ab.startTime),
      hastaMin: minOf(ab.endTime),
    })),
    sueloMin: props.sueloDe(dia.fecha),
    // En la semana no se dice qué cabe: la columna mide 160 px y «cabe una
    // Cura o un Papiloma» no entra. Eso es del día.
    servicios: [],
  });
  const minutosLibres = filas.reduce(
    (s, f) => (f.tipo === "hueco" && f.reservable ? s + f.duracionMin : s),
    0,
  );
  const resumen = resumenDeDia({
    fecha: dia.fecha,
    citas: tramos,
    abiertos: tramosDe(dia.abiertos),
    minutosLibres,
  });

  return (
    <section
      aria-label={`${diaCortoDeLaSemana(dia.fecha)}${esHoy ? ", hoy" : ""}`}
      data-dia-semana={dia.fecha}
      // `min-w-0` en el hijo de un grid: sin él `truncate` no corta y la
      // columna se ensancha con el nombre más largo (lo cogió el bucle
      // visual en la sala, `scrollWidth` mentía con 390/390).
      className={`min-w-0 flex flex-col gap-1.5 rounded-3xl bg-white overflow-y-auto ${
        esHoy
          ? "border-2 border-mipiace-coral p-3"
          : "border border-slate-200 p-3.5"
      } ${pasado ? "opacity-60" : ""}`}
    >
      <button
        data-ir-al-dia={dia.fecha}
        onClick={() => props.onDia(dia.fecha)}
        className="text-left min-h-touch shrink-0"
      >
        <div className="text-[15.5px] font-bold text-mipiace-ink">
          {diaCortoDeLaSemana(dia.fecha)}
          {esHoy && (
            <span className="text-mipiace-coral-dark"> · Hoy</span>
          )}
          {!esHoy && dia.fecha === props.elegido && (
            <span className="text-slate-400"> · visto</span>
          )}
        </div>
        <div className="text-[12.5px] text-slate-500">{resumen.texto}</div>
      </button>

      {filas.map((f) => {
        if (f.tipo === "cerrado") return null;
        if (f.tipo === "hueco") {
          if (!f.reservable) return null;
          return (
            <button
              key={`h-${f.desdeMin}`}
              data-hueco-semana={`${dia.fecha} ${hhmm(f.desdeMin)}`}
              onClick={() => props.onHueco(dia.fecha, f.desdeMin)}
              className="shrink-0 min-h-touch rounded-2xl border-2 border-dashed border-slate-300 px-2.5 py-1.5 text-left text-[12.5px] text-slate-600 flex items-center gap-1"
            >
              <Plus className="w-3.5 h-3.5 shrink-0" strokeWidth={2.4} aria-hidden />
              <span className="min-w-0 truncate">
                {hhmm(f.desdeMin)} · libre {duracionHumana(f.duracionMin)}
              </span>
            </button>
          );
        }
        const a = porId.get(f.id);
        if (!a) return null;
        const cobrada = props.cobradaDe(a);
        return (
          <button
            key={`c-${a.id}`}
            data-cita-semana={a.id}
            onClick={() => props.onCita(a)}
            className={`shrink-0 min-h-touch rounded-2xl px-2.5 py-1.5 text-left ${
              a.status === "IN_SERVICE"
                ? "bg-mipiace-coral text-white"
                : a.status === "NO_SHOW"
                  ? "bg-red-50"
                  : cobrada
                    ? "bg-emerald-50"
                    : "bg-slate-50"
            }`}
          >
            <div
              className={`text-[13px] font-semibold truncate ${
                a.status === "IN_SERVICE" ? "" : "text-mipiace-ink"
              }`}
            >
              {hhmm(f.desdeMin)} · {props.clienteDe(a).nombre}
            </div>
            <div
              className={`text-[12px] truncate ${
                a.status === "IN_SERVICE"
                  ? ""
                  : cobrada
                    ? "text-emerald-700"
                    : "text-slate-500"
              }`}
            >
              {a.status === "IN_SERVICE"
                ? "En sala"
                : a.status === "NO_SHOW"
                  ? "No vino"
                  : cobrada
                    ? "Cobrada"
                    : props.servicioDe(a)}
            </div>
          </button>
        );
      })}
    </section>
  );
}
