import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// AES-256-GCM para cifrar la API Key de Holded antes de persistirla.
// El cuerpo cifrado se serializa como base64 de: IV(12) || authTag(16) || ciphertext.
// Cambiar el formato implica migración — versionamos con prefijo "v1:".

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

export function encryptSecret(plaintext: string, base64Secret: string): string {
  const key = loadKey(base64Secret);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALG, key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return FORMAT_PREFIX + Buffer.concat([iv, tag, ct]).toString("base64");
}

export function decryptSecret(blob: string, base64Secret: string): string {
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
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return pt.toString("utf8");
}
