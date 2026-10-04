// catalogo-en-alta · el super-admin carga el catálogo local de un tenant.
//
//   POST /super-admin/tenants/:id/catalog/import
//
// Existe por un bucle que se midió recorriendo el alta de un bar nuevo
// sin Holded (ver `docs/blocks/catalogo-en-alta-plan.md`):
//
//   · La activación exige la salud en verde, y `products-sellable`
//     aplica a todo tenant con caja: con 0 productos está en rojo.
//   · Sin Holded no hay sync inicial, así que los productos sólo pueden
//     entrar por `POST /catalog/products`, que pide sesión de OWNER o
//     MANAGER.
//   · En DRAFT no hay OWNER —nace al activar— y la impersonación del
//     super-admin necesita uno (409 `NO_OWNER`).
//
// DRAFT sin productos → no se activa → sin OWNER no entran productos.
// Esta ruta es la puerta que rompe el bucle, y la rompe por donde el
// protocolo anti-sustos quiere: el catálogo real entra ANTES de activar,
// se ensaya en modo prueba sin un solo registro fiscal, y el dueño ve su
// carta en el TPV el día de la visita.
//
// ── Las cuatro cosas que esta ruta promete ─────────────────────────────
//
// 1. **La vista previa no escribe.** `confirmar: false` no abre
//    transacción: parsea, pregunta a la base qué SKUs ya existen y
//    contesta. Cancelar no deja rastro porque no hay rastro que dejar.
// 2. **Un SKU que ya existe no se pisa.** Se informa y se salta. Cargar
//    el mismo fichero dos veces no duplica nada ni cambia precios a
//    escondidas — que es lo que haría un `upsert`, en silencio, sobre el
//    catálogo de un bar que ya está cobrando.
// 3. **Todo o nada.** Las filas válidas entran en una transacción. Un
//    catálogo a medias es peor que ninguno: el implantador no sabe por
//    dónde iba y el TPV enseña media carta.
// 4. **Las mismas reglas que el alta de una ficha.** No parecidas: la
//    misma función (`validateLocalProduct` + `buildLocalProductCreateData`
//    de `catalog/local-product-rules.ts`), con la misma conversión del
//    precio con IVA a neto.
//
// Y una que NO promete: no toca un tenant CON Holded. Devuelve 409 y el
// botón no se pinta. Es exactamente el catálogo mixto que ADR-017
// prohíbe, y un producto local en un tenant con Holded sería una línea
// que no se puede subir y un ticket entero en la bandeja de errores.

import type { FastifyInstance } from "fastify";

import {
  buildLocalProductCreateData,
  isLocalSkuConflict,
} from "../catalog/local-product-rules.js";
import {
  CsvInvalidoError,
  type FilaMala,
  parseCatalogoCsv,
} from "../catalog/csv-catalogo.js";
import { getPrisma } from "../context.js";
import { LOCAL_CATALOG_DISABLED_MESSAGE } from "../lib/catalogo-local-gate.js";

import { extractRequestSignals, writeAudit } from "./audit.js";
import { requireSuperAdmin } from "./middleware.js";

// 512 KB de texto. El catálogo de La Maestranza son 5 KB y 128 líneas;
// esto deja sitio para un catálogo de supermercado sin dejar que un
// fichero equivocado (un ZIP renombrado, un export entero de Holded)
// llegue al parser.
const CSV_MAX_CHARS = 512 * 1024;

// Tope de filas por carga. No es una limitación técnica —la transacción
// aguanta más— sino una decisión: una carga de más de 2.000 productos no
// es una implantación, es otra cosa, y conviene que alguien la mire
// antes de que ocurra. Se RECHAZA con el número, no se recorta en
// silencio: un import que entra a medias sin decirlo es la peor de las
// respuestas posibles.
const FILAS_MAX = 2000;

interface ImportBody {
  csv: string;
  confirmar?: boolean;
}

/** Lo que la pantalla pinta antes de escribir, y lo que se devuelve
 *  después de escribir. La misma forma en los dos casos: así la vista
 *  previa y el resultado se leen igual y no hay dos maneras de contar
 *  lo que ha pasado. */
interface ImportResult {
  escrito: boolean;
  entran: Array<{
    linea: number;
    sku: string;
    nombre: string;
    /** El de la carta, con IVA. */
    precioConIva: number;
    /** El que se guarda, sin IVA y con 4 decimales. */
    precioSinIva: number;
    iva: number;
    categorias: string[];
  }>;
  saltadas: FilaMala[];
  /** Cuántos productos locales tenía el tenant antes de esta carga. La
   *  pantalla lo usa para decir "tenía 0" vs "tenía 128". */
  yaTenia: number;
}

export async function registerSuperAdminTenantCatalogRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.post(
    "/super-admin/tenants/:id/catalog/import",
    {
      preHandler: requireSuperAdmin,
      schema: {
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", format: "uuid" } },
        },
        body: {
          type: "object",
          required: ["csv"],
          additionalProperties: false,
          properties: {
            csv: { type: "string", minLength: 1, maxLength: CSV_MAX_CHARS },
            // El default es la vista previa, y es deliberado: si alguien
            // llama a esta ruta sin leerse esto, lo que pasa es nada.
            confirmar: { type: "boolean" },
          },
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = request.body as ImportBody;
      const confirmar = body.confirmar === true;
      const ctx = request.superAdmin!;
      const prisma = getPrisma();

      const tenant = await prisma.tenant.findUnique({
        where: { id },
        select: { id: true, name: true, cajaEnabled: true, holdedEnabled: true },
      });
      if (!tenant) {
        return reply
          .code(404)
          .send({ error: "TENANT_NOT_FOUND", message: "Tenant no existe" });
      }
      // Sin caja no hay TPV que vender, así que no hay catálogo que
      // cargar. No es una puerta de seguridad —es que no significa nada—
      // pero se contesta igual, porque el implantador tiene que poder
      // distinguirlo de un fallo.
      if (tenant.cajaEnabled === false) {
        return reply.code(409).send({
          error: "CAJA_DISABLED",
          message:
            "Esta empresa no tiene el módulo de caja, así que no tiene catálogo de TPV.",
        });
      }
      // ADR-017. La MISMA condición que `ensureLocalCatalogWritable`
      // (`holdedEnabled !== false` cierra), escrita aquí porque el gate
      // del panel lee `request.auth` y esta ruta es del super-admin.
      if (tenant.holdedEnabled !== false) {
        return reply.code(409).send({
          error: "LOCAL_CATALOG_DISABLED",
          message: LOCAL_CATALOG_DISABLED_MESSAGE,
        });
      }

      let parsed;
      try {
        parsed = parseCatalogoCsv(body.csv);
      } catch (err) {
        if (err instanceof CsvInvalidoError) {
          return reply.code(400).send({ error: "CSV_INVALIDO", message: err.message });
        }
        throw err;
      }

      const total = parsed.buenas.length + parsed.malas.length;
      if (total > FILAS_MAX) {
        return reply.code(400).send({
          error: "CSV_DEMASIADO_GRANDE",
          message: `El fichero trae ${total} filas y el máximo de una carga es ${FILAS_MAX}. Pártelo.`,
        });
      }

      // Los SKUs que YA tiene el tenant, de Holded o locales. Se
      // pregunta por los del fichero y no por el catálogo entero: un
      // `findMany` sin `where` sobre un supermercado trae 20.000 filas
      // para comprobar 128.
      const skus = parsed.buenas.map((f) => f.fields.sku);
      const existentes =
        skus.length === 0
          ? []
          : await prisma.product.findMany({
              where: { tenantId: id, sku: { in: skus } },
              select: { sku: true, source: true },
            });
      const yaEstan = new Map(existentes.map((p) => [p.sku!, p.source]));

      const entran: ImportResult["entran"] = [];
      const saltadas: FilaMala[] = [...parsed.malas];
      for (const fila of parsed.buenas) {
        const fuente = yaEstan.get(fila.fields.sku);
        if (fuente !== undefined) {
          saltadas.push({
            linea: fila.linea,
            sku: fila.fields.sku,
            nombre: fila.fields.name,
            motivo:
              fuente === "HOLDED"
                ? `Ya existe un producto de Holded con el SKU ${fila.fields.sku}. No se toca.`
                : `Ya existe un producto con el SKU ${fila.fields.sku}. No se pisa su precio.`,
          });
          continue;
        }
        entran.push({
          linea: fila.linea,
          sku: fila.fields.sku,
          nombre: fila.fields.name,
          precioConIva: fila.precioConIva,
          precioSinIva: fila.fields.basePrice,
          iva: fila.fields.taxRate,
          categorias: fila.fields.tags,
        });
      }

      const yaTenia = await prisma.product.count({
        where: { tenantId: id, source: "LOCAL" },
      });

      const resultado: ImportResult = {
        escrito: false,
        entran,
        saltadas: saltadas.sort((a, b) => a.linea - b.linea),
        yaTenia,
      };

      // ── La vista previa acaba aquí ───────────────────────────────────
      //
      // Ni transacción, ni auditoría, ni log. Lo único que ha pasado son
      // tres SELECT. Hay test de sabotaje sobre esto: si alguien mueve la
      // escritura por encima de esta línea, se pone rojo.
      if (!confirmar) {
        return reply.code(200).send(resultado);
      }

      if (entran.length === 0) {
        return reply.code(400).send({
          error: "NADA_QUE_CARGAR",
          message:
            "Ninguna fila del fichero puede entrar. Mira los motivos y vuelve a subirlo.",
          ...resultado,
        });
      }

      const signals = extractRequestSignals(request);
      try {
        // Todo o nada, la auditoría incluida. Si la escritura falla, no
        // queda una entrada de auditoría diciendo que entraron 128
        // productos que no están.
        await prisma.$transaction(async (tx) => {
          await tx.product.createMany({
            data: parsed.buenas
              .filter((f) => !yaEstan.has(f.fields.sku))
              .map((f) => buildLocalProductCreateData(id, f.fields)),
          });
          await writeAudit({
            prisma: tx,
            superAdminId: ctx.superAdminId,
            action: "catalog_import",
            tenantId: id,
            metadata: {
              ...signals,
              // Cuántas, no cuáles. El contenido del fichero no entra en
              // la auditoría: son los precios del comercio.
              filasCreadas: entran.length,
              filasSaltadas: saltadas.length,
            },
          });
        });
      } catch (err) {
        if (isLocalSkuConflict(err)) {
          // Carrera: alguien creó uno de estos SKUs entre la vista previa
          // y la confirmación. No ha entrado nada (la transacción ha
          // revertido), así que lo honesto es pedir que vuelva a mirar.
          return reply.code(409).send({
            error: "SKU_ALREADY_EXISTS",
            message:
              "Alguno de estos SKUs se ha creado mientras mirabas la vista previa. No se ha cargado nada: vuelve a subir el fichero.",
          });
        }
        throw err;
      }

      request.log.info(
        {
          event: "super_admin.catalog_import",
          tenantId: id,
          creadas: entran.length,
          saltadas: saltadas.length,
        },
        "catálogo local cargado desde fichero",
      );

      return reply.code(200).send({ ...resultado, escrito: true });
    },
  );
}
