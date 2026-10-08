// clinica-5 · LOS TIPOS DE VISITA, y de dónde sale la especialidad.
//
// Rosario no hace «una sesión»: hace cinco clases de visita, las mismas
// cinco que COGECOP tiene desde 2013 (`docs/clinica/referencia-cogecop.md`
// §3.1) porque son las cinco con las que una podóloga piensa. Y a veces
// hace dos en la misma visita: la revisión de la uña operada y, ya que
// está, la quiropodia.
//
// ── Lista CERRADA y en código ─────────────────────────────────────────
//
// Decisión 2 del prompt, y es la misma razón que S5 dio para la
// especialidad: de un tipo de visita dependen cosas que el centro no
// puede inventar — qué tarjeta se abre, qué comprobaciones se piden, qué
// se calcula. Un texto libre no puede llevar esa lógica, y una tabla sin
// pantalla que la edite no es más flexible que una constante: es la misma
// rigidez con una migración de por medio y sin revisión de código (el
// mismo argumento que `MAPA_PIE_V1`).
//
// ── Y la ESPECIALIDAD cuelga del tipo, no se escribe aparte ───────────
//
// S5 («Agrupar servicios», decidido el 07-10) dejó esto: el agrupador
// único del TPV es la categoría del catálogo y la especialidad se asigna
// a la categoría con el patrón de `TagSection`. Este bloque asigna a la
// categoría el TIPO DE VISITA, que es más fino, y la especialidad sale de
// él con una tabla de cinco filas.
//
// Por qué no las dos cosas en la tabla: porque entonces habría dos
// fuentes para la misma verdad y el día que alguien marcara «Cirugía →
// fisioterapia» tendríamos un servicio que abre la tarjeta de la uña
// operada en la pantalla del cuerpo. La especialidad de un tipo de visita
// no es una preferencia del centro: una revisión de cirugía ungueal es
// podología en todas las clínicas de España.

/**
 * Los cinco tipos de visita. El orden es el de la pantalla y el del
 * programa que la clínica usa hoy.
 *
 * Las ids viajan dentro del `body` de la historia PARA SIEMPRE: renombrar
 * una rompe la lectura de lo ya escrito. Para cambiar la lista se saca una
 * versión nueva, igual que con el mapa y las lesiones.
 */
export const TIPOS_DE_VISITA = [
  "QUIROPODIA",
  "PIE_RIESGO",
  "CIRUGIA",
  "BIOMECANICA",
  "GENERAL",
] as const;

export type TipoDeVisita = (typeof TIPOS_DE_VISITA)[number];

/** La versión de la lista de tipos. Viaja en el cuerpo de la sesión. */
export const VERSION_DE_LOS_TIPOS = 1;

export const NOMBRE_DE_TIPO_DE_VISITA: Record<TipoDeVisita, string> = {
  QUIROPODIA: "Quiropodia",
  PIE_RIESGO: "Pie de riesgo",
  CIRUGIA: "Cirugía · revisión",
  BIOMECANICA: "Biomecánica",
  GENERAL: "General",
};

/** El color de cada chip, del mockup validado. Es dato de presentación
 *  compartido —lo pintan la sesión y la historia viva de clinica-6— y vive
 *  aquí por la misma razón que la geometría del mapa: un tipo sin color es
 *  un chip que cada pantalla inventa de otro color. */
export const COLOR_DE_TIPO_DE_VISITA: Record<TipoDeVisita, string> = {
  QUIROPODIA: "#E97058",
  PIE_RIESGO: "#E11D48",
  CIRUGIA: "#8B5CF6",
  BIOMECANICA: "#3B82F6",
  GENERAL: "#64748B",
};

/**
 * clinica-6 · la línea de debajo del nombre en la hoja de «¿Qué visita es
 * hoy?» («Durezas, uñas, callos»).
 *
 * Es el texto del mockup validado, y vive aquí por la misma razón que el
 * color y que la geometría del mapa: es dato de presentación COMPARTIDO.
 * Un tipo nuevo sin su línea es un tipo que la hoja ofrece sin decir qué
 * es, y el typecheck de este `Record` lo pide completo.
 */
export const DESCRIPCION_DE_TIPO_DE_VISITA: Record<TipoDeVisita, string> = {
  QUIROPODIA: "Durezas, uñas, callos",
  PIE_RIESGO: "Diabetes, úlceras, sensibilidad",
  CIRUGIA: "Uña, anestesia, consentimiento",
  BIOMECANICA: "Pisada, plantillas, órtesis",
  GENERAL: "Revisión o consulta",
};

export function esTipoDeVisita(x: unknown): x is TipoDeVisita {
  return (
    typeof x === "string" &&
    (TIPOS_DE_VISITA as readonly string[]).includes(x)
  );
}

// ── La especialidad (S5) ──────────────────────────────────────────────

/** Lista cerrada en código, como manda S5. `FISIOTERAPIA` todavía no
 *  tiene tipos de visita: entra con su bloque y su mapa del cuerpo. */
export const ESPECIALIDADES = ["PODOLOGIA", "FISIOTERAPIA"] as const;
export type Especialidad = (typeof ESPECIALIDADES)[number];

export const NOMBRE_DE_ESPECIALIDAD: Record<Especialidad, string> = {
  PODOLOGIA: "Podología",
  FISIOTERAPIA: "Fisioterapia",
};

export function esEspecialidad(x: unknown): x is Especialidad {
  return (
    typeof x === "string" && (ESPECIALIDADES as readonly string[]).includes(x)
  );
}

/** De qué especialidad es cada tipo. Los cinco son de podología
 *  (decisión 2): COGECOP es el programa del Consejo de Podólogos y estos
 *  son sus cinco tipos. */
