// holded-desconectar · el plan de SKU y el recálculo de "vendible". ADR-020.
//
// Este fichero es puro: no toca base, no toca red. Prueba las dos funciones
// que deciden qué le pasa a cada ficha, y lo hace con las FORMAS REALES que
// se midieron en la copia de producción del 24-09-2026 restaurada en
// `mipiacetpv_ensayo_holded`:
//
//   · Peluquería Sole — 86 fichas, 86 SKU distintos, ninguno vacío. El plan
//     no toca nada. Es el caso del comercio del bloque y sale gratis.
//   · Librería Thalía — 55 fichas en 8 grupos de SKU repetido, el mayor de
//     13, más una ficha con el SKU a NULL.
//   · Cafetería Sirope — tres grupos de dos, y los tres del CLIENTE
//     (`SKU215` en la Coca-Cola y en la Coca-Cola zero, `CAF-DES-03` y
//     `CAF-DES-04` duplicados).
//
// El hallazgo que obliga a que este fichero exista: `buildAutoSku` compone
// `AUTO-` + los OCHO primeros caracteres alfanuméricos del id de Holded, y
// un id de Holded es un ObjectId de Mongo cuyos ocho primeros hex son el
// TIMESTAMP. Todo lo que el cliente creó el mismo rato comparte SKU. Bajo el
// índice parcial de ADR-017 §3.1 —que tras el corte gobierna el catálogo
// entero— eso son trece filas peleándose por una clave única.
//
// Sabotajes que este fichero pone en rojo (tabla del done):
//   · nº 4 — dejar de bloquear un SKU duplicado del cliente
//   · nº 4 — acuñar el SKU a partir de los 8 primeros caracteres del id
//   · quitar el recálculo de `sellableViaTpv` (la ficha que gana SKU se
//     queda invisible en el TPV para siempre)
//   · poner `sellableViaTpv = true` a lo bruto (la ficha con el IVA sin
//     resolver se pondría a la venta al 0 %)

import { describe, expect, it } from "vitest";

import {
  buildSkuDelCorte,
  planificarSku,
  sellableTrasElCorte,
  SKU_PREFIJO_CORTE,
  type ProductoParaPlan,
} from "../src/holded/dejar-holded.js";

let n = 0;
function ficha(p: Partial<ProductoParaPlan> = {}): ProductoParaPlan {
  n += 1;
  return {
    id: `0000000${n}-0000-4000-8000-000000000000`.slice(-36),
    name: `Ficha ${n}`,
    kind: "PRODUCT",
    sku: `SKU-${n}`,
    source: "HOLDED",
    holdedProductId: `68d665f5aaaaaaaaaaaa${String(n).padStart(4, "0")}`,
    // Por defecto, un SKU que asignó `runAutoSku`: es el 85 de cada 86 en
    // el catálogo de Sole.
    skuAutoAssignedAt: new Date("2026-05-26T08:00:00Z"),
    taxRate: 21,
    sellableViaTpv: true,
    archivedFromHoldedAt: null,
    ...p,
  };
}

describe("holded-desconectar · el SKU acuñado en el corte", () => {
  it("usa el id de Holded COMPLETO, no sus ocho primeros caracteres", () => {
    // Los dos ids son ObjectId creados en el mismo segundo: comparten los
    // ocho primeros hex. Es exactamente el caso de las trece fichas de
    // Thalía.
    const a = "68d665f5b1c2d3e4f5a6b7c8";
    const b = "68d665f5ffffffffffffffff";
    expect(a.slice(0, 8)).toBe(b.slice(0, 8));
    expect(buildSkuDelCorte(a)).not.toBe(buildSkuDelCorte(b));
    expect(buildSkuDelCorte(a)).toBe(`${SKU_PREFIJO_CORTE}68D665F5B1C2D3E4F5A6B7C8`);
  });

  it("cabe en los 64 caracteres de la columna", () => {
    expect(buildSkuDelCorte("68d665f5b1c2d3e4f5a6b7c8").length).toBeLessThanOrEqual(64);
  });

  it("no lleva espacios, que es lo que `normalizeSku` rechaza al editarlo", () => {
    // Si el SKU acuñado no pasara la validación del panel, el propietario
    // no podría editar la ficha después: el PATCH se lo devolvería.
    expect(/\s/.test(buildSkuDelCorte("68d6 65f5-b1c2"))).toBe(false);
  });
});

