// clinica-3 · las rutas de la sesión, con Prisma en memoria.
//
// Lo que se prueba aquí es lo que decide la APLICACIÓN. Lo que decide el
// MOTOR (que una sesión cerrada no se edita ni se borra, que de una cita
// sale una sola, que no se puede borrar al paciente con sesión dentro) lo
// prueba `clinica-sesion.e2e.ts` contra Postgres de verdad, porque eso es
// justo lo que un fake no puede probar.
//
// Las garantías de este fichero, una por bloque, y son las que el prompt
// del bloque pide en «cómo se cierra»:
//
//   1. **Sin valoración validada no hay sesión.** Ni abrirla para cerrar,
//      ni cerrarla. La exploración SÍ.
//   2. **Cerrar dos veces = un cobro.** Una sola entrada y 200 la segunda.
//   3. **Una sesión cerrada no se edita**: no hay PATCH ni DELETE en este
//      bloque, y lo que sí hay es la anotación de clinica-1.
//   4. **Un `CLINICIAN` no recibe precios en NINGUNA respuesta de este
//      bloque**, y se comprueba recorriendo el JSON entero.
//   5. **La recepción no recibe nada clínico** en su lista de cobros.
//   6. **Módulo apagado → 404**, la de Fastify carácter por carácter.
//   7. **Una cita que NO es clínica cobra igual que antes**, línea por
//      línea.
//   8. Y la recepcionista no abre una sesión — y el intento queda escrito.

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
const CITA_ID = "55555555-5555-5555-5555-555555555551";
const CITA_VIEJA_ID = "55555555-5555-5555-5555-555555555552";

const QUIROPODIA = "66666666-6666-6666-6666-666666666661";
const FRESADO = "66666666-6666-6666-6666-666666666662";
const VERRUGA = "66666666-6666-6666-6666-666666666663";
/** Un servicio que NO está marcado como tratamiento de sesión: es el que
 *  prueba que lo que sale son los marcados y no «todos los servicios». */
const PRIMERA_VISITA = "66666666-6666-6666-6666-666666666664";

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
  validatedAt: Date | null;
  createdAt: Date;
  /** clinica-5 · la entrada con las respuestas. Sin ella no hay alertas
   *  que calcular, y las alertas son la mitad izquierda de la tabla de
   *  alertas cruzadas. */
  entryId: string | null;
  questionnaireVersion: number;
}
let valoraciones: FakeAssessment[] = [];

interface FakeCita {
  id: string;
  tenantId: string;
  clientId: string | null;
  status: string;
  startsAt: Date;
  ticketId: string | null;
  items: Array<{ serviceId: string; sortOrder: number }>;
  staffUserId: string | null;
}
let citas: FakeCita[] = [];

interface FakeProducto {
  id: string;
  tenantId: string;
  kind: string;
  name: string;
  sku: string | null;
  basePrice: number;
  taxRate: number;
  active: boolean;
  tratamientoSesion: boolean;
  // clinica-5 · las categorías del producto y el nivel de quiropodia. De
  // las primeras sale el TIPO DE VISITA (S5) y del segundo, qué producto
  // cobra el nivel elegido.
  tags: string[];
  scheduling: { nivelQuiropodia: number | null };
}
let productos: FakeProducto[] = [];

/** clinica-5 · el mapa `categoría → tipo de visita` del centro
 *  (`tag_visit_types`). Los tres servicios de sesión de este test están en
 *  la categoría «podologia», así que los tres son de tipo QUIROPODIA — que
 *  es lo que eran en clinica-3, cuando no había tipos. */
let mapaDeTipos: Array<{ slug: string; visitType: string }> = [];

/** clinica-4 · qué consentimientos pide cada servicio. Vacío en este
 *  fichero: la puerta de los consentimientos tiene su propio test. */
const consentimientosPorServicio = new Map<string, string[]>();

let tickets: Array<{ id: string; status: string }> = [];

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
    email: string | null;
    birthdate: Date | null;
  }
>();

/** Las zonas del mapa: `"L:h"` es la del dedo gordo izquierdo. */
const ZONA = "L:h";

function citaDe(id: string): FakeCita | undefined {
  return citas.find((c) => c.id === id);
}

function entradaCoincide(e: FakeEntry, where: any): boolean {
  if (where.tenantId != null && e.tenantId !== where.tenantId) return false;
  if (where.clientId != null && e.clientId !== where.clientId) return false;
  if (where.kind != null && e.kind !== where.kind) return false;
  if (typeof where.appointmentId === "string") {
    if (e.appointmentId !== where.appointmentId) return false;
  }
  if (where.appointmentId?.in != null) {
    if (!where.appointmentId.in.includes(e.appointmentId)) return false;
  }
  if (where.NOT?.appointmentId != null) {
    if (e.appointmentId === where.NOT.appointmentId) return false;
  }
  return true;
}

