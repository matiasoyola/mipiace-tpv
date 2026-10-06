// clinica-2 · las rutas de la valoración, con Prisma en memoria.
//
// Lo que se prueba aquí es lo que decide la APLICACIÓN. Lo que decide el
// MOTOR (que lo contestado no se edita, que una corrección no se borra,
// que una validada se congela, que no hay dos valoraciones abiertas) lo
// prueba `clinica-valoracion.e2e.ts` contra Postgres de verdad, porque eso
// es justo lo que un fake no puede probar.
//
// Las garantías de este fichero, una por bloque, y son las que el prompt
// del bloque pide:
//
//   1. Con el módulo apagado, las rutas contestan 404 — también la
//      pública, que no puede usar el gate porque no tiene sesión.
//   2. EL ENLACE: caduca, no se reutiliza, y la misma 404 para los tres
//      motivos.
//   3. LA RUTA PÚBLICA NO DEVUELVE RESPUESTAS. Ni las de ahora ni las de
//      antes.
//   4. EL EMAIL NO LLEVA NINGUNA PALABRA DEL CUESTIONARIO. Y el guardián
//      se construye desde el cuestionario, no desde una lista a mano.
//   5. LA RECEPCIONISTA abre la tablet y manda el test, pero al leer las
//      respuestas recibe 403 — Y QUEDA EN EL REGISTRO.
//   6. EL PACIENTE POR ENLACE deja línea `WRITE` con el actor de sistema.
//   7. Validar y corregir: el servidor no se fía del front.

import { randomBytes, randomUUID } from "node:crypto";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.REDIS_URL = "redis://localhost:6379";
process.env.JWT_ACCESS_SECRET = "a".repeat(40);
process.env.JWT_REFRESH_SECRET = "b".repeat(40);
process.env.HOLDED_KEY_ENCRYPTION_SECRET = randomBytes(32).toString("base64");
process.env.PUBLIC_TPV_URL = "https://mipiacetpv.com";

import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CUESTIONARIO_V1 } from "@mipiacetpv/clinica-valoracion";

const TENANT_ID = "00000000-0000-0000-0000-000000000001";
const DUENA_ID = "11111111-1111-1111-1111-111111111111";
const SANITARIA_ID = "22222222-2222-2222-2222-222222222222";
const RECEPCION_ID = "33333333-3333-3333-3333-333333333333";
const PACIENTE_ID = "44444444-4444-4444-4444-444444444444";

// ── Prisma en memoria ────────────────────────────────────────────────

let clinicaEncendida = true;

interface FakeUser {
  id: string;
  tenantId: string;
  role: "OWNER" | "MANAGER" | "CASHIER" | "CLINICIAN";
  isClinician: boolean;
  clinicalScope: "ALL" | "SELECTION";
  alias: string | null;
  email: string;
  deletedAt: Date | null;
  isSystemActor: boolean;
  clinicianLicense: string | null;
  passwordHash: string | null;
  pinHash: string | null;
}
const users = new Map<string, FakeUser>();

interface FakeAssessment {
  id: string;
  tenantId: string;
  clientId: string;
  appointmentId: string | null;
  questionnaireVersion: number;
  status: "PENDIENTE_PACIENTE" | "RESPONDIDA" | "VALIDADA";
  channel: "EMAIL" | "TABLET";
  source: "APPOINTMENT" | "MANUAL";
  requestedByUserId: string | null;
  createdAt: Date;
  linkTokenHash: string | null;
  linkExpiresAt: Date | null;
  linkUsedAt: Date | null;
  entryId: string | null;
  answeredAt: Date | null;
  answeredBy: "PACIENTE" | "FAMILIAR" | null;
  confirmedAllergies: boolean;
  confirmedMedication: boolean;
  confirmedAlerts: boolean;
  validatedAt: Date | null;
  validatedByUserId: string | null;
}
const valoraciones: FakeAssessment[] = [];

interface FakeCorrection {
  id: string;
  tenantId: string;
  assessmentId: string;
  questionId: string;
  value: "SI" | "NO" | "NO_SE";
  authorUserId: string;
  createdAt: Date;
}
const correcciones: FakeCorrection[] = [];

interface FakeEntry {
  id: string;
  tenantId: string;
  clientId: string;
  authorUserId: string;
  appointmentId: string | null;
  kind: string;
  body: unknown;
  createdAt: Date;
}
const entradas: FakeEntry[] = [];

interface FakeLog {
  id: string;
  tenantId: string;
  userId: string;
  clientId: string;
  action: string;
  outcome: string;
  at: Date;
  deviceId: string | null;
  route: string | null;
}
const registro: FakeLog[] = [];

const accesos: Array<{
  tenantId: string;
  clinicianUserId: string;
  clientId: string;
  revokedAt: Date | null;
}> = [];

const clientes = new Map<
  string,
  { id: string; tenantId: string; firstName: string; lastName: string; email: string | null }
>();

function usuarioVista(id: string) {
  const u = users.get(id);
  return {
    id,
    alias: u?.alias ?? null,
    email: u?.email ?? "x@x.com",
    clinicianLicense: u?.clinicianLicense ?? null,
  };
}

function conRelaciones(a: FakeAssessment) {
  return {
    ...a,
    requestedBy: a.requestedByUserId ? usuarioVista(a.requestedByUserId) : null,
    validatedBy: a.validatedByUserId ? usuarioVista(a.validatedByUserId) : null,
  };
}

function coincide(a: FakeAssessment, where: Record<string, unknown>): boolean {
  if (where.id != null && a.id !== where.id) return false;
  if (where.tenantId != null && a.tenantId !== where.tenantId) return false;
  if (where.clientId != null && a.clientId !== where.clientId) return false;
  if (where.linkTokenHash != null && a.linkTokenHash !== where.linkTokenHash) {
    return false;
  }
  const st = where.status as
    | string
    | { not?: string; in?: string[] }
    | undefined;
  if (typeof st === "string" && a.status !== st) return false;
  if (st && typeof st === "object") {
    if (st.not != null && a.status === st.not) return false;
    if (st.in != null && !st.in.includes(a.status)) return false;
  }
  if ((where.id as { not?: string } | undefined)?.not === a.id) return false;
  return true;
}

let registroRoto = false;

