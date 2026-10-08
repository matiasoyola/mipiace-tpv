// kds-1-cocina · LOS TOKENS DE LA PANTALLA DE COCINA.
//
// Hermano de `hospitalityTheme.ts` y con la misma regla: **el tema sale de
// tokens y nunca de hex sueltos** (`docs/design/tokens.md` §9). Cada color
// y cada tamaño vive aquí una vez; los componentes los leen. Un sabotaje
// que baje el parpadeo a 1 s cambia el número que entra en las funciones
// puras y el test cae, sin mirar una captura.
//
// ── DE DÓNDE SALEN LOS NÚMEROS DE AQUÍ ────────────────────────────────
//
// **De la maqueta validada, que ya está en el repo**: `docs/kds/maqueta/`
// (`Main.dc.html` la cocina a 1280 × 800, `Comanda.dc.html` y
// `Alergias.dc.html` el TPV a 1443 × 812). Son HTML con estilos en línea,
// así que cada hex y cada px de este fichero se puede buscar ahí con un
// `grep`.
//
// La primera versión del bloque NO pudo abrirla —el lienzo de Design no
// estaba compartido con esta sesión— y los valores salieron de lo que
// `docs/kds/00-decisiones.md` describe con palabras. El bloque kds-1b es
// la corrección: lo que la maqueta dice MANDA sobre lo que se dedujo de la
// descripción. Las diferencias, una por una, están en la §7 del `-done`.
//
// Lo que NO sale de la maqueta y se queda como estaba, porque es una
// restricción del bloque y no una decisión de estilo: **ningún objetivo
// táctil por debajo de 56 px**. La maqueta dibuja el botón «Hoy» a 44 y la
// línea de plato a ~45; aquí son 56. Anotado también en la §7.

import {
  DARK_CANVAS,
  DARK_PANEL,
  DARK_SURFACE,
  DARK_SURFACE_KEY,
  DARK_SURFACE_RAISED,
  DARK_TEXT,
  DARK_TEXT_MUTED,
} from "./hospitalityTheme.js";

export {
  DARK_CANVAS,
  DARK_PANEL,
  DARK_SURFACE,
  DARK_SURFACE_KEY,
  DARK_SURFACE_RAISED,
  DARK_TEXT,
  DARK_TEXT_MUTED,
};

// ──────────────────────────────────────────────────────────────────────
// EL CUERPO DE LA TARJETA · la regla del rojo, de verdad
//
// `#1A1D23` en TODAS las tarjetas: la urgente, la de la alergia y la
// normal. Es el primer defecto que corrigió kds-1b.
//
// Antes el cuerpo de la T4 (urgente) y el de la M5 (alergia) salían en
// rojo oscuro, porque el pulso rojo se ponía en la tarjeta ENTERA. Y eso
// deshace la regla del rojo (decisión 3) con su propio aviso: sobre una
// tarjeta roja, la franja «⚡ URGENTE» y el «¡LLEVA GLUTEN!» dejan de
// destacar. Lo que la tarjeta dice es «esta comanda es roja» en vez de
// «esto de aquí dentro no puede esperar».
//
// El rojo vive SÓLO en cuatro sitios, y están todos nombrados abajo:
// la franja «URGENTE» (más su anillo de 4 px), la franja de la alergia de
// la mesa, el recuadro del plato de la silla, y el plato que lleva el
// alérgeno de su silla.
// ──────────────────────────────────────────────────────────────────────

/** `Main.dc.html`: `background: #1A1D23` en las cuatro tarjetas. */
export const TARJETA_CUERPO = "#1A1D23";

/** El radio de la tarjeta y de los recuadros de dentro. */
export const TARJETA_RADIO_PX = 14;

// ──────────────────────────────────────────────────────────────────────
// El semáforo · decisión 3
//
// Cambia de color LA CABECERA ENTERA de la tarjeta, no un puntito: «se
// reconoce, no se lee». Por eso cada tono trae su pareja de texto.
//
// **Los tres tonos son CLAROS con tinta oscura**, que es lo que la maqueta
// dibuja (`#8FD9A8` / `#E9A93E` / `#E0533F` sobre `#15171B`). La primera
// versión del bloque los puso oscuros (`#2E6B4A` / `#9A6B12` / `#A33124`)
// leyendo «el ámbar y el rojo van oscurecidos» de la decisión 3. La
// maqueta es la que Matías validó, y gana: una cabecera clara sobre el
// carbón del fondo se reconoce de un metro sin leerla, que es el listón.
//
// Y el rojo del semáforo (`#E0533F`) NO es el rojo de la alarma
// (`#C8102E`): el semáforo dice «esto lleva mucho», la alarma dice «esto
// no puede salir así».
// ──────────────────────────────────────────────────────────────────────

