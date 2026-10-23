// catalogo-en-alta · el fichero de catálogo, leído.
//
// Entrada: el CSV de implantación, con las columnas de
// `docs/implantaciones/maestranza/catalogo-tpv.csv`:
//
//     sku,nombre,precio_con_iva,iva,categoria
//     CAF-001,Café con leche,1.60,10,cafés
//
// catalogo-servicios-csv · y, OPCIONALMENTE, las tres de una clínica
// (`docs/implantaciones/rosario/catalogo-tpv.csv`):
//
//     sku,nombre,precio_con_iva,iva,categoria,tipo,exencion,duracion_min
//     POD-002,Quiropodia básica,25.00,0,quiropodia,SERVICE,E1,30
//
// Las tres son opcionales y el fichero de La Maestranza —que no las
// trae— se carga exactamente igual que antes de este bloque. Hay test
// con el CSV real de los dos comercios.
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
  esTipoDeVisita,
  NIVELES_DE_QUIROPODIA,
  TIPOS_DE_VISITA,
} from "@mipiacetpv/clinica-sesion";

import { normalizeDurationMin } from "../services/scheduling-rules.js";

import {
  type LocalProductFields,
  validateLocalProduct,
} from "./local-product-rules.js";

/** Las cinco columnas OBLIGATORIAS, en el orden del fichero de implantación. */
export const COLUMNAS = ["sku", "nombre", "precio_con_iva", "iva", "categoria"] as const;

/**
 * kds-1-cocina · la sexta columna, OPCIONAL.
 *
 *     sku,nombre,precio_con_iva,iva,categoria,alergenos
 *     RAC-004,Patatas bravas,10.00,10,raciones,GL
 *     DES-012,Croissant,2.50,10,desayunos,GL;HU;LA
 *
 * Opcional y no obligatoria porque los ficheros de implantación que ya
 * existen —el de La Maestranza entre ellos— no la tienen, y un bloque que
 * invalide los CSV de ayer obliga a rehacerlos antes de poder usar nada.
 *
 * Los códigos son los de dos letras del generador de cartas
 * (`maestranza_carta.py`), separados por `;` como las categorías. Un
 * código que no se reconoce **rechaza la fila**: ver `normalizeAllergens`
 * en `local-product-rules.ts` para el porqué.
 */
export const COLUMNA_ALERGENOS = "alergenos";

/**
 * catalogo-servicios-csv · las TRES columnas de una clínica, también
 * OPCIONALES.
 *
 *     sku,nombre,precio_con_iva,iva,categoria,tipo,exencion,duracion_min
 *     POD-002,Quiropodia básica,25.00,0,quiropodia,SERVICE,E1,30
 *     CRE-001,Crema urea 20%,12.00,21,mostrador,PRODUCT,,
 *
 * Opcionales por la misma razón que `alergenos`: el fichero de La
 * Maestranza no las tiene y un bloque que invalide los CSV de ayer obliga
 * a rehacerlos antes de poder usar nada. Un fichero con sólo las cinco de
 * siempre entra como entraba: todo `PRODUCT`, sujeto y sin duración.
 *
 *   · `tipo` — `PRODUCT` | `SERVICE`. Vacío o ausente = `PRODUCT`. Un
 *     servicio de clínica tiene que nacer `kind = SERVICE` o la agenda no
 *     lo ve (`GET /services/scheduling` filtra por `kind`).
 *   · `exencion` — vacío | un código de la lista L10 de la AEAT. Lo valida
 *     `validateLocalProduct`, que es quien ya sabe que E2/E3 no se pueden
 *     declarar en régimen general y que una causa exige `iva = 0`.
 *   · `duracion_min` — minutos enteros. **Obligatoria si `tipo = SERVICE`**
 *     (sin ella no hay fila de `service_scheduling` y el servicio no se
 *     puede reservar) y **prohibida si `tipo = PRODUCT`** (una crema no se
 *     reserva: una duración ahí es una columna mal puesta, y callarla
 *     dejaría al implantador creyendo que ha cargado un servicio).
 */
export const COLUMNA_TIPO = "tipo";
export const COLUMNA_EXENCION = "exencion";
export const COLUMNA_DURACION = "duracion_min";