const fakePrisma: any = {
  $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
    fn(fakePrisma),
  ),
  // El `$queryRawUnsafe` del store y de los cobros pendientes. Se despacha
  // por el texto del SQL, que es lo único que un fake puede hacer — y
  // justo por eso el SQL de verdad lo prueba el e2e.
  $queryRawUnsafe: vi.fn(async (sql: string, ...args: unknown[]) => {
    if (sql.includes("FROM appointments a")) {
      // La lista de cobros pendientes: citas del rango sin cobrar.
      const desde = new Date(args[1] as string);
      const hasta = new Date(args[2] as string);
      return citas
        .filter((c) => c.tenantId === args[0])
        .filter((c) => c.clientId != null && c.status !== "CANCELLED")
        .filter((c) => c.startsAt >= desde && c.startsAt < hasta)
        .filter((c) => {
          if (!c.ticketId) return true;
          const t = tickets.find((x) => x.id === c.ticketId);
          return t == null || t.status === "DRAFT";
        })
        .sort((a, b) => +a.startsAt - +b.startsAt)
        .map((c) => ({
          id: c.id,
          client_id: c.clientId,
          starts_at: c.startsAt,
          ticket_status:
            tickets.find((x) => x.id === c.ticketId)?.status ?? null,
        }));
    }
    if (sql.includes("FROM appointments")) {
      const c = citas.find((x) => x.tenantId === args[0] && x.id === args[1]);
      return c
        ? [
            {
              id: c.id,
              client_id: c.clientId,
              status: c.status,
              starts_at: c.startsAt,
              ticket_id: c.ticketId,
            },
          ]
        : [];
    }
    throw new Error(`SQL no fingido en el test: ${sql.slice(0, 60)}`);
  }),
  tenant: {
    findUnique: vi.fn(async () => ({
      clinicalRecordsEnabled: clinicaEncendida,
      cajaEnabled: true,
      name: "Clínica Podológica Demo",
    })),
  },
  tagVisitType: {
    findMany: vi.fn(async () => mapaDeTipos),
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
    findMany: vi.fn(async ({ where }: any) =>
      [...clientes.values()].filter(
        (c) => c.tenantId === where.tenantId && where.id.in.includes(c.id),
      ),
    ),
  },
  product: {
    findMany: vi.fn(async ({ where }: any) =>
      productos
        .filter((p) => p.tenantId === where.tenantId)
        .filter((p) => (where.kind != null ? p.kind === where.kind : true))
        .filter((p) => (where.active != null ? p.active === where.active : true))
        .filter((p) =>
          where.scheduling?.tratamientoSesion != null
            ? p.tratamientoSesion === where.scheduling.tratamientoSesion
            : true,
        )
        .filter((p) => (where.id?.in != null ? where.id.in.includes(p.id) : true))
        .sort((a, b) => a.name.localeCompare(b.name)),
    ),
  },
  ticket: {
    findUnique: vi.fn(async ({ where }: any) =>
      tickets.find((t) => t.id === where.id) ?? null,
    ),
  },
  appointmentItem: {
    findMany: vi.fn(async ({ where }: any) => {
      const ids: string[] =
        where.appointmentId?.in ?? [where.appointmentId].filter(Boolean);
      return citas
        .filter((c) => ids.includes(c.id))
        .flatMap((c) =>
          c.items.map((i) => ({
            appointmentId: c.id,
            serviceId: i.serviceId,
            sortOrder: i.sortOrder,
          })),
        )
        .sort((a, b) => a.sortOrder - b.sortOrder);
    }),
  },
  appointmentAssignment: {
    findMany: vi.fn(async ({ where }: any) => {
      const c = citaDe(where.appointmentId);
      return c?.staffUserId ? [{ staffUserId: c.staffUserId }] : [];
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
    create: vi.fn(async ({ data }: any) => {
      // EL ÍNDICE ÚNICO PARCIAL, también aquí: de una cita sale UNA sola
      // sesión. Es lo que hace que el test de «cerrar dos veces» pruebe
      // algo en vez de contar dos inserciones felices.
      if (
        data.kind === "TREATMENT_SESSION" &&
        data.appointmentId != null &&
        entradas.some(
          (e) =>
            e.kind === "TREATMENT_SESSION" &&
            e.appointmentId === data.appointmentId,
        )
      ) {
        const err: any = new Error(
          'Unique constraint failed on the fields: (`appointment_id`)',
        );
        err.code = "P2002";
        err.meta = { target: ["clinical_entries_una_sesion_por_cita"] };
        throw err;
      }
      // Y el CHECK del cuerpo no vacío.
      if (
        data.body == null ||
        typeof data.body !== "object" ||
        Object.keys(data.body).length === 0
      ) {
        throw new Error(
          'new row violates check constraint "clinical_entries_body_object"',
        );
      }
      const row: FakeEntry = {
        id: randomUUID(),
        tenantId: data.tenantId,
        clientId: data.clientId,
        authorUserId: data.authorUserId,
        appointmentId: data.appointmentId ?? null,
        kind: data.kind,
        body: data.body,
        // +1 ms por fila para que «la última» sea determinista.
        createdAt: new Date(Date.now() + entradas.length),
      };
      entradas.push(row);
      return { id: row.id };
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
    count: vi.fn(async ({ where }: any) =>
      entradas.filter((e) => entradaCoincide(e, where)).length,
    ),
  },
  clinicalAssessment: {
    findMany: vi.fn(async ({ where }: any) =>
      valoraciones.filter(
        (v) =>
          v.tenantId === where.tenantId &&
          (where.clientId == null || v.clientId === where.clientId),
      ),
    ),
    findFirst: vi.fn(async ({ where }: any) => {
      const xs = valoraciones.filter(
        (v) => v.tenantId === where.tenantId && v.clientId === where.clientId,
      );
      const v = xs.slice().sort((a, b) => +b.createdAt - +a.createdAt)[0];
      return v ? { ...v, requestedBy: null, validatedBy: null } : null;
    }),
  },
  clinicalAssessmentCorrection: {
    findMany: vi.fn(async () => []),
  },
  // enlaces-publicos · la pantalla de la sesión lee la valoración por
  // `vistaDeLaValoracion`, y ésa pregunta ahora por el ENLACE de la
  // valoración en `public_links` (el enlace del test ya no vive en
  // `clinical_assessments`). Las valoraciones de este fichero son
  // VALIDADAS y nunca tuvieron enlace, así que la tabla está vacía — y
  // vacía de verdad, con su filtro, no un `null` a pelo: el día que un
  // caso de aquí necesite un enlace, basta con empujar la fila.
  // clinica-4 · la sesión tiene ahora una SEGUNDA puerta: los
  // consentimientos que pide el servicio de la cita (decisión 7).
  //
  // En este fichero ningún servicio pide ninguno —`consentimientosPorServicio`
  // nace vacío—, así que la puerta está abierta y las 81 garantías de
  // clinica-3 y -5 siguen probando lo suyo. Los dos casos en que la puerta
  // se cierra viven en `clinica-consentimientos-rutas.test.ts`, que es de
  // donde es la regla.
  serviceScheduling: {
    findMany: vi.fn(async ({ where }: any) =>
      (where.productId?.in ?? [])
        .filter((id: string) => consentimientosPorServicio.has(id))
        .map((id: string) => ({
          productId: id,
          consentimientos: consentimientosPorServicio.get(id) ?? [],
        })),
    ),
  },
  clientConsent: {
    findMany: vi.fn(async () => []),
    findFirst: vi.fn(async () => null),
  },
  publicLink: {
    findFirst: vi.fn(async ({ where }: any) => {
      const xs = enlacesPublicos.filter(
        (l) =>
          l.tenantId === where.tenantId &&
          l.purpose === where.purpose &&
          l.targetId === where.targetId,
      );
      return xs.slice().sort((a, b) => +b.createdAt - +a.createdAt)[0] ?? null;
    }),
  },
};

/** enlaces-publicos · `public_links`, vacía en este fichero. */
const enlacesPublicos: Array<{
  tenantId: string;
  purpose: string;
  targetId: string;
  expiresAt: Date;
  maxUses: number;
  usedCount: number;
  revokedAt: Date | null;
  createdAt: Date;
}> = [];

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

const { registerSesionRoutes } = await import(
  "../src/clinica/sesion-routes.js"
);
const { signAccessToken } = await import("../src/auth/tokens.js");
const { cobrosPendientesDe } = await import(
  "../src/clinica/cobros-pendientes.js"
);
const { lineasDeLaSesionCerrada } = await import(
  "../src/clinica/lineas-de-la-sesion.js"
);

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
  await registerSesionRoutes(app);
  await app.ready();
  return app;
}

/**
 * clinica-5 · el cuerpo del cierre, en la forma v2.
 *
 * Lo que en clinica-3 era `tratamientos: [...]` es ahora «el bloque del
 * tipo con sus servicios tocados». Los tres servicios de sesión de este
 * test están en la categoría «podologia», así que todos caen en el bloque
 * de QUIROPODIA.
 *
 * El helper existe para que lo que estos tests guardan siga siendo lo que
 * guardaban —la puerta, el doble cierre, la inmutabilidad, los importes
 * por rol— y no se conviertan en tests de la forma del JSON. Lo nuevo de
 * clinica-5 (niveles, riesgo, pendientes, dos tipos) tiene su propio
 * fichero: `clinica-tipos-rutas.test.ts`.
 */
function cerrarCon(
  servicios: string[],
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    tipos: ["QUIROPODIA"],
    bloques: { QUIROPODIA: { servicios } },
    dolor: 4,
    ...extra,
  };
}

const CERRAR_MINIMO = cerrarCon([QUIROPODIA]);

beforeEach(() => {
  clinicaEncendida = true;
  entradas = [];
  valoraciones = [];
  tickets = [];
  registro = [];
  accesos = [{ clinicianUserId: SANITARIA_ID, clientId: PACIENTE_ID }];
  users.clear();
  clientes.clear();
  mapaDeTipos = [{ slug: "podologia", visitType: "QUIROPODIA" }];

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
    // La dueña ES la sanitaria del piloto: la marca va separada del rol.
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
    alias: "Marta",
    email: "marta@clinica.local",
    clinicianLicense: null,
  });

  clientes.set(PACIENTE_ID, {
    id: PACIENTE_ID,
    tenantId: TENANT_ID,
    firstName: "Carmen",
    lastName: "Rodríguez López",
    phone: "600 123 456",
    email: "carmen@clinica.local",
    birthdate: new Date("1948-03-12T00:00:00.000Z"),
  });

  productos = [
    {
      id: QUIROPODIA,
      tenantId: TENANT_ID,
      kind: "SERVICE",
      name: "Quiropodia",
      sku: "SVC-QUIRO",
      basePrice: 30,
      taxRate: 0,
      active: true,
      tratamientoSesion: true,
      tags: ["podologia"],
      scheduling: { nivelQuiropodia: null },
    },
    {
      id: FRESADO,
      tenantId: TENANT_ID,
      kind: "SERVICE",
      name: "Corte y fresado de uñas",
      sku: "SVC-FRESADO",
      basePrice: 0,
      taxRate: 0,
      active: true,
      tratamientoSesion: true,
      tags: ["podologia"],
      scheduling: { nivelQuiropodia: null },
    },
    {
      id: VERRUGA,
      tenantId: TENANT_ID,
      kind: "SERVICE",
      name: "Tratamiento de verruga",
      sku: "SVC-VERRUGA",
      basePrice: 25,
      taxRate: 0,
      active: true,
      tratamientoSesion: true,
      tags: ["podologia"],
      scheduling: { nivelQuiropodia: null },
    },
    {
      id: PRIMERA_VISITA,
      tenantId: TENANT_ID,
      kind: "SERVICE",
      name: "Primera visita · valoración",
      sku: "SVC-VALORACION",
      basePrice: 35,
      taxRate: 0,
      active: true,
      tratamientoSesion: false,
      tags: ["podologia"],
      scheduling: { nivelQuiropodia: null },
    },
  ];

  citas = [
    {
      id: CITA_ID,
      tenantId: TENANT_ID,
      clientId: PACIENTE_ID,
      status: "IN_SERVICE",
      startsAt: new Date("2026-10-07T08:30:00.000Z"),
      ticketId: null,
      items: [{ serviceId: QUIROPODIA, sortOrder: 0 }],
      staffUserId: DUENA_ID,
    },
    {
      id: CITA_VIEJA_ID,
      tenantId: TENANT_ID,
      clientId: PACIENTE_ID,
      status: "COMPLETED",
      startsAt: new Date("2026-09-21T08:30:00.000Z"),
      ticketId: null,
      items: [{ serviceId: QUIROPODIA, sortOrder: 0 }],
      staffUserId: DUENA_ID,
    },
  ];
});

/** Le da a Carmen una valoración VALIDADA: la puerta abierta. */
function conValoracionValidada() {
  valoraciones.push({
    id: randomUUID(),
    tenantId: TENANT_ID,
    clientId: PACIENTE_ID,
    status: "VALIDADA",
    validatedAt: new Date("2026-09-07T09:00:00.000Z"),
    createdAt: new Date("2026-09-07T08:00:00.000Z"),
    // Sin respuestas: Carmen no tiene alertas en los tests de clinica-3.
    // `conAlertasDeCarmen()` (clinica-5) le engancha la entrada.
    entryId: null,
    questionnaireVersion: 1,
  });
}

// ── 1 · LA PUERTA: sin valoración validada no hay sesión ─────────────

describe("clinica-3 · la puerta de la valoración", () => {
  it("sin NINGUNA valoración, cerrar la sesión da 409 y dice qué hacer", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: `/clinica/appointments/${CITA_ID}/sesion/cerrar`,
      headers: comoDuena,
      payload: CERRAR_MINIMO,
    });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("SIN_VALORACION_VALIDADA");
    expect(r.json().message).toMatch(/no tiene valoración inicial/i);
    // Y NO SE ESCRIBIÓ NADA.
    expect(entradas).toHaveLength(0);
  });

  it("con la valoración RESPONDIDA y sin validar, tampoco — y el mensaje dice «válidala»", async () => {
    valoraciones.push({
      id: randomUUID(),
      tenantId: TENANT_ID,
      clientId: PACIENTE_ID,
      status: "RESPONDIDA",
      validatedAt: null,
      createdAt: new Date("2026-10-01T08:00:00.000Z"),
      entryId: null,
      questionnaireVersion: 1,
    });
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: `/clinica/appointments/${CITA_ID}/sesion/cerrar`,
      headers: comoDuena,
      payload: CERRAR_MINIMO,
    });
    expect(r.statusCode).toBe(409);
    expect(r.json().message).toMatch(/válidala antes del primer tratamiento/i);
    expect(entradas).toHaveLength(0);
  });

  it("la pantalla SÍ se abre sin la valoración, y trae la puerta cerrada con su motivo", async () => {
    // El mockup pide enseñar «falta validar la valoración inicial» con el
    // camino para hacerlo, y para eso la pantalla tiene que poder abrirse.
    // La puerta cierra el CIERRE, no la vista.
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: `/clinica/appointments/${CITA_ID}/sesion`,
      headers: comoDuena,
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().puerta).toMatchObject({
      puede: false,
      motivo: "SIN_VALORACION",
    });
  });

  it("con la valoración VALIDADA se cierra", async () => {
    conValoracionValidada();
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: `/clinica/appointments/${CITA_ID}/sesion/cerrar`,
      headers: comoDuena,
      payload: CERRAR_MINIMO,
    });
    expect(r.statusCode).toBe(201);
    expect(entradas.filter((e) => e.kind === "TREATMENT_SESSION")).toHaveLength(
      1,
    );
  });

  it("LA EXPLORACIÓN SÍ se registra sin valoración validada: es parte de la primera visita", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: `/clinica/appointments/${CITA_ID}/sesion/exploracion`,
      headers: comoDuena,
      payload: {
        pulsos: { L: "DEBIL", R: "PRESENTE" },
        sinSensibilidad: [ZONA],
        tipoDePie: "CAVO",
      },
    });
    expect(r.statusCode).toBe(201);
    expect(entradas.filter((e) => e.kind === "FOOT_EXAM")).toHaveLength(1);
    expect(r.json().exploracion).toMatchObject({
      pulsos: { L: "DEBIL", R: "PRESENTE" },
      sinSensibilidad: [ZONA],
      tipoDePie: "CAVO",
    });
  });
});

