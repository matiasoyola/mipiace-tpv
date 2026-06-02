// v1.4-Impresoras-Fase-1 Lote 2 · comanda ESC/POS (kitchen ticket).
//
// La comanda NO es un ticket fiscal — la cocina sólo necesita ver,
// rápido y desde 2m, qué tiene que preparar. Diseñada para tipografía
// grande (size 2x), sin precios, sin IVA, sin total.
//
// Estructura:
//   1. Init + code page PC850.
//   2. Sección (BARRA / COCINA / SALON) centrada, tamaño máximo bold.
//   3. Mesa + comanda número + hora.
//   4. Líneas: cada línea grande con uds × descripción.
//      Modificadores debajo, tamaño normal con sangría.
//   5. Notas (camarero) si las hay, en bold.
//   6. Feed + cut.

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

export type KitchenSection = "BARRA" | "COCINA" | "SALON";

export interface KitchenLineEscpos {
  units: number;
  description: string;
  // Modificadores o notas por línea ("Sin lactosa", "Punto medio").
  // Se imprimen pequeños debajo.
  notes: string[];
}

export interface KitchenComandaInput {
  section: KitchenSection;
  // "Mesa 7" / "Barra B2" / null si es venta rápida (sin mesa).
  tableName: string | null;
  // Comanda nº dentro del ticket (1, 2, 3…).
  revision: number;
  // Hora de envío al servidor.
  issuedAt: Date;
  // Identificador corto del camarero ("ana", "p.garcia").
  cashierLabel: string;
  // Comensales. null = no aplicaba (venta rápida).
  diners: number | null;
  // Nota global del ticket (si el camarero la escribió).
  ticketNotes: string | null;
  lines: KitchenLineEscpos[];
}

const COLUMNS = 42;
const SECTION_LABEL: Record<KitchenSection, string> = {
  BARRA: "BARRA",
  COCINA: "COCINA",
  SALON: "SALON",
};

export function buildKitchenComanda(input: KitchenComandaInput): Uint8Array {
  const parts: Uint8Array[] = [];

  parts.push(escInit());
  parts.push(escCodePagePc850());

  // Cabecera sección.
  parts.push(escAlign("center"));
  parts.push(escBold(true));
  parts.push(escSize(2, 2));
  parts.push(escText(SECTION_LABEL[input.section]));
  parts.push(escResetSize());
  parts.push(escBold(false));

  // Mesa + comanda + hora. Centrado, tamaño medio.
  parts.push(escSize(2, 1));
  if (input.tableName) {
    parts.push(escText(`${input.tableName} · #${input.revision}`));
  } else {
    parts.push(escText(`Venta rápida · #${input.revision}`));
  }
  parts.push(escResetSize());
  parts.push(
    escText(
      `${formatTime(input.issuedAt)}  ${input.cashierLabel}` +
        (input.diners ? `  ${input.diners}p` : ""),
    ),
  );
  parts.push(escAlign("left"));
  parts.push(escSeparator(COLUMNS));

  // Líneas (uds × descripción) en tamaño grande. Modificadores debajo
  // a tamaño normal con sangría.
  for (const line of input.lines) {
    parts.push(escBold(true));
    parts.push(escSize(2, 2));
    parts.push(escText(`${formatUnits(line.units)}x ${line.description}`));
    parts.push(escResetSize());
    parts.push(escBold(false));
    for (const note of line.notes) {
      parts.push(escText(`   · ${note}`));
    }
  }

  if (input.ticketNotes && input.ticketNotes.trim().length > 0) {
    parts.push(escSeparator(COLUMNS));
    parts.push(escBold(true));
    parts.push(escText(`NOTA: ${input.ticketNotes.trim()}`));
    parts.push(escBold(false));
  }

  parts.push(escFeed(3));
  parts.push(escCut());

  return concatBytes(parts);
}

function formatTime(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatUnits(units: number): string {
  if (Number.isInteger(units)) return String(units);
  return units.toFixed(2).replace(".", ",");
}
