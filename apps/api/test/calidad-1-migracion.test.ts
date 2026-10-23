// calidad-1 · EL CONTRATO DEL SQL, leído del fichero.
//
// Hermano de `residencia-4-migracion.test.ts` y
// `residencia-5-migracion.test.ts`, con el mismo encargo: no prueba «que
// la migración corra» —eso lo hace el e2e, que la aplica— sino **lo que
// la migración PROMETE**, y que no se le escape nada el día que alguien
// la toque.
//
//   · que es ADITIVA DEL TODO: ni un `ALTER TABLE` sobre una tabla que
//     ya tenía filas, que es la primera migración de residencia que lo
//     consigue;
//   · que los siete tipos se crean y se usan en la MISMA migración, y
//     que no hay ni un `ALTER TYPE … ADD VALUE` (que es lo que obligaría
//     a partirla en dos, como pasó tres veces en residencia-3, -4 y -5);
//   · que **las cuatro FKs que cierran la NC 01 son `NOT NULL` y
//     `RESTRICT`** — es la promesa entera del bloque;
//   · que la causa es obligatoria para una NC mayor o menor por CHECK, y
//     opcional para una observación;
//   · que **cerrar sin verificación de eficacia lo para el TRIGGER**, no
//     la ruta, y que el trigger mira la otra tabla;
//   · que la eficacia la firma otra persona, también en el trigger;
//   · que el nivel de un riesgo no se puede escribir a mano con otro
//     número, y que cada rango lleva su `IS NOT NULL` delante (un CHECK
//     que da NULL **pasa**);
//   · y que las cinco columnas cifradas llevan su CHECK de formato.

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

const CRUDO = readFileSync(
  join(RAIZ, "20261022000000_calidad_1_mapa_riesgos_y_nc", "migration.sql"),
  "utf8",
);

/** El SQL sin comentarios: el `down` va comentado en la cabecera y lleva
 *  `DROP TABLE` dentro. */
function soloSql(texto: string): string {
  return texto
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("--"))
    .join("\n");
}

const SQL = soloSql(CRUDO);

const TABLAS = [
  "processes",
  "indicator_processes",
  "risk_opportunities",
  "quality_objectives",
  "non_conformities",
  "corrective_actions",
  "corrective_action_evidences",
  "effectiveness_verifications",
];

// ── 1 · Aditiva, y del todo ──────────────────────────────────────────

describe("la migración es ADITIVA del todo", () => {
  it("ni un DROP, ni un DELETE, ni un TRUNCATE", () => {
    expect(SQL).not.toMatch(/\bDROP\s+TABLE\b/i);
    expect(SQL).not.toMatch(/\bDROP\s+COLUMN\b/i);
    expect(SQL).not.toMatch(/\bDROP\s+CONSTRAINT\b/i);
    expect(SQL).not.toMatch(/\bTRUNCATE\b/i);
    expect(SQL).not.toMatch(/\bDELETE\s+FROM\b/i);
  });

  it("y NINGÚN `ALTER TABLE` sobre una tabla de antes", () => {
    // Es la primera migración de residencia que no toca una sola tabla
    // con filas de producción. Si alguien añade una, este test se pone
    // rojo y le obliga a venir aquí a decir por qué.
    const tablas = new Set(
      [...SQL.matchAll(/ALTER\s+TABLE\s+"([a-z_]+)"/gi)].map((m) => m[1]!),
    );
    const ajenas = [...tablas].filter((t) => !TABLAS.includes(t)).sort();
    expect(ajenas).toEqual([]);
  });

  it("las ocho tablas del bloque se crean aquí", () => {
    for (const t of TABLAS) {
      expect(SQL, t).toContain(`CREATE TABLE "${t}"`);
    }
  });
});

// ── 2 · Los tipos, en la MISMA migración ─────────────────────────────

