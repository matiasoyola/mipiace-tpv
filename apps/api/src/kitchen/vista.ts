// kds-1-cocina · LO QUE VE LA PANTALLA.
//
// `GET /kitchen/comandas` es **la verdad**. Los eventos del bus son avisos
// («mira otra vez»); esto es lo que se mira, y es lo que la pantalla pide
// al conectar y al reconectar (decisión 9).
//
// ── QUÉ LLEVA Y QUÉ NO ────────────────────────────────────────────────
//
// Lleva: mesa, nº de comanda, minutos, platos con cantidad, modificadores
// y notas, tiempo, silla, alergias, anulados y cambios sin «Visto».
//
// **No lleva precios, ni hora exacta, ni camarero, ni comensales**
// (decisión 3). No es sólo que no hagan falta: una pantalla colgada en la
// pared de una cocina la ve cualquiera que pase por delante, incluido el
// cliente que va al baño.
//
// ── DOS COSAS SE LEEN EN VIVO Y UNA ESTÁ CONGELADA ────────────────────
//
// · **Las alergias de la mesa, EN VIVO.** La decisión 3 dice que la
//   alergia «vale para todo lo que pida esa mesa, también después», así
//   que un celíaco declarado cuando ya había una comanda en pantalla tiene
//   que aparecer en la comanda que ya estaba. Si se hubieran copiado al
//   enviar, la franja roja llegaría sólo a las comandas siguientes — y
//   justo la que está en la plancha se cocinaría sin saberlo.
// · **El estado de los tiempos, EN VIVO** (`firedAt` de cada línea, que lo
//   escribe «Marchar 2º»).
// · **Los alérgenos del PLATO, congelados** al enviar
//   (`KitchenOrderLine.allergens`). Un plato que salió marcado «lleva
//   gluten» tiene que seguir marcándolo aunque alguien corrija la ficha a
//   media mañana: lo que está en la plancha es lo de antes.
//
// ── EL SEMÁFORO NO CUENTA DESDE AQUÍ ──────────────────────────────────
//
// El reloj de cada bloque sale de `firedAt`, no de `sentAt`. Una mesa con
// el segundo plato en espera lleva media hora en pantalla y su bloque
// retenido marca **0 min** al marchar. Tiene su propio sabotaje: «El
// semáforo cuenta desde la nota».

import type { Allergen, KitchenSection } from "@mipiacetpv/db";
import {
  ALERGENOS,
  avisoChoque,
  choqueAlergenos,
  franjaAlergia,
  type Alergeno,
} from "@mipiacetpv/ticket-model";

import { getPrisma } from "../context.js";
import { notasDeModificadores } from "./envio.js";

export interface LineaVista {
  id: string;
  name: string;
  /** Unidades VIVAS de esta tarjeta: las que se mandaron menos lo anulado. */
  units: number;
  /** Las que se mandaron, para pintar «ERAN 3». `null` si no se anuló nada. */
  unitsOriginal: number | null;
  notes: string[];
  course: number;
  seat: number | null;
  /** `false` = «EN ESPERA»: gris y sin semáforo. */
  fired: boolean;
  done: boolean;
  /** Decisión 6 · anulado sin «Visto»: tachado en rojo y parpadeando. */
  voidedUnits: number;
  voidPending: boolean;
  /** MERMA: la cocina ya lo había tachado cuando se anuló. */
  doneBeforeVoid: boolean;
  /** Decisión 6 · «CAMBIO» en ámbar hasta «Visto». */
  changeNote: string | null;
  changePending: boolean;
  /** Capa 3 · este plato lleva un alérgeno de la mesa. Informativo. */
  carries: string[];
  /**
   * Capa 3, el grito: este plato es de la silla alérgica y lleva SU
   * alérgeno. Rojo y parpadeando. `null` en todo lo demás.
   */
  allergyWarning: string | null;
}

export interface ComandaVista {
  id: string;
  section: KitchenSection;
  ticketId: string;
  tableId: string | null;
  tableName: string | null;
  number: number;
  urgent: boolean;
  lateArrival: boolean;
  sentAt: string;
  /**
   * De dónde cuenta el semáforo: el `firedAt` más antiguo de las líneas
   * que han marchado. `null` = la tarjeta entera está EN ESPERA y no lleva
   * semáforo.
   */
  firedAt: string | null;
  /** Lo que ordena las tarjetas: `firedAt` si marchó, `sentAt` si no. */
  orderAt: string;
  readyAt: string | null;
  servedAt: string | null;
  recoveredAt: string | null;
  /** Decisión 8 · parpadea hasta el primer tachado. */
  isNew: boolean;
  /** «⚠ SILLA 3 · SIN GLUTEN». «Toda la mesa» primero. */
  allergyBands: string[];
  lines: LineaVista[];
}

