// Frente carrera-409 · LA CARRERA DE DOS ALTAS, contra Postgres DE VERDAD.
//
// POR QUÉ ESTE FICHERO EXISTE. El caso 3 de `agenda-suelo.e2e.ts` («dos
// altas SIMULTÁNEAS dejan una sola cita») devolvía **500 en vez de 409** de
// vez en cuando, y tenía el CI de master en rojo. B-7a lo vio una vez, no
// lo pudo reproducir en diez pasadas y lo dejó apuntado (§11 y §4 caso 12
// de `reservas-7a-done.md`). Aquí se cierra.
//
// El fallo es que la carrera tiene DOS finales y sólo uno estaba traducido:
//
//   · **23P01** — una escanea el índice antes de que la otra escriba:
//     espera, la primera comete, a la segunda la echa el `EXCLUDE`. Éste
//     salía bien: `ExclusionError` → TAKEN → 409;
//   · **40P01** — las dos escriben su entrada en el índice GiST antes de
//     que ninguna llegue a escanearlo, cada una se pone a esperar a la
//     otra, y Postgres tumba a una para romper el ciclo. Éste NO se
//     reconocía y salía por el manejador genérico: **500**.
//
// Y este fichero tiene DOS mitades porque hacen falta las dos:
//
//   1. **el deadlock de verdad** (§1) — la misma carrera repetida hasta que
//      Postgres cuente un deadlock, con `pg_stat_database` de testigo. Si
//      no llegara a haber ninguno, el caso se pone ROJO: un test que no
//      ejerce lo que dice cubrir miente más que uno que falta;
//   2. **el deadlock inyectado** (§2 y §3) — porque el final que importa
//      no se puede provocar a voluntad. Cuando hay un deadlock de verdad,
//      la otra transacción casi siempre acaba cometiendo, así que el
//      reintento se encuentra el hueco ocupado y sale 409. **El camino de
//      "el reintento SÍ entra y la cita es buena" sólo se ve inyectando.**
//
// La inyección es un `$transaction` que falla las N primeras veces con el
// error EXACTO que se capturó (`carrera-alta-409-plan.md` §1.3) y luego se
// deja correr. Todo lo demás —motor, rutas, `EXCLUDE`, SQL— es el de
// verdad, contra este Postgres.

import { randomBytes, randomUUID } from "node:crypto";

import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { E2E_DATABASE_URL, e2eEnabled, SKIP_MESSAGE } from "./e2e-env.js";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL =
  E2E_DATABASE_URL || "postgresql://e2e:e2e@127.0.0.1:5432/e2e";
process.env.REDIS_URL = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";
process.env.JWT_ACCESS_SECRET = "e".repeat(40);
process.env.JWT_REFRESH_SECRET = "f".repeat(40);
process.env.HOLDED_KEY_ENCRYPTION_SECRET = randomBytes(32).toString("base64");

vi.mock("../src/queues/ticket-upload.js", () => ({
  enqueueTicketUpload: async () => {},
}));
vi.mock("../src/queues/refund-upload.js", () => ({
  enqueueRefundUpload: async () => {},
}));
vi.mock("../src/queues/ticket-email.js", () => ({
  enqueueTicketEmail: async () => {},
}));

const { getPrisma, shutdown } = await import("../src/context.js");
const { registerAgendaRoutes } = await import("../src/agenda/routes.js");
const { registerErrorHandler } = await import("../src/lib/error-handler.js");
const { registerLenientJsonParser } = await import("../src/lib/lenient-json.js");
const { signCashierSession } = await import("../src/shift/cashier-session.js");
const { createAgendaStore } = await import("../src/agenda/store.js");
const { utcToWallDate, wallTimeToUtc } = await import("../src/agenda/time.js");

/** El deadlock, con la forma EXACTA con la que Postgres+Prisma lo entregan:
 *  `P2010` por fuera —«raw query failed», que no dice nada— y el SQLSTATE
 *  sólo en `meta.code`. Copiado de la captura del frente 0. */
function errorDeDeadlock(): Error {
  const err = new Error(
    "\nInvalid `prisma.$executeRawUnsafe()` invocation:\n\n\n" +
      "Raw query failed. Code: `40P01`. Message: `ERROR: deadlock detected\n" +
      "DETAIL: Process 1497 waits for ShareLock on transaction 56735; blocked by process 1494.`",
  );
  err.name = "PrismaClientKnownRequestError";
  Object.assign(err, {
    code: "P2010",
    meta: { code: "40P01", message: "ERROR: deadlock detected" },
  });
  return err;
}

