// calidad-1 (D-75) · **LA RUTA DEL PAC Y DEL INFORME DE NC.**
//
//   · `GET /residencia/calidad/pac.pdf`      — el Plan de Acciones
//     Correctivas, filtrable por origen y periodo. Es lo que se le manda
//     a AENOR en 30 días naturales desde el informe.
//   · `GET /residencia/calidad/informe-nc.pdf` — el mismo documento con
//     el recuento del periodo y las verificaciones de eficacia dentro.
//     Es el que se lee en la revisión por la dirección.
//
// Las dos son la misma función con un `modo` distinto, y la razón está
// en la cabecera de `packages/ticket-pdf/src/pac.ts`: dos consultas
// serían dos sitios donde una NC sale en una y no en la otra.
//
// ── EL FILTRO VA IMPRESO ────────────────────────────────────────────
//
// «Todas las no conformidades de la auditoría externa detectadas entre
// el 01-07-2026 y el 31-12-2026.» Un PAC que no dice de qué auditoría es
// y entre qué fechas es un papel que el año que viene nadie sabe
// colocar, y que un auditor no puede contrastar con nada.
//
// ── Y PIDE EL CONTRATO DE ENCARGADO ─────────────────────────────────
//
// El PDF lleva descripciones y causas descifradas, y una NC puede
// nombrar a un residente (D-73). Mismo 423 que la historia clínica
// cuando hay una versión del contrato sin aceptar.

import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  RouteShorthandOptions,
} from "fastify";
import {
  renderPacPdf,
  type AccionParaPac,
  type NcParaPac,
  type VerificacionParaPac,
} from "@mipiacetpv/ticket-pdf";

import { dekONada } from "../clinica/claves.js";
// La MISMA cabecera que el consentimiento, el informe clínico y el
// ticket: `Tenant.name` más `fiscalProfile`. Un PAC con una identidad
// distinta de la del resto de papeles del centro serían dos negocios.
import { datosDelCentro } from "../clinica/consentimientos.js";
import {
  leerTexto,
  sitioCausaDeNc,
  sitioCierreDeAccionCorrectiva,
  sitioDescripcionDeNc,
  sitioNotaDeEvidencia,
  sitioNotaDeVerificacion,
  sitioTextoDeAccionCorrectiva,
} from "../clinica/cripto-campos.js";
import { getPrisma } from "../context.js";
import {
  CLASE_EN_PALABRAS,
  ESTADO_EN_PALABRAS,
  utcToWallDate,
} from "@mipiacetpv/residencia-plan";

/** Cómo se dice un origen en el papel. En castellano y con el nombre
 *  que usa quien lo lee, no el del enum. */
export const ORIGEN_EN_PALABRAS: Record<string, string> = {
  INTERNAL_AUDIT: "Auditoría interna",
  EXTERNAL_AUDIT: "Auditoría externa",
  INSPECTION: "Inspección",
  INCIDENT: "Incidencia del libro",
  COMPLAINT: "Queja",
  INDICATOR: "Indicador fuera de umbral",
  MANAGEMENT_REVIEW: "Revisión por la dirección",
  OTHER: "Otro",
};

type Puerta = Pick<RouteShorthandOptions, "preHandler">;
type SinPaso = (r: FastifyRequest, p: FastifyReply) => Promise<boolean>;
type SinContrato = (t: string, p: FastifyReply) => Promise<boolean>;

