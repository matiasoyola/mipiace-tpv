// v1.10-offline-un-terminal §2. Login de cajero offline: verificación
// del PIN contra el pinHash cacheado, rate-limit local (5 fallos →
// bloqueo) y refresco del paquete en cada bootstrap online.
//
// argon2Verify (hash-wasm) se mockea para no cargar WASM ni un hash real
// en jsdom: la aritmética de rate-limit y la persistencia IDB son lo que
// probamos aquí. La verificación argon2 real vive en producción; el
// contrato con hash-wasm es "argon2Verify({password, hash}) → boolean".

import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("hash-wasm", () => ({
  // PIN válido = "1234" contra el pinHash sentinel "$argon2id$hash-1234".
  argon2Verify: vi.fn(async ({ password, hash }: { password: string; hash: string }) =>
    hash === "$argon2id$hash-1234" && password === "1234",
  ),
}));

import {
  __resetOfflineAuthForTests,
  getLocalCashierSession,
  getOfflineConfig,
  hasOfflineBundle,
  inspectRateLimit,
  saveOfflineBundle,
  setLocalCashierSession,
  verifyPinLocal,
  MAX_ATTEMPTS,
  LOCK_MS,
  type OfflineBundle,
} from "../src/lib/offlineAuth.js";

const BUNDLE: OfflineBundle = {
  registerId: "reg-1",
  config: { cashierSessionTtlMinutes: 720, cashierAutoLogoutMinutes: 10 },
  roster: [
    {
      id: "u-lucia",
      email: "Lucia@Test.com",
      alias: "Lucía",
      role: "CASHIER",
      pinHash: "$argon2id$hash-1234",
    },
  ],
};

beforeEach(async () => {
  await __resetOfflineAuthForTests();
  // fake-indexeddb: IDBFactory nuevo por test.
  (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
});

describe("offlineAuth · paquete offline", () => {
  it("saveOfflineBundle persiste roster (email normalizado) + config", async () => {
    await saveOfflineBundle(BUNDLE);
    expect(await hasOfflineBundle()).toBe(true);
    const config = await getOfflineConfig();
    expect(config?.cashierSessionTtlMinutes).toBe(720);
    // email guardado en minúsculas → login case-insensitive.
    const ok = await verifyPinLocal("lucia@test.com", "1234");
    expect(ok.ok).toBe(true);
  });

  it("un bootstrap posterior REEMPLAZA el roster (cajero de baja desaparece)", async () => {
    await saveOfflineBundle(BUNDLE);
    await saveOfflineBundle({ ...BUNDLE, roster: [] });
    expect(await hasOfflineBundle()).toBe(false);
    const res = await verifyPinLocal("lucia@test.com", "1234");
    expect(res).toMatchObject({ ok: false, reason: "no_bundle" });
  });
});

describe("offlineAuth · verificación de PIN local", () => {
  beforeEach(async () => {
    await saveOfflineBundle(BUNDLE);
  });

  it("PIN correcto → ok + user (sin pinHash)", async () => {
    const res = await verifyPinLocal("lucia@test.com", "1234");
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.user.id).toBe("u-lucia");
      expect(res.user.role).toBe("CASHIER");
      expect((res.user as Record<string, unknown>).pinHash).toBeUndefined();
    }
  });

  it("PIN incorrecto → invalid + attemptsRemaining decreciente", async () => {
    const r1 = await verifyPinLocal("lucia@test.com", "0000");
    expect(r1).toMatchObject({ ok: false, reason: "invalid", attemptsRemaining: 4 });
    const r2 = await verifyPinLocal("lucia@test.com", "0000");
    expect(r2).toMatchObject({ ok: false, attemptsRemaining: 3 });
  });

  it("5 fallos → bloqueo local (rate_limited) con lockedUntilMs", async () => {
    const base = 1_000_000;
    let last;
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      last = await verifyPinLocal("lucia@test.com", "0000", base + i * 1000);
    }
    expect(last).toMatchObject({ ok: false, reason: "rate_limited" });
    // Incluso con PIN correcto, sigue bloqueado dentro de la ventana.
    const blocked = await verifyPinLocal("lucia@test.com", "1234", base + 6000);
    expect(blocked).toMatchObject({ ok: false, reason: "rate_limited" });
    // Pasado el candado (15 min), vuelve a permitir.
    const after = await verifyPinLocal("lucia@test.com", "1234", base + LOCK_MS + 10_000);
    expect(after.ok).toBe(true);
  });

  it("un login correcto resetea el contador de fallos", async () => {
    await verifyPinLocal("lucia@test.com", "0000");
    await verifyPinLocal("lucia@test.com", "0000");
    await verifyPinLocal("lucia@test.com", "1234"); // reset
    const state = await inspectRateLimit("lucia@test.com");
    expect(state.attemptsRemaining).toBe(MAX_ATTEMPTS);
  });
});

describe("offlineAuth · sesión local", () => {
  it("setLocalCashierSession → getLocalCashierSession dentro del TTL", async () => {
    const now = 5_000_000;
    await setLocalCashierSession(
      { id: "u-lucia", email: "lucia@test.com", alias: "Lucía", role: "CASHIER" },
      720,
      now,
    );
    const active = await getLocalCashierSession(now + 60_000);
    expect(active?.userId).toBe("u-lucia");
    // Caducada tras el TTL.
    const expired = await getLocalCashierSession(now + 721 * 60_000);
    expect(expired).toBeNull();
  });
});
