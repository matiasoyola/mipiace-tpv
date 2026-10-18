// residencia-4 (D-35, D-38) · **EL LIBRO, FUERA DE LAS RUTAS.**
//
// Abrir, adjuntar, subir de nivel, actuar, comunicar a la familia y
// cerrar. Las rutas sólo traducen HTTP; quien sabe qué significa cada
// cosa es este fichero, y lo llaman tres puertas distintas (la de la
// habitación, la del admin y las dos pasadas programadas).
//
// ── LA INVARIANTE DE ESTE FICHERO ───────────────────────────────────
//
// **Tres tomas de fiebre en un turno son UNA incidencia.** De ahí salen
// las tres decisiones que de otra forma parecerían arbitrarias:
//
//   · lo que deduplica es `(residente, tipo de incidencia, abierta)`, y
//     no el control ni la medida. `TEMPERATURA` es lo que se mide,
//     `FIEBRE` es lo que pasa;
//   · la segunda medida **se adjunta como evidencia** a la que ya está,
//     con su propia línea en la cronología. No se pierde y no abre nada;
//   · y si la segunda es más grave, **sube el nivel de la que ya está** y
//     avisa por el nivel nuevo. Lo que no hace es avisar otra vez por el
//     mismo nivel: eso es un móvil que suena tres veces por lo mismo.
//
// Y la mitad que no es obvia: **se deduplica contra lo ABIERTO**. Una
// fiebre que vuelve dos días después, con la de antes cerrada, es otra
// fiebre y abre su propia incidencia. Eso es correcto y es lo que el
// trigger `incidents_inmutable` fuerza al no dejar reabrir nada.

import type { Prisma, PrismaClient } from "@mipiacetpv/db";
import { masGrave, type CanalDeGuardia, type Nivel } from "@mipiacetpv/residencia-plan";

import { asegurarDek } from "../clinica/claves.js";
import {
  cifrarTexto,
  nuevoIdDeFila,
  sitioContenidoAFamilia,
  sitioDescripcionDeIncidencia,
  sitioMotivoDeExcepcion,
  sitioRespuestaDeFamilia,
  sitioTextoDeAccion,
} from "../clinica/cripto-campos.js";
import {
  avisar,
  cancelarAvisos,
  configuracionDeGuardia,
  type AvisoCreado,
} from "./aviso.js";

export class IncidenciaInvalida extends Error {
  constructor(
    readonly codigo: string,
    mensaje: string,
  ) {
    super(mensaje);
  }
}

/** La firma de todo lo que se escribe aquí: persona + capacidad (D-31). */
export interface Firma {
  userId: string;
  careRoleAssignmentId: string;
}

/** Lo que hace falta para declarar o derivar una incidencia. */
export interface DeclaracionDeIncidencia {
  tenantId: string;
  subject: "RESIDENT" | "COMPLAINT" | "MAINTENANCE";
  clientId: string | null;
  origin: "DECLARED" | "DERIVED_THRESHOLD" | "DERIVED_ABSENCE";
  /** El CÓDIGO del tipo (`FIEBRE`, `CAIDA`…). */
  tipo: string;
  nivel: Nivel;
  templateVersion: number | null;
  /** Qué ha pasado, en claro. Se cifra aquí. Opcional. */
  descripcion?: string | null;
  sourceRecordId?: string | null;
  deviceId?: string | null;
  roomId?: string | null;
  centerShiftId?: string | null;
  careDay: string;
  /** Cuándo OCURRIÓ (el reloj de la tablet), no cuándo llegó. */
  occurridoEn: Date;
  /** Y cuándo lo apuntó la tablet, para el aviso. Normalmente el mismo. */
  queuedAt?: Date;
  firma: Firma;
  ahora: Date;
}

export interface ResultadoDeDeclaracion {
  incidentId: string;
  /** `true` si se abrió una incidencia nueva; `false` si se adjuntó a una
   *  que ya estaba abierta. */
  creada: boolean;
  /** El nivel de la incidencia DESPUÉS de esto. Puede ser mayor que el
   *  `nivel` que entró, si la que ya estaba era más grave. */
  nivel: Nivel;
  /** `true` cuando esta medida subió el nivel de una incidencia abierta. */
  subioNivel: boolean;
  avisos: AvisoCreado[];
}

