// kds-2-wifi · LO QUE EL SERVIDOR PONE EN EL CAMINO DIRECTO.
//
// El servidor NO participa en el camino directo: cuando la wifi del local
// es lo único que queda, él no está. Hace tres cosas, y las tres son
// «antes» o «después»:
//
//   1. **ANTES · reparte la clave de la tienda.** La emite la primera vez
//      que una pantalla de cocina la pide y la entrega a las pantallas
//      (`GET /kitchen/me`) y a los terminales (`GET /kitchen/estado`) de
//      ESA tienda. La borra el trigger `stores_rotate_lan_key` al revocar
//      cualquier aparato, y entonces vuelve a nacer otra.
//   2. **ANTES · dice dónde escucha cada pantalla.** La tablet anuncia IP
//      y puerto en su latido; el TPV los lee del estado.
//   3. **DESPUÉS · recoge lo que pasó sin él, sin duplicar.** Es este
//      fichero entero: `aplicarMarca` y `aplicarMarcasPendientes`.
//
// ── QUIÉN MANDA EN CADA ESTADO ────────────────────────────────────────
//
// La decisión 9 lo cierra: **cocina** manda en el tachado, «Lista» y
// «Visto»; **el TPV** en envíos, anulaciones, marchas, urgentes y
// «Servido». Y gana la marca de tiempo **del aparato que manda en ese
// estado**, nunca la del otro.
//
// Aquí abajo sólo se aplican marcas de cocina, así que la regla se
// convierte en una comparación entre marcas de cocina: una marca más
// nueva pisa a una más vieja, y una más vieja no pisa nada. Es lo que hace
// que el resultado sea el mismo subas las marcas en el orden que sea, que
// es lo que de verdad hace falta cuando vuelve la red y se sube un
// servicio entero de golpe.
//
// Lo que NUNCA pasa, y tiene su sabotaje: que el `doneAt` de un plato
// termine con la hora del TPV. El TPV no escribe `doneAt` por ningún
// camino —ni por la nube ni por la wifi— y la única ruta que lo toca es la
// de la pantalla.

import { Prisma, type PrismaClient } from "@mipiacetpv/db";
import { generarClaveTienda } from "@mipiacetpv/kitchen-lan";

import { getPrisma } from "../context.js";

type Tx = PrismaClient | Prisma.TransactionClient;

/**
 * La clave del camino directo de esta tienda, creándola si no hay.
 *
 * Perezosa a propósito: una tienda que nunca ha emparejado una pantalla de
 * cocina no tiene por qué tener una clave guardada. Y así la rotación es
 * un `UPDATE … SET NULL` (lo que hace el trigger) en vez de tener que
 * generar 32 bytes buenos de azar desde plpgsql.
 *
 * La carrera —dos pantallas pidiéndola a la vez— se resuelve con un
 * `updateMany` condicionado a que siga NULL: la segunda no escribe y
 * vuelve a leer la que puso la primera. Dos claves distintas en la misma
 * tienda serían dos cocinas que no se oyen.
 */
export async function asegurarClaveLan(storeId: string): Promise<string> {
  const prisma = getPrisma();
  const store = await prisma.store.findUniqueOrThrow({
    where: { id: storeId },
    select: { kitchenLanKey: true },
  });
  if (store.kitchenLanKey) return store.kitchenLanKey;

  const nueva = generarClaveTienda();
  const escrita = await prisma.store.updateMany({
    where: { id: storeId, kitchenLanKey: null },
    data: { kitchenLanKey: nueva, kitchenLanKeyAt: new Date() },
  });
  if (escrita.count === 1) return nueva;
  const otra = await prisma.store.findUniqueOrThrow({
    where: { id: storeId },
    select: { kitchenLanKey: true },
  });
  return otra.kitchenLanKey ?? nueva;
}

export type TipoMarca = "HECHO" | "VISTO" | "LISTA";

export interface MarcaDeCocina {
  /** UUID generado en la TABLET. La llave de idempotencia. */
  markId: string;
  kind: TipoMarca;
  clientSendId: string;
  section: "BARRA" | "COCINA" | "SALON";
  ticketLineId?: string | null;
  done?: boolean | null;
  /** La hora de la tablet. La que gana. */
  at: string;
}

