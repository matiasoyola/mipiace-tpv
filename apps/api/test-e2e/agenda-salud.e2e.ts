// B-reservas-9 · El panel de salud contra Postgres DE VERDAD.
//
// POR QUÉ ESTE FICHERO EXISTE. Las seis tarjetas son SQL crudo. Probarlas
// contra un doble sería probar el doble: el `HAVING COUNT(...) <
// staff_required`, el `LEFT JOIN` que exige perfil ACTIVO y el `%` de la
// tarjeta 2 los ejecuta Postgres o no los ejecuta nadie. Y la degradación
// honesta se apoya en una sonda al esquema REAL (`information_schema`):
// sólo aquí se puede ver que las tres tablas que no existen de verdad no
// existen, y que la tarjeta se apaga por eso y no porque esté cableada.
//
// El caso es el CRITERIO DE "FUNCIONA" del prompt, literal: un centro con
// tres servicios agendables de los que dos no tienen a nadie. El panel lo
// dice, los lista, y desde ahí se arregla por la matriz.

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
const { signAccessToken } = await import("../src/auth/tokens.js");
const { DURATION_PATTERN_KEY } = await import("../src/agenda/health.js");

interface CardView {
  key: string;
  status: "ok" | "unavailable";
  value: number | null;
  items: Array<{ id: string; label: string; detail: string | null }>;
  query: string;
  explain: string;
  dependsOn: { block: string; what: string } | null;
}