describe("los siete tipos se crean y se usan aquí mismo", () => {
  it("los siete son CREATE TYPE, ninguno ALTER TYPE", () => {
    // Postgres sólo prohíbe usar un valor de enum en la transacción en
    // que se AÑADE a un tipo que ya existía. Crear el tipo entero y
    // usarlo acto seguido es legal, y por eso este bloque no paga la
    // factura que pagaron residencia-3, -4 y -5.
    for (const t of [
      "ProcessType",
      "RiskKind",
      "NonConformityKind",
      "NonConformityOrigin",
      "NonConformityState",
      "VerificationResult",
      "QualityObjectiveStatus",
    ]) {
      expect(SQL, t).toMatch(new RegExp(`CREATE TYPE "${t}" AS ENUM`));
    }
    expect(SQL).not.toMatch(/ALTER\s+TYPE/i);
  });

  it("y el código de un indicador NO es un tipo", () => {
    // D-11 llevado al panel: un indicador nuevo en 2028 es una fila del
    // fichero de datos del producto, no una migración.
    expect(SQL).not.toMatch(/CREATE TYPE "Indicator(Code|Kind)"/);
    expect(SQL).toMatch(/"code"\s+TEXT\s+NOT NULL/);
  });
});

// ── 3 · LAS CUATRO FKs QUE CIERRAN LA NC 01 ──────────────────────────

describe("todo lo de calidad cuelga de un proceso, NOT NULL y RESTRICT", () => {
  const HIJOS = [
    "indicator_processes",
    "risk_opportunities",
    "quality_objectives",
    "non_conformities",
  ];

  it("las cuatro declaran `process_id UUID NOT NULL`", () => {
    for (const t of HIJOS) {
      const tabla = SQL.slice(
        SQL.indexOf(`CREATE TABLE "${t}"`),
        SQL.indexOf(`CREATE TABLE "${t}"`) + 2500,
      );
      expect(tabla, t).toMatch(/"process_id"\s+UUID\s+NOT NULL/);
    }
  });

  it("y las cuatro FKs son `ON DELETE RESTRICT`", () => {
    // Es la promesa entera del bloque: un proceso con algo colgando no
    // se borra, y no hay ninguna otra lista de procesos donde escribir
    // el segundo mapa.
    for (const t of HIJOS) {
      const re = new RegExp(
        `ADD CONSTRAINT "${t}_process_id_fkey"[\\s\\S]{0,200}?ON DELETE RESTRICT`,
      );
      expect(SQL, t).toMatch(re);
    }
  });

  it("el responsable de un proceso es un ROL, y también RESTRICT", () => {
    expect(SQL).toMatch(/"responsible_care_role_id"\s+UUID\s+NOT NULL/);
    expect(SQL).toMatch(
      /ADD CONSTRAINT "processes_responsible_care_role_id_fkey"[\s\S]{0,200}?ON DELETE RESTRICT/,
    );
  });

  it("y cargar el mapa dos veces no lo duplica: índice único por referencia", () => {
    expect(SQL).toContain(
      'CREATE UNIQUE INDEX "processes_tenant_id_reference_code_key"',
    );
  });
});

// ── 4 · Las dos puertas del ciclo, en el MOTOR ───────────────────────

