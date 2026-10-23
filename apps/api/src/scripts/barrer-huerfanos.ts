// residencia-6 (punto 5) · **EL BARRIDO DE FICHEROS HUÉRFANOS.**
//
//     pnpm --filter api barrer-huerfanos            # sólo lista
//     pnpm --filter api barrer-huerfanos --borrar   # y borra
//     pnpm --filter api barrer-huerfanos --margen=120
//
// Un fichero huérfano es un binario del volumen clínico que **ya no
// referencia ninguna fila**. Se acumulan por dos caminos que residencia-3
// §15.5 y residencia-5 §16.5 dejaron anotados, y los dos son
// deliberados:
//
//   · **cambiar la foto de un residente** deja la anterior en el volumen.
//     Borrar binarios dentro de la transacción que escribe la fila es la
//     forma de quedarse sin la foto si algo falla después (clinica-4);
//   · **deshacer una ocurrencia hecha** suelta las cuatro columnas de la
//     evidencia porque lo exige el CHECK, y el PDF se queda: que alguien
//     subió ese documento es un hecho.
//
// Ninguno de los dos se arregla «borrando al vuelo». Se arreglan con esto.
//
// ── POR DEFECTO SÓLO LISTA ──────────────────────────────────────────
//
// Es un script que borra binarios de una historia clínica. La forma de la
// casa para eso es la de `clinica:cifrar --vaciar`: la pasada normal
// enseña lo que haría, y el borrado es una bandera que alguien teclea
// después de haberlo mirado.
//
// ── Y NUNCA TOCA DOS COSAS ──────────────────────────────────────────
//
//   1. **Un fichero referenciado.** Obvio, y es lo que el test sabotea.
//   2. **Un fichero más reciente que el margen** (60 minutos por
//      defecto). Y esto no es prudencia de más: entre que
//      `guardarFichero` escribe el binario y que la transacción escribe
//      la fila hay un hueco de milisegundos —el orden es ése a propósito,
//      «primero el fichero, después la fila», para que no quede una fila
//      apuntando a una foto que no existe— y una subida de 4 MB con una
//      wifi mala lo alarga. Un barrido corriendo en ese hueco vería un
//      fichero sin fila y lo borraría: la foto desaparecería y la ficha
//      quedaría apuntando a la nada.
//
//      El margen se mide por `mtime` del fichero.
//
// ── EL LOG NO LLEVA RUTAS ───────────────────────────────────────────
//
// La línea de resumen son **recuentos por clase y bytes**. Los nombres
// (uuid + doce hex de la huella) no dicen nada de nadie por diseño
// (clinica-4), pero una ruta en un log acaba en un volcado, en una
// captura y en el canal de soporte, y lo que una lista de nombres de la
// carpeta `residentes/` sí dice es **cuántas fotos de residentes hay en
// este centro**. En el listado de la pantalla sí salen, porque quien lo
// ejecuta es quien va a decidir.

import { readdir, stat, unlink } from "node:fs/promises";
import { join } from "node:path";

import { getPrisma, shutdown } from "../context.js";
import { loadEnv } from "../env.js";
import {
  CARPETA_DE_LA_CLASE,
  type ClaseDeFichero,
} from "../clinica/ficheros.js";

/** Cuánto tiene que haber reposado un fichero para considerarlo
 *  huérfano. Ver la cabecera: el hueco entre escribir el binario y
 *  escribir la fila es real. */
export const MARGEN_POR_DEFECTO_MIN = 60;

export interface Huerfano {
  clase: ClaseDeFichero;
  fileName: string;
  bytes: number;
  /** Cuántos minutos lleva en el disco sin que nadie lo referencie. */
  minutos: number;
}

export interface Barrido {
  /** Cuántos ficheros hay en el volumen, por clase. */
  enDisco: Record<string, number>;
  /** Cuántos los referencia una fila. */
  referenciados: Record<string, number>;
  /** Los que no, y han reposado más que el margen. */
  huerfanos: Huerfano[];
  /** Los que no los referencia nadie pero son MÁS RECIENTES que el
   *  margen: pueden ser una subida en curso, así que no se tocan. Se
   *  cuentan porque un número alto aquí dice que el margen está mal
   *  puesto o que algo está escribiendo y no cerrando filas. */
  demasiadoNuevos: number;
  /** Puesto a `true` por `--borrar`, y sólo entonces se borró. */
  borrados: number;
  bytesLiberados: number;
}

/**
 * Los nombres de fichero que **sí** referencia una fila, por clase.
 *
 * Una consulta por columna, sobre **todos los tenants**: los ficheros de
 * todos los centros viven en la misma carpeta (el nombre es un uuid, no
 * lleva el tenant dentro), así que un barrido por tenant borraría los del
 * de al lado.
 *
 * Y se leen las columnas **sin filtrar por nada más**: una fila retirada,
 * anulada o de un residente dado de alta sigue referenciando su fichero.
 * Lo clínico no se borra (D-45), así que «hay fila» es la única pregunta.
 */
