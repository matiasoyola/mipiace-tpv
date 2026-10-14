// residencia-1 · EL CONTRATO DEL SQL DE LAS DOS MIGRACIONES.
//
// Mismo guardia que `kds-migracion.test.ts` y `clinica-migracion.test.ts`,
// y por la misma razón: casi todo lo que este bloque garantiza **sólo
// existe en el SQL**, porque Prisma no sabe declararlo. Si alguien acepta
// el «¿borrar índice?» de `prisma migrate dev`, el esquema sigue
// pareciendo correcto y la invariante se va sin que nada se ponga rojo.
//
// Lo que este fichero guarda:
//
//   · los CUATRO índices parciales del bloque — dos de ocupación, uno de
//     rol de cuidado y dos de zona (cinco, con el de «todo el centro»);
//   · el CHECK `devices_register_o_habitacion` y su hermano de los códigos
//     de emparejamiento, que es lo que hace que la puerta no sea una caja
//     y que un terminal no pueda quedarse sin caja;
//   · el índice parcial `devices_one_active_per_room_key`;
//   · que la función del trigger de relevo conserva la rama del TERMINAL
//     letra por letra y añade la del ROOM;
//   · el CHECK `tenants_residencia_exige_clinica`;
//   · que los TIPOS van en una migración APARTE;
//   · que las dos migraciones son ADITIVAS.
//
// Y lo que NO se puede guardar desde aquí, dicho en el `-done`: que los
// CHECK y los índices se cumplan de verdad. Eso es
// `test-e2e/residencia-1.e2e.ts` contra Postgres.

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
  path.join(DIR, "20261014000000_residencia_1_tipos/migration.sql"),
  "utf8",
);
const CIMIENTOS = readFileSync(
  path.join(DIR, "20261014010000_residencia_1_cimientos/migration.sql"),
  "utf8",
);
const SCHEMA = readFileSync(
  path.join(REPO_ROOT, "packages/db/prisma/schema.prisma"),
  "utf8",
);

/** El SQL sin comentarios: lo que de verdad corre. */
function soloSql(sql: string): string {
  return sql
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("--"))
    .join("\n");
}

const TIPOS_SQL = soloSql(TIPOS);
const CIMIENTOS_SQL = soloSql(CIMIENTOS);

describe("residencia-1 · los tipos van en su propia migración", () => {
  it("`ROOM` se añade en la PRIMERA y se USA en la segunda", () => {
    // Postgres prohíbe usar un valor de enum en la misma transacción en la
    // que se añade, y Prisma corre cada migración en una. Juntas, la
    // segunda aborta con «unsafe use of new value of enum type».
    expect(TIPOS_SQL).toContain(`ALTER TYPE "DeviceKind" ADD VALUE 'ROOM'`);
    expect(CIMIENTOS_SQL).not.toContain("ADD VALUE");
    expect(CIMIENTOS_SQL).toContain(`'ROOM'`);
  });

  it("la primera migración NO usa `ROOM` en ningún sitio", () => {
    // Ni un INSERT, ni un DEFAULT, **ni un CHECK**: usarlo es lo que
    // revienta. El `ALTER TYPE` es la última sentencia del fichero.
    const antesDelAlter = TIPOS_SQL.slice(
      0,
      TIPOS_SQL.indexOf(`ALTER TYPE "DeviceKind" ADD VALUE 'ROOM'`),
    );
    expect(antesDelAlter).not.toContain("'ROOM'");
    expect(TIPOS_SQL.trimEnd().endsWith(`ADD VALUE 'ROOM';`)).toBe(true);
  });

  it("los cuatro tipos nuevos se crean en la primera", () => {
    for (const tipo of [
      "DependencyLevel",
      "DependencyGrade",
      "PlaceType",
      "CareRoleCategory",
    ]) {
      expect(TIPOS_SQL).toContain(`CREATE TYPE "${tipo}" AS ENUM`);
    }
  });
});

