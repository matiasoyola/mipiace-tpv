// clinica-11 · EN UNA CLÍNICA NO SE ABRE TURNO.
//
// Decisión de producto (Matías, 28-10): «la podóloga llega, atiende y
// cobra». No hay mostrador, no hay relevo y no hay cajón que contar al
// llegar, así que la pantalla de «Abrir turno» le pide un dato que no
// tiene para desbloquear una pantalla que no quería. La caja se abre sola
// **al primer cobro del día**, con el fondo que dejó el último cierre.
//
// ── POR QUÉ AL PRIMER COBRO Y NO AL ENTRAR ──────────────────────────
//
// Porque un turno abierto hay que cerrarlo. La norma de un cierre por día
// y por caja se mantiene (es la que hace que un descuadre se vea), así que
// abrir el turno al teclear el PIN significaría que un martes de sólo
// revisiones —atiende a cuatro pacientes, no cobra a ninguna porque van
// con bono— deja un turno abierto que hay que cerrar. Y al día siguiente
// ese turno es de ayer, así que el login cae en `forceClose` y le sale
// **otra** pantalla: habríamos cambiado una pantalla inútil por dos.
//
// Abriéndolo al primer cobro, un día sin cobros no tiene turno. No hay
// nada que cerrar porque no pasó nada por el cajón.
//
// ── POR QUÉ EN EL SERVIDOR Y NO EN EL TPV ───────────────────────────
//
// Porque es una invariante y no una pantalla. El TPV esconde la pantalla
// de abrir turno —eso es UI— pero lo que no puede pasar es que un cobro de
// una clínica se caiga con `409 SHIFT_NOT_OPEN`: cobrar siempre se puede.
// Un terminal con la APK vieja, un outbox que sube una venta de ayer, el
// cobro de una cita desde otra caja: todos esos caminos llegan al servidor
// y ninguno pasa por el TPV nuevo. La negativa vive donde vive el dinero.
//
// Los dos sitios que lo llaman son los dos caminos de cobro de una
// clínica, y no hay un tercero:
//
//   · `agenda/checkout.ts` — «Cobrar en caja» sobre una cita. Es EL cobro
//     de una consulta: abre el borrador con las líneas de la sesión.
//   · `POST /tickets` — la venta suelta («unas plantillas, un producto») y
//     el reintento del outbox con un turno que ya no existe.
//
// El cobro de una MESA (`tables/operativa.ts`) no lo llama a propósito: en
// una clínica no hay mesas, y si alguien enciende las dos cosas lo que
// quiere es el flujo de hostelería.

import { Prisma } from "@mipiacetpv/db";

import type { getPrisma } from "../context.js";
import { loadShiftBreakdownSums } from "./breakdown-sums.js";
import { computeZBreakdown } from "./z-breakdown.js";

/** El cliente completo. Lo necesita el fondo: sale de un `groupBy` sobre
 *  los pagos del último turno cerrado. */
export type ClienteCompleto = ReturnType<typeof getPrisma>;

/** Y lo mínimo para ESCRIBIR el turno. Tipado así —igual que
 *  `ShiftReaderClient` en `impute.ts`— para que valga el `tx` de una
 *  transacción interactiva: el cobro de un borrador resuelve su turno
 *  DENTRO de la suya, y abrirlo fuera abriría una ventana en la que se
 *  cierra entre una cosa y la otra. */
export type ClienteDeTurnos = Pick<ClienteCompleto, "shift">;

export interface TurnoAbierto {
  id: string;
  openedAt: Date;
  cashOpening: Prisma.Decimal;
  /** `true` si lo acabamos de abrir; `false` si ya estaba y lo adoptamos. */
  recienAbierto: boolean;
}

/**
 * EL FONDO QUE DEJÓ EL ÚLTIMO CIERRE.
 *
 * Y «el que dejó» no es `cash_counted`, o no siempre: desde v1.11 el
 * cierre por defecto es **sin contar** (`close-day`), así que en una
 * clínica `cash_counted` va a ser NULL casi todos los días. Leerlo a
 * secas y caer a 0 pondría el fondo a cero cada mañana con el dinero
 * dentro del cajón, y el descuadre del cierre siguiente sería exactamente
 * lo que quedó ayer. Un descuadre diario que no significa nada enseña a
 * no mirar los descuadres.
 *
 * Así que:
 *
 *   · si alguien CONTÓ el cajón al cerrar, el fondo es lo que contó;
 *   · si no lo contó, es el **teórico** del cierre (fondo de apertura +
 *     neto en efectivo del turno), que es lo que el propio resumen del
 *     día le enseñó al cerrar. Mismo cálculo y mismo módulo
 *     (`computeZBreakdown`), no una fórmula paralela;
 *   · y si no hay ningún cierre —el primer día de la clínica—, cero.
 *
 * Nunca negativo: un turno con más devoluciones en efectivo que ventas da
 * un teórico negativo, y un fondo de caja negativo no existe (la columna
 * admite el `Decimal`, pero `POST /shift/open` tiene `minimum: 0` y abrir
 * con -12,40 € sería escribir una cosa que nadie puede contar).
 */
