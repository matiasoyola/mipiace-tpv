// kds-1-cocina · EL ENVÍO POR DIFERENCIAS, y lo que pasa a su alrededor.
//
// Cinco filas de la tabla de sabotajes del bloque viven aquí:
//
//   | Volver a mandar todas las líneas en cada envío | 2 cañas, enviar,
//   | +1 caña, enviar → la 2ª comanda tiene 1 caña
//   | Quitar la idempotencia de `clientSendId` | el mismo envío dos veces
//   | → una sola comanda
//   | Fallar el envío por no tener destino | sección sin pantalla ni
//   | impresora → 200 y línea marcada como enviada
//   | Retener la barra | un tiempo 2 de BARRA sale marchado
//   | −/+ en lo enviado sin pantalla | sección con impresora → sin −/+ en
//   | lo enviado (regla v2-H1)
//
// Este fichero SUSTITUYE a `send-to-kitchen.test.ts` y
// `send-to-kitchen-escpos.test.ts`, que probaban el motor viejo: agrupar
// TODAS las líneas del DRAFT y responder 409 cuando faltaba impresora. Las
// dos cosas cambian a propósito en este bloque, así que aquellos tests no
// se «arreglan» — se reemplazan, y los casos que seguían valiendo (404,
// 403, 400, agrupar por sección, el fallback de PDF) están aquí abajo.

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
const DEVICE = "00000000-0000-0000-0000-000000000004";
const CASHIER = "00000000-0000-0000-0000-000000000005";
const TABLE = "00000000-0000-0000-0000-000000000006";
const TICKET = "00000000-0000-0000-0000-000000000007";
const P_CANA = "00000000-0000-0000-0000-00000000000a";
const P_BRAVAS = "00000000-0000-0000-0000-00000000000b";
const PRINTER_COCINA = "00000000-0000-0000-0000-0000000000bb";
const PANTALLA_COCINA = "00000000-0000-0000-0000-0000000000dd";

let state: EstadoFalso = nuevoEstado();

const tcp = { porHost: new Map<string, number>(), fallan: new Set<string>() };

vi.mock("@mipiacetpv/escpos-builder", async () => {
  const actual =
    await vi.importActual<typeof import("@mipiacetpv/escpos-builder")>(
      "@mipiacetpv/escpos-builder",
    );
  return {
    ...actual,
    sendOverTcp: vi.fn(async (opts: { host: string }) => {
      tcp.porHost.set(opts.host, (tcp.porHost.get(opts.host) ?? 0) + 1);
      if (tcp.fallan.has(opts.host)) throw new Error("ECONNREFUSED test");
    }),
  };
});

const prismaRef = { actual: null as unknown };
vi.mock("../src/context.js", () => ({
  getPrisma: () => prismaRef.actual,
  getRedis: () => ({}) as never,
  shutdown: async () => undefined,
}));

const { registerSendToKitchenRoute } = await import(
  "../src/tickets/send-to-kitchen.js"
);
const { registerSendToKitchenEscposRoute } = await import(
  "../src/tickets/send-to-kitchen-escpos.js"
);
const { registerKitchenTpvRoutes } = await import(
  "../src/kitchen/tpv-routes.js"
);
const { signCashierSession } = await import("../src/shift/cashier-session.js");

function sesion() {
  return signCashierSession(
    { sub: CASHIER, tid: TENANT, did: DEVICE, rid: REGISTER, role: "CASHIER" },
    10,
  );
}

async function app() {
  const a = Fastify();
  await registerSendToKitchenRoute(a);
  await registerSendToKitchenEscposRoute(a);
  await registerKitchenTpvRoutes(a);
  return a;
}

