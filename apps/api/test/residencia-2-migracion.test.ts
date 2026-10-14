// residencia-2 · EL CONTRATO DEL SQL DE LA MIGRACIÓN.
//
// Mismo guardia que `residencia-migracion.test.ts` (residencia-1) y por la
// misma razón: casi todo lo que este bloque garantiza **sólo existe en el
// SQL**, porque Prisma no sabe declararlo. Si alguien acepta el «¿borrar
// índice?» de `prisma migrate dev`, el esquema sigue pareciendo correcto y
// la invariante se va sin que nada se ponga rojo.
//
// Lo que este fichero guarda:
//
//   · los SEIS índices parciales del bloque — dos de «una vigente», dos de
//     «(código, versión)», el del «como siempre» y el de la línea viva;
//   · el CHECK de alcance (`STANDARD` sin tenant, `CENTER` con tenant) y
//     sus DOS mitades;
//   · los CUATRO CHECK de coherencia de frecuencia, uno por tabla;
//   · los dos topes que son decisiones: `every_n_hours` 1–12 y
//     `month_day` 1–28;
//   · el CHECK de `source_level`, que es lo que sostiene «las manuales no
//     se tocan»;
//   · que la migración es ADITIVA y va en UNA sola (los tipos son nuevos);
//   · que el `down` está escrito.
//
// Y lo que NO se puede guardar desde aquí, dicho en el `-done`: que los
// CHECK y los índices se cumplan de verdad. Eso es
// `test-e2e/residencia-2.e2e.ts` contra Postgres.

import { readFileSync, readdirSync } from "node:fs";
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
const NOMBRE = "20261015000000_residencia_2_catalogo_y_plan";
const SQL = readFileSync(path.join(DIR, NOMBRE, "migration.sql"), "utf8");

/** El SQL sin los comentarios, para que una aserción no case con la prosa. */
const CODIGO = SQL.split("\n")
  .filter((l) => !l.trimStart().startsWith("--"))
  .join("\n");

describe("residencia-2 · una sola migración, y por qué", () => {
  it("va en UNA, no en dos: los seis tipos son NUEVOS", () => {
    // residencia-1 fue en dos porque añadía un VALOR (`ROOM`) a un enum
    // que ya existía, y Postgres prohíbe usar un valor nuevo de enum en la
    // misma transacción en la que se añade. `CREATE TYPE` sí se puede usar
    // en su transacción, y los CHECK que comparan contra sus literales
    // también — que es lo que esta migración hace.
    const delBloque = readdirSync(DIR).filter((d) => d.includes("residencia_2"));
    expect(delBloque).toEqual([NOMBRE]);
    expect(CODIGO).not.toContain("ALTER TYPE");
  });

  it("crea los SEIS tipos", () => {
    for (const tipo of [
      "ControlLayer",
      "ControlNature",
      "ControlValueDomain",
      "ControlScope",
      "CareFrequencyKind",
      "CarePlanItemSource",
    ]) {
      expect(CODIGO).toContain(`CREATE TYPE "${tipo}" AS ENUM`);
    }
  });

  it("`ControlLayer` ya lleva `SCALE` y `EVENT`, que este bloque NO siembra", () => {
    // Están desde ya para que el día que se siembren (Fase 2 y
    // residencia-4) no haga falta una migración de tipo — que es la
    // factura que residencia-1 pagó.
    expect(CODIGO).toContain(
      `CREATE TYPE "ControlLayer" AS ENUM ('EXEC', 'OBS', 'MEASURE', 'SCALE', 'EVENT')`,
    );
    expect(CODIGO).toContain(
      `CREATE TYPE "ControlNature" AS ENUM ('SCHEDULED', 'ON_DEMAND', 'DERIVED')`,
    );
  });

  it("crea las SEIS tablas", () => {
    for (const tabla of [
      "control_types",
      "control_type_options",
      "center_control_settings",
      "center_moments",
      "care_plan_template_items",
      "care_plan_items",
    ]) {
      expect(CODIGO).toContain(`CREATE TABLE "${tabla}"`);
    }
  });
});

