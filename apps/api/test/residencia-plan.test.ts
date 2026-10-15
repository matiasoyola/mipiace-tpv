// residencia-2 · LA PLANTILLA APLICADA, y el cambio de nivel.
//
// Lo que se prueba aquí es `aplicarPlantilla` y `cerrarPlanPorAlta`: la
// lógica que decide qué línea se abre, qué línea se cierra y —sobre todo—
// **qué línea NO se toca**.
//
// Es la promesa más frágil del bloque: la DUE ajusta el plan de doña
// Carmen a mano, la dirección le sube el nivel de dependencia tres meses
// después, y ese ajuste tiene que sobrevivir. Si no sobrevive, nadie lo
// descubre hasta que alguien se da cuenta de que la señora ha vuelto a los
// cambios posturales de tres horas.
//
// El doble de la transacción es en memoria y pequeño a propósito: la
// función sólo toca cuatro modelos, y con una base de verdad cada caso
// costaría una migración. Lo que el MOTOR garantiza (una línea viva por
// residente y control, que `source_level` sólo existe en las de plantilla)
// lo prueba `residencia-2.e2e.ts` contra Postgres.

import { randomUUID } from "node:crypto";

import { beforeEach, describe, expect, it } from "vitest";

import { aplicarPlantilla, cerrarPlanPorAlta } from "../src/residencia/plan.js";

const TENANT = "00000000-0000-0000-0000-000000000001";
const CARMEN = "44444444-4444-4444-4444-444444444444";
const DIRECTORA = "11111111-1111-1111-1111-111111111111";

interface FilaDePlan {
  id: string;
  tenantId: string;
  clientId: string;
  controlCode: string;
  frequencyKind: string;
  everyNHours: number | null;
  everyNDays: number | null;
  weekdays: number[];
  monthDay: number | null;
  shiftCodes: string[];
  momentCodes: string[];
  fromAt: Date;
  toAt: Date | null;
  source: string;
  sourceLevel: string | null;
  reason: string | null;
  closeReason: string | null;
  closedByUserId: string | null;
  createdByUserId: string | null;
}

interface FilaDePlantilla {
  tenantId: string;
  dependencyLevel: string;
  controlCode: string;
  frequencyKind: string;
  everyNHours?: number | null;
  everyNDays?: number | null;
  weekdays?: number[];
  monthDay?: number | null;
  shiftCodes?: string[];
  momentCodes?: string[];
}

let plan: FilaDePlan[] = [];
let plantillas: FilaDePlantilla[] = [];
let apagados: string[] = [];

/** El mínimo de una transacción de Prisma que `aplicarPlantilla` toca. */
const tx = {
  carePlanTemplateItem: {
    findMany: async ({ where }: any) =>
      plantillas
        .filter(
          (p) =>
            p.tenantId === where.tenantId &&
            p.dependencyLevel === where.dependencyLevel,
        )
        .map((p) => ({
          controlCode: p.controlCode,
          frequencyKind: p.frequencyKind,
          everyNHours: p.everyNHours ?? null,
          everyNDays: p.everyNDays ?? null,
          weekdays: p.weekdays ?? [],
          monthDay: p.monthDay ?? null,
          shiftCodes: p.shiftCodes ?? [],
          momentCodes: p.momentCodes ?? [],
        })),
  },
  centerControlSetting: {
    findMany: async () => apagados.map((controlCode) => ({ controlCode })),
  },
  carePlanItem: {
    findMany: async ({ where }: any) =>
      plan.filter(
        (l) =>
          l.tenantId === where.tenantId &&
          l.clientId === where.clientId &&
          (where.toAt === null ? l.toAt === null : true),
      ),
    update: async ({ where, data }: any) => {
      const fila = plan.find((l) => l.id === where.id)!;
      Object.assign(fila, data);
      return fila;
    },
    create: async ({ data }: any) => {
      const fila = { id: randomUUID(), ...nueva(data) };
      plan.push(fila);
      return fila;
    },
    createMany: async ({ data }: any) => {
      for (const d of data) plan.push({ id: randomUUID(), ...nueva(d) });
      return { count: data.length };
    },
    updateMany: async ({ where, data }: any) => {
      const tocadas = plan.filter(
        (l) =>
          l.tenantId === where.tenantId &&
          l.clientId === where.clientId &&
          (where.toAt === null ? l.toAt === null : true),
      );
      for (const l of tocadas) Object.assign(l, data);
      return { count: tocadas.length };
    },
  },
} as any;

