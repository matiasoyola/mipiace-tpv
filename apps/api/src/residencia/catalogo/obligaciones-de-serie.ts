// residencia-5 (D-42, bloque C §3) · **LA PLANTILLA DE OBLIGACIONES.**
//
// El catálogo base del bloque C §3, fila por fila: cinco familias,
// veintiséis obligaciones. Es lo que Carmen lleva hoy en la cabeza.
//
// ── ES UNA PLANTILLA, NO UN CATÁLOGO DE SERIE ───────────────────────
//
// Y la diferencia con `controles-de-serie.ts` y con
// `plantilla-de-gravedad.ts` es la decisión del bloque: **las
// obligaciones son DEL CENTRO** (D-42: *«el catálogo inicial lo carga Mi
// Piace con Matías»*). No bajan a todos los centros al arrancar la API y
// no se versionan: el centro las **carga una vez** desde el admin y
// luego las ajusta. Las nóminas de un centro no son asunto de otro, y un
// cambio que el producto hiciera aquí no debe pisar lo que la dirección
// de Jardín de Gredos decidió en noviembre.
//
// Por eso esto no se llama desde `server.ts`: lo llama un botón.
//
// ── LO MARCADO *(verificar)* ENTRA CON LA MARCA PUESTA ──────────────
//
// El documento original es un borrador para tachar, y lo que lleva
// *(verificar)* es una periodicidad que alguien supuso en agosto y nadie
// ha confirmado. Entra igual —una obligación sin periodicidad confirmada
// **sigue tocando**— con `periodicityToVerify` en `true`, y el panel lo
// pinta. Lo contrario (no cargarlas) dejaría fuera la formación
// obligatoria y la facturación de plazas, que son las dos de consecuencia
// legal.
//
// ── LO QUE NO ENTRA, Y ESTÁ DECLARADO ───────────────────────────────
//
// Las disparadas por un HECHO (§4 del bloque C): el alta y baja en la
// Seguridad Social al contratar o cesar, y el Plan de Acciones
// Correctivas a los 30 días del informe de AENOR. Mismo motor, otra
// entrada, y llegan con historia-1 y calidad-1. La parte ANUAL de «la
// revisión del PAI de cada residente» sí entra; sus disparadores, no.
//
// ── MANTENIMIENTO NO ES UN ROL DE CUIDADO ───────────────────────────
//
// Cuatro obligaciones del §3.4 son «de Mantenimiento», y
// `semilla.ts` no siembra ese rol: en Jardín de Gredos el mantenimiento
// es un externo. Van con **etiqueta libre**, que es exactamente el caso
// que la tercera forma de responsable existe para cubrir — junto con
// «Gestoría» y «Mi Piace», que tampoco tienen usuario en el sistema.

import type {
  DutyConsequence,
  DutyFamily,
  DutyPeriodicity,
} from "@mipiacetpv/db";

/** Una fila de la plantilla, antes de entrar en la base. */
export interface ObligacionDePlantilla {
  name: string;
  family: DutyFamily;
  periodicity: DutyPeriodicity;
  weekday?: number;
  monthDay?: number;
  month?: number;
  anchorYear?: number;
  validUntil?: string;
  consequence: DutyConsequence;
  /** Un rol de cuidado del centro, por código. */
  responsibleCareRoleCode?: string;
  /** O una etiqueta libre, para quien no tiene rol en el sistema. */
  responsibleLabel?: string;
  /** Lo marcado *(verificar)* en el bloque C. */
  periodicityToVerify?: boolean;
  /** La nota del documento original: de dónde sale y qué falta. */
  notes?: string;
}

/**
 * **LA PLANTILLA.** El bloque C §3, en el orden del documento.
 *
 * Los días del mes son los que el cliente cero usa hoy donde el
 * documento los dice, y **el 1 cuando no los dice**: una obligación
 * mensual sin día no se puede generar, y el 1 es el día en que se mira
 * «lo que toca este mes». Todos se pueden cambiar desde el admin sin
 * tocar código, que es el punto de que esto sea dato.
 */
