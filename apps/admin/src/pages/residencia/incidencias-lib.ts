// residencia-4 · los tipos del libro, compartidos por las tres pantallas
// del admin (el libro, la ficha y la configuración de guardia).
//
// En un fichero aparte por lo mismo que `residencia/lib.ts` de
// residencia-2: tres pantallas que leen el mismo endpoint y cada una con
// su copia del tipo acaban siendo tres tipos distintos.

export type Nivel = "N0" | "N1" | "N2" | "N3" | "N4";
export type Sujeto = "RESIDENT" | "COMPLAINT" | "MAINTENANCE";
export type Canal = "ENFERMERIA" | "RESPONSABLE";

export interface Capacidad {
  assignmentId: string;
  code: string;
  category: string;
}

export interface AvisoEnLaLista {
  canal: Canal;
  estado: string;
  acusadoPor: string | null;
  acusadoEn: string | null;
}

export interface IncidenciaEnLaLista {
  id: string;
  sujeto: Sujeto;
  origen: "DECLARED" | "DERIVED_THRESHOLD" | "DERIVED_ABSENCE";
  tipo: string;
  nombreDelTipo: string;
  nivel: Nivel;
  nombreDelNivel: string;
  abierta: boolean;
  abiertaEn: string;
  cerradaEn: string | null;
  autocierre: boolean;
  avisadoEn: string | null;
  careDay: string;
  residente: { id: string | null; nombre: string } | null;
  habitacion: string | null;
  abiertaPor: string;
  abiertaComo: string;
  acciones: number;
  constanciasDeFamilia: number;
  avisos: AvisoEnLaLista[];
}

export interface AccionDeLaFicha {
  id: string;
  clase: "NOTE" | "EVIDENCE" | "SEVERITY" | "ALERT" | "CALL" | "CLOSE";
  texto: string | null;
  nivelDesde: Nivel | null;
  nivelHasta: Nivel | null;
  registroId: string | null;
  llamado: boolean | null;
  en: string;
  por: string;
  como: string;
}

export interface ComunicacionDeLaFicha {
  id: string;
  clase: "COMUNICADO" | "NO_COMUNICADO";
  via: "TELEFONO" | "PRESENCIAL" | "EMAIL" | "OTRA" | null;
  contacto: string | null;
  parentesco: string | null;
  contenido: string | null;
  respuesta: string | null;
  en: string;
  por: string;
  como: string;
}

export interface FichaDeIncidencia {
  id: string;
  sujeto: Sujeto;
  origen: string;
  tipo: string;
  nombreDelTipo: string;
  nivel: Nivel;
  nombreDelNivel: string;
  versionDeLaPlantilla: number | null;
  abierta: boolean;
  descripcion: string | null;
  residente: { id: string | null; nombre: string } | null;
  habitacion: { numero: string; nombre: string | null } | null;
  turno: string | null;
  careDay: string;
  abiertaEn: string;
  abiertaPor: string;
  abiertaComo: string;
  cerradaEn: string | null;
  cerradaPor: string | null;
  cerradaComo: string | null;
  autocierre: boolean;
  avisadoEn: string | null;
  medida: { id: string; control: string; en: string } | null;
  acciones: AccionDeLaFicha[];
  familia: ComunicacionDeLaFicha[];
  avisos: Array<{
    id: string;
    canal: Canal;
    nivel: Nivel;
    estado: string;
    apuntadoEn: string;
    salidoEn: string;
    entregadoEn: string | null;
    acusadoEn: string | null;
    acusadoPor: string | null;
    acusadoComo: string | null;
    escalado: boolean;
  }>;
  enlaces: Array<{
    enlaceId: string;
    id: string;
    sujeto: Sujeto;
    tipo: string;
    nombreDelTipo: string;
    nivel: Nivel;
    abierta: boolean;
  }>;
  capacidades: Capacidad[];
  puedeCerrarse: boolean;
}

export interface ReglaDeLaPlantilla {
  id: string;
  clase: "THRESHOLD" | "EVENT";
  control: string | null;
  comparador: "GTE" | "GT" | "LTE" | "LT" | null;
  valor: number | null;
  evento: string | null;
  matiz: string | null;
  nivel: Nivel;
  nombreDelNivel: string;
  tipo: string;
  nombreDelTipo: string;
}

export interface PlantillaDeGravedad {
  version: number;
  vigenteDesde: string | null;
  reglas: ReglaDeLaPlantilla[];
  niveles: Array<{ nivel: Nivel; nombre: string }>;
  destinatarios: Partial<Record<Nivel, Canal[]>>;
  minutosDeEscalado: number;
}

export interface ConfiguracionDeGuardia {
  minutosDeEscalado: number;
  destinatarios: Record<"N2" | "N3" | "N4", Canal[]>;
  servicio: { nombre: string; telefono: string } | null;
  moviles: Array<{
    id: string;
    nombre: string | null;
    canal: Canal | null;
    emparejadoEn: string;
    vistoEn: string | null;
    revocado: boolean;
    deGuardia: { nombre: string; desde: string } | null;
  }>;
}

export interface ExcepcionDeUmbral {
  id: string;
  control: string;
  motivo: string | null;
  desde: string;
  hasta: string | null;
  revocadaEn: string | null;
  firmadaEn: string;
  firmadaPor: string;
  firmadaComo: string;
  reglas: Array<{
    comparador: "GTE" | "GT" | "LTE" | "LT";
    valor: number;
    nivel: Nivel;
    tipo: string;
  }>;
}

/** El color del chip de un nivel. Rojo sólido sólo para N4: si N3 y N4 se
 *  pintaran igual, la lista de abiertas no distinguiría «hay que decidir
 *  algo» de «llama al 112». */
export function colorDelNivel(nivel: Nivel): string {
  switch (nivel) {
    case "N4":
      return "bg-red-600 text-white";
    case "N3":
      return "bg-red-100 text-red-800";
    case "N2":
      return "bg-amber-100 text-amber-800";
    case "N1":
      return "bg-slate-100 text-slate-700";
    default:
      return "bg-slate-100 text-slate-500";
  }
}

export function nombreDelSujeto(s: Sujeto): string {
  switch (s) {
    case "RESIDENT":
      return "Residente";
    case "COMPLAINT":
      return "Queja";
    default:
      return "Avería";
  }
}

export function nombreDelOrigen(o: string): string {
  switch (o) {
    case "DERIVED_THRESHOLD":
      return "la derivó una constante";
    case "DERIVED_ABSENCE":
      return "la derivó una ausencia";
    default:
      return "declarada";
  }
}

export function nombreDelCanal(c: Canal): string {
  return c === "ENFERMERIA" ? "Enfermería" : "Dirección";
}

export function fechaYHora(iso: string): string {
  return new Date(iso).toLocaleString("es-ES", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * El estado de un aviso, en castellano.
 *
 * El bucle visual lo encontró en el libro: la fila decía «sin acusar
 * (pending)». El enum es del esquema y no de la pantalla, y un estado en
 * inglés y en minúsculas delante de quien dirige el centro no explica
 * nada — y «escalated» es justo el que hay que entender.
 */
export function nombreDelEstadoDelAviso(estado: string): string {
  switch (estado) {
    case "PENDING":
      return "sin entregar";
    case "DELIVERED":
      return "en el móvil";
    case "ESCALATED":
      return "escalado a dirección";
    case "CANCELLED":
      return "cancelado al cerrar";
    case "ACKED":
      return "acusado";
    default:
      return estado.toLowerCase();
  }
}