export const ESPECIALIDAD_DE_TIPO: Record<TipoDeVisita, Especialidad> = {
  QUIROPODIA: "PODOLOGIA",
  PIE_RIESGO: "PODOLOGIA",
  CIRUGIA: "PODOLOGIA",
  BIOMECANICA: "PODOLOGIA",
  GENERAL: "PODOLOGIA",
};

/**
 * La especialidad de una sesión con varios tipos marcados.
 *
 * `null` si no hay tipos. Si los tipos marcados fueran de dos
 * especialidades distintas, manda la del PRIMERO en el orden de la
 * lista — pero ese caso **no puede darse hoy** y la sesión no es el sitio
 * donde impedirlo: lo impide el guardado del servicio
 * (`tipoDelServicio`), que es donde nace la mezcla. Aquí se congela lo que
 * haya, porque lo que esta función existe para hacer es dejar escrito en
 * la entrada con qué especialidad se hizo (S5, regla 2 de la respuesta de
 * clínica).
 */
export function especialidadDeLosTipos(
  tipos: readonly TipoDeVisita[],
): Especialidad | null {
  for (const t of TIPOS_DE_VISITA) {
    if (tipos.includes(t)) return ESPECIALIDAD_DE_TIPO[t];
  }
  return null;
}

// ── El tipo de un SERVICIO, y las dos negativas de S5 ─────────────────

/**
 * Lo que el guardado de un servicio necesita saber de sus etiquetas.
 *
 * `tipoPorTag` es la tabla `tag_visit_types` del centro, ya cargada:
 * `slug → tipo`. Las etiquetas sin fila no estorban —«Promoción»,
 * «Novedad» conviven con «Podología» (S5, respuesta de clínica)— porque lo
 * que se rechaza son dos tipos DISTINTOS, no una etiqueta de más.
 */
export interface ServicioPorEtiquetas {
  /** Las etiquetas del producto, como las guarda `Product.tags`. */
  etiquetas: readonly string[];
  /** La tabla del centro: `slug → tipo de visita`. */
  tipoPorTag: Readonly<Record<string, TipoDeVisita>>;
  /** ¿Este centro tiene la historia clínica encendida? Sólo ahí vale la
   *  segunda negativa: en la peluquería de Sole un servicio sin tipo de
   *  visita es lo normal. */
  esCentroClinico: boolean;
  /** ¿Está marcado «es un tratamiento de la sesión»? (clinica-3) */
  tratamientoSesion: boolean;
}

export type TipoDelServicio =
  | {
      ok: true;
      /** `null` cuando ninguna etiqueta tiene tipo y el servicio no es de
       *  sesión: un servicio normal de un centro clínico (una crema, un
       *  bono) no tiene tipo de visita y no pasa nada. */
      tipo: TipoDeVisita | null;
      especialidad: Especialidad | null;
    }
  | { ok: false; motivo: "DOS_TIPOS" | "SESION_SIN_TIPO"; mensaje: string };

/**
 * El tipo de visita de un servicio, o el motivo LEGIBLE por el que no se
 * puede guardar.
 *
 * Las dos negativas son las de S5, y las dos están aquí y no en la ruta
 * por la razón de siempre: el mensaje que lee la dueña lo redacta UNA
 * función, y la pantalla del catálogo y la API dicen lo mismo.
 *
 *   1. **Dos tipos distintos por sus etiquetas → no se guarda.** Un
 *      servicio con las categorías «Quiropodia» y «Cirugía» abriría dos
 *      tarjetas distintas al dar la cita y no hay forma de elegir. Es la
 *      regla 3 del soporte de agenda en S5, aplicada al tipo (que es más
 *      fino que la especialidad: los cinco tipos son podología, así que
 *      una regla sobre la especialidad no habría cazado nada).
 *   2. **Servicio de sesión sin tipo, en centro clínico → no se guarda.**
 *      Regla 1 de la respuesta de clínica en S5: si no sabemos el tipo, no
 *      sabemos qué tarjeta abrir ni dónde cobrarlo.
 */
export function tipoDelServicio(
  input: ServicioPorEtiquetas,
): TipoDelServicio {
  const tipos: TipoDeVisita[] = [];
  for (const etiqueta of input.etiquetas) {
    const tipo = input.tipoPorTag[normalizarSlug(etiqueta)];
    if (tipo && !tipos.includes(tipo)) tipos.push(tipo);
  }

  if (tipos.length > 1) {
    const nombres = tipos.map((t) => NOMBRE_DE_TIPO_DE_VISITA[t]);
    return {
      ok: false,
      motivo: "DOS_TIPOS",
      mensaje: `${nombres.join(" y ")} a la vez: quita una de las dos categorías.`,
    };
  }

  const tipo = tipos[0] ?? null;

  if (tipo == null && input.esCentroClinico && input.tratamientoSesion) {
    return {
      ok: false,
      motivo: "SESION_SIN_TIPO",
      mensaje:
        "Ponle una categoría con tipo de visita (Quiropodia, Pie de riesgo, Cirugía, Biomecánica o General): sin ella no sabemos qué pantalla de sesión abrir.",
    };
  }

  return {
    ok: true,
    tipo,
    especialidad: tipo ? ESPECIALIDAD_DE_TIPO[tipo] : null,
  };
}

/** La forma con la que Holded entrega los tags y con la que se guardan en
 *  `tag_visit_types`: minúsculas y sin espacios al borde. La misma
 *  normalización que `tag_aliases` y `tag_sections` hacen al escribir, y
 *  está aquí para que leer no dependa de que quien escribió se acordara. */
export function normalizarSlug(slug: string): string {
  return slug.trim().toLowerCase();
}
