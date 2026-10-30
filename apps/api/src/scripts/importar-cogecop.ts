// cogecop-1 · LA HISTORIA DE UNA CLÍNICA QUE VIENE DE COGECOP.
//
//   pnpm --filter @mipiacetpv/api exec tsx src/scripts/importar-cogecop.ts \
//     --tenant=<uuid> --dir=/ruta/al/export \
//     --autora-1=<userId> --autora-2=<userId> \
//     --lateralidad=izquierdo-a-la-izquierda
//
// y, cuando los números del seco cuadren:
//
//   … --ejecutar
//
// **El seco es el que va por defecto.** Para escribir hay que pedirlo.
//
// ── Lo que imprime, y lo que NO ──────────────────────────────────────
//
// Imprime RECUENTOS y nombres del catálogo del Colegio. Ni un nombre de
// paciente, ni un teléfono, ni un texto clínico, ni en el informe ni en
// un mensaje de error. Es historia clínica de 3.681 personas que no nos
// conocen, y la terminal de un implantador acaba en una captura.
//
// Un test lo comprueba de verdad: el generador de datos falsos marca
// cada valor «de persona» con un centinela y el test exige que ninguno
// aparezca en la salida.
//
// ── La lateralidad NO TIENE VALOR POR DEFECTO ────────────────────────
//
// Qué mitad de los dibujos de COGECOP es el pie izquierdo no se puede
// sacar de los datos (ver la cabecera de `packages/clinica-sesion/src/
// cogecop.ts`): se sabe mirando la pantalla de quiropodia del programa.
// Sin `--lateralidad`, esto no corre. Un defecto «razonable» aquí sería
// meterle a 3.681 personas la historia del pie cambiado, y nadie lo
// vería nunca: el mapa se pintaría perfecto, en el pie que no es.
//
// ── Antes de correrlo en producción ──────────────────────────────────
//
// Está escrito en `docs/blocks/cogecop-1-done.md`, en «Al ejecutar en
// producción». Lo resumido: clinica-11 desplegado, Marta dada de alta
// como sanitaria a mano, la carpeta al VPS, el seco, el ejecutar, y
// **borrar las copias** del VPS y del contenedor al acabar.

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { esLateralidadDeCogecop } from "@mipiacetpv/clinica-sesion";

import {
  FICHEROS_DEL_EXPORT,
  validarFilas,
  type ExportDeCogecop,
} from "../cogecop/export-esquema.js";
import {
  importarCogecop,
  type RecuentoDeImportacion,
} from "../cogecop/importar.js";
import { getPrisma, shutdown } from "../context.js";
import { loadEnv } from "../env.js";

const USO = `
Uso:
  tsx src/scripts/importar-cogecop.ts --tenant=<uuid> --dir=<carpeta> \\
      --autora-1=<userId> --autora-2=<userId> \\
      --lateralidad=izquierdo-a-la-izquierda|izquierdo-a-la-derecha \\
      [--dry-run | --ejecutar]

  --tenant        la cuenta, que tiene que ser de vertical clínica y tener
                  clave clínica.
  --dir           la carpeta con los trece .json del export de COGECOP.
  --autora-1      el User.id de la especialista 1 de COGECOP.
  --autora-2      el User.id de la especialista 2.
  --lateralidad   QUÉ MITAD de los dibujos es el pie izquierdo. Sin valor
                  por defecto: se confirma mirando la pantalla de
                  quiropodia del programa.
  --dry-run       lo que hace si no se dice otra cosa. No escribe nada.
  --ejecutar      escribe.
`.trim();

function arg(nombre: string): string | null {
  const pre = `--${nombre}=`;
  const a = process.argv.find((x) => x.startsWith(pre));
  return a == null ? null : a.slice(pre.length);
}

function bandera(nombre: string): boolean {
  return process.argv.includes(`--${nombre}`);
}

/** Lee y valida los trece ficheros. Lo que falta o no tiene la forma
 *  para el script ANTES de abrir una transacción. */
export async function leerExport(dir: string): Promise<ExportDeCogecop> {
  const out: Record<string, unknown[]> = {};
  for (const f of FICHEROS_DEL_EXPORT) {
    let crudo: string;
    try {
      crudo = await readFile(join(dir, `${f.nombre}.json`), "utf8");
    } catch {
      if (f.obligatorio) {
        throw new Error(
          `falta ${f.nombre}.json en ${dir} y hace falta para no dejar la historia a medias`,
        );
      }
      out[f.nombre] = [];
      continue;
    }
    out[f.nombre] = validarFilas(f.nombre, f.fila, JSON.parse(crudo));
  }
  return out as unknown as ExportDeCogecop;
}

/**
 * El informe. **Sólo números y nombres de catálogo.**
 *
 * Es una función aparte y exportada para que el test que busca
 * centinelas pueda mirarla entera sin arrancar el script.
 */
