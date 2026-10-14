// kds-1-cocina · LOS ALÉRGENOS DE LA MAESTRANZA, DE SU PROPIA CARTA.
//
// Uso:
//   pnpm --filter @mipiacetpv/api alergenos:maestranza -- <tenantId>
//   pnpm --filter @mipiacetpv/api alergenos:maestranza -- <tenantId> --aplicar
//
// **EN SECO POR DEFECTO.** Sin `--aplicar` no se escribe nada: imprime lo
// que haría y se calla. Es la misma regla que la vista previa del fichero
// de catálogo (`catalogo-en-alta`), y por el mismo motivo: en una
// implantación el que corre esto está delante del dueño, y «lo que va a
// pasar» tiene que poderse leer antes de que pase.
//
// ── DE DÓNDE SALEN LOS ALÉRGENOS ──────────────────────────────────────
//
// Del generador de cartas de La Maestranza
// (`docs/implantaciones/maestranza/generador/maestranza_carta.py`), que ya
// los lleva por plato porque son los que están IMPRESOS en la carta que
// hay encima de las mesas.
//
// Ésa es la razón de leerlos de ahí y no de teclearlos aquí: la carta
// impresa y el TPV tienen que decir lo mismo. Si alguien añade un plato al
// generador y reimprime, volver a correr esto lo pone al día; una tabla
// copiada en este fichero se quedaría vieja y nadie se enteraría hasta que
// un celíaco pidiera ese plato.
//
// ── CÓMO SE EMPAREJA ──────────────────────────────────────────────────
//
// Por NOMBRE normalizado (sin tildes, minúsculas, espacios colapsados).
// No por SKU, porque el generador no tiene SKU: tiene el nombre que está
// impreso en la carta.
//
// Y de ahí los dos informes que el «en seco» imprime y que importan más
// que el resumen:
//
//   · **platos de la carta que no están en el catálogo** — el TPV no los
//     vende, o se llaman distinto. Hay que mirarlos a mano.
//   · **productos del catálogo de COMIDA sin alérgenos informados** — lo
//     que quedaría sin cruce. Vacío NO significa «sin alérgenos»:
//     significa «no informado», y la capa 3 se apaga sola ahí.
//
// Un nombre repetido en el generador con DOS listas distintas de alérgenos
// (p. ej. «Calamares» en raciones y en bocadillos: el bocadillo lleva
// además gluten del pan) se resuelve por UNIÓN y se dice. Es el lado
// prudente: avisar de un alérgeno que a lo mejor no lleva es un plato que
// no se sirve; callarse uno que sí lleva es un ingreso.
//
// ── IDEMPOTENTE ───────────────────────────────────────────────────────
//
// Sólo escribe los productos cuya lista CAMBIA, y compara ordenada. Dos
// pasadas seguidas dejan la segunda en «0 actualizados».

import "dotenv/config";

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  ALERGENOS,
  alergenoDesdeCodigo,
  LISTA_ALERGENOS,
  type Alergeno,
} from "@mipiacetpv/ticket-model";

import { getPrisma, shutdown } from "../context.js";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const GENERADOR = path.resolve(
  AQUI,
  "../../../../docs/implantaciones/maestranza/generador/maestranza_carta.py",
);

/**
 * Las secciones de la carta que SÍ son comida.
 *
 * Los cafés y las bebidas también llevan alérgenos en el generador (el
 * café con leche lleva `LA`), y se importan igual: la obligación de
 * informar no distingue. Esta lista es sólo para el informe de «comida sin
 * informar», donde una caña sin alérgenos no es una laguna.
 */
const ETIQUETAS_DE_COMIDA = [
  "raciones",
  "bocadillos",
  "platos",
  "desayunos",
  "hamburguesas",
];

