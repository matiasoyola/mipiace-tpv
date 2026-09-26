// holded-desconectar · CRITERIO 3 — tras el corte no sale ni una llamada a
// Holded para ese comercio. ADR-020.
//
// ── Cómo se prueba «ni una llamada» ────────────────────────────────────
//
// No mirando si el runner devuelve un skip: eso sólo dice que el runner
// terminó pronto. Se prueba ESPIANDO EL PAQUETE ENTERO: `@mipiacetpv/
// holded-client` se sustituye por un doble en el que CADA función exportada
// y el constructor de `ApiKeyClient` incrementan un contador. Si algún
// camino toca Holded, `llamadas` deja de ser 0 y el test cae con el nombre
// de la función que lo hizo.
//
// Eso es lo que hace que estos tests sirvan de verdad: no comprueban la
// guarda que yo escribí, comprueban la AUSENCIA de tráfico. Un camino nuevo
// que se salte el predicado y llame a Holded los pone rojos aunque nadie
// haya tocado un `if`.
//
// ── Los caminos, uno por `describe` ───────────────────────────────────
//
// El inventario salió de `grep -rn holdedApiKeyCiphertext apps/api/src` más
// los cuatro workers que resuelven la clave por otra vía. Los que se prueban
// aquí son los que corren SOLOS —crons, workers y sweepers—, que son los que
// nadie va a ver fallar. Los que son rutas se prueban en el e2e, donde se
// puede comprobar además el código HTTP y el mensaje.
//
// ── Lo que estos tests protegen de verdad, y lo que NO ────────────────
//
// Esto salió al sabotearlos, y es el hallazgo del fichero. Para CUATRO de
// los runners —los dos syncs, la conciliación de catálogo y la diaria— quitar
// el `motivoSilencio` NO ponía nada en rojo, y no era un fallo del test: es
// que esos cuatro ya se protegían solos con su `if (!holdedApiKeyCiphertext)`,
// y el corte BORRA la clave. La llamada a Holded no sale ni con la guarda ni
// sin ella.
//
// Así que lo que la guarda añade en esos cuatro no es el silencio: es el
// MOTIVO. Y el motivo importa porque es lo que se lee:
//
//   `[catalog-incremental] skip <tenant> (no-api-key)`   ← mentira
//   `[catalog-incremental] skip <tenant> (desconectado)` ← verdad
//
// «no-api-key» en un comercio que dejó Holded dice «le falta la clave», que
// es un pendiente, e invita a ponérsela. Es la misma clase de mentira que el
// banner rojo del TPV, servida en el log. Por eso estos tests afirman el
// MOTIVO y no sólo que hubo un skip: un test que no distingue las dos
// razones no puede ponerse rojo, y uno que no puede ponerse rojo no es un
// test.
//
// El silencio de verdad lo sostienen tres cosas y ninguna es un `if`: la
// clave BORRADA, el CHECK `tenants_holded_desconectado_ck` que impide que
// vuelva sin limpiar la fecha, y el trigger de `holded_uploads`.
//
// Donde la guarda SÍ es la única protección —y por eso ahí el sabotaje pone
// rojo de verdad— es en los dos caminos de subida y en el sweeper: sin ella
// el ticket acaba en `SYNC_FAILED` y la fila se re-encola cada cinco minutos.
//
// Sabotajes que este fichero pone en rojo (nº 3 de la tabla del done, uno
// por worker):
//   · quitar el `motivoSilencio` de `runInitialSync`
//   · quitar el de `runIncrementalSync`
//   · quitar el de `runCatalogReconcile`
//   · quitar el de `reconcileTenant`
//   · quitar la rama `holdedDisconnectedAt` de `uploadTicket`
//   · quitar la de `uploadRefund`
//   · quitar el filtro `tenant: { holdedDisconnectedAt: null }` del sweeper
//   · quitar la salida temprana del `image-cache-worker`

import { randomBytes } from "node:crypto";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.REDIS_URL = "redis://localhost:6379";
process.env.JWT_ACCESS_SECRET = "a".repeat(40);
process.env.JWT_REFRESH_SECRET = "b".repeat(40);
process.env.HOLDED_KEY_ENCRYPTION_SECRET = randomBytes(32).toString("base64");

import { beforeEach, describe, expect, it, vi } from "vitest";

// ── El espía del paquete entero ───────────────────────────────────────
const llamadas: string[] = [];

