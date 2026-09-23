// H1 · la salud del onboarding depende de los módulos (ADR-016).
//
// Lo que este banco fija:
//
//   1. Cada check declara `requires`, y el que no aplica sale con
//      `applies: false` y NO cuenta para `ready`.
//   2. Los que aplican siguen EXACTAMENTE igual de duros que en master:
//      ni un umbral relajado.
//   3. Una empresa con caja y Holded ve los siete checks aplicando y se
//      comporta como antes del bloque.
//   4. Los dos checks nuevos —al menos un módulo, datos fiscales
//      mínimos— valen para cualquier empresa y sí bloquean.
//   5. `sync-done` depende de HOLDED, no de la caja: una caja local sin
//      Holded no se queda bloqueada por un sync que nunca correrá.
//
// Sabotajes que este fichero pone en rojo (§3 del done):
//   · dejar un check de Holded como bloqueante sin caja (nº 2)
//   · volver `ready` a `checks.every(ok)`
//   · quitar el check de "al menos un módulo"

import { describe, expect, it } from "vitest";

import { computeOnboardingHealth } from "../src/superadmin/onboarding-health.js";

const TENANT_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

interface Escenario {
  cajaEnabled?: boolean;
  crmEnabled?: boolean;
  agendaEnabled?: boolean;
  // catalogo-local (addendum 3) · ¿está previsto que use Holded? Antes
  // esto se deducía de la clave, y deducirlo era el bug.
  holdedEnabled?: boolean;
  holdedApiKeyCiphertext?: string | null;
  // Tickets en PAID sin fila en holded_uploads (cobros que no subirán).
  ticketsCobradosSinSubir?: number;
  initialSyncStatus?: string;
  fiscalProfile?: unknown;
  // Contadores del catálogo. Los defaults describen un tenant con caja
  // perfectamente onboardeado, para que cada test cambie sólo lo suyo.
  taxes?: number;
  taxesWithRate?: number;
  productsTotal?: number;
  productsSellable?: number;
  ticketsSyncFailed?: number;
  testCashier?: boolean;
}

// Prisma falso mínimo: sólo lo que `computeOnboardingHealth` toca.
function prismaFor(e: Escenario): any {
  const counts: number[] = [
    e.taxes ?? 10, // tenantTax.count
    e.taxesWithRate ?? 10, // tenantTax.count (rate not null)
    e.productsTotal ?? 20, // product.count PRODUCT
    e.productsSellable ?? 20, // product.count PRODUCT sellable
    e.productsTotal ?? 20, // product.count PRODUCT withSku
    0, // product.count SERVICE
    0, // product.count SERVICE sellable
  ];
  let taxCall = 0;
  let productCall = 0;
  return {
    tenant: {
      findUniqueOrThrow: async () => ({
        initialSyncStatus: e.initialSyncStatus ?? "DONE",
        initialSyncCompletedAt: new Date("2026-09-01T10:00:00Z"),
        initialSyncStartedAt: new Date("2026-09-01T09:00:00Z"),
        initialSyncStats: null,
        cajaEnabled: e.cajaEnabled ?? true,
        crmEnabled: e.crmEnabled ?? false,
        agendaEnabled: e.agendaEnabled ?? false,
        holdedEnabled: e.holdedEnabled ?? true,
        holdedApiKeyCiphertext:
          e.holdedApiKeyCiphertext === undefined ? "v1:cipher" : e.holdedApiKeyCiphertext,
        fiscalProfile:
          e.fiscalProfile === undefined
            ? { legalName: "Peluquería Sole SL", taxId: "12345678Z" }
            : e.fiscalProfile,
      }),
    },
    tenantTax: { count: async () => counts[taxCall++]! },
    product: { count: async () => counts[2 + productCall++]! },
    contact: { count: async () => 5 },
    ticket: {
      count: async ({ where }: any) =>
        where.status === "SYNC_FAILED" ? (e.ticketsSyncFailed ?? 0) : 0,
      findFirst: async () => null,
    },
    user: {
      findFirst: async () => ((e.testCashier ?? true) ? { id: "u-test" } : null),
    },
    // catalogo-local (addendum 3) · el NOT EXISTS de los cobros que no
    // subirán. Va por `$queryRaw` porque no hay relación Prisma entre
    // Ticket y HoldedUpload — ver el comentario en onboarding-health.ts.
    $queryRaw: async () => [{ n: e.ticketsCobradosSinSubir ?? 0 }],
  };
}

async function health(e: Escenario) {
  return computeOnboardingHealth(prismaFor(e) as never, TENANT_ID);
}

function byId(h: Awaited<ReturnType<typeof health>>, id: string) {
  const c = h.readinessChecks.find((x) => x.id === id);
  if (!c) throw new Error(`check ${id} no existe`);
  return c;
}

