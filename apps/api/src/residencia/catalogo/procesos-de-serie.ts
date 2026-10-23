// calidad-1 (D-70, D-71) · **EL MAPA DE PROCESOS DE REFERENCIA PARA
// RESIDENCIAS, Y LOS CUATRO RIESGOS QUE AENOR ECHA EN FALTA.**
//
// Dato del producto, versionado en el repo, como `controles-de-serie.ts` y
// `plantilla-de-gravedad.ts`. Once procesos y cuatro riesgos que un centro
// **carga una vez y adapta**: renombra, añade los suyos y desactiva los
// que no usa.
//
// ── POR QUÉ EL PRODUCTO TRAE UN MAPA ────────────────────────────────
//
// Porque sin él la primera pantalla de calidad es un folio en blanco, y un
// folio en blanco se rellena con una consultoría. El objetivo del módulo
// es que **cualquier centro certificado en ISO 9001 entre con su mapa sin
// nadie delante**, y para eso el producto tiene que opinar: éstos son los
// procesos de una residencia de mayores.
//
// Y es una PLANTILLA, no un catálogo de serie — la misma distinción que
// `obligaciones-de-serie.ts` dejó escrita: **no baja a todos los centros
// al arrancar la API y no se versiona**. El mapa es del centro desde el
// momento en que lo carga; un cambio que el producto hiciera aquí en 2028
// no debe renombrar el proceso que la dirección de Jardín de Gredos
// ajustó en noviembre.
//
// ── SEPARA LO QUE AENOR CRITICÓ QUE ESTUVIERA JUNTO (obs. 07) ───────
//
// La observación 07 del informe de 2026 dice que «el proceso único de
// PRESTACIÓN DEL SERVICIO junta actividades muy diversas». Por eso aquí
// hay **seis procesos operativos y no uno**: admisión, valoración,
// sanitaria, cuidados, vida social y alojamiento. Y por eso «Documentación,
// registros y protección de datos» es un proceso de soporte propio y no un
// trozo de calidad: es donde cuelga el riesgo de los datos confidenciales
// que la NC 01 nombra.
//
// La correspondencia con los dos mapas de hoy (8 procesos en indicadores,
// 4 en riesgos) la deja escrita el done del bloque, proceso por proceso.
//
// ── EL RESPONSABLE ES UN ROL, NO UNA PERSONA (D-29, D-50) ───────────
//
// `responsibleCareRoleCode` y no un `userId`: en una residencia el
// responsable de un proceso es «la DUE» o «calidad», y la persona que
// ocupa ese rol cambia en agosto. Lo resuelve el cargador contra los roles
// de serie del centro (`semilla.ts`), y si el centro no tiene ese rol
// activo cae a `DIRECCION` — que existe siempre, porque es quien tiene el
// tenant.

import type { ProcessType, RiskKind } from "@mipiacetpv/db";

/** Un proceso del mapa de referencia. */
export interface ProcesoDeReferencia {
  /** El código del proceso de REFERENCIA. Queda guardado en el proceso del
   *  centro (`reference_code`) para saber de dónde salió aunque lo
   *  renombren, y es lo que ata cada indicador del producto a su proceso
   *  (D-72). */
  code: string;
  name: string;
  type: ProcessType;
  /** Un rol de cuidado del centro, por código. Ver la cabecera. */
  responsibleCareRoleCode: string;
  /** Qué hace este proceso, en una línea. Es lo que la pantalla enseña
   *  debajo del nombre y lo que un auditor lee primero. */
  purpose: string;
  sortOrder: number;
}

/**
 * **EL MAPA.** Dos estratégicos, seis operativos, tres de soporte.
 *
 * El orden es el de un mapa de procesos de verdad: la fila de arriba son
 * los estratégicos, la de en medio la cadena de valor en el orden en que
 * un residente la recorre (entra → se le valora → se le atiende → se le
 * cuida → vive → come y duerme), y la de abajo los de soporte.
 */
