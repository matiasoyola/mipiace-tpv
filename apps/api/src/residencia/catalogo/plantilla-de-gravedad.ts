// residencia-4 (D-65) · **LA PLANTILLA DE GRAVEDAD, COMO DATO.**
//
// La tabla del §3 de `docs/residencia/00-decisiones.md`, fila por fila y
// tal cual. Es un fichero de datos del producto —igual que
// `controles-de-serie.ts`— que un seed idempotente carga en
// `severity_rules` al arrancar, con `scope STANDARD`, versión y vigencia.
//
// ── POR QUÉ ES DE SERIE Y NO «PENDIENTE DE FIRMA» (D-65) ────────────
//
// D-23 decía que el árbol de actuación lo firmaban la médica y la DUE, y
// D-56 convirtió esta tabla en «plantilla por defecto pendiente de firma
// clínica». **D-65 sustituye a las dos**: la plantilla es estándar de
// práctica clínica, la fija Mi Piace y funciona desde el primer día. No
// hay estado «pendiente», no hay bloqueo y un centro no toca ni un umbral
// ni un nivel (D-21, rama de controles §10).
//
// La razón es de producto y está escrita en D-65 con las palabras de
// Matías: «nosotros mandamos; lo que les demos vamos a tener que
// enseñarles a usarlo». Un sistema que no gradúa hasta que alguien firme
// un papel es un sistema que el primer mes no avisa de nada, que es
// exactamente el estado de hoy.
//
// Lo que la médica sí pauta es la **excepción por residente** (D-22):
// `resident_threshold_overrides`, firmada y con vigencia.
//
// ── VERSIÓN Y VIGENCIA, Y POR QUÉ UNA SOLA PARA TODA LA TABLA ───────
//
// La plantilla se versiona ENTERA y no fila a fila. «¿Qué decía la
// plantilla el 14 de marzo?» tiene que poder contestarse con un número, y
// con versiones por fila la respuesta sería una lista de diecisiete
// versiones. Una incidencia guarda `plantillaVersion`, y con eso la
// auditoría reconstruye por qué aquel 38,2 fue N2.
//
// Subir la versión es cambiar esta constante y desplegar: el seed publica
// las filas nuevas y jubila las de la versión anterior con `supersededAt`,
// sin tocarlas — igual que el catálogo de controles.
//
// ── Y LO QUE NO TIENE UMBRAL, NO TIENE UMBRAL ───────────────────────
//
// **Pulso, peso y tensión diastólica no aparecen aquí**, y no es un
// olvido: la tabla del §3 no los gradúa. Se registran, quedan en la
// historia y en la curva del residente, y no derivan nada. Inventarles un
// rango (¿pulso < 50 es bradicardia o es un deportista de 80 años?) sería
// meter ruido en el móvil de guardia, y un móvil que suena por nada es un
// móvil que nadie mira.

import type { Nivel, ReglaDeGravedad } from "@mipiacetpv/residencia-plan";

/**
 * La versión vigente de la plantilla. Sube cuando cambia una fila.
 *
 * Hoy 1: es la primera vez que se publica.
 */
export const VERSION_DE_LA_PLANTILLA = 1;

/**
 * Los tipos de incidencia que esta plantilla puede abrir.
 *
 * Son CÓDIGOS y no un enum de Postgres a propósito: un tipo nuevo en 2028
 * tiene que ser una fila de este fichero y no una migración (D-11 llevado
 * a la capa 4). Lo que sí es un enum es el SUJETO del libro —residente,
 * queja, avería—, porque de él cuelgan pantallas distintas.
 *
 * Y es **la clave de la idempotencia**: tres tomas de fiebre en un turno
 * se adjuntan a la incidencia `FIEBRE` abierta del residente en vez de
 * abrir tres. Por eso `TEMPERATURA` y `FIEBRE` son dos cosas distintas:
 * el control es lo que se mide, el tipo es lo que pasa.
 */
export const TIPOS_DE_INCIDENCIA = {
  FIEBRE: "FIEBRE",
  HIPOXIA: "HIPOXIA",
  TENSION: "TENSION",
  GLUCEMIA: "GLUCEMIA",
  CAIDA: "CAIDA",
  VOMITO: "VOMITO",
  NO_LOCALIZADO: "NO_LOCALIZADO",
  EMERGENCIA_VITAL: "EMERGENCIA_VITAL",
  AVERIA: "AVERIA",
  QUEJA: "QUEJA",
  ALGO_NO_VA_BIEN: "ALGO_NO_VA_BIEN",
  SIN_DEPOSICION: "SIN_DEPOSICION",
  INGESTA_NULA: "INGESTA_NULA",
} as const;

