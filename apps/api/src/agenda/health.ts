// B-reservas-9 · Panel de salud de la agenda.
//
// El principio del bloque (ADR-F3, auditabilidad): **no hay ni una cifra en
// esta pantalla sin su consulta al lado**. Cada tarjeta es una entrada de
// este módulo con `{ key, title, query, explain, run() }`, y la constante
// que se enseña en `query` es LITERALMENTE la que se ejecuta — no una copia
// a mano que se queda vieja. El front no calcula nada: pinta lo que este
// módulo le da.
//
// Por qué existe: un servicio sin ninguna fila `staff_skill` se descarta en
// silencio (`engine.ts:443`, `eligible.length < staffRequired`) y hasta este
// bloque ninguna pantalla lo insinuaba. En el centro real eran 44 de 45
// servicios y costó dos semanas de diagnóstico.
//
// Degradación honesta: una tarjeta cuyo bloque no esté construido sale
// `status:"unavailable"` con `value: null` y dice de qué depende. **Nunca un
// cero.** Un cero falso parece un dato bueno y es peor que un hueco
// declarado. La disponibilidad NO está cableada a mano: cada tarjeta la
// prueba contra el esquema vivo (`hasTable`). Pero la sonda sola no
// enciende: una consulta que nadie ha ejecutado nunca puede casar en forma
// y mentir en significado, y devolvería un cero falso. El encendido pide
// las DOS cosas — tabla presente y consulta validada por el bloque que la
// publica (`CONTRATO_VALIDADO`, más abajo).
//
// Sólo lectura. Este módulo diagnostica; no arregla nada.

import type { PrismaClient } from "@mipiacetpv/db";

// ── Contrato de salida ────────────────────────────────────────────────

/** De qué bloque depende una tarjeta que todavía no se puede calcular. */
export interface HealthCardDependency {
  /** El bloque que la publicará ("B-reservas-8"). */
  block: string;
  /** Qué falta, en lenguaje llano. */
  what: string;
}

/** Una fila de la lista que acompaña a la cifra (el "y cuáles"). */
export interface HealthCardItem {
  id: string;
  label: string;
  /** El dato que desambigua (auditoría §7.1 nº 13). */
  detail: string | null;
}

export interface HealthCardResult {
  key: HealthCardKey;
  title: string;
  /** Cómo se lee la cifra en plural: "servicios", "citas", "ventanas"… */
  unit: string;
  /** Y en singular, para que no se lea "1 servicios". */
  unitOne: string;
  status: "ok" | "unavailable";
  /** SIEMPRE null si `status !== "ok"`. Jamás un cero de relleno. */
  value: number | null;
  items: HealthCardItem[];
  /** Qué decir cuando la cifra es 0 y eso es una buena noticia. */
  goodNews: string;
  /** «Cómo se calcula esto», en lenguaje llano, para el operador. */
  explain: string;
  /** La consulta EXACTA que produce la cifra. La misma que se ejecuta. */
  query: string;
  /** Los parámetros con los que se ejecuta, en orden ($1, $2…). */
  params: string[];
  dependsOn: HealthCardDependency | null;
  /** Por qué no se puede calcular hoy. null cuando `status === "ok"`. */
  unavailableReason: string | null;
}

export interface AgendaHealth {
  generatedAt: string;
  cards: HealthCardResult[];
}

export type HealthCardKey =
  | "servicios-sin-profesional"
  | "duracion-fuera-de-patron"
  | "saldo-vivo-sin-cita"
  | "filtrado-por-reglas"
  | "citas-por-canal-24h"
  | "ventanas-fuera-de-turno";

export interface HealthContext {
  prisma: PrismaClient;
  tenantId: string;
  /** El reloj entra inyectado (B-reservas-6a): el módulo no tiene reloj propio. */
  now: Date;
  /**
   * Una tarjeta que peta se degrada en pantalla, pero NO en silencio: el
   * fallo va al log del servidor. Sin esto, una consulta rota se ve igual
   * que una dependencia que falta, y el panel dejaría de ser fiable
   * exactamente por la razón que este bloque combate.
   */
  logError?: (key: HealthCardKey, err: unknown) => void;
}

