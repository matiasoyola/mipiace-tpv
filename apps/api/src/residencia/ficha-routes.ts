// residencia-3 · LO QUE EL ADMIN NECESITA PARA QUE LA PUERTA FUNCIONE.
//
// Cuatro familias, y las cuatro existen porque sin ellas el bloque no se
// puede usar:
//
//   1. **La foto del residente** (D-64) y su **consentimiento de imagen**.
//      Se sube desde la ficha; sin consentimiento anotado, la puerta pinta
//      las iniciales.
//   2. **El PIN de la puerta** de cada persona. Es la credencial con la
//      que se firma un registro de salud, así que es `requireOwner` — la
//      misma clase de decisión que los roles de cuidado y las zonas
//      (decisión 6 de residencia-1) y que `PATCH /staff/:id/clinica`.
//   3. **Lo registrado, por turno**, en la ficha del residente. Es «la
//      prueba de que llega»: la dirección abre la ficha y ve lo que la
//      tablet apuntó, con quién y a qué hora.
//   4. **La nota de voz**, para que la DUE la escuche.
//
// ── Qué pasa por `conHistoria` y qué no ─────────────────────────────
//
// Lo registrado y la nota de voz, **sí**: son historia clínica y cada
// apertura deja su línea. La foto y el consentimiento, **también**, y es
// una decisión: la cara de alguien no es un dato de salud, pero decidir
// que su cara se pinte en el pasillo es un acto sobre su ficha, y el
// envoltorio además aplica el alcance por zona sin escribirlo otra vez.
//
// El PIN, **no**: no hay `clientId` en ninguna parte de esa ruta. Es la
// decisión 2 de residencia-1 aplicada aquí — el registro de accesos
// contesta «¿quién ha abierto la historia de ESTE residente?», y una línea
// sin residente no contesta eso.

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import {
  diaDelTurno,
  largoDePinRequerido,
  problemaDelPinNuevo,
  turnoDe,
  utcToWallDate,
} from "@mipiacetpv/residencia-plan";

import { getPrisma } from "../context.js";
import {
  requireOwner,
  requireOwnerOrCashier,
  requireOwnerOrManager,
} from "../auth/middleware.js";
import { hashPassword } from "../auth/passwords.js";
import { asegurarDek, dekONada } from "../clinica/claves.js";
import { ensureClinicaEnabled } from "../clinica/gate.js";
import { conHistoria } from "../clinica/registro.js";
import {
  huellaDePinDePuerta,
  subclaveDePinDePuerta,
} from "../clinica/cripto.js";
import {
  decodificarFoto,
  guardarFichero,
  leerFichero,
  MIME_DE_FOTO,
  MIME_DE_VOZ,
} from "../clinica/ficheros.js";
import { ensureResidenciaEnabled } from "./gate.js";
import {
  dekParaLeer,
  REGISTRO_SELECT,
  vistaDeRegistros,
} from "./registro.js";

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
const PUERTAS_DEL_PIN = [
  requireOwner,
  ensureClinicaEnabled,
  ensureResidenciaEnabled,
];

/** ¿Es este residente de este centro? La 404 del aislamiento por fila, que
 *  va ANTES de la autorización clínica (residencia-1). */
async function residenteDelCentro(
  tenantId: string,
  clientId: string,
): Promise<boolean> {
  const prisma = getPrisma();
  const existe = await prisma.residentProfile.findFirst({
    where: { clientId, tenantId },
    select: { clientId: true },
  });
  return existe != null;
}

