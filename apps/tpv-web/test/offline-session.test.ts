// v1.10-offline-un-terminal §2-3. Capa de sesión offline: login sin red
// contra el paquete cacheado y estado de turno derivado del turno local.

import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("hash-wasm", () => ({
  argon2Verify: vi.fn(async ({ password, hash }: { password: string; hash: string }) =>
    hash === "$argon2id$hash-1234" && password === "1234",
  ),
}));

// apiWithDevice no se usa en offlineLogin/deriveOfflineShiftState, pero
// offlineSession lo importa (refreshOfflineBundle) — lo stubeamos.
vi.mock("../src/api.js", async () => {
  const actual = await vi.importActual<typeof import("../src/api.js")>("../src/api.js");
  return { ...actual, apiWithDevice: vi.fn() };
});

import {
  __resetOfflineAuthForTests,
  saveOfflineBundle,
  getLocalCashierSession,
  type OfflineBundle,
} from "../src/lib/offlineAuth.js";
import { openLocalShift, clearLocalShift } from "../src/lib/offlineShift.js";
import { deriveOfflineShiftState, offlineLogin } from "../src/lib/offlineSession.js";

const BUNDLE: OfflineBundle = {
  registerId: "reg-1",
  config: { cashierSessionTtlMinutes: 480, cashierAutoLogoutMinutes: 10 },
  roster: [
    { id: "u-lucia", email: "lucia@test.com", alias: "Lucía", role: "CASHIER", pinHash: "$argon2id$hash-1234" },
  ],
};

beforeEach(async () => {
  await __resetOfflineAuthForTests();
  (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
  await saveOfflineBundle(BUNDLE);
  await clearLocalShift();
});

describe("offlineSession · login offline", () => {
  it("PIN correcto → sesión local (TTL de config) + shiftState needsShiftOpen", async () => {
    const res = await offlineLogin("lucia@test.com", "1234");
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.sessionTtlMinutes).toBe(480);
      expect(res.shiftState.kind).toBe("needsShiftOpen");
    }
    // La sesión local quedó emitida.
    expect(await getLocalCashierSession()).not.toBeNull();
  });

  it("con un turno local abierto → shiftState reanudar", async () => {
    const shift = await openLocalShift(100);
    const res = await offlineLogin("lucia@test.com", "1234");
    expect(res.ok).toBe(true);
    if (res.ok && res.shiftState.kind === "reanudar") {
      expect(res.shiftState.shift.id).toBe(shift.localId);
    } else {
      throw new Error("esperaba reanudar");
    }
  });

  it("PIN incorrecto → no ok, sin sesión local", async () => {
    const res = await offlineLogin("lucia@test.com", "9999");
    expect(res.ok).toBe(false);
    expect(await getLocalCashierSession()).toBeNull();
  });

  it("deriveOfflineShiftState ignora un turno ya cerrado", async () => {
    await openLocalShift(100);
    // Simula cierre marcando closedAt vía el helper del store.
    const { closeLocalShift } = await import("../src/lib/offlineShift.js");
    await closeLocalShift();
    const state = await deriveOfflineShiftState();
    expect(state.kind).toBe("needsShiftOpen");
  });
});
