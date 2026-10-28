// agenda-1 · EL DÍA DE UNA PROFESIONAL, EN LISTA (tablero 1).
//
// Decisión de Matías (D1), 27-10: con UNA profesional el día es una lista
// de filas de altura tocable, con los huecos libres entre medias; con
// varias, la rejilla por columnas del tablero 4.
//
// Por qué no la rejilla: con una sola columna la rejilla deja 208 px de
// agenda y el resto de la tablet en blanco (lo dijo la auditoría del 18-10
// y lo arregló a medias clinica-8 con `flex-1`), y las citas de 10 y 20
// minutos miden 11 y 22 px — rayas que no se tocan con el dedo. En la
// lista una cita de 10 minutos y una de 2 horas ocupan lo mismo: una fila.
// Se pierde la proporción del tiempo y se gana poder tocarla, que es lo
// que la recepción hace con ella.
//
// ── Lo que la rejilla no decía y aquí se dice ────────────────────────
//
//   · EL ESTADO de cada cita (cobrada, en sala, por llegar, no vino,
//     valoración pendiente, queda cobrarla), las hechas atenuadas y la de
//     ahora destacada. En la rejilla el estado era un filete de color de
//     4 px en el borde izquierdo de la tarjeta.
//   · LOS HUECOS LIBRES, con su duración y qué cabe: «Libre 25 min · cabe
//     una Cura o un Papiloma · + Dar cita aquí».
//   · LAS HORAS CERRADAS, plegadas en una línea.
//
// La aritmética de las filas es de `lib/agenda-dia.ts` y se prueba sin
// montar nada. Aquí sólo se pinta.

import { Plus } from "lucide-react";

import {
  ahoraYDespues,
  cifrasDelDia,
  duracionHumana,
  filasDelDia,
  type FilaDelDia,
  type ServicioQueCabe,
  type Tramo,
} from "../lib/agenda-dia.js";
import type {
  AgendaAbsence,
  AgendaAppointment,
  OpenRange,
} from "../lib/agenda.js";
import type { PendienteDeRecepcion } from "../lib/agenda-recepcion.js";

/** El estado de una cita, tal como se lee en su fila. */
export interface EstadoDeLaFila {
  texto: string;
  /** El tono del chip. `ahora` es el único que va en sólido. */
  tono: "hecha" | "ahora" | "porLlegar" | "noVino" | "aviso";
}

/**
 * Qué pone el chip de estado de una fila.
 *
 * El ORDEN importa y es el del daño: lo que hay que hacer antes de que la
 * persona se vaya va delante de lo que ya pasó. Una cita cobrada cuya
 * valoración sigue sin validar dice «Cobrada», porque ahí ya no hay nada
 * que hacer en el mostrador; una que está en sala y tiene la sesión por
 * cobrar dice «Queda cobrarla», que es lo que la recepción tiene que ver.
 */
export function estadoDeLaFila(e: {
  status: AgendaAppointment["status"];
  /** Céntimos cobrados, o `null` si no se sabe (sin red, o sin ticket). */
  cobradoCents: number | null;
  sesionPorCobrar: boolean;
  valoracionPendiente: boolean;
  /** ¿Es la cita que contiene el minuto de ahora? */
  esAhora: boolean;
  pendienteOffline?: boolean;
  rechazada?: boolean;
}): EstadoDeLaFila {
  if (e.rechazada) return { texto: "Rechazada", tono: "noVino" };
  if (e.pendienteOffline) return { texto: "Sin enviar", tono: "aviso" };
  if (e.status === "NO_SHOW") return { texto: "No vino", tono: "noVino" };
  if (e.sesionPorCobrar) return { texto: "Queda cobrarla", tono: "aviso" };
  if (e.status === "COMPLETED") {
    return {
      texto:
        e.cobradoCents != null
          ? `Cobrada · ${euros(e.cobradoCents)}`
          : "Hecha",
      tono: "hecha",
    };
  }
  if (e.status === "IN_SERVICE") return { texto: "En sala", tono: "ahora" };
  if (e.valoracionPendiente) {
    return { texto: "Valoración pendiente", tono: "aviso" };
  }
  if (e.esAhora) return { texto: "Toca ahora", tono: "ahora" };
  return { texto: "Por llegar", tono: "porLlegar" };
}

