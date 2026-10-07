// bloque iva-exento-sanitario §5 · EL COBRO DE LA SESIÓN, y el bono.
//
// La sesión de clinica-3 dice QUÉ tratamientos se hicieron; el catálogo
// dice con qué fiscalidad se cobran. Lo que este banco recorre es el
// camino entero de la exención desde la ficha del servicio hasta la línea
// del borrador que la caja va a cobrar:
//
//   `service_scheduling.tratamiento_sesion` (clinica-3)
//     → la podóloga marca el tratamiento y CIERRA la sesión
//     → `lineasDeLaSesionCerrada` devuelve sus ids
//     → `checkoutAppointment` resuelve el producto y crea la línea
//     → `ticket_lines.exemption_cause` = 'E1'
//     → `POST /tickets/:id/checkout` recalcula por tramo (tasa, causa)
//
// Y el pie de la sesión que la podóloga ve ANTES de cerrar tiene que decir
// «Exento · sanitario», no «IVA 0 %»: clinica-3 dejó escrito en su propio
// código por qué no podía decirlo todavía, y la razón que daba ya no es
// verdad.

import { randomUUID } from "node:crypto";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.REDIS_URL = "redis://localhost:6379";
process.env.JWT_ACCESS_SECRET = "a".repeat(40);
process.env.JWT_REFRESH_SECRET = "b".repeat(40);

import { resumenDeLaSesion, textoDelIva } from "@mipiacetpv/clinica-sesion";
import { Prisma } from "@mipiacetpv/db";
import { claveTramo } from "@mipiacetpv/ticket-model";
import { describe, expect, it } from "vitest";

import { checkoutAppointment } from "../src/agenda/checkout.js";
import type { AgendaStore } from "../src/agenda/store.js";
import type { AppointmentView } from "../src/agenda/types.js";
import { computeTicket } from "../src/tickets/totals.js";

const TENANT = "11111111-1111-4111-8111-111111111111";
const REGISTER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CLINICIAN = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const QUIROPODIA = "33333333-3333-4333-8333-333333333333";
const CREMA = "44444444-4444-4444-8444-444444444444";

interface ProductoDeCatalogo {
  id: string;
  sku: string;
  name: string;
  basePrice: number;
  taxRate: number;
  exemptionCause: string | null;
}

const CATALOGO: ProductoDeCatalogo[] = [
  {
    id: QUIROPODIA,
    sku: "LOC-QUIRO",
    name: "Quiropodia",
    basePrice: 35,
    taxRate: 0,
    exemptionCause: "E1",
  },
  {
    id: CREMA,
    sku: "LOC-CREMA",
    name: "Crema urea 20%",
    // El neto de 4 decimales que persiste el catálogo: `netoDesdeBruto(12, 21)`.
    basePrice: 9.9174,
    taxRate: 21,
    exemptionCause: null,
  },
];

// Store mínimo: sólo lo que usa `checkoutAppointment`.
function makeStore(appt: AppointmentView) {
  let current = appt;
  const store = {
    async getAppointmentView(_t: string, id: string) {
      return id === current.id ? current : null;
    },
    async linkTicket(_t: string, _id: string, ticketId: string) {
      current = { ...current, ticketId };
    },
    async setStatus(_t: string, _id: string, status: AppointmentView["status"]) {
      current = { ...current, status };
      return current;
    },
  } as unknown as AgendaStore;
  return { store, get: () => current };
}

/** Prisma-lite con lo que toca el checkout, y con la columna nueva en el
 *  `select` del producto — que es justo la línea que el sabotaje quita. */