describe.skipIf(!e2eEnabled)(
  "e2e · el panel de salud de la agenda contra Postgres real",
  () => {
    if (!e2eEnabled) console.warn(`\n${SKIP_MESSAGE}\n`);

    const prisma = getPrisma();
    let app: FastifyInstance;

    // El reloj del panel se inyecta: "las últimas 24 h" tienen que ser las
    // mismas se corra la suite a la hora que se corra.
    const AHORA = new Date("2026-09-13T10:00:00.000Z");

    let tenantId = "";
    let otroTenantId = "";
    let soleId = "";
    let nuriaInactivaId = "";
    let ownerToken = "";
    let cajeraToken = "";
    // Los tres servicios agendables del criterio.
    let maderoterapiaId = ""; // la da Sole → SÍ se puede dar
    let spaCapilarId = ""; // no la tiene nadie → NO
    let ritualId = ""; // sólo Nuria, con el perfil INACTIVO → NO

    const auth = (t: string) => ({ authorization: `Bearer ${t}` });

    async function salud(token = ownerToken): Promise<CardView[]> {
      const res = await app.inject({
        method: "GET",
        url: "/agenda/health",
        headers: auth(token),
      });
      expect(res.statusCode).toBe(200);
      return (res.json() as { cards: CardView[] }).cards;
    }

    function tarjeta(cards: CardView[], key: string): CardView {
      const card = cards.find((c) => c.key === key);
      if (!card) throw new Error(`no está la tarjeta ${key}`);
      return card;
    }

    async function crearServicio(
      tid: string,
      name: string,
      sched: { durationMin: number; bufferAfterMin?: number; staffRequired?: number } | null,
    ): Promise<string> {
      const p = await prisma.product.create({
        data: {
          tenantId: tid,
          holdedProductId: `h-${randomUUID()}`,
          name,
          sku: `SVC-${randomUUID().slice(0, 8)}`,
          basePrice: "50.0000",
          taxRate: "21",
          kind: "SERVICE",
        },
        select: { id: true },
      });
      if (sched) {
        await prisma.serviceScheduling.create({
          data: {
            productId: p.id,
            tenantId: tid,
            durationMin: sched.durationMin,
            bufferAfterMin: sched.bufferAfterMin ?? 0,
            staffRequired: sched.staffRequired ?? 1,
          },
        });
      }
      return p.id;
    }

    /** Una cita cruda: `timeslot` es `tstzrange` y Prisma no la escribe. */
    async function crearCita(
      tid: string,
      source: string,
      createdAt: Date,
    ): Promise<void> {
      await prisma.$executeRawUnsafe(
        `INSERT INTO appointments
           (id, tenant_id, mode, timeslot, status, source, created_at, updated_at)
         VALUES ($1::uuid, $2::uuid, 'APPOINTMENT'::"ReservationMode",
           tstzrange($3::timestamptz, $4::timestamptz, '[)'),
           'CONFIRMED'::"AppointmentStatus", $5::"ReservationSource",
           $6::timestamptz, $6::timestamptz)`,
        randomUUID(),
        tid,
        "2026-09-20T09:00:00.000Z",
        "2026-09-20T10:00:00.000Z",
        source,
        createdAt.toISOString(),
      );
    }

    beforeAll(async () => {
      app = Fastify({ logger: false });
      registerErrorHandler(app);
      registerLenientJsonParser(app);
      await registerAgendaRoutes(app, { clock: { now: () => AHORA } });
      await app.ready();

      const tenant = await prisma.tenant.create({
        data: { name: "Centro e2e salud", agendaEnabled: true },
        select: { id: true },
      });
      tenantId = tenant.id;
      const otro = await prisma.tenant.create({
        data: { name: "Centro e2e vecino", agendaEnabled: true },
        select: { id: true },
      });
      otroTenantId = otro.id;

      const store_ = await prisma.store.create({
        data: { tenantId, name: "Local e2e" },
        select: { id: true },
      });
      const register = await prisma.register.create({
        data: { storeId: store_.id, name: "Caja 1" },
        select: { id: true },
      });
      const owner = await prisma.user.create({
        data: {
          tenantId,
          email: `owner+${randomUUID()}@e2e.local`,
          alias: "Owner",
          role: "OWNER",
        },
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
      ownerToken = signAccessToken({ sub: owner.id, tid: tenantId, role: "OWNER" });
      cajeraToken = signCashierSession(
        {
          sub: cajera.id,
          tid: tenantId,
          did: randomUUID(),
          rid: register.id,
          role: "CASHIER",
        },
        720,
      );

      const sole = await prisma.user.create({
        data: {
          tenantId,
          email: `sole+${randomUUID()}@e2e.local`,
          alias: "Sole",
          role: "CASHIER",
        },
        select: { id: true },
      });
      soleId = sole.id;
      await prisma.staffProfile.create({
        data: { userId: soleId, tenantId, displayName: "Sole", active: true },
      });
      const nuria = await prisma.user.create({
        data: {
          tenantId,
          email: `nuria+${randomUUID()}@e2e.local`,
          alias: "Nuria",
          role: "CASHIER",
        },
        select: { id: true },
      });
      nuriaInactivaId = nuria.id;
      // El perfil INACTIVO: sus skills existen y el motor las ignora. Es el
      // segundo sabor del mismo fallo, y ningún sitio lo decía.
      await prisma.staffProfile.create({
        data: {
          userId: nuriaInactivaId,
          tenantId,
          displayName: "Nuria",
          active: false,
        },
      });

      // Los tres servicios agendables del criterio, más ruido honesto:
      // un producto que no es servicio y un servicio sin ficha de agenda.
      maderoterapiaId = await crearServicio(tenantId, "Maderoterapia", {
        durationMin: 60,
        bufferAfterMin: 10,
      });
      spaCapilarId = await crearServicio(tenantId, "Spa capilar", {
        durationMin: 32,
        bufferAfterMin: 0,
      });
      ritualId = await crearServicio(tenantId, "Ritual reafirmante", {
        durationMin: 90,
        bufferAfterMin: 10,
      });
      await crearServicio(tenantId, "Sin ficha de agenda", null);
      await prisma.product.create({
        data: {
          tenantId,
          holdedProductId: `h-${randomUUID()}`,
          name: "Champú",
          sku: `PRD-${randomUUID().slice(0, 8)}`,
          basePrice: "10.0000",
          taxRate: "21",
          kind: "PRODUCT",
        },
      });

      await prisma.staffSkill.create({
        data: { userId: soleId, tenantId, serviceId: maderoterapiaId },
      });
      await prisma.staffSkill.create({
        data: { userId: nuriaInactivaId, tenantId, serviceId: ritualId },
      });

      // El centro vecino está TAMBIÉN roto: si el aislamiento falla, sus
      // servicios huérfanos aparecerían en nuestras cifras.
      await crearServicio(otroTenantId, "Del vecino A", { durationMin: 45 });
      await crearServicio(otroTenantId, "Del vecino B", { durationMin: 45 });

      // Citas: tres dentro de las 24 h y una vieja que NO cuenta.
      await crearCita(tenantId, "PRESENCIAL", new Date("2026-09-13T08:00:00.000Z"));
      await crearCita(tenantId, "PRESENCIAL", new Date("2026-09-12T23:00:00.000Z"));
      await crearCita(tenantId, "PHONE", new Date("2026-09-13T09:30:00.000Z"));
      await crearCita(tenantId, "WEB", new Date("2026-09-11T09:00:00.000Z"));
      await crearCita(otroTenantId, "WEB", new Date("2026-09-13T09:00:00.000Z"));
    });

    afterAll(async () => {
      await app?.close();
      await shutdown();
    });

    // ── 1 · La tarjeta que costó dos semanas ────────────────────────

    it("1 · con tres agendables y dos sin nadie, el panel dice 2 y los lista", async () => {
      const card = tarjeta(await salud(), "servicios-sin-profesional");
      expect(card.status).toBe("ok");
      expect(card.value).toBe(2);
      expect(card.items.map((i) => i.label).sort()).toEqual([
        "Ritual reafirmante",
        "Spa capilar",
      ]);
      expect(card.items.map((i) => i.id).sort()).toEqual(
        [ritualId, spaCapilarId].sort(),
      );
    });

    it("2 · y dice POR QUÉ no se puede dar cada uno", async () => {
      const card = tarjeta(await salud(), "servicios-sin-profesional");
      const porId = Object.fromEntries(card.items.map((i) => [i.id, i.detail]));
      expect(porId[spaCapilarId]).toBe("Nadie lo tiene asignado");
      // Nuria SÍ lo tiene asignado, pero con el perfil de agenda apagado:
      // es exactamente lo que el motor descarta en silencio.
      expect(porId[ritualId]).toBe(
        "1 asignada, ninguna con perfil de agenda activo",
      );
    });

    it("3 · un servicio que necesita 2 y sólo tiene 1 también sale", async () => {
      await prisma.serviceScheduling.update({
        where: { productId: maderoterapiaId },
        data: { staffRequired: 2 },
      });
      const card = tarjeta(await salud(), "servicios-sin-profesional");
      expect(card.value).toBe(3);
      const mader = card.items.find((i) => i.id === maderoterapiaId)!;
      expect(mader.detail).toBe("1 de 2 profesionales a la vez");
      await prisma.serviceScheduling.update({
        where: { productId: maderoterapiaId },
        data: { staffRequired: 1 },
      });
    });

    it("4 · un servicio SIN ficha de agenda no entra en la cuenta", async () => {
      const card = tarjeta(await salud(), "servicios-sin-profesional");
      expect(card.items.map((i) => i.label)).not.toContain("Sin ficha de agenda");
    });

    // ── 2 · El aislamiento ──────────────────────────────────────────

    it("5 · los servicios rotos del centro vecino no salen aquí", async () => {
      const card = tarjeta(await salud(), "servicios-sin-profesional");
      const labels = card.items.map((i) => i.label);
      expect(labels).not.toContain("Del vecino A");
      expect(labels).not.toContain("Del vecino B");
      const canal = tarjeta(await salud(), "citas-por-canal-24h");
      expect(canal.items.map((i) => i.label)).not.toContain("Web");
    });

    // ── 3 · El criterio de "funciona": se arregla desde aquí ────────

    it("6 · asignando a Sole desde la ficha del servicio, la cifra baja", async () => {
      const antes = tarjeta(await salud(), "servicios-sin-profesional");
      expect(antes.value).toBe(2);

      const res = await app.inject({
        method: "PUT",
        url: `/agenda/skill-matrix/service/${spaCapilarId}`,
        headers: auth(ownerToken),
        payload: { staffUserIds: [soleId] },
      });
      expect(res.statusCode).toBe(200);

      const despues = tarjeta(await salud(), "servicios-sin-profesional");
      expect(despues.value).toBe(1);
      expect(despues.items.map((i) => i.id)).toEqual([ritualId]);
    });

    it("7 · y activando el perfil de Nuria baja a cero, con su buena noticia", async () => {
      await prisma.staffProfile.update({
        where: { userId: nuriaInactivaId },
        data: { active: true },
      });
      const card = tarjeta(await salud(), "servicios-sin-profesional");
      expect(card.value).toBe(0);
      expect(card.items).toEqual([]);
      // Se deja como estaba para los tests que vienen detrás.
      await prisma.staffProfile.update({
        where: { userId: nuriaInactivaId },
        data: { active: false },
      });
      await prisma.staffSkill.deleteMany({
        where: { tenantId, serviceId: spaCapilarId },
      });
    });

    // ── 4 · La matriz, desde los dos lados, contra la PK real ───────

    it("8 · los dos lados dejan la misma fila, y la PK compuesta aguanta", async () => {
      const porServicio = await app.inject({
        method: "PUT",
        url: `/agenda/skill-matrix/service/${spaCapilarId}`,
        headers: auth(ownerToken),
        payload: { staffUserIds: [soleId] },
      });
      expect(porServicio.statusCode).toBe(200);
      const filaA = await prisma.staffSkill.findMany({
        where: { tenantId, serviceId: spaCapilarId },
        select: { userId: true, serviceId: true, tenantId: true },
      });

      // Escribir LO MISMO desde el otro lado no duplica ni revienta.
      const porProfesional = await app.inject({
        method: "PUT",
        url: `/agenda/skill-matrix/staff/${soleId}`,
        headers: auth(ownerToken),
        payload: { serviceIds: [maderoterapiaId, spaCapilarId] },
      });
      expect(porProfesional.statusCode).toBe(200);
      const filaB = await prisma.staffSkill.findMany({
        where: { tenantId, serviceId: spaCapilarId },
        select: { userId: true, serviceId: true, tenantId: true },
      });
      expect(filaB).toEqual(filaA);

      // Y quitarlo desde el servicio lo quita de verdad.
      await app.inject({
        method: "PUT",
        url: `/agenda/skill-matrix/service/${spaCapilarId}`,
        headers: auth(ownerToken),
        payload: { staffUserIds: [] },
      });
      expect(
        await prisma.staffSkill.count({
          where: { tenantId, serviceId: spaCapilarId },
        }),
      ).toBe(0);
    });

    it("9 · la cajera lee la matriz y no la escribe", async () => {
      const lee = await app.inject({
        method: "GET",
        url: "/agenda/skill-matrix",
        headers: auth(cajeraToken),
      });
      expect(lee.statusCode).toBe(200);
      expect(lee.json().editable).toBe(false);
      const escribe = await app.inject({
        method: "PUT",
        url: `/agenda/skill-matrix/service/${spaCapilarId}`,
        headers: auth(cajeraToken),
        payload: { staffUserIds: [soleId] },
      });
      expect(escribe.statusCode).toBe(403);
      expect(
        await prisma.staffSkill.count({
          where: { tenantId, serviceId: spaCapilarId },
        }),
      ).toBe(0);
    });

    // ── 5 · Las otras cifras ────────────────────────────────────────

    it("10 · la tarjeta 5 cuenta las citas de las últimas 24 h por canal", async () => {
      const card = tarjeta(await salud(), "citas-por-canal-24h");
      expect(card.status).toBe("ok");
      // Tres dentro de la ventana; la del día 11 se queda fuera.
      expect(card.value).toBe(3);
      expect(card.items).toEqual([
        { id: "PRESENCIAL", label: "Mostrador", detail: "2 citas" },
        { id: "PHONE", label: "Teléfono", detail: "1 cita" },
      ]);
    });

    it("11 · sin patrón declarado, la tarjeta 2 no inventa ninguno", async () => {
      const card = tarjeta(await salud(), "duracion-fuera-de-patron");
      expect(card.status).toBe("unavailable");
      expect(card.value).toBeNull();
      expect(card.items).toEqual([]);
    });

    it("12 · con el patrón declarado, caza las duraciones que se salen", async () => {
      await prisma.bookingPolicy.create({
        data: {
          tenantId,
          key: DURATION_PATTERN_KEY,
          value: { stepMin: 5, pickupMin: 10 },
        },
      });
      const card = tarjeta(await salud(), "duracion-fuera-de-patron");
      expect(card.status).toBe("ok");
      // "Spa capilar" son 32 min (no múltiplo de 5) con recogida 0 en vez
      // de 10 — el mapeo que mentía. "Sin ficha de agenda" no tiene fila.
      expect(card.items.map((i) => i.label)).toEqual(["Spa capilar"]);
      expect(card.items[0]!.detail).toBe(
        "32 min no es múltiplo de 5 · recogida de 0 min en vez de 10",
      );
      expect(card.value).toBe(1);
    });

    // ── 6 · La degradación honesta, contra el esquema real ──────────

    it("13 · las tres tarjetas cuyo bloque no existe salen deshabilitadas, no a cero", async () => {
      const cards = await salud();
      for (const key of [
        "saldo-vivo-sin-cita",
        "filtrado-por-reglas",
        "ventanas-fuera-de-turno",
      ]) {
        const card = tarjeta(cards, key);
        expect(card.status, key).toBe("unavailable");
        expect(card.value, key).toBeNull();
        expect(card.dependsOn?.block, key).toMatch(/^B-reservas-/);
      }
    });

    // ── 7 · El principio del bloque ─────────────────────────────────

    it("14 · toda tarjeta calculada trae su consulta y su explicación", async () => {
      for (const card of await salud()) {
        expect(card.query, card.key).toMatch(/SELECT/);
        expect(card.explain.length, card.key).toBeGreaterThan(40);
      }
    });

    it("15 · el gate de agenda protege el panel", async () => {
      const apagado = await prisma.tenant.create({
        data: { name: "Centro sin agenda", agendaEnabled: false },
        select: { id: true },
      });
      const user = await prisma.user.create({
        data: {
          tenantId: apagado.id,
          email: `off+${randomUUID()}@e2e.local`,
          alias: "Off",
          role: "OWNER",
        },
        select: { id: true },
      });
      const res = await app.inject({
        method: "GET",
        url: "/agenda/health",
        headers: auth(
          signAccessToken({ sub: user.id, tid: apagado.id, role: "OWNER" }),
        ),
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().error).toBe("AGENDA_DISABLED");
    });
  },
);
