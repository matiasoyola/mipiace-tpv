// clinica-5 · EL PIE DE RIESGO, con la clasificación de la IWGDF.
//
// Cuatro comprobaciones y sale el riesgo y cada cuánto hay que revisar. La
// podóloga no calcula nada: toca cuatro parejas de botones.
//
// ── Por qué la IWGDF y no la del mockup ───────────────────────────────
//
// Decisión 6 del prompt. El mockup contaba fallos y sumaba (úlcera valía
// dos), que es un apaño para que un mockup se mueva. La guía de verdad
// —la que una podóloga ha estudiado y la que un inspector reconoce— es la
// del International Working Group on the Diabetic Foot, y clasifica en
// cuatro categorías con combinaciones, no con una suma.
//
// FUENTE, citada en el código como pide el prompt:
//
//   IWGDF Guidelines on the prevention of foot ulcers in persons with
//   diabetes, 2023 (IWGDF Prevention Guideline). Tabla de estratificación
//   del riesgo: categoría 0 (muy bajo) a 3 (alto), con la frecuencia de
//   cribado recomendada para cada una.
//
// Y la diferencia que la guía pide y el mockup no tenía: la **deformidad**
// del pie. Sin ella, un paciente con pérdida de sensibilidad y un juanete
// que roza sale «bajo» cuando la guía lo pone en «moderado» — y la
// diferencia entre revisar cada 6–12 meses y cada 3–6 es, en el pie de un
// diabético, la diferencia entre encontrar una úlcera y encontrar una
// amputación.
//
// ── PENDIENTE DE VALIDAR CON ROSARIO ──────────────────────────────────
//
// Dicho aquí y no sólo en el `-done`, igual que la regla de niveles: la
// tabla es la de la guía, pero **qué hace Rosario con cada categoría** (el
// plazo exacto dentro de la horquilla, si deriva, si la deformidad la
// valora ella o el traumatólogo) está sin confirmar. El riesgo PROPONE la
// próxima cita; no la crea.

import { PIES, type Pie } from "./mapa.js";

/** La versión del criterio. Viaja en el cuerpo de la sesión: lo
 *  clasificado con la 1 se sigue explicando con la 1. */
export const VERSION_DEL_RIESGO = 1;

/** La cita de la fuente, para que la pantalla y el informe de clinica-4 la
 *  escriban con las mismas palabras y no haya dos redacciones de la misma
 *  guía. */
export const FUENTE_DEL_RIESGO =
  "IWGDF Guidelines 2023 · prevención de úlceras (estratificación del riesgo). Pendiente de validar con Rosario.";

// ── Las cuatro comprobaciones ─────────────────────────────────────────

/** Monofilamento de Semmes-Weinstein 10 g. «Pérdida» es la LOPS de la
 *  guía (loss of protective sensation). */
export const SENSIBILIDADES = ["NORMAL", "PERDIDA"] as const;
export type Sensibilidad = (typeof SENSIBILIDADES)[number];

export const NOMBRE_DE_SENSIBILIDAD: Record<Sensibilidad, string> = {
  NORMAL: "Normal",
  PERDIDA: "Pérdida",
};

/**
 * Pulso pedio de un pie: se palpa o no se palpa.
 *
 * DOS valores y no los tres de la exploración de clinica-3
 * (`PRESENTE / DEBIL / AUSENTE`), y es a propósito: la guía pregunta por
 * enfermedad arterial periférica, que es «ausente» o «no ausente». Un
 * «débil» metido en la clasificación obligaría a decidir a qué categoría
 * cae, y eso sería inventarse un criterio que la IWGDF no da.
 *
 * El «débil» de la exploración sigue existiendo donde servía: en la foto
 * anual del pie, que es descriptiva.
 */
export const PULSOS_PEDIOS = ["PRESENTE", "AUSENTE"] as const;
export type PulsoPedio = (typeof PULSOS_PEDIOS)[number];

export const NOMBRE_DE_PULSO_PEDIO: Record<PulsoPedio, string> = {
  PRESENTE: "Sí",
  AUSENTE: "No",
};

export const SI_NO = ["NO", "SI"] as const;
export type SiNo = (typeof SI_NO)[number];

