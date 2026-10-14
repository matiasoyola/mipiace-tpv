// Eventos broadcast del bus de mesas (B7 §6.2). El backend emite uno
// por operación; cada device suscrito al `storeId` recibe la copia y
// refresca su vista. Last-writer-wins por operación — sin OT/CRDT.

export type WsEvent =
  | {
      type: "table.opened";
      tableId: string;
      ticketId: string;
      byEmail: string;
      at: string;
    }
  | {
      type: "table.lineAdded";
      tableId: string;
      ticketId: string;
      line: { id: string; sku: string; nameSnapshot: string };
      at: string;
    }
  | {
      type: "table.lineUpdated";
      tableId: string;
      ticketId: string;
      lineId: string;
      at: string;
    }
  | {
      type: "table.lineRemoved";
      tableId: string;
      ticketId: string;
      lineId: string;
      at: string;
    }
  | {
      type: "table.cleared";
      tableId: string;
      ticketId: string;
      reason: string | null;
      at: string;
    }
  | {
      type: "table.paid";
      tableId: string | null;
      ticketId: string;
      holdedDocNumber: string | null;
      at: string;
    }
  | {
      type: "table.grouped";
      mainTableId: string;
      // v1.9.5-formacion · Frente 2: nombre display de la mesa principal
      // para el banner «M1 se ha unido a M4». Aditivo y nullable → los
      // consumidores viejos y los eventos en vuelo siguen válidos.
      mainTableName: string | null;
      absorbedTableIds: string[];
      at: string;
    }
  | {
      type: "table.ungrouped";
      mainTableId: string;
      at: string;
    }
  | {
      type: "table.linesMoved";
      sourceTableId: string | null;
      destinationTableId: string;
      lineIds: string[];
      at: string;
    }
  // Lote 4 v1.1 Thalia: eventos a nivel de ticket (independientes de
  // mesa). Útil para verticales RETAIL/SERVICES con doble caja: cuando
  // una caja cobra un ticket, la otra ve el contador del turno
  // actualizado sin esperar al próximo polling. Para verticales
  // HOSPITALITY, table.paid se sigue emitiendo cuando hay tableId; el
  // event ticket.paid se emite SIEMPRE (sea mesa o venta rápida) para
  // unificar.
  | {
      type: "ticket.paid";
      ticketId: string;
      internalNumber: string | null;
      registerId: string;
      // v1.9.5-formacion · Frente 2: nombres display para el banner
      // «Mesa M3 cobrada desde Caja 2». Aditivos y nullable → los
      // consumidores viejos y los eventos en vuelo siguen válidos.
      registerName: string | null;
      tableId: string | null;
      tableName: string | null;
      byEmail: string;
      totalEur: number;
      at: string;
    }
  | {
      type: "ticket.refunded";
      refundId: string;
      originalTicketId: string;
      registerId: string;
      byEmail: string;
      totalEur: number;
      at: string;
    }
  // v1.4-Bar-Operativa-MVP Lote 2: el cajero envía la comanda de una
  // mesa a barra/cocina/salón. Otras cajas del store ven el badge
  // "comanda enviada" actualizado en la mesa sin tener que refrescar.
  | {
      type: "ticket.sent_to_kitchen";
      ticketId: string;
      tableId: string | null;
      revision: number;
      sections: Array<{ section: "BARRA" | "COCINA" | "SALON"; lineCount: number }>;
      byEmail: string;
      at: string;
    }
  // ── kds-1-cocina · la pantalla de comandas ──────────────────────────
  //
  // Siete eventos, y los siete son AVISOS: la verdad está en
  // `GET /kitchen/comandas` (la pantalla) y en el DRAFT (el TPV). Ninguno
  // lleva la comanda dentro, así que un evento perdido se recupera al
  // siguiente GET y el orden de llegada no puede corromper nada — misma
  // decisión que el bus de mesas de B7 §6.2, por la misma razón.
  //
  // Sólo se emiten con `Tenant.kitchenDisplayEnabled`. Con el módulo
  // apagado, los TPV de hostelería reciben exactamente los eventos que
  // recibían antes de este bloque.
  | {
      type: "kitchen.order_created";
      orderId: string;
      section: "BARRA" | "COCINA" | "SALON";
      ticketId: string;
      tableId: string | null;
      tableName: string | null;
      /** 1ª, 2ª, 3ª comanda de esta mesa. */
      number: number;
      urgent: boolean;
      at: string;
    }
  | {
      type: "kitchen.line_voided";
      ticketId: string;
      ticketLineId: string;
      /** Las tarjetas que acaban de estrenar el «ANULADO». */
      orderIds: string[];
      at: string;
    }
  | {
      type: "kitchen.course_fired";
      ticketId: string;
      course: number;
      at: string;
    }
  | {
      type: "kitchen.order_urgent";
      orderId: string;
      urgent: boolean;
      at: string;
    }
  | {
      type: "kitchen.line_done";
      orderId: string;
      lineId: string;
      /** `false` = se destachó (dedo gordo). */
      done: boolean;
      at: string;
    }
  // «Lista». Es el que levanta la banda «M4 · listo para servir» en TODOS
  // los TPV de la tienda, así que lleva el NOMBRE de la mesa: la banda
  // tiene que pintarse sin un GET de vuelta, porque el camarero de la
  // terraza puede estar en la pantalla de venta y no en la sala.
  //
  // Única excepción a «el evento no lleva estado», y razonada: lo que
  // lleva no es estado que pueda quedar desfasado, es el nombre de una
  // mesa en el momento en que estuvo lista.
  | {
      type: "kitchen.order_ready";
      orderId: string;
      ticketId: string;
      tableId: string | null;
      tableName: string | null;
      section: "BARRA" | "COCINA" | "SALON";
      at: string;
    }
  | {
      type: "kitchen.order_served";
      orderId: string;
      ticketId: string;
      tableId: string | null;
      at: string;
    };
