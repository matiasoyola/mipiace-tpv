// puesta-en-marcha · la limpieza de un tenant de prueba, por la MISMA puerta
// que «Eliminar cuenta». ADR-021 §6.3.
//
// Hasta `20261017030000_eliminar_cuenta_unica_puerta`, media suite limpiaba
// con un `DELETE FROM tenants` a pelo y funcionaba por la rama de cascada de
// los guardias —«si el tenant ya no existe, esto es su borrado en cascada»—.
// Esa rama era el agujero: lo que dejaba pasar al e2e dejaba pasar también a
// cualquiera con una consola de psql delante de producción.
//
// Al cerrarla, la limpieza de los tests tiene que ir por donde va la
// operación de verdad, y eso es lo que hace esto. NO es una excepción nueva
// para los tests: es la marca de ADR-021 §6, la misma función, el mismo
// `SET LOCAL`, el mismo orden de borrado que `superadmin/eliminar-cuenta.ts`.
// Si algún día la marca deja de bastar, esta suite se pone roja — que es
// exactamente lo que se quiere.

import type { PrismaClient } from "@mipiacetpv/db";

/** Lo que una transacción interactiva de Prisma ofrece aquí dentro. */
type Tx = Pick<PrismaClient, "$executeRawUnsafe">;

/**
 * Borra la cuenta entera de cada tenant indicado, cada una en su propia
 * transacción y con su propia marca: `SET LOCAL` NOMBRA a un tenant, así que
 * dos cuentas son dos transacciones.
 *
 * El orden es el de `eliminarLaCuenta`: primero lo que tiene guardia o clave
 * ajena `RESTRICT`, y el tenant al final para que la cascada se lleve el
 * resto. Los ids vacíos se ignoran (el `beforeEach` de la primera pasada
 * todavía no tiene ninguno).
 */
export async function borrarCuentasDePrueba(
  prisma: PrismaClient,
  ...ids: (string | undefined | null)[]
): Promise<void> {
  for (const id of ids) {
    if (!id) continue;
    // El id viene de un `randomUUID()` del propio test, pero se interpola en
    // SQL: se mira igual que en producción.
    if (!/^[0-9a-fA-F-]{36}$/.test(id)) {
      throw new Error(`id de tenant inesperado: ${id}`);
    }
    await prisma.$transaction(async (tx) => {
      await borrarDentroDeLaMarca(tx, id);
    });
  }
}

async function borrarDentroDeLaMarca(tx: Tx, id: string): Promise<void> {
  await tx.$executeRawUnsafe(
    `SET LOCAL "mipiacetpv.eliminar_tenant" = '${id}'`,
  );
  await tx.$executeRawUnsafe(
    `DELETE FROM fiscal_records WHERE tenant_id = '${id}'`,
  );
  await tx.$executeRawUnsafe(`DELETE FROM refunds WHERE tenant_id = '${id}'`);
  await tx.$executeRawUnsafe(`DELETE FROM tickets WHERE tenant_id = '${id}'`);
  // `shifts` no tiene `tenant_id`: cuelga de la caja, y la caja de la tienda.
  // Van antes que `users` (la FK `shifts_user_id_fkey` es RESTRICT y la
  // cascada del tenant se lleva los usuarios).
  await tx.$executeRawUnsafe(
    `DELETE FROM shifts WHERE register_id IN (
       SELECT r.id FROM registers r
         JOIN stores s ON s.id = r.store_id
        WHERE s.tenant_id = '${id}')`,
  );
  await tx.$executeRawUnsafe(
    `DELETE FROM time_entries WHERE tenant_id = '${id}'`,
  );
  await tx.$executeRawUnsafe(`DELETE FROM employees WHERE tenant_id = '${id}'`);
  await tx.$executeRawUnsafe(
    `DELETE FROM public_links WHERE tenant_id = '${id}'`,
  );
  await tx.$executeRawUnsafe(`DELETE FROM tenants WHERE id = '${id}'`);
}