export type TonoSemaforo = "verde" | "ambar" | "rojo" | "espera";

export const SEMAFORO_FILL: Record<TonoSemaforo, string> = {
  verde: "#8FD9A8",
  ambar: "#E9A93E",
  rojo: "#E0533F",
  // EN ESPERA: gris y SIN semáforo. Un tiempo retenido no lleva prisa
  // porque todavía no ha empezado a contar (decisión 3).
  espera: DARK_SURFACE_RAISED,
};

/** La tinta de la cabecera. Oscura sobre los tres tonos claros. */
export const SEMAFORO_TEXT: Record<TonoSemaforo, string> = {
  verde: "#15171B",
  ambar: "#15171B",
  rojo: "#15171B",
  espera: DARK_TEXT_MUTED,
};

// ──────────────────────────────────────────────────────────────────────
// La regla del rojo · decisión 7
//
// El rojo se reserva para lo que NO PUEDE ESPERAR: urgente, alergia,
// plato que lleva el alérgeno de su silla, anulado o cambio, y el
// semáforo pasado. Nada decorativo ni informativo va en rojo.
// ──────────────────────────────────────────────────────────────────────

/** Franja «URGENTE» y anillo de 4 px de la tarjeta urgente. */
export const ROJO_URGENTE = "#C8102E";
export const ROJO_URGENTE_TEXT = "#FFFFFF";
/** El anillo va por `box-shadow` y no por `border`, como en la maqueta. */
export const ANILLO_URGENTE_PX = 4;

/** Franja de la alergia de la mesa, y la sub-franja del recuadro. */
export const ROJO_ALERGIA = "#C8102E";
export const ROJO_ALERGIA_TEXT = "#FFFFFF";

/** El borde del recuadro del plato de la silla. `2px solid`. */
export const ROJO_ALERGIA_BORDE = "#FF5A6E";

/**
 * El valle del pulso rojo, y la sub-franja del plato que CHOCA.
 *
 * Es el rojo del fondo del plato que lleva el alérgeno de su silla cuando
 * el pulso está abajo: `#C8102E` ↔ `#7A0A1C` (la `@keyframes pulsorojo` de
 * la maqueta). Dos rojos, no rojo ↔ carbón: lo que parpadea sigue siendo
 * rojo todo el rato.
 */
export const ROJO_ALERGIA_FONDO = "#7A0A1C";

/** «ANULADO», «ERAN 3 · −1» y la pastilla «lleva gluten». */
export const ROJO_ANULADO = "#FF8A99";

/** «CAMBIO»: hay que verlo, pero no está en la plancha. */
export const AMBAR_CAMBIO = "#E9A93E";
export const AMBAR_CAMBIO_TEXT = "#15171B";

/**
 * **Los modificadores y las notas.**
 *
 * Ámbar `#F6CF7A` a 17 px y peso 600, con «— » delante. Era el tercer
 * defecto de kds-1b: salían en gris, pequeños y con «·», o sea igual que
 * una etiqueta de sistema. El cocinero que no lee «sin limón» lo pone.
 */
export const AMBAR_NOTA = "#F6CF7A";

/** «SIN CONEXIÓN · las comandas no llegan»: la pantalla ENTERA. */
export const ROJO_SIN_CONEXION = "#8E1D11";

/**
 * El verde de «hecho»: la pastilla de la columna «Listas» y el punto de
 * «En línea». NO es el del semáforo —aunque la maqueta los dibuje con el
 * mismo hex— porque lo que dice es otra cosa: «esto ya está».
 */
export const VERDE_LISTA = "#8FD9A8";
export const VERDE_LISTA_TEXT = "#15171B";

/** El fondo de la pastilla «En línea» de la barra. */
export const VERDE_EN_LINEA_FONDO = "#16241C";

/**
 * **El botón «Lista» de la tarjeta va NEUTRO** (`#2C313A`), no verde.
 *
 * Es lo que dibuja la maqueta, y tiene sentido: el verde de esta pantalla
 * significa «ya está hecho», y «Lista» es el botón que hay que tocar para
 * que lo esté. Pintarlo del color del destino lo convierte en un estado.
 */
export const LISTA_FONDO = DARK_SURFACE_KEY;
export const LISTA_TEXTO = DARK_TEXT;

