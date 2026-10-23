// hierro-sirope (G) · DE QUÉ CAJA ES ESTE #000001.
//
// El 18-10 se creó la Caja 2 de Cafetería Sirope y su primer ticket salió
// con el número #000001 — mientras la Caja 1 iba por el #000028— y los
// dos aparecían en la MISMA lista del histórico sin nada que los
// distinguiera salvo el texto pequeño de debajo (captura 30). En cuanto
// la Caja 2 llegue al 28 habrá dos #000028, y «búscame el 28» dejará de
// tener respuesta.
//
// ── Lo que NO se toca ─────────────────────────────────────────────────
//
// La numeración. `Ticket.internalNumber` es correlativo POR CAJA a
// propósito y tiene implicaciones fiscales (cada caja es una instalación
// de SIF con su serie y su cadena de registros, ADR-019). Renumerar por
// tienda sería partir cadenas selladas.
//
// Lo que cambia es sólo cómo se ESCRIBE: cuando la tienda tiene más de
// una caja, el número se pinta con la caja delante —«C2·000001»— en la
// lista, en el detalle y en el papel. Con una sola caja no se pinta nada:
// el 95 % de los comercios tiene una, y un prefijo constante es ruido.
//
// ── La etiqueta ───────────────────────────────────────────────────────
//
// Es `Register.fiscalSeries` cuando existe («C1», «C2»): es la serie que
// ya lleva la factura simplificada de esa caja, así que el papel y la
// pantalla dicen la misma letra. Mientras una caja no ha emitido todavía
// es NULL, y entonces se deriva del nombre, que es lo que el cajero lee
// en la pantalla de vinculación.

/** La etiqueta corta de una caja: «C2». */
export function etiquetaDeCaja(register: {
  fiscalSeries?: string | null;
  name?: string | null;
}): string {
  const serie = register.fiscalSeries?.trim();
  if (serie) return serie.toUpperCase();
  return etiquetaDesdeNombre(register.name ?? "");
}

/**
 * «Caja 2» → «C2»; «Terraza 1» → «T1»; «Barra» → «BARRA».
 *
 * Con número al final se usa la inicial más el número, que es como el
 * personal las llama en voz alta («la dos»). Sin número no hay nada que
 * abreviar sin inventar: se deja el nombre en mayúsculas, recortado, y
 * ya se verá que es largo — mejor largo que ambiguo.
 */
export function etiquetaDesdeNombre(nombre: string): string {
  const limpio = nombre.trim();
  if (limpio.length === 0) return "CAJA";
  const m = /^(\p{L})\p{L}*\D*?(\d+)\s*$/u.exec(limpio);
  if (m) return `${m[1]!.toUpperCase()}${m[2]}`;
  return limpio.toUpperCase().slice(0, 6);
}

/**
 * El separador. Un punto medio y no un guion: «C2-000001» se lee como un
 * número con guion (y la gente lo teclea con guion al buscar), mientras
 * que «C2·000001» se lee como dos cosas pegadas, que es lo que es.
 */
export const SEPARADOR_CAJA = "·";

/** «C2·000001», o «000001» si la tienda sólo tiene una caja. */
export function numeroConCaja(
  internalNumber: string,
  etiquetaCaja: string | null,
): string {
  if (!etiquetaCaja) return internalNumber;
  return `${etiquetaCaja}${SEPARADOR_CAJA}${internalNumber}`;
}

export interface BusquedaDeTicket {
  /** Lo que se busca en `internalNumber`. Siempre presente. */
  numero: string;
  /** La caja, si el cajero la escribió. `null` = todas. */
  caja: string | null;
}

/**
 * Qué se ha tecleado en la caja de búsqueda.
 *
 * «000001» → las DOS cajas, que es la decisión: quien busca un número a
 * secas no sabe de qué caja es, y enseñarle las dos es la respuesta útil.
 * «C2·000001», «C2 000001», «C2-000001», «c2/000001» → sólo esa caja,
 * porque ahí ya lo ha dicho.
 *
 * Cualquier otra cosa (un docNumber de Holded, un externalId) sale tal
 * cual y la busca quien la sabe buscar.
 */
export function parsearBusquedaDeTicket(q: string): BusquedaDeTicket {
  const limpio = q.trim();
  const m = /^([A-Za-z]{1,6}\d{0,3})\s*[·\-/ ]\s*(\d{1,12})$/.exec(limpio);
  if (m) return { caja: m[1]!.toUpperCase(), numero: m[2]! };
  return { caja: null, numero: limpio };
}
