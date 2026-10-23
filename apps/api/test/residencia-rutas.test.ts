// residencia-1 · LAS RUTAS, con Prisma en memoria.
//
// Lo que se prueba aquí y no en el e2e: lo que decide la APLICACIÓN. El
// motor (que no se borra, que una cama tiene un residente, que un rol de
// serie no cambia de categoría) lo prueba `residencia-1.e2e.ts` contra
// Postgres de verdad, porque eso es justamente lo que un falso no puede
// probar.
//
// Las cinco garantías de este fichero:
//
//   1. Con el módulo apagado las rutas contestan **404**, y la 404 es
//      INDISTINGUIBLE de la de una ruta que no existe.
//   2. La PUERTA no es un TPV: un `ROOM` recibe 403 en la puerta de todas
//      las rutas del TPV —así que no puede cobrar, abrir turno ni emitir
//      un registro— y un TERMINAL recibe 403 en las rutas de la puerta.
//   3. `GET /residencia/puerta/me` NO lleva ni un dato de salud.
//   4. La ficha de un residente deja su línea en el registro de accesos, y
//      la DENEGADA también.
//   5. La lista NO deja líneas: no es historia, es el cuadrante.

import { randomBytes, randomUUID } from "node:crypto";

import {
  contratoFake,
  kekDePrueba,
  llaveroFake,
} from "./clinica-7-claves-fake.js";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.REDIS_URL = "redis://localhost:6379";
process.env.JWT_ACCESS_SECRET = "a".repeat(40);
process.env.JWT_REFRESH_SECRET = "b".repeat(40);
process.env.HOLDED_KEY_ENCRYPTION_SECRET = randomBytes(32).toString("base64");

// clinica-7 · LA KEK DE ESTE FICHERO, y hace falta aunque aquí no se cifre
// nada. La ficha del residente pasa por `conHistoria`, el punto por el que
// pasa todo lo clínico: el día que una ruta de residencia guarde un dato de
// salud lo hará por ahí y necesitará la DEK.
kekDePrueba();

import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";

const TENANT = "00000000-0000-0000-0000-000000000001";
const DIRECTORA = "11111111-1111-1111-1111-111111111111";
const AUXILIAR = "22222222-2222-2222-2222-222222222222";
const DUE = "33333333-3333-3333-3333-333333333333";
const CARMEN = "44444444-4444-4444-4444-444444444444";
const LUIS = "55555555-5555-5555-5555-555555555555";
const PLANTA_1 = "aaaaaaaa-0000-0000-0000-000000000001";
const PLANTA_2 = "aaaaaaaa-0000-0000-0000-000000000002";
const HAB_112 = "bbbbbbbb-0000-0000-0000-000000000001";
const HAB_201 = "bbbbbbbb-0000-0000-0000-000000000002";
const CAMA_112A = "cccccccc-0000-0000-0000-000000000001";
const CAMA_201A = "cccccccc-0000-0000-0000-000000000002";
const ROL_AUXILIAR = "dddddddd-0000-0000-0000-000000000001";
const ROL_DUE = "dddddddd-0000-0000-0000-000000000002";

// ── Prisma en memoria ────────────────────────────────────────────────

let residenciaEncendida = true;
let clinicaEncendida = true;

interface Usuario {
  id: string;
  role: "OWNER" | "MANAGER" | "CASHIER" | "CLINICIAN";
  isClinician: boolean;
  clinicianLicense: string | null;
}
const usuarios = new Map<string, Usuario>();

interface Rol {
  id: string;
  code: string;
  name: string;
  category: string;
  active: boolean;
  recordsCare: boolean;
  requiresLicense: boolean;
  fullScope: boolean;
  isStandard: boolean;
  sortOrder: number;
}
const roles = new Map<string, Rol>();

interface AsigRol {
  id: string;
  userId: string;
  careRoleId: string;
  fromAt: Date;
  toAt: Date | null;
  revokedAt: Date | null;
}
let asigRoles: AsigRol[] = [];

interface AsigZona {
  id: string;
  userId: string;
  floorId: string | null;
  fromAt: Date;
  toAt: Date | null;
}
let asigZonas: AsigZona[] = [];

interface Ocupacion {
  id: string;
  bedId: string;
  clientId: string;
  fromAt: Date;
  toAt: Date | null;
  reason: string | null;
}
let ocupaciones: Ocupacion[] = [];

const camas = new Map<string, { id: string; roomId: string; label: string; active: boolean }>();
const habitaciones = new Map<
  string,
  { id: string; floorId: string; number: string; name: string | null; active: boolean }
