// v1.0-mesas-frontend · puente entre el DRAFT server-side de una mesa
// y el carrito local del SalePage.
//
// En contexto mesa la verdad vive en el servidor: las líneas que pinta
// el TPV son una proyección del ticket DRAFT (POST /tables/:id/open o
// GET /tickets/:id). Las mutaciones van con actualización optimista y
// se reconcilian con el `ticket` que devuelve cada endpoint. El id de
// cada CartLine ES el id de la TicketLine en BD (el TPV lo genera como
// `lineExternalId` al añadir — idempotencia incluida).

import { ApiError } from "../api.js";
import type { CartLine, ModifierSelection } from "./cart.js";

// Línea tal y como la serializan los endpoints de mesa. operativa.ts
// (serializeDraft) manda los decimales como string; tickets/routes.ts
// (serializeTicket, GET /tickets/:id) como number — Number() unifica.
export interface ServerDraftLine {
  id: string;
  productId: string | null;
  variantId: string | null;
  holdedProductId: string | null;
  sku: string;
  nameSnapshot: string;
  units: string | number;
  unitPrice: string | number;
  discountPct: string | number;
  taxRate: string | number;
  subtotal: string | number;
  total: string | number;
  // Strings legacy ("Sin azúcar") o snapshot estructurado de
  // B-Bar-Modifiers ({groupId, groupName, modifierId, label,
  // priceDeltaCents}). Discriminamos por tipo de elemento.
  modifiers: unknown[] | null;
}

export interface ServerDraft {
  id: string;
  status: string;
  externalId: string;
  tableId: string | null;
  table: { id: string; name: string; zone: string; capacity: number } | null;
  diners: number | null;
  total: string | number;
  createdAt: string;
  lines: ServerDraftLine[];
}

function isStructuredModifier(m: unknown): m is ModifierSelection {
  return (
    typeof m === "object" &&
    m !== null &&
    "modifierId" in m &&
    "priceDeltaCents" in m
  );
}

export function mapServerLineToCartLine(l: ServerDraftLine): CartLine {
  const legacy: string[] = [];
  const structured: ModifierSelection[] = [];
  if (Array.isArray(l.modifiers)) {
    for (const m of l.modifiers) {
      if (typeof m === "string") legacy.push(m);
      else if (isStructuredModifier(m)) structured.push(m);
    }
  }
  const unitPrice = Number(l.unitPrice);
  const taxRate = Number(l.taxRate);
  return {
    id: l.id,
    productId: l.productId,
    variantId: l.variantId,
    holdedProductId: l.holdedProductId,
    sku: l.sku,
    nameSnapshot: l.nameSnapshot,
    units: Number(l.units),
    unitPrice,
    // El servidor no soporta override puntual de precio en líneas de
    // mesa (PATCH sólo admite units/discountPct/modifiers) — siempre
    // null al reconstruir.
    unitPriceOverride: null,
    priceGross: Math.round(unitPrice * (1 + taxRate / 100) * 100) / 100,
    discountPct: Number(l.discountPct),
    taxRate,
    modifiers: legacy,
    modifierSelections: structured.length > 0 ? structured : undefined,
  };
}

export function mapServerDraftLines(lines: ServerDraftLine[]): CartLine[] {
  return lines.map(mapServerLineToCartLine);
}

// Mensaje de error para el toast de operativa de mesa. Los códigos 4xx
// del backend ya vienen con mensaje en español (REGISTER_MISMATCH,
// TABLE_GROUPED, TABLE_ALREADY_GROUPED, DESTINATION_OCCUPIED…); un
// fallo de red (fetch lanza TypeError, no ApiError) es el gate
// online-only: la operativa de mesa no funciona sin conexión.
export function tableErrorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  return "Sin conexión. La operativa de mesas necesita red — reinténtalo cuando vuelva.";
}

// v1.9.2-mesas-concurrencia · Frente 2: el DRAFT de la mesa ya no está
// vivo bajo los pies del cajero — lo cobró/anuló otra caja
// (TICKET_NOT_FOUND_OR_NOT_DRAFT) o lo absorbió un grupo (TABLE_GROUPED).
// En ambos casos añadir líneas es imposible y hay que volver al mapa.
export function isDeadDraftError(err: unknown): boolean {
  if (!(err instanceof ApiError)) return false;
  return (
    err.code === "TICKET_NOT_FOUND_OR_NOT_DRAFT" ||
    err.code === "TABLE_GROUPED"
  );
}
