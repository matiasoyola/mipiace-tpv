// historia-1 (D-92) · **LAS AUSENCIAS, FUERA DE LAS RUTAS.**
//
// Abrir una ausencia, cerrarla, confirmar la revisión de la vuelta y
// cargarlas para el plan. Las rutas sólo traducen HTTP; quien sabe qué
// significa cada cosa es este fichero, y lo llaman **seis** sitios: la
// pantalla de ausencias del admin, el alta del residente (que cierra la
// abierta si la hay), `queToca` en cuatro consultas distintas, el parte
// de relevo, el panel y la puerta.
//
// ── LAS TRES INVARIANTES ────────────────────────────────────────────
//
//   1. **Una viva por residente.** Lo garantiza el índice parcial
//      `resident_absences_una_viva_key`, no este fichero: nadie está en
//      el hospital y de vacaciones a la vez. Abrir la segunda contesta
//      409 con la que está, y el motor lo pararía igual.
//   2. **Una salida no controlada ABRE UNA INCIDENCIA N4.** No es una
//      ausencia que además avisa: es un evento del libro (D-92, versión 2
//      de la plantilla de gravedad) y la ausencia apunta a él. Las dos
//      cosas en la misma transacción — una salida no controlada sin aviso
//      es el riesgo sin asociar de la NC 01.
//   3. **Volver de un hospital o de urgencias deja una REVISIÓN
//      pendiente.** La pone el cierre, no la apertura: mientras la señora
//      está ingresada no hay nada que revisar.

import type { Prisma, PrismaClient } from "@mipiacetpv/db";
import {
  diaDelTurno,
  turnoDe,
  type AusenciaDelPlan,
  type TipoDeAusencia,
} from "@mipiacetpv/residencia-plan";

import { asegurarDek } from "../clinica/claves.js";
import {
  cifrarTexto,
  nuevoIdDeFila,
  sitioDestinoDeAusencia,
  sitioMotivoDeAusencia,
} from "../clinica/cripto-campos.js";
import { declararIncidencia, type Firma } from "./incidencias.js";
import {
  TIPOS_DE_INCIDENCIA,
  VERSION_DE_LA_PLANTILLA,
} from "./catalogo/plantilla-de-gravedad.js";

type Ejecutor = PrismaClient | Prisma.TransactionClient;

export class AusenciaInvalida extends Error {
  constructor(
    readonly codigo: string,
    mensaje: string,
  ) {
    super(mensaje);
  }
}

/**
 * **Las dos clases de ausencia que dejan revisión al volver** (D-92).
 *
 * Quien vuelve de un hospital o de urgencias trae medicación cambiada e
 * informes que alguien tiene que leer. De unas vacaciones con la hija,
 * no — y marcar las cuatro clases habría llenado el panel de la DUE de
 * revisiones que no hay que hacer, que es cómo se deja de mirar el panel.
 */
export const DEJAN_REVISION: readonly TipoDeAusencia[] = [
  "INGRESO_HOSPITALARIO",
  "URGENCIAS",
];

// ── CARGARLAS PARA EL PLAN ──────────────────────────────────────────

/**
 * Las ausencias que **tocan una ventana de tiempo**, para pasárselas a
 * `queToca`.
 *
 * La consulta es la que importa de este fichero, porque es la que se
 * puede escribir mal: **una ausencia toca la ventana si se solapa con
 * ella**, lo que incluye la que empezó hace tres días y no ha acabado.
 * Filtrar por `startedAt >= desde` —que es lo que sale solo— dejaría
 * fuera exactamente a la señora que lleva una semana en el hospital, que
 * es el caso entero del bloque.
 *
 * `clientIds` acota a los residentes que interesan (los dos de una
 * habitación, en la puerta) o se omite para el centro entero (el parte,
 * el panel).
 */
export async function ausenciasDelPlan(
  prisma: Ejecutor,
  tenantId: string,
  desde: Date,
  hasta: Date,
  clientIds?: string[],
): Promise<AusenciaDelPlan[]> {
  const filas = await prisma.residentAbsence.findMany({
    where: {
      tenantId,
      ...(clientIds ? { clientId: { in: clientIds } } : {}),
      // Se solapa con `[desde, hasta)`: empezó antes de que acabe la
      // ventana, y acabó después de que empiece (o no ha acabado).
      startedAt: { lt: hasta },
      OR: [{ endedAt: null }, { endedAt: { gt: desde } }],
    },
    select: { clientId: true, kind: true, startedAt: true, endedAt: true },
  });
  return filas.map((f) => ({
    clientId: f.clientId,
    tipo: f.kind,
    desde: f.startedAt,
    hasta: f.endedAt,
  }));
}

