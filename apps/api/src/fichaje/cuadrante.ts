// personal-1 · EL CUADRANTE, DEL LADO DE LA BASE.
//
// Aquí vive lo que las rutas necesitan y `@mipiacetpv/cuadrante` no puede
// saber: de dónde salen los turnos, las reglas, las plazas ocupadas y las
// celdas, y cómo se escribe una celda sin saltarse el motor.
//
// ── LA REGLA DE ORO DE ESTE FICHERO ─────────────────────────────────
//
// **Ninguna celda se escribe con `prisma.staffScheduleCell.create`.** Todo
// pasa por `set_staff_schedule_day(...)`, que es la función de la
// migración: escribe la traza si el cuadrante está publicado y después
// toca las celdas, en la misma transacción. El trigger lo exige, así que
// un `create` directo sobre un cuadrante publicado reventaría — pero no
// hace falta llegar ahí, y por eso en este fichero no hay ni uno.
//
// Es el mismo reparto que `corrections.ts` tiene con
// `record_time_entry_correction` en ADR-018.
//
// ── Y LA SEMILLA ────────────────────────────────────────────────────
//
// Los turnos y las categorías se siembran **al abrir el cuadrante por
// primera vez**, no al encender el módulo de fichaje. Mismo criterio que
// `asegurarDek`: en la primera vez que hace falta, no en un interruptor
// que alguien pulsa meses antes. Un tenant que ficha y no hace cuadrante
// no necesita ni turnos ni categorías, y sembrárselos le llenaría dos
// pantallas que no va a abrir.
//
// Y es idempotente por los dos únicos `(tenant_id, code)`: lo que ya está
// **no se reescribe**. Si un centro renombró un turno o le quitó la marca
// de atención directa a una categoría, la semilla no se lo deshace.

import type { Prisma, PrismaClient } from "@mipiacetpv/db";
import {
  REGLAS_DE_SERIE,
  categoriasDeSerie,
  comprobarCuadrante,
  diasDe,
  finDelTurnoDelDia,
  planificadoDelDia,
  rangoDelMes,
  resumenDeAvisos,
  type AvisoDelCuadrante,
  type Cuadrante,
  type PersonaDelCuadrante,
  type ReglasDelCuadrante,
  type ResumenDeAvisos,
  type TurnoDelCuadrante,
} from "@mipiacetpv/cuadrante";
import { TURNOS_DE_SERIE } from "@mipiacetpv/residencia-plan";

import { getPrisma } from "../context.js";
import { nombreCompleto } from "./personal.js";

type Ejecutor = PrismaClient | Prisma.TransactionClient;

export const TURNO_SELECT = {
  id: true,
  code: true,
  name: true,
  startsAt: true,
  endsAt: true,
  sortOrder: true,
  minCoverage: true,
} as const;

/** Los turnos del tenant, en el orden en que los pide `turnoDe`. */
export async function turnosDelTenant(
  tenantId: string,
  prisma: Ejecutor = getPrisma(),
): Promise<TurnoDelCuadrante[]> {
  const filas = await prisma.centerShift.findMany({
    where: { tenantId },
    orderBy: [{ sortOrder: "asc" }, { startsAt: "asc" }],
    select: TURNO_SELECT,
  });
  return filas.map((t) => ({
    id: t.id,
    code: t.code,
    name: t.name,
    startsAt: t.startsAt,
    endsAt: t.endsAt,
    sortOrder: t.sortOrder,
    coberturaMinima: t.minCoverage,
  }));
}

/**
 * Las reglas del tenant, **fallando hacia los defaults**.
 *
 * Mismo criterio exacto que `maxOpenHoursFor` (#45): si la fila no está
 * —un centro que nunca ha tocado Ajustes— o no se puede leer, ese tenant
 * se comporta como todos los demás. Negar el cuadrante entero porque no se
 * pudo leer un ajuste que casi nadie toca sería al revés.
 *
 * Y la ratio se mide **sólo si el módulo de residencia está encendido**:
 * eso no es un ajuste, es qué producto ha comprado la empresa, y vive en
 * `tenants.residencia_enabled`.
 */
