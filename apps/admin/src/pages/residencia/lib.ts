// residencia-1 · los tipos que comparten las tres pantallas del centro, y
// las etiquetas en español de lo que la API devuelve en inglés.
//
// Las etiquetas viven AQUÍ y no en cada pantalla por lo mismo que
// `puestoVisible` vive en la API: si cada pantalla tradujera
// `SEMIASISTIDO` por su cuenta, dos acabarían llamando distinto a lo mismo
// y el personal lo notaría antes que nosotros.

export interface ResidenteCama {
  assignmentId: string;
  bedId: string;
  bedLabel: string;
  roomId: string;
  roomNumber: string;
  roomName: string | null;
  floorId: string;
  floorName: string;
  desde: string;
}

export interface ResidenteFila {
  clientId: string;
  nombre: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  birthdate: string | null;
  admissionDate: string;
  dischargeDate: string | null;
  dischargeReason: string | null;
  /** historia-1 (D-96) · la clase del alta. `null` en quien se fue antes
   *  de este bloque: no se le inventa una. */
  dischargeKind?: string | null;
  dependencyLevel: NivelDependencia;
  dependencyGrade: "I" | "II" | "III" | null;
  placeType: TipoDePlaza;
  responsible: { name: string; phone: string | null; relation: string | null } | null;
  /** `null` = ingreso pendiente. Se pinta como aviso, no como error. */
  cama: ResidenteCama | null;
}

export interface ResidenteFicha extends ResidenteFila {
  dni: string | null;
  nss: string | null;
  /** residencia-3 (D-64) · `null` = no tiene foto subida. */
  foto?: { bytes: number | null; subidaEn: string | null } | null;
  /** Y su consentimiento de imagen VIGENTE, o `null`. Son dos cosas
   *  distintas a propósito: la combinación que importa es «hay foto y NO
   *  se puede enseñar». */
  consentimientoDeImagen?: {
    id: string;
    anotadoEn: string;
    loDio: string | null;
    nombre: string | null;
    parentesco: string | null;
  } | null;
  ocupaciones: Array<{
    id: string;
    desde: string;
    hasta: string | null;
    motivo: string | null;
    habitacion: string;
    cama: string;
    planta: string;
  }>;
}

export type NivelDependencia = "VALIDO" | "SEMIASISTIDO" | "DEPENDIENTE";
export type TipoDePlaza = "PRIVADA" | "CONCERTADA" | "TEMPORAL";

export const NIVEL_LABEL: Record<NivelDependencia, string> = {
  VALIDO: "Válido",
  SEMIASISTIDO: "Semiasistido",
  DEPENDIENTE: "Dependiente",
};

export const PLAZA_LABEL: Record<TipoDePlaza, string> = {
  PRIVADA: "Privada",
  CONCERTADA: "Concertada",
  TEMPORAL: "Temporal",
};

/** historia-1 (D-96) · las cuatro clases de alta, en el orden en que se
 *  ofrecen. El traslado primero porque es el caso más frecuente en una
 *  residencia; el fallecimiento no va primero por respeto a quien lee la
 *  lista desplegada con la familia delante. */
export const CLASE_DE_ALTA_LABEL: Record<string, string> = {
  TRASLADO: "Traslado a otro centro o a su casa",
  VOLUNTARIA: "Se va por voluntad propia",
  FALLECIMIENTO: "Fallecimiento",
  OTRA: "Otra",
};

export const CATEGORIA_LABEL: Record<string, string> = {
  OPERATIVO: "Operativo",
  SUPERVISOR: "Supervisor",
  DIRECTIVO: "Directivo",
};

export interface PlantaVista {
  id: string;
  name: string;
  sortOrder: number;
  habitaciones: Array<{
    id: string;
    number: string;
    name: string | null;
    active: boolean;
    camas: Array<{
      id: string;
      label: string;
      active: boolean;
      ocupa: { clientId: string; nombre: string; desde: string } | null;
    }>;
    puerta: { deviceId: string; name: string | null; lastSeenAt: string | null } | null;
  }>;
}

export interface TurnoFila {
  id: string;
  code: string;
  name: string;
  startsAt: string;
  endsAt: string;
  sortOrder: number;
}

export interface RolDeCuidado {
  id: string;
  code: string;
  name: string;
  category: "OPERATIVO" | "SUPERVISOR" | "DIRECTIVO";
  isStandard: boolean;
  active: boolean;
  sortOrder: number;
  recordsCare: boolean;
  requiresLicense: boolean;
  fullScope: boolean;
}

