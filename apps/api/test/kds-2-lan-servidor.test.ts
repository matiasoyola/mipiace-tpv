// kds-2-wifi · LO QUE EL SERVIDOR PONE, Y LO QUE RECOGE DESPUÉS.
//
// Cinco filas de la tabla de sabotajes de este bloque:
//
//   | Quitar el descarte por id                  → una sola comanda
//   | Al volver internet, duplicar               → cada comanda una vez y
//   |                                              los tachados con su hora
//   | Pisar la hora de cocina con la del TPV     → el `doneAt` es el de la
//   |                                              tablet
//   | Clave sin rotar al revocar                 → la mitad que se puede
//   |                                              probar sin Postgres
//   | Abrir el servidor local en un TERMINAL     → ídem
//
// Las dos últimas viven en el MOTOR (el trigger `stores_rotate_lan_key` y
// el CHECK `devices_kitchen_lan_solo_cocina`), así que aquí se prueba el
// lado del código —que el servidor reemite la clave cuando el trigger la
// borró, y que un terminal no anuncia puerto— y el motor se prueba en
// `test-e2e/kds-2-wifi.e2e.ts`.

import { randomBytes, randomUUID } from "node:crypto";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.REDIS_URL = "redis://localhost:6379";
process.env.JWT_ACCESS_SECRET = "a".repeat(40);
process.env.JWT_REFRESH_SECRET = "b".repeat(40);
process.env.HOLDED_KEY_ENCRYPTION_SECRET = randomBytes(32).toString("base64");

import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PUERTO_LAN_POR_DEFECTO } from "@mipiacetpv/kitchen-lan";

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
const P_BRAVAS = "00000000-0000-0000-0000-00000000000b";
const PANTALLA = "00000000-0000-0000-0000-0000000000dd";
const TERMINAL = "00000000-0000-0000-0000-0000000000ee";
const LINEA = "00000000-0000-0000-0000-0000000000f4";
const ENVIO = "00000000-0000-0000-0000-0000000000aa";

let state: EstadoFalso = nuevoEstado();
const prismaRef = { actual: null as unknown };

vi.mock("../src/context.js", () => ({
  getPrisma: () => prismaRef.actual,
  getRedis: () => ({}) as never,
  shutdown: async () => undefined,
}));

vi.mock("../src/realtime/store-event-bus.js", () => ({
  getStoreEventBus: () => ({
    broadcast: () => undefined,
    subscribe: () => () => undefined,
    subscriberCount: () => 0,
  }),
}));

const { registerKitchenRoutes } = await import("../src/kitchen/routes.js");
const { registerKitchenTpvRoutes } = await import("../src/kitchen/tpv-routes.js");
const { enviarComanda } = await import("../src/kitchen/envio.js");
const { hashDeviceToken } = await import("../src/devices/auth.js");
const { signCashierSession } = await import("../src/shift/cashier-session.js");

function sesion() {
  return signCashierSession(
    { sub: CASHIER, tid: TENANT, did: TERMINAL, rid: REGISTER, role: "CASHIER" },
    10,
  );
}

async function app() {
  const a = Fastify();
  await registerKitchenRoutes(a);
  await registerKitchenTpvRoutes(a);
  return a;
}

function sembrar() {
  state = nuevoEstado();
  state.tenants.set(TENANT, {
    id: TENANT,
    kitchenDisplayEnabled: true,
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
    lastSentRevision: 0,
    lastSentAt: null,
    table: { id: TABLE, name: "M5" },
    register: { storeId: STORE },
    courses: [],
    allergies: [],
    lines: [
      {
        id: LINEA,
        productId: P_BRAVAS,
        nameSnapshot: "Patatas bravas",
        units: 2,
        sentUnits: 0,
        course: 1,
        seat: null,
        modifiers: null,
        product: { allergens: ["GLUTEN"] },
      },
    ],
  });
  prismaRef.actual = construirFakePrisma(state);
}

beforeEach(sembrar);

const ctx = { tenantId: TENANT, registerId: REGISTER, cashierId: CASHIER };