export async function fondoDelUltimoCierre(
  prisma: ClienteCompleto,
  registerId: string,
): Promise<number> {
  const ultimo = await prisma.shift.findFirst({
    where: { registerId, closedAt: { not: null } },
    orderBy: { closedAt: "desc" },
    select: { id: true, cashOpening: true, cashCounted: true },
  });
  if (!ultimo) return 0;
  if (ultimo.cashCounted != null) {
    return Math.max(0, Number(ultimo.cashCounted.toString()));
  }
  const sums = await loadShiftBreakdownSums(prisma, ultimo.id);
  const desglose = computeZBreakdown({
    cashOpening: Number(ultimo.cashOpening.toString()),
    ...sums,
  });
  return Math.max(0, desglose.cashTheoretical);
}

/**
 * Abre el turno de una clínica, o adopta el que ya esté abierto.
 *
 * Idempotente por el `findFirst` de arriba: dos cobros seguidos en el
 * mismo segundo no abren dos turnos. Queda una ventana de carrera entre
 * el `findFirst` y el `create` —dos cobros EXACTAMENTE simultáneos desde
 * dos cajas sobre el mismo `register`— y se acepta declarada: es la MISMA
 * ventana que `POST /shift/open` tiene desde B3 (su «sanity-check» de
 * turno abierto también lee antes de escribir), y en una consulta hay un
 * terminal y una persona. Cerrarla costaría un índice único parcial sobre
 * `(register_id) WHERE closed_at IS NULL`, que rompería el único caso
 * legítimo de dos turnos abiertos a la vez que la casa ya tiene: el turno
 * colgado de ayer mientras se abre el de hoy (`forceClose`).
 *
 * `userId` es QUIEN COBRA, no quien configuró nada: el turno queda a
 * nombre de la persona cuya sesión de cajero está haciendo el cobro.
 *
 * `tx` es dónde se ESCRIBE. El fondo se lee siempre con el cliente
 * completo —sale de turnos ya cerrados, que la transacción en curso no
 * toca— y el turno se crea dentro de la transacción del llamante cuando
 * la hay.
 */
export async function abrirTurnoDeClinica(args: {
  prisma: ClienteCompleto;
  /** Dónde se escribe. Por defecto, el mismo cliente. */
  tx?: ClienteDeTurnos;
  registerId: string;
  userId: string;
  ahora?: Date;
  log?: { info: (obj: object, msg: string) => void };
}): Promise<TurnoAbierto> {
  const { prisma, registerId, userId } = args;
  const escribe: ClienteDeTurnos = args.tx ?? prisma;
  const ahora = args.ahora ?? new Date();

  const abierto = await escribe.shift.findFirst({
    where: { registerId, closedAt: null },
    orderBy: { openedAt: "desc" },
    select: { id: true, openedAt: true, cashOpening: true },
  });
  if (abierto) {
    return {
      id: abierto.id,
      openedAt: abierto.openedAt,
      cashOpening: abierto.cashOpening,
      recienAbierto: false,
    };
  }

  const fondo = await fondoDelUltimoCierre(prisma, registerId);
  const shift = await escribe.shift.create({
    data: {
      registerId,
      userId,
      cashOpening: new Prisma.Decimal(fondo),
      openedAt: ahora,
      lastActivityAt: ahora,
      // EL RASTRO. Sin esto, el Z de una clínica y el de un bar dicen lo
      // mismo y no es verdad: en uno alguien contó el cajón y en el otro
      // no lo contó nadie.
      openReason: "AUTO_CLINICA",
    },
    select: { id: true, openedAt: true, cashOpening: true },
  });
  args.log?.info(
    {
      event: "shift.auto_open_clinica",
      shiftId: shift.id,
      registerId,
      userId,
      cashOpening: fondo,
    },
    "clínica · turno abierto solo por el primer cobro del día",
  );
  return {
    id: shift.id,
    openedAt: shift.openedAt,
    cashOpening: shift.cashOpening,
    recienAbierto: true,
  };
}
