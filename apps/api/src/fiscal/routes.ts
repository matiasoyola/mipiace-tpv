// Las rutas del módulo fiscal (V1-verifactu, ADR-019).
//
//   GET  /tpv/fiscal/head            — todo lo que el terminal necesita para
//                                      generar el siguiente registro.
//   POST /tickets/:ticketId/fiscal-void
//                                    — anular una venta ya facturada.
//   GET  /admin/fiscal/chains        — el estado de las cadenas del comercio.
//   GET  /super-admin/tenants/:id/fiscal — lo mismo para el super-admin, con
//                                      el detalle de lo que no encadena.

import type { FastifyInstance } from "fastify";

import { getPrisma } from "../context.js";
import { requireOwnerOrManager } from "../auth/middleware.js";
import { requireCashierSession } from "../shift/cashier-session.js";
import { ensureCajaEnabled } from "../lib/caja-gate.js";
import { getAppVersion } from "../version.js";
import { requireSuperAdmin } from "../superadmin/middleware.js";

import { chainSummary, readChainHead, verifyChain } from "./chain.js";
import { entornoAeat } from "./entorno.js";
import { ingestFiscalRecord } from "./ingest.js";
import { emiteMipiacetpv, leerIdentidadFiscal } from "./mode.js";
import { FISCAL_RECORD_BODY_SCHEMA, type FiscalRecordBody } from "./payload.js";