/** Sin tildes, en minúsculas y con los espacios colapsados. */
export function normalizarNombre(n: string): string {
  return n
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export interface PlatoDeLaCarta {
  nombre: string;
  alergenos: Alergeno[];
  /** Códigos del generador que este script no reconoce. */
  desconocidos: string[];
}

/**
 * Lee las tuplas `("Nombre", precio, ["GL","HU"])` del generador.
 *
 * Un regex y no un parser de Python: lo que hay que leer son tuplas
 * literales de tres elementos con la misma forma en todo el fichero, y
 * traer un intérprete de Python a un script de implantación es traer un
 * problema a cambio de nada. El regex está acotado a esa forma exacta, y
 * si el generador cambiara de estructura el script devolvería CERO platos
 * —no un subconjunto silencioso—, que es el fallo que se ve.
 */
export function leerCarta(fuente: string): {
  platos: PlatoDeLaCarta[];
  repetidosUnidos: string[];
} {
  const re = /\(\s*"([^"]+)"\s*,\s*(?:[\d.]+|None)\s*,\s*\[([^\]]*)\]\s*\)/g;
  const porNombre = new Map<string, { nombre: string; codigos: Set<string> }>();
  const vistos = new Map<string, string>();
  const repetidosUnidos: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(fuente)) !== null) {
    const nombre = m[1]!;
    const clave = normalizarNombre(nombre);
    const codigos = [...m[2]!.matchAll(/"([A-Z]{2})"/g)].map((x) => x[1]!);
    const firma = [...codigos].sort().join("+");
    const previa = vistos.get(clave);
    if (previa !== undefined && previa !== firma) {
      // Mismo nombre, dos listas: se UNEN y se dice. «Calamares» de
      // ración no lleva pan; el bocadillo de calamares sí.
      if (!repetidosUnidos.includes(nombre)) repetidosUnidos.push(nombre);
    }
    vistos.set(clave, firma);
    const entrada = porNombre.get(clave) ?? { nombre, codigos: new Set() };
    for (const c of codigos) entrada.codigos.add(c);
    porNombre.set(clave, entrada);
  }

  const platos: PlatoDeLaCarta[] = [];
  for (const [, v] of porNombre) {
    const alergenos: Alergeno[] = [];
    const desconocidos: string[] = [];
    for (const c of v.codigos) {
      const a = alergenoDesdeCodigo(c);
      if (a) alergenos.push(a);
      else desconocidos.push(c);
    }
    platos.push({
      nombre: v.nombre,
      // En el orden del anexo II, que es el de la rejilla y el del papel.
      alergenos: LISTA_ALERGENOS.filter((a) => alergenos.includes(a)),
      desconocidos,
    });
  }
  return { platos, repetidosUnidos };
}

function iguales(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const x = [...a].sort();
  const y = [...b].sort();
  return x.every((v, i) => v === y[i]);
}

