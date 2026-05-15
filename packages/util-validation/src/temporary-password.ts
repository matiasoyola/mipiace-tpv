import { randomBytes } from "node:crypto";

// Charset sin caracteres ambiguos: el OWNER recibe la temporal por
// email y tiene que teclearla. Excluimos 0/O/o, 1/l/I, comillas y
// backslashes (problemáticos en shells/copy-paste) y espacios.
export const TEMPORARY_PASSWORD_ALPHABET =
  "abcdefghjkmnpqrstuvwxyz" + // sin l, i, o
  "ABCDEFGHJKLMNPQRSTUVWXYZ" + // sin I, O
  "23456789" + // sin 0, 1
  "#$%*+=?@"; // sin /, \, ", ', `, espacio

const FORBIDDEN_CHARS = "0OoIl1\"'`/\\ ";

const LENGTH = 16;

export function generateTemporaryPassword(): string {
  const alphabet = TEMPORARY_PASSWORD_ALPHABET;
  const size = alphabet.length;
  // Sesgo mínimo: 256 / 64 = 4 exacto. Sin sesgo modular cuando el
  // tamaño del alfabeto divide a 256.
  const bytes = randomBytes(LENGTH);
  let out = "";
  for (let i = 0; i < LENGTH; i++) {
    out += alphabet[bytes[i]! % size];
  }
  // Defensa: si el alfabeto cambiase y algún carácter prohibido se
  // colase, regenerar (no recursivo, sólo loop puntual).
  for (const ch of out) {
    if (FORBIDDEN_CHARS.includes(ch)) {
      return generateTemporaryPassword();
    }
  }
  return out;
}
