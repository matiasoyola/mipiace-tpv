// B-reservas-8 · LA VENTA de un bono.
//
// Qué es un bono en el catálogo (decisión de Dirección, 18-10): un producto
// normal con una PLANTILLA colgando. Venderlo es añadir ese producto al
// ticket, así que el precio y el IVA van por el camino de siempre y no hay
// un segundo sitio donde se fije el precio de un bono. Un bono de servicios
// exentos se vende exento porque lo hace ya `exemptionCause` del producto:
// aquí no se toca nada de eso.
//
// ── Las tres reglas de la venta ────────────────────────────────────────
//
//   1. **El bono NACE cuando el ticket pasa a `PAID`**, en la misma
//      transacción, con su `soldTicketId` y su `soldTicketLineId`. Un
//      ticket que no se cobra no gasta número. Es la misma regla que el
//      spa aprendió con los cheques web («el dinero nace sólo con el
//      webhook»: quien cierra la pestaña no gasta número).
//   2. **Vender un bono exige cliente en el ticket.** Sin ficha no se sabe
//      a quién se le debe la sesión, y el bono es de una ficha (S6). El
//      TPV lo pide ANTES de cobrar; esta capa lo vuelve a comprobar.
//   3. **Dinero y deuda, separados** (`07` pieza 1): se congelan el VALOR
//      DE CARTA (lo que el centro debe) y LO COBRADO (lo que entró). Un
//      bono regalado vale lo de carta en sesiones. El libro no duplica el
//      cobro: lo enlaza con `soldTicketId`.

import { fechaCorta } from "@mipiacetpv/bonos";
import { Prisma } from "@mipiacetpv/db";

import { calcularCaducidad, diaDeCaducidad } from "./caducidad.js";
import { escribirLinea } from "./libro.js";
import { siguienteNumero } from "./numero.js";

/** La plantilla de bono de un producto, como la necesita la venta. */
export interface PlantillaDeBono {
  templateId: string;
  productId: string;
  nombre: string;
  sessions: number;
  coversServiceIds: string[];
  coversTagSlugs: string[];
  expiresMonths: number | null;
  /** Precio de CARTA del producto, en céntimos. Es «lo que el centro debe». */
  valorCartaCents: number;
}

/**
 * Las plantillas de los productos de una lista. Una sola consulta: esto
 * corre en el camino de cobro de TODOS los tickets de una cuenta con bonos,
 * así que no puede ser una consulta por línea.
 *
 * Devuelve un `Map` vacío sin tocar la base cuando no hay productos — que
 * es el caso de una venta de bar entera.
 */
export async function plantillasDeLosProductos(
  tx: Prisma.TransactionClient,
  tenantId: string,
  productIds: Array<string | null | undefined>,
): Promise<Map<string, PlantillaDeBono>> {
  const ids = [...new Set(productIds.filter((x): x is string => !!x))];
  if (ids.length === 0) return new Map();
  const filas = await tx.$queryRaw<
    Array<{
      template_id: string;
      product_id: string;
      nombre: string;
      sessions: number;
      covers_service_ids: string[];
      covers_tag_slugs: string[];
      expires_months: number | null;
      base_price: Prisma.Decimal;
    }>
  >`
    SELECT vt."id"                 AS template_id,
           vt."product_id"         AS product_id,
           p."name"                AS nombre,
           vt."sessions"           AS sessions,
           vt."covers_service_ids" AS covers_service_ids,
           vt."covers_tag_slugs"   AS covers_tag_slugs,
           vt."expires_months"     AS expires_months,
           p."base_price"          AS base_price
      FROM "voucher_templates" vt
      JOIN "products" p ON p."id" = vt."product_id"
     WHERE vt."tenant_id" = ${tenantId}::uuid
       AND vt."product_id" = ANY(${ids}::uuid[])`;
  return new Map(
    filas.map((f) => [
      f.product_id,
      {
        templateId: f.template_id,
        productId: f.product_id,
        nombre: f.nombre,
        sessions: Number(f.sessions),
        coversServiceIds: f.covers_service_ids,
        coversTagSlugs: f.covers_tag_slugs,
        expiresMonths: f.expires_months == null ? null : Number(f.expires_months),
        valorCartaCents: Math.round(Number(f.base_price) * 100),
      },
    ]),
  );
}

/** Una línea del ticket que resultó ser un bono. */
export interface LineaDeBono {
  ticketLineId: string;
  plantilla: PlantillaDeBono;
  /** Cuántos bonos. Entero: medio bono no existe. */
  unidades: number;
  /** Lo que se cobró por CADA uno, en céntimos. */
  cobradoCentsPorUnidad: number;
}

export interface NacerBonosInput {
  tenantId: string;
  ticketId: string;
  clientId: string;
  lineas: LineaDeBono[];
  /** Caducidad por defecto del centro, en meses. La plantilla manda. */
  caducidadMesesPorDefecto: number | null;
  /** `07` pieza 17 · un bono vendido en un ticket `TEST` nace de prueba. */
  esPrueba: boolean;
  userId: string | null;
  ahora: Date;
}

