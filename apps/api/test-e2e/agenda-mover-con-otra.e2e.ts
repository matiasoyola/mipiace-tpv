// mover-con-otra · cambiar de peluquera al mover, contra Postgres DE VERDAD.
//
// POR QUÉ FICHERO PROPIO Y NO UN BLOQUE EN `agenda-suelo.e2e.ts`. Ese
// fichero arrastra estado dentro de su `describe` (sus casos se pisan las
// horas: el 18 documenta que 11:00 y 15:00 "ya tienen dueño") y su centro
// sólo tiene dos peluqueras que saben hacer LO MISMO. Aquí hacen falta tres
// manos distintas —una que lo sabe todo, una que no hace el tinte, una
// inactiva— y una peluquera de OTRO centro. Sembrar eso encima del suelo
// sería cambiar los casos 17 y 18, que son justo los que no se pueden
// romper.
//
// Lo que cada caso muerde está escrito en su propio comentario. Lo que NO
// cubre está en el done (§ frontera del recurso compartido).

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

describe.skipIf(!e2eEnabled)("e2e · mover una cita a otra peluquera", () => {
  if (!e2eEnabled) console.warn(`\n${SKIP_MESSAGE}\n`);

  const prisma = getPrisma();
  const store = createAgendaStore(prisma);
  let app: FastifyInstance;

  let tenantId = "";
  let otroTenantId = "";
  let soleId = "";
  let anaId = "";
  let isaId = "";
  let martaId = ""; // la del OTRO centro
  let corteId = "";
  let tinteId = "";
  let token = "";

  const auth = () => ({ authorization: `Bearer ${token}` });

  /** Una hora de pared de MAÑANA: siempre por delante del suelo, se corra
   *  la suite a la hora que se corra (la regla del frente R de B-7a). */
  function manana(hhmm: string): Date {
    const hoy = utcToWallDate(new Date());
    const d = new Date(`${hoy}T12:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    return wallTimeToUtc(d.toISOString().slice(0, 10), hhmm);
  }

  // ── aserciones contra la BD, por SQL ────────────────────────────────

  /** La peluquera que tiene la cita AHORA MISMO en la BD, por sus
   *  asignaciones STAFF activas. Es la columna en la que se pinta.
   *
   *  Una cita de DOS servicios tiene DOS asignaciones STAFF (una por item),
   *  y las dos tienen que ser de la misma persona: media cita con otra
   *  peluquera no es una respuesta. Por eso se agrupa y se exige una sola
   *  dueña en vez de leer la primera fila. */
  async function profesionalDe(citaId: string): Promise<string | null> {
    const rows = await prisma.$queryRaw<Array<{ staff_user_id: string | null }>>`
      SELECT DISTINCT staff_user_id::text AS staff_user_id
        FROM appointment_assignments
       WHERE appointment_id = ${citaId}::uuid
         AND reservable_type = 'STAFF' AND active
    `;
    expect(rows).toHaveLength(1);
    return rows[0]!.staff_user_id;
  }

  async function inicioDe(citaId: string): Promise<string> {
    const rows = await prisma.$queryRaw<Array<{ starts: Date }>>`
      SELECT lower(timeslot) AS starts FROM appointments
       WHERE id = ${citaId}::uuid`;
    expect(rows).toHaveLength(1);
    return rows[0]!.starts.toISOString();
  }

  /** ¿Tiene esta peluquera alguna asignación activa que pise este rato?
   *  Es lo que decide si su hueco está libre para la siguiente clienta. */
  async function ocupadaEn(staffUserId: string, start: Date): Promise<number> {
    const fin = new Date(start.getTime() + 30 * 60_000);
    const rows = await prisma.$queryRaw<Array<{ n: bigint }>>`
      SELECT COUNT(*) AS n FROM appointment_assignments
       WHERE tenant_id = ${tenantId}::uuid
         AND staff_user_id = ${staffUserId}::uuid
         AND active
         AND slot && tstzrange(${start.toISOString()}::timestamptz,
                               ${fin.toISOString()}::timestamptz, '[)')
    `;
    return Number(rows[0]!.n);
  }

  /** Siembra una cita saltándose el motor (como en `agenda-suelo`): así la
   *  hora y la peluquera de partida son exactamente las que el caso pide. */
  async function sembrarCita(
    start: Date,
    staffUserId: string,
    serviceIds: string[] = [corteId],
  ): Promise<string> {
    const items = serviceIds.map((serviceId, i) => ({
      serviceId,
      durationMin: 30,
      bufferBeforeMin: 0,
      bufferAfterMin: 0,
      staffRequired: 1,
      sortOrder: i,
      startOffsetMin: i * 30,
    }));
    const fin = new Date(start.getTime() + items.length * 30 * 60_000);
    const view = await store.insertHold({
      tenantId,
      externalId: randomUUID(),
      clientId: null,
      source: "PRESENCIAL",
      status: "CONFIRMED",
      pendingUntil: null,
      notes: null,
      timeslotStart: start,
      timeslotEnd: fin,
      items,
      assignments: items.map((it, i) => ({
        appointmentItemIndex: i,
        reservableType: "STAFF" as const,
        staffUserId,
        resourceId: null,
        startsAt: new Date(start.getTime() + it.startOffsetMin * 60_000),
        endsAt: new Date(start.getTime() + (it.startOffsetMin + 30) * 60_000),
      })),
    });
    return view.id;
  }

  async function mover(citaId: string, payload: Record<string, unknown>) {
    return app.inject({
      method: "PATCH",
      url: `/agenda/appointments/${citaId}`,
      headers: auth(),
      payload,
    });
  }

  beforeAll(async () => {
    app = Fastify({ logger: false });
    registerErrorHandler(app);
    registerLenientJsonParser(app);
    await registerAgendaRoutes(app);
    await app.ready();

    const tenant = await prisma.tenant.create({
      data: { name: "Peluquería Sole · mover-con-otra", agendaEnabled: true },
      select: { id: true },
    });
    tenantId = tenant.id;

    const store_ = await prisma.store.create({
      data: { tenantId, name: "Local" },
      select: { id: true },
    });
    const register = await prisma.register.create({
      data: { storeId: store_.id, name: "Caja 1" },
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

    // Dos servicios, de 30 minutos los dos: el corte lo hacen todas, el
    // tinte sólo Sole. Esa asimetría ES el caso del 409.
    async function servicio(nombre: string, sku: string): Promise<string> {
      const p = await prisma.product.create({
        data: {
          tenantId,
          holdedProductId: `h-${sku}-${randomUUID()}`,
          name: nombre,
          sku,
          basePrice: "14.8760",
          taxRate: "21",
          kind: "SERVICE",
        },
        select: { id: true },
      });
      await prisma.serviceScheduling.create({
        data: { productId: p.id, tenantId, durationMin: 30 },
      });
      return p.id;
    }
    corteId = await servicio("Corte de pelo", `SVC-CORTE-${randomUUID().slice(0, 8)}`);
    tinteId = await servicio("Tinte", `SVC-TINTE-${randomUUID().slice(0, 8)}`);

    // Turno DIARIO de 00:00 a 24:00 desde hace tres días, como en
    // `agenda-suelo`: el 24:00 no es cosmético (con 23:59 una visita de 30
    // minutos que empiece a las 23:30 se sale del turno por un minuto).
    const ayerAyer = new Date(Date.now() - 3 * 24 * 3600_000);
    async function peluquera(
      alias: string,
      skills: string[],
      active = true,
      tId = tenantId,
    ): Promise<string> {
      const u = await prisma.user.create({
        data: {
          tenantId: tId,
          email: `${alias.toLowerCase()}+${randomUUID()}@e2e.local`,
          alias,
          role: "CASHIER",
        },
        select: { id: true },
      });
      await prisma.staffProfile.create({
        data: { userId: u.id, tenantId: tId, displayName: alias, active },
      });
      for (const serviceId of skills) {
        await prisma.staffSkill.create({
          data: { userId: u.id, tenantId: tId, serviceId },
        });
      }
      await prisma.staffShift.create({
        data: {
          userId: u.id,
          tenantId: tId,
          rrule: "FREQ=DAILY",
          startTime: "00:00",
          endTime: "24:00",
          validFrom: ayerAyer,
        },
      });
      return u.id;
    }

    soleId = await peluquera("Sole", [corteId, tinteId]);
    anaId = await peluquera("Ana", [corteId]);
    // Isa sabe hacer las dos cosas pero tiene el perfil de agenda APAGADO:
    // el motor ya la ignoraba en silencio y nadie lo decía.
    isaId = await peluquera("Isa", [corteId, tinteId], false);

    // El OTRO centro, con su propia Marta. Mismo esquema, otro tenant: lo
    // que se prueba es que su id no vale aquí.
    const otro = await prisma.tenant.create({
      data: { name: "Otra peluquería", agendaEnabled: true },
      select: { id: true },
    });
    otroTenantId = otro.id;
    const suCorte = await prisma.product.create({
      data: {
        tenantId: otroTenantId,
        holdedProductId: `h-otro-${randomUUID()}`,
        name: "Corte de pelo",
        sku: `SVC-OTRO-${randomUUID().slice(0, 8)}`,
        basePrice: "14.8760",
        taxRate: "21",
        kind: "SERVICE",
      },
      select: { id: true },
    });
    await prisma.serviceScheduling.create({
      data: { productId: suCorte.id, tenantId: otroTenantId, durationMin: 30 },
    });
    martaId = await peluquera("Marta", [suCorte.id], true, otroTenantId);

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

  // ── 1. El caso común: la misma hora, con otra ───────────────────────

  it("1 · a la MISMA hora con otra peluquera: mismo id, columna nueva", async () => {
    // «A la misma hora, pero con Isa» es lo que más se dice en el
    // mostrador. agenda-lista §2b dejó advertido que `reschedule` carga la
    // ocupación del día SIN excluir la propia cita, así que había que
    // comprobar que para OTRA peluquera no estorba: la ocupación de las
    // 10:00 está indexada bajo Ana, y a Sole le consta libre.
    const hora = manana("10:00");
    const id = await sembrarCita(hora, anaId);

    const res = await mover(id, {
      start: hora.toISOString(),
      staffUserId: soleId,
    });
    expect(res.statusCode, res.body).toBe(200);

    const { appointment } = res.json() as {
      appointment: {
        id: string;
        start: string;
        assignments: Array<{ reservableType: string; staffUserId: string | null }>;
      };
    };
    // La MISMA cita: su id y su histórico siguen siendo los de la original.
    // Esto es todo el bloque: cancelar y volver a dar la cita perdía esto.
    expect(appointment.id).toBe(id);
    expect(appointment.start).toBe(hora.toISOString());

    // En la respuesta y en la BD, la columna nueva.
    const suyas = appointment.assignments.filter(
      (a) => a.reservableType === "STAFF",
    );
    expect(suyas).toHaveLength(1);
    expect(suyas[0]!.staffUserId).toBe(soleId);
    expect(await profesionalDe(id)).toBe(soleId);

    // Y la anterior queda LIBRE a esa hora: su hueco vuelve al mostrador.
    // Sin esto, «mover» sería «duplicar la ocupación».
    expect(await ocupadaEn(anaId, hora)).toBe(0);
    expect(await ocupadaEn(soleId, hora)).toBe(1);
  });

  it("2 · a otra hora Y con otra peluquera, de una vez", async () => {
    const id = await sembrarCita(manana("11:00"), anaId);
    const destino = manana("12:00");

    const res = await mover(id, {
      start: destino.toISOString(),
      staffUserId: soleId,
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(await inicioDe(id)).toBe(destino.toISOString());
    expect(await profesionalDe(id)).toBe(soleId);
    expect(await ocupadaEn(anaId, manana("11:00"))).toBe(0);
  });

  it("3 · sin `staffUserId`, mover sigue conservando la suya", async () => {
    // El caso 17/18 de `agenda-suelo.e2e.ts` no puede romperse, y esta es
    // su versión en este fichero: con Sole libre en el destino, el motor
    // sin fijar podría elegirla. No la elige, porque la ruta sigue
    // pasando la actual cuando el cuerpo no pide otra.
    const id = await sembrarCita(manana("13:00"), anaId);
    const res = await mover(id, { start: manana("14:00").toISOString() });
    expect(res.statusCode, res.body).toBe(200);
    expect(await profesionalDe(id)).toBe(anaId);
  });

  // ── 2. Los «no», cada uno con su nombre ─────────────────────────────

  it("4 · la que no hace el servicio es 409 STAFF_NO_SKILL, con su nombre", async () => {
    // Ana no tiñe. Medido antes de tocar nada: el MOTOR devuelve aquí
    // `NO_SLOT` con cero alternativas, indistinguible de «está llena todo
    // el día». La ruta lo distingue con la matriz, antes de llamarlo.
    const hora = manana("15:00");
    const id = await sembrarCita(hora, soleId, [tinteId]);

    const res = await mover(id, {
      start: manana("16:00").toISOString(),
      staffUserId: anaId,
    });
    expect(res.statusCode, res.body).toBe(409);
    const cuerpo = res.json() as {
      error: string;
      code: string;
      message: string;
      alternatives: unknown[];
    };
    expect(cuerpo.error).toBe("STAFF_NO_SKILL");
    // `code` va con el mismo valor que `error`, como el resto de los «no»
    // de esta ruta (lo destapó un sabotaje de agenda-lista: el front lee
    // `code`).
    expect(cuerpo.code).toBe("STAFF_NO_SKILL");
    // El mensaje habla de la peluquera y del servicio, NO de huecos.
    expect(cuerpo.message).toBe("Ana no hace Tinte.");
    expect(cuerpo.message).not.toContain("hueco");
    expect(cuerpo.alternatives).toEqual([]);

    // Y la cita no se ha movido ni ha cambiado de manos.
    expect(await inicioDe(id)).toBe(hora.toISOString());
    expect(await profesionalDe(id)).toBe(soleId);
  });

  it("5 · en una cita de DOS servicios, basta que no sepa uno", async () => {
    // Corte + tinte: Ana corta, pero no tiñe. Media cita no es media
    // respuesta — el motor encadena los dos items sobre la fijada.
    const hora = manana("17:00");
    const id = await sembrarCita(hora, soleId, [corteId, tinteId]);

    const res = await mover(id, {
      start: hora.toISOString(),
      staffUserId: anaId,
    });
    expect(res.statusCode, res.body).toBe(409);
    expect((res.json() as { message: string }).message).toBe("Ana no hace Tinte.");
    expect(await profesionalDe(id)).toBe(soleId);
  });

  it("6 · la peluquera de OTRO centro es 404, y no cruza nada", async () => {
    // Antes de este bloque esto no era un agujero —`getSkilledStaff`
    // filtra por `tenant_id`, así que nunca hubo asignación cruzada ni un
    // 500—, pero salía como «no hay hueco». Ahora lo dice.
    const hora = manana("19:00");
    const id = await sembrarCita(hora, soleId);

    const res = await mover(id, {
      start: manana("20:00").toISOString(),
      staffUserId: martaId,
    });
    expect(res.statusCode, res.body).toBe(404);
    const cuerpo = res.json() as { error: string; message: string };
    expect(cuerpo.error).toBe("STAFF_NOT_FOUND");
    expect(cuerpo.message).toBe("Esa profesional no es de este centro.");

    // La cita sigue en su sitio, y Marta no ha ganado ninguna asignación
    // en ninguno de los dos centros.
    expect(await inicioDe(id)).toBe(hora.toISOString());
    expect(await profesionalDe(id)).toBe(soleId);
    const cruzadas = await prisma.$queryRaw<Array<{ n: bigint }>>`
      SELECT COUNT(*) AS n FROM appointment_assignments
       WHERE staff_user_id = ${martaId}::uuid AND active`;
    expect(Number(cruzadas[0]!.n)).toBe(0);
  });

  it("7 · la peluquera con el perfil apagado es 404, con su nombre", async () => {
    const hora = manana("21:00");
    const id = await sembrarCita(hora, soleId);

    const res = await mover(id, {
      start: hora.toISOString(),
      staffUserId: isaId,
    });
    expect(res.statusCode, res.body).toBe(404);
    const cuerpo = res.json() as { error: string; message: string };
    expect(cuerpo.error).toBe("STAFF_NOT_FOUND");
    expect(cuerpo.message).toBe("Isa ya no está activa en la agenda.");
    expect(await profesionalDe(id)).toBe(soleId);
  });

  it("8 · `staffUserId` sin `start` es 400: cambiar de peluquera ES mover", async () => {
    const hora = manana("22:00");
    const id = await sembrarCita(hora, anaId);

    const res = await mover(id, { staffUserId: soleId });
    expect(res.statusCode, res.body).toBe(400);
    expect((res.json() as { error: string }).error).toBe("STAFF_WITHOUT_START");
    // Nada se ha tocado: ni la hora ni la columna.
    expect(await inicioDe(id)).toBe(hora.toISOString());
    expect(await profesionalDe(id)).toBe(anaId);
  });

  it("9 · `staffUserId` con `status` tampoco: no es un cambio de estado", async () => {
    const hora = manana("23:00");
    const id = await sembrarCita(hora, anaId);

    const res = await mover(id, { status: "CANCELLED", staffUserId: soleId });
    expect(res.statusCode, res.body).toBe(400);
    expect((res.json() as { error: string }).error).toBe("STAFF_WITHOUT_START");
    // Y muy a propósito: la cita NO se ha cancelado por el camino.
    const estado = await prisma.$queryRaw<Array<{ status: string }>>`
      SELECT status::text AS status FROM appointments WHERE id = ${id}::uuid`;
    expect(estado[0]!.status).toBe("CONFIRMED");
    expect(await profesionalDe(id)).toBe(anaId);
  });

  it("10 · un uuid que no es de nadie es 404, no un 500", async () => {
    const id = await sembrarCita(manana("08:00"), anaId);
    const res = await mover(id, {
      start: manana("08:30").toISOString(),
      staffUserId: randomUUID(),
    });
    expect(res.statusCode, res.body).toBe(404);
    expect((res.json() as { error: string }).error).toBe("STAFF_NOT_FOUND");
  });

  it("11 · si la elegida está OCUPADA a esa hora, el «no» es de hueco", async () => {
    // La otra mitad del reparto: cuando la peluquera SÍ sabe hacerlo, el
    // «no» lo sigue dando el motor y con SUS alternativas (agenda-lista
    // §2b). La puerta de la matriz no se come este caso.
    const ocupada = manana("09:00");
    await sembrarCita(ocupada, soleId); // Sole, cogida a esa hora
    const id = await sembrarCita(manana("09:30"), anaId);

    const res = await mover(id, {
      start: ocupada.toISOString(),
      staffUserId: soleId,
    });
    expect(res.statusCode, res.body).toBe(409);
    const cuerpo = res.json() as {
      error: string;
      alternatives: Array<{ start: string }>;
    };
    expect(cuerpo.error).toBe("NO_SLOT");
    expect(cuerpo.alternatives.length).toBeGreaterThan(0);
    // Ninguna alternativa es la hora que Sole tiene cogida.
    expect(
      cuerpo.alternatives.some((a) => a.start === ocupada.toISOString()),
    ).toBe(false);
    // Y la cita se queda donde estaba, con Ana.
    expect(await inicioDe(id)).toBe(manana("09:30").toISOString());
    expect(await profesionalDe(id)).toBe(anaId);
  });
});
