// residencia-6 · **ANTES DEL PILOTO, CONTRA POSTGRES.**
//
// Las cinco cosas que con datos de prueba no se notan y con residentes
// reales sí. Lo que este fichero prueba es lo que no se ve mirando el
// esquema: el camino completo de cada una.
//
//    1. **EL PIN POR ALCANCE (D-68).** La tabla entera: la auxiliar con
//       cuatro entra, la DUE con seis entra, a la DUE con cuatro se le
//       rechaza **al darlo**, y a una auxiliar a la que se le asigna el
//       rol de DUE su PIN de cuatro queda **por renovar** y no entra en
//       la puerta, ni en la sala, ni en el móvil de guardia. El
//       rate-limit cuenta igual para los dos largos, y «por renovar» no
//       gasta intentos.
//    2. **EL ROSTER NO LLEVA EL LARGO.** Lleva el booleano. Decirle a
//       una tablet robada que el PIN de la DUE sigue siendo de cuatro es
//       decirle que pruebe diez mil en vez de un millón.
//    3. **EL PARTE CON UN RESIDENTE SIN PLAN.** Una línea en su zona con
//       su nombre, y **cero líneas de «no hecho»** suyas.
//    4. **EL RASTRO DE LO ILEGIBLE**, con un valor saboteado por SQL: la
//       línea sale, y el canario NO está en el log.
//    5. **EL BARRIDO DE HUÉRFANOS** contra las seis columnas de verdad:
//       la foto que se cambió se barre, la vigente no.
//
// Y la **tabla de sabotajes** contra el motor, que incluye el que no se
// puede parar y hay que decir: un `UPDATE care_pins SET pin_length = 6`
// a mano deja entrar con cuatro cifras. El PIN es irreversible, así que
// la base no puede comprobar su largo — lo sostiene la ruta, y eso se
// dice en el done en vez de fingir que está cerrado.

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { E2E_DATABASE_URL, e2eEnabled, SKIP_MESSAGE } from "./e2e-env.js";

// ── EL VOLUMEN DE ESTE FICHERO, APARTE ──────────────────────────────
//
// `e2e-env.ts` manda a todos los ficheros a la MISMA carpeta de
// `tmpdir()`, y este fichero **borra ficheros** (`barrer --borrar`). Con
// la carpeta compartida, el barrido vería los huérfanos de otra pasada de
// la suite —o de una anterior, cuyas filas ya no están— y el recuento no
// significaría nada.
//
// Se aparta aquí y no se «arregla» en `e2e-env.ts`: que todos los
// ficheros escriban en el mismo sitio es lo que residencia-3 quería, y lo
// raro es este bloque.
process.env.CLINICAL_FILES_DIR = join(
  tmpdir(),
  "mipiacetpv-e2e-clinical-files-r6",
);

process.env.NODE_ENV = "test";
process.env.DATABASE_URL =
  E2E_DATABASE_URL || "postgresql://e2e:e2e@127.0.0.1:5432/e2e";
process.env.REDIS_URL = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";
process.env.JWT_ACCESS_SECRET = "i".repeat(40);
process.env.JWT_REFRESH_SECRET = "j".repeat(40);
process.env.HOLDED_KEY_ENCRYPTION_SECRET = randomBytes(32).toString("base64");

// El Redis en memoria de la suite. El rate-limit del PIN cuelga de él.
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
const { registerResidenciaPuertaRegistroRoutes } = await import(
  "../src/residencia/puerta-registro-routes.js"
);
const { registerResidenciaResidentesRoutes } = await import(
  "../src/residencia/residentes-routes.js"
);
const { registerResidenciaPlanRoutes } = await import(
  "../src/residencia/plan-routes.js"
);
const { registerResidenciaSalaRoutes } = await import(
  "../src/residencia/sala-routes.js"
);
const { registerResidenciaPanelRoutes } = await import(
  "../src/residencia/panel-routes.js"
);
const { registerResidenciaGuardiaRoutes } = await import(
  "../src/residencia/guardia-routes.js"
);
const { registerResidenciaFichaRoutes } = await import(
  "../src/residencia/ficha-routes.js"
);
const { registerResidenciaRolesRoutes } = await import(
  "../src/residencia/roles-routes.js"
);
const { signAccessToken } = await import("../src/auth/tokens.js");
const { registrarSitioDeLectura } = await import(
  "../src/lib/sitio-de-lectura.js"
);
const { olvidarClaves } = await import("../src/clinica/claves.js");
const { construirParte, ventanaDelTurno } = await import(
  "../src/residencia/relevo.js"
);
const { diaDelTurno, turnoDe } = await import("@mipiacetpv/residencia-plan");
const { loQueHayQueArreglar } = await import("../src/residencia/panel.js");
const { barrer } = await import("../src/scripts/barrer-huerfanos.js");
const { __reiniciarAvisoDeIlegible, cablearAvisoDeIlegible } = await import(
  "../src/clinica/aviso-de-ilegible.js"
);
type LineaDeIlegible = import("../src/clinica/aviso-de-ilegible.js").LineaDeIlegible;

// ── Los PIN del escenario ───────────────────────────────────────────
//
// Largos de verdad: Ana y Marta son auxiliares (cuatro), Rosa es DUE y
// Pilar dirige (seis). Es la tabla de D-68 escrita como datos.
const PIN_ANA = "4071";
const PIN_MARTA = "5500";
const PIN_MARTA_LARGO = "550011";
const PIN_ROSA = "918256";
const PIN_PILAR = "334455";

