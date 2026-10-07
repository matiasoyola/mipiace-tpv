// bloque iva-exento-sanitario · lo que el MOTOR rechaza, contra Postgres
// de verdad.
//
// Por qué tiene que ser e2e: lo que se prueba aquí no es que la aplicación
// se porte bien, es que **la base no deja**. Misma razón que
// `clinica-historia.e2e.ts`, `clinica-sesion.e2e.ts` y
// `sello-de-la-venta.e2e.ts`: la aplicación no es la única puerta a
// Postgres —hay cuatro para `products` (el panel, el fichero del
// super-admin, el sync de Holded y el `psql` de una implantación)— y una
// invariante que sólo vale mientras el código se porte bien no es una
// invariante.
//
// Por eso cada sabotaje entra por `$executeRawUnsafe`: SQL directo, como
// lo escribiría alguien con acceso al VPS.
//
// Las garantías, una por bloque:
//
//   1. **EXENTO ⇒ SIN IVA.** En `products` y en `ticket_lines`. Y en los
//      DOS SENTIDOS: también se rechaza el UPDATE que sube el IVA de una
//      ficha ya marcada, que es el camino por el que esto se rompería de
//      verdad.
//   2. **El código está en la lista L10.** Los seis de la AEAT entran;
//      cualquier otra cosa, no.
//   3. **Un 0 % SUJETO sigue siendo legal**: `tax_rate = 0` sin causa no
//      es lo mismo que exento y la base no lo confunde.
//   4. **La migración es ADITIVA de verdad**: las columnas existen,
//      nacen NULL y las filas que ya había no se han tocado.
//   5. **El snapshot de la línea es independiente del producto**: cambiar
//      la ficha no cambia lo que se cobró.

import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { E2E_DATABASE_URL, e2eEnabled, SKIP_MESSAGE } from "./e2e-env.js";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL =
  E2E_DATABASE_URL || "postgresql://e2e:e2e@127.0.0.1:5432/e2e";
process.env.REDIS_URL = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";
process.env.JWT_ACCESS_SECRET = "e".repeat(40);
process.env.JWT_REFRESH_SECRET = "f".repeat(40);
process.env.HOLDED_KEY_ENCRYPTION_SECRET = "0".repeat(43) + "=";

const { getPrisma, shutdown } = await import("../src/context.js");

/** Un INSERT/UPDATE tiene que FALLAR. Devuelve el mensaje real del motor,
 *  que es lo que se cita en el -done. */