>();
const plantas = new Map<string, { id: string; name: string; sortOrder: number }>();
const perfiles = new Map<
  string,
  {
    clientId: string;
    admissionDate: Date;
    dischargeDate: Date | null;
    dischargeReason: string | null;
    dependencyLevel: string;
    dependencyGrade: string | null;
    placeType: string;
    responsibleName: string | null;
    responsiblePhone: string | null;
    responsibleRelation: string | null;
    dni: string | null;
    nss: string | null;
  }
>();
const clientes = new Map<string, { id: string; firstName: string; lastName: string }>();

const registro: Array<{
  userId: string;
  clientId: string;
  action: string;
  outcome: string;
  route: string | null;
}> = [];

// El dispositivo de la puerta de la 112, y un terminal de caja.
const PUERTA_TOKEN = "token-de-la-puerta-de-la-112";
const TERMINAL_TOKEN = "token-del-terminal-de-la-caja";
const dispositivos = new Map<
  string,
  {
    id: string;
    tenantId: string;
    kind: "TERMINAL" | "ROOM";
    roomId: string | null;
    registerId: string | null;
    revokedAt: Date | null;
    name: string | null;
    hash: string;
  }
>();

function ahoraOk(a: { fromAt: Date; toAt: Date | null }, now: Date) {
  return a.fromAt <= now && (a.toAt == null || a.toAt > now);
}

const turnos = [
  { id: "t-m", code: "M", name: "Mañana", startsAt: "08:00", endsAt: "15:00", sortOrder: 1 },
  { id: "t-t", code: "T", name: "Tarde", startsAt: "15:00", endsAt: "22:00", sortOrder: 2 },
  { id: "t-n", code: "N", name: "Noche", startsAt: "22:00", endsAt: "08:00", sortOrder: 3 },
];

/**
 * alta-minima · las líneas de plan VIVAS de un residente en el doble.
 *
 * El `select` de las rutas pide `client.carePlanItems` con `take: 1` para
 * saber si le falta el plan de cuidados. Sin esto, el doble devuelve
 * `undefined` y la ruta contesta 500 leyendo `.length` — que es
 * exactamente lo que pasó al añadirlo.
 */
const lineasDePlan: Array<{ id: string; clientId: string; toAt: Date | null }> = [];

function vistaPerfil(clientId: string, conOcupacion: boolean) {
  const p = perfiles.get(clientId)!;
  const c = clientes.get(clientId)!;
  const vigente = ocupaciones.find((o) => o.clientId === clientId && o.toAt == null);
  const cama = vigente ? camas.get(vigente.bedId)! : null;
  const hab = cama ? habitaciones.get(cama.roomId)! : null;
  const planta = hab ? plantas.get(hab.floorId)! : null;
  return {
    ...p,
    client: {
      id: c.id,
      firstName: c.firstName,
      lastName: c.lastName,
      phone: null,
      birthdate: null,
      bedAssignments:
        conOcupacion && vigente && cama && hab && planta
          ? [
              {
                id: vigente.id,
                fromAt: vigente.fromAt,
                bed: {
                  id: cama.id,
                  label: cama.label,
                  room: {
                    id: hab.id,
                    number: hab.number,
                    name: hab.name,
                    floor: { id: planta.id, name: planta.name },
                  },
                },
              },
            ]
          : [],
      // alta-minima · `toAt: null` y `take: 1`, como el `select`.
      carePlanItems: lineasDePlan
        .filter((l) => l.clientId === clientId && l.toAt == null)
        .slice(0, 1)
        .map((l) => ({ id: l.id })),
    },
  };
}

// clinica-7 · el llavero de la clínica, en memoria. No se cifra nada en
// este fichero, pero el modelo tiene que existir para que `dekONada` no se
// encuentre un `undefined`.
const llavero = llaveroFake();
// Y EL CONTRATO DE ENCARGADO, ACEPTADO. Esto es lo que faltaba: desde
// clinica-7, `conHistoria` pregunta por el estado del contrato en TODA
// ruta clínica —y la ficha de un residente lo es—, así que un `fakePrisma`
// sin `clinicalProcessorAgreement` contesta 500 «reading findMany».
//
// Nace ACEPTADO porque un centro de residencia que funciona es uno que
// tiene el contrato aceptado: `tenants_residencia_exige_clinica` no deja
// encender la residencia sin la clínica, y la clínica sin contrato no
// escribe. El 423 se prueba revocándolo, no al contrario.
const contrato = contratoFake(TENANT, DIRECTORA);

