// CLI interactivo para crear el primer super-admin tras desplegar.
// Uso:
//   pnpm --filter @mipiacetpv/api super-admin:create
//
// Pide email + password (con confirmación), valida formato + fuerza
// mínima 12 chars, hashea con argon2id, INSERT en `super_admin_users`.
// Idempotente — si el email ya existe, error con mensaje claro.
//
// Decisión defensiva: no hay UI para invitar/crear otros super-admins.
// Cada nuevo super-admin se hace por aquí, con acceso al servidor.

import "dotenv/config";

import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

import { hashPassword } from "../auth/passwords.js";
import { getPrisma, shutdown } from "../context.js";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const MIN_PASSWORD_LEN = 12;

async function prompt(question: string, hidden = false): Promise<string> {
  if (!hidden) {
    const rl = createInterface({ input: stdin, output: stdout });
    try {
      return (await rl.question(question)).trim();
    } finally {
      rl.close();
    }
  }
  // Hidden input para passwords (oculta los caracteres con * via raw mode).
  return new Promise<string>((resolve) => {
    stdout.write(question);
    const onData = (buf: Buffer): void => {
      const s = buf.toString("utf-8");
      for (const ch of s) {
        const code = ch.charCodeAt(0);
        if (ch === "\n" || ch === "\r") {
          stdout.write("\n");
          stdin.off("data", onData);
          stdin.setRawMode(false);
          stdin.pause();
          resolve(value);
          return;
        }
        if (code === 0x7f || code === 0x08) {
          // backspace
          if (value.length > 0) {
            value = value.slice(0, -1);
            stdout.write("\b \b");
          }
          continue;
        }
        if (code === 0x03) {
          // Ctrl+C
          stdin.off("data", onData);
          stdin.setRawMode(false);
          stdin.pause();
          process.exit(130);
        }
        value += ch;
        stdout.write("*");
      }
    };
    let value = "";
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on("data", onData);
  });
}

async function main(): Promise<void> {
  console.log("─".repeat(64));
  console.log("Mipiacetpv · Crear super-admin");
  console.log("─".repeat(64));

  const emailRaw = await prompt("Email: ");
  const email = emailRaw.toLowerCase();
  if (!EMAIL_RE.test(email)) {
    console.error("✗ Email con formato inválido.");
    process.exit(2);
  }

  const prisma = getPrisma();
  const existing = await prisma.superAdminUser.findUnique({ where: { email } });
  if (existing) {
    console.error(`✗ Ya existe un super-admin con email ${email}.`);
    console.error("  Para resetear su password, contacta con DBA o borra a mano.");
    process.exit(3);
  }

  const password = await prompt("Password (≥12 chars): ", true);
  if (password.length < MIN_PASSWORD_LEN) {
    console.error(`✗ La password debe tener al menos ${MIN_PASSWORD_LEN} caracteres.`);
    process.exit(2);
  }
  const confirm = await prompt("Repite la password: ", true);
  if (password !== confirm) {
    console.error("✗ Las passwords no coinciden.");
    process.exit(2);
  }

  const passwordHash = await hashPassword(password);
  const sa = await prisma.superAdminUser.create({
    data: { email, passwordHash },
    select: { id: true, email: true, createdAt: true },
  });

  console.log("");
  console.log("✓ Super-admin creado:");
  console.log(`    id:        ${sa.id}`);
  console.log(`    email:     ${sa.email}`);
  console.log(`    createdAt: ${sa.createdAt.toISOString()}`);
  console.log("");
  console.log("  Inicia sesión en /superadmin/login y activa 2FA inmediatamente");
  console.log("  desde 'Mi cuenta' para reforzar la cuenta.");
}

main()
  .then(() => shutdown())
  .catch(async (err) => {
    console.error(err);
    await shutdown();
    process.exit(1);
  });
