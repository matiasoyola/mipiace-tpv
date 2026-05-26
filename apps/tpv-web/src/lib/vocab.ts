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

// v1.3-hotfix5 · feedback piloto Peluquería Sole (2026-05-25):
// el botón principal sigue siendo "Cobrar" (no "Cerrar servicio") y el
// título del panel sigue siendo "Ticket de venta" (no "Comprobante de
// servicio") porque el cajero asocia "Cobrar/Ticket" con el acto de
// venta independientemente del vertical. Mantenemos el copy de SERVICES
// sólo donde aporta valor (placeholder "Buscar servicio o cliente",
// historial "Servicios anteriores", anulación en vez de devolución).
const SERVICES_VOCAB: Record<VocabKey, string> = {
  saleAction: "Cobrar",
  saleNoun: "Venta",
  saleNounPlural: "Ventas",
  itemNoun: "Servicio",
  itemNounPlural: "Servicios",
  refundAction: "Anular",
  refundNoun: "Anulación",
  ticketNoun: "Ticket",
  historyTitle: "Servicios anteriores",
};

export function vocab(key: VocabKey, bt: BusinessType | null | undefined): string {
  if (bt === "SERVICES") return SERVICES_VOCAB[key];
  return DEFAULT_VOCAB[key];
}
