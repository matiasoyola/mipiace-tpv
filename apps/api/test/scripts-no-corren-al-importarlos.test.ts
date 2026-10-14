// EL GUARDIA DE LOS SCRIPTS QUE UN TEST IMPORTA.
//
// Lo que pasó, y costó verlo: `kds-alergenos-maestranza.test.ts` importa
// dos funciones de `src/scripts/importar-alergenos-maestranza.ts`, y ese
// fichero llamaba a `main()` en el cuerpo del módulo. Al importarlo,
// `main` corría sin argumentos, imprimía su «Uso: …» y hacía
// `process.exit(2)`.
//
// El rojo que eso daba es el peor de todos:
//
//     Test Files  341 passed (341)
//     Tests       4400 passed | 3 skipped
//     Errors      1 error
//     ⎯⎯ Unhandled Rejection ⎯⎯
//     Error: process.exit unexpectedly called with "2"
//
// **Todo pasa y la suite corta igual.** No nombra ningún test, así que en
// CI es un rojo sin fichero al que ir, y en local parece ruido.
//
// ── POR QUÉ ESTE TEST Y NO «ACORDARSE» ────────────────────────────────
//
// La regla no es «todos los scripts llevan guardia»: un script que nadie
// importa puede llamar a `main()` tranquilamente, y nueve de los once lo
// hacen. La regla es **un script que un test importa no puede ejecutarse
// al importarlo**, y eso depende de quién importa a quién.
//
// Así que el test lo AVERIGUA: lee los ficheros de `test/` y
// `test-e2e/`, saca de qué scripts importan, y exige la guardia sólo a
// ésos. El día que alguien escriba un test que importe otro script, la
// regla se le aplica sola — que es lo que no pasó esta vez.

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const API_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const SCRIPTS_DIR = path.join(API_ROOT, "src", "scripts");

/** Los ficheros de test de la API, con su contenido. */
function ficherosDeTest(): Array<{ fichero: string; fuente: string }> {
  const out: Array<{ fichero: string; fuente: string }> = [];
  for (const dir of ["test", "test-e2e"]) {
    const base = path.join(API_ROOT, dir);
    let entradas: string[];
    try {
      entradas = readdirSync(base);
    } catch {
      continue;
    }
    for (const nombre of entradas) {
      if (!/\.(test|e2e)\.tsx?$/.test(nombre)) continue;
      out.push({
        fichero: `${dir}/${nombre}`,
        fuente: readFileSync(path.join(base, nombre), "utf8"),
      });
    }
  }
  return out;
}

/**
 * Qué scripts IMPORTA cada test.
 *
 * Sólo los `import` de módulo: un `spawn` de `src/scripts/x.ts` —que es
 * como lo usan dos e2e— ejecuta el script en OTRO proceso, que es
 * precisamente lo que se quiere, y no tiene este problema.
 */
function scriptsImportados(): Map<string, string[]> {
  const porScript = new Map<string, string[]>();
  for (const { fichero, fuente } of ficherosDeTest()) {
    for (const m of fuente.matchAll(
      /["'`][^"'`]*src\/scripts\/([a-z0-9-]+)\.js["'`]/g,
    )) {
      const script = `${m[1]}.ts`;
      porScript.set(script, [...(porScript.get(script) ?? []), fichero]);
    }
  }
  return porScript;
}

/** Un `main()` suelto en el cuerpo del módulo, sin nada que lo envuelva. */
function llamaAMainAlImportarse(fuente: string): boolean {
  // Sin sangrar = cuerpo del módulo. Dentro de un `if (isDirectRun) {`
  // va sangrado, así que esto distingue los dos casos sin parsear.
  return /^(await\s+|void\s+)?main\s*\(/m.test(fuente);
}

const IMPORTADOS = scriptsImportados();

describe("los scripts que un test IMPORTA no se ejecutan al importarlos", () => {
  it("hay al menos uno, o este guardia no está guardando nada", () => {
    // Si alguien borra los tests que importan scripts, este fichero se
    // quedaría verde sin comprobar nada. Mejor que se ponga rojo y se
    // borre a mano.
    expect([...IMPORTADOS.keys()].length).toBeGreaterThan(0);
  });

  for (const [script, tests] of IMPORTADOS) {
    it(`${script} no llama a main() al importarse (lo importa ${tests.join(", ")})`, () => {
      const fuente = readFileSync(path.join(SCRIPTS_DIR, script), "utf8");
      expect(llamaAMainAlImportarse(fuente)).toBe(false);
    });

    it(`${script} sigue arrancando cuando se EJECUTA`, () => {
      // La otra mitad: una guardia que nunca deja pasar convertiría el
      // script en un fichero que no hace nada, y eso no se vería hasta
      // que un implantador lo corriera en una implantación.
      const fuente = readFileSync(path.join(SCRIPTS_DIR, script), "utf8");
      expect(fuente).toMatch(/import\.meta\.url === `file:\/\/\$\{process\.argv\[1\]\}`/);
      expect(fuente).toMatch(
        new RegExp(`process\\.argv\\[1\\]\\?\\.endsWith\\("${script}"\\)`),
      );
      expect(fuente).toMatch(/if \(isDirectRun\) \{\s*\n\s*main\(\)/);
    });
  }
});
