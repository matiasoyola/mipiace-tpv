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
  /** El PIN de caja de los comercios con caja. Decisión 7: fuera de este
   *  bloque, se sigue mandando como hoy. `null` sin caja. */
  ownerPin?: string | null;
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

  const text = [
    `Hola ${params.ownerName},`,
    ``,
    `${marca.presentacion}.`,
    ``,
    `Crea tu contraseña aquí:`,
    params.enlace,
    ``,
    `El enlace vale 7 días (caduca el ${caduca}). Si caduca, desde la misma`,
    `página puedes pedir otro.`,
    ``,
    `Tu usuario es ${params.ownerEmail}.`,
    ...(params.ownerPin
      ? [
          ``,
          `Acceso al TPV (caja):`,
          `  · Email: ${params.ownerEmail}`,
          `  · PIN: ${params.ownerPin}`,
          ``,
          `Puedes cambiar tu PIN en cualquier momento desde el panel.`,
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

  const pinBlock = params.ownerPin
    ? `<p style="margin:24px 0 8px"><strong>Acceso al TPV (caja):</strong></p>
  <ul>
    <li>Email: <code>${escape(params.ownerEmail)}</code></li>
    <li>PIN: <code>${escape(params.ownerPin)}</code></li>
  </ul>
  <p>Puedes cambiar tu PIN en cualquier momento desde el panel.</p>`
    : "";

  const html = `<!DOCTYPE html>
<html lang="es">
<body style="font-family: -apple-system, system-ui, sans-serif; color: #1f2937; max-width: 560px; margin: 0 auto; padding: 24px;">
  <p>Hola ${escape(params.ownerName)},</p>
  <p>${escape(marca.presentacion)}.</p>
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
