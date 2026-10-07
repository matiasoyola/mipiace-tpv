// clinica-5 · guardia de regresión sobre la migración de los tipos de
// visita.
//
// Mismo papel y misma mecánica que `clinica-sesion-migracion.test.ts`
// (clinica-3) y `iva-exento-migracion.test.ts`: la suite no levanta
// Postgres, así que aquí se fija el CONTRATO del SQL y el comportamiento
// real va en `test-e2e/clinica-sesion-por-tipos.e2e.ts`.
//
// Lo que se pone rojo si alguien lo toca:
//
//   1. La migración es ADITIVA. Los quince tenants de hoy no notan nada.
//   2. La columna `nivel_quiropodia` nace NULL y sin default. Un
//      `DEFAULT 1` convertiría todos los servicios de los quince tenants
//      en «quiropodia básica» y los haría chocar entre sí con el índice
//      único.
//   3. **Los dos CHECK y el índice único parcial.** Son las tres
//      garantías que no están en Prisma y que `prisma migrate dev` ofrece
//      borrar como deriva. Si se pierden, la pérdida sale aquí en rojo y
//      no en una implantación.
//   4. **Es UNA SOLA migración.** clinica-1, -2 y -3 necesitaron dos cada
//      una por el enum de Postgres; este bloque no añade ni un valor de
//      enum, y el test lo guarda: el día que alguien meta un `ALTER TYPE`
//      aquí, la migración abortará en producción con «unsafe use of new
//      value of enum type» y esto lo caza antes.
//   5. El tipo es TEXTO con CHECK y no un enum.

import { readFileSync, readdirSync } from "node:fs";

import { describe, expect, it } from "vitest";

const DIR = "../../../packages/db/prisma/migrations";
const NOMBRE = "20261007030000_clinica_5_tipos_de_visita";

function leer(nombre: string): { sql: string; statements: string } {
  const sql = readFileSync(
    new URL(`${DIR}/${nombre}/migration.sql`, import.meta.url),
    "utf8",
  );
  // Sólo las sentencias: los comentarios de esta migración hablan largo de
  // DROP, de enums y de echar atrás, y harían pasar los asserts por lo que
  // EXPLICAN en vez de por lo que ejecutan. Misma lección que clinica-1.
  const statements = sql
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("--"))
    .join("\n");
  return { sql, statements };
}

const m = leer(NOMBRE);

describe("clinica-5 · la migración es aditiva", () => {
  it("ni un DROP, ni un TRUNCATE, ni un DELETE", () => {
    expect(m.statements).not.toMatch(/\bDROP\s+TABLE\b/i);
    expect(m.statements).not.toMatch(/\bDROP\s+COLUMN\b/i);
    expect(m.statements).not.toMatch(/\bDROP\s+TYPE\b/i);
    expect(m.statements).not.toMatch(/\bDROP\s+INDEX\b/i);
    expect(m.statements).not.toMatch(/\bDROP\s+TRIGGER\b/i);
    expect(m.statements).not.toMatch(/\bDROP\s+CONSTRAINT\b/i);
    expect(m.statements).not.toMatch(/\bTRUNCATE\b/i);
    expect(m.statements).not.toMatch(/\bDELETE\s+FROM\b/i);
  });

  it("ni un UPDATE de datos: no hay backfill porque la columna nace NULL", () => {
    // `UPDATE … SET` y no `\bUPDATE\b`: el `ON UPDATE CASCADE` de la clave
    // ajena también lleva la palabra y no es un backfill. Un assert más
    // ancho habría estado rojo desde el primer día, que es la forma de
    // que alguien lo borre en vez de leerlo.
    expect(m.statements).not.toMatch(/\bUPDATE\s+"?\w+"?\s+SET\b/i);
  });

  it("no toca `products` ni `clinical_entries`", () => {
    // Lo que este bloque añade es configuración del centro. La historia
    // clínica ya escrita no se toca: el tipo y el nivel de cada sesión
    // viven CONGELADOS en `clinical_entries.body`.
    expect(m.statements).not.toMatch(/ALTER TABLE "products"/i);
    expect(m.statements).not.toMatch(/ALTER TABLE "clinical_entries"/i);
    expect(m.statements).not.toMatch(/"clinical_entries"/);
  });

  it("no toca un trigger ni una función de lo que ya existía", () => {
    expect(m.statements).not.toMatch(/\bCREATE\s+(OR REPLACE\s+)?TRIGGER\b/i);
    expect(m.statements).not.toMatch(/\bCREATE\s+(OR REPLACE\s+)?FUNCTION\b/i);
  });
});

