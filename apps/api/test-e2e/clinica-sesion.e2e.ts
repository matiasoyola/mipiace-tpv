// clinica-3 · la tabla «sabotaje → test rojo» de la sesión, contra
// Postgres de verdad.
//
// Por qué tiene que ser e2e y no puede vivir con un Prisma falso: lo que se
// prueba aquí es que **el MOTOR** lo rechaza, no que la aplicación se porte
// bien. Misma razón que `clinica-historia.e2e.ts` (clinica-1),
// `clinica-valoracion.e2e.ts` (clinica-2) y `sello-de-la-venta.e2e.ts`
// (ADR-015 §1): la aplicación no es la única puerta a Postgres, y una
// sesión que sólo es inalterable mientras el código se porte bien no es
// inalterable.
//
// Por eso cada sabotaje entra por `$executeRawUnsafe`: SQL directo, como lo
// escribiría alguien con acceso al VPS.
//
// Las garantías, una por bloque:
//
//   1. **DE UNA CITA SALE UNA SOLA SESIÓN.** Es el «cerrar dos veces = un
//      cobro» del prompt, y lo sostiene un índice único PARCIAL.
//   2. Y por ser PARCIAL, la misma cita admite su exploración y sus
//      anotaciones. Un índice total las habría prohibido.
//   3. **UNA SESIÓN CERRADA NO SE EDITA NI SE BORRA**, por el trigger de
//      clinica-1. Lo único que se le añade son anotaciones.
//   4. **NADA DE ESTO SE BORRA**: ni el paciente con sesión dentro, ni la
//      sanitaria que la firmó, ni el tenant.
//   5. El cuerpo sigue siendo un objeto no vacío (CHECK de clinica-1), y
//      **un paciente SÍ tiene muchas sesiones**: una por visita.
//   6. Y la marca del catálogo (`tratamiento_sesion`) nace apagada.

import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { E2E_DATABASE_URL, e2eEnabled, SKIP_MESSAGE } from "./e2e-env.js";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL =
  E2E_DATABASE_URL || "postgresql://e2e:e2e@127.0.0.1:5432/e2e";
process.env.REDIS_URL = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";
process.env.JWT_ACCESS_SECRET = "e".repeat(40);
process.env.JWT_REFRESH_SECRET = "f".repeat(40);
process.env.HOLDED_KEY_ENCRYPTION_SECRET = "0".repeat(43) + "=";

const { getPrisma, shutdown } = await import("../src/context.js");

