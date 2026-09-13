// catalogo-local · PUERTA 4 — sin Holded no se encola nada.
//
// Esta puerta no estaba en el prompt del bloque; salió al medir. Lo que
// pasaba antes, con un tenant CON caja y SIN Holded (el "caja local" de
// ADR-016 §5, que existe desde H1):
//
//   1. Cobraba bien.
//   2. Se le creaba la fila `HoldedUpload` en PENDING y se encolaba el job.
//   3. `uploadTicket` lo tumbaba con `no_holded_key` → SYNC_FAILED.
//
// Es decir: vendía perfectamente y tenía la bandeja de errores del panel
// encendida con TODOS sus tickets, para siempre. El criterio 2 del bloque
// ("el ticket no intenta subir nada a Holded, y se ve en los logs que no
// lo intenta") es imposible sin tocar esto.
//
// Y hay CUATRO caminos que encolan, no los dos que usaban el gate: venta
// rápida, cobro de mesa, fiado saldado y devolución. Mesa y devolución no
// pasaban por el gate en absoluto.
//
// Aquí se prueba la decisión pura (`holded-upload-gate.ts`), que es el
// único punto donde se decide. Los caminos completos los ejerce el e2e.

import { describe, expect, it } from "vitest";

import {
  paidTicketStatus,
  shouldEnqueueHoldedRefundUpload,
  shouldEnqueueHoldedUpload,
} from "../src/tickets/holded-upload-gate.js";

const CON_HOLDED = true;
const SIN_HOLDED = false;

describe("catalogo-local · shouldEnqueueHoldedUpload", () => {
  it("sin clave de Holded no se encola NADA, sea cual sea el estado", () => {
    // Ni el estado más normal del mundo.
    expect(shouldEnqueueHoldedUpload("PENDING_SYNC" as never, SIN_HOLDED)).toBe(false);
    expect(shouldEnqueueHoldedUpload("PAID" as never, SIN_HOLDED)).toBe(false);
    expect(shouldEnqueueHoldedUpload("SYNC_FAILED" as never, SIN_HOLDED)).toBe(false);
    expect(shouldEnqueueHoldedUpload("ON_CREDIT" as never, SIN_HOLDED)).toBe(false);
  });

  it("con clave, el comportamiento de siempre: todo menos el fiado vivo", () => {
    // La variante B del fiado (v1.8) no se toca. Un fiado con deuda viva
    // no sube hasta saldarse.
    expect(shouldEnqueueHoldedUpload("PENDING_SYNC" as never, CON_HOLDED)).toBe(true);
    expect(shouldEnqueueHoldedUpload("PAID" as never, CON_HOLDED)).toBe(true);
    expect(shouldEnqueueHoldedUpload("ON_CREDIT" as never, CON_HOLDED)).toBe(false);
  });

  it("la clave manda sobre el estado: sin Holded, ni un fiado saldado sube", () => {
    expect(shouldEnqueueHoldedUpload("PAID" as never, SIN_HOLDED)).toBe(false);
  });
});

describe("catalogo-local · shouldEnqueueHoldedRefundUpload", () => {
  it("una devolución sin Holded no encola: no hay abono que subir", () => {
    expect(shouldEnqueueHoldedRefundUpload(SIN_HOLDED)).toBe(false);
  });

  it("con Holded, la devolución sube como siempre", () => {
    expect(shouldEnqueueHoldedRefundUpload(CON_HOLDED)).toBe(true);
  });
});

describe("catalogo-local · paidTicketStatus", () => {
  it("sin Holded el ticket nace PAID, no PENDING_SYNC", () => {
    // PENDING_SYNC significa literalmente "esperando a subir a Holded".
    // Sin Holded no hay nada que esperar, y dejarlo ahí le impedía
    // devolver (POST /refunds exige SYNCED o PAID) y le hacía cerrar cada
    // día con todos sus tickets contados como incidencias pendientes
    // (`shift/routes.ts`, `shift/day-cut-run.ts`).
    expect(paidTicketStatus(SIN_HOLDED)).toBe("PAID");
  });

  it("con Holded sigue naciendo PENDING_SYNC, exactamente como antes", () => {
    expect(paidTicketStatus(CON_HOLDED)).toBe("PENDING_SYNC");
  });

  it("los dos estados son devolvibles, que es lo que hacía falta", () => {
    // `POST /tickets/:id/refunds` acepta SYNCED y PAID. Que el estado
    // nuevo esté en esa lista es la razón de elegirlo y no inventar uno.
    const DEVOLVIBLES = ["SYNCED", "PAID"];
    expect(DEVOLVIBLES).toContain(paidTicketStatus(SIN_HOLDED));
  });
});