const fakePrisma = {
  clinicalTenantKey: llavero.modelo,
  clinicalProcessorAgreement: contrato.modelo,
  tenant: {
    findUnique: vi.fn(async () => ({
      clinicalRecordsEnabled: clinicaEncendida,
      residenciaEnabled: residenciaEncendida,
    })),
  },
  user: {
    findFirst: vi.fn(async ({ where }: any) => {
      const u = usuarios.get(where.id);
      if (!u) return null;
      return u;
    }),
    update: vi.fn(async ({ where, data }: any) => {
      const u = usuarios.get(where.id)!;
      if (data.isClinician !== undefined) u.isClinician = data.isClinician;
      if (data.clinicianLicense !== undefined) u.clinicianLicense = data.clinicianLicense;
      return u;
    }),
  },
  clinicalAccess: { findFirst: vi.fn(async () => null) },
  // residencia-3 (D-64) · la ficha pregunta si hay consentimiento de
  // IMAGEN vigente, para decir si la puerta pinta la foto o las
  // iniciales. Vacío: ninguno de estos residentes lo tiene, que es el
  // caso por defecto y el que este fichero prueba (la ficha se sirve
  // igual).
  clientConsent: { findMany: vi.fn(async () => []) },
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
  careRoleAssignment: {
    findMany: vi.fn(async ({ where }: any) => {
      const now: Date = where.fromAt?.lte ?? new Date();
      return asigRoles
        .filter((a) => {
          if (where.userId && a.userId !== where.userId) return false;
          if (where.revokedAt === null && a.revokedAt != null) return false;
          if (!ahoraOk(a, now)) return false;
          const rol = roles.get(a.careRoleId)!;
          if (where.careRole?.active === true && !rol.active) return false;
          return true;
        })
        .map((a) => {
          const rol = roles.get(a.careRoleId)!;
          return {
            id: a.id,
            userId: a.userId,
            fromAt: a.fromAt,
            toAt: a.toAt,
            revokedAt: a.revokedAt,
            careRole: { ...rol, fullScope: rol.fullScope },
          };
        });
    }),
    findFirst: vi.fn(async ({ where }: any) => {
      const f = asigRoles.find(
        (a) =>
          a.userId === where.userId &&
          a.careRoleId === where.careRoleId &&
          a.revokedAt == null,
      );
      return f ? { id: f.id } : null;
    }),
  },
  careZoneAssignment: {
    findMany: vi.fn(async ({ where }: any) => {
      const now: Date = where.fromAt?.lte ?? new Date();
      return asigZonas
        .filter((z) => {
          if (where.userId && z.userId !== where.userId) return false;
          if (where.toAt === null && z.toAt != null) return false;
          if (where.fromAt && !ahoraOk(z, now)) return false;
          return true;
        })
        .map((z) => ({
          id: z.id,
          userId: z.userId,
          floorId: z.floorId,
          fromAt: z.fromAt,
          toAt: z.toAt,
          floor: z.floorId ? plantas.get(z.floorId) : null,
        }));
    }),
  },
  bedAssignment: {
    findFirst: vi.fn(async ({ where }: any) => {
      const o = ocupaciones.find(
        (x) => x.clientId === where.clientId && x.toAt == null,
      );
      if (!o) return null;
      const cama = camas.get(o.bedId)!;
      const hab = habitaciones.get(cama.roomId)!;
      return {
        id: o.id,
        bedId: o.bedId,
        bed: { room: { floorId: hab.floorId } },
      };
    }),
    findMany: vi.fn(async ({ where }: any) =>
      ocupaciones
        .filter((o) => o.clientId === where.clientId)
        .map((o) => {
          const cama = camas.get(o.bedId)!;
          const hab = habitaciones.get(cama.roomId)!;
          const planta = plantas.get(hab.floorId)!;
          return {
            id: o.id,
            fromAt: o.fromAt,
            toAt: o.toAt,
            reason: o.reason,
            bed: {
              label: cama.label,
              room: { number: hab.number, floor: { name: planta.name } },
            },
          };
        }),
    ),
    count: vi.fn(async () => 0),
  },
  residentProfile: {
    findMany: vi.fn(async ({ where }: any) => {
      let ids = [...perfiles.keys()];
      if (where.dischargeDate === null) {
        ids = ids.filter((id) => perfiles.get(id)!.dischargeDate == null);
      }
      const plantasPedidas: string[] | undefined =
        where.client?.bedAssignments?.some?.bed?.room?.floorId?.in;
      if (plantasPedidas) {
        ids = ids.filter((id) => {
          const o = ocupaciones.find((x) => x.clientId === id && x.toAt == null);
          if (!o) return false;
          const cama = camas.get(o.bedId)!;
          return plantasPedidas.includes(habitaciones.get(cama.roomId)!.floorId);
        });
      }
      return ids.map((id) => vistaPerfil(id, true));
    }),
    findFirst: vi.fn(async ({ where }: any) => {
      const p = perfiles.get(where.clientId);
      if (!p) return null;
      return { clientId: p.clientId, admissionDate: p.admissionDate, dischargeDate: p.dischargeDate };
    }),
    findUniqueOrThrow: vi.fn(async ({ where }: any) =>
      vistaPerfil(where.clientId, true),
    ),
  },
  room: {
    findFirst: vi.fn(async ({ where }: any) => {
      const h = habitaciones.get(where.id);
      if (!h) return null;
      const planta = plantas.get(h.floorId)!;
      return {
        ...h,
        floor: { id: planta.id, name: planta.name },
        beds: [...camas.values()]
          .filter((c) => c.roomId === h.id && c.active)
          .map((c) => {
            const o = ocupaciones.find((x) => x.bedId === c.id && x.toAt == null);
            const cliente = o ? clientes.get(o.clientId)! : null;
            return {
              id: c.id,
              label: c.label,
              assignments: cliente
                ? [{ client: { id: cliente.id, firstName: cliente.firstName, lastName: cliente.lastName } }]
                : [],
            };
          }),
      };
    }),
  },
  centerShift: {
    findMany: vi.fn(async () => turnos),
  },
  // El plano del centro, como lo pide `GET /residencia/edificio`: plantas →
  // habitaciones → camas, con la ocupación vigente y la puerta viva.
  floor: {
    findMany: vi.fn(async () =>
      [...plantas.values()].map((p) => ({
        id: p.id,
        name: p.name,
        sortOrder: p.sortOrder,
        rooms: [...habitaciones.values()]
          .filter((h) => h.floorId === p.id)
          .map((h) => ({
            id: h.id,
            number: h.number,
            name: h.name,
            active: h.active,
            beds: [...camas.values()]
              .filter((c) => c.roomId === h.id)
              .map((c) => {
                const o = ocupaciones.find(
                  (x) => x.bedId === c.id && x.toAt == null,
                );
                const cliente = o ? clientes.get(o.clientId)! : null;
                return {
                  id: c.id,
                  label: c.label,
                  active: c.active,
                  assignments:
                    o && cliente
                      ? [
                          {
                            id: o.id,
                            fromAt: o.fromAt,
                            client: {
                              id: cliente.id,
                              firstName: cliente.firstName,
                              lastName: cliente.lastName,
                            },
                          },
                        ]
                      : [],
                };
              }),
            devices: [...dispositivos.values()]
              .filter((d) => d.kind === "ROOM" && d.roomId === h.id && d.revokedAt == null)
              .map((d) => ({ id: d.id, name: d.name, lastSeenAt: null })),
          })),
      })),
    ),
  },
  device: {
    findUnique: vi.fn(async ({ where }: any) => {
      for (const d of dispositivos.values()) {
        if (where.deviceTokenHash && d.hash !== where.deviceTokenHash) continue;
        if (where.id && d.id !== where.id) continue;
        return {
          ...d,
          tenant: {
            residenciaEnabled: residenciaEncendida,
            kitchenDisplayEnabled: false,
          },
        };
      }
      return null;
    }),
    update: vi.fn(async () => ({ id: "d" })),
  },
} as const;

