// CLI para re-ejecutar el sync incremental sobre un tenant concreto.
// Útil para validar manualmente cambios en el pipeline (p.ej. el fix de
// taxes de B7.5) sin esperar al cron de 15 min.
//
// Uso:
//   pnpm --filter @mipiacetpv/api resync -- <tenantId>

import "dotenv/config";

import { getPrisma, shutdown } from "../context.js";
import { runIncrementalSync } from "../catalog/incremental-sync.js";

async function main() {
  const tenantId = process.argv[2];
  if (!tenantId) {
    console.error("Uso: pnpm --filter @mipiacetpv/api resync -- <tenantId>");
    process.exit(2);
  }
  const prisma = getPrisma();
  const stats = await runIncrementalSync({ tenantId, prisma });
  console.log(JSON.stringify(stats, null, 2));
}

main()
  .then(() => shutdown())
  .catch(async (err) => {
    console.error(err);
    await shutdown();
    process.exit(1);
  });
