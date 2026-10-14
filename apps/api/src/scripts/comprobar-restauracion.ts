// clinica-7 · EL PASO 4 DEL SIMULACRO: ¿de esta copia sale una historia?
//
// Lo lanza `infra/simulacro-de-restauracion.sh` contra la base de prueba ya
// restaurada y el volumen clínico ya desempaquetado.
//
// Comprueba dos cosas, y las dos con **el mismo código que la API**:
//
//   1. **El canario de cada clínica.** La DEK de cada tenant se desenvuelve
//      con la `CLINICAL_KEK` del entorno y descifra su canario. Es la misma
//      comprobación que el arranque hace, sobre la copia en vez de sobre
//      producción.
//   2. **Un fichero clínico de verdad.** Se coge una foto (o un
//      consentimiento) de cada clínica, se descifra con su DEK y se
//      comprueba que su huella cuadra con la que dice la fila.
//
// ── Por qué «con el mismo código» importa ───────────────────────────
//
// Porque un simulacro que reimplementara el descifrado podría pasar con un
// formato que la API no sabe leer. Importando `claves.ts` y `cripto.ts`, el
// día que alguien cambie el formato sin migrar, **el simulacro se pone
// rojo** — y eso es exactamente lo que tiene que pasar.

import { getPrisma, shutdown } from "../context.js";
import { loadEnv } from "../env.js";
import { dekDe, revisarCanarios } from "../clinica/claves.js";
import { leerFichero } from "../clinica/ficheros.js";

const verde = (s: string) => `[32m${s}[0m`;
const rojo = (s: string) => `[31m${s}[0m`;

async function main(): Promise<void> {
  const env = loadEnv();
  if (env.CLINICAL_KEK == null) {
    throw new Error(
      "Falta CLINICAL_KEK. Sin ella no se puede comprobar que la copia sirve.",
    );
  }
  const prisma = getPrisma();

  // ── 1 · los canarios ──────────────────────────────────────────────
  const revisados = await revisarCanarios(prisma);
  if (revisados.length === 0) {
    console.log(
      "   · no hay ninguna clínica con clave en esta copia: nada que descifrar.",
    );
  }
  const noCuadran = revisados.filter((r) => !r.cuadra);
  for (const r of revisados) {
    if (r.destruida) {
      console.log(
        `   · ${r.tenantId}: clave DESTRUIDA (crypto-shredding). Su historia es ilegible a propósito.`,
      );
    } else if (r.cuadra) {
      console.log(verde(`   ✔ ${r.tenantId}: el canario descifra`));
    } else {
      console.log(rojo(`   ✖ ${r.tenantId}: el canario NO descifra`));
    }
  }
  if (noCuadran.length > 0) {
    throw new Error(
      `${noCuadran.length} clínica(s) con el canario ilegible. Esta copia NO sirve: o la KEK no es la que envolvió estas claves, o la copia está de una rotación a medias.`,
    );
  }

  // ── 2 · un fichero de cada clínica ────────────────────────────────
  let comprobados = 0;
  for (const r of revisados) {
    if (r.destruida) continue;
    const dek = await dekDe(r.tenantId, prisma);

    const foto = await prisma.clinicalPhoto.findFirst({
      where: { tenantId: r.tenantId },
      select: { fileName: true, sha256: true },
    });
    if (foto) {
      const leido = await leerFichero("FOTO", foto.fileName, foto.sha256, {
        tenantId: r.tenantId,
        dek,
      });
      if (leido == null) {
        throw new Error(
          `${r.tenantId}: la foto ${foto.fileName} no está en el paquete o NO SE DESCIFRA. La copia no sirve.`,
        );
      }
      if (!leido.huellaCuadra) {
        throw new Error(
          `${r.tenantId}: la foto ${foto.fileName} se descifra y su huella NO CUADRA con la de la fila. La copia no sirve.`,
        );
      }
      console.log(
        verde(
          `   ✔ ${r.tenantId}: una foto se descifra y su huella cuadra (${leido.bytes} bytes${leido.cifrado ? ", estaba cifrada" : ", estaba en claro"})`,
        ),
      );
      comprobados += 1;
      continue;
    }

    const consentimiento = await prisma.clientConsent.findFirst({
      where: { tenantId: r.tenantId, pdfFileName: { not: null } },
      select: { pdfFileName: true, pdfSha256: true },
    });
    if (consentimiento?.pdfFileName) {
      const leido = await leerFichero(
        "CONSENTIMIENTO",
        consentimiento.pdfFileName,
        consentimiento.pdfSha256,
        { tenantId: r.tenantId, dek },
      );
      if (leido == null || !leido.huellaCuadra) {
        throw new Error(
          `${r.tenantId}: el consentimiento ${consentimiento.pdfFileName} no se descifra o su huella no cuadra. La copia no sirve.`,
        );
      }
      console.log(
        verde(`   ✔ ${r.tenantId}: un consentimiento se descifra y cuadra`),
      );
      comprobados += 1;
      continue;
    }

    console.log(
      `   · ${r.tenantId}: sin fotos ni consentimientos que comprobar (clínica recién encendida).`,
    );
  }

  // ── 3 · y una fila de historia, descifrada de verdad ──────────────
  //
  // El canario demuestra que la CLAVE sirve; esto demuestra que **la
  // historia** sirve, que es la pregunta de verdad. Se coge una entrada
  // cifrada de cada clínica y se descifra con la misma función que usa la
  // pantalla.
  const { cuerpoDeEntrada, esIlegible } = await import(
    "../clinica/cripto-campos.js"
  );
  for (const r of revisados) {
    if (r.destruida) continue;
    const entrada = await prisma.clinicalEntry.findFirst({
      where: { tenantId: r.tenantId, bodyCifrado: { not: null } },
      select: { id: true, tenantId: true, body: true, bodyCifrado: true },
    });
    if (entrada == null) continue;
    const cuerpo = cuerpoDeEntrada(
      { ...entrada, body: entrada.body as unknown },
      await dekDe(r.tenantId, prisma),
    );
    if (cuerpo == null || esIlegible(cuerpo)) {
      throw new Error(
        `${r.tenantId}: una entrada de historia NO SE DESCIFRA (${entrada.id}). La copia no sirve.`,
      );
    }
    console.log(
      verde(
        `   ✔ ${r.tenantId}: una entrada de historia se descifra y tiene ${Object.keys(cuerpo as object).length} campos`,
      ),
    );
    comprobados += 1;
  }

  console.log(
    `   ${comprobados} comprobación(es) de contenido, todas verdes.`,
  );
}

main()
  .then(() => shutdown())
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error(rojo(`   ✖ ${err instanceof Error ? err.message : String(err)}`));
    await shutdown();
    process.exit(1);
  });
