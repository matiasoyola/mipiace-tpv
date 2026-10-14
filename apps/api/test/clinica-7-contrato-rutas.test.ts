// clinica-7 · EL CONTRATO EN LAS RUTAS, EL 423 Y «MI PIACE NO MIRA».
//
// Los cuatro sabotajes del prompt que viven aquí:
//
//   · una escritura con el contrato revocado → **423**, y la lectura → 200;
//   · aceptar sin ser OWNER → rechazado;
//   · sin contrato NUNCA aceptado, ni una ruta clínica contesta con datos;
//   · **el superadmin no abre historias**, por cada camino que existe.
//
// El último es el que encontró trabajo de verdad, y está contado en la
// cabecera de `clinica/gate.ts`: la impersonación firma `sub: owner.id` y
// `role: OWNER`, así que para todo lo que mira `request.auth` **una sesión
// de Mi Piace ES la dueña** — y la dueña de una clínica es sanitaria. Sin
// la decisión 24, un superadmin leía cualquier historia y la única huella
// era una línea con el nombre de Rosario.

import { randomBytes, randomUUID } from "node:crypto";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.REDIS_URL = "redis://localhost:6379";
process.env.JWT_ACCESS_SECRET = "a".repeat(40);
process.env.JWT_REFRESH_SECRET = "b".repeat(40);
process.env.SUPER_ADMIN_JWT_SECRET = "s".repeat(48);
process.env.HOLDED_KEY_ENCRYPTION_SECRET = randomBytes(32).toString("base64");

import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  contratoFake,
  kekDePrueba,
  llaveroFake,
} from "./clinica-7-claves-fake.js";

kekDePrueba();

const TENANT = "00000000-0000-0000-0000-000000000001";
const DUENA = "11111111-1111-1111-1111-111111111111";
const SANITARIA = "22222222-2222-2222-2222-222222222222";
const PACIENTE = "44444444-4444-4444-4444-444444444444";

const llavero = llaveroFake();
const contrato = contratoFake(TENANT, DUENA);

let clinicaEncendida = true;
let bloqueada = false;

interface FakeUser {
  id: string;
  role: "OWNER" | "MANAGER" | "CASHIER" | "CLINICIAN";
  isClinician: boolean;
}
const users = new Map<string, FakeUser>([
  [DUENA, { id: DUENA, role: "OWNER", isClinician: true }],
  [SANITARIA, { id: SANITARIA, role: "CLINICIAN", isClinician: true }],
]);

const entradas: Array<{
  id: string;
  tenantId: string;
  clientId: string;
  authorUserId: string;
  appointmentId: string | null;
  kind: string;
  body: unknown;
  bodyCifrado: string | null;
  createdAt: Date;
}> = [];
const registro: Array<{ userId: string; action: string; outcome: string }> = [];

const autorDe = (id: string) => ({ id, alias: null, email: `${id}@c.es` });

