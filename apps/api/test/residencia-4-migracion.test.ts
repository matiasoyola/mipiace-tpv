// residencia-4 · EL CONTRATO DEL SQL, leído del fichero.
//
// Hermano de `residencia-3-migracion.test.ts` y con el mismo encargo: no
// prueba «que la migración corra» —eso lo hace el e2e, que la aplica—
// sino **lo que la migración PROMETE**, y que no se le escape nada el día
// que alguien la toque.
//
//   · que es ADITIVA salvo el CHECK que sustituye, y que ese CHECK es
//     MÁS ANCHO que el que quita (si no lo fuera, el `ADD CONSTRAINT`
//     podría rechazar una fila de producción al hacer su scan);
//   · que `GUARD` va en SU PROPIA migración, porque Postgres prohíbe
//     usar un valor de enum en la transacción en la que se añade;
//   · que el trigger de `incidents` compara **las diecisiete columnas
//     inmutables**, una por una y por su nombre;
//   · que los dos append-only no tienen escapatoria;
//   · que el anti-solape de la excepción es un `EXCLUDE` y no un índice
//     parcial, y que el índice de evento lleva su `COALESCE`;
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
  join(RAIZ, "20261018010000_residencia_4_tipos", "migration.sql"),
  "utf8",
);
const LIBRO = readFileSync(
  join(
    RAIZ,
    "20261018020000_residencia_4_gravedad_e_incidencias",
    "migration.sql",
  ),
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

const SQL_TIPOS = soloSql(TIPOS);
const SQL_LIBRO = soloSql(LIBRO);

describe("las dos migraciones son ADITIVAS", () => {
  it("ni un DROP TABLE, ni un DELETE, ni un TRUNCATE", () => {
    for (const [nombre, sql] of [
      ["tipos", SQL_TIPOS],
      ["libro", SQL_LIBRO],
    ] as const) {
      expect(sql, nombre).not.toMatch(/\bDROP\s+TABLE\b/i);
      expect(sql, nombre).not.toMatch(/\bDROP\s+COLUMN\b/i);
      expect(sql, nombre).not.toMatch(/\bTRUNCATE\b/i);
      expect(sql, nombre).not.toMatch(/\bDELETE\s+FROM\b/i);
    }
  });

  it("y ni un UPDATE … SET fuera de las funciones de los triggers", () => {
    // Las tres funciones de trigger de este bloque sólo LANZAN: ninguna
    // escribe. Así que no puede haber un solo `UPDATE … SET` en el
    // fichero.
    expect(SQL_LIBRO).not.toMatch(/\bUPDATE\s+"?[a-z_]+"?\s+SET\b/i);
  });

  it("lo ÚNICO que se quita son dos CHECK, y se vuelven a poner", () => {
    const quitados = [...SQL_LIBRO.matchAll(/DROP\s+CONSTRAINT\s+"([a-z_]+)"/gi)].map(
      (m) => m[1],
    );
    expect(quitados.sort()).toEqual([
      "devices_register_o_habitacion",
      "pairing_codes_register_o_habitacion",
    ]);
    for (const c of quitados) {
      expect(SQL_LIBRO).toMatch(new RegExp(`ADD CONSTRAINT "${c}"`));
    }
  });

  it("y el CHECK nuevo es MÁS ANCHO que el que sustituye", () => {
    // Es lo que hace que el scan del `ADD CONSTRAINT` no pueda rechazar
    // una fila de producción: todo lo que pasaba antes sigue pasando y
    // además pasa un `GUARD`. Si alguien lo estrechara, esto se ve.
    const nuevo = SQL_LIBRO.slice(
      SQL_LIBRO.indexOf('ADD CONSTRAINT "devices_register_o_habitacion"'),
    );
    expect(nuevo).toMatch(/"kind" = 'ROOM'\s+AND "room_id" IS NOT NULL/);
    expect(nuevo).toMatch(/"kind" = 'GUARD' AND "room_id" IS NULL\s+AND "register_id" IS NULL/);
    expect(nuevo).toMatch(/"kind" NOT IN \('ROOM', 'GUARD'\)/);
  });
});

describe("el valor del enum va SOLO en su migración", () => {
  it("la primera sólo añade GUARD a DeviceKind", () => {
    expect(SQL_TIPOS).toMatch(/ALTER TYPE "DeviceKind" ADD VALUE IF NOT EXISTS 'GUARD'/);
    expect(SQL_TIPOS).not.toMatch(/CREATE TABLE/i);
    expect(SQL_TIPOS).not.toMatch(/ALTER TABLE/i);
  });

  it("y la segunda NO añade ningún valor a un enum que ya existía", () => {
    // Los nueve tipos de este bloque son NUEVOS, así que se crean y se
    // usan en la misma migración. Lo que no se puede es un `ADD VALUE`.
    expect(SQL_LIBRO).not.toMatch(/ADD VALUE/i);
    const creados = [...SQL_LIBRO.matchAll(/CREATE TYPE "([A-Za-z]+)" AS ENUM/g)].map(
      (m) => m[1],
    );
    expect(creados.sort()).toEqual([
      "FamilyCommunicationChannel",
      "FamilyCommunicationKind",
      "GuardAlertState",
      "GuardChannel",
      "IncidentActionKind",
      "IncidentOrigin",
      "IncidentSubject",
      "SeverityComparator",
      "SeverityLevel",
      "SeverityRuleKind",
    ]);
  });
});

describe("las diez tablas del bloque", () => {
  it("se crean todas y ninguna más", () => {
    const tablas = [...SQL_LIBRO.matchAll(/CREATE TABLE "([a-z_]+)"/g)].map(
      (m) => m[1],
    );
    expect(tablas.sort()).toEqual([
      "center_guard_settings",
      "family_communications",
      "guard_alerts",
      "guard_shift_sessions",
      "incident_actions",
      "incident_links",
      "incidents",
      "resident_threshold_overrides",
      "resident_threshold_rules",
      "severity_rules",
    ]);
  });

  it("y los `ALTER TABLE` sólo tocan lo del bloque, `devices` y `pairing_codes`", () => {
    const tocadas = new Set(
      [...SQL_LIBRO.matchAll(/ALTER TABLE "([a-z_]+)"/g)].map((m) => m[1]!),
    );
    // Las diez del bloque más las dos de siempre. Si aparece una
    // tercera —`clients`, `care_records`— este test se pone rojo, que es
    // lo que se quiere: la migración no toca tablas de producción.
    for (const t of tocadas) {
      expect(
        [
          "center_guard_settings",
          "devices",
          "family_communications",
          "guard_alerts",
          "guard_shift_sessions",
          "incident_actions",
          "incident_links",
          "incidents",
          "pairing_codes",
          "resident_threshold_overrides",
          "resident_threshold_rules",
          "severity_rules",
        ],
        `ALTER TABLE inesperado sobre ${t}`,
      ).toContain(t);
    }
  });
});

describe("la plantilla es del producto (D-21, D-65)", () => {
  it("`severity_rules` NO tiene `tenant_id`", () => {
    const tabla = SQL_LIBRO.slice(
      SQL_LIBRO.indexOf('CREATE TABLE "severity_rules"'),
      SQL_LIBRO.indexOf('CREATE TABLE "resident_threshold_overrides"'),
    );
    expect(tabla).not.toMatch(/"tenant_id"/);
  });

  it("y el CHECK clava el scope en STANDARD", () => {
    expect(SQL_LIBRO).toMatch(
      /ADD CONSTRAINT "severity_rules_solo_estandar"\s*\n?\s*CHECK \("scope" = 'STANDARD'\)/,
    );
  });

  it("el índice de EVENTO lleva su COALESCE, y el de UMBRAL no lo necesita", () => {
    // `qualifier` es NULL legítimamente (la regla base de un evento) y en
    // Postgres los NULL son distintos entre sí: sin el centinela, dos
    // reglas base del mismo evento serían dos claves distintas y el
    // índice no diría nada. Es la quinta vez que esta lección se paga.
    expect(SQL_LIBRO).toMatch(
      /CREATE UNIQUE INDEX "severity_rules_evento_vigente_key"[\s\S]*?COALESCE\("qualifier", ''\)/,
    );
    // El de umbral no lo lleva porque sus tres columnas son NOT NULL por
    // el CHECK de forma. Se comprueba para que nadie «arregle» eso
    // añadiéndole un COALESCE que no hace falta.
    const umbral = SQL_LIBRO.slice(
      SQL_LIBRO.indexOf('CREATE UNIQUE INDEX "severity_rules_umbral_vigente_key"'),
    ).split(";")[0]!;
    expect(umbral).not.toMatch(/COALESCE/);
  });
});

describe("la excepción de umbral no se solapa, y lo dice el motor", () => {
  it("es un EXCLUDE USING gist y no un índice parcial", () => {
    expect(SQL_LIBRO).toMatch(/CREATE EXTENSION IF NOT EXISTS btree_gist/);
    expect(SQL_LIBRO).toMatch(
      /ADD CONSTRAINT "resident_threshold_overrides_sin_solape"\s*\n?\s*EXCLUDE USING gist \(/,
    );
    expect(SQL_LIBRO).toMatch(/tstzrange\("from_at", "to_at"\) WITH &&/);
    expect(SQL_LIBRO).toMatch(/\) WHERE \("revoked_at" IS NULL\)/);
  });

  it("y la vigencia ordenada lleva su IS NULL delante", () => {
    // «Un CHECK que da NULL pasa» (residencia-1b §3). Sin el `IS NULL`,
    // una excepción sin fecha de fin dejaría el CHECK en NULL y pasaría
    // cualquier cosa.
    expect(SQL_LIBRO).toMatch(
      /CHECK \("to_at" IS NULL OR "to_at" > "from_at"\)/,
    );
  });
});

describe("el trigger de `incidents`", () => {
  const funcion = SQL_LIBRO.slice(
    SQL_LIBRO.indexOf("CREATE FUNCTION mipiacetpv_incidents_inmutable"),
    SQL_LIBRO.indexOf('CREATE TRIGGER "incidents_inmutable"'),
  );

  /** Las columnas de `incidents`, leídas del `CREATE TABLE`. */
  const columnas = [
    ...SQL_LIBRO.slice(
      SQL_LIBRO.indexOf('CREATE TABLE "incidents"'),
      SQL_LIBRO.indexOf('CONSTRAINT "incidents_pkey"'),
    ).matchAll(/^\s+"([a-z_]+)"\s+/gm),
  ].map((m) => m[1]!);

  /** Lo que el trigger DEJA cambiar. Todo lo demás tiene que estar
   *  nombrado en el `IS DISTINCT FROM`. */
  const MUTABLES = [
    "severity",
    "open",
    "closed_at",
    "closed_by_user_id",
    "closed_by_care_role_assignment_id",
    "self_closed",
    "alerted_at",
  ];

  it("el extractor de columnas encuentra las veinticuatro", () => {
    // Sin esto, el test de abajo sería VACUO: si el regex dejara de
    // casar, `columnas` saldría vacío y «no falta ninguna» pasaría
    // siempre. Es la misma trampa que un `expect([]).toEqual([])`.
    expect(columnas).toHaveLength(24);
    expect(columnas).toContain("incident_type");
    expect(columnas).toContain("alerted_at");
  });

  it("NOMBRA TODAS las inmutables, una por una", () => {
    const faltan = columnas
      .filter((c) => !MUTABLES.includes(c))
      .filter((c) => !funcion.includes(`NEW.${c} `) && !funcion.includes(`NEW.${c}\n`));
    // Si la tabla gana una columna y nadie la añade al trigger, aquí
    // sale su nombre. Es el guardián que residencia-3 escribió para
    // `care_records` y que allí funcionó.
    expect(faltan).toEqual([]);
  });

  it("y NO nombra las que sí se pueden cambiar", () => {
    for (const m of MUTABLES) {
      expect(funcion, `el trigger no debería mirar ${m}`).not.toMatch(
        new RegExp(`NEW\\.${m}\\s+IS DISTINCT FROM`),
      );
    }
  });

  it("no deja borrar", () => {
    expect(funcion).toMatch(/TG_OP = 'DELETE'/);
    expect(funcion).toMatch(/una incidencia no se borra/);
  });

  it("y una incidencia CERRADA no se reabre ni cambia de nivel", () => {
    expect(funcion).toMatch(/IF OLD\.open = false THEN/);
    expect(funcion).toMatch(/no se reabre ni cambia de nivel/);
  });
});

describe("los dos append-only, SIN escapatoria", () => {
  it("`incident_actions` no se edita ni se borra, y no mira si el padre existe", () => {
    const f = SQL_LIBRO.slice(
      SQL_LIBRO.indexOf("CREATE FUNCTION mipiacetpv_incident_actions_append_only"),
      SQL_LIBRO.indexOf('CREATE TRIGGER "incident_actions_append_only"'),
    );
    expect(f).toMatch(/TG_OP = 'DELETE'/);
    // Las dos ramas LANZAN: no hay un `RETURN OLD` por ninguna parte.
    expect(f).not.toMatch(/RETURN\s+OLD/);
    expect(f).not.toMatch(/RETURN\s+NEW/);
  });

  it("y `family_communications` igual", () => {
    const f = SQL_LIBRO.slice(
      SQL_LIBRO.indexOf(
        "CREATE FUNCTION mipiacetpv_family_communications_append_only",
      ),
      SQL_LIBRO.indexOf('CREATE TRIGGER "family_communications_append_only"'),
    );
    expect(f).not.toMatch(/RETURN\s+OLD/);
    expect(f).not.toMatch(/RETURN\s+NEW/);
  });
});

describe("lo cifrado tiene su CHECK de formato (D-63)", () => {
  it("las cinco columnas nuevas", () => {
    for (const nombre of [
      "incidents_description_cifrado_formato",
      "incident_actions_text_cifrado_formato",
      "family_communications_content_cifrado_formato",
      "family_communications_response_cifrado_formato",
      "resident_threshold_overrides_reason_cifrado_formato",
    ]) {
      expect(SQL_LIBRO, nombre).toMatch(new RegExp(`ADD CONSTRAINT "${nombre}"`));
    }
  });

  it("y el patrón es el MISMO que el de las diecisiete de la casa", () => {
    const patrones = [
      ...SQL_LIBRO.matchAll(/~ '\^c\[0-9\]\+:\[A-Za-z0-9\+\/\]\+=\{0,2\}\$'/g),
    ];
    expect(patrones).toHaveLength(5);
  });

  it("las dos NOT NULL son las que no pueden faltar", () => {
    // El motivo de una excepción y el contenido de una constancia: sin
    // ellos, la fila no significa nada.
    expect(SQL_LIBRO).toMatch(/"reason_cifrado" TEXT\s+NOT NULL/);
    expect(SQL_LIBRO).toMatch(/"content_cifrado"\s+TEXT\s+NOT NULL/);
  });
});

describe("la idempotencia del aviso vive en el motor", () => {
  it("UN aviso por (incidencia, canal)", () => {
    expect(SQL_LIBRO).toMatch(
      /CREATE UNIQUE INDEX "guard_alerts_incident_id_channel_key"\s*\n?\s*ON "guard_alerts"\("incident_id", "channel"\)/,
    );
  });

  it("y el índice del escalado es PARCIAL sobre lo que sigue sin acusar", () => {
    expect(SQL_LIBRO).toMatch(
      /CREATE INDEX "guard_alerts_por_escalar_key"[\s\S]*?WHERE "state" IN \('PENDING', 'DELIVERED'\)/,
    );
  });

  it("UNA guardia viva por MÓVIL, no por canal", () => {
    // Por móvil: un centro puede tener dos enfermeras de guardia con dos
    // móviles y las dos tienen que sonar.
    expect(SQL_LIBRO).toMatch(
      /CREATE UNIQUE INDEX "guard_shift_sessions_una_viva_key"\s*\n?\s*ON "guard_shift_sessions"\("device_id"\)\s*\n?\s*WHERE "ended_at" IS NULL/,
    );
  });
});

describe("las FKs que sostienen la evidencia son RESTRICT", () => {
  const restrictivas = [
    ["incidents_tenant_id_fkey"],
    ["incidents_client_id_fkey"],
    ["incidents_source_record_id_fkey"],
    ["incidents_opened_by_user_id_fkey"],
    ["incidents_opened_by_care_role_assignment_id_fkey"],
    ["incident_actions_incident_id_fkey"],
    ["incident_actions_by_user_id_fkey"],
    ["family_communications_incident_id_fkey"],
    ["guard_alerts_incident_id_fkey"],
    ["guard_alerts_acked_by_user_id_fkey"],
    ["guard_shift_sessions_user_id_fkey"],
    ["resident_threshold_overrides_client_id_fkey"],
  ];
  it.each(restrictivas)("%s", (nombre) => {
    const i = SQL_LIBRO.indexOf(`ADD CONSTRAINT "${nombre}"`);
    expect(i, `no existe ${nombre}`).toBeGreaterThan(-1);
    expect(SQL_LIBRO.slice(i, i + 400)).toMatch(/ON DELETE RESTRICT/);
  });

  it("y la habitación de una incidencia es SET NULL, a propósito", () => {
    // Retirar una habitación del edificio no puede quedar bloqueado por
    // lo que pasó dentro hace tres años.
    const i = SQL_LIBRO.indexOf('ADD CONSTRAINT "incidents_room_id_fkey"');
    expect(SQL_LIBRO.slice(i, i + 300)).toMatch(/ON DELETE SET NULL/);
  });

  it("y las reglas de una excepción se van con su cabecera", () => {
    const i = SQL_LIBRO.indexOf(
      'ADD CONSTRAINT "resident_threshold_rules_override_id_fkey"',
    );
    expect(SQL_LIBRO.slice(i, i + 300)).toMatch(/ON DELETE CASCADE/);
  });
});

describe("el canal del móvil de guardia", () => {
  it("sólo puede tener valor en un GUARD, y en un GUARD es obligatorio", () => {
    for (const tabla of ["devices", "pairing_codes"]) {
      expect(SQL_LIBRO).toMatch(
        new RegExp(
          `ADD CONSTRAINT "${tabla}_guard_canal"\\s*\\n?\\s*CHECK \\(\\("kind" = 'GUARD' AND "guard_channel" IS NOT NULL\\)`,
        ),
      );
    }
  });
});
