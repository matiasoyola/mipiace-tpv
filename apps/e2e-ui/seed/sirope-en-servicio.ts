// n1-hosteleria-2 · SIROPE EN PLENO SERVICIO.
//
// La regla de este bloque, literal: «nada se mide con la sala vacía». La
// pasada del 23-10 se hizo con la sala limpia —sin avisos de cocina, sin
// urgentes, sin mesas por recoger— y ahí los ocho hallazgos de Matías no
// se ven, porque todos son hallazgos de REPARTO: aparecen cuando varias
// cosas piden sitio a la vez.
//
// Así que el banco se siembra con un servicio encima de `sirope-demo`:
//
//   · mesas en todos los estados que el producto puede dar;
//   · DOS avisos de «listo para servir» esperando, en mesas distintas;
//   · una comanda abierta de SEIS líneas, que es la medida del
//     hallazgo 1;
//   · un «Urgente · alergia» que llega mientras esa comanda está
//     abierta, que es el hallazgo 4.
//
// ── UNA COSA QUE NO SE PUEDE SEMBRAR ──────────────────────────────────
//
// El bloque pide mesas «en todos los estados (libre, ocupada, cuenta,
// por recoger, olvidada)». **«Cuenta» (BILLING) no se puede sembrar
// porque el producto no lo produce.** `buildTableSnapshot` en
// `apps/api/src/tables/routes.ts` es el ÚNICO sitio que calcula el
// estado de una mesa, y sólo devuelve tres:
//
//   state: draft ? "OPEN" : sigueSinRecoger(...) ? "POR_RECOGER" : "FREE"
//
// `"BILLING"` está en el tipo, en el TPV y en la leyenda del mapa, pero
// nada lo emite —ni la API ni el TPV lo derivan— y se comprobó con un
// grep sobre los dos lados. Está apuntado en el `-done` como hallazgo
// FUERA de los ocho: arrastra el botón «Cobrar X €» de la tarjeta, que
// es la derivada principal de `principio-cobro-en-mesa`.
//
// No se toca aquí: es un cambio de la API y este bloque es de maquetación
// en la mano.

import { PrismaClient } from "@mipiacetpv/db";

import { databaseUrl } from "./base-de-datos.js";
import { esBaseDesechable, nombreDeLaBase } from "./peluqueria-demo.js";

const ID = {
  tenant: "51b0bea0-0000-4000-8000-000000000001",
  store: "51b0bea0-0000-4000-8000-000000000002",
  register: "51b0bea0-0000-4000-8000-000000000003",
  cajero: "51b0bea0-0000-4000-8000-000000000005",
  shift: "51b0bea0-0000-4000-8000-0000000000a1",
} as const;

/**
 * Un uuid estable a partir de un número, para que la siembra repita.
 *
 * El último grupo tiene que medir EXACTAMENTE 12 hexadecimales: Postgres
 * no perdona ni uno de menos («invalid group length in group 4: expected
 * 12, found 9»), y el error sale al crear la fila, no al construir la
 * cadena. De ahí el `padStart(11)` con el prefijo delante.
 */
function uuid(prefijo: string, n: number): string {
  const cola = `${prefijo}${n.toString(16).padStart(11, "0")}`;
  return `51b0bea0-0000-4000-8000-${cola}`;
}

const MINUTO = 60_000;

/**
 * Las seis líneas de la comanda del hallazgo 1.
 *
 * Dos cafés que se distinguen sólo por el final del nombre, como en la
 * pasada del 23-10: es lo que obliga a que el nombre se lea entero y no
 * truncado a «Café…».
 */
const SEIS_LINEAS = [
  { nombre: "Café Solo", precio: 1.3 },
  { nombre: "Café con leche", precio: 1.5 },
  { nombre: "Café Americano", precio: 1.6 },
  { nombre: "Tostada con tomate", precio: 2.4 },
  { nombre: "Croissant a la plancha", precio: 2.1 },
  { nombre: "Zumo de naranja natural", precio: 2.6 },
] as const;

