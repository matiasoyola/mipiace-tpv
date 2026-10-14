// kds-1-cocina · EL REPARTO DE TARJETAS, en una función pura.
//
// Tres de las decisiones más concretas del bloque viven aquí:
//
//   · **Orden de LECTURA, no por columnas** (decisión 7, corrección del
//     08-10 al ver la maqueta): las tarjetas se colocan como se lee un
//     libro, de izquierda a derecha y después la fila de abajo. Esto lo
//     garantiza el ORDEN DEL DOM —una lista ordenada pintada en una
//     cuadrícula—, así que su sabotaje («las 4 primeras en el DOM son las
//     4 más antiguas») se comprueba sobre el array.
//   · **Y LA ORDENA LA PANTALLA**, no el servidor (kds-1c): el reparto
//     empieza por `ordenarParaLaPantalla` y nadie más ordena. Ver su
//     comentario.
//   · **CUATRO columnas a 1280 px**, que es lo que dibuja la maqueta. Era
//     el cuarto defecto de kds-1b: con tres sólo caben 3 comandas por
//     fila y se escondían mesas que cabían.
//   · **Una tarjeta que no cabe entera NO SE CORTA** y pasa a la franja
//     vertical del borde, con el «+N» y las mesas.
//   · **SE LLENA POR ORDEN Y SE CORTA EN LA PRIMERA QUE NO CABE**
//     (kds-1d), no por filas enteras: una comanda larga ya no se lleva por
//     delante a las cortas que caben detrás de ella. Ver `repartirTarjetas`.
//
// ── POR QUÉ SE ESTIMA LA ALTURA EN VEZ DE MEDIRLA ─────────────────────
//
// Medir con el DOM obligaría a pintar las tarjetas para preguntarles su
// alto y volver a pintarlas: dos pasadas, un parpadeo visible en cada
// cambio, y un fallo imposible de reproducir en un test sin navegador.
//
// Así que la altura se CALCULA de los tokens, con el mismo criterio que
// `hospitalityGrid.ts` usa para la cuadrícula de productos: alturas fijas
// por pieza, sumadas. La estimación se hace **por lo alto** a propósito
// (`MARGEN_SEGURIDAD_PX`): si sobra, la última tarjeta se va al «+N» y el
// cocinero la ve en la franja; si faltase, se cortaría, que es lo que la
// decisión 7 prohíbe. El error prudente es el que deja sitio.

import {
  CANTIDAD_ANCHO_PX,
  EYEBROW_COCINA_PX,
  FRANJA_URGENTE_ALTO_PX,
  LINEA_HEIGHT_PX,
  LISTA_HEIGHT_PX,
  MESA_PX,
  NOTA_PX,
  PLATO_PX,
  TARJETA_ANCHO_PX,
  TARJETA_HUECO_PX,
} from "./kitchenTheme.js";
import { tonoSemaforo, minutosDesdeMarchado, type UmbralesSemaforo } from "./kitchenSemaforo.js";

/** Lo que el reparto necesita saber de una tarjeta. Nada más. */
export interface TarjetaMedible {
  id: string;
  tableName: string | null;
  number: number;
  urgent: boolean;
  isNew: boolean;
  /** De dónde cuenta el semáforo. Lo usa el color de la franja «+N». */
  firedAt: string | null;
  /** «LLEGÓ TARDE» en el eyebrow, que ocupa su línea. */
  lateArrival: boolean;
  /** Sólo importa CUÁNTAS son: cada franja mide lo mismo. */
  allergyBands: readonly unknown[];
  lines: Array<{
    /** El nombre, para saber en cuántas líneas se va a partir. */
    name: string;
    notes: string[];
    /** La pastilla «lleva gluten», que va bajo el nombre. */
    carries: string[];
    allergyWarning: string | null;
    seat: number | null;
    voidPending: boolean;
    changePending: boolean;
    fired: boolean;
  }>;
}

