// residencia-5 (D-18, D-19, D-58) · **EL PARTE DE RELEVO SE GENERA SOLO.**
//
// Hoy el cambio de turno se hace de palabra y con una hoja en la sala: lo
// que no se dice se pierde, y nadie puede demostrar que se dijo. Este
// fichero es lo que convierte **lo que ya está registrado** en el parte
// que el turno entrante lee. **Nadie lo escribe.**
//
// ── LAS NUEVE COSAS QUE EL PARTE CUENTA, Y NADA MÁS ─────────────────
//
// El prompt las enumera y están todas, en este orden:
//
//   1. incidencias **nuevas** del turno (N1 en adelante), con su nivel, si
//      hubo aviso y quién lo acusó;
//   2. incidencias **abiertas** que vienen de antes y siguen abiertas;
//   3. «algo no va bien» del turno, con el texto descifrado y, si hay nota
//      de voz, que la hay;
//   4. constantes del turno **fuera de rango**;
//   5. **lo que no se hizo** (`loQueNoSeHizo`, el paquete puro);
//   6. cambios del **plan de cuidados** del turno;
//   7. **excepciones de umbral** nuevas;
//   8. **registros sin turno**;
//   9. **avisos que no salieron a tiempo**;
//  10. residencia-6 · **los residentes sin plan de cuidados**, una línea
//      por zona.
//
// Lo que NO lleva es todo lo demás. Un parte con los 1.200 registros del
// turno es un parte que nadie lee, y el bloque entero depende de que se
// lea: «como siempre» por residente **no sale**, porque el denominador ya
// está en el panel y aquí lo que hace falta es lo que se desvía (D-16).
//
// ── UN TURNO SIN NADA QUE CONTAR SE CONFIRMA IGUAL ──────────────────
//
// `sinNovedades` y la frase «Turno sin novedades». Es la misma lógica del
// «como siempre»: el denominador cuenta tanto como lo que pasa, y una
// noche sin incidencias confirmada por quien entra es evidencia de que
// alguien lo miró — no de que no hubiera nada.
//
// ── POR ZONA, PORQUE LA CONFIRMACIÓN ES POR ZONA ────────────────────
//
// Cada línea cae en la planta del residente al que le pasó, y lo que no es
// de ningún residente (una avería del office, una queja sin residente
// identificado) cae en **la zona del centro**, que sólo cubre una
// confirmación de alcance total (D-51, decisión de producto 3).
//
// ── LA MISMA FUNCIÓN EN VIVO Y AL CONGELAR ──────────────────────────
//
// `construirParte` es una sola, y lo que cambia es el `corte`. En vivo, el
// corte es «ahora» y no hay fila en la base; al cerrar el turno, el corte
// es el final del turno y el resultado se cifra y se escribe. Dos
// funciones habrían sido dos partes que se pueden separar, y entonces lo
// que la sala enseña a las 14:55 no sería lo que se congela a las 15:00.

import type { PrismaClient } from "@mipiacetpv/db";
import {
  addDays,
  cruzaMedianoche,
  loQueNoSeHizo,
  queToca,
  utcToWallTime,
  wallTimeToUtc,
  type ControlParaNoHecho,
  type RegistroHecho,
} from "@mipiacetpv/residencia-plan";

import {
  cifrarTexto,
  leerJson,
  leerTexto,
  nuevoIdDeFila,
  sitioContenidoDeRelevo,
  sitioDescripcionDeIncidencia,
  sitioNotaDeRegistro,
  sitioResumenTardio,
  sitioValorDeRegistro,
} from "../clinica/cripto-campos.js";
import { dekONada } from "../clinica/claves.js";
import { FRECUENCIA_SELECT, deColumnas } from "./frecuencia-columnas.js";
import { NOMBRE_DEL_NIVEL, NOMBRE_DEL_TIPO } from "./catalogo/plantilla-de-gravedad.js";

// ── LO QUE EL PARTE ES, COMO TIPO ────────────────────────────────────

/** Qué clase de cosa es una línea del parte. */
export type ClaseDeLinea =
  | "INCIDENCIA_NUEVA"
  | "INCIDENCIA_ABIERTA"
  | "ALGO_NO_VA_BIEN"
  | "CONSTANTE_FUERA_DE_RANGO"
  | "NO_HECHO"
  | "CAMBIO_DE_PLAN"
  | "EXCEPCION_NUEVA"
  | "REGISTRO_SIN_TURNO"
  | "AVISO_QUE_NO_SALIO"
  /** residencia-6 (punto 4) · residentes con cama y **sin plan de
   *  cuidados vigente**. Una línea por zona, no una por residente ni una
   *  por cuidado: ver §«los residentes sin plan» más abajo. */
  | "SIN_PLAN_DE_CUIDADOS";

/**
 * Cómo se lee cada clase en la pantalla de la sala. Vive aquí y no en el
 * front porque la tablet, el admin y el informe lo pintan igual, y tres
 * copias se separan a la tercera.
 */
export const NOMBRE_DE_LA_CLASE: Record<ClaseDeLinea, string> = {
  INCIDENCIA_NUEVA: "Incidencia nueva",
  INCIDENCIA_ABIERTA: "Sigue abierta de antes",
  ALGO_NO_VA_BIEN: "Algo no va bien",
  CONSTANTE_FUERA_DE_RANGO: "Constante fuera de rango",
  NO_HECHO: "No se hizo",
  CAMBIO_DE_PLAN: "Cambio en el plan de cuidados",
  EXCEPCION_NUEVA: "Umbral propio nuevo",
  REGISTRO_SIN_TURNO: "Registro sin turno",
  AVISO_QUE_NO_SALIO: "Aviso que no salió a tiempo",
  SIN_PLAN_DE_CUIDADOS: "Sin plan de cuidados",
};

/** Una línea del parte. */
export interface LineaDelParte {
  clase: ClaseDeLinea;
  /** Lo que se lee, ya en castellano. */
  texto: string;
  /** La hora de pared del centro, «HH:MM». `null` cuando no la tiene (un
   *  «no hecho» de una franja entera). */
  hora: string | null;
  /** El nivel, si la línea lo tiene. */
  nivel: string | null;
  /** Para abrir la incidencia desde la pantalla. */
  incidentId: string | null;
  /** Y el registro, para la ficha del residente. */
  careRecordId: string | null;
  /** El estado del aviso, cuando la línea es una incidencia que avisó. */
  aviso: {
    canal: string;
    estado: string;
    /** Quién lo acusó, con su capacidad. `null` = nadie. */
    acusadoPor: string | null;
    acusadoEn: string | null;
  } | null;
}