vi.mock("../src/context.js", () => ({
  getPrisma: () => fakePrisma,
  getRedis: () => ({ ping: async () => "PONG" }),
  shutdown: async () => undefined,
}));

const { registerResidenciaResidentesRoutes } = await import(
  "../src/residencia/residentes-routes.js"
);
const { registerResidenciaPuertaRoutes } = await import(
  "../src/residencia/puerta-routes.js"
);
const { registerResidenciaTurnosRoutes } = await import(
  "../src/residencia/turnos-routes.js"
);
const { signAccessToken } = await import("../src/auth/tokens.js");
// Las dos cachés de clinica-7. Las dos duran MÁS que este fichero entero:
// sin vaciarlas en el `beforeEach`, el primer test decide el estado del
// contrato de todos los demás — y este fichero apaga la clínica en uno.
const { olvidarClaves } = await import("../src/clinica/claves.js");
const { olvidarEstado } = await import("../src/clinica/contrato.js");
const { hashDeviceToken, requireDeviceToken } = await import(
  "../src/devices/auth.js"
);

function tokenDe(userId: string, role: Usuario["role"]) {
  return signAccessToken({ sub: userId, tid: TENANT, role });
}
const comoDirectora = { authorization: `Bearer ${tokenDe(DIRECTORA, "OWNER")}` };
const comoAuxiliar = { authorization: `Bearer ${tokenDe(AUXILIAR, "CLINICIAN")}` };
const comoDue = { authorization: `Bearer ${tokenDe(DUE, "CLINICIAN")}` };

