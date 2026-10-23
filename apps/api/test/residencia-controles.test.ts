// residencia-2 · LAS RUTAS DEL CATÁLOGO Y DEL PLAN, con Prisma en memoria.
//
// Lo que se prueba aquí y no en el e2e: lo que decide la APLICACIÓN. El
// motor (los índices parciales, los CHECK de coherencia, el CHECK de
// alcance) lo prueba `residencia-2.e2e.ts` contra Postgres de verdad,
// porque eso es justamente lo que un falso no puede probar.
//
// Las seis garantías de este fichero:
//
//   1. **La frontera se respeta en las dos direcciones.** El centro no
//      puede elegir una frecuencia que el producto no permite, ni un rol
//      que el producto no permite, ni ENSANCHAR nada.
//   2. **Lo del producto no está en el cuerpo.** Un intento de cambiar la
//      capa o el rango de referencia es un 400 — y el
//      `additionalProperties: false` está PUESTO, que es lo que faltaba en
//      el PATCH del super-admin y daba un 200 que no hacía nada.
//   3. **Un control propio no puede llevar el código de uno de serie**
//      (409). Es lo que sostiene que el ajuste se identifique por código.
//   4. **Un control de serie no se versiona desde el centro** (403).
//   5. **Escribir es del OWNER** (403 al encargado), leer es del
//      encargado también. Mismo criterio que los roles de residencia-1.
//   6. **El plan de un residente es de supervisión** y pasa por
//      `conHistoria`: la auxiliar no lo toca, y cada lectura deja su línea
//      en el registro de accesos.

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
// nada. El plan de un residente pasa por `conHistoria`, y `conHistoria` es
// el punto por el que pasa todo lo clínico: el día que una ruta de
// residencia guarde un dato de salud lo hará por ahí y necesitará la DEK.
// Ponerla ahora cuesta una línea; descubrir que falta cuesta un 500 que no
// dice por qué.
kekDePrueba();

import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";

const TENANT = "00000000-0000-0000-0000-000000000001";
const DIRECTORA = "11111111-1111-1111-1111-111111111111";
const ENCARGADO = "99999999-9999-9999-9999-999999999999";
const AUXILIAR = "22222222-2222-2222-2222-222222222222";
const DUE = "33333333-3333-3333-3333-333333333333";
const CARMEN = "44444444-4444-4444-4444-444444444444";
const PLANTA_1 = "aaaaaaaa-0000-0000-0000-000000000001";
const ROL_AUXILIAR = "dddddddd-0000-0000-0000-000000000001";
const ROL_DUE = "dddddddd-0000-0000-0000-000000000002";
const ROL_ADMIN = "dddddddd-0000-0000-0000-000000000003";

// ── Prisma en memoria ────────────────────────────────────────────────

let residenciaEncendida = true;
let clinicaEncendida = true;

interface Control {
  id: string;
  scope: "STANDARD" | "CENTER";
  tenantId: string | null;
  code: string;
  version: number;
  name: string;
  layer: string;
  nature: string;
  valueDomain: string;
  unit: string | null;
  inputMin: number | null;
  inputMax: number | null;
  refMin: number | null;
  refMax: number | null;
  groupCode: string | null;
  allowedFrequencies: string[];
  allowedCareRoleCodes: string[];
  defaultFrequencyKind: string;
  defaultEveryNHours: number | null;
  defaultEveryNDays: number | null;
  defaultWeekdays: number[];
  defaultMonthDay: number | null;
  defaultShiftCodes: string[];
  defaultMomentCodes: string[];
  isoIndicatorCode: string | null;
  familyVisibleDefault: boolean;
  sortOrder: number;
  validFrom: Date;
  supersededAt: Date | null;
  options: Array<{ code: string; label: string; sortOrder: number; isAsUsual: boolean }>;
}
let controles: Control[] = [];

interface Ajuste {
  id: string;
  tenantId: string;
  controlCode: string;
  active: boolean;
  alias: string | null;
  frequencyKind: string;
  everyNHours: number | null;
  everyNDays: number | null;
  weekdays: number[];
  monthDay: number | null;
  shiftCodes: string[];
  momentCodes: string[];
  careRoleCodes: string[];
  familyVisible: boolean;
  reconductedAt: Date | null;
  reconductedFromVersion: number | null;
  reconductedReason: string | null;
}
let ajustes: Ajuste[] = [];
let lineasDePlan: any[] = [];
let plantillas: any[] = [];
const registro: Array<{ action: string; outcome: string; clientId: string }> = [];

const TURNOS = [
  { id: "t-m", code: "M", name: "Mañana", startsAt: "08:00", endsAt: "15:00", sortOrder: 1 },
  { id: "t-t", code: "T", name: "Tarde", startsAt: "15:00", endsAt: "22:00", sortOrder: 2 },
  { id: "t-n", code: "N", name: "Noche", startsAt: "22:00", endsAt: "08:00", sortOrder: 3 },
];
const MOMENTOS = [
  { id: "m-d", code: "DESAYUNO", name: "Desayuno", atTime: "09:00", sortOrder: 1 },
  { id: "m-c", code: "COMIDA", name: "Comida", atTime: "13:30", sortOrder: 2 },
];
const ROLES = [
  { id: ROL_AUXILIAR, code: "AUXILIAR", name: "Auxiliar", category: "OPERATIVO", active: true, recordsCare: true, fullScope: false },
  { id: ROL_DUE, code: "DUE", name: "DUE", category: "SUPERVISOR", active: true, recordsCare: true, fullScope: true },
  { id: ROL_ADMIN, code: "ADMINISTRACION", name: "Administración", category: "OPERATIVO", active: true, recordsCare: false, fullScope: false },
];

let asigRoles: Array<{
  userId: string;
  careRoleId: string;
  fromAt: Date;
  toAt: Date | null;
  revokedAt: Date | null;
}> = [];

const usuarios = new Map<
  string,
  { id: string; role: string; isClinician: boolean; clinicalScope: string }
>();

/** Filtra una lista en memoria con el `where` que la ruta manda. */
function casa(fila: any, where: any): boolean {
  if (!where) return true;
  for (const [k, v] of Object.entries(where)) {
    if (k === "OR") {
      if (!(v as any[]).some((w) => casa(fila, w))) return false;
      continue;
    }
    if (v === null) {
      if (fila[k] !== null && fila[k] !== undefined) return false;
      continue;
    }
    if (typeof v === "object" && v !== null && "in" in (v as any)) {
      if (!(v as any).in.includes(fila[k])) return false;
      continue;
    }
    if (typeof v === "object" && v !== null && ("lte" in (v as any) || "gte" in (v as any))) {
      const w = v as any;
      if (w.lte !== undefined && !(fila[k] <= w.lte)) return false;
      if (w.gte !== undefined && !(fila[k] >= w.gte)) return false;
      continue;
    }
    if (fila[k] !== v) return false;
  }
  return true;
}