describe("kds-2 · la clave de la tienda", () => {
  it("nace cuando la pantalla la pide, y es la MISMA en los dos lados", async () => {
    const a = await app();
    const me = await a.inject({
      method: "GET",
      url: "/kitchen/me",
      headers: { "x-device-token": PANTALLA },
    });
    expect(me.statusCode).toBe(200);
    const clave = me.json().lan.key as string;
    expect(clave).toHaveLength(43);
    expect(me.json().lan.port).toBe(PUERTO_LAN_POR_DEFECTO);

    // El terminal recibe la misma: dos claves distintas en la misma tienda
    // serían dos cocinas que no se oyen.
    const estado = await a.inject({
      method: "GET",
      url: "/kitchen/estado",
      headers: { authorization: `Bearer ${sesion()}` },
    });
    expect(estado.json().lan.key).toBe(clave);
  });

  it("no cambia entre dos peticiones (sólo la rota el trigger)", async () => {
    const a = await app();
    const una = await a.inject({
      method: "GET",
      url: "/kitchen/me",
      headers: { "x-device-token": PANTALLA },
    });
    const otra = await a.inject({
      method: "GET",
      url: "/kitchen/me",
      headers: { "x-device-token": PANTALLA },
    });
    expect(otra.json().lan.key).toBe(una.json().lan.key);
  });

  it("SABOTAJE · clave sin rotar: borrada en la base, nace OTRA", async () => {
    const a = await app();
    const una = await a.inject({
      method: "GET",
      url: "/kitchen/me",
      headers: { "x-device-token": PANTALLA },
    });
    // Lo que hace el trigger `stores_rotate_lan_key` al revocar un aparato.
    (state.stores.get(STORE) as Record<string, unknown>).kitchenLanKey = null;
    const otra = await a.inject({
      method: "GET",
      url: "/kitchen/me",
      headers: { "x-device-token": PANTALLA },
    });
    expect(otra.json().lan.key).not.toBe(una.json().lan.key);
  });

  it("un bar SIN pantalla de cocina no recibe clave", async () => {
    state.dispositivos.delete(PANTALLA);
    const a = await app();
    const estado = await a.inject({
      method: "GET",
      url: "/kitchen/estado",
      headers: { authorization: `Bearer ${sesion()}` },
    });
    expect(estado.json().lan).toBeNull();
  });
});

