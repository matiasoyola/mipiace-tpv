// residencia-5 (D-42) · **LAS OBLIGACIONES DE DIRECCIÓN, POR DENTRO.**
//
// Cargar la plantilla del bloque C, generar las ocurrencias que tocan y
// marcarlas hechas con firma. La aritmética del calendario no está aquí:
// está en `packages/residencia-plan/src/obligaciones.ts`, pura y con su
// tabla de verdad (el fin de mes, el 29 de febrero, los trimestres que
// cruzan el año). Aquí está lo que toca la base.
//
// ── POR QUÉ LAS OCURRENCIAS SE MATERIALIZAN ─────────────────────────
//
// Se podrían calcular al vuelo en cada carga del panel, como el «no
// hecho». No se hace, y la razón es que **la ocurrencia tiene estado**:
// se marca hecha, con quién, cuándo y con qué evidencia adjunta. Un
// cálculo no puede guardar un PDF.
//
// La consecuencia es que hay una pasada que las genera, y que tiene que
// ser **idempotente**: lo es por el índice único `(duty_id, due_on)`, no
// por un `if`.
//
// ── CON VENTANA POR DELANTE ─────────────────────────────────────────
//
// Se generan hasta 90 días por delante, y no es un número redondo
// cualquiera: el panel enseña «lo que vence en 60 días» (bloque C §2), y
// para eso las ocurrencias tienen que existir **antes** de vencer. Con 60
// justos, una pasada que fallara un día dejaría el aviso de los 60 días
// sin la ocurrencia que lo provoca.

import type { PrismaClient } from "@mipiacetpv/db";
import {
  DIAS_DE_PREAVISO,
  addDays,
  diasHasta,
  ocurrenciasDeObligacion,
  utcToWallDate,
  type ObligacionParaGenerar,
} from "@mipiacetpv/residencia-plan";

import {
  OBLIGACIONES_DE_PLANTILLA,
  problemasDeLasObligaciones,
} from "./catalogo/obligaciones-de-serie.js";

/** Cuántos días por delante se generan. Ver la cabecera. */
export const DIAS_POR_DELANTE = 90;

/** Y cuántos hacia atrás, al cargar la plantilla o al crear una
 *  obligación: lo justo para que el panel pueda enseñar lo vencido del
 *  mes en curso sin inventarse un año de historia que nadie hizo. */
export const DIAS_HACIA_ATRAS = 31;

export class ObligacionInvalida extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ObligacionInvalida";
  }
}

/**
 * **Carga la plantilla del bloque C en un centro.** Idempotente por
 * nombre: una obligación que ya está no se duplica ni se pisa.
 *
 * Que no se PISE es la decisión: si la dirección cambió el día de las
 * nóminas del 25 al 28, volver a pulsar «cargar la plantilla» no se lo
 * devuelve al 25. Lo contrario convertiría el botón en una trampa — y es
 * un botón que alguien va a pulsar dos veces por si acaso.
 */