// clinica-7 · el llavero de la clínica, en memoria. Ver la nota de la KEK
// de arriba: no se cifra nada en este fichero, pero el modelo tiene que
// existir para que `dekONada` no se encuentre un `undefined`.
const llavero = llaveroFake();
// Y EL CONTRATO DE ENCARGADO, ACEPTADO. Esto es lo que faltaba: desde
// clinica-7, `conHistoria` pregunta por el estado del contrato en TODA
// ruta clínica —y el plan de un residente lo es—, así que un `fakePrisma`
// sin `clinicalProcessorAgreement` contesta 500 «reading findMany».
//
// Nace ACEPTADO porque un centro de residencia que funciona es uno que
// tiene el contrato aceptado: sin él no se puede ni encender el módulo
// (`tenants_residencia_exige_clinica` exige la clínica, y la clínica sin
// contrato no escribe). El 423 se prueba revocándolo, no al contrario.
const contrato = contratoFake(TENANT, DIRECTORA);

const fakePrisma: any = {
  clinicalTenantKey: llavero.modelo,
  clinicalProcessorAgreement: contrato.modelo,
  tenant: {
    findUnique: vi.fn(async () => ({
      id: TENANT,
      residenciaEnabled: residenciaEncendida,
      clinicalRecordsEnabled: clinicaEncendida,
    })),
  },
  user: {
    findUnique: vi.fn(async ({ where }: any) => {
      const u = usuarios.get(where.id);
      if (!u) return null;
      return { ...u, tenantId: TENANT, tenant: { clinicalRecordsEnabled: clinicaEncendida, residenciaEnabled: residenciaEncendida } };
    }),
    findFirst: vi.fn(async ({ where }: any) => {
      const u = usuarios.get(where.id);
      if (!u) return null;
      return { ...u, tenantId: TENANT };
    }),
  },
  controlType: {
    findMany: vi.fn(async ({ where, select }: any) => {
      const fuera = controles.filter((c) => casa(c, where));
      return fuera.map((c) => (select?.options ? c : { ...c, options: undefined }));
    }),
    findFirst: vi.fn(async ({ where }: any) => controles.find((c) => casa(c, where)) ?? null),
    create: vi.fn(async ({ data }: any) => {
      const fila: Control = { ...(data as any), id: randomUUID(), options: [] };
      controles.push(fila);
      return fila;
    }),
    update: vi.fn(async ({ where, data }: any) => {
      const c = controles.find((x) => x.id === where.id)!;
      Object.assign(c, data);
      return c;
    }),
  },
  controlTypeOption: {
    createMany: vi.fn(async ({ data }: any) => {
      for (const o of data) {
        controles
          .find((c) => c.id === o.controlTypeId)
          ?.options.push({
            code: o.code,
            label: o.label,
            sortOrder: o.sortOrder,
            isAsUsual: o.isAsUsual,
          });
      }
      return { count: data.length };
    }),
  },
  centerControlSetting: {
    findMany: vi.fn(async ({ where }: any) => ajustes.filter((a) => casa(a, where))),
    findFirst: vi.fn(async ({ where }: any) => ajustes.find((a) => casa(a, where)) ?? null),
    create: vi.fn(async ({ data }: any) => {
      const fila = nuevoAjuste(data);
      ajustes.push(fila);
      return fila;
    }),
    upsert: vi.fn(async ({ where, update, create }: any) => {
      const w = where.tenantId_controlCode;
      const existe = ajustes.find(
        (a) => a.tenantId === w.tenantId && a.controlCode === w.controlCode,
      );
      if (existe) {
        Object.assign(existe, update);
        return existe;
      }
      const fila = nuevoAjuste(create);
      ajustes.push(fila);
      return fila;
    }),
    update: vi.fn(async ({ where, data }: any) => {
      const a = ajustes.find((x) => x.id === where.id)!;
      Object.assign(a, data);
      return a;
    }),
  },
  centerShift: {
    findMany: vi.fn(async () => TURNOS),
    findFirst: vi.fn(async ({ where }: any) => TURNOS.find((t) => casa(t, where)) ?? null),
  },
  centerMoment: {
    findMany: vi.fn(async ({ where }: any) => MOMENTOS.filter((m) => casa(m, where))),
    findFirst: vi.fn(async ({ where }: any) => MOMENTOS.find((m) => casa(m, where)) ?? null),
    update: vi.fn(async ({ where, data }: any) => {
      const m = MOMENTOS.find((x) => x.id === where.id)!;
      Object.assign(m, data);
      return m;
    }),
  },
  careRole: {
    findMany: vi.fn(async ({ where }: any) =>
      ROLES.filter((r) => {
        if (where?.active !== undefined && r.active !== where.active) return false;
        if (where?.recordsCare !== undefined && r.recordsCare !== where.recordsCare) return false;
        if (where?.code?.in && !where.code.in.includes(r.code)) return false;
        return true;
      }),
    ),
  },
  careRoleAssignment: {
    findMany: vi.fn(async ({ where }: any) =>
      asigRoles
        .filter(
          (a) =>
            a.userId === where.userId &&
            a.revokedAt === null &&
            (a.toAt === null || a.toAt >= new Date()),
        )
        .map((a) => ({ careRole: ROLES.find((r) => r.id === a.careRoleId)! })),
    ),
    findFirst: vi.fn(async ({ where }: any) => {
      const a = asigRoles.find((x) => x.userId === where.userId && x.revokedAt === null);
      return a ? { id: "x", careRole: ROLES.find((r) => r.id === a.careRoleId) } : null;
    }),
  },
  careZoneAssignment: {
    findMany: vi.fn(async () => [{ floorId: null, fromAt: new Date(0), toAt: null }]),
  },
  // historia-1 (D-92) · las AUSENCIAS. La vista «hoy» del plan las pide
  // para pasárselas a `queToca`, y un doble sin este modelo contesta 500
  // «reading findMany» — es la misma factura que `clinicalTenantKey` y
  // `clinicalProcessorAgreement` ya pagaron en este fichero.
  //
  // Vacío: este fichero prueba el plan, no las ausencias. Lo que las
  // ausencias pausan está en `packages/residencia-plan/test/ausencias.test.ts`
  // (la tabla pura) y en el e2e de historia-1 (contra Postgres).
  residentAbsence: {
    findMany: vi.fn(async () => []),
  },
  carePlanItem: {
    findMany: vi.fn(async ({ where }: any) => lineasDePlan.filter((l) => casa(l, where))),
    findFirst: vi.fn(async ({ where }: any) => lineasDePlan.find((l) => casa(l, where)) ?? null),
    create: vi.fn(async ({ data }: any) => {
      // `toAt: null` y no `undefined`: Prisma devuelve NULL, y una ruta
      // que compara `!== null` tomaría `undefined` por «cerrada».
      //
      // residencia-1b · y el `id` de `data` MANDA. Lo genera
      // `nuevoIdDeFila()` en la ruta porque el AAD lo necesita antes de
      // que la fila exista; un doble que lo inventara dejaría un
      // ciphertext que no se descifra con el sitio de la fila donde acabó.
      const fila = { toAt: null, ...data, id: data.id ?? randomUUID() };
      lineasDePlan.push(fila);
      return fila;
    }),
    createMany: vi.fn(async ({ data }: any) => {
      for (const d of data) {
        lineasDePlan.push({ toAt: null, ...d, id: d.id ?? randomUUID() });
      }
      return { count: data.length };
    }),
    update: vi.fn(async ({ where, data }: any) => {
      const l = lineasDePlan.find((x) => x.id === where.id)!;
      Object.assign(l, data);
      return l;
    }),
    updateMany: vi.fn(async ({ where, data }: any) => {
      const t = lineasDePlan.filter((l) => casa(l, where));
      for (const l of t) Object.assign(l, data);
      return { count: t.length };
    }),
  },
  carePlanTemplateItem: {
    findMany: vi.fn(async ({ where }: any) => plantillas.filter((p) => casa(p, where))),
    deleteMany: vi.fn(async ({ where }: any) => {
      const antes = plantillas.length;
      plantillas = plantillas.filter((p) => !casa(p, where));
      return { count: antes - plantillas.length };
    }),
    createMany: vi.fn(async ({ data }: any) => {
      for (const d of data) plantillas.push({ ...d, id: randomUUID() });
      return { count: data.length };
    }),
  },
  residentProfile: {
    findFirst: vi.fn(async ({ where }: any) =>
      where.clientId === CARMEN && where.tenantId === TENANT
        ? { clientId: CARMEN }
        : null,
    ),
    findUniqueOrThrow: vi.fn(async () => ({
      clientId: CARMEN,
      dependencyLevel: "DEPENDIENTE",
      admissionDate: new Date("2026-10-14"),
      dischargeDate: null,
    })),
  },
  bedAssignment: {
    findFirst: vi.fn(async () => ({
      bed: { room: { floorId: PLANTA_1 } },
    })),
  },
  clinicalAccess: { findFirst: vi.fn(async () => null) },
  clinicalAccessLog: {
    create: vi.fn(async ({ data }: any) => {
      registro.push({
        action: data.action,
        outcome: data.outcome ?? data.result ?? "?",
        clientId: data.clientId,
      });
      return { id: randomUUID() };
    }),
  },
  $transaction: vi.fn(async (fn: any) => fn(fakePrisma)),
};

