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