// ──────────────────────────────────────────────────────────────────────
// Escala · se lee DE PIE, A UN METRO Y CON LAS MANOS OCUPADAS
//
// Los tamaños son los de `Main.dc.html`. Bajan respecto a la primera
// versión del bloque (mesa 40 → 34, plato 26 → 22) porque la maqueta pone
// CUATRO columnas a 1280 px y no tres: a 251 px de ancho, un plato a 26 px
// se parte en tres líneas.
// ──────────────────────────────────────────────────────────────────────

/** La mesa. Lo primero que se busca. */
export const MESA_PX = 34;

/** Los minutos, al lado de la mesa y casi del mismo peso. */
export const MINUTOS_PX = 28;

/** «2ª COMANDA», «BARRA», «LLEGÓ TARDE», «LISTAS», «EN ESPERA». */
export const EYEBROW_COCINA_PX = 13;
export const EYEBROW_COCINA_TRACKING = "0.08em";

/**
 * El nombre del plato.
 *
 * 22 px y **se parte en dos líneas si no cabe; no se corta ni baja de
 * aquí**. Era parte del cuarto defecto de kds-1b: con un `truncate`,
 * «Croquetas de jamón (sin gluten)» se leía «Croquetas de jamó…», y el
 * nombre del plato es lo primero que la decisión 3 manda que se lea.
 */
export const PLATO_PX = 22;

/** La cantidad, delante del nombre y más grande que él. */
export const CANTIDAD_PX = 26;
/** El ancho reservado a la cantidad. Fijo, para que los nombres alineen. */
export const CANTIDAD_ANCHO_PX = 30;

/** Los modificadores y las notas, bajo cada plato. */
export const NOTA_PX = 17;
export const NOTA_WEIGHT = 600;
/** El guion que los abre. «— poco hecha», no «· poco hecha». */
export const NOTA_PREFIJO = "— ";

/** «URGENTE», en blanco sobre la franja roja. */
export const URGENTE_PX = 26;
/** El alto de la franja «URGENTE». */
export const FRANJA_URGENTE_ALTO_PX = 52;

/** «SILLA 3 · CELÍACO», la primera línea de la franja de la alergia. */
export const ALERGIA_PX = 21;
/** «Gluten», el alérgeno, debajo y más pequeño. */
export const ALERGIA_ALERGENO_PX = 15;

/** «SILLA 3 · SIN GLUTEN», la sub-franja del recuadro del plato. */
export const SILLA_PX = 13;

/** «SILLA 3 · ¡LLEVA GLUTEN!», la sub-franja del plato que choca. */
export const LLEVA_PX = 13;

/** La pastilla «lleva gluten» de un plato sin silla. Informativa. */
export const CARRIES_PX = 14;

/** «ANULADO», «ERAN 3 · −1», «CAMBIO». */
export const ANULADO_PX = 16;

/** El «+N» de la franja del borde. */
export const MAS_N_PX = 30;
/** «nuevas», debajo del «+N». */
export const MAS_N_ETIQUETA_PX = 14;
/** Las mesas que no caben, una por línea bajo el «+N». */
export const MAS_N_MESAS_PX = 13;

/** «Cocina» en la barra de arriba. */
export const TITULO_BARRA_PX = 24;
/** «La Maestranza», al lado. */
export const SUBTITULO_BARRA_PX = 16;
/** La hora. Tabular, para que no baile al pasar el minuto. */
export const RELOJ_PX = 26;
/** «En línea». */
export const EN_LINEA_PX = 15;
/** El botón «Hoy». */
export const HOY_PX = 18;

/** La etiqueta del botón «Lista». */
export const LISTA_LABEL_PX = 22;
/** La mesa en la pastilla de «Listas». */
export const LISTAS_MESA_PX = 28;
/** «esperando · 3 min», y la nota del pie de la columna. */
export const LISTAS_NOTA_PX = 14;

// ──────────────────────────────────────────────────────────────────────
// Objetivos táctiles · restricción del bloque
//
// «Ningún objetivo por debajo de 56 px en cocina; "Visto" 44 px como
// mínimo y sólo dentro de la línea; "Lista" 56 px.»
//
// Es lo ÚNICO en lo que esta pantalla se separa de la maqueta a propósito,
// y está en la §7 del `-done`: la maqueta dibuja «Hoy» a 44 y la línea de
// plato a ~45. La restricción del bloque es dura y no se reabre.
// ──────────────────────────────────────────────────────────────────────

export const MIN_TOUCH_COCINA_PX = 56;
export const LISTA_HEIGHT_PX = 56;
export const VISTO_HEIGHT_PX = 44;

/** El alto MÍNIMO de una línea de plato. Es lo que se toca para tachar. */
export const LINEA_HEIGHT_PX = 56;