// ── 2 · CERRAR DOS VECES = UN COBRO ─────────────────────────────────

describe("clinica-3 · cerrar dos veces no crea dos sesiones ni dos cobros", () => {
  it("el segundo cierre devuelve 200 con la MISMA sesión, y hay una sola entrada", async () => {
    conValoracionValidada();
    const app = await buildApp();
    const primera = await app.inject({
      method: "POST",
      url: `/clinica/appointments/${CITA_ID}/sesion/cerrar`,
      headers: comoDuena,
      payload: cerrarCon([QUIROPODIA, FRESADO]),
    });
    expect(primera.statusCode).toBe(201);
    expect(primera.json().yaEstaba).toBe(false);

    const segunda = await app.inject({
      method: "POST",
      url: `/clinica/appointments/${CITA_ID}/sesion/cerrar`,
      headers: comoDuena,
      // Con OTRO contenido: lo que se devuelve es lo FIRMADO, no lo nuevo.
      payload: cerrarCon([VERRUGA], { dolor: 9 }),
    });
    expect(segunda.statusCode).toBe(200);
    expect(segunda.json().yaEstaba).toBe(true);

    expect(entradas.filter((e) => e.kind === "TREATMENT_SESSION")).toHaveLength(
      1,
    );
    // Y lo firmado no cambió: el segundo intento no reescribe nada.
    expect(segunda.json().cerrada.entryId).toBe(
      primera.json().cerrada.entryId,
    );
    expect(segunda.json().cerrada.cuerpo.dolor).toBe(4);
    expect(segunda.json().cerrada.resumen.total).toBe(30);
  });

  it("y DOS CIERRES SIMULTÁNEOS tampoco: el que pierde la carrera recibe la sesión del otro", async () => {
    // Los dos pasan la comprobación previa sin ver nada y llegan los dos a
    // la inserción. El índice único rechaza al segundo con 23505 y el
    // `catch` le devuelve la sesión que acaba de escribir el primero —
    // misma forma que el `ON CONFLICT DO NOTHING` del acceso por cita.
    conValoracionValidada();
    const app = await buildApp();
    const [a, b] = await Promise.all([
      app.inject({
        method: "POST",
        url: `/clinica/appointments/${CITA_ID}/sesion/cerrar`,
        headers: comoDuena,
        payload: CERRAR_MINIMO,
      }),
      app.inject({
        method: "POST",
        url: `/clinica/appointments/${CITA_ID}/sesion/cerrar`,
        headers: comoDuena,
        payload: CERRAR_MINIMO,
      }),
    ]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 201]);
    expect(entradas.filter((e) => e.kind === "TREATMENT_SESSION")).toHaveLength(
      1,
    );
    expect(a.json().cerrada.entryId).toBe(b.json().cerrada.entryId);
  });

  it("y el COBRO sale de la sesión: una sola lista de líneas para esa cita", async () => {
    conValoracionValidada();
    const app = await buildApp();
    await app.inject({
      method: "POST",
      url: `/clinica/appointments/${CITA_ID}/sesion/cerrar`,
      headers: comoDuena,
      payload: cerrarCon([QUIROPODIA, VERRUGA], { dolor: 2 }),
    });
    await app.inject({
      method: "POST",
      url: `/clinica/appointments/${CITA_ID}/sesion/cerrar`,
      headers: comoDuena,
      payload: cerrarCon([QUIROPODIA, VERRUGA], { dolor: 2 }),
    });
    // Lo que el camino de cobro va a leer: DOS líneas, no cuatro.
    const lineas = await lineasDeLaSesionCerrada(fakePrisma, {
      tenantId: TENANT_ID,
      appointmentId: CITA_ID,
    });
    expect(lineas).toEqual([
      { serviceId: QUIROPODIA },
      { serviceId: VERRUGA },
    ]);
  });
});

// ── 3 · UNA SESIÓN CERRADA NO SE EDITA ──────────────────────────────

describe("clinica-3 · la sesión cerrada es inmutable", () => {
  it("no hay PATCH ni PUT ni DELETE de una sesión en este bloque", async () => {
    conValoracionValidada();
    const app = await buildApp();
    await app.inject({
      method: "POST",
      url: `/clinica/appointments/${CITA_ID}/sesion/cerrar`,
      headers: comoDuena,
      payload: CERRAR_MINIMO,
    });
    for (const method of ["PATCH", "PUT", "DELETE"] as const) {
      const r = await app.inject({
        method,
        url: `/clinica/appointments/${CITA_ID}/sesion`,
        headers: comoDuena,
        payload: { dolor: 0 },
      });
      // 404 y no 405: la ruta no existe. Y si alguien la escribiera, el
      // trigger `clinical_entries_inmutable` la rechazaría igual — eso lo
      // prueba el e2e contra Postgres.
      expect(r.statusCode).toBe(404);
    }
  });

  it("volver a abrir la pantalla trae la sesión CERRADA, no una en blanco", async () => {
    conValoracionValidada();
    const app = await buildApp();
    await app.inject({
      method: "POST",
      url: `/clinica/appointments/${CITA_ID}/sesion/cerrar`,
      headers: comoDuena,
      payload: { ...CERRAR_MINIMO, nota: "  se le explicó la cura  " },
    });
    const r = await app.inject({
      method: "GET",
      url: `/clinica/appointments/${CITA_ID}/sesion`,
      headers: comoDuena,
    });
    expect(r.json().cerrada).not.toBeNull();
    expect(r.json().cerrada.cuerpo.nota).toBe("se le explicó la cura");
    expect(r.json().cerrada.firma).toMatchObject({
      autorNombre: "Lucía Martín",
      colegiado: "Col. 45-0312",
    });
  });

  it("la firma se CONGELA: cambiarle el colegiado después no cambia lo firmado", async () => {
    conValoracionValidada();
    const app = await buildApp();
    await app.inject({
      method: "POST",
      url: `/clinica/appointments/${CITA_ID}/sesion/cerrar`,
      headers: comoDuena,
      payload: CERRAR_MINIMO,
    });
    users.get(DUENA_ID)!.clinicianLicense = "Col. 99-0000";
    const r = await app.inject({
      method: "GET",
      url: `/clinica/appointments/${CITA_ID}/sesion`,
      headers: comoDuena,
    });
    expect(r.json().cerrada.firma.colegiado).toBe("Col. 45-0312");
  });
});

// ── 4 · UN `CLINICIAN` NO RECIBE PRECIOS. En ninguna respuesta. ─────

/**
 * Recorre un JSON ENTERO y devuelve las rutas de todo lo que huela a
 * dinero. Es el guardián de la regla 8.
 *
 * Busca por NOMBRE DE CLAVE —es lo único que sigue valiendo cuando alguien
 * añade un campo en dos bloques— **y además exige que el valor sea un
 * número o un texto con cifras**. Esa segunda mitad es la que distingue un
 * importe de una bandera: `verImportes: false` lleva «importes» en el
 * nombre y no es dinero, y `ivaTexto: "IVA 21 %"` sí lo es.
 *
 * Un `total: null` también cuenta como ausencia, que es correcto: lo que
 * la API hace es QUITAR la clave, pero si alguna vez pusiera `null` en vez
 * de quitarla este guardián no se enteraría. Por eso hay además un test
 * que comprueba la FORMA exacta de una línea (`toEqual` con sólo
 * `serviceId` y `nombre`).
 */
function clavesDeDinero(x: unknown, ruta = "$"): string[] {
  const SOSPECHOSAS = /precio|importe|total|iva|price|amount|eur|coste/i;
  if (Array.isArray(x)) {
    return x.flatMap((v, i) => clavesDeDinero(v, `${ruta}[${i}]`));
  }
  if (x != null && typeof x === "object") {
    return Object.entries(x).flatMap(([k, v]) => {
      const aqui = `${ruta}.${k}`;
      const esDinero =
        SOSPECHOSAS.test(k) &&
        (typeof v === "number" || (typeof v === "string" && /\d/.test(v)));
      return [...(esDinero ? [aqui] : []), ...clavesDeDinero(v, aqui)];
    });
  }
  return [];
}