export interface AjustesCocina {
  greenMaxMin: number;
  amberMaxMin: number;
  readyBeep: boolean;
}

export interface VistaCocina {
  /** La hora del SERVIDOR. La pantalla cuenta los minutos contra ésta y no
   *  contra su reloj: una tablet con la hora desviada pintaría semáforos
   *  inventados, y una tablet barata se desvía. */
  serverTime: string;
  settings: AjustesCocina;
  sections: KitchenSection[];
  /** Las abiertas, ya ordenadas: urgentes primero y después por llegada. */
  orders: ComandaVista[];
  /** Las «Listas» pendientes de «Servido» — la columna estrecha. */
  ready: ComandaVista[];
}

interface OpcionesVista {
  storeId: string;
  sections: KitchenSection[];
  /**
   * «Hoy» (decisión 7): además de lo abierto, lo YA SERVIDO del día, para
   * poder devolver a la pantalla una tarjeta que se tachó sin querer. En
   * ese modo todo va en `orders`, de la más reciente a la más antigua, y
   * `ready` viene vacío: es un listado para buscar, no la pantalla.
   */
  incluirServidasDesde?: Date;
}

export async function construirVista(
  opts: OpcionesVista,
): Promise<VistaCocina> {
  const prisma = getPrisma();
  const now = new Date();

  const store = await prisma.store.findUniqueOrThrow({
    where: { id: opts.storeId },
    select: {
      kitchenGreenMaxMin: true,
      kitchenAmberMaxMin: true,
      kitchenReadyBeep: true,
    },
  });

  const orders = await prisma.kitchenOrder.findMany({
    where: {
      storeId: opts.storeId,
      section: { in: opts.sections },
      ...(opts.incluirServidasDesde
        ? { sentAt: { gte: opts.incluirServidasDesde } }
        : { servedAt: null }),
    },
    select: {
      id: true,
      section: true,
      ticketId: true,
      tableId: true,
      tableName: true,
      number: true,
      urgent: true,
      lateArrival: true,
      sentAt: true,
      readyAt: true,
      servedAt: true,
      recoveredAt: true,
      ticket: {
        select: {
          allergies: { select: { seat: true, allergen: true } },
        },
      },
      lines: {
        select: {
          id: true,
          nameSnapshot: true,
          units: true,
          modifiers: true,
          course: true,
          seat: true,
          allergens: true,
          firedAt: true,
          doneAt: true,
          voidedUnits: true,
          voidedAt: true,
          voidSeenAt: true,
          doneBeforeVoid: true,
          changedAt: true,
          changeNote: true,
          changeSeenAt: true,
        },
      },
    },
  });

  const vistas = orders.map((o) => aVista(o));
  // Urgentes primero y después por llegada a cocina, la más antigua
  // primero (decisión 7). El ORDEN DE LECTURA —izquierda a derecha y luego
  // la fila de abajo— lo pone la pantalla sobre esta lista: aquí sólo se
  // garantiza que la posición 0 es la que hay que leer antes.
  const cmp = (a: ComandaVista, b: ComandaVista): number => {
    if (a.urgent !== b.urgent) return a.urgent ? -1 : 1;
    return a.orderAt.localeCompare(b.orderAt);
  };

  const settings: AjustesCocina = {
    greenMaxMin: store.kitchenGreenMaxMin,
    amberMaxMin: store.kitchenAmberMaxMin,
    readyBeep: store.kitchenReadyBeep,
  };

  if (opts.incluirServidasDesde) {
    return {
      serverTime: now.toISOString(),
      settings,
      sections: opts.sections,
      orders: vistas.sort((a, b) => b.sentAt.localeCompare(a.sentAt)),
      ready: [],
    };
  }

  return {
    serverTime: now.toISOString(),
    settings,
    sections: opts.sections,
    orders: vistas.filter((v) => v.readyAt == null).sort(cmp),
    // La columna «Listas» va de la más antigua arriba, como la banda del
    // TPV: el camarero coge lo que lleva más tiempo en el pase.
    ready: vistas
      .filter((v) => v.readyAt != null && v.servedAt == null)
      .sort((a, b) => (a.readyAt ?? "").localeCompare(b.readyAt ?? "")),
  };
}

