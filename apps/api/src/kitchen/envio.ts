// kds-1-cocina · EL ENVÍO, por diferencias y con idempotencia.
//
// Sustituye a `tickets/kitchen-dispatch.ts`, que agrupaba TODAS las líneas
// del DRAFT en cada envío. El hallazgo del 08-10, comprobado en `master`:
// `lastSentRevision` sólo contaba las comandas y `TicketLine` no tenía
// ninguna marca de envío, así que un segundo «Enviar» reimprimía la mesa
// entera. El sabotaje «Volver a mandar todas las líneas en cada envío» de
// la tabla del bloque es exactamente este fichero.
//
// ── LA DIFERENCIA ─────────────────────────────────────────────────────
//
// `TicketLine.sentUnits` dice cuántas unidades de esa línea tiene ya la
// cocina. Se manda `units - sentUnits` y se sube `sentUnits` a `units`.
// Dos cañas, enviar, +1 caña, enviar → la 2ª comanda lleva UNA caña.
//
// Se sube a `units` y no se suma la diferencia: así el camino es
// IDEMPOTENTE. Repetir la operación con los mismos datos no mueve nada,
// que es lo que hace que un reintento sea seguro.
//
// ── LA IDEMPOTENCIA, Y SUS TRES VENTANAS ──────────────────────────────
//
// `clientSendId` es un UUID que el TERMINAL genera antes de mandar. La
// llave vive en `KitchenDispatch` y no en `KitchenOrder` porque un envío
// puede crear dos tarjetas (cocina y barra), imprimir en una tercera
// sección y marcar como enviada una cuarta sin destino: lo que no puede
// repetirse es el ENVÍO completo, impresión incluida.
//
// Tres estados posibles al llegar un `clientSendId`:
//
//   1. **No existe** → es un envío nuevo. Se reserva la fila con
//      `result = {estado: "EN_CURSO"}` y se trabaja.
//   2. **Existe y terminado** → se devuelve su `result` literal, sin
//      tocar nada. Es el caso real: el terminal mandó, la respuesta se
//      perdió por el camino y reintenta.
//   3. **Existe y EN_CURSO** → dos peticiones del mismo envío en vuelo a
//      la vez. Se responde **409 DISPATCH_IN_FLIGHT** y el terminal
//      reintenta en un momento. Es la respuesta honesta: no se puede
//      devolver «el mismo resultado» de algo que todavía no tiene
//      resultado, y lo que NO se puede hacer es imprimir dos veces.
//
// Y queda preparado para kds-2 (decisión 9): el mismo id viajará a la nube
// y a la tablet por la wifi, y el que llegue segundo se descartará por él.
//
// ── EL ORDEN DE LAS COSAS, Y POR QUÉ ──────────────────────────────────
//
//   a. reservar el `clientSendId` (transacción corta)
//   b. IMPRIMIR por TCP lo que va a impresora
//   c. una transacción con todo lo demás: tarjetas, `sentUnits`, el
//      tiempo 1 marchado, `lastSentAt`/`lastSentRevision` y el `result`
//      definitivo
//
// Imprimir ANTES de marcar porque **una sección cuya impresora falla no
// marca sus líneas como enviadas**. Hoy un fallo de impresora deja la mesa
// sin marcar y el camarero vuelve a pulsar «Enviar»; con envío por
// diferencias, marcar y luego fallar perdería esas líneas para siempre —
// la cocina no las tendría y el servidor creería que sí. Se elige repetir
// antes que perder, igual que en el backfill de la migración.
//
// Si el proceso se muere entre (b) y (c), la fila queda EN_CURSO: el
// terminal recibe 409 al reintentar, y el camarero vuelve a pulsar
// «Enviar» (nuevo `clientSendId`). La cocina puede recibir el papel dos
// veces. Es el único desenlace malo que queda y es el prudente.

import { randomUUID } from "node:crypto";