describe("clinica-3 · el sanitario sin caja no ve importes EN LA API", () => {
  beforeEach(() => {
    conValoracionValidada();
    // La sanitaria sin caja atiende esta cita.
    citaDe(CITA_ID)!.staffUserId = SANITARIA_ID;
  });

  it("la pantalla de la sesión no lleva NI UNA clave de dinero", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: `/clinica/appointments/${CITA_ID}/sesion`,
      headers: comoSanitaria,
    });
    expect(r.statusCode).toBe(200);
    expect(clavesDeDinero(r.json())).toEqual([]);
    // Y lo dice explícitamente, para que la pantalla no lo deduzca de un
    // hueco (deducirlo de un hueco es cómo se escribe un `?? 0`).
    expect(r.json().verImportes).toBe(false);
    // Lo que SÍ trae: los botones con su nombre, y cuántos hay.
    expect(r.json().tratamientos).toHaveLength(3);
    // clinica-5 · `tipo` y `nivelQuiropodia` SÍ salen: no son importes,
    // son en qué tarjeta va el botón. Sin ellos, el sanitario sin caja
    // vería los seis botones en una lista plana — la regla de «no ve
    // importes» le quitaría la pantalla entera. Lo que no está sigue
    // siendo `precio`, `iva` y `causaExencion`.
    expect(r.json().tratamientos[0]).toEqual({
      serviceId: expect.any(String),
      nombre: expect.any(String),
      tipo: "QUIROPODIA",
      nivelQuiropodia: null,
    });
  });

  it("y al CERRAR tampoco — su botón dice «Cerrar sesión», sin «y cobrar»", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: `/clinica/appointments/${CITA_ID}/sesion/cerrar`,
      headers: comoSanitaria,
      payload: cerrarCon([QUIROPODIA, VERRUGA], { dolor: 6 }),
    });
    expect(r.statusCode).toBe(201);
    expect(clavesDeDinero(r.json())).toEqual([]);
    expect(r.json().cerrada.resumen.textoDelBoton).toBe("Cerrar sesión");
    // Las líneas están, con su nombre: tiene que poder ver QUÉ se le hizo.
    expect(r.json().cerrada.resumen.lineas).toEqual([
      { serviceId: QUIROPODIA, nombre: "Quiropodia" },
      { serviceId: VERRUGA, nombre: "Tratamiento de verruga" },
    ]);
  });

  it("ni al volver a abrir la sesión ya cerrada", async () => {
    const app = await buildApp();
    await app.inject({
      method: "POST",
      url: `/clinica/appointments/${CITA_ID}/sesion/cerrar`,
      headers: comoSanitaria,
      payload: CERRAR_MINIMO,
    });
    const r = await app.inject({
      method: "GET",
      url: `/clinica/appointments/${CITA_ID}/sesion`,
      headers: comoSanitaria,
    });
    expect(clavesDeDinero(r.json())).toEqual([]);
  });

  it("ni en el cuerpo de la historia: la sesión guarda el NOMBRE y nunca el precio", async () => {
    const app = await buildApp();
    await app.inject({
      method: "POST",
      url: `/clinica/appointments/${CITA_ID}/sesion/cerrar`,
      headers: comoSanitaria,
      payload: cerrarCon([QUIROPODIA], { dolor: 1 }),
    });
    const cuerpo = entradas.find((e) => e.kind === "TREATMENT_SESSION")!.body;
    expect(cuerpo.tratamientosNombre).toEqual({ [QUIROPODIA]: "Quiropodia" });
    expect(clavesDeDinero(cuerpo)).toEqual([]);
  });

  it("LA DUEÑA SÍ los ve, y su botón dice «y cobrar»: no es que nadie los vea", async () => {
    citaDe(CITA_ID)!.staffUserId = DUENA_ID;
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: `/clinica/appointments/${CITA_ID}/sesion`,
      headers: comoDuena,
    });
    expect(r.json().verImportes).toBe(true);
    expect(clavesDeDinero(r.json()).length).toBeGreaterThan(0);
    expect(r.json().tratamientos[0]).toMatchObject({ precio: expect.any(Number) });

    const cerrada = await app.inject({
      method: "POST",
      url: `/clinica/appointments/${CITA_ID}/sesion/cerrar`,
      headers: comoDuena,
      payload: cerrarCon([QUIROPODIA, VERRUGA], { dolor: 3 }),
    });
    expect(cerrada.json().cerrada.resumen.total).toBe(55);
    expect(cerrada.json().cerrada.resumen.textoDelBoton).toBe(
      "Cerrar sesión y cobrar",
    );
  });

  it("y el texto del IVA sale del CATÁLOGO, nunca dice «exento»", async () => {
    // El mockup escribe «exento de IVA» porque su clínica lo es. Aquí el
    // texto sale del catálogo: el IVA exento en Verifactu está fuera de
    // alcance y `registro.ts` sigue declarando S1, así que escribir
    // «exento» en una pantalla cuyo ticket va a declarar otra cosa sería
    // escribirlo en el sitio donde más se cree.
    for (const p of productos) p.taxRate = 21;
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: `/clinica/appointments/${CITA_ID}/sesion/cerrar`,
      headers: comoDuena,
      payload: CERRAR_MINIMO,
    });
    expect(r.json().cerrada.resumen.ivaTexto).toBe("IVA 21 %");
    expect(JSON.stringify(r.json())).not.toMatch(/exent/i);
  });
});

// ── 5 · LA RECEPCIÓN no recibe nada clínico ─────────────────────────

describe("clinica-3 · la lista de cobros pendientes no lleva historia", () => {
  async function unaSesionCerrada() {
    conValoracionValidada();
    const app = await buildApp();
    await app.inject({
      method: "POST",
      url: `/clinica/appointments/${CITA_ID}/sesion/cerrar`,
      headers: comoDuena,
      payload: cerrarCon([QUIROPODIA, VERRUGA], {
        dolor: 7,
        evolucion: "PEOR",
        consejos: ["calzado"],
        proximaCita: "S4",
        nota: "la úlcera del talón va peor",
        marcas: { [ZONA]: { lesion: "herida", gravedad: "SEVERA" } },
      }),
    });
    return app;
  }

  const RANGO = {
    tenantId: TENANT_ID,
    desde: new Date("2026-10-07T00:00:00.000Z"),
    hasta: new Date("2026-10-07T23:59:00.000Z"),
  };

  it("lleva la cita, el paciente y las líneas con precio", async () => {
    await unaSesionCerrada();
    const cobros = await cobrosPendientesDe(fakePrisma, RANGO);
    expect(cobros).toHaveLength(1);
    expect(cobros[0]).toMatchObject({
      appointmentId: CITA_ID,
      paciente: { id: PACIENTE_ID, nombre: "Carmen Rodríguez López" },
      servicios: ["Quiropodia"],
      total: 55,
      ivaTexto: "IVA 0 %",
    });
    expect(cobros[0]!.lineas).toEqual([
      { nombre: "Quiropodia", precio: 30, iva: 0 },
      { nombre: "Tratamiento de verruga", precio: 25, iva: 0 },
    ]);
  });

  it("y NI UNA PALABRA de la historia: ni lesión, ni dolor, ni evolución, ni consejo, ni nota", async () => {
    await unaSesionCerrada();
    const cobros = await cobrosPendientesDe(fakePrisma, RANGO);
    const json = JSON.stringify(cobros);
    for (const prohibido of [
      "herida",
      "SEVERA",
      "dolor",
      "PEOR",
      "calzado",
      "úlcera",
      "marcas",
      "L:h",
      "S4",
    ]) {
      expect(json, `«${prohibido}» no puede estar en la lista de cobros`).not.toContain(
        prohibido,
      );
    }
  });

  it("ni una alerta del paciente", async () => {
    await unaSesionCerrada();
    const cobros = await cobrosPendientesDe(fakePrisma, RANGO);
    const json = JSON.stringify(cobros).toLowerCase();
    for (const p of CUESTIONARIO_V1.preguntas) {
      if (!p.alerta) continue;
      expect(json).not.toContain(p.alerta.toLowerCase());
    }
  });

  it("una cita YA COBRADA sale de la lista", async () => {
    await unaSesionCerrada();
    citaDe(CITA_ID)!.ticketId = "99999999-9999-4999-8999-999999999999";
    tickets.push({ id: citaDe(CITA_ID)!.ticketId!, status: "PAID" });
    expect(await cobrosPendientesDe(fakePrisma, RANGO)).toEqual([]);
  });

  it("pero una con el borrador abierto y sin pagar SIGUE pendiente", async () => {
    // Un DRAFT es un cobro empezado y no terminado. Dejarlo fuera sería la
    // forma de perder un cobro: la cita desaparecería del único sitio
    // donde se mira qué queda por cobrar.
    await unaSesionCerrada();
    citaDe(CITA_ID)!.ticketId = "99999999-9999-4999-8999-999999999999";
    tickets.push({ id: citaDe(CITA_ID)!.ticketId!, status: "DRAFT" });
    expect(await cobrosPendientesDe(fakePrisma, RANGO)).toHaveLength(1);
  });

  it("una cita SIN sesión cerrada no está en la lista: no hay nada que cobrar todavía", async () => {
    expect(await cobrosPendientesDe(fakePrisma, RANGO)).toEqual([]);
  });

  it("y con el módulo clínico apagado, la lista está VACÍA y no revienta", async () => {
    await unaSesionCerrada();
    clinicaEncendida = false;
    expect(await cobrosPendientesDe(fakePrisma, RANGO)).toEqual([]);
  });
});

// ── 6 · MÓDULO APAGADO → 404 ────────────────────────────────────────

describe("clinica-3 · con la historia clínica apagada, las rutas no existen", () => {
  const RUTAS = [
    ["GET", `/clinica/appointments/${CITA_ID}/sesion`, undefined],
    [
      "POST",
      `/clinica/appointments/${CITA_ID}/sesion/cerrar`,
      cerrarCon([QUIROPODIA], { dolor: 1 }),
    ],
    [
      "POST",
      `/clinica/appointments/${CITA_ID}/sesion/exploracion`,
      { pulsos: { L: "PRESENTE", R: "PRESENTE" }, tipoDePie: "NORMAL" },
    ],
  ] as const;

  it.each(RUTAS)("%s %s → 404 indistinguible de una ruta que no existe", async (
    method,
    url,
    payload,
  ) => {
    clinicaEncendida = false;
    conValoracionValidada();
    const app = await buildApp();
    const r = await app.inject({
      method: method as "GET" | "POST",
      url,
      headers: comoDuena,
      ...(payload ? { payload } : {}),
    });
    expect(r.statusCode).toBe(404);
    expect(r.json()).toEqual({
      message: `Route ${method}:${url} not found`,
      error: "Not Found",
      statusCode: 404,
    });
  });

  it("y no se escribe nada", async () => {
    clinicaEncendida = false;
    conValoracionValidada();
    const app = await buildApp();
    await app.inject({
      method: "POST",
      url: `/clinica/appointments/${CITA_ID}/sesion/cerrar`,
      headers: comoDuena,
      payload: CERRAR_MINIMO,
    });
    expect(entradas).toHaveLength(0);
    expect(registro).toHaveLength(0);
  });
});

// ── 7 · UNA CITA QUE NO ES CLÍNICA COBRA IGUAL QUE ANTES ────────────

