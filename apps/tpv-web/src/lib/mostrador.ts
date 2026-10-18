// auditoria-sirope (#25) · LA VENTA DE MOSTRADOR QUE VA A COCINA.
//
// Una venta rápida no existe en el servidor: el carrito vive en el
// navegador hasta que se cobra. Eso dejaba «Enviar» sin nada que enviar
// —la comanda se manda sobre un ticket— y el botón se quedaba encendido
// sin hacer nada. En Cafetería Sirope, que es casi todo mostrador, eso
// significó que lo que se pedía en la barra no llegaba a la cocina.
//
// Aquí vive lo poco que el TPV necesita para arreglarlo: pedirle al
// servidor el borrador de la venta rápida y acordarse de él mientras
// dure, incluso si la pestaña se recarga.

import type { CartLine } from "./cart.js";

/** El nº de mostrador de la venta en curso, para que una recarga no deje
 *  un borrador abierto en el servidor y sin dueño en la pantalla.
 *
 *  `sessionStorage` y no `localStorage`, por lo mismo que el carrito en
 *  curso (`persistedCart.ts`): es de esta pestaña y de este rato. */
const MOSTRADOR_KEY = "mipiacetpv-mostrador-en-curso";

export interface MostradorEnCurso {
  ticketId: string;
  numero: number;
  /**
   * auditoria-sirope (#11) · lo que lleva esta venta, para que el mapa
   * de sala lo pueda decir sin abrirla.
   *
   * Se guarda aquí y no se calcula en el mapa porque en cuanto la venta
   * tiene borrador sus líneas viven en el servidor y NO en el carrito
   * persistido: el mapa no tendría de dónde sacarlo.
   */
  total?: number;
}

/** «Mostrador nº 3». La misma frase que compone el servidor
 *  (`apps/api/src/kitchen/titulo.ts`) para titular la tarjeta de la
 *  pantalla de cocina y el papel: el camarero lee lo mismo en la caja que
 *  el cocinero en la tablet. */
export function etiquetaDeMostrador(numero: number): string {
  return `Mostrador nº ${numero}`;
}

export function leerMostradorEnCurso(): MostradorEnCurso | null {
  try {
    const raw = sessionStorage.getItem(MOSTRADOR_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as MostradorEnCurso;
    return typeof v?.ticketId === "string" ? v : null;
  } catch {
    return null;
  }
}

export function guardarMostradorEnCurso(v: MostradorEnCurso | null): void {
  try {
    if (v) sessionStorage.setItem(MOSTRADOR_KEY, JSON.stringify(v));
    else sessionStorage.removeItem(MOSTRADOR_KEY);
  } catch {
    /* cuota llena o modo privado: queda en memoria */
  }
}

/** Lo que el servidor necesita de cada línea del carrito. Mismo shape
 *  que al añadir una línea a una mesa. */
export function lineaParaElServidor(l: CartLine): Record<string, unknown> {
  return {
    ...(l.productId ? { productId: l.productId } : {}),
    ...(l.variantId ? { variantId: l.variantId } : {}),
    ...(l.holdedProductId ? { holdedProductId: l.holdedProductId } : {}),
    nameSnapshot: l.nameSnapshot,
    sku: l.sku,
    units: l.units,
    // El precio que se va a cobrar. Si el cajero lo cambió con el lápiz
    // (`unitPriceOverride`, que sólo existe en venta rápida) es ESE el
    // que viaja: el borrador del mostrador tiene que cobrar lo mismo que
    // cobraba el carrito, y los endpoints de línea de una mesa no tienen
    // override que heredar.
    unitPrice: l.unitPriceOverride ?? l.unitPrice,
    discountPct: l.discountPct,
    taxRate: l.taxRate,
    ...(l.modifiers && l.modifiers.length > 0
      ? { modifiers: l.modifiers.filter((m): m is string => typeof m === "string") }
      : {}),
    ...(l.modifierSelections && l.modifierSelections.length > 0
      ? {
          modifierSelections: l.modifierSelections.map((m) => ({
            groupId: m.groupId,
            modifierId: m.modifierId,
          })),
        }
      : {}),
    // El id del carrito viaja como `lineExternalId` para que la línea
    // del servidor NAZCA con el mismo id que la de la pantalla: así la
    // comanda, el estado de cocina y el `−`/`+` hablan de la misma cosa
    // sin tener que traducir ids en ningún sitio.
    ...(esUuidV4(l.id) ? { lineExternalId: l.id } : {}),
  };
}

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function esUuidV4(s: string): boolean {
  return UUID_V4.test(s);
}

/**
 * auditoria-sirope (#11) · LO QUE HAY APARCADO EN VENTA RÁPIDA.
 *
 * El 18-10 quedó una venta rápida de 3 € a medias y desde el mapa de
 * sala no se veía: el botón decía «Venta rápida» igual que si no hubiera
 * nada. Una mesa abierta se ve de lejos; una venta de mostrador a medias
 * no se veía de ninguna manera, y al cerrar el turno aparece sola.
 *
 * Dos sitios de donde puede salir, y se miran los dos:
 *
 *   · el carrito persistido de la venta rápida (`persistedCart`), que es
 *     lo que hay antes de que la venta tenga borrador;
 *   · el total del borrador de mostrador, que es lo que hay después.
 */
export function totalAparcadoEnVentaRapida(
  lineasDelCarrito: readonly CartLine[],
  totalDelCarrito: number,
): number {
  const mostrador = leerMostradorEnCurso();
  if (mostrador?.total != null && mostrador.total > 0) return mostrador.total;
  return lineasDelCarrito.length > 0 ? totalDelCarrito : 0;
}
