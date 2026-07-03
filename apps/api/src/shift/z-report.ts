import { promises as fs } from "node:fs";
import path from "node:path";

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

import type { ZBreakdown } from "./z-breakdown.js";

// Generador minimal del informe Z (PDF). Plantilla rudimentaria: una
// sola página con cabecera, datos del turno, desglose por método de
// pago (bruto / devoluciones / neto — v1.0-pilotos Lote 3 #28),
// descuadre. Se afinará cuando veamos el primer Z real (decisión
// pendiente §19.2.3).

export interface ZReportInput {
  shiftId: string;
  storeName: string;
  registerName: string;
  cashierLabel: string;
  closedByLabel: string | null;
  openedAt: Date;
  closedAt: Date;
  cashOpening: number;
  cashCounted: number;
  cashTheoretical: number;
  breakdown: ZBreakdown;
  ticketsCount: number;
  refundsCount: number;
  syncIssues: { pendingSync: number; failed: number };
  acceptedSyncFailures: boolean;
  // Email del encargado que autorizó el cierre con SYNC_FAILED. Audit
  // trail (B5 §2.3). Null si no hubo SYNC_FAILED o si autorizó un
  // MANAGER directamente sin PIN.
  managerAuthorizationEmail: string | null;
  // v1.7-alias-cajeros: alias del autorizador. Se imprime delante del
  // email — el email se conserva en el PDF como audit trail porque el
  // alias no es único globalmente.
  managerAuthorizationAlias: string | null;
}

const STORAGE_ROOT =
  process.env.Z_REPORT_STORAGE_ROOT ??
  path.resolve(process.cwd(), "storage", "z-reports");

function fmtEur(n: number): string {
  return `${n.toFixed(2).replace(".", ",")} €`;
}

export async function generateZReportPdf(input: ZReportInput): Promise<string> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([420, 600]); // tamaño aproximado ticket A6-ish.
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  let y = 570;
  const left = 30;
  const line = (text: string, opts?: { bold?: boolean; size?: number }) => {
    page.drawText(text, {
      x: left,
      y,
      size: opts?.size ?? 10,
      font: opts?.bold ? bold : font,
      color: rgb(0.1, 0.15, 0.2),
    });
    y -= (opts?.size ?? 10) + 4;
  };
  const hr = () => {
    page.drawLine({
      start: { x: left, y: y + 2 },
      end: { x: 390, y: y + 2 },
      thickness: 0.5,
      color: rgb(0.75, 0.78, 0.82),
    });
    y -= 8;
  };

  line("INFORME Z · MIPIACETPV", { bold: true, size: 14 });
  hr();
  line(`Tienda: ${input.storeName}`);
  line(`Caja: ${input.registerName}`);
  line(`Cajero: ${input.cashierLabel}`);
  if (input.closedByLabel && input.closedByLabel !== input.cashierLabel) {
    line(`Cerrado por: ${input.closedByLabel} (cierre forzado)`, { bold: true });
  }
  line(`Apertura: ${input.openedAt.toISOString()}`);
  line(`Cierre:   ${input.closedAt.toISOString()}`);
  hr();
  line(`Fondo inicial:  ${fmtEur(input.cashOpening)}`);
  line(`Cash teórico:   ${fmtEur(input.cashTheoretical)}`);
  line(`Cash contado:   ${fmtEur(input.cashCounted)}`);
  const descuadre = input.cashCounted - input.cashTheoretical;
  line(`Descuadre:      ${fmtEur(descuadre)}`, { bold: true });
  hr();
  line("Desglose por método de pago", { bold: true });
  line("  método    bruto       devol.      neto", { size: 8.5 });
  for (const m of input.breakdown.methods) {
    const counted = m.counted != null ? `  (contado ${fmtEur(m.counted)})` : "";
    line(
      `  ${m.method.padEnd(8)} ${fmtEur(m.gross).padStart(11)} ${fmtEur(
        m.refunds === 0 ? 0 : -m.refunds,
      ).padStart(11)} ${fmtEur(m.net).padStart(11)}${counted}`,
    );
  }
  hr();
  line(`Ventas brutas:    ${fmtEur(input.breakdown.grossSales)}`);
  line(`Devoluciones:     ${fmtEur(-input.breakdown.refundsTotal)}`);
  line(`Ventas netas:     ${fmtEur(input.breakdown.netSales)}`, { bold: true });
  hr();
  // v1.8-Fiado · dos secciones nuevas. Las ventas a crédito NO entraron
  // en caja (informativas); los cobros de deuda SÍ (ya sumados al teórico).
  const cs = input.breakdown.creditSales;
  line("Ventas a crédito (no cobradas)", { bold: true });
  line(`  Nº tickets: ${cs.count}    Importe: ${fmtEur(cs.total)}`);
  if (input.breakdown.creditCollections.length > 0) {
    hr();
    line("Cobros de deuda (este turno)", { bold: true });
    for (const c of input.breakdown.creditCollections) {
      line(`  ${c.method.padEnd(8)} ${fmtEur(c.amount).padStart(11)}`);
    }
    line(`  Total cobrado: ${fmtEur(input.breakdown.creditCollectionsTotal)}`, {
      bold: true,
    });
  }
  hr();
  line(`Tickets emitidos: ${input.ticketsCount}`);
  line(`Devoluciones (nº): ${input.refundsCount}`);
  if (input.syncIssues.pendingSync > 0 || input.syncIssues.failed > 0) {
    hr();
    line("Incidencias de sincronización Holded", { bold: true });
    line(`  Pendientes: ${input.syncIssues.pendingSync}`);
    line(`  Fallidas:   ${input.syncIssues.failed}`);
    if (input.acceptedSyncFailures) {
      line("Cierre autorizado con incidencias.", { bold: true });
    }
    if (input.managerAuthorizationEmail) {
      const alias = input.managerAuthorizationAlias?.trim();
      line(
        alias
          ? `Autorizado por: ${alias} (${input.managerAuthorizationEmail})`
          : `Autorizado por: ${input.managerAuthorizationEmail}`,
      );
    }
  }
  hr();
  line(`Shift ID: ${input.shiftId}`, { size: 8 });

  const bytes = await doc.save();
  await fs.mkdir(STORAGE_ROOT, { recursive: true });
  const filePath = path.join(STORAGE_ROOT, `${input.shiftId}.pdf`);
  await fs.writeFile(filePath, bytes);
  return filePath;
}
