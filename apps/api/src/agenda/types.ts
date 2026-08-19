// Tipos compartidos del motor de reservas (B-koibox-4). Vocabulario neutro
// (cliente / profesional / servicio / recurso). El núcleo no se clava a
// "profesional" para que MesaMode caiga encima.

export type AppointmentStatus =
  | "PENDING"
  | "CONFIRMED"
  | "IN_SERVICE"
  | "COMPLETED"
  | "NO_SHOW"
  | "CANCELLED";

export type ReservationSource =
  | "PRESENCIAL"
  | "WEB"
  | "PHONE"
  | "GIFT_REDEMPTION";

export type ReservableType = "STAFF" | "RESOURCE" | "TABLE";

export type ResourceKind = "CABIN" | "ROOM" | "DEVICE";

// Snapshot de scheduling de un servicio (de `service_scheduling`) + sus
// necesidades de recurso. Entrada del motor.
export interface ServiceRequirement {
  serviceId: string;
  durationMin: number;
  bufferBeforeMin: number;
  bufferAfterMin: number;
  staffRequired: number;
  resourceNeeds: Array<{ resourceKind: ResourceKind; qty: number }>;
}

// Franja de plantilla de un profesional (expansión de turnos B3), en hora
// de pared por día.
export interface TemplateSlot {
  userId: string;
  date: string; // YYYY-MM-DD
  startTime: string; // HH:MM
  endTime: string; // HH:MM
}

// Ocupación activa de un recurso (staff o resource) — intervalo en UTC.
export interface Occupancy {
  staffUserId: string | null;
  resourceId: string | null;
  startsAt: Date;
  endsAt: Date;
}

// Bloqueo puntual expandido a intervalo UTC (afecta a un profesional, un
// recurso, o al centro entero).
export interface BlockInterval {
  scope: "CENTER" | "STAFF" | "RESOURCE" | "TABLE";
  staffUserId: string | null;
  resourceId: string | null;
  startsAt: Date;
  endsAt: Date;
}

// Un item pedido en availability/hold: qué servicio y (opcional) el
// profesional fijado.
export interface RequestItem {
  serviceId: string;
  staffUserId?: string | null;
}

// Un hueco factible devuelto por availability. SIN nombres al público: la
// asignación concreta se fija en hold/confirm. `slotStart` es el instante
// UTC de inicio del visit.
export interface Slot {
  start: string; // ISO UTC
  end: string; // ISO UTC
  // Para depuración/UI interna: cuántas combinaciones de staff había. No se
  // exponen los ids concretos.
  options: number;
}

// La asignación concreta calculada por el motor para un hold: por item, qué
// staff (K) y qué recursos, con su intervalo UTC (incluye buffers para
// staff).
export interface PlannedAssignment {
  appointmentItemIndex: number | null; // índice en items[]; null = visit entero
  reservableType: ReservableType;
  staffUserId: string | null;
  resourceId: string | null;
  startsAt: Date;
  endsAt: Date;
}

// Item resuelto para persistir (snapshot + offset).
export interface PlannedItem {
  serviceId: string;
  durationMin: number;
  bufferBeforeMin: number;
  bufferAfterMin: number;
  staffRequired: number;
  sortOrder: number;
  startOffsetMin: number;
}

// Vista de una cita para la API (GET /agenda, detalle).
export interface AppointmentView {
  id: string;
  clientId: string | null;
  status: AppointmentStatus;
  source: ReservationSource;
  start: string; // ISO UTC
  end: string; // ISO UTC
  ticketId: string | null;
  notes: string | null;
  items: Array<{
    id: string;
    serviceId: string;
    durationMin: number;
    sortOrder: number;
    startOffsetMin: number;
  }>;
  assignments: Array<{
    reservableType: ReservableType;
    staffUserId: string | null;
    resourceId: string | null;
  }>;
}
