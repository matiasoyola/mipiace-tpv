// B-reservas-8 · los AJUSTES de los bonos y las PLANTILLAS del catálogo.
//
//   GET  /admin/bonos/ajustes      — etiqueta, no-show, caducidad, candado
//   POST /admin/bonos/ajustes      — los tres ajustes del negocio
//   POST /admin/bonos/arranque     — CONFIRMAR por qué número empieza
//   GET  /admin/bonos/plantillas   — qué productos son bonos
//   PUT  /admin/bonos/plantillas/:productId — poner o cambiar la plantilla
//   DELETE /admin/bonos/plantillas/:productId — quitarla
//
// ── El candado de primer uso, y por qué es su propia ruta ──────────────
//
// Confirmar por qué número empieza el talonario **no es un ajuste más**: es
// un acto que sólo se hace UNA VEZ y que no se deshace, porque después hay
// bonos emitidos con esos números. Por eso no está en el POST de ajustes
// —donde un `PATCH` descuidado podría moverlo— y por eso la ruta rechaza
// cambiarlo cuando ya hay bonos emitidos.
//
// ── Y lo que NO se puede tocar desde aquí ──────────────────────────────
//
// `bonosEnabled`. Es una capability y la mueve SÓLO el super-admin, igual
// que la caja, el fichaje, la clínica, la cocina y la residencia: encender
// un módulo es vender un producto. Y además tiene una guarda propia —no se
// puede encender con Holded conectado— que vive en la ruta del super-admin
// y en un CHECK de la base.

import { ETIQUETA_MOTIVO } from "@mipiacetpv/bonos";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import { requireOwner, requireOwnerOrManager } from "../auth/middleware.js";
import { getPrisma } from "../context.js";
import { ensureBonosEnabled } from "./gate-tenant.js";
import { codigoDeNumero, normalizarCodigo } from "./numero.js";