vi.mock("@mipiacetpv/holded-client", async (orig) => {
  const real = await orig<typeof import("@mipiacetpv/holded-client")>();
  const espiado: Record<string, unknown> = {};
  for (const [nombre, valor] of Object.entries(real)) {
    if (typeof valor !== "function") {
      espiado[nombre] = valor;
      continue;
    }
    // Las clases de error se dejan pasar tal cual: los `instanceof` del
    // código dependen de ellas y envolverlas rompería las ramas de captura
    // sin probar nada.
    if (nombre.startsWith("Holded") && nombre.endsWith("Error")) {
      espiado[nombre] = valor;
      continue;
    }
    espiado[nombre] = (...args: unknown[]) => {
      llamadas.push(nombre);
      return (valor as (...a: unknown[]) => unknown)(...args);
    };
  }
  // `ApiKeyClient` se sustituye por un objeto vacío además de contarse: si
  // algo lo construyera y después lo usara, queremos el contador, no un
  // fetch de verdad contra api.holded.com desde la suite.
  espiado.ApiKeyClient = class {
    constructor() {
      llamadas.push("new ApiKeyClient");
    }
  };
  return espiado;
});

// El worker de imágenes no usa el cliente: descarga la URL con `fetch`. Se
// espía aparte, porque una `imageUrl` de Holded ES una llamada a Holded
// aunque no pase por el paquete.
const fetches: string[] = [];
vi.stubGlobal("fetch", (url: unknown) => {
  fetches.push(String(url));
  throw new Error("la suite no sale a la red");
});

vi.mock("../src/queues/product-image-cache.js", () => ({
  enqueueProductImageCache: vi.fn(async () => undefined),
  getProductImageCacheQueue: vi.fn(() => ({ name: "product-image-cache" })),
}));

const { runInitialSync, InitialSyncSkippedError } = await import(
  "../src/onboarding/initial-sync.js"
);
const { runIncrementalSync, IncrementalSyncSkippedError } = await import(
  "../src/catalog/incremental-sync.js"
);
const { runCatalogReconcile, CatalogReconcileSkippedError } = await import(
  "../src/catalog/reconcile.js"
);
const { reconcileTenant } = await import("../src/tickets/reconciliation.js");
const { uploadTicket } = await import("../src/tickets/upload-ticket.js");
const { uploadRefund } = await import("../src/tickets/upload-refund.js");
const { sweepOrphanUploads } = await import("../src/workers/upload-sweeper.js");
const { processImageCacheJob } = await import("../src/workers/image-cache-worker.js");
const { encryptSecret } = await import("../src/crypto.js");

// La clave del comercio VIVO se cifra de verdad. Con un `"cifrado"` a pelo
// el control moría en `decryptSecret` —después de la guarda, sí, pero antes
// de construir el cliente— y el test no habría podido afirmar que el runner
// llega hasta Holded. Un control que no llega al final no es un control.
const CLAVE_CIFRADA = encryptSecret(
  "clave-holded-de-prueba",
  process.env.HOLDED_KEY_ENCRYPTION_SECRET!,
);

const TENANT = "11111111-1111-1111-1111-111111111111";
const CORTE = new Date("2026-09-26T09:00:00Z");

interface TenantFake {
  id: string;
  holdedEnabled: boolean;
  holdedApiKeyCiphertext: string | null;
  holdedDisconnectedAt: Date | null;
  initialSyncStatus: string;
}

/** El comercio DESPUÉS del corte, tal cual lo deja `ejecutarDejarHolded`. */
function tenantCortado(): TenantFake {
  return {
    id: TENANT,
    holdedEnabled: false,
    holdedApiKeyCiphertext: null,
    holdedDisconnectedAt: CORTE,
    initialSyncStatus: "NOT_APPLICABLE",
  };
}

/** El mismo comercio ANTES del corte. Es el control: cada test comprueba
 *  que su guarda NO se dispara aquí, porque una guarda que corta siempre
 *  no prueba nada. */
function tenantVivo(): TenantFake {
  return {
    id: TENANT,
    holdedEnabled: true,
    holdedApiKeyCiphertext: CLAVE_CIFRADA,
    holdedDisconnectedAt: null,
    initialSyncStatus: "DONE",
  };
}

const logMudo = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

beforeEach(() => {
  llamadas.length = 0;
  fetches.length = 0;
});

