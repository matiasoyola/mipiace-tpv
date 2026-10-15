// residencia-3 · EL CONTRATO DEL SQL, leído del fichero.
//
// Lo que esto guarda no es «que la migración corra» —eso lo prueba el e2e,
// que la aplica— sino **lo que la migración PROMETE**, y que no se le
// escape nada el día que alguien la toque:
//
//   · que es ADITIVA (ni un `DROP`, ni un `DELETE`, ni un `TRUNCATE`);
//   · que `IMAGE` va en SU PROPIA migración, porque Postgres prohíbe usar
//     un valor de enum en la transacción en la que se añade;
//   · que el trigger de inmutabilidad compara **las veintidós columnas**,
//     una por una y por su nombre — es la comprobación que se pone roja el
//     día que la tabla gane una columna y nadie la añada al trigger;
//   · que el índice de la ocurrencia lleva sus DOS `COALESCE`, que es la
//     cuarta vez que esta lección se paga en el repo;
//   · y que las FKs que sostienen la evidencia son `RESTRICT`.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const RAIZ = join(
  import.meta.dirname,
  "..",
  "..",
  "..",
  "packages",
  "db",
  "prisma",
  "migrations",
);

const TIPOS = readFileSync(
  join(RAIZ, "20261015020000_residencia_3_tipos", "migration.sql"),
  "utf8",
);
const REGISTRO = readFileSync(
  join(RAIZ, "20261015030000_residencia_3_registro", "migration.sql"),
  "utf8",
);

/** El SQL sin comentarios: el `down` va comentado en la cabecera y lleva
 *  `DROP TABLE` dentro. Mirar el fichero entero haría que el test de
 *  «aditiva» se pusiera rojo por la documentación. */
function soloSql(texto: string): string {
  return texto
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("--"))
    .join("\n");
}

const SQL_TIPOS = soloSql(TIPOS);
const SQL_REGISTRO = soloSql(REGISTRO);

describe("las dos migraciones son ADITIVAS", () => {
  it("ni un DROP, ni un DELETE, ni un TRUNCATE, ni un UPDATE suelto", () => {
    for (const [nombre, sql] of [
      ["tipos", SQL_TIPOS],
      ["registro", SQL_REGISTRO],
    ] as const) {
      expect(sql, nombre).not.toMatch(/\bDROP\s+TABLE\b/i);
      expect(sql, nombre).not.toMatch(/\bDROP\s+COLUMN\b/i);
      expect(sql, nombre).not.toMatch(/\bTRUNCATE\b/i);
      expect(sql, nombre).not.toMatch(/\bDELETE\s+FROM\b/i);
    }
    // El único `UPDATE` admisible es ninguno: la función del trigger no
    // escribe, sólo lanza.
    expect(SQL_REGISTRO).not.toMatch(/\bUPDATE\s+"?[a-z_]+"?\s+SET\b/i);
  });

  it("y sólo tocan `resident_profiles` y `client_consents` de lo que ya existía", () => {
    const tablas = [...SQL_REGISTRO.matchAll(/ALTER TABLE "([a-z_]+)"/g)].map(
      (m) => m[1],
    );
    expect([...new Set(tablas)].sort()).toEqual([
      "care_pins",
      "care_records",
      "client_consents",
      "resident_profiles",
    ]);
  });
});

describe("el valor del enum va SOLO, en su propia migración", () => {
  it("`ADD VALUE` está en la primera y en la segunda no", () => {
    // Postgres prohíbe USAR un valor de enum en la misma transacción en la
    // que se añade, y Prisma corre cada migración en una. `IMAGE` hace
    // falta escrito dentro del CHECK de la segunda.
    expect(SQL_TIPOS).toContain(`ALTER TYPE "ClientConsentKind" ADD VALUE 'IMAGE'`);
    expect(SQL_REGISTRO).not.toMatch(/ADD\s+VALUE/i);
  });

  it("y la segunda USA el literal, que es por lo que la primera existe", () => {
    expect(SQL_REGISTRO).toContain(`"kind" <> 'IMAGE'`);
  });

  it("la primera NO crea tablas: es un `ALTER TYPE` y nada más", () => {
    expect(SQL_TIPOS).not.toMatch(/CREATE\s+TABLE/i);
    expect(SQL_TIPOS.match(/^\s*ALTER TYPE/gm)).toHaveLength(1);
  });
});

