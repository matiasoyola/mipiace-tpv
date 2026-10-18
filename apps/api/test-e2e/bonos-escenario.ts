// B-reservas-8 · la siembra compartida de los e2e de bonos.
//
// Tres ficheros de la suite montan el mismo centro —una podóloga con su
// caja, dos servicios de la misma categoría y una clienta—, y el bloque se
// cierra contra Postgres real: el `FOR UPDATE` de la puerta, el EXCLUDE del
// anti-solape, el trigger append-only del libro y los nueve CHECK de la
// migración no existen con un prisma falso, y son justo lo que hay que
// probar. («Un `FOR UPDATE` no se puede fingir» — `05` §4.1.)
//
// Esto NO es un test: no acaba en `.e2e.ts`, así que el `include` de la
// suite no lo recoge.

import { randomUUID } from "node:crypto";

import type { PrismaClient } from "@mipiacetpv/db";

export interface Escenario {
  tenantId: string;
  storeId: string;
  registerId: string;
  cashierId: string;
  shiftId: string;
  clientId: string;
  /** Otra ficha, para el caso «ese bono es de otra clienta». */
  otraClientaId: string;
  /** Los dos servicios de la categoría «podologia». */
  quiropodiaId: string;
  durezasId: string;
  /** Un servicio de OTRA categoría, que ningún bono de podología cubre. */
  masajeId: string;
  /** El producto-bono con su plantilla: 5 sesiones de la categoría. */
  bonoProductoId: string;
  bonoTemplateId: string;
}

export interface OpcionesDeSiembra {
  /** `false` para el test de «tenant sin el módulo → 404 en todo». */
  bonosEnabled?: boolean;
  /** `null` deja la cuenta EN ENSAYO (sus ventas nacen `TEST`). */
  facturaDesde?: Date | null;
  /** Meses de calendario de la plantilla. `null` = sin caducidad. */
  caducidadMesesDeLaPlantilla?: number | null;
  /** `PRORRATEO` para el test del frente P5. */
  modoCanje?: "LINEA_CERO" | "PRORRATEO";
  /** `liberar` para el test del no-show. */
  noShow?: "consumir" | "liberar";
  /** `false` para probar el CANDADO de primer uso. */
  confirmarArranque?: boolean;
  /** Por qué número empieza el talonario. */
  arranque?: number;
}

