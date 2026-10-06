// clinica-2 · lo que contestó el paciente, lo que corrigió el sanitario, y
// qué vale HOY.
//
// ── La regla de fondo del bloque ──────────────────────────────────────
//
// **Lo que contestó el paciente no se borra nunca.** No se sobrescribe, no
// se marca como erróneo, no se mueve: se queda. Lo que el sanitario
// corrige es una CORRECCIÓN, con su autor y su hora, AL LADO. En la
// pantalla las dos cosas se ven a la vez (la del paciente en naranja, la
// corrección en oscuro), y la razón no es estética:
//
//   · Si un paciente dijo «No tomo anticoagulantes» y resultó que sí, lo
//     que hay que poder demostrar es que lo dijo. Borrarlo convierte un
//     malentendido del paciente en un error de la clínica.
//   · Y al revés: una corrección sin autor es una respuesta que nadie
//     firmó. En una historia clínica eso no existe.
//
// Esto se sostiene en tres sitios a la vez, y hacen falta los tres: el
// trigger de `clinical_entries` (las respuestas viven en una entrada de
// historia, que es inmutable por el motor), el trigger append-only de
// `clinical_assessment_corrections`, y esta función, que es la que decide
// qué vale hoy SIN tocar nada de lo anterior.
//
// ── Y las correcciones también son append-only ────────────────────────
//
// Corregir dos veces la misma pregunta deja DOS filas. La que vale es la
// última por fecha; las dos se conservan. Es la misma decisión que
// `clinical_addenda`: corregir una corrección es otra corrección, no una
// edición.

import type { Respuesta } from "./cuestionario.js";

/** Lo que el paciente contestó, por id de pregunta. INMUTABLE. */
export type RespuestasPaciente = Readonly<Record<string, Respuesta>>;

/** Una corrección del sanitario, con su firma. */
export interface Correccion {
  preguntaId: string;
  valor: Respuesta;
  /** Quién la firma. Nunca vacío: una corrección anónima no es historia. */
  autorNombre: string;
  autorUserId: string;
  /** ISO-8601. Ordena: la última por fecha es la que vale. */
  creadaEn: string;
}

/**
 * La correción vigente de cada pregunta: la ÚLTIMA por fecha.
 *
 * El empate (dos correcciones con el mismo instante, que sólo pasa en un
 * test o en una carrera de dos terminales) se resuelve por el orden de la
 * lista, que viene de la base ordenada por `created_at`. No se inventa un
 * desempate: lo que hace falta es que sea determinista, y lo es.
 */
export function correccionesVigentes(
  correcciones: readonly Correccion[],
): Map<string, Correccion> {
  const out = new Map<string, Correccion>();
  for (const c of correcciones) {
    const previa = out.get(c.preguntaId);
    if (!previa || c.creadaEn >= previa.creadaEn) out.set(c.preguntaId, c);
  }
  return out;
}

export interface RespuestaVigente {
  preguntaId: string;
  /** Lo que vale hoy. */
  valor: Respuesta;
  /** Lo que contestó el paciente. Se conserva SIEMPRE, también cuando hay
   *  corrección — es la mitad de la pantalla. `undefined` sólo si la
   *  pregunta no estaba en juego cuando contestó (un seguimiento que se
   *  abrió al corregir la pregunta madre). */
  delPaciente: Respuesta | undefined;
  /** La corrección que manda, si la hay. */
  correccion: Correccion | undefined;
}

/** El estado de una valoración, tal como lo mira todo lo de abajo. */
export interface EstadoRespuestas {
  respuestasPaciente: RespuestasPaciente;
  correcciones: readonly Correccion[];
}

/**
 * El valor VIGENTE de una pregunta: la corrección si la hay, y si no lo
 * que contestó el paciente.
 */
export function valorVigente(
  estado: EstadoRespuestas,
  preguntaId: string,
): Respuesta | undefined {
  const corr = correccionesVigentes(estado.correcciones).get(preguntaId);
  return corr?.valor ?? estado.respuestasPaciente[preguntaId];
}

/**
 * Igual que `valorVigente` pero con el mapa de correcciones ya calculado.
 * Lo usan las funciones que recorren las diez preguntas: calcular el mapa
 * once veces no cambia el resultado, sólo el trabajo.
 */
export function resolverVigente(
  estado: EstadoRespuestas,
  vigentes: Map<string, Correccion>,
  preguntaId: string,
): RespuestaVigente {
  const correccion = vigentes.get(preguntaId);
  const delPaciente = estado.respuestasPaciente[preguntaId];
  return {
    preguntaId,
    // El `!` no se puede dar aquí: quien llama sólo pregunta por preguntas
    // en juego, y una pregunta en juego tiene respuesta del paciente o
    // corrección. El `?? "NO_SE"` es el suelo honesto para el caso que no
    // debería existir —un seguimiento abierto por una corrección y aún sin
    // contestar— y cae del lado que BLOQUEA la validación, que es el lado
    // seguro: obliga a resolverlo con el paciente delante.
    valor: correccion?.valor ?? delPaciente ?? "NO_SE",
    delPaciente,
    correccion,
  };
}
