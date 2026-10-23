// historia-1 (D-92, D-93, D-97) · **LAS RUTAS DE LAS AUSENCIAS Y LOS DÍAS
// DEL MES.**
//
// La pantalla es del admin (D-97). Lo que estas rutas hacen es traducir
// HTTP; quien sabe qué significa cada cosa es `ausencias.ts`, y quien
// cuenta los días es `diasDelMes` del paquete puro.
//
// ── POR `conHistoria`, Y POR QUÉ ────────────────────────────────────
//
// Una ausencia es historia clínica suya: dice que estuvo ingresado y
// cuándo. Así que cada apertura y cada escritura dejan su línea en
// `ClinicalAccessLog`, igual que la ficha — y con eso viene el alcance
// por zona (D-51) y el 423 del contrato revocado.
//
// **La excepción es la cuenta de los días del CENTRO**, que no tiene
// `clientId`: ver su cabecera.
//
// ── Y LA CAPACIDAD ──────────────────────────────────────────────────
//
// Una ausencia la apunta cualquiera que registre cuidado y alcance al
// residente: la auxiliar que ve que la ambulancia se lo lleva es la que
// está delante. **No es como un diagnóstico**, que es del médico y la
// DUE (D-90). Lo que sí es de supervisión es **confirmar la revisión de
// la vuelta**, porque eso es un acto clínico de la DUE (D-92).

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import {
  diasDelMes,
  diasDelMesDelCentro,
  type AusenciaDelPlan,
  type ResidenteParaLosDias,
} from "@mipiacetpv/residencia-plan";

import { getPrisma } from "../context.js";
import {
  requireOwnerOrCashier,
  requireOwnerOrManager,
} from "../auth/middleware.js";
import { dekONada } from "../clinica/claves.js";
import { ensureClinicaEnabled } from "../clinica/gate.js";
import { conHistoria } from "../clinica/registro.js";
import {
  leerTexto,
  sitioDestinoDeAusencia,
  sitioMotivoDeAusencia,
} from "../clinica/cripto-campos.js";
import { ensureResidenciaEnabled } from "./gate.js";
import {
  AusenciaInvalida,
  abrirAusencia,
  cerrarAusencia,
  confirmarRevision,
} from "./ausencias.js";
import { capacidadesVigentes } from "./incidencias.js";

const PUERTAS_LECTURA = [
  requireOwnerOrCashier,
  ensureClinicaEnabled,
  ensureResidenciaEnabled,
];
const PUERTAS_ESCRITURA = [
  requireOwnerOrManager,
  ensureClinicaEnabled,
  ensureResidenciaEnabled,
];

const TIPOS = [
  "INGRESO_HOSPITALARIO",
  "URGENCIAS",
  "VACACIONES_FAMILIA",
  "CONSULTA_EXTERNA",
  "SALIDA_NO_CONTROLADA",
] as const;

/** «YYYY-MM», que es lo que la pantalla de los días manda. */
const MES = { type: "string", pattern: "^[0-9]{4}-(0[1-9]|1[0-2])$" } as const;

async function residenteDelCentro(
  tenantId: string,
  clientId: string,
): Promise<boolean> {
  const existe = await getPrisma().residentProfile.findFirst({
    where: { clientId, tenantId },
    select: { clientId: true },
  });
  return existe != null;
}

/**
 * La capacidad con la que se firma una ausencia.
 *
 * Reutiliza `capacidadesVigentes` de residencia-4 —la misma función que
 * usa el libro de incidencias— en vez de escribir una tercera consulta de
 * «¿qué roles vigentes tiene esta persona?». `exigeSupervision` es lo
 * único que cambia entre apuntar una ausencia y confirmar la revisión de
 * una vuelta.
 */
async function capacidadParaLaAusencia(
  tenantId: string,
  userId: string,
  esOwner: boolean,
  exigeSupervision: boolean,
): Promise<
  { ok: true; assignmentId: string } | { ok: false; error: string; message: string }
