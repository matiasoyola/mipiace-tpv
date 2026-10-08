// kds-1-cocina · el Prisma falso de los tests de cocina.
//
// Hermano de `agenda-fake-store.ts` y por la misma razón: lo que se prueba
// aquí son REGLAS (la diferencia, la idempotencia, los destinos, la regla
// por destino), y una regla se prueba con números, no con una base.
//
// Lo que NO se prueba con esto, y está dicho en el `-done`: todo lo que
// vive en el MOTOR —el trigger `devices_revoke_previous`, los CHECK, el
// índice parcial de las alergias— va en `test-e2e/kds-1-cocina.e2e.ts`
// contra un Postgres de verdad. Un Prisma falso no puede poner en rojo un
// CHECK que no existe.

import { Prisma } from "@mipiacetpv/db";
import { vi } from "vitest";

/**
 * El prototipo que `instanceof Prisma.PrismaClientKnownRequestError`
 * reconoce. El falso lanza un P2002 de verdad para que el código de
 * producción lo identifique igual que el de Postgres — que es justo lo que
 * hace que el test de idempotencia pruebe algo.
 */
const PrismaKnownError = Prisma.PrismaClientKnownRequestError;

export type Seccion = "BARRA" | "COCINA" | "SALON";

export interface FakeLinea {
  id: string;
  productId: string | null;
  nameSnapshot: string;
  units: number;
  sentUnits: number;
  course: number;
  seat: number | null;
  modifiers: unknown;
  product?: { allergens: string[] } | null;
}

export interface FakeTicket {
  id: string;
  tenantId: string;
  registerId: string;
  status: "DRAFT" | "PAID";
  tableId: string | null;
  diners: number | null;
  notes: string | null;
  lastSentRevision: number;
  lastSentAt: Date | null;
  table: { id: string; name: string } | null;
  register: { storeId: string };
  lines: FakeLinea[];
  courses: Array<{ course: number; firedAt: Date }>;
  allergies: Array<{ seat: number | null; allergen: string }>;
}

export interface FakeProducto {
  id: string;
  tenantId: string;
  tags: string[];
  allergens?: string[];
}

export interface FakeImpresora {
  id: string;
  registerId: string;
  active: boolean;
  mode: "USB" | "WIFI";
  ipAddress: string | null;
  port: number | null;
  timeoutMs: number;
  section: Seccion | null;
  lastPrintOkAt: Date | null;
  lastErrorAt: Date | null;
  lastErrorMsg: string | null;
}

export interface FakePantalla {
  id: string;
  tenantId: string;
  storeId: string;
  kind: "TERMINAL" | "TEST" | "KITCHEN";
  revokedAt: Date | null;
  kitchenSections: Seccion[];
  lastSeenAt: Date | null;
  name: string | null;
  /**
   * El SHA-256 del token, como lo guarda la columna. Los tests lo rellenan
   * con `hashDeviceToken(...)` de verdad: si el falso inventara un hash
   * propio, el test no probaría el camino que la API usa para resolver un
   * `X-Device-Token`.
   */
  deviceTokenHash: string;
}

export interface FakeDispatch {
  id: string;
  tenantId: string;
  ticketId: string;
  clientSendId: string;
  revision: number;
  urgent: boolean;
  sentAt: Date;
  sentByUserId: string;
  result: unknown;
}

export interface FakeOrderLine {
  id: string;
  orderId: string;
  ticketLineId: string | null;
  nameSnapshot: string;
  units: number;
  modifiers: unknown;
  course: number;
  seat: number | null;
  allergens: string[];
  firedAt: Date | null;
  doneAt: Date | null;
  doneByDeviceId: string | null;
  voidedUnits: number;
  voidedAt: Date | null;
  voidedByUserId: string | null;
  voidSeenAt: Date | null;
  doneBeforeVoid: boolean;
  changedAt: Date | null;
  changeNote: string | null;
  changeSeenAt: Date | null;
}

export interface FakeOrder {
  id: string;
  dispatchId: string;
  ticketId: string;
  storeId: string;
  tableId: string | null;
  tableName: string | null;
  section: Seccion;
  number: number;
  urgent: boolean;
  urgentAt: Date | null;
  urgentByDeviceId: string | null;
  sentAt: Date;
  lateArrival: boolean;
  /** kds-2-wifi · la tablet ya tenía este envío por la wifi. */
  lanReceivedAt: Date | null;
  readyAt: Date | null;
  readyByDeviceId: string | null;
  servedAt: Date | null;
  servedByUserId: string | null;
  recoveredAt: Date | null;
}

