// Tests del helper `getTenantHealthStatus` (B6 §3.1). Sin Fastify ni
// red — vector mínimo de comportamiento sobre los umbrales.

import { describe, expect, it } from "vitest";

import { getTenantHealthStatus } from "../src/tickets/health.js";

function stubPrisma(
  tenant: { lastIncrementalSyncAt: Date | null; holdedApiKeyCiphertext: string | null },
) {
  return {
    tenant: {
      findUniqueOrThrow: async () => tenant,
    },
  } as unknown as Parameters<typeof getTenantHealthStatus>[0];
}

describe("getTenantHealthStatus (B6 §3.1)", () => {
  const NOW = new Date("2026-05-13T12:00:00Z");

  it("nivel ok si el último sync fue hace <24h y hay api key", async () => {
    const recent = new Date(NOW.getTime() - 6 * 3600 * 1000);
    const health = await getTenantHealthStatus(
      stubPrisma({ lastIncrementalSyncAt: recent, holdedApiKeyCiphertext: "x" }),
      "t1",
      NOW,
    );
    expect(health.level).toBe("ok");
    expect(health.reason).toBe("ok");
    expect(health.hasHoldedKey).toBe(true);
    expect(health.blockedAt).toBeNull();
  });

  it("warning a partir de 24h sin sync", async () => {
    const at24h = new Date(NOW.getTime() - 25 * 3600 * 1000);
    const health = await getTenantHealthStatus(
      stubPrisma({ lastIncrementalSyncAt: at24h, holdedApiKeyCiphertext: "x" }),
      "t1",
      NOW,
    );
    expect(health.level).toBe("warning");
    expect(health.reason).toBe("no_sync_24h");
    expect(health.blockedAt).toBeNull();
  });

  it("blocked a partir de 48h sin sync, blockedAt = lastSync+48h", async () => {
    const at48h = new Date(NOW.getTime() - 49 * 3600 * 1000);
    const health = await getTenantHealthStatus(
      stubPrisma({ lastIncrementalSyncAt: at48h, holdedApiKeyCiphertext: "x" }),
      "t1",
      NOW,
    );
    expect(health.level).toBe("blocked");
    expect(health.reason).toBe("no_sync_48h");
    expect(health.blockedAt).toBe(
      new Date(at48h.getTime() + 48 * 3600 * 1000).toISOString(),
    );
  });

  it("blocked si la api key falta, sin importar el sync", async () => {
    const recent = new Date(NOW.getTime() - 10 * 60 * 1000);
    const health = await getTenantHealthStatus(
      stubPrisma({
        lastIncrementalSyncAt: recent,
        holdedApiKeyCiphertext: null,
      }),
      "t1",
      NOW,
    );
    expect(health.level).toBe("blocked");
    expect(health.reason).toBe("no_api_key");
    expect(health.hasHoldedKey).toBe(false);
  });

  it("warning sin sync nunca completado pero con api key (onboarding reciente)", async () => {
    const health = await getTenantHealthStatus(
      stubPrisma({ lastIncrementalSyncAt: null, holdedApiKeyCiphertext: "x" }),
      "t1",
      NOW,
    );
    expect(health.level).toBe("warning");
    expect(health.reason).toBe("no_sync_ever");
  });
});
