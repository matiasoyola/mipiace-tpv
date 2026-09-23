// F1 · la tabla "sabotaje → test rojo" del registro de jornada, contra
// Postgres de verdad.
//
// Por qué tiene que ser e2e y no puede vivir con un prisma falso: lo que
// se prueba aquí es que **el MOTOR** rechaza el cambio, no que la
// aplicación se porte bien. Es la misma razón exacta de
// `sello-de-la-venta.e2e.ts` (ADR-015 §1): la aplicación no es la única
// puerta a Postgres, y un registro de jornada que sólo es inalterable
// mientras el código se porte bien no es inalterable.
//
// Por eso cada sabotaje entra por `$executeRawUnsafe`: SQL directo, como
// lo escribiría alguien con acceso al VPS. El criterio de hecho del
// bloque lo pide con esas palabras — "un UPDATE o DELETE a mano en psql
// sobre un fichaje o una corrección falla".
//
// El caso canónico es el test del fichaje de salida: **la salida se pone
// sin corrección (es la segunda mitad del mismo hecho) y a partir de ahí
// ya no se mueve sin traza.** Las dos cosas en el mismo bloque, porque el
// fallo típico de esto no es quedarse corto: es pasarse de estricto y que
// el empleado no pueda fichar la salida.

import { randomBytes, randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { E2E_DATABASE_URL, e2eEnabled, SKIP_MESSAGE } from "./e2e-env.js";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL =
  E2E_DATABASE_URL || "postgresql://e2e:e2e@127.0.0.1:5432/e2e";
process.env.REDIS_URL = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";
process.env.JWT_ACCESS_SECRET = "e".repeat(40);
process.env.JWT_REFRESH_SECRET = "f".repeat(40);
process.env.HOLDED_KEY_ENCRYPTION_SECRET = randomBytes(32).toString("base64");

const { getPrisma, shutdown } = await import("../src/context.js");

// Un UPDATE/DELETE tiene que FALLAR. Devuelve el mensaje de Postgres para
// poder comprobar que además dice por qué.
async function debeFallar(sql: string): Promise<string> {
  const prisma = getPrisma();
  try {
    await prisma.$executeRawUnsafe(sql);
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
  throw new Error(`El motor ACEPTÓ lo que no debía:\n${sql}`);
}

describe.skipIf(!e2eEnabled)("e2e · el registro de jornada es inalterable", () => {
  if (!e2eEnabled) console.warn(`\n${SKIP_MESSAGE}\n`);

  const prisma = getPrisma();
  let tenantId = "";
  let employeeId = "";
  let otroEmpleadoId = "";
  let entryId = "";

  beforeAll(async () => {
    tenantId = randomUUID();
    await prisma.$executeRawUnsafe(
      `INSERT INTO tenants (id, name, fichaje_enabled, updated_at)
       VALUES ('${tenantId}', 'Colegio de Talavera ${tenantId.slice(0, 8)}', true, now())`,
    );
  });

  afterAll(async () => {
    // El tenant se va entero: es la única escapatoria que los triggers
    // aceptan, y que funcione es parte de lo que se prueba.
    await prisma.$executeRawUnsafe(`DELETE FROM tenants WHERE id = '${tenantId}'`);
    await shutdown();
  });

  beforeEach(async () => {
    employeeId = randomUUID();
    otroEmpleadoId = randomUUID();
    entryId = randomUUID();
    await prisma.$executeRawUnsafe(
      `INSERT INTO employees (id, tenant_id, name) VALUES
        ('${employeeId}', '${tenantId}', 'Marta'),
        ('${otroEmpleadoId}', '${tenantId}', 'Luis')`,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO time_entries
         (id, tenant_id, employee_id, started_at, started_device_at, started_server_at, start_source)
       VALUES
         ('${entryId}', '${tenantId}', '${employeeId}',
          '2026-09-22T06:02:00Z', '2026-09-22T06:02:00Z', '2026-09-22T06:02:03Z', 'MOBILE')`,
    );
  });

  // ── la invariante del tramo abierto ─────────────────────────────────

  it("no deja abrir un segundo tramo del mismo empleado (lo garantiza la BASE)", async () => {
    const msg = await debeFallar(
      `INSERT INTO time_entries (tenant_id, employee_id, started_at, started_server_at, start_source)
       VALUES ('${tenantId}', '${employeeId}', '2026-09-22T09:00:00Z', '2026-09-22T09:00:00Z', 'MOBILE')`,
    );
    // Prisma no propaga el nombre del índice, sólo el código y la clave.
    // Con eso basta para saber QUÉ se ha violado: unicidad por empleado.
    expect(msg).toMatch(/23505/);
    expect(msg).toMatch(/Key \(employee_id\)/);
  });

  it("sí deja abrir otro tramo del MISMO día una vez cerrado el anterior", async () => {
    await cerrarConProcedencia();
    await prisma.$executeRawUnsafe(
      `INSERT INTO time_entries (tenant_id, employee_id, started_at, started_server_at, start_source)
       VALUES ('${tenantId}', '${employeeId}', '2026-09-22T16:00:00Z', '2026-09-22T16:00:00Z', 'MOBILE')`,
    );
    const filas = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
      `SELECT count(*) AS n FROM time_entries WHERE employee_id = '${employeeId}'`,
    );
    expect(Number(filas[0]!.n)).toBe(2);
  });

  it("y otro empleado puede tener su propio tramo abierto a la vez", async () => {
    await prisma.$executeRawUnsafe(
      `INSERT INTO time_entries (tenant_id, employee_id, started_at, started_server_at, start_source)
       VALUES ('${tenantId}', '${otroEmpleadoId}', '2026-09-22T06:05:00Z', '2026-09-22T06:05:00Z', 'MOBILE')`,
    );
    // Acotado a los dos empleados de ESTE caso: el tenant es compartido
    // por el fichero entero y arrastra los tramos de los anteriores.
    const filas = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
      `SELECT count(*) AS n FROM time_entries
        WHERE ended_at IS NULL
          AND employee_id IN ('${employeeId}', '${otroEmpleadoId}')`,
    );
    expect(Number(filas[0]!.n)).toBe(2);
  });

  // ── el caso canónico ────────────────────────────────────────────────

  async function cerrarConProcedencia(hora = "2026-09-22T14:01:00Z") {
    await prisma.$executeRawUnsafe(
      `UPDATE time_entries
          SET ended_at = '${hora}', ended_device_at = '${hora}',
              ended_server_at = '${hora}', end_source = 'MOBILE'
        WHERE id = '${entryId}'`,
    );
  }

  it("el fichaje de SALIDA se pone sin corrección; después ya no se mueve sin traza", async () => {
    // La segunda mitad del mismo hecho: entra sin ceremonia.
    await cerrarConProcedencia();
    const [fila] = await prisma.$queryRawUnsafe<Array<{ ended_at: Date }>>(
      `SELECT ended_at FROM time_entries WHERE id = '${entryId}'`,
    );
    expect(fila!.ended_at.toISOString()).toBe("2026-09-22T14:01:00.000Z");

    // Y a partir de aquí, el registro está completo: cambiarlo es corregir.
    const msg = await debeFallar(
      `UPDATE time_entries SET ended_at = '2026-09-22T18:00:00Z' WHERE id = '${entryId}'`,
    );
    expect(msg).toMatch(/REGISTRO_VIOLADO/);
    expect(msg).toMatch(/record_time_entry_correction/);
  });

  it("cerrar SIN decir de dónde sale la hora se rechaza", async () => {
    const msg = await debeFallar(
      `UPDATE time_entries SET ended_at = '2026-09-22T14:00:00Z' WHERE id = '${entryId}'`,
    );
    expect(msg).toMatch(/exige decir de dónde sale la hora/);
  });

  // ── las horas no se tocan a mano ────────────────────────────────────

  it("la ENTRADA no se cambia con un UPDATE a mano", async () => {
    const msg = await debeFallar(
      `UPDATE time_entries SET started_at = '2026-09-22T07:00:00Z' WHERE id = '${entryId}'`,
    );
    expect(msg).toMatch(/REGISTRO_VIOLADO/);
  });

  it("un fichaje cerrado NO se reabre", async () => {
    await cerrarConProcedencia();
    const msg = await debeFallar(
      `UPDATE time_entries SET ended_at = NULL, ended_server_at = NULL, end_source = NULL
        WHERE id = '${entryId}'`,
    );
    expect(msg).toMatch(/no se reabre/);
  });

  it("la PROCEDENCIA no se corrige: dice de dónde salió la hora", async () => {
    const msg = await debeFallar(
      `UPDATE time_entries SET started_server_at = '2026-09-22T06:02:00Z' WHERE id = '${entryId}'`,
    );
    expect(msg).toMatch(/procedencia/);
  });

  it("la identidad de la fila tampoco se reescribe", async () => {
    const msg = await debeFallar(
      `UPDATE time_entries SET employee_id = '${otroEmpleadoId}' WHERE id = '${entryId}'`,
    );
    expect(msg).toMatch(/identidad/);
  });

  // ── la corrección ───────────────────────────────────────────────────

  async function corregir(
    campo: "started_at" | "ended_at",
    valor: string,
    motivo: string,
    texto: string | null = null,
  ): Promise<void> {
    await prisma.$executeRawUnsafe(
      `SELECT record_time_entry_correction(
         '${entryId}', '${campo}', '${valor}'::timestamptz,
         '${motivo}', ${texto === null ? "NULL" : `'${texto}'`},
         'EMPLOYEE', 'Marta', '${employeeId}', NULL)`,
    );
  }

  it("la corrección cambia la hora y deja el valor anterior, el autor y el motivo", async () => {
    await cerrarConProcedencia();
    await corregir("ended_at", "2026-09-22T15:00:00Z", "ERROR_HORA");

    const [entry] = await prisma.$queryRawUnsafe<Array<{ ended_at: Date }>>(
      `SELECT ended_at FROM time_entries WHERE id = '${entryId}'`,
    );
    expect(entry!.ended_at.toISOString()).toBe("2026-09-22T15:00:00.000Z");

    const [c] = await prisma.$queryRawUnsafe<
      Array<{
        field: string;
        old_value: string;
        new_value: string;
        reason_code: string;
        author: string;
        author_kind: string;
      }>
    >(`SELECT * FROM time_entry_corrections WHERE time_entry_id = '${entryId}'`);
    expect(c!.field).toBe("ended_at");
    // El valor ORIGINAL sigue ahí: eso es lo que hace defendible el registro.
    expect(c!.old_value).toContain("14:01:00");
    expect(c!.new_value).toContain("15:00:00");
    expect(c!.reason_code).toBe("ERROR_HORA");
    expect(c!.author).toBe("Marta");
    expect(c!.author_kind).toBe("EMPLOYEE");
  });

  it("una corrección SIN motivo no se escribe", async () => {
    await cerrarConProcedencia();
    const msg = await debeFallar(
      `SELECT record_time_entry_correction(
         '${entryId}', 'ended_at', '2026-09-22T15:00:00Z'::timestamptz,
         NULL, NULL, 'EMPLOYEE', 'Marta', '${employeeId}', NULL)`,
    );
    expect(msg).toMatch(/CORRECCION_SIN_MOTIVO/);
    // Y la hora no se ha movido.
    const [entry] = await prisma.$queryRawUnsafe<Array<{ ended_at: Date }>>(
      `SELECT ended_at FROM time_entries WHERE id = '${entryId}'`,
    );
    expect(entry!.ended_at.toISOString()).toBe("2026-09-22T14:01:00.000Z");
  });

  it('el motivo "Otro" exige decir cuál', async () => {
    await cerrarConProcedencia();
    const msg = await debeFallar(
      `SELECT record_time_entry_correction(
         '${entryId}', 'ended_at', '2026-09-22T15:00:00Z'::timestamptz,
         'OTRO', '   ', 'EMPLOYEE', 'Marta', '${employeeId}', NULL)`,
    );
    expect(msg).toMatch(/exige decir cuál/);
  });

  it("una hora no se corrige a vacío", async () => {
    await cerrarConProcedencia();
    const msg = await debeFallar(
      `SELECT record_time_entry_correction(
         '${entryId}', 'ended_at', NULL,
         'OLVIDO', NULL, 'EMPLOYEE', 'Marta', '${employeeId}', NULL)`,
    );
    expect(msg).toMatch(/no se corrige a vacío/);
  });

  it("sólo las horas son corregibles", async () => {
    const msg = await debeFallar(
      `SELECT record_time_entry_correction(
         '${entryId}', 'tenant_id', '2026-09-22T15:00:00Z'::timestamptz,
         'OLVIDO', NULL, 'EMPLOYEE', 'Marta', '${employeeId}', NULL)`,
    );
    expect(msg).toMatch(/no se corrige/);
  });

  it("una salida anterior a la entrada no pasa ni por la vía de corrección", async () => {
    await cerrarConProcedencia();
    const msg = await debeFallar(
      `SELECT record_time_entry_correction(
         '${entryId}', 'ended_at', '2026-09-22T05:00:00Z'::timestamptz,
         'ERROR_HORA', NULL, 'EMPLOYEE', 'Marta', '${employeeId}', NULL)`,
    );
    expect(msg).toMatch(/time_entries_ended_after_started/);
  });

  // La salida OLVIDADA: el tramo sigue abierto y se cierra contestando,
  // con motivo OLVIDO. Nunca solo.
  it("la salida olvidada se cierra por la vía de corrección, con motivo OLVIDO", async () => {
    await corregir("ended_at", "2026-09-22T17:30:00Z", "OLVIDO");
    const [entry] = await prisma.$queryRawUnsafe<
      Array<{ ended_at: Date; end_source: string; ended_device_at: Date | null }>
    >(`SELECT ended_at, end_source, ended_device_at FROM time_entries WHERE id = '${entryId}'`);
    expect(entry!.ended_at.toISOString()).toBe("2026-09-22T17:30:00.000Z");
    // Quien contesta es quien pone la hora, y queda dicho.
    expect(entry!.end_source).toBe("MOBILE");
    // Nadie tocó el móvil a esa hora: no hay hora de dispositivo que inventar.
    expect(entry!.ended_device_at).toBeNull();

    const [c] = await prisma.$queryRawUnsafe<Array<{ reason_code: string; old_value: string | null }>>(
      `SELECT reason_code, old_value FROM time_entry_corrections WHERE time_entry_id = '${entryId}'`,
    );
    expect(c!.reason_code).toBe("OLVIDO");
    expect(c!.old_value).toBeNull();
  });

  // ── la traza es append-only ─────────────────────────────────────────

  it("una corrección no se edita", async () => {
    await cerrarConProcedencia();
    await corregir("ended_at", "2026-09-22T15:00:00Z", "ERROR_HORA");
    const msg = await debeFallar(
      `UPDATE time_entry_corrections SET reason_code = 'OLVIDO' WHERE time_entry_id = '${entryId}'`,
    );
    expect(msg).toMatch(/append-only/);
  });

  it("una corrección no se borra", async () => {
    await cerrarConProcedencia();
    await corregir("ended_at", "2026-09-22T15:00:00Z", "ERROR_HORA");
    const msg = await debeFallar(
      `DELETE FROM time_entry_corrections WHERE time_entry_id = '${entryId}'`,
    );
    expect(msg).toMatch(/append-only/);
  });

  // ── el registro no se borra ─────────────────────────────────────────

  it("un fichaje no se borra: se conserva 4 años", async () => {
    const msg = await debeFallar(`DELETE FROM time_entries WHERE id = '${entryId}'`);
    expect(msg).toMatch(/no se borra/);
    expect(msg).toMatch(/4 años/);
  });

  it("un empleado con fichajes no se borra: la baja lo desactiva", async () => {
    const msg = await debeFallar(`DELETE FROM employees WHERE id = '${employeeId}'`);
    expect(msg).toMatch(/desactivándolo/);
  });

  it("un empleado que nunca fichó sí se borra (un alta equivocada)", async () => {
    await prisma.$executeRawUnsafe(
      `DELETE FROM employees WHERE id = '${otroEmpleadoId}'`,
    );
    const filas = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
      `SELECT count(*) AS n FROM employees WHERE id = '${otroEmpleadoId}'`,
    );
    expect(Number(filas[0]!.n)).toBe(0);
  });

  it("desactivar al empleado NO toca sus fichajes", async () => {
    await cerrarConProcedencia();
    await prisma.$executeRawUnsafe(
      `UPDATE employees SET active = false, deactivated_at = now() WHERE id = '${employeeId}'`,
    );
    const filas = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
      `SELECT count(*) AS n FROM time_entries WHERE employee_id = '${employeeId}'`,
    );
    expect(Number(filas[0]!.n)).toBe(1);
  });

  // ── el móvil ────────────────────────────────────────────────────────

  it("un empleado no puede tener dos móviles activos (lo garantiza la BASE)", async () => {
    await prisma.$executeRawUnsafe(
      `INSERT INTO employee_devices (tenant_id, employee_id, device_token_hash)
       VALUES ('${tenantId}', '${employeeId}', 'hash-${entryId}-a')`,
    );
    const msg = await debeFallar(
      `INSERT INTO employee_devices (tenant_id, employee_id, device_token_hash)
       VALUES ('${tenantId}', '${employeeId}', 'hash-${entryId}-b')`,
    );
    expect(msg).toMatch(/23505/);
    expect(msg).toMatch(/Key \(employee_id\)/);
  });

  it("revocar el anterior deja emparejar el nuevo", async () => {
    await prisma.$executeRawUnsafe(
      `INSERT INTO employee_devices (tenant_id, employee_id, device_token_hash)
       VALUES ('${tenantId}', '${employeeId}', 'hash-${entryId}-c')`,
    );
    await prisma.$executeRawUnsafe(
      `UPDATE employee_devices SET revoked_at = now()
        WHERE device_token_hash = 'hash-${entryId}-c'`,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO employee_devices (tenant_id, employee_id, device_token_hash)
       VALUES ('${tenantId}', '${employeeId}', 'hash-${entryId}-d')`,
    );
    const filas = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
      `SELECT count(*) AS n FROM employee_devices
        WHERE employee_id = '${employeeId}' AND revoked_at IS NULL`,
    );
    expect(Number(filas[0]!.n)).toBe(1);
  });
});
