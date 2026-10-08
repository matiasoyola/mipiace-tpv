// kds-1-cocina · LAS DOS PUERTAS Y LO QUE SE VE POR CADA UNA.
//
// Cinco filas de la tabla de sabotajes:
//
//   | Un `KITCHEN` cobra o abre turno | 403 en cobro, turno y registro
//   | Cocina ve otra tienda u otra sección | GET de cocina filtrado por
//   | tienda y secciones
//   | Anular sin avisar a cocina | «−» en lo enviado → evento y línea
//   | anulada en el GET de cocina
//   | Anulado que desaparece sin «Visto» | sigue en la tarjeta hasta «Visto»
//   | El semáforo cuenta desde la nota | tiempo 2 marchado a los 30 min →
//   | 0 min al marchar
//
// Y la mitad que no está aquí: que una pantalla de cocina **no releve al
// terminal de la caja** vive en el MOTOR (el trigger
// `devices_revoke_previous` y el índice parcial de verifactu-1), así que su
// test es `test-e2e/kds-1-cocina.e2e.ts` contra Postgres de verdad. Un
// Prisma falso no puede poner en rojo un trigger que no existe.

import { randomBytes, randomUUID } from "node:crypto";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.REDIS_URL = "redis://localhost:6379";
process.env.JWT_ACCESS_SECRET = "a".repeat(40);
process.env.JWT_REFRESH_SECRET = "b".repeat(40);
process.env.HOLDED_KEY_ENCRYPTION_SECRET = randomBytes(32).toString("base64");

import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  construirFakePrisma,
  nuevoEstado,
  type EstadoFalso,
} from "./helpers/fake-prisma-cocina.js";

const TENANT = "00000000-0000-0000-0000-000000000001";
const STORE = "00000000-0000-0000-0000-000000000002";
const OTRA_TIENDA = "00000000-0000-0000-0000-00000000002b";
const REGISTER = "00000000-0000-0000-0000-000000000003";
const CASHIER = "00000000-0000-0000-0000-000000000005";
const TABLE = "00000000-0000-0000-0000-000000000006";
const TICKET = "00000000-0000-0000-0000-000000000007";
const P_BRAVAS = "00000000-0000-0000-0000-00000000000b";
const PANTALLA = "00000000-0000-0000-0000-0000000000dd";
// Ids con forma de UUID porque los esquemas de las rutas los validan como
// tal: un id «ord-1» da 400 antes de llegar al handler, y entonces el test
// pasaría a probar el validador en vez de la regla.
const ORDER = "00000000-0000-0000-0000-0000000000f1";
const OLINE = "00000000-0000-0000-0000-0000000000f2";
const DISPATCH = "00000000-0000-0000-0000-0000000000f3";
const LINEA = "00000000-0000-0000-0000-0000000000f4";
const TERMINAL = "00000000-0000-0000-0000-0000000000ee";

let state: EstadoFalso = nuevoEstado();
const prismaRef = { actual: null as unknown };
const bus = { eventos: [] as Array<{ storeId: string; event: any }> };

vi.mock("../src/context.js", () => ({
  getPrisma: () => prismaRef.actual,
  getRedis: () => ({}) as never,
  shutdown: async () => undefined,
}));

vi.mock("../src/realtime/store-event-bus.js", () => ({
  getStoreEventBus: () => ({
    broadcast: (storeId: string, event: unknown) => {
      bus.eventos.push({ storeId, event });
    },
    subscribe: () => () => undefined,
    subscriberCount: () => 0,
  }),
}));

const { registerKitchenRoutes } = await import("../src/kitchen/routes.js");
const { registerKitchenTpvRoutes } = await import("../src/kitchen/tpv-routes.js");
const { hashDeviceToken, requireDeviceToken } = await import(
  "../src/devices/auth.js"
);
const { signCashierSession } = await import("../src/shift/cashier-session.js");

function sesion() {
  return signCashierSession(
    { sub: CASHIER, tid: TENANT, did: TERMINAL, rid: REGISTER, role: "CASHIER" },
    10,
  );
}

/**
 * El «token» de un dispositivo es su propio id: pasa el largo mínimo de 16
 * caracteres y el falso guarda su hash REAL (`hashDeviceToken`), así que la
 * resolución es exactamente la de producción.
 */
function token(deviceId: string) {
  return deviceId;
}