function nueva(d: any): Omit<FilaDePlan, "id"> {
  return {
    tenantId: d.tenantId,
    clientId: d.clientId,
    controlCode: d.controlCode,
    frequencyKind: d.frequencyKind,
    everyNHours: d.everyNHours ?? null,
    everyNDays: d.everyNDays ?? null,
    weekdays: d.weekdays ?? [],
    monthDay: d.monthDay ?? null,
    shiftCodes: d.shiftCodes ?? [],
    momentCodes: d.momentCodes ?? [],
    fromAt: d.fromAt,
    toAt: d.toAt ?? null,
    source: d.source,
    sourceLevel: d.sourceLevel ?? null,
    reason: d.reason ?? null,
    closeReason: null,
    closedByUserId: null,
    createdByUserId: d.createdByUserId ?? null,
  };
}

/** Las líneas VIVAS, con su frecuencia en corto, para leer el test. */
function vivas(): Array<[string, string]> {
  return plan
    .filter((l) => l.toAt === null)
    .map((l) => [l.controlCode, resumen(l)] as [string, string])
    .sort((a, b) => a[0].localeCompare(b[0]));
}

function resumen(l: FilaDePlan): string {
  switch (l.frequencyKind) {
    case "EVERY_N_HOURS":
      return `cada ${l.everyNHours} h`;
    case "EVERY_SHIFT":
      return `turnos ${l.shiftCodes.join("+")}`;
    case "DAILY":
      return `diario ${l.shiftCodes[0]}`;
    case "MOMENTS":
      return `momentos ${l.momentCodes.join("+")}`;
    default:
      return l.frequencyKind;
  }
}

/** Las plantillas de serie reducidas a lo que hace falta para el test. */
const PLANTILLA_SEMI: FilaDePlantilla[] = [
  { tenantId: TENANT, dependencyLevel: "SEMIASISTIDO", controlCode: "HIGIENE_PERSONAL", frequencyKind: "DAILY", shiftCodes: ["M"] },
  { tenantId: TENANT, dependencyLevel: "SEMIASISTIDO", controlCode: "COMIDA", frequencyKind: "MOMENTS", momentCodes: ["COMIDA"] },
  { tenantId: TENANT, dependencyLevel: "SEMIASISTIDO", controlCode: "HIDRATACION_CUTANEA", frequencyKind: "DAILY", shiftCodes: ["T"] },
  { tenantId: TENANT, dependencyLevel: "SEMIASISTIDO", controlCode: "GIMNASIA", frequencyKind: "WEEKDAYS", weekdays: [1, 3, 5], shiftCodes: ["M"] },
];

const PLANTILLA_DEPE: FilaDePlantilla[] = [
  { tenantId: TENANT, dependencyLevel: "DEPENDIENTE", controlCode: "HIGIENE_PERSONAL", frequencyKind: "DAILY", shiftCodes: ["M"] },
  { tenantId: TENANT, dependencyLevel: "DEPENDIENTE", controlCode: "COMIDA", frequencyKind: "MOMENTS", momentCodes: ["COMIDA"] },
  // Sube de frecuencia respecto al semiasistido: diaria → cada turno.
  { tenantId: TENANT, dependencyLevel: "DEPENDIENTE", controlCode: "HIDRATACION_CUTANEA", frequencyKind: "EVERY_SHIFT", shiftCodes: ["M", "T"] },
  // Entra: es LA línea del dependiente.
  { tenantId: TENANT, dependencyLevel: "DEPENDIENTE", controlCode: "CAMBIO_POSTURAL", frequencyKind: "EVERY_N_HOURS", everyNHours: 3 },
  // Y la gimnasia SALE: un dependiente no va al gimnasio.
];

