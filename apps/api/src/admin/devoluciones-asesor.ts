// holded-desconectar · las devoluciones que el asesor tiene que documentar
// a mano. ADR-020, criterio 5 del bloque.
//
// ── El problema, en dos casos ──────────────────────────────────────────
//
// Después del corte, una devolución puede ser de dos cosas muy distintas, y
// las DOS acaban sin documento de abono:
//
//   (a) **Un ticket cobrado ANTES del corte.** Lo facturó Holded y tiene su
//       `holded_document_id`. El abono ya no sube a Holded —no hay clave,
//       no hay fila `HoldedUpload`, el trigger lo impediría igual—, así que
//       la contabilidad del cliente se queda con una factura sin su abono.
//   (b) **Un ticket cobrado DESPUÉS del corte.** Es una factura simplificada
//       VERI*FACTU emitida por mipiacetpv. Su abono sería una FACTURA
//       RECTIFICATIVA, y las rectificativas son V3 (verifactu-1-done §9):
//       no están construidas.
//
// En los dos casos el dinero SÍ sale del cajón y el arqueo SÍ cuadra: el
// `Refund` se crea, su método de pago se descuenta del turno y el Z lo
// cuenta. Eso ya funcionaba desde `catalogo-local` y este fichero no lo
// toca. Lo que faltaba era que el caso no se perdiera.
//
// ── Por qué NO hay columna nueva ───────────────────────────────────────
//
// Todo esto es DERIVABLE de lo que ya está escrito, y una columna sería un
// segundo sitio donde la verdad podría desviarse del hecho:
//
//   · «después del corte» = `refund.created_at >= tenant.holded_disconnected_at`.
//   · «lo facturó Holded» = el ticket original tiene `holded_document_id`.
//   · «lo facturó mipiacetpv» = hay un `FiscalRecord` de su caja para ese
//     ticket. No se deduce de la fecha: un ticket cobrado después del corte
//     por un terminal con la APK vieja NO trae registro, y ése es un tercer
//     caso que el asesor tiene que ver COMO LO QUE ES.
//
// Es el mismo criterio de ADR-017 §6: la garantía la sostiene la ausencia o
// la presencia de un dato, no que alguien se acuerde de escribir un flag.

import type { FastifyInstance } from "fastify";

import { requireOwnerOrManager } from "../auth/middleware.js";
import { getPrisma } from "../context.js";
import { ensureCajaEnabled } from "../lib/caja-gate.js";

/** Quién emitió la factura que esta devolución abona. */
export type OrigenDeLaFactura =
  /** Holded, antes del corte. El asesor crea el abono en Holded. */
  | "holded"
  /** mipiacetpv, factura simplificada VERI*FACTU. Falta la rectificativa. */
  | "mipiacetpv"
  /** Ni una cosa ni la otra: cobrado después del corte y SIN registro
   *  fiscal. Es un terminal con APK anterior a verifactu-1, y eso el asesor
   *  tiene que verlo. */
  | "sin_registro";

export interface DevolucionParaElAsesor {
  refundId: string;
  numero: string;
  fecha: string;
  total: string;
  motivo: string | null;
  metodo: string | null;
  origen: OrigenDeLaFactura;
  ticket: {
    id: string;
    numero: string;
    fecha: string;
    /** El documento de Holded que hay que abonar allí, si lo hubo. */
    holdedDocNumber: string | null;
    holdedDocumentId: string | null;
    /** La factura simplificada nuestra, si la hubo. */
    facturaSimplificada: string | null;
  };
  /** Qué tiene que hacer el asesor, en una frase. */
  queHacer: string;
}

const QUE_HACER: Record<OrigenDeLaFactura, string> = {
  holded:
    "Esta venta la facturó Holded antes del corte. Crea allí la factura rectificativa / el abono " +
    "contra el documento indicado. mipiacetpv ya no escribe en Holded.",
  mipiacetpv:
    "Esta venta es una factura simplificada emitida por mipiacetpv. Su rectificativa todavía no la " +
    "emite el sistema: documéntala en la contabilidad con el número de la factura original.",
  sin_registro:
    "Esta venta se cobró después del corte y NO generó registro de facturación: el terminal tenía " +
    "una versión anterior a verifactu-1. Revisa la versión del terminal además de documentar el abono.",
};

