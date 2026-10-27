// personal-1 · las columnas del CSV, dichas en la pantalla.
//
// **Sale del paquete puro**, no de una lista escrita a mano aquí: añadir
// una columna reconocida mañana no puede dejar la ayuda de la pantalla
// diciendo que no se entiende.

import { COLUMNAS_DE_PERSONAL } from "@mipiacetpv/cuadrante";

export const COLUMNAS_LEGIBLES = COLUMNAS_DE_PERSONAL.join(", ");
