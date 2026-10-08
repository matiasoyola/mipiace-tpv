// kds-1-cocina · LOS TOKENS DE LA PANTALLA DE COCINA.
//
// Hermano de `hospitalityTheme.ts` y con la misma regla: **el tema sale de
// tokens y nunca de hex sueltos** (`docs/design/tokens.md` §9). Cada color
// y cada tamaño vive aquí una vez; los componentes los leen. Un sabotaje
// que baje el parpadeo a 1 s cambia el número que entra en las funciones
// puras y el test cae, sin mirar una captura.
//
// Hereda las superficies y el texto del tema oscuro de la sala: es la misma
// casa y el mismo WebView. Lo que añade es lo que la cocina tiene y la sala
// no — el semáforo, el urgente, la alergia y el parpadeo.
//
// ── EL DISEÑO SE PARTE DE LA ESPECIFICACIÓN ESCRITA ───────────────────
//
// La maqueta validada por Matías el 08-10 («Cocina · pantalla de comandas»,
// lienzo privado de Design) **no fue accesible desde la sesión que escribió
// este bloque**: el enlace del artefacto no está compartido con este
// usuario. Así que los valores de aquí vienen de lo que `docs/kds/00-decisiones.md`
// dice con palabras —verde/ámbar/rojo con el ámbar y el rojo oscurecidos,
// «⚡ URGENTE» a 26 px en blanco sobre franja roja, pulso cada 2,5 s, se lee
// de pie a un metro— más la escala del tema oscuro ya validado.
//
// **Queda anotado como diferencia pendiente en el `-done`**: hay que
// comparar las capturas a 1280×800 con la maqueta y corregir lo que no
// coincida. Lo que NO se ha hecho es inventar una paleta nueva: todo lo que
// no describe la decisión 3 se hereda de `hospitalityTheme`.

import {
  DARK_CANVAS,
  DARK_PANEL,
  DARK_SURFACE,
  DARK_SURFACE_RAISED,
  DARK_TEXT,
  DARK_TEXT_MUTED,
} from "./hospitalityTheme.js";

export {
  DARK_CANVAS,
  DARK_PANEL,
  DARK_SURFACE,
  DARK_SURFACE_RAISED,
  DARK_TEXT,
  DARK_TEXT_MUTED,
};

// ──────────────────────────────────────────────────────────────────────
// El semáforo · decisión 3
//
// Cambia de color LA CABECERA ENTERA de la tarjeta, no un puntito: «se
// reconoce, no se lee». Por eso cada tono trae su pareja de texto.
//
// El ámbar y el rojo van OSCURECIDOS respecto a la escala clara (fue
// corrección de Matías al ver la maqueta): sobre carbón, un ámbar
// saturado deslumbra en una cocina y un rojo saturado hace que todo lo
// demás desaparezca. El verde no es el verde de «cobrado» de la sala: es
// más apagado, porque verde quiere decir «va bien» y no pide mirada.
// ──────────────────────────────────────────────────────────────────────

export type TonoSemaforo = "verde" | "ambar" | "rojo" | "espera";

export const SEMAFORO_FILL: Record<TonoSemaforo, string> = {
  verde: "#2E6B4A",
  ambar: "#9A6B12",
  rojo: "#A33124",
  // EN ESPERA: gris y SIN semáforo. Un tiempo retenido no lleva prisa
  // porque todavía no ha empezado a contar (decisión 3).
  espera: DARK_SURFACE_RAISED,
};

export const SEMAFORO_TEXT: Record<TonoSemaforo, string> = {
  verde: "#E8F5EE",
  ambar: "#FFF4DD",
  rojo: "#FFE8E4",
  espera: DARK_TEXT_MUTED,
};

// ──────────────────────────────────────────────────────────────────────
// La regla del rojo · decisión 7
//
// El rojo se reserva para lo que NO PUEDE ESPERAR: urgente, alergia,
// plato que lleva el alérgeno de su silla, anulado o cambio, y el
// semáforo pasado. Nada decorativo ni informativo va en rojo.
//
// De ahí que haya un ÁMBAR aparte para el «CAMBIO»: una nota cambiada hay
// que verla, pero no es lo mismo que un plato anulado que ya está en la
// plancha.
// ──────────────────────────────────────────────────────────────────────

/** Franja «⚡ URGENTE» y borde de la tarjeta urgente. */
export const ROJO_URGENTE = "#C2301F";
export const ROJO_URGENTE_TEXT = "#FFFFFF";

/** Franja «⚠ SILLA 3 · SIN GLUTEN» y recuadro del plato de esa silla. */
export const ROJO_ALERGIA = "#B82B1C";
export const ROJO_ALERGIA_TEXT = "#FFFFFF";

