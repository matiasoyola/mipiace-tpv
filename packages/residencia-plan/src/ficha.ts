// historia-1 (D-91) · **LA FRANJA DE ALERTAS SE CALCULA, NO SE TECLEA.**
//
// Lo que la auxiliar que abre la puerta tiene que saber antes de entrar,
// sacado de la ficha clínica y no de un campo que alguien escribió una
// vez. Dos razones para que sea una función y no una columna:
//
//   1. **Una franja escrita a mano se queda vieja.** El día que la DUE
//      cambia la textura de la dieta a triturada, la banda de la puerta
//      tiene que cambiar sola. Con una columna haría falta que alguien se
//      acordara de reescribirla, y «alguien se acuerda» es la forma de
//      fallo que este repo cierra por costumbre.
//   2. **La puerta y el despacho enseñan cosas DISTINTAS de lo mismo**, y
//      eso sólo se puede garantizar desde un sitio. Ver abajo.
//
// ── LAS DOS CARAS DE LA MISMA ALERTA (D-51, D-91) ───────────────────
//
// Cada alerta sale con dos textos:
//
//   · `frase` — **lo accionable**: «Disfagia: triturado y espesante nivel
//     2», «Alergia: penicilina». Es lo único que llega a la tablet de la
//     puerta.
//   · `detalle` — el porqué, para la historia y el admin: el diagnóstico
//     con todas las letras, la reacción de la alergia.
//
// Y la regla, que es la mitad del valor del bloque: **en la puerta, sólo
// `frase`**. La auxiliar necesita saber qué hacer, no de qué está enferma
// la persona — es D-51 aplicado a una banda de texto. Un pasillo de
// residencia lo cruza cualquiera: la familia de otro residente, el
// fontanero, un inspector. Un diagnóstico pintado en una tablet a la
// altura de los ojos, en una pared, es un diagnóstico publicado.
//
// Por eso `frase` y `detalle` son dos campos y no uno largo: con un solo
// texto, quien escribiera la pantalla de la puerta tendría que recortarlo
// —y recortar un diagnóstico por la mitad sigue siendo el diagnóstico.
//
// ── PURA, como todo este paquete ────────────────────────────────────
//
// Sin base de datos y sin reloj: la ficha entra por parámetro, ya
// descifrada por quien la leyó. Lo que compra es lo de siempre: la tabla
// de casos es una tabla y no una maqueta de Prisma, y el servidor puede
// calcular las frases ANTES de mandárselas a la tablet — que es cómo la
// puerta tiene su banda sin ver un diagnóstico.

// ── EL CATÁLOGO DE DISPOSITIVOS, COMO DATO DEL PRODUCTO ─────────────
//
// Vive aquí y no en `apps/api/src/residencia/catalogo/` por una razón
// concreta: **de la misma lista salen dos cosas** —cómo se llama cada
// dispositivo y cuáles son de riesgo— y la segunda la necesita la regla
// pura de esta página. Partirlo en dos ficheros sería tener la lista de
// nombres en la API y la lista de riesgos aquí, y el día que entre una
// CPAP alguien añadiría una y no la otra.
//
// Es el mismo sitio en el que `turnos.ts` guarda `TURNOS_DE_SERIE`.
//
// Y es un CÓDIGO en claro validado contra esta lista, no un enum de
// Postgres (D-11 llevado aquí, como `incident_type` de residencia-4): un
// nebulizador o una CPAP en 2028 son una fila de este fichero, no un
// `ALTER TYPE` en producción.

/** Un dispositivo del catálogo de serie. */
export interface DispositivoDeSerie {
  code: string;
  /** Como se lee en la ficha y en el parte. */
  name: string;
  /**
   * `true` = **entra en la franja de alertas** (D-91).
   *
   * Los tres que lo llevan son los que cambian lo que alguien hace al
   * entrar en la habitación: una sonda (no se moviliza igual, y se mira
   * que drene), el oxígeno (no se apaga, y hay una bombona) y la grúa
   * (no se levanta a esa persona a brazo, que es cómo se rompe una
   * espalda y cómo se cae un residente).
   *
   * Los otros siete **no alertan a propósito**: unas gafas o un audífono
   * están en la ficha y no interrumpen a nadie en un pasillo. Una banda
   * que lo pinta todo es una banda que no se lee, que es exactamente lo
   * que D-16 dice del coste del registro aplicado a la atención.
   */
  riesgo: boolean;
  sortOrder: number;
}