const fakePrisma = {
  $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
    fn(fakePrisma),
  ),
  tenant: {
    findUnique: vi.fn(async () => ({
      clinicalRecordsEnabled: clinicaEncendida,
      name: "Clínica Podológica Demo",
    })),
  },
  user: {
    findFirst: vi.fn(async ({ where }: any) => {
      for (const u of users.values()) {
        if (where.id != null && u.id !== where.id) continue;
        if (where.tenantId != null && u.tenantId !== where.tenantId) continue;
        if (where.email != null && u.email !== where.email) continue;
        if (where.isSystemActor != null && u.isSystemActor !== where.isSystemActor) {
          continue;
        }
        if (where.deletedAt === null && u.deletedAt !== null) continue;
        return u;
      }
      return null;
    }),
    create: vi.fn(async ({ data }: any) => {
      // El CHECK de la base, también aquí: un actor de sistema con
      // credenciales no se puede crear. Si el código las pusiera, el fake
      // lo cantaría igual que Postgres.
      if (data.isSystemActor && (data.passwordHash || data.pinHash)) {
        throw new Error(
          'new row violates check constraint "users_system_actor_no_credentials"',
        );
      }
      const row: FakeUser = {
        id: randomUUID(),
        tenantId: data.tenantId,
        role: data.role,
        isClinician: data.isClinician ?? false,
        clinicalScope: "SELECTION",
        alias: data.alias ?? null,
        email: data.email,
        deletedAt: null,
        isSystemActor: data.isSystemActor ?? false,
        clinicianLicense: null,
        passwordHash: data.passwordHash ?? null,
        pinHash: data.pinHash ?? null,
      };
      users.set(row.id, row);
      return { id: row.id };
    }),
  },
  client: {
    findFirst: vi.fn(async ({ where, select }: any) => {
      const c = clientes.get(where.id);
      if (!c || c.tenantId !== where.tenantId) return null;
      if (select?.email) return c;
      return { id: c.id, firstName: c.firstName };
    }),
  },
  clinicalAccess: {
    findFirst: vi.fn(async ({ where }: any) => {
      const f = accesos.find(
        (a) =>
          a.tenantId === where.tenantId &&
          a.clinicianUserId === where.clinicianUserId &&
          a.clientId === where.clientId &&
          a.revokedAt === null,
      );
      return f ? { id: "acc" } : null;
    }),
  },
  clinicalAccessLog: {
    create: vi.fn(async ({ data }: any) => {
      if (registroRoto) throw new Error("append-only table unavailable");
      const row: FakeLog = {
        id: randomUUID(),
        tenantId: data.tenantId,
        userId: data.userId,
        clientId: data.clientId,
        action: data.action,
        outcome: data.outcome,
        at: new Date(),
        deviceId: data.deviceId ?? null,
        route: data.route ?? null,
      };
      registro.push(row);
      return row;
    }),
  },
  clinicalEntry: {
    create: vi.fn(async ({ data }: any) => {
      const row: FakeEntry = {
        id: randomUUID(),
        tenantId: data.tenantId,
        clientId: data.clientId,
        authorUserId: data.authorUserId,
        appointmentId: data.appointmentId ?? null,
        kind: data.kind ?? "NOTE",
        body: data.body,
        createdAt: new Date(),
      };
      entradas.push(row);
      return { id: row.id };
    }),
    findUnique: vi.fn(async ({ where }: any) => {
      const e = entradas.find((x) => x.id === where.id);
      return e ? { body: e.body } : null;
    }),
  },
  clinicalAssessment: {
    findFirst: vi.fn(async ({ where, orderBy }: any) => {
      let xs = valoraciones.filter((a) => coincide(a, where));
      if (orderBy?.createdAt === "desc") {
        xs = xs.slice().sort((a, b) => +b.createdAt - +a.createdAt);
      }
      return xs[0] ? conRelaciones(xs[0]) : null;
    }),
    findUnique: vi.fn(async ({ where }: any) => {
      const a = valoraciones.find((x) => coincide(x, where));
      if (!a) return null;
      const c = clientes.get(a.clientId)!;
      return {
        ...a,
        client: { firstName: c.firstName },
        tenant: {
          name: "Clínica Podológica Demo",
          clinicalRecordsEnabled: clinicaEncendida,
        },
      };
    }),
    findMany: vi.fn(async ({ where, orderBy }: any) => {
      let xs = valoraciones.filter((a) => coincide(a, where));
      if (orderBy?.createdAt === "desc") {
        xs = xs.slice().sort((a, b) => +b.createdAt - +a.createdAt);
      }
      return xs.map(conRelaciones);
    }),
    create: vi.fn(async ({ data }: any) => {
      // El índice único PARCIAL, también aquí: una sola abierta por
      // paciente. Es lo que hace que el test de «dos envíos no crean dos
      // valoraciones» pruebe algo.
      const yaAbierta = valoraciones.some(
        (a) => a.clientId === data.clientId && a.status !== "VALIDADA",
      );
      if (yaAbierta) {
        throw new Error(
          'duplicate key value violates unique constraint "clinical_assessments_one_open_key"',
        );
      }
      // Y el CHECK del origen.
      const manual = data.source === "MANUAL";
      if (manual !== (data.requestedByUserId != null)) {
        throw new Error(
          'new row violates check constraint "clinical_assessments_source_pedida_por"',
        );
      }
      const row: FakeAssessment = {
        id: randomUUID(),
        tenantId: data.tenantId,
        clientId: data.clientId,
        appointmentId: data.appointmentId ?? null,
        questionnaireVersion: data.questionnaireVersion,
        status: "PENDIENTE_PACIENTE",
        channel: data.channel,
        source: data.source,
        requestedByUserId: data.requestedByUserId ?? null,
        createdAt: new Date(),
        linkTokenHash: data.linkTokenHash ?? null,
        linkExpiresAt: data.linkExpiresAt ?? null,
        linkUsedAt: null,
        entryId: null,
        answeredAt: null,
        answeredBy: null,
        confirmedAllergies: false,
        confirmedMedication: false,
        confirmedAlerts: false,
        validatedAt: null,
        validatedByUserId: null,
      };
      valoraciones.push(row);
      return { id: row.id };
    }),
    update: vi.fn(async ({ where, data }: any) => {
      const a = valoraciones.find((x) => x.id === where.id)!;
      Object.assign(a, data);
      return { id: a.id };
    }),
    updateMany: vi.fn(async ({ where, data }: any) => {
      const xs = valoraciones.filter((a) => coincide(a, where));
      for (const a of xs) Object.assign(a, data);
      return { count: xs.length };
    }),
  },
  clinicalAssessmentCorrection: {
    findMany: vi.fn(async ({ where }: any) =>
      correcciones
        .filter((c) => c.assessmentId === where.assessmentId)
        .slice()
        .sort((a, b) => +a.createdAt - +b.createdAt)
        .map((c) => ({ ...c, author: usuarioVista(c.authorUserId) })),
    ),
    create: vi.fn(async ({ data }: any) => {
      const row: FakeCorrection = {
        id: randomUUID(),
        tenantId: data.tenantId,
        assessmentId: data.assessmentId,
        questionId: data.questionId,
        value: data.value,
        authorUserId: data.authorUserId,
        // +1 ms por fila para que «manda la última» sea determinista en un
        // test que inserta dos en el mismo milisegundo.
        createdAt: new Date(Date.now() + correcciones.length),
      };
      correcciones.push(row);
      return { id: row.id };
    }),
  },
} as const;