/**
 * **DECLARA O ADJUNTA.** El corazón del bloque.
 *
 * Devuelve siempre un `incidentId`, haya abierto una o haya adjuntado a
 * la que estaba. Quien llama no tiene que saber cuál de las dos pasó —
 * salvo para pintarlo, que es para lo que están `creada` y `subioNivel`.
 *
 * ── N0 NO ABRE NADA (D-27) ─────────────────────────────────────────
 *
 * Y «no abre nada» no es «no se escribe»: se escribe la fila **ya
 * cerrada**, con su hora y su autor. Es constancia —una avería sin
 * riesgo— y tiene que estar en el libro para que el de mantenimiento la
 * vea; lo que no tiene que estar es en la lista de abiertas, pidiéndole a
 * alguien que la cierre.
 */
export async function declararIncidencia(
  prisma: PrismaClient,
  input: DeclaracionDeIncidencia,
): Promise<ResultadoDeDeclaracion> {
  const queuedAt = input.queuedAt ?? input.occurridoEn;

  // ── 1 · ¿Hay ya una abierta de lo mismo? ─────────────────────────
  //
  // Sólo se deduplica cuando hay residente: una avería del ascensor y
  // otra de la lavadora son dos averías aunque las dos sean `AVERIA`, y
  // agruparlas por tipo dejaría la segunda escondida dentro de la
  // primera. Con residente, en cambio, el tipo ES la cosa que pasa.
  const abierta =
    input.clientId != null
      ? await prisma.incident.findFirst({
          where: {
            tenantId: input.tenantId,
            clientId: input.clientId,
            incidentType: input.tipo,
            open: true,
          },
          orderBy: { openedAt: "desc" },
          select: { id: true, severity: true },
        })
      : null;

  const config = await configuracionDeGuardia(prisma, input.tenantId);

  if (abierta) {
    return adjuntar(prisma, input, abierta, queuedAt, config);
  }

  // ── 2 · Una incidencia nueva ─────────────────────────────────────
  const id = nuevoIdDeFila();
  const esN0 = input.nivel === "N0";
  const dek = await asegurarDek(input.tenantId, prisma);

  await prisma.incident.create({
    data: {
      id,
      tenantId: input.tenantId,
      subject: input.subject,
      clientId: input.clientId,
      origin: input.origin,
      incidentType: input.tipo,
      severity: input.nivel,
      templateVersion: input.templateVersion,
      // N0 nace cerrada: es constancia, no una tarea para nadie.
      open: !esN0,
      closedAt: esN0 ? input.ahora : null,
      closedByUserId: esN0 ? input.firma.userId : null,
      closedByCareRoleAssignmentId: esN0 ? input.firma.careRoleAssignmentId : null,
      // Y **no se marca como autocierre**: autocierre es «la cerró quien
      // la abrió pudiendo haberla cerrado otro» (D-28), y en un N0 no hay
      // nada que cerrar. Marcarlo llenaría el indicador de autocierres de
      // averías sin riesgo y lo dejaría sin decir nada.
      selfClosed: false,
      descriptionCifrado: cifrarTexto(
        input.descripcion ?? null,
        dek,
        sitioDescripcionDeIncidencia(input.tenantId, id),
      ),
      sourceRecordId: input.sourceRecordId ?? null,
      deviceId: input.deviceId ?? null,
      roomId: input.roomId ?? null,
      openedAt: input.occurridoEn,
      openedByUserId: input.firma.userId,
      openedByCareRoleAssignmentId: input.firma.careRoleAssignmentId,
      centerShiftId: input.centerShiftId ?? null,
      careDay: input.careDay,
    },
  });

  // La medida que la abrió, también como línea de la cronología. Es
  // redundante con `source_record_id` y está a propósito: la ficha de la
  // incidencia se lee de arriba abajo, y «38,6 a las 10:41» tiene que ser
  // la primera línea y no un campo de la cabecera que nadie mira.
  if (input.sourceRecordId) {
    await escribirAccion(prisma, {
      tenantId: input.tenantId,
      incidentId: id,
      kind: "EVIDENCE",
      careRecordId: input.sourceRecordId,
      firma: input.firma,
      at: input.occurridoEn,
    });
  }

  const avisos = esN0
    ? []
    : await avisar(prisma, {
        tenantId: input.tenantId,
        incidentId: id,
        nivel: input.nivel,
        queuedAt,
        ahora: input.ahora,
        config,
      });

  return { incidentId: id, creada: true, nivel: input.nivel, subioNivel: false, avisos };
}