export const DISPOSITIVOS_DE_SERIE: readonly DispositivoDeSerie[] = [
  { code: "SILLA_DE_RUEDAS", name: "Silla de ruedas", riesgo: false, sortOrder: 10 },
  { code: "ANDADOR", name: "Andador", riesgo: false, sortOrder: 20 },
  { code: "GRUA", name: "Grúa", riesgo: true, sortOrder: 30 },
  { code: "SONDA", name: "Sonda", riesgo: true, sortOrder: 40 },
  { code: "OXIGENO", name: "Oxígeno", riesgo: true, sortOrder: 50 },
  { code: "ABSORBENTES", name: "Absorbentes", riesgo: false, sortOrder: 60 },
  { code: "AUDIFONO", name: "Audífono", riesgo: false, sortOrder: 70 },
  { code: "PROTESIS_DENTAL", name: "Prótesis dental", riesgo: false, sortOrder: 80 },
  { code: "GAFAS", name: "Gafas", riesgo: false, sortOrder: 90 },
  { code: "OTRO", name: "Otro", riesgo: false, sortOrder: 100 },
];

const DISPOSITIVO_POR_CODIGO = new Map(
  DISPOSITIVOS_DE_SERIE.map((d) => [d.code, d]),
);

/** El dispositivo del catálogo, o `undefined` si el código no existe. */
export function dispositivoDeSerie(code: string): DispositivoDeSerie | undefined {
  return DISPOSITIVO_POR_CODIGO.get(code);
}

/** Los códigos válidos, para validar lo que llega por una ruta. */
export const CODIGOS_DE_DISPOSITIVO: readonly string[] =
  DISPOSITIVOS_DE_SERIE.map((d) => d.code);

// ── LAS RESTRICCIONES DE DIETA, por lo mismo ────────────────────────

/** Una restricción del catálogo de serie. */
export interface RestriccionDeSerie {
  code: string;
  name: string;
  sortOrder: number;
}

/**
 * Las cuatro de `03-historia-residente.md` §1.
 *
 * **No alertan por sí solas**, y es una decisión: una dieta diabética o
 * sin sal es una propiedad del plato que sale de la cocina, no algo que
 * la auxiliar tenga que saber al abrir la puerta. Lo que alerta de una
 * dieta es la TEXTURA y el espesante, que es lo que cambia cómo se le da
 * de comer a alguien y lo que puede ahogarlo.
 */
export const RESTRICCIONES_DE_SERIE: readonly RestriccionDeSerie[] = [
  { code: "DIABETICA", name: "Diabética", sortOrder: 10 },
  { code: "SIN_SAL", name: "Sin sal", sortOrder: 20 },
  { code: "SIN_GLUTEN", name: "Sin gluten", sortOrder: 30 },
  { code: "OTRAS", name: "Otras", sortOrder: 40 },
];

export const CODIGOS_DE_RESTRICCION: readonly string[] =
  RESTRICCIONES_DE_SERIE.map((r) => r.code);

const NOMBRE_DE_RESTRICCION = new Map(
  RESTRICCIONES_DE_SERIE.map((r) => [r.code, r.name]),
);

/** Como se lee una restricción. El código tal cual si no está en el
 *  catálogo: enseñar `SIN_LACTOSA` es más honesto que esconderlo. */
export function nombreDeRestriccion(code: string): string {
  return NOMBRE_DE_RESTRICCION.get(code) ?? code;
}

// ── LA TEXTURA, EN PALABRAS ─────────────────────────────────────────

export type TexturaDeDieta = "NORMAL" | "BLANDA" | "TRITURADA" | "ENTERAL";

const NOMBRE_DE_TEXTURA: Record<TexturaDeDieta, string> = {
  NORMAL: "Normal",
  BLANDA: "Blanda",
  TRITURADA: "Triturada",
  ENTERAL: "Enteral",
};

export function nombreDeTextura(t: TexturaDeDieta): string {
  return NOMBRE_DE_TEXTURA[t] ?? t;
}

/**
 * Y cómo se dice la textura DENTRO de la frase de la puerta.
 *
 * Dos diccionarios y no uno, y no es un capricho de estilo: en la ficha
 * la columna se llama «Textura» y la palabra concuerda con ella
 * («triturada»); en la frase de la puerta la palabra concuerda con lo que
 * se le da de comer («triturado y espesante nivel 2», que es la frase
 * literal de D-91). Con un solo diccionario, una de las dos pantallas
 * leería mal — y la que importa es la de la puerta, que se lee de reojo.
 */
