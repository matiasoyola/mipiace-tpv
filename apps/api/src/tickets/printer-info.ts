// v1.4-Impresoras-Fase-1 Lote 3 · info de la impresora del register
// para el TPV.
//
//   GET /tpv/printer-info?section=ticket|barra|cocina|salon
//     → devuelve el PrinterConfig activo para esa "sección" en el
//       register del cajero, o `null` si no hay ninguno configurado.
//       section=ticket equivale a `section IS NULL` (ticket de cobro).
//
// El TPV consulta este endpoint al pintar el botón "Imprimir ticket"
// para decidir si propone flujo USB (WebUSB) o WIFI (TCP backend).

import type { FastifyInstance } from "fastify";

import { getPrisma } from "../context.js";
import { requireCashierSession } from "../shift/cashier-session.js";

type SectionParam = "ticket" | "barra" | "cocina" | "salon";

export async function registerTpvPrinterInfoRoute(
  app: FastifyInstance,
): Promise<void> {
  app.get(
    "/tpv/printer-info",
    {
      preHandler: requireCashierSession,
      schema: {
        querystring: {
          type: "object",
          properties: {
            section: {
              type: "string",
              enum: ["ticket", "barra", "cocina", "salon"],
              default: "ticket",
            },
          },
        },
      },
    },
    async (request) => {
      const cashier = request.cashier!;
      const { section = "ticket" } = request.query as { section?: SectionParam };
      const prisma = getPrisma();
      const dbSection =
        section === "ticket"
          ? null
          : (section.toUpperCase() as "BARRA" | "COCINA" | "SALON");
      const cfg = await prisma.printerConfig.findFirst({
        where: {
          registerId: cashier.rid,
          active: true,
          section: dbSection,
        },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          name: true,
          mode: true,
          section: true,
        },
      });
      return { printer: cfg };
    },
  );
}
