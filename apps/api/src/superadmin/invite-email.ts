// primer-acceso · EL CORREO DEL PRIMER ACCESO.
//
// «Hola Carmen, ya tienes acceso a la gestión de Jardín de Gredos, S.A.»,
// un botón grande —**Crear mi contraseña**— y, en pequeño, que el enlace
// vale 7 días y que desde la misma página puede pedir otro.
//
// **Ninguna contraseña dentro.** Es el punto del bloque: el día del alta
// la persona del centro abre el correo, pulsa un botón, elige su
// contraseña y ya está trabajando. Y para Mi Piace: ni una contraseña en
// claro en pantallas, correos o WhatsApp.
//
// ── La marca la decide UNA función (decisión 5) ──────────────────────
//
// La residencia se vende como producto propio (D-37) y su marca todavía no
// existe. Mientras no exista, su correo no dice «Mipiacetpv»: dice «la
// gestión de <razón social>», que es verdad y no le pone al centro el
// nombre de un TPV de hostelería. Los comercios siguen recibiendo el de
// Mipiacetpv.
//
// Está en `marcaDelCorreo` y no en un `if` dentro de la plantilla para que
// el día que la marca de la residencia exista se cambie en un sitio.

import { getEmailSender } from "../email/sender.js";

export interface MarcaDelCorreo {
  /** El nombre del producto, o `null` cuando el correo va sin marca. */
  producto: string | null;
  /** La frase de apertura, ya montada. */
  presentacion: string;
  /** La firma. */
  firma: string;
}

export interface ModulosDeLaCuenta {
  residenciaEnabled?: boolean | null;
  /** La razón social del centro; `null` cae al nombre de la cuenta. */
  razonSocial?: string | null;
  nombreDeLaCuenta: string;
}

/**
 * Qué marca lleva el correo de esta cuenta.
 *
 * Hoy una pregunta: ¿es una residencia? El día que la residencia tenga
 * marca propia, se pone aquí y los dos correos (el de invitación y
 * cualquiera que venga) la heredan.
 */
export function marcaDelCorreo(cuenta: ModulosDeLaCuenta): MarcaDelCorreo {
  const nombre = cuenta.razonSocial?.trim() || cuenta.nombreDeLaCuenta;
  if (cuenta.residenciaEnabled === true) {
    return {
      producto: null,
      presentacion: `ya tienes acceso a la gestión de ${nombre}`,
      firma: "El equipo de Mi Piace",
    };
  }
  return {
    producto: "Mipiacetpv",
    presentacion: `ya tienes acceso a Mipiacetpv, la gestión de ${nombre}`,
    firma: "El equipo de Mipiacetpv",
  };
}

const escape = (s: string): string =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** dd/mm, que es como se lee una fecha de caducidad de un enlace. */
export function diaYMes(fecha: Date): string {
  return `${String(fecha.getDate()).padStart(2, "0")}/${String(
    fecha.getMonth() + 1,
  ).padStart(2, "0")}`;
}

export interface InviteEmailParams {
  ownerEmail: string;
  ownerName: string;
  enlace: string;
  caducaEl: Date;
  marca: MarcaDelCorreo;
  /** pin-1 (punto 4) · **el PIN ya no viaja en el correo.** Lo que viaja
   *  es dónde elegirlo, y sólo si esta cuenta tiene caja: en una
   *  residencia o un colegio no hay TPV al que entrar, así que hablarle
   *  de un PIN sería el primer paso en falso de su primer día (misma
   *  razón que `expectsHolded`).
   *
   *  Antes aquí venía `ownerPin` con cuatro cifras generadas y, debajo,
   *  «Puedes cambiar tu PIN en cualquier momento desde el panel». Eso
   *  era mentira: no existía la pantalla. Ahora existe, y es lo que el
   *  correo cuenta. */
  eligePinEnElPanel?: boolean;
  /** Si tiene que conectar Holded tras entrar. `false` en la empresa que
   *  no lo usa — mandarla a conectarlo era un primer paso en falso. */
  expectsHolded?: boolean;
}

