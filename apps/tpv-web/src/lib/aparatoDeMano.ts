// n1-hosteleria · EL UMBRAL DE «APARATO DE MANO», UNA SOLA VEZ.
//
// La restricción de este bloque es que los terminales grandes no cambien
// ni un píxel: AP11 (1280×800 como cocina, 1280×728 como caja), AP12,
// AP13 (1443×812) y el D8 de Sirope (≈1442×811). Todo lo que el bloque
// toca —el mapa de sala, la venta de hostelería y la comanda— se aplica
// **por debajo de este número y de ningún otro**.
//
// Antes de este bloque el número vivía TRES veces: el `max-width: 639px`
// escrito dos veces dentro de `useIsHandheld` (en `SalePage.hospitality`,
// privado y no reutilizable), los comentarios «< 640 px» de las
// constantes `*_HANDHELD` de `hospitalityGrid.ts`, y los `sm:` que
// `TableMapScreen` deja al CSS. Tres sitios que decían lo mismo sin que
// nada lo garantizara.

/**
 * Por debajo de este ancho de ventana, en px, el TPV es «de mano».
 *
 * **640, y no un número propio**, por la misma razón que `n1-vertical`
 * eligió 600 dp para la orientación (`n1-vertical-done` §2.2): es el
 * `sm` de Tailwind, que es lo que las clases `sm:` de estas pantallas ya
 * usan para repartirse. Con un umbral propio —620, 480— la decisión de
 * JS y la del CSS contarían cosas distintas y habría un tramo de anchos
 * en el que la rejilla cree que es de mano y el `flex-wrap` cree que no.
 *
 * Y cae holgado en el hueco que hay que separar: el N1 mide **360**, y
 * la tablet más estrecha de la casa pasa de **1000**. Sobran 360 px de
 * margen a cada lado, así que ningún aparato real se acerca al borde.
 */
export const UMBRAL_MANO_PX = 640;

/**
 * La media query del umbral, derivada de la constante para que el número
 * no se copie. `max-width` es inclusivo, de ahí el `− 1`: a 640 exactos
 * ya NO es de mano.
 */
export const MEDIA_MANO = `(max-width: ${UMBRAL_MANO_PX - 1}px)`;

/**
 * ¿Es de mano una ventana de `ancho` px?
 *
 * Función pura para que los bancos puedan medir el umbral sin navegador
 * ni `matchMedia`, que es lo único que jsdom puede comprobar de todo
 * esto (`n1-vertical-done` §4.2).
 */
export function esAparatoDeMano(ancho: number): boolean {
  return ancho < UMBRAL_MANO_PX;
}
