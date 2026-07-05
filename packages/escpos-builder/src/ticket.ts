// v1.4-Impresoras-Fase-1 Lote 2 · ticket de cobro ESC/POS.
//
// Estructura del ticket que va al cliente tras cobrar:
//
//   1. Init + code page PC850 (acentos castellano).
//   2. Nombre del comercio en grande + dirección debajo en normal.
//   3. Separador.
//   4. "TICKET #N · fecha hora", cajero, mesa (si bar).
//   5. Líneas (descripción + uds × precio + total derecha).
//   6. Separador.
//   7. TOTAL en bold + alineado derecha.
//   8. Métodos de pago.
//   9. QR con la URL pública del ticket (cliente lo escanea para
//      ver la versión digital / pedirla por email).
//   10. Texto pequeño: "Ver ticket: {url}".
//   11. Feed + cut.
//
// El binary devuelto va directo a la impresora (USB con WebUSB o WIFI
// con TCP a :9100).

import { allocateRoundingRemainder } from "@mipiacetpv/ticket-model";

import {
  concatBytes,
  escAlign,
  escBold,
  escCodePagePc850,
  escCut,
  escFeed,
  escInit,
  escQrCode,
  escResetSize,
  escSeparator,
  escSize,
  escText,
  escTextNoLf,
} from "./helpers.js";

export interface TicketLineEscpos {
  description: string;
  units: number;
  // En la divisa local; el builder formatea con 2 decimales.
  unitPrice: number;
  // Total línea (units × unitPrice) post descuentos. El caller lo
  // calcula en el dominio y pasa el valor final.
  lineTotal: number;
}

export interface TicketPaymentEscpos {
  // Lo que pinta el ticket. Castellano: "Efectivo", "Tarjeta", "Bizum".
  label: string;
  amount: number;
  // Si method=CASH y dio cambio, pintamos extra. Opcional.
  cashChange?: number;
}

// v1.9.4 · un bucket del desglose IVA para imprimir ("IVA 10% s/2,00").
// `base` es el neto mostrado (no cambia); `tax` es el IVA sin redondear
// (base * rate / 100) — el cuadre al céntimo lo hace el builder con
// `allocateRoundingRemainder`, así que el caller pasa el valor crudo.
export interface TicketTaxBucketEscpos {
  rate: number;
  base: number;
  tax: number;
}

export interface TicketReceiptInput {
  // Cabecera del comercio.
  // Razón social fiscal (del fiscalProfile del tenant). Si viene, es el
  // título en grande y el businessName pasa a línea de establecimiento.
  // Opcional para no romper callers/fixtures previos.
  legalName?: string | null;
  // NIF/CIF fiscal. Se imprime "NIF: ..." sólo si tiene valor (a
  // diferencia del PDF, que pinta "NIF: " aunque esté vacío).
  taxId?: string | null;
  // Dirección fiscal del tenant. Se parte en varias líneas si hace falta.
  fiscalAddress?: string | null;
  // Teléfono del comercio. "Tel. ..." si viene.
  phone?: string | null;
  // Nombre del establecimiento/tienda (store.name). Cuando hay una
  // razón social distinta, se imprime como subtítulo bajo ella.
  businessName: string;
  // Dirección formateada en una línea ("c/ Mayor 5, 28001 Madrid").
  businessAddress: string | null;
  // Nº fiscal mostrado en cabecera ("TICKET 000123" o "#A-2026-000123").
  internalNumber: string;
  // Hora local del cobro.
  issuedAt: Date;
  // "Vendido por: ana@bar.es" → label corto.
  cashierLabel: string;
  // Si proviene de una mesa, "Mesa 7". null si venta rápida.
  tableName: string | null;
  // Líneas que se imprimen — el caller pasa snapshot del cobro.
  lines: TicketLineEscpos[];
  // v1.9.4 · desglose IVA opcional. Si viene (con al menos un bucket),
  // imprimimos "IVA X% s/base" por tipo + "Subtotal" antes del TOTAL,
  // cuadrados al céntimo contra `total`. Si falta (callers/fixtures
  // previos), el ticket sale igual que hoy: sólo líneas → TOTAL → pagos.
  taxBreakdown?: TicketTaxBucketEscpos[] | null;
  // Neto sin IVA a mostrar en la línea "Subtotal". Sólo se usa si hay
  // `taxBreakdown`. Es entrada: no se recalcula aquí.
  subtotal?: number | null;
  total: number;
  // Métodos del cobro (puede haber varios — efectivo + tarjeta).
  payments: TicketPaymentEscpos[];
  // Notas adicionales para imprimir tras el total (p.ej. "ticket sin
  // valor fiscal — venta de prueba").
  notes: string[];
  // URL pública del ticket digital (qr). Si null, no se imprime QR.
  publicTicketUrl: string | null;
  // Pie configurable del tenant ("Gracias por su compra"). Opcional.
  footer: string | null;
  // v1.8-Fiado (variante B) · si el ticket es una venta a crédito con
  // deuda viva, imprimimos una leyenda destacada "PENDIENTE DE PAGO" con
  // el deudor y el importe adeudado. NO es documento fiscal (no lleva
  // numeración Holded — aún no existe); el layout no debe aparentarlo.
  creditNotice?: { debtorName: string | null; amountDue: number } | null;
}