// Redis en memoria, sólo lo que usa el rate-limit.
const redisKeys = new Map<string, number>();
const fakeRedis = {
  ttl: async (k: string) => (redisKeys.has(k) ? 3600 : -2),
  get: async (k: string) => (redisKeys.get(k)?.toString() ?? null),
  incr: async (k: string) => {
    const n = (redisKeys.get(k) ?? 0) + 1;
    redisKeys.set(k, n);
    return n;
  },
  expire: async () => 1,
  set: async (k: string) => {
    redisKeys.set(k, 1);
    return "OK";
  },
  del: async (...ks: string[]) => {
    for (const k of ks) redisKeys.delete(k);
    return ks.length;
  },
  decr: async (k: string) => {
    const n = (redisKeys.get(k) ?? 0) - 1;
    redisKeys.set(k, n);
    return n;
  },
};

vi.mock("../src/context.js", () => ({
  getPrisma: () => fakePrisma,
  getRedis: () => fakeRedis,
  shutdown: async () => undefined,
}));

const { registerValoracionRoutes } = await import(
  "../src/clinica/valoracion-routes.js"
);
const { registerValoracionPublicaRoutes } = await import(
  "../src/clinica/valoracion-publica.js"
);
const { signAccessToken } = await import("../src/auth/tokens.js");
const { setEmailSender } = await import("../src/email/sender.js");
const { hashDeToken, nuevoTokenDeEnlace } = await import(
  "../src/clinica/enlace.js"
);

// ── El buzón de los tests ────────────────────────────────────────────

interface Enviado {
  to: string;
  subject: string;
  text: string;
  html?: string;
}
let buzon: Enviado[] = [];
let correoRoto = false;
setEmailSender({
  async send(email) {
    if (correoRoto) throw new Error("SMTP caído");
    buzon.push({
      to: email.to,
      subject: email.subject,
      text: email.text,
      html: email.html,
    });
  },
});

function tokenDe(userId: string, role: FakeUser["role"], tid = TENANT_ID) {
  return signAccessToken({ sub: userId, tid, role });
}
const comoSanitaria = {
  authorization: `Bearer ${tokenDe(SANITARIA_ID, "CLINICIAN")}`,
};
const comoRecepcion = {
  authorization: `Bearer ${tokenDe(RECEPCION_ID, "CASHIER")}`,
};
const comoDuena = { authorization: `Bearer ${tokenDe(DUENA_ID, "OWNER")}` };

async function buildApp() {
  const app = Fastify();
  await registerValoracionRoutes(app);
  await registerValoracionPublicaRoutes(app);
  return app;
}

/** Las palabras de contenido de una frase. Las de cuatro letras o menos
 *  son conectores («que», «los», «con») y saldrían en cualquier texto. */
function palabrasDe(frase: string): string[] {
  return frase
    .toLowerCase()
    .split(/[^\wáéíóúñü]+/)
    .filter((w) => w.length > 4);
}

const TODO_NO = Object.fromEntries(
  CUESTIONARIO_V1.preguntas.map((p) => [p.id, "NO"]),
) as Record<string, "SI" | "NO" | "NO_SE">;

beforeEach(() => {
  clinicaEncendida = true;
  registroRoto = false;
  correoRoto = false;
  buzon = [];
  redisKeys.clear();
  users.clear();
  valoraciones.length = 0;
  correcciones.length = 0;
  entradas.length = 0;
  registro.length = 0;
  accesos.length = 0;
  clientes.clear();

  const base = {
    tenantId: TENANT_ID,
    clinicalScope: "SELECTION" as const,
    deletedAt: null,
    isSystemActor: false,
    clinicianLicense: null,
    passwordHash: null,
    pinHash: null,
  };
  users.set(DUENA_ID, {
    ...base,
    id: DUENA_ID,
    role: "OWNER",
    isClinician: false,
    alias: "Pilar",
    email: "pilar@clinica.es",
  });
  users.set(SANITARIA_ID, {
    ...base,
    id: SANITARIA_ID,
    role: "CLINICIAN",
    isClinician: true,
    clinicalScope: "ALL",
    alias: "Lucía Martín",
    email: "lucia@clinica.es",
    clinicianLicense: "Col. 45-0312",
  });
  users.set(RECEPCION_ID, {
    ...base,
    id: RECEPCION_ID,
    role: "CASHIER",
    isClinician: false,
    alias: "Marta",
    email: "marta@clinica.es",
  });
  clientes.set(PACIENTE_ID, {
    id: PACIENTE_ID,
    tenantId: TENANT_ID,
    firstName: "Carmen",
    lastName: "Rodríguez",
    email: "carmen@ejemplo.es",
  });
});

/** Deja una valoración PENDIENTE con su token, y devuelve el token. */
function conEnlace(opts: { expiraEn?: Date; usada?: boolean } = {}): string {
  const t = nuevoTokenDeEnlace("EMAIL");
  valoraciones.push({
    id: randomUUID(),
    tenantId: TENANT_ID,
    clientId: PACIENTE_ID,
    appointmentId: null,
    questionnaireVersion: 1,
    status: "PENDIENTE_PACIENTE",
    channel: "EMAIL",
    source: "MANUAL",
    requestedByUserId: RECEPCION_ID,
    createdAt: new Date(),
    linkTokenHash: t.hash,
    linkExpiresAt: opts.expiraEn ?? t.expiraEn,
    linkUsedAt: opts.usada ? new Date() : null,
    entryId: null,
    answeredAt: null,
    answeredBy: null,
    confirmedAllergies: false,
    confirmedMedication: false,
    confirmedAlerts: false,
    validatedAt: null,
    validatedByUserId: null,
  });
  return t.token;
}

