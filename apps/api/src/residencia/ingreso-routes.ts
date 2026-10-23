// historia-1 (D-94, D-96, D-97) · **LAS RUTAS DEL INGRESO GUIADO Y LOS
// DOS PLAZOS DEL CENTRO.**
//
// La pantalla es del admin (D-97). Lo que estas rutas hacen es traducir
// HTTP; quién sabe qué significa cada elemento es `ingreso.ts`.
//
// ── QUÉ PASA POR `conHistoria` Y QUÉ NO ────────────────────────────
//
// **La lista de UN residente, sí**: dice qué le falta de su expediente,
// y para calcular los `auto` se leen sus alergias revisadas y su dieta —
// que es historia clínica. Marcar un elemento, también.
//
// **La lista del CENTRO, no**: es el agregado del panel de dirección
// («qué ingresos tienen pendientes»), la misma clase de dato que
// residencia-5 ya devuelve sin registrar accesos. El registro contesta
// «¿quién ha abierto la historia de ESTE residente?» y una línea sin
// residente no contesta eso (decisión 2 de residencia-1). Lleva nombres,
// así que es `requireOwnerOrManager` y queda anotado en el `-done`.
//
// **Los plazos del centro, tampoco**: son dos números de configuración.

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import { getPrisma } from "../context.js";
import {
  requireOwner,
  requireOwnerOrCashier,
  requireOwnerOrManager,
} from "../auth/middleware.js";
import { asegurarDek, dekONada } from "../clinica/claves.js";
import { ensureClinicaEnabled } from "../clinica/gate.js";
import { conHistoria } from "../clinica/registro.js";
import {
  cifrarTexto,
  leerTexto,
  sitioNotaDelIngreso,
} from "../clinica/cripto-campos.js";
import {
  decodificarEvidencia,
  guardarFichero,
  leerFichero,
  MIME_DE_PDF,
} from "../clinica/ficheros.js";
import { vistaDeConsentimientos } from "../clinica/consentimientos.js";
import { ensureResidenciaEnabled } from "./gate.js";
import {
  CODIGOS_DE_ELEMENTO,
  crearChecklistDeIngreso,
  elementoDeSerie,
  estadoDeLosIngresos,
  plazosDelCentro,
} from "./ingreso.js";
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
/** Los plazos del centro, como los roles de cuidado y el PIN: `requireOwner`.
 *  De `dischargeNoticeDays` depende una obligación legal con la
 *  administración, y eso lo decide quien dirige (D-61). */
const PUERTAS_DE_LOS_PLAZOS = [
  requireOwner,
  ensureClinicaEnabled,
  ensureResidenciaEnabled,
];

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