/** Lo que una tarjeta puede decidir antes de calcular nada. */
type Availability =
  | { ok: true; params: unknown[] }
  | { ok: false; reason: string };

interface HealthCard {
  key: HealthCardKey;
  title: string;
  unit: string;
  unitOne: string;
  explain: string;
  query: string;
  /** Cómo se describen los parámetros de `query` en pantalla. */
  describeParams: (params: unknown[]) => string[];
  goodNews: string;
  dependsOn: HealthCardDependency | null;
  available: (ctx: HealthContext) => Promise<Availability>;
  run: (
    ctx: HealthContext,
    params: unknown[],
  ) => Promise<{ value: number; items: HealthCardItem[] }>;
}

// ── Sondas de esquema ─────────────────────────────────────────────────
//
// Una tarjeta no se declara "no disponible" a mano en una lista: se
// pregunta al esquema. Así el día que B-6b / B-7b / B-8 publiquen su tabla
// la tarjeta se enciende sin tocar este fichero, y si la publican con otras
// columnas sigue apagada en vez de romperse con un 500.

async function hasTable(
  prisma: PrismaClient,
  table: string,
  columns: string[],
): Promise<boolean> {
  const rows = await prisma.$queryRawUnsafe<Array<{ n: number }>>(
    `SELECT COUNT(*)::int AS n
       FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = $1
        AND column_name = ANY($2::text[])`,
    table,
    columns,
  );
  return Number(rows[0]?.n ?? 0) === columns.length;
}

// ── El interruptor del §8 · un contrato no es codigo probado ─────────
//
// Las consultas de las tarjetas 3, 4 y 6 estan escritas contra tablas que
// hoy no existen: NADIE las ha ejecutado nunca. La sonda de esquema
// protege de dos cosas —del 500 y del nombre de columna cambiado— pero NO
// del significado. Una tabla que casa en FORMA y no en SEMANTICA (un
// `type` con otras etiquetas, un `filtered` que cuenta otra cosa, ventanas
// caducadas que siguen contando) no rompe: devuelve un CERO. Y un cero
// falso, en el panel que existe precisamente para que no haya ceros
// falsos, es el peor resultado posible. Encendiendose solo, ademas, el dia
// de una migracion en produccion y sin que nadie lo este mirando.
//
// Por eso el encendido automatico ESPERA: la tarjeta se enciende cuando su
// tabla existe Y el bloque que la publica ha validado su consulta contra
// datos reales. Validar = ejecutarla contra Postgres real y dejar su caso
// en el e2e; marcarlo = poner su linea de aqui a `true`, en la rama de ese
// bloque. Una linea, en el mismo sitio donde esta la consulta.
//
// La sonda no se va: con el flag en `true` y un esquema distinto del
// contrato, la tarjeta sigue apagada en vez de romperse con un 500.
export const CONTRATO_VALIDADO: Record<string, boolean> = {
  "saldo-vivo-sin-cita": false, // B-reservas-8
  "filtrado-por-reglas": false, // B-reservas-6b
  "ventanas-fuera-de-turno": false, // B-reservas-7b
};

/** Una dependencia que se prueba contra el esquema, con su frase. */
function schemaDependency(
  key: HealthCardKey,
  table: string,
  columns: string[],
  reason: string,
  block: string,
): (ctx: HealthContext) => Promise<Availability> {
  return async (ctx) => {
    if (!(await hasTable(ctx.prisma, table, columns))) {
      return { ok: false, reason };
    }
    if (CONTRATO_VALIDADO[key] !== true) {
      return {
        ok: false,
        reason:
          `La tabla \`${table}\` ya existe, pero la consulta de esta tarjeta ` +
          `todavia no se ha ejecutado nunca contra ella. La enciende ` +
          `${block} cuando la valide con datos reales (§8 del cierre de ` +
          "B-reservas-9).",
      };
    }
    return { ok: true, params: [] };
  };
}

