// enlaces-publicos · el token y su huella. Lo genérico de lo que clinica-2
// probó en `clinica/enlace.ts`, sin una palabra de clínica.
//
// ── Lo que se conserva de clinica-2, con su razón ─────────────────────
//
//   · La URL ES la credencial: no hay sesión, no hay contraseña. Decisión
//     de producto 4 de clinica-2, «sin contraseñas»: un paciente de 78
//     años no va a crear una cuenta para contestar diez preguntas, y
//     pedírsela significa que no contesta. Vale igual para «mi cita» y
//     para el consentimiento.
//   · Un formato fijo que se comprueba ANTES de ir a la base, para
//     contestar 404 rápido al 99 % de los intentos que no son de nadie.
//   · **El token NO se guarda.** Se guarda su SHA-256. Es la diferencia
//     con `tickets.public_slug`, que vive en claro y está bien así: abre
//     un PDF que su dueño ya tiene en el bolsillo. Un enlace de éstos
//     abre el formulario de salud de una persona o su cita. Con la huella,
//     una copia de la base —un backup, un volcado, un `SELECT` de alguien
//     con acceso al VPS— no abre ni un enlace.
//   · **256 bits y no 64.** El slug del ticket son 16 hex (64 bits), que
//     sobran para lo que protege. Aquí el espacio es 2^256: no hay fuerza
//     bruta que valga ni con el rate-limit apagado.
//
// Y el motor lo respalda: el CHECK `public_links_token_hash_es_sha256`
// sólo admite 64 caracteres hex, así que un token en claro NO CABE en la
// columna. «Lo guardo en claro, que es más fácil de depurar» lo rechaza
// Postgres y no una revisión de código.

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** 32 bytes = 256 bits, en base64url (43 caracteres, sin relleno). */
const BYTES_DEL_TOKEN = 32;

/** El formato que se comprueba antes de tocar la base. */
export const PATRON_TOKEN = /^[A-Za-z0-9_-]{43}$/;

/** Lo que la columna admite. El mismo patrón que el CHECK de la base. */
export const PATRON_HUELLA = /^[0-9a-f]{64}$/;

/** 32 bytes aleatorios en base64url. Existe SÓLO en el email, en la URL
 *  que la persona tiene abierta y en el valor que devuelve `crearEnlace`.
 *  No se escribe en la base, ni en un log, ni en Sentry. */
export function nuevoToken(): string {
  return randomBytes(BYTES_DEL_TOKEN).toString("base64url");
}

/** SHA-256 en hex. Sin sal y sin KDF a propósito: el token son 256 bits
 *  aleatorios, así que no hay diccionario que precomputar — lo que una sal
 *  defiende (contraseñas con entropía humana) aquí no existe, y un KDF
 *  lento sólo encarecería la lectura legítima. */
export function huellaDeToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * Compara dos huellas en tiempo constante.
 *
 * La búsqueda normal es por índice único sobre la huella, así que esto no
 * está en el camino caliente: existe para la comprobación de refuerzo que
 * hace la puerta después de cargar la fila. Es barato y quita de encima la
 * pregunta.
 */
export function mismaHuella(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}