/** Lo que de un residente sale en el parte. */
export interface ResidenteDelParte {
  clientId: string;
  nombre: string;
  habitacion: string | null;
  lineas: LineaDelParte[];
}

/** Una zona con contenido. `floorId` `null` = del centro. */
export interface ZonaDelParte {
  floorId: string | null;
  nombre: string;
  lineas: number;
  residentes: ResidenteDelParte[];
  /** Lo que no es de ningún residente. */
  sueltas: LineaDelParte[];
}

/** El parte entero. Es lo que se cifra en `handovers.content_cifrado`. */
export interface ParteDeRelevo {
  centro: { id: string; nombre: string };
  turno: { id: string; code: string; name: string; startsAt: string; endsAt: string };
  careDay: string;
  /** La ventana del turno, en ISO. */
  desde: string;
  hasta: string;
  /** Hasta dónde se miró. En vivo es «ahora»; al congelar, el final del
   *  turno. */
  corte: string;
  generadoEn: string;
  sinNovedades: boolean;
  lineas: number;
  zonas: ZonaDelParte[];
}

// ── LA VENTANA DE UN TURNO ───────────────────────────────────────────

/** Un turno del centro, en lo que aquí importa. */
export interface TurnoDelParte {
  id: string;
  code: string;
  name: string;
  startsAt: string;
  endsAt: string;
}

/**
 * De cuándo a cuándo va este turno en este `careDay`.
 *
 * **La noche acaba al día SIGUIENTE** (D-54): el turno de noche del lunes
 * va de las 22:00 del lunes a las 08:00 del martes. Sin esto la ventana
 * iría hacia atrás y el parte de la noche saldría vacío — que es el tramo
 * en que la residencia está más sola.
 */
export function ventanaDelTurno(
  turno: { startsAt: string; endsAt: string },
  careDay: string,
): { desde: Date; hasta: Date } {
  const diaFin = cruzaMedianoche(turno) ? addDays(careDay, 1) : careDay;
  return {
    desde: wallTimeToUtc(careDay, turno.startsAt),
    hasta: wallTimeToUtc(diaFin, turno.endsAt),
  };
}

// ── EL CONSTRUCTOR ───────────────────────────────────────────────────

/** Los parámetros, con nombre: son seis. */
export interface EntradaDelParte {
  tenantId: string;
  turno: TurnoDelParte;
  careDay: string;
  /**
   * Hasta dónde se mira. En vivo, «ahora»; al congelar, el final del
   * turno. Lo de después del corte **no entra**: un parte que incluyera
   * lo que pasó tras congelarlo no sería la evidencia de lo que se supo.
   */
  corte: Date;
  /** Cuándo se calcula. Va en el parte. */
  ahora: Date;
}

const UNA_HORA_MS = 3_600_000;

/**
 * **El parte de un turno.** Una función, dieciséis consultas y ninguna
 * escritura: esto se puede llamar en vivo cuantas veces haga falta.
 */