const ALWAYS = async (): Promise<Availability> => ({ ok: true, params: [] });

// ── El patrón de duración declarado por el centro ─────────────────────
//
// La tarjeta 2 compara contra lo que el CENTRO declara, no contra una
// convención que nos inventemos: la fila `booking_policies` con
// `key = 'agenda.duration_pattern'` y valor `{ stepMin, pickupMin }`.
//
//   stepMin   — la duración de agenda va en múltiplos de estos minutos
//   pickupMin — la recogida va en `buffer_after_min`, y vale esto
//
// Sin esa fila la tarjeta NO se calcula (y no se inventa un 10 porque en
// Koibox fuera 10): sale "no disponible" diciendo qué hay que declarar.
// Ésta es la lectura de §1.4 del documento de entrada en nuestro modelo:
// la convención +10 era tribal, y lo que la cazó —un mapeo que llevaba
// meses mintiendo— fue justamente tenerla escrita.

export const DURATION_PATTERN_KEY = "agenda.duration_pattern";

interface DurationPattern {
  stepMin: number | null;
  pickupMin: number | null;
}

async function loadDurationPattern(
  ctx: HealthContext,
): Promise<DurationPattern | null> {
  const rows = await ctx.prisma.$queryRawUnsafe<Array<{ value: unknown }>>(
    `SELECT value FROM booking_policies WHERE tenant_id = $1::uuid AND key = $2`,
    ctx.tenantId,
    DURATION_PATTERN_KEY,
  );
  const raw = rows[0]?.value;
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const num = (v: unknown): number | null =>
    typeof v === "number" && Number.isInteger(v) && v > 0 ? v : null;
  const pattern: DurationPattern = {
    stepMin: num(obj.stepMin),
    pickupMin: num(obj.pickupMin),
  };
  // Una fila que no declara ninguno de los dos no declara nada.
  if (pattern.stepMin === null && pattern.pickupMin === null) return null;
  return pattern;
}

// ── Las consultas ─────────────────────────────────────────────────────
//
// Constantes exportadas: son a la vez lo que se ejecuta y lo que se enseña
// en el desplegable «cómo se calcula esto». Si alguien cambia el cálculo,
// cambia la frase que lee el operador. No hay forma de que diverjan.

/**
 * Tarjeta 1. La condición es la MISMA que descarta el hueco en el motor
 * (`engine.ts:443`): profesionales con skill Y perfil de agenda ACTIVO,
 * contados contra `staff_required`. Un servicio que necesita 2 y sólo
 * tiene 1 tampoco se puede dar, y hasta hoy tampoco lo decía nadie.
 */
export const SQL_SERVICIOS_SIN_PROFESIONAL = `
SELECT p.id                     AS id,
       p.name                   AS name,
       ss.staff_required        AS staff_required,
       COUNT(sp.user_id)::int   AS skilled_active,
       COUNT(sk.user_id)::int   AS skilled_total
  FROM service_scheduling ss
  JOIN products p ON p.id = ss.product_id
  LEFT JOIN staff_skills sk
         ON sk.service_id = ss.product_id AND sk.tenant_id = ss.tenant_id
  LEFT JOIN staff_profiles sp
         ON sp.user_id = sk.user_id AND sp.tenant_id = ss.tenant_id
        AND sp.active = true
 WHERE ss.tenant_id = $1::uuid
   AND p.kind = 'SERVICE'
   AND p.active = true
 GROUP BY p.id, p.name, ss.staff_required
HAVING COUNT(sp.user_id) < ss.staff_required
 ORDER BY p.name`.trim();

/** Tarjeta 2. El patrón entra como parámetro; un NULL apaga su mitad. */
export const SQL_DURACION_FUERA_DE_PATRON = `
SELECT p.id                  AS id,
       p.name                AS name,
       ss.duration_min       AS duration_min,
       ss.buffer_after_min   AS buffer_after_min
  FROM service_scheduling ss
  JOIN products p ON p.id = ss.product_id
 WHERE ss.tenant_id = $1::uuid
   AND p.kind = 'SERVICE'
   AND p.active = true
   AND ( ($2::int IS NOT NULL AND ss.duration_min % $2::int <> 0)
      OR ($3::int IS NOT NULL AND ss.buffer_after_min <> $3::int) )
 ORDER BY p.name`.trim();

