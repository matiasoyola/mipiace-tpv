// catalogo-servicios-csv · el catálogo de una clínica son SERVICIOS, y la
// salud del onboarding tiene que contarlos.
//
// Lo encontró el e2e de este bloque al recorrer el alta de la clínica de
// Rosario, y es el mismo tipo de bloqueo que catalogo-en-alta encontró en
// el §0 del checklist de La Maestranza: con los 17 servicios ya cargados y
// el TPV enseñándolos, la activación seguía contestando
//
//     400 {"error":"ONBOARDING_NOT_READY",
//          "failing":["≥50% de productos sellable"]}
//
// porque `products-sellable` contaba SÓLO `kind = PRODUCT`. Una clínica
// cuyo catálogo entero son servicios tenía `0/0` y el check en rojo por
// definición: **no se podía activar nunca**. Y en DRAFT no hay OWNER, así
// que tampoco había forma de añadirle un producto desde el panel.
//
// Lo que este banco fija, con sus sabotajes:
//
//   1. **Un catálogo de SÓLO servicios pasa el check.** Sabotaje: volver a
//      `productsTotal` a secas.
//   2. **Un catálogo vacío de verdad sigue sin pasar.** Sabotaje: contar
//      «sin productos» como verde.
//   3. **Un tenant que YA pasaba el check cuenta exactamente igual.**
//      Sabotaje: sumar productos y servicios en vez de usar el fallback —
//      cambiaría el porcentaje de los quince tenants de hoy, que tienen
//      las dos cosas, y podría poner en rojo a alguien que está en verde.
//      Es lo último que puede hacer un check de salud.

import { describe, expect, it } from "vitest";

import { computeOnboardingHealth } from "../src/superadmin/onboarding-health.js";

const TENANT_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

interface Catalogo {
  productsTotal: number;
  productsSellable: number;
  servicesTotal: number;
  servicesSellable: number;
}

// Prisma falso mínimo: sólo lo que `computeOnboardingHealth` toca. La
// empresa es la del bloque —caja sí, Holded no—, así que los checks de
// Holded no aplican y lo único que puede bloquear es el catálogo.
function prismaFor(c: Catalogo): any {
  const productCounts = [
    c.productsTotal,
    c.productsSellable,
    c.productsTotal, // con SKU: los mismos, no es lo que se mide aquí
    c.servicesTotal,
    c.servicesSellable,
  ];
  let productCall = 0;
  return {
    tenant: {
      findUniqueOrThrow: async () => ({
        initialSyncStatus: "NOT_APPLICABLE",
        initialSyncCompletedAt: null,
        initialSyncStartedAt: null,
        initialSyncStats: null,
        cajaEnabled: true,
        crmEnabled: true,
        agendaEnabled: true,
        holdedEnabled: false,
        holdedApiKeyCiphertext: null,
        fiscalProfile: {
          legalName: "Clínica de Podología Rosario SL",
          taxId: "B90000001",
        },
      }),
    },
    tenantTax: { count: async () => 0 },
    product: { count: async () => productCounts[productCall++]! },
    contact: { count: async () => 0 },
    ticket: { count: async () => 0, findFirst: async () => null },
    user: { findFirst: async () => ({ id: "u-test" }) },
    $queryRaw: async () => [{ n: 0 }],
  };
}

async function check(c: Catalogo) {
  const h = await computeOnboardingHealth(prismaFor(c) as never, TENANT_ID);
  return {
    salud: h,
    sellable: h.readinessChecks.find((x) => x.id === "products-sellable")!,
  };
}

describe("catalogo-servicios-csv · la salud de una clínica sin productos", () => {
  it("un catálogo de SÓLO servicios pasa products-sellable", async () => {
    // El caso de Rosario: 17 servicios, cero productos.
    const { salud, sellable } = await check({
      productsTotal: 0,
      productsSellable: 0,
      servicesTotal: 17,
      servicesSellable: 17,
    });
    expect(sellable).toMatchObject({ applies: true, ok: true, value: "17/17 (100%)" });
    // Y con eso la clínica se puede activar.
    expect(salud.ready).toBe(true);
  });

  it("y el umbral sigue siendo el mismo de duro con servicios: 49% no pasa", async () => {
    const { sellable } = await check({
      productsTotal: 0,
      productsSellable: 0,
      servicesTotal: 100,
      servicesSellable: 49,
    });
    expect(sellable.ok).toBe(false);
    expect(sellable.value).toBe("49/100 (49%)");
  });

  it("un catálogo VACÍO de verdad sigue sin pasar", async () => {
    // Ni productos ni servicios: es el bloqueo legítimo que
    // catalogo-en-alta existe para romper, y no se toca.
    const { salud, sellable } = await check({
      productsTotal: 0,
      productsSellable: 0,
      servicesTotal: 0,
      servicesSellable: 0,
    });
    // El `0/0 (100%)` del porcentaje es de antes de este bloque —`pct`
    // devuelve 100 cuando el denominador es cero— y no se toca: lo que
    // decide es `ok`, y con cero total está en rojo explícitamente.
    expect(sellable).toMatchObject({ ok: false, value: "0/0 (100%)" });
    expect(salud.ready).toBe(false);
  });
});

describe("catalogo-servicios-csv · los tenants de hoy cuentan igual que ayer", () => {
  it("con productos, el valor es el de los PRODUCTOS y los servicios no entran", async () => {
    // LA garantía de no romper nada: una peluquería con 20 productos y 8
    // servicios, de los cuales sólo 2 son sellable. Si se sumaran, serían
    // 22/28 (79%) en vez de 20/20 (100%) — sigue pasando, pero el número
    // que la pantalla enseña cambiaría para los quince tenants de hoy.
    const { sellable } = await check({
      productsTotal: 20,
      productsSellable: 20,
      servicesTotal: 8,
      servicesSellable: 2,
    });
    expect(sellable.value).toBe("20/20 (100%)");
    expect(sellable.ok).toBe(true);
  });

  it("y un tenant que lo fallaba por sus productos lo sigue fallando", async () => {
    // 10 de 30 productos sellable es 33%: rojo. Que tenga 50 servicios
    // impecables no lo arregla — el fallback sólo entra cuando NO hay
    // productos, y aquí hay treinta.
    const { sellable } = await check({
      productsTotal: 30,
      productsSellable: 10,
      servicesTotal: 50,
      servicesSellable: 50,
    });
    expect(sellable.value).toBe("10/30 (33%)");
    expect(sellable.ok).toBe(false);
  });

  it("un solo producto manda sobre cien servicios: el fallback no se cuela", async () => {
    // El borde exacto del `productsTotal > 0`. Un producto no sellable es
    // 0/1 (0%): rojo, como antes del bloque.
    const { sellable } = await check({
      productsTotal: 1,
      productsSellable: 0,
      servicesTotal: 100,
      servicesSellable: 100,
    });
    expect(sellable.value).toBe("0/1 (0%)");
    expect(sellable.ok).toBe(false);
  });
});
