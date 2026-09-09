// S1-sello · el Z, congelado como dato.
//
// El problema (auditoría 2026-09-05, agujero nº 4): el Z se persistía
// como PDF en `shifts.z_report_pdf_path`, un fichero en disco
// sustituible sin que nada lo detecte, y `zReportStale` existía porque
// entran ventas después de generarlo. Un cierre que puede quedar
// "caducado" no es un cierre sellado.
//
// Lo que cambia:
//
//   · El desglose deja de vivir sólo en el PDF y se congela en
//     `shift_z_reports`, con su SHA-256.
//   · Una venta tardía NO invalida el Z anterior: emite uno nuevo
//     (`sequence` +1) y marca el anterior como corregido, conservado.
//     `Shift.zReportStale` pasa a significar exactamente eso: "existe un
//     Z posterior que corrige a este".
//
// El correctivo nace sin PDF a propósito. El documento emitido —el que
// se le enseñó a alguien— es el del cierre y no se reescribe; lo que el
// correctivo congela es el número corregido, que es lo que faltaba.

import { createHash } from "node:crypto";

import type { getPrisma } from "../context.js";
import { loadShiftBreakdownSums } from "./breakdown-sums.js";
import { computeZBreakdown, type ZBreakdown } from "./z-breakdown.js";

type PrismaLike = ReturnType<typeof getPrisma>;

export type ZReportReason = "CLOSE" | "LATE_SALE";

/** Lo que se congela. El desglose por método más los cuatro números que
 *  el Z afirma sobre la caja y los recuentos de documentos emitidos. */
export interface FrozenZ {
  cashOpening: number;
  cashCounted: number | null;
  cashTheoretical: number;
  ticketsCount: number;
  refundsCount: number;
  breakdown: ZBreakdown;
}

/** Igual que el sello de la venta: claves ordenadas, para que el hash no
 *  dependa del orden en que Postgres devolvió el JSON. */
function canonicalize(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === "object") {
    const src = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(src).sort()) out[key] = canonicalize(src[key]);
    return out;
  }
  return value;
}

export function computeZHash(frozen: FrozenZ): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(frozen)), "utf8")
    .digest("hex");
}

/**
 * Archiva un Z. Si ya había uno para el turno, el nuevo lo corrige: el
 * anterior queda marcado (`superseded_at` / `superseded_by_id`) y
 * conservado, nunca reescrito.
 *
 * Todo en una transacción, con el `sequence` calculado dentro: dos
 * ventas tardías simultáneas no pueden emitir el mismo número (hay
 * UNIQUE en (shift_id, sequence) — si empatan, una reintenta o falla,
 * y falla es preferible a dos Z que dicen ser el mismo).
 */
export async function archiveZReport(
  prisma: PrismaLike,
  args: {
    shiftId: string;
    reason: ZReportReason;
    frozen: FrozenZ;
    pdfPath?: string | null;
  },
): Promise<{ id: string; sequence: number; sealedHash: string }> {
  const sealedHash = computeZHash(args.frozen);
  return prisma.$transaction(async (tx) => {
    const previous = await tx.shiftZReport.findFirst({
      where: { shiftId: args.shiftId },
      orderBy: { sequence: "desc" },
      select: { id: true, sequence: true, supersededAt: true },
    });
    const sequence = (previous?.sequence ?? 0) + 1;
    const created = await tx.shiftZReport.create({
      data: {
        shiftId: args.shiftId,
        sequence,
        breakdown: args.frozen as unknown as object,
        sealedHash,
        pdfPath: args.pdfPath ?? null,
        reason: args.reason,
      },
      select: { id: true, sequence: true },
    });
    if (previous && previous.supersededAt == null) {
      await tx.shiftZReport.update({
        where: { id: previous.id },
        data: { supersededAt: new Date(), supersededById: created.id },
      });
    }
    return { id: created.id, sequence: created.sequence, sealedHash };
  });
}

/**
 * Recalcula el desglose del turno tal y como está AHORA y archiva un Z
 * correctivo. Es lo que dispara una venta que entra en un turno ya
 * cerrado.
 *
 * `cashCounted` se copia del turno: lo que contó el cajero al cerrar no
 * cambia porque haya entrado una venta tardía — lo que cambia es el
 * teórico, y por tanto el descuadre. Decirlo es justamente el punto.
 */
export async function archiveCorrectiveZReport(
  prisma: PrismaLike,
  shiftId: string,
): Promise<{ id: string; sequence: number; sealedHash: string } | null> {
  const shift = await prisma.shift.findUnique({
    where: { id: shiftId },
    select: { id: true, cashOpening: true, cashCounted: true, closedAt: true },
  });
  // Un turno abierto no tiene Z que corregir.
  if (!shift || shift.closedAt == null) return null;

  const [sums, ticketsCount, refundsCount] = await Promise.all([
    loadShiftBreakdownSums(prisma, shiftId),
    prisma.ticket.count({
      where: { shiftId, status: { notIn: ["DRAFT", "VOIDED"] } },
    }),
    prisma.refund.count({
      where: { shiftId, status: { notIn: ["DRAFT", "VOIDED"] } },
    }),
  ]);
  const cashCounted =
    shift.cashCounted != null ? Number(shift.cashCounted) : null;
  const breakdown = computeZBreakdown({
    cashOpening: Number(shift.cashOpening),
    ...sums,
    ...(cashCounted != null ? { counted: { CASH: cashCounted } } : {}),
  });
  return archiveZReport(prisma, {
    shiftId,
    reason: "LATE_SALE",
    frozen: {
      cashOpening: Number(shift.cashOpening),
      cashCounted,
      cashTheoretical: breakdown.cashTheoretical,
      ticketsCount,
      refundsCount,
      breakdown,
    },
  });
}
