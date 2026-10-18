// Endpoints del CRM / ficha de cliente (B-reservas-1).
//
//   GET   /clients?query=&sort=az&cursor=  — búsqueda A–Z por nombre/
//                                            teléfono/email, paginado.
//   POST  /clients                         — alta (idempotente por
//                                            externalId para el outbox).
//   POST  /clients/from-contact/:contactId — cliente enlazado a un contacto
//                                            de Holded (idempotente por
//                                            cerrojo consultivo; ver
//                                            `from-contact.ts`).
//   GET   /clients/:id                     — ficha completa (+ consents,
//                                            + ficha técnica).
//   PATCH /clients/:id                     — edición.
//   GET   /clients/:id/history             — historial unificado: compras
//                                            (tickets del contacto Holded)
//                                            + citas (vacío hasta B4) +
//                                            movimientos de bono (vacío
//                                            hasta B5), contrato estable.
//   GET   /clients/:id/vouchers            — saldo de bonos (vacío hasta
//                                            B5, contrato estable).
//   POST  /clients/:id/consents            — alta manual de consentimiento
//                                            RGPD (firma digital = fase 2).
//   POST  /clients/:id/technical-notes     — alta de ficha técnica por
//                                            servicio.
//
// ADR-R2: el CRM es LOCAL, fuente de verdad propia. `holdedContactId` es
// sólo un enlace fiscal perezoso — aquí NUNCA se crea contacto en Holded
// ni se vuelca historial / ficha técnica / RGPD. El enlace lo rellena el
// camino de cobro existente cuando hace falta factura (ADR-010, intacto).
//
// Aislamiento por fila: toda query filtra por `auth.tenantId`. Las tablas
// hijas (consents, ficha técnica) se acceden SIEMPRE a través de un
// cliente previamente validado como perteneciente al tenant.

import {
  dekParaNotas,
  leerNota,
  notaParaGuardar,
} from "../clinica/notas.js";
import { nuevoIdDeFila } from "../clinica/cripto-campos.js";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ClientConsentKind, type Prisma } from "@mipiacetpv/db";

import { requireOwnerOrCashier } from "../auth/middleware.js";
import { getPrisma } from "../context.js";
import { createAgendaStore } from "../agenda/store.js";
import { esSanitarioSinCaja } from "../lib/caja-gate.js";
import { bonosIsEnabled } from "../vouchers/gate-tenant.js";
import { bonosDeLaFicha, libroDeLaFicha } from "../vouchers/lectura.js";
import { bonoConDinero, bonoSinDinero } from "../vouchers/vistas.js";
import {
  comoPrismaParaAcceso,
  resolverAccesoClinico,
} from "../clinica/acceso.js";
import {
  comoPrismaParaEnlace,
  enlazarContacto,
  esContactoDeCliente,
} from "./from-contact.js";

