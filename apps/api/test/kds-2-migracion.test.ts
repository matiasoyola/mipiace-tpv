// kds-2-wifi · EL CONTRATO DEL SQL DE LA MIGRACIÓN.
//
// Mismo guardia que `kds-migracion.test.ts` y por la misma razón: hay
// invariantes de este bloque que **sólo existen en el SQL**, porque Prisma
// no sabe declararlas. Si alguien acepta el «¿borrar índice?» o el
// «¿borrar trigger?» de `prisma migrate dev`, el esquema sigue pareciendo
// correcto y la invariante se va sin que nada se ponga rojo.
//
// Lo que este fichero guarda:
//
//   · el CHECK `devices_kitchen_lan_solo_cocina`, que es «un terminal de
//     caja no escucha en ningún puerto» escrito en el motor;
//   · el trigger `stores_rotate_lan_key`, que es «la clave se rota al
//     revocar un aparato» escrito en el motor;
//   · el índice parcial `kitchen_lan_marks_pendientes_idx`;
//   · los CHECK del libro de marcas;
//   · y que la migración es ADITIVA.
//
// Lo que NO se puede guardar desde aquí: que el CHECK y el trigger se
// cumplan de verdad. Eso es `test-e2e/kds-2-wifi.e2e.ts` contra Postgres.

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
const WIFI = readFileSync(
  path.join(DIR, "20261009000000_kds_2_wifi/migration.sql"),
  "utf8",
);
const SCHEMA = readFileSync(
  path.join(REPO_ROOT, "packages/db/prisma/schema.prisma"),
  "utf8",
);

/** El SQL sin comentarios: los `--` también contienen estas palabras. */
function sinComentarios(sql: string): string {
  return sql
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("--"))
    .join("\n");
}

const SQL = sinComentarios(WIFI);

describe("kds-2 · UN TERMINAL NO ESCUCHA EN NINGÚN PUERTO", () => {
  it("el CHECK `devices_kitchen_lan_solo_cocina` existe", () => {
    expect(SQL).toContain("devices_kitchen_lan_solo_cocina");
    expect(SQL).toMatch(/"kind"\s*=\s*'KITCHEN'/);
  });

  it("y tapa LAS TRES columnas, no sólo el puerto", () => {
    const check = SQL.slice(SQL.indexOf("devices_kitchen_lan_solo_cocina"));
    const cuerpo = check.slice(0, check.indexOf(");"));
    for (const col of ["kitchen_lan_ip", "kitchen_lan_port", "kitchen_lan_at"]) {
      expect(cuerpo).toContain(`"${col}" IS NULL`);
    }
  });

  it("y NO usa `array_length` ni `cardinality`: se comprueba con IS NULL", () => {
    // La lección de kds-1: un CHECK que evalúa a NULL se considera
    // satisfecho, y `array_length('{}', 1)` devuelve NULL. Aquí los tres
    // `IS NULL` devuelven siempre TRUE o FALSE.
    const check = SQL.slice(SQL.indexOf("devices_kitchen_lan_solo_cocina"));
    const cuerpo = check.slice(0, check.indexOf(");"));
    expect(cuerpo).not.toMatch(/array_length/);
  });

  it("el puerto, si está, es un puerto sin privilegios", () => {
    expect(SQL).toContain("devices_kitchen_lan_port_range");
    expect(SQL).toMatch(/>=\s*1024/);
    expect(SQL).toMatch(/<=\s*65535/);
  });

  it("y el schema.prisma AVISA de que el CHECK existe", () => {
    expect(SCHEMA).toMatch(/devices_kitchen_lan_solo_cocina/);
  });
});

describe("kds-2 · LA CLAVE SE ROTA AL REVOCAR, en el motor", () => {
  it("el trigger existe y cuelga de `devices`", () => {
    expect(SQL).toContain('CREATE TRIGGER "stores_rotate_lan_key"');
    expect(SQL).toMatch(/AFTER UPDATE OF "revoked_at" ON "devices"/);
  });

  it("sólo en la transición de vivo a revocado", () => {
    // Sin el `WHEN`, cada latido rezagado de un aparato ya revocado
    // rotaría la clave de la tienda y el bar se quedaría sin camino
    // directo cada 20 s.
    expect(SQL).toMatch(
      /WHEN \(OLD\."revoked_at" IS NULL AND NEW\."revoked_at" IS NOT NULL\)/,
    );
  });

  it("y lo que hace es BORRAR la clave, no reescribirla desde plpgsql", () => {
    // Generar 32 bytes buenos de azar es trabajo del servidor, no de un
    // trigger: `gen_random_bytes` exige pgcrypto, que no se asume
    // instalado. Borrar y que el servidor la reemita es lo mismo con una
    // dependencia menos.
    const fn = SQL.slice(SQL.indexOf("mipiacetpv_stores_rotate_lan_key"));
    expect(fn).toMatch(/kitchen_lan_key\s*=\s*NULL/);
    expect(fn).not.toMatch(/gen_random_bytes/);
  });
});

