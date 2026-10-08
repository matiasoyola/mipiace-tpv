// clinica-5 · LAS ALERTAS CRUZADAS CON LO QUE SE ESTÁ HACIENDO.
//
// La franja roja de clinica-3 dice lo que el paciente TIENE: diabética,
// anticoagulada, alérgica al látex. Está arriba, siempre, y se lee una
// vez al entrar.
//
// Esto es otra cosa, y es la decisión 9 del prompt: el aviso que aparece
// **en el momento** en que la podóloga marca el acto que choca con la
// alerta. No «es anticoagulada», sino «vas a enuclear un heloma a una
// anticoagulada: ten a mano el hemostático».
//
// ── Por qué una TABLA y no un `if` por caso ───────────────────────────
//
// Porque la tabla es la cosa que va a crecer. Hoy son dos cruces; en
// cuanto Rosario vea la pantalla van a salir seis más (inmunodeprimida +
// cualquier corte, marcapasos + cualquier aparato, alergia al látex +
// guantes). Con `if`s, cada cruce nueva es una rama que hay que probar;
// con la tabla, es una fila y el test recorre la tabla.
//
// Y versionada, como todo lo que viaja en la historia: lo que se avisó se
// puede seguir explicando años después.
//
// ── Las alertas son las de clinica-2, por su id ───────────────────────
//
// «Las alertas son las de la valoración validada (clinica-2)», dice el
// prompt. Así que el disparador de la izquierda es el `preguntaId` del
// cuestionario (`diab`, `antic`, `circ`, `aler`, `marca`, `defen`,
// `sens`) y **no el texto de la alerta**.
//
// La diferencia importa: el texto («Anticoagulación») lo escribe el
// cuestionario y se puede reescribir mañana sin que nadie piense en este
// fichero; la id es el contrato. Cruzar por texto habría sido una alerta
// que deja de dispararse porque alguien corrigió una tilde.
//
// Esto obliga a que la vista de la sesión mande las IDS de las alertas y
// no sólo sus textos — y es lo que hace `CabeceraDeLaSesion.alertaIds`.

import type { TipoDeVisita } from "./tipos-de-visita.js";

/** La versión de la tabla. Viaja en el cuerpo de la sesión. */
export const VERSION_DE_LAS_ALERTAS_CRUZADAS = 1;

/**
 * Qué cosa de hoy dispara el aviso. Tres clases, y cada una mira un sitio
 * distinto de la sesión:
 *
 *   · `ACTO` · un acto de la quiropodia (`helomas`, `onico`…).
 *   · `HERIDA` · un estado de la herida de la revisión de cirugía
 *     (`INFECCION`).
 *   · `TIPO` · el tipo de visita marcado, sin mirar dentro. Es lo que
 *     permite decir «hay cirugía hoy» sin que la cirugía tenga actos.
 */
export type Disparador =
  | { clase: "ACTO"; id: string }
  | { clase: "HERIDA"; id: string }
  | { clase: "TIPO"; id: TipoDeVisita };

export interface ReglaCruzada {
  /** El `preguntaId` del cuestionario de clinica-2. */
  alertaId: string;
  disparador: Disparador;
  /** Lo que se lee en el aviso rojo. */
  aviso: string;
}

export interface TablaDeAlertasCruzadas {
  version: number;
  reglas: readonly ReglaCruzada[];
}

const SANGRADO =
  "Anticoagulada: más sangrado al cortar. Ten a mano hemostático.";

export const ALERTAS_CRUZADAS_V1: TablaDeAlertasCruzadas = {
  version: VERSION_DE_LAS_ALERTAS_CRUZADAS,
  reglas: [
    // Anticoagulación × todo lo que corta. Tres filas con el mismo aviso y
    // no una regla con tres disparadores: la fila es la unidad que se
    // añade y se quita, y un día el aviso de la cirugía va a ser más largo
    // que el de la enucleación.
    { alertaId: "antic", disparador: { clase: "ACTO", id: "helomas" }, aviso: SANGRADO },
    { alertaId: "antic", disparador: { clase: "ACTO", id: "onico" }, aviso: SANGRADO },
    { alertaId: "antic", disparador: { clase: "TIPO", id: "CIRUGIA" }, aviso: SANGRADO },
    // Diabetes × signos de infección. Es la que cambia lo que pasa DESPUÉS
    // de la visita, así que el aviso lleva el plazo dentro.
    {
      alertaId: "diab",
      disparador: { clase: "HERIDA", id: "INFECCION" },
      aviso: "Diabética: revisa antes de 48 h y valora derivar.",
    },
  ],
};

const POR_VERSION: Record<number, TablaDeAlertasCruzadas> = {
  [ALERTAS_CRUZADAS_V1.version]: ALERTAS_CRUZADAS_V1,
};

export function alertasCruzadasDeVersion(
  version: number,
): TablaDeAlertasCruzadas | undefined {
  return POR_VERSION[version];
}

/** Lo de hoy, tal como la pantalla lo tiene en la mano. */
export interface LoQueSeHaceHoy {
  /** Las ids de las alertas vigentes de la valoración (clinica-2). */
  alertaIds: readonly string[];
  tipos: readonly TipoDeVisita[];
  /** Los actos de la quiropodia marcados. */
  actos: readonly string[];
  /** El estado de la herida de la revisión de cirugía, si se ha marcado. */
  herida: string | null;
}

export interface AvisoCruzado {
  alertaId: string;
  aviso: string;
  /** Qué lo disparó, para que el test y la pantalla puedan decir por qué
   *  sale (y para que un aviso que aparece solo no parezca un bug). */
  disparador: Disparador;
}

/**
 * Los avisos que tocan AHORA MISMO, en el orden de la tabla.
 *
 * Sin repetidos por aviso: enuclear un heloma Y tratar una uña encarnada a
 * la misma anticoagulada es un aviso, no dos. Lo que se repitiera sería
 * ruido en una señal de seguridad, que es el único modo de fallo que
 * importa aquí (la misma lección que `alertasDe` de clinica-2 dejó escrita
 * sobre no convertir todo en alerta).
 *
 * Y se devuelve el `disparador` del PRIMERO que casó, no la lista de
 * todos: lo que la pantalla tiene que decir es el aviso.
 */
export function avisosCruzados(
  hoy: LoQueSeHaceHoy,
  tabla: TablaDeAlertasCruzadas = ALERTAS_CRUZADAS_V1,
): readonly AvisoCruzado[] {
  const alertas = new Set(hoy.alertaIds);
  const actos = new Set(hoy.actos);
  const tipos = new Set<string>(hoy.tipos);
  const vistos = new Set<string>();
  const salida: AvisoCruzado[] = [];

  for (const regla of tabla.reglas) {
    if (!alertas.has(regla.alertaId)) continue;
    if (!dispara(regla.disparador, { actos, tipos, herida: hoy.herida })) {
      continue;
    }
    if (vistos.has(regla.aviso)) continue;
    vistos.add(regla.aviso);
    salida.push({
      alertaId: regla.alertaId,
      aviso: regla.aviso,
      disparador: regla.disparador,
    });
  }
  return salida;
}

function dispara(
  d: Disparador,
  hoy: { actos: Set<string>; tipos: Set<string>; herida: string | null },
): boolean {
  switch (d.clase) {
    case "ACTO":
      return hoy.actos.has(d.id);
    case "HERIDA":
      return hoy.herida === d.id;
    case "TIPO":
      return hoy.tipos.has(d.id);
  }
}
