// A1 (carryover A0 · Frente 4) · adaptador de plataforma.
//
// El global `Capacitor` sólo existe dentro del WebView de la app
// Android. Estos tests mockean ese global sobre `globalThis` para
// verificar que la detección web/android es correcta sin importar
// `@capacitor/core` (regresión cero en navegador).

import { afterEach, describe, expect, it } from "vitest";

import { getPlatform, isCapacitor } from "../src/platform/index.js";

interface CapacitorGlobal {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
}

function setCapacitor(cap: CapacitorGlobal | undefined): void {
  (globalThis as unknown as { Capacitor?: CapacitorGlobal }).Capacitor = cap;
}

afterEach(() => {
  setCapacitor(undefined);
});

describe("platform adapter", () => {
  it("sin global Capacitor → web", () => {
    setCapacitor(undefined);
    expect(isCapacitor()).toBe(false);
    expect(getPlatform()).toBe("web");
  });

  it("Capacitor presente pero no nativo (stub web) → web", () => {
    setCapacitor({ isNativePlatform: () => false, getPlatform: () => "web" });
    expect(isCapacitor()).toBe(false);
    expect(getPlatform()).toBe("web");
  });

  it("Capacitor nativo android → android", () => {
    setCapacitor({
      isNativePlatform: () => true,
      getPlatform: () => "android",
    });
    expect(isCapacitor()).toBe(true);
    expect(getPlatform()).toBe("android");
  });

  it("nativo pero plataforma desconocida → web (sólo empaquetamos android)", () => {
    setCapacitor({ isNativePlatform: () => true, getPlatform: () => "ios" });
    expect(getPlatform()).toBe("web");
  });
});
