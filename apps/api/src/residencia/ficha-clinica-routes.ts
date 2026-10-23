// historia-1 (D-90, D-91, D-97) · **LAS RUTAS DE LA FICHA CLÍNICA.**
//
// Diagnósticos, alergias, dispositivos y dieta. La pantalla es **del
// admin** (D-97: de despacho, sin mockup previo por D-76), y lo que estas
// rutas hacen es traducir HTTP: quién decide qué significa cada cosa es
// `ficha-clinica.ts`.
//
// ── TODO PASA POR `conHistoria`, SIN EXCEPCIÓN ──────────────────────
//
// Es historia clínica (D-45, D-90), así que cada apertura y cada
// escritura dejan su línea en `ClinicalAccessLog`. **Ni un camino nuevo
// que se salte el registro de accesos**, que es lo que el prompt pide con
// esas palabras y lo que clinica-1 cerró de una vez.
//
// Con eso vienen gratis las cuatro cosas que un `if` de cada ruta no
// daría: el alcance por zona (D-51), el 423 del contrato de encargado
// revocado (clinica-7), el «Mi Piace no mira» y la línea del acceso
// DENEGADO — que es justo el que interesa ver.
//
// ── Y LA CAPACIDAD, ANTES DE ESCRIBIR ──────────────────────────────
//
// `capacidadParaLaFicha` contesta **con qué asignación de rol** se firma
// (D-31), no con un booleano: la fila exige
// `created_by_care_role_assignment_id` NOT NULL. Ver su cabecera para el
// caso del OWNER sin rol de cuidado, que es el que obliga a decidir algo.
//
// ── NADA SE EDITA ───────────────────────────────────────────────────
//
// No hay un solo `PATCH` de contenido en este fichero, y es la mitad de
// D-90:
//
//   · un diagnóstico se **resuelve** o se **retira**; corregirlo es
//     escribir otro;
//   · una alergia se **retira** y se escribe la buena;
//   · un dispositivo se **cierra**;
//   · una dieta se cambia escribiendo **la versión siguiente**.
//
// Los triggers del motor lo impondrían igual. Que aquí no haya ruta es
// para que nadie tenga que descubrirlo con un 500.

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import {
  CODIGOS_DE_DISPOSITIVO,
  CODIGOS_DE_RESTRICCION,
  DISPOSITIVOS_DE_SERIE,
  RESTRICCIONES_DE_SERIE,
} from "@mipiacetpv/residencia-plan";

import { getPrisma } from "../context.js";
import {
  requireOwnerOrCashier,
  requireOwnerOrManager,
} from "../auth/middleware.js";
import { asegurarDek, dekONada } from "../clinica/claves.js";
import { ensureClinicaEnabled } from "../clinica/gate.js";
import { conHistoria } from "../clinica/registro.js";
import {
  cifrarTexto,
  nuevoIdDeFila,
  sitioAgenteDeAlergia,
  sitioCodigoDeDiagnostico,
  sitioDetalleDeDispositivo,
  sitioFraseDeAlerta,
  sitioFuenteDeLaRevision,
  sitioMotivoDeRetiradaDeAlergia,
  sitioMotivoDeRetiradaDeDiagnostico,
  sitioNotasDeDieta,
  sitioReaccionDeAlergia,
  sitioTextoDeDiagnostico,
} from "../clinica/cripto-campos.js";
import { ensureResidenciaEnabled } from "./gate.js";
import {
  capacidadParaLaFicha,
  leerFicha,
  type ParteDeLaFicha,
} from "./ficha-clinica.js";

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

const CLASES_DE_ALERGIA = ["MEDICAMENTO", "ALIMENTO", "OTRA"] as const;
const GRAVEDADES = ["LEVE", "MODERADA", "GRAVE"] as const;
const TEXTURAS = ["NORMAL", "BLANDA", "TRITURADA", "ENTERAL"] as const;

const PARAMS_DEL_RESIDENTE = {
  type: "object",
  required: ["clientId"],
  additionalProperties: false,
  properties: { clientId: { type: "string", format: "uuid" } },
} as const;

