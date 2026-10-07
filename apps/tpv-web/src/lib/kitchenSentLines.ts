// v2-H1-venta-y-sala · §5. Qué líneas de la comanda están EN COCINA y
// cuáles están SIN ENVIAR.
//
// LA DECISIÓN, Y POR QUÉ ES ÉSTA
//
// La decisión 5 del bloque pide partir la comanda en dos: «En cocina ·
// hh:mm» (líneas ya enviadas, atenuadas, SIN −/+) y «Sin enviar»
// (destacadas, con −/+ de 56 px). La 3d añade que quitar algo ya enviado
// sigue siendo la anulación de hoy, no un `−`.
//
// El problema: **`TicketLine` no tiene ninguna marca de envío ni un
// `createdAt`** (mirado en `packages/db/prisma/schema.prisma`), y el
// prompt prohíbe cambios de esquema y migraciones. La marca de envío
// vive en el TICKET: `lastSentAt` + `lastSentRevision`, que v1.4 escribe
// en cada despacho con éxito. O sea: el servidor sabe CUÁNDO se envió
// pero no QUÉ se envió.
//
// Lo descartado, con su motivo:
//
//   · **Añadir `sentAt` a `TicketLine`.** Es la respuesta correcta y es
//     la que habrá que dar algún día, pero lleva migración y el prompt
//     la veta. Queda declarada como carryover.
//   · **Deducirlo del orden de las líneas.** No hay orden garantizado:
//     `DRAFT_INCLUDE` pide `lines: true` sin `orderBy`, así que el que
//     llega es el orden físico de Postgres. Apoyar en eso la diferencia
//     entre «la cocina lo tiene» y «la cocina no lo tiene» es apoyarla
//     en un detalle del planificador.
//   · **Sólo localStorage.** Funciona hasta que el camarero recarga en
//     otro terminal, y entonces la comanda entera aparece «sin enviar»
//     con sus −/+ puestos: el TPV ofreciendo corregir unidades de algo
//     que ya está en la plancha.
//
// LO QUE SE HACE
//
// Dos fuentes que se complementan:
//
//   1. **El conjunto local de ids enviados**, persistido por ticket. Lo
//      escribe cada envío con éxito con las líneas que había en ese
//      momento. Es exacto para el terminal que envió.
//   2. **El `lastSentAt` del servidor como semilla.** Al abrir una mesa,
//      si el ticket dice que ya se envió algo y este terminal no tiene
//      registro local, se marcan como enviadas **las líneas que el DRAFT
//      traía al abrir**. Es lo que hace que la pantalla diga la verdad
//      después de recargar o en el terminal de al lado.
//
// EL CASO QUE ESTO NO ACIERTA, dicho en voz alta: una línea que **otro
// terminal** añade DESPUÉS del último envío y antes de que este terminal
// abra la mesa se pinta como «En cocina» sin estarlo. El camarero la ve
// atenuada y sin −/+, así que el fallo es por el lado prudente (no
// ofrece corregir lo que no debe), pero es un fallo. En un bar de un
// terminal —la realidad de v1.10, que asume un terminal offline— no
// ocurre. Se arregla con el `sentAt` por línea de v2-H2.

const STORAGE_PREFIX = "mipiacetpv-comanda-enviada";

function storageKey(ticketId: string): string {
  return `${STORAGE_PREFIX}:${ticketId}`;
}

export interface SentState {
  /** Ids de línea que la cocina ya tiene. */
  sentLineIds: Set<string>;
  /** ISO del último envío con éxito, o null si nunca se envió. */
  lastSentAt: string | null;
  /** Nº de la última comanda enviada. 0 = ninguna. */
  revision: number;
}

export function emptySentState(): SentState {
  return { sentLineIds: new Set(), lastSentAt: null, revision: 0 };
}

interface StoredShape {
  ids: string[];
  at: string | null;
  rev: number;
}

export function loadSentState(ticketId: string): SentState {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(storageKey(ticketId));
  } catch {
    return emptySentState();
  }
  if (!raw) return emptySentState();
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return emptySentState();
    }
    const s = parsed as Partial<StoredShape>;
    return {
      sentLineIds: new Set(
        Array.isArray(s.ids) ? s.ids.filter((x): x is string => typeof x === "string") : [],
      ),
      lastSentAt: typeof s.at === "string" ? s.at : null,
      revision: typeof s.rev === "number" && Number.isFinite(s.rev) ? s.rev : 0,
    };
  } catch {
    return emptySentState();
  }
}

export function saveSentState(ticketId: string, state: SentState): void {
  try {
    const shape: StoredShape = {
      ids: [...state.sentLineIds],
      at: state.lastSentAt,
      rev: state.revision,
    };
    localStorage.setItem(storageKey(ticketId), JSON.stringify(shape));
  } catch {
    /* cuota llena o almacenamiento bloqueado: el estado sigue vivo en
       memoria durante esta sesión y sólo se pierde al recargar */
  }
}