export async function cargarPlantillaDeObligaciones(
  prisma: PrismaClient,
  input: { tenantId: string; userId: string; ahora: Date },
): Promise<{ creadas: number; yaEstaban: number; problemas: string[] }> {
  const problemas = problemasDeLasObligaciones();
  if (problemas.length > 0) {
    // El fichero de datos está mal: no se carga nada. A medias sería
    // dejar al centro con la mitad de sus obligaciones, que es peor que
    // ninguna porque parece completo.
    return { creadas: 0, yaEstaban: 0, problemas };
  }

  const [roles, yaExisten] = await Promise.all([
    prisma.careRole.findMany({
      where: { tenantId: input.tenantId },
      select: { id: true, code: true },
    }),
    prisma.managementDuty.findMany({
      where: { tenantId: input.tenantId },
      select: { name: true },
    }),
  ]);
  const rolPorCodigo = new Map(roles.map((r) => [r.code, r.id]));
  const nombres = new Set(yaExisten.map((d) => d.name));

  const hoy = utcToWallDate(input.ahora);
  let creadas = 0;
  let yaEstaban = 0;

  for (const o of OBLIGACIONES_DE_PLANTILLA) {
    if (nombres.has(o.name)) {
      yaEstaban += 1;
      continue;
    }
    // El rol responsable, si el centro lo tiene. Si NO lo tiene —un
    // centro sin rol de administración, por ejemplo— cae a etiqueta
    // libre con el código dentro en vez de saltarse la obligación: una
    // obligación legal que no se carga porque falta un rol es una
    // obligación que nadie va a echar en falta.
    const rolId =
      o.responsibleCareRoleCode == null
        ? null
        : (rolPorCodigo.get(o.responsibleCareRoleCode) ?? null);
    const etiqueta =
      o.responsibleLabel ??
      (rolId == null && o.responsibleCareRoleCode != null
        ? nombreDeRolSinSembrar(o.responsibleCareRoleCode)
        : null);

    const duty = await prisma.managementDuty.create({
      data: {
        tenantId: input.tenantId,
        name: o.name,
        family: o.family,
        notes: o.notes ?? null,
        periodicity: o.periodicity,
        weekday: o.weekday ?? null,
        monthDay: o.monthDay ?? null,
        month: o.month ?? null,
        anchorYear: o.anchorYear ?? null,
        validUntil: o.validUntil ?? null,
        periodicityToVerify: o.periodicityToVerify === true,
        consequence: o.consequence,
        responsibleCareRoleId: etiqueta == null ? rolId : null,
        responsibleUserId: null,
        responsibleLabel: etiqueta,
        // **Desde hoy, no desde el principio de los tiempos.** Cargar la
        // plantilla en octubre no inventa las nóminas de enero.
        startsOn: hoy,
      },
      select: { id: true },
    });
    creadas += 1;
    await generarOcurrenciasDe(prisma, {
      tenantId: input.tenantId,
      dutyId: duty.id,
      ahora: input.ahora,
    });
  }

  return { creadas, yaEstaban, problemas: [] };
}

/** Cómo se escribe un rol que el centro no tiene sembrado. */
function nombreDeRolSinSembrar(code: string): string {
  const bonito: Record<string, string> = {
    DIRECCION: "Dirección",
    ADMINISTRACION: "Administración",
    CALIDAD: "Calidad",
    COCINA: "Cocina",
    DUE: "Enfermería",
  };
  return bonito[code] ?? code;
}

/**
 * **Genera las ocurrencias de UNA obligación** en la ventana
 * `[hoy - 31, hoy + 90]`.
 *
 * Idempotente: `createMany` con `skipDuplicates`, que se apoya en el
 * índice único `(duty_id, due_on)`. Correrla dos veces no crea dos
 * nóminas del 25.
 */
export async function generarOcurrenciasDe(
  prisma: PrismaClient,
  input: { tenantId: string; dutyId: string; ahora: Date },
): Promise<{ creadas: number }> {
  const duty = await prisma.managementDuty.findFirst({
    where: { id: input.dutyId, tenantId: input.tenantId },
    select: {
      id: true,
      active: true,
      periodicity: true,
      weekday: true,
      monthDay: true,
      month: true,
      anchorYear: true,
      validUntil: true,
      startsOn: true,
    },
  });
  // Una obligación retirada **no genera más**, y las que ya tiene se
  // quedan: lo hecho se conserva (`active = false` no borra nada).
  if (duty == null || !duty.active) return { creadas: 0 };

  const hoy = utcToWallDate(input.ahora);
  const fechas = ocurrenciasDeObligacion(
    duty as ObligacionParaGenerar,
    addDays(hoy, -DIAS_HACIA_ATRAS),
    addDays(hoy, DIAS_POR_DELANTE),
  );
  if (fechas.length === 0) return { creadas: 0 };

  const { count } = await prisma.dutyOccurrence.createMany({
    data: fechas.map((dueOn) => ({
      tenantId: input.tenantId,
      dutyId: duty.id,
      dueOn,
    })),
    skipDuplicates: true,
  });
  return { creadas: count };
}