> {
  const roles = await capacidadesVigentes(
    getPrisma(),
    tenantId,
    userId,
    new Date(),
  );
  if (roles.length === 0) {
    return {
      ok: false,
      error: "SIN_ROL_DE_CUIDADO",
      message: esOwner
        ? "Para firmar algo en una historia clínica hace falta una capacidad. Asígnate un rol de cuidado en Personal."
        : "No tienes ningún rol de cuidado vigente en este centro. Pídeselo a la dirección en Personal.",
    };
  }
  if (!exigeSupervision) {
    return { ok: true, assignmentId: roles[0]!.assignmentId };
  }
  const supervisa = roles.find(
    (r) => r.category === "SUPERVISOR" || r.category === "DIRECTIVO",
  );
  if (supervisa) return { ok: true, assignmentId: supervisa.assignmentId };
  if (esOwner) return { ok: true, assignmentId: roles[0]!.assignmentId };
  return {
    ok: false,
    error: "LA_REVISION_ES_DE_SUPERVISION",
    message:
      "La revisión de una vuelta del hospital la confirma la DUE, el médico o la dirección: es un acto clínico, no un trámite.",
  };
}

export async function registerResidenciaAusenciasRoutes(
  app: FastifyInstance,
): Promise<void> {
  // ════════════════════════════════════════════════════════════════
  //  LAS AUSENCIAS DE UN RESIDENTE
  // ════════════════════════════════════════════════════════════════
  app.get(
    "/residencia/residentes/:clientId/ausencias",
    {
      preHandler: PUERTAS_LECTURA,
      schema: {
        params: {
          type: "object",
          required: ["clientId"],
          additionalProperties: false,
          properties: { clientId: { type: "string", format: "uuid" } },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const { clientId } = request.params as { clientId: string };
      if (!(await residenteDelCentro(auth.tenantId, clientId))) {
        return reply.code(404).send({
          error: "RESIDENTE_NO_ENCONTRADO",
          message: "No hay ningún residente con esa ficha en este centro.",
        });
      }
      const prisma = getPrisma();
      return conHistoria(request, reply, { clientId, action: "READ" }, async () => {
        const dek = await dekONada(auth.tenantId, prisma);
        const filas = await prisma.residentAbsence.findMany({
          where: { tenantId: auth.tenantId, clientId },
          orderBy: { startedAt: "desc" },
          select: {
            id: true,
            kind: true,
            startedAt: true,
            expectedEndAt: true,
            endedAt: true,
            destinationCifrado: true,
            reasonCifrado: true,
            reviewRequired: true,
            reviewedAt: true,
            incidentId: true,
            correctedAt: true,
            correctionReason: true,
            createdBy: { select: { alias: true, email: true } },
            createdWith: { select: { careRole: { select: { name: true } } } },
            reviewedBy: { select: { alias: true, email: true } },
            reviewedWith: { select: { careRole: { select: { name: true } } } },
          },
        });
        const nombre = (u: { alias: string | null; email: string } | null) =>
          u == null ? null : u.alias?.trim() || u.email;
        return {
          ausencias: filas.map((a) => ({
            id: a.id,
            tipo: a.kind,
            desde: a.startedAt.toISOString(),
            finPrevisto: a.expectedEndAt?.toISOString() ?? null,
            hasta: a.endedAt?.toISOString() ?? null,
            abierta: a.endedAt == null,
            destino: leerTexto(
              { cifrado: a.destinationCifrado, claro: null },
              dek,
              sitioDestinoDeAusencia(auth.tenantId, a.id),
            ),
            motivo: leerTexto(
              { cifrado: a.reasonCifrado, claro: null },
              dek,
              sitioMotivoDeAusencia(auth.tenantId, a.id),
            ),
            pideRevision: a.reviewRequired,
            revisadaEn: a.reviewedAt?.toISOString() ?? null,
            revisadaPor: nombre(a.reviewedBy),
            revisadaComo: a.reviewedWith?.careRole.name ?? null,
            incidentId: a.incidentId,
            corregidaEn: a.correctedAt?.toISOString() ?? null,
            motivoDeCorreccion: a.correctionReason,
            firmadaPor: nombre(a.createdBy),
            firmadaComo: a.createdWith.careRole.name,
          })),
        };
      });
    },
  );

  // ── ABRIR una ausencia ───────────────────────────────────────────
  //
  // Y si es una **salida no controlada**, abre su incidencia N4 con su
  // aviso a guardia (D-92). Las dos cosas las hace `abrirAusencia`; esta
  // ruta sólo traduce.
  app.post(
    "/residencia/residentes/:clientId/ausencias",
    {
      preHandler: PUERTAS_ESCRITURA,
      schema: {
        params: {
          type: "object",
          required: ["clientId"],
          additionalProperties: false,
          properties: { clientId: { type: "string", format: "uuid" } },
        },
        body: {
          type: "object",
          required: ["tipo", "desde"],
          additionalProperties: false,
          properties: {
            tipo: { type: "string", enum: TIPOS },
            desde: { type: "string", format: "date-time" },
            finPrevisto: { type: "string", format: "date-time" },
            destino: { type: "string", maxLength: 200 },
            motivo: { type: "string", maxLength: 300 },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const { clientId } = request.params as { clientId: string };
      const body = request.body as {
        tipo: (typeof TIPOS)[number];
        desde: string;
        finPrevisto?: string;
        destino?: string;
        motivo?: string;
      };
      if (!(await residenteDelCentro(auth.tenantId, clientId))) {
        return reply.code(404).send({
          error: "RESIDENTE_NO_ENCONTRADO",
          message: "No hay ningún residente con esa ficha en este centro.",
        });
      }
      // Un residente dado de alta no se va a ningún sitio: ya no vive
      // aquí. Sin esto, su ausencia quedaría abierta y nadie podría
      // cerrarla desde la pantalla, que sólo lista a los que viven aquí.
      const perfil = await getPrisma().residentProfile.findUniqueOrThrow({
        where: { clientId },
        select: { dischargeDate: true },
      });
      if (perfil.dischargeDate != null) {
        return reply.code(409).send({
          error: "RESIDENTE_DADO_DE_ALTA",
          message: "Este residente ya está dado de alta: no se le pueden apuntar ausencias.",
        });
      }
      const capacidad = await capacidadParaLaAusencia(
        auth.tenantId,
        auth.userId,
        auth.role === "OWNER",
        false,
      );
      if (!capacidad.ok) {
        return reply.code(403).send({
          error: capacidad.error,
          message: capacidad.message,
        });
      }
      const prisma = getPrisma();
      return conHistoria(request, reply, { clientId, action: "WRITE" }, async () => {
        try {
          const abierta = await abrirAusencia(prisma, {
            tenantId: auth.tenantId,
            clientId,
            tipo: body.tipo,
            desde: new Date(body.desde),
            finPrevisto: body.finPrevisto ? new Date(body.finPrevisto) : null,
            destino: body.destino ?? null,
            motivo: body.motivo ?? null,
            firma: {
              userId: auth.userId,
              careRoleAssignmentId: capacidad.assignmentId,
            },
            ahora: new Date(),
          });
          return reply.code(201).send(abierta);
        } catch (err) {
          if (err instanceof AusenciaInvalida) {
            return reply.code(409).send({ error: err.codigo, message: err.message });
          }
          throw err;
        }
      });
    },
  );

  // ── CERRARLA · ha vuelto ─────────────────────────────────────────
  app.post(
    "/residencia/residentes/:clientId/ausencias/:id/vuelta",
    {
      preHandler: PUERTAS_ESCRITURA,
      schema: {
        params: {
          type: "object",
          required: ["clientId", "id"],
          additionalProperties: false,
          properties: {
            clientId: { type: "string", format: "uuid" },
            id: { type: "string", format: "uuid" },
          },
        },
        body: {
          type: "object",
          required: ["vueltaEn"],
          additionalProperties: false,
          properties: { vueltaEn: { type: "string", format: "date-time" } },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const { clientId, id } = request.params as { clientId: string; id: string };
      const { vueltaEn } = request.body as { vueltaEn: string };
      if (!(await residenteDelCentro(auth.tenantId, clientId))) {
        return reply.code(404).send({
          error: "RESIDENTE_NO_ENCONTRADO",
          message: "No hay ningún residente con esa ficha en este centro.",
        });
      }
      const capacidad = await capacidadParaLaAusencia(
        auth.tenantId,
        auth.userId,
        auth.role === "OWNER",
        false,
      );
      if (!capacidad.ok) {
        return reply.code(403).send({
          error: capacidad.error,
          message: capacidad.message,
        });
      }
      const prisma = getPrisma();
      return conHistoria(request, reply, { clientId, action: "WRITE" }, async () => {
        try {
          const r = await cerrarAusencia(prisma, {
            tenantId: auth.tenantId,
            absenceId: id,
            vueltaEn: new Date(vueltaEn),
            firma: {
              userId: auth.userId,
              careRoleAssignmentId: capacidad.assignmentId,
            },
          });
          return reply.code(200).send(r);
        } catch (err) {
          if (err instanceof AusenciaInvalida) {
            const codigo = err.codigo === "AUSENCIA_NO_ENCONTRADA" ? 404 : 409;
            return reply.code(codigo).send({ error: err.codigo, message: err.message });
          }
          throw err;
        }
      });
    },
  );

  // ── CONFIRMAR LA REVISIÓN DE LA VUELTA (D-92) ────────────────────
  //
  // Lo hace la DUE, con su capacidad. Y se puede hacer **desde el admin o
  // con su PIN**: el prompt pide las dos, y la del PIN es la de la sala y
  // la del móvil de guardia, que son rutas de otro bloque. Aquí está la
  // del admin; la del PIN se apoya en la misma función.
  app.post(
    "/residencia/residentes/:clientId/ausencias/:id/revisada",
    {
      preHandler: PUERTAS_ESCRITURA,
      schema: {
        params: {
          type: "object",
          required: ["clientId", "id"],
          additionalProperties: false,
          properties: {
            clientId: { type: "string", format: "uuid" },
            id: { type: "string", format: "uuid" },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const { clientId, id } = request.params as { clientId: string; id: string };
      if (!(await residenteDelCentro(auth.tenantId, clientId))) {
        return reply.code(404).send({
          error: "RESIDENTE_NO_ENCONTRADO",
          message: "No hay ningún residente con esa ficha en este centro.",
        });
      }
      const capacidad = await capacidadParaLaAusencia(
        auth.tenantId,
        auth.userId,
        auth.role === "OWNER",
        true,
      );
      if (!capacidad.ok) {
        return reply.code(403).send({
          error: capacidad.error,
          message: capacidad.message,
        });
      }
      const prisma = getPrisma();
      return conHistoria(request, reply, { clientId, action: "WRITE" }, async () => {
        try {
          await confirmarRevision(prisma, {
            tenantId: auth.tenantId,
            absenceId: id,
            firma: {
              userId: auth.userId,
              careRoleAssignmentId: capacidad.assignmentId,
            },
            ahora: new Date(),
          });
          return reply.code(200).send({ ok: true });
        } catch (err) {
          if (err instanceof AusenciaInvalida) {
            const codigo = err.codigo === "AUSENCIA_NO_ENCONTRADA" ? 404 : 409;
            return reply.code(codigo).send({ error: err.codigo, message: err.message });
          }
          throw err;
        }
      });
    },
  );

  // ── CORREGIR LAS FECHAS, CON FIRMA ───────────────────────────────
  //
  // La ÚNICA forma de que `started_at` o `ended_at` cambien, y lo impone
  // el trigger: esas dos fechas son días de la factura de la Junta
  // (D-93). Mismo patrón que la corrección de una obligación hecha.
  app.post(
    "/residencia/residentes/:clientId/ausencias/:id/corregir",
    {
      preHandler: PUERTAS_ESCRITURA,
      schema: {
        params: {
          type: "object",
          required: ["clientId", "id"],
          additionalProperties: false,
          properties: {
            clientId: { type: "string", format: "uuid" },
            id: { type: "string", format: "uuid" },
          },
        },
        body: {
          type: "object",
          required: ["motivo"],
          additionalProperties: false,
          properties: {
            desde: { type: "string", format: "date-time" },
            hasta: { type: "string", format: "date-time" },
            motivo: { type: "string", minLength: 1, maxLength: 300 },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const { clientId, id } = request.params as { clientId: string; id: string };
      const body = request.body as {
        desde?: string;
        hasta?: string;
        motivo: string;
      };
      if (body.desde == null && body.hasta == null) {
        return reply.code(400).send({
          error: "NADA_QUE_CORREGIR",
          message: "Di qué fecha corriges: la de salida, la de vuelta o las dos.",
        });
      }
      if (!(await residenteDelCentro(auth.tenantId, clientId))) {
        return reply.code(404).send({
          error: "RESIDENTE_NO_ENCONTRADO",
          message: "No hay ningún residente con esa ficha en este centro.",
        });
      }
      // Corregir días de factura es de supervisión, como confirmar la
      // revisión: la auxiliar apunta lo que ve, y rehacer una fecha ya
      // escrita es otra cosa.
      const capacidad = await capacidadParaLaAusencia(
        auth.tenantId,
        auth.userId,
        auth.role === "OWNER",
        true,
      );
      if (!capacidad.ok) {
        return reply.code(403).send({
          error: capacidad.error,
          message: capacidad.message,
        });
      }
      const prisma = getPrisma();
      const fila = await prisma.residentAbsence.findFirst({
        where: { id, tenantId: auth.tenantId, clientId },
        select: { id: true, startedAt: true, endedAt: true },
      });
      if (!fila) {
        return reply.code(404).send({
          error: "AUSENCIA_NO_ENCONTRADA",
          message: "Esa ausencia no está en la ficha de este residente.",
        });
      }
      const desde = body.desde ? new Date(body.desde) : fila.startedAt;
      const hasta = body.hasta ? new Date(body.hasta) : fila.endedAt;
      if (hasta != null && hasta < desde) {
        return reply.code(400).send({
          error: "VUELTA_ANTES_DE_IRSE",
          message: "La vuelta no puede ser anterior a la salida.",
        });
      }
      if (body.hasta != null && fila.endedAt == null) {
        return reply.code(409).send({
          error: "TODAVIA_NO_HA_VUELTO",
          message:
            "Esta ausencia está abierta: la vuelta se apunta con «ha vuelto», no corrigiendo.",
        });
      }
      return conHistoria(request, reply, { clientId, action: "WRITE" }, async () => {
        await prisma.residentAbsence.update({
          where: { id },
          data: {
            startedAt: desde,
            ...(body.hasta != null ? { endedAt: hasta } : {}),
            correctedAt: new Date(),
            correctedByUserId: auth.userId,
            correctionReason: body.motivo.trim(),
          },
        });
        return reply.code(200).send({ ok: true });
      });
    },
  );

  // ════════════════════════════════════════════════════════════════
  //  LOS DÍAS DEL MES (D-93)
  // ════════════════════════════════════════════════════════════════
  //
  // Por residente y por mes, y un resumen del centro. Es exactamente lo
  // que hoy se teclea a mano en `meses/AAAA-MM.json` para facturar las
  // plazas concertadas (`05-plazas-facturacion.md`).
  //
  // ── La del CENTRO no pasa por `conHistoria`, y hay que decirlo ───
  //
  // No tiene `clientId`: es un recuento agregado del centro, la misma
  // clase de dato que el panel de dirección ya devuelve sin registrar
  // accesos (residencia-5). El registro de accesos contesta «¿quién ha
  // abierto la historia de ESTE residente?» y una línea sin residente no
  // contesta eso — es la decisión 2 de residencia-1.
  //
  // **Pero lleva los nombres de los residentes**, porque una tabla de
  // facturación sin nombres no sirve, y eso es un dato personal. Por eso
  // la ruta es `requireOwnerOrManager` —no `requireOwnerOrCashier`— y el
  // alcance por zona NO se aplica: quien factura necesita el centro
  // entero, y quien factura es la dirección. Queda anotado en el `-done`.
  app.get(
    "/residencia/dias",
    {
      preHandler: PUERTAS_ESCRITURA,
      schema: {
        querystring: {
          type: "object",
          required: ["mes"],
          additionalProperties: false,
          properties: { mes: MES },
        },
      },
    },
    async (request: FastifyRequest) => {
      const auth = request.auth!;
      const { mes } = request.query as { mes: string };
      const prisma = getPrisma();

      const [perfiles, ausencias] = await Promise.all([
        prisma.residentProfile.findMany({
          where: { tenantId: auth.tenantId },
          select: {
            clientId: true,
            admissionDate: true,
            dischargeDate: true,
            placeType: true,
            client: { select: { firstName: true, lastName: true } },
          },
        }),
        // **Todas** las ausencias de todos, sin filtrar por mes: la
        // función pura recorta sola lo que cae en el mes, y pedirle al
        // llamante que filtre sería pedirle que resuelva el caso de la
        // ausencia que cruza de mes — el que se equivoca (ver
        // `diasDelMes`).
        prisma.residentAbsence.findMany({
          where: { tenantId: auth.tenantId },
          select: { clientId: true, kind: true, startedAt: true, endedAt: true },
        }),
      ]);

      const comoAusencias: AusenciaDelPlan[] = ausencias.map((a) => ({
        clientId: a.clientId,
        tipo: a.kind,
        desde: a.startedAt,
        hasta: a.endedAt,
      }));
      const comoResidentes: ResidenteParaLosDias[] = perfiles.map((p) => ({
        clientId: p.clientId,
        ingreso: p.admissionDate.toISOString().slice(0, 10),
        alta: p.dischargeDate?.toISOString().slice(0, 10) ?? null,
      }));

      const resumen = diasDelMesDelCentro(comoResidentes, comoAusencias, mes);
      const nombrePorCliente = new Map(
        perfiles.map((p) => [
          p.clientId,
          {
            nombre: `${p.client.firstName} ${p.client.lastName}`.trim(),
            plaza: p.placeType,
          },
        ]),
      );
      return {
        mes,
        // **Los que tuvieron plaza alguna noche del mes**, y no los que
        // viven aquí hoy: la factura de octubre lleva a quien se fue el
        // día 10. Los de cero noches se quitan porque una tabla con
        // cuarenta filas a cero no se lee.
        residentes: resumen.residentes
          .filter((d) => d.presencia > 0)
          .map((d) => ({
            ...d,
            nombre: nombrePorCliente.get(d.clientId)?.nombre ?? d.clientId,
            plaza: nombrePorCliente.get(d.clientId)?.plaza ?? null,
          })),
        total: resumen.total,
        // La regla de los días frontera, **dicha en la respuesta** para
        // que la pantalla la pinte y nadie dé por hecho otra cosa: de
        // serie cuenta dónde pernocta el residente (D-93), así que el día
        // del ingreso cuenta y el del alta no. Es dato por comunidad
        // autónoma y queda por contrastar con la Junta.
        reglaDeLosDiasFrontera: "PERNOCTA",
      };
    },
  );

  // Y los de UN residente, que sí pasa por `conHistoria`: aquí hay
  // `clientId` y la pregunta es sobre su historia.
  app.get(
    "/residencia/residentes/:clientId/dias",
    {
      preHandler: PUERTAS_LECTURA,
      schema: {
        params: {
          type: "object",
          required: ["clientId"],
          additionalProperties: false,
          properties: { clientId: { type: "string", format: "uuid" } },
        },
        querystring: {
          type: "object",
          required: ["mes"],
          additionalProperties: false,
          properties: { mes: MES },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const { clientId } = request.params as { clientId: string };
      const { mes } = request.query as { mes: string };
      if (!(await residenteDelCentro(auth.tenantId, clientId))) {
        return reply.code(404).send({
          error: "RESIDENTE_NO_ENCONTRADO",
          message: "No hay ningún residente con esa ficha en este centro.",
        });
      }
      const prisma = getPrisma();
      return conHistoria(request, reply, { clientId, action: "READ" }, async () => {
        const [perfil, ausencias] = await Promise.all([
          prisma.residentProfile.findUniqueOrThrow({
            where: { clientId },
            select: { admissionDate: true, dischargeDate: true },
          }),
          prisma.residentAbsence.findMany({
            where: { tenantId: auth.tenantId, clientId },
            select: { clientId: true, kind: true, startedAt: true, endedAt: true },
          }),
        ]);
        return {
          dias: diasDelMes(
            {
              clientId,
              ingreso: perfil.admissionDate.toISOString().slice(0, 10),
              alta: perfil.dischargeDate?.toISOString().slice(0, 10) ?? null,
            },
            ausencias.map((a) => ({
              clientId: a.clientId,
              tipo: a.kind,
              desde: a.startedAt,
              hasta: a.endedAt,
            })),
            mes,
          ),
          reglaDeLosDiasFrontera: "PERNOCTA",
        };
      });
    },
  );
}
