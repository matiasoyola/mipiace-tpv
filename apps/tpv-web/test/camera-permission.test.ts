// A2-Android · Frente 1 · permiso de cámara (lado JS).
//
// No se puede testear el permiso nativo real en CI, así que mockeamos el
// plugin Capacitor (global `Capacitor.registerPlugin`) y verificamos que
// `ensureCameraPermission`:
//   - devuelve "web" en navegador (sin global Capacitor),
//   - devuelve "granted" si el permiso ya está concedido (no pide),
//   - pide el permiso si falta y mapea concedido/denegado,
//   - degrada a "web" si el plugin lanza (no bloquea el escaneo).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ensureCameraPermission } from "../src/platform/camera/CameraPermission.js";

interface FakePlugin {
  check: ReturnType<typeof vi.fn>;
  request: ReturnType<typeof vi.fn>;
}

let plugin: FakePlugin;

function setCapacitor(withPlugin: boolean): void {
  (globalThis as unknown as { Capacitor?: unknown }).Capacitor = withPlugin
    ? {
        isNativePlatform: () => true,
        getPlatform: () => "android",
        registerPlugin: () => plugin,
      }
    : undefined;
}

beforeEach(() => {
  plugin = {
    check: vi.fn(async () => ({ granted: false })),
    request: vi.fn(async () => ({ granted: true })),
  };
});

afterEach(() => {
  setCapacitor(false);
  vi.restoreAllMocks();
});

describe("ensureCameraPermission", () => {
  it("devuelve 'web' en navegador (sin Capacitor)", async () => {
    setCapacitor(false);
    await expect(ensureCameraPermission()).resolves.toBe("web");
  });

  it("no pide permiso si ya está concedido", async () => {
    setCapacitor(true);
    plugin.check.mockResolvedValueOnce({ granted: true });
    await expect(ensureCameraPermission()).resolves.toBe("granted");
    expect(plugin.request).not.toHaveBeenCalled();
  });

  it("pide permiso si falta y mapea concedido", async () => {
    setCapacitor(true);
    plugin.check.mockResolvedValueOnce({ granted: false });
    plugin.request.mockResolvedValueOnce({ granted: true });
    await expect(ensureCameraPermission()).resolves.toBe("granted");
    expect(plugin.request).toHaveBeenCalledOnce();
  });

  it("mapea denegado cuando el usuario rechaza", async () => {
    setCapacitor(true);
    plugin.check.mockResolvedValueOnce({ granted: false });
    plugin.request.mockResolvedValueOnce({ granted: false });
    await expect(ensureCameraPermission()).resolves.toBe("denied");
  });

  it("degrada a 'web' si el plugin lanza (no bloquea el escaneo)", async () => {
    setCapacitor(true);
    plugin.check.mockRejectedValueOnce(new Error("bridge caído"));
    await expect(ensureCameraPermission()).resolves.toBe("web");
  });
});