describe("kds-2 · el libro de marcas", () => {
  it("la llave es el `mark_id` de la TABLET, no un id del servidor", () => {
    expect(SQL).toMatch(
      /CONSTRAINT "kitchen_lan_marks_pkey" PRIMARY KEY \("mark_id"\)/,
    );
  });

  it("el índice de lo pendiente es PARCIAL sobre `applied_at IS NULL`", () => {
    const idx = SQL.slice(SQL.indexOf("kitchen_lan_marks_pendientes_idx"));
    expect(idx.slice(0, 200)).toMatch(/WHERE "applied_at" IS NULL/);
  });

  it("y el schema.prisma AVISA de que ese índice no se puede borrar", () => {
    expect(SCHEMA).toMatch(/kitchen_lan_marks_pendientes_idx/);
    expect(SCHEMA).toMatch(/NO SE PUEDE BORRAR/);
  });

  it("los tres tipos de marca, ni uno más", () => {
    expect(SQL).toMatch(/"kind" IN \('HECHO', 'VISTO', 'LISTA'\)/);
  });

  it("una marca de tarjeta no apunta a un plato, y una de plato sí", () => {
    const check = SQL.slice(SQL.indexOf("kitchen_lan_marks_coordenadas"));
    const cuerpo = check.slice(0, check.indexOf("\n    );"));
    expect(cuerpo).toMatch(
      /"kind" = 'LISTA' AND "ticket_line_id" IS NULL AND "done" IS NULL/,
    );
    expect(cuerpo).toMatch(
      /"kind" = 'HECHO' AND "ticket_line_id" IS NOT NULL AND "done" IS NOT NULL/,
    );
  });

  it("la hora de la marca es la de la TABLET, y está dicho en el esquema", () => {
    expect(SCHEMA).toMatch(/\*\*La hora de la TABLET\.\*\*/);
  });
});

describe("kds-2 · la migración es ADITIVA", () => {
  it("ni un DROP, ni un DELETE, ni un TRUNCATE, ni un UPDATE masivo", () => {
    expect(SQL).not.toMatch(/\bDROP\s+(TABLE|COLUMN|CONSTRAINT|INDEX|TYPE)\b/i);
    expect(SQL).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(SQL).not.toMatch(/\bTRUNCATE\b/i);
    // El único UPDATE de la migración es el del cuerpo del trigger, que
    // no corre al aplicarla.
    const fueraDelTrigger = SQL.slice(
      0,
      SQL.indexOf("CREATE FUNCTION mipiacetpv_stores_rotate_lan_key"),
    );
    expect(fueraDelTrigger).not.toMatch(/\bUPDATE\b/i);
  });

  it("todo nace NULL: ninguna tabla se reescribe", () => {
    const añadidas = [...SQL.matchAll(/ADD COLUMN "([a-z_]+)"[^,;]*/g)].map(
      (m) => m[0],
    );
    expect(añadidas.length).toBeGreaterThanOrEqual(6);
    for (const col of añadidas) {
      expect(col).not.toMatch(/NOT NULL/);
      expect(col).not.toMatch(/DEFAULT/);
    }
  });

  it("y el camino directo nace APAGADO: sin clave no hay camino", () => {
    // `kitchen_lan_key` nace NULL en todas las tiendas, y el servidor sólo
    // la emite cuando una pantalla de cocina la pide. Un cliente sin
    // pantalla de cocina no ve ni una diferencia tras el despliegue.
    expect(SQL).toMatch(/ADD COLUMN "kitchen_lan_key"\s+TEXT,/);
    expect(WIFI).toMatch(/nada cambia de comportamiento al aplicarla/);
  });
});
