// enlaces-publicos · guardia de regresión sobre la migración de la tabla
// común de enlaces.
//
// Mismo papel y misma mecánica que `clinica-valoracion-migracion.test.ts`:
// la suite no levanta Postgres, así que aquí se fija el CONTRATO del SQL y
// el comportamiento real va en `test-e2e/enlaces-publicos.e2e.ts`.
//
// Lo que se pone rojo si alguien lo toca:
//
//   1. La migración es ADITIVA: ni un DROP, ni un TRUNCATE, ni un DELETE,
//      ni un UPDATE. Lo único que escribe datos es el backfill, y es un
//      INSERT … SELECT.
//   2. **LA COLUMNA NO ADMITE UN TOKEN EN CLARO**: el CHECK sólo acepta 64
//      hex. Es la garantía número uno del bloque.
//   3. Los usos no pasan del tope, por CHECK.
//   4. La huella es ÚNICA: resolver un token no puede ser ambiguo.
//   5. Un solo enlace vivo por (`purpose`, objetivo), por índice PARCIAL.
//      Sin el `WHERE`, «reenviar revoca el anterior» deja de ser una
//      invariante.
//   6. La caducidad es NOT NULL: un token sin caducidad no caduca.
//   7. La guarda: no se borra, no se des-revoca, los usos no bajan, la
//      caducidad no se alarga.
//   8. El backfill de clinica-2 mapea las cinco cosas que tiene que
//      mapear, y es idempotente.
//   9. Las FKs son RESTRICT: ninguna es CASCADE.
//  10. El `down` está escrito.

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const DIR = "../../../packages/db/prisma/migrations";

function leer(nombre: string): { sql: string; statements: string } {
  const sql = readFileSync(
    new URL(`${DIR}/${nombre}/migration.sql`, import.meta.url),
    "utf8",
  );
  // Sólo las sentencias: los comentarios de esta migración hablan largo de
  // borrar, de DROP y de columnas obsoletas, y harían pasar los asserts por
  // lo que EXPLICAN en vez de por lo que ejecutan.
  const statements = sql
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("--"))
    .join("\n");
  return { sql, statements };
}

const m = leer("20261008000000_enlaces_publicos");