export const OBLIGACIONES_DE_PLANTILLA: ObligacionDePlantilla[] = [
  // ── 3.1 · PERSONAL ───────────────────────────────────────────────
  {
    name: "Cuadrante de turnos",
    family: "PERSONAL",
    periodicity: "MONTHLY",
    // El 25: el cuadrante del mes que viene se publica antes de acabar
    // éste. Si se hiciera el 1, la plantilla sabría su turno el mismo día.
    monthDay: 25,
    consequence: "INTERNO",
    responsibleCareRoleCode: "DIRECCION",
  },
  {
    name: "Nóminas",
    family: "PERSONAL",
    periodicity: "MONTHLY",
    monthDay: 25,
    consequence: "LEGAL",
    responsibleCareRoleCode: "ADMINISTRACION",
  },
  {
    name: "Registro diario de jornada",
    family: "PERSONAL",
    periodicity: "DAILY",
    consequence: "LEGAL",
    responsibleCareRoleCode: "DIRECCION",
    notes:
      "Obligación de todos; el responsable de que se cumpla es dirección. El fichaje existe en el sistema (TimeEntry).",
  },
  {
    name: "Vacaciones",
    family: "PERSONAL",
    periodicity: "ANNUAL",
    // En enero: el calendario de vacaciones del año se cierra al empezar.
    month: 1,
    monthDay: 31,
    consequence: "INTERNO",
    responsibleCareRoleCode: "DIRECCION",
  },
  {
    name: "Formación obligatoria (PRL, manipulador de alimentos, protección de datos)",
    family: "PERSONAL",
    // **Por vigencia**: lo que caduca es el certificado de cada persona.
    // La fecha entra vacía y la pone dirección con el certificado
    // delante; hasta entonces es anual por verificar.
    periodicity: "ANNUAL",
    month: 12,
    monthDay: 31,
    periodicityToVerify: true,
    consequence: "LEGAL",
    responsibleCareRoleCode: "DIRECCION",
    notes:
      "Según certificado (por verificar). Cuando se tenga la fecha de cada certificado, se desdobla en una obligación por vigencia por persona.",
  },

  // ── 3.2 · DINERO ─────────────────────────────────────────────────
  {
    name: "Liquidación de residentes (cuota y servicios extra)",
    family: "DINERO",
    periodicity: "MONTHLY",
    monthDay: 5,
    consequence: "INTERNO",
    responsibleCareRoleCode: "ADMINISTRACION",
  },
  {
    name: "Facturación de las plazas concertadas a la JCCM",
    family: "DINERO",
    periodicity: "MONTHLY",
    monthDay: 5,
    periodicityToVerify: true,
    consequence: "LEGAL",
    responsibleCareRoleCode: "ADMINISTRACION",
    notes: "Periodicidad por verificar. Las tablas de la JCCM están en la carpeta operativa (H-02).",
  },
  {
    name: "Pago a proveedores",
    family: "DINERO",
    periodicity: "MONTHLY",
    monthDay: 10,
    consequence: "INTERNO",
    responsibleCareRoleCode: "ADMINISTRACION",
  },
  {
    name: "Obligaciones fiscales trimestrales",
    family: "DINERO",
    periodicity: "QUARTERLY",
    // Enero, abril, julio y octubre: los trimestres fiscales.
    month: 1,
    monthDay: 20,
    consequence: "LEGAL",
    responsibleLabel: "Gestoría",
  },
  {
    name: "Obligaciones fiscales anuales",
    family: "DINERO",
    periodicity: "ANNUAL",
    month: 1,
    monthDay: 30,
    consequence: "LEGAL",
    responsibleLabel: "Gestoría",
    notes:
      "El bloque C las agrupa con las trimestrales («trimestral / anual»). Son dos filas porque son dos fechas y se marcan hechas por separado.",
  },

  // ── 3.3 · COMPRAS ────────────────────────────────────────────────
  {
    name: "Pedido de alimentación",
    family: "COMPRAS",
    periodicity: "WEEKLY",
    weekday: 1,
    periodicityToVerify: true,
    consequence: "INTERNO",
    responsibleCareRoleCode: "COCINA",
    notes: "Periodicidad por verificar.",
  },
  {
    name: "Pedido de farmacia / SPD",
    family: "COMPRAS",
    periodicity: "WEEKLY",
    weekday: 4,
    consequence: "INTERNO",
    responsibleCareRoleCode: "DUE",
  },
  {
    name: "Material sanitario y lencería",
    family: "COMPRAS",
    periodicity: "MONTHLY",
    monthDay: 1,
    periodicityToVerify: true,
    consequence: "INTERNO",
    responsibleCareRoleCode: "DIRECCION",
    notes: "Periodicidad por verificar.",
  },
  {
    name: "Evaluación de proveedores",
    family: "COMPRAS",
    periodicity: "ANNUAL",
    month: 11,
    monthDay: 30,
    consequence: "ISO",
    responsibleCareRoleCode: "CALIDAD",
  },

  // ── 3.4 · CUMPLIMIENTO ───────────────────────────────────────────
  {
    name: "Informe trimestral de extintores",
    family: "CUMPLIMIENTO",
    periodicity: "QUARTERLY",
    month: 3,
    monthDay: 15,
    consequence: "LEGAL",
    responsibleLabel: "Mantenimiento",
    notes: "Defecto leve de CERQUO en la auditoría.",
  },
  {
    name: "Certificado anual del mantenedor de PCI",
    family: "CUMPLIMIENTO",
    periodicity: "ANNUAL",
    month: 12,
    monthDay: 31,
    consequence: "LEGAL",
    responsibleLabel: "Mantenimiento",
    notes: "FALTA EL DE 2026 (observación 02 de AENOR).",
  },
  {
    name: "Inspección OCA de baja tensión",
    family: "CUMPLIMIENTO",
    periodicity: "FIVE_YEARLY",
    month: 11,
    monthDay: 5,
    // Vigente hasta el 05-11-2029 → la anterior fue en 2024.
    anchorYear: 2024,
    consequence: "LEGAL",
    responsibleLabel: "Mantenimiento",
    notes: "Vigente hasta el 05-11-2029.",
  },
  {
    name: "Analíticas de legionela y registro de terminales revisados",
    family: "CUMPLIMIENTO",
    periodicity: "MONTHLY",
    monthDay: 1,
    periodicityToVerify: true,
    consequence: "LEGAL",
    responsibleLabel: "Mantenimiento",
    notes:
      "«Según programa» en el bloque C: la periodicidad sale del programa de mantenimiento del centro y está por verificar. Inspección de Sanidad de 2024.",
  },
  {
    name: "Verificación metrológica del termómetro",
    family: "CUMPLIMIENTO",
    periodicity: "ANNUAL",
    month: 6,
    monthDay: 30,
    periodicityToVerify: true,
    consequence: "ISO",
    responsibleCareRoleCode: "CALIDAD",
    notes: "No conformidad 03 de 2025. Periodicidad por verificar.",
  },
  {
    name: "Registros APPCC diarios",
    family: "CUMPLIMIENTO",
    periodicity: "DAILY",
    consequence: "LEGAL",
    responsibleCareRoleCode: "COCINA",
    notes: "Dos inspecciones en 2025.",
  },
  {
    name: "Plan de contingencias",
    family: "CUMPLIMIENTO",
    periodicity: "ANNUAL",
    month: 9,
    monthDay: 30,
    periodicityToVerify: true,
    consequence: "LEGAL",
    responsibleCareRoleCode: "DIRECCION",
    notes: "Acta de la JCCM de 2024. Periodicidad por verificar.",
  },
  {
    name: "Declaraciones periódicas a la Consejería",
    family: "CUMPLIMIENTO",
    periodicity: "ANNUAL",
    month: 1,
    monthDay: 31,
    periodicityToVerify: true,
    consequence: "LEGAL",
    responsibleCareRoleCode: "DIRECCION",
    notes:
      "PERIODICIDAD POR DETERMINAR (H-02): entra como anual para que no se olvide, con la marca puesta.",
  },

  // ── 3.5 · CALIDAD ────────────────────────────────────────────────
  {
    name: "Seguimiento de los 23 indicadores",
    family: "CALIDAD",
    periodicity: "MONTHLY",
    monthDay: 5,
    consequence: "ISO",
    responsibleCareRoleCode: "CALIDAD",
    notes:
      "Seis de los 23 los calcula el panel desde residencia-5; los demás esperan a sus bloques.",
  },
  {
    name: "Encuestas de satisfacción (entregadas y recibidas)",
    family: "CALIDAD",
    periodicity: "ANNUAL",
    month: 5,
    monthDay: 31,
    consequence: "ISO",
    responsibleCareRoleCode: "CALIDAD",
    notes: "Observación 05 de AENOR. La pasa calidad con la TO.",
  },
  {
    name: "Revisión por la dirección",
    family: "CALIDAD",
    periodicity: "ANNUAL",
    month: 6,
    monthDay: 30,
    consequence: "ISO",
    responsibleCareRoleCode: "DIRECCION",
  },
  {
    name: "Auditoría interna",
    family: "CALIDAD",
    periodicity: "ANNUAL",
    month: 5,
    monthDay: 31,
    consequence: "ISO",
    responsibleCareRoleCode: "CALIDAD",
  },
  {
    name: "Revisión de protocolos y procedimientos",
    family: "CALIDAD",
    periodicity: "ANNUAL",
    month: 4,
    monthDay: 30,
    consequence: "ISO",
    responsibleCareRoleCode: "CALIDAD",
  },
  {
    name: "Revisión anual del PAI de cada residente",
    family: "CALIDAD",
    periodicity: "ANNUAL",
    month: 3,
    monthDay: 31,
    consequence: "ISO",
    responsibleLabel: "Equipo interdisciplinar",
    notes:
      "La parte ANUAL. Los disparadores (ingreso hospitalario, cambio de grado) son obligaciones por hecho y llegan con historia-1.",
  },
  {
    name: "Evaluación del Plan de Protección de Datos",
    family: "CALIDAD",
    periodicity: "ANNUAL",
    month: 2,
    monthDay: 28,
    periodicityToVerify: true,
    consequence: "LEGAL",
    responsibleLabel: "Mi Piace",
    notes: "INCUMPLIDA DESDE 2022. Periodicidad por definir.",
  },
  {
    name: "Preparación de la auditoría de certificación",
    family: "CALIDAD",
    periodicity: "ANNUAL",
    // La próxima es el 20-07-2027: la preparación arranca dos meses
    // antes, que es lo que el documento quiere decir con «anual».
    month: 5,
    monthDay: 20,
    consequence: "ISO",
    responsibleCareRoleCode: "DIRECCION",
    notes: "Próxima auditoría de certificación: 20-07-2027.",
  },
];

