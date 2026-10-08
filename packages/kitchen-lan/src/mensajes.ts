// kds-2-wifi · LO QUE VA DENTRO DEL SOBRE.
//
// ── POR QUÉ LA COMANDA DEL CAMINO DIRECTO LA COMPONE EL TPV ───────────
//
// La decisión 2.14 de kds-1 dice que el papel de respaldo lo construye el
// SERVIDOR, para que no haya dos formatos del mismo papel. Aquí no se
// puede: sin internet no hay servidor al que preguntar, y la comanda tiene
// que aparecer en la tablet de todas formas. Así que la compone el TPV,
// con los datos que ya tiene en pantalla (el DRAFT de la mesa, que es lo
// que el camarero está mirando) y con las mismas funciones de
// `@mipiacetpv/ticket-model` que usa el servidor para la franja de la
// alergia y el aviso de choque. Un solo juego de reglas, dos sitios que lo
// llaman.
//
// Y la comanda del camino directo **no es la verdad**: es una tarjeta para
// que el cocinero cocine AHORA. La verdad sigue siendo la del servidor,
// que llega cuando vuelve internet con el MISMO `clientSendId`. La tablet
// la reconoce por ese id y no pinta dos tarjetas (ver `fusionar` en el
// lado de la pantalla).

export type SeccionLan = "BARRA" | "COCINA" | "SALON";

/** La franja roja de la alergia, igual que la pinta la pantalla. */
export interface FranjaLan {
  titulo: string;
  alergenos: string;
}

export interface LineaLan {
  /** El id de la línea de la venta. Es por lo que se cruza después. */
  ticketLineId: string;
  name: string;
  units: number;
  notes: string[];
  course: number;
  seat: number | null;
  /** `false` = EN ESPERA: no ha marchado, no se puede tachar. */
  fired: boolean;
  /** Capa 3 informativa: «lleva gluten». */
  carries: string[];
  /** Capa 2: «SIN GLUTEN» en el recuadro del plato de esa silla. */
  seatAllergy: string | null;
  /** Capa 3, el grito: «¡LLEVA GLUTEN!». */
  allergyWarning: string | null;
}

export interface ComandaLan {
  /** El id del ENVÍO. El mismo que viaja a la nube. */
  clientSendId: string;
  section: SeccionLan;
  ticketId: string;
  tableId: string | null;
  tableName: string | null;
  /** 1ª, 2ª, 3ª comanda de la mesa. */
  number: number;
  urgent: boolean;
  sentAt: string;
  allergyBands: FranjaLan[];
  lines: LineaLan[];
}

/** `kind: "COMANDA"` · un envío, con todas sus secciones. */
export interface PayloadComanda {
  comandas: ComandaLan[];
}

/** `kind: "ANULACION"` · el `−` sobre algo que ya está en la plancha. */
export interface PayloadAnulacion {
  ticketId: string;
  ticketLineId: string;
  /** Unidades anuladas. Se suman a `voidedUnits` de la más reciente. */
  units: number;
}

/** `kind: "MARCHA"` · «Marchar 2º». */
export interface PayloadMarcha {
  ticketId: string;
  course: number;
  firedAt: string;
}

/** `kind: "URGENTE"` · el toque del camarero. */
export interface PayloadUrgente {
  ticketId: string;
  urgent: boolean;
}

/** `kind: "SERVIDO"` · un toque en la banda «LISTO». */
export interface PayloadServido {
  clientSendId: string;
  section: SeccionLan;
}

/** `kind: "SONDEO"` y `kind: "PRUEBA"` · no llevan nada dentro. */
export type PayloadVacio = Record<string, never>;

/** Una tarjeta que la cocina ha dado por «Lista». */
export interface ListaLan {
  clientSendId: string;
  section: SeccionLan;
  ticketId: string;
  tableId: string | null;
  tableName: string | null;
  readyAt: string;
}

/** `kind: "RESPUESTA"` · lo que la tablet contesta. */
export interface PayloadRespuesta {
  /** Las tarjetas listas y sin «Servido». Es el «LISTO» sin internet. */
  listas: ListaLan[];
  /** Cuántos envíos tiene guardados de este servicio. */
  recibidas: number;
  /** Cuántas marcas (tachados, «Lista», «Visto») lleva sin subir. */
  marcasPendientes: number;
  /** Qué secciones mira esta pantalla. Lo lee el botón de la prueba. */
  sections: SeccionLan[];
  /** Nombre del aparato, para que la prueba diga «llega a la tablet de cocina». */
  deviceName: string | null;
}

/** Las rutas del servidor de la tablet. Una sola, a propósito. */
export const RUTA_LAN = "/kds";

/**
 * Lo que la tablet contesta cuando el sobre no pasa, por motivo.
 *
 * 401 y no 400: lo que ha fallado es la autenticación del mensaje. Es el
 * código que el sabotaje «aceptar un mensaje sin firma o con la clave de
 * otra tienda» busca, y el que hace que el TPV sepa que NO tiene que
 * reintentar (reintentar con la clave mala es lo mismo otra vez).
 *
 * `REPETIDO` es un 200: el duplicado del doble camino no es un error. El
 * TPV que manda por los dos caminos quiere oír «ya lo tenía», no un rojo.
 */
export function codigoHttpDeRechazo(motivo: string): number {
  switch (motivo) {
    case "REPETIDO":
      return 200;
    case "VERSION":
      return 409;
    case "OTRA_TIENDA":
      return 403;
    case "VIEJO":
      return 408;
    default:
      return 401;
  }
}