describe("enlaces-publicos · la migración es aditiva", () => {
  it("ni un DROP, ni un TRUNCATE, ni un DELETE", () => {
    expect(m.statements).not.toMatch(/\bDROP\s+TABLE\b/i);
    expect(m.statements).not.toMatch(/\bDROP\s+COLUMN\b/i);
    expect(m.statements).not.toMatch(/\bDROP\s+TYPE\b/i);
    expect(m.statements).not.toMatch(/\bTRUNCATE\b/i);
    expect(m.statements).not.toMatch(/\bDELETE\s+FROM\b/i);
  });

  it("y NO toca las columnas viejas de clinica-2: se quedan donde están", () => {
    // La decisión del bloque: las tres columnas `link_*` de
    // `clinical_assessments` se dejan de LEER y se marcan obsoletas, pero
    // no se borran aquí. Borrarlas en la misma migración que las sustituye
    // deja la vuelta atrás sin red.
    expect(m.statements).not.toMatch(/ALTER TABLE "?clinical_assessments"?/i);
    expect(m.statements).not.toMatch(/link_token_hash"?\s+(?:DROP|TYPE)/i);
  });

  it("lo único que escribe datos es el backfill, y es un INSERT … SELECT", () => {
    expect(m.statements).not.toMatch(/\bUPDATE\s+\w+\s+SET\b/i);
    const inserts = m.statements.match(/\bINSERT\s+INTO\b/gi) ?? [];
    expect(inserts).toHaveLength(1);
    expect(m.statements).toMatch(/INSERT INTO "public_links"[\s\S]*?SELECT/);
  });
});

describe("enlaces-publicos · LA COLUMNA NO ADMITE UN TOKEN EN CLARO", () => {
  it("el CHECK exige 64 hex, que es un SHA-256", () => {
    expect(m.statements).toMatch(
      /CONSTRAINT "public_links_token_hash_es_sha256"\s*\n?\s*CHECK \("token_hash" ~ '\^\[0-9a-f\]\{64\}\$'\)/,
    );
  });

  it("y un token en claro NO PASA ese patrón", () => {
    // El token son 32 bytes en base64url: 43 caracteres, con `-` y `_` y
    // con mayúsculas. El assert lo comprueba con el patrón REAL leído de
    // la migración, no con una copia a mano — si alguien lo afloja a
    // `[A-Za-z0-9_-]+`, esto se pone rojo.
    const patron = m.statements.match(
      /"token_hash" ~ '(\^\[0-9a-f\]\{64\}\$)'/,
    )?.[1];
    expect(patron).toBeDefined();
    const re = new RegExp(patron!);
    expect(re.test("a".repeat(64))).toBe(true);
    expect(re.test("0123456789abcdef".repeat(4))).toBe(true);
    // Un base64url de 43: ni la longitud ni el alfabeto.
    expect(re.test("dGhpcy1pcy1hLXRva2VuLWluLWNsZWFyLTQzLWNoYXJz")).toBe(false);
    expect(re.test("A".repeat(64))).toBe(false); // hex en minúsculas
  });

  it("y la columna NO se llama `token`: el nombre también lo dice", () => {
    expect(m.statements).toMatch(/"token_hash"\s+TEXT NOT NULL/);
    expect(m.statements).not.toMatch(/"token"\s+TEXT/);
  });
});

describe("enlaces-publicos · los usos y la caducidad", () => {
  it("los usos no pasan del tope, por CHECK", () => {
    expect(m.statements).toMatch(
      /CONSTRAINT "public_links_usos_dentro_del_tope"\s*\n?\s*CHECK \("used_count" >= 0 AND "used_count" <= "max_uses"\)/,
    );
  });

  it("y un enlace que no se puede usar ni una vez no cabe", () => {
    expect(m.statements).toMatch(
      /CONSTRAINT "public_links_max_uses_positivo"\s*\n?\s*CHECK \("max_uses" >= 1\)/,
    );
  });

  it("un token SIN CADUCIDAD no cabe: la columna es NOT NULL", () => {
    // clinica-2 lo tenía como CHECK porque la columna era opcional. Aquí
    // es NOT NULL, que es la misma garantía sin la mitad opcional.
    expect(m.statements).toMatch(/"expires_at" TIMESTAMPTZ NOT NULL/);
  });

  it("los usos nacen a cero", () => {
    expect(m.statements).toMatch(/"used_count" INTEGER NOT NULL DEFAULT 0/);
  });
});

describe("enlaces-publicos · los índices", () => {
  it("la huella es ÚNICA: resolver un token no puede ser ambiguo", () => {
    expect(m.statements).toMatch(
      /CREATE UNIQUE INDEX "public_links_token_hash_key"\s*\n?\s*ON "public_links"\("token_hash"\)/,
    );
  });

  it("UN SOLO ENLACE VIVO por (purpose, objetivo), y el índice es PARCIAL", () => {
    expect(m.statements).toMatch(
      /CREATE UNIQUE INDEX "public_links_uno_vivo_key"\s*\n?\s*ON "public_links"\("purpose", "target_id"\)\s*\n?\s*WHERE "revoked_at" IS NULL AND "used_count" < "max_uses"/,
    );
  });

  it("y sin el WHERE, un enlace gastado bloquearía el siguiente para siempre", () => {
    // Si alguien quita el `WHERE`, la valoración de un paciente no podría
    // tener nunca un segundo enlace — y «reenviar» deja de existir. Este
    // assert existe para que quitarlo se vea.
    const linea = m.statements.match(
      /CREATE UNIQUE INDEX "public_links_uno_vivo_key"[\s\S]*?;/,
    )?.[0];
    expect(linea).toBeDefined();
    expect(linea).toMatch(/WHERE/);
    expect(linea).toMatch(/"revoked_at" IS NULL/);
    expect(linea).toMatch(/"used_count" < "max_uses"/);
  });
});

describe("enlaces-publicos · nada de esto se va con una cascada", () => {
  it("NINGUNA FK es CASCADE", () => {
    const fks = m.statements.match(/FOREIGN KEY[^,]*?ON DELETE \w+/gs) ?? [];
    expect(fks.length).toBeGreaterThanOrEqual(2);
    expect(fks.filter((f) => /ON DELETE CASCADE/.test(f))).toEqual([]);
  });

  it("el tenant y quien lo creó son RESTRICT", () => {
    expect(m.statements).toMatch(
      /"public_links_tenant_id_fkey"[\s\S]{0,160}ON DELETE RESTRICT/,
    );
    expect(m.statements).toMatch(
      /"public_links_created_by_user_id_fkey"[\s\S]{0,160}ON DELETE RESTRICT/,
    );
  });

  it("y el objetivo NO tiene FK: es polimórfico a propósito", () => {
    // Los objetivos son de tablas distintas (una valoración, una cita, un
    // consentimiento). Que el objetivo exista lo comprueba la puerta, y si
    // no está contesta la misma 404.
    expect(m.statements).not.toMatch(/FOREIGN KEY \("target_id"\)/);
    expect(m.statements).toMatch(/"target_id"\s+UUID NOT NULL/);
  });
});

describe("enlaces-publicos · la guarda", () => {
  it("existe y cuelga de public_links, en UPDATE y DELETE", () => {
    expect(m.statements).toMatch(
      /CREATE TRIGGER "public_links_guard"\s*\n?\s*BEFORE UPDATE OR DELETE ON "public_links"/,
    );
    expect(m.statements).toMatch(/mipiacetpv_public_link_guard/);
  });

  it.each([
    ["no se borra", /TG_OP = 'DELETE'/],
    ["no se des-revoca", /OLD\.revoked_at IS NOT NULL\s*\n?\s*AND NEW\.revoked_at IS DISTINCT FROM OLD\.revoked_at/],
    ["los usos no bajan", /NEW\.used_count < OLD\.used_count/],
    ["ni pasan del tope", /NEW\.used_count > OLD\.max_uses/],
    ["un anulado no se gasta", /OLD\.revoked_at IS NOT NULL AND NEW\.used_count > OLD\.used_count/],
  ])("%s", (_n, patron) => {
    expect(m.statements).toMatch(patron);
  });

  it("LA CADUCIDAD NO SE ALARGA: `expires_at` va en la identidad", () => {
    // Es la regla menos obvia y la que más vale: si `expires_at` se pudiera
    // mover, revivir un enlace caducado sería un UPDATE, y la caducidad
    // dejaría de significar nada.
    const identidad = m.statements.match(
      /IF NEW\.id\s+IS DISTINCT FROM OLD\.id[\s\S]*?THEN/,
    )?.[0];
    expect(identidad).toBeDefined();
    for (const col of [
      "NEW.tenant_id",
      "NEW.purpose",
      "NEW.target_type",
      "NEW.target_id",
      "NEW.token_hash",
      "NEW.max_uses",
      "NEW.expires_at",
      "NEW.created_by_user_id",
      "NEW.created_at",
    ]) {
      expect(identidad).toContain(col);
    }
  });

  it("y los mensajes llevan el prefijo que el error-handler reconoce", () => {
    const raises = m.statements.match(/RAISE EXCEPTION\s*\n?\s*'[^']+'/g) ?? [];
    expect(raises.length).toBeGreaterThanOrEqual(6);
    for (const r of raises) expect(r).toContain("ENLACE_VIOLADO");
  });

  it("y todos levantan 23514, que es lo que el handler mira", () => {
    const errcodes = m.statements.match(/USING ERRCODE = '(\d+)'/g) ?? [];
    expect(errcodes.length).toBeGreaterThanOrEqual(6);
    for (const e of errcodes) expect(e).toContain("23514");
  });
});

describe("enlaces-publicos · el backfill de clinica-2", () => {
  const backfill = m.statements.match(
    /INSERT INTO "public_links"[\s\S]*?;$/m,
  )?.[0];

  it("sale de clinical_assessments y sólo de las que tienen huella", () => {
    expect(backfill).toBeDefined();
    expect(backfill).toMatch(/FROM "clinical_assessments" a/);
    expect(backfill).toMatch(/WHERE a\."link_token_hash" IS NOT NULL/);
  });

  it("apunta a la VALORACIÓN, no a la cita", () => {
    // Precisión de clínica en el S1: mover o anular la cita no toca el
    // enlace de la valoración. Si el `target_id` fuera `appointment_id`,
    // borrar la cita dejaría el enlace apuntando a la nada.
    expect(backfill).toMatch(/'CLINICAL_ASSESSMENT'/);
    expect(backfill).toMatch(/a\."id",/);
    expect(backfill).not.toMatch(/a\."appointment_id"/);
  });

  it("conserva LA MISMA huella: los enlaces que están en un buzón siguen abriendo", () => {
    expect(backfill).toMatch(/a\."link_token_hash",/);
    expect(backfill).toMatch(/a\."link_expires_at",/);
  });

  it("un enlace YA GASTADO sigue gastado", () => {
    expect(backfill).toMatch(
      /CASE WHEN a\."link_used_at" IS NOT NULL THEN 1 ELSE 0 END/,
    );
  });

  it("y `max_uses` es 1: el de la valoración es de un solo uso", () => {
    expect(backfill).toMatch(/'CLINICAL_ASSESSMENT',\s*\n\s*a\."id",\s*\n\s*a\."link_token_hash",\s*\n\s*a\."link_expires_at",\s*\n\s*1,/);
  });

  it("es idempotente: se puede volver a correr sobre una base migrada", () => {
    expect(backfill).toMatch(/ON CONFLICT \("token_hash"\) DO NOTHING/);
  });
});

describe("enlaces-publicos · el down está escrito", () => {
  it("dice cómo se echa atrás, y que no se pierde nada", () => {
    expect(m.sql).toMatch(/El `down`, pensado/);
    expect(m.sql).toMatch(/DROP TABLE "public_links"/);
  });
});
