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
  bandaDeRiesgo,
  calcularIndicadores,
  mesAnterior,
  proponeNc,
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
  type Ocurrencia,
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

/**
 * calidad-1 (D-71, D-73, D-74) · **LO QUE CALIDAD TIENE ENCIMA DE LA
 * MESA.**
 *
 * Cuatro cosas, y las cuatro son «alguien tiene que hacer algo hoy»:
 *
 *   · **las no conformidades sin cerrar**, por estado;
 *   · **las acciones correctivas vencidas**, con su responsable — es lo
 *     que convierte «se resolvió de palabra» en una fila con un nombre;
 *   · **las revisiones de riesgo vencidas** (D-71);
 *   · **las propuestas de abrir NC** (D-74): un indicador que lleva dos
 *     meses completos fuera de umbral. Propone; la decide una persona.
 */
export interface CalidadDelPanel {
  noConformidades: {
    abiertas: number;
    porEstado: Array<{ estado: string; cuantas: number }>;
  };
  accionesVencidas: Array<{
    id: string;
    ncId: string;
    referencia: string;
    responsable: string;
    dueOn: string;
  }>;
  revisionesVencidas: Array<{
    id: string;
    procesoId: string;
    proceso: string;
    descripcion: string;
    nivel: number;
    banda: string;
    reviewAt: string;
  }>;
  propuestas: Array<{
    code: string;
    nombre: string;
    meses: [string, string];
    mesDeReferencia: string;
    procesoId: string | null;
  }>;
  /** `false` cuando el centro todavía no ha cargado el mapa: la pantalla
   *  enseña el botón en vez de cuatro listas vacías, que parecerían
   *  «todo en orden». */
  mapaCargado: boolean;
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
  /** calidad-1 · lo que calidad tiene encima de la mesa. */
  calidad: CalidadDelPanel;
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
    calidad,
    cuantosResidentes,
  ] = await Promise.all([
    queHayAbierto(prisma, tenantId),
    relevosDelPanel(prisma, tenantId, ahora),
    obligacionesDelPanel(prisma, { tenantId, ahora }),
    turnoEnCurso(prisma, tenantId, ahora),
    loQueHayQueArreglar(prisma, tenantId, ahora),
    indicadoresDelMes(prisma, tenantId, mes, ahora),
    calidadDelPanel(prisma, tenantId, ahora),
    // primer-acceso · dentro del mismo `Promise.all`: un `count` sobre
    // un índice de tenant no mueve el presupuesto de los 10 segundos, y
    // fuera habría sido una ida más a la base en serie.
    prisma.residentProfile.count({ where: { tenantId } }),
  ]);

  return {
    abierto,
    relevos,
    obligaciones,
    turno,
    porArreglar,
    indicadores,
    calidad,
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
 * calidad-1 (R9) · **LA CUMPLIMENTACIÓN, ABIERTA POR TURNO Y POR ZONA.**
 *
 * El acta de la inspección del 08-10-2026 habla de «anotaciones vacías
 * puntuales» y la respuesta del centro comprometió que **la supervisora
 * compruebe al final de cada turno** que no quedan casillas sin anotar.
 * Un porcentaje del mes no sirve para eso: lo que hace falta es ver qué
 * turno y qué planta se quedan cortos, que es lo que esta tabla dice.
 *
 * Sale del MISMO cruce que el parte de relevo, así que el indicador y el
 * parte **no se pueden contradecir para el mismo turno**.
 */
export interface CumplimentacionPorTurnoYZona {
  shiftCode: string | null;
  turno: string;
  floorId: string | null;
  zona: string;
  tocan: number;
  hechas: number;
}

/** Lo que `recogerDatosDelMes` devuelve: lo que la fórmula necesita más
 *  lo que la pantalla abre. */
export interface RecogidaDelMes {
  datos: DatosDelMes;
  umbrales: Array<{
    code: string;
    target: number;
    comparison: "AT_LEAST" | "AT_MOST";
  }>;
  cumplimentacionPorTurnoYZona: CumplimentacionPorTurnoYZona[];
}

/**
 * Los trece del mes. La FÓRMULA está en el paquete puro; aquí se recoge
 * lo que necesita.
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
  const { datos, umbrales } = await recogerDatosDelMes(prisma, tenantId, mes, ahora);
  return calcularIndicadores(datos, umbrales);
}

export async function recogerDatosDelMes(
  prisma: PrismaClient,
  tenantId: string,
  mes: string,
  ahora: Date,
): Promise<RecogidaDelMes> {
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
    caidas,
    cerradasDeResidente,
    quejas,
    camas,
    bajas,
    activos,
    plantas,
  ] = await Promise.all([
    prisma.indicatorTarget.findMany({
      where: { tenantId },
      select: { code: true, target: true, comparison: true },
    }),
    // Las ocupaciones que tocan el mes, **sin `distinct`**: hacen falta
    // enteras para dos cosas distintas. Los residentes del denominador
    // son los `clientId` únicos; la ocupación media necesita los tramos
    // con sus fechas para sumar camas-día. Dos consultas habrían sido
    // dos barridos del mismo índice.
    prisma.bedAssignment.findMany({
      where: { tenantId, OR: [{ toAt: null }, { toAt: { gte: desde } }], fromAt: { lt: hasta } },
      select: {
        clientId: true,
        fromAt: true,
        toAt: true,
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

    // ── calidad-1 (D-72) · lo que necesitan los siete nuevos ───────
    prisma.incident.count({
      where: {
        tenantId,
        incidentType: "CAIDA",
        openedAt: { gte: desde, lt: hasta },
      },
    }),
    // Las incidencias de RESIDENTE **cerradas** en el mes, con sus
    // comunicaciones a familia. El denominador son las cerradas: una
    // abierta todavía está a tiempo de comunicarse.
    prisma.incident.findMany({
      where: {
        tenantId,
        subject: "RESIDENT",
        closedAt: { gte: desde, lt: hasta },
      },
      select: {
        closedAt: true,
        familyCommunications: { select: { kind: true, at: true } },
      },
    }),
    prisma.incident.findMany({
      where: {
        tenantId,
        subject: "COMPLAINT",
        openedAt: { gte: desde, lt: hasta },
      },
      select: { openedAt: true, closedAt: true },
    }),
    // Las camas activas del centro. Se cuentan a día de hoy y no día a
    // día: `beds` no tiene histórico —`active` es una columna, no una
    // vigencia— y reconstruir «cuántas camas había el 3 de marzo» sería
    // inventárselo. Queda dicho en el `deDonde` del indicador.
    prisma.bed.count({ where: { tenantId, active: true } }),
    prisma.employee.count({
      where: { tenantId, deactivatedAt: { gte: desde, lt: hasta } },
    }),
    prisma.employee.count({ where: { tenantId, active: true } }),
    prisma.floor.findMany({
      where: { tenantId },
      select: { id: true, name: true },
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

  // ── calidad-1 (R9) · LA CUMPLIMENTACIÓN, GLOBAL Y POR TURNO Y ZONA ─
  //
  // Lo global sale del mismo `cuantoVaHecho` que los dos porcentajes de
  // arriba, pero **sobre todas las ocurrencias** y no sobre las de un
  // control: es «¿se anotó lo que tocaba?», que es lo que la inspección
  // mira.
  //
  // Y el desglose se saca del MISMO array de ocurrencias, agrupándolas:
  // volver a llamar a `queToca` por turno y planta habría multiplicado
  // por nueve el trabajo más caro de esta función para recalcular lo
  // mismo.
  const cumplimentacion = cuantoVaHecho({
    ocurrencias,
    registros: hechos,
    controles: paraControles,
  });

  const zonaDe = new Map<string, string | null>();
  for (const o of ocupaciones) {
    // Si un residente cambió de planta dentro del mes, manda la última
    // asignación que se lee: el desglose es una ayuda para mirar dónde
    // están los huecos, no un reparto contable.
    zonaDe.set(o.clientId, o.bed?.room.floorId ?? null);
  }
  const nombreDePlanta = new Map(plantas.map((p) => [p.id, p.name]));
  const nombreDeTurno = new Map(turnos.map((t) => [t.code, t.name]));

  const cubos = new Map<string, Ocurrencia[]>();
  for (const o of ocurrencias) {
    const clave = `${o.shiftCode ?? ""}|${zonaDe.get(o.clientId) ?? ""}`;
    const lista = cubos.get(clave);
    if (lista) lista.push(o);
    else cubos.set(clave, [o]);
  }
  const cumplimentacionPorTurnoYZona: CumplimentacionPorTurnoYZona[] = [];
  for (const [clave, suyas] of cubos) {
    const [shiftCode, floorId] = clave.split("|");
    const { tocan, hechas } = cuantoVaHecho({
      ocurrencias: suyas,
      registros: hechos,
      controles: paraControles,
    });
    if (tocan === 0) continue;
    cumplimentacionPorTurnoYZona.push({
      shiftCode: shiftCode === "" ? null : shiftCode!,
      turno:
        shiftCode === "" || shiftCode == null
          ? "Fuera de turno"
          : (nombreDeTurno.get(shiftCode) ?? shiftCode),
      floorId: floorId === "" ? null : floorId!,
      zona:
        floorId === "" || floorId == null
          ? "Sin planta"
          : (nombreDePlanta.get(floorId) ?? "Sin planta"),
      tocan,
      hechas,
    });
  }
  // Lo peor primero: el turno y la planta con más huecos es lo que la
  // supervisora tiene que mirar, y buscarlo en una tabla ordenada por
  // nombre es trabajo que la pantalla puede ahorrarle.
  cumplimentacionPorTurnoYZona.sort(
    (a, b) => a.hechas / a.tocan - b.hechas / b.tocan,
  );

  // ── La ocupación media, sumada día a día ──────────────────────────
  //
  // Sobre los días que YA han pasado del mes, por lo mismo que el corte
  // del cumplimiento: contar los días que faltan como camas vacías daría
  // el día 3 una ocupación del 10 %.
  const finDeCuenta = hasta.getTime() < ahora.getTime() ? hasta : ahora;
  let camasDia = 0;
  let ocupadasDia = 0;
  for (
    let dia = new Date(desde.getTime());
    dia.getTime() < finDeCuenta.getTime();
    dia = new Date(dia.getTime() + 86_400_000)
  ) {
    const finDelDia = new Date(dia.getTime() + 86_400_000);
    camasDia += camas;
    ocupadasDia += ocupaciones.filter(
      (o) =>
        o.fromAt.getTime() < finDelDia.getTime() &&
        (o.toAt == null || o.toAt.getTime() >= dia.getTime()),
    ).length;
  }

  const residentesUnicos = new Set(ocupaciones.map((o) => o.clientId));

  const datos: DatosDelMes = {
    mes,
    residentes: residentesUnicos.size,
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

    cumplimentacion,
    caidas,
    incidenciasDeResidenteCerradas: cerradasDeResidente.length,
    // **Comunicada ANTES de cerrar.** Un `COMUNICADO` fechado después
    // del cierre no cuenta: lo que la observación 10 de AENOR pide es
    // que la familia se entere, no que conste a posteriori.
    conFamiliaComunicadaAntesDeCerrar: cerradasDeResidente.filter((i) =>
      i.familyCommunications.some(
        (c) =>
          c.kind === "COMUNICADO" &&
          i.closedAt != null &&
          c.at.getTime() <= i.closedAt.getTime(),
      ),
    ).length,
    quejas: quejas.map((q) => ({
      dias:
        q.closedAt == null
          ? null
          : (q.closedAt.getTime() - q.openedAt.getTime()) / 86_400_000,
    })),
    ocupacion: { camasDia, ocupadasDia },
    personal: { bajas, plantilla: activos + bajas },
  };

  return { datos, umbrales, cumplimentacionPorTurnoYZona };
}

/** El primer día del mes siguiente, «YYYY-MM-DD». */
function mesSiguiente(mes: string): string {
  const anio = Number(mes.slice(0, 4));
  const m = Number(mes.slice(5, 7));
  return m === 12 ? `${anio + 1}-01-01` : `${anio}-${String(m + 1).padStart(2, "0")}-01`;
}

// ── 6 · calidad-1 · LO QUE CALIDAD TIENE ENCIMA DE LA MESA ───────────

/**
 * Las cuatro listas de calidad del panel.
 *
 * ── LAS PROPUESTAS CUESTAN DOS MESES MÁS DE CÁLCULO, Y SE PAGAN ─────
 *
 * `proponeNc` necesita los dos meses completos anteriores, y cada mes
 * es la consulta más cara de este fichero (el plan entero cruzado con
 * los registros). Van en el mismo `Promise.all` que el resto, así que el
 * panel no tarda tres veces más — tarda lo que el más lento— pero sí
 * hace tres veces el trabajo en la base.
 *
 * La alternativa era una ruta aparte que la pantalla pidiera después, y
 * se descartó por el presupuesto de lectura del bloque C §1: «cualquier
 * dato en menos de 10 segundos y 3 toques». Una propuesta de abrir una
 * no conformidad que hay que ir a buscar a otra pantalla es una
 * propuesta que nadie ve.
 *
 * Y se calcula sobre meses CERRADOS, así que el resultado es el mismo
 * todo el mes: es el candidato natural a una caché el día que 49 plazas
 * sean 500. Hoy no la tiene, y está dicho.
 */
export async function calidadDelPanel(
  prisma: PrismaClient,
  tenantId: string,
  ahora: Date,
): Promise<CalidadDelPanel> {
  const hoy = utcToWallDate(ahora);
  const mesEnCurso = hoy.slice(0, 7);
  const ultimo = mesAnterior(mesEnCurso);
  const penultimo = mesAnterior(ultimo);

  const [procesos, porEstado, accionesVencidas, riesgos, ncDeIndicador] =
    await Promise.all([
      prisma.process.count({ where: { tenantId } }),
      prisma.nonConformity.groupBy({
        by: ["state"],
        where: { tenantId, state: { not: "CLOSED" } },
        _count: { _all: true },
      }),
      prisma.correctiveAction.findMany({
        where: { tenantId, closedAt: null, dueOn: { lt: hoy } },
        orderBy: { dueOn: "asc" },
        take: 20,
        select: {
          id: true,
          dueOn: true,
          nonConformity: { select: { id: true, reference: true } },
          responsibleCareRole: { select: { name: true } },
          responsibleUser: { select: { alias: true, email: true } },
          responsibleLabel: true,
        },
      }),
      prisma.riskOpportunity.findMany({
        where: { tenantId, active: true, reviewAt: { lt: hoy } },
        orderBy: { reviewAt: "asc" },
        take: 20,
        select: {
          id: true,
          description: true,
          level: true,
          reviewAt: true,
          process: { select: { id: true, name: true } },
        },
      }),
      // Las NC que ya salieron de un indicador: una propuesta aceptada
      // deja de proponerse. Si alguien la rechaza vuelve a salir el mes
      // que viene, y eso es correcto — el centro sigue fuera de umbral.
      prisma.nonConformity.findMany({
        where: { tenantId, origin: "INDICATOR" },
        select: { sourceIndicatorCode: true, sourceIndicatorMonth: true },
      }),
    ]);

  // El mapa sin cargar se contesta aquí y se acaba: sin procesos no hay
  // nada que proponer ni que revisar, y calcular dos meses de
  // indicadores para enseñar cuatro listas vacías es trabajo tirado.
  if (procesos === 0) {
    return {
      noConformidades: { abiertas: 0, porEstado: [] },
      accionesVencidas: [],
      revisionesVencidas: [],
      propuestas: [],
      mapaCargado: false,
    };
  }

  const [delUltimo, delPenultimo, colgados] = await Promise.all([
    indicadoresDelMes(prisma, tenantId, ultimo, ahora),
    indicadoresDelMes(prisma, tenantId, penultimo, ahora),
    prisma.indicatorProcess.findMany({
      where: { tenantId },
      select: { code: true, processId: true },
    }),
  ]);

  const yaAbierta = new Set(
    ncDeIndicador.map((n) => `${n.sourceIndicatorCode}|${n.sourceIndicatorMonth}`),
  );
  const procesoDe = new Map(colgados.map((c) => [c.code, c.processId]));
  const porCodigoPenultimo = new Map(delPenultimo.map((i) => [i.code, i]));

  const propuestas: CalidadDelPanel["propuestas"] = [];
  for (const i of delUltimo) {
    const anterior = porCodigoPenultimo.get(i.code);
    if (anterior == null) continue;
    const p = proponeNc(
      { code: i.code, nombre: i.nombre },
      [
        { mes: penultimo, dentro: anterior.dentro },
        { mes: ultimo, dentro: i.dentro },
      ],
    );
    if (p == null) continue;
    if (yaAbierta.has(`${p.code}|${p.mesDeReferencia}`)) continue;
    propuestas.push({ ...p, procesoId: procesoDe.get(p.code) ?? null });
  }

  return {
    noConformidades: {
      abiertas: porEstado.reduce((n, g) => n + g._count._all, 0),
      porEstado: porEstado.map((g) => ({
        estado: g.state,
        cuantas: g._count._all,
      })),
    },
    accionesVencidas: accionesVencidas.map((a) => ({
      id: a.id,
      ncId: a.nonConformity.id,
      referencia: a.nonConformity.reference,
      responsable:
        a.responsibleCareRole?.name ??
        a.responsibleUser?.alias ??
        a.responsibleUser?.email.split("@")[0] ??
        a.responsibleLabel ??
        "—",
      dueOn: a.dueOn,
    })),
    revisionesVencidas: riesgos.map((r) => ({
      id: r.id,
      procesoId: r.process.id,
      proceso: r.process.name,
      descripcion: r.description,
      nivel: r.level,
      banda: bandaDeRiesgo(r.level),
      reviewAt: r.reviewAt,
    })),
    propuestas,
    mapaCargado: true,
  };
}
