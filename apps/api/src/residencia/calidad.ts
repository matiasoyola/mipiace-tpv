// calidad-1 (D-70 a D-75) · **EL MÓDULO DE CALIDAD, FUERA DE LAS
// RUTAS.**
//
// Cargar el mapa de referencia, reasignar lo que cuelga de un proceso,
// abrir una no conformidad y moverla por su ciclo. Las rutas sólo
// traducen HTTP; quien sabe qué significa cada cosa es este fichero.
//
// ── LA INVARIANTE DEL BLOQUE ────────────────────────────────────────
//
// **Nada de calidad existe sin proceso.** No es una comprobación que
// este fichero hace: es que las cuatro FKs son `NOT NULL` y `Restrict`,
// y no hay forma de escribir una fila sin elegir uno. Lo que este
// fichero añade encima es que **tampoco se pueda dejar huérfana
// después**: desactivar un proceso con algo colgando obliga a
// reasignarlo primero, y ésa sí es una regla de aquí — el motor puede
// impedir el borrado, pero «desactivado» es una columna y un `active =
// false` no dispara ninguna FK.
//
// ── Y LA SEGUNDA: EL CICLO LO DECIDE EL PAQUETE PURO ────────────────
//
// `loQueFaltaPara` vive en `@mipiacetpv/residencia-plan` y lo ejecutan
// esta capa y la pantalla. Aquí no hay una segunda cadena de `if`: si la
// hubiera, el día que cambiara el ciclo la pantalla encendería un botón
// que la ruta rechaza.

import type { Prisma, PrismaClient } from "@mipiacetpv/db";
import {
  estadoTrasVerificar,
  exigeCausa,
  loQueFaltaPara,
  type ClaseDeNc,
  type EstadoDeNc,
  type NcParaElCiclo,
  type ResultadoDeVerificacion,
} from "@mipiacetpv/residencia-plan";

import { asegurarDek } from "../clinica/claves.js";
import {
  cifrarTexto,
  nuevoIdDeFila,
  sitioCausaDeNc,
  sitioCierreDeAccionCorrectiva,
  sitioDescripcionDeNc,
  sitioNotaDeEvidencia,
  sitioNotaDeVerificacion,
  sitioTextoDeAccionCorrectiva,
} from "../clinica/cripto-campos.js";
import {
  PROCESOS_DE_REFERENCIA,
  RIESGOS_DE_REFERENCIA,
} from "./catalogo/procesos-de-serie.js";
import { INDICADORES } from "@mipiacetpv/residencia-plan";

