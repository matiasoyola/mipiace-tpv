// Healthcheck del contenedor worker (v1.5-consistencia-A §5.3).
//
// Comprueba que la key `worker:heartbeat` existe en Redis (el worker
// la refresca cada 30 s con TTL 120 s — ver workers/heartbeat.ts).
// Exit 0 = sano, exit 1 = sin latido. Se invoca desde el healthcheck
// del compose con tsx; conexión efímera para no dejar sockets vivos.

import { Redis } from "ioredis";

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
const KEY = "worker:heartbeat";

async function main(): Promise<void> {
  const redis = new Redis(REDIS_URL, {
    connectTimeout: 5_000,
    maxRetriesPerRequest: 1,
    lazyConnect: true,
  });
  try {
    await redis.connect();
    const exists = await redis.exists(KEY);
    if (exists !== 1) {
      console.error(`[healthcheck] sin latido: la key ${KEY} no existe`);
      process.exit(1);
    }
    process.exit(0);
  } finally {
    redis.disconnect();
  }
}

main().catch((err) => {
  console.error("[healthcheck] error comprobando heartbeat", err);
  process.exit(1);
});
