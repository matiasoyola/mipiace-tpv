// n1-hosteleria-2 · hallazgo 9 · UN AVISO DE «LISTO» NO ES UN BOTÓN DE
// «HECHO»: ES UNA LISTA DE LO QUE HAY QUE COGER DEL PASE.
//
// Matías, 23-10, ya con la 1.29.0 en la mano: al pulsar un aviso de
// cocina, hoy el TPV lo da por servido en el acto. El camarero toca y el
// aviso desaparece — y entonces tiene que acordarse de qué era, porque la
// única pista que había es el nombre de la mesa.
//
// Lo que tiene que pasar: el aviso abre **una hoja por mesa** con lo que
// está listo —cantidad, el nombre ENTERO y los alérgenos marcados— y un
// «Hecho» grande abajo. El «Hecho» es el que sirve.
//
// ── POR QUÉ NO ES UN CAMBIO DE LA MANO ────────────────────────────────
//
// Es un cambio de FLUJO, no de reparto, así que va en todos los aparatos
// (N1, AP11, AP12, AP13 y D8). En la mano cumple R1–R4; en los grandes,
// con su propio tamaño. Un camarero que aprende el gesto en el móvil y
// encuentra otro en el terminal de la barra ha aprendido dos cosas para
// la misma tarea — y la que le sale mal es la del terminal, porque ahí el
// toque es más barato y el «hecho» directo más fácil de disparar sin
// querer.
//
// Es la SEGUNDA excepción declarada a «los terminales no cambian ni un
// píxel», y está anotada en el §0 del `-done` con sus capturas.

/** Una línea que está esperando en el pase. */
export interface LineaLista {
  id: string;
  name: string;
  units: number;
  allergens: string[];
}

/** Lo que una comanda lista sabe de sí misma. */
export interface ListaDeCocina {
  orderId: string;
  /** Ausente o nulo en una venta sin mesa, y en lo que llega por la wifi. */
  tableId?: string | null;
  tableName: string | null;
  /** Ausente en lo que llega por la wifi, que no distingue sección. */
  section?: string;
  readyAt: string;
  lines?: LineaLista[];
}

/** Todo lo que una MESA tiene esperando en el pase, de todas sus comandas. */
export interface MesaLista {
  /** `null` en una venta sin mesa; se agrupa por `orderId`. */
  tableId: string | null;
  tableName: string | null;
  /** Las comandas que el «Hecho» de esta hoja va a servir. */
  orderIds: string[];
  /** La más antigua de la mesa: es la que ordena. */
  readyAt: string;
  lineas: LineaLista[];
  /** Cuántas secciones distintas hay detrás (cocina, barra…). */
  secciones: string[];
}

/**
 * Agrupa lo listo **por mesa**, que es la unidad del hallazgo 9: «si hay
 * varias mesas listas, una hoja por mesa».
 *
 * Una mesa puede tener DOS comandas listas a la vez —las bravas en la
 * pantalla de cocina y las cañas en la de barra— y el camarero hace un
 * solo viaje. Así que la hoja es de la mesa y el «Hecho» sirve las dos:
 * de ahí que `orderIds` sea una lista y no un id.
 *
 * Las ventas sin mesa (`tableId` nulo) no se agrupan entre sí: cada una
 * es su propia hoja, porque dos mostradores distintos no comparten viaje.
 *
 * El orden es el de la decisión 5 de kds-1 —de más antigua a más nueva—
 * porque el camarero coge lo que lleva más tiempo en el pase.
 */
export function agruparListasPorMesa(
  listas: readonly ListaDeCocina[],
): MesaLista[] {
  const porMesa = new Map<string, MesaLista>();
  for (const l of listas) {
    // Sin mesa, cada comanda va sola: la clave es su propio id.
    const clave = l.tableId ?? `sin-mesa:${l.orderId}`;
    const ya = porMesa.get(clave);
    if (ya) {
      ya.orderIds.push(l.orderId);
      ya.lineas.push(...(l.lines ?? []));
      const sec = l.section ?? "COCINA";
      if (!ya.secciones.includes(sec)) ya.secciones.push(sec);
      // La más antigua manda: la lista llega ordenada, pero no se da por
      // supuesto.
      if (l.readyAt < ya.readyAt) ya.readyAt = l.readyAt;
      continue;
    }
    porMesa.set(clave, {
      tableId: l.tableId ?? null,
      tableName: l.tableName,
      orderIds: [l.orderId],
      readyAt: l.readyAt,
      lineas: [...(l.lines ?? [])],
      secciones: [l.section ?? "COCINA"],
    });
  }
  return [...porMesa.values()].sort((a, b) => a.readyAt.localeCompare(b.readyAt));
}

/** La hoja de una mesa concreta, o `null` si esa mesa ya no tiene nada. */
export function hojaDeLaMesa(
  listas: readonly ListaDeCocina[],
  tableId: string | null,
  orderId?: string,
): MesaLista | null {
  const grupos = agruparListasPorMesa(listas);
  if (tableId != null) {
    return grupos.find((g) => g.tableId === tableId) ?? null;
  }
  if (orderId != null) {
    return grupos.find((g) => g.orderIds.includes(orderId)) ?? null;
  }
  return null;
}

/**
 * ¿La hoja de «listo» ocupa la pantalla entera?
 *
 * En la mano sí, por R1: una sola capa a la vista. En el terminal no —
 * ahí la hoja sale centrada, como el resto de los diálogos de la casa, y
 * tapar 1280×800 enteros para enseñar tres líneas sería esconder la sala
 * a un cajero que está de pie delante de ella.
 *
 * Lo que NO cambia con el tamaño es el FLUJO: en los dos, el aviso abre
 * la hoja y lo que sirve es el «Hecho». Ver `n1-listo-hoja.test.ts`.
 */
export function hojaDeListoOcupaLaPantalla(deMano: boolean): boolean {
  return deMano;
}

/**
 * El rótulo de una línea lista: «2 · Café con leche».
 *
 * La cantidad delante y el nombre ENTERO. Nada de truncar: el nombre es
 * lo que el camarero compara con lo que hay en el pase, y «Café…» no
 * distingue un americano de un cortado — que es exactamente el 🔴 que
 * `n1-hosteleria` arregló en la comanda (§3.3 de su `-done`).
 */
export function rotuloDeLinea(l: LineaLista): string {
  const n = Number.isInteger(l.units) ? String(l.units) : l.units.toFixed(2);
  return `${n} · ${l.name}`;
}

/** ¿Lleva alérgenos esta mesa? Es lo que decide si la hoja los marca. */
export function alergenosDeLaMesa(m: MesaLista): string[] {
  const out: string[] = [];
  for (const l of m.lineas) {
    for (const a of l.allergens ?? []) if (!out.includes(a)) out.push(a);
  }
  return out;
}
