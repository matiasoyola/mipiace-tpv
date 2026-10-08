// kds-1-cocina · EL CONTRATO DEL SQL DE LA MIGRACIÓN.
//
// Mismo guardia que `catalogo-local-migracion.test.ts` y
// `iva-exento-migracion.test.ts`, y por la misma razón: hay invariantes de
// este bloque que **sólo existen en el SQL**, porque Prisma no sabe
// declararlas. Si alguien acepta el «¿borrar índice?» de
// `prisma migrate dev`, el esquema sigue pareciendo correcto y la
// invariante se va sin que nada se ponga rojo.
//
// Lo que este fichero guarda:
//
//   · el índice parcial `ticket_allergies_mesa_key`, que es lo que impide
//     dos filas «toda la mesa · GLUTEN» (en Postgres los NULL son
//     distintos entre sí, así que el `@@unique` de Prisma no lo cubre);
//   · el CHECK `ticket_lines_sent_units_range`, que es la invariante
//     central del bloque escrita en el motor;
//   · el CHECK `devices_kitchen_sections` y su hermano de los códigos de
//     emparejamiento;
//   · el CHECK `stores_kitchen_semaforo` (verde < ámbar);
//   · que los TIPOS van en una migración APARTE, porque Postgres prohíbe
//     usar un valor de enum en la misma transacción en la que se añade.
//
// Y una cosa que NO se puede guardar desde aquí y está dicha en el `-done`:
// que el CHECK se cumpla de verdad. Eso es `test-e2e/kds-1-cocina.e2e.ts`
// contra Postgres.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);
const DIR = path.join(REPO_ROOT, "packages/db/prisma/migrations");
const TIPOS = readFileSync(
  path.join(DIR, "20261008010000_kds_1_tipos/migration.sql"),
  "utf8",
);
const COCINA = readFileSync(
  path.join(DIR, "20261008020000_kds_1_cocina/migration.sql"),
  "utf8",
);
const SCHEMA = readFileSync(
  path.join(REPO_ROOT, "packages/db/prisma/schema.prisma"),
  "utf8",
);

/** El SQL sin comentarios: los `--` también contienen estas palabras. */
function sinComentarios(sql: string): string {
  return sql
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("--"))
    .join("\n");
}

const TIPOS_SQL = sinComentarios(TIPOS);
const COCINA_SQL = sinComentarios(COCINA);

describe("kds-1 · los tipos van en una migración aparte", () => {
  it("`ALTER TYPE DeviceKind ADD VALUE 'KITCHEN'` está en la migración de TIPOS", () => {
    expect(TIPOS_SQL).toMatch(
      /ALTER TYPE "DeviceKind" ADD VALUE 'KITCHEN'/,
    );
  });

  it("y NO en la migración que lo USA, que es lo que Postgres prohíbe", () => {
    expect(COCINA_SQL).not.toMatch(/ADD VALUE 'KITCHEN'/);
    // Pero sí lo usa dentro de un CHECK, que es por lo que hay dos.
    expect(COCINA_SQL).toMatch(/'KITCHEN'/);
  });

  it("los tres tipos nuevos se crean en la de TIPOS", () => {
    for (const tipo of ["Allergen", "KitchenCourseMode", "KitchenSeatMode"]) {
      expect(TIPOS_SQL).toMatch(new RegExp(`CREATE TYPE "${tipo}" AS ENUM`));
    }
  });

  it("los 14 alérgenos del anexo II, ni uno más ni uno menos", () => {
    const bloque = TIPOS_SQL.match(/CREATE TYPE "Allergen" AS ENUM \(([\s\S]*?)\);/);
    expect(bloque).toBeTruthy();
    const valores = [...bloque![1]!.matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]!);
    expect(valores).toHaveLength(14);
    // El orden es el del anexo II, que es el de la rejilla del TPV.
    expect(valores[0]).toBe("GLUTEN");
    expect(valores[13]).toBe("MOLUSCOS");
  });
});

describe("kds-1 · EL ÍNDICE QUE PRISMA NO PUEDE DECLARAR", () => {
  it("`ticket_allergies_mesa_key` es PARCIAL sobre `seat IS NULL`", () => {
    // Sin él, dos filas «toda la mesa · GLUTEN» conviven (los NULL son
    // distintos entre sí en Postgres) y la franja roja se pinta dos veces.
    expect(COCINA_SQL).toMatch(
      /CREATE UNIQUE INDEX "ticket_allergies_mesa_key"\s*\n?\s*ON "ticket_allergies"\("ticket_id", "allergen"\)\s*\n?\s*WHERE "seat" IS NULL;/,
    );
  });

  it("y el schema.prisma AVISA de que ese índice existe y no se puede borrar", () => {
    // La nota es parte del contrato: es lo que lee quien se encuentre el
    // «¿borrar índice?» de `prisma migrate dev`.
    const modelo = SCHEMA.match(/model TicketAllergy \{([\s\S]*?)\n\}/);
    expect(modelo).toBeTruthy();
    expect(modelo![1]).toMatch(/ticket_allergies_mesa_key/);
  });
});