export async function sendOwnerInviteEmail(
  params: InviteEmailParams,
): Promise<void> {
  const { marca } = params;
  const subject = marca.producto
    ? `Tu acceso a ${marca.producto} ya está listo`
    : "Ya tienes acceso a la gestión de tu centro";
  const caduca = diaYMes(params.caducaEl);

  // «Jardín de Gredos, S.A.» ya acaba en punto: añadirle otro deja
  // «S.A..» en el correo. Lo vio el bucle visual, no un test.
  const presentacion = marca.presentacion.endsWith(".")
    ? marca.presentacion
    : `${marca.presentacion}.`;

  const text = [
    `Hola ${params.ownerName},`,
    ``,
    presentacion,
    ``,
    `Crea tu contraseña aquí:`,
    params.enlace,
    ``,
    `El enlace vale 7 días (caduca el ${caduca}). Si caduca, desde la misma`,
    `página puedes pedir otro.`,
    ``,
    `Tu usuario es ${params.ownerEmail}.`,
    ...(params.eligePinEnElPanel === true
      ? [
          ``,
          `Para entrar al TPV (la caja) necesitas un PIN, y lo eliges tú:`,
          `dentro del panel, en "Mi cuenta" → "Elegir PIN". Son cuatro a ocho`,
          `cifras, las que quieras, y puedes cambiarlo cuando quieras desde`,
          `el mismo sitio o desde el propio TPV.`,
        ]
      : []),
    ...(params.expectsHolded === true
      ? [
          ``,
          `Para empezar a operar, conecta tu cuenta de Holded en "Mi cuenta". El catálogo se sincroniza automáticamente en 2-5 minutos.`,
        ]
      : []),
    ``,
    `Si necesitas ayuda, responde a este email.`,
    ``,
    `— ${marca.firma}`,
  ].join("\n");

  const pinBlock =
    params.eligePinEnElPanel === true
      ? `<p style="margin:24px 0 8px"><strong>Tu PIN del TPV lo eliges tú</strong></p>
  <p style="font-size: 13px;">Para entrar a la caja necesitas un PIN. Dentro del panel,
  en <strong>«Mi cuenta» → «Elegir PIN»</strong>: de cuatro a ocho cifras, las que
  quieras. Puedes cambiarlo cuando quieras desde ahí o desde el propio TPV.</p>`
      : "";

  const html = `<!DOCTYPE html>
<html lang="es">
<body style="font-family: -apple-system, system-ui, sans-serif; color: #1f2937; max-width: 560px; margin: 0 auto; padding: 24px;">
  <p>Hola ${escape(params.ownerName)},</p>
  <p>${escape(presentacion)}</p>
  <p style="margin: 28px 0;">
    <a href="${escape(params.enlace)}"
       style="display: inline-block; background: #E8614D; color: #ffffff; text-decoration: none; font-size: 16px; font-weight: 600; padding: 14px 26px; border-radius: 12px;">
      Crear mi contraseña
    </a>
  </p>
  <p style="font-size: 12.5px; color: #6b7280;">
    El enlace vale 7 días (caduca el ${escape(caduca)}). Si caduca, desde la
    misma página puedes pedir otro.
  </p>
  <p style="font-size: 13px;">Tu usuario es <code>${escape(params.ownerEmail)}</code>.</p>
  ${pinBlock}
  ${
    params.expectsHolded === true
      ? '<p>Para empezar a operar, conecta tu cuenta de Holded en "Mi cuenta". El catálogo se sincroniza automáticamente en 2-5 minutos.</p>'
      : ""
  }
  <p>Si necesitas ayuda, responde a este email.</p>
  <p>— ${escape(marca.firma)}</p>
</body>
</html>`;

  await getEmailSender().send({
    to: params.ownerEmail,
    subject,
    text,
    html,
    // Sin `replyTo`: el sender pone el de la casa
    // (`SUPER_ADMIN_REPLY_TO_EMAIL`). «Responde a este email» funciona
    // porque lo pone él, no porque lo repita cada plantilla.
  });
}