describe("clinica-3 · el camino de cobro de siempre no cambia", () => {
  it("un tenant SIN clínica: lo clínico no le pregunta nada al cobro", async () => {
    clinicaEncendida = false;
    fakePrisma.clinicalEntry.findFirst.mockClear();
    expect(
      await lineasDeLaSesionCerrada(fakePrisma, {
        tenantId: TENANT_ID,
        appointmentId: CITA_ID,
      }),
    ).toBeNull();
    // Y ni mira las entradas: la capability es lo primero. (Si mirara,
    // los catorce tenants sin clínica pagarían una consulta por cobro.)
    expect(fakePrisma.clinicalEntry.findFirst).not.toHaveBeenCalled();
  });

  it("una cita de un tenant CON clínica pero SIN sesión: también null", async () => {
    expect(
      await lineasDeLaSesionCerrada(fakePrisma, {
        tenantId: TENANT_ID,
        appointmentId: CITA_ID,
      }),
    ).toBeNull();
  });

  it("y si la lectura REVIENTA, se cobra como antes: nunca se tumba el cobro", async () => {
    const original = fakePrisma.clinicalEntry.findFirst;
    fakePrisma.clinicalEntry.findFirst = vi.fn(async () => {
      throw new Error("db down");
    });
    try {
      expect(
        await lineasDeLaSesionCerrada(fakePrisma, {
          tenantId: TENANT_ID,
          appointmentId: CITA_ID,
        }),
      ).toBeNull();
    } finally {
      fakePrisma.clinicalEntry.findFirst = original;
    }
  });

  it("con sesión cerrada, lo que se cobra es LO QUE SE HIZO y no lo que se reservó", async () => {
    // La cita se dio para «Quiropodia» y se le hicieron tres cosas. Cobrar
    // el servicio de la cita sería cobrar la previsión, que es lo que la
    // podóloga hace hoy en papel y de memoria.
    conValoracionValidada();
    const app = await buildApp();
    await app.inject({
      method: "POST",
      url: `/clinica/appointments/${CITA_ID}/sesion/cerrar`,
      headers: comoDuena,
      payload: cerrarCon([QUIROPODIA, FRESADO, VERRUGA], { dolor: 5 }),
    });
    expect(
      await lineasDeLaSesionCerrada(fakePrisma, {
        tenantId: TENANT_ID,
        appointmentId: CITA_ID,
      }),
    ).toEqual([
      { serviceId: QUIROPODIA },
      { serviceId: FRESADO },
      { serviceId: VERRUGA },
    ]);
  });
});

// ── 8 · QUIÉN ENTRA, Y QUE EL INTENTO QUEDA ESCRITO ─────────────────

describe("clinica-3 · la sesión es de sanitario con acceso a ESE paciente", () => {
  beforeEach(() => conValoracionValidada());

  it("la recepcionista recibe 403 al abrir la sesión — Y QUEDA EN EL REGISTRO", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: `/clinica/appointments/${CITA_ID}/sesion`,
      headers: comoRecepcion,
    });
    expect(r.statusCode).toBe(403);
    expect(r.json().code).toBe("NO_SANITARIO");
    expect(registro).toEqual([
      {
        userId: RECEPCION_ID,
        clientId: PACIENTE_ID,
        action: "READ",
        outcome: "DENIED",
        route: `GET /clinica/appointments/${CITA_ID}/sesion`,
      },
    ]);
  });

  it("ni puede cerrarla", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: `/clinica/appointments/${CITA_ID}/sesion/cerrar`,
      headers: comoRecepcion,
      payload: CERRAR_MINIMO,
    });
    expect(r.statusCode).toBe(403);
    expect(entradas).toHaveLength(0);
    expect(registro[0]).toMatchObject({ action: "WRITE", outcome: "DENIED" });
  });

  it("una sanitaria SIN acceso a este paciente tampoco", async () => {
    accesos = [];
    users.get(SANITARIA_ID)!.clinicalScope = "SELECTION";
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: `/clinica/appointments/${CITA_ID}/sesion`,
      headers: comoSanitaria,
    });
    expect(r.statusCode).toBe(403);
    expect(r.json().code).toBe("SIN_ACCESO_AL_PACIENTE");
    expect(registro[0]).toMatchObject({ outcome: "DENIED" });
  });

  it("la lectura permitida deja línea ALLOWED con su ruta", async () => {
    const app = await buildApp();
    await app.inject({
      method: "GET",
      url: `/clinica/appointments/${CITA_ID}/sesion`,
      headers: comoDuena,
    });
    expect(registro).toEqual([
      {
        userId: DUENA_ID,
        clientId: PACIENTE_ID,
        action: "READ",
        outcome: "ALLOWED",
        route: `GET /clinica/appointments/${CITA_ID}/sesion`,
      },
    ]);
  });

  it("una cita de OTRO tenant es 404 y NO deja línea: no hay paciente del que apuntarla", async () => {
    citaDe(CITA_ID)!.tenantId = "ffffffff-ffff-4fff-8fff-ffffffffffff";
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: `/clinica/appointments/${CITA_ID}/sesion`,
      headers: comoDuena,
    });
    expect(r.statusCode).toBe(404);
    expect(r.json().code).toBe("APPOINTMENT_NOT_FOUND");
    expect(registro).toHaveLength(0);
  });

  it("una cita SIN paciente (walk-in) es 404: la sesión de nadie no existe", async () => {
    citaDe(CITA_ID)!.clientId = null;
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: `/clinica/appointments/${CITA_ID}/sesion`,
      headers: comoDuena,
    });
    expect(r.statusCode).toBe(404);
  });
});

// ── 9 · La pantalla: lo que trae y de dónde ─────────────────────────

describe("clinica-3 · la pantalla trae lo que el mockup pinta", () => {
  beforeEach(() => conValoracionValidada());

  it("la cabecera con sus fichas, y la edad calculada y no inventada", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: `/clinica/appointments/${CITA_ID}/sesion`,
      headers: comoDuena,
    });
    expect(r.json().cabecera).toMatchObject({
      paciente: {
        nombre: "Carmen Rodríguez López",
        telefono: "600 123 456",
      },
      citaDeHoy: { servicios: ["Quiropodia"] },
      atiende: { nombre: "Lucía Martín" },
    });
    expect(r.json().cabecera.paciente.edad).toBeGreaterThan(70);
  });

  it("sin fecha de nacimiento, la edad es null y no un número inventado", async () => {
    clientes.get(PACIENTE_ID)!.birthdate = null;
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: `/clinica/appointments/${CITA_ID}/sesion`,
      headers: comoDuena,
    });
    expect(r.json().cabecera.paciente.edad).toBeNull();
  });

  it("los botones son los tratamientos MARCADOS en el catálogo, no todos los servicios", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: `/clinica/appointments/${CITA_ID}/sesion`,
      headers: comoDuena,
    });
    const ids = r.json().tratamientos.map((t: any) => t.serviceId);
    expect(ids).toHaveLength(3);
    // El servicio de primera visita NO es un tratamiento de sesión.
    expect(ids).not.toContain(PRIMERA_VISITA);
  });

  it("un tratamiento SIN SKU no sale: no se podría cobrar y el botón sería una trampa", async () => {
    productos.find((p) => p.id === VERRUGA)!.sku = "  ";
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: `/clinica/appointments/${CITA_ID}/sesion`,
      headers: comoDuena,
    });
    expect(
      r.json().tratamientos.map((t: any) => t.serviceId),
    ).not.toContain(VERRUGA);
  });

  it("el número de visita cuenta la de hoy: con dos cerradas antes, hoy es la 3.ª", async () => {
    entradas.push(
      {
        id: randomUUID(),
        tenantId: TENANT_ID,
        clientId: PACIENTE_ID,
        authorUserId: DUENA_ID,
        appointmentId: CITA_VIEJA_ID,
        kind: "TREATMENT_SESSION",
        body: { v: 1, dolor: 5, tratamientos: [QUIROPODIA] },
        createdAt: new Date("2026-09-21T09:00:00.000Z"),
      },
      {
        id: randomUUID(),
        tenantId: TENANT_ID,
        clientId: PACIENTE_ID,
        authorUserId: DUENA_ID,
        appointmentId: "55555555-5555-5555-5555-555555555553",
        kind: "TREATMENT_SESSION",
        body: { v: 1, dolor: 7, tratamientos: [QUIROPODIA] },
        createdAt: new Date("2026-09-07T09:00:00.000Z"),
      },
    );
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: `/clinica/appointments/${CITA_ID}/sesion`,
      headers: comoDuena,
    });
    expect(r.json().cabecera.numeroDeVisita).toBe(3);
    // La gráfica del dolor, de la más antigua a la más reciente.
    expect(r.json().dolorHistorico.map((p: any) => p.dolor)).toEqual([7, 5]);
    // Y lo de la visita ANTERIOR, que es lo que «Igual que la última vez»
    // va a sumar.
    expect(r.json().anterior).toMatchObject({ dolor: 5 });
  });

  it("la exploración PARTE de la última, no de cero", async () => {
    const app = await buildApp();
    await app.inject({
      method: "POST",
      url: `/clinica/appointments/${CITA_VIEJA_ID}/sesion/exploracion`,
      headers: comoDuena,
      payload: {
        pulsos: { L: "AUSENTE", R: "DEBIL" },
        sinSensibilidad: [ZONA, "R:talon"],
        tipoDePie: "PLANO",
      },
    });
    const r = await app.inject({
      method: "GET",
      url: `/clinica/appointments/${CITA_ID}/sesion`,
      headers: comoDuena,
    });
    expect(r.json().exploracion.departeDe).toEqual({
      pulsos: { L: "AUSENTE", R: "DEBIL" },
      sinSensibilidad: [ZONA, "R:talon"],
      tipoDePie: "PLANO",
    });
    expect(r.json().exploracion.ultima).toMatchObject({
      autor: "Lucía Martín",
    });
  });

  it("las listas con las que se pinta viajan en la respuesta, con su versión", async () => {
    // Y no las lleva la pantalla por su cuenta: son la versión con la que
    // se va a escribir, y la pantalla tiene que pintar ESA y no «la que
    // tenga compilada».
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: `/clinica/appointments/${CITA_ID}/sesion`,
      headers: comoDuena,
    });
    expect(r.json().listas.mapa.version).toBe(1);
    expect(r.json().listas.mapa.zonas).toHaveLength(11);
    expect(r.json().listas.lesiones.lesiones).toHaveLength(7);
    expect(r.json().listas.consejos.consejos).toHaveLength(5);
  });
});

