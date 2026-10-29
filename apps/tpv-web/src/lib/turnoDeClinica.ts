// clinica-11 · EL TURNO DE UNA CLÍNICA, VISTO DESDE EL TPV.
//
// En una clínica no hay pantalla de «Abrir turno». Lo que hay es esto:
//
//   1. al entrar, el TPV abre su turno **en local** con el fondo que el
//      servidor dice que le toca (`GET /shift/current` → `fondoSugerido`),
//      y se va derecho a la agenda;
//   2. el primer cobro llega al servidor, y es el SERVIDOR quien abre el
//      turno de verdad (`shift/apertura-automatica.ts`);
//   3. después del cobro, el TPV pregunta cuál es y **adopta su id**.
//
// ── POR QUÉ UN TURNO LOCAL Y NO UN `POST /shift/open` ────────────────
//
// Porque un `POST /shift/open` al entrar es abrir el turno AL ENTRAR, y
// eso es justo lo que el bloque no quiere: un martes de sólo revisiones
// —atiende a cuatro pacientes y no cobra a ninguna— dejaría un turno
// abierto que hay que cerrar, y al día siguiente ese turno es de ayer, así
// que el login caería en `forceClose` y le saldría OTRA pantalla. Se habría
// cambiado una pantalla inútil por dos.
//
// Y porque la maquinaria de turno local **ya existe y ya hace esto**
// (v1.10-offline-un-terminal §3): un turno con `localId` y `serverId:
// null`, los tickets llevando el `localId` como `shiftId`, y el outbox
// reescribiéndolos cuando se sabe el id real. Lo único distinto aquí es
// quién avisa del id real: allí era la respuesta del `POST /shift/open`
// que el outbox tenía encolado; aquí es el `GET /shift/current` de después
// del cobro, porque no hay ningún `shift-open` que encolar.
//
// Eso tiene una consecuencia buena y hay que decirla: **el TPV no decide
// el fondo de caja**. Lo decide el servidor en los dos sitios con la misma
// función (`fondoDelUltimoCierre`), y lo que el TPV guarda en local es una
// copia para que un arqueo sin red cuadre. Si las dos no coincidieran, el
// descuadre del cierre no sería de nadie.
//
// ── Y UN DÍA SIN COBROS ──────────────────────────────────────────────
//
// El turno local se queda sin resolver y en el servidor no hay turno. No
// hay nada que cerrar, porque no pasó nada por el cajón. El `localId` se
// va con el `clearLocalShift` del siguiente login.

import { apiWithCashier } from "../api.js";
import {
  getLocalShift,
  mirrorServerShift,
  openLocalShift,
  resolveLocalShift,
} from "./offlineShift.js";
import { resolverTurnoLocal } from "./outbox.js";

/** Lo que contesta `GET /shift/current`. `fondoSugerido` llega sólo
 *  cuando no hay turno abierto (es la única vez que sirve). */
interface RespuestaTurnoActual {
  shift: {
    id: string;
    openedAt: string;
    lastActivityAt: string;
    cashOpening: string;
    userId: string;
    ticketsCount: number;
  } | null;
  fondoSugerido?: number;
}

export interface TurnoParaLaSesion {
  id: string;
  openedAt: string;
  cashOpening: string;
}

/**
 * Deja la sesión con un turno con el que operar, SIN pantalla.
 *
 * Tres caminos y los tres acaban en un `shiftId` que vale:
 *
 *   · el servidor ya tiene un turno abierto (recargar la pestaña a media
 *     mañana, o que el primer cobro ya lo abriera) → se espeja y se usa
 *     el id real;
 *   · no lo tiene → turno local con el `fondoSugerido`;
 *   · no hay red → turno local con el fondo del turno local anterior, o 0.
 *     Sin red el fondo es lo único que no se puede preguntar, y lo que NO
 *     se puede hacer es dejar a la podóloga sin cobrar por eso.
 */
export async function abrirTurnoDeClinicaEnLocal(): Promise<TurnoParaLaSesion> {
  let fondo = 0;
  try {
    const res = await apiWithCashier<RespuestaTurnoActual>("/shift/current");
    if (res.shift) {
      await mirrorServerShift(res.shift).catch(() => {});
      return {
        id: res.shift.id,
        openedAt: res.shift.openedAt,
        cashOpening: res.shift.cashOpening,
      };
    }
    if (typeof res.fondoSugerido === "number") fondo = res.fondoSugerido;
  } catch {
    // Sin red o sin sesión todavía: el fondo que se sepa en local. Nunca
    // se bloquea la entrada por esto.
    const previo = await getLocalShift().catch(() => null);
    if (previo) fondo = previo.cashOpening;
  }
  const local = await openLocalShift(fondo);
  return {
    id: local.localId,
    openedAt: local.openedAt,
    cashOpening: String(fondo),
  };
}

/**
 * EL PASO 3: el servidor ya abrió el turno; se adopta su id.
 *
 * Se llama después de cada cobro que sale de la cola. Es idempotente y
 * barata de no hacer nada: si el turno local ya está resuelto (o no hay
 * ninguno, o nació de un `POST /shift/open` normal), sale sin tocar la red.
 *
 * Y nunca lanza. Un fallo aquí no puede tumbar nada: el cobro ya está
 * hecho y registrado, y lo único que queda pendiente es que el cierre del
 * día sepa a qué turno pedirle el resumen — que se vuelve a intentar en el
 * cobro siguiente.
 */
export async function adoptarTurnoDelServidor(): Promise<string | null> {
  try {
    const local = await getLocalShift();
    if (!local || local.serverId !== null || local.closedAt !== null) {
      return local?.serverId ?? null;
    }
    const res = await apiWithCashier<RespuestaTurnoActual>("/shift/current");
    if (!res.shift) return null;
    // Las DOS, y en este orden. `resolverTurnoLocal` reescribe el
    // `shiftId` de lo que siga en la cola y avisa a quien se registró
    // (`App`, que además arregla el id del estado de React).
    // `resolveLocalShift` fija el `serverId` en IndexedDB **aquí mismo**,
    // sin depender de que alguien haya registrado el callback: si
    // dependiera, un remonte de `App` a destiempo dejaría el turno local
    // sin resolver y el cierre del día pidiendo un id que no existe. Las
    // dos son idempotentes, así que hacerlo dos veces no cuesta nada.
    await resolverTurnoLocal(local.localId, res.shift.id);
    await resolveLocalShift(local.localId, res.shift.id);
    return res.shift.id;
  } catch {
    return null;
  }
}