async function buildApp() {
  const app = Fastify();
  await registerResidenciaResidentesRoutes(app);
  await registerResidenciaPuertaRoutes(app);
  await registerResidenciaTurnosRoutes(app);
  return app;
}

beforeEach(() => {
  residenciaEncendida = true;
  clinicaEncendida = true;
  llavero.reset();
  contrato.reset();
  olvidarClaves();
  olvidarEstado();
  usuarios.clear();
  roles.clear();
  asigRoles = [];
  asigZonas = [];
  ocupaciones = [];
  camas.clear();
  habitaciones.clear();
  plantas.clear();
  perfiles.clear();
  clientes.clear();
  registro.length = 0;
  dispositivos.clear();

  usuarios.set(DIRECTORA, {
    id: DIRECTORA,
    role: "OWNER",
    isClinician: true,
    clinicianLicense: null,
  });
  usuarios.set(AUXILIAR, {
    id: AUXILIAR,
    role: "CLINICIAN",
    isClinician: true,
    clinicianLicense: null,
  });
  usuarios.set(DUE, {
    id: DUE,
    role: "CLINICIAN",
    isClinician: true,
    clinicianLicense: "45/1234",
  });

  roles.set(ROL_AUXILIAR, {
    id: ROL_AUXILIAR,
    code: "AUXILIAR",
    name: "Auxiliar / gerocultora",
    category: "OPERATIVO",
    active: true,
    recordsCare: true,
    requiresLicense: false,
    fullScope: false,
    isStandard: true,
    sortOrder: 1,
  });
  roles.set(ROL_DUE, {
    id: ROL_DUE,
    code: "DUE",
    name: "DUE (enfermería)",
    category: "SUPERVISOR",
    active: true,
    recordsCare: true,
    requiresLicense: true,
    fullScope: true,
    isStandard: true,
    sortOrder: 2,
  });

  const ayer = new Date(Date.now() - 86_400_000);
  asigRoles.push({
    id: "ar-1",
    userId: AUXILIAR,
    careRoleId: ROL_AUXILIAR,
    fromAt: ayer,
    toAt: null,
    revokedAt: null,
  });
  asigRoles.push({
    id: "ar-2",
    userId: DUE,
    careRoleId: ROL_DUE,
    fromAt: ayer,
    toAt: null,
    revokedAt: null,
  });
  // La auxiliar cubre la PRIMERA planta y nada más.
  asigZonas.push({
    id: "az-1",
    userId: AUXILIAR,
    floorId: PLANTA_1,
    fromAt: ayer,
    toAt: null,
  });

  plantas.set(PLANTA_1, { id: PLANTA_1, name: "Primera", sortOrder: 1 });
  plantas.set(PLANTA_2, { id: PLANTA_2, name: "Segunda", sortOrder: 2 });
  habitaciones.set(HAB_112, {
    id: HAB_112,
    floorId: PLANTA_1,
    number: "112",
    name: null,
    active: true,
  });
  habitaciones.set(HAB_201, {
    id: HAB_201,
    floorId: PLANTA_2,
    number: "201",
    name: null,
    active: true,
  });
  camas.set(CAMA_112A, { id: CAMA_112A, roomId: HAB_112, label: "A", active: true });
  camas.set(CAMA_201A, { id: CAMA_201A, roomId: HAB_201, label: "A", active: true });

  clientes.set(CARMEN, { id: CARMEN, firstName: "Carmen", lastName: "Gómez" });
  clientes.set(LUIS, { id: LUIS, firstName: "Luis", lastName: "Prieto" });
  for (const [id, nivel] of [
    [CARMEN, "DEPENDIENTE"],
    [LUIS, "VALIDO"],
  ] as const) {
    perfiles.set(id, {
      clientId: id,
      admissionDate: new Date("2026-01-10"),
      dischargeDate: null,
      dischargeReason: null,
      dependencyLevel: nivel,
      dependencyGrade: nivel === "DEPENDIENTE" ? "III" : null,
      placeType: "CONCERTADA",
      responsibleName: null,
      responsiblePhone: null,
      responsibleRelation: null,
      dni: "11111111H",
      nss: "28/1234567890",
    });
  }
  // Carmen en la 112 (primera planta), Luis en la 201 (segunda).
  ocupaciones.push({
    id: "oc-1",
    bedId: CAMA_112A,
    clientId: CARMEN,
    fromAt: new Date("2026-01-10"),
    toAt: null,
    reason: "ingreso",
  });
  ocupaciones.push({
    id: "oc-2",
    bedId: CAMA_201A,
    clientId: LUIS,
    fromAt: new Date("2026-02-01"),
    toAt: null,
    reason: "ingreso",
  });

  dispositivos.set("puerta", {
    id: "puerta",
    tenantId: TENANT,
    kind: "ROOM",
    roomId: HAB_112,
    registerId: null,
    revokedAt: null,
    name: "Tablet 112",
    hash: hashDeviceToken(PUERTA_TOKEN),
  });
  dispositivos.set("terminal", {
    id: "terminal",
    tenantId: TENANT,
    kind: "TERMINAL",
    roomId: null,
    registerId: "caja-1",
    revokedAt: null,
    name: "Caja 1",
    hash: hashDeviceToken(TERMINAL_TOKEN),
  });
});

