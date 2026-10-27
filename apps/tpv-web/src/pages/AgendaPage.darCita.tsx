// agenda-1 · DAR CITA, EN DOS TOQUES (tablero 3).
//
// Matías, 27-10: «no me gusta nada cómo hacemos lo de la cita, me parece
// súper tedioso… en el spa lo hemos optimizado mejor… tenemos que
// reducirlo a la mínima expresión». Medido ese día en la Lenovo: **~10
// toques** por «Nueva cita» (paso 7 de la pasada) y **5** tocando la
// rejilla (paso 11).
//
// Este panel es el embudo del spa traído a la capa común, con la MECÁNICA
// y no el vocabulario: ni cabinas, ni «relajarse», ni €/h, ni frases de
// venta. Cuatro preguntas que se contestan de arriba abajo y SE PLIEGAN en
// cuanto están contestadas, con lo que el sistema ya sabe puesto:
//
//   1. ¿Quién?            · móvil primero; si no tiene ficha, se crea con
//                           lo tecleado.
//   2. ¿Qué viene a hacer? · lo de hoy, su último, o la lista entera.
//   3. ¿Cuándo?           · la fecha propuesta, esta semana, otra.
//   4. Mejores horas      · ordenadas por `proponer()`, no por reloj.
//
// Y un pie fijo con el resumen y «Reservar».
//
// ── La cuenta de los toques, que es el objetivo del bloque ───────────
//
// · Desde «Dársela» (la paciente acaba de pagar y sigue delante): el panel
//   abre con paciente, servicio y fecha PUESTOS y las horas ya buscadas.
//   Toque 1 = la hora. Toque 2 = Reservar. **Dos.**
// · Desde un hueco tocado con el panel ya abierto: la hora entra en el
//   borrador que ya había. Toque 1 = Reservar. **Uno.**
// · Desde «Dar cita» en frío: quién (2: abrir el selector y elegir), qué
//   (1), cuándo (1), hora (1), Reservar (1). **Seis**, y de ésos dos son
//   el selector de pacientes, que es el mismo de siempre.
//
// ── H8 · tocar un hueco NO borra la paciente ─────────────────────────
//
// Pasada del 27-10, hallazgo H8: tras «Dársela ahora», tocar una hora en
// la rejilla reabría «Nueva cita» EN BLANCO. Eran dos superficies: la
// banda ponía un borrador y el toque en la rejilla creaba otro desde cero.
// Con este panel no puede pasar porque es UNA superficie: el toque en un
// hueco sólo escribe `start` en el borrador que haya (ver `openSlotFirst`
// en `AgendaPage.tsx`). Lo fija un test.
//
// ── Lo que NO sale, y por qué ────────────────────────────────────────
//
// El diseño enseña un chip «Control de pie de riesgo · Lo propuso Rosario
// · 20 min». La propuesta que la sanitaria deja al cerrar la sesión son
// SEMANAS (`S2`/`S4`/`S8`, ver `clinica/proxima-cita.ts`), no un servicio:
// decir «lo propuso Rosario» sobre un servicio que nadie propuso sería
// ponerle su nombre a una suposición. Lo que sí se sabe de verdad es lo
// que se le HIZO hoy, y eso es lo que se ofrece: «Lo de hoy». Cuando la
// sesión guarde el servicio propuesto, el chip cambia de rótulo y de
// origen, y nada más.
//
// Y a una paciente NUEVA se le propone su PRIMERA VALORACIÓN, ya marcada.
// Cuál es sale del catálogo y no de una suposición: es la marca «Es la
// primera valoración» de Agenda · Catálogo (clinica-8,
// `service_scheduling.primera_valoracion`), que en la Clínica demo lleva
// «Consulta diagnóstico». Si el centro no ha marcado ninguna, el paso abre
// la lista entera y dice que es nueva — que es lo único honesto cuando no
// hay dato.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, X } from "lucide-react";

import { ApiError, apiWithCashier } from "../api.js";
import {
  centerHHMM,
  centerToday,
  centerWallDate,
  fetchAgendaRange,
  searchAvailability,
  type AgendaDay,
  type AgendaDayInfo,
  type AgendaStaff,
  type AvailabilitySlot,
} from "../lib/agenda.js";
import { duracionHumana } from "../lib/agenda-dia.js";
import {
  proponer,
  type DiaDeLaPropuesta,
  type Propuesta,
  type Tramo,
} from "../lib/agenda-proponer.js";
import { masDias, sieteDias } from "../lib/agenda-semana.js";
import {
  agruparServiciosDeLaCita,
  leerUsoDeServicios,
  tenantDelTerminal,
} from "../lib/servicios-de-la-cita.js";
import {
  noHaceNingunServicio,
  serviciosQueSabeHacer,
} from "../lib/agenda-health.js";
import { clientFullName, type ClientRow } from "../lib/clients.js";
import type { CatalogProduct } from "../lib/catalog.js";
import { useClientPicker } from "../hooks/useClientPicker.js";
import { BonoDeLaCita } from "./AgendaPage.bono.js";

/** El borrador de cita. Vive aquí porque es de este panel. */
export interface DraftBooking {
  clientId: string | null;
  clientName: string | null;
  serviceIds: string[];
  /** Fijado al tocar un hueco de la columna de alguien. */
  staffUserId: string | null;
  /** ISO; `null` hasta elegir hora. */
  start: string | null;
  /** B-reservas-8 · el bono del que se apartará una sesión al guardar. */
  voucherId?: string | null;
  /**
   * agenda-1 · DE DÓNDE VIENE ESTE BORRADOR, para no volver a preguntar lo
   * que ya se sabe. Lo pone «Dársela» con los datos de la cita que la
   * propuso.
   */
  propuesta?: {
    /** El día desde el que buscar hueco. */
    desde: string;
    /** «En 4 semanas», ya en castellano. */
    comoSeLlama: string;
    /** Los servicios de la cita que la propuso: el chip «Lo de hoy». */
    serviciosDeHoy: string[];
  } | null;
}

/** Qué paso está desplegado. `null` = todos plegados (ya está todo). */
type Paso = "paciente" | "servicio" | "cuando" | "hora" | null;

interface Ventana {
  from: string;
  to: string;
  /** Lo que dice el chip elegido. */
  etiqueta: string;
}

