// clinica-3 · EL COBRO DE UNA SESIÓN, contra Postgres de verdad.
//
// POR QUÉ ESTE FICHERO EXISTE, y por qué no puede vivir con un Prisma
// falso: lo que este bloque promete es que **cerrar dos veces no crea dos
// cobros** y que **lo que se cobra es lo que se hizo**, y las dos son
// afirmaciones sobre la base de datos. El cobro pasa por el índice único
// de la sesión, por el `appointments.ticket_id` UNIQUE, por los triggers
// de S1 y por el turno de la caja. Con un fake se estaría probando que el
// código se porta bien, que es exactamente lo contrario de lo que hay que
// probar (`s1-sello-de-la-venta-done.md` §3, la misma frase que
// `cita-a-caja.e2e.ts` lleva escrita).
//
// Lo que se prueba, en el camino de la podóloga:
//
//   1. **Lo que se cobra es LO QUE SE HIZO**, no lo que se reservó: la
//      cita se dio para «Quiropodia» y el borrador sale con los tres
//      tratamientos que se marcaron.
//   2. Y con el precio y el IVA DEL CATÁLOGO, no de la historia.
//   3. **Cerrar dos veces = UN SOLO TICKET.** Y pulsar «Cobrar» dos veces
//      tampoco crea un segundo: es el GET-back de B-reservas-5.
//   4. **Un `CLINICIAN` no abre un cobro**: 403, y ni un ticket nuevo.
//   5. **La recepción ve su lista** con la cita, el paciente y las líneas
//      con precio, y NADA de la historia.
//   6. Y una vez cobrado, la cita sale de la lista.
//
// REGLA, heredada de v1.13: cada aserción va contra la BD por SQL, no
// contra la respuesta del API. Si el test puede pasar con la BD vacía, no
// es un e2e.

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
process.env.PUBLIC_TPV_URL = "https://mipiacetpv.com";

// El borde con Redis/Holded. Aquí no se prueba el ERP.
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
const { registerSesionRoutes } = await import(
  "../src/clinica/sesion-routes.js"
);
const { registerErrorHandler } = await import("../src/lib/error-handler.js");
const { registerLenientJsonParser } = await import("../src/lib/lenient-json.js");
const { signCashierSession } = await import("../src/shift/cashier-session.js");
const { createAgendaStore } = await import("../src/agenda/store.js");

/** Las rutas de todo lo que huela a dinero dentro de un objeto: por nombre
 *  de clave y con valor numérico. Ver el caso 1 sobre por qué no se busca
 *  el texto del precio. */
function clavesDeDinero(x: unknown, ruta = "$"): string[] {
  const SOSPECHOSAS = /precio|importe|total|iva|price|amount|eur|coste/i;
  if (Array.isArray(x)) {
    return x.flatMap((v, i) => clavesDeDinero(v, `${ruta}[${i}]`));
  }
  if (x != null && typeof x === "object") {
    return Object.entries(x).flatMap(([k, v]) => {
      const aqui = `${ruta}.${k}`;
      const esDinero = SOSPECHOSAS.test(k) && typeof v === "number";
      return [...(esDinero ? [aqui] : []), ...clavesDeDinero(v, aqui)];
    });
  }
  return [];
}

