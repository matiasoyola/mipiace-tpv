// puesta-en-marcha (ADR-021) · resetear el ensayo y empezar a facturar.
//
// Lo que este fichero fija es QUÉ DECIDE el código, con un Prisma falso que
// lleva la cuenta de a qué tablas se le ha pedido borrar algo:
//
//   1. Resetear con la cuenta FACTURANDO → `TenantFacturandoError`. No hay
//      camino, y la comprobación va DENTRO de la transacción.
//   2. Lo que el reseteo borra: tickets de ensayo y borradores, turnos,
//      agrupaciones de mesas, contadores.
//   3. Lo que NO toca: ni el catálogo, ni los cajeros, ni los terminales, ni
//      las impresoras, ni los contactos, ni —sobre todo— `fiscal_records`.
//      Se comprueba de la única forma que no se puede falsear: que a esas
//      tablas no se les llame a borrar NUNCA.
//   4. Las cuatro precondiciones de arrancar, cada una por separado y todas
//      a la vez.
//   5. Que arrancar fije la fecha, y que lo haga DESPUÉS de resetear.
//
// Lo que NO está aquí y está en `test-e2e/puesta-en-marcha.e2e.ts`: que los
// borrados pasen de verdad por las FK y por los triggers del sello, y que la
// primera venta después de arrancar sea la `C1/1`. Eso son afirmaciones sobre
// Postgres, no sobre TypeScript.

import { randomBytes } from "node:crypto";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.REDIS_URL = "redis://localhost:6379";
process.env.JWT_ACCESS_SECRET = "a".repeat(40);
process.env.JWT_REFRESH_SECRET = "b".repeat(40);
process.env.HOLDED_KEY_ENCRYPTION_SECRET = randomBytes(32).toString("base64");

import { describe, expect, it, vi } from "vitest";

const TENANT_ID = "11111111-1111-1111-1111-111111111111";
const CAJA_1 = "22222222-2222-2222-2222-222222222222";
const CAJA_2 = "22222222-2222-2222-2222-222222222223";

const FACTURANDO = new Date("2026-06-01T08:00:00.000Z");
const ARRANQUE = new Date("2026-10-17T10:30:00.000Z");

const {
  arrancarFacturacion,
  ArranqueBloqueadoError,
  EnsayoConVentaRealError,
  previsualizarPuestaEnMarcha,
  resetearEnsayo,
  TenantFacturandoError,
} = await import("../src/fiscal/puesta-en-marcha.js");

interface Opciones {
  facturaDesde?: Date | null;
  esDePruebas?: boolean;
  /** Los tickets de la cuenta, con su estado. Default: un ensayo normal. */
  tickets?: Array<{
    id: string;
    status: string;
    internalNumber?: string;
    holdedDocumentId?: string | null;
  }>;
  /** Registros fiscales colgando de un ticket (la otra señal de «esto no es
   *  de ensayo»). */
  registrosConTicket?: Array<{ ticketId: string; numSerieFactura: string }>;
  /** Registros fiscales por caja. Vacío = cadena limpia. */
  registros?: Record<string, number>;
  /** Terminales emparejados por caja. */
  terminales?: Record<string, number>;
  cajas?: Array<{ id: string; name: string; ticketCounter?: number }>;
  fiscalProfile?: unknown;
}

/** El Prisma falso, y el espía de lo que se borra.
 *
 *  `borradoDe` apunta cada `deleteMany`/`updateMany` por tabla. Es lo que
 *  permite afirmar «esto NO se toca» sin tener que montar una base: si
 *  mañana alguien añade un `product.deleteMany` al reseteo, el test de lo
 *  que se conserva se pone rojo. */