/** Tarjeta 3. Contrato para B-reservas-8; hoy no hay tabla `vouchers`. */
export const SQL_SALDO_VIVO_SIN_CITA = `
SELECT v.id             AS id,
       v.code           AS code,
       v.sessions_left  AS sessions_left
  FROM vouchers v
 WHERE v.tenant_id = $1::uuid
   AND v.type = 'SESSIONS'
   AND v.sessions_left > 0
   AND NOT EXISTS (
         SELECT 1
           FROM appointments a
          WHERE a.voucher_id = v.id
            AND a.tenant_id = v.tenant_id
            AND a.status NOT IN ('CANCELLED', 'NO_SHOW')
            AND lower(a.timeslot) >= $2::timestamptz
       )
 ORDER BY v.sessions_left DESC`.trim();

/** Tarjeta 4. Contrato para B-reservas-6b: el registro de filtrado. */
export const SQL_FILTRADO_POR_REGLAS = `
SELECT h.rule_key                AS rule_key,
       SUM(h.filtered)::int      AS filtered,
       SUM(h.offered)::int       AS offered
  FROM booking_rule_hits h
 WHERE h.tenant_id = $1::uuid
   AND h.created_at >= $2::timestamptz
 GROUP BY h.rule_key
 ORDER BY filtered DESC, rule_key ASC`.trim();

/** Tarjeta 5. El `origen` de §1.3, que aquí es `ReservationSource`. */
export const SQL_CITAS_POR_CANAL_24H = `
SELECT a.source::text  AS source,
       COUNT(*)::int   AS n
  FROM appointments a
 WHERE a.tenant_id = $1::uuid
   AND a.created_at >= $2::timestamptz
 GROUP BY a.source
 ORDER BY n DESC, source ASC`.trim();

/** Tarjeta 6. Contrato para B-reservas-7b: la ventana reservable. */
export const SQL_VENTANAS_FUERA_DE_TURNO = `
SELECT w.id              AS id,
       w.staff_user_id   AS staff_user_id,
       w.valid_from      AS valid_from
  FROM bookable_windows w
 WHERE w.tenant_id = $1::uuid
   AND w.derived_from_shift_id IS NULL
 ORDER BY w.valid_from`.trim();

// ── El catálogo de tarjetas ───────────────────────────────────────────

const MS_24H = 24 * 60 * 60 * 1000;

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

/** El patrón puede no estar declarado (o no estar aún cargado): se dice. */
function minutesOrNothing(value: unknown): string {
  return typeof value === "number" ? `${value} min` : "sin declarar";
}

