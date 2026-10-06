// clinica-3 · las listas versionadas: lesiones, gravedades y consejos.
//
// Las tres salen del mockup validado por Matías el 06-10-2026 y están aquí
// por la MISMA razón que el mapa y que el cuestionario de clinica-2:
// una sesión guarda con qué versión se marcó, así que lo escrito hace dos
// años se sigue leyendo con las palabras con las que se escribió.
//
// Lo de «callo (heloma)» no es un adorno: la podóloga escribe «heloma» y
// el paciente lee «callo», y el informe PDF (clinica-4) va a ir a las dos
// manos. La etiqueta lleva las dos palabras para no tener que elegir.

/** Qué tiene la zona. Versión 1: las siete del mockup, en su orden. */
export interface Lesion {
  /** Corto y estable: viaja en el `body` de la historia PARA SIEMPRE. */
  id: string;
  label: string;
}

export interface ListaDeLesiones {
  version: number;
  lesiones: readonly Lesion[];
}

export const LESIONES_V1: ListaDeLesiones = {
  version: 1,
  lesiones: [
    { id: "callo", label: "Callo (heloma)" },
    { id: "dureza", label: "Dureza" },
    { id: "unero", label: "Uña encarnada" },
    { id: "onico", label: "Hongos en la uña" },
    { id: "verruga", label: "Verruga" },
    { id: "herida", label: "Herida / úlcera" },
    { id: "juanete", label: "Juanete / deformidad" },
  ],
};

export const VERSION_DE_LAS_LESIONES = LESIONES_V1.version;

const LESIONES_POR_VERSION: Record<number, ListaDeLesiones> = {
  [LESIONES_V1.version]: LESIONES_V1,
};

export function lesionesDeVersion(
  version: number,
): ListaDeLesiones | undefined {
  return LESIONES_POR_VERSION[version];
}

export function lesionDe(
  id: string,
  version: number = VERSION_DE_LAS_LESIONES,
): Lesion | undefined {
  return lesionesDeVersion(version)?.lesiones.find((l) => l.id === id);
}

/** Cómo se lee una lesión. La id tal cual si la versión no se conoce: lo
 *  escrito tiene que seguir viéndose (misma regla que `nombreDeZona`). */
export function nombreDeLesion(
  id: string,
  version: number = VERSION_DE_LAS_LESIONES,
): string {
  return lesionDe(id, version)?.label ?? id;
}

// ── La gravedad ───────────────────────────────────────────────────────
//
// Tres peldaños y nada más. **No está versionada aparte** y es a
// propósito: «leve / moderada / severa» no es una lista que la podóloga
// vaya a editar —es la escala con la que se lee una lesión— y meterla en
// la versión de las lesiones habría atado dos cosas que cambian a ritmos
// distintos. Si algún día se parte en cinco, se versiona entonces y con su
// propia versión; hoy inventarla sería inventar un número que nadie usa.

export const GRAVEDADES = ["LEVE", "MODERADA", "SEVERA"] as const;
export type Gravedad = (typeof GRAVEDADES)[number];

export const NOMBRE_DE_GRAVEDAD: Record<Gravedad, string> = {
  LEVE: "Leve",
  MODERADA: "Moderada",
  SEVERA: "Severa",
};

export function esGravedad(x: unknown): x is Gravedad {
  return typeof x === "string" && (GRAVEDADES as readonly string[]).includes(x);
}

// ── Los consejos para casa ────────────────────────────────────────────

export interface Consejo {
  id: string;
  label: string;
}

export interface ListaDeConsejos {
  version: number;
  consejos: readonly Consejo[];
}

export const CONSEJOS_V1: ListaDeConsejos = {
  version: 1,
  consejos: [
    { id: "calzado", label: "Calzado ancho" },
    { id: "hidratar", label: "Hidratar cada día" },
    { id: "revisar", label: "Revisar los pies a diario" },
    { id: "cura", label: "Cura en casa" },
    { id: "nocortar", label: "No cortar callos en casa" },
  ],
};

export const VERSION_DE_LOS_CONSEJOS = CONSEJOS_V1.version;

const CONSEJOS_POR_VERSION: Record<number, ListaDeConsejos> = {
  [CONSEJOS_V1.version]: CONSEJOS_V1,
};

export function consejosDeVersion(
  version: number,
): ListaDeConsejos | undefined {
  return CONSEJOS_POR_VERSION[version];
}

export function consejoDe(
  id: string,
  version: number = VERSION_DE_LOS_CONSEJOS,
): Consejo | undefined {
  return consejosDeVersion(version)?.consejos.find((c) => c.id === id);
}

export function nombreDeConsejo(
  id: string,
  version: number = VERSION_DE_LOS_CONSEJOS,
): string {
  return consejoDe(id, version)?.label ?? id;
}

// ── La próxima cita ───────────────────────────────────────────────────
//
// Cuatro botones, y lo que se guarda es una PROPUESTA: «dentro de 4
// semanas». No se reserva sola (decisión del prompt §3) — la recepción
// elige el hueco con el paciente delante, porque elegirlo sin él es
// elegir un día al que no va a venir.
//
// Se guardan SEMANAS y no una fecha. Una fecha calculada al cerrar la
// sesión sería falsa en cuanto la recepción la mueva un día, y la
// propuesta no es «el martes 3»: es «dentro de un mes».

export const PROXIMAS_CITAS = ["S2", "S4", "S8", "SIN_CITA"] as const;
export type ProximaCita = (typeof PROXIMAS_CITAS)[number];

export const NOMBRE_DE_PROXIMA_CITA: Record<ProximaCita, string> = {
  S2: "2 semanas",
  S4: "4 semanas",
  S8: "8 semanas",
  SIN_CITA: "Sin cita",
};

/** Las semanas de una propuesta. `null` para «Sin cita». */
export const SEMANAS_DE_PROXIMA_CITA: Record<ProximaCita, number | null> = {
  S2: 2,
  S4: 4,
  S8: 8,
  SIN_CITA: null,
};

export function esProximaCita(x: unknown): x is ProximaCita {
  return (
    typeof x === "string" && (PROXIMAS_CITAS as readonly string[]).includes(x)
  );
}

// ── La evolución desde la última visita ───────────────────────────────

export const EVOLUCIONES = ["MEJOR", "IGUAL", "PEOR"] as const;
export type Evolucion = (typeof EVOLUCIONES)[number];

export const NOMBRE_DE_EVOLUCION: Record<Evolucion, string> = {
  MEJOR: "Mejor",
  IGUAL: "Igual",
  PEOR: "Peor",
};

export function esEvolucion(x: unknown): x is Evolucion {
  return (
    typeof x === "string" && (EVOLUCIONES as readonly string[]).includes(x)
  );
}