/** ¿Es este residente de este centro? La 404 del aislamiento por fila,
 *  que va ANTES de la autorización clínica (residencia-1). */
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
 * El preámbulo de toda escritura de la ficha: el residente es de este
 * centro, y quien escribe tiene capacidad para esta parte.
 *
 * Devuelve la capacidad o ya ha contestado. Está en una función porque
 * son **nueve rutas** y nueve copias de estas dieciséis líneas es la
 * forma de que la décima se escriba sin el `residenteDelCentro`.
 */
async function antesDeEscribir(
  request: FastifyRequest,
  reply: FastifyReply,
  clientId: string,
  parte: ParteDeLaFicha,
): Promise<{ assignmentId: string } | null> {
  const auth = request.auth!;
  if (!(await residenteDelCentro(auth.tenantId, clientId))) {
    await reply.code(404).send({
      error: "RESIDENTE_NO_ENCONTRADO",
      message: "No hay ningún residente con esa ficha en este centro.",
    });
    return null;
  }
  const veredicto = await capacidadParaLaFicha(
    auth.tenantId,
    auth.userId,
    auth.role === "OWNER",
    parte,
  );
  if (!veredicto.ok) {
    await reply.code(403).send({
      error: veredicto.error,
      message: veredicto.message,
    });
    return null;
  }
  return { assignmentId: veredicto.capacidad.assignmentId };
}

