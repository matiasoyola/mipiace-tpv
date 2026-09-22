// catalogo-local · PUERTA 4 — sin destino en Holded no se encola nada.
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
// ── addendum 3 · la tabla que este fichero guarda ──────────────────────
//
// El predicado dejó de ser "¿tiene clave?" y pasó a ser un valor de tres
// estados, porque esa señal significaba dos cosas distintas:
//
//   destino              ¿encola? estado al cobrar   log
//   ───────────────────  ──────── ─────────────────  ────────
//   NONE                 no       PAID               info
//   NOT_CONNECTED_YET    no       PAID               WARNING
//   READY                sí       PENDING_SYNC       (ninguno)
//
// Las dos primeras HACEN lo mismo y NO SIGNIFICAN lo mismo. La segunda es
// una anomalía: un cliente que compró el ERP está cobrando antes de
// conectarlo y esas ventas no llegarán nunca a su contabilidad.
//
// Sabotajes que este fichero pone en rojo:
//   · mandar `NOT_CONNECTED_YET` a PENDING_SYNC ("que espere y suba")
//   · igualar los dos logs, o quitar el warning
//   · que `holdedDestination` lea `!holdedEnabled` en vez de `=== false`
//
// Aquí se prueba la decisión pura (`holded-upload-gate.ts`), que es el
// único punto donde se decide. Los caminos completos los ejerce el e2e.

import { describe, expect, it, vi } from "vitest";

import {
  holdedDestination,
  logHoldedUploadSkipped,
  paidTicketStatus,
  shouldEnqueueHoldedRefundUpload,
  shouldEnqueueHoldedUpload,
  type HoldedDestination,
} from "../src/tickets/holded-upload-gate.js";

// Los tres tenants de la tabla, tal y como salen de la base.
const TENANT_SIN_HOLDED = { holdedEnabled: false, holdedApiKeyCiphertext: null };
const TENANT_SIN_CONECTAR = { holdedEnabled: true, holdedApiKeyCiphertext: null };
const TENANT_CONECTADO = { holdedEnabled: true, holdedApiKeyCiphertext: "v1:cipher" };

const NONE: HoldedDestination = "NONE";
const SIN_CONECTAR: HoldedDestination = "NOT_CONNECTED_YET";
const READY: HoldedDestination = "READY";

describe("catalogo-local · holdedDestination", () => {
  it("traduce los tres tenants a los tres destinos", () => {
    expect(holdedDestination(TENANT_SIN_HOLDED)).toBe("NONE");
    expect(holdedDestination(TENANT_SIN_CONECTAR)).toBe("NOT_CONNECTED_YET");
    expect(holdedDestination(TENANT_CONECTADO)).toBe("READY");
  });

  it("el interruptor manda sobre la clave", () => {
    // Estado que la guarda de 409 del super-admin impide crear, pero que
    // podría existir si alguien toca la base a mano. Si pasara, lo que NO
    // queremos es subirle ventas a un ERP que ha dicho que no usa.
    expect(
      holdedDestination({ holdedEnabled: false, holdedApiKeyCiphertext: "v1:cipher" }),
    ).toBe("NONE");
  });

  it("un tenant sin la columna se comporta como el de siempre", () => {
    // `@default(true)` y `!== false`. Si esto leyera `!holdedEnabled`, un
    // `select` al que se le olvidara la columna dejaría de subir a Holded
    // EN SILENCIO en todos los tenants de producción a la vez.
    expect(holdedDestination({ holdedApiKeyCiphertext: "v1:cipher" })).toBe("READY");
    expect(holdedDestination({ holdedApiKeyCiphertext: null })).toBe(
      "NOT_CONNECTED_YET",
    );
    expect(
      holdedDestination({ holdedEnabled: undefined, holdedApiKeyCiphertext: "x" }),
    ).toBe("READY");
  });
});

describe("catalogo-local · shouldEnqueueHoldedUpload", () => {
  it("sin destino no se encola NADA, sea cual sea el estado", () => {
    for (const destino of [NONE, SIN_CONECTAR]) {
      expect(shouldEnqueueHoldedUpload("PENDING_SYNC" as never, destino)).toBe(false);
      expect(shouldEnqueueHoldedUpload("PAID" as never, destino)).toBe(false);
      expect(shouldEnqueueHoldedUpload("SYNC_FAILED" as never, destino)).toBe(false);
      expect(shouldEnqueueHoldedUpload("ON_CREDIT" as never, destino)).toBe(false);
    }
  });

  it("con destino READY, el comportamiento de siempre: todo menos el fiado vivo", () => {
    // La variante B del fiado (v1.8) no se toca. Un fiado con deuda viva
    // no sube hasta saldarse. Esto es el criterio 4 del bloque en una
    // línea: el tenant con Holded conectado se comporta igual que antes.
    expect(shouldEnqueueHoldedUpload("PENDING_SYNC" as never, READY)).toBe(true);
    expect(shouldEnqueueHoldedUpload("PAID" as never, READY)).toBe(true);
    expect(shouldEnqueueHoldedUpload("ON_CREDIT" as never, READY)).toBe(false);
  });

  it("el destino manda sobre el estado: sin él, ni un fiado saldado sube", () => {
    expect(shouldEnqueueHoldedUpload("PAID" as never, NONE)).toBe(false);
    expect(shouldEnqueueHoldedUpload("PAID" as never, SIN_CONECTAR)).toBe(false);
  });
});

