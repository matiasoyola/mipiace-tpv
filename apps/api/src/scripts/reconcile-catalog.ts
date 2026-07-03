// v1.9-sync-borrados · CLI one-shot para propagar borrados de Holded al
// catálogo local de uno o todos los tenants.
//
// Recorre el listado COMPLETO de Holded (productos forSale≠0 +
// servicios), construye el set de ids vivos y soft-archiva
// (active=false, sellableViaTpv=false, archivedFromHoldedAt=now) todo
// producto local activo que ya no esté. NUNCA borra filas.
//
// Pensado para ejecutarse MANUALMENTE en el VPS tras el deploy de v1.9.
// Resultado esperado en Librería Thalia: los servicios fantasma
// (Fotocopia a color, Fotocopia en blanco y negro, Encuadernacion,
// Escaner, CORREO ELECTRONICO, BOLSA DE PLASTICO) + duplicados
// TALONARIO quedan archivados y fuera del TPV en el siguiente refresh
// de catálogo de los dispositivos.
//
// Uso:
//   pnpm --filter @mipiacetpv/api tsx src/scripts/reconcile-catalog.ts --tenantId=<uuid>
//   pnpm --filter @mipiacetpv/api tsx src/scripts/reconcile-catalog.ts --all
//
// Flags:
//   --force   Salta la protección anti-catástrofe (aborta si el listado
//             devuelve <50% de los productos locales vivos o 0 items).
//             Úsalo SOLO tras verificar a mano que el borrado masivo es
//             legítimo (p. ej. el cliente vació su catálogo a propósito).
//
// Idempotente: re-ejecutar no cambia nada si el catálogo ya está
// conciliado. La reactivación de fichas que reaparezcan en Holded la
// hace el sync incremental normal, no este script.

import "dotenv/config";

import { getPrisma, shutdown } from "../context.js";
import {
  CatalogReconcileSkippedError,
  runCatalogReconcile,
} from "../catalog/reconcile.js";

interface CliArgs {
  tenantId: string | null;
  all: boolean;
  force: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { tenantId: null, all: false, force: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg) continue;
    if (arg.startsWith("--tenantId=")) args.tenantId = arg.slice("--tenantId=".length);
    else if (arg === "--tenantId") args.tenantId = argv[i + 1] ?? null;
    else if (arg === "--all") args.all = true;
    else if (arg === "--force") args.force = true;
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.tenantId && !args.all) {
    console.error(
      "Uso: pnpm --filter @mipiacetpv/api tsx src/scripts/reconcile-catalog.ts (--tenantId=<uuid> | --all) [--force]",
    );
    process.exit(2);
  }

  console.log("─".repeat(64));
  console.log("v1.9-sync-borrados · conciliación de catálogo Holded → TPV");
  if (args.force) {
    console.log("⚠ --force: protección anti-catástrofe DESACTIVADA");
  }
  console.log("─".repeat(64));

  const prisma = getPrisma();
  const tenants = args.all
    ? await prisma.tenant.findMany({
        where: { initialSyncStatus: "DONE", holdedApiKeyCiphertext: { not: null } },
        select: { id: true, name: true },
      })
    : await prisma.tenant.findMany({
        where: { id: args.tenantId! },
        select: { id: true, name: true },
      });

  if (tenants.length === 0) {
    console.error("Ningún tenant coincide.");
    process.exit(1);
  }

  let failures = 0;
  for (const tenant of tenants) {
    console.log(`\n▶ ${tenant.name} (${tenant.id})`);
    try {
      const result = await runCatalogReconcile({
        tenantId: tenant.id,
        prisma,
        force: args.force,
      });
      console.log(JSON.stringify(result, null, 2));
      if (result.aborted) {
        failures += 1;
        console.error(
          `✗ ABORTADO (${result.aborted}) — nada archivado. Revisa el listado de Holded del tenant; si el borrado masivo es legítimo, repite con --force.`,
        );
      } else {
        console.log(`✓ conciliado: ${result.archived} archivados de ${result.localActiveBefore} activos.`);
      }
    } catch (err) {
      if (err instanceof CatalogReconcileSkippedError) {
        console.log(`— saltado (${err.reason})`);
        continue;
      }
      failures += 1;
      console.error(`✗ error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log("");
  if (failures > 0) {
    console.error(`Terminado con ${failures} tenant(s) con error/aborto.`);
    process.exitCode = 1;
  } else {
    console.log("✓ conciliación completada en todos los tenants.");
  }
}

main()
  .then(() => shutdown())
  .catch(async (err) => {
    console.error(err);
    await shutdown();
    process.exit(1);
  });