export async function sembrarEscenario(
  prisma: PrismaClient,
  opts: OpcionesDeSiembra = {},
): Promise<Escenario> {
  const tenant = await prisma.tenant.create({
    data: {
      name: `Clínica del pie e2e ${randomUUID().slice(0, 8)}`,
      agendaEnabled: true,
      crmEnabled: true,
      // Los bonos SÓLO en cuentas sin Holded (decisión de Dirección,
      // 18-10). El CHECK `tenants_bonos_sin_holded` lo exige, así que el
      // escenario lo cumple: si alguien lo quitara, este `create` fallaría
      // y lo diría el primer test de la suite.
      holdedEnabled: false,
      bonosEnabled: opts.bonosEnabled ?? true,
      bonoModoCanje: opts.modoCanje ?? "LINEA_CERO",
      bonoNoShow: opts.noShow ?? "consumir",
      // Una cuenta que YA FACTURA, salvo que el test pida el ensayo.
      facturaDesde:
        opts.facturaDesde === undefined
          ? new Date("2026-06-01T08:00:00.000Z")
          : opts.facturaDesde,
      fiscalProfile: { taxId: "B12345678", legalName: "Clínica del pie SL" },
    },
    select: { id: true },
  });
  const tenantId = tenant.id;

  const store = await prisma.store.create({
    data: { tenantId, name: "Consulta" },
    select: { id: true },
  });
  const register = await prisma.register.create({
    data: { storeId: store.id, name: "Caja 1" },
    select: { id: true },
  });
  const cashier = await prisma.user.create({
    data: {
      tenantId,
      email: `rosario+${randomUUID()}@e2e.local`,
      alias: "Rosario",
      role: "CASHIER",
    },
    select: { id: true },
  });
  const shift = await prisma.shift.create({
    data: { registerId: register.id, userId: cashier.id, cashOpening: "50" },
    select: { id: true },
  });

  const clienta = await prisma.client.create({
    data: { tenantId, firstName: "Carmen", lastName: "Ruiz", phone: "600111222" },
    select: { id: true },
  });
  const otra = await prisma.client.create({
    data: { tenantId, firstName: "Lola", lastName: "Gil", phone: "600333444" },
    select: { id: true },
  });

  // Los servicios. La CATEGORÍA es un tag de `Product.tags` (ADR-R1 y S5:
  // el agrupador único del TPV es la categoría).
  const quiropodia = await prisma.product.create({
    data: {
      tenantId,
      source: "LOCAL",
      name: "Quiropodia",
      sku: "SVC-QUIRO",
      basePrice: "35.0000",
      taxRate: "0",
      exemptionCause: "E1",
      kind: "SERVICE",
      tags: ["podologia"],
    },
    select: { id: true },
  });
  const durezas = await prisma.product.create({
    data: {
      tenantId,
      source: "LOCAL",
      name: "Quitar durezas",
      sku: "SVC-DUREZAS",
      basePrice: "20.0000",
      taxRate: "0",
      exemptionCause: "E1",
      kind: "SERVICE",
      tags: ["podologia"],
    },
    select: { id: true },
  });
  const masaje = await prisma.product.create({
    data: {
      tenantId,
      source: "LOCAL",
      name: "Masaje de espalda",
      sku: "SVC-MASAJE",
      basePrice: "40.0000",
      taxRate: "21",
      kind: "SERVICE",
      tags: ["estetica"],
    },
    select: { id: true },
  });

  // Los tres necesitan fila de scheduling para que la agenda los conozca.
  for (const id of [quiropodia.id, durezas.id, masaje.id]) {
    await prisma.serviceScheduling.create({
      data: { productId: id, tenantId, durationMin: 30 },
    });
  }
  // Y la matriz: Rosario sabe hacer los tres.
  for (const id of [quiropodia.id, durezas.id, masaje.id]) {
    await prisma.staffSkill.create({
      data: { tenantId, userId: cashier.id, serviceId: id },
    });
  }
  await prisma.staffProfile.create({
    data: { tenantId, userId: cashier.id, displayName: "Rosario" },
  });
  // EL TURNO. Sin él la disponibilidad del motor es vacía y el alta por la
  // RUTA contesta `NO_SLOT`: en B4 el centro no abre si nadie tiene turno.
  // Los siete días y de 06:00 a 23:00 en hora de pared, porque estos tests
  // no prueban el horario —lo prueba `agenda-horario.e2e.ts`— y una cita
  // que no entra por la hora contaría una historia que no es la del bono.
  await prisma.staffShift.create({
    data: {
      tenantId,
      userId: cashier.id,
      rrule: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR,SA,SU",
      startTime: "06:00",
      endTime: "23:00",
      validFrom: new Date("2026-01-01T00:00:00.000Z"),
    },
  });

  // EL BONO DEL CATÁLOGO: un producto normal con su plantilla 1:1. El
  // precio y el IVA van por el camino de siempre —aquí, exento como los
  // servicios que cubre (`exemptionCause` del producto).
  const bonoProducto = await prisma.product.create({
    data: {
      tenantId,
      source: "LOCAL",
      name: "Bono quiropodia",
      sku: "LOC-BONO-5",
      basePrice: "150.0000",
      taxRate: "0",
      exemptionCause: "E1",
      kind: "SERVICE",
      tags: ["bonos"],
    },
    select: { id: true },
  });
  const plantilla = await prisma.voucherTemplate.create({
    data: {
      tenantId,
      productId: bonoProducto.id,
      sessions: 5,
      coversServiceIds: [],
      // Por CATEGORÍA: cubre toda la familia «podologia», que son dos
      // servicios. Así se prueba la rama que el prompt pide (S5).
      coversTagSlugs: ["podologia"],
      expiresMonths:
        opts.caducidadMesesDeLaPlantilla === undefined
          ? null
          : opts.caducidadMesesDeLaPlantilla,
    },
    select: { id: true },
  });

  // EL CANDADO DE PRIMER USO. Por defecto se confirma —casi todos los
  // tests necesitan poder emitir— y el que lo prueba pide `false`.
  if (opts.confirmarArranque !== false) {
    await prisma.voucherSequence.create({
      data: {
        tenantId,
        ultimo: 0,
        arranque: opts.arranque ?? 1,
        arranqueConfirmadoAt: new Date(),
        arranqueConfirmadoBy: cashier.id,
      },
    });
  }

  return {
    tenantId,
    storeId: store.id,
    registerId: register.id,
    cashierId: cashier.id,
    shiftId: shift.id,
    clientId: clienta.id,
    otraClientaId: otra.id,
    quiropodiaId: quiropodia.id,
    durezasId: durezas.id,
    masajeId: masaje.id,
    bonoProductoId: bonoProducto.id,
    bonoTemplateId: plantilla.id,
  };
}