const fakePrisma: any = {
  clinicalTenantKey: llavero.modelo,
  clinicalProcessorAgreement: contrato.modelo,
  tenant: {
    findUnique: vi.fn(async ({ select }: any) =>
      select?.blockedAt !== undefined
        ? { blockedAt: bloqueada ? new Date() : null, blockedReason: null }
        : { clinicalRecordsEnabled: clinicaEncendida },
    ),
    findFirst: vi.fn(async () => ({
      name: "Clínica", fiscalProfile: null,
    })),
    count: vi.fn(async () => (clinicaEncendida ? 1 : 0)),
  },
  user: {
    findFirst: vi.fn(async ({ where }: any) => users.get(where.id) ?? null),
    findUnique: vi.fn(async ({ where }: any) => users.get(where.id) ?? null),
  },
  client: {
    findFirst: vi.fn(async ({ where }: any) =>
      where.id === PACIENTE ? { id: PACIENTE } : null,
    ),
  },
  clinicalAccess: {
    findFirst: vi.fn(async () => ({ id: "acc" })),
    findMany: vi.fn(async () => [{ clientId: PACIENTE }]),
  },
  clinicalAccessLog: {
    create: vi.fn(async ({ data }: any) => {
      registro.push({
        userId: data.userId,
        action: data.action,
        outcome: data.outcome,
      });
      return { id: randomUUID() };
    }),
  },
  clinicalEntry: {
    findMany: vi.fn(async ({ where }: any) =>
      entradas
        .filter(
          (e) =>
            (where.tenantId == null || e.tenantId === where.tenantId) &&
            (where.clientId == null || e.clientId === where.clientId),
        )
        .map((e) => ({ ...e, author: autorDe(e.authorUserId), addenda: [] })),
    ),
    findFirst: vi.fn(async () => null),
    create: vi.fn(async ({ data }: any) => {
      const row = {
        id: data.id ?? randomUUID(),
        tenantId: data.tenantId,
        clientId: data.clientId,
        authorUserId: data.authorUserId,
        appointmentId: data.appointmentId ?? null,
        kind: data.kind ?? "NOTE",
        body: data.body,
        bodyCifrado: data.bodyCifrado ?? null,
        createdAt: new Date(),
      };
      entradas.push(row);
      return { ...row, author: autorDe(row.authorUserId) };
    }),
  },
  clinicalAddendum: { create: vi.fn(async ({ data }: any) => ({ id: randomUUID(), ...data })) },
  appointment: { findFirst: vi.fn(async () => null) },
  // El PDF del contrato lee la cabecera del centro.
  store: { findFirst: vi.fn(async () => null) },
  // Y una sesión de impersonación en modo `full` escribe su audit ANTES
  // de que la ruta decida: lo hace `requireOwner`, y eso está bien — que
  // Mi Piace lo intentara tiene que constar en `super_admin_audit`, que es
  // donde consta lo que hace el superadmin.
  superAdminAudit: { create: vi.fn(async () => ({ id: randomUUID() })) },
};
fakePrisma.tenant.findFirstOrThrow = vi.fn(async () => ({
  name: "Clínica",
  fiscalProfile: null,
}));

vi.mock("../src/context.js", () => ({
  getPrisma: () => fakePrisma,
  getRedis: () => ({ ping: async () => "PONG" }),
  shutdown: async () => undefined,
}));

const { registerClinicaRoutes } = await import("../src/clinica/routes.js");
const { registerContratoRoutes } = await import(
  "../src/clinica/contrato-routes.js"
);
const { signAccessToken } = await import("../src/auth/tokens.js");
const { signImpersonationToken } = await import("../src/superadmin/tokens.js");
const { olvidarClaves } = await import("../src/clinica/claves.js");
const { olvidarEstado } = await import("../src/clinica/contrato.js");
const { olvidarSiEsClinico } = await import("../src/clinica/notas.js");
const { VERSION_VIGENTE } = await import("@mipiacetpv/contrato-encargado");

function token(userId: string, role: FakeUser["role"]) {
  return { authorization: `Bearer ${signAccessToken({ sub: userId, tid: TENANT, role })}` };
}
const comoDuena = token(DUENA, "OWNER");
const comoSanitaria = token(SANITARIA, "CLINICIAN");

/** El token que firma `POST /super-admin/tenants/:id/impersonate`: lleva el
 *  id REAL de la dueña y `role: OWNER`. Es lo que hace que la decisión 24
 *  tuviera que ser código y no una afirmación. */
const comoMiPiace = {
  authorization: `Bearer ${signImpersonationToken({
    sub: DUENA,
    tid: TENANT,
    tv: 0,
    by: "super-admin-1",
    mode: "full",
  })}`,
};

async function buildApp() {
  const app = Fastify();
  await registerClinicaRoutes(app);
  await registerContratoRoutes(app);
  await app.ready();
  return app;
}

beforeEach(() => {
  clinicaEncendida = true;
  bloqueada = false;
  entradas.length = 0;
  registro.length = 0;
  llavero.reset();
  contrato.reset();
  olvidarClaves();
  olvidarEstado();
  olvidarSiEsClinico();
  users.set(DUENA, { id: DUENA, role: "OWNER", isClinician: true });
});

