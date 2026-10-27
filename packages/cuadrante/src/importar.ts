// personal-1 (decisión 3) · **IMPORTAR PERSONAL DESDE UN CSV.**
//
// El listado de Jardín de Gredos llegó como llegan todos: una hoja de
// cálculo exportada. Esto es lo que lo convierte en fichas de personal sin
// que nadie teclee 21 veces once campos.
//
// ── POR QUÉ ESTÁ EN EL PAQUETE PURO ─────────────────────────────────
//
// Por lo mismo que `nombres.ts` en alta-minima: la **vista previa** y la
// **idempotencia** tienen que decidir lo mismo. La pantalla enseña «de
// éstos 21 se completan 21 y se crean 0» y el servidor hace eso; si cada
// uno normalizara los nombres o entendiera las fechas a su manera, la
// vista previa mentiría —y lo haría sólo en los casos raros, que son los
// que nadie prueba a mano («Mª ÁNGELES  LÓPEZ» con dos espacios).
//
// ── LAS CUATRO COSAS QUE ESTO HACE Y NO SE VEN ──────────────────────
//
//   1. **Casa por nombre completo normalizado** contra las fichas que ya
//      existen, con `claveDeNombre` del paquete del plan — la misma
//      función que decide duplicados de residentes. Y la clave de una
//      ficha existente se arma con `name + lastName`, que es lo que hace
//      que las 21 fichas de Gredos —creadas con el nombre completo dentro
//      de `name` y sin apellidos— casen con un CSV que trae las dos
//      columnas separadas. Al completar, se separan.
//
//   2. **Nunca vacía un campo que ya tiene valor** porque la celda venga
//      vacía. Un CSV al que le falta la columna del teléfono no puede
//      borrar los teléfonos de la plantilla.
//
//   3. **Es idempotente.** Importar dos veces el mismo fichero no cambia
//      nada la segunda vez, y lo dice: la segunda pasada devuelve «sin
//      cambios» en cada fila, no «completa 21».
//
//   4. **Una fila que no se entiende dice POR QUÉ y no tumba el fichero.**
//      Veinte fichas buenas y una fecha mal escrita importan veinte y
//      señalan la fila 7.
//
// Y es puro de verdad: ni reloj, ni base, ni `Intl`.

import { claveDeNombre } from "@mipiacetpv/residencia-plan";

/**
 * Cuántas filas se admiten de una vez.
 *
 * Mil. La plantilla más grande que este producto va a ver en años es de
 * tres cifras (21 en Jardín de Gredos, un claustro de 60 en el colegio), y
 * mil deja margen de sobra; por encima, lo que hay no es una plantilla, es
 * un fichero equivocado — y procesarlo significaría una transacción con
 * cinco mil escrituras y una pantalla colgada.
 *
 * El límite devuelve un mensaje que dice cuántas filas traía y cuántas
 * caben, no un 500.
 */
export const MAX_FILAS_CSV = 1000;

/** Las once columnas que se reconocen. Las demás se ignoran en silencio. */
export const COLUMNAS_DE_PERSONAL = [
  "nombre",
  "apellidos",
  "dni_nie",
  "num_afiliacion_ss",
  "categoria",
  "jornada_semanal_h",
  "fecha_alta",
  "tipo_contrato",
  "fecha_fin",
  "telefono",
  "email",
] as const;

export type ColumnaDePersonal = (typeof COLUMNAS_DE_PERSONAL)[number];

/** Una fila ya entendida. `undefined` = la columna no venía en el fichero;
 *  `null` = venía y estaba vacía. Son dos cosas distintas y la segunda
 *  tampoco borra nada (ver la decisión 3), pero la primera ni se mira. */
export interface FilaDePersonal {
  /** 1-indexada y **contando la cabecera**, que es cómo la numera Excel. */
  linea: number;
  nombre: string;
  apellidos?: string | null;
  dniNie?: string | null;
  afiliacion?: string | null;
  categoria?: string | null;
  /** Minutos a la semana, ya convertidos de las horas del fichero. */
  minutosSemanales?: number | null;
  /** «YYYY-MM-DD». */
  fechaDeAlta?: string | null;
  tipoDeContrato?: "INDEFINIDO" | "TEMPORAL" | null;
  fechaDeFin?: string | null;
  telefono?: string | null;
  email?: string | null;
}

