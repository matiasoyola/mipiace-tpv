// B-reservas-8 · LOS DOS PASOS contra Postgres de verdad: apartar al citar,
// consumir al cobrar.
//
// POR QUÉ ESTE FICHERO EXISTE. Lo que cierra el bloque es una afirmación
// sobre la base de datos y sobre DOS transacciones que tienen que ser la
// misma:
//
//   · el apartado va DENTRO de la transacción de la cita, y el EXCLUDE del
//     anti-solape —que sólo existe aquí— es quien puede tumbarla;
//   · el bono nace DENTRO de la transacción del cobro, después del sello de
//     S1, cuyos triggers tampoco existen con un prisma falso.
//
// REGLA, heredada de v1.13: cada aserción va contra la BD por SQL.

import { randomBytes, randomUUID } from "node:crypto";

import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { E2E_DATABASE_URL, e2eEnabled, SKIP_MESSAGE } from "./e2e-env.js";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL =
  E2E_DATABASE_URL || "postgresql://e2e:e2e@127.0.0.1:5432/e2e";
process.env.REDIS_URL = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";
process.env.JWT_ACCESS_SECRET = "e".repeat(40);
process.env.JWT_REFRESH_SECRET = "f".repeat(40);
process.env.HOLDED_KEY_ENCRYPTION_SECRET = randomBytes(32).toString("base64");

// El borde con Redis/Holded. Aquí no se prueba el ERP.
vi.mock("../src/queues/ticket-upload.js", () => ({
  enqueueTicketUpload: async () => {},
}));
vi.mock("../src/queues/refund-upload.js", () => ({
  enqueueRefundUpload: async () => {},
}));
vi.mock("../src/queues/ticket-email.js", () => ({
  enqueueTicketEmail: async () => {},
}));

const { getPrisma, shutdown } = await import("../src/context.js");
const { registerTicketRoutes } = await import("../src/tickets/routes.js");
const { registerAgendaRoutes } = await import("../src/agenda/routes.js");
const { registerVoucherRoutes } = await import("../src/vouchers/routes.js");
const { registerTableOperativaRoutes } = await import(
  "../src/tables/operativa.js"
);
const { registerErrorHandler } = await import("../src/lib/error-handler.js");
const { registerLenientJsonParser } = await import("../src/lib/lenient-json.js");
const { signCashierSession } = await import("../src/shift/cashier-session.js");
const { sembrarEscenario, sembrarBono } = await import("./bonos-escenario.js");
const { borrarCuentasDePrueba } = await import("./borrar-tenant.js");
const { resetearEnsayo } = await import("../src/fiscal/puesta-en-marcha.js");

type Escenario = Awaited<ReturnType<typeof sembrarEscenario>>;