describe("el ciclo de la NC lo guarda el motor, no la ruta", () => {
  it("una NC mayor o menor no sale de OPEN sin causa (CHECK)", () => {
    const check = SQL.slice(
      SQL.indexOf('"non_conformities_causa_antes_de_acciones"'),
    ).slice(0, 400);
    expect(check).toContain(`"state" = 'OPEN'`);
    // La escapatoria declarada: una observación y una oportunidad de
    // mejora NO exigen causa (D-73).
    expect(check).toContain(`'OBSERVATION', 'IMPROVEMENT'`);
    expect(check).toContain(`"cause_cifrado" IS NOT NULL`);
  });

  it("**no se cierra sin una verificación EFFECTIVE**, y lo mira el trigger", () => {
    // Es la fila de la tabla de sabotajes que había que contestar: una
    // regla que mira OTRA tabla no cabe en un CHECK, así que baja a un
    // trigger. Dejarla sólo en la ruta sería dejar la evidencia de la
    // mejora a merced de un `UPDATE`.
    const fn = SQL.slice(
      SQL.indexOf("CREATE FUNCTION mipiacetpv_non_conformities_inmutable"),
    ).slice(0, 4000);
    expect(fn).toContain(`FROM "effectiveness_verifications"`);
    expect(fn).toContain(`v."result" = 'EFFECTIVE'`);
    expect(fn).toMatch(/NEW\.state = 'CLOSED' AND OLD\.state <> 'CLOSED'/);
  });

  it("y la eficacia la firma OTRA persona, también en el motor", () => {
    const fn = SQL.slice(
      SQL.indexOf("CREATE FUNCTION mipiacetpv_verificacion_otra_persona"),
    ).slice(0, 2500);
    expect(fn).toContain(`FROM "corrective_actions" a`);
    expect(fn).toContain("ultimo_cierre = NEW.by_user_id");
    // Y exige que haya al menos una acción cerrada: no se verifica la
    // eficacia de lo que no se ha hecho.
    expect(fn).toContain("ultimo_cierre IS NULL");
    expect(SQL).toContain(
      'CREATE TRIGGER "effectiveness_verifications_otra_persona"\n    BEFORE INSERT ON "effectiveness_verifications"',
    );
  });

  it("y el estado y el cierre no se pueden contradecir", () => {
    expect(SQL).toContain('"non_conformities_cerrada_coherente"');
    expect(SQL).toContain('"non_conformities_cierre_completo"');
  });
});

// ── 5 · Inmutabilidad y append-only ──────────────────────────────────

describe("lo que no se cambia ni por SQL", () => {
  it("el trigger de la NC compara las catorce columnas, una por una", () => {
    // Un `row(NEW.*) IS DISTINCT FROM row(OLD.*)` habría sido más corto
    // y habría dejado pasar en silencio cualquier columna añadida
    // después. Con esto, el día que la tabla gane una, este test se
    // pone rojo y recuerda por qué.
    const fn = SQL.slice(
      SQL.indexOf("CREATE FUNCTION mipiacetpv_non_conformities_inmutable"),
    ).slice(0, 4000);
    for (const col of [
      "id",
      "tenant_id",
      "reference",
      "kind",
      "origin",
      "detected_on",
      "description_cifrado",
      "source_incident_id",
      "source_indicator_code",
      "source_indicator_month",
      "opened_at",
      "opened_by_user_id",
      "opened_by_care_role_assignment_id",
      "created_at",
    ]) {
      expect(fn, col).toContain(`NEW.${col}`);
    }
    expect(fn).not.toMatch(/row\(NEW\.\*\)/);
    // Y lo que SÍ puede cambiar no está en la lista: el estado, la
    // causa (una vez), el proceso (reasignar) y el cierre.
    expect(fn).not.toContain("NEW.state                                 IS DISTINCT");
    expect(fn).not.toContain("NEW.process_id");
  });

  it("la causa se escribe UNA vez", () => {
    const fn = SQL.slice(
      SQL.indexOf("CREATE FUNCTION mipiacetpv_non_conformities_inmutable"),
    ).slice(0, 4000);
    expect(fn).toContain("OLD.cause_cifrado IS NOT NULL");
  });

  it("una NC cerrada no se reabre", () => {
    const fn = SQL.slice(
      SQL.indexOf("CREATE FUNCTION mipiacetpv_non_conformities_inmutable"),
    ).slice(0, 4000);
    expect(fn).toContain("OLD.state = 'CLOSED'");
  });

  it("una acción se escribe y se cierra, nada más", () => {
    const fn = SQL.slice(
      SQL.indexOf("CREATE FUNCTION mipiacetpv_corrective_actions_append_only"),
    ).slice(0, 3000);
    expect(fn).toContain("NEW.what_cifrado");
    expect(fn).toContain("NEW.due_on");
    expect(fn).toContain("OLD.closed_at IS NOT NULL");
  });

  it("evidencias y verificaciones son append-only SIN escapatoria", () => {
    // Ni `UPDATE` ni `DELETE`, ninguno: la función no mira nada, lanza.
    const fn = SQL.slice(
      SQL.indexOf("CREATE FUNCTION mipiacetpv_calidad_append_only"),
    ).slice(0, 1200);
    expect(fn).toContain("RAISE EXCEPTION");
    expect(fn).not.toContain("RETURN NEW");
    for (const t of [
      "corrective_action_evidences",
      "effectiveness_verifications",
    ]) {
      expect(SQL, t).toContain(
        `CREATE TRIGGER "${t}_append_only"\n    BEFORE UPDATE OR DELETE ON "${t}"`,
      );
    }
  });

  it("y una NC no se borra", () => {
    const fn = SQL.slice(
      SQL.indexOf("CREATE FUNCTION mipiacetpv_non_conformities_inmutable"),
    ).slice(0, 4000);
    expect(fn).toMatch(/TG_OP = 'DELETE'[\s\S]{0,300}RAISE EXCEPTION/);
  });
});

