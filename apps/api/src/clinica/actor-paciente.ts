// clinica-2 · EL PACIENTE NO ES UN `User`, PERO SÍ ESCRIBE EN SU HISTORIA.
//
// Este fichero resuelve el problema que el prompt del bloque señala y pide
// declarar: `ClinicalAccessLog.userId` es NOT NULL, y cuando el paciente
// contesta el test por el enlace hay que dejar línea en el registro
// (`WRITE`) y escribir una entrada de historia con autor. Lo mismo vale
// para `ClinicalEntry.authorUserId`.
//
// ── Las dos salidas, y por qué se elige ésta ──────────────────────────
//
//   a) **Relajar los NOT NULL** y añadir una columna «qué clase de actor
//      fue». Se descarta. Esos NOT NULL con RESTRICT son la garantía de
//      clinica-1 de que ninguna línea de historia es anónima («una línea
//      sin autor no es historia clínica, es una nota anónima»).
//      Convertirla en «ninguna línea sin autor, salvo estas» es perder la
//      invariante entera para ahorrar una fila — y además obliga a que
//      cada consulta, cada join y cada pantalla que lea autoría lleve su
//      caso especial para siempre.
//
//   b) **Darle una fila al paciente.** Un actor de sistema por tenant,
//      «Paciente (por enlace)». La autoría sigue siendo NOT NULL, el
//      registro de accesos no necesita ningún caso especial, y la pantalla
//      lee su `alias` como el de cualquier autor. La ruta del registro que
//      se le enseña a un inspector («quién ha abierto la historia de este
//      paciente») contesta, sin tocar nada, «la escribió el paciente por
//      el enlace».
//
// Se elige (b). El coste es una fila por tenant clínico y las cuatro
// listas de personas que tienen que excluirla; el beneficio es que la
// invariante legal no se toca.
//
// ── No puede autenticarse NUNCA, y no por omisión ─────────────────────
//
// El CHECK `users_system_actor_no_credentials` (migración
// `clinica_2_tipos`) prohíbe que un actor de sistema tenga `passwordHash`
// o `pinHash`. Sin password no hay login de panel y sin PIN no hay login
// de TPV (`/shift/cashier-login` rechaza al usuario sin PIN antes de
// comparar nada). Las dos puertas quedan cerradas por el motor y no por la
// confianza en que a nadie se le ocurra darle credenciales — incluida la
// dirección contraria, que es la peligrosa: tampoco se puede marcar como
// actor de sistema a alguien que YA tiene credenciales.
//
// ── Y no es alguien a quien dar de alta ───────────────────────────────
//
// No sale en `GET /cashiers`, ni en `GET /staff`, ni entre los candidatos
// a PIN de encargado, ni cuenta para la colisión de alias. Esas cuatro
// listas filtran por `isSystemActor: false`, y el filtro es nuevo sobre un
// valor que nace en `false`: ningún tenant de hoy cambia de
// comportamiento.
//
// ── Se crea perezosamente, dentro de la transacción ───────────────────
//
// No se siembra en la migración: hoy no hay ningún tenant con la clínica
// encendida, y sembrar usuarios en una migración es sembrar filas que
// nadie ha pedido en quince bases. Nace la primera vez que un paciente
// contesta, en la MISMA transacción que su respuesta — si la respuesta se
// cae, el actor tampoco queda.

import type { Prisma, PrismaClient } from "@mipiacetpv/db";

/** El nombre visible. Lo lee `autorView` como el alias de cualquiera. */
export const ALIAS_ACTOR_PACIENTE = "Paciente (por enlace)";

/**
 * El email del actor. Es una credencial técnica, no un buzón: el dominio
 * `.local` no resuelve y nadie puede recibir nada ahí. Mismo criterio que
 * el centinela `@revoked.local` de la baja de cajeros.
 *
 * Lleva el `tenantId` porque `users.email` es único GLOBALMENTE: un solo
 * `paciente@enlace.local` haría que el segundo tenant clínico no pudiera
 * crear el suyo, y el fallo saldría el día de una implantación.
 */
export function emailActorPaciente(tenantId: string): string {
  return `paciente-${tenantId}@enlace.local`;
}

/** Lo mínimo de Prisma (o de un `tx`) que hace falta. */
export interface PrismaParaActor {
  user: {
    findFirst: (args: unknown) => Promise<{ id: string } | null>;
    create: (args: unknown) => Promise<{ id: string }>;
  };
}

/**
 * El id del actor «paciente por enlace» de este tenant, creándolo si no
 * existe.
 *
 * Idempotente por el único de `users.email`: dos peticiones a la vez no
 * crean dos actores — la segunda choca con el único, y el `catch` vuelve a
 * buscar. No se usa `upsert` a propósito: `upsert` sobre `email` querría
 * ESCRIBIR en la fila existente, y lo que hace falta aquí es leerla.
 *
 * Recibe el ejecutor (cliente o `tx`) para poder correr dentro de la
 * transacción de la respuesta del paciente.
 */
export async function resolverActorPaciente(
  prisma: PrismaParaActor,
  tenantId: string,
): Promise<string> {
  const email = emailActorPaciente(tenantId);
  const existente = await prisma.user.findFirst({
    where: { tenantId, isSystemActor: true, email },
    select: { id: true },
  });
  if (existente) return existente.id;

  try {
    const creado = await prisma.user.create({
      data: {
        tenantId,
        email,
        alias: ALIAS_ACTOR_PACIENTE,
        // El rol menos privilegiado que existe. No se añade un valor nuevo
        // al enum para esto: clinica-1 dejó escrito lo que cuesta
        // (veinte sitios que revisar) y aquí no compra nada — lo que
        // impide que este actor haga algo no es su rol, es que no tiene
        // credenciales por CHECK de la base.
        role: "CASHIER",
        // Las dos explícitas, aunque el default ya sea NULL: son la mitad
        // del CHECK y escribirlas dice que es a propósito.
        passwordHash: null,
        pinHash: null,
        isSystemActor: true,
        // No es sanitario: no ve historias, sólo escribe la suya.
        isClinician: false,
      },
      select: { id: true },
    });
    return creado.id;
  } catch {
    // La carrera: otro lo creó entre el `findFirst` y el `create`. El
    // único de `email` lo rechazó, y la fila que vale es la de aquél.
    const tras = await prisma.user.findFirst({
      where: { tenantId, isSystemActor: true, email },
      select: { id: true },
    });
    if (tras) return tras.id;
    // Si tampoco está, el fallo no era la carrera: que suba.
    throw new Error(
      "no se pudo resolver el actor «paciente por enlace» del tenant",
    );
  }
}

/** La misma función sobre un `tx` de Prisma, con el tipo que toca. */
export function comoPrismaParaActor(
  prisma: PrismaClient | Prisma.TransactionClient,
): PrismaParaActor {
  return prisma as unknown as PrismaParaActor;
}