function aVista(o: {
  id: string;
  section: KitchenSection;
  ticketId: string;
  tableId: string | null;
  tableName: string | null;
  number: number;
  urgent: boolean;
  lateArrival: boolean;
  sentAt: Date;
  readyAt: Date | null;
  servedAt: Date | null;
  recoveredAt: Date | null;
  ticket: { allergies: Array<{ seat: number | null; allergen: Allergen }> };
  lines: Array<{
    id: string;
    nameSnapshot: string;
    units: unknown;
    modifiers: unknown;
    course: number;
    seat: number | null;
    allergens: Allergen[];
    firedAt: Date | null;
    doneAt: Date | null;
    voidedUnits: unknown;
    voidedAt: Date | null;
    voidSeenAt: Date | null;
    doneBeforeVoid: boolean;
    changedAt: Date | null;
    changeNote: string | null;
    changeSeenAt: Date | null;
  }>;
}): ComandaVista {
  // Las alergias de la mesa, EN VIVO (ver la cabecera).
  const porSilla = new Map<number | null, Alergeno[]>();
  for (const a of o.ticket.allergies) {
    const k = a.seat ?? null;
    const prev = porSilla.get(k) ?? [];
    prev.push(a.allergen as Alergeno);
    porSilla.set(k, prev);
  }
  const deLaMesa = porSilla.get(null) ?? [];
  const todas = [...new Set(o.ticket.allergies.map((a) => a.allergen as Alergeno))];
  const deSilla = (seat: number | null): Alergeno[] =>
    seat == null
      ? deLaMesa
      : [...new Set([...(porSilla.get(seat) ?? []), ...deLaMesa])];

  const allergyBands: string[] = [];
  if (deLaMesa.length > 0) allergyBands.push(franjaAlergia(null, deLaMesa));
  for (const seat of [...porSilla.keys()]
    .filter((k): k is number => k != null)
    .sort((a, b) => a - b)) {
    allergyBands.push(franjaAlergia(seat, porSilla.get(seat)!));
  }

  const lines: LineaVista[] = o.lines.map((l) => {
    const units = Number(l.units);
    const voided = Number(l.voidedUnits);
    const alergenosPlato = l.allergens as Alergeno[];
    const choque =
      l.seat != null
        ? choqueAlergenos(alergenosPlato, deSilla(l.seat))
        : [];
    // Capa 3 informativa: el plato lleva algo que ALGUIEN de esta mesa no
    // puede comer, aunque no se sepa de quién es el plato. Se pinta «lleva
    // gluten» en pequeño, sin rojo y sin parpadeo: es un aviso, no una
    // alarma, y la regla del rojo dice que el rojo es para lo que no puede
    // esperar.
    const carries = choqueAlergenos(alergenosPlato, todas).map(
      (a) => ALERGENOS[a].lleva.toLowerCase(),
    );
    return {
      id: l.id,
      name: l.nameSnapshot,
      units: Math.round((units - voided) * 1000) / 1000,
      unitsOriginal: voided > 0 ? units : null,
      notes: notasDeModificadores(l.modifiers),
      course: l.course,
      seat: l.seat,
      fired: l.firedAt != null,
      done: l.doneAt != null,
      voidedUnits: voided,
      voidPending: l.voidedAt != null && l.voidSeenAt == null,
      doneBeforeVoid: l.doneBeforeVoid,
      changeNote: l.changeNote,
      changePending: l.changedAt != null && l.changeSeenAt == null,
      carries,
      allergyWarning: avisoChoque(choque),
    };
  });

  const marchados = o.lines
    .map((l) => l.firedAt)
    .filter((d): d is Date => d != null)
    .sort((a, b) => a.getTime() - b.getTime());
  const firedAt = marchados[0] ?? null;

  return {
    id: o.id,
    section: o.section,
    ticketId: o.ticketId,
    tableId: o.tableId,
    tableName: o.tableName,
    number: o.number,
    urgent: o.urgent,
    lateArrival: o.lateArrival,
    sentAt: o.sentAt.toISOString(),
    firedAt: firedAt ? firedAt.toISOString() : null,
    orderAt: (firedAt ?? o.sentAt).toISOString(),
    readyAt: o.readyAt ? o.readyAt.toISOString() : null,
    servedAt: o.servedAt ? o.servedAt.toISOString() : null,
    recoveredAt: o.recoveredAt ? o.recoveredAt.toISOString() : null,
    // Decisión 8 · parpadea hasta que se tacha su PRIMER plato. No hasta
    // «Lista»: lo que el parpadeo dice es «nadie ha mirado esto todavía».
    isNew: o.readyAt == null && o.lines.every((l) => l.doneAt == null),
    allergyBands,
    lines,
  };
}

/** Las 00:00 locales de hoy. Lo que «Hoy» entiende por hoy. */
export function inicioDelDia(now: Date): Date {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d;
}
