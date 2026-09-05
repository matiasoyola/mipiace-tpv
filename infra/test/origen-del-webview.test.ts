// A5 · R5 · el origen del WebView no se toca.
//
// EL INCIDENTE (2026-09-04). Una APK salió con `androidScheme: "http"` y
// `hostname: "a5-lab.mipiacetpv.com"` —puestas a mano, marcadas TEMPORAL, para
// una pasada de laboratorio de A5— y un cliente real se quedó sin cobrar. El
// WebView guarda `localStorage` por origen: al cambiar esquema y host, el
// terminal arrancó con un almacén vacío, sin `mipiacetpv-device-token`, y pidió
// un código de 6 dígitos en mitad del servicio.
//
// El fallo tiene la peor forma posible: no rompe el build, no rompe la
// instalación, y no se ve en un terminal nuevo (que no tiene vinculación que
// perder). Sólo aparece al ACTUALIZAR un terminal que ya funcionaba — el único
// caso que no se prueba en la mesa antes de salir.
//
// Tres redes, y hacen falta las tres:
//
//   1. Los valores. `capacitor.config.ts` declara exactamente los de
//      producción. Si alguien vuelve a dejarse un TEMPORAL puesto, este test se
//      pone rojo antes de que exista ninguna APK.
//   2. La guarda. El script que valida el origen aborta de verdad ante cada uno
//      de los tres valores malos, por separado, y NO se puede apagar con una
//      variable de entorno.
//   3. El cableado. Los dos scripts de release LLAMAN a la guarda. Sin esta
//      red, borrar una línea de bash desarma las otras dos sin poner nada rojo.
//
// La guarda anterior (hallazgo B2) existía y no sirvió: sólo miraba `hostname`,
// ignoraba `androidScheme`, y su valor esperado salía de `VITE_TPV_URL`. Los
// casos 2 y 3 de este fichero son exactamente esos dos agujeros.

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import {
  ORIGEN_ESPERADO,
  comprobarOrigen,
  leerConfigJson,
  leerConfigTs,
} from "../../apps/tpv-android/scripts/origen-del-webview.mjs";

const ROOT = resolve(__dirname, "../..");
const CONFIG_TS = join(ROOT, "apps/tpv-android/capacitor.config.ts");
const GUARDA = join(ROOT, "apps/tpv-android/scripts/verificar-origen.mjs");
const APK_SH = join(ROOT, "apps/tpv-android/scripts/build-release-apk.sh");
const AAB_SH = join(ROOT, "apps/tpv-android/scripts/build-release-aab.sh");

const temporales: string[] = [];

/** Escribe un capacitor.config.ts de mentira y devuelve su ruta. */
function configConValores(valores: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "r5-"));
  temporales.push(dir);
  const ruta = join(dir, "capacitor.config.ts");
  writeFileSync(
    ruta,
    `const config = {
  appId: "es.mipiace.tpv",
  android: { allowMixedContent: ${valores.allowMixedContent} },
  server: {
    androidScheme: "${valores.androidScheme}",
    hostname: "${valores.hostname}",
  },
};
export default config;
`,
  );
  return ruta;
}

