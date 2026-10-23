// historia-1 (D-90 a D-96) · **LOS TIPOS Y LAS FRASES DE LA FICHA
// CLÍNICA, EN UN SOLO SITIO.**
//
// Lo que cinco pantallas comparten: la ficha, las ausencias, los días del
// mes, el ingreso de un residente y la lista de ingresos del centro. Van
// aquí y no en cada página por lo mismo que `incidencias-lib.ts` de
// residencia-4: cinco copias de «cómo se lee una clase de alerta» se
// separan a la tercera.
//
// ── Y LO QUE NO ESTÁ AQUÍ ───────────────────────────────────────────
//
// **Ni una regla.** Qué alerta y qué no lo decide
// `alertasDeLaFicha` del paquete puro, en el servidor; cuántos días tiene
// el mes lo decide `diasDelMes`. Esta página sólo pinta lo que llega — y
// que no haya una segunda implementación en el front es lo que hace que
// la banda del admin y la de la puerta no se puedan contradecir.

/** Una alerta de la franja, con sus DOS textos (D-91). */
export interface AlertaDeLaFicha {
  clase: "ALERGIA" | "DIAGNOSTICO" | "DIETA" | "DISPOSITIVO";
  origenId: string | null;
  /** Lo accionable. **Es lo único que llega a la puerta.** */
  frase: string;
  /** El porqué. Sólo el despacho lo ve. */
  detalle: string | null;
}

export interface DiagnosticoDeLaFicha {
  id: string;
  texto: string | null;
  icd10: string | null;
  quirurgico: boolean;
  desde: string;
  resueltoEn: string | null;
  alerta: boolean;
  fraseDeAlerta: string | null;
  retirado: boolean;
  retiradoEn: string | null;
  motivoDeRetirada: string | null;
  firmadoPor: string;
  firmadoComo: string;
  escritoEn: string;
}

export interface AlergiaDeLaFicha {
  id: string;
  clase: "MEDICAMENTO" | "ALIMENTO" | "OTRA";
  gravedad: "LEVE" | "MODERADA" | "GRAVE";
  agente: string | null;
  reaccion: string | null;
  retirada: boolean;
  retiradaEn: string | null;
  motivoDeRetirada: string | null;
  firmadoPor: string;
  firmadoComo: string;
  escritoEn: string;
}

export interface RevisionDeAlergias {
  id: string;
  sinAlergiasConocidas: boolean;
  fuente: string | null;
  revisadoEn: string;
  revisadoPor: string;
  revisadoComo: string;
}

export interface DispositivoDeLaFicha {
  id: string;
  code: string;
  nombre: string;
  detalle: string | null;
  desde: string;
  hasta: string | null;
  deRiesgo: boolean;
  firmadoPor: string;
  firmadoComo: string;
}

export interface DietaDeLaFicha {
  id: string;
  version: number;
  textura: "NORMAL" | "BLANDA" | "TRITURADA" | "ENTERAL";
  espesante: boolean;
  nivelDeEspesante: number | null;
  restricciones: string[];
  notas: string | null;
  vigente: boolean;
  jubiladaEn: string | null;
  firmadoPor: string;
  firmadoComo: string;
  escritoEn: string;
}

export interface FichaClinica {
  clientId: string;
  alertas: AlertaDeLaFicha[];
  diagnosticos: DiagnosticoDeLaFicha[];
  alergias: AlergiaDeLaFicha[];
  /** `null` = **a este residente nadie le ha preguntado por sus
   *  alergias**. No es lo mismo que «no tiene» (D-90). */
  revisionDeAlergias: RevisionDeAlergias | null;
  dispositivos: DispositivoDeLaFicha[];
  dietas: DietaDeLaFicha[];
}

/** El catálogo del producto, que la pantalla pide una vez. */
export interface CatalogoDeLaFicha {
  dispositivos: Array<{ code: string; nombre: string; deRiesgo: boolean }>;
  restricciones: Array<{ code: string; nombre: string }>;
  texturas: string[];
  clasesDeAlergia: string[];
  gravedades: string[];
}

export interface AusenciaDeLaFicha {
  id: string;
  tipo:
    | "INGRESO_HOSPITALARIO"
    | "URGENCIAS"
    | "VACACIONES_FAMILIA"
    | "CONSULTA_EXTERNA"
    | "SALIDA_NO_CONTROLADA";
  desde: string;
  finPrevisto: string | null;
  hasta: string | null;
  abierta: boolean;
  destino: string | null;
  motivo: string | null;
  pideRevision: boolean;
  revisadaEn: string | null;
  revisadaPor: string | null;
  revisadaComo: string | null;
  incidentId: string | null;
  corregidaEn: string | null;
  motivoDeCorreccion: string | null;
  firmadaPor: string;
  firmadaComo: string;
}