// ── 1 · SIN CONTRATO NUNCA ACEPTADO ─────────────────────────────────

describe("clinica-7 · sin contrato aceptado, ni una ruta clínica da datos", () => {
  it("la lectura de la historia contesta 423 y no el contenido", async () => {
    contrato.vaciar();
    olvidarEstado();
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/clinica/clients/${PACIENTE}/entries`,
      headers: comoSanitaria,
    });
    // Decisión 4: «ni una ruta clínica responde con datos». Lectura
    // incluida: es la primera vez que se pregunta y la respuesta prudente
    // es no.
    expect(res.statusCode).toBe(423);
    // Y con SU código, que no es el de «revocado»: aquí no es que esté en
    // solo lectura — es que no se puede ni leer, y la frase lo dice.
    expect(res.json().code).toBe("CONTRATO_ENCARGADO_SIN_ACEPTAR");
    expect(res.json().message).toContain("todavía no está activa");
    await app.close();
  });

  it("la escritura también, y el mensaje dice QUIÉN lo arregla", async () => {
    contrato.vaciar();
    olvidarEstado();
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/clinica/clients/${PACIENTE}/entries`,
      headers: comoSanitaria,
      payload: { body: { texto: "x" } },
    });
    expect(res.statusCode).toBe(423);
    expect(res.json().message).toContain("la dueña");
    expect(entradas).toHaveLength(0);
    await app.close();
  });

  it("y la pantalla del contrato SÍ se abre: es lo que lo arregla", async () => {
    contrato.vaciar();
    olvidarEstado();
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/clinica/contrato",
      headers: comoSanitaria,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().estado).toEqual({ estado: "SIN_CONTRATO" });
    // Y el texto viene entero, para pintarlo.
    expect(res.json().apartados.length).toBeGreaterThan(5);
    expect(res.json().pendienteDeValidar).toBe(true);
    // Lo que la sanitaria NO puede es aceptarlo.
    expect(res.json().puedeAceptar).toBe(false);
    await app.close();
  });
});

// ── 2 · EL 423 DE LA REVOCACIÓN: ESCRIBIR NO, LEER SÍ ───────────────

describe("clinica-7 · con el contrato revocado, SOLO LECTURA", () => {
  beforeEach(() => {
    contrato.revocar();
    olvidarEstado();
  });

  it("LA ESCRITURA contesta 423 con su código propio", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/clinica/clients/${PACIENTE}/entries`,
      headers: comoSanitaria,
      payload: { body: { texto: "una anotación nueva" } },
    });
    expect(res.statusCode).toBe(423);
    expect(res.json().code).toBe("CONTRATO_ENCARGADO_NO_VIGENTE");
    expect(entradas).toHaveLength(0);
    await app.close();
  });

  it("Y LA LECTURA contesta 200 con la historia entera", async () => {
    // Es la regla de Matías: «lo que lea está recogido con lo que aceptó
    // hasta ese momento». Y además la Ley 41/2002 obliga a conservarla y a
    // dársela al paciente que la pida: apagar la lectura al revocar
    // convertiría una revocación administrativa en una infracción.
    entradas.push({
      id: randomUUID(),
      tenantId: TENANT,
      clientId: PACIENTE,
      authorUserId: SANITARIA,
      appointmentId: null,
      kind: "NOTE",
      body: { texto: "lo de antes de revocar" },
      bodyCifrado: null,
      createdAt: new Date(),
    });
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/clinica/clients/${PACIENTE}/entries`,
      headers: comoSanitaria,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().entries[0].body).toEqual({ texto: "lo de antes de revocar" });
    await app.close();
  });

  it("el intento de escribir deja línea DENIED en el registro", async () => {
    // Es uno de los que más interesa ver: alguien intentando escribir en
    // una historia con el contrato revocado.
    const app = await buildApp();
    await app.inject({
      method: "POST",
      url: `/clinica/clients/${PACIENTE}/entries`,
      headers: comoSanitaria,
      payload: { body: { texto: "x" } },
    });
    expect(registro.filter((r) => r.outcome === "DENIED")).toHaveLength(1);
    expect(registro.at(-1)).toMatchObject({
      userId: SANITARIA,
      action: "WRITE",
      outcome: "DENIED",
    });
    await app.close();
  });

  it("y VOLVER A ACEPTAR devuelve la escritura, sin editar ninguna fila", async () => {
    const app = await buildApp();
    const antes = await app.inject({
      method: "POST",
      url: `/clinica/clients/${PACIENTE}/entries`,
      headers: comoSanitaria,
      payload: { body: { texto: "x" } },
    });
    expect(antes.statusCode).toBe(423);

    const filasAntes = contrato.filas.length;
    const acepta = await app.inject({
      method: "POST",
      url: "/clinica/contrato/aceptar",
      headers: comoDuena,
      payload: {},
    });
    expect(acepta.statusCode).toBe(201);
    // UNA FILA MÁS, y ninguna editada.
    expect(contrato.filas.length).toBe(filasAntes + 1);
    olvidarEstado();

    const despues = await app.inject({
      method: "POST",
      url: `/clinica/clients/${PACIENTE}/entries`,
      headers: comoSanitaria,
      payload: { body: { texto: "ya se puede" } },
    });
    expect(despues.statusCode).toBe(201);
    await app.close();
  });
});