/** Céntimos → «25 €» / «13,50 €». Sin decimales cuando son redondos: una
 *  tarjeta con «25,00 €» en una columna de tres cifras es ruido. */
export function euros(cents: number): string {
  const e = cents / 100;
  return Number.isInteger(e)
    ? `${e} €`
    : `${e.toFixed(2).replace(".", ",")} €`;
}

const TONOS: Record<EstadoDeLaFila["tono"], string> = {
  hecha: "bg-emerald-50 text-emerald-700",
  ahora: "bg-mipiace-coral text-white",
  porLlegar: "bg-mipiace-stone text-slate-600",
  noVino: "bg-red-50 text-red-700",
  aviso: "bg-amber-100 text-amber-800",
};

function ChipDeEstado(props: { estado: EstadoDeLaFila }) {
  return (
    <span
      data-estado-fila={props.estado.tono}
      className={`shrink-0 text-[12.5px] font-semibold px-2.5 py-1 rounded-xl ${
        TONOS[props.estado.tono]
      }`}
    >
      {props.estado.texto}
    </span>
  );
}

/** "HH:MM" de unos minutos de pared. */
function hhmm(min: number): string {
  const m = Math.max(0, Math.min(24 * 60, Math.round(min)));
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** "HH:MM" → minutos. "24:00" son 1440. */
function minOf(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

function tramosDe(abiertos: OpenRange[] | null | undefined): Tramo[] {
  return (abiertos ?? []).map((r) => ({
    desdeMin: minOf(r.startTime),
    hastaMin: minOf(r.endTime),
  }));
}

export interface DiaEnListaProps {
  /** Las citas de esta profesional, sin canceladas. */
  appts: AgendaAppointment[];
  /** Turno ∩ centro. `null` = este centro no tiene horario configurado. */
  abiertos: OpenRange[] | null;
  ausencias: AgendaAbsence[];
  /** Minutos de pared del inicio de cada cita, y de su fin. */
  minutosDe: (a: AgendaAppointment) => { desdeMin: number; hastaMin: number };
  servicios: ServicioQueCabe[];
  /** El suelo de B-6a. `null` = nada del día ha pasado. */
  sueloMin: number | null;
  /** Minutos de ahora, o `null` si el día no es hoy. */
  ahoraMin: number | null;
  clienteDe: (a: AgendaAppointment) => { nombre: string; desconocido: boolean };
  servicioDe: (a: AgendaAppointment) => string;
  estadoDe: (a: AgendaAppointment, esAhora: boolean) => EstadoDeLaFila;
  /** Una línea de aviso bajo el servicio (p. ej. un trámite que falta). */
  avisoDe?: (a: AgendaAppointment) => string | null;
  onCita: (a: AgendaAppointment) => void;
  onHueco: (minutos: number) => void;
  onAusencia: (ab: AgendaAbsence) => void;
}

/** La lista de filas del día. */
export function DiaEnLista(props: DiaEnListaProps) {
  const porId = new Map(props.appts.map((a) => [a.id, a]));
  const tramos = props.appts.map((a) => ({
    id: a.id,
    ...props.minutosDe(a),
  }));
  const filas = filasDelDia({
    citas: tramos,
    // Sin horario configurado (`abiertos === null`) `tramosDe` da `[]`, y
    // entonces no hay huecos ni líneas de cerrado: sólo las citas. Es lo
    // que hace `StaffColumn` con `open === null` y por lo mismo —
    // inventarse un hueco «libre de 00:00 a 24:00» sería ofrecer una hora
    // que el motor va a rechazar.
    abiertos: tramosDe(props.abiertos),
    ausencias: props.ausencias.map((ab) => ({
      desdeMin: minOf(ab.startTime),
      hastaMin: minOf(ab.endTime),
    })),
    sueloMin: props.sueloMin,
    servicios: props.servicios,
  });
  const { ahora } = ahoraYDespues(tramos, props.ahoraMin);

  return (
    <section
      aria-label="Citas del día"
      data-test="dia-en-lista"
      className="flex-1 min-w-0 bg-white border border-slate-200 rounded-3xl p-2 md:px-5 md:py-3 flex flex-col gap-1.5 overflow-y-auto"
    >
      {filas.length === 0 && (
        <div
          data-test="dia-sin-nada"
          className="text-[13.5px] text-slate-500 text-center py-8"
        >
          Este día no tiene ni citas ni horario.
        </div>
      )}
      {filas.map((f) => (
        <Fila
          key={claveDeFila(f)}
          fila={f}
          cita={f.tipo === "cita" ? (porId.get(f.id) ?? null) : null}
          esAhora={f.tipo === "cita" && f.id === ahora}
          {...props}
        />
      ))}
      {/* Las ausencias del día, al final y tocables para quitarlas. En la
          rejilla son una banda rosa en su hora; en la lista no pueden ser
          una fila más entre las citas porque no son algo que pase: son
          algo que NO pasa, y una fila «de 10:00 a 12:00 · médico» entre
          dos citas se lee como una cita. */}
      {props.ausencias.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1.5">
          {props.ausencias.map((ab) => (
            <button
              key={`${ab.id ?? "sin-id"}-${ab.startTime}`}
              data-ausencia={ab.id ?? "sin-id"}
              onClick={() => props.onAusencia(ab)}
              className="min-h-touch px-3 rounded-2xl bg-rose-50 border border-dashed border-rose-300 text-left text-[12.5px] text-rose-800"
            >
              <b className="font-semibold">{ab.reason ?? "No está"}</b>{" "}
              {ab.startTime === "00:00" && ab.endTime === "24:00"
                ? "todo el día"
                : `${ab.startTime}–${ab.endTime}`}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function claveDeFila(f: FilaDelDia): string {
  return f.tipo === "cita"
    ? `cita-${f.id}`
    : `${f.tipo}-${f.desdeMin}-${f.hastaMin}`;
}

function Fila(
  props: DiaEnListaProps & {
    fila: FilaDelDia;
    cita: AgendaAppointment | null;
    esAhora: boolean;
  },
) {
  const { fila } = props;

  if (fila.tipo === "cerrado") {
    return (
      <div
        data-test="horas-cerradas"
        data-cerrado-desde={hhmm(fila.desdeMin)}
        className="shrink-0 text-[12.5px] text-slate-400 text-center py-2"
      >
        {fila.hastaMin >= 24 * 60
          ? `Cerrado desde las ${hhmm(fila.desdeMin)}`
          : `Cerrado de ${hhmm(fila.desdeMin)} a ${hhmm(fila.hastaMin)}`}
      </div>
    );
  }

  if (fila.tipo === "hueco") {
    // Un hueco que ya pasó se ve pero no se ofrece: tocarlo sería un 409
    // (BOOKING_IN_PAST) con la paciente delante. Es `<div>` y no `<button>`
    // apagado a propósito — un botón desactivado invita a tocarlo.
    if (!fila.reservable) {
      return (
        <div
          data-hueco-pasado={hhmm(fila.desdeMin)}
          className="shrink-0 flex items-center gap-4 min-h-[44px] opacity-55"
        >
          <div className="w-16 shrink-0 text-[14.5px] font-semibold text-slate-400 tabular-nums">
            {hhmm(fila.desdeMin)}
          </div>
          <div className="flex-1 min-w-0 text-[14px] text-slate-500">
            Se fueron {duracionHumana(fila.duracionMin)} sin vender
          </div>
        </div>
      );
    }
    return (
      <button
        data-hueco={hhmm(fila.desdeMin)}
        data-hueco-min={String(fila.desdeMin)}
        onClick={() => props.onHueco(fila.desdeMin)}
        className="shrink-0 flex items-center gap-4 min-h-touch text-left"
      >
        <div className="w-16 shrink-0 text-[14.5px] font-semibold text-slate-400 tabular-nums">
          {hhmm(fila.desdeMin)}
        </div>
        {/* `min-w-0` en el hijo flexible, o el nombre del servicio más
            largo ensancha la fila y el chip de la derecha se sale. Y
            `flex-wrap` para que con el panel de «Dar cita» abierto —que
            deja la lista en la mitad— el texto baje de línea en vez de
            pisarse con la fila de al lado. */}
        <div className="flex-1 min-w-0 flex items-center gap-x-2 gap-y-0.5 flex-wrap border-2 border-dashed border-slate-300 rounded-2xl px-4 py-2.5">
          <span className="text-[14.5px] text-slate-700">
            Libre {duracionHumana(fila.duracionMin)}
          </span>
          {fila.cabe.length > 0 && (
            <span className="text-[13.5px] text-slate-500">
              · cabe {unaDeEstas(fila.cabe)}
            </span>
          )}
          <span className="ml-auto shrink-0 text-[13.5px] font-semibold text-mipiace-coral-dark flex items-center gap-1">
            <Plus className="w-4 h-4" strokeWidth={2.4} aria-hidden />
            Dar cita aquí
          </span>
        </div>
      </button>
    );
  }

  const a = props.cita;
  if (!a) return null;
  const cl = props.clienteDe(a);
  const estado = props.estadoDe(a, props.esAhora);
  const aviso = props.avisoDe?.(a) ?? null;
  // «Hecha» incluye cobrada, no-show y la sesión ya cerrada: lo que ya no
  // va a pasar se atenúa para que la de ahora y las que vienen destaquen.
  const pasada =
    a.status === "COMPLETED" || a.status === "NO_SHOW" || estado.tono === "hecha";
  const duracion = fila.hastaMin - fila.desdeMin;

  return (
    <button
      data-cita={a.id}
      data-fila-ahora={props.esAhora ? "1" : undefined}
      onClick={() => props.onCita(a)}
      className={`shrink-0 flex items-center gap-4 text-left rounded-2xl px-2 -mx-2 ${
        props.esAhora
          ? "min-h-[72px] bg-mipiace-coral-soft"
          : "min-h-touch-lg"
      } ${pasada && !props.esAhora ? "opacity-55" : ""}`}
    >
      <div
        className={`w-16 shrink-0 tabular-nums ${
          props.esAhora
            ? "text-[15px] font-bold text-mipiace-coral-dark"
            : "text-[14.5px] font-semibold text-slate-600"
        }`}
      >
        {hhmm(fila.desdeMin)}
      </div>
      <div className="flex-1 min-w-0">
        <div
          className={`truncate ${
            props.esAhora
              ? "text-[17px] font-bold text-mipiace-ink"
              : "text-[16px] font-semibold text-mipiace-ink"
          }`}
        >
          {cl.desconocido ? (
            <span data-cliente-desconocido className="font-normal italic">
              {cl.nombre}
            </span>
          ) : (
            cl.nombre
          )}
        </div>
        <div className="text-[13.5px] text-slate-600 truncate">
          {props.servicioDe(a)} · {duracionHumana(duracion)}
          {/* Una cita larga dice a qué hora acaba: es lo que la recepción
              le lee a la siguiente paciente que pregunta. */}
          {duracion >= 60 ? ` · hasta las ${hhmm(fila.hastaMin)}` : ""}
        </div>
        {aviso && (
          <div className="text-[12.5px] text-amber-700 leading-snug">
            {aviso}
          </div>
        )}
      </div>
      <ChipDeEstado estado={estado} />
    </button>
  );
}

/** «una Cura», «una Cura o un Papiloma». Sin artículos inventados: el
 *  nombre del servicio es el del catálogo del centro. */
function unaDeEstas(nombres: string[]): string {
  return nombres.join(" o ");
}

// ── La columna izquierda del tablero 1 ────────────────────────────────

export interface ColumnaDelDiaProps {
  /** La cita en curso, o `null`. */
  ahora: AgendaAppointment | null;
  /** La siguiente, o `null`. */
  despues: AgendaAppointment | null;
  clienteDe: (a: AgendaAppointment) => { nombre: string; desconocido: boolean };
  servicioDe: (a: AgendaAppointment) => string;
  minutosDe: (a: AgendaAppointment) => { desdeMin: number; hastaMin: number };
  estadoDe: (a: AgendaAppointment, esAhora: boolean) => EstadoDeLaFila;
  /** ¿Se ofrece abrir la sesión de la cita en curso? */
  onAbrirSesion?: (a: AgendaAppointment) => void;
  /** El rótulo del botón fuerte de «Ahora». */
  rotuloDeSesion?: string;
  pendientes: PendienteDeRecepcion[];
  /** El nombre de un paciente por su id, para los pendientes. */
  nombreDeCliente: (clientId: string) => string;
  onPendiente: (p: PendienteDeRecepcion) => void;
  /** Las tres cifras. `cobradoCents` a `null` = sin red: no se enseña. */
  cifras: ReturnType<typeof cifrasDelDia>;
  cobradoCents: number | null;
  /** ¿Libre hasta cuándo? Sólo si no hay nada en curso. */
  libreHasta: string | null;
}

export function ColumnaDelDia(props: ColumnaDelDiaProps) {
  const { ahora, despues } = props;
  return (
    <aside
      data-test="columna-del-dia"
      className="w-full md:w-[340px] lg:w-[380px] shrink-0 flex flex-col gap-3 overflow-y-auto"
    >
      {/* AHORA. La tarjeta más grande de la pantalla y la única con borde
          de color: la pregunta que la recepción se hace al levantar la
          vista es «¿qué toca ahora?». */}
      {ahora ? (
        <div
          data-test="tarjeta-ahora"
          className="bg-white border-2 border-mipiace-coral rounded-3xl px-5 py-4 flex flex-col gap-2"
        >
          <div className="text-[11.5px] font-semibold tracking-[0.08em] uppercase text-mipiace-coral-dark">
            Ahora · {props.estadoDe(ahora, true).texto.toLowerCase()}
          </div>
          <div className="text-[23px] font-bold leading-tight text-mipiace-ink">
            {props.clienteDe(ahora).nombre}
          </div>
          <div className="text-[14.5px] text-slate-600">
            {hhmm(props.minutosDe(ahora).desdeMin)} · {props.servicioDe(ahora)}
          </div>
          {props.onAbrirSesion && (
            <button
              data-test="ahora-abrir-sesion"
              onClick={() => props.onAbrirSesion!(ahora)}
              className="mt-1 h-touch-lg rounded-2xl bg-mipiace-coral hover:bg-mipiace-coral-dark text-white text-[16px] font-semibold"
            >
              {props.rotuloDeSesion ?? "Abrir sesión"}
            </button>
          )}
        </div>
      ) : (
        <div
          data-test="tarjeta-ahora-libre"
          className="bg-white border border-slate-200 rounded-3xl px-5 py-4"
        >
          <div className="text-[11.5px] font-semibold tracking-[0.08em] uppercase text-slate-500">
            Ahora
          </div>
          <div className="text-[18px] font-semibold text-mipiace-ink mt-1">
            {props.libreHasta
              ? `Libre hasta las ${props.libreHasta}`
              : "Nada en curso"}
          </div>
        </div>
      )}

      {/* DESPUÉS. Una línea: quién, a qué hora y en qué estado. */}
      {despues && (
        <div
          data-test="tarjeta-despues"
          className="bg-white border border-slate-200 rounded-3xl px-5 py-3.5 flex items-center gap-3"
        >
          <div className="flex-1 min-w-0">
            <div className="text-[11.5px] font-semibold tracking-[0.08em] uppercase text-slate-500">
              Después
            </div>
            <div className="text-[16px] font-semibold text-mipiace-ink truncate">
              {hhmm(props.minutosDe(despues).desdeMin)} ·{" "}
              {props.clienteDe(despues).nombre}
            </div>
            <div className="text-[13.5px] text-slate-500 truncate">
              {props.servicioDe(despues)}
            </div>
          </div>
          <ChipDeEstado estado={props.estadoDe(despues, false)} />
        </div>
      )}

      {/* PENDIENTE DE RECEPCIÓN. Ver `lib/agenda-recepcion.ts`: la lista
          sale de una función para que el cuarto pendiente sea una entrada
          más y no un bloque de JSX nuevo. */}
      {props.pendientes.length > 0 && (
        <div
          data-test="pendiente-de-recepcion"
          className="bg-amber-50 border border-amber-200 rounded-3xl px-5 py-4 flex flex-col gap-2.5"
        >
          <div className="text-[11.5px] font-semibold tracking-[0.08em] uppercase text-amber-800">
            Pendiente de recepción
          </div>
          {props.pendientes.map((p) => (
            <div key={p.clave} className="flex items-center gap-3">
              <div className="flex-1 min-w-0 text-[14px] leading-snug text-mipiace-ink">
                <b className="font-semibold">
                  {props.nombreDeCliente(p.clientId)}
                </b>{" "}
                {p.texto}
              </div>
              <button
                data-pendiente={p.clave}
                // El MISMO gancho que la banda de la rejilla (ver
                // `AgendaPage.tsx`): el pendiente se pinta en dos sitios
                // según el layout y un banco no tiene por qué saber en
                // cuál está mirando.
                data-test={`dar-proxima-cita-${p.appointmentId ?? p.clientId}`}
                onClick={() => props.onPendiente(p)}
                className={`shrink-0 min-h-touch px-4 rounded-2xl text-[13.5px] font-semibold ${
                  p.accion === "DAR_CITA"
                    ? "bg-mipiace-ink text-white"
                    : "bg-white border border-slate-300 text-mipiace-ink"
                }`}
              >
                {p.boton}
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex-1" />

      {/* Las tres cifras del día. Abajo y pequeñas: son el resumen, no la
          acción. `tabular-nums` porque se actualizan solas y una cifra que
          baila al cobrarse una cita se lee como un fallo. */}
      <div data-test="cifras-del-dia" className="flex gap-2.5">
        <Cifra
          valor={String(props.cifras.citas)}
          pie={`${props.cifras.citas === 1 ? "cita" : "citas"} · ${
            props.cifras.hechas
          } ${props.cifras.hechas === 1 ? "hecha" : "hechas"}`}
        />
        {/* Sin red no hay importe: ver `cobradoPorCita` en `lib/agenda.ts`.
            Un «0 €» sería un número que parece bueno y no lo es. */}
        <Cifra
          valor={props.cobradoCents == null ? "—" : euros(props.cobradoCents)}
          pie="cobrado"
        />
        <Cifra
          valor={duracionHumana(props.cifras.minutosLibres)}
          pie="libres"
        />
      </div>
    </aside>
  );
}

function Cifra(props: { valor: string; pie: string }) {
  return (
    <div className="flex-1 min-w-0 bg-white border border-slate-200 rounded-2xl px-3.5 py-2.5">
      <div className="text-[20px] font-bold text-mipiace-ink tabular-nums truncate">
        {props.valor}
      </div>
      <div className="text-[12px] text-slate-500 leading-snug">{props.pie}</div>
    </div>
  );
}

/**
 * «Libre hasta las 11:00», para la tarjeta de Ahora y para la cabecera de
 * cada columna del tablero 4.
 *
 * `null` = no hay nada más por delante hoy. La pantalla dice «Nada en
 * curso» y no una hora inventada.
 */
export function libreHastaLas(
  citas: Array<{ desdeMin: number }>,
  ahoraMin: number | null,
): string | null {
  if (ahoraMin == null) return null;
  const siguiente = citas
    .map((c) => c.desdeMin)
    .filter((m) => m > ahoraMin)
    .sort((a, b) => a - b)[0];
  return siguiente == null ? null : hhmm(siguiente);
}
