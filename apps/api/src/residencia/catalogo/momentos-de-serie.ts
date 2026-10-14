// residencia-2 (alcance §4) · LOS MOMENTOS DEL DÍA, de serie.
//
// Cinco, con las horas de Jardín de Gredos. Un centro las cambia desde la
// pantalla de Controles y eso mueve a qué hora «toca» todo lo que cuelga
// de un momento —las cuatro comidas y las dos medicaciones—, sin tocar
// ninguna línea de plan.
//
// La «noche» no es una comida, y de ahí que el modelo se llame
// `CenterMoment` y no `MealMoment` (que es como lo nombraba el prompt): la
// medicación nocturna cuelga de ella y se da a las diez y media, después
// de la cena y antes de acostarse.

import type { MomentoDeSerie } from "./tipos.js";

export const MOMENTOS_DE_SERIE: MomentoDeSerie[] = [
  { code: "DESAYUNO", name: "Desayuno", atTime: "09:00", sortOrder: 1 },
  { code: "COMIDA", name: "Comida", atTime: "13:30", sortOrder: 2 },
  { code: "MERIENDA", name: "Merienda", atTime: "17:00", sortOrder: 3 },
  { code: "CENA", name: "Cena", atTime: "20:00", sortOrder: 4 },
  { code: "NOCHE", name: "Noche (antes de acostarse)", atTime: "22:30", sortOrder: 5 },
];