beforeEach(() => {
  plan = [];
  plantillas = [...PLANTILLA_SEMI, ...PLANTILLA_DEPE];
  apagados = [];
});

describe("al dar de alta a un residente", () => {
  it("se le precarga la plantilla de su nivel, desde la fecha de INGRESO", async () => {
    const ingreso = new Date("2026-10-14T00:00:00.000Z");
    const r = await aplicarPlantilla(tx, {
      tenantId: TENANT,
      clientId: CARMEN,
      nivel: "SEMIASISTIDO",
      nivelAnterior: null,
      desde: ingreso,
      userId: DIRECTORA,
      motivo: "ingreso",
    });
    expect(r.abiertas.sort()).toEqual([
      "COMIDA",
      "GIMNASIA",
      "HIDRATACION_CUTANEA",
      "HIGIENE_PERSONAL",
    ]);
    expect(r.cerradas).toEqual([]);
    // `fromAt` es la fecha de ingreso y no «ahora»: así `queToca` no le
    // pide nada de antes de llegar al centro.
    expect(plan.every((l) => l.fromAt === ingreso)).toBe(true);
    // Todas de plantilla, y todas con el nivel del que vinieron: sin eso,
    // el cambio de nivel no sabría cuáles cerrar.
    expect(plan.every((l) => l.source === "PROFILE_TEMPLATE")).toBe(true);
    expect(plan.every((l) => l.sourceLevel === "SEMIASISTIDO")).toBe(true);
    // Y firmadas por quien lo hizo.
    expect(plan.every((l) => l.createdByUserId === DIRECTORA)).toBe(true);
  });

  it("un nivel con plantilla VACÍA no abre nada, y no es un error", async () => {
    // El estado es legítimo: un centro puede decidir que el válido no
    // lleva nada precargado. La pantalla del plan lo dice en ámbar.
    plantillas = [];
    const r = await aplicarPlantilla(tx, {
      tenantId: TENANT,
      clientId: CARMEN,
      nivel: "VALIDO",
      nivelAnterior: null,
      desde: new Date(),
      userId: DIRECTORA,
      motivo: "ingreso",
    });
    expect(r.abiertas).toEqual([]);
    expect(plan).toEqual([]);
  });

  it("un control DESACTIVADO por el centro no entra en el plan", async () => {
    // Entraría, no «tocaría» nunca (`queToca` lo salta) y aparecería en su
    // ficha como una línea muerta que nadie entiende.
    apagados = ["GIMNASIA"];
    const r = await aplicarPlantilla(tx, {
      tenantId: TENANT,
      clientId: CARMEN,
      nivel: "SEMIASISTIDO",
      nivelAnterior: null,
      desde: new Date(),
      userId: DIRECTORA,
      motivo: "ingreso",
    });
    expect(r.abiertas).not.toContain("GIMNASIA");
    expect(r.abiertas).toHaveLength(3);
  });
});