export async function referenciados(): Promise<Map<ClaseDeFichero, Set<string>>> {
  const prisma = getPrisma();
  const [
    fotos,
    consentimientos,
    informes,
    residentes,
    voces,
    evidencias,
    contratos,
  ] = await Promise.all([
      prisma.clinicalPhoto.findMany({ select: { fileName: true } }),
      prisma.clientConsent.findMany({
        where: { pdfFileName: { not: null } },
        select: { pdfFileName: true },
      }),
      prisma.clinicalReportDelivery.findMany({
        where: { pdfFileName: { not: null } },
        select: { pdfFileName: true },
      }),
      prisma.residentProfile.findMany({
        where: { photoFileName: { not: null } },
        select: { photoFileName: true },
      }),
      prisma.careRecord.findMany({
        where: { voiceFileName: { not: null } },
        select: { voiceFileName: true },
      }),
      prisma.dutyOccurrence.findMany({
        where: { evidenceFileName: { not: null } },
        select: { evidenceFileName: true },
      }),
      // historia-1 (D-94) · el contrato de estancia adjunto al elemento
      // del ingreso. **La clase nueva entra en el barrido el mismo día
      // que nace**: un barrido que no conoce una clase deja sus ficheros
      // acumulándose para siempre, que es justo la deuda que residencia-6
      // vino a cerrar.
      prisma.admissionChecklistItem.findMany({
        where: { fileName: { not: null } },
        select: { fileName: true },
      }),
    ]);

  const de = (xs: Array<Record<string, string | null>>, campo: string): Set<string> =>
    new Set(
      xs.map((x) => x[campo]).filter((v): v is string => typeof v === "string"),
    );

  return new Map<ClaseDeFichero, Set<string>>([
    ["FOTO", de(fotos, "fileName")],
    ["CONSENTIMIENTO", de(consentimientos, "pdfFileName")],
    ["INFORME", de(informes, "pdfFileName")],
    ["RESIDENTE", de(residentes, "photoFileName")],
    ["VOZ", de(voces, "voiceFileName")],
    ["EVIDENCIA", de(evidencias, "evidenceFileName")],
    ["CONTRATO", de(contratos, "fileName")],
  ]);
}

/**
 * **Recorre el volumen y cruza con la base.** No borra nada: eso lo hace
 * `barrer`.
 *
 * `ahora` entra por parámetro para que el test pueda poner un fichero
 * «de hace dos horas» sin tocar el reloj del sistema, igual que el corte
 * del parte de relevo (residencia-5 §2).
 */
export async function buscarHuerfanos(input: {
  margenMinutos: number;
  ahora: Date;
  /** De dónde salen los nombres referenciados. Por defecto, la base.
   *
   *  Entra por parámetro —y no se llama a `referenciados()` aquí dentro—
   *  por la misma razón por la que `--vaciar` entra por parámetro en
   *  `residencia-cifrar.ts`: lo que hay que poder probar es **el
   *  recorrido del disco y la decisión de borrar**, que es donde está el
   *  riesgo, y eso se prueba con ficheros de verdad y sin Postgres. */
  referencias?: () => Promise<Map<ClaseDeFichero, Set<string>>>;
}): Promise<Omit<Barrido, "borrados" | "bytesLiberados">> {
  const raiz = loadEnv().CLINICAL_FILES_DIR;
  const vivos = await (input.referencias ?? referenciados)();

  const enDisco: Record<string, number> = {};
  const refs: Record<string, number> = {};
  const huerfanos: Huerfano[] = [];
  let demasiadoNuevos = 0;

  for (const [clase, carpeta] of Object.entries(CARPETA_DE_LA_CLASE) as Array<
    [ClaseDeFichero, string]
  >) {
    const dir = join(raiz, carpeta);
    let nombres: string[];
    try {
      nombres = await readdir(dir);
    } catch {
      // La carpeta no existe: ese tipo de fichero no se ha subido nunca.
      // No es un error — un centro sin obligaciones con evidencia no
      // tiene carpeta `evidencias`.
      enDisco[clase] = 0;
      refs[clase] = 0;
      continue;
    }
    const referenciadosAqui = vivos.get(clase) ?? new Set<string>();
    enDisco[clase] = nombres.length;
    refs[clase] = 0;
    for (const fileName of nombres) {
      if (referenciadosAqui.has(fileName)) {
        refs[clase] = (refs[clase] ?? 0) + 1;
        continue;
      }
      let info;
      try {
        info = await stat(join(dir, fileName));
      } catch {
        // Se lo llevó otro entre el `readdir` y el `stat`. No es nada.
        continue;
      }
      if (!info.isFile()) continue;
      const minutos = (input.ahora.getTime() - info.mtimeMs) / 60_000;
      if (minutos < input.margenMinutos) {
        demasiadoNuevos++;
        continue;
      }
      huerfanos.push({
        clase,
        fileName,
        bytes: info.size,
        minutos: Math.floor(minutos),
      });
    }
  }

  return { enDisco, referenciados: refs, huerfanos, demasiadoNuevos };
}