/** La mitad de arriba cuando ya hay una abierta del mismo tipo. */
async function adjuntar(
  prisma: PrismaClient,
  input: DeclaracionDeIncidencia,
  abierta: { id: string; severity: Nivel },
  queuedAt: Date,
  config: Awaited<ReturnType<typeof configuracionDeGuardia>>,
): Promise<ResultadoDeDeclaracion> {
  // La evidencia, siempre: lo que llega se apunta aunque no cambie nada.
  // Es la diferencia entre «tuvo fiebre» y «tuvo 38,2 a las 10, 38,6 a
  // las 13 y 39,1 a las 17», que es lo que la DUE necesita ver.
  if (input.sourceRecordId) {
    await escribirAccion(prisma, {
      tenantId: input.tenantId,
      incidentId: abierta.id,
      kind: "EVIDENCE",
      careRecordId: input.sourceRecordId,
      firma: input.firma,
      at: input.occurridoEn,
    });
  } else if (input.descripcion) {
    await escribirAccion(prisma, {
      tenantId: input.tenantId,
      incidentId: abierta.id,
      kind: "NOTE",
      texto: input.descripcion,
      firma: input.firma,
      at: input.occurridoEn,
    });
  }

  if (!masGrave(input.nivel, abierta.severity)) {
    // Ni sube ni avisa. Es el caso normal de la segunda toma: la fiebre
    // sigue, la incidencia sigue abierta y el móvil no vuelve a sonar.
    return {
      incidentId: abierta.id,
      creada: false,
      nivel: abierta.severity,
      subioNivel: false,
      avisos: [],
    };
  }

  // ── SUBE ─────────────────────────────────────────────────────────
  //
  // El nivel cambia **por acción firmada**: el `UPDATE` y la línea de la
  // cronología van juntos. El trigger deja pasar el cambio de `severity`
  // precisamente para esto.
  await prisma.incident.update({
    where: { id: abierta.id },
    data: { severity: input.nivel },
  });
  await escribirAccion(prisma, {
    tenantId: input.tenantId,
    incidentId: abierta.id,
    kind: "SEVERITY",
    severityFrom: abierta.severity,
    severityTo: input.nivel,
    firma: input.firma,
    at: input.occurridoEn,
  });

  // Y avisa **por el nivel nuevo**: lo que esto añade es el canal que
  // faltaba. El que ya estaba sonando no se duplica — lo impide el índice
  // `(incident_id, channel)`.
  const avisos = await avisar(prisma, {
    tenantId: input.tenantId,
    incidentId: abierta.id,
    nivel: input.nivel,
    queuedAt,
    ahora: input.ahora,
    config,
  });

  return {
    incidentId: abierta.id,
    creada: false,
    nivel: input.nivel,
    subioNivel: true,
    avisos,
  };
}

/** Lo que se le pasa a `escribirAccion`. */
export interface AccionNueva {
  tenantId: string;
  incidentId: string;
  kind: "NOTE" | "EVIDENCE" | "SEVERITY" | "ALERT" | "CALL" | "CLOSE";
  /** En claro; se cifra aquí. */
  texto?: string | null;
  severityFrom?: Nivel;
  severityTo?: Nivel;
  careRecordId?: string;
  called?: boolean;
  firma: Firma;
  at?: Date;
}

/**
 * Escribe una línea del histórico. **Append-only**: no hay función para
 * editarla ni para borrarla, y el trigger tampoco las dejaría.
 */
