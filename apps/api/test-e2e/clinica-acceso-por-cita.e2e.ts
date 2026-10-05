// clinica-1 · «el acceso a la historia nace de la cita», contra Postgres
// DE VERDAD y por la ruta de verdad.
//
// Decisión de producto (Matías, 05-10-2026): al asignarle una cita a un
// sanitario, ese paciente entra en su selección. Nadie teclea nada;
// atender es lo que concede el acceso.
//
// POR QUÉ ESTE FICHERO ES E2E Y NO UN BANCO CON PRISMA FALSO. Lo que se
// prueba es el enganche entero: la ruta → el motor → `store.reschedule` →
// `persistirAssignments` → `otorgarAccesoClinicoPorCita` → el índice único
// PARCIAL de Postgres. De esa cadena, las dos piezas que de verdad
// deciden son el `ON CONFLICT … WHERE revoked_at IS NULL` y el índice
// debajo, y ninguna de las dos existe en un doble. Un banco con prisma
// falso probaría que llamo a la función; esto prueba que el acceso
// aparece.
//
// POR QUÉ FICHERO PROPIO Y NO UN BLOQUE EN `clinica-historia.e2e.ts`: ese
// es la tabla de sabotajes de los TRIGGERS y no levanta Fastify ni el
// motor de reservas. Y no en `agenda-mover-con-otra.e2e.ts` porque su
// tenant es una PELUQUERÍA (sin clínica, y sus citas no tienen paciente):
// encenderle la clínica cambiaría los casos 17 y 18 que aquel bloque dejó
// fijados.
//
// ── EL CASO 4 ES EL QUE EL PROMPT DEL BLOQUE PIDE POR SU NOMBRE ──────
//
// «mover con otra sanitaria le da el acceso». Quedó escrito como pendiente
// mientras `mover-con-otra` vivía en su rama; entró en `origin/master` con
// el PR #6, así que aquí está activo. Y lo que demuestra es la razón por la
// que el enganche se puso donde se puso: el camino de cambiar de
// profesional al mover NO EXISTÍA cuando se escribió este bloque, pasa por
// `reschedule` y no por el alta, y funciona sin que `mover-con-otra` haya
// tocado una sola línea de lo clínico.

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

