// primer-acceso · LAS TRES RUTAS DE LA INVITACIÓN.
//
//   · `POST /auth/invitacion/consultar` — qué nombre y qué email pintar en
//     la página de bienvenida, sin dejar elegir ninguno de los dos.
//   · `POST /auth/invitacion/aceptar`   — token + contraseña → **sesión
//     iniciada**. No un «ya puedes entrar»: queda dentro.
//   · `POST /auth/invitacion/reenviar`  — otro enlace al mismo email, con
//     respuesta neutra, para el que abre el correo nueve días después.
//
// ── Por qué POST y no GET, las tres ─────────────────────────────────
//
// El token viaja en el cuerpo. Con `GET /auth/invitacion?token=…`, Fastify
// habría dejado el token completo en el log de acceso de producción sin que
// nadie lo escribiera, y «ningún token en los logs» es una de las cosas que
// este bloque respeta.
//
// ── El throttle es el del reset, y es a propósito ───────────────────
//
// `aceptar` y `consultar` hacen un `argon2.verify` por token vivo, igual
// que el confirm del reset, así que comparten su candado por IP. Y
// `reenviar` comparte el de solicitud por email: el prompt lo pide
// explícitamente («el rate limit del reset se aplica también al reenvío»),
// y si no, el enlace del primer acceso sería la puerta sin candado de la
// misma casa.

import type { FastifyInstance } from "fastify";

import { getPrisma } from "../context.js";
import {
  marcaDelCorreo,
  sendOwnerInviteEmail,
} from "../superadmin/invite-email.js";
import { hashPassword } from "./passwords.js";
import { buscarInvitacion, crearInvitacion } from "./invitacion.js";
import {
  passwordResetConfirmThrottle,
  passwordResetThrottle,
} from "./rate-limit.js";
import { signAccessToken, signRefreshToken } from "./tokens.js";
import {
  CONTRASENA_MIN,
  MENSAJE_CONTRASENA_CORTA,
  contrasenaValida,
} from "@mipiacetpv/util-validation/contrasena";

const emailFormat = "^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$";

/** El 410 de un enlace muerto. Un solo sitio: con uno por ruta, el día
 *  que alguien ajuste el de una, la pantalla de «enlace caducado» dejaría
 *  de reconocer el de la otra. */
export const CODIGO_INVITACION_MUERTA = "INVITACION_CADUCADA_O_USADA";

const INVITACION_MUERTA = {
  error: CODIGO_INVITACION_MUERTA,
  code: CODIGO_INVITACION_MUERTA,
  message:
    "Este enlace ya no vale: ha caducado o ya se ha usado. Pide uno nuevo y te lo mandamos al mismo correo.",
};

/** La respuesta de `reenviar`, SIEMPRE la misma. No dice si el email
 *  existe, ni si había invitación pendiente, ni si se alcanzó el techo
 *  del throttle — igual que el reset (§17.6). */
const NEUTRAL_REENVIO = {
  message:
    "Si ese correo tiene una invitación pendiente, te hemos enviado un enlace nuevo.",
};

/** El nombre que se pinta. El alias es «el nombre visible» del usuario y
 *  es lo que `activate` guarda con el nombre que teclea el implantador;
 *  sin alias, la parte de delante del email, que es mejor que un hueco. */
function nombreVisible(u: { alias: string | null; email: string }): string {
  return u.alias?.trim() || u.email.split("@")[0]!;
}

