// n1-hosteleria · la sala y la carta de Cafetería Sirope, para el banco.
//
// POR QUÉ EXISTE. El bloque pide medir en navegador «sembrado COMO
// SIROPE: 23 mesas en Barra/Salón/Terraza y 13 familias con los nombres
// reales». El banco sólo sabía sembrar «Peluquería Demo» (SERVICES, sin
// mapa de mesas) y «Clínica Demo», así que a 360 px no había nada de
// hostelería que fotografiar.
//
// DE DÓNDE SALEN LOS NÚMEROS. De producción, con dos SELECT de sólo
// lectura (transacción READ ONLY) el 18-10-2026:
//
//   · mesas por zona del tenant «Cafetería Sirope»:
//       BARRA 8 · SALÓN 7 · TERRAZA 8 = 23, ninguna agrupada
//   · tags de sus productos, que es lo que el TPV pinta como familias:
//       bolleria 25 · desayunos 21 · singluten 20 · tostadas 20
//       bebidas 17 · carta 13 · cafe 12 · licores 8 · infusiones 6
//       croissantysandwich 5 · helados 4 · suplemento 4 · vinos 4
//
// Y NO hay `tag_aliases` para Sirope (0 filas), así que el rótulo de
// cada familia sale de capitalizar el slug: «Croissantysandwich»,
// «Suplemento», «Desayunos». Es exactamente lo que midió la pasada, y la
// razón de que esos tres nombres se cortaran.
//
// Los nombres de producto son inventados —la carta real no hace falta
// para medir maquetación— pero los CONTEOS por familia son los de
// producción, porque de ellos depende cuántos resultados da una búsqueda
// y cuántas filas pide una familia. «tostadas» con 20 es lo que hace que
// «tost» dé del orden de los 25 resultados que midió la pasada.

import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

import argon2 from "argon2";
import { PrismaClient } from "@mipiacetpv/db";

import { databaseUrl } from "./base-de-datos.js";
import { esBaseDesechable, nombreDeLaBase } from "./peluqueria-demo.js";

const TENANT_NOMBRE = "Cafetería Sirope";

// UUID fijos para que la siembra sea idempotente y los `data-*` del
// bucle visual no cambien entre pasadas. Hexadecimales: Postgres rechaza
// cualquier otra letra («invalid character … found `r`»).
const ID = {
  tenant: "51b0bea0-0000-4000-8000-000000000001",
  store: "51b0bea0-0000-4000-8000-000000000002",
  register: "51b0bea0-0000-4000-8000-000000000003",
  device: "51b0bea0-0000-4000-8000-000000000004",
  cajero: "51b0bea0-0000-4000-8000-000000000005",
} as const;

/** El cajero del recorrido, como en la pasada del 18-10. */
export const CAJERO = {
  email: "soporte+sirope@banco.local",
  alias: "Soporte",
  pin: "1234",
} as const;

export const DEVICE_TOKEN = "banco-sirope-dispositivo-0001";

/**
 * Las 13 familias, con el conteo de producción. El orden es el de
 * `products` por tag descendente, que es el que da la consulta; el TPV
 * las ordena a su manera.
 */
export const FAMILIAS: ReadonlyArray<{ tag: string; productos: number }> = [
  { tag: "bolleria", productos: 25 },
  { tag: "desayunos", productos: 21 },
  { tag: "singluten", productos: 20 },
  { tag: "tostadas", productos: 20 },
  { tag: "bebidas", productos: 17 },
  { tag: "carta", productos: 13 },
  { tag: "cafe", productos: 12 },
  { tag: "licores", productos: 8 },
  { tag: "infusiones", productos: 6 },
  { tag: "croissantysandwich", productos: 5 },
  { tag: "helados", productos: 4 },
  { tag: "suplemento", productos: 4 },
  { tag: "vinos", productos: 4 },
];

/**
 * Las 23 mesas. Los nombres siguen la convención del TPV: B1… en la
 * barra (con `barSeatIndex`, que es lo que ordena los taburetes), M1… en
 * el salón y T1… en la terraza.
 */
export const MESAS: ReadonlyArray<{
  name: string;
  zone: "BARRA" | "SALON" | "TERRAZA";
  capacity: number;
  barSeatIndex?: number;
}> = [
  ...Array.from({ length: 8 }, (_, i) => ({
    name: `B${i + 1}`,
    zone: "BARRA" as const,
    capacity: 1,
    barSeatIndex: i + 1,
  })),
  ...Array.from({ length: 7 }, (_, i) => ({
    name: `M${i + 1}`,
    zone: "SALON" as const,
    capacity: 4,
  })),
  ...Array.from({ length: 8 }, (_, i) => ({
    name: `T${i + 1}`,
    zone: "TERRAZA" as const,
    capacity: 2,
  })),
];

/**
 * Dos cafés que se distinguen por una palabra, que es el caso del
 * hallazgo 3: «Café Americano» y «Café Solo» en la misma comanda.
 */
const NOMBRES_POR_FAMILIA: Record<string, string[]> = {
  cafe: [
    "Café Americano",
    "Café Solo",
    "Café con leche",
    "Cortado",
    "Café bombón",
    "Carajillo",
  ],
  tostadas: [
    "Tostada con tomate",
    "Tostada de aguacate",
    "Tostada con mantequilla y mermelada",
    "Tostada integral",
  ],
  croissantysandwich: [
    "Croissant a la plancha",
    "Sándwich mixto",
    "Sándwich vegetal",
  ],
  suplemento: ["Suplemento de jamón", "Suplemento de queso"],
};

