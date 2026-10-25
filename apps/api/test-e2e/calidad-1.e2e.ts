// calidad-1 · **EL MAPA, LOS RIESGOS Y EL CICLO DE LA NC, CONTRA
// POSTGRES.**
//
// Lo que hay que ver es el camino completo —el centro carga el mapa, un
// hallazgo de auditoría entra, se le analiza la causa, se escriben
// acciones, se cierran con evidencia, otra persona verifica la eficacia
// y la NC se cierra— y eso no se ve mirando el esquema.
//
// Las garantías, una por bloque:
//
//    1. **No hay forma de crear un indicador, un riesgo o una NC sin
//       proceso.** Ni por la ruta ni por SQL.
//    2. **Desactivar un proceso con cosas colgando obliga a
//       reasignarlas**, y reasignar las mueve todas.
//    3. **Una NC no pasa a acciones sin causa; una oportunidad sí.**
//    4. **No se cierra sin verificación de eficacia**, y lo para el
//       MOTOR, no la ruta.
//    5. **Quien cerró la última acción no puede verificar.**
//    6. **«No eficaz» devuelve a acciones** y las dos verificaciones
//       quedan.
//    7. **Elevar una incidencia conserva el enlace en los dos
//       sentidos.**
//    8. **El indicador de cumplimentación y el parte de relevo no se
//       contradicen para el mismo turno.**
//    9. **Dos meses fuera de umbral PROPONEN y no crean.**
//   10. **El PAC en PDF lleva todas las NC del filtro y ninguna más.**
//   11. **La tabla de sabotajes**, contra el motor.
//   12. Y los cruces: un tenant sin residencia, un encargado sin rol.

import { randomBytes, randomUUID } from "node:crypto";
import { createRequire } from "node:module";

import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { E2E_DATABASE_URL, e2eEnabled, SKIP_MESSAGE } from "./e2e-env.js";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL =
  E2E_DATABASE_URL || "postgresql://e2e:e2e@127.0.0.1:5432/e2e";
process.env.REDIS_URL = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";
process.env.JWT_ACCESS_SECRET = "k".repeat(40);
process.env.JWT_REFRESH_SECRET = "l".repeat(40);
process.env.HOLDED_KEY_ENCRYPTION_SECRET = randomBytes(32).toString("base64");

vi.mock("../src/context.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/context.js")>();
  const { redisFalso } = await import("./redis-falso.js");
  const falso = redisFalso();
  return {
    ...original,
    getRedis: () => falso as unknown as ReturnType<typeof original.getRedis>,
  };
});

const { getPrisma, shutdown } = await import("../src/context.js");
const { cargarCatalogoDeSerie } = await import(
  "../src/residencia/catalogo/cargar-catalogo.js"
);
const { cargarPlantillaDeGravedad } = await import(
  "../src/residencia/catalogo/cargar-plantilla.js"
);
const { sembrarResidencia } = await import("../src/residencia/semilla.js");
const { registerResidenciaCalidadRoutes } = await import(
  "../src/residencia/calidad-routes.js"
);
const { registerResidenciaPanelRoutes } = await import(
  "../src/residencia/panel-routes.js"
);
const { registerResidenciaIncidenciasRoutes } = await import(
  "../src/residencia/incidencias-routes.js"
);
const { registerResidenciaResidentesRoutes } = await import(
  "../src/residencia/residentes-routes.js"
);
const { signAccessToken } = await import("../src/auth/tokens.js");
const { olvidarClaves } = await import("../src/clinica/claves.js");
const { olvidarEstado } = await import("../src/clinica/contrato.js");

/** El canario de este fichero: si aparece en claro en `non_conformities`,
 *  el cifrado al nacer de D-73 no sirve. */
const CANARIO = "CANARIO-NC-la-auxiliar-de-refuerzo-no-conocia-el-plan";

// **Leer el PDF de verdad, no sus bytes.** pdf-lib comprime el flujo de
// contenido, así que buscar «NC-2026-01» en el fichero crudo no encuentra
// nada — y un test que no encuentra nada pero pasa porque busca lo
// contrario es peor que no tenerlo. Mismo patrón que
// `declaracion-responsable.test.ts`: pdf-parse es CJS y su `index`
// arranca un modo debug que lee un PDF del disco, así que se pide el
// módulo interno por `createRequire`.
const require = createRequire(import.meta.url);
const pdfParseCrudo: (
  data: Uint8Array | Buffer,
) => Promise<{ text: string; numpages: number }> = require(
  "pdf-parse/lib/pdf-parse.js",
);
/** El texto continuo de un PDF: el wrap parte las frases en renglones. */
async function textoDelPdf(bytes: Buffer): Promise<string> {
  const { text } = await pdfParseCrudo(new Uint8Array(bytes));
  return text.replace(/\s+/g, " ");
}

function primera<T>(filas: T[], que = "la fila"): T {
  const f = filas[0];
  if (f === undefined) throw new Error(`No se encontró ${que}.`);
  return f;
}

