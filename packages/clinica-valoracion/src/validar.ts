// clinica-2 · ¿se puede validar esta valoración? Y si no, POR QUÉ.
//
// Pura, y el «por qué» es parte del contrato, no un extra. En el mockup
// validado el botón «Validar valoración» sale DESACTIVADO con el motivo
// escrito al lado, y eso obliga a que la misma función conteste las dos
// cosas: un botón gris sin explicación es una pantalla que no dice nada, y
// dos funciones (una que decide y otra que redacta) acabarían
// discrepando.
//
// La usan el front (para pintar el botón y el motivo, sin ir al servidor)
// y la ruta de validar (para no fiarse del front). La misma, no dos.
//
// ── Las tres confirmaciones, y por qué son tres y no una ──────────────
//
// Decisión de producto (Matías, 05-10): tres confirmaciones antes del
// primer tratamiento. No es burocracia repetida: son tres actos
// distintos.
//
//   · «He revisado las alergias con el paciente» — lo que puede matar en
//     la silla (anestesia, látex).
//   · «He revisado la medicación que toma» — lo que cambia el sangrado.
//   · «Las alertas de arriba son correctas» — que la lista que el sistema
//     dedujo coincide con lo que la persona tiene delante.
//
// Una sola casilla «lo he revisado todo» se marca sin leer. Tres con
// nombre propio obligan a mirar tres cosas, y la tercera además cierra el
// círculo: hace que alguien firme que lo que el sistema calculó es verdad.

import {
  preguntasEnJuego,
  type Cuestionario,
  type EstadoValoracion,
  type Respuesta,
} from "./cuestionario.js";
import { correccionesVigentes, type EstadoRespuestas } from "./vigente.js";

export interface Confirmaciones {
  alergias: boolean;
  medicacion: boolean;
  alertas: boolean;
}

export const CONFIRMACIONES_VACIAS: Confirmaciones = {
  alergias: false,
  medicacion: false,
  alertas: false,
};

/** Los textos del mockup, en un solo sitio: la pantalla los pinta y el
 *  done del bloque los cita. */
export const TEXTO_CONFIRMACION: Readonly<Record<keyof Confirmaciones, string>> =
  {
    alergias: "He revisado las alergias con el paciente",
    medicacion: "He revisado la medicación que toma",
    alertas: "Las alertas de arriba son correctas",
  };

export type MotivoNoValidable =
  | "NO_RESPONDIDA"
  | "YA_VALIDADA"
  | "SIN_RESOLVER"
  | "FALTAN_CONFIRMACIONES"
  | "VERSION_DESCONOCIDA";

export type Validable =
  | { puede: true }
  | { puede: false; motivo: MotivoNoValidable; mensaje: string };

export interface EntradaValidar extends EstadoRespuestas {
  cuestionario: Cuestionario | null;
  estado: EstadoValoracion;
  confirmaciones: Confirmaciones;
}

/**
 * ¿Se puede validar?
 *
 * El orden de las negativas importa y es el de lo que la persona puede
 * hacer al respecto:
 *
 *   1. No se puede leer el cuestionario → no hay nada que decidir.
 *   2. El paciente no ha contestado → no es que falte algo, es que no hay
 *      valoración; lo que toca es mandarle el test, no marcar casillas.
 *   3. Ya está validada → no se re-valida (se repasa con una nueva).
 *   4. Hay «No lo sé» → hay que resolverlo CON EL PACIENTE. Va antes que
 *      las confirmaciones porque es trabajo con la persona delante y las
 *      casillas son un gesto de dos segundos: pedir primero lo que
 *      necesita al paciente evita marcarlas y descubrir después que había
 *      que volver a preguntarle.
 *   5. Faltan confirmaciones.
 */
export function puedeValidarse(entrada: EntradaValidar): Validable {
  if (!entrada.cuestionario) {
    return no(
      "VERSION_DESCONOCIDA",
      "Esta valoración se contestó con una versión del cuestionario que este sistema no conoce. Avisa a Mi Piace.",
    );
  }
  if (entrada.estado === "PENDIENTE_PACIENTE") {
    return no(
      "NO_RESPONDIDA",
      "El paciente todavía no ha contestado el test.",
    );
  }
  if (entrada.estado === "VALIDADA") {
    return no(
      "YA_VALIDADA",
      "Esta valoración ya está validada. Si algo ha cambiado, se repasa con una valoración nueva.",
    );
  }

  const vigentes = correccionesVigentes(entrada.correcciones);
  const valorDe = (id: string): Respuesta | undefined =>
    vigentes.get(id)?.valor ?? entrada.respuestasPaciente[id];
  const sinResolver = preguntasEnJuego(entrada.cuestionario, valorDe)
    .filter((p) => (valorDe(p.id) ?? "NO_SE") === "NO_SE")
    .map((p) => p.id);

  if (sinResolver.length > 0) {
    // El mensaje es el del mockup, con su singular y su plural: lo lee una
    // persona de pie al lado de otra.
    return no(
      "SIN_RESOLVER",
      sinResolver.length === 1
        ? "Queda 1 respuesta «No lo sé» por resolver con el paciente."
        : `Quedan ${sinResolver.length} respuestas «No lo sé» por resolver con el paciente.`,
    );
  }

  const c = entrada.confirmaciones;
  if (!c.alergias || !c.medicacion || !c.alertas) {
    return no("FALTAN_CONFIRMACIONES", "Marca las tres confirmaciones.");
  }

  return { puede: true };
}

function no(motivo: MotivoNoValidable, mensaje: string): Validable {
  return { puede: false, motivo, mensaje };
}
