// B-reservas-8 · lo que el camino de cobro necesita saber de los bonos
// ANTES de calcular los totales.
//
// Este fichero existe para que `tickets/routes.ts` no engorde: el camino de
// cobro ya es el más largo de la casa y lo que este bloque le añade son
// cuatro líneas y una llamada aquí. Mismo criterio que `clinica-3` con
// `lineasDeLaSesionCerrada`.
//
// Dos cosas, y las dos se resuelven antes de la transacción porque las dos
// cambian el IMPORTE de una línea:
//
//   1. **Qué líneas son VENTAS de bono** (un producto con plantilla). Si
//      hay alguna y el ticket no trae ficha, se rechaza antes de cobrar:
//      vender un bono exige cliente en el ticket (S6).
//   2. **Qué líneas son CANJES** (`voucherId` en la línea). El importe lo
//      pone el servidor desde `Tenant.bonoModoCanje` —el frente P5—, y lo
//      que llegue del navegador en `unitPrice` para esa línea se ignora.
//
// Lo que NO se hace aquí: escribir. El bono nace y la sesión se consume
// dentro de la transacción del cobro, cuando el ticket ya es una venta.

import type { Prisma, PrismaClient } from "@mipiacetpv/db";

import { estaCaducado } from "./caducidad.js";
import { importeDeLaLineaCents, type ModoCanje } from "./canje.js";
import { resolverCobertura } from "./cobertura.js";
import {
  candadoPuesto,
  CANDADO_ERROR,
  CANDADO_MENSAJE,
} from "./numero.js";
import { serviciosACubrir } from "./servicios.js";
import { plantillasDeLosProductos, type PlantillaDeBono } from "./venta.js";

/** Los ajustes del centro que este camino necesita. Estructural, para que
 *  valga desde un `select` parcial y desde un test. */
export interface AjustesDeBonos {
  bonosEnabled: boolean;
  bonoCaducidadMeses: number | null;
  bonoModoCanje: string;
}

export interface LineaDeLaVenta {
  productId?: string | null;
  units: number;
  voucherId?: string | null;
}

/** Una línea que es la VENTA de un bono. */
export interface VentaDeBono {
  indice: number;
  plantilla: PlantillaDeBono;
  unidades: number;
}

/** Una línea que CANJEA una sesión. El importe ya resuelto por el servidor. */
export interface CanjeDeLinea {
  indice: number;
  voucherId: string;
  code: string;
  importeCents: number;
}

export type ResultadoPreparar =
  | {
      ok: true;
      ventas: VentaDeBono[];
      canjes: CanjeDeLinea[];
    }
  | { ok: false; status: number; error: string; message: string };

/**
 * Resuelve los bonos de una venta antes de cobrarla.
 *
 * Con `bonosEnabled = false` y sin ninguna línea de bono —el caso de los
 * quince tenants de hoy— devuelve dos listas vacías **sin tocar la base**.
 */