async function main() {
  const tenantId = process.argv[2];
  const aplicar = process.argv.includes("--aplicar");
  if (!tenantId) {
    console.error(
      "Uso: pnpm --filter @mipiacetpv/api alergenos:maestranza -- <tenantId> [--aplicar]",
    );
    process.exit(2);
  }

  const fuente = readFileSync(GENERADOR, "utf8");
  const { platos, repetidosUnidos } = leerCarta(fuente);
  if (platos.length === 0) {
    console.error(
      `No se ha leído NINGÚN plato de ${GENERADOR}.\n` +
        "El generador ha cambiado de estructura: revisa `leerCarta` antes de seguir.",
    );
    process.exit(3);
  }

  const prisma = getPrisma();
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { id: true, name: true },
  });
  if (!tenant) {
    console.error(`El tenant ${tenantId} no existe.`);
    process.exit(4);
  }
  const productos = await prisma.product.findMany({
    where: { tenantId },
    select: { id: true, name: true, sku: true, tags: true, allergens: true },
  });
  const porNombre = new Map<string, typeof productos>();
  for (const p of productos) {
    const k = normalizarNombre(p.name);
    porNombre.set(k, [...(porNombre.get(k) ?? []), p]);
  }

  const aCambiar: Array<{
    id: string;
    sku: string | null;
    nombre: string;
    antes: string[];
    despues: Alergeno[];
  }> = [];
  const yaIguales: string[] = [];
  const sinProducto: string[] = [];
  const codigosDesconocidos = new Set<string>();

  for (const plato of platos) {
    for (const c of plato.desconocidos) codigosDesconocidos.add(c);
    const encontrados = porNombre.get(normalizarNombre(plato.nombre));
    if (!encontrados || encontrados.length === 0) {
      sinProducto.push(plato.nombre);
      continue;
    }
    for (const p of encontrados) {
      if (iguales(p.allergens, plato.alergenos)) {
        yaIguales.push(p.name);
        continue;
      }
      aCambiar.push({
        id: p.id,
        sku: p.sku,
        nombre: p.name,
        antes: p.allergens,
        despues: plato.alergenos,
      });
    }
  }

  const nombresDeLaCarta = new Set(platos.map((p) => normalizarNombre(p.nombre)));
  const comidaSinInformar = productos.filter(
    (p) =>
      p.allergens.length === 0 &&
      !nombresDeLaCarta.has(normalizarNombre(p.name)) &&
      p.tags.some((t) => ETIQUETAS_DE_COMIDA.includes(normalizarNombre(t))),
  );

  const etiqueta = (a: readonly string[]) =>
    a.length === 0
      ? "(sin informar)"
      : a
          .map((x) => ALERGENOS[x as Alergeno]?.codigo ?? x)
          .join(" ");

  console.log(`\n── Alérgenos de la carta → catálogo de ${tenant.name} ──`);
  console.log(`Fuente: ${GENERADOR}`);
  console.log(
    `Modo: ${aplicar ? "APLICAR (se escribe)" : "EN SECO (no se escribe nada)"}\n`,
  );
  console.log(`Platos leídos de la carta: ${platos.length}`);
  console.log(`Productos del catálogo:    ${productos.length}\n`);

  if (codigosDesconocidos.size > 0) {
    // No se descartan en silencio: un alérgeno que el script no entiende
    // es un plato que diría que no lleva lo que lleva.
    console.log(
      `⚠ CÓDIGOS QUE NO RECONOZCO (${codigosDesconocidos.size}): ${[
        ...codigosDesconocidos,
      ].join(", ")}`,
    );
    console.log(
      "  Los platos que los llevan se importan SIN ellos. Revísalos a mano.\n",
    );
  }
  if (repetidosUnidos.length > 0) {
    console.log(
      `· Nombres con dos listas distintas en la carta, UNIDAS (${repetidosUnidos.length}):`,
    );
    for (const n of repetidosUnidos) console.log(`    ${n}`);
    console.log(
      "  Se une a propósito: avisar de más es un plato que no se sirve; callarse uno es un ingreso.\n",
    );
  }

  console.log(`A CAMBIAR (${aCambiar.length}):`);
  for (const c of aCambiar) {
    console.log(
      `    ${(c.sku ?? "—").padEnd(10)} ${c.nombre.padEnd(38)} ${etiqueta(
        c.antes,
      )}  →  ${etiqueta(c.despues)}`,
    );
  }
  console.log(`\nYA IGUALES (${yaIguales.length}) · no se tocan.`);

  if (sinProducto.length > 0) {
    console.log(
      `\n⚠ PLATOS DE LA CARTA QUE NO ESTÁN EN EL CATÁLOGO (${sinProducto.length}):`,
    );
    for (const n of sinProducto) console.log(`    ${n}`);
    console.log("  O el TPV no los vende, o se llaman distinto. A mano.");
  }
  if (comidaSinInformar.length > 0) {
    console.log(
      `\n⚠ COMIDA DEL CATÁLOGO QUE SE QUEDA SIN INFORMAR (${comidaSinInformar.length}):`,
    );
    for (const p of comidaSinInformar) {
      console.log(`    ${(p.sku ?? "—").padEnd(10)} ${p.name}`);
    }
    console.log(
      "  Vacío NO es «sin alérgenos»: es «no informado», y el cruce de la pantalla se apaga ahí.",
    );
  }

  if (!aplicar) {
    console.log(
      `\nEn seco: NO se ha escrito nada. Para aplicarlo, repite con --aplicar.\n`,
    );
    return;
  }

  for (const c of aCambiar) {
    await prisma.product.update({
      where: { id: c.id },
      data: { allergens: c.despues },
    });
  }
  console.log(`\nAplicado: ${aCambiar.length} productos actualizados.\n`);
}

// Sólo arrancamos `main` si el módulo se EJECUTA directamente. Mismo
// guardia que `backfill-contact-type.ts`, y aquí hacía falta igual:
// `kds-alergenos-maestranza.test.ts` importa `leerCarta` y
// `normalizarNombre` de este fichero, y al importarlo corría `main` sin
// argumentos → «Uso: …» y `process.exit(2)`.
//
// Lo que eso hacía, y por qué costó verlo: los 341 ficheros de la suite
// PASABAN y vitest cortaba igual, con un «Unhandled Rejection:
// process.exit unexpectedly called with 2» que no nombra a ningún test.
// En CI es un rojo sin fichero al que ir.
const isDirectRun =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("importar-alergenos-maestranza.ts");

if (isDirectRun) {
  main()
    .then(() => shutdown())
    .catch(async (err) => {
      console.error(err);
      await shutdown();
      process.exit(1);
    });
}