export async function reglasDelTenant(
  tenantId: string,
  prisma: Ejecutor = getPrisma(),
): Promise<ReglasDelCuadrante> {
  let conRatio = false;
  try {
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { residenciaEnabled: true },
    });
    conRatio = tenant?.residenciaEnabled === true;
  } catch {
    conRatio = false;
  }
  try {
    const fila = await prisma.staffRuleSettings.findUnique({
      where: { tenantId },
    });
    if (!fila) return { ...REGLAS_DE_SERIE, conRatioDeResidencia: conRatio };
    return {
      ratioAtencionDirecta: fila.ratioDirectCarePerMil / 1000,
      minutosDeJornadaCompleta: fila.fullDayMinutes,
      horasDescansoDiario: fila.minRestHours,
      horasDescansoSemanal: fila.weeklyRestHours,
      diasComputoSemanal: fila.weeklyRestWindowDays,
      conRatioDeResidencia: conRatio,
    };
  } catch {
    return { ...REGLAS_DE_SERIE, conRatioDeResidencia: conRatio };
  }
}

/** Y la tolerancia de «no ha fichado», que va en la misma fila. */
export async function toleranciaDelTenant(
  tenantId: string,
  prisma: Ejecutor = getPrisma(),
): Promise<number> {
  try {
    const fila = await prisma.staffRuleSettings.findUnique({
      where: { tenantId },
      select: { noShowToleranceMinutes: true },
    });
    return fila?.noShowToleranceMinutes ?? 15;
  } catch {
    return 15;
  }
}

/**
 * El margen sobre el fin del turno planificado, del tenant.
 *
 * Hermana de `maxOpenHoursFor` en todo, incluido el fallo hacia el
 * default: tumbar un cierre de turno por no poder leer un ajuste sería
 * exactamente al revés de lo que hay que hacer.
 */
export const MARGEN_DE_TURNO_DEFAULT = 4;
export const MARGEN_DE_TURNO_MIN = 1;
export const MARGEN_DE_TURNO_MAX = 12;

export function normalizarMargen(valor: unknown): number {
  if (typeof valor !== "number" || !Number.isFinite(valor)) {
    return MARGEN_DE_TURNO_DEFAULT;
  }
  if (valor < MARGEN_DE_TURNO_MIN || valor > MARGEN_DE_TURNO_MAX) {
    return MARGEN_DE_TURNO_DEFAULT;
  }
  return valor;
}

export async function margenDeTurnoFor(
  tenantId: string,
  prisma: Ejecutor = getPrisma(),
): Promise<number> {
  const model = prisma.tenant as
    | {
        findUnique?: (args: unknown) => Promise<{ fichajeShiftMarginHours?: unknown } | null>;
      }
    | undefined;
  if (typeof model?.findUnique !== "function") return MARGEN_DE_TURNO_DEFAULT;
  try {
    const tenant = await model.findUnique({
      where: { id: tenantId },
      select: { fichajeShiftMarginHours: true },
    });
    return normalizarMargen(tenant?.fichajeShiftMarginHours);
  } catch {
    return MARGEN_DE_TURNO_DEFAULT;
  }
}

// ── La semilla ────────────────────────────────────────────────────────

/**
 * Siembra los tres turnos de serie si el tenant no tiene ni uno.
 *
 * `TURNOS_DE_SERIE` del paquete del plan, **no una copia**: son los mismos
 * tres que residencia-1 siembra al encender el centro (M 08–15, T 15–22,
 * N 22–08), y cubren las 24 h sin hueco ni solape.
 *
 * Si el tenant **ya tiene turnos** no se toca nada, ni para añadir los que
 * falten: un centro que se quedó sólo con «mañana» y «tarde» lo hizo a
 * propósito, y devolverle la noche sería desconfigurarle el cuadrante.
 */
export async function sembrarTurnosSiHaceFalta(
  tenantId: string,
  prisma: Ejecutor = getPrisma(),
): Promise<number> {
  const cuantos = await prisma.centerShift.count({ where: { tenantId } });
  if (cuantos > 0) return 0;
  await prisma.centerShift.createMany({
    data: TURNOS_DE_SERIE.map((t) => ({
      tenantId,
      code: t.code,
      name: t.name,
      startsAt: t.startsAt,
      endsAt: t.endsAt,
      sortOrder: t.sortOrder,
    })),
    skipDuplicates: true,
  });
  return TURNOS_DE_SERIE.length;
}

/**
 * Y las categorías profesionales, las que tocan según los módulos.
 *
 * `skipDuplicates` y no un `upsert`: lo que ya está no se reescribe. Es la
 * mitad que importa — si un centro le quitó la marca de atención directa a
 * «cocina», la semilla no se la devuelve.
 */
