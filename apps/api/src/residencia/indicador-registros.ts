// calidad-1 (D-72, 07-calidad-iso §2) · **DE QUÉ REGISTROS SALE UN
// INDICADOR, Y PODER ABRIRLO.**
//
// «Cada indicador: valor del periodo, umbral, tendencia y **de qué
// registros sale (se puede abrir)**.» Esto es el «se puede abrir».
//
// ── POR QUÉ UNA TABLA GENÉRICA Y NO TRECE RESPUESTAS ────────────────
//
// Cada indicador sale de una tabla distinta —incidencias, registros de
// cuidados, asignaciones de cama, empleados— y pintar cada una con su
// forma habría sido trece componentes de pantalla. Lo que devuelve esto
// es **una tabla**: título, columnas y filas de texto, más una nota que
// explica el denominador.
//
// La alternativa (un tipo por indicador) daba pantallas más bonitas y
// trece sitios donde el día que se añada el catorce hay que acordarse de
// escribir uno más. Con la tabla genérica, añadir un indicador es añadir
// un `case` aquí y nada en la pantalla.
//
// ── Y LO QUE SE ENSEÑA ES LO QUE FALTA ──────────────────────────────
//
// En los porcentajes de cumplimiento, la lista **no** son las que se
// hicieron: son las que NO. Un auditor que abre «participación en la
// gimnasia 75 %» no quiere ver las ciento cincuenta que se hicieron,
// quiere ver las cincuenta que no — y la supervisora tampoco.

import type { PrismaClient } from "@mipiacetpv/db";
import {
  PLAZO_DE_QUEJA_DIAS,
  cuantoVaHecho,
  loQueNoSeHizo,
  queToca,
  utcToWallDate,
  wallTimeToUtc,
  type ControlParaNoHecho,
  type RegistroHecho,
} from "@mipiacetpv/residencia-plan";

import { FRECUENCIA_SELECT, deColumnas } from "./frecuencia-columnas.js";
import { recogerDatosDelMes } from "./panel.js";

/** Lo que la pantalla pinta: una tabla y una explicación. */
export interface TablaDeRegistros {
  titulo: string;
  /** Qué quiere decir esta lista y de qué es el denominador. */
  nota: string;
  columnas: string[];
  filas: string[][];
  /** Cuántas hay en total; `filas` puede venir recortada. */
  total: number;
}

const TOPE = 300;

/** El primer día del mes siguiente, «YYYY-MM-DD». */
function mesSiguiente(mes: string): string {
  const anio = Number(mes.slice(0, 4));
  const m = Number(mes.slice(5, 7));
  return m === 12 ? `${anio + 1}-01-01` : `${anio}-${String(m + 1).padStart(2, "0")}-01`;
}

/**
 * Los registros de los que sale un indicador en un mes.
 *
 * `null` cuando el código no es de los que se calculan: la ruta contesta
 * 404 en vez de una tabla vacía, que parecería «no hubo ninguno».
 */