export interface ErrorDeFila {
  linea: number;
  /** Lo que la pantalla enseña. Dice qué fila, qué columna y qué pasa. */
  mensaje: string;
}

export interface CsvDePersonal {
  /** El separador que se detectó, para poder decirlo en la pantalla. */
  separador: ";" | ",";
  /** Las columnas reconocidas que venían, en el orden del fichero. */
  columnas: ColumnaDePersonal[];
  filas: FilaDePersonal[];
  errores: ErrorDeFila[];
}

export class CsvDePersonalInvalido extends Error {}

// ── Leer ──────────────────────────────────────────────────────────────

/** Sin tildes, en minúscula y con los espacios y guiones a `_`. */
function normalizarCabecera(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[\s.-]+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
}

/** Los alias que un Excel español escribe de verdad. */
const ALIAS: Record<string, ColumnaDePersonal> = {
  nombre: "nombre",
  nombres: "nombre",
  apellidos: "apellidos",
  apellido: "apellidos",
  dni_nie: "dni_nie",
  dni: "dni_nie",
  nie: "dni_nie",
  dninie: "dni_nie",
  num_afiliacion_ss: "num_afiliacion_ss",
  num_afiliacion: "num_afiliacion_ss",
  afiliacion: "num_afiliacion_ss",
  nss: "num_afiliacion_ss",
  n_afiliacion_ss: "num_afiliacion_ss",
  categoria: "categoria",
  categoria_profesional: "categoria",
  jornada_semanal_h: "jornada_semanal_h",
  jornada_semanal: "jornada_semanal_h",
  jornada: "jornada_semanal_h",
  horas_semana: "jornada_semanal_h",
  fecha_alta: "fecha_alta",
  fecha_de_alta: "fecha_alta",
  alta: "fecha_alta",
  tipo_contrato: "tipo_contrato",
  tipo_de_contrato: "tipo_contrato",
  contrato: "tipo_contrato",
  fecha_fin: "fecha_fin",
  fecha_de_fin: "fecha_fin",
  fin: "fecha_fin",
  telefono: "telefono",
  tlf: "telefono",
  movil: "telefono",
  email: "email",
  correo: "email",
  e_mail: "email",
};

/**
 * Parte una línea de CSV respetando las comillas.
 *
 * Hace falta de verdad: «RAMOS DOBLADO, ABEL» en una celda de un fichero
 * separado por comas es exactamente lo que un Excel exporta entre
 * comillas, y partir por el separador a secas convertiría una persona en
 * dos columnas. `""` dentro de un campo entrecomillado es una comilla.
 */
function partirLinea(linea: string, sep: string): string[] {
  const fuera: string[] = [];
  let actual = "";
  let dentro = false;
  for (let i = 0; i < linea.length; i += 1) {
    const c = linea[i]!;
    if (dentro) {
      if (c === '"') {
        if (linea[i + 1] === '"') {
          actual += '"';
          i += 1;
        } else {
          dentro = false;
        }
      } else {
        actual += c;
      }
    } else if (c === '"') {
      dentro = true;
    } else if (c === sep) {
      fuera.push(actual);
      actual = "";
    } else {
      actual += c;
    }
  }
  fuera.push(actual);
  return fuera.map((s) => s.trim());
}

