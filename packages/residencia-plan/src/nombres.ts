// alta-minima · **LOS NOMBRES DEL LISTADO QUE LLEGA EL PRIMER DÍA.**
//
// El listado de Jardín de Gredos llegó así: 43 líneas con el nombre en
// mayúsculas y el tipo de plaza al lado, copiadas de una columna de Excel.
// Esto es lo que lo convierte en residentes.
//
// ── POR QUÉ ESTÁ EN EL PAQUETE PURO ────────────────────────────────
//
// Porque la **vista previa** del admin y la **idempotencia** del servidor
// tienen que decidir lo mismo. La pantalla enseña «éstos 40 se crean,
// éstos 3 ya existen» y el servidor crea 40 y salta 3: si cada uno
// normalizara los nombres a su manera, la vista previa mentiría —y lo
// haría sólo en los casos raros, que son los que nadie prueba a mano
// («Mª ÁNGELES  LÓPEZ» con dos espacios).
//
// Y es puro de verdad: ni reloj, ni base, ni `Intl`.

/**
 * **La clave con la que se decide si dos nombres son el mismo.**
 *
 * Sin tildes, sin mayúsculas y sin dobles espacios. Es la normalización
 * que el bloque declara: «mismo nombre normalizado (sin tildes,
 * mayúsculas ni dobles espacios)».
 *
 * `NFD` + quitar los diacríticos y no una tabla de `á→a`: la tabla se
 * olvida de la `ü` de «Begoña Agüero» el día que llegue.
 *
 * Lo que esto NO hace es intentar entender el nombre. «RAMOS DOBLADO,
 * ABEL» y «ABEL RAMOS DOBLADO» son dos personas distintas para esta
 * función, y es a propósito: adivinar el orden de los apellidos de una
 * línea de Excel es exactamente lo que la decisión 7 del bloque se niega
 * a hacer. Un duplicado que se cuela se arregla en la ficha; un residente
 * que se fusiona con otro por un apellido parecido parte dos historias.
 */