/**
 * El barrido entero. Con `borrar: false` —el defecto— **no toca el
 * disco**.
 *
 * Borra uno a uno y no en lote: si uno falla (permisos, se lo llevó
 * otro), los demás se van igual y el que falló se vuelve a ver en la
 * pasada siguiente.
 */
export async function barrer(input: {
  borrar: boolean;
  margenMinutos: number;
  ahora: Date;
  referencias?: () => Promise<Map<ClaseDeFichero, Set<string>>>;
}): Promise<Barrido> {
  const encontrado = await buscarHuerfanos(input);
  if (!input.borrar) {
    return { ...encontrado, borrados: 0, bytesLiberados: 0 };
  }
  const raiz = loadEnv().CLINICAL_FILES_DIR;
  let borrados = 0;
  let bytesLiberados = 0;
  for (const h of encontrado.huerfanos) {
    try {
      await unlink(join(raiz, CARPETA_DE_LA_CLASE[h.clase], h.fileName));
      borrados++;
      bytesLiberados += h.bytes;
    } catch {
      /* se vuelve a ver en la pasada siguiente */
    }
  }
  return { ...encontrado, borrados, bytesLiberados };
}

/** La línea de resumen. **Recuentos, nunca rutas** (ver la cabecera). */
export function resumen(b: Barrido, borrar: boolean): string {
  const enDisco = Object.values(b.enDisco).reduce((a, n) => a + n, 0);
  const referenciados = Object.values(b.referenciados).reduce((a, n) => a + n, 0);
  const porClase = b.huerfanos.reduce<Record<string, number>>((acc, h) => {
    acc[h.clase] = (acc[h.clase] ?? 0) + 1;
    return acc;
  }, {});
  const detalle = Object.entries(porClase)
    .map(([c, n]) => `${c}=${n}`)
    .join(" ");
  return (
    `barrido de huérfanos · en disco ${enDisco} · referenciados ${referenciados}` +
    ` · huérfanos ${b.huerfanos.length}${detalle ? ` (${detalle})` : ""}` +
    ` · demasiado nuevos ${b.demasiadoNuevos}` +
    (borrar
      ? ` · BORRADOS ${b.borrados} (${Math.round(b.bytesLiberados / 1024)} KB)`
      : " · no se ha borrado nada")
  );
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  const borrar = argv.includes("--borrar");
  const margen = argv.find((a) => a.startsWith("--margen="));
  const margenMinutos = margen
    ? Number(margen.slice("--margen=".length))
    : MARGEN_POR_DEFECTO_MIN;
  if (!Number.isFinite(margenMinutos) || margenMinutos < 0) {
    throw new Error("--margen= tiene que ser un número de minutos ≥ 0");
  }

  const b = await barrer({ borrar, margenMinutos, ahora: new Date() });

  console.log(`\nVolumen: ${loadEnv().CLINICAL_FILES_DIR}`);
  console.log(`Margen: ${margenMinutos} min\n`);
  if (b.huerfanos.length === 0) {
    console.log("No hay ningún fichero huérfano.");
  } else {
    // Aquí SÍ salen los nombres: quien ejecuta el script es quien va a
    // decidir si borra. Lo que no llevan nombres es la línea de resumen,
    // que es la que acaba en el log.
    for (const h of b.huerfanos) {
      console.log(
        `  ${h.clase.padEnd(15)} ${h.fileName}  ${Math.round(
          h.bytes / 1024,
        )} KB  ${h.minutos} min`,
      );
    }
  }
  console.log(`\n${resumen(b, borrar)}`);
  if (!borrar && b.huerfanos.length > 0) {
    console.log(
      "\nNo se ha borrado nada. Míralo y, cuando estés seguro, vuelve a\n" +
        "lanzarlo con --borrar.",
    );
  }
}

// El guardia de siempre: este fichero lo importa su test, así que `main()`
// **no puede correr al importarlo** (ver
// `scripts-no-corren-al-importarlos.test.ts`).
const isDirectRun =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("barrer-huerfanos.ts");

if (isDirectRun) {
  main()
    .then(() => shutdown())
    .then(() => process.exit(0))
    .catch(async (err) => {
      console.error(`\n✖ ${err instanceof Error ? err.message : String(err)}`);
      await shutdown();
      process.exit(1);
    });
}
