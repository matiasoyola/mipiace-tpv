// B-reservas-6a · el suelo y el EXCLUDE contra Postgres DE VERDAD.
//
// POR QUÉ ESTE FICHERO EXISTE. Dos motivos, y los dos son la misma frase:
// hay cosas de la agenda que no las decide el código.
//
//   1. **El `EXCLUDE USING gist` nunca se ha ejecutado.** Está creado en
//      producción (`migration.sql:134-142`) y **nadie lo ha visto rechazar
//      una fila**: los tests del motor corren contra un store en memoria que
//      lo SIMULA (Parte 4 del cruce, decisión nº 1 de `B-reservas-4-done.md`)
//      y ningún tenant tiene la agenda encendida. Antes de dejar la agenda
//      sola con una clienta, Postgres tiene que decir que no delante de
//      testigos.
//   2. **El suelo tiene que valer por la puerta de la API**, con el reloj de
//      verdad y el motor que construye `routes.ts` —no uno inyectado en un
//      test—, porque la fuga de D-4b era exactamente ésa: "basta con adivinar
//      la hora y llamar al endpoint".
//
// Y la otra mitad del bloque, que es la que protege a Sole de nosotros:
// **lo que el suelo NO puede tocar**. Cobrar una cita que ya pasó es lo
// normal en un mostrador (cita de las 10:00 cobrada a las 11:00). Si el
// suelo se comiera el cobro, habríamos cambiado un fallo por otro peor.
//
// EL RELOJ Y LA REGLA DE ESTE FICHERO (B-reservas-7a, frente R).
//
// El reloj es el del sistema —el suelo tiene que ser el de verdad o no
// prueba nada—, pero eso NO puede significar que la suite dependa de la
// hora a la que corra el CI. Antes sí dependía.
//
// LA CAUSA. Varios casos reservaban a `suelo + N minutos` contra un turno
// que acababa a las 23:59. Una visita NO puede cruzar la medianoche (la
// plantilla es por día: `templateCovers` mira un solo `TemplateSlot`), así
// que cuando `suelo + N` caía en la última media hora de un día, el motor
// respondía NO_SLOT donde el caso esperaba 201. Cada offset tenía su
// ventana de 30 minutos al día, y entre todas sumaban ~2 h de las 24:
//
//   · caso 14 (`+600`) rojo con el suelo en 13:30–13:45  ← el que nos mordió
//   · caso  8 (`+420`) rojo en 16:30–16:45
//   · caso  3 (`+240`) rojo en 19:30–19:45
//   · casos 1 y 2 (`+180`) rojos en 20:30–20:45
//   · caso 11 (`−30`) rojo en 00:00–00:15 (por el otro borde del día)
//   · caso  7 pedía el día con `toISOString()`, que a las 00:00–01:59 de
//     Madrid todavía devuelve AYER: cero huecos y rojo
//
// Verificado, no supuesto: la versión anterior a este frente se pone roja
// en 13:30, 16:30, 19:30 y 00:05, y esta pasa en diez horas distintas
// (06:00, 09:30, 11:45, 13:30, 16:30, 19:30, 20:30, 23:45, 00:05, 02:15).
//
// La regla, a partir de ahora:
//
//   · lo que prueba EL SUELO va contra el suelo real (`desdeSuelo`), y sólo
//     hacia ATRÁS o dentro de la franja en curso — que es donde el suelo
//     tiene algo que decir y donde siempre hay sitio;
//   · lo que sólo necesita UN HUECO FUTURO CUALQUIERA va a `manana(HH:MM)`,
//     una fecha controlada: siempre por delante del suelo, se corra la
//     suite a la hora que se corra, y siempre con el día entero por
//     delante.
//
// Y el turno sembrado acaba a las **24:00**, no a las 23:59: con 23:59 una
// visita de 30 minutos que empiece a las 23:30 no cabía por un minuto, y
// eso rompía el caso 11 a las 00:00 en punto.

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
const { registerTicketRoutes } = await import("../src/tickets/routes.js");
const { registerAgendaRoutes } = await import("../src/agenda/routes.js");
const { registerErrorHandler } = await import("../src/lib/error-handler.js");
const { registerLenientJsonParser } = await import("../src/lib/lenient-json.js");
const { signCashierSession } = await import("../src/shift/cashier-session.js");
const { createAgendaStore, ExclusionError } = await import(
  "../src/agenda/store.js"
);
const { currentGridStart } = await import("../src/agenda/floor.js");
const { utcToWallDate, utcToWallTime, wallTimeToUtc } = await import(
  "../src/agenda/time.js"
);

