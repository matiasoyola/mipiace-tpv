// residencia-4 · **LA PLANTILLA, LEÍDA DE LA BASE.**
//
// El puente entre `severity_rules` / `resident_threshold_overrides` y la
// función pura `gravedadDe` del paquete. Aquí no se decide ningún nivel:
// se leen las reglas y se llama.
//
// ── POR QUÉ ESTO ES UN FICHERO Y NO TRES LÍNEAS EN LA RUTA ──────────
//
// Porque lo mismo lo necesitan cuatro sitios —la derivación por umbral,
// la pasada de ausencias, la declaración desde la puerta y el arranque de
// la tablet (que se lleva las reglas para graduar SIN RED)— y porque la
// excepción por residente es una regla con vigencia que es fácil leer mal
// una vez. Leerla en un sitio es leerla bien en los cuatro.
//
// ── EL SERVIDOR MANDA ───────────────────────────────────────────────
//
// La tablet ejecuta `gravedadDe` con las reglas que se llevó en el
// arranque y pinta el resultado al instante. El servidor la ejecuta otra
// vez con las de la base y **manda la suya**, por dos razones concretas:
//
//   1. la tablet puede llevar una caché de ayer, y la plantilla o la
//      excepción de un residente pueden haber cambiado esta mañana;
//   2. la excepción es un dato clínico del residente, y una tablet de
//      pasillo no tiene por qué llevarse la lista de qué residentes
//      tienen umbrales propios ni por qué.
//
// Que coincidan en el caso normal es lo que hace que la pantalla no
// mienta; que mande el servidor es lo que hace que no se equivoque.

import type { PrismaClient } from "@mipiacetpv/db";
import {
  excepcionVigente,
  gravedadDe,
  gravedadDeEvento,
  type ExcepcionDeUmbral,
  type Gravedad,
  type ReglaDeGravedad,
} from "@mipiacetpv/residencia-plan";

/** La plantilla vigente, con su versión. */
export interface PlantillaVigente {
  version: number;
  reglas: ReglaDeGravedad[];
}

/**
 * Las reglas vigentes de la plantilla de serie.
 *
 * Una consulta sin tenant: la plantilla es del producto (D-65). Devuelve
 * también la VERSIÓN, que es lo que se guarda en cada incidencia para que
 * «¿por qué esto fue N2?» se conteste tres años después.
 *
 * Con la tabla vacía —una base recién migrada cuyo arranque todavía no ha
 * sembrado— devuelve cero reglas y versión 0. **No lanza**: nada del
 * arranque puede tumbar la API, y una medida que no gradúa se guarda
 * igual. Lo que no puede pasar es que un centro no pueda registrar una
 * temperatura porque falte una fila de catálogo.
 */
export async function plantillaVigente(
  prisma: PrismaClient,
): Promise<PlantillaVigente> {
  const filas = await prisma.severityRule.findMany({
    where: { scope: "STANDARD", supersededAt: null },
    orderBy: { sortOrder: "asc" },
    select: {
      version: true,
      kind: true,
      controlCode: true,
      comparator: true,
      value: true,
      eventType: true,
      qualifier: true,
      severity: true,
      incidentType: true,
    },
  });
  const reglas: ReglaDeGravedad[] = [];
  for (const f of filas) {
    if (f.kind === "THRESHOLD") {
      // El CHECK `severity_rules_forma_coherente` garantiza que las tres
      // están; se comprueba igual porque la alternativa era un `!` sobre
      // una invariante del motor, y un `!` que se rompe aquí es una
      // medida que deja de graduar en silencio.
      if (f.controlCode == null || f.comparator == null || f.value == null) continue;
      reglas.push({
        kind: "THRESHOLD",
        controlCode: f.controlCode,
        comparador: f.comparator,
        valor: Number(f.value),
        nivel: f.severity,
        tipo: f.incidentType,
      });
    } else {
      if (f.eventType == null) continue;
      reglas.push({
        kind: "EVENT",
        evento: f.eventType,
        matiz: f.qualifier,
        nivel: f.severity,
        tipo: f.incidentType,
      });
    }
  }
  const version = filas.length > 0 ? Math.max(...filas.map((f) => f.version)) : 0;
  return { version, reglas };
}

