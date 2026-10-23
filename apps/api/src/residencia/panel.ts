// residencia-5 (decisión de producto 5, bloque C §1-2) · **EL PANEL DE
// DIRECCIÓN, POR DENTRO.**
//
// Hoy la dirección se entera de lo que hay abierto preguntando. El panel
// es **una pantalla** que contesta cuatro preguntas sin preguntar a
// nadie, en el orden de la urgencia:
//
//   1. **Qué hay abierto hoy** — la métrica de éxito de dirección
//      (bloque C §2, rama §6.3).
//   2. **Relevos** — el del último cambio de turno y los no confirmados
//      de la semana.
//   3. **Qué toca hoy y qué está vencido** de las obligaciones, y lo que
//      vence en 60 días (está en `obligaciones.ts`).
//   4. **El turno en curso** — cuánto del plan va hecho por planta, y lo
//      no hecho de los turnos cerrados hoy.
//   5. **Indicadores** — los seis que ya salen de lo registrado.
//
// ── EL PRESUPUESTO DE LECTURA MANDA (bloque C §1) ───────────────────
//
// «Cualquier dato en menos de 10 segundos y 3 toques.» De ahí sale la
// forma de este fichero: **una sola llamada** devuelve el panel entero.
//
// La alternativa —cinco rutas, una por bloque— habría sido más limpia de
// leer y habría costado cinco idas a la base en serie desde el navegador,
// con la cascada de latencia de cada una. Con una, el panel es un toque y
// una espera; y las consultas de dentro van en `Promise.all`.
//
// Lo que NO hace esta función es traer las LISTAS enteras: cada cifra
// abre su lista, y esa lista es su propia ruta (las de residencia-4 para
// el libro, las de aquí para los relevos y las obligaciones). Traerlas
// todas sería mandar al navegador el libro entero para pintar un número.

import type { PrismaClient } from "@mipiacetpv/db";
import {
  addDays,
  calcularIndicadores,
  pinPorRenovar,
  cuantoVaHecho,
  diaDelTurno,
  estaConfirmado,
  loQueNoSeHizo,
  queToca,
  turnoDe,
  utcToWallDate,
  wallTimeToUtc,
  zonasSinConfirmar,
  type ControlParaNoHecho,
  type DatosDelMes,
  type RegistroHecho,
  type ValorDeIndicador,
} from "@mipiacetpv/residencia-plan";

import { FRECUENCIA_SELECT, deColumnas } from "./frecuencia-columnas.js";
import { ventanaDelTurno } from "./relevo.js";
import { obligacionesDelPanel, type OcurrenciaPintada } from "./obligaciones.js";

/** Lo que hay abierto hoy. La primera fila, y la métrica de éxito. */
export interface QueHayAbierto {
  /** Abiertas por nivel. N4 y N3 arriba. */
  porNivel: Array<{ nivel: string; cuantas: number }>;
  /** Avisos sin acuse que siguen vivos. */
  avisosSinAcuse: number;
  /** Incidencias de residente **sin constancia de familia** (D-32 a
   *  D-34): las que no se pueden cerrar hasta que alguien decida si se
   *  comunica o no. */
  sinConstanciaDeFamilia: number;
  /** N3-N4 abiertas que esperan que las cierre otra persona (D-28). */
  esperandoCierreDeOtro: number;
  total: number;
}

/** El bloque de relevos. */
export interface RelevosDelPanel {
  ultimo: {
    id: string;
    careDay: string;
    turno: string;
    congeladoEn: string;
    lineas: number;
    sinNovedades: boolean;
    confirmado: boolean;
    confirmadoPor: Array<{ nombre: string; rol: string; at: string; alcanceTotal: boolean }>;
    zonasPorConfirmar: number;
  } | null;
  /** Los no confirmados de la semana. */
  sinConfirmar: Array<{
    id: string;
    careDay: string;
    turno: string;
    congeladoEn: string;
    lineas: number;
    zonasPorConfirmar: number;
  }>;
}

/** El turno en curso, por planta. */
export interface TurnoEnCurso {
  turno: { id: string; code: string; name: string } | null;
  careDay: string;
  plantas: Array<{
    floorId: string | null;
    nombre: string;
    tocan: number;
    hechas: number;
  }>;
  /** Lo no hecho de los turnos **cerrados** de hoy. */
  noHechoDeTurnosCerrados: number;
}