function fake(opts: Opciones = {}) {
  const cajas = opts.cajas ?? [{ id: CAJA_1, name: "Caja 1", ticketCounter: 7 }];
  // Un ensayo normal: tres de prueba, un borrador y dos anuladas — que es la
  // forma que tenía Sirope en la foto de producción del 18-10.
  const tickets =
    opts.tickets ??
    [
      { id: "t1", status: "TEST" },
      { id: "t2", status: "TEST" },
      { id: "t3", status: "TEST" },
      { id: "t4", status: "DRAFT" },
      { id: "t5", status: "VOIDED" },
      { id: "t6", status: "VOIDED" },
    ].map((t) => ({ ...t, internalNumber: t.id, holdedDocumentId: null }));
  const tenant = {
    id: TENANT_ID,
    name: "CAFETERÍA SIROPE SL",
    onboardingState: "ACTIVE",
    esDePruebas: opts.esDePruebas ?? false,
    facturaDesde: opts.facturaDesde ?? null,
    fiscalProfile:
      opts.fiscalProfile === undefined
        ? { legalName: "CAFETERÍA SIROPE SL", taxId: "B45902186" }
        : opts.fiscalProfile,
  };
  const borradoDe: Record<string, number> = {};
  const apunta = (tabla: string) => {
    borradoDe[tabla] = (borradoDe[tabla] ?? 0) + 1;
  };
  const tenantUpdates: Array<Record<string, unknown>> = [];
  const ticketDeletes: Array<unknown> = [];
  const contador = () => ({ count: 0 });

  const db: Record<string, any> = {
    tenant: {
      findUnique: vi.fn(async () => tenant),
      findUniqueOrThrow: vi.fn(async () => tenant),
      update: vi.fn(async ({ data }: any) => {
        tenantUpdates.push(data);
        return tenant;
      }),
    },
    register: {
      findMany: vi.fn(async () =>
        cajas.map((c) => ({
          id: c.id,
          name: c.name,
          ticketCounter: c.ticketCounter ?? 0,
          fiscalSeries: "C1",
          fiscalInstallationId: "inst-1",
          store: { name: "Cafetería Sirope" },
        })),
      ),
      updateMany: vi.fn(async () => ({ count: cajas.length })),
    },
    ticket: {
      count: vi.fn(async ({ where }: any) =>
        where?.status
          ? tickets.filter((t) => t.status === where.status).length
          : tickets.length,
      ),
      groupBy: vi.fn(async () => {
        const m = new Map<string, number>();
        for (const t of tickets) m.set(t.status, (m.get(t.status) ?? 0) + 1);
        return [...m.entries()].map(([status, n]) => ({
          status,
          _count: { _all: n },
        }));
      }),
      findMany: vi.fn(async ({ where }: any) => {
        // `holdedDocumentId: { not: null }` es la consulta del guardián.
        if (where?.holdedDocumentId) {
          return tickets.filter((t) => t.holdedDocumentId != null);
        }
        return where?.status
          ? tickets.filter((t) => t.status === where.status)
          : tickets;
      }),
      deleteMany: vi.fn(async ({ where }: any) => {
        apunta("ticket");
        ticketDeletes.push(where);
        return { count: tickets.length };
      }),
    },
    refund: {
      count: vi.fn(async () => 1),
      deleteMany: vi.fn(async () => {
        apunta("refund");
        return { count: 1 };
      }),
    },
    ticketEmailJob: {
      count: vi.fn(async () => 2),
      deleteMany: vi.fn(async () => {
        apunta("ticketEmailJob");
        return { count: 2 };
      }),
    },
    shift: {
      count: vi.fn(async () => 2),
      updateMany: vi.fn(async () => contador()),
      deleteMany: vi.fn(async () => {
        apunta("shift");
        return { count: 2 };
      }),
    },
    shiftCashCount: { count: vi.fn(async () => 1) },
    shiftZReport: { count: vi.fn(async () => 1) },
    kitchenOrder: { count: vi.fn(async () => 4) },
    table: {
      count: vi.fn(async () => 9),
      updateMany: vi.fn(async () => ({ count: 2 })),
      deleteMany: vi.fn(async () => {
        apunta("table");
        return contador();
      }),
    },
    product: {
      count: vi.fn(async () => 87),
      deleteMany: vi.fn(async () => {
        apunta("product");
        return contador();
      }),
    },
    user: {
      count: vi.fn(async () => 3),
      findFirst: vi.fn(async () => null),
      update: vi.fn(async () => ({})),
      deleteMany: vi.fn(async () => {
        apunta("user");
        return contador();
      }),
    },
    device: {
      count: vi.fn(async () => 1),
      groupBy: vi.fn(async () =>
        cajas.map((c) => ({
          registerId: c.id,
          _count: { _all: opts.terminales?.[c.id] ?? 1 },
        })),
      ),
      updateMany: vi.fn(async () => {
        apunta("device");
        return contador();
      }),
      deleteMany: vi.fn(async () => {
        apunta("device");
        return contador();
      }),
    },
    printerConfig: {
      count: vi.fn(async () => 1),
      deleteMany: vi.fn(async () => {
        apunta("printerConfig");
        return contador();
      }),
    },
    contact: {
      count: vi.fn(async () => 42),
      deleteMany: vi.fn(async () => {
        apunta("contact");
        return contador();
      }),
    },
    fiscalRecord: {
      findMany: vi.fn(async () =>
        (opts.registrosConTicket ?? []).map((r) => ({
          ticketId: r.ticketId,
          numSerieFactura: r.numSerieFactura,
          ticket: {
            internalNumber: r.ticketId,
            status: tickets.find((t) => t.id === r.ticketId)?.status ?? "PAID",
          },
        })),
      ),
      groupBy: vi.fn(async () =>
        cajas
          .filter((c) => (opts.registros?.[c.id] ?? 0) > 0)
          .map((c) => ({
            registerId: c.id,
            _count: { _all: opts.registros![c.id]! },
          })),
      ),
      deleteMany: vi.fn(async () => {
        apunta("fiscalRecord");
        return contador();
      }),
    },
    holdedUpload: {
      deleteMany: vi.fn(async () => {
        apunta("holdedUpload");
        return { count: 0 };
      }),
    },
    // B-reservas-8 · los bonos de prueba que NO colgaban de un ticket (las
    // altas iniciales del ensayo). Los vendidos se van con su ticket por
    // la cascada de `vouchers.sold_ticket_id`, que este doble no simula —
    // eso se prueba contra Postgres real en `bonos-venta.e2e.ts`.
    voucher: {
      deleteMany: vi.fn(async () => {
        apunta("voucher");
        return { count: 0 };
      }),
    },
  };
  db.$transaction = vi.fn(async (fn: any) => fn(db));
  return { db, borradoDe, tenantUpdates, ticketDeletes, tenant };
}

