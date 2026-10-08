// Endpoints catálogo expuestos al TPV (cajero, requireCashierSession).
// Sólo lectura. Devuelven sólo lo que el TPV necesita para pintar la
// pantalla de venta (B4 §2).

import type { FastifyInstance } from "fastify";
import { Prisma, type TicketStatus } from "@mipiacetpv/db";

import { requireCashierSession } from "../shift/cashier-session.js";
import { getPrisma } from "../context.js";
import { getTenantHealthStatus } from "../tickets/health.js";
import { CAJA_DISABLED_MESSAGE, ensureCajaEnabled } from "../lib/caja-gate.js";
import { brutoDesdeNeto } from "../catalog/local-product-rules.js";
import { CENTER_TZ } from "../agenda/time.js";

// ──────────────────────────────────────────────────────────────────────
// v2-H1-venta-y-sala §3 · los parámetros de la vista «Ahora».
//
// Van aquí arriba y con nombre porque son los tres números que un
// implantador querrá mover si «Ahora» no acierta en un local concreto, y
// porque el test de la ruta los lee en vez de repetirlos.
// ──────────────────────────────────────────────────────────────────────

/** Cuántos productos trae «Ahora». Es el 4 × 5 de la maqueta. */
const NOW_LIMIT = 20;

/**
 * Media anchura de la franja, en horas. ±1 h sobre la hora actual, o
 * sea tres horas de muestra.
 *
 * Con una sola hora un bar tranquilo entre semana no junta ventas
 * suficientes para que el orden signifique algo; con ±2 la franja del
 * desayuno se mezcla con la del aperitivo, que es lo que esta vista
 * viene a separar.
 */
const NOW_BAND_HOURS = 1;

/**
 * Profundidad de la muestra, en días. **Cuatro semanas exactas**, para
 * que haya el mismo número de lunes que de sábados: con 30 días dos días
 * de la semana pesan un 25 % más que los otros cinco, y en un bar el
 * sábado no se pide lo que el martes.
 */
const NOW_WINDOW_DAYS = 28;

/** La zona del local. La misma que usa el resto del sistema. */
const NOW_TZ = CENTER_TZ;

/**
 * El relleno de «Ahora»: los primeros productos de cada familia, en su
 * orden, repartiendo por turnos (uno de cada familia, luego el segundo
 * de cada una…).
 *
 * Por turnos y no familia a familia: con 9 familias y 20 huecos,
 * volcarlas en orden dejaría «Ahora» con los veinte productos de las dos
 * primeras familias alfabéticas y ninguno del resto. Un comercio nuevo
 * abriría el TPV y vería veinte cafés — peor que una pantalla vacía,
 * porque parece que el catálogo está mal cargado.
 *
 * «Su orden» es el del catálogo (`name: asc`), que es el mismo con el que
 * `/tpv/catalog/products` alimenta la rejilla: lo que «Ahora» ofrece de
 * relleno está en el mismo sitio relativo que en su familia.
 */
async function firstOfEachFamily(
  prisma: ReturnType<typeof getPrisma>,
  tenantId: string,
  needed: number,
  exclude: Set<string>,
): Promise<Array<{ productId: string; units: number }>> {
  if (needed <= 0) return [];
  const products = await prisma.product.findMany({
    where: {
      tenantId,
      active: true,
      sellableViaTpv: true,
      sku: { not: null },
    },
    orderBy: { name: "asc" },
    select: { id: true, tags: true },
  });

  // Un producto puede llevar varios tags en Holded (`cafes` + `favoritos`
  // + `desayuno`). Se le asigna el PRIMERO, que es el mismo criterio con
  // el que el TPV decide de qué familia es el botón: si aquí dijéramos
  // otra cosa, el relleno saldría de una familia y el botón se pintaría
  // del color de otra.
  const byFamily = new Map<string, string[]>();
  for (const p of products) {
    if (exclude.has(p.id)) continue;
    const family = p.tags[0] ?? "";
    const bucket = byFamily.get(family);
    if (bucket) bucket.push(p.id);
    else byFamily.set(family, [p.id]);
  }

  // Familias en orden alfabético para que el relleno de un comercio no
  // cambie de un día para otro sin que su catálogo haya cambiado.
  const families = [...byFamily.keys()].sort();
  const out: Array<{ productId: string; units: number }> = [];
  let round = 0;
  while (out.length < needed) {
    let addedThisRound = false;
    for (const family of families) {
      if (out.length >= needed) break;
      const id = byFamily.get(family)?.[round];
      if (!id) continue;
      // `units: 0` dice la verdad: este producto NO está aquí por ventas.
      out.push({ productId: id, units: 0 });
      addedThisRound = true;
    }
    if (!addedThisRound) break; // se agotó el catálogo antes que los huecos
    round += 1;
  }
  return out;
}