// ── 6 · Los CHECK de los números y de lo cifrado ─────────────────────

describe("los CHECK que sujetan los números", () => {
  it("el nivel de un riesgo NO se puede escribir con otro número", () => {
    const check = SQL.slice(
      SQL.indexOf('"risk_opportunities_nivel_coherente"'),
    ).slice(0, 400);
    expect(check).toContain(`"level" = "probability" * "impact"`);
  });

  it("y cada rango lleva su `IS NOT NULL` delante", () => {
    // La regla de la casa desde residencia-5: **un CHECK que da NULL
    // PASA**. Aunque las columnas sean `NOT NULL` hoy, el día que
    // alguien relaje el `NOT NULL` el rango tiene que seguir sujetando.
    for (const c of [
      "risk_opportunities_probabilidad_1_3",
      "risk_opportunities_impacto_1_3",
      "risk_opportunities_nivel_coherente",
      "quality_objectives_anio_razonable",
    ]) {
      const check = SQL.slice(SQL.indexOf(`"${c}"`)).slice(0, 400);
      expect(check, c).toContain("IS NOT NULL");
    }
  });

  it("una acción lleva EXACTAMENTE un responsable", () => {
    const check = SQL.slice(
      SQL.indexOf('"corrective_actions_responsable"'),
    ).slice(0, 500);
    expect(check).toContain("= 1");
    expect(check).toContain("responsible_care_role_id");
    expect(check).toContain("responsible_user_id");
    expect(check).toContain("responsible_label");
  });

  it("y las FKs del responsable son RESTRICT, no SET NULL", () => {
    // La lección de `clinical_processor_agreements`: un `SET NULL`
    // dejaría la fila sin responsable y el CHECK de arriba la
    // rechazaría al ejecutarse.
    for (const c of [
      "corrective_actions_responsible_care_role_id_fkey",
      "corrective_actions_responsible_user_id_fkey",
    ]) {
      const re = new RegExp(
        `ADD CONSTRAINT "${c}"[\\s\\S]{0,200}?ON DELETE RESTRICT`,
      );
      expect(SQL, c).toMatch(re);
    }
  });
});

