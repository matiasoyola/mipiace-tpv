// A3-distribución · Frente 2 · versión visible dentro de la app.
//
// El global `Capacitor` sólo existe dentro del WebView de Android. Estos tests
// lo mockean sobre `globalThis` (mismo patrón que platform.test.ts) para cubrir
// los dos entornos sin importar `@capacitor/core`.

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  formatVersionLabel,
  getNativeAppInfo,
  isForeignBundle,
  readBundleTarget,
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

// ─── A4 · ¿el bundle que se ejecuta es el de la APK? ─────────────────────────
//
// La noche del 01-09 el terminal decía "1.0.0 (1) · build 9d76904" y esa
// etiqueta no mentía: el hash ERA el del bundle en ejecución. Lo que no decía
// es que ese bundle venía de producción por internet, servido por un Service
// Worker colado bajo el origen real, y no de los assets de la APK. Hora y
// media para verlo.
//
// El bundle de Android lleva `VITE_TARGET=android` embebido por Vite; el de la
// web no lleva nada. Si el contenedor es Capacitor y el bundle no se declara
// "android", el JS en ejecución es ajeno a la APK y el menú lo dice.

describe("readBundleTarget", () => {
  it("devuelve una cadena, siempre (el menú no puede petar por esto)", () => {
    // Vite sustituye `import.meta.env.VITE_TARGET` en tiempo de build, así que
    // aquí el valor es el del entorno de test y no se puede fingir. Que la
    // marca "android" quede embebida de verdad en el bundle de la APK lo
    // comprueba infra/test/bundle-android.test.ts sobre el dist emitido.
    expect(typeof readBundleTarget()).toBe("string");
  });
});

describe("isForeignBundle", () => {
  it("navegador con bundle de la web → false (es lo normal y correcto)", () => {
    setCapacitor(undefined);
    expect(isForeignBundle("")).toBe(false);
  });

  it("navegador ejecutando el bundle de Android → false: no es asunto suyo", () => {
    // Caso raro (servir el dist de Android desde un navegador) pero el aviso
    // habla de la APK: fuera de Capacitor no significa nada y sólo asustaría.
    setCapacitor(undefined);
    expect(isForeignBundle("android")).toBe(false);
  });

  it("APK ejecutando su propio bundle → false", () => {
    setCapacitor({ isNativePlatform: () => true, getPlatform: () => "android" });
    expect(isForeignBundle("android")).toBe(false);
  });

  it("APK ejecutando el bundle de producción → true (el fallo del 01-09)", () => {
    // El bundle de la web no lleva marca: es exactamente lo que el Service
    // Worker de producción le colaba al WebView.
    setCapacitor({ isNativePlatform: () => true, getPlatform: () => "android" });
    expect(isForeignBundle("")).toBe(true);
  });

  it("APK ejecutando un bundle con marca de otra cosa → true", () => {
    setCapacitor({ isNativePlatform: () => true, getPlatform: () => "android" });
    expect(isForeignBundle("web")).toBe(true);
  });
});

describe("formatVersionLabel · aviso de bundle ajeno", () => {
  it("APK con bundle ajeno → el aviso va al final de la etiqueta", () => {
    expect(
      formatVersionLabel(
        { versionName: "1.0.0", versionCode: "1" },
        "9d76904",
        true,
      ),
    ).toBe("1.0.0 (1) · build 9d76904 · ⚠ bundle ajeno a la APK");
  });

  it("sin versión nativa ni hash, el aviso sigue apareciendo solo", () => {
    // Es justo el caso en que la etiqueta no diría nada: si además se comiera
    // el aviso, el menú quedaría en blanco con el terminal envenenado.
    expect(formatVersionLabel(null, "", true)).toBe("⚠ bundle ajeno a la APK");
  });

  it("por defecto no hay aviso: las llamadas de A3 siguen igual", () => {
    expect(
      formatVersionLabel({ versionName: "1.10.2", versionCode: "11002" }, "a1b2c3d"),
    ).toBe("1.10.2 (11002) · build a1b2c3d");
  });
});
