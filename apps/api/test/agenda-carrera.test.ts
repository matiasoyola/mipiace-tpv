// Frente carrera-409 · LA CARRERA DE DOS ALTAS, y sus DOS finales.
//
// Lo que se prueba aquí es la TRADUCCIÓN, que es lo que faltaba. Hasta este
// frente `store.ts` sólo conocía un final de la carrera:
//
//   · **23P01** (`exclusion_violation`) — la segunda alta esperó, la
//     primera cometió, el `EXCLUDE` la echó. → `ExclusionError` → TAKEN →
//     409 con alternativas. Esto ya funcionaba.
//   · **40P01** (`deadlock_detected`) — las dos metieron su entrada en el
//     índice GiST antes de que ninguna llegara a escanearlo, cada una se
//     puso a esperar a la otra, y Postgres tumbó a una para desatascarlas.
//     Esto NO se reconocía: salía por el manejador genérico como un 500, y
//     tenía el CI de master en rojo.
//
// La diferencia entre los dos no es cosmética y por eso no basta con añadir
// el `40P01` a la lista del `23P01`: **un deadlock no quiere decir que el
// hueco se haya perdido**. Quiere decir que Postgres eligió a una víctima
// para romper el ciclo, y la víctima puede entrar perfectamente. Así que se
// reintenta la transacción ENTERA una vez, y sólo si el reintento choca de
// verdad contra el `EXCLUDE` sale TAKEN.
//
// El error que se inyecta está copiado del que se capturó de verdad contra
// Postgres (`docs/blocks/carrera-alta-409-plan.md` §1.3), con su forma
// exacta: `code: "P2010"` por fuera —que es lo que engaña— y el SQLSTATE
// escondido en `meta.code`.
//
// El 409 de la punta (y el deadlock provocado DE VERDAD, no inyectado) se
// prueban contra Postgres real en `test-e2e/agenda-carrera.e2e.ts`.

import { randomUUID } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { createAgendaStore, ExclusionError, readRaceStats } from "../src/agenda/store.js";
import { sqlStateOf, hasSqlState } from "../src/lib/sqlstate.js";
import type { PlannedAssignment } from "../src/agenda/types.js";

const TENANT = "11111111-1111-4111-8111-111111111111";
const CORTE = "33333333-3333-4333-8333-333333333333";
const SOLE = "55555555-5555-4555-8555-555555555555";
const CITA = "77777777-7777-4777-8777-777777777777";

// ── Los errores, con la forma REAL ──────────────────────────────────────

/** El deadlock, tal y como llega: Prisma lo envuelve en `P2010` («raw query
 *  failed») y deja el SQLSTATE sólo en `meta.code` y en el texto. */
function errorDeDeadlock(): Error {
  const err = new Error(
    "\nInvalid `prisma.$executeRawUnsafe()` invocation:\n\n\n" +
      "Raw query failed. Code: `40P01`. Message: `ERROR: deadlock detected\n" +
      "DETAIL: Process 1497 waits for ShareLock on transaction 56735; blocked by process 1494.\n" +
      "Process 1494 waits for ShareLock on transaction 56734; blocked by process 1497.`",
  );
  err.name = "PrismaClientKnownRequestError";
  Object.assign(err, {
    code: "P2010",
    meta: {
      code: "40P01",
      message: "ERROR: deadlock detected\nDETAIL: Process 1497 waits…",
    },
  });
  return err;
}

/** El `EXCLUDE` mordiendo, que es el final que ya se traducía bien. */
function errorDeExclusion(): Error {
  const err = new Error(
    "\nInvalid `prisma.$executeRawUnsafe()` invocation:\n\n\n" +
      'Raw query failed. Code: `23P01`. Message: `ERROR: conflicting key value violates exclusion constraint "no_staff_overlap"`',
  );
  err.name = "PrismaClientKnownRequestError";
  Object.assign(err, {
    code: "P2010",
    meta: { code: "23P01", message: "no_staff_overlap" },
  });
  return err;
}

/** Cualquier otra cosa. No es de esta familia y NO se puede disfrazar de
 *  «hueco ocupado»: tiene que subir tal cual. */
function errorDeClaveAjena(): Error {
  const err = new Error("Foreign key constraint failed on the field: `service_id`");
  err.name = "PrismaClientKnownRequestError";
  Object.assign(err, { code: "P2003", meta: { field_name: "service_id" } });
  return err;
}