describe.skipIf(!e2eEnabled)(
  "e2e · el acceso a la historia nace de la cita",
  () => {
    if (!e2eEnabled) console.warn(`\n${SKIP_MESSAGE}\n`);

    const prisma = getPrisma();
    const store = createAgendaStore(prisma);
    let app: FastifyInstance;

    // La clínica de podología.
    let tenantId = "";
    // Y una peluquería al lado, con la clínica APAGADA. Es el control:
    // todo lo que pasa aquí tiene que NO pasar allí.
    let peluqueriaId = "";

    let luciaId = ""; // sanitaria, alcance SELECTION
    let claraId = ""; // sanitaria, la que recibe la cita al mover
    let martaId = ""; // CAJERA: no es sanitaria. No recibe accesos.
    let duenaId = ""; // propietaria NO sanitaria, la que revoca
    let pacienteId = "";
    let otroPacienteId = "";
    let quiropodiaId = "";
    let token = "";

    // Los de la peluquería.
    let soleId = "";
    let clientaId = "";
    let corteId = "";

    const auth = () => ({ authorization: `Bearer ${token}` });

    /** Una hora de pared de MAÑANA: siempre por delante del suelo de
     *  B-7a, se corra la suite a la hora que se corra. */
    function manana(hhmm: string): Date {
      const hoy = utcToWallDate(new Date());
      const d = new Date(`${hoy}T12:00:00.000Z`);
      d.setUTCDate(d.getUTCDate() + 1);
      return wallTimeToUtc(d.toISOString().slice(0, 10), hhmm);
    }

    // ── aserciones contra la BD, por SQL ──────────────────────────────

    /** Los accesos de un sanitario a un paciente, en orden de concesión y
     *  con su revocación. Se lee TODO el histórico y no sólo lo vigente:
     *  media garantía de este bloque es que las filas viejas se quedan. */
    async function accesosDe(
      clinicianUserId: string,
      clientId: string,
    ): Promise<Array<{ source: string; revocado: boolean }>> {
      const rows = await prisma.$queryRaw<
        Array<{ source: string; revoked_at: Date | null }>
      >`
        SELECT source::text AS source, revoked_at
          FROM clinical_access
         WHERE clinician_user_id = ${clinicianUserId}::uuid
           AND client_id = ${clientId}::uuid
         ORDER BY granted_at, id
      `;
      return rows.map((r) => ({
        source: r.source,
        revocado: r.revoked_at !== null,
      }));
    }

    /** ¿Tiene acceso VIGENTE? Es lo que contestaría la función de acceso. */
    async function tieneAcceso(
      clinicianUserId: string,
      clientId: string,
    ): Promise<boolean> {
      const todos = await accesosDe(clinicianUserId, clientId);
      return todos.some((a) => !a.revocado);
    }

    /** Siembra una cita saltándose el motor (como en `agenda-suelo` y en
     *  `agenda-mover-con-otra`): así la hora, la profesional y el paciente
     *  de partida son exactamente los que el caso pide.
     *
     *  Pasa por `store.insertHold`, que es uno de los dos caminos que
     *  llegan a `persistirAssignments` — o sea, sembrar YA ejerce el
     *  enganche del alta. */
    async function sembrarCita(
      start: Date,
      staffUserId: string,
      opts: {
        clientId?: string | null;
        tenantId?: string;
        serviceId?: string;
      } = {},
    ): Promise<string> {
      const tId = opts.tenantId ?? tenantId;
      const serviceId = opts.serviceId ?? quiropodiaId;
      const fin = new Date(start.getTime() + 30 * 60_000);
      const view = await store.insertHold({
        tenantId: tId,
        externalId: randomUUID(),
        clientId: opts.clientId === undefined ? pacienteId : opts.clientId,
        source: "PRESENCIAL",
        status: "CONFIRMED",
        pendingUntil: null,
        notes: null,
        timeslotStart: start,
        timeslotEnd: fin,
        items: [
          {
            serviceId,
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
            reservableType: "STAFF" as const,
            staffUserId,
            resourceId: null,
            startsAt: start,
            endsAt: fin,
          },
        ],
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

      const ayerAyer = new Date(Date.now() - 3 * 24 * 3600_000);

      /** Un servicio de 30 minutos, reservable. */
      async function servicio(tId: string, nombre: string): Promise<string> {
        const p = await prisma.product.create({
          data: {
            tenantId: tId,
            holdedProductId: `h-${randomUUID()}`,
            name: nombre,
            sku: `SVC-${randomUUID().slice(0, 8)}`,
            basePrice: "30.0000",
            taxRate: "21",
            kind: "SERVICE",
          },
          select: { id: true },
        });
        await prisma.serviceScheduling.create({
          data: { productId: p.id, tenantId: tId, durationMin: 30 },
        });
        return p.id;
      }

      /** Un profesional con turno diario de 00:00 a 24:00 y su skill. */
      async function profesional(
        tId: string,
        alias: string,
        serviceIds: string[],
        clinica: {
          role?: "OWNER" | "CASHIER" | "CLINICIAN";
          isClinician?: boolean;
          scope?: "ALL" | "SELECTION";
        } = {},
      ): Promise<string> {
        const u = await prisma.user.create({
          data: {
            tenantId: tId,
            email: `${alias.toLowerCase()}+${randomUUID()}@e2e.local`,
            alias,
            role: clinica.role ?? "CASHIER",
            isClinician: clinica.isClinician ?? false,
            clinicianLicense: clinica.isClinician ? "28/0001" : null,
            clinicalScope: clinica.scope ?? "SELECTION",
          },
          select: { id: true },
        });
        await prisma.staffProfile.create({
          data: { userId: u.id, tenantId: tId, displayName: alias },
        });
        for (const serviceId of serviceIds) {
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

      // ── La clínica ────────────────────────────────────────────────
      const clinica = await prisma.tenant.create({
        data: {
          name: `Clínica del Pie · acceso-por-cita ${randomUUID().slice(0, 8)}`,
          agendaEnabled: true,
          crmEnabled: true,
          clinicalRecordsEnabled: true,
        },
        select: { id: true },
      });
      tenantId = clinica.id;

      quiropodiaId = await servicio(tenantId, "Quiropodia");
      luciaId = await profesional(tenantId, "Lucia", [quiropodiaId], {
        role: "CLINICIAN",
        isClinician: true,
      });
      claraId = await profesional(tenantId, "Clara", [quiropodiaId], {
        role: "CLINICIAN",
        isClinician: true,
      });
      // Marta atiende en la agenda —una cajera puede llevar una cita de
      // mostrador— y NO es sanitaria. No recibe accesos.
      martaId = await profesional(tenantId, "Marta", [quiropodiaId]);
      duenaId = await profesional(tenantId, "Pilar", [quiropodiaId], {
        role: "OWNER",
      });

      const paciente = await prisma.client.create({
        data: { tenantId, firstName: "Antonio", lastName: "Gil" },
        select: { id: true },
      });
      pacienteId = paciente.id;
      const otro = await prisma.client.create({
        data: { tenantId, firstName: "Carmen", lastName: "Ruiz" },
        select: { id: true },
      });
      otroPacienteId = otro.id;

      // La caja desde la que se mueven las citas en el TPV.
      const local = await prisma.store.create({
        data: { tenantId, name: "Consulta" },
        select: { id: true },
      });
      const caja = await prisma.register.create({
        data: { storeId: local.id, name: "Caja 1" },
        select: { id: true },
      });
      const cajera = await prisma.user.create({
        data: {
          tenantId,
          email: `caja+${randomUUID()}@e2e.local`,
          alias: "Caja",
          role: "CASHIER",
        },
        select: { id: true },
      });
      await prisma.shift.create({
        data: { registerId: caja.id, userId: cajera.id, cashOpening: "50" },
      });
      token = signCashierSession(
        {
          sub: cajera.id,
          tid: tenantId,
          did: randomUUID(),
          rid: caja.id,
          role: "CASHIER",
        },
        720,
      );

      // ── La peluquería de al lado, SIN clínica ─────────────────────
      const pelu = await prisma.tenant.create({
        data: {
          name: `Peluquería Sole · control ${randomUUID().slice(0, 8)}`,
          agendaEnabled: true,
          crmEnabled: true,
          // Y aquí está lo que importa: APAGADA.
        },
        select: { id: true },
      });
      peluqueriaId = pelu.id;
      corteId = await servicio(peluqueriaId, "Corte de pelo");
      // Sole lleva la marca de sanitaria PUESTA a propósito: así el único
      // motivo por el que no recibe accesos es que su tenant no tiene la
      // clínica encendida, y no que le falte la marca.
      soleId = await profesional(peluqueriaId, "Sole", [corteId], {
        isClinician: true,
      });
      const clienta = await prisma.client.create({
        data: { tenantId: peluqueriaId, firstName: "Mari", lastName: "Paz" },
        select: { id: true },
      });
      clientaId = clienta.id;
    });

    afterAll(async () => {
      await app?.close();
      await shutdown();
    });

    // ── 1 · el alta ───────────────────────────────────────────────────

    it("1 · dar una cita a una sanitaria mete al paciente en su selección", async () => {
      const id = await sembrarCita(manana("09:00"), luciaId, {
        clientId: otroPacienteId,
      });
      expect(id).toBeTruthy();
      expect(await accesosDe(luciaId, otroPacienteId)).toEqual([
        { source: "APPOINTMENT", revocado: false },
      ]);
    });

    it("2 · a una CAJERA no: no es sanitaria, no hay acceso que conceder", async () => {
      // La marca, no el rol: Marta atiende en la agenda y no es sanitaria.
      await sembrarCita(manana("09:30"), martaId);
      expect(await accesosDe(martaId, pacienteId)).toEqual([]);
    });

    it("3 · una cita SIN paciente (walk-in) no concede nada", async () => {
      await sembrarCita(manana("10:00"), luciaId, { clientId: null });
      // Lucía sigue sin acceso a Antonio por esta vía.
      expect(await tieneAcceso(luciaId, pacienteId)).toBe(false);
    });

    // ── 4 · EL CASO QUE EL PROMPT PIDE POR SU NOMBRE ─────────────────

    it("4 · MOVER CON OTRA SANITARIA le da el acceso, en la misma transacción", async () => {
      // El camino de `mover-con-otra` (PR #6): `PATCH` con `start` y
      // `staffUserId`. Pasa por `engine.reschedule` → `store.reschedule`,
      // y ahí está `persistirAssignments`. Ni una línea de aquel bloque
      // sabe que lo clínico existe: el acceso lo concede el punto único
      // por el que los dos caminos pasan.
      const hora = manana("11:00");
      const id = await sembrarCita(hora, luciaId);
      expect(await tieneAcceso(luciaId, pacienteId)).toBe(true);
      // Clara todavía no lo ha atendido nunca.
      expect(await accesosDe(claraId, pacienteId)).toEqual([]);

      const res = await mover(id, {
        start: hora.toISOString(),
        staffUserId: claraId,
      });
      expect(res.statusCode, res.body).toBe(200);

      // Clara lo atiende → Clara ve su historia.
      expect(await accesosDe(claraId, pacienteId)).toEqual([
        { source: "APPOINTMENT", revocado: false },
      ]);
      // Y la cita es de Clara de verdad, no sólo el acceso.
      const rows = await prisma.$queryRaw<Array<{ staff_user_id: string }>>`
        SELECT DISTINCT staff_user_id::text AS staff_user_id
          FROM appointment_assignments
         WHERE appointment_id = ${id}::uuid
           AND reservable_type = 'STAFF' AND active
      `;
      expect(rows).toHaveLength(1);
      expect(rows[0]!.staff_user_id).toBe(claraId);
    });

    it("5 · y LUCÍA SIGUE VIÉNDOLA mientras no se le revoque", async () => {
      // Decisión de producto nº 7, literal: «al cambiar de especialista, el
      // anterior sigue viéndola mientras no se le revoque». Lo atendió, y
      // lo escrito por ella es suyo; quitárselo en silencio al mover una
      // cita sería borrarle el contexto de su propia anotación.
      expect(await tieneAcceso(luciaId, pacienteId)).toBe(true);
    });

    it("6 · mover CONSERVANDO a la profesional no crea filas nuevas", async () => {
      const hora = manana("12:00");
      const id = await sembrarCita(hora, luciaId);
      const antes = await accesosDe(luciaId, pacienteId);

      const res = await mover(id, {
        start: manana("12:30").toISOString(),
        staffUserId: luciaId,
      });
      expect(res.statusCode, res.body).toBe(200);

      // Lo garantiza el `ON CONFLICT … WHERE revoked_at IS NULL` contra el
      // índice parcial, no un `if`: si el `if` desapareciera, el INSERT
      // reventaría en vez de duplicar en silencio.
      expect(await accesosDe(luciaId, pacienteId)).toEqual(antes);
    });

    it("7 · mover SIN tocar la profesional tampoco (el camino de siempre)", async () => {
      // El `PATCH` sin `staffUserId`: el que usaban todos los llamantes
      // antes del PR #6. Pasa por el mismo `reschedule`.
      const hora = manana("13:00");
      const id = await sembrarCita(hora, luciaId);
      const antes = await accesosDe(luciaId, pacienteId);
      const res = await mover(id, { start: manana("13:30").toISOString() });
      expect(res.statusCode, res.body).toBe(200);
      expect(await accesosDe(luciaId, pacienteId)).toEqual(antes);
    });

    // ── 8 · revocar y volver a atender ───────────────────────────────

    it("8 · revocado y vuelto a atender: RECUPERA el acceso, y la revocación queda", async () => {
      // Decisión de producto nº 7, segunda mitad. Lo hace posible que el
      // índice único sea PARCIAL: la fila revocada no está en él, así que
      // la cita nueva inserta otra.
      const vigente = await prisma.clinicalAccess.findFirst({
        where: {
          tenantId,
          clinicianUserId: claraId,
          clientId: pacienteId,
          revokedAt: null,
        },
        select: { id: true },
      });
      expect(vigente).not.toBeNull();
      await prisma.clinicalAccess.update({
        where: { id: vigente!.id },
        data: { revokedAt: new Date(), revokedByUserId: duenaId },
      });
      expect(await tieneAcceso(claraId, pacienteId)).toBe(false);

      // Y vuelve a atenderlo.
      await sembrarCita(manana("14:00"), claraId);

      const todos = await accesosDe(claraId, pacienteId);
      expect(todos).toEqual([
        // La revocación NO desaparece: es el histórico.
        { source: "APPOINTMENT", revocado: true },
        { source: "APPOINTMENT", revocado: false },
      ]);
    });

    // ── 9 · el control: la peluquería no nota nada ───────────────────

    it("9 · en un tenant SIN clínica no se crea ni una fila", async () => {
      // Sole LLEVA la marca de sanitaria puesta, así que lo único que la
      // separa de un acceso es que su tenant no tiene la clínica
      // encendida. Es la garantía que protege a los quince clientes de
      // hoy, y la que se rompería si la capability se leyera mal.
      const hora = manana("09:00");
      await sembrarCita(hora, soleId, {
        tenantId: peluqueriaId,
        clientId: clientaId,
        serviceId: corteId,
      });
      expect(await accesosDe(soleId, clientaId)).toEqual([]);

      const total = await prisma.clinicalAccess.count({
        where: { tenantId: peluqueriaId },
      });
      expect(total).toBe(0);
    });

    it("10 · y el registro de accesos sigue vacío: dar una cita no es ABRIR una historia", async () => {
      // El enganche concede el ACCESO; no apunta una línea en el registro,
      // porque nadie ha abierto nada. El registro lo escribe `conHistoria`
      // cuando alguien entra de verdad. Confundir las dos cosas llenaría
      // de ruido la lista que se le enseña al paciente.
      const lineas = await prisma.clinicalAccessLog.count({
        where: { tenantId },
      });
      expect(lineas).toBe(0);
    });
  },
);
