// clinica-5 · «PARA LA PRÓXIMA VISITA» y «HOY TOCA».
//
// Decisión 10 del prompt, y es la pieza que convierte la sesión en una
// cadena: lo que la podóloga deja apuntado hoy sale arriba la próxima vez,
// se marca hecho sola al hacerlo, y **si al cerrar sigue sin hacerse, el
// programa pregunta**. Lo que no se hizo pasa a la siguiente.
//
// Es la parte del bloque que arregla un fallo real y no una pantalla: una
// uña operada que nadie revisó a las cuatro semanas porque la paciente
// venía a cortarse las uñas y nadie se acordó.
//
// ── SIN TABLA NUEVA ──────────────────────────────────────────────────
//
// Lo dice el prompt y conviene entender por qué se puede: *los pendientes
// viven en el cuerpo de la sesión que los crea y la que los cierra los
// nombra.*
//
// O sea: `pendientesCreados` en el cuerpo de la sesión de hoy, y
// `pendientesCerrados` en el de la que viene. Leer «¿qué toca hoy?» es
// leer `pendientesCreados` de la última sesión cerrada — UNA consulta que
// la pantalla ya hacía (`ultimaSesion`), sin un `JOIN` más.
//
// Y lo que hace que eso baste, en vez de obligar a recorrer la historia
// entera cerrando y reabriendo: **al cerrar, lo que sigue abierto se
// VUELVE A CREAR**. La sesión de hoy hereda lo que no se hizo y lo escribe
// como suyo (conservando el `desde` original, que es lo que deja decir «4
// semanas desde la cirugía»). Así «lo abierto» siempre está en un solo
// sitio: la última sesión.
//
// La alternativa era una tabla `pendientes` con su estado mutable, y
// entonces la historia clínica tendría una pieza que SÍ se edita — justo
// lo que `clinical_entries` y su trigger de inmutabilidad existen para
// impedir.

import { nombreDeZona } from "./mapa.js";
import type { TipoDeVisita } from "./tipos-de-visita.js";

/** La versión de la lista. Viaja en el cuerpo de la sesión. */
export const VERSION_DE_LOS_PENDIENTES = 1;

/**
 * Cómo se puede cerrar un pendiente SOLO, sin que nadie lo marque:
 *
 *   · `ZONA`   · tocando en el mapa la zona que el pendiente nombra.
 *   · `HERIDA` · valorando la herida en la tarjeta de revisión de
 *     cirugía (da igual en qué estado: valorarla ES revisarla).
 *   · `TIPO`   · marcando el tipo de visita que lo cierra (una visita de
 *     biomecánica revisa las plantillas por definición).
 */
export type FormaDeCierre = "ZONA" | "HERIDA" | "TIPO";

/** Y las dos formas en que lo cierra una persona. `MANO` es el toque en la
 *  banda de «Hoy toca»; `PREGUNTA`, el «Sí, revisada» del diálogo del
 *  cierre. Se distinguen porque no son lo mismo al leer la historia: una
 *  es «lo marqué mientras trabajaba» y la otra «me lo preguntó al salir». */
export type FormaDeCierreAMano = "MANO" | "PREGUNTA";

export interface ClaseDePendiente {
  /** Corto y estable: viaja en el `body` de la historia PARA SIEMPRE. */
  id: string;
  /** Lo que se lee en el botón de «Para la próxima visita». */
  label: string;
  /** Lo que se lee en la banda de «Hoy toca» la próxima vez. */
  hoyToca: string;
  /** Y la pregunta del diálogo del cierre, redactada aquí para que no haya
   *  dos versiones de la misma pregunta. */
  pregunta: string;
  /** ¿Pide una zona del pie al apuntarlo? */
  pideZona: boolean;
  /** ¿Pide una nota escrita? Sólo «Otro», que es el que existe para lo que
   *  no cabe en los otros cuatro. */
  pideNota: boolean;
  /** Las formas en que se cierra solo. Vacío = sólo a mano. */
  cierraCon: readonly FormaDeCierre[];
  /** Con qué tipo de visita se cierra, si `cierraCon` incluye `TIPO`. */
  tipoQueLoCierra?: TipoDeVisita;
}