export async function registerDevolucionesAsesorRoutes(
  app: FastifyInstance,
): Promise<void> {
  // ── GET /admin/devoluciones/para-el-asesor ──────────────────────────
  //
  // Devuelve vacío y `aplica: false` en cualquier comercio que no haya
  // dejado Holded, en vez de 404 o 409: la pantalla que lo consume se monta
  // desde la navegación y un error haría que pareciera rota. Lo que este
  // listado dice de un comercio normal es «aquí no hay nada de esto», y eso
  // es una respuesta, no un fallo.
  app.get(
    "/admin/devoluciones/para-el-asesor",
    {
      preHandler: [requireOwnerOrManager, ensureCajaEnabled],
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            desde: { type: "string", format: "date-time" },
            hasta: { type: "string", format: "date-time" },
          },
        },
      },
    },
    async (request) => {
      const auth = request.auth!;
      const { desde, hasta } = request.query as { desde?: string; hasta?: string };
      const prisma = getPrisma();

      const tenant = await prisma.tenant.findUniqueOrThrow({
        where: { id: auth.tenantId },
        select: { holdedDisconnectedAt: true },
      });
      const corte = tenant.holdedDisconnectedAt;
      if (corte == null) {
        return {
          aplica: false,
          holdedDisconnectedAt: null,
          devoluciones: [],
          resumen: { holded: 0, mipiacetpv: 0, sin_registro: 0, total: "0.00" },
        };
      }

      // El suelo de la ventana es SIEMPRE el corte, pase lo que pase en el
      // filtro: una devolución anterior al corte sí subió a Holded (o
      // bloqueó la acción hasta resolverse) y no es asunto de este listado.
      const desdeFecha = desde != null && new Date(desde) > corte ? new Date(desde) : corte;

      const refunds = await prisma.refund.findMany({
        where: {
          tenantId: auth.tenantId,
          createdAt: {
            gte: desdeFecha,
            ...(hasta != null ? { lte: new Date(hasta) } : {}),
          },
          // Los abonos de PRUEBA no cuentan: no son dinero de nadie.
          status: { notIn: ["TEST", "VOIDED", "DRAFT"] },
        },
        orderBy: { createdAt: "desc" },
        take: 1000,
        select: {
          id: true,
          internalNumber: true,
          createdAt: true,
          total: true,
          reason: true,
          method: true,
          originalTicket: {
            select: {
              id: true,
              internalNumber: true,
              createdAt: true,
              holdedDocNumber: true,
              holdedDocumentId: true,
              // `fiscalRecords` es una LISTA porque el ALTA y la
              // ANULACIÓN de la misma venta cuelgan de ella. Lo que
              // identifica la factura que se está abonando es el ALTA.
              fiscalRecords: {
                where: { kind: "ALTA" },
                select: { numSerieFactura: true },
                take: 1,
              },
            },
          },
        },
      });

      const devoluciones: DevolucionParaElAsesor[] = refunds.map((r) => {
        const t = r.originalTicket;
        // El orden de las tres preguntas ES la decisión. Se pregunta
        // primero por Holded porque una venta anterior al corte NO puede
        // tener registro fiscal (`emiteMipiacetpv` era false entonces), así
        // que si hay `holded_document_id` el caso está cerrado. Sólo
        // después se mira si hay registro nuestro, y la ausencia de los dos
        // es el tercer caso y no «el segundo por defecto».
        const origen: OrigenDeLaFactura =
          t.holdedDocumentId != null
            ? "holded"
            : t.fiscalRecords.length > 0
              ? "mipiacetpv"
              : "sin_registro";
        return {
          refundId: r.id,
          numero: r.internalNumber,
          fecha: r.createdAt.toISOString(),
          total: r.total.toFixed(2),
          motivo: r.reason,
          metodo: r.method,
          origen,
          ticket: {
            id: t.id,
            numero: t.internalNumber,
            fecha: t.createdAt.toISOString(),
            holdedDocNumber: t.holdedDocNumber,
            holdedDocumentId: t.holdedDocumentId,
            // El literal completo (`C1/000123`), que es lo que va en el
            // papel y en el QR. Se guarda entero en `numSerieFactura`
            // justamente para no recomponerlo a trozos en otro sitio.
            facturaSimplificada: t.fiscalRecords[0]?.numSerieFactura ?? null,
          },
          queHacer: QUE_HACER[origen],
        };
      });

      const resumen = {
        holded: devoluciones.filter((d) => d.origen === "holded").length,
        mipiacetpv: devoluciones.filter((d) => d.origen === "mipiacetpv").length,
        sin_registro: devoluciones.filter((d) => d.origen === "sin_registro").length,
        total: devoluciones
          .reduce((acc, d) => acc + Number(d.total), 0)
          .toFixed(2),
      };

      return {
        aplica: true,
        holdedDisconnectedAt: corte.toISOString(),
        devoluciones,
        resumen,
      };
    },
  );
}