describe("criterio 3 · sync inicial", () => {
  const prismaCon = (tenant: unknown) =>
    ({
      tenant: { findUniqueOrThrow: vi.fn(async () => tenant) },
    }) as never;

  it("no corre, no llama a nadie, y el motivo es `desconectado`", async () => {
    // El motivo, no sólo el skip: ver la nota de la cabecera. Sin la guarda
    // este runner lanzaría un `Error` a secas («no Holded API key persisted
    // yet»), el worker lo trataría como FALLO y `registerTenantRepeatable`
    // volvería a poner el cron que la acción acaba de quitar.
    await expect(
      runInitialSync({ tenantId: TENANT, prisma: prismaCon(tenantCortado()), logger: logMudo }),
    ).rejects.toMatchObject({
      name: "InitialSyncSkippedError",
      reason: "desconectado",
    });
    expect(llamadas).toEqual([]);
  });

  it("y la guarda no se dispara antes del corte (control)", async () => {
    // Sin el control, un `throw` incondicional pasaría el test de arriba.
    // Aquí el runner tiene que AVANZAR: llega a construir el cliente.
    await runInitialSync({
      tenantId: TENANT,
      prisma: prismaCon(tenantVivo()),
      logger: logMudo,
    }).catch(() => undefined);
    expect(llamadas).toContain("new ApiKeyClient");
  });
});

describe("criterio 3 · sync incremental", () => {
  const prismaCon = (tenant: unknown) =>
    ({
      tenant: { findUniqueOrThrow: vi.fn(async () => tenant) },
    }) as never;

  it("no corre, no llama a nadie, y el motivo es `desconectado`", async () => {
    // Es el camino más peligroso de todos: su `upsert` casa por
    // `(tenant_id, holded_product_id)` y el corte CONSERVA ese enlace, así
    // que una pasada después del corte pisaría el precio que Ana cambió.
    await expect(
      runIncrementalSync({
        tenantId: TENANT,
        prisma: prismaCon(tenantCortado()),
        logger: logMudo,
      }),
    ).rejects.toMatchObject({
      name: "IncrementalSyncSkippedError",
      // `desconectado` y NO `no-api-key`: es lo que el worker escribe en el
      // log, y en este comercio «le falta la clave» es falso.
      reason: "desconectado",
    });
    expect(llamadas).toEqual([]);
  });

  it("y la guarda no se dispara antes del corte (control)", async () => {
    await runIncrementalSync({
      tenantId: TENANT,
      prisma: prismaCon(tenantVivo()),
      logger: logMudo,
    }).catch(() => undefined);
    expect(llamadas).toContain("new ApiKeyClient");
  });
});

describe("criterio 3 · conciliación de catálogo", () => {
  const prismaCon = (tenant: unknown) =>
    ({
      tenant: { findUniqueOrThrow: vi.fn(async () => tenant) },
    }) as never;

  it("no corre, no llama a nadie, y el motivo es `desconectado`", async () => {
    // Esta pasada ARCHIVA lo que no encuentra en Holded. Un listado vacío
    // por cualquier motivo archivaría el catálogo entero del comercio.
    await expect(
      runCatalogReconcile({
        tenantId: TENANT,
        prisma: prismaCon(tenantCortado()),
        logger: logMudo,
      }),
    ).rejects.toMatchObject({
      name: "CatalogReconcileSkippedError",
      reason: "desconectado",
    });
    expect(llamadas).toEqual([]);
  });

  it("y la guarda no se dispara antes del corte (control)", async () => {
    await runCatalogReconcile({
      tenantId: TENANT,
      prisma: prismaCon(tenantVivo()),
      logger: logMudo,
    }).catch(() => undefined);
    expect(llamadas).toContain("new ApiKeyClient");
  });
});

describe("criterio 3 · conciliación diaria de tickets", () => {
  const prismaCon = (tenant: unknown) =>
    ({
      tenant: { findUniqueOrThrow: vi.fn(async () => tenant) },
      ticket: { findMany: vi.fn(async () => []) },
    }) as never;

  it("no concilia, no llama a nadie, y lo DICE en el log", async () => {
    // Éste elige sus tenants por ACTIVIDAD: `groupBy` de tickets SYNCED de
    // las últimas 48 h. Un comercio recién cortado sigue teniendo 270 así,
    // y los recientes caen en la ventana: se le elegiría dos días más.
    //
    // `reconcileTenant` no devuelve motivo —su firma es la de un resultado de
    // conciliación, no la de un skip—, así que lo observable es la línea del
    // log. Y es lo correcto de afirmar: esa línea es lo ÚNICO que verá quien
    // mire por qué un comercio dejó de conciliarse.
    const lineas: string[] = [];
    const r = await reconcileTenant({
      tenantId: TENANT,
      prisma: prismaCon(tenantCortado()),
      logger: { ...logMudo, info: (m: string) => lineas.push(m) },
    });
    expect(r.ticketsChecked).toBe(0);
    expect(llamadas).toEqual([]);
    expect(lineas.join(" ")).toContain("desconectado");
  });

  it("y la guarda no se dispara antes del corte (control)", async () => {
    await reconcileTenant({
      tenantId: TENANT,
      prisma: prismaCon(tenantVivo()),
      logger: logMudo,
    }).catch(() => undefined);
    expect(llamadas).toContain("new ApiKeyClient");
  });
});