export const PROCESOS_DE_REFERENCIA: ProcesoDeReferencia[] = [
  // ── ESTRATÉGICOS ──────────────────────────────────────────────────
  {
    code: "DIRECCION_PLANIFICACION",
    name: "Dirección y planificación",
    type: "STRATEGIC",
    responsibleCareRoleCode: "DIRECCION",
    purpose:
      "Política y objetivos del centro, revisión por la dirección, partes interesadas, proveedores y las obligaciones del calendario de dirección.",
    sortOrder: 10,
  },
  {
    code: "CALIDAD_MEJORA",
    name: "Calidad y mejora",
    type: "STRATEGIC",
    responsibleCareRoleCode: "CALIDAD",
    purpose:
      "Sistema de gestión, indicadores, no conformidades y acciones correctivas, auditorías internas, quejas y satisfacción.",
    sortOrder: 20,
  },
  // ── OPERATIVOS · la cadena de valor, en el orden del residente ─────
  {
    code: "ADMISION_INGRESO",
    name: "Admisión e ingreso",
    type: "OPERATIONAL",
    responsibleCareRoleCode: "ADMINISTRACION",
    purpose:
      "Información preliminar, lista de espera, contrato y expediente, plan de acogida y ocupación de plazas.",
    sortOrder: 30,
  },
  {
    code: "VALORACION_PAI",
    name: "Valoración y PAI",
    type: "OPERATIONAL",
    responsibleCareRoleCode: "TO",
    purpose:
      "Valoración interdisciplinar al ingreso y sus escalas, plan de atención individualizada, revisiones y auxiliar de referencia.",
    sortOrder: 40,
  },
  {
    code: "ATENCION_SANITARIA",
    name: "Atención sanitaria",
    type: "OPERATIONAL",
    responsibleCareRoleCode: "DUE",
    purpose:
      "Medicación, constantes, curas y úlceras por presión, visita médica, derivaciones y coordinación con el sistema de salud.",
    sortOrder: 50,
  },
  {
    code: "CUIDADOS_ABVD",
    name: "Cuidados y ABVD",
    type: "OPERATIONAL",
    responsibleCareRoleCode: "DUE",
    purpose:
      "Aseo, vestido, alimentación e hidratación, continencia, movilizaciones y cambios posturales, descanso y seguridad del residente.",
    sortOrder: 60,
  },
  {
    code: "VIDA_SOCIAL",
    name: "Vida social, animación y terapias",
    type: "OPERATIONAL",
    responsibleCareRoleCode: "TO",
    purpose:
      "Gimnasia de mantenimiento, estimulación cognitiva, fisioterapia, actividades socioculturales y participación en la comunidad.",
    sortOrder: 70,
  },
  {
    code: "ALOJAMIENTO_RESTAURACION",
    name: "Alojamiento y restauración",
    type: "OPERATIONAL",
    responsibleCareRoleCode: "COCINA",
    purpose:
      "Menús y dietas, cocina y APPCC, lavandería y ropa, limpieza de habitaciones y zonas comunes.",
    sortOrder: 80,
  },
  // ── SOPORTE ───────────────────────────────────────────────────────
  {
    code: "PERSONAS",
    name: "Personas",
    type: "SUPPORT",
    responsibleCareRoleCode: "DIRECCION",
    purpose:
      "Selección y contratación, cuadrantes y ratios, formación, prevención de riesgos laborales y rotación de la plantilla.",
    sortOrder: 90,
  },
  {
    code: "MANTENIMIENTO_INSTALACIONES",
    name: "Mantenimiento e instalaciones",
    type: "SUPPORT",
    responsibleCareRoleCode: "DIRECCION",
    purpose:
      "Averías, mantenimiento preventivo y reglamentario, certificados con vigencia, plan de autoprotección y ayudas técnicas.",
    sortOrder: 100,
  },
  {
    code: "DOCUMENTACION_DATOS",
    name: "Documentación, registros y protección de datos",
    type: "SUPPORT",
    responsibleCareRoleCode: "CALIDAD",
    purpose:
      "Control de la documentación del sistema, cumplimentación de los registros asistenciales, archivo y Plan de Protección de Datos.",
    sortOrder: 110,
  },
];