async function debeFallar(sql: string): Promise<string> {
  const prisma = getPrisma();
  try {
    await prisma.$executeRawUnsafe(sql);
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
  throw new Error(`El motor ACEPTÓ lo que no debía:\n${sql}`);
}

describe.skipIf(!e2eEnabled)("e2e · exento implica sin IVA, y lo dice la base", () => {
  if (!e2eEnabled) console.warn(`\n${SKIP_MESSAGE}\n`);

  const prisma = getPrisma();
  let tenantId = randomUUID();
  let storeId = randomUUID();
  let registerId = randomUUID();
  let shiftId = randomUUID();
  let userId = randomUUID();
  let ticketId = randomUUID();

  beforeAll(async () => {
    tenantId = randomUUID();
    storeId = randomUUID();
    registerId = randomUUID();
    shiftId = randomUUID();
    userId = randomUUID();
    ticketId = randomUUID();

    // El decorado se levanta con la API TIPADA de Prisma y no con SQL
    // crudo: así es el cliente generado el que sabe qué columnas tiene
    // cada tabla, y este banco no se cae el día que alguien añada un NOT
    // NULL a `stores`. El SQL crudo se reserva para los SABOTAJES, que es
    // donde hace falta de verdad — sortear la aplicación.
    await prisma.tenant.create({
      data: {
        id: tenantId,
        name: `Podología Rosario ${tenantId.slice(0, 8)}`,
        clinicalRecordsEnabled: true,
        holdedEnabled: false,
      },
    });
    await prisma.store.create({
      data: { id: storeId, tenantId, name: "Consulta" },
    });
    await prisma.register.create({
      data: { id: registerId, storeId, name: "Caja 1" },
    });
    await prisma.user.create({
      data: {
        id: userId,
        tenantId,
        email: `rosario-${userId.slice(0, 8)}@p.es`,
        alias: "Rosario",
        role: "OWNER",
      },
    });
    await prisma.shift.create({
      data: { id: shiftId, registerId, userId, cashOpening: 0 },
    });
    await prisma.ticket.create({
      data: {
        id: ticketId,
        tenantId,
        registerId,
        shiftId,
        userId,
        internalNumber: "000042",
        externalId: randomUUID(),
        publicSlug: randomUUID().replace(/-/g, "").slice(0, 16),
        status: "PAID",
        total: 35,
        totalTax: 0,
        totalDiscount: 0,
      },
    });
  });

  afterAll(async () => {
    for (const sql of [
      `DELETE FROM ticket_lines WHERE ticket_id = '${ticketId}'`,
      `DELETE FROM tickets WHERE tenant_id = '${tenantId}'`,
      `DELETE FROM products WHERE tenant_id = '${tenantId}'`,
      `DELETE FROM shifts WHERE register_id = '${registerId}'`,
      `DELETE FROM registers WHERE store_id = '${storeId}'`,
      `DELETE FROM stores WHERE tenant_id = '${tenantId}'`,
      `DELETE FROM users WHERE tenant_id = '${tenantId}'`,
      `DELETE FROM tenants WHERE id = '${tenantId}'`,
    ]) {
      await prisma.$executeRawUnsafe(sql);
    }
    await shutdown();
  });

  function insertarProducto(opts: {
    id?: string;
    sku: string;
    taxRate: number;
    causa: string | null;
  }): string {
    const id = opts.id ?? randomUUID();
    const causa = opts.causa === null ? "NULL" : `'${opts.causa}'`;
    return `INSERT INTO products (id, tenant_id, source, name, sku, base_price, tax_rate, exemption_cause, kind, last_synced_at)
            VALUES ('${id}', '${tenantId}', 'LOCAL', 'X ${opts.sku}', '${opts.sku}',
                    35, ${opts.taxRate}, ${causa}, 'SERVICE', now())`;
  }

  function insertarLinea(opts: {
    sku: string;
    taxRate: number;
    causa: string | null;
  }): string {
    const causa = opts.causa === null ? "NULL" : `'${opts.causa}'`;
    return `INSERT INTO ticket_lines (id, ticket_id, sku, name_snapshot, units,
                                      unit_price, discount_pct, tax_rate,
                                      exemption_cause, subtotal, total)
            VALUES ('${randomUUID()}', '${ticketId}', '${opts.sku}', 'X', 1,
                    35, 0, ${opts.taxRate}, ${causa}, 35, 35)`;
  }

  // ── 1 · EXENTO ⇒ SIN IVA ───────────────────────────────────────────

  describe("exento implica tax_rate = 0", () => {
    it("un producto exento al 0 % entra", async () => {
      await prisma.$executeRawUnsafe(
        insertarProducto({ sku: `OK-${randomUUID().slice(0, 8)}`, taxRate: 0, causa: "E1" }),
      );
      const n = await prisma.product.count({
        where: { tenantId, exemptionCause: "E1" },
      });
      expect(n).toBeGreaterThan(0);
    });

    it("un producto exento al 21 % NO: lo rechaza el motor", async () => {
      // Validaciones VERI*FACTU §15.5: con `OperacionExenta` no se puede
      // informar `TipoImpositivo` ni `CuotaRepercutida`. Un producto así
      // produciría un registro imposible y un papel que cobra un IVA que
      // no existe.
      const msg = await debeFallar(
        insertarProducto({ sku: `BAD-${randomUUID().slice(0, 8)}`, taxRate: 21, causa: "E1" }),
      );
      expect(msg).toContain("products_exencion_sin_iva");
    });

    it("y SUBIRLE el IVA a una ficha ya marcada tampoco", async () => {
      // Éste es el camino por el que esto se rompería de verdad: no un
      // INSERT nuevo, sino un UPDATE sobre la ficha de Rosario. El CHECK
      // está escrito en los dos sentidos sin querer serlo —prohíbe la
      // PAREJA, no una dirección.
      const id = randomUUID();
      await prisma.$executeRawUnsafe(
        insertarProducto({ id, sku: `UPD-${randomUUID().slice(0, 8)}`, taxRate: 0, causa: "E1" }),
      );
      const msg = await debeFallar(
        `UPDATE products SET tax_rate = 21 WHERE id = '${id}'`,
      );
      expect(msg).toContain("products_exencion_sin_iva");
      // Y MARCAR como exento un producto al 21 % es la misma pareja, en el
      // otro orden.
      const otro = randomUUID();
      await prisma.$executeRawUnsafe(
        insertarProducto({ id: otro, sku: `U21-${randomUUID().slice(0, 8)}`, taxRate: 21, causa: null }),
      );
      const msg2 = await debeFallar(
        `UPDATE products SET exemption_cause = 'E1' WHERE id = '${otro}'`,
      );
      expect(msg2).toContain("products_exencion_sin_iva");
    });

    it("y la LÍNEA COBRADA tiene el mismo CHECK", async () => {
      // Es el que trabaja de verdad: `POST /tickets` recibe `taxRate` y
      // `exemptionCause` del dispositivo, y un terminal con el catálogo
      // cacheado viejo puede mandar la pareja incoherente.
      await prisma.$executeRawUnsafe(
        insertarLinea({ sku: "LOC-QUIRO", taxRate: 0, causa: "E1" }),
      );
      const msg = await debeFallar(
        insertarLinea({ sku: "LOC-QUIRO", taxRate: 21, causa: "E1" }),
      );
      expect(msg).toContain("ticket_lines_exencion_sin_iva");
    });
  });

  // ── 2 · La lista L10 ───────────────────────────────────────────────

  describe("el código está en la lista L10 de la AEAT", () => {
    it("los seis del IVA entran", async () => {
      for (const codigo of ["E1", "E2", "E3", "E4", "E5", "E6"]) {
        await prisma.$executeRawUnsafe(
          insertarProducto({
            sku: `L10-${codigo}-${randomUUID().slice(0, 8)}`,
            taxRate: 0,
            causa: codigo,
          }),
        );
      }
      const n = await prisma.product.count({
        where: { tenantId, exemptionCause: { in: ["E1", "E2", "E3", "E4", "E5", "E6"] } },
      });
      expect(n).toBeGreaterThanOrEqual(6);
    });

    it("E7 y E8 NO: son del IGIC y este SIF no emite IGIC", async () => {
      for (const codigo of ["E7", "E8"]) {
        const msg = await debeFallar(
          insertarProducto({
            sku: `IGIC-${codigo}-${randomUUID().slice(0, 8)}`,
            taxRate: 0,
            causa: codigo,
          }),
        );
        expect(msg, codigo).toContain("products_exencion_en_l10");
      }
    });

    it("ni un código inventado, ni la cadena vacía", async () => {
      for (const malo of ["E0", "e1", "S1", "", "EXENTO"]) {
        const msg = await debeFallar(
          insertarProducto({
            sku: `MAL-${randomUUID().slice(0, 8)}`,
            taxRate: 0,
            causa: malo,
          }),
        );
        expect(msg, JSON.stringify(malo)).toContain("products_exencion_en_l10");
      }
    });

    it("y la línea cobrada tampoco los admite", async () => {
      const msg = await debeFallar(
        insertarLinea({ sku: "LOC-X", taxRate: 0, causa: "E9" }),
      );
      expect(msg).toContain("ticket_lines_exencion_en_l10");
    });
  });

  // ── 3 · El 0 % sujeto sigue existiendo ─────────────────────────────

  describe("un 0 % SUJETO no es un exento", () => {
    it("`tax_rate = 0` SIN causa es perfectamente legal", async () => {
      // El CHECK está escrito como «causa IS NULL OR tax_rate = 0» y no
      // como «causa IS NOT NULL AND tax_rate = 0» justamente por esto: un
      // `exemption_cause IS NOT NULL` en el CHECK habría exigido causa a
      // TODO producto al 0 %, y un 0 % sujeto es otra operación.
      const id = randomUUID();
      await prisma.$executeRawUnsafe(
        insertarProducto({ id, sku: `CERO-${randomUUID().slice(0, 8)}`, taxRate: 0, causa: null }),
      );
      const p = await prisma.product.findUniqueOrThrow({
        where: { id },
        select: { taxRate: true, exemptionCause: true },
      });
      expect(Number(p.taxRate)).toBe(0);
      expect(p.exemptionCause).toBeNull();
    });

    it("y una línea al 0 % sin causa también", async () => {
      await prisma.$executeRawUnsafe(
        insertarLinea({ sku: "LOC-FOLLETO", taxRate: 0, causa: null }),
      );
      const n = await prisma.ticketLine.count({
        where: { ticketId, sku: "LOC-FOLLETO", exemptionCause: null },
      });
      expect(n).toBe(1);
    });
  });

  // ── 4 · La migración fue aditiva de verdad ─────────────────────────

  describe("la migración es aditiva", () => {
    it("las dos columnas existen, son TEXT y NULLABLE, y SIN default", async () => {
      const filas = await prisma.$queryRawUnsafe<
        Array<{
          table_name: string;
          data_type: string;
          is_nullable: string;
          column_default: string | null;
        }>
      >(
        `SELECT table_name, data_type, is_nullable, column_default
           FROM information_schema.columns
          WHERE column_name = 'exemption_cause'
            AND table_name IN ('products', 'ticket_lines')
          ORDER BY table_name`,
      );
      expect(filas.map((f) => f.table_name)).toEqual(["products", "ticket_lines"]);
      for (const f of filas) {
        expect(f.data_type, f.table_name).toBe("text");
        expect(f.is_nullable, f.table_name).toBe("YES");
        // Un DEFAULT aquí declararía exenta alguna operación.
        expect(f.column_default, f.table_name).toBeNull();
      }
    });

    it("y los CUATRO CHECK están puestos y VALIDADOS", async () => {
      // `convalidated` es lo que distingue un CHECK de verdad de uno
      // `NOT VALID`, que no comprueba las filas viejas. Aquí interesa
      // dejar demostrado que NINGUNA línea histórica se contradice.
      const filas = await prisma.$queryRawUnsafe<
        Array<{ conname: string; convalidated: boolean }>
      >(
        `SELECT conname, convalidated
           FROM pg_constraint
          WHERE contype = 'c'
            AND conname LIKE '%exencion%'
          ORDER BY conname`,
      );
      expect(filas.map((f) => f.conname)).toEqual([
        "products_exencion_en_l10",
        "products_exencion_sin_iva",
        "ticket_lines_exencion_en_l10",
        "ticket_lines_exencion_sin_iva",
      ]);
      for (const f of filas) expect(f.convalidated, f.conname).toBe(true);
    });
  });

  // ── 5 · El snapshot es independiente del producto ──────────────────

  describe("lo que se cobró no cambia si se edita el producto", () => {
    it("desmarcar el servicio NO desmarca la factura de ayer", async () => {
      // La razón de que el snapshot exista. Si Rosario desmarca
      // «Exento · sanitario» el mes que viene, su registro de facturación
      // ya declaró `OperacionExenta` el día del cobro: una reimpresión que
      // leyera el catálogo de hoy no coincidiría ni con el papel que la
      // paciente tiene en la mano ni con lo que la AEAT recibió.
      const productoId = randomUUID();
      const sku = `SNAP-${randomUUID().slice(0, 8)}`;
      await prisma.$executeRawUnsafe(
        insertarProducto({ id: productoId, sku, taxRate: 0, causa: "E1" }),
      );
      const lineaId = randomUUID();
      await prisma.$executeRawUnsafe(
        `INSERT INTO ticket_lines (id, ticket_id, product_id, sku, name_snapshot, units,
                                   unit_price, discount_pct, tax_rate, exemption_cause,
                                   subtotal, total)
         VALUES ('${lineaId}', '${ticketId}', '${productoId}', '${sku}', 'Quiropodia', 1,
                 35, 0, 0, 'E1', 35, 35)`,
      );
      // El propietario quita la marca Y pone el IVA, los dos campos a la
      // vez (es lo que la pantalla manda, y lo único que el CHECK admite).
      await prisma.$executeRawUnsafe(
        `UPDATE products SET exemption_cause = NULL, tax_rate = 21 WHERE id = '${productoId}'`,
      );
      const linea = await prisma.ticketLine.findUniqueOrThrow({
        where: { id: lineaId },
        select: { exemptionCause: true, taxRate: true },
      });
      expect(linea.exemptionCause).toBe("E1");
      expect(Number(linea.taxRate)).toBe(0);
    });
  });
});
