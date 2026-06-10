// v1.4-Precio-Decimales · b30 · CLI para forzar un re-pull del catálogo
// de productos+servicios desde Holded a un tenant concreto.
//
// Pensado para ejecutarse MANUALMENTE en el VPS tras desplegar la
// migración b30 (Decimal(10,2) → Decimal(12,4)). Antes de b30, los
// precios NET se truncaban a 2 decimales al persistirlos; este script
// repuebla `basePrice` con los 4 decimales que Holded mantiene
// internamente (p.ej. `3.8843`), eliminando el drift de 1 céntimo entre
// el TPV y el documento emitido en Holded.
//
// Uso:
//   pnpm --filter @mipiacetpv/api tsx src/scripts/resync-catalog.ts --tenantId=<uuid>
//
// Idempotente: reutiliza `runIncrementalSync`, que ya es idempotente
// (upserts por holdedProductId + soft-delete de huérfanos). Re-ejecutar
// no destruye datos; sólo trae el estado fresco de Holded.
//
// Si la migración b30 todavía no se aplicó, los precios se truncarán al
// guardar (la columna seguirá siendo Decimal(10,2)) — correr el script
// no causa daño, simplemente no soluciona el bug.

import "dotenv/config";

import { getPrisma, shutdown } from "../context.js";
import { runIncrementalSync } from "../catalog/incremental-sync.js";

function parseTenantId(argv: string[]): string | null {
  for (const arg of argv) {
    if (arg.startsWith("--tenantId=")) return arg.slice("--tenantId=".length);
    if (arg === "--tenantId") {
      const idx = argv.indexOf(arg);
      return argv[idx + 1] ?? null;
    }
  }
  return null;
}

async function main(): Promise<void> {
  const tenantId = parseTenantId(process.argv.slice(2));
  if (!tenantId) {
    console.error(
      "Uso: pnpm --filter @mipiacetpv/api tsx src/scripts/resync-catalog.ts --tenantId=<uuid>",
    );
    process.exit(2);
  }

  console.log("─".repeat(64));
  console.log("v1.4-Precio-Decimales · resync de catálogo (4 decimales)");
  console.log("─".repeat(64));
  console.log(`tenantId: ${tenantId}`);
  console.log("");

  const prisma = getPrisma();
  const stats = await runIncrementalSync({ tenantId, prisma });
  console.log(JSON.stringify(stats, null, 2));
  console.log("");
  console.log("✓ resync completado. Verifica `basePrice` con 4 decimales en BD.");
}

main()
  .then(() => shutdown())
  .catch(async (err) => {
    console.error(err);
    await shutdown();
    process.exit(1);
  });