export const NOMBRE_DE_SI_NO: Record<SiNo, string> = { NO: "No", SI: "Sí" };

export function esSensibilidad(x: unknown): x is Sensibilidad {
  return (
    typeof x === "string" && (SENSIBILIDADES as readonly string[]).includes(x)
  );
}

export function esPulsoPedio(x: unknown): x is PulsoPedio {
  return (
    typeof x === "string" && (PULSOS_PEDIOS as readonly string[]).includes(x)
  );
}

export function esSiNo(x: unknown): x is SiNo {
  return typeof x === "string" && (SI_NO as readonly string[]).includes(x);
}

/**
 * Lo que la podóloga ha contestado. `null` = sin contestar, y **sin las
 * cuatro no hay veredicto**: una categoría de riesgo calculada sobre tres
 * respuestas y un hueco es un número que parece una medida y no lo es.
 */
export interface ComprobacionesDelPie {
  sensibilidad: Sensibilidad | null;
  /** Los pulsos pedios de CADA pie, como pide el prompt. */
  pulsos: Record<Pie, PulsoPedio | null>;
  /** Úlcera previa o actual. La guía los junta: una úlcera cicatrizada
   *  deja el pie en el mismo escalón de riesgo que una abierta. */
  ulcera: SiNo | null;
  /** La cuarta, la que el mockup no tenía. */
  deformidad: SiNo | null;
}

export function comprobacionesVacias(): ComprobacionesDelPie {
  return {
    sensibilidad: null,
    pulsos: { L: null, R: null },
    ulcera: null,
    deformidad: null,
  };
}

// ── La tabla de la guía, como dato ────────────────────────────────────

export type CategoriaDeRiesgo = 0 | 1 | 2 | 3;

export interface EscalonDeRiesgo {
  categoria: CategoriaDeRiesgo;
  nombre: string;
  /** La horquilla de la guía, en meses. `[12, 12]` = una vez al año. */
  plazoMeses: readonly [number, number];
  /** Cómo se lee el plazo en la pantalla. */
  plazo: string;
}

/**
 * Los cuatro escalones, de la guía, de más grave a menos. El orden
 * importa: la clasificación devuelve el PRIMERO que case.
 */
export const ESCALONES_DE_RIESGO: readonly EscalonDeRiesgo[] = [
  {
    categoria: 3,
    nombre: "Riesgo alto",
    plazoMeses: [1, 3],
    plazo: "Revisión cada 1–3 meses",
  },
  {
    categoria: 2,
    nombre: "Riesgo moderado",
    plazoMeses: [3, 6],
    plazo: "Revisión cada 3–6 meses",
  },
  {
    categoria: 1,
    nombre: "Riesgo bajo",
    plazoMeses: [6, 12],
    plazo: "Revisión cada 6–12 meses",
  },
  {
    categoria: 0,
    nombre: "Riesgo muy bajo",
    plazoMeses: [12, 12],
    plazo: "Revisión anual",
  },
];

export function escalonDe(categoria: CategoriaDeRiesgo): EscalonDeRiesgo {
  return ESCALONES_DE_RIESGO.find((e) => e.categoria === categoria)!;
}

export interface RiesgoDelPie extends EscalonDeRiesgo {
  /** Por qué sale ésa, en la frase que se enseña debajo. Se redacta aquí
   *  por la misma razón que el motivo del nivel: es lo que sostiene una
   *  decisión clínica y no puede tener dos redacciones. */
  motivo: string;
  /** Las tres señales de la guía, ya resueltas. Las guarda la sesión: son
   *  lo que hace reproducible la clasificación dentro de cinco años,
   *  aunque el criterio cambie. */
  senales: {
    /** LOPS · pérdida de sensibilidad protectora. */
    perdidaDeSensibilidad: boolean;
    /** PAD · pulsos ausentes en al menos un pie. */
    pulsosAusentes: boolean;
    ulcera: boolean;
    deformidad: boolean;
  };
}