describe("residencia-1 · el interruptor y su CHECK", () => {
  it("`residencia_enabled` nace APAGADO", () => {
    expect(TIPOS_SQL).toMatch(
      /ADD COLUMN "residencia_enabled" BOOLEAN NOT NULL DEFAULT false/,
    );
  });

  it("no se puede encender sin la clínica, y lo dice el MOTOR", () => {
    expect(TIPOS_SQL).toContain(`CONSTRAINT "tenants_residencia_exige_clinica"`);
    const check = TIPOS_SQL.slice(
      TIPOS_SQL.indexOf("tenants_residencia_exige_clinica"),
    );
    // La implicación en un sentido: residencia ⇒ clínica. La clínica SÍ
    // puede estar encendida sola (la podóloga de clinica-1).
    expect(check).toMatch(
      /CHECK \("residencia_enabled" = false OR "clinical_records_enabled" = true\)/,
    );
  });
});

describe("residencia-1 · los índices parciales, que es donde viven las reglas", () => {
  it("UNA CAMA UN RESIDENTE · `bed_assignments_one_live_per_bed_key`", () => {
    expect(CIMIENTOS_SQL).toMatch(
      /CREATE UNIQUE INDEX "bed_assignments_one_live_per_bed_key"\s*\n\s*ON "bed_assignments"\("bed_id"\)\s*\n\s*WHERE "to_at" IS NULL;/,
    );
  });

  it("UN RESIDENTE UNA CAMA · `bed_assignments_one_live_per_client_key`", () => {
    expect(CIMIENTOS_SQL).toMatch(
      /CREATE UNIQUE INDEX "bed_assignments_one_live_per_client_key"\s*\n\s*ON "bed_assignments"\("client_id"\)\s*\n\s*WHERE "to_at" IS NULL;/,
    );
  });

  it("los dos son PARCIALES · sin el `WHERE` el histórico sería imposible", () => {
    // Es la lección de clinica-1 §10: con una revocación y una vuelta en la
    // tabla, Postgres se NIEGA a crear el índice total. Aquí lo mismo: un
    // residente que ha cambiado tres veces de habitación tiene tres filas
    // con su `client_id`.
    const sinParcial = CIMIENTOS_SQL.match(
      /CREATE UNIQUE INDEX "bed_assignments_one_live[^;]*;/g,
    );
    expect(sinParcial).toHaveLength(2);
    for (const idx of sinParcial!) expect(idx).toContain("WHERE");
  });

  it("UN ROL VIVO POR PERSONA · `care_role_assignments_one_live_key`, copia de clinica-1", () => {
    expect(CIMIENTOS_SQL).toMatch(
      /CREATE UNIQUE INDEX "care_role_assignments_one_live_key"\s*\n\s*ON "care_role_assignments"\("user_id", "care_role_id"\)\s*\n\s*WHERE "revoked_at" IS NULL;/,
    );
  });

  it("LA ZONA necesita DOS índices, y el segundo es por los NULL de Postgres", () => {
    // El primero cubre «esta persona, esta planta». El segundo cubre «esta
    // persona, todo el centro» (`floor_id IS NULL`), y hace falta porque
    // en Postgres los NULL son distintos entre sí: con sólo el primero,
    // cinco filas de «todo el centro» serían cinco claves distintas.
    expect(CIMIENTOS_SQL).toMatch(
      /CREATE UNIQUE INDEX "care_zone_assignments_one_live_per_floor_key"\s*\n\s*ON "care_zone_assignments"\("user_id", "floor_id"\)\s*\n\s*WHERE "to_at" IS NULL;/,
    );
    expect(CIMIENTOS_SQL).toMatch(
      /CREATE UNIQUE INDEX "care_zone_assignments_one_live_centro_key"\s*\n\s*ON "care_zone_assignments"\("user_id"\)\s*\n\s*WHERE "to_at" IS NULL AND "floor_id" IS NULL;/,
    );
  });

  it("UNA PUERTA VIVA POR HABITACIÓN · `devices_one_active_per_room_key`", () => {
    expect(CIMIENTOS_SQL).toMatch(
      /CREATE UNIQUE INDEX "devices_one_active_per_room_key"\s*\n\s*ON "devices"\("room_id"\)\s*\n\s*WHERE "revoked_at" IS NULL AND "kind" = 'ROOM';/,
    );
  });
});

