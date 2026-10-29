import { loadEnv } from "../env.js";
import { getEmailSender } from "../email/sender.js";

// Email canónico de bienvenida al OWNER recién creado por un super-admin.
// El subject y el body están definidos en el prompt B-SuperAdmin. NO se
// loguea la password temporal en ningún punto (sólo se imprime una vez
// en la response del POST /super-admin/tenants y se envía por email).
//
// ── pin-1 (punto 4) · AQUÍ NO VA NINGÚN PIN ──────────────────────────
//
// Esta plantilla llevaba un bloque «Acceso al TPV (caja): PIN 4817» y,
// debajo, «Puedes cambiar tu PIN en cualquier momento desde el panel
// admin». Lo segundo era MENTIRA: no existía la pantalla. Se van los
// dos, y se va también el parámetro `ownerPin` — para que la promesa no
// pueda volver sin que alguien la escriba a mano.
//
// Desde este bloque, el PIN del TPV lo elige la persona desde «Mi
// cuenta» en el panel. El correo que SÍ lo dice es el de invitación
// (`invite-email.ts`), que es el que recibe quien entra por primera vez.

export interface WelcomeEmailParams {
  ownerEmail: string;
  ownerName: string;
  tempPassword: string;
  // H1 · si el propietario tiene que conectar Holded tras el primer
  // login. `false` en una empresa que no usa Holded: mandarle a
  // conectarlo era el primer paso en falso de su primer día.
  expectsHolded?: boolean;
}

export async function sendOwnerWelcomeEmail(
  params: WelcomeEmailParams,
): Promise<void> {
  const env = loadEnv();
  const subject = "Bienvenido a Mipiacetpv · Tu cuenta está lista";
  const loginUrl = `${env.PUBLIC_ADMIN_URL}/login`;
  const text = [
    `Hola ${params.ownerName},`,
    ``,
    `Te damos la bienvenida a Mipiacetpv. Tu cuenta de propietario ya está lista.`,
    ``,
    `Datos de acceso al panel admin:`,
    `  · URL: ${loginUrl}`,
    `  · Email: ${params.ownerEmail}`,
    `  · Contraseña temporal: ${params.tempPassword}`,
    ``,
    `Por seguridad te pediremos cambiarla en el primer inicio de sesión.`,
    ...(params.expectsHolded !== false
      ? [
          ``,
          `Para empezar a operar, conecta tu cuenta de Holded en "Mi cuenta" tras el primer login. El catálogo se sincroniza automáticamente en 2-5 minutos.`,
        ]
      : []),
    ``,
    `Si necesitas ayuda, responde a este email.`,
    ``,
    `— El equipo de Mipiacetpv`,
  ].join("\n");

  const escape = (s: string): string =>
    s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  const html = `<!DOCTYPE html>
<html lang="es">
<body style="font-family: -apple-system, system-ui, sans-serif; color: #1f2937; max-width: 560px; margin: 0 auto; padding: 24px;">
  <p>Hola ${escape(params.ownerName)},</p>
  <p>Te damos la bienvenida a <strong>Mipiacetpv</strong>. Tu cuenta de propietario ya está lista.</p>
  <p><strong>Datos de acceso al panel admin:</strong></p>
  <ul>
    <li>URL: <a href="${escape(loginUrl)}">${escape(loginUrl)}</a></li>
    <li>Email: <code>${escape(params.ownerEmail)}</code></li>
    <li>Contraseña temporal: <code>${escape(params.tempPassword)}</code></li>
  </ul>
  <p>Por seguridad te pediremos cambiarla en el primer inicio de sesión.</p>
  ${
    params.expectsHolded !== false
      ? '<p>Para empezar a operar, conecta tu cuenta de Holded en "Mi cuenta" tras el primer login. El catálogo se sincroniza automáticamente en 2-5 minutos.</p>'
      : ""
  }
  <p>Si necesitas ayuda, responde a este email.</p>
  <p>— El equipo de Mipiacetpv</p>
</body>
</html>`;

  await getEmailSender().send({
    to: params.ownerEmail,
    subject,
    text,
    html,
  });
}