describe("al cambiarle el NIVEL", () => {
  async function alta(nivel: "SEMIASISTIDO" | "DEPENDIENTE" = "SEMIASISTIDO") {
    await aplicarPlantilla(tx, {
      tenantId: TENANT,
      clientId: CARMEN,
      nivel,
      nivelAnterior: null,
      desde: new Date("2026-10-14T00:00:00.000Z"),
      userId: DIRECTORA,
      motivo: "ingreso",
    });
  }

  async function subirADependiente() {
    return aplicarPlantilla(tx, {
      tenantId: TENANT,
      clientId: CARMEN,
      nivel: "DEPENDIENTE",
      nivelAnterior: "SEMIASISTIDO",
      desde: new Date("2027-01-10T10:00:00.000Z"),
      userId: DIRECTORA,
      motivo: "cambio de nivel: SEMIASISTIDO → DEPENDIENTE",
    });
  }

  it("se abre lo que trae el nivel nuevo, se cierra lo que ya no lleva", async () => {
    await alta();
    const r = await subirADependiente();
    // Entra el cambio postural, sale la gimnasia.
    expect(r.abiertas).toContain("CAMBIO_POSTURAL");
    expect(r.cerradas).toContain("GIMNASIA");
    expect(vivas()).toEqual([
      ["CAMBIO_POSTURAL", "cada 3 h"],
      ["COMIDA", "momentos COMIDA"],
      ["HIDRATACION_CUTANEA", "turnos M+T"],
      ["HIGIENE_PERSONAL", "diario M"],
    ]);
  });

  it("lo que sube de FRECUENCIA se cierra y se abre, no se edita", async () => {
    await alta();
    await subirADependiente();
    const hidratacion = plan.filter((l) => l.controlCode === "HIDRATACION_CUTANEA");
    // Dos filas: la diaria cerrada y la de cada turno viva. Si se editara
    // la fila, «¿qué le tocaba en diciembre?» diría «cada turno» — y en
    // diciembre era diaria.
    expect(hidratacion).toHaveLength(2);
    expect(hidratacion.filter((l) => l.toAt === null)).toHaveLength(1);
    expect(hidratacion.find((l) => l.toAt !== null)!.shiftCodes).toEqual(["T"]);
  });

  it("lo que NO cambia de frecuencia se queda QUIETO · ni una fila nueva", async () => {
    await alta();
    const idAntes = plan.find((l) => l.controlCode === "COMIDA")!.id;
    const r = await subirADependiente();
    expect(r.yaTenian).toContain("COMIDA");
    expect(plan.filter((l) => l.controlCode === "COMIDA")).toHaveLength(1);
    // El mismo id: la línea no se ha tocado. Sin esto, cada cambio de
    // nivel duplicaría media ficha en el histórico.
    expect(plan.find((l) => l.controlCode === "COMIDA")!.id).toBe(idAntes);
  });

  it("LA LÍNEA MANUAL SOBREVIVE · es la promesa del bloque", async () => {
    await alta();
    // La DUE ajusta la hidratación a mano: cada turno, los tres.
    const linea = plan.find((l) => l.controlCode === "HIDRATACION_CUTANEA")!;
    linea.toAt = new Date("2026-11-01T00:00:00.000Z");
    plan.push({
      ...linea,
      id: randomUUID(),
      frequencyKind: "EVERY_SHIFT",
      shiftCodes: ["M", "T", "N"],
      fromAt: new Date("2026-11-01T00:00:00.000Z"),
      toAt: null,
      source: "MANUAL",
      sourceLevel: null,
    });

    const r = await subirADependiente();

    // La plantilla del dependiente dice «M+T». La de la DUE dice «M+T+N».
    // Gana la de la DUE: lo decidió mirando a la señora.
    expect(r.yaTenian).toContain("HIDRATACION_CUTANEA");
    expect(vivas()).toContainEqual(["HIDRATACION_CUTANEA", "turnos M+T+N"]);
    expect(
      plan.filter((l) => l.controlCode === "HIDRATACION_CUTANEA" && l.toAt === null),
    ).toHaveLength(1);
  });

  it("…y una manual que el nivel nuevo NO lleva tampoco se cierra", async () => {
    await alta();
    // Un control que nadie precargó: lo puso la DUE porque esta señora lo
    // necesita. Bajarle el nivel no puede quitárselo.
    plan.push({
      id: randomUUID(),
      tenantId: TENANT,
      clientId: CARMEN,
      controlCode: "GLUCEMIA",
      frequencyKind: "MOMENTS",
      everyNHours: null,
      everyNDays: null,
      weekdays: [],
      monthDay: null,
      shiftCodes: [],
      momentCodes: ["DESAYUNO", "CENA"],
      fromAt: new Date("2026-11-01T00:00:00.000Z"),
      toAt: null,
      source: "MANUAL",
      sourceLevel: null,
      reason: "diabética, lo pide la DUE",
      closeReason: null,
      closedByUserId: null,
      createdByUserId: DIRECTORA,
    });

    const r = await subirADependiente();
    expect(r.cerradas).not.toContain("GLUCEMIA");
    expect(vivas()).toContainEqual(["GLUCEMIA", "momentos DESAYUNO+CENA"]);
  });

  it("lo que se cierra queda FIRMADO y con su motivo", async () => {
    await alta();
    await subirADependiente();
    const gimnasia = plan.find((l) => l.controlCode === "GIMNASIA")!;
    expect(gimnasia.toAt).not.toBeNull();
    expect(gimnasia.closedByUserId).toBe(DIRECTORA);
    expect(gimnasia.closeReason).toBe("cambio de nivel: SEMIASISTIDO → DEPENDIENTE");
  });

  it("la línea nueva empieza AL CAMBIAR el nivel, no al ingresar", async () => {
    await alta();
    await subirADependiente();
    const postural = plan.find((l) => l.controlCode === "CAMBIO_POSTURAL")!;
    // Si empezara en el ingreso, se solaparía con la que se acaba de
    // cerrar y «¿qué le tocaba en marzo?» tendría dos respuestas.
    expect(postural.fromAt.toISOString()).toBe("2027-01-10T10:00:00.000Z");
  });

  it("bajar de nivel también funciona, y cierra lo que el nivel nuevo no lleva", async () => {
    await alta("DEPENDIENTE");
    const r = await aplicarPlantilla(tx, {
      tenantId: TENANT,
      clientId: CARMEN,
      nivel: "SEMIASISTIDO",
      nivelAnterior: "DEPENDIENTE",
      desde: new Date("2027-03-01T10:00:00.000Z"),
      userId: DIRECTORA,
      motivo: "cambio de nivel: DEPENDIENTE → SEMIASISTIDO",
    });
    // Se va el cambio postural, vuelve la gimnasia.
    expect(r.cerradas).toContain("CAMBIO_POSTURAL");
    expect(r.abiertas).toContain("GIMNASIA");
    expect(vivas().map(([c]) => c)).not.toContain("CAMBIO_POSTURAL");
  });

  it("aplicar DOS VECES el mismo nivel no hace nada", async () => {
    // Pasa de verdad: guardar la ficha dos veces, o un doble clic. Si
    // abriera líneas, el índice `care_plan_items_one_live_key` lo
    // rechazaría a mitad de la transacción del PATCH.
    await alta();
    const cuantas = plan.length;
    const r = await aplicarPlantilla(tx, {
      tenantId: TENANT,
      clientId: CARMEN,
      nivel: "SEMIASISTIDO",
      nivelAnterior: "SEMIASISTIDO",
      desde: new Date(),
      userId: DIRECTORA,
      motivo: "otra vez",
    });
    expect(r.abiertas).toEqual([]);
    expect(r.cerradas).toEqual([]);
    expect(plan).toHaveLength(cuantas);
  });
});

