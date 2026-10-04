// catalogo-en-alta · el fichero de catálogo, leído.
//
// Entrada: el CSV de implantación, con las columnas de
// `docs/implantaciones/maestranza/catalogo-tpv.csv`:
//
//     sku,nombre,precio_con_iva,iva,categoria
//     CAF-001,Café con leche,1.60,10,cafés
//
// Salida: las filas que entran y las que no, cada una con el número de
// línea del fichero y el motivo. Nada se escribe desde aquí: este
// módulo no conoce Prisma. Eso es lo que hace que la vista previa sea
// una vista previa de verdad y no una promesa.
//
// ── Por qué un parser a mano y no una librería ─────────────────────────
//
// Porque el repo ya tiene uno para la importación de contactos
// (`contacts/import-parse.ts`) y añadir una dependencia de CSV para
// cinco columnas es traer un problema de supply chain a cambio de nada.
// Lo que sí hace falta de verdad son las **comillas**: el catálogo real
// de La Maestranza trae
//
//     CAF-007,"Infusión (manzanilla, poleo, tila…)",1.60,10,cafés
//
// y un `split(",")` convierte esa línea en seis campos y le pone precio
// `poleo`. Es la primera fila que rompería el import en el bar, con el
// dueño delante.
//
// ── Qué NO decide este módulo ──────────────────────────────────────────
//
// Si un SKU ya existe en el tenant. Eso es una pregunta a la base de
// datos y la contesta la ruta (`superadmin/tenant-catalog.ts`). Aquí
// sólo se mira el fichero contra sí mismo.

import {
  type LocalProductFields,
  validateLocalProduct,
} from "./local-product-rules.js";

/** Las cinco columnas, en el orden del fichero de implantación. */
export const COLUMNAS = ["sku", "nombre", "precio_con_iva", "iva", "categoria"] as const;

export interface FilaBuena {
  /** Número de línea en el fichero, contando la cabecera. Para que el
   *  implantador pueda abrir el CSV y mirar ESA línea. */
  linea: number;
  fields: LocalProductFields;
  /** El precio tal y como venía en el fichero, con IVA. Se enseña en la
   *  vista previa: es la cifra que el dueño reconoce de su carta. */
  precioConIva: number;
}

export interface FilaMala {
  linea: number;
  /** Lo que se pudo leer, para que la fila se reconozca en la pantalla
   *  aunque no se haya podido validar. */
  sku: string;
  nombre: string;
  motivo: string;
}

export interface CsvParseResult {
  buenas: FilaBuena[];
  malas: FilaMala[];
}

export class CsvInvalidoError extends Error {}

/**
 * Parte una línea de CSV respetando comillas dobles (RFC 4180: dos
 * comillas seguidas dentro de un campo entrecomillado son una comilla
 * literal).
 */
export function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let enComillas = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i]!;
    if (enComillas) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else {
          enComillas = false;
        }
      } else {
        cur += c;
      }
      continue;
    }
    if (c === '"') {
      enComillas = true;
      continue;
    }
    if (c === ",") {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += c;
  }
  out.push(cur);
  return out;
}

/**
 * El precio y el IVA del fichero.
 *
 * Acepta coma o punto decimal: el CSV lo genera un Excel español la
 * mitad de las veces, y rechazar `1,60` sería rechazar el fichero por
 * escribirlo bien. Lo que NO se acepta es el separador de miles —`1.234,50`
 * se queda fuera con su motivo— porque adivinar cuál de los dos signos
 * es el decimal en `1.234` es adivinar, y un precio adivinado se cobra.
 */
