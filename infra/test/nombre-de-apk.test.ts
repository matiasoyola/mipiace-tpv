// A3-distribucion · el mismo charset de nombre de fichero en los DOS scripts
// que publican.
//
// apps/api/src/releases/store.ts solo admite `[A-Za-z0-9._-]` en el `fileName`
// de releases.json (FILE_NAME_RE) y descarta la entrada EN SILENCIO si no
// cuadra: no hay error, no hay log, no hay 500. Ese filtro estaba solo en el
// lado que LEE.
//
// Sin un filtro gemelo en el lado que ESCRIBE, un VERSION_NAME con un `+` o un
// espacio compila, firma, sube por scp, escribe el indice y el script imprime
// "Publicado" — y /apk/latest.json sigue anunciando la version ANTERIOR porque
// la nueva no pasa el validador. Los codigos emitidos para ella dan 404. Nadie
// sabe por que.
//
// Los dos scripts viven en sitios distintos (apps/tpv-android/scripts e infra)
// pero guardan el mismo invariante en dos puntos de la misma cadena, asi que
// se prueban juntos aqui.

import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const BUILD_SH = join(ROOT, "apps/tpv-android/scripts/build-release-apk.sh");
const PUBLICAR_SH = join(ROOT, "infra/publicar-apk.sh");

/** Fragmento estable del mensaje: el charset que la API admite. */
const CHARSET = "[A-Za-z0-9._-]";

let TMP: string;
let STUB_PATH: string;

beforeAll(() => {
  TMP = mkdtempSync(join(tmpdir(), "mipiacetpv-nombres-"));

  // Stub de `git` que SIEMPRE dice que el arbol esta sucio.
  //
  // build-release-apk.sh comprueba el arbol justo despues del nombre. Con este
  // stub, un nombre valido muere ahi de forma determinista en vez de depender
  // del estado real del repo (y, sobre todo, en vez de arrancar dos minutos de
  // Vite + gradle en el Mac de quien corra los tests).
  const stubDir = join(TMP, "bin");
  mkdirSync(stubDir);
  const stub = join(stubDir, "git");
  writeFileSync(
    stub,
    [
      "#!/bin/sh",
      'case "$*" in',
      "  *rev-parse*--git-dir*) echo .git ;;",
      "  *rev-parse*--short*) echo deadbee ;;",
      '  *status*--porcelain*) echo " M algo-sin-commitear.txt" ;;',
      "esac",
      "exit 0",
      "",
    ].join("\n"),
  );
  chmodSync(stub, 0o755);
  STUB_PATH = `${stubDir}:${process.env.PATH ?? ""}`;
});

afterAll(() => rmSync(TMP, { recursive: true, force: true }));

function correr(
  script: string,
  args: string[],
  env: Record<string, string>,
): { code: number | null; stdout: string; stderr: string } {
  const r = spawnSync("bash", [script, ...args], {
    encoding: "utf8",
    timeout: 30_000,
    env: { ...process.env, PATH: STUB_PATH, ...env },
  });
  return { code: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

describe("build-release-apk.sh valida el nombre ANTES de compilar", () => {
  // La ruta del argumento ya obligaba a MAJOR.MINOR.PATCH. El agujero eran las
  // env vars, que no validaban nada y son justo la via del build a medida.
  it("un VERSION_NAME con '+' no llega ni al build de tpv-web", () => {
    const r = correr(BUILD_SH, [], {
      VERSION_NAME: "1.10.2+beta",
      VERSION_CODE: "11002",
    });
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain(CHARSET);
    expect(r.stderr).toContain("mipiacetpv-1.10.2+beta-11002.apk");
    expect(r.stderr).toContain("SILENCIO");
    // Lo caro no ha empezado: ni Vite, ni cap sync, ni gradle.
    expect(r.stdout).not.toContain("1/6");
  });

  it("un VERSION_NAME con espacio tampoco", () => {
    const r = correr(BUILD_SH, [], {
      VERSION_NAME: "1.10 2",
      VERSION_CODE: "11002",
    });
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain(CHARSET);
    expect(r.stdout).not.toContain("1/6");
  });

  it("un nombre limpio pasa la puerta y el script sigue su camino", () => {
    // Sin esto, un regex que rechazara todo tambien pondria en verde los dos
    // tests de arriba. El stub de git deja el arbol sucio a proposito: el
    // script muere en la comprobacion SIGUIENTE, que es la prueba de que la
    // del nombre la paso.
    const r = correr(BUILD_SH, [], {
      VERSION_NAME: "1.10.2",
      VERSION_CODE: "11002",
    });
    expect(r.stderr).not.toContain(CHARSET);
    expect(r.stderr).toContain("cambios sin commitear");
    expect(r.stdout).not.toContain("1/6");
  });
});

describe("publicar-apk.sh valida el nombre ANTES del scp", () => {
  /** Deja un APK de mentira con su sidecar y devuelve la ruta del APK. */
  function sembrarApk(nombre: string, sidecar = ""): string {
    const dir = mkdtempSync(join(TMP, "apk-"));
    const apk = join(dir, nombre);
    writeFileSync(apk, "PK no soy un apk");
    writeFileSync(`${apk}.sha256`, sidecar);
    return apk;
  }

  it("un nombre con '+' muere antes de tocar la red", () => {
    const apk = sembrarApk("mipiacetpv-1.10.2+beta-11002.apk");
    const r = correr(PUBLICAR_SH, [apk], {});
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain(CHARSET);
    expect(r.stderr).toContain("SILENCIO");
    // Ni ssh ni scp: el script no ha llegado a anunciar la publicacion.
    expect(r.stdout).not.toContain("Publicando");
    expect(r.stdout).not.toContain("1/4");
  });

  it("un nombre con espacio tampoco se sube", () => {
    const apk = sembrarApk("mipiacetpv-1.10 2-11002.apk");
    const r = correr(PUBLICAR_SH, [apk], {});
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain(CHARSET);
    expect(r.stdout).not.toContain("1/4");
  });

  it("un nombre de mas de 120 caracteres tampoco", () => {
    const apk = sembrarApk(`mipiacetpv-${"1".repeat(130)}.apk`);
    const r = correr(PUBLICAR_SH, [apk], {});
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain("120");
    expect(r.stdout).not.toContain("1/4");
  });

  it("un nombre limpio pasa la puerta y el script sigue su camino", () => {
    // El sidecar va vacio a proposito: el script muere en la comprobacion
    // SIGUIENTE (la linea de hash), que es la prueba de que la del nombre la
    // paso — y muere ahi, antes de cualquier ssh.
    const apk = sembrarApk("mipiacetpv-1.10.2-11002.apk");
    const r = correr(PUBLICAR_SH, [apk], {});
    expect(r.code).not.toBe(0);
    expect(r.stderr).not.toContain(CHARSET);
    expect(r.stderr).toContain("el sidecar no tiene línea de hash");
    expect(r.stdout).not.toContain("1/4");
  });
});