export async function construirParte(
  prisma: PrismaClient,
  entrada: EntradaDelParte,
): Promise<ParteDeRelevo> {
  const { tenantId, turno, careDay, corte, ahora } = entrada;
  const { desde, hasta } = ventanaDelTurno(turno, careDay);
  // El corte nunca pasa del final del turno: un parte en vivo a las 14:00
  // mira hasta las 14:00, y uno congelado a las 15:00:04 mira hasta las
  // 15:00 en punto. Sin esto, el parte congelado se llevaría los cuatro
  // segundos de propina y dejaría de ser «lo que pasó en el turno».
  const tope = corte.getTime() < hasta.getTime() ? corte : hasta;

  const dek = await dekONada(tenantId, prisma);

  const [
    tenant,
    plantas,
    ocupaciones,
    controles,
    ajustes,
    turnos,
    momentos,
    plan,
    registros,
    incidenciasNuevas,
    incidenciasAbiertas,
    cambiosDePlan,
    excepciones,
    avisos,
  ] = await Promise.all([
    prisma.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { name: true },
    }),
    prisma.floor.findMany({
      where: { tenantId },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, name: true },
    }),
    // La ocupación VIGENTE: quién vive dónde ahora. Es lo que reparte las
    // líneas por zona, y por eso se lee al generar y no se guarda: un
    // residente que cambia de habitación el martes no mueve los partes
    // de la semana pasada, porque aquéllos ya están congelados con su
    // reparto dentro.
    prisma.bedAssignment.findMany({
      where: { tenantId, toAt: null },
      select: {
        clientId: true,
        client: { select: { firstName: true, lastName: true } },
        bed: { select: { room: { select: { number: true, floorId: true } } } },
      },
    }),
    prisma.controlType.findMany({
      where: {
        supersededAt: null,
        OR: [{ scope: "STANDARD" }, { scope: "CENTER", tenantId }],
      },
      select: {
        code: true,
        name: true,
        layer: true,
        nature: true,
        unit: true,
        refMin: true,
        refMax: true,
      },
    }),
    prisma.centerControlSetting.findMany({
      where: { tenantId },
      select: { controlCode: true, active: true, alias: true },
    }),
    prisma.centerShift.findMany({
      where: { tenantId },
      orderBy: [{ sortOrder: "asc" }],
      select: { id: true, code: true, name: true, startsAt: true, endsAt: true },
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
    // Los registros del DÍA del centro y del siguiente: la noche cruza
    // medianoche, así que un `careDay` solo se dejaría fuera la ronda de
    // las 02:00 cuando el registro llegó con otro `care_day` por un
    // desvío de reloj de la tablet.
    prisma.careRecord.findMany({
      where: { tenantId, careDay: { in: [careDay, addDays(careDay, 1)] } },
      orderBy: { recordedAt: "asc" },
      select: {
        id: true,
        tenantId: true,
        clientId: true,
        controlCode: true,
        valueCifrado: true,
        noteCifrado: true,
        voiceFileName: true,
        recordedAt: true,
        receivedAt: true,
        careDay: true,
        occurrenceAt: true,
        centerShiftId: true,
        voidedAt: true,
        centerShift: { select: { code: true } },
      },
    }),
    // **Nuevas del turno, N1 en adelante.** Las N0 no entran: una avería
    // sin riesgo es constancia y nace cerrada (residencia-4 §10), y
    // meterla aquí llenaría el parte de lo que nadie tiene que hacer.
    prisma.incident.findMany({
      where: {
        tenantId,
        openedAt: { gte: desde, lt: tope },
        severity: { in: ["N1", "N2", "N3", "N4"] },
      },
      orderBy: { openedAt: "asc" },
      select: INCIDENCIA_SELECT,
    }),
    // **Las que vienen de antes y siguen abiertas.** `openedAt < desde`
    // para no repetir las nuevas, que ya salen arriba con más detalle.
    prisma.incident.findMany({
      where: {
        tenantId,
        open: true,
        openedAt: { lt: desde },
        severity: { in: ["N1", "N2", "N3", "N4"] },
      },
      orderBy: [{ severity: "desc" }, { openedAt: "asc" }],
      select: INCIDENCIA_SELECT,
    }),
    // Cambios del plan: líneas abiertas o cerradas dentro del turno.
    prisma.carePlanItem.findMany({
      where: {
        tenantId,
        OR: [
          { fromAt: { gte: desde, lt: tope } },
          { toAt: { gte: desde, lt: tope } },
        ],
      },
      orderBy: { fromAt: "asc" },
      select: {
        id: true,
        clientId: true,
        controlCode: true,
        fromAt: true,
        toAt: true,
      },
    }),
    // Excepciones de umbral nuevas (D-22). Es lo que cambia el nivel con
    // el que se gradúa a ese residente, y el turno que entra tiene que
    // saberlo.
    prisma.residentThresholdOverride.findMany({
      where: { tenantId, signedAt: { gte: desde, lt: tope }, revokedAt: null },
      orderBy: { signedAt: "asc" },
      select: {
        id: true,
        clientId: true,
        controlCode: true,
        signedAt: true,
        toAt: true,
        signedBy: { select: { alias: true, email: true } },
      },
    }),
    // Los avisos del turno, para saber cuáles NO salieron a tiempo.
    prisma.guardAlert.findMany({
      where: { tenantId, queuedAt: { gte: desde, lt: tope } },
      orderBy: { queuedAt: "asc" },
      select: {
        id: true,
        incidentId: true,
        channel: true,
        state: true,
        severity: true,
        queuedAt: true,
        createdAt: true,
        deliveredAt: true,
        ackedAt: true,
        incident: {
          select: {
            id: true,
            clientId: true,
            incidentType: true,
            severity: true,
          },
        },
        ackedBy: { select: { alias: true, email: true } },
        ackedWith: { select: { careRole: { select: { name: true } } } },
      },
    }),
  ]);

  // ── El decorado: nombres, plantas y habitaciones ──────────────────
  const porControl = new Map(controles.map((c) => [c.code, c]));
  const alias = new Map(ajustes.map((a) => [a.controlCode, a.alias]));
  const nombreDelControl = (code: string): string =>
    alias.get(code) ?? porControl.get(code)?.name ?? code;

  const nombreDePlanta = new Map(plantas.map((p) => [p.id, p.name]));
  const residentes = new Map(
    ocupaciones.map((o) => [
      o.clientId,
      {
        nombre: `${o.client.firstName} ${o.client.lastName}`.trim(),
        habitacion: o.bed.room.number,
        floorId: o.bed.room.floorId as string | null,
      },
    ]),
  );

  const hora = (d: Date): string => utcToWallTime(d);

  // ── Las líneas, por residente y por zona ──────────────────────────
  const porResidente = new Map<string, LineaDelParte[]>();
  const sueltasPorZona = new Map<string | null, LineaDelParte[]>();

  const anotar = (clientId: string | null, floorId: string | null, linea: LineaDelParte): void => {
    if (clientId != null && residentes.has(clientId)) {
      const ya = porResidente.get(clientId) ?? [];
      ya.push(linea);
      porResidente.set(clientId, ya);
      return;
    }
    // Sin residente —o con un residente que ya no ocupa cama— la línea es
    // de la zona. Y sin zona, del centro: lo correcto es que la vea quien
    // tiene alcance total, no que se pierda.
    const clave = floorId;
    const ya = sueltasPorZona.get(clave) ?? [];
    ya.push(linea);
    sueltasPorZona.set(clave, ya);
  };

  // ── 1 y 2 · Las incidencias ───────────────────────────────────────
  const avisoPorIncidencia = new Map<string, (typeof avisos)[number]>();
  for (const a of avisos) {
    // El último de cada incidencia manda: si escaló, lo que interesa es
    // en qué acabó.
    avisoPorIncidencia.set(a.incidentId, a);
  }

  const lineaDeIncidencia = (
    inc: (typeof incidenciasNuevas)[number],
    clase: ClaseDeLinea,
  ): LineaDelParte => {
    const descripcion = leerTexto(
      { cifrado: inc.descriptionCifrado, claro: null },
      dek,
      sitioDescripcionDeIncidencia(tenantId, inc.id),
    );
    const tipo = NOMBRE_DEL_TIPO[inc.incidentType] ?? inc.incidentType;
    const aviso = avisoPorIncidencia.get(inc.id);
    return {
      clase,
      texto: [
        tipo,
        descripcion ? `· ${descripcion}` : null,
        inc.open ? null : "· cerrada",
      ]
        .filter((x) => x != null)
        .join(" "),
      hora: hora(inc.openedAt),
      nivel: inc.severity,
      incidentId: inc.id,
      careRecordId: inc.sourceRecordId,
      aviso:
        aviso == null
          ? null
          : {
              canal: aviso.channel,
              estado: aviso.state,
              acusadoPor:
                aviso.ackedBy == null
                  ? null
                  : `${nombreCorto(aviso.ackedBy)}${
                      aviso.ackedWith ? ` (${aviso.ackedWith.careRole.name})` : ""
                    }`,
              acusadoEn: aviso.ackedAt ? hora(aviso.ackedAt) : null,
            },
    };
  };

  for (const inc of incidenciasNuevas) {
    anotar(inc.clientId, zonaDe(inc.clientId, residentes), lineaDeIncidencia(inc, "INCIDENCIA_NUEVA"));
  }
  for (const inc of incidenciasAbiertas) {
    anotar(
      inc.clientId,
      zonaDe(inc.clientId, residentes),
      lineaDeIncidencia(inc, "INCIDENCIA_ABIERTA"),
    );
  }

  // ── 3, 4 y 8 · Lo que sale de los registros ───────────────────────
  //
  // Una sola pasada por los registros del día, tres clases de línea. La
  // alternativa —tres consultas con tres `where`— habría leído tres veces
  // las mismas 1.200 filas y las habría descifrado tres veces.
  const paraNoHecho: RegistroHecho[] = [];
  for (const r of registros) {
    const enElTurno =
      r.recordedAt.getTime() >= desde.getTime() && r.recordedAt.getTime() < tope.getTime();

    // Para el cruce del «no hecho» entran TODOS los del día, también los
    // de fuera de la ventana: una ronda de las 07:55 que la tablet
    // adscribió a la noche tapa la ocurrencia de la noche, y mirar sólo
    // la ventana la dejaría como «no hecha».
    paraNoHecho.push({
      clientId: r.clientId,
      controlCode: r.controlCode,
      careDay: r.careDay,
      shiftCode: r.centerShift?.code ?? null,
      occurrenceAt: r.occurrenceAt,
      recordedAt: r.recordedAt,
      voidedAt: r.voidedAt,
    });

    if (!enElTurno || r.voidedAt != null) continue;
    const zona = zonaDe(r.clientId, residentes);

    // 3 · «algo no va bien»
    if (r.controlCode === "ALGO_NO_VA_BIEN") {
      const nota = leerTexto(
        { cifrado: r.noteCifrado, claro: null },
        dek,
        sitioNotaDeRegistro(tenantId, r.id),
      );
      anotar(r.clientId, zona, {
        clase: "ALGO_NO_VA_BIEN",
        texto: [
          nota ?? "Dicho sin texto",
          // «Si hay nota de voz, que la hay» — el prompt lo pide con esas
          // palabras. No se transcribe (ADR-02, la voz es ia-1): lo que el
          // turno entrante necesita saber es que hay un audio que
          // escuchar.
          r.voiceFileName ? "· con nota de voz" : null,
        ]
          .filter((x) => x != null)
          .join(" "),
        hora: hora(r.recordedAt),
        nivel: null,
        incidentId: null,
        careRecordId: r.id,
        aviso: null,
      });
      continue;
    }

    // 4 · constantes fuera de rango
    const control = porControl.get(r.controlCode);
    if (control != null && (control.refMin != null || control.refMax != null)) {
      const valor = leerJson(
        { cifrado: r.valueCifrado, claro: null },
        dek,
        sitioValorDeRegistro(tenantId, r.id),
      ) as { tipo?: string; numero?: number; unidad?: string | null } | null;
      if (valor != null && valor.tipo === "NUMERIC" && typeof valor.numero === "number") {
        const min = control.refMin == null ? null : Number(control.refMin);
        const max = control.refMax == null ? null : Number(control.refMax);
        const fuera = (min != null && valor.numero < min) || (max != null && valor.numero > max);
        if (fuera) {
          anotar(r.clientId, zona, {
            clase: "CONSTANTE_FUERA_DE_RANGO",
            texto: `${nombreDelControl(r.controlCode)}: ${formatearNumero(valor.numero)}${
              valor.unidad ? ` ${valor.unidad}` : ""
            } (lo normal, de ${min ?? "?"} a ${max ?? "?"})`,
            hora: hora(r.recordedAt),
            nivel: null,
            incidentId: null,
            careRecordId: r.id,
            aviso: null,
          });
        }
      }
    }

    // 8 · registros SIN TURNO (residencia-1 §11.5, residencia-3 §1)
    if (r.centerShiftId == null) {
      anotar(r.clientId, zona, {
        clase: "REGISTRO_SIN_TURNO",
        texto: `${nombreDelControl(r.controlCode)} — se registró sin turno: hay un hueco en el cuadrante`,
        hora: hora(r.recordedAt),
        nivel: null,
        incidentId: null,
        careRecordId: r.id,
        aviso: null,
      });
    }
  }

  // ── 5 · Lo que NO se hizo ─────────────────────────────────────────
  //
  // La misma función que la tablet de la sala ejecuta sin red
  // (`loQueNoSeHizo`, el paquete puro). El corte es el `tope`: en vivo,
  // ahora; al congelar, el final del turno.
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
    hasta,
  );
  const paraControles: ControlParaNoHecho[] = controles.map((c) => ({
    code: c.code,
    layer: c.layer,
    nature: c.nature,
  }));
  // Los residentes que NO cuentan: quien no tiene cama vigente. Es quien
  // está dado de alta o quien todavía no ha ingresado — en los dos casos,
  // su plan puede seguir vigente y no se le puede imputar nada.
  const fuera = new Set(
    plan.map((l) => l.clientId).filter((c) => !residentes.has(c)),
  );
  const noHechas = loQueNoSeHizo({
    ocurrencias,
    registros: paraNoHecho,
    controles: paraControles,
    corte: tope,
    fuera,
  });
  for (const n of noHechas) {
    // Sólo lo que caía en ESTE turno. `queToca` sobre la ventana ya lo
    // acota, pero la franja de noche de un parte de mañana podría colarse
    // por el barrido de un día antes y después.
    if (n.shiftCode !== turno.code) continue;
    anotar(n.clientId, zonaDe(n.clientId, residentes), {
      clase: "NO_HECHO",
      texto: `${nombreDelControl(n.controlCode)} — tocaba y no hay registro`,
      // Una franja no tiene hora: tocaba «durante la mañana». Poner la
      // hora de inicio diría que se incumplió a las 08:00.
      hora: n.esFranja ? null : hora(n.at),
      nivel: null,
      incidentId: null,
      careRecordId: null,
      aviso: null,
    });
  }

  // ── residencia-6 (punto 4) · LOS RESIDENTES SIN PLAN ──────────────
  //
  // residencia-5 §16.4 dejó dicho que «el parte de un turno sin plan sale
  // enorme de "no hecho"». Lo que este bloque decide es el otro lado del
  // mismo problema: **un residente sin plan de cuidados vigente no genera
  // ni una línea de «no hecho»** —no hay nada que incumplir, porque
  // `queToca` no devuelve nada suyo— y eso, sin más, lo vuelve invisible.
  // Sale perfecto en los indicadores, no aparece en «lo que toca» de su
  // puerta y nadie se entera de que a don Luis no le preparó el plan
  // nadie.
  //
  // Así que el parte lo dice **una vez**, con sus nombres, en vez de
  // treinta líneas rojas.
  //
  // ── UNA LÍNEA POR ZONA, Y NO UNA SOLA EN EL PARTE ─────────────────
  //
  // El parte se recorta por alcance (D-51, `recortarAlAlcance`): una
  // auxiliar de la primera planta no puede leer nombres de residentes de
  // la segunda. Una única línea «3 residentes sin plan: Carmen, Luis,
  // Pilar» sería un dato de la segunda planta dentro del parte de la
  // primera. Por zona, cada una ve a los suyos — y el panel de dirección
  // los ve todos (`porArreglar`).
  //
  // Va en las SUELTAS de la zona y no colgando de cada residente: colgada
  // de cada uno serían otra vez N líneas, que es lo que se viene a
  // quitar.
  const conPlanVivo = new Set(
    plan
      .filter(
        (l) =>
          l.fromAt.getTime() < tope.getTime() &&
          (l.toAt == null || l.toAt.getTime() > desde.getTime()),
      )
      .map((l) => l.clientId),
  );
  const sinPlanPorZona = new Map<string | null, string[]>();
  for (const [clientId, r] of residentes) {
    if (conPlanVivo.has(clientId)) continue;
    const ya = sinPlanPorZona.get(r.floorId) ?? [];
    ya.push(`${r.nombre} (${r.habitacion})`);
    sinPlanPorZona.set(r.floorId, ya);
  }
  for (const [floorId, quienes] of sinPlanPorZona) {
    anotar(null, floorId, {
      clase: "SIN_PLAN_DE_CUIDADOS",
      texto:
        `${quienes.length} ${
          quienes.length === 1 ? "residente" : "residentes"
        } sin plan de cuidados: ${quienes.join(", ")}. ` +
        "No les toca nada, así que no sale nada en su puerta.",
      // Sin hora: no ha pasado a ninguna hora. Poner la del corte diría
      // que el plan se cayó a las 15:00.
      hora: null,
      nivel: null,
      incidentId: null,
      careRecordId: null,
      aviso: null,
    });
  }

  // ── 6 · Cambios del plan ──────────────────────────────────────────
  for (const c of cambiosDePlan) {
    const abierta = c.fromAt.getTime() >= desde.getTime() && c.fromAt.getTime() < tope.getTime();
    const cerrada =
      c.toAt != null && c.toAt.getTime() >= desde.getTime() && c.toAt.getTime() < tope.getTime();
    const cuando = cerrada && c.toAt != null ? c.toAt : c.fromAt;
    anotar(c.clientId, zonaDe(c.clientId, residentes), {
      clase: "CAMBIO_DE_PLAN",
      texto: cerrada
        ? `Se retiró «${nombreDelControl(c.controlCode)}» del plan`
        : abierta
          ? `Se añadió «${nombreDelControl(c.controlCode)}» al plan`
          : `Cambió «${nombreDelControl(c.controlCode)}» en el plan`,
      hora: hora(cuando),
      nivel: null,
      incidentId: null,
      careRecordId: null,
      aviso: null,
    });
  }

  // ── 7 · Excepciones de umbral nuevas ──────────────────────────────
  for (const e of excepciones) {
    anotar(e.clientId, zonaDe(e.clientId, residentes), {
      clase: "EXCEPCION_NUEVA",
      // El MOTIVO no sale: va cifrado y es el diagnóstico con todas las
      // letras («paliativo, febrícula basal 37,8»). Lo que el turno
      // entrante necesita saber es que esta persona tiene umbral propio
      // en esta constante y hasta cuándo; el motivo está en su ficha.
      texto: `${nombreDelControl(e.controlCode)}: umbral propio pautado por ${nombreCorto(
        e.signedBy,
      )}${e.toAt ? `, hasta el ${e.toAt.toISOString().slice(0, 10)}` : ""}`,
      hora: hora(e.signedAt),
      nivel: null,
      incidentId: null,
      careRecordId: null,
      aviso: null,
    });
  }

  // ── 9 · Avisos que NO salieron a tiempo ───────────────────────────
  //
  // Dos cosas distintas y las dos cuentan:
  //
  //   · el que **nadie acusó** (quedó pendiente o escaló sin respuesta):
  //     alguien tiene que ir a mirar esa incidencia;
  //   · el que salió **con retraso de más de una hora** sobre el momento
  //     en que la tablet lo apuntó, que es la puerta sin red (§9 de
  //     residencia-4). El umbral es una hora y no un minuto porque un
  //     minuto es la cola del sistema funcionando; una hora es que esa
  //     habitación estuvo sin cobertura.
  for (const a of avisos) {
    const sinAcusar = a.ackedAt == null && a.state !== "CANCELLED";
    const retraso = a.createdAt.getTime() - a.queuedAt.getTime();
    const tarde = retraso > UNA_HORA_MS;
    if (!sinAcusar && !tarde) continue;
    anotar(a.incident.clientId, zonaDe(a.incident.clientId, residentes), {
      clase: "AVISO_QUE_NO_SALIO",
      texto: [
        `${NOMBRE_DEL_TIPO[a.incident.incidentType] ?? a.incident.incidentType}`,
        sinAcusar ? "· nadie lo acusó" : null,
        tarde
          ? `· salió ${Math.round(retraso / 60000)} min tarde (la tablet estaba sin red)`
          : null,
      ]
        .filter((x) => x != null)
        .join(" "),
      hora: hora(a.queuedAt),
      nivel: a.severity,
      incidentId: a.incidentId,
      careRecordId: null,
      aviso: {
        canal: a.channel,
        estado: a.state,
        acusadoPor: a.ackedBy == null ? null : nombreCorto(a.ackedBy),
        acusadoEn: a.ackedAt ? hora(a.ackedAt) : null,
      },
    });
  }

  // ── Armar las zonas ───────────────────────────────────────────────
  const zonasPorId = new Map<string | null, ZonaDelParte>();
  const zonaDeId = (floorId: string | null): ZonaDelParte => {
    let z = zonasPorId.get(floorId);
    if (z == null) {
      z = {
        floorId,
        nombre: floorId == null ? "Del centro" : (nombreDePlanta.get(floorId) ?? "Planta"),
        lineas: 0,
        residentes: [],
        sueltas: [],
      };
      zonasPorId.set(floorId, z);
    }
    return z;
  };

  // Los residentes, por zona y en orden de habitación: es como el turno
  // los recorre.
  const conLineas = [...porResidente.entries()]
    .filter(([, lineas]) => lineas.length > 0)
    .map(([clientId, lineas]) => ({ clientId, lineas, ...residentes.get(clientId)! }))
    .sort(
      (a, b) =>
        (a.habitacion ?? "").localeCompare(b.habitacion ?? "", "es", { numeric: true }) ||
        a.nombre.localeCompare(b.nombre, "es"),
    );
  for (const r of conLineas) {
    const z = zonaDeId(r.floorId);
    z.residentes.push({
      clientId: r.clientId,
      nombre: r.nombre,
      habitacion: r.habitacion,
      lineas: ordenarLineas(r.lineas),
    });
    z.lineas += r.lineas.length;
  }
  for (const [floorId, lineas] of sueltasPorZona) {
    if (lineas.length === 0) continue;
    const z = zonaDeId(floorId);
    z.sueltas = ordenarLineas(lineas);
    z.lineas += lineas.length;
  }

  const zonas = [...zonasPorId.values()]
    .filter((z) => z.lineas > 0)
    .sort((a, b) => {
      // «Del centro» va al final: lo de las plantas es lo que el turno
      // recorre; lo del centro, lo que la dirección mira.
      if (a.floorId == null) return 1;
      if (b.floorId == null) return -1;
      return a.nombre.localeCompare(b.nombre, "es", { numeric: true });
    });
  const lineas = zonas.reduce((n, z) => n + z.lineas, 0);

  return {
    centro: { id: tenantId, nombre: tenant.name },
    turno,
    careDay,
    desde: desde.toISOString(),
    hasta: hasta.toISOString(),
    corte: tope.toISOString(),
    generadoEn: ahora.toISOString(),
    sinNovedades: lineas === 0,
    lineas,
    zonas,
  };
}

