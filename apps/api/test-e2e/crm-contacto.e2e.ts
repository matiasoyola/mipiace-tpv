// B-reservas-mostrador F6 · el contacto de Holded se hace cliente, contra
// Postgres DE VERDAD.
//
// POR QUÉ ESTE FICHERO EXISTE. Lo que se promete es «un contacto, un
// cliente», y eso es una promesa sobre CONCURRENCIA. Un Prisma en memoria no
// la puede demostrar: el fake serializa por construcción y daría verde con la
// deduplicación quitada. El cerrojo consultivo
// (`pg_advisory_xact_lock`) sólo existe en Postgres, y aquí se ejerce.
//
// Se cubren los cuatro casos del criterio de hecho del bloque:
//
//   1. dos altas SIMULTÁNEAS del mismo contacto dejan UN cliente enlazado;
//   2. un contacto ya enlazado devuelve ESE cliente, no uno nuevo;
//   3. alta sin apellidos por la API (frente 3);
//   4. un proveedor no aparece en la búsqueda del cajero NI del propietario,
//      y el endpoint de enlace lo rechaza.

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
const { registerCrmRoutes } = await import("../src/crm/routes.js");
const { registerContactsRoutes } = await import("../src/contacts/routes.js");
const { registerErrorHandler } = await import("../src/lib/error-handler.js");
const { registerLenientJsonParser } = await import("../src/lib/lenient-json.js");
const { signAccessToken } = await import("../src/auth/tokens.js");
const { CERROJO_SQL } = await import("../src/crm/from-contact.js");

