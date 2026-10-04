// catalogo-en-alta · el precio de la carta, ida y vuelta, sin perder un
// céntimo.
//
// POR QUÉ ESTE FICHERO EXISTE, y por qué con los 128 precios REALES.
//
// `Product.basePrice` es NETO. El TPV pinta `neto · (1 + IVA)` y el
// ticket agrega netos por bucket de IVA antes de redondear una sola vez
// (`tickets/totals.ts`). Y nadie teclea netos: el dueño lee su carta, el
// fichero de implantación trae `precio_con_iva` y el formulario del
// panel dice «Precio con IVA».
//
// Medido contra la API antes de escribir este bloque: un producto creado
// con `basePrice = 1.60` e IVA 10 lo devolvía el TPV a **1,76 €**. El
// café de 1,60 € de la carta de La Maestranza, cobrado a 1,76 €, en los
// 128 productos y desde la primera venta real.
//
// Así que la conversión existe, vive en UNA función
// (`netoDesdeBruto`) y este fichero la prueba con el catálogo de verdad:
// los 128 precios de `docs/implantaciones/maestranza/catalogo-tpv.csv`,
// no una muestra inventada que redondee bonito.
//
// EL SABOTAJE, que es el único criterio que vale: si alguien hace que
// `netoDesdeBruto` devuelva su argumento —"total, el fichero ya viene
// con IVA"— los 128 casos de "lo que pinta el TPV" y los 256 de ticket
// se ponen rojos con el precio mal al lado del bueno.

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { computeTicket } from "../src/tickets/totals.js";
import { parseCatalogoCsv } from "../src/catalog/csv-catalogo.js";
import {
  brutoDesdeNeto,
  netoDesdeBruto,
  normalizePrice,
  PRICE_NET_DECIMALS,
  validateLocalProduct,
} from "../src/catalog/local-product-rules.js";

// El catálogo REAL de La Maestranza, leído del fichero que el
// implantador va a subir. No se copia aquí a mano: una copia se queda
// vieja el día que alguien corrija un precio, y entonces este test
// pasaría verificando una carta que ya no es la del bar.
const CSV = readFileSync(
  new URL("../../../docs/implantaciones/maestranza/catalogo-tpv.csv", import.meta.url),
  "utf8",
);

const round2 = (n: number): number => Math.round(n * 100) / 100;