/**
 * Los matices: lo que la pantalla pregunta con UNA pregunta.
 *
 * Una y no tres. «¿Se ha dado en la cabeza o hay herida?» con dos botones
 * grandes cuesta un toque; un formulario de caída con zona, mecanismo y
 * testigos cuesta que nadie lo rellene (D-16, y la regla 1 de la capa 2:
 * el registro no exige diagnosticar).
 */
export const MATICES = {
  CON_GOLPE: "CON_GOLPE",
  SIN_GOLPE: "SIN_GOLPE",
  REPETIDO: "REPETIDO",
  PELIGROSA: "PELIGROSA",
  SIN_RIESGO: "SIN_RIESGO",
} as const;

/** Una fila del fichero, antes de entrar en la base. */
export type ReglaDeSerie = ReglaDeGravedad & { sortOrder: number };

/**
 * **LA TABLA DEL §3.** Cada fila de allí, aquí.
 *
 * El `sortOrder` es para PINTARLA en la pantalla de solo lectura del
 * admin, no para evaluarla: `gravedadDe` evalúa todas las que casan y se
 * queda con la más grave, precisamente para que el orden de estas filas no
 * pueda cambiar un nivel. Ver su cabecera.
 */
export const PLANTILLA_DE_GRAVEDAD: ReglaDeSerie[] = [
  // ── «Algo no va bien» a secas ────────────────────────────────────
  //
  // N1 y no N0, porque alguien se ha parado a decirlo: es información
  // para el turno siguiente, que es exactamente lo que N1 significa
  // (D-13 + la escala de la rama §6.1).
  {
    kind: "EVENT",
    evento: TIPOS_DE_INCIDENCIA.ALGO_NO_VA_BIEN,
    matiz: null,
    nivel: "N1",
    tipo: TIPOS_DE_INCIDENCIA.ALGO_NO_VA_BIEN,
    sortOrder: 10,
  },

  // ── Caída ────────────────────────────────────────────────────────
  //
  // La base es N1 («caída sin lesión aparente») y existe aunque la
  // pantalla pregunte siempre: un cliente viejo o un registro que llega
  // sin matiz tiene que graduar, no perderse.
  {
    kind: "EVENT",
    evento: TIPOS_DE_INCIDENCIA.CAIDA,
    matiz: null,
    nivel: "N1",
    tipo: TIPOS_DE_INCIDENCIA.CAIDA,
    sortOrder: 20,
  },
  {
    kind: "EVENT",
    evento: TIPOS_DE_INCIDENCIA.CAIDA,
    matiz: MATICES.SIN_GOLPE,
    nivel: "N1",
    tipo: TIPOS_DE_INCIDENCIA.CAIDA,
    sortOrder: 21,
  },
  {
    kind: "EVENT",
    evento: TIPOS_DE_INCIDENCIA.CAIDA,
    matiz: MATICES.CON_GOLPE,
    nivel: "N3",
    tipo: TIPOS_DE_INCIDENCIA.CAIDA,
    sortOrder: 22,
  },

  // ── Temperatura ──────────────────────────────────────────────────
  //
  // Tres filas y no un rango con dos extremos: «≥ 37,5 y < 38 → N1» del
  // §3 se escribe como «≥ 37,5 → N1» porque la de 38 ya es N2 y gana la
  // más grave. Escribir el tope superior de cada banda habría metido
  // cuatro números más donde se pueden teclear mal, y habría dejado un
  // hueco el día que alguien cambie el 38 y se olvide del 37,99.
  {
    kind: "THRESHOLD",
    controlCode: "TEMPERATURA",
    comparador: "GTE",
    valor: 37.5,
    nivel: "N1",
    tipo: TIPOS_DE_INCIDENCIA.FIEBRE,
    sortOrder: 30,
  },
  {
    kind: "THRESHOLD",
    controlCode: "TEMPERATURA",
    comparador: "GTE",
    valor: 38,
    nivel: "N2",
    tipo: TIPOS_DE_INCIDENCIA.FIEBRE,
    sortOrder: 31,
  },
  {
    kind: "THRESHOLD",
    controlCode: "TEMPERATURA",
    comparador: "GTE",
    valor: 39.5,
    nivel: "N3",
    tipo: TIPOS_DE_INCIDENCIA.FIEBRE,
    sortOrder: 32,
  },

  // ── Saturación ───────────────────────────────────────────────────
  {
    kind: "THRESHOLD",
    controlCode: "SATURACION_O2",
    comparador: "LT",
    valor: 92,
    nivel: "N2",
    tipo: TIPOS_DE_INCIDENCIA.HIPOXIA,
    sortOrder: 40,
  },
  {
    kind: "THRESHOLD",
    controlCode: "SATURACION_O2",
    comparador: "LT",
    valor: 88,
    nivel: "N3",
    tipo: TIPOS_DE_INCIDENCIA.HIPOXIA,
    sortOrder: 41,
  },

  // ── Tensión sistólica ────────────────────────────────────────────
  //
  // Dos filas, una por cada extremo. La DIASTÓLICA no tiene ninguna: el
  // §3 gradúa «TA sistólica ≥ 180 o ≤ 90» y nada más. Se toma, se guarda
  // y se ve en la curva.
  {
    kind: "THRESHOLD",
    controlCode: "TA_SISTOLICA",
    comparador: "GTE",
    valor: 180,
    nivel: "N2",
    tipo: TIPOS_DE_INCIDENCIA.TENSION,
    sortOrder: 50,
  },
  {
    kind: "THRESHOLD",
    controlCode: "TA_SISTOLICA",
    comparador: "LTE",
    valor: 90,
    nivel: "N2",
    tipo: TIPOS_DE_INCIDENCIA.TENSION,
    sortOrder: 51,
  },

  // ── Glucemia ─────────────────────────────────────────────────────
  {
    kind: "THRESHOLD",
    controlCode: "GLUCEMIA",
    comparador: "LT",
    valor: 70,
    nivel: "N2",
    tipo: TIPOS_DE_INCIDENCIA.GLUCEMIA,
    sortOrder: 60,
  },
  {
    kind: "THRESHOLD",
    controlCode: "GLUCEMIA",
    comparador: "GT",
    valor: 300,
    nivel: "N2",
    tipo: TIPOS_DE_INCIDENCIA.GLUCEMIA,
    sortOrder: 61,
  },
  {
    kind: "THRESHOLD",
    controlCode: "GLUCEMIA",
    comparador: "LT",
    valor: 50,
    nivel: "N3",
    tipo: TIPOS_DE_INCIDENCIA.GLUCEMIA,
    sortOrder: 62,
  },

  // ── Vómito ───────────────────────────────────────────────────────
  //
  // «Repetido en el turno» no lo pregunta la pantalla: lo cuenta el
  // servidor al derivar (`derivacion.ts`). El matiz existe igual porque
  // la plantilla tiene que poder decir cuánto vale, y quien lo aplica es
  // quien sabe contar lo del turno.
  {
    kind: "EVENT",
    evento: TIPOS_DE_INCIDENCIA.VOMITO,
    matiz: null,
    nivel: "N1",
    tipo: TIPOS_DE_INCIDENCIA.VOMITO,
    sortOrder: 70,
  },
  {
    kind: "EVENT",
    evento: TIPOS_DE_INCIDENCIA.VOMITO,
    matiz: MATICES.REPETIDO,
    nivel: "N2",
    tipo: TIPOS_DE_INCIDENCIA.VOMITO,
    sortOrder: 71,
  },

  // ── Los dos derivados por AUSENCIA (D-20) ────────────────────────
  //
  // No los declara nadie: los genera la pasada programada cruzando lo que
  // hay con lo que no hay. El de deposición es literalmente un indicador
  // de AENOR.
  {
    kind: "EVENT",
    evento: TIPOS_DE_INCIDENCIA.SIN_DEPOSICION,
    matiz: null,
    nivel: "N1",
    tipo: TIPOS_DE_INCIDENCIA.SIN_DEPOSICION,
    sortOrder: 80,
  },
  {
    kind: "EVENT",
    evento: TIPOS_DE_INCIDENCIA.INGESTA_NULA,
    matiz: null,
    nivel: "N1",
    tipo: TIPOS_DE_INCIDENCIA.INGESTA_NULA,
    sortOrder: 81,
  },

  // ── Las dos emergencias ──────────────────────────────────────────
  {
    kind: "EVENT",
    evento: TIPOS_DE_INCIDENCIA.NO_LOCALIZADO,
    matiz: null,
    nivel: "N4",
    tipo: TIPOS_DE_INCIDENCIA.NO_LOCALIZADO,
    sortOrder: 90,
  },
  {
    kind: "EVENT",
    evento: TIPOS_DE_INCIDENCIA.EMERGENCIA_VITAL,
    matiz: null,
    nivel: "N4",
    tipo: TIPOS_DE_INCIDENCIA.EMERGENCIA_VITAL,
    sortOrder: 91,
  },

  // ── Queja y avería ───────────────────────────────────────────────
  //
  // Las dos son del libro único (D-35, D-38) y gradúan con la misma
  // plantilla que una fiebre, que es la mitad del argumento de un solo
  // libro: la gravedad se construye una vez.
  {
    kind: "EVENT",
    evento: TIPOS_DE_INCIDENCIA.QUEJA,
    matiz: null,
    nivel: "N1",
    tipo: TIPOS_DE_INCIDENCIA.QUEJA,
    sortOrder: 100,
  },
  {
    kind: "EVENT",
    evento: TIPOS_DE_INCIDENCIA.AVERIA,
    matiz: MATICES.PELIGROSA,
    nivel: "N2",
    tipo: TIPOS_DE_INCIDENCIA.AVERIA,
    sortOrder: 110,
  },
  {
    kind: "EVENT",
    evento: TIPOS_DE_INCIDENCIA.AVERIA,
    matiz: MATICES.SIN_RIESGO,
    // **N0 y no N1**: una avería sin riesgo es constancia. No abre
    // incidencia, no va al relevo y no suena en ningún sitio — queda
    // escrita y el de mantenimiento la ve en su lista (D-27).
    nivel: "N0",
    tipo: TIPOS_DE_INCIDENCIA.AVERIA,
    sortOrder: 111,
  },
];

