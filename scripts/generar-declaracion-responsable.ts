// declaracion-responsable · genera docs/legal/declaracion-responsable.md.
//
// El documento en Markdown NO se escribe a mano: se genera desde el mismo
// `buildDeclaracionResponsable` que alimenta el JSON, el PDF y la pantalla.
// Si se escribiera a mano sería la cuarta copia del mismo texto y la primera
// en desincronizarse — y un fichero en docs/legal que no coincide con lo que
// el sistema enseña es peor que no tenerlo.
//
// `packages/verifactu/test/declaracion-doc.test.ts` vuelve a generarlo y lo
// compara con el fichero en disco: si alguien edita el .md a mano, o cambia
// una constante del productor sin regenerar, la suite se pone roja.
//
//   pnpm docs:declaracion            → reescribe el fichero
//
// La versión y la fecha NO van en el .md: son las del despliegue que está
// corriendo, y este fichero es del repo. El documento con versión y fecha es
// el que sirve la API. El .md es el texto, que es lo que hay que revisar en
// un diff.

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildDeclaracionResponsable,
  type ApartadoDeclaracion,
} from "@mipiacetpv/verifactu";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const RUTA_DOC = join(ROOT, "docs/legal/declaracion-responsable.md");

/** Marcador de los datos que dependen del despliegue, no del repo. */
const VERSION_MARCADOR = "«la versión en ejecución»";
const FECHA_MARCADOR = "«la fecha de la versión en ejecución»";

function apartadoAMarkdown(a: ApartadoDeclaracion): string {
  const cuerpo = a.valor.map((v) => v).join("\n\n");
  return `### ${a.clave} ${a.rotulo}\n\n${cuerpo}\n`;
}

export function generarMarkdown(): string {
  const d = buildDeclaracionResponsable({
    versionServidor: VERSION_MARCADOR,
    // Sin versión de APK: la que exista es la del VPS, no la del repo.
    versionApk: null,
    // `null` → el apartado 1.l) dice «no disponible en esta build», que en un
    // fichero del repo sería confuso. Se sustituye por el marcador después.
    fechaSuscripcion: null,
    emailSoporte: "soporte@mipiacetpv.com",
  });

  const cabecera = [
    "---",
    "title: Declaración responsable del sistema informático de facturación",
    "estado: GENERADO. No editar a mano.",
    "generado_por: scripts/generar-declaracion-responsable.ts (pnpm docs:declaracion)",
    "---",
    "",
    "> **ESTE FICHERO SE GENERA.** El texto sale de",
    "> `packages/verifactu/src/declaracion.ts` y de las constantes del productor",
    "> de `packages/verifactu/src/productor.ts` — las mismas que firman cada",
    "> registro de facturación. Para cambiarlo, cambia el código y ejecuta",
    "> `pnpm docs:declaracion`. Editarlo a mano pone roja la suite",
    "> (`packages/verifactu/test/declaracion-doc.test.ts`).",
    "",
    "> **LA COPIA QUE VALE es la que sirve el sistema**, con la versión y la",
    "> fecha de lo que está desplegado:",
    "> `GET /legal/declaracion-responsable` y",
    "> `GET /legal/declaracion-responsable.pdf`, o la pantalla",
    "> «Declaración responsable» del panel. Este fichero lleva marcadores en su",
    "> lugar porque es del repo y no de un despliegue.",
    "",
  ].join("\n");

  const apartados = d.apartados
    .map(apartadoAMarkdown)
    .join("\n")
    .replace(
      "Fecha: no disponible en esta build",
      `Fecha: ${FECHA_MARCADOR}`,
    );

  const anexo = d.anexo.map(apartadoAMarkdown).join("\n");

  return [
    cabecera,
    `# ${d.titulo}`,
    "",
    apartados,
    "## Anexo",
    "",
    anexo,
    "---",
    "",
    "Referencias: art. 15 de la Orden HAC/1177/2024; RD 1007/2023;",
    "`docs/legal/posicion-verifactu.md` §4 (quién identifica al SIF) y",
    "`docs/design/adr-019-cada-caja-es-un-sif.md` (cada caja, una instalación).",
    "",
  ].join("\n");
}

// Sólo escribe cuando se ejecuta como script; el test importa `generarMarkdown`.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  writeFileSync(RUTA_DOC, generarMarkdown(), "utf8");
  // eslint-disable-next-line no-console
  console.log(`escrito ${RUTA_DOC}`);
}