export async function registerResidenciaFichaClinicaRoutes(
  app: FastifyInstance,
): Promise<void> {
  // ════════════════════════════════════════════════════════════════
  //  EL CATÁLOGO DEL PRODUCTO · dispositivos, restricciones, texturas
  // ════════════════════════════════════════════════════════════════
  //
  // **Sin `conHistoria`**, y es la única ruta de este fichero que no pasa
  // por él: no hay `clientId` en ninguna parte. Es la decisión 2 de
  // residencia-1 aplicada aquí — el registro de accesos contesta «¿quién
  // ha abierto la historia de ESTE residente?», y una línea sin residente
  // no contesta eso.
  //
  // Lo que devuelve es el fichero de datos del paquete puro, para que la
  // pantalla no tenga una segunda copia de los diez dispositivos.
  app.get(
    "/residencia/ficha/catalogo",
    { preHandler: PUERTAS_LECTURA },
    async () => ({
      dispositivos: DISPOSITIVOS_DE_SERIE.map((d) => ({
        code: d.code,
        nombre: d.name,
        // La pantalla lo pinta para que quien escribe sepa que ese
        // dispositivo va a salir en la franja de la puerta.
        deRiesgo: d.riesgo,
      })),
      restricciones: RESTRICCIONES_DE_SERIE.map((r) => ({
        code: r.code,
        nombre: r.name,
      })),
      texturas: TEXTURAS,
      clasesDeAlergia: CLASES_DE_ALERGIA,
      gravedades: GRAVEDADES,
    }),
  );

  // ════════════════════════════════════════════════════════════════
  //  LA FICHA ENTERA
  // ════════════════════════════════════════════════════════════════
  app.get(
    "/residencia/residentes/:clientId/ficha",
    {
      preHandler: PUERTAS_LECTURA,
      schema: { params: PARAMS_DEL_RESIDENTE },
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
        return { ficha: await leerFicha(prisma, auth.tenantId, clientId, dek) };
      });
    },
  );

  // ════════════════════════════════════════════════════════════════
  //  DIAGNÓSTICOS
  // ════════════════════════════════════════════════════════════════
  app.post(
    "/residencia/residentes/:clientId/diagnosticos",
    {
      preHandler: PUERTAS_ESCRITURA,
      schema: {
        params: PARAMS_DEL_RESIDENTE,
        body: {
          type: "object",
          required: ["texto", "diagnosedOn"],
          additionalProperties: false,
          properties: {
            texto: { type: "string", minLength: 1, maxLength: 500 },
            icd10: { type: "string", maxLength: 16 },
            quirurgico: { type: "boolean" },
            diagnosedOn: { type: "string", format: "date" },
            alerta: { type: "boolean" },
            // **La frase es obligatoria con la marca puesta**, y lo
            // comprueba el handler además del CHECK: un 400 con su
            // mensaje se entiende y un 500 de Postgres no.
            fraseDeAlerta: { type: "string", maxLength: 120 },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const { clientId } = request.params as { clientId: string };
      const body = request.body as {
        texto: string;
        icd10?: string;
        quirurgico?: boolean;
        diagnosedOn: string;
        alerta?: boolean;
        fraseDeAlerta?: string;
      };
      const alerta = body.alerta === true;
      const frase = body.fraseDeAlerta?.trim() ?? "";
      if (alerta && frase === "") {
        return reply.code(400).send({
          error: "FALTA_LA_FRASE_DE_ALERTA",
          message:
            "Un diagnóstico marcado como alerta necesita la frase que verá la auxiliar en la puerta: qué tiene que hacer, no el diagnóstico.",
        });
      }
      if (!alerta && frase !== "") {
        return reply.code(400).send({
          error: "FRASE_SIN_ALERTA",
          message:
            "La frase de alerta sólo tiene sentido con la marca puesta: sin ella nadie la ve y se queda vieja.",
        });
      }
      const capacidad = await antesDeEscribir(request, reply, clientId, "DIAGNOSTICOS");
      if (!capacidad) return reply;

      const prisma = getPrisma();
      return conHistoria(request, reply, { clientId, action: "WRITE" }, async () => {
        // El id ANTES de insertar: el AAD lo necesita (clinica-7 §3).
        const id = nuevoIdDeFila();
        const dek = await asegurarDek(auth.tenantId, prisma);
        await prisma.residentDiagnosis.create({
          data: {
            id,
            tenantId: auth.tenantId,
            clientId,
            textCifrado: cifrarTexto(
              body.texto.trim(),
              dek,
              sitioTextoDeDiagnostico(auth.tenantId, id),
            )!,
            icd10Cifrado: cifrarTexto(
              body.icd10?.trim() || null,
              dek,
              sitioCodigoDeDiagnostico(auth.tenantId, id),
            ),
            surgical: body.quirurgico === true,
            diagnosedOn: new Date(body.diagnosedOn),
            alertFlag: alerta,
            alertPhraseCifrado: alerta
              ? cifrarTexto(frase, dek, sitioFraseDeAlerta(auth.tenantId, id))
              : null,
            createdByUserId: auth.userId,
            createdByCareRoleAssignmentId: capacidad.assignmentId,
          },
        });
        return reply.code(201).send({ id });
      });
    },
  );

  // Resolverlo. **No es editarlo**: el diagnóstico se queda, con su fecha
  // de resolución y su firma.
  app.post(
    "/residencia/residentes/:clientId/diagnosticos/:id/resolver",
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
          required: ["resolvedOn"],
          additionalProperties: false,
          properties: { resolvedOn: { type: "string", format: "date" } },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const { clientId, id } = request.params as { clientId: string; id: string };
      const { resolvedOn } = request.body as { resolvedOn: string };
      const capacidad = await antesDeEscribir(request, reply, clientId, "DIAGNOSTICOS");
      if (!capacidad) return reply;
      const prisma = getPrisma();
      const fila = await prisma.residentDiagnosis.findFirst({
        where: { id, clientId, tenantId: auth.tenantId },
        select: { id: true, diagnosedOn: true, resolvedOn: true, withdrawnAt: true },
      });
      if (!fila) {
        return reply.code(404).send({
          error: "DIAGNOSTICO_NO_ENCONTRADO",
          message: "Ese diagnóstico no está en la ficha de este residente.",
        });
      }
      if (fila.resolvedOn != null) {
        return reply.code(409).send({
          error: "YA_ESTABA_RESUELTO",
          message:
            "Ese diagnóstico ya estaba resuelto. Si ha vuelto, se escribe uno nuevo con la fecha de hoy.",
        });
      }
      if (fila.withdrawnAt != null) {
        return reply.code(409).send({
          error: "ESTABA_RETIRADO",
          message: "Ese diagnóstico está retirado: no se resuelve.",
        });
      }
      const fecha = new Date(resolvedOn);
      if (fecha < fila.diagnosedOn) {
        return reply.code(400).send({
          error: "RESUELTO_ANTES_DE_DIAGNOSTICAR",
          message: "La fecha de resolución no puede ser anterior a la del diagnóstico.",
        });
      }
      return conHistoria(request, reply, { clientId, action: "WRITE" }, async () => {
        await prisma.residentDiagnosis.update({
          where: { id },
          data: { resolvedOn: fecha, resolvedByUserId: auth.userId },
        });
        return reply.code(200).send({ ok: true });
      });
    },
  );

  // Retirarlo: **estaba mal escrito**. Deja de contar en la ficha y en la
  // franja, y sigue en la historia.
  app.post(
    "/residencia/residentes/:clientId/diagnosticos/:id/retirar",
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
          properties: { motivo: { type: "string", minLength: 1, maxLength: 300 } },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const { clientId, id } = request.params as { clientId: string; id: string };
      const { motivo } = request.body as { motivo: string };
      const capacidad = await antesDeEscribir(request, reply, clientId, "DIAGNOSTICOS");
      if (!capacidad) return reply;
      const prisma = getPrisma();
      const fila = await prisma.residentDiagnosis.findFirst({
        where: { id, clientId, tenantId: auth.tenantId },
        select: { id: true, withdrawnAt: true },
      });
      if (!fila) {
        return reply.code(404).send({
          error: "DIAGNOSTICO_NO_ENCONTRADO",
          message: "Ese diagnóstico no está en la ficha de este residente.",
        });
      }
      if (fila.withdrawnAt != null) {
        return reply.code(409).send({
          error: "YA_ESTABA_RETIRADO",
          message: "Ese diagnóstico ya estaba retirado, y una retirada no se deshace.",
        });
      }
      return conHistoria(request, reply, { clientId, action: "WRITE" }, async () => {
        const dek = await asegurarDek(auth.tenantId, prisma);
        await prisma.residentDiagnosis.update({
          where: { id },
          data: {
            withdrawnAt: new Date(),
            withdrawnByUserId: auth.userId,
            withdrawReasonCifrado: cifrarTexto(
              motivo.trim(),
              dek,
              sitioMotivoDeRetiradaDeDiagnostico(auth.tenantId, id),
            ),
          },
        });
        return reply.code(200).send({ ok: true });
      });
    },
  );

  // ════════════════════════════════════════════════════════════════
  //  ALERGIAS
  // ════════════════════════════════════════════════════════════════
  app.post(
    "/residencia/residentes/:clientId/alergias",
    {
      preHandler: PUERTAS_ESCRITURA,
      schema: {
        params: PARAMS_DEL_RESIDENTE,
        body: {
          type: "object",
          required: ["clase", "gravedad", "agente"],
          additionalProperties: false,
          properties: {
            clase: { type: "string", enum: CLASES_DE_ALERGIA },
            gravedad: { type: "string", enum: GRAVEDADES },
            agente: { type: "string", minLength: 1, maxLength: 160 },
            reaccion: { type: "string", maxLength: 300 },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const { clientId } = request.params as { clientId: string };
      const body = request.body as {
        clase: (typeof CLASES_DE_ALERGIA)[number];
        gravedad: (typeof GRAVEDADES)[number];
        agente: string;
        reaccion?: string;
      };
      const capacidad = await antesDeEscribir(request, reply, clientId, "ALERGIAS");
      if (!capacidad) return reply;
      const prisma = getPrisma();
      return conHistoria(request, reply, { clientId, action: "WRITE" }, async () => {
        const id = nuevoIdDeFila();
        const dek = await asegurarDek(auth.tenantId, prisma);
        await prisma.allergy.create({
          data: {
            id,
            tenantId: auth.tenantId,
            clientId,
            class: body.clase,
            severity: body.gravedad,
            agentCifrado: cifrarTexto(
              body.agente.trim(),
              dek,
              sitioAgenteDeAlergia(auth.tenantId, id),
            )!,
            reactionCifrado: cifrarTexto(
              body.reaccion?.trim() || null,
              dek,
              sitioReaccionDeAlergia(auth.tenantId, id),
            ),
            createdByUserId: auth.userId,
            createdByCareRoleAssignmentId: capacidad.assignmentId,
          },
        });
        return reply.code(201).send({ id });
      });
    },
  );

  // Retirarla. **La única forma de corregir una alergia**: la fila vieja
  // se queda y se escribe la buena, así que quien prescribe ve que
  // alguien se equivocó y cuándo. Un `UPDATE` dejaría una historia que
  // dice que siempre fue «paracetamol» — y lo para el trigger
  // `allergies_inmutable`.
  app.post(
    "/residencia/residentes/:clientId/alergias/:id/retirar",
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
          properties: { motivo: { type: "string", minLength: 1, maxLength: 300 } },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const { clientId, id } = request.params as { clientId: string; id: string };
      const { motivo } = request.body as { motivo: string };
      const capacidad = await antesDeEscribir(request, reply, clientId, "ALERGIAS");
      if (!capacidad) return reply;
      const prisma = getPrisma();
      const fila = await prisma.allergy.findFirst({
        where: { id, clientId, tenantId: auth.tenantId },
        select: { id: true, withdrawnAt: true },
      });
      if (!fila) {
        return reply.code(404).send({
          error: "ALERGIA_NO_ENCONTRADA",
          message: "Esa alergia no está en la ficha de este residente.",
        });
      }
      if (fila.withdrawnAt != null) {
        return reply.code(409).send({
          error: "YA_ESTABA_RETIRADA",
          message: "Esa alergia ya estaba retirada, y una retirada no se deshace.",
        });
      }
      return conHistoria(request, reply, { clientId, action: "WRITE" }, async () => {
        const dek = await asegurarDek(auth.tenantId, prisma);
        await prisma.allergy.update({
          where: { id },
          data: {
            withdrawnAt: new Date(),
            withdrawnByUserId: auth.userId,
            withdrawReasonCifrado: cifrarTexto(
              motivo.trim(),
              dek,
              sitioMotivoDeRetiradaDeAlergia(auth.tenantId, id),
            ),
          },
        });
        return reply.code(200).send({ ok: true });
      });
    },
  );

  // ── **«SIN ALERGIAS CONOCIDAS» SE REGISTRA** (D-90) ───────────────
  //
  // La ruta que hace que «nadie le ha preguntado» y «se le preguntó y no
  // tiene» dejen de ser el mismo `COUNT(*) = 0`. Medicación (Fase 2) va a
  // bloquear sobre esa diferencia.
  //
  // De sólo inserción: cada revisión es una fila con su autor, su
  // capacidad y su fecha. Volver a revisar no pisa la anterior — el
  // histórico cuenta cuándo se preguntó por última vez, que es lo que un
  // inspector pide.
  app.post(
    "/residencia/residentes/:clientId/alergias/revision",
    {
      preHandler: PUERTAS_ESCRITURA,
      schema: {
        params: PARAMS_DEL_RESIDENTE,
        body: {
          type: "object",
          required: ["sinAlergiasConocidas"],
          additionalProperties: false,
          properties: {
            sinAlergiasConocidas: { type: "boolean" },
            fuente: { type: "string", maxLength: 300 },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const { clientId } = request.params as { clientId: string };
      const body = request.body as {
        sinAlergiasConocidas: boolean;
        fuente?: string;
      };
      const capacidad = await antesDeEscribir(request, reply, clientId, "ALERGIAS");
      if (!capacidad) return reply;
      const prisma = getPrisma();

      // «Sin alergias conocidas» con alergias vigentes apuntadas es una
      // contradicción, y se contesta con un 409 en vez de dejar la ficha
      // diciendo las dos cosas. La que manda sería la última revisión, y
      // entonces medicación dejaría prescribir penicilina a alguien con
      // una alergia a la penicilina en su ficha.
      if (body.sinAlergiasConocidas) {
        const vigentes = await prisma.allergy.count({
          where: { tenantId: auth.tenantId, clientId, withdrawnAt: null },
        });
        if (vigentes > 0) {
          return reply.code(409).send({
            error: "TIENE_ALERGIAS_APUNTADAS",
            message: `Este residente tiene ${vigentes} alergia(s) vigente(s) en su ficha. Retíralas con su motivo antes de registrar «sin alergias conocidas».`,
          });
        }
      }

      return conHistoria(request, reply, { clientId, action: "WRITE" }, async () => {
        const id = nuevoIdDeFila();
        const dek = await asegurarDek(auth.tenantId, prisma);
        await prisma.allergyReview.create({
          data: {
            id,
            tenantId: auth.tenantId,
            clientId,
            noneKnown: body.sinAlergiasConocidas,
            sourceCifrado: cifrarTexto(
              body.fuente?.trim() || null,
              dek,
              sitioFuenteDeLaRevision(auth.tenantId, id),
            ),
            reviewedByUserId: auth.userId,
            reviewedByCareRoleAssignmentId: capacidad.assignmentId,
          },
        });
        return reply.code(201).send({ id });
      });
    },
  );

  // ════════════════════════════════════════════════════════════════
  //  DISPOSITIVOS Y AYUDAS
  // ════════════════════════════════════════════════════════════════
  app.post(
    "/residencia/residentes/:clientId/dispositivos",
    {
      preHandler: PUERTAS_ESCRITURA,
      schema: {
        params: PARAMS_DEL_RESIDENTE,
        body: {
          type: "object",
          required: ["code", "desde"],
          additionalProperties: false,
          properties: {
            code: { type: "string", enum: CODIGOS_DE_DISPOSITIVO as string[] },
            detalle: { type: "string", maxLength: 200 },
            desde: { type: "string", format: "date" },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const { clientId } = request.params as { clientId: string };
      const body = request.body as { code: string; detalle?: string; desde: string };
      // `OTRO` exige detalle: un «otro» sin decir qué es no sirve de nada
      // en un parte. El CHECK lo pararía igual; esto es para que el
      // mensaje lo entienda alguien.
      if (body.code === "OTRO" && (body.detalle?.trim() ?? "") === "") {
        return reply.code(400).send({
          error: "OTRO_SIN_DETALLE",
          message: "Si eliges «Otro», di cuál: un «otro» a secas no dice nada en un parte.",
        });
      }
      const capacidad = await antesDeEscribir(request, reply, clientId, "DISPOSITIVOS");
      if (!capacidad) return reply;
      const prisma = getPrisma();
      return conHistoria(request, reply, { clientId, action: "WRITE" }, async () => {
        const id = nuevoIdDeFila();
        const dek = await asegurarDek(auth.tenantId, prisma);
        await prisma.residentDevice.create({
          data: {
            id,
            tenantId: auth.tenantId,
            clientId,
            code: body.code,
            detailCifrado: cifrarTexto(
              body.detalle?.trim() || null,
              dek,
              sitioDetalleDeDispositivo(auth.tenantId, id),
            ),
            fromOn: new Date(body.desde),
            createdByUserId: auth.userId,
            createdByCareRoleAssignmentId: capacidad.assignmentId,
          },
        });
        return reply.code(201).send({ id });
      });
    },
  );

  // Cerrarlo: «dejó el andador en mayo». No se borra.
  app.post(
    "/residencia/residentes/:clientId/dispositivos/:id/cerrar",
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
          required: ["hasta"],
          additionalProperties: false,
          properties: { hasta: { type: "string", format: "date" } },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const { clientId, id } = request.params as { clientId: string; id: string };
      const { hasta } = request.body as { hasta: string };
      const capacidad = await antesDeEscribir(request, reply, clientId, "DISPOSITIVOS");
      if (!capacidad) return reply;
      const prisma = getPrisma();
      const fila = await prisma.residentDevice.findFirst({
        where: { id, clientId, tenantId: auth.tenantId },
        select: { id: true, fromOn: true, toOn: true },
      });
      if (!fila) {
        return reply.code(404).send({
          error: "DISPOSITIVO_NO_ENCONTRADO",
          message: "Ese dispositivo no está en la ficha de este residente.",
        });
      }
      if (fila.toOn != null) {
        return reply.code(409).send({
          error: "YA_ESTABA_CERRADO",
          message: "Ese dispositivo ya estaba cerrado.",
        });
      }
      const fecha = new Date(hasta);
      if (fecha < fila.fromOn) {
        return reply.code(400).send({
          error: "CIERRE_ANTES_DEL_INICIO",
          message: "La fecha de retirada no puede ser anterior a la de inicio.",
        });
      }
      return conHistoria(request, reply, { clientId, action: "WRITE" }, async () => {
        await prisma.residentDevice.update({
          where: { id },
          data: { toOn: fecha, closedByUserId: auth.userId },
        });
        return reply.code(200).send({ ok: true });
      });
    },
  );

  // ════════════════════════════════════════════════════════════════
  //  LA DIETA · **UNA VERSIÓN NUEVA, NUNCA UN `UPDATE`**
  // ════════════════════════════════════════════════════════════════
  //
  // Una sola ruta y es un `POST`: cambiar la dieta es escribir la versión
  // siguiente. Las dos escrituras —jubilar la vigente y crear la nueva—
  // van en la MISMA transacción, porque el índice parcial
  // `diet_profiles_una_viva_key` sólo deja una viva: con la mitad hecha,
  // la cocina no tendría ninguna dieta o tendría dos.
  app.post(
    "/residencia/residentes/:clientId/dieta",
    {
      preHandler: PUERTAS_ESCRITURA,
      schema: {
        params: PARAMS_DEL_RESIDENTE,
        body: {
          type: "object",
          required: ["textura"],
          additionalProperties: false,
          properties: {
            textura: { type: "string", enum: TEXTURAS },
            espesante: { type: "boolean" },
            nivelDeEspesante: { type: "integer", minimum: 1, maximum: 3 },
            restricciones: {
              type: "array",
              maxItems: 8,
              items: { type: "string", enum: CODIGOS_DE_RESTRICCION as string[] },
            },
            notas: { type: "string", maxLength: 500 },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const { clientId } = request.params as { clientId: string };
      const body = request.body as {
        textura: (typeof TEXTURAS)[number];
        espesante?: boolean;
        nivelDeEspesante?: number;
        restricciones?: string[];
        notas?: string;
      };
      const espesante = body.espesante === true;
      if (espesante && body.nivelDeEspesante == null) {
        return reply.code(400).send({
          error: "FALTA_EL_NIVEL_DEL_ESPESANTE",
          message: "Un espesante sin nivel no se puede preparar: di si es 1, 2 o 3.",
        });
      }
      if (!espesante && body.nivelDeEspesante != null) {
        return reply.code(400).send({
          error: "NIVEL_SIN_ESPESANTE",
          message: "Has puesto un nivel de espesante y no has marcado que lleve espesante.",
        });
      }
      const capacidad = await antesDeEscribir(request, reply, clientId, "DIETA");
      if (!capacidad) return reply;
      const prisma = getPrisma();
      return conHistoria(request, reply, { clientId, action: "WRITE" }, async () => {
        const id = nuevoIdDeFila();
        // Las restricciones **sin repetidas y en el orden del catálogo**:
        // así dos dietas con las mismas restricciones escritas en otro
        // orden se leen igual y la hoja de cocina de cocina-1 las puede
        // agrupar.
        const pedidas = new Set(body.restricciones ?? []);
        const restricciones = CODIGOS_DE_RESTRICCION.filter((c) => pedidas.has(c));
        const resultado = await prisma.$transaction(async (tx) => {
          const dek = await asegurarDek(auth.tenantId, tx);
          const vigente = await tx.dietProfile.findFirst({
            where: { tenantId: auth.tenantId, clientId, supersededAt: null },
            select: { id: true, version: true },
          });
          if (vigente) {
            await tx.dietProfile.update({
              where: { id: vigente.id },
              data: { supersededAt: new Date() },
            });
          }
          await tx.dietProfile.create({
            data: {
              id,
              tenantId: auth.tenantId,
              clientId,
              version: (vigente?.version ?? 0) + 1,
              texture: body.textura,
              thickener: espesante,
              thickenerLevel: espesante ? (body.nivelDeEspesante ?? null) : null,
              restrictions: restricciones,
              notesCifrado: cifrarTexto(
                body.notas?.trim() || null,
                dek,
                sitioNotasDeDieta(auth.tenantId, id),
              ),
              createdByUserId: auth.userId,
              createdByCareRoleAssignmentId: capacidad.assignmentId,
            },
          });
          return { version: (vigente?.version ?? 0) + 1 };
        });
        return reply.code(201).send({ id, version: resultado.version });
      });
    },
  );
}