describe("el trigger de inmutabilidad compara TODAS las columnas", () => {
  /** Las columnas de `care_records`, leídas del propio `CREATE TABLE`. */
  const columnas = [
    ...SQL_REGISTRO.slice(
      SQL_REGISTRO.indexOf('CREATE TABLE "care_records"'),
      SQL_REGISTRO.indexOf('CONSTRAINT "care_records_pkey"'),
    ).matchAll(/^\s{4}"([a-z_0-9]+)"\s+[A-Z]/gm),
  ].map((m) => m[1]!);

  it("la tabla tiene las veinticuatro que se esperan", () => {
    expect(columnas).toEqual([
      "id",
      "tenant_id",
      "client_id",
      "control_type_id",
      "control_code",
      "plan_item_id",
      "occurrence_at",
      "value_cifrado",
      "note_cifrado",
      "voice_file_name",
      "voice_sha256",
      "voice_bytes",
      "voice_mime_type",
      "recorded_by_user_id",
      "care_role_assignment_id",
      "device_id",
      "recorded_at",
      "received_at",
      "center_shift_id",
      "care_day",
      "corrects_record_id",
      "voided_at",
      "voided_by_user_id",
      "created_at",
    ]);
  });

  it("y el trigger NOMBRA TODAS menos las dos de la anulación", () => {
    // Es el test que importa de este fichero. Un
    // `row(NEW.*) IS DISTINCT FROM row(OLD.*)` habría sido más corto y
    // habría dejado pasar en silencio cualquier columna añadida después;
    // con esto, el día que la tabla gane una, esto se pone rojo y recuerda
    // por qué.
    const funcion = SQL_REGISTRO.slice(
      SQL_REGISTRO.indexOf("CREATE FUNCTION mipiacetpv_care_records_inmutable"),
      SQL_REGISTRO.indexOf('CREATE TRIGGER "care_records_inmutable"'),
    );
    const faltan = columnas.filter(
      (c) =>
        c !== "voided_at" &&
        c !== "voided_by_user_id" &&
        !funcion.includes(`NEW.${c} `) &&
        !funcion.includes(`NEW.${c}\n`),
    );
    expect(faltan).toEqual([]);
    // Y las dos de la anulación NO se comparan, porque son la transición
    // legítima.
    expect(funcion).not.toContain("NEW.voided_at             IS DISTINCT");
  });

  it("corta el DELETE y el UPDATE, y nada más", () => {
    expect(SQL_REGISTRO).toContain(
      'BEFORE UPDATE OR DELETE ON "care_records"',
    );
    // No `BEFORE INSERT`: una fila nueva tiene que poder entrar.
    expect(SQL_REGISTRO).not.toMatch(
      /BEFORE[^\n]*INSERT[^\n]*ON "care_records"/,
    );
  });

  it("y sus mensajes dicen QUÉ HACER, no sólo que no", () => {
    expect(SQL_REGISTRO).toContain("Se anula, con autor y hora");
    expect(SQL_REGISTRO).toContain("se escribe OTRA fila que apunta a ésta");
    expect(SQL_REGISTRO).toContain("se registra otra vez");
  });
});

describe("el índice de la ocurrencia y sus dos COALESCE", () => {
  it("es PARCIAL sobre lo que NO es una corrección", () => {
    // Total, corregir sería imposible. Sin índice, «cuál es el valor de
    // ahora» lo decidiría el orden de la base.
    const indice = SQL_REGISTRO.slice(
      SQL_REGISTRO.indexOf('CREATE UNIQUE INDEX "care_records_una_por_ocurrencia_key"'),
    ).split(";")[0]!;
    expect(indice).toContain('WHERE "corrects_record_id" IS NULL');
  });

  it("y lleva LOS DOS centinelas: en Postgres los NULL son distintos entre sí", () => {
    const indice = SQL_REGISTRO.slice(
      SQL_REGISTRO.indexOf('CREATE UNIQUE INDEX "care_records_una_por_ocurrencia_key"'),
    ).split(";")[0]!;
    expect(indice).toContain('COALESCE("center_shift_id"');
    expect(indice).toContain('COALESCE("occurrence_at"');
    // Y los centinelas son valores que no pueden darse de verdad.
    expect(indice).toContain("00000000-0000-0000-0000-000000000000");
    expect(indice).toContain("-infinity");
  });

  it("y UNA corrección por fila corregida", () => {
    expect(SQL_REGISTRO).toContain(
      'CREATE UNIQUE INDEX "care_records_una_correccion_key"',
    );
  });
});

