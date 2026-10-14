// kds-1-cocina · A DÓNDE VA CADA LÍNEA.
//
// Dos preguntas distintas que hasta este bloque estaban mezcladas:
//
//   1. **¿De qué sección es esta línea?** Por la etiqueta del producto
//      (`TagSection`); sin etiqueta, SALON. No cambia respecto a v1.4.
//   2. **¿Esa sección tiene a dónde ir?** Pantalla, impresora, las dos, o
//      nada. Esto es nuevo, y es lo que arregla el 409.
//
// ── EL 409 QUE SE VA ──────────────────────────────────────────────────
//
// Hasta hoy, una sección sin impresora WIFI configurada hacía que
// `dispatchKitchenTicket` devolviera 409 y **no marcara nada como enviado
// ni emitiera el evento**. O sea: en La Maestranza, donde la BARRA no
// tiene impresora, enviar una mesa con una caña no enviaba nada de nada.
//
// La decisión 2 lo cierra: «lo que no tiene destino (ni pantalla ni
// impresora) **se marca como enviado igualmente**; el envío no falla por
// eso». La caña se sirve de la barra, que es donde el camarero está; la
// comanda sólo tiene que dejar de bloquear a las bravas.
//
// ── QUÉ CUENTA COMO «TIENE PANTALLA» ──────────────────────────────────
//
// Que exista un dispositivo `KITCHEN` **vivo** (no revocado) en la tienda
// con esa sección entre las suyas. **No** que esté encendido ahora: una
// pantalla apagada o sin red sigue siendo el destino de esa sección, y la
// comanda la espera y le llega marcada «llegó tarde» cuando vuelve
// (decisión 9). Lo que hace el latido es decidir si ADEMÁS sale el papel
// de respaldo, y eso lo pregunta el TPV aparte (`GET /kitchen/latido`).
//
// Confundir las dos cosas tendría el fallo de siempre: una pantalla que se
// queda sin wifi diez segundos y una comanda que nunca se creó.

import type { KitchenSection } from "@mipiacetpv/db";

/** Lo que una sección tiene disponible. Una sección puede tener las dos. */
export interface DestinoSeccion {
  pantalla: boolean;
  impresora: boolean;
}

export const SECCIONES: readonly KitchenSection[] = [
  "BARRA",
  "COCINA",
  "SALON",
] as const;

/**
 * La sección de una línea, por la etiqueta de su producto.
 *
 * Idéntico a lo que hacía v1.4 (y por eso se mueve aquí sin tocarlo: era
 * la misma función copiada en tres ficheros). Sin producto o sin etiqueta
 * mapeada, SALON — que es «se lo lleva el camarero».
 */
export function resolverSeccion(
  productId: string | null,
  etiquetasPorProducto: Map<string, string[]>,
  seccionPorEtiqueta: Map<string, KitchenSection>,
): KitchenSection {
  if (!productId) return "SALON";
  for (const tag of etiquetasPorProducto.get(productId) ?? []) {
    const sec = seccionPorEtiqueta.get(tag);
    if (sec) return sec;
  }
  return "SALON";
}

/**
 * El mapa de destinos de una tienda.
 *
 * `moduloEncendido` es `Tenant.kitchenDisplayEnabled`. Apagado, **ninguna
 * sección tiene pantalla** aunque haya una tablet emparejada: el módulo se
 * cobra, y una capability apagada tiene que dejar el sistema exactamente
 * como estaba. El único cambio que sobrevive al apagado es el envío por
 * diferencias a la impresora, que es un arreglo y no una función nueva.
 */
export function construirDestinos(opts: {
  moduloEncendido: boolean;
  /** Las secciones de cada pantalla viva de la tienda. */
  pantallas: ReadonlyArray<{ kitchenSections: KitchenSection[] }>;
  /** Las secciones con impresora WIFI activa en esta caja. */
  seccionesConImpresora: ReadonlyArray<KitchenSection>;
}): Map<KitchenSection, DestinoSeccion> {
  const conPantalla = new Set<KitchenSection>();
  if (opts.moduloEncendido) {
    for (const p of opts.pantallas) {
      for (const sec of p.kitchenSections) conPantalla.add(sec);
    }
  }
  const conImpresora = new Set(opts.seccionesConImpresora);
  const out = new Map<KitchenSection, DestinoSeccion>();
  for (const sec of SECCIONES) {
    out.set(sec, {
      pantalla: conPantalla.has(sec),
      impresora: conImpresora.has(sec),
    });
  }
  return out;
}

export function destinoDe(
  destinos: Map<KitchenSection, DestinoSeccion>,
  section: KitchenSection,
): DestinoSeccion {
  return destinos.get(section) ?? { pantalla: false, impresora: false };
}

/**
 * ¿Lleva esta línea `−`/`+` cuando ya está en cocina?
 *
 * **La regla por destino de la decisión 6.** v2-H1 quitó el `−`/`+` de lo
 * enviado por una razón concreta: sin pantalla, un `−` quitaba el plato de
 * la cuenta mientras el papel seguía en la plancha y cocina **nunca se
 * enteraba**. Con pantalla, la anulación llega, así que el motivo
 * desaparece y queda sólo el riesgo del dedo gordo, que cubre el
 * «Deshacer» de 5 s.
 *
 * Sin pantalla el motivo sigue en pie, así que se mantiene lo de v2-H1:
 * sin `−`/`+` en lo enviado y «Anular» con el aviso «cocina ya tiene el
 * papel: díselo».
 *
 * Es por SECCIÓN y no por tienda porque una mesa puede tener las dos
 * cosas a la vez: las bravas a la pantalla de cocina (con `−`/`+`) y las
 * cañas a la impresora de la barra (sin).
 */
export function permiteCorregirEnviado(destino: DestinoSeccion): boolean {
  return destino.pantalla;
}

/**
 * ¿Se retiene este tiempo?
 *
 * **Lo de barra no se retiene nunca** (decisión 3): la bebida sale ya, y
 * un camarero que pide «dos cañas de segundo» no existe. Así que una línea
 * de BARRA marcha al enviar aunque su `course` sea 2, y el tiempo 2 de
 * BARRA que llega a la pantalla de barra llega MARCHADO.
 *
 * Tiene su propio sabotaje en la tabla del bloque («Retener la barra»).
 */
export function marchaAlEnviar(opts: {
  section: KitchenSection;
  course: number;
  /** Los tiempos de esta mesa que ya marcharon. */
  tiemposMarchados: ReadonlySet<number>;
}): boolean {
  if (opts.section === "BARRA") return true;
  if (opts.course <= 1) return true;
  return opts.tiemposMarchados.has(opts.course);
}