describe("clinica-5 · UNA SOLA migración, sin enums", () => {
  it("no añade ni un valor de enum", () => {
    // La razón por la que clinica-1, -2 y -3 necesitaron dos migraciones
    // cada una: Postgres prohíbe USAR un valor de enum en la misma
    // transacción en la que se añade. Aquí no hay ninguno, y por eso basta
    // una. El día que alguien añada un `ALTER TYPE … ADD VALUE` junto a un
    // CHECK o un índice que lo nombre, la migración abortará en
    // producción — esto lo caza antes.
    expect(m.statements).not.toMatch(/\bALTER\s+TYPE\b/i);
    expect(m.statements).not.toMatch(/\bCREATE\s+TYPE\b/i);
  });

  it("y es la única migración de clinica-5", () => {
    const dir = new URL(`${DIR}/`, import.meta.url);
    const deEsteBloque = readdirSync(dir).filter((n) =>
      n.includes("clinica_5"),
    );
    expect(deEsteBloque).toEqual([NOMBRE]);
  });
});

describe("clinica-5 · la tabla del tipo de visita (patrón TagSection)", () => {
  it("se llama `tag_visit_types` y es del tenant", () => {
    expect(m.statements).toMatch(/CREATE TABLE "tag_visit_types"/);
    expect(m.statements).toMatch(/"tenant_id" UUID NOT NULL/);
  });

  it("una categoría, un tipo: ÚNICO por (tenant, slug)", () => {
    // Un servicio puede tener varias categorías, y de ahí sale la regla de
    // la aplicación («dos tipos distintos no se guarda»). Lo que el motor
    // garantiza es lo de abajo: que una categoría no tenga dos tipos.
    expect(m.statements).toMatch(
      /CREATE UNIQUE INDEX "tag_visit_types_tenant_id_slug_key"\s*\n?\s*ON "tag_visit_types"\("tenant_id", "slug"\)/,
    );
  });

  it("y cae con su tenant: es configuración, no historia", () => {
    expect(m.statements).toMatch(
      /"tag_visit_types_tenant_id_fkey"[\s\S]*?ON DELETE CASCADE/,
    );
  });

  it("EL CHECK con los cinco tipos, y sólo esos cinco", () => {
    const check = /ADD CONSTRAINT "tag_visit_types_tipo_valido"[\s\S]*?;/.exec(
      m.statements,
    );
    expect(check).not.toBeNull();
    const sql = check![0];
    for (const tipo of [
      "QUIROPODIA",
      "PIE_RIESGO",
      "CIRUGIA",
      "BIOMECANICA",
      "GENERAL",
    ]) {
      expect(sql).toContain(`'${tipo}'`);
    }
    // Y el CHECK está, no sólo comentado: es el único sitio que cubre las
    // cuatro puertas de escritura (panel, fichero del super-admin, sync de
    // Holded, psql de una implantación). ADR-015 §1.
    expect(sql).toMatch(/CHECK\s*\(/i);
  });

  it("el tipo es VARCHAR y no un enum de Postgres", () => {
    expect(m.statements).toMatch(/"visit_type" VARCHAR\(20\) NOT NULL/);
  });
});

describe("clinica-5 · el nivel de la quiropodia nace apagado", () => {
  it("la columna es INTEGER y NULLABLE, sin default", () => {
    expect(m.statements).toMatch(
      /ALTER TABLE "service_scheduling"\s*\n?\s*ADD COLUMN "nivel_quiropodia" INTEGER;/,
    );
  });

  it("y NO tiene DEFAULT: un default convertiría a todos en el mismo nivel", () => {
    // Con `DEFAULT 1`, los ciento y pico servicios de cada tenant serían
    // «quiropodia básica» — y chocarían entre ellos contra el índice único
    // de abajo, dejando la migración sin aplicar.
    expect(m.statements).not.toMatch(/"nivel_quiropodia"[^;]*DEFAULT/i);
    expect(m.statements).not.toMatch(/"nivel_quiropodia" INTEGER NOT NULL/);
  });

  it("vive en service_scheduling, al lado de las otras dos marcas clínicas", () => {
    // Misma forma y mismo sitio que `primera_valoracion` (clinica-2) y
    // `tratamiento_sesion` (clinica-3): la podóloga mantiene UNA pantalla.
    expect(m.statements).toMatch(/ALTER TABLE "service_scheduling"/);
  });

  it("EL CHECK de 1 a 3", () => {
    expect(m.statements).toMatch(
      /ADD CONSTRAINT "service_scheduling_nivel_quiropodia_valido"[\s\S]*?CHECK[\s\S]*?BETWEEN 1 AND 3/,
    );
  });

  it("UN SERVICIO POR NIVEL: índice ÚNICO y PARCIAL por (tenant, nivel)", () => {
    const bloque =
      /CREATE UNIQUE INDEX "service_scheduling_un_servicio_por_nivel"[\s\S]*?;/.exec(
        m.statements,
      );
    expect(bloque).not.toBeNull();
    const sql = bloque![0];
    expect(sql).toMatch(/\("tenant_id", "nivel_quiropodia"\)/);
    // PARCIAL: los NULL son la mayoría de las filas. En Postgres no
    // chocarían de todas formas, pero escrito así el índice dice lo que
    // quiere decir y no se convierte en una bomba si alguien pone un
    // default en la columna.
    expect(sql).toMatch(/WHERE "nivel_quiropodia" IS NOT NULL/);
  });
});