/** La carta mínima: una caña (BARRA) y unas bravas (COCINA). */
function sembrar(opts: {
  /** ¿Hay una pantalla de cocina emparejada? */
  pantalla?: boolean;
  /** ¿Hay impresora WIFI en COCINA? */
  impresoraCocina?: boolean;
  moduloEncendido?: boolean;
  lineas?: Array<{
    id: string;
    productId: string;
    nameSnapshot: string;
    units: number;
    sentUnits?: number;
    course?: number;
    seat?: number | null;
  }>;
} = {}) {
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
  state.productos.set(P_CANA, { id: P_CANA, tenantId: TENANT, tags: ["cervezas"] });
  state.productos.set(P_BRAVAS, {
    id: P_BRAVAS,
    tenantId: TENANT,
    tags: ["raciones"],
    allergens: ["GLUTEN"],
  });
  state.tagSections = [
    { slug: "cervezas", section: "BARRA", tenantId: TENANT },
    { slug: "raciones", section: "COCINA", tenantId: TENANT },
  ];
  if (opts.impresoraCocina) {
    state.impresoras.set(PRINTER_COCINA, {
      id: PRINTER_COCINA,
      registerId: REGISTER,
      active: true,
      mode: "WIFI",
      ipAddress: "10.0.0.31",
      port: 9100,
      timeoutMs: 3000,
      section: "COCINA",
      lastPrintOkAt: null,
      lastErrorAt: null,
      lastErrorMsg: null,
    });
  }
  if (opts.pantalla) {
    state.dispositivos.set(PANTALLA_COCINA, {
      id: PANTALLA_COCINA,
      tenantId: TENANT,
      storeId: STORE,
      kind: "KITCHEN",
      revokedAt: null,
      kitchenSections: ["COCINA"],
      lastSeenAt: new Date(),
      name: "Pase",
      deviceTokenHash: "no-se-usa-en-este-fichero",
    });
  }
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
    lines: (
      opts.lineas ?? [
        { id: "L-CANA", productId: P_CANA, nameSnapshot: "Caña", units: 2 },
        { id: "L-BRAVAS", productId: P_BRAVAS, nameSnapshot: "Patatas bravas", units: 1 },
      ]
    ).map((l) => ({
      id: l.id,
      productId: l.productId,
      nameSnapshot: l.nameSnapshot,
      units: l.units,
      sentUnits: l.sentUnits ?? 0,
      course: l.course ?? 1,
      seat: l.seat ?? null,
      modifiers: null,
      product: state.productos.get(l.productId)
        ? { allergens: state.productos.get(l.productId)!.allergens ?? [] }
        : null,
    })),
  });
  prismaRef.actual = construirFakePrisma(state);
}

async function enviar(
  a: Awaited<ReturnType<typeof app>>,
  body: Record<string, unknown> = {},
) {
  return a.inject({
    method: "POST",
    url: `/tickets/${TICKET}/send-to-kitchen/escpos`,
    headers: { authorization: `Bearer ${sesion()}` },
    payload: body,
  });
}

beforeEach(() => {
  tcp.porHost.clear();
  tcp.fallan.clear();
});

describe("kds-1 · SABOTAJE · volver a mandar todas las líneas en cada envío", () => {
  it("2 cañas, enviar, +1 caña, enviar → la 2ª comanda tiene UNA caña", async () => {
    sembrar({ pantalla: true });
    // La pantalla es de COCINA, así que para ver la caña hace falta que la
    // BARRA también tenga pantalla: se la damos.
    state.dispositivos.get(PANTALLA_COCINA)!.kitchenSections = ["COCINA", "BARRA"];
    const a = await app();

    const primero = await enviar(a, { clientSendId: randomUUID() });
    expect(primero.statusCode).toBe(200);
    const barra1 = primero.json().sections.find((s: any) => s.section === "BARRA");
    expect(barra1.units).toBe(2);

    // +1 caña, como lo haría el TPV: sube `units` de la línea.
    state.tickets.get(TICKET)!.lines.find((l) => l.id === "L-CANA")!.units = 3;

    const segundo = await enviar(a, { clientSendId: randomUUID() });
    expect(segundo.statusCode).toBe(200);
    const barra2 = segundo.json().sections.find((s: any) => s.section === "BARRA");
    // ESTO es el sabotaje: con el motor viejo esto valdría 3.
    expect(barra2.units).toBe(1);
    expect(barra2.lineCount).toBe(1);
    // Y la 2ª comanda de la pantalla lleva UNA sola unidad.
    const comandas = [...state.orders.values()].filter((o) => o.section === "BARRA");
    expect(comandas).toHaveLength(2);
    const lineas2 = [...state.orderLines.values()].filter(
      (l) => l.orderId === comandas[1]!.id,
    );
    expect(lineas2).toHaveLength(1);
    expect(lineas2[0]!.units).toBe(1);
    expect(comandas[1]!.number).toBe(2);
  });

  it("un «Reenviar» que no cambió nada no gasta número de comanda", async () => {
    sembrar({ pantalla: true });
    const a = await app();
    await enviar(a, { clientSendId: randomUUID() });
    const antes = state.tickets.get(TICKET)!.lastSentRevision;
    const res = await enviar(a, { clientSendId: randomUUID() });
    expect(res.statusCode).toBe(200);
    expect(res.json().nothingNew).toBe(true);
    expect(res.json().sections).toHaveLength(0);
    expect(state.tickets.get(TICKET)!.lastSentRevision).toBe(antes);
  });
});