describe("kds-1 · LA INVARIANTE CENTRAL, en el motor", () => {
  it("`ticket_lines_sent_units_range`: 0 ≤ sent_units ≤ units", () => {
    expect(COCINA_SQL).toMatch(
      /CONSTRAINT "ticket_lines_sent_units_range"\s*\n?\s*CHECK \("sent_units" >= 0 AND "sent_units" <= "units"\)/,
    );
  });

  it("`kitchen_order_lines_voided_range`: no se anula más de lo que se mandó", () => {
    expect(COCINA_SQL).toMatch(
      /CONSTRAINT "kitchen_order_lines_voided_range"\s*\n?\s*CHECK \("voided_units" >= 0 AND "voided_units" <= "units"\)/,
    );
  });

  it("`kitchen_orders_cronologia`: no se sirve lo que no está listo", () => {
    expect(COCINA_SQL).toMatch(/CONSTRAINT "kitchen_orders_cronologia"/);
    expect(COCINA_SQL).toMatch(/"served_at" IS NULL OR "ready_at" IS NOT NULL/);
  });
});

describe("kds-1 · la pantalla tiene secciones y el terminal no", () => {
  it("`devices_kitchen_sections` obliga a las dos mitades", () => {
    expect(COCINA_SQL).toMatch(/CONSTRAINT "devices_kitchen_sections"/);
    expect(COCINA_SQL).toMatch(
      /"kind" = 'KITCHEN' AND array_length\("kitchen_sections", 1\) >= 1/,
    );
    expect(COCINA_SQL).toMatch(
      /"kind" <> 'KITCHEN' AND "kitchen_sections" = '\{\}'/,
    );
  });

  it("y el código de emparejamiento lleva el mismo CHECK", () => {
    expect(COCINA_SQL).toMatch(/CONSTRAINT "pairing_codes_kitchen_sections"/);
  });
});

describe("kds-1 · el semáforo tiene que ser un semáforo", () => {
  it("`stores_kitchen_semaforo`: verde > 0 y ámbar > verde", () => {
    expect(COCINA_SQL).toMatch(/CONSTRAINT "stores_kitchen_semaforo"/);
    expect(COCINA_SQL).toMatch(/"kitchen_green_max_min" > 0/);
    expect(COCINA_SQL).toMatch(
      /"kitchen_amber_max_min" > "kitchen_green_max_min"/,
    );
  });

  it("y los defaults son los de la decisión 3: 10 y 20", () => {
    expect(COCINA_SQL).toMatch(/"kitchen_green_max_min" INTEGER NOT NULL DEFAULT 10/);
    expect(COCINA_SQL).toMatch(/"kitchen_amber_max_min" INTEGER NOT NULL DEFAULT 20/);
  });
});

describe("kds-1 · la migración es ADITIVA", () => {
  it("ni un DROP, ni un DELETE, ni un TRUNCATE, ni un UPDATE masivo", () => {
    for (const prohibido of [
      /\bDROP TABLE\b/i,
      /\bDROP COLUMN\b/i,
      /\bTRUNCATE\b/i,
      /\bDELETE FROM\b/i,
      /^\s*UPDATE /im,
    ]) {
      expect(COCINA_SQL).not.toMatch(prohibido);
      expect(TIPOS_SQL).not.toMatch(prohibido);
    }
  });

  it("el módulo nace APAGADO: ningún tenant de hoy cambia de comportamiento", () => {
    expect(COCINA_SQL).toMatch(
      /"kitchen_display_enabled" BOOLEAN NOT NULL DEFAULT false/,
    );
  });

  it("`sent_units` nace en 0, y la consecuencia está ESCRITA en la migración", () => {
    expect(COCINA_SQL).toMatch(
      /"sent_units" DECIMAL\(10,3\) NOT NULL DEFAULT 0/,
    );
    // El párrafo que lo dice en voz alta no es decorativo: es la única
    // forma de que quien despliegue sepa que la primera comanda de una
    // mesa abierta se repite.
    expect(COCINA).toMatch(/EL BACKFILL DE `sent_units`/);
  });

  it("`allergens` nace vacío, que significa «no informado»", () => {
    expect(COCINA_SQL).toMatch(/"allergens" "Allergen"\[\] NOT NULL DEFAULT '\{\}'/);
  });
});

describe("kds-1 · la alergia NO sale del ticket", () => {
  it("`ticket_allergies` cuelga del TICKET con CASCADE", () => {
    expect(COCINA_SQL).toMatch(
      /CONSTRAINT "ticket_allergies_ticket_id_fkey"\s*\n?\s*FOREIGN KEY \("ticket_id"\) REFERENCES "tickets"\("id"\) ON DELETE CASCADE/,
    );
  });

  it("SABOTAJE · y NO hay ninguna clave hacia `clients`", () => {
    // La invariante de privacidad de la decisión 3, escrita como la
    // ausencia de una clave ajena. El bloque de la tabla se aísla para que
    // una FK de otra tabla a `clients` no haga pasar el test.
    const bloque = COCINA_SQL.match(
      /CREATE TABLE "ticket_allergies" \(([\s\S]*?)\n\);/,
    );
    expect(bloque).toBeTruthy();
    expect(bloque![1]).not.toMatch(/clients/);
    // Y en el esquema, el modelo tampoco tiene relación con Client.
    const modelo = SCHEMA.match(/model TicketAllergy \{([\s\S]*?)\n\}/);
    expect(modelo![1]).not.toMatch(/Client/);
  });
});