// ── LAS PIEZAS, CALIBRADAS CONTRA EL NAVEGADOR ───────────────────────
//
// No son números a ojo: salen del bucle visual
// (`docs/blocks/kds-1-cocina-shots/banco.mjs`, campo `alturasReales`), que
// mide la altura de cada tarjeta PINTADA a 1280 × 800 y la compara con lo
// que devuelve `altoTarjeta`.
//
// Y se quedan POR ENCIMA a propósito, con el margen justo: pasarse de
// generoso cuesta una fila entera de tarjetas (a 716 px de alto, 12 px de
// más en el pie son cuatro comandas menos en pantalla).

/** Padding arriba + abajo de la lista de platos. La maqueta: `10px 0`. */
const PADDING_PX = 20;

/** El hueco entre dos platos. */
const HUECO_LINEA_PX = 6;

/**
 * La cabecera del semáforo: mesa y minutos en grande.
 *
 * `10 + 10` de padding más la mesa (34, `line-height: 1`). **Medido en el
 * navegador: 54.**
 */
const CABECERA_PX = 20 + MESA_PX;

/**
 * La línea del eyebrow —«2ª COMANDA» / la sección / «LLEGÓ TARDE»—, que
 * la maqueta pone DENTRO de la cabecera y no debajo.
 *
 * Se cuenta SÓLO si esta tarjeta lo lleva. Contarlo siempre costaba 19 px
 * por tarjeta, y 19 px × 2 filas es exactamente lo que separa «caben ocho
 * comandas» de «caben cuatro».
 */
const EYEBROW_LINEA_PX = 19;

/** La franja «URGENTE», más los 8 del anillo de 4 px que la rodea. */
const FRANJA_URGENTE_PX = FRANJA_URGENTE_ALTO_PX + 8;

/**
 * Cada franja de alergia de la mesa: `10 + 10` de padding más sus dos
 * líneas («SILLA 3 · CELÍACO» a 21 con `line-height: 1.1` y «Gluten» a
 * 15). El icono mide 26 y cabe dentro. **Medido: 65,6.**
 */
const FRANJA_ALERGIA_PX = 68;

/** Una nota o un modificador bajo un plato: 17 px y 2 de margen. */
const NOTA_LINEA_PX = Math.round(NOTA_PX * 1.3) + 2;

/** La pastilla «lleva gluten», con su margen de 4. */
const CARRIES_LINEA_PX = 30;

/** «ANULADO» / «ERAN 3 · −1», que va bajo el nombre del plato. */
const ANULADO_LINEA_PX = Math.round(16 * 1.3) + 2;

/**
 * La sub-franja del recuadro de un plato de silla: «SILLA 3 · SIN
 * GLUTEN». `4 + 4` de padding, 13 px de texto y los 4 del borde de 2 px
 * que lleva el recuadro arriba y abajo. **Medido: 31,5.**
 *
 * Vale igual para el plato que CHOCA: su caja no lleva borde, así que mide
 * 28, y estimar 32 se queda por el lado seguro.
 */
const SILLA_LINEA_PX = 32;

/** El encabezado «EN ESPERA · SALE CUANDO LO MARCHEN», con su filete. */
const BLOQUE_ESPERA_PX = 8 + 2 + Math.round(EYEBROW_COCINA_PX * 1.3) + 8;

/** El botón «Lista» del pie, con su margen inferior de 14. Medido: 70. */
const PIE_PX = LISTA_HEIGHT_PX + 14;

/**
 * Lo que se añade a cada tarjeta para no cortarla nunca.
 *
 * 12 px: el redondeo de las piezas de arriba y el respiro de una línea
 * que mida un pelo más que lo estimado. Más sería dejar hueco visible al
 * final de cada fila; menos sería apostar a que ninguna pieza se pasa.
 *
 * El bucle visual comprueba que `altoTarjeta` queda por encima del alto
 * REAL de cada tarjeta pintada. El `-done` lleva los números.
 */
const MARGEN_SEGURIDAD_PX = 12;