describe("la previsualización", () => {
  it("una cuenta en ensayo: se puede resetear y se puede arrancar", async () => {
    const { db } = fake();
    const previa = await previsualizarPuestaEnMarcha(db as any, TENANT_ID);
    expect(previa.estado).toBe("ensayo");
    expect(previa.facturaDesde).toBeNull();
    expect(previa.puedeResetear).toBe(true);
    expect(previa.puedeArrancar).toBe(true);
    expect(previa.bloqueos).toEqual([]);
    // Y los números de lo que se conserva salen de consultas, no de una
    // promesa: «se conserva el catálogo» no se puede comprobar, «87
    // productos» sí.
    expect(previa.conserva.productos).toBe(87);
    expect(previa.conserva.cajeros).toBe(3);
    expect(previa.conserva.contactos).toBe(42);
    expect(previa.conserva.datosFiscales).toBe(true);
    // Y el desglose de lo que se va, por estado: «20 anuladas» no se lee
    // igual que «3 de ensayo», y con el desglose delante nadie pulsa sin
    // saber qué se borra.
    expect(previa.ensayo.ticketsPorEstado).toEqual([
      { estado: "DRAFT", cuantos: 1 },
      { estado: "TEST", cuantos: 3 },
      { estado: "VOIDED", cuantos: 2 },
    ]);
    expect(previa.ensayo.ticketsTotales).toBe(6);
    expect(previa.ventasQueNoSonDeEnsayo).toEqual([]);
  });

  it("una cuenta que factura: ni se resetea ni se vuelve a arrancar", async () => {
    const { db } = fake({ facturaDesde: FACTURANDO });
    const previa = await previsualizarPuestaEnMarcha(db as any, TENANT_ID);
    expect(previa.estado).toBe("facturando");
    expect(previa.puedeResetear).toBe(false);
    expect(previa.puedeArrancar).toBe(false);
    expect(previa.bloqueos.map((b) => b.codigo)).toContain("YA_FACTURA");
  });
});

