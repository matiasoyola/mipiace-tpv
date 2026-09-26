// holded-desconectar · la salud que dejaba de mentir, y el vaciado de colas.
// ADR-020.
//
// ── Parte 1 · la barra roja del TPV ───────────────────────────────────
//
// `catalogo-local` gateó el banner del ADMIN porque «Holded está
// desconectado» es una alarma para quien depende de Holded y una mentira
// para quien no (§2.15 de su done). El banner del TPV se quedó sin gatear, y
// es el que ve la cajera todo el día:
//
//   «Holded desconectado · La cuenta de Holded no está conectada. Puedes
//    seguir cobrando: los tickets se guardan y se subirán solos cuando el
//    propietario la reconecte. Avísale cuanto antes.»
//
// Cuatro afirmaciones y las cuatro falsas en el comercio de este bloque. Se
// arregla en `getTenantHealthStatus` y no en el componente porque el mismo
// endpoint lo consumen el TPV y el panel: arreglar sólo uno dejaría la misma
// pregunta contestada de dos maneras según quién preguntara.
//
// ── Parte 2 · las colas ───────────────────────────────────────────────
//
// Redis no entra en la transacción del corte, así que el vaciado va después
// y tiene que ser re-ejecutable. Se prueba con colas falsas: lo que importa
// es QUÉ jobs se quitan y cuáles no, no que BullMQ funcione.
//
// Sabotajes que este fichero pone en rojo (tabla del done):
//   · quitar la rama `no_aplica` de `getTenantHealthStatus`
//   · dejar de quitar el repeatable del sync incremental (volvería a
//     encolar solo a los 15 minutos)
//   · barrer jobs de OTRO comercio (nº 8 de la tabla, en su versión Redis)

import { randomBytes } from "node:crypto";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.REDIS_URL = "redis://localhost:6379";
process.env.HOLDED_KEY_ENCRYPTION_SECRET = randomBytes(32).toString("base64");

import { describe, expect, it, vi } from "vitest";

const { getTenantHealthStatus } = await import("../src/tickets/health.js");
const { vaciarColasDeHolded } = await import("../src/holded/dejar-holded-colas.js");

const TENANT = "11111111-1111-1111-1111-111111111111";
const OTRO = "22222222-2222-2222-2222-222222222222";
const AHORA = new Date("2026-09-27T10:00:00Z");

function prismaConTenant(t: Record<string, unknown>) {
  return { tenant: { findUniqueOrThrow: vi.fn(async () => t) } } as never;
}

describe("holded-desconectar · la salud de Holded deja de mentir", () => {
  it("el comercio que DEJÓ Holded está ok, con motivo `no_aplica`", async () => {
    const h = await getTenantHealthStatus(
      prismaConTenant({
        lastIncrementalSyncAt: new Date("2026-09-26T08:45:00Z"),
        holdedApiKeyCiphertext: null,
        holdedEnabled: false,
        holdedDisconnectedAt: new Date("2026-09-26T09:00:00Z"),
      }),
      TENANT,
      AHORA,
    );
    // `level: ok` es lo que apaga el banner: `HealthBanner` del TPV pinta
    // rojo con `blocked` y ámbar con `warning`, y devuelve null con `ok`.
    expect(h.level).toBe("ok");
    expect(h.reason).toBe("no_aplica");
    expect(h.blockedAt).toBeNull();
  });

  it("el comercio que NUNCA lo tuvo, también", async () => {
    // Éste ya existía desde catalogo-local y llevaba la barra roja puesta
    // igual: el bug no lo estrena este bloque, lo hereda.
    const h = await getTenantHealthStatus(
      prismaConTenant({
        lastIncrementalSyncAt: null,
        holdedApiKeyCiphertext: null,
        holdedEnabled: false,
        holdedDisconnectedAt: null,
      }),
      TENANT,
      AHORA,
    );
    expect(h.level).toBe("ok");
    expect(h.reason).toBe("no_aplica");
  });

  it("el que SÍ usa Holded y no lo ha conectado sigue en rojo, y debe", async () => {
    // Éste es exactamente el comercio que TIENE un problema: compró el ERP
    // y está cobrando sin subir nada. Quitarle la alarma sería el bug al
    // revés.
    const h = await getTenantHealthStatus(
      prismaConTenant({
        lastIncrementalSyncAt: null,
        holdedApiKeyCiphertext: null,
        holdedEnabled: true,
        holdedDisconnectedAt: null,
      }),
      TENANT,
      AHORA,
    );
    expect(h.level).toBe("blocked");
    expect(h.reason).toBe("no_api_key");
  });

  it("y el que lo tiene conectado y al día sigue ok de lo suyo", async () => {
    const h = await getTenantHealthStatus(
      prismaConTenant({
        lastIncrementalSyncAt: new Date("2026-09-27T09:50:00Z"),
        holdedApiKeyCiphertext: "x",
        holdedEnabled: true,
        holdedDisconnectedAt: null,
      }),
      TENANT,
      AHORA,
    );
    expect(h.level).toBe("ok");
    expect(h.reason).toBe("ok");
    expect(h.hasHoldedKey).toBe(true);
  });
});