/**
 * **CUÁNTOS CARACTERES DE NOMBRE CABEN EN UNA LÍNEA.**
 *
 * Con cuatro columnas la tarjeta mide ~251 px, y al nombre le quedan
 * 251 − 28 (padding) − 30 (la cantidad) − 10 (el hueco) = ~183 px. A 22 px
 * y peso 600, DM Sans gasta ~0,52 em por carácter de media en castellano,
 * o sea ~11,4 px: **16 caracteres por línea**.
 *
 * El bucle visual lo comprueba de verdad: mide
 * `getClientRects().length` del `<span>` del nombre, que es EN CUÁNTAS
 * LÍNEAS se partió. Con los nombres de la carta de La Maestranza
 * —«Ensaladilla rusa» y «Magro con tomate», los dos de 16— ninguno se
 * parte, así que el número está calibrado justo en el límite y por eso la
 * estimación lleva su margen encima.
 *
 * Lo que NO se hace es truncar: el nombre del plato es lo primero que la
 * decisión 3 manda que se lea, y «Croquetas de jamón (sin gluten)» leído
 * «Croquetas de jamó…» es un plato distinto.
 */
const CHARS_POR_LINEA = Math.max(
  6,
  Math.floor(
    (TARJETA_ANCHO_PX - 28 - CANTIDAD_ANCHO_PX - 10) / (PLATO_PX * 0.52),
  ),
);

/**
 * El alto de una línea de plato.
 *
 * **El relleno vive DENTRO del mínimo táctil**, porque el botón tiene
 * `box-sizing: border-box`: un plato de una línea mide 56 justos, y sólo
 * crece cuando lo que lleva dentro —nombre partido, notas, «ERAN 3 · −1»,
 * la pastilla «lleva gluten»— pasa de 40. Puesto fuera, como estaba en la
 * primera versión de kds-1b, cada plato medía 72 y tres platos por tarjeta
 * costaban la segunda fila entera.
 */
function altoLinea(l: TarjetaMedible["lines"][number]): number {
  // Dentro de un recuadro de silla caben DOS caracteres menos: el marco de
  // 2 px y los 10 de margen le quitan 16 px al nombre. Medido — «Magro con
  // tomate» entra en una línea en una tarjeta normal y se parte en dos
  // dentro del recuadro de la silla 3.
  const enRecuadro = l.seat != null || l.allergyWarning != null;
  const cabenEnLinea = CHARS_POR_LINEA - (enRecuadro ? 2 : 0);
  const lineasDeNombre = Math.max(1, Math.ceil(l.name.length / cabenEnLinea));
  const dentro =
    lineasDeNombre * Math.ceil(PLATO_PX * 1.2) +
    l.notes.length * NOTA_LINEA_PX +
    (l.carries.length > 0 && l.allergyWarning == null ? CARRIES_LINEA_PX : 0) +
    (l.voidPending || l.changePending ? ANULADO_LINEA_PX : 0);
  // `8 + 8` de relleno vertical, dentro del mínimo.
  return Math.max(LINEA_HEIGHT_PX, 16 + dentro);
}

/**
 * La altura que ocupará esta tarjeta. Estimada por lo alto.
 *
 * `mostrarSeccion` es lo mismo que la prop del componente: con más de una
 * sección en pantalla, TODAS las tarjetas llevan el eyebrow.
 */
export function altoTarjeta(t: TarjetaMedible, mostrarSeccion = false): number {
  let alto = PADDING_PX + CABECERA_PX;
  if (t.number > 1 || t.lateArrival || mostrarSeccion) alto += EYEBROW_LINEA_PX;
  if (t.urgent) alto += FRANJA_URGENTE_PX;
  alto += t.allergyBands.length * FRANJA_ALERGIA_PX;
  const hayEspera = t.lines.some((l) => !l.fired);
  if (hayEspera) alto += BLOQUE_ESPERA_PX;
  alto += Math.max(0, t.lines.length - 1) * HUECO_LINEA_PX;
  for (const l of t.lines) {
    alto += altoLinea(l);
    // La sub-franja del recuadro, tanto la de «SILLA 3 · SIN GLUTEN» como
    // la del plato que choca.
    if (l.seat != null || l.allergyWarning != null) alto += SILLA_LINEA_PX;
  }
  alto += PIE_PX;
  return alto + MARGEN_SEGURIDAD_PX;
}

