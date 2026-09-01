// A3-distribución · Frente 2 · versión visible dentro de la app.
//
// El global `Capacitor` sólo existe dentro del WebView de Android. Estos tests
// lo mockean sobre `globalThis` (mismo patrón que platform.test.ts) para cubrir
// los dos entornos sin importar `@capacitor/core`.

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  formatVersionLabel,
  getNativeAppInfo,
} from "../src/platform/AppInfo.js";

interface CapacitorGlobal {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
  registerPlugin?: <T>(name: string) => T;
}

function setCapacitor(cap: CapacitorGlobal | undefined): void {
  (globalThis as unknown as { Capacitor?: CapacitorGlobal }).Capacitor = cap;
}

/** Bridge nativo cuyo plugin `App` devuelve lo que se le pase. */
function nativeBridgeReturning(info: unknown): CapacitorGlobal {
  return {
    isNativePlatform: () => true,
    getPlatform: () => "android",
    registerPlugin: <T,>(_name: string) =>
      ({ getInfo: () => Promise.resolve(info) }) as T,
  };
}

afterEach(() => {
  setCapacitor(undefined);
});

describe("formatVersionLabel", () => {
  it("android con hash → versión, código y build", () => {
    expect(
      formatVersionLabel(
        { versionName: "1.10.2", versionCode: "11002" },
        "a1b2c3d",
      ),
    ).toBe("1.10.2 (11002) · build a1b2c3d");
  });

  it("android sin hash (dev local) → sin el sufijo build, sin separador huérfano", () => {
    expect(
      formatVersionLabel({ versionName: "1.10.2", versionCode: "11002" }, ""),
    ).toBe("1.10.2 (11002)");
  });

  it("web → sólo el hash: no hay versionCode fuera de Gradle y no se inventa", () => {
    expect(formatVersionLabel(null, "a1b2c3d")).toBe("build a1b2c3d");
  });

  it("web sin hash → cadena vacía, y el menú no pinta la línea", () => {
    expect(formatVersionLabel(null, "")).toBe("");
  });

  it("hash con espacios alrededor → se normaliza", () => {
    expect(formatVersionLabel(null, "  a1b2c3d  ")).toBe("build a1b2c3d");
  });
});

describe("getNativeAppInfo", () => {
  it("sin global Capacitor (navegador) → null", async () => {
    setCapacitor(undefined);
    await expect(getNativeAppInfo()).resolves.toBeNull();
  });

  it("Capacitor sin registerPlugin → null", async () => {
    setCapacitor({ isNativePlatform: () => true });
    await expect(getNativeAppInfo()).resolves.toBeNull();
  });

  it("plugin App presente → versionName y versionCode", async () => {
    setCapacitor(nativeBridgeReturning({ version: "1.10.2", build: "11002" }));
    await expect(getNativeAppInfo()).resolves.toEqual({
      versionName: "1.10.2",
      versionCode: "11002",
    });
  });

  it("build serializado como número → se normaliza a string", async () => {
    setCapacitor(nativeBridgeReturning({ version: "1.10.2", build: 11002 }));
    await expect(getNativeAppInfo()).resolves.toEqual({
      versionName: "1.10.2",
      versionCode: "11002",
    });
  });

  it("respuesta a medias (sin build) → null, no '1.10.2 ()'", async () => {
    setCapacitor(nativeBridgeReturning({ version: "1.10.2" }));
    await expect(getNativeAppInfo()).resolves.toBeNull();
  });

  it("plugin que lanza → null, nunca propaga a la pantalla de venta", async () => {
    setCapacitor({
      isNativePlatform: () => true,
      registerPlugin: <T,>(_name: string) =>
        ({
          getInfo: () => Promise.reject(new Error("bridge caído")),
        }) as T,
    });
    await expect(getNativeAppInfo()).resolves.toBeNull();
  });

  it("pide el plugin 'App' por su nombre exacto", async () => {
    const registerPlugin = vi.fn(
      <T,>(_name: string) =>
        ({
          getInfo: () => Promise.resolve({ version: "1.10.2", build: "11002" }),
        }) as T,
    );
    setCapacitor({ isNativePlatform: () => true, registerPlugin });
    await getNativeAppInfo();
    expect(registerPlugin).toHaveBeenCalledWith("App");
  });
});
