// residencia-4 (D-20) · **LOS EVENTOS QUE NADIE DECLARA.**
//
// «Buena parte de los eventos no se declaran: se derivan» (rama de
// controles §6). Dos generadores, y están aquí los dos porque comparten
// todo lo que importa —la plantilla, la deduplicación y el aviso— y se
// diferencian sólo en de dónde sale el disparo:
//
//   · **por umbral** — al llegar un `CareRecord` de una constante que
//     cruza umbral. La auxiliar teclea 38,4 y **el sistema declara la
//     incidencia**: ella no tiene que decidir si «esto es para avisar»,
//     que es justo la decisión que hoy sale distinta según quién esté de
//     turno (rama §2, «la constante es el único control que dispara un
//     aviso sin juicio humano»);
//   · **por ausencia** — una pasada programada por centro y `care_day`
//     que mira lo que NO hay: sin deposición más de tres días, «nada» en
//     dos comidas seguidas.
//
// ── Y UN TERCERO QUE NO ES NI UNO NI OTRO ───────────────────────────
//
// Lo DECLARADO con tipo: la auxiliar pulsa «Caída» y contesta «se ha dado
// en la cabeza». Eso no se deriva —lo dice una persona— pero gradúa con
// la misma plantilla y abre la misma incidencia, así que entra por la
// misma puerta (`derivarDeEvento`). Tener dos caminos habría significado
// dos sitios donde acordarse de avisar.
//
// ── EL VÓMITO REPETIDO SE CUENTA AL DECLARAR, NO EN LA PASADA ───────
//
// El prompt lo pone en la lista de la pasada por ausencia. Se hace **al
// declarar el segundo**, y es una decisión declarada en el done: el
// resultado es el mismo (N2) y la diferencia es que así el móvil suena
// cuando el segundo vómito ocurre y no cuando la pasada pase. Un N2 que
// llega veinte minutos tarde no es un N2.

import type { PrismaClient } from "@mipiacetpv/db";
import {
  conAvisoForzado,
  diaDelTurno,
  turnoDe,
  type Nivel,
} from "@mipiacetpv/residencia-plan";

import {
  leerJson,
  sitioValorDeRegistro,
} from "../clinica/cripto-campos.js";
import { MATICES, TIPOS_DE_INCIDENCIA } from "./catalogo/plantilla-de-gravedad.js";
import {
  contextoDeGravedad,
  gravedadDeLaMedida,
  gravedadDelEvento,
  type ContextoDeGravedad,
} from "./gravedad.js";
import {
  declararIncidencia,
  type Firma,
  type ResultadoDeDeclaracion,
} from "./incidencias.js";
import { dekParaLeer } from "./registro.js";

/** Lo que la puerta manda y lo que la derivación necesita saber. */
export interface MedidaRegistrada {
  tenantId: string;
  clientId: string;
  /** El `CareRecord` que la contiene. Es la evidencia de la incidencia. */
  recordId: string;
  controlCode: string;
  /** El valor medido, ya validado contra `inputMin`/`inputMax`. */
  numero: number;
  recordedAt: Date;
  centerShiftId: string | null;
  careDay: string;
  deviceId: string | null;
  roomId: string | null;
  firma: Firma;
  /** «No puede esperar: avisar a la enfermera». Fuerza al menos N2. */
  avisarEnfermera?: boolean;
  ahora: Date;
}

/**
 * **POR UMBRAL.** `null` cuando la medida no gradúa nada.
 *
 * Que devuelva `null` es el caso MAYORITARIO y tiene que ser barato: un
 * peso, un pulso, una temperatura de 36,4. Por eso la plantilla y las
 * excepciones se leen una sola vez por lote y entran por `ctx`.
 */