const INCIDENCIA_SELECT = {
  id: true,
  clientId: true,
  subject: true,
  incidentType: true,
  severity: true,
  open: true,
  openedAt: true,
  descriptionCifrado: true,
  sourceRecordId: true,
} as const;

/** En qué planta cae lo de este residente. `null` = del centro. */
function zonaDe(
  clientId: string | null,
  residentes: Map<string, { floorId: string | null }>,
): string | null {
  if (clientId == null) return null;
  return residentes.get(clientId)?.floorId ?? null;
}

/** El nombre corto de quien firma: el alias, o la parte local del email. */
function nombreCorto(u: { alias: string | null; email: string }): string {
  return u.alias ?? (u.email.split("@")[0] ?? u.email);
}

/** Con coma decimal, que es lo que se lee en España. */
function formatearNumero(n: number): string {
  return String(n).replace(".", ",");
}

/**
 * El orden de las líneas de un residente: **por urgencia y después por
 * hora**.
 *
 * Lo que el turno que entra tiene que leer primero es lo que puede
 * hacerle daño a alguien, no lo que pasó antes. Un N4 de las 09:00 va
 * delante de un «no se hizo» de las 14:00.
 */
function ordenarLineas(lineas: LineaDelParte[]): LineaDelParte[] {
  const peso: Record<ClaseDeLinea, number> = {
    INCIDENCIA_NUEVA: 0,
    AVISO_QUE_NO_SALIO: 1,
    INCIDENCIA_ABIERTA: 2,
    CONSTANTE_FUERA_DE_RANGO: 3,
    ALGO_NO_VA_BIEN: 4,
    EXCEPCION_NUEVA: 5,
    CAMBIO_DE_PLAN: 6,
    NO_HECHO: 7,
    REGISTRO_SIN_TURNO: 8,
    // residencia-6 · al final, con lo administrativo. No es algo que
    // haya pasado en el turno: es algo que falta por configurar, y el
    // orden del parte es el de la urgencia.
    SIN_PLAN_DE_CUIDADOS: 9,
  };
  const nivel = (n: string | null): number =>
    n == null ? 0 : -Number(n.replace("N", ""));
  return [...lineas].sort(
    (a, b) =>
      peso[a.clase] - peso[b.clase] ||
      nivel(a.nivel) - nivel(b.nivel) ||
      (a.hora ?? "").localeCompare(b.hora ?? ""),
  );
}