export interface ResultadoSincronizacion {
  /** Marcas nuevas que se guardaron (las repetidas no cuentan). */
  guardadas: number;
  /** De ésas, las que ya se pudieron aplicar sobre su tarjeta. */
  aplicadas: number;
  /** Las que esperan a que su envío suba por la nube. */
  pendientes: number;
  /** Envíos que la tablet dice que ya tenía por la wifi. */
  reconocidas: number;
}

/**
 * Guarda el libro de marcas de una tablet y aplica lo que ya se pueda.
 *
 * Idempotente por `markId`: subir dos veces el mismo servicio no mueve
 * nada. Es la mitad del sabotaje «al volver internet, duplicar»; la otra
 * mitad es `clientSendId` en el envío, que ya era de kds-1.
 */
export async function sincronizarDesdeLaTablet(opts: {
  deviceId: string;
  storeId: string;
  sections: Array<"BARRA" | "COCINA" | "SALON">;
  marcas: MarcaDeCocina[];
  /** Envíos que la tablet recibió por la wifi: `clientSendId`. */
  recibidas: string[];
}): Promise<ResultadoSincronizacion> {
  const prisma = getPrisma();

  // ── 1 · «esto ya lo tenía por la wifi» ──────────────────────────────
  //
  // Se apunta en la tarjeta para que la pantalla no la pinte como nueva
  // cuando vuelva a leer el GET: el cocinero la lleva viendo veinte
  // minutos. Y es lo que impide que `lateArrival` se encienda: la comanda
  // no llegó tarde, llegó por el otro camino.
  let reconocidas = 0;
  if (opts.recibidas.length > 0) {
    const r = await prisma.kitchenOrder.updateMany({
      where: {
        storeId: opts.storeId,
        section: { in: opts.sections },
        lanReceivedAt: null,
        dispatch: { clientSendId: { in: opts.recibidas } },
      },
      data: { lanReceivedAt: new Date(), lateArrival: false },
    });
    reconocidas = r.count;
  }

  // ── 2 · el libro ────────────────────────────────────────────────────
  let guardadas = 0;
  const nuevas: string[] = [];
  for (const m of opts.marcas) {
    try {
      await prisma.kitchenLanMark.create({
        data: {
          markId: m.markId,
          deviceId: opts.deviceId,
          storeId: opts.storeId,
          kind: m.kind,
          clientSendId: m.clientSendId,
          section: m.section,
          ticketLineId: m.ticketLineId ?? null,
          done: m.done ?? null,
          at: new Date(m.at),
        },
      });
      guardadas += 1;
      nuevas.push(m.clientSendId);
    } catch (err) {
      // P2002 = esta marca ya estaba subida. No es un error: la tablet
      // reintenta hasta que el servidor le dice que sí, y puede repetir.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        continue;
      }
      throw err;
    }
  }

  // ── 3 · aplicar lo que tenga tarjeta ────────────────────────────────
  let aplicadas = 0;
  for (const clientSendId of new Set([...nuevas, ...opts.recibidas])) {
    aplicadas += await aplicarMarcasPendientes(clientSendId, prisma);
  }

  const pendientes = await prisma.kitchenLanMark.count({
    where: { storeId: opts.storeId, appliedAt: null },
  });

  return { guardadas, aplicadas, pendientes, reconocidas };
}

/**
 * Aplica las marcas que estaban esperando a este envío.
 *
 * Se llama desde dos sitios y los dos hacen falta:
 *
 *   · al subir el libro, para las marcas cuyo envío ya estaba arriba;
 *   · al entrar un envío (`envio.ts`), para las marcas que llegaron ANTES
 *     que él. Pasa de verdad: la tablet tiene cobertura antes que el
 *     terminal, o el camarero tarda en volver a la barra.
 *
 * Sin la segunda llamada, una marca que se adelanta a su envío se quedaría
 * en el libro para siempre y el informe del dueño diría que ese plato no
 * se tachó nunca.
 */