export async function derivarDeLaMedida(
  prisma: PrismaClient,
  ctx: ContextoDeGravedad,
  m: MedidaRegistrada,
): Promise<ResultadoDeDeclaracion | null> {
  const gravedad = gravedadDeLaMedida(ctx, m.controlCode, m.numero);
  // Sin umbral cruzado, el botón de la enfermera sigue valiendo: una
  // auxiliar que teclea 37,2 y pulsa «no puede esperar» está diciendo
  // algo que la plantilla no gradúa, y eso es exactamente para lo que
  // existe el botón (alcance 7).
  if (gravedad == null && !m.avisarEnfermera) return null;

  const nivel: Nivel = m.avisarEnfermera
    ? conAvisoForzado(gravedad?.nivel ?? null)
    : gravedad!.nivel;
  const tipo = gravedad?.tipo ?? TIPOS_DE_INCIDENCIA.ALGO_NO_VA_BIEN;

  return declararIncidencia(prisma, {
    tenantId: m.tenantId,
    subject: "RESIDENT",
    clientId: m.clientId,
    origin: "DERIVED_THRESHOLD",
    tipo,
    nivel,
    templateVersion: ctx.plantilla.version,
    sourceRecordId: m.recordId,
    deviceId: m.deviceId,
    roomId: m.roomId,
    centerShiftId: m.centerShiftId,
    careDay: m.careDay,
    occurridoEn: m.recordedAt,
    queuedAt: m.recordedAt,
    firma: m.firma,
    ahora: m.ahora,
  });
}

/** Lo que la puerta manda cuando alguien pulsa un tipo en «algo no va
 *  bien» — o cuando el admin declara una queja o una avería. */
export interface EventoDeclarado {
  tenantId: string;
  subject: "RESIDENT" | "COMPLAINT" | "MAINTENANCE";
  clientId: string | null;
  /** `CAIDA`, `VOMITO`, `AVERIA`… Vacío = «algo no va bien» a secas. */
  evento: string | null;
  /** La respuesta a la pregunta única: `CON_GOLPE`, `SIN_RIESGO`… */
  matiz: string | null;
  descripcion?: string | null;
  /** El `CareRecord` de «algo no va bien», si lo hubo. */
  recordId?: string | null;
  occurridoEn: Date;
  centerShiftId: string | null;
  careDay: string;
  deviceId?: string | null;
  roomId?: string | null;
  firma: Firma;
  avisarEnfermera?: boolean;
  ahora: Date;
}

/**
 * **LO DECLARADO, con o sin tipo.**
 *
 * Sin tipo es N1 por su propia fila de la plantilla (D-13: «algo no va
 * bien» a secas es un registro completo y vale N1). Con tipo, lo que diga
 * la plantilla. Y con el botón de la enfermera, **al menos N2** sobre lo
 * que salga.
 */
export async function derivarDeEvento(
  prisma: PrismaClient,
  e: EventoDeclarado,
): Promise<ResultadoDeDeclaracion> {
  const ctx = await contextoDeGravedad(prisma, {
    tenantId: e.tenantId,
    clientId: e.clientId,
    instante: e.occurridoEn,
  });
  const evento = e.evento ?? TIPOS_DE_INCIDENCIA.ALGO_NO_VA_BIEN;

  // El vómito repetido en el turno. Se cuenta aquí, contra lo que ya hay
  // abierto y contra lo que ya se declaró en este turno, y no en una
  // pasada: ver la cabecera del fichero.
  let matiz = e.matiz;
  if (evento === TIPOS_DE_INCIDENCIA.VOMITO && matiz == null && e.clientId) {
    // «Repetido» = ya hay un vómito de ESTE turno. Se cuenta el
    // histórico del turno y no sólo lo abierto: uno que alguien cerró a
    // las 15:10 y otro a las 15:40 siguen siendo dos vómitos en el mismo
    // turno, y el segundo es el que sube a N2.
    const delTurno = await prisma.incident.count({
      where: {
        tenantId: e.tenantId,
        clientId: e.clientId,
        incidentType: TIPOS_DE_INCIDENCIA.VOMITO,
        careDay: e.careDay,
        centerShiftId: e.centerShiftId,
      },
    });
    if (delTurno > 0) matiz = MATICES.REPETIDO;
  }

  const gravedad = gravedadDelEvento(ctx, evento, matiz);
  const base: Nivel = gravedad?.nivel ?? "N1";
  const nivel = e.avisarEnfermera ? conAvisoForzado(base) : base;
  const tipo = gravedad?.tipo ?? TIPOS_DE_INCIDENCIA.ALGO_NO_VA_BIEN;

  return declararIncidencia(prisma, {
    tenantId: e.tenantId,
    subject: e.subject,
    clientId: e.clientId,
    origin: "DECLARED",
    tipo,
    nivel,
    templateVersion: ctx.plantilla.version,
    descripcion: e.descripcion ?? null,
    sourceRecordId: e.recordId ?? null,
    deviceId: e.deviceId ?? null,
    roomId: e.roomId ?? null,
    centerShiftId: e.centerShiftId,
    careDay: e.careDay,
    occurridoEn: e.occurridoEn,
    queuedAt: e.occurridoEn,
    firma: e.firma,
    ahora: e.ahora,
  });
}

