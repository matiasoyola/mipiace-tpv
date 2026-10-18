// residencia-5 · EL CONTRATO DEL SQL, leído del fichero.
//
// Hermano de `residencia-3-migracion.test.ts` y `residencia-4-migracion.test.ts`
// y con el mismo encargo: no prueba «que la migración corra» —eso lo hace
// el e2e, que la aplica— sino **lo que la migración PROMETE**, y que no se
// le escape nada el día que alguien la toque.
//
//   · que es ADITIVA salvo los dos CHECK que sustituye, y que los nuevos
//     son MÁS ANCHOS que los que quitan (si no lo fueran, el
//     `ADD CONSTRAINT` podría rechazar una fila de producción al hacer su
//     scan);
//   · que `HANDOVER` va en SU PROPIA migración, porque Postgres prohíbe
//     usar un valor de enum en la transacción en la que se añade;
//   · que el trigger de `handovers` compara **las diez columnas
//     inmutables**, una por una y por su nombre;
//   · que las cuatro tablas hijas del relevo son append-only **sin
//     escapatoria**, zonas incluidas;
//   · que «una zona por parte» son DOS índices parciales, porque en
//     Postgres los NULL son distintos entre sí;
//   · que una obligación hecha no vuelve a pendiente sin corrección
//     firmada;
//   · que cada rango de la periodicidad lleva su `IS NOT NULL` delante
//     (un CHECK que da NULL **pasa**);
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
  join(RAIZ, "20261019000000_residencia_5_tipos", "migration.sql"),
  "utf8",
);
const RELEVO = readFileSync(
  join(RAIZ, "20261019010000_residencia_5_relevo_y_obligaciones", "migration.sql"),
  "utf8",
);

/** El SQL sin comentarios: el `down` va comentado en la cabecera y lleva
 *  `DROP TABLE` y `DELETE FROM` dentro. */
function soloSql(texto: string): string {
  return texto
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("--"))
    .join("\n");
}

const SQL_TIPOS = soloSql(TIPOS);
const SQL = soloSql(RELEVO);

// ── 1 · Aditiva ──────────────────────────────────────────────────────

describe("las dos migraciones son ADITIVAS", () => {
  it("ni un DROP TABLE, ni un DELETE, ni un TRUNCATE", () => {
    for (const [nombre, sql] of [
      ["tipos", SQL_TIPOS],
      ["relevo", SQL],
    ] as const) {
      expect(sql, nombre).not.toMatch(/\bDROP\s+TABLE\b/i);
      expect(sql, nombre).not.toMatch(/\bDROP\s+COLUMN\b/i);
      expect(sql, nombre).not.toMatch(/\bTRUNCATE\b/i);
      expect(sql, nombre).not.toMatch(/\bDELETE\s+FROM\b/i);
    }
  });

  it("los únicos `ALTER TABLE` sobre tablas que YA tenían filas son dos", () => {
    // Un `ALTER TABLE` sobre una tabla con filas de producción es lo
    // único de esta migración que puede romper algo. Se enumeran para que
    // añadir uno tercero obligue a venir aquí y a pensarlo.
    const tablas = new Set(
      [...SQL.matchAll(/ALTER\s+TABLE\s+"([a-z_]+)"/gi)].map((m) => m[1]!),
    );
    const delBloque = new Set([
      "handovers",
      "handover_zones",
      "handover_acks",
      "handover_ack_zones",
      "handover_late_additions",
      "management_duties",
      "duty_occurrences",
      "indicator_targets",
    ]);
    const ajenas = [...tablas].filter((t) => !delBloque.has(t)).sort();
    expect(ajenas).toEqual(["devices", "pairing_codes"]);
  });

  it("los dos CHECK que se sustituyen son MÁS ANCHOS que los que quitan", () => {
    // Lo que antes pasaba sigue pasando, y además pasa un `HANDOVER`. Si
    // el nuevo fuera más estrecho, el scan del `ADD CONSTRAINT`
    // rechazaría una fila de producción y la migración fallaría a mitad.
    for (const tabla of ["devices", "pairing_codes"]) {
      expect(SQL).toContain(
        `ALTER TABLE "${tabla}" DROP CONSTRAINT "${
          tabla === "devices"
            ? "devices_register_o_habitacion"
            : "pairing_codes_register_o_habitacion"
        }"`,
      );
    }
    // Las tres ramas de residencia-4 siguen, y hay una cuarta.
    expect(SQL).toMatch(/"kind" = 'ROOM'\s+AND "room_id" IS NOT NULL/);
    expect(SQL).toMatch(/"kind" = 'GUARD'\s+AND "room_id" IS NULL/);
    expect(SQL).toMatch(/"kind" = 'HANDOVER' AND "room_id" IS NULL/);
    expect(SQL).toMatch(/NOT IN \('ROOM', 'GUARD', 'HANDOVER'\)/);
  });

  it("y el CHECK del canal de guardia NO se toca", () => {
    // Dice «`kind = GUARD` exige canal y todo lo demás lo prohíbe», así
    // que una tablet de sala con canal **ya estaba rechazada**. Tocarlo
    // habría sido relajar lo que no hacía falta.
    expect(SQL).not.toContain("devices_guard_canal");
    expect(SQL).not.toContain("pairing_codes_guard_canal");
  });
});