/** «ANULADO» y el tachado de la línea. */
export const ROJO_ANULADO = "#D14A3A";

/** «CAMBIO»: hay que verlo, pero no está en la plancha. */
export const AMBAR_CAMBIO = "#E2B23A";
export const AMBAR_CAMBIO_TEXT = "#1B1500";

/** «SIN CONEXIÓN · las comandas no llegan»: la pantalla ENTERA. */
export const ROJO_SIN_CONEXION = "#8E1D11";

/** «Lista» y la columna de listas. Verde de «hecho», no el del semáforo. */
export const VERDE_LISTA = "#2F8F5B";
export const VERDE_LISTA_TEXT = "#FFFFFF";

// ──────────────────────────────────────────────────────────────────────
// Escala · se lee DE PIE, A UN METRO Y CON LAS MANOS OCUPADAS
//
// Es el listón del principio de venta bajo estrés, subido: en la sala el
// camarero mira la tablet a 40 cm; en la cocina la pantalla está en la
// pared y el cocinero no puede acercarse. Todo sube un peldaño respecto a
// la comanda del TPV.
// ──────────────────────────────────────────────────────────────────────

/** La mesa. Lo primero que se busca. */
export const MESA_PX = 44;

/** Los minutos, al lado de la mesa y del mismo peso. */
export const MINUTOS_PX = 40;

/** «2ª COMANDA», «BARRA», «llegó tarde». */
export const EYEBROW_COCINA_PX = 13;
export const EYEBROW_COCINA_TRACKING = "0.1em";

/** El nombre del plato con su cantidad. */
export const PLATO_PX = 26;

/** Los modificadores y las notas, bajo cada plato. «Bien visibles». */
export const NOTA_PX = 19;

/** «⚡ URGENTE», en blanco sobre la franja roja. */
export const URGENTE_PX = 26;

/** «⚠ SILLA 3 · SIN GLUTEN». */
export const ALERGIA_PX = 22;

/** «SILLA 3» sobre el plato recuadrado. */
export const SILLA_PX = 20;

/** «¡LLEVA GLUTEN!». */
export const LLEVA_PX = 22;

/** «ANULADO», «ERAN 3 · −1», «CAMBIO». */
export const ANULADO_PX = 20;

/** El indicador del borde: «+2 · M1 · T2». */
export const MAS_N_PX = 28;

// ──────────────────────────────────────────────────────────────────────
// Objetivos táctiles · restricción del bloque
//
// «Ningún objetivo por debajo de 56 px en cocina; "Visto" 44 px como
// mínimo y sólo dentro de la línea; "Lista" 56 px.»
//
// El «Visto» es la única excepción y está acotada: vive DENTRO de una
// línea que ya es de 56, así que no compite con nada a su alrededor.
// ──────────────────────────────────────────────────────────────────────

export const MIN_TOUCH_COCINA_PX = 56;
export const LISTA_HEIGHT_PX = 56;
export const VISTO_HEIGHT_PX = 44;

/** El alto de una línea de plato. Es lo que se toca para tachar. */
export const LINEA_HEIGHT_PX = 56;

// ──────────────────────────────────────────────────────────────────────
// La cuadrícula a 1280 × 800 · decisión 7
// ──────────────────────────────────────────────────────────────────────

/** La barra de arriba: «En línea» y «Hoy». */
export const BARRA_SUPERIOR_PX = 72;

/** La columna estrecha «Listas», a la derecha. */
export const COLUMNA_LISTAS_PX = 240;

/** El indicador «+N», en el borde derecho bajo la columna de listas. */
export const INDICADOR_MAS_N_PX = 96;

/**
 * Ancho de una tarjeta.
 *
 * A 1280 px, con la columna «Listas» (240) y los huecos, quedan ~1016 px
 * de zona de tarjetas: **tres columnas de 320** con 16 de hueco. Tres y no
 * cuatro porque a 240 px de ancho un plato de 26 px se queda en cuatro
 * palabras y «Croquetas de jamón (sin gluten)» se parte en tres líneas.
 *
 * La decisión 7 pide «unas 8 comandas normales en 1280×800 sin desplazar».
 * Con tres columnas eso son tres filas de tarjetas de ~230 px, que es una
 * comanda de cuatro platos. Sale, y está medido en `kitchenLayout.ts`.
 */
export const TARJETA_ANCHO_PX = 320;
export const TARJETA_HUECO_PX = 16;

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
 * El pulso: sube y baja el fondo, sin destello seco. La animación vive en
 * `index.css` porque un `@keyframes` no cabe en un `style` inline.
 */
export const PULSO_CLASS_TARJETA = "kds-pulso-tarjeta";
export const PULSO_CLASS_ROJO = "kds-pulso-rojo";
export const PULSO_CLASS_AMBAR = "kds-pulso-ambar";
