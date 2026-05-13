import { randomBytes } from "node:crypto";

import * as argon2 from "argon2";
import jwt from "jsonwebtoken";
import qrcode from "qrcode";
import speakeasy from "speakeasy";

import { Prisma } from "@mipiacetpv/db";

import { decryptSecret, encryptSecret } from "../crypto.js";
import { loadEnv } from "../env.js";

const PENDING_2FA_TTL_SECONDS = 5 * 60;
const TOTP_REGEX = /^[0-9]{6}$/;
const RECOVERY_CODE_REGEX = /^[A-Z0-9]{10}$/;

export interface Pending2faPayload {
  sub: string;
  tid: string;
  rmb: 0 | 1;
  type: "2fa-pending";
}

// JWT corto entre paso 1 (email+password OK) y paso 2 (TOTP). Firmado
// con JWT_ACCESS_SECRET para no añadir clave nueva; el `type` discrimina.
export function signPending2faToken(opts: {
  sub: string;
  tid: string;
  remember: boolean;
}): string {
  const env = loadEnv();
  const body: Omit<Pending2faPayload, "type"> = {
    sub: opts.sub,
    tid: opts.tid,
    rmb: opts.remember ? 1 : 0,
  };
  return jwt.sign({ ...body, type: "2fa-pending" }, env.JWT_ACCESS_SECRET, {
    expiresIn: `${PENDING_2FA_TTL_SECONDS}s` as jwt.SignOptions["expiresIn"],
  });
}

export function verifyPending2faToken(token: string): Pending2faPayload {
  const env = loadEnv();
  const payload = jwt.verify(token, env.JWT_ACCESS_SECRET) as Pending2faPayload;
  if (payload.type !== "2fa-pending") throw new Error("not a 2fa-pending token");
  return payload;
}

export interface EnrollmentResult {
  secret: string; // base32 — sólo se devuelve durante enroll, no se almacena en claro.
  qrDataUrl: string;
  recoveryCodes: string[];
}

// Genera un secret nuevo + QR para escanear. NO persiste — el cliente
// lo confirma con un código TOTP que prueba que el usuario lo escaneó.
export async function generateEnrollment(
  email: string,
): Promise<EnrollmentResult> {
  const secret = speakeasy.generateSecret({
    name: `mipiacetpv (${email})`,
    issuer: "mipiacetpv",
    length: 20,
  });
  const qrDataUrl = await qrcode.toDataURL(secret.otpauth_url!);
  const recoveryCodes = Array.from({ length: 10 }, () => generateRecoveryCode());
  return {
    secret: secret.base32,
    qrDataUrl,
    recoveryCodes,
  };
}

export function generateRecoveryCode(): string {
  // 10 chars alfanum mayúsculas — fácil de leer / pasar a papel.
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(10);
  let out = "";
  for (let i = 0; i < 10; i++) {
    out += alphabet[bytes[i]! % alphabet.length];
  }
  return out;
}

export function verifyTotp(secretBase32: string, code: string): boolean {
  return speakeasy.totp.verify({
    secret: secretBase32,
    encoding: "base32",
    token: code,
    window: 1,
  });
}

export interface StoredRecoveryCode {
  hash: string;
  usedAt: string | null;
}

export async function hashRecoveryCodes(
  plainCodes: string[],
): Promise<StoredRecoveryCode[]> {
  const out: StoredRecoveryCode[] = [];
  for (const plain of plainCodes) {
    out.push({ hash: await argon2.hash(plain), usedAt: null });
  }
  return out;
}

// Intenta consumir un recovery code. Devuelve la nueva lista (con el
// usedAt marcado) o null si no matcheó ninguno o ya estaban todos usados.
export async function consumeRecoveryCode(
  stored: StoredRecoveryCode[],
  attempt: string,
): Promise<StoredRecoveryCode[] | null> {
  if (!RECOVERY_CODE_REGEX.test(attempt)) return null;
  for (let i = 0; i < stored.length; i++) {
    const entry = stored[i]!;
    if (entry.usedAt != null) continue;
    try {
      if (await argon2.verify(entry.hash, attempt)) {
        return stored.map((e, idx) =>
          idx === i ? { ...e, usedAt: new Date().toISOString() } : e,
        );
      }
    } catch {
      // entry con formato inesperado — saltar.
    }
  }
  return null;
}

export function isTotpCode(code: string): boolean {
  return TOTP_REGEX.test(code);
}

export function isRecoveryCode(code: string): boolean {
  return RECOVERY_CODE_REGEX.test(code);
}

// Helpers de cifrado del secret TOTP usando la misma clave AES-GCM
// versionada (`v1:`) que la API key de Holded — un único secret de
// encryption en el `.env`, todas las columnas sensibles cifradas con él.
export function encryptTwoFactorSecret(secretBase32: string): string {
  const env = loadEnv();
  return encryptSecret(secretBase32, env.HOLDED_KEY_ENCRYPTION_SECRET);
}

export function decryptTwoFactorSecret(ciphertext: string): string {
  const env = loadEnv();
  return decryptSecret(ciphertext, env.HOLDED_KEY_ENCRYPTION_SECRET);
}

// Tipado seguro para leer el campo Json de Prisma — sin esto el
// consumer tiene que castear cada vez.
export function readStoredRecoveryCodes(
  value: Prisma.JsonValue | null,
): StoredRecoveryCode[] {
  if (!Array.isArray(value)) return [];
  const out: StoredRecoveryCode[] = [];
  for (const entry of value) {
    if (
      entry &&
      typeof entry === "object" &&
      !Array.isArray(entry) &&
      typeof (entry as { hash?: unknown }).hash === "string"
    ) {
      out.push({
        hash: (entry as { hash: string }).hash,
        usedAt:
          (entry as { usedAt?: string | null }).usedAt &&
          typeof (entry as { usedAt?: string | null }).usedAt === "string"
            ? ((entry as { usedAt: string }).usedAt)
            : null,
      });
    }
  }
  return out;
}