describe("H1 · empresa CON caja y CON Holded: como en master", () => {
  it("todos los checks aplican y está lista", async () => {
    const h = await health({});
    expect(h.readinessChecks.every((c) => c.applies)).toBe(true);
    expect(h.ready).toBe(true);
  });

  it("los umbrales siguen igual de duros: 79% de taxes con rate no pasa", async () => {
    const h = await health({ taxes: 100, taxesWithRate: 79 });
    expect(byId(h, "taxes-ratio").ok).toBe(false);
    expect(h.ready).toBe(false);
  });

  it("un catálogo vacío sigue sin pasar", async () => {
    const h = await health({ productsTotal: 0, productsSellable: 0 });
    expect(byId(h, "products-sellable").ok).toBe(false);
    expect(h.ready).toBe(false);
  });

  it("un ticket SYNC_FAILED sigue bloqueando", async () => {
    const h = await health({ ticketsSyncFailed: 1 });
    expect(byId(h, "no-sync-failures").ok).toBe(false);
    expect(h.ready).toBe(false);
  });

  it("sin cajero técnico sigue bloqueando", async () => {
    const h = await health({ testCashier: false });
    expect(byId(h, "test-cashier-provisioned").ok).toBe(false);
    expect(h.ready).toBe(false);
  });

  it("el sync a medias sigue bloqueando", async () => {
    const h = await health({ initialSyncStatus: "RUNNING" });
    expect(byId(h, "sync-done").ok).toBe(false);
    expect(h.ready).toBe(false);
  });
});

describe("H1 · empresa SIN caja y SIN Holded (el colegio)", () => {
  const COLEGIO: Escenario = {
    cajaEnabled: false,
    crmEnabled: true,
    // catalogo-local (addendum 3) · EXPLÍCITO donde H1 lo deducía.
    //
    // H1 usaba "no tiene clave" como sinónimo de "no usa Holded", y esa
    // es justo la señal de dos significados que el addendum parte en
    // dos. El colegio de verdad —el que no lo va a conectar nunca— es
    // ahora el que tiene el interruptor apagado. Un tenant sin clave y
    // con el interruptor ENCENDIDO ya no es un colegio: es una empresa a
    // mitad de su onboarding, y debe seguir sin poder activarse.
    holdedEnabled: false,
    holdedApiKeyCiphertext: null,
    initialSyncStatus: "NOT_APPLICABLE",
    // Catálogo vacío y sin cajero técnico: en master esto era cinco
    // checks en rojo y una cuenta que no se podía activar jamás.
    taxes: 0,
    taxesWithRate: 0,
    productsTotal: 0,
    productsSellable: 0,
    testCashier: false,
  };

  it("está lista pese a tener el catálogo vacío y ningún cajero técnico", async () => {
    const h = await health(COLEGIO);
    expect(h.ready).toBe(true);
  });

  it("los cinco checks de caja y Holded salen como 'no aplica', no como fallo", async () => {
    const h = await health(COLEGIO);
    for (const id of [
      "taxes-ratio",
      "products-sellable",
      "no-sync-failures",
      "test-cashier-provisioned",
      "sync-done",
    ]) {
      expect(byId(h, id).applies, id).toBe(false);
    }
  });

  it("cada check dice de qué depende", async () => {
    const h = await health(COLEGIO);
    expect(byId(h, "sync-done").requires).toBe("holded");
    // catalogo-local (addendum 3) · MUDADO de `caja` a `holded`.
    // `TenantTax` se puebla sólo desde el sync de Holded, así que en un
    // comercio sin Holded tiene cero filas por definición: el check no
    // medía su salud, medía la existencia del sync.
    expect(byId(h, "taxes-ratio").requires).toBe("holded");
    expect(byId(h, "products-sellable").requires).toBe("caja");
    expect(byId(h, "no-sync-failures").requires).toBe("caja");
    expect(byId(h, "test-cashier-provisioned").requires).toBe("caja");
    expect(byId(h, "modules-enabled").requires).toBe("always");
    expect(byId(h, "fiscal-minimum").requires).toBe("always");
  });

  it("la respuesta dice qué empresa es, para que la pantalla lo explique", async () => {
    const h = await health(COLEGIO);
    // F1 · el mapa de módulos gana el cuarto. `false` para cualquier
    // tenant de hoy: es la prueba de que la migración no enciende nada.
    expect(h.modules).toEqual({
      caja: false,
      crm: true,
      agenda: false,
      fichaje: false,
    });
    expect(h.holded).toEqual({ enabled: false, connected: false });
  });
});

