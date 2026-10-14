// clinica-6 · la historia viva en la API, con Prisma en memoria.
//
// Las garantías de este fichero, una por bloque, y son las que el prompt
// del bloque pide en «cómo se da por hecho»:
//
//   1. **Cada apertura de la historia REGISTRA el acceso.** Que la
//      pantalla nueva no sea una puerta sin registro (decisión 9).
//   2. **Ni un importe en la respuesta**, para NADIE: la dueña ve lo mismo
//      que el sanitario sin caja (decisión 8). Se comprueba recorriendo el
//      JSON entero y comparando las dos respuestas.
//   3. **Una historia MEZCLADA v1 + v2 se lee entera**, y la v1 sale como
//      «Sesión», sin tipo y sin fingirlo.
//   4. **El estado de cada zona** sale calculado por la ruta, incluida la
//      que no se vuelve a explorar.
//   5. **«Hoy toca»** sale de la última sesión cerrada: sin pendientes,
//      con varios, y el más antiguo delante.
//   6. **Módulo apagado → 404**, la de Fastify carácter por carácter.
//   7. **El paciente de otro tenant no existe**, y una visita de otro
//      paciente tampoco.

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

const TENANT_ID = "00000000-0000-0000-0000-000000000001";
const OTRO_TENANT = "00000000-0000-0000-0000-000000000002";
const DUENA_ID = "11111111-1111-1111-1111-111111111111";
const SANITARIA_ID = "22222222-2222-2222-2222-222222222222";
const RECEPCION_ID = "33333333-3333-3333-3333-333333333333";
const PACIENTE_ID = "44444444-4444-4444-4444-444444444444";
const OTRA_PACIENTE_ID = "44444444-4444-4444-4444-444444444445";
const AJENA_ID = "44444444-4444-4444-4444-444444444446";

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
  clinicianLicense: string | null;
  deletedAt: Date | null;
  isSystemActor: boolean;
}
const users = new Map<string, FakeUser>();

interface FakeEntry {
  id: string;
  tenantId: string;
  clientId: string;
  authorUserId: string;
  appointmentId: string | null;
  kind: string;
  body: Record<string, unknown>;
  createdAt: Date;
}
let entradas: FakeEntry[] = [];

interface FakeAssessment {
  id: string;
  tenantId: string;
  clientId: string;
  status: "PENDIENTE_PACIENTE" | "RESPONDIDA" | "VALIDADA";
  channel: string;
  source: string;
  createdAt: Date;
  entryId: string | null;
  answeredAt: Date | null;
  answeredBy: "PACIENTE" | "FAMILIAR" | null;
  validatedAt: Date | null;
  questionnaireVersion: number;
}
let valoraciones: FakeAssessment[] = [];

interface FakeLog {
  userId: string;
  clientId: string;
  action: string;
  outcome: string;
  route: string | null;
}
let registro: FakeLog[] = [];

let accesos: Array<{ clinicianUserId: string; clientId: string }> = [];

const clientes = new Map<
  string,
  {
    id: string;
    tenantId: string;
    firstName: string;
    lastName: string;
    phone: string | null;
    birthdate: Date | null;
    createdAt: Date;
  }
>();

function entradaCoincide(e: FakeEntry, where: any): boolean {
  if (where.id != null && e.id !== where.id) return false;
  if (where.tenantId != null && e.tenantId !== where.tenantId) return false;
  if (where.clientId != null && e.clientId !== where.clientId) return false;
  if (where.kind != null && e.kind !== where.kind) return false;
  return true;
}