describe("residencia-2 · el alcance, por CHECK", () => {
  it("un `STANDARD` no tiene tenant y un `CENTER` sí · LAS DOS MITADES", () => {
    // La mitad que parece sobrar es la que sostiene el índice parcial de
    // «una vigente del centro»: un `CENTER` sin tenant se saldría de él
    // —en Postgres los NULL son distintos entre sí— y podría haber dos
    // vigentes. Misma forma que `devices_register_o_habitacion`.
    expect(CODIGO).toContain('CONSTRAINT "control_types_scope_exige_tenant"');
    expect(CODIGO).toMatch(/"scope" = 'STANDARD' AND "tenant_id" IS NULL/);
    expect(CODIGO).toMatch(/"scope" = 'CENTER'\s+AND "tenant_id" IS NOT NULL/);
  });

  it("la versión empieza en 1", () => {
    expect(CODIGO).toContain('CONSTRAINT "control_types_version_positiva"');
    expect(CODIGO).toMatch(/CHECK \("version" >= 1\)/);
  });

  it("la frecuencia de serie está entre las permitidas", () => {
    expect(CODIGO).toContain('CONSTRAINT "control_types_default_entre_permitidas"');
    expect(CODIGO).toMatch(
      /"default_frequency_kind" = ANY \("allowed_frequencies"\)/,
    );
  });

  it("ningún rango va al revés", () => {
    expect(CODIGO).toContain('CONSTRAINT "control_types_rangos_ordenados"');
  });
});

describe("residencia-2 · los SEIS índices parciales", () => {
  // La lección es la misma tres veces en este repo
  // (`ticket_allergies_mesa_key` en kds-1,
  // `care_zone_assignments_one_live_centro_key` en residencia-1, y aquí):
  // en Postgres los NULL son distintos entre sí, así que un único índice
  // sobre `(scope, tenant_id, code)` dejaría entrar dos versiones vigentes
  // de un control de serie.
  it("«una sola vigente por código» son DOS, uno por alcance", () => {
    expect(CODIGO).toContain(
      'CREATE UNIQUE INDEX "control_types_una_vigente_estandar_key"',
    );
    expect(CODIGO).toMatch(
      /"control_types_una_vigente_estandar_key"\s*\n?\s*ON "control_types"\("code"\)\s*\n?\s*WHERE "superseded_at" IS NULL AND "scope" = 'STANDARD'/,
    );
    expect(CODIGO).toContain(
      'CREATE UNIQUE INDEX "control_types_una_vigente_centro_key"',
    );
    expect(CODIGO).toMatch(
      /"control_types_una_vigente_centro_key"\s*\n?\s*ON "control_types"\("tenant_id", "code"\)\s*\n?\s*WHERE "superseded_at" IS NULL AND "scope" = 'CENTER'/,
    );
  });

  it("«una fila por (código, versión)» también son DOS, y por lo mismo", () => {
    expect(CODIGO).toContain(
      'CREATE UNIQUE INDEX "control_types_codigo_version_estandar_key"',
    );
    expect(CODIGO).toContain(
      'CREATE UNIQUE INDEX "control_types_codigo_version_centro_key"',
    );
  });

  it("como mucho UN «como siempre» por control", () => {
    // D-16: un toque en «como siempre» da por buenas todas las dimensiones
    // activas. Con dos marcadas, el toque tendría que elegir.
    expect(CODIGO).toContain(
      'CREATE UNIQUE INDEX "control_type_options_un_como_siempre_key"',
    );
    expect(CODIGO).toMatch(
      /"control_type_options_un_como_siempre_key"\s*\n?\s*ON "control_type_options"\("control_type_id"\)\s*\n?\s*WHERE "is_as_usual"/,
    );
  });

  it("UNA LÍNEA VIVA por (residente, control), y es PARCIAL", () => {
    // Parcial es lo que permite el histórico: cinco filas cerradas del
    // cambio postural y una viva. Con un índice total eso no sería «menos
    // correcto»: sería imposible, y el plan de marzo irreconstruible.
    expect(CODIGO).toContain('CREATE UNIQUE INDEX "care_plan_items_one_live_key"');
    expect(CODIGO).toMatch(
      /"care_plan_items_one_live_key"\s*\n?\s*ON "care_plan_items"\("client_id", "control_code"\)\s*\n?\s*WHERE "to_at" IS NULL/,
    );
  });
});