// ── 3 · SOLO LA DUEÑA ACEPTA ────────────────────────────────────────

describe("clinica-7 · el contrato lo acepta la dueña y nadie más", () => {
  it("la sanitaria NO lo acepta: 403 y ni una fila", async () => {
    contrato.vaciar();
    olvidarEstado();
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/clinica/contrato/aceptar",
      headers: comoSanitaria,
      payload: {},
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("SOLO_LA_DUENA");
    expect(contrato.filas).toHaveLength(0);
    await app.close();
  });

  it("y un token que DICE ser OWNER sin serlo en la base, tampoco", async () => {
    // Cierra la ventana en que a alguien se le quitó el OWNER y sigue
    // teniendo un token firmado con el rol viejo. Para una prueba jurídica,
    // media hora de ventana es media hora de más.
    contrato.vaciar();
    olvidarEstado();
    users.set(DUENA, { id: DUENA, role: "CASHIER", isClinician: false });
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/clinica/contrato/aceptar",
      headers: comoDuena,
      payload: {},
    });
    expect(res.statusCode).toBe(403);
    expect(contrato.filas).toHaveLength(0);
    await app.close();
  });

  it("la dueña sí, y la fila guarda versión, huella, quién, IP y user-agent", async () => {
    contrato.vaciar();
    olvidarEstado();
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/clinica/contrato/aceptar",
      headers: { ...comoDuena, "user-agent": "TPV/1.0 (tablet)" },
      payload: {},
    });
    expect(res.statusCode).toBe(201);
    const fila = contrato.filas[0]!;
    expect(fila.version).toBe(VERSION_VIGENTE);
    expect(fila.textSha256).toBe(contrato.huella);
    expect(fila.userId).toBe(DUENA);
    expect(fila.userAgent).toBe("TPV/1.0 (tablet)");
    expect(fila.revokesAgreementId).toBeNull();
    await app.close();
  });

  it("aceptarlo dos veces no escribe dos filas", async () => {
    // Dos aceptaciones del mismo texto el mismo día no son más prueba: son
    // una pregunta. Misma decisión que un consentimiento ya firmado.
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/clinica/contrato/aceptar",
      headers: comoDuena,
      payload: {},
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("YA_ESTABA_ACEPTADA");
    expect(contrato.filas).toHaveLength(1);
    await app.close();
  });

  it("revocar escribe UNA fila por cada aceptación viva, enlazada", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/clinica/contrato/revocar",
      headers: comoDuena,
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().revocaciones).toBe(1);
    const revocacion = contrato.filas[1]!;
    expect(revocacion.revokesAgreementId).toBe(contrato.filas[0]!.id);
    // Y COPIA versión y huella, para que la lista se lea sin cruzar filas.
    expect(revocacion.version).toBe(contrato.filas[0]!.version);
    expect(revocacion.textSha256).toBe(contrato.filas[0]!.textSha256);
    // La respuesta dice las consecuencias, que es lo que la pantalla pinta.
    expect(res.json().consecuencias.join(" ")).toContain("SOLO LECTURA");
    expect(res.json().consecuencias.join(" ")).toContain("notas");
    await app.close();
  });

  it("y la cuenta bloqueada NO acepta ni revoca, pero SÍ lee", async () => {
    bloqueada = true;
    const app = await buildApp();
    // Leer sí: el bloqueo es comercial y el contrato es su prueba de
    // cumplimiento del art. 28.
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/clinica/contrato",
          headers: comoDuena,
        })
      ).statusCode,
    ).toBe(200);
    // Escribir no.
    const acepta = await app.inject({
      method: "POST",
      url: "/clinica/contrato/revocar",
      headers: comoDuena,
    });
    expect(acepta.statusCode).toBe(423);
    expect(acepta.json().code).toBe("TENANT_BLOCKED");
    await app.close();
  });
});

