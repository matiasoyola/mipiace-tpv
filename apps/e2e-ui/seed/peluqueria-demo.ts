// El seed del banco de la agenda. IDEMPOTENTE y de usar y tirar.
//
// Qué deja: el sustrato de «Peluquería Demo» — tenant sin Holded y con la
// AGENDA APAGADA, su local, su caja, un dispositivo ya emparejado, la dueña,
// las tres profesionales como usuarias con PIN, los cinco servicios en el
// catálogo SIN datos de agenda, y las clientas del cuaderno.
//
// Qué NO deja, a propósito: duraciones, perfiles de profesional, colores,
// skills, turnos, horario del centro, festivos ni citas. Todo eso lo pone el
// banco por la interfaz — son los capítulos 1 a 4 del vídeo. Un seed que
// dejara la agenda configurada probaría la BD, no la pantalla.
//
// Idempotente por borrado: tira el tenant entero (ON DELETE CASCADE se lleva
// todo lo suyo) y lo vuelve a crear con los MISMOS ids. Dos pasadas seguidas
// del banco encuentran exactamente la misma base.
//
// Cómo se lanza:
//   pnpm --filter @mipiacetpv/e2e-ui run seed
// o, dentro del banco, automáticamente desde el globalSetup de Playwright.

import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import argon2 from "argon2";
import { PrismaClient } from "@mipiacetpv/db";

import { databaseUrl } from "./base-de-datos.js";
import {
  CLIENTAS,
  DEVICE_TOKEN,
  DUENA,
  ID,
  PASSWORD_DUENA,
  PIN,
  PROFESIONALES,
  SERVICIOS,
  TENANT_NOMBRE,
} from "./escenario.js";

/**
 * La red de seguridad. El banco siembra borrando un tenant entero: si
 * alguien lanza esto con el `DATABASE_URL` de desarrollo —o peor— se lleva
 * por delante datos que no son suyos. El nombre de la base tiene que decir
 * que es desechable, igual que en `apps/api/test-e2e/e2e-env.ts`.
 */
function exigirBaseDesechable(url: string): string {
  let nombre: string;
  try {
    nombre = decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
  } catch {
    throw new Error(`DATABASE_URL no es una URL válida: ${url}`);
  }
  if (!nombre) throw new Error("DATABASE_URL no incluye nombre de base.");
  if (!/(banco|e2e|test)/i.test(nombre)) {
    throw new Error(
      [
        `La base "${nombre}" no parece desechable y el seed BORRA el tenant «${TENANT_NOMBRE}» entero.`,
        'Usa una base cuyo nombre contenga "banco", "e2e" o "test".',
        "Para crearla:",
        '  docker exec -i mipiacetpv-postgres psql -U mipiacetpv -c "CREATE DATABASE mipiacetpv_agenda_banco_e2e;"',
      ].join("\n"),
    );
  }
  return nombre;
}

/** Mismo hash que `apps/api/src/devices/auth.ts`: sha256 del texto plano. */
function hashDeviceToken(plain: string): string {
  return createHash("sha256").update(plain, "utf8").digest("hex");
}

export async function sembrar(prisma: PrismaClient): Promise<void> {
  const pinHash = await argon2.hash(PIN, { type: argon2.argon2id });
  const passwordHash = await argon2.hash(PASSWORD_DUENA, {
    type: argon2.argon2id,
  });

  // Por id Y por nombre: si una pasada anterior se quedó a medias con otro
  // id (o alguien lo creó a mano desde el admin), también se va.
  await prisma.tenant.deleteMany({
    where: { OR: [{ id: ID.tenant }, { name: TENANT_NOMBRE }] },
  });

  await prisma.tenant.create({
    data: {
      id: ID.tenant,
      name: TENANT_NOMBRE,
      // El vertical de una peluquería: sin mapa de mesas, sin modificadores.
      businessType: "SERVICES",
      onboardingState: "ACTIVE",
      cajaEnabled: true,
      crmEnabled: true,
      // Los autónomos nuevos empiezan sin Holded (decisión del 27-09).
      holdedEnabled: false,
      // APAGADA. Encenderla es el capítulo 1.
      agendaEnabled: false,
      agendaSlotMinutes: 15,
      stores: {
        create: {
          id: ID.store,
          name: TENANT_NOMBRE,
          registers: { create: { id: ID.register, name: "Caja 1" } },
        },
      },
    },
  });

  // El dispositivo ya emparejado: el vídeo no enseña un emparejamiento, y
  // el código de emparejamiento es de un solo uso (no sería idempotente).
  await prisma.device.create({
    data: {
      id: ID.device,
      tenantId: ID.tenant,
      registerId: ID.register,
      name: "Mostrador",
      kind: "TERMINAL",
      deviceTokenHash: hashDeviceToken(DEVICE_TOKEN),
    },
  });

  await prisma.user.create({
    data: {
      id: DUENA.id,
      tenantId: ID.tenant,
      email: DUENA.email,
      alias: DUENA.alias,
      role: "OWNER",
      passwordHash,
      pinHash,
    },
  });

  for (const p of PROFESIONALES) {
    await prisma.user.create({
      data: {
        id: p.id,
        tenantId: ID.tenant,
        email: p.email,
        alias: p.alias,
        role: "CASHIER",
        pinHash,
      },
    });
  }

  // Catálogo LOCAL: sin `holdedProductId`, porque este centro no tiene
  // Holded. Sin `serviceScheduling`: el capítulo 2 teclea las duraciones.
  for (const s of SERVICIOS) {
    await prisma.product.create({
      data: {
        tenantId: ID.tenant,
        name: s.nombre,
        sku: s.sku,
        source: "LOCAL",
        kind: "SERVICE",
        basePrice: s.basePrice,
        taxRate: "21",
        active: true,
        sellableViaTpv: true,
      },
    });
  }

  for (const c of CLIENTAS) {
    await prisma.client.create({
      data: {
        tenantId: ID.tenant,
        firstName: c.firstName,
        lastName: c.lastName,
        phone: c.phone,
      },
    });
  }
}

async function main(): Promise<void> {
  const url = databaseUrl();
  const nombre = exigirBaseDesechable(url);
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  try {
    await sembrar(prisma);
    const servicios = await prisma.product.count({
      where: { tenantId: ID.tenant, kind: "SERVICE" },
    });
    const clientas = await prisma.client.count({
      where: { tenantId: ID.tenant },
    });
    console.log(
      [
        `Sembrado «${TENANT_NOMBRE}» en ${nombre}:`,
        `  agenda APAGADA · Holded apagado · CRM encendido`,
        `  1 local · 1 caja · 1 dispositivo emparejado`,
        `  ${1 + PROFESIONALES.length} usuarias (dueña + ${PROFESIONALES.length} profesionales)`,
        `  ${servicios} servicios sin datos de agenda`,
        `  ${clientas} clientas`,
      ].join("\n"),
    );
  } finally {
    await prisma.$disconnect();
  }
}

// Sólo al ejecutarlo como script: el `globalSetup` de Playwright importa
// `sembrar` y pone él la conexión, sin pasar por aquí.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
