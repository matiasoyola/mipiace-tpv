// residencia-1 · la tabla «sabotaje → test rojo» de los cimientos, contra
// Postgres de verdad.
//
// Por qué tiene que ser e2e y no puede vivir con un prisma falso: lo que
// se prueba aquí es que **EL MOTOR** lo rechaza, no que la aplicación se
// porte bien. Misma razón exacta que `clinica-historia.e2e.ts` (y antes
// `sello-de-la-venta.e2e.ts` y `f2-registro-inalterable.e2e.ts`): la
// aplicación no es la única puerta a Postgres, y una regla que sólo se
// cumple mientras el código se porte bien no es una regla.
//
// Por eso cada sabotaje entra por `$executeRawUnsafe`: SQL directo, como
// lo escribiría alguien con acceso al VPS a las nueve de la noche.
//
// Las garantías, una por bloque:
//
//   1. El interruptor no se enciende sin la clínica.
//   2. Una cama, un residente. Un residente, una cama. Y el HISTÓRICO cabe.
//   3. El residente NO SE BORRA — ni él, ni su tenant, ni su cama.
//   4. Un rol de cuidado no se borra: se revoca, y el histórico cabe.
//   5. Un rol de serie no cambia de categoría ni se borra.
//   6. Una persona tiene una zona viva por planta, y una sola de «todo el
//      centro».
//   7. LA PUERTA: no es una caja, no releva al terminal, releva a la
//      puerta anterior de su habitación, y una habitación tiene una sola
//      puerta viva.
//   8. Y un TERMINAL no puede quedarse sin caja — que es la mitad del
//      CHECK que sostiene verifactu-1 ahora que la columna es nullable.

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

// ── Cómo se reconoce aquí una violación de índice único ─────────────
//
// Prisma NO reenvía el nombre del índice en el mensaje de una violación
// 23505: lo que llega es «Key (bed_id)=(…) already exists.». Así que lo que
// se afirma es la CLAVE que se duplicó, que es justo lo que distingue un
// caso de otro —`(bed_id)` es «dos residentes en una cama» y `(client_id)`
// es «un residente en dos camas»— y los NOMBRES de los índices los fija
// `residencia-migracion.test.ts` sobre el SQL. Entre los dos queda cubierto
// que el índice existe, que se llama como se llama y que es el que salta.

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

