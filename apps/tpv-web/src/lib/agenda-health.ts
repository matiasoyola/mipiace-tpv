// B-reservas-9 · El panel de salud y la matriz, del lado del TPV.
//
// El front NO calcula ninguna cifra: el servidor manda la cifra, la
// explicación en lenguaje llano y la consulta literal que la produce
// (ADR-F3). Aquí sólo se pide, se guarda la última foto y se pinta.
//
// La última foto tiene su hora, y ésa es la que se enseña cuando la red
// falla: un panel de diagnóstico que se queda en blanco porque no hay red
// deja de diagnosticar justo cuando más falta hace. Se sigue pudiendo leer,
// con el aviso de que es de antes.

import { apiWithCashier } from "../api.js";

export type HealthCardKey =
  | "servicios-sin-profesional"
  | "duracion-fuera-de-patron"
  | "saldo-vivo-sin-cita"
  | "filtrado-por-reglas"
  | "citas-por-canal-24h"
  | "ventanas-fuera-de-turno";

export interface HealthCardItem {
  id: string;
  label: string;
  detail: string | null;
}

export interface HealthCardDependency {
  block: string;
  what: string;
}

export interface HealthCard {
  key: HealthCardKey;
  title: string;
  /** Plural y singular: la cifra 1 no se lee "1 servicios". */
  unit: string;
  unitOne: string;
  status: "ok" | "unavailable";
  /** null SIEMPRE que `status !== "ok"`. Nunca un cero de relleno. */
  value: number | null;
  items: HealthCardItem[];
  goodNews: string;
  explain: string;
  query: string;
  params: string[];
  dependsOn: HealthCardDependency | null;
  unavailableReason: string | null;
}

export interface AgendaHealth {
  generatedAt: string;
  cards: HealthCard[];
}

/** La tarjeta nº 1: la que costó dos semanas de diagnóstico. */
export const CARD_SIN_PROFESIONAL: HealthCardKey = "servicios-sin-profesional";

// ── La última foto ────────────────────────────────────────────────────

const SNAPSHOT_KEY = "agenda.health.snapshot.v1";

export interface HealthSnapshot {
  health: AgendaHealth;
  /** ISO del momento en que esta foto llegó del servidor. */
  fetchedAt: string;
}

export function readHealthSnapshot(): HealthSnapshot | null {
  try {
    const raw = localStorage.getItem(SNAPSHOT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as HealthSnapshot;
    return parsed.health?.cards ? parsed : null;
  } catch {
    return null;
  }
}

function writeHealthSnapshot(snapshot: HealthSnapshot): void {
  try {
    localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snapshot));
  } catch {
    // Sin almacenamiento se vive: sólo se pierde la última foto.
  }
}

/** Pide las seis tarjetas y guarda la foto con su hora. */
export async function fetchAgendaHealth(): Promise<HealthSnapshot> {
  const health = await apiWithCashier<AgendaHealth>("/agenda/health");
  const snapshot: HealthSnapshot = {
    health,
    fetchedAt: new Date().toISOString(),
  };
  writeHealthSnapshot(snapshot);
  return snapshot;
}

// ── La matriz servicio × profesional ──────────────────────────────────

export interface MatrixService {
  id: string;
  name: string;
  agendable: boolean;
  active: boolean;
  staffRequired: number;
  staffUserIds: string[];
}

export interface MatrixStaff {
  userId: string;
  displayName: string;
  active: boolean;
  hasProfile: boolean;
}

export interface SkillMatrix {
  services: MatrixService[];
  staff: MatrixStaff[];
  /** Si esta sesión puede escribir. La cajera lee; no edita. */
  editable: boolean;
}

export function fetchSkillMatrix(): Promise<SkillMatrix> {
  return apiWithCashier<SkillMatrix>("/agenda/skill-matrix");
}

/** Lado A · desde el profesional: qué servicios da. */
export async function saveStaffSkills(
  userId: string,
  serviceIds: string[],
): Promise<string[]> {
  const res = await apiWithCashier<{ serviceIds: string[] }>(
    `/agenda/skill-matrix/staff/${userId}`,
    { method: "PUT", body: { serviceIds } },
  );
  return res.serviceIds;
}

/** Lado B · desde el servicio: quién lo da. */
export async function saveServiceStaff(
  serviceId: string,
  staffUserIds: string[],
): Promise<string[]> {
  const res = await apiWithCashier<{ staffUserIds: string[] }>(
    `/agenda/skill-matrix/service/${serviceId}`,
    { method: "PUT", body: { staffUserIds } },
  );
  return res.staffUserIds;
}

// ── Helpers de pintado ────────────────────────────────────────────────

/** Cuántos servicios no puede hacer nadie, o null si no se sabe. */
export function serviciosSinNadie(health: AgendaHealth | null): number | null {
  const card = health?.cards.find((c) => c.key === CARD_SIN_PROFESIONAL);
  return card && card.status === "ok" ? card.value : null;
}

/** "3 servicios" / "1 servicio": el plural lo decide la cifra. */
export function unidad(card: HealthCard): string {
  return card.value === 1 ? card.unitOne : card.unit;
}

/** "13:40" en hora del centro, para decir de cuándo es la última foto. */
export function fotoHora(iso: string): string {
  return new Intl.DateTimeFormat("es-ES", {
    timeZone: "Europe/Madrid",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}