/**
 * Comprueba la plantilla ANTES de escribirla, igual que
 * `problemasDelCatalogo` y `problemasDeLaPlantilla`.
 *
 * Un fichero de datos que alguien edita a mano y que se carga a medias
 * deja al centro con la mitad de sus obligaciones, y eso no se nota hasta
 * que falta un certificado en una inspección.
 */
export function problemasDeLasObligaciones(
  filas: ObligacionDePlantilla[] = OBLIGACIONES_DE_PLANTILLA,
): string[] {
  const problemas: string[] = [];
  const vistos = new Set<string>();
  for (const o of filas) {
    if (vistos.has(o.name)) problemas.push(`obligación repetida: «${o.name}»`);
    vistos.add(o.name);

    const responsables = [
      o.responsibleCareRoleCode,
      o.responsibleLabel,
    ].filter((x) => x != null).length;
    if (responsables !== 1) {
      problemas.push(`«${o.name}» tiene ${responsables} responsables y tiene que tener uno`);
    }

    // Las mismas reglas que el CHECK `management_duties_periodicidad_coherente`,
    // comprobadas aquí para que el fallo salga al cargar la plantilla y
    // no como un 500 del motor.
    const exige = (campo: string, valor: number | string | undefined): void => {
      if (valor == null) problemas.push(`«${o.name}» es ${o.periodicity} y le falta ${campo}`);
    };
    const prohibe = (campo: string, valor: number | string | undefined): void => {
      if (valor != null) problemas.push(`«${o.name}» es ${o.periodicity} y no puede llevar ${campo}`);
    };
    switch (o.periodicity) {
      case "DAILY":
        prohibe("weekday", o.weekday);
        prohibe("monthDay", o.monthDay);
        prohibe("month", o.month);
        break;
      case "WEEKLY":
        exige("weekday", o.weekday);
        prohibe("monthDay", o.monthDay);
        break;
      case "MONTHLY":
        exige("monthDay", o.monthDay);
        prohibe("month", o.month);
        break;
      case "QUARTERLY":
        exige("monthDay", o.monthDay);
        exige("month", o.month);
        if (o.month != null && (o.month < 1 || o.month > 3)) {
          problemas.push(`«${o.name}» es trimestral y su mes de anclaje tiene que ser 1, 2 o 3`);
        }
        break;
      case "ANNUAL":
        exige("monthDay", o.monthDay);
        exige("month", o.month);
        prohibe("anchorYear", o.anchorYear);
        break;
      case "FIVE_YEARLY":
        exige("monthDay", o.monthDay);
        exige("month", o.month);
        exige("anchorYear", o.anchorYear);
        break;
      case "VALIDITY":
        exige("validUntil", o.validUntil);
        prohibe("monthDay", o.monthDay);
        break;
    }
    if (o.monthDay != null && (o.monthDay < 1 || o.monthDay > 31)) {
      problemas.push(`«${o.name}» tiene un día del mes imposible (${o.monthDay})`);
    }
  }
  return problemas;
}