// ──────────────────────────────────────────────────────────────────────
// La cuadrícula a 1280 × 800 · decisión 7
//
// **CUATRO columnas**, que era el cuarto defecto de kds-1b. Con tres sólo
// caben 3 comandas por fila y se escondían mesas que cabían. El ancho sale
// de donde lo saca la maqueta: de «Listas», que baja de 240 a 160 px, y
// del indicador, que baja de 96 a 60.
// ──────────────────────────────────────────────────────────────────────

/** La barra de arriba: «Cocina», «En línea», la hora y «Hoy». */
export const BARRA_SUPERIOR_PX = 60;

/** La columna estrecha «Listas», a la derecha. */
export const COLUMNA_LISTAS_PX = 160;

/**
 * La franja vertical del indicador «+N», entre las tarjetas y «Listas».
 *
 * **Se pinta siempre**, aunque no haya nada escondido. No es decoración:
 * si apareciera y desapareciera, la zona de tarjetas cambiaría de ancho
 * cada vez y el reparto podría oscilar —con la franja fuera cabe una más,
 * con la franja dentro no cabe, y así en bucle en cada repintado.
 */
export const INDICADOR_MAS_N_PX = 60;

/**
 * El ancho MÍNIMO de una tarjeta: lo que decide cuántas columnas entran.
 *
 * El ancho real es `1fr` de la cuadrícula, como en la maqueta, así que a
 * 1280 px sale ~251. Este número es sólo el divisor del reparto.
 *
 * La cuenta a 1280: 1280 − 160 («Listas») − 60 (indicador) = 1060 de zona;
 * menos los 24 de su padding, 1036 de contenido;
 * `floor((1036 + 10) / (248 + 10))` = **4 columnas**.
 */
export const TARJETA_ANCHO_PX = 248;
export const TARJETA_HUECO_PX = 10;
/** El padding de la zona de tarjetas, a cada lado. */
export const ZONA_PADDING_PX = 12;

/** Lo que el reparto tiene que dar a 1280 px. Su propio sabotaje. */
export const COLUMNAS_A_1280 = 4;

// ──────────────────────────────────────────────────────────────────────
// Animación · decisión 8 · SIN SONIDOS, AVISA EL PARPADEO
// ──────────────────────────────────────────────────────────────────────

/**
 * **Un pulso cada 2.500 ms**, y el número está aquí y no en una clase de
 * Tailwind porque es una decisión con nombre: Matías, al ver la maqueta,
 * pidió «más lento, para no volvernos locos».
 *
 * Y hay un segundo motivo, menos opinable: 2,5 s son 0,4 destellos por
 * segundo, muy por debajo del umbral de 3/s de las pautas de
 * fotosensibilidad (WCAG 2.3.1). Bajarlo a 1 s seguiría estando por
 * debajo del umbral pero convertiría una cocina con seis comandas nuevas
 * en una discoteca. **Tiene su fila en la tabla de sabotajes**: «Parpadeo
 * de 1 s o de pantalla entera».
 */
export const PULSO_MS = 2500;

/**
 * Y NUNCA LA PANTALLA ENTERA: sólo la tarjeta o la línea. Lo que parpadea
 * es lo que hay que mirar; una pantalla que parpadea entera no señala
 * nada y marea.
 */
export const PULSO_SELECTORES = ["tarjeta", "linea"] as const;

/**
 * El pulso de lo NUEVO: `#1A1D23` ↔ `#2B4636`, o sea del cuerpo de la
 * tarjeta a un verde apagado. Es la `@keyframes pulso` de la maqueta.
 *
 * **Es el único pulso que lleva una tarjeta.** Una comanda nueva —urgente
 * o con alergia incluidas— parpadea con éste: lo que el parpadeo dice es
 * «nadie ha mirado esto todavía», y eso no es rojo. El rojo ya está donde
 * tiene que estar, en la franja y en el plato.
 */
export const PULSO_CLASS_TARJETA = "kds-pulso-tarjeta";

/**
 * El pulso de la ALARMA: `#C8102E` ↔ `#7A0A1C`, la `pulsorojo` de la
 * maqueta. Va SÓLO en cajas que ya son rojas —el plato que lleva el
 * alérgeno de su silla, la línea anulada sin «Visto»—, nunca en la
 * tarjeta.
 */
export const PULSO_CLASS_ROJO = "kds-pulso-rojo";

/** El del «CAMBIO», que hay que ver pero no está en la plancha. */
export const PULSO_CLASS_AMBAR = "kds-pulso-ambar";