/** El canario del rastro de lo ilegible: lo que va DENTRO del valor
 *  cifrado que se sabotea. Inconfundible a propósito, y de 21 caracteres
 *  porque va en el DNI (que la ruta limita a 32). */
const CANARIO = "ZZCANARIOZZ-12345678Z";

/** Un JPEG mínimo de verdad, para la foto del residente y el barrido. */
function jpegDePrueba(relleno: number): Buffer {
  // Cabecera JPEG + relleno. No es la cara de nadie; lo único que tiene
  // que cumplir es `esJpeg`.
  return Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
    Buffer.alloc(512, relleno),
    Buffer.from([0xff, 0xd9]),
  ]);
}

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

describe.skipIf(!e2eEnabled)("e2e · residencia-6 · antes del piloto", () => {
  if (!e2eEnabled) console.warn(`\n${SKIP_MESSAGE}\n`);

  const prisma = getPrisma();
  let app: FastifyInstance;
  let tenantId = "";
  let pilarId = "";
  let anaId = "";
  let rosaId = "";
  let martaId = "";
  let planta1 = "";
  let hab112 = "";
  let hab113 = "";
  let carmenId = "";
  let luisId = "";
  let token112 = "";
  let token113 = "";
  let tokenSala = "";
  let tokenGuardia = "";
  let comoPilar: Record<string, string> = {};
  let turnos: Array<{ id: string; code: string; starts_at: string; ends_at: string }> =
    [];

  /** Las líneas que el aviso de ilegible escribió. */
  const avisos: LineaDeIlegible[] = [];
  const escrito: string[] = [];

  // ── Ayudas ────────────────────────────────────────────────────────

  function ponerPin(userId: string, pin: string) {
    return app.inject({
      method: "PUT",
      url: `/residencia/personal/${userId}/pin-de-puerta`,
      headers: comoPilar,
      payload: { pin },
    });
  }

  function entrarEnLaPuerta(pin: string, token = token112) {
    return app.inject({
      method: "POST",
      url: "/residencia/puerta/pin",
      headers: { "x-device-token": token },
      payload: { pin },
    });
  }

  function entrarEnLaSala(pin: string) {
    return app.inject({
      method: "POST",
      url: "/residencia/sala/pin",
      headers: { "x-device-token": tokenSala },
      payload: { pin },
    });
  }

  function ponerseDeGuardia(pin: string) {
    return app.inject({
      method: "POST",
      url: "/residencia/guardia/pin",
      headers: { "x-device-token": tokenGuardia },
      payload: { pin },
    });
  }

  /** Le da a alguien un rol de cuidado por su código. El colegiado va
   *  dentro porque DUE lo exige (`requiresLicense`, residencia-1). */
  async function darRol(userId: string, code: string): Promise<void> {
    const roles = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT id FROM care_roles WHERE tenant_id = '${tenantId}' AND code = '${code}'`,
    );
    const r = await app.inject({
      method: "POST",
      url: `/residencia/staff/${userId}/roles-de-cuidado`,
      headers: comoPilar,
      payload: {
        careRoleId: primera(roles, `el rol ${code}`).id,
        colegiado: `COL-${code}-${userId.slice(0, 6)}`,
      },
    });
    expect(r.statusCode, r.body).toBe(201);
  }

  function fichaDeCuidado(userId: string) {
    return app.inject({
      method: "GET",
      url: `/residencia/staff/${userId}/cuidado`,
      headers: comoPilar,
    });
  }

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

  beforeAll(async () => {
    // La carpeta de este fichero, vacía: el barrido cuenta ficheros, y
    // los de una pasada anterior son huérfanos de verdad (sus filas se
    // fueron con el `DROP SCHEMA`) que harían el recuento ilegible.
    rmSync(process.env.CLINICAL_FILES_DIR!, { recursive: true, force: true });

    await cargarCatalogoDeSerie();
    await cargarPlantillaDeGravedad();

    tenantId = randomUUID();
    pilarId = randomUUID();
    anaId = randomUUID();
    rosaId = randomUUID();
    martaId = randomUUID();

    await prisma.$executeRawUnsafe(
      `INSERT INTO tenants (id, name, residencia_enabled, clinical_records_enabled, crm_enabled, agenda_enabled, caja_enabled, updated_at)
       VALUES ('${tenantId}', 'Jardín de Gredos (r6)', true, true, true, true, false, now())`,
    );
    for (const [u, alias, rol] of [
      [pilarId, "Pilar", "OWNER"],
      [anaId, "Ana", "CLINICIAN"],
      [rosaId, "Rosa", "CLINICIAN"],
      [martaId, "Marta", "CLINICIAN"],
    ] as const) {
      await prisma.$executeRawUnsafe(
        `INSERT INTO users (id, tenant_id, email, alias, role, is_clinician, clinical_scope)
         VALUES ('${u}', '${tenantId}', '${alias.toLowerCase()}-r6@gredos.es', '${alias}', '${rol}', true, 'SELECTION')`,
      );
    }
    await sembrarResidencia(prisma as never, tenantId);
    for (const [u, code] of [
      [pilarId, "DIRECCION"],
      [anaId, "AUXILIAR"],
      [rosaId, "DUE"],
      // Marta empieza siendo auxiliar. Lo que este bloque prueba es qué
      // pasa cuando se le da el rol de DUE con el PIN de cuatro puesto.
      [martaId, "AUXILIAR"],
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
    hab113 = randomUUID();
    const cama112a = randomUUID();
    const cama112b = randomUUID();
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
       VALUES ('${cama112a}', '${tenantId}', '${hab112}', 'A', true, now()),
              ('${cama112b}', '${tenantId}', '${hab112}', 'B', true, now())`,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO care_zone_assignments (id, tenant_id, user_id, floor_id, from_at, granted_by_user_id)
       VALUES ('${randomUUID()}', '${tenantId}', '${anaId}', '${planta1}', now() - interval '30 days', '${pilarId}'),
              ('${randomUUID()}', '${tenantId}', '${martaId}', '${planta1}', now() - interval '30 days', '${pilarId}')`,
    );

    comoPilar = {
      authorization: `Bearer ${signAccessToken({
        sub: pilarId,
        tid: tenantId,
        role: "OWNER",
      })}`,
    };

    app = Fastify({ logger: false });
    // residencia-6 · el hook del SITIO DE LECTURA. En producción lo pone
    // `server.ts` una sola vez; aquí hace falta porque este fichero monta
    // su propio Fastify, y sin él la línea del valor ilegible diría
    // `fuera-de-peticion` — que es el valor correcto cuando de verdad no
    // hay petición, y por eso no se nota si no se mira.
    registrarSitioDeLectura(app);
    await registerResidenciaPuertaRegistroRoutes(app);
    await registerResidenciaResidentesRoutes(app);
    await registerResidenciaPlanRoutes(app);
    await registerResidenciaSalaRoutes(app);
    await registerResidenciaPanelRoutes(app);
    await registerResidenciaGuardiaRoutes(app);
    await registerResidenciaFichaRoutes(app);
    await registerResidenciaRolesRoutes(app);
    await app.ready();

    for (const [nombre, cama] of [
      ["Carmen", cama112a],
      ["Luis", cama112b],
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
          placeType: "PRIVADA",
          bedId: cama,
        },
      });
      expect(r.statusCode, r.body).toBe(201);
      const id = r.json().residente.clientId as string;
      if (nombre === "Carmen") carmenId = id;
      else luisId = id;
    }

    // Las dos puertas: la 112 para todo, la 113 para el rate-limit (el
    // candado es POR TABLET y dura dos minutos, así que si se echara en
    // la 112 el resto del fichero se quedaría fuera).
    token112 = randomBytes(24).toString("hex");
    token113 = randomBytes(24).toString("hex");
    for (const [hab, tok, nombre] of [
      [hab112, token112, "Puerta 112"],
      [hab113, token113, "Puerta 113"],
    ] as const) {
      await prisma.$executeRawUnsafe(
        `INSERT INTO devices (id, tenant_id, kind, room_id, register_id, name, device_token_hash)
         VALUES ('${randomUUID()}', '${tenantId}', 'ROOM', '${hab}', NULL, '${nombre}',
                 '${createHash("sha256").update(tok, "utf8").digest("hex")}')`,
      );
    }
    tokenSala = randomBytes(24).toString("hex");
    tokenGuardia = randomBytes(24).toString("hex");
    await prisma.$executeRawUnsafe(
      `INSERT INTO devices (id, tenant_id, kind, room_id, register_id, name, device_token_hash)
       VALUES ('${randomUUID()}', '${tenantId}', 'HANDOVER', NULL, NULL, 'Tablet de la sala',
               '${createHash("sha256").update(tokenSala, "utf8").digest("hex")}')`,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO devices (id, tenant_id, kind, room_id, register_id, guard_channel, name, device_token_hash)
       VALUES ('${randomUUID()}', '${tenantId}', 'GUARD', NULL, NULL, 'ENFERMERIA', 'Móvil',
               '${createHash("sha256").update(tokenGuardia, "utf8").digest("hex")}')`,
    );

    turnos = await prisma.$queryRawUnsafe(
      `SELECT id, code, starts_at, ends_at FROM center_shifts WHERE tenant_id = '${tenantId}'`,
    );

    // El rastro de lo ilegible, recogido aquí en vez de en `app.log`: lo
    // que hay que poder afirmar es QUÉ se escribió, y para eso hace falta
    // verlo (es la razón por la que `configurarAvisoDeIlegible` existe
    // desde clinica-7).
    __reiniciarAvisoDeIlegible();
    cablearAvisoDeIlegible({
      error(obj, msg) {
        avisos.push(obj as LineaDeIlegible);
        escrito.push(JSON.stringify(obj) + " " + msg);
      },
    });
  });

  afterAll(async () => {
    await app?.close();
    olvidarClaves();
    await shutdown();
  });

  // ══ 1 · EL PIN POR ALCANCE (D-68) ═══════════════════════════════

  describe("1 · el PIN por alcance", () => {
    it("la AUXILIAR con cuatro cifras · se le pone y entra", async () => {
      const puesto = await ponerPin(anaId, PIN_ANA);
      expect(puesto.statusCode, puesto.body).toBe(200);
      expect(puesto.json()).toEqual({ tienePin: true, largo: 4 });

      const entra = await entrarEnLaPuerta(PIN_ANA);
      expect(entra.statusCode, entra.body).toBe(200);
      expect(entra.json().usuario.nombre).toBe("Ana");
    });

    it("la DUE con SEIS · se le pone y entra en las tres pantallas", async () => {
      const puesto = await ponerPin(rosaId, PIN_ROSA);
      expect(puesto.statusCode, puesto.body).toBe(200);
      expect(puesto.json().largo).toBe(6);

      expect((await entrarEnLaPuerta(PIN_ROSA)).statusCode).toBe(200);
      expect((await entrarEnLaSala(PIN_ROSA)).statusCode).toBe(200);
      expect((await ponerseDeGuardia(PIN_ROSA)).statusCode).toBe(200);
    });

    it("la DUE con CUATRO · se RECHAZA AL DARLO, con una frase clara", async () => {
      const r = await ponerPin(rosaId, "9182");
      expect(r.statusCode, r.body).toBe(409);
      expect(r.json().error).toBe("PIN_DEMASIADO_CORTO");
      expect(r.json().largoRequerido).toBe(6);
      // La frase dice QUÉ pasa y CUÁNTO cuesta no hacerlo. Quien la lee
      // es quien decide.
      expect(r.json().message).toContain("6 cifras");
      expect(r.json().message).toContain("todo el centro");

      // Y el PIN de seis que ya tenía **sigue valiendo**: un rechazo no
      // puede dejar a la DUE sin credencial a mitad de turno.
      expect((await entrarEnLaPuerta(PIN_ROSA)).statusCode).toBe(200);
    });

    it("y la dirección también necesita seis", async () => {
      expect((await ponerPin(pilarId, "3344")).statusCode).toBe(409);
      expect((await ponerPin(pilarId, PIN_PILAR)).statusCode).toBe(200);
    });

    it("un PIN MÁS LARGO del necesario vale: a la auxiliar no se le obliga a cuatro", async () => {
      const r = await ponerPin(anaId, "407182");
      expect(r.statusCode, r.body).toBe(200);
      expect(r.json().largo).toBe(6);
      expect((await entrarEnLaPuerta("407182")).statusCode).toBe(200);
      // Se le devuelve el suyo para el resto del fichero.
      expect((await ponerPin(anaId, PIN_ANA)).statusCode).toBe(200);
    });

    it("la ficha de Personal dice el largo y si está por renovar · el PIN NO sale", async () => {
      const r = await fichaDeCuidado(rosaId);
      expect(r.statusCode, r.body).toBe(200);
      expect(r.json().pinDePuerta).toEqual({
        desde: expect.any(String),
        largo: 6,
        porRenovar: false,
      });
      expect(r.json().largoDePinRequerido).toBe(6);
      // Y el PIN sigue sin salir, ni en crudo ni su huella ni su hash.
      expect(r.body).not.toContain(PIN_ROSA);
      expect(r.body).not.toContain("pinHash");
      expect(r.body).not.toContain("pinLookup");
    });
  });

  // ══ 2 · EL CASO QUE D-68 NOMBRA ═════════════════════════════════

  describe("2 · a una auxiliar se le asigna el rol de DUE", () => {
    it("con cuatro cifras entra, como cualquier auxiliar", async () => {
      expect((await ponerPin(martaId, PIN_MARTA)).statusCode).toBe(200);
      expect((await entrarEnLaPuerta(PIN_MARTA)).statusCode).toBe(200);
      expect((await entrarEnLaSala(PIN_MARTA)).statusCode).toBe(200);
    });

    it("se le da el rol de DUE · y su PIN queda POR RENOVAR", async () => {
      await darRol(martaId, "DUE");

      const ficha = await fichaDeCuidado(martaId);
      expect(ficha.json().pinDePuerta.porRenovar).toBe(true);
      expect(ficha.json().pinDePuerta.largo).toBe(4);
      expect(ficha.json().largoDePinRequerido).toBe(6);
      expect(ficha.json().alcance).toBe("CENTRO");
    });

    it("y NO ENTRA en la puerta, ni en la sala, ni en el móvil de guardia", async () => {
      // Las tres con la MISMA frase. Quien la lee está de pie en un
      // pasillo: dice qué pasa y a dónde ir, no «PIN incorrecto» —que la
      // dejaría tecleándolo otra vez.
      for (const [donde, respuesta] of [
        ["puerta", await entrarEnLaPuerta(PIN_MARTA)],
        ["sala", await entrarEnLaSala(PIN_MARTA)],
        ["guardia", await ponerseDeGuardia(PIN_MARTA)],
      ] as const) {
        expect(respuesta.statusCode, `${donde}: ${respuesta.body}`).toBe(403);
        expect(respuesta.json().error, donde).toBe("PIN_POR_RENOVAR");
        expect(respuesta.json().message, donde).toBe(
          "Tu PIN tiene que ser de 6 cifras: pídelo en dirección.",
        );
      }
    });

    it("el PANEL de dirección lo lista, con el rol que lo obliga", async () => {
      const r = await app.inject({
        method: "GET",
        url: "/residencia/panel",
        headers: comoPilar,
      });
      expect(r.statusCode, r.body).toBe(200);
      const pines = r.json().porArreglar.pinesPorRenovar as Array<{
        nombre: string;
        roles: string[];
      }>;
      expect(pines.map((p) => p.nombre)).toEqual(["Marta"]);
      expect(pines[0]!.roles.join(" ")).toContain("DUE");
    });

    it("se le pone uno de SEIS y vuelve a entrar en las tres", async () => {
      const puesto = await ponerPin(martaId, PIN_MARTA_LARGO);
      expect(puesto.statusCode, puesto.body).toBe(200);
      expect(puesto.json().largo).toBe(6);

      expect((await entrarEnLaPuerta(PIN_MARTA_LARGO)).statusCode).toBe(200);
      expect((await entrarEnLaSala(PIN_MARTA_LARGO)).statusCode).toBe(200);
      expect((await ponerseDeGuardia(PIN_MARTA_LARGO)).statusCode).toBe(200);

      // Y el panel ya no la lista.
      const panel = await app.inject({
        method: "GET",
        url: "/residencia/panel",
        headers: comoPilar,
      });
      expect(panel.json().porArreglar.pinesPorRenovar).toEqual([]);

      // El viejo de cuatro ya no es el suyo: lo que cambió es la
      // credencial, no sólo el largo.
      expect((await entrarEnLaPuerta(PIN_MARTA)).statusCode).toBe(401);
    });
  });

  // ══ 3 · EL RATE-LIMIT CUENTA IGUAL ══════════════════════════════

  describe("3 · el rate-limit de la puerta (residencia-3 §2)", () => {
    it("diez intentos y candado, con PIN de cuatro y de seis por igual", async () => {
      const malo = (pin: string) => entrarEnLaPuerta(pin, token113);
      // Se alternan largos: lo que cuenta es el intento, no cuántas
      // cifras lleva. Si el de seis no contara, se podría barrer el
      // espacio de los PIN largos sin candado.
      for (let i = 1; i <= 9; i += 1) {
        const r = await malo(i % 2 === 0 ? "000000" : "0001");
        expect(r.statusCode, `intento ${i}: ${r.body}`).toBe(401);
        expect(r.json().attemptsRemaining, `intento ${i}`).toBe(10 - i);
      }
      const decimo = await malo("0002");
      expect(decimo.statusCode).toBe(401);
      expect(decimo.json().attemptsRemaining).toBe(0);

      // Y ni el bueno entra: el candado se mira antes de resolver nada.
      const conElBueno = await entrarEnLaPuerta(PIN_ROSA, token113);
      expect(conElBueno.statusCode, conElBueno.body).toBe(429);
      expect(conElBueno.json().error).toBe("PUERTA_PIN_BLOQUEADO");

      // La 112 sigue abierta: el candado es por tablet.
      expect((await entrarEnLaPuerta(PIN_ANA)).statusCode).toBe(200);
    });

    it("«por renovar» NO gasta intentos: no es un PIN incorrecto", async () => {
      // Dejarla sumando intentos la candaría por algo que ella no puede
      // arreglar. Se comprueba sobre la 112, que está limpia.
      await prisma.$executeRawUnsafe(
        `UPDATE care_pins SET pin_length = 4 WHERE user_id = '${martaId}'`,
      );
      for (let i = 0; i < 12; i += 1) {
        const r = await entrarEnLaPuerta(PIN_MARTA_LARGO);
        expect(r.statusCode, `intento ${i}: ${r.body}`).toBe(403);
        expect(r.json().error).toBe("PIN_POR_RENOVAR");
      }
      // Doce veces y la puerta sigue abierta para los demás.
      expect((await entrarEnLaPuerta(PIN_ANA)).statusCode).toBe(200);
      await prisma.$executeRawUnsafe(
        `UPDATE care_pins SET pin_length = 6 WHERE user_id = '${martaId}'`,
      );
    });
  });

  // ══ 4 · EL ROSTER DEL ARRANQUE ══════════════════════════════════

  describe("4 · lo que viaja a la tablet", () => {
    it("el roster lleva `porRenovar` y **NO el número de cifras**", async () => {
      await prisma.$executeRawUnsafe(
        `UPDATE care_pins SET pin_length = 4 WHERE user_id = '${martaId}'`,
      );
      const r = await app.inject({
        method: "GET",
        url: "/residencia/puerta/arranque",
        headers: { "x-device-token": token112 },
      });
      expect(r.statusCode, r.body).toBe(200);
      const roster = r.json().roster as Array<{
        nombre: string;
        porRenovar: boolean;
        pinLookup: string;
      }>;
      const marta = roster.find((p) => p.nombre === "Marta")!;
      expect(marta.porRenovar).toBe(true);
      const rosa = roster.find((p) => p.nombre === "Rosa")!;
      expect(rosa.porRenovar).toBe(false);

      // **Lo que no puede viajar.** Una tablet robada ya lleva la huella
      // de cada PIN y la subclave (residencia-3 §15.2): decirle además
      // cuántas cifras tiene cada uno es decirle a cuál le toca probar
      // diez mil combinaciones en vez de un millón.
      for (const clave of ["pinLength", "pin_length", "largo"]) {
        expect(r.body, clave).not.toContain(clave);
      }
      await prisma.$executeRawUnsafe(
        `UPDATE care_pins SET pin_length = 6 WHERE user_id = '${martaId}'`,
      );
    });
  });

  // ══ 5 · EL PARTE CON UN RESIDENTE SIN PLAN ══════════════════════

  describe("5 · el parte de un turno con un residente sin plan", () => {
    /** El parte del turno EN CURSO, mirado hasta su final: así todas las
     *  ocurrencias del turno han pasado y «no hecho» es determinista.
     *
     *  Y el `careDay` sale de `diaDelTurno`, **no de
     *  `toISOString().slice(0, 10)`**: a las 00:45 de aquí el UTC es del
     *  día anterior, y con la fecha de UTC la ventana del turno caía en
     *  ayer y el test decía cosas que no eran. Es la hora de pared del
     *  centro la que manda (D-54). */
    async function parteDelTurnoEnCurso() {
      const ahora = new Date();
      const lista = turnos.map((t) => ({
        id: t.id,
        code: t.code,
        name: t.code,
        startsAt: t.starts_at,
        endsAt: t.ends_at,
      }));
      const t = turnoDe(ahora, lista)!;
      const careDay = diaDelTurno(ahora, t);
      const { hasta } = ventanaDelTurno(t, careDay);
      return construirParte(prisma, {
        tenantId,
        turno: t,
        careDay,
        corte: hasta,
        ahora,
      });
    }

    function lineasDe(parte: Awaited<ReturnType<typeof construirParte>>, clientId: string) {
      return parte.zonas
        .flatMap((z) => z.residentes)
        .filter((r) => r.clientId === clientId)
        .flatMap((r) => r.lineas);
    }

    function sinPlanDe(parte: Awaited<ReturnType<typeof construirParte>>) {
      return parte.zonas.flatMap((z) =>
        z.sueltas.filter((l) => l.clase === "SIN_PLAN_DE_CUIDADOS"),
      );
    }

    it("ANTES: con plan, Luis genera líneas de «no hecho» y ninguna de «sin plan»", async () => {
      // Es la mitad que da sentido a la otra: el parte de un turno en que
      // de verdad no se registró nada sale lleno de rojo (residencia-5
      // §16.4), y eso es lo que se viene a quitar.
      const parte = await parteDelTurnoEnCurso();
      expect(
        lineasDe(parte, luisId).filter((l) => l.clase === "NO_HECHO").length,
      ).toBeGreaterThan(0);
      expect(sinPlanDe(parte)).toEqual([]);
    });

    it("RETIRADO A MITAD DEL TURNO: salen las dos cosas, y las dos son verdad", async () => {
      // Se le retiran a Luis TODAS las líneas por la ruta de verdad: es
      // lo que hace dirección cuando se equivoca de nivel al darle de
      // alta y lo deja a medias.
      const plan = await app.inject({
        method: "GET",
        url: `/residencia/residentes/${luisId}/plan`,
        headers: comoPilar,
      });
      expect(plan.statusCode, plan.body).toBe(200);
      const lineas = plan.json().lineas as Array<{ id: string; hasta: string | null }>;
      expect(lineas.length).toBeGreaterThan(0);
      for (const l of lineas.filter((x) => x.hasta == null)) {
        const r = await app.inject({
          method: "DELETE",
          url: `/residencia/residentes/${luisId}/plan/${l.id}`,
          headers: comoPilar,
          payload: { motivo: "se equivocó el nivel al darle de alta" },
        });
        expect(r.statusCode, r.body).toBe(200);
      }

      const parte = await parteDelTurnoEnCurso();

      // «Vigente» es EN EL CORTE, así que sale la línea de «sin plan»…
      const sinPlan = sinPlanDe(parte);
      expect(sinPlan).toHaveLength(1);
      expect(sinPlan[0]!.texto).toContain("Luis Núñez");

      // …y **los «no hecho» de la parte del turno en que SÍ tenía plan
      // siguen saliendo**. Las dos cosas son verdad y las dos tienen que
      // constar: a las 10:00 le tocaba un cambio postural y no se hizo,
      // y a las 14:00 ya no le toca nada porque no tiene plan. Borrar lo
      // primero al retirarle el plan sería tapar un incumplimiento
      // retirando una línea del plan, que es exactamente lo que una
      // auditoría no puede permitir (`no-hecho.ts`, razón 1).
      expect(
        lineasDe(parte, luisId).filter((l) => l.clase === "NO_HECHO").length,
      ).toBeGreaterThan(0);
    });

    it("SIN PLAN DESDE AYER: UNA línea con su nombre y CERO «no hecho»", async () => {
      // El caso del bloque: un residente que lleva el turno entero sin
      // plan. Se simula echando atrás el `to_at` que la ruta acaba de
      // poner —«se le retiró ayer»— porque la ruta sólo sabe cerrar
      // AHORA, y lo que hay que ver es el turno siguiente.
      await prisma.$executeRawUnsafe(
        `UPDATE care_plan_items SET to_at = now() - interval '2 days'
         WHERE tenant_id = '${tenantId}' AND client_id = '${luisId}' AND to_at IS NOT NULL`,
      );

      const parte = await parteDelTurnoEnCurso();

      const sinPlan = sinPlanDe(parte);
      expect(sinPlan).toHaveLength(1);
      expect(sinPlan[0]!.texto).toContain("1 residente sin plan de cuidados");
      expect(sinPlan[0]!.texto).toContain("Luis Núñez");
      // Y dice la consecuencia, que es lo que el turno entrante necesita
      // saber: en su puerta no sale nada.
      expect(sinPlan[0]!.texto).toContain("no sale nada en su puerta");
      // Sin hora: no ha pasado a ninguna hora. Poner la del corte diría
      // que el plan se cayó a las 15:00.
      expect(sinPlan[0]!.hora).toBeNull();

      // **Y ni una línea de «no hecho» de Luis.** No hay nada que
      // incumplir, y treinta líneas rojas harían el parte ilegible
      // (residencia-5 §16.4).
      expect(
        lineasDe(parte, luisId).filter((l) => l.clase === "NO_HECHO"),
      ).toEqual([]);

      // Carmen sí tiene plan, así que su cálculo sigue igual: lo que se
      // ha quitado es el ruido, no el «no hecho».
      expect(
        lineasDe(parte, carmenId).filter((l) => l.clase === "NO_HECHO").length,
      ).toBeGreaterThan(0);

      // Y la línea cae en SU zona, no en la del centro: el parte se
      // recorta por alcance (D-51), y una línea con nombres de la segunda
      // planta dentro del parte de la primera sería un dato de quien no
      // le corresponde.
      const zona = parte.zonas.find((z) =>
        z.sueltas.some((l) => l.clase === "SIN_PLAN_DE_CUIDADOS"),
      )!;
      expect(zona.floorId).toBe(planta1);
    });

    it("y el panel lo enseña como algo que hay que arreglar", async () => {
      const r = await app.inject({
        method: "GET",
        url: "/residencia/panel",
        headers: comoPilar,
      });
      const sinPlan = r.json().porArreglar.residentesSinPlan as Array<{
        nombre: string;
        habitacion: string | null;
      }>;
      expect(sinPlan.map((x) => x.nombre)).toEqual(["Luis Núñez"]);
      expect(sinPlan[0]!.habitacion).toBe("112");
    });

    it("al devolverle el plan, desaparece de las dos listas", async () => {
      const r = await app.inject({
        method: "POST",
        url: `/residencia/residentes/${luisId}/plan`,
        headers: comoPilar,
        payload: {
          controlCode: "CAMBIO_POSTURAL",
          frecuencia: { kind: "EVERY_SHIFT", shiftCodes: ["M", "T", "N"] },
          motivo: "se le vuelve a poner lo suyo",
        },
      });
      expect(r.statusCode, r.body).toBe(201);

      const arreglar = await loQueHayQueArreglar(prisma, tenantId, new Date());
      expect(arreglar.residentesSinPlan).toEqual([]);
      expect(sinPlanDe(await parteDelTurnoEnCurso())).toEqual([]);
    });
  });

  // ══ 6 · EL RASTRO DE LO ILEGIBLE ════════════════════════════════

  describe("6 · lo que no se descifra deja rastro", () => {
    it("un valor saboteado por SQL deja su línea, y el canario NO está", async () => {
      // ── POR QUÉ EL DNI Y NO UNA NOTA DE «ALGO NO VA BIEN» ────────
      //
      // Porque `care_records` es **inmutable por trigger** (residencia-3
      // §1) y lo que hace falta aquí es MOVER un valor cifrado de una
      // fila a otra, que es lo que lo deja ilegible (el AAD lleva el id
      // dentro). `resident_profiles` sí se puede actualizar —la ficha se
      // corrige— así que el sabotaje realista es el de residencia-1b §2:
      // un `UPDATE` a mano que copia el DNI de Carmen a la ficha de Luis.
      // El camino de lectura es el mismo `leerTexto` de las veinticuatro
      // columnas.
      const puesto = await app.inject({
        method: "PATCH",
        url: `/residencia/residentes/${carmenId}`,
        headers: comoPilar,
        payload: { dni: CANARIO },
      });
      expect(puesto.statusCode, puesto.body).toBe(200);

      // El ciphertext de Carmen, a la fila de Luis.
      await prisma.$executeRawUnsafe(
        `UPDATE resident_profiles SET dni_cifrado = (
           SELECT dni_cifrado FROM resident_profiles WHERE client_id = '${carmenId}'
         ), dni = NULL WHERE client_id = '${luisId}'`,
      );

      avisos.length = 0;
      escrito.length = 0;
      const ficha = await app.inject({
        method: "GET",
        url: `/residencia/residentes/${luisId}`,
        headers: comoPilar,
      });
      expect(ficha.statusCode, ficha.body).toBe(200);

      // 1 · la línea existe, con los seis campos.
      const linea = avisos.find((a) => a.fila === luisId);
      expect(linea, `no hay línea del valor ilegible: ${JSON.stringify(avisos)}`)
        .toBeDefined();
      expect(linea!.tenant).toBe(tenantId);
      expect(linea!.tabla).toBe("resident_profiles");
      expect(linea!.columna).toBe("dni");
      expect(linea!.motivo).toBe("NO_SE_DESCIFRA");
      // El sitio es la RUTA desde la que se leía, con su PATRÓN: sin ids
      // dentro, que serían un dato de alguien en una línea de log.
      expect(linea!.sitio).toContain("/residencia/residentes/");
      expect(linea!.sitio).not.toContain(luisId);

      // 2 · y NO FILTRA NADA. Ni el claro, ni el trozo que V8 cita en un
      // `JSON.parse` fallido, ni el ciphertext, ni la clave.
      const todo = escrito.join("\n");
      expect(todo).not.toContain(CANARIO);
      expect(todo).not.toContain(CANARIO.slice(0, 10));
      expect(todo).not.toContain("c1:");

      // 3 · y la ficha SE SIGUE SIRVIENDO, con el hueco marcado.
      // Reventar la petición dejaría al residente sin su ficha entera por
      // un fallo en una columna (clinica-7).
      expect(ficha.body).toContain("no se puede leer");

      // 4 · y leerla cien veces deja UNA línea, no cien.
      avisos.length = 0;
      for (let i = 0; i < 5; i += 1) {
        await app.inject({
          method: "GET",
          url: `/residencia/residentes/${luisId}`,
          headers: comoPilar,
        });
      }
      expect(avisos.filter((a) => a.fila === luisId)).toHaveLength(0);
    });
  });

  // ══ 7 · EL BARRIDO DE HUÉRFANOS ═════════════════════════════════

  describe("7 · el barrido de huérfanos, contra las columnas de verdad", () => {
    let fotoVieja = "";
    let fotoVigente = "";

    beforeAll(async () => {
      // La foto de Carmen, y después otra: la primera queda huérfana en
      // el volumen (residencia-3 §15.5). Se apuntan los DOS nombres
      // porque lo que hay que afirmar es cuál se va y cuál se queda, no
      // «cuántos hay» — en el volumen puede haber ficheros de otros
      // bloques de la suite.
      for (const relleno of [1, 2]) {
        const r = await app.inject({
          method: "PUT",
          url: `/residencia/residentes/${carmenId}/foto`,
          headers: comoPilar,
          payload: { jpegBase64: jpegDePrueba(relleno).toString("base64") },
        });
        expect(r.statusCode, r.body).toBe(200);
        const filas = await prisma.$queryRawUnsafe<
          Array<{ photo_file_name: string }>
        >(
          `SELECT photo_file_name FROM resident_profiles WHERE client_id = '${carmenId}'`,
        );
        const nombre = primera(filas).photo_file_name;
        if (relleno === 1) fotoVieja = nombre;
        else fotoVigente = nombre;
      }
      expect(fotoVieja).not.toBe(fotoVigente);
    });

    it("la VIEJA sale como huérfana y la VIGENTE no", async () => {
      // El margen a 0: las dos fotos son de hace un segundo, y lo que se
      // prueba aquí es el cruce con la base. El margen lo prueba
      // `residencia-6-barrido.test.ts`, con el `mtime` puesto a mano.
      const b = await barrer({
        borrar: false,
        margenMinutos: 0,
        ahora: new Date(),
      });
      const huerfanas = b.huerfanos
        .filter((h) => h.clase === "RESIDENTE")
        .map((h) => h.fileName);
      expect(huerfanas).toContain(fotoVieja);
      expect(huerfanas).not.toContain(fotoVigente);
      // Y no se ha borrado nada sin `--borrar`.
      expect(b.borrados).toBe(0);
    });

    it("con --borrar se va la huérfana y la VIGENTE se sigue sirviendo", async () => {
      const b = await barrer({
        borrar: true,
        margenMinutos: 0,
        ahora: new Date(),
      });
      expect(b.borrados).toBeGreaterThanOrEqual(1);

      // La comprobación de verdad: un barrido que se lleva la foto buena
      // deja la ficha apuntando a la nada.
      const foto = await app.inject({
        method: "GET",
        url: `/residencia/residentes/${carmenId}/foto`,
        headers: comoPilar,
      });
      expect(foto.statusCode, foto.body).toBe(200);

      // Y es idempotente: la segunda pasada no encuentra la vieja.
      const otra = await barrer({
        borrar: true,
        margenMinutos: 0,
        ahora: new Date(),
      });
      expect(otra.huerfanos.map((h) => h.fileName)).not.toContain(fotoVieja);
    });
  });

  // ══ 8 · LA TABLA DE SABOTAJES ═══════════════════════════════════

  describe("8 · la tabla de sabotajes", () => {
    it("un `pin_length` fuera de 4..8 lo para el CHECK", async () => {
      const msg = await debeFallar(
        `UPDATE care_pins SET pin_length = 2 WHERE user_id = '${anaId}'`,
      );
      expect(msg).toContain("care_pins_pin_length_valido");
      const otro = await debeFallar(
        `UPDATE care_pins SET pin_length = 9 WHERE user_id = '${anaId}'`,
      );
      expect(otro).toContain("care_pins_pin_length_valido");
    });

    it("y un PIN de cuatro cifras a una DUE **por la RUTA** se para", async () => {
      expect((await ponerPin(rosaId, "1111")).statusCode).toBe(409);
    });

    it("**pero `UPDATE care_pins SET pin_length = 6` a mano SÍ pasa** · lo dice el done", async () => {
      // Esto es lo que NO se puede cerrar, y conviene que esté escrito en
      // un test en vez de descubrirse en una auditoría: el PIN es
      // irreversible (argon2id + huella HMAC), así que **la base no puede
      // comprobar cuántas cifras tiene**. Lo que sostiene D-68 es la
      // ruta, y quien tiene `UPDATE` sobre `care_pins` tiene mucho más
      // que esto (puede ponerle el hash que quiera).
      //
      // Se deja constancia del alcance exacto: con el PIN de cuatro de
      // Ana y el `pin_length` mentido a 6, le damos el rol de DUE y entra.
      await prisma.$executeRawUnsafe(
        `UPDATE care_pins SET pin_length = 6 WHERE user_id = '${anaId}'`,
      );
      await darRol(anaId, "DUE");
      const entra = await entrarEnLaPuerta(PIN_ANA);
      expect(entra.statusCode, entra.body).toBe(200);

      // Y con el `pin_length` de verdad, no entra. Es la prueba de que el
      // agujero es exactamente ése y no otro.
      await prisma.$executeRawUnsafe(
        `UPDATE care_pins SET pin_length = 4 WHERE user_id = '${anaId}'`,
      );
      const no = await entrarEnLaPuerta(PIN_ANA);
      expect(no.statusCode).toBe(403);
      expect(no.json().error).toBe("PIN_POR_RENOVAR");
    });

    it("dos personas no pueden compartir PIN, ni con largos distintos", async () => {
      // El índice único es por huella, y la huella es del PIN entero: un
      // PIN de seis y uno de cuatro nunca chocan, pero dos iguales sí — y
      // eso es lo que hace que teclear sólo el PIN identifique a alguien.
      const r = await ponerPin(martaId, PIN_ROSA);
      expect(r.statusCode, r.body).toBe(409);
      expect(r.json().error).toBe("PIN_YA_USADO");
      // Y no se dice de QUIÉN es.
      expect(r.json().message).not.toContain("Rosa");
    });
  });
});