describe("residencia-1 · con el módulo apagado, 404 INDISTINGUIBLE", () => {
  it("la 404 del gate es LA MISMA que la de una ruta que no existe", async () => {
    // Si estos dos cuerpos se separan, el módulo deja de estar escondido:
    // bastaría comparar dos respuestas para saber que existe. Es el mismo
    // test que clinica-1 y la misma razón — el dato que protege.
    residenciaEncendida = false;
    const app = await buildApp();
    const gateada = await app.inject({
      method: "GET",
      url: "/residencia/residentes",
      headers: comoDirectora,
    });
    const inexistente = await app.inject({
      method: "GET",
      url: "/residencia/no-existe-esta-ruta",
      headers: comoDirectora,
    });
    expect(gateada.statusCode).toBe(404);
    expect(inexistente.statusCode).toBe(404);
    expect(gateada.json()).toEqual({
      message: "Route GET:/residencia/residentes not found",
      error: "Not Found",
      statusCode: 404,
    });
    expect(Object.keys(gateada.json())).toEqual(Object.keys(inexistente.json()));
  });

  it("y las cinco rutas del centro contestan igual", async () => {
    residenciaEncendida = false;
    const app = await buildApp();
    for (const url of [
      "/residencia/residentes",
      `/residencia/residentes/${CARMEN}`,
      "/residencia/turnos",
    ]) {
      const res = await app.inject({ method: "GET", url, headers: comoDirectora });
      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe("Not Found");
    }
  });

  it("con la CLÍNICA apagada también: la residencia cuelga de ella", async () => {
    clinicaEncendida = false;
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/residencia/residentes",
      headers: comoDirectora,
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("residencia-1 · la lista, y la zona de quien mira", () => {
  it("la DIRECTORA ve a los dos residentes y la lista dice «CENTRO»", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/residencia/residentes",
      headers: comoDirectora,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().alcance).toBe("CENTRO");
    expect(res.json().residentes).toHaveLength(2);
  });

  it("LA AUXILIAR de la primera planta ve SÓLO a Carmen", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/residencia/residentes",
      headers: comoAuxiliar,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().alcance).toBe("ZONA");
    expect(res.json().residentes.map((r: any) => r.nombre)).toEqual([
      "Carmen Gómez",
    ]);
  });

  it("LA DUE ve a los dos: su rol tiene alcance total", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/residencia/residentes",
      headers: comoDue,
    });
    expect(res.json().alcance).toBe("CENTRO");
    expect(res.json().residentes).toHaveLength(2);
  });

  it("la lista NO lleva DNI ni NSS", async () => {
    // La lista se enseña en una pantalla que mira cualquiera que pase por
    // el despacho. El DNI sólo en la ficha.
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/residencia/residentes",
      headers: comoDirectora,
    });
    const crudo = res.payload;
    expect(crudo).not.toContain("11111111H");
    expect(crudo).not.toContain("28/1234567890");
    expect(res.json().residentes[0]).not.toHaveProperty("dni");
  });

  it("la lista NO deja líneas en el registro de accesos", async () => {
    // Decisión 1 de clinica-1, aplicada: 49 líneas por apertura de lista
    // llenarían el registro de lo que NO es un acceso a una historia, y eso
    // lo hace MENOS útil.
    const app = await buildApp();
    await app.inject({
      method: "GET",
      url: "/residencia/residentes",
      headers: comoDirectora,
    });
    expect(registro).toHaveLength(0);
  });
});

