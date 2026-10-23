// n1-hosteleria-2 · hallazgo 2 · LAS ZONAS SE PLIEGAN, Y PLEGADAS DICEN
// LO QUE IMPORTA.
//
// Matías, 23-10: en «Todas» hay que hacer zoom del sistema para ver la
// sala. Y el zoom de Android en un TPV es lo peor de los dos mundos: lo
// escala TODO (así que lo que gana de tamaño lo pierde de pantalla), no
// se recuerda, y mientras está puesto el resto de la app también está
// ampliada.
//
// La pasada del 23-10 medía 14 de las 23 mesas de Sirope a la vista, que
// cumplía el criterio de aquel bloque («al menos 9»). Lo que ese criterio
// no dice es que las 14 son las de arriba: BARRA entera y media sala. Para
// ver Terraza hay que desplazar, y desplazar en una lista de tres marcos
// de zona no te dice cuánto te queda.
//
// La salida no es hacer las mesas más pequeñas —R4 va justo en contra—,
// es que el camarero pueda **apartar** la zona que no está mirando. Y
// para que apartarla no sea perder información, la cabecera plegada
// tiene que decir lo único que se consulta de una zona que no se está
// mirando: cuántas mesas tiene ocupadas, cuántas por recoger y cuántas
// con algo listo en el pase.
//
// Vive en un módulo propio y no en `TableMapScreen` porque son dos cosas
// que un banco tiene que poder recorrer sin navegador: el resumen (que
// es aritmética sobre las mesas) y el recuerdo (que es `localStorage`, y
// `localStorage` en un TPV falla de maneras que hay que probar).

/** Lo que una zona plegada tiene que poder decir de sí misma. */
export interface ResumenDeZona {
  total: number;
  ocupadas: number;
  porRecoger: number;
  listas: number;
}

/**
 * Las mesas de una zona, contadas por lo que el camarero actúa.
 *
 * `ocupadas` incluye «pide la cuenta»: las dos son mesas con gente y con
 * cuenta abierta, y desde una cabecera plegada no se decide nada
 * distinto para una que para la otra — se decide ir. Que «pide la
 * cuenta» se distingue de «ocupada» importa cuando se ve la mesa, y
 * entonces la zona está desplegada y el relleno ámbar lo dice.
 *
 * `listas` no sale del estado de la mesa sino de los avisos de cocina
 * (`useAvisosListo`), que es de la TIENDA: una mesa puede estar ocupada
 * y tener dos platos en el pase, y las dos cosas se cuentan.
 */
export function resumenDeZona(
  mesas: Array<{ id: string; state: string }>,
  mesasListas?: ReadonlySet<string>,
): ResumenDeZona {
  let ocupadas = 0;
  let porRecoger = 0;
  let listas = 0;
  for (const m of mesas) {
    if (m.state === "POR_RECOGER") porRecoger++;
    else if (m.state !== "FREE") ocupadas++;
    if (mesasListas?.has(m.id) === true) listas++;
  }
  return { total: mesas.length, ocupadas, porRecoger, listas };
}

/**
 * El rótulo de una zona plegada.
 *
 * Se escribe aquí y no en el JSX porque la regla es de redacción y hay
 * que poder leerla de una pieza: **sólo se nombra lo que no es cero.**
 * Una cabecera que dijera «0 ocupadas · 0 por recoger · 0 listos» son
 * tres números que el camarero tiene que leer para enterarse de que no
 * pasa nada, y en la mano eso es peor que no poner nada. Con todo a cero
 * dice «libre», que es la única palabra que hace falta.
 *
 * Y van en este orden porque es el de la urgencia: un plato en el pase se
 * enfría, una mesa ocupada espera, y una por recoger no espera a nadie.
 */
export function rotuloDeZonaPlegada(r: ResumenDeZona): string {
  const partes: string[] = [];
  if (r.listas > 0) {
    partes.push(`${r.listas} ${r.listas === 1 ? "listo" : "listos"}`);
  }
  if (r.ocupadas > 0) {
    partes.push(`${r.ocupadas} ${r.ocupadas === 1 ? "ocupada" : "ocupadas"}`);
  }
  if (r.porRecoger > 0) partes.push(`${r.porRecoger} por recoger`);
  if (partes.length === 0) {
    return r.total === 1 ? "1 mesa libre" : `${r.total} libres`;
  }
  return partes.join(" · ");
}

/**
 * Dónde se recuerda qué zonas están plegadas.
 *
 * Es del APARATO y no del cajero: el hallazgo pide que «el estado
 * plegado se recuerda en el aparato». Un camarero con el N1 en la mano
 * pliega Terraza porque esa noche no sirve en Terraza, no porque sea él.
 * Si colgara del cajero, cambiar de turno repondría las tres zonas y
 * habría que volver a plegarlas.
 */
const ZONAS_PLEGADAS_KEY = "mipiacetpv-zonas-plegadas";

/**
 * Qué zonas están plegadas, según el aparato.
 *
 * Falla hacia **desplegado**, y en las dos direcciones: sin
 * `localStorage` (modo privado, cuota llena) y con basura dentro. Una
 * zona desplegada de más se ve y se pliega; una plegada de más esconde
 * mesas que el camarero cree que no existen, y eso en un servicio es una
 * mesa sin atender.
 */
export function leerZonasPlegadas(): Set<string> {
  try {
    const raw = localStorage.getItem(ZONAS_PLEGADAS_KEY);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((z): z is string => typeof z === "string"));
  } catch {
    return new Set();
  }
}

/** Guarda el estado plegado. Si no se puede guardar, no se rompe nada. */
export function guardarZonasPlegadas(zonas: ReadonlySet<string>): void {
  try {
    localStorage.setItem(ZONAS_PLEGADAS_KEY, JSON.stringify([...zonas]));
  } catch {
    // Sin sitio para guardar, el pliegue dura lo que dure la pantalla.
    // Es peor dejar de plegar que no recordarlo.
  }
}

/** Sólo para tests: deja el aparato sin memoria de pliegues. */
export function olvidarZonasPlegadas(): void {
  try {
    localStorage.removeItem(ZONAS_PLEGADAS_KEY);
  } catch {
    /* nada que olvidar */
  }
}

/**
 * ¿Se pueden plegar las zonas?
 *
 * Sólo en la mano y sólo en «Todas». Con el filtro de una zona puesto
 * hay una sola sección en pantalla, y plegar la única que hay deja el
 * lienzo vacío con una cabecera: el camarero ya eligió qué quiere ver,
 * y el chip de zona es la forma de cambiar de opinión.
 *
 * En el terminal no se pliega nunca: las 23 mesas de Sirope caben
 * enteras a 1280 y a 1442 (23/23 medidas), así que plegar sólo quitaría
 * de la vista algo que ya se ve. Es la restricción del bloque.
 */
export function zonasSePliegan(opts: {
  deMano: boolean;
  filtro: string;
}): boolean {
  return opts.deMano && opts.filtro === "ALL";
}