export async function registerFiscalRoutes(app: FastifyInstance): Promise<void> {
  // ── El terminal ──────────────────────────────────────────────────────
  //
  // Una sola llamada con TODO lo que hace falta para generar el siguiente
  // registro: quién emite, con qué serie, en qué instalación, contra qué
  // entorno de la AEAT, y por dónde va la cadena.
  //
  // Va junto y no en cuatro endpoints porque el terminal lo cachea y tiene
  // que cobrar sin red: cuatro llamadas son cuatro formas de quedarse a
  // medias.
  app.get(
    "/tpv/fiscal/head",
    { preHandler: [requireCashierSession, ensureCajaEnabled] },
    async (request) => {
      const cashier = request.cashier!;
      const prisma = getPrisma();
      const tenant = await prisma.tenant.findUniqueOrThrow({
        where: { id: cashier.tid },
        select: {
          name: true,
          fiscalProfile: true,
          holdedEnabled: true,
          businessType: true,
        },
      });
      if (!emiteMipiacetpv(tenant)) {
        // El comercio con Holded no genera nada. Se le dice explícitamente
        // en vez de devolver un 404: el terminal necesita distinguir «aquí
        // no se emite» de «no he podido preguntar».
        return { emite: false as const };
      }
      const register = await prisma.register.findUniqueOrThrow({
        where: { id: cashier.rid },
        select: { fiscalSeries: true, fiscalInstallationId: true },
      });
      const identidad = leerIdentidadFiscal(tenant);
      const cabeza = await readChainHead(prisma, cashier.rid);
      return {
        emite: true as const,
        // `null` en cualquiera de estos tres es un comercio encendido con
        // un dato a medias. NO se convierte en un error: el terminal cobra
        // igual y el registro quedará marcado (§ ingest). Una invariante
        // rota nunca tumba una venta.
        nif: identidad?.nif ?? null,
        razonSocial: identidad?.razonSocial ?? null,
        serie: register.fiscalSeries,
        numeroInstalacion: register.fiscalInstallationId,
        version: getAppVersion(),
        entorno: entornoAeat(),
        businessType: tenant.businessType,
        cabeza,
      };
    },
  );

  // ── Anular una venta ya facturada ────────────────────────────────────
  //
  // No borra nada: añade un registro de ANULACIÓN a la cadena de la caja.
  // El registro lo genera el TERMINAL, igual que el de alta, y llega aquí
  // dentro del cuerpo — por el mismo motivo de siempre (FAQ §5: un registro
  // y su factura son el mismo acto).
  app.post(
    "/tickets/:ticketId/fiscal-void",
    {
      preHandler: [requireCashierSession, ensureCajaEnabled],
      schema: {
        params: {
          type: "object",
          required: ["ticketId"],
          properties: { ticketId: { type: "string", format: "uuid" } },
        },
        body: {
          type: "object",
          required: ["fiscalRecord"],
          additionalProperties: false,
          properties: { fiscalRecord: FISCAL_RECORD_BODY_SCHEMA },
        },
      },
    },
    async (request, reply) => {
      const cashier = request.cashier!;
      const { ticketId } = request.params as { ticketId: string };
      const { fiscalRecord } = request.body as {
        fiscalRecord: FiscalRecordBody;
      };
      const prisma = getPrisma();

      if (fiscalRecord.kind !== "ANULACION") {
        return reply.code(400).send({
          error: "FISCAL_RECORD_KIND",
          message: "Esta ruta sólo acepta un registro de anulación.",
        });
      }

      const tenant = await prisma.tenant.findUniqueOrThrow({
        where: { id: cashier.tid },
        select: { holdedEnabled: true },
      });
      if (!emiteMipiacetpv(tenant)) {
        return reply.code(409).send({
          error: "FISCAL_MODE_OFF",
          message:
            "Este comercio no emite sus propias facturas: el emisor es Holded.",
        });
      }

      const alta = await prisma.fiscalRecord.findFirst({
        where: {
          ticketId,
          tenantId: cashier.tid,
          registerId: cashier.rid,
          kind: "ALTA",
        },
        select: { id: true, numSerieFactura: true },
      });
      if (!alta) {
        return reply.code(404).send({
          error: "FACTURA_NO_ENCONTRADA",
          message: "Esta venta no tiene factura emitida en esta caja.",
        });
      }
      const yaAnulada = await prisma.fiscalRecord.findFirst({
        where: { anulaRecordId: alta.id },
        select: { id: true },
      });
      if (yaAnulada) {
        return reply.code(409).send({
          error: "FACTURA_YA_ANULADA",
          message: `La factura ${alta.numSerieFactura} ya está anulada.`,
        });
      }

      const resultado = await prisma.$transaction((tx) =>
        ingestFiscalRecord({
          tx,
          tenantId: cashier.tid,
          registerId: cashier.rid,
          deviceId: cashier.did,
          ticketId,
          anulaRecordId: alta.id,
          body: fiscalRecord,
        }),
      );

      request.log.info(
        {
          event: "fiscal.anulacion",
          tenantId: cashier.tid,
          registerId: cashier.rid,
          ticketId,
          numSerieFactura: alta.numSerieFactura,
          chainStatus: resultado.chainStatus,
        },
        "registro de anulación guardado",
      );
      return reply.code(201).send({ fiscalRecord: resultado });
    },
  );

  // ── El panel del comercio ────────────────────────────────────────────
  app.get(
    "/admin/fiscal/chains",
    { preHandler: [requireOwnerOrManager, ensureCajaEnabled] },
    async (request) => {
      const auth = request.auth!;
      const prisma = getPrisma();
      const registers = await prisma.register.findMany({
        where: { deletedAt: null, store: { tenantId: auth.tenantId, deletedAt: null } },
        orderBy: [{ store: { name: "asc" } }, { name: "asc" }],
        select: {
          id: true,
          name: true,
          fiscalSeries: true,
          fiscalInstallationId: true,
          store: { select: { name: true } },
        },
      });
      const cadenas = [];
      for (const r of registers) {
        cadenas.push({
          registerId: r.id,
          registerName: r.name,
          storeName: r.store.name,
          serie: r.fiscalSeries,
          numeroInstalacion: r.fiscalInstallationId,
          ...(await chainSummary(prisma, r.id)),
        });
      }
      return { cadenas };
    },
  );

  // ── El super-admin ───────────────────────────────────────────────────
  //
  // Lo mismo, más el DETALLE de lo que no encadena. Es el sitio donde un
  // registro marcado tiene que verse: guardarlo y no enseñarlo sería la
  // misma ceguera que descartarlo, con más pasos.
  app.get(
    "/super-admin/tenants/:tenantId/fiscal",
    {
      preHandler: [requireSuperAdmin],
      schema: {
        params: {
          type: "object",
          required: ["tenantId"],
          properties: { tenantId: { type: "string", format: "uuid" } },
        },
      },
    },
    async (request) => {
      const { tenantId } = request.params as { tenantId: string };
      const prisma = getPrisma();
      const tenant = await prisma.tenant.findUniqueOrThrow({
        where: { id: tenantId },
        select: { holdedEnabled: true },
      });
      const registers = await prisma.register.findMany({
        where: { deletedAt: null, store: { tenantId, deletedAt: null } },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          name: true,
          fiscalSeries: true,
          fiscalInstallationId: true,
        },
      });
      const cadenas = [];
      for (const r of registers) {
        const filas = await verifyChain(prisma, r.id);
        cadenas.push({
          registerId: r.id,
          registerName: r.name,
          serie: r.fiscalSeries,
          numeroInstalacion: r.fiscalInstallationId,
          ...(await chainSummary(prisma, r.id)),
          // Sólo lo que falla. Enseñar la cadena entera de un comercio con
          // dos años de facturas no ayuda a nadie.
          fallos: filas.filter(
            (f) =>
              !f.huella_ok ||
              !f.input_ok ||
              !f.enlace_ok ||
              !f.numeracion_ok ||
              f.chain_status !== "OK",
          ),
        });
      }
      const rotos = await prisma.fiscalRecord.findMany({
        where: { tenantId, chainStatus: "BROKEN" },
        orderBy: { receivedAt: "desc" },
        take: 50,
        select: {
          id: true,
          registerId: true,
          chainIndex: true,
          numSerieFactura: true,
          chainError: true,
          generatedAt: true,
          receivedAt: true,
          deviceId: true,
        },
      });
      return {
        emite: emiteMipiacetpv(tenant),
        entorno: entornoAeat(),
        cadenas,
        rotos: rotos.map((r) => ({
          ...r,
          generatedAt: r.generatedAt.toISOString(),
          receivedAt: r.receivedAt.toISOString(),
        })),
      };
    },
  );
}
