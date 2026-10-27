// personal-1 · EL CONTRATO DEL SQL DE LAS DOS MIGRACIONES.
//
// Mismo guardia que `alta-minima-migracion.test.ts` y `f2-registro-
// migracion.test.ts`, y por la misma razón: lo que estas migraciones
// garantizan **sólo existe en el SQL**. Si alguien acepta el «¿borrar?» de
// `prisma migrate dev`, el esquema sigue pareciendo correcto —las tablas
// están, las columnas están— y los seis triggers se van sin que nada se
// ponga rojo.
//
// Lo que este fichero guarda:
//
//   · las ocho columnas de la ficha, con las DOS cifradas y su CHECK de
//     formato (`^c[0-9]+:…`), que es lo que `residencia-1b-cifrado` cuenta
//     para no dejar una columna cifrada sin su `sitio*`;
//   · que TODOS los CHECK nuevos llevan su `IS NULL` / `IS NOT NULL`
//     delante — **un CHECK que da NULL pasa**, y con ocho columnas
//     nullable esa es la forma exacta en que esto se rompería en verde;
//   · que `center_shifts` se AMPLÍA y no se mueve (decisión 4): ni un
//     `ALTER TABLE ... RENAME`, ni una tabla de turnos nueva;
//   · que el margen del turno planificado va con el mismo trato que
//     `fichaje_max_open_hours`: rango en un CHECK de la base;
//   · los dos índices únicos de la celda, uno de ellos PARCIAL — y hacen
//     falta los dos porque en Postgres los NULL son distintos entre sí;
//   · el append-only del registro de cambios, el `txid_current()` del
//     guard, y que `set_staff_schedule_day` es `SECURITY DEFINER` con
//     `search_path` fijado;
//   · que un cuadrante publicado no vuelve a borrador, no se le mueve la
//     firma y no se borra;
//   · que los dos `down` están escritos y FALLAN con un mensaje en vez de
//     borrar un DNI o un registro de cambios en silencio;
//   · que las dos son ADITIVAS;
//   · y que el `schema.prisma` lo dice igual.

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
const FICHA = readFileSync(
  path.join(DIR, "20261027000000_personal_1_ficha/migration.sql"),
  "utf8",
);
const CUADRANTE = readFileSync(
  path.join(DIR, "20261027010000_personal_1_cuadrante/migration.sql"),
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
/** Y el revés: sólo los comentarios, que es donde vive el `down`. */
function soloComentarios(sql: string): string {
  return sql
    .split("\n")
    .filter((l) => l.trimStart().startsWith("--"))
    .join("\n");
}

const FICHA_SQL = soloSql(FICHA);
const FICHA_DOWN = soloComentarios(FICHA);
const CUADRANTE_SQL = soloSql(CUADRANTE);
const CUADRANTE_DOWN = soloComentarios(CUADRANTE);
/** Aplastado, para comprobar condiciones partidas en varias líneas. */
const FICHA_PLANO = FICHA_SQL.replace(/\s+/g, " ");
const CUADRANTE_PLANO = CUADRANTE_SQL.replace(/\s+/g, " ");

// ── 1 · la ficha ──────────────────────────────────────────────────────

describe("personal-1 · las ocho columnas de la ficha", () => {
  const COLUMNAS = [
    "last_name",
    "dni_cifrado",
    "nss_cifrado",
    "category_id",
    "weekly_minutes",
    "contract_kind",
    "hired_on",
    "contract_ends_on",
  ];

  it.each(COLUMNAS)("`%s` se añade a employees", (col) => {
    expect(FICHA_PLANO).toContain(`ADD COLUMN "${col}"`);
  });

  it("y `schedule_seen_at`, que es la novena y es del móvil", () => {
    expect(FICHA_PLANO).toContain('ADD COLUMN "schedule_seen_at"');
  });

  it("TODAS nullable: ni un `NOT NULL` en el ALTER de employees", () => {
    // El ALTER de `employees` entero, hasta el `;`.
    const alter = FICHA_PLANO.slice(
      FICHA_PLANO.indexOf('ALTER TABLE "employees"'),
    );
    const hasta = alter.slice(0, alter.indexOf(";"));
    expect(hasta).not.toContain("NOT NULL");
  });

  it("la jornada va en MINUTOS, no en horas decimales", () => {
    expect(FICHA_PLANO).toContain('ADD COLUMN "weekly_minutes" INTEGER');
    expect(FICHA_PLANO).not.toContain("weekly_hours");
    expect(FICHA_PLANO).not.toMatch(/NUMERIC\(\d+, ?\d+\)/);
  });
});

describe("personal-1 · las dos columnas cifradas", () => {
  it("las dos llevan su CHECK de formato `^c[0-9]+:…`", () => {
    for (const col of ["dni_cifrado", "nss_cifrado"]) {
      expect(FICHA_PLANO).toContain(
        `CHECK ("${col}" IS NULL OR "${col}" ~ '^c[0-9]+:[A-Za-z0-9+/]+={0,2}$')`,
      );
    }
  });

  it("y nacen cifradas: no hay columna en claro de respaldo", () => {
    expect(FICHA_PLANO).not.toContain('ADD COLUMN "dni" ');
    expect(FICHA_PLANO).not.toContain('ADD COLUMN "nss" ');
    expect(FICHA_PLANO).not.toContain('ADD COLUMN "num_afiliacion');
  });

  it("y no se guardan en blanco", () => {
    expect(FICHA_PLANO).toContain(
      `CHECK (("dni_cifrado" IS NULL OR btrim("dni_cifrado") <> '') AND ("nss_cifrado" IS NULL OR btrim("nss_cifrado") <> ''))`,
    );
  });
});

describe("personal-1 · TODOS los CHECK llevan su IS NULL delante", () => {
  // Un CHECK que evalúa a NULL **pasa**. Con ocho columnas nullable, un
  // CHECK escrito sin su `IS NULL` se apaga solo para las fichas nuevas y
  // no lo dice ningún error. Esto se mira condición a condición y no de
  // oído.
  const CONDICIONES: Array<[string, string]> = [
    [
      "la jornada contratada",
      `CHECK ("weekly_minutes" IS NULL OR ("weekly_minutes" >= 1 AND "weekly_minutes" <= 3600))`,
    ],
    [
      "la fecha de fin sólo en temporales",
      `CHECK ("contract_ends_on" IS NULL OR "contract_kind" = 'TEMPORAL')`,
    ],
    [
      "la fecha de fin después del alta",
      `CHECK ("contract_ends_on" IS NULL OR "hired_on" IS NULL OR "contract_ends_on" >= "hired_on")`,
    ],
    [
      "la cobertura mínima del turno",
      `CHECK ("min_coverage" IS NULL OR ("min_coverage" >= 0 AND "min_coverage" <= 200))`,
    ],
  ];

  it.each(CONDICIONES)("%s", (_, condicion) => {
    expect(FICHA_PLANO).toContain(condicion);
  });

  it("el margen del turno, y éste con `IS NOT NULL` porque es NOT NULL", () => {
    // El mismo criterio exacto de `tenants_fichaje_max_open_hours_check`
    // (#45): el `IS NOT NULL` va aunque la columna lo sea, porque si
    // mañana alguien la hiciera nullable el CHECK dejaría de proteger nada
    // sin que lo dijera ningún error.
    expect(FICHA_PLANO).toContain(
      `CHECK ( "fichaje_shift_margin_hours" IS NOT NULL AND "fichaje_shift_margin_hours" BETWEEN 1 AND 12 )`,
    );
  });

  it("y los seis rangos de las reglas, cada uno con el suyo", () => {
    for (const col of [
      "ratio_direct_care_per_mil",
      "min_rest_hours",
      "weekly_rest_hours",
      "weekly_rest_window_days",
      "no_show_tolerance_minutes",
      "full_day_minutes",
    ]) {
      expect(FICHA_PLANO).toContain(`"${col}" IS NOT NULL`);
      expect(FICHA_PLANO).toMatch(
        new RegExp(`"${col}" BETWEEN \\d+ AND \\d+`),
      );
    }
  });
});

describe("personal-1 (decisión 4) · la tabla de turnos se AMPLÍA, no se mueve", () => {
  it("`center_shifts` gana `min_coverage` y nada más", () => {
    expect(FICHA_PLANO).toContain(
      'ALTER TABLE "center_shifts" ADD COLUMN "min_coverage" INTEGER',
    );
  });

  it("y no hay tabla de turnos nueva ni RENAME de la que hay", () => {
    const todo = FICHA_PLANO + CUADRANTE_PLANO;
    expect(todo).not.toContain('RENAME TO "center_shifts"');
    expect(todo).not.toContain('ALTER TABLE "center_shifts" RENAME');
    expect(todo).not.toMatch(/CREATE TABLE "(tenant_shifts|work_shifts|shifts_del_tenant)"/);
    // Y la tabla que el cuadrante referencia es `center_shifts`, la de
    // siempre: si se hubiera creado otra, esta FK apuntaría a ella.
    expect(CUADRANTE_PLANO).toContain(
      'FOREIGN KEY ("center_shift_id") REFERENCES "center_shifts"("id") ON DELETE RESTRICT',
    );
  });

  it("`min_coverage` es NULLABLE, y el NULL significa «sin declarar»", () => {
    expect(FICHA_PLANO).not.toContain(
      'ADD COLUMN "min_coverage" INTEGER NOT NULL',
    );
    expect(FICHA_PLANO).not.toContain('"min_coverage" INTEGER DEFAULT 0');
  });
});

describe("personal-1 · el catálogo de categorías", () => {
  it("existe, por tenant y con único por código", () => {
    expect(FICHA_PLANO).toContain('CREATE TABLE "employee_categories"');
    expect(FICHA_PLANO).toContain(
      'CREATE UNIQUE INDEX "employee_categories_tenant_id_code_key" ON "employee_categories"("tenant_id", "code")',
    );
  });

  it("`counts_as_direct_care` nace en `false`", () => {
    // Al revés, una categoría recién inventada inflaría la ratio sin que
    // nadie la hubiera marcado.
    expect(FICHA_PLANO).toContain(
      '"counts_as_direct_care" BOOLEAN NOT NULL DEFAULT false',
    );
  });

  it("y una categoría con gente dentro no se borra (RESTRICT)", () => {
    expect(FICHA_PLANO).toContain(
      'FOREIGN KEY ("category_id") REFERENCES "employee_categories"("id") ON DELETE RESTRICT',
    );
  });
});

// ── 2 · el cuadrante ──────────────────────────────────────────────────

describe("personal-1 · las tres tablas del cuadrante y sus enums", () => {
  it.each(["staff_schedules", "staff_schedule_cells", "staff_schedule_changes"])(
    "`%s`",
    (tabla) => {
      expect(CUADRANTE_PLANO).toContain(`CREATE TABLE "${tabla}"`);
    },
  );

  it("los tres enums, con sus valores", () => {
    expect(CUADRANTE_PLANO).toContain(
      `CREATE TYPE "StaffScheduleState" AS ENUM ('BORRADOR', 'PUBLICADO')`,
    );
    expect(CUADRANTE_PLANO).toContain(
      `CREATE TYPE "StaffScheduleOrigin" AS ENUM ('MANUAL', 'GENERADO')`,
    );
    expect(CUADRANTE_PLANO).toContain(
      `CREATE TYPE "StaffAbsenceKind" AS ENUM ('LIBRE', 'VACACIONES', 'IT', 'ASUNTOS_PROPIOS', 'PERMISO')`,
    );
  });

  it("`GENERADO` existe ya, aunque nada lo escriba: es personal-2", () => {
    expect(CUADRANTE).toContain("personal-2");
  });

  it("un cuadrante por empresa y mes", () => {
    expect(CUADRANTE_PLANO).toContain(
      'CREATE UNIQUE INDEX "staff_schedules_tenant_id_month_key" ON "staff_schedules"("tenant_id", "month")',
    );
  });

  it("publicado y sin fecha de publicación es imposible, y lo dice un CHECK", () => {
    expect(CUADRANTE_PLANO).toContain(
      `CHECK (("state" = 'PUBLICADO') = ("published_at" IS NOT NULL))`,
    );
  });
});

describe("personal-1 · la celda y sus DOS índices únicos", () => {
  it("un turno O una ausencia, nunca las dos ni ninguna (XOR)", () => {
    expect(CUADRANTE_PLANO).toContain(
      `CHECK (("center_shift_id" IS NULL) <> ("absence_kind" IS NULL))`,
    );
  });

  it("el único del turno, que deja pasar las filas de ausencia", () => {
    expect(CUADRANTE_PLANO).toContain(
      'CREATE UNIQUE INDEX "staff_schedule_cells_un_turno_por_dia_key" ON "staff_schedule_cells"("schedule_id", "employee_id", "day", "center_shift_id")',
    );
  });

  it("y el PARCIAL de la ausencia, que es la mitad que el otro no cubre", () => {
    // En Postgres los NULL son distintos entre sí, así que el índice de
    // arriba no constriñe las filas de ausencia (`center_shift_id` NULL):
    // cinco vacaciones del mismo día serían cinco claves distintas.
    // Misma lección exacta que `care_zone_assignments_one_live_centro_key`.
    expect(CUADRANTE_PLANO).toContain(
      'CREATE UNIQUE INDEX "staff_schedule_cells_una_ausencia_por_dia_key" ON "staff_schedule_cells"("schedule_id", "employee_id", "day") WHERE "absence_kind" IS NOT NULL',
    );
  });

  it("el empleado y el turno cuelgan con RESTRICT, no con CASCADE", () => {
    expect(CUADRANTE_PLANO).toContain(
      'FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT',
    );
    expect(CUADRANTE_PLANO).toContain(
      'FOREIGN KEY ("center_shift_id") REFERENCES "center_shifts"("id") ON DELETE RESTRICT',
    );
  });
});

describe("personal-1 · el registro de cambios es append-only", () => {
  it("por TRIGGER, no por costumbre", () => {
    expect(CUADRANTE_SQL).toContain(
      "CREATE FUNCTION mipiacetpv_staff_schedule_changes_append_only()",
    );
    expect(CUADRANTE_PLANO).toContain(
      'CREATE TRIGGER "staff_schedule_changes_append_only" BEFORE UPDATE OR DELETE ON "staff_schedule_changes"',
    );
  });

  it("con el motivo y el autor obligatorios EN LA BASE", () => {
    expect(CUADRANTE_PLANO).toContain(
      `CHECK (btrim("reason") <> '' AND btrim("author") <> '')`,
    );
  });

  it("y guarda la ETIQUETA, no el id del turno", () => {
    expect(CUADRANTE_PLANO).toContain('"before_label" TEXT');
    expect(CUADRANTE_PLANO).toContain('"after_label" TEXT');
    expect(CUADRANTE_PLANO).not.toContain('"before_shift_id"');
  });

  it("la única escapatoria del append-only es que el padre ya no exista", () => {
    expect(CUADRANTE_SQL).toContain(
      "AND NOT EXISTS (SELECT 1 FROM staff_schedules WHERE id = OLD.schedule_id)",
    );
  });
});

describe("personal-1 · la traza y el cambio son la MISMA transacción", () => {
  it("el guard consulta `txid_current()`, como ADR-018", () => {
    expect(CUADRANTE_SQL).toContain(
      "CREATE FUNCTION mipiacetpv_staff_schedule_change_exists(",
    );
    expect(CUADRANTE_SQL).toContain("WHERE txid = txid_current()");
  });

  it("y el índice que esa consulta usa existe", () => {
    expect(CUADRANTE_PLANO).toContain(
      'CREATE INDEX "staff_schedule_changes_txid_schedule_id_employee_id_day_idx" ON "staff_schedule_changes"("txid", "schedule_id", "employee_id", "day")',
    );
  });

  it("`set_staff_schedule_day` es SECURITY DEFINER con search_path fijado", () => {
    expect(CUADRANTE_PLANO).toContain(
      "LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp",
    );
  });

  it("escribe la traza ANTES de tocar las celdas", () => {
    const traza = CUADRANTE_SQL.indexOf("INSERT INTO staff_schedule_changes");
    const borrado = CUADRANTE_SQL.indexOf("DELETE FROM staff_schedule_cells");
    expect(traza).toBeGreaterThan(0);
    expect(borrado).toBeGreaterThan(traza);
  });

  it("y es idempotente: lo mismo otra vez no escribe cambio", () => {
    // `IS NOT DISTINCT FROM` y no `=`: los dos pueden ser NULL («el día
    // estaba y sigue vacío») y con `=` eso daría NULL y la rama no se
    // tomaría.
    expect(CUADRANTE_SQL).toContain("IF v_before IS NOT DISTINCT FROM v_after THEN");
  });

  it("un cuadrante publicado sin motivo se rechaza en la FUNCIÓN", () => {
    expect(CUADRANTE_SQL).toContain("CUADRANTE_SIN_MOTIVO");
    expect(CUADRANTE_SQL).toContain("CUADRANTE_SIN_AUTOR");
  });
});

describe("personal-1 · el guard de las celdas", () => {
  it("un UPDATE sobre una celda se rechaza SIEMPRE, también en borrador", () => {
    // «La celda» no es una fila cuando el día lleva dos turnos: mover una
    // de las dos dejaría una etiqueta a medias en el registro de cambios.
    expect(CUADRANTE_SQL).toContain("IF TG_OP = 'UPDATE' THEN");
    expect(CUADRANTE_SQL).toContain(
      "una celda del cuadrante no se edita, se sustituye",
    );
  });

  it("cuelga de las TRES operaciones", () => {
    expect(CUADRANTE_PLANO).toContain(
      'CREATE TRIGGER "staff_schedule_cells_guard" BEFORE INSERT OR UPDATE OR DELETE ON "staff_schedule_cells"',
    );
  });

  it("y repite las dos coherencias que un CHECK no puede decir", () => {
    // El mes vive en otra tabla, y «turno y ausencia el mismo día» no lo
    // cubre ninguno de los dos índices únicos.
    expect(CUADRANTE_SQL).toContain("to_char(NEW.day, 'YYYY-MM') <> v_month");
    expect(CUADRANTE_SQL).toContain(
      "(NEW.absence_kind IS NOT NULL) = (center_shift_id IS NOT NULL)",
    );
  });
});

describe("personal-1 · publicar FIJA", () => {
  it("un publicado no vuelve a borrador", () => {
    expect(CUADRANTE_SQL).toContain("un cuadrante publicado no vuelve a borrador");
  });

  it("ni se le mueve la firma ni el origen", () => {
    expect(CUADRANTE_SQL).toContain(
      "la firma y el origen de un cuadrante publicado no se mueven",
    );
  });

  it("ni el mes ni la empresa, publicado o no", () => {
    expect(CUADRANTE_SQL).toContain(
      "el mes y la empresa de un cuadrante no se cambian",
    );
  });

  it("y un publicado no se borra, salvo cascada del tenant", () => {
    expect(CUADRANTE_SQL).toContain(
      "CREATE FUNCTION mipiacetpv_staff_schedules_delete_guard()",
    );
    expect(CUADRANTE_SQL).toContain(
      "IF NOT EXISTS (SELECT 1 FROM tenants WHERE id = OLD.tenant_id) THEN",
    );
    expect(CUADRANTE_SQL).toContain("está publicado y no se borra");
  });
});

// ── 3 · los dos `down`, y que son aditivas ────────────────────────────

describe("personal-1 · los dos `down` están escritos y FALLAN con un mensaje", () => {
  it("el de la ficha cuenta los DNI y se niega", () => {
    expect(FICHA_DOWN).toContain("EL `down`");
    expect(FICHA_DOWN).toContain("RAISE EXCEPTION");
    expect(FICHA_DOWN).toContain("No se puede bajar personal-1");
    // Y se niega en vez de borrar: el DNI no está en ninguna otra parte.
    expect(FICHA_DOWN).toContain('"dni_cifrado" IS NOT NULL OR "nss_cifrado" IS NOT NULL');
  });

  it("el del cuadrante cuenta los cambios registrados y se niega", () => {
    expect(CUADRANTE_DOWN).toContain("RAISE EXCEPTION");
    expect(CUADRANTE_DOWN).toContain("No se puede bajar el cuadrante de personal-1");
    expect(CUADRANTE_DOWN).toContain('SELECT count(*) INTO n FROM "staff_schedule_changes"');
  });

  it("y los dos tiran las seis funciones y los cuatro triggers", () => {
    for (const fn of [
      "set_staff_schedule_day",
      "mipiacetpv_staff_schedule_change_exists",
      "mipiacetpv_staff_schedules_guard",
      "mipiacetpv_staff_schedules_delete_guard",
      "mipiacetpv_staff_schedule_cells_guard",
      "mipiacetpv_staff_schedule_changes_append_only",
    ]) {
      expect(CUADRANTE_DOWN).toContain(`DROP FUNCTION ${fn}`);
    }
  });
});

describe("personal-1 · las dos migraciones son ADITIVAS", () => {
  it("ni un DROP TABLE ni un DROP COLUMN", () => {
    for (const sql of [FICHA_SQL, CUADRANTE_SQL]) {
      expect(sql).not.toMatch(/^\s*DROP TABLE/m);
      expect(sql).not.toMatch(/^\s*DROP COLUMN/m);
    }
  });

  it("ni un DELETE o un UPDATE sobre una tabla QUE YA EXISTÍA", () => {
    // El DML que hay está DENTRO de `set_staff_schedule_day`, y sólo toca
    // las dos tablas que nacen en esta migración: borra las celdas del día
    // que sustituye y marca la cabecera como tocada. Lo que no puede haber
    // es un backfill sobre nada de lo que ya hay — y eso se mira por
    // nombre de tabla, no de oído.
    const DEL_BLOQUE = new Set([
      "staff_schedules",
      "staff_schedule_cells",
      "staff_schedule_changes",
      "employee_categories",
      "staff_rule_settings",
    ]);
    for (const sql of [FICHA_SQL, CUADRANTE_SQL]) {
      for (const m of sql.matchAll(
        /(?:DELETE FROM|UPDATE)\s+"?([a-z_]+)"?/g,
      )) {
        expect(DEL_BLOQUE, `${m[0]} toca una tabla de antes`).toContain(m[1]);
      }
    }
  });

  it("y no toca ni un trigger de ADR-018", () => {
    const todo = FICHA_SQL + CUADRANTE_SQL;
    expect(todo).not.toContain("time_entries");
    expect(todo).not.toContain("time_entry_corrections");
    expect(todo).not.toContain("record_time_entry_correction");
  });

  it("el único DROP CONSTRAINT que haría falta no existe: nada se reescribe", () => {
    // alta-minima SÍ tuvo que reescribir un CHECK ajeno
    // (`resident_profiles_alta_coherente`) y la lección de la casa es
    // partir de la ÚLTIMA definición. Aquí no hay ninguno, y eso es lo
    // que hace que estas dos no puedan borrar en silencio la mitad de un
    // CHECK de otro bloque.
    expect(FICHA_SQL).not.toContain("DROP CONSTRAINT");
    expect(CUADRANTE_SQL).not.toContain("DROP CONSTRAINT");
  });
});

// ── 4 · y el schema.prisma lo dice igual ──────────────────────────────

describe("personal-1 · el schema.prisma dice lo mismo", () => {
  it.each([
    "EmployeeCategory",
    "StaffSchedule",
    "StaffScheduleCell",
    "StaffScheduleChange",
    "StaffRuleSettings",
  ])("el modelo %s existe", (modelo) => {
    expect(SCHEMA).toContain(`model ${modelo} {`);
  });

  it.each([
    "EmployeeContractKind",
    "StaffScheduleState",
    "StaffScheduleOrigin",
    "StaffAbsenceKind",
  ])("el enum %s existe", (e) => {
    expect(SCHEMA).toContain(`enum ${e} {`);
  });

  it("y el mapeo de las tres tablas del cuadrante", () => {
    for (const tabla of [
      "employee_categories",
      "staff_schedules",
      "staff_schedule_cells",
      "staff_schedule_changes",
      "staff_rule_settings",
    ]) {
      expect(SCHEMA).toContain(`@@map("${tabla}")`);
    }
  });

  it("`Employee` lleva las nueve columnas nuevas, todas opcionales", () => {
    for (const campo of [
      "lastName",
      "dniCifrado",
      "nssCifrado",
      "categoryId",
      "weeklyMinutes",
      "contractKind",
      "hiredOn",
      "contractEndsOn",
      "scheduleSeenAt",
    ]) {
      expect(SCHEMA).toMatch(new RegExp(`${campo}\\s+\\w+\\?`));
    }
  });

  it("`CenterShift.minCoverage` es opcional", () => {
    expect(SCHEMA).toMatch(/minCoverage\s+Int\?\s+@map\("min_coverage"\)/);
  });

  it("y el margen del tenant tiene el default de la base", () => {
    expect(SCHEMA).toMatch(
      /fichajeShiftMarginHours\s+Int\s+@default\(4\)\s+@map\("fichaje_shift_margin_hours"\)/,
    );
  });

  it("el único de la celda lleva el nombre del índice de la migración", () => {
    // Si no, el siguiente `migrate dev` lo vería como sobrante y lo
    // borraría: ahí se iría la invariante sin que nada se pusiera rojo.
    expect(SCHEMA).toContain('map: "staff_schedule_cells_un_turno_por_dia_key"');
  });
});