const fakePrisma: any = {
  tenant: {
    findUnique: vi.fn(async () => ({
      clinicalRecordsEnabled: clinicaEncendida,
      cajaEnabled: true,
      name: "Clínica Podológica Demo",
    })),
  },
  user: {
    findFirst: vi.fn(async ({ where }: any) => {
      for (const u of users.values()) {
        if (where.id != null && u.id !== where.id) continue;
        if (where.tenantId != null && u.tenantId !== where.tenantId) continue;
        return u;
      }
      return null;
    }),
    findUnique: vi.fn(async ({ where }: any) => users.get(where.id) ?? null),
  },
  client: {
    findFirst: vi.fn(async ({ where }: any) => {
      const c = clientes.get(where.id);
      return c && c.tenantId === where.tenantId ? c : null;
    }),
    findFirstOrThrow: vi.fn(async ({ where }: any) => {
      const c = clientes.get(where.id);
      if (!c || c.tenantId !== where.tenantId) throw new Error("no existe");
      return c;
    }),
  },
  clinicalAccess: {
    findFirst: vi.fn(async ({ where }: any) =>
      accesos.find(
        (a) =>
          a.clinicianUserId === where.clinicianUserId &&
          a.clientId === where.clientId,
      )
        ? { id: "acc" }
        : null,
    ),
  },
  clinicalAccessLog: {
    create: vi.fn(async ({ data }: any) => {
      registro.push({
        userId: data.userId,
        clientId: data.clientId,
        action: data.action,
        outcome: data.outcome,
        route: data.route ?? null,
      });
      return { id: randomUUID() };
    }),
  },
  clinicalEntry: {
    findUnique: vi.fn(async ({ where }: any) => {
      const e = entradas.find((x) => x.id === where.id);
      return e ? { body: e.body } : null;
    }),
    findFirst: vi.fn(async ({ where, orderBy }: any) => {
      let xs = entradas.filter((e) => entradaCoincide(e, where));
      if (orderBy?.createdAt === "desc") {
        xs = xs.slice().sort((a, b) => +b.createdAt - +a.createdAt);
      }
      const e = xs[0];
      return e ? { ...e, author: usuarioVista(e.authorUserId) } : null;
    }),
    findMany: vi.fn(async ({ where, orderBy, take }: any) => {
      let xs = entradas.filter((e) => entradaCoincide(e, where));
      if (orderBy?.createdAt === "desc") {
        xs = xs.slice().sort((a, b) => +b.createdAt - +a.createdAt);
      }
      if (take != null) xs = xs.slice(0, take);
      return xs.map((e) => ({ ...e, author: usuarioVista(e.authorUserId) }));
    }),
    count: vi.fn(
      async ({ where }: any) =>
        entradas.filter((e) => entradaCoincide(e, where)).length,
    ),
  },
  clinicalAssessment: {
    findMany: vi.fn(async ({ where }: any) =>
      valoraciones.filter(
        (v) =>
          v.tenantId === where.tenantId &&
          (where.clientId == null || v.clientId === where.clientId) &&
          (where.id?.not == null || v.id !== where.id.not),
      ),
    ),
    findFirst: vi.fn(async ({ where }: any) => {
      let xs = valoraciones.filter(
        (v) => v.tenantId === where.tenantId && v.clientId === where.clientId,
      );
      // El `status: { not: "VALIDADA" }` de `cargarValoracionAbierta`. Sin
      // él, el test no podría tener una validada y un repaso a la vez.
      if (where.status?.not != null) {
        xs = xs.filter((v) => v.status !== where.status.not);
      }
      const v = xs.slice().sort((a, b) => +b.createdAt - +a.createdAt)[0];
      return v ? { ...v, requestedBy: null, validatedBy: null } : null;
    }),
  },
  clinicalAssessmentCorrection: {
    findMany: vi.fn(async () => []),
  },
  publicLink: {
    findFirst: vi.fn(async () => null),
  },
  // clinica-4 · la historia viva enseña ahora los consentimientos
  // firmados, las fotos y las entregas de informes. Este fichero es el de
  // clinica-6 y lo que vigila es lo suyo (el registro, los importes, la
  // historia mezclada), así que los tres llegan VACÍOS: lo que tienen que
  // hacer aquí es no romper la pantalla cuando el paciente no tiene
  // ninguno — que es el caso de todos los pacientes el primer día.
  clientConsent: {
    findMany: vi.fn(async () => []),
    findFirst: vi.fn(async () => null),
  },
  clinicalPhoto: {
    findMany: vi.fn(async () => []),
    findFirst: vi.fn(async () => null),
  },
  clinicalReportDelivery: {
    findMany: vi.fn(async () => []),
  },
  serviceScheduling: {
    findMany: vi.fn(async () => []),
  },
};

