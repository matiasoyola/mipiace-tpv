// iva-exento-sanitario · guardia de regresión sobre la migración.
//
// Mismo papel y misma mecánica que `clinica-sesion-migracion.test.ts` y
// `catalogo-local-migracion.test.ts`: la suite no levanta Postgres, así
// que aquí se fija el CONTRATO del SQL y el comportamiento real del motor
// va en `test-e2e/iva-exento-sanitario.e2e.ts`.
//
// Lo que se pone rojo si alguien lo toca:
//
//   1. La migración es ADITIVA. Los quince tenants de hoy no notan nada, y
//      en este bloque importa el doble porque lo que se toca es
//      `ticket_lines`, la tabla más grande y la que guarda lo cobrado.
//   2. **Las dos columnas nacen NULL y SIN DEFAULT.** Un `DEFAULT 'E1'`
//      declararía exenta cada operación de cada tenant.
//   3. **Los CUATRO CHECK.** Son la mitad de este bloque: «exento ⇒ sin
//      IVA» no es un `if` del handler, es una constraint.
//   4. El CHECK de la lista lleva los SEIS códigos de L10 y no sólo el E1
//      que la UI ofrece. Con `IN ('E1')`, la segunda causa sería otra
//      migración — que es lo que el enunciado pedía evitar.
//   5. No se crea ninguna tabla, ni un enum, ni un índice.

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.REDIS_URL = "redis://localhost:6379";

import { readFileSync } from "node:fs";

import { CAUSAS_EXENCION } from "@mipiacetpv/ticket-model";
import { describe, expect, it } from "vitest";

const DIR = "../../../packages/db/prisma/migrations";
const NOMBRE = "20261007020000_iva_exento_sanitario";

const sql = readFileSync(
  new URL(`${DIR}/${NOMBRE}/migration.sql`, import.meta.url),
  "utf8",
);
// Sólo las sentencias: los comentarios de esta migración hablan largo de
// DROP, de enums y de echar atrás, y harían pasar los asserts por lo que
// EXPLICAN en vez de por lo que ejecutan. Es la lección que clinica-1 dejó
// escrita sobre los asertos de texto.
const statements = sql
  .split("\n")
  .filter((l) => !l.trimStart().startsWith("--"))
  .join("\n");

describe("iva-exento-sanitario · la migración es aditiva", () => {
  it("ni un DROP, ni un TRUNCATE, ni un DELETE", () => {
    expect(statements).not.toMatch(/\bDROP\s+TABLE\b/i);
    expect(statements).not.toMatch(/\bDROP\s+COLUMN\b/i);
    expect(statements).not.toMatch(/\bDROP\s+TYPE\b/i);
    expect(statements).not.toMatch(/\bDROP\s+INDEX\b/i);
    expect(statements).not.toMatch(/\bDROP\s+CONSTRAINT\b/i);
    expect(statements).not.toMatch(/\bTRUNCATE\b/i);
    expect(statements).not.toMatch(/\bDELETE\s+FROM\b/i);
  });

  it("y ningún UPDATE: no hay backfill porque «sin causa» ES el NULL", () => {
    // Un UPDATE aquí sería un bloqueo largo sobre `ticket_lines` en
    // producción, y para escribir el valor que la columna ya tiene.
    expect(statements).not.toMatch(/\bUPDATE\b/i);
  });

  it("no crea ninguna tabla, ni un enum, ni un índice", () => {
    expect(statements).not.toMatch(/\bCREATE\s+TABLE\b/i);
    expect(statements).not.toMatch(/\bCREATE\s+TYPE\b/i);
    expect(statements).not.toMatch(/\bALTER\s+TYPE\b/i);
    expect(statements).not.toMatch(/\bCREATE\s+(UNIQUE\s+)?INDEX\b/i);
  });

  it("ni toca un trigger ni una FK de lo que ya existía", () => {
    expect(statements).not.toMatch(/\bCREATE\s+(OR REPLACE\s+)?TRIGGER\b/i);
    expect(statements).not.toMatch(/\bCREATE\s+(OR REPLACE\s+)?FUNCTION\b/i);
    expect(statements).not.toMatch(/\bFOREIGN\s+KEY\b/i);
    expect(statements).not.toMatch(/\bALTER\s+CONSTRAINT\b/i);
  });

  it("toca EXACTAMENTE dos tablas: products y ticket_lines", () => {
    const tablas = [
      ...statements.matchAll(/ALTER TABLE "([a-z_]+)"/g),
    ].map((m) => m[1]!);
    expect([...new Set(tablas)].sort()).toEqual(["products", "ticket_lines"]);
  });
});