/**
 * Las ausencias **abiertas ahora mismo** del centro, con lo que el parte
 * y la puerta necesitan pintar.
 *
 * Sin descifrar el destino ni el motivo, y es deliberado: lo que la
 * puerta y el parte dicen es «ausente: en el hospital desde el martes»,
 * que sale del TIPO y de la FECHA. Adónde fue y por qué son datos de la
 * ficha, que se miran en el despacho — y lo que no se trae no se puede
 * mandar a una tablet de pasillo por error (la misma regla que
 * `frasesDeLaPuerta`).
 */
export async function ausenciasAbiertas(
  prisma: Ejecutor,
  tenantId: string,
  clientIds?: string[],
): Promise<AusenciaDelPlan[]> {
  const filas = await prisma.residentAbsence.findMany({
    where: {
      tenantId,
      endedAt: null,
      ...(clientIds ? { clientId: { in: clientIds } } : {}),
    },
    select: { clientId: true, kind: true, startedAt: true, endedAt: true },
  });
  return filas.map((f) => ({
    clientId: f.clientId,
    tipo: f.kind,
    desde: f.startedAt,
    hasta: f.endedAt,
  }));
}

// ── ABRIR ───────────────────────────────────────────────────────────

export interface AusenciaNueva {
  tenantId: string;
  clientId: string;
  tipo: TipoDeAusencia;
  desde: Date;
  finPrevisto: Date | null;
  destino?: string | null;
  motivo?: string | null;
  firma: Firma;
  ahora: Date;
  /** Para la incidencia N4 de una salida no controlada: desde qué
   *  habitación se declaró, si se sabe. */
  roomId?: string | null;
}

export interface AusenciaAbierta {
  id: string;
  /** El id de la incidencia N4, si la ausencia era una salida no
   *  controlada. */
  incidentId: string | null;
}

/**
 * **Abre una ausencia.** Y si es una salida no controlada, abre su
 * incidencia N4 primero.
 *
 * ── El ORDEN, que es la decisión ───────────────────────────────────
 *
 * Primero la incidencia, después la ausencia que la apunta. Al revés
 * habría que escribir la ausencia, declarar la incidencia y volver a
 * tocar la ausencia para enlazarla — tres escrituras y un trigger de
 * inmutabilidad que rechazaría la tercera (el `incident_id` no está entre
 * las transiciones que `resident_absences_inmutable` deja pasar, a
 * propósito: una ausencia no cambia de incidencia).
 *
 * ── Y POR QUÉ `declararIncidencia` NO VA EN LA TRANSACCIÓN ─────────
 *
 * Porque **avisa al móvil de guardia**, y avisar es mandar algo fuera.
 * `declararIncidencia` ya resuelve eso por su cuenta (residencia-4) y
 * pide el `PrismaClient` entero, no un `tx`. La consecuencia, dicha: si
 * la escritura de la ausencia fallara después de declarar la incidencia,
 * quedaría una incidencia N4 abierta sin su ausencia. **Es el lado
 * correcto del fallo**: el aviso de que alguien no está ya salió, que es
 * lo que no se puede perder. La ausencia se vuelve a abrir desde la
 * pantalla.
 */
