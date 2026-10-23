// residencia-1b · LO QUE ES DE UN RESIDENTE, CIFRADO EN REPOSO, contra
// Postgres de verdad.
//
// Por qué tiene que ser e2e: lo que se prueba aquí es que **EL MOTOR** no
// deja escribir el claro en una columna cifrada, que un valor movido a
// mano no se descifra y que un `SELECT` en crudo sobre las tres tablas no
// enseña nada. Las tres cosas las contesta Postgres o no las contesta
// nadie — y las tres son la razón de existir del bloque.
//
// A diferencia de `residencia-1.e2e.ts` y `residencia-2.e2e.ts`, este
// fichero **monta las rutas**: lo que hay que ver es el camino completo
// —la pantalla escribe, la base guarda ciphertext, la pantalla vuelve a
// leer lo mismo que antes— y eso no se ve mirando sólo el esquema.
//
// Las garantías, una por bloque:
//
//   1. Dar de alta a un residente guarda el DNI, el NSS, el motivo de la
//      cama y los motivos del plan CIFRADOS, y el claro a NULL.
//   2. La ficha, la lista y el plan devuelven lo MISMO que antes del
//      bloque.
//   3. El CHECK de formato rechaza el claro en la columna cifrada.
//   4. Un valor movido a otra fila / otra columna / otro centro NO se
//      descifra, y la ficha sale con el hueco marcado en vez de caerse.
//   5. Sin la DEK del centro, la ficha se sigue sirviendo: huecos.
//   6. El `resident_profiles_alta_coherente` sigue exigiendo fecha cuando
//      hay motivo, ahora también si el motivo está cifrado.
//   7. UN `SELECT` EN CRUDO sobre las tres tablas, y un recorrido por
//      TODAS las tablas del esquema buscando el canario: no aparece.
//   8. El script de cifrado pasa lo que ya estaba escrito en claro, y es
//      idempotente.

import { randomBytes, randomUUID } from "node:crypto";

import Fastify, { type FastifyInstance } from "fastify";
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
const { cargarCatalogoDeSerie } = await import(
  "../src/residencia/catalogo/cargar-catalogo.js"
);
const { sembrarResidencia } = await import("../src/residencia/semilla.js");
const { registerResidenciaResidentesRoutes } = await import(
  "../src/residencia/residentes-routes.js"
);
const { registerResidenciaPlanRoutes } = await import(
  "../src/residencia/plan-routes.js"
);
const { signAccessToken } = await import("../src/auth/tokens.js");
const { dekDe, olvidarClaves } = await import("../src/clinica/claves.js");
const { olvidarEstado } = await import("../src/clinica/contrato.js");
const { cifrarValor, descifrarValor } = await import("../src/clinica/cripto.js");
const {
  TEXTO_ILEGIBLE,
  sitioDniDeResidente,
  sitioMotivoDeAlta,
  sitioMotivoDeLinea,
  sitioMotivoDeOcupacion,
  sitioNssDeResidente,
} = await import("../src/clinica/cripto-campos.js");

/** El DNI y el NSS que se teclean. Son el canario de este fichero: si
 *  aparecen en un volcado, el bloque no sirve. */
const DNI = "CANARIO-DNI-11223344Z";
const NSS = "CANARIO-NSS-281234567840";
const MOTIVO_ALTA = "CANARIO-ALTA-fallecimiento";