const TEXTURA_EN_LA_FRASE: Record<TexturaDeDieta, string> = {
  NORMAL: "normal",
  BLANDA: "blando",
  TRITURADA: "triturado",
  ENTERAL: "enteral",
};

// ── LO QUE ENTRA, Y LO QUE SALE ─────────────────────────────────────

/** Un diagnóstico activo, ya descifrado. */
export interface DiagnosticoParaLaFranja {
  id: string;
  /** El diagnóstico con todas las letras. Va al `detalle`, **nunca a la
   *  `frase`**. */
  texto: string;
  /** `true` = lo marcó quien lo escribió (D-90). */
  alerta: boolean;
  /** La frase accionable que escribió quien lo marcó. El motor la exige
   *  con la marca puesta (CHECK `resident_diagnoses_alerta_completa`), así
   *  que aquí es `string` y no `string | null` por contrato — y se
   *  comprueba igual, porque una función que depende de que la base no se
   *  equivoque falla en silencio. */
  frase: string | null;
}

/** Una alergia vigente, ya descifrada. */
export interface AlergiaParaLaFranja {
  id: string;
  clase: "MEDICAMENTO" | "ALIMENTO" | "OTRA";
  gravedad: "LEVE" | "MODERADA" | "GRAVE";
  /** «penicilina», «frutos secos». */
  agente: string;
  reaccion: string | null;
}

/** Un dispositivo que lleva hoy. */
export interface DispositivoParaLaFranja {
  id: string;
  code: string;
  detalle: string | null;
}

/** La dieta vigente. */
export interface DietaParaLaFranja {
  textura: TexturaDeDieta;
  espesante: boolean;
  nivelDeEspesante: number | null;
}

/** La ficha de un residente, en lo que a la franja le importa. */
export interface FichaParaLaFranja {
  diagnosticos: DiagnosticoParaLaFranja[];
  alergias: AlergiaParaLaFranja[];
  dispositivos: DispositivoParaLaFranja[];
  /** `null` = no tiene dieta registrada. **No es «normal»**: ver
   *  `alertasDeLaFicha`. */
  dieta: DietaParaLaFranja | null;
}

/** De qué sale una alerta. Ordena la franja y pinta su icono. */
export type ClaseDeAlerta =
  | "ALERGIA"
  | "DIAGNOSTICO"
  | "DIETA"
  | "DISPOSITIVO";

/** Una alerta de la franja. */
export interface AlertaDeLaFicha {
  clase: ClaseDeAlerta;
  /** La fila de la que salió, para abrirla desde el admin. */
  origenId: string | null;
  /** **Lo accionable.** Es lo ÚNICO que sale a la puerta. */
  frase: string;
  /** El porqué, para la historia y el admin. `null` cuando la frase ya
   *  lo dice todo. **Nunca sale a la puerta.** */
  detalle: string | null;
}

/**
 * **LA FRANJA DE ALERTAS DE UN RESIDENTE** (D-91).
 *
 * Ordenada: alergias, diagnósticos marcados, dieta y dispositivos. El
 * orden es el del riesgo inmediato y no el de la base — una alergia grave
 * mata en minutos, una grúa mal usada en el momento, y un diagnóstico
 * marcado es contexto que hace falta cuando pasa algo.
 *
 * Y el orden es ESTABLE: dentro de cada clase se ordena por el texto, no
 * por el id, porque la banda de la puerta no puede cambiar de orden entre
 * dos refrescos. Una auxiliar que lee la primera línea de reojo cuarenta
 * veces por turno tiene que encontrar siempre lo mismo arriba.
 */