export async function escribirAccion(
  prisma: PrismaClient | Prisma.TransactionClient,
  input: AccionNueva,
): Promise<string> {
  const id = nuevoIdDeFila();
  const dek = await asegurarDek(input.tenantId, prisma as PrismaClient);
  await prisma.incidentAction.create({
    data: {
      id,
      tenantId: input.tenantId,
      incidentId: input.incidentId,
      kind: input.kind,
      textCifrado: cifrarTexto(
        input.texto ?? null,
        dek,
        sitioTextoDeAccion(input.tenantId, id),
      ),
      severityFrom: input.severityFrom ?? null,
      severityTo: input.severityTo ?? null,
      careRecordId: input.careRecordId ?? null,
      called: input.called ?? null,
      at: input.at ?? new Date(),
      byUserId: input.firma.userId,
      byCareRoleAssignmentId: input.firma.careRoleAssignmentId,
    },
  });
  return id;
}

/** Lo que se le pasa a `escribirComunicacion`. */
export interface ComunicacionNueva {
  tenantId: string;
  incidentId: string;
  kind: "COMUNICADO" | "NO_COMUNICADO";
  channel?: "TELEFONO" | "PRESENCIAL" | "EMAIL" | "OTRA" | null;
  contactName?: string | null;
  contactRelation?: string | null;
  /** En claro. En un `NO_COMUNICADO` es el MOTIVO. */
  contenido: string;
  respuesta?: string | null;
  at: Date;
  firma: Firma;
}

/**
 * **La constancia de familia** (D-32 a D-34). Las dos mitades, y las dos
 * valen: «se llamó a su hija a las 11 y dice que viene» y «no se le
 * comunica hasta que la vea la médica».
 *
 * Append-only también: es la constancia de una conversación que ocurrió.
 */
export async function escribirComunicacion(
  prisma: PrismaClient,
  input: ComunicacionNueva,
): Promise<string> {
  if (input.kind === "NO_COMUNICADO" && (input.channel || input.respuesta)) {
    // Lo dice el CHECK `family_communications_via_coherente`; se
    // comprueba aquí para contestar con una frase y no con un 500 de
    // constraint.
    throw new IncidenciaInvalida(
      "NO_COMUNICADO_CON_VIA",
      "Un «no comunicado» no lleva vía ni respuesta de la familia: si contestaron, se comunicó.",
    );
  }
  if (input.contenido.trim().length === 0) {
    throw new IncidenciaInvalida(
      "CONSTANCIA_SIN_CONTENIDO",
      input.kind === "COMUNICADO"
        ? "Falta qué se le dijo a la familia."
        : "Falta por qué no se le comunica. Una constancia sin motivo no es constancia.",
    );
  }
  const id = nuevoIdDeFila();
  const dek = await asegurarDek(input.tenantId, prisma);
  await prisma.familyCommunication.create({
    data: {
      id,
      tenantId: input.tenantId,
      incidentId: input.incidentId,
      kind: input.kind,
      channel: input.channel ?? null,
      contactName: input.contactName ?? null,
      contactRelation: input.contactRelation ?? null,
      contentCifrado: cifrarTexto(
        input.contenido.trim(),
        dek,
        sitioContenidoAFamilia(input.tenantId, id),
      )!,
      responseCifrado: cifrarTexto(
        input.respuesta ?? null,
        dek,
        sitioRespuestaDeFamilia(input.tenantId, id),
      ),
      at: input.at,
      byUserId: input.firma.userId,
      byCareRoleAssignmentId: input.firma.careRoleAssignmentId,
    },
  });
  return id;
}

/** Lo que `cerrarIncidencia` necesita saber de quien cierra. */
export interface QuienCierra {
  firma: Firma;
  /** Las categorías de SUS roles de cuidado vigentes. */
  categorias: string[];
}

/**
 * **CERRAR** (D-27, D-28). Cuatro condiciones y ninguna es negociable:
 *
 *   1. **la cierra un rol de categoría directiva.** No el OWNER por ser
 *      OWNER: lo que cierra una incidencia es una capacidad, y «lo cerró
 *      Ana Isabel, como responsable de calidad» es la evidencia (rama
 *      §8). Un OWNER que dirige el centro tiene su rol `DIRECCION` y
 *      entra por ahí.
 *   2. **N3 y N4 exigen persona distinta** de quien la abrió. Si no la
 *      hay, la incidencia **queda abierta** y sube al panel de dirección
 *      — que es exactamente lo que D-28 dice que tiene que pasar.
 *   3. **N1 y N2 admiten autocierre**, y se MARCA. En el turno de noche
 *      hay una auxiliar y nadie más.
 *   4. **una incidencia de residente no se cierra sin constancia de
 *      familia** (D-34). Una de las dos: comunicado o no comunicado, con
 *      autor y motivo.
 *
 * Y cancela lo que quede sonando, que es lo que apaga el móvil de guardia
 * cuando el asunto ya está resuelto.
 */