describe.skipIf(!e2eEnabled)("e2e · los cimientos de la residencia", () => {
  if (!e2eEnabled) console.warn(`\n${SKIP_MESSAGE}\n`);

  const prisma = getPrisma();
  let tenantId = "";
  let storeId = "";
  let registerId = "";
  let directoraId = "";
  let auxiliarId = "";
  let plantaId = "";
  let otraPlantaId = "";
  let habId = "";
  let otraHabId = "";
  let camaId = "";
  let otraCamaId = "";
  let carmenId = "";
  let luisId = "";
  let rolAuxiliarId = "";

  beforeAll(async () => {
    tenantId = randomUUID();
    storeId = randomUUID();
    registerId = randomUUID();
    // Un tenant de residencia tiene la clínica encendida por obligación
    // (CHECK `tenants_residencia_exige_clinica`) y la caja APAGADA. La
    // tienda y la caja se crean igual, pero sólo para poder probar el
    // bloque 7: que emparejar una puerta no releva al terminal de nadie.
    await prisma.$executeRawUnsafe(
      `INSERT INTO tenants (id, name, residencia_enabled, clinical_records_enabled, crm_enabled, agenda_enabled, caja_enabled, updated_at)
       VALUES ('${tenantId}', 'Jardín de Gredos ${tenantId.slice(0, 8)}', true, true, true, true, false, now())`,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO stores (id, tenant_id, name) VALUES ('${storeId}', '${tenantId}', 'Centro')`,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO registers (id, store_id, name) VALUES ('${registerId}', '${storeId}', 'Caja técnica')`,
    );
  });

  afterAll(async () => {
    // LIMPIEZA A PROPÓSITO EN ESTE ORDEN, y es parte de lo que se prueba:
    // con las FKs en RESTRICT no se puede empezar por el tenant. Que
    // limpiar sea incómodo es exactamente la garantía funcionando.
    await prisma.$executeRawUnsafe(`DELETE FROM devices WHERE tenant_id = '${tenantId}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM pairing_codes WHERE tenant_id = '${tenantId}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM bed_assignments WHERE tenant_id = '${tenantId}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM care_role_assignments WHERE tenant_id = '${tenantId}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM care_zone_assignments WHERE tenant_id = '${tenantId}'`);
    await prisma.$executeRawUnsafe(
      `ALTER TABLE care_roles DISABLE TRIGGER care_roles_de_serie_son_fijos`,
    );
    await prisma.$executeRawUnsafe(`DELETE FROM care_roles WHERE tenant_id = '${tenantId}'`);
    await prisma.$executeRawUnsafe(
      `ALTER TABLE care_roles ENABLE TRIGGER care_roles_de_serie_son_fijos`,
    );
    await prisma.$executeRawUnsafe(`DELETE FROM center_shifts WHERE tenant_id = '${tenantId}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM resident_profiles WHERE tenant_id = '${tenantId}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM beds WHERE tenant_id = '${tenantId}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM rooms WHERE tenant_id = '${tenantId}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM floors WHERE tenant_id = '${tenantId}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM clients WHERE tenant_id = '${tenantId}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM users WHERE tenant_id = '${tenantId}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM registers WHERE store_id = '${storeId}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM stores WHERE tenant_id = '${tenantId}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM tenants WHERE id = '${tenantId}'`);
    await shutdown();
  });

  beforeEach(async () => {
    // Todo limpio en cada caso: los índices parciales son globales por
    // tabla y un residuo de un caso anterior haría pasar o fallar el
    // siguiente por razones que no son el caso.
    await prisma.$executeRawUnsafe(`DELETE FROM devices WHERE tenant_id = '${tenantId}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM pairing_codes WHERE tenant_id = '${tenantId}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM bed_assignments WHERE tenant_id = '${tenantId}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM care_role_assignments WHERE tenant_id = '${tenantId}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM care_zone_assignments WHERE tenant_id = '${tenantId}'`);
    await prisma.$executeRawUnsafe(
      `ALTER TABLE care_roles DISABLE TRIGGER care_roles_de_serie_son_fijos`,
    );
    await prisma.$executeRawUnsafe(`DELETE FROM care_roles WHERE tenant_id = '${tenantId}'`);
    await prisma.$executeRawUnsafe(
      `ALTER TABLE care_roles ENABLE TRIGGER care_roles_de_serie_son_fijos`,
    );
    await prisma.$executeRawUnsafe(`DELETE FROM resident_profiles WHERE tenant_id = '${tenantId}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM beds WHERE tenant_id = '${tenantId}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM rooms WHERE tenant_id = '${tenantId}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM floors WHERE tenant_id = '${tenantId}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM clients WHERE tenant_id = '${tenantId}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM users WHERE tenant_id = '${tenantId}'`);

    directoraId = randomUUID();
    auxiliarId = randomUUID();
    plantaId = randomUUID();
    otraPlantaId = randomUUID();
    habId = randomUUID();
    otraHabId = randomUUID();
    camaId = randomUUID();
    otraCamaId = randomUUID();
    carmenId = randomUUID();
    luisId = randomUUID();
    rolAuxiliarId = randomUUID();

    await prisma.$executeRawUnsafe(
      `INSERT INTO users (id, tenant_id, email, alias, role, is_clinician, clinical_scope)
       VALUES
         ('${directoraId}', '${tenantId}', 'dir-${directoraId.slice(0, 8)}@g.es', 'Pilar', 'OWNER', true, 'SELECTION'),
         ('${auxiliarId}', '${tenantId}', 'aux-${auxiliarId.slice(0, 8)}@g.es', 'Rocío', 'CLINICIAN', true, 'SELECTION')`,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO floors (id, tenant_id, name, sort_order, updated_at)
       VALUES ('${plantaId}', '${tenantId}', 'Primera', 1, now()),
              ('${otraPlantaId}', '${tenantId}', 'Segunda', 2, now())`,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO rooms (id, tenant_id, floor_id, number, active, updated_at)
       VALUES ('${habId}', '${tenantId}', '${plantaId}', '112', true, now()),
              ('${otraHabId}', '${tenantId}', '${otraPlantaId}', '201', true, now())`,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO beds (id, tenant_id, room_id, label, active, updated_at)
       VALUES ('${camaId}', '${tenantId}', '${habId}', 'A', true, now()),
              ('${otraCamaId}', '${tenantId}', '${otraHabId}', 'A', true, now())`,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO clients (id, tenant_id, first_name, last_name, updated_at)
       VALUES ('${carmenId}', '${tenantId}', 'Carmen', 'Gómez', now()),
              ('${luisId}', '${tenantId}', 'Luis', 'Prieto', now())`,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO resident_profiles (client_id, tenant_id, admission_date, dependency_level, place_type, updated_at)
       VALUES ('${carmenId}', '${tenantId}', '2026-01-10', 'DEPENDIENTE', 'CONCERTADA', now()),
              ('${luisId}', '${tenantId}', '2026-02-01', 'VALIDO', 'PRIVADA', now())`,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO care_roles (id, tenant_id, code, name, category, is_standard, active, records_care, requires_license, full_scope, sort_order, updated_at)
       VALUES ('${rolAuxiliarId}', '${tenantId}', 'AUXILIAR', 'Auxiliar', 'OPERATIVO', true, true, true, false, false, 1, now())`,
    );
  });

  // ── 1 · el interruptor ─────────────────────────────────────────────
  describe("el interruptor no se enciende sin la clínica", () => {
    it("SABOTAJE · apagar la clínica de un centro de residencia falla", async () => {
      const msg = await debeFallar(
        `UPDATE tenants SET clinical_records_enabled = false WHERE id = '${tenantId}'`,
      );
      expect(msg).toContain("tenants_residencia_exige_clinica");
    });

    it("un tenant nuevo con residencia y SIN clínica no entra", async () => {
      const otro = randomUUID();
      const msg = await debeFallar(
        `INSERT INTO tenants (id, name, residencia_enabled, clinical_records_enabled, updated_at)
         VALUES ('${otro}', 'Mal montado ${otro.slice(0, 8)}', true, false, now())`,
      );
      expect(msg).toContain("tenants_residencia_exige_clinica");
    });

    it("y la CLÍNICA sí puede estar encendida sola (la podóloga de clinica-1)", async () => {
      const otro = randomUUID();
      await prisma.$executeRawUnsafe(
        `INSERT INTO tenants (id, name, residencia_enabled, clinical_records_enabled, updated_at)
         VALUES ('${otro}', 'Podología ${otro.slice(0, 8)}', false, true, now())`,
      );
      await prisma.$executeRawUnsafe(`DELETE FROM tenants WHERE id = '${otro}'`);
    });
  });

  // ── 2 · la ocupación ───────────────────────────────────────────────
  describe("una cama un residente, un residente una cama", () => {
    async function ocupar(bedId: string, clientId: string, desde = "now()") {
      await prisma.$executeRawUnsafe(
        `INSERT INTO bed_assignments (id, tenant_id, bed_id, client_id, from_at)
         VALUES ('${randomUUID()}', '${tenantId}', '${bedId}', '${clientId}', ${desde})`,
      );
    }

    it("DOS RESIDENTES EN LA MISMA CAMA → rechazado", async () => {
      await ocupar(camaId, carmenId);
      const msg = await debeFallar(
        `INSERT INTO bed_assignments (id, tenant_id, bed_id, client_id, from_at)
         VALUES ('${randomUUID()}', '${tenantId}', '${camaId}', '${luisId}', now())`,
      );
      expect(msg).toContain("Key (bed_id)=");
    });

    it("UN RESIDENTE EN DOS CAMAS → rechazado", async () => {
      await ocupar(camaId, carmenId);
      const msg = await debeFallar(
        `INSERT INTO bed_assignments (id, tenant_id, bed_id, client_id, from_at)
         VALUES ('${randomUUID()}', '${tenantId}', '${otraCamaId}', '${carmenId}', now())`,
      );
      expect(msg).toContain("Key (client_id)=");
    });

    it("CAMBIAR DE HABITACIÓN sí: cerrar una y abrir otra", async () => {
      await ocupar(camaId, carmenId, `'2026-01-10'`);
      await prisma.$executeRawUnsafe(
        `UPDATE bed_assignments SET to_at = now(), reason = 'cambio de habitación'
         WHERE client_id = '${carmenId}' AND to_at IS NULL`,
      );
      await ocupar(otraCamaId, carmenId);
      const filas = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
        `SELECT count(*) AS n FROM bed_assignments WHERE client_id = '${carmenId}'`,
      );
      // DOS filas: la vieja se cierra, no se edita. «¿Dónde dormía doña
      // Carmen en marzo?» tiene respuesta.
      expect(Number(filas[0]!.n)).toBe(2);
    });

    it("Y EL HISTÓRICO CABE: tres traslados, tres filas cerradas, una viva", async () => {
      // Con un índice TOTAL esto no sería «menos correcto»: sería
      // IMPOSIBLE. Es la misma lección que `clinical_access_one_live_key`
      // en clinica-1, donde Postgres se negó a crear la versión no parcial.
      for (const [de, a] of [
        [camaId, otraCamaId],
        [otraCamaId, camaId],
        [camaId, otraCamaId],
      ]) {
        void de;
        await prisma.$executeRawUnsafe(
          `UPDATE bed_assignments SET to_at = now() WHERE client_id = '${carmenId}' AND to_at IS NULL`,
        );
        await ocupar(a!, carmenId);
      }
      const vivas = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
        `SELECT count(*) AS n FROM bed_assignments WHERE client_id = '${carmenId}' AND to_at IS NULL`,
      );
      expect(Number(vivas[0]!.n)).toBe(1);
      const total = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
        `SELECT count(*) AS n FROM bed_assignments WHERE client_id = '${carmenId}'`,
      );
      expect(Number(total[0]!.n)).toBe(3);
    });

    it("una ocupación que acaba ANTES de empezar no entra", async () => {
      const msg = await debeFallar(
        `INSERT INTO bed_assignments (id, tenant_id, bed_id, client_id, from_at, to_at)
         VALUES ('${randomUUID()}', '${tenantId}', '${camaId}', '${carmenId}', now(), now() - interval '1 day')`,
      );
      expect(msg).toContain("bed_assignments_vigencia");
    });
  });

  // ── 3 · lo que no se borra ─────────────────────────────────────────
  describe("el residente no se borra", () => {
    it("BORRAR AL RESIDENTE con perfil falla", async () => {
      const msg = await debeFallar(
        `DELETE FROM clients WHERE id = '${carmenId}'`,
      );
      expect(msg).toContain("resident_profiles_client_id_fkey");
    });

    it("y CON LA OCUPACIÓN, el borrado sigue cerrado aunque se quite el perfil", async () => {
      // El perfil SÍ se puede retirar a mano (es una ampliación 1:1, no
      // historia clínica en sí). Lo que no se puede es dejar la ocupación
      // apuntando a un cliente borrado — y ésa es la segunda FK que cierra
      // el camino. O sea: quitar el perfil no abre el borrado del
      // residente, que es exactamente lo que había que comprobar.
      await prisma.$executeRawUnsafe(
        `INSERT INTO bed_assignments (id, tenant_id, bed_id, client_id, from_at)
         VALUES ('${randomUUID()}', '${tenantId}', '${camaId}', '${carmenId}', now())`,
      );
      await prisma.$executeRawUnsafe(
        `DELETE FROM resident_profiles WHERE client_id = '${carmenId}'`,
      );
      const msg = await debeFallar(
        `DELETE FROM clients WHERE id = '${carmenId}'`,
      );
      expect(msg).toContain("bed_assignments_client_id_fkey");
    });

    it("BORRAR EL TENANT con residentes dentro falla", async () => {
      const msg = await debeFallar(`DELETE FROM tenants WHERE id = '${tenantId}'`);
      expect(msg).toContain("resident_profiles_tenant_id_fkey");
    });

    it("BORRAR LA CAMA con histórico falla, y la PLANTA con habitaciones también", async () => {
      await prisma.$executeRawUnsafe(
        `INSERT INTO bed_assignments (id, tenant_id, bed_id, client_id, from_at, to_at)
         VALUES ('${randomUUID()}', '${tenantId}', '${camaId}', '${carmenId}', '2026-01-10', '2026-03-01')`,
      );
      const cama = await debeFallar(`DELETE FROM beds WHERE id = '${camaId}'`);
      expect(cama).toContain("bed_assignments_bed_id_fkey");
      const planta = await debeFallar(
        `DELETE FROM floors WHERE id = '${plantaId}'`,
      );
      expect(planta).toContain("rooms_floor_id_fkey");
    });

    it("DAR DE ALTA sí: la fecha entra y la ocupación se cierra", async () => {
      await prisma.$executeRawUnsafe(
        `INSERT INTO bed_assignments (id, tenant_id, bed_id, client_id, from_at)
         VALUES ('${randomUUID()}', '${tenantId}', '${camaId}', '${carmenId}', '2026-01-10')`,
      );
      await prisma.$executeRawUnsafe(
        `UPDATE resident_profiles SET discharge_date = '2026-06-30', discharge_reason = 'se va con su hija'
         WHERE client_id = '${carmenId}'`,
      );
      await prisma.$executeRawUnsafe(
        `UPDATE bed_assignments SET to_at = '2026-06-30', reason = 'alta'
         WHERE client_id = '${carmenId}' AND to_at IS NULL`,
      );
      // Y la cama queda libre para el siguiente, que es la forma en que un
      // «dar de alta» que no cerrara la ocupación se habría descubierto:
      // con una familia esperando en la puerta.
      await prisma.$executeRawUnsafe(
        `INSERT INTO bed_assignments (id, tenant_id, bed_id, client_id, from_at)
         VALUES ('${randomUUID()}', '${tenantId}', '${camaId}', '${luisId}', now())`,
      );
    });

    it("un MOTIVO de alta SIN FECHA no entra", async () => {
      const msg = await debeFallar(
        `UPDATE resident_profiles SET discharge_reason = 'se fue' WHERE client_id = '${carmenId}'`,
      );
      expect(msg).toContain("resident_profiles_alta_coherente");
    });

    it("una fecha de alta ANTERIOR al ingreso no entra", async () => {
      const msg = await debeFallar(
        `UPDATE resident_profiles SET discharge_date = '2025-12-01' WHERE client_id = '${carmenId}'`,
      );
      expect(msg).toContain("resident_profiles_alta_coherente");
    });

    it("un DNI en blanco no entra: lo que no se sabe va NULL", async () => {
      const msg = await debeFallar(
        `UPDATE resident_profiles SET dni = '   ' WHERE client_id = '${carmenId}'`,
      );
      expect(msg).toContain("resident_profiles_identificacion_not_blank");
    });
  });

  // ── 4 y 5 · los roles de cuidado ───────────────────────────────────
  describe("los roles de cuidado", () => {
    async function asignar(userId: string, careRoleId: string) {
      const id = randomUUID();
      await prisma.$executeRawUnsafe(
        `INSERT INTO care_role_assignments (id, tenant_id, user_id, care_role_id, from_at)
         VALUES ('${id}', '${tenantId}', '${userId}', '${careRoleId}', now())`,
      );
      return id;
    }

    it("DOS ASIGNACIONES VIVAS del mismo rol a la misma persona → rechazado", async () => {
      await asignar(auxiliarId, rolAuxiliarId);
      const msg = await debeFallar(
        `INSERT INTO care_role_assignments (id, tenant_id, user_id, care_role_id, from_at)
         VALUES ('${randomUUID()}', '${tenantId}', '${auxiliarId}', '${rolAuxiliarId}', now())`,
      );
      expect(msg).toContain("Key (user_id, care_role_id)=");
    });

    it("REVOCAR Y VOLVER A DAR sí: la revocada se queda en el histórico", async () => {
      // Es la decisión de producto 4. Y con un índice total esto sería
      // imposible, igual que en clinica-1.
      const primera = await asignar(auxiliarId, rolAuxiliarId);
      await prisma.$executeRawUnsafe(
        `UPDATE care_role_assignments SET revoked_at = now(), revoked_by_user_id = '${directoraId}'
         WHERE id = '${primera}'`,
      );
      await asignar(auxiliarId, rolAuxiliarId);
      const filas = await prisma.$queryRawUnsafe<
        Array<{ revoked_at: Date | null }>
      >(
        `SELECT revoked_at FROM care_role_assignments WHERE user_id = '${auxiliarId}' ORDER BY granted_at`,
      );
      expect(filas).toHaveLength(2);
      expect(filas[0]!.revoked_at).not.toBeNull();
      expect(filas[1]!.revoked_at).toBeNull();
    });

    it("UNA PERSONA PUEDE LLEVAR DOS ROLES A LA VEZ (TO y Calidad)", async () => {
      const rolCalidad = randomUUID();
      await prisma.$executeRawUnsafe(
        `INSERT INTO care_roles (id, tenant_id, code, name, category, is_standard, records_care, requires_license, full_scope, updated_at)
         VALUES ('${rolCalidad}', '${tenantId}', 'CALIDAD', 'Calidad', 'SUPERVISOR', true, true, false, true, now())`,
      );
      await asignar(auxiliarId, rolAuxiliarId);
      await asignar(auxiliarId, rolCalidad);
      const filas = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
        `SELECT count(*) AS n FROM care_role_assignments WHERE user_id = '${auxiliarId}' AND revoked_at IS NULL`,
      );
      expect(Number(filas[0]!.n)).toBe(2);
    });

    it("una asignación NO SE QUEDA HUÉRFANA: borrar al usuario falla", async () => {
      await asignar(auxiliarId, rolAuxiliarId);
      const msg = await debeFallar(`DELETE FROM users WHERE id = '${auxiliarId}'`);
      expect(msg).toContain("care_role_assignments_user_id_fkey");
    });

    it("y borrar el ROL con asignaciones —aunque estén revocadas— falla", async () => {
      const a = await asignar(auxiliarId, rolAuxiliarId);
      await prisma.$executeRawUnsafe(
        `UPDATE care_role_assignments SET revoked_at = now() WHERE id = '${a}'`,
      );
      const msg = await debeFallar(
        `DELETE FROM care_roles WHERE id = '${rolAuxiliarId}'`,
      );
      // El trigger salta primero (es un rol de serie), y los dos motivos
      // son correctos: el histórico está firmado con ese rol.
      expect(msg).toMatch(
        /RESIDENCIA_VIOLADA|care_role_assignments_care_role_id_fkey/,
      );
    });

    it("SABOTAJE · cambiar la CATEGORÍA de un rol de serie falla", async () => {
      // Si «dirección» pudiera bajar a OPERATIVO, el cierre de incidencias
      // N3/N4 de residencia-4 dejaría de significar lo que la norma dice.
      const msg = await debeFallar(
        `UPDATE care_roles SET category = 'DIRECTIVO' WHERE id = '${rolAuxiliarId}'`,
      );
      expect(msg).toContain("RESIDENCIA_VIOLADA");
      expect(msg).toContain("La categoría y el alcance los fija el producto");
    });

    it("SABOTAJE · darle ALCANCE TOTAL a un rol de serie falla", async () => {
      const msg = await debeFallar(
        `UPDATE care_roles SET full_scope = true WHERE id = '${rolAuxiliarId}'`,
      );
      expect(msg).toContain("RESIDENCIA_VIOLADA");
    });

    it("SABOTAJE · borrar un rol de serie falla: se desactiva", async () => {
      const msg = await debeFallar(
        `DELETE FROM care_roles WHERE id = '${rolAuxiliarId}'`,
      );
      expect(msg).toContain("no se borra");
    });

    it("de un rol de serie SÍ se puede cambiar el nombre, el orden y si está activo", async () => {
      await prisma.$executeRawUnsafe(
        `UPDATE care_roles SET name = 'Gerocultora', sort_order = 5, active = false, updated_at = now()
         WHERE id = '${rolAuxiliarId}'`,
      );
      const filas = await prisma.$queryRawUnsafe<
        Array<{ name: string; active: boolean }>
      >(`SELECT name, active FROM care_roles WHERE id = '${rolAuxiliarId}'`);
      expect(filas[0]).toMatchObject({ name: "Gerocultora", active: false });
    });

    it("y un rol PROPIO del centro sí cambia de categoría y sí se borra", async () => {
      const propio = randomUUID();
      await prisma.$executeRawUnsafe(
        `INSERT INTO care_roles (id, tenant_id, code, name, category, is_standard, records_care, requires_license, full_scope, updated_at)
         VALUES ('${propio}', '${tenantId}', 'FISIO_TARDE', 'Fisio de tarde', 'OPERATIVO', false, true, true, false, now())`,
      );
      await prisma.$executeRawUnsafe(
        `UPDATE care_roles SET category = 'SUPERVISOR', updated_at = now() WHERE id = '${propio}'`,
      );
      await prisma.$executeRawUnsafe(`DELETE FROM care_roles WHERE id = '${propio}'`);
    });
  });

  // ── 6 · la zona ────────────────────────────────────────────────────
  describe("la zona", () => {
    it("DOS ZONAS VIVAS de la misma planta para la misma persona → rechazado", async () => {
      await prisma.$executeRawUnsafe(
        `INSERT INTO care_zone_assignments (id, tenant_id, user_id, floor_id, from_at)
         VALUES ('${randomUUID()}', '${tenantId}', '${auxiliarId}', '${plantaId}', now())`,
      );
      const msg = await debeFallar(
        `INSERT INTO care_zone_assignments (id, tenant_id, user_id, floor_id, from_at)
         VALUES ('${randomUUID()}', '${tenantId}', '${auxiliarId}', '${plantaId}', now())`,
      );
      expect(msg).toContain("Key (user_id, floor_id)=");
    });

    it("DOS ZONAS DE «TODO EL CENTRO» → rechazado, y hace falta el SEGUNDO índice", async () => {
      // En Postgres los NULL son distintos entre sí, así que el índice de
      // `(user_id, floor_id)` NO cubre esto: dos filas con `floor_id IS
      // NULL` serían dos claves distintas y las dos entrarían. Por eso hay
      // un segundo índice parcial. Mismo caso exacto que
      // `ticket_allergies_mesa_key` en kds-1.
      await prisma.$executeRawUnsafe(
        `INSERT INTO care_zone_assignments (id, tenant_id, user_id, from_at)
         VALUES ('${randomUUID()}', '${tenantId}', '${auxiliarId}', now())`,
      );
      const msg = await debeFallar(
        `INSERT INTO care_zone_assignments (id, tenant_id, user_id, from_at)
         VALUES ('${randomUUID()}', '${tenantId}', '${auxiliarId}', now())`,
      );
      expect(msg).toContain("Key (user_id)=");
    });

    it("DOS PLANTAS A LA VEZ sí: una auxiliar puede cubrir dos", async () => {
      for (const p of [plantaId, otraPlantaId]) {
        await prisma.$executeRawUnsafe(
          `INSERT INTO care_zone_assignments (id, tenant_id, user_id, floor_id, from_at)
           VALUES ('${randomUUID()}', '${tenantId}', '${auxiliarId}', '${p}', now())`,
        );
      }
      const filas = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
        `SELECT count(*) AS n FROM care_zone_assignments WHERE user_id = '${auxiliarId}' AND to_at IS NULL`,
      );
      expect(Number(filas[0]!.n)).toBe(2);
    });

    it("retirar una PLANTA con alguien asignado falla", async () => {
      await prisma.$executeRawUnsafe(
        `INSERT INTO care_zone_assignments (id, tenant_id, user_id, floor_id, from_at)
         VALUES ('${randomUUID()}', '${tenantId}', '${auxiliarId}', '${plantaId}', now())`,
      );
      // Primero caen las habitaciones; se quitan y queda la zona.
      await prisma.$executeRawUnsafe(`DELETE FROM beds WHERE room_id = '${habId}'`);
      await prisma.$executeRawUnsafe(`DELETE FROM rooms WHERE id = '${habId}'`);
      const msg = await debeFallar(`DELETE FROM floors WHERE id = '${plantaId}'`);
      expect(msg).toContain("care_zone_assignments_floor_id_fkey");
    });
  });

  // ── 7 y 8 · LA PUERTA ──────────────────────────────────────────────
  describe("la puerta de la habitación", () => {
    async function emparejar(opts: {
      kind: "ROOM" | "TERMINAL";
      roomId?: string;
      registerId?: string;
    }) {
      const id = randomUUID();
      await prisma.$executeRawUnsafe(
        `INSERT INTO devices (id, tenant_id, kind, room_id, register_id, device_token_hash)
         VALUES ('${id}', '${tenantId}', '${opts.kind}',
                 ${opts.roomId ? `'${opts.roomId}'` : "NULL"},
                 ${opts.registerId ? `'${opts.registerId}'` : "NULL"},
                 '${randomBytes(16).toString("hex")}')`,
      );
      return id;
    }

    it("un ROOM se empareja SIN CAJA y con habitación", async () => {
      const id = await emparejar({ kind: "ROOM", roomId: habId });
      const filas = await prisma.$queryRawUnsafe<
        Array<{ register_id: string | null; room_id: string }>
      >(`SELECT register_id, room_id FROM devices WHERE id = '${id}'`);
      expect(filas[0]!.register_id).toBeNull();
      expect(filas[0]!.room_id).toBe(habId);
    });

    it("SABOTAJE · un ROOM CON CAJA no entra", async () => {
      const msg = await debeFallar(
        `INSERT INTO devices (id, tenant_id, kind, room_id, register_id, device_token_hash)
         VALUES ('${randomUUID()}', '${tenantId}', 'ROOM', '${habId}', '${registerId}', '${randomBytes(16).toString("hex")}')`,
      );
      expect(msg).toContain("devices_register_o_habitacion");
    });

    it("SABOTAJE · un ROOM SIN habitación no entra", async () => {
      const msg = await debeFallar(
        `INSERT INTO devices (id, tenant_id, kind, room_id, register_id, device_token_hash)
         VALUES ('${randomUUID()}', '${tenantId}', 'ROOM', NULL, NULL, '${randomBytes(16).toString("hex")}')`,
      );
      expect(msg).toContain("devices_register_o_habitacion");
    });

    it("SABOTAJE · UN TERMINAL SIN CAJA NO ENTRA — la mitad que sostiene verifactu", async () => {
      // Es la razón por la que el CHECK tiene dos mitades. Sin ésta, un
      // TERMINAL con `register_id` NULL se saldría del índice único
      // `devices_one_active_per_register_key` —en Postgres los NULL son
      // distintos entre sí— y una caja podría acabar con dos terminales
      // vivos facturando en la misma cadena. O sea: hacer la columna
      // nullable habría reabierto exactamente lo que verifactu-1 cerró.
      const msg = await debeFallar(
        `INSERT INTO devices (id, tenant_id, kind, room_id, register_id, device_token_hash)
         VALUES ('${randomUUID()}', '${tenantId}', 'TERMINAL', NULL, NULL, '${randomBytes(16).toString("hex")}')`,
      );
      expect(msg).toContain("devices_register_o_habitacion");
    });

    it("SABOTAJE · un TERMINAL con HABITACIÓN tampoco", async () => {
      const msg = await debeFallar(
        `INSERT INTO devices (id, tenant_id, kind, room_id, register_id, device_token_hash)
         VALUES ('${randomUUID()}', '${tenantId}', 'TERMINAL', '${habId}', '${registerId}', '${randomBytes(16).toString("hex")}')`,
      );
      expect(msg).toContain("devices_register_o_habitacion");
    });

    it("EMPAREJAR UNA PUERTA NO RELEVA AL TERMINAL DE LA CAJA", async () => {
      // El trigger `devices_revoke_previous` y el índice parcial de
      // verifactu-1 filtran los dos `kind = 'TERMINAL'`, así que un valor
      // nuevo cae fuera por construcción. Se prueba, no se supone.
      const terminal = await emparejar({ kind: "TERMINAL", registerId });
      await emparejar({ kind: "ROOM", roomId: habId });
      await emparejar({ kind: "ROOM", roomId: otraHabId });
      const filas = await prisma.$queryRawUnsafe<
        Array<{ revoked_at: Date | null }>
      >(`SELECT revoked_at FROM devices WHERE id = '${terminal}'`);
      expect(filas[0]!.revoked_at).toBeNull();
    });

    it("y UNA PUERTA NUEVA RELEVA A LA ANTERIOR DE SU HABITACIÓN, y sólo a ésa", async () => {
      const vieja112 = await emparejar({ kind: "ROOM", roomId: habId });
      const otra201 = await emparejar({ kind: "ROOM", roomId: otraHabId });
      const nueva112 = await emparejar({ kind: "ROOM", roomId: habId });
      const filas = await prisma.$queryRawUnsafe<
        Array<{ id: string; revoked_at: Date | null; revoked_reason: string | null; revoked_by_device_id: string | null }>
      >(
        `SELECT id, revoked_at, revoked_reason, revoked_by_device_id FROM devices
         WHERE id IN ('${vieja112}', '${otra201}', '${nueva112}')`,
      );
      const porId = new Map(filas.map((f) => [f.id, f]));
      expect(porId.get(vieja112)!.revoked_at).not.toBeNull();
      expect(porId.get(vieja112)!.revoked_reason).toBe("PAIRED_NEW");
      expect(porId.get(vieja112)!.revoked_by_device_id).toBe(nueva112);
      // La de la 201 sigue viva: una puerta no releva a la de al lado.
      expect(porId.get(otra201)!.revoked_at).toBeNull();
      expect(porId.get(nueva112)!.revoked_at).toBeNull();
    });

    it("SABOTAJE · sin el relevo, DOS PUERTAS VIVAS en la misma habitación no entran", async () => {
      // Con el trigger desactivado, el índice parcial
      // `devices_one_active_per_room_key` es el que para el segundo INSERT.
      // Es la red de seguridad: si el relevo dejara de correr, lo que sale
      // es un error y no dos tablets firmando el mismo registro.
      await emparejar({ kind: "ROOM", roomId: habId });
      await prisma.$executeRawUnsafe(
        `ALTER TABLE devices DISABLE TRIGGER devices_revoke_previous`,
      );
      try {
        const msg = await debeFallar(
          `INSERT INTO devices (id, tenant_id, kind, room_id, device_token_hash)
           VALUES ('${randomUUID()}', '${tenantId}', 'ROOM', '${habId}', '${randomBytes(16).toString("hex")}')`,
        );
        expect(msg).toContain("Key (room_id)=");
      } finally {
        await prisma.$executeRawUnsafe(
          `ALTER TABLE devices ENABLE TRIGGER devices_revoke_previous`,
        );
      }
    });

    it("retirar una HABITACIÓN con su tablet emparejada falla", async () => {
      await emparejar({ kind: "ROOM", roomId: habId });
      await prisma.$executeRawUnsafe(`DELETE FROM beds WHERE room_id = '${habId}'`);
      const msg = await debeFallar(`DELETE FROM rooms WHERE id = '${habId}'`);
      expect(msg).toContain("devices_room_id_fkey");
    });

    it("UN `ROOM` NO EMITE REGISTRO DE FACTURACIÓN: no tiene caja con la que encadenar", async () => {
      // `fiscal_records.register_id` sigue siendo NOT NULL y un `ROOM` no
      // tiene caja, así que no hay forma de escribir un registro fiscal a
      // su nombre. Y la otra mitad —que no llegue a intentarlo— la da el
      // 403 de `requireDeviceToken`, que tiene su test en
      // `residencia-rutas.test.ts`.
      const puerta = await emparejar({ kind: "ROOM", roomId: habId });
      const msg = await debeFallar(
        `INSERT INTO fiscal_records
           (id, tenant_id, register_id, external_id, kind, chain_index, serie, numero,
            num_serie_factura, fecha_expedicion, tipo_factura, cuota_total, importe_total,
            huella, primer_registro, fecha_hora_huso_gen, huella_input, payload,
            device_id, generated_at, chain_status)
         VALUES ('${randomUUID()}', '${tenantId}', NULL, '${randomUUID()}', 'ALTA', 1, 'C1', 1,
                 'C1/1', now()::date, 'F2', 0, 0, 'x', true, 'z', 'i', '{}'::jsonb,
                 '${puerta}', now(), 'OK')`,
      );
      // `23502` es la violación de NOT NULL. Prisma no reenvía el nombre de
      // la columna, pero sí la fila que falló, y el NULL está en la tercera
      // posición: `register_id`. El nombre de la columna lo fija el schema
      // (`fiscalRecords.registerId` sigue siendo `String`, no `String?`).
      expect(msg).toContain("Code: `23502`");
      expect(msg).toContain(`${tenantId}, null,`);
    });

    it("el código de emparejamiento de una puerta tampoco lleva caja", async () => {
      const code = String(Math.floor(Math.random() * 900000) + 100000);
      await prisma.$executeRawUnsafe(
        `INSERT INTO pairing_codes (id, tenant_id, register_id, room_id, code, created_by_user_id, expires_at, kind)
         VALUES ('${randomUUID()}', '${tenantId}', NULL, '${habId}', '${code}', '${directoraId}', now() + interval '1 hour', 'ROOM')`,
      );
      const msg = await debeFallar(
        `INSERT INTO pairing_codes (id, tenant_id, register_id, room_id, code, created_by_user_id, expires_at, kind)
         VALUES ('${randomUUID()}', '${tenantId}', '${registerId}', '${habId}', '${code}9', '${directoraId}', now() + interval '1 hour', 'ROOM')`,
      );
      expect(msg).toContain("pairing_codes_register_o_habitacion");
    });
  });

  // ── Los turnos ─────────────────────────────────────────────────────
  describe("los turnos del centro", () => {
    it("una hora mal escrita no entra", async () => {
      const msg = await debeFallar(
        `INSERT INTO center_shifts (id, tenant_id, code, name, starts_at, ends_at, updated_at)
         VALUES ('${randomUUID()}', '${tenantId}', 'X', 'Malo', '8:00', '15:00', now())`,
      );
      expect(msg).toContain("center_shifts_horas_validas");
    });

    it("un turno de cero horas (inicio = fin) no entra", async () => {
      const msg = await debeFallar(
        `INSERT INTO center_shifts (id, tenant_id, code, name, starts_at, ends_at, updated_at)
         VALUES ('${randomUUID()}', '${tenantId}', 'Y', 'Ambiguo', '08:00', '08:00', now())`,
      );
      expect(msg).toContain("center_shifts_horas_validas");
    });

    it("LA NOCHE (22:00 → 08:00) SÍ entra: no hay CHECK de orden", async () => {
      const id = randomUUID();
      await prisma.$executeRawUnsafe(
        `INSERT INTO center_shifts (id, tenant_id, code, name, starts_at, ends_at, sort_order, updated_at)
         VALUES ('${id}', '${tenantId}', 'N', 'Noche', '22:00', '08:00', 3, now())`,
      );
      await prisma.$executeRawUnsafe(`DELETE FROM center_shifts WHERE id = '${id}'`);
    });
  });
});