/**
 * residencia-6 · **LO QUE HAY QUE ARREGLAR.**
 *
 * Dos cosas que no son incidencias ni obligaciones y que dejan el centro
 * a medio configurar. Van juntas porque las dos tienen la misma forma —
 * «esto está mal puesto, y se arregla en Personal o en el plan» — y las
 * dos las arregla quien ve este panel.
 *
 *   · **PIN por renovar** (D-68): a alguien con PIN de cuatro cifras se
 *     le ha dado un rol que ve todo el centro. Su PIN **no abre nada**
 *     desde ese momento, así que esto no es un aviso de estilo: es una
 *     persona que no puede registrar hasta que dirección entre aquí.
 *   · **Residentes sin plan de cuidados** (punto 4 del bloque): un
 *     residente con cama y sin ninguna línea de plan vigente. No genera
 *     ni una línea de «no hecho» —no hay nada que incumplir— y eso es
 *     exactamente el problema: sin esta lista, un residente al que nadie
 *     le preparó el plan es invisible y sale perfecto en los
 *     indicadores.
 */
export interface PorArreglar {
  pinesPorRenovar: Array<{
    userId: string;
    nombre: string;
    /** Los roles de alcance total que le obligan a seis cifras. Se
     *  nombran: «Rosa · DUE» dice a la dirección por qué sale en la
     *  lista sin que tenga que abrir la ficha. */
    roles: string[];
  }>;
  residentesSinPlan: Array<{
    clientId: string;
    nombre: string;
    habitacion: string | null;
  }>;
}

export interface Panel {
  abierto: QueHayAbierto;
  relevos: RelevosDelPanel;
  obligaciones: {
    hoy: OcurrenciaPintada[];
    vencidas: OcurrenciaPintada[];
    proximas: OcurrenciaPintada[];
  };
  turno: TurnoEnCurso;
  /** residencia-6 · lo que está mal puesto y se arregla configurando. */
  porArreglar: PorArreglar;
  indicadores: ValorDeIndicador[];
  /** El mes de los indicadores, «YYYY-MM». */
  mes: string;
  /**
   * primer-acceso (punto 4) · **el centro no tiene todavía ni un
   * residente**, ni dentro ni dado de alta.
   *
   * Es lo que hace que el panel del primer día no sea cinco secciones
   * vacías sino una tarjeta con «Nuevo ingreso». Cuenta TODOS los
   * perfiles, también los de quien ya se fue: un centro del que se han
   * ido los 48 residentes no está empezando, está vacío por otra razón, y
   * enseñarle «empieza dando de alta a tus residentes» sería tratar un
   * cierre como un alta.
   */
  centroVacio: boolean;
  generadoEn: string;
}

/** Arma el panel entero. Una llamada. */
export async function construirPanel(
  prisma: PrismaClient,
  input: { tenantId: string; ahora: Date },
): Promise<Panel> {
  const { tenantId, ahora } = input;
  const hoy = utcToWallDate(ahora);
  const mes = hoy.slice(0, 7);

  const [
    abierto,
    relevos,
    obligaciones,
    turno,
    porArreglar,
    indicadores,
    cuantosResidentes,
  ] = await Promise.all([
    queHayAbierto(prisma, tenantId),
    relevosDelPanel(prisma, tenantId, ahora),
    obligacionesDelPanel(prisma, { tenantId, ahora }),
    turnoEnCurso(prisma, tenantId, ahora),
    loQueHayQueArreglar(prisma, tenantId, ahora),
    indicadoresDelMes(prisma, tenantId, mes, ahora),
    // Dentro del mismo `Promise.all`: un `count` sobre un índice de
    // tenant no mueve el presupuesto de los 10 segundos, y fuera habría
    // sido una ida más a la base en serie.
    prisma.residentProfile.count({ where: { tenantId } }),
  ]);

  return {
    abierto,
    relevos,
    obligaciones,
    turno,
    porArreglar,
    indicadores,
    mes,
    centroVacio: cuantosResidentes === 0,
    generadoEn: ahora.toISOString(),
  };
}

// ── residencia-6 · LO QUE HAY QUE ARREGLAR ───────────────────────────
//
// Dos consultas y ningún cálculo caro: ni recorre el plan ni cruza
// registros. Es lo que permite que entre en el `Promise.all` del panel
// sin mover el presupuesto de los 10 segundos (bloque C §1).