describe("iva-exento-sanitario · las dos columnas nacen vacías", () => {
  it.each([["products"], ["ticket_lines"]])(
    "%s.exemption_cause es TEXT y NULLABLE",
    (tabla) => {
      expect(statements).toMatch(
        new RegExp(
          `ALTER TABLE "${tabla}"\\s*\\n?\\s*ADD COLUMN "exemption_cause" TEXT;`,
        ),
      );
    },
  );

  it("y NINGUNA lleva DEFAULT: un default declararía exenta alguna operación", () => {
    // La diferencia con las columnas de clinica-2 y clinica-3, que nacían
    // con `NOT NULL DEFAULT false`: aquí «sin causa» no es un valor que
    // haya que escribir, es la ausencia de valor. Un `DEFAULT 'E1'` sería
    // la peor migración de la historia de este repo.
    expect(statements).not.toMatch(/"exemption_cause"[^;]*DEFAULT/i);
  });

  it("y ninguna es NOT NULL: la mayoría de los productos NO son exentos", () => {
    expect(statements).not.toMatch(/"exemption_cause" TEXT NOT NULL/i);
  });
});

describe("iva-exento-sanitario · EXENTO ⇒ SIN IVA, por constraint", () => {
  it.each([
    ["products", "products_exencion_sin_iva"],
    ["ticket_lines", "ticket_lines_exencion_sin_iva"],
  ])("%s tiene el CHECK %s", (_tabla, nombre) => {
    const bloque = new RegExp(
      `ADD CONSTRAINT "${nombre}"\\s*\\n?\\s*CHECK \\("exemption_cause" IS NULL OR "tax_rate" = 0\\);`,
    );
    expect(statements).toMatch(bloque);
  });

  it("el CHECK está escrito en los DOS sentidos sin querer serlo", () => {
    // `causa IS NULL OR tax_rate = 0` prohíbe la pareja (causa, IVA≠0),
    // así que también rechaza el UPDATE que sube el IVA de un producto ya
    // marcado — que es el camino por el que esto se rompería de verdad.
    // Un `exemption_cause IS NOT NULL AND tax_rate = 0` habría exigido
    // causa a TODO producto al 0 %, y un 0 % sujeto es otra cosa.
    expect(statements).not.toMatch(/"exemption_cause" IS NOT NULL AND/);
  });
});

describe("iva-exento-sanitario · la lista L10, entera", () => {
  it.each([
    ["products", "products_exencion_en_l10"],
    ["ticket_lines", "ticket_lines_exencion_en_l10"],
  ])("%s valida el código contra la lista (%s)", (_tabla, nombre) => {
    const m = new RegExp(
      `ADD CONSTRAINT "${nombre}"[\\s\\S]*?;`,
    ).exec(statements);
    expect(m).not.toBeNull();
    expect(m![0]).toMatch(/"exemption_cause" IS NULL/);
    for (const codigo of CAUSAS_EXENCION) {
      expect(m![0], codigo).toContain(`'${codigo}'`);
    }
  });

  it("y están los SEIS, no sólo el E1 que la pantalla ofrece", () => {
    // Ésta es la razón de que la columna sea texto validado y no un enum:
    // con los seis en el CHECK, admitir una causa nueva de la lista es
    // desplegar y no migrar. Con `IN ('E1')` sería otra migración, y en
    // Postgres un enum además no se corrige: `ALTER TYPE … DROP VALUE` no
    // existe.
    expect(statements).not.toMatch(/IN \('E1'\)/);
    expect(CAUSAS_EXENCION).toHaveLength(6);
  });

  it("y los CHECK de las dos tablas son LITERALMENTE el mismo", () => {
    // El snapshot de la línea no puede admitir un código que el producto
    // no admite, ni al revés: es la misma lista de la AEAT.
    const lista = (nombre: string) => {
      const m = new RegExp(`ADD CONSTRAINT "${nombre}"[\\s\\S]*?;`).exec(
        statements,
      )!;
      return m[0].replace(nombre, "").replace(/\s+/g, " ");
    };
    expect(lista("products_exencion_en_l10")).toBe(
      lista("ticket_lines_exencion_en_l10"),
    );
  });
});

describe("iva-exento-sanitario · el `down` está escrito", () => {
  it("la cabecera lo dice, y dice que es reversible", () => {
    // En el SQL ENTERO, comentarios incluidos: lo que se comprueba aquí es
    // justamente que la explicación esté escrita.
    expect(sql).toMatch(/El `down`/);
    expect(sql).toMatch(/Reversible por completo/);
  });

  it("y avisa de que las facturas ya emitidas no vuelven atrás", () => {
    expect(sql).toMatch(/append-only/);
  });
});