describe.skipIf(!e2eEnabled)("e2e · el cobro de una sesión clínica", () => {
  if (!e2eEnabled) console.warn(`\n${SKIP_MESSAGE}\n`);

  const prisma = getPrisma();
  const store = createAgendaStore(prisma);
  let app: FastifyInstance;

  let tenantId = "";
  let registerId = "";
  /** La podóloga: OWNER **y** sanitaria, como en el piloto. */
  let podologaId = "";
  /** Una sanitaria SIN caja: la que no ve importes y no cobra. */
  let sanitariaId = "";
  let pacienteId = "";
  let citaId = "";

  // El catálogo: el servicio con el que se da la cita y los tres
  // tratamientos marcados «es un tratamiento de la sesión».
  let primeraVisitaId = "";
  let quiropodiaId = "";
  let fresadoId = "";
  let verrugaId = "";

  /** El token del TPV de la podóloga: lleva `rid`, así que puede cobrar. */
  let tokenPodologa = "";
  /** El de la sanitaria sin caja: mismo register, rol CLINICIAN. */
  let tokenSanitaria = "";

  const DIA = "2026-09-10";

  function cabecera(t: string) {
    return { authorization: `Bearer ${t}` };
  }

  // ── aserciones contra la BD ─────────────────────────────────────────

  async function ticketsDeLaCita(): Promise<
    Array<{ id: string; status: string; total: string }>
  > {
    return prisma.$queryRawUnsafe(
      `SELECT t.id::text AS id, t.status::text AS status, t.total::text AS total
         FROM tickets t
        WHERE t.tenant_id = '${tenantId}'
        ORDER BY t.created_at ASC`,
    );
  }

  async function lineasDelTicket(
    id: string,
  ): Promise<Array<{ sku: string; name_snapshot: string; unit_price: string; tax_rate: string }>> {
    return prisma.$queryRawUnsafe(
      `SELECT sku, name_snapshot, unit_price::text AS unit_price, tax_rate::text AS tax_rate
         FROM ticket_lines WHERE ticket_id = '${id}'
        ORDER BY id`,
    );
  }

  async function sesionesDeLaCita(): Promise<number> {
    return prisma.clinicalEntry.count({
      where: { appointmentId: citaId, kind: "TREATMENT_SESSION" },
    });
  }

  async function crearServicio(input: {
    nombre: string;
    sku: string;
    precio: string;
    iva: string;
    tratamientoSesion: boolean;
    /** clinica-5 · la categoría, de la que sale el TIPO DE VISITA (S5). */
    tags?: string[];
    /** Y si es uno de los tres niveles de quiropodia, cuál. */
    nivelQuiropodia?: number | null;
  }): Promise<string> {
    const p = await prisma.product.create({
      data: {
        tenantId,
        name: input.nombre,
        sku: input.sku,
        basePrice: input.precio,
        taxRate: input.iva,
        kind: "SERVICE",
        tags: input.tags ?? ["podologia"],
      },
      select: { id: true },
    });
    await prisma.serviceScheduling.create({
      data: {
        productId: p.id,
        tenantId,
        durationMin: 30,
        tratamientoSesion: input.tratamientoSesion,
        nivelQuiropodia: input.nivelQuiropodia ?? null,
      },
    });
    return p.id;
  }

  /** clinica-5 · el cuerpo del cierre en la forma v2.
   *
   *  Los tres servicios de este e2e están en la categoría «podologia», o
   *  sea de tipo QUIROPODIA, que es lo que eran cuando no había tipos. */
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

  beforeAll(async () => {
    app = Fastify({ logger: false });
    registerErrorHandler(app);
    registerLenientJsonParser(app);
    await registerAgendaRoutes(app);
    await registerSesionRoutes(app);
    await app.ready();

    const tenant = await prisma.tenant.create({
      data: {
        name: `Clínica del Pie ${randomUUID().slice(0, 8)}`,
        // Las tres: la clínica EXIGE CRM y agenda (clinica-1).
        agendaEnabled: true,
        crmEnabled: true,
        clinicalRecordsEnabled: true,
      },
      select: { id: true },
    });
    tenantId = tenant.id;

    const local = await prisma.store.create({
      data: { tenantId, name: "Consulta" },
      select: { id: true },
    });
    const register = await prisma.register.create({
      data: { storeId: local.id, name: "Mostrador" },
      select: { id: true },
    });
    registerId = register.id;

    // La podóloga: dueña Y sanitaria. Es el caso del piloto, y el que
    // demuestra que la marca va separada del rol (clinica-1 §2).
    const podologa = await prisma.user.create({
      data: {
        tenantId,
        email: `lucia+${randomUUID()}@e2e.local`,
        alias: "Lucía Martín",
        role: "OWNER",
        isClinician: true,
        clinicianLicense: "Col. 45-0312",
        clinicalScope: "ALL",
      },
      select: { id: true },
    });
    podologaId = podologa.id;

    const sanitaria = await prisma.user.create({
      data: {
        tenantId,
        email: `ana+${randomUUID()}@e2e.local`,
        alias: "Ana Sanitaria",
        role: "CLINICIAN",
        isClinician: true,
        clinicianLicense: "Col. 45-0999",
        clinicalScope: "ALL",
      },
      select: { id: true },
    });
    sanitariaId = sanitaria.id;

    // EL TURNO. `checkoutAppointment` lo exige (imputa el cobro al turno
    // de su instante, `shift/impute.ts`) y es la razón por la que cerrar
    // la sesión NO crea el ticket: un sanitario sin caja no tiene turno.
    await prisma.shift.create({
      data: { registerId, userId: podologaId, cashOpening: "50" },
      select: { id: true },
    });

    const paciente = await prisma.client.create({
      data: {
        tenantId,
        firstName: "Carmen",
        lastName: "Rodríguez López",
        phone: "600 123 456",
        birthdate: new Date("1948-03-12T00:00:00.000Z"),
      },
      select: { id: true },
    });
    pacienteId = paciente.id;

    // LA VALORACIÓN VALIDADA: la puerta abierta. Sin ella no hay sesión, y
    // eso lo prueba `clinica-sesion-rutas.test.ts`.
    //
    // Se siembra ENTERA y no a medias, y no por gusto: el CHECK
    // `clinical_assessments_respuestas_segun_estado` de clinica-2 exige
    // que una valoración que no está PENDIENTE_PACIENTE tenga su entrada
    // de historia, su hora y quién contestó. O sea: **no se puede fingir
    // una valoración validada sin las respuestas del paciente**, que es
    // justo la garantía por la que ese CHECK existe. La primera pasada de
    // este fichero se puso roja ahí.
    //
    // Y la entrada la firma el actor «paciente por enlace» (clinica-2 §3),
    // porque la escribió el paciente — no la podóloga.
    const actorPaciente = await prisma.user.create({
      data: {
        tenantId,
        email: `paciente+${randomUUID()}@enlace.local`,
        alias: "Paciente (por enlace)",
        role: "CASHIER",
        isSystemActor: true,
      },
      select: { id: true },
    });
    const entradaValoracion = await prisma.clinicalEntry.create({
      data: {
        tenantId,
        clientId: pacienteId,
        authorUserId: actorPaciente.id,
        kind: "INITIAL_ASSESSMENT",
        body: {
          valoracion: { version: 1, canal: "TABLET", respondioPor: "PACIENTE" },
          respuestas: { diab: "SI", antic: "SI" },
          detalles: {},
        },
      },
      select: { id: true },
    });
    await prisma.$executeRawUnsafe(
      `INSERT INTO clinical_assessments
         (id, tenant_id, client_id, questionnaire_version, status, channel, source,
          requested_by_user_id, entry_id, answered_at, answered_by,
          confirmed_allergies, confirmed_medication,
          confirmed_alerts, validated_at, validated_by_user_id)
       VALUES ('${randomUUID()}', '${tenantId}', '${pacienteId}', 1, 'VALIDADA',
               'TABLET', 'MANUAL', '${podologaId}', '${entradaValoracion.id}',
               now(), 'PACIENTE', true, true, true,
               now(), '${podologaId}')`,
    );

    // clinica-5 · el mapa `categoría → tipo de visita` del centro (S5).
    // Sin esta fila, los servicios de abajo no tienen tipo y la sesión no
    // los ofrece en ninguna tarjeta — que es justo lo que la regla de S5
    // garantiza, y lo que el test de las rutas comprueba por el otro
    // lado.
    await prisma.tagVisitType.create({
      data: { tenantId, slug: "podologia", visitType: "QUIROPODIA" },
    });

    primeraVisitaId = await crearServicio({
      nombre: "Primera visita · valoración",
      sku: "SVC-VALORACION",
      precio: "35.0000",
      iva: "0",
      tratamientoSesion: false,
    });
    quiropodiaId = await crearServicio({
      nombre: "Quiropodia",
      sku: "SVC-QUIRO",
      precio: "30.0000",
      iva: "0",
      tratamientoSesion: true,
    });
    fresadoId = await crearServicio({
      nombre: "Corte y fresado de uñas",
      sku: "SVC-FRESADO",
      // «Incluido» en la pantalla es un precio de 0 en el catálogo, no una
      // marca aparte.
      precio: "0.0000",
      iva: "0",
      tratamientoSesion: true,
    });
    verrugaId = await crearServicio({
      nombre: "Tratamiento de verruga",
      sku: "SVC-VERRUGA",
      precio: "25.0000",
      iva: "0",
      tratamientoSesion: true,
    });

    // LA CITA, dada para «Quiropodia» y nada más. Es la clave del test 1:
    // lo que se cobra no va a ser esto.
    const start = new Date(`${DIA}T08:30:00.000Z`);
    const view = await store.insertHold({
      tenantId,
      externalId: randomUUID(),
      clientId: pacienteId,
      source: "PRESENCIAL",
      status: "CONFIRMED",
      pendingUntil: null,
      notes: null,
      timeslotStart: start,
      timeslotEnd: new Date(start.getTime() + 30 * 60_000),
      items: [
        {
          serviceId: quiropodiaId,
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
          staffUserId: podologaId,
          resourceId: null,
          startsAt: start,
          endsAt: new Date(start.getTime() + 30 * 60_000),
        },
      ],
    });
    citaId = view.id;

    // EL DISPOSITIVO, de verdad y no un uuid inventado: el registro de
    // accesos de clinica-1 guarda `device_id` con FK a `devices`, así que
    // una sesión de TPV con un `did` que no existe hace fallar la línea
    // del registro — y entonces la petición se corta con un 500
    // `CLINICAL_ACCESS_LOG_FAILED`, que es exactamente lo que ese bloque
    // decidió que pasara («si la línea no se puede escribir, la petición
    // falla»). La primera pasada de este fichero se puso roja ahí, y es la
    // garantía de clinica-1 funcionando.
    const dispositivo = await prisma.device.create({
      data: {
        tenantId,
        registerId,
        name: "Tablet de la sala",
        deviceTokenHash: randomBytes(32).toString("hex"),
      },
      select: { id: true },
    });
    const did = dispositivo.id;
    tokenPodologa = signCashierSession(
      { sub: podologaId, tid: tenantId, did, rid: registerId, role: "OWNER" },
      720,
    );
    tokenSanitaria = signCashierSession(
      {
        sub: sanitariaId,
        tid: tenantId,
        did,
        rid: registerId,
        role: "CLINICIAN",
      },
      720,
    );
  });

  afterAll(async () => {
    await app?.close();
    await shutdown();
  });

  // ── 1 · LO QUE SE COBRA ES LO QUE SE HIZO ─────────────────────────

  it("1 · la sesión se cierra con TRES tratamientos sobre una cita de UNO", async () => {
    const r = await app.inject({
      method: "POST",
      url: `/clinica/appointments/${citaId}/sesion/cerrar`,
      // El panel manda `Authorization` del TPV: `requireOwnerOrCashier`
      // acepta las dos puertas.
      headers: cabecera(tokenPodologa),
      payload: cerrarCon([quiropodiaId, fresadoId, verrugaId], {
        marcas: { "L:h": { lesion: "unero", gravedad: "MODERADA" } },
        evolucion: "MEJOR",
        consejos: ["calzado", "hidratar"],
        proximaCita: "S4",
        nota: "se le explicó la cura",
      }),
    });
    expect(r.statusCode).toBe(201);
    expect(await sesionesDeLaCita()).toBe(1);

    // CONTRA LA BD: la firma, con el colegiado congelado.
    const fila = await prisma.clinicalEntry.findFirstOrThrow({
      where: { appointmentId: citaId, kind: "TREATMENT_SESSION" },
      select: { body: true, authorUserId: true },
    });
    const cuerpo = fila.body as Record<string, any>;
    expect(fila.authorUserId).toBe(podologaId);
    expect(cuerpo.firma).toMatchObject({
      autorNombre: "Lucía Martín",
      colegiado: "Col. 45-0312",
    });
    // Y el NOMBRE de cada tratamiento, nunca su precio.
    //
    // Por la FORMA del cuerpo y no buscando el texto «30»: ese 30 aparece
    // dentro de cualquier uuid que lo lleve, así que el aserto pasaba o
    // fallaba según qué id tocara — **y en el CI tocó uno que lo llevaba**.
    // Es la lección del §10b de clinica-1: un aserto sobre el texto tiene
    // que contar, no buscar.
    expect(cuerpo.tratamientosNombre[quiropodiaId]).toBe("Quiropodia");
    // LA FORMA DEL CUERPO v2, clave por clave. El aserto es exacto a
    // propósito: el día que alguien añada un campo con un importe al
    // cuerpo de la historia, esto se pone rojo antes de que el importe
    // llegue a `clinical_entries`.
    expect(Object.keys(cuerpo).sort()).toEqual([
      "avisos",
      "bloques",
      "consejos",
      "consejosVersion",
      "dolor",
      "especialidad",
      "evolucion",
      "firma",
      "lesionesVersion",
      "listas",
      "mapaVersion",
      "marcas",
      "nota",
      "pendientesCerrados",
      "pendientesCreados",
      "proximaCita",
      "tipos",
      "tratamientos",
      "tratamientosNombre",
      "v",
    ]);
    // Y lo que clinica-5 añade: el tipo, la especialidad congelada (S5) y
    // el bloque con sus servicios.
    expect(cuerpo.v).toBe(2);
    expect(cuerpo.tipos).toEqual(["QUIROPODIA"]);
    expect(cuerpo.especialidad).toBe("PODOLOGIA");
    expect(cuerpo.bloques.QUIROPODIA.servicios).toEqual([
      quiropodiaId,
      fresadoId,
      verrugaId,
    ]);
    expect(clavesDeDinero(cuerpo)).toEqual([]);
  });

  it("2 · «Cobrar» abre un borrador con LOS TRES TRATAMIENTOS, no con el servicio de la cita", async () => {
    const r = await app.inject({
      method: "POST",
      url: `/agenda/appointments/${citaId}/checkout`,
      headers: cabecera(tokenPodologa),
    });
    expect(r.statusCode).toBe(201);

    // CONTRA LA BD: un ticket, con tres líneas.
    const tickets = await ticketsDeLaCita();
    expect(tickets).toHaveLength(1);
    const lineas = await lineasDelTicket(tickets[0]!.id);
    // ORDENADAS POR NOMBRE para comparar, y no por el orden en que se
    // marcaron: `ticket_lines` NO TIENE columna de orden —ni para una
    // cita, ni para una mesa, ni para una venta rápida— así que el orden
    // de las líneas de un ticket no está guardado en ningún sitio de esta
    // casa. No es de este bloque y no se arregla aquí; queda dicho en el
    // done como duda abierta.
    expect(lineas.map((l) => l.name_snapshot).sort()).toEqual([
      "Corte y fresado de uñas",
      "Quiropodia",
      "Tratamiento de verruga",
    ]);
    // El servicio de la cita era «Quiropodia» a secas: si el cobro
    // siguiera leyendo `appointment_items`, aquí habría UNA línea.
    expect(lineas).toHaveLength(3);
  });

  it("3 · con el PRECIO y el IVA del CATÁLOGO, no de la historia", async () => {
    const tickets = await ticketsDeLaCita();
    const lineas = await lineasDelTicket(tickets[0]!.id);
    // Por nombre de servicio, que es lo que ata precio y línea.
    const porNombre = new Map(lineas.map((l) => [l.name_snapshot, l]));
    expect(porNombre.get("Quiropodia")!.unit_price).toBe("30.0000");
    expect(porNombre.get("Corte y fresado de uñas")!.unit_price).toBe("0.0000");
    expect(porNombre.get("Tratamiento de verruga")!.unit_price).toBe("25.0000");
    expect(lineas.map((l) => l.tax_rate)).toEqual(["0.00", "0.00", "0.00"]);
    // Y el total del ticket es la suma, calculada por `computeTicket` —
    // el mismo que usa cualquier otra venta.
    expect(tickets[0]!.total).toBe("55.0000");
  });

  it("4 · la cita quedó ENLAZADA a ese ticket y en sala", async () => {
    const filas = await prisma.$queryRawUnsafe<
      Array<{ ticket_id: string | null; status: string }>
    >(
      `SELECT ticket_id::text AS ticket_id, status::text AS status
         FROM appointments WHERE id = '${citaId}'`,
    );
    const tickets = await ticketsDeLaCita();
    expect(filas[0]!.ticket_id).toBe(tickets[0]!.id);
    expect(filas[0]!.status).toBe("IN_SERVICE");
  });

  // ── 5 · CERRAR DOS VECES = UN COBRO ───────────────────────────────

  it("5 · cerrar la sesión otra vez no escribe nada y devuelve la firmada", async () => {
    const r = await app.inject({
      method: "POST",
      url: `/clinica/appointments/${citaId}/sesion/cerrar`,
      headers: cabecera(tokenPodologa),
      // Con otro contenido: lo que se devuelve es lo FIRMADO.
      payload: cerrarCon([verrugaId], { dolor: 9 }),
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().yaEstaba).toBe(true);
    expect(await sesionesDeLaCita()).toBe(1);
    expect(r.json().cerrada.cuerpo.dolor).toBe(4);
  });

  it("6 · y pulsar «Cobrar» otra vez devuelve EL MISMO borrador, no un segundo", async () => {
    const antes = await ticketsDeLaCita();
    const r = await app.inject({
      method: "POST",
      url: `/agenda/appointments/${citaId}/checkout`,
      headers: cabecera(tokenPodologa),
    });
    // 200 y no 201: es el GET-back del borrador enlazado (B-reservas-5).
    expect(r.statusCode).toBe(200);
    const despues = await ticketsDeLaCita();
    expect(despues).toHaveLength(1);
    expect(despues[0]!.id).toBe(antes[0]!.id);
  });

  // ── 7 · UN `CLINICIAN` NO ABRE UN COBRO ───────────────────────────

  it("7 · la sanitaria sin caja recibe 403 al intentar cobrar, y no nace un ticket", async () => {
    const otraCita = await nuevaCita("09:30");
    const antes = (await ticketsDeLaCita()).length;
    const r = await app.inject({
      method: "POST",
      url: `/agenda/appointments/${otraCita}/checkout`,
      headers: cabecera(tokenSanitaria),
    });
    expect(r.statusCode).toBe(403);
    expect(r.json().code).toBe("CLINICIAN_NO_CAJA");
    expect((await ticketsDeLaCita()).length).toBe(antes);
  });

  it("8 · y tampoco ve la lista de cobros pendientes", async () => {
    const r = await app.inject({
      method: "GET",
      url: `/agenda/cobros-pendientes?from=${DIA}`,
      headers: cabecera(tokenSanitaria),
    });
    expect(r.statusCode).toBe(403);
    expect(r.json().code).toBe("CLINICIAN_NO_CAJA");
  });

  // ── 9 · LA LISTA DE LA RECEPCIÓN ──────────────────────────────────

  it("9 · la recepción ve la cita, el paciente y las líneas con precio", async () => {
    // Una cita NUEVA con su sesión cerrada y sin cobrar: la de arriba ya
    // tiene su borrador abierto (y sigue pendiente, que es correcto — un
    // DRAFT es un cobro empezado y no terminado).
    const otra = await nuevaCita("10:30");
    await app.inject({
      method: "POST",
      url: `/clinica/appointments/${otra}/sesion/cerrar`,
      headers: cabecera(tokenPodologa),
      payload: cerrarCon([quiropodiaId], {
        marcas: { "R:talon": { lesion: "herida", gravedad: "SEVERA" } },
        dolor: 8,
        evolucion: "PEOR",
        consejos: ["cura"],
        nota: "la úlcera del talón va peor",
      }),
    });

    const r = await app.inject({
      method: "GET",
      url: `/agenda/cobros-pendientes?from=${DIA}`,
      headers: cabecera(tokenPodologa),
    });
    expect(r.statusCode).toBe(200);
    const cobros = r.json().cobros as Array<Record<string, any>>;
    const suyo = cobros.find((c) => c.appointmentId === otra)!;
    expect(suyo).toMatchObject({
      paciente: { id: pacienteId, nombre: "Carmen Rodríguez López" },
      servicios: ["Quiropodia"],
      total: 30,
      ivaTexto: "IVA 0 %",
    });
    expect(suyo.lineas).toEqual([
      { nombre: "Quiropodia", precio: 30, iva: 0 },
    ]);
  });

  it("10 · Y NI UNA PALABRA DE LA HISTORIA en esa lista", async () => {
    const r = await app.inject({
      method: "GET",
      url: `/agenda/cobros-pendientes?from=${DIA}`,
      headers: cabecera(tokenPodologa),
    });
    const json = JSON.stringify(r.json());
    for (const prohibido of [
      "herida",
      "SEVERA",
      "unero",
      "dolor",
      "PEOR",
      "MEJOR",
      "cura",
      "calzado",
      "úlcera",
      "marcas",
      "R:talon",
      "L:h",
      "S4",
      "Col. 45",
    ]) {
      expect(json, `«${prohibido}» no puede estar en la lista de cobros`).not.toContain(
        prohibido,
      );
    }
  });

  it("11 · una cita COBRADA sale de la lista; una con el borrador abierto sigue", async () => {
    const tickets = await ticketsDeLaCita();
    const elDeLaPrimera = tickets.find((t) => t.status === "DRAFT")!;
    // Con el borrador abierto, sigue pendiente.
    let r = await app.inject({
      method: "GET",
      url: `/agenda/cobros-pendientes?from=${DIA}`,
      headers: cabecera(tokenPodologa),
    });
    expect(
      (r.json().cobros as Array<{ appointmentId: string }>).map(
        (c) => c.appointmentId,
      ),
    ).toContain(citaId);

    // Se paga a mano (el camino de cobro de verdad lo prueba
    // `cita-a-caja.e2e.ts`; aquí lo que se mira es la LISTA).
    await prisma.$executeRawUnsafe(
      `UPDATE tickets SET status = 'PAID', paid_at = now() WHERE id = '${elDeLaPrimera.id}'`,
    );
    r = await app.inject({
      method: "GET",
      url: `/agenda/cobros-pendientes?from=${DIA}`,
      headers: cabecera(tokenPodologa),
    });
    expect(
      (r.json().cobros as Array<{ appointmentId: string }>).map(
        (c) => c.appointmentId,
      ),
    ).not.toContain(citaId);
  });

  // ── 12 · Y una cita SIN sesión cobra el servicio de la cita ───────

  it("12 · una cita sin sesión cerrada cobra SU SERVICIO, como antes de este bloque", async () => {
    // El camino de siempre, dentro del mismo tenant clínico: lo que
    // decide no es el tenant, es que haya o no sesión cerrada.
    const cita = await nuevaCita("11:30", primeraVisitaId);
    const r = await app.inject({
      method: "POST",
      url: `/agenda/appointments/${cita}/checkout`,
      headers: cabecera(tokenPodologa),
    });
    expect(r.statusCode).toBe(201);
    const ticketId = (r.json().ticket as { id: string }).id;
    const lineas = await lineasDelTicket(ticketId);
    expect(lineas.map((l) => l.name_snapshot)).toEqual([
      "Primera visita · valoración",
    ]);
    expect(lineas[0]!.unit_price).toBe("35.0000");
  });

  // ── El ayudante ──────────────────────────────────────────────────

  /** Otra cita del mismo día y del mismo paciente, a otra hora. */
  async function nuevaCita(
    horaUtc: string,
    servicioId = quiropodiaId,
  ): Promise<string> {
    const start = new Date(`${DIA}T${horaUtc}:00.000Z`);
    const view = await store.insertHold({
      tenantId,
      externalId: randomUUID(),
      clientId: pacienteId,
      source: "PRESENCIAL",
      status: "CONFIRMED",
      pendingUntil: null,
      notes: null,
      timeslotStart: start,
      timeslotEnd: new Date(start.getTime() + 30 * 60_000),
      items: [
        {
          serviceId: servicioId,
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
          staffUserId: podologaId,
          resourceId: null,
          startsAt: start,
          endsAt: new Date(start.getTime() + 30 * 60_000),
        },
      ],
    });
    return view.id;
  }
});