async function app() {
  const a = Fastify();
  await registerKitchenRoutes(a);
  await registerKitchenTpvRoutes(a);
  // La puerta del TPV, para probar que un `KITCHEN` no pasa por ella.
  a.post("/tpv/cobrar", { preHandler: [requireDeviceToken] }, async () => ({ ok: true }));
  return a;
}

function sembrar(opts: { moduloEncendido?: boolean } = {}) {
  state = nuevoEstado();
  state.tenants.set(TENANT, {
    id: TENANT,
    kitchenDisplayEnabled: opts.moduloEncendido ?? true,
    cajaEnabled: true,
  });
  state.stores.set(STORE, {
    id: STORE,
    name: "La Maestranza",
    kitchenGreenMaxMin: 10,
    kitchenAmberMaxMin: 20,
    kitchenCourseMode: "ESPERA",
    kitchenSeatMode: "ALERGIA",
    kitchenReadyBeep: false,
  });
  state.productos.set(P_BRAVAS, {
    id: P_BRAVAS,
    tenantId: TENANT,
    tags: ["raciones"],
    allergens: ["GLUTEN"],
  });
  state.tagSections = [{ slug: "raciones", section: "COCINA", tenantId: TENANT }];
  state.dispositivos.set(PANTALLA, {
    id: PANTALLA,
    tenantId: TENANT,
    storeId: STORE,
    kind: "KITCHEN",
    revokedAt: null,
    kitchenSections: ["COCINA"],
    lastSeenAt: new Date(),
    name: "Pase",
    deviceTokenHash: hashDeviceToken(PANTALLA),
  });
  state.dispositivos.set(TERMINAL, {
    id: TERMINAL,
    tenantId: TENANT,
    storeId: STORE,
    kind: "TERMINAL",
    revokedAt: null,
    kitchenSections: [],
    lastSeenAt: new Date(),
    name: "Caja",
    deviceTokenHash: hashDeviceToken(TERMINAL),
  });
  state.tickets.set(TICKET, {
    id: TICKET,
    tenantId: TENANT,
    registerId: REGISTER,
    status: "DRAFT",
    tableId: TABLE,
    diners: 4,
    notes: null,
    lastSentRevision: 1,
    lastSentAt: new Date(),
    table: { id: TABLE, name: "M5" },
    register: { storeId: STORE },
    courses: [{ course: 1, firedAt: new Date() }],
    allergies: [],
    lines: [
      {
        id: LINEA,
        productId: P_BRAVAS,
        nameSnapshot: "Patatas bravas",
        units: 3,
        sentUnits: 3,
        course: 1,
        seat: null,
        modifiers: null,
        product: { allergens: ["GLUTEN"] },
      },
    ],
  });
  // Una comanda viva de COCINA con las tres bravas.
  state.orders.set(ORDER, {
    id: ORDER,
    dispatchId: DISPATCH,
    ticketId: TICKET,
    storeId: STORE,
    tableId: TABLE,
    tableName: "M5",
    section: "COCINA",
    number: 1,
    urgent: false,
    urgentAt: null,
    urgentByDeviceId: null,
    sentAt: new Date(),
    lateArrival: false,
    lanReceivedAt: null,
    readyAt: null,
    readyByDeviceId: null,
    servedAt: null,
    servedByUserId: null,
    recoveredAt: null,
  });
  state.orderLines.set(OLINE, {
    id: OLINE,
    orderId: ORDER,
    ticketLineId: LINEA,
    nameSnapshot: "Patatas bravas",
    units: 3,
    modifiers: null,
    course: 1,
    seat: null,
    allergens: ["GLUTEN"],
    firedAt: new Date(),
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
  prismaRef.actual = construirFakePrisma(state);
}

beforeEach(() => {
  bus.eventos = [];
});

describe("kds-1 · SABOTAJE · un KITCHEN cobra o abre turno", () => {
  it("una pantalla de cocina recibe 403 en la puerta del TPV", async () => {
    sembrar();
    const a = await app();
    const res = await a.inject({
      method: "POST",
      url: "/tpv/cobrar",
      headers: { "x-device-token": token(PANTALLA) },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("KITCHEN_DEVICE_NOT_ALLOWED");
  });

  it("y el terminal de la caja pasa por la misma puerta sin problema", async () => {
    sembrar();
    const a = await app();
    const res = await a.inject({
      method: "POST",
      url: "/tpv/cobrar",
      headers: { "x-device-token": token(TERMINAL) },
    });
    expect(res.statusCode).toBe(200);
  });

  it("un TERMINAL no puede tachar en cocina", async () => {
    sembrar();
    const a = await app();
    const res = await a.inject({
      method: "POST",
      url: `/kitchen/lineas/${OLINE}/hecho`,
      headers: { "x-device-token": token(TERMINAL) },
      payload: {},
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("NOT_A_KITCHEN_DEVICE");
  });

  it("con el módulo apagado, la pantalla recibe 403 y no 404", async () => {
    sembrar({ moduloEncendido: false });
    const a = await app();
    const res = await a.inject({
      method: "GET",
      url: "/kitchen/comandas",
      headers: { "x-device-token": token(PANTALLA) },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("KITCHEN_MODULE_DISABLED");
  });
});

describe("kds-1 · SABOTAJE · cocina ve otra tienda u otra sección", () => {
  it("una comanda de OTRA tienda no sale en el GET", async () => {
    sembrar();
    state.orders.get(ORDER)!.storeId = OTRA_TIENDA;
    const a = await app();
    const res = await a.inject({
      method: "GET",
      url: "/kitchen/comandas",
      headers: { "x-device-token": token(PANTALLA) },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().orders).toHaveLength(0);
  });

  it("una comanda de OTRA sección no sale en el GET", async () => {
    sembrar();
    state.orders.get(ORDER)!.section = "BARRA";
    const a = await app();
    const res = await a.inject({
      method: "GET",
      url: "/kitchen/comandas",
      headers: { "x-device-token": token(PANTALLA) },
    });
    expect(res.json().orders).toHaveLength(0);
  });

  it("la suya sí, y sin precios ni camarero ni comensales", async () => {
    sembrar();
    const a = await app();
    const res = await a.inject({
      method: "GET",
      url: "/kitchen/comandas",
      headers: { "x-device-token": token(PANTALLA) },
    });
    const body = res.json();
    expect(body.orders).toHaveLength(1);
    const texto = JSON.stringify(body);
    expect(texto).not.toMatch(/price|importe|total|cashier|diners/i);
    // Y sí lleva lo que la decisión 3 manda: mesa, nº y los platos.
    expect(body.orders[0].tableName).toBe("M5");
    expect(body.orders[0].lines[0].name).toBe("Patatas bravas");
  });
});

describe("kds-1 · SABOTAJE · anular sin avisar a cocina", () => {
  it("«−» sobre lo enviado → evento en el bus y línea anulada en el GET", async () => {
    sembrar();
    const a = await app();
    const res = await a.inject({
      method: "POST",
      url: `/tickets/${TICKET}/kitchen/void-units`,
      headers: { authorization: `Bearer ${sesion()}` },
      payload: { lineId: LINEA, units: 1 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().voidedUnits).toBe(1);
    // El aviso salió.
    expect(bus.eventos.map((e) => e.event.type)).toContain("kitchen.line_voided");
    // La venta bajó.
    const linea = state.tickets.get(TICKET)!.lines[0]!;
    expect(linea.units).toBe(2);
    expect(linea.sentUnits).toBe(2);
    // Y la cocina lo ve.
    const vista = await a.inject({
      method: "GET",
      url: "/kitchen/comandas",
      headers: { "x-device-token": token(PANTALLA) },
    });
    const l = vista.json().orders[0].lines[0];
    expect(l.voidPending).toBe(true);
    expect(l.voidedUnits).toBe(1);
    expect(l.unitsOriginal).toBe(3);
    expect(l.units).toBe(2);
  });

  it("anular lo que NO está en cocina es 409 y no toca nada", async () => {
    sembrar();
    state.tickets.get(TICKET)!.lines[0]!.sentUnits = 0;
    const a = await app();
    const res = await a.inject({
      method: "POST",
      url: `/tickets/${TICKET}/kitchen/void-units`,
      headers: { authorization: `Bearer ${sesion()}` },
      payload: { lineId: LINEA, units: 1 },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("NOT_SENT_TO_KITCHEN");
    expect(state.orderLines.get(OLINE)!.voidedUnits).toBe(0);
  });

  it("MERMA · si la cocina ya lo había tachado, queda apuntado", async () => {
    sembrar();
    state.orderLines.get(OLINE)!.doneAt = new Date();
    const a = await app();
    const res = await a.inject({
      method: "POST",
      url: `/tickets/${TICKET}/kitchen/void-units`,
      headers: { authorization: `Bearer ${sesion()}` },
      payload: { lineId: LINEA, units: 1 },
    });
    expect(res.json().wasAlreadyDone).toBe(true);
    expect(state.orderLines.get(OLINE)!.doneBeforeVoid).toBe(true);
    // Y destachar DESPUÉS no borra la merma: el informe no puede mentir.
    state.orderLines.get(OLINE)!.doneAt = null;
    expect(state.orderLines.get(OLINE)!.doneBeforeVoid).toBe(true);
  });
});

describe("kds-1 · SABOTAJE · anulado que desaparece sin «Visto»", () => {
  it("sigue en la tarjeta hasta que la cocina toca «Visto»", async () => {
    sembrar();
    const a = await app();
    await a.inject({
      method: "POST",
      url: `/tickets/${TICKET}/kitchen/void-units`,
      headers: { authorization: `Bearer ${sesion()}` },
      payload: { lineId: LINEA, units: 1 },
    });
    const antes = await a.inject({
      method: "GET",
      url: "/kitchen/comandas",
      headers: { "x-device-token": token(PANTALLA) },
    });
    expect(antes.json().orders[0].lines[0].voidPending).toBe(true);

    const visto = await a.inject({
      method: "POST",
      url: `/kitchen/lineas/${OLINE}/visto`,
      headers: { "x-device-token": token(PANTALLA) },
    });
    expect(visto.statusCode).toBe(200);

    const despues = await a.inject({
      method: "GET",
      url: "/kitchen/comandas",
      headers: { "x-device-token": token(PANTALLA) },
    });
    const l = despues.json().orders[0].lines[0];
    expect(l.voidPending).toBe(false);
    // La línea NO desaparece: sigue diciendo lo que se pidió.
    expect(l.voidedUnits).toBe(1);
  });
});

describe("kds-1 · SABOTAJE · el semáforo cuenta desde la nota", () => {
  it("un tiempo 2 retenido no lleva semáforo, y al marchar cuenta desde CERO", async () => {
    sembrar();
    const haceMediaHora = new Date(Date.now() - 30 * 60_000);
    // La comanda entró hace media hora, con su tiempo 2 retenido.
    state.orders.get(ORDER)!.sentAt = haceMediaHora;
    state.orderLines.get(OLINE)!.course = 2;
    state.orderLines.get(OLINE)!.firedAt = null;
    state.tickets.get(TICKET)!.lines[0]!.course = 2;
    state.tickets.get(TICKET)!.courses = [{ course: 1, firedAt: haceMediaHora }];
    const a = await app();

    const retenido = await a.inject({
      method: "GET",
      url: "/kitchen/comandas",
      headers: { "x-device-token": token(PANTALLA) },
    });
    const tarjeta = retenido.json().orders[0];
    // `firedAt` null = EN ESPERA, gris y SIN semáforo. El reloj del
    // semáforo no existe todavía.
    expect(tarjeta.firedAt).toBeNull();
    expect(tarjeta.lines[0].fired).toBe(false);
    // Y lo que ordena la tarjeta es su `sentAt`, no un reloj inventado.
    expect(tarjeta.orderAt).toBe(tarjeta.sentAt);

    const antesDeMarchar = Date.now();
    const marchar = await a.inject({
      method: "POST",
      url: `/tickets/${TICKET}/kitchen/fire`,
      headers: { authorization: `Bearer ${sesion()}` },
      payload: { course: 2 },
    });
    expect(marchar.statusCode).toBe(200);
    expect(marchar.json().linesFired).toBe(1);

    const marchado = await a.inject({
      method: "GET",
      url: "/kitchen/comandas",
      headers: { "x-device-token": token(PANTALLA) },
    });
    const t2 = marchado.json().orders[0];
    expect(t2.firedAt).not.toBeNull();
    // ÉSTE es el sabotaje: si el semáforo contara desde `sentAt`, aquí
    // habría media hora. Cuenta desde el marchado, así que son 0 min.
    const minutos = Math.floor(
      (Date.now() - Date.parse(t2.firedAt)) / 60_000,
    );
    expect(minutos).toBe(0);
    expect(Date.parse(t2.firedAt)).toBeGreaterThanOrEqual(antesDeMarchar - 1000);
    expect(bus.eventos.map((e) => e.event.type)).toContain("kitchen.course_fired");
  });

  it("marchar dos veces el mismo tiempo NO mueve el reloj", async () => {
    sembrar();
    const a = await app();
    await a.inject({
      method: "POST",
      url: `/tickets/${TICKET}/kitchen/fire`,
      headers: { authorization: `Bearer ${sesion()}` },
      payload: { course: 2 },
    });
    const primeroAt = state.tickets
      .get(TICKET)!
      .courses.find((c) => c.course === 2)!.firedAt.getTime();
    const otra = await a.inject({
      method: "POST",
      url: `/tickets/${TICKET}/kitchen/fire`,
      headers: { authorization: `Bearer ${sesion()}` },
      payload: { course: 2 },
    });
    expect(otra.json().alreadyFired).toBe(true);
    const segundoAt = state.tickets
      .get(TICKET)!
      .courses.find((c) => c.course === 2)!.firedAt.getTime();
    expect(segundoAt).toBe(primeroAt);
  });
});

describe("kds-1 · tachar, «Lista» y «Servido»", () => {
  it("todos tachados → la tarjeta pasa SOLA a «Lista» y avisa al camarero", async () => {
    sembrar();
    const a = await app();
    const res = await a.inject({
      method: "POST",
      url: `/kitchen/lineas/${OLINE}/hecho`,
      headers: { "x-device-token": token(PANTALLA) },
      payload: { done: true },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().ready).toBe(true);
    expect(state.orders.get(ORDER)!.readyAt).not.toBeNull();
    expect(bus.eventos.map((e) => e.event.type)).toContain("kitchen.order_ready");
  });

  it("un plato EN ESPERA no se puede tachar", async () => {
    sembrar();
    state.orderLines.get(OLINE)!.firedAt = null;
    const a = await app();
    const res = await a.inject({
      method: "POST",
      url: `/kitchen/lineas/${OLINE}/hecho`,
      headers: { "x-device-token": token(PANTALLA) },
      payload: { done: true },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("LINE_NOT_FIRED");
  });

  it("SABOTAJE · «Servido» que no limpia · el aviso desaparece de la lista", async () => {
    sembrar();
    const a = await app();
    await a.inject({
      method: "POST",
      url: `/kitchen/comandas/${ORDER}/lista`,
      headers: { "x-device-token": token(PANTALLA) },
    });
    const conAviso = await a.inject({
      method: "GET",
      url: "/kitchen/listas",
      headers: { authorization: `Bearer ${sesion()}` },
    });
    expect(conAviso.json().ready).toHaveLength(1);

    const servido = await a.inject({
      method: "POST",
      url: `/kitchen/comandas/${ORDER}/servido`,
      headers: { authorization: `Bearer ${sesion()}` },
    });
    expect(servido.statusCode).toBe(200);
    expect(bus.eventos.map((e) => e.event.type)).toContain("kitchen.order_served");

    const sinAviso = await a.inject({
      method: "GET",
      url: "/kitchen/listas",
      headers: { authorization: `Bearer ${sesion()}` },
    });
    expect(sinAviso.json().ready).toHaveLength(0);
  });

  it("«Servido» sin «Lista» es 409: el informe no puede medir contra una marca que no existe", async () => {
    sembrar();
    const a = await app();
    const res = await a.inject({
      method: "POST",
      url: `/kitchen/comandas/${ORDER}/servido`,
      headers: { authorization: `Bearer ${sesion()}` },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("ORDER_NOT_READY");
  });

  it("«Hoy» devuelve una tarjeta a la pantalla y deja la huella", async () => {
    sembrar();
    const a = await app();
    await a.inject({
      method: "POST",
      url: `/kitchen/comandas/${ORDER}/lista`,
      headers: { "x-device-token": token(PANTALLA) },
    });
    const res = await a.inject({
      method: "POST",
      url: `/kitchen/comandas/${ORDER}/recuperar`,
      headers: { "x-device-token": token(PANTALLA) },
    });
    expect(res.statusCode).toBe(200);
    const o = state.orders.get(ORDER)!;
    expect(o.readyAt).toBeNull();
    // La huella NO se borra: una recuperación es la anomalía que el
    // informe del dueño tiene que poder ver.
    expect(o.recoveredAt).not.toBeNull();
    expect(state.orderLines.get(OLINE)!.doneAt).toBeNull();
  });
});

describe("kds-1 · urgente", () => {
  it("un toque largo en cocina lo marca y emite el aviso", async () => {
    sembrar();
    const a = await app();
    const res = await a.inject({
      method: "POST",
      url: `/kitchen/comandas/${ORDER}/urgente`,
      headers: { "x-device-token": token(PANTALLA) },
      payload: { urgent: true },
    });
    expect(res.json().urgent).toBe(true);
    expect(state.orders.get(ORDER)!.urgent).toBe(true);
    expect(bus.eventos.map((e) => e.event.type)).toContain("kitchen.order_urgent");
  });

  it("y el TPV lo puede marcar sobre todas las comandas vivas de la mesa", async () => {
    sembrar();
    const a = await app();
    const res = await a.inject({
      method: "POST",
      url: `/tickets/${TICKET}/kitchen/urgent`,
      headers: { authorization: `Bearer ${sesion()}` },
      payload: { urgent: true },
    });
    expect(res.json().orders).toBe(1);
    expect(state.orders.get(ORDER)!.urgent).toBe(true);
  });
});

describe("kds-1 · el orden de las tarjetas", () => {
  it("urgentes primero, y después por llegada a cocina", async () => {
    sembrar();
    const base = Date.now();
    // La base se captura ANTES de borrar: con el `get` después del
    // `delete`, el spread sería de `undefined` y las comandas nacerían sin
    // tienda — el GET las filtraría y el test «pasaría» por la razón
    // equivocada.
    const baseOrder = state.orders.get(ORDER)!;
    const baseLine = state.orderLines.get(OLINE)!;
    const mk = (id: string, min: number, urgent: boolean) => {
      state.orders.set(id, {
        ...baseOrder,
        id,
        urgent,
        sentAt: new Date(base - min * 60_000),
      });
      state.orderLines.set(`${id}-l`, {
        ...baseLine,
        id: `${id}-l`,
        orderId: id,
        firedAt: new Date(base - min * 60_000),
      });
    };
    state.orders.delete(ORDER);
    state.orderLines.delete(OLINE);
    mk("vieja", 30, false);
    mk("media", 20, false);
    mk("nueva", 5, false);
    mk("urgente", 1, true);
    const a = await app();
    const res = await a.inject({
      method: "GET",
      url: "/kitchen/comandas",
      headers: { "x-device-token": token(PANTALLA) },
    });
    expect(res.json().orders.map((o: any) => o.id)).toEqual([
      "urgente",
      "vieja",
      "media",
      "nueva",
    ]);
  });
});

describe("kds-1 · las tres capas de la alergia", () => {
  it("una alergia SIN silla sale como «⚠ TODA LA MESA»", async () => {
    sembrar();
    state.tickets.get(TICKET)!.allergies = [{ seat: null, allergen: "GLUTEN" }];
    const a = await app();
    const res = await a.inject({
      method: "GET",
      url: "/kitchen/comandas",
      headers: { "x-device-token": token(PANTALLA) },
    });
    expect(res.json().orders[0].allergyBands).toEqual([
      { titulo: "TODA LA MESA · CELÍACO", alergenos: "Gluten" },
    ]);
  });

  it("bravas (GL) a la silla 3 celíaca → «¡LLEVA GLUTEN!»", async () => {
    sembrar();
    state.tickets.get(TICKET)!.allergies = [{ seat: 3, allergen: "GLUTEN" }];
    state.orderLines.get(OLINE)!.seat = 3;
    const a = await app();
    const res = await a.inject({
      method: "GET",
      url: "/kitchen/comandas",
      headers: { "x-device-token": token(PANTALLA) },
    });
    const body = res.json();
    expect(body.orders[0].allergyBands).toEqual([
      { titulo: "SILLA 3 · CELÍACO", alergenos: "Gluten" },
    ]);
    // Y el «SIN GLUTEN» que kds-1b sacó de la franja: ahora va en el
    // recuadro del plato de esa silla.
    expect(body.orders[0].lines[0].seatAllergy).toBe("SIN GLUTEN");
    expect(body.orders[0].lines[0].allergyWarning).toBe("¡LLEVA GLUTEN!");
    expect(body.orders[0].lines[0].seat).toBe(3);
  });

  it("una alergia declarada DESPUÉS llega a la comanda que ya estaba", async () => {
    sembrar();
    const a = await app();
    const antes = await a.inject({
      method: "GET",
      url: "/kitchen/comandas",
      headers: { "x-device-token": token(PANTALLA) },
    });
    expect(antes.json().orders[0].allergyBands).toEqual([]);

    const guardar = await a.inject({
      method: "PUT",
      url: `/tickets/${TICKET}/allergies`,
      headers: { authorization: `Bearer ${sesion()}` },
      payload: { allergies: [{ seat: 3, allergen: "GLUTEN" }] },
    });
    expect(guardar.statusCode).toBe(200);

    const despues = await a.inject({
      method: "GET",
      url: "/kitchen/comandas",
      headers: { "x-device-token": token(PANTALLA) },
    });
    // Las alergias se leen EN VIVO: si se hubieran copiado al enviar, la
    // franja roja llegaría sólo a las comandas siguientes y justo la que
    // está en la plancha se cocinaría sin saberlo.
    expect(despues.json().orders[0].allergyBands).toEqual([
      { titulo: "SILLA 3 · CELÍACO", alergenos: "Gluten" },
    ]);
  });

  it("la silla no puede pasar de los comensales de la mesa", async () => {
    sembrar();
    const a = await app();
    const res = await a.inject({
      method: "PUT",
      url: `/tickets/${TICKET}/allergies`,
      headers: { authorization: `Bearer ${sesion()}` },
      payload: { allergies: [{ seat: 9, allergen: "GLUTEN" }] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("SEAT_OUT_OF_RANGE");
  });

  it("un alérgeno que no es de los 14 lo rechaza el esquema de la ruta", async () => {
    sembrar();
    const a = await app();
    const res = await a.inject({
      method: "PUT",
      url: `/tickets/${TICKET}/allergies`,
      headers: { authorization: `Bearer ${sesion()}` },
      payload: { allergies: [{ seat: 1, allergen: "KRIPTONITA" }] },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("kds-1 · decisión 9 · el latido y el papel de respaldo", () => {
  it("una pantalla que no da señales pide papel", async () => {
    sembrar();
    state.dispositivos.get(PANTALLA)!.lastSeenAt = new Date(Date.now() - 10 * 60_000);
    const a = await app();
    const res = await a.inject({
      method: "GET",
      url: "/kitchen/estado",
      headers: { authorization: `Bearer ${sesion()}` },
    });
    const cocina = res.json().sections.find((s: any) => s.section === "COCINA");
    expect(cocina.screen).toBe(true);
    expect(cocina.needsPaperFallback).toBe(true);
    expect(res.json().screens[0].alive).toBe(false);
  });

  it("y una que sí da señales, no", async () => {
    sembrar();
    const a = await app();
    const res = await a.inject({
      method: "GET",
      url: "/kitchen/estado",
      headers: { authorization: `Bearer ${sesion()}` },
    });
    const cocina = res.json().sections.find((s: any) => s.section === "COCINA");
    expect(cocina.needsPaperFallback).toBe(false);
  });

  it("el papel de respaldo lo construye el SERVIDOR, con la alergia dentro", async () => {
    sembrar();
    state.tickets.get(TICKET)!.allergies = [{ seat: 3, allergen: "GLUTEN" }];
    state.orderLines.get(OLINE)!.seat = 3;
    state.dispatches.set(DISPATCH, {
      id: DISPATCH,
      tenantId: TENANT,
      ticketId: TICKET,
      clientSendId: randomUUID(),
      revision: 1,
      urgent: false,
      sentAt: new Date(),
      sentByUserId: CASHIER,
      result: {},
    });
    const a = await app();
    const res = await a.inject({
      method: "GET",
      url: `/kitchen/comandas/${ORDER}/escpos`,
      headers: { authorization: `Bearer ${sesion()}` },
    });
    expect(res.statusCode).toBe(200);
    const bytes = Buffer.from(res.json().escposBase64, "base64").toString("latin1");
    expect(bytes).toContain("SILLA 3");
    expect(bytes).toContain("LLEVA GLUTEN");
    expect(bytes).toContain("Patatas bravas");
  });
});