// ── CONGELAR ─────────────────────────────────────────────────────────

/**
 * **Congela el parte de un turno**, y es idempotente.
 *
 * Idempotente por el motor y no por un `if`: el índice único
 * `handovers_tenant_id_center_shift_id_care_day_key` es lo que hace que
 * la tarea programada se pueda correr dos veces. Se comprueba antes
 * igualmente, para no gastar las dieciséis consultas del parte cuando ya
 * está.
 *
 * Devuelve `null` cuando ya estaba congelado: quien llama no tiene que
 * distinguir «no había que hacer nada» de un error.
 */
export async function congelarParte(
  prisma: PrismaClient,
  entrada: {
    tenantId: string;
    turno: TurnoDelParte;
    careDay: string;
    ahora: Date;
  },
): Promise<{ handoverId: string; lineas: number; sinNovedades: boolean } | null> {
  const ya = await prisma.handover.findUnique({
    where: {
      tenantId_centerShiftId_careDay: {
        tenantId: entrada.tenantId,
        centerShiftId: entrada.turno.id,
        careDay: entrada.careDay,
      },
    },
    select: { id: true },
  });
  if (ya != null) return null;

  const { hasta } = ventanaDelTurno(entrada.turno, entrada.careDay);
  const parte = await construirParte(prisma, {
    tenantId: entrada.tenantId,
    turno: entrada.turno,
    careDay: entrada.careDay,
    // **El corte es el final del turno**, no «ahora». La tarea puede
    // correr a las 15:00:04 y el parte de la mañana acaba a las 15:00.
    corte: hasta,
    ahora: entrada.ahora,
  });

  // La DEK se ASEGURA aquí (no `dekONada`): a diferencia de leer, esto
  // escribe, y un centro que congela su primer parte tiene que tener
  // clave. Es el mismo criterio que el primer registro de la puerta.
  const { asegurarDek } = await import("../clinica/claves.js");
  const dek = await asegurarDek(entrada.tenantId, prisma);

  const id = nuevoIdDeFila();
  const contenido = cifrarTexto(
    JSON.stringify(parte),
    dek,
    sitioContenidoDeRelevo(entrada.tenantId, id),
  );
  // `cifrarTexto` devuelve `null` con la cadena vacía, y `JSON.stringify`
  // de un objeto nunca lo es. Se comprueba porque la columna es NOT NULL
  // y un `!` sobre algo imposible es una afirmación que nadie revisa.
  if (contenido == null) {
    throw new Error("el parte de relevo se serializó vacío");
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.handover.create({
        data: {
          id,
          tenantId: entrada.tenantId,
          centerShiftId: entrada.turno.id,
          careDay: entrada.careDay,
          generatedAt: entrada.ahora,
          frozenAt: entrada.ahora,
          contentCifrado: contenido,
          lineas: parte.lineas,
          sinNovedades: parte.sinNovedades,
        },
      });
      // **Sólo las zonas CON contenido.** Una planta sin nada que contar
      // no tiene fila y por tanto no necesita confirmación: exigirla
      // dejaría el parte sin confirmar por una planta vacía.
      for (const z of parte.zonas) {
        if (z.lineas === 0) continue;
        await tx.handoverZone.create({
          data: {
            tenantId: entrada.tenantId,
            handoverId: id,
            floorId: z.floorId,
            lineas: z.lineas,
          },
        });
      }
    });
  } catch (err) {
    // La carrera: dos réplicas de la API corriendo la pasada a la vez. El
    // índice único la para y aquí se traduce a «ya estaba», que es la
    // verdad. Mismo criterio que el reclamo del código de emparejamiento.
    if (esConflictoDeUnicidad(err)) return null;
    throw err;
  }

  return { handoverId: id, lineas: parte.lineas, sinNovedades: parte.sinNovedades };
}