export interface ListaDePendientes {
  version: number;
  clases: readonly ClaseDePendiente[];
}

export const PENDIENTES_V1: ListaDePendientes = {
  version: VERSION_DE_LOS_PENDIENTES,
  clases: [
    {
      id: "revisar_una",
      label: "Revisar la uña operada",
      hoyToca: "Revisar la uña operada",
      pregunta: "¿Has revisado la uña operada?",
      pideZona: true,
      pideNota: false,
      // Las DOS: tocar la zona en el mapa, o valorar la herida en la
      // tarjeta de revisión. Son los dos gestos con los que una podóloga
      // revisa una uña operada, y exigir el que no hizo sería preguntarle
      // por algo que acaba de hacer.
      cierraCon: ["ZONA", "HERIDA"],
    },
    {
      id: "retirar_puntos",
      label: "Retirar puntos",
      hoyToca: "Retirar los puntos",
      pregunta: "¿Has retirado los puntos?",
      pideZona: true,
      pideNota: false,
      cierraCon: ["HERIDA"],
    },
    {
      id: "revisar_plantillas",
      label: "Revisar plantillas",
      hoyToca: "Revisar las plantillas",
      pregunta: "¿Has revisado las plantillas?",
      pideZona: false,
      pideNota: false,
      cierraCon: ["TIPO"],
      tipoQueLoCierra: "BIOMECANICA",
    },
    {
      id: "control_riesgo",
      label: "Control de pie de riesgo",
      hoyToca: "Hacer el control de pie de riesgo",
      pregunta: "¿Has hecho el control de pie de riesgo?",
      pideZona: false,
      pideNota: false,
      cierraCon: ["TIPO"],
      tipoQueLoCierra: "PIE_RIESGO",
    },
    {
      id: "otro",
      label: "Otro, con nota",
      hoyToca: "Lo que quedó apuntado",
      pregunta: "¿Has hecho lo que quedaba apuntado?",
      pideZona: false,
      pideNota: true,
      // Nada lo cierra solo: si no sabemos qué es, no podemos saber
      // cuándo se ha hecho. Se marca a mano o lo pregunta el cierre.
      cierraCon: [],
    },
  ],
};

const POR_VERSION: Record<number, ListaDePendientes> = {
  [PENDIENTES_V1.version]: PENDIENTES_V1,
};

export function pendientesDeVersion(
  version: number,
): ListaDePendientes | undefined {
  return POR_VERSION[version];
}

export function claseDePendiente(
  id: string,
  version: number = VERSION_DE_LOS_PENDIENTES,
): ClaseDePendiente | undefined {
  return pendientesDeVersion(version)?.clases.find((c) => c.id === id);
}

// ── Lo que se escribe en el cuerpo ────────────────────────────────────

export interface PendienteCreado {
  /** La id de la clase. */
  id: string;
  /** La clave del mapa (`"L:h"`), o `null` si la clase no pide zona. */
  zona: string | null;
  /** La nota de «Otro», o `null`. */
  nota: string | null;
  /**
   * ISO-8601 de cuándo se apuntó POR PRIMERA VEZ.
   *
   * Se conserva al arrastrarlo de una sesión a la siguiente, y es lo que
   * deja escribir «4 semanas desde la cirugía» en la banda de «Hoy toca».
   * Con la fecha de la última sesión en su lugar, un pendiente arrastrado
   * tres visitas diría «desde hace dos semanas» para siempre.
   */
  desde: string;
}

export interface PendienteCerrado {
  id: string;
  zona: string | null;
  como: FormaDeCierre | FormaDeCierreAMano;
}

/**
 * Los pendientes que están ABIERTOS hoy: los que creó la última sesión
 * cerrada.
 *
 * Una sola lectura, y es la razón por la que esto no necesita tabla (ver
 * la cabecera). Para una sesión v1 —las de clinica-3, que no conocían los
 * pendientes— devuelve la lista vacía: no es que no tuvieran ninguno, es
 * que ese concepto no existía cuando se escribieron, y es lo honesto.
 */