export async function sembrarServicio(prisma: PrismaClient): Promise<void> {
  const ahora = new Date();
  const mesas = await prisma.table.findMany({
    where: { storeId: ID.store, deletedAt: null },
    orderBy: [{ zone: "asc" }, { name: "asc" }],
    select: { id: true, name: true, zone: true },
  });
  if (mesas.length === 0) {
    throw new Error(
      "No hay mesas: siembra primero `sirope-demo.ts`.",
    );
  }
  const porNombre = new Map(mesas.map((m) => [m.name, m] as const));
  const mesa = (n: string) => {
    const m = porNombre.get(n);
    if (!m) {
      throw new Error(
        `No existe la mesa «${n}». Hay: ${mesas.map((x) => x.name).join(", ")}`,
      );
    }
    return m;
  };

  // ── el turno, que es de quien cuelgan los tickets ──────────────────
  await prisma.shift.upsert({
    where: { id: ID.shift },
    update: { closedAt: null },
    create: {
      id: ID.shift,
      registerId: ID.register,
      userId: ID.cajero,
      cashOpening: "100.0000",
      openedAt: new Date(ahora.getTime() - 180 * MINUTO),
    },
  });

  // Limpiamos un servicio anterior para que la siembra sea idempotente.
  await prisma.kitchenOrderLine.deleteMany({
    where: { order: { storeId: ID.store } },
  });
  await prisma.kitchenOrder.deleteMany({ where: { storeId: ID.store } });
  await prisma.kitchenDispatch.deleteMany({ where: { tenantId: ID.tenant } });
  await prisma.ticketLine.deleteMany({
    where: { ticket: { tenantId: ID.tenant } },
  });
  await prisma.ticket.deleteMany({ where: { tenantId: ID.tenant } });
  await prisma.table.updateMany({
    where: { storeId: ID.store },
    data: { porRecogerDesde: null },
  });

  let n = 0;
  /** Un DRAFT en una mesa, abierto hace `haceMin` minutos. */
  async function abrirMesa(
    nombreMesa: string,
    lineas: ReadonlyArray<{ nombre: string; precio: number }>,
    haceMin: number,
  ): Promise<{ ticketId: string; tableId: string }> {
    const t = mesa(nombreMesa);
    n += 1;
    const id = uuid("1", n);
    const abiertaA = new Date(ahora.getTime() - haceMin * MINUTO);
    const total = lineas.reduce((s, l) => s + l.precio, 0);
    await prisma.ticket.create({
      data: {
        id,
        tenantId: ID.tenant,
        registerId: ID.register,
        shiftId: ID.shift,
        userId: ID.cajero,
        tableId: t.id,
        internalNumber: `D-${n}`,
        externalId: uuid("2", n),
        publicSlug: `banco-servicio-${n}`,
        status: "DRAFT",
        diners: 2,
        total: total.toFixed(4),
        totalTax: (total * 0.1 / 1.1).toFixed(4),
        totalDiscount: "0.0000",
        createdAt: abiertaA,
      },
    });
    let orden = 0;
    for (const l of lineas) {
      orden += 1;
      await prisma.ticketLine.create({
        data: {
          id: uuid("3", n * 100 + orden),
          ticketId: id,
          sku: `BANCO-${orden}`,
          nameSnapshot: l.nombre,
          units: "1.000",
          // `unitPrice` es el NETO y `priceGross` el PVP: con el 10 % de
          // hostelería, el neto es el bruto entre 1,1.
          unitPrice: (l.precio / 1.1).toFixed(4),
          taxRate: "10.00",
          discountPct: "0.00",
          subtotal: (l.precio / 1.1).toFixed(4),
          total: l.precio.toFixed(4),
        },
      });
    }
    return { ticketId: id, tableId: t.id };
  }

  // ── OCUPADA · la comanda de SEIS líneas del hallazgo 1 ─────────────
  const t2 = await abrirMesa("T2", SEIS_LINEAS, 12);

  // ── OCUPADAS normales ──────────────────────────────────────────────
  await abrirMesa("T6", [SEIS_LINEAS[0], SEIS_LINEAS[3]], 8);
  const m5 = await abrirMesa("M5", [SEIS_LINEAS[1]], 20);
  await abrirMesa("B3", [SEIS_LINEAS[2], SEIS_LINEAS[5]], 5);

  // ── OLVIDADA · más de 45 min sin atender (el aro discontinuo) ──────
  await abrirMesa("M2", [SEIS_LINEAS[4]], 58);

  // ── POR RECOGER · pagadas y con el servicio encima ─────────────────
  for (const [nombre, hace] of [
    ["M3", 12],
    ["T1", 3],
  ] as const) {
    await prisma.table.update({
      where: { id: mesa(nombre).id },
      data: { porRecogerDesde: new Date(ahora.getTime() - hace * MINUTO) },
    });
  }

  // ── COCINA · dos comandas LISTAS esperando, en mesas distintas ─────
  //
  // `readyAt` puesto y `servedAt` nulo es lo que `GET /kitchen/listas`
  // devuelve, y de ahí salen la banda del TPV y la etiqueta LISTO de la
  // mesa. Dos, y en mesas distintas, porque el hallazgo 3 es justamente
  // que DOS se apilan: con una sola no se ve.
  let numero = 0;
  async function comandaLista(
    ticket: { ticketId: string; tableId: string },
    nombreMesa: string,
    lineas: ReadonlyArray<{ nombre: string; precio: number }>,
    opts: { lista: boolean; urgente?: boolean; alergenos?: string[] },
  ): Promise<void> {
    numero += 1;
    const dispatchId = uuid("4", numero);
    await prisma.kitchenDispatch.create({
      data: {
        id: dispatchId,
        tenantId: ID.tenant,
        ticketId: ticket.ticketId,
        clientSendId: uuid("5", numero),
        revision: 1,
        urgent: opts.urgente === true,
        sentByUserId: ID.cajero,
        // El parte de lo que pasó al enviar. Para el banco basta con que
        // diga que la pantalla lo recibió: lo que se mide aquí es la
        // maquetación del TPV, no el camino del envío.
        result: { screens: ["COCINA"], printed: [], failed: [] },
      },
    });
    const orderId = uuid("6", numero);
    await prisma.kitchenOrder.create({
      data: {
        id: orderId,
        dispatchId,
        ticketId: ticket.ticketId,
        storeId: ID.store,
        tableId: ticket.tableId,
        tableName: nombreMesa,
        section: "COCINA",
        number: numero,
        urgent: opts.urgente === true,
        urgentAt: opts.urgente === true ? ahora : null,
        sentAt: new Date(ahora.getTime() - 9 * MINUTO),
        readyAt: opts.lista ? new Date(ahora.getTime() - 2 * MINUTO) : null,
        lanReceivedAt: new Date(ahora.getTime() - 9 * MINUTO),
      },
    });
    let orden = 0;
    for (const l of lineas) {
      orden += 1;
      await prisma.kitchenOrderLine.create({
        data: {
          id: uuid("7", numero * 100 + orden),
          orderId,
          nameSnapshot: l.nombre,
          units: "1.000",
          course: 1,
          allergens: (opts.alergenos ?? []) as never,
        },
      });
    }
  }

  await comandaLista(
    await abrirMesa("T4", [SEIS_LINEAS[3]], 15),
    "T4",
    [SEIS_LINEAS[3]],
    { lista: true },
  );
  await comandaLista(m5, "M5", [SEIS_LINEAS[1]], { lista: true });

  // ── EL URGENTE CON ALERGIA, sobre la mesa de la comanda abierta ────
  //
  // Hallazgo 4: entra mientras la comanda de seis líneas está abierta.
  // Va a la MISMA mesa a propósito — es el caso que Matías describió.
  await comandaLista(t2, "T2", [SEIS_LINEAS[4]], {
    lista: false,
    urgente: true,
    alergenos: ["GLUTEN"],
  });

  const listas = await prisma.kitchenOrder.count({
    where: { storeId: ID.store, readyAt: { not: null }, servedAt: null },
  });
  const drafts = await prisma.ticket.count({
    where: { tenantId: ID.tenant, status: "DRAFT" },
  });
  const recoger = await prisma.table.count({
    where: { storeId: ID.store, porRecogerDesde: { not: null } },
  });
  console.log("Sirope EN SERVICIO:");
  console.log(`  ${drafts} mesas ocupadas (una de ellas con 6 líneas: T2)`);
  console.log("  1 olvidada (M2, abierta hace 58 min → aro discontinuo)");
  console.log(`  ${recoger} por recoger (M3, T1)`);
  console.log(`  ${listas} avisos de «listo para servir» (T4, M5)`);
  console.log("  1 «Urgente · alergia» en T2, la de la comanda abierta");
  console.log("  0 en estado «cuenta»: BILLING no lo produce el producto");
}

async function main(): Promise<void> {
  const url = databaseUrl();
  const nombre = nombreDeLaBase(url);
  if (!esBaseDesechable(nombre)) {
    throw new Error(
      `La base "${nombre}" no es desechable: el nombre tiene que TERMINAR en "_e2e".`,
    );
  }
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  try {
    await sembrarServicio(prisma);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