/** `true` si el error es una violación de índice único de Prisma. */
function esConflictoDeUnicidad(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err != null &&
    "code" in err &&
    (err as { code?: unknown }).code === "P2002"
  );
}

/** Lee un parte congelado y lo descifra. */
export async function leerParteCongelado(
  prisma: PrismaClient,
  tenantId: string,
  handoverId: string,
): Promise<ParteDeRelevo | null> {
  const fila = await prisma.handover.findFirst({
    where: { id: handoverId, tenantId },
    select: { id: true, contentCifrado: true },
  });
  if (fila == null) return null;
  const dek = await dekONada(tenantId, prisma);
  const claro = leerTexto(
    { cifrado: fila.contentCifrado, claro: null },
    dek,
    sitioContenidoDeRelevo(tenantId, fila.id),
  );
  if (claro == null) return null;
  try {
    return JSON.parse(claro) as ParteDeRelevo;
  } catch {
    // Un parte que no se descifra devuelve `null` y la pantalla pinta el
    // hueco marcado, igual que una anotación clínica ilegible
    // (clinica-7): esconderlo sería borrar la única pista.
    return null;
  }
}

// ── LOS AÑADIDOS TARDÍOS ─────────────────────────────────────────────

/**
 * **Lo que llegó después del relevo** (decisión de producto 2).
 *
 * Busca los registros, incidencias y avisos cuyo momento cae dentro de un
 * turno que ya tiene parte congelado y que **llegaron al servidor después
 * de congelarlo**, y los añade a la vista del parte sin tocar lo
 * congelado.
 *
 * Es idempotente por los tres índices únicos parciales de
 * `handover_late_additions`: correrla dos veces no duplica el añadido.
 *
 * `ahora` entra por parámetro para que el e2e la pueda correr con reloj
 * falso, igual que `pasadaDeAusencias` de residencia-4.
 */
