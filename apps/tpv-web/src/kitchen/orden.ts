// kds-2b · EL ORDEN DE LOS PLATOS DE UNA TARJETA NO CAMBIA AL TACHARLOS.
//
// ── Lo que pasó en el AP11 el 15-10 ───────────────────────────────────
//
// El cocinero tachaba un plato y ese plato se iba al FINAL de su tarjeta,
// con los demás subiendo un sitio. Con prisa, el siguiente toque cae en el
// plato que acaba de ocupar el hueco: se tacha —o se destacha— el que no
// era, y en una cocina eso se nota cuando falta un plato en el pase.
//
// La causa estaba en el servidor: `GET /kitchen/comandas` seleccionaba las
// líneas **sin `orderBy`**, así que Postgres las devolvía en el orden
// físico de la tabla, y un `UPDATE` —el `done_at` del tachado— reescribe la
// fila al final. El servidor ya ordena (kds-2b), pero esta pieza se queda
// puesta y es la que de verdad arregla el salto:
//
//   · un servidor sin desplegar sigue mandando las líneas como le salgan, y
//     esta rama llega en una APK, sin tocar el servidor;
//   · y nadie guarda el orden en que el camarero tecleó la comanda (ni
//     `KitchenOrderLine` ni `TicketLine` tienen columna de posición), así
//     que el único orden que la pantalla puede prometer es **el que vio la
//     primera vez**.
//
// ── La regla ──────────────────────────────────────────────────────────
//
// Una línea se queda donde estaba desde que la pantalla la vio por primera
// vez. Las que llegan después van al final, en el orden en que lleguen. No
// hay ninguna otra ordenación: ni por tiempo, ni por silla, ni por nombre.
// Reordenar «mejor» a mitad de servicio es exactamente el fallo que esto
// viene a quitar.
//
// El orden de las TARJETAS no es asunto de aquí: lo pone `repartirTarjetas`
// (kds-1c) y sigue siendo el único sitio donde las tarjetas se ordenan.

import type { Comanda } from "./types.js";

/**
 * Lo que la pantalla recuerda: por tarjeta, los ids de sus líneas en el
 * orden en que las vio por primera vez.
 *
 * Vive en un `useRef` de `KitchenScreen` y se pasa y se devuelve, en vez de
 * ser un módulo con estado: así el test puede empujar tres pasadas seguidas
 * y mirar el resultado sin tener que reiniciar nada entre ellas.
 */
export type MemoriaDeOrden = Map<string, string[]>;

export function memoriaDeOrdenVacia(): MemoriaDeOrden {
  return new Map();
}

/**
 * Devuelve las comandas con las líneas en el orden recordado, y la memoria
 * al día.
 *
 * La memoria que sale **sólo lleva las tarjetas que están ahora** en la
 * lista: una comanda servida no tiene que dejar su orden en la memoria de
 * una tablet que lleva doce horas encendida.
 *
 * Una tarjeta que vuelve después de desaparecer (la recuperas desde «Hoy»)
 * empieza de cero, y está bien: es una tarjeta que el cocinero vuelve a
 * leer entera.
 */
export function ordenEstable(
  comandas: readonly Comanda[],
  memoria: MemoriaDeOrden,
): { comandas: Comanda[]; memoria: MemoriaDeOrden } {
  const siguiente: MemoriaDeOrden = new Map();
  const salida = comandas.map((c) => {
    const vistas = memoria.get(c.id) ?? [];
    const presentes = new Map(c.lines.map((l) => [l.id, l]));
    const orden: string[] = [];
    const lines = [];
    // 1 · las que ya se habían visto, en el orden de entonces. Una que ya
    //     no está en la comanda (la anuló el camarero del todo y el
    //     servidor dejó de mandarla) se cae de la memoria sin más.
    for (const id of vistas) {
      const l = presentes.get(id);
      if (!l) continue;
      lines.push(l);
      orden.push(id);
      presentes.delete(id);
    }
    // 2 · y las nuevas al final, en el orden en que vengan.
    for (const l of c.lines) {
      if (!presentes.has(l.id)) continue;
      lines.push(l);
      orden.push(l.id);
    }
    siguiente.set(c.id, orden);
    // Sin cambios, se devuelve la MISMA comanda: así un `React.memo` o una
    // comparación por identidad siguen funcionando igual que antes.
    const igual =
      lines.length === c.lines.length &&
      lines.every((l, i) => l === c.lines[i]);
    return igual ? c : { ...c, lines };
  });
  return { comandas: salida, memoria: siguiente };
}