/** Contesta el test por el enlace. */
async function contestar(
  app: Awaited<ReturnType<typeof buildApp>>,
  token: string,
  respuestas: Record<string, string> = TODO_NO,
  respondioPor: "PACIENTE" | "FAMILIAR" = "PACIENTE",
  detalles?: Record<string, string[]>,
) {
  return app.inject({
    method: "POST",
    url: `/valoracion/${token}`,
    payload: { respuestas, respondioPor, ...(detalles ? { detalles } : {}) },
  });
}

// ── 1 · con el módulo apagado, no existe ─────────────────────────────

describe("clinica-2 · con el módulo apagado las rutas NO EXISTEN", () => {
  it("la del sanitario contesta la 404 de Fastify", async () => {
    clinicaEncendida = false;
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/clinica/clients/${PACIENTE_ID}/valoracion`,
      headers: comoSanitaria,
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().message).toMatch(/^Route GET:.*not found$/);
    await app.close();
  });

  it("y la PÚBLICA también, aunque no pueda usar el gate", async () => {
    // La ruta pública no tiene sesión de la que sacar el tenant, así que no
    // puede llevar `ensureClinicaEnabled`: comprueba la capability ella
    // misma, después de resolver el token. Si no lo hiciera, un tenant al
    // que se le apagó la clínica seguiría sirviendo formularios de salud.
    const token = conEnlace();
    clinicaEncendida = false;
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: `/valoracion/${token}` });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("y no deja ni una línea en el registro: no hubo acceso que apuntar", async () => {
    clinicaEncendida = false;
    const app = await buildApp();
    await app.inject({
      method: "GET",
      url: `/clinica/clients/${PACIENTE_ID}/valoracion`,
      headers: comoSanitaria,
    });
    expect(registro).toHaveLength(0);
    await app.close();
  });
});

// ── 2 · el enlace ────────────────────────────────────────────────────

describe("clinica-2 · EL ENLACE caduca y es de un solo uso", () => {
  it("un enlace vivo abre, y devuelve las TRES cosas y nada más", async () => {
    const token = conEnlace();
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: `/valoracion/${token}` });
    expect(res.statusCode).toBe(200);
    expect(Object.keys(res.json()).sort()).toEqual([
      "canal",
      "clinica",
      "cuestionario",
      "nombrePila",
    ]);
    expect(res.json().nombrePila).toBe("Carmen");
    await app.close();
  });

  it("CADUCADO: no abre", async () => {
    const token = conEnlace({ expiraEn: new Date(Date.now() - 1000) });
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: `/valoracion/${token}` });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("YA USADO: no abre", async () => {
    const token = conEnlace({ usada: true });
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: `/valoracion/${token}` });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("NO SE REUTILIZA: contestar una vez lo sella, y la segunda falla", async () => {
    const token = conEnlace();
    const app = await buildApp();
    const primera = await contestar(app, token);
    expect(primera.statusCode).toBe(201);
    const segunda = await contestar(app, token);
    expect(segunda.statusCode).toBe(404);
    // Y no hay una segunda entrada de historia: el paciente contestó una
    // vez, y la historia dice una vez.
    expect(entradas).toHaveLength(1);
    await app.close();
  });

  it("la 404 es INDISTINGUIBLE entre «no existe», «caducado» y «ya usado»", async () => {
    // Tres respuestas distintas le dicen a un escáner que el token existía,
    // y eso ya es información sobre una persona.
    const app = await buildApp();
    const inventado = await app.inject({
      method: "GET",
      url: `/valoracion/${nuevoTokenDeEnlace("EMAIL").token}`,
    });
    valoraciones.length = 0;
    const caducado = await app.inject({
      method: "GET",
      url: `/valoracion/${conEnlace({ expiraEn: new Date(0) })}`,
    });
    valoraciones.length = 0;
    const usado = await app.inject({
      method: "GET",
      url: `/valoracion/${conEnlace({ usada: true })}`,
    });
    for (const r of [caducado, usado]) {
      expect(r.statusCode).toBe(inventado.statusCode);
      expect(r.json()).toEqual(inventado.json());
    }
    await app.close();
  });

  it("un token con otra forma no gasta una consulta a la base", async () => {
    const app = await buildApp();
    fakePrisma.clinicalAssessment.findUnique.mockClear();
    const res = await app.inject({ method: "GET", url: "/valoracion/corto" });
    expect(res.statusCode).toBe(400); // lo corta el schema (43 exactos)
    expect(fakePrisma.clinicalAssessment.findUnique).not.toHaveBeenCalled();
    await app.close();
  });

  it("EL TOKEN NO SE GUARDA: en la fila está su SHA-256", async () => {
    const token = conEnlace();
    expect(valoraciones[0]!.linkTokenHash).not.toBe(token);
    expect(valoraciones[0]!.linkTokenHash).toBe(hashDeToken(token));
    expect(valoraciones[0]!.linkTokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("y la caducidad es obligatoria si hay token (lo exige la base)", async () => {
    // El CHECK `clinical_assessments_enlace_caduca`. Aquí se fija que el
    // código nunca crea uno sin fecha — el motor lo rechazaría, y un 500
    // de constraint no es una respuesta.
    const app = await buildApp();
    await app.inject({
      method: "POST",
      url: `/clinica/clients/${PACIENTE_ID}/valoracion/enviar`,
      headers: comoRecepcion,
    });
    expect(valoraciones[0]!.linkTokenHash).not.toBeNull();
    expect(valoraciones[0]!.linkExpiresAt).not.toBeNull();
    await app.close();
  });
});

// ── 3 · la ruta pública no devuelve respuestas ───────────────────────

describe("clinica-2 · LA RUTA PÚBLICA NO DEVUELVE RESPUESTAS", () => {
  it("el GET no trae respuestas ni alertas ni ids", async () => {
    const token = conEnlace();
    const app = await buildApp();
    const cuerpo = (await app.inject({
      method: "GET",
      url: `/valoracion/${token}`,
    })).json();
    const texto = JSON.stringify(cuerpo);
    for (const prohibido of [
      "respuestas",
      "alertas",
      "correcciones",
      PACIENTE_ID,
      "Rodríguez",
      "carmen@ejemplo.es",
    ]) {
      expect(texto).not.toContain(prohibido);
    }
    await app.close();
  });

  it("el POST contesta sólo «guardado» y cuántos «No lo sé» quedaron", async () => {
    const token = conEnlace();
    const app = await buildApp();
    const res = await contestar(app, token, {
      ...TODO_NO,
      circ: "NO_SE",
      defen: "NO_SE",
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ ok: true, sinSaber: 2, canal: "EMAIL" });
    await app.close();
  });

  it("y con la valoración YA RESPONDIDA el enlace no enseña lo contestado", async () => {
    // El caso que de verdad importa: la URL ha quedado en un historial
    // compartido o en una captura en un grupo familiar. El que la tiene no
    // puede leer lo que se contestó.
    const token = conEnlace();
    const app = await buildApp();
    await contestar(app, token, { ...TODO_NO, diab: "SI", insul: "SI" });
    const res = await app.inject({ method: "GET", url: `/valoracion/${token}` });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("un test a medias no se guarda, y dice qué falta", async () => {
    const token = conEnlace();
    const app = await buildApp();
    const res = await contestar(app, token, { diab: "NO" });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("FALTAN_RESPUESTAS");
    expect(res.json().faltan).toContain("antic");
    expect(valoraciones[0]!.status).toBe("PENDIENTE_PACIENTE");
    await app.close();
  });

  it("una respuesta a una pregunta que no se hizo NO entra en la historia", async () => {
    const token = conEnlace();
    const app = await buildApp();
    await contestar(app, token, { ...TODO_NO, inventada: "SI", insul: "SI" });
    const cuerpo = entradas[0]!.body as { respuestas: Record<string, string> };
    expect(cuerpo.respuestas).not.toHaveProperty("inventada");
    // `insul` tampoco: la diabetes es «NO», así que el seguimiento no
    // estaba en juego.
    expect(cuerpo.respuestas).not.toHaveProperty("insul");
    await app.close();
  });

  it("un detalle de alergia inventado se tira: la franja de alertas no la escribe un desconocido", async () => {
    const token = conEnlace();
    const app = await buildApp();
    await contestar(
      app,
      token,
      { ...TODO_NO, aler: "SI" },
      "PACIENTE",
      { aler: ["Látex", "<script>alert(1)</script>"] },
    );
    const cuerpo = entradas[0]!.body as { detalles: Record<string, string[]> };
    expect(cuerpo.detalles.aler).toEqual(["Látex"]);
    await app.close();
  });
});

// ── 4 · el email ─────────────────────────────────────────────────────

describe("clinica-2 · EL EMAIL NO LLEVA NI UNA PALABRA DEL CUESTIONARIO", () => {
  it("lleva clínica, nombre de pila y enlace, y nada más", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/clinica/clients/${PACIENTE_ID}/valoracion/enviar`,
      headers: comoRecepcion,
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().enviado).toBe(true);
    expect(buzon).toHaveLength(1);
    expect(buzon[0]!.to).toBe("carmen@ejemplo.es");
    expect(buzon[0]!.text).toContain("Clínica Podológica Demo");
    expect(buzon[0]!.text).toContain("Carmen");
    expect(buzon[0]!.text).toMatch(
      /https:\/\/mipiacetpv\.com\/valoracion\/[A-Za-z0-9_-]{43}/,
    );
    await app.close();
  });

  it("NI UNA PALABRA de ninguna pregunta, ayuda, alerta u opción", async () => {
    // El guardián se construye DESDE EL CUESTIONARIO y no desde una lista
    // escrita a mano: así, el día que se añada una pregunta, ya la cubre.
    const app = await buildApp();
    await app.inject({
      method: "POST",
      url: `/clinica/clients/${PACIENTE_ID}/valoracion/enviar`,
      headers: comoRecepcion,
    });
    // Se comparan PALABRAS CON PALABRAS y no subcadenas: con `includes`,
    // «lleva» (de «¿Lleva marcapasos?») casaba dentro de «le llevará unos
    // tres minutos» y el guardián cantaba un falso positivo. Tokenizar los
    // dos lados igual lo deja estricto y sin ruido.
    const enElCorreo = new Set(
      palabrasDe(
        `${buzon[0]!.subject}\n${buzon[0]!.text}\n${buzon[0]!.html}`,
      ),
    );

    const palabras = new Set<string>();
    const meter = (frase: string) => {
      for (const w of palabrasDe(frase)) palabras.add(w);
    };
    for (const p of CUESTIONARIO_V1.preguntas) {
      meter(p.texto);
      meter(p.ayuda);
      if (p.alerta) meter(p.alerta);
      meter(p.corto);
      for (const o of p.opciones ?? []) meter(o);
      if (p.seguimiento) {
        meter(p.seguimiento.texto);
        meter(p.seguimiento.ayuda);
        if (p.seguimiento.alerta) meter(p.seguimiento.alerta);
      }
    }
    // Las que el email SÍ puede llevar porque no dicen nada de salud: son
    // palabras del castellano que salen en una pregunta por casualidad y
    // que un correo de cortesía usa igual. La lista es CORTA a propósito:
    // cada una que se añada es una palabra que el guardián deja de vigilar,
    // así que sólo entran las que de verdad no informan de nada.
    for (const inocente of ["puede", "también", "seguro"]) {
      palabras.delete(inocente);
    }
    const filtradas = [...palabras];
    // Que el guardián vigile de verdad: si el cuestionario cambiara a algo
    // sin palabras largas, este test pasaría en verde sin comprobar nada.
    expect(filtradas.length).toBeGreaterThan(30);

    const encontradas = filtradas.filter((w) => enElCorreo.has(w));
    expect(encontradas).toEqual([]);
    await app.close();
  });

  it("y no lleva el apellido, ni el teléfono, ni el id del paciente", async () => {
    const app = await buildApp();
    await app.inject({
      method: "POST",
      url: `/clinica/clients/${PACIENTE_ID}/valoracion/enviar`,
      headers: comoRecepcion,
    });
    const correo = `${buzon[0]!.subject}\n${buzon[0]!.text}\n${buzon[0]!.html}`;
    expect(correo).not.toContain("Rodríguez");
    expect(correo).not.toContain(PACIENTE_ID);
    await app.close();
  });

  it("DOS ENVÍOS no crean dos valoraciones: la segunda rota el enlace", async () => {
    const app = await buildApp();
    const uno = await app.inject({
      method: "POST",
      url: `/clinica/clients/${PACIENTE_ID}/valoracion/enviar`,
      headers: comoRecepcion,
    });
    const hash1 = valoraciones[0]!.linkTokenHash;
    const dos = await app.inject({
      method: "POST",
      url: `/clinica/clients/${PACIENTE_ID}/valoracion/enviar`,
      headers: comoRecepcion,
    });
    expect(uno.statusCode).toBe(201);
    expect(dos.statusCode).toBe(200); // ya existía
    expect(valoraciones).toHaveLength(1);
    // El enlace anterior deja de valer: otro hash.
    expect(valoraciones[0]!.linkTokenHash).not.toBe(hash1);
    expect(buzon).toHaveLength(2);
    await app.close();
  });

  it("el enlace VIEJO deja de abrir en cuanto se reenvía", async () => {
    const app = await buildApp();
    await app.inject({
      method: "POST",
      url: `/clinica/clients/${PACIENTE_ID}/valoracion/enviar`,
      headers: comoRecepcion,
    });
    const viejo = buzon[0]!.text.match(/valoracion\/([A-Za-z0-9_-]{43})/)![1]!;
    await app.inject({
      method: "POST",
      url: `/clinica/clients/${PACIENTE_ID}/valoracion/enviar`,
      headers: comoRecepcion,
    });
    const res = await app.inject({ method: "GET", url: `/valoracion/${viejo}` });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("si el SMTP falla, LA VALORACIÓN QUEDA CREADA con su enlace", async () => {
    // Un servidor de correo caído no puede dejar a un paciente sin
    // valoración: la podóloga reenvía o le da la tablet.
    correoRoto = true;
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/clinica/clients/${PACIENTE_ID}/valoracion/enviar`,
      headers: comoRecepcion,
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      enviado: false,
      motivoNoEnviado: "FALLO_DEL_CORREO",
    });
    expect(valoraciones).toHaveLength(1);
    expect(valoraciones[0]!.linkTokenHash).not.toBeNull();
    await app.close();
  });

  it("un paciente sin email no es un error: se dice, y la pantalla ofrece la tablet", async () => {
    clientes.get(PACIENTE_ID)!.email = null;
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/clinica/clients/${PACIENTE_ID}/valoracion/enviar`,
      headers: comoRecepcion,
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      enviado: false,
      motivoNoEnviado: "SIN_EMAIL",
    });
    expect(buzon).toHaveLength(0);
    await app.close();
  });
});

