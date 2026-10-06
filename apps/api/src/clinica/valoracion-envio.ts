// clinica-2 · mandarle el test al paciente por email.
//
// Un solo sitio, y lo llaman los dos caminos:
//
//   · el alta de una cita de un servicio marcado «primera valoración»
//     (`valoracion-por-cita.ts`, enganchado en `agenda/store.ts`);
//   · el botón «Enviar el test» de la ficha
//     (`POST /clinica/clients/:id/valoracion/enviar`).
//
// Si fueran dos, el día que cambie el texto del email o la caducidad del
// enlace habría que acordarse de los dos.
//
// ── Por qué NO pasa por una cola de BullMQ ────────────────────────────
//
// El prompt dice «por la cola de email que ya existe (`email/sender.ts`)»,
// y nombra el fichero: `email/sender.ts` ES el envío, no una cola. La
// única cola de email de la casa (`queues/ticket-email.ts` +
// `ticket_email_jobs` + su worker) es un pipeline de PDFs de ticket
// **con clave `ticketId`**: meter aquí una valoración exigiría inventarse
// un ticket que no existe.
//
// Todo lo demás que manda correo transaccional en esta casa llama a
// `getEmailSender().send()` directamente: el reset de contraseña, el alta
// de un super-admin, el email de bienvenida, las alertas de dispositivo.
// Esto hace lo mismo, y la decisión queda declarada en el done.
//
// ── Y un fallo de SMTP NO tumba nada ──────────────────────────────────
//
// Es la decisión importante de este fichero. La valoración se crea
// PRIMERO y el email se manda después, fuera de la transacción de la cita:
//
//   · Si el correo falla, **la valoración ya existe con su enlace vivo**.
//     La podóloga ve «el test no se pudo enviar» y tiene a mano los dos
//     caminos que sí funcionan: reenviarlo o darle la tablet. El paciente
//     no se queda sin valoración por un servidor de correo caído.
//   · Y sobre todo: **dar una cita no puede fallar porque el SMTP esté
//     mal configurado.** Es la misma forma de la memoria de la casa
//     («cobrar siempre se puede»): el acto de negocio se cierra, y lo
//     accesorio se reintenta después.
//
// ── Y la trazabilidad, que es distinta en cada camino ────────────────
//
// Por el botón de la ficha, `conHistoria` ya ha escrito la línea del
// registro (`WRITE`, con el nombre de quien lo mandó) antes de llegar
// aquí. Por el alta de la cita **no hay línea, y es deliberado**: no hay
// persona a la que atribuirla —el motor no lleva usuario— y lo que se crea
// es una valoración VACÍA con un token, sin un solo dato de salud dentro.
// Es la misma decisión que clinica-1 tomó con `clinical_access` cuando
// nace de la agenda (§11.2 de su done: «son gestión, no historia; apuntar
// "la dueña abrió la historia" cuando lo que hizo fue administrar sería
// una línea falsa»). Lo que sí deja línea, siempre, es el contenido: las
// respuestas del paciente (`WRITE` con el actor del enlace), cada lectura
// de la pantalla y cada corrección.
//
// Queda escrito en la fila de todos modos: `source = APPOINTMENT` y
// `appointment_id` dicen exactamente de dónde salió.
//
// El fallo del envío se registra en el log de la aplicación — sin el
// enlace, sin el token y sin una palabra del cuestionario.

import type { PrismaClient } from "@mipiacetpv/db";
import type { EstadoValoracion } from "@mipiacetpv/clinica-valoracion";

import { getEmailSender } from "../email/sender.js";
import { urlDelEnlace } from "./enlace.js";
import { emailDelTest } from "./valoracion-email.js";
import {
  asegurarValoracionAbierta,
  type OrigenValoracion,
} from "./valoracion.js";

/** Lo mínimo del logger de Fastify. Opcional: el camino de la cita lo
 *  llama desde el store, donde no siempre hay `request`. */
export interface LogDelEnvio {
  info: (obj: object, msg?: string) => void;
  warn: (obj: object, msg?: string) => void;
}

export type MotivoNoEnviado =
  | "SIN_EMAIL"
  | "EMAIL_INVALIDO"
  | "FALLO_DEL_CORREO";

export type ResultadoEnvio =
  | {
      ok: true;
      valoracionId: string;
      creada: boolean;
      estado: EstadoValoracion;
      /** `true` si el correo salió. `false` con `motivoNoEnviado`. */
      enviado: boolean;
      motivoNoEnviado?: MotivoNoEnviado;
      caducaEn: Date | null;
    }
  | { ok: false; motivo: "YA_RESPONDIDA"; mensaje: string };

