// primer-acceso · LA INVITACIÓN DEL PRIMER ACCESO.
//
// Hoy, activar una cuenta le manda al propietario una contraseña
// provisional de 16 caracteres raros que tiene que copiar, y en el primer
// acceso se le obliga a cambiarla: **dos contraseñas para entrar una
// vez**. Esto lo sustituye por un enlace.
//
// ── Es la maquinaria del reset, con un tipo distinto (decisión 1) ────
//
// La misma tabla (`password_reset_tokens`), el mismo hash argon2id, el
// mismo `usedAt` de un solo uso y el mismo throttle. Lo único propio es
// el tipo (`INVITE`), el TTL (7 días en vez de 1 hora) y lo que pasa al
// consumirlo (queda la sesión iniciada, no un «vuelve a entrar»).
//
// Inventar un segundo mecanismo habría duplicado el sitio donde se decide
// si un enlace sigue vivo. Y como el tipo se mira SIEMPRE, un token de
// reset no vale como invitación ni al revés — que es uno de los sabotajes
// del bloque.
//
// ── Lo que NO hay aquí ──────────────────────────────────────────────
//
// Ni un `log` con el token, ni con la contraseña, ni con el enlace. El
// token viaja en el CUERPO de las peticiones y no en la URL por esto
// mismo: Fastify loguea la ruta de cada petición, así que
// `GET /auth/invitacion?token=…` habría dejado el token en el log de
// producción sin que nadie lo escribiera.

import { randomBytes } from "node:crypto";

import * as argon2 from "argon2";

import type { Prisma, PrismaClient } from "@mipiacetpv/db";

import { loadEnv } from "../env.js";

/** El cliente o la transacción. `crearInvitacion` va DENTRO de la
 *  transacción de `activate`, así que no puede exigir el cliente. */
type Ejecutor = PrismaClient | Prisma.TransactionClient;

/** 7 días. El reset sigue con 1 hora: son dos urgencias distintas. */
export const INVITE_TTL_DIAS = 7;

const TOKEN_BYTES = 32;

export interface InvitacionCreada {
  /** El token en claro. Sólo viaja al correo y, una vez, a la respuesta
   *  del super-admin para el botón «Copiar enlace». No se persiste. */
  plain: string;
  enlace: string;
  caducaEl: Date;
}

/** El enlace que va en el correo. Una función para que el día que la
 *  ruta cambie no haya dos cadenas que mantener. */
export function enlaceDeInvitacion(plain: string): string {
  const env = loadEnv();
  return `${env.PUBLIC_ADMIN_URL}/bienvenida?token=${plain}`;
}

/**
 * Crea una invitación para un usuario y **mata las anteriores**.
 *
 * Matarlas es lo que hace que «Reenviar invitación» signifique lo que
 * dice: con las viejas vivas, el propietario que recibe dos correos y
 * abre el primero entraría con el enlace que el super-admin creía
 * anulado. Se marcan como usadas en vez de borrarse — la fila es el
 * rastro de que ese enlace existió.
 *
 * Recibe el `Ejecutor` para poder ir dentro de la transacción de
 * `activate`: si la activación se deshace, la invitación se deshace con
 * ella.
 */
export async function crearInvitacion(
  prisma: Ejecutor,
  userId: string,
  ahora: Date = new Date(),
): Promise<InvitacionCreada> {
  await prisma.passwordResetToken.updateMany({
    where: { userId, type: "INVITE", usedAt: null },
    data: { usedAt: ahora },
  });
  const plain = randomBytes(TOKEN_BYTES).toString("base64url");
  const tokenHash = await argon2.hash(plain);
  const caducaEl = new Date(
    ahora.getTime() + INVITE_TTL_DIAS * 24 * 60 * 60 * 1000,
  );
  await prisma.passwordResetToken.create({
    data: { userId, tokenHash, type: "INVITE", expiresAt: caducaEl },
  });
  return { plain, enlace: enlaceDeInvitacion(plain), caducaEl };
}

export interface InvitacionEncontrada {
  tokenId: string;
  userId: string;
}

/**
 * Busca la invitación viva que casa con este token en claro.
 *
 * `type: "INVITE"` está en el `where` y no en un `if` posterior a
 * propósito: así un token de reset nunca entra en la lista de candidatos
 * y no hay forma de que una rama futura lo acepte por descuido.
 *
 * El recorrido con `argon2.verify` es el del reset: el hash lleva salt, así
 * que no se puede buscar por igualdad. En la práctica hay un puñado de
 * invitaciones vivas a la vez en toda la casa.
 */
export async function buscarInvitacion(
  prisma: Ejecutor,
  token: string,
  ahora: Date = new Date(),
): Promise<InvitacionEncontrada | null> {
  const candidatos = await prisma.passwordResetToken.findMany({
    where: { type: "INVITE", usedAt: null, expiresAt: { gt: ahora } },
    select: { id: true, tokenHash: true, userId: true },
    take: 1000,
  });
  for (const c of candidatos) {
    try {
      if (await argon2.verify(c.tokenHash, token)) {
        return { tokenId: c.id, userId: c.userId };
      }
    } catch {
      // entry inválido — saltar, como en el reset.
    }
  }
  return null;
}

/**
 * ¿Hay una invitación PENDIENTE para este usuario, y hasta cuándo?
 *
 * Lo que el super-admin pinta en la tabla de usuarios («Invitación
 * pendiente (caduca dd/mm)») y lo que decide si el reenvío público tiene
 * algo que reenviar. `null` cuando no hay ninguna viva.
 */
export async function invitacionPendienteHasta(
  prisma: Ejecutor,
  userId: string,
  ahora: Date = new Date(),
): Promise<Date | null> {
  const fila = await prisma.passwordResetToken.findFirst({
    where: { userId, type: "INVITE", usedAt: null, expiresAt: { gt: ahora } },
    orderBy: { expiresAt: "desc" },
    select: { expiresAt: true },
  });
  return fila?.expiresAt ?? null;
}