describe("al DAR DE ALTA a quien se va", () => {
  it("se le cierra el plan entero, con su motivo, y no se borra nada", async () => {
    await aplicarPlantilla(tx, {
      tenantId: TENANT,
      clientId: CARMEN,
      nivel: "SEMIASISTIDO",
      nivelAnterior: null,
      desde: new Date("2026-10-14T00:00:00.000Z"),
      userId: DIRECTORA,
      motivo: "ingreso",
    });
    const cuantas = plan.length;
    const alta = new Date("2027-05-02T00:00:00.000Z");

    const cerradas = await cerrarPlanPorAlta(tx, {
      tenantId: TENANT,
      clientId: CARMEN,
      cuando: alta,
      userId: DIRECTORA,
      motivo: "alta del residente",
    });

    expect(cerradas).toBe(cuantas);
    expect(vivas()).toEqual([]);
    // Las filas se quedan: «¿qué le tocaba cuando se fue?» es una pregunta
    // legítima, y su plan es parte de lo que se conserva cinco años.
    expect(plan).toHaveLength(cuantas);
    expect(plan.every((l) => l.toAt?.toISOString() === alta.toISOString())).toBe(true);
    expect(plan.every((l) => l.closeReason === "alta del residente")).toBe(true);
  });

  it("y si ya no tenía plan vivo, no pasa nada", async () => {
    expect(
      await cerrarPlanPorAlta(tx, {
        tenantId: TENANT,
        clientId: CARMEN,
        cuando: new Date(),
        userId: null,
        motivo: "alta",
      }),
    ).toBe(0);
  });
});