describe("residencia-1 · la puerta NO es una caja", () => {
  it("el CHECK `devices_register_o_habitacion` tiene las DOS mitades", () => {
    expect(CIMIENTOS_SQL).toContain(`CONSTRAINT "devices_register_o_habitacion"`);
    const check = CIMIENTOS_SQL.slice(
      CIMIENTOS_SQL.indexOf("devices_register_o_habitacion"),
    );
    // Mitad 1: un ROOM tiene habitación y NO caja.
    expect(check).toMatch(
      /\("kind" = 'ROOM' AND "room_id" IS NOT NULL AND "register_id" IS NULL\)/,
    );
    // Mitad 2 · LA QUE SOSTIENE VERIFACTU: todo lo que no es ROOM tiene
    // caja. Sin ella, un TERMINAL con `register_id` NULL se saldría del
    // índice único (los NULL son distintos) y una caja podría tener dos
    // terminales vivos facturando en la misma cadena.
    expect(check).toMatch(
      /\("kind" <> 'ROOM' AND "room_id" IS NULL AND "register_id" IS NOT NULL\)/,
    );
  });

  it("y los códigos de emparejamiento llevan el mismo CHECK", () => {
    expect(CIMIENTOS_SQL).toContain(
      `CONSTRAINT "pairing_codes_register_o_habitacion"`,
    );
    const check = CIMIENTOS_SQL.slice(
      CIMIENTOS_SQL.indexOf("pairing_codes_register_o_habitacion"),
    );
    expect(check).toMatch(/"kind" = 'ROOM' AND "room_id" IS NOT NULL/);
    expect(check).toMatch(/"kind" <> 'ROOM' AND "room_id" IS NULL/);
  });

  it("las dos columnas pierden el NOT NULL y las dos ganan `room_id`", () => {
    for (const tabla of ["devices", "pairing_codes"]) {
      expect(CIMIENTOS_SQL).toContain(
        `ALTER TABLE "${tabla}"\n    ALTER COLUMN "register_id" DROP NOT NULL;`,
      );
      expect(CIMIENTOS_SQL).toContain(
        `ALTER TABLE "${tabla}"\n    ADD COLUMN "room_id" UUID;`,
      );
    }
  });

  it("y el schema de Prisma lo dice igual", () => {
    expect(SCHEMA).toMatch(/registerId\s+String\?\s+@map\("register_id"\)/);
    expect(SCHEMA).toMatch(/roomId\s+String\?\s+@map\("room_id"\)/);
  });
});

describe("residencia-1 · el trigger de relevo gana una rama y no pierde la que había", () => {
  it("se REEMPLAZA la función de verifactu-1, no se añade un segundo trigger", () => {
    // Dos triggers `BEFORE INSERT` sobre la misma tabla corren en orden
    // alfabético de nombre, y el día que uno cambie el orden deja de ser
    // obvio. Una función, tres ramas.
    expect(CIMIENTOS_SQL).toContain(
      "CREATE OR REPLACE FUNCTION mipiacetpv_devices_revoke_previous()",
    );
    expect(CIMIENTOS_SQL).not.toContain("CREATE TRIGGER \"devices_revoke");
  });

  it("la rama del ROOM releva SÓLO en su habitación", () => {
    const fn = CIMIENTOS_SQL.slice(
      CIMIENTOS_SQL.indexOf("CREATE OR REPLACE FUNCTION mipiacetpv_devices_revoke_previous"),
    );
    const rama = fn.slice(fn.indexOf("IF NEW.kind = 'ROOM'"));
    expect(rama).toContain("WHERE room_id = NEW.room_id");
    expect(rama).toMatch(/AND kind = 'ROOM'/);
    // Y sale ANTES de llegar a la del terminal.
    expect(rama.indexOf("RETURN NEW;")).toBeLessThan(
      rama.indexOf("register_id = NEW.register_id"),
    );
  });

  it("la rama del TERMINAL sigue filtrando `kind = 'TERMINAL'` en los dos sitios", () => {
    const fn = CIMIENTOS_SQL.slice(
      CIMIENTOS_SQL.indexOf("CREATE OR REPLACE FUNCTION mipiacetpv_devices_revoke_previous"),
    );
    expect(fn).toContain("IF NEW.kind <> 'TERMINAL' THEN");
    expect(fn).toContain("AND kind = 'TERMINAL'");
    // Y el alta de un device YA revocado sigue sin relevar a nadie.
    expect(fn).toContain("IF NEW.revoked_at IS NOT NULL THEN");
  });

  it("el índice de verifactu-1 NO se toca", () => {
    // Filtra `kind = 'TERMINAL'`, así que ninguna fila `ROOM` entra en él.
    // Tocarlo sería la forma de romper verifactu desde este bloque.
    expect(CIMIENTOS_SQL).not.toContain("devices_one_active_per_register_key");
  });
});

