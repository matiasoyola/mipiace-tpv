import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// AES-256-GCM para cifrar secretos antes de persistirlos.
// El cuerpo cifrado se serializa como base64 de: IV(12) || authTag(16) || ciphertext.
// Cambiar el formato implica migración — versionamos con prefijo "v1:".
//
// Dos usuarios, y los dos pasan por aquí a propósito:
//
//   · la API Key de Holded (el original);
//   · clinica-7 · **la DEK de cada clínica, envuelta con la KEK**. Una sola
//     implementación de AES-GCM en la casa es una sola donde equivocarse
//     con el IV o con el tag.
//
// ── El AAD, y por qué es opcional ─────────────────────────────────────
//
// clinica-7 ata cada valor cifrado a dónde vive (`aad`): la DEK de un
// tenant va atada a `tenant|kek`, así que una DEK envuelta copiada a la
// fila de otro tenant **no se descifra**. GCM lo da gratis: el AAD entra
// en el cálculo del tag, y un tag que no cuadra es un error, no un
// plaintext distinto.
//
// Es opcional porque los blobs de Holded ya escritos se cifraron sin él, y
// cifrar con AAD y descifrar sin él (o al contrario) falla: añadirlo
// obligatorio habría dejado ilegible la API Key de cada tenant. Quien pasa
// `aad` al cifrar tiene que pasar EL MISMO al descifrar, y eso lo garantiza
// quien llama construyéndolo con una sola función (`clinica/cripto.ts`).

const ALG = "aes-256-gcm" as const;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const FORMAT_PREFIX = "v1:";

function loadKey(base64Secret: string): Buffer {
  const buf = Buffer.from(base64Secret, "base64");
  if (buf.length !== 32) {
    throw new Error("encryption key debe ser 32 bytes base64");
  }
  return buf;
}

export function encryptSecret(
  plaintext: string,
  base64Secret: string,
  aad?: string,
): string {
  const key = loadKey(base64Secret);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALG, key, iv);
  if (aad != null) cipher.setAAD(Buffer.from(aad, "utf8"));
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return FORMAT_PREFIX + Buffer.concat([iv, tag, ct]).toString("base64");
}

export function decryptSecret(
  blob: string,
  base64Secret: string,
  aad?: string,
): string {
  if (!blob.startsWith(FORMAT_PREFIX)) {
    throw new Error("encrypted blob: formato desconocido");
  }
  const data = Buffer.from(blob.slice(FORMAT_PREFIX.length), "base64");
  if (data.length < IV_BYTES + TAG_BYTES + 1) {
    throw new Error("encrypted blob: payload demasiado corto");
  }
  const iv = data.subarray(0, IV_BYTES);
  const tag = data.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ct = data.subarray(IV_BYTES + TAG_BYTES);
  const key = loadKey(base64Secret);
  const decipher = createDecipheriv(ALG, key, iv);
  decipher.setAuthTag(tag);
  if (aad != null) decipher.setAAD(Buffer.from(aad, "utf8"));
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return pt.toString("utf8");
}