export async function abrirAusencia(
  prisma: PrismaClient,
  input: AusenciaNueva,
): Promise<AusenciaAbierta> {
  const abierta = await prisma.residentAbsence.findFirst({
    where: { tenantId: input.tenantId, clientId: input.clientId, endedAt: null },
    select: { id: true, kind: true, startedAt: true },
  });
  if (abierta) {
    throw new AusenciaInvalida(
      "YA_ESTA_AUSENTE",
      "Este residente ya tiene una ausencia abierta. Ciérrala antes de abrir otra: nadie está en dos sitios a la vez.",
    );
  }

  let incidentId: string | null = null;
  if (input.tipo === "SALIDA_NO_CONTROLADA") {
    const turnos = await prisma.centerShift.findMany({
      where: { tenantId: input.tenantId },
      orderBy: { sortOrder: "asc" },
      select: { id: true, code: true, name: true, startsAt: true, endsAt: true },
    });
    const turno = turnoDe(input.desde, turnos);
    const resultado = await declararIncidencia(prisma, {
      tenantId: input.tenantId,
      subject: "RESIDENT",
      clientId: input.clientId,
      origin: "DECLARED",
      // El tipo NUEVO de la versión 2 de la plantilla. No se reutiliza
      // `NO_LOCALIZADO`, que es el de residencia-4 y significa otra cosa:
      // allí **nadie sabe dónde está** (la auxiliar no lo encuentra en su
      // ronda); aquí **se sabe que se ha ido** y nadie lo autorizó. Las
      // dos son N4 y las dos suenan, y separarlas es lo que permite
      // contarlas aparte — una residencia con tres fugas y cero
      // desapariciones tiene un problema de puerta, no de vigilancia.
      tipo: TIPOS_DE_INCIDENCIA.SALIDA_NO_CONTROLADA,
      nivel: "N4",
      templateVersion: VERSION_DE_LA_PLANTILLA,
      descripcion: input.motivo ?? null,
      roomId: input.roomId ?? null,
      centerShiftId: turno?.id ?? null,
      careDay: diaDelTurno(input.desde, turno),
      occurridoEn: input.desde,
      firma: input.firma,
      ahora: input.ahora,
    });
    incidentId = resultado.incidentId;
  }

  const id = nuevoIdDeFila();
  await prisma.$transaction(async (tx) => {
    const dek = await asegurarDek(input.tenantId, tx);
    await tx.residentAbsence.create({
      data: {
        id,
        tenantId: input.tenantId,
        clientId: input.clientId,
        kind: input.tipo,
        startedAt: input.desde,
        expectedEndAt: input.finPrevisto,
        destinationCifrado: cifrarTexto(
          input.destino ?? null,
          dek,
          sitioDestinoDeAusencia(input.tenantId, id),
        ),
        reasonCifrado: cifrarTexto(
          input.motivo ?? null,
          dek,
          sitioMotivoDeAusencia(input.tenantId, id),
        ),
        incidentId,
        createdByUserId: input.firma.userId,
        createdByCareRoleAssignmentId: input.firma.careRoleAssignmentId,
      },
    });
  });

  return { id, incidentId };
}

// ── CERRAR ──────────────────────────────────────────────────────────

/**
 * **Cierra una ausencia**: el residente ha vuelto.
 *
 * Y marca la revisión pendiente si venía de un hospital o de urgencias
 * (D-92). La marca va aquí y no en la apertura porque mientras está
 * ingresada no hay nada que revisar: el panel de la DUE enseñaría una
 * tarea que no se puede hacer.
 */
export async function cerrarAusencia(
  prisma: Ejecutor,
  input: {
    tenantId: string;
    absenceId: string;
    vueltaEn: Date;
    firma: Firma;
  },
): Promise<{ dejaRevision: boolean }> {
  const fila = await prisma.residentAbsence.findFirst({
    where: { id: input.absenceId, tenantId: input.tenantId },
    select: { id: true, kind: true, startedAt: true, endedAt: true },
  });
  if (!fila) {
    throw new AusenciaInvalida(
      "AUSENCIA_NO_ENCONTRADA",
      "Esa ausencia no está en este centro.",
    );
  }
  if (fila.endedAt != null) {
    throw new AusenciaInvalida(
      "YA_ESTABA_CERRADA",
      "Esa ausencia ya estaba cerrada. Si volvió a irse, abre otra.",
    );
  }
  if (input.vueltaEn < fila.startedAt) {
    throw new AusenciaInvalida(
      "VUELTA_ANTES_DE_IRSE",
      "La vuelta no puede ser anterior a la salida.",
    );
  }
  const dejaRevision = DEJAN_REVISION.includes(fila.kind);
  await prisma.residentAbsence.update({
    where: { id: fila.id },
    data: {
      endedAt: input.vueltaEn,
      closedByUserId: input.firma.userId,
      reviewRequired: dejaRevision,
    },
  });
  return { dejaRevision };
}