describe("residencia-1 · un rol de serie no cambia de categoría", () => {
  it("el trigger existe y cubre UPDATE y DELETE", () => {
    expect(CIMIENTOS_SQL).toContain(
      "CREATE FUNCTION mipiacetpv_care_roles_de_serie()",
    );
    expect(CIMIENTOS_SQL).toMatch(
      /CREATE TRIGGER "care_roles_de_serie_son_fijos"\s*\n\s*BEFORE UPDATE OR DELETE ON "care_roles"/,
    );
  });

  it("congela la categoría, el código y los tres flags de acceso", () => {
    const fn = CIMIENTOS_SQL.slice(
      CIMIENTOS_SQL.indexOf("CREATE FUNCTION mipiacetpv_care_roles_de_serie"),
    );
    for (const col of [
      "category",
      "code",
      "is_standard",
      "records_care",
      "requires_license",
      "full_scope",
    ]) {
      expect(fn).toContain(`NEW.${col} <> OLD.${col}`);
    }
    // Y lo que SÍ deja cambiar no está en la lista: nombre, orden, activo.
    expect(fn).not.toContain("NEW.name <> OLD.name");
    expect(fn).not.toContain("NEW.active <> OLD.active");
    expect(fn).not.toContain("NEW.sort_order <> OLD.sort_order");
  });

  it("la negativa se reconoce por prefijo, como la de la historia clínica", () => {
    expect(CIMIENTOS_SQL).toContain("RESIDENCIA_VIOLADA:");
  });
});

describe("residencia-1 · lo que no se borra", () => {
  it("`resident_profiles` cuelga con RESTRICT de `clients` y de `tenants`", () => {
    const tabla = CIMIENTOS_SQL.slice(
      CIMIENTOS_SQL.indexOf('CREATE TABLE "resident_profiles"'),
      CIMIENTOS_SQL.indexOf('CREATE INDEX "resident_profiles_tenant_id_idx"'),
    );
    expect(tabla).toMatch(
      /resident_profiles_client_id_fkey[\s\S]*?REFERENCES "clients"\("id"\) ON DELETE RESTRICT/,
    );
    expect(tabla).toMatch(
      /resident_profiles_tenant_id_fkey[\s\S]*?REFERENCES "tenants"\("id"\) ON DELETE RESTRICT/,
    );
  });

  it("`bed_assignments` cuelga con RESTRICT de las tres", () => {
    const tabla = CIMIENTOS_SQL.slice(
      CIMIENTOS_SQL.indexOf('CREATE TABLE "bed_assignments"'),
      CIMIENTOS_SQL.indexOf('CREATE INDEX "bed_assignments_tenant_id_idx"'),
    );
    for (const fk of ["tenant_id", "bed_id", "client_id"]) {
      expect(tabla).toMatch(
        new RegExp(`bed_assignments_${fk}_fkey[\\s\\S]*?ON DELETE RESTRICT`),
      );
    }
    // Y el autor con SET NULL: dar de baja a quien movió a la señora no
    // puede borrar el hecho de que se movió.
    expect(tabla).toMatch(
      /bed_assignments_created_by_user_id_fkey[\s\S]*?ON DELETE SET NULL/,
    );
  });

  it("`care_role_assignments` no se queda huérfana: RESTRICT al usuario y al rol", () => {
    const tabla = CIMIENTOS_SQL.slice(
      CIMIENTOS_SQL.indexOf('CREATE TABLE "care_role_assignments"'),
      CIMIENTOS_SQL.indexOf('CREATE INDEX "care_role_assignments_tenant_id_idx"'),
    );
    for (const fk of ["tenant_id", "user_id", "care_role_id"]) {
      expect(tabla).toMatch(
        new RegExp(`care_role_assignments_${fk}_fkey[\\s\\S]*?ON DELETE RESTRICT`),
      );
    }
  });

  it("NINGUNA FK de las tres tablas que no se borran es CASCADE", () => {
    // El mismo guardia que clinica-1: un `CASCADE` que se cuele es un
    // residente que se va con su tenant.
    for (const tabla of [
      "resident_profiles",
      "bed_assignments",
      "care_role_assignments",
    ]) {
      const inicio = CIMIENTOS_SQL.indexOf(`CREATE TABLE "${tabla}"`);
      const fin = CIMIENTOS_SQL.indexOf(");", inicio);
      const cuerpo = CIMIENTOS_SQL.slice(inicio, fin);
      expect(cuerpo).not.toContain("ON DELETE CASCADE");
    }
  });
});

