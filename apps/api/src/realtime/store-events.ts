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
    };