/** Un riesgo u oportunidad de serie, ya colgado de su proceso. */
export interface RiesgoDeReferencia {
  /** Código estable, para que cargar dos veces no lo duplique. */
  code: string;
  processCode: string;
  kind: RiskKind;
  description: string;
  /** 1-3 cada uno. El nivel es el producto, y las bandas están en
   *  `packages/residencia-plan/src/calidad.ts`. */
  probability: number;
  impact: number;
  plannedAction: string;
  /** La cláusula de la ISO 9001:2015 a la que se refiere (D-75). */
  isoClause: string;
  /** A cuántos meses se pone la primera revisión desde que se carga. */
  reviewInMonths: number;
}

/**
 * **LOS CUATRO RIESGOS QUE LA NC 01 NOMBRA UNO POR UNO.**
 *
 * «Siguen sin asociarse a proceso riesgos intrínsecos de una residencia:
 * errores en el tratamiento médico, intoxicaciones alimentarias, datos
 * confidenciales y salidas no controladas.» Vienen de serie y **ya
 * colgados de su proceso**, que es exactamente lo que faltaba.
 *
 * Las probabilidades y los impactos son el punto de partida del producto,
 * no un dictamen: el centro los ajusta en su pantalla. Lo que no es
 * negociable es que los cuatro existan y tengan proceso.
 *
 * El de los datos confidenciales lleva escrita la acción que la NC 01
 * reclama con nombre y apellidos —la evaluación periódica del Plan de
 * Protección de Datos, sin hacerse desde 2022— y esa evaluación es además
 * una obligación del calendario de residencia-5: aquí se nombra, allí se
 * cumple con fecha y responsable.
 */
export const RIESGOS_DE_REFERENCIA: RiesgoDeReferencia[] = [
  {
    code: "ERRORES_MEDICACION",
    processCode: "ATENCION_SANITARIA",
    kind: "RISK",
    description:
      "Error en el tratamiento médico: medicación no administrada, administrada a quien no le toca, con dosis o pauta equivocada, o administrada sin prescripción vigente.",
    probability: 2,
    impact: 3,
    plannedAction:
      "Prescripción y administración en el sistema con registro por residente y toma; doble comprobación en la preparación del casillero; revisión de la pauta en cada cambio de tratamiento.",
    isoClause: "6.1",
    reviewInMonths: 6,
  },
  {
    code: "INTOXICACION_ALIMENTARIA",
    processCode: "ALOJAMIENTO_RESTAURACION",
    kind: "RISK",
    description:
      "Intoxicación alimentaria por rotura de la cadena de frío, contaminación cruzada, materia prima en mal estado o error en una dieta de textura modificada.",
    probability: 1,
    impact: 3,
    plannedAction:
      "Registros APPCC con temperaturas de cámaras y de servicio, control de materias primas a la recepción, trazabilidad del menú servido y formación en manipulación de alimentos al día.",
    isoClause: "6.1",
    reviewInMonths: 6,
  },
  {
    code: "DATOS_CONFIDENCIALES",
    processCode: "DOCUMENTACION_DATOS",
    kind: "RISK",
    description:
      "Pérdida, acceso indebido o cesión no autorizada de datos de categoría especial (art. 9 RGPD) de residentes y de plantilla.",
    probability: 2,
    impact: 3,
    plannedAction:
      "Evaluación periódica del Plan de Protección de Datos como obligación del calendario de dirección, con responsable y fecha; acceso por rol y zona con registro de accesos; cifrado en reposo de identificadores y textos libres.",
    isoClause: "6.1",
    reviewInMonths: 6,
  },
  {
    code: "SALIDAS_NO_CONTROLADAS",
    processCode: "CUIDADOS_ABVD",
    kind: "RISK",
    description:
      "Salida del centro sin autorización ni acompañamiento de un residente con deterioro cognitivo, o residente no localizado dentro del centro.",
    probability: 2,
    impact: 3,
    plannedAction:
      "Control de accesos y registro de salidas con acompañante; identificación de los residentes con riesgo de fuga en el plan de cuidados; protocolo de búsqueda y aviso inmediato de nivel N4 al móvil de guardia.",
    isoClause: "6.1",
    reviewInMonths: 3,
  },
];

/** El proceso de referencia de un código, o `undefined`. */
export function procesoDeReferencia(
  code: string,
): ProcesoDeReferencia | undefined {
  return PROCESOS_DE_REFERENCIA.find((p) => p.code === code);
}