/** «dd/mm/aaaa» → «YYYY-MM-DD». `null` si no es eso. */
export function fechaDeCsv(valor: string): string | null {
  const m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(valor.trim());
  if (!m) return null;
  const d = Number(m[1]);
  const mes = Number(m[2]);
  const y = Number(m[3]);
  if (mes < 1 || mes > 12 || d < 1 || d > 31) return null;
  // Y que el día exista de verdad: el 31/02 no es una fecha, y dejarlo
  // pasar guardaría un 3 de marzo en la ficha de alguien.
  const t = new Date(Date.UTC(y, mes - 1, d));
  if (t.getUTCMonth() !== mes - 1 || t.getUTCDate() !== d) return null;
  return `${y}-${String(mes).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** «37,5» o «37.5» → 2 250 minutos. `null` si no es un número razonable. */
export function jornadaDeCsv(valor: string): number | null {
  const limpio = valor.trim().replace(",", ".").replace(/\s*h\.?$/i, "");
  if (limpio === "") return null;
  const n = Number(limpio);
  if (!Number.isFinite(n) || n <= 0 || n > 60) return null;
  return Math.round(n * 60);
}

/** «indefinido», «fijo», «temporal», «eventual»… */
export function contratoDeCsv(valor: string): "INDEFINIDO" | "TEMPORAL" | null {
  const v = normalizarCabecera(valor);
  if (v === "") return null;
  if (["indefinido", "fijo", "fija", "indefinida"].includes(v)) {
    return "INDEFINIDO";
  }
  if (["temporal", "eventual", "obra_y_servicio", "interinidad", "interino"].includes(v)) {
    return "TEMPORAL";
  }
  return null;
}

/**
 * Lee el CSV. **No decide nada**: convierte texto en filas y señala las
 * que no se entienden. Qué hacer con ellas es `planDeImportacion`.
 *
 * Lo que aguanta, porque es lo que llega de verdad:
 *
 *   · **BOM** (U+FEFF) al principio, que es lo que pone Excel al
 *     exportar «CSV UTF-8» y lo que convierte la primera cabecera en
 *     `\ufeffnombre` — y con eso la columna del nombre no se reconocería;
 *   · separador `;` **o** `,`, detectado por cuál aparece más en la
 *     cabecera (un Excel español exporta con `;` porque la coma es el
 *     decimal);
 *   · finales de línea `\r\n`;
 *   · líneas en blanco en medio, que se saltan sin más.
 */
export function leerCsvDePersonal(texto: string): CsvDePersonal {
  const sinBom = texto.replace(/^\ufeff/, "");
  const lineas = sinBom.split(/\r?\n/);
  const cabecera = lineas.findIndex((l) => l.trim() !== "");
  if (cabecera === -1) {
    throw new CsvDePersonalInvalido(
      "El fichero está vacío. Tiene que traer una cabecera con los nombres de las columnas.",
    );
  }

  const linea0 = lineas[cabecera]!;
  const separador: ";" | "," =
    (linea0.match(/;/g)?.length ?? 0) >= (linea0.match(/,/g)?.length ?? 0)
      ? ";"
      : ",";

  const titulos = partirLinea(linea0, separador).map(normalizarCabecera);
  const columnas: Array<ColumnaDePersonal | null> = titulos.map(
    (t) => ALIAS[t] ?? null,
  );
  const reconocidas = columnas.filter((c): c is ColumnaDePersonal => c != null);
  if (!reconocidas.includes("nombre")) {
    throw new CsvDePersonalInvalido(
      `La cabecera no trae una columna «nombre». Las columnas que entiendo son: ${COLUMNAS_DE_PERSONAL.join(", ")}.`,
    );
  }

  const cuerpo = lineas
    .slice(cabecera + 1)
    .map((l, i) => ({ texto: l, linea: cabecera + 2 + i }))
    .filter((l) => l.texto.trim() !== "");

  if (cuerpo.length > MAX_FILAS_CSV) {
    throw new CsvDePersonalInvalido(
      `El fichero trae ${cuerpo.length} filas y de una vez caben ${MAX_FILAS_CSV}. ` +
        `Pártelo en varios y vuelve a subirlos.`,
    );
  }

  const filas: FilaDePersonal[] = [];
  const errores: ErrorDeFila[] = [];

  for (const { texto: cruda, linea } of cuerpo) {
    const celdas = partirLinea(cruda, separador);
    const valor = (col: ColumnaDePersonal): string | undefined => {
      const i = columnas.indexOf(col);
      if (i === -1) return undefined;
      return celdas[i] ?? "";
    };
    const texto = (col: ColumnaDePersonal): string | null | undefined => {
      const v = valor(col);
      if (v === undefined) return undefined;
      return v.trim() === "" ? null : v.trim();
    };

    const nombre = texto("nombre");
    if (nombre == null) {
      errores.push({
        linea,
        mensaje: `Fila ${linea}: no trae nombre, y el nombre es lo único obligatorio.`,
      });
      continue;
    }

    const fila: FilaDePersonal = { linea, nombre };
    let roto = false;
    const romper = (mensaje: string) => {
      errores.push({ linea, mensaje: `Fila ${linea}: ${mensaje}` });
      roto = true;
    };

    if (texto("apellidos") !== undefined) fila.apellidos = texto("apellidos");
    if (texto("dni_nie") !== undefined) fila.dniNie = texto("dni_nie");
    if (texto("num_afiliacion_ss") !== undefined) {
      fila.afiliacion = texto("num_afiliacion_ss");
    }
    if (texto("categoria") !== undefined) fila.categoria = texto("categoria");
    if (texto("telefono") !== undefined) fila.telefono = texto("telefono");
    if (texto("email") !== undefined) fila.email = texto("email");

    const jornada = texto("jornada_semanal_h");
    if (jornada !== undefined) {
      if (jornada === null) fila.minutosSemanales = null;
      else {
        const min = jornadaDeCsv(jornada);
        if (min == null) {
          romper(
            `«${jornada}» no es una jornada semanal. Escríbela en horas, como «37,5» o «40».`,
          );
        } else fila.minutosSemanales = min;
      }
    }

    for (const [col, campo, etiqueta] of [
      ["fecha_alta", "fechaDeAlta", "fecha de alta"],
      ["fecha_fin", "fechaDeFin", "fecha de fin"],
    ] as const) {
      const v = texto(col);
      if (v === undefined) continue;
      if (v === null) {
        fila[campo] = null;
        continue;
      }
      const iso = fechaDeCsv(v);
      if (iso == null) {
        romper(
          `la ${etiqueta} «${v}» no está en formato dd/mm/aaaa. Así, «01/06/2026».`,
        );
      } else fila[campo] = iso;
    }

    const contrato = texto("tipo_contrato");
    if (contrato !== undefined) {
      if (contrato === null) fila.tipoDeContrato = null;
      else {
        const t = contratoDeCsv(contrato);
        if (t == null) {
          romper(
            `«${contrato}» no es un tipo de contrato. Pon «indefinido» o «temporal».`,
          );
        } else fila.tipoDeContrato = t;
      }
    }

    // Y la coherencia que la base también exige, dicha aquí para que se
    // lea en la vista previa y no como un 500 al aplicar.
    if (
      !roto &&
      fila.fechaDeFin != null &&
      fila.tipoDeContrato != null &&
      fila.tipoDeContrato !== "TEMPORAL"
    ) {
      romper(
        "trae fecha de fin y el contrato es indefinido. La fecha de fin es sólo de los temporales.",
      );
    }
    if (
      !roto &&
      fila.fechaDeFin != null &&
      fila.fechaDeAlta != null &&
      fila.fechaDeFin < fila.fechaDeAlta
    ) {
      romper("la fecha de fin es anterior a la de alta.");
    }

    if (!roto) filas.push(fila);
  }

  return { separador, columnas: reconocidas, filas, errores };
}

// ── Casar y planificar ───────────────────────────────────────────────

/** Lo que hace falta saber de una ficha que ya existe para casarla. */
export interface FichaExistente {
  employeeId: string;
  /** Lo que hay en `employees.name`, que puede ser el nombre completo. */
  name: string;
  lastName: string | null;
  tieneDni: boolean;
  tieneAfiliacion: boolean;
  categoryId: string | null;
  weeklyMinutes: number | null;
  hiredOn: string | null;
  contractKind: string | null;
  contractEndsOn: string | null;
  phone: string | null;
  email: string | null;
}

/** El catálogo de categorías del centro, para casar la columna de texto. */
export interface CategoriaConocida {
  id: string;
  code: string;
  name: string;
}

export type QueHacerConLaFila =
  /** Casa con una ficha y le cambia algo. */
  | "COMPLETAR"
  /** Casa con una ficha y no le cambia nada: ya está todo puesto. */
  | "SIN_CAMBIOS"
  /** No casa con nadie: se crea. */
  | "CREAR"
  /** No se puede aplicar, y el porqué va en `motivo`. */
  | "ERROR";

/** Un campo que la importación va a cambiar, para la vista previa. */
export interface CambioDeCampo {
  campo: string;
  /** Qué hay ahora. `null` = nada. Los cifrados van como `"•••"`. */
  antes: string | null;
  /** Y qué quedará. */
  despues: string;
}

export interface AccionDeImportacion {
  linea: number;
  /** Como se va a enseñar: «Abel Ramos Doblado». */
  nombreCompleto: string;
  que: QueHacerConLaFila;
  /** Con quién casó, si casó. */
  employeeId: string | null;
  /** Qué ficha casó, por su nombre, para que se lea «completa la ficha de X». */
  casaCon: string | null;
  cambios: CambioDeCampo[];
  motivo?: string;
  /** La fila entendida, para que `aplicar` no vuelva a parsear. */
  fila: FilaDePersonal;
  /** La categoría que casó, si la columna venía y se reconoció. */
  categoryId?: string | null;
}

export interface PlanDeImportacion {
  acciones: AccionDeImportacion[];
  resumen: {
    completar: number;
    sinCambios: number;
    crear: number;
    errores: number;
  };
  /** Los errores de lectura más los de casado, juntos y por línea. */
  errores: ErrorDeFila[];
}

/** La clave con la que se casa: nombre + apellidos, normalizado. */
export function claveDeFila(fila: FilaDePersonal): string {
  return claveDeNombre(`${fila.nombre} ${fila.apellidos ?? ""}`);
}

/**
 * Y la de una ficha que ya existe.
 *
 * `name + lastName` y no sólo `name`: es lo que hace que las 21 fichas de
 * Jardín de Gredos —creadas por F1 con el nombre completo dentro de `name`
 * y sin apellidos— casen con un CSV que trae «Abel» y «Ramos Doblado» en
 * dos columnas. Y sigue casando después de completarlas, cuando el nombre
 * esté partido en dos: la clave es la misma cadena.
 */
export function claveDeFicha(ficha: {
  name: string;
  lastName: string | null;
}): string {
  return claveDeNombre(`${ficha.name} ${ficha.lastName ?? ""}`);
}

/** Cómo se enseña una categoría escrita en el CSV. */
function casarCategoria(
  texto: string,
  catalogo: CategoriaConocida[],
): CategoriaConocida | null {
  const clave = claveDeNombre(texto);
  return (
    catalogo.find((c) => claveDeNombre(c.code) === clave) ??
    catalogo.find((c) => claveDeNombre(c.name) === clave) ??
    null
  );
}

/**
 * **El plan.** Fila a fila: «completa la ficha de X», «crea a Y», «no
 * entiendo esta fila y por qué».
 *
 * Y las tres garantías del bloque, que viven aquí:
 *
 *   · **nunca vacía** un campo con valor porque la celda venga vacía (ni
 *     porque la columna no venga);
 *   · **idempotente**: si no cambia nada, la acción es `SIN_CAMBIOS` y
 *     `aplicar` no escribe;
 *   · **dos filas con el mismo nombre** no crean dos personas: la segunda
 *     es un error que la nombra.
 */
export function planDeImportacion(
  csv: CsvDePersonal,
  existentes: FichaExistente[],
  catalogo: CategoriaConocida[] = [],
): PlanDeImportacion {
  const porClave = new Map<string, FichaExistente>();
  for (const f of existentes) {
    const k = claveDeFicha(f);
    // Si el centro ya tiene dos fichas con el mismo nombre normalizado,
    // gana la primera y la fila se marcará como ambigua al casar. No se
    // elige a ciegas.
    if (!porClave.has(k)) porClave.set(k, f);
  }
  const repetidasEnLaCasa = new Set(
    existentes
      .map(claveDeFicha)
      .filter((k, i, todas) => todas.indexOf(k) !== i),
  );

  const acciones: AccionDeImportacion[] = [];
  const errores: ErrorDeFila[] = [...csv.errores];
  const vistas = new Map<string, number>();

  for (const fila of csv.filas) {
    const clave = claveDeFila(fila);
    const nombreCompleto = `${fila.nombre}${fila.apellidos ? ` ${fila.apellidos}` : ""}`;

    const anterior = vistas.get(clave);
    if (anterior != null) {
      const mensaje = `Fila ${fila.linea}: «${nombreCompleto}» ya venía en la fila ${anterior}. Se queda la primera.`;
      errores.push({ linea: fila.linea, mensaje });
      acciones.push({
        linea: fila.linea,
        nombreCompleto,
        que: "ERROR",
        employeeId: null,
        casaCon: null,
        cambios: [],
        motivo: mensaje,
        fila,
      });
      continue;
    }
    vistas.set(clave, fila.linea);

    if (repetidasEnLaCasa.has(clave)) {
      const mensaje = `Fila ${fila.linea}: hay más de una ficha llamada «${nombreCompleto}» y no sé a cuál te refieres. Distínguelas en Empleados y vuelve a importar.`;
      errores.push({ linea: fila.linea, mensaje });
      acciones.push({
        linea: fila.linea,
        nombreCompleto,
        que: "ERROR",
        employeeId: null,
        casaCon: null,
        cambios: [],
        motivo: mensaje,
        fila,
      });
      continue;
    }

    // La categoría, si la columna venía.
    let categoryId: string | null | undefined;
    if (fila.categoria !== undefined) {
      if (fila.categoria === null) categoryId = null;
      else {
        const cat = casarCategoria(fila.categoria, catalogo);
        if (!cat) {
          const mensaje = `Fila ${fila.linea}: la categoría «${fila.categoria}» no está en el catálogo del centro. Créala en Empleados → Categorías y vuelve a importar.`;
          errores.push({ linea: fila.linea, mensaje });
          acciones.push({
            linea: fila.linea,
            nombreCompleto,
            que: "ERROR",
            employeeId: null,
            casaCon: null,
            cambios: [],
            motivo: mensaje,
            fila,
          });
          continue;
        }
        categoryId = cat.id;
      }
    }

    const ficha = porClave.get(clave);
    const cambios = ficha
      ? cambiosSobre(ficha, fila, categoryId, catalogo)
      : cambiosDeAlta(fila, categoryId, catalogo);

    acciones.push({
      linea: fila.linea,
      nombreCompleto,
      que: ficha
        ? cambios.length > 0
          ? "COMPLETAR"
          : "SIN_CAMBIOS"
        : "CREAR",
      employeeId: ficha?.employeeId ?? null,
      casaCon: ficha ? `${ficha.name}${ficha.lastName ? ` ${ficha.lastName}` : ""}` : null,
      cambios,
      fila,
      categoryId,
    });
  }

  return {
    acciones,
    resumen: {
      completar: acciones.filter((a) => a.que === "COMPLETAR").length,
      sinCambios: acciones.filter((a) => a.que === "SIN_CAMBIOS").length,
      crear: acciones.filter((a) => a.que === "CREAR").length,
      errores: acciones.filter((a) => a.que === "ERROR").length,
    },
    errores: errores.sort((a, b) => a.linea - b.linea),
  };
}

/** Lo que se enseña de un cifrado en la vista previa. Nunca el valor. */
const OCULTO = "•••";

/**
 * **El plan sin los datos que no pueden salir del servidor.**
 *
 * `AccionDeImportacion.fila` lleva la fila cruda porque el servidor la
 * necesita para aplicar sin volver a parsear — y la fila cruda lleva el
 * DNI y el nº de afiliación **en claro**. Devolver el plan tal cual a la
 * vista previa mandaría veintiún DNI al navegador para pintar una tabla
 * que no los enseña, y de ahí a los logs de Caddy o a una captura de
 * pantalla.
 *
 * Esta función es la frontera, y la ruta de la vista previa pasa por aquí
 * SIEMPRE. Lo que se cae es `fila` entera: la pantalla no necesita ni un
 * campo de ella (lo que pinta son `cambios`, que ya traen el `•••`).
 *
 * Lo encontró un test, no una revisión: `JSON.stringify(plan)` contenía
 * «12345678Z».
 */
export function planParaLaPantalla(plan: PlanDeImportacion): {
  acciones: Array<Omit<AccionDeImportacion, "fila">>;
  resumen: PlanDeImportacion["resumen"];
  errores: ErrorDeFila[];
} {
  return {
    acciones: plan.acciones.map(({ fila: _fila, ...resto }) => resto),
    resumen: plan.resumen,
    errores: plan.errores,
  };
}

/**
 * Qué campos cambia esta fila sobre una ficha que ya existe.
 *
 * La regla de oro está en las dos primeras líneas de cada rama: **si la
 * celda no trae nada, no se toca nada.** Lo que viene detrás es sólo si
 * cambia el valor.
 */
function cambiosSobre(
  ficha: FichaExistente,
  fila: FilaDePersonal,
  categoryId: string | null | undefined,
  catalogo: CategoriaConocida[],
): CambioDeCampo[] {
  const fuera: CambioDeCampo[] = [];
  const texto = (
    campo: string,
    nuevo: string | null | undefined,
    actual: string | null,
  ) => {
    if (nuevo == null) return; // no venía, o venía vacía: no se toca
    if (actual != null && actual.trim() === nuevo.trim()) return;
    fuera.push({ campo, antes: actual, despues: nuevo });
  };

  // ── El nombre, que es el caso de Jardín de Gredos ────────────────
  //
  // La ficha tiene «ABEL RAMOS DOBLADO» en `name` y nada en `lastName`; el
  // CSV trae «Abel» y «Ramos Doblado». Casan por la clave, y al completar
  // **se separan**: `name` pasa a ser «Abel» y `lastName` «Ramos
  // Doblado». No es renombrar a nadie: es partir en dos lo que estaba en
  // uno, que es lo que la decisión 3 pide.
  if (fila.apellidos != null) {
    if ((ficha.lastName ?? "") !== fila.apellidos) {
      fuera.push({ campo: "apellidos", antes: ficha.lastName, despues: fila.apellidos });
    }
    if (ficha.name !== fila.nombre) {
      fuera.push({ campo: "nombre", antes: ficha.name, despues: fila.nombre });
    }
  }

  // Los dos cifrados: se cambia si la celda trae algo Y la columna está
  // vacía. **Un DNI que ya está NO se sobrescribe**, y es deliberado: para
  // saber si el del fichero es otro habría que descifrar el que hay, y
  // descifrar 21 DNI para una vista previa es sacar a pasear veintiuna
  // claves por nada. Si uno está mal, se corrige en la ficha.
  if (fila.dniNie != null && !ficha.tieneDni) {
    fuera.push({ campo: "dni", antes: null, despues: OCULTO });
  }
  if (fila.afiliacion != null && !ficha.tieneAfiliacion) {
    fuera.push({ campo: "afiliacion", antes: null, despues: OCULTO });
  }

  if (categoryId != null && ficha.categoryId !== categoryId) {
    const cat = catalogo.find((c) => c.id === categoryId);
    fuera.push({
      campo: "categoria",
      antes: catalogo.find((c) => c.id === ficha.categoryId)?.name ?? null,
      despues: cat?.name ?? categoryId,
    });
  }
  if (
    fila.minutosSemanales != null &&
    ficha.weeklyMinutes !== fila.minutosSemanales
  ) {
    fuera.push({
      campo: "jornadaSemanal",
      antes: ficha.weeklyMinutes == null ? null : horasDe(ficha.weeklyMinutes),
      despues: horasDe(fila.minutosSemanales),
    });
  }
  texto("fechaDeAlta", fila.fechaDeAlta, ficha.hiredOn);
  texto("tipoDeContrato", fila.tipoDeContrato, ficha.contractKind);
  texto("finPrevisto", fila.fechaDeFin, ficha.contractEndsOn);
  texto("telefono", fila.telefono, ficha.phone);
  texto("email", fila.email, ficha.email);
  return fuera;
}

/** Y los de un alta: todo lo que la fila trae. */
function cambiosDeAlta(
  fila: FilaDePersonal,
  categoryId: string | null | undefined,
  catalogo: CategoriaConocida[],
): CambioDeCampo[] {
  const vacia: FichaExistente = {
    employeeId: "",
    name: fila.nombre,
    lastName: null,
    tieneDni: false,
    tieneAfiliacion: false,
    categoryId: null,
    weeklyMinutes: null,
    hiredOn: null,
    contractKind: null,
    contractEndsOn: null,
    phone: null,
    email: null,
  };
  // Con `name` ya puesto al nombre de la fila, `cambiosSobre` no saca un
  // cambio de «nombre» que en un alta no significa nada.
  return cambiosSobre(vacia, fila, categoryId, catalogo);
}

/** 2 250 → «37,5 h». */
function horasDe(min: number): string {
  return `${String(Math.round((min / 60) * 10) / 10).replace(".", ",")} h`;
}