export async function sembrarCategoriasSiHaceFalta(
  tenantId: string,
  prisma: Ejecutor = getPrisma(),
): Promise<number> {
  const cuantas = await prisma.employeeCategory.count({ where: { tenantId } });
  if (cuantas > 0) return 0;
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { residenciaEnabled: true },
  });
  const deSerie = categoriasDeSerie({
    residencia: tenant?.residenciaEnabled === true,
  });
  await prisma.employeeCategory.createMany({
    data: deSerie.map((c) => ({
      tenantId,
      code: c.code,
      name: c.name,
      countsAsDirectCare: c.atencionDirecta,
      isStandard: true,
      sortOrder: c.orden,
    })),
    skipDuplicates: true,
  });
  return deSerie.length;
}

// ── Cargar un cuadrante ───────────────────────────────────────────────

export interface CuadranteCargado {
  /** `null` si el mes no tiene cuadrante todavía. */
  cabecera: {
    id: string;
    month: string;
    state: string;
    origin: string;
    publishedAt: string | null;
    publishedBy: string | null;
    warningsAtPublish: number | null;
  } | null;
  cuadrante: Cuadrante;
  reglas: ReglasDelCuadrante;
  avisos: AvisoDelCuadrante[];
  resumen: ResumenDeAvisos;
  /** Las personas, con lo que la rejilla necesita para pintar su fila. */
  personas: Array<
    PersonaDelCuadrante & { active: boolean; categoria: string | null }
  >;
}

/**
 * Todo lo que la pantalla del cuadrante necesita, en una lectura.
 *
 * Una y no cinco: la rejilla, los avisos y el resumen salen del MISMO
 * cuadrante. Si los avisos se pidieran aparte, un toque podría pintar una
 * celda contra una lista de avisos de hace dos segundos.
 */
export async function cargarCuadrante(
  tenantId: string,
  mes: string,
  prisma: Ejecutor = getPrisma(),
): Promise<CuadranteCargado> {
  const [cabecera, turnos, reglas, empleados, categorias] = await Promise.all([
    prisma.staffSchedule.findUnique({
      where: { tenantId_month: { tenantId, month: mes } },
      select: {
        id: true,
        month: true,
        state: true,
        origin: true,
        publishedAt: true,
        publishedBy: true,
        warningsAtPublish: true,
      },
    }),
    turnosDelTenant(tenantId, prisma),
    reglasDelTenant(tenantId, prisma),
    prisma.employee.findMany({
      where: { tenantId },
      select: {
        id: true,
        name: true,
        lastName: true,
        active: true,
        categoryId: true,
        weeklyMinutes: true,
        hiredOn: true,
        contractEndsOn: true,
      },
      orderBy: [{ active: "desc" }, { lastName: "asc" }, { name: "asc" }],
    }),
    prisma.employeeCategory.findMany({
      where: { tenantId },
      select: { id: true, name: true, countsAsDirectCare: true },
    }),
  ]);

  const porCategoria = new Map(categorias.map((c) => [c.id, c]));
  const personas = empleados.map((e) => ({
    employeeId: e.id,
    nombre: nombreCompleto(e),
    atencionDirecta:
      e.categoryId != null &&
      porCategoria.get(e.categoryId)?.countsAsDirectCare === true,
    minutosContratados: e.weeklyMinutes,
    altaEl: e.hiredOn == null ? null : e.hiredOn.toISOString().slice(0, 10),
    finEl:
      e.contractEndsOn == null
        ? null
        : e.contractEndsOn.toISOString().slice(0, 10),
    active: e.active,
    categoria: e.categoryId == null ? null : (porCategoria.get(e.categoryId)?.name ?? null),
  }));

  const celdas = cabecera
    ? (
        await prisma.staffScheduleCell.findMany({
          where: { scheduleId: cabecera.id },
          select: {
            employeeId: true,
            day: true,
            centerShiftId: true,
            absenceKind: true,
          },
          orderBy: [{ day: "asc" }],
        })
      ).map((c) => ({
        employeeId: c.employeeId,
        dia: c.day.toISOString().slice(0, 10),
        turnoId: c.centerShiftId,
        ausencia: c.absenceKind,
      }))
    : [];

  const cuadrante: Cuadrante = {
    mes,
    turnos,
    // **Sólo las personas de alta entran en las reglas.** Quien se fue no
    // tiene cobertura que cubrir ni jornada que cumplir, y contarla dejaría
    // avisos que no se pueden cerrar. Sus celdas de meses pasados siguen
    // ahí: el cuadrante publicado dice quién tenía qué turno.
    personas: personas.filter((p) => p.active),
    celdas,
    ocupacionPorDia: reglas.conRatioDeResidencia
      ? await ocupacionDelMes(tenantId, mes, prisma)
      : undefined,
  };

  const avisos = comprobarCuadrante(cuadrante, reglas);
  return {
    cabecera: cabecera
      ? {
          ...cabecera,
          publishedAt: cabecera.publishedAt?.toISOString() ?? null,
        }
      : null,
    cuadrante,
    reglas,
    avisos,
    resumen: resumenDeAvisos(avisos),
    personas,
  };
}