export function informe(
  r: RecuentoDeImportacion,
  seco: boolean,
): string {
  const l: string[] = [];
  const n = (x: number) => x.toLocaleString("es-ES");
  l.push(seco ? "EN SECO · no se ha escrito nada" : "EJECUTADO · escrito");
  l.push("");
  l.push(
    `Pacientes      ${n(r.pacientes.enElFichero)} en el fichero · ${n(r.pacientes.nuevos)} nuevos · ${n(r.pacientes.yaEstaban)} ya estaban`,
  );
  l.push(
    `Visitas        ${n(r.visitas.enElFichero)} en el fichero · ${n(r.visitas.nuevas)} nuevas · ${n(r.visitas.yaEstaban)} ya estaban`,
  );
  l.push(
    `   por tipo    quiropodia ${n(r.porTipo.quiropodia)} · cirugía ${n(r.porTipo.cirugia)} · biomecánica ${n(r.porTipo.biomecanica)} · general ${n(r.porTipo.general)}`,
  );
  l.push(
    `Marcas         ${n(r.marcas.total)} · con zona ${n(r.marcas.conZona)} · sin zona ${n(r.marcas.sinZona)}`,
  );
  l.push("");
  l.push("Lesiones sin traducir (nombre del catálogo de COGECOP):");
  const sin = Object.entries(r.sinTraducir).sort((a, b) => b[1] - a[1]);
  if (sin.length === 0) l.push("   (ninguna)");
  for (const [nombre, cuantas] of sin) {
    l.push(`   ${String(cuantas).padStart(7)}  ${nombre}`);
  }
  if (r.patologiasDesconocidas > 0) {
    l.push(
      `   ${String(r.patologiasDesconocidas).padStart(7)}  (patologías que no están en el catálogo de 144)`,
    );
  }
  l.push("");
  l.push(
    `Fechas imposibles   nacimiento ${n(r.fechasImposibles.nacimiento)} · otras ${n(r.fechasImposibles.otras)}`,
  );
  l.push(`Difuntos            ${n(r.difuntos)}`);
  l.push(`Sin teléfono        ${n(r.sinTelefono)}`);
  l.push(`Fichas sin nota     ${n(r.sinNota)}`);
  l.push(`Visitas sin especialista   ${n(r.sinEspecialista)} (entran con la autora 1)`);
  l.push(`Texto de otra pestaña      ${n(r.textoDeOtraPestana)}`);
  return l.join("\n");
}

export async function main(): Promise<void> {
  const tenantId = arg("tenant");
  const dir = arg("dir");
  const autora1 = arg("autora-1");
  const autora2 = arg("autora-2");
  const lateralidad = arg("lateralidad");
  const ejecutar = bandera("ejecutar");

  const faltan: string[] = [];
  if (!tenantId) faltan.push("--tenant");
  if (!dir) faltan.push("--dir");
  if (!autora1) faltan.push("--autora-1");
  if (!autora2) faltan.push("--autora-2");
  if (faltan.length > 0) {
    console.error(`Faltan: ${faltan.join(", ")}\n\n${USO}`);
    process.exit(2);
  }
  // La lateralidad aparte, y con su propio mensaje: no es un parámetro
  // que se olvida, es una decisión que alguien tiene que haber tomado
  // mirando el programa de la clínica.
  if (!esLateralidadDeCogecop(lateralidad)) {
    console.error(
      [
        "--lateralidad no está o no se entiende.",
        "",
        "QUÉ MITAD de los dibujos de COGECOP es el pie izquierdo no se puede",
        "adivinar: hay que mirar la pantalla de quiropodia de la clínica y",
        "ver de qué pie es el dibujo de la izquierda.",
        "",
        "  --lateralidad=izquierdo-a-la-izquierda   (la mitad A es el pie izquierdo)",
        "  --lateralidad=izquierdo-a-la-derecha     (la mitad A es el derecho)",
        "",
        "Sin esto no se corre: 3.681 personas con la historia del pie cambiado",
        "no se ve nunca, porque el mapa se pinta perfecto en el pie que no es.",
      ].join("\n"),
    );
    process.exit(2);
  }
  if (ejecutar && bandera("dry-run")) {
    console.error("--dry-run y --ejecutar a la vez: elige uno.");
    process.exit(2);
  }

  loadEnv();
  const prisma = getPrisma();

  console.log(`Leyendo el export de ${dir} …`);
  const datos = await leerExport(dir!);
  console.log(
    `  ${datos.pacientes.length} pacientes, ${datos.visitas.length} visitas, ${datos.marcas_pie.length} marcas.`,
  );
  console.log(ejecutar ? "Escribiendo." : "En seco: no se escribe nada.");

  const recuento = await importarCogecop(prisma, datos, {
    tenantId: tenantId!,
    lateralidad,
    autora1: autora1!,
    autora2: autora2!,
    ejecutar,
    hoy: new Date(),
    avisar: (linea) => console.log(linea),
  });

  console.log("");
  console.log(informe(recuento, !ejecutar));
  if (!ejecutar) {
    console.log("");
    console.log("Nada escrito. Con --ejecutar se escribe.");
  }
}

// Mismo guardia que `importar-alergenos-maestranza.ts`, y aquí hace
// falta igual: `cogecop-importador.test.ts` importa `informe` y
// `leerExport` de este fichero, y sin el guardia `main()` correría al
// importarlo, imprimiría su «Uso: …» y haría `process.exit(2)` — un rojo
// que no nombra a ningún test.
const isDirectRun =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("importar-cogecop.ts");

if (isDirectRun) {
  main()
    .then(() => shutdown())
    .catch(async (err) => {
      // El mensaje y nada más: un `console.error(err)` entero llevaría
      // la traza, y una traza de este script puede llevar una fila.
      console.error(err instanceof Error ? err.message : String(err));
      await shutdown();
      process.exit(1);
    });
}
