// catalogo-local (addendum 3) · lo que el TPV tiene que saber del
// catálogo local, y no sabía.
//
// El bucle visual sobre la rejilla encontró que al comercio de catálogo
// local el TPV le decía, con el catálogo vacío:
//
//   "Aún no has cargado productos. Configúralos en Holded o sincroniza
//    para verlos aquí."
//
// Es mandarlo a un ERP que no ha comprado y a un sync que no va a correr
// nunca. Su catálogo se da de alta en el panel, en "Catálogo". Para poder
// acertar la frase, el TPV necesita el flag — y el flag tiene una trampa:
// su default es al REVÉS que el de sus hermanos.
//
// Lo que este banco fija:
//
//   1. Sin dato en localStorage, `holdedEnabled` es TRUE. Un TPV que aún
//      no ha refrescado el catálogo se comporta como antes del bloque.
//   2. Sólo un "0" explícito lo apaga.
//   3. `CatalogProduct.holdedProductId` admite null, que es lo que tiene
//      un producto nacido en la BD.
//
// Sabotajes que este fichero pone en rojo:
//   · invertir el default de la caché (todos los TPV de producción
//     pasarían a decir "se dan de alta desde el panel" a la vez)
//   · comparar con "1" en vez de con "0"

import { beforeEach, describe, expect, it } from "vitest";

import {
  getCachedHoldedEnabled,
  setCachedHoldedEnabled,
  type CatalogProduct,
} from "../src/lib/catalog.js";

const HOLDED_KEY = "mipiacetpv-catalog-holded-enabled";

beforeEach(() => {
  localStorage.clear();
});

describe("catalogo-local · la caché del interruptor de Holded en el TPV", () => {
  it("sin dato en localStorage, Holded está PREVISTO (true)", () => {
    // Al revés que crmEnabled/agendaEnabled, y por lo mismo que
    // cajaEnabled: la columna es @default(true). Si esto naciera en
    // false, los cinco TPV de producción le dirían al cajero que sus
    // productos se dan de alta en el panel —donde no puede crearlos,
    // porque su alta local está cerrada— hasta el primer refresh.
    expect(getCachedHoldedEnabled()).toBe(true);
  });

  it("guarda y lee el apagado", () => {
    setCachedHoldedEnabled(false);
    expect(localStorage.getItem(HOLDED_KEY)).toBe("0");
    expect(getCachedHoldedEnabled()).toBe(false);
  });

  it("guarda y lee el encendido", () => {
    setCachedHoldedEnabled(true);
    expect(localStorage.getItem(HOLDED_KEY)).toBe("1");
    expect(getCachedHoldedEnabled()).toBe(true);
  });

  it("cualquier basura en la clave NO lo apaga: sólo el '0'", () => {
    for (const basura of ["", "false", "no", "null", "undefined", "1"]) {
      localStorage.setItem(HOLDED_KEY, basura);
      expect(getCachedHoldedEnabled(), basura).toBe(true);
    }
  });

  it("no se pisa con la clave de la caja: son dos flags distintos", () => {
    setCachedHoldedEnabled(false);
    expect(localStorage.getItem("mipiacetpv-catalog-caja-enabled")).toBeNull();
  });
});

describe("catalogo-local · el producto del TPV admite no tener enlace", () => {
  it("`holdedProductId` puede ser null", () => {
    // El tipo decía `string` y el dato ya llegaba null desde que
    // `holded_product_id` pasó a nullable. No reventaba nada porque
    // `cart.ts` sí lo tenía bien tipado, pero el tipo mentía y el
    // siguiente que escribiera `p.holdedProductId!` se lo creería.
    const local: CatalogProduct = {
      id: "p1",
      holdedProductId: null,
      name: "Corte de pelo",
      sku: "LOC-CORTE",
      barcode: null,
      basePrice: 18.5,
      priceGross: 22.39,
      taxRate: 21,
      kind: "SERVICE",
      imageMime: null,
      tags: ["peluquería"],
    };
    expect(local.holdedProductId).toBeNull();
    // Y el de Holded sigue trayendo el suyo, como siempre.
    const deHolded: CatalogProduct = { ...local, holdedProductId: "h-1" };
    expect(deHolded.holdedProductId).toBe("h-1");
  });
});