export async function mandarElTest(
  prisma: PrismaClient,
  input: {
    tenantId: string;
    clientId: string;
    /** `APPOINTMENT` cuando lo dispara el alta de la cita (sin usuario);
     *  `MANUAL` cuando lo pide alguien desde la ficha. */
    origen: OrigenValoracion;
    pedidaPorUserId: string | null;
    baseTpvUrl: string;
    appointmentId?: string | null;
    /** La cita, ya en hora del centro, para el «su cita es el…». */
    cita?: { dia: string; hora: string } | null;
    log?: LogDelEnvio;
    ahora?: Date;
  },
): Promise<ResultadoEnvio> {
  const [paciente, tenant] = await Promise.all([
    prisma.client.findFirst({
      where: { id: input.clientId, tenantId: input.tenantId },
      select: { firstName: true, email: true },
    }),
    prisma.tenant.findUnique({
      where: { id: input.tenantId },
      select: { name: true },
    }),
  ]);
  if (!paciente || !tenant) {
    return {
      ok: false,
      motivo: "YA_RESPONDIDA",
      mensaje: "Paciente no encontrado.",
    };
  }

  // La valoración PRIMERO, y con su enlace, pase lo que pase con el
  // correo. Idempotente por el índice único parcial: dos envíos no crean
  // dos valoraciones.
  const abierta = await asegurarValoracionAbierta(prisma, {
    tenantId: input.tenantId,
    clientId: input.clientId,
    canal: "EMAIL",
    origen: input.origen,
    pedidaPorUserId: input.pedidaPorUserId,
    appointmentId: input.appointmentId ?? null,
    ahora: input.ahora,
  });

  if (abierta.estado !== "PENDIENTE_PACIENTE") {
    // Ya contestó. Mandarle otro enlace sería invitarle a contestar dos
    // veces sobre algo que la podóloga quizá está revisando ahora mismo.
    return {
      ok: false,
      motivo: "YA_RESPONDIDA",
      mensaje:
        "Este paciente ya contestó el test. Revísalo y válidalo; si hay que volver a preguntarle, válidalo primero y mándale una valoración nueva.",
    };
  }

  const base = {
    ok: true as const,
    valoracionId: abierta.valoracionId,
    creada: abierta.creada,
    estado: abierta.estado,
    caducaEn: abierta.caducaEn,
  };

  // Sin dirección no hay nada que mandar, y no es un error: una clínica
  // tiene pacientes mayores sin email. Lo que la pantalla hace con esto es
  // ofrecer la tablet, que es el camino bueno para esa persona.
  const destino = paciente.email?.trim();
  if (!destino) {
    return { ...base, enviado: false, motivoNoEnviado: "SIN_EMAIL" };
  }
  if (!destino.includes("@") || /\s/.test(destino)) {
    return { ...base, enviado: false, motivoNoEnviado: "EMAIL_INVALIDO" };
  }

  const { subject, text, html } = emailDelTest({
    clinica: tenant.name,
    nombrePila: paciente.firstName,
    cita: input.cita ?? null,
    url: urlDelEnlace(input.baseTpvUrl, abierta.token!),
  });

  try {
    await getEmailSender().send({ to: destino, subject, text, html });
  } catch (err) {
    // NI EL TOKEN, NI LA URL, NI EL DESTINATARIO, NI UNA PALABRA DEL
    // CUESTIONARIO. El id de la valoración y el error, que es lo que hace
    // falta para arreglarlo. La dirección de email de un paciente de una
    // clínica, junto al id de su valoración, sería un dato de salud en el
    // log (dice que esa persona es paciente de esta clínica).
    input.log?.warn(
      {
        event: "clinica_valoracion_email_fallo",
        valoracionId: abierta.valoracionId,
        err: err instanceof Error ? err.message : String(err),
      },
      "no se pudo mandar el email del test de la valoración — la valoración queda creada con su enlace",
    );
    return { ...base, enviado: false, motivoNoEnviado: "FALLO_DEL_CORREO" };
  }

  input.log?.info(
    {
      event: "clinica_valoracion_email_enviado",
      valoracionId: abierta.valoracionId,
    },
    "test de la valoración mandado por email",
  );
  return { ...base, enviado: true };
}