import { Prisma, type KitchenSection, type Allergen } from "@mipiacetpv/db";
import {
  buildKitchenComanda,
  sendOverTcp,
  type KitchenLineEscpos,
} from "@mipiacetpv/escpos-builder";
import {
  avisoChoque,
  choqueAlergenos,
  franjaAlergia,
  type Alergeno,
} from "@mipiacetpv/ticket-model";

import { getPrisma } from "../context.js";
import { cashierLabelFrom } from "../users/display.js";
import {
  construirDestinos,
  destinoDe,
  marchaAlEnviar,
  resolverSeccion,
  SECCIONES,
  type DestinoSeccion,
} from "./destinos.js";
import { emitirComandaCreada } from "./eventos.js";

export interface EnvioCtx {
  tenantId: string;
  registerId: string;
  cashierId: string;
}

export interface EnvioOpts {
  /** UUID v4 generado en el terminal. Sin él no hay idempotencia. */
  clientSendId?: string;
  /** El camarero tocó «Urgente» junto a «Enviar». */
  urgent?: boolean;
}

export type TipoDestino =
  | "PANTALLA"
  | "IMPRESORA"
  | "PANTALLA_E_IMPRESORA"
  | "NINGUNO";

export interface SeccionEnviada {
  section: KitchenSection;
  destino: TipoDestino;
  /** `false` SÓLO cuando la impresora de esa sección falló. */
  ok: boolean;
  lineCount: number;
  units: number;
  orderId?: string;
  error?: string;
}

export interface CuerpoEnvio {
  revision: number;
  sentAt: string;
  clientSendId: string | null;
  urgent: boolean;
  /**
   * No había nada nuevo que mandar: todas las líneas del DRAFT estaban ya
   * en cocina. No se crea comanda, no se sube la revisión y no se imprime.
   * Un «Reenviar» que no cambió nada no puede inventarse una «2ª comanda»
   * vacía en la pantalla del cocinero.
   */
  nothingNew: boolean;
  sections: SeccionEnviada[];
  /** `true` si esto es la respuesta guardada de un envío anterior. */
  replayed: boolean;
}

export type Envio =
  | { kind: "not-found" }
  | { kind: "register-mismatch" }
  | { kind: "empty" }
  | { kind: "in-flight" }
  | { kind: "ok"; http: number; body: CuerpoEnvio };

const EN_CURSO = { estado: "EN_CURSO" } as const;