// ── 4 · MI PIACE NO MIRA · decisión 24 ──────────────────────────────

describe("clinica-7 · el superadmin no abre historias, por ningún camino", () => {
  // La misma 404 que una ruta que no existe, carácter por carácter. Un 403
  // le confirmaría que ahí hay una historia.
  const la404 = (method: string, url: string) => ({
    statusCode: 404,
    error: "Not Found",
    message: `Route ${method}:${url} not found`,
  });

  it("ni leyendo la historia", async () => {
    entradas.push({
      id: randomUUID(),
      tenantId: TENANT,
      clientId: PACIENTE,
      authorUserId: SANITARIA,
      appointmentId: null,
      kind: "NOTE",
      body: { texto: "SECRETO-DE-CARMEN" },
      bodyCifrado: null,
      createdAt: new Date(),
    });
    const app = await buildApp();
    const url = `/clinica/clients/${PACIENTE}/entries`;
    const res = await app.inject({ method: "GET", url, headers: comoMiPiace });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual(la404("GET", url));
    expect(res.body).not.toContain("SECRETO-DE-CARMEN");
    await app.close();
  });

  it("ni escribiendo en ella", async () => {
    const app = await buildApp();
    const url = `/clinica/clients/${PACIENTE}/entries`;
    const res = await app.inject({
      method: "POST",
      url,
      headers: comoMiPiace,
      payload: { body: { texto: "x" } },
    });
    expect(res.statusCode).toBe(404);
    expect(entradas).toHaveLength(0);
    await app.close();
  });

  it("ni mirando QUIÉN la ha abierto", async () => {
    const app = await buildApp();
    const url = `/clinica/clients/${PACIENTE}/accesos`;
    const res = await app.inject({ method: "GET", url, headers: comoMiPiace });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("ni leyendo el contrato de encargado", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/clinica/contrato",
      headers: comoMiPiace,
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual(la404("GET", "/clinica/contrato"));
    await app.close();
  });

  it("y SOBRE TODO: NO ACEPTA EL CONTRATO en nombre de la dueña", async () => {
    // El peor de todos, y el que hace que esto tenga que ser código. El
    // token de impersonación lleva `sub: owner.id`, así que una aceptación
    // desde aquí escribiría una fila que dice «Rosario aceptó el
    // 14 de octubre» — y esa fila es la prueba jurídica de que la clínica
    // autorizó a Mi Piace a tratar datos de salud.
    //
    // Una prueba que Mi Piace se puede firmar a sí misma no es una prueba.
    contrato.vaciar();
    olvidarEstado();
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/clinica/contrato/aceptar",
      headers: comoMiPiace,
      payload: {},
    });
    expect(res.statusCode).toBe(404);
    expect(contrato.filas).toHaveLength(0);
    await app.close();
  });

  it("ni lo revoca", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/clinica/contrato/revocar",
      headers: comoMiPiace,
    });
    expect(res.statusCode).toBe(404);
    // La aceptación de la dueña sigue viva, sin una revocación.
    expect(contrato.filas).toHaveLength(1);
    await app.close();
  });

  it("ni se lleva la exportación del centro", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/clinica/exportacion",
      headers: comoMiPiace,
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("y el intento NO deja una línea FALSA en el registro de accesos", async () => {
    // El registro contesta «¿quién ha abierto la historia de este
    // paciente?» y su `user_id` es NOT NULL. Una línea aquí tendría que
    // decir «la dueña» —porque el token lleva su id— y eso sería una línea
    // falsa en el registro que existe para no tener líneas falsas. Lo que
    // queda es `super_admin_audit`.
    const app = await buildApp();
    await app.inject({
      method: "GET",
      url: `/clinica/clients/${PACIENTE}/entries`,
      headers: comoMiPiace,
    });
    expect(registro).toHaveLength(0);
    await app.close();
  });

  it("la dueña DE VERDAD sí entra: el corte es la impersonación, no el rol", async () => {
    // El control es «¿es Mi Piace?», no «¿es OWNER?». Si cortara por rol,
    // la dueña se quedaría sin su propia historia clínica.
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/clinica/clients/${PACIENTE}/entries`,
      headers: comoDuena,
    });
    expect(res.statusCode).toBe(200);
    await app.close();
  });
});

// ── 5 · LA SECCIÓN DEL PANEL ────────────────────────────────────────

describe("clinica-7 · lo que la sección del panel enseña", () => {
  it("la versión vigente, quién la aceptó y cuándo, y si está revocada", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/clinica/contrato",
      headers: comoDuena,
    });
    const v = res.json();
    expect(v.versionVigente).toBe(VERSION_VIGENTE);
    expect(v.estado).toEqual({ estado: "VIGENTE", versionAceptada: VERSION_VIGENTE });
    expect(v.aceptaciones).toHaveLength(1);
    expect(v.aceptaciones[0]).toMatchObject({
      version: VERSION_VIGENTE,
      huella: contrato.huella,
      revocado: false,
      textoDisponible: true,
    });
    expect(v.puedeAceptar).toBe(true);
    await app.close();
  });

  it("LAS REVOCACIONES NO SALEN COMO FILAS PROPIAS: marcan su aceptación", async () => {
    // Dos líneas por el mismo contrato se leerían como dos contratos. Es
    // la decisión 5 de clinica-4 con los consentimientos, aplicada igual.
    contrato.revocar();
    olvidarEstado();
    const app = await buildApp();
    const v = (
      await app.inject({
        method: "GET",
        url: "/clinica/contrato",
        headers: comoDuena,
      })
    ).json();
    expect(v.aceptaciones).toHaveLength(1);
    expect(v.aceptaciones[0].revocado).toBe(true);
    expect(v.aceptaciones[0].revocadoEn).not.toBeNull();
    expect(v.estado.estado).toBe("SOLO_LECTURA");
    expect(v.estado.motivo).toBe("REVOCADO");
    await app.close();
  });

  it("el PDF de la versión se baja SIEMPRE, también revocado", async () => {
    contrato.revocar();
    olvidarEstado();
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/clinica/contrato/${VERSION_VIGENTE}.pdf`,
      headers: comoDuena,
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("application/pdf");
    expect(res.rawPayload.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    await app.close();
  });

  it("y de una versión que este despliegue no conoce, 404 y no «la de ahora»", async () => {
    // Enseñar una aceptación con el texto vigente sería afirmar que la
    // dueña aceptó un texto que no existía.
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/clinica/contrato/99.pdf",
      headers: comoDuena,
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("VERSION_DESCONOCIDA");
    await app.close();
  });

  it("con el módulo APAGADO, la ruta del contrato NO EXISTE", async () => {
    // Un bar no destapa que este módulo existe.
    clinicaEncendida = false;
    olvidarEstado();
    olvidarSiEsClinico();
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/clinica/contrato",
      headers: comoDuena,
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({
      statusCode: 404,
      error: "Not Found",
      message: "Route GET:/clinica/contrato not found",
    });
    await app.close();
  });
});
