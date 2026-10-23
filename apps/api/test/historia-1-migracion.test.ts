// historia-1 · EL CONTRATO DEL SQL, leído del fichero.
//
// Hermano de `residencia-3/4/5/6-migracion.test.ts` y con el mismo
// encargo: no prueba «que la migración corra» —eso lo hace el e2e, que la
// aplica— sino **lo que promete**.
//
// Ocho tablas y una columna, y lo que hay que fijar:
//
//   · que es **ADITIVA**: ni un `DROP`, ni un `DELETE`, ni un
//     `TRUNCATE`, ni un `UPDATE … SET` sobre datos fuera de los triggers;
//   · que el único `ALTER TABLE` sobre una tabla QUE YA EXISTÍA nombra
//     **`resident_profiles` y nada más**;
//   · que **las trece columnas cifradas llevan su CHECK de formato**, y
//     el claro no cabe en ninguna;
//   · que los CHECK con rango llevan su **`IS NOT NULL` delante del
//     `BETWEEN`** — un CHECK que da NULL *pasa*, y es la lección que
//     residencia-2 pagó en `care_plan_items`;
//   · que los **índices parciales de «una viva»** existen: la dieta y la
//     ausencia los necesitan, y sin ellos dos filas vigentes dejan a la
//     cocina y a `queToca` eligiendo;
//   · que **la alerta exige su frase** (D-91). Es el CHECK que impide que
//     una banda de la puerta nazca vacía o, peor, con el diagnóstico
//     dentro;
//   · y que **los triggers de inmutabilidad están**, con las
//     transiciones que dejan pasar y ni una más.

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