describe("residencia-2 · la frecuencia es coherente con su tipo", () => {
  it("el CHECK está en las CUATRO tablas que llevan frecuencia", () => {
    // Escrito cuatro veces en vez de en una función porque un CHECK con
    // una función de usuario no se valida al restaurar un `pg_dump` en el
    // orden en que Postgres restaura.
    for (const tabla of [
      "control_types",
      "center_control_settings",
      "care_plan_template_items",
      "care_plan_items",
    ]) {
      expect(CODIGO).toContain(`CONSTRAINT "${tabla}_frecuencia_coherente"`);
    }
  });

  it("y los cuatro cubren los OCHO `kind`", () => {
    for (const kind of [
      "EVERY_SHIFT",
      "DAILY",
      "MOMENTS",
      "EVERY_N_HOURS",
      "WEEKDAYS",
      "EVERY_N_DAYS",
      "MONTHLY",
      "ON_DEMAND",
    ]) {
      // Cuatro veces cada uno: una por tabla. Si alguien añade un `kind`
      // al enum y se olvida de una tabla, el `CASE` de esa tabla devuelve
      // NULL y **el CHECK pasa** — el fallo más silencioso posible.
      const veces = CODIGO.split(`WHEN '${kind}'`).length - 1;
      expect(veces, `${kind} aparece ${veces} veces y deberían ser 4`).toBe(4);
    }
  });

  it("`every_n_hours` entre 1 y 12 · y es una decisión, no validación", () => {
    // Menos de una hora no es un cuidado, es vigilancia continua; más de
    // doce es «una vez al día», que ya tiene su `kind`.
    expect(CODIGO.split('"every_n_hours" BETWEEN 1 AND 12').length - 1).toBe(3);
    expect(CODIGO).toContain('"default_every_n_hours" BETWEEN 1 AND 12');
  });

  it("`month_day` entre 1 y 28 · para que febrero no se pierda nada", () => {
    // Con el 31, un control mensual no tocaría en febrero, abril, junio,
    // septiembre ni noviembre, y nadie lo notaría hasta la auditoría.
    expect(CODIGO.split('"month_day" BETWEEN 1 AND 28').length - 1).toBe(3);
    expect(CODIGO).toContain('"default_month_day" BETWEEN 1 AND 28');
    expect(CODIGO).not.toContain("BETWEEN 1 AND 31");
  });

  it("TODO `BETWEEN` lleva su `IS NOT NULL` delante · y no sobra", () => {
    // `NULL BETWEEN 1 AND 12` no es `false`: es NULL, y un CHECK que
    // devuelve NULL **PASA**. Sin el `IS NOT NULL`, un `EVERY_N_HOURS` sin
    // horas entraba — una línea de plan que la puerta leería y no sabría
    // cuándo pedir. Lo encontró su propio sabotaje en el e2e, y esto lo
    // fija porque es invisible al leer el `CASE`.
    //
    // Misma trampa que obliga a que los arrays nazcan `NOT NULL`:
    // `cardinality(NULL)` también es NULL.
    const betweens = [...CODIGO.matchAll(/"([a-z_]+)" BETWEEN/g)].map((m) => m[1]!);
    expect(betweens.length).toBeGreaterThan(0);
    for (const col of new Set(betweens)) {
      expect(
        CODIGO,
        `«${col}» lleva BETWEEN sin IS NOT NULL delante: el CHECK daría NULL y pasaría`,
      ).toContain(`"${col}" IS NOT NULL`);
    }
  });

  it("los días de la semana están entre 1 y 7", () => {
    expect(CODIGO.split("<@ ARRAY[1,2,3,4,5,6,7]").length - 1).toBe(4);
  });
});

describe("residencia-2 · el plan de un residente", () => {
  it("`source_level` existe SI Y SÓLO SI la línea la puso una plantilla", () => {
    // Es lo que sostiene «las manuales no se tocan»: sin la segunda mitad,
    // una línea MANUAL con nivel puesto a mano la cerraría el recálculo
    // del cambio de nivel.
    expect(CODIGO).toContain('CONSTRAINT "care_plan_items_origen_coherente"');
    expect(CODIGO).toMatch(
      /"source" = 'PROFILE_TEMPLATE' AND "source_level" IS NOT NULL/,
    );
    expect(CODIGO).toMatch(/"source" = 'MANUAL'\s+AND "source_level" IS NULL/);
  });

  it("una línea no se cierra antes de abrirse", () => {
    expect(CODIGO).toContain('CONSTRAINT "care_plan_items_vigencia_ordenada"');
  });

  it("quien cierra se apunta · y la implicación va en ESE sentido", () => {
    // `closed_by` exige `to_at`, y no al revés: un cierre disparado por un
    // script no tiene usuario, y eso sigue siendo legítimo.
    expect(CODIGO).toContain('CONSTRAINT "care_plan_items_cierre_con_autor"');
    expect(CODIGO).toMatch(
      /"closed_by_user_id" IS NULL OR "to_at" IS NOT NULL/,
    );
  });

  it("el plan no se borra con el residente ni con el tenant", () => {
    // `RESTRICT` a los dos, igual que `bed_assignments`: el plan de una
    // persona es parte de lo que se conserva cinco años (D-45).
    expect(CODIGO).toMatch(
      /"care_plan_items_tenant_id_fkey"[\s\S]{0,200}ON DELETE RESTRICT/,
    );
    expect(CODIGO).toMatch(
      /"care_plan_items_client_id_fkey"[\s\S]{0,200}ON DELETE RESTRICT/,
    );
  });

  it("…y quien lo abrió o lo cerró se puede dar de baja · `SetNull`", () => {
    expect(CODIGO).toMatch(
      /"care_plan_items_created_by_user_id_fkey"[\s\S]{0,200}ON DELETE SET NULL/,
    );
    expect(CODIGO).toMatch(
      /"care_plan_items_closed_by_user_id_fkey"[\s\S]{0,200}ON DELETE SET NULL/,
    );
  });
});

