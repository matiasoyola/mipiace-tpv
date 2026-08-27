// v1.13-e2e-ciclo-de-caja · el ciclo entero contra Postgres de verdad.
//
// Por qué existe: v1.11 metió un job que cierra turnos SOLO, en
// producción, a las cinco de la mañana, y una imputación que decide a
// qué turno pertenece cada venta que llega tarde. Todo eso está probado
// contra un prisma falso — los tests fijan la lógica, pero nadie había
// visto el ciclo entero correr contra una BD real. El carryover de
// v1.11 lo dice tal cual: "No hay e2e del ciclo completo contra BD real".
//
// Este archivo es la traducción a test de los ocho pasos de "Cómo
// probarlo de cero" del done.md de v1.11. Un solo camino, el que hace
// Sole cada día, sin prisma falso:
//
//   1. tenant + tienda + caja + cajero; abrir turno con fondo
//   2. vender (efectivo y mixto) — importes verificados con SELECTs
//   3. forzar el corte de día con un `now` fabricado
//   4. abrir el turno del día siguiente
//   5. el terminal offline sube el ticket de ANTES del corte: entra en el
//      turno de ayer (no en el que está abierto) y lo marca `zReportStale`
//   6. y el de DESPUÉS del corte: entra en el turno nuevo
//   7. `GET /shift/last-closed` y `ack-summary`
//   8. `close-day` sin contar → descuadre null
//   9. el corte no pisa un cierre manual que llegó durante la pasada
//
// El orden de los pasos 4 y 5 está invertido respecto al guion de v1.11 a
// propósito: con el turno de hoy YA abierto, imputar por ventana y coger
// "el turno abierto ahora" dan resultados distintos. Con un solo turno
// vivo, el paso no distinguiría una regla de la otra.
//
// REGLA DEL BLOQUE: cada aserción va contra la BD, no contra la
// respuesta del API. Si el test puede pasar con la BD vacía, no es un
// e2e.
//
// Lo único mockeado son las colas BullMQ (el borde con Redis y con
// Holded). Aquí no se prueba el ERP — se prueba la caja.

import { mkdtempSync } from "node:fs";
import { access } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";

import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { E2E_DATABASE_URL, e2eEnabled, SKIP_MESSAGE } from "./e2e-env.js";

// Las asignaciones de entorno corren DESPUÉS de que se evalúen los
// imports (ESM los iza), pero antes de cualquier test: todo lo que lee
// entorno en este árbol es perezoso (`loadEnv()` cachea a la primera
// llamada, `getPrisma()` construye el cliente al primer uso).
process.env.NODE_ENV = "test";
process.env.DATABASE_URL = E2E_DATABASE_URL || "postgresql://e2e:e2e@127.0.0.1:5432/e2e";
// Nunca se conecta: las colas están mockeadas más abajo. Está aquí
// porque el schema de env.ts la exige para arrancar.
process.env.REDIS_URL = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";
process.env.JWT_ACCESS_SECRET = "e".repeat(40);
process.env.JWT_REFRESH_SECRET = "f".repeat(40);
process.env.HOLDED_KEY_ENCRYPTION_SECRET = randomBytes(32).toString("base64");
process.env.Z_REPORT_STORAGE_ROOT = mkdtempSync(
  path.join(tmpdir(), "mipiacetpv-e2e-z-"),
);

// El borde con Redis/Holded. Igual que en el resto de la suite: se
// mockea el encolado, no la lógica de caja.
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
const { registerShiftRoutes } = await import("../src/shift/routes.js");
const { registerTicketRoutes } = await import("../src/tickets/routes.js");
const { registerErrorHandler } = await import("../src/lib/error-handler.js");
const { registerLenientJsonParser } = await import("../src/lib/lenient-json.js");
const { signCashierSession } = await import("../src/shift/cashier-session.js");
const { runShiftDayCut } = await import("../src/shift/day-cut-run.js");
const { lastDayCutBefore } = await import("../src/shift/day-cut.js");