// ── 10 · El servidor no se fía del front ────────────────────────────

describe("clinica-3 · el servidor vuelve a decidirlo todo", () => {
  beforeEach(() => conValoracionValidada());

  it("la gravedad sin lesión no entra en la historia aunque la mande la pantalla", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: `/clinica/appointments/${CITA_ID}/sesion/cerrar`,
      headers: comoDuena,
      payload: {
        ...CERRAR_MINIMO,
        // El schema exige `lesion`, así que lo que puede llegar es una
        // lesión que NO está en la lista: la marca entera se tira.
        marcas: { [ZONA]: { lesion: "amputación", gravedad: "SEVERA" } },
      },
    });
    expect(r.statusCode).toBe(201);
    expect(r.json().cerrada.cuerpo.marcas).toEqual({});
  });

  it("una zona que no es del mapa se tira en silencio y la buena se queda", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: `/clinica/appointments/${CITA_ID}/sesion/cerrar`,
      headers: comoDuena,
      payload: {
        ...CERRAR_MINIMO,
        marcas: {
          "L:oreja": { lesion: "callo", gravedad: "LEVE" },
          [ZONA]: { lesion: "unero", gravedad: "MODERADA" },
        },
      },
    });
    expect(Object.keys(r.json().cerrada.cuerpo.marcas)).toEqual([ZONA]);
    // Y se lee en palabras, con el vocabulario de SU versión.
    expect(r.json().cerrada.marcas).toEqual([
      {
        clave: ZONA,
        zona: "Pie izq. · Dedo gordo",
        lesion: "Uña encarnada",
        gravedad: "Moderada",
      },
    ]);
  });

  it("un servicio que no está marcado en el catálogo no pone línea", async () => {
    // clinica-3 contestaba 409 SIN_TRATAMIENTOS: una sesión sin
    // tratamientos no se podía cerrar. **clinica-5 lo cambia a propósito**
    // (regla 11 del prompt): un tipo sin servicio asignado se ve «sin
    // cobro», y la visita se registra igual. Negarse a escribir la
    // historia de algo que PASÓ por una casilla del catálogo era perder
    // la historia, no proteger el cobro.
    //
    // Lo que sigue siendo verdad es que el servicio no entra: `PRIMERA_
    // VISITA` no está marcado como tratamiento de sesión, así que no es
    // una línea.
    conValoracionValidada();
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: `/clinica/appointments/${CITA_ID}/sesion/cerrar`,
      headers: comoDuena,
      payload: cerrarCon([PRIMERA_VISITA], { dolor: 3 }),
    });
    expect(r.statusCode).toBe(201);
    expect(r.json().cerrada.cuerpo.tratamientos).toEqual([]);
    expect(r.json().cerrada.resumen.lineas).toEqual([]);
    // Y el cobro cae al camino de siempre (los servicios de la cita), que
    // es lo que impide un ticket vacío. «Cobrar siempre se puede».
    expect(
      await lineasDeLaSesionCerrada(fakePrisma, {
        tenantId: TENANT_ID,
        appointmentId: CITA_ID,
      }),
    ).toBeNull();
  });

  it("sin TIPOS, el schema lo rechaza antes de llegar", async () => {
    // Era «sin tratamientos». Lo obligatorio pasó a ser el tipo de visita
    // (decisión 1: como mínimo uno), porque una visita sin tipo no se sabe
    // qué fue.
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: `/clinica/appointments/${CITA_ID}/sesion/cerrar`,
      headers: comoDuena,
      payload: { tipos: [], dolor: 3 },
    });
    expect(r.statusCode).toBe(400);
  });

  it("sin dolor tampoco: es obligatorio", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: `/clinica/appointments/${CITA_ID}/sesion/cerrar`,
      headers: comoDuena,
      payload: { tipos: ["QUIROPODIA"], bloques: { QUIROPODIA: { servicios: [QUIROPODIA] } } },
    });
    expect(r.statusCode).toBe(400);
  });

  it("pero CERO sí vale: «ya no me duele» es una respuesta", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: `/clinica/appointments/${CITA_ID}/sesion/cerrar`,
      headers: comoDuena,
      payload: cerrarCon([QUIROPODIA], { dolor: 0 }),
    });
    expect(r.statusCode).toBe(201);
    expect(r.json().cerrada.cuerpo.dolor).toBe(0);
  });

  it("un dolor de 11 o de -1 no pasa el schema", async () => {
    const app = await buildApp();
    for (const dolor of [11, -1, 4.5]) {
      const r = await app.inject({
        method: "POST",
        url: `/clinica/appointments/${CITA_ID}/sesion/cerrar`,
        headers: comoDuena,
        payload: cerrarCon([QUIROPODIA], { dolor }),
      });
      expect(r.statusCode, `dolor ${dolor}`).toBe(400);
    }
  });

  it("un consejo o una evolución inventados se tiran sin tumbar el cierre", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: `/clinica/appointments/${CITA_ID}/sesion/cerrar`,
      headers: comoDuena,
      payload: {
        ...CERRAR_MINIMO,
        consejos: ["calzado", "andar-descalzo"],
        evolucion: null,
      },
    });
    expect(r.statusCode).toBe(201);
    expect(r.json().cerrada.cuerpo.consejos).toEqual(["calzado"]);
    expect(r.json().cerrada.cuerpo.evolucion).toBeNull();
  });

  it("la próxima cita queda como PROPUESTA y no reserva nada", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: `/clinica/appointments/${CITA_ID}/sesion/cerrar`,
      headers: comoDuena,
      payload: { ...CERRAR_MINIMO, proximaCita: "S4" },
    });
    expect(r.json().cerrada.cuerpo.proximaCita).toBe("S4");
    // NO nació ninguna cita nueva: la recepción elige el hueco con el
    // paciente delante (prompt §3).
    expect(citas).toHaveLength(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// clinica-5 · LA SESIÓN POR TIPO DE VISITA
// ═══════════════════════════════════════════════════════════════════════
//
// Lo de arriba sigue siendo verdad y por eso no se ha tocado: la puerta,
// el doble cierre, la inmutabilidad, los importes por rol. Esto es lo que
// el bloque añade, contra las rutas de verdad.

const BASICA = "77777777-7777-4777-8777-777777777771";
const COMPLETA = "77777777-7777-4777-8777-777777777772";
const EXTRA = "77777777-7777-4777-8777-777777777773";
const CURA = "77777777-7777-4777-8777-777777777774";
const CONSULTA_RIESGO = "77777777-7777-4777-8777-777777777775";

/** El catálogo de Rosario: los tres niveles de quiropodia y la cura de la
 *  revisión de cirugía, cada uno en su categoría. */
function conCatalogoDeRosario(options: { conServicioDeRiesgo?: boolean } = {}) {
  mapaDeTipos = [
    { slug: "podologia", visitType: "QUIROPODIA" },
    { slug: "cirugia", visitType: "CIRUGIA" },
    { slug: "pie-de-riesgo", visitType: "PIE_RIESGO" },
  ];
  const base = {
    tenantId: TENANT_ID,
    kind: "SERVICE",
    taxRate: 0,
    active: true,
    tratamientoSesion: true,
  };
  productos.push(
    {
      ...base,
      id: BASICA,
      name: "Quiropodia básica",
      sku: "Q-1",
      basePrice: 25,
      tags: ["podologia"],
      scheduling: { nivelQuiropodia: 1 },
    },
    {
      ...base,
      id: COMPLETA,
      name: "Quiropodia completa",
      sku: "Q-2",
      basePrice: 26,
      tags: ["podologia"],
      scheduling: { nivelQuiropodia: 2 },
    },
    {
      ...base,
      id: EXTRA,
      name: "Quiropodia extra",
      sku: "Q-3",
      basePrice: 27,
      tags: ["podologia"],
      scheduling: { nivelQuiropodia: 3 },
    },
    {
      ...base,
      id: CURA,
      name: "Cura",
      sku: "Q-CURA",
      basePrice: 13,
      tags: ["cirugia"],
      scheduling: { nivelQuiropodia: null },
    },
  );
  if (options.conServicioDeRiesgo) {
    productos.push({
      ...base,
      id: CONSULTA_RIESGO,
      name: "Consulta de pie de riesgo",
      sku: "Q-RIESGO",
      basePrice: 20,
      tags: ["pie-de-riesgo"],
      scheduling: { nivelQuiropodia: null },
    });
  }
}

/** Le da a Carmen las alertas de la valoración validada: diabética y
 *  anticoagulada. Salen de la entrada `INITIAL_ASSESSMENT`, igual que en
 *  la pantalla de la valoración. */
function conAlertasDeCarmen() {
  const entryId = randomUUID();
  entradas.push({
    id: entryId,
    tenantId: TENANT_ID,
    clientId: PACIENTE_ID,
    authorUserId: DUENA_ID,
    appointmentId: null,
    kind: "INITIAL_ASSESSMENT",
    body: { v: 1, respuestas: { diab: "SI", antic: "SI" } },
    createdAt: new Date("2026-09-07T08:00:00.000Z"),
  });
  // La valoración apunta a su entrada, como en la base: las respuestas no
  // viven en la fila de estado, viven en la entrada inmutable.
  valoraciones[valoraciones.length - 1]!.entryId = entryId;
}

async function cerrarV2(payload: Record<string, unknown>) {
  const app = await buildApp();
  return app.inject({
    method: "POST",
    url: `/clinica/appointments/${CITA_ID}/sesion/cerrar`,
    headers: comoDuena,
    payload,
  });
}

describe("clinica-5 · el nivel de quiropodia decide qué producto se cobra", () => {
  beforeEach(() => {
    conValoracionValidada();
    conCatalogoDeRosario();
  });

  it("los actos proponen el nivel y el nivel pone la línea", async () => {
    // Corte + enucleación = completa (26 €), y la línea que pasa a caja es
    // el PRODUCTO de ese nivel. No hay que tocar ningún chip de precio.
    const r = await cerrarV2({
      tipos: ["QUIROPODIA"],
      bloques: { QUIROPODIA: { actos: ["corte", "helomas"] } },
      dolor: 3,
    });
    expect(r.statusCode).toBe(201);
    const cuerpo = r.json().cerrada.cuerpo;
    expect(cuerpo.bloques.QUIROPODIA.nivelPropuesto).toBe(2);
    expect(cuerpo.bloques.QUIROPODIA.nivelElegido).toBe(2);
    expect(cuerpo.tratamientos).toEqual([COMPLETA]);
    expect(r.json().cerrada.resumen.total).toBe(26);
  });

  it("cambiarlo a mano queda escrito: «propuesto completa, cobrado extra»", async () => {
    const r = await cerrarV2({
      tipos: ["QUIROPODIA"],
      bloques: { QUIROPODIA: { actos: ["corte", "helomas"], nivelElegido: 3 } },
      dolor: 3,
    });
    const b = r.json().cerrada.cuerpo.bloques.QUIROPODIA;
    // LAS DOS COSAS escritas, no una: es lo que hace auditable el cobro.
    expect(b.nivelPropuesto).toBe(2);
    expect(b.nivelElegido).toBe(3);
    expect(r.json().cerrada.cuerpo.tratamientos).toEqual([EXTRA]);
    expect(r.json().cerrada.resumen.total).toBe(27);
  });

  it("el SERVIDOR recalcula el nivel propuesto: no se cree a la pantalla", async () => {
    // La pantalla manda «fresado» (extra) y dice que el propuesto era
    // básica. El cuerpo guarda lo que dicen los actos.
    const r = await cerrarV2({
      tipos: ["QUIROPODIA"],
      bloques: { QUIROPODIA: { actos: ["fresado"] } },
      dolor: 3,
    });
    expect(r.json().cerrada.cuerpo.bloques.QUIROPODIA.nivelPropuesto).toBe(3);
  });

  it("el nivel sin producto en el catálogo es «sin cobro», no un cobro a cero", async () => {
    productos = productos.filter((p) => p.id !== EXTRA);
    const r = await cerrarV2({
      tipos: ["QUIROPODIA"],
      bloques: { QUIROPODIA: { actos: ["fresado"] } },
      dolor: 3,
    });
    expect(r.statusCode).toBe(201);
    expect(r.json().cerrada.cuerpo.bloques.QUIROPODIA.productoDelNivel).toBeNull();
    expect(r.json().cerrada.cuerpo.tratamientos).toEqual([]);
  });

  it("los tres niveles NO salen como botones sueltos de la tarjeta", async () => {
    // Un chip de «Quiropodia extra» al lado del selector de nivel sería la
    // misma línea cobrable por dos caminos.
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: `/clinica/appointments/${CITA_ID}/sesion`,
      headers: comoDuena,
    });
    const niveles = r
      .json()
      .tratamientos.filter((t: any) => t.nivelQuiropodia != null);
    expect(niveles.map((t: any) => t.nivelQuiropodia).sort()).toEqual([1, 2, 3]);
    // Están en la respuesta (el selector de nivel los necesita), pero
    // marcados: la pantalla los saca de los chips por este campo.
    expect(
      r.json().tratamientos.find((t: any) => t.serviceId === CURA),
    ).toMatchObject({ tipo: "CIRUGIA", nivelQuiropodia: null });
  });
});