/**
 * **CUÁNTAS COMANDAS CABEN DE VERDAD.**
 *
 * La decisión 7 pide «unas 8 comandas normales en 1280 × 800 sin
 * desplazar». Con los tokens de la maqueta **entran las 8**: cuatro
 * columnas por dos filas. Con los de la primera versión del bloque —tres
 * columnas de 320 px— entraban 6, y eso era el cuarto defecto de kds-1b.
 *
 * La aritmética, con la zona de CONTENIDO a 1280 × 800 (1036 × 716: 1280
 * − 160 de «Listas» − 60 de la franja del indicador − 24 del padding;
 * 800 − 60 de la barra superior − 24 del padding):
 *
 *   tarjeta de TRES platos de nombre corto, estimada
 *     = 20 (padding) + 73 (cabecera) + 3 × 56 + 70 (pie) + 12 = 343 px
 *   dos filas = 343 × 2 + 10 = 696 ≤ 716  →  2 × 4 = **8 tarjetas**
 *   tres filas = 343 × 3 + 20 = 1.049  →  no cabe
 *
 * Y una comanda con alergia por silla ocupa más (la franja de dos líneas,
 * el recuadro de cada plato de la silla y el «¡LLEVA GLUTEN!»): con una de
 * ésas en pantalla caben menos. Es correcto — esa tarjeta es la que hay
 * que leer entera.
 */
export const TARJETAS_NORMALES_A_1280 = 8;

/**
 * **LA PANTALLA ORDENA SOLA.** (kds-1c)
 *
 * Venga como venga la lista del servidor. Lo pide la decisión 7 —«el
 * cocinero tiene que ver primero lo que más espera»— y la primera captura
 * de kds-1b enseñó por qué no basta con que el servidor lo intente: pintaba
 * T4 → M5 → M1 → **M2**, y en el «+7» quedaba escondida la M4 con 26
 * minutos mientras la M1 con 4 se veía. Eso es exactamente lo que la
 * decisión 7 quiere impedir.
 *
 * Tres criterios, en este orden:
 *
 *   1. **las urgentes primero.** Es una decisión del camarero, y pesa más
 *      que el reloj: «esta mesa tiene prisa» no se discute con minutos.
 *   2. **por la MARCA DE MARCHA, de la más antigua a la más nueva.** Es la
 *      MISMA que pinta los minutos (`firedAt`, ver `kitchenSemaforo.ts`), y
 *      por eso no puede ser `sentAt`: un tiempo 2 enviado hace media hora y
 *      marchado hace uno pinta «1 min», y ordenado por el envío se colaría
 *      delante de una mesa que lleva veinte esperando de verdad. **La
 *      pantalla se ordena por lo que la pantalla DICE.**
 *   3. **por el id**, para que dos tarjetas con la misma marca no se
 *      intercambien de sitio entre dos repintados. Una tarjeta que salta de
 *      columna cada 5 s es una tarjeta que el cocinero no encuentra.
 *
 * Un tiempo RETENIDO (`firedAt` null) va al final de su grupo: no ha
 * empezado a contar, así que no espera nada todavía. Por el mismo motivo
 * `tonoSemaforo` lo pinta gris y no verde.
 *
 * **Y ES LA ÚNICA.** La llama `repartirTarjetas`, y de ahí salen a la vez
 * `visibles` y `extra`: así lo que va al «+N» son SIEMPRE las más nuevas.
 * Si la rejilla y la franja ordenaran cada una por su cuenta, el «+N»
 * podría esconder una mesa más antigua que la última visible —que es el
 * defecto que este bloque viene a arreglar— y nadie lo notaría hasta tener
 * la captura delante.
 */