export async function anotarLoQueLlegoTarde(
  prisma: PrismaClient,
  entrada: { tenantId: string; ahora: Date; desdeHace?: number },
): Promise<{ anotados: number }> {
  // Cuánto atrás se mira. Una semana por defecto, que es el tope que la
  // puerta acepta para un registro viejo (`MARGEN_PASADO_MS` de
  // residencia-3): más atrás no puede llegar nada.
  const ventana = entrada.desdeHace ?? 7 * 24 * UNA_HORA_MS;
  const limite = new Date(entrada.ahora.getTime() - ventana);

  const partes = await prisma.handover.findMany({
    where: { tenantId: entrada.tenantId, frozenAt: { gte: limite } },
    select: {
      id: true,
      careDay: true,
      frozenAt: true,
      centerShift: { select: { id: true, code: true, startsAt: true, endsAt: true } },
    },
  });
  if (partes.length === 0) return { anotados: 0 };

  const dek = await dekONada(entrada.tenantId, prisma);
  const [ocupaciones, controles, ajustes] = await Promise.all([
    prisma.bedAssignment.findMany({
      where: { tenantId: entrada.tenantId, toAt: null },
      select: { clientId: true, bed: { select: { room: { select: { floorId: true } } } } },
    }),
    prisma.controlType.findMany({
      where: {
        supersededAt: null,
        OR: [{ scope: "STANDARD" }, { scope: "CENTER", tenantId: entrada.tenantId }],
      },
      select: { code: true, name: true },
    }),
    prisma.centerControlSetting.findMany({
      where: { tenantId: entrada.tenantId },
      select: { controlCode: true, alias: true },
    }),
  ]);
  // El NOMBRE del control, no su código: «Cambio postural», no
  // `CAMBIO_POSTURAL`. Es lo que la sala pinta, y **el enum no es la
  // pantalla** (lección 5 del bucle visual de residencia-4).
  const aliasDelCentro = new Map(ajustes.map((a) => [a.controlCode, a.alias]));
  const nombreDeSerie = new Map(controles.map((c) => [c.code, c.name]));
  const nombreDelControl = (code: string): string =>
    aliasDelCentro.get(code) ?? nombreDeSerie.get(code) ?? code;
  const floorPorCliente = new Map(
    ocupaciones.map((o) => [o.clientId, o.bed.room.floorId as string | null]),
  );

  let anotados = 0;
  for (const parte of partes) {
    const { desde, hasta } = ventanaDelTurno(parte.centerShift, parte.careDay);

    // Lo que PASÓ dentro del turno y LLEGÓ después de congelar. Las dos
    // condiciones, y en ese orden: un registro que llegó tarde pero de
    // otro turno va al parte de SU turno, no a éste.
    const [registros, incidencias, avisosTardios] = await Promise.all([
      prisma.careRecord.findMany({
        where: {
          tenantId: entrada.tenantId,
          recordedAt: { gte: desde, lt: hasta },
          receivedAt: { gt: parte.frozenAt },
        },
        select: {
          id: true,
          tenantId: true,
          clientId: true,
          controlCode: true,
          noteCifrado: true,
          recordedAt: true,
          receivedAt: true,
        },
      }),
      prisma.incident.findMany({
        where: {
          tenantId: entrada.tenantId,
          openedAt: { gte: desde, lt: hasta },
          createdAt: { gt: parte.frozenAt },
          severity: { in: ["N1", "N2", "N3", "N4"] },
        },
        select: {
          id: true,
          clientId: true,
          incidentType: true,
          severity: true,
          openedAt: true,
          createdAt: true,
        },
      }),
      prisma.guardAlert.findMany({
        where: {
          tenantId: entrada.tenantId,
          queuedAt: { gte: desde, lt: hasta },
          createdAt: { gt: parte.frozenAt },
        },
        select: {
          id: true,
          queuedAt: true,
          createdAt: true,
          severity: true,
          incident: { select: { clientId: true, incidentType: true } },
        },
      }),
    ]);

    const nuevos: Array<{
      kind: "CARE_RECORD" | "INCIDENT" | "GUARD_ALERT";
      careRecordId?: string;
      incidentId?: string;
      guardAlertId?: string;
      clientId: string | null;
      occurredAt: Date;
      arrivedAt: Date;
      resumen: string;
    }> = [];

    for (const r of registros) {
      const nota = leerTexto(
        { cifrado: r.noteCifrado, claro: null },
        dek,
        sitioNotaDeRegistro(entrada.tenantId, r.id),
      );
      nuevos.push({
        kind: "CARE_RECORD",
        careRecordId: r.id,
        clientId: r.clientId,
        occurredAt: r.recordedAt,
        arrivedAt: r.receivedAt,
        resumen: `${nombreDelControl(r.controlCode)}${nota ? `: ${nota}` : ""}`,
      });
    }
    for (const i of incidencias) {
      nuevos.push({
        kind: "INCIDENT",
        incidentId: i.id,
        clientId: i.clientId,
        occurredAt: i.openedAt,
        arrivedAt: i.createdAt,
        resumen: `${i.severity} · ${NOMBRE_DEL_TIPO[i.incidentType] ?? i.incidentType}`,
      });
    }
    for (const a of avisosTardios) {
      nuevos.push({
        kind: "GUARD_ALERT",
        guardAlertId: a.id,
        clientId: a.incident.clientId,
        occurredAt: a.queuedAt,
        arrivedAt: a.createdAt,
        resumen: `Aviso ${a.severity} · ${
          NOMBRE_DEL_TIPO[a.incident.incidentType] ?? a.incident.incidentType
        } — salió después del relevo`,
      });
    }

    for (const n of nuevos) {
      const id = nuevoIdDeFila();
      const resumen = cifrarTexto(
        n.resumen,
        // Sin clave no se puede anotar: la columna es NOT NULL y cifrada.
        // Un centro que tiene partes congelados ya tiene clave (el
        // congelado la asegura), así que esto no puede ser `null` en la
        // práctica; se comprueba por lo mismo de siempre.
        dek ?? Buffer.alloc(0),
        sitioResumenTardio(entrada.tenantId, id),
      );
      if (dek == null || resumen == null) continue;
      try {
        await prisma.handoverLateAddition.create({
          data: {
            id,
            tenantId: entrada.tenantId,
            handoverId: parte.id,
            kind: n.kind,
            careRecordId: n.careRecordId ?? null,
            incidentId: n.incidentId ?? null,
            guardAlertId: n.guardAlertId ?? null,
            clientId: n.clientId,
            floorId: n.clientId == null ? null : (floorPorCliente.get(n.clientId) ?? null),
            occurredAt: n.occurredAt,
            arrivedAt: n.arrivedAt,
            resumenCifrado: resumen,
          },
        });
        anotados += 1;
      } catch (err) {
        // Ya estaba anotado: es la idempotencia funcionando, no un error.
        if (!esConflictoDeUnicidad(err)) throw err;
      }
    }
  }

  return { anotados };
}

