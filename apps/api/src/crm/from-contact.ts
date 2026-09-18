// B-reservas-mostrador F6 · un contacto de Holded se convierte en cliente del
// CRM, y sólo una vez.
//
// El problema, tal y como se vio el 13-09: la recepcionista busca «Dem…» en el
// selector de la agenda, no sale nadie, y la clienta está en Holded desde hace
// tres años. Son DOS LISTAS —`clients` (el CRM local, ADR-R2) y `contacts` (lo
// que sincroniza Holded)— y no tiene por qué saberlo.
//
// Al elegir un contacto de Holded hay que crear el cliente enlazado. Eso NO se
// puede hacer con dos llamadas desde el front (buscar-y-si-no-crear): entre la
// una y la otra caben dos toques seguidos, o dos terminales del mismo centro, y
// el resultado serían dos clientes para la misma persona. Esta operación es un
// solo endpoint idempotente.
//
// ── Cómo se garantiza UN cliente por contacto, SIN migración ──────────
//
// El índice `(tenantId, holdedContactId)` de `clients` NO es único, y no se
// hace único. No es sólo por el «cero migraciones» del bloque: ese enlace lo
// rellena desde ADR-010 el camino de cobro, de forma perezosa y sin que nada
// impidiera duplicados. Un tenant que HOY tenga dos clientes apuntando al mismo
// contacto —que es legal— convertiría el `CREATE UNIQUE INDEX` en un
// despliegue que se cae. Cambiar un problema de UX por un problema de arranque,
// justo en el bloque que enciende la agenda en Sole, es mal negocio.
//
// La alternativa es un CERROJO CONSULTIVO DE TRANSACCIÓN:
//
//   SELECT pg_advisory_xact_lock(hashtext($tenant), hashtext($contacto))
//
// Postgres serializa a quien pida la misma pareja de enteros, y suelta el
// cerrojo solo al cerrar la transacción (commit o rollback — no hay forma de
// olvidarse de liberarlo). Dentro del cerrojo se mira si ya existe y, si no, se
// crea. El segundo en llegar encuentra lo que creó el primero.
//
// Se usa la forma de DOS int4 y no la de un bigint a propósito: dos contactos
// distintos sólo se estorban si colisionan los DOS hashes, y aun colisionando
// el resultado sigue siendo correcto — sólo se serializan de más un instante.
//
// ADR-R2 intacto: aquí NO se escribe nada en Holded. Este módulo no importa
// `@mipiacetpv/holded-client` y no lo va a hacer.

import { ContactType, type Prisma, type PrismaClient } from "@mipiacetpv/db";

/** Lo que hace falta de un contacto para poder enlazarlo. */
export interface ContactoEnlazable {
  holdedContactId: string;
  name: string;
  email: string | null;
  phone: string | null;
}

/** Los tipos de contacto que el TPV trata como clientes. Es el MISMO criterio
 *  que el buscador del cajero (`contacts/routes.ts`), y tiene que serlo: si el
 *  filtro viviera sólo en la búsqueda, cualquiera que llamase al endpoint a
 *  mano podría enlazar un proveedor. */
export const TIPOS_DE_CLIENTE: readonly (ContactType | null)[] = [
  ContactType.CLIENT,
  ContactType.UNKNOWN,
  // `null` es un contacto anterior al backfill de la migración b29, que es lo
  // mismo que UNKNOWN: todavía no se sabe qué es, y el cajero lo ve.
  null,
];

export function esContactoDeCliente(type: ContactType | null): boolean {
  return TIPOS_DE_CLIENTE.includes(type);
}

/**
 * El cerrojo. Va por `$executeRawUnsafe` y no por `$queryRawUnsafe` a
 * propósito: `pg_advisory_xact_lock` devuelve `void`, y Prisma no sabe
 * deserializar esa columna («Failed to deserialize column of type 'void'»).
 * Aquí no se quiere leer nada — se quiere ejecutar una sentencia.
 */
export const CERROJO_SQL =
  "SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))";

/**
 * `Contact.name` es UN SOLO CAMPO y `Client` tiene dos. Hay que partirlo.
 *
 * Criterio: **la primera palabra es el nombre, el resto son los apellidos.**
 * Tonto y documentado a propósito. Cualquier heurística más lista («Ana Belén»
 * es un nombre compuesto, «de la Fuente» es una partícula) acierta unas veces y
 * se equivoca otras, y la recepcionista no puede saber cuál le tocó: se
 * encontraría fichas partidas de dos maneras distintas sin explicación. Con una
 * regla fija, lo que sale mal sale mal SIEMPRE IGUAL y se corrige a mano en la
 * ficha en dos segundos.
 *
 * Los apellidos pueden quedar vacíos, y por eso el frente 3 (apellidos
 * opcionales en la API) va ANTES que éste.
 */
export function partirNombre(name: string): {
  firstName: string;
  lastName: string;
} {
  const partes = name.trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) {
    // `Contact.name` no puede ser vacío (el upsert pone «(sin nombre)»), pero
    // un nombre que sean sólo espacios llegaría aquí. No se inventa nada.
    return { firstName: "(sin nombre)", lastName: "" };
  }
  return {
    firstName: partes[0]!.slice(0, 120),
    lastName: partes.slice(1).join(" ").slice(0, 120),
  };
}

/** Lo mínimo de Prisma que necesita `enlazarContacto`. Tiparlo así deja el
 *  test de unidad con un doble pequeño en vez de un `PrismaClient` entero. */
export interface PrismaParaEnlace {
  $transaction: <T>(fn: (tx: PrismaParaEnlace) => Promise<T>) => Promise<T>;
  $executeRawUnsafe: (sql: string, ...args: unknown[]) => Promise<unknown>;
  client: {
    findFirst: (args: unknown) => Promise<unknown>;
    create: (args: unknown) => Promise<unknown>;
  };
}

/**
 * Devuelve el cliente enlazado a ese contacto, creándolo si no lo había.
 *
 * Idempotente: llamarlo dos veces —o dos veces A LA VEZ— deja un solo cliente.
 */
export async function enlazarContacto<T>(
  prisma: PrismaParaEnlace,
  tenantId: string,
  contacto: ContactoEnlazable,
  select: Prisma.ClientSelect,
): Promise<{ client: T; created: boolean }> {
  return prisma.$transaction(async (tx) => {
    // EL CERROJO. Va lo primero de la transacción: cualquier cosa que se lea
    // antes se lee sin protección y no sirve de nada.
    await tx.$executeRawUnsafe(
      CERROJO_SQL,
      tenantId,
      contacto.holdedContactId,
    );
    const ya = (await tx.client.findFirst({
      where: { tenantId, holdedContactId: contacto.holdedContactId },
      select,
    })) as T | null;
    if (ya) return { client: ya, created: false };

    const { firstName, lastName } = partirNombre(contacto.name);
    const creado = (await tx.client.create({
      data: {
        tenantId,
        firstName,
        lastName,
        // Se copian si los hay. No se inventa ninguno, y NO se toca Holded.
        phone: contacto.phone?.trim() || null,
        email: contacto.email?.trim() || null,
        holdedContactId: contacto.holdedContactId,
      },
      select,
    })) as T;
    return { client: creado, created: true };
  });
}

/** El `PrismaClient` de verdad encaja en `PrismaParaEnlace`; este alias lo
 *  deja explícito en el sitio de llamada sin un `as any`. */
export function comoPrismaParaEnlace(p: PrismaClient): PrismaParaEnlace {
  return p as unknown as PrismaParaEnlace;
}