/**
 * **La pasada programada.** Genera las ocurrencias de todas las
 * obligaciones vivas de un centro.
 *
 * `ahora` entra por parámetro —no se lee el reloj aquí— para que el e2e
 * la pueda correr con reloj falso y sin Redis, exactamente igual que
 * `pasadaDeAusencias` de residencia-4. Es también la razón de que la
 * lógica viva aquí y no dentro del worker.
 */
export async function pasadaDeObligaciones(
  prisma: PrismaClient,
  input: { tenantId: string; ahora: Date },
): Promise<{ obligaciones: number; creadas: number }> {
  const duties = await prisma.managementDuty.findMany({
    where: { tenantId: input.tenantId, active: true },
    select: { id: true },
  });
  let creadas = 0;
  for (const d of duties) {
    const r = await generarOcurrenciasDe(prisma, {
      tenantId: input.tenantId,
      dutyId: d.id,
      ahora: input.ahora,
    });
    creadas += r.creadas;
  }
  return { obligaciones: duties.length, creadas };
}

// ── MARCAR HECHA, CON FIRMA (D-31) ───────────────────────────────────

/** Quién marca y con qué capacidad. */
export interface FirmaDeObligacion {
  userId: string;
  careRoleAssignmentId: string;
}

/**
 * Marca una ocurrencia como hecha.
 *
 * ── QUIÉN PUEDE, Y POR QUÉ NO ES «EL RESPONSABLE» ──────────────────
 *
 * Cualquier rol de cuidado de **categoría directiva**, igual que el
 * cierre de una incidencia (D-27). **No** se exige que sea el
 * responsable de la obligación, y es una decisión: el responsable de las
 * nóminas es administración, pero la que está un martes de agosto es la
 * dirección, y una obligación legal que no se puede marcar porque la
 * persona que figura está de vacaciones es una obligación que se queda
 * sin marcar. Quién la marcó queda firmado, que es lo que la evidencia
 * necesita.
 */
export async function marcarHecha(
  prisma: PrismaClient,
  input: {
    tenantId: string;
    occurrenceId: string;
    firma: FirmaDeObligacion;
    nota?: string | null;
    ahora: Date;
  },
): Promise<{ occurrenceId: string; doneAt: Date }> {
  const ocurrencia = await prisma.dutyOccurrence.findFirst({
    where: { id: input.occurrenceId, tenantId: input.tenantId },
    select: { id: true, doneAt: true },
  });
  if (ocurrencia == null) {
    throw new ObligacionInvalida("OCURRENCIA_NO_ENCONTRADA", "Esa obligación no existe en este centro.");
  }
  if (ocurrencia.doneAt != null) {
    // Ya estaba hecha: se contesta la que había, igual que una
    // confirmación de relevo repetida. Marcar dos veces no es un error
    // del usuario, es que alguien dio dos veces al botón.
    return { occurrenceId: ocurrencia.id, doneAt: ocurrencia.doneAt };
  }

  const capacidad = await capacidadDirectiva(prisma, input.tenantId, input.firma, input.ahora);

  const hecha = await prisma.dutyOccurrence.update({
    where: { id: input.occurrenceId },
    data: {
      doneAt: input.ahora,
      doneByUserId: input.firma.userId,
      doneByCareRoleAssignmentId: capacidad,
      doneNote: input.nota?.trim() ? input.nota.trim() : null,
    },
    select: { id: true, doneAt: true },
  });
  return { occurrenceId: hecha.id, doneAt: hecha.doneAt! };
}