export async function aplicarMarcasPendientes(
  clientSendId: string,
  prisma: Tx,
): Promise<number> {
  const pendientes = await prisma.kitchenLanMark.findMany({
    where: { clientSendId, appliedAt: null },
    // Por `at` ascendente: las marcas se aplican en el orden en que
    // PASARON, no en el que llegaron. Es lo que hace que tachar y
    // destachar el mismo plato acabe destachado y no al revés.
    orderBy: { at: "asc" },
    select: {
      markId: true,
      deviceId: true,
      kind: true,
      section: true,
      ticketLineId: true,
      done: true,
      at: true,
    },
  });
  if (pendientes.length === 0) return 0;

  const orders = await prisma.kitchenOrder.findMany({
    where: { dispatch: { clientSendId } },
    select: { id: true, section: true, readyAt: true },
  });
  if (orders.length === 0) return 0;
  const porSeccion = new Map(orders.map((o) => [o.section, o]));

  let aplicadas = 0;
  for (const m of pendientes) {
    const order = porSeccion.get(m.section);
    if (!order) {
      // La tablet marcó sobre una sección que el servidor no creó: pasa si
      // el envío cambió de destino entre medias (a alguien le quitaron la
      // pantalla de barra). No se puede aplicar y no se puede reintentar
      // para siempre: se cierra la marca para que no se quede colgada, y
      // la fila queda en el libro con su hora para que el informe la vea.
      await prisma.kitchenLanMark.update({
        where: { markId: m.markId },
        data: { appliedAt: new Date() },
      });
      continue;
    }
    await aplicarMarca({ marca: m, orderId: order.id, prisma });
    await prisma.kitchenLanMark.update({
      where: { markId: m.markId },
      data: { appliedAt: new Date() },
    });
    aplicadas += 1;
  }
  return aplicadas;
}

/**
 * Una marca de cocina sobre su tarjeta, con la regla de quién manda.
 *
 * **La hora que se escribe es la de la TABLET** (`marca.at`), no la de
 * ahora: lo que el informe del dueño tiene que poder contar es cuánto
 * tardó la cocina, no cuánto tardó la red en volver.
 *
 * Y sólo pisa si es más nueva. El `where` lleva la condición, así que dos
 * marcas que se cruzan no dependen del orden en que se apliquen.
 */
async function aplicarMarca(opts: {
  marca: {
    deviceId: string;
    kind: string;
    ticketLineId: string | null;
    done: boolean | null;
    at: Date;
  };
  orderId: string;
  prisma: Tx;
}): Promise<void> {
  const { marca, orderId, prisma } = opts;

  if (marca.kind === "LISTA") {
    // Una tarjeta ya lista con una hora ANTERIOR no se mueve: la primera
    // vez que estuvo lista es la que cuenta para el tiempo de cocina.
    await prisma.kitchenOrder.updateMany({
      where: {
        id: orderId,
        OR: [{ readyAt: null }, { readyAt: { gt: marca.at } }],
      },
      data: { readyAt: marca.at, readyByDeviceId: marca.deviceId },
    });
    return;
  }

  if (marca.ticketLineId == null) return;

  if (marca.kind === "VISTO") {
    await prisma.kitchenOrderLine.updateMany({
      where: { orderId, ticketLineId: marca.ticketLineId },
      data: { voidSeenAt: marca.at, changeSeenAt: marca.at },
    });
    return;
  }

  // HECHO · tachar o destachar.
  //
  // No se puede expresar «sólo si mi marca es más nueva que el último
  // cambio» con un `where` sobre `doneAt`, porque un destachado deja
  // `doneAt` en NULL y se pierde la referencia. Así que la referencia es
  // el LIBRO: si hay una marca de ESTE plato aplicada con hora posterior,
  // la nuestra ya no manda.
  const masNueva = await prisma.kitchenLanMark.findFirst({
    where: {
      kind: "HECHO",
      ticketLineId: marca.ticketLineId,
      appliedAt: { not: null },
      at: { gt: marca.at },
    },
    select: { markId: true },
  });
  if (masNueva) return;

  await prisma.kitchenOrderLine.updateMany({
    where: { orderId, ticketLineId: marca.ticketLineId },
    data: marca.done
      ? { doneAt: marca.at, doneByDeviceId: marca.deviceId }
      : { doneAt: null, doneByDeviceId: null },
  });
}