export const HEALTH_CARDS: HealthCard[] = [
  {
    key: "servicios-sin-profesional",
    title: "Servicios que nadie puede hacer",
    unit: "servicios",
    unitOne: "servicio",
    goodNews: "Todos los servicios agendables tienen a alguien que los da.",
    explain:
      "Cuenta los servicios con ficha de agenda (duración configurada) que " +
      "no llegan a los profesionales que necesitan: se miran los que tienen " +
      "el servicio asignado Y el perfil de agenda activo, y se comparan con " +
      "los que el servicio exige a la vez. Es la misma condición con la que " +
      "el motor descarta el hueco, así que un servicio en esta lista no " +
      "ofrece ni una hora — y hasta hoy lo hacía en silencio.",
    query: SQL_SERVICIOS_SIN_PROFESIONAL,
    describeParams: () => ["$1 = este negocio"],
    dependsOn: null,
    available: ALWAYS,
    async run(ctx) {
      const rows = await ctx.prisma.$queryRawUnsafe<
        Array<{
          id: string;
          name: string;
          staff_required: number;
          skilled_active: number;
          skilled_total: number;
        }>
      >(SQL_SERVICIOS_SIN_PROFESIONAL, ctx.tenantId);
      return {
        value: rows.length,
        items: rows.map((r) => ({
          id: r.id,
          label: r.name,
          detail: detailSinProfesional(
            Number(r.staff_required),
            Number(r.skilled_active),
            Number(r.skilled_total),
          ),
        })),
      };
    },
  },
  {
    key: "duracion-fuera-de-patron",
    title: "Duraciones que no cuadran con la carta",
    unit: "servicios",
    unitOne: "servicio",
    goodNews: "Ninguna duración se sale del patrón que declara el centro.",
    explain:
      "El centro declara su patrón (en qué múltiplo van las duraciones y " +
      "cuántos minutos de recogida van en el buffer). Esta tarjeta lista los " +
      "servicios que se salen. Sirve para lo mismo que sirvió en el spa: " +
      "cazar un mapeo que miente — un servicio que apuntaba a 30 min y 35 € " +
      "en vez de a 120 min y 130 € se delata porque rompe el patrón.",
    query: SQL_DURACION_FUERA_DE_PATRON,
    describeParams: (p) => [
      "$1 = este negocio",
      `$2 = múltiplo declarado: ${minutesOrNothing(p[1])}`,
      `$3 = recogida declarada: ${minutesOrNothing(p[2])}`,
    ],
    dependsOn: {
      block: "patrón del centro",
      what:
        `el patrón de duración declarado (fila \`${DURATION_PATTERN_KEY}\` ` +
        "en las políticas del centro, con `stepMin` y/o `pickupMin`)",
    },
    async available(ctx) {
      const pattern = await loadDurationPattern(ctx);
      if (!pattern) {
        return {
          ok: false,
          reason:
            "Este centro no ha declarado su patrón de duración. Sin patrón " +
            "no hay desviación que medir: no se inventa uno.",
        };
      }
      return { ok: true, params: [pattern.stepMin, pattern.pickupMin] };
    },
    async run(ctx, params) {
      // `params` llega como [tenantId, stepMin, pickupMin]: el tenant lo
      // pone el runner, que es quien garantiza que va en $1.
      const [, stepMin, pickupMin] = params as [
        string,
        number | null,
        number | null,
      ];
      const rows = await ctx.prisma.$queryRawUnsafe<
        Array<{
          id: string;
          name: string;
          duration_min: number;
          buffer_after_min: number;
        }>
      >(SQL_DURACION_FUERA_DE_PATRON, ctx.tenantId, stepMin, pickupMin);
      return {
        value: rows.length,
        items: rows.map((r) => ({
          id: r.id,
          label: r.name,
          detail: detailDuracion(
            Number(r.duration_min),
            Number(r.buffer_after_min),
            stepMin,
            pickupMin,
          ),
        })),
      };
    },
  },
  {
    key: "saldo-vivo-sin-cita",
    title: "Programas con saldo vivo y sin próxima cita",
    unit: "programas",
    unitOne: "programa",
    goodNews: "Todo el saldo vendido tiene su próxima cita puesta.",
    explain:
      "Bonos de sesiones con sesiones sin gastar y ninguna cita futura " +
      "asociada. Es dinero cobrado y no entregado: la clienta pagó un " +
      "programa y nadie la ha vuelto a citar.",
    query: SQL_SALDO_VIVO_SIN_CITA,
    describeParams: () => ["$1 = este negocio", "$2 = ahora"],
    dependsOn: {
      block: "B-reservas-8",
      what: "el saldo por sesiones (bonos de tipo SESSIONS y su consumo)",
    },
    available: schemaDependency(
      "saldo-vivo-sin-cita",
      "vouchers",
      ["tenant_id", "type", "sessions_left"],
      "El saldo por sesiones todavía no existe en este sistema.",
      "B-reservas-8",
    ),
    async run(ctx) {
      const rows = await ctx.prisma.$queryRawUnsafe<
        Array<{ id: string; code: string | null; sessions_left: number }>
      >(SQL_SALDO_VIVO_SIN_CITA, ctx.tenantId, ctx.now);
      return {
        value: rows.length,
        items: rows.map((r) => ({
          id: r.id,
          label: r.code ?? r.id,
          detail: `${Number(r.sessions_left)} ${plural(
            Number(r.sessions_left),
            "sesión sin gastar",
            "sesiones sin gastar",
          )}`,
        })),
      };
    },
  },
  {
    key: "filtrado-por-reglas",
    title: "Qué han filtrado hoy las reglas",
    unit: "huecos",
    unitOne: "hueco",
    goodNews: "Hoy las reglas no han quitado ningún hueco de en medio.",
    explain:
      "Huecos que las reglas del centro han quitado en las últimas 24 horas, " +
      "desglosados por la regla que los quitó, y sobre cuántos se ofrecieron. " +
      "Sin este desglose las reglas son una caja negra y acaban apagadas por " +
      "desconfianza.",
    query: SQL_FILTRADO_POR_REGLAS,
    describeParams: () => ["$1 = este negocio", "$2 = hace 24 horas"],
    dependsOn: {
      block: "B-reservas-6b",
      what: "las reglas de yield y su registro de filtrado",
    },
    available: schemaDependency(
      "filtrado-por-reglas",
      "booking_rule_hits",
      ["tenant_id", "rule_key", "created_at", "offered", "filtered"],
      "Las reglas de yield todavía no existen, así que no filtran nada.",
      "B-reservas-6b",
    ),
    async run(ctx) {
      const rows = await ctx.prisma.$queryRawUnsafe<
        Array<{ rule_key: string; filtered: number; offered: number }>
      >(SQL_FILTRADO_POR_REGLAS, ctx.tenantId, new Date(ctx.now.getTime() - MS_24H));
      const total = rows.reduce((acc, r) => acc + Number(r.filtered), 0);
      return {
        value: total,
        items: rows.map((r) => ({
          id: r.rule_key,
          label: r.rule_key,
          detail: `${Number(r.filtered)} de ${Number(r.offered)} huecos`,
        })),
      };
    },
  },
  {
    key: "citas-por-canal-24h",
    title: "Citas creadas por canal en 24 h",
    unit: "citas",
    unitOne: "cita",
    goodNews: "En las últimas 24 horas no ha entrado ninguna cita.",
    explain:
      "Citas creadas en las últimas 24 horas, contadas por el canal desde el " +
      "que entraron. Es la métrica de adopción de la agenda: qué porcentaje " +
      "de las citas entra por aquí y no por la libreta.",
    query: SQL_CITAS_POR_CANAL_24H,
    describeParams: () => ["$1 = este negocio", "$2 = hace 24 horas"],
    dependsOn: null,
    available: ALWAYS,
    async run(ctx) {
      const rows = await ctx.prisma.$queryRawUnsafe<
        Array<{ source: string; n: number }>
      >(SQL_CITAS_POR_CANAL_24H, ctx.tenantId, new Date(ctx.now.getTime() - MS_24H));
      const total = rows.reduce((acc, r) => acc + Number(r.n), 0);
      return {
        value: total,
        items: rows.map((r) => ({
          id: r.source,
          label: SOURCE_LABEL[r.source] ?? r.source,
          detail: `${Number(r.n)} ${plural(Number(r.n), "cita", "citas")}`,
        })),
      };
    },
  },
  {
    key: "ventanas-fuera-de-turno",
    title: "Ventanas que se desvían del turno contratado",
    unit: "ventanas",
    unitOne: "ventana",
    goodNews: "Ninguna ventana reservable se aparta del turno contratado.",
    explain:
      "Ventanas reservables que no salen de ningún turno contratado. La " +
      "desviación entre lo que alguien trabaja y lo que la agenda ofrece " +
      "existe y es legítima; lo que no puede ser es que no se vea.",
    query: SQL_VENTANAS_FUERA_DE_TURNO,
    describeParams: () => ["$1 = este negocio"],
    dependsOn: {
      block: "B-reservas-7b",
      what: "la ventana reservable separada del turno contratado",
    },
    available: schemaDependency(
      "ventanas-fuera-de-turno",
      "bookable_windows",
      ["tenant_id", "derived_from_shift_id"],
      "La ventana reservable todavía no está separada del turno: hoy la " +
        "agenda ofrece el turno tal cual, así que no hay desviación posible.",
      "B-reservas-7b",
    ),
    async run(ctx) {
      const rows = await ctx.prisma.$queryRawUnsafe<
        Array<{ id: string; staff_user_id: string | null; valid_from: Date }>
      >(SQL_VENTANAS_FUERA_DE_TURNO, ctx.tenantId);
      return {
        value: rows.length,
        items: rows.map((r) => ({
          id: r.id,
          label: r.staff_user_id ?? "Sin profesional",
          detail: null,
        })),
      };
    },
  },
];

