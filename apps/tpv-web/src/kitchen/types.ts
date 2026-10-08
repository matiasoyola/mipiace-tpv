// kds-1-cocina · lo que la pantalla recibe de `GET /kitchen/comandas`.
//
// Espejo de `apps/api/src/kitchen/vista.ts`. Se escribe a mano y no se
// genera porque es el único contrato entre los dos lados y leerlo aquí
// tiene que ser suficiente para saber qué llega.
//
// Lo que NO está en estos tipos, y es deliberado: **precios, hora exacta,
// camarero y comensales** (decisión 3). Si alguien los necesitara mañana
// en la pantalla, tendría que pasar por aquí y por la decisión.

import type { KitchenSection } from "./secciones.js";

/**
 * La franja roja de la alergia de la mesa, en sus dos líneas.
 *
 * Espejo de `FranjaAlergiaPantalla` de `ticket-model`. Se escribe aquí
 * también porque la pantalla no importa de `@mipiacetpv/ticket-model`: lo
 * único que cruza es JSON.
 */
export interface FranjaAlergia {
  /** «SILLA 3 · CELÍACO». 21 px, negrita. */
  titulo: string;
  /** «Gluten». 15 px, debajo. */
  alergenos: string;
}

export interface LineaComanda {
  id: string;
  name: string;
  /** Unidades VIVAS: las que se mandaron menos lo anulado. */
  units: number;
  /** Las que se mandaron, para pintar «ERAN 3». `null` si no se anuló nada. */
  unitsOriginal: number | null;
  notes: string[];
  course: number;
  seat: number | null;
  /** `false` = EN ESPERA: gris, sin semáforo y no se puede tachar. */
  fired: boolean;
  done: boolean;
  voidedUnits: number;
  /** Anulado SIN «Visto»: tachado en rojo y parpadeando. */
  voidPending: boolean;
  /** Merma: la cocina ya lo había tachado cuando se anuló. */
  doneBeforeVoid: boolean;
  changeNote: string | null;
  changePending: boolean;
  /** Capa 3 informativa: «lleva gluten». Sin rojo y sin parpadeo. */
  carries: string[];
  /** Capa 2 · la sub-franja del recuadro de este plato: «SIN GLUTEN». */
  seatAllergy: string | null;
  /** Capa 3, el grito: «¡LLEVA GLUTEN!». Rojo y parpadeando. */
  allergyWarning: string | null;
}

export interface Comanda {
  id: string;
  section: KitchenSection;
  ticketId: string;
  tableId: string | null;
  tableName: string | null;
  number: number;
  urgent: boolean;
  lateArrival: boolean;
  sentAt: string;
  /** De dónde cuenta el semáforo. `null` = la tarjeta entera en espera. */
  firedAt: string | null;
  orderAt: string;
  readyAt: string | null;
  servedAt: string | null;
  recoveredAt: string | null;
  /** Parpadea hasta el primer tachado. */
  isNew: boolean;
  /** «SILLA 3 · CELÍACO» + «Gluten». «Toda la mesa» primero. */
  allergyBands: FranjaAlergia[];
  lines: LineaComanda[];
}

export interface AjustesCocina {
  greenMaxMin: number;
  amberMaxMin: number;
  readyBeep: boolean;
}

export interface VistaCocina {
  /** La hora del SERVIDOR: la pantalla cuenta los minutos contra ésta. */
  serverTime: string;
  settings: AjustesCocina;
  sections: KitchenSection[];
  orders: Comanda[];
  ready: Comanda[];
}

export interface KitchenMe {
  device: { id: string; name: string | null };
  store: { id: string; name: string };
  sections: KitchenSection[];
  settings: AjustesCocina;
  /** kds-2-wifi · la hora del servidor al arrancar (para el desvío). */
  serverTime?: string;
  /** kds-2-wifi · la clave de la tienda y el puerto del servidor local. */
  lan?: { key: string; port: number; maxAgeMs: number };
}
