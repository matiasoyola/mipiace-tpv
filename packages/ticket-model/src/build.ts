// `buildTicketDocument`: convierte registros de BD (Tenant + Store +
// Register + Ticket con líneas y pagos + cajero + opcionalmente
// Contact/email manual) en un `TicketDocument` listo para renderizar.
//
// Estructuralmente tipado: no importa Prisma para no atar este package
// al cliente generado. Los campos numéricos pueden venir como `number`
// o como Decimal (`{ toString(): string }`) y se normalizan aquí.

import type {
  TicketCustomer,
  TicketDocument,
  TicketLine,
  TicketPaymentMethod,
  TicketRefund,
  TicketTaxBucket,
} from "./types.js";

type Numericish = number | string | { toString(): string };

function num(v: Numericish | null | undefined): number {
  if (v == null) return 0;
  if (typeof v === "number") return v;
  if (typeof v === "string") return Number(v);
  return Number(v.toString());
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// B-TPV-Bugfix v2 · Bug-05: Holded a veces devuelve la dirección como
// objeto estructurado (`{ address, city, postalCode, country, ... }`)
// en lugar de string plano. Aceptamos cualquiera de los dos y dejamos
// al builder la responsabilidad de serializar a una sola línea legible
// antes de pasarlo al schema.
export type FiscalAddressLike =
  | string
  | {
      address?: string | null;
      city?: string | null;
      province?: string | null;
      postalCode?: string | null;
      country?: string | null;
      [extra: string]: unknown;
    }
  | null
  | undefined;

export function serializeFiscalAddress(value: FiscalAddressLike): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value !== "object") return "";
  const parts: string[] = [];
  const street = (value as { address?: unknown }).address;
  if (typeof street === "string" && street.trim()) parts.push(street.trim());
  const cz: string[] = [];
  const postalCode = (value as { postalCode?: unknown }).postalCode;
  if (typeof postalCode === "string" && postalCode.trim()) cz.push(postalCode.trim());
  const city = (value as { city?: unknown }).city;
  if (typeof city === "string" && city.trim()) cz.push(city.trim());
  if (cz.length) parts.push(cz.join(" "));
  const province = (value as { province?: unknown }).province;
  if (typeof province === "string" && province.trim()) parts.push(province.trim());
  const country = (value as { country?: unknown }).country;
  if (typeof country === "string" && country.trim()) parts.push(country.trim());
  return parts.join(", ");
}

export interface BuildTenantInput {
  name: string;
  // fiscalProfile: jsonb libre del onboarding/holded. Esperamos legalName,
  // taxId, address, phone (todos opcionales pero los exigimos al
  // renderer porque un ticket sin cabecera fiscal no es ticket).
  // address acepta string-o-object (Holded a veces devuelve estructurado).
  fiscalProfile?: {
    legalName?: string | null;
    taxId?: string | null;
    address?: FiscalAddressLike;
    phone?: string | null;
  } | null;
}

export interface BuildStoreInput {
  name: string;
  fiscalAddress?: {
    address?: FiscalAddressLike;
    phone?: string | null;
  } | null;
}

export interface BuildRegisterInput {
  name: string;
}

export interface BuildCashierInput {
  email: string;
  name?: string | null;
}

export interface BuildTicketLineInput {
  nameSnapshot: string;
  sku?: string | null;
  units: Numericish;
  unitPrice: Numericish;
  discountPct?: Numericish | null;
  taxRate: Numericish;
  subtotal?: Numericish | null;
  total?: Numericish | null;
}

export interface BuildTicketPaymentInput {
  method: string;
  amount: Numericish;
}

export interface BuildTicketInput {
  internalNumber: string;
  publicSlug: string;
  paidAt?: Date | null;
  createdAt: Date;
  cashAmount?: Numericish | null;
  total: Numericish;
  lines: BuildTicketLineInput[];
  payments: BuildTicketPaymentInput[];
  // v1.3-Thalia Lote 3 · si se construye el doc para una reimpresión.
  // Sólo cambia presentación visual del PDF, no la fiscalidad.
  isReprint?: boolean;
}

export interface BuildRefundContext {
  originalTicketNumber: string;
  reason?: string;
}

export interface BuildTicketDocumentInput {
  tenant: BuildTenantInput;
  store: BuildStoreInput;
  register: BuildRegisterInput;
  cashier: BuildCashierInput;
  ticket: BuildTicketInput;
  customer?: TicketCustomer | null;
  refund?: BuildRefundContext;
  footer?: {
    thankYouMessage?: string;
    returnPolicy?: string;
    qrCaption?: string;
  };
}

function mapPaymentMethod(method: string): TicketPaymentMethod {
  if (method === "CASH") return "CASH";
  if (method === "CARD") return "CARD";
  if (method === "BIZUM") return "TRANSFER";
  if (method === "VOUCHER") return "OTHER";
  if (method === "TRANSFER") return "TRANSFER";
  return "OTHER";
}