/** Un INSERT/UPDATE tiene que FALLAR. Devuelve el mensaje real. */
async function debeFallar(sql: string): Promise<string> {
  const prisma = getPrisma();
  try {
    await prisma.$executeRawUnsafe(sql);
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
  throw new Error(`El motor ACEPTÓ lo que no debía:\n${sql}`);
}

describe.skipIf(!e2eEnabled)("e2e · residencia cifrada en reposo", () => {
  if (!e2eEnabled) console.warn(`\n${SKIP_MESSAGE}\n`);

  const prisma = getPrisma();
  let app: FastifyInstance;
  let tenantId = "";
  let otroTenantId = "";
  let directoraId = "";
  let otraDirectoraId = "";
  let plantaId = "";
  let habId = "";
  let camaId = "";
  let otraCamaId = "";
  let comoDirectora: Record<string, string> = {};

  /** El alta de un residente por la ruta de verdad. Devuelve su clientId. */
  async function darDeAlta(opts: {
    nombre: string;
    dni?: string;
    nss?: string;
    bedId?: string;
  }): Promise<string> {
    const r = await app.inject({
      method: "POST",
      url: "/residencia/residentes",
      headers: comoDirectora,
      payload: {
        firstName: opts.nombre,
        lastName: "Núñez",
        admissionDate: "2026-10-01",
        dependencyLevel: "DEPENDIENTE",
        placeType: "PRIVADA",
        ...(opts.dni ? { dni: opts.dni } : {}),
        ...(opts.nss ? { nss: opts.nss } : {}),
        ...(opts.bedId ? { bedId: opts.bedId } : {}),
      },
    });
    expect(r.statusCode, r.body).toBe(201);
    return r.json().residente.clientId as string;
  }

  beforeAll(async () => {
    await cargarCatalogoDeSerie();

    tenantId = randomUUID();
    otroTenantId = randomUUID();
    directoraId = randomUUID();
    otraDirectoraId = randomUUID();

    for (const [t, u] of [
      [tenantId, directoraId],
      [otroTenantId, otraDirectoraId],
    ] as const) {
      await prisma.$executeRawUnsafe(
        `INSERT INTO tenants (id, name, residencia_enabled, clinical_records_enabled, crm_enabled, agenda_enabled, caja_enabled, updated_at)
         VALUES ('${t}', 'Centro ${t.slice(0, 8)}', true, true, true, true, false, now())`,
      );
      await prisma.$executeRawUnsafe(
        `INSERT INTO users (id, tenant_id, email, alias, role, is_clinician, clinical_scope)
         VALUES ('${u}', '${t}', 'dir-${u.slice(0, 8)}@gredos.es', 'Pilar', 'OWNER', true, 'SELECTION')`,
      );
      await sembrarResidencia(prisma as never, t);
      // El rol de DIRECCIÓN, vigente: en una residencia el acceso lo da el
      // rol de cuidado y no `clinicalScope` (D-51). Sin esto, `conHistoria`
      // contesta 403 `SIN_ROL_DE_CUIDADO`.
      await prisma.$executeRawUnsafe(
        `INSERT INTO care_role_assignments (id, tenant_id, user_id, care_role_id, from_at, granted_by_user_id)
         SELECT '${randomUUID()}', '${t}', '${u}', id, now() - interval '1 day', '${u}'
         FROM care_roles WHERE tenant_id = '${t}' AND code = 'DIRECCION'`,
      );
      // clinica-7 · EL CONTRATO DE ENCARGADO, ACEPTADO. Sin él
      // `conHistoria` contesta 423 a todo, y es la garantía funcionando:
      // un centro sin contrato no escribe nada de nadie.
      await prisma.$executeRawUnsafe(
        `INSERT INTO clinical_processor_agreements (id, tenant_id, version, text_sha256, user_id, at)
         VALUES ('${randomUUID()}', '${t}', 1, '${"a".repeat(64)}', '${u}', now())`,
      );
    }

    plantaId = randomUUID();
    habId = randomUUID();
    camaId = randomUUID();
    otraCamaId = randomUUID();
    await prisma.$executeRawUnsafe(
      `INSERT INTO floors (id, tenant_id, name, sort_order, updated_at)
       VALUES ('${plantaId}', '${tenantId}', 'Primera', 1, now())`,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO rooms (id, tenant_id, floor_id, number, active, updated_at)
       VALUES ('${habId}', '${tenantId}', '${plantaId}', '112', true, now())`,
    );
    for (const [c, label] of [
      [camaId, "A"],
      [otraCamaId, "B"],
    ] as const) {
      await prisma.$executeRawUnsafe(
        `INSERT INTO beds (id, tenant_id, room_id, label, active, updated_at)
         VALUES ('${c}', '${tenantId}', '${habId}', '${label}', true, now())`,
      );
    }

    comoDirectora = {
      authorization: `Bearer ${signAccessToken({ sub: directoraId, tid: tenantId, role: "OWNER" })}`,
    };

    app = Fastify({ logger: false });
    await registerResidenciaResidentesRoutes(app);
    await registerResidenciaPlanRoutes(app);
    await app.ready();
  });

  afterAll(async () => {
    await app?.close();
    for (const t of [tenantId, otroTenantId]) {
      await prisma.$executeRawUnsafe(`DELETE FROM care_plan_items WHERE tenant_id = '${t}'`);
      await prisma.$executeRawUnsafe(`DELETE FROM care_plan_template_items WHERE tenant_id = '${t}'`);
      await prisma.$executeRawUnsafe(`DELETE FROM center_control_settings WHERE tenant_id = '${t}'`);
      await prisma.$executeRawUnsafe(`DELETE FROM center_moments WHERE tenant_id = '${t}'`);
      await prisma.$executeRawUnsafe(`DELETE FROM center_shifts WHERE tenant_id = '${t}'`);
      // El registro de accesos es SÓLO INSERCIONES (clinica-1): hay que
      // apartar el trigger para limpiarlo. Que limpiar sea incómodo es la
      // garantía funcionando — y aquí hace falta porque `clients` es
      // RESTRICT desde las líneas del registro.
      await prisma.$executeRawUnsafe(
        `ALTER TABLE clinical_access_log DISABLE TRIGGER clinical_access_log_append_only`,
      );
      await prisma.$executeRawUnsafe(`DELETE FROM clinical_access_log WHERE tenant_id = '${t}'`);
      await prisma.$executeRawUnsafe(
        `ALTER TABLE clinical_access_log ENABLE TRIGGER clinical_access_log_append_only`,
      );
      // La aceptación del contrato tampoco se borra: para retirarla se
      // INSERTA una revocación (clinica-7 §2 §1). Otro trigger que hay que
      // apartar para limpiar, y otra garantía funcionando.
      await prisma.$executeRawUnsafe(
        `ALTER TABLE clinical_processor_agreements DISABLE TRIGGER clinical_processor_agreements_append_only`,
      );
      await prisma.$executeRawUnsafe(`DELETE FROM clinical_processor_agreements WHERE tenant_id = '${t}'`);
      await prisma.$executeRawUnsafe(
        `ALTER TABLE clinical_processor_agreements ENABLE TRIGGER clinical_processor_agreements_append_only`,
      );
      await prisma.$executeRawUnsafe(
        `ALTER TABLE clinical_tenant_keys DISABLE TRIGGER clinical_tenant_keys_guard`,
      );
      await prisma.$executeRawUnsafe(`DELETE FROM clinical_tenant_keys WHERE tenant_id = '${t}'`);
      await prisma.$executeRawUnsafe(
        `ALTER TABLE clinical_tenant_keys ENABLE TRIGGER clinical_tenant_keys_guard`,
      );
      await prisma.$executeRawUnsafe(`DELETE FROM bed_assignments WHERE tenant_id = '${t}'`);
      await prisma.$executeRawUnsafe(`DELETE FROM beds WHERE tenant_id = '${t}'`);
      await prisma.$executeRawUnsafe(`DELETE FROM rooms WHERE tenant_id = '${t}'`);
      await prisma.$executeRawUnsafe(`DELETE FROM floors WHERE tenant_id = '${t}'`);
      // ── historia-1 · LO QUE ESTE BLOQUE LE COLGÓ AL RESIDENTE ──
      //
      // Las FK son `RESTRICT` a propósito —la ficha clínica y el
      // expediente se conservan cinco años (D-45)— así que la limpieza
      // del banco tiene que borrar los hijos primero, igual que ya hace
      // con las camas. Y los triggers de inmutabilidad se apagan para
      // borrar y se vuelven a encender, como con
      // `clinical_tenant_keys_guard` y `care_roles_de_serie_son_fijos`.
      await prisma.$executeRawUnsafe(
        `ALTER TABLE resident_diagnoses DISABLE TRIGGER resident_diagnoses_inmutable`,
      );
      await prisma.$executeRawUnsafe(
        `ALTER TABLE allergies DISABLE TRIGGER allergies_inmutable`,
      );
      await prisma.$executeRawUnsafe(
        `ALTER TABLE allergy_reviews DISABLE TRIGGER allergy_reviews_append_only`,
      );
      await prisma.$executeRawUnsafe(
        `ALTER TABLE diet_profiles DISABLE TRIGGER diet_profiles_inmutable`,
      );
      await prisma.$executeRawUnsafe(
        `ALTER TABLE resident_absences DISABLE TRIGGER resident_absences_inmutable`,
      );
      await prisma.$executeRawUnsafe(
        `DELETE FROM admission_checklist_items WHERE tenant_id = '${t}'`,
      );
      await prisma.$executeRawUnsafe(
        `DELETE FROM resident_diagnoses WHERE tenant_id = '${t}'`,
      );
      await prisma.$executeRawUnsafe(
        `DELETE FROM allergies WHERE tenant_id = '${t}'`,
      );
      await prisma.$executeRawUnsafe(
        `DELETE FROM allergy_reviews WHERE tenant_id = '${t}'`,
      );
      await prisma.$executeRawUnsafe(
        `DELETE FROM diet_profiles WHERE tenant_id = '${t}'`,
      );
      await prisma.$executeRawUnsafe(
        `DELETE FROM resident_absences WHERE tenant_id = '${t}'`,
      );
      await prisma.$executeRawUnsafe(
        `ALTER TABLE resident_diagnoses ENABLE TRIGGER resident_diagnoses_inmutable`,
      );
      await prisma.$executeRawUnsafe(
        `ALTER TABLE allergies ENABLE TRIGGER allergies_inmutable`,
      );
      await prisma.$executeRawUnsafe(
        `ALTER TABLE allergy_reviews ENABLE TRIGGER allergy_reviews_append_only`,
      );
      await prisma.$executeRawUnsafe(
        `ALTER TABLE diet_profiles ENABLE TRIGGER diet_profiles_inmutable`,
      );
      await prisma.$executeRawUnsafe(
        `ALTER TABLE resident_absences ENABLE TRIGGER resident_absences_inmutable`,
      );
      await prisma.$executeRawUnsafe(`DELETE FROM resident_profiles WHERE tenant_id = '${t}'`);
      await prisma.$executeRawUnsafe(`DELETE FROM clients WHERE tenant_id = '${t}'`);
      await prisma.$executeRawUnsafe(`DELETE FROM care_role_assignments WHERE tenant_id = '${t}'`);
      await prisma.$executeRawUnsafe(
        `ALTER TABLE care_roles DISABLE TRIGGER care_roles_de_serie_son_fijos`,
      );
      await prisma.$executeRawUnsafe(`DELETE FROM care_roles WHERE tenant_id = '${t}'`);
      await prisma.$executeRawUnsafe(
        `ALTER TABLE care_roles ENABLE TRIGGER care_roles_de_serie_son_fijos`,
      );
      await prisma.$executeRawUnsafe(`DELETE FROM users WHERE tenant_id = '${t}'`);
      await prisma.$executeRawUnsafe(`DELETE FROM tenants WHERE id = '${t}'`);
    }
    await shutdown();
  });

  beforeEach(async () => {
    // Las dos cachés de clinica-7 duran más que este fichero entero. Y las
    // filas, limpias: los índices parciales son globales por tabla.
    olvidarClaves();
    olvidarEstado();
    for (const t of [tenantId, otroTenantId]) {
      await prisma.$executeRawUnsafe(`DELETE FROM care_plan_items WHERE tenant_id = '${t}'`);
      await prisma.$executeRawUnsafe(`DELETE FROM bed_assignments WHERE tenant_id = '${t}'`);
      // El registro de accesos es SÓLO INSERCIONES (clinica-1): hay que
      // apartar el trigger para limpiarlo. Que limpiar sea incómodo es la
      // garantía funcionando — y aquí hace falta porque `clients` es
      // RESTRICT desde las líneas del registro.
      await prisma.$executeRawUnsafe(
        `ALTER TABLE clinical_access_log DISABLE TRIGGER clinical_access_log_append_only`,
      );
      await prisma.$executeRawUnsafe(`DELETE FROM clinical_access_log WHERE tenant_id = '${t}'`);
      await prisma.$executeRawUnsafe(
        `ALTER TABLE clinical_access_log ENABLE TRIGGER clinical_access_log_append_only`,
      );
      // ── historia-1 · LO QUE ESTE BLOQUE LE COLGÓ AL RESIDENTE ──
      //
      // Las FK son `RESTRICT` a propósito —la ficha clínica y el
      // expediente se conservan cinco años (D-45)— así que la limpieza
      // del banco tiene que borrar los hijos primero, igual que ya hace
      // con las camas. Y los triggers de inmutabilidad se apagan para
      // borrar y se vuelven a encender, como con
      // `clinical_tenant_keys_guard` y `care_roles_de_serie_son_fijos`.
      await prisma.$executeRawUnsafe(
        `ALTER TABLE resident_diagnoses DISABLE TRIGGER resident_diagnoses_inmutable`,
      );
      await prisma.$executeRawUnsafe(
        `ALTER TABLE allergies DISABLE TRIGGER allergies_inmutable`,
      );
      await prisma.$executeRawUnsafe(
        `ALTER TABLE allergy_reviews DISABLE TRIGGER allergy_reviews_append_only`,
      );
      await prisma.$executeRawUnsafe(
        `ALTER TABLE diet_profiles DISABLE TRIGGER diet_profiles_inmutable`,
      );
      await prisma.$executeRawUnsafe(
        `ALTER TABLE resident_absences DISABLE TRIGGER resident_absences_inmutable`,
      );
      await prisma.$executeRawUnsafe(
        `DELETE FROM admission_checklist_items WHERE tenant_id = '${t}'`,
      );
      await prisma.$executeRawUnsafe(
        `DELETE FROM resident_diagnoses WHERE tenant_id = '${t}'`,
      );
      await prisma.$executeRawUnsafe(
        `DELETE FROM allergies WHERE tenant_id = '${t}'`,
      );
      await prisma.$executeRawUnsafe(
        `DELETE FROM allergy_reviews WHERE tenant_id = '${t}'`,
      );
      await prisma.$executeRawUnsafe(
        `DELETE FROM diet_profiles WHERE tenant_id = '${t}'`,
      );
      await prisma.$executeRawUnsafe(
        `DELETE FROM resident_absences WHERE tenant_id = '${t}'`,
      );
      await prisma.$executeRawUnsafe(
        `ALTER TABLE resident_diagnoses ENABLE TRIGGER resident_diagnoses_inmutable`,
      );
      await prisma.$executeRawUnsafe(
        `ALTER TABLE allergies ENABLE TRIGGER allergies_inmutable`,
      );
      await prisma.$executeRawUnsafe(
        `ALTER TABLE allergy_reviews ENABLE TRIGGER allergy_reviews_append_only`,
      );
      await prisma.$executeRawUnsafe(
        `ALTER TABLE diet_profiles ENABLE TRIGGER diet_profiles_inmutable`,
      );
      await prisma.$executeRawUnsafe(
        `ALTER TABLE resident_absences ENABLE TRIGGER resident_absences_inmutable`,
      );
      await prisma.$executeRawUnsafe(`DELETE FROM resident_profiles WHERE tenant_id = '${t}'`);
      await prisma.$executeRawUnsafe(`DELETE FROM clients WHERE tenant_id = '${t}'`);
      // Y LA CLAVE DEL CENTRO. Uno de los casos la DESTRUYE, y una clave
      // destruida no se resucita —lo impide el trigger guardián de
      // clinica-7 §2—, así que sin volver a empezar el caso siguiente no
      // podría escribir nada. En producción eso es exactamente lo que se
      // quiere, y por eso hay que apartar el trigger para limpiar: ni
      // borrarla ni resucitarla caben por las buenas.
      await prisma.$executeRawUnsafe(
        `ALTER TABLE clinical_tenant_keys DISABLE TRIGGER clinical_tenant_keys_guard`,
      );
      await prisma.$executeRawUnsafe(
        `DELETE FROM clinical_tenant_keys WHERE tenant_id = '${t}'`,
      );
      await prisma.$executeRawUnsafe(
        `ALTER TABLE clinical_tenant_keys ENABLE TRIGGER clinical_tenant_keys_guard`,
      );
    }
  });

  // ── 1 · LO QUE LA BASE GUARDA ──────────────────────────────────────

  describe("el alta guarda ciphertext y deja el claro vacío", () => {
    it("el DNI, el NSS y el motivo de la cama nacen cifrados", async () => {
      const carmen = await darDeAlta({
        nombre: "Carmen",
        dni: DNI,
        nss: NSS,
        bedId: camaId,
      });

      const [perfil] = await prisma.$queryRawUnsafe<
        Array<{
          dni: string | null;
          nss: string | null;
          dni_cifrado: string | null;
          nss_cifrado: string | null;
        }>
      >(
        `SELECT dni, nss, dni_cifrado, nss_cifrado FROM resident_profiles
         WHERE client_id = '${carmen}'`,
      );
      // El claro, VACÍO. Una fila que nace cifrada no guarda el dato en
      // claro «por si acaso».
      expect(perfil!.dni).toBeNull();
      expect(perfil!.nss).toBeNull();
      // Y lo cifrado, con el prefijo que el CHECK exige.
      expect(perfil!.dni_cifrado).toMatch(/^c1:/);
      expect(perfil!.nss_cifrado).toMatch(/^c1:/);

      // Y se descifra, con la DEK de ESTE centro y el sitio de ESTA fila.
      const dek = await dekDe(tenantId, prisma);
      expect(
        descifrarValor(perfil!.dni_cifrado!, dek, sitioDniDeResidente(tenantId, carmen)),
      ).toBe(DNI);
      expect(
        descifrarValor(perfil!.nss_cifrado!, dek, sitioNssDeResidente(tenantId, carmen)),
      ).toBe(NSS);

      const [ocupacion] = await prisma.$queryRawUnsafe<
        Array<{ id: string; reason: string | null; reason_cifrado: string | null }>
      >(`SELECT id, reason, reason_cifrado FROM bed_assignments WHERE client_id = '${carmen}'`);
      expect(ocupacion!.reason).toBeNull();
      expect(
        descifrarValor(
          ocupacion!.reason_cifrado!,
          dek,
          sitioMotivoDeOcupacion(tenantId, ocupacion!.id),
        ),
      ).toBe("ingreso");
    });

    it("y cada línea del plan precargado trae SU ciphertext, distinto del de al lado", async () => {
      const carmen = await darDeAlta({ nombre: "Carmen" });
      const lineas = await prisma.$queryRawUnsafe<
        Array<{ id: string; reason: string | null; reason_cifrado: string | null }>
      >(`SELECT id, reason, reason_cifrado FROM care_plan_items WHERE client_id = '${carmen}'`);
      // La plantilla del dependiente precarga varias líneas.
      expect(lineas.length).toBeGreaterThan(1);
      const dek = await dekDe(tenantId, prisma);
      for (const l of lineas) {
        expect(l.reason).toBeNull();
        expect(
          descifrarValor(l.reason_cifrado!, dek, sitioMotivoDeLinea(tenantId, l.id)),
        ).toBe("ingreso");
      }
      // EL MISMO texto en N filas son N ciphertexts distintos. Es lo que
      // impide que una línea se copie encima de otra — y lo que un cifrado
      // determinista no daría.
      expect(new Set(lineas.map((l) => l.reason_cifrado)).size).toBe(lineas.length);
    });

    it("el motivo del alta de salida también", async () => {
      const carmen = await darDeAlta({ nombre: "Carmen", bedId: camaId });
      const r = await app.inject({
        method: "POST",
        url: `/residencia/residentes/${carmen}/alta`,
        headers: comoDirectora,
        payload: {
          dischargeDate: "2026-11-30",
          // historia-1 (D-96) · la clase del alta es obligatoria desde ese
          // bloque: de ella depende la comunicación a la administración.
          dischargeKind: "FALLECIMIENTO",
          dischargeReason: MOTIVO_ALTA,
        },
      });
      expect(r.statusCode, r.body).toBe(200);

      const [perfil] = await prisma.$queryRawUnsafe<
        Array<{ discharge_reason: string | null; discharge_reason_cifrado: string | null }>
      >(
        `SELECT discharge_reason, discharge_reason_cifrado FROM resident_profiles
         WHERE client_id = '${carmen}'`,
      );
      expect(perfil!.discharge_reason).toBeNull();
      const dek = await dekDe(tenantId, prisma);
      expect(
        descifrarValor(
          perfil!.discharge_reason_cifrado!,
          dek,
          sitioMotivoDeAlta(tenantId, carmen),
        ),
      ).toBe(MOTIVO_ALTA);
    });

    it("editar el DNI de una ficha que lo tenía EN CLARO lo deja a NULL", async () => {
      // El caso que deja un rastro si no se mira: una ficha de antes del
      // cifrado, con el claro todavía puesto, a la que se le edita el DNI.
      // Si el `update` no pusiera el claro a NULL, el DNI VIEJO se queda
      // legible en la base para siempre.
      const carmen = await darDeAlta({ nombre: "Carmen" });
      await prisma.$executeRawUnsafe(
        `UPDATE resident_profiles SET dni = 'VIEJO-00000000X', dni_cifrado = NULL
         WHERE client_id = '${carmen}'`,
      );
      const r = await app.inject({
        method: "PATCH",
        url: `/residencia/residentes/${carmen}`,
        headers: comoDirectora,
        payload: { dni: DNI },
      });
      expect(r.statusCode, r.body).toBe(200);

      const [perfil] = await prisma.$queryRawUnsafe<
        Array<{ dni: string | null; dni_cifrado: string | null }>
      >(`SELECT dni, dni_cifrado FROM resident_profiles WHERE client_id = '${carmen}'`);
      expect(perfil!.dni).toBeNull();
      const dek = await dekDe(tenantId, prisma);
      expect(
        descifrarValor(perfil!.dni_cifrado!, dek, sitioDniDeResidente(tenantId, carmen)),
      ).toBe(DNI);
    });
  });

  // ── 2 · Y LAS PANTALLAS VEN LO MISMO QUE ANTES ─────────────────────

  describe("la API devuelve lo mismo que antes del bloque", () => {
    it("la ficha trae el DNI, el NSS y el motivo de la ocupación en claro", async () => {
      const carmen = await darDeAlta({
        nombre: "Carmen",
        dni: DNI,
        nss: NSS,
        bedId: camaId,
      });
      const r = await app.inject({
        method: "GET",
        url: `/residencia/residentes/${carmen}`,
        headers: comoDirectora,
      });
      expect(r.statusCode, r.body).toBe(200);
      const ficha = r.json().residente;
      expect(ficha.dni).toBe(DNI);
      expect(ficha.nss).toBe(NSS);
      expect(ficha.ocupaciones).toHaveLength(1);
      expect(ficha.ocupaciones[0].motivo).toBe("ingreso");
    });

    it("la lista trae el motivo del alta, y NUNCA el DNI", async () => {
      const carmen = await darDeAlta({ nombre: "Carmen", dni: DNI });
      await app.inject({
        method: "POST",
        url: `/residencia/residentes/${carmen}/alta`,
        headers: comoDirectora,
        payload: {
          dischargeDate: "2026-11-30",
          // historia-1 (D-96) · la clase del alta es obligatoria desde ese
          // bloque: de ella depende la comunicación a la administración.
          dischargeKind: "FALLECIMIENTO",
          dischargeReason: MOTIVO_ALTA,
        },
      });
      const r = await app.inject({
        method: "GET",
        url: "/residencia/residentes?incluirAltas=true",
        headers: comoDirectora,
      });
      expect(r.statusCode, r.body).toBe(200);
      const uno = r.json().residentes.find((x: any) => x.clientId === carmen);
      expect(uno.dischargeReason).toBe(MOTIVO_ALTA);
      // La lista se ve desde el despacho: el DNI sólo en la ficha.
      expect(uno.dni).toBeUndefined();
    });

    it("el plan trae el motivo de cada línea y el del cierre", async () => {
      const carmen = await darDeAlta({ nombre: "Carmen" });
      // Una línea a mano, con su motivo.
      const puesta = await app.inject({
        method: "POST",
        url: `/residencia/residentes/${carmen}/plan`,
        headers: comoDirectora,
        payload: {
          // `nature: ON_DEMAND` en el catálogo de serie, así que la ruta
          // sólo le admite esa frecuencia. Y no está en la plantilla del
          // dependiente, que es lo que hace falta aquí: una línea NUEVA.
          controlCode: "GLUCEMIA",
          frecuencia: { kind: "ON_DEMAND" },
          motivo: "diabética, lo pide la DUE",
        },
      });
      expect(puesta.statusCode, puesta.body).toBe(201);
      const itemId = puesta.json().linea.id as string;

      const leido = await app.inject({
        method: "GET",
        url: `/residencia/residentes/${carmen}/plan`,
        headers: comoDirectora,
      });
      expect(leido.statusCode, leido.body).toBe(200);
      const glucemia = leido
        .json()
        .lineas.find((l: any) => l.controlCode === "GLUCEMIA");
      expect(glucemia.motivo).toBe("diabética, lo pide la DUE");

      // Y al cerrarla, el motivo del cierre.
      const cerrada = await app.inject({
        method: "DELETE",
        url: `/residencia/residentes/${carmen}/plan/${itemId}?motivo=${encodeURIComponent("se le retiró la sonda")}`,
        headers: comoDirectora,
      });
      expect(cerrada.statusCode, cerrada.body).toBe(200);

      const otraVez = await app.inject({
        method: "GET",
        url: `/residencia/residentes/${carmen}/plan`,
        headers: comoDirectora,
      });
      const enElHistorico = otraVez
        .json()
        .cerradas.find((l: any) => l.id === itemId);
      expect(enElHistorico.motivoDeCierre).toBe("se le retiró la sonda");
      // Y el de apertura se sigue leyendo: son dos columnas lógicas
      // distintas, con dos AAD distintos.
      expect(enElHistorico.motivo).toBe("diabética, lo pide la DUE");
    });
  });

  // ── 3 · EL MOTOR NO DEJA ESCRIBIR EL CLARO ─────────────────────────

  describe("sabotaje · escribir el claro en la columna cifrada", () => {
    it("el DNI en claro en `dni_cifrado` lo rechaza el CHECK", async () => {
      const carmen = await darDeAlta({ nombre: "Carmen" });
      const msg = await debeFallar(
        `UPDATE resident_profiles SET dni_cifrado = '11223344Z' WHERE client_id = '${carmen}'`,
      );
      expect(msg).toContain("resident_profiles_dni_cifrado_formato");
    });

    it("también en el NSS y en el motivo del alta", async () => {
      const carmen = await darDeAlta({ nombre: "Carmen" });
      expect(
        await debeFallar(
          `UPDATE resident_profiles SET nss_cifrado = '281234567840' WHERE client_id = '${carmen}'`,
        ),
      ).toContain("resident_profiles_nss_cifrado_formato");
      expect(
        await debeFallar(
          `UPDATE resident_profiles SET discharge_date = '2026-11-30',
             discharge_reason_cifrado = 'fallecimiento' WHERE client_id = '${carmen}'`,
        ),
      ).toContain("resident_profiles_discharge_reason_cifrado_formato");
    });

    it("y en los tres motivos del plan y de la cama", async () => {
      const carmen = await darDeAlta({ nombre: "Carmen", bedId: camaId });
      expect(
        await debeFallar(
          `UPDATE care_plan_items SET reason_cifrado = 'úlcera sacra grado II'
           WHERE client_id = '${carmen}'`,
        ),
      ).toContain("care_plan_items_reason_cifrado_formato");
      expect(
        await debeFallar(
          `UPDATE care_plan_items SET close_reason_cifrado = 'se le retiró la sonda'
           WHERE client_id = '${carmen}'`,
        ),
      ).toContain("care_plan_items_close_reason_cifrado_formato");
      expect(
        await debeFallar(
          `UPDATE bed_assignments SET reason_cifrado = 'aislamiento por GEA'
           WHERE client_id = '${carmen}'`,
        ),
      ).toContain("bed_assignments_reason_cifrado_formato");
    });

    it("un ciphertext EN BLANCO tampoco cabe en el DNI", async () => {
      // `resident_profiles_identificacion_not_blank`, extendido a las
      // cifradas por este bloque: lo que no se sabe va NULL, no en blanco.
      const carmen = await darDeAlta({ nombre: "Carmen" });
      const msg = await debeFallar(
        `UPDATE resident_profiles SET dni_cifrado = '   ' WHERE client_id = '${carmen}'`,
      );
      // Cae por el formato o por el no-en-blanco: los dos están puestos y
      // los dos dicen lo mismo. Lo que importa es que NO entra.
      expect(msg).toMatch(
        /resident_profiles_(dni_cifrado_formato|identificacion_not_blank)/,
      );
    });
  });

  // ── 4 · UN VALOR MOVIDO NO SE DESCIFRA ─────────────────────────────

  describe("sabotaje · mover un valor cifrado de sitio", () => {
    it("copiar el DNI de una residente a la ficha de otra da el hueco marcado", async () => {
      const carmen = await darDeAlta({ nombre: "Carmen", dni: DNI });
      const luis = await darDeAlta({ nombre: "Luis" });

      // El `UPDATE` a mano, como lo escribiría alguien con acceso al VPS.
      // El motor lo ACEPTA (es un `c1:` con el formato bueno) y eso es el
      // punto: la garantía no es que no quepa, es que no se descifre.
      await prisma.$executeRawUnsafe(
        `UPDATE resident_profiles
         SET dni_cifrado = (SELECT dni_cifrado FROM resident_profiles WHERE client_id = '${carmen}')
         WHERE client_id = '${luis}'`,
      );

      const r = await app.inject({
        method: "GET",
        url: `/residencia/residentes/${luis}`,
        headers: comoDirectora,
      });
      // Y LA FICHA SE SIGUE SIRVIENDO. Un valor ilegible no puede dejar a
      // un residente sin su ficha: lo que se enseña es el hueco, que es
      // justo lo que alguien tiene que mirar.
      expect(r.statusCode, r.body).toBe(200);
      expect(r.json().residente.dni).toBe(TEXTO_ILEGIBLE);
      expect(r.json().residente.nombre).toBe("Luis Núñez");
    });

    it("copiar el motivo de una línea del plan a otra da el hueco, y el plan se sirve", async () => {
      const carmen = await darDeAlta({ nombre: "Carmen" });
      const lineas = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
        `SELECT id FROM care_plan_items WHERE client_id = '${carmen}' ORDER BY control_code`,
      );
      expect(lineas.length).toBeGreaterThan(1);
      await prisma.$executeRawUnsafe(
        `UPDATE care_plan_items
         SET reason_cifrado = (SELECT reason_cifrado FROM care_plan_items WHERE id = '${lineas[0]!.id}')
         WHERE id = '${lineas[1]!.id}'`,
      );

      const r = await app.inject({
        method: "GET",
        url: `/residencia/residentes/${carmen}/plan`,
        headers: comoDirectora,
      });
      expect(r.statusCode, r.body).toBe(200);
      const movida = r.json().lineas.find((l: any) => l.id === lineas[1]!.id);
      expect(movida.motivo).toBe(TEXTO_ILEGIBLE);
      // Y la de al lado, intacta.
      const intacta = r.json().lineas.find((l: any) => l.id === lineas[0]!.id);
      expect(intacta.motivo).toBe("ingreso");
    });

    it("un DNI cifrado en OTRO centro no se descifra en este", async () => {
      // Se cifra con la DEK del otro centro y su sitio, y se mete a mano en
      // la ficha de aquí. Dos cosas no cuadran: la clave y el tenant del
      // AAD.
      const carmen = await darDeAlta({ nombre: "Carmen" });
      // El otro centro necesita clave: se le hace escribir algo.
      const dekOtro = await (async () => {
        const otraDirectora = {
          authorization: `Bearer ${signAccessToken({ sub: otraDirectoraId, tid: otroTenantId, role: "OWNER" })}`,
        };
        const r = await app.inject({
          method: "POST",
          url: "/residencia/residentes",
          headers: otraDirectora,
          payload: {
            firstName: "Rosario",
            lastName: "Vega",
            admissionDate: "2026-10-01",
            dependencyLevel: "VALIDO",
            placeType: "PRIVADA",
          },
        });
        expect(r.statusCode, r.body).toBe(201);
        return dekDe(otroTenantId, prisma);
      })();

      const ajeno = cifrarValor(
        DNI,
        dekOtro,
        sitioDniDeResidente(otroTenantId, carmen),
      );
      await prisma.$executeRawUnsafe(
        `UPDATE resident_profiles SET dni_cifrado = '${ajeno}' WHERE client_id = '${carmen}'`,
      );
      const r = await app.inject({
        method: "GET",
        url: `/residencia/residentes/${carmen}`,
        headers: comoDirectora,
      });
      expect(r.statusCode, r.body).toBe(200);
      expect(r.json().residente.dni).toBe(TEXTO_ILEGIBLE);
    });
  });

  // ── 5 · SIN LA CLAVE DEL CENTRO ────────────────────────────────────

  describe("sabotaje · quitarle la DEK al centro", () => {
    it("la ficha se sigue sirviendo, con huecos en lo cifrado", async () => {
      const carmen = await darDeAlta({
        nombre: "Carmen",
        dni: DNI,
        nss: NSS,
        bedId: camaId,
      });
      // La clave, DESTRUIDA: es lo que pasa al terminar el contrato con un
      // centro (crypto-shredding del art. 28.3.g).
      await prisma.$executeRawUnsafe(
        `UPDATE clinical_tenant_keys SET dek_wrapped = NULL, canary = NULL,
           destroyed_at = now(), destroyed_reason = 'fin de contrato'
         WHERE tenant_id = '${tenantId}'`,
      );
      olvidarClaves();

      const r = await app.inject({
        method: "GET",
        url: `/residencia/residentes/${carmen}`,
        headers: comoDirectora,
      });
      expect(r.statusCode, r.body).toBe(200);
      const ficha = r.json().residente;
      // El nombre y la habitación siguen: son identidad y edificio, no
      // salud, y están en claro a propósito.
      expect(ficha.nombre).toBe("Carmen Núñez");
      expect(ficha.cama.roomNumber).toBe("112");
      // Y lo que el bloque cifró, ilegible. También en las copias.
      expect(ficha.dni).toBe(TEXTO_ILEGIBLE);
      expect(ficha.nss).toBe(TEXTO_ILEGIBLE);
      expect(ficha.ocupaciones[0].motivo).toBe(TEXTO_ILEGIBLE);
    });
  });

  // ── 6 · EL CHECK DEL ALTA, RE-ENSEÑADO ─────────────────────────────

  describe("el alta sigue exigiendo motivo coherente con la fecha", () => {
    it("un motivo EN CLARO sin fecha de alta no cabe", async () => {
      const carmen = await darDeAlta({ nombre: "Carmen" });
      const msg = await debeFallar(
        `UPDATE resident_profiles SET discharge_reason = 'se fue' WHERE client_id = '${carmen}'`,
      );
      expect(msg).toContain("resident_profiles_alta_coherente");
    });

    it("y un motivo CIFRADO sin fecha, tampoco — que es la mitad nueva", async () => {
      // Antes de este bloque el CHECK sólo miraba la columna clara, así que
      // con el claro vaciado un motivo sin fecha habría pasado.
      const carmen = await darDeAlta({ nombre: "Carmen" });
      const dek = await dekDe(tenantId, prisma);
      const cifrado = cifrarValor("se fue", dek, sitioMotivoDeAlta(tenantId, carmen));
      const msg = await debeFallar(
        `UPDATE resident_profiles SET discharge_reason_cifrado = '${cifrado}'
         WHERE client_id = '${carmen}'`,
      );
      expect(msg).toContain("resident_profiles_alta_coherente");
    });

    it("una fecha de alta anterior al ingreso sigue sin caber", async () => {
      const carmen = await darDeAlta({ nombre: "Carmen" });
      const msg = await debeFallar(
        `UPDATE resident_profiles SET discharge_date = '2020-01-01' WHERE client_id = '${carmen}'`,
      );
      expect(msg).toContain("resident_profiles_alta_coherente");
    });
  });

  // ── 7 · EL SELECT EN CRUDO ─────────────────────────────────────────

  describe("un volcado de la base no enseña nada de un residente", () => {
    it("el canario no aparece en NINGUNA tabla del esquema", async () => {
      const carmen = await darDeAlta({
        nombre: "Carmen",
        dni: DNI,
        nss: NSS,
        bedId: camaId,
      });
      await app.inject({
        method: "POST",
        url: `/residencia/residentes/${carmen}/plan`,
        headers: comoDirectora,
        payload: {
          controlCode: "GLUCEMIA",
          frecuencia: { kind: "ON_DEMAND" },
          motivo: "CANARIO-PLAN-úlcera sacra grado II",
        },
      });
      await app.inject({
        method: "POST",
        url: `/residencia/residentes/${carmen}/cama`,
        headers: comoDirectora,
        payload: { bedId: otraCamaId, reason: "CANARIO-CAMA-aislamiento por GEA" },
      });
      await app.inject({
        method: "POST",
        url: `/residencia/residentes/${carmen}/alta`,
        headers: comoDirectora,
        payload: {
          dischargeDate: "2026-11-30",
          // historia-1 (D-96) · la clase del alta es obligatoria desde ese
          // bloque: de ella depende la comunicación a la administración.
          dischargeKind: "FALLECIMIENTO",
          dischargeReason: MOTIVO_ALTA,
        },
      });

      // Y ahora lo que el prompt pide: un recorrido por TODAS las tablas
      // del esquema —también las que nadie listó— volcando cada fila a
      // texto. Es más de lo que vería un `pg_dump | grep`: aquí entran las
      // tablas que a nadie se le ocurrió mirar.
      const tablas = await prisma.$queryRawUnsafe<Array<{ t: string }>>(
        `SELECT table_name AS t FROM information_schema.tables
         WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
      );
      const canarios = [
        DNI,
        NSS,
        MOTIVO_ALTA,
        "CANARIO-PLAN-úlcera sacra grado II",
        "CANARIO-CAMA-aislamiento por GEA",
      ];
      const apariciones: string[] = [];
      for (const { t } of tablas) {
        const [fila] = await prisma.$queryRawUnsafe<Array<{ v: string | null }>>(
          `SELECT string_agg(x::text, E'\\n') AS v FROM "${t}" x`,
        );
        const volcado = fila?.v ?? "";
        for (const canario of canarios) {
          if (volcado.includes(canario)) apariciones.push(`${t} ← ${canario}`);
        }
      }
      expect(apariciones).toEqual([]);
    });

    it("y el SELECT de las tres tablas sólo trae `c1:` donde había texto", async () => {
      const carmen = await darDeAlta({
        nombre: "Carmen",
        dni: DNI,
        nss: NSS,
        bedId: camaId,
      });
      const filas = await prisma.$queryRawUnsafe<
        Array<{ tabla: string; cifrado: string | null; claro: string | null }>
      >(
        `SELECT 'resident_profiles.dni' AS tabla, dni_cifrado AS cifrado, dni AS claro
           FROM resident_profiles WHERE client_id = '${carmen}'
         UNION ALL
         SELECT 'resident_profiles.nss', nss_cifrado, nss
           FROM resident_profiles WHERE client_id = '${carmen}'
         UNION ALL
         SELECT 'bed_assignments.reason', reason_cifrado, reason
           FROM bed_assignments WHERE client_id = '${carmen}'
         UNION ALL
         SELECT 'care_plan_items.reason', reason_cifrado, reason
           FROM care_plan_items WHERE client_id = '${carmen}'`,
      );
      expect(filas.length).toBeGreaterThan(3);
      for (const f of filas) {
        expect(f.claro, f.tabla).toBeNull();
        expect(f.cifrado, f.tabla).toMatch(/^c1:/);
      }
    });
  });

  // ── 8 · EL SCRIPT PASA LO QUE YA ESTABA EN CLARO ───────────────────

  describe("el script de cifrado pasa lo que ya estaba escrito", () => {
    it("cifra el claro, lo verifica, lo vacía y es idempotente", async () => {
      const carmen = await darDeAlta({ nombre: "Carmen", bedId: camaId });
      // Una ficha de ANTES del bloque: claro puesto, cifrado vacío. Es lo
      // que hay hoy en un entorno de desarrollo o de ensayo con datos
      // sembrados de residencia-1 y -2.
      await prisma.$executeRawUnsafe(
        `UPDATE resident_profiles
         SET dni = '${DNI}', nss = '${NSS}',
             discharge_date = '2026-11-30', discharge_reason = '${MOTIVO_ALTA}',
             dni_cifrado = NULL, nss_cifrado = NULL, discharge_reason_cifrado = NULL
         WHERE client_id = '${carmen}'`,
      );
      await prisma.$executeRawUnsafe(
        `UPDATE bed_assignments SET reason = 'ingreso', reason_cifrado = NULL
         WHERE client_id = '${carmen}'`,
      );
      await prisma.$executeRawUnsafe(
        `UPDATE care_plan_items SET reason = 'ingreso', reason_cifrado = NULL
         WHERE client_id = '${carmen}'`,
      );

      const dek = await dekDe(tenantId, prisma);
      const { fichasDeResidentes, lineasDelPlan, ocupacionesDeCama } = await import(
        "../src/scripts/residencia-cifrar.js"
      );
      const total = { cifradas: 0, yaEstaban: 0, vaciadas: 0 };

      // PRIMERA pasada: cifra y NO vacía.
      await fichasDeResidentes(tenantId, dek, total, false);
      await lineasDelPlan(tenantId, dek, total, false);
      await ocupacionesDeCama(tenantId, dek, total, false);

      const [tras1] = await prisma.$queryRawUnsafe<
        Array<{ dni: string | null; dni_cifrado: string | null }>
      >(`SELECT dni, dni_cifrado FROM resident_profiles WHERE client_id = '${carmen}'`);
      // El claro TODAVÍA está: no se borra nada sin que lo pidan.
      expect(tras1!.dni).toBe(DNI);
      expect(tras1!.dni_cifrado).toMatch(/^c1:/);
      expect(
        descifrarValor(tras1!.dni_cifrado!, dek, sitioDniDeResidente(tenantId, carmen)),
      ).toBe(DNI);

      // SEGUNDA pasada, con `--vaciar`. Es el camino que el despliegue
      // hace de verdad: cifrar, mirar, y vaciar después.
      await fichasDeResidentes(tenantId, dek, total, true);
      await lineasDelPlan(tenantId, dek, total, true);
      await ocupacionesDeCama(tenantId, dek, total, true);

      const [tras2] = await prisma.$queryRawUnsafe<
        Array<{
          dni: string | null;
          nss: string | null;
          discharge_reason: string | null;
        }>
      >(
        `SELECT dni, nss, discharge_reason FROM resident_profiles
         WHERE client_id = '${carmen}'`,
      );
      expect(tras2!.dni).toBeNull();
      expect(tras2!.nss).toBeNull();
      expect(tras2!.discharge_reason).toBeNull();
      const [cama] = await prisma.$queryRawUnsafe<Array<{ reason: string | null }>>(
        `SELECT reason FROM bed_assignments WHERE client_id = '${carmen}'`,
      );
      expect(cama!.reason).toBeNull();
      const planEnClaro = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
        `SELECT count(*) AS n FROM care_plan_items
         WHERE client_id = '${carmen}' AND reason IS NOT NULL`,
      );
      expect(Number(planEnClaro[0]!.n)).toBe(0);

      // TERCERA pasada: +0 en todo. Es la prueba de que no queda nada
      // pendiente — la misma que clinica-7 §14 paso 4.
      const antes = { ...total };
      await fichasDeResidentes(tenantId, dek, total, true);
      await lineasDelPlan(tenantId, dek, total, true);
      await ocupacionesDeCama(tenantId, dek, total, true);
      expect(total.cifradas).toBe(antes.cifradas);
      expect(total.vaciadas).toBe(antes.vaciadas);

      // Y la ficha se lee igual que antes de todo.
      const r = await app.inject({
        method: "GET",
        url: `/residencia/residentes/${carmen}`,
        headers: comoDirectora,
      });
      expect(r.statusCode, r.body).toBe(200);
      expect(r.json().residente.dni).toBe(DNI);
      expect(r.json().residente.nss).toBe(NSS);
      expect(r.json().residente.dischargeReason).toBe(MOTIVO_ALTA);
      expect(r.json().residente.ocupaciones[0].motivo).toBe("ingreso");
    });
  });
});