/**
 * Plazas **ocupadas** cada día del mes.
 *
 * Se cuenta sobre `bed_assignments`, que es la fuente de «quién ocupa qué
 * cama» desde residencia-1: una ocupación vale ese día si empezó antes de
 * que el día acabara y no se cerró antes de que empezara. Es la misma
 * cuenta que `panel.ts` hace para la ocupación media del mes — **no hay
 * una columna de «plazas» que pueda discrepar del edificio**.
 *
 * Un día del futuro sale con las ocupaciones vigentes de hoy, que es lo
 * que se sabe: el cuadrante del mes que viene se hace sin saber quién
 * ingresará. Eso hace que la ratio de un mes futuro sea una estimación, y
 * es la buena — suponer cero plazas diría «cumple» siempre.
 */
export async function ocupacionDelMes(
  tenantId: string,
  mes: string,
  prisma: Ejecutor = getPrisma(),
): Promise<Record<string, number>> {
  const { desdeAt, hastaAt } = rangoDelMes(mes);
  const ocupaciones = await prisma.bedAssignment.findMany({
    where: {
      tenantId,
      fromAt: { lt: hastaAt },
      OR: [{ toAt: null }, { toAt: { gte: desdeAt } }],
    },
    select: { fromAt: true, toAt: true },
  });
  const fuera: Record<string, number> = {};
  for (const dia of diasDe(mes)) {
    const inicio = new Date(`${dia}T00:00:00Z`).getTime();
    const fin = inicio + 86_400_000;
    fuera[dia] = ocupaciones.filter(
      (o) =>
        o.fromAt.getTime() < fin &&
        (o.toAt == null || o.toAt.getTime() >= inicio),
    ).length;
  }
  return fuera;
}

// ── Escribir una celda ────────────────────────────────────────────────

export class CuadranteRechazado extends Error {}

/**
 * **La ÚNICA vía desde la aplicación para pintar una celda.**
 *
 * Llama a `set_staff_schedule_day(...)`, que es la función `SECURITY
 * DEFINER` de la migración. Lo que esto no hace —y es el punto— es
 * escribir en `staff_schedule_cells`: eso lo hace la función, después de
 * dejar la traza si el cuadrante está publicado.
 *
 * Devuelve el id del cambio registrado, o `null` cuando no había nada que
 * cambiar (es idempotente) o cuando el cuadrante está en borrador.
 *
 * Los errores de la función llegan con su prefijo (`CUADRANTE_SIN_MOTIVO`,
 * `CUADRANTE_INVALIDO`…) y se traducen a `CuadranteRechazado` para que la
 * ruta conteste un 400 con la frase de la base en vez de un 500. Mismo
 * reparto que `TimeCorrectionRejectedError` en ADR-018.
 */
export async function ponerCelda(
  prisma: Ejecutor,
  entrada: {
    scheduleId: string;
    employeeId: string;
    dia: string;
    /** Los turnos del día. Vacío + ausencia `null` = dejar el día en blanco. */
    turnoIds: string[];
    ausencia: string | null;
    /** Obligatorios si el cuadrante está publicado. */
    motivo?: string | null;
    autor?: string | null;
    autorUserId?: string | null;
  },
): Promise<string | null> {
  try {
    const filas = await prisma.$queryRawUnsafe<Array<{ id: string | null }>>(
      `SELECT set_staff_schedule_day($1::uuid, $2::uuid, $3::date, $4::uuid[], $5::text, $6::text, $7::text, $8::uuid) AS id`,
      entrada.scheduleId,
      entrada.employeeId,
      entrada.dia,
      entrada.turnoIds,
      entrada.ausencia,
      entrada.motivo ?? null,
      entrada.autor ?? null,
      entrada.autorUserId ?? null,
    );
    return filas[0]?.id ?? null;
  } catch (err) {
    const texto = String((err as { message?: string }).message ?? err);
    if (texto.includes("CUADRANTE_")) {
      throw new CuadranteRechazado(fraseDeLaBase(texto));
    }
    throw err;
  }
}