describe("catalogo-local · shouldEnqueueHoldedRefundUpload", () => {
  it("una devolución sin destino no encola: no hay abono que subir", () => {
    expect(shouldEnqueueHoldedRefundUpload(NONE)).toBe(false);
    expect(shouldEnqueueHoldedRefundUpload(SIN_CONECTAR)).toBe(false);
  });

  it("con destino READY, la devolución sube como siempre", () => {
    expect(shouldEnqueueHoldedRefundUpload(READY)).toBe(true);
  });
});

describe("catalogo-local · paidTicketStatus", () => {
  it("sin destino el ticket nace PAID, no PENDING_SYNC", () => {
    // PENDING_SYNC significa literalmente "esperando a subir a Holded".
    // Sin destino no hay nada que esperar, y dejarlo ahí le impedía
    // devolver (POST /refunds exige SYNCED o PAID) y le hacía cerrar cada
    // día con todos sus tickets contados como incidencias pendientes
    // (`shift/routes.ts`, `shift/day-cut-run.ts`).
    expect(paidTicketStatus(NONE)).toBe("PAID");
  });

  it("el que aún no ha conectado TAMPOCO va a PENDING_SYNC", () => {
    // Lo intuitivo sería "que espere ahí y suba cuando llegue la clave".
    // No hay sweeper que recoja PENDING_SYNC: el ticket se quedaría
    // enterrado para siempre, sin poder devolverse y contando como
    // incidencia en el corte y el Z, cada día. Lo que avisa de este caso
    // es el WARNING del log y el check de onboarding-health, no el
    // estado. Ver la cabecera del gate.
    expect(paidTicketStatus(SIN_CONECTAR)).toBe("PAID");
  });

  it("con destino READY sigue naciendo PENDING_SYNC, exactamente como antes", () => {
    expect(paidTicketStatus(READY)).toBe("PENDING_SYNC");
  });

  it("los dos estados son devolvibles, que es lo que hacía falta", () => {
    // `POST /tickets/:id/refunds` acepta SYNCED y PAID. Que el estado
    // nuevo esté en esa lista es la razón de elegirlo y no inventar uno.
    const DEVOLVIBLES = ["SYNCED", "PAID"];
    expect(DEVOLVIBLES).toContain(paidTicketStatus(NONE));
    expect(DEVOLVIBLES).toContain(paidTicketStatus(SIN_CONECTAR));
  });
});

describe("catalogo-local · logHoldedUploadSkipped", () => {
  function logFalso() {
    return { info: vi.fn(), warn: vi.fn() };
  }
  const CAMPOS = {
    externalId: "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
    tenantId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    camino: "ticket",
  };

  it("el comercio que no usa Holded deja una línea INFO, no un warning", () => {
    // Correcto por diseño: no hay destino y no lo habrá. Pero se loguea,
    // porque el criterio 2 del bloque pide que se VEA que no se intenta.
    // Un silencio sin línea es indistinguible de un olvido.
    const log = logFalso();
    logHoldedUploadSkipped(log, NONE, CAMPOS);
    expect(log.info).toHaveBeenCalledTimes(1);
    expect(log.warn).not.toHaveBeenCalled();
  });

  it("el que compró Holded y no lo ha conectado deja un WARNING con el id", () => {
    // Ésta es la anomalía: sus ventas no llegarán nunca a su
    // contabilidad. No puede pasar en silencio ni confundirse con el
    // caso de arriba — es lo que el §3 del bloque llama "fallar
    // ruidosamente, nunca en silencio".
    const log = logFalso();
    logHoldedUploadSkipped(log, SIN_CONECTAR, CAMPOS);
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(log.info).not.toHaveBeenCalled();
    const [campos, mensaje] = log.warn.mock.calls[0]!;
    expect(campos).toMatchObject({ externalId: CAMPOS.externalId });
    expect(mensaje).toMatch(/ANTES de conectar Holded/);
  });

  it("los dos motivos NO comparten la línea", () => {
    // Hacen lo mismo y no significan lo mismo. Si algún día alguien
    // unifica los dos logs "porque son el mismo caso", esto se pone rojo.
    const a = logFalso();
    const b = logFalso();
    logHoldedUploadSkipped(a, NONE, CAMPOS);
    logHoldedUploadSkipped(b, SIN_CONECTAR, CAMPOS);
    const mensajeNone = a.info.mock.calls[0]![1];
    const mensajeSinConectar = b.warn.mock.calls[0]![1];
    expect(mensajeNone).not.toEqual(mensajeSinConectar);
  });

  it("con destino READY no escribe nada: mentiría", () => {
    const log = logFalso();
    logHoldedUploadSkipped(log, READY, CAMPOS);
    expect(log.info).not.toHaveBeenCalled();
    expect(log.warn).not.toHaveBeenCalled();
  });
});