// ── Las colas ────────────────────────────────────────────────────────
function colaFalsa(
  name: string,
  jobs: Array<{ id: string; data: unknown }>,
): { cola: any; quitados: string[] } {
  const quitados: string[] = [];
  return {
    quitados,
    cola: {
      name,
      getJobs: async () =>
        jobs.map((j) => ({
          id: j.id,
          data: j.data,
          remove: async () => {
            quitados.push(j.id);
          },
        })),
    },
  };
}

describe("holded-desconectar · vaciar las colas", () => {
  it("quita el repeatable del sync incremental antes que nada", async () => {
    // Es lo PRIMERO a propósito: mientras exista, cada quince minutos vuelve
    // a poner un job en la cola que acabamos de vaciar.
    const quitados: string[] = [];
    const r = await vaciarColasDeHolded({
      tenantId: TENANT,
      colas: [],
      quitarRepeatable: async (t) => {
        quitados.push(t);
      },
      log: () => undefined,
    });
    expect(quitados).toEqual([TENANT]);
    expect(r.repeatableQuitado).toBe(true);
  });

  it("quita los jobs de ESTE comercio y deja los de los demás", async () => {
    const incr = colaFalsa("catalog-incremental", [
      { id: "j1", data: { tenantId: TENANT, source: "cron" } },
      { id: "j2", data: { tenantId: OTRO, source: "cron" } },
    ]);
    const contactos = colaFalsa("contact-import", [
      { id: "j3", data: { tenantId: OTRO } },
    ]);
    const r = await vaciarColasDeHolded({
      tenantId: TENANT,
      colas: [incr.cola, contactos.cola],
      quitarRepeatable: async () => undefined,
      log: () => undefined,
    });
    expect(incr.quitados).toEqual(["j1"]);
    expect(contactos.quitados).toEqual([]);
    expect(r.porCola["catalog-incremental"]).toBe(1);
    expect(r.porCola["contact-import"]).toBe(0);
  });

  it("no toca los jobs que no llevan tenantId", async () => {
    // `ticket-upload` y `refund-upload` llevan sólo `externalId`. Resolver
    // de quién es cada uno costaría una consulta por job, y un job de
    // subida de un comercio cortado ya no hace daño: su runner lo cierra
    // como SKIPPED sin llamar a nadie. Barrer por `tenantId` cuando está y
    // no inventar cuando no está.
    const subidas = colaFalsa("ticket-upload", [
      { id: "j9", data: { externalId: "abc" } },
    ]);
    await vaciarColasDeHolded({
      tenantId: TENANT,
      colas: [subidas.cola],
      quitarRepeatable: async () => undefined,
      log: () => undefined,
    });
    expect(subidas.quitados).toEqual([]);
  });

  it("un Redis caído NO tumba nada: se anota y se sigue", async () => {
    // Cuando esto corre, el corte ya está comprometido en Postgres. Lanzar
    // aquí devolvería un 500 sobre una operación que SÍ se hizo, y el
    // super-admin no sabría si repetirla.
    const r = await vaciarColasDeHolded({
      tenantId: TENANT,
      colas: [
        {
          name: "catalog-incremental",
          getJobs: async () => {
            throw new Error("ECONNREFUSED");
          },
        } as never,
      ],
      quitarRepeatable: async () => {
        throw new Error("ECONNREFUSED");
      },
      log: () => undefined,
    });
    expect(r.repeatableQuitado).toBe(false);
    expect(r.errores).toHaveLength(2);
    expect(r.errores.join()).toContain("ECONNREFUSED");
  });

  it("es re-ejecutable: sobre colas ya vacías no hace nada y no falla", async () => {
    // Criterio 9 del bloque, la mitad de Redis.
    const vacia = colaFalsa("catalog-incremental", []);
    const r = await vaciarColasDeHolded({
      tenantId: TENANT,
      colas: [vacia.cola],
      quitarRepeatable: async () => undefined,
      log: () => undefined,
    });
    expect(r.errores).toEqual([]);
    expect(r.porCola["catalog-incremental"]).toBe(0);
  });
});
