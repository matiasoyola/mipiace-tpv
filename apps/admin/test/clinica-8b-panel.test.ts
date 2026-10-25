// clinica-8 (fase B, 18) · LO QUE EL PANEL DECÍA MAL.
//
// Dos de las cuatro cosas del punto 18 son decisiones puras y se fijan
// aquí: el nombre legible de un dispositivo y a dónde va el panel cuando
// la sesión se cae. Las otras dos —«Comanderas» fuera de una clínica y
// «Ver ticket» en Android— se ven en sus pantallas.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { leerDispositivo, nombreDeDispositivo } from "../src/lib/nombre-de-dispositivo.js";

// El user-agent EXACTO de la Lenovo Tab M11 con la APK 1.26.0, que es lo
// que la auditoría del 18-10 vio en la lista de Dispositivos.
const LENOVO_APK =
  "Mozilla/5.0 (Linux; Android 14; TB311FU Build/UP1A.231005.007; wv) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/128.0.6613.88 " +
  "Mobile Safari/537.36";

describe("clinica-8 (18) · un dispositivo con nombre legible", () => {
  it("la Lenovo con la APK sale con su MODELO y que es la app", () => {
    expect(nombreDeDispositivo({ userAgent: LENOVO_APK })).toBe(
      "Android 14 · TB311FU · app",
    );
    // Y lo que NO sale: la cadena entera. Con dos tablets iguales en la
    // lista, «Mozilla/5.0…» no distingue ninguna.
    expect(nombreDeDispositivo({ userAgent: LENOVO_APK })).not.toContain(
      "Mozilla",
    );
  });

  it("el mismo aparato desde el Chrome del sistema se distingue de la app", () => {
    // Importa: alguien que emparejó desde el navegador por error tiene
    // un terminal que no recibe las actualizaciones de la APK, y en la
    // lista salían los dos exactamente igual.
    const navegador = LENOVO_APK.replace("; wv)", ")");
    expect(nombreDeDispositivo({ userAgent: navegador })).toBe(
      "Android 14 · TB311FU · navegador",
    );
  });

  it("Android que esconde el modelo («K») no inventa uno", () => {
    // Chrome manda `Android 10; K` desde que reduce la huella. Pintar
    // «K» como modelo sería peor que no pintarlo.
    const reducido =
      "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36";
    expect(nombreDeDispositivo({ userAgent: reducido })).toBe(
      "Android 10 · navegador",
    );
  });

  it("el iPad apaisado, que es la pantalla que manda en clínica", () => {
    const ipad =
      "Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15";
    expect(nombreDeDispositivo({ userAgent: ipad })).toBe("iPad · iOS 17.4");
  });

  it("el portátil del mostrador, por su sistema y su navegador", () => {
    expect(
      nombreDeDispositivo({
        userAgent:
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
      }),
    ).toBe("Windows · Chrome");
    expect(
      nombreDeDispositivo({
        userAgent:
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
      }),
    ).toBe("Mac · Safari");
  });

  it("MANDA el nombre que alguien le puso: esto es sólo el respaldo", () => {
    expect(
      nombreDeDispositivo({ name: "Caja mostrador", userAgent: LENOVO_APK }),
    ).toBe("Caja mostrador");
    // Y un nombre en blanco no es un nombre.
    expect(nombreDeDispositivo({ name: "   ", userAgent: LENOVO_APK })).toBe(
      "Android 14 · TB311FU · app",
    );
  });

  it("lo que no reconoce lo dice, en vez de inventarse una lectura", () => {
    expect(leerDispositivo("curl/8.4.0")).toBeNull();
    expect(leerDispositivo(null)).toBeNull();
    expect(leerDispositivo("")).toBeNull();
    // Y entonces la lista enseña lo de siempre.
    expect(nombreDeDispositivo({ userAgent: "curl/8.4.0" })).toBe(
      "Dispositivo sin nombre",
    );
  });
});

// ── Con la sesión caída, al login ───────────────────────────────────

describe("clinica-8 (18) · con la sesión caída, al login", () => {
  const original = window.location;
  let replaced: string[];

  beforeEach(() => {
    replaced = [];
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        pathname: "/admin/account",
        replace: (url: string) => replaced.push(url),
      },
    });
  });
  afterEach(() => {
    Object.defineProperty(window, "location", {
      configurable: true,
      value: original,
    });
    vi.resetModules();
  });

  it("desde una pantalla del panel, manda al login", async () => {
    const { alLogin } = await import("../src/api.js");
    alLogin();
    expect(replaced).toEqual(["/login"]);
  });

  it("desde el propio login NO hace nada: se recargaría sola", async () => {
    (window.location as unknown as { pathname: string }).pathname = "/login";
    const { alLogin } = await import("../src/api.js");
    alLogin();
    expect(replaced).toEqual([]);
  });

  it("la consola de super-admin tiene su propio login y no se toca", async () => {
    (window.location as unknown as { pathname: string }).pathname =
      "/superadmin/tenants";
    const { alLogin } = await import("../src/api.js");
    alLogin();
    expect(replaced).toEqual([]);
  });
});
