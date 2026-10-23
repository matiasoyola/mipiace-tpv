// hierro-sirope (A) · LA COMANDA HUÉRFANA, EN LOS CUATRO SITIOS.
//
// Una comanda huérfana es la de un ticket que ya no está vivo —se cobró o
// se vació— y que sigue sin servir: M5 sale con LISTO en el mapa estando
// libre, la tarjeta espera para siempre en la columna «Listas» del AP11 y
// la banda «M5 · listo para servir» tapa cualquier venta en todos los TPV.
// Nadie la puede apagar porque su ticket ya no existe. Se reprodujo el
// 18-10 (capturas 37–41) y es el estado en el que llevan meses la T6 y M1.
//
// Las filas de la tabla de sabotajes que viven aquí:
//
//   | La regla de A sólo en `routes.ts`, no en `lan.ts` | el banco del
//   | camino LAN
//   | Servir al marcar Lista aunque el ticket siga DRAFT | «mesa viva:
//   | Lista no sirve»
//   | El corte de día deja las no listas | el banco del barrido
//   | El script escribe sin `--apply` | el banco del dry-run
//
// La quinta —«`servedAt` un ms antes que `readyAt`»— vive en el MOTOR (el
// CHECK `kitchen_orders_cronologia`, al que este bloque le añade la mitad
// que le faltaba), así que su sitio es `test-e2e/kds-2b-hierro.e2e.ts`
// contra Postgres de verdad: un Prisma falso no puede poner en rojo un
// CHECK que no existe.

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
const REGISTER = "00000000-0000-0000-0000-000000000003";
const CASHIER = "00000000-0000-0000-0000-000000000005";
const TABLE = "00000000-0000-0000-0000-000000000006";
const TICKET = "00000000-0000-0000-0000-000000000007";
const P_CAFE = "00000000-0000-0000-0000-00000000000b";
const PANTALLA = "00000000-0000-0000-0000-0000000000dd";
const TERMINAL = "00000000-0000-0000-0000-0000000000ee";
const LINEA = "00000000-0000-0000-0000-0000000000f4";
const ENVIO = "00000000-0000-0000-0000-0000000000aa";
const ORDER = "00000000-0000-0000-0000-0000000000f1";
const OLINE = "00000000-0000-0000-0000-0000000000f2";
const DISPATCH = "00000000-0000-0000-0000-0000000000f3";

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
const { hashDeviceToken } = await import("../src/devices/auth.js");
const { runComandasHuerfanasSweep } = await import("../src/kitchen/huerfanas.js");
const { limpiarComandasHuerfanas, planLimpiezaHuerfanas } = await import(
  "../src/kitchen/limpieza-huerfanas.js"
);

async function app() {
  const a = Fastify();
  await registerKitchenRoutes(a);
  return a;
}

const log = { info: () => undefined, error: () => undefined };

function sembrar() {
  state = nuevoEstado();
  state.tenants.set(TENANT, {
    id: TENANT,
    kitchenDisplayEnabled: true,
    cajaEnabled: true,
    dayCutHour: 5,
  });
  state.stores.set(STORE, {
    id: STORE,
    name: "Cafetería Sirope",
    kitchenGreenMaxMin: 10,
    kitchenAmberMaxMin: 20,
    kitchenCourseMode: "ESPERA",
    kitchenSeatMode: "ALERGIA",
    kitchenReadyBeep: false,
  });
  state.productos.set(P_CAFE, {
    id: P_CAFE,
    tenantId: TENANT,
    tags: ["cafe"],
    allergens: [],
  });
  state.tagSections = [{ slug: "cafe", section: "BARRA", tenantId: TENANT }];
  state.dispositivos.set(PANTALLA, {
    id: PANTALLA,
    tenantId: TENANT,
    storeId: STORE,
    kind: "KITCHEN",
    revokedAt: null,
    kitchenSections: ["BARRA"],
    lastSeenAt: new Date(),
    name: "Cocina · Barra",
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
    name: "Caja 2",
    deviceTokenHash: hashDeviceToken(TERMINAL),
  });
  state.tickets.set(TICKET, {
    id: TICKET,
    tenantId: TENANT,
    registerId: REGISTER,
    status: "DRAFT",
    tableId: TABLE,
    diners: 2,
    notes: null,
    lastSentRevision: 0,
    lastSentAt: null,
    table: { id: TABLE, name: "M5" },
    register: { storeId: STORE },
    courses: [],
    allergies: [],
    lines: [
      {
        id: LINEA,
        productId: P_CAFE,
        nameSnapshot: "Café Americano",
        units: 1,
        sentUnits: 0,
        course: 1,
        seat: null,
        modifiers: null,
        product: { allergens: [] },
      },
    ],
  });
  prismaRef.actual = construirFakePrisma(state);
  bus.eventos = [];
}

