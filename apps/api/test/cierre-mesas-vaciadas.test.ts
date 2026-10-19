// hierro-sirope (C) · LAS MESAS VACIADAS, EN LA PANTALLA Y EN EL PAPEL.
//
// `contarMesasVaciadas` existe desde auditoria-sirope (#18) y sólo llegaba
// al PDF del Z. El 18-10 se tiraron 1,50 € de M5 como Invitación y ni
// «Cerrar el día» ni «Turno cerrado» lo decían (capturas 43, 44, 50): para
// enterarte tenías que abrir el PDF, que es justo lo que nadie hace.
//
// Fila de la tabla de sabotajes:
//
//   | El resumen de cierre cuenta las vaciadas distinto que el PDF | esto
//
// La forma de que no puedan discrepar es que salgan de la MISMA función.
// Este banco lo afirma comparando el payload de `buildShiftDaySummary`
// —lo que ve la pantalla— con lo que `contarMesasVaciadas` le pasa al
// generador del PDF, sobre los mismos tickets.

import { randomBytes } from "node:crypto";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.REDIS_URL = "redis://localhost:6379";
process.env.JWT_ACCESS_SECRET = "a".repeat(40);
process.env.JWT_REFRESH_SECRET = "b".repeat(40);
process.env.HOLDED_KEY_ENCRYPTION_SECRET = randomBytes(32).toString("base64");

import { describe, expect, it } from "vitest";

import { buildShiftDaySummary } from "../src/shift/summary.js";
import {
  contarMesasVaciadas,
  ETIQUETA_MOTIVO,
} from "../src/shift/mesas-vaciadas.js";

const SHIFT = "00000000-0000-0000-0000-00000000000e";

interface TicketFalso {
  shiftId: string;
  status: string;
  total: number;
  voidReason: string | null;
  voidMotivo: string | null;
  lineas: number;
}

/**
 * Lo mínimo que `buildShiftDaySummary` le pide a Prisma. Nada de dobles
 * genéricos: lo que este banco tiene que poder afirmar es el reparto de
 * las vaciadas, y un falso que adivine de más esconde el fallo.
 */
function fakePrisma(tickets: TicketFalso[]) {
  return {
    ticket: {
      findMany: async ({ where }: any) => {
        return tickets
          .filter(
            (t) =>
              t.shiftId === where.shiftId &&
              (!where.status || t.status === where.status) &&
              (!where.voidReason?.in ||
                (t.voidReason != null &&
                  where.voidReason.in.includes(t.voidReason))),
          )
          .map((t) => ({
            total: t.total,
            voidMotivo: t.voidMotivo,
            _count: { lines: t.lineas },
          }));
      },
      count: async () => 2,
      aggregate: async () => ({ _count: { _all: 0 }, _sum: { total: null } }),
    },
    ticketPayment: { groupBy: async () => [] },
    refund: { groupBy: async () => [], count: async () => 1 },
    user: { findUnique: async () => ({ email: "soporte@mipiace.es", alias: null }) },
    shiftZReport: { findMany: async () => [] },
  } as never;
}

const TURNO = {
  id: SHIFT,
  registerId: "reg-2",
  userId: "u-1",
  openedAt: new Date("2026-10-18T07:00:00.000Z"),
  closedAt: new Date("2026-10-18T22:00:00.000Z"),
  closeReason: "MANUAL" as const,
  cashOpening: { toString: () => "50" },
  cashCounted: null,
  closedByUserId: null,
  zReportPdfPath: null,
  zReportStale: false,
  summaryAckAt: null,
  register: {
    id: "reg-2",
    name: "Caja 2",
    store: { id: "st-1", name: "Cafetería Sirope", tenantId: "t-1" },
  },
};

/** El servicio del 18-10: M5 invitada, una comanda equivocada y una mesa
 *  vacía que no cuenta. */
const SERVICIO: TicketFalso[] = [
  {
    shiftId: SHIFT,
    status: "VOIDED",
    total: 1.5,
    voidReason: "MANUAL",
    voidMotivo: "INVITACION",
    lineas: 1,
  },
  {
    shiftId: SHIFT,
    status: "VOIDED",
    total: 3,
    voidReason: "MANAGER_VOID",
    voidMotivo: "ERROR_DE_COMANDA",
    lineas: 2,
  },
  {
    shiftId: SHIFT,
    status: "VOIDED",
    total: 2.2,
    voidReason: "MANUAL",
    voidMotivo: "INVITACION",
    lineas: 1,
  },
  // Mesa abierta por error y cerrada sin pedir nada: no es nada y no sale.
  {
    shiftId: SHIFT,
    status: "VOIDED",
    total: 0,
    voidReason: "MANUAL",
    voidMotivo: null,
    lineas: 0,
  },
  // El barrido de las 05:00 sólo toca mesas vacías: tampoco cuenta.
  {
    shiftId: SHIFT,
    status: "VOIDED",
    total: 0,
    voidReason: "AUTO_ABANDONED_EMPTY",
    voidMotivo: null,
    lineas: 0,
  },
];

describe("hierro-sirope C · el resumen de cierre cuenta las mesas vaciadas", () => {
  it("y cuenta EXACTAMENTE lo mismo que el PDF del Z", async () => {
    const prisma = fakePrisma(SERVICIO);
    const [resumen, paraElPdf] = await Promise.all([
      buildShiftDaySummary(prisma, TURNO as never),
      contarMesasVaciadas(prisma, SHIFT),
    ]);

    expect(resumen.mesasVaciadas.count).toBe(paraElPdf.count);
    expect(resumen.mesasVaciadas.total).toBe(paraElPdf.total);
    expect(
      resumen.mesasVaciadas.porMotivo.map((m) => ({
        motivo: m.motivo,
        count: m.count,
        total: m.total,
      })),
    ).toEqual(paraElPdf.porMotivo);
  });

  it("tres mesas y 6,70 €, repartidos por motivo", async () => {
    const r = await buildShiftDaySummary(fakePrisma(SERVICIO), TURNO as never);
    expect(r.mesasVaciadas.count).toBe(3);
    expect(r.mesasVaciadas.total).toBe(6.7);
    expect(r.mesasVaciadas.porMotivo).toEqual([
      { motivo: "INVITACION", label: "Invitación", count: 2, total: 3.7 },
      {
        motivo: "ERROR_DE_COMANDA",
        label: "Error de comanda",
        count: 1,
        total: 3,
      },
    ]);
  });

  it("la etiqueta la escribe la MISMA tabla que el papel", async () => {
    const r = await buildShiftDaySummary(fakePrisma(SERVICIO), TURNO as never);
    for (const m of r.mesasVaciadas.porMotivo) {
      expect(m.label).toBe(
        m.motivo ? ETIQUETA_MOTIVO[m.motivo as "INVITACION"] : "Sin motivo",
      );
    }
  });

  it("un turno sin vaciados devuelve 0 y la pantalla no pinta nada", async () => {
    const r = await buildShiftDaySummary(fakePrisma([]), TURNO as never);
    expect(r.mesasVaciadas).toEqual({ count: 0, total: 0, porMotivo: [] });
  });
});
