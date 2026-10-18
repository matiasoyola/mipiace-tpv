// residencia-5 (D-42) · **LAS RUTAS DE LAS OBLIGACIONES DE DIRECCIÓN.**
//
// Nueve:
//
//   1. `GET  /residencia/obligaciones`                    — la lista.
//   2. `POST /residencia/obligaciones`                    — alta.
//   3. `PUT  /residencia/obligaciones/:id`                — edición.
//   4. `POST /residencia/obligaciones/cargar-plantilla`   — el catálogo
//      del bloque C §3, de una vez.
//   5. `GET  /residencia/obligaciones/:id/ocurrencias`    — las veces.
//   6. `POST /residencia/ocurrencias/:id/hecha`           — marcar hecha,
//      con firma (D-31).
//   7. `POST /residencia/ocurrencias/:id/evidencia`       — adjuntar el
//      certificado.
//   8. `GET  /residencia/ocurrencias/:id/evidencia`       — y servirlo.
//   9. `POST /residencia/ocurrencias/:id/corregir`        — deshacer una
//      hecha, con corrección firmada.
//
// ── MISMA PUERTA QUE EL PANEL ───────────────────────────────────────
//
// Dirección (o el OWNER). Una obligación de dirección no es un dato de
// salud —va en claro, D-63— pero es la agenda de quien dirige el centro,
// y la lista de lo que está vencido no es asunto de la plantilla.
//
// ── Y NO ABREN INCIDENCIA ───────────────────────────────────────────
//
// Una ocurrencia vencida sale en rojo en el panel y nada más. El sujeto
// «proceso» del libro es de calidad-1 (D-38); meterla aquí sería
// adelantar un bloque entero por la puerta de atrás.

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import { requireOwnerOrManager } from "../auth/middleware.js";
import { asegurarDek } from "../clinica/claves.js";
import { ensureClinicaEnabled } from "../clinica/gate.js";
import {
  FotoInvalida,
  decodificarEvidencia,
  guardarFichero,
  leerFichero,
  MIME_DE_PDF,
} from "../clinica/ficheros.js";
import { getPrisma } from "../context.js";
import {
  periodicidadEnPalabras,
  utcToWallDate,
  type ObligacionParaGenerar,
} from "@mipiacetpv/residencia-plan";

import { ensureResidenciaEnabled } from "./gate.js";
import {
  ObligacionInvalida,
  cargarPlantillaDeObligaciones,
  corregirHecha,
  generarOcurrenciasDe,
  marcarHecha,
  obligacionesDelPanel,
} from "./obligaciones.js";
import { capacidadesVigentes } from "./incidencias.js";

/** La misma de `panel-routes.ts`, y por la misma razón. */
async function negativaDeDireccion(
  tenantId: string,
  userId: string,
  esOwner: boolean,
): Promise<{ error: string; message: string } | null> {
  if (esOwner) return null;
  const ahora = new Date();
  const roles = await getPrisma().careRoleAssignment.findMany({
    where: {
      tenantId,
      userId,
      revokedAt: null,
      fromAt: { lte: ahora },
      OR: [{ toAt: null }, { toAt: { gte: ahora } }],
    },
    select: { careRole: { select: { category: true, active: true } } },
  });
  const directivo = roles
    .map((r) => r.careRole)
    .some((r) => r.active && r.category === "DIRECTIVO");
  if (!directivo) {
    return {
      error: "OBLIGACIONES_SON_DE_DIRECCION",
      message:
        "Las obligaciones de dirección las ve y las marca quien tenga un rol de cuidado de categoría directiva.",
    };
  }
  return null;
}