const SOURCE_LABEL: Record<string, string> = {
  PRESENCIAL: "Mostrador",
  WEB: "Web",
  PHONE: "Teléfono",
  GIFT_REDEMPTION: "Canje de bono",
};

/** El dato que desambigua en la tarjeta 1: por qué no se puede dar. */
function detailSinProfesional(
  required: number,
  active: number,
  total: number,
): string {
  if (total === 0) return "Nadie lo tiene asignado";
  if (active === 0)
    return `${total} ${plural(total, "asignada", "asignadas")}, ninguna con perfil de agenda activo`;
  return `${active} de ${required} ${plural(required, "profesional", "profesionales")} a la vez`;
}

/** El dato que desambigua en la tarjeta 2: en qué se sale del patrón. */
function detailDuracion(
  durationMin: number,
  bufferAfterMin: number,
  stepMin: number | null,
  pickupMin: number | null,
): string {
  const parts: string[] = [];
  if (stepMin !== null && durationMin % stepMin !== 0) {
    parts.push(`${durationMin} min no es múltiplo de ${stepMin}`);
  }
  if (pickupMin !== null && bufferAfterMin !== pickupMin) {
    parts.push(`recogida de ${bufferAfterMin} min en vez de ${pickupMin}`);
  }
  return parts.join(" · ");
}