describe.skipIf(!e2eEnabled)(
  "e2e · la carrera de dos altas acaba en 409, nunca en 500",
  () => {
    if (!e2eEnabled) console.warn(`\n${SKIP_MESSAGE}\n`);

    const prisma = getPrisma();
    /** La app de verdad: store real sobre el Prisma real. */
    let app: FastifyInstance;

    let tenantId = "";
    let corteId = "";
    let soleId = "";
    let anaId = "";
    let token = "";

    const auth = () => ({ authorization: `Bearer ${token}` });

    /** Un hueco futuro a hora de pared fija. La carrera no tiene nada que
     *  ver con el suelo: le basta un hueco que exista. La fecha se toma de
     *  la pared del centro, no de `toISOString()` (a las 00:30 de Madrid el
     *  día UTC todavía es el de ayer). */
    function manana(hhmm: string, dias = 1): Date {
      const hoy = utcToWallDate(new Date());
      const d = new Date(`${hoy}T12:00:00.000Z`);
      d.setUTCDate(d.getUTCDate() + dias);
      return wallTimeToUtc(d.toISOString().slice(0, 10), hhmm);
    }

    function altaPayload(start: Date, staffUserId: string) {
      return {
        items: [{ serviceId: corteId, staffUserId }],
        start: start.toISOString(),
        source: "PRESENCIAL" as const,
      };
    }

    /** Cuántas citas hay en este hueco, preguntándoselo a la BD. */
    async function citasEn(hueco: Date): Promise<number> {
      const rows = await prisma.$queryRaw<Array<{ n: bigint }>>`
        SELECT COUNT(*) AS n FROM appointments
         WHERE tenant_id = ${tenantId}::uuid
           AND status <> 'CANCELLED'
           AND lower(timeslot) = ${hueco.toISOString()}::timestamptz
      `;
      return Number(rows[0]!.n);
    }

    /** El contador de deadlocks de ESTA base. Es el testigo de que la
     *  carrera se ha ejercido de verdad y no en el papel. */
    async function deadlocksDeLaBase(): Promise<number> {
      const rows = await prisma.$queryRaw<Array<{ deadlocks: bigint }>>`
        SELECT deadlocks FROM pg_stat_database WHERE datname = current_database()
      `;
      return Number(rows[0]?.deadlocks ?? 0);
    }

    /**
     * Una app idéntica a la de verdad salvo en una cosa: su `$transaction`
     * muere de deadlock las `fallos` primeras veces y luego funciona. Todo
     * lo demás —lecturas del motor, `EXCLUDE`, rutas— es el real.
     */
    async function appConDeadlock(fallos: number): Promise<{
      app: FastifyInstance;
      intentos: () => number;
    }> {
      let restantes = fallos;
      let intentos = 0;
      const prismaFalso = new Proxy(prisma, {
        get(target, prop) {
          if (prop === "$transaction") {
            return async (fn: unknown) => {
              intentos += 1;
              if (restantes > 0) {
                restantes -= 1;
                throw errorDeDeadlock();
              }
              return (
                target.$transaction as (f: unknown) => Promise<unknown>
              ).call(target, fn);
            };
          }
          const v = Reflect.get(target, prop);
          return typeof v === "function" ? v.bind(target) : v;
        },
      });
      const otra = Fastify({ logger: false });
      registerErrorHandler(otra);
      registerLenientJsonParser(otra);
      // El STORE se construye sobre el Prisma saboteado: el reintento que
      // se prueba es el de `store.ts`, no uno de mentira.
      await registerAgendaRoutes(otra, {
        prisma,
        store: createAgendaStore(prismaFalso as typeof prisma),
      });
      await otra.ready();
      return { app: otra, intentos: () => intentos };
    }

    beforeAll(async () => {
      app = Fastify({ logger: false });
      registerErrorHandler(app);
      registerLenientJsonParser(app);
      await registerAgendaRoutes(app);
      await app.ready();

      const tenant = await prisma.tenant.create({
        data: { name: "Bar de dos camareros e2e", agendaEnabled: true },
        select: { id: true },
      });
      tenantId = tenant.id;

      const local = await prisma.store.create({
        data: { tenantId, name: "Local e2e" },
        select: { id: true },
      });
      const register = await prisma.register.create({
        data: { storeId: local.id, name: "Caja 1" },
        select: { id: true },
      });
      const cashier = await prisma.user.create({
        data: {
          tenantId,
          email: `caja+${randomUUID()}@e2e.local`,
          alias: "Caja",
          role: "CASHIER",
        },
        select: { id: true },
      });
      await prisma.shift.create({
        data: { registerId: register.id, userId: cashier.id, cashOpening: "50" },
      });

      const corte = await prisma.product.create({
        data: {
          tenantId,
          holdedProductId: `h-corte-${randomUUID()}`,
          name: "Corte de pelo",
          sku: "SVC-CORTE",
          basePrice: "14.8760",
          taxRate: "21",
          kind: "SERVICE",
        },
        select: { id: true },
      });
      corteId = corte.id;
      await prisma.serviceScheduling.create({
        data: { productId: corteId, tenantId, durationMin: 30 },
      });

      // Turno DIARIO de 00:00 a 24:00: este fichero no prueba el horario,
      // así que el hueco tiene que existir se corra la suite a la hora que
      // se corra (misma razón que la nota de `agenda-suelo.e2e.ts`).
      const haceTresDias = new Date(Date.now() - 3 * 24 * 3600_000);
      for (const [alias, ref] of [
        ["Sole", "sole"],
        ["Ana", "ana"],
      ] as const) {
        const u = await prisma.user.create({
          data: {
            tenantId,
            email: `${ref}+${randomUUID()}@e2e.local`,
            alias,
            role: "CASHIER",
          },
          select: { id: true },
        });
        if (ref === "sole") soleId = u.id;
        else anaId = u.id;
        await prisma.staffProfile.create({
          data: { userId: u.id, tenantId, displayName: alias, active: true },
        });
        await prisma.staffSkill.create({
          data: { userId: u.id, tenantId, serviceId: corteId },
        });
        await prisma.staffShift.create({
          data: {
            userId: u.id,
            tenantId,
            rrule: "FREQ=DAILY",
            startTime: "00:00",
            endTime: "24:00",
            validFrom: haceTresDias,
          },
        });
      }

      token = signCashierSession(
        {
          sub: cashier.id,
          tid: tenantId,
          did: randomUUID(),
          rid: register.id,
          role: "CASHIER",
        },
        720,
      );
    });

    afterAll(async () => {
      await app?.close();
      await shutdown();
    });

    // ── 1. El deadlock DE VERDAD ──────────────────────────────────────

    it("1 · con deadlocks reales de por medio, la carrera sigue saliendo 201/409", async () => {
      // La misma carrera del caso 3 de `agenda-suelo.e2e.ts` —dos altas
      // simultáneas, mismo hueco, misma profesional— repetida sobre un
      // hueco distinto cada ronda hasta que Postgres cuente un deadlock.
      //
      // Con el código de antes de este frente, esto sale ROJO: en la sonda
      // del frente 0, 44 de 120 perdedoras (37 %) devolvían 500.
      //
      // El bucle para en cuanto hay un deadlock contado (normalmente en las
      // primeras rondas); el tope de 40 es la red por si la máquina del CI
      // entrelaza distinto. Si se agota sin un solo deadlock, el caso se
      // pone rojo a propósito: no habría probado lo que dice probar.
      const TOPE_RONDAS = 40;
      const deadlocksAntes = await deadlocksDeLaBase();
      let rondas = 0;
      let deadlocksAhora = deadlocksAntes;
      const codigosVistos: number[] = [];

      while (rondas < TOPE_RONDAS) {
        const hueco = manana(
          `${String(6 + (rondas % 16)).padStart(2, "0")}:00`,
          2 + Math.floor(rondas / 16),
        );
        const [a, b] = await Promise.all([
          app.inject({
            method: "POST",
            url: "/agenda/appointments",
            headers: auth(),
            payload: altaPayload(hueco, soleId),
          }),
          app.inject({
            method: "POST",
            url: "/agenda/appointments",
            headers: auth(),
            payload: altaPayload(hueco, soleId),
          }),
        ]);
        rondas += 1;
        const codigos = [a.statusCode, b.statusCode].sort();
        codigosVistos.push(...codigos);

        // LO QUE NO PUEDE PASAR, ronda a ronda: ni un 500, ni dos citas.
        expect(
          codigos,
          `ronda ${rondas}: ${a.statusCode} ${a.body.slice(0, 200)} / ${b.statusCode} ${b.body.slice(0, 200)}`,
        ).toEqual([201, 409]);
        expect(await citasEn(hueco)).toBe(1);

        deadlocksAhora = await deadlocksDeLaBase();
        if (deadlocksAhora > deadlocksAntes && rondas >= 3) break;
      }

      expect(codigosVistos).not.toContain(500);
      // El testigo: Postgres contó al menos un deadlock. Sin esto el caso
      // podría pasar sin haber ejercido nunca el camino del 40P01.
      expect(
        deadlocksAhora - deadlocksAntes,
        `${rondas} rondas sin un solo deadlock: esta pasada NO ha ejercido el 40P01`,
      ).toBeGreaterThan(0);
    }, 240_000);

    // ── 2. El deadlock inyectado · el alta ────────────────────────────

    it("2 · el reintento que SÍ entra: 201 y UNA cita, no dos", async () => {
      // Lo que un deadlock de verdad no deja ver: Postgres tumbó a esta
      // transacción para desatascar, pero el hueco seguía libre. Reintentar
      // la transacción entera la mete, y la cita es buena.
      const { app: conFallo, intentos } = await appConDeadlock(1);
      const hueco = manana("09:00", 20);
      try {
        const res = await conFallo.inject({
          method: "POST",
          url: "/agenda/appointments",
          headers: auth(),
          payload: altaPayload(hueco, soleId),
        });
        expect(res.statusCode, res.body).toBe(201);
        // Dos intentos: el que murió de deadlock y el que entró…
        expect(intentos()).toBe(2);
        // …y UNA sola cita. El intento abortado no dejó fila.
        expect(await citasEn(hueco)).toBe(1);
        const id = (res.json() as { appointment: { id: string } }).appointment.id;
        expect(id).toBeTruthy();
      } finally {
        await conFallo.close();
      }
    });

    it("3 · el deadlock que no cede: 409 TAKEN con alternativas, NUNCA 500", async () => {
      // El tope. Dos intentos y se acabó: la clienta se lleva tres horas
      // que sí se pueden dar, no un «error inesperado» sin salida.
      const { app: conFallo, intentos } = await appConDeadlock(99);
      const hueco = manana("09:30", 20);
      try {
        const res = await conFallo.inject({
          method: "POST",
          url: "/agenda/appointments",
          headers: auth(),
          payload: altaPayload(hueco, soleId),
        });
        expect(res.statusCode, res.body).toBe(409);
        const body = res.json() as {
          error: string;
          code: string;
          message: string;
          alternatives: Array<{ start: string }>;
        };
        expect(body.error).toBe("TAKEN");
        expect(body.code).toBe("TAKEN");
        expect(body.message).toBeTruthy();
        // Con alternativas: un 409 sin horas que ofrecer no sirve de nada
        // en un mostrador.
        expect(body.alternatives.length).toBeGreaterThan(0);
        // UN solo reintento. Ni bucle ni insistencia.
        expect(intentos()).toBe(2);
        // Y ninguna cita a medias: el rollback no dejó nada.
        expect(await citasEn(hueco)).toBe(0);
      } finally {
        await conFallo.close();
      }
    });

    // ── 3. El deadlock inyectado · MOVER ──────────────────────────────

    it("4 · mover con deadlock que cede: 200, y la cita queda en su hora nueva", async () => {
      // `reschedule` tiene la misma forma y el mismo EXCLUDE debajo: la
      // misma carrera, el mismo trato.
      const origen = manana("10:00", 21);
      const destino = manana("10:30", 21);
      const alta = await app.inject({
        method: "POST",
        url: "/agenda/appointments",
        headers: auth(),
        payload: altaPayload(origen, anaId),
      });
      expect(alta.statusCode, alta.body).toBe(201);
      const id = (alta.json() as { appointment: { id: string } }).appointment.id;

      const { app: conFallo, intentos } = await appConDeadlock(1);
      try {
        const res = await conFallo.inject({
          method: "PATCH",
          url: `/agenda/appointments/${id}`,
          headers: auth(),
          payload: { start: destino.toISOString() },
        });
        expect(res.statusCode, res.body).toBe(200);
        expect(intentos()).toBe(2);
        // Contra la BD: en el destino hay una, en el origen ya no hay nada.
        expect(await citasEn(destino)).toBe(1);
        expect(await citasEn(origen)).toBe(0);
      } finally {
        await conFallo.close();
      }
    });

    it("5 · mover con deadlock que no cede: 409 TAKEN, y la cita NO se mueve", async () => {
      const origen = manana("11:00", 21);
      const destino = manana("11:30", 21);
      const alta = await app.inject({
        method: "POST",
        url: "/agenda/appointments",
        headers: auth(),
        payload: altaPayload(origen, anaId),
      });
      expect(alta.statusCode, alta.body).toBe(201);
      const id = (alta.json() as { appointment: { id: string } }).appointment.id;

      const { app: conFallo, intentos } = await appConDeadlock(99);
      try {
        const res = await conFallo.inject({
          method: "PATCH",
          url: `/agenda/appointments/${id}`,
          headers: auth(),
          payload: { start: destino.toISOString() },
        });
        expect(res.statusCode, res.body).toBe(409);
        const body = res.json() as { error: string; code: string };
        expect(body.error).toBe("TAKEN");
        expect(body.code).toBe("TAKEN");
        expect(intentos()).toBe(2);
        // El rollback devolvió la cita a su sitio: sigue entera en origen.
        expect(await citasEn(origen)).toBe(1);
        expect(await citasEn(destino)).toBe(0);
      } finally {
        await conFallo.close();
      }
    });
  },
);
