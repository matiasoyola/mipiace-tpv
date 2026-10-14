// clinica-4 · guardia de regresión sobre la migración del bloque.
//
// Misma mecánica que `clinica-migracion.test.ts` (clinica-1),
// `clinica-valoracion-migracion.test.ts` (clinica-2) y
// `clinica-sesion-migracion.test.ts` (clinica-3): la suite no levanta
// Postgres, así que aquí se fija el CONTRATO del SQL y el comportamiento
// real va en `test-e2e/clinica-4.e2e.ts`.
//
// Lo que se pone rojo si alguien lo toca:
//
//   1. **`client_consents` es de solo inserción**: su trigger está, y
//      rechaza UPDATE y DELETE.
//   2. **La FK del cliente es RESTRICT**, no CASCADE. Es el cambio que no
//      es aditivo y la razón de ser de S3.
//   3. **Las fotos y las entregas cuelgan con RESTRICT** de tenant y
//      cliente: ni una CASCADE en lo clínico.
//   4. **La foto admite UNA transición** (la retirada) y no se deshace.
//   5. **La columna de consentimientos del servicio nace VACÍA.** Un
//      default con algo dentro haría que servicios de los quince tenants
//      de hoy pidieran consentimientos.
//   6. **Es UNA sola migración**, y se puede: no añade ningún valor a
//      ningún enum (lo que obligó a partir en dos a clinica-1, -2 y -3).
//   7. Y los `down` están escritos, incluido lo que no se puede deshacer.

import { readdirSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const DIR = "../../../packages/db/prisma/migrations";
const NOMBRE = "20261008010000_clinica_4_consentimientos_fotos_informe";

function leer(nombre: string): { sql: string; statements: string } {
  const sql = readFileSync(
    new URL(`${DIR}/${nombre}/migration.sql`, import.meta.url),
    "utf8",
  );
  // Sólo las sentencias: los comentarios de esta migración hablan largo de
  // DROP, de CASCADE y de borrar historia, y harían pasar los asserts por
  // lo que EXPLICAN en vez de por lo que ejecutan. Es la lección que
  // clinica-1 dejó escrita sobre los asertos de texto: hay que contar lo
  // que corre, no buscar en lo que se lee.
  const statements = sql
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("--"))
    .join("\n");
  return { sql, statements };
}

const m = leer(NOMBRE);

describe("clinica-4 · es UNA sola migración, y por el motivo bueno", () => {
  it("el bloque trae exactamente una", () => {
    const mias = readdirSync(
      new URL(DIR, import.meta.url),
    ).filter((n) => n.includes("clinica_4"));
    expect(mias).toEqual([NOMBRE]);
  });

  it("y se puede porque NO añade ningún valor a ningún enum", () => {
    // Postgres prohíbe USAR un valor de enum en la misma transacción en
    // que se añade, y eso partió en dos las migraciones de clinica-1, -2
    // y -3. Aquí las listas cerradas son VARCHAR con CHECK, que es la
    // decisión de `iva_exento_sanitario` y de clinica-5.
    expect(m.statements).not.toMatch(/\bALTER\s+TYPE\b/i);
    expect(m.statements).not.toMatch(/\bADD\s+VALUE\b/i);
    expect(m.statements).not.toMatch(/\bCREATE\s+TYPE\b/i);
  });

  it("las listas cerradas van con CHECK, y los tres informes están", () => {
    expect(m.statements).toMatch(
      /CHECK \("report" IN \('RESUMEN', 'SESIONES', 'DERIVACION', 'COMPLETA'\)\)/,
    );
    expect(m.statements).toMatch(/CHECK \("channel" IN \('PRINT', 'EMAIL'\)\)/);
    expect(m.statements).toMatch(
      /CHECK \("recipient" IN \('PACIENTE', 'PROFESIONAL'\)\)/,
    );
  });
});