function usuarioVista(id: string) {
  const u = users.get(id);
  return {
    id,
    alias: u?.alias ?? null,
    email: u?.email ?? "x@x.com",
    clinicianLicense: u?.clinicianLicense ?? null,
  };
}

vi.mock("../src/context.js", () => ({
  initContext: vi.fn(),
  getPrisma: () => fakePrisma,
  getRedis: () => ({}),
  closeContext: vi.fn(),
  shutdown: vi.fn(),
}));

const { registerHistoriaRoutes } = await import(
  "../src/clinica/historia-routes.js"
);
const { signAccessToken } = await import("../src/auth/tokens.js");
const { VISITAS_DE_LA_HISTORIA } = await import("../src/clinica/historia.js");

function tokenDe(userId: string, role: FakeUser["role"]) {
  return signAccessToken({ sub: userId, tid: TENANT_ID, role });
}
const comoSanitaria = {
  authorization: `Bearer ${tokenDe(SANITARIA_ID, "CLINICIAN")}`,
};
const comoDuena = { authorization: `Bearer ${tokenDe(DUENA_ID, "OWNER")}` };
const comoRecepcion = {
  authorization: `Bearer ${tokenDe(RECEPCION_ID, "CASHIER")}`,
};

async function buildApp() {
  const app = Fastify({ logger: false });
  await registerHistoriaRoutes(app);
  await app.ready();
  return app;
}

// ── Los datos de la historia de prueba ───────────────────────────────

let reloj = 0;

/** Una sesión ya cerrada en la historia. `cuerpo` entra tal cual. */
function sesion(
  cuerpo: Record<string, unknown>,
  opciones: { clientId?: string; dia?: number } = {},
): FakeEntry {
  const fila: FakeEntry = {
    id: randomUUID(),
    tenantId: TENANT_ID,
    clientId: opciones.clientId ?? PACIENTE_ID,
    authorUserId: DUENA_ID,
    appointmentId: randomUUID(),
    kind: "TREATMENT_SESSION",
    body: cuerpo,
    createdAt: new Date(
      Date.UTC(2026, 8, opciones.dia ?? ++reloj, 10, 0, 0),
    ),
  };
  entradas.push(fila);
  return fila;
}

const FIRMA = {
  autorNombre: "Lucía Martín",
  colegiado: "Col. 45-0312",
  firmadaEn: "2026-09-07T10:00:00.000Z",
};

/** Una sesión v1, la de clinica-3: sin tipos, con sus tratamientos. */
function sesionV1(dia: number, marcas: Record<string, unknown> = {}) {
  return sesion(
    {
      v: 1,
      mapaVersion: 1,
      lesionesVersion: 1,
      consejosVersion: 1,
      marcas,
      tratamientos: ["s1"],
      tratamientosNombre: { s1: "Deslaminado" },
      dolor: 7,
      evolucion: null,
      consejos: [],
      proximaCita: null,
      nota: null,
      firma: FIRMA,
    },
    { dia },
  );
}

/** Una sesión v2, la de clinica-5. */
function sesionV2(
  dia: number,
  extra: Record<string, unknown> = {},
): FakeEntry {
  return sesion(
    {
      v: 2,
      mapaVersion: 1,
      lesionesVersion: 1,
      consejosVersion: 1,
      listas: { pendientes: 1, actos: 1 },
      especialidad: "PODOLOGIA",
      tipos: ["QUIROPODIA"],
      bloques: {
        QUIROPODIA: {
          actos: ["corte"],
          nivelPropuesto: 1,
          nivelElegido: 1,
          productoDelNivel: null,
          servicios: [],
        },
      },
      marcas: {},
      tratamientos: [],
      tratamientosNombre: {},
      dolor: 5,
      evolucion: "MEJOR",
      consejos: [],
      proximaCita: null,
      nota: null,
      avisos: [],
      pendientesCreados: [],
      pendientesCerrados: [],
      firma: FIRMA,
      ...extra,
    },
    { dia },
  );
}

/** La valoración validada con sus respuestas, de la que salen las
 *  alertas. Es la misma forma que usa la sesión de clinica-5. */