function makeFakePrisma(productos: ProductoDeCatalogo[]) {
  const tickets = new Map<string, Record<string, unknown>>();
  return {
    product: {
      findMany: async () =>
        productos.map((p) => ({
          id: p.id,
          holdedProductId: null,
          sku: p.sku,
          name: p.name,
          basePrice: new Prisma.Decimal(p.basePrice),
          taxRate: new Prisma.Decimal(p.taxRate),
          exemptionCause: p.exemptionCause,
        })),
    },
    shift: { findFirst: async () => ({ id: "shift-1" }) },
    $transaction: async (cb: (tx: unknown) => Promise<unknown>) =>
      cb({
        ticket: {
          create: async (args: { data: Record<string, unknown> }) => {
            const data = args.data;
            const lines =
              (data.lines as { create?: Record<string, unknown>[] } | undefined)
                ?.create ?? [];
            tickets.set(data.id as string, {
              id: data.id,
              externalId: data.externalId,
              status: data.status,
              total: data.total,
              totalTax: data.totalTax,
              totalDiscount: data.totalDiscount,
              lines: lines.map((l, i) => ({ id: `line-${i}`, ...l })),
            });
            return {};
          },
        },
      }),
    ticket: {
      findUnique: async (args: { where: { id: string } }) =>
        tickets.get(args.where.id) ?? null,
    },
  } as never;
}

function apptWith(serviceIds: string[]): AppointmentView {
  const id = randomUUID();
  return {
    id,
    clientId: null,
    status: "CONFIRMED",
    source: "PRESENCIAL",
    start: "2026-10-07T08:00:00.000Z",
    end: "2026-10-07T08:30:00.000Z",
    ticketId: null,
    notes: null,
    items: serviceIds.map((serviceId, i) => ({
      id: `${id}-item-${i}`,
      serviceId,
      durationMin: 30,
      sortOrder: i,
      startOffsetMin: i * 30,
    })),
    assignments: [],
  };
}

async function cobrarCita(serviceIds: string[], productos = CATALOGO) {
  const appt = apptWith(serviceIds);
  const { store } = makeStore(appt);
  const r = await checkoutAppointment(
    makeFakePrisma(productos),
    store,
    { tenantId: TENANT, registerId: REGISTER, cashierUserId: CLINICIAN },
    appt.id,
  );
  if (!r.ok) throw new Error(`${r.error}: ${r.message}`);
  return r.ticket;
}

describe("iva-exento-sanitario · la sesión pasa a caja con su exención", () => {
  it("la línea del borrador lleva la causa del servicio", async () => {
    const ticket = await cobrarCita([QUIROPODIA]);
    expect(ticket.lines).toHaveLength(1);
    expect(ticket.lines[0]!.exemptionCause).toBe("E1");
    expect(ticket.lines[0]!.nameSnapshot).toBe("Quiropodia");
    // Y el total es el precio: con exento no hay IVA que sumar.
    expect(Number(ticket.total)).toBe(35);
    expect(Number(ticket.totalTax)).toBe(0);
  });

  it("y en una venta mixta cada línea lleva LO SUYO", async () => {
    const ticket = await cobrarCita([QUIROPODIA, CREMA]);
    expect(ticket.lines.map((l) => l.exemptionCause)).toEqual(["E1", null]);
    expect(Number(ticket.total)).toBe(47);
    expect(Number(ticket.totalTax)).toBe(2.08);
  });

  it("el cobro del borrador recalcula por tramo (tasa, causa)", async () => {
    // Es lo que hace `POST /tickets/:id/checkout` con las líneas
    // persistidas: el mismo `computeTicket` con el `exemptionCause` de
    // cada línea.
    const ticket = await cobrarCita([QUIROPODIA, CREMA]);
    const totals = computeTicket(
      ticket.lines.map((l) => ({
        units: Number(l.units),
        unitPrice: Number(l.unitPrice),
        discountPct: Number(l.discountPct),
        taxRate: Number(l.taxRate),
        exemptionCause: l.exemptionCause,
      })),
    );
    expect(totals.total).toBe(47);
    expect(totals.tax).toBe(2.08);
  });

  it("un servicio SIN causa se cobra como siempre: los catorce tenants no notan nada", async () => {
    const ticket = await cobrarCita([CREMA]);
    expect(ticket.lines[0]!.exemptionCause).toBeNull();
    expect(Number(ticket.total)).toBe(12);
    expect(Number(ticket.totalTax)).toBe(2.08);
  });
});