/** Un bono dado de alta directamente, para los tests que no prueban la
 *  venta. Pasa por el mismo `INSERT` + línea `VENDIDO` que la venta real,
 *  así que el libro queda como quedaría de verdad. */
export async function sembrarBono(
  prisma: PrismaClient,
  e: Escenario,
  opts: {
    sesiones?: number;
    coversTagSlugs?: string[];
    coversServiceIds?: string[];
    expiresAt?: Date | null;
    clientId?: string;
    valorCartaCents?: number;
    numero?: number;
  } = {},
): Promise<{ id: string; code: string; numero: number }> {
  const sesiones = opts.sesiones ?? 5;
  const numero = opts.numero ?? (await siguienteLibre(prisma, e.tenantId));
  const code = `B${numero}`;
  const ahora = new Date();
  const filas = await prisma.$queryRaw<Array<{ id: string }>>`
    INSERT INTO "vouchers"
      ("id", "tenant_id", "client_id", "code", "number", "template_id",
       "type", "sessions_total", "sessions_left", "sessions_reserved",
       "covers_service_ids", "covers_tag_slugs", "name_snapshot",
       "valor_carta_cents", "cobrado_cents", "sold_ticket_id",
       "sold_ticket_line_id", "expires_at", "status", "origen",
       "es_prueba", "created_at", "updated_at")
    VALUES
      (gen_random_uuid(), ${e.tenantId}::uuid, ${opts.clientId ?? e.clientId}::uuid,
       ${code}, ${numero}, NULL, 'SESSIONS',
       ${sesiones}, ${sesiones}, 0,
       ${opts.coversServiceIds ?? []}::uuid[],
       ${opts.coversTagSlugs ?? ["podologia"]}::text[],
       ${`Bono de ${sesiones} sesiones`},
       ${opts.valorCartaCents ?? 15000}, ${opts.valorCartaCents ?? 15000},
       NULL, NULL, ${opts.expiresAt ?? null}, 'ACTIVO', 'ALTA_INICIAL',
       false, ${ahora}, ${ahora})
    RETURNING "id"`;
  const id = filas[0]!.id;
  await prisma.$executeRaw`
    INSERT INTO "voucher_movements"
      ("id", "tenant_id", "voucher_id", "tipo", "sesiones", "detalle",
       "canal", "user_id", "es_prueba", "created_at")
    VALUES
      (gen_random_uuid(), ${e.tenantId}::uuid, ${id}::uuid, 'ALTA_INICIAL',
       ${sesiones}, ${`Alta inicial de la siembra · ${code}`}, 'panel',
       ${e.cashierId}::uuid, false, ${ahora})`;
  return { id, code, numero };
}

async function siguienteLibre(
  prisma: PrismaClient,
  tenantId: string,
): Promise<number> {
  const filas = await prisma.$queryRaw<Array<{ max: number | null }>>`
    SELECT MAX("number") AS max FROM "vouchers"
     WHERE "tenant_id" = ${tenantId}::uuid`;
  return (Number(filas[0]?.max ?? 0) || 0) + 1;
}