export async function prepararBonosDeLaVenta(
  prisma: PrismaClient,
  input: {
    tenantId: string;
    clientId: string | null;
    lineas: LineaDeLaVenta[];
    ajustes: AjustesDeBonos;
    ahora: Date;
  },
): Promise<ResultadoPreparar> {
  const pideCanje = input.lineas.some((l) => l.voucherId);
  if (!input.ajustes.bonosEnabled) {
    // Sin el módulo encendido, una línea que pide canje es un cliente
    // equivocado. Se dice en vez de cobrarla a 0 € o de cobrarla entera en
    // silencio: las dos serían un cobro que nadie quiso.
    if (pideCanje) {
      return {
        ok: false,
        status: 409,
        error: "BONOS_DISABLED",
        message:
          "Este negocio no tiene los bonos encendidos, así que no se puede canjear ninguno.",
      };
    }
    return { ok: true, ventas: [], canjes: [] };
  }

  // ── 1 · las VENTAS de bono ──────────────────────────────────────────
  const plantillas = await plantillasDeLosProductos(
    prisma,
    input.tenantId,
    input.lineas.map((l) => l.productId),
  );
  const ventas: VentaDeBono[] = [];
  for (const [indice, linea] of input.lineas.entries()) {
    const plantilla = linea.productId
      ? plantillas.get(linea.productId)
      : undefined;
    if (!plantilla) continue;
    if (!Number.isInteger(linea.units) || linea.units < 1) {
      return {
        ok: false,
        status: 400,
        error: "BONO_UNIDADES_NO_ENTERAS",
        message: `«${plantilla.nombre}» es un bono: se venden de uno en uno, no ${linea.units}.`,
      };
    }
    ventas.push({ indice, plantilla, unidades: linea.units });
  }
  if (ventas.length > 0 && !input.clientId) {
    return {
      ok: false,
      status: 409,
      error: "BONO_SIN_CLIENTE",
      message:
        "Para vender un bono hace falta la ficha de la clienta: el bono es de una ficha y hay que saber a quién se le deben las sesiones.",
    };
  }
  // EL CANDADO, como DEFENSA.
  //
  // La puerta de verdad está en el alta de la línea —`POST
  // /tables/:id/lines`—, que es donde la cajera puede hacer algo. Esto
  // cubre el camino que no pasa por un borrador: la venta rápida, que
  // llega con sus líneas ya hechas en el cuerpo.
  //
  // Y se RECHAZA el cobro. Cobrarlo y no emitir el bono dejaría a la
  // clienta pagada y sin bono: el dinero entra y la deuda no queda en
  // ningún sitio.
  if (ventas.length > 0 && (await candadoPuesto(prisma, input.tenantId))) {
    return {
      ok: false,
      status: 409,
      error: CANDADO_ERROR,
      message: CANDADO_MENSAJE,
    };
  }

  // ── 2 · los CANJES ──────────────────────────────────────────────────
  if (!pideCanje) return { ok: true, ventas, canjes: [] };
  if (!input.clientId) {
    return {
      ok: false,
      status: 409,
      error: "BONO_SIN_CLIENTE",
      message:
        "Para canjear un bono hace falta la ficha de la clienta en el ticket: el bono es de una ficha.",
    };
  }
  const canjes: CanjeDeLinea[] = [];
  for (const [indice, linea] of input.lineas.entries()) {
    if (!linea.voucherId) continue;
    if (!linea.productId) {
      return {
        ok: false,
        status: 409,
        error: "BONO_LINEA_LIBRE",
        message:
          "Un bono se canjea contra un servicio del catálogo, no contra una línea libre.",
      };
    }
    const filas = await prisma.$queryRaw<
      Array<{
        id: string;
        code: string;
        client_id: string;
        sessions_total: number;
        sessions_left: number;
        valor_carta_cents: number;
        covers_service_ids: string[];
        covers_tag_slugs: string[];
        expires_at: Date | null;
        status: string;
      }>
    >`
      SELECT "id", "code", "client_id", "sessions_total", "sessions_left",
             "valor_carta_cents", "covers_service_ids", "covers_tag_slugs",
             "expires_at", "status"
        FROM "vouchers"
       WHERE "id" = ${linea.voucherId}::uuid
         AND "tenant_id" = ${input.tenantId}::uuid
       LIMIT 1`;
    const b = filas[0];
    if (!b) {
      return {
        ok: false,
        status: 404,
        error: "BONO_NOEXISTE",
        message: "No existe ese bono en este negocio.",
      };
    }
    if (b.client_id !== input.clientId) {
      return {
        ok: false,
        status: 409,
        error: "BONO_OTRO_CLIENTE",
        message:
          "Ese bono es de otra ficha. Comprueba el número, o busca la ficha a la que pertenece.",
      };
    }
    if (b.status === "ANULADO") {
      return {
        ok: false,
        status: 409,
        error: "BONO_ANULADO",
        message: "Ese bono se anuló al devolver su venta.",
      };
    }
    if (estaCaducado(b.expires_at, input.ahora)) {
      return {
        ok: false,
        status: 409,
        error: "BONO_CADUCADO",
        message:
          "Ese bono está caducado. El encargado puede prolongarlo desde la ficha, dejando el motivo.",
      };
    }
    if (Number(b.sessions_left) <= 0) {
      return {
        ok: false,
        status: 409,
        error: "BONO_AGOTADO",
        message: "Ese bono no tiene sesiones libres.",
      };
    }
    const [servicio] = await serviciosACubrir(prisma, input.tenantId, [
      linea.productId,
    ]);
    if (
      !servicio ||
      !resolverCobertura(
        {
          coversServiceIds: b.covers_service_ids,
          coversTagSlugs: b.covers_tag_slugs,
        },
        servicio,
      ).cubre
    ) {
      return {
        ok: false,
        status: 409,
        error: "BONO_NO_CUBRE",
        message:
          "Ese bono no vale para este servicio. Mira en la ficha para qué sirve.",
      };
    }
    canjes.push({
      indice,
      voucherId: b.id,
      code: b.code,
      importeCents: importeDeLaLineaCents(
        input.ajustes.bonoModoCanje as ModoCanje,
        {
          valorCartaCents: Number(b.valor_carta_cents),
          sesionesTotal: Number(b.sessions_total),
        },
      ),
    });
  }
  return { ok: true, ventas, canjes };
}