/** El cuerpo de alta y de edición, que es el mismo. */
const CUERPO_DE_OBLIGACION = {
  type: "object",
  required: ["name", "family", "periodicity", "consequence"],
  additionalProperties: false,
  properties: {
    name: { type: "string", minLength: 1, maxLength: 160 },
    family: {
      type: "string",
      enum: ["PERSONAL", "DINERO", "COMPRAS", "CUMPLIMIENTO", "CALIDAD"],
    },
    periodicity: {
      type: "string",
      enum: ["DAILY", "WEEKLY", "MONTHLY", "QUARTERLY", "ANNUAL", "FIVE_YEARLY", "VALIDITY"],
    },
    weekday: { type: ["integer", "null"], minimum: 1, maximum: 7 },
    monthDay: { type: ["integer", "null"], minimum: 1, maximum: 31 },
    month: { type: ["integer", "null"], minimum: 1, maximum: 12 },
    anchorYear: { type: ["integer", "null"], minimum: 1900, maximum: 2200 },
    validUntil: { type: ["string", "null"], pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}$" },
    consequence: { type: "string", enum: ["LEGAL", "ISO", "INTERNO"] },
    responsibleCareRoleId: { type: ["string", "null"], format: "uuid" },
    responsibleUserId: { type: ["string", "null"], format: "uuid" },
    responsibleLabel: { type: ["string", "null"], maxLength: 80 },
    periodicityToVerify: { type: "boolean" },
    notes: { type: ["string", "null"], maxLength: 2000 },
    startsOn: { type: "string", pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}$" },
    active: { type: "boolean" },
  },
} as const;

interface CuerpoDeObligacion {
  name: string;
  family: "PERSONAL" | "DINERO" | "COMPRAS" | "CUMPLIMIENTO" | "CALIDAD";
  periodicity:
    | "DAILY"
    | "WEEKLY"
    | "MONTHLY"
    | "QUARTERLY"
    | "ANNUAL"
    | "FIVE_YEARLY"
    | "VALIDITY";
  weekday?: number | null;
  monthDay?: number | null;
  month?: number | null;
  anchorYear?: number | null;
  validUntil?: string | null;
  consequence: "LEGAL" | "ISO" | "INTERNO";
  responsibleCareRoleId?: string | null;
  responsibleUserId?: string | null;
  responsibleLabel?: string | null;
  periodicityToVerify?: boolean;
  notes?: string | null;
  startsOn?: string;
  active?: boolean;
}

/**
 * Comprueba el cuerpo ANTES de tocar la base.
 *
 * Los mismos dos CHECK de la migración, comprobados aquí para que el
 * fallo sea una frase y no un 500 del motor: «una mensual sin día del mes
 * no sabe cuándo toca» se puede leer; `management_duties_periodicidad_coherente`
 * no.
 */
function problemaDelCuerpo(c: CuerpoDeObligacion): string | null {
  const responsables = [
    c.responsibleCareRoleId,
    c.responsibleUserId,
    c.responsibleLabel?.trim() ? c.responsibleLabel : null,
  ].filter((x) => x != null).length;
  if (responsables !== 1) {
    return "Una obligación tiene exactamente un responsable: un rol de cuidado, una persona o un nombre escrito.";
  }
  const falta = (campo: string): string =>
    `Una obligación ${c.periodicity === "WEEKLY" ? "semanal" : "con esta periodicidad"} necesita ${campo}.`;
  switch (c.periodicity) {
    case "DAILY":
      break;
    case "WEEKLY":
      if (c.weekday == null) return falta("el día de la semana");
      break;
    case "MONTHLY":
      if (c.monthDay == null) return falta("el día del mes");
      break;
    case "QUARTERLY":
      if (c.monthDay == null) return falta("el día del mes");
      if (c.month == null || c.month < 1 || c.month > 3) {
        return "Una obligación trimestral necesita el primer mes del ciclo (enero, febrero o marzo).";
      }
      break;
    case "ANNUAL":
      if (c.monthDay == null || c.month == null) return falta("el mes y el día");
      break;
    case "FIVE_YEARLY":
      if (c.monthDay == null || c.month == null || c.anchorYear == null) {
        return falta("el mes, el día y el año desde el que se cuentan los cinco");
      }
      break;
    case "VALIDITY":
      if (c.validUntil == null) return falta("la fecha de caducidad");
      break;
  }
  return null;
}

/** Las columnas de periodicidad, con las que no van a NULL. */
function columnasDePeriodicidad(c: CuerpoDeObligacion) {
  const vacio = {
    weekday: null as number | null,
    monthDay: null as number | null,
    month: null as number | null,
    anchorYear: null as number | null,
    validUntil: null as string | null,
  };
  switch (c.periodicity) {
    case "DAILY":
      return vacio;
    case "WEEKLY":
      return { ...vacio, weekday: c.weekday ?? null };
    case "MONTHLY":
      return { ...vacio, monthDay: c.monthDay ?? null };
    case "QUARTERLY":
      return { ...vacio, monthDay: c.monthDay ?? null, month: c.month ?? null };
    case "ANNUAL":
      return { ...vacio, monthDay: c.monthDay ?? null, month: c.month ?? null };
    case "FIVE_YEARLY":
      return {
        ...vacio,
        monthDay: c.monthDay ?? null,
        month: c.month ?? null,
        anchorYear: c.anchorYear ?? null,
      };
    case "VALIDITY":
      return { ...vacio, validUntil: c.validUntil ?? null };
  }
}