describe("clinica-4 · no borra ni reescribe datos", () => {
  it("ni un TRUNCATE, ni un DELETE, ni un UPDATE de filas", () => {
    expect(m.statements).not.toMatch(/\bTRUNCATE\b/i);
    expect(m.statements).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(m.statements).not.toMatch(/\bUPDATE\s+"/i);
  });

  it("ni un DROP TABLE, ni un DROP COLUMN", () => {
    expect(m.statements).not.toMatch(/\bDROP\s+TABLE\b/i);
    expect(m.statements).not.toMatch(/\bDROP\s+COLUMN\b/i);
  });

  it("el ÚNICO DROP es la FK del cliente, que se recrea en RESTRICT", () => {
    // Lo que no es aditivo del bloque, y está aquí para que se vea: la
    // constraint se tira y se vuelve a poner con otro `ON DELETE`. No se
    // toca ninguna fila.
    const drops = [...m.statements.matchAll(/\bDROP\s+CONSTRAINT\s+"([^"]+)"/gi)]
      .map((x) => x[1]);
    expect(drops).toEqual(["client_consents_client_id_fkey"]);
  });
});

describe("clinica-4 · un consentimiento firmado no se borra ni se edita", () => {
  it("la FK del cliente pasa a RESTRICT (S3, condición 1)", () => {
    expect(m.statements).toMatch(
      /ADD CONSTRAINT "client_consents_client_id_fkey"\s*\n?\s*FOREIGN KEY \("client_id"\) REFERENCES "clients"\("id"\)\s*\n?\s*ON DELETE RESTRICT/,
    );
  });

  it("y NO queda ninguna CASCADE en el borrado de lo clínico", () => {
    // Un test de clinica-1 ya cuenta que ninguna FK clínica es CASCADE;
    // aquí se vigila lo que ESTA migración escribe.
    const cascadas = [
      ...m.statements.matchAll(/ON DELETE CASCADE/gi),
    ];
    expect(cascadas).toEqual([]);
  });

  it("la tabla es de SOLO INSERCIÓN, con su trigger", () => {
    expect(m.statements).toMatch(
      /CREATE FUNCTION mipiacetpv_client_consents_append_only\(\)/,
    );
    expect(m.statements).toMatch(
      /CREATE TRIGGER "client_consents_append_only"\s*\n?\s*BEFORE UPDATE OR DELETE ON "client_consents"/,
    );
  });

  it("y el mensaje del trigger dice qué hacer en vez de qué falló", () => {
    expect(m.sql).toMatch(/HISTORIA_VIOLADA: un consentimiento firmado no se borra/);
    expect(m.sql).toMatch(/HISTORIA_VIOLADA: un consentimiento firmado no se edita/);
    expect(m.sql).toMatch(/se firma una revocación/);
  });

  it("la revocación es una fila nueva ENLAZADA, y no a sí misma", () => {
    expect(m.statements).toMatch(
      /ADD CONSTRAINT "client_consents_revokes_consent_id_fkey"/,
    );
    expect(m.statements).toMatch(
      /CHECK \("revokes_consent_id" IS NULL OR "revokes_consent_id" <> "id"\)/,
    );
  });

  it("la plantilla va COMPLETA o no va: id, versión y huella del texto", () => {
    expect(m.statements).toMatch(/client_consents_plantilla_completa/);
    expect(m.statements).toMatch(/"text_sha256" IS NULL/);
    expect(m.statements).toMatch(/"text_sha256" IS NOT NULL/);
  });

  it("y una plantilla clínica exige informante", () => {
    expect(m.statements).toMatch(
      /CHECK \("clinical" = false OR "informer_user_id" IS NOT NULL\)/,
    );
  });

  it("el firmante: o el paciente, o un representante CON relación", () => {
    expect(m.statements).toMatch(/client_consents_firmante_valido/);
    expect(m.statements).toMatch(
      /"signer" = 'REPRESENTANTE' AND "signer_name" IS NOT NULL AND "signer_relation" IS NOT NULL/,
    );
  });

  it("las columnas nuevas nacen NULL: lo de antes es «alta manual»", () => {
    // S3, lado agenda, punto 4: a las filas que ya existen no se les
    // inventa versión ni huella. Un DEFAULT aquí sería inventárselo.
    for (const col of [
      "template_id",
      "template_version",
      "text_sha256",
      "pdf_sha256",
      "signer",
      "informer_user_id",
    ]) {
      const re = new RegExp(`ADD COLUMN "${col}"[^,;]*`, "i");
      const linea = re.exec(m.statements)?.[0] ?? "";
      expect(linea, col).not.toMatch(/DEFAULT/i);
      expect(linea, col).not.toMatch(/NOT NULL/i);
    }
  });

  it("y `clinical` nace en false, no en true", () => {
    expect(m.statements).toMatch(
      /ADD COLUMN "clinical"\s+BOOLEAN NOT NULL DEFAULT false/,
    );
  });
});

describe("clinica-4 · una foto no se borra: se retira", () => {
  it("la tabla cuelga con RESTRICT de tenant, cliente y autor", () => {
    for (const fk of [
      "clinical_photos_tenant_id_fkey",
      "clinical_photos_client_id_fkey",
      "clinical_photos_author_user_id_fkey",
    ]) {
      const re = new RegExp(
        `ADD CONSTRAINT "${fk}"[\\s\\S]{0,200}?ON DELETE RESTRICT`,
      );
      expect(m.statements, fk).toMatch(re);
    }
  });

  it("y de la cita con SET NULL: la foto sobrevive a su cita", () => {
    expect(m.statements).toMatch(
      /ADD CONSTRAINT "clinical_photos_appointment_id_fkey"[\s\S]{0,200}?ON DELETE SET NULL/,
    );
  });

  it("el guard deja pasar la retirada y NADA más", () => {
    expect(m.statements).toMatch(
      /CREATE FUNCTION mipiacetpv_clinical_photos_guard\(\)/,
    );
    // Las columnas que el guard vigila: si alguien quita una de la lista,
    // esa columna se podría reescribir sin que nada lo cante.
    for (const col of [
      "zona",
      "mapa_version",
      "file_name",
      "sha256",
      "bytes",
      "mime_type",
      "author_user_id",
      "created_at",
    ]) {
      expect(m.statements, col).toMatch(
        new RegExp(`NEW\\.${col}\\s+IS DISTINCT FROM OLD\\.${col}`),
      );
    }
  });

  it("y la retirada NO se deshace", () => {
    expect(m.statements).toMatch(
      /OLD\.withdrawn_at IS NOT NULL[\s\S]{0,300}?RAISE EXCEPTION/,
    );
    expect(m.sql).toMatch(/ya está retirada y la retirada no se deshace/);
  });

  it("retirada completa o nada: fecha, autor y motivo", () => {
    expect(m.statements).toMatch(/clinical_photos_retirada_completa/);
    expect(m.statements).toMatch(/"withdraw_reason" IS NOT NULL/);
  });

  it("el comparador tiene su índice, y es PARCIAL por «no retirada»", () => {
    expect(m.statements).toMatch(
      /CREATE INDEX "clinical_photos_zona_idx"[\s\S]{0,200}?WHERE "withdrawn_at" IS NULL/,
    );
  });

  it("un fichero, una fila", () => {
    expect(m.statements).toMatch(
      /CREATE UNIQUE INDEX "clinical_photos_file_name_key"/,
    );
  });
});

describe("clinica-4 · la entrega del informe queda apuntada", () => {
  it("tabla de solo inserción, con su trigger", () => {
    expect(m.statements).toMatch(
      /CREATE TRIGGER "clinical_report_deliveries_append_only"\s*\n?\s*BEFORE UPDATE OR DELETE ON "clinical_report_deliveries"/,
    );
  });

  it("por email hace falta la dirección; en papel, no la hay", () => {
    expect(m.statements).toMatch(
      /\("channel" = 'EMAIL' AND "recipient_email" IS NOT NULL\)/,
    );
    expect(m.statements).toMatch(
      /\("channel" = 'PRINT' AND "recipient_email" IS NULL\)/,
    );
  });

  it("guarda la huella del PDF entregado, y es NOT NULL", () => {
    expect(m.statements).toMatch(/"pdf_sha256"\s+CHAR\(64\)\s+NOT NULL/);
  });

  it("y NO guarda nada de salud: ni cuerpo, ni motivo, ni PDF", () => {
    // La tabla contesta «qué se entregó a quién», no «qué decía». Si
    // alguien le añadiera el motivo de la derivación, este test lo canta.
    const tabla =
      /CREATE TABLE "clinical_report_deliveries" \(([\s\S]*?)\);/.exec(
        m.statements,
      )?.[1] ?? "";
    expect(tabla).not.toMatch(/motivo|motive|reason|body|cuerpo|pdf_bytes/i);
  });
});

describe("clinica-4 · el servicio nace sin pedir consentimientos", () => {
  it("la columna es un array y nace VACÍO", () => {
    expect(m.statements).toMatch(
      /ADD COLUMN "consentimientos" VARCHAR\(40\)\[\] NOT NULL DEFAULT '\{\}'/,
    );
  });

  it("vive en service_scheduling, no en products", () => {
    // Esto es agenda, no catálogo de Holded (ADR-R1), y va al lado de
    // `primera_valoracion`, `tratamiento_sesion` y `nivel_quiropodia`: la
    // podóloga mantiene UNA pantalla.
    expect(m.statements).toMatch(
      /ALTER TABLE "service_scheduling"\s*\n?\s*ADD COLUMN "consentimientos"/,
    );
    expect(m.statements).not.toMatch(/ALTER TABLE "products"/i);
  });

  it("con su tope, para el psql de una implantación", () => {
    expect(m.statements).toMatch(/service_scheduling_consentimientos_tope/);
  });
});

describe("clinica-4 · el `down` está pensado", () => {
  it("y nombra los tres triggers, las dos tablas y las columnas", () => {
    expect(m.sql).toMatch(/DROP TRIGGER "client_consents_append_only"/);
    expect(m.sql).toMatch(/DROP TRIGGER "clinical_photos_guard"/);
    expect(m.sql).toMatch(
      /DROP TRIGGER "clinical_report_deliveries_append_only"/,
    );
    expect(m.sql).toMatch(/DROP TABLE "clinical_photos"/);
    expect(m.sql).toMatch(/DROP TABLE "clinical_report_deliveries"/);
  });

  it("y dice que volver a CASCADE es PERDER la garantía", () => {
    // Un `down` de esta migración no es una operación de rutina: deshacer
    // el RESTRICT es dejar que un borrado de cliente se lleve un
    // consentimiento firmado.
    // El texto del `down` va partido en dos renglones de comentario, así
    // que se normalizan los espacios antes de buscarlo: un aserto sobre
    // texto tiene que contar lo que dice, no depender de dónde corta la
    // línea.
    const comentarioSeguido = m.sql.replace(/--/g, " ").replace(/\s+/g, " ");
    expect(comentarioSeguido).toContain("que es perder la garantía");
  });
});
