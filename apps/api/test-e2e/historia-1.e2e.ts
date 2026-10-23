// historia-1 · **LA FICHA CLÍNICA, LAS AUSENCIAS, EL INGRESO Y EL ALTA,
// CONTRA POSTGRES.**
//
// Lo que este fichero prueba es lo que no se ve mirando el esquema: el
// camino completo de cada decisión, con los triggers encendidos y el
// registro de accesos escribiendo.
//
//    1. **CORREGIR UNA ALERGIA DEJA LA ANTERIOR INTACTA** (D-90). Se
//       retira con su motivo y se escribe la buena; las dos filas quedan,
//       y el `UPDATE` por SQL **lo para el motor**.
//    2. **«SIN ALERGIAS CONOCIDAS» NO ES «SIN FILAS»** (D-90). Las dos
//       situaciones se distinguen por la API, que es la diferencia sobre
//       la que medicación va a bloquear.
//    3. **LA FRANJA DE LA PUERTA NO LLEVA DIAGNÓSTICOS** (D-91). Con la
//       ficha entera cargada, lo que llega a la tablet son frases
//       accionables y **ni una palabra del diagnóstico**.
//    4. **UN RESIDENTE AUSENTE NO GENERA «NO HECHO» NI ENTRA EN EL
//       DENOMINADOR** (D-92). Las dos mitades: el parte lo dice una vez y
//       `cuantoVaHecho` lo saca de la cuenta.
//    5. **LA SALIDA NO CONTROLADA NACE N4 Y SUENA** (D-92). Con su
//       incidencia en el libro, su aviso a guardia y la versión 2 de la
//       plantilla dentro.
//    6. **LOS DÍAS DEL MES** por la API (D-93), con la ausencia que cruza
//       de mes.
//    7. **EL ALTA CIERRA PLAN, CAMA Y AUSENCIA, Y NO BORRA NADA** (D-96),
//       y crea la obligación de comunicar la baja de una concertada.
//    8. **EL CHECKLIST DA POR CUMPLIDO LO QUE YA EXISTE** (D-94), y lo
//       `auto` **no se puede marcar a mano**.
//
// Y la **tabla de sabotajes** contra el motor: el `UPDATE` de una
// alergia, el borrado de una ausencia, la lectura de la ficha sin pasar
// por el registro de accesos y una regla de gravedad de centro.

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { E2E_DATABASE_URL, e2eEnabled, SKIP_MESSAGE } from "./e2e-env.js";

process.env.CLINICAL_FILES_DIR = join(
  tmpdir(),
  "mipiacetpv-e2e-clinical-files-h1",
);
process.env.NODE_ENV = "test";
process.env.DATABASE_URL =
  E2E_DATABASE_URL || "postgresql://e2e:e2e@127.0.0.1:5432/e2e";
process.env.REDIS_URL = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";
process.env.JWT_ACCESS_SECRET = "k".repeat(40);
process.env.JWT_REFRESH_SECRET = "l".repeat(40);
process.env.HOLDED_KEY_ENCRYPTION_SECRET = randomBytes(32).toString("base64");

// El Redis en memoria de la suite: el aviso de guardia de la salida no
// controlada lo empuja por él, y la CI no tiene Redis.
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
const { VERSION_DE_LA_PLANTILLA } = await import(
  "../src/residencia/catalogo/plantilla-de-gravedad.js"
);
const { sembrarResidencia } = await import("../src/residencia/semilla.js");
const { registerResidenciaResidentesRoutes } = await import(
  "../src/residencia/residentes-routes.js"
);
const { registerResidenciaFichaClinicaRoutes } = await import(
  "../src/residencia/ficha-clinica-routes.js"
);
const { registerResidenciaAusenciasRoutes } = await import(
  "../src/residencia/ausencias-routes.js"
);
const { registerResidenciaIngresoRoutes } = await import(
  "../src/residencia/ingreso-routes.js"
);
const { registerResidenciaPuertaRegistroRoutes } = await import(
  "../src/residencia/puerta-registro-routes.js"
);
const { registerResidenciaPanelRoutes } = await import(
  "../src/residencia/panel-routes.js"
);
const { signAccessToken } = await import("../src/auth/tokens.js");
const { registrarSitioDeLectura } = await import(
  "../src/lib/sitio-de-lectura.js"
);
const { olvidarClaves } = await import("../src/clinica/claves.js");
const { construirParte, ventanaDelTurno } = await import(
  "../src/residencia/relevo.js"
);
const { diaDelTurno, turnoDe, cuantoVaHecho, queToca } = await import(
  "@mipiacetpv/residencia-plan"
);
const { ausenciasDelPlan } = await import("../src/residencia/ausencias.js");
const { deColumnas, FRECUENCIA_SELECT } = await import(
  "../src/residencia/frecuencia-columnas.js"
);

// ── LOS CANARIOS ────────────────────────────────────────────────────
//
// Cadenas que no existen en ningún sitio del producto, metidas dentro de
// cada texto libre de la ficha. Lo que prueban es la mitad de D-91: **si
// un canario aparece en el cuerpo que recibe la tablet, un dato clínico
// se publicó en un pasillo.**
//
// Son canarios y no las palabras de verdad («pan», «sonda») por algo que
// este fichero aprendió corriéndolo: `pan` está dentro de `ocupantes`, y
// el test salía rojo por una subcadena del propio contrato de la API. Un
// canario no se puede confundir con nada.
const CANARIOS = {
  diagnostico: "ZZDIAGNOSTICOZZ",
  icd10: "ZZCIEZZ",
  reaccion: "ZZREACCIONZZ",
  dispositivo: "ZZSONDAZZ",
  dieta: "ZZDIETAZZ",
} as const;

function primera<T>(filas: T[], que = "la fila"): T {
  const f = filas[0];
  if (f === undefined) throw new Error(`No se encontró ${que}.`);
  return f;
}