describe("las FKs de la evidencia son RESTRICT", () => {
  const restrict = [
    "care_records_tenant_id_fkey",
    "care_records_client_id_fkey",
    "care_records_control_type_id_fkey",
    "care_records_plan_item_id_fkey",
    "care_records_recorded_by_user_id_fkey",
    "care_records_care_role_assignment_id_fkey",
    "care_records_device_id_fkey",
    "care_records_center_shift_id_fkey",
    "care_records_corrects_record_id_fkey",
    "care_records_voided_by_user_id_fkey",
  ];

  it.each(restrict)("%s", (nombre) => {
    const trozo = SQL_REGISTRO.slice(
      SQL_REGISTRO.indexOf(`ADD CONSTRAINT "${nombre}"`),
    ).split(";")[0]!;
    expect(trozo).toContain("ON DELETE RESTRICT");
  });

  it("y las del PIN son CASCADE, porque es una credencial y no evidencia", () => {
    for (const nombre of ["care_pins_user_id_fkey", "care_pins_tenant_id_fkey"]) {
      const trozo = SQL_REGISTRO.slice(
        SQL_REGISTRO.indexOf(`ADD CONSTRAINT "${nombre}"`),
      ).split(";")[0]!;
      expect(trozo, nombre).toContain("ON DELETE CASCADE");
    }
  });
});

describe("los CHECK que hacen falta", () => {
  it.each([
    "care_records_value_cifrado_formato",
    "care_records_note_cifrado_formato",
    "care_records_voz_completa",
    "care_records_anulacion_completa",
    "care_records_dia_formato",
    "care_records_no_se_corrige_a_si_misma",
    "resident_profiles_foto_completa",
    "client_consents_imagen_no_es_clinica",
  ])("%s", (nombre) => {
    expect(SQL_REGISTRO).toContain(`ADD CONSTRAINT "${nombre}"`);
  });

  it("y EL DEL VALOR exige el prefijo `c1:`: el claro NO CABE", () => {
    const trozo = SQL_REGISTRO.slice(
      SQL_REGISTRO.indexOf('ADD CONSTRAINT "care_records_value_cifrado_formato"'),
    ).split(";")[0]!;
    expect(trozo).toContain("^c[0-9]+:[A-Za-z0-9+/]+={0,2}$");
    // NOT NULL, así que no lleva `IS NULL OR`: todo registro tiene valor.
    expect(trozo).not.toContain("IS NULL OR");
  });

  it("el de la NOTA sí lo lleva, porque es opcional (D-13)", () => {
    const trozo = SQL_REGISTRO.slice(
      SQL_REGISTRO.indexOf('ADD CONSTRAINT "care_records_note_cifrado_formato"'),
    ).split(";")[0]!;
    expect(trozo).toContain('"note_cifrado" IS NULL');
  });

  it("y el día es VARCHAR y no CHAR, con su razón escrita", () => {
    // `bpchar` rellena con espacios y compara ignorándolos: en una columna
    // que agrupa el histórico, eso es un día partido en dos.
    expect(SQL_REGISTRO).toContain('"care_day"                VARCHAR(10) NOT NULL');
    expect(REGISTRO).toContain("bpchar");
  });
});

describe("el `id` lo pone la tablet", () => {
  it("la columna NO tiene default", () => {
    // Un default sería un valor que nadie usa y que taparía un olvido: el
    // uuid es la idempotencia del envío y el `filaId` del AAD, y lo sabe
    // antes de insertar quien registra.
    const crear = SQL_REGISTRO.slice(
      SQL_REGISTRO.indexOf('CREATE TABLE "care_records"'),
      SQL_REGISTRO.indexOf('CONSTRAINT "care_records_pkey"'),
    );
    const linea = crear
      .split("\n")
      .find((l) => l.trimStart().startsWith('"id"'))!;
    expect(linea).toContain("NOT NULL");
    expect(linea).not.toMatch(/DEFAULT/i);
  });
});