function minOf(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

function hhmm(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}

/** Minutos de pared de un instante ISO, usando la zona del centro. */
function minutosDePared(iso: string): number {
  return minOf(centerHHMM(iso));
}

/** «Mar 24 nov», como lo dice la recepción. */
export function diaLargo(fecha: string): string {
  const nombres = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
  const meses = [
    "ene",
    "feb",
    "mar",
    "abr",
    "may",
    "jun",
    "jul",
    "ago",
    "sep",
    "oct",
    "nov",
    "dic",
  ];
  const [y, m, d] = fecha.split("-").map(Number);
  const dow = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1)).getUTCDay();
  return `${nombres[dow]} ${d} ${meses[(m ?? 1) - 1]}`;
}

function tramosDe(rangos: Array<{ startTime: string; endTime: string }> | null | undefined): Tramo[] {
  return (rangos ?? []).map((r) => ({
    desdeMin: minOf(r.startTime),
    hastaMin: minOf(r.endTime),
  }));
}

/**
 * La forma de cada día del rango, tal como `proponer()` la necesita.
 *
 * `abiertos` es el turno de quien va a atender ∩ el horario del centro,
 * que es exactamente lo que el servidor ya calcula y manda en
 * `days[].staffOpen`. Sin profesional elegida se usa el horario del
 * centro: el motor repartirá entre quien sepa hacerlo, y para medir
 * huecos muertos la forma del centro es la buena.
 */
export function formaDeLosDias(
  rango: Pick<AgendaDay, "appointments" | "days">,
  staffUserId: string | null,
): DiaDeLaPropuesta[] {
  return (rango.days ?? []).map((d: AgendaDayInfo) => {
    const abiertos = staffUserId
      ? tramosDe(d.staffOpen?.[staffUserId] ?? [])
      : tramosDe(d.open);
    const ocupados: Tramo[] = [];
    for (const a of rango.appointments) {
      if (a.status === "CANCELLED") continue;
      if (centerWallDate(a.start) !== d.date) continue;
      if (
        staffUserId &&
        !a.assignments.some(
          (x) => x.reservableType === "STAFF" && x.staffUserId === staffUserId,
        )
      ) {
        continue;
      }
      const desdeMin = minutosDePared(a.start);
      const hastaMin = minutosDePared(a.end);
      ocupados.push({
        desdeMin,
        // Una cita que cruza la medianoche no existe en una agenda de
        // citas, pero si llegara, `hasta <= desde` dejaría un tramo
        // negativo que se restaría al revés.
        hastaMin: hastaMin <= desdeMin ? 24 * 60 : hastaMin,
      });
    }
    for (const ab of d.absences ?? []) {
      if (staffUserId && ab.staffUserId && ab.staffUserId !== staffUserId) {
        continue;
      }
      ocupados.push({
        desdeMin: minOf(ab.startTime),
        hastaMin: minOf(ab.endTime),
      });
    }
    return { fecha: d.date, abiertos, ocupados };
  });
}

export interface PanelDarCitaProps {
  draft: DraftBooking;
  setDraft: (d: DraftBooking) => void;
  services: CatalogProduct[];
  staff: AgendaStaff[];
  staffName: string | null;
  /** El día que se está viendo: la ventana por defecto. */
  date: string;
  isPastDay: boolean;
  skillsPorStaff: Map<string, Set<string>> | null;
  matrizEditable: boolean;
  onAbrirMatriz: () => void;
  bookError: { message: string; alternatives: AvailabilitySlot[] } | null;
  onPickAlternative: (start: string) => void;
  onClientPicked: (c: ClientRow) => void;
  onCancel: () => void;
  onReserve: () => void;
  onReserveAndCharge: () => void;
  bonoEtiqueta: string;
}

