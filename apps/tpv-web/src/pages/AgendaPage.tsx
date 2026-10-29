// Agenda del TPV (B-reservas-4). Tres superficies del mockup en un layout
// responsive: TPV/recepción = columnas por profesional (día) + tira de
// semana; móvil = "mi día" en 1 columna + filtro por profesional. Alta con
// panel al lado SIN scrim (no tapa el calendario), multi-servicio
// encadenable, cliente-first (useClientPicker de B1) y "Reservar y cobrar"
// (cita → caja). Detalle con cambio de estado + "Cobrar en caja".
//
// Gate por `agendaEnabled` en la UI (además del gate de ruta en el server).
// Offline: lectura del día desde caché; alta por outbox con externalId.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  KeyRound,
  Loader2,
  MoreVertical,
  Plus,
  Footprints,
  NotebookText,
  Stethoscope,
  Wallet,
  X,
} from "lucide-react";

import { ApiError } from "../api.js";
import {
  getCachedClinicaEnabled,
  loadCatalogFromCache,
  type CatalogProduct,
} from "../lib/catalog.js";
import {
  apuntarUsoDeServicios,
  tenantDelTerminal,
} from "../lib/servicios-de-la-cita.js";
import {
  asegurarClientesEnCache,
  clientFullName,
  loadClientsFromCache,
  type ClientRow,
} from "../lib/clients.js";
import {
  AGENDA_TZ,
  ALL_DAY_END,
  ALL_DAY_START,
  centerHHMM,
  centerToday,
  centerWallDate,
  checkoutAppointmentTicket,
  createAbsence,
  createAppointment,
  dayInfoOf,
  deleteAbsence,
  fetchAgendaDay,
  fetchAgendaRange,
  loadAgendaDayFromCache,
  patchAppointment,
  searchAvailability,
  slotMinutesOf,
  STATUS_COLOR,
  STATUS_LABEL,
  type AgendaAbsence,
  type AgendaAppointment,
  type AgendaDay,
  type AgendaDayInfo,
  type AgendaStaff,
  type AppointmentStatus,
  type AvailabilitySlot,
  type OpenRange,
} from "../lib/agenda.js";
import {
  colorDeCabecera,
  tinteDeProfesional,
  tonoDeEstado,
} from "../lib/staffColor.js";
import { outboxRetry, subscribeOutbox } from "../lib/outbox.js";
import {
  fetchAgendaHealth,
  fetchSkillMatrix,
  indexarMatrizPorProfesional,
  profesionalesQuePuedenConLaCita,
  readHealthSnapshot,
  serviciosSinNadie,
  subscribeHealthSnapshot,
} from "../lib/agenda-health.js";
import { createPortal } from "react-dom";

import { NOMBRE_DE_PROXIMA_CITA } from "@mipiacetpv/clinica-sesion";
import type { TipoDeVisita } from "@mipiacetpv/clinica-sesion";

import { CobrosPendientes } from "../clinica/CobrosPendientes.js";
import { HistoriaViva } from "../clinica/HistoriaViva.js";
import { SesionPodologia } from "../clinica/SesionPodologia.js";
import {
  diaRecordado,
  recordarDiaDeLaAgenda,
} from "../lib/dia-de-la-agenda.js";
import { ValoracionSanitario } from "../clinica/ValoracionSanitario.js";
// agenda-1 · las tres superficies nuevas del bloque. Van en ficheros
// hermanos (el patrón de `SalePage.*.tsx`) porque esta pantalla ya tenía
// 3.700 líneas antes del bloque y meter aquí el día en lista, la semana y
// el embudo de «Dar cita» la dejaría ilegible.
import {
  ColumnaDelDia,
  DiaEnLista,
  estadoDeLaFila,
  libreHastaLas,
  type EstadoDeLaFila,
} from "./AgendaPage.dia.js";
import { SemanaEnColumnas, type DiaDeLaSemana } from "./AgendaPage.semana.js";
import { PanelDarCita, type DraftBooking } from "./AgendaPage.darCita.js";
import {
  ahoraYDespues,
  cifrasDelDia,
  duracionHumana,
  filasDelDia,
  type FilaHueco,
} from "../lib/agenda-dia.js";
import {
  pendientesDeRecepcion,
  type PendienteDeRecepcion,
} from "../lib/agenda-recepcion.js";
import {
  lunesDeLaSemana,
  rotuloDeLaSemana,
  sieteDias,
} from "../lib/agenda-semana.js";
import { AgendaHealthPanel } from "./AgendaHealthPanel.js";
import { AgendaSkillMatrix } from "./AgendaSkillMatrix.js";

// ── Helpers de zona horaria (Europe/Madrid) para pintar ────────────────

const TZ = "Europe/Madrid";
// B-reservas-7a · `SLOT_MIN` YA NO EXISTE. La retícula del centro es un
// dato del día (`Tenant.agendaSlotMinutes`, 15 o 30) que llega con
// `GET /agenda` y viaja en la caché offline: el toque, las líneas de la
// regla y el suelo pintado salen de ahí. Sole trabaja en franjas de 30 y
// hasta este bloque le ofrecíamos inicios a y cuarto (6a §4.6).
//
// El suelo de 6a no cambia: sigue siendo el comienzo de la franja EN
// CURSO. Con 30 eso significa que a las 11:29 todavía valen las 11:00.

// La franja visible del día sale del horario del centro con este margen;
// 08:00–21:00 queda sólo como valor por defecto de un centro SIN
// configurar, que es como se comportaba antes del bloque.
const DEFAULT_START_MIN = 8 * 60;
const DEFAULT_END_MIN = 21 * 60;
const VISIBLE_MARGIN_MIN = 30;
// agenda-1 · LA ALTURA MÍNIMA DE TOQUE EN LA REJILLA (tablero 4).
//
// 1,1 px por minuto deja una cita de 15 minutos en 16,5 px y una de 10 en
// 11: rayas. Matías, 27-10: «las citas de 10-20 min son rayas que no se
// tocan». El estándar de la casa son 48 px (`docs/ux-principles.md` §1.2)
// y aquí se baja a 44, que es el mínimo de WCAG y lo que el diseño usa en
// los tableros — por encima de eso un día entero de una retícula de 15 no
// cabría ni con scroll razonable.
//
// Sale de la RETÍCULA del centro y no de una constante: lo que tiene que
// ser tocable es la franja más pequeña que se puede reservar. Con 30
// minutos (Sole) son 1,47 px/min; con 15 (el default) 2,93. El suelo de
// 1,1 se queda para que una retícula grande no apriete la rejilla más de
// lo que estaba.
const TOQUE_MIN_PX = 44;
const PX_POR_MINUTO_SUELO = 1.1;

export function pxPorMinuto(slotMin: number): number {
  return Math.max(PX_POR_MINUTO_SUELO, TOQUE_MIN_PX / slotMin);
}
// B-reservas-5 F8 · alto mínimo para que la tarjeta pueda pintar sus dos
// líneas enteras: 17 (hora + cliente) + 16 (servicios) + 8 de padding.
// Por debajo de esto se pinta sólo la primera.
const CARD_TWO_LINE_MIN_H = 41;

const partsFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: TZ,
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

// ISO UTC → minutos desde medianoche en hora local del centro.
function localMinutes(iso: string): number {
  const parts = partsFmt.formatToParts(new Date(iso));
  const hh = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const mm = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return (hh === 24 ? 0 : hh) * 60 + mm;
}

// B-reservas-6a frente O · la hora de pared la da `lib/agenda.ts`, que es
// donde también la necesita el merge del outbox. Una copia menos.
const localHHMM = centerHHMM;