function nuevoAjuste(data: any): Ajuste {
  return {
    id: randomUUID(),
    tenantId: data.tenantId,
    controlCode: data.controlCode,
    active: data.active ?? true,
    alias: data.alias ?? null,
    frequencyKind: data.frequencyKind,
    everyNHours: data.everyNHours ?? null,
    everyNDays: data.everyNDays ?? null,
    weekdays: data.weekdays ?? [],
    monthDay: data.monthDay ?? null,
    shiftCodes: data.shiftCodes ?? [],
    momentCodes: data.momentCodes ?? [],
    careRoleCodes: data.careRoleCodes ?? [],
    familyVisible: data.familyVisible ?? false,
    reconductedAt: data.reconductedAt ?? null,
    reconductedFromVersion: data.reconductedFromVersion ?? null,
    reconductedReason: data.reconductedReason ?? null,
  };
}

vi.mock("../src/context.js", () => ({
  getPrisma: () => fakePrisma,
  getRedis: () => ({ ping: async () => "PONG" }),
  shutdown: async () => undefined,
}));

const { registerResidenciaControlesRoutes } = await import(
  "../src/residencia/controles-routes.js"
);
const { registerResidenciaPlanRoutes } = await import(
  "../src/residencia/plan-routes.js"
);
const { signAccessToken } = await import("../src/auth/tokens.js");
// Las dos cachés de clinica-7. Las dos viven en su módulo y duran 30 s y
// 60 s, o sea MÁS que este fichero entero: sin vaciarlas en el
// `beforeEach`, el primer test decide el estado del contrato de todos los
// demás.
const { dekDe, olvidarClaves } = await import("../src/clinica/claves.js");
// residencia-1b · los dos motivos de una línea del plan van cifrados, así
// que los tests que afirman sobre ellos DESCIFRAN. Es mejor que lo que
// había: lo que se afirma pasa a ser lo que de verdad se guardó.
const { descifrarValor } = await import("../src/clinica/cripto.js");
const { sitioMotivoDeCierreDeLinea } = await import(
  "../src/clinica/cripto-campos.js"
);

/** El motivo del cierre de una línea, descifrado con el sitio de SU fila. */
async function motivoDeCierreDe(linea: any): Promise<string | null> {
  if (linea.closeReasonCifrado == null) return linea.closeReason ?? null;
  const dek = await dekDe(TENANT, fakePrisma as never);
  return descifrarValor(
    linea.closeReasonCifrado,
    dek,
    sitioMotivoDeCierreDeLinea(TENANT, linea.id),
  );
}
const { olvidarEstado } = await import("../src/clinica/contrato.js");

function tokenDe(userId: string, role: string) {
  return signAccessToken({ sub: userId, tid: TENANT, role } as never);
}
const comoDirectora = { authorization: `Bearer ${tokenDe(DIRECTORA, "OWNER")}` };
const comoEncargado = { authorization: `Bearer ${tokenDe(ENCARGADO, "MANAGER")}` };
const comoAuxiliar = { authorization: `Bearer ${tokenDe(AUXILIAR, "CLINICIAN")}` };
const comoDue = { authorization: `Bearer ${tokenDe(DUE, "CLINICIAN")}` };

async function buildApp() {
  const app = Fastify();
  await registerResidenciaControlesRoutes(app);
  await registerResidenciaPlanRoutes(app);
  return app;
}

