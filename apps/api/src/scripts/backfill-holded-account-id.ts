// v1.3-SuperAdmin-Hub · Lote 3 · CLI para rellenar holdedAccountId en
// tenants que ya existían antes de que el campo fuese required.
//
// Uso:
//   pnpm --filter @mipiacetpv/api backfill:holded-account-id
//
// El script lista los tenants con holdedAccountId NULL y pide al
// implantador el id para cada uno (lo saca de la URL del panel Holded
// del cliente: https://app.holded.com/accounts/<id>/…). Se puede pegar
// la URL completa: el script recorta al id automáticamente. Pulsar
// Enter en vacío salta el tenant (queda NULL hasta la próxima vuelta).
//
// Idempotente: re-ejecutarlo sólo pregunta por los tenants que sigan
// con NULL. Las llamadas a Prisma usan `update` sobre la PK, no hay
// riesgo de pisar datos no relacionados.

import "dotenv/config";

import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

import { getPrisma, shutdown } from "../context.js";

function normalizeAccountId(raw: string): string {
  const match = raw.match(/accounts\/([^/?#]+)/i);
  if (match && match[1]) return match[1];
  return raw.trim().replace(/\/+$/, "");
}

async function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

async function main(): Promise<void> {
  console.log("─".repeat(64));
  console.log("Mipiacetpv · Backfill holdedAccountId");
  console.log("─".repeat(64));

  const prisma = getPrisma();
  const pending = await prisma.tenant.findMany({
    where: { holdedAccountId: null },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      name: true,
      onboardingState: true,
      createdAt: true,
    },
  });

  if (pending.length === 0) {
    console.log("✓ Todos los tenants tienen holdedAccountId. Nada que hacer.");
    return;
  }

  console.log("");
  console.log(`Tenants sin holdedAccountId: ${pending.length}`);
  console.log("");
  console.log(
    "Para cada uno, pega el id del panel Holded (o la URL entera).",
  );
  console.log("Enter en vacío salta el tenant — quedará NULL hasta otra vuelta.");
  console.log("Ctrl+C para abortar.");
  console.log("");

  let updated = 0;
  let skipped = 0;
  for (const t of pending) {
    const header =
      `[${t.onboardingState}] ${t.name} ` +
      `(id=${t.id.slice(0, 8)}…, creado ${t.createdAt.toISOString().slice(0, 10)})`;
    console.log(header);
    const raw = await prompt("  holdedAccountId: ");
    if (!raw) {
      console.log("  · saltado");
      skipped++;
      console.log("");
      continue;
    }
    const normalized = normalizeAccountId(raw);
    if (normalized.length === 0) {
      console.log("  · entrada vacía tras normalizar, saltado");
      skipped++;
      console.log("");
      continue;
    }
    if (normalized.length > 64) {
      console.log(`  ✗ id demasiado largo (${normalized.length} > 64), saltado`);
      skipped++;
      console.log("");
      continue;
    }
    await prisma.tenant.update({
      where: { id: t.id },
      data: { holdedAccountId: normalized },
    });
    console.log(`  ✓ guardado: ${normalized}`);
    updated++;
    console.log("");
  }

  console.log("─".repeat(64));
  console.log(`Resultado: ${updated} actualizado(s), ${skipped} saltado(s).`);
  if (skipped > 0) {
    console.log(
      "  Re-ejecuta el script o usa la consola super-admin (detalle del tenant)",
    );
    console.log("  para rellenar los que faltan.");
  }
}

main()
  .then(() => shutdown())
  .catch(async (err) => {
    console.error(err);
    await shutdown();
    process.exit(1);
  });
