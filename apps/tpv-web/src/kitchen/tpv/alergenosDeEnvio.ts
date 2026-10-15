// kds-2b · DE DÓNDE SALEN LOS ALÉRGENOS DE LA COMANDA DE LA WIFI.
//
// ── Lo que pasó en el D8 el 15-10 ─────────────────────────────────────
//
// La tarjeta que llegó a la cocina por la wifi traía las bravas de la
// silla 3 —la de la celíaca— como «SILLA 3 · SIN GLUTEN», **sin el
// «¡LLEVA GLUTEN!»**. La tarjeta de la nube sí lo llevaba.
//
// Los dos caminos leen el mismo dato de dos sitios distintos:
//
//   · la nube: `envio.ts` lee `product.allergens` de la ficha, en el
//     momento de enviar. Es la verdad.
//   · la wifi: la comanda la compone el TPV (kds-2 §2.5, porque sin
//     internet no hay a quién preguntar) y hasta hoy sacaba los alérgenos
//     del CATÁLOGO CACHEADO del terminal, copiados en la línea del
//     carrito al añadir el plato.
//
// Los alérgenos de ENSAYO se cargaron por script a las 13:21. El D8 llevaba
// la app abierta desde antes y su catálogo en IndexedDB era el de antes: el
// único refresco automático es el del MONTAJE de la pantalla de venta.
//
// ── Y lo que se averiguó de la caché ──────────────────────────────────
//
// **Nada invalida el catálogo del TPV.** No hay sello de versión, no hay
// evento de tienda («catalog.updated» no existe: el bus sólo lleva `table.*`
// y `kitchen.*`) y el banner «Sincronizando» es del sync de tickets con
// Holded, no del catálogo. Un cambio de alérgenos —por script o desde el
// panel— no llega al terminal hasta que alguien vuelve a entrar en la
// pantalla de venta, toca «Refrescar catálogo» o «Sincronizar».
//
// ── Lo que se hace ahora, y en este orden ─────────────────────────────
//
//   1. **Lo que diga el servidor.** `GET /tickets/:id/kitchen` trae los
//      alérgenos de cada línea desde kds-2b, leídos de la misma fila que
//      los del papel y los de la nube. Con esto el camino directo deja de
//      depender de la caché del terminal.
//   2. **El catálogo recién pedido**, si hizo falta pedirlo (ver
//      `hayQuePreguntarElCatalogo`): es el arreglo que llega con la APK
//      sola, sin desplegar el servidor.
//   3. **La copia de la línea del carrito**, que es lo de kds-2.
//
// Y pase lo que pase, un plato sin alérgenos informados que va a una silla
// con alergia sale marcado «ALÉRGENOS SIN INFORMAR» (`avisoSinInformar`):
// la cocina ve que ese plato no está comprobado en vez de leer un «SIN
// GLUTEN» que parece una instrucción cumplida.

import type { EstadoCocinaMesa } from "../../lib/kitchenComanda.js";

/** Lo que hace falta de una línea del carrito. */
export interface LineaParaAlergenos {
  id: string;
  productId: string | null;
  /** La copia del catálogo cacheado, hecha al añadir la línea. */
  allergens?: string[];
}

/** Lo que hace falta de una ficha del catálogo. */
export interface FichaParaAlergenos {
  id: string;
  allergens?: string[];
}

/**
 * Los alérgenos de cada línea, por id, para la comanda del camino directo.
 *
 * `catalogo` es opcional: sólo se pasa si se pudo refrescar a tiempo.
 */
export function alergenosPorLineaDeEnvio(opts: {
  lines: readonly LineaParaAlergenos[];
  estado: EstadoCocinaMesa;
  catalogo?: readonly FichaParaAlergenos[];
}): Map<string, string[]> {
  const delServidor = new Map<string, string[]>();
  for (const l of opts.estado.lines) {
    if (Array.isArray(l.allergens)) delServidor.set(l.id, l.allergens);
  }
  const delCatalogo = new Map<string, string[]>();
  for (const p of opts.catalogo ?? []) {
    if (Array.isArray(p.allergens)) delCatalogo.set(p.id, p.allergens);
  }
  const out = new Map<string, string[]>();
  for (const l of opts.lines) {
    const servidor = delServidor.get(l.id);
    if (servidor) {
      out.set(l.id, servidor);
      continue;
    }
    const fresco = l.productId ? delCatalogo.get(l.productId) : undefined;
    out.set(l.id, fresco ?? l.allergens ?? []);
  }
  return out;
}

/**
 * ¿Hay que pedir el catálogo antes de componer esta comanda?
 *
 * Sólo si se juntan las tres cosas:
 *
 *   · **la mesa tiene alergias declaradas.** Sin alergias, los alérgenos
 *     del plato no cambian ni una letra de la tarjeta, y nadie va a
 *     esperar un viaje a la API por un dato que no se pinta;
 *   · **el servidor no los ha dicho.** Con la API de kds-2b desplegada
 *     esto no se cumple nunca y no se pide nada;
 *   · **y alguna línea por enviar no tiene alérgenos informados**, que es
 *     exactamente la forma que tiene una caché vieja: el campo llegó vacío
 *     porque entonces no había nada cargado.
 *
 * Un bar que de verdad no informa de sus alérgenos pedirá el catálogo una
 * vez por comanda de una mesa con alergia, y seguirá saliendo «ALÉRGENOS
 * SIN INFORMAR» porque es la verdad.
 */
export function hayQuePreguntarElCatalogo(opts: {
  lines: readonly LineaParaAlergenos[];
  estado: EstadoCocinaMesa;
}): boolean {
  if (opts.estado.allergies.length === 0) return false;
  const loDiceElServidor = opts.estado.lines.some((l) =>
    Array.isArray(l.allergens),
  );
  if (loDiceElServidor) return false;
  const pendientes = new Set(
    opts.estado.lines
      .filter((l) => Math.round((l.units - l.sentUnits) * 1000) / 1000 > 0)
      .map((l) => l.id),
  );
  return opts.lines.some(
    (l) => pendientes.has(l.id) && (l.allergens ?? []).length === 0,
  );
}

/**
 * Cuánto se espera al catálogo antes de mandar la comanda igual.
 *
 * El camarero ya pulsó «Enviar» y hay platos esperando. Un segundo es lo
 * que tarda `GET /tpv/catalog/products` en una wifi de bar con el catálogo
 * entero cacheado por el service worker; pasado eso, se manda con lo que
 * haya —con su «ALÉRGENOS SIN INFORMAR» puesto— porque **la comanda llega
 * antes que el dato perfecto**. Es la misma dirección que «cobrar siempre
 * se puede».
 */
export const ESPERA_CATALOGO_MS = 1_000;
