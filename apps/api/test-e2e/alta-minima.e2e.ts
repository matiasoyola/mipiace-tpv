// alta-minima · **EL RESIDENTE EXISTE AUNQUE FALTEN DATOS**, contra
// Postgres de verdad.
//
// Por qué tiene que ser e2e: lo que se prueba aquí lo contesta el motor o
// no lo contesta nadie.
//
//   · que las tres columnas **aceptan NULL** de verdad (el `schema.prisma`
//     lo dice, la base lo cumple o no);
//   · que `resident_profiles_alta_coherente` sigue exigiendo que la fecha
//     de alta no sea anterior a la de ingreso CUANDO las dos están, y que
//     **deja pasar** la de alta sin ingreso — las dos mitades del CHECK
//     que esta migración reescribió;
//   · que el alta rápida de 43 con repetidos crea 40 y que **repetir el
//     lote no duplica a nadie**, que es idempotencia de verdad y no un
//     `if` en el handler;
//   · que un residente sin nivel ni fecha **aparece en la puerta**, se le
//     registra «como siempre» y «algo no va bien», sale en el parte sin
//     ruido y la exportación del art. 28.3.g no se rompe;
//   · y los sabotajes del bloque: `dependencyLevel` inválido, 2.000
//     líneas, líneas vacías y tabuladores sueltos, y quitar el nombre.

import { createHash, randomBytes, randomUUID } from "node:crypto";

import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { E2E_DATABASE_URL, e2eEnabled, SKIP_MESSAGE } from "./e2e-env.js";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL =
  E2E_DATABASE_URL || "postgresql://e2e:e2e@127.0.0.1:5432/e2e";
process.env.REDIS_URL = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";
process.env.JWT_ACCESS_SECRET = "g".repeat(40);
process.env.JWT_REFRESH_SECRET = "h".repeat(40);
process.env.HOLDED_KEY_ENCRYPTION_SECRET = randomBytes(32).toString("base64");

// ── Redis, en memoria · POR QUÉ ──────────────────────────────────────
//
// El bloque 9 entra por la puerta con un PIN, y el rate-limit del PIN
// habla con Redis. **El job `e2e` de CI sólo levanta Postgres**, y el
// cliente de `context.ts` va con `maxRetriesPerRequest: null` —lo exige
// BullMQ para reconectar limpio—, así que sin Redis el primer `inspect`
// del PIN no falla: **espera para siempre**. En el portátil no se ve,
// porque hay un Redis de dev escuchando.
//
// Se sustituye el TRANSPORTE, no el limitador: la ruta y `rate-limit.ts`
// siguen siendo los de verdad. Es la misma decisión, el mismo doble y
// por la misma razón que `residencia-3.e2e.ts` — ver su cabecera, que
// lleva además lo que costó medirlo (48 minutos de job).
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
const { sembrarResidencia } = await import("../src/residencia/semilla.js");
const { registerResidenciaResidentesRoutes } = await import(
  "../src/residencia/residentes-routes.js"
);
const { registerResidenciaPlanRoutes } = await import(
  "../src/residencia/plan-routes.js"
);
const { registerResidenciaPanelRoutes } = await import(
  "../src/residencia/panel-routes.js"
);
const { registerResidenciaObligacionesRoutes } = await import(
  "../src/residencia/obligaciones-routes.js"
);
// Para el bloque 9: la puerta de la habitación y el parte de relevo. Un
// residente incompleto se atiende IGUAL, y eso se ve aquí o no se ve.
const { registerResidenciaPuertaRoutes } = await import(
  "../src/residencia/puerta-routes.js"
);
const { registerResidenciaPuertaRegistroRoutes } = await import(
  "../src/residencia/puerta-registro-routes.js"
);
// El PIN de la puerta se pone por su ruta de verdad, que vive aquí.
const { registerResidenciaFichaRoutes } = await import(
  "../src/residencia/ficha-routes.js"
);
const { signAccessToken } = await import("../src/auth/tokens.js");
const { olvidarClaves } = await import("../src/clinica/claves.js");
const { olvidarEstado } = await import("../src/clinica/contrato.js");
const { parteDeResidencia } = await import("../src/residencia/exportacion.js");

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