describe("las columnas cifradas llevan su CHECK de formato", () => {
  it("las seis, con el mismo patrón que residencia-4", () => {
    const PATRON = "~ '^c[0-9]+:[A-Za-z0-9+/]+={0,2}$'";
    for (const c of [
      "non_conformities_description_cifrado_formato",
      "non_conformities_cause_cifrado_formato",
      "corrective_actions_what_cifrado_formato",
      "corrective_actions_closing_note_cifrado_formato",
      "corrective_action_evidences_note_cifrado_formato",
      "effectiveness_verifications_note_cifrado_formato",
    ]) {
      const check = SQL.slice(SQL.indexOf(`"${c}"`)).slice(0, 300);
      expect(check, c).toContain(PATRON);
    }
  });

  it("la descripción de una NC y la nota de una verificación son OBLIGATORIAS", () => {
    // Una NC sin descripción no es una NC, y una verificación que sólo
    // dice «sí» no verifica nada. Las dos sin `IS NULL OR` delante.
    const desc = SQL.slice(
      SQL.indexOf('"non_conformities_description_cifrado_formato"'),
    ).slice(0, 220);
    expect(desc).not.toContain("IS NULL");
    const nota = SQL.slice(
      SQL.indexOf('"effectiveness_verifications_note_cifrado_formato"'),
    ).slice(0, 220);
    expect(nota).not.toContain("IS NULL");
  });

  it("y la DESCRIPCIÓN DE UN RIESGO va en claro, declarado", () => {
    // Al revés que la de una NC, y es deliberado: un riesgo describe
    // algo que PUEDE pasar en el centro, no algo que le pasó a alguien.
    // En claro es consultable, que es lo que permite pintar el mapa de
    // riesgos sin descifrar nada.
    expect(SQL).not.toContain("risk_opportunities_description_cifrado");
    const tabla = SQL.slice(
      SQL.indexOf('CREATE TABLE "risk_opportunities"'),
    ).slice(0, 1200);
    expect(tabla).toMatch(/"description"\s+TEXT\s+NOT NULL/);
  });
});

// ── 7 · Los ids sin DEFAULT, por el AAD ──────────────────────────────

describe("las cuatro tablas con texto cifrado generan su id en la aplicación", () => {
  it("`id UUID NOT NULL` SIN `DEFAULT gen_random_uuid()`", () => {
    // El AAD ata el valor a `tenant|tabla|columna|id de fila`, y el id
    // hay que saberlo antes de insertar. Misma decisión que
    // `care_records.id` y `handovers.id`.
    for (const t of [
      "non_conformities",
      "corrective_actions",
      "corrective_action_evidences",
      "effectiveness_verifications",
    ]) {
      const tabla = SQL.slice(SQL.indexOf(`CREATE TABLE "${t}"`)).slice(0, 900);
      expect(tabla, t).toMatch(/"id"\s+UUID\s+NOT NULL,/);
      expect(tabla, t).not.toMatch(/"id"[^\n]*DEFAULT gen_random_uuid/);
    }
  });

  it("y las cuatro SIN texto cifrado sí lo llevan", () => {
    for (const t of [
      "processes",
      "indicator_processes",
      "risk_opportunities",
      "quality_objectives",
    ]) {
      const tabla = SQL.slice(SQL.indexOf(`CREATE TABLE "${t}"`)).slice(0, 900);
      expect(tabla, t).toMatch(/"id"[^\n]*DEFAULT gen_random_uuid/);
    }
  });
});

// ── 8 · El `down` ────────────────────────────────────────────────────

describe("el `down` está escrito y es completo", () => {
  it("tira las ocho tablas, los cinco triggers, las cuatro funciones y los siete tipos", () => {
    const down = CRUDO.slice(
      CRUDO.indexOf("── EL `down`"),
      CRUDO.indexOf("════", CRUDO.indexOf("── EL `down`")),
    );
    for (const t of TABLAS) expect(down, t).toContain(`"${t}"`);
    for (const f of [
      "mipiacetpv_non_conformities_inmutable",
      "mipiacetpv_corrective_actions_append_only",
      "mipiacetpv_calidad_append_only",
      "mipiacetpv_verificacion_otra_persona",
    ]) {
      expect(down, f).toContain(`DROP FUNCTION ${f}()`);
    }
    expect(down).toContain('DROP TYPE "QualityObjectiveStatus"');
    expect(down).toContain('DROP TYPE');
  });
});
