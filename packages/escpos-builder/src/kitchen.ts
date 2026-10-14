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
  // kds-1-cocina · la silla a la que va este plato (decisión 3, capa 2).
  // NULL/undefined = para la mesa, que es el caso normal. Se imprime
  // «SILLA 3» a tamaño doble delante del plato: el camarero que recoge el
  // papel tiene que saber dónde dejarlo sin preguntar.
  seat?: number | null;
  // El tiempo de salida (1, 2, 3…). Sólo se imprime si es > 1 — en un bar
  // todo es tiempo 1 y escribirlo sería ruido en 42 columnas.
  course?: number;
  // kds-1-cocina · capa 3: este plato lleva el alérgeno de SU silla.
  // Texto ya compuesto («¡LLEVA GLUTEN!»). Se imprime en negrita y entre
  // asteriscos, que es todo el énfasis que tiene el papel térmico.
  allergyWarning?: string | null;
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
  // kds-1-cocina (decisión 10) · las alergias de la mesa, YA COMPUESTAS
  // («⚠ SILLA 3 · SIN GLUTEN»).
  //
  // Van en el PAPEL y no sólo en la pantalla porque los alérgenos y las
  // alergias por silla son de serie en todo TPV de hostelería, módulo
  // «Cocina» o no: un bar que no compró la pantalla tiene la misma
  // obligación legal de informar. Se imprimen ARRIBA, antes de los platos,
  // porque es lo que condiciona cómo se cocina todo lo demás.
  allergyBands?: string[];
  // El camarero tocó «Urgente» al enviar. En papel es una franja de
  // asteriscos: no hay rojo en una térmica monocroma.
  urgent?: boolean;
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

  // kds-1-cocina · URGENTE arriba de todo. La decisión 3 lo pone en rojo
  // en la pantalla; en una térmica monocroma el único énfasis disponible
  // es el tamaño y una franja que no se pueda confundir con un separador.
  if (input.urgent) {
    parts.push(escSeparator(COLUMNS));
    parts.push(escAlign("center"));
    parts.push(escBold(true));
    parts.push(escSize(2, 2));
    parts.push(escText("URGENTE"));
    parts.push(escResetSize());
    parts.push(escBold(false));
    parts.push(escAlign("left"));
  }

  // kds-1-cocina · las alergias de la mesa, antes de los platos.
  const bands = input.allergyBands ?? [];
  if (bands.length > 0) {
    parts.push(escSeparator(COLUMNS));
    for (const band of bands) {
      parts.push(escBold(true));
      parts.push(escSize(1, 2));
      parts.push(escText(band));
      parts.push(escResetSize());
      parts.push(escBold(false));
    }
  }

  parts.push(escSeparator(COLUMNS));

  // Líneas (uds × descripción) en tamaño grande. Modificadores debajo
  // a tamaño normal con sangría.
  for (const line of input.lines) {
    // kds-1-cocina · la silla va DELANTE del plato y a su mismo tamaño:
    // «SILLA 3» y debajo «1x Patatas bravas». Delante y no detrás porque
    // en 42 columnas un nombre largo empuja el sufijo a la línea
    // siguiente, y una silla en la línea de abajo se lee como la del plato
    // siguiente.
    if (line.seat != null) {
      parts.push(escBold(true));
      parts.push(escSize(2, 1));
      parts.push(escText(`SILLA ${line.seat}`));
      parts.push(escResetSize());
      parts.push(escBold(false));
    }
    parts.push(escBold(true));
    parts.push(escSize(2, 2));
    parts.push(escText(`${formatUnits(line.units)}x ${line.description}`));
    parts.push(escResetSize());
    parts.push(escBold(false));
    if (line.allergyWarning) {
      parts.push(escBold(true));
      parts.push(escSize(1, 2));
      parts.push(escText(`*** ${line.allergyWarning} ***`));
      parts.push(escResetSize());
      parts.push(escBold(false));
    }
    if (line.course != null && line.course > 1) {
      parts.push(escText(`   (${line.course}o tiempo)`));
    }
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

  parts.push(escFeed(6));
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