/** Cómo se llama cada nivel en la pantalla. Del §6.1 de la rama. */
export const NOMBRE_DEL_NIVEL: Record<Nivel, string> = {
  N0: "Queda constancia",
  N1: "Lo tiene que saber el turno siguiente",
  N2: "Alguien tiene que verlo ahora",
  N3: "Hay que tomar una decisión clínica",
  N4: "Emergencia",
};

/** Y cómo se llama cada tipo. Para el libro y para la pantalla. */
export const NOMBRE_DEL_TIPO: Record<string, string> = {
  FIEBRE: "Fiebre",
  HIPOXIA: "Saturación baja",
  TENSION: "Tensión fuera de rango",
  GLUCEMIA: "Glucemia fuera de rango",
  CAIDA: "Caída",
  VOMITO: "Vómito",
  NO_LOCALIZADO: "No localizado / salida no autorizada",
  EMERGENCIA_VITAL: "No respira bien, no responde o dolor en el pecho",
  AVERIA: "Avería",
  QUEJA: "Queja",
  ALGO_NO_VA_BIEN: "Algo no va bien",
  SIN_DEPOSICION: "Sin deposición más de 3 días",
  INGESTA_NULA: "No ha comido nada en dos comidas seguidas",
};

/**
 * Comprueba el fichero ANTES de escribirlo, igual que
 * `problemasDelCatalogo`.
 *
 * El arranque lo llama: un fichero de datos que alguien edita a mano y que
 * se carga a medias deja el centro graduando por la mitad de la tabla, y
 * eso no se nota hasta que una fiebre de 39,6 sale N2.
 */
export function problemasDeLaPlantilla(
  reglas: ReglaDeSerie[] = PLANTILLA_DE_GRAVEDAD,
): string[] {
  const problemas: string[] = [];
  const vistas = new Set<string>();
  for (const r of reglas) {
    const clave =
      r.kind === "THRESHOLD"
        ? `T|${r.controlCode}|${r.comparador}|${r.valor}`
        : `E|${r.evento}|${r.matiz ?? ""}`;
    if (vistas.has(clave)) {
      problemas.push(`${clave}: la regla está dos veces.`);
    }
    vistas.add(clave);
    if (r.kind === "THRESHOLD" && !Number.isFinite(r.valor)) {
      problemas.push(`${r.controlCode}: el umbral no es un número.`);
    }
    if (!NOMBRE_DEL_TIPO[r.tipo]) {
      problemas.push(`${r.tipo}: el tipo de incidencia no tiene nombre.`);
    }
  }
  // Dos reglas iguales con niveles distintos no romperían nada —gana la
  // más grave— pero sí significan que alguien quiso cambiar un nivel y
  // escribió una fila nueva en vez de editar la que había. Eso se dice.
  return problemas;
}