// ── El turno planificado de un tramo que se está cerrando ────────────

/**
 * El fin del turno que le tocaba a este tramo, o `null` si no tenía.
 *
 * Es lo único que `esSalidaOlvidada` necesita del cuadrante, y lo piden
 * las tres superficies de #45: el cierre, la pantalla del empleado y
 * «Hoy».
 *
 * ── SÓLO CUENTA EL CUADRANTE **PUBLICADO** ──────────────────────────
 *
 * Y es la decisión que importa de esta función. Un borrador es lo que la
 * dirección está pintando ahora mismo: puede tener la mitad del mes en
 * blanco, o un turno puesto por error que nadie ha visto todavía. Si el
 * borrador decidiera, pintar una mañana en la celda equivocada haría que
 * a alguien le preguntaran por una salida que no ha olvidado — y, peor, un
 * mes sin empezar a pintar dejaría a todo el mundo sin turno y el
 * comportamiento cambiaría de un día para otro sin que nadie tocara nada.
 *
 * Publicado es lo que la gente vio en su móvil. Eso es lo que puede
 * decidir.
 *
 * Si todo lo planificado de ese día acaba **antes** de que la persona
 * entrara, devuelve `null`: ahí el turno no aprieta, delira (ver
 * `finDelTurnoDelDia` en el paquete).
 */
export async function finPlanificadoDe(
  tenantId: string,
  entrada: { employeeId: string; startedAt: Date },
  dia: string,
  prisma: Ejecutor = getPrisma(),
): Promise<Date | null> {
  try {
    const mes = dia.slice(0, 7);
    const cabecera = await prisma.staffSchedule.findUnique({
      where: { tenantId_month: { tenantId, month: mes } },
      select: { id: true, state: true },
    });
    if (!cabecera || cabecera.state !== "PUBLICADO") return null;
    const celdas = await prisma.staffScheduleCell.findMany({
      where: {
        scheduleId: cabecera.id,
        employeeId: entrada.employeeId,
        day: new Date(`${dia}T12:00:00Z`),
        centerShiftId: { not: null },
      },
      select: { centerShiftId: true },
    });
    if (celdas.length === 0) return null;
    const turnos = await turnosDelTenant(tenantId, prisma);
    const planificado = planificadoDelDia(
      dia,
      celdas.map((c) => ({
        employeeId: entrada.employeeId,
        turnoId: c.centerShiftId,
      })),
      turnos,
    );
    return finDelTurnoDelDia(planificado, entrada.startedAt);
  } catch {
    // **Falla hacia «sin turno»**, que es el comportamiento de #45. Mismo
    // criterio que `maxOpenHoursFor`: si el cuadrante no se puede leer,
    // ese tenant se comporta como los que no tienen cuadrante. Tumbar un
    // cierre de turno por no poder leer una celda sería al revés.
    return null;
  }
}

/**
 * El turno planificado de un tramo, **tal y como `esSalidaOlvidada` lo
 * quiere**: el fin y el margen del tenant, o `null`.
 *
 * Es el único punto de unión entre el cuadrante y el fichaje, y existe
 * para que `routes.ts` no tenga que saber que hacen falta dos lecturas (el
 * fin y el margen) ni en qué orden. Las tres superficies de #45 llaman a
 * esto y le pasan el resultado a la misma función de siempre.
 */
export async function turnoDelTramo(
  tenantId: string,
  entrada: { employeeId: string; startedAt: Date },
  dia: string,
  prisma: Ejecutor = getPrisma(),
): Promise<{ finAt: Date; margenHoras: number } | null> {
  const finAt = await finPlanificadoDe(tenantId, entrada, dia, prisma);
  if (finAt == null) return null;
  return { finAt, margenHoras: await margenDeTurnoFor(tenantId, prisma) };
}

