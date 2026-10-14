// residencia-2 · la frecuencia, entre las SIETE COLUMNAS de la base y el
// objeto que leen `queToca` y las pantallas.
//
// Cuatro tablas llevan frecuencia (`control_types` con el prefijo
// `default_`, `center_control_settings`, `care_plan_template_items` y
// `care_plan_items`) y tres sitios la leen. Si la conversión se escribiera
// en cada uno, el que se olvidara de copiar `monthDay` dejaría una visita
// médica que no toca ningún día y nadie lo vería hasta el mes siguiente.
//
// Así que vive aquí, en dos funciones de cuatro líneas, y nadie más toca
// esas columnas.

import type { Frecuencia } from "@mipiacetpv/residencia-plan";
import type { CareFrequencyKind } from "@mipiacetpv/db";

/** La forma que tienen las siete columnas en una fila de cualquiera de las cuatro tablas. */
export interface ColumnasDeFrecuencia {
  frequencyKind: CareFrequencyKind;
  everyNHours: number | null;
  everyNDays: number | null;
  weekdays: number[];
  monthDay: number | null;
  shiftCodes: string[];
  momentCodes: string[];
}

/**
 * Objeto → columnas, listas para un `create` de Prisma.
 *
 * Los campos que el `kind` no usa salen explícitamente a `null` y a `[]` y
 * no «sin poner»: el CHECK `…_frecuencia_coherente` exige que estén
 * vacíos, y dejarlos sin tocar en un `update` conservaría el valor
 * anterior — que es exactamente el fallo de «cambio de tipo y me dejo el
 * campo de antes», el que la base rechaza con un 500.
 */
export function aColumnas(f: Frecuencia): ColumnasDeFrecuencia {
  const usa = (campo: "horas" | "dias" | "semana" | "mes" | "turnos" | "momentos") => {
    switch (f.kind) {
      case "EVERY_SHIFT":
      case "DAILY":
        return campo === "turnos";
      case "MOMENTS":
        return campo === "momentos";
      case "EVERY_N_HOURS":
        return campo === "horas";
      case "WEEKDAYS":
        return campo === "semana" || campo === "turnos";
      case "EVERY_N_DAYS":
        return campo === "dias" || campo === "turnos";
      case "MONTHLY":
        return campo === "mes" || campo === "turnos";
      case "ON_DEMAND":
        return false;
    }
  };
  return {
    frequencyKind: f.kind,
    everyNHours: usa("horas") ? (f.everyNHours ?? null) : null,
    everyNDays: usa("dias") ? (f.everyNDays ?? null) : null,
    // Ordenados al guardar: la pantalla los manda en el orden en que se
    // pulsan las casillas, y «V, L, X» en el parte de relevo se lee dos
    // veces. Ordenarlos aquí y no al pintarlos los deja ordenados también
    // para quien lea la base a mano.
    weekdays: usa("semana") ? [...(f.weekdays ?? [])].sort((a, b) => a - b) : [],
    monthDay: usa("mes") ? (f.monthDay ?? null) : null,
    shiftCodes: usa("turnos") ? (f.shiftCodes ?? []) : [],
    momentCodes: usa("momentos") ? (f.momentCodes ?? []) : [],
  };
}

/** Columnas → objeto, para `queToca` y para las pantallas. */
export function deColumnas(fila: ColumnasDeFrecuencia): Frecuencia {
  return {
    kind: fila.frequencyKind,
    everyNHours: fila.everyNHours,
    everyNDays: fila.everyNDays,
    weekdays: fila.weekdays,
    monthDay: fila.monthDay,
    shiftCodes: fila.shiftCodes,
    momentCodes: fila.momentCodes,
  };
}

/** El `select` de Prisma con las siete columnas, sin prefijo. */
export const FRECUENCIA_SELECT = {
  frequencyKind: true,
  everyNHours: true,
  everyNDays: true,
  weekdays: true,
  monthDay: true,
  shiftCodes: true,
  momentCodes: true,
} as const;

/** El mismo `select`, con el prefijo `default` de `control_types`. */
export const FRECUENCIA_DEFAULT_SELECT = {
  defaultFrequencyKind: true,
  defaultEveryNHours: true,
  defaultEveryNDays: true,
  defaultWeekdays: true,
  defaultMonthDay: true,
  defaultShiftCodes: true,
  defaultMomentCodes: true,
} as const;

/** La frecuencia DE SERIE de un control, desde sus columnas `default_*`. */
export function deColumnasDefault(fila: {
  defaultFrequencyKind: CareFrequencyKind;
  defaultEveryNHours: number | null;
  defaultEveryNDays: number | null;
  defaultWeekdays: number[];
  defaultMonthDay: number | null;
  defaultShiftCodes: string[];
  defaultMomentCodes: string[];
}): Frecuencia {
  return {
    kind: fila.defaultFrequencyKind,
    everyNHours: fila.defaultEveryNHours,
    everyNDays: fila.defaultEveryNDays,
    weekdays: fila.defaultWeekdays,
    monthDay: fila.defaultMonthDay,
    shiftCodes: fila.defaultShiftCodes,
    momentCodes: fila.defaultMomentCodes,
  };
}

/** Objeto → columnas con el prefijo `default` de `control_types`. */
export function aColumnasDefault(f: Frecuencia) {
  const c = aColumnas(f);
  return {
    defaultFrequencyKind: c.frequencyKind,
    defaultEveryNHours: c.everyNHours,
    defaultEveryNDays: c.everyNDays,
    defaultWeekdays: c.weekdays,
    defaultMonthDay: c.monthDay,
    defaultShiftCodes: c.shiftCodes,
    defaultMomentCodes: c.momentCodes,
  };
}

/** ¿Son la misma frecuencia? Compara las siete columnas, no el objeto. */
export function mismaFrecuencia(a: Frecuencia, b: Frecuencia): boolean {
  const ca = aColumnas(a);
  const cb = aColumnas(b);
  const mismaLista = (x: Array<string | number>, y: Array<string | number>) =>
    x.length === y.length && x.every((v, i) => v === y[i]);
  return (
    ca.frequencyKind === cb.frequencyKind &&
    ca.everyNHours === cb.everyNHours &&
    ca.everyNDays === cb.everyNDays &&
    ca.monthDay === cb.monthDay &&
    mismaLista(ca.weekdays, cb.weekdays) &&
    // Los turnos y los momentos se comparan como CONJUNTO y no como
    // lista: «M, T» y «T, M» son la misma frecuencia, y si se compararan
    // en orden, guardar dos veces lo mismo contaría como un cambio y
    // cerraría una línea del plan para abrir otra idéntica.
    mismaLista([...ca.shiftCodes].sort(), [...cb.shiftCodes].sort()) &&
    mismaLista([...ca.momentCodes].sort(), [...cb.momentCodes].sort())
  );
}