describe("clinica-5 · DOS TIPOS, DOS LÍNEAS a caja", () => {
  beforeEach(() => {
    conValoracionValidada();
    conCatalogoDeRosario();
  });

  it("quiropodia completa + cura = 39 €, y el cobro lo lee tal cual", async () => {
    const r = await cerrarV2({
      tipos: ["QUIROPODIA", "CIRUGIA"],
      bloques: {
        QUIROPODIA: { actos: ["corte", "helomas"] },
        CIRUGIA: { herida: "BIEN", puntos: "RETIRADOS", servicios: [CURA] },
      },
      dolor: 4,
    });
    expect(r.statusCode).toBe(201);
    expect(r.json().cerrada.cuerpo.tipos).toEqual(["QUIROPODIA", "CIRUGIA"]);
    expect(r.json().cerrada.resumen.lineas.map((l: any) => l.nombre)).toEqual([
      "Quiropodia completa",
      "Cura",
    ]);
    expect(r.json().cerrada.resumen.total).toBe(39);
    // Y el camino de cobro de siempre, sin saber que existen los tipos.
    expect(
      await lineasDeLaSesionCerrada(fakePrisma, {
        tenantId: TENANT_ID,
        appointmentId: CITA_ID,
      }),
    ).toEqual([{ serviceId: COMPLETA }, { serviceId: CURA }]);
  });

  it("un tipo sin servicio asignado se cierra igual y no pone línea", async () => {
    const r = await cerrarV2({
      tipos: ["QUIROPODIA", "PIE_RIESGO"],
      bloques: {
        QUIROPODIA: { actos: ["corte"] },
        PIE_RIESGO: {
          sensibilidad: "NORMAL",
          pulsos: { L: "PRESENTE", R: "PRESENTE" },
          ulcera: "NO",
          deformidad: "NO",
        },
      },
      dolor: 2,
    });
    expect(r.statusCode).toBe(201);
    expect(r.json().cerrada.cuerpo.tratamientos).toEqual([BASICA]);
    expect(r.json().cerrada.resumen.total).toBe(25);
  });

  it("y con su servicio asignado, sí", async () => {
    productos.length = 0;
    conCatalogoDeRosario({ conServicioDeRiesgo: true });
    const r = await cerrarV2({
      tipos: ["PIE_RIESGO"],
      bloques: { PIE_RIESGO: { servicios: [CONSULTA_RIESGO] } },
      dolor: 2,
    });
    expect(r.json().cerrada.cuerpo.tratamientos).toEqual([CONSULTA_RIESGO]);
    expect(r.json().cerrada.resumen.total).toBe(20);
  });

  it("los tipos de los SERVICIOS DE LA CITA vienen marcados al abrir", async () => {
    citaDe(CITA_ID)!.items = [
      { serviceId: BASICA, sortOrder: 0 },
      { serviceId: CURA, sortOrder: 1 },
    ];
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: `/clinica/appointments/${CITA_ID}/sesion`,
      headers: comoDuena,
    });
    expect(r.json().tiposSugeridos).toEqual(["QUIROPODIA", "CIRUGIA"]);
  });

  it("sin tipos no se cierra, y el motivo se lee", async () => {
    const r = await cerrarV2({ tipos: ["QUIROPODIA"], dolor: 2 });
    expect(r.statusCode).toBe(201);
    const sinTipo = await cerrarV2({ tipos: [], dolor: 2 });
    expect(sinTipo.statusCode).toBe(400);
  });
});

describe("clinica-5 · el pie de riesgo (IWGDF) se calcula y se congela", () => {
  beforeEach(() => {
    conValoracionValidada();
    conCatalogoDeRosario({ conServicioDeRiesgo: true });
  });

  it("riesgo alto con su plazo, y las señales que lo sostienen", async () => {
    const r = await cerrarV2({
      tipos: ["PIE_RIESGO"],
      bloques: {
        PIE_RIESGO: {
          sensibilidad: "PERDIDA",
          pulsos: { L: "AUSENTE", R: "PRESENTE" },
          ulcera: "SI",
          deformidad: "NO",
          servicios: [CONSULTA_RIESGO],
        },
      },
      dolor: 5,
    });
    expect(r.statusCode).toBe(201);
    const riesgo = r.json().cerrada.cuerpo.bloques.PIE_RIESGO.riesgo;
    expect(riesgo.categoria).toBe(3);
    expect(riesgo.plazo).toBe("Revisión cada 1–3 meses");
    expect(riesgo.senales).toEqual({
      perdidaDeSensibilidad: true,
      pulsosAusentes: true,
      ulcera: true,
      deformidad: false,
    });
  });

  it("sin las cuatro comprobaciones, el riesgo es null y la sesión se cierra", async () => {
    const r = await cerrarV2({
      tipos: ["PIE_RIESGO"],
      bloques: { PIE_RIESGO: { sensibilidad: "PERDIDA" } },
      dolor: 5,
    });
    expect(r.statusCode).toBe(201);
    expect(r.json().cerrada.cuerpo.bloques.PIE_RIESGO.riesgo).toBeNull();
  });

  it("la guía viaja con la pantalla, para que la tarjeta la cite igual", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: `/clinica/appointments/${CITA_ID}/sesion`,
      headers: comoDuena,
    });
    expect(r.json().listas.fuenteDelRiesgo).toContain("IWGDF");
  });
});

describe("clinica-5 · las alertas cruzadas con lo que se hace", () => {
  beforeEach(() => {
    conValoracionValidada();
    conAlertasDeCarmen();
    conCatalogoDeRosario();
  });

  it("las IDS de las alertas viajan con la cabecera, no sólo los textos", async () => {
    // La tabla de cruces cruza por `preguntaId` y nunca por el texto: una
    // alerta que deja de dispararse porque alguien corrigió una tilde es
    // el peor fallo posible en una señal de seguridad.
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: `/clinica/appointments/${CITA_ID}/sesion`,
      headers: comoDuena,
    });
    expect(r.json().cabecera.alertaIds).toEqual(["diab", "antic"]);
    expect(r.json().cabecera.alertas).toEqual(["Diabetes", "Anticoagulación"]);
  });

  it("anticoagulada + enucleación: el aviso queda ESCRITO en la sesión", async () => {
    const r = await cerrarV2({
      tipos: ["QUIROPODIA"],
      bloques: { QUIROPODIA: { actos: ["corte", "helomas"] } },
      dolor: 3,
    });
    const avisos = r.json().cerrada.cuerpo.avisos;
    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toMatch(/anticoagulada/i);
  });

  it("diabética + signos de infección: el aviso de las 48 h también", async () => {
    const r = await cerrarV2({
      tipos: ["CIRUGIA"],
      bloques: { CIRUGIA: { herida: "INFECCION", servicios: [CURA] } },
      dolor: 3,
    });
    const avisos = r.json().cerrada.cuerpo.avisos;
    // Dos: el de la infección y el de cortar (hay cirugía hoy).
    expect(avisos.some((a: string) => /48 h/.test(a))).toBe(true);
  });

  it("sin el acto que choca, no se escribe ningún aviso", async () => {
    const r = await cerrarV2({
      tipos: ["QUIROPODIA"],
      bloques: { QUIROPODIA: { actos: ["corte", "durezas"] } },
      dolor: 3,
    });
    expect(r.json().cerrada.cuerpo.avisos).toEqual([]);
  });

  it("el servidor NO se cree una lista de avisos que mande la pantalla", async () => {
    // `avisos` no está en el schema del cuerpo, así que Fastify lo quita
    // antes de llegar al handler (`removeAdditional`, el ajv de la casa) y
    // lo que se escribe es lo que la tabla de cruces dice con los actos de
    // verdad. Una sesión no puede constar como «avisada» sin que nadie
    // viera el aviso, y aquí no hay ni por dónde colarlo.
    const r = await cerrarV2({
      tipos: ["QUIROPODIA"],
      bloques: { QUIROPODIA: { actos: ["corte"] } },
      dolor: 3,
      avisos: ["me lo invento"],
    });
    expect(r.statusCode).toBe(201);
    expect(r.json().cerrada.cuerpo.avisos).toEqual([]);
  });
});