function valoracionValidada(respuestas: Record<string, string>) {
  const entryId = randomUUID();
  entradas.push({
    id: entryId,
    tenantId: TENANT_ID,
    clientId: PACIENTE_ID,
    authorUserId: DUENA_ID,
    appointmentId: null,
    kind: "ASSESSMENT",
    body: { respuestas, detalles: {} },
    createdAt: new Date(Date.UTC(2026, 8, 1, 9, 0, 0)),
  });
  valoraciones.push({
    id: randomUUID(),
    tenantId: TENANT_ID,
    clientId: PACIENTE_ID,
    status: "VALIDADA",
    channel: "ENLACE",
    source: "MANUAL",
    createdAt: new Date(Date.UTC(2026, 8, 1, 9, 0, 0)),
    entryId,
    answeredAt: new Date(Date.UTC(2026, 8, 1, 9, 30, 0)),
    answeredBy: "FAMILIAR",
    validatedAt: new Date(Date.UTC(2026, 8, 2, 9, 0, 0)),
    questionnaireVersion: 1,
  });
}

beforeEach(() => {
  clinicaEncendida = true;
  entradas = [];
  valoraciones = [];
  registro = [];
  reloj = 0;
  accesos = [{ clinicianUserId: SANITARIA_ID, clientId: PACIENTE_ID }];
  users.clear();
  clientes.clear();

  const base = {
    tenantId: TENANT_ID,
    clinicalScope: "ALL" as const,
    deletedAt: null,
    isSystemActor: false,
  };
  users.set(DUENA_ID, {
    ...base,
    id: DUENA_ID,
    role: "OWNER",
    isClinician: true,
    alias: "Lucía Martín",
    email: "lucia@clinica.local",
    clinicianLicense: "Col. 45-0312",
  });
  users.set(SANITARIA_ID, {
    ...base,
    id: SANITARIA_ID,
    role: "CLINICIAN",
    isClinician: true,
    alias: "Ana Sanitaria",
    email: "ana@clinica.local",
    clinicianLicense: "Col. 45-0999",
  });
  users.set(RECEPCION_ID, {
    ...base,
    id: RECEPCION_ID,
    role: "CASHIER",
    isClinician: false,
    alias: "Marta Recepción",
    email: "marta@clinica.local",
    clinicianLicense: null,
  });

  clientes.set(PACIENTE_ID, {
    id: PACIENTE_ID,
    tenantId: TENANT_ID,
    firstName: "Carmen",
    lastName: "Rodríguez López",
    phone: "600123456",
    birthdate: new Date("1948-03-11"),
    createdAt: new Date(Date.UTC(2026, 8, 1, 8, 0, 0)),
  });
  clientes.set(OTRA_PACIENTE_ID, {
    id: OTRA_PACIENTE_ID,
    tenantId: TENANT_ID,
    firstName: "Rosa",
    lastName: "Gil",
    phone: null,
    birthdate: null,
    createdAt: new Date(Date.UTC(2026, 8, 1, 8, 0, 0)),
  });
  clientes.set(AJENA_ID, {
    id: AJENA_ID,
    tenantId: OTRO_TENANT,
    firstName: "Ajena",
    lastName: "DeOtroTenant",
    phone: null,
    birthdate: null,
    createdAt: new Date(Date.UTC(2026, 8, 1, 8, 0, 0)),
  });
});

async function abrirHistoria(headers = comoSanitaria) {
  const app = await buildApp();
  const res = await app.inject({
    method: "GET",
    url: `/clinica/clients/${PACIENTE_ID}/historia`,
    headers,
  });
  await app.close();
  return res;
}

// ── 1 · El registro de accesos ───────────────────────────────────────