/** Mismo hash que `apps/api/src/devices/auth.ts`: sha256 del texto plano. */
function hashDeviceToken(plain: string): string {
  return createHash("sha256").update(plain).digest("hex");
}

/** El rótulo de un producto `n` de la familia `tag`. */
function nombreDeProducto(tag: string, n: number): string {
  const reales = NOMBRES_POR_FAMILIA[tag];
  if (reales && n <= reales.length) return reales[n - 1]!;
  const familia = tag.charAt(0).toUpperCase() + tag.slice(1);
  return `${familia} ${n}`;
}

async function vaciar(prisma: PrismaClient): Promise<void> {
  // Igual que `peluqueria-demo`: TRUNCATE de todo menos migraciones. La
  // base es del banco y de nadie más, así que ninguna FK futura puede
  // romper esto (ver la nota larga de allí).
  const tablas = await prisma.$queryRaw<Array<{ nombre: string }>>`
    SELECT tablename AS nombre
      FROM pg_tables
     WHERE schemaname = 'public'
       AND tablename <> '_prisma_migrations'
  `;
  if (tablas.length === 0) return;
  const lista = tablas.map((t) => `public."${t.nombre}"`).join(", ");
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE ${lista} RESTART IDENTITY CASCADE`,
  );
}

export async function sembrarSirope(prisma: PrismaClient): Promise<void> {
  const pinHash = await argon2.hash(CAJERO.pin, { type: argon2.argon2id });

  await vaciar(prisma);

  await prisma.tenant.create({
    data: {
      id: ID.tenant,
      name: TENANT_NOMBRE,
      businessType: "HOSPITALITY",
      onboardingState: "ACTIVE",
      cajaEnabled: true,
      crmEnabled: false,
      // Sin Holded: el banco no habla con nadie de fuera.
      holdedEnabled: false,
      agendaEnabled: false,
      // Encendida: la comanda del recorrido va a una pantalla de cocina,
      // que es lo que hace que la línea enviada lleve `−`/`+` y chips.
      kitchenDisplayEnabled: true,
      stores: {
        create: {
          id: ID.store,
          name: "Tienda principal",
          registers: { create: { id: ID.register, name: "Caja 1" } },
        },
      },
    },
  });

  await prisma.device.create({
    data: {
      id: ID.device,
      tenantId: ID.tenant,
      registerId: ID.register,
      name: "N1",
      kind: "TERMINAL",
      deviceTokenHash: hashDeviceToken(DEVICE_TOKEN),
    },
  });

  await prisma.user.create({
    data: {
      id: ID.cajero,
      tenantId: ID.tenant,
      email: CAJERO.email,
      alias: CAJERO.alias,
      role: "OWNER",
      pinHash,
    },
  });

  for (const m of MESAS) {
    await prisma.table.create({
      data: {
        storeId: ID.store,
        name: m.name,
        zone: m.zone,
        capacity: m.capacity,
        barSeatIndex: m.barSeatIndex ?? null,
      },
    });
  }

  let sku = 0;
  for (const f of FAMILIAS) {
    for (let n = 1; n <= f.productos; n += 1) {
      sku += 1;
      await prisma.product.create({
        data: {
          tenantId: ID.tenant,
          name: nombreDeProducto(f.tag, n),
          sku: `SIR-${String(sku).padStart(4, "0")}`,
          source: "LOCAL",
          kind: "PRODUCT",
          // Precios de bar, con céntimos, para que el importe de la
          // comanda y de la mesa no salga redondo.
          basePrice: (1.2 + (n % 7) * 0.45).toFixed(2),
          taxRate: "10",
          active: true,
          sellableViaTpv: true,
          tags: [f.tag],
        },
      });
    }
  }
}

async function main(): Promise<void> {
  const url = databaseUrl();
  const nombre = nombreDeLaBase(url);
  if (!esBaseDesechable(nombre)) {
    throw new Error(
      `«${nombre}» no acaba en _e2e: esto hace TRUNCATE de todo. Aborto.`,
    );
  }
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  try {
    await sembrarSirope(prisma);
    const mesas = await prisma.table.count({ where: { storeId: ID.store } });
    const productos = await prisma.product.count({
      where: { tenantId: ID.tenant },
    });
    const porZona = await prisma.table.groupBy({
      by: ["zone"],
      where: { storeId: ID.store },
      _count: { _all: true },
    });
    console.log(
      [
        `Sembrado «${TENANT_NOMBRE}» en ${nombre}:`,
        `  HOSPITALITY · cocina encendida · Holded apagado`,
        `  ${mesas} mesas (${porZona
          .map((z) => `${z.zone} ${z._count._all}`)
          .join(" · ")})`,
        `  ${productos} productos en ${FAMILIAS.length} familias`,
        `  cajero ${CAJERO.email} · PIN ${CAJERO.pin}`,
        `  device token ${DEVICE_TOKEN}`,
      ].join("\n"),
    );
  } finally {
    await prisma.$disconnect();
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