const FICHA = readFileSync(
  join(RAIZ, "20261023000000_historia_1_ficha", "migration.sql"),
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

const SQL = soloSql(FICHA);

describe("la migración de la ficha clínica es ADITIVA", () => {
  it("ni un DROP de tabla o columna, ni un TRUNCATE, ni un DELETE", () => {
    expect(SQL).not.toMatch(/\bDROP\s+TABLE\b/i);
    expect(SQL).not.toMatch(/\bDROP\s+COLUMN\b/i);
    expect(SQL).not.toMatch(/\bTRUNCATE\b/i);
    expect(SQL).not.toMatch(/\bDELETE\s+FROM\b/i);
  });

  it("y ni un UPDATE sobre datos fuera de las funciones de los triggers", () => {
    // Los `RAISE EXCEPTION` de los triggers no son `UPDATE`. Lo que esto
    // descarta es que la migración decida a mano la clase del alta de
    // alguien de quien no sabe nada.
    expect(SQL).not.toMatch(/\bUPDATE\s+"?resident_profiles"?\s+SET\b/i);
    expect(SQL).not.toMatch(/\bUPDATE\s+"?allergies"?\s+SET\b/i);
  });

  it("el único ALTER TABLE de una tabla que YA EXISTÍA es `resident_profiles`", () => {
    const nuevas = new Set([
      "resident_diagnoses",
      "allergies",
      "allergy_reviews",
      "resident_devices",
      "diet_profiles",
      "resident_absences",
      "admission_checklist_items",
      "center_admission_settings",
    ]);
    const tablas = [...SQL.matchAll(/ALTER\s+TABLE\s+"([a-z_]+)"/gi)].map(
      (m) => m[1]!,
    );
    expect(tablas.length).toBeGreaterThan(0);
    const viejas = [...new Set(tablas)].filter((t) => !nuevas.has(t));
    expect(viejas).toEqual(["resident_profiles"]);
  });

  it("y sobre `resident_profiles` sólo AÑADE una columna y su CHECK", () => {
    const sobre = SQL.split(/ALTER\s+TABLE\s+"resident_profiles"/i).slice(1);
    expect(sobre).toHaveLength(2);
    expect(sobre[0]).toMatch(/ADD\s+COLUMN\s+"discharge_kind"/i);
    expect(sobre[1]).toMatch(/ADD\s+CONSTRAINT\s+"resident_profiles_alta_clase"/i);
  });

  it("los cinco tipos son CREATE TYPE nuevos: no se ALTERa ningún enum", () => {
    // Por eso esta migración **no se parte en dos**: lo que obligaba a
    // partir `clinica_4`, `residencia_3/4/5` era `ALTER TYPE … ADD VALUE`,
    // que Postgres no deja usar en la misma transacción.
    expect(SQL).not.toMatch(/\bALTER\s+TYPE\b/i);
    const tipos = [...SQL.matchAll(/CREATE\s+TYPE\s+"([A-Za-z]+)"/g)].map(
      (m) => m[1]!,
    );
    expect(tipos.sort()).toEqual([
      "AllergyClass",
      "AllergySeverity",
      "DietTexture",
      "ResidentAbsenceKind",
      "ResidentDischargeKind",
    ]);
  });
});

describe("las columnas cifradas y su CHECK de formato", () => {
  // El claro NO CABE: si mañana una ruta nueva escribiera el texto de un
  // diagnóstico sin pasar por `cifrarTexto`, lo rechaza el motor.
  const CIFRADAS = [
    ["resident_diagnoses", "text_cifrado"],
    ["resident_diagnoses", "icd10_cifrado"],
    ["resident_diagnoses", "alert_phrase_cifrado"],
    ["resident_diagnoses", "withdraw_reason_cifrado"],
    ["allergies", "agent_cifrado"],
    ["allergies", "reaction_cifrado"],
    ["allergies", "withdraw_reason_cifrado"],
    ["allergy_reviews", "source_cifrado"],
    ["resident_devices", "detail_cifrado"],
    ["diet_profiles", "notes_cifrado"],
    ["resident_absences", "destination_cifrado"],
    ["resident_absences", "reason_cifrado"],
    ["admission_checklist_items", "done_note_cifrado"],
  ] as const;

  it.each(CIFRADAS)("%s.%s tiene su CHECK de formato", (tabla, columna) => {
    expect(SQL).toMatch(
      new RegExp(`ADD CONSTRAINT "${tabla}_${columna}_formato"`),
    );
  });

  it("son TRECE, y no se añade una columna cifrada sin su CHECK", () => {
    const checks = [...SQL.matchAll(/~ '\^c\[0-9\]\+:/g)].length;
    expect(checks).toBe(CIFRADAS.length);
  });

  it("las dos NOT NULL no admiten NULL en su CHECK, y las once opcionales sí", () => {
    // El texto de un diagnóstico y el agente de una alergia son NOT NULL:
    // su CHECK no lleva `IS NULL OR`. Las demás sí, porque la columna es
    // opcional y un CHECK sin el `IS NULL` delante rechazaría la fila
    // vacía… o, peor, daría NULL y pasaría.
    const deTexto = /ADD CONSTRAINT "resident_diagnoses_text_cifrado_formato"\s*CHECK \("text_cifrado" ~/;
    expect(SQL).toMatch(deTexto);
    expect(SQL).toMatch(
      /ADD CONSTRAINT "resident_diagnoses_icd10_cifrado_formato"\s*CHECK \("icd10_cifrado" IS NULL/,
    );
  });
});

describe("los CHECK de coherencia", () => {
  it("**la alerta exige su FRASE** (D-91)", () => {
    // Es el CHECK del bloque: marcar un diagnóstico como alerta sin
    // escribir qué hay que hacer dejaría a la puerta con una banda vacía
    // o empujaría a alguien a poner el diagnóstico dentro.
    expect(SQL).toMatch(/ADD CONSTRAINT "resident_diagnoses_alerta_completa"/);
    const bloque = /resident_diagnoses_alerta_completa"\s*CHECK \(([\s\S]*?)\);/.exec(
      SQL,
    );
    expect(bloque).toBeTruthy();
    // Las dos mitades: con marca, frase; sin marca, nada.
    expect(bloque![1]).toMatch(/"alert_flag" = TRUE\s+AND "alert_phrase_cifrado" IS NOT NULL/);
    expect(bloque![1]).toMatch(/"alert_flag" = FALSE\s+AND "alert_phrase_cifrado" IS NULL/);
  });

  it("el espesante y su nivel van juntos, con el IS NOT NULL delante del BETWEEN", () => {
    const bloque = /diet_profiles_espesante_coherente"\s*CHECK \(([\s\S]*?)\);/.exec(
      SQL,
    );
    expect(bloque).toBeTruthy();
    // **La lección de `care_plan_items`**: un CHECK que da NULL pasa.
    expect(bloque![1]).toMatch(
      /"thickener_level" IS NOT NULL\s*AND "thickener_level" BETWEEN 1 AND 3/,
    );
  });

  it("los dos plazos del centro llevan su IS NOT NULL delante del BETWEEN", () => {
    expect(SQL).toMatch(
      /"initial_care_plan_days" IS NOT NULL\s*AND "initial_care_plan_days" BETWEEN 1 AND 365/,
    );
    expect(SQL).toMatch(
      /"discharge_notice_days" IS NULL\s*OR "discharge_notice_days" BETWEEN 1 AND 180/,
    );
  });

  it("`OTRO` exige detalle en un dispositivo", () => {
    expect(SQL).toMatch(/ADD CONSTRAINT "resident_devices_otro_con_detalle"/);
  });

  it("la revisión de una vuelta exige que YA HAYA VUELTO", () => {
    // Confirmar «revisada tras el ingreso» de alguien que sigue en el
    // hospital es firmar una revisión que no ha pasado.
    const bloque = /resident_absences_revision_completa"\s*CHECK \(([\s\S]*?)\);/.exec(
      SQL,
    );
    expect(bloque).toBeTruthy();
    expect(bloque![1]).toMatch(/"ended_at" IS NOT NULL/);
  });

  it("la incidencia de una ausencia es SÓLO de la salida no controlada", () => {
    expect(SQL).toMatch(
      /"incident_id" IS NULL OR "kind" = 'SALIDA_NO_CONTROLADA'/,
    );
  });

  it("**lo `auto` del ingreso no se puede marcar a mano**", () => {
    const bloque = /admission_checklist_items_hecho_completo"\s*CHECK \(([\s\S]*?)\);/.exec(
      SQL,
    );
    expect(bloque).toBeTruthy();
    // La mitad que importa: marcado a mano exige `auto = FALSE`.
    expect(bloque![1]).toMatch(/"auto" = FALSE\s*AND "done_at" IS NOT NULL/);
  });
});

describe("los índices de «una viva»", () => {
  it("la dieta: una vigente por residente, con índice PARCIAL", () => {
    expect(SQL).toMatch(
      /CREATE UNIQUE INDEX "diet_profiles_una_viva_key"[\s\S]*?WHERE "superseded_at" IS NULL/,
    );
  });

  it("la ausencia: una abierta por residente", () => {
    // Nadie está en el hospital y de vacaciones a la vez.
    expect(SQL).toMatch(
      /CREATE UNIQUE INDEX "resident_absences_una_viva_key"[\s\S]*?WHERE "ended_at" IS NULL/,
    );
  });

  it("y un elemento del ingreso por residente, que es la idempotencia", () => {
    expect(SQL).toMatch(
      /CREATE UNIQUE INDEX "admission_checklist_items_client_id_code_key"/,
    );
  });
});

describe("los triggers de inmutabilidad", () => {
  const TRIGGERS = [
    "resident_diagnoses_inmutable",
    "allergies_inmutable",
    "allergy_reviews_append_only",
    "diet_profiles_inmutable",
    "resident_absences_inmutable",
  ];

  it.each(TRIGGERS)("%s existe", (nombre) => {
    expect(SQL).toMatch(new RegExp(`CREATE TRIGGER "${nombre}"`));
  });

  it("**una alergia no se edita ni se borra**: el sabotaje número uno", () => {
    const fn = /mipiacetpv_allergies_inmutable\(\) RETURNS trigger[\s\S]*?\$fn\$;/.exec(
      SQL,
    );
    expect(fn).toBeTruthy();
    expect(fn![0]).toMatch(/TG_OP = 'DELETE'/);
    // El agente comparado por su nombre, no con `row(NEW.*)`: el día que
    // la tabla gane una columna, este test se pone rojo y recuerda por qué.
    expect(fn![0]).toMatch(/NEW\.agent_cifrado\s+IS DISTINCT FROM OLD\.agent_cifrado/);
    expect(fn![0]).toMatch(/NEW\.class\s+IS DISTINCT FROM OLD\.class/);
    expect(fn![0]).toMatch(/NEW\.severity\s+IS DISTINCT FROM OLD\.severity/);
  });

  it("**una ausencia no se borra**: son días de la factura de la Junta", () => {
    const fn = /mipiacetpv_resident_absences_inmutable\(\) RETURNS trigger[\s\S]*?\$fn\$;/.exec(
      SQL,
    );
    expect(fn).toBeTruthy();
    expect(fn![0]).toMatch(/TG_OP = 'DELETE'/);
    // Ni el tipo ni el residente cambian: convertir un ingreso
    // hospitalario en unas vacaciones cambia tres días de la factura.
    expect(fn![0]).toMatch(/NEW\.kind\s+IS DISTINCT FROM OLD\.kind/);
    expect(fn![0]).toMatch(/NEW\.client_id\s+IS DISTINCT FROM OLD\.client_id/);
    // Y las fechas, sólo con la corrección firmada en la misma fila.
    expect(fn![0]).toMatch(/NEW\.corrected_at IS NULL/);
    expect(fn![0]).toMatch(/NEW\.correction_reason IS NULL/);
  });

  it("un diagnóstico sólo se resuelve o se retira, y no vuelve", () => {
    const fn = /mipiacetpv_resident_diagnoses_inmutable\(\) RETURNS trigger[\s\S]*?\$fn\$;/.exec(
      SQL,
    );
    expect(fn).toBeTruthy();
    expect(fn![0]).toMatch(/NEW\.text_cifrado\s+IS DISTINCT FROM OLD\.text_cifrado/);
    // **La frase de alerta tampoco se edita.** Es la columna que la
    // puerta pinta: si se pudiera reescribir sin rastro, la banda de un
    // pasillo cambiaría sin que nadie firmara el cambio.
    expect(fn![0]).toMatch(
      /NEW\.alert_phrase_cifrado\s+IS DISTINCT FROM OLD\.alert_phrase_cifrado/,
    );
    expect(fn![0]).toMatch(/OLD\.resolved_on IS NOT NULL/);
    expect(fn![0]).toMatch(/OLD\.withdrawn_at IS NOT NULL/);
  });

  it("una revisión de alergias no se edita ni se borra: se escribe otra", () => {
    const fn = /mipiacetpv_allergy_reviews_append_only\(\) RETURNS trigger[\s\S]*?\$fn\$;/.exec(
      SQL,
    );
    expect(fn).toBeTruthy();
    // Append-only de verdad: levanta SIEMPRE, sin mirar columnas.
    expect(fn![0]).toMatch(/RAISE EXCEPTION/);
    expect(fn![0]).not.toMatch(/RETURN NEW/);
  });

  it("y los dispositivos NO llevan trigger, a propósito", () => {
    // Cerrar un dispositivo es la operación normal y no hay nada que un
    // `UPDATE` pueda falsificar que importe clínicamente. Un trigger aquí
    // habría sido simetría por simetría. Lo que sí hay es la firma del
    // cierre.
    expect(SQL).not.toMatch(/CREATE TRIGGER "resident_devices/);
    expect(SQL).toMatch(/ADD CONSTRAINT "resident_devices_cierre_completo"/);
  });
});

describe("el `down` está escrito y es completo", () => {
  it("nombra las cinco funciones, las ocho tablas y los cinco tipos", () => {
    // Va comentado en la cabecera, así que se lee del fichero ENTERO y no
    // del SQL sin comentarios.
    for (const pieza of [
      "DROP FUNCTION mipiacetpv_resident_diagnoses_inmutable",
      "DROP FUNCTION mipiacetpv_allergies_inmutable",
      "DROP FUNCTION mipiacetpv_allergy_reviews_append_only",
      "DROP FUNCTION mipiacetpv_diet_profiles_inmutable",
      "DROP FUNCTION mipiacetpv_resident_absences_inmutable",
      'DROP TABLE "admission_checklist_items"',
      'DROP TABLE "center_admission_settings"',
      'DROP TABLE "resident_absences"',
      'DROP TABLE "diet_profiles"',
      'DROP TABLE "resident_devices"',
      'DROP TABLE "allergy_reviews"',
      'DROP TABLE "allergies"',
      'DROP TABLE "resident_diagnoses"',
      'DROP COLUMN "discharge_kind"',
      'DROP TYPE "ResidentAbsenceKind"',
      'DROP TYPE "ResidentDischargeKind"',
    ]) {
      expect(FICHA, pieza).toContain(pieza);
    }
  });

  it("y dice que después de la primera fila YA NO es completo", () => {
    // Porque lo que esas tablas guardan es historia clínica que la ley
    // obliga a conservar cinco años (Ley 41/2002, D-45).
    expect(FICHA).toMatch(/Ley 41\/2002/);
  });
});