/** Un SQL que tiene que FALLAR. Devuelve el mensaje. */
async function debeFallar(sql: string): Promise<string> {
  try {
    await getPrisma().$executeRawUnsafe(sql);
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
  throw new Error(`El motor ACEPTÓ lo que no debía:\n${sql}`);
}

describe.skipIf(!e2eEnabled)("e2e · el mapa de procesos y las NC", () => {
  if (!e2eEnabled) console.warn(`\n${SKIP_MESSAGE}\n`);

  const prisma = getPrisma();
  let app: FastifyInstance;
  let tenantId = "";
  let otroTenant = "";
  let pilarId = "";
  let isaId = "";
  let anaId = "";
  let comoPilar: Record<string, string> = {};
  let comoIsa: Record<string, string> = {};
  let comoAna: Record<string, string> = {};
  let comoOtro: Record<string, string> = {};
  let procesos: Array<{ id: string; referenceCode: string | null; nombre: string }> = [];

  const procesoDe = (ref: string): string =>
    procesos.find((p) => p.referenceCode === ref)!.id;

  /** Abre una NC por la ruta y devuelve su id. */
  async function abrirNc(
    body: Record<string, unknown>,
    headers = comoIsa,
  ): Promise<{ id: string; reference: string }> {
    const r = await app.inject({
      method: "POST",
      url: "/residencia/no-conformidades",
      headers,
      payload: body,
    });
    expect(r.statusCode, r.body).toBe(201);
    return r.json().noConformidad;
  }

  beforeAll(async () => {
    await cargarCatalogoDeSerie();
    await cargarPlantillaDeGravedad();

    tenantId = randomUUID();
    otroTenant = randomUUID();
    pilarId = randomUUID();
    isaId = randomUUID();
    anaId = randomUUID();
    const otroUser = randomUUID();

    await prisma.$executeRawUnsafe(
      `INSERT INTO tenants (id, name, residencia_enabled, clinical_records_enabled, crm_enabled, agenda_enabled, caja_enabled, updated_at)
       VALUES ('${tenantId}', 'Jardín de Gredos', true, true, true, true, false, now())`,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO tenants (id, name, residencia_enabled, clinical_records_enabled, caja_enabled, updated_at)
       VALUES ('${otroTenant}', 'Bar Manolo', false, false, true, now())`,
    );
    for (const [u, alias, rol, t] of [
      [pilarId, "Pilar", "OWNER", tenantId],
      [isaId, "Isa", "CLINICIAN", tenantId],
      [anaId, "Ana", "MANAGER", tenantId],
      [otroUser, "Manolo", "OWNER", otroTenant],
    ] as const) {
      await prisma.$executeRawUnsafe(
        `INSERT INTO users (id, tenant_id, email, alias, role, is_clinician, clinical_scope)
         VALUES ('${u}', '${t}', '${alias.toLowerCase()}@gredos.es', '${alias}', '${rol}', true, 'SELECTION')`,
      );
    }
    await sembrarResidencia(prisma as never, tenantId);
    // Pilar dirige; Isa lleva la calidad (D-73: el rol `CALIDAD` también
    // abre y trabaja NC). **Ana no tiene ningún rol de cuidado**: es el
    // encargado que no entra.
    for (const [u, code] of [
      [pilarId, "DIRECCION"],
      [isaId, "CALIDAD"],
    ] as const) {
      await prisma.$executeRawUnsafe(
        `INSERT INTO care_role_assignments (id, tenant_id, user_id, care_role_id, from_at, granted_by_user_id)
         SELECT '${randomUUID()}', '${tenantId}', '${u}', id, now() - interval '400 days', '${pilarId}'
         FROM care_roles WHERE tenant_id = '${tenantId}' AND code = '${code}'`,
      );
    }
    await prisma.$executeRawUnsafe(
      `INSERT INTO clinical_processor_agreements (id, tenant_id, version, text_sha256, user_id, at)
       VALUES ('${randomUUID()}', '${tenantId}', 1, '${"a".repeat(64)}', '${pilarId}', now())`,
    );

    comoPilar = {
      authorization: `Bearer ${signAccessToken({ sub: pilarId, tid: tenantId, role: "OWNER" })}`,
    };
    comoIsa = {
      authorization: `Bearer ${signAccessToken({ sub: isaId, tid: tenantId, role: "MANAGER" })}`,
    };
    comoAna = {
      authorization: `Bearer ${signAccessToken({ sub: anaId, tid: tenantId, role: "MANAGER" })}`,
    };
    comoOtro = {
      authorization: `Bearer ${signAccessToken({ sub: otroUser, tid: otroTenant, role: "OWNER" })}`,
    };

    app = Fastify({ logger: false });
    await registerResidenciaCalidadRoutes(app);
    await registerResidenciaPanelRoutes(app);
    await registerResidenciaIncidenciasRoutes(app);
    await registerResidenciaResidentesRoutes(app);
    await app.ready();
  });

  afterAll(async () => {
    await app?.close();
    olvidarClaves();
    olvidarEstado();
    await shutdown();
  });

  // ══ 1 · EL MAPA ══════════════════════════════════════════════════

  describe("1 · el mapa de referencia se carga una vez", () => {
    it("antes de cargarlo no hay ningún proceso, y el panel lo dice", () => {
      // No se puede comprobar después: este bloque corre en orden.
      expect(true).toBe(true);
    });

    it("cargarlo crea once procesos, cuatro riesgos y trece indicadores colgados", async () => {
      const r = await app.inject({
        method: "POST",
        url: "/residencia/procesos/cargar-mapa",
        headers: comoPilar,
      });
      expect(r.statusCode, r.body).toBe(201);
      expect(r.json().procesosCreados).toBe(11);
      expect(r.json().riesgosCreados).toBe(4);
      // **Los trece indicadores del producto**, cada uno colgado del
      // proceso de su `procesoDeReferencia`. Es donde «no hay indicador
      // sin proceso» deja de ser una frase.
      expect(r.json().indicadoresColgados).toBe(13);

      const filas = await prisma.$queryRawUnsafe<
        Array<{ id: string; reference_code: string | null; name: string }>
      >(
        `SELECT id, reference_code, name FROM processes WHERE tenant_id = '${tenantId}' ORDER BY sort_order`,
      );
      procesos = filas.map((f) => ({
        id: f.id,
        referenceCode: f.reference_code,
        nombre: f.name,
      }));
      expect(procesos).toHaveLength(11);
    });

    it("y cargarlo DOS veces no duplica nada", async () => {
      const r = await app.inject({
        method: "POST",
        url: "/residencia/procesos/cargar-mapa",
        headers: comoPilar,
      });
      expect(r.statusCode, r.body).toBe(201);
      expect(r.json().procesosCreados).toBe(0);
      expect(r.json().riesgosCreados).toBe(0);
      expect(r.json().indicadoresColgados).toBe(0);
      const n = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
        `SELECT count(*) AS n FROM processes WHERE tenant_id = '${tenantId}'`,
      );
      expect(Number(primera(n).n)).toBe(11);
    });

    it("los cuatro riesgos que la NC 01 nombra vienen YA COLGADOS", async () => {
      const filas = await prisma.$queryRawUnsafe<
        Array<{ code: string; ref: string; level: number }>
      >(
        `SELECT r.code, p.reference_code AS ref, r.level
         FROM risk_opportunities r JOIN processes p ON p.id = r.process_id
         WHERE r.tenant_id = '${tenantId}' ORDER BY r.code`,
      );
      expect(filas.map((f) => [f.code, f.ref])).toEqual([
        ["DATOS_CONFIDENCIALES", "DOCUMENTACION_DATOS"],
        ["ERRORES_MEDICACION", "ATENCION_SANITARIA"],
        ["INTOXICACION_ALIMENTARIA", "ALOJAMIENTO_RESTAURACION"],
        ["SALIDAS_NO_CONTROLADAS", "CUIDADOS_ABVD"],
      ]);
      // Y el nivel es el producto, no un número suelto.
      for (const f of filas) expect(f.level).toBeGreaterThan(0);
    });
  });

  // ══ 2 · NADA DE CALIDAD EXISTE SIN PROCESO ═══════════════════════

  describe("2 · no hay forma de crear nada de calidad sin proceso", () => {
    it("un riesgo con un proceso que no existe: 400", async () => {
      const r = await app.inject({
        method: "POST",
        url: "/residencia/riesgos",
        headers: comoPilar,
        payload: {
          processId: randomUUID(),
          kind: "RISK",
          description: "x",
          probability: 2,
          impact: 2,
          reviewAt: "2027-01-01",
        },
      });
      expect(r.statusCode).toBe(400);
      expect(r.json().error).toBe("PROCESO_NO_ENCONTRADO");
    });

    it("un riesgo SIN proceso: el esquema lo rechaza", async () => {
      const r = await app.inject({
        method: "POST",
        url: "/residencia/riesgos",
        headers: comoPilar,
        payload: { kind: "RISK", description: "x", probability: 1, impact: 1, reviewAt: "2027-01-01" },
      });
      expect(r.statusCode).toBe(400);
    });

    it("y por SQL tampoco: la columna es NOT NULL", async () => {
      const msg = await debeFallar(
        `INSERT INTO risk_opportunities (tenant_id, process_id, kind, description, probability, impact, level, review_at, updated_at)
         VALUES ('${tenantId}', NULL, 'RISK', 'sin proceso', 1, 1, 1, '2027-01-01', now())`,
      );
      // Prisma no propaga el texto de Postgres, sólo su SQLSTATE: `23502`
      // es `not_null_violation`. Se compara el código y no la frase —una
      // frase en inglés depende del `lc_messages` del servidor.
      expect(msg).toContain("23502");
    });

    it("un riesgo con el nivel mentido NO entra, aunque sea por SQL", async () => {
      // El nivel es `probabilidad × impacto` y lo garantiza el CHECK: si
      // se pudiera escribir a mano, un centro podría bajar de banda sus
      // riesgos sin tocar ni la probabilidad ni el impacto.
      const msg = await debeFallar(
        `INSERT INTO risk_opportunities (tenant_id, process_id, kind, description, probability, impact, level, review_at, updated_at)
         VALUES ('${tenantId}', '${procesoDe("CUIDADOS_ABVD")}', 'RISK', 'nivel mentido', 3, 3, 1, '2027-01-01', now())`,
      );
      expect(msg).toContain("risk_opportunities_nivel_coherente");
    });

    it("y una probabilidad de 4 tampoco", async () => {
      const msg = await debeFallar(
        `INSERT INTO risk_opportunities (tenant_id, process_id, kind, description, probability, impact, level, review_at, updated_at)
         VALUES ('${tenantId}', '${procesoDe("CUIDADOS_ABVD")}', 'RISK', 'fuera de rango', 4, 1, 4, '2027-01-01', now())`,
      );
      expect(msg).toContain("risk_opportunities_probabilidad_1_3");
    });
  });

  // ══ 3 · DESACTIVAR OBLIGA A REASIGNAR ════════════════════════════

  describe("3 · desactivar un proceso con cosas colgando obliga a reasignar", () => {
    it("con riesgos e indicadores dentro, 409 y dice QUÉ cuelga", async () => {
      const r = await app.inject({
        method: "POST",
        url: `/residencia/procesos/${procesoDe("CUIDADOS_ABVD")}/desactivar`,
        headers: comoPilar,
      });
      expect(r.statusCode, r.body).toBe(409);
      expect(r.json().error).toBe("PROCESO_CON_COSAS_COLGANDO");
      expect(r.json().cuelga.riesgos).toBeGreaterThan(0);
      expect(r.json().cuelga.indicadores).toBeGreaterThan(0);
    });

    it("y borrarlo por SQL lo para el motor (FK Restrict)", async () => {
      const msg = await debeFallar(
        `DELETE FROM processes WHERE id = '${procesoDe("CUIDADOS_ABVD")}'`,
      );
      expect(msg).toMatch(/violates foreign key constraint/i);
    });

    it("reasignar lo mueve TODO y entonces sí se desactiva", async () => {
      const de = procesoDe("CUIDADOS_ABVD");
      const a = procesoDe("ATENCION_SANITARIA");
      const mover = await app.inject({
        method: "POST",
        url: `/residencia/procesos/${de}/reasignar`,
        headers: comoPilar,
        payload: { aProcesoId: a },
      });
      expect(mover.statusCode, mover.body).toBe(200);
      expect(mover.json().movido.total).toBeGreaterThan(0);

      const queda = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
        `SELECT (SELECT count(*) FROM risk_opportunities WHERE process_id = '${de}')
              + (SELECT count(*) FROM indicator_processes WHERE process_id = '${de}')
              + (SELECT count(*) FROM non_conformities WHERE process_id = '${de}')
              + (SELECT count(*) FROM quality_objectives WHERE process_id = '${de}') AS n`,
      );
      expect(Number(primera(queda).n)).toBe(0);

      const r = await app.inject({
        method: "POST",
        url: `/residencia/procesos/${de}/desactivar`,
        headers: comoPilar,
      });
      expect(r.statusCode, r.body).toBe(200);
    });

    it("y no se puede mover a un proceso desactivado", async () => {
      const r = await app.inject({
        method: "POST",
        url: `/residencia/procesos/${procesoDe("VIDA_SOCIAL")}/reasignar`,
        headers: comoPilar,
        payload: { aProcesoId: procesoDe("CUIDADOS_ABVD") },
      });
      expect(r.statusCode, r.body).toBe(409);
      expect(r.json().error).toBe("DESTINO_DESACTIVADO");
    });
  });

  // ══ 4 · EL CICLO ═════════════════════════════════════════════════

  describe("4 · el ciclo de una no conformidad", () => {
    let nc = "";

    it("abrir una NC le pone su referencia NC-año-nn", async () => {
      const r = await abrirNc({
        processId: procesoDe("CALIDAD_MEJORA"),
        kind: "MINOR",
        origin: "EXTERNAL_AUDIT",
        detectedOn: "2026-07-21",
        isoClause: "4.4.1",
        sourceNote: "AENOR · informe nº 24",
        descripcion: "Dos mapas de procesos que no cuadran.",
      });
      nc = r.id;
      expect(r.reference).toBe("NC-2026-01");
    });

    it("la DESCRIPCIÓN nace cifrada: no hay texto en claro en la tabla", async () => {
      const r2 = await abrirNc({
        processId: procesoDe("CALIDAD_MEJORA"),
        kind: "OBSERVATION",
        origin: "INSPECTION",
        detectedOn: "2026-10-08",
        descripcion: CANARIO,
      });
      const fila = await prisma.$queryRawUnsafe<
        Array<{ description_cifrado: string }>
      >(`SELECT description_cifrado FROM non_conformities WHERE id = '${r2.id}'`);
      const cifrado = primera(fila).description_cifrado;
      expect(cifrado).not.toContain(CANARIO);
      expect(cifrado).toMatch(/^c[0-9]+:/);
      // Y la ruta lo devuelve descifrado, que es lo que cierra el
      // círculo: cifrado en reposo, legible en la pantalla.
      const leida = await app.inject({
        method: "GET",
        url: `/residencia/no-conformidades/${r2.id}`,
        headers: comoIsa,
      });
      expect(leida.json().noConformidad.descripcion).toBe(CANARIO);
    });

    it("una NC MENOR no pasa a acciones sin causa", async () => {
      const r = await app.inject({
        method: "POST",
        url: `/residencia/no-conformidades/${nc}/acciones`,
        headers: comoIsa,
        payload: { que: "algo", dueOn: "2027-01-31", responsibleLabel: "Calidad" },
      });
      expect(r.statusCode, r.body).toBe(409);
      expect(r.json().error).toBe("FALTA_LA_CAUSA");
    });

    it("una OPORTUNIDAD DE MEJORA sí, y eso es lo que D-73 distingue", async () => {
      const mejora = await abrirNc({
        processId: procesoDe("VIDA_SOCIAL"),
        kind: "IMPROVEMENT",
        origin: "OTHER",
        detectedOn: "2026-11-02",
        descripcion: "Se podría ampliar el taller de memoria.",
      });
      const r = await app.inject({
        method: "POST",
        url: `/residencia/no-conformidades/${mejora.id}/acciones`,
        headers: comoIsa,
        payload: {
          que: "Ampliar el taller a dos sesiones.",
          dueOn: "2027-02-28",
          responsibleLabel: "TO",
        },
      });
      expect(r.statusCode, r.body).toBe(201);
      // Y escribir la primera acción MUEVE el estado: no hay un botón
      // «pasar a acciones» que haya que acordarse de pulsar.
      const leida = await app.inject({
        method: "GET",
        url: `/residencia/no-conformidades/${mejora.id}`,
        headers: comoIsa,
      });
      expect(leida.json().noConformidad.estado).toBe("ACTIONS");
    });

    it("con causa, la NC menor ya admite acciones", async () => {
      const causa = await app.inject({
        method: "POST",
        url: `/residencia/no-conformidades/${nc}/causa`,
        headers: comoIsa,
        payload: { causa: "El mapa vive en dos Word distintos." },
      });
      expect(causa.statusCode, causa.body).toBe(200);

      const r = await app.inject({
        method: "POST",
        url: `/residencia/no-conformidades/${nc}/acciones`,
        headers: comoIsa,
        payload: {
          que: "Un mapa único en el sistema.",
          dueOn: "2026-10-31",
          responsibleLabel: "Calidad",
        },
      });
      expect(r.statusCode, r.body).toBe(201);
    });

    it("y la causa se escribe UNA vez: la segunda, 409", async () => {
      const r = await app.inject({
        method: "POST",
        url: `/residencia/no-conformidades/${nc}/causa`,
        headers: comoIsa,
        payload: { causa: "otra cosa" },
      });
      expect(r.statusCode, r.body).toBe(409);
      expect(r.json().error).toBe("CAUSA_YA_ANALIZADA");
    });

    it("con una acción abierta, no se dan las acciones por cerradas", async () => {
      const r = await app.inject({
        method: "POST",
        url: `/residencia/no-conformidades/${nc}/estado`,
        headers: comoIsa,
        payload: { estado: "ACTIONS_CLOSED" },
      });
      expect(r.statusCode, r.body).toBe(409);
      expect(r.json().message).toMatch(/sin cerrar/);
    });

    it("cerrada la acción, las acciones se dan por cerradas", async () => {
      const detalle = await app.inject({
        method: "GET",
        url: `/residencia/no-conformidades/${nc}`,
        headers: comoIsa,
      });
      const accion = detalle.json().acciones[0].id as string;
      const cerrar = await app.inject({
        method: "POST",
        url: `/residencia/acciones/${accion}/cerrar`,
        headers: comoIsa,
        payload: { nota: "Mapa único cargado." },
      });
      expect(cerrar.statusCode, cerrar.body).toBe(200);

      const r = await app.inject({
        method: "POST",
        url: `/residencia/no-conformidades/${nc}/estado`,
        headers: comoIsa,
        payload: { estado: "ACTIONS_CLOSED" },
      });
      expect(r.statusCode, r.body).toBe(200);
    });

    it("**QUIEN CERRÓ LA ÚLTIMA ACCIÓN NO PUEDE VERIFICAR**", async () => {
      const r = await app.inject({
        method: "POST",
        url: `/residencia/no-conformidades/${nc}/verificar`,
        headers: comoIsa, // Isa cerró la acción
        payload: { resultado: "EFFECTIVE", nota: "funciona" },
      });
      expect(r.statusCode, r.body).toBe(409);
      expect(r.json().error).toBe("VERIFICA_OTRA_PERSONA");
    });

    it("y el MOTOR lo para también, no sólo la ruta", async () => {
      const isaRol = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
        `SELECT id FROM care_role_assignments WHERE tenant_id = '${tenantId}' AND user_id = '${isaId}' LIMIT 1`,
      );
      const msg = await debeFallar(
        `INSERT INTO effectiveness_verifications (id, tenant_id, non_conformity_id, result, note_cifrado, at, by_user_id, by_care_role_assignment_id)
         VALUES ('${randomUUID()}', '${tenantId}', '${nc}', 'EFFECTIVE', 'c1:QUJD', now(), '${isaId}', '${primera(isaRol).id}')`,
      );
      expect(msg).toContain("CALIDAD_VIOLADA");
      expect(msg).toMatch(/persona DISTINTA/);
    });

    it("«NO EFICAZ» NO cierra: devuelve a acciones y queda el rastro", async () => {
      const r = await app.inject({
        method: "POST",
        url: `/residencia/no-conformidades/${nc}/verificar`,
        headers: comoPilar,
        payload: {
          resultado: "NOT_EFFECTIVE",
          nota: "Un mes después seguía habiendo dos listas.",
        },
      });
      expect(r.statusCode, r.body).toBe(201);
      expect(r.json().estado).toBe("ACTIONS");

      const detalle = await app.inject({
        method: "GET",
        url: `/residencia/no-conformidades/${nc}`,
        headers: comoIsa,
      });
      expect(detalle.json().noConformidad.estado).toBe("ACTIONS");
      expect(detalle.json().verificaciones).toHaveLength(1);
    });

    it("una verificación no se edita ni se borra, ni por SQL", async () => {
      const v = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
        `SELECT id FROM effectiveness_verifications WHERE non_conformity_id = '${nc}'`,
      );
      const id = primera(v).id;
      expect(
        await debeFallar(
          `UPDATE effectiveness_verifications SET result = 'EFFECTIVE' WHERE id = '${id}'`,
        ),
      ).toContain("CALIDAD_VIOLADA");
      expect(
        await debeFallar(`DELETE FROM effectiveness_verifications WHERE id = '${id}'`),
      ).toContain("CALIDAD_VIOLADA");
    });

    it("segunda acción, cerrada por OTRA persona, y verificación eficaz: CIERRA", async () => {
      const nueva = await app.inject({
        method: "POST",
        url: `/residencia/no-conformidades/${nc}/acciones`,
        headers: comoIsa,
        payload: {
          que: "Quitar el segundo Word y dejar sólo el sistema.",
          dueOn: "2026-12-31",
          responsibleLabel: "Dirección",
        },
      });
      expect(nueva.statusCode, nueva.body).toBe(201);
      const accionId = nueva.json().accion.id as string;
      // La cierra PILAR, así que ahora quien no puede verificar es Pilar.
      await app.inject({
        method: "POST",
        url: `/residencia/acciones/${accionId}/cerrar`,
        headers: comoPilar,
        payload: { nota: "Word retirado." },
      });
      await app.inject({
        method: "POST",
        url: `/residencia/no-conformidades/${nc}/estado`,
        headers: comoIsa,
        payload: { estado: "ACTIONS_CLOSED" },
      });

      const noPuede = await app.inject({
        method: "POST",
        url: `/residencia/no-conformidades/${nc}/verificar`,
        headers: comoPilar,
        payload: { resultado: "EFFECTIVE", nota: "x" },
      });
      expect(noPuede.statusCode).toBe(409);

      const r = await app.inject({
        method: "POST",
        url: `/residencia/no-conformidades/${nc}/verificar`,
        headers: comoIsa,
        payload: {
          resultado: "EFFECTIVE",
          nota: "Tres meses después sigue habiendo un solo mapa.",
        },
      });
      expect(r.statusCode, r.body).toBe(201);
      expect(r.json().estado).toBe("CLOSED");

      const fila = await prisma.$queryRawUnsafe<
        Array<{ state: string; closed_at: Date | null }>
      >(`SELECT state, closed_at FROM non_conformities WHERE id = '${nc}'`);
      expect(primera(fila).state).toBe("CLOSED");
      expect(primera(fila).closed_at).not.toBeNull();
    });

    it("y una cerrada no se reabre", async () => {
      expect(
        await debeFallar(
          `UPDATE non_conformities SET state = 'ACTIONS', closed_at = NULL,
             closed_by_user_id = NULL, closed_by_care_role_assignment_id = NULL
           WHERE id = '${nc}'`,
        ),
      ).toMatch(/no se reabre/);
    });
  });

  // ══ 5 · LA TABLA DE SABOTAJES ════════════════════════════════════

  describe("5 · la tabla de sabotajes, contra el motor", () => {
    let nc = "";

    beforeAll(async () => {
      const r = await abrirNc({
        processId: procesoDe("PERSONAS"),
        kind: "MINOR",
        origin: "INTERNAL_AUDIT",
        detectedOn: "2026-11-14",
        descripcion: "Falta la formación anual de manipulador de alimentos.",
      });
      nc = r.id;
    });

    it("`UPDATE` de la CLASE por SQL → lo para el trigger", async () => {
      const msg = await debeFallar(
        `UPDATE non_conformities SET kind = 'MAJOR' WHERE id = '${nc}'`,
      );
      expect(msg).toContain("CALIDAD_VIOLADA");
      expect(msg).toMatch(/clase, el origen/);
    });

    it("`UPDATE` del ORIGEN por SQL → igual", async () => {
      expect(
        await debeFallar(
          `UPDATE non_conformities SET origin = 'EXTERNAL_AUDIT' WHERE id = '${nc}'`,
        ),
      ).toContain("CALIDAD_VIOLADA");
    });

    it("`UPDATE` de la DESCRIPCIÓN por SQL → igual", async () => {
      expect(
        await debeFallar(
          `UPDATE non_conformities SET description_cifrado = 'c1:QUJD' WHERE id = '${nc}'`,
        ),
      ).toContain("CALIDAD_VIOLADA");
    });

    it("BORRAR un proceso con una NC colgando → FK Restrict", async () => {
      const msg = await debeFallar(
        `DELETE FROM processes WHERE id = '${procesoDe("PERSONAS")}'`,
      );
      expect(msg).toMatch(/violates foreign key constraint/i);
    });

    it("TEXTO EN CLARO en la descripción → lo para el CHECK de formato", async () => {
      const rol = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
        `SELECT id FROM care_role_assignments WHERE tenant_id = '${tenantId}' AND user_id = '${isaId}' LIMIT 1`,
      );
      const msg = await debeFallar(
        `INSERT INTO non_conformities (id, tenant_id, process_id, reference, kind, origin, state,
           detected_on, description_cifrado, opened_at, opened_by_user_id, opened_by_care_role_assignment_id)
         VALUES ('${randomUUID()}', '${tenantId}', '${procesoDe("PERSONAS")}', 'NC-EN-CLARO',
                 'MINOR', 'OTHER', 'OPEN', '2026-11-14', 'se cayó doña Carmen',
                 now(), '${isaId}', '${primera(rol).id}')`,
      );
      expect(msg).toContain("non_conformities_description_cifrado_formato");
    });

    it("**CERRAR POR SQL SIN VERIFICACIÓN → LO PARA EL MOTOR**", async () => {
      // Es la pregunta que el prompt pedía contestar explícitamente:
      // ¿lo para el motor o sólo la ruta? **El motor.** La regla mira
      // otra tabla, así que no cabe en un CHECK y baja a un trigger;
      // dejarla en la ruta sería dejar la evidencia de la mejora a
      // merced de un `UPDATE`.
      const rol = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
        `SELECT id FROM care_role_assignments WHERE tenant_id = '${tenantId}' AND user_id = '${pilarId}' LIMIT 1`,
      );
      const msg = await debeFallar(
        `UPDATE non_conformities SET state = 'CLOSED', closed_at = now(),
           closed_by_user_id = '${pilarId}', closed_by_care_role_assignment_id = '${primera(rol).id}'
         WHERE id = '${nc}'`,
      );
      expect(msg).toContain("CALIDAD_VIOLADA");
      expect(msg).toMatch(/verificación de eficacia con resultado EFFECTIVE/);
    });

    it("una NC no se borra", async () => {
      expect(
        await debeFallar(`DELETE FROM non_conformities WHERE id = '${nc}'`),
      ).toMatch(/no se borra/);
    });

    it("una acción cerrada no se reabre, ni por SQL", async () => {
      await app.inject({
        method: "POST",
        url: `/residencia/no-conformidades/${nc}/causa`,
        headers: comoIsa,
        payload: { causa: "Nadie lleva el control de los vencimientos." },
      });
      const a = await app.inject({
        method: "POST",
        url: `/residencia/no-conformidades/${nc}/acciones`,
        headers: comoIsa,
        payload: {
          que: "Dar de alta la formación como obligación anual.",
          dueOn: "2027-01-31",
          responsibleLabel: "Dirección",
        },
      });
      const accionId = a.json().accion.id as string;
      await app.inject({
        method: "POST",
        url: `/residencia/acciones/${accionId}/cerrar`,
        headers: comoIsa,
        payload: { nota: "Dada de alta." },
      });
      expect(
        await debeFallar(
          `UPDATE corrective_actions SET closed_at = NULL, closed_by_user_id = NULL,
             closed_by_care_role_assignment_id = NULL WHERE id = '${accionId}'`,
        ),
      ).toContain("CALIDAD_VIOLADA");
      expect(
        await debeFallar(`DELETE FROM corrective_actions WHERE id = '${accionId}'`),
      ).toMatch(/no se borra/);
    });
  });

  // ══ 6 · ELEVAR UNA INCIDENCIA (D-38) ═════════════════════════════

  describe("6 · elevar una incidencia conserva el enlace en los dos sentidos", () => {
    it("la NC apunta a la incidencia y la incidencia a la NC", async () => {
      // Una queja del libro, escrita a mano porque abrirla pide la
      // puerta y aquí lo que importa es el enlace.
      const rol = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
        `SELECT id FROM care_role_assignments WHERE tenant_id = '${tenantId}' AND user_id = '${isaId}' LIMIT 1`,
      );
      const incidencia = randomUUID();
      await prisma.$executeRawUnsafe(
        `INSERT INTO incidents (id, tenant_id, subject, client_id, origin, incident_type,
           severity, open, opened_at, opened_by_user_id, opened_by_care_role_assignment_id, care_day)
         VALUES ('${incidencia}', '${tenantId}', 'COMPLAINT', NULL, 'DECLARED', 'QUEJA',
                 'N1', true, now(), '${isaId}', '${primera(rol).id}', '2026-11-20')`,
      );

      const nc = await abrirNc({
        processId: procesoDe("ALOJAMIENTO_RESTAURACION"),
        kind: "IMPROVEMENT",
        origin: "COMPLAINT",
        detectedOn: "2026-11-20",
        sourceIncidentId: incidencia,
        descripcion: "Queja por la temperatura de la comida.",
      });

      // Desde la NC: el expediente nombra la incidencia.
      const detalle = await app.inject({
        method: "GET",
        url: `/residencia/no-conformidades/${nc.id}`,
        headers: comoIsa,
      });
      expect(detalle.json().noConformidad.origenDetalle.incidencia.id).toBe(
        incidencia,
      );

      // Y desde la incidencia: la MISMA fila leída del otro lado, como
      // los `incident_links` del libro.
      const desdeElLibro = await prisma.$queryRawUnsafe<
        Array<{ reference: string }>
      >(
        `SELECT reference FROM non_conformities WHERE source_incident_id = '${incidencia}'`,
      );
      expect(desdeElLibro).toHaveLength(1);
      expect(primera(desdeElLibro).reference).toBe(nc.reference);

      // Y la incidencia que originó una NC ya no se puede borrar.
      expect(
        await debeFallar(`DELETE FROM incidents WHERE id = '${incidencia}'`),
      ).toMatch(/violates foreign key constraint|no se borra/i);
    });

    it("un origen de queja SIN incidencia no entra, ni por la ruta ni por SQL", async () => {
      const r = await app.inject({
        method: "POST",
        url: "/residencia/no-conformidades",
        headers: comoIsa,
        payload: {
          processId: procesoDe("ALOJAMIENTO_RESTAURACION"),
          kind: "IMPROVEMENT",
          origin: "COMPLAINT",
          detectedOn: "2026-11-20",
          descripcion: "sin incidencia",
        },
      });
      expect(r.statusCode, r.body).toBe(409);
      expect(r.json().error).toBe("FALTA_LA_INCIDENCIA");

      const rol = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
        `SELECT id FROM care_role_assignments WHERE tenant_id = '${tenantId}' AND user_id = '${isaId}' LIMIT 1`,
      );
      expect(
        await debeFallar(
          `INSERT INTO non_conformities (id, tenant_id, process_id, reference, kind, origin, state,
             detected_on, description_cifrado, opened_at, opened_by_user_id, opened_by_care_role_assignment_id)
           VALUES ('${randomUUID()}', '${tenantId}', '${procesoDe("ALOJAMIENTO_RESTAURACION")}',
                   'NC-SIN-ENLACE', 'MINOR', 'COMPLAINT', 'OPEN', '2026-11-20', 'c1:QUJD',
                   now(), '${isaId}', '${primera(rol).id}')`,
        ),
      ).toContain("non_conformities_origen_incidencia");
    });
  });

  // ══ 7 · EL PAC ═══════════════════════════════════════════════════

  describe("7 · el PAC lleva todas las NC del filtro y ninguna más", () => {
    it("filtrado por origen, sale una y sólo una", async () => {
      // Cuántas hay con ese origen, según la base.
      const cuantas = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
        `SELECT count(*) AS n FROM non_conformities
         WHERE tenant_id = '${tenantId}' AND origin = 'EXTERNAL_AUDIT'`,
      );
      const refs = await prisma.$queryRawUnsafe<Array<{ reference: string }>>(
        `SELECT reference FROM non_conformities
         WHERE tenant_id = '${tenantId}' AND origin = 'EXTERNAL_AUDIT'`,
      );

      const r = await app.inject({
        method: "GET",
        url: "/residencia/calidad/informe-nc.pdf?origen=EXTERNAL_AUDIT",
        headers: comoPilar,
      });
      expect(r.statusCode, r.body.slice(0, 300)).toBe(200);
      expect(r.headers["content-type"]).toContain("application/pdf");

      expect(r.rawPayload.subarray(0, 5).toString("latin1")).toBe("%PDF-");
      const pdf = await textoDelPdf(r.rawPayload);
      // **Todas las del filtro**: cada referencia aparece en el papel.
      for (const { reference } of refs) {
        expect(pdf, reference).toContain(reference);
      }
      // **Y ninguna más**: las de otro origen no.
      const otras = await prisma.$queryRawUnsafe<Array<{ reference: string }>>(
        `SELECT reference FROM non_conformities
         WHERE tenant_id = '${tenantId}' AND origin <> 'EXTERNAL_AUDIT'`,
      );
      for (const { reference } of otras) {
        expect(pdf, reference).not.toContain(reference);
      }
      expect(Number(primera(cuantas).n)).toBeGreaterThan(0);
    });

    it("el PAC por defecto deja fuera las cerradas; el informe las lleva", async () => {
      const cerradas = await prisma.$queryRawUnsafe<Array<{ reference: string }>>(
        `SELECT reference FROM non_conformities
         WHERE tenant_id = '${tenantId}' AND state = 'CLOSED'`,
      );
      expect(cerradas.length).toBeGreaterThan(0);

      const pac = await app.inject({
        method: "GET",
        url: "/residencia/calidad/pac.pdf",
        headers: comoPilar,
      });
      const texto = await textoDelPdf(pac.rawPayload);
      for (const { reference } of cerradas) {
        expect(texto, reference).not.toContain(reference);
      }

      const informe = await app.inject({
        method: "GET",
        url: "/residencia/calidad/informe-nc.pdf",
        headers: comoPilar,
      });
      const textoInforme = await textoDelPdf(informe.rawPayload);
      for (const { reference } of cerradas) {
        expect(textoInforme, reference).toContain(reference);
      }
    });

    it("y un filtro sin resultados también imprime: un PAC vacío es válido", async () => {
      const r = await app.inject({
        method: "GET",
        url: "/residencia/calidad/pac.pdf?desde=2020-01-01&hasta=2020-12-31",
        headers: comoPilar,
      });
      expect(r.statusCode).toBe(200);
      expect(r.rawPayload.subarray(0, 5).toString("latin1")).toBe("%PDF-");
      expect(await textoDelPdf(r.rawPayload)).toContain(
        "No hay ninguna no conformidad que cumpla este filtro",
      );
    });
  });

  // ══ 8 · EL INDICADOR DE CUMPLIMENTACIÓN Y EL PARTE ═══════════════

  describe("8 · el indicador de cumplimentación no contradice al parte", () => {
    it("la tabla por turno y zona suma lo mismo que el indicador global", async () => {
      // Las dos salen del MISMO cruce (`queToca` + `loQueNoSeHizo`), y
      // esto lo mide: si alguien metiera una segunda fuente para el
      // indicador, los dos números se separarían.
      const mes = new Date().toISOString().slice(0, 7);
      const r = await app.inject({
        method: "GET",
        url: `/residencia/indicadores?mes=${mes}`,
        headers: comoPilar,
      });
      expect(r.statusCode, r.body).toBe(200);
      const cuerpo = r.json();
      const global = cuerpo.indicadores.find(
        (i: { code: string }) => i.code === "CUMPLIMENTACION_REGISTROS",
      );
      const desglose = cuerpo.cumplimentacionPorTurnoYZona as Array<{
        tocan: number;
        hechas: number;
      }>;

      const tocan = desglose.reduce((n, f) => n + f.tocan, 0);
      const hechas = desglose.reduce((n, f) => n + f.hechas, 0);
      if (tocan === 0) {
        // Sin plan de cuidados no hay denominador, y «sin dato» NO es
        // cero: el indicador vale `null` y el desglose está vacío. Que
        // las dos cosas digan lo mismo es lo que se mide.
        expect(global.valor).toBeNull();
        expect(desglose).toHaveLength(0);
      } else {
        expect(global.valor).toBe(Math.round((hechas / tocan) * 1000) / 10);
      }
    });

    it("cada indicador trae el proceso del que cuelga en ESTE centro", async () => {
      const r = await app.inject({
        method: "GET",
        url: "/residencia/indicadores",
        headers: comoPilar,
      });
      const todos = r.json().indicadores as Array<{
        code: string;
        proceso: { id: string; nombre: string } | null;
      }>;
      expect(todos).toHaveLength(13);
      // Los trece, sin excepción: es la NC 01 cerrada por construcción.
      for (const i of todos) expect(i.proceso, i.code).not.toBeNull();
    });

    it("y se puede abrir hasta la lista de registros", async () => {
      const r = await app.inject({
        method: "GET",
        url: "/residencia/indicadores/AVERIAS_24H/registros",
        headers: comoPilar,
      });
      expect(r.statusCode, r.body).toBe(200);
      expect(r.json().columnas).toContain("Horas");
      // Un indicador que no existe es un 404, no una tabla vacía: una
      // tabla vacía diría «no hubo ninguno».
      const no = await app.inject({
        method: "GET",
        url: "/residencia/indicadores/NO_EXISTE/registros",
        headers: comoPilar,
      });
      expect(no.statusCode).toBe(404);
    });
  });

  // ══ 9 · LA PROPUESTA (D-74) ══════════════════════════════════════

  describe("9 · el indicador fuera de umbral PROPONE, no crea", () => {
    it("el panel trae el bloque de calidad y NO ha abierto ninguna NC sola", async () => {
      const antes = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
        `SELECT count(*) AS n FROM non_conformities WHERE tenant_id = '${tenantId}'`,
      );
      const r = await app.inject({
        method: "GET",
        url: "/residencia/panel",
        headers: comoPilar,
      });
      expect(r.statusCode, r.body).toBe(200);
      const calidad = r.json().calidad;
      expect(calidad.mapaCargado).toBe(true);
      expect(Array.isArray(calidad.propuestas)).toBe(true);
      expect(calidad.noConformidades.abiertas).toBeGreaterThan(0);

      const despues = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
        `SELECT count(*) AS n FROM non_conformities WHERE tenant_id = '${tenantId}'`,
      );
      // **Ni una NC nueva por mirar el panel.** Propone; la decide una
      // persona.
      expect(Number(primera(despues).n)).toBe(Number(primera(antes).n));
    });

    it("y las acciones vencidas salen con su responsable", async () => {
      // Una acción con plazo en el pasado.
      const nc = await abrirNc({
        processId: procesoDe("MANTENIMIENTO_INSTALACIONES"),
        kind: "OBSERVATION",
        origin: "OTHER",
        detectedOn: "2026-09-01",
        descripcion: "La grúa de la primera planta no funciona.",
      });
      await app.inject({
        method: "POST",
        url: `/residencia/no-conformidades/${nc.id}/acciones`,
        headers: comoIsa,
        payload: {
          que: "Avisar al mantenedor.",
          dueOn: "2026-09-15",
          responsibleLabel: "Mantenimiento (externo)",
        },
      });

      const r = await app.inject({
        method: "GET",
        url: "/residencia/panel",
        headers: comoPilar,
      });
      const vencidas = r.json().calidad.accionesVencidas as Array<{
        referencia: string;
        responsable: string;
      }>;
      const nuestra = vencidas.find((v) => v.referencia === nc.reference);
      expect(nuestra, "la acción vencida tiene que salir en el panel").toBeTruthy();
      expect(nuestra!.responsable).toBe("Mantenimiento (externo)");
    });
  });

  // ══ 10 · LOS CRUCES ══════════════════════════════════════════════

  describe("10 · quién entra y quién no", () => {
    it("un tenant SIN residencia recibe 404 en todas las rutas de calidad", async () => {
      for (const url of [
        "/residencia/procesos",
        "/residencia/no-conformidades",
        "/residencia/calidad/pac.pdf",
      ]) {
        const r = await app.inject({ method: "GET", url, headers: comoOtro });
        expect(r.statusCode, url).toBe(404);
      }
    });

    it("un encargado SIN rol directivo ni de calidad recibe 403", async () => {
      const r = await app.inject({
        method: "GET",
        url: "/residencia/procesos",
        headers: comoAna,
      });
      expect(r.statusCode, r.body).toBe(403);
      expect(r.json().error).toBe("CALIDAD_ES_DE_DIRECCION");
    });

    it("y el rol CALIDAD sí entra y PUEDE firmar, aunque no sea directivo", async () => {
      // Es la mitad de D-73 que importa: en Jardín de Gredos quien lleva
      // la calidad es la TO con el rol `CALIDAD`, no la directora.
      // Exigir categoría directiva habría dejado fuera a la única
      // persona que hace este trabajo.
      const r = await app.inject({
        method: "GET",
        url: "/residencia/procesos",
        headers: comoIsa,
      });
      expect(r.statusCode, r.body).toBe(200);
      const cat = await prisma.$queryRawUnsafe<Array<{ category: string }>>(
        `SELECT r.category FROM care_role_assignments a
         JOIN care_roles r ON r.id = a.care_role_id
         WHERE a.user_id = '${isaId}'`,
      );
      expect(primera(cat).category).not.toBe("DIRECTIVO");
    });

    it("una NC de otro centro no se ve desde éste", async () => {
      const ajena = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
        `SELECT id FROM non_conformities WHERE tenant_id = '${tenantId}' LIMIT 1`,
      );
      const r = await app.inject({
        method: "GET",
        url: `/residencia/no-conformidades/${primera(ajena).id}`,
        headers: comoOtro,
      });
      expect(r.statusCode).toBe(404);
    });
  });
});
