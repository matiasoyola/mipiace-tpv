// verifactu-1 · el Dockerfile copia el manifest de CADA paquete del workspace.
//
// La imagen instala dependencias con solo los package.json (para cachear la
// capa del install) y copia el resto después. Un paquete nuevo cuyo manifest
// no está en esa lista no entra en el install: pnpm no crea su enlace y el
// build de la imagen se cae en el tsc del api. Ha pasado DOS veces
// (escpos-builder en v1.9.4, verifactu en verifactu-1) y las dos se vieron
// solo en el smoke del CI, después del merge.
//
// Este test lo adelanta a la suite: cada apps/* y packages/* con package.json
// que no sea tpv-android (no entra en la imagen) tiene que tener su COPY.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DOCKERFILE = readFileSync(join(ROOT, "infra/Dockerfile"), "utf8");

// Fuera de la imagen a propósito: la APK se construye en el Mac, no en el VPS.
const FUERA_DE_LA_IMAGEN = new Set(["apps/tpv-android"]);

function workspaces(): string[] {
  const out: string[] = [];
  for (const raiz of ["apps", "packages"]) {
    for (const nombre of readdirSync(join(ROOT, raiz))) {
      const rel = `${raiz}/${nombre}`;
      if (FUERA_DE_LA_IMAGEN.has(rel)) continue;
      if (existsSync(join(ROOT, rel, "package.json"))) out.push(rel);
    }
  }
  return out.sort();
}

describe("infra/Dockerfile · manifests del install", () => {
  it("encuentra paquetes que comprobar", () => {
    expect(workspaces().length).toBeGreaterThan(5);
  });

  it.each(workspaces())("copia %s/package.json antes del install", (rel) => {
    const linea = `COPY ${rel}/package.json ${rel}/`;
    const install = DOCKERFILE.indexOf("RUN pnpm install --frozen-lockfile");
    const copy = DOCKERFILE.indexOf(linea);
    expect(copy, `falta «${linea}» en infra/Dockerfile`).toBeGreaterThan(-1);
    expect(copy, `«${linea}» va DESPUÉS del install`).toBeLessThan(install);
  });
});