export async function registerResidenciaFichaRoutes(
  app: FastifyInstance,
): Promise<void> {
  // ════════════════════════════════════════════════════════════════
  //  LA FOTO DEL RESIDENTE (D-64)
  // ════════════════════════════════════════════════════════════════
  //
  // Se **reemplaza**, no se versiona: la cara de alguien es identidad
  // (como `clients.firstName`), no historia. Subir una nueva deja la
  // anterior huérfana en el volumen — igual que las capturas de A5 y al
  // contrario que una foto clínica, que no se borra nunca porque está en
  // una historia. El fichero viejo no se borra del disco en esta ruta a
  // propósito: borrar binarios dentro de la transacción que escribe la
  // fila es la forma de quedarse sin la foto si algo falla después. Un
  // barrido de huérfanos es un script, y está dicho en el `-done`.
  app.put(
    "/residencia/residentes/:clientId/foto",
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
          required: ["jpegBase64"],
          additionalProperties: false,
          properties: { jpegBase64: { type: "string", maxLength: 8_000_000 } },
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
      return conHistoria(
        request,
        reply,
        { clientId, action: "WRITE" },
        async () => {
          let jpeg: Buffer;
          try {
            jpeg = decodificarFoto(request.body);
          } catch (err) {
            return reply.code(400).send({
              error: "FOTO_INVALIDA",
              message: (err as Error).message,
            });
          }
          // La DEK dentro de la transacción que escribe (residencia-1b
          // §4): si se deshace, la clave no queda huérfana. Y si no se
          // pudiera obtener, esto LEVANTA — nada se guarda en claro porque
          // falte la clave.
          const dek = await asegurarDek(auth.tenantId, prisma);
          // PRIMERO el fichero, después la fila. Al revés, un fallo al
          // escribir el disco deja una fila que apunta a una foto que no
          // existe.
          const guardado = await guardarFichero("RESIDENTE", jpeg, {
            tenantId: auth.tenantId,
            dek,
          });
          await prisma.residentProfile.update({
            where: { clientId },
            data: {
              photoFileName: guardado.fileName,
              photoSha256: guardado.sha256,
              photoBytes: guardado.bytes,
              photoMimeType: MIME_DE_FOTO,
              photoUploadedAt: new Date(),
              photoUploadedById: auth.userId,
            },
          });
          return reply.code(200).send({
            bytes: guardado.bytes,
            subidaEn: new Date().toISOString(),
          });
        },
      );
    },
  );

  // Quitar la foto. Las cinco columnas a NULL de una vez, que es lo que el
  // CHECK `resident_profiles_foto_completa` exige: media foto quitada es
  // una fila que dice que hay una imagen que no se puede servir.
  app.delete(
    "/residencia/residentes/:clientId/foto",
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
      return conHistoria(
        request,
        reply,
        { clientId, action: "WRITE" },
        async () => {
          await prisma.residentProfile.update({
            where: { clientId },
            data: {
              photoFileName: null,
              photoSha256: null,
              photoBytes: null,
              photoMimeType: null,
              photoUploadedAt: null,
              photoUploadedById: null,
            },
          });
          return reply.code(200).send({ ok: true });
        },
      );
    },
  );

  // La foto desde el ADMIN. Aquí sí se sirve **sin** consentimiento: quien
  // la mira es la dirección en su despacho, que es quien tiene que poder
  // ver qué foto hay para decidir si pide el consentimiento o la quita. Lo
  // que el consentimiento gobierna es que se pinte EN EL PASILLO.
  app.get(
    "/residencia/residentes/:clientId/foto",
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
        const perfil = await prisma.residentProfile.findUniqueOrThrow({
          where: { clientId },
          select: { photoFileName: true, photoSha256: true, photoMimeType: true },
        });
        if (!perfil.photoFileName) {
          return reply.code(404).send({
            error: "SIN_FOTO",
            message: "Este residente no tiene foto.",
          });
        }
        const dek = await dekONada(auth.tenantId, prisma);
        const leido = await leerFichero(
          "RESIDENTE",
          perfil.photoFileName,
          perfil.photoSha256,
          { tenantId: auth.tenantId, dek },
        );
        if (!leido) {
          return reply.code(404).send({
            error: "FOTO_NO_LEGIBLE",
            message:
              "La foto está anotada en la ficha y no se puede leer del volumen. Avisa a Mi Piace.",
          });
        }
        return reply
          .code(200)
          .header("Content-Type", perfil.photoMimeType ?? MIME_DE_FOTO)
          .header("X-Huella-Cuadra", leido.huellaCuadra ? "si" : "no")
          .header("Cache-Control", "no-store")
          .send(leido.contenido);
      });
    },
  );

  // ════════════════════════════════════════════════════════════════
  //  EL CONSENTIMIENTO DE IMAGEN (D-64)
  // ════════════════════════════════════════════════════════════════
  //
  // Una fila `ClientConsentKind.IMAGE` con quién lo dio, cuándo y quién lo
  // anotó. `clinical: false` —la cara de alguien es su imagen, no su
  // salud— y por eso no exige sanitario que informe; lo impide además el
  // CHECK `client_consents_imagen_no_es_clinica`.
  app.post(
    "/residencia/residentes/:clientId/consentimiento-imagen",
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
          required: ["signer"],
          additionalProperties: false,
          properties: {
            // Quién lo dio: el residente o su familiar responsable. Los
            // dos valores son los de `client_consents_firmante_valido`, que
            // exige nombre y parentesco **sólo** en el segundo caso.
            signer: { type: "string", enum: ["PACIENTE", "REPRESENTANTE"] },
            signerName: { type: "string", maxLength: 120 },
            signerRelation: { type: "string", maxLength: 60 },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const { clientId } = request.params as { clientId: string };
      const body = request.body as {
        signer: "PACIENTE" | "REPRESENTANTE";
        signerName?: string;
        signerRelation?: string;
      };
      if (!(await residenteDelCentro(auth.tenantId, clientId))) {
        return reply.code(404).send({
          error: "RESIDENTE_NO_ENCONTRADO",
          message: "No hay ningún residente con esa ficha en este centro.",
        });
      }
      if (
        body.signer === "REPRESENTANTE" &&
        (!body.signerName || !body.signerRelation)
      ) {
        // El CHECK lo impediría con un 500; esto lo dice con una frase. Es
        // la regla de la casa: lo que el motor garantiza, la ruta lo
        // explica.
        return reply.code(400).send({
          error: "FALTA_EL_FIRMANTE",
          message:
            "Si lo dio un familiar, hace falta su nombre y su parentesco: es lo que hace que el consentimiento valga.",
        });
      }
      const prisma = getPrisma();
      return conHistoria(
        request,
        reply,
        { clientId, action: "WRITE" },
        async () => {
          // ¿Ya hay uno vigente? Dos concesiones vivas no rompen nada —la
          // puerta pinta la foto igual— pero dejan «¿quién lo dio?» con dos
          // respuestas, y revocar tendría que revocar las dos.
          const vigente = await consentimientoDeImagenVigente(
            auth.tenantId,
            clientId,
          );
          if (vigente) {
            return reply.code(409).send({
              error: "YA_HAY_CONSENTIMIENTO",
              message:
                "Ya hay un consentimiento de imagen vigente. Retíralo antes de anotar otro.",
            });
          }
          const creado = await prisma.clientConsent.create({
            data: {
              tenantId: auth.tenantId,
              clientId,
              kind: "IMAGE",
              clinical: false,
              signer: body.signer,
              signerName:
                body.signer === "REPRESENTANTE" ? (body.signerName ?? null) : null,
              signerRelation:
                body.signer === "REPRESENTANTE"
                  ? (body.signerRelation ?? null)
                  : null,
              createdByUserId: auth.userId,
            },
            select: { id: true, grantedAt: true },
          });
          return reply.code(201).send({
            id: creado.id,
            anotadoEn: creado.grantedAt.toISOString(),
          });
        },
      );
    },
  );

  // Retirarlo. **Una fila nueva que revoca**, no un `UPDATE` ni un
  // `DELETE`: es como funciona el consentimiento en toda la casa desde
  // clinica-4, y es lo que permite contestar «¿desde cuándo no se puede
  // enseñar su foto, y quién lo pidió?».
  app.post(
    "/residencia/residentes/:clientId/consentimiento-imagen/retirar",
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
          additionalProperties: false,
          properties: { motivo: { type: "string", maxLength: 200 } },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const { clientId } = request.params as { clientId: string };
      const { motivo } = request.body as { motivo?: string };
      if (!(await residenteDelCentro(auth.tenantId, clientId))) {
        return reply.code(404).send({
          error: "RESIDENTE_NO_ENCONTRADO",
          message: "No hay ningún residente con esa ficha en este centro.",
        });
      }
      const prisma = getPrisma();
      return conHistoria(
        request,
        reply,
        { clientId, action: "WRITE" },
        async () => {
          const vigente = await consentimientoDeImagenVigente(
            auth.tenantId,
            clientId,
          );
          if (!vigente) {
            return reply.code(409).send({
              error: "NO_HAY_CONSENTIMIENTO",
              message: "No hay ningún consentimiento de imagen vigente.",
            });
          }
          // `revokeReason` va CIFRADO desde clinica-7 y lo escribe la ruta
          // de la clínica; aquí el motivo es administrativo («lo pidió la
          // hija») y se escribe por el mismo camino, con el mismo
          // `sitio*`. No se duplica la maquinaria: se reutiliza.
          const { cifrarTexto, sitioMotivoDeRevocacion, nuevoIdDeFila } =
            await import("../clinica/cripto-campos.js");
          const dek = await asegurarDek(auth.tenantId, prisma);
          const id = nuevoIdDeFila();
          await prisma.clientConsent.create({
            data: {
              id,
              tenantId: auth.tenantId,
              clientId,
              kind: "IMAGE",
              clinical: false,
              revokesConsentId: vigente,
              revokeReasonCifrado: cifrarTexto(
                motivo ?? null,
                dek,
                sitioMotivoDeRevocacion(auth.tenantId, id),
              ),
              createdByUserId: auth.userId,
            },
          });
          return reply.code(200).send({ retirado: vigente });
        },
      );
    },
  );

  // ════════════════════════════════════════════════════════════════
  //  LO REGISTRADO, POR TURNO · «la prueba de que llega»
  // ════════════════════════════════════════════════════════════════
  //
  // Solo lectura, en la ficha del residente. Acepta `?dia=` por lo mismo
  // que la vista «hoy» del plan en residencia-2: «¿qué se le hizo el 3 de
  // marzo?» es la misma llamada con otra fecha, y era gratis.
  //
  // Devuelve **la cadena completa** de cada ocurrencia —lo corregido, la
  // corrección y lo anulado— con `vigente` marcando cuál es el valor de
  // ahora. Enseñar sólo lo vigente convertiría esta vista en un resumen, y
  // lo que la dirección necesita enseñar en una auditoría es que **nada se
  // borra**: que la corrección está, que dice quién corrigió y cuándo.
  app.get(
    "/residencia/residentes/:clientId/registros",
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
          additionalProperties: false,
          properties: { dia: { type: "string", format: "date" } },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const { clientId } = request.params as { clientId: string };
      const { dia } = request.query as { dia?: string };
      if (!(await residenteDelCentro(auth.tenantId, clientId))) {
        return reply.code(404).send({
          error: "RESIDENTE_NO_ENCONTRADO",
          message: "No hay ningún residente con esa ficha en este centro.",
        });
      }
      const prisma = getPrisma();
      return conHistoria(request, reply, { clientId, action: "READ" }, async () => {
        const ahora = new Date();
        const [turnos, ajustes, controles] = await Promise.all([
          prisma.centerShift.findMany({
            where: { tenantId: auth.tenantId },
            orderBy: [{ sortOrder: "asc" }],
            select: {
              id: true,
              code: true,
              name: true,
              startsAt: true,
              endsAt: true,
            },
          }),
          prisma.centerControlSetting.findMany({
            where: { tenantId: auth.tenantId },
            select: { controlCode: true, alias: true },
          }),
          prisma.controlType.findMany({
            where: {
              supersededAt: null,
              OR: [
                { scope: "STANDARD" },
                { scope: "CENTER", tenantId: auth.tenantId },
              ],
            },
            select: {
              code: true,
              name: true,
              layer: true,
              valueDomain: true,
              // Las ETIQUETAS de las opciones. El registro guarda el CÓDIGO
              // —para que cambiarle el texto no reescriba el histórico
              // (residencia-2 §1)— y la pantalla tiene que enseñar el
              // texto. Sin esto se lee «SIN_DOLOR · como siempre» en la
              // hoja que se enseña en una auditoría; lo encontró el bucle
              // visual mirando la captura.
              options: { select: { code: true, label: true } },
            },
          }),
        ]);
        // El día POR DEFECTO es el del turno de ahora y no el del
        // calendario: a las 02:00 lo que la dirección quiere ver es la
        // noche que está corriendo, que empezó ayer.
        const careDay = dia ?? diaDelTurno(ahora, turnoDe(ahora, turnos));
        const dek = await dekParaLeer(auth.tenantId, prisma);
        const filas = await prisma.careRecord.findMany({
          where: { tenantId: auth.tenantId, clientId, careDay },
          orderBy: { recordedAt: "asc" },
          select: REGISTRO_SELECT,
        });
        const vista = vistaDeRegistros(filas, dek);
        const alias = new Map(ajustes.map((a) => [a.controlCode, a.alias]));
        const porCodigo = new Map(controles.map((c) => [c.code, c]));
        const nombreDe = (code: string) =>
          alias.get(code) ?? porCodigo.get(code)?.name ?? code;

        const conNombre = vista.map((r) => {
          const control = porCodigo.get(r.controlCode);
          const opcion =
            typeof (r.valor as { opcion?: unknown } | null)?.opcion === "string"
              ? (r.valor as { opcion: string }).opcion
              : null;
          return {
            ...r,
            nombre: nombreDe(r.controlCode),
            layer: control?.layer ?? null,
            /** La etiqueta de la opción elegida, para que la hoja diga
             *  «Sin dolor» y no `SIN_DOLOR`. `null` si el control o la
             *  opción ya no existen: entonces la pantalla enseña el código,
             *  que es mejor que no enseñar nada. */
            opcionLabel:
              opcion == null
                ? null
                : (control?.options.find((o) => o.code === opcion)?.label ??
                  null),
          };
        });

        return {
          dia: careDay,
          esHoy: careDay === diaDelTurno(ahora, turnoDe(ahora, turnos)),
          diaDePared: utcToWallDate(ahora),
          // Agrupado por turno, que es cómo trabaja el centro y cómo lo
          // pregunta una auditoría («la hoja del turno de noche»).
          porTurno: turnos.map((t) => ({
            code: t.code,
            name: t.name,
            desde: t.startsAt,
            hasta: t.endsAt,
            registros: conNombre.filter((r) => r.shiftCode === t.code),
          })),
          // Lo que NO cayó en ningún turno. Normalmente nada; si sale algo
          // es un hueco en el cuadrante y la pantalla lo pinta en ámbar.
          // **Está aquí y no escondido**: un cuidado sin turno es un
          // cuidado hecho.
          sinTurno: conNombre.filter((r) => r.shiftCode === null),
          total: conNombre.length,
        };
      });
    },
  );

  // La NOTA DE VOZ. Historia clínica: `conHistoria` con `READ`, así que
  // cada escucha deja su línea — «¿quién ha oído lo que dijo la auxiliar
  // de mi madre?» tiene respuesta.
  app.get(
    "/residencia/registros/:id/voz",
    {
      preHandler: PUERTAS_LECTURA,
      schema: {
        params: {
          type: "object",
          required: ["id"],
          additionalProperties: false,
          properties: { id: { type: "string", format: "uuid" } },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const { id } = request.params as { id: string };
      const prisma = getPrisma();
      const fila = await prisma.careRecord.findFirst({
        where: { id, tenantId: auth.tenantId },
        select: {
          clientId: true,
          voiceFileName: true,
          voiceSha256: true,
          voiceMimeType: true,
        },
      });
      if (!fila || !fila.voiceFileName) {
        return reply.code(404).send({
          error: "SIN_NOTA_DE_VOZ",
          message: "Ese registro no tiene nota de voz.",
        });
      }
      return conHistoria(
        request,
        reply,
        { clientId: fila.clientId, action: "READ" },
        async () => {
          const dek = await dekONada(auth.tenantId, prisma);
          const leido = await leerFichero(
            "VOZ",
            fila.voiceFileName!,
            fila.voiceSha256,
            { tenantId: auth.tenantId, dek },
          );
          if (!leido) {
            return reply.code(404).send({
              error: "NOTA_NO_LEGIBLE",
              message:
                "La nota de voz está anotada y no se puede leer del volumen. Avisa a Mi Piace.",
            });
          }
          return reply
            .code(200)
            .header("Content-Type", fila.voiceMimeType ?? MIME_DE_VOZ)
            .header("X-Huella-Cuadra", leido.huellaCuadra ? "si" : "no")
            .header("Cache-Control", "no-store")
            .send(leido.contenido);
        },
      );
    },
  );

  // ════════════════════════════════════════════════════════════════
  //  EL PIN DE LA PUERTA · `requireOwner`
  // ════════════════════════════════════════════════════════════════
  //
  // Quien decide con qué credencial se firma un registro de salud es quien
  // dirige el centro, igual que quien decide los roles de cuidado y las
  // zonas (decisión 6 de residencia-1, D-61). El encargado no.
  //
  // **El PIN no se devuelve nunca**, ni entero, ni parcial, ni su hash, ni
  // su huella. Lo que la pantalla puede saber es si esa persona TIENE uno.
  app.put(
    "/residencia/personal/:userId/pin-de-puerta",
    {
      preHandler: PUERTAS_DEL_PIN,
      schema: {
        params: {
          type: "object",
          required: ["userId"],
          additionalProperties: false,
          properties: { userId: { type: "string", format: "uuid" } },
        },
        body: {
          type: "object",
          required: ["pin"],
          additionalProperties: false,
          properties: { pin: { type: "string", pattern: "^[0-9]{4,8}$" } },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const { userId } = request.params as { userId: string };
      const { pin } = request.body as { pin: string };
      const prisma = getPrisma();

      const ahora = new Date();
      const persona = await prisma.user.findFirst({
        where: { id: userId, tenantId: auth.tenantId },
        select: {
          id: true,
          careRoleAssignments: {
            where: { revokedAt: null, careRole: { recordsCare: true } },
            // residencia-6 (D-68) · la vigencia y el alcance, porque de
            // ellos sale cuántas cifras le tocan. `fullScope` y no el
            // `code` del rol: la regla es del ALCANCE, no de una lista de
            // nombres de rol que un centro puede ampliar (D-50).
            select: {
              id: true,
              fromAt: true,
              toAt: true,
              careRole: { select: { fullScope: true } },
            },
          },
        },
      });
      if (!persona) {
        return reply.code(404).send({
          error: "PERSONA_NO_ENCONTRADA",
          message: "Esa persona no es de este centro.",
        });
      }
      if (persona.careRoleAssignments.length === 0) {
        // Un PIN de puerta sin rol de cuidado que registre es una
        // credencial que no abre nada: la propia ruta del PIN contestaría
        // `SIN_ROL_DE_CUIDADO`. Se dice aquí, donde se puede arreglar, en
        // vez de dejar que se descubra en el pasillo.
        return reply.code(409).send({
          error: "SIN_ROL_DE_CUIDADO",
          message:
            "Dale primero un rol de cuidado que registre: sin él, su PIN no abriría ninguna puerta.",
        });
      }

      // ── residencia-6 (D-68) · ¿LE TOCAN CUATRO CIFRAS O SEIS? ──────
      //
      // Se valida **al dar o cambiar el PIN**, que es donde se arregla:
      // quien lo está poniendo tiene el teclado delante. Y se mira sobre
      // los roles VIGENTES de ahora, no sobre todos: un rol de DUE
      // revocado en junio no le obliga a seis cifras en octubre.
      const rolesVivos = persona.careRoleAssignments
        .filter((a) => a.fromAt <= ahora && (a.toAt == null || a.toAt > ahora))
        .map((a) => ({ alcanceTotal: a.careRole.fullScope }));
      const problema = problemaDelPinNuevo(pin, rolesVivos);
      if (problema) {
        return reply.code(409).send({
          error: "PIN_DEMASIADO_CORTO",
          message: problema,
          // Lo que la pantalla necesita para pintar el hueco del largo
          // bueno sin volver a deducir la regla.
          largoRequerido: largoDePinRequerido(rolesVivos),
        });
      }

      // La clave del centro, creándola si hace falta: poner el primer PIN
      // es la primera escritura cifrada de un centro que todavía no tenga
      // residentes. `asegurarDek` dentro de la transacción que escribe.
      const dek = await asegurarDek(auth.tenantId, prisma);
      const lookup = huellaDePinDePuerta(
        pin,
        subclaveDePinDePuerta(dek, auth.tenantId),
        auth.tenantId,
      );

      // «Ese PIN ya lo tiene otra persona» · el motor lo impide con
      // `care_pins_tenant_id_pin_lookup_key` y aquí se dice con una frase.
      // Es la regla que hace que teclear cuatro cifras identifique a
      // alguien, así que la dirección tiene que entender por qué se le
      // rechaza — y no se le dice QUIÉN lo tiene, porque eso sería
      // regalarle el PIN de otra persona.
      const deOtro = await prisma.carePin.findUnique({
        where: {
          tenantId_pinLookup: { tenantId: auth.tenantId, pinLookup: lookup },
        },
        select: { userId: true },
      });
      if (deOtro && deOtro.userId !== userId) {
        return reply.code(409).send({
          error: "PIN_YA_USADO",
          message:
            "Ese PIN ya lo tiene otra persona del centro. Elige otro: en la puerta sólo se teclea el PIN, así que dos iguales no identificarían a nadie.",
        });
      }

      await prisma.carePin.upsert({
        where: { userId },
        create: {
          userId,
          tenantId: auth.tenantId,
          pinHash: await hashPassword(pin),
          pinLookup: lookup,
          // residencia-6 · el LARGO, que es lo único que se guarda de la
          // forma del PIN. Ver la cabecera de `care_pins` en el esquema.
          pinLength: pin.length,
          setByUserId: auth.userId,
        },
        update: {
          pinHash: await hashPassword(pin),
          pinLookup: lookup,
          pinLength: pin.length,
          setByUserId: auth.userId,
          setAt: new Date(),
        },
      });
      return reply.code(200).send({ tienePin: true, largo: pin.length });
    },
  );

  app.delete(
    "/residencia/personal/:userId/pin-de-puerta",
    {
      preHandler: PUERTAS_DEL_PIN,
      schema: {
        params: {
          type: "object",
          required: ["userId"],
          additionalProperties: false,
          properties: { userId: { type: "string", format: "uuid" } },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const { userId } = request.params as { userId: string };
      const prisma = getPrisma();
      const fila = await prisma.carePin.findFirst({
        where: { userId, tenantId: auth.tenantId },
        select: { userId: true },
      });
      if (!fila) {
        return reply.code(404).send({
          error: "SIN_PIN",
          message: "Esa persona no tiene PIN de puerta.",
        });
      }
      // Un PIN **sí se borra**, al contrario que todo lo demás de este
      // bloque. Es una credencial y no evidencia: lo que esa persona firmó
      // se queda donde está, y lo impide
      // `care_records_recorded_by_user_id_fkey`.
      await prisma.carePin.delete({ where: { userId } });
      return reply.code(200).send({ tienePin: false });
    },
  );
}

/** El id del consentimiento de imagen vigente, o `null`. Ver
 *  `consentimientosDeImagen` en `puerta-registro-routes.ts`: la misma
 *  regla, para un residente. */
async function consentimientoDeImagenVigente(
  tenantId: string,
  clientId: string,
): Promise<string | null> {
  const prisma = getPrisma();
  const filas = await prisma.clientConsent.findMany({
    where: { tenantId, clientId, kind: "IMAGE" },
    orderBy: { grantedAt: "asc" },
    select: { id: true, revokesConsentId: true },
  });
  const revocados = new Set(
    filas.map((f) => f.revokesConsentId).filter((x): x is string => x != null),
  );
  for (const f of filas) {
    if (f.revokesConsentId != null) continue;
    if (revocados.has(f.id)) continue;
    return f.id;
  }
  return null;
}