export async function registrosDeIndicador(
  prisma: PrismaClient,
  tenantId: string,
  code: string,
  mes: string,
  ahora: Date,
): Promise<TablaDeRegistros | null> {
  const primero = `${mes}-01`;
  const siguiente = mesSiguiente(mes);
  const desde = wallTimeToUtc(primero, "00:00");
  const hasta = wallTimeToUtc(siguiente, "00:00");

  /** El nombre de un residente, para la tabla. */
  const nombreDe = async (ids: string[]): Promise<Map<string, string>> => {
    if (ids.length === 0) return new Map();
    const cs = await prisma.client.findMany({
      where: { tenantId, id: { in: [...new Set(ids)] } },
      select: { id: true, firstName: true, lastName: true },
    });
    return new Map(cs.map((c) => [c.id, `${c.firstName} ${c.lastName}`.trim()]));
  };

  switch (code) {
    // ── Los que son una lista de incidencias del libro ─────────────
    case "SIN_DEPOSICION":
    case "CAIDAS": {
      const tipo = code === "CAIDAS" ? "CAIDA" : "SIN_DEPOSICION";
      const filas = await prisma.incident.findMany({
        where: { tenantId, incidentType: tipo, openedAt: { gte: desde, lt: hasta } },
        orderBy: { openedAt: "asc" },
        take: TOPE,
        select: {
          careDay: true,
          severity: true,
          origin: true,
          clientId: true,
          open: true,
        },
      });
      const nombres = await nombreDe(
        filas.map((f) => f.clientId).filter((x): x is string => x != null),
      );
      return {
        titulo: code === "CAIDAS" ? "Las caídas del mes" : "Los episodios del mes",
        nota: "Una fila por incidencia del libro único. Un recuento de cero es un cero: no hay denominador que valga null.",
        columnas: ["Día", "Residente", "Nivel", "Origen", "Estado"],
        total: filas.length,
        filas: filas.map((f) => [
          f.careDay,
          f.clientId == null ? "—" : (nombres.get(f.clientId) ?? "—"),
          f.severity,
          f.origin === "DECLARED" ? "Declarada" : "Derivada",
          f.open ? "Abierta" : "Cerrada",
        ]),
      };
    }

    case "AVERIAS_24H": {
      const filas = await prisma.incident.findMany({
        where: { tenantId, subject: "MAINTENANCE", openedAt: { gte: desde, lt: hasta } },
        orderBy: { openedAt: "asc" },
        take: TOPE,
        select: { careDay: true, openedAt: true, closedAt: true, severity: true },
      });
      return {
        titulo: "Las averías del mes",
        nota: "Una avería SIN CERRAR cuenta como fuera de plazo en cuanto pasa de 24 h: lo contrario haría que un centro que no cierra ninguna saliera con el mejor resultado posible.",
        columnas: ["Día", "Nivel", "Horas", "¿En plazo?"],
        total: filas.length,
        filas: filas.map((f) => {
          const horas =
            f.closedAt == null
              ? null
              : (f.closedAt.getTime() - f.openedAt.getTime()) / 3_600_000;
          return [
            f.careDay,
            f.severity,
            horas == null ? "sin cerrar" : horas.toFixed(1),
            horas == null || horas > 24 ? "NO" : "sí",
          ];
        }),
      };
    }

    case "QUEJAS":
    case "QUEJAS_EN_PLAZO": {
      const filas = await prisma.incident.findMany({
        where: { tenantId, subject: "COMPLAINT", openedAt: { gte: desde, lt: hasta } },
        orderBy: { openedAt: "asc" },
        take: TOPE,
        select: { careDay: true, openedAt: true, closedAt: true, clientId: true },
      });
      const nombres = await nombreDe(
        filas.map((f) => f.clientId).filter((x): x is string => x != null),
      );
      return {
        titulo: "Las quejas del mes",
        nota: `El plazo del producto son ${PLAZO_DE_QUEJA_DIAS} días naturales desde que se abre hasta que se cierra con su respuesta. Una sin responder cuenta fuera de plazo.`,
        columnas: ["Día", "De", "Días hasta la respuesta", "¿En plazo?"],
        total: filas.length,
        filas: filas.map((f) => {
          const dias =
            f.closedAt == null
              ? null
              : (f.closedAt.getTime() - f.openedAt.getTime()) / 86_400_000;
          return [
            f.careDay,
            f.clientId == null ? "Familia" : (nombres.get(f.clientId) ?? "—"),
            dias == null ? "sin responder" : dias.toFixed(1),
            dias != null && dias <= PLAZO_DE_QUEJA_DIAS ? "sí" : "NO",
          ];
        }),
      };
    }

    case "FAMILIA_COMUNICADA": {
      const filas = await prisma.incident.findMany({
        where: { tenantId, subject: "RESIDENT", closedAt: { gte: desde, lt: hasta } },
        orderBy: { closedAt: "asc" },
        take: TOPE,
        select: {
          careDay: true,
          incidentType: true,
          clientId: true,
          closedAt: true,
          familyCommunications: { select: { kind: true, at: true } },
        },
      });
      const nombres = await nombreDe(
        filas.map((f) => f.clientId).filter((x): x is string => x != null),
      );
      return {
        titulo: "Las incidencias de residente cerradas este mes",
        nota: "Cuenta un COMUNICADO fechado ANTES del cierre. Un «no comunicado: motivo» es constancia válida para cerrar (residencia-4) pero no cuenta aquí: si contara, marcar todo «no procede» daría el 100 %.",
        columnas: ["Día", "Residente", "Tipo", "Familia"],
        total: filas.length,
        filas: filas.map((f) => {
          const comunicada = f.familyCommunications.some(
            (c) =>
              c.kind === "COMUNICADO" &&
              f.closedAt != null &&
              c.at.getTime() <= f.closedAt.getTime(),
          );
          const hayConstancia = f.familyCommunications.length > 0;
          return [
            f.careDay,
            f.clientId == null ? "—" : (nombres.get(f.clientId) ?? "—"),
            f.incidentType,
            comunicada
              ? "comunicada"
              : hayConstancia
                ? "NO comunicada (con motivo)"
                : "SIN CONSTANCIA",
          ];
        }),
      };
    }

    case "VISITA_MEDICA": {
      // **Los que FALTAN**, no los que están: lo que la dirección
      // necesita en el día 28 del mes es la lista de a quién hay que
      // citar, no la de a quién ya se vio.
      const [ocupaciones, vistos] = await Promise.all([
        prisma.bedAssignment.findMany({
          where: {
            tenantId,
            OR: [{ toAt: null }, { toAt: { gte: desde } }],
            fromAt: { lt: hasta },
          },
          select: { clientId: true },
          distinct: ["clientId"],
        }),
        prisma.careRecord.findMany({
          where: {
            tenantId,
            controlCode: "VISITA_MEDICA",
            careDay: { gte: primero, lt: siguiente },
            voidedAt: null,
          },
          select: { clientId: true },
          distinct: ["clientId"],
        }),
      ]);
      const conVisita = new Set(vistos.map((v) => v.clientId));
      const faltan = ocupaciones
        .map((o) => o.clientId)
        .filter((id) => !conVisita.has(id));
      const nombres = await nombreDe(faltan);
      return {
        titulo: "Residentes que este mes NO ha visto el médico",
        nota: `${conVisita.size} de ${ocupaciones.length} residentes tienen al menos una visita médica registrada este mes. Aquí salen los que no.`,
        columnas: ["Residente"],
        total: faltan.length,
        filas: faltan.slice(0, TOPE).map((id) => [nombres.get(id) ?? "—"]),
      };
    }

    case "ACTIVIDADES_SOCIOCULTURALES": {
      const filas = await prisma.careRecord.findMany({
        where: {
          tenantId,
          controlCode: "ACTIVIDAD_SOCIOCULTURAL",
          careDay: { gte: primero, lt: siguiente },
          voidedAt: null,
        },
        orderBy: { recordedAt: "asc" },
        take: TOPE,
        select: {
          careDay: true,
          clientId: true,
          centerShift: { select: { name: true } },
        },
      });
      const nombres = await nombreDe(filas.map((f) => f.clientId));
      return {
        titulo: "Las actividades socioculturales registradas",
        nota: "Una fila por registro de la puerta. Lo que se cuenta son registros, no sesiones distintas.",
        columnas: ["Día", "Turno", "Residente"],
        total: filas.length,
        filas: filas.map((f) => [
          f.careDay,
          f.centerShift?.name ?? "—",
          nombres.get(f.clientId) ?? "—",
        ]),
      };
    }

    // ── Los tres que salen del CRUCE con el plan ───────────────────
    case "GIMNASIA":
    case "ESTIMULACION_COGNITIVA":
    case "CUMPLIMENTACION_REGISTROS": {
      const tabla = await loQueNoSeHizoDelMes(
        prisma,
        tenantId,
        mes,
        ahora,
        code === "CUMPLIMENTACION_REGISTROS" ? null : code,
      );
      return tabla;
    }

    case "OCUPACION_MEDIA": {
      const { datos } = await recogerDatosDelMes(prisma, tenantId, mes, ahora);
      const asignaciones = await prisma.bedAssignment.findMany({
        where: {
          tenantId,
          OR: [{ toAt: null }, { toAt: { gte: desde } }],
          fromAt: { lt: hasta },
        },
        orderBy: { fromAt: "asc" },
        take: TOPE,
        select: {
          clientId: true,
          fromAt: true,
          toAt: true,
          bed: { select: { label: true, room: { select: { number: true } } } },
        },
      });
      const nombres = await nombreDe(asignaciones.map((a) => a.clientId));
      return {
        titulo: "Las ocupaciones que tocan el mes",
        nota: `${datos.ocupacion.ocupadasDia} camas-día ocupadas de ${datos.ocupacion.camasDia} disponibles, contando sólo los días que ya han pasado. Las camas se cuentan a día de hoy: la tabla de camas no guarda histórico, y reconstruir cuántas había el día 3 sería inventárselo.`,
        columnas: ["Residente", "Cama", "Desde", "Hasta"],
        total: asignaciones.length,
        filas: asignaciones.map((a) => [
          nombres.get(a.clientId) ?? "—",
          a.bed == null ? "—" : `${a.bed.room.number}-${a.bed.label}`,
          utcToWallDate(a.fromAt),
          a.toAt == null ? "sigue" : utcToWallDate(a.toAt),
        ]),
      };
    }

    case "ROTACION_PERSONAL": {
      const bajas = await prisma.employee.findMany({
        where: { tenantId, deactivatedAt: { gte: desde, lt: hasta } },
        orderBy: { deactivatedAt: "asc" },
        take: TOPE,
        select: { name: true, deactivatedAt: true },
      });
      const activos = await prisma.employee.count({ where: { tenantId, active: true } });
      return {
        titulo: "Las bajas de personal del mes",
        nota: `El denominador es la plantilla del periodo, aproximada como los ${activos} activos al cierre más las ${bajas.length} bajas del mes. Es una aproximación y está dicha: la tabla de personal no guarda la plantilla día a día.`,
        columnas: ["Persona", "Baja el"],
        total: bajas.length,
        filas: bajas.map((b) => [
          b.name,
          b.deactivatedAt == null ? "—" : utcToWallDate(b.deactivatedAt),
        ]),
      };
    }

    default:
      return null;
  }
}

