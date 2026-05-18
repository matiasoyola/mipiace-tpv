// B-OnboardingV2 · Cajero técnico interno + modo prueba del TPV.
//
// El equipo mipiacetpv usa este cajero para validar el flujo TPV de un
// tenant en estado DRAFT antes de activar al propietario. La
// implementación:
//
//   - `provisionTestCashier(tenantId)` se llama desde el worker
//     `initial-sync` cuando el sync inicial termina OK. Auto-crea, de
//     forma idempotente:
//       · Store "Tienda principal" (si el tenant no tenía ninguna).
//       · Register "Caja 1" en esa Store (si no había).
//       · Device interno emparejado al register (deviceToken aleatorio,
//         persistido como hash igual que el resto de devices).
//       · User cashier técnico (role MANAGER, isTestCashier=true), con
//         email interno y PIN aleatorio que nadie va a teclear.
//
//   - `issueTestCashierSession(tenantId, signals)` se llama desde el
//     endpoint POST /super-admin/tenants/:id/test-cashier-token. Asegura
//     que existe un Shift abierto para el cashier técnico (lo abre con
//     cashOpening=0 si no había), y devuelve:
//       · cashierSessionToken (JWT cashier, purpose=test-cashier, TTL 24h)
//       · deviceToken (en claro — el TPV lo guarda en sessionStorage)
//       · datos auxiliares (storeName, registerName, expiresAt).
//
//   - `purgeTestData(tenantId)` se llama desde
//     POST /super-admin/tenants/:id/activate. Borra los tickets en estado
//     TEST y sus email jobs, soft-deletea el cashier técnico y revoca su
//     device. La Store y el Register quedan — son el punto de partida
//     productivo del cliente.

import { randomInt } from "node:crypto";

import { Prisma, type PrismaClient, TicketStatus } from "@mipiacetpv/db";

import { hashPassword } from "../auth/passwords.js";
import { generateDeviceToken } from "../devices/auth.js";
import { signCashierSession } from "../shift/cashier-session.js";

const TEST_CASHIER_TTL_HOURS = 24;
const TEST_CASHIER_PIN_DIGITS = 6;

export interface TestCashierResources {
  tenantId: string;
  storeId: string;
  storeName: string;
  registerId: string;
  registerName: string;
  deviceId: string;
  deviceTokenPlain: string;
  cashierUserId: string;
  cashierEmail: string;
}

function testCashierEmail(tenantId: string): string {
  return `mipiacetpv-test-${tenantId.slice(0, 8)}@internal.mipiacetpv.tech`;
}

function newPin(): string {
  return randomInt(0, 10 ** TEST_CASHIER_PIN_DIGITS)
    .toString()
    .padStart(TEST_CASHIER_PIN_DIGITS, "0");
}

