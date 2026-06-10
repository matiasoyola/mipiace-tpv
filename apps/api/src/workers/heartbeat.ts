// Heartbeat del proceso de workers (v1.5-consistencia-A §5.3).
//
// El worker era el único servicio del compose sin healthcheck: si el
// proceso se colgaba (event loop bloqueado, conexión Redis zombi),
// Docker lo seguía considerando vivo. Ahora escribe
// `SET worker:heartbeat <ts> EX 120` cada 30 s; el healthcheck del
// contenedor (scripts/check-worker-heartbeat.ts) comprueba que la key
// existe. TTL 120 s = 4 intervalos de margen antes de que Docker
// marque unhealthy y `restart: unless-stopped` lo recicle.

import { getRedis } from "../context.js";

export const WORKER_HEARTBEAT_KEY = "worker:heartbeat";
export const WORKER_HEARTBEAT_TTL_SECONDS = 120;
const HEARTBEAT_INTERVAL_MS = 30_000;

async function beat(): Promise<void> {
  await getRedis().set(
    WORKER_HEARTBEAT_KEY,
    String(Date.now()),
    "EX",
    WORKER_HEARTBEAT_TTL_SECONDS,
  );
}

export function startWorkerHeartbeat(): { stop(): void } {
  // Primer latido inmediato — sin él, el healthcheck fallaría durante
  // los primeros 30 s aunque el worker esté sano.
  void beat().catch((err) => {
    console.error("[heartbeat] primer latido falló", err);
  });
  const timer = setInterval(() => {
    void beat().catch((err) => {
      // Redis caído: no matamos el proceso (BullMQ ya reintenta solo);
      // la key expirará y Docker verá el unhealthy.
      console.error("[heartbeat] latido falló", err);
    });
  }, HEARTBEAT_INTERVAL_MS);
  return {
    stop() {
      clearInterval(timer);
    },
  };
}
