// S1-sello · la tabla "sabotaje → test rojo" del bloque, contra Postgres
// de verdad.
//
// Por qué tiene que ser e2e y no puede vivir con un prisma falso: lo que
// se prueba aquí es que **el MOTOR** rechaza el cambio, no que la
// aplicación se porte bien. Un prisma falso probaría exactamente lo
// contrario de lo que este bloque cierra — el agujero era que la
// aplicación no es la única puerta a la base de datos
// (`docs/auditorias/2026-09-05-inalterabilidad-datos-venta.md`, nº 1).
// Por eso cada sabotaje entra por `$executeRawUnsafe`: SQL directo, como
// lo escribiría alguien con acceso al VPS.
//
// El caso canónico es el test 2: **un ticket sellado sobrevive a un
// UPDATE por SQL directo y el MISMO ticket acepta sin problema su
// transición a SYNCED.** Las dos cosas en el mismo test, porque el fallo
// típico de esto no es quedarse corto: es pasarse de estricto y romper
// el flujo de Holded.

import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { E2E_DATABASE_URL, e2eEnabled, SKIP_MESSAGE } from "./e2e-env.js";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = E2E_DATABASE_URL || "postgresql://e2e:e2e@127.0.0.1:5432/e2e";
process.env.REDIS_URL = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";
process.env.JWT_ACCESS_SECRET = "e".repeat(40);
process.env.JWT_REFRESH_SECRET = "f".repeat(40);
process.env.HOLDED_KEY_ENCRYPTION_SECRET = randomBytes(32).toString("base64");
process.env.Z_REPORT_STORAGE_ROOT = mkdtempSync(
  path.join(tmpdir(), "mipiacetpv-e2e-sello-"),
);

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
const { registerCreditRoutes } = await import("../src/tickets/credit-routes.js");
const { registerErrorHandler } = await import("../src/lib/error-handler.js");
const { registerLenientJsonParser } = await import("../src/lib/lenient-json.js");
const { signCashierSession } = await import("../src/shift/cashier-session.js");
const { recordTicketCorrection, CorrectionRejectedError } = await import(
  "../src/tickets/corrections.js"
);
const { computeSealHash, SEAL_TICKET_SELECT } = await import("../src/tickets/seal.js");
const { planVueltaBackfill } = await import("../src/tickets/backfill-vuelta.js");