/** Corre la guarda tal y como la corre el script de build. */
function correrGuarda(
  modo: "--ts" | "--json",
  ruta: string,
  env: NodeJS.ProcessEnv = {},
): { code: number; salida: string } {
  const r = spawnSync("node", [GUARDA, modo, ruta], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  return { code: r.status ?? -1, salida: `${r.stdout}${r.stderr}` };
}

afterAll(() => {
  for (const dir of temporales) rmSync(dir, { recursive: true, force: true });
});

describe("R5 · los valores de producción están fijados", () => {
  // Son los tres valores del incidente, escritos aquí como literales a
  // propósito. Importarlos del módulo que valida no probaría nada: si alguien
  // cambia el módulo, el test le seguiría dando la razón.
  it("el módulo espera https · mipiacetpv.com · sin contenido mixto", () => {
    expect(ORIGEN_ESPERADO.androidScheme).toBe("https");
    expect(ORIGEN_ESPERADO.hostname).toBe("mipiacetpv.com");
    expect(ORIGEN_ESPERADO.allowMixedContent).toBe(false);
  });

  it("capacitor.config.ts declara exactamente esos valores", () => {
    const valores = leerConfigTs(CONFIG_TS);
    expect(
      comprobarOrigen(valores, "capacitor.config.ts"),
      "capacitor.config.ts no tiene el origen de producción: una APK con esto deja los terminales DESVINCULADOS (incidente del 2026-09-04)",
    ).toEqual([]);
  });

  it("capacitor.config.ts no deja server.url activo", () => {
    // El hot-reload de desarrollo apunta el WebView a otra máquina entera. En
    // el fichero hay una línea de ejemplo, pero COMENTADA.
    expect(leerConfigTs(CONFIG_TS).serverUrl).toBeUndefined();
  });

  it("el comentario del fichero no cuenta como configuración", () => {
    // `capacitor.config.ts` EXPLICA en prosa los valores malos del 04-09, y esa
    // explicación no puede hacer fallar a su propia guarda. Es la trampa obvia
    // de leer un .ts con grep, así que se prueba que no cae en ella.
    const crudo = readFileSync(CONFIG_TS, "utf8");
    expect(crudo).toContain("a5-lab.mipiacetpv.com"); // sigue explicado
    expect(leerConfigTs(CONFIG_TS).hostname).toBe("mipiacetpv.com"); // y no leído
  });
});

describe("R5 · la guarda aborta de verdad", () => {
  const BUENO = {
    androidScheme: "https",
    hostname: "mipiacetpv.com",
    allowMixedContent: "false",
  };

  it("acepta el origen bueno", () => {
    const { code } = correrGuarda("--ts", configConValores(BUENO));
    expect(code).toBe(0);
  });

  // Uno a uno: cualquiera de los tres, por su cuenta, tiene que tumbar el
  // build. El del 04-09 llevaba los tres, pero con `androidScheme` sobra.
  const SABOTAJES = [
    { que: "androidScheme http", cambio: { androidScheme: "http" }, espera: "androidScheme" },
    {
      que: "hostname de laboratorio",
      cambio: { hostname: "a5-lab.mipiacetpv.com" },
      espera: "hostname",
    },
    {
      que: "allowMixedContent true",
      cambio: { allowMixedContent: "true" },
      espera: "allowMixedContent",
    },
  ];

  for (const { que, cambio, espera } of SABOTAJES) {
    it(`aborta con ${que}`, () => {
      const ruta = configConValores({ ...BUENO, ...cambio });
      const { code, salida } = correrGuarda("--ts", ruta);
      expect(code, `la guarda dejó pasar ${que}`).toBe(1);
      expect(salida).toContain(espera);
      // El mensaje tiene que contar el incidente: quien se lo encuentre a las
      // 8 de la mañana necesita saber por qué no le dejan compilar.
      expect(salida).toContain("2026-09-04");
    });
  }

  it("NO se puede apagar con VITE_TPV_URL (el agujero de la guarda B2)", () => {
    const ruta = configConValores({ ...BUENO, hostname: "a5-lab.mipiacetpv.com" });
    const { code } = correrGuarda("--ts", ruta, {
      VITE_TPV_URL: "https://a5-lab.mipiacetpv.com",
    });
    expect(code, "una guarda con interruptor no es una guarda").toBe(1);
  });

  it("también valida el JSON que se empaqueta, no sólo la fuente", () => {
    // Es la puerta que importa: `cap sync` puede dejar un assets/ viejo con el
    // origen anterior aunque la fuente esté impecable.
    const dir = mkdtempSync(join(tmpdir(), "r5-json-"));
    temporales.push(dir);
    const ruta = join(dir, "capacitor.config.json");
    writeFileSync(
      ruta,
      JSON.stringify({ server: { androidScheme: "http", hostname: "mipiacetpv.com" } }),
    );
    expect(correrGuarda("--json", ruta).code).toBe(1);

    writeFileSync(
      ruta,
      JSON.stringify({ server: { androidScheme: "https", hostname: "mipiacetpv.com" } }),
    );
    expect(correrGuarda("--json", ruta).code).toBe(0);
  });

  it("un config ilegible NO se da por bueno", () => {
    const dir = mkdtempSync(join(tmpdir(), "r5-roto-"));
    temporales.push(dir);
    const ruta = join(dir, "capacitor.config.json");
    writeFileSync(ruta, "{ esto no es json");
    expect(correrGuarda("--json", ruta).code).toBe(1);
  });

  it("un androidScheme ausente en el JSON se lee como el default https", () => {
    // Capacitor omite la clave cuando vale el default. Ausente es válido;
    // presente con otro valor, no.
    const dir = mkdtempSync(join(tmpdir(), "r5-default-"));
    temporales.push(dir);
    const ruta = join(dir, "capacitor.config.json");
    writeFileSync(ruta, JSON.stringify({ server: { hostname: "mipiacetpv.com" } }));
    expect(leerConfigJson(ruta).androidScheme).toBe("https");
    expect(correrGuarda("--json", ruta).code).toBe(0);
  });
});

describe("R5 · los scripts de release llaman a la guarda", () => {
  // Red estructural. Sin ella, borrar una línea de bash desarma todo lo
  // anterior sin poner nada rojo: los tests de arriba seguirían verdes probando
  // una guarda que ya no llama nadie.
  for (const [nombre, ruta] of [
    ["build-release-apk.sh", APK_SH],
    ["build-release-aab.sh", AAB_SH],
  ] as const) {
    it(`${nombre} verifica el origen antes de compilar y sobre lo sincronizado`, () => {
      const sh = readFileSync(ruta, "utf8");
      const llamadas = sh.match(/verificar-origen\.mjs/g) ?? [];
      expect(
        llamadas.length,
        `${nombre} tiene que llamar a la guarda dos veces: la fuente (--ts) antes de compilar y el JSON sincronizado (--json) después del cap sync`,
      ).toBeGreaterThanOrEqual(2);
      expect(sh).toContain("--ts");
      expect(sh).toContain("--json");
    });
  }

  it("build-release-apk.sh ya no confía en VITE_TPV_URL para el origen", () => {
    // La guarda vieja derivaba de ahí el host esperado. Si vuelve a aparecer
    // como fuente del valor esperado, el interruptor está de vuelta.
    const sh = readFileSync(APK_SH, "utf8");
    const sinComentarios = sh.replace(/^\s*#.*$/gm, "");
    expect(sinComentarios).not.toContain("VITE_TPV_URL");
  });
});