describe.skipIf(!e2eEnabled)("e2e · los dos pasos del bono", () => {
  if (!e2eEnabled) console.warn(`\n${SKIP_MESSAGE}\n`);

  const prisma = getPrisma();
  let app: FastifyInstance;
  const tenantsCreados: string[] = [];

  /** El reloj de las citas: cada una, su hueco. El EXCLUDE es real. */
  const BASE = Date.parse("2026-12-01T06:00:00.000Z");
  let huecos = 0;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    registerErrorHandler(app);
    registerLenientJsonParser(app);
    await registerTicketRoutes(app);
    await registerAgendaRoutes(app);
    await registerVoucherRoutes(app);
    // La ruta que abre un BORRADOR de verdad, para el test 9c.
    await registerTableOperativaRoutes(app);
    await app.ready();
  });

  afterAll(async () => {
    await app?.close();
    await borrarCuentasDePrueba(prisma, ...tenantsCreados);
    await shutdown();
  });

  async function escenario(
    opts: Parameters<typeof sembrarEscenario>[1] = {},
  ): Promise<Escenario & { token: string }> {
    const e = await sembrarEscenario(prisma, opts);
    tenantsCreados.push(e.tenantId);
    const token = signCashierSession(
      {
        sub: e.cashierId,
        tid: e.tenantId,
        did: randomUUID(),
        rid: e.registerId,
        role: "CASHIER",
      },
      720,
    );
    return { ...e, token };
  }

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });

  function siguienteHueco(): string {
    const at = new Date(BASE + huecos * 60 * 60_000);
    huecos += 1;
    return at.toISOString();
  }

  // ── aserciones contra la BD ───────────────────────────────────────

  async function filaDelBono(id: string) {
    const rows = await prisma.$queryRaw<
      Array<{
        code: string;
        sessions_total: number;
        sessions_left: number;
        sessions_reserved: number;
        status: string;
        es_prueba: boolean;
        valor_carta_cents: number;
        cobrado_cents: number;
        sold_ticket_id: string | null;
        sold_ticket_line_id: string | null;
        expires_at: Date | null;
      }>
    >`
      SELECT "code", "sessions_total", "sessions_left", "sessions_reserved",
             "status", "es_prueba", "valor_carta_cents", "cobrado_cents",
             "sold_ticket_id"::text AS sold_ticket_id,
             "sold_ticket_line_id"::text AS sold_ticket_line_id, "expires_at"
        FROM "vouchers" WHERE "id" = ${id}::uuid`;
    expect(rows).toHaveLength(1);
    return rows[0]!;
  }

  async function tiposDelLibro(voucherId: string): Promise<string[]> {
    const rows = await prisma.$queryRaw<Array<{ tipo: string }>>`
      SELECT "tipo" FROM "voucher_movements"
       WHERE "voucher_id" = ${voucherId}::uuid
       ORDER BY "created_at", "id"`;
    return rows.map((r) => r.tipo);
  }

  async function citaRow(id: string) {
    const rows = await prisma.$queryRaw<
      Array<{ status: string; voucher_id: string | null; ticket_id: string | null }>
    >`
      SELECT status::text AS status, voucher_id::text AS voucher_id,
             ticket_id::text AS ticket_id
        FROM appointments WHERE id = ${id}::uuid`;
    expect(rows).toHaveLength(1);
    return rows[0]!;
  }

  async function lineasDelTicket(ticketId: string) {
    return prisma.$queryRaw<
      Array<{
        id: string;
        sku: string;
        total: string;
        unit_price: string;
        voucher_id: string | null;
        discount_pct: string;
      }>
    >`
      SELECT id::text AS id, sku, total::text AS total,
             unit_price::text AS unit_price, voucher_id::text AS voucher_id,
             discount_pct::text AS discount_pct
        FROM ticket_lines WHERE ticket_id = ${ticketId}::uuid ORDER BY sku`;
  }

  /** Da una cita por la RUTA, que es el camino de verdad. */
  async function darCita(
    e: Escenario & { token: string },
    servicios: string[],
    voucherId?: string | null,
  ) {
    return app.inject({
      method: "POST",
      url: "/agenda/appointments",
      headers: auth(e.token),
      payload: {
        clientId: e.clientId,
        items: servicios.map((serviceId) => ({
          serviceId,
          staffUserId: e.cashierId,
        })),
        start: siguienteHueco(),
        source: "PRESENCIAL",
        ...(voucherId ? { voucherId } : {}),
      },
    });
  }

  // ══════════════════════════════════════════════════════════════════
  // TEST 1 · CITA Y APARTADO SON ATÓMICOS
  // ══════════════════════════════════════════════════════════════════
  it("1a · el EXCLUDE rechaza el hueco → NO queda nada apartado", async () => {
    const e = await escenario();
    const bono = await sembrarBono(prisma, e, { sesiones: 3 });

    // ── POR QUÉ ESTO NO PASA POR LA RUTA ────────────────────────────
    //
    // El motor mira la disponibilidad ANTES de insertar, así que una
    // segunda cita al mismo hueco por `POST /agenda/appointments` sale
    // `NO_SLOT` y el `EXCLUDE` no llega a morder — y entonces `apartar()`
    // tampoco llega a correr, que es justo lo que hay que probar.
    //
    // El EXCLUDE es el final de LA CARRERA: dos altas que pasan el
    // chequeo a la vez y choca la segunda al cometer (`agenda-carrera`
    // §1.3). Así que se provocan las dos a la vez contra `insertHold`,
    // que es la unidad transaccional donde vive el apartado.
    const { createAgendaStore } = await import("../src/agenda/store.js");
    const store = createAgendaStore(prisma);
    const start = new Date(BASE + huecos * 60 * 60_000);
    huecos += 1;
    const alta = (voucherId: string | null) =>
      store.insertHold({
        tenantId: e.tenantId,
        externalId: randomUUID(),
        clientId: e.clientId,
        source: "PRESENCIAL",
        status: "CONFIRMED",
        pendingUntil: null,
        notes: null,
        timeslotStart: start,
        timeslotEnd: new Date(start.getTime() + 30 * 60_000),
        items: [
          {
            serviceId: e.quiropodiaId,
            durationMin: 30,
            bufferBeforeMin: 0,
            bufferAfterMin: 0,
            staffRequired: 1,
            sortOrder: 0,
            startOffsetMin: 0,
          },
        ],
        assignments: [
          {
            appointmentItemIndex: 0,
            reservableType: "STAFF",
            staffUserId: e.cashierId,
            resourceId: null,
            startsAt: start,
            endsAt: new Date(start.getTime() + 30 * 60_000),
          },
        ],
        voucherId,
        voucherCanal: "tpv",
        voucherUserId: e.cashierId,
      });

    // Las dos al MISMO hueco y las dos con bono. Una entra; la otra choca
    // contra el `EXCLUDE` **después** de haber llegado a `apartar()`.
    const resultados = await Promise.allSettled([alta(bono.id), alta(bono.id)]);
    const entraron = resultados.filter((r) => r.status === "fulfilled");
    const chocaron = resultados.filter((r) => r.status === "rejected");
    expect(entraron).toHaveLength(1);
    expect(chocaron).toHaveLength(1);
    expect(String((chocaron[0] as PromiseRejectedResult).reason)).toMatch(
      /slot taken|gist exclusion/i,
    );

    // CONTRA LA BD: UNA sola línea APARTADA, no dos. Es el sabotaje
    // «sacar apartar() de la transacción de la cita»: con el apartado
    // fuera, la que chocó habría dejado su sesión apartada para siempre.
    expect(await tiposDelLibro(bono.id)).toEqual(["ALTA_INICIAL", "APARTADA"]);
    const fila = await filaDelBono(bono.id);
    expect(Number(fila.sessions_left)).toBe(2);
    expect(Number(fila.sessions_reserved)).toBe(1);
  });

  it("1b · sin sesiones libres, la cita NO nace como cita de bono", async () => {
    const e = await escenario();
    const bono = await sembrarBono(prisma, e, { sesiones: 1 });
    // La primera cita se lleva la única sesión.
    const uno = await darCita(e, [e.quiropodiaId], bono.id);
    expect(uno.statusCode).toBe(201);

    // La segunda pide bono y ya no queda: NO NACE.
    const dos = await darCita(e, [e.quiropodiaId], bono.id);
    expect(dos.statusCode).toBe(409);
    expect(dos.json()).toMatchObject({
      error: "BONO_NO_DISPONIBLE",
      bonoMotivo: "agotado",
    });
    // Y dice por qué, sin ofrecer otras horas: el hueco estaba libre.
    expect(dos.json().message).toMatch(/sesiones libres/i);
    expect(dos.json().alternatives).toEqual([]);

    // CONTRA LA BD: una sola cita de este bono y una sola APARTADA.
    const citas = await prisma.$queryRaw<Array<{ n: bigint }>>`
      SELECT COUNT(*)::bigint AS n FROM appointments
       WHERE tenant_id = ${e.tenantId}::uuid AND voucher_id = ${bono.id}::uuid`;
    expect(Number(citas[0]!.n)).toBe(1);
    expect(await tiposDelLibro(bono.id)).toEqual(["ALTA_INICIAL", "APARTADA"]);

    // Y la MISMA cita sin bono sí entra: «puede nacer como cita normal si
    // el cajero lo elige».
    const normal = await darCita(e, [e.quiropodiaId]);
    expect(normal.statusCode).toBe(201);
    expect((await citaRow(normal.json().appointment.id)).voucher_id).toBeNull();
  });

  it("1c · un bono que no cubre el servicio no aparta, y la cita no nace", async () => {
    const e = await escenario();
    const bono = await sembrarBono(prisma, e, { sesiones: 3 });
    // El bono es de «podologia» y la cita es de un masaje.
    const res = await darCita(e, [e.masajeId], bono.id);
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({
      error: "BONO_NO_DISPONIBLE",
      bonoMotivo: "no_cubre",
    });
    expect(await tiposDelLibro(bono.id)).toEqual(["ALTA_INICIAL"]);
  });

  it("1d · y dar una cita de bono SIN ficha se rechaza antes de tocar nada", async () => {
    const e = await escenario();
    const bono = await sembrarBono(prisma, e, { sesiones: 3 });
    const res = await app.inject({
      method: "POST",
      url: "/agenda/appointments",
      headers: auth(e.token),
      payload: {
        items: [{ serviceId: e.quiropodiaId, staffUserId: e.cashierId }],
        start: siguienteHueco(),
        source: "PRESENCIAL",
        voucherId: bono.id,
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("BONO_SIN_CLIENTE");
    expect(await tiposDelLibro(bono.id)).toEqual(["ALTA_INICIAL"]);
  });

  // ══════════════════════════════════════════════════════════════════
  // TEST 3 · COBRAR, ANULAR Y NO-SHOW
  // ══════════════════════════════════════════════════════════════════
  it("3a · cobrar la cita CONSUME lo apartado y la línea va a 0 €", async () => {
    const e = await escenario();
    const bono = await sembrarBono(prisma, e, { sesiones: 3 });
    const cita = (await darCita(e, [e.quiropodiaId], bono.id)).json()
      .appointment.id as string;

    // «Cobrar en caja»: el borrador sale YA MARCADO.
    const abierto = await app.inject({
      method: "POST",
      url: `/agenda/appointments/${cita}/checkout`,
      headers: auth(e.token),
      payload: {},
    });
    expect(abierto.statusCode).toBe(201);
    const draftId = abierto.json().ticket.id as string;
    expect(abierto.json().ticket.bono).toMatchObject({
      code: bono.code,
      sesionesLibres: 2,
      sesionesApartadas: 1,
    });
    // CONTRA LA BD: la línea del servicio, a 0 € y con su bono. Y **sin
    // descuento**: un bono no es un descuento (no puede disparar el umbral
    // del PIN de encargado).
    const lineas = await lineasDelTicket(draftId);
    expect(lineas).toHaveLength(1);
    expect(Number(lineas[0]!.total)).toBe(0);
    expect(Number(lineas[0]!.unit_price)).toBe(0);
    expect(Number(lineas[0]!.discount_pct)).toBe(0);
    expect(lineas[0]!.voucher_id).toBe(bono.id);

    // Y se cobra: 0 €.
    const cobrado = await app.inject({
      method: "POST",
      url: `/tickets/${draftId}/checkout`,
      headers: auth(e.token),
      payload: { payments: [{ method: "CASH", amount: 0 }] },
    });
    expect(cobrado.statusCode).toBe(200);
    expect(cobrado.json().canjes).toEqual([
      expect.objectContaining({ code: bono.code, consumida: true }),
    ]);

    // CONTRA LA BD: la sesión pasó de apartada a consumida.
    expect(await tiposDelLibro(bono.id)).toEqual([
      "ALTA_INICIAL",
      "APARTADA",
      "CONSUMIDA",
    ]);
    const fila = await filaDelBono(bono.id);
    expect(Number(fila.sessions_left)).toBe(2);
    expect(Number(fila.sessions_reserved)).toBe(0);
  });

  it("3b · si lo que se hizo NO lo cubre el bono: se libera y se cobra normal", async () => {
    const e = await escenario();
    const bono = await sembrarBono(prisma, e, { sesiones: 3 });
    const cita = (await darCita(e, [e.quiropodiaId], bono.id)).json()
      .appointment.id as string;

    // Aquí se simula lo que hace clinica-3: la cita era de quiropodia y lo
    // que acabó cobrándose es OTRO servicio que el bono no cubre. Se cambia
    // el item de la cita, que es lo que el borrador lee.
    await prisma.$executeRaw`
      UPDATE appointment_items SET service_id = ${e.masajeId}::uuid
       WHERE appointment_id = ${cita}::uuid`;

    const abierto = await app.inject({
      method: "POST",
      url: `/agenda/appointments/${cita}/checkout`,
      headers: auth(e.token),
      payload: {},
    });
    expect(abierto.statusCode).toBe(201);
    const draftId = abierto.json().ticket.id as string;
    // El servidor NO marca nada: el bono no cubre un masaje.
    expect(abierto.json().ticket.bono).toBeNull();
    const lineas = await lineasDelTicket(draftId);
    expect(lineas[0]!.voucher_id).toBeNull();
    // 40 € netos al 21 % = 48,40 €. El masaje NO es exento (los servicios
    // de podología sí): es un servicio de otra categoría, que es justo lo
    // que hace que el bono no lo cubra.
    expect(Number(lineas[0]!.total)).toBeCloseTo(48.4, 2);

    const cobrado = await app.inject({
      method: "POST",
      url: `/tickets/${draftId}/checkout`,
      headers: auth(e.token),
      payload: { payments: [{ method: "CASH", amount: 48.4 }] },
    });
    expect(cobrado.statusCode).toBe(200);

    // CONTRA LA BD: lo apartado se LIBERÓ. **Nunca se consume un bono
    // contra un servicio que no cubre**, y tampoco se queda una sesión
    // apartada para siempre en una cita ya cobrada.
    expect(await tiposDelLibro(bono.id)).toEqual([
      "ALTA_INICIAL",
      "APARTADA",
      "LIBERADA",
    ]);
    const fila = await filaDelBono(bono.id);
    expect(Number(fila.sessions_left)).toBe(3);
    expect(Number(fila.sessions_reserved)).toBe(0);
  });

  it("3c · anular la cita LIBERA lo apartado", async () => {
    const e = await escenario();
    const bono = await sembrarBono(prisma, e, { sesiones: 2 });
    const cita = (await darCita(e, [e.quiropodiaId], bono.id)).json()
      .appointment.id as string;
    expect(Number((await filaDelBono(bono.id)).sessions_left)).toBe(1);

    const res = await app.inject({
      method: "PATCH",
      url: `/agenda/appointments/${cita}`,
      headers: auth(e.token),
      payload: { status: "CANCELLED" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().bono).toMatchObject({ que: "liberada" });

    const fila = await filaDelBono(bono.id);
    expect(Number(fila.sessions_left)).toBe(2);
    expect(Number(fila.sessions_reserved)).toBe(0);
    expect(await tiposDelLibro(bono.id)).toEqual([
      "ALTA_INICIAL",
      "APARTADA",
      "LIBERADA",
    ]);
    // Y la cita ya no es de bono: la fila y el libro cuentan lo mismo.
    expect((await citaRow(cita)).voucher_id).toBeNull();
  });

  it("3d · no-show con `consumir` (el default, lo que hace el spa)", async () => {
    const e = await escenario({ noShow: "consumir" });
    const bono = await sembrarBono(prisma, e, { sesiones: 2 });
    const cita = (await darCita(e, [e.quiropodiaId], bono.id)).json()
      .appointment.id as string;
    const res = await app.inject({
      method: "PATCH",
      url: `/agenda/appointments/${cita}`,
      headers: auth(e.token),
      payload: { status: "NO_SHOW" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().bono).toMatchObject({ que: "consumida" });
    const fila = await filaDelBono(bono.id);
    expect(Number(fila.sessions_left)).toBe(1);
    expect(Number(fila.sessions_reserved)).toBe(0);
    expect(await tiposDelLibro(bono.id)).toContain("CONSUMIDA");
  });

  it("3e · no-show con `liberar` (el centro que no cobra el plantón)", async () => {
    const e = await escenario({ noShow: "liberar" });
    const bono = await sembrarBono(prisma, e, { sesiones: 2 });
    const cita = (await darCita(e, [e.quiropodiaId], bono.id)).json()
      .appointment.id as string;
    const res = await app.inject({
      method: "PATCH",
      url: `/agenda/appointments/${cita}`,
      headers: auth(e.token),
      payload: { status: "NO_SHOW" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().bono).toMatchObject({ que: "liberada" });
    expect(Number((await filaDelBono(bono.id)).sessions_left)).toBe(2);
    expect(await tiposDelLibro(bono.id)).toContain("LIBERADA");
  });

  it("3f · NUNCA se consume un bono contra un servicio que no cubre", async () => {
    // La regla dura del bloque, contra la puerta directamente. 3b la
    // prueba por el camino del borrador —donde el servidor ni marca la
    // línea—; aquí se fuerza el caso que de verdad puede llegar: la línea
    // YA marcada y lo que se acabó haciendo es otra cosa (clinica-3).
    const e = await escenario();
    const bono = await sembrarBono(prisma, e, { sesiones: 2 });
    const cita = (await darCita(e, [e.quiropodiaId], bono.id)).json()
      .appointment.id as string;

    const gate = await import("../src/vouchers/gate.js");
    const { serviciosACubrir } = await import("../src/vouchers/servicios.js");
    const res = await prisma.$transaction(async (tx) => {
      // Lo que se hizo: un masaje, que el bono de podología no cubre.
      const servicios = await serviciosACubrir(tx, e.tenantId, [e.masajeId]);
      return gate.consumir(tx, {
        tenantId: e.tenantId,
        appointmentId: cita,
        ticketLineId: null,
        servicio: servicios[0]!,
        detalle: "No debería consumirse.",
        canal: "tpv",
        userId: e.cashierId,
        actor: null,
        ahora: new Date(),
      });
    });
    expect(res.ok).toBe(false);
    expect(res).toMatchObject({ motivo: "no_cubre", liberado: true });

    // CONTRA LA BD: ni una CONSUMIDA. Lo apartado se LIBERÓ y la línea se
    // cobra normal. Es el sabotaje «consumir contra un servicio que el
    // bono no cubre».
    const tipos = await tiposDelLibro(bono.id);
    expect(tipos).toEqual(["ALTA_INICIAL", "APARTADA", "LIBERADA"]);
    expect(tipos).not.toContain("CONSUMIDA");
    const fila = await filaDelBono(bono.id);
    expect(Number(fila.sessions_left)).toBe(2);
    expect(Number(fila.sessions_reserved)).toBe(0);
  });

  // ══════════════════════════════════════════════════════════════════
  // TEST 9 · LA VENTA
  // ══════════════════════════════════════════════════════════════════
  it("9a · el bono nace con el ticket PAID, con su ticket y su línea", async () => {
    const e = await escenario({ caducidadMesesDeLaPlantilla: 6 });
    const res = await app.inject({
      method: "POST",
      url: "/tickets",
      headers: auth(e.token),
      payload: {
        externalId: randomUUID(),
        registerId: e.registerId,
        shiftId: e.shiftId,
        clientId: e.clientId,
        lines: [
          {
            productId: e.bonoProductoId,
            nameSnapshot: "Bono quiropodia",
            sku: "LOC-BONO-5",
            units: 1,
            unitPrice: 150,
            discountPct: 0,
            taxRate: 0,
            exemptionCause: "E1",
          },
        ],
        payments: [{ method: "CASH", amount: 150 }],
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.bonosEmitidos).toHaveLength(1);
    expect(body.bonosSinEmitir).toBeNull();
    const emitido = body.bonosEmitidos[0];
    expect(emitido.code).toBe("B1");
    expect(emitido.sesiones).toBe(5);

    // CONTRA LA BD: el bono, con su ticket, su línea, su dinero y su
    // cobertura CONGELADA.
    const fila = await filaDelBono(emitido.id);
    expect(fila.sold_ticket_id).toBe(body.ticket.id);
    expect(fila.sold_ticket_line_id).toBeTruthy();
    expect(Number(fila.sessions_total)).toBe(5);
    expect(Number(fila.sessions_left)).toBe(5);
    // Dinero y deuda, SEPARADOS: lo de carta y lo cobrado, los dos 150 €
    // aquí porque no hubo descuento.
    expect(Number(fila.valor_carta_cents)).toBe(15000);
    expect(Number(fila.cobrado_cents)).toBe(15000);
    expect(fila.es_prueba).toBe(false);
    // Y caduca a seis meses de calendario.
    expect(fila.expires_at).not.toBeNull();
    expect(await tiposDelLibro(emitido.id)).toEqual(["VENDIDO"]);

    const cobertura = await prisma.$queryRaw<
      Array<{ covers_tag_slugs: string[] }>
    >`
      SELECT "covers_tag_slugs" FROM "vouchers" WHERE "id" = ${emitido.id}::uuid`;
    expect(cobertura[0]!.covers_tag_slugs).toEqual(["podologia"]);
  });

  it("9b · vender un bono SIN ficha se rechaza antes de cobrar", async () => {
    const e = await escenario();
    const res = await app.inject({
      method: "POST",
      url: "/tickets",
      headers: auth(e.token),
      payload: {
        externalId: randomUUID(),
        registerId: e.registerId,
        shiftId: e.shiftId,
        lines: [
          {
            productId: e.bonoProductoId,
            nameSnapshot: "Bono quiropodia",
            sku: "LOC-BONO-5",
            units: 1,
            unitPrice: 150,
            discountPct: 0,
            taxRate: 0,
            exemptionCause: "E1",
          },
        ],
        payments: [{ method: "CASH", amount: 150 }],
      },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("BONO_SIN_CLIENTE");
    // Y NO se cobró nada: ni ticket, ni bono, ni número quemado.
    const n = await prisma.$queryRaw<Array<{ n: bigint }>>`
      SELECT COUNT(*)::bigint AS n FROM tickets
       WHERE tenant_id = ${e.tenantId}::uuid`;
    expect(Number(n[0]!.n)).toBe(0);
  });

  it("9c · un BORRADOR que no se cobra no gasta número de bono", async () => {
    const e = await escenario();
    // El borrador se abre por LA RUTA de verdad (`POST /tables/:id/lines`),
    // no insertándolo a mano: lo que se prueba es que el camino que usa la
    // cajera no emite el bono hasta que cobra.
    const linea = await app.inject({
      method: "POST",
      url: `/tables/${e.tableId}/lines`,
      headers: auth(e.token),
      payload: {
        productId: e.bonoProductoId,
        nameSnapshot: "Bono quiropodia",
        sku: "LOC-BONO-5",
        units: 1,
        unitPrice: 150,
        discountPct: 0,
        taxRate: 0,
      },
    });
    expect(linea.statusCode).toBe(201);
    const draftId = linea.json().ticket.id as string;

    // CONTRA LA BD: mientras sea borrador, cero bonos y el contador sin
    // tocar. Es el sabotaje «el bono nace al crear el ticket».
    expect(
      (
        await prisma.voucherSequence.findUniqueOrThrow({
          where: { tenantId: e.tenantId },
          select: { ultimo: true },
        })
      ).ultimo,
    ).toBe(0);
    expect(await prisma.voucher.count({ where: { tenantId: e.tenantId } })).toBe(0);

    // La ficha hace falta para vender un bono, y el borrador de una mesa no
    // la trae: se asigna como lo haría el TPV antes de cobrar.
    await prisma.ticket.update({
      where: { id: draftId },
      data: { clientId: e.clientId },
    });

    // Y al cobrarlo, nace.
    const cobrado = await app.inject({
      method: "POST",
      url: `/tickets/${draftId}/checkout`,
      headers: auth(e.token),
      payload: { payments: [{ method: "CASH", amount: 150 }] },
    });
    expect(cobrado.statusCode).toBe(200);
    expect(cobrado.json().bonosEmitidos).toHaveLength(1);
    expect(
      (
        await prisma.voucherSequence.findUniqueOrThrow({
          where: { tenantId: e.tenantId },
          select: { ultimo: true },
        })
      ).ultimo,
    ).toBe(1);
  });

  it("9c-bis · y un borrador con bono y SIN ficha no se cobra", async () => {
    // La comprobación va DENTRO de la transacción del cobro: el borrador se
    // queda borrador, sin quemar número de serie.
    const e = await escenario();
    const linea = await app.inject({
      method: "POST",
      url: `/tables/${e.tableId}/lines`,
      headers: auth(e.token),
      payload: {
        productId: e.bonoProductoId,
        nameSnapshot: "Bono quiropodia",
        sku: "LOC-BONO-5",
        units: 1,
        unitPrice: 150,
        discountPct: 0,
        taxRate: 0,
      },
    });
    const draftId = linea.json().ticket.id as string;
    const res = await app.inject({
      method: "POST",
      url: `/tickets/${draftId}/checkout`,
      headers: auth(e.token),
      payload: { payments: [{ method: "CASH", amount: 150 }] },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("BONO_SIN_CLIENTE");
    const t = await prisma.ticket.findUniqueOrThrow({
      where: { id: draftId },
      select: { status: true, internalNumber: true },
    });
    expect(t.status).toBe("DRAFT");
    expect(t.internalNumber.startsWith("D-")).toBe(true);
  });

  it("9d · un ticket TEST hace nacer un bono de prueba, y el reseteo se lo lleva", async () => {
    // La cuenta EN ENSAYO: sus ventas nacen `TEST` (ADR-021).
    const e = await escenario({ facturaDesde: null });
    const res = await app.inject({
      method: "POST",
      url: "/tickets",
      headers: auth(e.token),
      payload: {
        externalId: randomUUID(),
        registerId: e.registerId,
        shiftId: e.shiftId,
        clientId: e.clientId,
        lines: [
          {
            productId: e.bonoProductoId,
            nameSnapshot: "Bono quiropodia",
            sku: "LOC-BONO-5",
            units: 1,
            unitPrice: 150,
            discountPct: 0,
            taxRate: 0,
            exemptionCause: "E1",
          },
        ],
        payments: [{ method: "CASH", amount: 150 }],
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().ticket.status).toBe("TEST");
    const emitido = res.json().bonosEmitidos[0];
    expect((await filaDelBono(emitido.id)).es_prueba).toBe(true);

    // EL RESETEO DEL ENSAYO se lleva el bono con su ticket, por la cascada
    // de `vouchers.sold_ticket_id`. Y el libro también: su trigger
    // append-only deja pasar el borrado de una línea `es_prueba`.
    const resultado = await resetearEnsayo({ prisma, tenantId: e.tenantId });
    expect(resultado.ticketsBorrados).toBeGreaterThanOrEqual(1);
    const quedan = await prisma.voucher.count({
      where: { tenantId: e.tenantId },
    });
    expect(quedan).toBe(0);
    const lineas = await prisma.voucherMovement.count({
      where: { tenantId: e.tenantId },
    });
    expect(lineas).toBe(0);
  });

  it("9e · con el CANDADO puesto la venta NO se cae: el bono no se emite", async () => {
    // «Cobrar siempre se puede.» El candado es del bono, no de la caja.
    const e = await escenario({ confirmarArranque: false });
    const res = await app.inject({
      method: "POST",
      url: "/tickets",
      headers: auth(e.token),
      payload: {
        externalId: randomUUID(),
        registerId: e.registerId,
        shiftId: e.shiftId,
        clientId: e.clientId,
        lines: [
          {
            productId: e.bonoProductoId,
            nameSnapshot: "Bono quiropodia",
            sku: "LOC-BONO-5",
            units: 1,
            unitPrice: 150,
            discountPct: 0,
            taxRate: 0,
            exemptionCause: "E1",
          },
        ],
        payments: [{ method: "CASH", amount: 150 }],
      },
    });
    // La venta pasa.
    expect(res.statusCode).toBe(201);
    expect(res.json().bonosSinEmitir).toBe("CANDADO_SIN_CONFIRMAR");
    expect(res.json().bonosEmitidos).toEqual([]);
    // Contra la BD: el ticket está cobrado y no hay ningún bono.
    const t = await prisma.ticket.findUniqueOrThrow({
      where: { id: res.json().ticket.id },
      select: { status: true, paidAt: true },
    });
    expect(t.paidAt).not.toBeNull();
    expect(await prisma.voucher.count({ where: { tenantId: e.tenantId } })).toBe(0);
  });

  // ══════════════════════════════════════════════════════════════════
  // TEST 10 · DEVOLVER LA VENTA
  // ══════════════════════════════════════════════════════════════════
  it("10 · devolver con sesiones usadas → rechazado con el motivo; sin usar → ANULADO", async () => {
    const e = await escenario();
    const venta = await app.inject({
      method: "POST",
      url: "/tickets",
      headers: auth(e.token),
      payload: {
        externalId: randomUUID(),
        registerId: e.registerId,
        shiftId: e.shiftId,
        clientId: e.clientId,
        lines: [
          {
            productId: e.bonoProductoId,
            nameSnapshot: "Bono quiropodia",
            sku: "LOC-BONO-5",
            units: 1,
            unitPrice: 150,
            discountPct: 0,
            taxRate: 0,
            exemptionCause: "E1",
          },
        ],
        payments: [{ method: "CASH", amount: 150 }],
      },
    });
    expect(venta.statusCode).toBe(201);
    const ticketId = venta.json().ticket.id as string;
    const bonoId = venta.json().bonosEmitidos[0].id as string;
    const lineaId = (await lineasDelTicket(ticketId))[0]!.id;

    // Una cita APARTA una sesión → ya no se puede devolver.
    const cita = (await darCita(e, [e.quiropodiaId], bonoId)).json().appointment
      .id as string;
    const rechazada = await app.inject({
      method: "POST",
      url: "/refunds",
      headers: auth(e.token),
      payload: {
        externalId: randomUUID(),
        originalTicketId: ticketId,
        lines: [{ ticketLineId: lineaId, units: 1 }],
      },
    });
    expect(rechazada.statusCode).toBe(409);
    expect(rechazada.json().error).toBe("BONO_NO_DEVOLVIBLE");
    // El mensaje dice QUÉ HACER, y es el de `porQueNoDevolvible()`.
    expect(rechazada.json().message).toMatch(/apartada/i);
    expect(rechazada.json().message).toMatch(/Anula esas citas/i);
    // Y no se quemó número de abono ni se tocó el bono.
    expect(await prisma.refund.count({ where: { tenantId: e.tenantId } })).toBe(0);
    expect((await filaDelBono(bonoId)).status).toBe("ACTIVO");

    // Se anula la cita → la sesión vuelve → ahora sí se devuelve.
    await app.inject({
      method: "PATCH",
      url: `/agenda/appointments/${cita}`,
      headers: auth(e.token),
      payload: { status: "CANCELLED" },
    });
    const devuelta = await app.inject({
      method: "POST",
      url: "/refunds",
      headers: auth(e.token),
      payload: {
        externalId: randomUUID(),
        originalTicketId: ticketId,
        lines: [{ ticketLineId: lineaId, units: 1 }],
      },
    });
    expect(devuelta.statusCode).toBe(201);
    expect(devuelta.json().bonosAnulados).toEqual([expect.any(String)]);

    // CONTRA LA BD: el bono queda ANULADO en el mismo paso, con su línea.
    const fila = await filaDelBono(bonoId);
    expect(fila.status).toBe("ANULADO");
    expect(Number(fila.sessions_left)).toBe(0);
    expect(await tiposDelLibro(bonoId)).toEqual([
      "VENDIDO",
      "APARTADA",
      "LIBERADA",
      "ANULADO",
    ]);
  });

  // ══════════════════════════════════════════════════════════════════
  // TEST 11 · OCULTAR EL SERVICIO NO INVALIDA BONOS VENDIDOS
  // ══════════════════════════════════════════════════════════════════
  it("11 · ocultar el servicio (y subirle el precio) → el bono sigue canjeándose", async () => {
    const e = await escenario();
    const bono = await sembrarBono(prisma, e, { sesiones: 2 });
    // El centro oculta la quiropodia del catálogo y le cambia el precio, y
    // además vacía los tags del producto-bono. Nada de eso toca la
    // cobertura CONGELADA del bono vendido.
    await prisma.product.update({
      where: { id: e.quiropodiaId },
      data: { active: false, basePrice: "99.0000" },
    });
    await prisma.voucherTemplate.update({
      where: { id: e.bonoTemplateId },
      data: { coversTagSlugs: ["otra-cosa"] },
    });

    const res = await darCita(e, [e.quiropodiaId], bono.id);
    expect(res.statusCode).toBe(201);
    expect(await tiposDelLibro(bono.id)).toEqual(["ALTA_INICIAL", "APARTADA"]);
  });

  // ══════════════════════════════════════════════════════════════════
  // TEST 14 · EL FRENTE P5: LINEA_CERO vs PRORRATEO
  // ══════════════════════════════════════════════════════════════════
  it("14 · con PRORRATEO la línea lleva el prorrateo; con LINEA_CERO, 0 €", async () => {
    // LINEA_CERO ya está probado en 3a. Aquí, la otra mitad.
    const e = await escenario({ modoCanje: "PRORRATEO" });
    // 150 € / 5 sesiones = 30,00 € por sesión.
    const bono = await sembrarBono(prisma, e, {
      sesiones: 5,
      valorCartaCents: 15000,
    });
    const cita = (await darCita(e, [e.quiropodiaId], bono.id)).json()
      .appointment.id as string;
    const abierto = await app.inject({
      method: "POST",
      url: `/agenda/appointments/${cita}/checkout`,
      headers: auth(e.token),
      payload: {},
    });
    expect(abierto.statusCode).toBe(201);
    const lineas = await lineasDelTicket(abierto.json().ticket.id);
    expect(Number(lineas[0]!.unit_price)).toBeCloseTo(30, 2);
    expect(lineas[0]!.voucher_id).toBe(bono.id);
    // Y sigue sin ser un descuento: la línea DECLARA 30 €, no rebaja 35.
    expect(Number(lineas[0]!.discount_pct)).toBe(0);
  });
});
