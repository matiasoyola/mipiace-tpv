// clinica-2 · LA función que contesta «¿puede este paciente recibir su
// primer tratamiento?».
//
// Una sola, pura, y **escrita aquí para que `clinica-3` la use como
// puerta**. Este bloque no construye la entrada de tratamiento (está fuera
// de alcance): la escribe, la exporta y la testea. Cuando llegue la
// sesión, la puerta ya existe y nadie tiene que acordarse de la regla.
//
// Es el mismo patrón y la misma razón que `clinica/acceso.ts`: si cada
// pantalla dedujera por su cuenta si hay valoración validada, la que se
// olvidara dejaría registrar un tratamiento sobre un diabético
// anticoagulado del que nadie sabe nada. Ese es el fallo que el bloque
// entero existe para cerrar, y una regla repetida en dos sitios es una
// regla que algún día estará en uno.
//
// ── Qué cuenta como «sí» ──────────────────────────────────────────────
//
// Que exista una valoración VALIDADA de este paciente. Nada más, y en
// particular:
//
//   · **No caduca.** La ley no pone plazo y Dirección no lo ha fijado;
//     inventarme uno aquí convertiría una decisión de producto en un
//     número escondido en una función. Lo que SÍ está decidido es cómo se
//     repasa: creando una valoración nueva (decisión 7). Queda como duda
//     abierta en el done.
//   · **Un repaso abierto no quita el permiso.** Si hay una validada y
//     además una nueva a medias («¿algo ha cambiado?»), se puede tratar:
//     lo que está en la historia es la validación anterior, y suspender la
//     consulta porque alguien empezó a repasar sería castigar el repaso.
//   · **Una valoración RESPONDIDA no basta.** El paciente contestó y nadie
//     lo ha mirado. El bloque entero es para que eso no pase por
//     validación.

import type { EstadoValoracion } from "./cuestionario.js";

/** Lo mínimo que hace falta saber de cada valoración del paciente. */
export interface ValoracionParaPuerta {
  id: string;
  estado: EstadoValoracion;
  /** ISO-8601. `null` mientras no está validada. */
  validadaEn: string | null;
}

export type MotivoSinTratamiento =
  | "SIN_VALORACION"
  | "VALORACION_SIN_RESPONDER"
  | "VALORACION_SIN_VALIDAR";

export type PuertaPrimerTratamiento =
  | {
      puede: true;
      /** La valoración que lo permite: la validada más reciente. Va en la
       *  respuesta para que la entrada de tratamiento de `clinica-3` pueda
       *  colgar de ella y el histórico diga de qué valoración salió. */
      valoracionId: string;
      validadaEn: string;
    }
  | { puede: false; motivo: MotivoSinTratamiento; mensaje: string };

const MENSAJES: Record<MotivoSinTratamiento, string> = {
  SIN_VALORACION:
    "Este paciente no tiene valoración inicial. Mándale el test o ábrelo en la tablet antes del primer tratamiento.",
  VALORACION_SIN_RESPONDER:
    "El paciente todavía no ha contestado el test de la valoración inicial.",
  VALORACION_SIN_VALIDAR:
    "La valoración inicial está contestada pero sin validar. Revísala con el paciente y válidala antes del primer tratamiento.",
};

/**
 * Pura: mismas valoraciones, misma respuesta. Sin base de datos y sin
 * reloj — que no haya reloj es lo que hace que no pueda caducar por
 * descuido (ver la cabecera).
 *
 * El orden de las negativas va de «no hay nada» a «falta el último paso»,
 * porque el mensaje tiene que decir QUÉ HACER y las tres cosas que hacer
 * son distintas: mandar el test, esperar al paciente, o validar.
 */
export function puedeRecibirPrimerTratamiento(
  valoraciones: readonly ValoracionParaPuerta[],
): PuertaPrimerTratamiento {
  const validadas = valoraciones
    .filter((v) => v.estado === "VALIDADA" && v.validadaEn != null)
    .sort((a, b) => (a.validadaEn! < b.validadaEn! ? 1 : -1));

  const ultima = validadas[0];
  if (ultima) {
    return {
      puede: true,
      valoracionId: ultima.id,
      validadaEn: ultima.validadaEn!,
    };
  }

  if (valoraciones.some((v) => v.estado === "RESPONDIDA")) {
    return no("VALORACION_SIN_VALIDAR");
  }
  if (valoraciones.some((v) => v.estado === "PENDIENTE_PACIENTE")) {
    return no("VALORACION_SIN_RESPONDER");
  }
  return no("SIN_VALORACION");
}

function no(motivo: MotivoSinTratamiento): PuertaPrimerTratamiento {
  return { puede: false, motivo, mensaje: MENSAJES[motivo] };
}
