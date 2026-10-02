// declaracion-responsable · GET /legal/declaracion-responsable(.pdf)
//
// PÚBLICAS y sin autenticación, a propósito. El art. 15 de la Orden
// HAC/1177/2024 obliga al productor a entregar la declaración responsable
// «gratuitamente» a clientes y distribuidores, en papel o en formato
// electrónico. Un documento que hay que entregar a cualquiera que lo pida no
// puede estar detrás de un login: la URL ES la entrega.
//
// Y por eso mismo NO tocan la base de datos ni leen el token: no hay tenant
// en la respuesta, no hay nada que filtrar. Es el mismo documento para todo
// el mundo — el del PRODUCTOR del sistema (nosotros), no el del comercio que
// lo usa.
//
// Nota sobre el guard de tenants bloqueados: `/legal` está en su lista de
// prefijos exentos. Sin eso, el OWNER de una cuenta bloqueada abriría la
// declaración en su panel y recibiría un 423 sobre un documento legal que
// tiene derecho a leer — el bloqueo de una cuenta es comercial, no cambia lo
// que el productor declara de su software.

import type { FastifyInstance } from "fastify";

import { renderDeclaracionResponsablePdf } from "@mipiacetpv/ticket-pdf";

import { declaracionDeEstaVersion } from "./declaracion.js";

// Cache corta y PÚBLICA (no `private`): el documento es idéntico para todos
// y sólo cambia al desplegar una versión nueva. Una hora es suficiente para
// que el panel y el TPV no le peguen al backend en cada visita, y corta para
// que un despliegue se vea el mismo día.
const CACHE_CONTROL = "public, max-age=3600";

export async function registerLegalRoutes(app: FastifyInstance): Promise<void> {
  app.get("/legal/declaracion-responsable", async (_request, reply) => {
    const declaracion = await declaracionDeEstaVersion();
    reply.header("Cache-Control", CACHE_CONTROL);
    return reply.send({ declaracion });
  });

  app.get("/legal/declaracion-responsable.pdf", async (_request, reply) => {
    const declaracion = await declaracionDeEstaVersion();
    const pdfBytes = await renderDeclaracionResponsablePdf(declaracion);
    reply.header("Content-Type", "application/pdf");
    // `inline`: el navegador lo abre en su visor y desde ahí se descarga o
    // se imprime. Un `attachment` forzaría una descarga a ciegas, y en la
    // WebView de la tablet eso es un fichero que el cajero no encuentra.
    reply.header(
      "Content-Disposition",
      'inline; filename="declaracion-responsable-mipiacetpv.pdf"',
    );
    reply.header("Cache-Control", CACHE_CONTROL);
    return reply.send(Buffer.from(pdfBytes));
  });
}