// ════════════════════════════════════════════════════════════════════
//  POR AUSENCIA · la pasada programada
// ════════════════════════════════════════════════════════════════════
//
// Lo que NO hay. Es la mitad de D-20 que no se puede disparar con un
// `INSERT`, porque el disparo es que no haya habido ninguno.
//
// ── POR CENTRO Y POR `care_day`, no por reloj ───────────────────────
//
// La pasada corre cada hora y por cada centro con la residencia
// encendida, y lo que mira es el DÍA DEL CENTRO. Con la fecha del reloj,
// la ronda de la madrugada caería en el día siguiente y «tres días sin
// deposición» se contaría mal justo en el turno en que una residencia
// está más sola.
//
// ── IDEMPOTENTE POR CONSTRUCCIÓN ────────────────────────────────────
//
// No hace falta una marca de «ya pasé hoy»: la deduplicación de
// `declararIncidencia` ya impide abrir dos incidencias del mismo tipo
// para el mismo residente mientras la primera siga abierta. Una pasada
// que corre veinte veces el mismo día abre UNA incidencia de
// `SIN_DEPOSICION`, y la vigésima primera vez se adjunta a ella sin hacer
// nada. Es lo mismo que hace la segunda toma de fiebre.
//
// Lo que sí hace falta es **que la cierre alguien** para que vuelva a
// abrirse: una vez cerrada, si al día siguiente sigue sin haber
// deposición, la pasada abre otra. Y eso es correcto — es otro día sin
// deposición.

/** Cuántos días sin deposición abren incidencia. Del §3. */
export const DIAS_SIN_DEPOSICION = 3;
/** Y cuántas comidas seguidas con «nada». */
export const COMIDAS_SEGUIDAS_SIN_COMER = 2;

/** El código del control de deposición y los de las comidas, del catálogo
 *  de serie de residencia-2. */
const CONTROL_DEPOSICION = "DEPOSICION";
const CONTROLES_DE_COMIDA = ["DESAYUNO", "COMIDA", "MERIENDA", "CENA"];
/** La opción ordinal que significa «no ha comido nada». */
const OPCION_NADA = "NADA";

export interface ResultadoDeLaPasada {
  tenantId: string;
  careDay: string;
  sinDeposicion: string[];
  sinComer: string[];
  errores: number;
}

/**
 * **La pasada de ausencias de UN centro.**
 *
 * Separada del worker para que el e2e pueda ejecutarla con un reloj falso
 * sin levantar Redis — la misma decisión que `runDayCutPass` de v1.13, y
 * por la misma razón: si el worker compusiera la pasada, desconectarla no
 * pondría nada rojo.
 */