/**
 * **Deshace una ocurrencia hecha, con corrección firmada.**
 *
 * Es la única forma de que una hecha vuelva a pendiente, y el trigger
 * `duty_occurrences_hecha_no_vuelve` lo clava en el motor: sin las tres
 * columnas de corrección, el `UPDATE` no entra.
 *
 * ── LA EVIDENCIA ADJUNTA SE DESENGANCHA, Y EL FICHERO SE QUEDA ─────
 *
 * El CHECK `duty_occurrences_evidencia_exige_hecha` dice que una
 * evidencia sólo cuelga de algo hecho, así que al volver a pendiente hay
 * que soltarla: las cuatro columnas se ponen a NULL en la misma
 * sentencia.
 *
 * **El fichero del volumen NO se borra.** Que alguien subió ese PDF es un
 * hecho, y lo que la corrección dice es que no correspondía a esta
 * ocurrencia — no que el documento no exista. Queda huérfano en el
 * volumen, y eso está en las dudas abiertas del done: la alternativa
 * (borrarlo) sería destruir el certificado de extintores porque alguien
 * lo adjuntó en la fila de al lado.
 */
export async function corregirHecha(
  prisma: PrismaClient,
  input: {
    tenantId: string;
    occurrenceId: string;
    firma: FirmaDeObligacion;
    motivo: string;
    ahora: Date;
  },
): Promise<{ occurrenceId: string }> {
  const motivo = input.motivo.trim();
  if (motivo.length === 0) {
    throw new ObligacionInvalida(
      "CORRECCION_SIN_MOTIVO",
      "Para deshacer una obligación marcada hace falta decir por qué.",
    );
  }
  const ocurrencia = await prisma.dutyOccurrence.findFirst({
    where: { id: input.occurrenceId, tenantId: input.tenantId },
    select: { id: true, doneAt: true },
  });
  if (ocurrencia == null) {
    throw new ObligacionInvalida("OCURRENCIA_NO_ENCONTRADA", "Esa obligación no existe en este centro.");
  }
  if (ocurrencia.doneAt == null) {
    throw new ObligacionInvalida(
      "NO_ESTABA_HECHA",
      "Esa obligación no estaba marcada como hecha.",
    );
  }
  await capacidadDirectiva(prisma, input.tenantId, input.firma, input.ahora);

  await prisma.dutyOccurrence.update({
    where: { id: input.occurrenceId },
    data: {
      doneAt: null,
      doneByUserId: null,
      doneByCareRoleAssignmentId: null,
      doneNote: null,
      evidenceFileName: null,
      evidenceSha256: null,
      evidenceBytes: null,
      evidenceMimeType: null,
      correctedAt: input.ahora,
      correctedByUserId: input.firma.userId,
      correctionReason: motivo,
    },
  });
  return { occurrenceId: input.occurrenceId };
}

/**
 * Comprueba que la firma es de un rol de **categoría directiva** vigente
 * y devuelve el id de la asignación.
 *
 * Vigente **en el instante en que se firma**, no «alguna vez»: es la
 * misma comprobación que `cerrarIncidencia` de residencia-4.
 */
async function capacidadDirectiva(
  prisma: PrismaClient,
  tenantId: string,
  firma: FirmaDeObligacion,
  ahora: Date,
): Promise<string> {
  const asignacion = await prisma.careRoleAssignment.findFirst({
    where: {
      id: firma.careRoleAssignmentId,
      tenantId,
      userId: firma.userId,
      revokedAt: null,
    },
    select: {
      id: true,
      fromAt: true,
      toAt: true,
      careRole: { select: { category: true, active: true, name: true } },
    },
  });
  if (
    asignacion == null ||
    !asignacion.careRole.active ||
    asignacion.fromAt > ahora ||
    (asignacion.toAt != null && asignacion.toAt <= ahora)
  ) {
    throw new ObligacionInvalida(
      "SIN_CAPACIDAD_VIGENTE",
      "Ese rol de cuidado no está vigente. Vuelve a entrar.",
    );
  }
  if (asignacion.careRole.category !== "DIRECTIVO") {
    throw new ObligacionInvalida(
      "NO_ES_DIRECTIVO",
      `Las obligaciones de dirección las marca un rol de dirección, y «${asignacion.careRole.name}» no lo es.`,
    );
  }
  return asignacion.id;
}

// ── LO QUE EL PANEL PREGUNTA ─────────────────────────────────────────