export function ordenarParaLaPantalla<T extends TarjetaMedible>(
  tarjetas: readonly T[],
): T[] {
  return [...tarjetas].sort((a, b) => {
    if (a.urgent !== b.urgent) return a.urgent ? -1 : 1;
    const ma = marcaDeMarcha(a);
    const mb = marcaDeMarcha(b);
    if (ma !== mb) return ma - mb;
    return a.id.localeCompare(b.id);
  });
}

/**
 * La marca de marcha en milisegundos, e `Infinity` si no hay.
 *
 * `Date.parse` y no comparar las cadenas: el servidor manda siempre
 * `toISOString()` y comparar texto funcionaría, pero una marca con otro
 * desplazamiento horario («…+02:00») se ordenaría por el texto y no por el
 * instante. `Infinity` para lo retenido y para lo ilegible — las dos cosas
 * son «todavía no cuenta», y el último sitio es el que no estorba.
 */
function marcaDeMarcha(t: TarjetaMedible): number {
  if (!t.firedAt) return Number.POSITIVE_INFINITY;
  const ms = Date.parse(t.firedAt);
  return Number.isNaN(ms) ? Number.POSITIVE_INFINITY : ms;
}

export interface Reparto<T> {
  /** Las que caben ENTERAS, en orden de lectura. */
  visibles: T[];
  /** Las que no caben. Van a la franja «+N». */
  extra: T[];
  /** Cuántas columnas entran en este ancho. */
  columnas: number;
}

/**
 * Reparte las tarjetas entre lo que se ve y la franja «+N».
 *
 * **Lo primero que hace es ORDENAR** (`ordenarParaLaPantalla`), y por eso
 * `visibles` y `extra` salen de la misma lista: lo que se esconde son
 * siempre las más nuevas. El llamador puede pasar la lista como le llegue.
 *
 * El empaquetado imita lo que hará la cuadrícula del navegador: se llena
 * **por orden de lectura** —izquierda a derecha y después la fila de
 * abajo—, y **la fila de abajo empieza donde acaba la tarjeta más alta de
 * la de arriba**, que es lo que hace el `grid` con `items-start` y lo que
 * mantiene una fila legible como fila.
 *
 * ── Y SE CORTA EN LA PRIMERA QUE NO CABE, NO POR FILAS ──────────────
 *
 * Hasta kds-1c se cortaba por filas enteras: el alto de la fila era el de
 * su tarjeta más alta, así que una sola comanda larga se llevaba por
 * delante a sus tres compañeras. La captura de kds-1c lo enseñó —cuatro
 * tarjetas y un «+7» con 390 px de pantalla vacía debajo, porque la M5 del
 * celíaco (~486 px) no cabía en la segunda fila—. En un día fuerte eso es
 * ver 4 comandas teniendo sitio para 6 (kds-1d).
 *
 * Ahora cada tarjeta se mira sola: si cabe ENTERA en el alto que queda, se
 * coloca; si no cabe, **ahí se para** —esa tarjeta y todas las siguientes
 * van al «+N»—.
 *
 * **Lo que NO se hace es saltar a una más corta de detrás.** Rellenar el
 * hueco con la siguiente que quepa adelantaría una comanda más nueva a una
 * más antigua, que es exactamente el defecto que kds-1c vino a cerrar: el
 * orden de `ordenarParaLaPantalla` tiene que ser el orden de lectura y el
 * del «+N», sin excepciones. Y como la fila de abajo empieza más abajo que
 * la de arriba, lo que no cabe en el hueco de ahora tampoco cabe luego:
 * pararse es lo correcto, no una aproximación.
 */