// ── catalogo-local · addendum 3 ───────────────────────────────────────
//
// La empresa que compró Holded y todavía no lo ha conectado. H1 no podía
// distinguirla del colegio: las dos "no tenían clave". Es el caso que da
// sentido a la columna.
describe("catalogo-local · a mitad del onboarding: previsto y sin conectar", () => {
  const A_MEDIAS: Escenario = {
    cajaEnabled: true,
    holdedEnabled: true,
    holdedApiKeyCiphertext: null,
    initialSyncStatus: "NOT_APPLICABLE",
    taxes: 0,
    taxesWithRate: 0,
  };

  it("NO se puede activar: sigue sin estar lista", async () => {
    // Esto es lo que hay que proteger al mover `taxes-ratio`. Antes del
    // addendum, a esta empresa la bloqueaba `taxes-ratio` con sus cero
    // filas de TenantTax. Ahora la bloquea `sync-done`, que es el check
    // que lo dice de verdad. El resultado para el implantador es el
    // mismo —no se activa— y por eso el cambio es seguro.
    const h = await health(A_MEDIAS);
    expect(h.ready).toBe(false);
    expect(byId(h, "sync-done").applies).toBe(true);
    expect(byId(h, "sync-done").ok).toBe(false);
  });

  it("los checks de Holded le APLICAN, al revés que al comercio sin Holded", async () => {
    const h = await health(A_MEDIAS);
    expect(byId(h, "taxes-ratio").applies).toBe(true);
    expect(byId(h, "tickets-before-holded").applies).toBe(true);
  });

  it("la respuesta separa las dos preguntas", async () => {
    const h = await health(A_MEDIAS);
    expect(h.holded).toEqual({ enabled: true, connected: false });
  });

  it("los cobros anteriores a conectar Holded se cantan y bloquean", async () => {
    // El hermano en pantalla del log.warn del gate: el warning sirve si
    // alguien mira los logs ese día; esto sirve el resto de los días.
    const h = await health({ ...A_MEDIAS, ticketsCobradosSinSubir: 12 });
    const c = byId(h, "tickets-before-holded");
    expect(c.ok).toBe(false);
    expect(c.value).toContain("12");
    expect(h.ready).toBe(false);
  });

  it("al comercio SIN Holded esos mismos cobros no le dicen nada", async () => {
    // Que sus tickets no suban no es una anomalía: es el diseño. Si este
    // check le aplicara, no podría activarse nunca en cuanto cobrara.
    const h = await health({
      cajaEnabled: true,
      holdedEnabled: false,
      holdedApiKeyCiphertext: null,
      initialSyncStatus: "NOT_APPLICABLE",
      taxes: 0,
      taxesWithRate: 0,
      ticketsCobradosSinSubir: 340,
    });
    expect(byId(h, "tickets-before-holded").applies).toBe(false);
    expect(h.ready).toBe(true);
  });
});

describe("H1 · caja local: con caja y sin Holded", () => {
  it("el sync no bloquea, porque depende de Holded y no de la caja", async () => {
    const h = await health({
      cajaEnabled: true,
      // catalogo-local (addendum 3) · explícito, como el colegio. Éste es
      // el comercio del bloque: cobra, y su catálogo nace en la BD.
      holdedEnabled: false,
      holdedApiKeyCiphertext: null,
      initialSyncStatus: "NOT_APPLICABLE",
    });
    expect(byId(h, "sync-done").applies).toBe(false);
    // Y `taxes-ratio` TAMPOCO le aplica ya. Con cero filas en TenantTax
    // —que es lo que tiene un tenant sin sync— este check lo dejaba
    // permanentemente "no listo" por no tener sincronizados los
    // impuestos de un ERP que no ha comprado.
    expect(byId(h, "taxes-ratio").applies).toBe(false);
    expect(h.ready).toBe(true);
  });
});

describe("H1 · los dos checks que valen para cualquier empresa", () => {
  it("sin ningún módulo encendido no está lista", async () => {
    const h = await health({
      cajaEnabled: false,
      crmEnabled: false,
      agendaEnabled: false,
      holdedApiKeyCiphertext: null,
    });
    const c = byId(h, "modules-enabled");
    expect(c.applies).toBe(true);
    expect(c.ok).toBe(false);
    expect(c.value).toBe("ninguno");
    expect(h.ready).toBe(false);
  });

  it("sin razón social no está lista, y lo dice", async () => {
    const h = await health({ fiscalProfile: { taxId: "12345678Z" } });
    const c = byId(h, "fiscal-minimum");
    expect(c.ok).toBe(false);
    expect(c.value).toMatch(/razón social/i);
    expect(h.ready).toBe(false);
  });

  it("sin NIF no está lista, y lo dice", async () => {
    const h = await health({ fiscalProfile: { legalName: "Colegio SL" } });
    const c = byId(h, "fiscal-minimum");
    expect(c.ok).toBe(false);
    expect(c.value).toMatch(/NIF/);
    expect(h.ready).toBe(false);
  });

  it("acepta los alias históricos del NIF (`nif`, `fiscalNif`)", async () => {
    const h = await health({
      fiscalProfile: { businessName: "Colegio SL", nif: "12345678Z" },
    });
    expect(byId(h, "fiscal-minimum").ok).toBe(true);
  });

  it("una razón social en blanco no cuenta como razón social", async () => {
    const h = await health({
      fiscalProfile: { legalName: "   ", taxId: "12345678Z" },
    });
    expect(byId(h, "fiscal-minimum").ok).toBe(false);
  });

  it("estos dos aplican también a la empresa con caja y Holded", async () => {
    const h = await health({});
    expect(byId(h, "modules-enabled").applies).toBe(true);
    expect(byId(h, "fiscal-minimum").applies).toBe(true);
  });
});
