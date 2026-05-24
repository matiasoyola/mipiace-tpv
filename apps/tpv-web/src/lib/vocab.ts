// v1.3-Servicios-Pinta · Lote 1.
//
// Vocabulario por vertical para los textos visibles del TPV. Permite que
// un mismo componente diga "Cobrar" en retail/hospitality y "Cerrar
// servicio" en peluquerías, clínicas o talleres sin duplicar pantallas.
//
// Reglas:
// - RETAIL y HOSPITALITY conservan EXACTAMENTE el copy de hoy (los
//   tenants actuales no deben notar diferencia tras este lote).
// - SERVICES recibe el copy adaptado.
// - El helper también lo usa el renderer del ticket impreso (Lote 2),
//   por eso vive en un módulo puro sin dependencias del DOM.

import type { BusinessType } from "./catalog.js";

export type VocabKey =
  | "saleAction" // "Cobrar"        → SERVICES "Cerrar servicio"
  | "saleNoun" // "Venta"            → SERVICES "Servicio"
  | "saleNounPlural" // "Ventas"     → SERVICES "Servicios prestados"
  | "itemNoun" // "Producto"         → SERVICES "Servicio"
  | "itemNounPlural" // "Productos"  → SERVICES "Servicios"
  | "refundAction" // "Devolver"     → SERVICES "Anular"
  | "refundNoun" // "Devolución"     → SERVICES "Anulación"
  | "ticketNoun" // "Ticket"         → SERVICES "Comprobante"
  | "historyTitle"; // "Historial de tickets" → SERVICES "Servicios anteriores"

const DEFAULT_VOCAB: Record<VocabKey, string> = {
  saleAction: "Cobrar",
  saleNoun: "Venta",
  saleNounPlural: "Ventas",
  itemNoun: "Producto",
  itemNounPlural: "Productos",
  refundAction: "Devolver",
  refundNoun: "Devolución",
  ticketNoun: "Ticket",
  historyTitle: "Historial de tickets",
};

const SERVICES_VOCAB: Record<VocabKey, string> = {
  saleAction: "Cerrar servicio",
  saleNoun: "Servicio",
  saleNounPlural: "Servicios prestados",
  itemNoun: "Servicio",
  itemNounPlural: "Servicios",
  refundAction: "Anular",
  refundNoun: "Anulación",
  ticketNoun: "Comprobante",
  historyTitle: "Servicios anteriores",
};

export function vocab(key: VocabKey, bt: BusinessType | null | undefined): string {
  if (bt === "SERVICES") return SERVICES_VOCAB[key];
  return DEFAULT_VOCAB[key];
}