/** El error de negocio de este módulo. Lo traducen las rutas a su HTTP. */
export class CalidadInvalida extends Error {
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

// ════════════════════════════════════════════════════════════════════
//  1 · CARGAR EL MAPA DE REFERENCIA (D-70, D-71, D-72)
// ════════════════════════════════════════════════════════════════════

/** Qué hizo la carga, para que la pantalla lo diga en vez de recargar y
 *  dejar al usuario adivinando. */
export interface ResultadoDeLaCarga {
  procesosCreados: number;
  procesosQueYaEstaban: number;
  riesgosCreados: number;
  indicadoresColgados: number;
}

/**
 * **CARGA EL MAPA DE REFERENCIA EN ESTE CENTRO, Y ES IDEMPOTENTE.**
 *
 * Once procesos, cuatro riesgos y una fila por indicador del producto
 * diciendo de qué proceso cuelga. Correrlo dos veces no duplica nada:
 * los índices únicos `(tenant, reference_code)` y `(tenant, code)` lo
 * impiden en el motor, y aquí se consulta antes para no gastar un error.
 *
 * ── POR QUÉ NO BAJA SOLO AL ENCENDER LA RESIDENCIA ──────────────────
 *
 * Porque el mapa **es del centro desde el momento en que lo carga**, y
 * lo que un centro ajusta en noviembre no lo puede pisar una versión del
 * producto de 2028. Misma distinción —y por lo mismo— que la plantilla
 * de obligaciones de residencia-5: esto lo llama un botón, no
 * `server.ts`.
 *
 * ── QUÉ PASA SI FALTA UN ROL ────────────────────────────────────────
 *
 * El mapa de referencia nombra a sus responsables por código de rol de
 * cuidado (`DUE`, `CALIDAD`…). Si un centro desactivó uno, el proceso
 * cae a `DIRECCION`, que existe siempre porque es quien tiene el tenant.
 * La alternativa —fallar la carga— habría dejado sin mapa a un centro
 * por no tener fisioterapeuta.
 */
export async function cargarMapaDeReferencia(
  prisma: PrismaClient,
  tenantId: string,
  userId: string | null,
  hoy: string,
): Promise<ResultadoDeLaCarga> {
  const roles = await prisma.careRole.findMany({
    where: { tenantId },
    select: { id: true, code: true, active: true },
  });
  const porCodigo = new Map(roles.map((r) => [r.code, r]));
  const direccion = porCodigo.get("DIRECCION") ?? roles[0];
  if (direccion == null) {
    throw new CalidadInvalida(
      "SIN_ROLES_DE_CUIDADO",
      "Este centro todavía no tiene roles de cuidado. Enciende la residencia y vuelve a intentarlo.",
    );
  }
  const rolDe = (code: string): string => {
    const r = porCodigo.get(code);
    return r != null && r.active ? r.id : direccion.id;
  };

  return prisma.$transaction(async (tx) => {
    const yaEstan = await tx.process.findMany({
      where: { tenantId, referenceCode: { not: null } },
      select: { id: true, referenceCode: true },
    });
    const porReferencia = new Map(
      yaEstan.map((p) => [p.referenceCode!, p.id] as const),
    );

    let procesosCreados = 0;
    for (const def of PROCESOS_DE_REFERENCIA) {
      if (porReferencia.has(def.code)) continue;
      const creado = await tx.process.create({
        data: {
          tenantId,
          code: def.code,
          name: def.name,
          type: def.type,
          purpose: def.purpose,
          referenceCode: def.code,
          responsibleCareRoleId: rolDe(def.responsibleCareRoleCode),
          sortOrder: def.sortOrder,
          createdByUserId: userId,
        },
        select: { id: true },
      });
      porReferencia.set(def.code, creado.id);
      procesosCreados += 1;
    }

    // ── Los cuatro riesgos que la NC 01 nombra ────────────────────
    const riesgosQueYaEstan = await tx.riskOpportunity.findMany({
      where: { tenantId, code: { not: null } },
      select: { code: true },
    });
    const codigosDeRiesgo = new Set(riesgosQueYaEstan.map((r) => r.code!));

    let riesgosCreados = 0;
    for (const def of RIESGOS_DE_REFERENCIA) {
      if (codigosDeRiesgo.has(def.code)) continue;
      const processId = porReferencia.get(def.processCode);
      // Un riesgo de serie cuyo proceso no está cargado no se inventa un
      // sitio donde colgarse: se salta. Sólo puede pasar si alguien
      // desactivó y borró el proceso entre dos cargas.
      if (processId == null) continue;
      await tx.riskOpportunity.create({
        data: {
          tenantId,
          processId,
          kind: def.kind,
          code: def.code,
          description: def.description,
          probability: def.probability,
          impact: def.impact,
          level: def.probability * def.impact,
          plannedAction: def.plannedAction,
          isoClause: def.isoClause,
          reviewAt: sumarMeses(hoy, def.reviewInMonths),
          createdByUserId: userId,
        },
      });
      riesgosCreados += 1;
    }

    // ── Y de qué proceso cuelga cada indicador del producto (D-72) ─
    //
    // Aquí es donde «no hay indicador sin proceso» deja de ser una frase
    // y pasa a ser una fila con FK `NOT NULL`: después de cargar el
    // mapa, los trece la tienen.
    const colgadosYa = await tx.indicatorProcess.findMany({
      where: { tenantId },
      select: { code: true },
    });
    const yaColgado = new Set(colgadosYa.map((c) => c.code));

    let indicadoresColgados = 0;
    for (const ind of INDICADORES) {
      if (yaColgado.has(ind.code)) continue;
      const processId = porReferencia.get(ind.procesoDeReferencia);
      if (processId == null) continue;
      await tx.indicatorProcess.create({
        data: { tenantId, code: ind.code, processId, updatedByUserId: userId },
      });
      indicadoresColgados += 1;
    }

    return {
      procesosCreados,
      procesosQueYaEstaban: yaEstan.length,
      riesgosCreados,
      indicadoresColgados,
    };
  });
}

/**
 * «YYYY-MM-DD» más N meses, con el día recortado al último del mes
 * destino.
 *
 * El 31 de enero más un mes es el 28 de febrero y no el 3 de marzo.
 * Mismo criterio que el generador de obligaciones de residencia-5, y
 * escrito aquí en vez de reutilizado porque allí la pregunta es «¿qué
 * días del mes toca?» y aquí «¿qué día cae dentro de seis meses?»: dos
 * funciones de cuatro líneas que casualmente comparten una resta.
 */
export function sumarMeses(fecha: string, meses: number): string {
  const anio = Number(fecha.slice(0, 4));
  const mes = Number(fecha.slice(5, 7));
  const dia = Number(fecha.slice(8, 10));
  const total = mes - 1 + meses;
  const anioDestino = anio + Math.floor(total / 12);
  const mesDestino = (total % 12) + 1;
  const ultimo = new Date(Date.UTC(anioDestino, mesDestino, 0)).getUTCDate();
  const diaDestino = Math.min(dia, ultimo);
  return `${anioDestino}-${String(mesDestino).padStart(2, "0")}-${String(diaDestino).padStart(2, "0")}`;
}

// ════════════════════════════════════════════════════════════════════
//  2 · DESACTIVAR UN PROCESO · lo que cuelga se reasigna PRIMERO
// ════════════════════════════════════════════════════════════════════

/** Qué cuelga de un proceso, para poder decirlo y para poder moverlo. */
export interface LoQueCuelga {
  riesgos: number;
  objetivos: number;
  noConformidades: number;
  indicadores: number;
  total: number;
}

export async function loQueCuelgaDe(
  prisma: PrismaClient,
  tenantId: string,
  processId: string,
): Promise<LoQueCuelga> {
  const [riesgos, objetivos, noConformidades, indicadores] = await Promise.all([
    prisma.riskOpportunity.count({ where: { tenantId, processId } }),
    prisma.qualityObjective.count({ where: { tenantId, processId } }),
    prisma.nonConformity.count({ where: { tenantId, processId } }),
    prisma.indicatorProcess.count({ where: { tenantId, processId } }),
  ]);
  return {
    riesgos,
    objetivos,
    noConformidades,
    indicadores,
    total: riesgos + objetivos + noConformidades + indicadores,
  };
}

/**
 * **MUEVE TODO LO QUE CUELGA DE UN PROCESO A OTRO.**
 *
 * Es lo que hay que hacer antes de desactivar. Y es una transacción
 * entera: la mitad de los indicadores en un proceso y la mitad en otro
 * es exactamente el estado que la NC 01 describe.
 */
export async function reasignarProceso(
  prisma: PrismaClient,
  tenantId: string,
  deId: string,
  aId: string,
  userId: string | null,
): Promise<LoQueCuelga> {
  if (deId === aId) {
    throw new CalidadInvalida(
      "MISMO_PROCESO",
      "Hay que elegir un proceso distinto al que se vacía.",
    );
  }
  const destino = await prisma.process.findFirst({
    where: { id: aId, tenantId },
    select: { id: true, active: true },
  });
  if (destino == null) {
    throw new CalidadInvalida(
      "PROCESO_NO_ENCONTRADO",
      "El proceso de destino no existe en este centro.",
    );
  }
  // Mover a un proceso desactivado sería esconder lo mismo con un paso
  // más: lo que cuelga dejaría de verse igual.
  if (!destino.active) {
    throw new CalidadInvalida(
      "DESTINO_DESACTIVADO",
      "El proceso de destino está desactivado. Elige uno activo: lo que cuelgue de él tiene que verse en el mapa.",
    );
  }

  const antes = await loQueCuelgaDe(prisma, tenantId, deId);
  await prisma.$transaction([
    prisma.riskOpportunity.updateMany({
      where: { tenantId, processId: deId },
      data: { processId: aId },
    }),
    prisma.qualityObjective.updateMany({
      where: { tenantId, processId: deId },
      data: { processId: aId },
    }),
    prisma.nonConformity.updateMany({
      where: { tenantId, processId: deId },
      data: { processId: aId },
    }),
    prisma.indicatorProcess.updateMany({
      where: { tenantId, processId: deId },
      data: { processId: aId, updatedByUserId: userId },
    }),
  ]);
  return antes;
}

/**
 * Desactiva un proceso, **sólo si no le cuelga nada**.
 *
 * El motor impide borrarlo (las cuatro FKs son `Restrict`), pero
 * desactivar es poner una columna a `false` y eso ninguna FK lo ve. Si
 * se permitiera, el riesgo de las salidas no controladas seguiría en la
 * base y desaparecería de la pantalla — que delante de un auditor es
 * peor que no haberlo tenido nunca.
 */
export async function desactivarProceso(
  prisma: PrismaClient,
  tenantId: string,
  processId: string,
): Promise<void> {
  const cuelga = await loQueCuelgaDe(prisma, tenantId, processId);
  if (cuelga.total > 0) {
    const partes: string[] = [];
    if (cuelga.indicadores > 0) partes.push(`${cuelga.indicadores} indicador(es)`);
    if (cuelga.riesgos > 0) partes.push(`${cuelga.riesgos} riesgo(s) u oportunidad(es)`);
    if (cuelga.objetivos > 0) partes.push(`${cuelga.objetivos} objetivo(s)`);
    if (cuelga.noConformidades > 0) partes.push(`${cuelga.noConformidades} no conformidad(es)`);
    throw new CalidadInvalida(
      "PROCESO_CON_COSAS_COLGANDO",
      `De este proceso cuelgan ${partes.join(", ")}. Reasígnalos a otro proceso antes de desactivarlo: si no, dejarían de verse en el mapa sin que nadie los haya cerrado.`,
    );
  }
  await prisma.process.update({
    where: { id: processId },
    data: { active: false },
  });
}

// ════════════════════════════════════════════════════════════════════
//  3 · QUIÉN PUEDE ABRIR Y MOVER UNA NC (D-73)
// ════════════════════════════════════════════════════════════════════

/**
 * La capacidad con la que esta persona trabaja en calidad, o `null`.
 *
 * «Abre y elige clase quien tenga categoría `DIRECTIVO` o el rol
 * `CALIDAD`» (D-73). Las dos y no sólo la primera porque en Jardín de
 * Gredos quien lleva la calidad es la terapeuta ocupacional con el rol
 * `CALIDAD`, no la directora: exigir categoría directiva habría dejado
 * fuera a la única persona que hace este trabajo.
 *
 * Devuelve el `assignmentId` porque es lo que firma cada fila (D-31):
 * no basta con saber que puede, hay que escribir **con qué capacidad**
 * lo hizo.
 */
export async function capacidadDeCalidad(
  prisma: PrismaClient,
  tenantId: string,
  userId: string,
  ahora: Date,
): Promise<{ assignmentId: string; code: string } | null> {
  const filas = await prisma.careRoleAssignment.findMany({
    where: {
      tenantId,
      userId,
      revokedAt: null,
      fromAt: { lte: ahora },
      OR: [{ toAt: null }, { toAt: { gt: ahora } }],
      careRole: {
        active: true,
        OR: [{ category: "DIRECTIVO" }, { code: "CALIDAD" }],
      },
    },
    select: { id: true, careRole: { select: { code: true, category: true } } },
    orderBy: { fromAt: "asc" },
  });
  const elegida =
    filas.find((f) => f.careRole.code === "CALIDAD") ?? filas[0] ?? null;
  return elegida == null
    ? null
    : { assignmentId: elegida.id, code: elegida.careRole.code };
}

// ════════════════════════════════════════════════════════════════════
//  4 · ABRIR UNA NO CONFORMIDAD
// ════════════════════════════════════════════════════════════════════

export interface NcNueva {
  processId: string;
  kind: ClaseDeNc;
  origin:
    | "INTERNAL_AUDIT"
    | "EXTERNAL_AUDIT"
    | "INSPECTION"
    | "INCIDENT"
    | "COMPLAINT"
    | "INDICATOR"
    | "MANAGEMENT_REVIEW"
    | "OTHER";
  detectedOn: string;
  descripcion: string;
  isoClause?: string | null;
  sourceIncidentId?: string | null;
  sourceIndicatorCode?: string | null;
  sourceIndicatorMonth?: string | null;
  sourceNote?: string | null;
}

/**
 * **ABRE UNA NC Y LE PONE SU REFERENCIA.**
 *
 * La referencia es `NC-<año>-<nn>` y la pone el sistema, no el usuario:
 * una referencia que se teclea acaba repetida, y el PAC la usa para
 * nombrar cada fila delante del auditor.
 *
 * El número es «el siguiente libre del año». La carrera entre dos
 * personas abriendo a la vez la pierde el índice único `(tenant,
 * reference)`, así que se reintenta: contar y escribir en la misma
 * transacción habría necesitado bloquear la tabla entera, y abrir dos NC
 * a la vez pasa una vez al año.
 */
export async function abrirNc(
  prisma: PrismaClient,
  tenantId: string,
  entrada: NcNueva,
  firma: Firma,
  ahora: Date,
): Promise<{ id: string; reference: string }> {
  const proceso = await prisma.process.findFirst({
    where: { id: entrada.processId, tenantId },
    select: { id: true, active: true },
  });
  if (proceso == null) {
    throw new CalidadInvalida(
      "PROCESO_NO_ENCONTRADO",
      "Ese proceso no existe en este centro. Una no conformidad cuelga siempre de un proceso del mapa.",
    );
  }
  if (!proceso.active) {
    throw new CalidadInvalida(
      "PROCESO_DESACTIVADO",
      "Ese proceso está desactivado. Elige uno activo del mapa.",
    );
  }

  if (
    (entrada.origin === "INCIDENT" || entrada.origin === "COMPLAINT") &&
    entrada.sourceIncidentId == null
  ) {
    throw new CalidadInvalida(
      "FALTA_LA_INCIDENCIA",
      "Una no conformidad que sale del libro tiene que decir de qué incidencia sale.",
    );
  }
  if (entrada.sourceIncidentId != null) {
    const incidencia = await prisma.incident.findFirst({
      where: { id: entrada.sourceIncidentId, tenantId },
      select: { id: true },
    });
    if (incidencia == null) {
      throw new CalidadInvalida(
        "INCIDENCIA_NO_ENCONTRADA",
        "Esa incidencia no existe en este centro.",
      );
    }
  }
  if (entrada.origin === "INDICATOR" && entrada.sourceIndicatorCode == null) {
    throw new CalidadInvalida(
      "FALTA_EL_INDICADOR",
      "Una no conformidad que sale de un indicador tiene que decir de cuál y de qué mes.",
    );
  }

  const dek = await asegurarDek(tenantId, prisma);
  const anio = entrada.detectedOn.slice(0, 4);

  // Dos intentos: el segundo recuenta tras perder la carrera del índice
  // único. Un tercero no haría falta ni con dos personas tecleando a la
  // vez — y si hiciera falta, el 409 dice que se vuelva a intentar.
  for (let intento = 0; intento < 2; intento++) {
    const cuantas = await prisma.nonConformity.count({
      where: { tenantId, reference: { startsWith: `NC-${anio}-` } },
    });
    const reference = `NC-${anio}-${String(cuantas + 1 + intento).padStart(2, "0")}`;
    const id = nuevoIdDeFila();
    try {
      await prisma.nonConformity.create({
        data: {
          id,
          tenantId,
          processId: entrada.processId,
          reference,
          kind: entrada.kind,
          origin: entrada.origin,
          state: "OPEN",
          isoClause: entrada.isoClause ?? null,
          detectedOn: entrada.detectedOn,
          descriptionCifrado: cifrarTexto(
            entrada.descripcion,
            dek,
            sitioDescripcionDeNc(tenantId, id),
          )!,
          sourceIncidentId: entrada.sourceIncidentId ?? null,
          sourceIndicatorCode: entrada.sourceIndicatorCode ?? null,
          sourceIndicatorMonth: entrada.sourceIndicatorMonth ?? null,
          sourceNote: entrada.sourceNote ?? null,
          openedAt: ahora,
          openedByUserId: firma.userId,
          openedByCareRoleAssignmentId: firma.careRoleAssignmentId,
        },
      });
      return { id, reference };
    } catch (err) {
      const codigo = (err as { code?: string }).code;
      if (codigo === "P2002" && intento === 0) continue;
      throw err;
    }
  }
  throw new CalidadInvalida(
    "REFERENCIA_OCUPADA",
    "Alguien estaba abriendo otra no conformidad a la vez. Vuelve a intentarlo.",
  );
}

// ════════════════════════════════════════════════════════════════════
//  5 · EL CICLO
// ════════════════════════════════════════════════════════════════════

/** Lo que hay que leer de una NC para decidir qué puede hacer ahora. */
async function paraElCiclo(
  prisma: PrismaClient,
  tenantId: string,
  id: string,
): Promise<{ nc: NcParaElCiclo; fila: { id: string; state: EstadoDeNc } }> {
  const fila = await prisma.nonConformity.findFirst({
    where: { id, tenantId },
    select: { id: true, state: true, kind: true, causeCifrado: true },
  });
  if (fila == null) {
    throw new CalidadInvalida(
      "NC_NO_ENCONTRADA",
      "Esa no conformidad no existe en este centro.",
    );
  }
  const [acciones, abiertas, eficaces] = await Promise.all([
    prisma.correctiveAction.count({ where: { tenantId, nonConformityId: id } }),
    prisma.correctiveAction.count({
      where: { tenantId, nonConformityId: id, closedAt: null },
    }),
    prisma.effectivenessVerification.count({
      where: { tenantId, nonConformityId: id, result: "EFFECTIVE" },
    }),
  ]);
  return {
    nc: {
      estado: fila.state,
      clase: fila.kind,
      tieneCausa: fila.causeCifrado != null,
      acciones,
      accionesAbiertas: abiertas,
      verificadaEficaz: eficaces > 0,
    },
    fila: { id: fila.id, state: fila.state },
  };
}

/** El estado de una NC y qué le falta para cada paso, para la pantalla. */
export async function estadoDelCiclo(
  prisma: PrismaClient,
  tenantId: string,
  id: string,
): Promise<{
  ciclo: NcParaElCiclo;
  siguiente: Array<{ destino: EstadoDeNc; falta: string | null }>;
}> {
  const { nc } = await paraElCiclo(prisma, tenantId, id);
  const posibles: EstadoDeNc[] = [
    "CAUSE_ANALYSED",
    "ACTIONS",
    "ACTIONS_CLOSED",
    "CLOSED",
  ];
  return {
    ciclo: nc,
    siguiente: posibles.map((destino) => ({
      destino,
      falta: loQueFaltaPara(nc, destino),
    })),
  };
}

/** Escribe la causa. **Una sola vez**: el trigger no deja reescribirla. */
export async function analizarCausa(
  prisma: PrismaClient,
  tenantId: string,
  id: string,
  causa: string,
): Promise<void> {
  const { nc } = await paraElCiclo(prisma, tenantId, id);
  if (nc.tieneCausa) {
    throw new CalidadInvalida(
      "CAUSA_YA_ANALIZADA",
      "Esta no conformidad ya tiene la causa analizada, y una causa no se reescribe. Lo que se aprende después se escribe como acción.",
    );
  }
  if (nc.estado !== "OPEN") {
    throw new CalidadInvalida(
      "FUERA_DE_CICLO",
      "La causa se analiza con la no conformidad recién abierta.",
    );
  }
  const dek = await asegurarDek(tenantId, prisma);
  await prisma.nonConformity.update({
    where: { id },
    data: {
      causeCifrado: cifrarTexto(causa, dek, sitioCausaDeNc(tenantId, id)),
      state: "CAUSE_ANALYSED",
    },
  });
}

/**
 * Mueve la NC al estado pedido, **si el ciclo lo permite**.
 *
 * `CLOSED` no entra por aquí: cerrar es consecuencia de una verificación
 * eficaz y lo hace `verificarEficacia`. Pedirlo a mano se rechaza con la
 * frase del paquete puro — y además lo pararía el trigger.
 */
export async function avanzarCiclo(
  prisma: PrismaClient,
  tenantId: string,
  id: string,
  destino: EstadoDeNc,
): Promise<void> {
  const { nc } = await paraElCiclo(prisma, tenantId, id);
  const falta = loQueFaltaPara(nc, destino);
  if (falta != null) throw new CalidadInvalida("FALTA_ALGO", falta);
  if (destino === "CLOSED") {
    throw new CalidadInvalida(
      "SE_CIERRA_VERIFICANDO",
      "Una no conformidad se cierra escribiendo la verificación de eficacia, no cambiándole el estado.",
    );
  }
  await prisma.nonConformity.update({ where: { id }, data: { state: destino } });
}

// ── 5.1 · Las acciones ───────────────────────────────────────────────

export interface AccionNueva {
  que: string;
  dueOn: string;
  responsibleCareRoleId?: string | null;
  responsibleUserId?: string | null;
  responsibleLabel?: string | null;
}

export async function escribirAccion(
  prisma: PrismaClient,
  tenantId: string,
  ncId: string,
  entrada: AccionNueva,
  firma: Firma,
  ahora: Date,
): Promise<string> {
  const { nc } = await paraElCiclo(prisma, tenantId, ncId);
  if (nc.estado === "CLOSED") {
    throw new CalidadInvalida(
      "NC_CERRADA",
      "Esta no conformidad está cerrada. Si el problema vuelve, se abre otra.",
    );
  }
  if (nc.estado === "OPEN" && exigeCausa(nc.clase)) {
    throw new CalidadInvalida(
      "FALTA_LA_CAUSA",
      "Una no conformidad mayor o menor no lleva acciones hasta que se analiza la causa.",
    );
  }
  const cuantos = [
    entrada.responsibleCareRoleId,
    entrada.responsibleUserId,
    entrada.responsibleLabel,
  ].filter((v) => v != null && v !== "").length;
  if (cuantos !== 1) {
    throw new CalidadInvalida(
      "RESPONSABLE",
      "Una acción lleva exactamente un responsable: un rol de cuidado, una persona o una etiqueta.",
    );
  }

  const dek = await asegurarDek(tenantId, prisma);
  const id = nuevoIdDeFila();
  await prisma.$transaction(async (tx) => {
    await tx.correctiveAction.create({
      data: {
        id,
        tenantId,
        nonConformityId: ncId,
        whatCifrado: cifrarTexto(
          entrada.que,
          dek,
          sitioTextoDeAccionCorrectiva(tenantId, id),
        )!,
        responsibleCareRoleId: entrada.responsibleCareRoleId || null,
        responsibleUserId: entrada.responsibleUserId || null,
        responsibleLabel: entrada.responsibleLabel || null,
        dueOn: entrada.dueOn,
        openedAt: ahora,
        openedByUserId: firma.userId,
        openedByCareRoleAssignmentId: firma.careRoleAssignmentId,
      },
    });
    // **ESCRIBIR LA PRIMERA ACCIÓN *ES* PASAR A ACCIONES.**
    //
    // No hay un botón «pasar a acciones» aparte, y es deliberado: un
    // estado que hay que empujar a mano después de haber hecho el
    // trabajo es un estado que se queda atrás, y entonces el panel
    // cuenta mal. El sembrador de este mismo bloque fue el primero en
    // tropezar con el orden —escribió el avance antes que la acción— y
    // eso es exactamente lo que le pasaría a quien use la pantalla.
    //
    // Desde `OPEN` sólo salta en una observación o una oportunidad de
    // mejora: las que no exigen causa (D-73). En una NC mayor o menor,
    // la comprobación de arriba ya ha rechazado la acción.
    if (nc.estado === "CAUSE_ANALYSED" || nc.estado === "OPEN") {
      await tx.nonConformity.update({
        where: { id: ncId },
        data: { state: "ACTIONS" },
      });
    }
  });
  return id;
}

export async function cerrarAccion(
  prisma: PrismaClient,
  tenantId: string,
  accionId: string,
  nota: string | null,
  firma: Firma,
  ahora: Date,
): Promise<void> {
  const accion = await prisma.correctiveAction.findFirst({
    where: { id: accionId, tenantId },
    select: { id: true, closedAt: true },
  });
  if (accion == null) {
    throw new CalidadInvalida(
      "ACCION_NO_ENCONTRADA",
      "Esa acción no existe en este centro.",
    );
  }
  if (accion.closedAt != null) {
    throw new CalidadInvalida(
      "ACCION_YA_CERRADA",
      "Esa acción ya está cerrada, y una acción cerrada no se reabre.",
    );
  }
  const dek = await asegurarDek(tenantId, prisma);
  await prisma.correctiveAction.update({
    where: { id: accionId },
    data: {
      closedAt: ahora,
      closedByUserId: firma.userId,
      closedByCareRoleAssignmentId: firma.careRoleAssignmentId,
      closingNoteCifrado: cifrarTexto(
        nota,
        dek,
        sitioCierreDeAccionCorrectiva(tenantId, accionId),
      ),
    },
  });
}

/** Una evidencia: un fichero ya guardado, una nota, o las dos. */
export async function anotarEvidencia(
  prisma: PrismaClient,
  tenantId: string,
  accionId: string,
  entrada: {
    nota?: string | null;
    fichero?: { fileName: string; sha256: string; bytes: number; mimeType: string } | null;
  },
  firma: Firma,
  ahora: Date,
): Promise<string> {
  if (
    (entrada.nota == null || entrada.nota === "") &&
    entrada.fichero == null
  ) {
    throw new CalidadInvalida(
      "EVIDENCIA_VACIA",
      "Una evidencia es un documento, una nota o las dos. Vacía no prueba nada.",
    );
  }
  const dek = await asegurarDek(tenantId, prisma);
  const id = nuevoIdDeFila();
  await prisma.correctiveActionEvidence.create({
    data: {
      id,
      tenantId,
      actionId: accionId,
      fileName: entrada.fichero?.fileName ?? null,
      sha256: entrada.fichero?.sha256 ?? null,
      bytes: entrada.fichero?.bytes ?? null,
      mimeType: entrada.fichero?.mimeType ?? null,
      noteCifrado: cifrarTexto(
        entrada.nota ?? null,
        dek,
        sitioNotaDeEvidencia(tenantId, id),
      ),
      at: ahora,
      byUserId: firma.userId,
      byCareRoleAssignmentId: firma.careRoleAssignmentId,
    },
  });
  return id;
}

// ── 5.2 · La verificación de eficacia, que es la pieza del bloque ────

/**
 * **VERIFICA LA EFICACIA Y MUEVE LA NC.**
 *
 * `EFFECTIVE` la cierra; `NOT_EFFECTIVE` la devuelve a acciones, y las
 * dos verificaciones quedan — ese rastro es lo que enseña que el primer
 * intento no funcionó, y es justo lo que una carpeta de Word borra.
 *
 * Las dos reglas duras (persona distinta de quien cerró la última
 * acción, y que haya alguna acción cerrada) **las comprueba el trigger**
 * y no este código. Aquí se comprueban igual, pero sólo para contestar
 * una frase en vez de un 500: si alguien las rodea, el motor sigue
 * delante.
 */
export async function verificarEficacia(
  prisma: PrismaClient,
  tenantId: string,
  ncId: string,
  entrada: { resultado: ResultadoDeVerificacion; nota: string },
  firma: Firma,
  ahora: Date,
): Promise<{ estado: EstadoDeNc }> {
  const { nc } = await paraElCiclo(prisma, tenantId, ncId);
  if (nc.estado !== "ACTIONS_CLOSED") {
    throw new CalidadInvalida(
      "FUERA_DE_CICLO",
      "La eficacia se verifica con las acciones ya cerradas.",
    );
  }
  const ultima = await prisma.correctiveAction.findFirst({
    where: { tenantId, nonConformityId: ncId, closedAt: { not: null } },
    orderBy: { closedAt: "desc" },
    select: { closedByUserId: true },
  });
  if (ultima == null) {
    throw new CalidadInvalida(
      "SIN_ACCIONES_CERRADAS",
      "No hay ninguna acción cerrada. No se verifica la eficacia de lo que no se ha hecho.",
    );
  }
  if (ultima.closedByUserId === firma.userId) {
    throw new CalidadInvalida(
      "VERIFICA_OTRA_PERSONA",
      "La eficacia la verifica una persona distinta de quien cerró la última acción. Quien hizo la cosa no certifica que la cosa funcionó.",
    );
  }

  const dek = await asegurarDek(tenantId, prisma);
  const id = nuevoIdDeFila();
  const estado = estadoTrasVerificar(entrada.resultado);

  await prisma.$transaction(async (tx) => {
    await tx.effectivenessVerification.create({
      data: {
        id,
        tenantId,
        nonConformityId: ncId,
        result: entrada.resultado,
        noteCifrado: cifrarTexto(
          entrada.nota,
          dek,
          sitioNotaDeVerificacion(tenantId, id),
        )!,
        at: ahora,
        byUserId: firma.userId,
        byCareRoleAssignmentId: firma.careRoleAssignmentId,
      },
    });
    await tx.nonConformity.update({
      where: { id: ncId },
      data:
        estado === "CLOSED"
          ? {
              state: "CLOSED",
              closedAt: ahora,
              closedByUserId: firma.userId,
              closedByCareRoleAssignmentId: firma.careRoleAssignmentId,
            }
          : { state: "ACTIONS" },
    });
  });

  return { estado };
}

/** El `select` de una NC con todo lo que la pantalla y el PAC pintan. */
export const NC_SELECT = {
  id: true,
  reference: true,
  kind: true,
  origin: true,
  state: true,
  isoClause: true,
  detectedOn: true,
  descriptionCifrado: true,
  causeCifrado: true,
  sourceIncidentId: true,
  sourceIndicatorCode: true,
  sourceIndicatorMonth: true,
  sourceNote: true,
  reportFileName: true,
  reportBytes: true,
  openedAt: true,
  closedAt: true,
  process: { select: { id: true, name: true, type: true } },
  openedBy: { select: { alias: true, email: true } },
  openedWith: { select: { careRole: { select: { name: true } } } },
  closedBy: { select: { alias: true, email: true } },
} satisfies Prisma.NonConformitySelect;