/**
 * clinica-8 · LAS CUATRO COLUMNAS DE CLÍNICA, también OPCIONALES.
 *
 *     …,categoria,tipo,exencion,duracion_min,tipo_visita,primera_valoracion,tratamiento_sesion,nivel_quiropodia
 *     POD-002,Quiropodia básica,25.00,0,quiropodia,SERVICE,E1,30,QUIROPODIA,,si,1
 *
 * ── Por qué entran por el fichero, si `catalogo-servicios-csv` dijo que no
 *
 * Porque se midió. Ese bloque las dejó fuera a propósito («nacen en su
 * default y se ponen en el panel»), y la auditoría del 18-10 recorrió el
 * alta completa de una clínica con el CSV de Rosario cargado: los 17
 * servicios entraron exentos y reservables, **y la sesión dijo «sin
 * servicio» y cerró a 0,00 €.** Sin estas cuatro marcas el catálogo está
 * cargado y la clínica no puede cobrar — que es justo lo que el fichero
 * existe para evitar.
 *
 *   · `tipo_visita` — `QUIROPODIA` | `PIE_RIESGO` | `CIRUGIA` |
 *     `BIOMECANICA` | `GENERAL`. **Es de la CATEGORÍA, no del servicio**
 *     (S5: el agrupador único es la categoría del catálogo, y los
 *     servicios heredan). Se escribe en la fila porque es donde está la
 *     categoría, y todas las filas de una misma categoría tienen que
 *     decir lo mismo: si no, se rechaza la segunda nombrando a la primera.
 *   · `primera_valoracion` — sí/no. El servicio con el que se cita la
 *     primera visita.
 *   · `tratamiento_sesion` — sí/no. Sale como botón en la sesión.
 *   · `nivel_quiropodia` — 1, 2 o 3. «Este servicio ES el nivel N», que es
 *     lo que convierte el nivel propuesto en una línea de ticket. Uno por
 *     nivel: dos servicios que digan ser el mismo dejan a la sesión sin
 *     saber cuál cobrar, y el índice único parcial de clinica-5 lo
 *     rechazaría al escribir — mejor decirlo en la vista previa.
 *
 * Las cuatro son de SERVICIOS. En una fila `PRODUCT` se rechaza la fila:
 * una crema no es el nivel de nada, y callarlo dejaría al implantador
 * creyendo que ha configurado la quiropodia.
 */
export const COLUMNA_TIPO_VISITA = "tipo_visita";
export const COLUMNA_PRIMERA_VALORACION = "primera_valoracion";
export const COLUMNA_TRATAMIENTO_SESION = "tratamiento_sesion";
export const COLUMNA_NIVEL_QUIROPODIA = "nivel_quiropodia";

/** Los dos valores de la columna `tipo`, que son los del enum de
 *  `products.kind`. */
const TIPOS = ["PRODUCT", "SERVICE"] as const;

export interface FilaBuena {
  /** Número de línea en el fichero, contando la cabecera. Para que el
   *  implantador pueda abrir el CSV y mirar ESA línea. */
  linea: number;
  fields: LocalProductFields;
  /** El precio tal y como venía en el fichero, con IVA. Se enseña en la
   *  vista previa: es la cifra que el dueño reconoce de su carta. */
  precioConIva: number;
  /**
   * catalogo-servicios-csv · los minutos de agenda, o `null` si la fila es
   * un producto. **Es `number` exactamente cuando `fields.kind` es
   * `SERVICE`**: el parser no deja pasar un servicio sin duración ni un
   * producto con ella, así que quien escribe no tiene que decidir qué
   * hacer con la mitad de los casos.
   */
  duracionMin: number | null;
  /**
   * clinica-8 · las marcas de clínica del servicio, o `null` si la fila no
   * trae ninguna (que es el caso de todo CSV de ayer y de toda fila de
   * producto). `null` y no un objeto con tres `false`: un dato que no está
   * y un dato que vale «no» no son lo mismo — la ruta sólo escribe la fila
   * de agenda con marcas cuando el fichero dijo algo.
   */
  clinica: MarcasDeClinica | null;
}