export function claveDeNombre(linea: string): string {
  return linea
    .normalize("NFD")
    // `\u0300-\u036f` es el bloque de diacríticos combinantes: lo que NFD
    // acaba de separar de su letra. Escapados y no literales: un acento
    // suelto en el código fuente es invisible y lo borra el primer editor
    // que normalice el fichero.
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleUpperCase("es-ES")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * «ABEL RAMOS DOBLADO» → «Abel Ramos Doblado».
 *
 * **Para ENSEÑAR, nunca para guardar** (decisión 7: los nombres en
 * mayúsculas se guardan como vienen). El listado viene en mayúsculas
 * porque el Excel del centro está en mayúsculas, y una lista de 43
 * residentes a gritos es ilegible; pero convertirlo al guardar perdería
 * el dato original, y el original es lo que coincide con el papel que la
 * dirección tiene delante.
 *
 * Sólo actúa si la línea **no tiene ninguna minúscula**. Un nombre ya
 * escrito a mano («Mª Ángeles de la Torre») se deja exactamente como
 * está: tocarlo convertiría «de la Torre» en «De La Torre», que está peor
 * que el original.
 *
 * Las partículas se quedan en minúscula por lo mismo: «ABEL DE LA FUENTE»
 * → «Abel de la Fuente», que es como se escribe en español.
 */
const PARTICULAS = new Set([
  "de",
  "del",
  "la",
  "las",
  "los",
  "el",
  "y",
  "e",
  "da",
  "do",
  "dos",
  "van",
  "von",
  "di",
]);

export function enFormatoDeNombre(nombre: string): string {
  const limpio = nombre.replace(/\s+/g, " ").trim();
  if (limpio === "") return "";
  // ¿Tiene alguna minúscula? Entonces alguien lo escribió a mano: no se
  // toca. `toLocaleLowerCase` y comparar es la forma de preguntarlo sin
  // una clase de caracteres que se olvide de la `Ñ`.
  if (limpio !== limpio.toLocaleUpperCase("es-ES")) return limpio;
  return limpio
    .split(" ")
    .map((palabra, i) => {
      const baja = palabra.toLocaleLowerCase("es-ES");
      // La primera palabra SIEMPRE con mayúscula, aunque sea una
      // partícula: «DEL RÍO MUÑOZ» empieza por «Del».
      if (i > 0 && PARTICULAS.has(baja)) return baja;
      // `Mª`, `Dª`: la letra volada no es una inicial.
      return baja.charAt(0).toLocaleUpperCase("es-ES") + baja.slice(1);
    })
    .join(" ");
}

/** Una línea del cuadro de «Añadir varios», ya partida. */
export interface LineaPegada {
  /** Qué número de línea era, contando las vacías. Para el mensaje. */
  numero: number;
  nombre: string;
  /** El tipo de plaza si la línea traía uno, tras el tabulador. */
  placeType: string | null;
  /** La clave de duplicado. */
  clave: string;
}

/** Lo que `lineasPegadas` no pudo usar, con el por qué. */
export interface LineaRota {
  numero: number;
  texto: string;
  motivo: string;
}

export interface NombresPegados {
  lineas: LineaPegada[];
  /** Las que traían algo pero no un nombre utilizable. */
  rotas: LineaRota[];
  /** Repetidas DENTRO del propio pegado, saltadas tras la primera. */
  repetidasEnElPegado: LineaPegada[];
}

/**
 * Parte lo que alguien pega en el cuadro de «Añadir varios».
 *
 * Un nombre por línea, y **un tipo de plaza opcional detrás de un
 * tabulador**, que es lo que sale de copiar dos columnas de Excel. Nada
 * de CSV con comas: una coma en «RAMOS DOBLADO, ABEL» partiría el nombre
 * en dos, y ese formato es más común en un listado de residencia que el
 * CSV.
 *
 * ── Lo que tira y por qué no es un error de la pantalla ────────────
 *
 *   · **Las líneas vacías se ignoran en silencio.** Copiar una columna de
 *     Excel arrastra la línea en blanco del final casi siempre, y
 *     contestar «la línea 44 está vacía» a quien acaba de pegar bien 43
 *     nombres es un aviso que enseña a no leer los avisos.
 *   · **Un tabulador suelto sin nombre delante** sí se cuenta como rota:
 *     ahí hay una celda que alguien creía que tenía algo.
 *   · **El tipo de plaza NO se valida aquí.** Esta función es pura y no
 *     conoce el enum de la base; devuelve el texto en mayúsculas y el
 *     servidor decide. Lo contrario sería la lista de plazas en dos
 *     sitios.
 *
 * El límite de líneas NO está aquí: lo pone quien llama (la ruta lo
 * necesita para contestar un 400 con su mensaje, y la pantalla para
 * avisar antes de mandar). Meterlo aquí haría que el parser decidiera un
 * código HTTP.
 */
export function lineasPegadas(texto: string): NombresPegados {
  const lineas: LineaPegada[] = [];
  const rotas: LineaRota[] = [];
  const repetidasEnElPegado: LineaPegada[] = [];
  const vistas = new Set<string>();

  // `\r\n`, `\n` y `\r`: pegar desde Excel en Windows trae los tres según
  // el navegador.
  const crudas = texto.split(/\r\n|\n|\r/);
  for (let i = 0; i < crudas.length; i += 1) {
    const cruda = crudas[i]!;
    const numero = i + 1;
    if (cruda.trim() === "") continue;
    const [primera, segunda] = cruda.split("\t");
    const nombre = (primera ?? "").replace(/\s+/g, " ").trim();
    if (nombre === "") {
      rotas.push({
        numero,
        texto: cruda.trim(),
        motivo: "no trae nombre, sólo el tipo de plaza",
      });
      continue;
    }
    const plaza = (segunda ?? "").trim();
    const linea: LineaPegada = {
      numero,
      nombre,
      placeType: plaza === "" ? null : plaza.toLocaleUpperCase("es-ES"),
      clave: claveDeNombre(nombre),
    };
    if (vistas.has(linea.clave)) {
      repetidasEnElPegado.push(linea);
      continue;
    }
    vistas.add(linea.clave);
    lineas.push(linea);
  }

  return { lineas, rotas, repetidasEnElPegado };
}