/** Los añadidos tardíos de un parte, descifrados y en orden. */
export async function leerAnadidosTardios(
  prisma: PrismaClient,
  tenantId: string,
  handoverId: string,
): Promise<
  Array<{
    id: string;
    kind: string;
    clientId: string | null;
    floorId: string | null;
    resumen: string | null;
    ocurrioEn: string;
    llegoEn: string;
    incidentId: string | null;
    careRecordId: string | null;
  }>
> {
  const filas = await prisma.handoverLateAddition.findMany({
    where: { tenantId, handoverId },
    orderBy: { arrivedAt: "asc" },
    select: {
      id: true,
      kind: true,
      clientId: true,
      floorId: true,
      resumenCifrado: true,
      occurredAt: true,
      arrivedAt: true,
      incidentId: true,
      careRecordId: true,
    },
  });
  if (filas.length === 0) return [];
  const dek = await dekONada(tenantId, prisma);
  return filas.map((f) => ({
    id: f.id,
    kind: f.kind,
    clientId: f.clientId,
    floorId: f.floorId,
    resumen: leerTexto(
      { cifrado: f.resumenCifrado, claro: null },
      dek,
      sitioResumenTardio(tenantId, f.id),
    ),
    ocurrioEn: f.occurredAt.toISOString(),
    llegoEn: f.arrivedAt.toISOString(),
    incidentId: f.incidentId,
    careRecordId: f.careRecordId,
  }));
}

export { NOMBRE_DEL_NIVEL };