/** Redondeo a las 3 decimales de `Decimal(10,3)`. */
function u3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export async function enviarComanda(
  ticketId: string,
  ctx: EnvioCtx,
  opts: EnvioOpts = {},
): Promise<Envio> {
  const prisma = getPrisma();
  const clientSendId = opts.clientSendId ?? null;

  // ── a · ¿ya pasó esto? ──────────────────────────────────────────────
  if (clientSendId) {
    const previo = await prisma.kitchenDispatch.findUnique({
      where: { clientSendId },
      select: { result: true, tenantId: true },
    });
    if (previo) {
      if (previo.tenantId !== ctx.tenantId) return { kind: "not-found" };
      const r = previo.result as { estado?: string } | null;
      if (r && r.estado === "EN_CURSO") return { kind: "in-flight" };
      return {
        kind: "ok",
        http: 200,
        body: { ...(previo.result as unknown as CuerpoEnvio), replayed: true },
      };
    }
  }

  const ticket = await prisma.ticket.findFirst({
    where: { id: ticketId, tenantId: ctx.tenantId, status: "DRAFT" },
    select: {
      id: true,
      tableId: true,
      registerId: true,
      diners: true,
      notes: true,
      lastSentRevision: true,
      table: { select: { id: true, name: true } },
      register: { select: { storeId: true } },
      lines: {
        select: {
          id: true,
          productId: true,
          nameSnapshot: true,
          units: true,
          sentUnits: true,
          course: true,
          seat: true,
          modifiers: true,
          product: { select: { allergens: true } },
        },
      },
      courses: { select: { course: true } },
      allergies: { select: { seat: true, allergen: true } },
    },
  });
  if (!ticket) return { kind: "not-found" };
  if (ticket.registerId !== ctx.registerId) return { kind: "register-mismatch" };
  if (ticket.lines.length === 0) return { kind: "empty" };

  const storeId = ticket.register.storeId;

  const [tenant, etiquetas, pantallas, impresoras, cashierUser] =
    await Promise.all([
      prisma.tenant.findUniqueOrThrow({
        where: { id: ctx.tenantId },
        select: { kitchenDisplayEnabled: true },
      }),
      prisma.tagSection.findMany({
        where: { tenantId: ctx.tenantId },
        select: { slug: true, section: true },
      }),
      // Las PANTALLAS de la tienda, vivas o no: una pantalla sin red sigue
      // siendo el destino de su sección (ver la cabecera de `destinos.ts`).
      prisma.device.findMany({
        where: {
          tenantId: ctx.tenantId,
          kind: "KITCHEN",
          revokedAt: null,
          register: { storeId },
        },
        select: { kitchenSections: true },
      }),
      prisma.printerConfig.findMany({
        where: {
          registerId: ctx.registerId,
          active: true,
          mode: "WIFI",
          section: { not: null },
        },
        select: {
          id: true,
          section: true,
          ipAddress: true,
          port: true,
          timeoutMs: true,
        },
      }),
      prisma.user.findUniqueOrThrow({
        where: { id: ctx.cashierId },
        select: { email: true, alias: true },
      }),
    ]);

  const productIds = ticket.lines
    .map((l) => l.productId)
    .filter((x): x is string => x != null);
  const productos =
    productIds.length > 0
      ? await prisma.product.findMany({
          where: { id: { in: productIds }, tenantId: ctx.tenantId },
          select: { id: true, tags: true },
        })
      : [];

  const etiquetasPorProducto = new Map<string, string[]>(
    productos.map((p) => [p.id, p.tags]),
  );
  const seccionPorEtiqueta = new Map<string, KitchenSection>(
    etiquetas.map((e) => [e.slug, e.section]),
  );
  const impresoraPorSeccion = new Map<
    KitchenSection,
    (typeof impresoras)[number]
  >();
  for (const p of impresoras) if (p.section) impresoraPorSeccion.set(p.section, p);

  const destinos = construirDestinos({
    moduloEncendido: tenant.kitchenDisplayEnabled,
    pantallas,
    seccionesConImpresora: [...impresoraPorSeccion.keys()],
  });

  // ── Las alergias de la mesa, en sus tres capas ──────────────────────
  const alergiasPorSilla = new Map<number | null, Alergeno[]>();
  for (const a of ticket.allergies) {
    const k = a.seat ?? null;
    const prev = alergiasPorSilla.get(k) ?? [];
    prev.push(a.allergen as Alergeno);
    alergiasPorSilla.set(k, prev);
  }
  const deTodaLaMesa = alergiasPorSilla.get(null) ?? [];
  /** Lo que no puede entrar en la silla N: lo suyo más lo de la mesa. */
  const alergenosDeSilla = (seat: number | null): Alergeno[] =>
    seat == null
      ? deTodaLaMesa
      : [...new Set([...(alergiasPorSilla.get(seat) ?? []), ...deTodaLaMesa])];

  // «Toda la mesa» primero: condiciona cómo se cocina TODO lo demás.
  const franjas: string[] = [];
  if (deTodaLaMesa.length > 0) franjas.push(franjaAlergia(null, deTodaLaMesa));
  for (const seat of [...alergiasPorSilla.keys()]
    .filter((k): k is number => k != null)
    .sort((a, b) => a - b)) {
    franjas.push(franjaAlergia(seat, alergiasPorSilla.get(seat)!));
  }

  const tiemposMarchados = new Set(ticket.courses.map((c) => c.course));
  // El tiempo 1 marcha al enviar, aunque sea el primer envío y no exista
  // todavía su fila en `ticket_courses` (la creamos abajo).
  tiemposMarchados.add(1);

  // ── La diferencia, agrupada por sección ─────────────────────────────
  interface LineaAEnviar {
    ticketLineId: string;
    nameSnapshot: string;
    units: number;
    unitsTotales: number;
    modifiers: Prisma.InputJsonValue | undefined;
    course: number;
    seat: number | null;
    allergens: Allergen[];
    marcha: boolean;
    aviso: string | null;
  }
  const porSeccion = new Map<KitchenSection, LineaAEnviar[]>();
  for (const line of ticket.lines) {
    const pendiente = u3(Number(line.units) - Number(line.sentUnits));
    if (pendiente <= 0) continue;
    const section = resolverSeccion(
      line.productId,
      etiquetasPorProducto,
      seccionPorEtiqueta,
    );
    const alergenosPlato = (line.product?.allergens ?? []) as Alergeno[];
    // Capa 3, el grito: sólo cuando el plato TIENE silla y lleva lo que esa
    // silla no puede comer. Un plato sin silla de una mesa alérgica se
    // marca «lleva gluten» en la pantalla, pero no grita: no se sabe de
    // quién es.
    const aviso =
      line.seat != null
        ? avisoChoque(
            choqueAlergenos(alergenosPlato, alergenosDeSilla(line.seat)),
          )
        : null;
    const entrada: LineaAEnviar = {
      ticketLineId: line.id,
      nameSnapshot: line.nameSnapshot,
      units: pendiente,
      unitsTotales: Number(line.units),
      modifiers: (line.modifiers ?? undefined) as Prisma.InputJsonValue | undefined,
      course: line.course,
      seat: line.seat,
      allergens: (line.product?.allergens ?? []) as Allergen[],
      marcha: marchaAlEnviar({ section, course: line.course, tiemposMarchados }),
      aviso,
    };
    const bucket = porSeccion.get(section);
    if (bucket) bucket.push(entrada);
    else porSeccion.set(section, [entrada]);
  }

  const issuedAt = new Date();

  if (porSeccion.size === 0) {
    // Nada nuevo. No se reserva `clientSendId`, no se sube la revisión y
    // no se crea nada: el terminal puede volver a pulsar «Enviar» con el
    // mismo id en cuanto añada algo.
    return {
      kind: "ok",
      http: 200,
      body: {
        revision: ticket.lastSentRevision,
        sentAt: issuedAt.toISOString(),
        clientSendId,
        urgent: opts.urgent === true,
        nothingNew: true,
        sections: [],
        replayed: false,
      },
    };
  }

  const revision = ticket.lastSentRevision + 1;
  const urgent = opts.urgent === true;

  // ── a · reservar el id ──────────────────────────────────────────────
  let dispatchId: string;
  try {
    const d = await prisma.kitchenDispatch.create({
      data: {
        tenantId: ctx.tenantId,
        ticketId: ticket.id,
        // Sin `clientSendId` del terminal (cliente viejo) se genera uno
        // aquí: la columna es NOT NULL porque un envío sin id no se puede
        // reintentar, y es mejor que el servidor ponga uno —que no protege
        // de nada— que tener la mitad de las filas sin llave.
        clientSendId: clientSendId ?? randomUUID(),
        revision,
        urgent,
        sentAt: issuedAt,
        sentByUserId: ctx.cashierId,
        result: EN_CURSO,
      },
      select: { id: true },
    });
    dispatchId = d.id;
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      // Carrera: otra petición del mismo envío se adelantó entre el
      // `findUnique` de arriba y este `create`.
      return { kind: "in-flight" };
    }
    throw err;
  }

  // ── b · imprimir, antes de marcar ───────────────────────────────────
  const cashierLabel = cashierLabelFrom(cashierUser);
  const fallosDeImpresion = new Map<KitchenSection, string>();
  for (const sec of SECCIONES) {
    const lineas = porSeccion.get(sec);
    if (!lineas || lineas.length === 0) continue;
    const destino = destinoDe(destinos, sec);
    if (!destino.impresora) continue;
    const printer = impresoraPorSeccion.get(sec)!;
    const payload: KitchenLineEscpos[] = lineas.map((l) => ({
      units: l.units,
      description: l.nameSnapshot,
      notes: notasDeModificadores(l.modifiers),
      seat: l.seat,
      course: l.course,
      allergyWarning: l.aviso,
    }));
    try {
      await sendOverTcp({
        host: printer.ipAddress!,
        port: printer.port ?? 9100,
        timeoutMs: printer.timeoutMs,
        payload: buildKitchenComanda({
          section: sec,
          tableName: ticket.table?.name ?? null,
          revision,
          issuedAt,
          cashierLabel,
          diners: ticket.diners,
          ticketNotes: ticket.notes,
          lines: payload,
          allergyBands: franjas,
          urgent,
        }),
      });
      await prisma.printerConfig.update({
        where: { id: printer.id },
        data: { lastPrintOkAt: new Date(), lastErrorAt: null, lastErrorMsg: null },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Error desconocido";
      fallosDeImpresion.set(sec, message);
      await prisma.printerConfig.update({
        where: { id: printer.id },
        data: { lastErrorAt: new Date(), lastErrorMsg: message.slice(0, 500) },
      });
    }
  }

  // ── c · la transacción que marca ────────────────────────────────────
  const secciones: SeccionEnviada[] = [];
  const paraEmitir: Array<{ orderId: string; section: KitchenSection }> = [];
  let cuerpo: CuerpoEnvio;

  cuerpo = await prisma.$transaction(async (tx) => {
    const lineasMarcadas = new Map<string, number>();

    for (const sec of SECCIONES) {
      const lineas = porSeccion.get(sec);
      if (!lineas || lineas.length === 0) continue;
      const destino = destinoDe(destinos, sec);
      const fallo = fallosDeImpresion.get(sec);
      const units = u3(lineas.reduce((a, l) => a + l.units, 0));

      // La impresora de esta sección falló: NO se marca nada de esta
      // sección como enviado. El camarero vuelve a pulsar «Enviar» y la
      // diferencia sigue siendo la misma. Si la sección tiene ADEMÁS
      // pantalla, la tarjeta sí se crea —la cocina ya lo sabe— y entonces
      // sí se marca: ver `huboDestinoVivo`.
      const huboDestinoVivo =
        destino.pantalla || (destino.impresora && !fallo) || tipoNinguno(destino);

      let orderId: string | undefined;
      if (destino.pantalla) {
        const order = await tx.kitchenOrder.create({
          data: {
            dispatchId,
            ticketId: ticket.id,
            storeId,
            tableId: ticket.tableId,
            tableName: ticket.table?.name ?? null,
            section: sec,
            number: revision,
            urgent,
            urgentAt: urgent ? issuedAt : null,
            sentAt: issuedAt,
            lines: {
              create: lineas.map((l) => ({
                ticketLineId: l.ticketLineId,
                nameSnapshot: l.nameSnapshot,
                units: new Prisma.Decimal(l.units),
                modifiers: l.modifiers,
                course: l.course,
                seat: l.seat,
                allergens: l.allergens,
                firedAt: l.marcha ? issuedAt : null,
              })),
            },
          },
          select: { id: true },
        });
        orderId = order.id;
        paraEmitir.push({ orderId: order.id, section: sec });
      }

      if (huboDestinoVivo) {
        for (const l of lineas) {
          lineasMarcadas.set(l.ticketLineId, l.unitsTotales);
        }
      }

      secciones.push({
        section: sec,
        destino: tipoDestino(destino),
        ok: !fallo,
        lineCount: lineas.length,
        units,
        ...(orderId ? { orderId } : {}),
        ...(fallo ? { error: fallo } : {}),
      });
    }

    // `sentUnits = units` y no `+= diferencia`: el camino es idempotente.
    for (const [lineId, total] of lineasMarcadas) {
      await tx.ticketLine.update({
        where: { id: lineId },
        data: { sentUnits: new Prisma.Decimal(total) },
      });
    }

    // El tiempo 1 marcha al enviar (decisión 3). `skipDuplicates` porque
    // en la 2ª comanda de la mesa ya existe y su `firedAt` —el instante
    // desde el que cuenta el semáforo del primer bloque— no se mueve.
    if (lineasMarcadas.size > 0) {
      await tx.ticketCourse.createMany({
        data: [
          { ticketId: ticket.id, course: 1, firedAt: issuedAt, firedByUserId: ctx.cashierId },
        ],
        skipDuplicates: true,
      });
      await tx.ticket.update({
        where: { id: ticket.id },
        data: { lastSentAt: issuedAt, lastSentRevision: revision },
      });
    }

    // La revisión sólo sube si algo se marcó como enviado. Un envío en el
    // que la única sección tenía impresora y la impresora falló no gasta
    // el número de comanda: la 2ª comanda sigue siendo la 2ª.
    const body: CuerpoEnvio = {
      revision: lineasMarcadas.size > 0 ? revision : ticket.lastSentRevision,
      sentAt: issuedAt.toISOString(),
      clientSendId,
      urgent,
      nothingNew: false,
      sections: secciones,
      replayed: false,
    };
    await tx.kitchenDispatch.update({
      where: { id: dispatchId },
      data: { result: body as unknown as Prisma.InputJsonValue },
    });
    return body;
  });

  // Los eventos van FUERA de la transacción: son avisos, y la verdad está
  // en el GET de cocina. Emitirlos dentro haría que una pantalla pidiera
  // el GET antes del commit y no viera su propia comanda.
  for (const e of paraEmitir) {
    emitirComandaCreada({
      storeId,
      orderId: e.orderId,
      section: e.section,
      ticketId: ticket.id,
      tableId: ticket.tableId,
      tableName: ticket.table?.name ?? null,
      number: revision,
      urgent,
      at: issuedAt,
    });
  }

  // 502 sólo si TODO falló. Un fallo parcial (la impresora de la barra
  // está desenchufada pero la pantalla de cocina tiene las bravas) es un
  // 200 con `ok: false` en esa sección: media comanda llegó y el camarero
  // tiene que verlo, no recibir un error que tape el acierto.
  const todoFalla = secciones.length > 0 && secciones.every((s) => !s.ok);
  return { kind: "ok", http: todoFalla ? 502 : 200, body: cuerpo };
}

function tipoNinguno(d: DestinoSeccion): boolean {
  return !d.pantalla && !d.impresora;
}

function tipoDestino(d: DestinoSeccion): TipoDestino {
  if (d.pantalla && d.impresora) return "PANTALLA_E_IMPRESORA";
  if (d.pantalla) return "PANTALLA";
  if (d.impresora) return "IMPRESORA";
  return "NINGUNO";
}

/**
 * Los dos shapes históricos de `TicketLine.modifiers` aplanados a texto.
 *
 * Copiado de `tickets/kitchen-dispatch.ts` sin cambios funcionales: el
 * legacy `string[]` del modificador tipeado a mano sigue vivo en barras
 * pequeñas y en tickets históricos.
 */
export function notasDeModificadores(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const entry of raw) {
    if (typeof entry === "string") {
      out.push(entry);
      continue;
    }
    if (entry && typeof entry === "object") {
      const e = entry as { label?: unknown; groupName?: unknown };
      const label = typeof e.label === "string" ? e.label : null;
      const group = typeof e.groupName === "string" ? e.groupName : null;
      if (label && group) out.push(`${group}: ${label}`);
      else if (label) out.push(label);
    }
  }
  return out;
}