describe.skipIf(!e2eEnabled)(
  "e2e · un contacto de Holded, un solo cliente del CRM",
  () => {
    if (!e2eEnabled) console.warn(`\n${SKIP_MESSAGE}\n`);

    const prisma = getPrisma();
    let app: FastifyInstance;

    let tenantId = "";
    let cajeroToken = "";
    let ownerToken = "";

    const auth = (t = cajeroToken) => ({ authorization: `Bearer ${t}` });

    /** Un contacto sincronizado de Holded, del tipo que se pida. */
    async function sembrarContacto(
      name: string,
      type: "CLIENT" | "SUPPLIER" | "LEAD" | "UNKNOWN" | null = "CLIENT",
      extra: { phone?: string; email?: string } = {},
    ): Promise<{ id: string; holdedContactId: string }> {
      const holdedContactId = `h-${randomUUID()}`;
      const row = await prisma.contact.create({
        data: {
          tenantId,
          holdedContactId,
          name,
          phone: extra.phone ?? null,
          email: extra.email ?? null,
          ...(type ? { type } : {}),
          active: true,
        },
        select: { id: true, holdedContactId: true },
      });
      return row;
    }

    async function clientesEnlazadosA(holdedContactId: string): Promise<number> {
      return prisma.client.count({ where: { tenantId, holdedContactId } });
    }

    beforeAll(async () => {
      app = Fastify({ logger: false });
      registerErrorHandler(app);
      registerLenientJsonParser(app);
      await registerCrmRoutes(app);
      await registerContactsRoutes(app);
      await app.ready();

      const tenant = await prisma.tenant.create({
        data: { name: "Peluquería e2e contactos", agendaEnabled: true },
        select: { id: true },
      });
      tenantId = tenant.id;

      const cajero = await prisma.user.create({
        data: {
          tenantId,
          email: `caja+${randomUUID()}@e2e.local`,
          alias: "Caja",
          role: "CASHIER",
        },
        select: { id: true },
      });
      const owner = await prisma.user.create({
        data: {
          tenantId,
          email: `owner+${randomUUID()}@e2e.local`,
          alias: "Dueña",
          role: "OWNER",
        },
        select: { id: true },
      });
      cajeroToken = signAccessToken({
        sub: cajero.id,
        tid: tenantId,
        role: "CASHIER",
      });
      ownerToken = signAccessToken({
        sub: owner.id,
        tid: tenantId,
        role: "OWNER",
      });
    });

    afterAll(async () => {
      await app?.close();
      await shutdown();
    });

    // ── 1 · LA CARRERA ────────────────────────────────────────────────

    it("dos altas SIMULTÁNEAS del mismo contacto dejan UN cliente enlazado", async () => {
      const contacto = await sembrarContacto("Demetria Salas Gil", "CLIENT", {
        phone: "600111222",
      });

      // Sin `await` entre medias: las dos peticiones salen a la vez y se
      // pisan dentro de Postgres. Es el caso del que va el cerrojo.
      const [a, b] = await Promise.all([
        app.inject({
          method: "POST",
          url: `/clients/from-contact/${contacto.id}`,
          headers: auth(),
        }),
        app.inject({
          method: "POST",
          url: `/clients/from-contact/${contacto.id}`,
          headers: auth(),
        }),
      ]);

      // Las dos contestan bien: nadie ve un error por haber llegado segundo.
      expect([a.statusCode, b.statusCode].sort()).toEqual([200, 201]);
      // Y las dos devuelven EL MISMO cliente.
      expect(a.json().client.id).toBe(b.json().client.id);
      // Una lo creó y la otra lo encontró.
      expect([a.json().created, b.json().created].sort()).toEqual([false, true]);

      // Lo que de verdad importa, preguntándoselo a la base:
      expect(await clientesEnlazadosA(contacto.holdedContactId)).toBe(1);
    });

    it("EL CERROJO serializa de verdad: dos transacciones no se solapan", async () => {
      // La prueba DIRECTA del mecanismo, sin depender de la suerte del
      // planificador. Dos transacciones piden el mismo cerrojo y cada una
      // marca cuándo entra y cuándo sale: si el cerrojo funciona, el orden
      // es «entra-sale-entra-sale» y NUNCA «entra-entra-…».
      const orden: string[] = [];
      const clave = `carrera-${randomUUID()}`;
      async function tarea(n: number) {
        await prisma.$transaction(
          async (tx) => {
            await tx.$executeRawUnsafe(CERROJO_SQL, tenantId, clave);
            orden.push(`entra-${n}`);
            await new Promise((r) => setTimeout(r, 120));
            orden.push(`sale-${n}`);
          },
          { timeout: 20_000 },
        );
      }
      await Promise.all([tarea(1), tarea(2)]);
      expect(orden).toHaveLength(4);
      // Quien entre primero da igual; lo que no puede pasar es que el segundo
      // entre antes de que el primero salga.
      expect(orden[1]).toBe(orden[0]!.replace("entra", "sale"));
      expect(orden.join(" ")).not.toMatch(/entra-\d entra-\d/);
    });

    it("y con DIEZ rondas de dos a la vez, ni una sola duplicada", async () => {
      // Una carrera es una carrera: una sola ronda puede salir bien por
      // suerte aunque el cerrojo no esté. Diez rondas convierten «tuvo
      // suerte» en «no puede».
      for (let i = 0; i < 10; i++) {
        const contacto = await sembrarContacto(`Repetida ${i}`);
        const res = await Promise.all([
          app.inject({
            method: "POST",
            url: `/clients/from-contact/${contacto.id}`,
            headers: auth(),
          }),
          app.inject({
            method: "POST",
            url: `/clients/from-contact/${contacto.id}`,
            headers: auth(),
          }),
        ]);
        for (const r of res) expect([200, 201]).toContain(r.statusCode);
        expect(await clientesEnlazadosA(contacto.holdedContactId)).toBe(1);
      }
    });

    it("y con CINCO a la vez sigue habiendo uno solo", async () => {
      const contacto = await sembrarContacto("Lucía Prieto");
      const respuestas = await Promise.all(
        Array.from({ length: 5 }, () =>
          app.inject({
            method: "POST",
            url: `/clients/from-contact/${contacto.id}`,
            headers: auth(),
          }),
        ),
      );
      for (const r of respuestas) expect([200, 201]).toContain(r.statusCode);
      const ids = new Set(respuestas.map((r) => r.json().client.id));
      expect(ids.size).toBe(1);
      expect(respuestas.filter((r) => r.json().created)).toHaveLength(1);
      expect(await clientesEnlazadosA(contacto.holdedContactId)).toBe(1);
    });

    it("dos contactos DISTINTOS a la vez sí dan dos clientes: el cerrojo no bloquea de más", async () => {
      const [uno, dos] = await Promise.all([
        sembrarContacto("Ana Belén Soto"),
        sembrarContacto("Isabel Cano"),
      ]);
      const [a, b] = await Promise.all([
        app.inject({
          method: "POST",
          url: `/clients/from-contact/${uno.id}`,
          headers: auth(),
        }),
        app.inject({
          method: "POST",
          url: `/clients/from-contact/${dos.id}`,
          headers: auth(),
        }),
      ]);
      expect(a.statusCode).toBe(201);
      expect(b.statusCode).toBe(201);
      expect(a.json().client.id).not.toBe(b.json().client.id);
      expect(a.json().client.firstName).toBe("Ana");
      expect(a.json().client.lastName).toBe("Belén Soto");
      expect(b.json().client.lastName).toBe("Cano");
    });

    // ── 2 · EL QUE YA ESTABA ──────────────────────────────────────────

    it("un contacto YA enlazado devuelve ese cliente, sin crear otro ni pisarlo", async () => {
      const contacto = await sembrarContacto("Carmen Ruiz");
      // El enlace tal y como lo deja el camino de cobro (ADR-010): un cliente
      // que ya existía, con su nombre puesto por el centro, al que se le
      // rellenó `holdedContactId` al hacer falta factura.
      const ya = await prisma.client.create({
        data: {
          tenantId,
          firstName: "Carmencita",
          lastName: "R.",
          holdedContactId: contacto.holdedContactId,
        },
        select: { id: true },
      });

      const res = await app.inject({
        method: "POST",
        url: `/clients/from-contact/${contacto.id}`,
        headers: auth(),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().created).toBe(false);
      expect(res.json().client.id).toBe(ya.id);
      // El nombre que le puso el centro NO se pisa con el de Holded.
      expect(res.json().client.firstName).toBe("Carmencita");
      expect(await clientesEnlazadosA(contacto.holdedContactId)).toBe(1);
    });

    it("un contacto de OTRO tenant no se puede enlazar: 404", async () => {
      const otro = await prisma.tenant.create({
        data: { name: "Otra peluquería e2e" },
        select: { id: true },
      });
      const ajeno = await prisma.contact.create({
        data: {
          tenantId: otro.id,
          holdedContactId: `h-${randomUUID()}`,
          name: "De otra casa",
          type: "CLIENT",
          active: true,
        },
        select: { id: true },
      });
      const res = await app.inject({
        method: "POST",
        url: `/clients/from-contact/${ajeno.id}`,
        headers: auth(),
      });
      expect(res.statusCode).toBe(404);
      expect(await prisma.client.count({ where: { tenantId: otro.id } })).toBe(0);
    });

    // ── 3 · ALTA SIN APELLIDOS ────────────────────────────────────────

    it("POST /clients sin apellidos entra, y la columna guarda cadena vacía", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/clients",
        headers: auth(),
        payload: { firstName: "Sole" },
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().client.lastName).toBe("");

      // La columna es NOT NULL y el insert ha pasado de verdad: si guardara
      // NULL, Postgres habría reventado aquí y no en el fake.
      const fila = await prisma.client.findUniqueOrThrow({
        where: { id: res.json().client.id },
        select: { firstName: true, lastName: true },
      });
      expect(fila).toEqual({ firstName: "Sole", lastName: "" });
    });

    it("un contacto de UNA sola palabra se enlaza sin apellidos", async () => {
      // Éste es el motivo de que el frente 3 vaya ANTES que el 6: sin
      // apellidos opcionales, este alta la rechazaría la base.
      const contacto = await sembrarContacto("Sole");
      const res = await app.inject({
        method: "POST",
        url: `/clients/from-contact/${contacto.id}`,
        headers: auth(),
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().client.firstName).toBe("Sole");
      expect(res.json().client.lastName).toBe("");
    });

    // ── 4 · LOS PROVEEDORES NO ────────────────────────────────────────

    it("un PROVEEDOR no aparece en la búsqueda del cajero", async () => {
      await sembrarContacto("Distribuciones Pérez SL", "SUPPLIER");
      await sembrarContacto("Peluquería Pérez clienta", "CLIENT");

      const res = await app.inject({
        method: "GET",
        url: "/contacts/search?q=Pérez",
        headers: auth(),
      });
      expect(res.statusCode).toBe(200);
      const nombres = res.json().results.map((r: { name: string }) => r.name);
      expect(nombres).toContain("Peluquería Pérez clienta");
      expect(nombres).not.toContain("Distribuciones Pérez SL");
    });

    it("tampoco en la del PROPIETARIO, que es quien usa la agenda en un centro pequeño", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/contacts/search?q=Distribuciones",
        headers: auth(ownerToken),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().results).toHaveLength(0);
    });

    it("el propietario SÓLO los ve pidiéndolo a propósito, y el TPV nunca lo pide", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/contacts/search?q=Distribuciones&includeAll=1",
        headers: auth(ownerToken),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().results).toHaveLength(1);
    });

    it("y un cajero que intente ese flag se lleva un 403", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/contacts/search?q=Distribuciones&includeAll=1",
        headers: auth(),
      });
      expect(res.statusCode).toBe(403);
    });

    it("enlazar un proveedor a mano se rechaza con 409 y no crea nada", async () => {
      const proveedor = await sembrarContacto("Suministros Capilares", "SUPPLIER");
      const antes = await prisma.client.count({ where: { tenantId } });
      const res = await app.inject({
        method: "POST",
        url: `/clients/from-contact/${proveedor.id}`,
        headers: auth(),
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().error).toBe("CONTACT_NOT_CLIENT");
      expect(await prisma.client.count({ where: { tenantId } })).toBe(antes);
      // Ni siquiera al propietario.
      const conOwner = await app.inject({
        method: "POST",
        url: `/clients/from-contact/${proveedor.id}`,
        headers: auth(ownerToken),
      });
      expect(conOwner.statusCode).toBe(409);
      expect(await prisma.client.count({ where: { tenantId } })).toBe(antes);
    });

    // ── Y lo que NO se toca ───────────────────────────────────────────

    it("el enlace NO escribe nada en Holded: ni un contacto nuevo ni uno tocado", async () => {
      // ADR-R2. Lo que se comprueba aquí es que la tabla `contacts` sale
      // intacta: si el endpoint hubiera llamado a Holded, el upsert de
      // `contacts/routes.ts` habría movido `lastSyncedAt`.
      const contacto = await sembrarContacto("Rosa Marín");
      const antes = await prisma.contact.findUniqueOrThrow({
        where: { id: contacto.id },
        select: { lastSyncedAt: true, name: true },
      });
      const cuantos = await prisma.contact.count({ where: { tenantId } });

      await app.inject({
        method: "POST",
        url: `/clients/from-contact/${contacto.id}`,
        headers: auth(),
      });

      const despues = await prisma.contact.findUniqueOrThrow({
        where: { id: contacto.id },
        select: { lastSyncedAt: true, name: true },
      });
      expect(despues).toEqual(antes);
      expect(await prisma.contact.count({ where: { tenantId } })).toBe(cuantos);
    });
  },
);