describe.skipIf(!e2eEnabled)("e2e · el suelo y el EXCLUDE contra Postgres real", () => {
  if (!e2eEnabled) console.warn(`\n${SKIP_MESSAGE}\n`);

  const prisma = getPrisma();
  const store = createAgendaStore(prisma);
  let app: FastifyInstance;

  let tenantId = "";
  let registerId = "";
  let cashierId = "";
  let soleId = "";
  let anaId = "";
  let corteId = "";
  let rapidoId = "";
  let token = "";

  const auth = () => ({ authorization: `Bearer ${token}` });

  /** EL SUELO, calculado una vez por caso con el reloj real: es el mismo
   *  punto que usa el motor que corre dentro de la API. */
  const suelo = (): Date => currentGridStart(new Date());
  /** Un instante relativo al suelo, en minutos. Para lo que prueba el
   *  SUELO: hacia atrás, o dentro de la franja en curso. */
  const desdeSuelo = (min: number): Date =>
    new Date(suelo().getTime() + min * 60_000);

  /**
   * Un hueco de MAÑANA a una hora de pared fija.
   *
   * Para los casos que sólo necesitan "un hueco futuro cualquiera" y no
   * tienen nada que ver con el suelo: el EXCLUDE, la carrera de dos altas,
   * la retícula, mover hacia adelante. Mañana a las 10:00 está SIEMPRE por
   * delante del suelo y SIEMPRE con el día entero por delante, se corra la
   * suite a las 9 de la mañana o a las 11 de la noche.
   *
   * La fecha se toma de la pared del CENTRO, no de `toISOString()`: a las
   * 00:30 de Madrid el día UTC todavía es el de ayer.
   */
  function manana(hhmm: string): Date {
    const hoy = utcToWallDate(new Date());
    const d = new Date(`${hoy}T12:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    return wallTimeToUtc(d.toISOString().slice(0, 10), hhmm);
  }

  // ── aserciones contra la BD, por SQL ────────────────────────────────

  async function citasDelTenant(): Promise<
    Array<{ id: string; status: string; starts: Date }>
  > {
    return prisma.$queryRaw`
      SELECT id::text AS id, status::text AS status,
             lower(timeslot) AS starts
        FROM appointments WHERE tenant_id = ${tenantId}::uuid
       ORDER BY lower(timeslot)
    `;
  }

  async function assignmentsDe(staffUserId: string): Promise<number> {
    const rows = await prisma.$queryRaw<Array<{ n: bigint }>>`
      SELECT COUNT(*) AS n FROM appointment_assignments
       WHERE tenant_id = ${tenantId}::uuid
         AND staff_user_id = ${staffUserId}::uuid
         AND active
    `;
    return Number(rows[0]!.n);
  }

  async function ticketRow(
    id: string,
  ): Promise<{ status: string; paid_at: Date | null; sealed_at: Date | null }> {
    const rows = await prisma.$queryRaw<
      Array<{ status: string; paid_at: Date | null; sealed_at: Date | null }>
    >`
      SELECT status::text AS status, paid_at, sealed_at
        FROM tickets WHERE id = ${id}::uuid
    `;
    expect(rows).toHaveLength(1);
    return rows[0]!;
  }

  /** Siembra una cita SALTÁNDOSE el motor: es la única forma de tener una
   *  cita en el pasado ahora que el suelo existe — y es exactamente lo que
   *  hay en la agenda de un centro a media mañana. */
  async function sembrarCita(start: Date, staffUserId: string): Promise<string> {
    const view = await store.insertHold({
      tenantId,
      externalId: randomUUID(),
      clientId: null,
      source: "PRESENCIAL",
      status: "CONFIRMED",
      pendingUntil: null,
      notes: null,
      timeslotStart: start,
      timeslotEnd: new Date(start.getTime() + 30 * 60_000),
      items: [
        {
          serviceId: corteId,
          durationMin: 30,
          bufferBeforeMin: 0,
          bufferAfterMin: 0,
          staffRequired: 1,
          sortOrder: 0,
          startOffsetMin: 0,
        },
      ],
      assignments: [
        {
          appointmentItemIndex: 0,
          reservableType: "STAFF",
          staffUserId,
          resourceId: null,
          startsAt: start,
          endsAt: new Date(start.getTime() + 30 * 60_000),
        },
      ],
    });
    return view.id;
  }

  function altaPayload(
    start: Date,
    staffUserId?: string,
    occurredAt?: Date,
    serviceId?: string,
  ) {
    return {
      items: [
        {
          serviceId: serviceId ?? corteId,
          ...(staffUserId ? { staffUserId } : {}),
        },
      ],
      start: start.toISOString(),
      ...(occurredAt ? { occurredAt: occurredAt.toISOString() } : {}),
      source: "PRESENCIAL" as const,
    };
  }

  beforeAll(async () => {
    app = Fastify({ logger: false });
    registerErrorHandler(app);
    registerLenientJsonParser(app);
    await registerTicketRoutes(app);
    await registerAgendaRoutes(app);
    await app.ready();

    const tenant = await prisma.tenant.create({
      data: { name: "Peluquería Sole e2e", agendaEnabled: true },
      select: { id: true },
    });
    tenantId = tenant.id;

    const store_ = await prisma.store.create({
      data: { tenantId, name: "Local e2e" },
      select: { id: true },
    });
    const register = await prisma.register.create({
      data: { storeId: store_.id, name: "Caja 1" },
      select: { id: true },
    });
    registerId = register.id;

    const cashier = await prisma.user.create({
      data: {
        tenantId,
        email: `caja+${randomUUID()}@e2e.local`,
        alias: "Caja",
        role: "CASHIER",
      },
      select: { id: true },
    });
    cashierId = cashier.id;
    await prisma.shift.create({
      data: { registerId, userId: cashierId, cashOpening: "50" },
    });

    // El servicio. `serviceId` = `product.id`.
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

    // Un servicio CORTO, de 15 minutos, para el caso 6 y sólo para él.
    //
    // El caso 6 reserva la FRANJA EN CURSO, así que su hora es la del
    // reloj y no se puede mover a una fecha controlada sin dejar de probar
    // lo que prueba. Con un servicio de 30 minutos y el centro cerrando a
    // medianoche, una franja en curso de las 23:45 no cabe — y el caso se
    // caería 15 minutos al día. Con 15 minutos cabe SIEMPRE: 23:45 + 15 =
    // 24:00 justo, que es donde acaba el turno.
    const rapido = await prisma.product.create({
      data: {
        tenantId,
        holdedProductId: `h-rapido-${randomUUID()}`,
        name: "Flequillo",
        sku: "SVC-FLEQUILLO",
        basePrice: "8.2645",
        taxRate: "21",
        kind: "SERVICE",
      },
      select: { id: true },
    });
    rapidoId = rapido.id;
    await prisma.serviceScheduling.create({
      data: { productId: rapidoId, tenantId, durationMin: 15 },
    });

    // Las dos profesionales. Turno DIARIO de 00:00 a **24:00** desde hace
    // tres días. El 24:00 no es cosmético: con 23:59 una visita de 30
    // minutos que empiece a las 23:30 se salía del turno por UN MINUTO, y
    // el caso 11 (`suelo − 30`) se caía a las 00:00 en punto.
    const ayerAyer = new Date(Date.now() - 3 * 24 * 3600_000);
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
      await prisma.staffSkill.create({
        data: { userId: u.id, tenantId, serviceId: rapidoId },
      });
      await prisma.staffShift.create({
        data: {
          userId: u.id,
          tenantId,
          rrule: "FREQ=DAILY",
          startTime: "00:00",
          endTime: "24:00",
          validFrom: ayerAyer,
        },
      });
    }

    token = signCashierSession(
      {
        sub: cashierId,
        tid: tenantId,
        did: randomUUID(),
        rid: registerId,
        role: "CASHIER",
      },
      720,
    );
  });

  afterAll(async () => {
    await app?.close();
    await shutdown();
  });

  // ── 1. El EXCLUDE, ejecutándose ─────────────────────────────────────

  it("1 · POSTGRES rechaza la segunda cita de la misma profesional en el mismo hueco", async () => {
    // El EXCLUDE no tiene nada que ver con el suelo: le basta un hueco
    // futuro cualquiera. A fecha controlada (antes: `suelo + 180`, que se
    // salía del día a partir de las 20:30).
    const hueco = manana("10:00");
    const primera = await sembrarCita(hueco, soleId);
    expect(primera).toBeTruthy();

    // La segunda NO la para el código: la para el `EXCLUDE USING gist` de
    // `appointment_assignments`. `store.ts` traduce el 23P01 a
    // ExclusionError. Es la primera vez que alguien lo ve morder a
    // propósito (en B-5 mordió por sorpresa, al sembrar).
    await expect(sembrarCita(hueco, soleId)).rejects.toBeInstanceOf(
      ExclusionError,
    );

    // Y en la BD hay UNA sola asignación activa para Sole en ese hueco.
    const rows = await prisma.$queryRaw<Array<{ n: bigint }>>`
      SELECT COUNT(*) AS n FROM appointment_assignments
       WHERE tenant_id = ${tenantId}::uuid
         AND staff_user_id = ${soleId}::uuid
         AND active
         AND slot && tstzrange(${hueco.toISOString()}::timestamptz,
                               ${new Date(hueco.getTime() + 30 * 60_000).toISOString()}::timestamptz, '[)')
    `;
    expect(Number(rows[0]!.n)).toBe(1);
  });

  it("2 · el mismo hueco con OTRA profesional sí entra (el EXCLUDE es por persona)", async () => {
    const hueco = manana("10:00"); // el MISMO que el caso 1, otra persona
    const id = await sembrarCita(hueco, anaId);
    expect(id).toBeTruthy();
    expect(await assignmentsDe(anaId)).toBeGreaterThan(0);
  });

  it("3 · dos altas SIMULTÁNEAS por la API dejan una sola cita en la BD", async () => {
    const hueco = manana("11:00");
    const antes = (await citasDelTenant()).length;
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
    const codigos = [a.statusCode, b.statusCode].sort();
    // Una entra; la otra la rechaza el motor (leyó la ocupación) o la BD
    // (ganó la carrera). Las dos salidas son 409 y las dos son correctas:
    // lo que NO puede pasar es que entren las dos.
    expect(codigos[0]).toBe(201);
    expect(codigos[1]).toBe(409);
    expect((await citasDelTenant()).length).toBe(antes + 1);
  });

  // ── 2. El suelo por la puerta de la API ─────────────────────────────

  it("4 · una hora que ya pasó es 409 BOOKING_IN_PAST, con frase y alternativas", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/agenda/appointments",
      headers: auth(),
      payload: altaPayload(desdeSuelo(-15)),
    });
    expect(res.statusCode).toBe(409);
    const body = res.json() as {
      error: string;
      code: string;
      message: string;
      alternatives: Array<{ start: string }>;
    };
    expect(body.error).toBe("BOOKING_IN_PAST");
    expect(body.code).toBe("BOOKING_IN_PAST");
    // Se lee en voz alta a una clienta, y dice una hora.
    expect(body.message).toContain("ya ha pasado");
    expect(body.message).toMatch(/\d{2}:\d{2}/);
    // Tres huecos que el motor SÍ ofrecería, todos del suelo en adelante.
    expect(body.alternatives).toHaveLength(3);
    for (const alt of body.alternatives) {
      expect(new Date(alt.start).getTime()).toBeGreaterThanOrEqual(
        suelo().getTime(),
      );
    }
    // Y la primera alternativa aparece en la frase.
    expect(body.message).toContain(utcToWallTime(new Date(body.alternatives[0]!.start)));
  });

  it("5 · las 10:07 siguen sin existir: 409 BOOKING_OFF_GRID (la fuga de D-4b)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/agenda/appointments",
      headers: auth(),
      // Una hora futura que NO cae en la retícula. A fecha controlada: lo
      // que se prueba es la retícula, no el suelo.
      payload: altaPayload(manana("12:07")),
    });
    expect(res.statusCode).toBe(409);
    const body = res.json() as { error: string; message: string };
    expect(body.error).toBe("BOOKING_OFF_GRID");
    expect(body.message).toContain("cuarto de hora");
  });

  it("6 · LA FRANJA EN CURSO SE RESERVA: '¿tienes hueco ahora?' entra", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/agenda/appointments",
      headers: auth(),
      // ÉSTE sí va contra el suelo real: es lo que prueba. Con el servicio
      // CORTO (15 min), para que la franja en curso quepa también a las
      // 23:45, que es la última del día.
      payload: altaPayload(suelo(), anaId, undefined, rapidoId),
    });
    expect(res.statusCode).toBe(201);
    const id = (res.json() as { appointment: { id: string } }).appointment.id;
    const citas = await citasDelTenant();
    const creada = citas.find((c) => c.id === id);
    expect(creada).toBeTruthy();
    expect(new Date(creada!.starts).getTime()).toBe(suelo().getTime());
  });

  it("7 · availability() no ofrece nada anterior al suelo", async () => {
    // Dos arreglos del frente R de B-7a, los dos de la misma familia:
    //
    //   · la fecha es la de PARED del centro, no `toISOString()`: a las
    //     00:30 de Madrid el día UTC todavía es el de ayer, y el caso
    //     pedía la disponibilidad de un día entero ya pasado — cero
    //     huecos y rojo;
    //   · y el rango va de HOY a MAÑANA, no de hoy a hoy. A las 23:45 un
    //     servicio de 30 minutos ya no cabe en el día: cero huecos, y el
    //     caso se caía por una respuesta CORRECTA. Con mañana dentro
    //     siempre hay algo que ofrecer, y la aserción —ni un hueco
    //     anterior al suelo— se vuelve más fuerte, porque barre dos días.
    //
    // De paso cierra la deuda de 6a §4.9: `availability()` multi-día por
    // la API sólo se probaba con `from = to = hoy`.
    const hoy = utcToWallDate(new Date());
    const manana_ = utcToWallDate(new Date(Date.now() + 24 * 3600_000));
    const res = await app.inject({
      method: "POST",
      url: "/agenda/availability",
      headers: auth(),
      payload: { items: [{ serviceId: corteId }], from: hoy, to: manana_ },
    });
    expect(res.statusCode).toBe(200);
    const { slots } = res.json() as { slots: Array<{ start: string }> };
    expect(slots.length).toBeGreaterThan(0);
    for (const s of slots) {
      expect(new Date(s.start).getTime()).toBeGreaterThanOrEqual(
        suelo().getTime(),
      );
    }
  });

  it("8 · mover una cita hacia atrás es 409; hacia adelante, 200", async () => {
    const id = await sembrarCita(desdeSuelo(-60), soleId);

    const atras = await app.inject({
      method: "PATCH",
      url: `/agenda/appointments/${id}`,
      headers: auth(),
      payload: { start: desdeSuelo(-30).toISOString() },
    });
    expect(atras.statusCode).toBe(409);
    // DESTAPADO POR EL SABOTAJE: quitar `code` de la respuesta de MOVER no
    // ponía nada rojo — sólo el alta lo miraba. El front lee las dos por el
    // mismo camino, y en B-6b `code` pasará a ser la key de la regla.
    const cuerpo = atras.json() as {
      error: string;
      code: string;
      message: string;
      alternatives: unknown[];
    };
    expect(cuerpo.error).toBe("BOOKING_IN_PAST");
    expect(cuerpo.code).toBe("BOOKING_IN_PAST");
    expect(cuerpo.message).toContain("ya ha pasado");
    expect(Array.isArray(cuerpo.alternatives)).toBe(true);

    const adelante = await app.inject({
      method: "PATCH",
      url: `/agenda/appointments/${id}`,
      headers: auth(),
      // Hacia adelante, a fecha controlada: lo que se prueba es que MOVER
      // adelante se deja, no a qué distancia.
      payload: { start: manana("13:00").toISOString() },
    });
    expect(adelante.statusCode).toBe(200);
  });

  // ── 3. El alta que se creó sin red (frente O) ───────────────────────

  it("11 · la franja era buena al escribirla: entra aunque llegue tarde", async () => {
    // El AP12 apaga la pantalla a los cinco minutos. La cajera despierta
    // el terminal, escribe "¿tienes hueco ahora?" sin red, y el alta sube
    // 40 minutos después. Sin `occurredAt` el suelo la rechazaría por una
    // hora que era buena cuando la escribió.
    const hueco = desdeSuelo(-30);
    const escrita = new Date(hueco.getTime() + 60_000); // un minuto después
    const res = await app.inject({
      method: "POST",
      url: "/agenda/appointments",
      headers: auth(),
      payload: altaPayload(hueco, soleId, escrita),
    });
    expect(res.statusCode).toBe(201);

    // Contra la BD: la cita está en SU hueco, el de cuando se escribió.
    const id = (res.json() as { appointment: { id: string } }).appointment.id;
    const fila = (await citasDelTenant()).find((c) => c.id === id);
    expect(fila).toBeTruthy();
    expect(new Date(fila!.starts).getTime()).toBe(hueco.getTime());
  });

  it("12 · sin occurredAt, esa misma alta es 409 (lo que pasaba antes)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/agenda/appointments",
      headers: auth(),
      payload: altaPayload(desdeSuelo(-30), anaId),
    });
    expect(res.statusCode).toBe(409);
    expect((res.json() as { error: string }).error).toBe("BOOKING_IN_PAST");
  });

  it("13 · un occurredAt más viejo que la cota no salva nada", async () => {
    // Dos horas y pico: por encima de la cota el campo no se usa, y el
    // alta entra por el camino de siempre — donde su hora ya pasó.
    const res = await app.inject({
      method: "POST",
      url: "/agenda/appointments",
      headers: auth(),
      payload: altaPayload(
        desdeSuelo(-150),
        soleId,
        new Date(suelo().getTime() - 149 * 60_000),
      ),
    });
    expect(res.statusCode).toBe(409);
    const body = res.json() as { error: string; alternatives: Array<{ start: string }> };
    expect(body.error).toBe("BOOKING_IN_PAST");
    // Y las alternativas son del AHORA real, no del instante del alta.
    for (const alt of body.alternatives) {
      expect(new Date(alt.start).getTime()).toBeGreaterThanOrEqual(
        suelo().getTime(),
      );
    }
  });

  it("14 · un occurredAt del FUTURO se ignora y vale 'ahora'", async () => {
    // Vale "ahora" para lo bueno y para lo malo: la franja en curso entra…
    const ok = await app.inject({
      method: "POST",
      url: "/agenda/appointments",
      headers: auth(),
      payload: altaPayload(
        // El hueco sólo tiene que ser válido; lo que se prueba es que el
        // `occurredAt` del futuro se ignore. A fecha controlada: con
        // `suelo + 600` este caso se caía a partir de las 13:29.
        manana("15:00"),
        soleId,
        new Date(Date.now() + 6 * 60 * 60_000),
      ),
    });
    expect(ok.statusCode).toBe(201);

    // …y el pasado sigue sin entrar por mucho que el reloj mienta.
    const no = await app.inject({
      method: "POST",
      url: "/agenda/appointments",
      headers: auth(),
      payload: altaPayload(
        desdeSuelo(-15),
        anaId,
        new Date(Date.now() + 6 * 60 * 60_000),
      ),
    });
    expect(no.statusCode).toBe(409);
    expect((no.json() as { error: string }).error).toBe("BOOKING_IN_PAST");
  });

  it("15 · las alternativas de un alta vieja son del AHORA, no de su puerta", async () => {
    // El alta es válida (dentro de la cota) pero su hueco es anterior
    // incluso a cuando se escribió. Las horas que se le ofrecen a la
    // clienta tienen que ser futuras DE VERDAD.
    const escrita = new Date(suelo().getTime() - 60 * 60_000);
    const res = await app.inject({
      method: "POST",
      url: "/agenda/appointments",
      headers: auth(),
      payload: altaPayload(desdeSuelo(-90), soleId, escrita),
    });
    expect(res.statusCode).toBe(409);
    const body = res.json() as {
      error: string;
      alternatives: Array<{ start: string }>;
    };
    expect(body.error).toBe("BOOKING_IN_PAST");
    expect(body.alternatives.length).toBeGreaterThan(0);
    for (const alt of body.alternatives) {
      expect(new Date(alt.start).getTime()).toBeGreaterThanOrEqual(
        suelo().getTime(),
      );
    }
  });

  it("16 · el EXCLUDE sigue mandando sobre el alta con occurredAt", async () => {
    // Si en el tiempo sin red otra cita ocupó el hueco, el sello no lo
    // devuelve: el árbitro del solape sigue siendo la base de datos.
    const hueco = desdeSuelo(-45);
    const escrita = new Date(hueco.getTime() + 60_000);
    await sembrarCita(hueco, anaId);
    const res = await app.inject({
      method: "POST",
      url: "/agenda/appointments",
      headers: auth(),
      payload: altaPayload(hueco, anaId, escrita),
    });
    expect(res.statusCode).toBe(409);
    // NO es el suelo: el hueco existía, lo que no había era sitio.
    expect((res.json() as { error: string }).error).not.toBe("BOOKING_IN_PAST");
  });

  // ── 4. Lo que el suelo NO puede tocar ───────────────────────────────

  it("9 · una cita de hace una hora SE COBRA (el camino normal del mostrador)", async () => {
    const apptId = await sembrarCita(desdeSuelo(-90), soleId);

    const abrir = await app.inject({
      method: "POST",
      url: `/agenda/appointments/${apptId}/checkout`,
      headers: auth(),
      payload: {},
    });
    expect(abrir.statusCode).toBe(201);
    const draftId = (abrir.json() as { ticket: { id: string } }).ticket.id;
    expect((await ticketRow(draftId)).status).toBe("DRAFT");

    const cobrar = await app.inject({
      method: "POST",
      url: `/tickets/${draftId}/checkout`,
      headers: auth(),
      payload: {
        externalId: randomUUID(),
        payments: [{ method: "CASH", amount: 18 }],
        cashAmount: 20,
      },
    });
    expect(cobrar.statusCode).toBe(200);

    // Contra la BD: cobrado y sellado. El suelo no se mete en el dinero.
    // El estado queda en `PENDING_SYNC` (la subida a Holded va aparte, y
    // aquí la cola está mockeada); lo que dice que la venta está cobrada
    // es `paid_at`, y lo que dice que es intocable es `sealed_at`.
    const t = await ticketRow(draftId);
    expect(t.status).not.toBe("DRAFT");
    expect(t.paid_at).not.toBeNull();
    expect(t.sealed_at).not.toBeNull();
  });

  it("10 · los estados de una cita pasada siguen cambiando", async () => {
    const apptId = await sembrarCita(desdeSuelo(-120), anaId);
    for (const status of ["IN_SERVICE", "COMPLETED"] as const) {
      const res = await app.inject({
        method: "PATCH",
        url: `/agenda/appointments/${apptId}`,
        headers: auth(),
        payload: { status },
      });
      expect(res.statusCode).toBe(200);
      expect(
        (res.json() as { appointment: { status: string } }).appointment.status,
      ).toBe(status);
    }

    const otra = await sembrarCita(desdeSuelo(-150), anaId);
    const noShow = await app.inject({
      method: "PATCH",
      url: `/agenda/appointments/${otra}`,
      headers: auth(),
      payload: { status: "NO_SHOW" },
    });
    expect(noShow.statusCode).toBe(200);
  });
});