/**
 * Y lo mismo para VARIOS tramos de una vez, que es lo que «Hoy» necesita.
 *
 * Una consulta por mes implicado y no una por tramo: el panel de una
 * residencia con 21 personas tiene veintiún tramos abiertos a media mañana,
 * y veintiuna lecturas del cuadrante para pintar una pantalla que se
 * refresca cada minuto es lo que después se nota en la factura del VPS.
 *
 * La clave del mapa es `employeeId|dia`, que es la unidad del cuadrante.
 */
export async function finesPlanificadosDe(
  tenantId: string,
  tramos: Array<{ employeeId: string; startedAt: Date; dia: string }>,
  prisma: Ejecutor = getPrisma(),
): Promise<Map<string, Date>> {
  const fuera = new Map<string, Date>();
  if (tramos.length === 0) return fuera;
  try {
    const meses = [...new Set(tramos.map((t) => t.dia.slice(0, 7)))];
    const cabeceras = await prisma.staffSchedule.findMany({
      where: { tenantId, month: { in: meses }, state: "PUBLICADO" },
      select: { id: true, month: true },
    });
    if (cabeceras.length === 0) return fuera;
    const turnos = await turnosDelTenant(tenantId, prisma);
    const celdas = await prisma.staffScheduleCell.findMany({
      where: {
        scheduleId: { in: cabeceras.map((c) => c.id) },
        employeeId: { in: [...new Set(tramos.map((t) => t.employeeId))] },
        centerShiftId: { not: null },
      },
      select: { employeeId: true, day: true, centerShiftId: true },
    });
    // Por (persona, día), que es cómo se pregunta.
    const porClave = new Map<string, string[]>();
    for (const c of celdas) {
      const clave = `${c.employeeId}|${c.day.toISOString().slice(0, 10)}`;
      const l = porClave.get(clave);
      if (l) l.push(c.centerShiftId!);
      else porClave.set(clave, [c.centerShiftId!]);
    }
    for (const t of tramos) {
      const clave = `${t.employeeId}|${t.dia}`;
      const ids = porClave.get(clave);
      if (!ids) continue;
      const fin = finDelTurnoDelDia(
        planificadoDelDia(
          t.dia,
          ids.map((id) => ({ employeeId: t.employeeId, turnoId: id })),
          turnos,
        ),
        t.startedAt,
      );
      if (fin) fuera.set(clave, fin);
    }
    return fuera;
  } catch {
    // Falla hacia «sin turno», como la de arriba.
    return fuera;
  }
}

/**
 * El mensaje del `RAISE`, sin el ruido que Prisma le cuelga alrededor.
 *
 * Copia declarada de `cleanPgMessage` de `corrections.ts`, y con su misma
 * forma por la misma razón: **el mensaje de Prisma empieza con una línea
 * vacía**. La primera versión de esto hacía `split("\n")[0]` y devolvía la
 * cadena vacía, así que la pantalla contestaba un 400 sin frase. Lo
 * encontró el e2e.
 *
 * El `[^\n]*` para el cuerpo y no `.*`: el mensaje de plpgsql acaba en el
 * salto de línea, y detrás viene el `CONTEXT:` con el nombre de la función
 * y el número de línea — que no es para quien está pintando el mes.
 */
export function fraseDeLaBase(raw: string): string {
  const m = raw.match(/CUADRANTE_[A-Z_]+:\s*([^\n]*)/);
  if (!m) return raw;
  // Y sin la comilla con la que Prisma cierra el `Message:` de su propio
  // envoltorio.
  return m[1]!.replace(/`\s*$/, "").trim();
}

/** La cabecera del mes, creándola en BORRADOR si no existe. */
export async function asegurarCuadrante(
  tenantId: string,
  mes: string,
  userId: string | null,
  prisma: Ejecutor = getPrisma(),
): Promise<{ id: string; state: string }> {
  const ya = await prisma.staffSchedule.findUnique({
    where: { tenantId_month: { tenantId, month: mes } },
    select: { id: true, state: true },
  });
  if (ya) return ya;
  try {
    return await prisma.staffSchedule.create({
      data: { tenantId, month: mes, createdByUserId: userId },
      select: { id: true, state: true },
    });
  } catch {
    // Dos aperturas simultáneas del mismo mes: gana la primera. Mismo
    // cierre de carrera que `asegurarDek`.
    return prisma.staffSchedule.findUniqueOrThrow({
      where: { tenantId_month: { tenantId, month: mes } },
      select: { id: true, state: true },
    });
  }
}