/**
 * La categoría de riesgo y el plazo de revisión, o `null` si falta alguna
 * de las cuatro comprobaciones.
 *
 * La tabla, tal como la escribe la guía y el prompt §6:
 *
 *   · **3 · alto** · (pérdida de sensibilidad **o** pulsos ausentes)
 *     **y** úlcera previa o actual → cada 1–3 meses.
 *   · **2 · moderado** · pérdida de sensibilidad **y** pulsos ausentes,
 *     **o** una de las dos **y** deformidad → cada 3–6 meses.
 *   · **1 · bajo** · pérdida de sensibilidad **o** pulsos ausentes →
 *     cada 6–12 meses.
 *   · **0 · muy bajo** · ni una ni otra → revisión anual.
 *
 * Un dato que conviene tener claro al leer la tabla: la **deformidad
 * sola** no sube de categoría. No es un olvido — es lo que dice la guía:
 * un pie deformado que siente y tiene pulso no es un pie en riesgo de
 * ulcerarse, es un pie deformado.
 *
 * Los pulsos los mira **el peor pie**: lo que esta función decide es cada
 * cuánto se le revisa a la PERSONA, y a una persona con el pie izquierdo
 * sin pulso no se le revisa cada año porque el derecho esté bien.
 */
export function riesgoDelPie(c: ComprobacionesDelPie): RiesgoDelPie | null {
  if (c.sensibilidad == null) return null;
  if (c.ulcera == null) return null;
  if (c.deformidad == null) return null;
  for (const pie of PIES) if (c.pulsos[pie] == null) return null;

  const perdidaDeSensibilidad = c.sensibilidad === "PERDIDA";
  const pulsosAusentes = PIES.some((pie) => c.pulsos[pie] === "AUSENTE");
  const ulcera = c.ulcera === "SI";
  const deformidad = c.deformidad === "SI";
  const senales = {
    perdidaDeSensibilidad,
    pulsosAusentes,
    ulcera,
    deformidad,
  };
  const alguna = perdidaDeSensibilidad || pulsosAusentes;

  if (alguna && ulcera) {
    return {
      ...escalonDe(3),
      senales,
      motivo: `${nombraSenales(senales)} con úlcera previa o actual.`,
    };
  }
  if (
    (perdidaDeSensibilidad && pulsosAusentes) ||
    (alguna && deformidad)
  ) {
    return {
      ...escalonDe(2),
      senales,
      motivo: `${nombraSenales(senales)}.`,
    };
  }
  if (alguna) {
    return {
      ...escalonDe(1),
      senales,
      motivo: `${nombraSenales(senales)}.`,
    };
  }
  return {
    ...escalonDe(0),
    senales,
    motivo: deformidad
      ? "Sensibilidad y pulsos normales. La deformidad sola no sube el riesgo."
      : "Sensibilidad, pulsos, úlcera y deformidad, todo normal.",
  };
}

function nombraSenales(s: RiesgoDelPie["senales"]): string {
  const partes: string[] = [];
  if (s.perdidaDeSensibilidad) partes.push("pérdida de sensibilidad");
  if (s.pulsosAusentes) partes.push("pulsos ausentes");
  if (s.deformidad) partes.push("deformidad");
  if (partes.length === 0) return "Sin señales de riesgo";
  const primera = partes[0]!;
  return (
    primera.charAt(0).toUpperCase() +
    primera.slice(1) +
    (partes.length > 1 ? ` y ${partes.slice(1).join(" y ")}` : "")
  );
}

/**
 * Lo que falta para tener veredicto, para que la tarjeta lo diga en vez de
 * quedarse en blanco.
 *
 * Devuelve los nombres de las comprobaciones sin contestar, en el orden en
 * que están en la tarjeta.
 */
export function faltaPorComprobar(c: ComprobacionesDelPie): readonly string[] {
  const falta: string[] = [];
  if (c.sensibilidad == null) falta.push("la sensibilidad");
  const sinPulso = PIES.filter((pie) => c.pulsos[pie] == null);
  if (sinPulso.length === 2) falta.push("los pulsos");
  else if (sinPulso.length === 1) {
    falta.push(`el pulso del pie ${sinPulso[0] === "L" ? "izquierdo" : "derecho"}`);
  }
  if (c.ulcera == null) falta.push("la úlcera");
  if (c.deformidad == null) falta.push("la deformidad");
  return falta;
}
