// kds-1-cocina · LOS AVISOS.
//
// Todo lo que sale por aquí es un AVISO, no la verdad. La verdad está en
// `GET /kitchen/comandas` (la pantalla) y en el DRAFT (el TPV): un evento
// perdido se recupera al siguiente GET, y la pantalla pide el GET completo
// al conectar y al reconectar. Por eso ninguno de estos eventos lleva la
// comanda entera — llevan lo justo para decir «mira otra vez, y mira aquí».
//
// Es la misma decisión que tomó el bus de mesas de B7 (§6.2) y por la misma
// razón: un evento con el estado dentro obliga a resolver conflictos de
// orden de llegada, y un bus in-memory sin garantía de entrega no puede
// prometer orden.
//
// ── El módulo apagado no emite nada ───────────────────────────────────
//
// Las funciones de este fichero sólo se llaman desde caminos que ya pasaron
// por `requireKitchenModule` o por `destinos.ts` con el módulo encendido.
// El sabotaje «Módulo apagado» de la tabla del bloque comprueba justo eso:
// sin `kitchenDisplayEnabled`, ni pantalla, ni banda, ni eventos nuevos.

import type { KitchenSection } from "@mipiacetpv/db";

import { getStoreEventBus } from "../realtime/store-event-bus.js";
import type { WsEvent } from "../realtime/store-events.js";

function emitir(storeId: string, event: WsEvent): void {
  getStoreEventBus().broadcast(storeId, event);
}

export function emitirComandaCreada(p: {
  storeId: string;
  orderId: string;
  section: KitchenSection;
  ticketId: string;
  tableId: string | null;
  tableName: string | null;
  number: number;
  urgent: boolean;
  at: Date;
}): void {
  emitir(p.storeId, {
    type: "kitchen.order_created",
    orderId: p.orderId,
    section: p.section,
    ticketId: p.ticketId,
    tableId: p.tableId,
    tableName: p.tableName,
    number: p.number,
    urgent: p.urgent,
    at: p.at.toISOString(),
  });
}

export function emitirPlatoAnulado(p: {
  storeId: string;
  ticketId: string;
  ticketLineId: string;
  /** Las tarjetas que ya tenían ese plato y acaban de ver el «ANULADO». */
  orderIds: string[];
  at: Date;
}): void {
  emitir(p.storeId, {
    type: "kitchen.line_voided",
    ticketId: p.ticketId,
    ticketLineId: p.ticketLineId,
    orderIds: p.orderIds,
    at: p.at.toISOString(),
  });
}

export function emitirTiempoMarchado(p: {
  storeId: string;
  ticketId: string;
  course: number;
  at: Date;
}): void {
  emitir(p.storeId, {
    type: "kitchen.course_fired",
    ticketId: p.ticketId,
    course: p.course,
    at: p.at.toISOString(),
  });
}

export function emitirUrgente(p: {
  storeId: string;
  orderId: string;
  urgent: boolean;
  at: Date;
}): void {
  emitir(p.storeId, {
    type: "kitchen.order_urgent",
    orderId: p.orderId,
    urgent: p.urgent,
    at: p.at.toISOString(),
  });
}

export function emitirPlatoHecho(p: {
  storeId: string;
  orderId: string;
  lineId: string;
  done: boolean;
  at: Date;
}): void {
  emitir(p.storeId, {
    type: "kitchen.line_done",
    orderId: p.orderId,
    lineId: p.lineId,
    done: p.done,
    at: p.at.toISOString(),
  });
}

/**
 * «Lista». Es el evento que levanta la banda «M4 · listo para servir» en
 * TODOS los TPV de la tienda (decisión 5), así que lleva el nombre de la
 * mesa dentro: la banda tiene que poder pintarse sin un GET de vuelta,
 * porque el camarero de la terraza puede estar en la pantalla de venta y
 * no en la sala.
 *
 * Es la única excepción a «el evento no lleva estado», y está razonada:
 * lo que lleva no es estado que pueda quedar desfasado, es el nombre de una
 * mesa en el momento en que estuvo lista.
 */
export function emitirComandaLista(p: {
  storeId: string;
  orderId: string;
  ticketId: string;
  tableId: string | null;
  tableName: string | null;
  section: KitchenSection;
  at: Date;
}): void {
  emitir(p.storeId, {
    type: "kitchen.order_ready",
    orderId: p.orderId,
    ticketId: p.ticketId,
    tableId: p.tableId,
    tableName: p.tableName,
    section: p.section,
    at: p.at.toISOString(),
  });
}

export function emitirComandaServida(p: {
  storeId: string;
  orderId: string;
  ticketId: string;
  tableId: string | null;
  at: Date;
}): void {
  emitir(p.storeId, {
    type: "kitchen.order_served",
    orderId: p.orderId,
    ticketId: p.ticketId,
    tableId: p.tableId,
    at: p.at.toISOString(),
  });
}