/** Un control de serie, con lo mínimo y lo que el caso necesite. */
function control(parcial: Partial<Control> & { code: string }): Control {
  return {
    id: randomUUID(),
    scope: "STANDARD",
    tenantId: null,
    version: 1,
    name: parcial.code,
    layer: "EXEC",
    nature: "SCHEDULED",
    valueDomain: "BOOL",
    unit: null,
    inputMin: null,
    inputMax: null,
    refMin: null,
    refMax: null,
    groupCode: null,
    allowedFrequencies: ["DAILY", "EVERY_SHIFT"],
    allowedCareRoleCodes: ["AUXILIAR", "DUE"],
    defaultFrequencyKind: "DAILY",
    defaultEveryNHours: null,
    defaultEveryNDays: null,
    defaultWeekdays: [],
    defaultMonthDay: null,
    defaultShiftCodes: ["M"],
    defaultMomentCodes: [],
    isoIndicatorCode: null,
    familyVisibleDefault: false,
    sortOrder: 10,
    validFrom: new Date("2026-10-15"),
    supersededAt: null,
    options: [],
    ...parcial,
  };
}

beforeEach(() => {
  residenciaEncendida = true;
  clinicaEncendida = true;
  llavero.reset();
  contrato.reset();
  olvidarClaves();
  olvidarEstado();
  controles = [
    control({ code: "HIGIENE_PERSONAL", name: "Higiene personal" }),
    control({
      code: "ANALITICA",
      name: "Analítica",
      allowedFrequencies: ["EVERY_N_DAYS", "MONTHLY"],
      allowedCareRoleCodes: ["DUE"],
      defaultFrequencyKind: "EVERY_N_DAYS",
      defaultEveryNDays: 180,
      defaultShiftCodes: ["M"],
    }),
    control({
      code: "DEPOSICION",
      name: "Deposición",
      nature: "ON_DEMAND",
      allowedFrequencies: ["ON_DEMAND"],
      defaultFrequencyKind: "ON_DEMAND",
      defaultShiftCodes: [],
    }),
  ];
  ajustes = [
    nuevoAjuste({
      tenantId: TENANT,
      controlCode: "HIGIENE_PERSONAL",
      frequencyKind: "DAILY",
      shiftCodes: ["M"],
      careRoleCodes: ["AUXILIAR", "DUE"],
    }),
  ];
  lineasDePlan = [];
  plantillas = [];
  registro.length = 0;
  asigRoles = [];
  usuarios.clear();
  usuarios.set(DIRECTORA, { id: DIRECTORA, role: "OWNER", isClinician: true, clinicalScope: "SELECTION" });
  usuarios.set(ENCARGADO, { id: ENCARGADO, role: "MANAGER", isClinician: true, clinicalScope: "SELECTION" });
  usuarios.set(AUXILIAR, { id: AUXILIAR, role: "CLINICIAN", isClinician: true, clinicalScope: "SELECTION" });
  usuarios.set(DUE, { id: DUE, role: "CLINICIAN", isClinician: true, clinicalScope: "SELECTION" });
  asigRoles = [
    { userId: AUXILIAR, careRoleId: ROL_AUXILIAR, fromAt: new Date(0), toAt: null, revokedAt: null },
    { userId: DUE, careRoleId: ROL_DUE, fromAt: new Date(0), toAt: null, revokedAt: null },
  ];
});

// ══ 1 · EL GATE ═══════════════════════════════════════════════════════
describe("con el módulo apagado, 404 y no 403", () => {
  it("el catálogo no existe para quien no tiene residencia", async () => {
    // Un 403 «no tienes el módulo de residencia» le dice a un bar que
    // este sistema guarda qué se registra de la salud de quien vive aquí.
    residenciaEncendida = false;
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/residencia/controles",
      headers: comoDirectora,
    });
    expect(r.statusCode).toBe(404);
  });
});

// ══ 2 · LA FRONTERA ═══════════════════════════════════════════════════
describe("la frontera estándar / centro", () => {
  it("el catálogo dice QUÉ PUEDE ELEGIR el centro en cada control", async () => {
    // Va en la respuesta y no en la pantalla porque la frontera es del
    // producto: el día que una guía retire una frecuencia, la pantalla
    // deja de ofrecerla sin desplegar el panel.
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/residencia/controles",
      headers: comoDirectora,
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    const analitica = body.controles.find((c: any) => c.code === "ANALITICA");
    expect(analitica.puedeElegir.frecuencias).toEqual(["EVERY_N_DAYS", "MONTHLY"]);
    expect(analitica.puedeElegir.roles).toEqual(["DUE"]);
  });

  it("y «administración» NO sale como quien puede registrar", async () => {
    // Ofrecerla sería ofrecer algo que la puerta de residencia-3 no va a
    // permitir: es el único rol de serie que no registra.
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/residencia/controles",
      headers: comoDirectora,
    });
    expect(r.json().roles.map((x: any) => x.code)).toEqual(["AUXILIAR", "DUE"]);
  });

  it("UNA FRECUENCIA QUE EL PRODUCTO NO PERMITE → 400 con la lista", async () => {
    // Una analítica no se hace «cada turno» por mucho que la pantalla lo
    // dejara teclear.
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH",
      url: "/residencia/controles/ANALITICA",
      headers: comoDirectora,
      payload: { frecuencia: { kind: "EVERY_SHIFT", shiftCodes: ["M", "T"] } },
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toBe("FRECUENCIA_NO_PERMITIDA");
    expect(r.json().message).toContain("EVERY_N_DAYS");
  });

  it("UNA FRECUENCIA INCOHERENTE → 400 con la frase, no un 500 de constraint", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH",
      url: "/residencia/controles/HIGIENE_PERSONAL",
      headers: comoDirectora,
      payload: { frecuencia: { kind: "DAILY", shiftCodes: ["M", "T"] } },
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toBe("FRECUENCIA_INCOHERENTE");
    expect(r.json().message).toContain("un turno");
  });

  it("UN ROL QUE EL PRODUCTO NO PERMITE → 400 · se estrecha, no se ensancha", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH",
      url: "/residencia/controles/ANALITICA",
      headers: comoDirectora,
      payload: { careRoleCodes: ["DUE", "AUXILIAR"] },
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toBe("ROL_NO_PERMITIDO");
    expect(r.json().message).toContain("no añadir");
  });

  it("…y ESTRECHARLO sí vale", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH",
      url: "/residencia/controles/HIGIENE_PERSONAL",
      headers: comoDirectora,
      payload: { careRoleCodes: ["DUE"] },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().ajuste.careRoleCodes).toEqual(["DUE"]);
  });

  it("DEJARLO SIN NADIE → 400, y dice qué hacer en vez de eso", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH",
      url: "/residencia/controles/HIGIENE_PERSONAL",
      headers: comoDirectora,
      payload: { careRoleCodes: [] },
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toBe("SIN_QUIEN_LO_REGISTRE");
    expect(r.json().message).toContain("Desactiva el control");
  });

  it("UN TURNO QUE ESTE CENTRO NO TIENE → 400", async () => {
    // `queToca` no inventa un turno cuando el que la línea nombra no
    // existe: devuelve cero ocurrencias, y un control que no toca nunca es
    // un cuidado que nadie hace y nadie echa en falta.
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH",
      url: "/residencia/controles/HIGIENE_PERSONAL",
      headers: comoDirectora,
      payload: { frecuencia: { kind: "DAILY", shiftCodes: ["XX"] } },
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toBe("TURNO_O_MOMENTO_DESCONOCIDO");
  });
});