/** clinica-8 · lo que una fila de servicio dice de sí misma en clínica. */
export interface MarcasDeClinica {
  primeraValoracion: boolean;
  tratamientoSesion: boolean;
  /** 1..3, o `null` si este servicio no es un nivel de quiropodia. */
  nivelQuiropodia: number | null;
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
  /**
   * clinica-8 · el mapa `categoría → tipo de visita` que el fichero
   * declara (S5). Vacío en todo CSV que no traiga `tipo_visita`.
   *
   * Va APARTE de las filas y no dentro de cada una, porque no es del
   * servicio: es de la categoría, y dos servicios de «quiropodia» no
   * declaran dos cosas, declaran la misma. Quien escribe (`tenant-catalog`)
   * hace un `upsert` por (tenant, slug), que es la forma de la tabla.
   */
  tiposDeVisita: Array<{ slug: string; visitType: string }>;
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
  // -1 si el fichero no la trae, que es el caso de los CSV de ayer.
  const colAlergenos = cabecera.indexOf(COLUMNA_ALERGENOS);
  // catalogo-servicios-csv · lo mismo con las tres de la clínica.
  const colTipo = cabecera.indexOf(COLUMNA_TIPO);
  const colExencion = cabecera.indexOf(COLUMNA_EXENCION);
  const colDuracion = cabecera.indexOf(COLUMNA_DURACION);
  // clinica-8 · las cuatro de clínica.
  const colTipoVisita = cabecera.indexOf(COLUMNA_TIPO_VISITA);
  const colPrimeraValoracion = cabecera.indexOf(COLUMNA_PRIMERA_VALORACION);
  const colTratamientoSesion = cabecera.indexOf(COLUMNA_TRATAMIENTO_SESION);
  const colNivel = cabecera.indexOf(COLUMNA_NIVEL_QUIROPODIA);

  const buenas: FilaBuena[] = [];
  const malas: FilaMala[] = [];
  // SKU (en su forma normalizada) → línea en la que salió la primera vez.
  const vistos = new Map<string, number>();
  // clinica-8 · categoría → { tipo de visita, línea donde se dijo }. La
  // línea se guarda para poder nombrarla cuando otra fila la contradiga.
  const tipoPorCategoria = new Map<string, { visitType: string; linea: number }>();
  // clinica-8 · nivel de quiropodia → línea. Uno por nivel.
  const nivelesVistos = new Map<number, number>();

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
    // kds-1-cocina · los alérgenos, si el fichero los trae.
    const alergenos =
      colAlergenos >= 0
        ? (campos[colAlergenos] ?? "")
            .split(";")
            .map((a) => a.trim())
            .filter((a) => a.length > 0)
        : [];

    // ── catalogo-servicios-csv · el tipo ────────────────────────────
    //
    // Vacío o ausente = PRODUCT, que es lo que hace que el fichero de La
    // Maestranza siga entrando igual. Un valor que no es ninguno de los
    // dos **rechaza la fila** en vez de caer a PRODUCT: `SERVICIO` o
    // `Service ` escrito a mano no es un producto, es un servicio que
    // habría entrado como producto y la agenda no vería. Se admite en
    // cualquier caja porque un CSV escrito a mano no respeta mayúsculas.
    const tipoCrudo = (colTipo >= 0 ? (campos[colTipo] ?? "") : "").trim().toUpperCase();
    let kind: (typeof TIPOS)[number] = "PRODUCT";
    if (tipoCrudo.length > 0) {
      if (!(TIPOS as readonly string[]).includes(tipoCrudo)) {
        malas.push({
          linea,
          sku,
          nombre,
          motivo: `El tipo "${tipoCrudo}" no vale. Escribe ${TIPOS.join(" o ")}, o déjalo vacío para un producto.`,
        });
        continue;
      }
      kind = tipoCrudo as (typeof TIPOS)[number];
    }

    // ── La exención ─────────────────────────────────────────────────
    //
    // Se lee y se pasa tal cual a `validateLocalProduct`: la lista L10,
    // el «E2/E3 no en régimen general» y el «exento ⇒ IVA 0» los decide
    // ESA función, que es la misma que usa el alta de una ficha desde el
    // panel (decisión 2 del bloque). Aquí no hay una segunda validación
    // de la exención, y es a propósito: dos sitios que decidan qué
    // exenciones valen acaban discrepando, y el que discrepe emite un
    // registro rechazado con la factura ya entregada.
    //
    // Lo que SÍ es de este módulo: `""` y «columna ausente» son lo mismo
    // y significan «operación sujeta».
    const exencionCruda = (
      colExencion >= 0 ? (campos[colExencion] ?? "") : ""
    ).trim().toUpperCase();

