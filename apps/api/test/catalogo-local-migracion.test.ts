// catalogo-local · guardia de regresión sobre la migración del bloque.
//
// Mismo papel que `h1-migracion-caja.test.ts`: la suite no levanta
// Postgres, así que aquí se fija el CONTRATO del SQL. Lo que esta
// migración no puede dejar de hacer nunca:
//
//   1. Ser aditiva. Ni un DROP de columna, ni un rewrite de `products`.
//   2. Backfillar a HOLDED. Si el DEFAULT se cambiara a 'LOCAL' —o
//      desapareciera— las fichas de Sole, Thalía, Cachitos y La
//      Maestranza dejarían de ser de Holded el día del despliegue: el
//      sync no las pisaría, la conciliación no las archivaría y el
//      upload a Holded se negaría a subir sus tickets.
//   3. Relajar el NOT NULL de `holded_product_id`, que es lo que hace
//      posible un producto sin enlace.
//   4. Crear el índice único PARCIAL del SKU local. Éste es el que más
//      falta hace aquí: Prisma NO lo puede declarar en el schema, así
//      que `migrate dev` lo verá como deriva y ofrecerá borrarlo. Este
//      test es lo único que se pone rojo si alguien acepta.
//   5. (addendum 3) Añadir `tenants.holded_enabled` NOT NULL DEFAULT
//      true. Con DEFAULT false, las cinco empresas vivas dejarían de
//      subir a Holded el día del despliegue y nadie se enteraría hasta
//      el cierre: el TPV seguiría cobrando y los tickets nacerían PAID.
//      Es el fallo más caro que esta migración puede cometer.

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const MIGRATION = new URL(
  "../../../packages/db/prisma/migrations/20260913000000_catalogo_local/migration.sql",
  import.meta.url,
);

describe("migración catalogo_local", () => {
  const sql = readFileSync(MIGRATION, "utf8");
  // Sólo las sentencias: los comentarios hablan de DROP, de rewrites y de
  // LOCAL, y harían pasar (o fallar) los asserts por lo que explican en
  // vez de por lo que ejecutan.
  const statements = sql
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("--"))
    .join("\n");

  it("crea el enum ProductSource con sus dos valores", () => {
    expect(statements).toMatch(
      /CREATE TYPE "ProductSource" AS ENUM \('HOLDED', 'LOCAL'\);/,
    );
  });

  it("añade products.source NOT NULL con DEFAULT 'HOLDED' (el backfill es el default)", () => {
    expect(statements).toMatch(
      /ALTER TABLE "products"\s*\n?\s*ADD COLUMN "source" "ProductSource" NOT NULL DEFAULT 'HOLDED';/,
    );
  });

  it("NO nace nada como LOCAL: nada de DEFAULT 'LOCAL'", () => {
    expect(statements).not.toMatch(/DEFAULT\s+'LOCAL'/i);
  });

  it("añade tenants.holded_enabled NOT NULL con DEFAULT true", () => {
    expect(statements).toMatch(
      /ALTER TABLE "tenants"\s*\n?\s*ADD COLUMN "holded_enabled" BOOLEAN NOT NULL DEFAULT true;/,
    );
  });

  it("el interruptor NO nace apagado: nada de DEFAULT false", () => {
    // Mismo criterio que `caja_enabled` en H1. Un `false` aquí apagaría
    // Holded en Sole, Cachitos, Thalía y La Maestranza a la vez.
    expect(statements).not.toMatch(/"holded_enabled"[^;]*DEFAULT\s+false/i);
  });

  it("relaja el NOT NULL de holded_product_id", () => {
    expect(statements).toMatch(
      /ALTER TABLE "products"\s*\n?\s*ALTER COLUMN "holded_product_id" DROP NOT NULL;/,
    );
  });

  it("crea el índice único PARCIAL del SKU local, con su WHERE", () => {
    expect(statements).toMatch(
      /CREATE UNIQUE INDEX "products_tenant_id_sku_local_key"\s*\n?\s*ON "products" \("tenant_id", "sku"\)\s*\n?\s*WHERE "source" = 'LOCAL';/,
    );
  });

  it("el índice del SKU es PARCIAL, no global: un unique sin WHERE rompería el sync de Holded", () => {
    // Los SKU que llegan de Holded llegan como llegan, duplicados
    // incluidos. Una constraint global haría que el sync reventara al
    // traerlos. Ver el comentario de la migración.
    const createIndex = statements.slice(statements.indexOf("CREATE UNIQUE INDEX"));
    expect(createIndex).toMatch(/WHERE "source" = 'LOCAL'/);
  });

  it("es aditiva: ni un DROP TABLE, ni un DROP COLUMN, ni un DROP TYPE", () => {
    expect(statements).not.toMatch(/DROP\s+TABLE/i);
    expect(statements).not.toMatch(/DROP\s+COLUMN/i);
    expect(statements).not.toMatch(/DROP\s+TYPE/i);
  });

  it("no toca la clave del sync: el unique de (tenant, holded_product_id) sigue en pie", () => {
    // En Postgres los NULL son distintos entre sí dentro de un índice
    // único, así que N productos locales conviven bajo esa constraint
    // sin rediseñarla. Que la migración NO la mencione es la prueba.
    expect(statements).not.toMatch(/products_tenant_id_holded_product_id_key/);
  });

  it("no reescribe products: sin UPDATE masivo de backfill", () => {
    // El backfill ES el DEFAULT (PG ≥ 11 lo sirve desde el catálogo sin
    // tocar las filas). Un UPDATE aquí significaría un rewrite con la
    // caja parada.
    expect(statements).not.toMatch(/UPDATE\s+"?products"?/i);
  });

  it("el CREATE TYPE va antes del ADD COLUMN que lo usa", () => {
    expect(statements.indexOf("CREATE TYPE")).toBeLessThan(
      statements.indexOf("ADD COLUMN"),
    );
  });

  it("deja escrito lo que se midió sobre el bloqueo, no una suposición", () => {
    // El prompt pedía verificar que la migración no toma bloqueo largo y
    // DECIRLO. Si alguien reescribe la cabecera y se lleva los números,
    // esto avisa.
    expect(sql).toMatch(/MEDIDO, no supuesto/);
    expect(sql).toMatch(/attmissingval/);
  });
});