const COLUMNS = 42;

export function buildTicketReceipt(input: TicketReceiptInput): Uint8Array {
  const parts: Uint8Array[] = [];

  parts.push(escInit());
  parts.push(escCodePagePc850());

  // Cabecera comercio: bloque fiscal (razón social + NIF + dirección
  // fiscal + teléfono) replicando el del PDF, y debajo el nombre del
  // establecimiento. Si no hay razón social, el título cae al nombre de
  // tienda (comportamiento previo).
  parts.push(escAlign("center"));

  const legalName = input.legalName?.trim();
  const title =
    legalName && legalName.length > 0 ? legalName : input.businessName;

  parts.push(escBold(true));
  parts.push(escSize(2, 2));
  parts.push(escText(title));
  parts.push(escResetSize());
  parts.push(escBold(false));

  // Establecimiento como subtítulo, sólo si la razón social es el título
  // y el nombre de tienda aporta algo distinto.
  if (legalName && input.businessName && input.businessName !== legalName) {
    parts.push(escText(input.businessName));
  }

  const taxId = input.taxId?.trim();
  if (taxId) {
    parts.push(escText(`NIF: ${taxId}`));
  }

  // Dirección: preferimos la fiscal; si no hay, la del establecimiento.
  const address =
    (input.fiscalAddress?.trim() || input.businessAddress?.trim()) ?? "";
  if (address) {
    for (const l of wrapText(address, COLUMNS)) parts.push(escText(l));
  }

  const phone = input.phone?.trim();
  if (phone) {
    parts.push(escText(`Tel. ${phone}`));
  }

  parts.push(escSeparator(COLUMNS));

  // Cuerpo. Volvemos a alinear a la izquierda; el TOTAL se centra
  // por la derecha más tarde con padding manual.
  parts.push(escAlign("left"));
  parts.push(escBold(true));
  parts.push(
    escText(`${input.internalNumber}  ${formatDateTime(input.issuedAt)}`),
  );
  parts.push(escBold(false));
  parts.push(escText(`Cajero: ${input.cashierLabel}`));
  if (input.tableName) {
    parts.push(escText(`Mesa:   ${input.tableName}`));
  }
  parts.push(escSeparator(COLUMNS));

  // Líneas. Formato:
  //   <descripción>
  //   <uds> x <precio>          <line total>
  // Si la descripción es larga la dejamos en la primera línea y
  // ponemos el detalle de precio en la segunda alineado a derecha.
  for (const line of input.lines) {
    parts.push(escText(line.description));
    const left = `${formatUnits(line.units)} x ${eur(line.unitPrice)}`;
    const right = eur(line.lineTotal);
    parts.push(escText(padBetween(left, right, COLUMNS)));
  }

  parts.push(escSeparator(COLUMNS));

  // v1.9.4 · desglose IVA cuadrado al céntimo (sólo si el caller lo pasa).
  // Repartimos el residuo de redondeo entre subtotal + IVAs con el método
  // del resto mayor para que la suma impresa coincida con el TOTAL. Las
  // bases mostradas ("s/2,00") no cambian.
  if (input.taxBreakdown && input.taxBreakdown.length > 0) {
    const subtotalNet =
      input.subtotal != null
        ? input.subtotal
        : input.taxBreakdown.reduce((acc, b) => acc + b.base, 0);
    const printed = allocateRoundingRemainder(
      [
        { key: "subtotal", amount: subtotalNet },
        ...input.taxBreakdown.map((b, i) => ({
          key: `tax:${i}`,
          amount: b.tax,
        })),
      ],
      input.total,
    );
    const printedByKey = new Map(printed.map((p) => [p.key, p.amount]));
    input.taxBreakdown.forEach((b, i) => {
      const label = `IVA ${b.rate}% s/${eur(b.base)}`;
      parts.push(
        escText(padBetween(label, eur(printedByKey.get(`tax:${i}`) ?? b.tax), COLUMNS)),
      );
    });
    parts.push(
      escText(
        padBetween("Subtotal", eur(printedByKey.get("subtotal") ?? subtotalNet), COLUMNS),
      ),
    );
  }

  // Total grande + bold + derecha.
  parts.push(escBold(true));
  parts.push(escSize(1, 2));
  parts.push(escText(padBetween("TOTAL", eur(input.total), COLUMNS)));
  parts.push(escResetSize());
  parts.push(escBold(false));

  // Pagos (Efectivo: 10,00 €, Tarjeta: 5,50 €...).
  for (const pay of input.payments) {
    parts.push(escText(padBetween(pay.label, eur(pay.amount), COLUMNS)));
    if (pay.cashChange != null && pay.cashChange > 0) {
      parts.push(escText(padBetween("  Cambio", eur(pay.cashChange), COLUMNS)));
    }
  }

  // v1.8-Fiado · leyenda destacada de venta a crédito. Un fiado no lleva
  // pagos (el bucle de arriba no imprime nada), así que este bloque es lo
  // que ve el cliente: debe pagar, cuánto y a nombre de quién. Sin
  // numeración fiscal — este ticket NO es el documento definitivo.
  if (input.creditNotice) {
    parts.push(escText(""));
    parts.push(escSeparator(COLUMNS));
    parts.push(escAlign("center"));
    parts.push(escBold(true));
    parts.push(escSize(1, 2));
    parts.push(escText("PENDIENTE DE PAGO"));
    parts.push(escResetSize());
    if (input.creditNotice.debtorName) {
      parts.push(escText(`Deudor: ${input.creditNotice.debtorName}`));
    }
    parts.push(escText(`Debe: ${eur(input.creditNotice.amountDue)}`));
    parts.push(escBold(false));
    parts.push(escText("Este ticket no es el justificante fiscal."));
    parts.push(escAlign("left"));
    parts.push(escSeparator(COLUMNS));
  }

  if (input.notes.length > 0) {
    parts.push(escText(""));
    for (const note of input.notes) {
      parts.push(escText(note));
    }
  }

  if (input.publicTicketUrl) {
    parts.push(escText(""));
    parts.push(escAlign("center"));
    parts.push(escQrCode(input.publicTicketUrl, 6));
    parts.push(escText(""));
    parts.push(escText("Ver ticket online:"));
    parts.push(escText(shortenUrl(input.publicTicketUrl)));
    parts.push(escAlign("left"));
  }

  if (input.footer) {
    parts.push(escText(""));
    parts.push(escAlign("center"));
    parts.push(escText(input.footer));
    parts.push(escAlign("left"));
  }

  parts.push(escFeed(3));
  parts.push(escCut());

  return concatBytes(parts);
}