function parseNumero(raw: string): number | null {
  const t = raw.trim().replace(/\s|€|%/g, "");
  if (t.length === 0) return null;
  if (t.includes(".") && t.includes(",")) return null;
  const n = Number(t.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/**
 * Lee el fichero entero. Lanza `CsvInvalidoError` sólo cuando el
 * problema es del FICHERO y no de una fila —cabecera que no es la
 * esperada, o cero filas—: en ese caso no hay vista previa que enseñar,
 * hay que decirle al implantador que ha subido otra cosa.
 */
export function parseCatalogoCsv(texto: string): CsvParseResult {
  // El BOM del Excel de Windows va pegado al primer nombre de columna y
  // convierte `sku` en `﻿sku`, que no casa con nada.
  const limpio = texto.replace(/^﻿/, "");
  const lineas = limpio.split(/\r?\n/);
  const cabeceraIdx = lineas.findIndex((l) => l.trim().length > 0);
  if (cabeceraIdx < 0) {
    throw new CsvInvalidoError("El fichero está vacío.");
  }
  const cabecera = parseCsvLine(lineas[cabeceraIdx]!).map((c) =>
    c.trim().toLowerCase(),
  );
  const faltan = COLUMNAS.filter((c) => !cabecera.includes(c));
  if (faltan.length > 0) {
    throw new CsvInvalidoError(
      `La primera línea tiene que ser la cabecera con las columnas ${COLUMNAS.join(", ")}.` +
        ` Falta${faltan.length > 1 ? "n" : ""}: ${faltan.join(", ")}.`,
    );
  }
  const col = Object.fromEntries(
    COLUMNAS.map((c) => [c, cabecera.indexOf(c)]),
  ) as Record<(typeof COLUMNAS)[number], number>;

  const buenas: FilaBuena[] = [];
  const malas: FilaMala[] = [];
  // SKU (en su forma normalizada) → línea en la que salió la primera vez.
  const vistos = new Map<string, number>();

  for (let i = cabeceraIdx + 1; i < lineas.length; i += 1) {
    const linea = i + 1;
    const cruda = lineas[i]!;
    if (cruda.trim().length === 0) continue;
    const campos = parseCsvLine(cruda);
    const sku = (campos[col.sku] ?? "").trim();
    const nombre = (campos[col.nombre] ?? "").trim();

    // ── El número de columnas, que parece una formalidad y no lo es ───
    //
    // Lo encontró su propio test. `A-1,Caña,2,50,10,cervezas` —una coma
    // decimal SIN comillas, que es lo que escribe un Excel español— tiene
    // seis campos, y leído por posición da un producto perfectamente
    // válido: precio 2 €, IVA 50 %, categoría "10". Entra callado, con el
    // precio mal y un IVA inventado, en TODAS las filas del fichero.
    //
    // No hay forma de arreglarlo adivinando: `2,50` puede ser dos euros
    // cincuenta o dos campos. Así que se rechaza la fila diciendo lo que
    // ha pasado, que es lo único honesto, y el motivo nombra la causa
    // probable para que el implantador sepa qué arreglar en su Excel.
    if (campos.length !== cabecera.length) {
      malas.push({
        linea,
        sku,
        nombre,
        motivo:
          `La fila tiene ${campos.length} columnas y la cabecera ${cabecera.length}. ` +
          `Si el precio lleva coma decimal, entrecomíllalo ("2,50") o usa el punto (2.50).`,
      });
      continue;
    }

    const precio = parseNumero(campos[col.precio_con_iva] ?? "");
    if (precio === null) {
      malas.push({
        linea,
        sku,
        nombre,
        motivo: `El precio "${(campos[col.precio_con_iva] ?? "").trim()}" no es un número. Escríbelo como 1.60 o 1,60.`,
      });
      continue;
    }
    const iva = parseNumero(campos[col.iva] ?? "");
    if (iva === null) {
      malas.push({
        linea,
        sku,
        nombre,
        motivo: `El IVA "${(campos[col.iva] ?? "").trim()}" no es un número. Escribe el tipo, por ejemplo 10.`,
      });
      continue;
    }

    // La categoría es un solo tag en el fichero de implantación, pero se
    // admiten varias separadas por `;` — el día que alguien quiera
    // "raciones;para compartir" no hay que tocar código.
    const categorias = (campos[col.categoria] ?? "")
      .split(";")
      .map((t) => t.trim())
      .filter((t) => t.length > 0);

    // LA validación. La misma función que el alta de una ficha desde el
    // panel del propietario: el precio del fichero es BRUTO y entra como
    // `priceGross`, así que la conversión a neto la hace la regla y no
    // este parser.
    const valid = validateLocalProduct({
      name: nombre,
      sku,
      priceGross: precio,
      taxRate: iva,
      tags: categorias,
    });
    if (!valid.ok) {
      malas.push({ linea, sku, nombre, motivo: valid.message });
      continue;
    }

    // Repetido DENTRO del fichero. Se queda fuera la segunda aparición y
    // no la primera, y el motivo dice en qué línea estaba: si el
    // implantador ha duplicado una fila con otro precio, lo que quiere
    // saber es cuál de las dos ha entrado.
    const previa = vistos.get(valid.fields.sku);
    if (previa !== undefined) {
      malas.push({
        linea,
        sku,
        nombre,
        motivo: `El SKU ${valid.fields.sku} ya está en la línea ${previa} del fichero.`,
      });
      continue;
    }
    vistos.set(valid.fields.sku, linea);
    buenas.push({ linea, fields: valid.fields, precioConIva: precio });
  }

  if (buenas.length === 0 && malas.length === 0) {
    throw new CsvInvalidoError("El fichero sólo tiene la cabecera: no hay productos que cargar.");
  }
  return { buenas, malas };
}
