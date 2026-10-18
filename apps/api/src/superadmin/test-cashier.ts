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

import { DeviceKind, Prisma, type PrismaClient, TicketStatus } from "@mipiacetpv/db";

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
  //    existe.
  //
  //    V1-verifactu addendum 1b · `kind: TEST`, y se busca POR EL TIPO y
  //    no por el nombre. Esto no es cosmética: mientras el tipo vivía en el
  //    nombre y en el user-agent, el trigger `devices_revoke_previous`
  //    trataba a este aparato como un terminal más y REVOCABA el terminal
  //    real del cliente al activar el modo prueba — un comercio sin poder
  //    cobrar desde el super-admin. Con `kind = TEST` ni releva ni es
  //    relevado, y el índice único de la caja no lo cuenta.
  const deviceName = "mipiacetpv · modo prueba";
  let device = await prisma.device.findFirst({
    where: { tenantId, registerId: register.id, kind: DeviceKind.TEST },
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
        kind: DeviceKind.TEST,
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
  /** puesta-en-marcha (ADR-021) · devoluciones de ensayo borradas. Van
   *  ANTES de sus tickets por una FK Restrict; ver la nota del paso 2. */
  refundsPurged: number;
  /** puesta-en-marcha (ADR-021) · borradores (mesas abiertas) borrados.
   *  Cero cuando el llamante no los pide. */
  borradoresPurged: number;
  /** puesta-en-marcha (ADR-021) · cuántos se borraron DE CADA ESTADO, en el
   *  orden en que los devuelve la base. Es lo que va al audit del reseteo:
   *  «20 anuladas» y «3 de ensayo» no significan lo mismo, y después de
   *  borrarlos no se pueden volver a contar. */
  ticketsPorEstado: Array<{ estado: string; cuantos: number }>;
  /** La suma de todos los estados. */
  ticketsPurgedTotal: number;
}

export interface PurgeTestDataOptions {
  /**
   * puesta-en-marcha (ADR-021) · QUÉ ESTADOS se borran.
   *
   *   · sin poner  → sólo `TEST`. El comportamiento de siempre, el de la
   *     ACTIVACIÓN: ahí un borrador puede ser una mesa de verdad abierta por
   *     el propietario, y borrarla sería borrarle una venta en curso.
   *   · `"todos"`  → cualquier estado. Es lo que pide el RESETEO DEL ENSAYO,
   *     y la razón es la foto de producción del 18-10: Cafetería Sirope
   *     tenía 20 tickets `VOIDED` de la demostración y de las pruebas. En
   *     una cuenta EN ENSAYO nada es real por definición —no puede haber
   *     una factura detrás, el bloque entero existe para eso—, así que un
   *     reseteo que sólo se lleva los `TEST` deja la cuenta medio sucia:
   *     anuladas en el arqueo, borradores en la sala, y el cliente
   *     encontrándoselos el día que empieza.
   *
   * Quien pide `"todos"` tiene que haber comprobado ANTES que ninguno es
   * real (`comprobarQueNadaEsReal`, en `fiscal/puesta-en-marcha.ts`). Esta
   * función no lo comprueba: borra lo que se le pide.
   */
  estados?: "todos";
  /**
   * puesta-en-marcha (ADR-021) · ¿se lleva por delante al cajero técnico y
   * su terminal de prueba?
   *
   * La ACTIVACIÓN sí (`true`, el default de siempre): el cliente entra en
   * su cuenta y el cajero interno del equipo no tiene que seguir dentro.
   *
   * El RESETEO del ensayo no. Resetear es «deja esto como estaba para
   * volver a ensayar», y matar la sesión con la que se está ensayando en el
   * navegador de al lado es justo lo contrario. Además el bloque promete
   * que el reseteo CONSERVA los cajeros, y el técnico es uno.
   */
  incluirCajeroTecnico?: boolean;
}

// Borra todos los rastros del modo prueba antes de activar el tenant.
// Idempotente: si no había datos test devuelve contadores en 0.
//
// puesta-en-marcha (ADR-021) · es también la mitad del RESETEO DEL ENSAYO
// (`fiscal/puesta-en-marcha.ts`), que la llama con `incluirBorradores` y sin
// tocar el cajero técnico, y añade después lo que el reseteo necesita y la
// activación no: los turnos, los arqueos, las mesas unidas y el contador de
// tickets de la caja. Una sola función para «borra los tickets de ensayo y
// lo que cuelga de ellos», con dos llamantes y ninguna copia.
export async function purgeTestData(
  prisma: PrismaClient | Prisma.TransactionClient,
  tenantId: string,
  opts: PurgeTestDataOptions = {},
): Promise<PurgeTestDataResult> {
  const todosLosEstados = opts.estados === "todos";
  const incluirCajeroTecnico = opts.incluirCajeroTecnico !== false;
  // 1. Locating cashier técnico (puede no existir si la activación
  //    sucede sin haberse provisionado nunca).
  const cashier = incluirCajeroTecnico
    ? await prisma.user.findFirst({
        where: { tenantId, isTestCashier: true, deletedAt: null },
        select: { id: true },
      })
    : null;

  // 2. Tickets TEST · borramos email jobs antes (FK Restrict en
  //    ticket → email_jobs CASCADE, pero somos explícitos para los
  //    SKIPPED_TEST que ya quedaron como histórico). El delete del
  //    ticket arrastra TicketLine, TicketPayment, TicketEmailJob por
  //    CASCADE (schema.prisma).
  //
  // puesta-en-marcha (ADR-021) · y las DEVOLUCIONES antes que nada, que es
  // un arreglo y no una ampliación. `Refund.originalTicket` es
  // `onDelete: Restrict`, así que el `deleteMany` de abajo LANZABA en
  // cuanto el ticket de prueba tenía un abono — y devolver un ticket TEST
  // se puede desde v1.9.5-formacion precisamente para poder ensayar la
  // devolución. Nadie lo había visto porque hasta hoy el ensayo era un
  // navegador y no la pasada completa en el hierro del cliente, donde la
  // devolución es uno de los pasos.
  //
  // Se borran por TENANT y no por ticket: en una cuenta en ensayo no hay
  // ninguna venta real, así que no hay ningún abono real. Y en la
  // activación (DRAFT, sin propietario todavía) tampoco.
  //
  // puesta-en-marcha (ADR-021) · `estados: "todos"` quita el filtro entero.
  // El `where` se construye UNA vez y lo comparten el recuento, el borrado de
  // lo que cuelga y el borrado de los tickets: si se escribieran por separado
  // acabarían diciendo cosas distintas el día que alguien toque uno.
  const where = todosLosEstados
    ? { tenantId }
    : { tenantId, status: TicketStatus.TEST };
  const aBorrar = await prisma.ticket.findMany({
    where,
    select: { id: true, status: true },
  });
  const ticketIds = aBorrar.map((t) => t.id);
  // El desglose POR ESTADO, antes de borrar: después no se puede contar.
  const porEstado = new Map<string, number>();
  for (const t of aBorrar) {
    porEstado.set(t.status, (porEstado.get(t.status) ?? 0) + 1);
  }
  const refundsRes = await prisma.refund.deleteMany({
    where: { tenantId, originalTicketId: { in: ticketIds } },
  });
  let emailJobsPurged = 0;
  if (ticketIds.length > 0) {
    const emailRes = await prisma.ticketEmailJob.deleteMany({
      where: { ticketId: { in: ticketIds } },
    });
    emailJobsPurged = emailRes.count;
  }
  const ticketsRes = await prisma.ticket.deleteMany({ where });

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
  //    Por TIPO y no por nombre, igual que el alta: un `name` es texto que
  //    alguien puede traducir, y este `updateMany` sin acierto dejaría vivo
  //    el modo prueba en un comercio ya activado.
  const deviceRes = incluirCajeroTecnico
    ? await prisma.device.updateMany({
        where: {
          tenantId,
          kind: DeviceKind.TEST,
          revokedAt: null,
        },
        data: { revokedAt: new Date() },
      })
    : { count: 0 };

  return {
    // `ticketsTestPurged` sigue significando lo que significaba —los `TEST`—
    // porque es lo que lee el audit de la activación. El total va aparte.
    ticketsTestPurged: porEstado.get(TicketStatus.TEST) ?? 0,
    emailJobsPurged,
    cashierDeleted,
    deviceRevoked: deviceRes.count > 0,
    refundsPurged: refundsRes.count,
    borradoresPurged: porEstado.get(TicketStatus.DRAFT) ?? 0,
    ticketsPorEstado: [...porEstado.entries()]
      .map(([estado, cuantos]) => ({ estado, cuantos }))
      .sort((a, b) => a.estado.localeCompare(b.estado)),
    ticketsPurgedTotal: ticketsRes.count,
  };
}