describe("cada apertura de la historia queda registrada", () => {
  it("la sanitaria abre y queda ALLOWED, con su ruta", async () => {
    sesionV2(7);
    const res = await abrirHistoria();
    expect(res.statusCode).toBe(200);
    expect(registro).toEqual([
      {
        userId: SANITARIA_ID,
        clientId: PACIENTE_ID,
        action: "READ",
        outcome: "ALLOWED",
        route: `GET /clinica/clients/${PACIENTE_ID}/historia`,
      },
    ]);
  });

  it("abrir una visita también deja su línea", async () => {
    const v = sesionV2(7);
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/clinica/clients/${PACIENTE_ID}/historia/visitas/${v.id}`,
      headers: comoSanitaria,
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(registro).toHaveLength(1);
    expect(registro[0]!.outcome).toBe("ALLOWED");
  });

  it("LA RECEPCIONISTA NO ENTRA, y el intento queda escrito", async () => {
    sesionV2(7);
    const res = await abrirHistoria(comoRecepcion);
    expect(res.statusCode).not.toBe(200);
    expect(registro).toHaveLength(1);
    expect(registro[0]).toMatchObject({
      userId: RECEPCION_ID,
      outcome: "DENIED",
    });
  });

  it("dos aperturas, dos líneas: la historia se abre, no se cachea", async () => {
    sesionV2(7);
    await abrirHistoria();
    await abrirHistoria();
    expect(registro).toHaveLength(2);
  });
});

// ── 2 · Ni un importe, y el mismo JSON para los dos roles ────────────

/** Las claves que son DINERO. El valor numérico es la otra mitad del
 *  aserto: `verImportes: false` lleva «importes» en el nombre y no es
 *  dinero (la lección de clinica-3 §6). */
const CLAVES_DE_DINERO =
  /^(precio|importe|total|subtotal|iva|unitPrice|price|amount|base|cuota)$/i;

function importesEn(x: unknown, ruta = "$"): string[] {
  if (Array.isArray(x)) {
    return x.flatMap((v, i) => importesEn(v, `${ruta}[${i}]`));
  }
  if (x != null && typeof x === "object") {
    return Object.entries(x).flatMap(([k, v]) =>
      CLAVES_DE_DINERO.test(k) && typeof v === "number"
        ? [`${ruta}.${k}`]
        : importesEn(v, `${ruta}.${k}`),
    );
  }
  return [];
}

describe("la historia no lleva ni un importe, para nadie", () => {
  beforeEach(() => {
    valoracionValidada({ diab: "SI", antic: "SI" });
    sesionV1(7, { "L:talon": { lesion: "dureza", gravedad: "MODERADA" } });
    sesionV2(21, {
      tratamientosNombre: { s1: "Quiropodia completa" },
      pendientesCreados: [
        { id: "revisar_una", zona: "L:h", nota: null, desde: "2026-09-08T10:00:00.000Z" },
      ],
    });
  });

  it("el JSON entero no trae una sola clave de dinero", async () => {
    const res = await abrirHistoria();
    expect(importesEn(res.json())).toEqual([]);
  });

  it("LA DUEÑA VE LO MISMO QUE EL SANITARIO SIN CAJA, byte a byte", async () => {
    const deLaSanitaria = await abrirHistoria(comoSanitaria);
    const deLaDuena = await abrirHistoria(comoDuena);
    const sin = (s: string) => s.replace(/"ahora":"[^"]+"/, '"ahora":"X"');
    expect(sin(deLaDuena.body)).toBe(sin(deLaSanitaria.body));
  });

  it("…y el detalle de una visita tampoco", async () => {
    const app = await buildApp();
    const v = entradas.find((e) => e.kind === "TREATMENT_SESSION")!;
    const res = await app.inject({
      method: "GET",
      url: `/clinica/clients/${PACIENTE_ID}/historia/visitas/${v.id}`,
      headers: comoDuena,
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(importesEn(res.json())).toEqual([]);
  });
});

// ── 3 · Una historia mezclada v1 + v2 ────────────────────────────────

describe("una historia mezclada se lee entera", () => {
  it("la v1 sale como «Sesión», sin tipo, y la v2 con el suyo", async () => {
    sesionV1(7, { "L:talon": { lesion: "dureza", gravedad: "MODERADA" } });
    sesionV2(21);
    const body = (await abrirHistoria()).json();
    expect(body.totalDeVisitas).toBe(2);
    // De la más reciente a la más antigua.
    expect(body.visitas.map((v: any) => v.titulo)).toEqual([
      "Quiropodia básica",
      "Sesión",
    ]);
    expect(body.visitas[1].tipos).toEqual([]);
    expect(body.visitas[1].chips).toEqual(["Deslaminado"]);
  });

  it("la marca de una v1 entra en el pie vivo igual que la de una v2", async () => {
    sesionV1(7, { "L:talon": { lesion: "dureza", gravedad: "SEVERA" } });
    sesionV2(21, {
      marcas: { "L:talon": { lesion: "dureza", gravedad: "LEVE" } },
    });
    const body = (await abrirHistoria()).json();
    expect(body.zonas).toHaveLength(1);
    expect(body.zonas[0].estado).toBe("MEJORANDO");
    expect(body.zonas[0].pasos).toHaveLength(2);
  });

  it("EL TOPE NO SE CALLA: 205 visitas salen 200, y el total dice 205", async () => {
    for (let i = 0; i < 205; i += 1) {
      sesion(
        { v: 2, tipos: ["QUIROPODIA"], bloques: {}, dolor: 3, marcas: {} },
        { dia: 1 + (i % 28) },
      );
    }
    const body = (await abrirHistoria()).json();
    expect(body.visitas).toHaveLength(VISITAS_DE_LA_HISTORIA);
    expect(body.totalDeVisitas).toBe(205);
  });

  it("un paciente SIN NADA no revienta: estados vacíos honestos", async () => {
    const body = (await abrirHistoria()).json();
    expect(body.visitas).toEqual([]);
    expect(body.zonas).toEqual([]);
    expect(body.sensibilidad).toBeNull();
    expect(body.enDiezSegundos.hoyToca).toBeNull();
    expect(body.enDiezSegundos.ultimaVez).toBeNull();
    expect(body.enDiezSegundos.ojoHoy).toBeNull();
    expect(body.documentos).toEqual([]);
    expect(body.cabecera.alertas).toEqual([]);
  });
});

// ── 4 · El estado de las zonas, desde la ruta ────────────────────────

describe("el pie vivo", () => {
  it("una zona que la última visita ya no marca sale CURADA", async () => {
    sesionV2(7, {
      marcas: { "L:talon": { lesion: "dureza", gravedad: "MODERADA" } },
    });
    sesionV2(21);
    const body = (await abrirHistoria()).json();
    expect(body.zonas[0].estado).toBe("CURADA");
  });

  it("NO EXPLORADA ≠ CURADA, también por el cable", async () => {
    sesionV2(7, {
      marcas: { "L:talon": { lesion: "dureza", gravedad: "MODERADA" } },
    });
    // Una biomecánica sin marcas: no mira el pie.
    sesionV2(21, { tipos: ["BIOMECANICA"], bloques: {} });
    const body = (await abrirHistoria()).json();
    expect(body.zonas[0].estado).toBe("ACTIVA");
  });
});

// ── 5 · «Hoy toca» y la recomendada ──────────────────────────────────

describe("«hoy toca»", () => {
  it("sin pendientes, nada", async () => {
    sesionV2(7);
    const body = (await abrirHistoria()).json();
    expect(body.enDiezSegundos.hoyToca).toBeNull();
  });

  it("sale de la ÚLTIMA sesión cerrada y el más antiguo va delante", async () => {
    // La de antes también tenía pendientes: no se leen, porque al cerrar
    // lo que sigue abierto se vuelve a crear en la última.
    sesionV2(7, {
      pendientesCreados: [
        { id: "control_riesgo", zona: null, nota: null, desde: "2026-09-07T10:00:00.000Z" },
      ],
    });
    sesionV2(21, {
      pendientesCreados: [
        { id: "control_riesgo", zona: null, nota: null, desde: "2026-09-21T10:00:00.000Z" },
        { id: "revisar_una", zona: "L:h", nota: null, desde: "2026-09-07T10:00:00.000Z" },
      ],
    });
    const body = (await abrirHistoria()).json();
    expect(body.enDiezSegundos.hoyToca.principal.titulo).toBe(
      "Revisar la uña operada",
    );
    expect(body.enDiezSegundos.hoyToca.principal.zona).toBe(
      "Pie izq. · Dedo gordo",
    );
    expect(body.enDiezSegundos.hoyToca.otros).toBe(1);
    expect(body.enDiezSegundos.hoyToca.tipo).toBe("CIRUGIA");
  });

  it("la recomendada de «Nueva visita» es la del pendiente", async () => {
    valoracionValidada({ diab: "SI" });
    sesionV2(7, {
      pendientesCreados: [
        { id: "revisar_una", zona: "L:h", nota: null, desde: "2026-09-07T10:00:00.000Z" },
      ],
    });
    const body = (await abrirHistoria()).json();
    expect(body.recomendada).toEqual({
      tipo: "CIRUGIA",
      motivo: "Lo que toca hoy",
    });
  });

  it("sin pendiente y con diabetes, pie de riesgo", async () => {
    valoracionValidada({ diab: "SI" });
    sesionV2(7);
    const body = (await abrirHistoria()).json();
    expect(body.recomendada.tipo).toBe("PIE_RIESGO");
  });
});

// ── La cabecera y los documentos ─────────────────────────────────────

describe("la cabecera y los documentos", () => {
  beforeEach(() => {
    valoracionValidada({ diab: "SI", antic: "SI" });
  });

  it("las alertas son las de la valoración, con sus ids", async () => {
    const body = (await abrirHistoria()).json();
    expect(body.cabecera.alertas).toEqual(["Diabetes", "Anticoagulación"]);
    expect(body.cabecera.alertaIds).toEqual(["diab", "antic"]);
    expect(body.cabecera.alertasPorValidar).toBe(false);
  });

  it("«ojo hoy» es la que cruza con lo que se hace", async () => {
    const body = (await abrirHistoria()).json();
    expect(body.enDiezSegundos.ojoHoy.alertaId).toBe("antic");
    expect(body.enDiezSegundos.ojoHoy.linea).toContain("sangrado");
  });

  it("la cabecera trae nombre, iniciales, edad y desde cuándo", async () => {
    const body = (await abrirHistoria()).json();
    expect(body.cabecera.paciente.nombre).toBe("Carmen Rodríguez López");
    expect(body.cabecera.paciente.iniciales).toBe("CR");
    expect(body.cabecera.paciente.edad).toBeGreaterThan(70);
    expect(body.cabecera.paciente.desde).toBe("2026-09-01T08:00:00.000Z");
  });

  it("la valoración sale en documentos, y dice quién respondió", async () => {
    const body = (await abrirHistoria()).json();
    expect(body.documentos).toHaveLength(1);
    expect(body.documentos[0].titulo).toBe("Valoración inicial · validada");
    expect(body.documentos[0].detalles).toContain("Respondió un familiar");
  });

  it("NO hay fila de consentimiento ni de informe: son de clinica-4", async () => {
    const body = (await abrirHistoria()).json();
    expect(
      body.documentos.map((d: any) => d.clase),
    ).toEqual(["VALORACION"]);
    expect(JSON.stringify(body.documentos)).not.toContain("Llega pronto");
  });
});

// ── 6 y 7 · El gate y el aislamiento ─────────────────────────────────

describe("el gate y el aislamiento", () => {
  it("con el módulo apagado, la ruta no existe", async () => {
    clinicaEncendida = false;
    const res = await abrirHistoria();
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({
      message: `Route GET:/clinica/clients/${PACIENTE_ID}/historia not found`,
      error: "Not Found",
      statusCode: 404,
    });
    // Y sin línea en el registro: con el módulo apagado no hay historia
    // que abrir.
    expect(registro).toEqual([]);
  });

  it("un paciente de otro tenant no existe", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/clinica/clients/${AJENA_ID}/historia`,
      headers: comoDuena,
    });
    await app.close();
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("CLIENT_NOT_FOUND");
    expect(registro).toEqual([]);
  });

  it("una visita de OTRO paciente no se abre desde esta historia", async () => {
    const ajena = sesion({ v: 2, dolor: 1 }, { clientId: OTRA_PACIENTE_ID });
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/clinica/clients/${PACIENTE_ID}/historia/visitas/${ajena.id}`,
      headers: comoDuena,
    });
    await app.close();
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("ENTRY_NOT_FOUND");
    // La línea SÍ está: se pidió abrir la historia de Carmen y se abrió.
    expect(registro[0]).toMatchObject({
      clientId: PACIENTE_ID,
      outcome: "ALLOWED",
    });
  });
});
