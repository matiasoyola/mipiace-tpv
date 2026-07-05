// v1.9.5-formacion · Frente 2: el evento ticket.paid lleva nombres
// display (registerName + tableName) para que los banners de
// concurrencia nombren caja y mesa reales. Aditivo: si el register/user
// no existen, el helper no emite (best-effort) y no lanza.

import { describe, expect, it, vi } from "vitest";

import { emitTicketPaid } from "../src/realtime/emit-helpers.js";
import { getStoreEventBus } from "../src/realtime/store-event-bus.js";
import type { WsEvent } from "../src/realtime/store-events.js";

function capture(storeId: string) {
  const events: WsEvent[] = [];
  const unsub = getStoreEventBus().subscribe(storeId, {
    send: (e: WsEvent) => events.push(e),
  });
  return { events, unsub };
}

function fakePrisma(opts: {
  register: { storeId: string; name: string | null } | null;
  user: { email: string } | null;
  table?: { name: string | null } | null;
}) {
  return {
    register: { findUnique: vi.fn(async () => opts.register) },
    user: { findUnique: vi.fn(async () => opts.user) },
    table: { findUnique: vi.fn(async () => opts.table ?? null) },
  } as never;
}

describe("emitTicketPaid · nombres display (Frente 2)", () => {
  it("incluye registerName y tableName cuando hay mesa", async () => {
    const { events, unsub } = capture("store-1");
    await emitTicketPaid({
      prisma: fakePrisma({
        register: { storeId: "store-1", name: "Caja 2" },
        user: { email: "a@b.c" },
        table: { name: "M3" },
      }),
      ticketId: "t-1",
      internalNumber: "000005",
      registerId: "reg-1",
      cashierUserId: "u-1",
      tableId: "table-1",
      totalEur: 5.4,
    });
    unsub();
    expect(events).toHaveLength(1);
    const ev = events[0] as unknown as Record<string, unknown>;
    expect(ev.type).toBe("ticket.paid");
    expect(ev.registerName).toBe("Caja 2");
    expect(ev.tableName).toBe("M3");
  });

  it("tableName null en venta rápida (sin mesa) y no consulta la tabla", async () => {
    const prisma = fakePrisma({
      register: { storeId: "store-2", name: "Caja 1" },
      user: { email: "a@b.c" },
    });
    const { events, unsub } = capture("store-2");
    await emitTicketPaid({
      prisma,
      ticketId: "t-2",
      internalNumber: "000006",
      registerId: "reg-1",
      cashierUserId: "u-1",
      tableId: null,
      totalEur: 3,
    });
    unsub();
    const ev = events[0] as unknown as Record<string, unknown>;
    expect(ev.registerName).toBe("Caja 1");
    expect(ev.tableName).toBeNull();
    expect((prisma as never as { table: { findUnique: ReturnType<typeof vi.fn> } }).table.findUnique).not.toHaveBeenCalled();
  });
});
