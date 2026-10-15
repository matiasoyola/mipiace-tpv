// catalogo-servicios-csv · LAS reglas de la agenda de un servicio, en un
// solo sitio.
//
// Hasta este bloque vivían dentro del `PUT /services/:productId/scheduling`
// (`services/routes.ts`): el rango de la duración estaba escrito en el
// esquema JSON de la ruta y los valores por defecto —buffers a 0, un
// profesional, no reservable online, los cuatro canales— en el cuerpo del
// handler.
//
// Ahora hay DOS puertas que crean una fila de `service_scheduling`:
//
//   · el panel de la dueña, con el PUT de siempre;
//   · la carga del fichero de alta del super-admin
//     (`superadmin/tenant-catalog.ts`), para un comercio en DRAFT que
//     todavía no tiene OWNER que pueda abrir ese panel.
//
// Y la regla tiene que ser **la misma función**, no la misma idea escrita
// dos veces — exactamente el criterio de `catalog/local-product-rules.ts`
// con el precio y el IVA. Dos copias del rango de la duración es como nace
// un servicio de 0 minutos que la agenda no sabe colocar.
//
// ── Qué NO decide este módulo ─────────────────────────────────────────
//
// Las marcas de clínica (`primeraValoracion`, `tratamientoSesion`,
// `nivelQuiropodia`, `consentimientos`) y sus negativas. Se ponen en el
// panel, con el catálogo delante, y el fichero de alta no las trae
// (decisión «lo que NO entra» del bloque). Aquí nacen en su default, que
// es el mismo que tiene hoy un servicio recién configurado.

import type { Prisma } from "@mipiacetpv/db";

import type { RuleResult } from "../catalog/local-product-rules.js";

/**
 * El rango de la duración, que era el `minimum`/`maximum` del esquema de
 * la ruta.
 *
 *   · **1 minuto el mínimo.** Un servicio de 0 minutos no es un servicio:
 *     el motor de disponibilidad (B4) le daría un hueco de ancho cero y la
 *     agenda lo pintaría como una raya.
 *   · **1.440 minutos el máximo**, que son 24 horas. La cirugía más larga
 *     de Rosario son 180 minutos; el techo está donde está porque una cita
 *     no puede durar más que el día que la contiene.
 */
export const DURATION_MIN = 1;
export const DURATION_MAX = 1440;

/** Forma estable de los flags de canal. El front la lee tal cual; `online`
 *  debe ir de la mano de `onlineBookable`. */
export interface Channels {
  caja: boolean;
  ticket: boolean;
  agenda: boolean;
  online: boolean;
}

export const DEFAULT_CHANNELS: Channels = {
  caja: true,
  ticket: true,
  agenda: true,
  online: false,
};

/** Normaliza el jsonb `channels` a la forma estable (defensivo: filas
 *  viejas o payloads parciales caen a los defaults por clave). */
export function toChannels(raw: unknown): Channels {
  const c = (raw ?? {}) as Partial<Record<keyof Channels, unknown>>;
  return {
    caja: c.caja === undefined ? DEFAULT_CHANNELS.caja : Boolean(c.caja),
    ticket: c.ticket === undefined ? DEFAULT_CHANNELS.ticket : Boolean(c.ticket),
    agenda: c.agenda === undefined ? DEFAULT_CHANNELS.agenda : Boolean(c.agenda),
    online: c.online === undefined ? DEFAULT_CHANNELS.online : Boolean(c.online),
  };
}

/**
 * La duración, validada igual la mande el panel o la traiga el fichero.
 *
 * Entero: medio minuto no existe en la rejilla de la agenda y un `30.5`
 * lo guardaría la columna `Int` redondeando en silencio, con la cita
 * descolocada respecto a lo que la dueña escribió.
 *
 * Devuelve el `RuleResult` de `local-product-rules.ts` —la misma forma que
 * `normalizeTaxRate` y compañía— para que el parser del CSV pueda poner el
 * mensaje en la columna «motivo» de la fila sin traducir nada.
 */
export function normalizeDurationMin(raw: unknown): RuleResult<number> {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) {
    return {
      ok: false,
      message: "La duración no es un número. Escribe los minutos, por ejemplo 30.",
    };
  }
  if (!Number.isInteger(n)) {
    return { ok: false, message: "La duración son minutos enteros: 30, no 30,5." };
  }
  if (n < DURATION_MIN || n > DURATION_MAX) {
    return {
      ok: false,
      message: `La duración tiene que estar entre ${DURATION_MIN} y ${DURATION_MAX} minutos.`,
    };
  }
  return { ok: true, value: n };
}

/**
 * Los defaults con los que nace una fila de agenda. Son LOS DEL PUT, y por
 * eso están aquí y no repetidos en la ruta de carga: buffers a 0, un
 * profesional, no reservable online y los cuatro canales de
 * `DEFAULT_CHANNELS` (con `online` en false, que es la coherencia que el
 * PUT aplica a mano).
 */
export interface SchedulingDefaults {
  bufferBeforeMin: number;
  bufferAfterMin: number;
  staffRequired: number;
  onlineBookable: boolean;
  channels: Channels;
}

export const SCHEDULING_DEFAULTS: SchedulingDefaults = {
  bufferBeforeMin: 0,
  bufferAfterMin: 0,
  staffRequired: 1,
  onlineBookable: false,
  channels: DEFAULT_CHANNELS,
};

/**
 * Los datos del `create` de una fila de agenda, exactamente iguales los
 * pida el panel o el fichero de alta. La hermana de
 * `buildLocalProductCreateData`.
 *
 * `family` es la agrupación libre del servicio. El fichero de alta le pone
 * la PRIMERA categoría de la fila: es lo único que el CSV sabe del
 * servicio que signifique «de qué familia es», y es lo que la dueña ve
 * agrupado en el catálogo de agenda sin tener que teclear nada.
 */
export function buildSchedulingCreateData(input: {
  tenantId: string;
  productId: string;
  durationMin: number;
  family?: string | null;
}): Prisma.ServiceSchedulingUncheckedCreateInput {
  const family = input.family?.trim() || null;
  return {
    productId: input.productId,
    tenantId: input.tenantId,
    durationMin: input.durationMin,
    bufferBeforeMin: SCHEDULING_DEFAULTS.bufferBeforeMin,
    bufferAfterMin: SCHEDULING_DEFAULTS.bufferAfterMin,
    staffRequired: SCHEDULING_DEFAULTS.staffRequired,
    onlineBookable: SCHEDULING_DEFAULTS.onlineBookable,
    channels: SCHEDULING_DEFAULTS.channels as unknown as Prisma.InputJsonValue,
    family,
  };
}