export function pendientesAbiertos(
  anterior: { pendientesCreados?: readonly PendienteCreado[] } | null,
): readonly PendienteCreado[] {
  const lista = anterior?.pendientesCreados;
  if (!Array.isArray(lista)) return [];
  return lista.filter((p) => claseDePendiente(p.id) != null);
}

/** Lo de hoy que puede cerrar un pendiente solo. */
export interface LoDeHoyParaPendientes {
  /** Las claves del mapa marcadas hoy (`Object.keys(marcas)`). */
  zonasTocadas: readonly string[];
  /** El estado de la herida de la revisión de cirugía, o `null` si no se
   *  ha valorado. */
  herida: string | null;
  tipos: readonly TipoDeVisita[];
}

/**
 * ¿Se cierra solo este pendiente con lo que hay marcado hoy? Devuelve CÓMO
 * se cerró, o `null`.
 *
 * El «solo» del prompt es literal: *se marca hecho **solo** al tocar esa
 * zona o valorar esa herida, o a mano.* No basta con que la visita sea del
 * tipo que toca —una quiropodia no revisa una uña operada por el hecho de
 * ser una quiropodia— y por eso `revisar_una` no se cierra con `TIPO`.
 */
export function seCierraSolo(
  pendiente: PendienteCreado,
  hoy: LoDeHoyParaPendientes,
  version: number = VERSION_DE_LOS_PENDIENTES,
): FormaDeCierre | null {
  const clase = claseDePendiente(pendiente.id, version);
  if (!clase) return null;
  for (const forma of clase.cierraCon) {
    switch (forma) {
      case "ZONA":
        // La zona EXACTA que el pendiente nombra. Un pendiente sin zona no
        // se cierra tocando cualquier sitio: eso sería cerrarlo por tocar
        // el talón cuando lo que había que revisar era el dedo gordo.
        if (pendiente.zona && hoy.zonasTocadas.includes(pendiente.zona)) {
          return "ZONA";
        }
        break;
      case "HERIDA":
        if (hoy.herida != null) return "HERIDA";
        break;
      case "TIPO":
        if (
          clase.tipoQueLoCierra &&
          hoy.tipos.includes(clase.tipoQueLoCierra)
        ) {
          return "TIPO";
        }
        break;
    }
  }
  return null;
}

/** La misma cuenta para la lista entera: los que se cierran solos, ya con
 *  su forma de cierre. Lo usa la pantalla para pintar la banda en verde y
 *  la API para no preguntar por algo que ya está hecho. */
export function cierresAutomaticos(
  abiertos: readonly PendienteCreado[],
  hoy: LoDeHoyParaPendientes,
  version: number = VERSION_DE_LOS_PENDIENTES,
): readonly PendienteCerrado[] {
  const salida: PendienteCerrado[] = [];
  for (const p of abiertos) {
    const como = seCierraSolo(p, hoy, version);
    if (como) salida.push({ id: p.id, zona: p.zona, como });
  }
  return salida;
}

/** Dos pendientes son el mismo si son la misma clase sobre la misma zona.
 *  «Revisar la uña operada» del dedo gordo izquierdo y del derecho son
 *  dos cosas distintas, y las dos tienen que poder estar apuntadas. */
export function claveDePendiente(p: {
  id: string;
  zona: string | null;
}): string {
  return `${p.id}|${p.zona ?? ""}`;
}

/**
 * Lo que el cierre tiene que PREGUNTAR: los que siguen abiertos y no se
 * han cerrado ni solos ni a mano.
 *
 * Es el diálogo del mockup («¿Has revisado la uña operada?» · Sí,
 * revisada / Todavía no). Y la razón por la que pregunta en vez de dejarlo
 * pasar en silencio es la del prompt §«Por qué existe»: *no le deja cerrar
 * sin haber hecho lo que tocaba hoy **sin preguntárselo**.*
 */