// ══ 3 · LO DEL PRODUCTO NO ESTÁ EN EL CUERPO ══════════════════════════
describe("lo del producto no se puede tocar", () => {
  it("un campo del producto en el cuerpo → 400, NO un 200 que no hace nada", async () => {
    // Es la lección de residencia-1 §1: Fastify configura ajv con
    // `removeAdditional: true`, así que sin `additionalProperties: false`
    // el campo se BORRA y la ruta contesta 200 sin hacer nada. Un 400 se
    // ve el primer día; un 200 que no hace nada se lee como «ya estaba».
    const app = await buildApp();
    for (const malo of [
      { refMin: 0 },
      { refMax: 99 },
      { inputMin: 0 },
      { layer: "OBS" },
      { allowedFrequencies: ["EVERY_SHIFT"] },
      { allowedCareRoleCodes: ["LIMPIEZA"] },
      { nature: "ON_DEMAND" },
      { unit: "°C" },
      { valueDomain: "NUMERIC" },
      { isoIndicatorCode: "OTRO" },
      { name: "Otro nombre" },
      { version: 9 },
      { scope: "CENTER" },
      { opciones: [] },
    ]) {
      const r = await app.inject({
        method: "PATCH",
        url: "/residencia/controles/HIGIENE_PERSONAL",
        headers: comoDirectora,
        payload: malo,
      });
      expect(r.statusCode, JSON.stringify(malo)).toBe(400);
      // Y la negativa dice DÓNDE se cambia eso: «la unidad no se cambia»
      // a secas deja a la dirección buscando la pantalla que no existe.
      expect(r.json().error, JSON.stringify(malo)).toBe("ES_DEL_PRODUCTO");
      expect(r.json().message).toContain("Mi Piace");
    }
    // Y lo que SÍ es del centro sigue pasando.
    const bien = await app.inject({
      method: "PATCH",
      url: "/residencia/controles/HIGIENE_PERSONAL",
      headers: comoDirectora,
      payload: { active: false, alias: "Aseo" },
    });
    expect(bien.statusCode).toBe(200);
  });

  it("un control de serie NO se versiona desde el centro → 403 con el porqué", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: "/residencia/controles/HIGIENE_PERSONAL/versiones",
      headers: comoDirectora,
      payload: {
        name: "Aseo",
        frecuencia: { kind: "DAILY", shiftCodes: ["M"] },
        careRoleCodes: ["AUXILIAR"],
      },
    });
    expect(r.statusCode).toBe(403);
    expect(r.json().error).toBe("CONTROL_DE_SERIE");
    expect(r.json().message).toContain("tu ajuste");
  });
});

// ══ 4 · UN CONTROL PROPIO ═════════════════════════════════════════════
describe("un control propio del centro", () => {
  const nuevo = {
    code: "POMADA",
    name: "Pomada en la espalda",
    layer: "EXEC",
    nature: "SCHEDULED",
    valueDomain: "BOOL",
    frecuencia: { kind: "DAILY", shiftCodes: ["T"] },
    careRoleCodes: ["AUXILIAR"],
  };

  it("se crea con su ajuste, en la misma transacción", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: "/residencia/controles",
      headers: comoDirectora,
      payload: nuevo,
    });
    expect(r.statusCode).toBe(201);
    expect(controles.find((c) => c.code === "POMADA")?.scope).toBe("CENTER");
    // Sin ajuste, la pantalla lo pinta sin saber si está activo y
    // `queToca` tendría que adivinarlo.
    expect(ajustes.find((a) => a.controlCode === "POMADA")?.active).toBe(true);
  });

  it("EL CÓDIGO DE UNO DE SERIE NO SE PUEDE REUSAR → 409", async () => {
    // Es la regla que sostiene que `center_control_settings` se
    // identifique por `(tenantId, controlCode)`: si un centro pudiera
    // crear su «HIGIENE_PERSONAL», el ajuste no sabría de cuál de los dos
    // es.
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: "/residencia/controles",
      headers: comoDirectora,
      payload: { ...nuevo, code: "HIGIENE_PERSONAL" },
    });
    expect(r.statusCode).toBe(409);
    expect(r.json().error).toBe("CODIGO_DE_SERIE");
    expect(r.json().message).toContain("Higiene personal");
  });

  it("el código se normaliza: «pomada en la espalda» → `POMADA_EN_LA_ESPALDA`", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: "/residencia/controles",
      headers: comoDirectora,
      payload: { ...nuevo, code: "pomada en la espalda" },
    });
    expect(r.statusCode).toBe(201);
    expect(r.json().control.code).toBe("POMADA_EN_LA_ESPALDA");
  });

  it("«a demanda» con horario, o programado sin él → 400", async () => {
    // Un control que dice dos cosas: «no tiene agenda» y «toca los lunes».
    // La puerta pintaría un botón suelto y el panel lo contaría como
    // incumplido.
    const app = await buildApp();
    const a = await app.inject({
      method: "POST",
      url: "/residencia/controles",
      headers: comoDirectora,
      payload: { ...nuevo, nature: "ON_DEMAND" },
    });
    expect(a.statusCode).toBe(400);
    expect(a.json().error).toBe("NATURALEZA_Y_FRECUENCIA");
    const b = await app.inject({
      method: "POST",
      url: "/residencia/controles",
      headers: comoDirectora,
      payload: { ...nuevo, frecuencia: { kind: "ON_DEMAND" } },
    });
    expect(b.statusCode).toBe(400);
  });

  it("una escala propia NO se puede inventar · 400 por el esquema", async () => {
    // `SCALE` lleva su algoritmo detrás (Fase 2) y `EVENT` lo genera el
    // sistema: un centro con una «escala propia» tendría un control que la
    // puerta no sabría pintar ni puntuar.
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: "/residencia/controles",
      headers: comoDirectora,
      payload: { ...nuevo, layer: "SCALE", valueDomain: "SCORE" },
    });
    expect(r.statusCode).toBe(400);
  });

  it("un control de OPCIONES con una sola opción → 400", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: "/residencia/controles",
      headers: comoDirectora,
      payload: {
        ...nuevo,
        valueDomain: "ORDINAL",
        opciones: [{ code: "SI", label: "Sí" }],
      },
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toBe("ORDINAL_SIN_OPCIONES");
  });

  it("DOS opciones marcadas como «como siempre» → 400, no un 500", async () => {
    // Lo impide también el índice parcial
    // `control_type_options_un_como_siempre_key`; aquí se dice con una
    // frase.
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: "/residencia/controles",
      headers: comoDirectora,
      payload: {
        ...nuevo,
        valueDomain: "ORDINAL",
        opciones: [
          { code: "BIEN", label: "Bien", comoSiempre: true },
          { code: "MAL", label: "Mal", comoSiempre: true },
        ],
      },
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toBe("DOS_COMO_SIEMPRE");
  });

  it("una medida SIN UNIDAD → 400", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: "/residencia/controles",
      headers: comoDirectora,
      payload: { ...nuevo, layer: "MEASURE", valueDomain: "NUMERIC" },
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toBe("MEDIDA_SIN_UNIDAD");
  });
});