export function buildTicketDocument(input: BuildTicketDocumentInput): TicketDocument {
  const fiscal = input.tenant.fiscalProfile ?? {};
  const lines: TicketLine[] = input.ticket.lines.map((l) => {
    const quantity = num(l.units);
    const unitPrice = num(l.unitPrice);
    const discount = l.discountPct == null ? 0 : num(l.discountPct);
    const taxRate = num(l.taxRate);
    // Si la línea ya trae subtotal/total persistido lo usamos; si no,
    // lo derivamos (descuentos sin IVA — Holded suma IVA al final).
    const gross = unitPrice * quantity * (1 - discount / 100);
    const subtotalLine =
      l.subtotal != null ? num(l.subtotal) : round2(gross);
    return {
      description: l.nameSnapshot,
      sku: l.sku ?? undefined,
      quantity,
      unitPrice,
      discount: discount > 0 ? discount : undefined,
      taxRate,
      subtotal: subtotalLine,
    };
  });

  // Desglose IVA: agrupamos por tasa. Base = subtotal sin IVA; tax =
  // base * rate/100. Hace falta separar las líneas por su `taxRate`
  // porque el ticket puede tener IVA mixto (10% comida + 21% bebida).
  const bucketByRate = new Map<number, { base: number; tax: number }>();
  for (const line of lines) {
    const bucket = bucketByRate.get(line.taxRate) ?? { base: 0, tax: 0 };
    const base = line.subtotal;
    const tax = base * (line.taxRate / 100);
    bucket.base += base;
    bucket.tax += tax;
    bucketByRate.set(line.taxRate, bucket);
  }
  const taxBreakdown: TicketTaxBucket[] = Array.from(bucketByRate.entries())
    .sort(([a], [b]) => a - b)
    .map(([rate, { base, tax }]) => ({
      rate,
      base: round2(base),
      tax: round2(tax),
    }));

  const subtotalNet = round2(lines.reduce((acc, l) => acc + l.subtotal, 0));
  const total = round2(num(input.ticket.total));

  // Pago: si hay varios payments, usamos el método del primero como
  // representativo (mixto se aplana al método dominante). El cambio se
  // calcula sólo si hubo CASH (overpayment efectivo).
  const firstPayment = input.ticket.payments[0];
  const method: TicketPaymentMethod = firstPayment
    ? mapPaymentMethod(firstPayment.method)
    : "OTHER";
  const paidSum = input.ticket.payments.reduce((acc, p) => acc + num(p.amount), 0);
  const cashAmount =
    input.ticket.cashAmount != null
      ? num(input.ticket.cashAmount)
      : input.ticket.payments
          .filter((p) => p.method === "CASH")
          .reduce((acc, p) => acc + num(p.amount), 0);
  const change = cashAmount > 0 ? Math.max(0, round2(paidSum - total)) : 0;

  const refund: TicketRefund | undefined = input.refund
    ? {
        originalTicketNumber: input.refund.originalTicketNumber,
        reason: input.refund.reason,
      }
    : undefined;

  const customer: TicketCustomer | undefined =
    input.customer && (input.customer.name || input.customer.taxId || input.customer.email)
      ? {
          name: input.customer.name || undefined,
          taxId: input.customer.taxId || undefined,
          email: input.customer.email || undefined,
        }
      : undefined;

  return {
    fiscal: {
      legalName: fiscal.legalName ?? input.tenant.name,
      taxId: fiscal.taxId ?? "",
      // Bug-05: serializamos address por si llega como objeto Holded
      // estructurado ({ address, city, postalCode, country, ... }).
      address: serializeFiscalAddress(fiscal.address),
      phone: fiscal.phone ?? undefined,
    },
    store: {
      name: input.store.name,
      address: serializeFiscalAddress(input.store.fiscalAddress?.address),
      phone: input.store.fiscalAddress?.phone ?? undefined,
    },
    ticket: {
      internalNumber: input.ticket.internalNumber,
      publicSlug: input.ticket.publicSlug,
      issuedAt: input.ticket.paidAt ?? input.ticket.createdAt,
      cashierName: input.cashier.name ?? input.cashier.email,
      registerName: input.register.name,
      isReprint: input.ticket.isReprint ?? undefined,
    },
    customer,
    lines,
    totals: {
      subtotal: subtotalNet,
      taxBreakdown,
      total,
    },
    payment: {
      method,
      paid: round2(paidSum),
      change: change > 0 ? change : undefined,
    },
    refund,
    footer: {
      thankYouMessage: input.footer?.thankYouMessage ?? "¡Gracias por tu visita!",
      returnPolicy: input.footer?.returnPolicy,
      qrCaption: input.footer?.qrCaption,
    },
  };
}