describe.skipIf(!e2eEnabled)("e2e · el sello de la venta", () => {
  if (!e2eEnabled) console.warn(`\n${SKIP_MESSAGE}\n`);

  const prisma = getPrisma();
  let app: FastifyInstance;

  let tenantId = "";
  let registerId = "";
  let cashierId = "";
  let token = "";
  let shiftId = "";

  const auth = () => ({ authorization: `Bearer ${token}` });

  /** Una venta rápida, como la manda el TPV. */
  async function sell(args: {
    shiftId: string;
    unitPrice: number;
    taxRate?: number;
    payments: Array<{ method: "CASH" | "CARD"; amount: number }>;
    occurredAt?: Date;
    creditSale?: boolean;
    contactHoldedId?: string;
    cashAmount?: number;
  }): Promise<{ id: string; externalId: string; status: number; body: any }> {
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
            taxRate: args.taxRate ?? 10,
          },
        ],
        payments: args.payments,
        ...(args.cashAmount != null ? { cashAmount: args.cashAmount } : {}),
        ...(args.occurredAt ? { occurredAt: args.occurredAt.toISOString() } : {}),
        ...(args.creditSale ? { creditSale: true } : {}),
        ...(args.contactHoldedId ? { contactHoldedId: args.contactHoldedId } : {}),
      },
    });
    const body = res.json();
    return { id: body?.ticket?.id, externalId, status: res.statusCode, body };
  }

  interface SealRow {
    sealed_hash: string | null;
    sealed_at: Date | null;
    status: string;
    total: string;
  }

  async function sealRow(ticketId: string): Promise<SealRow> {
    const rows = await prisma.$queryRaw<SealRow[]>`
      SELECT sealed_hash, sealed_at, status::text AS status, total::text AS total
        FROM tickets WHERE id = ${ticketId}::uuid
    `;
    expect(rows).toHaveLength(1);
    return rows[0]!;
  }

  /** Lanza el CLI del backfill DE VERDAD contra esta base. No se simula
   *  su lógica: se ejecuta el binario que se lanzaría en producción. */
  function runBackfill(args: string[]): { status: number | null; output: string } {
    const apiRoot = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "..",
    );
    const res = spawnSync(
      path.join(apiRoot, "node_modules/.bin/tsx"),
      [path.join(apiRoot, "src/scripts/backfill-vuelta.ts"), ...args],
      {
        cwd: apiRoot,
        encoding: "utf8",
        env: { ...process.env, DATABASE_URL: E2E_DATABASE_URL },
      },
    );
    return {
      status: res.status,
      output: `${res.stdout ?? ""}\n${res.stderr ?? ""}`,
    };
  }

  /** Ejecuta SQL crudo y devuelve el mensaje del error, o null si pasó.
   *  Es el sabotaje: nada de rutas, nada de Prisma Client — SQL directo,
   *  como desde el VPS. */
  async function saboteo(sql: string): Promise<string | null> {
    try {
      await prisma.$executeRawUnsafe(sql);
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    }
  }

  beforeAll(async () => {
    app = Fastify({ logger: false });
    registerErrorHandler(app);
    registerLenientJsonParser(app);
    await registerShiftRoutes(app);
    await registerTicketRoutes(app);
    await registerCreditRoutes(app);
    await app.ready();

    const tenant = await prisma.tenant.create({
      data: {
        name: "Sello e2e",
        dayCutHour: 5,
        requireCashCountOnClose: false,
        // El fiado hace falta para el caso "cobrar un fiado no debe caer".
        creditSalesEnabled: true,
      },
      select: { id: true },
    });
    tenantId = tenant.id;
    const store = await prisma.store.create({
      data: { tenantId, name: "Local sello" },
      select: { id: true },
    });
    const register = await prisma.register.create({
      data: { storeId: store.id, name: "Caja sello" },
      select: { id: true },
    });
    registerId = register.id;
    const cashier = await prisma.user.create({
      data: {
        tenantId,
        email: `sello+${randomUUID()}@e2e.local`,
        alias: "Sole",
        role: "CASHIER",
      },
      select: { id: true },
    });
    cashierId = cashier.id;
    token = signCashierSession(
      { sub: cashierId, tid: tenantId, did: randomUUID(), rid: registerId, role: "CASHIER" },
      720,
    );

    const opened = await app.inject({
      method: "POST",
      url: "/shift/open",
      headers: auth(),
      payload: { cashOpening: 100 },
    });
    expect(opened.statusCode).toBe(201);
    shiftId = opened.json().shift.id as string;
  });

  afterAll(async () => {
    await app?.close();
    await shutdown();
  });

  // ────────────────────────────────────────────────────────────────────

  it("1 · el cobro se sella en el servidor, y el hash es el del conjunto económico", async () => {
    const sale = await sell({
      shiftId,
      unitPrice: 10,
      taxRate: 10,
      payments: [{ method: "CASH", amount: 11 }],
    });
    expect(sale.status).toBe(201);

    const row = await sealRow(sale.id);
    expect(row.sealed_at).not.toBeNull();
    expect(row.sealed_hash).toMatch(/^[0-9a-f]{64}$/);

    // Y el hash es reproducible desde la fila: se recalcula leyendo la
    // BD y tiene que dar exactamente lo mismo. Si no, el sello no
    // serviría para nada — no se podría verificar después.
    const stored = (await prisma.ticket.findUniqueOrThrow({
      where: { id: sale.id },
      select: SEAL_TICKET_SELECT,
    })) as any;
    expect(computeSealHash(stored)).toBe(row.sealed_hash);
  });

  it("2 · CANÓNICO · el ticket sellado sobrevive al UPDATE por SQL directo Y acepta pasar a SYNCED", async () => {
    const sale = await sell({
      shiftId,
      unitPrice: 20,
      payments: [{ method: "CARD", amount: 22 }],
    });
    expect(sale.status).toBe(201);
    const before = await sealRow(sale.id);

    // Sabotaje: subir un euro al total desde SQL, sin pasar por el TPV.
    const err = await saboteo(
      `UPDATE tickets SET total = total + 1 WHERE id = '${sale.id}'`,
    );
    expect(err).toMatch(/SELLO_VIOLADO/);
    expect(err).toMatch(/tickets\.total/);

    // El importe no se movió.
    const after = await sealRow(sale.id);
    expect(after.total).toBe(before.total);
    expect(after.sealed_hash).toBe(before.sealed_hash);

    // Sabotaje 2: mover la venta de turno. No es un importe, pero el
    // arqueo agrupa los pagos por `ticket.shift_id`, así que esto saca
    // la venta entera de un Z y la mete en otro sin tocar ni un euro.
    const otroTurno = await prisma.shift.create({
      data: { registerId, userId: cashierId, cashOpening: 0 },
      select: { id: true },
    });
    const errShift = await saboteo(
      `UPDATE tickets SET shift_id = '${otroTurno.id}' WHERE id = '${sale.id}'`,
    );
    expect(errShift).toMatch(/SELLO_VIOLADO/);
    expect(errShift).toMatch(/tickets\.shift_id/);
    expect(
      (await prisma.ticket.findUniqueOrThrow({
        where: { id: sale.id },
        select: { shiftId: true },
      })).shiftId,
    ).toBe(shiftId);
    // El turno de mentira se cierra para que no interfiera con el resto
    // de la suite (el test 9 cierra `shiftId` y cuenta sus Z).
    await prisma.shift.update({
      where: { id: otroTurno.id },
      data: { closedAt: new Date() },
    });

    // Y el flujo normal sigue vivo: el worker de Holded escribe status,
    // holded_document_id, holded_doc_number y synced_at sobre ESTE mismo
    // ticket sellado, sin ninguna ceremonia.
    await prisma.ticket.update({
      where: { id: sale.id },
      data: {
        status: "SYNCED",
        holdedDocumentId: "doc_holded_1",
        holdedDocNumber: "T260909",
        holdedPdfUrl: "https://holded/pdf",
        syncedAt: new Date(),
        syncError: undefined,
        emailFailedAt: new Date(),
        printIntent: false,
        emailIntent: "cliente@example.com",
        giftReceiptIntentAt: new Date(),
      },
    });
    const synced = await sealRow(sale.id);
    expect(synced.status).toBe("SYNCED");
    expect(synced.sealed_hash).toBe(before.sealed_hash);
  });

  it("3 · UPDATE de ticket_lines.unit_price sobre una venta sellada: lo rechaza el motor", async () => {
    const sale = await sell({
      shiftId,
      unitPrice: 5,
      payments: [{ method: "CASH", amount: 5.5 }],
    });
    const line = await prisma.ticketLine.findFirstOrThrow({
      where: { ticketId: sale.id },
      select: { id: true, unitPrice: true },
    });

    const err = await saboteo(
      `UPDATE ticket_lines SET unit_price = 0.01 WHERE id = '${line.id}'`,
    );
    expect(err).toMatch(/SELLO_VIOLADO/);

    const after = await prisma.ticketLine.findUniqueOrThrow({
      where: { id: line.id },
      select: { unitPrice: true },
    });
    expect(Number(after.unitPrice)).toBe(Number(line.unitPrice));
  });

  it("4 · DELETE de ticket_payments sobre una venta sellada: lo rechaza el motor", async () => {
    const sale = await sell({
      shiftId,
      unitPrice: 7,
      payments: [{ method: "CASH", amount: 7.7 }],
    });

    const err = await saboteo(
      `DELETE FROM ticket_payments WHERE ticket_id = '${sale.id}'`,
    );
    expect(err).toMatch(/SELLO_VIOLADO/);
    expect(err).toMatch(/devolución/);

    const left = await prisma.ticketPayment.count({ where: { ticketId: sale.id } });
    expect(left).toBe(1);

    // Y tampoco se pueden AÑADIR pagos a una venta sellada: colar una
    // fila cambia lo cobrado igual que editarla.
    const errInsert = await saboteo(
      `INSERT INTO ticket_payments (id, ticket_id, method, amount)
       VALUES ('${randomUUID()}', '${sale.id}', 'CASH', 100)`,
    );
    expect(errInsert).toMatch(/SELLO_VIOLADO/);
    expect(await prisma.ticketPayment.count({ where: { ticketId: sale.id } })).toBe(1);
  });

  it("5 · el ticket que llega tarde por el outbox se sella igual que el inmediato", async () => {
    // El terminal estuvo sin red: la venta ocurrió hace dos horas y llega
    // ahora. Es el tercer camino de entrada y el que rompería un sello
    // calculado en el terminal — aquí lo pone el servidor al llegar.
    const sale = await sell({
      shiftId,
      unitPrice: 3,
      payments: [{ method: "CASH", amount: 3.3 }],
      occurredAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
    });
    expect(sale.status).toBe(201);

    const row = await sealRow(sale.id);
    expect(row.sealed_at).not.toBeNull();
    expect(row.sealed_hash).toMatch(/^[0-9a-f]{64}$/);

    // Y el sello lo puso el servidor AHORA, no el terminal hace dos
    // horas: `sealed_at` es reciente aunque la venta sea vieja.
    expect(Date.now() - new Date(row.sealed_at!).getTime()).toBeLessThan(60_000);
  });

  it("6 · una corrección sin motivo se rechaza; con motivo, escribe traza y aplica", async () => {
    const sale = await sell({
      shiftId,
      unitPrice: 9,
      payments: [{ method: "CASH", amount: 9.9 }],
    });
    const line = await prisma.ticketLine.findFirstOrThrow({
      where: { ticketId: sale.id },
      select: { id: true },
    });

    // Sin motivo: ni traza ni cambio.
    await expect(
      recordTicketCorrection(prisma, {
        table: "ticket_lines",
        rowId: line.id,
        field: "sku",
        newValue: "OTRO-SKU",
        reason: "   ",
        author: "tester",
      }),
    ).rejects.toBeInstanceOf(CorrectionRejectedError);
    expect(
      await prisma.ticketCorrection.count({ where: { ticketId: sale.id } }),
    ).toBe(0);
    expect(
      (await prisma.ticketLine.findUniqueOrThrow({
        where: { id: line.id },
        select: { sku: true },
      })).sku,
    ).toBe("TPV-CAFE");

    // Y el motor lo rechaza también cuando se le llama en crudo, sin
    // pasar por el guardia de TypeScript.
    const errRaw = await saboteo(
      `SELECT record_ticket_correction('ticket_lines', '${line.id}', 'sku', 'X', '', 'tester')`,
    );
    expect(errRaw).toMatch(/CORRECCION_SIN_MOTIVO/);

    // Con motivo: se aplica y queda la traza completa.
    await recordTicketCorrection(prisma, {
      table: "ticket_lines",
      rowId: line.id,
      field: "sku",
      newValue: "TPV-CAFE-CANONICO",
      reason: "Holded rechazó el SKU: no es el canónico del producto",
      author: "owner@sello.e2e",
      userId: cashierId,
    });
    const corrections = await prisma.ticketCorrection.findMany({
      where: { ticketId: sale.id },
    });
    expect(corrections).toHaveLength(1);
    expect(corrections[0]).toMatchObject({
      tableName: "ticket_lines",
      field: "sku",
      oldValue: "TPV-CAFE",
      newValue: "TPV-CAFE-CANONICO",
      author: "owner@sello.e2e",
    });
    expect(
      (await prisma.ticketLine.findUniqueOrThrow({
        where: { id: line.id },
        select: { sku: true },
      })).sku,
    ).toBe("TPV-CAFE-CANONICO");

    // La traza es append-only: no se edita ni se borra.
    const errDel = await saboteo(
      `DELETE FROM ticket_corrections WHERE id = '${corrections[0]!.id}'`,
    );
    expect(errDel).toMatch(/SELLO_VIOLADO/);
    const errUpd = await saboteo(
      `UPDATE ticket_corrections SET reason = 'otra cosa' WHERE id = '${corrections[0]!.id}'`,
    );
    expect(errUpd).toMatch(/SELLO_VIOLADO/);
  });

  it("7 · backfill-vuelta contra una venta sellada: sin la vía de corrección no escribe", async () => {
    // La venta que reproduce el bug B1 de v1.15: se entregó un billete de
    // 5 por 3,30 € y el pago se persistió con lo ENTREGADO.
    const sale = await sell({
      shiftId,
      unitPrice: 3,
      payments: [{ method: "CASH", amount: 3.3 }],
      // `cashAmount` no nulo es el filtro de entrada del script.
      cashAmount: 5,
    });
    const payment = await prisma.ticketPayment.findFirstOrThrow({
      where: { ticketId: sale.id },
      select: { id: true, amount: true },
    });
    // Se infla el pago por debajo del sello para fabricar el histórico
    // que el backfill tiene que corregir. Se hace por la vía legítima —
    // es la única que existe.
    await recordTicketCorrection(prisma, {
      table: "ticket_payments",
      rowId: payment.id,
      field: "amount",
      newValue: "5.0000",
      reason: "montaje del test: reproduce el histórico con el bug B1 dentro",
      author: "script:test",
    });

    // Sabotaje: el backfill de antes de este bloque, que hacía
    // `ticketPayment.update` a pelo.
    await expect(
      prisma.ticketPayment.update({
        where: { id: payment.id },
        data: { amount: 3.3 },
      }),
    ).rejects.toThrow(/SELLO_VIOLADO/);
    expect(
      Number(
        (await prisma.ticketPayment.findUniqueOrThrow({
          where: { id: payment.id },
          select: { amount: true },
        })).amount,
      ),
    ).toBe(5);

    // El plan del backfill ve el ticket.
    const plan = planVueltaBackfill([
      {
        id: sale.id,
        internalNumber: "000000",
        total: 3.3,
        cashAmount: 5,
        payments: [{ id: payment.id, method: "CASH", amount: 5 }],
      },
    ]);
    expect(plan.tickets).toHaveLength(1);

    // Y ahora el script DE VERDAD, el binario que se lanza en
    // producción. Primero sin motivo: falla ruidosamente y no escribe.
    const sinMotivo = runBackfill(["--apply", "--motivo="]);
    expect(sinMotivo.status).not.toBe(0);
    expect(sinMotivo.output).toMatch(/sin motivo/i);
    expect(
      Number(
        (await prisma.ticketPayment.findUniqueOrThrow({
          where: { id: payment.id },
          select: { amount: true },
        })).amount,
      ),
    ).toBe(5);
    expect(
      await prisma.ticketCorrection.count({
        where: { ticketId: sale.id, author: "script:backfill-vuelta" },
      }),
    ).toBe(0);

    // Con motivo: corrige y deja la traza con el valor anterior.
    const conMotivo = runBackfill(["--apply"]);
    expect(conMotivo.status).toBe(0);
    expect(
      Number(
        (await prisma.ticketPayment.findUniqueOrThrow({
          where: { id: payment.id },
          select: { amount: true },
        })).amount,
      ),
    ).toBe(3.3);
    const trail = await prisma.ticketCorrection.findMany({
      where: { ticketId: sale.id, author: "script:backfill-vuelta" },
    });
    expect(trail).toHaveLength(1);
    expect(trail[0]!.oldValue).toBe("5.0000");
    expect(trail[0]!.newValue).toBe("3.3000");
    expect(trail[0]!.reason).toMatch(/v1\.15/);
  });

  it("8 · cobrar un fiado (baja creditPending) NO debe caer: está fuera del sello", async () => {
    const contactHoldedId = `contact-${randomUUID()}`;
    const sale = await sell({
      shiftId,
      unitPrice: 50,
      payments: [],
      creditSale: true,
      contactHoldedId,
    });
    expect(sale.status).toBe(201);

    // Mientras hay deuda viva el ticket NO está sellado: su `paid_at`
    // —columna sellada— todavía va a cambiar (la fecha fiscal es la del
    // saldo, variante B).
    const onCredit = await sealRow(sale.id);
    expect(onCredit.status).toBe("ON_CREDIT");
    expect(onCredit.sealed_at).toBeNull();

    // Cobro parcial: baja `credit_pending` y entra un TicketPayment
    // nuevo. Ninguna de las dos cosas debe caer.
    const partial = await app.inject({
      method: "POST",
      url: `/tickets/${sale.id}/credit-payments`,
      headers: auth(),
      payload: {
        externalId: randomUUID(),
        shiftId,
        method: "CASH",
        amount: 20,
      },
    });
    expect(partial.statusCode).toBe(201);
    expect((await sealRow(sale.id)).sealed_at).toBeNull();

    // Y al saldar, el fiado se sella.
    const rest = await app.inject({
      method: "POST",
      url: `/tickets/${sale.id}/credit-payments`,
      headers: auth(),
      payload: {
        externalId: randomUUID(),
        shiftId,
        method: "CASH",
        amount: 35,
      },
    });
    expect(rest.statusCode).toBe(201);
    const settled = await sealRow(sale.id);
    expect(settled.status).toBe("PAID");
    expect(settled.sealed_at).not.toBeNull();

    // `credit_pending` sigue siendo escribible después del sello: está
    // fuera de la lista de columnas económicas a propósito (ADR-015
    // §5.1). Si esto cayera, el fiado dejaría de funcionar.
    //
    // El UPDATE tiene que CAMBIAR el valor: el trigger sólo mira las
    // columnas que cambian, así que escribir el mismo número no probaría
    // nada. Se sube a 1 y se vuelve a bajar.
    expect(
      await saboteo(`UPDATE tickets SET credit_pending = 1 WHERE id = '${sale.id}'`),
    ).toBeNull();
    expect(
      await saboteo(`UPDATE tickets SET credit_pending = 0 WHERE id = '${sale.id}'`),
    ).toBeNull();
    expect(
      Number(
        (await prisma.ticket.findUniqueOrThrow({
          where: { id: sale.id },
          select: { creditPending: true },
        })).creditPending,
      ),
    ).toBe(0);
  });

  it("9 · cerrar turno y meter una venta después: el Z anterior se conserva y el nuevo lo marca como corregido", async () => {
    // El turno se abrió "ayer". Único viaje en el tiempo de la suite, y
    // toca sólo `opened_at`: hace falta para que la venta que llega
    // tarde caiga DENTRO de la ventana del turno cerrado y se impute
    // ahí (`pickShiftForOccurrence`), que es el caso real del outbox.
    await prisma.$executeRaw`
      UPDATE shifts SET opened_at = now() - interval '30 hours' WHERE id = ${shiftId}::uuid
    `;

    const closed = await app.inject({
      method: "POST",
      url: `/shift/${shiftId}/close`,
      headers: auth(),
      payload: { cashCounted: 100, methodTotals: {}, syncFailureAccepted: true },
    });
    expect(closed.statusCode).toBe(200);

    const first = await prisma.shiftZReport.findMany({
      where: { shiftId },
      orderBy: { sequence: "asc" },
    });
    expect(first).toHaveLength(1);
    expect(first[0]!.reason).toBe("CLOSE");
    expect(first[0]!.sealedHash).toMatch(/^[0-9a-f]{64}$/);
    expect(first[0]!.supersededAt).toBeNull();
    const firstHash = first[0]!.sealedHash;
    const firstBreakdown = JSON.stringify(first[0]!.breakdown);

    // Una venta del outbox que ocurrió ANTES del cierre y llega ahora.
    // Se imputa al turno cerrado y su Z deja de cuadrar.
    const late = await sell({
      shiftId,
      unitPrice: 40,
      payments: [{ method: "CASH", amount: 44 }],
      occurredAt: new Date(Date.now() - 5 * 60 * 1000),
    });
    expect(late.status).toBe(201);

    const all = await prisma.shiftZReport.findMany({
      where: { shiftId },
      orderBy: { sequence: "asc" },
    });
    expect(all).toHaveLength(2);

    // El Z del cierre sigue ahí, con su desglose y su huella INTACTOS.
    expect(all[0]!.sealedHash).toBe(firstHash);
    expect(JSON.stringify(all[0]!.breakdown)).toBe(firstBreakdown);
    // Y ahora dice que existe uno posterior que lo corrige.
    expect(all[0]!.supersededAt).not.toBeNull();
    expect(all[0]!.supersededById).toBe(all[1]!.id);

    // El correctivo trae el número nuevo y no reescribe el documento
    // emitido (nace sin PDF a propósito).
    expect(all[1]!.reason).toBe("LATE_SALE");
    expect(all[1]!.sequence).toBe(2);
    expect(all[1]!.pdfPath).toBeNull();
    expect(all[1]!.sealedHash).not.toBe(firstHash);

    // Y el turno lo dice: `z_report_stale` ya no significa "el PDF puede
    // estar caducado" sino "existe un Z posterior que corrige a este".
    const shift = await prisma.shift.findUniqueOrThrow({
      where: { id: shiftId },
      select: { zReportStale: true },
    });
    expect(shift.zReportStale).toBe(true);

    // Un Z archivado no se reescribe ni se borra.
    const errUpd = await saboteo(
      `UPDATE shift_z_reports SET sealed_hash = 'trucado' WHERE id = '${all[0]!.id}'`,
    );
    expect(errUpd).toMatch(/SELLO_VIOLADO/);
    const errDel = await saboteo(
      `DELETE FROM shift_z_reports WHERE id = '${all[0]!.id}'`,
    );
    expect(errDel).toMatch(/SELLO_VIOLADO/);
  });

  it("10 · convivencia pre-sello / sellado: los agregados suman las dos poblaciones sin mentir", async () => {
    // ADR-015 §5.2: el histórico anterior al despliegue queda con
    // `sealed_at IS NULL` para siempre. Se fabrica insertándolo sin
    // sello, que es exactamente como está el histórico real: nunca pasó
    // por la ruta de cobro de este bloque.
    const preSello = await prisma.ticket.create({
      data: {
        tenantId,
        registerId,
        shiftId,
        userId: cashierId,
        internalNumber: "PRE-001",
        externalId: randomUUID(),
        publicSlug: randomBytes(8).toString("hex"),
        status: "SYNCED",
        total: 12,
        totalTax: 2,
        totalDiscount: 0,
        paidAt: new Date(),
        lines: {
          create: [
            {
              sku: "TPV-VIEJO",
              nameSnapshot: "Venta anterior al sello",
              units: 1,
              unitPrice: 10,
              discountPct: 0,
              taxRate: 21,
              subtotal: 10,
              total: 12,
            },
          ],
        },
        payments: { create: [{ method: "CASH", amount: 12 }] },
      },
      select: { id: true, sealedAt: true },
    });
    expect(preSello.sealedAt).toBeNull();

    // Un ticket pre-sello SÍ se puede tocar: no se sella
    // retroactivamente, así que tampoco se puede afirmar nada sobre él.
    const err = await saboteo(
      `UPDATE tickets SET total = 13 WHERE id = '${preSello.id}'`,
    );
    expect(err).toBeNull();

    // Y el agregado del turno cuenta las dos poblaciones. Si el informe
    // filtrase por `sealed_at IS NOT NULL` se comería el histórico; si
    // no distinguiera, mentiría sobre lo que puede afirmar.
    const counts = await prisma.$queryRaw<Array<{ sellados: bigint; pre: bigint }>>`
      SELECT COUNT(*) FILTER (WHERE sealed_at IS NOT NULL) AS sellados,
             COUNT(*) FILTER (WHERE sealed_at IS NULL)     AS pre
        FROM tickets
       WHERE shift_id = ${shiftId}::uuid AND status NOT IN ('DRAFT', 'VOIDED')
    `;
    expect(Number(counts[0]!.sellados)).toBeGreaterThan(0);
    expect(Number(counts[0]!.pre)).toBe(1);
  });
});