describe("kds-1 · SABOTAJE · quitar la idempotencia de clientSendId", () => {
  it("el mismo envío dos veces → UNA sola comanda", async () => {
    sembrar({ pantalla: true });
    const a = await app();
    const id = randomUUID();
    const primero = await enviar(a, { clientSendId: id });
    expect(primero.statusCode).toBe(200);
    expect(primero.json().replayed).toBe(false);

    const repetido = await enviar(a, { clientSendId: id });
    expect(repetido.statusCode).toBe(200);
    expect(repetido.json().replayed).toBe(true);
    // La respuesta es LA MISMA, literal.
    expect(repetido.json().revision).toBe(primero.json().revision);
    expect([...state.dispatches.values()]).toHaveLength(1);
    expect([...state.orders.values()].filter((o) => o.section === "COCINA")).toHaveLength(1);
  });

  it("si el envío anterior está EN CURSO responde 409 y no imprime dos veces", async () => {
    sembrar({ impresoraCocina: true });
    const a = await app();
    const id = randomUUID();
    // Se simula la ventana: la fila existe con el resultado EN_CURSO.
    state.dispatches.set("disp-mano", {
      id: "disp-mano",
      tenantId: TENANT,
      ticketId: TICKET,
      clientSendId: id,
      revision: 1,
      urgent: false,
      sentAt: new Date(),
      sentByUserId: CASHIER,
      result: { estado: "EN_CURSO" },
    });
    const res = await enviar(a, { clientSendId: id });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("DISPATCH_IN_FLIGHT");
    expect(tcp.porHost.size).toBe(0);
  });
});

describe("kds-1 · SABOTAJE · fallar el envío por no tener destino", () => {
  it("sección sin pantalla ni impresora → 200 y la línea queda marcada", async () => {
    // El caso exacto de La Maestranza: la BARRA no tiene nada.
    sembrar({ pantalla: true, impresoraCocina: false });
    const a = await app();
    const res = await enviar(a, { clientSendId: randomUUID() });
    expect(res.statusCode).toBe(200);
    const barra = res.json().sections.find((s: any) => s.section === "BARRA");
    expect(barra.destino).toBe("NINGUNO");
    expect(barra.ok).toBe(true);
    // Y la caña queda marcada como enviada: el envío no falla por eso.
    const cana = state.tickets.get(TICKET)!.lines.find((l) => l.id === "L-CANA")!;
    expect(cana.sentUnits).toBe(2);
  });

  it("y el 409 PRINTER_NOT_CONFIGURED_FOR_SECTION ya no existe", async () => {
    sembrar({ pantalla: false, impresoraCocina: false });
    const a = await app();
    const res = await enviar(a, { clientSendId: randomUUID() });
    expect(res.statusCode).toBe(200);
    expect(res.json().sections.every((s: any) => s.destino === "NINGUNO")).toBe(true);
  });
});

describe("kds-1 · la impresora que falla NO marca sus líneas", () => {
  it("TCP caído en COCINA → las bravas siguen sin enviar", async () => {
    sembrar({ impresoraCocina: true });
    tcp.fallan.add("10.0.0.31");
    const a = await app();
    const res = await enviar(a, { clientSendId: randomUUID() });
    const cocina = res.json().sections.find((s: any) => s.section === "COCINA");
    expect(cocina.ok).toBe(false);
    const bravas = state.tickets.get(TICKET)!.lines.find((l) => l.id === "L-BRAVAS")!;
    // Marcar y luego fallar las perdería para siempre: se elige repetir.
    expect(bravas.sentUnits).toBe(0);
  });

  it("pero la caña de la BARRA, que no tiene destino, SÍ se marca", async () => {
    sembrar({ impresoraCocina: true });
    tcp.fallan.add("10.0.0.31");
    const a = await app();
    await enviar(a, { clientSendId: randomUUID() });
    const cana = state.tickets.get(TICKET)!.lines.find((l) => l.id === "L-CANA")!;
    expect(cana.sentUnits).toBe(2);
  });
});

describe("kds-1 · SABOTAJE · retener la barra", () => {
  it("un tiempo 2 de BARRA sale MARCHADO", async () => {
    sembrar({
      pantalla: true,
      lineas: [
        // Una caña puesta en «Espera» (tiempo 2) por un dedo gordo.
        { id: "L-CANA", productId: P_CANA, nameSnapshot: "Caña", units: 1, course: 2 },
        { id: "L-BRAVAS", productId: P_BRAVAS, nameSnapshot: "Patatas bravas", units: 1, course: 2 },
      ],
    });
    state.dispositivos.get(PANTALLA_COCINA)!.kitchenSections = ["COCINA", "BARRA"];
    const a = await app();
    await enviar(a, { clientSendId: randomUUID() });

    const porSeccion = new Map(
      [...state.orders.values()].map((o) => [o.section, o.id]),
    );
    const lineaBarra = [...state.orderLines.values()].find(
      (l) => l.orderId === porSeccion.get("BARRA"),
    )!;
    const lineaCocina = [...state.orderLines.values()].find(
      (l) => l.orderId === porSeccion.get("COCINA"),
    )!;
    // La bebida sale YA: la barra no se retiene nunca.
    expect(lineaBarra.firedAt).not.toBeNull();
    // Y lo de cocina SÍ se queda en espera.
    expect(lineaCocina.firedAt).toBeNull();
  });
});