// minutos desde medianoche → "HH:MM" (para decir la hora del suelo).
function hhmm(minutes: number): string {
  const hh = Math.floor(minutes / 60);
  const mm = minutes % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

// "HH:MM" → minutos desde medianoche. "24:00" son 1440: es el final del
// día, no las 00:00 del mismo (una ausencia de día entero acaba ahí).
function minOf(time: string): number {
  const [hh, mm] = time.split(":").map(Number);
  return (hh ?? 0) * 60 + (mm ?? 0);
}

// ── B-reservas-7a · la geometría del día ──────────────────────────────

/**
 * De qué hora a qué hora se pinta el día.
 *
 * Sale del horario del CENTRO de ese día con media hora de margen arriba y
 * abajo, redondeado a la hora. Un sábado de boda que abre a las 8:30
 * enseña las 8:30; 08:00–21:00 queda como valor por defecto de un centro
 * sin configurar.
 *
 * Y SIEMPRE se ensancha hasta cubrir toda cita y toda ausencia del día: una
 * cita que quedó fuera de horario —porque el festivo o la ausencia se
 * pusieron después— tiene que seguir viéndose y pudiéndose cobrar. Si la
 * franja visible no la cubriera, sería una cita impintable.
 */
function visibleRange(
  info: AgendaDayInfo | undefined,
  appts: AgendaAppointment[],
): { startMin: number; endMin: number } {
  let start = DEFAULT_START_MIN;
  let end = DEFAULT_END_MIN;
  if (info?.open && info.open.length > 0) {
    start = Math.min(...info.open.map((r) => minOf(r.startTime)));
    end = Math.max(...info.open.map((r) => minOf(r.endTime)));
    start = Math.floor((start - VISIBLE_MARGIN_MIN) / 60) * 60;
    end = Math.ceil((end + VISIBLE_MARGIN_MIN) / 60) * 60;
  }
  for (const a of appts) {
    if (a.status === "CANCELLED") continue;
    const s = localMinutes(a.start);
    // Una cita que acaba a medianoche da 0: es el final del día, no el
    // principio.
    const e0 = localMinutes(a.end);
    const e = e0 <= s ? 24 * 60 : e0;
    start = Math.min(start, Math.floor(s / 60) * 60);
    end = Math.max(end, Math.ceil(e / 60) * 60);
  }
  for (const ab of info?.absences ?? []) {
    start = Math.min(start, Math.floor(minOf(ab.startTime) / 60) * 60);
    end = Math.max(end, Math.ceil(minOf(ab.endTime) / 60) * 60);
  }
  start = Math.max(0, start);
  end = Math.min(24 * 60, Math.max(end, start + 60));
  return { startMin: start, endMin: end };
}

/**
 * Los huecos NO reservables de una columna dentro de la franja visible: lo
 * que cae fuera de sus tramos abiertos.
 *
 * `open === null` (centro sin configurar) devuelve CERO bandas: sin techo
 * no hay nada que apagar, que es como se comportaba antes del bloque.
 */
function closedBands(
  open: OpenRange[] | null | undefined,
  startMin: number,
  endMin: number,
): Array<{ from: number; to: number }> {
  if (open == null) return [];
  const abiertos = [...open]
    .map((r) => ({ from: minOf(r.startTime), to: minOf(r.endTime) }))
    .sort((a, b) => a.from - b.from);
  const out: Array<{ from: number; to: number }> = [];
  let cursor = startMin;
  for (const r of abiertos) {
    if (r.from > cursor) out.push({ from: cursor, to: Math.min(r.from, endMin) });
    cursor = Math.max(cursor, r.to);
  }
  if (cursor < endMin) out.push({ from: cursor, to: endMin });
  return out.filter((b) => b.to > b.from);
}

/** ¿Este minuto cae dentro de algún tramo abierto? Sin techo, siempre sí. */
function isOpenAt(open: OpenRange[] | null | undefined, minute: number): boolean {
  if (open == null) return true;
  return open.some((r) => minOf(r.startTime) <= minute && minute < minOf(r.endTime));
}

const todayLocalDate = centerToday;

function addDays(dateStr: string, n: number): string {
  const d = new Date(`${dateStr}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Instante UTC a partir de fecha local + minutos de pared (para slot-first).
function localToIso(dateStr: string, minutes: number): string {
  // Reutiliza el mismo truco de offset que el server: interpretar como UTC y
  // corregir por el offset de Madrid.
  const hh = Math.floor(minutes / 60);
  const mm = minutes % 60;
  const guess = Date.UTC(
    Number(dateStr.slice(0, 4)),
    Number(dateStr.slice(5, 7)) - 1,
    Number(dateStr.slice(8, 10)),
    hh,
    mm,
  );
  const off = tzOffsetMs(new Date(guess));
  let result = guess - off;
  const off2 = tzOffsetMs(new Date(result));
  if (off2 !== off) result = guess - off2;
  return new Date(result).toISOString();
}

const offFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});
function tzOffsetMs(date: Date): number {
  const parts = offFmt.formatToParts(date);
  const m: Record<string, number> = {};
  for (const p of parts) if (p.type !== "literal") m[p.type] = Number(p.value);
  const hour = m.hour === 24 ? 0 : m.hour;
  const asUtc = Date.UTC(m.year!, m.month! - 1, m.day!, hour!, m.minute!, m.second!);
  return asUtc - date.getTime();
}

// agenda-1 · `DraftBooking` se fue a `AgendaPage.darCita.tsx`, que es
// quien lo rellena. Aquí sólo se guarda y se manda a la API.

export interface AgendaPageProps {
  onClose: () => void;
  // Cita → caja: recibe las líneas del ticket pre-poblado para cargarlas en
  // el carrito y cobrar por el camino existente (SalePage). No toca el cobro.
  // B-reservas-5 F3 · "Cobrar en caja" ya no rehidrata líneas: abre el
  // DRAFT en el servidor y entrega su id. Quien manda en la navegación
  // (`App`) entra en contexto de borrador por el MISMO camino que usa la
  // mesa, y las líneas salen de `GET /tickets/:id` con el mapper que ya
  // existe (`tableDraft.ts::mapServerDraftLines`). Aquí no se escribe un
  // segundo mapper: el que había era una copia y ya había divergido
  // (perdía `holdedProductId`).
  // B-reservas-5 F4 · aviso que traer puesto al abrir (p.ej. "el cobro
  // se hizo bien pero la cita no se pudo finalizar"). Se enseña con el
  // toast que ya existe y se consume una sola vez.
  notice?: string | null;
  onNoticeShown?: () => void;
  // clinica-1 · con quién arranca el filtro por profesional. Lo usa el
  // TPV del sanitario sin caja para abrirle SU día. `undefined` = como
  // siempre: "Todos".
  //
  // Es el valor INICIAL y no un bloqueo: el sanitario puede poner
  // "Todos". Las citas de las compañeras no son datos de salud (la agenda
  // sólo enseña contacto, decisión de producto del 05-10) y necesita
  // verlas para saber si la sala está ocupada.
  staffFilterInicial?: string | null;
  // clinica-1 · ¿se le ofrece «Cobrar en caja»? `undefined` = sí, como
  // siempre. El TPV del sanitario sin caja lo pone en false.
  //
  // Esconder el botón es UI, no la frontera: `ensureCajaEnabled` rechaza
  // el checkout de un CLINICIAN en la API. Lo que se gana escondiéndolo
  // es no ofrecerle una acción que siempre va a fallar.
  puedeCobrar?: boolean;
  // clinica-2 · ¿lleva esta persona LA MARCA sanitaria? De ella depende
  // que se le ofrezca abrir la valoración de un paciente.
  //
  // La marca y no el rol (clinica-1 §2): una cajera-sanitaria lleva
  // `CASHIER` y una propietaria sanitaria `OWNER`, así que mirar el rol
  // dejaría fuera a las dos. Y esconderlo no es la frontera —cada ruta
  // clínica pasa por la función de acceso y por el registro—: lo que se
  // gana es no pintarle a la recepcionista un botón que siempre le va a
  // fallar y que le dejaría una línea DENIED por cada toque de curiosidad.
  esSanitario?: boolean;
  // clinica-8 · la marca sanitaria del servidor, cuando NO coincide con la
  // que esta pantalla recibió del login. Quien manda en la sesión (`App`)
  // la guarda; aquí sólo se avisa. Sin esto, marcar a alguien sanitario no
  // le llegaba al TPV hasta que cerraba sesión y volvía a entrar.
  onMarcaSanitaria?: (esSanitario: boolean) => void;
  /**
   * B-reservas-8 · LA PALABRA que usa este centro para los bonos. En el
   * código son `Voucher`; de cara al mostrador el spa dirá «programa» y la
   * clínica «bono». Ausente → «bono», el default de la columna.
   */
  bonoEtiqueta?: string;
  /**
   * pin-1 · «CAMBIAR MI PIN», PARA QUIEN SÓLO TIENE ESTA PANTALLA.
   *
   * El sanitario sin caja entra al TPV con su PIN y lo único que ve es la
   * agenda: no tiene el cajón de la venta, que es donde «Cambiar mi PIN»
   * está para todos los demás. Y al panel no entra —el login se lo dice
   * con `CASHIER_NOT_ALLOWED_IN_ADMIN`—, así que sin esto sería la única
   * persona que entra con PIN y no puede cambiarlo.
   *
   * **Sólo lo pasa la rama del sanitario** (`App.tsx`). Ausente, el botón
   * no se pinta: esta barra no tiene píxeles de sobra a 390 (la lección
   * de B-reservas-5 F8 es que lo que se cortaba era la acción principal),
   * y a la cajera no se le quita sitio para un botón que ya tiene en el
   * cajón.
   */
  onCambiarMiPin?: () => void;
  onEnterDraft?: (entry: {
    appointmentId: string;
    ticketId: string;
    clientName: string | null;
    serviceLabel: string;
    /** clinica-9 (15) · quién atiende la cita, para «Atendido por». */
    atendidoPor?: string | null;
  }) => void;
}

export function AgendaPage({
  onClose,
  onCambiarMiPin,
  onEnterDraft,
  notice,
  onNoticeShown,
  staffFilterInicial,
  puedeCobrar = true,
  esSanitario = false,
  onMarcaSanitaria,
  // B-reservas-8 · «bono» es el default de la columna: un centro que no
  // lo toque lee lo de siempre.
  bonoEtiqueta = "bono",
}: AgendaPageProps) {
  // clinica-9 (12) · con el día en el que se estaba, si fue hace nada.
  // Ver `lib/dia-de-la-agenda.ts`: el camino de la tablet es una
  // navegación de verdad y se lleva por delante todo el estado de React,
  // el día incluido.
  const [date, setDate] = useState<string>(() =>
    diaRecordado(todayLocalDate()),
  );
  const [day, setDay] = useState<AgendaDay | null>(null);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);
  // agenda-1 · DÍA O SEMANA, y nada más. Los tres controles de fecha de
  // antes (el campo nativo, la tira de siete chips y las dos flechas que
  // por debajo de 640 px no existían) eran tres maneras de hacer lo mismo
  // y ninguna enseñaba la semana. Ahora las flechas están siempre, la
  // semana es una vista de verdad y «Hoy» es un botón que sólo aparece
  // cuando hace falta.
  const [vista, setVista] = useState<"dia" | "semana">("dia");
  // La semana, cuando se mira. No pasa por la caché offline (ver
  // `fetchAgendaRange`): la pantalla que hay que poder mirar sin red es la
  // del día, y ésa sigue saliendo de la caché.
  const [semana, setSemana] = useState<AgendaDay | null>(null);
  const [cargandoSemana, setCargandoSemana] = useState(false);
  const [errorSemana, setErrorSemana] = useState<string | null>(null);
  const [services, setServices] = useState<CatalogProduct[]>([]);
  const [clientsById, setClientsById] = useState<Map<string, ClientRow>>(new Map());
  const [staffFilter, setStaffFilter] = useState<string | null>(
    staffFilterInicial ?? null,
  );
  // clinica-2 · la valoración de un paciente, como overlay sobre la
  // agenda. Es la puerta del SANITARIO a la historia: su TPV no tiene
  // `SalePage` detrás (clinica-1 §7), así que la sección Clientes —de
  // donde cuelga la ficha— no existe para él. La cita es su entrada
  // natural: es desde donde trabaja.
  const [valoracionDe, setValoracionDe] = useState<string | null>(null);
  // clinica-3 · la sesión de una CITA, como overlay a pantalla completa.
  // Mismo patrón que la valoración y por la misma razón (clinica-2 §7): lo
  // que la podóloga está haciendo es atender a una persona, no mirar un
  // detalle de agenda de reojo.
  const [sesionDe, setSesionDe] = useState<string | null>(null);
  // clinica-6 · LA HISTORIA VIVA del paciente de la cita. Guarda las dos
  // mitades: de quién es la historia y DE QUÉ CITA se abrió — porque
  // «Empezar esta revisión» abre la sesión, y una sesión cuelga de una
  // cita (clinica-3 §8.6). Sin el `appointmentId` el botón no podría
  // cumplir, y entonces no sale.
  const [historiaDe, setHistoriaDe] = useState<
    { clientId: string; appointmentId: string } | null
  >(null);
  // Y con qué tipos se abre la sesión al venir de la historia.
  const [tiposIniciales, setTiposIniciales] = useState<TipoDeVisita[] | null>(
    null,
  );
  // clinica-3 · el panel de cobros pendientes de la recepción.
  const [verCobros, setVerCobros] = useState(false);
  // B-reservas-9 · el panel de salud y la matriz cuelgan de aquí: se entra y
  // se sale sin dejar la agenda.
  const [saludAbierta, setSaludAbierta] = useState(false);
  const [matriz, setMatriz] = useState<{ focusServiceId: string | null } | null>(
    null,
  );
  // agenda-lista (hallazgo 🟡 4) · quién sabe hacer qué, para no ofrecer en
  // la columna de Lucía un servicio que Lucía no hace. `null` = todavía no
  // se sabe (o no hubo red): en ese caso no se filtra nada, ver
  // `serviciosQueSabeHacer`.
  const [skillsPorStaff, setSkillsPorStaff] = useState<Map<
    string,
    Set<string>
  > | null>(null);
  // Si la matriz es de sólo lectura para esta sesión, el aviso de «no hace
  // ninguno» tiene que mandar a quien SÍ la puede tocar, no a la cajera.
  //
  // clinica-8 (fase B, 17) · arranca en `null` —«todavía no se sabe»— y
  // ya no en `true`. Además del aviso, esto decide ahora si se pinta el
  // estetoscopio, y un `true` de partida se lo enseñaba a la cajera
  // durante el segundo que tarda la matriz en llegar. Mientras no se
  // sabe, no se ofrece: la salida equivocada de este dato es enseñar de
  // más.
  const [matrizEditable, setMatrizEditable] = useState<boolean | null>(null);
  // La cifra de la tarjeta nº 1 en el botón. Un panel que hay que abrir para
  // enterarse de que hay un problema es el mismo silencio de antes con otra
  // pantalla: el número tiene que verse desde la agenda.
  //
  // agenda-lista (hallazgo ⚪ 7) · sale de la foto compartida, no de un
  // `useState` propio. Antes el badge y el panel llevaban cada uno su
  // copia y se desincronizaban a la primera: el badge se enteraba al
  // cerrar la matriz y el panel no. Ahora cualquiera que vuelva a pedir
  // la salud los mueve a los dos.
  const saludSnapshot = useSyncExternalStore(
    subscribeHealthSnapshot,
    readHealthSnapshot,
    readHealthSnapshot,
  );
  const sinNadie = serviciosSinNadie(saludSnapshot?.health ?? null);
  const [draft, setDraft] = useState<DraftBooking | null>(null);
  const [detail, setDetail] = useState<AgendaAppointment | null>(null);
  // agenda-lista (hallazgo 🟡 6) · el «no» del motor al mover, con sus
  // alternativas. Separado de `bookError` a propósito: son dos paneles
  // distintos y un error del alta no puede pintarse en el detalle.
  const [moveError, setMoveError] = useState<{
    message: string;
    alternatives: AvailabilitySlot[];
  } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  // B-reservas-6a · el 409 del suelo NO es un error genérico: trae la frase
  // que se le lee a la clienta y los tres huecos que sí se le pueden dar.
  // Vive en el panel de alta, que es donde está la acción que falló — un
  // toast abajo-centro deja a la cajera leyendo al otro lado de la tablet.
  const [bookError, setBookError] = useState<{
    message: string;
    alternatives: AvailabilitySlot[];
  } | null>(null);
  // B-reservas-7a · la hoja de ausencias, que es donde Sole las escribe hoy
  // (en la columna, no en el admin). `null` = cerrada.
  const [absenceFor, setAbsenceFor] = useState<AgendaStaff | null>(null);
  // La ausencia pintada que se ha tocado, para ofrecer quitarla.
  const [absenceDetail, setAbsenceDetail] = useState<AgendaAbsence | null>(null);
  // clinica-8 · de la caché del catálogo, igual que el ensayo y las mesas:
  // vale sin red y está puesta antes de que esta pantalla exista.
  const clinicaEncendida = getCachedClinicaEnabled();
  // clinica-8 · la sesión cerrada de esta cita no dejó nada que cobrar. El
  // borrador ya existe (vacío) y lo que falta es que alguien añada el
  // servicio que se hizo; esto guarda a qué borrador ir.
  const [sesionSinCobro, setSesionSinCobro] = useState<{
    appointmentId: string;
    ticketId: string;
  } | null>(null);
  // clinica-8 · cancelar una cita es irreversible, libera el hueco y hasta
  // este bloque era UN toque sin confirmar, en una rejilla de cuatro
  // botones. La del 18-10 se perdió así: desapareció de la agenda, su hora
  // volvió a ofrecerse y en el historial de la paciente seguía sin decir
  // nada. Ahora pregunta, y dice lo que va a pasar.
  const [confirmarEstado, setConfirmarEstado] = useState<{
    id: string;
    status: AppointmentStatus;
  } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const durationByService = useMemo(() => {
    const m = new Map<string, { name: string; durationMin: number }>();
    for (const s of services) {
      if (s.kind === "SERVICE") {
        m.set(s.id, { name: s.name, durationMin: s.durationMin ?? 0 });
      }
    }
    return m;
  }, [services]);

  // ── B-reservas-7a · la geometría del día ──────────────────────────
  //
  // Tres datos que antes eran constantes del módulo y ahora salen del día:
  // la retícula del centro, y de qué hora a qué hora se pinta. Sin red
  // salen de la caché; sin caché, de los valores por defecto de B4.
  const dayInfo = useMemo(() => dayInfoOf(day, date), [day, date]);
  const slotMin = slotMinutesOf(day);
  // agenda-1 · la escala de la rejilla sale de la retícula: ver `pxPorMinuto`.
  const pxPorMin = pxPorMinuto(slotMin);
  const { startMin: dayStartMin, endMin: dayEndMin } = useMemo(
    () => visibleRange(dayInfo, day?.appointments ?? []),
    [dayInfo, day],
  );
  // El día cerrado: la rejilla no ofrece nada y lo dice con su nombre.
  const cerrado = dayInfo?.closed ?? null;

  // B-reservas-mostrador F5 · las dos cachés locales de las que vive esta
  // pantalla: los clientes (el nombre de la tarjeta) y el catálogo (el nombre
  // del servicio). Hasta este bloque se leían UNA VEZ al montar y no se
  // volvían a mirar, así que un cliente creado o sincronizado con la agenda
  // ya abierta se pintaba «Cliente» para siempre — es el segundo hallazgo del
  // 13-09 (`docs/qa/2026-09-13-ap11/20-lunes-cita.png`).
  //
  // El catálogo tenía el MISMO patrón y el mismo fallo latente (un servicio
  // nuevo se pintaba «Servicio»); se arregla igual, de paso, porque es el
  // mismo bug con otro nombre.
  const refrescarCachesLocales = useCallback(async () => {
    const [catalogo, clientes] = await Promise.all([
      loadCatalogFromCache(),
      loadClientsFromCache(),
    ]);
    setServices(catalogo);
    // El refresco MEZCLA, no reemplaza. El caché manda sobre lo que ya
    // había —una ficha editada trae el nombre nuevo—, pero un cliente que
    // el mapa conoce y el caché todavía no NO se pierde: si se reemplazara,
    // la clienta que se acaba de elegir en el selector volvería a «Sin
    // nombre» en cuanto el alta recargara el día, delante de ella.
    setClientsById((prev) => {
      const next = new Map(clientes.map((c) => [c.id, c]));
      for (const [id, c] of prev) if (!next.has(id)) next.set(id, c);
      return next;
    });
  }, []);

  const loadDay = useCallback(
    async (d: string) => {
      setLoading(true);
      try {
        const fresh = await fetchAgendaDay(d);
        setDay(fresh);
        setOffline(false);
        // clinica-8 · la marca sanitaria, al día. Llega con el refresco
        // que la agenda ya hacía; quien manda en la sesión (`App`) la
        // guarda, y así «Sesión de hoy» y la historia aparecen sin que
        // nadie tenga que cerrar sesión y volver a entrar.
        if (
          fresh.esSanitario !== undefined &&
          fresh.esSanitario !== esSanitario
        ) {
          onMarcaSanitaria?.(fresh.esSanitario);
        }
      } catch {
        const cached = await loadAgendaDayFromCache(d);
        setDay(cached ?? { date: d, staff: [], appointments: [] });
        setOffline(true);
      } finally {
        setLoading(false);
      }
      // Después de pintar el día, y sin bloquearlo: si entretanto se dio de
      // alta una clienta o un servicio, el siguiente pintado ya los sabe.
      void refrescarCachesLocales();
    },
    [refrescarCachesLocales, esSanitario, onMarcaSanitaria],
  );

  useEffect(() => {
    void loadDay(date);
    // clinica-9 (12) · y se apunta el día. Aquí y no en cada `setDate`
    // porque hay media docena de sitios que lo cambian (las flechas, el
    // selector, la tira de siete días, volver de una cita movida) y uno
    // que se olvidara sería el único camino desde el que la tablet
    // volvería a «Hoy».
    recordarDiaDeLaAgenda(date);
  }, [date, loadDay]);

  // agenda-lista (hallazgo 🟡 1) · la agenda se asegura de tener los
  // nombres, en vez de esperar a que alguien abra Clientes.
  //
  // El caché de clientes lo llenaba SÓLO la pantalla Clientes, así que en
  // un dispositivo recién emparejado la rejilla decía «Sin nombre» en
  // todas las citas. Es el estado exacto del AP11 el primer día: lo
  // emparejas, abres la agenda y la recepción no sabe de quién es la cita
  // de las diez.
  //
  // Una vez al abrir la agenda, no en cada día que se pinta: `loadDay`
  // corre cada vez que se toca el selector de fecha y esto se bajaría el
  // tenant entero en cada toque. La decisión de si hace falta está en
  // `necesitaRefrescoDeClientes`, y la bajada es la MISMA función que usa
  // la pantalla Clientes (`refreshClients`, con su mezcla de altas
  // offline). Sin red se queda con lo que haya: una agenda que no abre
  // sería peor que algún «Sin nombre».
  useEffect(() => {
    let cancelado = false;
    void asegurarClientesEnCache().then((hubo) => {
      // Sólo se repinta si de verdad bajó algo. `refrescarCachesLocales`
      // MEZCLA, no reemplaza: ver su comentario.
      if (hubo && !cancelado) void refrescarCachesLocales();
    });
    return () => {
      cancelado = true;
    };
  }, [refrescarCachesLocales]);

  // B-reservas-5 F4 · el aviso que viene de fuera (el cobro que no pudo
  // finalizar la cita) se enseña al abrir, que es cuando la cajera tiene
  // delante el botón "Finalizar".
  useEffect(() => {
    if (!notice) return;
    setToast(notice);
    const t = window.setTimeout(() => setToast(null), 6000);
    onNoticeShown?.();
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notice]);

  // B-reservas-6a frente O · un alta encolada que el servidor acepta (o
  // rechaza) cambia lo que hay que pintar sin que nadie toque la pantalla.
  // El outbox avisa; la agenda se repinta.
  useEffect(() => {
    return subscribeOutbox(() => {
      void loadDay(date);
    });
  }, [date, loadDay]);

  // Auto-scroll a la línea "ahora" al abrir el día de hoy.
  useEffect(() => {
    if (date === todayLocalDate() && scrollRef.current) {
      const now = localMinutes(new Date().toISOString());
      scrollRef.current.scrollTop = Math.max(
        0,
        (now - dayStartMin) * pxPorMinuto(slotMinutesOf(day)) - 120,
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, day, dayStartMin]);

  const flash = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 3500);
  };

  const activeStaff = useMemo(
    () => (day?.staff ?? []).filter((s) => s.active),
    [day],
  );
  const columns = useMemo(() => {
    if (staffFilter) return activeStaff.filter((s) => s.userId === staffFilter);
    return activeStaff;
  }, [activeStaff, staffFilter]);

  // Las ausencias que van en cada columna. Las del CENTRO (sin dueño) se
  // pintan en todas: un cierre por formación afecta a quien esté.
  const absencesByStaff = useMemo(() => {
    const m = new Map<string, AgendaAbsence[]>();
    for (const s of activeStaff) {
      m.set(
        s.userId,
        (dayInfo?.absences ?? []).filter(
          (a) => a.staffUserId === s.userId || a.staffUserId === null,
        ),
      );
    }
    return m;
  }, [dayInfo, activeStaff]);

  // Las altas del outbox que el servidor rechazó. No se van solas de la
  // pantalla: la cajera tiene que poder verlas y decidir.
  const rechazadas = useMemo(
    () => (day?.appointments ?? []).filter((a) => a.outboxStatus === "rejected"),
    [day],
  );

  // B-reservas-mostrador F5 · «Cliente» SE LEE COMO UN NOMBRE. Una tarjeta
  // que pone «16:00 · Cliente» parece una cita de alguien que se llama así,
  // no un dato que falta — y eso es lo que engañó el 13-09. El marcador dice
  // que falta el dato, y se pinta apagado para que no compita con los
  // nombres de verdad.
  const NOMBRE_QUE_FALTA = "Sin nombre";

  /** El nombre para pintar, y si es el marcador o un nombre de verdad. */
  const clientLabel = (
    id: string | null,
  ): { nombre: string; desconocido: boolean } => {
    if (!id) return { nombre: "Sin cliente", desconocido: false };
    const c = clientsById.get(id);
    if (c) return { nombre: clientFullName(c), desconocido: false };
    return { nombre: NOMBRE_QUE_FALTA, desconocido: true };
  };

  /** El nombre para MANDAR a otra pantalla: `null` si no se sabe. Aquí el
   *  marcador no vale — la caja pondría «Sin nombre» como si fuera el
   *  nombre de la clienta en el contexto del borrador. */
  const clientNameOrNull = (id: string | null): string | null => {
    const c = id ? clientsById.get(id) : null;
    return c ? clientFullName(c) : null;
  };


  const serviceNames = (a: AgendaAppointment): string =>
    a.items
      .map((it) => durationByService.get(it.serviceId)?.name ?? "Servicio")
      .join(" + ");

  // Citas por columna de profesional (una cita con K staff aparece en cada
  // columna que la atiende).
  const apptsByStaff = useMemo(() => {
    const m = new Map<string, AgendaAppointment[]>();
    for (const a of day?.appointments ?? []) {
      if (a.status === "CANCELLED") continue;
      const staffIds = new Set(
        a.assignments
          .filter((x) => x.reservableType === "STAFF" && x.staffUserId)
          .map((x) => x.staffUserId as string),
      );
      if (staffIds.size === 0) {
        const arr = m.get("__unassigned__") ?? [];
        arr.push(a);
        m.set("__unassigned__", arr);
      } else {
        for (const sid of staffIds) {
          const arr = m.get(sid) ?? [];
          arr.push(a);
          m.set(sid, arr);
        }
      }
    }
    return m;
  }, [day]);


  // ── Acciones ──────────────────────────────────────────────────────

  // B-reservas-7a · una ausencia es un `BookingBlock scope=STAFF` por la
  // API que ya existe. No se crea ninguna entidad nueva.
  async function ponerAusencia(
    staff: AgendaStaff,
    startTime: string,
    endTime: string,
    reason: string,
  ) {
    const res = await createAbsence({
      staffUserId: staff.userId,
      date,
      startTime,
      endTime,
      reason,
    });
    setAbsenceFor(null);
    if (!res.ok) {
      flash(res.message);
      return;
    }
    flash(
      startTime === ALL_DAY_START && endTime === ALL_DAY_END
        ? `${staff.displayName} no está hoy.`
        : `${staff.displayName} no está de ${startTime} a ${endTime}.`,
    );
    await loadDay(date);
  }

  async function quitarAusencia(a: AgendaAbsence) {
    setAbsenceDetail(null);
    if (!a.id) {
      flash("Esa ausencia no se puede quitar desde aquí.");
      return;
    }
    const res = await deleteAbsence(a.id);
    if (!res.ok) {
      flash(res.message);
      return;
    }
    flash("Ausencia quitada.");
    await loadDay(date);
  }

  async function doCreate(cobrar: boolean) {
    if (!draft || draft.serviceIds.length === 0 || !draft.start) return;
    setBookError(null);
    const res = await createAppointment({
      clientId: draft.clientId,
      items: draft.serviceIds.map((serviceId) => ({
        serviceId,
        staffUserId: draft.staffUserId,
      })),
      start: draft.start,
      source: "PRESENCIAL",
      // B-reservas-8 · `null` en toda cita normal, que es casi todas.
      voucherId: draft.voucherId ?? null,
      // Sólo para pintarla en su hueco mientras está encolada: el schema
      // del alta no acepta este campo y el outbox no lo envía.
      durationMin: draft.serviceIds.reduce(
        (sum, id) => sum + (durationByService.get(id)?.durationMin ?? 0),
        0,
      ),
    });
    if (!res.ok) {
      // El servidor ya redacta la frase (BOOKING_IN_PAST / BOOKING_OFF_GRID
      // y los que vengan): aquí no se reescribe, se enseña — con sus
      // alternativas tocables.
      setBookError({ message: res.message, alternatives: res.alternatives ?? [] });
      return;
    }
    // clinica-8 (fase B, 17) · lo que acaba de entrar en una cita cuenta
    // para el orden de la próxima lista. Se apunta AQUÍ —con la reserva
    // hecha— y no al tocar el chip: lo que se quiere contar son las
    // citas que existen, no los botones que alguien tocó y deshizo.
    // También cuenta la encolada sin red: es una cita que se va a dar.
    apuntarUsoDeServicios(draft.serviceIds, tenantDelTerminal());
    setDraft(null);
    setBookError(null);
    if (res.queuedOffline) flash("Cita guardada sin red; se enviará al reconectar.");
    // agenda-1 · Y LA AGENDA SE VA AL DÍA DE LA CITA que acaba de entrar.
    //
    // «Dársela» y «Otra fecha» pueden reservar en un día que no es el que
    // se está viendo, y hasta aquí la cita se guardaba y no se veía en
    // ninguna parte: la recepción se quedaba mirando hoy sin más
    // confirmación que un panel que se cierra. Ahora se va allí, que es
    // donde está la cita — y es además la confirmación más barata que
    // hay: se ve en su hueco.
    const diaDeLaCita = centerWallDate(
      res.queuedOffline ? draft.start : res.appointment.start,
    );
    if (diaDeLaCita !== date) setDate(diaDeLaCita);
    else await loadDay(date);
    if (cobrar && !res.queuedOffline) {
      await doCheckout(res.appointment.id);
    }
  }

  /** El nombre del profesional asignado a una cita, o `null`. El mismo
   *  que encabeza su columna en la rejilla. */
  function profesionalDeLaCita(appt: AgendaAppointment): string | null {
    const id =
      appt.assignments.find((a) => a.reservableType === "STAFF")?.staffUserId ??
      null;
    if (!id) return null;
    return day?.staff.find((s) => s.userId === id)?.displayName ?? null;
  }

  function entrarEnElBorrador(appointmentId: string, ticketId: string) {
    if (!onEnterDraft) {
      flash("Ticket pre-poblado abierto en caja.");
      return;
    }
    const appt =
      day?.appointments.find((a) => a.id === appointmentId) ?? detail ?? null;
    onEnterDraft({
      appointmentId,
      ticketId,
      clientName: appt ? clientNameOrNull(appt.clientId) : null,
      serviceLabel: appt ? serviceNames(appt) : "",
      // clinica-9 (15) · «Atendido por» YA PUESTO. Era un campo de texto
      // libre en blanco en el cobro de una cita que ya sabe quién la
      // atiende: la recepción lo dejaba vacío o lo tecleaba a mano con
      // la paciente delante, y en el ticket acababa un nombre a medias o
      // ninguno. Sale de la asignación de la cita, que es la MISMA
      // columna de la agenda en la que está pintada.
      atendidoPor: appt ? profesionalDeLaCita(appt) : null,
    });
    onClose();
  }

  async function doCheckout(appointmentId: string) {
    const res = await checkoutAppointmentTicket(appointmentId);
    if (!res.ok) {
      flash(res.message);
      return;
    }
    // clinica-8 · LA SESIÓN NO DEJÓ NADA QUE COBRAR, y eso se dice ANTES de
    // irse a caja. El borrador existe y está vacío a propósito; lo que no
    // se hace ya es rellenarlo con los servicios RESERVADOS de la cita —
    // cobrar la previsión en vez del trabajo, que es lo que la auditoría
    // del 18-10 se encontró y que nadie ve porque los importes cuadran.
    //
    // El aviso va en el detalle y no en un toast: un toast de 3,5 s sobre
    // una pantalla que se cierra sola no lo lee nadie, y lo que hay que
    // hacer después (añadir el servicio) necesita un botón.
    if (res.sesionSinCobro) {
      setSesionSinCobro({ appointmentId, ticketId: res.ticket.id });
      return;
    }
    entrarEnElBorrador(appointmentId, res.ticket.id);
  }

  // Una cita que todavía vive en el outbox NO existe en el servidor:
  // abrir su detalle ofrecería "Cobrar en caja" sobre algo que no está.
  // Se cuenta lo que le pasa, que es lo que la cajera necesita saber.
  function abrirCita(a: AgendaAppointment) {
    if (!a.pendingOffline) {
      setDetail(a);
      return;
    }
    flash(
      a.outboxStatus === "rejected"
        ? `No se pudo guardar: ${a.outboxError ?? "el servidor la rechazó"}`
        : "Cita guardada sin red; se enviará al reconectar.",
    );
  }

  async function changeStatus(id: string, status: AppointmentStatus) {
    const res = await patchAppointment(id, { status });
    if (!res.ok) {
      flash(res.message);
      return;
    }
    setDetail(res.appointment);
    await loadDay(date);
  }

  /**
   * agenda-lista (hallazgo 🟡 6) · mover una cita de día y hora.
   *
   * La API y el cliente ya lo sabían hacer (`PATCH /agenda/appointments/:id`
   * con `start`, `patchAppointment`); lo que faltaba era la pantalla. En
   * una peluquería las clientas cambian de hora todos los días, y hasta
   * aquí el único camino era cancelar y volver a dar la cita — que pierde
   * el histórico de la original.
   *
   * Tres cosas que conviene tener escritas:
   *
   *   · **Conserva la profesional si nadie pide otra.** Sin
   *     `staffUserId`, el PATCH fija la que la cita ya tiene
   *     (`routes.ts`, rama de `start`), así que la clienta cambia de HORA
   *     y no de peluquera. Si con ella no cabe, el «no» y las
   *     alternativas son suyas.
   *   · **mover-con-otra · y si la recepción pide otra, se manda.** La
   *     hoja manda `staffUserId` SÓLO cuando la elegida es distinta de la
   *     actual, así que «a otra hora con la misma» sigue siendo byte a
   *     byte la petición de agenda-lista. La cita no cambia de id ni
   *     pierde su histórico: es la misma, en otra columna.
   *   · **Si falla no pasa nada.** `start` y `status` son ramas distintas
   *     del PATCH: un movimiento rechazado no mueve la cita ni le cambia
   *     el estado. El motivo y las alternativas son las que ya devuelve el
   *     motor, las mismas del alta — más los dos «no» que ahora da la
   *     ruta antes de llamarlo (`STAFF_NO_SKILL`, `STAFF_NOT_FOUND`).
   *   · **No hay camino offline.** `patchAppointment` no encola; el botón
   *     lo dice en vez de prometer algo que no va a pasar.
   */
  async function doMove(id: string, startISO: string, staffUserId?: string) {
    const antes = staffDeLaCita(detail);
    const res = await patchAppointment(id, {
      start: startISO,
      // Sólo si de verdad cambia de manos: mandar la actual sería pedirle
      // a la ruta una comprobación de matriz que nadie necesita, y pasar
      // por un camino distinto al de agenda-lista para el caso de siempre.
      ...(staffUserId && staffUserId !== antes ? { staffUserId } : {}),
    });
    if (!res.ok) {
      setMoveError({ message: res.message, alternatives: res.alternatives ?? [] });
      return;
    }
    setMoveError(null);
    setDetail(res.appointment);
    const diaNuevo = centerWallDate(res.appointment.start);
    // Cambiar de día dispara `loadDay` por el efecto del selector; si se
    // queda en el mismo día hay que recargarlo a mano.
    if (diaNuevo !== date) setDate(diaNuevo);
    else await loadDay(date);

    const despues = staffDeLaCita(res.appointment);
    const cuando = `${diaNuevo} a las ${localHHMM(res.appointment.start)}`;
    // mover-con-otra · ahora el cambio de columna puede ser LO PEDIDO, no
    // una sorpresa — y se dice igual: es la confirmación de que la cita
    // está donde la recepción quería. Si no cambia, el aviso no la nombra.
    flash(
      despues && despues !== antes
        ? `Cita movida al ${cuando} · ahora con ${nombreDeStaff(despues)}`
        : `Cita movida al ${cuando}`,
    );
  }

  function nombreDeStaff(userId: string): string {
    return (
      day?.staff.find((s) => s.userId === userId)?.displayName ?? "otra persona"
    );
  }

  // Tap en un hueco vacío de una columna → alta slot-first.
  function openSlotFirst(staffUserId: string | null, minutes: number) {
    // B-reservas-7a · se redondea HACIA ABAJO, no al más cercano. Con la
    // retícula pintada (sobre todo a 30) redondear al más cercano
    // contradice lo que se ve: la mitad de abajo de la banda de las 11:00
    // abriría un alta a las 11:30. Se toca una banda, se coge esa banda.
    const snapped = Math.floor(minutes / slotMin) * slotMin;

    // B-reservas-7a · el día cerrado no ofrece NADA, y lo dice con su
    // nombre. Tocarlo para acabar en un 409 es pasear a la cajera delante
    // de la clienta.
    if (cerrado) {
      flash(
        cerrado.name
          ? `El centro está cerrado ese día · ${cerrado.name}.`
          : "El centro está cerrado ese día.",
      );
      return;
    }
    // Fuera de los tramos abiertos de ESA columna tampoco se abre un alta:
    // o el centro no abre a esa hora, o esa profesional no está.
    const abiertos = staffUserId
      ? (dayInfo?.staffOpen?.[staffUserId] ?? null)
      : (dayInfo?.open ?? null);
    if (dayInfo && !isOpenAt(abiertos, snapped)) {
      flash(
        abiertos && abiertos.length > 0
          ? `A esa hora no se reserva. El horario es ${abiertos
              .map((r) => `${r.startTime}–${r.endTime}`)
              .join(" y ")}.`
          : "A esa hora no se reserva: ese día no hay turno en esta columna.",
      );
      return;
    }
    // Y una ausencia pintada es la tercera causa, con su motivo.
    const ausencia = (dayInfo?.absences ?? []).find(
      (a) =>
        (a.staffUserId === staffUserId || a.staffUserId === null) &&
        minOf(a.startTime) <= snapped &&
        snapped < minOf(a.endTime),
    );
    if (ausencia) {
      flash(
        ausencia.reason
          ? `A esa hora no está: ${ausencia.reason}.`
          : "A esa hora no está.",
      );
      return;
    }

    // B-reservas-6a · una franja pasada NO invita a crear una cita. El
    // servidor la rechazaría igual (409 BOOKING_IN_PAST); enseñar el panel
    // de alta para acabar en un error es pasear a la cajera delante de la
    // clienta. Se corta aquí y se dice a partir de qué hora sí.
    if (snapped < earliestMin) {
      flash(
        isPastDay
          ? "Ese día ya ha pasado. Elige hoy o un día siguiente."
          : `Esa hora ya ha pasado. El primer hueco es a las ${hhmm(earliestMin)}.`,
      );
      return;
    }
    setDetail(null);
    setBookError(null);
    // agenda-1 · H8 · TOCAR UN HUECO NO BORRA LA PACIENTE.
    //
    // Pasada del 27-10, hallazgo H8: tras «Dársela ahora» —que deja el
    // panel con la paciente puesta— tocar una hora en la rejilla reabría
    // «Nueva cita» EN BLANCO. Este `setDraft` era un objeto nuevo con
    // `clientId: null`, y se llevaba por delante lo que la banda acababa
    // de poner. Con la paciente delante del mostrador.
    //
    // Ahora el toque en un hueco escribe LA HORA (y la profesional de esa
    // columna) en el borrador que haya, y sólo abre uno nuevo si no hay
    // ninguno. Que es además lo que convierte el camino en UN toque:
    // hueco + Reservar.
    setDraft((previo) =>
      previo
        ? { ...previo, staffUserId, start: localToIso(date, snapped) }
        : {
            clientId: null,
            clientName: null,
            serviceIds: [],
            staffUserId,
            start: localToIso(date, snapped),
          },
    );
  }

  /** agenda-1 · «Dar cita» en frío, desde la cabecera. */
  function abrirDarCita() {
    setDetail(null);
    setBookError(null);
    setDraft({
      clientId: null,
      clientName: null,
      serviceIds: [],
      staffUserId: null,
      start: null,
    });
  }

  /**
   * agenda-1 · un pendiente de recepción, atendido.
   *
   * «Dársela» abre el panel con TODO lo que se sabe puesto: la paciente,
   * los servicios de la cita que lo propuso y el día desde el que buscar.
   * Lo que falta son dos toques — la hora y Reservar — y es la cuenta que
   * el bloque persigue.
   */
  function atenderPendiente(p: PendienteDeRecepcion) {
    if (p.accion === "TABLET") {
      setValoracionDe(p.clientId);
      return;
    }
    const cita = p.appointmentId
      ? (day?.appointments.find((a) => a.id === p.appointmentId) ?? null)
      : null;
    setDetail(null);
    setBookError(null);
    setDraft({
      clientId: p.clientId,
      clientName: clientNameOrNull(p.clientId),
      // Los servicios de la cita que propuso la próxima: es lo que se le
      // HIZO, y es el único origen honesto que hay hoy para el chip (ver
      // la cabecera de `AgendaPage.darCita.tsx`).
      serviceIds: cita ? cita.items.map((it) => it.serviceId) : [],
      staffUserId: null,
      start: null,
      propuesta: p.desde
        ? {
            desde: p.desde,
            // Si el APK no conoce esa propuesta (un servidor más nuevo),
            // el chip dice el día y no una etiqueta vacía.
            comoSeLlama: p.comoSeLlama ?? `Desde el ${p.desde}`,
            serviciosDeHoy: cita ? cita.items.map((it) => it.serviceId) : [],
          }
        : null,
    });
    // Y el día de la agenda NO se mueve.
    //
    // clinica-9 (9) lo movía al propuesto, porque «Buscar hueco» buscaba
    // sobre el día que se estaba viendo. El panel de agenda-1 lleva su
    // propia ventana (`draft.propuesta.desde`), así que ya no hace falta —
    // y moverlo tenía un precio: si la recepción cerraba el panel se
    // quedaba en el 24 de noviembre, con la agenda de hoy a seis toques de
    // flecha. Al reservar sí se va al día de la cita (ver `doCreate`), que
    // es cuando hay algo que mirar allí.
  }

  const isToday = date === todayLocalDate();
  const isPastDay = date < todayLocalDate();
  const nowMin = localMinutes(new Date().toISOString());
  // EL SUELO, en la misma aritmética que el motor: el comienzo de la franja
  // en curso. A las 11:10 son las 11:00 — la franja en curso SE RESERVA
  // ("¿tienes hueco ahora?" es media agenda de una peluquería), y por eso
  // la línea de "ahora" cae DENTRO de la última franja que aún se ofrece.
  //
  // B-reservas-7a · con la retícula de 30 la franja es el DOBLE de grande:
  // a las 11:29 todavía se pueden dar las 11:00, a las 11:30 ya no. Mismo
  // precio, decisión del bloque.
  const floorMin = Math.floor(nowMin / slotMin) * slotMin;
  const earliestMin = isPastDay
    ? Number.POSITIVE_INFINITY
    : isToday
      ? floorMin
      : Number.NEGATIVE_INFINITY;
  // Hasta dónde se pinta apagada la columna. `null` = nada del día ha
  // pasado (un día futuro).
  const pastUntilMin = isPastDay ? dayEndMin : isToday ? floorMin : null;

  // agenda-lista · mover una cita NO tiene camino offline: el PATCH de
  // `start` no pasa por el outbox. `offline` es que el día se pintó desde
  // el caché; `navigator.onLine === false` es que el sistema ya sabe que
  // no hay red. Cualquiera de las dos basta para apagar el botón con su
  // motivo, en vez de prometer algo que no va a pasar.
  const sinRed =
    offline ||
    (typeof navigator !== "undefined" && navigator.onLine === false);

  // B-reservas-9 · una sola lectura al abrir la agenda. Si no hay red no
  // pasa nada: el botón se queda con la cifra de la última foto, o sin
  // cifra. Nunca con un cero inventado.
  useEffect(() => {
    // El resultado no se guarda aquí: `fetchAgendaHealth` escribe la foto
    // compartida y quien la mire se entera solo.
    void fetchAgendaHealth().catch(() => undefined);
  }, []);

  // agenda-lista (hallazgo 🟡 4) · la matriz servicio × profesional, para
  // que el alta en la columna de alguien ofrezca sólo lo que esa persona
  // hace. Una lectura al abrir la agenda, y otra al volver de tocarla.
  const cargarMatriz = useCallback(async () => {
    try {
      const m = await fetchSkillMatrix();
      setSkillsPorStaff(indexarMatrizPorProfesional(m));
      setMatrizEditable(m.editable);
    } catch {
      // Sin red se ofrecen todos los servicios y el motor sigue siendo la
      // puerta: inventarse un "no" por una lectura que falló sería peor.
      setSkillsPorStaff(null);
    }
  }, []);

  useEffect(() => {
    void cargarMatriz();
  }, [cargarMatriz]);

  // ── agenda-1 · LA SEMANA ──────────────────────────────────────────
  //
  // Se pide al entrar en la vista y al cambiar de semana, no en cada
  // cambio de día: moverse dentro de la misma semana no cambia nada de
  // lo que la semana pinta.
  const lunes = lunesDeLaSemana(date);
  useEffect(() => {
    if (vista !== "semana") return;
    let vivo = true;
    setCargandoSemana(true);
    setErrorSemana(null);
    const dias = sieteDias(lunes);
    void fetchAgendaRange(dias[0]!, dias[dias.length - 1]!)
      .then((r) => {
        if (!vivo) return;
        setSemana(r);
      })
      .catch(() => {
        if (!vivo) return;
        setSemana(null);
        setErrorSemana(
          "La semana necesita conexión. El día de hoy sí se ve sin red.",
        );
      })
      .finally(() => {
        if (vivo) setCargandoSemana(false);
      });
    return () => {
      vivo = false;
    };
  }, [vista, lunes]);

  // ── agenda-1 · LO QUE LA LISTA Y LA REJILLA NECESITAN ─────────────

  /**
   * D1 · ¿hay UNA sola profesional en esta pantalla?
   *
   * Decisión de Matías: una → lista; varias → rejilla. «Una» incluye el
   * caso de un centro de varias con el filtro puesto en una de ellas —
   * «mi día» es exactamente el día de una profesional.
   */
  const unaSola = columns.length === 1 ? columns[0]! : null;

  /** Minutos de pared del inicio y del fin de una cita. */
  const minutosDe = useCallback(
    (a: AgendaAppointment) => {
      const desdeMin = localMinutes(a.start);
      const fin = localMinutes(a.end);
      return { desdeMin, hastaMin: fin <= desdeMin ? 24 * 60 : fin };
    },
    [],
  );

  /**
   * Las citas de la lista: las de la única profesional MÁS las que no
   * tienen a nadie asignado.
   *
   * La rejilla les da una columna propia («Sin asignar»); la lista no
   * tiene columnas, y dejarlas fuera sería esconder citas del día — que
   * es la única cosa que esta pantalla no puede hacer.
   */
  const apptsDeLaLista = useMemo(() => {
    if (!unaSola) return [];
    return [
      ...(apptsByStaff.get(unaSola.userId) ?? []),
      ...(apptsByStaff.get("__unassigned__") ?? []),
    ];
  }, [unaSola, apptsByStaff]);

  const serviciosQueCaben = useMemo(
    () =>
      services
        .filter((x) => x.kind === "SERVICE" && (x.durationMin ?? 0) > 0)
        .map((x) => ({ nombre: x.name, duracionMin: x.durationMin ?? 0 })),
    [services],
  );

  /** El chip de estado de una fila, con todo lo que el día sabe. */
  const estadoDe = useCallback(
    (a: AgendaAppointment, esAhora: boolean): EstadoDeLaFila =>
      estadoDeLaFila({
        status: a.status,
        cobradoCents: day?.cobradoPorCita?.[a.id] ?? null,
        sesionPorCobrar: (day?.sesionesPorCobrar ?? []).includes(a.id),
        valoracionPendiente:
          a.clientId != null &&
          (day?.valoracionesPendientes ?? []).includes(a.clientId),
        esAhora,
        pendienteOffline: a.pendingOffline === true,
        rechazada: a.outboxStatus === "rejected",
      }),
    [day],
  );

  /**
   * agenda-1 · tablero 4 · qué está haciendo cada profesional ahora.
   *
   * «Ahora: Mari Carmen · tinte» o «Libre hasta las 11:00». Sale del
   * RELOJ y no del estado de la cita: «en sala» lo marca una persona y se
   * olvida, y la pregunta que la cabecera contesta —«¿quién está libre?»—
   * es del reloj. Es la misma regla que `ahoraYDespues` usa en la lista.
   *
   * `null` en un día que no es hoy: ahí la cabecera es sólo el nombre.
   */
  const queHaceAhora = useCallback(
    (staffUserId: string): { texto: string; ocupada: boolean } | null => {
      if (!isToday) return null;
      const suyas = (apptsByStaff.get(staffUserId) ?? []).map((a) => ({
        a,
        ...minutosDe(a),
      }));
      const enCurso = suyas.find(
        (x) => x.desdeMin <= nowMin && nowMin < x.hastaMin,
      );
      if (enCurso) {
        return {
          texto: `Ahora: ${clientLabel(enCurso.a.clientId).nombre} · ${serviceNames(enCurso.a)}`,
          ocupada: true,
        };
      }
      const hasta = libreHastaLas(suyas, nowMin);
      return {
        texto: hasta ? `Libre hasta las ${hasta}` : "Libre el resto del día",
        ocupada: false,
      };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isToday, apptsByStaff, nowMin, minutosDe, clientsById, services],
  );

  /** Lo que la recepción tiene pendiente, de `lib/agenda-recepcion.ts`. */
  const pendientes = useMemo(
    () =>
      pendientesDeRecepcion({
        proximasCitas: day?.proximasCitas ?? [],
        nombreDeLaPropuesta: NOMBRE_DE_PROXIMA_CITA,
        valoracionesPendientes: day?.valoracionesPendientes ?? [],
        clientesDelDia: (day?.appointments ?? [])
          .filter((a) => a.status !== "CANCELLED" && a.clientId)
          .map((a) => a.clientId!),
        puedeCobrar,
      }),
    [day, puedeCobrar],
  );

  /** Las tres cifras del día, y lo cobrado de verdad. */
  const tramosDeLaLista = useMemo(
    () => apptsDeLaLista.map((a) => ({ id: a.id, ...minutosDe(a) })),
    [apptsDeLaLista, minutosDe],
  );
  const abiertosDeLaLista = useMemo(
    () =>
      cerrado
        ? []
        : (unaSola
            ? (dayInfo?.staffOpen?.[unaSola.userId] ?? dayInfo?.open ?? [])
            : []),
    [cerrado, unaSola, dayInfo],
  );
  const cifras = useMemo(
    () =>
      cifrasDelDia({
        citas: tramosDeLaLista,
        hechas: apptsDeLaLista.filter(
          (a) => a.status === "COMPLETED" || a.status === "NO_SHOW",
        ).length,
        abiertos: abiertosDeLaLista.map((r) => ({
          desdeMin: minOf(r.startTime),
          hastaMin: minOf(r.endTime),
        })),
        ausencias: (absencesByStaff.get(unaSola?.userId ?? "") ?? []).map(
          (ab) => ({
            desdeMin: minOf(ab.startTime),
            hastaMin: minOf(ab.endTime),
          }),
        ),
        sueloMin: pastUntilMin,
      }),
    [
      tramosDeLaLista,
      apptsDeLaLista,
      abiertosDeLaLista,
      absencesByStaff,
      unaSola,
      pastUntilMin,
    ],
  );
  /**
   * Lo cobrado del día. `null` = no se sabe: sin red `cobradoPorCita` no
   * viaja en la caché (es dinero), y la tarjeta enseña «—» en vez de un
   * cero que parece bueno y no lo es.
   */
  const cobradoDelDia = useMemo(() => {
    const mapa = day?.cobradoPorCita;
    if (!mapa) return null;
    return apptsDeLaLista.reduce((suma, a) => suma + (mapa[a.id] ?? 0), 0);
  }, [day, apptsDeLaLista]);

  /**
   * El suelo de un día cualquiera de la semana.
   *
   * La misma aritmética que `earliestMin`/`pastUntilMin` para el día que
   * se está viendo, aplicada a otra fecha: `null` = nada de ese día ha
   * pasado; `Infinity` = el día entero pasó; hoy = el comienzo de la
   * franja en curso. Sin esto la semana ofrecería «+ libre 2 h» en la
   * mañana del lunes pasado.
   */
  const sueloDeLaFecha = useCallback(
    (fecha: string): number | null => {
      const hoy = todayLocalDate();
      if (fecha < hoy) return Number.POSITIVE_INFINITY;
      if (fecha > hoy) return null;
      return floorMin;
    },
    [floorMin],
  );

  /**
   * La línea de aviso bajo el servicio de una fila.
   *
   * El diseño enseña ahí «Falta firmar el consentimiento de cirugía». Ese
   * dato no viaja en la respuesta del día (haría falta consultar las
   * firmas de cada paciente en el camino que se pinta cincuenta veces al
   * día), así que queda para otro bloque y apuntado en el `-done`. Lo que
   * sí se dice aquí es lo que el día ya sabe y la recepción necesita: por
   * qué una cita no se pudo guardar, y que una cita quedó fuera del
   * horario porque el festivo o la ausencia se pusieron después.
   */
  const avisoDeLaCita = useCallback(
    (a: AgendaAppointment): string | null => {
      if (a.outboxStatus === "rejected") {
        return `No se pudo guardar: ${a.outboxError ?? "el servidor la rechazó"}`;
      }
      if (a.pendingOffline) return "Sin red todavía: se enviará al reconectar.";
      const abiertos = abiertosDeLaLista;
      if (abiertos.length === 0) return null;
      const { desdeMin, hastaMin } = minutosDe(a);
      const dentro = abiertos.some(
        (r) => minOf(r.startTime) <= desdeMin && hastaMin <= minOf(r.endTime),
      );
      return dentro ? null : "Fuera del horario de ese día";
    },
    [abiertosDeLaLista, minutosDe],
  );

  const { ahora: idAhora, despues: idDespues } = useMemo(
    () => ahoraYDespues(tramosDeLaLista, isToday ? nowMin : null),
    [tramosDeLaLista, isToday, nowMin],
  );

  /** El rótulo de la cabecera: el día, o el rango de la semana. */
  const diasDeLaSemana = sieteDias(lunes);
  const rotulo =
    vista === "semana"
      ? rotuloDeLaSemana([diasDeLaSemana[0]!, diasDeLaSemana[6]!])
      : new Intl.DateTimeFormat("es-ES", {
          weekday: "long",
          day: "numeric",
          month: "short",
          timeZone: AGENDA_TZ,
        }).format(new Date(`${date}T12:00:00.000Z`));
  const enElPresente =
    vista === "semana"
      ? lunes === lunesDeLaSemana(todayLocalDate())
      : isToday;

  /** Las columnas de la semana, con lo que cada día necesita. */
  const columnasDeLaSemana: DiaDeLaSemana[] = useMemo(() => {
    if (!semana) return [];
    const quien = unaSola?.userId ?? null;
    return diasDeLaSemana.map((f) => {
      const info = (semana.days ?? []).find((d) => d.date === f);
      const citas = semana.appointments.filter((a) => {
        if (a.status === "CANCELLED") return false;
        if (centerWallDate(a.start) !== f) return false;
        if (!quien) return true;
        // Con el filtro en una profesional la semana es LA SUYA. Sin
        // filtro se ven las de todas: en una peluquería de tres, «¿hay
        // hueco el jueves?» es del centro, no de una persona.
        return (
          a.assignments.some(
            (x) => x.reservableType === "STAFF" && x.staffUserId === quien,
          ) ||
          a.assignments.every((x) => x.reservableType !== "STAFF")
        );
      });
      return {
        fecha: f,
        abiertos: quien
          ? (info?.staffOpen?.[quien] ?? info?.open ?? null)
          : (info?.open ?? null),
        cerrado: info?.closed ?? null,
        ausencias: (info?.absences ?? []).filter(
          (ab) => !quien || ab.staffUserId === quien || ab.staffUserId === null,
        ),
        citas,
      };
    });
  }, [semana, diasDeLaSemana, unaSola]);

  return (
    <div className="fixed inset-0 z-40 bg-mipiace-stone flex flex-col font-sans">
      {/* ── agenda-1 · LA CABECERA ÚNICA ─────────────────────────────

          Tablero 1 del diseño: volver · ‹ fecha · Hoy › · Día | Semana ·
          «Dar cita». Y se van tres controles que hacían lo mismo:

            · el campo `type="date"` de navegar por días. Lo pidió Matías
              el 27-10 («fuera el campo de fecha»). El `type="date"` NO
              desaparece del bloque: sigue siendo el control bueno para
              pedir una fecha de CITA y vive dentro de «¿Cuándo?» →
              «Otra fecha» (ver `AgendaPage.darCita.tsx`). Lo que se va es
              el de NAVEGAR, que es otra cosa.
            · la tira de SIETE chips de día. Su trabajo —ver y comparar
              varios días— lo hace ahora la vista de Semana, que además
              enseña lo que hay dentro de cada uno.
            · el selector «Todos» cuando sólo hay UNA profesional: una
              lista de un elemento no filtra nada.

          Y las flechas dejan de ser `hidden sm:flex`: eran redundantes
          con la tira, y sin la tira son el único modo de moverse un día.
          Con ellas y la vuelta a «Hoy» siempre a mano, un jueves de
          dentro de tres semanas se alcanza por Semana › › ›, que es el
          camino que el diseño quiere. */}
      {/* ── clinica-11 · LA BARRA A 390 PX ──────────────────────────

          Lo que pin-1 dejó medido y sin arreglar: a 390 px esta barra
          mide 547 (599 con «Cambiar mi PIN») dentro de 390, así que se
          salían por la derecha DOS cosas y no una. «Dar cita» era la que
          se veía; detrás de ella se iba también el conmutador
          Día | Semana, que es el único modo de llegar a la vista de
          semana. Medido otra vez el 29-10 en el banco visual, con el
          navegador y no a ojo:

            agenda            390 → contenido 547  (Vista fuera, Dar cita fuera)
            agenda-sanitaria  390 → contenido 599  (ídem, 52 px peores)

          **Por qué envuelve y no se encoge.** Hacerlo caber en una fila
          pedía recortar 157 px de cinco controles a la vez: el rótulo de
          la fecha a «jue 29», el conmutador a dos iconos y los botones a
          36 px. Tres cosas ilegibles para que quepa una. Lo que se hace
          es dejar que la fila SEGUNDA exista por debajo de `md`: la barra
          pasa a `flex-wrap`, el rótulo de la fecha se queda entero y lo
          que no cabe —el conmutador y «Dar cita»— baja a su propia línea,
          donde sobran píxeles.

          **Y a 1280×800 no cambia nada**, que es la condición del bloque:
          `md:flex-nowrap` devuelve la fila única, `md:h-[72px]` la altura
          exacta y el separador elástico vuelve a ser el que empuja «Dar
          cita» a la derecha. La Lenovo del mostrador de Rosario ve la
          misma barra que ayer, píxel a píxel.

          **Un solo DOM.** Nada se pinta dos veces con un `hidden` encima:
          eso dejaría dos botones con `data-test="dar-cita"` y el primero
          que encontrase el banco sería el invisible. Lo único que cambia
          entre los dos tamaños es cómo se colocan los MISMOS nodos. */}
      <div className="flex flex-wrap md:flex-nowrap items-center gap-x-2 gap-y-2 md:gap-4 px-3 md:px-6 py-2 md:py-0 min-h-16 md:min-h-0 md:h-[72px] bg-white border-b border-slate-200 shrink-0">
        <button
          onClick={onClose}
          className="h-11 w-11 shrink-0 rounded-2xl bg-mipiace-stone hover:bg-slate-200 flex items-center justify-center text-mipiace-ink"
          aria-label="Volver"
        >
          <ArrowLeft className="w-5 h-5" strokeWidth={2.25} />
        </button>

        {/* ── pin-1 · «CAMBIAR MI PIN», PEGADO A «VOLVER» ─────────────

            Sólo se pinta para el sanitario sin caja (ver `onCambiarMiPin`
            en los props): es el único que no tiene cajón de venta ni
            panel al que entrar, así que esta pantalla es su único sitio.

            **Va a la IZQUIERDA y no al final de la barra**, y es una
            medida y no un gusto. A 390 px esta barra mide 567 y «Dar
            cita» ya se sale por la derecha sin este botón (medido en el
            banco visual el 28-10, con dos profesionales). Un botón más
            al final sería el primero en caerse — y el de la sanitaria es
            justo el que no puede caerse, porque no tiene otro. Pegado a
            «Volver» está a 100 px del borde izquierdo y no depende de lo
            que haga el resto de la barra.

            Y es donde le toca por significado: «Volver» es su salida de
            la sesión y esto es su credencial. Las dos son de ella; lo de
            en medio es de la agenda.

            `aria-label` y no `title` — en la agenda los tooltips están
            prohibidos (ux-principles §6) y hay un banco que lo vigila. */}
        {onCambiarMiPin && (
          <button
            data-test="cambiar-mi-pin"
            onClick={onCambiarMiPin}
            className="h-11 w-11 shrink-0 rounded-2xl bg-mipiace-stone hover:bg-slate-200 flex items-center justify-center text-slate-600"
            aria-label="Cambiar mi PIN"
          >
            <KeyRound className="w-5 h-5" strokeWidth={2.1} />
          </button>
        )}

        {/* agenda-1 · EL TÍTULO SE VA DE LA VISTA, NO DEL DOCUMENTO.
            El tablero 1 no lleva «Agenda» escrito: el rótulo de la fecha y
            el conmutador Día|Semana ya dicen dónde estás, y esos 66 px son
            los que necesitan la fecha y «Dar cita» a 390 px (es la lección
            de B-5 F8: esta barra no tiene píxeles de sobra).
            Pero sigue siendo el `<h1>` de la pantalla: para un lector de
            pantalla «esto es la agenda» no es decoración, y es además
            cómo el banco distingue esta pantalla de la venta. */}
        <h1 className="sr-only">Agenda</h1>

        <div className="flex items-center gap-1 shrink-0 bg-mipiace-stone rounded-2xl p-1">
          <button
            data-test="anterior"
            onClick={() => setDate(addDays(date, vista === "semana" ? -7 : -1))}
            className="h-11 w-11 rounded-xl hover:bg-white flex items-center justify-center text-[20px] leading-none text-mipiace-ink"
            aria-label={vista === "semana" ? "Semana anterior" : "Día anterior"}
          >
            <ChevronLeft className="w-5 h-5" strokeWidth={2.25} />
          </button>
          <div
            data-test="rotulo-fecha"
            className="min-w-[116px] md:min-w-[210px] text-center px-1 text-[15px] md:text-[17px] font-semibold text-mipiace-ink capitalize"
          >
            {rotulo}
            {enElPresente && (
              <span className="text-mipiace-coral-dark">
                {vista === "semana" ? " · Esta semana" : " · Hoy"}
              </span>
            )}
          </div>
          <button
            data-test="siguiente"
            onClick={() => setDate(addDays(date, vista === "semana" ? 7 : 1))}
            className="h-11 w-11 rounded-xl hover:bg-white flex items-center justify-center text-[20px] leading-none text-mipiace-ink"
            aria-label={
              vista === "semana" ? "Semana siguiente" : "Día siguiente"
            }
          >
            <ChevronRight className="w-5 h-5" strokeWidth={2.25} />
          </button>
          {/* La vuelta a HOY. Era el primer chip de la tira de días, que
              ya no está; aquí sólo aparece cuando hace falta, así que en
              el caso de siempre no le quita píxeles a nadie. */}
          {!enElPresente && (
            <button
              data-test="volver-a-hoy"
              onClick={() => setDate(todayLocalDate())}
              className="h-11 px-3.5 shrink-0 rounded-xl bg-white border border-slate-200 text-[13.5px] font-semibold text-mipiace-coral-dark"
            >
              Hoy
            </button>
          )}
        </div>

        <div
          role="group"
          aria-label="Vista"
          className="flex shrink-0 bg-mipiace-stone rounded-2xl p-1"
        >
          {(["dia", "semana"] as const).map((v) => (
            <button
              key={v}
              data-test={`vista-${v}`}
              aria-pressed={vista === v}
              onClick={() => setVista(v)}
              className={`h-11 px-4 md:px-5 rounded-xl text-[14.5px] font-semibold ${
                vista === v
                  ? "bg-mipiace-ink text-white"
                  : "text-slate-600 font-medium"
              }`}
            >
              {v === "dia" ? "Día" : "Semana"}
            </button>
          ))}
        </div>

        {/* El separador elástico SÓLO existe en una fila. Envolviendo,
            un `flex-1` en la primera fila la estira y manda el
            conmutador a la segunda incluso cuando cabría. Lo que empuja
            «Dar cita» a la derecha por debajo de `md` es su `ml-auto`. */}
        <div className="hidden md:block md:flex-1" />

        <button
          data-test="dar-cita"
          onClick={abrirDarCita}
          // n1-vertical · por debajo de `sm` el rótulo está `hidden`, así
          // que el botón se queda sin nombre accesible. `aria-label` y no
          // `title`: en la agenda los tooltips están prohibidos
          // (ux-principles §6) y hay un banco que lo vigila.
          aria-label="Dar cita"
          className="h-touch-lg px-4 md:px-7 shrink-0 ml-auto md:ml-0 rounded-2xl bg-mipiace-coral hover:bg-mipiace-coral-dark text-white text-[15px] md:text-[17px] font-semibold flex items-center gap-2"
        >
          <Plus className="w-5 h-5" strokeWidth={2.4} />
          <span className="hidden sm:inline">Dar cita</span>
        </button>

        {/* agenda-1 · EL ⋯ DE LAS AUSENCIAS, con una sola profesional.
            En la rejilla vive en la cabecera de cada columna, que es donde
            Sole escribe «Ana libre» en su Excel. La lista no tiene
            cabecera de columna, y quitarle a Rosario la forma de decir que
            un día no está sería una función menos por un cambio de
            layout. Así que sube aquí — un botón de 44 px a la derecha de
            «Dar cita», y sólo cuando la columna es una. */}
        {unaSola && unaSola.userId !== "__unassigned__" && (
          <button
            data-ausencia-menu={unaSola.userId}
            onClick={() => setAbsenceFor(unaSola)}
            className="h-11 w-11 shrink-0 rounded-2xl bg-mipiace-stone hover:bg-slate-200 flex items-center justify-center text-slate-600"
            aria-label={`Opciones de ${unaSola.displayName}`}
          >
            <MoreVertical className="w-5 h-5" />
          </button>
        )}
      </div>

      {/* B-reservas-6a frente O · un alta que el servidor rechazó no puede
          quedarse sólo en el chip de abajo a la derecha: la cajera está
          mirando la agenda, y esa cita la escribió ella. El aviso NO es un
          toast — no se va solo — y trae la acción que se quiere: reintentar.
          Descartar sigue en el chip, que ya pide confirmación. */}
      {rechazadas.length > 0 && (
        <div className="shrink-0 px-3 md:px-6 py-2 bg-red-50 border-b border-red-200 flex items-center gap-3 flex-wrap">
          <span className="text-[13px] text-red-800">
            {rechazadas.length === 1
              ? `La cita de las ${localHHMM(rechazadas[0]!.start)} no se pudo guardar`
              : `${rechazadas.length} citas no se pudieron guardar`}
            {rechazadas.length === 1 && rechazadas[0]!.outboxError
              ? `: ${rechazadas[0]!.outboxError}`
              : "."}
          </span>
          <button
            onClick={() => {
              for (const a of rechazadas) void outboxRetry(a.id);
            }}
            className="h-9 shrink-0 px-3 rounded-xl bg-white border border-red-200 hover:bg-red-100 text-[12.5px] font-medium text-red-700"
          >
            Reintentar
          </button>
        </div>
      )}

      {/* ── agenda-1 · LA FILA DE LO SECUNDARIO ──────────────────────
          Lo que no es la acción principal pero tiene que verse: el aviso
          de que el día salió de la caché, los cobros pendientes, la salud
          de la agenda y —sólo con VARIAS profesionales— el filtro. La
          cabecera no tiene píxeles para esto a 390 px (es el fallo que
          B-5 F8 arregló: lo que se cortaba era la acción principal), y
          aquí no le quita nada a nadie.
          La fila entera desaparece cuando no tiene nada dentro. */}
      {(offline ||
        (puedeCobrar && (day?.sesionesPorCobrar ?? []).length > 0) ||
        matrizEditable === true ||
        activeStaff.length > 1) && (
        <div className="flex items-center gap-2 px-3 md:px-6 py-2 bg-white border-b border-slate-100 shrink-0 flex-wrap">
          {offline && (
            <span className="text-[12px] rounded-lg bg-amber-100 text-amber-800 px-2.5 py-1">
              Sin conexión · caché
            </span>
          )}
          {/* El filtro por profesional sólo con MÁS DE UNA: un selector
              «Todos / Rosario» en la clínica de Rosario no filtra nada
              (prompt del bloque: «fuera el selector Todos con una
              profesional»). */}
          {activeStaff.length > 1 && (
            <select
              value={staffFilter ?? ""}
              onChange={(e) => setStaffFilter(e.target.value || null)}
              aria-label="Profesional"
              className="h-11 px-2.5 shrink-0 rounded-2xl bg-mipiace-stone border border-slate-200 text-[13.5px]"
            >
              <option value="">Todas</option>
              {activeStaff.map((s) => (
                <option key={s.userId} value={s.userId}>
                  {s.displayName}
                </option>
              ))}
            </select>
          )}
          <div className="flex-1" />
          {/* clinica-3 · POR COBRAR. Sólo si hay algo y sólo para quien
              cobra: a un sanitario sin caja la ruta le contesta 403. */}
          {puedeCobrar && (day?.sesionesPorCobrar ?? []).length > 0 && (
            <button
              onClick={() => setVerCobros(true)}
              className="h-11 px-3 shrink-0 rounded-2xl text-[13px] font-medium flex items-center gap-1.5 bg-mipiace-coral-soft text-mipiace-coral-dark"
              aria-label="Sesiones por cobrar"
            >
              <Wallet className="w-[18px] h-[18px]" strokeWidth={2.25} />
              <span
                data-test="badge-por-cobrar"
                className="tabular-nums font-semibold"
              >
                {(day?.sesionesPorCobrar ?? []).length}
              </span>
            </button>
          )}
          {/* clinica-8 (fase B, 17) · el estetoscopio no se le abre a la
              clienta: se gatea con lo mismo que decide quién puede
              ARREGLAR lo que el panel enseña. */}
          {matrizEditable === true && (
            <button
              onClick={() => setSaludAbierta(true)}
              data-test="abrir-salud"
              className={`h-11 px-3 shrink-0 rounded-2xl text-[13px] font-medium flex items-center gap-1.5 ${
                sinNadie !== null && sinNadie > 0
                  ? "bg-mipiace-coral-soft text-mipiace-coral-dark"
                  : "bg-mipiace-stone text-slate-600 hover:bg-slate-200"
              }`}
              aria-label="Salud de la agenda"
            >
              <Stethoscope className="w-[18px] h-[18px]" strokeWidth={2.25} />
              {sinNadie !== null && sinNadie > 0 && (
                <span
                  data-test="badge-salud"
                  className="tabular-nums font-semibold"
                >
                  {sinNadie}
                </span>
              )}
            </button>
          )}
        </div>
      )}

      {/* ── agenda-1 · LOS PENDIENTES DE RECEPCIÓN, DONDE HAY SITIO ───

          clinica-9 (9) sacó la próxima cita propuesta a una banda a todo
          lo ancho sobre la agenda, y funcionó: la pasada del 27-10 la vio
          (paso 28). Pero es una banda que empuja la agenda hacia abajo y
          que, con dos avisos, se come dos filas de citas.

          En el tablero 1 su sitio es la tarjeta «Pendiente de recepción»
          de la columna izquierda, con el test de la tablet al lado — y
          ahí es donde vive ahora (ver `ColumnaDelDia`). La banda se queda
          SÓLO para los layouts que no tienen columna izquierda: la
          rejilla de varias profesionales (tablero 4) y la semana. Dos
          pinturas del mismo aviso es menos malo que un aviso que
          desaparece al cambiar de layout.

          La lista sale de `lib/agenda-recepcion.ts`, la misma para las
          dos superficies. */}
      {pendientes.length > 0 && (vista === "semana" || !unaSola) && (
        <div
          data-test="proximas-citas-propuestas"
          className="px-3 md:px-6 py-2 bg-mipiace-coral-soft/60 border-b border-mipiace-coral/20 space-y-1.5 shrink-0"
        >
          {pendientes.map((p) => (
            <div
              key={p.clave}
              className="flex items-center gap-3 flex-wrap text-[13px] text-mipiace-ink"
            >
              <span className="flex-1 min-w-0">
                <b className="font-semibold">
                  {clientLabel(p.clientId).nombre}
                </b>{" "}
                {p.texto}
              </span>
              <button
                data-test={`dar-proxima-cita-${p.appointmentId ?? p.clientId}`}
                data-pendiente={p.clave}
                onClick={() => atenderPendiente(p)}
                className="shrink-0 min-h-touch px-4 rounded-2xl bg-mipiace-coral text-white text-[13px] font-semibold"
              >
                {p.accion === "DAR_CITA" ? "Dársela ahora" : p.boton}
              </button>
            </div>
          ))}
        </div>
      )}

      {/* B-reservas-7a · el día CERRADO se dice arriba y con su nombre, no
          se deduce de una rejilla vacía. «Cerrado · Virgen del Prado» es lo
          que la cajera le lee a la clienta por teléfono. */}
      {cerrado && (
        <div
          data-dia-cerrado={cerrado.name ?? ""}
          className="shrink-0 px-3 md:px-6 py-2 bg-slate-800 text-white flex items-center gap-2 flex-wrap"
        >
          <span className="text-[13.5px] font-semibold">
            Cerrado{cerrado.name ? ` · ${cerrado.name}` : ""}
          </span>
          <span className="text-[12.5px] text-slate-300">
            Ese día el centro no abre y la agenda no ofrece nada.
          </span>
        </div>
      )}
      {/* Y el día especial que ABRE también se dice: un sábado de boda que
          empieza a las 8:30 no se explica solo. */}
      {!cerrado && dayInfo?.specialName && (
        <div
          data-dia-especial={dayInfo.specialName}
          className="shrink-0 px-3 md:px-6 py-2 bg-amber-50 border-b border-amber-200 flex items-center gap-2 flex-wrap"
        >
          <span className="text-[13px] font-semibold text-amber-900">
            {dayInfo.specialName}
          </span>
          <span className="text-[12.5px] text-amber-700">
            Horario especial:{" "}
            {(dayInfo.open ?? [])
              .map((r) => `${r.startTime}–${r.endTime}`)
              .join(" y ")}
          </span>
        </div>
      )}

      <div className="flex-1 flex overflow-hidden">
        {/* ── agenda-1 · LAS TRES SUPERFICIES ──────────────────────────
            Semana (tablero 2) · día de UNA profesional en lista (tablero
            1) · día de VARIAS en rejilla (tablero 4). La decisión D1 de
            Matías en una línea: `unaSola`. */}
        {vista === "semana" ? (
          <SemanaEnColumnas
            dias={columnasDeLaSemana}
            hoy={todayLocalDate()}
            elegido={date}
            cargando={cargandoSemana}
            error={errorSemana}
            clienteDe={(a) => clientLabel(a.clientId)}
            servicioDe={serviceNames}
            minutosDe={minutosDe}
            sueloDe={sueloDeLaFecha}
            cobradaDe={(a) => (day?.cobradoPorCita?.[a.id] ?? 0) > 0}
            onDia={(f) => {
              setDate(f);
              setVista("dia");
            }}
            // Tocar un hueco de la semana abre «Dar cita» con ese día y
            // esa hora puestos — y se cambia de día, para que al cerrar
            // el panel la recepción se quede donde la cita cayó.
            onHueco={(f, min) => {
              setDate(f);
              setVista("dia");
              setDetail(null);
              setBookError(null);
              setDraft((previo) =>
                previo
                  ? { ...previo, start: localToIso(f, min) }
                  : {
                      clientId: null,
                      clientName: null,
                      serviceIds: [],
                      staffUserId: null,
                      start: localToIso(f, min),
                    },
              );
            }}
            onCita={(a) => {
              setDate(centerWallDate(a.start));
              setVista("dia");
              abrirCita(a);
            }}
          />
        ) : loading ? (
          <div className="flex-1 flex items-center justify-center gap-2 text-[13px] text-slate-500">
            <Loader2 className="w-4 h-4 animate-spin" /> Cargando…
          </div>
        ) : columns.length === 0 ? (
          <div className="flex-1 p-8 text-center text-[14px] text-slate-500 max-w-md mx-auto">
            No hay profesionales con perfil de agenda activo. Actívalos en el
            panel de Personal (admin).
          </div>
        ) : unaSola ? (
          /* ── Tablero 1 · el día de UNA profesional ─────────────── */
          <div className="flex-1 min-w-0 flex flex-col-reverse md:flex-row gap-4 p-3 md:p-6 overflow-hidden">
            {/* `flex-col-reverse` en compacto: con el móvil en la mano lo
                que hay que tener delante son las citas, no el resumen.
                En la tablet apaisada —que es la Lenovo del mostrador— van
                lado a lado, con la columna a la izquierda como el
                diseño. */}
            {/* agenda-1 · CON «DAR CITA» ABIERTO, LA COLUMNA SE APARTA.
                El panel mide 520 px; a 1280 (la Lenovo apaisada) eso deja
                760 para repartir entre el resumen y la lista, y la lista
                se queda en 380 px con los nombres partidos y las filas
                pisándose. Lo que hay que leer mientras se da una cita es
                la LISTA —para saber qué hay alrededor de la hora que se
                está eligiendo—, no las tres cifras del día.
                Desde 1536 px (`2xl`) caben los tres y no se aparta nada.
                Y lo que se esconde no se pierde: los pendientes están
                dentro del panel (es de donde se abrió) y las cifras
                vuelven al cerrarlo. */}
            <div className={draft ? "hidden 2xl:contents" : "contents"}>
            <ColumnaDelDia
              ahora={apptsDeLaLista.find((a) => a.id === idAhora) ?? null}
              despues={apptsDeLaLista.find((a) => a.id === idDespues) ?? null}
              clienteDe={(a) => clientLabel(a.clientId)}
              servicioDe={serviceNames}
              minutosDe={minutosDe}
              estadoDe={estadoDe}
              // clinica-2/3 · la puerta a la sesión es del SANITARIO, y
              // «Abrir sesión» sólo tiene sentido el día de la cita. La
              // tarjeta de Ahora es de hoy por definición, así que basta
              // con la marca.
              onAbrirSesion={
                esSanitario && clinicaEncendida
                  ? (a) => {
                      if (a.clientId) setSesionDe(a.id);
                      else flash("Esa cita no tiene paciente.");
                    }
                  : undefined
              }
              rotuloDeSesion="Abrir sesión"
              pendientes={pendientes}
              nombreDeCliente={(id) => clientLabel(id).nombre}
              onPendiente={atenderPendiente}
              cifras={cifras}
              cobradoCents={cobradoDelDia}
              libreHasta={libreHastaLas(
                tramosDeLaLista,
                isToday ? nowMin : null,
              )}
            />
            </div>
            <DiaEnLista
              appts={apptsDeLaLista}
              abiertos={cerrado ? [] : abiertosDeLaLista}
              ausencias={absencesByStaff.get(unaSola.userId) ?? []}
              minutosDe={minutosDe}
              servicios={serviciosQueCaben}
              sueloMin={pastUntilMin}
              ahoraMin={isToday ? nowMin : null}
              clienteDe={(a) => clientLabel(a.clientId)}
              servicioDe={serviceNames}
              estadoDe={estadoDe}
              avisoDe={avisoDeLaCita}
              onCita={abrirCita}
              onHueco={(min) => openSlotFirst(unaSola.userId, min)}
              onAusencia={setAbsenceDetail}
            />
          </div>
        ) : (
          /* ── Tablero 4 · el día de VARIAS profesionales ─────────── */
          <div ref={scrollRef} className="flex-1 overflow-auto">
            {/* El carril se encoge al contenido y se desliza: esta rama es
                la de VARIAS profesionales, así que siempre hay más de una
                columna que repartir. (El `flex w-full` de una sola columna
                se fue con la lista del tablero 1.) */}
            {/* agenda-1 · EL CARRIL REPARTE EL ANCHO QUE TIENE.
                Con `min-w-max` y columnas de ancho fijo, tres
                profesionales dejaban 600 px en blanco a la derecha en la
                Lenovo apaisada — es el punto 29 de la auditoría del 18-10
                («columna estrecha, citas cortas difíciles de tocar»)
                repetido con tres columnas en vez de una.
                `w-full` + `flex-1` reparte; el `min-w` de cada columna es
                el suelo de siempre, así que con seis profesionales el
                carril vuelve a desbordar y se desliza, que es lo que
                tiene que hacer. */}
            <div className="flex w-full min-w-max">
              {/* Regla de horas.

                  B-reservas-6a · la regla MENTÍA, y el bucle visual de este
                  bloque la pilló. Dos fallos, los dos preexistentes (se ven
                  igual en las capturas de B-5):

                  1. no dejaba hueco para la cabecera de profesional, así que
                     iba 40 px por delante de las columnas;
                  2. cada fila llevaba `-mt-2` en flujo, y esos 8 px se
                     ACUMULABAN: la regla derivaba 8 px por hora. A las 20:00
                     eran 96 px — hora y media de desfase.

                  Ahora las etiquetas van absolutas sobre la misma geometría
                  que las líneas de la columna, centradas en su hora. Con el
                  suelo pintado esto deja de ser un detalle: si la regla no
                  cuadra, no se sabe a qué hora acaba lo que ya pasó. */}
              <div className="w-14 shrink-0 sticky left-0 z-10 bg-mipiace-stone">
                {/* B-reservas-6a · este espaciador MIDE LO QUE MIDE la
                    cabecera de la columna. Si no, la regla va por delante
                    de las citas — es el fallo 1 de los dos que ese bloque
                    arregló. Con la línea de «qué hace» la cabecera pasa a
                    h-14, y esto con ella. */}
                <div className={isToday ? "h-14 shrink-0" : "h-10 shrink-0"} />
                <div
                  className="relative"
                  style={{ height: (dayEndMin - dayStartMin) * pxPorMin }}
                >
                  {hourRows(dayStartMin, dayEndMin).map((h) => (
                    <div
                      key={h}
                      data-hora={`${String(h).padStart(2, "0")}:00`}
                      style={{ top: (h * 60 - dayStartMin) * pxPorMin }}
                      className="absolute right-0 pr-2 -translate-y-1/2 text-[11px] text-slate-400 tabular-nums"
                    >
                      {String(h).padStart(2, "0")}:00
                    </div>
                  ))}
                </div>
              </div>
              {/* Columnas por profesional */}
              {columns.map((s) => (
                <StaffColumn
                  key={s.userId}
                  staff={s}
                  unica={columns.length === 1}
                  appts={apptsByStaff.get(s.userId) ?? []}
                  nowMin={isToday ? nowMin : null}
                  pastUntilMin={pastUntilMin}
                  dayStartMin={dayStartMin}
                  dayEndMin={dayEndMin}
                  slotMin={slotMin}
                  pxPorMin={pxPorMin}
                  queHace={queHaceAhora(s.userId)}
                  // El día cerrado apaga la columna entera: `open: []`.
                  open={cerrado ? [] : (dayInfo?.staffOpen?.[s.userId] ?? null)}
                  absences={absencesByStaff.get(s.userId) ?? []}
                  onAbsence={setAbsenceDetail}
                  onMenu={() => setAbsenceFor(s)}
                  onSlot={(min) => openSlotFirst(s.userId, min)}
                  onAppt={abrirCita}
                  labelOf={serviceNames}
                  clientOf={(a) => clientLabel(a.clientId)}
                />
              ))}
              {(apptsByStaff.get("__unassigned__")?.length ?? 0) > 0 && (
                <StaffColumn
                  staff={{
                    userId: "__unassigned__",
                    displayName: "Sin asignar",
                    color: "#94a3b8",
                    active: true,
                  }}
                  appts={apptsByStaff.get("__unassigned__") ?? []}
                  nowMin={isToday ? nowMin : null}
                  pastUntilMin={pastUntilMin}
                  dayStartMin={dayStartMin}
                  dayEndMin={dayEndMin}
                  slotMin={slotMin}
                  pxPorMin={pxPorMin}
                  open={cerrado ? [] : (dayInfo?.open ?? null)}
                  absences={(dayInfo?.absences ?? []).filter(
                    (a) => a.staffUserId === null,
                  )}
                  onAbsence={setAbsenceDetail}
                  onSlot={(min) => openSlotFirst(null, min)}
                  onAppt={abrirCita}
                  labelOf={serviceNames}
                  clientOf={(a) => clientLabel(a.clientId)}
                />
              )}
            </div>
          </div>
        )}

        {/* agenda-1 · «DAR CITA» — AL LADO, sin scrim (no tapa la
            agenda, que es lo que la recepción está mirando). En compacto
            ocupa toda la anchura, como hoja. */}
        {draft && (
          <PanelDarCita
            draft={draft}
            setDraft={setDraft}
            services={services}
            staff={activeStaff}
            date={date}
            isPastDay={isPastDay}
            staffName={
              activeStaff.find((s) => s.userId === draft.staffUserId)
                ?.displayName ?? null
            }
            skillsPorStaff={skillsPorStaff}
            matrizEditable={matrizEditable === true}
            onAbrirMatriz={() => setMatriz({ focusServiceId: null })}
            bookError={bookError}
            onPickAlternative={(start) => {
              setDraft({ ...draft, start });
              setBookError(null);
            }}
            // B-reservas-mostrador F5 · el cliente que se acaba de elegir o
            // de crear entra en el mapa AQUÍ MISMO. Esperar a la siguiente
            // carga del día dejaría la tarjeta recién creada diciendo «Sin
            // nombre» delante de la clienta cuyo nombre se acaba de teclear.
            onClientPicked={(c) =>
              setClientsById((prev) => new Map(prev).set(c.id, c))
            }
            onCancel={() => {
              setDraft(null);
              setBookError(null);
            }}
            onReserve={() => doCreate(false)}
            onReserveAndCharge={() => doCreate(true)}
            bonoEtiqueta={bonoEtiqueta}
          />
        )}
        {/* Detalle de cita */}
        {detail && (
          <DetailPanel
            appt={detail}
            client={clientLabel(detail.clientId)}
            serviceLabel={serviceNames(detail)}
            staffName={
              staffDeLaCita(detail) ? nombreDeStaff(staffDeLaCita(detail)!) : null
            }
            staff={activeStaff}
            skillsPorStaff={skillsPorStaff}
            sinRed={sinRed}
            moveError={moveError}
            onClose={() => {
              setDetail(null);
              setMoveError(null);
            }}
            // clinica-8 · las dos que LIBERAN EL HUECO y no se deshacen
            // preguntan antes. Las otras tres (confirmar, en sala,
            // finalizar) siguen siendo un toque: se corrigen tocando otra.
            onStatus={(st) =>
              st === "CANCELLED" || st === "NO_SHOW"
                ? setConfirmarEstado({ id: detail.id, status: st })
                : void changeStatus(detail.id, st)
            }
            onCheckout={() => doCheckout(detail.id)}
            puedeCobrar={puedeCobrar}
            // clinica-6 · la historia viva del paciente, desde la cita.
            onAbrirHistoria={
              detail.clientId
                ? () =>
                    setHistoriaDe({
                      clientId: detail.clientId!,
                      appointmentId: detail.id,
                    })
                : undefined
            }
            // clinica-2 · el aviso discreto y, para el sanitario, la puerta
            // a la valoración.
            valoracionPendiente={
              detail.clientId != null &&
              (day?.valoracionesPendientes ?? []).includes(detail.clientId)
            }
            esSanitario={esSanitario}
            onAbrirValoracion={
              detail.clientId
                ? () => setValoracionDe(detail.clientId!)
                : undefined
            }
            // clinica-3 · la sesión cuelga de la CITA, no del paciente: de
            // una cita sale una sola sesión.
            onAbrirSesion={
              detail.clientId ? () => setSesionDe(detail.id) : undefined
            }
            sesionPorCobrar={(day?.sesionesPorCobrar ?? []).includes(detail.id)}
            // clinica-9 (4) · ¿es HOY esta cita? La pasada del 24-10 abrió
            // la del lunes 26 desde la agenda del sábado y la sesión se
            // firmó con la fecha del sábado. El día sale de la MISMA
            // función que pinta la agenda (`centerWallDate`), que es la
            // zona de pared del centro.
            citaEsDeHoy={centerWallDate(detail.start) === centerToday()}
            // clinica-8 · en una clínica se entra por la agenda y el orden
            // de la cita cambia: primero la sesión, después el cobro.
            clinicaEncendida={clinicaEncendida}
            onMove={(start, staffUserId) =>
              void doMove(detail.id, start, staffUserId)
            }
            onClearMoveError={() => setMoveError(null)}
          />
        )}
      </div>

      {/* clinica-6 · LA HISTORIA VIVA del paciente. Overlay a pantalla
          completa, el mismo patrón que la valoración y la sesión: es una
          pantalla entera de iPad apaisado y lo que se está haciendo es
          leer una historia, no mirar la agenda de reojo. */}
      {historiaDe && (
        <AlFrente>
        <div className="fixed inset-0 z-[70] bg-mipiace-stone flex flex-col font-sans">
          <div className="flex items-center gap-3 px-4 md:px-6 h-16 bg-white border-b border-slate-200 shrink-0">
            <button
              onClick={() => setHistoriaDe(null)}
              className="h-11 w-11 rounded-2xl hover:bg-slate-100 flex items-center justify-center text-mipiace-ink"
              aria-label="Volver a la agenda"
            >
              <ArrowLeft className="w-5 h-5" strokeWidth={2.25} />
            </button>
            <h1 className="text-[18px] font-semibold text-mipiace-ink flex-1">
              Historia · {clientLabel(historiaDe.clientId).nombre}
            </h1>
          </div>
          <div className="flex-1 overflow-y-auto px-4 md:px-6 py-4">
            <div className="max-w-[1180px] mx-auto">
              <HistoriaViva
                clientId={historiaDe.clientId}
                // clinica-10 (H3) · el Atrás de Android cierra la
                // historia, lo mismo que la flecha de la cabecera. Sin
                // esto, `HistoriaViva` registra sus capas de dentro (la
                // hoja de «¿qué visita es hoy?», la zona del pie) y la
                // última se queda sin salida: el gesto cae en el guardia
                // de fondo, que con el turno abierto se lo traga para no
                // echar a nadie de la aplicación. Ver `useBackGuard`.
                onCerrar={() => setHistoriaDe(null)}
                // «Empezar esta revisión →» y «Nueva visita»: se sale de la
                // historia y se entra en la sesión DE ESTA CITA con el tipo
                // ya marcado. Lo único que este bloque le pasa a clinica-5.
                onEmpezarVisita={(tipos) => {
                  const cita = historiaDe.appointmentId;
                  setHistoriaDe(null);
                  setTiposIniciales(tipos);
                  setSesionDe(cita);
                }}
                onAbrirValoracion={() => {
                  const quien = historiaDe.clientId;
                  setHistoriaDe(null);
                  setValoracionDe(quien);
                }}
              />
            </div>
          </div>
        </div>
        </AlFrente>
      )}

      {/* clinica-2 · la valoración del paciente de la cita. Overlay a
          pantalla completa, como el resto de las hojas de esta pantalla:
          lo que la podóloga está haciendo es revisar una historia, no
          mirar un detalle de agenda de reojo. */}
      {valoracionDe && (
        <AlFrente>
        <div className="fixed inset-0 z-[70] bg-mipiace-stone flex flex-col font-sans">
          <div className="flex items-center gap-3 px-4 md:px-6 h-16 bg-white border-b border-slate-200 shrink-0">
            <button
              onClick={() => {
                setValoracionDe(null);
                // Y SE RECARGA EL DÍA. El aviso «Valoración pendiente» sale
                // de la respuesta de `/agenda`, que se pidió antes de entrar
                // aquí: sin esto, la podóloga valida, vuelve, y la agenda le
                // sigue diciendo que queda algo pendiente. Lo encontró el
                // banco en la última línea del capítulo 11.
                void loadDay(date);
              }}
              className="h-11 w-11 rounded-2xl hover:bg-slate-100 flex items-center justify-center text-mipiace-ink"
              // «Volver a la agenda» y no «Volver» a secas: debajo hay otra
              // pantalla con su propio «Volver», y dos botones con el mismo
              // nombre accesible son dos botones que un lector de pantalla
              // —y el banco— no pueden distinguir.
              aria-label="Volver a la agenda"
            >
              <ArrowLeft className="w-5 h-5" strokeWidth={2.25} />
            </button>
            <h1 className="text-[18px] font-semibold text-mipiace-ink flex-1">
              Valoración inicial · {clientLabel(valoracionDe).nombre}
            </h1>
          </div>
          <div className="flex-1 overflow-y-auto px-4 md:px-6 py-4">
            <div className="max-w-[760px] mx-auto">
              <ValoracionSanitario
                clientId={valoracionDe}
                puedeLeer={esSanitario}
              />
            </div>
          </div>
        </div>
        </AlFrente>
      )}

      {/* clinica-3 · LA SESIÓN de la cita. Overlay a pantalla completa,
          igual que la valoración: el mockup es una pantalla entera de iPad
          apaisado y meterla en el panel de 320 px del detalle sería meter
          el mapa de los dos pies en una columna. */}
      {sesionDe && (
        <AlFrente>
        <div className="fixed inset-0 z-[70] bg-mipiace-stone flex flex-col font-sans">
          <div className="flex items-center gap-3 px-4 md:px-6 h-16 bg-white border-b border-slate-200 shrink-0">
            <button
              onClick={() => {
                setSesionDe(null);
                setTiposIniciales(null);
                // Y SE RECARGA EL DÍA, por lo mismo que la valoración: el
                // aviso «Sesión cerrada · queda cobrarla» sale de la
                // respuesta de `/agenda`, pedida antes de entrar aquí.
                void loadDay(date);
              }}
              className="h-11 w-11 rounded-2xl hover:bg-slate-100 flex items-center justify-center text-mipiace-ink"
              aria-label="Volver a la agenda"
            >
              <ArrowLeft className="w-5 h-5" strokeWidth={2.25} />
            </button>
            <h1 className="text-[18px] font-semibold text-mipiace-ink flex-1">
              Sesión
            </h1>
          </div>
          <div className="flex-1 overflow-y-auto px-4 md:px-6 py-4">
            <div className="max-w-[1180px] mx-auto">
              <SesionPodologia
                appointmentId={sesionDe}
                // clinica-6 · los tipos con los que se abre cuando se
                // viene de «Hoy toca» o de «Nueva visita». `null` = los de
                // los servicios de la cita, como siempre.
                tiposIniciales={tiposIniciales ?? undefined}
                // «Cobrar ahora» de la pantalla de sesión cerrada hace
                // EXACTAMENTE lo que «Cobrar en caja» de la agenda: llama
                // al endpoint que ya existía. Es el mismo botón con otro
                // nombre, no un segundo camino de cobro.
                onCobrar={
                  puedeCobrar
                    ? (id) => {
                        setSesionDe(null);
                        setTiposIniciales(null);
                        void doCheckout(id);
                      }
                    : undefined
                }
                // «El camino para hacerlo» de la puerta de la valoración
                // (prompt §2): se sale de la sesión y se entra en la
                // valoración del mismo paciente.
                onAbrirValoracion={(clientId) => {
                  setSesionDe(null);
                  setValoracionDe(clientId);
                }}
              />
            </div>
          </div>
        </div>
        </AlFrente>
      )}

      {/* clinica-3 · LOS COBROS PENDIENTES de la recepción. Hoja lateral y
          no pantalla completa: se consulta de paso, con el paciente
          delante en el mostrador. */}
      {verCobros && (
        <AlFrente>
        <CobrosPendientes
          fecha={date}
          onCerrar={() => setVerCobros(false)}
          onCobrar={(id) => {
            setVerCobros(false);
            void doCheckout(id);
          }}
          puedeCobrar={puedeCobrar}
        />
        </AlFrente>
      )}

      {/* B-reservas-7a · el alta de una ausencia, en TRES TOQUES como
          máximo: el ⋯ de la columna, "No está en todo el día", y ya. */}
      {absenceFor && (
        <AbsenceSheet
          staff={absenceFor}
          // El rango por defecto arranca donde abre su columna, para que
          // "de tal a tal hora" no obligue a tocar los dos selectores.
          openRanges={dayInfo?.staffOpen?.[absenceFor.userId] ?? null}
          slotMin={slotMin}
          onCancel={() => setAbsenceFor(null)}
          onSave={(from, to, reason) =>
            void ponerAusencia(absenceFor, from, to, reason)
          }
        />
      )}
      {/* Y se quita desde la propia ausencia pintada. */}
      {absenceDetail && (
        <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/30 p-3">
          <div className="w-full md:w-80 bg-white rounded-2xl p-4 shadow-xl">
            <h2 className="text-[15px] font-semibold text-mipiace-ink mb-1">
              {absenceDetail.reason ?? "No está"}
            </h2>
            <p className="text-[13px] text-slate-500 mb-4">
              {absenceDetail.startTime === "00:00" &&
              absenceDetail.endTime === "24:00"
                ? "Todo el día"
                : `De ${absenceDetail.startTime} a ${absenceDetail.endTime}`}
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setAbsenceDetail(null)}
                className="flex-1 h-11 rounded-2xl bg-mipiace-stone text-[14px] font-medium"
              >
                Cerrar
              </button>
              <button
                onClick={() => void quitarAusencia(absenceDetail)}
                className="flex-1 h-11 rounded-2xl bg-mipiace-coral hover:bg-mipiace-coral-dark text-white text-[14px] font-medium"
              >
                Quitar
              </button>
            </div>
          </div>
        </div>
      )}
      {/* clinica-8 · la sesión cerrada no dejó nada que cobrar. Se dice, y
          se deja añadirlo: el borrador está abierto y vacío. */}
      {sesionSinCobro && (
        <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/30 p-3">
          <div
            role="dialog"
            aria-modal="true"
            aria-label="La sesión no tiene nada que cobrar"
            data-test="sesion-sin-cobro"
            className="w-full md:w-96 bg-white rounded-2xl p-4 shadow-xl"
          >
            <h2 className="text-[15px] font-semibold text-mipiace-ink mb-1">
              La sesión no tiene nada que cobrar
            </h2>
            <p className="text-[13px] text-slate-600 mb-4">
              En la consulta no se marcó ningún servicio cobrable, así que el
              ticket sale vacío. Añade el servicio que se hizo.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setSesionSinCobro(null)}
                className="flex-1 h-11 rounded-2xl bg-mipiace-stone text-[14px] font-medium"
              >
                Ahora no
              </button>
              <button
                onClick={() => {
                  const ir = sesionSinCobro;
                  setSesionSinCobro(null);
                  entrarEnElBorrador(ir.appointmentId, ir.ticketId);
                }}
                className="flex-1 h-11 rounded-2xl bg-mipiace-coral hover:bg-mipiace-coral-dark text-white text-[14px] font-medium"
              >
                Añadir el servicio
              </button>
            </div>
          </div>
        </div>
      )}
      {/* clinica-8 · cancelar y no-show preguntan. Las dos liberan el hueco
          y ninguna se deshace. */}
      {confirmarEstado && (
        <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/30 p-3">
          <div
            role="dialog"
            aria-modal="true"
            aria-label={
              confirmarEstado.status === "CANCELLED"
                ? "Cancelar la cita"
                : "Marcar como no-show"
            }
            data-test="confirmar-estado"
            className="w-full md:w-96 bg-white rounded-2xl p-4 shadow-xl"
          >
            <h2 className="text-[15px] font-semibold text-mipiace-ink mb-1">
              {confirmarEstado.status === "CANCELLED"
                ? "¿Cancelar esta cita?"
                : "¿Marcar como no-show?"}
            </h2>
            <p className="text-[13px] text-slate-600 mb-4">
              {confirmarEstado.status === "CANCELLED"
                ? "Sale de la agenda y su hora vuelve a ofrecerse. No se puede deshacer: habría que darla otra vez."
                : "Su hora vuelve a ofrecerse. No se puede deshacer."}
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setConfirmarEstado(null)}
                className="flex-1 h-11 rounded-2xl bg-mipiace-stone text-[14px] font-medium"
              >
                No
              </button>
              <button
                onClick={() => {
                  const q = confirmarEstado;
                  setConfirmarEstado(null);
                  void changeStatus(q.id, q.status);
                }}
                className="flex-1 h-11 rounded-2xl bg-mipiace-coral hover:bg-mipiace-coral-dark text-white text-[14px] font-medium"
              >
                {confirmarEstado.status === "CANCELLED"
                  ? "Sí, cancelar"
                  : "Sí, no-show"}
              </button>
            </div>
          </div>
        </div>
      )}
      {toast && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-mipiace-ink text-white text-[13px] px-4 py-2 rounded-xl shadow-lg z-50">
          {toast}
        </div>
      )}

      {/* B-reservas-9 · el panel de salud y la matriz. Van encima de la
          agenda y se cierran a ella: el criterio del bloque es que el fallo
          se arregle SIN salir de la agenda. */}
      {saludAbierta && (
        <AgendaHealthPanel
          onClose={() => setSaludAbierta(false)}
          onOpenMatrix={(focusServiceId) => setMatriz({ focusServiceId })}
        />
      )}
      {matriz && (
        <AgendaSkillMatrix
          focusServiceId={matriz.focusServiceId}
          onClose={() => {
            setMatriz(null);
            // Al volver de arreglar la matriz se relee la salud: si ya no
            // hay servicios huérfanos, el aviso se va solo.
            //
            // agenda-lista · y ahora esto refresca TAMBIÉN el panel de
            // salud, que sigue montado debajo. Antes sólo movía el badge
            // y el panel seguía diciendo 2 hasta pulsar «Actualizar».
            void fetchAgendaHealth().catch(() => undefined);
            // Y la matriz que se acaba de tocar: si la dueña le acaba de
            // enseñar a Lucía a hacer mechas, el alta tiene que ofrecerlas
            // sin salir y volver a entrar.
            void cargarMatriz();
          }}
        />
      )}
    </div>
  );
}

// agenda-lista · quién atiende una cita. La asignación de personal es la
// que importa aquí; una cita puede llevar además recursos (una cabina) y
// ésos no se nombran en el aviso de que se ha movido.
function staffDeLaCita(appt: AgendaAppointment | null): string | null {
  return (
    appt?.assignments.find((a) => a.reservableType === "STAFF")?.staffUserId ??
    null
  );
}

// B-reservas-7a · la regla ya no es de 8 a 21: sale de la franja visible
// del día, que sale del horario del centro.
function hourRows(startMin: number, endMin: number): number[] {
  const out: number[] = [];
  for (let h = Math.ceil(startMin / 60); h < endMin / 60; h++) out.push(h);
  return out;
}

// ── B-reservas-7a · poner una ausencia, en tres toques ─────────────────
//
// Donde Sole las escribe hoy: en la columna de la persona, no en un ajuste
// del admin. «Ana libre» el miércoles entero; «ISA NO» de 9:00 a 10:30.
//
// El camino mínimo son TRES toques: el ⋯ de la cabecera (1), "No está en
// todo el día" (2) — y ese ya guarda. El de rango son tres también si los
// valores por defecto sirven: ⋯ (1), "No está a ratos" (2), "Guardar" (3).
//
// Por debajo es un `BookingBlock scope=STAFF` por la API que ya existe, y
// que ya podían llamar el cajero y el owner. No hay entidad nueva.

function AbsenceSheet(props: {
  staff: AgendaStaff;
  openRanges: OpenRange[] | null;
  slotMin: number;
  onCancel: () => void;
  onSave: (startTime: string, endTime: string, reason: string) => void;
}) {
  const { staff, openRanges, slotMin } = props;
  // El rango por defecto: desde donde abre su columna, una hora. Si no hay
  // horario configurado, las 09:00 — la hora a la que abre casi todo.
  const baseStart = openRanges?.[0] ? minOf(openRanges[0]!.startTime) : 9 * 60;
  const baseEnd = Math.min(baseStart + 60, 24 * 60);
  const [modo, setModo] = useState<"menu" | "rango">("menu");
  const [from, setFrom] = useState(hhmm(baseStart));
  const [to, setTo] = useState(hhmm(baseEnd));
  const [reason, setReason] = useState("");

  // Las horas que se pueden elegir, en la RETÍCULA del centro: ofrecer las
  // 10:15 con la retícula a 30 sería ofrecer una hora que no existe.
  const horas: string[] = [];
  for (let m = 0; m <= 24 * 60; m += slotMin) horas.push(hhmm(m));

  const invalido = minOf(to) <= minOf(from);

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/30 p-3">
      <div className="w-full md:w-96 bg-white rounded-2xl p-4 shadow-xl">
        <div className="flex items-center gap-2 mb-3">
          <h2 className="text-[15px] font-semibold text-mipiace-ink flex-1">
            {staff.displayName}
          </h2>
          <button
            onClick={props.onCancel}
            className="h-9 w-9 rounded-xl hover:bg-slate-100 flex items-center justify-center"
            aria-label="Cerrar"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {modo === "menu" ? (
          <div className="flex flex-col gap-2">
            <button
              data-ausencia-dia-entero
              onClick={() =>
                props.onSave(ALL_DAY_START, ALL_DAY_END, reason)
              }
              className="h-12 rounded-2xl bg-mipiace-coral hover:bg-mipiace-coral-dark text-white text-[14px] font-medium"
            >
              No está en todo el día
            </button>
            <button
              data-ausencia-rango
              onClick={() => setModo("rango")}
              className="h-12 rounded-2xl bg-mipiace-stone hover:bg-slate-200 text-[14px] font-medium text-mipiace-ink"
            >
              No está a ratos
            </button>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={200}
              placeholder="Motivo (opcional)"
              aria-label="Motivo"
              className="h-11 px-3 rounded-2xl bg-mipiace-stone border border-slate-200 text-[14px]"
            />
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <select
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                aria-label="Desde"
                className="h-11 flex-1 px-2 rounded-2xl bg-mipiace-stone border border-slate-200 text-[14px] tabular-nums"
              >
                {horas.slice(0, -1).map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
              </select>
              <span className="text-[13px] text-slate-400">a</span>
              <select
                value={to}
                onChange={(e) => setTo(e.target.value)}
                aria-label="Hasta"
                className="h-11 flex-1 px-2 rounded-2xl bg-mipiace-stone border border-slate-200 text-[14px] tabular-nums"
              >
                {horas.slice(1).map((h) => (
                  <option key={h} value={h}>
                    {h === "24:00" ? "24:00 (fin del día)" : h}
                  </option>
                ))}
              </select>
            </div>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={200}
              placeholder="Motivo (opcional)"
              aria-label="Motivo"
              className="h-11 px-3 rounded-2xl bg-mipiace-stone border border-slate-200 text-[14px]"
            />
            {invalido && (
              <p className="text-[12.5px] text-red-600">
                La hora de fin tiene que ser posterior a la de inicio.
              </p>
            )}
            <button
              data-ausencia-guardar
              disabled={invalido}
              onClick={() => props.onSave(from, to, reason)}
              className="h-12 rounded-2xl bg-mipiace-coral hover:bg-mipiace-coral-dark disabled:bg-slate-300 text-white text-[14px] font-medium"
            >
              Guardar
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Columna de un profesional ──────────────────────────────────────────

function StaffColumn(props: {
  staff: AgendaStaff;
  /** clinica-8 (fase B, 17) · ¿es la única columna del día? */
  unica?: boolean;
  appts: AgendaAppointment[];
  nowMin: number | null;
  // B-reservas-6a · hasta qué minuto del día ya ha pasado (el suelo).
  // `null` = un día futuro, nada ha pasado.
  pastUntilMin: number | null;
  // B-reservas-7a · la franja visible y la retícula, que ya no son
  // constantes del módulo: salen del horario del centro de ESE día.
  dayStartMin: number;
  dayEndMin: number;
  slotMin: number;
  /** agenda-1 · la escala, derivada de la retícula (ver `pxPorMinuto`). */
  pxPorMin: number;
  // Los tramos reservables de esta columna (turno ∩ centro). `null` = este
  // centro no tiene horario configurado ⇒ no se apaga nada, que es como se
  // comportaba antes del bloque. `[]` = nada es reservable hoy.
  open: OpenRange[] | null;
  absences: AgendaAbsence[];
  onAbsence: (a: AgendaAbsence) => void;
  // El gesto que pone una ausencia. Ausente en la columna "Sin asignar",
  // que no es de nadie.
  onMenu?: () => void;
  onSlot: (minutes: number) => void;
  onAppt: (a: AgendaAppointment) => void;
  labelOf: (a: AgendaAppointment) => string;
  clientOf: (a: AgendaAppointment) => { nombre: string; desconocido: boolean };
  /**
   * agenda-1 · tablero 4 · qué está haciendo esta profesional ahora, o
   * hasta cuándo está libre. `null` = el día no es hoy, y entonces la
   * cabecera es sólo el nombre.
   *
   * Es la línea que convierte la rejilla de Sole en algo que se lee de
   * un vistazo: tres columnas de tarjetas no dicen quién está ocupada,
   * hay que buscar la franja de «ahora» con el dedo y cruzarla con cada
   * columna.
   */
  queHace?: { texto: string; ocupada: boolean } | null;
}) {
  const {
    staff,
    appts,
    nowMin,
    pastUntilMin,
    dayStartMin,
    dayEndMin,
    slotMin,
    pxPorMin,
    open,
    absences,
  } = props;
  const totalH = (dayEndMin - dayStartMin) * pxPorMin;
  // B-reservas-mostrador F2 · el color de ESTA columna, y el tinte con el que
  // se pintan sus citas. Se calculan una vez por columna, no por tarjeta.
  const colorStaff = colorDeCabecera(staff.userId, staff.color);
  const tinteStaff = tinteDeProfesional(staff.userId, staff.color);
  const pastH =
    pastUntilMin == null
      ? 0
      : Math.max(
          0,
          (Math.min(pastUntilMin, dayEndMin) - dayStartMin) * pxPorMin,
        );
  // B-reservas-7a · lo que NO es reservable de esta columna.
  const cerradas = closedBands(open, dayStartMin, dayEndMin);
  // Y las líneas de la retícula, que antes eran sólo las horas en punto.
  // Con 30 se ven las medias: la cajera tiene que poder contar las bandas
  // que va a tocar.
  const gridLines: number[] = [];
  for (
    let m = Math.ceil(dayStartMin / slotMin) * slotMin;
    m < dayEndMin;
    m += slotMin
  ) {
    gridLines.push(m);
  }
  // agenda-1 · los huecos de ESTA columna, con la misma aritmética que la
  // lista del tablero 1 (`lib/agenda-dia.ts`). Una sola cuenta para las
  // dos superficies: si la rejilla ofreciera un hueco que la lista no, una
  // de las dos estaría mintiendo y nadie sabría cuál.
  const huecosLibresDeLaColumna = filasDelDia({
    citas: appts
      .filter((a) => a.status !== "CANCELLED")
      .map((a) => {
        const desdeMin = localMinutes(a.start);
        const fin = localMinutes(a.end);
        return {
          id: a.id,
          desdeMin,
          hastaMin: fin <= desdeMin ? 24 * 60 : fin,
        };
      }),
    abiertos: (open ?? []).map((r) => ({
      desdeMin: minOf(r.startTime),
      hastaMin: minOf(r.endTime),
    })),
    ausencias: absences.map((ab) => ({
      desdeMin: minOf(ab.startTime),
      hastaMin: minOf(ab.endTime),
    })),
    sueloMin: pastUntilMin,
    // Lo que cabe no se dice en la rejilla: la columna mide 176 px.
    servicios: [],
    // Por debajo de una franja de la retícula no hay nada que ofrecer.
    minimoDeHuecoMin: slotMin,
  }).filter((f): f is FilaHueco => f.tipo === "hueco" && f.reservable);

  /** ¿Esta cita se sale del horario de la columna o pisa una ausencia?
   *  Pasa cuando el festivo o la ausencia se pusieron DESPUÉS. Se sigue
   *  viendo y se sigue pudiendo cobrar: sólo se marca. */
  function fueraDeHorario(a: AgendaAppointment): boolean {
    const s = localMinutes(a.start);
    const e0 = localMinutes(a.end);
    const e = e0 <= s ? 24 * 60 : e0;
    if (open != null) {
      const dentro = open.some(
        (r) => minOf(r.startTime) <= s && e <= minOf(r.endTime),
      );
      if (!dentro) return true;
    }
    return absences.some(
      (ab) => s < minOf(ab.endTime) && minOf(ab.startTime) < e,
    );
  }
  return (
    // clinica-8 (fase B, 17) · CON UNA SOLA PROFESIONAL, LA COLUMNA SE
    // QUEDA CON LA PANTALLA.
    //
    // Auditoría del 18-10, punto 29: «Agenda de una profesional: columna
    // estrecha, citas cortas difíciles de tocar». El ancho es fijo
    // (`w-44 md:w-52`, 176/208 px) porque con cinco peluqueras tiene que
    // caber una al lado de otra y deslizarse. En una clínica de UNA
    // podóloga —que es Rosario— eso deja 208 px de agenda y el resto de
    // la tablet en blanco, con las tarjetas de 15 minutos apretadas en
    // una tira.
    // Con una sola columna no hay nada con lo que repartir: `flex-1`, y
    // el mínimo se queda en el ancho de siempre para que nada encoja.
    <div
      data-columna-staff={props.staff.userId}
      // agenda-1 · `flex-1` con el ancho de siempre como SUELO. El carril
      // es `w-full min-w-max`: con pocas columnas se reparten la pantalla
      // y con muchas el carril desborda y se desliza. (`unica` sobra desde
      // que una sola profesional es una lista, pero el gancho se queda
      // para la columna «Sin asignar», que puede quedarse sola.)
      className="flex-1 min-w-44 md:min-w-52 border-l border-slate-200"
    >
      <div
        className={`sticky top-0 z-10 flex items-center gap-2 px-2 bg-white border-b border-slate-200 ${
          props.queHace ? "h-14" : "h-10"
        }`}
        // B-reservas-mostrador F2 · la cabecera usa el MISMO color base que el
        // tinte de sus tarjetas: si la columna es morada, sus citas son
        // moradas. Una profesional sin color ya no cae en el gris de todas —
        // tiene el suyo, derivado de su id y por tanto estable.
        //
        // Va por `colorDeCabecera` y no por el color crudo: lo cogió el bucle
        // visual. Un amarillo casi blanco (#fef9c3) DESAPARECÍA sobre el
        // blanco de la cabecera y la columna se quedaba sin su marca.
        style={{ borderTop: `3px solid ${colorStaff}` }}
      >
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] font-semibold text-mipiace-ink truncate">
            {staff.displayName}
          </span>
          {props.queHace && (
            <span
              data-que-hace={staff.userId}
              className={`block text-[11.5px] truncate ${
                props.queHace.ocupada ? "text-emerald-700" : "text-amber-700"
              }`}
            >
              {props.queHace.texto}
            </span>
          )}
        </span>
        {/* B-reservas-7a · TOQUE 1 de 3 para poner una ausencia. Va en la
            cabecera de la columna porque es donde Sole escribe «Ana libre»
            en su Excel: en la fila de la persona, no en un ajuste. */}
        {props.onMenu && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              props.onMenu!();
            }}
            data-ausencia-menu={staff.userId}
            className="h-8 w-8 shrink-0 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-500"
            aria-label={`Opciones de ${staff.displayName}`}
          >
            <MoreVertical className="w-4 h-4" />
          </button>
        )}
      </div>
      <div
        // Gancho estable para el bucle visual y el test de jsdom: la
        // superficie de la columna hay que poder tocarla por su sitio.
        data-columna={staff.userId}
        className="relative"
        style={{ height: totalH }}
        onClick={(e) => {
          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
          const y = e.clientY - rect.top;
          props.onSlot(dayStartMin + y / pxPorMin);
        }}
      >
        {/* B-reservas-6a · lo que ya pasó no invita. Va PRIMERO en el DOM
            para quedar por debajo de las citas (una cita de las 10:00 se
            sigue viendo y se sigue tocando: se cobra, se finaliza y se
            cancela). El borde de abajo es el SUELO, no "ahora": la línea
            roja cae dentro de la franja en curso, que sí se reserva. */}
        {pastH > 0 && (
          <div
            aria-hidden
            style={{ height: pastH }}
            className="absolute left-0 right-0 top-0 bg-slate-200/45 pointer-events-none border-b border-slate-300/60"
          />
        )}
        {/* B-reservas-7a · lo que NO es reservable de esta columna: fuera
            del horario del centro, o fuera del turno de esta profesional.
            Va por debajo de las citas —una cita que quedó fuera se sigue
            viendo y se sigue cobrando— y no se puede tocar para crear. */}
        {cerradas.map((b) => (
          <div
            key={`cerrada-${b.from}`}
            aria-hidden
            data-no-reservable={`${hhmm(b.from)}-${hhmm(b.to)}`}
            style={{
              top: (b.from - dayStartMin) * pxPorMin,
              height: (b.to - b.from) * pxPorMin,
            }}
            // B-reservas-mostrador F2 · el rayado BAJA de tono (0,18 → 0,09 y
            // el fondo de slate-100 a slate-50). Hasta este bloque era lo que
            // más gritaba de la pantalla: una banda que dice que ahí NO se
            // puede hacer nada pesaba más que la cita, que es lo único que
            // importa. Sigue viéndose —lo fija `agenda-horario.test.tsx`— pero
            // ya no compite con las tarjetas teñidas.
            className="absolute left-0 right-0 bg-slate-50 pointer-events-none bg-[repeating-linear-gradient(135deg,transparent,transparent_5px,rgba(148,163,184,0.09)_5px,rgba(148,163,184,0.09)_10px)]"
          />
        ))}
        {/* rejilla: una línea por franja de la RETÍCULA del centro, más
            marcada en las horas en punto. Con 30 se ven las medias. */}
        {gridLines.map((m) => (
          <div
            key={m}
            style={{ top: (m - dayStartMin) * pxPorMin }}
            className={`absolute left-0 right-0 border-t ${
              m % 60 === 0 ? "border-slate-200" : "border-slate-100"
            }`}
          />
        ))}
        {/* B-reservas-7a · las AUSENCIAS, con su motivo. Es el «Ana libre»
            que Sole escribe en la celda. Se tocan para quitarlas. */}
        {absences.map((ab) => {
          const from = Math.max(minOf(ab.startTime), dayStartMin);
          const to = Math.min(minOf(ab.endTime), dayEndMin);
          if (to <= from) return null;
          return (
            <button
              key={`${ab.id ?? "sin-id"}-${ab.startTime}`}
              onClick={(e) => {
                e.stopPropagation();
                props.onAbsence(ab);
              }}
              data-ausencia={ab.id ?? "sin-id"}
              style={{
                top: (from - dayStartMin) * pxPorMin,
                height: (to - from) * pxPorMin,
              }}
              // SIN `z-index`: el orden del DOM ya la deja por encima de las
              // bandas apagadas y por debajo de las citas, que van después.
              // Un `z-10` aquí la subía por encima de la cabecera sticky de
              // la columna y tapaba el nombre de la profesional — lo cogió
              // el bucle visual, no un test.
              className="absolute left-0.5 right-0.5 rounded-lg bg-rose-50/85 border border-dashed border-rose-300 px-2 py-1 text-left overflow-hidden hover:bg-rose-100"
            >
              <div className="text-[11px] font-semibold text-rose-800 truncate">
                {ab.reason ?? "No está"}
              </div>
              <div className="text-[10.5px] text-rose-600 truncate">
                {ab.startTime === "00:00" && ab.endTime === "24:00"
                  ? "todo el día"
                  : `${ab.startTime}–${ab.endTime}`}
              </div>
            </button>
          );
        })}
        {/* agenda-1 · LOS HUECOS LIBRES, VISIBLES. Hasta este bloque un
            hueco en la rejilla era ausencia de tarjeta: se ve si te fijas
            y no se puede tocar con intención. Tocar la columna ya abría
            un alta en esa franja (B4), pero nada lo decía — y la pasada
            del 27-10 midió el camino de la rejilla en 5 toques justamente
            porque hay que adivinar dónde tocar.
            Van por DEBAJO de las citas en el DOM, así que una cita nunca
            queda tapada por un hueco; y son `<button>` con su hora dentro
            para que el bucle visual y el banco los encuentren. */}
        {huecosLibresDeLaColumna.map((h) => (
          <button
            key={`libre-${h.desdeMin}`}
            onClick={(e) => {
              e.stopPropagation();
              props.onSlot(h.desdeMin);
            }}
            data-hueco={hhmm(h.desdeMin)}
            data-hueco-min={String(h.desdeMin)}
            style={{
              top: (h.desdeMin - dayStartMin) * pxPorMin,
              height: (h.hastaMin - h.desdeMin) * pxPorMin,
            }}
            // B-reservas-mostrador F2 · el mismo criterio que el rayado de
            // «no reservable»: lo que dice que ahí NO hay nada no puede
            // pesar más que la cita, que es lo único que importa. Un
            // punteado de 1 px y slate-200, no de 2 y slate-300.
            className="absolute left-1 right-1 rounded-lg border border-dashed border-slate-200 px-2 py-1 text-left text-[11px] text-slate-400 overflow-hidden hover:bg-slate-50"
          >
            {hhmm(h.desdeMin)} · libre {duracionHumana(h.hastaMin - h.desdeMin)}
          </button>
        ))}
        {/* línea "ahora" */}
        {nowMin != null && nowMin >= dayStartMin && nowMin <= dayEndMin && (
          <div
            style={{ top: (nowMin - dayStartMin) * pxPorMin }}
            className="absolute left-0 right-0 h-0.5 bg-red-500 z-20"
          />
        )}
        {/* citas */}
        {appts.map((a) => {
          const top = (localMinutes(a.start) - dayStartMin) * pxPorMin;
          const finMin =
            localMinutes(a.end) <= localMinutes(a.start)
              ? 24 * 60
              : localMinutes(a.end);
          // agenda-1 · el suelo de la tarjeta es el área tocable, no 22
          // px. Con la escala derivada de la retícula una cita de una
          // franja ya mide eso; el `max` cubre la cita de MEDIA franja
          // que llega de una reserva online o de un `slotMinutes`
          // cambiado después (y que se seguiría pudiendo tocar).
          const height = Math.max(
            TOQUE_MIN_PX,
            (finMin - localMinutes(a.start)) * pxPorMin,
          );
          // B-reservas-7a · una cita que quedó fuera del horario —porque el
          // festivo o la ausencia se pusieron DESPUÉS— se sigue viendo y se
          // sigue pudiendo cobrar. Sólo se marca, para que la cajera sepa
          // que hay algo que avisar.
          const fuera = fueraDeHorario(a);
          // B-reservas-6a frente O · una cita que sigue en el outbox se
          // pinta DISTINTA: a rayas discontinuas y diciendo en qué estado
          // está. No es una cita del centro todavía — y si el servidor la
          // rechazó, se queda ahí en rojo hasta que alguien decida.
          const local = a.pendingOffline === true;
          const rechazada = a.outboxStatus === "rejected";
          return (
            <button
              key={a.id + staff.userId}
              onClick={(e) => {
                e.stopPropagation();
                props.onAppt(a);
              }}
              style={{
                top,
                height,
                // B-reservas-mostrador F2 · la cita de una profesional se tiñe
                // con SU color. La local y la rechazada de 6a NO: su ámbar y
                // su rojo son lo que las distingue de una cita de verdad, y
                // teñirlas sería borrar esa diferencia.
                ...(local
                  ? {}
                  : {
                      background: tinteStaff,
                      borderLeft: `4px solid ${tonoDeEstado(STATUS_COLOR[a.status])}`,
                    }),
              }}
              // Ganchos estables para el bucle visual. El tinte de verdad va
              // en `style`, que es lo que el navegador pinta: `data-tinte` es
              // sólo para poder localizarlo desde Playwright.
              data-cita={a.id}
              data-tinte={local ? undefined : tinteStaff}
              className={
                local
                  ? // A la MITAD DERECHA de la columna. El bucle visual
                    // destapó por qué hace falta: una cita rechazada por
                    // TAKEN está, por definición, encima de la que ocupó
                    // su hueco — y a ancho completo la tapaba. La agenda
                    // no tiene layout de solape porque hasta ahora el
                    // EXCLUDE lo hacía imposible; con las citas locales
                    // deja de serlo, y ésta es la respuesta barata: las
                    // dos se ven.
                    `absolute left-1/2 right-1 rounded-lg px-2 py-1 text-left overflow-hidden border-2 border-dashed ${
                      rechazada
                        ? "bg-red-50 border-red-300"
                        : "bg-amber-50 border-amber-300"
                    }`
                  : // Sin `z-index`, como en B4: va la última en el DOM, así
                    // que ya queda por encima de las bandas y de las
                    // ausencias, y por DEBAJO de la cabecera sticky y de la
                    // línea de "ahora" — que es como estaba y no lo cambia
                    // este bloque.
                    //
                    // B-reservas-mostrador F2 · sin `bg-white`: el fondo lo
                    // pone el tinte de la profesional por `style`.
                    `absolute left-1 right-1 rounded-lg shadow-sm px-2 py-1 text-left overflow-hidden hover:shadow-md ${
                      fuera
                        ? "border border-amber-300 ring-1 ring-amber-200"
                        : "border border-slate-200"
                    }`
              }
              data-fuera-de-horario={!local && fuera ? "1" : undefined}
            >
              <div
                className={`text-[11px] font-semibold truncate ${
                  local
                    ? rechazada
                      ? "text-red-800"
                      : "text-amber-900"
                    : "text-mipiace-ink"
                }`}
              >
                {localHHMM(a.start)} ·{" "}
                {(() => {
                  const cl = props.clientOf(a);
                  // El marcador NO lleva color propio: hereda el de la línea.
                  // Lo cogió el bucle visual — con `text-slate-400` sobre el
                  // tinte daba 1,95:1, o sea ilegible. Lo que lo distingue de
                  // un nombre de verdad es la CURSIVA y el peso normal, que no
                  // cuestan contraste.
                  return cl.desconocido ? (
                    <span data-cliente-desconocido className="font-normal italic">
                      {cl.nombre}
                    </span>
                  ) : (
                    cl.nombre
                  );
                })()}
                {local && (rechazada ? " · rechazada" : " · sin enviar")}
                {/* B-reservas-7a · si la tarjeta NO da para dos líneas, la
                    marca va aquí. Meterla en una segunda línea que no cabe
                    es el fallo que B-5 F8 arregló con `CARD_TWO_LINE_MIN_H`:
                    el `overflow-hidden` corta las letras por la mitad y se
                    lee como un fallo de pintado. Lo cogió el bucle visual,
                    no un test. */}
                {!local && fuera && height < CARD_TWO_LINE_MIN_H
                  ? " · fuera de horario"
                  : ""}
              </div>
              {/* B-reservas-5 F8 · la segunda línea sólo si cabe entera.
                  Una cita de 30 min mide 33 px y el contenido pide 40:
                  el `overflow-hidden` cortaba "Corte de pelo" por la
                  mitad de las letras, que se lee como un fallo de pintado.
                  Cortar limpio y dejar el servicio para el detalle es
                  mejor que enseñar media palabra. */}
              {/* B-reservas-mostrador F2 · `slate-600`, no `slate-500`.
                  Sobre blanco los dos pasaban AA, pero sobre un tinte que se
                  vea slate-500 pediría un fondo de luminancia 0,943 — o sea,
                  blanco. Con slate-600 el tinte cabe (5,56:1 contra el
                  objetivo del bloque). El número vive en
                  `lib/staffColor.ts` y lo fija `staff-color.test.ts`. */}
              {height >= CARD_TWO_LINE_MIN_H && (
                <div
                  className={`text-[10.5px] truncate ${
                    local ? "text-slate-500" : "text-slate-600"
                  }`}
                >
                  {!local && fuera ? "fuera de horario · " : ""}
                  {props.labelOf(a)}
                </div>
              )}

            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── agenda-1 · el panel de alta se fue a `AgendaPage.darCita.tsx` ────
//
// `BookingPanel` (cliente-first + multi-servicio + «Buscar hueco») vivía
// aquí desde B4 y es lo que la pasada del 27-10 midió en ~10 toques. Lo
// sustituye `PanelDarCita`: el mismo contrato de entrada y salida (un
// `DraftBooking`, `onReserve`, `onReserveAndCharge`), otra forma de
// preguntar. Lo que se conserva, pieza a pieza y con sus motivos, está
// comentado allí: «Reservar y cobrar» sólo en una cita de hoy (F1), el
// motivo visible de cada botón apagado (F4), las alternativas del 409 del
// suelo pegadas a la hora (6a), la lista agrupada por categoría y uso
// (clinica-8 fase B, 17), el nombre entero en dos líneas (19), las horas
// traídas a la vista (25) y el bono (B-reservas-8).

// ── Detalle de cita ────────────────────────────────────────────────────

/**
 * clinica-3 · saca una hoja de pantalla completa del contexto de apilado de
 * la agenda y la monta en `document.body`.
 *
 * ── El fallo que esto arregla, y que lo encontró una captura ─────────
 *
 * `AgendaPage` es un `fixed inset-0 z-40`, y un z-index sobre un elemento
 * posicionado **crea un contexto de apilado**: todo lo que vive dentro
 * —incluidas estas hojas, que pedían `z-50`— queda encerrado en el
 * peldaño 40. Y la pantalla de venta de detrás tiene, por debajo de
 * 1024 px, su **barra inferior fija** (`SalePage.tsx`, «thumb-zone» de
 * v1.0-handheld) también en `z-40`… pero más abajo en el DOM. Así que
 * empata y gana ella: la barra «0 líneas · 0,00 €» se pinta ENCIMA de la
 * hoja clínica y tapa justo el pie, que es donde está el botón de cerrar
 * la sesión.
 *
 * Se vio en la captura de 390 px del bucle visual, no en un test: a
 * 1024 px la barra no existe (`lg:hidden`) y la suite no mira píxeles.
 *
 * **Y NO ES SÓLO DE ESTE BLOQUE**: la hoja de la valoración de clinica-2
 * tenía el mismo problema desde que nació, por la misma razón. Las dos
 * pasan por aquí.
 *
 * Por qué un portal y no subir el `z-40` de la agenda: porque ese 40 lo
 * comparten la agenda y la barra de la venta a propósito —los modales de
 * la venta abren a 50 por encima de los dos (comentario de
 * `SalePage.tsx:3467`)— y moverlo cambiaría el apilado de una pantalla que
 * usan los quince clientes. El portal cambia SÓLO estas tres hojas.
 */
function AlFrente(props: { children: React.ReactNode }) {
  if (typeof document === "undefined") return <>{props.children}</>;
  return createPortal(props.children, document.body);
}

function DetailPanel(props: {
  appt: AgendaAppointment;
  client: { nombre: string; desconocido: boolean };
  serviceLabel: string;
  /** Quién la atiende ahora mismo. Se nombra si el motor la cambia. */
  staffName: string | null;
  /** mover-con-otra · las columnas del día: de aquí sale «Con quién». */
  staff: AgendaStaff[];
  /** mover-con-otra · la matriz. `null` = no se sabe ⇒ se ofrecen todas. */
  skillsPorStaff: Map<string, Set<string>> | null;
  sinRed: boolean;
  moveError: { message: string; alternatives: AvailabilitySlot[] } | null;
  onClose: () => void;
  onStatus: (s: AppointmentStatus) => void;
  onCheckout: () => void;
  /** clinica-1 · ¿se le ofrece «Cobrar en caja»? El sanitario sin caja, no. */
  puedeCobrar: boolean;
  /** clinica-2 · este paciente tiene la valoración sin validar. SIN NINGÚN
   *  dato de salud: es un trámite pendiente, no un diagnóstico. */
  valoracionPendiente: boolean;
  /** clinica-2 · lleva la marca sanitaria (y por tanto se le ofrece abrir
   *  la valoración). Ver la nota de `AgendaPageProps`. */
  esSanitario: boolean;
  /** `undefined` en una cita sin paciente (walk-in): no hay historia. */
  onAbrirValoracion?: () => void;
  /** clinica-6 · abrir la historia viva del paciente de esta cita. */
  onAbrirHistoria?: () => void;
  /** clinica-3 · abrir la sesión de esta cita. `undefined` en una cita sin
   *  paciente: una sesión clínica es de una persona con historia. */
  onAbrirSesion?: () => void;
  /** clinica-3 · esta cita tiene la sesión CERRADA y sin cobrar. Es
   *  información de CAJA y no de salud —«a esta cita le queda cobrar» no
   *  dice nada de lo que se le hizo— así que la ve también la recepción. */
  sesionPorCobrar: boolean;
  /**
   * clinica-9 (4) · ¿la cita es de hoy?
   *
   * La sesión de una cita se escribe el día de esa cita. Fuera de ese día
   * el botón no dice «Sesión de hoy» —porque no lo es— y lleva a la misma
   * pantalla en modo lectura: la historia y la exploración se miran
   * cualquier día; lo que no se hace es firmar hoy la visita del lunes.
   *
   * Con la sesión YA CERRADA el botón sigue siendo el camino para leerla,
   * y eso no cambia: clinica-2 dejó escrito que una cita pasada sigue
   * siendo el sitio desde el que se revisa lo que se escribió ese día.
   */
  citaEsDeHoy: boolean;
  /**
   * clinica-8 · ¿es un centro con historia clínica?
   *
   * Cambia el ORDEN de la cita, no lo que se puede hacer: «Sesión de hoy»
   * pasa a ser el botón fuerte y «Cobrar en caja» aparece **cuando la
   * sesión está cerrada**, con el ticket ya hecho (decisión de producto de
   * Matías, 18-10). Hasta este bloque el botón más fuerte era «Cobrar en
   * caja» y «Sesión de hoy» el más suave — o sea que la pantalla invitaba
   * a cobrar la previsión antes de registrar la consulta.
   *
   * `false` en los catorce comercios sin clínica, y ahí el panel es
   * exactamente el de ayer.
   */
  clinicaEncendida: boolean;
  onMove: (startISO: string, staffUserId?: string) => void;
  onClearMoveError: () => void;
}) {
  const { appt } = props;
  const terminal =
    appt.status === "COMPLETED" ||
    appt.status === "CANCELLED" ||
    appt.status === "NO_SHOW";
  return (
    <div className="w-full md:w-80 shrink-0 bg-white border-l border-slate-200 flex flex-col overflow-y-auto">
      <div className="flex items-center gap-2 h-14 px-4 border-b border-slate-100 shrink-0">
        <h2 className="text-[15px] font-semibold text-mipiace-ink flex-1">
          Detalle
        </h2>
        <button
          onClick={props.onClose}
          className="h-9 w-9 rounded-xl hover:bg-slate-100 flex items-center justify-center"
          aria-label="Cerrar"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="p-4 space-y-3 text-[14px]">
        <div>
          <div className="text-[12px] text-slate-400">Cliente</div>
          <div
            data-cliente-desconocido={props.client.desconocido ? "" : undefined}
            className={
              props.client.desconocido
                ? // Cursiva, no gris claro: el marcador tiene que LEERSE.
                  "italic text-slate-600"
                : "font-medium text-mipiace-ink"
            }
          >
            {props.client.nombre}
          </div>
        </div>
        <div>
          <div className="text-[12px] text-slate-400">Servicios</div>
          <div className="text-mipiace-ink">{props.serviceLabel}</div>
        </div>
        <div>
          <div className="text-[12px] text-slate-400">Hora</div>
          <div className="tabular-nums text-mipiace-ink">
            {localHHMM(appt.start)} – {localHHMM(appt.end)}
          </div>
        </div>
        {/* clinica-2 · EL AVISO DISCRETO.
            Discreto de verdad: una línea ámbar con cinco palabras, debajo
            de los datos de la cita y sin icono de alarma. Lo que dice es
            que falta un trámite —no qué tiene el paciente— y por eso lo
            puede leer la recepcionista: es ella la que le pregunta si le
            llegó el email. Las alertas de salud viven sólo dentro de la
            historia (decisión de producto 6). */}
        {props.valoracionPendiente && (
          <div className="rounded-xl bg-amber-50 text-amber-700 px-3 py-2 text-[12.5px] leading-snug">
            Valoración pendiente
          </div>
        )}
        {/* clinica-3 · el otro aviso discreto, y de caja: la sesión está
            cerrada y queda cobrarla. Lo lee la recepción, que es quien
            cobra, y no cuenta nada de la historia. */}
        {props.sesionPorCobrar && (
          <div className="rounded-xl bg-mipiace-coral-soft text-mipiace-coral-dark px-3 py-2 text-[12.5px] leading-snug font-medium">
            Sesión cerrada · queda cobrarla
          </div>
        )}
        <div>
          {/* B-reservas-mostrador F2 · el mismo tono que el filete de la
              tarjeta. Con `STATUS_COLOR` crudo este chip pintaba texto BLANCO
              sobre el ámbar de "Pendiente": 2,15:1, muy por debajo de AA. Era
              un defecto de master que el bloque cierra de paso. */}
          <span
            data-estado={appt.status}
            className="inline-block text-[12px] font-medium px-2 py-0.5 rounded-md text-white"
            style={{ background: tonoDeEstado(STATUS_COLOR[appt.status]) }}
          >
            {STATUS_LABEL[appt.status]}
          </span>
        </div>
      </div>

      {/* clinica-2 · la puerta del sanitario a la historia. Va FUERA del
          `!terminal` a propósito: una cita ya completada o cancelada sigue
          siendo el sitio desde el que se revisa lo que se escribió ese
          día, y la historia no se cierra con la cita. */}
      {props.esSanitario && props.onAbrirValoracion && (
        <div className="p-4 border-t border-slate-100 space-y-2">
          {/* clinica-3 · LA SESIÓN va primero y es el botón ancho: es el
              acto de la visita. La valoración es el trámite de antes y se
              hace una vez en la vida del paciente. Van los dos fuera del
              `!terminal` por la misma razón que clinica-2 dio: una cita
              completada sigue siendo el sitio desde el que se lee lo que
              se escribió ese día, y la historia no se cierra con la cita. */}
          {props.onAbrirSesion && (
            // clinica-8 · EL BOTÓN PRINCIPAL en un centro clínico. Antes
            // era el suave y «Cobrar en caja» el fuerte: la pantalla
            // invitaba a cobrar la previsión antes de registrar lo que se
            // había hecho. Fuera de la clínica se queda como estaba.
            <button
              data-test="sesion-de-hoy"
              onClick={props.onAbrirSesion}
              className={
                "w-full min-h-touch rounded-xl text-[14px] font-semibold flex items-center justify-center gap-2 " +
                (props.clinicaEncendida &&
                !props.sesionPorCobrar &&
                props.citaEsDeHoy
                  ? "bg-mipiace-coral hover:bg-mipiace-coral-dark text-white"
                  : "bg-mipiace-coral-soft text-mipiace-coral-dark")
              }
            >
              <Footprints className="w-4 h-4" strokeWidth={2.25} />
              {/* clinica-9 (4) · y no dice «de hoy» si no es de hoy. */}
              {props.citaEsDeHoy ? "Sesión de hoy" : "Ver la sesión"}
            </button>
          )}
          {/* clinica-9 (4) · POR QUÉ el botón no es el de siempre. Una
              línea debajo y no un tooltip: lo que hay que entender es que
              la visita de otro día se anota el día que se hace, no que el
              botón esté «apagado». */}
          {props.onAbrirSesion && !props.citaEsDeHoy && (
            <p
              data-test="sesion-fuera-del-dia"
              className="text-[12.5px] text-slate-500 leading-snug"
            >
              La sesión se abre el día de la cita.
            </p>
          )}
          {/* clinica-6 · LA HISTORIA, encima de la valoración: desde aquí
              se ve todo de un vistazo —incluida la valoración, que tiene
              su fila en Documentos— y desde la valoración no se ve la
              historia. La valoración sigue teniendo su botón porque es
              donde se VALIDA, y validar no es leer. */}
          {props.onAbrirHistoria && (
            <button
              onClick={props.onAbrirHistoria}
              className="w-full min-h-touch rounded-xl bg-white border border-slate-200 hover:bg-slate-50 text-[14px] font-medium text-mipiace-ink flex items-center justify-center gap-2"
            >
              <NotebookText className="w-4 h-4" strokeWidth={2.25} />
              Historia del paciente
            </button>
          )}
          <button
            onClick={props.onAbrirValoracion}
            className="w-full min-h-touch rounded-xl bg-white border border-slate-200 hover:bg-slate-50 text-[14px] font-medium text-mipiace-ink flex items-center justify-center gap-2"
          >
            <Stethoscope className="w-4 h-4" strokeWidth={2.25} />
            Valoración inicial
          </button>
        </div>
      )}

      {!terminal && (
        <div className="p-4 border-t border-slate-100 space-y-2">
          {/* clinica-8 · EN UNA CLÍNICA, COBRAR SALE DESPUÉS DE LA SESIÓN.
              Con la sesión cerrada el ticket ya está hecho con lo que se
              hizo y quien cobra sólo lo confirma; antes de cerrarla, lo
              único que habría que cobrar es la previsión de la cita, que es
              justo lo que este bloque deja de hacer.

              La salida no se cierra: la venta suelta sigue entera en el
              menú, y es desde donde se cobra cualquier cosa que no salga de
              una consulta (unas plantillas, un producto). La línea lo dice
              en vez de dejar un hueco. */}
          {props.puedeCobrar &&
            (!props.clinicaEncendida || props.sesionPorCobrar ? (
              <button
                data-test="cobrar-en-caja"
                onClick={props.onCheckout}
                className="w-full h-12 rounded-xl bg-mipiace-coral hover:bg-mipiace-coral-dark text-white text-[15px] font-semibold"
              >
                Cobrar en caja
              </button>
            ) : (
              <p
                data-test="cobrar-tras-la-sesion"
                className="text-[12.5px] text-slate-500 leading-snug"
              >
                El cobro sale al cerrar la sesión de hoy, con el ticket ya
                hecho. Para cobrar algo aparte, usa la venta.
              </p>
            ))}
          <MoverCita
            appt={appt}
            staff={props.staff}
            skillsPorStaff={props.skillsPorStaff}
            sinRed={props.sinRed}
            error={props.moveError}
            onMove={props.onMove}
            onClearError={props.onClearMoveError}
          />
          <div className="grid grid-cols-2 gap-2">
            {appt.status === "PENDING" && (
              <StatusBtn label="Confirmar" onClick={() => props.onStatus("CONFIRMED")} />
            )}
            {appt.status !== "IN_SERVICE" && (
              <StatusBtn label="En sala" onClick={() => props.onStatus("IN_SERVICE")} />
            )}
            <StatusBtn label="Finalizar" onClick={() => props.onStatus("COMPLETED")} />
            <StatusBtn label="No-show" onClick={() => props.onStatus("NO_SHOW")} />
            <StatusBtn
              label="Cancelar"
              danger
              onClick={() => props.onStatus("CANCELLED")}
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ── agenda-lista (hallazgo 🟡 6) · mover la cita ──────────────────────
//
// Arrastrar la tarjeta en la rejilla queda FUERA de este bloque a
// propósito: un detalle claro con dedo de peluquera vale más que un
// arrastre que falla en el AP12.
//
// El control es el MISMO que el alta, no uno nuevo: el `type="date"`
// nativo para el día (que es el control bueno para una fecha de cita —
// cae a semanas de hoy, que es justo donde abre el calendario del
// sistema) y «Buscar hueco» con sus chips de hora. Dos maneras de pedir
// una hora en la misma pantalla serían dos cosas que aprender.
function MoverCita(props: {
  appt: AgendaAppointment;
  staff: AgendaStaff[];
  skillsPorStaff: Map<string, Set<string>> | null;
  sinRed: boolean;
  error: { message: string; alternatives: AvailabilitySlot[] } | null;
  onMove: (startISO: string, staffUserId?: string) => void;
  onClearError: () => void;
}) {
  const { appt, sinRed } = props;
  const [abierto, setAbierto] = useState(false);
  const [dia, setDia] = useState(() => centerWallDate(appt.start));
  const [slots, setSlots] = useState<AvailabilitySlot[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [errorBusqueda, setErrorBusqueda] = useState<string | null>(null);
  const [elegido, setElegido] = useState<string | null>(null);
  // mover-con-otra · «Con quién». ARRANCA EN LA ACTUAL: con ella elegida,
  // todo se comporta exactamente como antes de este bloque (el PATCH no
  // manda `staffUserId`, ver `doMove`).
  const [conQuien, setConQuien] = useState<string | null>(() =>
    staffDeLaCita(appt),
  );

  // Los servicios de la cita, en su orden. Los miran dos cosas que tienen
  // que decir lo mismo: a quién se ofrece, y con qué se buscan los huecos.
  const servicios = useMemo(
    () =>
      appt.items
        .slice()
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((it) => ({ serviceId: it.serviceId })),
    [appt.items],
  );

  // Sólo las que saben hacer TODOS los servicios de la cita. Sin matriz
  // (no llegó, o no hay red) todas, y el motor sigue siendo la puerta: el
  // mismo criterio que el alta (agenda-lista §3).
  //
  // La ACTUAL se añade siempre, aunque la matriz diga que no sabe: la cita
  // ya es suya. Esconderla dejaría el selector sin la opción que está
  // seleccionada, y «no tocar nada» pasaría a ser imposible.
  const candidatas = useMemo(() => {
    const puede = profesionalesQuePuedenConLaCita(
      props.staff,
      servicios.map((s) => s.serviceId),
      props.skillsPorStaff,
    );
    const actual = staffDeLaCita(appt);
    if (!actual || puede.some((p) => p.userId === actual)) return puede;
    const suya = props.staff.find((p) => p.userId === actual);
    return suya ? [suya, ...puede] : puede;
  }, [props.staff, props.skillsPorStaff, servicios, appt]);

  // Si la cita se movió de verdad, la hoja se pliega y arranca otra vez
  // desde donde está ahora.
  //
  // Lo de plegarla no es cosmético, lo destapó el banco: el trámite está
  // hecho, y dejar la hoja abierta con los chips del día viejo pide a
  // gritos mover dos veces la misma cita. Lo que tiene que verse al
  // acabar es el detalle con su hora nueva.
  useEffect(() => {
    setAbierto(false);
    setDia(centerWallDate(appt.start));
    setSlots([]);
    setElegido(null);
    setErrorBusqueda(null);
    // Y «Con quién» vuelve a la de la cita: si acaba de pasar de Ana a
    // Isa, la hoja tiene que arrancar en Isa, que es de quien es ahora.
    setConQuien(staffDeLaCita(appt));
  }, [appt.id, appt.start, appt.assignments]);

  async function buscar() {
    setBuscando(true);
    setErrorBusqueda(null);
    setElegido(null);
    props.onClearError();
    try {
      const res = await searchAvailability({
        // Los mismos servicios que ya tiene la cita, en su orden. Mover no
        // es editar: lo que cambia es cuándo (y con quién), no qué.
        items: servicios,
        // LA ELEGIDA, que por defecto es la suya. Los huecos tienen que ser
        // de quien vaya a atender: con `null` la lista enseñaría horas en
        // las que está libre OTRA, y al pulsar Mover saldría un «no» sobre
        // una hora que la pantalla acababa de ofrecer. Por eso al cambiar
        // de peluquera se limpian los chips — eran de la anterior.
        staffUserId: conQuien,
        from: dia,
        to: dia,
      });
      setSlots(res);
      if (res.length === 0) setErrorBusqueda("No hay huecos ese día.");
    } catch (err) {
      setErrorBusqueda(
        err instanceof ApiError ? err.message : "Error buscando huecos.",
      );
    } finally {
      setBuscando(false);
    }
  }

  if (!abierto) {
    return (
      <div>
        <button
          data-accion="mover-cita"
          onClick={() => setAbierto(true)}
          disabled={sinRed}
          className="w-full h-11 rounded-xl border border-slate-300 text-[14px] font-medium text-mipiace-ink hover:bg-slate-50 disabled:opacity-40"
        >
          Mover la cita
        </button>
        {/* Ningún botón mudo (`docs/ux-principles.md` §6): el motivo en
            texto, nunca en un `title`. */}
        {sinRed && (
          <div
            data-motivo="mover-cita"
            className="text-[12px] text-slate-500 mt-1.5"
          >
            Hace falta conexión para mover una cita.
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      data-panel="mover-cita"
      className="rounded-xl border border-slate-200 p-3 space-y-3"
    >
      <div className="flex items-center gap-2">
        <h3 className="text-[13px] font-semibold text-mipiace-ink flex-1">
          Mover la cita
        </h3>
        <button
          onClick={() => {
            setAbierto(false);
            props.onClearError();
          }}
          className="text-[12px] text-slate-500"
        >
          cancelar
        </button>
      </div>

      {/* mover-con-otra · «Con quién», encima del día: primero quién la
          atiende, después cuándo — es el orden en que se habla en el
          mostrador («¿te va bien con Isa?» → «¿a qué hora?»).

          Botones de dedo de peluquera (h-11), no un `select`: el AP12 se
          toca con el pulgar y la lista son tres nombres. */}
      {props.staff.length > 1 && (
        <div>
          <div className="text-[12px] font-medium text-slate-500">Con quién</div>
          <div
            data-selector="mover-profesional"
            className="mt-1 flex flex-wrap gap-1.5"
          >
            {candidatas.map((p) => {
              const elegida = conQuien === p.userId;
              return (
                <button
                  key={p.userId}
                  data-staff={p.userId}
                  aria-pressed={elegida}
                  onClick={() => {
                    if (elegida) return;
                    setConQuien(p.userId);
                    // Los chips y el «no» eran de la anterior: con otra
                    // peluquera enseñarían horas que no son suyas.
                    setSlots([]);
                    setElegido(null);
                    setErrorBusqueda(null);
                    props.onClearError();
                  }}
                  className={`h-11 px-3 rounded-xl text-[13px] font-medium ${
                    elegida
                      ? "bg-mipiace-ink text-white"
                      : "bg-mipiace-stone text-mipiace-ink hover:bg-slate-200"
                  }`}
                >
                  {p.displayName}
                </button>
              );
            })}
          </div>
          {/* El motivo de lo que NO está, en texto visible y nunca en un
              `title` (`docs/ux-principles.md` §6). Sólo cuando de verdad
              se ha dejado a alguien fuera: un aviso que sale siempre deja
              de leerse. */}
          {props.skillsPorStaff &&
            candidatas.length < props.staff.length && (
              <div
                data-motivo="mover-profesional"
                className="text-[12px] text-slate-500 mt-1.5"
              >
                Sólo aparecen las que hacen estos servicios.
              </div>
            )}
        </div>
      )}

      <div>
        <label
          htmlFor="mover-dia"
          className="text-[12px] font-medium text-slate-500"
        >
          Día
        </label>
        <input
          id="mover-dia"
          type="date"
          value={dia}
          min={todayLocalDate()}
          onChange={(e) => {
            if (!e.target.value) return;
            setDia(e.target.value);
            setSlots([]);
            setElegido(null);
            setErrorBusqueda(null);
            props.onClearError();
          }}
          aria-label="Mover al día"
          className="mt-1 h-11 w-full px-2 rounded-xl bg-mipiace-stone border border-slate-200 text-[13px] font-medium tabular-nums text-mipiace-ink"
        />
      </div>

      <div>
        <button
          data-accion="buscar-hueco-mover"
          onClick={() => void buscar()}
          disabled={buscando}
          className="w-full h-10 rounded-xl bg-mipiace-ink text-white text-[13px] font-medium disabled:opacity-40"
        >
          {buscando ? "Buscando…" : "Buscar hueco"}
        </button>
        {errorBusqueda && (
          <div className="text-[12px] text-slate-500 mt-1.5">{errorBusqueda}</div>
        )}
        <div className="mt-2 flex flex-wrap gap-1.5">
          {slots.slice(0, 24).map((sl) => (
            <button
              key={sl.start}
              // mover-con-otra · `data-hueco` existe porque ahora hay DOS
              // grupos de botones con `aria-pressed` en esta hoja (las
              // horas y «Con quién»), y el banco localizaba los chips por
              // ese atributo. Un locator ambiguo habría contado el nombre
              // de la peluquera como si fuera una hora.
              data-hueco={sl.start}
              onClick={() => setElegido(sl.start)}
              aria-pressed={elegido === sl.start}
              className={`h-9 px-2.5 rounded-lg text-[12.5px] tabular-nums ${
                elegido === sl.start
                  ? "bg-mipiace-ink text-white"
                  : "bg-mipiace-stone hover:bg-slate-200"
              }`}
            >
              {localHHMM(sl.start)}
            </button>
          ))}
        </div>
      </div>

      {/* El «no» del motor, con las alternativas que él mismo devuelve.
          Mismo aviso que el alta y en el mismo sitio: pegado a la hora. */}
      {props.error && (
        <div
          data-aviso="mover-cita"
          className="rounded-xl border border-amber-300 bg-amber-50 p-3"
        >
          <div className="text-[13px] leading-snug text-amber-900">
            {props.error.message}
          </div>
          {props.error.alternatives.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {props.error.alternatives.slice(0, 3).map((sl) => (
                <button
                  key={sl.start}
                  onClick={() => {
                    setDia(centerWallDate(sl.start));
                    setElegido(sl.start);
                    props.onClearError();
                  }}
                  className="h-11 px-3.5 rounded-xl bg-white border border-amber-300 text-[14px] font-semibold tabular-nums text-amber-900 hover:bg-amber-100"
                >
                  {localHHMM(sl.start)}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <button
        data-accion="confirmar-mover"
        onClick={() =>
          elegido && props.onMove(elegido, conQuien ?? undefined)
        }
        disabled={!elegido}
        className="w-full h-11 rounded-xl bg-mipiace-coral hover:bg-mipiace-coral-dark text-white text-[14px] font-semibold disabled:opacity-40"
      >
        {elegido
          ? conQuien && conQuien !== staffDeLaCita(appt)
            ? // Cambia de columna: el botón lo dice ANTES de pulsarlo.
              `Mover a las ${localHHMM(elegido)} con ${
                candidatas.find((p) => p.userId === conQuien)?.displayName ??
                "otra"
              }`
            : `Mover a las ${localHHMM(elegido)}`
          : "Mover"}
      </button>
      {!elegido && (
        <div className="text-[12px] text-slate-500">Elige una hora.</div>
      )}
    </div>
  );
}

function StatusBtn(props: { label: string; danger?: boolean; onClick: () => void }) {
  return (
    <button
      onClick={props.onClick}
      className={`h-10 rounded-xl border text-[13px] font-medium ${
        props.danger
          ? "border-red-200 text-red-600 hover:bg-red-50"
          : "border-slate-300 text-mipiace-ink hover:bg-slate-50"
      }`}
    >
      {props.label}
    </button>
  );
}