export async function cerrarIncidencia(
  prisma: PrismaClient,
  input: {
    tenantId: string;
    incidentId: string;
    quien: QuienCierra;
    /** «Qué se hizo», opcional: la acción de cierre lo lleva dentro. */
    nota?: string | null;
    ahora: Date;
  },
): Promise<{ selfClosed: boolean; avisosCancelados: number }> {
  const inc = await prisma.incident.findFirst({
    where: { id: input.incidentId, tenantId: input.tenantId },
    select: {
      id: true,
      subject: true,
      severity: true,
      open: true,
      openedByUserId: true,
    },
  });
  if (!inc) {
    throw new IncidenciaInvalida(
      "INCIDENCIA_NO_ENCONTRADA",
      "Esa incidencia no es de este centro.",
    );
  }
  if (!inc.open) {
    throw new IncidenciaInvalida(
      "YA_ESTABA_CERRADA",
      "Esa incidencia ya estaba cerrada.",
    );
  }

  if (!input.quien.categorias.includes("DIRECTIVO")) {
    throw new IncidenciaInvalida(
      "CIERRE_ES_DIRECTIVO",
      "Una incidencia la cierra un rol de categoría directiva. Pídeselo a dirección.",
    );
  }

  const mismaPersona = inc.openedByUserId === input.quien.firma.userId;
  if (mismaPersona && (inc.severity === "N3" || inc.severity === "N4")) {
    throw new IncidenciaInvalida(
      "CIERRE_EXIGE_OTRA_PERSONA",
      `Una incidencia ${inc.severity} la tiene que cerrar una persona distinta de quien la abrió. Mientras no la haya, se queda abierta y sube al panel.`,
    );
  }

  if (inc.subject === "RESIDENT") {
    const constancias = await prisma.familyCommunication.count({
      where: { incidentId: inc.id },
    });
    if (constancias === 0) {
      throw new IncidenciaInvalida(
        "SIN_CONSTANCIA_DE_FAMILIA",
        "Antes de cerrar hay que dejar constancia: o se comunicó a la familia (quién, cuándo, por qué vía y qué se dijo) o se decidió no comunicarlo (quién y por qué).",
      );
    }
  }

  await prisma.incident.update({
    where: { id: inc.id },
    data: {
      open: false,
      closedAt: input.ahora,
      closedByUserId: input.quien.firma.userId,
      closedByCareRoleAssignmentId: input.quien.firma.careRoleAssignmentId,
      selfClosed: mismaPersona,
    },
  });
  await escribirAccion(prisma, {
    tenantId: input.tenantId,
    incidentId: inc.id,
    kind: "CLOSE",
    texto: input.nota ?? null,
    firma: input.quien.firma,
    at: input.ahora,
  });
  const avisosCancelados = await cancelarAvisos(prisma, inc.id);
  return { selfClosed: mismaPersona, avisosCancelados };
}

/**
 * **Enlaza dos incidencias** (D-35): la caída de la 112 y el asidero
 * suelto de la 112.
 *
 * El par se guarda ordenado y una sola vez; el motor lo clava con
 * `incident_links_ordenado` y el único de `(a_id, b_id)`.
 */
