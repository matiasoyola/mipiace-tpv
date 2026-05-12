// CLI para re-ejecutar el script auto-SKU sobre un tenant concreto.
// Idempotente: vuelve a pasar sólo sobre productos con sku vacío y
// needsSkuReview=false. Útil para depurar o para que el propietario
// pueda dispararlo cuando arregle manualmente productos que quedaron en
// revisión (B2 expondrá un botón en el admin).
//
// Uso:
//   pnpm --filter @mipiacetpv/api autosku -- <tenantId>

import "dotenv/config";

import { ApiKeyClient } from "@mipiacetpv/holded-client";

import { getPrisma, shutdown } from "../context.js";
import { decryptSecret } from "../crypto.js";
import { loadEnv } from "../env.js";
import { runAutoSku } from "../onboarding/auto-sku.js";

async function main() {
  const tenantId = process.argv[2];
  if (!tenantId) {
    console.error("Uso: pnpm --filter @mipiacetpv/api autosku -- <tenantId>");
    process.exit(2);
  }
  const env = loadEnv();
  const prisma = getPrisma();
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
  if (!tenant.holdedApiKeyCiphertext) {
    console.error(`Tenant ${tenantId} no tiene API Key persistida.`);
    process.exit(3);
  }
  const apiKey = decryptSecret(tenant.holdedApiKeyCiphertext, env.HOLDED_KEY_ENCRYPTION_SECRET);
  const client = new ApiKeyClient(apiKey, { baseUrl: env.HOLDED_BASE_URL });
  const result = await runAutoSku({ tenantId, prisma, client });
  console.log(JSON.stringify(result, null, 2));
}

main()
  .then(() => shutdown())
  .catch(async (err) => {
    console.error(err);
    await shutdown();
    process.exit(1);
  });