/**
 * Las excepciones VIGENTES de un residente, por código de control.
 *
 * «Vigente» se mira contra el instante del registro y no contra «ahora»,
 * por lo mismo que la firma de un `CareRecord` mira el rol en el
 * `recordedAt` (residencia-3 §3): una medida tomada el martes sin red y
 * subida el jueves se gradúa con el umbral que regía el martes. Al revés,
 * una excepción que caducó anoche no se aplica a lo de hoy — y **vuelve
 * la de serie sin que nadie haga nada**, que es media D-22.
 */
export async function excepcionesVigentes(
  prisma: PrismaClient,
  input: { tenantId: string; clientId: string; instante: Date },
): Promise<Map<string, ExcepcionDeUmbral>> {
  const filas = await prisma.residentThresholdOverride.findMany({
    where: {
      tenantId: input.tenantId,
      clientId: input.clientId,
      revokedAt: null,
      fromAt: { lte: input.instante },
      OR: [{ toAt: null }, { toAt: { gt: input.instante } }],
    },
    select: {
      controlCode: true,
      fromAt: true,
      toAt: true,
      rules: {
        orderBy: { sortOrder: "asc" },
        select: {
          comparator: true,
          value: true,
          severity: true,
          incidentType: true,
        },
      },
    },
  });
  const mapa = new Map<string, ExcepcionDeUmbral>();
  for (const f of filas) {
    const e: ExcepcionDeUmbral = {
      controlCode: f.controlCode,
      desde: f.fromAt,
      hasta: f.toAt,
      reglas: f.rules.map((r) => ({
        comparador: r.comparator,
        valor: Number(r.value),
        nivel: r.severity,
        tipo: r.incidentType,
      })),
    };
    // El EXCLUDE de la migración garantiza que no hay dos solapadas, y la
    // consulta ya filtra por el instante. `excepcionVigente` se vuelve a
    // llamar aquí porque la función pura es la que define qué significa
    // «vigente» y tener dos definiciones —una en SQL y otra en TS— es la
    // forma de que se separen.
    if (excepcionVigente(e, input.instante)) mapa.set(f.controlCode, e);
  }
  return mapa;
}

/** Lo que hace falta para graduar una medida. */
export interface ContextoDeGravedad {
  plantilla: PlantillaVigente;
  excepciones: Map<string, ExcepcionDeUmbral>;
}

/**
 * **El nivel de una medida, con la excepción del residente aplicada.**
 *
 * `null` = esta constante no gradúa nada para este residente. Pulso, peso
 * y tensión diastólica caen siempre aquí; cualquier otra puede caer si su
 * médica le pautó una excepción sin reglas.
 */
export function gravedadDeLaMedida(
  ctx: ContextoDeGravedad,
  controlCode: string,
  numero: number,
): Gravedad | null {
  return gravedadDe(
    controlCode,
    numero,
    ctx.plantilla.reglas,
    ctx.excepciones.get(controlCode) ?? null,
  );
}

/** Y el de un evento declarado. Las excepciones no lo tocan: lo que la
 *  médica pauta son umbrales de una constante, no cuánto vale una caída
 *  (D-21: el motor de gravedad es del producto). */
export function gravedadDelEvento(
  ctx: ContextoDeGravedad,
  evento: string,
  matiz: string | null,
): Gravedad | null {
  return gravedadDeEvento(evento, matiz, ctx.plantilla.reglas);
}

/** Lee las dos mitades de una vez. */
export async function contextoDeGravedad(
  prisma: PrismaClient,
  input: { tenantId: string; clientId: string | null; instante: Date },
): Promise<ContextoDeGravedad> {
  const [plantilla, excepciones] = await Promise.all([
    plantillaVigente(prisma),
    input.clientId
      ? excepcionesVigentes(prisma, {
          tenantId: input.tenantId,
          clientId: input.clientId,
          instante: input.instante,
        })
      : Promise.resolve(new Map<string, ExcepcionDeUmbral>()),
  ]);
  return { plantilla, excepciones };
}
