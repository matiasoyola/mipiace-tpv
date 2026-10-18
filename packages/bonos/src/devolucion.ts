// B-reservas-8 · ¿se puede devolver la venta de este bono?
//
// **Una sola función para el botón y para el servidor** (decisión de
// Dirección, 18-10, y el mismo patrón que `por_que_no_editable()` del spa).
// Si el botón decidiera por su cuenta aparecería el caso de siempre: el TPV
// deja pulsar, el servidor contesta 409, y la cajera se queda mirando un
// mensaje que no esperaba después de haberla paseado por todo el modal.
//
// La regla es corta: **se devuelve sólo si no se ha tocado ninguna sesión.**
// Una sesión consumida es un trabajo hecho y una sesión apartada es una cita
// dada; devolver el dinero entero en cualquiera de los dos casos es regalar
// trabajo. La devolución PARCIAL queda fuera de alcance a propósito (y
// dicho en el prompt): exige decidir cuánto vale una sesión suelta de un
// bono vendido con descuento, que es la pregunta de P5.

export interface BonoParaDevolver {
  status: string;
  sesionesConsumidas: number;
  sesionesApartadas: number;
  /** Un bono de papel («alta inicial») no tiene venta que devolver. */
  tieneVenta: boolean;
}

export type MotivoNoDevolvible =
  | "ya_anulado"
  | "sin_venta"
  | "con_sesiones_consumidas"
  | "con_sesiones_apartadas";

export interface NoDevolvible {
  motivo: MotivoNoDevolvible;
  /** Lo que se le dice a la cajera: qué pasa y QUÉ HACER. */
  mensaje: string;
}

/**
 * `null` = se puede devolver. Si no, el motivo y la frase.
 *
 * El orden importa: primero lo que no tiene arreglo ninguno (ya anulado, o
 * un bono de papel que nunca tuvo venta) y luego lo que la cajera puede
 * desatascar ella misma (liberar las apartadas anulando esas citas).
 */
export function porQueNoDevolvible(bono: BonoParaDevolver): NoDevolvible | null {
  if (bono.status === "ANULADO") {
    return {
      motivo: "ya_anulado",
      mensaje: "Este bono ya está anulado: su venta se devolvió.",
    };
  }
  if (!bono.tieneVenta) {
    return {
      motivo: "sin_venta",
      mensaje:
        "Este bono se dio de alta a mano (venía en papel), así que no hay ninguna venta nuestra que devolver.",
    };
  }
  if (bono.sesionesConsumidas > 0) {
    return {
      motivo: "con_sesiones_consumidas",
      mensaje:
        `Este bono ya tiene ${bono.sesionesConsumidas} ${plural(bono.sesionesConsumidas, "sesión consumida", "sesiones consumidas")}: ` +
        "devolver la venta entera sería devolver un trabajo ya hecho. La devolución parcial no está en esta versión.",
    };
  }
  if (bono.sesionesApartadas > 0) {
    return {
      motivo: "con_sesiones_apartadas",
      mensaje:
        `Este bono tiene ${bono.sesionesApartadas} ${plural(bono.sesionesApartadas, "sesión apartada", "sesiones apartadas")} en citas. ` +
        "Anula esas citas para liberarlas y entonces se puede devolver.",
    };
  }
  return null;
}

function plural(n: number, uno: string, varios: string): string {
  return n === 1 ? uno : varios;
}