beforeEach(sembrar);

/**
 * El café de M5, enviado a BARRA y SIN marcar Lista.
 *
 * Se siembra a mano en vez de pasar por `enviarComanda` para que el id de
 * la tarjeta tenga forma de UUID: los esquemas de las rutas lo validan, y
 * con un `ord-1` el test probaría el validador en vez de la regla.
 */
function enviarElCafe() {
  state.dispatches.set(DISPATCH, {
    id: DISPATCH,
    tenantId: TENANT,
    ticketId: TICKET,
    clientSendId: ENVIO,
    revision: 1,
    urgent: false,
    sentAt: new Date(),
    sentByUserId: CASHIER,
    result: null,
  });
  state.orders.set(ORDER, {
    id: ORDER,
    dispatchId: DISPATCH,
    ticketId: TICKET,
    storeId: STORE,
    tableId: TABLE,
    tableName: "M5",
    section: "BARRA",
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
    nameSnapshot: "Café Americano",
    units: 1,
    modifiers: null,
    course: 1,
    seat: null,
    allergens: [],
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
  return state.orders.get(ORDER)!;
}

/** «Vaciar mesa» con motivo Invitación: el ticket deja de estar vivo. */
function vaciarLaMesa() {
  state.tickets.get(TICKET)!.status = "VOIDED";
}

const servidos = () =>
  bus.eventos.filter((e) => e.event.type === "kitchen.order_served");
const listos = () =>
  bus.eventos.filter((e) => e.event.type === "kitchen.order_ready");

describe("hierro-sirope A · al marcar Lista, la huérfana se sirve sola", () => {
  it("camino ONLINE · el botón «Lista» sobre un ticket muerto sirve en el acto", async () => {
    const order = enviarElCafe();
    vaciarLaMesa();
    const a = await app();

    const res = await a.inject({
      method: "POST",
      url: `/kitchen/comandas/${order.id}/lista`,
      headers: { "x-device-token": PANTALLA },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ huerfana: true });
    const o = state.orders.get(order.id)!;
    expect(o.readyAt).not.toBeNull();
    expect(o.servedAt).not.toBeNull();
    // Mismo instante: el CHECK de cronología exige que servir no sea
    // anterior a estar listo, y además es la verdad — no la sirvió nadie.
    expect(o.servedAt!.toISOString()).toBe(o.readyAt!.toISOString());
    // NULL = SISTEMA. No se le atribuye a ningún camarero.
    expect(o.servedByUserId).toBeNull();
  });

  it("y avisa con `kitchen.order_served`, NO con `order_ready`", async () => {
    const order = enviarElCafe();
    vaciarLaMesa();
    const a = await app();
    await a.inject({
      method: "POST",
      url: `/kitchen/comandas/${order.id}/lista`,
      headers: { "x-device-token": PANTALLA },
    });
    // Levantar una banda que nadie puede apagar es el fallo que se está
    // arreglando: la huérfana NO enciende el aviso de «listo para servir».
    expect(listos()).toHaveLength(0);
    expect(servidos()).toHaveLength(1);
    expect(servidos()[0]!.event).toMatchObject({ orderId: order.id });
  });

  it("SABOTAJE · servir al marcar Lista aunque el ticket siga DRAFT", async () => {
    // La mesa VIVE: «Lista» sólo pone `readyAt`, y la banda se enciende
    // para que el camarero vaya a por ello. Servir aquí haría desaparecer
    // el aviso antes de que nadie recogiera nada.
    const order = enviarElCafe();
    const a = await app();
    const res = await a.inject({
      method: "POST",
      url: `/kitchen/comandas/${order.id}/lista`,
      headers: { "x-device-token": PANTALLA },
    });
    expect(res.json()).toMatchObject({ huerfana: false });
    const o = state.orders.get(order.id)!;
    expect(o.readyAt).not.toBeNull();
    expect(o.servedAt).toBeNull();
    expect(listos()).toHaveLength(1);
    expect(servidos()).toHaveLength(0);
  });

  it("camino LAN · el «Lista» que sube la tablet al volver la red, igual", async () => {
    // SABOTAJE · escribir la regla sólo en `routes.ts`. La mesa se vació
    // mientras la tablet estaba sin internet; su marca sube después.
    const order = enviarElCafe();
    vaciarLaMesa();
    const a = await app();
    const marcado = new Date(Date.now() - 60_000);

    const res = await a.inject({
      method: "POST",
      url: "/kitchen/sincronizar",
      headers: { "x-device-token": PANTALLA },
      payload: {
        marcas: [
          {
            markId: randomUUID(),
            kind: "LISTA",
            clientSendId: ENVIO,
            section: "BARRA",
            at: marcado.toISOString(),
          },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ aplicadas: 1 });

    const o = state.orders.get(order.id)!;
    expect(o.readyAt?.toISOString()).toBe(marcado.toISOString());
    // La hora de la tablet, y servida en el mismo instante.
    expect(o.servedAt?.toISOString()).toBe(marcado.toISOString());
    expect(o.servedByUserId).toBeNull();
    expect(servidos()).toHaveLength(1);
  });

  it("camino LAN · con la mesa viva, la marca pone «Lista» y nada más", async () => {
    const order = enviarElCafe();
    const a = await app();
    await a.inject({
      method: "POST",
      url: "/kitchen/sincronizar",
      headers: { "x-device-token": PANTALLA },
      payload: {
        marcas: [
          {
            markId: randomUUID(),
            kind: "LISTA",
            clientSendId: ENVIO,
            section: "BARRA",
            at: new Date().toISOString(),
          },
        ],
      },
    });
    const o = state.orders.get(order.id)!;
    expect(o.readyAt).not.toBeNull();
    expect(o.servedAt).toBeNull();
  });

  it("«Hoy» no puede devolver a la pantalla una comanda sin cuenta", async () => {
    // Deshacer «Lista» borra `readyAt` y `servedAt`: sobre un ticket muerto
    // eso FABRICA una huérfana nueva, que es justo lo que este bloque
    // cierra. Y no tendría sentido operativo: lo que se recupera es un
    // plato que todavía hay que hacer.
    const order = enviarElCafe();
    vaciarLaMesa();
    const a = await app();
    await a.inject({
      method: "POST",
      url: `/kitchen/comandas/${order.id}/lista`,
      headers: { "x-device-token": PANTALLA },
    });

    const res = await a.inject({
      method: "POST",
      url: `/kitchen/comandas/${order.id}/recuperar`,
      headers: { "x-device-token": PANTALLA },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("ORDER_TICKET_CERRADO");
    const o = state.orders.get(order.id)!;
    expect(o.servedAt).not.toBeNull();
  });
});

describe("hierro-sirope A · el barrido del corte de día", () => {
  const HOY = new Date("2026-10-19T12:00:00.000Z");
  /** Antes del corte de las 05:00 de hoy: es «de ayer». */
  const AYER = new Date("2026-10-18T21:30:00.000Z");

  it("sirve la que NUNCA se marcó Lista, con `readyAt = servedAt = ahora`", async () => {
    // SABOTAJE · dejar las no listas. Es el caso que la regla de arriba no
    // tapa: la mesa se vació con el café en la plancha y la cocina no lo
    // tachó nunca (se tira, al fin y al cabo). Al día siguiente seguía en
    // la pantalla.
    const order = enviarElCafe();
    order.sentAt = AYER;
    vaciarLaMesa();

    const r = await runComandasHuerfanasSweep({
      prisma: prismaRef.actual as never,
      log,
      now: HOY,
    });

    expect(r.servidas).toHaveLength(1);
    expect(r.servidas[0]).toMatchObject({ sinMarcar: true, tableName: "M5" });
    const o = state.orders.get(order.id)!;
    expect(o.readyAt?.toISOString()).toBe(HOY.toISOString());
    expect(o.servedAt?.toISOString()).toBe(HOY.toISOString());
    expect(o.servedByUserId).toBeNull();
  });

  it("y la que estaba LISTA conserva su `readyAt`", async () => {
    const order = enviarElCafe();
    order.sentAt = AYER;
    order.readyAt = new Date("2026-10-18T21:40:00.000Z");
    vaciarLaMesa();

    await runComandasHuerfanasSweep({
      prisma: prismaRef.actual as never,
      log,
      now: HOY,
    });

    const o = state.orders.get(order.id)!;
    expect(o.readyAt?.toISOString()).toBe("2026-10-18T21:40:00.000Z");
    expect(o.servedAt?.toISOString()).toBe(HOY.toISOString());
  });

  it("una mesa VIVA no se toca, tenga la edad que tenga", async () => {
    const order = enviarElCafe();
    order.sentAt = AYER;

    const r = await runComandasHuerfanasSweep({
      prisma: prismaRef.actual as never,
      log,
      now: HOY,
    });

    expect(r.servidas).toHaveLength(0);
    expect(r.vivas).toBe(1);
    expect(state.orders.get(order.id)!.servedAt).toBeNull();
  });

  it("y lo de HOY tampoco: el plato puede estar en la plancha ahora mismo", async () => {
    // La otra mitad de la decisión de auditoria-sirope (#22) sigue en pie
    // durante el servicio. El barrido es del corte de día, no un atajo
    // para hacer desaparecer tarjetas.
    const order = enviarElCafe();
    order.sentAt = new Date("2026-10-19T11:50:00.000Z");
    vaciarLaMesa();

    const r = await runComandasHuerfanasSweep({
      prisma: prismaRef.actual as never,
      log,
      now: HOY,
    });

    expect(r.servidas).toHaveLength(0);
    expect(state.orders.get(order.id)!.servedAt).toBeNull();
  });

  it("es idempotente: la segunda pasada no encuentra nada", async () => {
    const order = enviarElCafe();
    order.sentAt = AYER;
    vaciarLaMesa();
    const args = { prisma: prismaRef.actual as never, log, now: HOY };

    expect((await runComandasHuerfanasSweep(args)).servidas).toHaveLength(1);
    expect((await runComandasHuerfanasSweep(args)).servidas).toHaveLength(0);
  });
});

describe("hierro-sirope A · el script de limpieza única", () => {
  const AHORA = new Date("2026-10-19T12:00:00.000Z");
  const HACE_UN_DIA = new Date("2026-10-18T12:00:00.000Z");

  it("SABOTAJE · el script escribe sin `--apply`", async () => {
    const order = enviarElCafe();
    order.sentAt = HACE_UN_DIA;
    vaciarLaMesa();

    const r = await limpiarComandasHuerfanas({
      prisma: prismaRef.actual as never,
      apply: false,
      now: AHORA,
    });

    // Informa de lo que haría…
    expect(r.aServir).toHaveLength(1);
    expect(r.escritas).toBe(0);
    // …y no ha tocado una fila.
    expect(state.orders.get(order.id)!.servedAt).toBeNull();
    expect(state.orders.get(order.id)!.readyAt).toBeNull();
  });

  it("con `--apply` las sirve, y la segunda pasada encuentra 0", async () => {
    const order = enviarElCafe();
    order.sentAt = HACE_UN_DIA;
    vaciarLaMesa();
    const args = { prisma: prismaRef.actual as never, apply: true, now: AHORA };

    const primera = await limpiarComandasHuerfanas(args);
    expect(primera.escritas).toBe(1);
    expect(state.orders.get(order.id)!.servedAt?.toISOString()).toBe(
      AHORA.toISOString(),
    );

    const segunda = await limpiarComandasHuerfanas(args);
    expect(segunda.aServir).toHaveLength(0);
    expect(segunda.escritas).toBe(0);
  });

  it("el resumen reparte por tenant, listas y sin marcar", () => {
    const fila = (over: Partial<Parameters<typeof planLimpiezaHuerfanas>[0][number]>) => ({
      id: randomUUID(),
      ticketId: randomUUID(),
      storeId: STORE,
      tableName: "T6",
      section: "COCINA",
      sentAt: HACE_UN_DIA,
      readyAt: null,
      ticket: { status: "PAID", tenantId: TENANT },
      ...over,
    });
    const plan = planLimpiezaHuerfanas(
      [
        fila({}),
        fila({ readyAt: HACE_UN_DIA }),
        fila({ ticket: { status: "DRAFT", tenantId: TENANT } }),
        fila({ sentAt: AHORA }),
        fila({ ticket: { status: "VOIDED", tenantId: "otro-tenant" } }),
      ],
      { now: AHORA, edadHoras: 6 },
    );
    expect(plan.aServir).toHaveLength(3);
    expect(plan.vivas).toBe(1);
    expect(plan.recientes).toBe(1);
    expect(plan.porTenant).toEqual([
      { tenantId: TENANT, listas: 1, sinMarcar: 1, total: 2 },
      { tenantId: "otro-tenant", listas: 0, sinMarcar: 1, total: 1 },
    ]);
  });

  it("la edad mínima protege a la mesa que se acaba de vaciar", async () => {
    // Una mesa vaciada hace dos minutos con un plato en la plancha no es
    // basura histórica: la cocina lo está haciendo y tiene que verlo.
    const order = enviarElCafe();
    order.sentAt = new Date(AHORA.getTime() - 2 * 60_000);
    vaciarLaMesa();

    const r = await limpiarComandasHuerfanas({
      prisma: prismaRef.actual as never,
      apply: true,
      now: AHORA,
    });
    expect(r.recientes).toBe(1);
    expect(r.escritas).toBe(0);

    // Y con `--edad-horas=0`, que es una decisión que se toma a mano, sí.
    const todo = await limpiarComandasHuerfanas({
      prisma: prismaRef.actual as never,
      apply: true,
      now: AHORA,
      edadHoras: 0,
    });
    expect(todo.escritas).toBe(1);
  });
});