export function pendientesQuePreguntar(
  abiertos: readonly PendienteCreado[],
  cerrados: readonly PendienteCerrado[],
  hoy: LoDeHoyParaPendientes,
  version: number = VERSION_DE_LOS_PENDIENTES,
): readonly PendienteCreado[] {
  const yaCerrados = new Set([
    ...cerrados.map(claveDePendiente),
    ...cierresAutomaticos(abiertos, hoy, version).map(claveDePendiente),
  ]);
  return abiertos.filter((p) => !yaCerrados.has(claveDePendiente(p)));
}

/**
 * Lo que la sesión de hoy escribe en `pendientesCreados`: lo que la
 * podóloga ha apuntado para la próxima **más lo que no se hizo hoy**.
 *
 * El orden es: primero lo heredado (que es lo más viejo y lo que más
 * urge), después lo nuevo. Y lo heredado conserva su `desde`, que es toda
 * la gracia.
 *
 * Idempotente: apuntar hoy un pendiente que ya venía arrastrado no lo
 * duplica — se queda el heredado, con su fecha original.
 */
export function pendientesACrear(input: {
  /** Lo que la podóloga ha marcado en «Para la próxima visita». */
  nuevos: readonly { id: string; zona: string | null; nota: string | null }[];
  abiertos: readonly PendienteCreado[];
  /** Lo cerrado hoy, de cualquier forma. */
  cerrados: readonly PendienteCerrado[];
  /** ISO-8601 de hoy. Entra como dato: este paquete no tiene reloj. */
  hoy: string;
  version?: number;
}): readonly PendienteCreado[] {
  const version = input.version ?? VERSION_DE_LOS_PENDIENTES;
  const cerrados = new Set(input.cerrados.map(claveDePendiente));
  const salida: PendienteCreado[] = [];
  const vistos = new Set<string>();

  // 1 · lo que venía y no se hizo, con su fecha de siempre.
  for (const p of input.abiertos) {
    const clave = claveDePendiente(p);
    if (cerrados.has(clave) || vistos.has(clave)) continue;
    vistos.add(clave);
    salida.push({ id: p.id, zona: p.zona, nota: p.nota, desde: p.desde });
  }

  // 2 · lo apuntado hoy, con la fecha de hoy.
  for (const p of input.nuevos) {
    const clase = claseDePendiente(p.id, version);
    if (!clase) continue;
    const zona = clase.pideZona ? (p.zona ?? null) : null;
    const nota = clase.pideNota ? (p.nota?.trim() || null) : null;
    const clave = claveDePendiente({ id: p.id, zona });
    if (vistos.has(clave)) continue;
    vistos.add(clave);
    salida.push({ id: p.id, zona, nota, desde: input.hoy });
  }

  return salida;
}

// ── Cómo se lee un pendiente ──────────────────────────────────────────

export interface PendienteLegible {
  id: string;
  /** «Revisar la uña operada» */
  titulo: string;
  /** «Pie izq. · Dedo gordo», o `null`. */
  zona: string | null;
  /** La nota de «Otro», o `null`. */
  nota: string | null;
  pregunta: string;
  /** «4 semanas» · cuánto lleva apuntado, o `null` si no se puede contar.
   *  Las semanas entran calculadas desde fuera: aquí no hay reloj. */
  desde: string;
}

/**
 * Un pendiente en palabras, con el vocabulario de SU versión. Es la
 * función que hace legible la banda de «Hoy toca» y el diálogo del cierre,
 * y la que clinica-6 va a usar en la tarjeta grande de la historia.
 *
 * La id tal cual si la versión no se conoce, igual que `nombreDeZona`: un
 * pendiente de una versión que este despliegue no entiende tiene que
 * SEGUIR VIÉNDOSE.
 */
export function pendienteLegible(
  p: PendienteCreado,
  versiones: { pendientes?: number; mapa?: number } = {},
): PendienteLegible {
  const clase = claseDePendiente(p.id, versiones.pendientes);
  return {
    id: p.id,
    titulo: clase?.hoyToca ?? p.id,
    zona: p.zona ? nombreDeZona(p.zona, versiones.mapa) : null,
    nota: p.nota,
    pregunta: clase?.pregunta ?? "¿Lo has hecho?",
    desde: p.desde,
  };
}
