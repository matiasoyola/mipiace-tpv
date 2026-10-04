// Los tamaños de pantalla del banco, con su por qué.

/**
 * El AP11/AP12 en horizontal: **1280×800 CSS a `deviceScaleFactor` 1,5**.
 *
 * No es una estimación. Está medido sobre las capturas del hierro del 13-09
 * (`reservas-mostrador-done.md` §6): son de 1920×1200 de fichero y el panel
 * de alta, que es `md:w-96` = 384 px CSS, ocupa 575 px. 575/384 = 1,5.
 */
export const AP11 = {
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 1.5,
};

/** El panel del cliente: 1280 de ancho, el portátil de la dueña. */
export const PANEL = { viewport: { width: 1280, height: 900 } };

/** El móvil de una profesional: la vista «mi día» en una columna. */
export const MOVIL = {
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
};