// ── El runner ─────────────────────────────────────────────────────────

/**
 * Corre las seis tarjetas. Una tarjeta que falle NO tumba el panel: sale
 * como no disponible con el motivo. El panel de diagnóstico que se cae
 * entero porque una consulta petó no diagnostica nada.
 */
export async function runAgendaHealth(
  ctx: HealthContext,
): Promise<AgendaHealth> {
  const cards = await Promise.all(HEALTH_CARDS.map((c) => runCard(c, ctx)));
  return { generatedAt: ctx.now.toISOString(), cards };
}

async function runCard(
  card: HealthCard,
  ctx: HealthContext,
): Promise<HealthCardResult> {
  const base = {
    key: card.key,
    title: card.title,
    unit: card.unit,
    unitOne: card.unitOne,
    goodNews: card.goodNews,
    explain: card.explain,
    query: card.query,
    dependsOn: card.dependsOn,
  };
  let availability: Availability;
  try {
    availability = await card.available(ctx);
  } catch (err) {
    ctx.logError?.(card.key, err);
    availability = {
      ok: false,
      reason: "No se ha podido comprobar si esta cifra se puede calcular.",
    };
  }
  if (!availability.ok) {
    return {
      ...base,
      status: "unavailable",
      value: null,
      items: [],
      params: card.describeParams([]),
      unavailableReason: availability.reason,
    };
  }
  const params = [ctx.tenantId, ...availability.params];
  try {
    const { value, items } = await card.run(ctx, params);
    return {
      ...base,
      status: "ok",
      value,
      items,
      params: card.describeParams(params),
      unavailableReason: null,
    };
  } catch (err) {
    ctx.logError?.(card.key, err);
    return {
      ...base,
      status: "unavailable",
      value: null,
      items: [],
      params: card.describeParams(params),
      unavailableReason: "La consulta de esta tarjeta ha fallado.",
    };
  }
}