/**
 * **La DUE confirma que ha revisado la vuelta** (D-92).
 *
 * Queda quién y cuándo, y el panel deja de pedirlo. Cuando existan PAI
 * (historia-2) y medicación, esta confirmación se convertirá en sus
 * tareas de revisión y conciliación; **aquí no se adelanta nada** — lo
 * que hay es el aviso y su acuse, y escribir hoy una tarea de
 * conciliación sin medicación que conciliar sería una tarea que nadie
 * puede cerrar.
 */
export async function confirmarRevision(
  prisma: Ejecutor,
  input: {
    tenantId: string;
    absenceId: string;
    firma: Firma;
    ahora: Date;
  },
): Promise<void> {
  const fila = await prisma.residentAbsence.findFirst({
    where: { id: input.absenceId, tenantId: input.tenantId },
    select: { id: true, endedAt: true, reviewRequired: true, reviewedAt: true },
  });
  if (!fila) {
    throw new AusenciaInvalida(
      "AUSENCIA_NO_ENCONTRADA",
      "Esa ausencia no está en este centro.",
    );
  }
  if (fila.endedAt == null) {
    // El CHECK `resident_absences_revision_completa` lo pararía igual.
    // Esto es para que el mensaje lo entienda alguien.
    throw new AusenciaInvalida(
      "TODAVIA_NO_HA_VUELTO",
      "Todavía no ha vuelto: no hay nada que revisar.",
    );
  }
  if (!fila.reviewRequired) {
    throw new AusenciaInvalida(
      "NO_PIDE_REVISION",
      "Esta ausencia no pedía revisión: sólo la piden las vueltas de un ingreso hospitalario o de urgencias.",
    );
  }
  if (fila.reviewedAt != null) {
    throw new AusenciaInvalida(
      "YA_ESTABA_REVISADA",
      "Esta vuelta ya estaba revisada.",
    );
  }
  await prisma.residentAbsence.update({
    where: { id: fila.id },
    data: {
      reviewedAt: input.ahora,
      reviewedByUserId: input.firma.userId,
      reviewedByCareRoleAssignmentId: input.firma.careRoleAssignmentId,
    },
  });
}

/**
 * **El alta cierra la ausencia abierta** (D-96).
 *
 * Se llama desde la transacción del alta del residente. Si no la cerrara,
 * el residente se quedaría ausente **para siempre**: `queToca` no le
 * generaría nada (que da igual, porque su plan también se cierra) pero
 * los días del mes lo seguirían contando fuera y el panel seguiría
 * pidiendo su revisión. Un residente dado de alta y ausente es una fila
 * que nadie puede volver a tocar, porque la pantalla de ausencias sólo
 * lista a los que viven aquí.
 *
 * **Y NO deja revisión pendiente**, aunque venga de un hospital: la DUE
 * no tiene que revisar la medicación de alguien que ya no vive aquí. Es
 * la diferencia con `cerrarAusencia`, y es la razón de que sean dos
 * funciones y no una con un booleano.
 */
export async function cerrarAusenciaPorAlta(
  prisma: Ejecutor,
  input: {
    tenantId: string;
    clientId: string;
    cuando: Date;
    userId: string;
  },
): Promise<{ cerrada: boolean }> {
  const abiertas = await prisma.residentAbsence.findMany({
    where: { tenantId: input.tenantId, clientId: input.clientId, endedAt: null },
    select: { id: true, startedAt: true },
  });
  let cerrada = false;
  for (const a of abiertas) {
    // El alta puede ser ANTERIOR a la salida cuando la fecha del alta se
    // retrotrae (una señora que se fue al hospital el día 3 y a la que se
    // da de alta con fecha 1). El CHECK
    // `resident_absences_instantes_coherentes` lo rechazaría, así que se
    // cierra con el instante de la salida: la ausencia duró cero. Es la
    // lectura correcta —no estuvo fuera estando dada de alta— y no deja la
    // fila abierta para siempre.
    const cuando = input.cuando < a.startedAt ? a.startedAt : input.cuando;
    await prisma.residentAbsence.update({
      where: { id: a.id },
      data: {
        endedAt: cuando,
        closedByUserId: input.userId,
        reviewRequired: false,
      },
    });
    cerrada = true;
  }
  return { cerrada };
}