/** Un INSERT/UPDATE que tiene que FALLAR. Devuelve el mensaje. */
async function debeFallar(sql: string): Promise<string> {
  try {
    await getPrisma().$executeRawUnsafe(sql);
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
  throw new Error(`El motor ACEPTÓ lo que no debía:\n${sql}`);
}

describe.skipIf(!e2eEnabled)("e2e · historia-1 · la ficha clínica", () => {
  if (!e2eEnabled) console.warn(`\n${SKIP_MESSAGE}\n`);

  const prisma = getPrisma();
  let app: FastifyInstance;
  let tenantId = "";
  let pilarId = "";
  let rosaId = "";
  let anaId = "";
  let planta1 = "";
  let hab112 = "";
  let carmenId = "";
  let luisId = "";
  let antonioId = "";
  let tokenPuerta = "";
  let comoPilar: Record<string, string> = {};
  let comoAna: Record<string, string> = {};
  let turnos: Array<{ id: string; code: string; starts_at: string; ends_at: string }> =
    [];

  function turno(code: string) {
    const t = turnos.find((x) => x.code === code)!;
    return {
      id: t.id,
      code: t.code,
      name: code,
      startsAt: t.starts_at,
      endsAt: t.ends_at,
    };
  }

  /** La ficha de un residente, por la API y con su línea de acceso. */
  function leerFicha(clientId: string, como = comoPilar) {
    return app.inject({
      method: "GET",
      url: `/residencia/residentes/${clientId}/ficha`,
      headers: como,
    });
  }

  function post(
    url: string,
    payload: Record<string, unknown> | undefined,
    como = comoPilar,
  ) {
    return app.inject({
      method: "POST",
      url,
      headers: como,
      ...(payload === undefined ? {} : { payload }),
    });
  }

  beforeAll(async () => {
    await cargarCatalogoDeSerie();
    await cargarPlantillaDeGravedad();

    tenantId = randomUUID();
    pilarId = randomUUID();
    rosaId = randomUUID();
    anaId = randomUUID();

    await prisma.$executeRawUnsafe(
      `INSERT INTO tenants (id, name, residencia_enabled, clinical_records_enabled, crm_enabled, agenda_enabled, caja_enabled, updated_at)
       VALUES ('${tenantId}', 'Jardín de Gredos (h1)', true, true, true, true, false, now())`,
    );
    for (const [u, alias, rol] of [
      [pilarId, "Pilar", "OWNER"],
      [rosaId, "Rosa", "CLINICIAN"],
      [anaId, "Ana", "CLINICIAN"],
    ] as const) {
      await prisma.$executeRawUnsafe(
        `INSERT INTO users (id, tenant_id, email, alias, role, is_clinician, clinical_scope)
         VALUES ('${u}', '${tenantId}', '${alias.toLowerCase()}-h1@gredos.es', '${alias}', '${rol}', true, 'SELECTION')`,
      );
    }
    await sembrarResidencia(prisma as never, tenantId);
    for (const [u, code] of [
      [pilarId, "DIRECCION"],
      // Rosa es DUE: la que escribe diagnósticos, alergias y dieta (D-90).
      [rosaId, "DUE"],
      // Ana es auxiliar: **no** escribe la ficha clínica, y sí apunta una
      // ausencia. Es el par que prueba las dos capacidades.
      [anaId, "AUXILIAR"],
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

    planta1 = randomUUID();
    hab112 = randomUUID();
    const camaA = randomUUID();
    const camaB = randomUUID();
    const hab113 = randomUUID();
    const camaC = randomUUID();
    await prisma.$executeRawUnsafe(
      `INSERT INTO floors (id, tenant_id, name, sort_order, updated_at)
       VALUES ('${planta1}', '${tenantId}', 'Primera', 1, now())`,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO rooms (id, tenant_id, floor_id, number, active, updated_at)
       VALUES ('${hab112}', '${tenantId}', '${planta1}', '112', true, now()),
              ('${hab113}', '${tenantId}', '${planta1}', '113', true, now())`,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO beds (id, tenant_id, room_id, label, active, updated_at)
       VALUES ('${camaA}', '${tenantId}', '${hab112}', 'A', true, now()),
              ('${camaB}', '${tenantId}', '${hab112}', 'B', true, now()),
              ('${camaC}', '${tenantId}', '${hab113}', 'A', true, now())`,
    );
    for (const u of [rosaId, anaId]) {
      await prisma.$executeRawUnsafe(
        `INSERT INTO care_zone_assignments (id, tenant_id, user_id, floor_id, from_at, granted_by_user_id)
         VALUES ('${randomUUID()}', '${tenantId}', '${u}', '${planta1}', now() - interval '30 days', '${pilarId}')`,
      );
    }

    const comoToken = (u: string, rol: "OWNER" | "MANAGER") => ({
      authorization: `Bearer ${signAccessToken({ sub: u, tid: tenantId, role: rol })}`,
    });
    comoPilar = comoToken(pilarId, "OWNER");
    // Ana entra como MANAGER: tiene las puertas de escritura del admin y
    // **no** tiene el rol de cuidado que la ficha clínica exige. Es lo que
    // prueba que la capacidad manda sobre el `UserRole` (D-90).
    comoAna = comoToken(anaId, "MANAGER");

    app = Fastify({ logger: false });
    registrarSitioDeLectura(app);
    await registerResidenciaResidentesRoutes(app);
    await registerResidenciaFichaClinicaRoutes(app);
    await registerResidenciaAusenciasRoutes(app);
    await registerResidenciaIngresoRoutes(app);
    await registerResidenciaPuertaRegistroRoutes(app);
    await registerResidenciaPanelRoutes(app);
    await app.ready();

    for (const [nombre, cama, plaza] of [
      ["Carmen", camaA, "CONCERTADA"],
      ["Luis", camaB, "PRIVADA"],
      ["Antonio", camaC, "CONCERTADA"],
    ] as const) {
      const r = await app.inject({
        method: "POST",
        url: "/residencia/residentes",
        headers: comoPilar,
        payload: {
          firstName: nombre,
          lastName: "Núñez",
          admissionDate: "2026-09-01",
          dependencyLevel: "DEPENDIENTE",
          placeType: plaza,
          bedId: cama,
        },
      });
      expect(r.statusCode, r.body).toBe(201);
      const id = r.json().residente.clientId as string;
      if (nombre === "Carmen") carmenId = id;
      else if (nombre === "Luis") luisId = id;
      else antonioId = id;
    }

    tokenPuerta = randomBytes(24).toString("hex");
    await prisma.$executeRawUnsafe(
      `INSERT INTO devices (id, tenant_id, kind, room_id, register_id, name, device_token_hash)
       VALUES ('${randomUUID()}', '${tenantId}', 'ROOM', '${hab112}', NULL, 'Puerta 112',
               '${createHash("sha256").update(tokenPuerta, "utf8").digest("hex")}')`,
    );

    turnos = await prisma.$queryRawUnsafe(
      `SELECT id, code, starts_at, ends_at FROM center_shifts WHERE tenant_id = '${tenantId}'`,
    );
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    olvidarClaves();
    await shutdown();
  });

  // ══════════════════════════════════════════════════════════════════
  //  1 · QUIÉN ESCRIBE LA FICHA (D-90)
  // ══════════════════════════════════════════════════════════════════

  describe("la ficha clínica la escriben el médico y la DUE", () => {
    it("una AUXILIAR no escribe un diagnóstico, aunque sea MANAGER", async () => {
      // La capacidad del rol de cuidado manda sobre el `UserRole` (D-90,
      // D-50): el encargado del bar de un centro mixto es un MANAGER y no
      // tiene por qué escribir un diagnóstico.
      const r = await post(
        `/residencia/residentes/${carmenId}/diagnosticos`,
        { texto: "Lo que sea", diagnosedOn: "2026-10-01" },
        comoAna,
      );
      expect(r.statusCode, r.body).toBe(403);
      expect(r.json().error).toBe("FICHA_ES_DE_OTRO_ROL");
      // Y la negativa dice QUIÉN sí, no «no autorizado».
      expect(r.json().message).toContain("la DUE");
    });

    it("y la DUE sí, con su capacidad firmada", async () => {
      const r = await post(
        `/residencia/residentes/${carmenId}/diagnosticos`,
        {
          texto: `Disfagia orofaríngea secundaria a Parkinson ${CANARIOS.diagnostico}`,
          icd10: `R13.1 ${CANARIOS.icd10}`,
          diagnosedOn: "2026-05-20",
          alerta: true,
          fraseDeAlerta: "Nunca con prisa y sentada del todo: se atraganta",
        },
        comoRosa(),
      );
      expect(r.statusCode, r.body).toBe(201);
      const ficha = (await leerFicha(carmenId)).json().ficha as {
        diagnosticos: Array<{ firmadoComo: string; texto: string }>;
      };
      const d = primera(ficha.diagnosticos, "el diagnóstico");
      expect(d.firmadoComo).toBe("DUE (enfermería)");
      expect(d.texto).toContain("Parkinson");
      expect(d.texto).toContain(CANARIOS.diagnostico);
    });

    it("**una alerta SIN frase se rechaza, con su explicación**", async () => {
      // Es el CHECK `resident_diagnoses_alerta_completa` traído a un 400:
      // sin la frase, la banda de la puerta nacería vacía o alguien
      // pondría el diagnóstico dentro.
      const r = await post(
        `/residencia/residentes/${carmenId}/diagnosticos`,
        { texto: "Algo grave", diagnosedOn: "2026-10-01", alerta: true },
        comoRosa(),
      );
      expect(r.statusCode, r.body).toBe(400);
      expect(r.json().error).toBe("FALTA_LA_FRASE_DE_ALERTA");
    });
  });

  function comoRosa(): Record<string, string> {
    return {
      authorization: `Bearer ${signAccessToken({
        sub: rosaId,
        tid: tenantId,
        role: "MANAGER",
      })}`,
    };
  }

  // ══════════════════════════════════════════════════════════════════
  //  2 · CORREGIR UNA ALERGIA DEJA LA ANTERIOR INTACTA (D-90)
  // ══════════════════════════════════════════════════════════════════

  describe("corregir una alergia deja la anterior intacta", () => {
    let malId = "";
    let buenaId = "";

    it("se escribe mal, se retira con su motivo y se escribe la buena", async () => {
      const mal = await post(
        `/residencia/residentes/${carmenId}/alergias`,
        {
          clase: "MEDICAMENTO",
          gravedad: "GRAVE",
          agente: "paracetamol",
          reaccion: "urticaria",
        },
        comoRosa(),
      );
      expect(mal.statusCode, mal.body).toBe(201);
      malId = mal.json().id;

      const retirada = await post(
        `/residencia/residentes/${carmenId}/alergias/${malId}/retirar`,
        { motivo: "era penicilina, no paracetamol" },
        comoRosa(),
      );
      expect(retirada.statusCode, retirada.body).toBe(200);

      const buena = await post(
        `/residencia/residentes/${carmenId}/alergias`,
        {
          clase: "MEDICAMENTO",
          gravedad: "GRAVE",
          agente: "penicilina",
          reaccion: `urticaria generalizada y edema de labios ${CANARIOS.reaccion}`,
        },
        comoRosa(),
      );
      expect(buena.statusCode, buena.body).toBe(201);
      buenaId = buena.json().id;
    });

    it("**las DOS filas quedan**, y la retirada con su motivo y su autor", async () => {
      const ficha = (await leerFicha(carmenId)).json().ficha;
      const mal = ficha.alergias.find((a: { id: string }) => a.id === malId);
      const buena = ficha.alergias.find((a: { id: string }) => a.id === buenaId);
      expect(mal, "la alergia mal escrita NO está").toBeTruthy();
      expect(mal.agente).toBe("paracetamol");
      expect(mal.retirada).toBe(true);
      expect(mal.motivoDeRetirada).toContain("penicilina");
      expect(buena.retirada).toBe(false);
      // Quien prescribe ve que alguien se equivocó y cuándo. Un `UPDATE`
      // habría dejado una historia que dice que siempre fue penicilina.
    });

    it("y SÓLO la buena entra en la franja", async () => {
      const ficha = (await leerFicha(carmenId)).json().ficha;
      const deAlergia = ficha.alertas.filter(
        (a: { clase: string }) => a.clase === "ALERGIA",
      );
      expect(deAlergia).toHaveLength(1);
      expect(deAlergia[0].frase).toBe("Alergia: penicilina");
    });

    it("una alergia retirada no se vuelve a retirar", async () => {
      const r = await post(
        `/residencia/residentes/${carmenId}/alergias/${malId}/retirar`,
        { motivo: "otra vez" },
        comoRosa(),
      );
      expect(r.statusCode).toBe(409);
      expect(r.json().error).toBe("YA_ESTABA_RETIRADA");
    });
  });

  // ══════════════════════════════════════════════════════════════════
  //  3 · «SIN ALERGIAS CONOCIDAS» NO ES «SIN FILAS» (D-90)
  // ══════════════════════════════════════════════════════════════════

  describe("«sin alergias conocidas» y «sin filas» se distinguen", () => {
    it("a Antonio nadie le ha preguntado: la revisión es `null`", async () => {
      const ficha = (await leerFicha(antonioId)).json().ficha;
      expect(ficha.alergias).toEqual([]);
      // **Ésta es la diferencia**: sin esta columna, la API diría lo
      // mismo de Antonio y de Luis, y medicación (Fase 2) no podría
      // bloquear sobre ella.
      expect(ficha.revisionDeAlergias).toBeNull();
    });

    it("a Luis se le preguntó y no tiene: la revisión lo dice, con autor", async () => {
      const r = await post(
        `/residencia/residentes/${luisId}/alergias/revision`,
        { sinAlergiasConocidas: true, fuente: "lo dice su hija" },
        comoRosa(),
      );
      expect(r.statusCode, r.body).toBe(201);
      const ficha = (await leerFicha(luisId)).json().ficha;
      expect(ficha.alergias).toEqual([]);
      expect(ficha.revisionDeAlergias.sinAlergiasConocidas).toBe(true);
      expect(ficha.revisionDeAlergias.revisadoComo).toBe("DUE (enfermería)");
      expect(ficha.revisionDeAlergias.fuente).toBe("lo dice su hija");
    });

    it("y «sin alergias conocidas» CON alergias apuntadas se rechaza", async () => {
      // La ficha diría las dos cosas a la vez, y la que mandaría sería la
      // última revisión — y entonces medicación dejaría prescribir
      // penicilina a alguien con una alergia a la penicilina en su ficha.
      const r = await post(
        `/residencia/residentes/${carmenId}/alergias/revision`,
        { sinAlergiasConocidas: true },
        comoRosa(),
      );
      expect(r.statusCode, r.body).toBe(409);
      expect(r.json().error).toBe("TIENE_ALERGIAS_APUNTADAS");
    });

    it("una revisión no se edita: se escribe otra", async () => {
      const antes = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
        `SELECT count(*) AS n FROM allergy_reviews WHERE client_id = '${luisId}'`,
      );
      const r = await post(
        `/residencia/residentes/${luisId}/alergias/revision`,
        { sinAlergiasConocidas: false, fuente: "informe del alta del hospital" },
        comoRosa(),
      );
      expect(r.statusCode).toBe(201);
      const despues = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
        `SELECT count(*) AS n FROM allergy_reviews WHERE client_id = '${luisId}'`,
      );
      expect(Number(primera(despues).n)).toBe(Number(primera(antes).n) + 1);
      // Y la vigente es la ÚLTIMA.
      const ficha = (await leerFicha(luisId)).json().ficha;
      expect(ficha.revisionDeAlergias.sinAlergiasConocidas).toBe(false);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  //  4 · **LA FRANJA DE LA PUERTA NO LLEVA DIAGNÓSTICOS** (D-91)
  // ══════════════════════════════════════════════════════════════════

  describe("la franja de la puerta no lleva diagnósticos", () => {
    beforeAll(async () => {
      // La ficha de Carmen, entera: un diagnóstico marcado más la dieta
      // triturada con espesante y una sonda.
      await post(
        `/residencia/residentes/${carmenId}/dieta`,
        {
          textura: "TRITURADA",
          espesante: true,
          nivelDeEspesante: 2,
          restricciones: ["SIN_SAL"],
          notas: `le cuesta el pan ${CANARIOS.dieta}`,
        },
        comoRosa(),
      );
      await post(
        `/residencia/residentes/${carmenId}/dispositivos`,
        {
          code: "SONDA",
          detalle: `vesical permanente por retención ${CANARIOS.dispositivo}`,
          desde: "2026-06-01",
        },
        comoRosa(),
      );
      await post(
        `/residencia/residentes/${carmenId}/dispositivos`,
        { code: "GAFAS", desde: "2026-06-01" },
        comoRosa(),
      );
    });

    it("el ADMIN ve las dos caras: la frase y el detalle", async () => {
      const ficha = (await leerFicha(carmenId)).json().ficha;
      const frases = ficha.alertas.map((a: { frase: string }) => a.frase);
      expect(frases).toContain("Alergia: penicilina");
      expect(frases).toContain("Disfagia: triturado y espesante nivel 2");
      expect(frases).toContain("Lleva sonda");
      // Y las gafas NO alertan: una banda que lo pinta todo no se lee.
      expect(frases.join(" ")).not.toContain("gafas");
      // El detalle sí lleva el diagnóstico: es lo que el despacho necesita.
      const detalles = ficha.alertas
        .map((a: { detalle: string | null }) => a.detalle)
        .join(" | ");
      expect(detalles).toContain("Parkinson");
    });

    it("**y la PUERTA sólo las frases: ni una palabra del diagnóstico**", async () => {
      const r = await app.inject({
        method: "GET",
        url: "/residencia/puerta/arranque",
        headers: { "x-device-token": tokenPuerta },
      });
      expect(r.statusCode, r.body).toBe(200);
      const cuerpo = r.body;
      const carmen = r
        .json()
        .ocupantes.find((o: { clientId: string }) => o.clientId === carmenId);
      expect(carmen.alertas).toContain("Alergia: penicilina");
      expect(carmen.alertas).toContain(
        "Nunca con prisa y sentada del todo: se atraganta",
      );
      // **La prueba del bloque**: ni el diagnóstico, ni su código CIE-10,
      // ni la reacción de la alergia, ni el detalle de la sonda están en
      // NINGÚN sitio del cuerpo de la respuesta — no sólo en `alertas`.
      // **Los cinco canarios, y las palabras de verdad que no colisionan
      // con nada del contrato.** Si alguno aparece, un dato clínico se
      // publicó en una tablet de pasillo.
      for (const prohibido of [
        ...Object.values(CANARIOS),
        "Parkinson",
        "orofaríngea",
        "R13.1",
        "edema",
        "retención",
        "vesical",
      ]) {
        expect(cuerpo, `«${prohibido}» llegó a la tablet`).not.toContain(
          prohibido,
        );
      }
    });

    // `lo-que-toca` necesita sesión de puerta (PIN), que es de
    // residencia-3 y ya tiene su e2e. Lo que aquí importa es que la MISMA
    // función (`frasesDeLaPuerta`) alimenta las dos rutas: lo fija el test
    // del paquete puro —que comprueba que el resultado no contiene ningún
    // `detalle`— más el del arranque de arriba, que mira el cuerpo entero.
  });

  // ══════════════════════════════════════════════════════════════════
  //  5 · UN RESIDENTE AUSENTE NO GENERA «NO HECHO» (D-92)
  // ══════════════════════════════════════════════════════════════════

  describe("un residente ausente no genera «no hecho» ni entra en el denominador", () => {
    let ausenciaId = "";

    it("la apunta una AUXILIAR: es quien está delante", async () => {
      // Al contrario que un diagnóstico (D-90): la auxiliar que ve que la
      // ambulancia se lo lleva es la que lo apunta.
      const r = await post(
        `/residencia/residentes/${antonioId}/ausencias`,
        {
          tipo: "INGRESO_HOSPITALARIO",
          desde: new Date(Date.now() - 3 * 86_400_000).toISOString(),
          destino: "Hospital Nuestra Señora del Prado",
          motivo: "neumonía con desaturación",
        },
        comoAna,
      );
      expect(r.statusCode, r.body).toBe(201);
      ausenciaId = r.json().id;
      // Y sin incidencia: una ausencia planificada no abre nada en el libro.
      expect(r.json().incidentId).toBeNull();
    });

    it("una segunda ausencia abierta se rechaza: nadie está en dos sitios", async () => {
      const r = await post(
        `/residencia/residentes/${antonioId}/ausencias`,
        { tipo: "VACACIONES_FAMILIA", desde: new Date().toISOString() },
        comoAna,
      );
      expect(r.statusCode, r.body).toBe(409);
      expect(r.json().error).toBe("YA_ESTA_AUSENTE");
    });

    it("**el parte lo dice UNA VEZ y no genera ni un «no hecho» suyo**", async () => {
      const ahora = new Date();
      const t = turnoDe(ahora, turnos.map((x) => turno(x.code))) ?? turno("M");
      const careDay = diaDelTurno(ahora, t);
      const parte = await construirParte(prisma, {
        tenantId,
        turno: t,
        careDay,
        corte: ahora,
        ahora,
      });
      const lineasDeAntonio = parte.zonas
        .flatMap((z) => z.residentes)
        .filter((r) => r.clientId === antonioId)
        .flatMap((r) => r.lineas);
      const ausentes = lineasDeAntonio.filter((l) => l.clase === "AUSENTE");
      expect(ausentes, "el parte no dice que está ausente").toHaveLength(1);
      expect(ausentes[0]!.texto).toContain("ingresado en el hospital");
      // **Y CERO líneas de «no hecho»**: es la mitad de D-92 y la razón
      // de que la línea de arriba exista — sin ella, un residente ausente
      // sería invisible en el parte.
      expect(
        lineasDeAntonio.filter((l) => l.clase === "NO_HECHO"),
        "a un ausente se le reprochan cuidados",
      ).toEqual([]);
      // Y a Carmen, que SÍ está, sí se le cuentan.
      const deCarmen = parte.zonas
        .flatMap((z) => z.residentes)
        .filter((r) => r.clientId === carmenId)
        .flatMap((r) => r.lineas)
        .filter((l) => l.clase === "NO_HECHO");
      expect(deCarmen.length).toBeGreaterThan(0);
    });

    it("y **sale del DENOMINADOR**: `cuantoVaHecho` no lo cuenta", async () => {
      const t = turno("M");
      const careDay = diaDelTurno(new Date(), t);
      const { desde, hasta } = ventanaDelTurno(t, careDay);
      const plan = await prisma.carePlanItem.findMany({
        where: { tenantId },
        select: {
          id: true,
          clientId: true,
          controlCode: true,
          fromAt: true,
          toAt: true,
          ...FRECUENCIA_SELECT,
        },
      });
      const lineas = plan.map((l) => ({
        id: l.id,
        clientId: l.clientId,
        controlCode: l.controlCode,
        frecuencia: deColumnas(l),
        fromAt: l.fromAt,
        toAt: l.toAt,
      }));
      const controles = (
        await prisma.controlType.findMany({
          where: { supersededAt: null },
          select: { code: true, layer: true, nature: true },
        })
      ).map((c) => ({ code: c.code, layer: c.layer, nature: c.nature }));
      const turnosParaToca = turnos.map((x) => turno(x.code));

      const sinAusencias = cuantoVaHecho({
        ocurrencias: queToca(lineas, [], turnosParaToca, [], desde, hasta, []),
        registros: [],
        controles,
      });
      const conAusencias = cuantoVaHecho({
        ocurrencias: queToca(
          lineas,
          [],
          turnosParaToca,
          [],
          desde,
          hasta,
          await ausenciasDelPlan(prisma, tenantId, desde, hasta),
        ),
        registros: [],
        controles,
      });
      // El denominador BAJA: lo de Antonio no se le pide a nadie. Sin
      // esto, el indicador de AENOR del mes en que dos residentes pasan
      // una semana en el hospital sale por debajo del umbral y el centro
      // abre una acción correctiva por algo que no pasó.
      expect(conAusencias.tocan).toBeLessThan(sinAusencias.tocan);
    });

    it("al volver de un ingreso, la revisión queda PENDIENTE", async () => {
      const r = await post(
        `/residencia/residentes/${antonioId}/ausencias/${ausenciaId}/vuelta`,
        { vueltaEn: new Date().toISOString() },
        comoAna,
      );
      expect(r.statusCode, r.body).toBe(200);
      expect(r.json().dejaRevision).toBe(true);

      const panel = await app.inject({
        method: "GET",
        url: "/residencia/panel",
        headers: comoPilar,
      });
      const vueltas = panel.json().porArreglar.vueltasPorRevisar;
      expect(vueltas).toHaveLength(1);
      expect(vueltas[0].clientId).toBe(antonioId);
      expect(vueltas[0].deDonde).toBe("del hospital");
    });

    it("y **sólo la confirma quien supervisa**", async () => {
      const deAna = await post(
        `/residencia/residentes/${antonioId}/ausencias/${ausenciaId}/revisada`,
        undefined,
        comoAna,
      );
      expect(deAna.statusCode, deAna.body).toBe(403);
      expect(deAna.json().error).toBe("LA_REVISION_ES_DE_SUPERVISION");

      const deRosa = await post(
        `/residencia/residentes/${antonioId}/ausencias/${ausenciaId}/revisada`,
        undefined,
        comoRosa(),
      );
      expect(deRosa.statusCode, deRosa.body).toBe(200);

      const panel = await app.inject({
        method: "GET",
        url: "/residencia/panel",
        headers: comoPilar,
      });
      expect(panel.json().porArreglar.vueltasPorRevisar).toEqual([]);
    });

    it("una revisión confirmada no se deshace", async () => {
      const r = await post(
        `/residencia/residentes/${antonioId}/ausencias/${ausenciaId}/revisada`,
        undefined,
        comoRosa(),
      );
      expect(r.statusCode).toBe(409);
      expect(r.json().error).toBe("YA_ESTABA_REVISADA");
    });
  });

  // ══════════════════════════════════════════════════════════════════
  //  6 · LA SALIDA NO CONTROLADA NACE N4 Y SUENA (D-92)
  // ══════════════════════════════════════════════════════════════════

  describe("la salida no controlada nace N4 y suena", () => {
    it("abre su incidencia con la versión 2 de la plantilla dentro", async () => {
      const r = await post(
        `/residencia/residentes/${luisId}/ausencias`,
        {
          tipo: "SALIDA_NO_CONTROLADA",
          desde: new Date().toISOString(),
          motivo: "no está en el jardín y la puerta de la calle estaba abierta",
        },
        comoAna,
      );
      expect(r.statusCode, r.body).toBe(201);
      const incidentId = r.json().incidentId as string;
      expect(incidentId, "la salida no controlada NO abrió incidencia").toBeTruthy();

      const inc = primera(
        await prisma.$queryRawUnsafe<
          Array<{
            severity: string;
            incident_type: string;
            open: boolean;
            template_version: number;
          }>
        >(
          `SELECT severity, incident_type, open, template_version
             FROM incidents WHERE id = '${incidentId}'`,
        ),
        "la incidencia",
      );
      expect(inc.severity).toBe("N4");
      // **Tipo propio y no `NO_LOCALIZADO`**: un centro con fugas por la
      // puerta tiene un problema distinto del de un centro con
      // desapariciones dentro, y juntos en un tipo el indicador no lo
      // distingue.
      expect(inc.incident_type).toBe("SALIDA_NO_CONTROLADA");
      expect(inc.open).toBe(true);
      expect(inc.template_version).toBe(VERSION_DE_LA_PLANTILLA);
      expect(VERSION_DE_LA_PLANTILLA).toBe(2);
    });

    it("y **suena**: hay aviso de guardia por la incidencia", async () => {
      const avisos = await prisma.$queryRawUnsafe<
        Array<{ channel: string; state: string }>
      >(
        `SELECT a.channel, a.state FROM guard_alerts a
           JOIN incidents i ON i.id = a.incident_id
          WHERE i.tenant_id = '${tenantId}' AND i.incident_type = 'SALIDA_NO_CONTROLADA'`,
      );
      // N4 suena en los dos canales (D-66), y lo que este test fija es
      // que **suena**: un aviso que no sale es peor que no tenerlo.
      expect(avisos.length).toBeGreaterThan(0);
    });

    it("la ausencia apunta a su incidencia, y las demás no pueden", async () => {
      const fila = primera(
        await prisma.$queryRawUnsafe<Array<{ incident_id: string | null }>>(
          `SELECT incident_id FROM resident_absences
            WHERE client_id = '${luisId}' AND kind = 'SALIDA_NO_CONTROLADA'`,
        ),
        "la ausencia",
      );
      expect(fila.incident_id).toBeTruthy();
      // Y el CHECK: una ausencia planificada no puede llevar incidencia.
      const msg = await debeFallar(
        `UPDATE resident_absences SET incident_id = '${fila.incident_id}'
          WHERE client_id = '${antonioId}'`,
      );
      expect(msg).toMatch(/incidencia_solo_si_no_controlada|RESIDENCIA_VIOLADA/);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  //  7 · LOS DÍAS DEL MES (D-93)
  // ══════════════════════════════════════════════════════════════════

  describe("los días del mes, por la API", () => {
    it("el centro los da por residente y sumados, con su regla", async () => {
      const mes = new Date().toISOString().slice(0, 7);
      const r = await app.inject({
        method: "GET",
        url: `/residencia/dias?mes=${mes}`,
        headers: comoPilar,
      });
      expect(r.statusCode, r.body).toBe(200);
      const d = r.json();
      // La regla de los días frontera va EN LA RESPUESTA: un número de
      // facturación sin su regla al lado es un número que se copia mal.
      expect(d.reglaDeLosDiasFrontera).toBe("PERNOCTA");
      expect(d.residentes.length).toBeGreaterThan(0);
      const suma = d.residentes.reduce(
        (a: number, x: { presencia: number }) => a + x.presencia,
        0,
      );
      expect(d.total.presencia).toBe(suma);
      // Antonio estuvo tres días fuera: tiene noches de hospital.
      const antonio = d.residentes.find(
        (x: { clientId: string }) => x.clientId === antonioId,
      );
      expect(antonio.hospital).toBeGreaterThan(0);
      expect(
        antonio.ordinarios + antonio.hospital + antonio.vacaciones + antonio.otros,
      ).toBe(antonio.presencia);
    });

    it("y el de UN residente pasa por el registro de accesos", async () => {
      const antes = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
        `SELECT count(*) AS n FROM clinical_access_log
          WHERE tenant_id = '${tenantId}' AND client_id = '${antonioId}'`,
      );
      const r = await app.inject({
        method: "GET",
        url: `/residencia/residentes/${antonioId}/dias?mes=${new Date()
          .toISOString()
          .slice(0, 7)}`,
        headers: comoPilar,
      });
      expect(r.statusCode, r.body).toBe(200);
      const despues = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
        `SELECT count(*) AS n FROM clinical_access_log
          WHERE tenant_id = '${tenantId}' AND client_id = '${antonioId}'`,
      );
      expect(Number(primera(despues).n)).toBeGreaterThan(
        Number(primera(antes).n),
      );
    });
  });

  // ══════════════════════════════════════════════════════════════════
  //  8 · EL INGRESO GUIADO (D-94)
  // ══════════════════════════════════════════════════════════════════

  describe("el checklist da por cumplido lo que ya existe", () => {
    it("Carmen tiene su lista desde el alta, con los doce elementos", async () => {
      const r = await app.inject({
        method: "GET",
        url: `/residencia/residentes/${carmenId}/ingreso`,
        headers: comoPilar,
      });
      expect(r.statusCode, r.body).toBe(200);
      const i = r.json().ingreso;
      expect(i.elementos).toHaveLength(12);
    });

    it("**la cama, la dieta y las alergias salen HECHAS sin que nadie las marque**", async () => {
      const r = await app.inject({
        method: "GET",
        url: `/residencia/residentes/${carmenId}/ingreso`,
        headers: comoPilar,
      });
      const por = (code: string) =>
        r.json().ingreso.elementos.find((e: { code: string }) => e.code === code);
      // Carmen tiene cama (se la dio el alta), dieta (la escribimos arriba)
      // y plan (la plantilla del nivel).
      expect(por("CAMA").hecho).toBe(true);
      expect(por("CAMA").porque).toContain("cama asignada");
      expect(por("DIETA").hecho).toBe(true);
      expect(por("PLAN_CUIDADOS").hecho).toBe(true);
      // Y las alergias de Carmen NO están revisadas —tiene filas, pero
      // nadie ha firmado la revisión—, y el motivo lo dice con la frase de
      // D-90.
      expect(por("ALERGIAS").hecho).toBe(false);
      expect(por("ALERGIAS").porque).toContain("no es lo mismo");
    });

    it("y lo `auto` NO se puede marcar a mano", async () => {
      const r = await post(
        `/residencia/residentes/${carmenId}/ingreso/CAMA/hecho`,
        {},
        comoPilar,
      );
      expect(r.statusCode, r.body).toBe(409);
      expect(r.json().error).toBe("ELEMENTO_AUTOMATICO");
      // El CHECK lo pararía igual; esto es para que el mensaje lo entienda
      // alguien.
      const msg = await debeFallar(
        `UPDATE admission_checklist_items
            SET done_at = now(), done_by_user_id = '${pilarId}',
                done_by_care_role_assignment_id =
                  (SELECT id FROM care_role_assignments WHERE user_id = '${pilarId}' LIMIT 1)
          WHERE client_id = '${carmenId}' AND code = 'CAMA'`,
      );
      expect(msg).toContain("admission_checklist_items_hecho_completo");
    });

    it("lo de MARCAR a mano se marca, con firma y nota", async () => {
      const r = await post(
        `/residencia/residentes/${carmenId}/ingreso/CONTRATO/hecho`,
        { nota: "lo trae firmado la hija el lunes" },
        comoPilar,
      );
      expect(r.statusCode, r.body).toBe(200);
      const v = await app.inject({
        method: "GET",
        url: `/residencia/residentes/${carmenId}/ingreso`,
        headers: comoPilar,
      });
      const contrato = v
        .json()
        .ingreso.elementos.find((e: { code: string }) => e.code === "CONTRATO");
      expect(contrato.hecho).toBe(true);
      expect(contrato.hechoComo).toBeTruthy();
      expect(contrato.nota).toContain("hija");
    });

    it("los dos con PLAZO lo tienen, y el del PAI es el del centro", async () => {
      const r = await app.inject({
        method: "GET",
        url: `/residencia/residentes/${carmenId}/ingreso`,
        headers: comoPilar,
      });
      const por = (code: string) =>
        r.json().ingreso.elementos.find((e: { code: string }) => e.code === code);
      // Ingresó el 2026-09-01 y el plazo de serie es 30 días.
      expect(por("PAI_INICIAL").dueOn).toBe("2026-10-01");
      expect(por("ESCALAS_INICIALES").dueOn).toBe("2026-10-01");
      // Y el resto no vence: un contrato no caduca, falta.
      expect(por("CAMA").dueOn).toBeNull();
    });

    it("el plazo del centro se configura, y NO mueve lo ya escrito", async () => {
      const r = await app.inject({
        method: "PUT",
        url: "/residencia/ingresos/plazos",
        headers: comoPilar,
        payload: { diasDePai: 45, diasParaComunicarLaBaja: 10 },
      });
      expect(r.statusCode, r.body).toBe(200);
      const v = await app.inject({
        method: "GET",
        url: `/residencia/residentes/${carmenId}/ingreso`,
        headers: comoPilar,
      });
      const pai = v
        .json()
        .ingreso.elementos.find((e: { code: string }) => e.code === "PAI_INICIAL");
      // **Sigue siendo el 1 de octubre.** El plazo de quien ya ingresó es
      // el que había cuando ingresó: es lo que un inspector compara con su
      // fecha de ingreso.
      expect(pai.dueOn).toBe("2026-10-01");
    });
  });

  // ══════════════════════════════════════════════════════════════════
  //  9 · EL ALTA, COMPLETA (D-96)
  // ══════════════════════════════════════════════════════════════════

  describe("el alta cierra plan, cama y ausencia, y no borra nada", () => {
    it("exige la CLASE: un alta sin clasificar no entra", async () => {
      const r = await post(
        `/residencia/residentes/${luisId}/alta`,
        { dischargeDate: new Date().toISOString().slice(0, 10) },
        comoPilar,
      );
      expect(r.statusCode, r.body).toBe(400);
    });

    it("cierra las cuatro cosas en la misma transacción", async () => {
      // Luis tiene una ausencia ABIERTA (la salida no controlada), plan y
      // cama: es el caso que lo prueba todo de una vez.
      const abiertaAntes = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
        `SELECT count(*) AS n FROM resident_absences
          WHERE client_id = '${luisId}' AND ended_at IS NULL`,
      );
      expect(Number(primera(abiertaAntes).n)).toBe(1);

      const hoy = new Date().toISOString().slice(0, 10);
      const r = await post(
        `/residencia/residentes/${luisId}/alta`,
        {
          dischargeDate: hoy,
          dischargeKind: "TRASLADO",
          dischargeReason: "traslado a la residencia de Talavera",
        },
        comoPilar,
      );
      expect(r.statusCode, r.body).toBe(200);

      const [cama, plan, ausencia] = await Promise.all([
        prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
          `SELECT count(*) AS n FROM bed_assignments WHERE client_id = '${luisId}' AND to_at IS NULL`,
        ),
        prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
          `SELECT count(*) AS n FROM care_plan_items WHERE client_id = '${luisId}' AND to_at IS NULL`,
        ),
        prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
          `SELECT count(*) AS n FROM resident_absences WHERE client_id = '${luisId}' AND ended_at IS NULL`,
        ),
      ]);
      expect(Number(primera(cama).n), "la cama sigue ocupada").toBe(0);
      expect(Number(primera(plan).n), "el plan sigue vivo").toBe(0);
      // **La ausencia**: sin esto, Luis se queda ausente para siempre y la
      // pantalla de ausencias no lo lista porque sólo enseña a los que
      // viven aquí.
      expect(Number(primera(ausencia).n), "la ausencia sigue abierta").toBe(0);
    });

    it("**y NO BORRA NADA**: la historia se conserva (Ley 41/2002)", async () => {
      const filas = await prisma.$queryRawUnsafe<
        Array<{ ausencias: bigint; revisiones: bigint; checklist: bigint }>
      >(
        `SELECT
           (SELECT count(*) FROM resident_absences WHERE client_id = '${luisId}') AS ausencias,
           (SELECT count(*) FROM allergy_reviews WHERE client_id = '${luisId}') AS revisiones,
           (SELECT count(*) FROM admission_checklist_items WHERE client_id = '${luisId}') AS checklist`,
      );
      const f = primera(filas);
      expect(Number(f.ausencias)).toBeGreaterThan(0);
      expect(Number(f.revisiones)).toBeGreaterThan(0);
      expect(Number(f.checklist)).toBe(12);
    });

    it("y la ausencia cerrada por el alta **no deja revisión pendiente**", async () => {
      // La DUE no tiene que revisar la medicación de alguien que ya no
      // vive aquí. Es la diferencia entre `cerrarAusencia` y
      // `cerrarAusenciaPorAlta`.
      const filas = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
        `SELECT count(*) AS n FROM resident_absences
          WHERE client_id = '${luisId}' AND review_required = true AND reviewed_at IS NULL`,
      );
      expect(Number(primera(filas).n)).toBe(0);
    });

    it("una plaza PRIVADA no crea obligación de comunicar la baja", async () => {
      const filas = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
        `SELECT count(*) AS n FROM management_duties
          WHERE tenant_id = '${tenantId}' AND name LIKE '%Luis%'`,
      );
      expect(Number(primera(filas).n)).toBe(0);
    });

    it("y una CONCERTADA sí, con su fecha y su ocurrencia", async () => {
      const hoy = new Date().toISOString().slice(0, 10);
      const r = await post(
        `/residencia/residentes/${antonioId}/alta`,
        { dischargeDate: hoy, dischargeKind: "FALLECIMIENTO" },
        comoPilar,
      );
      expect(r.statusCode, r.body).toBe(200);
      const duty = primera(
        await prisma.$queryRawUnsafe<
          Array<{
            id: string;
            periodicity: string;
            valid_until: string;
            consequence: string;
            periodicity_to_verify: boolean;
          }>
        >(
          `SELECT id, periodicity, valid_until, consequence, periodicity_to_verify
             FROM management_duties
            WHERE tenant_id = '${tenantId}' AND name LIKE '%Antonio%'`,
        ),
        "la obligación de la baja",
      );
      expect(duty.periodicity).toBe("VALIDITY");
      expect(duty.consequence).toBe("LEGAL");
      // El plazo del centro son 10 días (lo pusimos arriba), así que la
      // fecha NO es la del alta y la periodicidad NO está «por verificar».
      expect(duty.periodicity_to_verify).toBe(false);
      expect(duty.valid_until).not.toBe(hoy);
      const ocurrencias = await prisma.$queryRawUnsafe<Array<{ due_on: string }>>(
        `SELECT due_on FROM duty_occurrences WHERE duty_id = '${duty.id}'`,
      );
      // Y su ocurrencia existe YA, no cuando la pasada la alcance: el día
      // del alta es el día en que a alguien se le tiene que decir.
      expect(ocurrencias).toHaveLength(1);
      expect(primera(ocurrencias).due_on).toBe(duty.valid_until);
    });

    it("a un residente dado de alta no se le apuntan ausencias", async () => {
      const r = await post(
        `/residencia/residentes/${luisId}/ausencias`,
        { tipo: "VACACIONES_FAMILIA", desde: new Date().toISOString() },
        comoAna,
      );
      expect(r.statusCode, r.body).toBe(409);
      expect(r.json().error).toBe("RESIDENTE_DADO_DE_ALTA");
    });
  });

  // ══════════════════════════════════════════════════════════════════
  //  10 · **LA TABLA DE SABOTAJES CONTRA EL MOTOR**
  // ══════════════════════════════════════════════════════════════════

  describe("la tabla de sabotajes", () => {
    it("`UPDATE` de una alergia por SQL → lo para el trigger", async () => {
      // **El sabotaje número uno del bloque.** Un `UPDATE` dejaría una
      // historia que dice que siempre fue penicilina, y quien prescribe no
      // vería que alguien se equivocó.
      const msg = await debeFallar(
        `UPDATE allergies SET agent_cifrado = 'c1:AAAA'
          WHERE client_id = '${carmenId}'`,
      );
      expect(msg).toContain("RESIDENCIA_VIOLADA");
      expect(msg).toContain("no se edita");
    });

    it("`DELETE` de una alergia → tampoco", async () => {
      const msg = await debeFallar(
        `DELETE FROM allergies WHERE client_id = '${carmenId}'`,
      );
      expect(msg).toContain("no se borra");
    });

    it("**borrar una ausencia → son días de la factura de la Junta**", async () => {
      const msg = await debeFallar(
        `DELETE FROM resident_absences WHERE client_id = '${antonioId}'`,
      );
      expect(msg).toContain("RESIDENCIA_VIOLADA");
      expect(msg).toContain("factura");
    });

    it("cambiar el TIPO de una ausencia → tampoco", async () => {
      // Convertir un ingreso hospitalario en unas vacaciones cambia tres
      // días de la factura y no deja rastro.
      const msg = await debeFallar(
        `UPDATE resident_absences SET kind = 'VACACIONES_FAMILIA'
          WHERE client_id = '${antonioId}'`,
      );
      expect(msg).toContain("no se cambian el tipo");
    });

    it("mover una fecha de una ausencia SIN la corrección firmada → tampoco", async () => {
      const msg = await debeFallar(
        `UPDATE resident_absences SET started_at = started_at - interval '2 days'
          WHERE client_id = '${antonioId}'`,
      );
      expect(msg).toContain("sólo se corrigen con quién y por qué");
    });

    it("y CON la corrección firmada, pasa", async () => {
      const id = primera(
        await prisma.$queryRawUnsafe<Array<{ id: string }>>(
          `SELECT id FROM resident_absences WHERE client_id = '${antonioId}' LIMIT 1`,
        ),
        "la ausencia",
      ).id;
      await prisma.$executeRawUnsafe(
        `UPDATE resident_absences
            SET started_at = started_at - interval '1 hour',
                corrected_at = now(),
                corrected_by_user_id = '${rosaId}',
                correction_reason = 'la ambulancia llegó una hora antes'
          WHERE id = '${id}'`,
      );
      const f = primera(
        await prisma.$queryRawUnsafe<Array<{ correction_reason: string }>>(
          `SELECT correction_reason FROM resident_absences WHERE id = '${id}'`,
        ),
      );
      expect(f.correction_reason).toContain("ambulancia");
    });

    it("una versión de dieta jubilada no vuelve a vigente", async () => {
      const msg = await debeFallar(
        `UPDATE diet_profiles SET texture = 'NORMAL' WHERE client_id = '${carmenId}'`,
      );
      expect(msg).toContain("no se edita");
    });

    it("dos dietas vigentes del mismo residente → lo para el índice parcial", async () => {
      const msg = await debeFallar(
        `INSERT INTO diet_profiles (id, tenant_id, client_id, version, texture,
            created_by_user_id, created_by_care_role_assignment_id)
         SELECT gen_random_uuid(), '${tenantId}', '${carmenId}', 99, 'NORMAL',
                '${rosaId}', id FROM care_role_assignments
          WHERE user_id = '${rosaId}' LIMIT 1`,
      );
      // **Por el SQLSTATE y por la CLAVE, no por el nombre del índice**:
      // Prisma envuelve los errores de una consulta cruda y reenvía el
      // `DETAIL` sin el nombre de la restricción. `23505` es
      // «unique_violation», y la clave `(client_id)` identifica el índice
      // sin ambigüedad — es el único único de esta tabla cuya clave es
      // sólo el residente (`diet_profiles_una_viva_key`); el otro lleva la
      // versión dentro, y la 99 no choca con nada.
      expect(msg).toContain("23505");
      expect(msg).toContain("(client_id)");
    });

    it("una alerta sin su frase → lo para el CHECK", async () => {
      const msg = await debeFallar(
        `INSERT INTO resident_diagnoses (id, tenant_id, client_id, text_cifrado,
            diagnosed_on, alert_flag, created_by_user_id, created_by_care_role_assignment_id)
         SELECT gen_random_uuid(), '${tenantId}', '${carmenId}', 'c1:AAAA',
                CURRENT_DATE, true, '${rosaId}', id FROM care_role_assignments
          WHERE user_id = '${rosaId}' LIMIT 1`,
      );
      expect(msg).toContain("resident_diagnoses_alerta_completa");
    });

    it("el CLARO no cabe en una columna cifrada", async () => {
      const msg = await debeFallar(
        `INSERT INTO allergies (id, tenant_id, client_id, class, severity,
            agent_cifrado, created_by_user_id, created_by_care_role_assignment_id)
         SELECT gen_random_uuid(), '${tenantId}', '${carmenId}', 'OTRA', 'LEVE',
                'penicilina', '${rosaId}', id FROM care_role_assignments
          WHERE user_id = '${rosaId}' LIMIT 1`,
      );
      expect(msg).toContain("allergies_agent_cifrado_formato");
    });

    it("una revisión de alergias no se edita ni se borra", async () => {
      const msg = await debeFallar(
        `UPDATE allergy_reviews SET none_known = false WHERE client_id = '${luisId}'`,
      );
      expect(msg).toContain("no se edita ni se borra");
    });

    it("**una regla de gravedad DE CENTRO → no se puede** (D-21, D-65)", async () => {
      // La plantilla la fija Mi Piace y un centro no la toca. Lo que
      // residencia-4 cerró sigue cerrado con la versión 2 dentro: este
      // bloque añade una fila a la plantilla de SERIE, no abre la puerta a
      // reglas por centro.
      const msg = await debeFallar(
        `INSERT INTO severity_rules (id, scope, tenant_id, version, kind,
            event_type, severity, incident_type, valid_from)
         VALUES (gen_random_uuid(), 'CENTER', '${tenantId}', 1, 'EVENT',
                 'SALIDA_NO_CONTROLADA', 'N1', 'SALIDA_NO_CONTROLADA', now())`,
      );
      expect(msg).toBeTruthy();
    });

    it("y **leer la ficha sin pasar por el registro de accesos no se puede**", async () => {
      // No hay ruta que lea la ficha clínica sin `conHistoria`: la prueba
      // es que CADA lectura deja su línea. Si mañana alguien escribe una
      // ruta nueva sin el envoltorio, este recuento deja de subir.
      const antes = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
        `SELECT count(*) AS n FROM clinical_access_log
          WHERE tenant_id = '${tenantId}' AND client_id = '${carmenId}'`,
      );
      await leerFicha(carmenId);
      await app.inject({
        method: "GET",
        url: `/residencia/residentes/${carmenId}/ausencias`,
        headers: comoPilar,
      });
      await app.inject({
        method: "GET",
        url: `/residencia/residentes/${carmenId}/ingreso`,
        headers: comoPilar,
      });
      const despues = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
        `SELECT count(*) AS n FROM clinical_access_log
          WHERE tenant_id = '${tenantId}' AND client_id = '${carmenId}'`,
      );
      expect(Number(primera(despues).n)).toBe(Number(primera(antes).n) + 3);
    });

    it("y en el registro de accesos NO hay ni un dato de salud", async () => {
      const lineas = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
        `SELECT * FROM clinical_access_log WHERE tenant_id = '${tenantId}'`,
      );
      const todo = JSON.stringify(lineas);
      for (const prohibido of ["penicilina", "Parkinson", "sonda", "neumonía"]) {
        expect(todo, `«${prohibido}» está en el registro de accesos`).not.toContain(
          prohibido,
        );
      }
    });
  });
});