export async function registerResidenciaObligacionesRoutes(
  app: FastifyInstance,
): Promise<void> {
  const puerta = {
    preHandler: [requireOwnerOrManager, ensureClinicaEnabled, ensureResidenciaEnabled],
  };

  /** El guardia de dirección, en una línea por ruta. */
  const sinDireccion = async (
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<boolean> => {
    const auth = request.auth!;
    const negativa = await negativaDeDireccion(
      auth.tenantId,
      auth.userId,
      auth.role === "OWNER",
    );
    if (negativa) {
      reply.code(403).send(negativa);
      return true;
    }
    return false;
  };

  // ════════════════════════════════════════════════════════════════
  //  1 · `GET /residencia/obligaciones` · LA LISTA
  // ════════════════════════════════════════════════════════════════
  app.get(
    "/residencia/obligaciones",
    puerta,
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (await sinDireccion(request, reply)) return;
      const auth = request.auth!;
      const prisma = getPrisma();
      const ahora = new Date();

      const [duties, panel] = await Promise.all([
        prisma.managementDuty.findMany({
          where: { tenantId: auth.tenantId },
          orderBy: [{ active: "desc" }, { family: "asc" }, { name: "asc" }],
          select: {
            id: true,
            name: true,
            family: true,
            notes: true,
            periodicity: true,
            weekday: true,
            monthDay: true,
            month: true,
            anchorYear: true,
            validUntil: true,
            periodicityToVerify: true,
            consequence: true,
            startsOn: true,
            active: true,
            responsibleCareRole: { select: { id: true, name: true } },
            responsibleUser: { select: { id: true, alias: true, email: true } },
            responsibleLabel: true,
          },
        }),
        obligacionesDelPanel(prisma, { tenantId: auth.tenantId, ahora }),
      ]);

      return reply.code(200).send({
        obligaciones: duties.map((d) => ({
          ...d,
          // La frase de la pantalla sale del paquete puro, no del front:
          // tres copias de «cada tres meses» se separan a la tercera.
          periodicidadEnPalabras: periodicidadEnPalabras(d as ObligacionParaGenerar),
          responsable:
            d.responsibleLabel ??
            d.responsibleCareRole?.name ??
            (d.responsibleUser == null
              ? "—"
              : (d.responsibleUser.alias ?? d.responsibleUser.email.split("@")[0]!)),
        })),
        hoy: panel.hoy,
        vencidas: panel.vencidas,
        proximas: panel.proximas,
        // Cuántas hay de la plantilla por cargar. Es lo que pinta el
        // botón: «cargar el catálogo (26)» o nada si ya está.
        plantilla: await cuantasFaltanDeLaPlantilla(auth.tenantId),
      });
    },
  );

  // ════════════════════════════════════════════════════════════════
  //  2 · `POST /residencia/obligaciones` · ALTA
  // ════════════════════════════════════════════════════════════════
  app.post(
    "/residencia/obligaciones",
    { ...puerta, schema: { body: CUERPO_DE_OBLIGACION } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (await sinDireccion(request, reply)) return;
      const auth = request.auth!;
      const cuerpo = request.body as CuerpoDeObligacion;
      const problema = problemaDelCuerpo(cuerpo);
      if (problema) {
        return reply.code(400).send({ error: "OBLIGACION_INVALIDA", message: problema });
      }
      const prisma = getPrisma();
      const ahora = new Date();

      const duty = await prisma.managementDuty.create({
        data: {
          tenantId: auth.tenantId,
          name: cuerpo.name.trim(),
          family: cuerpo.family,
          notes: cuerpo.notes?.trim() ? cuerpo.notes.trim() : null,
          periodicity: cuerpo.periodicity,
          ...columnasDePeriodicidad(cuerpo),
          periodicityToVerify: cuerpo.periodicityToVerify === true,
          consequence: cuerpo.consequence,
          responsibleCareRoleId: cuerpo.responsibleCareRoleId ?? null,
          responsibleUserId: cuerpo.responsibleUserId ?? null,
          responsibleLabel: cuerpo.responsibleLabel?.trim()
            ? cuerpo.responsibleLabel.trim()
            : null,
          startsOn: cuerpo.startsOn ?? utcToWallDate(ahora),
          createdByUserId: auth.userId,
        },
        select: { id: true },
      });
      // Las ocurrencias, al momento: una obligación recién creada tiene
      // que salir en el panel el mismo día. Esperar a la pasada
      // programada habría dejado «lo que toca hoy» sin lo que alguien
      // acaba de dar de alta.
      const { creadas } = await generarOcurrenciasDe(prisma, {
        tenantId: auth.tenantId,
        dutyId: duty.id,
        ahora,
      });
      return reply.code(201).send({ id: duty.id, ocurrencias: creadas });
    },
  );

  // ════════════════════════════════════════════════════════════════
  //  3 · `PUT /residencia/obligaciones/:id` · EDICIÓN
  // ════════════════════════════════════════════════════════════════
  //
  // Lo que ya está HECHO no se toca: cambiar la periodicidad genera las
  // ocurrencias nuevas y deja las viejas donde están. Borrar las
  // pendientes que ya no cuadran sería tirar lo que alguien marcó hecho
  // si se equivoca al editar.
  app.put(
    "/residencia/obligaciones/:id",
    {
      ...puerta,
      schema: {
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", format: "uuid" } },
        },
        body: CUERPO_DE_OBLIGACION,
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (await sinDireccion(request, reply)) return;
      const auth = request.auth!;
      const { id } = request.params as { id: string };
      const cuerpo = request.body as CuerpoDeObligacion;
      const problema = problemaDelCuerpo(cuerpo);
      if (problema) {
        return reply.code(400).send({ error: "OBLIGACION_INVALIDA", message: problema });
      }
      const prisma = getPrisma();
      const ya = await prisma.managementDuty.findFirst({
        where: { id, tenantId: auth.tenantId },
        select: { id: true },
      });
      if (ya == null) {
        return reply.code(404).send({
          error: "OBLIGACION_NO_ENCONTRADA",
          message: "Esa obligación no existe en este centro.",
        });
      }
      await prisma.managementDuty.update({
        where: { id },
        data: {
          name: cuerpo.name.trim(),
          family: cuerpo.family,
          notes: cuerpo.notes?.trim() ? cuerpo.notes.trim() : null,
          periodicity: cuerpo.periodicity,
          ...columnasDePeriodicidad(cuerpo),
          periodicityToVerify: cuerpo.periodicityToVerify === true,
          consequence: cuerpo.consequence,
          responsibleCareRoleId: cuerpo.responsibleCareRoleId ?? null,
          responsibleUserId: cuerpo.responsibleUserId ?? null,
          responsibleLabel: cuerpo.responsibleLabel?.trim()
            ? cuerpo.responsibleLabel.trim()
            : null,
          ...(cuerpo.startsOn ? { startsOn: cuerpo.startsOn } : {}),
          ...(cuerpo.active === undefined ? {} : { active: cuerpo.active }),
        },
      });
      const { creadas } = await generarOcurrenciasDe(prisma, {
        tenantId: auth.tenantId,
        dutyId: id,
        ahora: new Date(),
      });
      return reply.code(200).send({ id, ocurrencias: creadas });
    },
  );

  // ════════════════════════════════════════════════════════════════
  //  4 · `POST …/cargar-plantilla` · EL CATÁLOGO DEL BLOQUE C
  // ════════════════════════════════════════════════════════════════
  //
  // Un botón, una vez. Idempotente por nombre y **no pisa nada**: si la
  // dirección cambió el día de las nóminas, volver a pulsarlo no se lo
  // devuelve. Es un botón que alguien va a pulsar dos veces por si acaso.
  app.post(
    "/residencia/obligaciones/cargar-plantilla",
    puerta,
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (await sinDireccion(request, reply)) return;
      const auth = request.auth!;
      const res = await cargarPlantillaDeObligaciones(getPrisma(), {
        tenantId: auth.tenantId,
        userId: auth.userId,
        ahora: new Date(),
      });
      if (res.problemas.length > 0) {
        // El fichero de datos del producto está mal. 500 y no 400: no es
        // culpa de quien pulsó el botón.
        request.log.error(
          { event: "obligaciones_plantilla_invalida", problemas: res.problemas },
          "residencia · la plantilla de obligaciones no es válida",
        );
        return reply.code(500).send({
          error: "PLANTILLA_INVALIDA",
          message:
            "La plantilla de obligaciones del producto tiene un problema. Avisa a Mi Piace.",
          problemas: res.problemas,
        });
      }
      return reply.code(200).send(res);
    },
  );

  // ════════════════════════════════════════════════════════════════
  //  5 · `GET …/:id/ocurrencias`
  // ════════════════════════════════════════════════════════════════
  app.get(
    "/residencia/obligaciones/:id/ocurrencias",
    {
      ...puerta,
      schema: {
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", format: "uuid" } },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (await sinDireccion(request, reply)) return;
      const auth = request.auth!;
      const { id } = request.params as { id: string };
      const prisma = getPrisma();
      const hoy = utcToWallDate(new Date());
      const filas = await prisma.dutyOccurrence.findMany({
        where: { tenantId: auth.tenantId, dutyId: id },
        orderBy: { dueOn: "desc" },
        take: 200,
        select: {
          id: true,
          dueOn: true,
          doneAt: true,
          doneNote: true,
          evidenceFileName: true,
          evidenceBytes: true,
          correctedAt: true,
          correctionReason: true,
          doneBy: { select: { alias: true, email: true } },
          doneWith: { select: { careRole: { select: { name: true } } } },
          correctedBy: { select: { alias: true, email: true } },
        },
      });
      return reply.code(200).send({
        hoy,
        ocurrencias: filas.map((f) => ({
          id: f.id,
          dueOn: f.dueOn,
          hecha: f.doneAt != null,
          hechaEn: f.doneAt?.toISOString() ?? null,
          hechaPor:
            f.doneBy == null ? null : (f.doneBy.alias ?? f.doneBy.email.split("@")[0]!),
          // La CAPACIDAD, no sólo la persona (D-31): «la marcó Ana Isabel,
          // como responsable de calidad» es lo que es evidencia.
          hechaComo: f.doneWith?.careRole.name ?? null,
          nota: f.doneNote,
          tieneEvidencia: f.evidenceFileName != null,
          evidenciaBytes: f.evidenceBytes,
          corregidaEn: f.correctedAt?.toISOString() ?? null,
          corregidaPor:
            f.correctedBy == null
              ? null
              : (f.correctedBy.alias ?? f.correctedBy.email.split("@")[0]!),
          motivoDeCorreccion: f.correctionReason,
        })),
      });
    },
  );

  // ════════════════════════════════════════════════════════════════
  //  6 · `POST /residencia/ocurrencias/:id/hecha`
  // ════════════════════════════════════════════════════════════════
  app.post(
    "/residencia/ocurrencias/:id/hecha",
    {
      ...puerta,
      schema: {
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", format: "uuid" } },
        },
        body: {
          type: "object",
          additionalProperties: false,
          properties: {
            careRoleAssignmentId: { type: "string", format: "uuid" },
            nota: { type: ["string", "null"], maxLength: 500 },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (await sinDireccion(request, reply)) return;
      const auth = request.auth!;
      const { id } = request.params as { id: string };
      const { careRoleAssignmentId, nota } = (request.body ?? {}) as {
        careRoleAssignmentId?: string;
        nota?: string | null;
      };
      const prisma = getPrisma();
      const ahora = new Date();

      const capacidad = await elegirCapacidad(
        auth.tenantId,
        auth.userId,
        careRoleAssignmentId,
        ahora,
      );
      if ("error" in capacidad) return reply.code(capacidad.http).send(capacidad);

      try {
        const r = await marcarHecha(prisma, {
          tenantId: auth.tenantId,
          occurrenceId: id,
          firma: { userId: auth.userId, careRoleAssignmentId: capacidad.assignmentId },
          nota: nota ?? null,
          ahora,
        });
        return reply.code(200).send({
          id: r.occurrenceId,
          hechaEn: r.doneAt.toISOString(),
        });
      } catch (err) {
        if (err instanceof ObligacionInvalida) {
          return reply
            .code(err.code === "OCURRENCIA_NO_ENCONTRADA" ? 404 : 409)
            .send({ error: err.code, message: err.message });
        }
        throw err;
      }
    },
  );

  // ════════════════════════════════════════════════════════════════
  //  7 y 8 · LA EVIDENCIA ADJUNTA
  // ════════════════════════════════════════════════════════════════
  //
  // El certificado, el informe. Fichero del volumen clínico con cabecera
  // `MPC1` y la huella del claro, **igual que los demás ficheros de la
  // casa**: no se inventa un segundo almacén para esto.
  //
  // Y **primero el fichero, después la fila**, que es el orden de
  // clinica-4: al revés, un fallo al escribir el disco dejaría una fila
  // que dice que hay un PDF que no existe.
  app.post(
    "/residencia/ocurrencias/:id/evidencia",
    {
      ...puerta,
      schema: {
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", format: "uuid" } },
        },
        body: {
          type: "object",
          required: ["pdfBase64"],
          additionalProperties: false,
          properties: { pdfBase64: { type: "string" } },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (await sinDireccion(request, reply)) return;
      const auth = request.auth!;
      const { id } = request.params as { id: string };
      const prisma = getPrisma();

      const ocurrencia = await prisma.dutyOccurrence.findFirst({
        where: { id, tenantId: auth.tenantId },
        select: { id: true, doneAt: true },
      });
      if (ocurrencia == null) {
        return reply.code(404).send({
          error: "OCURRENCIA_NO_ENCONTRADA",
          message: "Esa obligación no existe en este centro.",
        });
      }
      // El CHECK `duty_occurrences_evidencia_exige_hecha` lo impide en el
      // motor; aquí se contesta con una frase que explica el orden.
      if (ocurrencia.doneAt == null) {
        return reply.code(409).send({
          error: "EVIDENCIA_EXIGE_HECHA",
          message:
            "Primero se marca la obligación como hecha y después se adjunta el documento: la evidencia es de algo que se hizo.",
        });
      }

      let pdf: Buffer;
      try {
        pdf = decodificarEvidencia(request.body);
      } catch (err) {
        if (err instanceof FotoInvalida) {
          return reply.code(400).send({ error: "EVIDENCIA_INVALIDA", message: err.message });
        }
        throw err;
      }

      const dek = await asegurarDek(auth.tenantId, prisma);
      const guardado = await guardarFichero("EVIDENCIA", pdf, {
        tenantId: auth.tenantId,
        dek,
      });
      await prisma.dutyOccurrence.update({
        where: { id },
        data: {
          evidenceFileName: guardado.fileName,
          evidenceSha256: guardado.sha256,
          evidenceBytes: guardado.bytes,
          evidenceMimeType: MIME_DE_PDF,
        },
      });
      return reply.code(201).send({ bytes: guardado.bytes });
    },
  );

  app.get(
    "/residencia/ocurrencias/:id/evidencia",
    {
      ...puerta,
      schema: {
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", format: "uuid" } },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (await sinDireccion(request, reply)) return;
      const auth = request.auth!;
      const { id } = request.params as { id: string };
      const prisma = getPrisma();
      const fila = await prisma.dutyOccurrence.findFirst({
        where: { id, tenantId: auth.tenantId },
        select: {
          evidenceFileName: true,
          evidenceSha256: true,
          evidenceMimeType: true,
        },
      });
      if (fila?.evidenceFileName == null) {
        return reply.code(404).send({
          error: "SIN_EVIDENCIA",
          message: "Esa obligación no tiene documento adjunto.",
        });
      }
      const dek = await asegurarDek(auth.tenantId, prisma);
      const leido = await leerFichero(
        "EVIDENCIA",
        fila.evidenceFileName,
        fila.evidenceSha256,
        { tenantId: auth.tenantId, dek },
      );
      if (leido == null) {
        return reply.code(404).send({
          error: "EVIDENCIA_NO_ESTA",
          message:
            "El documento no está en el volumen. La fila lo nombra: avisa a Mi Piace.",
        });
      }
      // Si la huella no cuadra **se sirve igual con el aviso**, igual que
      // un consentimiento de clinica-4: un documento cuyo PDF no cuadra es
      // justo el que alguien tiene que mirar, y esconderlo sería borrar la
      // única pista.
      reply.header("content-type", fila.evidenceMimeType ?? MIME_DE_PDF);
      reply.header("x-huella-cuadra", leido.huellaCuadra ? "1" : "0");
      return reply.send(leido.contenido);
    },
  );

  // ════════════════════════════════════════════════════════════════
  //  9 · `POST /residencia/ocurrencias/:id/corregir`
  // ════════════════════════════════════════════════════════════════
  app.post(
    "/residencia/ocurrencias/:id/corregir",
    {
      ...puerta,
      schema: {
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", format: "uuid" } },
        },
        body: {
          type: "object",
          required: ["motivo"],
          additionalProperties: false,
          properties: {
            motivo: { type: "string", minLength: 1, maxLength: 500 },
            careRoleAssignmentId: { type: "string", format: "uuid" },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (await sinDireccion(request, reply)) return;
      const auth = request.auth!;
      const { id } = request.params as { id: string };
      const { motivo, careRoleAssignmentId } = request.body as {
        motivo: string;
        careRoleAssignmentId?: string;
      };
      const ahora = new Date();
      const capacidad = await elegirCapacidad(
        auth.tenantId,
        auth.userId,
        careRoleAssignmentId,
        ahora,
      );
      if ("error" in capacidad) return reply.code(capacidad.http).send(capacidad);

      try {
        const r = await corregirHecha(getPrisma(), {
          tenantId: auth.tenantId,
          occurrenceId: id,
          firma: { userId: auth.userId, careRoleAssignmentId: capacidad.assignmentId },
          motivo,
          ahora,
        });
        return reply.code(200).send({ id: r.occurrenceId, pendiente: true });
      } catch (err) {
        if (err instanceof ObligacionInvalida) {
          return reply
            .code(err.code === "OCURRENCIA_NO_ENCONTRADA" ? 404 : 409)
            .send({ error: err.code, message: err.message });
        }
        throw err;
      }
    },
  );
}

/**
 * Con qué capacidad firma.
 *
 * Si el cuerpo trae una, se usa; si no, **la primera de categoría
 * directiva vigente**. No se le pregunta como en la puerta, y es una
 * decisión: en la puerta la pregunta es obligatoria porque la auxiliar
 * registra con una capacidad distinta según el rol con el que entró, y
 * aquí lo que se firma es una obligación de dirección — con un solo rol
 * directivo vigente (que es el caso normal) preguntar sería un clic de
 * más en una pantalla que se usa veinte veces al día.
 *
 * Con DOS roles directivos vigentes la pantalla sí deja elegir, y el
 * cuerpo lo manda.
 */
async function elegirCapacidad(
  tenantId: string,
  userId: string,
  pedida: string | undefined,
  ahora: Date,
): Promise<{ assignmentId: string } | { error: string; message: string; http: number }> {
  const capacidades = await capacidadesVigentes(getPrisma(), tenantId, userId, ahora);
  const directivas = capacidades.filter((c) => c.category === "DIRECTIVO");
  if (directivas.length === 0) {
    return {
      error: "SIN_CAPACIDAD_DIRECTIVA",
      message:
        "Para marcar una obligación hace falta un rol de cuidado de categoría directiva vigente.",
      http: 403,
    };
  }
  if (pedida != null) {
    const suya = directivas.find((c) => c.assignmentId === pedida);
    if (suya == null) {
      return {
        error: "CAPACIDAD_NO_VIGENTE",
        message: "Ese rol de cuidado no está vigente o no es directivo.",
        http: 400,
      };
    }
    return { assignmentId: suya.assignmentId };
  }
  return { assignmentId: directivas[0]!.assignmentId };
}

/** Cuántas de la plantilla del bloque C no están todavía en este centro. */
async function cuantasFaltanDeLaPlantilla(tenantId: string): Promise<number> {
  const { OBLIGACIONES_DE_PLANTILLA } = await import(
    "./catalogo/obligaciones-de-serie.js"
  );
  const ya = await getPrisma().managementDuty.findMany({
    where: { tenantId },
    select: { name: true },
  });
  const nombres = new Set(ya.map((d) => d.name));
  return OBLIGACIONES_DE_PLANTILLA.filter((o) => !nombres.has(o.name)).length;
}