/** Un INSERT/UPDATE/DELETE tiene que FALLAR. Devuelve el mensaje real. */
async function debeFallar(sql: string): Promise<string> {
  const prisma = getPrisma();
  try {
    await prisma.$executeRawUnsafe(sql);
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
  throw new Error(`El motor ACEPTÓ lo que no debía:\n${sql}`);
}

describe.skipIf(!e2eEnabled)("e2e · la sesión no se reescribe y de una cita sale una", () => {
  if (!e2eEnabled) console.warn(`\n${SKIP_MESSAGE}\n`);

  const prisma = getPrisma();
  // Inicializados con `randomUUID()` y no con `""` para que TypeScript les
  // dé el tipo de uuid que los `where` de Prisma exigen en una columna
  // `@db.Uuid`. El valor de verdad lo pone el `beforeEach`.
  let tenantId = randomUUID();
  let sanitariaId = randomUUID();
  let pacienteId = randomUUID();
  let citaId = randomUUID();
  let otraCitaId = randomUUID();
  let sesionId = randomUUID();

  // UN CUERPO v1, el que escribía clinica-3, y se queda así A PROPÓSITO:
  // lo que este fichero prueba son las garantías del MOTOR (una sesión por
  // cita, inmutabilidad, RESTRICT del paciente), que no miran dentro del
  // JSON. Y de paso queda como guardia de que una sesión v1 sigue
  // entrando y leyéndose después de clinica-5 — que es la promesa del
  // prompt («las sesiones v1 se siguen leyendo igual que hoy»).
  const CUERPO =
    '{"v":1,"mapaVersion":1,"lesionesVersion":1,"consejosVersion":1,' +
    '"marcas":{"L:h":{"lesion":"unero","gravedad":"MODERADA"}},' +
    '"tratamientos":["00000000-0000-4000-8000-000000000001"],' +
    '"tratamientosNombre":{"00000000-0000-4000-8000-000000000001":"Quiropodia"},' +
    '"dolor":4,"evolucion":"MEJOR","consejos":["calzado"],"proximaCita":"S4","nota":null,' +
    '"firma":{"autorNombre":"Lucía","colegiado":"28/1234","firmadaEn":"2026-10-07T10:52:00.000Z"}}';

  beforeAll(async () => {
    tenantId = randomUUID();
    await prisma.$executeRawUnsafe(
      `INSERT INTO tenants (id, name, clinical_records_enabled, crm_enabled, agenda_enabled, updated_at)
       VALUES ('${tenantId}', 'Clínica del Pie ${tenantId.slice(0, 8)}', true, true, true, now())`,
    );
  });

  afterAll(async () => {
    // LIMPIEZA EN ESTE ORDEN, y es parte de lo que se prueba: con las FKs
    // en RESTRICT y los triggers puestos no se puede empezar por el
    // tenant. Que limpiar sea incómodo es la garantía funcionando.
    const triggers: Array<[string, string]> = [
      ["clinical_entries", "clinical_entries_inmutable"],
      ["clinical_addenda", "clinical_addenda_inmutable"],
      ["clinical_access_log", "clinical_access_log_append_only"],
      ["clinical_access", "clinical_access_guard"],
    ];
    for (const [tabla, trg] of triggers) {
      await prisma.$executeRawUnsafe(
        `ALTER TABLE ${tabla} DISABLE TRIGGER ${trg}`,
      );
    }
    for (const t of [
      "clinical_addenda",
      "clinical_entries",
      "clinical_access_log",
      "clinical_access",
    ]) {
      await prisma.$executeRawUnsafe(
        `DELETE FROM ${t} WHERE tenant_id = '${tenantId}'`,
      );
    }
    for (const [tabla, trg] of triggers) {
      await prisma.$executeRawUnsafe(
        `ALTER TABLE ${tabla} ENABLE TRIGGER ${trg}`,
      );
    }
    await prisma.$executeRawUnsafe(
      `DELETE FROM appointments WHERE tenant_id = '${tenantId}'`,
    );
    await prisma.$executeRawUnsafe(
      `DELETE FROM clients WHERE tenant_id = '${tenantId}'`,
    );
    await prisma.$executeRawUnsafe(
      `DELETE FROM users WHERE tenant_id = '${tenantId}'`,
    );
    await prisma.$executeRawUnsafe(
      `DELETE FROM tenants WHERE id = '${tenantId}'`,
    );
    await shutdown();
  });

  beforeEach(async () => {
    // Lo clínico del test anterior se queda (es inmutable, no se puede
    // borrar sin desactivar triggers), así que cada caso trabaja sobre su
    // propio paciente y sus propias citas. Es la misma mecánica que
    // `clinica-valoracion.e2e.ts`.
    sanitariaId = randomUUID();
    pacienteId = randomUUID();
    citaId = randomUUID();
    otraCitaId = randomUUID();
    sesionId = randomUUID();

    await prisma.$executeRawUnsafe(
      `INSERT INTO users (id, tenant_id, email, alias, role, is_clinician, clinician_license, clinical_scope)
       VALUES ('${sanitariaId}', '${tenantId}', 'lucia-${sanitariaId.slice(0, 8)}@c.es', 'Lucía', 'CLINICIAN', true, '28/1234', 'ALL')`,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO clients (id, tenant_id, first_name, last_name, updated_at)
       VALUES ('${pacienteId}', '${tenantId}', 'Carmen', 'Rodríguez', now())`,
    );
    for (const [id, dias] of [
      [citaId, 0],
      [otraCitaId, 14],
    ] as const) {
      await prisma.$executeRawUnsafe(
        `INSERT INTO appointments (id, tenant_id, client_id, timeslot, status, updated_at)
         VALUES ('${id}', '${tenantId}', '${pacienteId}',
                 tstzrange(now() + interval '${dias} days',
                           now() + interval '${dias} days' + interval '30 min', '[)'),
                 'CONFIRMED', now())`,
      );
    }
  });

  /** Cierra la sesión de una cita, por SQL. */
  async function cerrar(cita: string, id = randomUUID()): Promise<string> {
    await prisma.$executeRawUnsafe(
      `INSERT INTO clinical_entries (id, tenant_id, client_id, author_user_id, appointment_id, kind, body)
       VALUES ('${id}', '${tenantId}', '${pacienteId}', '${sanitariaId}',
               '${cita}', 'TREATMENT_SESSION', '${CUERPO}')`,
    );
    return id;
  }

  // ── 1 · DE UNA CITA SALE UNA SOLA SESIÓN ──────────────────────────

  describe("una sesión por cita", () => {
    it("la primera entra", async () => {
      await cerrar(citaId, sesionId);
      const n = await prisma.clinicalEntry.count({
        where: { appointmentId: citaId, kind: "TREATMENT_SESSION" },
      });
      expect(n).toBe(1);
    });

    it("LA SEGUNDA NO: cerrar dos veces no crea dos cobros", async () => {
      await cerrar(citaId, sesionId);
      const msg = await debeFallar(
        `INSERT INTO clinical_entries (tenant_id, client_id, author_user_id, appointment_id, kind, body)
         VALUES ('${tenantId}', '${pacienteId}', '${sanitariaId}',
                 '${citaId}', 'TREATMENT_SESSION', '${CUERPO}')`,
      );
      // EL MENSAJE REAL. Prisma NO reenvía el nombre del índice en un
      // 23505 por `$executeRawUnsafe`: lo que llega es la clave que
      // choca. Que es, de hecho, la frase que más dice — «esta cita ya
      // tiene su sesión».
      expect(msg).toContain("Code: `23505`");
      expect(msg).toContain(`Key (appointment_id)=(${citaId}) already exists`);
    });

    it("ni con OTRO cuerpo: lo que manda es la cita, no el contenido", async () => {
      await cerrar(citaId, sesionId);
      const msg = await debeFallar(
        `INSERT INTO clinical_entries (tenant_id, client_id, author_user_id, appointment_id, kind, body)
         VALUES ('${tenantId}', '${pacienteId}', '${sanitariaId}',
                 '${citaId}', 'TREATMENT_SESSION', '{"v":1,"dolor":9}')`,
      );
      expect(msg).toContain("Code: `23505`");
    });

    it("ni la firmada por OTRA sanitaria", async () => {
      await cerrar(citaId, sesionId);
      const otra = randomUUID();
      await prisma.$executeRawUnsafe(
        `INSERT INTO users (id, tenant_id, email, alias, role, is_clinician, clinician_license, clinical_scope)
         VALUES ('${otra}', '${tenantId}', 'ana-${otra.slice(0, 8)}@c.es', 'Ana', 'CLINICIAN', true, '28/9999', 'ALL')`,
      );
      const msg = await debeFallar(
        `INSERT INTO clinical_entries (tenant_id, client_id, author_user_id, appointment_id, kind, body)
         VALUES ('${tenantId}', '${pacienteId}', '${sanitariaId}',
                 '${citaId}', 'TREATMENT_SESSION', '${CUERPO}')`,
      );
      expect(msg).toContain("Code: `23505`");
    });

    it("PERO OTRA CITA SÍ: un paciente tiene una sesión por VISITA", async () => {
      await cerrar(citaId, sesionId);
      await cerrar(otraCitaId);
      const n = await prisma.clinicalEntry.count({
        where: { clientId: pacienteId, kind: "TREATMENT_SESSION" },
      });
      expect(n).toBe(2);
    });
  });

  // ── 2 · Y por ser PARCIAL, la cita admite lo demás ────────────────

  describe("el índice es parcial, y las dos mitades hacen trabajo", () => {
    it("la misma cita admite su EXPLORACIÓN", async () => {
      await cerrar(citaId, sesionId);
      await prisma.$executeRawUnsafe(
        `INSERT INTO clinical_entries (tenant_id, client_id, author_user_id, appointment_id, kind, body)
         VALUES ('${tenantId}', '${pacienteId}', '${sanitariaId}', '${citaId}', 'FOOT_EXAM',
                 '{"v":1,"mapaVersion":1,"pulsos":{"L":"PRESENTE","R":"DEBIL"},"sinSensibilidad":["L:h"],"tipoDePie":"CAVO","firma":{"autorNombre":"Lucía","colegiado":"28/1234","firmadaEn":"2026-10-07T10:30:00.000Z"}}')`,
      );
      // Y DOS exploraciones de la misma cita también: no hay índice que lo
      // impida, y es correcto — se puede repetir en la misma visita.
      await prisma.$executeRawUnsafe(
        `INSERT INTO clinical_entries (tenant_id, client_id, author_user_id, appointment_id, kind, body)
         VALUES ('${tenantId}', '${pacienteId}', '${sanitariaId}', '${citaId}', 'FOOT_EXAM',
                 '{"v":1,"mapaVersion":1,"pulsos":{"L":"AUSENTE","R":"DEBIL"},"sinSensibilidad":[],"tipoDePie":"PLANO","firma":{"autorNombre":"Lucía","colegiado":"28/1234","firmadaEn":"2026-10-07T10:40:00.000Z"}}')`,
      );
      const n = await prisma.clinicalEntry.count({
        where: { appointmentId: citaId, kind: "FOOT_EXAM" },
      });
      expect(n).toBe(2);
    });

    it("y sus ANOTACIONES de clinica-1", async () => {
      await cerrar(citaId, sesionId);
      await prisma.$executeRawUnsafe(
        `INSERT INTO clinical_entries (tenant_id, client_id, author_user_id, appointment_id, kind, body)
         VALUES ('${tenantId}', '${pacienteId}', '${sanitariaId}', '${citaId}', 'NOTE',
                 '{"texto":"llamó para decir que le sigue doliendo"}')`,
      );
      const n = await prisma.clinicalEntry.count({
        where: { appointmentId: citaId, kind: "NOTE" },
      });
      expect(n).toBe(1);
    });

    it("el índice TOTAL sería imposible de crear con una sesión y su exploración dentro", async () => {
      // Más fuerte que un test en rojo, y es el mismo descubrimiento que
      // clinica-1 hizo con `clinical_access_one_live_key`: Postgres se
      // niega. El `WHERE kind = 'TREATMENT_SESSION'` no es una
      // optimización — es la única forma que admite este histórico.
      await cerrar(citaId, sesionId);
      await prisma.$executeRawUnsafe(
        `INSERT INTO clinical_entries (tenant_id, client_id, author_user_id, appointment_id, kind, body)
         VALUES ('${tenantId}', '${pacienteId}', '${sanitariaId}', '${citaId}', 'NOTE', '{"texto":"x"}')`,
      );
      const msg = await debeFallar(
        `CREATE UNIQUE INDEX "sabotaje_total" ON "clinical_entries"("appointment_id")`,
      );
      expect(msg).toMatch(/is duplicated|could not create unique index/i);
    });
  });

  // ── 3 · UNA SESIÓN CERRADA NO SE EDITA NI SE BORRA ────────────────

  describe("la sesión cerrada queda firmada", () => {
    it("un UPDATE del cuerpo falla", async () => {
      await cerrar(citaId, sesionId);
      const msg = await debeFallar(
        `UPDATE clinical_entries SET body = '{"v":1,"dolor":0}' WHERE id = '${sesionId}'`,
      );
      expect(msg).toContain("HISTORIA_VIOLADA");
      expect(msg).toContain("no se edita");
    });

    it("y un UPDATE que sólo cambiara el DOLOR, también", async () => {
      // El que importa de verdad: no hay forma de bajarle el dolor a una
      // sesión firmada, que es el dato del que sale la gráfica que la
      // paciente mira.
      await cerrar(citaId, sesionId);
      const msg = await debeFallar(
        `UPDATE clinical_entries
            SET body = jsonb_set(body, '{dolor}', '0')
          WHERE id = '${sesionId}'`,
      );
      expect(msg).toContain("HISTORIA_VIOLADA");
    });

    it("ni se le cambia el autor para que la firme otra", async () => {
      await cerrar(citaId, sesionId);
      const msg = await debeFallar(
        `UPDATE clinical_entries SET author_user_id = '${sanitariaId}' WHERE id = '${sesionId}'`,
      );
      expect(msg).toContain("HISTORIA_VIOLADA");
    });

    it("un DELETE falla", async () => {
      await cerrar(citaId, sesionId);
      const msg = await debeFallar(
        `DELETE FROM clinical_entries WHERE id = '${sesionId}'`,
      );
      expect(msg).toContain("HISTORIA_VIOLADA");
      expect(msg).toContain("no se borra");
    });

    it("lo ÚNICO que se le añade es una anotación, y ésa tampoco se edita", async () => {
      await cerrar(citaId, sesionId);
      const anotacion = randomUUID();
      await prisma.$executeRawUnsafe(
        `INSERT INTO clinical_addenda (id, tenant_id, entry_id, author_user_id, body)
         VALUES ('${anotacion}', '${tenantId}', '${sesionId}', '${sanitariaId}',
                 '{"texto":"me equivoqué: el callo era del 2.º dedo"}')`,
      );
      const msg = await debeFallar(
        `UPDATE clinical_addenda SET body = '{"texto":"nada"}' WHERE id = '${anotacion}'`,
      );
      expect(msg).toContain("HISTORIA_VIOLADA");
    });
  });

  // ── 4 · NADA DE ESTO SE BORRA ─────────────────────────────────────

  describe("nada de esto se borra", () => {
    it("BORRAR AL PACIENTE con sesión dentro falla", async () => {
      await cerrar(citaId, sesionId);
      const msg = await debeFallar(
        `DELETE FROM clients WHERE id = '${pacienteId}'`,
      );
      expect(msg).toContain("clinical_entries_client_id_fkey");
    });

    it("BORRAR A LA SANITARIA que la firmó, tampoco", async () => {
      await cerrar(citaId, sesionId);
      const msg = await debeFallar(
        `DELETE FROM users WHERE id = '${sanitariaId}'`,
      );
      expect(msg).toContain("clinical_entries_author_user_id_fkey");
    });

    it("ni el TENANT", async () => {
      await cerrar(citaId, sesionId);
      const msg = await debeFallar(
        `DELETE FROM tenants WHERE id = '${tenantId}'`,
      );
      expect(msg).toContain("clinical_entries_tenant_id_fkey");
    });

    it("Y LA CITA CON SESIÓN TAMPOCO SE BORRA — el hallazgo de este bloque", async () => {
      // Esto NO es lo que esperaba al escribir la migración, y es mejor.
      //
      // `clinical_entries.appointment_id` es `ON DELETE SET NULL` desde
      // clinica-1, con la idea escrita en su schema de que «si la cita
      // desapareciera, la anotación sigue en la historia y pierde el
      // enlace, no el contenido». Pero un SET NULL **es un UPDATE sobre
      // la fila**, y esa fila la protege el trigger
      // `clinical_entries_inmutable`. Así que el borrado de la cita choca
      // con la inmutabilidad y no pasa.
      //
      // O sea: en una tabla inmutable, un `ON DELETE SET NULL` no degrada
      // el dato — IMPIDE EL BORRADO DEL PADRE. El resultado es una
      // garantía más fuerte que la que la columna declara, y no hay hoy
      // ningún camino de aplicación que borre una cita (igual que no hay
      // ninguno que borre un cliente o un tenant, clinica-1 §9), así que
      // nadie se encuentra con esto por sorpresa.
      //
      // Es la misma clase de descubrimiento que clinica-1 anotó con el
      // `ON CONFLICT`: **lo que garantiza el comportamiento no siempre es
      // la línea que uno escribió pensando que lo garantizaba.**
      await cerrar(citaId, sesionId);
      const msg = await debeFallar(
        `DELETE FROM appointments WHERE id = '${citaId}'`,
      );
      expect(msg).toContain("HISTORIA_VIOLADA");
      expect(msg).toContain("no se edita");
      // Y la sesión sigue enlazada a su cita.
      const fila = await prisma.clinicalEntry.findUniqueOrThrow({
        where: { id: sesionId },
        select: { appointmentId: true, body: true, kind: true },
      });
      expect(fila.appointmentId).toBe(citaId);
      expect(fila.kind).toBe("TREATMENT_SESSION");
      expect((fila.body as { dolor?: number }).dolor).toBe(4);
    });

    it("una cita SIN sesión sí se borra: la negativa es de la historia, no de la agenda", async () => {
      await prisma.$executeRawUnsafe(
        `DELETE FROM appointments WHERE id = '${otraCitaId}'`,
      );
      const n = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
        `SELECT count(*) AS n FROM appointments WHERE id = '${otraCitaId}'`,
      );
      expect(Number(n[0]!.n)).toBe(0);
    });
  });

  // ── 5 · El cuerpo, y el catálogo ──────────────────────────────────

  describe("el cuerpo y la marca del catálogo", () => {
    it("un cuerpo VACÍO no entra (CHECK de clinica-1)", async () => {
      const msg = await debeFallar(
        `INSERT INTO clinical_entries (tenant_id, client_id, author_user_id, appointment_id, kind, body)
         VALUES ('${tenantId}', '${pacienteId}', '${sanitariaId}', '${citaId}', 'TREATMENT_SESSION', '{}')`,
      );
      expect(msg).toContain("clinical_entries_body_object");
    });

    it("ni un cuerpo que no sea un objeto", async () => {
      const msg = await debeFallar(
        `INSERT INTO clinical_entries (tenant_id, client_id, author_user_id, appointment_id, kind, body)
         VALUES ('${tenantId}', '${pacienteId}', '${sanitariaId}', '${citaId}', 'TREATMENT_SESSION', '"una sesión"')`,
      );
      expect(msg).toContain("clinical_entries_body_object");
    });

    it("una sesión SIN cita entra (y no choca con otra): la historia se conserva", async () => {
      // No hay CHECK «una sesión tiene cita» a propósito: convertiría el
      // ON DELETE SET NULL en un error duro. La regla «la sesión se abre
      // desde la cita» vive en la ruta, que es donde nace.
      await prisma.$executeRawUnsafe(
        `INSERT INTO clinical_entries (tenant_id, client_id, author_user_id, kind, body)
         VALUES ('${tenantId}', '${pacienteId}', '${sanitariaId}', 'TREATMENT_SESSION', '${CUERPO}')`,
      );
      await prisma.$executeRawUnsafe(
        `INSERT INTO clinical_entries (tenant_id, client_id, author_user_id, kind, body)
         VALUES ('${tenantId}', '${pacienteId}', '${sanitariaId}', 'TREATMENT_SESSION', '${CUERPO}')`,
      );
      const n = await prisma.clinicalEntry.count({
        where: {
          clientId: pacienteId,
          kind: "TREATMENT_SESSION",
          appointmentId: null,
        },
      });
      expect(n).toBe(2);
    });

    it("`tratamiento_sesion` nace APAGADO: ningún servicio de hoy sale como botón", async () => {
      const producto = randomUUID();
      await prisma.$executeRawUnsafe(
        `INSERT INTO products (id, tenant_id, kind, name, sku, base_price, tax_rate, active)
         VALUES ('${producto}', '${tenantId}', 'SERVICE', 'Quiropodia', 'SVC-Q-${producto.slice(0, 6)}', 30, 0, true)`,
      );
      await prisma.$executeRawUnsafe(
        `INSERT INTO service_scheduling (product_id, tenant_id, duration_min, updated_at)
         VALUES ('${producto}', '${tenantId}', 30, now())`,
      );
      const fila = await prisma.serviceScheduling.findUniqueOrThrow({
        where: { productId: producto },
        select: { tratamientoSesion: true, primeraValoracion: true },
      });
      expect(fila.tratamientoSesion).toBe(false);
      expect(fila.primeraValoracion).toBe(false);
      await prisma.$executeRawUnsafe(
        `DELETE FROM service_scheduling WHERE product_id = '${producto}'`,
      );
      await prisma.$executeRawUnsafe(
        `DELETE FROM products WHERE id = '${producto}'`,
      );
    });
  });

  // ── 6 · Y los dos valores del enum existen ────────────────────────

  it("los dos `kind` nuevos están en el enum, y los de antes siguen", async () => {
    const filas = await prisma.$queryRawUnsafe<Array<{ enumlabel: string }>>(
      `SELECT enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = 'ClinicalEntryKind' ORDER BY e.enumsortorder`,
    );
    expect(filas.map((f) => f.enumlabel)).toEqual([
      "NOTE",
      "INITIAL_ASSESSMENT",
      "FOOT_EXAM",
      "TREATMENT_SESSION",
    ]);
  });
});