// ══ 5 · LOS PERMISOS DEL CATÁLOGO ═════════════════════════════════════
describe("escribir el catálogo es del OWNER · el encargado LEE", () => {
  it("el encargado LEE el catálogo", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/residencia/controles",
      headers: comoEncargado,
    });
    expect(r.statusCode).toBe(200);
  });

  it("…y NO lo cambia · 403", async () => {
    // Mismo criterio exacto que los roles y las zonas de residencia-1
    // (decisión 6 de su done): esto decide qué se registra de la salud de
    // una persona, que es la misma clase de decisión que
    // `PATCH /staff/:id/clinica`.
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH",
      url: "/residencia/controles/HIGIENE_PERSONAL",
      headers: comoEncargado,
      payload: { active: false },
    });
    expect(r.statusCode).toBe(403);
  });

  it("…ni crea un control propio · 403", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: "/residencia/controles",
      headers: comoEncargado,
      // El cuerpo tiene que ser VÁLIDO: Fastify valida el esquema antes
      // del `preHandler`, así que un cuerpo malo daría un 400 y el test
      // no probaría el permiso.
      payload: {
        code: "PROPIO",
        name: "Un control",
        layer: "EXEC",
        nature: "SCHEDULED",
        valueDomain: "BOOL",
        frecuencia: { kind: "DAILY", shiftCodes: ["M"] },
        careRoleCodes: ["AUXILIAR"],
      },
    });
    expect(r.statusCode).toBe(403);
  });

  it("…ni toca las plantillas · 403", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "PUT",
      url: "/residencia/plantillas/VALIDO",
      headers: comoEncargado,
      payload: { lineas: [] },
    });
    expect(r.statusCode).toBe(403);
  });

  it("…ni la hora del desayuno · 403", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH",
      url: "/residencia/momentos/DESAYUNO",
      headers: comoEncargado,
      payload: { atTime: "08:00" },
    });
    expect(r.statusCode).toBe(403);
  });
});

// ══ 6 · LAS PLANTILLAS ════════════════════════════════════════════════
describe("las plantillas por nivel", () => {
  it("se guardan como lista COMPLETA, y la anterior se reemplaza", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "PUT",
      url: "/residencia/plantillas/VALIDO",
      headers: comoDirectora,
      payload: {
        lineas: [
          { controlCode: "HIGIENE_PERSONAL", frecuencia: { kind: "DAILY", shiftCodes: ["M"] } },
        ],
      },
    });
    expect(r.statusCode).toBe(200);
    expect(plantillas).toHaveLength(1);
    const otra = await app.inject({
      method: "PUT",
      url: "/residencia/plantillas/VALIDO",
      headers: comoDirectora,
      payload: { lineas: [] },
    });
    expect(otra.statusCode).toBe(200);
    expect(plantillas).toHaveLength(0);
  });

  it("un control DOS VECES en la misma plantilla → 400", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "PUT",
      url: "/residencia/plantillas/VALIDO",
      headers: comoDirectora,
      payload: {
        lineas: [
          { controlCode: "HIGIENE_PERSONAL", frecuencia: { kind: "DAILY", shiftCodes: ["M"] } },
          { controlCode: "HIGIENE_PERSONAL", frecuencia: { kind: "DAILY", shiftCodes: ["T"] } },
        ],
      },
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toBe("CONTROL_REPETIDO");
  });

  it("una frecuencia no permitida en una línea → 400, y NO se guarda NADA", async () => {
    // Todo validado antes de escribir: que la mitad de la plantilla se
    // guarde y la otra falle deja un nivel con medio plan, y el siguiente
    // ingreso lo arrastra.
    const app = await buildApp();
    const r = await app.inject({
      method: "PUT",
      url: "/residencia/plantillas/VALIDO",
      headers: comoDirectora,
      payload: {
        lineas: [
          { controlCode: "HIGIENE_PERSONAL", frecuencia: { kind: "DAILY", shiftCodes: ["M"] } },
          { controlCode: "ANALITICA", frecuencia: { kind: "EVERY_SHIFT", shiftCodes: ["M"] } },
        ],
      },
    });
    expect(r.statusCode).toBe(400);
    expect(plantillas).toHaveLength(0);
  });

  it("un control A DEMANDA no se puede agendar en una plantilla → 400", async () => {
    // No hace daño pero no hace nada: `queToca` no devuelve ocurrencias
    // suyas. Se dice, para que nadie crea que ha agendado la deposición.
    const app = await buildApp();
    const r = await app.inject({
      method: "PUT",
      url: "/residencia/plantillas/VALIDO",
      headers: comoDirectora,
      payload: {
        lineas: [
          { controlCode: "DEPOSICION", frecuencia: { kind: "DAILY", shiftCodes: ["M"] } },
        ],
      },
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toMatch(/NATURALEZA_Y_FRECUENCIA|FRECUENCIA_NO_PERMITIDA/);
  });
});