describe("residencia-1 · la ficha pasa por LA función de acceso", () => {
  it("la auxiliar abre la ficha de SU residente y queda línea ALLOWED", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/residencia/residentes/${CARMEN}`,
      headers: comoAuxiliar,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().residente.dni).toBe("11111111H");
    expect(registro).toHaveLength(1);
    expect(registro[0]).toMatchObject({
      userId: AUXILIAR,
      clientId: CARMEN,
      action: "READ",
      outcome: "ALLOWED",
    });
    expect(registro[0]!.route).toContain("/residencia/residentes/");
  });

  it("LA DENEGADA TAMBIÉN: la auxiliar lo intenta con el de la otra planta", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/residencia/residentes/${LUIS}`,
      headers: comoAuxiliar,
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("RESIDENTE_FUERA_DE_TU_ZONA");
    // Un acceso que se niega es justo el que interesa ver cuando alguien
    // pregunta quién ha estado mirando la ficha de su padre.
    expect(registro).toHaveLength(1);
    expect(registro[0]).toMatchObject({
      userId: AUXILIAR,
      clientId: LUIS,
      outcome: "DENIED",
    });
  });

  it("sin rol de cuidado vigente, 403 SIN_ROL_DE_CUIDADO", async () => {
    asigRoles = [];
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/residencia/residentes/${CARMEN}`,
      headers: comoAuxiliar,
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("SIN_ROL_DE_CUIDADO");
  });

  it("un residente de otro centro es un 404, no un 403", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/residencia/residentes/${randomUUID()}`,
      headers: comoDirectora,
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe("RESIDENTE_NO_ENCONTRADO");
  });
});

describe("residencia-1 · LA PUERTA NO ES UN TPV", () => {
  /** Una ruta cualquiera detrás de `requireDeviceToken`. */
  async function appConRutaDeTpv() {
    const app = Fastify();
    app.get(
      "/falsa/venta",
      { preHandler: [requireDeviceToken] },
      async () => ({ cobrado: true }),
    );
    return app;
  }

  it("un ROOM recibe 403 en la puerta de TODAS las rutas del TPV", async () => {
    // Aquí es donde queda cubierto de golpe que no cobra, no abre turno, no
    // emite registro fiscal y no releva: `requireDeviceToken` es el
    // preHandler de todas esas rutas Y del login de cajero, así que el 403
    // cae ANTES del PIN y la puerta nunca llega a tener sesión.
    const app = await appConRutaDeTpv();
    const res = await app.inject({
      method: "GET",
      url: "/falsa/venta",
      headers: { "x-device-token": PUERTA_TOKEN },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("ROOM_DEVICE_NOT_ALLOWED");
  });

  it("y el TERMINAL de la caja pasa por la misma puerta sin problema", async () => {
    const app = await appConRutaDeTpv();
    const res = await app.inject({
      method: "GET",
      url: "/falsa/venta",
      headers: { "x-device-token": TERMINAL_TOKEN },
    });
    expect(res.statusCode).toBe(200);
  });

  it("y AL REVÉS: un TERMINAL no puede leer la puerta de una habitación", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/residencia/puerta/me",
      headers: { "x-device-token": TERMINAL_TOKEN },
    });
    // 403 y no 404: el aparato existe y es de este cliente, lo que no es es
    // una puerta.
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("NOT_A_ROOM_DEVICE");
  });

  it("con el módulo apagado la puerta recibe 403, NO la 404 del gate", async () => {
    // Aquí sí se separa de la regla del gate, y es deliberado: a una tablet
    // que estaba usando el módulo hace un minuto no se le esconde que
    // existe — sería mentirle, y el técnico que vaya a mirarla necesita
    // leer por qué. Mismo criterio que `KITCHEN_MODULE_DISABLED`.
    residenciaEncendida = false;
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/residencia/puerta/me",
      headers: { "x-device-token": PUERTA_TOKEN },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("RESIDENCIA_MODULE_DISABLED");
  });

  it("sin token, 401", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/residencia/puerta/me" });
    expect(res.statusCode).toBe(401);
  });
});