export function alertasDeLaFicha(ficha: FichaParaLaFranja): AlertaDeLaFicha[] {
  const fuera: AlertaDeLaFicha[] = [];

  // ── 1 · ALERGIAS GRAVES ───────────────────────────────────────────
  //
  // **Sólo las graves**, y es D-91 literal. Una intolerancia leve a la
  // lactosa en la banda de la puerta gasta la única línea que la auxiliar
  // va a leer; las leves y moderadas están en la ficha, donde las mira
  // quien prescribe y quien cocina.
  //
  // La frase lleva el AGENTE y no la reacción: lo accionable de una
  // alergia es qué no se le da, no qué le pasaría.
  const graves = ficha.alergias
    .filter((a) => a.gravedad === "GRAVE")
    .sort((a, b) => a.agente.localeCompare(b.agente, "es"));
  for (const a of graves) {
    fuera.push({
      clase: "ALERGIA",
      origenId: a.id,
      frase: `Alergia: ${a.agente}`,
      detalle: a.reaccion,
    });
  }

  // ── 2 · DIAGNÓSTICOS MARCADOS ─────────────────────────────────────
  //
  // La frase es la que escribió quien lo marcó, y el diagnóstico va al
  // `detalle`. **Sin frase no hay alerta**: el motor la exige con la
  // marca puesta, y si una fila llegara aquí sin ella la alternativa
  // habría sido poner el diagnóstico en la frase —que es justo lo que
  // D-91 prohíbe— o pintar una banda vacía. Se omite, y quien lo arregla
  // es la pantalla de la ficha, que lo enseña como incompleto.
  const marcados = ficha.diagnosticos
    .filter((d) => d.alerta && d.frase != null && d.frase.trim() !== "")
    .sort((a, b) => a.frase!.localeCompare(b.frase!, "es"));
  for (const d of marcados) {
    fuera.push({
      clase: "DIAGNOSTICO",
      origenId: d.id,
      frase: d.frase!.trim(),
      detalle: d.texto,
    });
  }

  // ── 3 · LA DIETA ──────────────────────────────────────────────────
  //
  // Alerta cuando la textura NO es normal o cuando lleva espesante. Las
  // dos cosas por separado y una sola línea: «Disfagia: triturado y
  // espesante nivel 2» es la frase del prompt, y se arma de las dos
  // columnas.
  //
  // **La palabra «disfagia» no es el diagnóstico aquí**: es lo que la
  // auxiliar llama a esto en planta y lo que hace que la frase se
  // entienda de un vistazo. Lo que no sale es *por qué* tiene disfagia —
  // un ictus, un párkinson, un tumor—, que es lo que estaría en un
  // diagnóstico.
  //
  // Y **una dieta que no existe no alerta y no se inventa normal**: la
  // ausencia de dato es un hueco que la pantalla de la ficha dice y que
  // el ingreso guiado (D-94) tiene como elemento pendiente. Pintar
  // «normal» en la puerta por no tener fila sería afirmar algo que nadie
  // ha comprobado, y a alguien con disfagia sin ficha se le daría un
  // filete.
  const dieta = ficha.dieta;
  if (dieta != null) {
    const partes: string[] = [];
    if (dieta.textura !== "NORMAL") {
      partes.push(TEXTURA_EN_LA_FRASE[dieta.textura] ?? dieta.textura);
    }
    if (dieta.espesante) {
      partes.push(
        dieta.nivelDeEspesante != null
          ? `espesante nivel ${dieta.nivelDeEspesante}`
          : "espesante",
      );
    }
    if (partes.length > 0) {
      fuera.push({
        clase: "DIETA",
        origenId: null,
        frase: `Disfagia: ${partes.join(" y ")}`,
        detalle: null,
      });
    }
  }

  // ── 4 · DISPOSITIVOS DE RIESGO ────────────────────────────────────
  //
  // Los tres del catálogo (`riesgo: true`). El detalle va al `detalle` y
  // no a la frase: «sonda vesical Foley 16» es un dato clínico y
  // «Lleva sonda» es lo accionable.
  const deRiesgo = ficha.dispositivos
    .filter((d) => dispositivoDeSerie(d.code)?.riesgo === true)
    .sort((a, b) => a.code.localeCompare(b.code));
  for (const d of deRiesgo) {
    fuera.push({
      clase: "DISPOSITIVO",
      origenId: d.id,
      frase: `Lleva ${dispositivoDeSerie(d.code)!.name.toLowerCase()}`,
      detalle: d.detalle,
    });
  }

  return fuera;
}

/**
 * Lo mismo, **recortado para la puerta**: sólo las frases.
 *
 * Existe como función y no como un `.map()` en la ruta de la puerta por
 * la razón de siempre en este repo: lo que se escribe una vez no se
 * puede escribir mal dos veces. La ruta del arranque de la puerta y la
 * de «lo que toca» llaman a ESTA, y un test fija que lo que devuelve no
 * contiene ningún `detalle` — que es la prueba de que un diagnóstico no
 * puede llegar a una tablet de pasillo.
 */
export function frasesParaLaPuerta(ficha: FichaParaLaFranja): string[] {
  return alertasDeLaFicha(ficha).map((a) => a.frase);
}
