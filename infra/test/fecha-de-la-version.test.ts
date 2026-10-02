// declaracion-responsable · la fecha de la versión llega hasta la imagen.
//
// El apartado 1.l) de la declaración responsable del SIF pide la fecha en
// que el productor la suscribe, y eso es la fecha de LA VERSIÓN. En el
// código eso es `getAppVersionDate()`, que lee `APP_VERSION_DATE` — y esa
// env sólo existe si la cadena entera está enganchada:
//
//   ci.yml (git show -s --format=%cs)
//     → build-arg GIT_COMMIT_DATE
//       → Dockerfile ARG → ENV APP_VERSION_DATE
//         → getAppVersionDate()
//
// Si se rompe un eslabón no se cae nada: la declaración simplemente sale sin
// fecha, en silencio, y en producción. Es el fallo que un test de la API no
// puede ver porque para él la env es un `process.env`. Va en el proyecto
// `infra` por el mismo motivo que dockerfile-manifiestos.test.ts.
//
// Sabotajes que este fichero pone en rojo (tabla del done):
//   · quitar el ARG/ENV del Dockerfile
//   · quitar el build-arg del job publish de CI
//   · dejar de calcular commit_date en el step del sha
//   · poner un default de fecha en el ARG («hoy» horneado en la imagen)

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DOCKERFILE = readFileSync(join(ROOT, "infra/Dockerfile"), "utf8");
const CI = readFileSync(join(ROOT, ".github/workflows/ci.yml"), "utf8");

describe("infra/Dockerfile · la fecha de la versión", () => {
  it("declara el ARG y lo hornea como APP_VERSION_DATE", () => {
    expect(DOCKERFILE).toContain('ARG GIT_COMMIT_DATE=""');
    expect(DOCKERFILE).toContain("ENV APP_VERSION_DATE=${GIT_COMMIT_DATE}");
  });

  it("el ARG está vacío por defecto, sin una fecha horneada a mano", () => {
    // Un `ARG GIT_COMMIT_DATE="2026-09-27"` convertiría la declaración de
    // toda build local en una declaración fechada el día que alguien escribió
    // esa línea. Vacío → getAppVersionDate() devuelve null → el documento
    // dice que no hay fecha, que es la verdad.
    const args = [...DOCKERFILE.matchAll(/^ARG GIT_COMMIT_DATE=(.*)$/gm)].map(
      (m) => m[1].trim(),
    );
    expect(args).toEqual(['""']);
  });

  it("va junto a GIT_SHA: la misma versión y su misma fecha", () => {
    const sha = DOCKERFILE.indexOf("ENV APP_VERSION=${GIT_SHA}");
    const fecha = DOCKERFILE.indexOf("ENV APP_VERSION_DATE=${GIT_COMMIT_DATE}");
    expect(sha).toBeGreaterThan(-1);
    expect(fecha).toBeGreaterThan(sha);
  });
});

describe(".github/workflows/ci.yml · la fecha del commit", () => {
  it("calcula commit_date en el step del sha", () => {
    expect(CI).toContain("git show -s --format=%cs HEAD");
    expect(CI).toMatch(/commit_date=\$\(git show -s --format=%cs HEAD\)/);
  });

  it("se la pasa al build de la imagen de la api", () => {
    expect(CI).toContain(
      "GIT_COMMIT_DATE=${{ steps.meta.outputs.commit_date }}",
    );
  });

  it("el build-arg va en el mismo bloque que GIT_SHA", () => {
    // Si alguien lo mueve a otro `build-args:` (el de static, por ejemplo),
    // la imagen de la api se queda sin fecha y nadie se entera.
    const bloque = CI.split("GIT_SHA=${{ steps.meta.outputs.sha }}")[1] ?? "";
    const hasta = bloque.slice(0, bloque.indexOf("cache-from"));
    expect(hasta).toContain(
      "GIT_COMMIT_DATE=${{ steps.meta.outputs.commit_date }}",
    );
  });
});