describe("kds-1 · SABOTAJE · −/+ en lo enviado sin pantalla", () => {
  it("sección con IMPRESORA → `canCorrectSent` false (regla de v2-H1)", async () => {
    sembrar({ pantalla: false, impresoraCocina: true });
    const a = await app();
    const res = await a.inject({
      method: "GET",
      url: `/tickets/${TICKET}/kitchen`,
      headers: { authorization: `Bearer ${sesion()}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().destinations.COCINA).toEqual({
      screen: false,
      printer: true,
      canCorrectSent: false,
    });
  });

  it("sección con PANTALLA → `canCorrectSent` true (la vuelta deliberada)", async () => {
    sembrar({ pantalla: true, impresoraCocina: false });
    const a = await app();
    const res = await a.inject({
      method: "GET",
      url: `/tickets/${TICKET}/kitchen`,
      headers: { authorization: `Bearer ${sesion()}` },
    });
    expect(res.json().destinations.COCINA.canCorrectSent).toBe(true);
    // Y la BARRA, que no tiene nada, sigue sin poder corregirse.
    expect(res.json().destinations.BARRA.canCorrectSent).toBe(false);
  });
});

describe("kds-1 · SABOTAJE · módulo apagado", () => {
  it("sin `kitchenDisplayEnabled` no se crea NINGUNA comanda de pantalla", async () => {
    sembrar({ pantalla: true, moduloEncendido: false });
    const a = await app();
    const res = await enviar(a, { clientSendId: randomUUID() });
    expect(res.statusCode).toBe(200);
    // La tablet está emparejada, pero el módulo está apagado: ninguna
    // sección tiene pantalla.
    expect(res.json().sections.every((s: any) => s.destino === "NINGUNO")).toBe(true);
    expect([...state.orders.values()]).toHaveLength(0);
  });

  it("y el envío por diferencias sigue funcionando: es un arreglo, no una función", async () => {
    sembrar({ pantalla: false, impresoraCocina: true, moduloEncendido: false });
    const a = await app();
    await enviar(a, { clientSendId: randomUUID() });
    expect(state.tickets.get(TICKET)!.lines.find((l) => l.id === "L-BRAVAS")!.sentUnits).toBe(1);
    // Segundo envío: no se reimprime nada porque no hay diferencia.
    tcp.porHost.clear();
    const res = await enviar(a, { clientSendId: randomUUID() });
    expect(res.json().nothingNew).toBe(true);
    expect(tcp.porHost.size).toBe(0);
  });
});

describe("kds-1 · lo que seguía valiendo del motor viejo", () => {
  it("404 si el ticket no es DRAFT", async () => {
    sembrar({ pantalla: true });
    state.tickets.get(TICKET)!.status = "PAID";
    const a = await app();
    const res = await enviar(a, { clientSendId: randomUUID() });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe("TICKET_NOT_FOUND_OR_NOT_DRAFT");
  });

  it("403 si el register del cajero no es el del ticket", async () => {
    sembrar({ pantalla: true });
    state.tickets.get(TICKET)!.registerId = "99999999-0000-0000-0000-000000000003";
    const a = await app();
    const res = await enviar(a, { clientSendId: randomUUID() });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("REGISTER_MISMATCH");
  });

  it("400 si el ticket no tiene líneas", async () => {
    sembrar({ pantalla: true, lineas: [] });
    const a = await app();
    const res = await enviar(a, { clientSendId: randomUUID() });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("EMPTY_TICKET");
  });

  it("agrupa por sección: la caña a BARRA y las bravas a COCINA", async () => {
    sembrar({ pantalla: true, impresoraCocina: true });
    state.dispositivos.get(PANTALLA_COCINA)!.kitchenSections = ["COCINA", "BARRA"];
    const a = await app();
    const res = await enviar(a, { clientSendId: randomUUID() });
    const secciones = res.json().sections.map((s: any) => s.section);
    expect(secciones).toContain("BARRA");
    expect(secciones).toContain("COCINA");
    // El orden es el canónico (BARRA, COCINA, SALON).
    expect(secciones).toEqual(["BARRA", "COCINA"]);
  });

  it("la URL legacy `/send-to-kitchen` es el mismo motor", async () => {
    sembrar({ pantalla: true });
    const a = await app();
    const res = await a.inject({
      method: "POST",
      url: `/tickets/${TICKET}/send-to-kitchen`,
      headers: { authorization: `Bearer ${sesion()}` },
      payload: { clientSendId: randomUUID() },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().sections.length).toBeGreaterThan(0);
  });
});