export async function registerVoucherAdminRoutes(
  app: FastifyInstance,
): Promise<void> {
  // ── Los ajustes ───────────────────────────────────────────────────
  app.get(
    "/admin/bonos/ajustes",
    { preHandler: [requireOwnerOrManager, ensureBonosEnabled] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const prisma = getPrisma();
      const [tenant, secuencia, emitidos] = await Promise.all([
        prisma.tenant.findUniqueOrThrow({
          where: { id: auth.tenantId },
          select: {
            bonoEtiqueta: true,
            bonoNoShow: true,
            bonoCaducidadMeses: true,
            bonoModoCanje: true,
          },
        }),
        prisma.voucherSequence.findUnique({
          where: { tenantId: auth.tenantId },
          select: {
            ultimo: true,
            arranque: true,
            arranqueConfirmadoAt: true,
          },
        }),
        prisma.voucher.count({ where: { tenantId: auth.tenantId } }),
      ]);
      return reply.send({
        ajustes: {
          etiqueta: tenant.bonoEtiqueta,
          noShow: tenant.bonoNoShow,
          caducidadMeses: tenant.bonoCaducidadMeses,
          // El frente P5 se DEVUELVE pero no se acepta en el POST: lo
          // decide la asesoría, no el negocio. Ver el ADR.
          modoCanje: tenant.bonoModoCanje,
        },
        numeracion: {
          // `true` = EL CANDADO ESTÁ PUESTO y no se emite ningún bono.
          candadoPuesto: secuencia?.arranque == null,
          arranque: secuencia?.arranque ?? null,
          confirmadoEl: secuencia?.arranqueConfirmadoAt?.toISOString() ?? null,
          ultimoEmitido: secuencia?.ultimo ?? 0,
          // Cuántos bonos hay. Es lo que impide mover el arranque.
          bonosEmitidos: emitidos,
          siguienteSiConfirmas:
            secuencia?.arranque == null
              ? null
              : codigoDeNumero(
                  secuencia.ultimo === 0 ? secuencia.arranque : secuencia.ultimo + 1,
                ),
        },
        // Los motivos de corrección con su etiqueta, para que el panel no
        // los escriba por su cuenta.
        motivosDeCorreccion: ETIQUETA_MOTIVO,
      });
    },
  );

  app.post(
    "/admin/bonos/ajustes",
    {
      preHandler: [requireOwner, ensureBonosEnabled],
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          properties: {
            // LA PALABRA que ve el centro. «bono» por defecto; el spa dirá
            // «programa». En el código sigue siendo `Voucher`.
            etiqueta: { type: "string", minLength: 1, maxLength: 20 },
            noShow: { type: "string", enum: ["consumir", "liberar"] },
            // Meses de CALENDARIO. `null` = sin caducidad, que es el
            // default del bloque. Se acepta `null` explícito para poder
            // QUITAR la caducidad por defecto.
            caducidadMeses: {
              type: ["integer", "null"],
              minimum: 1,
              maximum: 120,
            },
            // `modoCanje` NO está aquí, y no es un olvido: el importe de la
            // línea al canjear es el frente P5 de la asesoría (ADR-R9 §6).
            // Un propietario que lo cambiara estaría decidiendo cómo
            // declara su IVA. `additionalProperties: false` hace que un
            // intento de mandarlo devuelva 400.
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const body = request.body as {
        etiqueta?: string;
        noShow?: "consumir" | "liberar";
        caducidadMeses?: number | null;
      };
      const prisma = getPrisma();
      const updated = await prisma.tenant.update({
        where: { id: auth.tenantId },
        data: {
          bonoEtiqueta: body.etiqueta?.trim(),
          bonoNoShow: body.noShow,
          // `undefined` deja la columna como estaba; `null` la vacía. Son
          // dos cosas distintas y el schema acepta las dos.
          ...(body.caducidadMeses !== undefined
            ? { bonoCaducidadMeses: body.caducidadMeses }
            : {}),
        },
        select: {
          bonoEtiqueta: true,
          bonoNoShow: true,
          bonoCaducidadMeses: true,
          bonoModoCanje: true,
        },
      });
      return reply.send({
        ajustes: {
          etiqueta: updated.bonoEtiqueta,
          noShow: updated.bonoNoShow,
          caducidadMeses: updated.bonoCaducidadMeses,
          modoCanje: updated.bonoModoCanje,
        },
      });
    },
  );

  // ── EL CANDADO DE PRIMER USO ──────────────────────────────────────
  //
  // «No se emite ningún bono hasta que el encargado confirme por qué número
  // empieza» (`07` pieza 8). Los centros con talonario de papel siguen su
  // numeración: arrancar en 1 encima de un talonario que va por el 230 es
  // duplicar números en la vida real.
  app.post(
    "/admin/bonos/arranque",
    {
      preHandler: [requireOwner, ensureBonosEnabled],
      schema: {
        body: {
          type: "object",
          required: ["numero"],
          additionalProperties: false,
          properties: {
            // Se acepta el número suelto o con prefijo: `B231`, `b 231`,
            // `231`. Lo que el encargado tiene delante es un talonario.
            numero: { type: "string", minLength: 1, maxLength: 40 },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const body = request.body as { numero: string };
      const n = normalizarCodigo(body.numero);
      if (n == null) {
        return reply.code(400).send({
          error: "NUMERO_ILEGIBLE",
          message:
            "Ese número no se entiende. Escribe por qué número empieza el talonario (por ejemplo B231, o 231).",
        });
      }
      const prisma = getPrisma();
      const resultado = await prisma.$transaction(async (tx) => {
        const emitidos = await tx.voucher.count({
          where: { tenantId: auth.tenantId },
        });
        const actual = await tx.voucherSequence.findUnique({
          where: { tenantId: auth.tenantId },
          select: { arranque: true, ultimo: true },
        });
        // Confirmado y con bonos emitidos: NO se mueve. Cambiar el arranque
        // después sería renumerar bonos que ya están en manos de clientas.
        if (actual?.arranque != null && emitidos > 0) {
          return { ok: false as const, emitidos };
        }
        await tx.voucherSequence.upsert({
          where: { tenantId: auth.tenantId },
          create: {
            tenantId: auth.tenantId,
            ultimo: 0,
            arranque: n,
            arranqueConfirmadoAt: new Date(),
            arranqueConfirmadoBy: auth.userId,
          },
          update: {
            arranque: n,
            arranqueConfirmadoAt: new Date(),
            arranqueConfirmadoBy: auth.userId,
          },
        });
        return { ok: true as const };
      });
      if (!resultado.ok) {
        return reply.code(409).send({
          error: "ARRANQUE_YA_EN_USO",
          code: "ARRANQUE_YA_EN_USO",
          message:
            `Este negocio ya ha emitido ${resultado.emitidos} bono(s) con la numeración actual. ` +
            "Cambiar por qué número empieza renumeraría bonos que ya están en manos de clientas.",
        });
      }
      return reply.send({
        numeracion: { candadoPuesto: false, arranque: n, siguiente: codigoDeNumero(n) },
      });
    },
  );

  // ── LAS PLANTILLAS: qué productos del catálogo son bonos ──────────
  app.get(
    "/admin/bonos/plantillas",
    { preHandler: [requireOwnerOrManager, ensureBonosEnabled] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const prisma = getPrisma();
      const filas = await prisma.voucherTemplate.findMany({
        where: { tenantId: auth.tenantId },
        select: {
          id: true,
          productId: true,
          sessions: true,
          coversServiceIds: true,
          coversTagSlugs: true,
          expiresMonths: true,
          product: {
            select: {
              name: true,
              sku: true,
              basePrice: true,
              taxRate: true,
              exemptionCause: true,
              active: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
      });
      return reply.send({
        plantillas: filas.map((t) => ({
          id: t.id,
          productId: t.productId,
          sessions: t.sessions,
          coversServiceIds: t.coversServiceIds,
          coversTagSlugs: t.coversTagSlugs,
          expiresMonths: t.expiresMonths,
          // El PRECIO y el IVA vienen del producto y se devuelven para
          // pintar, NUNCA para editar desde aquí: un bono es un producto
          // normal y su precio se edita en el catálogo. Si se pudiera
          // editar en los dos sitios habría dos sitios donde mirar el IVA
          // de un bono.
          producto: {
            nombre: t.product.name,
            sku: t.product.sku,
            precioCents: Math.round(Number(t.product.basePrice) * 100),
            taxRate: Number(t.product.taxRate),
            exemptionCause: t.product.exemptionCause,
            activo: t.product.active,
          },
        })),
      });
    },
  );

  app.put(
    "/admin/bonos/plantillas/:productId",
    {
      preHandler: [requireOwner, ensureBonosEnabled],
      schema: {
        params: {
          type: "object",
          required: ["productId"],
          properties: { productId: { type: "string", format: "uuid" } },
        },
        body: {
          type: "object",
          required: ["sessions"],
          additionalProperties: false,
          properties: {
            sessions: { type: "integer", minimum: 1, maximum: 100 },
            coversServiceIds: {
              type: "array",
              maxItems: 100,
              items: { type: "string", format: "uuid" },
            },
            coversTagSlugs: {
              type: "array",
              maxItems: 50,
              items: { type: "string", minLength: 1, maxLength: 60 },
            },
            // Meses de calendario, o `null` para que no caduque.
            expiresMonths: {
              type: ["integer", "null"],
              minimum: 1,
              maximum: 120,
            },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const { productId } = request.params as { productId: string };
      const body = request.body as {
        sessions: number;
        coversServiceIds?: string[];
        coversTagSlugs?: string[];
        expiresMonths?: number | null;
      };
      const servicios = body.coversServiceIds ?? [];
      const tags = (body.coversTagSlugs ?? []).map((t) => t.trim().toLowerCase());
      if (servicios.length === 0 && tags.length === 0) {
        return reply.code(400).send({
          error: "SIN_COBERTURA",
          message:
            "Un bono tiene que valer para algo: elige los servicios que cubre, o sus categorías.",
        });
      }
      const prisma = getPrisma();
      const producto = await prisma.product.findFirst({
        where: { id: productId, tenantId: auth.tenantId },
        select: { id: true, kind: true },
      });
      if (!producto) {
        return reply
          .code(404)
          .send({ error: "PRODUCTO_NOEXISTE", message: "No existe ese producto." });
      }
      const plantilla = await prisma.voucherTemplate.upsert({
        where: { productId },
        create: {
          tenantId: auth.tenantId,
          productId,
          sessions: body.sessions,
          coversServiceIds: servicios,
          coversTagSlugs: tags,
          expiresMonths: body.expiresMonths ?? null,
        },
        update: {
          sessions: body.sessions,
          coversServiceIds: servicios,
          coversTagSlugs: tags,
          expiresMonths: body.expiresMonths ?? null,
        },
        select: {
          id: true,
          sessions: true,
          coversServiceIds: true,
          coversTagSlugs: true,
          expiresMonths: true,
        },
      });
      // Los bonos YA VENDIDOS no se tocan: llevan su propia copia de la
      // cobertura, congelada al vender. Cambiar la plantilla cambia lo que
      // se venda a partir de ahora y nada más (`07` pieza 16).
      const yaVendidos = await prisma.voucher.count({
        where: { tenantId: auth.tenantId, templateId: plantilla.id },
      });
      return reply.send({
        plantilla,
        // Con cifras, que es como se dice (`05` §8.6: «7 cheques y 2
        // programas siguen valiendo»).
        yaVendidos,
        aviso:
          yaVendidos > 0
            ? `${yaVendidos} bono(s) ya vendidos siguen valiendo por lo que se vendió: este cambio sólo afecta a los que se vendan desde ahora.`
            : null,
      });
    },
  );

  app.delete(
    "/admin/bonos/plantillas/:productId",
    {
      preHandler: [requireOwner, ensureBonosEnabled],
      schema: {
        params: {
          type: "object",
          required: ["productId"],
          properties: { productId: { type: "string", format: "uuid" } },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const { productId } = request.params as { productId: string };
      const prisma = getPrisma();
      const plantilla = await prisma.voucherTemplate.findFirst({
        where: { productId, tenantId: auth.tenantId },
        select: { id: true },
      });
      if (!plantilla) return reply.send({ ok: true, yaVendidos: 0 });
      const yaVendidos = await prisma.voucher.count({
        where: { tenantId: auth.tenantId, templateId: plantilla.id },
      });
      // `Voucher.templateId` es `SetNull`, así que quitar la plantilla
      // **no invalida** los bonos vendidos: siguen con su cobertura
      // congelada y se siguen canjeando. Lo que deja de poder venderse es
      // el bono nuevo, que es lo que el propietario está pidiendo.
      await prisma.voucherTemplate.delete({ where: { id: plantilla.id } });
      return reply.send({
        ok: true,
        yaVendidos,
        aviso:
          yaVendidos > 0
            ? `${yaVendidos} bono(s) ya vendidos siguen valiendo y se siguen canjeando: este producto deja de vender bonos nuevos, nada más.`
            : null,
      });
    },
  );
}
