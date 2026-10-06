// clinica-2 · el cuestionario de la valoración inicial, VERSIONADO.
//
// ── Por qué está versionado, y por qué eso no es una tabla ────────────
//
// La valoración guarda CON QUÉ VERSIÓN se contestó. Si mañana la podóloga
// cambia el texto de una pregunta, añade una o quita otra, lo que un
// paciente contestó el año pasado sigue leyéndose bien: la pantalla del
// sanitario pide la versión que dice la valoración, no «la de ahora».
// Sin esto, una historia clínica de hace dos años se pintaría con las
// preguntas de hoy — que es decir que el paciente contestó algo que no se
// le preguntó. En un registro legal eso no es un detalle de UI.
//
// Y es **dato por defecto del módulo, en código**, no una tabla editable:
// editar el cuestionario desde una pantalla está FUERA DE ALCANCE por el
// prompt del bloque (lo ajusta Mi Piace con la podóloga). Una tabla sin
// pantalla que la edite no es más flexible que una constante: es la misma
// rigidez con una migración de por medio y sin revisión de código. Cuando
// haya pantalla, esta constante se convierte en la fila `version = 1` y
// `cuestionarioDeVersion` pasa a leer de la base; nada de lo que cuelga de
// aquí (alertas, validación, el test del paciente) cambia de forma.
//
// ── Está escrito para personas mayores ────────────────────────────────
//
// Decisión de producto (Matías, 05-10-2026): palabras de la calle, no
// vocabulario clínico. «Pastillas para que la sangre no coagule» y no
// «anticoagulantes orales»; «tener azúcar» en la ayuda de la diabetes.
// Los textos de este fichero son los del mockup validado
// (`docs/mockups/clinica-2-valoracion.html`), carácter por carácter: son
// la pregunta que se le hace a una persona de 78 años en una tablet, y no
// se reescriben sin volver a validarlos.

/** Lo que puede contestar una persona. «No lo sé» es una respuesta. */
export type Respuesta = "SI" | "NO" | "NO_SE";

/** Quién tecleó. Decisión de producto: puede responder un familiar, y
 *  queda dicho quién — una respuesta de segunda mano se lee distinto. */
export type RespondioPor = "PACIENTE" | "FAMILIAR";

/** Los dos canales por los que se contesta. No hay un tercero: WhatsApp y
 *  SMS están fuera de alcance (no hay proveedor). */
export type CanalValoracion = "EMAIL" | "TABLET";

export type EstadoValoracion =
  | "PENDIENTE_PACIENTE"
  | "RESPONDIDA"
  | "VALIDADA";

export interface Pregunta {
  /** Corto y estable: viaja dentro del `body` de la historia PARA SIEMPRE.
   *  Renombrar uno rompe la lectura de lo ya contestado; para cambiar una
   *  pregunta se saca una versión nueva del cuestionario. */
  id: string;
  /** La pregunta, tal como la lee el paciente. */
  texto: string;
  /** La ayuda debajo, en palabras de la calle. Vacía si no hace falta. */
  ayuda: string;
  /** Qué alerta sale de un «Sí». `null` = un «Sí» informativo que NO es
   *  una alerta (artrosis, operaciones, tabaco): está en la historia y no
   *  en la franja roja. */
  alerta: string | null;
  /** El nombre corto de la fila en la pantalla del sanitario. */
  corto: string;
  /**
   * El prefijo de la alerta CUANDO hay detalle marcado. En el mockup la
   * alerta de alergias es «Alergias» a secas y «Alergia: látex» con
   * detalle: el plural sirve de etiqueta y el singular encabeza una lista.
   * Está en el dato y no en un `if` sobre `id === "aler"` para que una
   * pregunta nueva con opciones no obligue a tocar `alertas.ts`.
   */
  alertaConDetalle?: string;
  /** La pregunta de seguimiento que sale SÓLO si la respuesta es «Sí». */
  seguimiento?: Pregunta;
  /** Las opciones de la pantalla de detalle, si la hay (a qué es
   *  alérgico). Botones, no un campo de texto: el prompt pide mucho clic y
   *  poco escribir, y un mayor con una tablet no teclea «penicilina». */
  opciones?: readonly string[];
}

export interface Cuestionario {
  version: number;
  preguntas: readonly Pregunta[];
}