export async function pasadaDeAusencias(
  prisma: PrismaClient,
  tenantId: string,
  ahora: Date,
): Promise<ResultadoDeLaPasada> {
  const turnos = await prisma.centerShift.findMany({
    where: { tenantId },
    orderBy: [{ sortOrder: "asc" }],
    select: { id: true, code: true, name: true, startsAt: true, endsAt: true },
  });
  const turno = turnoDe(ahora, turnos);
  const careDay = diaDelTurno(ahora, turno);

  const salida: ResultadoDeLaPasada = {
    tenantId,
    careDay,
    sinDeposicion: [],
    sinComer: [],
    errores: 0,
  };

  // Quién vive aquí HOY. Sólo los que ocupan una cama vigente: un
  // residente dado de alta hace un mes no lleva tres días sin deposición,
  // lleva un mes fuera.
  const ocupaciones = await prisma.bedAssignment.findMany({
    where: { tenantId, toAt: null },
    select: {
      clientId: true,
      bed: { select: { roomId: true } },
    },
  });
  if (ocupaciones.length === 0) return salida;

  // ── Quién firma lo que la pasada declara ─────────────────────────
  //
  // No hay nadie delante, y la firma no puede ser nula: todo lo del libro
  // lleva persona + capacidad (D-31). Firma **el rol de dirección del
  // centro**, que es quien responde de que el indicador exista. Si no hay
  // nadie con rol directivo vigente, la pasada **no inventa una firma**:
  // no declara y lo dice en el resultado. Un centro sin dirección
  // asignada es un centro sin configurar, y la respuesta es configurarlo.
  const firmante = await prisma.careRoleAssignment.findFirst({
    where: {
      tenantId,
      revokedAt: null,
      fromAt: { lte: ahora },
      OR: [{ toAt: null }, { toAt: { gt: ahora } }],
      careRole: { active: true, category: "DIRECTIVO" },
    },
    orderBy: { fromAt: "asc" },
    select: { id: true, userId: true },
  });
  if (!firmante) {
    salida.errores = 1;
    return salida;
  }
  const firma: Firma = {
    userId: firmante.userId,
    careRoleAssignmentId: firmante.id,
  };

  const porCliente = new Map(
    ocupaciones.map((o) => [o.clientId, o.bed.roomId] as const),
  );
  const clientIds = [...porCliente.keys()];

  // ── 1 · Sin deposición más de tres días ──────────────────────────
  //
  // «Más de 3 días» se cuenta sobre `care_day`, que es el día del CENTRO.
  // La ventana son los días `careDay`, `careDay-1` y `careDay-2`: si no
  // hay ni una deposición en esos tres, el cuarto día sin ella es hoy.
  const desdeDia = restarDias(careDay, DIAS_SIN_DEPOSICION - 1);
  const conDeposicion = await prisma.careRecord.groupBy({
    by: ["clientId"],
    where: {
      tenantId,
      clientId: { in: clientIds },
      controlCode: CONTROL_DEPOSICION,
      careDay: { gte: desdeDia, lte: careDay },
      voidedAt: null,
    },
    _count: { _all: true },
  });
  const tuvieron = new Set(conDeposicion.map((g) => g.clientId));

  for (const clientId of clientIds) {
    if (tuvieron.has(clientId)) continue;
    // Y además: tiene que LLEVAR tres días aquí. Alguien que ingresó
    // ayer no lleva tres días sin deposición — lleva un día, y abrir una
    // incidencia el día del ingreso es la clase de ruido que hace que
    // nadie mire el libro.
    const lleva = await prisma.careRecord.count({
      where: {
        tenantId,
        clientId,
        careDay: { lt: desdeDia },
      },
    });
    if (lleva === 0) continue;
    try {
      await declararIncidencia(prisma, {
        tenantId,
        subject: "RESIDENT",
        clientId,
        origin: "DERIVED_ABSENCE",
        tipo: TIPOS_DE_INCIDENCIA.SIN_DEPOSICION,
        nivel: "N1",
        templateVersion: null,
        roomId: porCliente.get(clientId) ?? null,
        centerShiftId: turno?.id ?? null,
        careDay,
        occurridoEn: ahora,
        firma,
        ahora,
      });
      salida.sinDeposicion.push(clientId);
    } catch {
      // Un residente que falla no para la pasada: los otros 48 tienen que
      // mirarse igual. Mismo criterio que `runDayCutPass`.
      salida.errores += 1;
    }
  }

  // ── 2 · «Nada» en dos comidas seguidas ───────────────────────────
  //
  // «Seguidas» en el orden del día: desayuno → comida → merienda → cena.
  // Se mira el día del centro entero, porque una cena de ayer y un
  // desayuno de hoy son dos comidas seguidas y están en dos `care_day`
  // distintos — por eso la ventana son dos días y la secuencia se arma
  // en memoria.
  const ayer = restarDias(careDay, 1);
  const comidas = await prisma.careRecord.findMany({
    where: {
      tenantId,
      clientId: { in: clientIds },
      controlCode: { in: CONTROLES_DE_COMIDA },
      careDay: { in: [ayer, careDay] },
      voidedAt: null,
      correctsRecordId: null,
    },
    orderBy: { recordedAt: "asc" },
    select: {
      id: true,
      clientId: true,
      controlCode: true,
      careDay: true,
      recordedAt: true,
      valueCifrado: true,
      tenantId: true,
    },
  });

  // El valor va cifrado, así que «¿comió nada?» no se puede preguntar en
  // SQL. Se descifra lo del día y se mira en memoria: son cuatro filas
  // por residente y por día, no el histórico.
  const dek = await dekParaLeer(tenantId, prisma);

  const porResidente = new Map<string, Array<{ orden: number; nada: boolean }>>();
  for (const c of comidas) {
    const valor = leerJson(
      { cifrado: c.valueCifrado, claro: null },
      dek,
      sitioValorDeRegistro(c.tenantId, c.id),
    ) as { opcion?: unknown } | null;
    const nada =
      typeof valor?.opcion === "string" && valor.opcion === OPCION_NADA;
    const orden =
      (c.careDay === ayer ? 0 : 10) + CONTROLES_DE_COMIDA.indexOf(c.controlCode);
    const lista = porResidente.get(c.clientId) ?? [];
    lista.push({ orden, nada });
    porResidente.set(c.clientId, lista);
  }

  for (const [clientId, lista] of porResidente) {
    lista.sort((a, b) => a.orden - b.orden);
    let seguidas = 0;
    let llega = false;
    for (const c of lista) {
      seguidas = c.nada ? seguidas + 1 : 0;
      if (seguidas >= COMIDAS_SEGUIDAS_SIN_COMER) llega = true;
    }
    if (!llega) continue;
    try {
      await declararIncidencia(prisma, {
        tenantId,
        subject: "RESIDENT",
        clientId,
        origin: "DERIVED_ABSENCE",
        tipo: TIPOS_DE_INCIDENCIA.INGESTA_NULA,
        nivel: "N1",
        templateVersion: null,
        roomId: porCliente.get(clientId) ?? null,
        centerShiftId: turno?.id ?? null,
        careDay,
        occurridoEn: ahora,
        firma,
        ahora,
      });
      salida.sinComer.push(clientId);
    } catch {
      salida.errores += 1;
    }
  }

  return salida;
}

/** «YYYY-MM-DD» menos N días, en calendario. Hermana de `siguienteDia`
 *  de `puerta-registro-routes.ts`; son cuatro líneas y moverlas a un
 *  sitio común significaría decidir cuál. */
export function restarDias(fecha: string, dias: number): string {
  const [y, m, d] = fecha.split("-").map(Number);
  const t = new Date(Date.UTC(y!, m! - 1, d! - dias));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(
    t.getUTCDate(),
  ).padStart(2, "0")}`;
}

/** La pasada de TODOS los centros con la residencia encendida. */
export async function pasadaDeAusenciasGlobal(
  prisma: PrismaClient,
  ahora: Date = new Date(),
): Promise<ResultadoDeLaPasada[]> {
  const centros = await prisma.tenant.findMany({
    where: { residenciaEnabled: true },
    select: { id: true },
  });
  const salida: ResultadoDeLaPasada[] = [];
  for (const c of centros) {
    try {
      salida.push(await pasadaDeAusencias(prisma, c.id, ahora));
    } catch {
      salida.push({
        tenantId: c.id,
        careDay: "",
        sinDeposicion: [],
        sinComer: [],
        errores: 1,
      });
    }
  }
  return salida;
}