export async function registerInvitacionRoutes(
  app: FastifyInstance,
): Promise<void> {
  // ── 1 · Qué pinta la página de bienvenida ─────────────────────────
  app.post(
    "/auth/invitacion/consultar",
    {
      schema: {
        body: {
          type: "object",
          required: ["token"],
          additionalProperties: false,
          properties: {
            token: { type: "string", minLength: 1, maxLength: 256 },
          },
        },
      },
    },
    async (request, reply) => {
      const { token } = request.body as { token: string };
      const rl = await passwordResetConfirmThrottle(request.ip);
      if (rl.exceeded) {
        return reply.code(429).send({
          error: "RATE_LIMITED",
          message: `Demasiados intentos. Vuelve a probar en ${Math.ceil(
            rl.retryAfterSeconds / 60,
          )} min.`,
          retryAfterSeconds: rl.retryAfterSeconds,
        });
      }
      const prisma = getPrisma();
      const encontrada = await buscarInvitacion(prisma, token);
      if (!encontrada) return reply.code(410).send(INVITACION_MUERTA);
      const user = await prisma.user.findUnique({
        where: { id: encontrada.userId },
        select: { alias: true, email: true, tenant: { select: { name: true } } },
      });
      if (!user) return reply.code(410).send(INVITACION_MUERTA);
      return reply.code(200).send({
        nombre: nombreVisible(user),
        email: user.email,
        centro: user.tenant.name,
        contrasenaMinima: CONTRASENA_MIN,
      });
    },
  );

  // ── 2 · Aceptar: contraseña elegida y DENTRO ──────────────────────
  //
  // Lo que hace que no haya una segunda pantalla de login: la respuesta
  // es un par access/refresh, como el de `/auth/login`. El `tokenVersion`
  // se incrementa en la misma transacción que marca el token usado, y la
  // sesión se firma con el valor nuevo — si se firmara antes, el refresh
  // del primer minuto se rechazaría a sí mismo.
  app.post(
    "/auth/invitacion/aceptar",
    {
      schema: {
        body: {
          type: "object",
          required: ["token", "password"],
          additionalProperties: false,
          properties: {
            token: { type: "string", minLength: 1, maxLength: 256 },
            password: { type: "string", minLength: 1, maxLength: 256 },
            remember: { type: "boolean" },
          },
        },
      },
    },
    async (request, reply) => {
      const { token, password, remember } = request.body as {
        token: string;
        password: string;
        remember?: boolean;
      };
      const rl = await passwordResetConfirmThrottle(request.ip);
      if (rl.exceeded) {
        return reply.code(429).send({
          error: "RATE_LIMITED",
          message: `Demasiados intentos. Vuelve a probar en ${Math.ceil(
            rl.retryAfterSeconds / 60,
          )} min.`,
          retryAfterSeconds: rl.retryAfterSeconds,
        });
      }
      // La contraseña se valida ANTES de tocar el token: con el orden al
      // revés, una contraseña corta habría quemado el enlace de un solo
      // uso y Carmen se quedaría fuera por un error de tecleo.
      if (!contrasenaValida(password)) {
        return reply.code(400).send({
          error: "PASSWORD_TOO_WEAK",
          message: MENSAJE_CONTRASENA_CORTA,
        });
      }
      const prisma = getPrisma();
      const ahora = new Date();
      const encontrada = await buscarInvitacion(prisma, token, ahora);
      if (!encontrada) return reply.code(410).send(INVITACION_MUERTA);

      const passwordHash = await hashPassword(password);
      const actualizado = await prisma.$transaction(async (tx) => {
        // El `usedAt: null` del `where` es el candado del único uso: dos
        // peticiones a la vez con el mismo token, y la segunda no
        // actualiza ninguna fila.
        const marcado = await tx.passwordResetToken.updateMany({
          where: { id: encontrada.tokenId, usedAt: null },
          data: { usedAt: ahora },
        });
        if (marcado.count === 0) return null;
        return tx.user.update({
          where: { id: encontrada.userId },
          data: {
            passwordHash,
            // La eligió ella con un enlace: no se le pide otra. Es la
            // misma línea que arregla el reset (decisión 4).
            mustChangePasswordAt: null,
            tokenVersion: { increment: 1 },
          },
          select: { id: true, tenantId: true, role: true, tokenVersion: true },
        });
      });
      if (!actualizado) return reply.code(410).send(INVITACION_MUERTA);

      const accessToken = signAccessToken({
        sub: actualizado.id,
        tid: actualizado.tenantId,
        role: actualizado.role,
      });
      const refreshToken = signRefreshToken(
        { sub: actualizado.id, tid: actualizado.tenantId },
        { tv: actualizado.tokenVersion, remember: remember === true },
      );
      return reply.code(200).send({ accessToken, refreshToken });
    },
  );

  // ── 3 · «Envíame uno nuevo» ───────────────────────────────────────
  //
  // Lo pulsa quien abre el correo nueve días después, desde la propia
  // pantalla de enlace caducado. Reenvía SÓLO si la invitación sigue
  // pendiente, y eso quiere decir: es el propietario y **no tiene
  // contraseña utilizable**. Quien ya eligió la suya no necesita una
  // invitación, necesita «olvidé mi contraseña» — y mandarle un enlace
  // que le cambia la contraseña sería una puerta de secuestro de cuenta
  // a la que basta saber el email.
  app.post(
    "/auth/invitacion/reenviar",
    {
      schema: {
        body: {
          type: "object",
          required: ["email"],
          additionalProperties: false,
          properties: {
            email: { type: "string", pattern: emailFormat, maxLength: 320 },
          },
        },
      },
    },
    async (request, reply) => {
      const { email } = request.body as { email: string };
      const lowerEmail = email.toLowerCase();
      // Techo alcanzado → la MISMA respuesta neutra, no un 429: un
      // atacante no debe saber si llegó al techo de este email.
      const throttle = await passwordResetThrottle(lowerEmail);
      if (throttle.exceeded) return reply.code(200).send(NEUTRAL_REENVIO);

      const prisma = getPrisma();
      const user = await prisma.user.findUnique({
        where: { email: lowerEmail },
        select: {
          id: true,
          role: true,
          email: true,
          alias: true,
          passwordHash: true,
          deletedAt: true,
          tenant: {
            select: {
              name: true,
              fiscalProfile: true,
              residenciaEnabled: true,
              holdedApiKeyCiphertext: true,
            },
          },
        },
      });
      const pendiente =
        user != null &&
        user.role === "OWNER" &&
        user.deletedAt == null &&
        user.passwordHash == null;
      if (pendiente) {
        const invitacion = await crearInvitacion(prisma, user.id);
        try {
          await sendOwnerInviteEmail({
            ownerEmail: user.email,
            ownerName: nombreVisible(user),
            enlace: invitacion.enlace,
            caducaEl: invitacion.caducaEl,
            marca: marcaDelCorreo({
              residenciaEnabled: user.tenant.residenciaEnabled,
              razonSocial: razonSocialDe(user.tenant.fiscalProfile),
              nombreDeLaCuenta: user.tenant.name,
            }),
            expectsHolded: user.tenant.holdedApiKeyCiphertext != null,
          });
        } catch (err) {
          // Sin el token ni el enlace en el log: lo que se apunta es que
          // el envío falló y a quién, que es lo que sirve para llamarla.
          request.log.error(
            { event: "invitacion.reenvio_email_failed", userId: user.id, err },
            "Reenvío de invitación: el email falló — el enlace queda vivo 7 días",
          );
        }
      }
      return reply.code(200).send(NEUTRAL_REENVIO);
    },
  );
}

/** La razón social del perfil fiscal, si la hay. Es el nombre con el que
 *  el centro se reconoce («Jardín de Gredos, S.A.»); el de la cuenta es
 *  el que teclea el implantador. */
export function razonSocialDe(perfil: unknown): string | null {
  if (!perfil || typeof perfil !== "object" || Array.isArray(perfil)) return null;
  const obj = perfil as Record<string, unknown>;
  const nombre = obj.legalName ?? obj.businessName;
  return typeof nombre === "string" && nombre.trim().length > 0 ? nombre : null;
}