describe("resetear el ensayo", () => {
  it("borra TODOS los tickets, sea cual sea su estado, y los turnos", async () => {
    const { db, borradoDe, ticketDeletes } = fake();
    const r = await resetearEnsayo({ prisma: db as any, tenantId: TENANT_ID });
    expect(borradoDe.ticket).toBe(1);
    expect(borradoDe.shift).toBe(1);
    expect(borradoDe.refund).toBe(1);
    expect(r.turnosBorrados).toBe(2);
    expect(r.mesasDesagrupadas).toBe(2);
    // UNA llamada y SIN filtro de estado. Es la decisión del 18-10: en una
    // cuenta en ensayo nada es real, así que se van todos — también las dos
    // anuladas, que es lo que Sirope tenía dentro y un reseteo por estados
    // le habría dejado en el arqueo.
    expect(ticketDeletes).toEqual([{ tenantId: TENANT_ID }]);
  });

  it("y dice cuántos se llevó DE CADA ESTADO", async () => {
    const { db } = fake();
    const r = await resetearEnsayo({ prisma: db as any, tenantId: TENANT_ID });
    // Después de borrarlos no se pueden volver a contar: este desglose es la
    // única copia, y es lo que va al registro de auditoría.
    expect(r.ticketsPorEstado).toEqual([
      { estado: "DRAFT", cuantos: 1 },
      { estado: "TEST", cuantos: 3 },
      { estado: "VOIDED", cuantos: 2 },
    ]);
    expect(r.ticketsBorrados).toBe(6);
    expect(r.ticketsDeEnsayoBorrados).toBe(3);
  });

  it("y pone a cero el contador de referencia interna de cada caja", async () => {
    const { db } = fake();
    const r = await resetearEnsayo({ prisma: db as any, tenantId: TENANT_ID });
    // Arrancar con «TICKET 000008» después de siete ventas de ensayo es
    // contarle al cliente que ya había vendido.
    expect(r.contadoresAZero).toBe(1);
    expect(db.register.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { ticketCounter: 0 } }),
    );
  });

  it("NO toca el catálogo, la sala, los cajeros, los terminales ni los contactos", async () => {
    const { db, borradoDe } = fake();
    await resetearEnsayo({ prisma: db as any, tenantId: TENANT_ID });
    // Todo lo que cuesta una tarde de implantación se queda. Si mañana
    // alguien añade uno de estos borrados al reseteo, esto se pone rojo.
    expect(borradoDe.product).toBeUndefined();
    expect(borradoDe.user).toBeUndefined();
    expect(borradoDe.contact).toBeUndefined();
    expect(borradoDe.printerConfig).toBeUndefined();
    expect(borradoDe.table).toBeUndefined();
    // Las mesas se DESAGRUPAN, que no es borrarlas.
    expect(db.table.updateMany).toHaveBeenCalled();
    // El terminal del cliente no se revoca: resetear no es activar.
    expect(borradoDe.device).toBeUndefined();
  });

  it("y NO borra ningún registro fiscal, ni lo intenta", async () => {
    const { db, borradoDe } = fake();
    await resetearEnsayo({ prisma: db as any, tenantId: TENANT_ID });
    // La frase entera del bloque en una aserción: en una cuenta en ensayo
    // `fiscal_records` está vacía, así que el reseteo no tiene nada que
    // borrar ahí — y no lo pide. El append-only sigue sin puertas.
    expect(borradoDe.fiscalRecord).toBeUndefined();
    expect(db.fiscalRecord.deleteMany).not.toHaveBeenCalled();
  });

  // ── La puerta nueva del 18-10 ───────────────────────────────────────
  //
  // En una cuenta en ensayo nada es real. Si algo lo es, el reseteo se para
  // en seco y dice CUÁL: borrarlo sería borrar una venta que existe en la
  // contabilidad de alguien.

  it("se para si un ticket llegó a Holded, y no borra nada", async () => {
    const { db, borradoDe } = fake({
      tickets: [
        { id: "t1", status: "TEST", internalNumber: "000001", holdedDocumentId: null },
        {
          id: "t9",
          status: "VOIDED",
          internalNumber: "000009",
          holdedDocumentId: "6714aa0f9c3e1b0012345678",
        },
      ],
    });
    const err = await resetearEnsayo({
      prisma: db as any,
      tenantId: TENANT_ID,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(EnsayoConVentaRealError);
    expect(err.ventas).toHaveLength(1);
    expect(err.ventas[0].internalNumber).toBe("000009");
    expect(err.ventas[0].motivo).toBe("HOLDED");
    // Anulada DESPUÉS, y da igual: si llegó a Holded, existió allí un
    // documento con número y eso no se deshace borrando el ticket aquí.
    expect(err.ventas[0].estado).toBe("VOIDED");
    // Y el mensaje lleva el número dentro: «no se puede» no sirve de nada.
    expect(err.message).toContain("000009");
    // Lo importante: NADA se borró antes de parar.
    expect(Object.keys(borradoDe)).toEqual([]);
  });

  it("se para si un ticket tiene factura emitida, y dice cuál", async () => {
    const { db, borradoDe } = fake({
      tickets: [
        { id: "t1", status: "PAID", internalNumber: "000001", holdedDocumentId: null },
      ],
      registrosConTicket: [{ ticketId: "t1", numSerieFactura: "C1/000001" }],
    });
    const err = await resetearEnsayo({
      prisma: db as any,
      tenantId: TENANT_ID,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(EnsayoConVentaRealError);
    expect(err.ventas[0].motivo).toBe("REGISTRO_FISCAL");
    expect(err.ventas[0].numSerieFactura).toBe("C1/000001");
    expect(err.message).toContain("C1/000001");
    expect(Object.keys(borradoDe)).toEqual([]);
  });

  it("y la previsualización lo enseña como bloqueo de las DOS acciones", async () => {
    const { db } = fake({
      tickets: [
        {
          id: "t9",
          status: "VOIDED",
          internalNumber: "000009",
          holdedDocumentId: "6714aa0f9c3e1b0012345678",
        },
      ],
    });
    const previa = await previsualizarPuestaEnMarcha(db as any, TENANT_ID);
    expect(previa.ventasQueNoSonDeEnsayo).toHaveLength(1);
    expect(previa.puedeResetear).toBe(false);
    expect(previa.puedeArrancar).toBe(false);
    expect(previa.bloqueos.map((b) => b.codigo)).toContain("VENTA_REAL_EN_ENSAYO");
  });

  it("con la cuenta FACTURANDO lanza y no borra nada", async () => {
    const { db, borradoDe } = fake({ facturaDesde: FACTURANDO });
    await expect(
      resetearEnsayo({ prisma: db as any, tenantId: TENANT_ID }),
    ).rejects.toBeInstanceOf(TenantFacturandoError);
    // Lo importante no es el error: es que no se borró NADA antes de
    // lanzarlo. La comprobación va dentro de la transacción y lo primero.
    expect(Object.keys(borradoDe)).toEqual([]);
  });
});

describe("empezar a facturar", () => {
  it("fija la fecha y deja la cuenta facturando", async () => {
    const { db, tenantUpdates } = fake();
    const r = await arrancarFacturacion({
      prisma: db as any,
      tenantId: TENANT_ID,
      ahora: ARRANQUE,
    });
    expect(r.facturaDesde).toBe(ARRANQUE.toISOString());
    expect(tenantUpdates).toEqual([{ facturaDesde: ARRANQUE }]);
  });

  it("resetea ANTES de fijar la fecha", async () => {
    const { db } = fake();
    const orden: string[] = [];
    db.ticket.deleteMany.mockImplementation(async () => {
      orden.push("borra tickets");
      return { count: 1 };
    });
    db.tenant.update.mockImplementation(async () => {
      orden.push("fija la fecha");
      return {};
    });
    await arrancarFacturacion({
      prisma: db as any,
      tenantId: TENANT_ID,
      ahora: ARRANQUE,
    });
    // Y no al revés: lo que quedara sin borrar pasaría a ser histórico de un
    // comercio que factura, y entonces ya no se puede borrar sin tocarle la
    // contabilidad.
    expect(orden[orden.length - 1]).toBe("fija la fecha");
    expect(orden).toContain("borra tickets");
  });

  it("no arranca si una caja ya tiene registros de facturación", async () => {
    const { db, tenantUpdates } = fake({ registros: { [CAJA_1]: 2 } });
    const err = await arrancarFacturacion({
      prisma: db as any,
      tenantId: TENANT_ID,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(ArranqueBloqueadoError);
    expect(err.bloqueos.map((b: any) => b.codigo)).toContain("CAJA_CON_REGISTROS");
    // La lección del 06-10 en La Maestranza: una cuenta con registros no
    // arranca, se investiga. Y no se escribe nada por el camino.
    expect(tenantUpdates).toEqual([]);
  });

  it("no arranca una cuenta nuestra de pruebas", async () => {
    const { db } = fake({ esDePruebas: true });
    const err = await arrancarFacturacion({
      prisma: db as any,
      tenantId: TENANT_ID,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(ArranqueBloqueadoError);
    expect(err.bloqueos.map((b: any) => b.codigo)).toContain("TENANT_DE_PRUEBAS");
  });

  it("no arranca sin los datos fiscales completos", async () => {
    const { db } = fake({ fiscalProfile: null });
    const err = await arrancarFacturacion({
      prisma: db as any,
      tenantId: TENANT_ID,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(ArranqueBloqueadoError);
    expect(err.bloqueos.map((b: any) => b.codigo)).toContain("DATOS_FISCALES");
  });

  it("no arranca sin ningún terminal emparejado", async () => {
    const { db } = fake({ terminales: { [CAJA_1]: 0 } });
    const err = await arrancarFacturacion({
      prisma: db as any,
      tenantId: TENANT_ID,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(ArranqueBloqueadoError);
    // El registro de facturación lo GENERA el terminal (ADR-019): arrancar
    // sin ninguno es dejar la cuenta facturando sin nadie que pueda emitir.
    expect(err.bloqueos.map((b: any) => b.codigo)).toContain("SIN_TERMINAL");
  });

  it("con una caja sin terminal y otra con terminal, SÍ arranca", async () => {
    const { db } = fake({
      cajas: [
        { id: CAJA_1, name: "Caja 1" },
        { id: CAJA_2, name: "Caja 2" },
      ],
      terminales: { [CAJA_1]: 0, [CAJA_2]: 1 },
    });
    const previa = await previsualizarPuestaEnMarcha(db as any, TENANT_ID);
    // La exigencia es «al menos un terminal», no «uno por caja»: un bar con
    // dos cajas y una tablet está facturando perfectamente.
    expect(previa.bloqueos.map((b) => b.codigo)).not.toContain("SIN_TERMINAL");
    expect(previa.puedeArrancar).toBe(true);
  });

  it("y cuando falla por varias cosas, las dice TODAS", async () => {
    const { db } = fake({
      esDePruebas: true,
      fiscalProfile: null,
      registros: { [CAJA_1]: 1 },
      terminales: { [CAJA_1]: 0 },
    });
    const previa = await previsualizarPuestaEnMarcha(db as any, TENANT_ID);
    const codigos = previa.bloqueos.map((b) => b.codigo);
    // Quien está delante del cliente los resuelve de una pasada, no de uno
    // en uno con un viaje a la pantalla anterior por cada uno.
    expect(codigos).toContain("TENANT_DE_PRUEBAS");
    expect(codigos).toContain("CAJA_CON_REGISTROS");
    expect(codigos).toContain("DATOS_FISCALES");
    expect(codigos).toContain("SIN_TERMINAL");
  });
});