export function PanelDarCita(props: PanelDarCitaProps) {
  const { draft, setDraft } = props;
  const picker = useClientPicker();
  const [paso, setPaso] = useState<Paso>(() =>
    draft.clientId ? (draft.serviceIds.length > 0 ? "hora" : "servicio") : "paciente",
  );
  const [verTodos, setVerTodos] = useState(false);
  const [ventana, setVentana] = useState<Ventana | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [propuestas, setPropuestas] = useState<Propuesta[] | null>(null);
  /** Cuántos huecos dijo el motor que caben, antes de quedarse con tres. */
  const [cuantosHuecos, setCuantosHuecos] = useState(0);
  const [motivoSinHoras, setMotivoSinHoras] = useState<string | null>(null);
  /** El último servicio del paciente, de su historial. `null` = no se sabe
   *  todavía; `[]` = no tiene ninguna cita pasada (es nueva). */
  const [ultimos, setUltimos] = useState<string[] | null>(null);
  /**
   * ¿La recepción ya ha pasado de este paso?
   *
   * Los pasos se plieguen cuando están CONTESTADOS, y «contestado» no es
   * «tiene datos»: es que el dedo ya está más abajo. Así el paso de
   * servicios deja encadenar dos y el de la fecha se puede cambiar sin
   * tocar «Cambiar».
   */
  const ORDEN: Array<Exclude<Paso, null>> = [
    "paciente",
    "servicio",
    "cuando",
    "hora",
  ];
  function pasoContestado(cual: Exclude<Paso, null>): boolean {
    if (paso === null) return true;
    return ORDEN.indexOf(paso) > ORDEN.indexOf(cual);
  }

  const horasRef = useRef<HTMLDivElement | null>(null);
  const errorRef = useRef<HTMLDivElement | null>(null);

  const conDuracion = useMemo(
    () =>
      props.services.filter(
        (s) => s.kind === "SERVICE" && (s.durationMin ?? 0) > 0,
      ),
    [props.services],
  );
  const reservables = useMemo(
    () =>
      serviciosQueSabeHacer(conDuracion, draft.staffUserId, props.skillsPorStaff),
    [conDuracion, draft.staffUserId, props.skillsPorStaff],
  );
  const nombreDeServicio = useCallback(
    (id: string) =>
      props.services.find((s) => s.id === id)?.name ?? "Servicio",
    [props.services],
  );
  const duracionTotal = draft.serviceIds.reduce(
    (sum, id) =>
      sum + (props.services.find((s) => s.id === id)?.durationMin ?? 0),
    0,
  );
  /**
   * El servicio con el que se empieza, si el centro ha marcado uno.
   *
   * `null` = este centro no tiene marcada ninguna primera valoración, y
   * entonces no se propone nada: adivinarlo sería peor que no proponer.
   * Sale de los RESERVABLES, no del catálogo entero — si la profesional de
   * la columna no lo hace, proponerlo acabaría en un «no» del motor.
   */
  const primeraVisita = useMemo(
    () => reservables.find((x) => x.primeraValoracion === true) ?? null,
    [reservables],
  );

  const uso = useMemo(() => leerUsoDeServicios(tenantDelTerminal()), []);
  const grupos = useMemo(
    () => agruparServiciosDeLaCita(reservables, uso),
    [reservables, uso],
  );
  const noSabeHacerNada = noHaceNingunServicio(
    draft.staffUserId,
    props.skillsPorStaff,
  );

  // ── El último servicio del paciente ───────────────────────────────
  //
  // Del historial que el CRM ya publica (`GET /clients/:id/history`, con
  // `appointments[].serviceIds` desde B4): ni una ruta nueva, ni un dato
  // clínico. Si no hay red no pasa nada — el paso ofrece la lista entera,
  // que es lo de siempre.
  useEffect(() => {
    const id = draft.clientId;
    if (!id) {
      setUltimos(null);
      return;
    }
    let vivo = true;
    setUltimos(null);
    void apiWithCashier<{
      appointments: Array<{
        at: string;
        status: string;
        serviceIds: string[];
      }>;
    }>(`/clients/${id}/history`)
      .then((h) => {
        if (!vivo) return;
        const hoy = centerToday();
        const pasadas = (h.appointments ?? [])
          .filter(
            (a) =>
              a.status !== "CANCELLED" &&
              a.serviceIds.length > 0 &&
              centerWallDate(a.at) <= hoy,
          )
          .sort((a, b) => b.at.localeCompare(a.at));
        setUltimos(pasadas[0]?.serviceIds ?? []);
      })
      .catch(() => {
        if (vivo) setUltimos(null);
      });
    return () => {
      vivo = false;
    };
  }, [draft.clientId]);

  // ── Buscar las horas ──────────────────────────────────────────────
  const buscar = useCallback(
    async (v: Ventana) => {
      if (draft.serviceIds.length === 0) return;
      setBuscando(true);
      setMotivoSinHoras(null);
      setPropuestas(null);
      setCuantosHuecos(0);
      try {
        // Dos lecturas y una sola acción de la recepción: los huecos que
        // el MOTOR acepta, y la forma de esos días para poder ordenarlos.
        // Quien manda sobre si un hueco existe es el motor; `proponer()`
        // sólo ordena (ver su cabecera).
        const [slots, rango] = await Promise.all([
          searchAvailability({
            items: draft.serviceIds.map((serviceId) => ({ serviceId })),
            staffUserId: draft.staffUserId,
            from: v.from,
            to: v.to,
          }),
          fetchAgendaRange(v.from, v.to),
        ]);
        const info = rango.days ?? [];
        const dias = formaDeLosDias(rango, draft.staffUserId);
        const lista = proponer({
          candidatos: slots.map((s) => ({
            fecha: centerWallDate(s.start),
            inicioMin: minutosDePared(s.start),
          })),
          duracionMin: duracionTotal,
          dias,
          fechaPropuesta: draft.propuesta?.desde ?? null,
          cuantas: 3,
        });
        setPropuestas(lista);
        setCuantosHuecos(slots.length);
        if (lista.length === 0) setMotivoSinHoras(sinHorasPorque(info, dias));
        // Las horas, a la vista en cuanto llegan: la hoja hace scroll y
        // una tira que nace bajo el pliegue no existe (clinica-8 fase B,
        // punto 25 de la auditoría, y el paso 7 de la pasada del 27-10).
        horasRef.current?.scrollIntoView?.({ block: "nearest" });
      } catch (err) {
        setMotivoSinHoras(
          err instanceof ApiError ? err.message : "No se pudieron buscar horas.",
        );
      } finally {
        setBuscando(false);
      }
    },
    [
      draft.serviceIds,
      draft.staffUserId,
      draft.propuesta?.desde,
      duracionTotal,
    ],
  );

  /**
   * B-reservas-7a · TRES CAUSAS, TRES FRASES. «No hay huecos» era una sola
   * para las tres, y se arreglan en sitios distintos: el centro cerrado lo
   * arregla quien lleva el centro en los ajustes, el turno que falta lo
   * arregla el panel de Personal, y el día lleno se arregla con otro día.
   * Decirlas igual es mandar a la recepción al sitio equivocado.
   *
   * Lo que agenda-1 añade: la ventana puede ser un día o una semana, así
   * que «ese día» / «esos días» sale de CUÁNTOS días tiene la ventana y no
   * del rótulo del chip.
   */
  function sinHorasPorque(
    info: AgendaDayInfo[],
    dias: DiaDeLaPropuesta[],
  ): string {
    const cuando = dias.length <= 1 ? "ese día" : "esos días";
    const enMayuscula = `${cuando[0]!.toUpperCase()}${cuando.slice(1)}`;
    const cerrados = info.filter((d) => d.closed);
    if (info.length > 0 && cerrados.length === info.length) {
      // Con un solo día cerrado se dice su NOMBRE, que es lo que la
      // recepción le lee a la clienta por teléfono.
      const nombre = cerrados.length === 1 ? cerrados[0]!.closed?.name : null;
      return nombre
        ? `El centro está cerrado ese día · ${nombre}.`
        : `El centro está cerrado ${cuando}.`;
    }
    const quien = draft.staffUserId;
    if (
      quien &&
      info.length > 0 &&
      info.every((d) => (d.staffOpen?.[quien] ?? []).length === 0)
    ) {
      return `${props.staffName ?? "Esa profesional"} no tiene turno ${cuando}.`;
    }
    if (
      !quien &&
      info.length > 0 &&
      info.every((d) =>
        Object.values(d.staffOpen ?? {}).every((r) => r.length === 0),
      )
    ) {
      return `${enMayuscula} no hay nadie con turno.`;
    }
    return `No hay huecos ${cuando}. Prueba otra fecha.`;
  }

  /**
   * agenda-1 · A UNA PACIENTE NUEVA, SU PRIMERA VALORACIÓN YA PUESTA.
   *
   * Decisión de Matías: «lo que el sistema ya sabe viene puesto; se toca
   * para quitar o cambiar». Y aquí lo sabe: la marca «Es la primera
   * valoración» de Agenda · Catálogo dice cuál es el servicio con el que
   * se empieza (en la Clínica demo, «Consulta diagnóstico»).
   *
   * Se pone UNA VEZ —el `useRef`— para no pelearse con la recepción: si
   * cambia de servicio, no se le vuelve a poner. Y sólo cuando no hay
   * nada elegido ya: «Dársela» trae lo de hoy y eso manda.
   *
   * Sin marca en el catálogo no se pone nada y el paso abre la lista
   * entera diciendo que es nueva, que es lo único honesto sin el dato.
   */
  const primeraPuesta = useRef(false);
  useEffect(() => {
    if (primeraPuesta.current) return;
    if (draft.propuesta || draft.serviceIds.length > 0) return;
    if (ultimos == null || ultimos.length > 0 || !primeraVisita) return;
    primeraPuesta.current = true;
    elegirServicios([primeraVisita.id]);
    // `elegirServicios` depende del borrador entero y meterlo aquí
    // volvería a disparar el efecto en cada tecla. Lo que decide que hay
    // algo que poner son estas tres cosas.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ultimos, primeraVisita, draft.propuesta, draft.serviceIds.length]);

  /**
   * agenda-1 · LA VENTANA SE PONE SOLA, Y LA BÚSQUEDA TAMBIÉN.
   *
   * No hay botón «Buscar hueco», y tampoco hace falta contestar
   * «¿Cuándo?» para ver horas: en cuanto hay un servicio, el panel busca
   * en la ventana que el sistema ya sabe —
   *
   *   · la que propuso la sanitaria, si se viene de «Dársela»;
   *   · el DÍA QUE SE ESTÁ VIENDO, si es hoy o un día futuro: la
   *     recepción está mirando ese día por algo;
   *   · esta semana, si el día que se está viendo ya pasó.
   *
   * — y el paso «¿Cuándo?» se queda a la vista para cambiarla. Un toque
   * menos en el camino en frío, y es el toque que no decidía nada: la
   * respuesta por defecto ya era la buena.
   */
  const ventanaPuesta = useRef(false);
  useEffect(() => {
    if (ventanaPuesta.current || draft.serviceIds.length === 0) return;
    ventanaPuesta.current = true;
    const p = draft.propuesta;
    const hoy = centerToday();
    if (p) {
      setVentana({
        from: p.desde,
        to: masDias(p.desde, 6),
        etiqueta: p.comoSeLlama,
      });
      setPaso("hora");
      return;
    }
    if (props.date >= hoy) {
      setVentana({
        from: props.date,
        to: props.date,
        etiqueta: props.date === hoy ? "hoy" : `el ${diaLargo(props.date)}`,
      });
      return;
    }
    const semana = sieteDias(hoy);
    setVentana({
      from: hoy,
      to: semana[semana.length - 1]!,
      etiqueta: "esta semana",
    });
  }, [draft.serviceIds.length, draft.propuesta, props.date]);

  /**
   * Y la búsqueda se rehace cuando cambia la ventana O la duración.
   *
   * Lo segundo importa: encadenar «tinte + corte» cambia lo que tiene que
   * caber, y unas horas calculadas para 30 minutos no valen para 120. El
   * panel viejo lo resolvía borrando la hora elegida; aquí se rehacen las
   * propuestas y la hora se conserva (ver `elegirServicios`).
   */
  useEffect(() => {
    if (!ventana || duracionTotal <= 0) return;
    void buscar(ventana);
    // `buscar` cambia de identidad con cada `draft`, y meterlo aquí
    // dispararía una petición por toque. Lo que decide que hay que volver
    // a buscar son estas dos cosas y nada más.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ventana, duracionTotal]);

  useEffect(() => {
    if (props.bookError) errorRef.current?.scrollIntoView?.({ block: "center" });
  }, [props.bookError]);

  /**
   * agenda-1 · CAMBIAR DE SERVICIO NO BORRA LA HORA.
   *
   * El panel viejo ponía `start: null` en cada cambio de servicio, y con
   * el panel nuevo eso se come lo que la recepción acaba de hacer: tocar
   * un hueco a las 16:30 y elegir el servicio dejaba el pie diciendo
   * «Falta la hora». Es H8 otra vez con otro gesto.
   *
   * Lo que sí se tira son las PROPUESTAS: estaban calculadas para la
   * duración anterior y ya no valen. Si la hora elegida no aguanta el
   * servicio nuevo, el motor contesta 409 con su frase y sus tres horas
   * tocables, que es el mecanismo que B-reservas-6a construyó justo para
   * esto — y que dice la verdad en vez de adivinarla en el front.
   */
  function elegirServicios(ids: string[]) {
    setDraft({ ...draft, serviceIds: ids });
    setPropuestas(null);
    // Y se pasa a «¿Cuándo?», salvo que la hora viniera de un hueco
    // tocado: ahí la hora ya está y lo siguiente es Reservar.
    setPaso(draft.start ? null : "cuando");
  }

  function elegirVentana(v: Ventana) {
    setVentana(v);
    // Cambiar de ventana SÍ suelta la hora: la que había es de otro día.
    setDraft({ ...draft, start: null });
    setPaso("hora");
  }

  const puedeReservar = draft.serviceIds.length > 0 && !!draft.start;
  /** La hora de fin, SÓLO si hay algo que dure. Ver la nota del pie. */
  const finDeLaCita =
    draft.start && duracionTotal > 0
      ? centerHHMM(
          new Date(
            new Date(draft.start).getTime() + duracionTotal * 60_000,
          ).toISOString(),
        )
      : null;
  const esDeHoy = draft.start
    ? centerWallDate(draft.start) === centerToday()
    : false;

  /** Por qué no se puede reservar. `null` = sí se puede. Nunca nombra el
   *  cliente: una cita SIN cliente es legal desde B4 (la reserva por
   *  teléfono de quien todavía no tiene ficha). */
  const faltan = [
    draft.serviceIds.length === 0 ? "el servicio" : null,
    !draft.start ? "la hora" : null,
  ].filter((x): x is string => x !== null);
  const porQueNo =
    faltan.length === 0
      ? null
      : faltan.length === 1
        ? `Falta ${faltan[0]}.`
        : `Faltan ${faltan.join(" y ")}.`;

  return (
    <div
      data-test="panel-dar-cita"
      className="w-full md:w-[480px] lg:w-[520px] shrink-0 bg-white border-l border-slate-200 flex flex-col overflow-hidden shadow-[-12px_0_32px_rgba(15,23,42,0.08)]"
    >
      <div className="flex items-center gap-2 h-16 px-5 border-b border-slate-200 shrink-0">
        <h2 className="text-[19px] font-bold text-mipiace-ink flex-1">
          Dar cita
        </h2>
        <button
          onClick={props.onCancel}
          className="h-11 w-11 rounded-xl bg-mipiace-stone flex items-center justify-center"
          aria-label="Cerrar"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
        {/* ── 1 · ¿QUIÉN? ─────────────────────────────────────────── */}
        {draft.clientId && paso !== "paciente" ? (
          <div
            data-test="paso-paciente-plegado"
            className="flex items-center gap-3 bg-emerald-50 rounded-2xl px-4 py-3"
          >
            <div className="flex-1 min-w-0">
              <Rotulo>Quién</Rotulo>
              <div className="text-[16px] font-semibold text-mipiace-ink truncate">
                {draft.clientName ?? "Sin nombre"}
              </div>
              {ultimos != null && (
                <div className="text-[12.5px] text-emerald-700 truncate">
                  {ultimos.length === 0
                    ? "Es nueva · no tiene citas anteriores"
                    : `Su último · ${ultimos.map(nombreDeServicio).join(" + ")}`}
                </div>
              )}
            </div>
            <button
              data-test="cambiar-paciente"
              onClick={() => setPaso("paciente")}
              className="shrink-0 min-h-touch px-3 text-[13.5px] font-semibold text-mipiace-coral-dark underline"
            >
              Cambiar
            </button>
          </div>
        ) : (
          <Paso titulo="¿Quién?" abierto>
            <button
              data-test="elegir-paciente"
              onClick={() =>
                picker.open((c) => {
                  props.onClientPicked(c);
                  setDraft({
                    ...draft,
                    clientId: c.id,
                    clientName: clientFullName(c),
                  });
                  setPaso(draft.serviceIds.length > 0 ? "cuando" : "servicio");
                })
              }
              className="w-full min-h-touch-lg px-4 rounded-2xl bg-mipiace-stone border border-slate-200 text-left text-[15px]"
            >
              {draft.clientName ?? "Móvil, nombre o email…"}
            </button>
            {/* Una cita sin ficha es legal desde B4: la reserva de
                teléfono de quien todavía no tiene una. Se dice, para que
                nadie se invente un nombre para poder seguir. */}
            <p className="text-[12.5px] text-slate-500 mt-1.5 leading-snug">
              Si todavía no tiene ficha, se crea con lo que teclees. Y una
              cita sin ficha también se puede dar.
            </p>
          </Paso>
        )}

        {/* ── 2 · ¿QUÉ VIENE A HACER? ─────────────────────────────── */}
        {/* Se pliega cuando la recepción ha PASADO de él, no en cuanto
            hay un servicio: una cita de peluquería son «tinte + corte», y
            plegar al primero dejaría el segundo detrás de un «Cambiar». */}
        {draft.serviceIds.length > 0 && pasoContestado("servicio") ? (
          <div
            data-test="paso-servicio-plegado"
            className="flex items-center gap-3 bg-mipiace-stone rounded-2xl px-4 py-3"
          >
            <div className="flex-1 min-w-0">
              <Rotulo>Qué viene a hacer</Rotulo>
              <div className="text-[15.5px] font-semibold text-mipiace-ink truncate">
                {draft.serviceIds.map(nombreDeServicio).join(" + ")}
              </div>
              <div className="text-[12.5px] text-slate-500">
                {duracionHumana(duracionTotal)}
              </div>
            </div>
            <button
              data-test="cambiar-servicio"
              onClick={() => {
                setPaso("servicio");
                setVerTodos(false);
              }}
              className="shrink-0 min-h-touch px-3 text-[13.5px] font-semibold text-mipiace-coral-dark underline"
            >
              Cambiar
            </button>
          </div>
        ) : (
          <Paso titulo="¿Qué viene a hacer?" abierto>
            {noSabeHacerNada ? (
              <div data-motivo="sin-servicios" className="space-y-2">
                <div className="text-[13px] leading-snug text-slate-600">
                  {props.staffName ?? "Esta profesional"} no tiene ningún
                  servicio asignado todavía.
                </div>
                {props.matrizEditable ? (
                  <button
                    data-accion="abrir-matriz"
                    onClick={props.onAbrirMatriz}
                    className="min-h-touch px-4 rounded-2xl border border-slate-300 text-[13.5px] font-medium text-mipiace-ink"
                  >
                    Asignarle servicios en la matriz
                  </button>
                ) : (
                  <div className="text-[12.5px] text-slate-500">
                    Lo asigna quien lleva el centro, en la matriz de
                    servicios.
                  </div>
                )}
              </div>
            ) : (
              <>
                {/* Los atajos: lo de hoy y su último. El orden es el de la
                    certeza — «lo de hoy» lo acaba de hacer la sanitaria. */}
                {!verTodos && (
                  <div className="flex flex-wrap gap-2">
                    {draft.propuesta &&
                      draft.propuesta.serviciosDeHoy.length > 0 && (
                        <ChipDeServicio
                          test="servicio-lo-de-hoy"
                          destacado
                          titulo={draft.propuesta.serviciosDeHoy
                            .map(nombreDeServicio)
                            .join(" + ")}
                          pie={`Lo de hoy · ${duracionHumana(
                            sumaDuracion(
                              draft.propuesta.serviciosDeHoy,
                              props.services,
                            ),
                          )}`}
                          onClick={() =>
                            elegirServicios(draft.propuesta!.serviciosDeHoy)
                          }
                        />
                      )}
                    {ultimos != null &&
                      ultimos.length > 0 &&
                      !mismosIds(
                        ultimos,
                        draft.propuesta?.serviciosDeHoy ?? [],
                      ) && (
                        <ChipDeServicio
                          test="servicio-su-ultimo"
                          titulo={ultimos.map(nombreDeServicio).join(" + ")}
                          pie={`Su último · ${duracionHumana(
                            sumaDuracion(ultimos, props.services),
                          )}`}
                          onClick={() => elegirServicios(ultimos)}
                        />
                      )}
                    {/* Sin primera valoración marcada no se propone nada:
                        cuál es el servicio con el que se empieza no se
                        puede adivinar, y adivinarlo sería peor. Con ella
                        marcada no se llega aquí — el servicio viene ya
                        puesto y el paso sale plegado. */}
                    {ultimos != null && ultimos.length === 0 && !primeraVisita && (
                      <p
                        data-test="paciente-nueva"
                        className="text-[13px] text-slate-600 leading-snug w-full"
                      >
                        Es nueva: no tiene citas anteriores. Elige su primera
                        visita.
                      </p>
                    )}
                    <ChipDeServicio
                      test="servicio-otro"
                      titulo="Otro…"
                      onClick={() => setVerTodos(true)}
                    />
                  </div>
                )}
                {/* La lista entera se abre sola cuando no hay nada que
                    proponer: sin paciente elegida todavía, o con una nueva
                    en un centro que no ha marcado su primera valoración.
                    Con la propuesta hecha, la lista está detrás de
                    «Otro…» — y el chip propuesto a un toque. */}
                {(verTodos ||
                  (!draft.propuesta &&
                    ultimos == null) ||
                  (ultimos != null &&
                    ultimos.length === 0 &&
                    !primeraVisita)) && (
                  <ListaDeServicios
                    grupos={grupos}
                    elegidos={draft.serviceIds}
                    onToggle={(id) => {
                      const tiene = draft.serviceIds.includes(id);
                      const ids = tiene
                        ? draft.serviceIds.filter((x) => x !== id)
                        : [...draft.serviceIds, id];
                      // La hora se conserva: ver `elegirServicios`.
                      setDraft({ ...draft, serviceIds: ids });
                      setPropuestas(null);
                    }}
                  />
                )}
                {draft.serviceIds.length > 0 && (
                  <button
                    data-test="servicio-listo"
                    onClick={() => elegirServicios(draft.serviceIds)}
                    className="mt-2 w-full min-h-touch rounded-2xl bg-mipiace-ink text-white text-[14.5px] font-semibold"
                  >
                    {duracionHumana(duracionTotal)} · seguir
                  </button>
                )}
              </>
            )}
          </Paso>
        )}

        {/* ── 3 · ¿CUÁNDO? ────────────────────────────────────────── */}
        {draft.serviceIds.length > 0 &&
          (ventana && pasoContestado("cuando") ? (
            <div
              data-test="paso-cuando-plegado"
              className="flex items-center gap-3 bg-mipiace-stone rounded-2xl px-4 py-3"
            >
              <div className="flex-1 min-w-0">
                <Rotulo>Cuándo</Rotulo>
                <div className="text-[15.5px] font-semibold text-mipiace-ink truncate">
                  {ventana.etiqueta}
                </div>
              </div>
              <button
                data-test="cambiar-cuando"
                onClick={() => setPaso("cuando")}
                className="shrink-0 min-h-touch px-3 text-[13.5px] font-semibold text-mipiace-coral-dark underline"
              >
                Cambiar
              </button>
            </div>
          ) : (
            paso !== "servicio" && (
              <Paso titulo="¿Cuándo?" abierto>
                <Cuando
                  date={props.date}
                  isPastDay={props.isPastDay}
                  propuesta={draft.propuesta ?? null}
                  elegida={ventana}
                  onElegir={elegirVentana}
                />
              </Paso>
            )
          ))}

        {/* ── 4 · MEJORES HORAS ───────────────────────────────────── */}
        <div ref={horasRef}>
          {buscando && (
            <div className="flex items-center gap-2 text-[13.5px] text-slate-500 py-3">
              <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> Buscando
              las mejores horas…
            </div>
          )}
          {!buscando && propuestas && propuestas.length > 0 && (
            <div data-test="mejores-horas">
              <div className="text-[15.5px] font-semibold text-mipiace-ink">
                Mejores horas
              </div>
              {/* clinica-8 (fase B, punto 25 de la auditoría) · CUÁNTAS
                  SON. El número delante convierte «no ha pasado nada» en
                  «hay siete, elige»: cuando la tira se corta por abajo, el
                  encabezado se ve aunque las horas no. Y con más de tres
                  dice que éstas son las tres MEJORES, no las únicas — si
                  no, parecería que el día está casi lleno. */}
              <p
                data-test="cuantos-huecos"
                className="text-[12.5px] text-slate-500 mb-2 leading-snug"
              >
                {cuantosHuecos === 1
                  ? "1 hueco · toca la hora"
                  : cuantosHuecos > propuestas.length
                    ? `${cuantosHuecos} huecos · aquí ${propuestas.length === 1 ? "el mejor" : `los ${propuestas.length} mejores`}`
                    : `${cuantosHuecos} huecos · toca una hora`}
              </p>
              <p className="text-[12.5px] text-slate-500 mb-2 leading-snug">
                Primero la que llena un hueco sin dejar minutos muertos.
              </p>
              <div className="flex flex-col gap-2">
                {propuestas.map((p, i) => {
                  const iso = isoDe(p.fecha, p.inicioMin);
                  const elegida = draft.start === iso;
                  return (
                    <button
                      key={`${p.fecha}-${p.inicioMin}`}
                      data-hora-propuesta={`${p.fecha} ${hhmm(p.inicioMin)}`}
                      data-hora-orden={String(i)}
                      onClick={() => {
                        setDraft({ ...draft, start: iso });
                        setPaso(null);
                      }}
                      className={`flex items-center gap-3 min-h-touch-lg px-4 rounded-2xl text-left border-2 ${
                        elegida
                          ? "border-mipiace-coral bg-mipiace-coral-soft"
                          : i === 0
                            ? "border-mipiace-coral bg-white"
                            : "border-slate-200 bg-white"
                      }`}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="text-[16.5px] font-bold text-mipiace-ink">
                          {diaLargo(p.fecha)} · {hhmm(p.inicioMin)}
                        </div>
                        <div className="text-[12.5px] text-slate-500 truncate">
                          {p.motivo}
                        </div>
                      </div>
                      {p.etiqueta && (
                        <span
                          data-etiqueta-hora={p.etiqueta}
                          className={`shrink-0 text-[12px] font-semibold px-2.5 py-1 rounded-xl ${
                            p.etiqueta === "Llena el hueco justo"
                              ? "bg-mipiace-coral-soft text-mipiace-coral-dark"
                              : "bg-emerald-50 text-emerald-700"
                          }`}
                        >
                          {p.etiqueta}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {!buscando && motivoSinHoras && (
            <div
              data-test="sin-horas"
              className="text-[13.5px] text-amber-900 bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3 leading-snug"
            >
              {motivoSinHoras}
            </div>
          )}
        </div>

        {/* B-reservas-8 · EL BONO. Después del paciente y de los servicios
            porque depende de los dos. */}
        <BonoDeLaCita
          clientId={draft.clientId}
          serviceIds={draft.serviceIds}
          elegido={draft.voucherId ?? null}
          onElegir={(voucherId) => setDraft({ ...draft, voucherId })}
          etiqueta={props.bonoEtiqueta}
        />

        {/* El 409 del suelo con sus alternativas tocables, pegado a la
            hora, que es de lo que habla (B-reservas-6a). */}
        {props.bookError && (
          <div
            ref={errorRef}
            className="rounded-2xl border border-amber-300 bg-amber-50 p-3.5"
          >
            <div className="text-[13.5px] leading-snug text-amber-900">
              {props.bookError.message}
            </div>
            {props.bookError.alternatives.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {props.bookError.alternatives.slice(0, 3).map((sl) => (
                  <button
                    key={sl.start}
                    onClick={() => props.onPickAlternative(sl.start)}
                    className="min-h-touch px-4 rounded-2xl bg-white border border-amber-300 text-[14.5px] font-semibold tabular-nums text-amber-900"
                  >
                    {centerHHMM(sl.start)}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── EL PIE FIJO ────────────────────────────────────────────
          El resumen de lo que se va a guardar y «Reservar», como el
          tablero 3: el resumen a la izquierda, el botón a la derecha.

          B-reservas-mostrador F1 · «Reservar» es EL botón y «Reservar y
          cobrar» SÓLO existe si la cita es de hoy. Un cobro entra en el
          turno ABIERTO: reservar para el jueves y pulsar el primario por
          inercia mete el dinero del jueves en el arqueo de hoy, y
          deshacerlo no es anular (no existe) sino devolver, que cae en el
          turno del día en que se haga. Un toque de más descuadra DOS
          arqueos. Y «de hoy» sale de `draft.start` —el instante que se va
          a guardar— y no del día que se está mirando.

          Y LA RANURA DEL SECUNDARIO NO DESAPARECE, aunque el botón sí: el
          pie está anclado abajo, así que una fila que aparece o
          desaparece mueve el primario — y moverlo justo cuando la
          recepción va a tocar es cómo se cobra lo que no se quería
          cobrar. Cuando la cita no es de hoy, esa misma ranura la ocupa
          la razón.

          No hay `<form>` ni `type="submit"`, así que no existe un Enter
          que cobre; lo que se fija aquí es que no nazca uno por descuido
          al reordenar. */}
      <div
        data-test="pie-del-panel"
        className="shrink-0 border-t border-slate-200 px-5 py-3.5 bg-white flex items-center gap-4"
      >
        <div data-test="resumen-de-la-cita" className="flex-1 min-w-0">
          {draft.start && (
            <>
              <div className="text-[16px] font-bold text-mipiace-ink truncate">
                {diaLargo(centerWallDate(draft.start))} ·{" "}
                {centerHHMM(draft.start)}
                {/* B-reservas-mostrador F4 · SIN DURACIÓN NO HAY FIN. Con
                    cero servicios elegidos la etiqueta decía «fin 12:30»
                    para una cita que empieza a las 12:30 (fotografiado en
                    el AP11, `docs/qa/2026-09-13-ap11/20-lunes-cita.png`).
                    Decir una hora de fin falsa es peor que no decir
                    ninguna: la recepción la lee por teléfono. */}
                {finDeLaCita ? `–${finDeLaCita}` : ""}
              </div>
            </>
          )}
          {/* B-reservas-mostrador F4 · ningún botón apagado es mudo, y el
              motivo va en TEXTO VISIBLE, nunca en un `title` ni en un
              tooltip: `docs/ux-principles.md` §6 los prohíbe («Touch no
              tiene hover. Las cosas se ven o no existen»).
              Se dice TAMBIÉN con la hora ya puesta: tocar un hueco deja la
              hora y no el servicio, y ahí «Reservar» está apagado — si el
              motivo sólo saliera sin hora, ése sería justo el caso mudo. */}
          {porQueNo ? (
            <p
              data-motivo="reservar"
              className="text-[13px] text-slate-500 leading-snug"
            >
              {porQueNo}
            </p>
          ) : (
            <div className="text-[12.5px] text-slate-500 truncate">
              {draft.serviceIds.map(nombreDeServicio).join(" + ")}
              {props.staffName ? ` · ${props.staffName}` : ""}
              {duracionTotal > 0 ? ` · ${duracionHumana(duracionTotal)}` : ""}
            </div>
          )}
        </div>
        <div className="shrink-0 w-[168px] md:w-[196px] flex flex-col gap-1.5">
          <button
            data-accion="reservar"
            onClick={props.onReserve}
            disabled={!puedeReservar}
            className="h-touch-lg w-full rounded-2xl bg-mipiace-coral hover:bg-mipiace-coral-dark text-white text-[17px] font-bold disabled:opacity-40"
          >
            Reservar
          </button>
          <div className="h-11 flex items-center justify-center">
            {esDeHoy ? (
              <button
                data-accion="reservar-y-cobrar"
                onClick={props.onReserveAndCharge}
                disabled={!puedeReservar}
                className="w-full h-11 rounded-2xl border border-slate-300 text-mipiace-ink text-[13.5px] font-medium disabled:opacity-40"
              >
                Reservar y cobrar
              </button>
            ) : (
              <p
                data-cobro-otro-dia
                className="text-[12px] text-slate-500 text-center leading-snug"
              >
                Se cobra el día de la cita.
              </p>
            )}
          </div>
        </div>
      </div>
      {picker.element}
    </div>
  );
}

// ── Piezas ────────────────────────────────────────────────────────────

/** El rótulo de un paso ya contestado: tres cajas con «Cambiar» y sin
 *  nombre no dicen de qué son. */
function Rotulo(props: { children: React.ReactNode }) {
  return (
    <span className="block text-[11px] font-semibold tracking-[0.06em] uppercase text-slate-500">
      {props.children}
    </span>
  );
}

function Paso(props: {
  titulo: string;
  abierto: boolean;
  children: React.ReactNode;
}) {
  if (!props.abierto) return null;
  return (
    <div>
      <div className="text-[15.5px] font-semibold text-mipiace-ink mb-2">
        {props.titulo}
      </div>
      {props.children}
    </div>
  );
}

function ChipDeServicio(props: {
  test: string;
  titulo: string;
  pie?: string;
  destacado?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      data-test={props.test}
      onClick={props.onClick}
      className={`min-h-touch-lg px-4 py-2 rounded-2xl text-left border-2 ${
        props.destacado
          ? "border-mipiace-coral bg-mipiace-coral-soft text-mipiace-coral-dark"
          : "border-slate-200 bg-white text-mipiace-ink"
      }`}
    >
      <span className="block text-[15px] font-semibold">{props.titulo}</span>
      {props.pie && (
        <span className="block text-[12px] font-medium opacity-80">
          {props.pie}
        </span>
      )}
    </button>
  );
}

function ListaDeServicios(props: {
  // El genérico, explícito: `ReturnType<typeof agruparServiciosDeLaCita>`
  // lo pierde y deja los servicios como `ServicioOrdenable`, que no tiene
  // `durationMin`.
  grupos: ReturnType<typeof agruparServiciosDeLaCita<CatalogProduct>>;
  elegidos: string[];
  onToggle: (id: string) => void;
}) {
  if (props.grupos.length === 0) {
    return (
      <div className="text-[12.5px] text-slate-500 py-2">
        No hay servicios con duración configurada.
      </div>
    );
  }
  return (
    <div className="mt-2 space-y-1">
      {props.grupos.map((g) => (
        <div key={g.categoria} data-categoria={g.categoria}>
          {props.grupos.length > 1 && (
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 px-1 pt-1.5 pb-1">
              {g.titulo}
            </div>
          )}
          <div className="space-y-1">
            {g.servicios.map((s) => {
              const activo = props.elegidos.includes(s.id);
              return (
                <button
                  key={s.id}
                  onClick={() => props.onToggle(s.id)}
                  className={`w-full flex items-center justify-between gap-2 px-3.5 min-h-touch py-1.5 rounded-xl border text-[14px] ${
                    activo
                      ? "border-mipiace-coral bg-mipiace-coral/10 text-mipiace-ink"
                      : "border-slate-200 bg-white text-slate-700"
                  }`}
                >
                  {/* clinica-8 (fase B, 19) · el nombre ENTERO: lo que
                      distingue «Revisión biomecánica adultos» de
                      «…niños» es la última palabra. */}
                  <span className="text-left leading-tight line-clamp-2">
                    {s.name}
                  </span>
                  <span className="text-[11.5px] tabular-nums text-slate-400 shrink-0">
                    {s.durationMin} min
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function Cuando(props: {
  date: string;
  /** B-reservas-6a · el día que se está viendo ya pasó. */
  isPastDay: boolean;
  propuesta: DraftBooking["propuesta"];
  elegida: Ventana | null;
  onElegir: (v: Ventana) => void;
}) {
  const [otra, setOtra] = useState("");
  const hoy = centerToday();
  // «Esta semana» es de HOY al domingo: lo que queda de semana, no la
  // semana entera — los días pasados no son una respuesta a «cuándo».
  const semana = sieteDias(hoy);
  const domingo = semana[semana.length - 1]!;
  return (
    <div className="flex flex-wrap gap-2">
      {props.propuesta && (
        <ChipDeServicio
          test="cuando-propuesta"
          destacado
          titulo={props.propuesta.comoSeLlama}
          pie={`desde el ${diaLargo(props.propuesta.desde)} · lo propuso la sanitaria`}
          onClick={() =>
            props.onElegir({
              from: props.propuesta!.desde,
              to: masDias(props.propuesta!.desde, 6),
              etiqueta: props.propuesta!.comoSeLlama,
            })
          }
        />
      )}
      <ChipDeServicio
        test="cuando-esta-semana"
        titulo="Esta semana"
        onClick={() =>
          props.onElegir({ from: hoy, to: domingo, etiqueta: "esta semana" })
        }
      />
      {/* B-reservas-6a · un día que ya pasó no tiene huecos que buscar, y
          se dice: el servidor lo rechazaría igual (409 BOOKING_IN_PAST) y
          pasear a la recepción por el panel para acabar en un error es
          peor que decírselo antes. */}
      {props.isPastDay && (
        <p
          data-motivo="dia-pasado"
          className="w-full text-[13px] text-slate-600 leading-snug"
        >
          Ese día ya ha pasado. Elige hoy o un día siguiente.
        </p>
      )}
      {/* El día que se está viendo, si es futuro: la recepción ya está
          mirando ese día y pedirle que lo vuelva a teclear es un toque
          regalado. Si ya pasó NO se ofrece — sería ofrecer una hora que
          el motor va a rechazar. */}
      {props.date > hoy && (
        <ChipDeServicio
          test="cuando-el-dia-visto"
          titulo={diaLargo(props.date)}
          pie="el día que estás viendo"
          onClick={() =>
            props.onElegir({
              from: props.date,
              to: props.date,
              etiqueta: `el ${diaLargo(props.date)}`,
            })
          }
        />
      )}
      <label className="min-h-touch-lg px-4 py-2 rounded-2xl border-2 border-slate-200 bg-white flex flex-col justify-center">
        <span className="text-[12px] font-medium text-slate-500">
          Otra fecha
        </span>
        {/* El `type="date"` nativo SÍ es el control bueno aquí, y es el
            contrario exacto de la fecha de nacimiento: una fecha de cita
            cae a semanas de hoy, que es justo donde abre el calendario del
            sistema (B-reservas-mostrador). Lo que salió de la cabecera de
            la agenda es el campo de NAVEGAR por días, que es otra cosa. */}
        <input
          type="date"
          value={otra}
          min={hoy}
          data-test="cuando-otra-fecha"
          onChange={(e) => {
            const v = e.target.value;
            setOtra(v);
            if (v) {
              props.onElegir({
                from: v,
                to: v,
                etiqueta: `el ${diaLargo(v)}`,
              });
            }
          }}
          className="bg-transparent text-[14.5px] font-semibold tabular-nums text-mipiace-ink outline-none"
        />
      </label>
    </div>
  );
}

function sumaDuracion(ids: string[], services: CatalogProduct[]): number {
  return ids.reduce(
    (s, id) => s + (services.find((x) => x.id === id)?.durationMin ?? 0),
    0,
  );
}

function mismosIds(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

/**
 * Fecha de pared + minutos → instante ISO.
 *
 * Igual que `localToIso` de `AgendaPage.tsx` y por la misma razón: el
 * borrador guarda el INSTANTE que se va a escribir, no una hora de pared,
 * y los dos domingos del cambio de hora la diferencia es una hora de cita.
 * Se resuelve con el desplazamiento real de ese día en la zona del centro.
 */
function isoDe(fecha: string, minutos: number): string {
  const base = Date.parse(`${fecha}T00:00:00Z`) + minutos * 60_000;
  // Dos pasadas: el desplazamiento se mide en el instante aproximado y se
  // vuelve a medir con el corregido, que es lo que lo hace exacto en el
  // salto.
  let t = base - offsetMs(new Date(base));
  t = base - offsetMs(new Date(t));
  return new Date(t).toISOString();
}

const offFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: "Europe/Madrid",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

function offsetMs(date: Date): number {
  const p = offFmt.formatToParts(date);
  const g = (t: string) => Number(p.find((x) => x.type === t)?.value ?? 0);
  const asUtc = Date.UTC(
    g("year"),
    g("month") - 1,
    g("day"),
    g("hour") % 24,
    g("minute"),
    g("second"),
  );
  return asUtc - date.getTime();
}