/** Al cobrar o vaciar la mesa, el registro de esa comanda deja de valer. */
export function clearSentState(ticketId: string): void {
  try {
    localStorage.removeItem(storageKey(ticketId));
  } catch {
    /* ignorado: un registro huérfano no afecta a otra mesa, y el id del
       ticket no se reutiliza */
  }
}

/**
 * El estado de envío al ABRIR una mesa, combinando lo local con lo que
 * dice el servidor.
 *
 * `serverLastSentAt` / `serverRevision` vienen del DRAFT
 * (`lastSentAt` / `lastSentRevision`). `draftLineIds` son las líneas que
 * el DRAFT trae en ese momento.
 *
 * Las reglas, en orden:
 *
 *   1. El servidor dice que **nunca se envió** → nada está en cocina, y
 *      cualquier registro local es basura de un ticket anterior. Esto es
 *      exacto siempre: `lastSentAt` sólo se escribe con un envío con
 *      éxito.
 *   2. Se envió y **hay registro local** → manda el local, que es el que
 *      sabe QUÉ se envió. Se filtran los ids que ya no existen en el
 *      DRAFT (líneas anuladas desde el mapa o desde otra caja): un id
 *      fantasma en el conjunto no haría daño, pero el conjunto es lo que
 *      se persiste y no tiene por qué crecer para siempre.
 *   3. Se envió y **no hay registro local** (recarga, otro terminal) →
 *      se siembra con las líneas del DRAFT. Es la aproximación descrita
 *      en la cabecera: prudente, y equivocada sólo con dos terminales
 *      escribiendo en la misma mesa entre dos envíos.
 *
 * La revisión se queda con la MAYOR de las dos: el servidor es la
 * verdad, pero un envío local que todavía no se ha releído no puede
 * hacer que el rótulo retroceda de «Reenviar (nº 3)» a «Enviar».
 */
export function reconcileSentState(
  ticketId: string,
  draftLineIds: string[],
  serverLastSentAt: string | null | undefined,
  serverRevision: number | null | undefined,
): SentState {
  const serverAt = serverLastSentAt ?? null;
  const serverRev = serverRevision ?? 0;

  if (!serverAt && serverRev === 0) {
    clearSentState(ticketId);
    return emptySentState();
  }

  const local = loadSentState(ticketId);
  const alive = new Set(draftLineIds);
  const next: SentState =
    local.sentLineIds.size > 0
      ? {
          sentLineIds: new Set([...local.sentLineIds].filter((id) => alive.has(id))),
          lastSentAt: serverAt ?? local.lastSentAt,
          revision: Math.max(serverRev, local.revision),
        }
      : {
          sentLineIds: new Set(draftLineIds),
          lastSentAt: serverAt,
          revision: Math.max(serverRev, local.revision),
        };
  saveSentState(ticketId, next);
  return next;
}

/**
 * Tras un envío con éxito: todo lo que hay ahora en la comanda pasa a
 * estar en cocina.
 *
 * Se parte del conjunto anterior y se añade, no se reemplaza: una línea
 * enviada en la comanda nº 1 y borrada del DRAFT por otra caja no debe
 * reaparecer como «sin enviar» si vuelve.
 */
export function markLinesSent(
  ticketId: string,
  lineIds: string[],
  sentAt: string,
  revision: number,
): SentState {
  const prev = loadSentState(ticketId);
  const next: SentState = {
    sentLineIds: new Set([...prev.sentLineIds, ...lineIds]),
    lastSentAt: sentAt,
    revision: Math.max(revision, prev.revision),
  };
  saveSentState(ticketId, next);
  return next;
}

export interface SplitComanda<T> {
  /** Líneas que la cocina ya tiene. Atenuadas y SIN −/+. */
  sent: T[];
  /** Líneas pendientes de enviar. Destacadas y con −/+ de 56 px. */
  pending: T[];
}

/**
 * Parte la comanda en los dos bloques de la decisión 5, **conservando el
 * orden** de la lista original dentro de cada bloque.
 *
 * El orden importa: la comanda se lee de arriba abajo y el camarero
 * reconoce lo que acaba de marcar por donde está. Reordenar dentro de un
 * bloque convertiría «la última que toqué» en «búscala».
 */
export function splitComanda<T extends { id: string }>(
  lines: T[],
  sentLineIds: Set<string>,
): SplitComanda<T> {
  const sent: T[] = [];
  const pending: T[] = [];
  for (const line of lines) {
    if (sentLineIds.has(line.id)) sent.push(line);
    else pending.push(line);
  }
  return { sent, pending };
}

/**
 * «EN COCINA · hh:mm» con la hora del último envío.
 *
 * Hora y no «hace 12 min»: lo que el camarero compara es contra el reloj
 * de la cocina («¿el de las 10:07 ya salió?»), no contra un contador que
 * cambia cada minuto. El mismo criterio por el que la comanda impresa
 * lleva hora.
 */
export function kitchenSectionLabel(lastSentAt: string | null): string {
  if (!lastSentAt) return "EN COCINA";
  const d = new Date(lastSentAt);
  if (Number.isNaN(d.getTime())) return "EN COCINA";
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `EN COCINA · ${hh}:${mm}`;
}
