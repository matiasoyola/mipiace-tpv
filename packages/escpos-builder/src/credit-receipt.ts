// v1.8-Fiado · justificante de cobro de deuda (recibo simple NO fiscal).
//
// Cuando el cajero cobra (total o parcial) un fiado desde la pantalla
// Deudas, imprime este recibo: fecha, deudor, importe cobrado, método y
// saldo restante. NO es documento fiscal — el documento definitivo es el
// ticket original (que se sube a Holded al saldar la deuda por completo).

import {
  concatBytes,
  escAlign,
  escBold,
  escCodePagePc850,
  escCut,
  escFeed,
  escInit,
  escResetSize,
  escSeparator,
  escSize,
  escText,
} from "./helpers.js";

export interface CreditReceiptInput {
  businessName: string;
  // Nº interno del ticket fiado que se está cobrando.
  internalNumber: string;
  debtorName: string | null;
  collectedAt: Date;
  amount: number;
  // Etiqueta ya traducida del método ("Efectivo", "Tarjeta", "Bizum").
  methodLabel: string;
  // Saldo que queda tras este cobro (0 = deuda saldada).
  remaining: number;
}

const COLUMNS = 42;

export function buildCreditPaymentReceipt(input: CreditReceiptInput): Uint8Array {
  const parts: Uint8Array[] = [];
  parts.push(escInit());
  parts.push(escCodePagePc850());

  parts.push(escAlign("center"));
  parts.push(escBold(true));
  parts.push(escSize(1, 1));
  parts.push(escText(input.businessName));
  parts.push(escResetSize());
  parts.push(escText("JUSTIFICANTE DE COBRO"));
  parts.push(escBold(false));
  parts.push(escText("(recibo no fiscal)"));
  parts.push(escAlign("left"));
  parts.push(escSeparator(COLUMNS));

  parts.push(escText(`Ticket:  ${input.internalNumber}`));
  parts.push(escText(`Fecha:   ${formatDateTime(input.collectedAt)}`));
  if (input.debtorName) {
    parts.push(escText(`Cliente: ${input.debtorName}`));
  }
  parts.push(escText(`Metodo:  ${input.methodLabel}`));
  parts.push(escSeparator(COLUMNS));

  parts.push(escBold(true));
  parts.push(escText(padBetween("COBRADO", eur(input.amount), COLUMNS)));
  parts.push(escBold(false));
  parts.push(escText(padBetween("Saldo restante", eur(input.remaining), COLUMNS)));
  if (input.remaining <= 0.005) {
    parts.push(escText(""));
    parts.push(escAlign("center"));
    parts.push(escBold(true));
    parts.push(escText("DEUDA SALDADA"));
    parts.push(escBold(false));
    parts.push(escAlign("left"));
  }

  parts.push(escSeparator(COLUMNS));
  parts.push(escFeed(3));
  parts.push(escCut());
  return concatBytes(parts);
}

function eur(n: number): string {
  return (Math.round(n * 100) / 100).toFixed(2).replace(".", ",") + " €";
}

function formatDateTime(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function padBetween(left: string, right: string, width: number): string {
  if (left.length + right.length >= width) {
    const maxLeft = Math.max(0, width - right.length - 1);
    return left.slice(0, maxLeft) + " " + right;
  }
  return left + " ".repeat(width - left.length - right.length) + right;
}
