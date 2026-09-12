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
  holdedApiKeyCiphertext?: string | null;
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
  it("los siete checks aplican y está lista", async () => {
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
    expect(byId(h, "taxes-ratio").requires).toBe("caja");
    expect(byId(h, "products-sellable").requires).toBe("caja");
    expect(byId(h, "no-sync-failures").requires).toBe("caja");
    expect(byId(h, "test-cashier-provisioned").requires).toBe("caja");
    expect(byId(h, "modules-enabled").requires).toBe("always");
    expect(byId(h, "fiscal-minimum").requires).toBe("always");
  });

  it("la respuesta dice qué empresa es, para que la pantalla lo explique", async () => {
    const h = await health(COLEGIO);
    expect(h.modules).toEqual({ caja: false, crm: true, agenda: false });
    expect(h.usesHolded).toBe(false);
  });
});

describe("H1 · caja local: con caja y sin Holded", () => {
  it("el sync no bloquea, porque depende de Holded y no de la caja", async () => {
    const h = await health({
      cajaEnabled: true,
      holdedApiKeyCiphertext: null,
      initialSyncStatus: "NOT_APPLICABLE",
    });
    expect(byId(h, "sync-done").applies).toBe(false);
    expect(byId(h, "taxes-ratio").applies).toBe(true);
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
