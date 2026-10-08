// kds-1-cocina · las secciones, con el nombre que se pinta.
//
// Las mismas tres de `KitchenSection` en la base (v1.4). La pantalla
// enseña la sección en el eyebrow de la tarjeta sólo cuando muestra MÁS DE
// UNA: con una sola sección, repetir «COCINA» en cada tarjeta gasta 13 px
// de alto por tarjeta para decir lo que ya dice la pantalla entera.

export type KitchenSection = "BARRA" | "COCINA" | "SALON";

export const ETIQUETA_SECCION: Record<KitchenSection, string> = {
  BARRA: "BARRA",
  COCINA: "COCINA",
  SALON: "SALA",
};

/**
 * El nombre de la sección para LA BARRA DE ARRIBA, en caja normal.
 *
 * La maqueta escribe «Cocina» a 24 px y peso 700, no «COCINA»: la barra es
 * el título de la pantalla y se lee una vez al entrar. Las mayúsculas se
 * quedan para el eyebrow de la tarjeta, que es una etiqueta que se repite
 * y hay que reconocer sin leerla.
 */
export const TITULO_SECCION: Record<KitchenSection, string> = {
  BARRA: "Barra",
  COCINA: "Cocina",
  SALON: "Sala",
};