describe("catalogo-en-alta · el precio de la carta", () => {
  const { buenas, malas } = parseCatalogoCsv(CSV);

  it("el fichero de La Maestranza entra entero: 128 productos y ninguna fila mala", () => {
    expect(malas).toEqual([]);
    expect(buenas).toHaveLength(128);
  });

  it("guarda el NETO, no el precio de la carta", () => {
    const cafe = buenas.find((f) => f.fields.sku === "CAF-001");
    expect(cafe?.precioConIva).toBe(1.6);
    // 1,60 / 1,10 = 1,454545… → 1,4545 con los cuatro decimales de la
    // columna. Si esto diera 1.6, el TPV cobraría 1,76.
    expect(cafe?.fields.basePrice).toBe(1.4545);
  });

  it("los 128: el precio que pinta el TPV es el de la carta", () => {
    const mal: string[] = [];
    for (const f of buenas) {
      // `brutoDesdeNeto` es literalmente la función que usa
      // `tpv-catalog/routes.ts` para el `priceGross` de la rejilla.
      const pintado = brutoDesdeNeto(f.fields.basePrice, f.fields.taxRate);
      if (pintado !== f.precioConIva) {
        mal.push(`${f.fields.sku}: carta ${f.precioConIva} € → TPV ${pintado} €`);
      }
    }
    expect(mal).toEqual([]);
  });

  it("los 128: un ticket de UNA unidad cobra el precio de la carta", () => {
    const mal: string[] = [];
    for (const f of buenas) {
      const t = computeTicket([
        { units: 1, unitPrice: f.fields.basePrice, discountPct: 0, taxRate: f.fields.taxRate },
      ]);
      if (t.total !== f.precioConIva) {
        mal.push(`${f.fields.sku}: carta ${f.precioConIva} € → ticket ${t.total} €`);
      }
    }
    expect(mal).toEqual([]);
  });

  it("los 128: un ticket de DIEZ unidades cobra diez veces el precio de la carta", () => {
    // Diez unidades porque es donde el céntimo de drift se ve. Con el
    // neto truncado a dos decimales, media docena de estos precios
    // fallaría aquí y no en el de una unidad.
    const mal: string[] = [];
    for (const f of buenas) {
      const t = computeTicket([
        { units: 10, unitPrice: f.fields.basePrice, discountPct: 0, taxRate: f.fields.taxRate },
      ]);
      const esperado = round2(f.precioConIva * 10);
      if (t.total !== esperado) {
        mal.push(`${f.fields.sku}: esperado ${esperado} € → ticket ${t.total} €`);
      }
    }
    expect(mal).toEqual([]);
  });

  it("una ronda entera de la carta cuadra al céntimo", () => {
    // El caso que de verdad pasa en una barra: muchas líneas de distinto
    // precio en el mismo ticket, con dos buckets de IVA si los hubiera.
    // Suma de los precios de carta vs total del ticket.
    const lineas = buenas.map((f) => ({
      units: 1,
      unitPrice: f.fields.basePrice,
      discountPct: 0,
      taxRate: f.fields.taxRate,
    }));
    const esperado = round2(buenas.reduce((acc, f) => acc + f.precioConIva, 0));
    expect(computeTicket(lineas).total).toBe(esperado);
  });

  it("cuatro decimales, que son los de la columna", () => {
    expect(PRICE_NET_DECIMALS).toBe(4);
    for (const f of buenas) {
      const decimales = String(f.fields.basePrice).split(".")[1] ?? "";
      expect(decimales.length).toBeLessThanOrEqual(4);
    }
  });

  it("el IVA del 0 % no divide por cero ni inventa un neto", () => {
    expect(netoDesdeBruto(5, 0)).toBe(5);
    expect(brutoDesdeNeto(5, 0)).toBe(5);
  });

  it("el 21 % también vuelve: no es una virtud del 10", () => {
    for (const bruto of [0.5, 1, 1.5, 2.5, 9.99, 12.4, 99.95]) {
      expect(brutoDesdeNeto(netoDesdeBruto(bruto, 21), 21)).toBe(bruto);
    }
  });
});

describe("catalogo-en-alta · de qué manera se pide el precio", () => {
  it("con IVA es lo que manda la pantalla y el fichero", () => {
    const r = normalizePrice({ priceGross: 1.6, taxRate: 10 });
    expect(r).toEqual({ ok: true, value: 1.4545 });
  });

  it("sin IVA sigue valiendo: es el contrato con el que nació la ruta", () => {
    const r = normalizePrice({ basePrice: 1.4545, taxRate: 10 });
    expect(r).toEqual({ ok: true, value: 1.4545 });
  });

  it("las dos a la vez es un error del llamante, no una preferencia", () => {
    // Si no coinciden, cualquiera de las dos elecciones cobra mal. La
    // respuesta correcta es no elegir.
    const r = normalizePrice({ basePrice: 1.4545, priceGross: 1.6, taxRate: 10 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain("una sola vez");
  });

  it("ninguna de las dos es 400, no un producto a cero", () => {
    const r = normalizePrice({ taxRate: 10 });
    expect(r.ok).toBe(false);
  });

  it("el IVA se valida ANTES del precio, porque el precio se convierte con él", () => {
    // Un IVA imposible con un precio bruto daría un neto inventado si el
    // orden fuera el otro.
    const r = validateLocalProduct({
      name: "Imposible",
      sku: "X-1",
      priceGross: 10,
      taxRate: 150,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.field).toBe("taxRate");
  });
});