// Idempotente. Si se llama dos veces (re-sync, fallo intermedio) reusa
// las entidades existentes. NO crea Store/Register si el tenant ya
// tiene operación real montada — el cajero técnico se "engancha" a la
// primera Store/Register existente y el equipo puede probar contra ese
// entorno (raro pero defensivo).
export async function provisionTestCashier(
  prisma: PrismaClient,
  tenantId: string,
): Promise<TestCashierResources> {
  // 1. Store · usa la primera no eliminada, si no hay crea "Tienda
  //    principal" con ticketDelivery default razonable.
  let store = await prisma.store.findFirst({
    where: { tenantId, deletedAt: null },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true },
  });
  if (!store) {
    const created = await prisma.store.create({
      data: {
        tenantId,
        name: "Tienda principal",
        ticketDelivery: {
          emailAutoIfCustomerHasEmail: true,
          showQrButton: true,
          showDownloadButton: true,
          showViewButton: true,
          emailSubject: "Tu ticket de {tienda} · {numero}",
          emailBody:
            "Hola,\n\nAdjuntamos tu ticket en PDF. ¡Gracias por tu visita!\n\n— {tienda}",
          qrCaption: "Escanea para descargar tu ticket",
        } as Prisma.InputJsonValue,
      },
      select: { id: true, name: true },
    });
    store = created;
  }

  // 2. Register · misma lógica.
  let register = await prisma.register.findFirst({
    where: { storeId: store.id, deletedAt: null },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true },
  });
  if (!register) {
    const created = await prisma.register.create({
      data: { storeId: store.id, name: "Caja 1" },
      select: { id: true, name: true },
    });
    register = created;
  }

  // 3. Cashier técnico · upsert por email. El email es determinista por
  //    tenant (slice del UUID) — esto hace al upsert idempotente.
  const email = testCashierEmail(tenantId);
  const existing = await prisma.user.findUnique({
    where: { email },
    select: { id: true, tenantId: true, isTestCashier: true, deletedAt: true },
  });
  let cashierId: string;
  if (existing && existing.tenantId === tenantId) {
    // Resucita si estaba soft-deleted desde una activación previa.
    if (existing.deletedAt) {
      await prisma.user.update({
        where: { id: existing.id },
        data: { deletedAt: null, pinHash: await hashPassword(newPin()) },
      });
    }
    cashierId = existing.id;
  } else if (existing) {
    // Email colisiona con otro tenant — improbable porque incluye
    // tenantId.slice(0,8) pero defensivo: lanzamos error para que el
    // super-admin investigue.
    throw new Error(
      `provisionTestCashier: email del cashier técnico colisiona con tenant distinto (${existing.tenantId})`,
    );
  } else {
    const created = await prisma.user.create({
      data: {
        tenantId,
        email,
        pinHash: await hashPassword(newPin()),
        role: "MANAGER",
        isTestCashier: true,
      },
      select: { id: true },
    });
    cashierId = created.id;
  }

  // 4. Device técnico · uno por (tenant, register) reusando si ya
  //    existe (matched por name canónico).
  const deviceName = "mipiacetpv · modo prueba";
  let device = await prisma.device.findFirst({
    where: { tenantId, registerId: register.id, name: deviceName },
    select: { id: true, deviceTokenHash: true, revokedAt: true },
  });
  let deviceTokenPlain: string;
  if (device && device.revokedAt == null) {
    // No podemos recuperar el token plano del hash. Rotamos el token
    // para devolverle al super-admin uno nuevo cada vez que se llame
    // (caso reaprovisión).
    const { plain, hash } = generateDeviceToken();
    await prisma.device.update({
      where: { id: device.id },
      data: { deviceTokenHash: hash, pairedAt: new Date() },
    });
    deviceTokenPlain = plain;
  } else if (device) {
    // Estaba revocado — lo reactivamos con un token nuevo.
    const { plain, hash } = generateDeviceToken();
    await prisma.device.update({
      where: { id: device.id },
      data: { deviceTokenHash: hash, revokedAt: null, pairedAt: new Date() },
    });
    deviceTokenPlain = plain;
  } else {
    const { plain, hash } = generateDeviceToken();
    const created = await prisma.device.create({
      data: {
        tenantId,
        registerId: register.id,
        name: deviceName,
        deviceTokenHash: hash,
        userAgent: "internal/mipiacetpv-test",
      },
      select: { id: true, deviceTokenHash: true, revokedAt: true },
    });
    device = created;
    deviceTokenPlain = plain;
  }

  return {
    tenantId,
    storeId: store.id,
    storeName: store.name,
    registerId: register.id,
    registerName: register.name,
    deviceId: device.id,
    deviceTokenPlain,
    cashierUserId: cashierId,
    cashierEmail: email,
  };
}

export interface IssueTestSessionResult {
  cashierSessionToken: string;
  deviceToken: string;
  expiresAt: Date;
  resources: TestCashierResources;
  shiftId: string;
}