// ── 2 · El valor del enum va aparte ──────────────────────────────────

describe("`HANDOVER` va en su propia migración", () => {
  it("la primera sólo añade el valor del enum", () => {
    expect(SQL_TIPOS).toContain(
      `ALTER TYPE "DeviceKind" ADD VALUE IF NOT EXISTS 'HANDOVER'`,
    );
    // Y NADA más: ni una tabla, ni un CHECK. Postgres prohíbe usar el
    // valor en la misma transacción en la que se añade.
    expect(SQL_TIPOS).not.toMatch(/\bCREATE\s+TABLE\b/i);
    expect(SQL_TIPOS).not.toMatch(/\bADD\s+CONSTRAINT\b/i);
  });

  it("y la segunda SÍ lo usa, que es la razón de que estén separadas", () => {
    expect(SQL).toContain("'HANDOVER'");
    expect(SQL).not.toMatch(/ALTER\s+TYPE\s+"DeviceKind"/i);
  });
});

// ── 3 · Las ocho tablas y sus CHECK ──────────────────────────────────

describe("las ocho tablas nuevas", () => {
  it.each([
    "handovers",
    "handover_zones",
    "handover_acks",
    "handover_ack_zones",
    "handover_late_additions",
    "management_duties",
    "duty_occurrences",
    "indicator_targets",
  ])("%s se crea", (tabla) => {
    expect(SQL).toContain(`CREATE TABLE "${tabla}"`);
  });

  it("y los cinco tipos", () => {
    for (const tipo of [
      "DutyFamily",
      "DutyPeriodicity",
      "DutyConsequence",
      "IndicatorComparison",
      "HandoverLateKind",
    ]) {
      expect(SQL).toContain(`CREATE TYPE "${tipo}" AS ENUM`);
    }
  });

  it("el contenido del parte NO admite claro", () => {
    // El CHECK de formato de las veinticuatro columnas cifradas de la
    // casa: `~ '^c[0-9]+:…'`. El claro no cabe.
    expect(SQL).toContain('"handovers_content_cifrado_formato"');
    expect(SQL).toContain('"handover_late_additions_resumen_cifrado_formato"');
    const formatos = [...SQL.matchAll(/~ '\^c\[0-9\]\+:/g)];
    expect(formatos).toHaveLength(2);
  });

  it("un parte «sin novedades» con líneas NO entra", () => {
    // Es lo que la pantalla de reposo de la sala pone: «Turno sin
    // novedades». Un parte que dijera eso con nueve líneas mentiría ahí.
    expect(SQL).toMatch(
      /"sin_novedades" = false OR "lineas" = 0/,
    );
  });

  it("una zona SIN contenido no es una zona del parte", () => {
    expect(SQL).toContain('"handover_zones_con_contenido"');
    expect(SQL).toMatch(/CHECK \("lineas" > 0\)/);
  });

  it("un añadido tardío apunta a EXACTAMENTE una fuente", () => {
    expect(SQL).toContain('"handover_late_additions_fuente_coherente"');
    for (const kind of ["CARE_RECORD", "INCIDENT", "GUARD_ALERT"]) {
      expect(SQL).toContain(`"kind" = '${kind}'`);
    }
  });

  it("y llegó DESPUÉS de que pasara", () => {
    expect(SQL).toMatch(/"arrived_at" >= "occurred_at"/);
  });
});

// ── 4 · «Una por zona» son DOS índices ───────────────────────────────

describe("la unicidad de las zonas del parte", () => {
  it("son DOS índices parciales, no un `UNIQUE` de dos columnas", () => {
    // En Postgres los NULL son distintos entre sí, así que un único
    // `UNIQUE(handover_id, floor_id)` dejaría entrar DOS filas «del
    // centro» en el mismo parte. **Quinta vez** que esta lección se paga
    // en este repo.
    expect(SQL).toContain('"handover_zones_una_por_planta_key"');
    expect(SQL).toContain('"handover_zones_una_del_centro_key"');
    expect(SQL).toMatch(
      /handover_zones_una_por_planta_key"\s*\n\s*ON "handover_zones"\("handover_id", "floor_id"\)\s*\n\s*WHERE "floor_id" IS NOT NULL/,
    );
    expect(SQL).toMatch(
      /handover_zones_una_del_centro_key"\s*\n\s*ON "handover_zones"\("handover_id"\)\s*\n\s*WHERE "floor_id" IS NULL/,
    );
  });

  it("y los tres de los añadidos tardíos, también parciales", () => {
    for (const [nombre, columna] of [
      ["handover_late_additions_un_registro_key", "care_record_id"],
      ["handover_late_additions_una_incidencia_key", "incident_id"],
      ["handover_late_additions_un_aviso_key", "guard_alert_id"],
    ] as const) {
      expect(SQL).toContain(`"${nombre}"`);
      expect(SQL).toContain(`WHERE "${columna}" IS NOT NULL`);
    }
  });

  it("un parte por centro, turno y día: la idempotencia de la pasada", () => {
    expect(SQL).toContain(
      'CREATE UNIQUE INDEX "handovers_tenant_id_center_shift_id_care_day_key"',
    );
  });

  it("y una confirmación por persona y parte: confirmar dos veces no duplica", () => {
    expect(SQL).toContain(
      'CREATE UNIQUE INDEX "handover_acks_handover_id_user_id_key"',
    );
  });

  it("y una ocurrencia por obligación y día", () => {
    expect(SQL).toContain('CREATE UNIQUE INDEX "duty_occurrences_una_por_dia_key"');
  });
});

// ── 5 · El trigger de inmutabilidad del parte ────────────────────────

describe("un parte congelado no se edita ni se borra", () => {
  const fn = SQL.slice(
    SQL.indexOf("CREATE FUNCTION mipiacetpv_handovers_inmutable"),
    SQL.indexOf('CREATE TRIGGER "handovers_inmutable"'),
  );

  it("el `DELETE` no tiene escapatoria", () => {
    expect(fn).toMatch(/IF TG_OP = 'DELETE' THEN/);
    expect(fn).toContain("un parte de relevo congelado no se borra");
    // Y ni una rama que lo permita «si el padre se borró», al revés que
    // los triggers de S1 y F1: las diez FKs son `RESTRICT`.
    expect(fn).not.toMatch(/EXISTS\s*\(/i);
  });

  it("las DIEZ columnas inmutables se comparan una por una y por su nombre", () => {
    // Y no con `row(NEW.*) IS DISTINCT FROM row(OLD.*)`, que habría
    // dejado pasar en silencio cualquier columna añadida después. Con
    // esto, el día que la tabla gane una, este test se pone rojo.
    const columnas = [
      "id",
      "tenant_id",
      "center_shift_id",
      "care_day",
      "generated_at",
      "frozen_at",
      "content_cifrado",
      "lineas",
      "sin_novedades",
      "created_at",
    ];
    for (const c of columnas) {
      expect(fn, c).toContain(`NEW.${c}`);
      expect(fn, c).toContain(`OLD.${c}`);
    }
    expect(fn).not.toMatch(/row\(NEW\.\*\)/);
    // La ÚNICA que puede cambiar: `confirmed_at`, y sólo de NULL a
    // puesta.
    const comparadas = [...fn.matchAll(/NEW\.([a-z_]+)\s+IS DISTINCT FROM/g)].map(
      (m) => m[1]!,
    );
    expect(comparadas.filter((c) => c !== "confirmed_at").sort()).toEqual(
      [...columnas].sort(),
    );
  });

  it("des-confirmar tampoco", () => {
    expect(fn).toMatch(/OLD\.confirmed_at IS NOT NULL/);
    expect(fn).toContain("una confirmación no se retira");
  });
});

// ── 6 · Las cuatro append-only ───────────────────────────────────────

describe("las cuatro tablas hijas del relevo son append-only", () => {
  it("una sola función para las cuatro, sin escapatoria", () => {
    const fn = SQL.slice(
      SQL.indexOf("CREATE FUNCTION mipiacetpv_handover_append_only"),
      SQL.indexOf('CREATE TRIGGER "handover_zones_append_only"'),
    );
    expect(fn).toMatch(/IF TG_OP = 'UPDATE' THEN/);
    expect(fn).toContain("no se edita");
    expect(fn).toContain("no se borra");
    // Sin un solo `RETURN NEW`: no hay camino por el que pase nada.
    expect(fn).not.toContain("RETURN NEW");
  });

  it("y las cuatro tienen su trigger", () => {
    for (const tabla of [
      "handover_zones",
      "handover_acks",
      "handover_ack_zones",
      "handover_late_additions",
    ]) {
      expect(SQL).toContain(`CREATE TRIGGER "${tabla}_append_only"`);
      expect(SQL).toMatch(
        new RegExp(`BEFORE UPDATE OR DELETE ON "${tabla}"`),
      );
    }
  });

  it("las ZONAS también, y no es obvio", () => {
    // Borrar una fila de `handover_zones` haría que un parte con
    // contenido en dos plantas pareciera tener contenido en una, y
    // entonces una confirmación de esa planta lo daría por confirmado
    // entero.
    expect(SQL).toContain('CREATE TRIGGER "handover_zones_append_only"');
  });
});

// ── 7 · Una obligación hecha no vuelve a pendiente ───────────────────

describe("una obligación hecha no vuelve a pendiente sin corrección firmada", () => {
  const fn = SQL.slice(
    SQL.indexOf("CREATE FUNCTION mipiacetpv_duty_occurrences_hecha_no_vuelve"),
    SQL.indexOf('CREATE TRIGGER "duty_occurrences_hecha_no_vuelve"'),
  );

  it("la transición de hecha a pendiente exige las TRES columnas", () => {
    expect(fn).toMatch(/OLD\.done_at IS NOT NULL AND NEW\.done_at IS NULL/);
    expect(fn).toContain("NEW.corrected_at IS NULL");
    expect(fn).toContain("NEW.corrected_by_user_id IS NULL");
    expect(fn).toContain("NEW.correction_reason IS NULL");
  });

  it("y el día que toca no se mueve", () => {
    expect(fn).toContain("NEW.due_on IS DISTINCT FROM OLD.due_on");
    expect(fn).toContain("NEW.duty_id IS DISTINCT FROM OLD.duty_id");
  });

  it("hecha es las TRES cosas o ninguna", () => {
    expect(SQL).toContain('"duty_occurrences_hecha_completa"');
    expect(SQL).toContain('"duty_occurrences_correccion_completa"');
  });

  it("y una evidencia sólo cuelga de algo hecho", () => {
    expect(SQL).toContain('"duty_occurrences_evidencia_exige_hecha"');
    expect(SQL).toMatch(
      /CHECK \("evidence_file_name" IS NULL OR "done_at" IS NOT NULL\)/,
    );
  });

  it("y la evidencia son las CUATRO columnas o ninguna", () => {
    expect(SQL).toContain('"duty_occurrences_evidencia_completa"');
  });
});

// ── 8 · Los rangos llevan su IS NOT NULL delante ─────────────────────

describe("el CHECK de la periodicidad", () => {
  const check = SQL.slice(
    SQL.indexOf('"management_duties_periodicidad_coherente"'),
    SQL.indexOf('"management_duties_responsable"'),
  );

  it("las siete periodicidades están", () => {
    for (const p of [
      "DAILY",
      "WEEKLY",
      "MONTHLY",
      "QUARTERLY",
      "ANNUAL",
      "FIVE_YEARLY",
      "VALIDITY",
    ]) {
      expect(check, p).toContain(`"periodicity" = '${p}'`);
    }
  });

  it("CADA `BETWEEN` lleva su `IS NOT NULL` delante", () => {
    // Lección de la casa: **un CHECK que da NULL pasa**. Un `BETWEEN`
    // sobre una columna NULL da NULL, así que el CHECK no rechaza nada —
    // y aquí hay cuatro columnas nullable donde pagarlo.
    //
    // Se comprueba sobre el texto: cada `"col" BETWEEN` tiene que venir
    // precedido por `"col" IS NOT NULL AND`.
    const betweens = [...check.matchAll(/"([a-z_]+)" BETWEEN/g)].map((m) => m[1]!);
    expect(betweens.length).toBeGreaterThan(5);
    for (const col of new Set(betweens)) {
      const sueltos = [
        ...check.matchAll(new RegExp(`"${col}" BETWEEN`, "g")),
      ].length;
      const protegidos = [
        ...check.matchAll(
          new RegExp(`"${col}" IS NOT NULL\\s*\\n?\\s*AND "${col}" BETWEEN`, "g"),
        ),
      ].length;
      expect(protegidos, `${col}: ${protegidos} de ${sueltos}`).toBe(sueltos);
    }
  });

  it("y la fecha de vigencia lleva su formato", () => {
    expect(check).toMatch(/"valid_until" ~ '\^\[0-9\]\{4\}/);
  });

  it("exactamente UN responsable de los tres", () => {
    expect(SQL).toContain('"management_duties_responsable"');
    expect(SQL).toMatch(/CASE WHEN "responsible_care_role_id" IS NOT NULL/);
    expect(SQL).toMatch(/= 1\s*\n\s*\);/);
  });
});

// ── 9 · Lo que sostiene la evidencia es RESTRICT ─────────────────────

describe("las FKs del relevo son RESTRICT", () => {
  it.each([
    ["handovers", "tenant_id"],
    ["handovers", "center_shift_id"],
    ["handover_zones", "handover_id"],
    ["handover_zones", "floor_id"],
    ["handover_acks", "handover_id"],
    ["handover_acks", "user_id"],
    ["handover_acks", "care_role_assignment_id"],
    ["handover_acks", "device_id"],
    ["handover_ack_zones", "ack_id"],
    ["handover_late_additions", "care_record_id"],
  ])("%s.%s", (tabla, columna) => {
    const i = SQL.indexOf(`"${tabla}_${columna}_fkey"`);
    expect(i, `${tabla}.${columna}`).toBeGreaterThan(0);
    const trozo = SQL.slice(i, i + 400);
    expect(trozo, `${tabla}.${columna}`).toContain("ON DELETE RESTRICT");
  });

  it("y las de las OBLIGACIONES son `CASCADE`, que es otra decisión", () => {
    // Las obligaciones son la agenda de la dirección del centro, no datos
    // de salud: se van con el centro. Lo que NO se puede es mentir sobre
    // si estaban hechas, y eso lo sostiene el trigger.
    const i = SQL.indexOf('"management_duties_tenant_id_fkey"');
    expect(SQL.slice(i, i + 300)).toContain("ON DELETE CASCADE");
    const j = SQL.indexOf('"duty_occurrences_duty_id_fkey"');
    expect(SQL.slice(j, j + 300)).toContain("ON DELETE CASCADE");
  });

  it("pero quién la HIZO es `RESTRICT`: es la firma", () => {
    const i = SQL.indexOf('"duty_occurrences_done_by_user_id_fkey"');
    expect(SQL.slice(i, i + 300)).toContain("ON DELETE RESTRICT");
  });

  it("y el responsable también, porque un `SET NULL` rompería su CHECK", () => {
    // Un `SET NULL` dejaría la fila sin ningún responsable y el CHECK
    // `management_duties_responsable` —que exige exactamente uno— lo
    // rechazaría al ejecutarse. Es la clase de promesa que un `SET NULL`
    // no puede cumplir cuando hay un CHECK encima.
    const i = SQL.indexOf('"management_duties_responsible_user_id_fkey"');
    expect(SQL.slice(i, i + 300)).toContain("ON DELETE RESTRICT");
  });
});

// ── 10 · Los índices parciales del panel ─────────────────────────────

describe("los índices que sostienen el panel", () => {
  it("«los relevos sin confirmar» es parcial", () => {
    expect(SQL).toContain('CREATE INDEX "handovers_sin_confirmar_idx"');
    expect(SQL).toMatch(
      /handovers_sin_confirmar_idx"\s*\n\s*ON "handovers"\("tenant_id", "care_day"\)\s*\n\s*WHERE "confirmed_at" IS NULL/,
    );
  });

  it("«qué toca hoy y qué está vencido» también", () => {
    expect(SQL).toContain('CREATE INDEX "duty_occurrences_pendientes_idx"');
    expect(SQL).toContain('WHERE "done_at" IS NULL');
  });

  it("y el nombre de una obligación es único entre las VIVAS", () => {
    expect(SQL).toContain('CREATE UNIQUE INDEX "management_duties_nombre_key"');
    expect(SQL).toMatch(/management_duties_nombre_key"[\s\S]{0,120}WHERE "active"/);
  });
});

// ── 11 · El `down` está escrito ──────────────────────────────────────

describe("el `down` está en la cabecera de las dos", () => {
  it("el de los tipos dice que NO HAY, y por qué", () => {
    expect(TIPOS).toContain("**No hay.**");
    expect(TIPOS).toContain("no sabe quitar un valor de un enum");
  });

  it("el del relevo tira las ocho tablas, los triggers y los tipos", () => {
    for (const tabla of [
      "indicator_targets",
      "duty_occurrences",
      "management_duties",
      "handover_late_additions",
      "handover_ack_zones",
      "handover_acks",
      "handover_zones",
      "handovers",
    ]) {
      expect(RELEVO).toContain(tabla);
    }
    expect(RELEVO).toContain("DROP TRIGGER");
    expect(RELEVO).toContain("DROP FUNCTION");
    expect(RELEVO).toContain("DROP TYPE");
    // Y dice lo que NO se puede deshacer.
    expect(RELEVO).toContain("mientras no haya un solo parte congelado");
  });
});