/** Una ocurrencia, como se pinta. */
export interface OcurrenciaPintada {
  id: string;
  dutyId: string;
  nombre: string;
  family: string;
  consequence: string;
  dueOn: string;
  /** Negativo = vencida. */
  diasRestantes: number;
  vencida: boolean;
  hecha: boolean;
  hechaEn: string | null;
  hechaPor: string | null;
  tieneEvidencia: boolean;
  periodicityToVerify: boolean;
  responsable: string;
}

/**
 * «¿Qué toca hoy, qué está vencido y qué vence en 60 días?» — la tercera
 * fila del panel y dos de las cuatro consultas de dirección del bloque C
 * §2, en una sola llamada.
 *
 * Una y no tres porque las tres miran la misma tabla con la misma
 * ventana, y tres consultas serían tres idas a la base por carga del
 * panel con el presupuesto de lectura encima (≤ 10 s, ≤ 3 toques).
 */
export async function obligacionesDelPanel(
  prisma: PrismaClient,
  input: { tenantId: string; ahora: Date },
): Promise<{
  hoy: OcurrenciaPintada[];
  vencidas: OcurrenciaPintada[];
  proximas: OcurrenciaPintada[];
}> {
  const hoy = utcToWallDate(input.ahora);
  const filas = await prisma.dutyOccurrence.findMany({
    where: {
      tenantId: input.tenantId,
      dueOn: { gte: addDays(hoy, -365), lte: addDays(hoy, DIAS_DE_PREAVISO) },
      duty: { active: true },
    },
    orderBy: { dueOn: "asc" },
    select: {
      id: true,
      dutyId: true,
      dueOn: true,
      doneAt: true,
      evidenceFileName: true,
      doneBy: { select: { alias: true, email: true } },
      duty: {
        select: {
          name: true,
          family: true,
          consequence: true,
          periodicityToVerify: true,
          responsibleLabel: true,
          responsibleCareRole: { select: { name: true } },
          responsibleUser: { select: { alias: true, email: true } },
        },
      },
    },
  });

  const pintar = (f: (typeof filas)[number]): OcurrenciaPintada => ({
    id: f.id,
    dutyId: f.dutyId,
    nombre: f.duty.name,
    family: f.duty.family,
    consequence: f.duty.consequence,
    dueOn: f.dueOn,
    diasRestantes: diasHasta(hoy, f.dueOn),
    vencida: f.doneAt == null && diasHasta(hoy, f.dueOn) < 0,
    hecha: f.doneAt != null,
    hechaEn: f.doneAt?.toISOString() ?? null,
    hechaPor: f.doneBy == null ? null : (f.doneBy.alias ?? f.doneBy.email.split("@")[0]!),
    tieneEvidencia: f.evidenceFileName != null,
    periodicityToVerify: f.duty.periodicityToVerify,
    responsable:
      f.duty.responsibleLabel ??
      f.duty.responsibleCareRole?.name ??
      (f.duty.responsibleUser == null
        ? "—"
        : (f.duty.responsibleUser.alias ??
          f.duty.responsibleUser.email.split("@")[0]!)),
  });

  const pintadas = filas.map(pintar);
  // El orden de lo vencido: **por consecuencia y después por antigüedad**.
  // Lo legal vencido va arriba, que es lo que la dirección tiene que ver
  // primero (un informe de extintores de hace tres meses antes que un
  // pedido de lencería de ayer).
  const peso: Record<string, number> = { LEGAL: 0, ISO: 1, INTERNO: 2 };
  return {
    hoy: pintadas.filter((o) => o.dueOn === hoy && !o.hecha),
    vencidas: pintadas
      .filter((o) => o.vencida)
      .sort(
        (a, b) =>
          (peso[a.consequence] ?? 9) - (peso[b.consequence] ?? 9) ||
          a.dueOn.localeCompare(b.dueOn),
      ),
    proximas: pintadas.filter(
      (o) => !o.hecha && o.diasRestantes > 0 && o.diasRestantes <= DIAS_DE_PREAVISO,
    ),
  };
}