/**
 * **LO QUE NO SE HIZO**, del mismo cruce que el parte de relevo.
 *
 * `soloControl` filtra a un control (la gimnasia); `null` son todos, que
 * es la cumplimentación de los registros de atención directa (R9).
 *
 * Es la función que hace que el indicador y el parte **no se puedan
 * contradecir para el mismo turno**: las dos llaman a `queToca` y a
 * `loQueNoSeHizo` con los mismos datos.
 */
async function loQueNoSeHizoDelMes(
  prisma: PrismaClient,
  tenantId: string,
  mes: string,
  ahora: Date,
  soloControl: string | null,
): Promise<TablaDeRegistros> {
  const primero = `${mes}-01`;
  const siguiente = mesSiguiente(mes);
  const desde = wallTimeToUtc(primero, "00:00");
  const hasta = wallTimeToUtc(siguiente, "00:00");
  const corte = hasta.getTime() < ahora.getTime() ? hasta : ahora;

  const [controles, ajustes, turnos, momentos, plan, registros] =
    await Promise.all([
      prisma.controlType.findMany({
        where: { supersededAt: null, OR: [{ scope: "STANDARD" }, { scope: "CENTER", tenantId }] },
        select: { code: true, name: true, layer: true, nature: true },
      }),
      prisma.centerControlSetting.findMany({
        where: { tenantId },
        select: { controlCode: true, active: true },
      }),
      prisma.centerShift.findMany({
        where: { tenantId },
        orderBy: [{ sortOrder: "asc" }],
        select: { id: true, code: true, name: true, startsAt: true, endsAt: true },
      }),
      prisma.centerMoment.findMany({
        where: { tenantId },
        select: { code: true, name: true, atTime: true },
      }),
      prisma.carePlanItem.findMany({
        where: { tenantId },
        select: {
          id: true,
          clientId: true,
          controlCode: true,
          fromAt: true,
          toAt: true,
          ...FRECUENCIA_SELECT,
        },
      }),
      prisma.careRecord.findMany({
        where: { tenantId, careDay: { gte: primero, lt: siguiente } },
        select: {
          clientId: true,
          controlCode: true,
          careDay: true,
          occurrenceAt: true,
          recordedAt: true,
          voidedAt: true,
          centerShift: { select: { code: true } },
        },
      }),
    ]);

  const paraControles: ControlParaNoHecho[] = controles.map((c) => ({
    code: c.code,
    layer: c.layer,
    nature: c.nature,
  }));
  const nombreDeControl = new Map(controles.map((c) => [c.code, c.name]));
  const hechos: RegistroHecho[] = registros.map((r) => ({
    clientId: r.clientId,
    controlCode: r.controlCode,
    careDay: r.careDay,
    shiftCode: r.centerShift?.code ?? null,
    occurrenceAt: r.occurrenceAt,
    recordedAt: r.recordedAt,
    voidedAt: r.voidedAt,
  }));

  const todas = queToca(
    plan.map((l) => ({
      id: l.id,
      clientId: l.clientId,
      controlCode: l.controlCode,
      frecuencia: deColumnas(l),
      fromAt: l.fromAt,
      toAt: l.toAt,
    })),
    ajustes.map((a) => ({ controlCode: a.controlCode, active: a.active })),
    turnos,
    momentos,
    desde,
    corte,
  );
  const ocurrencias =
    soloControl == null ? todas : todas.filter((o) => o.controlCode === soloControl);

  const { tocan, hechas } = cuantoVaHecho({
    ocurrencias,
    registros: hechos,
    controles: paraControles,
  });
  const noHechas = loQueNoSeHizo({
    ocurrencias,
    registros: hechos,
    controles: paraControles,
    corte: new Date(8_640_000_000_000_000),
  });

  const nombres = new Map<string, string>();
  if (noHechas.length > 0) {
    const cs = await prisma.client.findMany({
      where: { tenantId, id: { in: [...new Set(noHechas.map((n) => n.clientId))] } },
      select: { id: true, firstName: true, lastName: true },
    });
    for (const c of cs) nombres.set(c.id, `${c.firstName} ${c.lastName}`.trim());
  }

  return {
    titulo:
      soloControl == null
        ? "Lo que tocaba y no se anotó"
        : `${nombreDeControl.get(soloControl) ?? soloControl}: lo que tocaba y no se hizo`,
    nota: `De ${tocan} ocurrencias que tocaban se registraron ${hechas}. Sale del MISMO cruce que el parte de relevo, así que esta lista y el parte no se pueden contradecir para el mismo turno. El mes en curso se mide hasta ahora, no hasta fin de mes.`,
    columnas: ["Día", "Turno", "Residente", "Control"],
    total: noHechas.length,
    filas: noHechas
      .slice(0, TOPE)
      .map((n) => [
        n.dia,
        n.shiftCode ?? "—",
        nombres.get(n.clientId) ?? "—",
        nombreDeControl.get(n.controlCode) ?? n.controlCode,
      ]),
  };
}