/** `DD/MM/AAAA` desde un `YYYY-MM-DD`, sin pasar por `Date`. */
export function fechaCorta(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

/** Hoy en `YYYY-MM-DD`, hora local. */
export function hoyISO(): string {
  const d = new Date();
  const mes = String(d.getMonth() + 1).padStart(2, "0");
  const dia = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mes}-${dia}`;
}

// ── residencia-2 · el catálogo de controles y el plan de cuidados ─────
//
// Los tipos de lo que la API devuelve, y las etiquetas en español de lo
// que devuelve en inglés. Las etiquetas viven AQUÍ por lo mismo que
// `NIVEL_LABEL`: si cada pantalla tradujera `EVERY_N_HOURS` por su cuenta,
// dos acabarían llamando distinto a lo mismo y el personal lo notaría
// antes que nosotros.

export type Capa = "EXEC" | "OBS" | "MEASURE" | "SCALE" | "EVENT";
export type Naturaleza = "SCHEDULED" | "ON_DEMAND" | "DERIVED";
export type DominioDeValor = "BOOL" | "ORDINAL" | "NUMERIC" | "SCORE" | "TEXT_SHORT";
export type AlcanceDeControl = "STANDARD" | "CENTER";
export type TipoDeFrecuencia =
  | "EVERY_SHIFT"
  | "DAILY"
  | "MOMENTS"
  | "EVERY_N_HOURS"
  | "WEEKDAYS"
  | "EVERY_N_DAYS"
  | "MONTHLY"
  | "ON_DEMAND";

export interface FrecuenciaUI {
  kind: TipoDeFrecuencia;
  everyNHours?: number | null;
  everyNDays?: number | null;
  weekdays?: number[];
  monthDay?: number | null;
  shiftCodes?: string[];
  momentCodes?: string[];
}

export interface TurnoCorto {
  code: string;
  name: string;
  startsAt?: string;
  endsAt?: string;
}

export interface MomentoDelDia {
  id?: string;
  code: string;
  name: string;
  atTime: string;
  sortOrder?: number;
}

export interface RolQueRegistra {
  code: string;
  name: string;
  category: string;
}

export interface OpcionDeControl {
  code: string;
  label: string;
  comoSiempre: boolean;
}

export interface AjusteDeControl {
  active: boolean;
  alias: string | null;
  frecuencia: FrecuenciaUI;
  careRoleCodes: string[];
  familyVisible: boolean;
  /** Lo que el sistema tuvo que reconducir al llegar una versión nueva. */
  reconducido: {
    cuando: string;
    desdeVersion: number | null;
    motivo: string | null;
  } | null;
}

export interface ControlDelCatalogo {
  id: string;
  scope: AlcanceDeControl;
  code: string;
  version: number;
  name: string;
  layer: Capa;
  nature: Naturaleza;
  valueDomain: DominioDeValor;
  unit: string | null;
  inputMin: number | null;
  inputMax: number | null;
  refMin: number | null;
  refMax: number | null;
  groupCode: string | null;
  isoIndicatorCode: string | null;
  sortOrder: number;
  validFrom: string;
  opciones: OpcionDeControl[];
  /** La frontera: lo que el centro PUEDE elegir en este control. */
  puedeElegir: { frecuencias: TipoDeFrecuencia[]; roles: string[] };
  ajuste: AjusteDeControl | null;
  frecuenciaDeSerie: FrecuenciaUI;
}

export interface LineaDelPlan {
  id: string;
  controlCode: string;
  nombre: string;
  layer: Capa | null;
  frecuencia: FrecuenciaUI;
  frecuenciaEnPalabras: string;
  desde: string;
  hasta: string | null;
  source: "PROFILE_TEMPLATE" | "MANUAL";
  sourceLevel: NivelDependencia | null;
  motivo: string | null;
  motivoDeCierre: string | null;
  /** Los tres avisos de ámbar. Ninguno es un error. */
  controlDesactivado: boolean;
  turnoDesconocido: boolean;
  momentoDesconocido: boolean;
}

export interface ControlDisponible {
  code: string;
  nombre: string;
  layer: Capa;
  nature: Naturaleza;
  puedeElegir: { frecuencias: TipoDeFrecuencia[] };
  frecuenciaPropuesta: FrecuenciaUI;
}

export interface OcurrenciaDeHoy {
  controlCode: string;
  nombre: string;
  layer: Capa | null;
  at: string;
  until: string | null;
  esFranja: boolean;
  shiftCode: string | null;
  momentCode: string | null;
}

export const CAPA_LABEL: Record<Capa, string> = {
  EXEC: "Lo que se hace",
  OBS: "Cómo está hoy",
  MEASURE: "Constantes",
  SCALE: "Escalas",
  EVENT: "Eventos",
};

/**
 * La explicación de cada capa, para la cabecera de su bloque.
 *
 * Va en la pantalla porque «capa de ejecución» no significa nada para
 * nadie: lo que la dirección necesita leer es qué clase de pregunta es.
 */
export const CAPA_AYUDA: Record<Capa, string> = {
  EXEC: "¿Se hizo? Un sí/no, o cuánto comió. Es casi todo lo que se apunta en un turno.",
  OBS: "¿Cómo está hoy? Un toque en «como siempre» da por buenas todas, y sólo se despliega lo que se desvía.",
  MEASURE: "Cuánto. Con su unidad y lo que se considera normal.",
  SCALE: "Barthel, Lobo, Tinetti, Norton. Todavía no están en el sistema.",
  EVENT: "Lo que el sistema detecta solo. Todavía no está en el sistema.",
};

export const NATURALEZA_LABEL: Record<Naturaleza, string> = {
  SCHEDULED: "Programado",
  ON_DEMAND: "A demanda",
  DERIVED: "Lo detecta el sistema",
};

export const DOMINIO_LABEL: Record<DominioDeValor, string> = {
  BOOL: "Sí / no",
  ORDINAL: "Opciones",
  NUMERIC: "Número",
  SCORE: "Puntuación",
  TEXT_SHORT: "Texto corto",
};

export const FRECUENCIA_LABEL: Record<TipoDeFrecuencia, string> = {
  EVERY_SHIFT: "Cada turno",
  DAILY: "Una vez al día",
  MOMENTS: "En momentos del día",
  EVERY_N_HOURS: "Cada N horas",
  WEEKDAYS: "Días de la semana",
  EVERY_N_DAYS: "Cada N días",
  MONTHLY: "Una vez al mes",
  ON_DEMAND: "A demanda",
};

export const DIAS_SEMANA_UI: Array<{ iso: number; corto: string }> = [
  { iso: 1, corto: "L" },
  { iso: 2, corto: "M" },
  { iso: 3, corto: "X" },
  { iso: 4, corto: "J" },
  { iso: 5, corto: "V" },
  { iso: 6, corto: "S" },
  { iso: 7, corto: "D" },
];

/**
 * Las horas que la pantalla ofrece para «cada N horas».
 *
 * Sólo DIVISORES de 24, aunque el servidor acepta de 1 a 12. La razón está
 * en `queToca`: las ocurrencias van ancladas a medianoche, así que con un
 * 5 o un 7 el último hueco del día sale más corto que los demás. Con un
 * divisor, la planta se gira a las mismas horas todos los días y el parte
 * de relevo se lee de un golpe.
 */
export const HORAS_OFRECIDAS = [2, 3, 4, 6, 8, 12];

/**
 * La frecuencia en una frase.
 *
 * Es la misma función que el servidor usa (`frecuenciaEnPalabras` del
 * paquete `residencia-plan`), copiada aquí para que la pantalla pueda
 * pintar lo que el usuario está eligiendo ANTES de guardarlo —cuando
 * todavía no ha pasado por el servidor—. El servidor manda la suya ya
 * compuesta en el plan de un residente, y ésta sólo se usa en los
 * selectores.
 */
export function frecuenciaCorta(
  f: FrecuenciaUI,
  turnos: TurnoCorto[],
  momentos: MomentoDelDia[],
): string {
  const nombreTurno = (c: string) => turnos.find((t) => t.code === c)?.name ?? c;
  const nombreMomento = (c: string) => momentos.find((m) => m.code === c)?.name ?? c;
  switch (f.kind) {
    case "EVERY_SHIFT":
      return `Cada turno (${(f.shiftCodes ?? []).map(nombreTurno).join(", ") || "—"})`;
    case "DAILY":
      return `Una vez al día (${nombreTurno((f.shiftCodes ?? [])[0] ?? "—")})`;
    case "MOMENTS":
      return `En ${(f.momentCodes ?? []).map(nombreMomento).join(", ") || "—"}`;
    case "EVERY_N_HOURS":
      return `Cada ${f.everyNHours ?? "—"} h, también de noche`;
    case "WEEKDAYS": {
      const dias = [...(f.weekdays ?? [])]
        .sort((a, b) => a - b)
        .map((d) => DIAS_SEMANA_UI.find((x) => x.iso === d)?.corto ?? d);
      return `${dias.join("·") || "—"} (${nombreTurno((f.shiftCodes ?? [])[0] ?? "—")})`;
    }
    case "EVERY_N_DAYS":
      return f.everyNDays === 1
        ? `Todos los días (${nombreTurno((f.shiftCodes ?? [])[0] ?? "—")})`
        : `Cada ${f.everyNDays ?? "—"} días (${nombreTurno((f.shiftCodes ?? [])[0] ?? "—")})`;
    case "MONTHLY":
      return `El día ${f.monthDay ?? "—"} de cada mes (${nombreTurno((f.shiftCodes ?? [])[0] ?? "—")})`;
    case "ON_DEMAND":
      return "A demanda (no tiene agenda)";
  }
}

/** La hora de pared de un instante, para pintar una ocurrencia. */
export function horaDe(iso: string): string {
  return new Intl.DateTimeFormat("es-ES", {
    timeZone: "Europe/Madrid",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}
