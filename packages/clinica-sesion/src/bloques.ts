// clinica-5 · las listas de los tipos que son UNA TARJETA DE BOTONES.
//
// Revisión de cirugía, biomecánica y general. Las tres juntas en un
// fichero y no una cada una, a propósito: lo que tienen dentro son listas
// cortas de botones y ninguna tiene cálculo. El nivel de la quiropodia y
// el riesgo del pie viven en sus ficheros porque tienen una REGLA que
// Rosario va a querer mover; esto es vocabulario.
//
// Decisión 8 del prompt sobre biomecánica y general: *«en esta versión son
// una tarjeta de botones sencilla. No se diseña más aquí.»* Dicho de otra
// manera, el bloque sabe que son menos de lo que van a ser, y lo que no
// hace es inventarse ahora los ángulos y la patomecánica que COGECOP tiene
// (`referencia-cogecop.md` §3.4) sin que nadie los haya pedido.

/** Una opción de botón: id estable + cómo se lee. La forma de todas las
 *  listas de este fichero. */
export interface Opcion {
  id: string;
  label: string;
}

export interface ListaDeOpciones {
  version: number;
  opciones: readonly Opcion[];
}

/** La versión de las tres listas de este fichero, juntas. Van juntas
 *  porque cambian juntas: el día que biomecánica se diseñe de verdad, su
 *  tarjeta entera cambia y la de cirugía probablemente también. */
export const VERSION_DE_LOS_BLOQUES = 1;

// ── Revisión de cirugía (decisión 7) ──────────────────────────────────

/**
 * Cómo está la herida. Los cuatro estados del mockup, de mejor a peor —
 * y el orden importa porque es el que la podóloga recorre con el dedo.
 *
 * `INFECCION` es el que dispara la alerta cruzada con la diabetes
 * (`alertas-cruzadas.ts`). Su id está escrita ahí, así que renombrarla
 * rompe la alerta: el test de la alerta cruzada se pone rojo si pasa.
 */
export const ESTADOS_DE_HERIDA: ListaDeOpciones = {
  version: VERSION_DE_LOS_BLOQUES,
  opciones: [
    { id: "CICATRIZADA", label: "Cicatrizada" },
    { id: "BIEN", label: "Evoluciona bien" },
    { id: "EXUDADO", label: "Exudado" },
    { id: "INFECCION", label: "Signos de infección" },
  ],
};

/** Los dos del mockup. No hay «los lleva y siguen puestos» porque eso es
 *  no haber contestado: la pregunta de la revisión es si HOY se le han
 *  quitado. */
export const PUNTOS_DE_LA_HERIDA: ListaDeOpciones = {
  version: VERSION_DE_LOS_BLOQUES,
  opciones: [
    { id: "RETIRADOS", label: "Retirados hoy" },
    { id: "NO_LLEVA", label: "No lleva" },
  ],
};

// ── Biomecánica (decisión 8) ──────────────────────────────────────────

/**
 * El tipo de pie DESCRIPTIVO de la biomecánica.
 *
 * Ojo: no es el `TIPOS_DE_PIE` de la exploración de clinica-3, que tiene
 * los mismos tres valores y otro sitio. Y están separados a propósito: el
 * de la exploración es la foto anual del pie (vive en su `FOOT_EXAM`), y
 * éste es lo que la podóloga anota en una visita de biomecánica, que puede
 * no coincidir con la exploración de hace ocho meses. Fusionarlos habría
 * obligado a decidir cuál manda, y ninguno manda: son dos observaciones
 * con dos fechas.
 */
export const TIPOS_DE_PIE_BIOMECANICA: ListaDeOpciones = {
  version: VERSION_DE_LOS_BLOQUES,
  opciones: [
    { id: "PLANO", label: "Pie plano" },
    { id: "NORMAL", label: "Pie normal" },
    { id: "CAVO", label: "Pie cavo" },
  ],
};

export const PISADAS: ListaDeOpciones = {
  version: VERSION_DE_LOS_BLOQUES,
  opciones: [
    { id: "PRONADOR", label: "Pronador" },
    { id: "NEUTRO", label: "Neutro" },
    { id: "SUPINADOR", label: "Supinador" },
  ],
};

// ── Las utilidades que usan las tres ──────────────────────────────────

export function esOpcionDe(lista: ListaDeOpciones, x: unknown): boolean {
  return (
    typeof x === "string" && lista.opciones.some((o) => o.id === x)
  );
}

/** Cómo se lee una opción. La id tal cual si no se reconoce: lo escrito
 *  tiene que seguir viéndose (misma regla que `nombreDeZona`). */
export function nombreDeOpcion(lista: ListaDeOpciones, id: string): string {
  return lista.opciones.find((o) => o.id === id)?.label ?? id;
}

/** El valor si es de la lista, `null` si no. Lo usa la normalización de
 *  los bloques: lo que no es de la lista no entra en la historia, y se
 *  tira en silencio por la misma razón que `limpiarMarcas`. */
export function opcionValida(
  lista: ListaDeOpciones,
  x: unknown,
): string | null {
  return esOpcionDe(lista, x) ? (x as string) : null;
}