describe("residencia-2 · los momentos del día", () => {
  it("la hora lleva CHECK de formato, el mismo que `center_shifts`", () => {
    // `queToca` parte la cadena por los dos puntos: un «9:00» sin cero
    // delante, o un «25:00», darían una hora que no existe y una
    // ocurrencia que la puerta pediría a una hora imposible.
    expect(CODIGO).toContain('CONSTRAINT "center_moments_hora_valida"');
    expect(CODIGO).toContain("^([01][0-9]|2[0-3]):[0-5][0-9]$");
  });
});

describe("residencia-2 · la migración es ADITIVA", () => {
  it("ni un DROP TABLE, ni un DELETE, ni un TRUNCATE, ni un UPDATE", () => {
    // Seis tablas nuevas vacías y seis tipos nuevos. **Ninguna tabla
    // existente se toca**, así que no hay scan, no hay bloqueo y ningún
    // tenant de hoy cambia de comportamiento.
    for (const peligro of ["DROP TABLE", "DELETE FROM", "TRUNCATE"]) {
      expect(CODIGO, `la migración contiene «${peligro}»`).not.toContain(peligro);
    }
    // El `UPDATE` se busca como SENTENCIA y no como palabra: las FKs
    // llevan `ON UPDATE CASCADE`, que no escribe en ninguna fila.
    expect(CODIGO).not.toMatch(/^\s*UPDATE\s/m);
    expect(CODIGO).not.toContain("DROP COLUMN");
    expect(CODIGO).not.toContain("DROP NOT NULL");
  });

  it("y no toca NINGUNA tabla de residencia-1 ni de ningún otro bloque", () => {
    // El `ALTER TABLE` sólo aparece sobre las seis tablas nuevas. Si
    // alguien añadiera aquí una columna a `resident_profiles`, esto se
    // pone rojo — y esa columna tendría que ir en su propia migración, con
    // su propio análisis de bloqueo.
    const nuevas = [
      "control_types",
      "control_type_options",
      "center_control_settings",
      "center_moments",
      "care_plan_template_items",
      "care_plan_items",
    ];
    const alteradas = [...CODIGO.matchAll(/ALTER TABLE "([a-z_]+)"/g)].map(
      (m) => m[1]!,
    );
    expect([...new Set(alteradas)].filter((t) => !nuevas.includes(t))).toEqual([]);
  });

  it("los arrays nacen NOT NULL con default `{}` · el CHECK lo necesita", () => {
    // `cardinality(NULL)` es NULL, y un CHECK que da NULL **pasa**: con
    // arrays nullables el CHECK de coherencia sería decorativo justo en
    // las filas mal escritas.
    const arrays = [
      '"allowed_frequencies" "CareFrequencyKind"[] NOT NULL DEFAULT',
      '"allowed_care_role_codes" TEXT[] NOT NULL DEFAULT',
      '"default_weekdays" INTEGER[] NOT NULL DEFAULT',
      '"default_shift_codes" TEXT[] NOT NULL DEFAULT',
      '"default_moment_codes" TEXT[] NOT NULL DEFAULT',
    ];
    for (const a of arrays) expect(CODIGO).toContain(a);
    // Y los de las otras tres tablas: `weekdays`, `shift_codes` y
    // `moment_codes`, tres veces cada uno.
    expect(CODIGO.split('"weekdays" INTEGER[] NOT NULL DEFAULT').length - 1).toBe(3);
    expect(CODIGO.split('"shift_codes" TEXT[] NOT NULL DEFAULT').length - 1).toBe(3);
    expect(CODIGO.split('"moment_codes" TEXT[] NOT NULL DEFAULT').length - 1).toBe(3);
  });
});

describe("residencia-2 · el `down` está escrito", () => {
  it("y es COMPLETO, al contrario que el de residencia-1", () => {
    // Aquí no se añade ningún valor a un enum existente, y `DROP TYPE` de
    // un tipo propio sí existe en Postgres (lo que no existe es
    // `ALTER TYPE … DROP VALUE`). Así que el `down` revierte entero.
    expect(SQL).toContain("EL `down`, PENSADO");
    for (const tabla of [
      "care_plan_items",
      "care_plan_template_items",
      "center_moments",
      "center_control_settings",
      "control_type_options",
      "control_types",
    ]) {
      expect(SQL).toContain(`--   DROP TABLE "${tabla}";`);
    }
    for (const tipo of [
      "CarePlanItemSource",
      "CareFrequencyKind",
      "ControlScope",
      "ControlValueDomain",
      "ControlNature",
      "ControlLayer",
    ]) {
      expect(SQL).toContain(`--   DROP TYPE "${tipo}";`);
    }
  });
});
