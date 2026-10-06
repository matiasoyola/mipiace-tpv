// clinica-3 · la EXPLORACIÓN del pie: pulsos, monofilamento y tipo de pie.
//
// Es lo que se hace en la primera visita y cuando la podóloga lo vea
// necesario (en diabéticos, una vez al año). Vive en su pestaña y en su
// propia entrada de historia, separada de la sesión.
//
// ── Por qué NO es parte del cuerpo de la sesión ───────────────────────
//
// Por dos razones, y la segunda es la que manda:
//
//   1. **Ritmos distintos.** Una sesión es cada dos semanas; una
//      exploración, una vez al año. Metida dentro de la sesión, cada
//      sesión arrastraría una copia de la exploración y «¿cuándo se le
//      exploró?» pasaría a ser «busca la última sesión cuya copia de la
//      exploración sea distinta de la anterior».
//
//   2. **La puerta del prompt (§2).** No se puede abrir una SESIÓN de un
//      paciente sin valoración validada; **la exploración sí se puede
//      registrar**, porque es parte de la primera visita — y la primera
//      visita es justo la que puede no tener todavía la valoración
//      validada. Si la exploración se guardara al cerrar la sesión, no
//      habría forma de registrarla el día que más falta hace.
//
// ── «La siguiente parte de la última» ─────────────────────────────────
//
// Decisión de producto 5. La pantalla NO arranca vacía: arranca con lo de
// la última exploración, y la podóloga cambia lo que haya cambiado. Lo
// que se guarda es una exploración NUEVA y completa (la anterior no se
// toca: es historia), pero se teclea sólo la diferencia.
//
// Y eso es exactamente lo que hace `partirDeLaUltima`, que es una función
// y no un `??` repartido por la pantalla: con la copia en el `.tsx`, el
// día que la exploración gane un campo habría un campo que no se hereda y
// nadie lo notaría hasta ver una exploración que dice «pulso presente»
// porque es el valor por defecto y no porque alguien lo tomara.

import { PIES, clavesDelMapa, type Pie } from "./mapa.js";

/** La versión del cuerpo de la exploración. */
export const VERSION_DE_LA_EXPLORACION = 1;

export const PULSOS = ["PRESENTE", "DEBIL", "AUSENTE"] as const;
export type Pulso = (typeof PULSOS)[number];

export const NOMBRE_DE_PULSO: Record<Pulso, string> = {
  PRESENTE: "Presente",
  DEBIL: "Débil",
  AUSENTE: "Ausente",
};

export function esPulso(x: unknown): x is Pulso {
  return typeof x === "string" && (PULSOS as readonly string[]).includes(x);
}

export const TIPOS_DE_PIE = ["PLANO", "NORMAL", "CAVO"] as const;
export type TipoDePie = (typeof TIPOS_DE_PIE)[number];

export const NOMBRE_DE_TIPO_DE_PIE: Record<TipoDePie, string> = {
  PLANO: "Plano",
  NORMAL: "Normal",
  CAVO: "Cavo",
};

export function esTipoDePie(x: unknown): x is TipoDePie {
  return (
    typeof x === "string" && (TIPOS_DE_PIE as readonly string[]).includes(x)
  );
}

/** El cuerpo de la exploración, tal como entra en `clinical_entries.body`. */
export interface CuerpoDeExploracion {
  v: number;
  mapaVersion: number;
  /** Pulso de cada pie. */
  pulsos: Record<Pie, Pulso>;
  /**
   * Las claves del mapa (`"L:h"`, `"R:talon"`) donde el paciente **NO
   * siente** el monofilamento.
   *
   * Se guarda lo que NO siente y no lo que sí, y es la lectura correcta:
   * lo normal es sentirlo en todas, así que la lista corta es la de los
   * hallazgos. Una lista de «sí siente» con veintidós entradas obligaría
   * a leerla entera para encontrar las dos que faltan.
   */
  sinSensibilidad: readonly string[];
  tipoDePie: TipoDePie;
  /** LA FIRMA, congelada igual que en la sesión (ver `CuerpoDeSesion`). */
  firma: {
    autorNombre: string;
    colegiado: string | null;
    firmadaEn: string;
  };
}