export interface DiasDelMes {
  mes: string;
  clientId: string;
  ordinarios: number;
  hospital: number;
  vacaciones: number;
  otros: number;
  presencia: number;
}

export interface ElementoDelIngreso {
  code: string;
  nombre: string;
  auto: boolean;
  adjunto: boolean;
  hecho: boolean;
  porque: string | null;
  dueOn: string | null;
  vencido: boolean;
  hechoEn: string | null;
  hechoPor: string | null;
  hechoComo: string | null;
  nota: string | null;
  tieneFichero: boolean;
}

export interface IngresoDeUnResidente {
  clientId: string;
  nombre: string;
  ingreso: string;
  elementos: ElementoDelIngreso[];
  pendientes: number;
  vencidos: number;
}

// ── LAS FRASES ──────────────────────────────────────────────────────

export const NOMBRE_DE_LA_CLASE_DE_ALERTA: Record<
  AlertaDeLaFicha["clase"],
  string
> = {
  ALERGIA: "Alergia",
  DIAGNOSTICO: "Diagnóstico",
  DIETA: "Dieta",
  DISPOSITIVO: "Dispositivo",
};

export const NOMBRE_DE_LA_CLASE_DE_ALERGIA: Record<string, string> = {
  MEDICAMENTO: "Medicamento",
  ALIMENTO: "Alimento",
  OTRA: "Otra",
};

export const NOMBRE_DE_LA_GRAVEDAD: Record<string, string> = {
  LEVE: "Leve",
  MODERADA: "Moderada",
  GRAVE: "Grave",
};

export const NOMBRE_DE_LA_TEXTURA: Record<string, string> = {
  NORMAL: "Normal",
  BLANDA: "Blanda",
  TRITURADA: "Triturada",
  ENTERAL: "Enteral",
};

/**
 * Los cinco tipos de ausencia. **Espejo de `NOMBRE_DE_LA_AUSENCIA` del
 * paquete puro**, y lo mismo que `relevo-lib.ts` hace con las clases de
 * línea del parte: un test lo vigila (`residencia-5-frases.test.ts` tiene
 * el patrón).
 */
export const NOMBRE_DE_LA_AUSENCIA: Record<
  AusenciaDeLaFicha["tipo"],
  string
> = {
  INGRESO_HOSPITALARIO: "ingresado en el hospital",
  URGENCIAS: "en urgencias",
  VACACIONES_FAMILIA: "de salida con la familia",
  CONSULTA_EXTERNA: "en una consulta externa",
  SALIDA_NO_CONTROLADA: "salida no controlada",
};

/** Las cuatro clases de alta (D-96). */
export const NOMBRE_DE_LA_CLASE_DE_ALTA: Record<string, string> = {
  TRASLADO: "Traslado",
  VOLUNTARIA: "Voluntaria",
  FALLECIMIENTO: "Fallecimiento",
  OTRA: "Otra",
};

/** «14 de marzo de 2026», de una fecha «YYYY-MM-DD». */
export function fechaLarga(iso: string): string {
  return new Intl.DateTimeFormat("es-ES", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/Madrid",
  }).format(new Date(`${iso.slice(0, 10)}T12:00:00Z`));
}

/** «14 mar», la de las listas. */
export function fechaCorta(iso: string): string {
  return new Intl.DateTimeFormat("es-ES", {
    day: "numeric",
    month: "short",
    timeZone: "Europe/Madrid",
  }).format(new Date(`${iso.slice(0, 10)}T12:00:00Z`));
}

/** El mes de hoy, «YYYY-MM». El valor por defecto de las dos pantallas
 *  de días. */
export function mesDeHoy(): string {
  return new Date().toISOString().slice(0, 7);
}

/** «octubre de 2026», de un «YYYY-MM». */
export function mesEnPalabras(mes: string): string {
  return new Intl.DateTimeFormat("es-ES", {
    month: "long",
    year: "numeric",
    timeZone: "Europe/Madrid",
  }).format(new Date(`${mes}-15T12:00:00Z`));
}

/** El mes anterior y el siguiente, para los dos botones de la pantalla de
 *  días. Aritmética de calendario y no de milisegundos, por lo mismo que
 *  `addDays` del paquete puro. */
export function mesDesplazado(mes: string, meses: number): string {
  const anio = Number(mes.slice(0, 4));
  const n = Number(mes.slice(5, 7));
  const d = new Date(Date.UTC(anio, n - 1 + meses, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