describe("clinica-5 · «Hoy toca» y el pendiente que no se cae", () => {
  beforeEach(() => {
    conValoracionValidada();
    conCatalogoDeRosario();
  });

  /** Una sesión anterior que dejó apuntado «revisar la uña operada». */
  function conPendienteDeLaUltima() {
    entradas.push({
      id: randomUUID(),
      tenantId: TENANT_ID,
      clientId: PACIENTE_ID,
      authorUserId: DUENA_ID,
      appointmentId: CITA_VIEJA_ID,
      kind: "TREATMENT_SESSION",
      body: {
        v: 2,
        tipos: ["CIRUGIA"],
        bloques: { CIRUGIA: { herida: "BIEN", puntos: "NO_LLEVA", servicios: [CURA] } },
        tratamientos: [CURA],
        tratamientosNombre: { [CURA]: "Cura" },
        marcas: { [ZONA]: { lesion: "unero", gravedad: "LEVE" } },
        dolor: 6,
        pendientesCreados: [
          { id: "revisar_una", zona: ZONA, nota: null, desde: "2026-09-21T09:00:00.000Z" },
        ],
        pendientesCerrados: [],
      },
      createdAt: new Date("2026-09-21T09:00:00.000Z"),
    });
  }

  it("la pantalla lo trae arriba, con su zona y su fecha de origen", async () => {
    conPendienteDeLaUltima();
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: `/clinica/appointments/${CITA_ID}/sesion`,
      headers: comoDuena,
    });
    expect(r.json().pendientes).toEqual([
      {
        id: "revisar_una",
        zona: ZONA,
        nota: null,
        desde: "2026-09-21T09:00:00.000Z",
      },
    ]);
  });

  it("se cierra SOLO al tocar esa zona", async () => {
    conPendienteDeLaUltima();
    const r = await cerrarV2({
      tipos: ["QUIROPODIA"],
      bloques: { QUIROPODIA: { actos: ["corte"] } },
      marcas: { [ZONA]: { lesion: "unero", gravedad: "LEVE" } },
      dolor: 3,
    });
    const cuerpo = r.json().cerrada.cuerpo;
    expect(cuerpo.pendientesCerrados).toEqual([
      { id: "revisar_una", zona: ZONA, como: "ZONA" },
    ]);
    expect(cuerpo.pendientesCreados).toEqual([]);
  });

  it("SIN tocarla, PASA A LA SIGUIENTE con su fecha original", async () => {
    // El eslabón que no se puede romper: un pendiente sin hacer no se cae
    // nunca, haga lo que haga la pantalla.
    conPendienteDeLaUltima();
    const r = await cerrarV2({
      tipos: ["QUIROPODIA"],
      bloques: { QUIROPODIA: { actos: ["corte"] } },
      dolor: 3,
    });
    const cuerpo = r.json().cerrada.cuerpo;
    expect(cuerpo.pendientesCerrados).toEqual([]);
    expect(cuerpo.pendientesCreados).toEqual([
      {
        id: "revisar_una",
        zona: ZONA,
        nota: null,
        desde: "2026-09-21T09:00:00.000Z",
      },
    ]);
  });

  it("y cerrarlo a mano SIN haber estado abierto no cuenta", async () => {
    // Un pendiente cerrado que nadie apuntó es un dato inventado en una
    // historia clínica.
    const r = await cerrarV2({
      tipos: ["QUIROPODIA"],
      bloques: { QUIROPODIA: { actos: ["corte"] } },
      dolor: 3,
      pendientesCerrados: [
        { id: "revisar_una", zona: ZONA, como: "PREGUNTA" },
      ],
    });
    expect(r.json().cerrada.cuerpo.pendientesCerrados).toEqual([]);
  });

  it("contestar «sí, revisada» en el diálogo SÍ lo cierra", async () => {
    conPendienteDeLaUltima();
    const r = await cerrarV2({
      tipos: ["QUIROPODIA"],
      bloques: { QUIROPODIA: { actos: ["corte"] } },
      dolor: 3,
      pendientesCerrados: [
        { id: "revisar_una", zona: ZONA, como: "PREGUNTA" },
      ],
    });
    expect(r.json().cerrada.cuerpo.pendientesCerrados).toEqual([
      { id: "revisar_una", zona: ZONA, como: "PREGUNTA" },
    ]);
    expect(r.json().cerrada.cuerpo.pendientesCreados).toEqual([]);
  });

  it("lo que se apunta hoy para la próxima queda con la fecha de hoy", async () => {
    const r = await cerrarV2({
      tipos: ["QUIROPODIA"],
      bloques: { QUIROPODIA: { actos: ["corte"] } },
      dolor: 3,
      pendientesNuevos: [{ id: "control_riesgo" }],
    });
    const creados = r.json().cerrada.cuerpo.pendientesCreados;
    expect(creados).toHaveLength(1);
    expect(creados[0].id).toBe("control_riesgo");
    expect(typeof creados[0].desde).toBe("string");
  });

  it("una sesión anterior v1 no trae pendientes: el concepto no existía", async () => {
    entradas.push({
      id: randomUUID(),
      tenantId: TENANT_ID,
      clientId: PACIENTE_ID,
      authorUserId: DUENA_ID,
      appointmentId: CITA_VIEJA_ID,
      kind: "TREATMENT_SESSION",
      body: { v: 1, dolor: 5, tratamientos: [QUIROPODIA], marcas: {} },
      createdAt: new Date("2026-09-21T09:00:00.000Z"),
    });
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: `/clinica/appointments/${CITA_ID}/sesion`,
      headers: comoDuena,
    });
    expect(r.json().pendientes).toEqual([]);
    // Y la sesión v1 se sigue leyendo como lo de la visita anterior.
    expect(r.json().anterior.dolor).toBe(5);
  });
});

describe("clinica-5 · la cabecera de la tarjeta de revisión de cirugía", () => {
  beforeEach(() => {
    conValoracionValidada();
    conCatalogoDeRosario();
  });

  it("sale de la última visita de tipo CIRUGÍA: fecha, técnica y zona", async () => {
    entradas.push({
      id: randomUUID(),
      tenantId: TENANT_ID,
      clientId: PACIENTE_ID,
      authorUserId: DUENA_ID,
      appointmentId: CITA_VIEJA_ID,
      kind: "TREATMENT_SESSION",
      body: {
        v: 2,
        mapaVersion: 1,
        lesionesVersion: 1,
        tipos: ["CIRUGIA"],
        bloques: { CIRUGIA: { herida: "BIEN", puntos: "NO_LLEVA", servicios: [CURA] } },
        tratamientos: [CURA],
        tratamientosNombre: { [CURA]: "Cura" },
        marcas: { [ZONA]: { lesion: "unero", gravedad: "LEVE" } },
        dolor: 6,
        pendientesCreados: [],
        pendientesCerrados: [],
      },
      createdAt: new Date("2026-10-06T09:00:00.000Z"),
    });
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: `/clinica/appointments/${CITA_ID}/sesion`,
      headers: comoDuena,
    });
    expect(r.json().ultimaCirugia).toEqual({
      fecha: "2026-10-06T09:00:00.000Z",
      tecnica: ["Cura"],
      zonas: ["Pie izq. · Dedo gordo"],
    });
  });

  it("sin ninguna cirugía en la historia: null, no una fecha inventada", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: `/clinica/appointments/${CITA_ID}/sesion`,
      headers: comoDuena,
    });
    expect(r.json().ultimaCirugia).toBeNull();
  });
});

// ── clinica-4 · la segunda puerta SALE POR EL CABLE ──────────────────
//
// Este bloque existe por un fallo que encontró el BUCLE VISUAL y no la
// suite: `serializarVista` es un allowlist campo a campo, y el campo
// nuevo no estaba en la lista. La respuesta real no llevaba
// `consentimientos`, y la sesión se caía contra el ErrorBoundary con
// «Cannot read properties of undefined (reading 'puede')».
//
// Los tests de la pantalla no lo veían porque mockean la respuesta; los
// de la vista no lo veían porque miran el objeto, no el serializado. Lo
// que lo vio fue abrir la sesión en el producto — y lo que lo fija es
// mirar el JSON que SALE.

describe("clinica-4 · la vista serializada lleva la segunda puerta", () => {
  it("el JSON de la sesión trae `consentimientos` con su forma", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: `/clinica/appointments/${CITA_ID}/sesion`,
      headers: comoDuena,
    });
    expect(r.statusCode).toBe(200);
    // La forma entera, no sólo la clave: con `faltan` ausente la pantalla
    // se caería igual al pintar la banda.
    expect(r.json().consentimientos).toEqual({
      puede: true,
      faltan: [],
      mensaje: "",
    });
  });

  it("y la trae TAMBIÉN para el sanitario sin caja", async () => {
    // El serializador tiene dos caminos por rol (la regla 8 de los
    // importes). Un campo que sólo salga en uno de los dos es una
    // pantalla que se cae para la mitad del personal.
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: `/clinica/appointments/${CITA_ID}/sesion`,
      headers: comoSanitaria,
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().consentimientos).toBeDefined();
    expect(r.json().consentimientos.puede).toBe(true);
  });
});