/** kds-2-wifi · una fila de `kitchen_lan_marks`. */
export interface FakeMarcaLan {
  markId: string;
  deviceId: string;
  storeId: string;
  kind: "HECHO" | "VISTO" | "LISTA";
  clientSendId: string;
  section: Seccion;
  ticketLineId: string | null;
  done: boolean | null;
  at: Date;
  receivedAt: Date;
  appliedAt: Date | null;
}

export interface EstadoFalso {
  tickets: Map<string, FakeTicket>;
  productos: Map<string, FakeProducto>;
  tagSections: Array<{ slug: string; section: Seccion; tenantId: string }>;
  impresoras: Map<string, FakeImpresora>;
  dispositivos: Map<string, FakePantalla>;
  dispatches: Map<string, FakeDispatch>;
  orders: Map<string, FakeOrder>;
  orderLines: Map<string, FakeOrderLine>;
  /** kds-2-wifi · el libro de marcas de la tablet. */
  marcas: Map<string, FakeMarcaLan>;
  stores: Map<
    string,
    {
      id: string;
      name: string;
      kitchenGreenMaxMin: number;
      kitchenAmberMaxMin: number;
      kitchenCourseMode: "ESPERA" | "TIEMPOS";
      kitchenSeatMode: "ALERGIA" | "SIEMPRE";
      kitchenReadyBeep: boolean;
    }
  >;
  tenants: Map<string, { id: string; kitchenDisplayEnabled: boolean; cajaEnabled: boolean }>;
  /** Ids que el falso reparte, para que los tests puedan predecirlos. */
  seq: number;
}

export function nuevoEstado(): EstadoFalso {
  return {
    tickets: new Map(),
    productos: new Map(),
    tagSections: [],
    impresoras: new Map(),
    dispositivos: new Map(),
    dispatches: new Map(),
    orders: new Map(),
    orderLines: new Map(),
    marcas: new Map(),
    stores: new Map(),
    tenants: new Map(),
    seq: 0,
  };
}

function nextId(state: EstadoFalso, prefijo: string): string {
  state.seq += 1;
  return `${prefijo}-${String(state.seq).padStart(4, "0")}`;
}

/** Un `where` muy reducido, con lo que las rutas de cocina usan de verdad. */
function coincide(valor: unknown, filtro: unknown): boolean {
  if (filtro === undefined) return true;
  if (filtro !== null && typeof filtro === "object") {
    const f = filtro as Record<string, unknown>;
    if ("in" in f) return (f.in as unknown[]).includes(valor);
    if ("not" in f) {
      if (f.not === null) return valor !== null;
      return valor !== f.not;
    }
    if ("gte" in f) return (valor as Date) >= (f.gte as Date);
    if ("gt" in f) return valor != null && (valor as Date) > (f.gt as Date);
  }
  return valor === filtro;
}