describe("kds-2 · dónde escucha la pantalla", () => {
  it("el latido anuncia IP y puerto, y el estado se los da al TPV", async () => {
    const a = await app();
    const latido = await a.inject({
      method: "POST",
      url: "/kitchen/latido",
      headers: { "x-device-token": PANTALLA },
      payload: { lanIp: "192.168.1.44", lanPort: 8787, lanListening: true },
    });
    expect(latido.statusCode).toBe(200);
    expect(latido.json().lan.key).toHaveLength(43);

    const estado = await a.inject({
      method: "GET",
      url: "/kitchen/estado",
      headers: { authorization: `Bearer ${sesion()}` },
    });
    const pantalla = estado.json().screens[0];
    expect(pantalla.lanIp).toBe("192.168.1.44");
    expect(pantalla.lanPort).toBe(8787);
    expect(pantalla.lanAt).not.toBeNull();
  });

  it("sin puerto, el del protocolo", async () => {
    const a = await app();
    await a.inject({
      method: "POST",
      url: "/kitchen/latido",
      headers: { "x-device-token": PANTALLA },
      payload: { lanIp: "192.168.1.44" },
    });
    expect(state.dispositivos.get(PANTALLA)!.kitchenLanPort).toBe(
      PUERTO_LAN_POR_DEFECTO,
    );
  });

  it("`lanListening: false` BORRA lo anunciado: ahí ya no hay nadie", async () => {
    const a = await app();
    await a.inject({
      method: "POST",
      url: "/kitchen/latido",
      headers: { "x-device-token": PANTALLA },
      payload: { lanIp: "192.168.1.44" },
    });
    await a.inject({
      method: "POST",
      url: "/kitchen/latido",
      headers: { "x-device-token": PANTALLA },
      payload: { lanIp: "192.168.1.44", lanListening: false },
    });
    const d = state.dispositivos.get(PANTALLA)!;
    expect(d.kitchenLanIp).toBeNull();
    expect(d.kitchenLanPort).toBeNull();
  });

  it("SABOTAJE · un TERMINAL no puede anunciar puerto: no tiene esa ruta", async () => {
    const a = await app();
    const res = await a.inject({
      method: "POST",
      url: "/kitchen/latido",
      headers: { "x-device-token": TERMINAL },
      payload: { lanIp: "192.168.1.9", lanPort: 8787 },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("NOT_A_KITCHEN_DEVICE");
    expect(state.dispositivos.get(TERMINAL)!.kitchenLanIp ?? null).toBeNull();
  });

  it("un puerto privilegiado se rechaza en el esquema, no en la base", async () => {
    const a = await app();
    const res = await a.inject({
      method: "POST",
      url: "/kitchen/latido",
      headers: { "x-device-token": PANTALLA },
      payload: { lanIp: "192.168.1.44", lanPort: 80 },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("kds-2 · AL VOLVER INTERNET, SIN DUPLICAR", () => {
  it("el mismo envío por los dos caminos deja UNA comanda", async () => {
    // Por la wifi no pasa por aquí (la tablet lo guarda en memoria). Lo que
    // se prueba es el otro lado del descarte: el terminal sube su envío con
    // el MISMO `clientSendId` que mandó por la wifi, y el servidor no crea
    // una segunda tarjeta.
    const uno = await enviarComanda(TICKET, ctx, { clientSendId: ENVIO });
    const dos = await enviarComanda(TICKET, ctx, { clientSendId: ENVIO });
    expect(uno.kind).toBe("ok");
    expect(dos.kind).toBe("ok");
    if (dos.kind !== "ok") return;
    expect(dos.body.replayed).toBe(true);
    expect(state.orders.size).toBe(1);
    expect([...state.orderLines.values()]).toHaveLength(1);
  });

  it("los tachados de la tablet suben con SU hora y una sola vez", async () => {
    await enviarComanda(TICKET, ctx, { clientSendId: ENVIO });
    const a = await app();
    const marcado = new Date("2026-10-09T13:05:00.000Z");
    const marca = {
      markId: randomUUID(),
      kind: "HECHO" as const,
      clientSendId: ENVIO,
      section: "COCINA" as const,
      ticketLineId: LINEA,
      done: true,
      at: marcado.toISOString(),
    };
    const primera = await a.inject({
      method: "POST",
      url: "/kitchen/sincronizar",
      headers: { "x-device-token": PANTALLA },
      payload: { marcas: [marca], recibidas: [ENVIO] },
    });
    expect(primera.statusCode).toBe(200);
    expect(primera.json()).toMatchObject({ guardadas: 1, aplicadas: 1 });

    const linea = [...state.orderLines.values()][0]!;
    expect(linea.doneAt?.toISOString()).toBe(marcado.toISOString());
    expect(linea.doneByDeviceId).toBe(PANTALLA);

    // SABOTAJE · subir dos veces el mismo servicio.
    const segunda = await a.inject({
      method: "POST",
      url: "/kitchen/sincronizar",
      headers: { "x-device-token": PANTALLA },
      payload: { marcas: [marca], recibidas: [ENVIO] },
    });
    expect(segunda.json().guardadas).toBe(0);
    expect(state.marcas.size).toBe(1);
  });

  it("la comanda que ya tenía por la wifi NO se marca como «llegó tarde»", async () => {
    await enviarComanda(TICKET, ctx, { clientSendId: ENVIO });
    const order = [...state.orders.values()][0]!;
    order.lateArrival = true;
    const a = await app();
    await a.inject({
      method: "POST",
      url: "/kitchen/sincronizar",
      headers: { "x-device-token": PANTALLA },
      payload: { recibidas: [ENVIO] },
    });
    expect(order.lanReceivedAt).not.toBeNull();
    expect(order.lateArrival).toBe(false);
  });

  it("una marca que llega ANTES que su envío la aplica el envío", async () => {
    const a = await app();
    const marcado = new Date("2026-10-09T13:05:00.000Z");
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
            section: "COCINA",
            at: marcado.toISOString(),
          },
        ],
      },
    });
    // Sin tarjeta todavía: se guarda y queda pendiente.
    expect(res.json()).toMatchObject({ guardadas: 1, aplicadas: 0, pendientes: 1 });

    await enviarComanda(TICKET, ctx, { clientSendId: ENVIO });
    const order = [...state.orders.values()][0]!;
    expect(order.readyAt?.toISOString()).toBe(marcado.toISOString());
    expect(order.readyByDeviceId).toBe(PANTALLA);
    expect([...state.marcas.values()][0]!.appliedAt).not.toBeNull();
  });
});

describe("kds-2 · el libro sólo acepta marcas DE COCINA", () => {
  // La decisión 9 reparte: cocina manda en el tachado, «Lista» y «Visto»;
  // el TPV en envíos, anulaciones, marchas, urgentes y «Servido». Si la
  // ruta aceptara un `kind` cualquiera, una tablet podría subir un
  // «URGENTE» con su hora y pisar lo que dijo el camarero.
  it("un `kind` que no es de cocina se rechaza en el esquema de la ruta", async () => {
    const a = await app();
    const res = await a.inject({
      method: "POST",
      url: "/kitchen/sincronizar",
      headers: { "x-device-token": PANTALLA },
      payload: {
        marcas: [
          {
            markId: randomUUID(),
            kind: "URGENTE",
            clientSendId: ENVIO,
            section: "COCINA",
            at: new Date().toISOString(),
          },
        ],
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it("y los tres que sí son de cocina pasan", async () => {
    const a = await app();
    for (const kind of ["HECHO", "VISTO", "LISTA"] as const) {
      const res = await a.inject({
        method: "POST",
        url: "/kitchen/sincronizar",
        headers: { "x-device-token": PANTALLA },
        payload: {
          marcas: [
            {
              markId: randomUUID(),
              kind,
              clientSendId: ENVIO,
              section: "COCINA",
              ...(kind === "LISTA"
                ? {}
                : { ticketLineId: LINEA, ...(kind === "HECHO" ? { done: true } : {}) }),
              at: new Date().toISOString(),
            },
          ],
        },
      });
      expect(res.statusCode).toBe(200);
    }
  });
});

describe("kds-2 · QUIÉN MANDA EN CADA ESTADO", () => {
  it("SABOTAJE · la hora del TPV no pisa la de cocina en un tachado", async () => {
    await enviarComanda(TICKET, ctx, { clientSendId: ENVIO });
    const a = await app();
    const enCocina = new Date("2026-10-09T13:05:00.000Z");
    await a.inject({
      method: "POST",
      url: "/kitchen/sincronizar",
      headers: { "x-device-token": PANTALLA },
      payload: {
        marcas: [
          {
            markId: randomUUID(),
            kind: "HECHO",
            clientSendId: ENVIO,
            section: "COCINA",
            ticketLineId: LINEA,
            done: true,
            at: enCocina.toISOString(),
          },
        ],
      },
    });
    // El TPV anula una unidad DESPUÉS. Toca lo suyo (`voidedUnits`,
    // `doneBeforeVoid`) y no toca `doneAt`: la hora de cocina es de cocina.
    const anulado = await a.inject({
      method: "POST",
      url: "/tickets/" + TICKET + "/kitchen/void-units",
      headers: { authorization: `Bearer ${sesion()}` },
      payload: { lineId: LINEA, units: 1 },
    });
    expect(anulado.statusCode).toBe(200);
    const linea = [...state.orderLines.values()][0]!;
    expect(linea.doneAt?.toISOString()).toBe(enCocina.toISOString());
    expect(linea.doneBeforeVoid).toBe(true);
  });

  it("entre dos marcas de cocina gana la más NUEVA, suban en el orden que sea", async () => {
    await enviarComanda(TICKET, ctx, { clientSendId: ENVIO });
    const a = await app();
    const tachado = new Date("2026-10-09T13:05:00.000Z");
    const destachado = new Date("2026-10-09T13:07:00.000Z");
    // Se suben al revés de como pasaron: primero el destachado.
    await a.inject({
      method: "POST",
      url: "/kitchen/sincronizar",
      headers: { "x-device-token": PANTALLA },
      payload: {
        marcas: [
          {
            markId: randomUUID(),
            kind: "HECHO",
            clientSendId: ENVIO,
            section: "COCINA",
            ticketLineId: LINEA,
            done: false,
            at: destachado.toISOString(),
          },
          {
            markId: randomUUID(),
            kind: "HECHO",
            clientSendId: ENVIO,
            section: "COCINA",
            ticketLineId: LINEA,
            done: true,
            at: tachado.toISOString(),
          },
        ],
      },
    });
    // El resultado es el del destachado, que es lo último que pasó.
    expect([...state.orderLines.values()][0]!.doneAt).toBeNull();
  });

  it("un «Lista» de cocina no se pisa con una hora POSTERIOR", async () => {
    await enviarComanda(TICKET, ctx, { clientSendId: ENVIO });
    const a = await app();
    const temprano = new Date("2026-10-09T13:05:00.000Z");
    const tarde = new Date("2026-10-09T13:40:00.000Z");
    const lista = (at: Date) => ({
      markId: randomUUID(),
      kind: "LISTA" as const,
      clientSendId: ENVIO,
      section: "COCINA" as const,
      at: at.toISOString(),
    });
    await a.inject({
      method: "POST",
      url: "/kitchen/sincronizar",
      headers: { "x-device-token": PANTALLA },
      payload: { marcas: [lista(temprano), lista(tarde)] },
    });
    // La primera vez que estuvo lista es la que cuenta para el tiempo de
    // cocina del informe del dueño.
    expect([...state.orders.values()][0]!.readyAt?.toISOString()).toBe(
      temprano.toISOString(),
    );
  });
});