    // ── La duración ─────────────────────────────────────────────────
    //
    // Las dos mitades de la regla, y las dos rechazan la fila con un
    // motivo que dice qué arreglar:
    //
    //   · un SERVICE sin duración no se puede reservar — entraría al
    //     catálogo y a la agenda, y la dueña descubriría que no hay
    //     huecos el día que intente dar la primera cita;
    //   · un PRODUCT con duración es una columna mal puesta. Ignorarla
    //     dejaría al implantador creyendo que ha cargado un servicio.
    const duracionCruda = (
      colDuracion >= 0 ? (campos[colDuracion] ?? "") : ""
    ).trim();
    let duracionMin: number | null = null;
    if (kind === "SERVICE") {
      if (duracionCruda.length === 0) {
        malas.push({
          linea,
          sku,
          nombre,
          motivo:
            "Un servicio necesita su duración en minutos (columna duracion_min): sin ella no se puede reservar.",
        });
        continue;
      }
      // `parseNumero` devuelve `null` cuando no hay número que leer
      // («media hora», «1.234,5»); se le pasa entonces el texto crudo para
      // que el mensaje sea «no es un número» y no «entre 1 y 1440», que
      // sería mentira sobre lo que el implantador escribió.
      const leido = parseNumero(duracionCruda);
      const dur = normalizeDurationMin(leido === null ? duracionCruda : leido);
      if (!dur.ok) {
        malas.push({ linea, sku, nombre, motivo: dur.message });
        continue;
      }
      duracionMin = dur.value;
    } else if (duracionCruda.length > 0) {
      malas.push({
        linea,
        sku,
        nombre,
        motivo:
          `Un producto no se reserva, así que no lleva duracion_min (trae "${duracionCruda}"). ` +
          "Si es un servicio, pon SERVICE en la columna tipo.",
      });
      continue;
    }

    // ── clinica-8 · las cuatro marcas de clínica ────────────────────
    //
    // Se leen DESPUÉS de la duración porque las cuatro son de servicios:
    // así `kind` ya está decidido y el motivo puede nombrar la causa
    // probable («si es un servicio, pon SERVICE en la columna tipo»), que
    // es la misma forma que usa la duración.
    const crudoDe = (idx: number): string =>
      (idx >= 0 ? (campos[idx] ?? "") : "").trim();
    const tipoVisitaCrudo = crudoDe(colTipoVisita).toUpperCase();
    const primeraCruda = crudoDe(colPrimeraValoracion);
    const sesionCruda = crudoDe(colTratamientoSesion);
    const nivelCrudo = crudoDe(colNivel);
    const hayMarcas =
      tipoVisitaCrudo.length > 0 ||
      primeraCruda.length > 0 ||
      sesionCruda.length > 0 ||
      nivelCrudo.length > 0;

    if (hayMarcas && kind !== "SERVICE") {
      malas.push({
        linea,
        sku,
        nombre,
        motivo:
          "Las columnas de clínica (tipo_visita, primera_valoracion, " +
          "tratamiento_sesion, nivel_quiropodia) son de servicios. " +
          "Si es un servicio, pon SERVICE en la columna tipo.",
      });
      continue;
    }