export function construirFakePrisma(state: EstadoFalso) {
  const prisma: Record<string, unknown> = {};

  const ticket = {
    findFirst: vi.fn(async ({ where }: any) => {
      const t = state.tickets.get(where.id);
      if (!t) return null;
      if (where.tenantId && t.tenantId !== where.tenantId) return null;
      if (where.status && t.status !== where.status) return null;
      // `GET /tickets/:id/kitchen` pide además las comandas vivas de la
      // mesa en el mismo `select`. Se añaden aquí para que el falso
      // devuelva la MISMA forma y la ruta no tenga que defenderse de un
      // `undefined` que en producción no existe.
      return {
        ...t,
        kitchenOrders: [...state.orders.values()]
          .filter((o) => o.ticketId === t.id && o.servedAt == null)
          .map((o) => ({
            id: o.id,
            section: o.section,
            number: o.number,
            urgent: o.urgent,
            readyAt: o.readyAt,
            tableName: o.tableName,
          })),
      };
    }),
    update: vi.fn(async ({ where, data }: any) => {
      const t = state.tickets.get(where.id);
      if (!t) throw new Error("ticket no está en el falso");
      if (data.lastSentAt !== undefined) t.lastSentAt = data.lastSentAt;
      if (data.lastSentRevision !== undefined) {
        t.lastSentRevision = data.lastSentRevision;
      }
      return t;
    }),
  };

  const ticketLine = {
    update: vi.fn(async ({ where, data }: any) => {
      for (const t of state.tickets.values()) {
        const l = t.lines.find((x) => x.id === where.id);
        if (!l) continue;
        if (data.sentUnits !== undefined) l.sentUnits = Number(data.sentUnits);
        if (data.units !== undefined) l.units = Number(data.units);
        if (data.course !== undefined) l.course = data.course;
        if (data.seat !== undefined) l.seat = data.seat;
        return l;
      }
      throw new Error("línea no está en el falso");
    }),
    updateMany: vi.fn(async ({ where, data }: any) => {
      let count = 0;
      for (const t of state.tickets.values()) {
        if (where.ticketId && t.id !== where.ticketId) continue;
        for (const l of t.lines) {
          if (where.id && l.id !== where.id) continue;
          if (data.course !== undefined) l.course = data.course;
          if (data.seat !== undefined) l.seat = data.seat;
          count += 1;
        }
      }
      return { count };
    }),
    findFirst: vi.fn(async ({ where }: any) => {
      for (const t of state.tickets.values()) {
        if (where.ticketId && t.id !== where.ticketId) continue;
        if (where.ticket?.tenantId && t.tenantId !== where.ticket.tenantId) continue;
        if (where.ticket?.status && t.status !== where.ticket.status) continue;
        const l = t.lines.find((x) => x.id === where.id);
        if (l) {
          return {
            ...l,
            ticket: { id: t.id, tableId: t.tableId, register: t.register },
          };
        }
      }
      return null;
    }),
  };

  const kitchenDispatch = {
    findUnique: vi.fn(async ({ where }: any) => {
      for (const d of state.dispatches.values()) {
        if (d.clientSendId === where.clientSendId) return d;
      }
      return null;
    }),
    create: vi.fn(async ({ data }: any) => {
      for (const d of state.dispatches.values()) {
        if (d.clientSendId === data.clientSendId) {
          // Mismo error que lanzaría Postgres contra el índice único.
          const err = Object.assign(new Error("Unique constraint failed"), {
            code: "P2002",
            clientVersion: "fake",
            meta: { target: ["client_send_id"] },
          });
          Object.setPrototypeOf(err, PrismaKnownError.prototype);
          throw err;
        }
      }
      const id = nextId(state, "disp");
      const d: FakeDispatch = { id, ...data } as FakeDispatch;
      state.dispatches.set(id, d);
      return { id };
    }),
    update: vi.fn(async ({ where, data }: any) => {
      const d = state.dispatches.get(where.id);
      if (!d) throw new Error("dispatch no está en el falso");
      if (data.result !== undefined) d.result = data.result;
      return d;
    }),
  };

  const kitchenOrder = {
    create: vi.fn(async ({ data }: any) => {
      const id = nextId(state, "ord");
      const o: FakeOrder = {
        id,
        dispatchId: data.dispatchId,
        ticketId: data.ticketId,
        storeId: data.storeId,
        tableId: data.tableId ?? null,
        tableName: data.tableName ?? null,
        section: data.section,
        number: data.number,
        urgent: data.urgent ?? false,
        urgentAt: data.urgentAt ?? null,
        urgentByDeviceId: null,
        sentAt: data.sentAt ?? new Date(),
        lateArrival: false,
        lanReceivedAt: null,
        readyAt: null,
        readyByDeviceId: null,
        servedAt: null,
        servedByUserId: null,
        recoveredAt: null,
      };
      state.orders.set(id, o);
      for (const l of data.lines?.create ?? []) {
        const lid = nextId(state, "oln");
        state.orderLines.set(lid, {
          id: lid,
          orderId: id,
          ticketLineId: l.ticketLineId ?? null,
          nameSnapshot: l.nameSnapshot,
          units: Number(l.units),
          modifiers: l.modifiers ?? null,
          course: l.course ?? 1,
          seat: l.seat ?? null,
          allergens: l.allergens ?? [],
          firedAt: l.firedAt ?? null,
          doneAt: null,
          doneByDeviceId: null,
          voidedUnits: 0,
          voidedAt: null,
          voidedByUserId: null,
          voidSeenAt: null,
          doneBeforeVoid: false,
          changedAt: null,
          changeNote: null,
          changeSeenAt: null,
        });
      }
      return { id };
    }),
    findFirst: vi.fn(async ({ where }: any) => {
      for (const o of state.orders.values()) {
        if (where.id && o.id !== where.id) continue;
        if (where.storeId && o.storeId !== where.storeId) continue;
        if (where.section?.in && !where.section.in.includes(o.section)) continue;
        if (where.ticket?.tenantId) {
          const t = state.tickets.get(o.ticketId);
          if (!t || t.tenantId !== where.ticket.tenantId) continue;
        }
        const t = state.tickets.get(o.ticketId);
        const disp = [...state.dispatches.values()].find(
          (d) => d.id === o.dispatchId,
        );
        // Las tres relaciones que las rutas piden en el `select`: el papel
        // de respaldo necesita el ticket (alergias y nota), el envío (quién
        // lo mandó) y las líneas.
        return {
          ...o,
          ticket: {
            diners: t?.diners ?? null,
            notes: t?.notes ?? null,
            allergies: t?.allergies ?? [],
          },
          dispatch: {
            sentBy: { email: "barman@bar.es", alias: "ana" },
            ...(disp ?? {}),
          },
          lines: [...state.orderLines.values()].filter((l) => l.orderId === o.id),
        };
      }
      return null;
    }),
    findMany: vi.fn(async ({ where }: any) => {
      const out: FakeOrder[] = [];
      for (const o of state.orders.values()) {
        if (where?.storeId && o.storeId !== where.storeId) continue;
        if (where?.ticketId && o.ticketId !== where.ticketId) continue;
        if (where?.section?.in && !where.section.in.includes(o.section)) continue;
        // kds-2-wifi · `aplicarMarcasPendientes` busca las tarjetas de UN
        // envío por su `clientSendId`, que vive en el despacho.
        if (where?.dispatch?.clientSendId) {
          const d = state.dispatches.get(o.dispatchId);
          if (!d || !coincide(d.clientSendId, where.dispatch.clientSendId)) continue;
        }
        if (where && "servedAt" in where && !coincide(o.servedAt, where.servedAt)) {
          continue;
        }
        if (where?.readyAt && !coincide(o.readyAt, where.readyAt)) continue;
        if (where?.sentAt && !coincide(o.sentAt, where.sentAt)) continue;
        const t = state.tickets.get(o.ticketId);
        out.push({
          ...o,
          ticket: { allergies: t?.allergies ?? [] },
          lines: [...state.orderLines.values()].filter((l) => l.orderId === o.id),
        } as never);
      }
      return out;
    }),
    update: vi.fn(async ({ where, data }: any) => {
      const o = state.orders.get(where.id);
      if (!o) throw new Error("comanda no está en el falso");
      Object.assign(o, data);
      return o;
    }),
    updateMany: vi.fn(async ({ where, data }: any) => {
      let count = 0;
      for (const o of state.orders.values()) {
        if (where.id && o.id !== where.id) continue;
        if (where.ticketId && o.ticketId !== where.ticketId) continue;
        if (where.storeId && o.storeId !== where.storeId) continue;
        if (where.section?.in && !where.section.in.includes(o.section)) continue;
        if ("servedAt" in where && !coincide(o.servedAt, where.servedAt)) continue;
        if ("lanReceivedAt" in where && !coincide(o.lanReceivedAt, where.lanReceivedAt)) {
          continue;
        }
        if (where.dispatch?.clientSendId) {
          const d = state.dispatches.get(o.dispatchId);
          if (!d || !coincide(d.clientSendId, where.dispatch.clientSendId)) continue;
        }
        // El `OR` de `aplicarMarca`: «no está lista, o lo está con una hora
        // posterior a la de mi marca». Si el falso lo ignorara, el test de
        // «la hora de cocina no se pisa» pasaría sin que el código la
        // respetase.
        if (Array.isArray(where.OR)) {
          const alguna = where.OR.some((rama: any) =>
            Object.entries(rama).every(([campo, filtro]) =>
              coincide((o as never as Record<string, unknown>)[campo], filtro),
            ),
          );
          if (!alguna) continue;
        }
        Object.assign(o, data);
        count += 1;
      }
      return { count };
    }),
    count: vi.fn(async () => state.orders.size),
  };

  const kitchenOrderLine = {
    findFirst: vi.fn(async ({ where }: any) => {
      const l = state.orderLines.get(where.id);
      if (!l) return null;
      const o = state.orders.get(l.orderId);
      if (!o) return null;
      if (where.order?.storeId && o.storeId !== where.order.storeId) return null;
      if (where.order?.section?.in && !where.order.section.in.includes(o.section)) {
        return null;
      }
      return { ...l, order: o };
    }),
    findMany: vi.fn(async ({ where }: any) => {
      const out: FakeOrderLine[] = [];
      for (const l of state.orderLines.values()) {
        if (where?.orderId && l.orderId !== where.orderId) continue;
        if (where?.ticketLineId && l.ticketLineId !== where.ticketLineId) continue;
        if (where && "doneAt" in where && !coincide(l.doneAt, where.doneAt)) continue;
        if (where && "firedAt" in where && !coincide(l.firedAt, where.firedAt)) {
          continue;
        }
        const o = state.orders.get(l.orderId);
        if (where?.order?.servedAt !== undefined && o && !coincide(o.servedAt, where.order.servedAt)) {
          continue;
        }
        out.push(l);
      }
      return out;
    }),
    update: vi.fn(async ({ where, data }: any) => {
      const l = state.orderLines.get(where.id);
      if (!l) throw new Error("línea de comanda no está en el falso");
      Object.assign(l, {
        ...data,
        ...(data.voidedUnits !== undefined
          ? { voidedUnits: Number(data.voidedUnits) }
          : {}),
      });
      return l;
    }),
    updateMany: vi.fn(async ({ where, data }: any) => {
      let count = 0;
      for (const l of state.orderLines.values()) {
        const o = state.orders.get(l.orderId);
        if (where.id && l.id !== where.id) continue;
        if (where.orderId && l.orderId !== where.orderId) continue;
        if (where.ticketLineId && l.ticketLineId !== where.ticketLineId) continue;
        if (where.course !== undefined && l.course !== where.course) continue;
        if ("firedAt" in where && !coincide(l.firedAt, where.firedAt)) continue;
        if (where.order?.ticketId && o?.ticketId !== where.order.ticketId) continue;
        if (where.order && "servedAt" in where.order && o && !coincide(o.servedAt, where.order.servedAt)) {
          continue;
        }
        if (where.order?.storeId && o?.storeId !== where.order.storeId) continue;
        if (where.order?.section?.in && o && !where.order.section.in.includes(o.section)) {
          continue;
        }
        Object.assign(l, data);
        count += 1;
      }
      return { count };
    }),
    count: vi.fn(async ({ where }: any) => {
      const r = await kitchenOrderLine.findMany({ where } as never);
      return (r as unknown[]).length;
    }),
  };

  const ticketCourse = {
    createMany: vi.fn(async ({ data }: any) => {
      let count = 0;
      for (const row of data) {
        const t = state.tickets.get(row.ticketId);
        if (!t) continue;
        if (t.courses.some((c) => c.course === row.course)) continue;
        t.courses.push({ course: row.course, firedAt: row.firedAt ?? new Date() });
        count += 1;
      }
      return { count };
    }),
  };

  const ticketAllergy = {
    deleteMany: vi.fn(async ({ where }: any) => {
      const t = state.tickets.get(where.ticketId);
      const n = t?.allergies.length ?? 0;
      if (t) t.allergies = [];
      return { count: n };
    }),
    createMany: vi.fn(async ({ data }: any) => {
      for (const row of data) {
        const t = state.tickets.get(row.ticketId);
        if (!t) continue;
        t.allergies.push({ seat: row.seat ?? null, allergen: row.allergen });
      }
      return { count: data.length };
    }),
  };

  prisma.ticket = ticket;
  prisma.ticketLine = ticketLine;
  prisma.ticketCourse = ticketCourse;
  prisma.ticketAllergy = ticketAllergy;
  prisma.kitchenDispatch = kitchenDispatch;
  prisma.kitchenOrder = kitchenOrder;
  prisma.kitchenOrderLine = kitchenOrderLine;
  // kds-2-wifi · el libro de marcas. La PK es el `markId` de la tablet, y
  // el falso lanza el MISMO P2002 que Postgres: es lo que hace que el test
  // de «subir dos veces el mismo servicio» pruebe la idempotencia de
  // verdad y no la del falso.
  prisma.kitchenLanMark = {
    create: vi.fn(async ({ data }: any) => {
      if (state.marcas.has(data.markId)) {
        const err = Object.assign(new Error("Unique constraint failed"), {
          code: "P2002",
          clientVersion: "fake",
          meta: { target: ["mark_id"] },
        });
        Object.setPrototypeOf(err, PrismaKnownError.prototype);
        throw err;
      }
      const m: FakeMarcaLan = {
        markId: data.markId,
        deviceId: data.deviceId,
        storeId: data.storeId,
        kind: data.kind,
        clientSendId: data.clientSendId,
        section: data.section,
        ticketLineId: data.ticketLineId ?? null,
        done: data.done ?? null,
        at: new Date(data.at),
        receivedAt: new Date(),
        appliedAt: null,
      };
      state.marcas.set(m.markId, m);
      return m;
    }),
    findMany: vi.fn(async ({ where, orderBy }: any) => {
      let out = [...state.marcas.values()].filter((m) => {
        if (where?.clientSendId && m.clientSendId !== where.clientSendId) return false;
        if (where && "appliedAt" in where && !coincide(m.appliedAt, where.appliedAt)) {
          return false;
        }
        if (where?.storeId && m.storeId !== where.storeId) return false;
        return true;
      });
      if (orderBy?.at === "asc") {
        out = [...out].sort((a, b) => a.at.getTime() - b.at.getTime());
      }
      return out;
    }),
    findFirst: vi.fn(async ({ where }: any) => {
      for (const m of state.marcas.values()) {
        if (where?.kind && m.kind !== where.kind) continue;
        if (where?.ticketLineId && m.ticketLineId !== where.ticketLineId) continue;
        if (where && "appliedAt" in where && !coincide(m.appliedAt, where.appliedAt)) {
          continue;
        }
        if (where?.at && !coincide(m.at, where.at)) continue;
        return m;
      }
      return null;
    }),
    update: vi.fn(async ({ where, data }: any) => {
      const m = state.marcas.get(where.markId);
      if (!m) throw new Error("marca no está en el falso");
      Object.assign(m, data);
      return m;
    }),
    count: vi.fn(async ({ where }: any) => {
      let n = 0;
      for (const m of state.marcas.values()) {
        if (where?.storeId && m.storeId !== where.storeId) continue;
        if (where && "appliedAt" in where && !coincide(m.appliedAt, where.appliedAt)) {
          continue;
        }
        n += 1;
      }
      return n;
    }),
  };
  prisma.product = {
    findMany: vi.fn(async ({ where }: any) => {
      const ids: string[] = where?.id?.in ?? [];
      const out: FakeProducto[] = [];
      for (const id of ids) {
        const p = state.productos.get(id);
        if (!p) continue;
        if (where.tenantId && p.tenantId !== where.tenantId) continue;
        out.push(p);
      }
      return out;
    }),
    findFirst: vi.fn(async ({ where }: any) => state.productos.get(where.id) ?? null),
    update: vi.fn(async ({ where, data }: any) => {
      const p = state.productos.get(where.id);
      if (!p) throw new Error("producto no está en el falso");
      if (data.allergens) p.allergens = data.allergens;
      return p;
    }),
  };
  prisma.tagSection = {
    findMany: vi.fn(async ({ where }: any) =>
      state.tagSections.filter((t) => !where?.tenantId || t.tenantId === where.tenantId),
    ),
  };
  prisma.printerConfig = {
    findMany: vi.fn(async ({ where }: any) => {
      const out: FakeImpresora[] = [];
      for (const p of state.impresoras.values()) {
        if (where.registerId && p.registerId !== where.registerId) continue;
        if (where.active != null && p.active !== where.active) continue;
        if (where.mode && p.mode !== where.mode) continue;
        if (where.section?.not === null && p.section === null) continue;
        out.push(p);
      }
      return out;
    }),
    update: vi.fn(async ({ where, data }: any) => {
      const p = state.impresoras.get(where.id);
      if (!p) throw new Error("impresora no está en el falso");
      Object.assign(p, data);
      return p;
    }),
  };
  prisma.device = {
    findMany: vi.fn(async ({ where }: any) => {
      const out: FakePantalla[] = [];
      for (const d of state.dispositivos.values()) {
        if (where.tenantId && d.tenantId !== where.tenantId) continue;
        if (where.kind && d.kind !== where.kind) continue;
        if ("revokedAt" in where && !coincide(d.revokedAt, where.revokedAt)) continue;
        if (where.register?.storeId && d.storeId !== where.register.storeId) continue;
        out.push({
          ...d,
          register: { id: "r", name: "Caja 1", store: { id: d.storeId, name: "Tienda" } },
        } as never);
      }
      return out;
    }),
    findUnique: vi.fn(async ({ where }: any) => {
      for (const d of state.dispositivos.values()) {
        if (where.deviceTokenHash && where.deviceTokenHash !== d.deviceTokenHash) {
          continue;
        }
        if (where.id && d.id !== where.id) continue;
        const store = state.stores.get(d.storeId);
        const tenant = state.tenants.get(d.tenantId);
        return {
          ...d,
          register: { storeId: d.storeId },
          tenant: { kitchenDisplayEnabled: tenant?.kitchenDisplayEnabled ?? false },
          store,
        };
      }
      return null;
    }),
    update: vi.fn(async ({ where, data }: any) => {
      const d = state.dispositivos.get(where.id);
      if (!d) throw new Error("dispositivo no está en el falso");
      Object.assign(d, data);
      return d;
    }),
    count: vi.fn(async () => state.dispositivos.size),
  };
  prisma.store = {
    findUniqueOrThrow: vi.fn(async ({ where }: any) => {
      const s = state.stores.get(where.id);
      if (!s) throw new Error("tienda no está en el falso");
      return s;
    }),
    findFirst: vi.fn(async ({ where }: any) => state.stores.get(where.id) ?? null),
    update: vi.fn(async ({ where, data }: any) => {
      const s = state.stores.get(where.id);
      if (!s) throw new Error("tienda no está en el falso");
      Object.assign(s, data);
      return s;
    }),
    // kds-2-wifi · `asegurarClaveLan` emite la clave de la tienda con un
    // `updateMany` condicionado a que siga NULL (la carrera de dos
    // pantallas pidiéndola a la vez). El falso respeta la condición: si no
    // la respetara, el test de la carrera pasaría sin que el código la
    // resolviese.
    updateMany: vi.fn(async ({ where, data }: any) => {
      const s = state.stores.get(where.id);
      if (!s) return { count: 0 };
      if (
        Object.prototype.hasOwnProperty.call(where, "kitchenLanKey") &&
        where.kitchenLanKey === null &&
        (s as any).kitchenLanKey != null
      ) {
        return { count: 0 };
      }
      Object.assign(s, data);
      return { count: 1 };
    }),
  };
  prisma.tenant = {
    findUniqueOrThrow: vi.fn(async ({ where }: any) => {
      const t = state.tenants.get(where.id);
      if (!t) throw new Error("tenant no está en el falso");
      return t;
    }),
    findUnique: vi.fn(async ({ where }: any) => state.tenants.get(where.id) ?? null),
  };
  prisma.register = {
    findUniqueOrThrow: vi.fn(async () => ({ storeId: [...state.stores.keys()][0]! })),
  };
  prisma.user = {
    findUniqueOrThrow: vi.fn(async () => ({ email: "barman@bar.es", alias: "ana" })),
  };
  // El `$transaction` del falso corre el callback DIRECTAMENTE con el mismo
  // cliente. No simula atomicidad y está dicho: lo que estos tests
  // comprueban son reglas, y la atomicidad se prueba contra Postgres.
  prisma.$transaction = vi.fn(async (arg: unknown) => {
    if (typeof arg === "function") {
      return (arg as (tx: unknown) => Promise<unknown>)(prisma);
    }
    const out: unknown[] = [];
    for (const p of arg as Promise<unknown>[]) out.push(await p);
    return out;
  });
  return prisma;
}