describe("criterio 3 · subida de un ticket (la carrera del corte)", () => {
  function prismaCon(tenant: TenantFake) {
    const uploads: unknown[] = [];
    const ticketUpdates: unknown[] = [];
    return {
      uploads,
      ticketUpdates,
      prisma: {
        ticket: {
          findUnique: vi.fn(async () => ({
            id: "t1",
            status: "PENDING_SYNC",
            total: 10,
            totalTax: 1.73,
            internalNumber: "000001",
            createdAt: new Date(),
            holdedDocumentId: null,
            contactHoldedId: null,
            discountPct: 0,
            lines: [],
            payments: [],
            tenant,
            register: { numSerieHolded: null },
            user: { isTestCashier: false },
          })),
          update: vi.fn(async (a: unknown) => {
            ticketUpdates.push(a);
            return {};
          }),
        },
        holdedUpload: {
          updateMany: vi.fn(async (a: unknown) => {
            uploads.push(a);
            return { count: 1 };
          }),
          update: vi.fn(async (a: unknown) => {
            uploads.push(a);
            return {};
          }),
        },
        $transaction: vi.fn(async (ops: unknown) =>
          Array.isArray(ops) ? await Promise.all(ops as Promise<unknown>[]) : ops,
        ),
      } as never,
    };
  }

  it("cierra la subida como SKIPPED, NO llama a Holded y NO toca el ticket", async () => {
    const { prisma, uploads, ticketUpdates } = prismaCon(tenantCortado());
    const r = await uploadTicket({ externalId: "e1", prisma, logger: logMudo });
    expect(r).toEqual({ kind: "skipped", reason: "holded_desconectado" });
    expect(llamadas).toEqual([]);
    // La parte que de verdad importa: el ticket NO pasa a SYNC_FAILED. Sin
    // esta rama caería en `no_holded_key` y `markFailed` lo mandaría a la
    // bandeja de errores del panel a los dos segundos del corte, con nada
    // que nadie pudiera arreglar.
    expect(ticketUpdates).toEqual([]);
    expect(JSON.stringify(uploads)).toContain("SKIPPED");
    expect(JSON.stringify(uploads)).not.toContain("FAILED");
  });

  it("y antes del corte sigue subiendo (control)", async () => {
    const { prisma } = prismaCon(tenantVivo());
    await uploadTicket({ externalId: "e1", prisma, logger: logMudo }).catch(
      () => undefined,
    );
    expect(llamadas).toContain("new ApiKeyClient");
  });
});

describe("criterio 3 · subida de un abono (la carrera del corte)", () => {
  function prismaCon(tenant: TenantFake) {
    const uploads: unknown[] = [];
    const refundUpdates: unknown[] = [];
    return {
      uploads,
      refundUpdates,
      prisma: {
        refund: {
          findUnique: vi.fn(async () => ({
            id: "r1",
            status: "PENDING_SYNC",
            total: 3,
            totalTax: 0.52,
            internalNumber: "R-000001",
            createdAt: new Date(),
            holdedDocumentId: null,
            lines: [],
            originalTicket: { id: "t1", holdedDocumentId: "d1", holdedDocNumber: "SR-1" },
            tenant,
            register: { numSerieHolded: null },
          })),
          update: vi.fn(async (a: unknown) => {
            refundUpdates.push(a);
            return {};
          }),
        },
        holdedUpload: {
          updateMany: vi.fn(async (a: unknown) => {
            uploads.push(a);
            return { count: 1 };
          }),
          update: vi.fn(async (a: unknown) => {
            uploads.push(a);
            return {};
          }),
        },
        $transaction: vi.fn(async (ops: unknown) =>
          Array.isArray(ops) ? await Promise.all(ops as Promise<unknown>[]) : ops,
        ),
      } as never,
    };
  }

  it("cierra la subida como SKIPPED y NO deja el abono en SYNC_FAILED", async () => {
    // Aquí importa más que en la venta: un abono en `SYNC_FAILED` bloquea
    // las devoluciones legítimas de esas líneas hasta que alguien lo anule
    // a mano (v1.5-consistencia-A §3.c).
    const { prisma, uploads, refundUpdates } = prismaCon(tenantCortado());
    const r = await uploadRefund({ externalId: "e2", prisma, logger: logMudo });
    expect(r).toEqual({ kind: "skipped", reason: "holded_desconectado" });
    expect(llamadas).toEqual([]);
    expect(refundUpdates).toEqual([]);
    expect(JSON.stringify(uploads)).toContain("SKIPPED");
  });

  it("y antes del corte sigue subiendo (control)", async () => {
    const { prisma } = prismaCon(tenantVivo());
    await uploadRefund({ externalId: "e2", prisma, logger: logMudo }).catch(
      () => undefined,
    );
    expect(llamadas).toContain("new ApiKeyClient");
  });
});