/** Lo que la pantalla tiene en la mano antes de guardar. */
export interface ExploracionEnPantalla {
  pulsos: Record<Pie, Pulso>;
  sinSensibilidad: readonly string[];
  tipoDePie: TipoDePie;
}

/**
 * El suelo cuando no hay ninguna exploración anterior.
 *
 * `PRESENTE` y `NORMAL` son lo normal, y es el único sitio honesto donde
 * ponerlos: la pantalla tiene que arrancar con los tres segmentos
 * marcados en algo (el mockup los pinta así) y «lo normal» es lo que la
 * podóloga va a confirmar nueve veces de cada diez.
 *
 * Y sin sensibilidad, ninguna zona: eso sí arranca vacío, porque un punto
 * sin sensibilidad es SIEMPRE un hallazgo y ninguno se da por supuesto.
 */
export function exploracionVacia(): ExploracionEnPantalla {
  return {
    pulsos: { L: "PRESENTE", R: "PRESENTE" },
    sinSensibilidad: [],
    tipoDePie: "NORMAL",
  };
}

/**
 * «La siguiente parte de la última» (decisión de producto 5).
 *
 * Devuelve lo de la última exploración, ya limpio, o el suelo si no hay
 * ninguna. No mezcla: una exploración es una foto completa del pie en un
 * día, y sumarle lo de hace un año daría una foto que nunca existió —
 * **al contrario que el mapa de la sesión, donde «igual que la última
 * vez» SÍ suma**, porque ahí lo que se acumula son lesiones que siguen
 * ahí.
 *
 * Las dos reglas conviven y son distintas a propósito; están la una al
 * lado de la otra en este paquete para que se lean juntas.
 */
export function partirDeLaUltima(
  ultima: ExploracionEnPantalla | null,
): ExploracionEnPantalla {
  if (!ultima) return exploracionVacia();
  return {
    pulsos: { L: ultima.pulsos.L, R: ultima.pulsos.R },
    sinSensibilidad: [...ultima.sinSensibilidad],
    tipoDePie: ultima.tipoDePie,
  };
}

/**
 * Valida y normaliza lo que llega de la pantalla.
 *
 * Nunca falla: lo que viene mal cae a lo normal (un pulso desconocido es
 * `PRESENTE`, un tipo de pie desconocido es `NORMAL`) y las zonas que no
 * son de este mapa se tiran en silencio. Es la misma decisión que
 * `limpiarMarcas`: lo que importa es que no entre basura en la historia,
 * y un 400 aquí sería negarle a la podóloga guardar una exploración
 * entera por una clave que la pantalla mandó de más.
 *
 * Lo que SÍ es estricto: los dos pulsos y el tipo de pie están SIEMPRE,
 * porque una exploración sin pulsos no es una exploración.
 */
export function normalizarExploracion(input: {
  pulsos?: Partial<Record<Pie, unknown>> | null;
  sinSensibilidad?: readonly unknown[] | null;
  tipoDePie?: unknown;
}): ExploracionEnPantalla {
  const validas = new Set(clavesDelMapa());
  const pulsos = {} as Record<Pie, Pulso>;
  for (const pie of PIES) {
    const v = input.pulsos?.[pie];
    pulsos[pie] = esPulso(v) ? v : "PRESENTE";
  }
  const sinSensibilidad = [
    ...new Set(
      (input.sinSensibilidad ?? []).filter(
        (x): x is string => typeof x === "string" && validas.has(x),
      ),
    ),
  ];
  return {
    pulsos,
    sinSensibilidad,
    tipoDePie: esTipoDePie(input.tipoDePie) ? input.tipoDePie : "NORMAL",
  };
}

/** Cuántos puntos sin sensibilidad tiene cada pie. Lo lee la cabecera. */
export function sinSensibilidadPorPie(
  claves: readonly string[],
): Record<Pie, number> {
  const cuenta: Record<Pie, number> = { L: 0, R: 0 };
  for (const clave of claves) {
    const pie = clave.slice(0, clave.indexOf(":"));
    if (pie === "L" || pie === "R") cuenta[pie] += 1;
  }
  return cuenta;
}