describe("residencia-1 · las dos migraciones son ADITIVAS", () => {
  it("ni un DROP TABLE, ni un DELETE, ni un TRUNCATE, ni un UPDATE masivo", () => {
    for (const sql of [TIPOS_SQL, CIMIENTOS_SQL]) {
      expect(sql).not.toMatch(/\bDROP TABLE\b/i);
      expect(sql).not.toMatch(/\bTRUNCATE\b/i);
      expect(sql).not.toMatch(/\bDELETE FROM\b/i);
      expect(sql).not.toMatch(/\bDROP COLUMN\b/i);
    }
    // Lo único que no es un `CREATE` o un `ADD` es el `DROP NOT NULL`, que
    // es sólo catálogo: no reescribe la tabla ni valida filas.
    expect(CIMIENTOS_SQL.match(/DROP NOT NULL/g)).toHaveLength(2);
  });

  it("el único `UPDATE … SET` del SQL está DENTRO de la función del trigger", () => {
    // Un `UPDATE … SET` suelto en una migración es un backfill, y este
    // bloque no tiene ninguno: el backfill ES el DEFAULT, y desde PG 11 eso
    // no reescribe la tabla.
    //
    // Se busca `UPDATE … SET` y no `UPDATE` a secas porque
    // `CREATE TRIGGER … BEFORE UPDATE OR DELETE` lleva la palabra y no
    // escribe ni una fila.
    const fuera = CIMIENTOS_SQL.split("$fn$")
      .filter((_, i) => i % 2 === 0)
      .join("\n");
    expect(fuera).not.toMatch(/UPDATE\s+\w+\s+SET/i);
    // Y dentro hay exactamente dos: la rama del ROOM y la del TERMINAL.
    const dentro = CIMIENTOS_SQL.split("$fn$")
      .filter((_, i) => i % 2 === 1)
      .join("\n");
    expect(dentro.match(/UPDATE devices/g)).toHaveLength(2);
  });

  it("el `down` está escrito en la cabecera de las dos, incluido lo irreversible", () => {
    for (const sql of [TIPOS, CIMIENTOS]) {
      expect(sql).toContain("`down`");
    }
    // Y lo que NO se puede deshacer se dice con esas palabras: un valor de
    // enum no se quita en Postgres.
    expect(TIPOS).toContain("ALTER TYPE … DROP VALUE` no existe");
  });
});

describe("residencia-1 · el formato de las horas de los turnos", () => {
  it("el CHECK exige HH:MM y prohíbe inicio igual a fin", () => {
    expect(CIMIENTOS_SQL).toContain(`CONSTRAINT "center_shifts_horas_validas"`);
    const check = CIMIENTOS_SQL.slice(
      CIMIENTOS_SQL.indexOf("center_shifts_horas_validas"),
    );
    expect(check).toContain("^([01][0-9]|2[0-3]):[0-5][0-9]$");
    expect(check).toContain(`"starts_at" <> "ends_at"`);
  });

  it("y NO hay CHECK de orden: la noche cruza medianoche", () => {
    // `ends_at <= starts_at` es justo lo que distingue un turno de noche.
    // Un CHECK de orden habría hecho imposible el turno de 22 a 08.
    const check = CIMIENTOS_SQL.slice(
      CIMIENTOS_SQL.indexOf("center_shifts_horas_validas"),
      CIMIENTOS_SQL.indexOf("center_shifts_code_not_blank"),
    );
    expect(check).not.toContain(`"ends_at" > "starts_at"`);
  });
});