export async function loQueHayQueArreglar(
  prisma: PrismaClient,
  tenantId: string,
  ahora: Date,
): Promise<PorArreglar> {
  const [pins, ocupaciones] = await Promise.all([
    prisma.carePin.findMany({
      where: { tenantId },
      select: {
        userId: true,
        pinLength: true,
        user: {
          select: {
            alias: true,
            email: true,
            careRoleAssignments: {
              where: {
                revokedAt: null,
                careRole: { active: true, recordsCare: true },
              },
              select: {
                fromAt: true,
                toAt: true,
                careRole: { select: { name: true, fullScope: true } },
              },
            },
          },
        },
      },
    }),
    // Los residentes CON CAMA, con su habitación y si tienen alguna línea
    // de plan viva. El `some` con la vigencia dentro y no un `count`
    // aparte: lo que hace falta saber es si hay al menos una, y el motor
    // corta en la primera.
    prisma.bedAssignment.findMany({
      where: { tenantId, toAt: null },
      select: {
        clientId: true,
        bed: { select: { room: { select: { number: true } } } },
        client: {
          select: {
            firstName: true,
            lastName: true,
            carePlanItems: {
              where: {
                tenantId,
                fromAt: { lte: ahora },
                OR: [{ toAt: null }, { toAt: { gt: ahora } }],
              },
              select: { id: true },
              take: 1,
            },
          },
        },
      },
    }),
  ]);

  const pinesPorRenovar: PorArreglar["pinesPorRenovar"] = [];
  for (const p of pins) {
    const vivos = p.user.careRoleAssignments.filter(
      (a) => a.fromAt <= ahora && (a.toAt == null || a.toAt > ahora),
    );
    if (
      !pinPorRenovar({
        largoDelPin: p.pinLength,
        roles: vivos.map((a) => ({ alcanceTotal: a.careRole.fullScope })),
      })
    ) {
      continue;
    }
    pinesPorRenovar.push({
      userId: p.userId,
      nombre: p.user.alias ?? (p.user.email.split("@")[0] ?? p.user.email),
      roles: vivos
        .filter((a) => a.careRole.fullScope)
        .map((a) => a.careRole.name),
    });
  }

  const residentesSinPlan = ocupaciones
    .filter((o) => o.client.carePlanItems.length === 0)
    .map((o) => ({
      clientId: o.clientId,
      nombre: `${o.client.firstName} ${o.client.lastName}`.trim(),
      habitacion: o.bed.room.number,
    }));

  // Por nombre, que es como la dirección los busca.
  pinesPorRenovar.sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
  residentesSinPlan.sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));

  return { pinesPorRenovar, residentesSinPlan };
}

// ── 1 · QUÉ HAY ABIERTO HOY ──────────────────────────────────────────

async function queHayAbierto(
  prisma: PrismaClient,
  tenantId: string,
): Promise<QueHayAbierto> {
  const [porNivel, avisos, deResidente, abiertas] = await Promise.all([
    // `groupBy` y no cinco `count`: una ida a la base en vez de cinco, y
    // el índice parcial `WHERE open` de la migración la sostiene.
    prisma.incident.groupBy({
      by: ["severity"],
      where: { tenantId, open: true },
      _count: { _all: true },
    }),
    prisma.guardAlert.count({
      where: {
        tenantId,
        ackedAt: null,
        state: { in: ["PENDING", "DELIVERED", "ESCALATED"] },
      },
    }),
    // Las de residente abiertas, con cuántas constancias de familia
    // tiene cada una. Es lo que decide «sin constancia».
    prisma.incident.findMany({
      where: { tenantId, open: true, subject: "RESIDENT" },
      select: {
        id: true,
        severity: true,
        openedByUserId: true,
        _count: { select: { familyCommunications: true } },
      },
    }),
    prisma.incident.count({ where: { tenantId, open: true } }),
  ]);

  const cuenta = new Map(porNivel.map((g) => [g.severity, g._count._all]));
  return {
    // **N4 y N3 arriba**, que es el orden de la decisión de producto 5.
    porNivel: ["N4", "N3", "N2", "N1", "N0"].map((nivel) => ({
      nivel,
      cuantas: cuenta.get(nivel as never) ?? 0,
    })),
    avisosSinAcuse: avisos,
    sinConstanciaDeFamilia: deResidente.filter((i) => i._count.familyCommunications === 0)
      .length,
    // N3 y N4 las cierra OTRA persona (D-28). Una N3 abierta es, por
    // definición, una que espera a alguien distinto de quien la abrió: el
    // servidor no deja autocerrarla. Contarlas aparte es lo que le dice a
    // la dirección «aquí hace falta que entres tú».
    esperandoCierreDeOtro: deResidente.filter(
      (i) => i.severity === "N3" || i.severity === "N4",
    ).length,
    total: abiertas,
  };
}