// ── La versión 1 ──────────────────────────────────────────────────────
//
// Las diez preguntas del mockup, en su orden. El orden no es alfabético ni
// casual: las tres primeras son las que cambian el tratamiento de hoy
// (diabetes, anticoagulación, circulación), y las tres últimas son
// contexto. Si el paciente abandona a la mitad, lo que se tiene es lo que
// más importa.
//
// Sobre los textos de `alerta`: el mockup los escribe en femenino
// («Diabética») porque su paciente de ejemplo es Carmen. Aquí van en
// NEUTRO —«Diabetes», «Anticoagulación», «Inmunodepresión»— porque son
// etiquetas de la franja de alertas de CUALQUIER paciente, y una etiqueta
// en femenino sobre la historia de un hombre es un error de dato, no de
// estilo. Es la única divergencia con el mockup y está declarada en el
// done del bloque. Las PREGUNTAS no se tocan: son la voz del producto,
// están validadas, y cambiarlas es volver a validarlas.
export const CUESTIONARIO_V1: Cuestionario = {
  version: 1,
  preguntas: [
    {
      id: "diab",
      texto: "¿Tiene diabetes?",
      ayuda: "Lo que la gente llama «tener azúcar».",
      alerta: "Diabetes",
      corto: "Diabetes",
      seguimiento: {
        id: "insul",
        texto: "¿Se pincha insulina?",
        ayuda: "",
        alerta: "Insulina",
        corto: "Insulina",
      },
    },
    {
      id: "antic",
      texto: "¿Toma pastillas para que la sangre no coagule?",
      ayuda: "Por ejemplo Sintrom, Adiro, Eliquis o Xarelto.",
      alerta: "Anticoagulación",
      corto: "Anticoagulantes",
    },
    {
      id: "circ",
      texto: "¿Tiene problemas de circulación en las piernas?",
      ayuda: "Varices, pies muy fríos o heridas que tardan en curar.",
      alerta: "Mala circulación",
      corto: "Circulación",
    },
    {
      id: "aler",
      texto: "¿Es alérgico a algún medicamento o a la anestesia?",
      ayuda: "También al látex o al yodo.",
      alerta: "Alergias",
      alertaConDetalle: "Alergia",
      corto: "Alergias",
      opciones: [
        "Anestesia del dentista",
        "Penicilina",
        "Látex",
        "Yodo",
        "Otro",
      ],
    },
    {
      id: "marca",
      texto: "¿Lleva marcapasos?",
      ayuda: "",
      alerta: "Marcapasos",
      corto: "Marcapasos",
    },
    {
      id: "defen",
      texto: "¿Toma cortisona o medicinas que bajan las defensas?",
      ayuda: "Si no está seguro, puede responder «No lo sé».",
      alerta: "Inmunodepresión",
      corto: "Cortisona / defensas",
    },
    {
      id: "sens",
      texto: "¿Nota los pies dormidos u hormigueo?",
      ayuda: "",
      alerta: "Sensibilidad reducida",
      corto: "Pies dormidos",
    },
    {
      id: "artr",
      texto: "¿Tiene artrosis o artritis en los pies?",
      ayuda: "",
      alerta: null,
      corto: "Artrosis / artritis",
    },
    {
      id: "oper",
      texto: "¿Le han operado de los pies alguna vez?",
      ayuda: "",
      alerta: null,
      corto: "Operado de los pies",
    },
    {
      id: "fuma",
      texto: "¿Fuma?",
      ayuda: "",
      alerta: null,
      corto: "Fuma",
    },
  ],
};

/** Todas las versiones que el sistema sabe leer. Nunca se quita una: una
 *  valoración de 2026 se sigue pintando en 2031. */
const VERSIONES: readonly Cuestionario[] = [CUESTIONARIO_V1];

/** La versión que se usa al crear una valoración NUEVA. */
export const VERSION_VIGENTE = CUESTIONARIO_V1.version;

/**
 * El cuestionario con el que se contestó una valoración.
 *
 * `null` y no un `throw` ni un apaño a la versión de hoy: una versión que
 * este binario no conoce (una valoración escrita por un despliegue más
 * nuevo, una base restaurada al revés) tiene que poder contarse como «esto
 * no lo sé leer», no pintarse con las preguntas equivocadas.
 */
export function cuestionarioDeVersion(version: number): Cuestionario | null {
  return VERSIONES.find((c) => c.version === version) ?? null;
}

/** La pregunta —principal o de seguimiento— con ese id. */
export function preguntaDe(
  cuestionario: Cuestionario,
  id: string,
): Pregunta | null {
  for (const p of cuestionario.preguntas) {
    if (p.id === id) return p;
    if (p.seguimiento?.id === id) return p.seguimiento;
  }
  return null;
}

/**
 * Las preguntas que ESTÁN EN JUEGO dadas unas respuestas, en orden.
 *
 * El seguimiento de la diabetes sólo cuenta si la diabetes es «Sí». De
 * aquí salen las dos cosas que no pueden discrepar: las filas que pinta la
 * pantalla del sanitario y las respuestas que la validación exige
 * resueltas. Si fueran dos listas, un «No lo sé» en una pregunta que ya no
 * aplica bloquearía la validación para siempre.
 *
 * `valorDe` recibe el id y devuelve la respuesta VIGENTE (la del paciente
 * con la corrección del sanitario aplicada encima): si la podóloga corrige
 * la diabetes a «No», el seguimiento de la insulina deja de estar en juego
 * sin que nadie borre nada.
 */
export function preguntasEnJuego(
  cuestionario: Cuestionario,
  valorDe: (id: string) => Respuesta | undefined,
): Pregunta[] {
  const out: Pregunta[] = [];
  for (const p of cuestionario.preguntas) {
    out.push(p);
    if (p.seguimiento && valorDe(p.id) === "SI") out.push(p.seguimiento);
  }
  return out;
}