describe("criterio 3 · el sweeper de subidas huérfanas", () => {
  // El sweeper era el ÚNICO camino del inventario sin ningún filtro por
  // tenant: barría `status = PENDING` de toda la base. En la copia de prod
  // del 24-09 eso son las dos filas del 26-05 de Sole, sin ticket detrás,
  // re-encoladas cada cinco minutos desde hace cuatro meses.
  function fakeQueue() {
    const added: string[] = [];
    return {
      added,
      cola: {
        getJob: async () => null,
        add: async (_n: string, d: { externalId: string }) => {
          added.push(d.externalId);
        },
      },
    };
  }

  it("no re-encola nada de un comercio que dejó Holded", async () => {
    const t = fakeQueue();
    const r = fakeQueue();
    const vistos: unknown[] = [];
    const res = await sweepOrphanUploads({
      prisma: {
        holdedUpload: {
          findMany: vi.fn(async (args: unknown) => {
            vistos.push(args);
            // El fake HONRA el filtro, que es lo que hace que quitarlo del
            // código ponga esto en rojo en vez de pasar de largo.
            const where = (args as { where: Record<string, unknown> }).where;
            const filtraCortados =
              JSON.stringify(where.tenant ?? null).includes("holdedDisconnectedAt");
            return filtraCortados ? [] : [{ externalId: "e1", kind: "TICKET" as const }];
          }),
        },
      },
      ticketQueue: t.cola,
      refundQueue: r.cola,
      log: () => undefined,
    });
    expect(res.rescued).toBe(0);
    expect(t.added).toEqual([]);
    expect(JSON.stringify(vistos)).toContain("holdedDisconnectedAt");
  });
});

describe("criterio 3 · la caché de imágenes", () => {
  // La `imageUrl` de una ficha que viene de Holded APUNTA A HOLDED, y el
  // corte no la borra (borrarla dejaría sin foto una rejilla que
  // funcionaba). Así que este worker es una llamada a Holded aunque no use
  // el cliente del paquete.
  const producto = (tenant: unknown) => ({
    id: "p1",
    tenantId: TENANT,
    imageUrl: "https://cdn.holded.com/imagen.jpg",
    imageMime: null,
    imageCachedAt: null,
    tenant,
  });

  it("no descarga nada de un comercio que dejó Holded", async () => {
    const res = await processImageCacheJob("p1", {
      prisma: {
        product: { findUnique: vi.fn(async () => producto(tenantCortado())) },
      } as never,
      cacheDir: "/tmp/no-se-usa",
      maxBytes: 1_000_000,
      fetchImpl: ((url: unknown) => {
        fetches.push(String(url));
        throw new Error("la suite no sale a la red");
      }) as unknown as typeof fetch,
      logger: logMudo,
    });
    expect(res.status).toBe("skipped");
    expect(res.reason).toBe("holded-desconectado");
    expect(fetches).toEqual([]);
  });

  it("y antes del corte sí descarga (control)", async () => {
    await processImageCacheJob("p1", {
      prisma: {
        product: { findUnique: vi.fn(async () => producto(tenantVivo())) },
      } as never,
      cacheDir: "/tmp/no-se-usa",
      maxBytes: 1_000_000,
      fetchImpl: ((url: unknown) => {
        fetches.push(String(url));
        throw new Error("la suite no sale a la red");
      }) as unknown as typeof fetch,
      decryptKey: () => "clave",
      logger: logMudo,
    }).catch(() => undefined);
    expect(fetches.join()).toContain("cdn.holded.com");
  });
});