// ── El doble de Prisma ──────────────────────────────────────────────────

/**
 * Un Prisma de mentira con una sola gracia: `$transaction` falla las `fallos`
 * primeras veces con `error()` y a la siguiente se deja correr. Cuenta los
 * intentos, que es lo que dice si hubo reintento o no.
 */
function prismaDoble(opciones: {
  fallos: number;
  error: () => Error;
  citaExiste?: boolean;
}) {
  const estado = { intentos: 0, transaccionesCompletadas: 0 };
  const tx = {
    $executeRawUnsafe: vi.fn(async () => 1),
    appointmentItem: { createMany: vi.fn(async () => ({ count: 1 })) },
    appointmentAssignment: { deleteMany: vi.fn(async () => ({ count: 1 })) },
  };
  const prisma = {
    $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => {
      estado.intentos += 1;
      if (estado.intentos <= opciones.fallos) throw opciones.error();
      const out = await fn(tx);
      estado.transaccionesCompletadas += 1;
      return out;
    }),
    // La relectura de después del INSERT.
    $queryRawUnsafe: vi.fn(async () => [
      {
        id: CITA,
        client_id: null,
        status: "CONFIRMED",
        source: "PRESENCIAL",
        starts_at: new Date("2026-09-15T08:00:00.000Z"),
        ends_at: new Date("2026-09-15T08:30:00.000Z"),
        ticket_id: null,
        notes: null,
      },
    ]),
    appointment: {
      findFirst: vi.fn(async () =>
        opciones.citaExiste === false ? null : { id: CITA },
      ),
    },
    appointmentItem: {
      findMany: vi.fn(async () => [
        { id: "item-1", serviceId: CORTE, durationMin: 30, sortOrder: 0, startOffsetMin: 0 },
      ]),
    },
    appointmentAssignment: {
      findMany: vi.fn(async () => [
        { reservableType: "STAFF", staffUserId: SOLE, resourceId: null },
      ]),
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { prisma: prisma as any, estado, tx };
}

const INICIO = new Date("2026-09-15T08:00:00.000Z");
const FIN = new Date("2026-09-15T08:30:00.000Z");

function asignaciones(): PlannedAssignment[] {
  return [
    {
      appointmentItemIndex: 0,
      reservableType: "STAFF",
      staffUserId: SOLE,
      resourceId: null,
      startsAt: INICIO,
      endsAt: FIN,
    },
  ];
}

function alta() {
  return {
    tenantId: TENANT,
    externalId: randomUUID(),
    clientId: null,
    source: "PRESENCIAL" as const,
    status: "CONFIRMED" as const,
    pendingUntil: null,
    notes: null,
    timeslotStart: INICIO,
    timeslotEnd: FIN,
    items: [
      {
        serviceId: CORTE,
        durationMin: 30,
        bufferBeforeMin: 0,
        bufferAfterMin: 0,
        staffRequired: 1,
        sortOrder: 0,
        startOffsetMin: 0,
      },
    ],
    assignments: asignaciones(),
  };
}

// ── 1. Leer el SQLSTATE venga como venga ────────────────────────────────

describe("sqlStateOf · el código de Postgres, esté donde esté", () => {
  it("lo saca de meta.code cuando Prisma envuelve una raw query", () => {
    // ÉSTE es el caso que costó una sonda entera: por fuera pone `P2010`.
    expect(sqlStateOf(errorDeDeadlock())).toBe("40P01");
    expect(sqlStateOf(errorDeExclusion())).toBe("23P01");
  });

  it("no confunde un código de Prisma con un SQLSTATE", () => {
    // `P2003` y `P2010` tienen la forma de un SQLSTATE y no lo son.
    expect(sqlStateOf(errorDeClaveAjena())).toBeNull();
    const soloPrisma = Object.assign(new Error("boom"), { code: "P2028" });
    expect(sqlStateOf(soloPrisma)).toBeNull();
  });

  it("lo saca de `code` a pelo (driver pg) y del texto (error serializado)", () => {
    expect(sqlStateOf(Object.assign(new Error("x"), { code: "40P01" }))).toBe("40P01");
    expect(
      sqlStateOf(new Error("Raw query failed. Code: `40001`. Message: `…`")),
    ).toBe("40001");
  });

  it("no lanza con basura y devuelve null", () => {
    expect(sqlStateOf(null)).toBeNull();
    expect(sqlStateOf(undefined)).toBeNull();
    expect(sqlStateOf("un string suelto")).toBeNull();
    expect(sqlStateOf({ meta: null })).toBeNull();
    expect(hasSqlState(errorDeDeadlock(), "40P01")).toBe(true);
    expect(hasSqlState(errorDeDeadlock(), "23P01")).toBe(false);
  });
});

// ── 2. El alta ──────────────────────────────────────────────────────────

describe("insertHold · los dos finales de la carrera", () => {
  it("el deadlock se REINTENTA y, si el reintento entra, la cita es válida", async () => {
    // El corazón del frente: un 40P01 no es un hueco perdido.
    const { prisma, estado } = prismaDoble({ fallos: 1, error: errorDeDeadlock });
    const store = createAgendaStore(prisma);

    const view = await store.insertHold(alta());

    expect(view.id).toBe(CITA);
    expect(estado.intentos).toBe(2); // el que murió y el que entró
    expect(estado.transaccionesCompletadas).toBe(1); // UNA cita, no dos
  });

  it("si el reintento choca contra el EXCLUDE, ENTONCES sí es TAKEN", async () => {
    // Primero deadlock, luego 23P01: alguien se lo quedó de verdad.
    let n = 0;
    const { prisma, estado } = prismaDoble({
      fallos: 2,
      error: () => (++n === 1 ? errorDeDeadlock() : errorDeExclusion()),
    });
    const store = createAgendaStore(prisma);

    await expect(store.insertHold(alta())).rejects.toBeInstanceOf(ExclusionError);
    expect(estado.intentos).toBe(2);
    expect(estado.transaccionesCompletadas).toBe(0);
  });

  it("el deadlock repetido acaba en TAKEN, NUNCA en 500, y con un solo reintento", async () => {
    // El tope. Un 409 con alternativas es peor que un 201 y muchísimo mejor
    // que un 500: la cajera tiene tres horas que leer en voz alta.
    const { prisma, estado } = prismaDoble({ fallos: 99, error: errorDeDeadlock });
    const store = createAgendaStore(prisma);

    await expect(store.insertHold(alta())).rejects.toBeInstanceOf(ExclusionError);
    // DOS intentos: el original y UN reintento. Ni uno más — sin bucle.
    expect(estado.intentos).toBe(2);
  });

  it("el 23P01 NO se reintenta: el hueco es de otra, insistir no lo devuelve", async () => {
    const { prisma, estado } = prismaDoble({ fallos: 99, error: errorDeExclusion });
    const store = createAgendaStore(prisma);

    await expect(store.insertHold(alta())).rejects.toBeInstanceOf(ExclusionError);
    expect(estado.intentos).toBe(1);
  });

  it("un error que no es de la carrera sube TAL CUAL, sin disfrazarse de TAKEN", async () => {
    // Si una FK rota saliera como «ese hueco ya no está», el mostrador
    // perseguiría un fantasma y el fallo de verdad no lo vería nadie.
    const { prisma, estado } = prismaDoble({ fallos: 99, error: errorDeClaveAjena });
    const store = createAgendaStore(prisma);

    await expect(store.insertHold(alta())).rejects.toMatchObject({ code: "P2003" });
    expect(estado.intentos).toBe(1); // tampoco se reintenta
  });

  it("el 40001 (serialization_failure) va por el mismo camino que el 40P01", async () => {
    const serializacion = () => {
      const err = new Error("Raw query failed. Code: `40001`. Message: `could not serialize`");
      err.name = "PrismaClientKnownRequestError";
      Object.assign(err, { code: "P2010", meta: { code: "40001" } });
      return err;
    };
    const { prisma, estado } = prismaDoble({ fallos: 1, error: serializacion });
    const store = createAgendaStore(prisma);

    await expect(store.insertHold(alta())).resolves.toMatchObject({ id: CITA });
    expect(estado.intentos).toBe(2);
  });
});

// ── 3. Mover, que es la misma carrera ───────────────────────────────────

describe("reschedule · mover cae en la misma carrera y con el mismo trato", () => {
  it("el deadlock se reintenta y el movimiento entra", async () => {
    const { prisma, estado } = prismaDoble({ fallos: 1, error: errorDeDeadlock });
    const store = createAgendaStore(prisma);

    const view = await store.reschedule(TENANT, CITA, INICIO, FIN, asignaciones());

    expect(view?.id).toBe(CITA);
    expect(estado.intentos).toBe(2);
    expect(estado.transaccionesCompletadas).toBe(1);
  });

  it("el deadlock repetido acaba en TAKEN, no en 500", async () => {
    const { prisma, estado } = prismaDoble({ fallos: 99, error: errorDeDeadlock });
    const store = createAgendaStore(prisma);

    await expect(
      store.reschedule(TENANT, CITA, INICIO, FIN, asignaciones()),
    ).rejects.toBeInstanceOf(ExclusionError);
    expect(estado.intentos).toBe(2);
  });

  it("el 23P01 sigue siendo TAKEN a la primera", async () => {
    const { prisma, estado } = prismaDoble({ fallos: 99, error: errorDeExclusion });
    const store = createAgendaStore(prisma);

    await expect(
      store.reschedule(TENANT, CITA, INICIO, FIN, asignaciones()),
    ).rejects.toBeInstanceOf(ExclusionError);
    expect(estado.intentos).toBe(1);
  });
});

// ── 4. El testigo (addendum) ────────────────────────────────────────────
//
// POR QUÉ EXISTE. El e2e tiene que saber si una pasada ha ejercido DE
// VERDAD la rama del 40P01. Preguntárselo a `pg_stat_database.deadlocks`
// **puso el CI en rojo**: ese contador se vuelca con retraso (hasta 11 s
// medidos) y una pasada rápida lo lee a cero aunque haya habido deadlocks.
// Éste lo sabe en el instante.
//
// Los contadores son del proceso y sólo suben, así que aquí se miran
// SIEMPRE por diferencia, nunca por valor absoluto.

describe("readRaceStats · el testigo cuenta lo que pasa, no lo que Postgres publica", () => {
  const delta = (antes: ReturnType<typeof readRaceStats>) => {
    const ahora = readRaceStats();
    return {
      aborts: ahora.aborts - antes.aborts,
      retries: ahora.retries - antes.retries,
      exhausted: ahora.exhausted - antes.exhausted,
    };
  };

  it("un deadlock que cede: un aborto, un reintento, y nada agotado", async () => {
    const antes = readRaceStats();
    const { prisma } = prismaDoble({ fallos: 1, error: errorDeDeadlock });
    await createAgendaStore(prisma).insertHold(alta());
    expect(delta(antes)).toEqual({ aborts: 1, retries: 1, exhausted: 0 });
  });

  it("un deadlock que no cede: dos abortos, un reintento y UNO agotado", async () => {
    const antes = readRaceStats();
    const { prisma } = prismaDoble({ fallos: 99, error: errorDeDeadlock });
    await expect(
      createAgendaStore(prisma).insertHold(alta()),
    ).rejects.toBeInstanceOf(ExclusionError);
    expect(delta(antes)).toEqual({ aborts: 2, retries: 1, exhausted: 1 });
  });

  it("el 23P01 NO toca el testigo: no es un aborto de carrera", async () => {
    // Si el EXCLUDE contara como deadlock, el e2e daría por ejercida la
    // rama del 40P01 sin haberla pisado — que es justo lo que no puede
    // volver a pasar.
    const antes = readRaceStats();
    const { prisma } = prismaDoble({ fallos: 99, error: errorDeExclusion });
    await expect(
      createAgendaStore(prisma).insertHold(alta()),
    ).rejects.toBeInstanceOf(ExclusionError);
    expect(delta(antes)).toEqual({ aborts: 0, retries: 0, exhausted: 0 });
  });

  it("un error de otra familia tampoco lo toca", async () => {
    const antes = readRaceStats();
    const { prisma } = prismaDoble({ fallos: 99, error: errorDeClaveAjena });
    await expect(
      createAgendaStore(prisma).insertHold(alta()),
    ).rejects.toMatchObject({ code: "P2003" });
    expect(delta(antes)).toEqual({ aborts: 0, retries: 0, exhausted: 0 });
  });

  it("mover cuenta en el mismo testigo que el alta", async () => {
    const antes = readRaceStats();
    const { prisma } = prismaDoble({ fallos: 1, error: errorDeDeadlock });
    await createAgendaStore(prisma).reschedule(TENANT, CITA, INICIO, FIN, asignaciones());
    expect(delta(antes)).toEqual({ aborts: 1, retries: 1, exhausted: 0 });
  });

  it("la foto es una COPIA: nadie de fuera puede mover el contador", async () => {
    const foto = readRaceStats() as { aborts: number };
    foto.aborts = 9999;
    expect(readRaceStats().aborts).not.toBe(9999);
  });
});