// ══ 7 · EL PLAN DE UN RESIDENTE ═══════════════════════════════════════
describe("el plan de un residente", () => {
  it("LA AUXILIAR NO LO TOCA · 403 y dice quién sí", async () => {
    // Decidir cada cuánto se gira a una persona es una decisión clínica.
    // La auxiliar lo verá desde la puerta y registrará lo que toca; lo que
    // no hace es decidirlo.
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: `/residencia/residentes/${CARMEN}/plan`,
      headers: comoAuxiliar,
    });
    expect(r.statusCode).toBe(403);
    expect(r.json().error).toBe("PLAN_ES_DE_SUPERVISION");
    expect(r.json().message).toContain("DUE");
  });

  it("LA DUE SÍ · es SUPERVISOR y de alcance total", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: `/residencia/residentes/${CARMEN}/plan`,
      headers: comoDue,
    });
    expect(r.statusCode).toBe(200);
  });

  it("el OWNER SIN rol de cuidado NO ve el plan · lo para `conHistoria`", async () => {
    // Pasa la puerta de la capacidad (es el OWNER) y la para la función de
    // acceso: el plan de cuidados de alguien es un dato de salud, y
    // residencia-1 ya decidió que al OWNER sin rol de cuidado la FICHA le
    // dice «sin rol de cuidado» aunque la LISTA le salga entera
    // (decisión 7 de su done). Aquí se hereda tal cual.
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: `/residencia/residentes/${CARMEN}/plan`,
      headers: comoDirectora,
    });
    expect(r.statusCode).toBe(403);
  });

  it("…y CON su rol de dirección, sí", async () => {
    // Que es lo que pasa de verdad: quien dirige el centro lleva el rol de
    // cuidado `DIRECCION`, que es DIRECTIVO y de alcance total.
    asigRoles.push({
      userId: DIRECTORA,
      careRoleId: ROL_DUE,
      fromAt: new Date(0),
      toAt: null,
      revokedAt: null,
    });
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: `/residencia/residentes/${CARMEN}/plan`,
      headers: comoDirectora,
    });
    expect(r.statusCode, r.body).toBe(200);
  });

  it("EL ENCARGADO NO, por ser encargado · 403 SIN_ROL_DE_CUIDADO", async () => {
    // El encargado del bar de un centro mixto es un `MANAGER` y no tiene
    // por qué decidir cada cuánto se gira a doña Carmen. Si además es la
    // DUE, entra por su rol de cuidado — que es la vía que firma lo que
    // decide con su capacidad (D-31).
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: `/residencia/residentes/${CARMEN}/plan`,
      headers: comoEncargado,
    });
    expect(r.statusCode).toBe(403);
    expect(r.json().error).toBe("SIN_ROL_DE_CUIDADO");
  });

  it("LEER EL PLAN DEJA SU LÍNEA en el registro de accesos", async () => {
    // El plan de cuidados de alguien ES un dato de salud: dice que tiene
    // riesgo de úlceras y que no se levanta solo. Que lo diga una línea de
    // plan en vez de un diagnóstico no lo hace menos.
    const app = await buildApp();
    await app.inject({
      method: "GET",
      url: `/residencia/residentes/${CARMEN}/plan`,
      headers: comoDue,
    });
    expect(registro).toHaveLength(1);
    expect(registro[0]!.action).toBe("READ");
    expect(registro[0]!.clientId).toBe(CARMEN);
  });

  it("…y ESCRIBIRLO deja la suya con `WRITE`", async () => {
    const app = await buildApp();
    await app.inject({
      method: "POST",
      url: `/residencia/residentes/${CARMEN}/plan`,
      headers: comoDue,
      payload: {
        controlCode: "HIGIENE_PERSONAL",
        frecuencia: { kind: "DAILY", shiftCodes: ["M"] },
      },
    });
    expect(registro.map((l) => l.action)).toEqual(["WRITE"]);
  });

  it("un residente de OTRO centro es un 404, no un 403", async () => {
    // El aislamiento por fila va antes de la autorización clínica, y la
    // 404 es del tenant: un `clientId` de otro centro no existe para éste.
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: `/residencia/residentes/${randomUUID()}/plan`,
      headers: comoDue,
    });
    expect(r.statusCode).toBe(404);
  });

  it("AÑADIR un control abre una línea MANUAL · y eso es lo que la protege", async () => {
    // A mano es `MANUAL`, siempre, incluso si lo que se cambia es una
    // línea que puso la plantilla: en cuanto alguien la toca, el recálculo
    // del cambio de nivel no la cerrará nunca.
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: `/residencia/residentes/${CARMEN}/plan`,
      headers: comoDue,
      payload: {
        controlCode: "HIGIENE_PERSONAL",
        frecuencia: { kind: "EVERY_SHIFT", shiftCodes: ["M", "T"] },
      },
    });
    expect(r.statusCode).toBe(201);
    expect(lineasDePlan).toHaveLength(1);
    expect(lineasDePlan[0].source).toBe("MANUAL");
    expect(lineasDePlan[0].sourceLevel).toBeNull();
  });

  it("CAMBIAR LA FRECUENCIA cierra una línea y abre otra · no edita", async () => {
    const app = await buildApp();
    await app.inject({
      method: "POST",
      url: `/residencia/residentes/${CARMEN}/plan`,
      headers: comoDue,
      payload: {
        controlCode: "HIGIENE_PERSONAL",
        frecuencia: { kind: "DAILY", shiftCodes: ["M"] },
      },
    });
    await app.inject({
      method: "POST",
      url: `/residencia/residentes/${CARMEN}/plan`,
      headers: comoDue,
      payload: {
        controlCode: "HIGIENE_PERSONAL",
        frecuencia: { kind: "EVERY_SHIFT", shiftCodes: ["M", "T"] },
        motivo: "lo pide la DUE",
      },
    });
    expect(lineasDePlan).toHaveLength(2);
    const cerrada = lineasDePlan.find((l) => l.toAt);
    expect(cerrada.shiftCodes).toEqual(["M"]);
    // El motivo NO está en claro en la fila: está cifrado, y se lee
    // descifrándolo con el sitio de esa fila.
    expect(cerrada.closeReason).toBeNull();
    expect(await motivoDeCierreDe(cerrada)).toBe("lo pide la DUE");
    expect(lineasDePlan.filter((l) => !l.toAt)).toHaveLength(1);
  });

  it("GUARDAR DOS VECES LO MISMO no abre una línea idéntica", async () => {
    // Sin esto, abrir el panel y dar a guardar sin tocar nada ensuciaría
    // el histórico y el plan de ayer dejaría de parecerse al de hoy.
    const app = await buildApp();
    const payload = {
      controlCode: "HIGIENE_PERSONAL",
      frecuencia: { kind: "EVERY_SHIFT", shiftCodes: ["M", "T"] },
    };
    await app.inject({ method: "POST", url: `/residencia/residentes/${CARMEN}/plan`, headers: comoDue, payload });
    const segunda = await app.inject({
      method: "POST",
      url: `/residencia/residentes/${CARMEN}/plan`,
      headers: comoDue,
      payload,
    });
    expect(segunda.json().linea.sinCambios).toBe(true);
    expect(lineasDePlan).toHaveLength(1);
  });

  it("…ni aunque los turnos lleguen en otro ORDEN", async () => {
    // «M, T» y «T, M» son la misma frecuencia. Si se compararan en orden,
    // guardar dos veces lo mismo cerraría una línea para abrir otra
    // idéntica.
    const app = await buildApp();
    await app.inject({
      method: "POST",
      url: `/residencia/residentes/${CARMEN}/plan`,
      headers: comoDue,
      payload: {
        controlCode: "HIGIENE_PERSONAL",
        frecuencia: { kind: "EVERY_SHIFT", shiftCodes: ["M", "T"] },
      },
    });
    const segunda = await app.inject({
      method: "POST",
      url: `/residencia/residentes/${CARMEN}/plan`,
      headers: comoDue,
      payload: {
        controlCode: "HIGIENE_PERSONAL",
        frecuencia: { kind: "EVERY_SHIFT", shiftCodes: ["T", "M"] },
      },
    });
    expect(segunda.json().linea.sinCambios).toBe(true);
    expect(lineasDePlan).toHaveLength(1);
  });

  it("QUITAR una línea la CIERRA, no la borra", async () => {
    const app = await buildApp();
    await app.inject({
      method: "POST",
      url: `/residencia/residentes/${CARMEN}/plan`,
      headers: comoDue,
      payload: {
        controlCode: "HIGIENE_PERSONAL",
        frecuencia: { kind: "DAILY", shiftCodes: ["M"] },
      },
    });
    const id = lineasDePlan[0].id;
    const r = await app.inject({
      method: "DELETE",
      url: `/residencia/residentes/${CARMEN}/plan/${id}`,
      // SIN cuerpo, que es como lo llama la pantalla.
      headers: comoDue,
    });
    expect(r.statusCode, r.body).toBe(200);
    // La fila se queda: «¿qué le tocaba el 3 de marzo?» tiene que tener
    // respuesta.
    expect(lineasDePlan).toHaveLength(1);
    expect(lineasDePlan[0].toAt).not.toBeNull();
  });

  it("…y cerrar una ya cerrada → 409, y lo dice", async () => {
    const app = await buildApp();
    const yaCerrada = randomUUID();
    lineasDePlan.push({
      id: yaCerrada,
      tenantId: TENANT,
      clientId: CARMEN,
      controlCode: "X",
      toAt: new Date(),
    });
    const r = await app.inject({
      method: "DELETE",
      url: `/residencia/residentes/${CARMEN}/plan/${yaCerrada}`,
      headers: comoDue,
    });
    expect(r.statusCode).toBe(409);
    expect(r.json().message).toContain("histórico");
  });

  it("un control A DEMANDA no se puede agendar en el plan → 400", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: `/residencia/residentes/${CARMEN}/plan`,
      headers: comoDue,
      payload: {
        controlCode: "DEPOSICION",
        frecuencia: { kind: "DAILY", shiftCodes: ["M"] },
      },
    });
    expect(r.statusCode).toBe(400);
  });
});