export async function registerTpvCatalogRoutes(app: FastifyInstance): Promise<void> {
  // Catálogo paginado. El TPV cachea el resultado en IndexedDB la primera
  // vez (B4 §2.2); refresca cuando el banner "Sincronizando" llega.
  // H1 · esta ruta NO lleva `ensureCajaEnabled` como preHandler, y es la
  // única del módulo que no lo lleva. La puerta va dentro del handler,
  // sobre el tenant que la primera página ya lee de todas formas: un
  // preHandler añadiría una consulta por CADA cursor de paginación, que
  // es exactamente lo que el comentario de abajo evita desde B4. El
  // cajero no puede llegar aquí sin haber cruzado `/shift/cashier-login`,
  // que sí la lleva.
  app.get(
    "/tpv/catalog/products",
    {
      preHandler: requireCashierSession,
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            cursor: { type: "string", format: "uuid" },
            limit: { type: "integer", minimum: 1, maximum: 1000 },
          },
        },
      },
    },
    async (request, reply) => {
      const cashier = request.cashier!;
      const q = request.query as { cursor?: string; limit?: number };
      const limit = q.limit ?? 500;
      const prisma = getPrisma();
      // B-Multi-Vertical SB3: el TPV necesita saber el vertical para
      // decidir si renderiza TableMapScreen y qué icono placeholder
      // mostrar. Sólo lo leemos en la primera página (cursor vacío) para
      // no pegarle a la BD en cada cursor de paginación; el TPV cachea
      // el valor en localStorage al primer pull.
      const tenant = q.cursor
        ? null
        : await prisma.tenant.findUnique({
            where: { id: cashier.tid },
            select: {
              businessType: true,
              tpvIconPreset: true,
              creditSalesEnabled: true,
              crmEnabled: true,
              agendaEnabled: true,
              // catalogo-local (addendum 3) · el TPV necesita saber si el
              // comercio USA Holded, no si lo tiene conectado. Lo pide una
              // sola frase, la del catálogo vacío, y por eso no había
              // manera de acertarla sin este dato: mandaba al cajero a
              // configurar sus productos en un ERP que no existe.
              holdedEnabled: true,
              // H1 (ADR-016) · sirve para dos cosas a la vez: cerrar la
              // puerta aquí mismo y viajar al TPV para que esconda lo
              // que no aplica. La puerta es ésta; el flag cacheado es UI.
              cajaEnabled: true,
              // clinica-2 · el TPV lo cachea con sus hermanos para decidir
              // si ENSEÑA la pestaña «Valoración» en la ficha del paciente.
              // Es UI y no una puerta: las rutas clínicas llevan su gate y
              // contestan la 404 de Fastify con el módulo apagado
              // (clinica-1 §1). Lo que se gana es no pintarle a un bar una
              // pestaña que le cuenta que este sistema guarda datos de
              // salud de otros clientes.
              clinicalRecordsEnabled: true,
            },
          });
      if (tenant?.cajaEnabled === false) {
        return reply.code(403).send({
          error: "CAJA_DISABLED",
          message: CAJA_DISABLED_MESSAGE,
        });
      }
      // v1.3-Operativa-Extra · Lote 1: mapa slug→label editable desde el
      // admin. Sólo se devuelve en la primera página para que el TPV lo
      // cachee junto al businessType/iconPreset; las páginas siguientes
      // aplican el cache ya cargado.
      const tagAliases = q.cursor
        ? null
        : await prisma.tagAlias.findMany({
            where: { tenantId: cashier.tid },
            select: { slug: true, label: true },
          });
      const products = await prisma.product.findMany({
        where: {
          tenantId: cashier.tid,
          active: true,
          sellableViaTpv: true,
          sku: { not: null },
        },
        orderBy: { name: "asc" },
        take: limit + 1,
        ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
        select: {
          id: true,
          holdedProductId: true,
          name: true,
          sku: true,
          barcode: true,
          basePrice: true,
          taxRate: true,
          // iva-exento-sanitario · la causa de exención del producto.
          // ÉSTE es el camino por el que la quiropodia de Rosario llega al
          // carrito con su exención puesta: sin ella la línea entraría
          // como 0 % SUJETO, que ante la AEAT es otra operación.
          exemptionCause: true,
          kind: true,
          imageMime: true,
          // B-Categorias-via-Tags: el TPV usa los tags para filtrar la
          // grid de productos con los chips de categoría. Si Holded no
          // envía tags, el campo llega como [] y los chips quedan vacíos.
          tags: true,
          // B-reservas-2: duración de agenda del servicio (overlay local
          // sobre el product de Holded). El TPV la pinta informativa por
          // línea de servicio cuando el tenant tiene `agendaEnabled`. Null
          // si el servicio no tiene fila `service_scheduling`.
          scheduling: { select: { durationMin: true } },
        },
      });
      const hasMore = products.length > limit;
      const items = (hasMore ? products.slice(0, limit) : products).map((p) => ({
        id: p.id,
        holdedProductId: p.holdedProductId,
        name: p.name,
        sku: p.sku!,
        barcode: p.barcode,
        basePrice: Number(p.basePrice),
        // Precio CON IVA — lo que se muestra en pantalla. El TPV
        // re-calcula al construir el ticket.
        //
        // catalogo-en-alta · la multiplicación estaba escrita aquí a
        // mano. Ahora sale de `brutoDesdeNeto`, la MISMA función con la
        // que el panel convierte el precio que se teclea y con la que el
        // importador convierte la columna `precio_con_iva` del fichero.
        // Tres sitios, una fórmula.
        priceGross: brutoDesdeNeto(Number(p.basePrice), Number(p.taxRate)),
        taxRate: Number(p.taxRate),
        // Con exención `priceGross === basePrice`: `brutoDesdeNeto` divide
        // por `1 + 0/100`, así que el precio del catálogo ES el que paga
        // la paciente (decisión 4 del bloque) sin ningún caso especial.
        exemptionCause: p.exemptionCause,
        kind: p.kind,
        // B-ProductImages: si el worker ya cacheó la imagen, devolvemos
        // el MIME. El TPV usa este campo como gate para renderizar
        // `<img>`; null → placeholder. El tenantId va en el JWT del
        // cajero, así que el front construye la URL final.
        imageMime: p.imageMime,
        tags: p.tags,
        // B-reservas-2: sólo los servicios con overlay de agenda traen
        // duración; el resto (productos, servicios sin scheduling) va
        // como null y el TPV no pinta nada.
        durationMin: p.scheduling?.durationMin ?? null,
      }));
      return {
        items,
        nextCursor: hasMore ? items[items.length - 1]!.id : null,
        // tenantId aquí para que el TPV no tenga que decodificar el
        // JWT en cliente (lo hace el backend en validación).
        tenantId: cashier.tid,
        // Sólo presente en la primera página. El TPV lo cachea al primer
        // pull (cursor vacío) y lo reusa hasta el siguiente refresh
        // completo del catálogo. Si el tenant cambia de vertical desde
        // el super-admin, basta con que el cajero refresque para que el
        // valor caché se actualice.
        ...(tenant
          ? {
              businessType: tenant.businessType,
              // v1.3-hotfix6 · subvertical para que el TPV elija icono
              // placeholder (peluquería→tijeras, clínica→estetoscopio,
              // taller→llave inglesa, belleza→sparkles, etc.).
              tpvIconPreset: tenant.tpvIconPreset ?? null,
              // v1.8-Fiado · el TPV cachea el flag para mostrar el botón
              // "Fiado" en checkout y la entrada a la pantalla Deudas.
              creditSalesEnabled: tenant.creditSalesEnabled,
              // B-reservas-1 (CRM) · capability flag de la sección Clientes.
              // El TPV lo cachea para mostrar/ocultar la ficha de cliente
              // y el atajo F1 (ADR-R6).
              crmEnabled: tenant.crmEnabled,
              // B-reservas-2 · capability flag de la agenda. El TPV lo cachea
              // para pintar (o no) la duración por línea de servicio en el
              // ticket (ADR-R6).
              agendaEnabled: tenant.agendaEnabled,
              // H1 (ADR-016) · el flag viaja al TPV junto a sus hermanos
              // para que la PWA pinte la frase sin esperar a un 403. La
              // puerta sigue siendo el servidor (arriba, en este mismo
              // handler): un catálogo cacheado no abre nada.
              cajaEnabled: tenant.cajaEnabled,
              // catalogo-local (addendum 3) · viaja con sus hermanos y se
              // cachea igual. Es UI: aquí no gatea nada.
              holdedEnabled: tenant.holdedEnabled,
              // clinica-2 · viaja con sus hermanos y se cachea igual.
              clinicalRecordsEnabled: tenant.clinicalRecordsEnabled,
              // v1.3-Operativa-Extra · Lote 1: alias editable de tags
              // (`slug` tal como llega de Holded en lowercase → `label`
              // a pintar en el chip).
              tagAliases: tagAliases ?? [],
            }
          : {}),
      };
    },
  );

  // B-Bar-Modifiers · catálogo de modificadores para el TPV. El cajero
  // tap-ea un producto: si el producto tiene grupos asociados, el TPV
  // abre el modal <ModifierSelector>. Se descarga una vez por sesión y
  // se cachea en memoria — el dataset típico de un bar son <50 modifiers.
  app.get(
    "/tpv/catalog/modifier-groups",
    { preHandler: [requireCashierSession, ensureCajaEnabled] },
    async (request) => {
      const cashier = request.cashier!;
      const prisma = getPrisma();
      const groups = await prisma.modifierGroup.findMany({
        where: { tenantId: cashier.tid, deletedAt: null },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        include: {
          modifiers: {
            where: { deletedAt: null },
            orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
            select: {
              id: true,
              label: true,
              priceDeltaCents: true,
              sortOrder: true,
              isDefault: true,
            },
          },
          products: { select: { productId: true, sortOrder: true } },
        },
      });
      return {
        groups: groups.map((g) => ({
          id: g.id,
          name: g.name,
          exclusive: g.exclusive,
          required: g.required,
          sortOrder: g.sortOrder,
          productIds: g.products.map((p) => p.productId),
          modifiers: g.modifiers.map((m) => ({
            id: m.id,
            label: m.label,
            priceDeltaCents: m.priceDeltaCents,
            sortOrder: m.sortOrder,
            isDefault: m.isDefault,
          })),
        })),
      };
    },
  );

  // Comodines TPV-OTROS-{IVA} accesibles para el cajero al pulsar
  // "Línea libre" (núcleo §6.1). El front filtra por nombre que empieza
  // con "TPV-OTROS-".
  app.get(
    "/tpv/catalog/wildcards",
    { preHandler: [requireCashierSession, ensureCajaEnabled] },
    async (request) => {
      const cashier = request.cashier!;
      const prisma = getPrisma();
      const items = await prisma.product.findMany({
        where: {
          tenantId: cashier.tid,
          active: true,
          sku: { startsWith: "TPV-OTROS-" },
        },
        select: {
          id: true,
          name: true,
          sku: true,
          basePrice: true,
          taxRate: true,
          holdedProductId: true,
        },
        orderBy: { taxRate: "desc" },
      });
      return {
        items: items.map((p) => ({
          id: p.id,
          holdedProductId: p.holdedProductId,
          name: p.name,
          sku: p.sku!,
          basePrice: Number(p.basePrice),
          taxRate: Number(p.taxRate),
        })),
      };
    },
  );

  // v1.14-la-comanda-se-ve §4 · los más vendidos, para el estado vacío
  // del ticket.
  //
  // Principio UX no negociable: estado vacío siempre informativo, nunca
  // pantalla en blanco. Una mesa recién abierta es el punto de mayor
  // intención del turno, así que ahí van los cinco productos que más se
  // están vendiendo AHORA (este turno) y, si el turno acaba de empezar y
  // no da para una señal, los del último mes.
  //
  // El corte es por unidades vendidas, no por importe: lo que acelera la
  // comanda es lo que más veces se pulsa, no lo que más factura.
  app.get(
    "/tpv/catalog/top-sellers",
    {
      preHandler: [requireCashierSession, ensureCajaEnabled],
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            shiftId: { type: "string", format: "uuid" },
            limit: { type: "integer", minimum: 1, maximum: 12 },
          },
        },
      },
    },
    async (request) => {
      const cashier = request.cashier!;
      const q = request.query as { shiftId?: string; limit?: number };
      const limit = q.limit ?? 5;
      const prisma = getPrisma();

      // Sólo ventas de verdad. DRAFT es una mesa abierta (todavía no se
      // ha vendido nada), VOIDED es una mesa vaciada y TEST es el cajero
      // técnico del onboarding: ninguno debe mover el ranking.
      const SOLD: TicketStatus[] = [
        "PAID",
        "PENDING_SYNC",
        "SYNCED",
        "SYNC_FAILED",
        "ON_CREDIT",
      ];

      async function rank(
        ticketWhere: Record<string, unknown>,
      ): Promise<Array<{ productId: string; units: number }>> {
        const grouped = await prisma.ticketLine.groupBy({
          by: ["productId"],
          where: {
            productId: { not: null },
            ticket: { tenantId: cashier.tid, status: { in: SOLD }, ...ticketWhere },
          },
          _sum: { units: true },
          orderBy: { _sum: { units: "desc" } },
          take: limit,
        });
        return grouped
          .filter((g) => g.productId != null)
          .map((g) => ({ productId: g.productId!, units: Number(g._sum.units ?? 0) }));
      }

      // Turno actual primero. Sin `shiftId` (venta rápida sin turno
      // resuelto todavía) se va directo al último mes.
      let source: "shift" | "month" = "shift";
      let ranked = q.shiftId ? await rank({ shiftId: q.shiftId }) : [];
      // Un turno recién abierto con una sola venta no es una señal: es
      // ruido. Por debajo de la mitad de los huecos preferimos el mes.
      if (ranked.length < Math.ceil(limit / 2)) {
        source = "month";
        const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        ranked = await rank({ createdAt: { gte: since } });
      }
      if (ranked.length === 0) return { source, items: [] };

      // Los productos pueden haberse borrado del catálogo desde que se
      // vendieron: se filtran aquí, no en el TPV (que sólo sabe pintar).
      const products = await prisma.product.findMany({
        where: {
          id: { in: ranked.map((r) => r.productId) },
          tenantId: cashier.tid,
          active: true,
        },
        select: { id: true },
      });
      const alive = new Set(products.map((p) => p.id));
      return {
        source,
        items: ranked
          .filter((r) => alive.has(r.productId))
          .map((r) => ({ productId: r.productId, units: r.units })),
      };
    },
  );

  // v2-H1-venta-y-sala §3 · GET /tpv/catalog/now · la vista «Ahora».
  //
  // «Ahora» es la PRIMERA pestaña de la venta de hostelería y la que
  // abre por defecto (decisión 4): los productos más pedidos en ESE
  // comercio en ESTA franja horaria. Es la única vista que se reordena
  // sola; dentro de una familia el orden no cambia nunca, porque lo que
  // el camarero aprende es la posición.
  //
  // Por qué no vale `/tpv/catalog/top-sellers`, que ya existe: ése
  // rankea el TURNO entero (o el último mes) y alimenta cinco huecos del
  // estado vacío del ticket. «Ahora» necesita la FRANJA: a las ocho de la
  // mañana lo que se pide son cafés y tostadas, y a las ocho de la tarde
  // cañas — un ranking del turno de mañana entero le pone las tostadas
  // delante al camarero del aperitivo. Son dos preguntas distintas con
  // dos ventanas distintas, así que son dos rutas.
  //
  // La ventana: **franja de ±1 h sobre la hora actual, en los últimos 28
  // días**. Los 28 son cuatro semanas exactas, así que la muestra tiene
  // el mismo número de lunes que de sábados — con 30 días, dos días de
  // la semana pesan un 25 % más que los otros cinco, y en un bar el
  // sábado no se pide lo mismo que el martes. La ±1 h da tres horas de
  // muestra: con una sola hora, un bar tranquilo entre semana no junta
  // ventas suficientes para que el orden signifique algo.
  //
  // Sin migraciones: se lee de `ticket_lines` y `tickets`, que es lo
  // mismo que lee `top-sellers`.
  app.get(
    "/tpv/catalog/now",
    {
      preHandler: [requireCashierSession, ensureCajaEnabled],
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            limit: { type: "integer", minimum: 1, maximum: 40 },
          },
        },
      },
    },
    async (request) => {
      const cashier = request.cashier!;
      const q = request.query as { limit?: number };
      const limit = q.limit ?? NOW_LIMIT;
      const prisma = getPrisma();

      // La franja se calcula EN SQL, con `AT TIME ZONE`, y no en JS.
      // `created_at` es `timestamptz` y lo que se compara es la hora de
      // PARED del local: a las 21:00 de Madrid le corresponden las 19:00
      // UTC en verano y las 20:00 en invierno, así que extraer la hora en
      // UTC mezclaría la franja del aperitivo de julio con la de la cena
      // de enero. `AT TIME ZONE 'Europe/Madrid'` aplica las reglas DST
      // fila a fila, que es justo lo que no se puede hacer con un offset
      // fijo. Misma zona que el resto del sistema (`agenda/time.ts`).
      //
      // La franja se compara en aritmética modular de 24 h para que
      // envuelva la medianoche: a las 00:30 la franja es 23:00–01:00, o
      // sea «hora >= 23 OR hora <= 1», y un `BETWEEN` daría vacío. Un
      // bar de copas cierra a las tres: si la vista se quedara en blanco
      // justo en su hora punta, «Ahora» no serviría para nada.
      //
      // Sólo ventas de verdad, con el mismo criterio que `top-sellers`:
      // DRAFT es una mesa abierta, VOIDED una mesa vaciada y TEST el
      // cajero técnico del onboarding. Ninguno mueve el ranking.
      const ranked = await prisma.$queryRaw<
        Array<{ product_id: string; units: number | bigint | { toString(): string } }>
      >(Prisma.sql`
        SELECT l.product_id AS product_id, SUM(l.units) AS units
        FROM ticket_lines l
        JOIN tickets t ON t.id = l.ticket_id
        WHERE t.tenant_id = ${cashier.tid}::uuid
          AND t.status IN ('PAID', 'PENDING_SYNC', 'SYNCED', 'SYNC_FAILED', 'ON_CREDIT')
          AND t.created_at >= NOW() - ${`${NOW_WINDOW_DAYS} days`}::interval
          AND l.product_id IS NOT NULL
          AND (
            (EXTRACT(HOUR FROM t.created_at AT TIME ZONE ${NOW_TZ})::int
              - EXTRACT(HOUR FROM NOW() AT TIME ZONE ${NOW_TZ})::int + 24) % 24
            <= ${NOW_BAND_HOURS}
            OR
            (EXTRACT(HOUR FROM NOW() AT TIME ZONE ${NOW_TZ})::int
              - EXTRACT(HOUR FROM t.created_at AT TIME ZONE ${NOW_TZ})::int + 24) % 24
            <= ${NOW_BAND_HOURS}
          )
        GROUP BY l.product_id
        ORDER BY SUM(l.units) DESC
        LIMIT ${limit}
      `);

      // Lo que ya no está en el catálogo no se ofrece. Se filtra aquí y
      // no en el TPV, que sólo sabe pintar: un botón que añade un
      // producto borrado de Holded es una línea que el sync rechaza.
      const vendidos = ranked
        .map((r) => ({ productId: r.product_id, units: Number(r.units) }))
        .filter((r) => r.productId);
      const vivos =
        vendidos.length > 0
          ? await prisma.product.findMany({
              where: {
                id: { in: vendidos.map((r) => r.productId) },
                tenantId: cashier.tid,
                active: true,
                sellableViaTpv: true,
              },
              select: { id: true },
            })
          : [];
      const aliveIds = new Set(vivos.map((p) => p.id));
      const items = vendidos
        .filter((r) => aliveIds.has(r.productId))
        .map((r) => ({ productId: r.productId, units: r.units }));

      // El relleno. «Si hay menos de 20 con ventas, se completa con los
      // primeros de cada familia en su orden» — y un comercio NUEVO, sin
      // un solo ticket, ve «Ahora» = primeros de cada familia.
      //
      // Esto se hace en el servidor y no en el TPV a propósito: así la
      // respuesta siempre trae veinte productos y el terminal no tiene
      // dos caminos para pintar la misma vista. El sabotaje «"Ahora" sin
      // ventas devuelve vacío» cae con un test de API, no con uno de
      // render.
      const filled = items.length < limit
        ? [...items, ...(await firstOfEachFamily(
            prisma,
            cashier.tid,
            limit - items.length,
            new Set(items.map((i) => i.productId)),
          ))]
        : items;

      return {
        // De dónde sale lo que se está viendo. El TPV no lo pinta hoy,
        // pero sin esto no hay forma de distinguir «este bar pide cañas a
        // esta hora» de «este bar es nuevo» al depurar una implantación.
        source: items.length === 0 ? "families" : items.length < limit ? "mixed" : "sales",
        bandHours: NOW_BAND_HOURS,
        windowDays: NOW_WINDOW_DAYS,
        items: filled,
      };
    },
  );

  // Health del sync con Holded para el banner "Sincronizando…" / "Sin
  // conexión" / "Holded no accesible" (§5 modo degradado). El TPV pollea
  // este endpoint cada ~30 s. B6 §3.1 amplía la respuesta con `level`,
  // `reason`, `lastSuccessfulSyncAt` y `blockedAt` para que el cliente
  // pinte tres estados (oculto/ámbar/rojo) sin recalcular umbrales.
  app.get(
    "/tpv/health/holded",
    { preHandler: [requireCashierSession, ensureCajaEnabled] },
    async (request) => {
      const cashier = request.cashier!;
      const prisma = getPrisma();
      const [health, pendingCount, failedCount] = await Promise.all([
        getTenantHealthStatus(prisma, cashier.tid),
        prisma.ticket.count({
          where: { tenantId: cashier.tid, status: "PENDING_SYNC" },
        }),
        prisma.ticket.count({
          where: { tenantId: cashier.tid, status: "SYNC_FAILED" },
        }),
      ]);
      return {
        level: health.level,
        reason: health.reason,
        hasHoldedKey: health.hasHoldedKey,
        lastIncrementalSyncAt: health.lastSuccessfulSyncAt,
        lastSuccessfulSyncAt: health.lastSuccessfulSyncAt,
        lastSyncAgeMs: health.lastSyncAgeMs,
        blockedAt: health.blockedAt,
        pendingSyncCount: pendingCount,
        syncFailedCount: failedCount,
      };
    },
  );
}
