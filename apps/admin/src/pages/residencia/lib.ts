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