export async function registerResidenciaIngresoRoutes(
  app: FastifyInstance,
): Promise<void> {
  // ════════════════════════════════════════════════════════════════
  //  LOS INGRESOS DEL CENTRO · la fila del panel de dirección
  // ════════════════════════════════════════════════════════════════
  app.get(
    "/residencia/ingresos",
    {
      preHandler: PUERTAS_ESCRITURA,
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            // `true` = sólo los que tienen algo pendiente, que es lo que
            // el panel pinta. Por defecto todos, que es lo que la
            // pantalla de ingresos pinta.
            soloPendientes: { type: "boolean" },
          },
        },
      },
    },
    async (request: FastifyRequest) => {
      const auth = request.auth!;
      const { soloPendientes } = request.query as { soloPendientes?: boolean };
      const ingresos = await estadoDeLosIngresos(getPrisma(), auth.tenantId);
      return {
        ingresos: soloPendientes
          ? ingresos.filter((i) => i.pendientes > 0)
          : ingresos,
      };
    },
  );

  // ════════════════════════════════════════════════════════════════
  //  LA LISTA DE UN RESIDENTE
  // ════════════════════════════════════════════════════════════════
  app.get(
    "/residencia/residentes/:clientId/ingreso",
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
        const [lista] = await estadoDeLosIngresos(prisma, auth.tenantId, {
          clientIds: [clientId],
        });
        if (lista == null) {
          // Un residente sin lista: ingresó antes de este bloque. **No se
          // le inventa una** desde una ruta de lectura (escribir en un
          // `GET` es la clase de sorpresa que nadie espera); la pantalla
          // enseña el botón de crearla, que es el `POST` de abajo.
          return { ingreso: null, sinLista: true };
        }
        // Las notas, que `estadoDeLosIngresos` deja a `null` porque no
        // tiene la DEK (el panel pide 49 residentes y no necesita ni una).
        // Aquí sí: es la ficha de uno.
        const dek = await dekONada(auth.tenantId, prisma);
        const notas = await prisma.admissionChecklistItem.findMany({
          where: { tenantId: auth.tenantId, clientId },
          select: { id: true, code: true, doneNoteCifrado: true },
        });
        const notaPorCodigo = new Map(
          notas.map((n) => [
            n.code,
            leerTexto(
              { cifrado: n.doneNoteCifrado, claro: null },
              dek,
              sitioNotaDelIngreso(auth.tenantId, n.id),
            ),
          ]),
        );
        return {
          ingreso: {
            ...lista,
            elementos: lista.elementos.map((e) => ({
              ...e,
              nota: notaPorCodigo.get(e.code) ?? null,
            })),
          },
          sinLista: false,
        };
      });
    },
  );

  // ── CREAR LA LISTA de un residente que ingresó ANTES del bloque ──
  //
  // Los que ingresaron con residencia-1 a -6 no tienen lista: nadie se la
  // inventa en una migración (sería un `UPDATE … SET` sobre datos, y
  // además habría que decidir la fecha límite del PAI de alguien que
  // ingresó hace cuatro meses — un plazo ya vencido inventado por el
  // programa).
  //
  // Así que la crea la dirección con un botón, y **desde hoy**: el plazo
  // del PAI de un residente al que se le crea la lista en octubre corre
  // desde octubre, no desde su ingreso. Es lo honesto —el plazo no puede
  // nacer vencido por un cambio de versión del producto— y queda dicho en
  // la pantalla.
  app.post(
    "/residencia/residentes/:clientId/ingreso",
    {
      preHandler: PUERTAS_ESCRITURA,
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
      return conHistoria(request, reply, { clientId, action: "WRITE" }, async () => {
        const plazos = await plazosDelCentro(prisma, auth.tenantId);
        const r = await crearChecklistDeIngreso(prisma, {
          tenantId: auth.tenantId,
          clientId,
          // **Hoy**, no la fecha de ingreso. Ver la cabecera.
          ingreso: new Date().toISOString().slice(0, 10),
          diasDePai: plazos.diasDePai,
        });
        return reply.code(201).send(r);
      });
    },
  );

  // ── MARCAR UN ELEMENTO ───────────────────────────────────────────
  //
  // Sólo los de **marcar a mano**. Los `auto` se comprueban, y marcarlos
  // es justo la forma de que la lista mienta: el CHECK
  // `admission_checklist_items_hecho_completo` los rechaza, y aquí se
  // contesta 409 con su explicación en vez de dejar que salga un 500.
  app.post(
    "/residencia/residentes/:clientId/ingreso/:code/hecho",
    {
      preHandler: PUERTAS_ESCRITURA,
      schema: {
        params: {
          type: "object",
          required: ["clientId", "code"],
          additionalProperties: false,
          properties: {
            clientId: { type: "string", format: "uuid" },
            code: { type: "string", enum: CODIGOS_DE_ELEMENTO as string[] },
          },
        },
        body: {
          type: "object",
          additionalProperties: false,
          properties: { nota: { type: "string", maxLength: 300 } },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const { clientId, code } = request.params as { clientId: string; code: string };
      const { nota } = (request.body ?? {}) as { nota?: string };
      if (!(await residenteDelCentro(auth.tenantId, clientId))) {
        return reply.code(404).send({
          error: "RESIDENTE_NO_ENCONTRADO",
          message: "No hay ningún residente con esa ficha en este centro.",
        });
      }
      const prisma = getPrisma();
      const fila = await prisma.admissionChecklistItem.findFirst({
        where: { tenantId: auth.tenantId, clientId, code },
        select: { id: true, auto: true, doneAt: true },
      });
      if (!fila) {
        return reply.code(404).send({
          error: "ELEMENTO_NO_ENCONTRADO",
          message:
            "Ese elemento no está en la lista de este residente. Si ingresó antes de que la lista existiera, créala primero.",
        });
      }
      if (fila.auto) {
        const serie = elementoDeSerie(code);
        return reply.code(409).send({
          error: "ELEMENTO_AUTOMATICO",
          message: `«${serie?.name ?? code}» se comprueba solo cuando el dato existe: no se marca a mano. Si sale pendiente, lo que falta es el dato.`,
        });
      }
      if (fila.doneAt != null) {
        return reply.code(409).send({
          error: "YA_ESTABA_HECHO",
          message: "Ese elemento ya estaba marcado, con su firma y su fecha.",
        });
      }
      const roles = await capacidadesVigentes(
        prisma,
        auth.tenantId,
        auth.userId,
        new Date(),
      );
      if (roles.length === 0) {
        return reply.code(403).send({
          error: "SIN_ROL_DE_CUIDADO",
          message:
            auth.role === "OWNER"
              ? "Marcar un elemento del expediente lleva firma. Asígnate un rol de cuidado en Personal."
              : "No tienes ningún rol de cuidado vigente en este centro. Pídeselo a la dirección en Personal.",
        });
      }
      return conHistoria(request, reply, { clientId, action: "WRITE" }, async () => {
        const dek = await asegurarDek(auth.tenantId, prisma);
        await prisma.admissionChecklistItem.update({
          where: { id: fila.id },
          data: {
            doneAt: new Date(),
            doneByUserId: auth.userId,
            doneByCareRoleAssignmentId: roles[0]!.assignmentId,
            doneNoteCifrado: cifrarTexto(
              nota?.trim() || null,
              dek,
              sitioNotaDelIngreso(auth.tenantId, fila.id),
            ),
          },
        });
        return reply.code(200).send({ ok: true });
      });
    },
  );

  // ── EL CONTRATO FIRMADO, EN PDF ──────────────────────────────────
  //
  // Mismo mecanismo que la evidencia de una obligación y que la foto del
  // residente: **primero el fichero, después la fila**. Al revés, un
  // fallo de disco dejaría una fila que dice «el contrato está firmado»
  // apuntando a un PDF que no existe, y eso en un expediente que la
  // inspección revisa (R20) es peor que no tener la fila.
  app.put(
    "/residencia/residentes/:clientId/ingreso/contrato",
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
          required: ["pdfBase64"],
          additionalProperties: false,
          properties: { pdfBase64: { type: "string", maxLength: 8_000_000 } },
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
      const fila = await prisma.admissionChecklistItem.findFirst({
        where: { tenantId: auth.tenantId, clientId, code: "CONTRATO" },
        select: { id: true, doneAt: true },
      });
      if (!fila) {
        return reply.code(404).send({
          error: "ELEMENTO_NO_ENCONTRADO",
          message:
            "Este residente no tiene lista de ingreso. Créala antes de adjuntar el contrato.",
        });
      }
      const roles = await capacidadesVigentes(
        prisma,
        auth.tenantId,
        auth.userId,
        new Date(),
      );
      if (roles.length === 0) {
        return reply.code(403).send({
          error: "SIN_ROL_DE_CUIDADO",
          message:
            "Adjuntar el contrato lleva firma. Asígnate un rol de cuidado en Personal.",
        });
      }
      return conHistoria(request, reply, { clientId, action: "WRITE" }, async () => {
        let pdf: Buffer;
        try {
          pdf = decodificarEvidencia(request.body);
        } catch (err) {
          return reply.code(400).send({
            error: "CONTRATO_INVALIDO",
            message: (err as Error).message,
          });
        }
        const dek = await asegurarDek(auth.tenantId, prisma);
        const guardado = await guardarFichero("CONTRATO", pdf, {
          tenantId: auth.tenantId,
          dek,
        });
        await prisma.admissionChecklistItem.update({
          where: { id: fila.id },
          data: {
            fileName: guardado.fileName,
            fileSha256: guardado.sha256,
            fileBytes: guardado.bytes,
            fileMimeType: MIME_DE_PDF,
            // Adjuntar el contrato **lo marca hecho**, si no lo estaba: lo
            // que el elemento pide es el contrato, y pedir dos toques
            // (adjuntar y marcar) es pedir que alguien se olvide del
            // segundo y la lista mienta al revés.
            ...(fila.doneAt == null
              ? {
                  doneAt: new Date(),
                  doneByUserId: auth.userId,
                  doneByCareRoleAssignmentId: roles[0]!.assignmentId,
                }
              : {}),
          },
        });
        return reply.code(200).send({ bytes: guardado.bytes });
      });
    },
  );

  // Y servirlo. Por `conHistoria`, con su línea en el registro.
  app.get(
    "/residencia/residentes/:clientId/ingreso/contrato",
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
        const fila = await prisma.admissionChecklistItem.findFirst({
          where: { tenantId: auth.tenantId, clientId, code: "CONTRATO" },
          select: { fileName: true, fileSha256: true, fileMimeType: true },
        });
        if (!fila?.fileName) {
          return reply.code(404).send({
            error: "SIN_CONTRATO",
            message: "Este residente no tiene contrato adjunto.",
          });
        }
        const dek = await dekONada(auth.tenantId, prisma);
        const leido = await leerFichero(
          "CONTRATO",
          fila.fileName,
          fila.fileSha256,
          { tenantId: auth.tenantId, dek },
        );
        if (!leido) {
          return reply.code(404).send({
            error: "CONTRATO_NO_LEGIBLE",
            message:
              "El contrato está anotado en el expediente y no se puede leer del volumen. Avisa a Mi Piace.",
          });
        }
        return reply
          .code(200)
          .header("Content-Type", fila.fileMimeType ?? MIME_DE_PDF)
          // La huella se vuelve a calcular sobre el fichero y se dice si
          // cuadra, igual que el PDF de un consentimiento (clinica-4): se
          // sirve con el aviso en vez de esconderlo.
          .header("X-Huella-Cuadra", leido.huellaCuadra ? "si" : "no")
          .header("Cache-Control", "no-store")
          .send(leido.contenido);
      });
    },
  );

  // ════════════════════════════════════════════════════════════════
  //  LOS CONSENTIMIENTOS DEL INGRESO (D-95)
  // ════════════════════════════════════════════════════════════════
  //
  // **Sólo la LISTA.** Firmar y revocar son las rutas de clinica-4 tal
  // cual (`POST /clinica/clients/:clientId/consentimientos`), que es lo
  // que D-95 pide con esas palabras: *«sin tocar el mecanismo de
  // clinica-4»*. Lo único que hacía falta era que cada pantalla ofrezca
  // sus plantillas — ver `AmbitoDeLasPlantillas`.
  //
  // Y es una ruta de residencia y no un parámetro de la de la clínica
  // porque **las puertas son otras**: la de la clínica es la de la
  // podóloga, y ésta lleva además el gate del módulo de residencia y la
  // 404 que no cuenta que la residencia existe.
  app.get(
    "/residencia/residentes/:clientId/consentimientos",
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
      return conHistoria(request, reply, { clientId, action: "READ" }, async () =>
        vistaDeConsentimientos(prisma, {
          tenantId: auth.tenantId,
          clientId,
          ambito: "RESIDENCIA",
        }),
      );
    },
  );

  // ════════════════════════════════════════════════════════════════
  //  LOS DOS PLAZOS DEL CENTRO (D-94, D-96)
  // ════════════════════════════════════════════════════════════════
  app.get(
    "/residencia/ingresos/plazos",
    { preHandler: PUERTAS_ESCRITURA },
    async (request: FastifyRequest) => {
      const auth = request.auth!;
      const plazos = await plazosDelCentro(getPrisma(), auth.tenantId);
      return {
        ...plazos,
        // **Se dice que el de la baja no tiene valor de serie**, para que
        // la pantalla lo explique en vez de pintar un hueco: el plazo es
        // normativa autonómica y el producto no se lo inventa (D-96).
        elPlazoDeLaBajaEsNormativaAutonomica: true,
      };
    },
  );

  app.put(
    "/residencia/ingresos/plazos",
    {
      preHandler: PUERTAS_DE_LOS_PLAZOS,
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          properties: {
            diasDePai: { type: "integer", minimum: 1, maximum: 365 },
            // `null` explícito = «no lo sé todavía», que es distinto de no
            // mandar el campo. El `type` lo admite a propósito: la
            // dirección tiene que poder volver a «sin plazo» si se
            // equivocó, y entonces las obligaciones nuevas nacen por
            // verificar en vez de con una fecha inventada.
            diasParaComunicarLaBaja: {
              type: ["integer", "null"],
              minimum: 1,
              maximum: 180,
            },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const body = request.body as {
        diasDePai?: number;
        diasParaComunicarLaBaja?: number | null;
      };
      const prisma = getPrisma();
      const actual = await plazosDelCentro(prisma, auth.tenantId);
      const diasDePai = body.diasDePai ?? actual.diasDePai;
      const diasDeBaja =
        body.diasParaComunicarLaBaja === undefined
          ? actual.diasParaComunicarLaBaja
          : body.diasParaComunicarLaBaja;
      await prisma.centerAdmissionSetting.upsert({
        where: { tenantId: auth.tenantId },
        create: {
          tenantId: auth.tenantId,
          initialCarePlanDays: diasDePai,
          dischargeNoticeDays: diasDeBaja,
          updatedByUserId: auth.userId,
        },
        update: {
          initialCarePlanDays: diasDePai,
          dischargeNoticeDays: diasDeBaja,
          updatedByUserId: auth.userId,
        },
      });
      // Y **lo que ya está escrito no se toca**: cambiar el plazo del PAI
      // no mueve la fecha límite de los residentes que ya ingresaron. Su
      // plazo es el que había cuando ingresaron, que es lo que un
      // inspector va a comparar con su fecha de ingreso.
      return reply.code(200).send({
        diasDePai,
        diasParaComunicarLaBaja: diasDeBaja,
        loYaEscritoNoCambia: true,
      });
    },
  );
}