// Emite un par (cashierSessionToken, deviceToken) listo para que el
// super-admin abra el TPV con `?testCashierToken=...&testDeviceToken=...`.
// Si el cashier técnico no tiene shift abierto en su register, abre uno
// con cashOpening=0 para que el TPV arranque directo en estado "active".
export async function issueTestCashierSession(
  prisma: PrismaClient,
  tenantId: string,
): Promise<IssueTestSessionResult> {
  const resources = await provisionTestCashier(prisma, tenantId);

  // Shift abierto · si no hay, abrimos uno. cashOpening=0 (ficticio).
  let shift = await prisma.shift.findFirst({
    where: {
      registerId: resources.registerId,
      userId: resources.cashierUserId,
      closedAt: null,
    },
    select: { id: true },
  });
  if (!shift) {
    const created = await prisma.shift.create({
      data: {
        registerId: resources.registerId,
        userId: resources.cashierUserId,
        cashOpening: 0,
      },
      select: { id: true },
    });
    shift = created;
  }

  const expiresAt = new Date(Date.now() + TEST_CASHIER_TTL_HOURS * 60 * 60 * 1000);
  const cashierSessionToken = signCashierSession(
    {
      sub: resources.cashierUserId,
      tid: tenantId,
      did: resources.deviceId,
      rid: resources.registerId,
      role: "MANAGER",
      purpose: "test-cashier",
    },
    TEST_CASHIER_TTL_HOURS * 60,
  );

  return {
    cashierSessionToken,
    deviceToken: resources.deviceTokenPlain,
    expiresAt,
    resources,
    shiftId: shift.id,
  };
}

export interface PurgeTestDataResult {
  ticketsTestPurged: number;
  emailJobsPurged: number;
  cashierDeleted: boolean;
  deviceRevoked: boolean;
}

// Borra todos los rastros del modo prueba antes de activar el tenant.
// Idempotente: si no había datos test devuelve contadores en 0.
export async function purgeTestData(
  prisma: PrismaClient | Prisma.TransactionClient,
  tenantId: string,
): Promise<PurgeTestDataResult> {
  // 1. Locating cashier técnico (puede no existir si la activación
  //    sucede sin haberse provisionado nunca).
  const cashier = await prisma.user.findFirst({
    where: { tenantId, isTestCashier: true, deletedAt: null },
    select: { id: true },
  });

  // 2. Tickets TEST · borramos email jobs antes (FK Restrict en
  //    ticket → email_jobs CASCADE, pero somos explícitos para los
  //    SKIPPED_TEST que ya quedaron como histórico). El delete del
  //    ticket arrastra TicketLine, TicketPayment, TicketEmailJob por
  //    CASCADE (schema.prisma).
  const ticketsTest = await prisma.ticket.findMany({
    where: { tenantId, status: TicketStatus.TEST },
    select: { id: true },
  });
  const ticketIds = ticketsTest.map((t) => t.id);
  let emailJobsPurged = 0;
  if (ticketIds.length > 0) {
    const emailRes = await prisma.ticketEmailJob.deleteMany({
      where: { ticketId: { in: ticketIds } },
    });
    emailJobsPurged = emailRes.count;
  }
  const ticketsRes = await prisma.ticket.deleteMany({
    where: { tenantId, status: TicketStatus.TEST },
  });

  // 3. Cashier técnico · soft-delete + bumpea tokenVersion para
  //    invalidar JWTs vivos. Su Shift queda cerrado.
  let cashierDeleted = false;
  if (cashier) {
    await prisma.shift.updateMany({
      where: { userId: cashier.id, closedAt: null },
      data: { closedAt: new Date(), closedByUserId: cashier.id },
    });
    await prisma.user.update({
      where: { id: cashier.id },
      data: {
        deletedAt: new Date(),
        tokenVersion: { increment: 1 },
        pinHash: null,
      },
    });
    cashierDeleted = true;
  }

  // 4. Device técnico · revocado (no se borra para preservar histórico).
  const deviceRes = await prisma.device.updateMany({
    where: {
      tenantId,
      name: "mipiacetpv · modo prueba",
      revokedAt: null,
    },
    data: { revokedAt: new Date() },
  });

  return {
    ticketsTestPurged: ticketsRes.count,
    emailJobsPurged,
    cashierDeleted,
    deviceRevoked: deviceRes.count > 0,
  };
}