// ── 2 · LOS RELEVOS ──────────────────────────────────────────────────

async function relevosDelPanel(
  prisma: PrismaClient,
  tenantId: string,
  ahora: Date,
): Promise<RelevosDelPanel> {
  const haceUnaSemana = new Date(ahora.getTime() - 7 * 24 * 3_600_000);
  const partes = await prisma.handover.findMany({
    where: { tenantId, frozenAt: { gte: haceUnaSemana } },
    orderBy: { frozenAt: "desc" },
    select: {
      id: true,
      careDay: true,
      lineas: true,
      sinNovedades: true,
      frozenAt: true,
      confirmedAt: true,
      centerShift: { select: { name: true } },
      zones: { select: { floorId: true } },
      acks: {
        orderBy: { at: "asc" },
        select: {
          at: true,
          alcanceTotal: true,
          user: { select: { alias: true, email: true } },
          careRoleAssignment: { select: { careRole: { select: { name: true } } } },
          zones: { select: { floorId: true } },
        },
      },
    },
  });

  const alcances = (p: (typeof partes)[number]) =>
    p.acks.map((a) => ({
      alcanceTotal: a.alcanceTotal,
      floorIds: a.zones.map((z) => z.floorId),
    }));

  const primero = partes[0];
  return {
    ultimo:
      primero == null
        ? null
        : {
            id: primero.id,
            careDay: primero.careDay,
            turno: primero.centerShift.name,
            congeladoEn: primero.frozenAt.toISOString(),
            lineas: primero.lineas,
            sinNovedades: primero.sinNovedades,
            confirmado: estaConfirmado(primero.zones, alcances(primero)),
            confirmadoPor: primero.acks.map((a) => ({
              nombre: a.user.alias ?? a.user.email.split("@")[0]!,
              rol: a.careRoleAssignment.careRole.name,
              at: a.at.toISOString(),
              alcanceTotal: a.alcanceTotal,
            })),
            zonasPorConfirmar: zonasSinConfirmar(primero.zones, alcances(primero)).length,
          },
    // `confirmedAt == null` y no «`estaConfirmado` dice que no»: la
    // columna es el resumen que la ruta de confirmar escribe, y
    // recalcularlo aquí para veintiún partes sería recalcular lo que ya
    // está decidido. Que las dos cosas cuadren lo fija un test.
    sinConfirmar: partes
      .filter((p) => p.confirmedAt == null)
      .map((p) => ({
        id: p.id,
        careDay: p.careDay,
        turno: p.centerShift.name,
        congeladoEn: p.frozenAt.toISOString(),
        lineas: p.lineas,
        zonasPorConfirmar: zonasSinConfirmar(p.zones, alcances(p)).length,
      })),
  };
}

// ── 4 · EL TURNO EN CURSO ────────────────────────────────────────────