describe("holded-desconectar · planificarSku", () => {
  it("el catálogo de Sole no necesita ni un cambio", () => {
    // 86 fichas con 86 SKU distintos. Medido en la copia real.
    const catalogo = Array.from({ length: 86 }, (_, i) =>
      ficha({ sku: `AUTO-6819b${String(i).padStart(3, "0")}` }),
    );
    const plan = planificarSku(catalogo);
    expect(plan.cambios).toEqual([]);
    expect(plan.choques).toEqual([]);
    expect(plan.intactos).toBe(86);
  });

  it("re-acuña un grupo de trece que comparte AUTO- (el caso de Thalía)", () => {
    const grupo = Array.from({ length: 13 }, (_, i) =>
      ficha({
        sku: "AUTO-68d665f5",
        holdedProductId: `68d665f5aaaabbbbcccc${String(i).padStart(4, "0")}`,
      }),
    );
    const plan = planificarSku(grupo);
    // Se re-acuñan LOS TRECE, no doce. Dejar a uno con el valor degenerado
    // exigiría un desempate arbitrario que nadie podría reproducir leyendo
    // el código.
    expect(plan.cambios).toHaveLength(13);
    expect(plan.choques).toEqual([]);
    expect(plan.cambios.every((c) => c.motivo === "duplicado")).toBe(true);
    // Y los trece quedan distintos entre sí, que es lo que el índice pide.
    expect(new Set(plan.cambios.map((c) => c.skuDespues)).size).toBe(13);
  });

  it("rellena el SKU vacío derivándolo del enlace con Holded", () => {
    const plan = planificarSku([
      ficha({ sku: null, name: "TALONARIO CAJA", holdedProductId: "68d66b3211112222" }),
    ]);
    expect(plan.cambios).toHaveLength(1);
    expect(plan.cambios[0]!.motivo).toBe("vacio");
    expect(plan.cambios[0]!.skuDespues).toBe(buildSkuDelCorte("68d66b3211112222"));
    expect(plan.choques).toEqual([]);
  });

  it("el string vacío cuenta como vacío, igual que el NULL", () => {
    const plan = planificarSku([ficha({ sku: "   " })]);
    expect(plan.cambios).toHaveLength(1);
    expect(plan.cambios[0]!.motivo).toBe("vacio");
  });

  it("BLOQUEA el SKU duplicado que escribió el cliente y no lo toca", () => {
    // `SKU215` en la Coca-Cola y en la Coca-Cola zero de Sirope. Es un
    // error suyo en su ERP y decidir cuál se queda no es cosa nuestra.
    const plan = planificarSku([
      ficha({ sku: "SKU215", name: "Coca cola", skuAutoAssignedAt: null }),
      ficha({ sku: "SKU215", name: "Coca cola zero", skuAutoAssignedAt: null }),
    ]);
    expect(plan.cambios).toEqual([]);
    expect(plan.choques).toHaveLength(1);
    expect(plan.choques[0]!.codigo).toBe("SKU_DUPLICADO_DEL_CLIENTE");
    expect(plan.choques[0]!.sku).toBe("SKU215");
    expect(plan.choques[0]!.productos.map((p) => p.nombre).sort()).toEqual([
      "Coca cola",
      "Coca cola zero",
    ]);
  });

  it("un grupo MIXTO (uno nuestro, uno del cliente) también bloquea", () => {
    // Si se re-acuñara sólo el nuestro el grupo quedaría resuelto, pero
    // habríamos cambiado un SKU para tapar un duplicado que el cliente
    // tiene en su ERP y que va a seguir ahí. Se le dice.
    const plan = planificarSku([
      ficha({ sku: "AUTO-68d665f5", skuAutoAssignedAt: new Date() }),
      ficha({ sku: "AUTO-68d665f5", skuAutoAssignedAt: null }),
    ]);
    expect(plan.cambios).toEqual([]);
    expect(plan.choques[0]!.codigo).toBe("SKU_DUPLICADO_DEL_CLIENTE");
  });

  it("BLOQUEA la ficha sin SKU y sin enlace: no hay de dónde derivarlo", () => {
    const plan = planificarSku([
      ficha({ sku: null, holdedProductId: null, source: "LOCAL" }),
    ]);
    expect(plan.cambios).toEqual([]);
    expect(plan.choques[0]!.codigo).toBe("SKU_VACIO_SIN_ENLACE");
  });

  it("mira TODAS las fichas, no sólo las de Holded", () => {
    // Tras el corte el índice parcial gobierna el catálogo entero, así que
    // una ficha local heredada con el mismo SKU que una de Holded también
    // choca. Es el catálogo mixto que ADR-017 §2.6 deja documentado.
    const plan = planificarSku([
      ficha({ sku: "LOC-ABC", source: "LOCAL", holdedProductId: null, skuAutoAssignedAt: null }),
      ficha({ sku: "LOC-ABC", source: "HOLDED", skuAutoAssignedAt: null }),
    ]);
    expect(plan.choques).toHaveLength(1);
    expect(plan.choques[0]!.codigo).toBe("SKU_DUPLICADO_DEL_CLIENTE");
  });

  it("avisa si el SKU acuñado chocaría con uno que ya existe", () => {
    const hid = "68d665f5b1c2d3e4f5a6b7c8";
    const plan = planificarSku([
      ficha({ sku: null, holdedProductId: hid }),
      // Un cliente con un SKU escrito a mano EXACTAMENTE con esa forma.
      // Astronómicamente improbable, y aun así mejor un mensaje que un
      // P2002 del índice que nadie sabría leer.
      ficha({ sku: buildSkuDelCorte(hid), skuAutoAssignedAt: null }),
    ]);
    expect(plan.choques.map((c) => c.codigo)).toContain("SKU_ACUNADO_CHOCA");
  });

  it("es determinista: el mismo catálogo da el mismo plan", () => {
    // Es lo que permite que la previsualización y la ejecución lo calculen
    // por separado y coincidan (criterio 7 del bloque).
    const catalogo = [
      ficha({ sku: "AUTO-68d665f5" }),
      ficha({ sku: "AUTO-68d665f5" }),
      ficha({ sku: null }),
    ];
    const a = planificarSku(catalogo);
    const b = planificarSku(catalogo);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe("holded-desconectar · sellableViaTpv tras el corte", () => {
  it("la ficha que GANA un SKU pasa a vendible", () => {
    // Thalía, `TALONARIO CAJA`: IVA 21, SKU a NULL, no vendible. Sin el
    // recálculo se quedaría invisible en el TPV para siempre, y desde el
    // panel no hay forma de arreglarlo: `sellableViaTpv` no está entre los
    // campos que acepta `PATCH /catalog/products/:id`.
    const p = { sku: null, taxRate: 21, sellableViaTpv: false, archivedFromHoldedAt: null };
    expect(sellableTrasElCorte(p, "CORTE-68D66B32")).toBe(true);
  });

  it("la ficha con el IVA SIN RESOLVER sigue sin venderse", () => {
    // La firma la deja `upsertCatalogEntry`: cuando `resolveTaxRate`
    // devuelve null escribe `taxRate = 0` y FUERZA `sellableViaTpv = false`.
    // Ponerla a la venta cobraría de menos en cada ticket y el papel no lo
    // canta. Medido: 9 fichas en la copia de prod, ninguna de Sole.
    const p = { sku: "AUTO-690394b5", taxRate: 0, sellableViaTpv: false, archivedFromHoldedAt: null };
    expect(sellableTrasElCorte(p, "AUTO-690394b5")).toBe(false);
  });

  it("un exento REAL (0 %, vendible) se queda vendible", () => {
    // Es lo que distingue el caso de arriba de un 0 % legítimo: el exento
    // real pasó el filtro del sync y quedó `sellableViaTpv = true`.
    const p = { sku: "EXENTO-1", taxRate: 0, sellableViaTpv: true, archivedFromHoldedAt: null };
    expect(sellableTrasElCorte(p, "EXENTO-1")).toBe(true);
  });

  it("los archivados de Holded SIGUEN archivados", () => {
    // Los 70 servicios y 15 productos archivados de Sirope. Una ficha que
    // se borró en el ERP no vuelve a la rejilla porque el comercio deje el
    // ERP.
    const p = {
      sku: "AUTO-1",
      taxRate: 21,
      sellableViaTpv: false,
      archivedFromHoldedAt: new Date("2026-07-01T00:00:00Z"),
    };
    expect(sellableTrasElCorte(p, "AUTO-1")).toBe(false);
  });

  it("sin SKU final no se vende, pase lo que pase", () => {
    const p = { sku: null, taxRate: 21, sellableViaTpv: true, archivedFromHoldedAt: null };
    expect(sellableTrasElCorte(p, null)).toBe(false);
  });
});