    let marcas: MarcasDeClinica | null = null;
    if (hayMarcas) {
      const primera = leerSiNo(primeraCruda);
      if (primera === null) {
        malas.push({
          linea,
          sku,
          nombre,
          motivo: `"${primeraCruda}" no es un sí ni un no en primera_valoracion. Escribe sí o no (o déjalo vacío).`,
        });
        continue;
      }
      const sesion = leerSiNo(sesionCruda);
      if (sesion === null) {
        malas.push({
          linea,
          sku,
          nombre,
          motivo: `"${sesionCruda}" no es un sí ni un no en tratamiento_sesion. Escribe sí o no (o déjalo vacío).`,
        });
        continue;
      }
      let nivel: number | null = null;
      if (nivelCrudo.length > 0) {
        const leido = parseNumero(nivelCrudo);
        if (
          leido === null ||
          !Number.isInteger(leido) ||
          !(NIVELES_DE_QUIROPODIA as readonly number[]).includes(leido)
        ) {
          malas.push({
            linea,
            sku,
            nombre,
            motivo: `El nivel de quiropodia "${nivelCrudo}" no vale. Escribe ${NIVELES_DE_QUIROPODIA.join(", ")} o déjalo vacío.`,
          });
          continue;
        }
        // Uno por nivel: el índice único parcial de clinica-5 lo
        // rechazaría al escribir, y entonces no entraría NINGUNA fila (la
        // carga es todo o nada). Mejor decirlo en la vista previa.
        const previo = nivelesVistos.get(leido);
        if (previo !== undefined) {
          malas.push({
            linea,
            sku,
            nombre,
            motivo: `El nivel ${leido} de quiropodia ya es el de la línea ${previo}: sólo puede haber un servicio por nivel.`,
          });
          continue;
        }
        nivel = leido;
      }
      // El tipo de visita, que es de la CATEGORÍA.
      if (tipoVisitaCrudo.length > 0) {
        if (!esTipoDeVisita(tipoVisitaCrudo)) {
          malas.push({
            linea,
            sku,
            nombre,
            motivo: `El tipo de visita "${tipoVisitaCrudo}" no vale. Escribe uno de: ${TIPOS_DE_VISITA.join(", ")}.`,
          });
          continue;
        }
        if (categorias.length === 0) {
          malas.push({
            linea,
            sku,
            nombre,
            motivo:
              "El tipo de visita es de la CATEGORÍA, así que esta fila necesita una (columna categoria).",
          });
          continue;
        }
        const choque = categorias
          .map((c) => ({ c, previo: tipoPorCategoria.get(c) }))
          .find((x) => x.previo && x.previo.visitType !== tipoVisitaCrudo);
        if (choque?.previo) {
          malas.push({
            linea,
            sku,
            nombre,
            motivo: `La categoría "${choque.c}" ya es ${choque.previo.visitType} en la línea ${choque.previo.linea}: una categoría tiene un solo tipo de visita.`,
          });
          continue;
        }
        // Y un nivel de quiropodia sólo tiene sentido en la quiropodia.
        // Es la tercera negativa de S5 (`NIVEL_SIN_QUIROPODIA`), dicha
        // aquí para que no llegue como un 409 con el fichero cargado a
        // medias.
        if (nivel !== null && tipoVisitaCrudo !== "QUIROPODIA") {
          malas.push({
            linea,
            sku,
            nombre,
            motivo: `Un nivel de quiropodia sólo vale en un servicio de quiropodia, y esta categoría es ${tipoVisitaCrudo}.`,
          });
          continue;
        }
      }
      marcas = {
        primeraValoracion: primera,
        tratamientoSesion: sesion,
        nivelQuiropodia: nivel,
      };
    }

    const valid = validateLocalProduct({
      name: nombre,
      sku,
      priceGross: precio,
      taxRate: iva,
      tags: categorias,
      allergens: alergenos,
      kind,
      exemptionCause: exencionCruda.length === 0 ? null : exencionCruda,
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
    // clinica-8 · las dos memorias se apuntan AQUÍ, cuando la fila entra
    // de verdad. Apuntarlas antes dejaría un nivel «cogido» por una fila
    // que acabó rechazada por el precio.
    if (marcas?.nivelQuiropodia != null) {
      nivelesVistos.set(marcas.nivelQuiropodia, linea);
    }
    if (tipoVisitaCrudo.length > 0) {
      for (const c of categorias) {
        tipoPorCategoria.set(c, { visitType: tipoVisitaCrudo, linea });
      }
    }
    buenas.push({
      linea,
      fields: valid.fields,
      precioConIva: precio,
      duracionMin,
      clinica: marcas,
    });
  }

  if (buenas.length === 0 && malas.length === 0) {
    throw new CsvInvalidoError("El fichero sólo tiene la cabecera: no hay productos que cargar.");
  }
  return {
    buenas,
    malas,
    tiposDeVisita: [...tipoPorCategoria.entries()].map(([slug, v]) => ({
      slug,
      visitType: v.visitType,
    })),
  };
}

/**
 * clinica-8 · un sí/no del fichero.
 *
 * Vacío = `false`, que es el default de las dos columnas en la base. Y se
 * aceptan las formas que escribe una persona delante de un Excel: `si`,
 * `sí`, `x`, `1`, `true`… `null` = lo que hay escrito no es ninguna de las
 * dos cosas, y entonces se rechaza la fila en vez de leerlo como «no»:
 * «tratamiento_sesion = nop» leído como «no» es un botón que no sale en la
 * sesión y nadie sabe por qué.
 */
function leerSiNo(raw: string): boolean | null {
  const t = raw.trim().toLowerCase();
  if (t.length === 0) return false;
  if (["si", "sí", "s", "x", "1", "true", "yes", "y"].includes(t)) return true;
  if (["no", "n", "0", "false"].includes(t)) return false;
  return null;
}