describe("iva-exento-sanitario · el pie de la sesión, antes de cerrar", () => {
  const quiro = {
    serviceId: QUIROPODIA,
    nombre: "Quiropodia",
    precio: 35,
    iva: 0,
    causaExencion: "E1" as const,
  };
  const vendaje = {
    serviceId: "v",
    nombre: "Vendaje",
    precio: 8,
    iva: 0,
    causaExencion: "E1" as const,
  };
  const cremaLinea = {
    serviceId: CREMA,
    nombre: "Crema urea 20%",
    precio: 9.9174,
    iva: 21,
  };

  it("dice «Exento · sanitario», NO «IVA 0 %»", () => {
    // clinica-3 escribió en `TratamientoDelCatalogo.iva` por qué esta
    // pantalla no podía decir «exento»: «el IVA exento en Verifactu está
    // fuera de alcance (`registro.ts` sigue declarando `S1`)». Ya no es
    // verdad, y mientras lo fuera decirlo habría sido mentir en la
    // pantalla donde la podóloga comprueba lo que va a cobrar.
    expect(textoDelIva([quiro])).toBe("Exento · sanitario");
    expect(textoDelIva([quiro, vendaje])).toBe("Exento · sanitario");
  });

  it("un 0 % SUJETO sigue diciendo «IVA 0 %»", () => {
    expect(textoDelIva([{ ...quiro, causaExencion: null }])).toBe("IVA 0 %");
  });

  it("y mezclando exento con sujeto dice que depende de cada tratamiento", () => {
    expect(textoDelIva([quiro, cremaLinea])).toBe("IVA según cada tratamiento");
    // Y también mezclando un exento con un 0 % SUJETO, que es el caso que
    // con la tasa sola como clave habría dicho «IVA 0 %» de los dos.
    expect(textoDelIva([quiro, { ...cremaLinea, iva: 0 }])).toBe(
      "IVA según cada tratamiento",
    );
  });

  it("el resumen lleva la causa en la línea, con los importes", () => {
    const r = resumenDeLaSesion({
      tratamientos: [QUIROPODIA],
      catalogo: [quiro],
      dolor: 4,
      verImportes: true,
    });
    expect(r.lineas[0]!.causaExencion).toBe("E1");
    expect(r.ivaTexto).toBe("Exento · sanitario");
    expect(r.total).toBe(35);
  });

  it("y a quien NO ve importes no le llega la causa: es cómo se tributa lo que se cobra", () => {
    // Misma regla de FORMA que `precio` e `iva` (clinica-3, regla 8): la
    // clave NO ESTÁ, no vale 0 ni null. Un `causaExencion: "E1"` suelto en
    // la respuesta de un `CLINICIAN` no es un importe, pero es la etiqueta
    // de un importe que no puede ver, y la pantalla la pintaría al lado de
    // un hueco.
    const r = resumenDeLaSesion({
      tratamientos: [QUIROPODIA],
      catalogo: [quiro],
      dolor: 4,
      verImportes: false,
    });
    expect("causaExencion" in r.lineas[0]!).toBe(false);
    expect(r.total).toBeNull();
    expect(r.ivaTexto).toBeNull();
  });
});

// ═══ El bono de sesiones ══════════════════════════════════════════════