export async function enlazarIncidencias(
  prisma: PrismaClient,
  input: {
    tenantId: string;
    unaId: string;
    otraId: string;
    userId: string;
  },
): Promise<{ id: string; yaEstaba: boolean }> {
  if (input.unaId === input.otraId) {
    throw new IncidenciaInvalida(
      "ENLACE_CONSIGO_MISMA",
      "Una incidencia no se enlaza consigo misma.",
    );
  }
  const n = await prisma.incident.count({
    where: { tenantId: input.tenantId, id: { in: [input.unaId, input.otraId] } },
  });
  if (n !== 2) {
    throw new IncidenciaInvalida(
      "INCIDENCIA_NO_ENCONTRADA",
      "Una de las dos incidencias no es de este centro.",
    );
  }
  const [aId, bId] =
    input.unaId < input.otraId
      ? [input.unaId, input.otraId]
      : [input.otraId, input.unaId];
  const ya = await prisma.incidentLink.findUnique({
    where: { aId_bId: { aId, bId } },
    select: { id: true },
  });
  if (ya) return { id: ya.id, yaEstaba: true };
  const creado = await prisma.incidentLink.create({
    data: { tenantId: input.tenantId, aId, bId, createdByUserId: input.userId },
    select: { id: true },
  });
  return { id: creado.id, yaEstaba: false };
}

/**
 * **La excepción de umbral de un residente** (D-22). Sólo la pauta un rol
 * `MEDICO`, y eso se comprueba aquí y no en la ruta porque es la regla
 * entera: una excepción firmada por una auxiliar es un umbral clínico
 * cambiado por quien no puede.
 */
export async function pautarExcepcion(
  prisma: PrismaClient,
  input: {
    tenantId: string;
    clientId: string;
    controlCode: string;
    motivo: string;
    desde: Date;
    hasta: Date | null;
    reglas: Array<{
      comparador: "GTE" | "GT" | "LTE" | "LT";
      valor: number;
      nivel: Nivel;
      tipo: string;
    }>;
    firma: Firma;
    /** El código del rol de cuidado con el que firma. */
    rolCode: string;
  },
): Promise<string> {
  if (input.rolCode !== "MEDICO") {
    throw new IncidenciaInvalida(
      "EXCEPCION_ES_DEL_MEDICO",
      "Una excepción de umbral es una prescripción médica: sólo la pauta quien entra con el rol de médico (D-22).",
    );
  }
  if (input.motivo.trim().length === 0) {
    throw new IncidenciaInvalida(
      "EXCEPCION_SIN_MOTIVO",
      "Una excepción sin motivo es un umbral cambiado sin que nadie sepa por qué. Escribe la pauta.",
    );
  }
  const id = nuevoIdDeFila();
  const dek = await asegurarDek(input.tenantId, prisma);
  await prisma.$transaction(async (tx) => {
    await tx.residentThresholdOverride.create({
      data: {
        id,
        tenantId: input.tenantId,
        clientId: input.clientId,
        controlCode: input.controlCode,
        reasonCifrado: cifrarTexto(
          input.motivo.trim(),
          dek,
          sitioMotivoDeExcepcion(input.tenantId, id),
        )!,
        fromAt: input.desde,
        toAt: input.hasta,
        signedByUserId: input.firma.userId,
        signedByCareRoleAssignmentId: input.firma.careRoleAssignmentId,
      },
    });
    if (input.reglas.length > 0) {
      await tx.residentThresholdRule.createMany({
        data: input.reglas.map((r, i) => ({
          overrideId: id,
          comparator: r.comparador,
          value: r.valor,
          severity: r.nivel,
          incidentType: r.tipo,
          sortOrder: (i + 1) * 10,
        })),
      });
    }
  });
  return id;
}

/** Las categorías de los roles de cuidado VIGENTES de alguien. Lo que
 *  decide quién cierra (D-27) y quién pauta (D-22). */
export async function capacidadesVigentes(
  prisma: PrismaClient,
  tenantId: string,
  userId: string,
  ahora: Date,
): Promise<Array<{ assignmentId: string; code: string; category: string }>> {
  const filas = await prisma.careRoleAssignment.findMany({
    where: {
      tenantId,
      userId,
      revokedAt: null,
      fromAt: { lte: ahora },
      OR: [{ toAt: null }, { toAt: { gt: ahora } }],
      careRole: { active: true },
    },
    select: {
      id: true,
      careRole: { select: { code: true, category: true } },
    },
  });
  return filas.map((f) => ({
    assignmentId: f.id,
    code: f.careRole.code,
    category: f.careRole.category,
  }));
}

/** El canal al que pertenece un móvil, para la pantalla. */
export type Canal = CanalDeGuardia;