// ══════════════════════════════════════════════════════════════════════
// LAS VENTAS DE BONO DE UN BORRADOR
// ══════════════════════════════════════════════════════════════════════

/**
 * Qué líneas de un borrador ya escrito son ventas de bono.
 *
 * El camino del borrador (mesas, y el cobro de una cita) no tiene las
 * líneas en el cuerpo de la petición: están en la base, porque la cajera
 * las fue añadiendo. Así que la venta se resuelve LEYENDO el borrador,
 * dentro de la transacción del cobro.
 *
 * Lo COBRADO por cada bono sale del TOTAL de su línea repartido entre las
 * unidades: es lo que entró de verdad, con su descuento si lo hubo. El
 * precio de carta lo guarda el bono aparte (`07` pieza 1: dinero y deuda
 * van por separado).
 */
export async function ventasDeBonoEnElBorrador(
  tx: Prisma.TransactionClient,
  input: { tenantId: string; ticketId: string },
): Promise<
  Array<{
    ticketLineId: string;
    plantilla: PlantillaDeBono;
    unidades: number;
    cobradoCentsPorUnidad: number;
  }>
> {
  const lineas = await tx.$queryRaw<
    Array<{
      id: string;
      product_id: string | null;
      units: Prisma.Decimal;
      total: Prisma.Decimal;
    }>
  >`
    SELECT "id", "product_id", "units", "total"
      FROM "ticket_lines"
     WHERE "ticket_id" = ${input.ticketId}::uuid`;
  const plantillas = await plantillasDeLosProductos(
    tx,
    input.tenantId,
    lineas.map((l) => l.product_id),
  );
  if (plantillas.size === 0) return [];
  const out: Array<{
    ticketLineId: string;
    plantilla: PlantillaDeBono;
    unidades: number;
    cobradoCentsPorUnidad: number;
  }> = [];
  for (const l of lineas) {
    const plantilla = l.product_id ? plantillas.get(l.product_id) : undefined;
    if (!plantilla) continue;
    // Un bono se vende de uno en uno. Si alguien dejó 1,5 en la línea, se
    // redondea HACIA ABAJO y se emite lo entero: la alternativa es tumbar
    // un cobro ya pulsado por una unidad que nadie pudo teclear desde el
    // TPV (el teclado de cantidad de un servicio sólo da enteros).
    const unidades = Math.max(1, Math.floor(Number(l.units)));
    out.push({
      ticketLineId: l.id,
      plantilla,
      unidades,
      cobradoCentsPorUnidad: Math.round((Number(l.total) / unidades) * 100),
    });
  }
  return out;
}