describe("iva-exento-sanitario · el bono de sesiones NO EXISTE todavía", () => {
  // El enunciado del bloque pedía «localiza dónde se vende el bono y que
  // la exención llegue a su línea». No hay dónde: el módulo de bonos es
  // el bloque **reservas-8** («programa multisesión»), que está escrito
  // como prompt y NO implementado —
  //
  //   · no hay `Tenant.bonosEnabled`, que es el flag de capacidad que su
  //     propio prompt fija (§«Flag de capacidad `bonosEnabled` en
  //     `Tenant`, columna booleana explícita, patrón fijado en B1,
  //     ADR-R6»);
  //   · no hay tabla de bonos ni de saldos: lo único que existe es la
  //     columna reservada `appointments.voucher_id`, que B-reservas-4 dejó
  //     puesta con el comentario «Canje de bono (B5, fuera de alcance en
  //     B4; sólo la columna)»;
  //   · `GET /clients/:id/vouchers` devuelve una lista vacía con contrato
  //     estable desde B-reservas-1, y nada la rellena.
  //
  // Así que lo que este bloque puede hacer —y hace— es que la venta de un
  // bono NAZCA exenta el día que exista, y eso no es una promesa: es una
  // consecuencia de dónde vive la causa. **La exención es del PRODUCTO**
  // (decisión 1), y un bono de sesiones de un servicio exento se vende
  // como una línea de ticket de ese producto, por la misma puerta que
  // todas: `POST /tickets` o el borrador de la agenda.
  //
  // Lo que estos tests fijan es la INVARIANTE que lo garantiza, para que
  // quien escriba reservas-8 la encuentre en rojo si la rompe.

  it("no hay ningún flag, tabla ni ruta de bonos en el esquema", async () => {
    const { readFileSync } = await import("node:fs");
    // SIN los comentarios: el schema habla de `bonosEnabled` en el
    // comentario de `crmEnabled` («vendrán `bonosEnabled`…»), y un test que
    // busca en lo que se LEE en vez de en lo que se DECLARA pasa o falla
    // por una frase. Es la lección que clinica-1 dejó escrita.
    const schema = readFileSync(
      new URL("../../../packages/db/prisma/schema.prisma", import.meta.url),
      "utf8",
    )
      .split("\n")
      .filter((l) => !l.trimStart().startsWith("//"))
      .join("\n");
    // Si alguna de estas tres aparece, el módulo de bonos ha entrado y
    // este test tiene que volver a mirarse: la pregunta es si la venta del
    // bono pasa por `POST /tickets` (y entonces hereda la exención sola) o
    // si se ha inventado una segunda puerta.
    expect(schema).not.toMatch(/bonosEnabled/);
    expect(schema).not.toMatch(/model Voucher\b/);
    expect(schema).not.toMatch(/model SessionProgram\b/);
    // Lo que SÍ está es la columna reservada, y sigue siendo sólo eso.
    expect(schema).toMatch(/voucherId\s+String\?\s+@map\("voucher_id"\)/);
  });

  it("CUALQUIER línea nacida de un producto exento hereda la exención", async () => {
    // La invariante, comprobada por el camino de la agenda: lo único que
    // hace falta para que un bono salga exento es que su producto lo esté.
    // No hay nada específico de «bono» en el camino de la línea.
    const BONO = "55555555-5555-4555-8555-555555555555";
    const bonoDeDiezSesiones: ProductoDeCatalogo = {
      id: BONO,
      sku: "LOC-BONO-10",
      name: "Bono 10 sesiones de quiropodia",
      // Diez sesiones a 32 € en vez de 35: el descuento del bono vive en
      // el precio del producto, como cualquier otro precio de catálogo.
      basePrice: 320,
      taxRate: 0,
      exemptionCause: "E1",
    };
    const ticket = await cobrarCita([BONO], [bonoDeDiezSesiones]);
    expect(ticket.lines[0]!.exemptionCause).toBe("E1");
    expect(Number(ticket.total)).toBe(320);
    expect(Number(ticket.totalTax)).toBe(0);
  });

  it("y el tramo de un bono exento y el de la sesión exenta son EL MISMO", () => {
    // Una venta con un bono y una sesión suelta, los dos exentos, declara
    // UN solo `DetalleDesglose`: misma tasa y misma causa son el mismo
    // tramo. Si el día que exista el bono alguien le pusiera otra causa,
    // esto se pondría rojo — y la conversación que toca es cuál de las dos
    // es la correcta.
    expect(claveTramo(0, "E1")).toBe(claveTramo(0, "E1"));
    expect(claveTramo(0, "E1")).not.toBe(claveTramo(0, null));
  });
});