// ══ 8 · LA VISTA «HOY» ════════════════════════════════════════════════
describe("la vista «hoy» · `queToca` por HTTP", () => {
  it("agrupa por turno, en el orden del cuadrante", async () => {
    const app = await buildApp();
    lineasDePlan.push({
      id: "l1",
      tenantId: TENANT,
      clientId: CARMEN,
      controlCode: "HIGIENE_PERSONAL",
      frequencyKind: "DAILY",
      everyNHours: null,
      everyNDays: null,
      weekdays: [],
      monthDay: null,
      shiftCodes: ["M"],
      momentCodes: [],
      fromAt: new Date("2020-01-01"),
      toAt: null,
    });
    const r = await app.inject({
      method: "GET",
      url: `/residencia/residentes/${CARMEN}/plan/hoy`,
      headers: comoDue,
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.porTurno.map((t: any) => t.code)).toEqual(["M", "T", "N"]);
    expect(body.porTurno[0].ocurrencias).toHaveLength(1);
    expect(body.total).toBe(1);
  });

  it("UN CONTROL DESACTIVADO EN EL CENTRO no sale", async () => {
    const app = await buildApp();
    ajustes[0]!.active = false;
    lineasDePlan.push({
      id: "l1",
      tenantId: TENANT,
      clientId: CARMEN,
      controlCode: "HIGIENE_PERSONAL",
      frequencyKind: "DAILY",
      everyNHours: null,
      everyNDays: null,
      weekdays: [],
      monthDay: null,
      shiftCodes: ["M"],
      momentCodes: [],
      fromAt: new Date("2020-01-01"),
      toAt: null,
    });
    const r = await app.inject({
      method: "GET",
      url: `/residencia/residentes/${CARMEN}/plan/hoy`,
      headers: comoDue,
    });
    expect(r.json().total).toBe(0);
  });

  it("y los A DEMANDA salen APARTE, no escondidos", async () => {
    // El botón sí estará en la puerta, y una vista de «hoy» que los
    // esconda haría creer que la deposición no se apunta.
    const app = await buildApp();
    lineasDePlan.push({
      id: "l2",
      tenantId: TENANT,
      clientId: CARMEN,
      controlCode: "DEPOSICION",
      frequencyKind: "ON_DEMAND",
      everyNHours: null,
      everyNDays: null,
      weekdays: [],
      monthDay: null,
      shiftCodes: [],
      momentCodes: [],
      fromAt: new Date("2020-01-01"),
      toAt: null,
    });
    const r = await app.inject({
      method: "GET",
      url: `/residencia/residentes/${CARMEN}/plan/hoy`,
      headers: comoDue,
    });
    expect(r.json().total).toBe(0);
    expect(r.json().aDemanda.map((a: any) => a.controlCode)).toEqual(["DEPOSICION"]);
  });

  it("acepta un DÍA CUALQUIERA · «¿qué le tocaba el 3 de marzo?»", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: `/residencia/residentes/${CARMEN}/plan/hoy?dia=2026-03-03`,
      headers: comoDue,
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().dia).toBe("2026-03-03");
  });
});