export function repartirTarjetas<T extends TarjetaMedible>(
  sinOrdenar: readonly T[],
  viewport: { ancho: number; alto: number },
  mostrarSeccion = false,
): Reparto<T> {
  const tarjetas = ordenarParaLaPantalla(sinOrdenar);
  const columnas = Math.max(
    1,
    Math.floor(
      (viewport.ancho + TARJETA_HUECO_PX) / (TARJETA_ANCHO_PX + TARJETA_HUECO_PX),
    ),
  );
  const visibles: T[] = [];
  const extra: T[] = [];
  /** El borde de ARRIBA de la fila que se está llenando. */
  let filaTop = 0;
  /** Lo que mide la más alta de las ya colocadas en esta fila. */
  let altoDeLaFila = 0;
  /** Cuántas van colocadas en esta fila. */
  let enLaFila = 0;
  let i = 0;
  for (; i < tarjetas.length; i += 1) {
    const t = tarjetas[i]!;
    const alto = altoTarjeta(t, mostrarSeccion);
    if (enLaFila === columnas) {
      // Fila llena: la siguiente empieza donde acaba la más alta de ésta.
      filaTop += altoDeLaFila + TARJETA_HUECO_PX;
      altoDeLaFila = 0;
      enLaFila = 0;
    }
    // No cabe entera. Se para aquí: ni se corta, ni se salta a una más
    // corta de detrás. Y tampoco cabría en la fila de abajo, que empieza
    // más abajo que ésta.
    if (filaTop + alto > viewport.alto) break;
    visibles.push(t);
    altoDeLaFila = Math.max(altoDeLaFila, alto);
    enLaFila += 1;
  }
  extra.push(...tarjetas.slice(i));
  return { visibles, extra, columnas };
}

/** Cuántas no caben: el «+2» de la franja, en grande. */
export function cuentaMasN(extra: readonly TarjetaMedible[]): string {
  if (extra.length === 0) return "";
  return `+${extra.length}`;
}

/**
 * Las mesas que no caben, una por línea bajo el «+N».
 *
 * Nombra las mesas y no sólo cuenta, porque lo que el cocinero necesita
 * saber es si lo que no cabe es suyo. Con más de tres se corta: a partir
 * de ahí la franja deja de ser una pista y empieza a ser otra lista.
 */
export function mesasMasN(extra: readonly TarjetaMedible[]): string[] {
  const nombres = extra.slice(0, 3).map((t) => t.tableName ?? `#${t.number}`);
  if (extra.length > 3) nombres.push("…");
  return nombres;
}

/** ¿Alguna de las que no caben es NUEVA? Entonces la franja parpadea. */
export function masNParpadea(extra: readonly TarjetaMedible[]): boolean {
  return extra.some((t) => t.isNew);
}

/**
 * **EL COLOR DE LA FRANJA «+N», y por qué casi nunca es rojo.**
 *
 * La franja es NEUTRA. Era el cuarto defecto de kds-1b: salía en rojo en
 * cuanto había algo escondido, y eso deshace la regla del rojo —«+2 · M1 ·
 * T2» no es una urgencia, es una pista—. Con la franja roja permanente, el
 * ojo deja de creerse el rojo de la franja «URGENTE» de al lado.
 *
 * Tres estados, y sólo tres:
 *
 *   · `rojo` — una de las escondidas ya pasó a rojo en el semáforo. Eso SÍ
 *     no puede esperar: hay una mesa que lleva 25 minutos y no se ve.
 *   · `verde` — hay alguna NUEVA ahí detrás. Parpadea en verde (el pulso
 *     de la maqueta), que es «mira, ha entrado algo».
 *   · `neutro` — lo demás.
 */
export type ColorMasN = "neutro" | "verde" | "rojo";

export function colorMasN(
  extra: readonly TarjetaMedible[],
  umbrales: UmbralesSemaforo,
  ahora: string,
): ColorMasN {
  if (extra.length === 0) return "neutro";
  const hayRoja = extra.some(
    (t) => tonoSemaforo(minutosDesdeMarchado(t.firedAt, ahora), umbrales) === "rojo",
  );
  if (hayRoja) return "rojo";
  return masNParpadea(extra) ? "verde" : "neutro";
}
