// residencia-2 · la forma de una fila del catálogo de serie.
//
// Es un fichero de DATOS del producto, versionado en el repo, y lo carga un
// seed idempotente al arrancar (`cargar-catalogo.ts`). No es una migración
// con 36 INSERT a mano por dos razones:
//
//   1. Una versión nueva de un control es un cambio de ESTE fichero, y
//      revisarlo en un PR es leer una tabla. Revisarlo en SQL es leer 36
//      INSERT y confiar en que el `ON CONFLICT` está bien.
//   2. La reconducción del ajuste del centro cuando una versión nueva
//      retira una frecuencia (alcance §2) es lógica, no DDL, y tiene que
//      correr en la misma transacción que el INSERT de la versión.
//
// La frontera que este fichero materializa (rama de controles §10): **todo
// lo de aquí es del producto y el centro no lo toca**. Lo que el centro
// decide vive en `center_control_settings`, y es un subconjunto.

import type {
  CareFrequencyKind,
  ControlLayer,
  ControlNature,
  ControlValueDomain,
  DependencyLevel,
} from "@mipiacetpv/db";

/** Una opción de un control ordinal. */
export interface OpcionDeSerie {
  code: string;
  label: string;
  /**
   * ¿Es la que da por buena el toque de «como siempre» (D-16)? Como mucho
   * una por control, y lo impide el índice parcial
   * `control_type_options_un_como_siempre_key`.
   */
  asUsual?: boolean;
}

/** La frecuencia de serie de un control, o la de una línea de plantilla. */
export interface FrecuenciaDeSerie {
  kind: CareFrequencyKind;
  everyNHours?: number;
  everyNDays?: number;
  /** ISO: 1 = lunes … 7 = domingo. */
  weekdays?: number[];
  monthDay?: number;
  shiftCodes?: string[];
  momentCodes?: string[];
}

/** Un control del catálogo de serie. */
export interface ControlDeSerie {
  code: string;
  /**
   * La versión de ESTE código. Sube cuando cambia una guía clínica (D-21,
   * D-57); lo registrado sigue apuntando a la versión con la que se
   * registró. Hoy todos están en 1 — es la primera vez que se publican.
   */
  version: number;
  name: string;
  layer: ControlLayer;
  nature: ControlNature;
  valueDomain: ControlValueDomain;

  /** Sólo `NUMERIC`: la unidad que se pinta junto al número. */
  unit?: string;
  /** Sólo `NUMERIC`: lo que la pantalla deja teclear. */
  inputMin?: number;
  inputMax?: number;
  /**
   * Sólo `NUMERIC`: lo NORMAL, para pintar en gris o en ámbar. **No es un
   * umbral de aviso**: los umbrales son residencia-4, van versionados
   * aparte y admiten excepción por residente con prescripción médica
   * firmada (D-21, D-22).
   */
  refMin?: number;
  refMax?: number;

  /** Controles que se toman y se pintan juntos. Hoy sólo la tensión. */
  groupCode?: string;

  /** Sólo `ORDINAL`: las opciones, de mejor a peor. */
  options?: OpcionDeSerie[];

  /** Las frecuencias que el producto admite. El centro elige DENTRO. */
  allowedFrequencies: CareFrequencyKind[];
  /** La que el centro se encuentra puesta. */
  defaultFrequency: FrecuenciaDeSerie;
  /**
   * Los roles de cuidado que pueden registrarlo. El centro puede
   * ESTRECHARLO y no ensancharlo. Son códigos de `CareRole`, no FKs:
   * `CareRole` es por tenant y este catálogo es global.
   */
  allowedCareRoleCodes: string[];

  /** A qué indicador de calidad alimenta. Ver `INDICADORES_ISO`. */
  isoIndicatorCode?: string;
  /** D-60: todo interno por defecto. */
  familyVisibleDefault?: boolean;
  sortOrder: number;
}

/** Una línea de la plantilla de serie de un nivel de dependencia. */
export interface LineaDePlantillaDeSerie {
  controlCode: string;
  frequency: FrecuenciaDeSerie;
}

/** La plantilla de serie de un nivel. */
export type PlantillasDeSerie = Record<DependencyLevel, LineaDePlantillaDeSerie[]>;

/** Un momento del día de serie. */
export interface MomentoDeSerie {
  code: string;
  name: string;
  /** Hora de pared «HH:MM». */
  atTime: string;
  sortOrder: number;
}