const HOUR = 60 * 60 * 1000;

// Silencioso: el job escribe un log por turno cerrado y no aporta nada
// al test. Si algo falla, las aserciones lo dicen mejor.
const silentLog = { info: () => {}, error: () => {} };

describe.skipIf(!e2eEnabled)("e2e · ciclo de caja contra Postgres real", () => {
  if (!e2eEnabled) console.warn(`\n${SKIP_MESSAGE}\n`);

  const prisma = getPrisma();
  let app: FastifyInstance;

  let tenantId = "";
  let storeId = "";
  let registerId = "";
  let cashierId = "";
  let token = "";

  // Los dos turnos del ciclo: el de "ayer" (lo cierra el corte) y el de
  // "hoy" (lo abre el cajero al llegar).
  let shiftA = "";
  let shiftB = "";
  let cutAt: Date = new Date(0);

  const auth = () => ({ authorization: `Bearer ${token}` });

  // ── helpers de aserción: todo contra SELECTs ─────────────────────────

  async function paymentsByMethod(
    shiftId: string,
  ): Promise<Record<string, number>> {
    const rows = await prisma.$queryRaw<Array<{ method: string; sum: string }>>`
      SELECT p.method::text AS method, SUM(p.amount)::text AS sum
        FROM ticket_payments p
        JOIN tickets t ON t.id = p.ticket_id
       WHERE t.shift_id = ${shiftId}::uuid
       GROUP BY p.method
    `;
    const out: Record<string, number> = {};
    for (const r of rows) out[r.method] = Number(r.sum);
    return out;
  }

  interface ShiftRow {
    id: string;
    opened_at: Date;
    closed_at: Date | null;
    close_reason: string;
    cash_opening: string;
    cash_counted: string | null;
    closed_by_user_id: string | null;
    z_report_pdf_path: string | null;
    z_report_stale: boolean;
    summary_ack_at: Date | null;
  }

  async function shiftRow(shiftId: string): Promise<ShiftRow> {
    const rows = await prisma.$queryRaw<ShiftRow[]>`
      SELECT id::text            AS id,
             opened_at,
             closed_at,
             close_reason::text  AS close_reason,
             cash_opening::text  AS cash_opening,
             cash_counted::text  AS cash_counted,
             closed_by_user_id::text AS closed_by_user_id,
             z_report_pdf_path,
             z_report_stale,
             summary_ack_at
        FROM shifts
       WHERE id = ${shiftId}::uuid
    `;
    expect(rows).toHaveLength(1);
    return rows[0]!;
  }

  async function ticketShiftId(externalId: string): Promise<string | null> {
    const rows = await prisma.$queryRaw<Array<{ shift_id: string }>>`
      SELECT shift_id::text AS shift_id
        FROM tickets
       WHERE external_id = ${externalId}::uuid
    `;
    return rows[0]?.shift_id ?? null;
  }

  /** Una venta tal y como la manda el TPV. `occurredAt` sólo lo lleva lo
   *  que sube el outbox después de haber estado sin red. */
  async function sell(args: {
    shiftId: string;
    unitPrice: number;
    taxRate: number;
    payments: Array<{ method: "CASH" | "CARD"; amount: number }>;
    occurredAt?: Date;
  }): Promise<{ externalId: string; status: number; body: unknown }> {
    const externalId = randomUUID();
    const res = await app.inject({
      method: "POST",
      url: "/tickets",
      headers: auth(),
      payload: {
        externalId,
        registerId,
        shiftId: args.shiftId,
        lines: [
          {
            nameSnapshot: "Café con leche",
            sku: "TPV-CAFE",
            units: 1,
            unitPrice: args.unitPrice,
            discountPct: 0,
            taxRate: args.taxRate,
          },
        ],
        payments: args.payments,
        ...(args.occurredAt ? { occurredAt: args.occurredAt.toISOString() } : {}),
      },
    });
    return { externalId, status: res.statusCode, body: res.json() };
  }

  beforeAll(async () => {
    app = Fastify({ logger: false });
    registerErrorHandler(app);
    registerLenientJsonParser(app);
    await registerShiftRoutes(app);
    await registerTicketRoutes(app);
    await app.ready();

    // ── paso 1 · tenant + tienda + caja + cajero ──────────────────────
    // Es lo único que se siembra a mano: es el estado que en producción
    // deja el onboarding, no parte del ciclo diario.
    const tenant = await prisma.tenant.create({
      data: {
        name: "Cafetería e2e",
        // Los defaults de v1.11 explícitos: es lo que corre en producción
        // y lo que este test tiene que probar.
        dayCutHour: 5,
        requireCashCountOnClose: false,
      },
      select: { id: true },
    });
    tenantId = tenant.id;

    const store = await prisma.store.create({
      data: { tenantId, name: "Local e2e" },
      select: { id: true },
    });
    storeId = store.id;

    const register = await prisma.register.create({
      data: { storeId, name: "Caja 1" },
      select: { id: true },
    });
    registerId = register.id;

    const cashier = await prisma.user.create({
      data: {
        tenantId,
        email: `sole+${randomUUID()}@e2e.local`,
        alias: "Sole",
        role: "CASHIER",
      },
      select: { id: true },
    });
    cashierId = cashier.id;

    // El login de cajero (device token + PIN + rate-limit en Redis) es
    // otro camino y tiene sus propios tests. Aquí firmamos la sesión que
    // ese login emite: lo que se prueba es el ciclo de caja.
    token = signCashierSession(
      { sub: cashierId, tid: tenantId, did: randomUUID(), rid: registerId, role: "CASHIER" },
      720,
    );
  });

  afterAll(async () => {
    await app?.close();
    await shutdown();
  });

  it("1 · abre turno con fondo de caja y queda en BD", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/shift/open",
      headers: auth(),
      payload: { cashOpening: 100 },
    });
    expect(res.statusCode).toBe(201);
    shiftA = res.json().shift.id as string;

    const row = await shiftRow(shiftA);
    expect(Number(row.cash_opening)).toBe(100);
    expect(row.closed_at).toBeNull();
    expect(row.close_reason).toBe("MANUAL");
    expect(row.z_report_stale).toBe(false);

    // El turno de Sole se abrió AYER. No podemos esperar 30 h, así que
    // lo retrasamos aquí: es el único viaje en el tiempo de la suite y
    // toca sólo `opened_at`. El corte de día se decide exactamente con
    // ese campo (`shiftCrossedDayCut`), así que retrasarlo es la forma
    // honesta de fabricar "el turno de ayer".
    await prisma.$executeRaw`
      UPDATE shifts SET opened_at = now() - interval '30 hours' WHERE id = ${shiftA}::uuid
    `;
  });

  it("2 · dos ventas (efectivo y mixta): los importes cuadran en BD", async () => {
    // 10,00 € + 21% = 12,10 € en efectivo.
    const cash = await sell({
      shiftId: shiftA,
      unitPrice: 10,
      taxRate: 21,
      payments: [{ method: "CASH", amount: 12.1 }],
    });
    expect(cash.status).toBe(201);

    // 20,00 € + 10% = 22,00 €: 12,00 en efectivo y 10,00 con tarjeta.
    const mixed = await sell({
      shiftId: shiftA,
      unitPrice: 20,
      taxRate: 10,
      payments: [
        { method: "CASH", amount: 12 },
        { method: "CARD", amount: 10 },
      ],
    });
    expect(mixed.status).toBe(201);

    // Contra la BD, no contra la respuesta del API.
    expect(await paymentsByMethod(shiftA)).toEqual({ CASH: 24.1, CARD: 10 });

    const totals = await prisma.$queryRaw<Array<{ n: bigint; sum: string }>>`
      SELECT COUNT(*) AS n, SUM(total)::text AS sum
        FROM tickets
       WHERE shift_id = ${shiftA}::uuid AND status NOT IN ('DRAFT', 'VOIDED')
    `;
    expect(Number(totals[0]!.n)).toBe(2);
    expect(Number(totals[0]!.sum)).toBe(34.1);

    // Los dos tickets fueron a parar al turno que pidió el terminal.
    expect(await ticketShiftId(cash.externalId)).toBe(shiftA);
    expect(await ticketShiftId(mixed.externalId)).toBe(shiftA);
  });

  it("3 · el corte de día cierra el turno: AUTO_DAY_CUT, sin contar, con Z", async () => {
    // `now` fabricado — no se espera a las cinco de la mañana. Es real
    // (no futuro) a propósito: `occurredAt` de los tickets offline se
    // compara contra el reloj de verdad (OCCURRED_AT_MAX_SKEW_MS).
    const now = new Date();
    cutAt = lastDayCutBefore(now, 5);

    const result = await runShiftDayCut({ prisma, log: silentLog, now });
    expect(result.failed).toBe(0);
    expect(result.closed.map((c) => c.shiftId)).toEqual([shiftA]);

    const row = await shiftRow(shiftA);
    expect(row.closed_at).not.toBeNull();
    expect(row.close_reason).toBe("AUTO_DAY_CUT");
    // Nadie contó el efectivo: NULL, no 0. Un descuadre de 0,00 € que
    // nadie ha verificado es una mentira cómoda (v1.11, decisión 3).
    expect(row.cash_counted).toBeNull();
    expect(row.closed_by_user_id).toBeNull();
    expect(row.summary_ack_at).toBeNull();

    // El Z existe en disco, no sólo en la columna.
    expect(row.z_report_pdf_path).toBeTruthy();
    await expect(access(row.z_report_pdf_path!)).resolves.toBeUndefined();

    // El corte cierra CON `now`, no con el instante del corte (v1.11,
    // decisión 2): un worker caído dos días no puede estampar un cierre
    // retroactivo que deje tickets posteriores dentro del turno.
    expect(row.closed_at!.getTime()).toBeGreaterThan(cutAt.getTime());
  });


  it("4 · el cajero llega y abre el turno del día", async () => {
    const opened = await app.inject({
      method: "POST",
      url: "/shift/open",
      headers: auth(),
      payload: { cashOpening: 50 },
    });
    expect(opened.statusCode).toBe(201);
    shiftB = opened.json().shift.id as string;
    expect(shiftB).not.toBe(shiftA);

    // El turno nuevo abre DESPUÉS del cierre del corte: las dos ventanas
    // no se solapan, que es lo que hace decidible la imputación.
    const rowA = await shiftRow(shiftA);
    const rowB = await shiftRow(shiftB);
    expect(rowB.opened_at.getTime()).toBeGreaterThan(rowA.closed_at!.getTime());
  });

  // ── El caso que de verdad importa ────────────────────────────────────
  //
  // El terminal estuvo sin red a la hora del corte. Al recuperar wifi, su
  // outbox sube tickets con el `shiftId` del turno que el server ya cerró
  // y con el `occurredAt` que selló al encolar (cuando el cajero pulsó
  // Cobrar). Hasta v1.11 eso era 409 SHIFT_NOT_OPEN → rechazo permanente
  // en el outbox → **venta perdida**.
  //
  // Los dos tests van con el turno de HOY ya abierto a propósito: es lo
  // que distingue "el turno de la ventana" de "el turno abierto ahora
  // mismo". Con un solo turno vivo, cualquiera de las dos reglas daría el
  // mismo resultado y el test no probaría nada.

  it("5 · ticket offline de ANTES del corte → turno de ayer, y su Z queda desfasado", async () => {
    // Una hora antes del corte: dentro de la ventana del turno de ayer
    // [openedAt, closedAt) y en el pasado real, así que la tolerancia de
    // reloj de `parseOccurredAt` (5 min hacia adelante) no lo descarta.
    const occurredAt = new Date(cutAt.getTime() - HOUR);
    const rowBefore = await shiftRow(shiftA);
    expect(occurredAt.getTime()).toBeGreaterThan(rowBefore.opened_at.getTime());
    expect(occurredAt.getTime()).toBeLessThan(rowBefore.closed_at!.getTime());

    const offline = await sell({
      shiftId: shiftA,
      unitPrice: 5,
      taxRate: 21,
      payments: [{ method: "CASH", amount: 6.05 }],
      occurredAt,
    });
    // No se pierde: la venta se registra.
    expect(offline.status).toBe(201);
    // Y va al turno de AYER —el que contiene su instante—, no al que está
    // abierto ahora mismo.
    expect(await ticketShiftId(offline.externalId)).toBe(shiftA);

    // El efectivo del turno de ayer sube; el turno de hoy no se entera.
    expect(await paymentsByMethod(shiftA)).toEqual({ CASH: 30.15, CARD: 10 });
    expect(await paymentsByMethod(shiftB)).toEqual({});

    // El Z archivado ya no cuadra con la BD y el turno lo dice en vez de
    // callarlo. El PDF emitido no se reescribe.
    const rowAfter = await shiftRow(shiftA);
    expect(rowAfter.z_report_stale).toBe(true);
    expect(rowAfter.z_report_pdf_path).toBe(rowBefore.z_report_pdf_path);
  });

  it("6 · ticket offline de DESPUÉS del corte → turno nuevo", async () => {
    // Mismo outbox, misma subida: el terminal sigue mandando el `shiftId`
    // viejo. El instante es posterior a la apertura del turno nuevo, así
    // que la venta es de hoy.
    const rowB = await shiftRow(shiftB);
    const occurredAt = new Date(rowB.opened_at.getTime() + 1000);
    expect(occurredAt.getTime()).toBeGreaterThan(cutAt.getTime());

    const offline = await sell({
      shiftId: shiftA,
      unitPrice: 30,
      taxRate: 10,
      payments: [{ method: "CARD", amount: 33 }],
      occurredAt,
    });
    expect(offline.status).toBe(201);
    expect(await ticketShiftId(offline.externalId)).toBe(shiftB);

    // Y no ha tocado el turno de ayer.
    expect(await paymentsByMethod(shiftA)).toEqual({ CASH: 30.15, CARD: 10 });
    expect(await paymentsByMethod(shiftB)).toEqual({ CARD: 33 });
  });

  it("7 · last-closed devuelve el resumen de ayer; tras ack-summary, ya no", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/shift/last-closed",
      headers: auth(),
    });
    expect(res.statusCode).toBe(200);
    const { summary } = res.json();
    expect(summary).not.toBeNull();
    expect(summary.shift.id).toBe(shiftA);
    expect(summary.shift.closeReason).toBe("AUTO_DAY_CUT");
    expect(summary.shift.cashCounted).toBeNull();
    expect(summary.shift.zReportStale).toBe(true);
    expect(summary.descuadre).toBeNull();
    // Las cifras del resumen salen de la BD, con la venta offline dentro:
    // dos ventas del día + la que llegó tarde.
    expect(summary.ticketsCount).toBe(3);
    expect(summary.cashTheoretical).toBe(130.15); // 100 de fondo + 30,15
    const cashRow = summary.breakdown.methods.find(
      (m: { method: string }) => m.method === "CASH",
    );
    expect(cashRow.gross).toBe(30.15);

    const ack = await app.inject({
      method: "POST",
      url: `/shift/${shiftA}/ack-summary`,
      headers: auth(),
    });
    expect(ack.statusCode).toBe(200);
    const acked = await shiftRow(shiftA);
    expect(acked.summary_ack_at).not.toBeNull();

    const after = await app.inject({
      method: "GET",
      url: "/shift/last-closed",
      headers: auth(),
    });
    expect(after.statusCode).toBe(200);
    expect(after.json().summary).toBeNull();

    // Idempotente: confirmar dos veces no mueve el sello.
    const again = await app.inject({
      method: "POST",
      url: `/shift/${shiftA}/ack-summary`,
      headers: auth(),
    });
    expect(again.statusCode).toBe(200);
    const acked2 = await shiftRow(shiftA);
    expect(acked2.summary_ack_at!.getTime()).toBe(acked.summary_ack_at!.getTime());
  });

  it("8 · close-day cierra sin contar y el descuadre es null", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/shift/${shiftB}/close-day`,
      headers: auth(),
      // Los tickets están PENDING_SYNC (nadie sube nada a Holded en el
      // e2e). Un problema de sync nunca cierra el negocio: el cajero lo
      // acepta y el sweeper los recupera al reconectar.
      payload: { syncFailureAccepted: true },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().descuadre).toBeNull();

    const row = await shiftRow(shiftB);
    expect(row.closed_at).not.toBeNull();
    // Cierre de persona: MANUAL y con firma de quién.
    expect(row.close_reason).toBe("MANUAL");
    expect(row.closed_by_user_id).toBe(cashierId);
    // Nadie contó → NULL en BD, no 0.
    expect(row.cash_counted).toBeNull();
  });

  it("9 · el corte no pisa un cierre manual que llegó durante la pasada", async () => {
    // addendum 2 de v1.11 (F2). La pasada lee los turnos abiertos al
    // principio y escribe el cierre al final, después de generar el Z
    // (segundos). Si en esa ventana un cajero cierra a mano, el cierre
    // automático le pisaba el suyo: `closedByUserId` a NULL,
    // `closeReason` a AUTO_DAY_CUT y el PDF —que se llama <shiftId>.pdf—
    // sobrescrito por uno que dice "descuadre 0,00 €" sobre un turno que
    // esa persona SÍ contó.
    //
    // La carrera se provoca en el borde y contra Postgres de verdad: el
    // único punto tocado es el `findMany` del job, que devuelve la foto
    // vieja (turno abierto) después de que el cierre manual ya esté
    // ESCRITO en la BD. Es exactamente lo que ve el job en producción.
    const opened = await app.inject({
      method: "POST",
      url: "/shift/open",
      headers: auth(),
      payload: { cashOpening: 20 },
    });
    expect(opened.statusCode).toBe(201);
    const shiftC = opened.json().shift.id as string;
    await prisma.$executeRaw`
      UPDATE shifts SET opened_at = now() - interval '30 hours' WHERE id = ${shiftC}::uuid
    `;

    let raced = false;
    const racingPrisma = new Proxy(prisma, {
      get(target, prop) {
        if (prop !== "shift") return Reflect.get(target, prop);
        const delegate = Reflect.get(target, prop) as typeof prisma.shift;
        return new Proxy(delegate, {
          get(dTarget, dProp) {
            if (dProp !== "findMany") return Reflect.get(dTarget, dProp);
            return async (...args: unknown[]) => {
              const rows = await (
                dTarget.findMany as (...a: unknown[]) => Promise<unknown[]>
              )(...args);
              if (!raced) {
                raced = true;
                // El cajero cierra a mano JUSTO ahora.
                await prisma.$executeRaw`
                  UPDATE shifts
                     SET closed_at = now(),
                         closed_by_user_id = ${cashierId}::uuid,
                         close_reason = 'MANUAL',
                         cash_counted = 20
                   WHERE id = ${shiftC}::uuid
                `;
              }
              return rows;
            };
          },
        });
      },
    }) as typeof prisma;

    const result = await runShiftDayCut({
      prisma: racingPrisma,
      log: silentLog,
      now: new Date(),
    });
    expect(raced).toBe(true);
    // Ni cierre nuestro ni fallo: el job se aparta.
    expect(result.closed).toEqual([]);
    expect(result.failed).toBe(0);

    const row = await shiftRow(shiftC);
    expect(row.close_reason).toBe("MANUAL");
    expect(row.closed_by_user_id).toBe(cashierId);
    expect(Number(row.cash_counted)).toBe(20);
  });
});