async function turnoEnCurso(
  prisma: PrismaClient,
  tenantId: string,
  ahora: Date,
): Promise<TurnoEnCurso> {
  const [turnos, plantas, ocupaciones, controles, ajustes, momentos, plan] =
    await Promise.all([
      prisma.centerShift.findMany({
        where: { tenantId },
        orderBy: [{ sortOrder: "asc" }],
        select: { id: true, code: true, name: true, startsAt: true, endsAt: true },
      }),
      prisma.floor.findMany({
        where: { tenantId },
        orderBy: [{ sortOrder: "asc" }],
        select: { id: true, name: true },
      }),
      prisma.bedAssignment.findMany({
        where: { tenantId, toAt: null },
        select: {
          clientId: true,
          bed: { select: { room: { select: { floorId: true } } } },
        },
      }),
      prisma.controlType.findMany({
        where: {
          supersededAt: null,
          OR: [{ scope: "STANDARD" }, { scope: "CENTER", tenantId }],
        },
        select: { code: true, layer: true, nature: true },
      }),
      prisma.centerControlSetting.findMany({
        where: { tenantId },
        select: { controlCode: true, active: true },
      }),
      prisma.centerMoment.findMany({
        where: { tenantId },
        orderBy: [{ sortOrder: "asc" }],
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
    ]);

  const turno = turnoDe(ahora, turnos);
  const careDay = diaDelTurno(ahora, turno);
  const floorPorCliente = new Map(
    ocupaciones.map((o) => [o.clientId, o.bed.room.floorId as string | null]),
  );
  const paraControles: ControlParaNoHecho[] = controles.map((c) => ({
    code: c.code,
    layer: c.layer,
    nature: c.nature,
  }));
  const fuera = new Set(
    plan.map((l) => l.clientId).filter((c) => !floorPorCliente.has(c)),
  );

  // Los registros del día del centro y del siguiente, por lo mismo que en
  // el parte: la noche cruza medianoche.
  const registros = await prisma.careRecord.findMany({
    where: { tenantId, careDay: { in: [careDay, addDays(careDay, 1)] } },
    select: {
      clientId: true,
      controlCode: true,
      careDay: true,
      occurrenceAt: true,
      recordedAt: true,
      voidedAt: true,
      centerShift: { select: { code: true } },
    },
  });
  const hechos: RegistroHecho[] = registros.map((r) => ({
    clientId: r.clientId,
    controlCode: r.controlCode,
    careDay: r.careDay,
    shiftCode: r.centerShift?.code ?? null,
    occurrenceAt: r.occurrenceAt,
    recordedAt: r.recordedAt,
    voidedAt: r.voidedAt,
  }));

  const lineasDePlan = plan.map((l) => ({
    id: l.id,
    clientId: l.clientId,
    controlCode: l.controlCode,
    frecuencia: deColumnas(l),
    fromAt: l.fromAt,
    toAt: l.toAt,
  }));
  const ajustesPlanos = ajustes.map((a) => ({
    controlCode: a.controlCode,
    active: a.active,
  }));

  // ── Cuánto va hecho del turno EN CURSO, por planta ───────────────
  const plantasPintadas: TurnoEnCurso["plantas"] = [];
  if (turno != null) {
    const { desde, hasta } = ventanaDelTurno(turno, careDay);
    const ocurrencias = queToca(
      lineasDePlan,
      ajustesPlanos,
      turnos,
      momentos,
      desde,
      hasta,
    );
    const porPlanta = new Map<string | null, typeof ocurrencias>();
    for (const oc of ocurrencias) {
      const floorId = floorPorCliente.get(oc.clientId) ?? null;
      const ya = porPlanta.get(floorId) ?? [];
      ya.push(oc);
      porPlanta.set(floorId, ya);
    }
    for (const planta of plantas) {
      const suyas = porPlanta.get(planta.id) ?? [];
      const r = cuantoVaHecho({
        ocurrencias: suyas,
        registros: hechos,
        controles: paraControles,
        fuera,
      });
      plantasPintadas.push({
        floorId: planta.id,
        nombre: planta.name,
        tocan: r.tocan,
        hechas: r.hechas,
      });
    }
    // Y los residentes sin planta, si los hay: no se esconden.
    const sinPlanta = porPlanta.get(null) ?? [];
    if (sinPlanta.length > 0) {
      const r = cuantoVaHecho({
        ocurrencias: sinPlanta,
        registros: hechos,
        controles: paraControles,
        fuera,
      });
      plantasPintadas.push({
        floorId: null,
        nombre: "Sin planta",
        tocan: r.tocan,
        hechas: r.hechas,
      });
    }
  }

  // ── Lo NO hecho de los turnos CERRADOS de hoy ────────────────────
  //
  // El corte es **el inicio del turno en curso**, no «ahora»: lo del
  // turno que está pasando no se ha incumplido todavía. Es la misma
  // distinción que `loQueNoSeHizo` documenta en su `corte`.
  const inicioDelTurno =
    turno == null ? wallTimeToUtc(careDay, "00:00") : ventanaDelTurno(turno, careDay).desde;
  const ocurrenciasDelDia = queToca(
    lineasDePlan,
    ajustesPlanos,
    turnos,
    momentos,
    wallTimeToUtc(careDay, "00:00"),
    inicioDelTurno,
  );
  const noHechoCerrados = loQueNoSeHizo({
    ocurrencias: ocurrenciasDelDia,
    registros: hechos,
    controles: paraControles,
    corte: inicioDelTurno,
    fuera,
  });

  return {
    turno: turno ? { id: turno.id, code: turno.code, name: turno.name } : null,
    careDay,
    plantas: plantasPintadas,
    noHechoDeTurnosCerrados: noHechoCerrados.length,
  };
}

// ── 5 · LOS INDICADORES ──────────────────────────────────────────────

/**
 * Los seis del mes. La FÓRMULA está en el paquete puro; aquí se recoge lo
 * que necesita.
 *
 * El denominador de los porcentajes de cumplimiento sale del MISMO cruce
 * que el parte de relevo (`queToca` + `loQueNoSeHizo`): así «el 73,5 % de
 * la gimnasia» y «la gimnasia de doña Carmen no se hizo el martes» no se
 * pueden contradecir, que es el error clásico de tener dos fuentes para
 * la misma pregunta.
 */
export async function indicadoresDelMes(
  prisma: PrismaClient,
  tenantId: string,
  mes: string,
  ahora: Date,
): Promise<ValorDeIndicador[]> {
  const primero = `${mes}-01`;
  const siguiente = mesSiguiente(mes);
  const desde = wallTimeToUtc(primero, "00:00");
  const hasta = wallTimeToUtc(siguiente, "00:00");

  const [
    umbrales,
    ocupaciones,
    controles,
    ajustes,
    turnos,
    momentos,
    plan,
    registros,
    visitas,
    actividades,
    sinDeposicion,
    averias,
  ] = await Promise.all([
    prisma.indicatorTarget.findMany({
      where: { tenantId },
      select: { code: true, target: true, comparison: true },
    }),
    prisma.bedAssignment.findMany({
      where: { tenantId, OR: [{ toAt: null }, { toAt: { gte: desde } }], fromAt: { lt: hasta } },
      select: { clientId: true },
      distinct: ["clientId"],
    }),
    prisma.controlType.findMany({
      where: {
        supersededAt: null,
        OR: [{ scope: "STANDARD" }, { scope: "CENTER", tenantId }],
      },
      select: { code: true, layer: true, nature: true },
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
    // Residentes con AL MENOS UNA visita médica en el mes.
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
    prisma.careRecord.count({
      where: {
        tenantId,
        controlCode: "ACTIVIDAD_SOCIOCULTURAL",
        careDay: { gte: primero, lt: siguiente },
        voidedAt: null,
      },
    }),
    prisma.incident.count({
      where: {
        tenantId,
        incidentType: "SIN_DEPOSICION",
        openedAt: { gte: desde, lt: hasta },
      },
    }),
    prisma.incident.findMany({
      where: {
        tenantId,
        subject: "MAINTENANCE",
        openedAt: { gte: desde, lt: hasta },
      },
      select: { openedAt: true, closedAt: true },
    }),
  ]);

  const paraControles: ControlParaNoHecho[] = controles.map((c) => ({
    code: c.code,
    layer: c.layer,
    nature: c.nature,
  }));
  const hechos: RegistroHecho[] = registros.map((r) => ({
    clientId: r.clientId,
    controlCode: r.controlCode,
    careDay: r.careDay,
    shiftCode: r.centerShift?.code ?? null,
    occurrenceAt: r.occurrenceAt,
    recordedAt: r.recordedAt,
    voidedAt: r.voidedAt,
  }));
  const ocurrencias = queToca(
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
    // **Hasta el final del mes O hasta ahora**, el que llegue antes: el
    // cumplimiento del mes en curso se mide sobre lo que ya ha pasado. Si
    // se midiera sobre el mes entero, el día 3 de octubre la gimnasia
    // saldría al 10 % y el panel diría que el centro va fuera de umbral
    // por no haber hecho todavía lo de la semana que viene.
    hasta.getTime() < ahora.getTime() ? hasta : ahora,
  );

  // El cumplimiento por control, con el MISMO cruce que el parte.
  const cumplimiento: DatosDelMes["cumplimiento"] = {};
  for (const code of ["GIMNASIA", "ESTIMULACION_COGNITIVA"]) {
    const suyas = ocurrencias.filter((o) => o.controlCode === code);
    cumplimiento[code] = cuantoVaHecho({
      ocurrencias: suyas,
      registros: hechos,
      controles: paraControles,
    });
  }

  const datos: DatosDelMes = {
    mes,
    residentes: ocupaciones.length,
    cumplimiento,
    residentesConVisitaMedica: visitas.length,
    actividadesSocioculturales: actividades,
    episodiosSinDeposicion: sinDeposicion,
    averias: averias.map((a) => ({
      horas:
        a.closedAt == null
          ? null
          : (a.closedAt.getTime() - a.openedAt.getTime()) / 3_600_000,
    })),
  };

  return calcularIndicadores(datos, umbrales);
}

/** El primer día del mes siguiente, «YYYY-MM-DD». */
function mesSiguiente(mes: string): string {
  const anio = Number(mes.slice(0, 4));
  const m = Number(mes.slice(5, 7));
  return m === 12 ? `${anio + 1}-01-01` : `${anio}-${String(m + 1).padStart(2, "0")}-01`;
}