describe.skipIf(!e2eEnabled)("e2e · alta-minima", () => {
  if (!e2eEnabled) console.warn(`\n${SKIP_MESSAGE}\n`);

  const prisma = getPrisma();
  let app: FastifyInstance;
  let tenantId = "";
  let directoraId = "";
  let plantaId = "";
  let habId = "";
  let camaId = "";
  /** La segunda cama: una cama sólo admite UN residente vivo (el índice
   *  parcial `bed_assignments_one_live_per_bed_key`), así que los dos
   *  bloques que asignan cama necesitan una cada uno. */
  let otraCamaId = "";
  let auxiliarId = "";
  let tokenDeLaTablet = "";
  let comoDirectora: Record<string, string> = {};
  /** El PIN de la auxiliar. Cuatro cifras: su rol es por zona (D-68). */
  const PIN_DE_ANA = "7391";

  beforeAll(async () => {
    await cargarCatalogoDeSerie();

    tenantId = randomUUID();
    directoraId = randomUUID();

    await prisma.$executeRawUnsafe(
      `INSERT INTO tenants (id, name, residencia_enabled, clinical_records_enabled, crm_enabled, agenda_enabled, caja_enabled, updated_at)
       VALUES ('${tenantId}', 'Jardín de Gredos (e2e)', true, true, true, true, false, now())`,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO users (id, tenant_id, email, alias, role, is_clinician, clinical_scope)
       VALUES ('${directoraId}', '${tenantId}', 'dir-${directoraId.slice(0, 8)}@gredos.es', 'Pilar', 'OWNER', true, 'SELECTION')`,
    );
    await sembrarResidencia(prisma as never, tenantId);
    // El rol de DIRECCIÓN, vigente: en una residencia el acceso lo da el
    // rol de cuidado y no `clinicalScope` (D-51).
    await prisma.$executeRawUnsafe(
      `INSERT INTO care_role_assignments (id, tenant_id, user_id, care_role_id, from_at, granted_by_user_id)
       SELECT '${randomUUID()}', '${tenantId}', '${directoraId}', id, now() - interval '1 day', '${directoraId}'
       FROM care_roles WHERE tenant_id = '${tenantId}' AND code = 'DIRECCION'`,
    );
    // clinica-7 · EL CONTRATO DE ENCARGADO, ACEPTADO.
    await prisma.$executeRawUnsafe(
      `INSERT INTO clinical_processor_agreements (id, tenant_id, version, text_sha256, user_id, at)
       VALUES ('${randomUUID()}', '${tenantId}', 1, '${"a".repeat(64)}', '${directoraId}', now())`,
    );
    olvidarEstado();

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

    // ── Para el bloque 9 · UNA AUXILIAR Y LA TABLET DE LA 112 ────
    //
    // Un residente incompleto se atiende IGUAL (decisión 4: la puerta y
    // el relevo no se tocan), y eso se ve con una auxiliar de verdad
    // entrando con su PIN o no se ve.
    auxiliarId = randomUUID();
    // `is_clinician = true` y no `false`, aunque sea auxiliar: en una
    // residencia **quien registra cuidados ES sanitario a efectos de
    // acceso** (D-51), y lo pone así la ruta que asigna el rol de
    // cuidado. Sembrando el rol con SQL en crudo hay que ponerlo a mano.
    //
    // Y cuesta un rato porque el síntoma engaña: `puedeVerHistoria`
    // contesta `NO_SANITARIO` antes de llegar a la rama de la
    // residencia, pero la puerta traduce cualquier negativa a
    // `RESIDENTE_FUERA_DE_TU_ZONA` — o sea que el mensaje manda a pedirle
    // una planta a dirección cuando la planta ya la tiene.
    await prisma.$executeRawUnsafe(
      `INSERT INTO users (id, tenant_id, email, alias, role, is_clinician, clinical_scope)
       VALUES ('${auxiliarId}', '${tenantId}', 'ana-${auxiliarId.slice(0, 8)}@gredos.es', 'Ana', 'CASHIER', true, 'SELECTION')`,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO care_role_assignments (id, tenant_id, user_id, care_role_id, from_at, granted_by_user_id)
       SELECT '${randomUUID()}', '${tenantId}', '${auxiliarId}', id, now() - interval '1 day', '${directoraId}'
       FROM care_roles WHERE tenant_id = '${tenantId}' AND code = 'AUXILIAR'`,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO care_zone_assignments (id, tenant_id, user_id, floor_id, from_at, granted_by_user_id)
       VALUES ('${randomUUID()}', '${tenantId}', '${auxiliarId}', '${plantaId}', now() - interval '1 day', '${directoraId}')`,
    );
    tokenDeLaTablet = randomBytes(24).toString("hex");
    await prisma.$executeRawUnsafe(
      `INSERT INTO devices (id, tenant_id, kind, room_id, register_id, name, device_token_hash)
       VALUES ('${randomUUID()}', '${tenantId}', 'ROOM', '${habId}', NULL, 'Puerta 112',
               '${createHash("sha256").update(tokenDeLaTablet, "utf8").digest("hex")}')`,
    );

    comoDirectora = {
      authorization: `Bearer ${signAccessToken({ sub: directoraId, tid: tenantId, role: "OWNER" })}`,
    };

    app = Fastify({ logger: false });
    await registerResidenciaResidentesRoutes(app);
    await registerResidenciaPlanRoutes(app);
    await registerResidenciaPanelRoutes(app);
    await registerResidenciaObligacionesRoutes(app);
    await registerResidenciaFichaRoutes(app);
    await registerResidenciaPuertaRoutes(app);
    await registerResidenciaPuertaRegistroRoutes(app);
    await app.ready();
  });

  afterAll(async () => {
    await app?.close();
    olvidarClaves();
    olvidarEstado();
    await shutdown();
  });

  // ══════════════════════════════════════════════════════════════════
  //  1 · EL ALTA CON SÓLO EL NOMBRE
  // ══════════════════════════════════════════════════════════════════

  describe("el alta con sólo el nombre", () => {
    it("201, y la base guarda las tres columnas a NULL", async () => {
      const r = await app.inject({
        method: "POST",
        url: "/residencia/residentes",
        headers: comoDirectora,
        payload: { firstName: "Abel Ramos Doblado" },
      });
      expect(r.statusCode, r.body).toBe(201);
      const res = r.json().residente;
      expect(res.admissionDate).toBeNull();
      expect(res.dependencyLevel).toBeNull();
      expect(res.placeType).toBeNull();
      // Y en la base, NULL de verdad: es lo que la migración tenía que
      // conseguir y lo que el `schema.prisma` solo no demuestra.
      const [fila] = await prisma.$queryRawUnsafe<
        Array<{ admission_date: Date | null; dependency_level: string | null; place_type: string | null }>
      >(
        `SELECT admission_date, dependency_level, place_type
         FROM resident_profiles WHERE client_id = '${res.clientId}'`,
      );
      expect(fila!.admission_date).toBeNull();
      expect(fila!.dependency_level).toBeNull();
      expect(fila!.place_type).toBeNull();
    });

    it("SIN NIVEL no se precarga plan · y «Plan de cuidados» entra en lo que falta", async () => {
      const r = await app.inject({
        method: "POST",
        url: "/residencia/residentes",
        headers: comoDirectora,
        payload: { firstName: "Begoña Agüero" },
      });
      const res = r.json().residente;
      const lineas = await prisma.carePlanItem.count({
        where: { tenantId, clientId: res.clientId },
      });
      expect(lineas).toBe(0);
      const faltan = (res.faltan as Array<{ campo: string; peso: string }>);
      const plan = faltan.find((f) => f.campo === "planDeCuidados");
      expect(plan).toEqual({
        campo: "planDeCuidados",
        etiqueta: "plan de cuidados",
        peso: "IMPRESCINDIBLE",
      });
    });

    it("CON nivel sí se precarga, como antes del bloque", async () => {
      const r = await app.inject({
        method: "POST",
        url: "/residencia/residentes",
        headers: comoDirectora,
        payload: {
          firstName: "Carmen",
          lastName: "del Río",
          dependencyLevel: "DEPENDIENTE",
          placeType: "PRIVADA",
          admissionDate: "2026-10-01",
        },
      });
      expect(r.statusCode, r.body).toBe(201);
      const lineas = await prisma.carePlanItem.count({
        where: { tenantId, clientId: r.json().residente.clientId, toAt: null },
      });
      expect(lineas).toBeGreaterThan(0);
    });

    it("SABOTAJE · sin nombre, 400 · el nombre sigue siendo obligatorio", async () => {
      const r = await app.inject({
        method: "POST",
        url: "/residencia/residentes",
        headers: comoDirectora,
        payload: {},
      });
      expect(r.statusCode).toBe(400);
      expect(r.json().error).toBe("FALTA_NOMBRE");
    });

    it("SABOTAJE · un nombre de sólo espacios tampoco vale", async () => {
      const r = await app.inject({
        method: "POST",
        url: "/residencia/residentes",
        headers: comoDirectora,
        payload: { firstName: "   " },
      });
      expect(r.statusCode).toBe(400);
      expect(r.json().error).toBe("FALTA_NOMBRE");
    });

    it("SABOTAJE · `dependencyLevel` inválido es 400, no un residente a medias", async () => {
      const antes = await prisma.residentProfile.count({ where: { tenantId } });
      const r = await app.inject({
        method: "POST",
        url: "/residencia/residentes",
        headers: comoDirectora,
        payload: { firstName: "Nadie", dependencyLevel: "MUY_DEPENDIENTE" },
      });
      expect(r.statusCode, r.body).toBe(400);
      expect(await prisma.residentProfile.count({ where: { tenantId } })).toBe(antes);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  //  2 · EL ALTA RÁPIDA DE VARIOS
  // ══════════════════════════════════════════════════════════════════

  describe("el alta rápida de varios · el listado de Jardín de Gredos", () => {
    /** 43 nombres, con 3 que repiten a otros tres del propio lote. */
    const CUARENTA_Y_TRES = [
      ...Array.from({ length: 40 }, (_, i) => `RESIDENTE NUMERO ${i + 1}`),
      // Los tres repetidos, escritos distinto a propósito: con tilde, en
      // minúscula y con dobles espacios. Si la normalización no fuera la
      // del paquete puro, estos tres se colarían.
      "residente numero 1",
      "RESIDENTE  NUMERO  2",
      "RESIDENTE NUMERO 3",
    ].join("\n");

    let delLote: string[] = [];

    it("43 líneas con 3 repetidos → crea 40 y lista los 3 saltados", async () => {
      const r = await app.inject({
        method: "POST",
        url: "/residencia/residentes/varios",
        headers: comoDirectora,
        payload: { texto: CUARENTA_Y_TRES, placeTypePorDefecto: "CONCERTADA" },
      });
      expect(r.statusCode, r.body).toBe(201);
      const body = r.json();
      expect(body.creados).toBe(40);
      expect(body.saltados).toHaveLength(3);
      // Y los tres se nombran con su número de línea real.
      expect(body.saltados.map((s: { numero: number }) => s.numero)).toEqual([
        41, 42, 43,
      ]);
      delLote = body.residentes.map((x: { clientId: string }) => x.clientId);
      expect(delLote).toHaveLength(40);
    });

    it("nacen con el nombre COMO VINO y los apellidos vacíos", async () => {
      // Decisión 7: separar nombre y apellidos de una línea no es fiable,
      // así que todo va a `firstName` y «apellidos» queda como dato que
      // falta. Y las mayúsculas se guardan tal cual.
      const c = await prisma.client.findUniqueOrThrow({
        where: { id: delLote[0]! },
        select: { firstName: true, lastName: true },
      });
      expect(c.firstName).toBe("RESIDENTE NUMERO 1");
      expect(c.lastName).toBe("");
    });

    it("con el tipo de plaza POR DEFECTO puesto, y nada más", async () => {
      const p = await prisma.residentProfile.findUniqueOrThrow({
        where: { clientId: delLote[0]! },
        select: {
          placeType: true,
          admissionDate: true,
          dependencyLevel: true,
          dniCifrado: true,
        },
      });
      expect(p.placeType).toBe("CONCERTADA");
      expect(p.admissionDate).toBeNull();
      expect(p.dependencyLevel).toBeNull();
      // `cifrarTexto(null, …)` es `null`: no hay ciphertext de la nada.
      expect(p.dniCifrado).toBeNull();
    });

    it("y SIN PLAN · sin nivel no hay plantilla que aplicar", async () => {
      const lineas = await prisma.carePlanItem.count({
        where: { tenantId, clientId: { in: delLote } },
      });
      expect(lineas).toBe(0);
    });

    it("IDEMPOTENTE · repetir el mismo lote crea 0", async () => {
      // Es la garantía de la ruta: quien ve un error de red vuelve a
      // darle, y un segundo intento que duplicara 40 fichas dejaría 40
      // historias partidas en dos. Y un residente NO se borra.
      const antes = await prisma.residentProfile.count({ where: { tenantId } });
      const r = await app.inject({
        method: "POST",
        url: "/residencia/residentes/varios",
        headers: comoDirectora,
        payload: { texto: CUARENTA_Y_TRES },
      });
      expect(r.statusCode, r.body).toBe(201);
      expect(r.json().creados).toBe(0);
      expect(r.json().saltados).toHaveLength(43);
      expect(await prisma.residentProfile.count({ where: { tenantId } })).toBe(antes);
    });

    it("y sigue saltándolo cuando la dirección ya le puso los APELLIDOS", async () => {
      // La clave se calcula sobre el nombre completo: si se calculara
      // sólo sobre `firstName`, el segundo pegado del mismo listado
      // duplicaría a los que ya se habían completado — que son
      // justamente los que la dirección ya ha trabajado.
      await app.inject({
        method: "PATCH",
        url: `/residencia/residentes/${delLote[0]!}`,
        headers: comoDirectora,
        payload: { firstName: "RESIDENTE", lastName: "NUMERO 1" },
      });
      const r = await app.inject({
        method: "POST",
        url: "/residencia/residentes/varios",
        headers: comoDirectora,
        payload: { texto: "RESIDENTE NUMERO 1" },
      });
      expect(r.json().creados).toBe(0);
      expect(r.json().saltados[0].motivo).toContain("ya está dado de alta");
    });

    it("el tipo de plaza POR LÍNEA, detrás de un tabulador", async () => {
      const r = await app.inject({
        method: "POST",
        url: "/residencia/residentes/varios",
        headers: comoDirectora,
        payload: { texto: "POR LINEA UNO\tTEMPORAL\nPOR LINEA DOS\tprivada" },
      });
      expect(r.json().creados).toBe(2);
      const plazas = await prisma.residentProfile.findMany({
        where: { tenantId, client: { firstName: { startsWith: "POR LINEA" } } },
        select: { placeType: true, client: { select: { firstName: true } } },
        orderBy: { client: { firstName: "asc" } },
      });
      // Ordenado por nombre: «DOS» va antes que «UNO».
      expect(plazas.map((p) => [p.client.firstName, p.placeType])).toEqual([
        ["POR LINEA DOS", "PRIVADA"],
        ["POR LINEA UNO", "TEMPORAL"],
      ]);
    });

    it("SABOTAJE · líneas vacías y tabuladores sueltos", async () => {
      const r = await app.inject({
        method: "POST",
        url: "/residencia/residentes/varios",
        headers: comoDirectora,
        payload: {
          texto: "\n\nSABOTAJE VACIAS UNO\n\n   \n\tCONCERTADA\n\t\t\nSABOTAJE VACIAS DOS\n\n",
        },
      });
      expect(r.statusCode, r.body).toBe(201);
      expect(r.json().creados).toBe(2);
      // La del tabulador con plaza y sin nombre, delatada con SU número
      // de línea (la 6, contando las vacías). Las vacías, en silencio.
      expect(r.json().saltados).toHaveLength(1);
      expect(r.json().saltados[0].numero).toBe(6);
      expect(r.json().saltados[0].motivo).toContain("no trae nombre");
    });

    it("SABOTAJE · una plaza que no existe NO tumba la línea: avisa", async () => {
      const r = await app.inject({
        method: "POST",
        url: "/residencia/residentes/varios",
        headers: comoDirectora,
        payload: { texto: "SABOTAJE PLAZA MALA\tSUBVENCIONADA" },
      });
      expect(r.json().creados).toBe(1);
      expect(r.json().avisos[0]).toContain("no es un tipo de plaza");
      const p = await prisma.residentProfile.findFirst({
        where: { tenantId, client: { firstName: "SABOTAJE PLAZA MALA" } },
        select: { placeType: true },
      });
      expect(p!.placeType).toBeNull();
    });

    it("SABOTAJE · 2.000 líneas: 400 con su mensaje, y no se crea nadie", async () => {
      const antes = await prisma.residentProfile.count({ where: { tenantId } });
      const dosMil = Array.from({ length: 2000 }, (_, i) => `MASIVO ${i}`).join("\n");
      const r = await app.inject({
        method: "POST",
        url: "/residencia/residentes/varios",
        headers: comoDirectora,
        payload: { texto: dosMil },
      });
      expect(r.statusCode, r.body).toBe(400);
      expect(r.json().error).toBe("DEMASIADAS_LINEAS");
      expect(r.json().message).toContain("300");
      expect(r.json().message).toContain("no se duplican");
      expect(await prisma.residentProfile.count({ where: { tenantId } })).toBe(antes);
    });

    it("SABOTAJE · pegar nada es 400, no un 201 que no hizo nada", async () => {
      const r = await app.inject({
        method: "POST",
        url: "/residencia/residentes/varios",
        headers: comoDirectora,
        payload: { texto: "\n\n   \n" },
      });
      expect(r.statusCode).toBe(400);
      expect(r.json().error).toBe("NADA_QUE_CREAR");
    });
  });

  // ══════════════════════════════════════════════════════════════════
  //  3 · SIN CONTRATO, NADIE · TAMPOCO EN LOTE
  // ══════════════════════════════════════════════════════════════════

  describe("el contrato de encargado · el 423 de siempre", () => {
    it("revocado: ni el alta de uno ni la de varios", async () => {
      const antes = await prisma.residentProfile.count({ where: { tenantId } });
      // Se REVOCA insertando una fila, que es como se retira desde
      // clinica-7 §2: nadie pone un booleano a `false`.
      await prisma.$executeRawUnsafe(
        `INSERT INTO clinical_processor_agreements (id, tenant_id, version, text_sha256, user_id, at, revokes_agreement_id)
         SELECT '${randomUUID()}', '${tenantId}', 1, '${"b".repeat(64)}', '${directoraId}', now(), id
         FROM clinical_processor_agreements
         WHERE tenant_id = '${tenantId}' AND revokes_agreement_id IS NULL
         LIMIT 1`,
      );
      olvidarEstado();

      const uno = await app.inject({
        method: "POST",
        url: "/residencia/residentes",
        headers: comoDirectora,
        payload: { firstName: "SIN CONTRATO UNO" },
      });
      expect(uno.statusCode, uno.body).toBe(423);

      const varios = await app.inject({
        method: "POST",
        url: "/residencia/residentes/varios",
        headers: comoDirectora,
        payload: { texto: "SIN CONTRATO DOS\nSIN CONTRATO TRES" },
      });
      expect(varios.statusCode, varios.body).toBe(423);

      expect(await prisma.residentProfile.count({ where: { tenantId } })).toBe(antes);

      // Y se vuelve a aceptar, que es como sigue el resto del fichero.
      await prisma.$executeRawUnsafe(
        `INSERT INTO clinical_processor_agreements (id, tenant_id, version, text_sha256, user_id, at)
         VALUES ('${randomUUID()}', '${tenantId}', 1, '${"c".repeat(64)}', '${directoraId}', now())`,
      );
      olvidarEstado();
      const otra = await app.inject({
        method: "POST",
        url: "/residencia/residentes",
        headers: comoDirectora,
        payload: { firstName: "CON CONTRATO OTRA VEZ" },
      });
      expect(otra.statusCode, otra.body).toBe(201);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  //  4 · EL CHECK QUE LA MIGRACIÓN REESCRIBIÓ
  // ══════════════════════════════════════════════════════════════════

  describe("`resident_profiles_alta_coherente`, con las dos mitades", () => {
    it("CON las dos fechas, el alta anterior al ingreso la RECHAZA EL MOTOR", async () => {
      const r = await app.inject({
        method: "POST",
        url: "/residencia/residentes",
        headers: comoDirectora,
        payload: { firstName: "CHECK CON INGRESO", admissionDate: "2026-06-01" },
      });
      const clientId = r.json().residente.clientId;
      // Por la ruta da 400 (lo comprueba el handler). Lo que interesa es
      // que el MOTOR también lo impide, que es lo que sigue en pie el día
      // que alguien escriba otra ruta.
      const error = await debeFallar(
        `UPDATE resident_profiles SET discharge_date = '2026-05-31'
         WHERE client_id = '${clientId}'`,
      );
      expect(error).toContain("resident_profiles_alta_coherente");
    });

    it("y la ruta lo dice antes, con su 400", async () => {
      const r = await app.inject({
        method: "POST",
        url: "/residencia/residentes",
        headers: comoDirectora,
        payload: { firstName: "CHECK RUTA", admissionDate: "2026-06-01" },
      });
      const alta = await app.inject({
        method: "POST",
        url: `/residencia/residentes/${r.json().residente.clientId}/alta`,
        headers: comoDirectora,
        payload: { dischargeDate: "2026-05-31" },
      });
      expect(alta.statusCode, alta.body).toBe(400);
      expect(alta.json().error).toBe("ALTA_ANTES_DEL_INGRESO");
    });

    it("SIN fecha de ingreso, el alta PASA · ya estaba aquí cuando llegó el programa", async () => {
      const r = await app.inject({
        method: "POST",
        url: "/residencia/residentes",
        headers: comoDirectora,
        payload: { firstName: "CHECK SIN INGRESO" },
      });
      const alta = await app.inject({
        method: "POST",
        url: `/residencia/residentes/${r.json().residente.clientId}/alta`,
        headers: comoDirectora,
        payload: { dischargeDate: "2020-01-01" },
      });
      expect(alta.statusCode, alta.body).toBe(200);
      expect(alta.json().residente.dischargeDate).toBe("2020-01-01");
    });

    it("la mitad de residencia-1b sigue en pie · motivo cifrado exige fecha", async () => {
      const r = await app.inject({
        method: "POST",
        url: "/residencia/residentes",
        headers: comoDirectora,
        payload: { firstName: "CHECK MOTIVO CIFRADO" },
      });
      const error = await debeFallar(
        `UPDATE resident_profiles SET discharge_reason_cifrado = 'c1:x'
         WHERE client_id = '${r.json().residente.clientId}'`,
      );
      expect(error).toContain("resident_profiles");
    });
  });

  // ══════════════════════════════════════════════════════════════════
  //  5 · PONER EL NIVEL, Y CARGAR EL PLAN CON UN TOQUE
  // ══════════════════════════════════════════════════════════════════

  describe("al poner el nivel por primera vez", () => {
    let clientId = "";

    beforeAll(async () => {
      const r = await app.inject({
        method: "POST",
        url: "/residencia/residentes",
        headers: comoDirectora,
        payload: { firstName: "NIVEL", lastName: "POR PRIMERA VEZ" },
      });
      clientId = r.json().residente.clientId;
    });

    it("el PATCH NO abre el plan solo, y lo OFRECE", async () => {
      const r = await app.inject({
        method: "PATCH",
        url: `/residencia/residentes/${clientId}`,
        headers: comoDirectora,
        payload: { dependencyLevel: "DEPENDIENTE" },
      });
      expect(r.statusCode, r.body).toBe(200);
      expect(r.json().puedeCargarPlan).toEqual({ nivel: "DEPENDIENTE" });
      // Y nada escrito: abrirle veinte líneas de plan como efecto de
      // teclear un dato administrativo es una escritura que nadie pidió,
      // y las líneas se cierran, no se borran.
      expect(r.json().plan).toBeNull();
      expect(
        await prisma.carePlanItem.count({ where: { tenantId, clientId } }),
      ).toBe(0);
    });

    it("y el botón lo carga · un toque", async () => {
      const r = await app.inject({
        method: "POST",
        url: `/residencia/residentes/${clientId}/plan/plantilla`,
        headers: comoDirectora,
      });
      expect(r.statusCode, r.body).toBe(200);
      expect(r.json().plan.abiertas.length).toBeGreaterThan(0);
      expect(r.json().plan.cerradas).toEqual([]);
    });

    it("IDEMPOTENTE · dos veces no duplica el plan", async () => {
      const antes = await prisma.carePlanItem.count({ where: { tenantId, clientId } });
      const r = await app.inject({
        method: "POST",
        url: `/residencia/residentes/${clientId}/plan/plantilla`,
        headers: comoDirectora,
      });
      expect(r.statusCode, r.body).toBe(200);
      expect(r.json().plan.abiertas).toEqual([]);
      expect(await prisma.carePlanItem.count({ where: { tenantId, clientId } })).toBe(
        antes,
      );
    });

    it("y entonces «Plan de cuidados» YA NO FALTA", async () => {
      const r = await app.inject({
        method: "GET",
        url: `/residencia/residentes/${clientId}`,
        headers: comoDirectora,
      });
      const campos = (r.json().residente.faltan as Array<{ campo: string }>).map(
        (f) => f.campo,
      );
      expect(campos).not.toContain("planDeCuidados");
      // Pero sí los demás: la ficha sigue incompleta y lo sigue diciendo.
      expect(campos).toContain("fechaDeIngreso");
      expect(campos).toContain("dni");
    });

    it("SIN nivel, cargar el plan es 409 y manda a poner el nivel", async () => {
      const otro = await app.inject({
        method: "POST",
        url: "/residencia/residentes",
        headers: comoDirectora,
        payload: { firstName: "SIN NIVEL PARA EL PLAN" },
      });
      const r = await app.inject({
        method: "POST",
        url: `/residencia/residentes/${otro.json().residente.clientId}/plan/plantilla`,
        headers: comoDirectora,
      });
      expect(r.statusCode, r.body).toBe(409);
      expect(r.json().error).toBe("SIN_NIVEL_DE_DEPENDENCIA");
    });
  });

  // ══════════════════════════════════════════════════════════════════
  //  6 · COMPLETAR LA FICHA, Y LOS APELLIDOS QUE VIVEN EN `clients`
  // ══════════════════════════════════════════════════════════════════

  describe("completar la ficha", () => {
    it("el PATCH escribe el `Client` y el perfil en la misma pasada", async () => {
      const alta = await app.inject({
        method: "POST",
        url: "/residencia/residentes",
        headers: comoDirectora,
        payload: { firstName: "COMPLETAR" },
      });
      const clientId = alta.json().residente.clientId;
      expect(alta.json().residente.faltan.length).toBeGreaterThan(5);

      const r = await app.inject({
        method: "PATCH",
        url: `/residencia/residentes/${clientId}`,
        headers: comoDirectora,
        payload: {
          lastName: "Ramos Doblado",
          birthdate: "1941-06-12",
          phone: "600000001",
          admissionDate: "2026-03-01",
          dependencyLevel: "SEMIASISTIDO",
          dependencyGrade: "II",
          placeType: "PRIVADA",
          dni: "11111111H",
          nss: "281234567890",
          responsibleName: "Pilar Ramos",
          responsiblePhone: "600111222",
          responsibleRelation: "hija",
        },
      });
      expect(r.statusCode, r.body).toBe(200);
      const res = r.json().residente;
      expect(res.lastName).toBe("Ramos Doblado");
      expect(res.birthdate).toBe("1941-06-12");
      expect(res.admissionDate).toBe("2026-03-01");
      // Queda el PLAN —el nivel se acaba de poner y la ficha lo ofrece,
      // no lo abre sola— y la CAMA, que a esta señora no se le ha
      // asignado. Y en ese orden: el imprescindible delante.
      expect(res.faltan.map((f: { campo: string }) => f.campo)).toEqual([
        "planDeCuidados",
        "cama",
      ]);

      // Y los apellidos, en `clients`: es la tabla que el PATCH no tocaba
      // antes de este bloque.
      const c = await prisma.client.findUniqueOrThrow({
        where: { id: clientId },
        select: { lastName: true, birthdate: true, phone: true },
      });
      expect(c.lastName).toBe("Ramos Doblado");
      expect(c.phone).toBe("600000001");
      expect(c.birthdate).not.toBeNull();

      // Y al cargar el plan, la ficha queda COMPLETA: ni un aviso.
      await app.inject({
        method: "POST",
        url: `/residencia/residentes/${clientId}/plan/plantilla`,
        headers: comoDirectora,
      });
      // Y con la cama puesta, la ficha queda COMPLETA: ni un aviso.
      await app.inject({
        method: "POST",
        url: `/residencia/residentes/${clientId}/cama`,
        headers: comoDirectora,
        payload: { bedId: camaId },
      });
      const ficha = await app.inject({
        method: "GET",
        url: `/residencia/residentes/${clientId}`,
        headers: comoDirectora,
      });
      expect(ficha.json().residente.faltan).toEqual([]);
    });

    it("el DNI se cuenta SIN DESCIFRARLO · y la lista no lo lleva", async () => {
      const r = await app.inject({
        method: "GET",
        url: "/residencia/residentes",
        headers: comoDirectora,
      });
      expect(r.statusCode, r.body).toBe(200);
      const cuerpo = r.body;
      // Ni el DNI ni su ciphertext salen de la lista. Lo que sale es
      // `faltan`, que es un booleano convertido en etiqueta.
      expect(cuerpo).not.toContain("11111111H");
      expect(cuerpo).not.toContain("c1:");
      const conDni = r
        .json()
        .residentes.find((x: { lastName: string }) => x.lastName === "Ramos Doblado");
      expect(
        (conDni.faltan as Array<{ campo: string }>).map((f) => f.campo),
      ).not.toContain("dni");
    });

    it("la plaza CONCERTADA sube el grado a imprescindible", async () => {
      const alta = await app.inject({
        method: "POST",
        url: "/residencia/residentes",
        headers: comoDirectora,
        payload: { firstName: "CONCERTADA", lastName: "Sin Grado" },
      });
      const clientId = alta.json().residente.clientId;
      const r = await app.inject({
        method: "PATCH",
        url: `/residencia/residentes/${clientId}`,
        headers: comoDirectora,
        payload: { placeType: "CONCERTADA" },
      });
      const grado = (r.json().residente.faltan as Array<{ campo: string; peso: string }>).find(
        (f) => f.campo === "gradoReconocido",
      );
      expect(grado!.peso).toBe("IMPRESCINDIBLE");

      // Y en privada, recomendable.
      const r2 = await app.inject({
        method: "PATCH",
        url: `/residencia/residentes/${clientId}`,
        headers: comoDirectora,
        payload: { placeType: "PRIVADA" },
      });
      const grado2 = (r2.json().residente.faltan as Array<{ campo: string; peso: string }>).find(
        (f) => f.campo === "gradoReconocido",
      );
      expect(grado2!.peso).toBe("RECOMENDABLE");
    });
  });

  // ══════════════════════════════════════════════════════════════════
  //  7 · EL RESUMEN, EL PANEL Y LAS OBLIGACIONES
  // ══════════════════════════════════════════════════════════════════

  describe("donde mira la dirección", () => {
    it("la LISTA trae el resumen del centro", async () => {
      const r = await app.inject({
        method: "GET",
        url: "/residencia/residentes",
        headers: comoDirectora,
      });
      const { residentes, resumen } = r.json();
      expect(resumen.total).toBe(residentes.length);
      expect(resumen.incompletas).toBeGreaterThan(0);
      expect(resumen.datosPendientes).toBeGreaterThan(resumen.incompletas);
    });

    it("y la ficha de quien SE FUE no cuenta en el resumen", async () => {
      // Es un contador que no podría bajar a cero: la ficha de quien se
      // fue en 2019 no se va a completar nunca, y un contador que no se
      // puede llevar a cero enseña a no mirarlo.
      const r = await app.inject({
        method: "GET",
        url: "/residencia/residentes?incluirAltas=true",
        headers: comoDirectora,
      });
      const { residentes, resumen } = r.json();
      const idos = residentes.filter(
        (x: { dischargeDate: string | null }) => x.dischargeDate != null,
      );
      // Hay gente dada de alta en este fichero (el bloque del CHECK), así
      // que esto es una comprobación de verdad y no un `0 === 0`.
      expect(idos.length).toBeGreaterThan(0);
      expect(resumen.total).toBe(residentes.length - idos.length);
    });

    it("el PANEL trae la tarjeta, con los primeros nombres y sus datos", async () => {
      const r = await app.inject({
        method: "GET",
        url: "/residencia/panel",
        headers: comoDirectora,
      });
      expect(r.statusCode, r.body).toBe(200);
      const f = r.json().fichasIncompletas;
      expect(f.incompletas).toBeGreaterThan(0);
      expect(f.primeras.length).toBeGreaterThan(0);
      expect(f.primeras.length).toBeLessThanOrEqual(5);
      expect(f.primeras[0].faltan.length).toBeGreaterThan(0);
      // Y los de imprescindibles primero: es el orden que «Siguiente
      // incompleta» recorre.
      expect(
        f.primeras[0].faltan.some((x: { peso: string }) => x.peso === "IMPRESCINDIBLE"),
      ).toBe(true);
    });

    it("las OBLIGACIONES la traen como obligación viva, SIN fecha", async () => {
      const r = await app.inject({
        method: "GET",
        url: "/residencia/obligaciones",
        headers: comoDirectora,
      });
      expect(r.statusCode, r.body).toBe(200);
      const [o] = r.json().delCentro;
      expect(o.code).toBe("FICHAS_DE_RESIDENTE_INCOMPLETAS");
      expect(o.consequence).toBe("LEGAL");
      expect(o.cuantas).toBeGreaterThan(0);
      // **Sin fecha de vencimiento inventada**: no hay `dueOn` ni nada
      // que se parezca, y tampoco una `DutyOccurrence` detrás.
      expect(o.dueOn).toBeUndefined();
      expect(
        await prisma.dutyOccurrence.count({
          where: { tenantId, duty: { name: { contains: "ficha" } } },
        }),
      ).toBe(0);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  //  8 · Y LA EXPORTACIÓN DEL ART. 28.3.g NO SE ROMPE
  // ══════════════════════════════════════════════════════════════════

  // (el bloque 9, la puerta y el parte, va después: necesita a PELADO)

  describe("un residente sin nivel ni fecha, en el resto de la casa", () => {
    let clientId = "";

    beforeAll(async () => {
      const r = await app.inject({
        method: "POST",
        url: "/residencia/residentes",
        headers: comoDirectora,
        payload: { firstName: "PELADO", bedId: otraCamaId },
      });
      clientId = r.json().residente.clientId;
    });

    it("la EXPORTACIÓN sale, con `null` donde no se sabe y sin «Invalid Date»", async () => {
      const parte = await parteDeResidencia(prisma as never, {
        tenantId,
        clientId,
      });
      expect(parte.json).not.toBeNull();
      // `json` está declarado `unknown` en el tipo —es lo que va al ZIP
      // tal cual—, así que la forma se afirma aquí.
      const ficha = (parte.json as { ficha: Record<string, unknown> }).ficha;
      expect(ficha.ingreso).toBeNull();
      expect(ficha.nivelDeDependencia).toBeNull();
      expect(ficha.tipoDePlaza).toBeNull();
      // Lo que NO puede salir: la cadena de un `Date` inválido ni la
      // época de Unix, que es lo que daba `new Date(null)`.
      const crudo = JSON.stringify(parte.json);
      expect(crudo).not.toContain("Invalid Date");
      expect(crudo).not.toContain("1970-01-01");
      // Y el parte sale sin incidencias de lectura: lo que falta es
      // `null`, no un error.
      expect(parte.incidencias).toEqual([]);
    });

    it("tiene CAMA · la ocupación nace con «ahora», no con una fecha nula", async () => {
      // `bed_assignments.from_at` sigue siendo NOT NULL y tiene que
      // seguirlo siendo: sin fecha, «¿dónde dormía doña Carmen en marzo?»
      // no tiene respuesta, que es la pregunta por la que esta tabla
      // existe.
      const oc = await prisma.bedAssignment.findFirstOrThrow({
        where: { tenantId, clientId, toAt: null },
        select: { fromAt: true },
      });
      expect(oc.fromAt).toBeInstanceOf(Date);
      expect(oc.fromAt.getFullYear()).toBeGreaterThan(2020);
    });

    // ── 9 · LA PUERTA Y EL PARTE · decisión 4 del bloque ───────
    //
    // «La puerta y el relevo no se tocan. Un residente incompleto se
    // atiende igual.» Esto es lo que lo comprueba, y con una auxiliar de
    // verdad: su PIN, su zona y la tablet de la 112.
    //
    // Lo que NO puede pasar: que la auxiliar vea un aviso de datos
    // administrativos en la tablet del pasillo. Eso es cosa del
    // despacho.
    describe("la puerta y el parte · se atiende igual", () => {
      let deLaPuerta: Record<string, string> = {};
      let turnoDeAhora = "";

      beforeAll(async () => {
        const pin = await app.inject({
          method: "PUT",
          url: `/residencia/personal/${auxiliarId}/pin-de-puerta`,
          headers: comoDirectora,
          payload: { pin: PIN_DE_ANA },
        });
        expect(pin.statusCode, pin.body).toBe(200);

        const entrada = await app.inject({
          method: "POST",
          url: "/residencia/puerta/pin",
          headers: { "x-device-token": tokenDeLaTablet },
          payload: { pin: PIN_DE_ANA },
        });
        expect(entrada.statusCode, entrada.body).toBe(200);
        deLaPuerta = {
          "x-device-token": tokenDeLaTablet,
          authorization: `Bearer ${entrada.json().token}`,
        };

        const [turno] = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
          `SELECT id FROM center_shifts WHERE tenant_id = '${tenantId}' AND code = 'M'`,
        );
        turnoDeAhora = turno!.id;
      });

      it("APARECE EN LA PUERTA · con su nombre y sin nada que le falte", async () => {
        const r = await app.inject({
          method: "GET",
          url: "/residencia/puerta/arranque",
          headers: { "x-device-token": tokenDeLaTablet },
        });
        expect(r.statusCode, r.body).toBe(200);
        expect(r.body).toContain("PELADO");
        // **NI UNA PALABRA de lo que le falta.** Decisión 4: nada de
        // avisos de datos administrativos a una auxiliar en la tablet.
        expect(r.body).not.toContain("faltan");
        expect(r.body).not.toContain("incompleta");
        expect(r.body).not.toContain("DNI");
      });

      it("se le registra «COMO SIEMPRE» aunque no tenga plan", async () => {
        // Las dimensiones OBS son del CENTRO, no del plan: por eso «como
        // siempre» funciona en un residente sin nivel y sin plan.
        const r = await app.inject({
          method: "POST",
          url: "/residencia/puerta/registros",
          headers: deLaPuerta,
          payload: {
            registros: [
              {
                id: randomUUID(),
                clientId,
                controlCode: "ANIMO",
                recordedAt: new Date().toISOString(),
                centerShiftId: turnoDeAhora,
                careDay: new Date().toISOString().slice(0, 10),
                valor: { tipo: "ORDINAL", opcion: "COMO_SIEMPRE" },
              },
            ],
          },
        });
        expect(r.statusCode, r.body).toBe(200);
        expect(
          await prisma.careRecord.count({
            where: { tenantId, clientId, controlCode: "ANIMO" },
          }),
        ).toBe(1);
      });

      it("y «ALGO NO VA BIEN» también", async () => {
        const r = await app.inject({
          method: "POST",
          url: "/residencia/puerta/registros",
          headers: deLaPuerta,
          payload: {
            registros: [
              {
                id: randomUUID(),
                clientId,
                controlCode: "ALGO_NO_VA_BIEN",
                recordedAt: new Date().toISOString(),
                centerShiftId: turnoDeAhora,
                careDay: new Date().toISOString().slice(0, 10),
                valor: { tipo: "NOTA" },
                nota: "lleva dos días sin querer levantarse",
                occurrenceAt: null,
              },
            ],
          },
        });
        expect(r.statusCode, r.body).toBe(200);
        expect(
          await prisma.careRecord.count({
            where: { tenantId, clientId, controlCode: "ALGO_NO_VA_BIEN" },
          }),
        ).toBe(1);
      });

      it("SALE EN EL PARTE, y SIN RUIDO · una línea por zona", async () => {
        // residencia-6 §4: el parte ya sabe enseñar a un residente sin
        // plan sin llenarse de «no hecho» — no hay nada que incumplir.
        const r = await app.inject({
          method: "GET",
          url: "/residencia/relevos/vivo",
          headers: comoDirectora,
        });
        expect(r.statusCode, r.body).toBe(200);
        expect(r.body).toContain("PELADO");
        // Y lo que NO lleva: ni una línea de «no hecho» suya. Un
        // residente sin plan no incumple nada.
        // El parte va por ZONAS y dentro de cada zona por RESIDENTE: las
        // líneas cuelgan de la persona, que es como se lee en la sala.
        const parte = r.json().parte as {
          zonas: Array<{
            residentes: Array<{
              nombre: string;
              lineas: Array<{ clase: string; texto: string }>;
            }>;
          }>;
        };
        const suyo = parte.zonas
          .flatMap((z) => z.residentes)
          .find((x) => x.nombre.includes("PELADO"));
        // **Está en el parte** aunque no tenga nivel, ni fecha, ni plan.
        expect(suyo, JSON.stringify(parte.zonas)).toBeDefined();
        // Y lo que se le registró, con su línea.
        expect(suyo!.lineas.length).toBeGreaterThan(0);
        // Pero NI UNA de «no hecho»: un residente sin plan no incumple
        // nada. Sin esto, el parte de un centro recién cargado saldría
        // con cuarenta y tres líneas de cuidados que nadie le mandó —
        // que es el ruido que residencia-6 §4 vino a quitar.
        expect(suyo!.lineas.filter((l) => l.clase === "NO_HECHO")).toEqual([]);
      });
    });

    it("su PLAN está vacío y la ruta del plan NO se cae", async () => {
      const r = await app.inject({
        method: "GET",
        url: `/residencia/residentes/${clientId}/plan`,
        headers: comoDirectora,
      });
      expect(r.statusCode, r.body).toBe(200);
      expect(r.json().residente.dependencyLevel).toBeNull();
      expect(r.json().residente.admissionDate).toBeNull();
      expect(r.json().lineas).toEqual([]);
      // Y «lo que toca hoy» tampoco: cero ocurrencias, sin ruido.
      const hoy = await app.inject({
        method: "GET",
        url: `/residencia/residentes/${clientId}/plan/hoy`,
        headers: comoDirectora,
      });
      expect(hoy.statusCode, hoy.body).toBe(200);
    });
  });
});
