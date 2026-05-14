// Validación zod del TicketDocument. Lo aplicamos justo antes de
// renderizar para detectar gaps en `buildTicketDocument` (ej. una
// fixture sin store.address) en vez de propagar una página rota.

import { z } from "zod";

export const TicketLineSchema = z.object({
  description: z.string().min(1),
  sku: z.string().optional(),
  quantity: z.number().positive(),
  unitPrice: z.number().nonnegative(),
  discount: z.number().min(0).max(100).optional(),
  taxRate: z.number().min(0).max(100),
  subtotal: z.number(),
});

export const TicketDocumentSchema = z.object({
  fiscal: z.object({
    legalName: z.string().min(1),
    taxId: z.string().min(1),
    address: z.string().min(1),
    phone: z.string().optional(),
  }),
  store: z.object({
    name: z.string().min(1),
    address: z.string(),
    phone: z.string().optional(),
  }),
  ticket: z.object({
    internalNumber: z.string().min(1),
    publicSlug: z.string().min(1),
    issuedAt: z.date(),
    cashierName: z.string().min(1),
    registerName: z.string().min(1),
  }),
  customer: z
    .object({
      name: z.string().optional(),
      taxId: z.string().optional(),
      email: z.string().email().optional(),
    })
    .optional(),
  lines: z.array(TicketLineSchema).min(1),
  totals: z.object({
    subtotal: z.number(),
    taxBreakdown: z.array(
      z.object({
        rate: z.number().min(0).max(100),
        base: z.number(),
        tax: z.number(),
      }),
    ),
    total: z.number(),
  }),
  payment: z.object({
    method: z.enum(["CASH", "CARD", "TRANSFER", "OTHER"]),
    paid: z.number(),
    change: z.number().optional(),
  }),
  refund: z
    .object({
      originalTicketNumber: z.string().min(1),
      reason: z.string().optional(),
    })
    .optional(),
  footer: z.object({
    thankYouMessage: z.string(),
    returnPolicy: z.string().optional(),
    qrCaption: z.string().optional(),
  }),
});

export function assertTicketDocument(doc: unknown): void {
  TicketDocumentSchema.parse(doc);
}