export async function registrarPacRoutes(
  app: FastifyInstance,
  puerta: Puerta,
  sinPaso: SinPaso,
  sinContrato: SinContrato,
): Promise<void> {
  const esquema = {
    querystring: {
      type: "object",
      properties: {
        origen: { type: "string" },
        desde: { type: "string", pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}$" },
        hasta: { type: "string", pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}$" },
        procesoId: { type: "string", format: "uuid" },
        // **Por defecto sólo las SIN CERRAR en el PAC**: lo que se le
        // manda a la certificadora es lo que queda por hacer. El informe
        // de dentro las lleva todas, que es la diferencia entre un plan y
        // un histórico.
        incluirCerradas: { type: "string" },
      },
    },
  } as const;

  for (const modo of ["PAC", "INFORME"] as const) {
    const ruta =
      modo === "PAC"
        ? "/residencia/calidad/pac.pdf"
        : "/residencia/calidad/informe-nc.pdf";

    app.get(ruta, { ...puerta, schema: esquema }, async (request, reply) => {
      if (await sinPaso(request, reply)) return;
      const auth = request.auth!;
      if (await sinContrato(auth.tenantId, reply)) return;

      const q = request.query as Record<string, string | undefined>;
      const prisma = getPrisma();
      const dek = await dekONada(auth.tenantId, prisma);
      const hoy = utcToWallDate(new Date());
      // El informe es un histórico, así que lleva las cerradas salvo que
      // alguien pida lo contrario; el PAC es un plan y no, salvo que
      // alguien las pida.
      const conCerradas =
        modo === "INFORME" ? q.incluirCerradas !== "0" : q.incluirCerradas === "1";

      const [centro, filas] = await Promise.all([
        datosDelCentro(prisma, auth.tenantId),
        prisma.nonConformity.findMany({
          where: {
            tenantId: auth.tenantId,
            ...(q.origen ? { origin: q.origen as never } : {}),
            ...(q.procesoId ? { processId: q.procesoId } : {}),
            ...(conCerradas ? {} : { state: { not: "CLOSED" } }),
            ...(q.desde || q.hasta
              ? {
                  detectedOn: {
                    ...(q.desde ? { gte: q.desde } : {}),
                    ...(q.hasta ? { lte: q.hasta } : {}),
                  },
                }
              : {}),
          },
          orderBy: [{ detectedOn: "asc" }, { reference: "asc" }],
          select: {
            id: true,
            tenantId: true,
            reference: true,
            kind: true,
            origin: true,
            state: true,
            isoClause: true,
            detectedOn: true,
            descriptionCifrado: true,
            causeCifrado: true,
            sourceIndicatorCode: true,
            sourceIndicatorMonth: true,
            sourceNote: true,
            closedAt: true,
            process: { select: { name: true } },
            sourceIncident: { select: { incidentType: true, careDay: true } },
            actions: {
              orderBy: { openedAt: "asc" },
              select: {
                id: true,
                tenantId: true,
                whatCifrado: true,
                closingNoteCifrado: true,
                dueOn: true,
                closedAt: true,
                responsibleCareRole: { select: { name: true } },
                responsibleUser: { select: { alias: true, email: true } },
                responsibleLabel: true,
                evidences: {
                  orderBy: { at: "asc" },
                  select: {
                    id: true,
                    tenantId: true,
                    fileName: true,
                    noteCifrado: true,
                  },
                },
              },
            },
            verifications: {
              orderBy: { at: "asc" },
              select: {
                id: true,
                tenantId: true,
                result: true,
                noteCifrado: true,
                at: true,
                by: { select: { alias: true, email: true } },
              },
            },
          },
        }),
      ]);

      const quien = (u: { alias: string | null; email: string } | null): string =>
        u == null ? "—" : (u.alias ?? u.email.split("@")[0]!);

      const noConformidades: NcParaPac[] = filas.map((n) => {
        const acciones: AccionParaPac[] = n.actions.map((a) => {
          const notas = a.evidences
            .map((e) =>
              [
                e.fileName != null ? "documento adjunto" : null,
                leerTexto(
                  { cifrado: e.noteCifrado, claro: null },
                  dek,
                  sitioNotaDeEvidencia(e.tenantId, e.id),
                ),
              ]
                .filter((x): x is string => x != null && x !== "")
                .join(" · "),
            )
            .filter((x) => x !== "");
          const cierre = leerTexto(
            { cifrado: a.closingNoteCifrado, claro: null },
            dek,
            sitioCierreDeAccionCorrectiva(a.tenantId, a.id),
          );
          if (cierre) notas.unshift(cierre);
          return {
            que:
              leerTexto(
                { cifrado: a.whatCifrado, claro: null },
                dek,
                sitioTextoDeAccionCorrectiva(a.tenantId, a.id),
              ) ?? "—",
            responsable:
              a.responsibleCareRole?.name ??
              (a.responsibleUser != null ? quien(a.responsibleUser) : null) ??
              a.responsibleLabel ??
              "—",
            plazo: a.dueOn,
            estado:
              a.closedAt != null
                ? `Cerrada el ${utcToWallDate(a.closedAt)}`
                : a.dueOn < hoy
                  ? "ABIERTA Y VENCIDA"
                  : "Abierta, en plazo",
            evidencia: notas.length === 0 ? null : notas.join(" · "),
          };
        });

        const verificaciones: VerificacionParaPac[] = n.verifications.map((v) => ({
          fecha: utcToWallDate(v.at),
          por: quien(v.by),
          resultado: v.result === "EFFECTIVE" ? "Eficaz" : "NO EFICAZ",
          nota:
            leerTexto(
              { cifrado: v.noteCifrado, claro: null },
              dek,
              sitioNotaDeVerificacion(v.tenantId, v.id),
            ) ?? "",
        }));

        const detalle =
          n.sourceIncident != null
            ? `${n.sourceIncident.incidentType} del ${n.sourceIncident.careDay}`
            : n.sourceIndicatorCode != null
              ? `${n.sourceIndicatorCode} · ${n.sourceIndicatorMonth}`
              : n.sourceNote;

        return {
          referencia: n.reference,
          clase: CLASE_EN_PALABRAS[n.kind],
          origen: ORIGEN_EN_PALABRAS[n.origin] ?? n.origin,
          origenDetalle: detalle,
          proceso: n.process.name,
          clausula: n.isoClause,
          detectada: n.detectedOn,
          estado: ESTADO_EN_PALABRAS[n.state],
          descripcion:
            leerTexto(
              { cifrado: n.descriptionCifrado, claro: null },
              dek,
              sitioDescripcionDeNc(n.tenantId, n.id),
            ) ?? "—",
          causa: leerTexto(
            { cifrado: n.causeCifrado, claro: null },
            dek,
            sitioCausaDeNc(n.tenantId, n.id),
          ),
          acciones,
          verificaciones,
          cerrada: n.closedAt == null ? null : utcToWallDate(n.closedAt),
        };
      });

      const trozos = [
        q.origen ? `origen: ${ORIGEN_EN_PALABRAS[q.origen] ?? q.origen}` : null,
        q.desde ? `desde el ${q.desde}` : null,
        q.hasta ? `hasta el ${q.hasta}` : null,
        conCerradas ? "incluidas las cerradas" : "sólo las que siguen abiertas",
      ].filter((x): x is string => x != null);

      const pdf = await renderPacPdf({
        modo,
        centro: {
          nombre: centro.nombre,
          nif: centro.nif,
          direccion: centro.direccion,
        },
        filtro: `${noConformidades.length} no conformidad(es) · ${trozos.join(" · ")}`,
        generadoEl: hoy,
        noConformidades,
      });

      reply.header("content-type", "application/pdf");
      reply.header(
        "content-disposition",
        `inline; filename="${modo === "PAC" ? "pac" : "informe-nc"}-${hoy}.pdf"`,
      );
      return reply.send(Buffer.from(pdf));
    });
  }
}