// "TEST IMPRESORA" estándar para el botón "Probar" del admin. Tiene
// el mismo flujo init + corte para que las impresoras lo entiendan
// como un trabajo completo (algunas se quedan colgadas si recibimos
// init sin cut).
export function buildTestPrint(now: Date = new Date()): Uint8Array {
  return concatBytes([
    escInit(),
    escCodePagePc850(),
    escAlign("center"),
    escBold(true),
    escSize(2, 2),
    escText("TEST IMPRESORA"),
    escResetSize(),
    escBold(false),
    escText("mipiacetpv"),
    escText(formatDateTime(now)),
    escText(""),
    escText("Si lees esto, la conexión funciona."),
    escAlign("left"),
    escFeed(3),
    escCut(),
  ]);
}

// La impresora térmica no tiene Intl. Hacemos un format simple "dd/MM
// HH:mm". Asumimos zona del servidor (Europa/Madrid en pilotos
// actuales).
function formatDateTime(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function eur(n: number): string {
  const value = (Math.round(n * 100) / 100).toFixed(2);
  return value.replace(".", ",") + " €";
}

function formatUnits(units: number): string {
  if (Number.isInteger(units)) return String(units);
  return units.toFixed(2).replace(".", ",");
}

// Encadena dos strings a izq/der con espacios entre medias hasta
// `width`. Si izq+der no caben juntos en width, recorta el lado izq.
function padBetween(left: string, right: string, width: number): string {
  if (left.length + right.length >= width) {
    const maxLeft = Math.max(0, width - right.length - 1);
    return left.slice(0, maxLeft) + " " + right;
  }
  const space = width - left.length - right.length;
  return left + " ".repeat(space) + right;
}

// Parte un texto en líneas de como mucho `width` columnas, por palabras.
// Si una palabra sola excede el ancho, la corta en duro. Se usa para la
// dirección fiscal de la cabecera (centrada).
function wrapText(text: string, width: number): string[] {
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (word.length > width) {
      if (current) {
        lines.push(current);
        current = "";
      }
      for (let i = 0; i < word.length; i += width) {
        lines.push(word.slice(i, i + width));
      }
      continue;
    }
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > width) {
      if (current) lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [text];
}

// Si la URL pasa de 40 chars, recortamos al middle ("https://...iD123/pdf").
// El QR de arriba sigue siendo escaneable; este texto es legibilidad
// humana.
function shortenUrl(url: string): string {
  if (url.length <= 40) return url;
  return url.slice(0, 25) + "..." + url.slice(-12);
}

export { escTextNoLf };