export interface BonoNacido {
  id: string;
  code: string;
  number: number;
  nombre: string;
  sesiones: number;
  ticketLineId: string;
}

export type ResultadoNacer =
  | { ok: true; bonos: BonoNacido[] }
  /** El candado de primer uso: este centro todavía no ha confirmado por
   *  qué número empieza su talonario. */
  | { ok: false; error: "CANDADO_SIN_CONFIRMAR" };

/**
 * Crea los bonos de un ticket que acaba de cobrarse, **dentro de su
 * transacción**.
 *
 * El número se reserva con `siguienteNumero()`, que va también dentro: si
 * algo posterior revienta, el contador hace rollback y no deja huecos (el
 * mismo patrón que `register.ticketCounter`).
 *
 * ── El candado de primer uso ──────────────────────────────────────────
 *
 * Se devuelve como resultado y no como excepción para que el llamante
 * decida; lo que todos los llamantes hacen es **abortar la transacción**,
 * así que el cobro no pasa.
 *
 * La primera versión de este bloque lo dejaba cobrar y no emitía el bono,
 * apoyándose en «cobrar siempre se puede». Era un error y está corregido:
 * eso deja a la clienta **pagada y sin bono** —el dinero entra y la deuda
 * no queda en ningún sitio—. «Cobrar siempre se puede» vale para lo que ya
 * se vendió, no para dejar que se venda algo que no se puede entregar.
 *
 * La puerta de verdad está mucho antes: **con el candado puesto no se
 * puede ni añadir un bono al ticket** (`POST /tables/:id/lines` y
 * `prepararBonosDeLaVenta`). Aquí sólo se llega si el candado se puso
 * entre que se añadió la línea y que se cobró.
 */
export async function nacerLosBonos(
  tx: Prisma.TransactionClient,
  input: NacerBonosInput,
): Promise<ResultadoNacer> {
  const bonos: BonoNacido[] = [];
  for (const linea of input.lineas) {
    for (let i = 0; i < linea.unidades; i += 1) {
      const num = await siguienteNumero(tx, input.tenantId);
      if (!num.ok) return { ok: false, error: num.error };
      const meses =
        linea.plantilla.expiresMonths ?? input.caducidadMesesPorDefecto ?? null;
      const expiresAt = calcularCaducidad(input.ahora, meses);
      const nombre = `${linea.plantilla.nombre} · ${linea.plantilla.sessions} ${
        linea.plantilla.sessions === 1 ? "sesión" : "sesiones"
      }`;
      const filas = await tx.$queryRaw<Array<{ id: string }>>`
        INSERT INTO "vouchers"
          ("id", "tenant_id", "client_id", "code", "number", "template_id",
           "type", "sessions_total", "sessions_left", "sessions_reserved",
           "covers_service_ids", "covers_tag_slugs", "name_snapshot",
           "valor_carta_cents", "cobrado_cents", "sold_ticket_id",
           "sold_ticket_line_id", "expires_at", "status", "origen",
           "es_prueba", "created_at", "updated_at")
        VALUES
          (gen_random_uuid(), ${input.tenantId}::uuid, ${input.clientId}::uuid,
           ${num.code}, ${num.numero}, ${linea.plantilla.templateId}::uuid,
           'SESSIONS', ${linea.plantilla.sessions}, ${linea.plantilla.sessions}, 0,
           ${linea.plantilla.coversServiceIds}::uuid[],
           ${linea.plantilla.coversTagSlugs}::text[],
           ${nombre},
           ${linea.plantilla.valorCartaCents}, ${linea.cobradoCentsPorUnidad},
           ${input.ticketId}::uuid, ${linea.ticketLineId}::uuid,
           ${expiresAt}, 'ACTIVO', 'VENTA', ${input.esPrueba},
           ${input.ahora}, ${input.ahora})
        RETURNING "id"`;
      const id = filas[0]!.id;
      await escribirLinea(tx, {
        tenantId: input.tenantId,
        voucherId: id,
        tipo: "VENDIDO",
        sesiones: linea.plantilla.sessions,
        ticketLineId: linea.ticketLineId,
        detalle:
          `Vendido · ${nombre} · ${num.code}` +
          (expiresAt
            ? ` · caduca el ${fechaCorta(diaDeCaducidad(expiresAt)!)}`
            : " · sin caducidad"),
        canal: "tpv",
        userId: input.userId,
        actor: input.userId == null ? "Migración" : null,
        esPrueba: input.esPrueba,
        createdAt: input.ahora,
      });
      bonos.push({
        id,
        code: num.code,
        number: num.numero,
        nombre,
        sesiones: linea.plantilla.sessions,
        ticketLineId: linea.ticketLineId,
      });
    }
  }
  return { ok: true, bonos };
}