describe("residencia-1 · `GET /residencia/puerta/me` · nombre y nada más", () => {
  it("devuelve la habitación, la planta, los ocupantes y los turnos", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/residencia/puerta/me",
      headers: { "x-device-token": PUERTA_TOKEN },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.habitacion).toMatchObject({ number: "112", plantaName: "Primera" });
    expect(body.ocupantes).toEqual([
      // residencia-3 (D-64) · el `clientId` entra en la respuesta porque la
      // pantalla en reposo necesita con qué pedir la foto. Un uuid no dice
      // nada de nadie —no es el DNI ni el nivel de dependencia— y la foto
      // que abre sigue exigiendo consentimiento de imagen vigente.
      {
        bedId: CAMA_112A,
        bedLabel: "A",
        clientId: CARMEN,
        nombre: "Carmen Gómez",
      },
    ]);
    // Los turnos viajan con la identidad para que la tablet pueda decidir
    // el turno SIN RED (lo que residencia-3 necesitará).
    expect(body.turnos).toHaveLength(3);
    expect(body.serverTime).toBeTypeOf("string");
  });

  it("NI UN DATO DE SALUD en la respuesta", async () => {
    // Una tablet colgada en un pasillo la ve la familia de la 110, el
    // técnico del ascensor y el inspector. El nombre ya está en el timbre;
    // el nivel de dependencia, no.
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/residencia/puerta/me",
      headers: { "x-device-token": PUERTA_TOKEN },
    });
    const crudo = res.payload;
    for (const prohibido of [
      "DEPENDIENTE",
      "dependencyLevel",
      "dependencyGrade",
      "placeType",
      "CONCERTADA",
      "11111111H",
      "28/1234567890",
      "admissionDate",
    ]) {
      expect(crudo).not.toContain(prohibido);
    }
  });

  it("y tampoco deja línea en el registro de accesos", async () => {
    // Su identidad es el DISPOSITIVO, no una persona, y el registro de
    // accesos existe para contestar «¿QUIÉN ha abierto la historia de mi
    // madre?». Una línea sin persona no contesta eso. La pantalla que SÍ
    // identifica a alguien (con PIN) es residencia-3, y dejará su línea.
    const app = await buildApp();
    await app.inject({
      method: "GET",
      url: "/residencia/puerta/me",
      headers: { "x-device-token": PUERTA_TOKEN },
    });
    expect(registro).toHaveLength(0);
  });
});

describe("residencia-1 · el edificio es de la dirección", () => {
  it("la AUXILIAR no puede leer el plano del centro", async () => {
    // La vista del edificio trae quién ocupa cada cama de TODO el centro, y
    // la lista de residentes de al lado filtra por zona. Abierta a
    // cualquiera del tenant, la auxiliar de la primera planta no podría
    // abrir la ficha del residente de la segunda —la función de acceso se
    // lo niega— pero sí vería su nombre en la cama 201-A. Dos pantallas
    // contestando cosas distintas a la misma pregunta.
    const { registerResidenciaEdificioRoutes } = await import(
      "../src/residencia/edificio-routes.js"
    );
    const app = Fastify();
    await registerResidenciaEdificioRoutes(app);
    const res = await app.inject({
      method: "GET",
      url: "/residencia/edificio",
      headers: comoAuxiliar,
    });
    expect(res.statusCode).toBe(403);
  });

  it("y la DIRECTORA sí, con quién ocupa cada cama", async () => {
    const { registerResidenciaEdificioRoutes } = await import(
      "../src/residencia/edificio-routes.js"
    );
    const app = Fastify();
    await registerResidenciaEdificioRoutes(app);
    const res = await app.inject({
      method: "GET",
      url: "/residencia/edificio",
      headers: comoDirectora,
    });
    expect(res.statusCode).toBe(200);
    const plantas = res.json().plantas;
    expect(plantas).toHaveLength(2);
    const camas = plantas.flatMap((p: any) =>
      p.habitaciones.flatMap((h: any) => h.camas),
    );
    expect(camas.find((c: any) => c.ocupa)?.ocupa.nombre).toBe("Carmen Gómez");
    // Y NI UN DATO DE SALUD en el plano: esta pantalla se mira de pie.
    for (const prohibido of ["DEPENDIENTE", "CONCERTADA", "11111111H"]) {
      expect(res.payload).not.toContain(prohibido);
    }
  });
});

describe("residencia-1 · los turnos", () => {
  it("`GET /residencia/turnos` dice en qué turno estamos AHORA", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/residencia/turnos",
      headers: comoDirectora,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().turnos).toHaveLength(3);
    // Los tres de serie cubren las 24 h, así que `ahora` nunca es null.
    expect(["M", "T", "N"]).toContain(res.json().ahora);
  });
});