// ── El contrato del schema ────────────────────────────────────────────
//
// Dos hallazgos del inventario del bloque (addendum 2). Los dos son
// invariantes de los que el bloque DEPENDE, y ninguno de los dos es
// obvio leyendo el código que los usa — de ahí que estén aquí y no
// dados por supuestos.

const SCHEMA = new URL("../../../packages/db/prisma/schema.prisma", import.meta.url);

describe("catalogo-local · lo que el schema tiene que seguir cumpliendo", () => {
  const schema = readFileSync(SCHEMA, "utf8");

  function modelBody(name: string): string {
    const start = schema.indexOf(`model ${name} {`);
    expect(start).toBeGreaterThan(-1);
    return schema.slice(start, schema.indexOf("\n}", start));
  }

  it("TicketLine.holdedProductId ES nullable, y lo era desde antes del bloque", () => {
    // Hallazgo 1. Es lo que hace que cobrar un producto local quepa sin
    // un segundo cambio de esquema: la línea del ticket guarda un
    // SNAPSHOT del enlace, y ese campo ya admitía NULL desde las líneas
    // libres `TPV-OTROS-*`. Si alguien lo pusiera NOT NULL, el cobro de
    // un producto local dejaría de funcionar.
    expect(modelBody("TicketLine")).toMatch(/holdedProductId\s+String\?\s+@map\("holded_product_id"\)/);
  });

  it("Product.taxRate es un decimal plano, NO una relación con TenantTax", () => {
    // Hallazgo 2. Es lo que hace posible el alta local sin tocar nada
    // más: `TenantTax` sólo lo puebla el sync de Holded y el comercio de
    // este bloque lo tiene vacío. Si alguien convirtiera este campo en
    // una FK, el bloque entero se rompe — no habría tipo de IVA que
    // elegir.
    const body = modelBody("Product");
    expect(body).toMatch(/taxRate\s+Decimal\s+@map\("tax_rate"\) @db\.Decimal\(5, 2\)/);
    expect(body).not.toMatch(/taxRate\s+TenantTax/);
    expect(body).not.toMatch(/tenantTax\s+TenantTax/);
  });

  it("Product.holdedProductId pasa a nullable y Product.source existe con default HOLDED", () => {
    const body = modelBody("Product");
    expect(body).toMatch(/holdedProductId\s+String\?\s+@map\("holded_product_id"\)/);
    expect(body).toMatch(/source\s+ProductSource @default\(HOLDED\)/);
  });

  it("el schema DOCUMENTA el índice parcial que Prisma no sabe declarar", () => {
    // Prisma 5 no tiene sintaxis para un `WHERE` en un índice único, así
    // que vive sólo en el SQL. Que el schema lo explique es lo único que
    // evita que alguien acepte el "borrar índice" que `migrate dev` va a
    // ofrecer.
    const body = modelBody("Product");
    expect(body).toMatch(/products_tenant_id_sku_local_key/);
    // Y avisa de la deriva, que es el motivo de documentarlo.
    expect(body).toMatch(/migrate dev/);
    expect(body).toMatch(/deriva/);
  });
});