// ── 5 · la recepcionista ─────────────────────────────────────────────

describe("clinica-2 · LA RECEPCIONISTA manda el test y abre la tablet, pero NO LEE", () => {
  it("manda el test: 201, y queda su línea WRITE en el registro", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/clinica/clients/${PACIENTE_ID}/valoracion/enviar`,
      headers: comoRecepcion,
    });
    expect(res.statusCode).toBe(201);
    expect(registro).toHaveLength(1);
    expect(registro[0]).toMatchObject({
      userId: RECEPCION_ID,
      action: "WRITE",
      outcome: "ALLOWED",
      route: "POST /clinica/clients/" + PACIENTE_ID + "/valoracion/enviar",
    });
    await app.close();
  });

  it("abre la tablet: 200 con el token, y queda su línea", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/clinica/clients/${PACIENTE_ID}/valoracion/tablet`,
      headers: comoRecepcion,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(res.json().nombrePila).toBe("Carmen");
    expect(registro).toHaveLength(1);
    expect(registro[0]).toMatchObject({
      userId: RECEPCION_ID,
      action: "WRITE",
      outcome: "ALLOWED",
    });
    await app.close();
  });

  it("y la tablet caduca en 4 horas, no en 30 días", async () => {
    const app = await buildApp();
    await app.inject({
      method: "POST",
      url: `/clinica/clients/${PACIENTE_ID}/valoracion/tablet`,
      headers: comoRecepcion,
    });
    const horas =
      (valoraciones[0]!.linkExpiresAt!.getTime() - Date.now()) / 3_600_000;
    expect(horas).toBeGreaterThan(3.9);
    expect(horas).toBeLessThan(4.1);
    await app.close();
  });

  it("PERO AL LEER LAS RESPUESTAS: 403, y QUEDA EN EL REGISTRO como DENIED", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/clinica/clients/${PACIENTE_ID}/valoracion`,
      headers: comoRecepcion,
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("NO_SANITARIO");
    expect(registro).toHaveLength(1);
    expect(registro[0]).toMatchObject({
      userId: RECEPCION_ID,
      action: "READ",
      outcome: "DENIED",
    });
    await app.close();
  });

  it("ni corregir, ni validar", async () => {
    const app = await buildApp();
    for (const [url, payload] of [
      [
        `/clinica/clients/${PACIENTE_ID}/valoracion/correcciones`,
        { preguntaId: "diab", valor: "SI" },
      ],
      [
        `/clinica/clients/${PACIENTE_ID}/valoracion/validar`,
        { confirmaciones: { alergias: true, medicacion: true, alertas: true } },
      ],
    ] as const) {
      const res = await app.inject({
        method: "POST",
        url,
        payload,
        headers: comoRecepcion,
      });
      expect(res.statusCode).toBe(403);
    }
    expect(registro.filter((r) => r.outcome === "DENIED")).toHaveLength(2);
    await app.close();
  });

  it("LA DUEÑA NO SANITARIA tampoco lee: administra, no trata", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/clinica/clients/${PACIENTE_ID}/valoracion`,
      headers: comoDuena,
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it("la sanitaria SIN ACCESO a ese paciente tampoco, y queda escrito", async () => {
    users.get(SANITARIA_ID)!.clinicalScope = "SELECTION";
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/clinica/clients/${PACIENTE_ID}/valoracion`,
      headers: comoSanitaria,
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("SIN_ACCESO_AL_PACIENTE");
    expect(registro[0]).toMatchObject({ outcome: "DENIED" });
    await app.close();
  });
});

// ── 6 · el paciente por enlace deja línea ────────────────────────────

describe("clinica-2 · EL PACIENTE POR ENLACE deja línea WRITE", () => {
  it("contestar deja una línea WRITE con el actor «paciente por enlace»", async () => {
    const token = conEnlace();
    const app = await buildApp();
    await contestar(app, token);
    expect(registro).toHaveLength(1);
    expect(registro[0]).toMatchObject({
      clientId: PACIENTE_ID,
      action: "WRITE",
      outcome: "ALLOWED",
      route: "POST /valoracion/:token",
      deviceId: null,
    });
    const actor = users.get(registro[0]!.userId)!;
    expect(actor.isSystemActor).toBe(true);
    expect(actor.alias).toBe("Paciente (por enlace)");
    await app.close();
  });

  it("el actor NO PUEDE AUTENTICARSE: nace sin password y sin PIN", async () => {
    const token = conEnlace();
    const app = await buildApp();
    await contestar(app, token);
    const actor = [...users.values()].find((u) => u.isSystemActor)!;
    expect(actor.passwordHash).toBeNull();
    expect(actor.pinHash).toBeNull();
    // Sin password no hay login de panel; sin PIN no hay login de TPV. Y el
    // CHECK `users_system_actor_no_credentials` lo impide desde la base.
    await app.close();
  });

  it("el autor de la ENTRADA DE HISTORIA es el paciente, no el personal", async () => {
    const token = conEnlace();
    const app = await buildApp();
    await contestar(app, token);
    expect(entradas).toHaveLength(1);
    expect(entradas[0]!.kind).toBe("INITIAL_ASSESSMENT");
    expect(users.get(entradas[0]!.authorUserId)!.isSystemActor).toBe(true);
    await app.close();
  });

  it("se reutiliza el MISMO actor en el segundo paciente del tenant", async () => {
    const otro = "55555555-5555-5555-5555-555555555555";
    clientes.set(otro, {
      id: otro,
      tenantId: TENANT_ID,
      firstName: "Antonio",
      lastName: "Gil",
      email: null,
    });
    const app = await buildApp();
    await contestar(app, conEnlace());
    valoraciones[0]!.clientId = otro; // un enlace del otro paciente
    valoraciones.length = 0;
    const t2 = nuevoTokenDeEnlace("EMAIL");
    valoraciones.push({
      ...({} as FakeAssessment),
      id: randomUUID(),
      tenantId: TENANT_ID,
      clientId: otro,
      appointmentId: null,
      questionnaireVersion: 1,
      status: "PENDIENTE_PACIENTE",
      channel: "EMAIL",
      source: "MANUAL",
      requestedByUserId: RECEPCION_ID,
      createdAt: new Date(),
      linkTokenHash: t2.hash,
      linkExpiresAt: t2.expiraEn,
      linkUsedAt: null,
      entryId: null,
      answeredAt: null,
      answeredBy: null,
      confirmedAllergies: false,
      confirmedMedication: false,
      confirmedAlerts: false,
      validatedAt: null,
      validatedByUserId: null,
    });
    await contestar(app, t2.token);
    expect([...users.values()].filter((u) => u.isSystemActor)).toHaveLength(1);
    await app.close();
  });

  it("SI LA LÍNEA NO SE PUEDE ESCRIBIR, NO SE GUARDAN LAS RESPUESTAS", async () => {
    // La misma decisión que `conHistoria`: trazabilidad por encima de
    // disponibilidad. Nadie pierde nada si la respuesta no se guarda; lo
    // que no se puede perder es la prueba de que ocurrió.
    registroRoto = true;
    const token = conEnlace();
    const app = await buildApp();
    const res = await contestar(app, token);
    expect(res.statusCode).toBe(500);
    expect(res.json().code).toBe("CLINICAL_ACCESS_LOG_FAILED");
    expect(entradas).toHaveLength(0);
    expect(valoraciones[0]!.status).toBe("PENDIENTE_PACIENTE");
    await app.close();
  });

  it("y el mensaje de ese 500 no menciona ni una pregunta", async () => {
    registroRoto = true;
    const app = await buildApp();
    const res = await contestar(app, conEnlace());
    expect(res.json().message).not.toMatch(/diabetes|alerg|anticoagul/i);
    await app.close();
  });
});

// ── 7 · corregir y validar ───────────────────────────────────────────

describe("clinica-2 · corregir y validar, y el servidor no se fía del front", () => {
  async function conRespondida(app: Awaited<ReturnType<typeof buildApp>>) {
    const token = conEnlace();
    await contestar(app, token, { ...TODO_NO, circ: "NO_SE" }, "FAMILIAR");
    registro.length = 0;
    return valoraciones[0]!;
  }

  it("la pantalla trae alertas, el motivo del botón y la puerta del tratamiento", async () => {
    const app = await buildApp();
    await conRespondida(app);
    const res = await app.inject({
      method: "GET",
      url: `/clinica/clients/${PACIENTE_ID}/valoracion`,
      headers: comoSanitaria,
    });
    expect(res.statusCode).toBe(200);
    const v = res.json();
    expect(v.valoracion.estado).toBe("RESPONDIDA");
    expect(v.valoracion.respondioPor).toBe("FAMILIAR");
    expect(v.alertas.sinResolver).toEqual(["circ"]);
    expect(v.validable).toMatchObject({ puede: false, motivo: "SIN_RESOLVER" });
    expect(v.primerTratamiento).toMatchObject({
      puede: false,
      motivo: "VALORACION_SIN_VALIDAR",
    });
    expect(Object.keys(v.textosConfirmacion).sort()).toEqual([
      "alergias",
      "alertas",
      "medicacion",
    ]);
    await app.close();
  });

  it("la pantalla NO devuelve el token del enlace, sólo si hay uno vivo", async () => {
    const app = await buildApp();
    await app.inject({
      method: "POST",
      url: `/clinica/clients/${PACIENTE_ID}/valoracion/enviar`,
      headers: comoRecepcion,
    });
    const res = await app.inject({
      method: "GET",
      url: `/clinica/clients/${PACIENTE_ID}/valoracion`,
      headers: comoSanitaria,
    });
    const texto = JSON.stringify(res.json());
    expect(texto).not.toContain(valoraciones[0]!.linkTokenHash);
    expect(res.json().valoracion.enlace).toMatchObject({ activo: true });
    await app.close();
  });

  it("VALIDAR CON UN «No lo sé» SIN RESOLVER: 409, aunque el front lo pida", async () => {
    const app = await buildApp();
    await conRespondida(app);
    const res = await app.inject({
      method: "POST",
      url: `/clinica/clients/${PACIENTE_ID}/valoracion/validar`,
      headers: comoSanitaria,
      payload: {
        confirmaciones: { alergias: true, medicacion: true, alertas: true },
      },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("SIN_RESOLVER");
    expect(valoraciones[0]!.status).toBe("RESPONDIDA");
    await app.close();
  });

  it("VALIDAR SIN LAS TRES CONFIRMACIONES: 409", async () => {
    const app = await buildApp();
    const v = await conRespondida(app);
    v.status = "RESPONDIDA";
    correcciones.push({
      id: randomUUID(),
      tenantId: TENANT_ID,
      assessmentId: v.id,
      questionId: "circ",
      value: "NO",
      authorUserId: SANITARIA_ID,
      createdAt: new Date(),
    });
    const res = await app.inject({
      method: "POST",
      url: `/clinica/clients/${PACIENTE_ID}/valoracion/validar`,
      headers: comoSanitaria,
      payload: {
        confirmaciones: { alergias: true, medicacion: false, alertas: true },
      },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("FALTAN_CONFIRMACIONES");
    await app.close();
  });

  it("corregir el «No lo sé» y validar: la firma queda con autora y colegiado", async () => {
    const app = await buildApp();
    await conRespondida(app);
    const corregida = await app.inject({
      method: "POST",
      url: `/clinica/clients/${PACIENTE_ID}/valoracion/correcciones`,
      headers: comoSanitaria,
      payload: { preguntaId: "circ", valor: "SI" },
    });
    expect(corregida.statusCode).toBe(201);
    // La respuesta de corregir es LA VISTA ENTERA: la alerta nueva ya está.
    expect(corregida.json().alertas.alertas).toEqual([
      { preguntaId: "circ", texto: "Mala circulación", deCorreccion: true },
    ]);
    // `validable` contesta «lo demás está listo»: las tres casillas las
    // marca la pantalla en memoria y viajan con la validación.
    expect(corregida.json().validable).toEqual({ puede: true });

    const validada = await app.inject({
      method: "POST",
      url: `/clinica/clients/${PACIENTE_ID}/valoracion/validar`,
      headers: comoSanitaria,
      payload: {
        confirmaciones: { alergias: true, medicacion: true, alertas: true },
      },
    });
    expect(validada.statusCode).toBe(200);
    expect(validada.json().valoracion).toMatchObject({
      estado: "VALIDADA",
      validadaPor: { nombre: "Lucía Martín", colegiado: "Col. 45-0312" },
    });
    expect(validada.json().primerTratamiento).toMatchObject({ puede: true });
    await app.close();
  });

  it("LO QUE CONTESTÓ EL PACIENTE SIGUE AHÍ tras la corrección", async () => {
    const app = await buildApp();
    await conRespondida(app);
    await app.inject({
      method: "POST",
      url: `/clinica/clients/${PACIENTE_ID}/valoracion/correcciones`,
      headers: comoSanitaria,
      payload: { preguntaId: "circ", valor: "SI" },
    });
    const res = await app.inject({
      method: "GET",
      url: `/clinica/clients/${PACIENTE_ID}/valoracion`,
      headers: comoSanitaria,
    });
    // La del paciente, intacta…
    expect(res.json().respuestasPaciente.circ).toBe("NO_SE");
    // …y la corrección al lado, con su autora.
    expect(res.json().correcciones).toEqual([
      expect.objectContaining({
        preguntaId: "circ",
        valor: "SI",
        autorNombre: "Lucía Martín",
      }),
    ]);
    await app.close();
  });

  it("corregir una pregunta que NO es del cuestionario: 409", async () => {
    const app = await buildApp();
    await conRespondida(app);
    const res = await app.inject({
      method: "POST",
      url: `/clinica/clients/${PACIENTE_ID}/valoracion/correcciones`,
      headers: comoSanitaria,
      payload: { preguntaId: "inventada", valor: "SI" },
    });
    expect(res.statusCode).toBe(409);
    expect(correcciones).toHaveLength(0);
    await app.close();
  });

  it("corregir una PENDIENTE: 409. El paciente contesta; el sanitario corrige", async () => {
    conEnlace();
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/clinica/clients/${PACIENTE_ID}/valoracion/correcciones`,
      headers: comoSanitaria,
      payload: { preguntaId: "diab", valor: "SI" },
    });
    expect(res.statusCode).toBe(409);
    await app.close();
  });

  it("una VALIDADA no se re-valida ni se corrige", async () => {
    const app = await buildApp();
    const v = await conRespondida(app);
    Object.assign(v, {
      status: "VALIDADA",
      validatedAt: new Date(),
      validatedByUserId: SANITARIA_ID,
      confirmedAllergies: true,
      confirmedMedication: true,
      confirmedAlerts: true,
    });
    const revalidar = await app.inject({
      method: "POST",
      url: `/clinica/clients/${PACIENTE_ID}/valoracion/validar`,
      headers: comoSanitaria,
      payload: {
        confirmaciones: { alergias: true, medicacion: true, alertas: true },
      },
    });
    expect(revalidar.statusCode).toBe(409);
    expect(revalidar.json().code).toBe("YA_VALIDADA");
    const corregir = await app.inject({
      method: "POST",
      url: `/clinica/clients/${PACIENTE_ID}/valoracion/correcciones`,
      headers: comoSanitaria,
      payload: { preguntaId: "diab", valor: "SI" },
    });
    expect(corregir.statusCode).toBe(409);
    await app.close();
  });

  it("CADA LECTURA de la pantalla deja su línea READ", async () => {
    const app = await buildApp();
    await conRespondida(app);
    await app.inject({
      method: "GET",
      url: `/clinica/clients/${PACIENTE_ID}/valoracion`,
      headers: comoSanitaria,
    });
    await app.inject({
      method: "GET",
      url: `/clinica/clients/${PACIENTE_ID}/valoracion`,
      headers: comoSanitaria,
    });
    expect(registro.filter((r) => r.action === "READ")).toHaveLength(2);
    await app.close();
  });

  it("un paciente de OTRO tenant es 404 antes de preguntar por el acceso", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/clinica/clients/${randomUUID()}/valoracion`,
      headers: comoSanitaria,
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("CLIENT_NOT_FOUND");
    expect(registro).toHaveLength(0);
    await app.close();
  });
});