// Vista pública de un cliente para el TPV. No incluye `raw` ni metadatos
// internos; el front cachea esto en Dexie para la búsqueda offline.
function toClientView(c: {
  id: string;
  externalId: string | null;
  firstName: string;
  lastName: string;
  phone: string | null;
  email: string | null;
  birthdate: Date | null;
  holdedContactId: string | null;
  marketingOptIn: boolean;
  notes: string | null;
  // clinica-7 · la nota cifrada y el tenant, que su AAD necesita.
  notesCifradas: string | null;
  tenantId: string;
  createdAt: Date;
  updatedAt: Date;
}, dek: Buffer | null) {
  return {
    id: c.id,
    externalId: c.externalId,
    firstName: c.firstName,
    lastName: c.lastName,
    phone: c.phone,
    email: c.email,
    // Sólo la fecha (YYYY-MM-DD); el campo es @db.Date.
    birthdate: c.birthdate ? c.birthdate.toISOString().slice(0, 10) : null,
    holdedContactId: c.holdedContactId,
    marketingOptIn: c.marketingOptIn,
    // clinica-7 · en un tenant clínico la nota va cifrada. La API
    // descifra; el cliente nunca ve texto cifrado.
    notes: leerNota(
      {
        tenantId: c.tenantId,
        id: c.id,
        que: "FICHA",
        claro: c.notes,
        cifrado: c.notesCifradas,
      },
      dek,
    ),
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

const CLIENT_SELECT = {
  id: true,
  externalId: true,
  firstName: true,
  lastName: true,
  phone: true,
  email: true,
  birthdate: true,
  holdedContactId: true,
  marketingOptIn: true,
  notes: true,
  notesCifradas: true,
  tenantId: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ClientSelect;

// Carga un cliente validando que pertenece al tenant del actor. Devuelve
// null (→ 404 en el handler) si no existe o es de otro tenant. Es la
// puerta de aislamiento para todas las operaciones sobre hijas.
async function loadOwnedClient(tenantId: string, id: string) {
  const prisma = getPrisma();
  return prisma.client.findFirst({
    where: { id, tenantId },
    select: CLIENT_SELECT,
  });
}

function notFound(reply: FastifyReply) {
  return reply.code(404).send({
    error: "CLIENT_NOT_FOUND",
    message: "Cliente no encontrado.",
  });
}

export async function registerCrmRoutes(app: FastifyInstance): Promise<void> {
  // ── Lista / búsqueda A–Z ────────────────────────────────────────────
  app.get(
    "/clients",
    {
      preHandler: requireOwnerOrCashier,
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            query: { type: "string", maxLength: 120 },
            sort: { type: "string", enum: ["az"] },
            cursor: { type: "string", format: "uuid" },
            limit: { type: "integer", minimum: 1, maximum: 200 },
          },
        },
      },
    },
    async (request: FastifyRequest) => {
      const auth = request.auth!;
      const q = request.query as {
        query?: string;
        sort?: "az";
        cursor?: string;
        limit?: number;
      };
      const prisma = getPrisma();
      const limit = q.limit ?? 50;
      const trimmed = (q.query ?? "").trim();

      const where: Prisma.ClientWhereInput = { tenantId: auth.tenantId };
      if (trimmed.length > 0) {
        where.OR = [
          { firstName: { contains: trimmed, mode: "insensitive" } },
          { lastName: { contains: trimmed, mode: "insensitive" } },
          { phone: { contains: trimmed, mode: "insensitive" } },
          { email: { contains: trimmed, mode: "insensitive" } },
        ];
      }

      const rows = await prisma.client.findMany({
        where,
        // A–Z estable: apellido, nombre y desempate por id (cursor).
        //
        // B-reservas-mostrador F3 · con apellidos opcionales, un `""` ordena
        // ANTES que cualquier letra y esas clientas salen las primeras de la
        // primera página. Este orden NO se toca, y no es una omisión: es el
        // ORDEN DEL CURSOR de paginación, no lo que se ve. `refreshClients()`
        // en el TPV se baja el tenant entero (200 por página) y la lista se
        // pinta con `sortClientsAz`, que sí trata el apellido vacío (la clave
        // pasa a ser el nombre). Lo único que este `orderBy` tiene que
        // garantizar es ser un orden TOTAL y estable entre páginas, y lo es.
        orderBy: [{ lastName: "asc" }, { firstName: "asc" }, { id: "asc" }],
        take: limit + 1,
        ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
        select: CLIENT_SELECT,
      });
      const hasMore = rows.length > limit;
      const page = hasMore ? rows.slice(0, limit) : rows;
      // clinica-7 · UNA lectura de clave para la página entera.
      const dek = await dekParaNotas(auth.tenantId);
      return {
        items: page.map((c) => toClientView(c, dek)),
        nextCursor: hasMore ? page[page.length - 1]!.id : null,
      };
    },
  );

  // ── Alta ────────────────────────────────────────────────────────────
  app.post(
    "/clients",
    {
      preHandler: requireOwnerOrCashier,
      schema: {
        body: {
          type: "object",
          // B-reservas-mostrador F3 · `lastName` sale de `required`. Decisión
          // de dirección: Sole apunta a sus clientas por el nombre de pila, y
          // exigir un apellido obliga a inventárselo. La columna sigue siendo
          // NOT NULL y un cliente sin apellidos guarda "" — sin migración.
          required: ["firstName"],
          additionalProperties: false,
          properties: {
            // Idempotencia del alta offline (outbox). Si ya existe un
            // cliente con este externalId en el tenant, se devuelve tal
            // cual (200) en vez de duplicar.
            externalId: { type: "string", format: "uuid" },
            firstName: { type: "string", minLength: 1, maxLength: 120 },
            lastName: { type: "string", maxLength: 120 },
            phone: { type: "string", maxLength: 32 },
            email: { type: "string", maxLength: 320 },
            // YYYY-MM-DD (@db.Date).
            birthdate: { type: "string", format: "date" },
            holdedContactId: { type: "string", maxLength: 64 },
            marketingOptIn: { type: "boolean" },
            notes: { type: "string", maxLength: 2000 },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const body = request.body as {
        externalId?: string;
        firstName: string;
        lastName?: string;
        phone?: string;
        email?: string;
        birthdate?: string;
        holdedContactId?: string;
        marketingOptIn?: boolean;
        notes?: string;
      };
      const prisma = getPrisma();

      // Idempotencia: si el outbox reintenta el alta, no dupliques.
      if (body.externalId) {
        const existing = await prisma.client.findFirst({
          where: { tenantId: auth.tenantId, externalId: body.externalId },
          select: CLIENT_SELECT,
        });
        if (existing) {
          return reply
            .code(200)
            .send({
              client: toClientView(
                existing,
                await dekParaNotas(auth.tenantId),
              ),
              duplicate: true,
            });
        }
      }

      // Aviso de teléfono duplicado (no bloqueante — familias comparten
      // número; ADR-R2 no impone unicidad de teléfono). El front decide
      // si mostrar el aviso.
      let phoneWarning: Array<{ id: string; name: string }> | null = null;
      const phone = body.phone?.trim();
      if (phone) {
        const dups = await prisma.client.findMany({
          where: { tenantId: auth.tenantId, phone },
          select: { id: true, firstName: true, lastName: true },
          take: 5,
        });
        if (dups.length > 0) {
          phoneWarning = dups.map((d) => ({
            id: d.id,
            name: `${d.firstName} ${d.lastName}`.trim(),
          }));
        }
      }

      // clinica-7 · decisión 10 · en un tenant clínico la nota de la ficha
      // se guarda CIFRADA. El id se genera aquí porque el AAD lo necesita
      // (ver la cabecera de `cripto-campos.ts`).
      const idCliente = nuevoIdDeFila();
      const nota = await notaParaGuardar({
        tenantId: auth.tenantId,
        id: idCliente,
        que: "FICHA",
        texto: body.notes,
      });
      const dekDeLaNota = await dekParaNotas(auth.tenantId);

      const created = await prisma.client.create({
        data: {
          id: idCliente,
          tenantId: auth.tenantId,
          externalId: body.externalId ?? null,
          firstName: body.firstName.trim(),
          lastName: body.lastName?.trim() ?? "",
          phone: phone || null,
          email: body.email?.trim() || null,
          birthdate: body.birthdate ? new Date(body.birthdate) : null,
          holdedContactId: body.holdedContactId?.trim() || null,
          marketingOptIn: body.marketingOptIn ?? false,
          notes: nota.claro,
          notesCifradas: nota.cifrado,
        },
        select: CLIENT_SELECT,
      });
      return reply.code(201).send({
        client: toClientView(created, dekDeLaNota),
        ...(phoneWarning ? { phoneWarning } : {}),
      });
    },
  );

  // ── B-reservas-mostrador F6 · el contacto de Holded se hace cliente ──
  //
  // Un solo endpoint, idempotente, porque la alternativa (buscar desde el
  // front y crear si no está) deja un hueco entre las dos llamadas por el que
  // caben dos toques seguidos o dos terminales. Cómo se garantiza el «uno y
  // sólo uno» sin hacer único el índice: ver `from-contact.ts`.
  app.post(
    "/clients/from-contact/:contactId",
    {
      preHandler: requireOwnerOrCashier,
      schema: {
        params: {
          type: "object",
          required: ["contactId"],
          additionalProperties: false,
          properties: {
            // El id de la FILA `Contact` (uuid del tenant), no el
            // `holdedContactId`: valida la pertenencia al tenant de un golpe.
            contactId: { type: "string", format: "uuid" },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const { contactId } = request.params as { contactId: string };
      const prisma = getPrisma();

      const contacto = await prisma.contact.findFirst({
        where: { id: contactId, tenantId: auth.tenantId },
        select: {
          holdedContactId: true,
          name: true,
          email: true,
          phone: true,
          type: true,
        },
      });
      if (!contacto) {
        return reply.code(404).send({
          error: "CONTACT_NOT_FOUND",
          message: "Ese contacto no existe.",
        });
      }
      // El filtro de tipo NO puede vivir sólo en la búsqueda: si viviera sólo
      // allí, quien llamara al endpoint a mano podría enlazar un proveedor y
      // meterlo en la agenda como clienta.
      if (!esContactoDeCliente(contacto.type)) {
        return reply.code(409).send({
          error: "CONTACT_NOT_CLIENT",
          message: `«${contacto.name}» no es un cliente en Holded.`,
        });
      }

      const { client, created } = await enlazarContacto<
        Parameters<typeof toClientView>[0]
      >(
        comoPrismaParaEnlace(prisma),
        auth.tenantId,
        {
          holdedContactId: contacto.holdedContactId,
          name: contacto.name,
          email: contacto.email,
          phone: contacto.phone,
        },
        CLIENT_SELECT,
      );

      return reply
        .code(created ? 201 : 200)
        .send({
          client: toClientView(client, await dekParaNotas(auth.tenantId)),
          created,
        });
    },
  );

  // ── Ficha completa ──────────────────────────────────────────────────
  //
  // clinica-1 · LA FICHA TÉCNICA DEJA DE SALIR EN UN TENANT CLÍNICO.
  //
  // `ClientTechnicalNote` nació neutra: vale para la fórmula de color de
  // una peluquería y para los parámetros de un tratamiento. En una clínica
  // lo segundo es dato de salud (art. 9 RGPD), y hoy este endpoint lo
  // devuelve a cualquier rol — una recepcionista lo leería entero.
  //
  // Así que: con `clinicalRecordsEnabled` encendido, las notas sólo salen
  // para quien la función de acceso diga que puede ver la historia de ESE
  // paciente. En el resto de tenants —Sole y todos los de hoy— no cambia
  // absolutamente nada, porque la función contesta "clínica apagada" sin
  // consultar nada más y el camino es el de siempre.
  //
  // `technicalNotesHidden` en la respuesta: un array vacío y un array
  // escondido no son lo mismo, y la ficha tiene que poder decir «esto está
  // en la historia clínica» en vez de parecer que no hay nada. Campo
  // nuevo y opcional — contrato aditivo, ningún cliente viejo se rompe.
  //
  // Lo que NO se hizo aquí, y va dicho en el done: **no se apunta una
  // línea en el registro de accesos.** Este endpoint es la ficha del
  // cliente, por la que pasa la cajera cincuenta veces al día para coger
  // un teléfono; apuntar un DENIED por cada una llenaría de ruido la lista
  // de «quién ha abierto la historia de este paciente» justamente con lo
  // que no es un intento de abrirla. El registro cubre las rutas
  // clínicas, que es donde vive la historia.
  app.get(
    "/clients/:id",
    { preHandler: requireOwnerOrCashier },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const { id } = request.params as { id: string };
      const client = await loadOwnedClient(auth.tenantId, id);
      if (!client) return notFound(reply);
      const prisma = getPrisma();
      const [consents, technicalNotes, acceso] = await Promise.all([
        prisma.clientConsent.findMany({
          where: { clientId: id, tenantId: auth.tenantId },
          orderBy: { grantedAt: "desc" },
          select: { id: true, kind: true, grantedAt: true, docRef: true },
        }),
        prisma.clientTechnicalNote.findMany({
          where: { clientId: id, tenantId: auth.tenantId },
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            serviceId: true,
            body: true,
            bodyCifrado: true,
            createdByUserId: true,
            createdAt: true,
          },
        }),
        resolverAccesoClinico(comoPrismaParaAcceso(prisma), {
          tenantId: auth.tenantId,
          userId: auth.userId,
          clientId: id,
        }),
      ]);
      // Esconder sólo cuando la clínica está encendida. Un "no puede"
      // porque el módulo está apagado no esconde nada: es el camino de
      // siempre, y en él la ficha técnica es de la peluquería.
      const esconderFichaTecnica =
        acceso.estado.clinicaEncendida && !acceso.veredicto.puede;
      // clinica-7 · UNA lectura de clave para la ficha y sus notas
      // técnicas.
      const dekDeLasNotas = await dekParaNotas(auth.tenantId);
      return {
        client: toClientView(client, dekDeLasNotas),
        consents: consents.map((c) => ({
          id: c.id,
          kind: c.kind,
          grantedAt: c.grantedAt.toISOString(),
          docRef: c.docRef,
        })),
        technicalNotes: esconderFichaTecnica
          ? []
          : technicalNotes.map((n) => ({
              id: n.id,
              serviceId: n.serviceId,
              // clinica-7 · en una clínica, «los parámetros del
              // tratamiento» son dato de salud y van cifrados.
              body: leerNota(
                {
                  tenantId: auth.tenantId,
                  id: n.id,
                  que: "TECNICA",
                  claro: n.body,
                  cifrado: n.bodyCifrado,
                },
                dekDeLasNotas,
              ),
              createdByUserId: n.createdByUserId,
              createdAt: n.createdAt.toISOString(),
            })),
        technicalNotesHidden: esconderFichaTecnica,
      };
    },
  );

  // ── Edición ─────────────────────────────────────────────────────────
  app.patch(
    "/clients/:id",
    {
      preHandler: requireOwnerOrCashier,
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          properties: {
            firstName: { type: "string", minLength: 1, maxLength: 120 },
            // B-reservas-mostrador F3 · sin `minLength`: se puede BORRAR el
            // apellido de una ficha, no sólo dejarlo sin poner al crearla.
            lastName: { type: "string", maxLength: 120 },
            phone: { type: ["string", "null"], maxLength: 32 },
            email: { type: ["string", "null"], maxLength: 320 },
            birthdate: { type: ["string", "null"], format: "date" },
            holdedContactId: { type: ["string", "null"], maxLength: 64 },
            marketingOptIn: { type: "boolean" },
            notes: { type: ["string", "null"], maxLength: 2000 },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const { id } = request.params as { id: string };
      const body = request.body as {
        firstName?: string;
        lastName?: string;
        phone?: string | null;
        email?: string | null;
        birthdate?: string | null;
        holdedContactId?: string | null;
        marketingOptIn?: boolean;
        notes?: string | null;
      };
      const existing = await loadOwnedClient(auth.tenantId, id);
      if (!existing) return notFound(reply);
      const prisma = getPrisma();

      const data: Prisma.ClientUpdateInput = {};
      if (body.firstName !== undefined) data.firstName = body.firstName.trim();
      if (body.lastName !== undefined) data.lastName = body.lastName.trim();
      if (body.phone !== undefined) data.phone = body.phone?.trim() || null;
      if (body.email !== undefined) data.email = body.email?.trim() || null;
      if (body.birthdate !== undefined)
        data.birthdate = body.birthdate ? new Date(body.birthdate) : null;
      if (body.holdedContactId !== undefined)
        data.holdedContactId = body.holdedContactId?.trim() || null;
      if (body.marketingOptIn !== undefined)
        data.marketingOptIn = body.marketingOptIn;
      // clinica-7 · la nota se vuelve a cifrar con el id de ESTA fila.
      // `dekDeLaNota` se resuelve igual haya nota o no: lo usa la vista
      // para descifrar la que ya había.
      const dekDeLaNota = await dekParaNotas(auth.tenantId);
      if (body.notes !== undefined) {
        const nota = await notaParaGuardar({
          tenantId: auth.tenantId,
          id,
          que: "FICHA",
          texto: body.notes,
        });
        data.notes = nota.claro;
        data.notesCifradas = nota.cifrado;
      }

      const updated = await prisma.client.update({
        where: { id },
        data,
        select: CLIENT_SELECT,
      });
      return { client: toClientView(updated, dekDeLaNota) };
    },
  );

  // ── Historial unificado ─────────────────────────────────────────────
  // Compras (tickets del contacto Holded enlazado) + citas (vacío hasta
  // B4) + movimientos de bono (vacío hasta B5). Array único ordenado por
  // fecha desc, cada entrada con `kind` para que B4/B5 añadan sus tipos
  // sin romper el contrato del front. Cada entrada es trazable a su
  // origen (ticketId / internalNumber) — principio UX de auditabilidad.
  app.get(
    "/clients/:id/history",
    { preHandler: requireOwnerOrCashier },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const { id } = request.params as { id: string };
      const client = await loadOwnedClient(auth.tenantId, id);
      if (!client) return notFound(reply);
      const prisma = getPrisma();

      const purchases = client.holdedContactId
        ? await prisma.ticket.findMany({
            where: {
              tenantId: auth.tenantId,
              contactHoldedId: client.holdedContactId,
              status: { in: ["PAID", "PENDING_SYNC", "SYNCED", "SYNC_FAILED"] },
            },
            orderBy: { createdAt: "desc" },
            take: 100,
            select: {
              id: true,
              internalNumber: true,
              total: true,
              status: true,
              holdedDocNumber: true,
              createdAt: true,
              paidAt: true,
            },
          })
        : [];

      const purchaseEntries = purchases.map((t) => ({
        kind: "PURCHASE" as const,
        id: t.id,
        at: (t.paidAt ?? t.createdAt).toISOString(),
        // Trazabilidad al origen.
        ticketId: t.id,
        internalNumber: t.internalNumber,
        holdedDocNumber: t.holdedDocNumber,
        status: t.status,
        total: Number(t.total),
      }));

      // B-reservas-4: citas del cliente (contrato `kind:"APPOINTMENT"` que B1
      // dejó reservado). Reutiliza la capa de acceso de la agenda.
      const appts = await createAgendaStore(prisma).listForClient(
        auth.tenantId,
        id,
      );
      const appointmentEntries = appts.map((a) => ({
        kind: "APPOINTMENT" as const,
        id: a.id,
        at: a.start,
        end: a.end,
        status: a.status,
        ticketId: a.ticketId,
        serviceIds: a.items.map((it) => it.serviceId),
      }));

      // Array unificado ordenado por fecha desc (compras + citas).
      const entries = [...purchaseEntries, ...appointmentEntries].sort((x, y) =>
        y.at.localeCompare(x.at),
      );

      // B-reservas-8 · EL LIBRO de los bonos de esta ficha, legible: qué
      // cita apartó, qué ticket consumió, quién corrigió y por qué. Mismo
      // contrato que ya publicaba (`voucherMovements[]`), ahora con filas.
      //
      // Sin dinero en ninguna de ellas: el libro de un bono habla de
      // sesiones, y el cobro vive en el ticket que enlaza.
      const voucherMovements = (await bonosIsEnabled(auth.tenantId))
        ? await libroDeLaFicha(prisma, auth.tenantId, id)
        : [];

      return {
        entries,
        // `appointments[]` estable (además del unificado en `entries`).
        appointments: appointmentEntries,
        voucherMovements,
      };
    },
  );

  // ── Saldo de bonos ─────────────────────────────────────────────────
  //
  // B-reservas-8 · **relleno de verdad, y con el MISMO contrato que ya
  // publicaba.** Las dos claves de arriba (`balance.sessionsLeft`,
  // `balance.amountLeftCents` y `vouchers[]`) estaban desde B-reservas-1 y
  // el front ya las leía pintando «0» y vacío; cambiarlas habría roto a un
  // cliente por un nombre.
  //
  // `amountLeftCents` sigue valiendo 0 siempre y seguirá hasta B-cheques:
  // es el saldo por IMPORTE, que este bloque no construye. Se queda a cero
  // y no se quita, por lo mismo.
  //
  // ── Y el sanitario sin caja ─────────────────────────────────────────
  //
  // Ve sesiones y **ningún euro**. No se oculta en el front: NO SE MANDA
  // (`vouchers/vistas.ts`). Un test vuelca este JSON y busca claves y
  // valores de dinero.
  //
  // Con el módulo APAGADO se contesta lo de siempre —saldo cero y lista
  // vacía— y no un 404: esta ruta es del CRM y su contrato no depende de
  // que el negocio haya contratado los bonos.
  app.get(
    "/clients/:id/vouchers",
    { preHandler: requireOwnerOrCashier },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const { id } = request.params as { id: string };
      const client = await loadOwnedClient(auth.tenantId, id);
      if (!client) return notFound(reply);
      if (!(await bonosIsEnabled(auth.tenantId))) {
        return {
          balance: { sessionsLeft: 0, amountLeftCents: 0 },
          vouchers: [] as unknown[],
        };
      }
      const prisma = getPrisma();
      const ahora = new Date();
      const filas = await bonosDeLaFicha(prisma, auth.tenantId, id, ahora);
      const sinDinero = await esSanitarioSinCaja(request);
      // El saldo agregado NO cuenta los de prueba (`07` pieza 17: lo de
      // prueba sale de los informes de gestión) ni los muertos.
      const vivos = filas.filter(
        (f) => !f.esPrueba && f.status !== "ANULADO" && f.status !== "CADUCADO",
      );
      return {
        balance: {
          sessionsLeft: vivos.reduce((acc, f) => acc + f.sessionsLeft, 0),
          // B-cheques. Cero hasta entonces, y el contrato lo lleva.
          amountLeftCents: 0,
        },
        vouchers: filas.map((f) =>
          sinDinero ? bonoSinDinero(f) : bonoConDinero(f),
        ),
      };
    },
  );

  // ── Alta manual de consentimiento RGPD ──────────────────────────────
  app.post(
    "/clients/:id/consents",
    {
      preHandler: requireOwnerOrCashier,
      schema: {
        body: {
          type: "object",
          required: ["kind"],
          additionalProperties: false,
          properties: {
            kind: { type: "string", enum: ["DATA", "TREATMENT"] },
            docRef: { type: "string", maxLength: 500 },
            grantedAt: { type: "string", format: "date-time" },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const { id } = request.params as { id: string };
      const body = request.body as {
        kind: "DATA" | "TREATMENT";
        docRef?: string;
        grantedAt?: string;
      };
      const client = await loadOwnedClient(auth.tenantId, id);
      if (!client) return notFound(reply);
      const prisma = getPrisma();
      const consent = await prisma.clientConsent.create({
        data: {
          tenantId: auth.tenantId,
          clientId: id,
          kind: ClientConsentKind[body.kind],
          docRef: body.docRef?.trim() || null,
          ...(body.grantedAt ? { grantedAt: new Date(body.grantedAt) } : {}),
        },
        select: { id: true, kind: true, grantedAt: true, docRef: true },
      });
      return reply.code(201).send({
        consent: {
          id: consent.id,
          kind: consent.kind,
          grantedAt: consent.grantedAt.toISOString(),
          docRef: consent.docRef,
        },
      });
    },
  );

  // ── Alta de ficha técnica por servicio ──────────────────────────────
  //
  // clinica-1 · simétrico a la lectura: en un tenant clínico, quien no
  // puede VER la ficha técnica de un paciente tampoco puede ESCRIBIRLA.
  // Sin esto, una recepcionista no podría leerla y sí añadirle una línea,
  // que es la mitad peor de las dos.
  app.post(
    "/clients/:id/technical-notes",
    {
      preHandler: requireOwnerOrCashier,
      schema: {
        body: {
          type: "object",
          required: ["body"],
          additionalProperties: false,
          properties: {
            // id de servicio de Holded (no FK dura). Opcional: una nota
            // general no tiene servicio asociado.
            serviceId: { type: "string", maxLength: 64 },
            body: { type: "string", minLength: 1, maxLength: 4000 },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const { id } = request.params as { id: string };
      const body = request.body as { serviceId?: string; body: string };
      const client = await loadOwnedClient(auth.tenantId, id);
      if (!client) return notFound(reply);
      const prisma = getPrisma();
      const acceso = await resolverAccesoClinico(
        comoPrismaParaAcceso(prisma),
        { tenantId: auth.tenantId, userId: auth.userId, clientId: id },
      );
      const veredicto = acceso.veredicto;
      if (acceso.estado.clinicaEncendida && !veredicto.puede) {
        return reply.code(403).send({
          error: veredicto.motivo,
          code: veredicto.motivo,
          message: veredicto.mensaje,
        });
      }
      // clinica-7 · en un tenant clínico la ficha técnica va CIFRADA: en
      // peluquería esto es la fórmula del color, y en una clínica son los
      // parámetros del tratamiento.
      const idNota = nuevoIdDeFila();
      const nota = await notaParaGuardar({
        tenantId: auth.tenantId,
        id: idNota,
        que: "TECNICA",
        texto: body.body,
      });
      const note = await prisma.clientTechnicalNote.create({
        data: {
          id: idNota,
          tenantId: auth.tenantId,
          clientId: id,
          serviceId: body.serviceId?.trim() || null,
          // `body` es NOT NULL desde B1, así que en un tenant clínico va
          // la cadena vacía y el dato vive en `bodyCifrado`. Quitarle el
          // NOT NULL habría sido aflojar una garantía para esto.
          body: nota.claro ?? "",
          bodyCifrado: nota.cifrado,
          createdByUserId: auth.userId,
        },
        select: {
          id: true,
          serviceId: true,
          body: true,
          bodyCifrado: true,
          createdByUserId: true,
          createdAt: true,
        },
      });
      return reply.code(201).send({
        technicalNote: {
          id: note.id,
          serviceId: note.serviceId,
          // Lo que entró, no lo que hay en la columna en claro.
          body: body.body.trim(),
          createdByUserId: note.createdByUserId,
          createdAt: note.createdAt.toISOString(),
        },
      });
    },
  );
}
