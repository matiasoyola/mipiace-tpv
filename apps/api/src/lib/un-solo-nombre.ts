// clinica-9 (5) · UN SOLO NOMBRE, Y QUE LLEGUE A LA DUEÑA.
//
// La pasada en hierro del 24-10 encontró `m.oyola+clinica-demo` escrito en
// seis superficies de la «Clínica demo»: los cajeros recientes del PIN,
// «Atiende» de la cita, «Firmada por» de la sesión, el «corregido por» de
// la valoración, la hoja de «Revisa lo que se va a firmar» y la
// aceptación del contrato. En un informe que sale de la consulta, el email
// de trabajo de quien firma no es un nombre: es un dato de contacto
// interno que acaba en el bolso de una paciente.
//
// Y no es que no hubiera nombre. Lo había, en Personal: **«Nombre en la
// agenda» = Rosario** (`staff_profiles.display_name`). Lo que pasa es que
// hay DOS columnas con el nombre de la misma persona:
//
//   · `users.alias` — «nombre visible del cajero; sustituye al email en
//     todos los puntos de display» (v1.7). Es lo que lee
//     `nombreParaMostrar`, o sea las seis superficies de arriba.
//   · `staff_profiles.display_name` — el nombre del profesional en la
//     agenda. Es lo que la dueña teclea en Personal.
//
// Dos columnas, dos pantallas, y ningún puente: el alias se pone desde
// Cajeros, **y la propietaria no sale en Cajeros** (esa lista es de
// `MANAGER`/`CASHIER`/`CLINICIAN`). Así que la dueña de una clínica no
// tenía NINGUNA pantalla desde la que ponerse el nombre, y el suyo era el
// único que no se podía arreglar.
//
// ── Lo que se hace, y lo que NO ──────────────────────────────────────
//
// No se fusionan las columnas. Fusionarlas sería una migración de quince
// bases para ahorrar una escritura, y las dos tienen sentido por separado:
// hay usuarios sin perfil de agenda (un cajero de barra) y puede haber
// recursos de agenda que no son usuarios.
//
// Lo que se hace es que **las dos se escriban juntas, desde las dos
// pantallas**: guardar el nombre en Personal lo escribe también como
// `alias`, y renombrar en Cajeros lo escribe también como «Nombre en la
// agenda» de quien tenga perfil. Un solo nombre manda, se teclee donde se
// teclee.
//
// Para las cuentas que ya existen —la «Clínica demo», entre ellas— no
// hace falta migración ni script: **el primer guardado de Personal lo
// arregla**, que es exactamente el gesto que la dueña ya hace cuando ve su
// email en una pantalla.

import type { Prisma, PrismaClient } from "@mipiacetpv/db";

type Ejecutor = PrismaClient | Prisma.TransactionClient;

/**
 * El nombre que se va a escribir, limpio, o `null` si no hay ninguno.
 *
 * Un nombre que son espacios es no tener nombre: escribirlo dejaría un
 * alias en blanco que `nombreParaMostrar` trataría como presente y
 * pintaría vacío, que es peor que la local-part del email.
 */
export function nombreLimpio(x: string | null | undefined): string | null {
  const n = (x ?? "").trim();
  return n.length > 0 ? n : null;
}

/**
 * ¿Hay otro usuario ACTIVO de este tenant con este nombre?
 *
 * Es la misma pregunta que `findAliasCollision` de `cashiers/routes.ts`
 * —case-insensitive, sin los revocados— y vive aquí porque ahora la hacen
 * dos pantallas. Dos copias serían dos criterios, y entonces una pantalla
 * podría crear la colisión que la otra rechaza.
 *
 * clinica-9 (6) · y **el actor de sistema no cuenta**: «Paciente (por
 * enlace)» es una fila por tenant, no una persona, y que su nombre
 * bloqueara el de alguien sería absurdo.
 */
export async function otroConEseNombre(
  prisma: Ejecutor,
  input: { tenantId: string; nombre: string; exceptoUserId: string },
): Promise<boolean> {
  const otro = await (prisma as PrismaClient).user.findFirst({
    where: {
      tenantId: input.tenantId,
      role: { in: ["OWNER", "MANAGER", "CASHIER", "CLINICIAN"] },
      alias: { equals: input.nombre, mode: "insensitive" },
      deletedAt: null,
      isSystemActor: false,
      NOT: [
        { email: { endsWith: "@revoked.local" } },
        { id: input.exceptoUserId },
      ],
    },
    select: { id: true },
  });
  return otro != null;
}

/**
 * Escribe el nombre en las DOS columnas.
 *
 * `crearPerfil: false` (el caso de Cajeros) sólo actualiza el perfil de
 * agenda si ya existe: un cajero de barra no tiene por qué aparecer como
 * profesional de la agenda por haberse renombrado.
 *
 * Devuelve lo escrito para que quien llama conteste con ello y no con lo
 * que creía haber mandado.
 */
export async function escribirElNombre(
  prisma: Ejecutor,
  input: {
    tenantId: string;
    userId: string;
    nombre: string;
    /** `true` desde Personal, que es donde el perfil de agenda nace. */
    crearPerfil: boolean;
    /** Lo demás del perfil, cuando viene de Personal. */
    perfil?: { color?: string | null; active?: boolean };
  },
): Promise<{ id: string; email: string; alias: string | null; role: string }> {
  const p = prisma as PrismaClient;
  const usuario = await p.user.update({
    where: { id: input.userId },
    data: { alias: input.nombre },
    select: { id: true, email: true, alias: true, role: true },
  });
  if (input.crearPerfil) {
    await p.staffProfile.upsert({
      where: { userId: input.userId },
      create: {
        userId: input.userId,
        tenantId: input.tenantId,
        displayName: input.nombre,
        color: input.perfil?.color ?? null,
        active: input.perfil?.active ?? true,
      },
      update: {
        displayName: input.nombre,
        color: input.perfil?.color ?? null,
        ...(input.perfil?.active !== undefined
          ? { active: input.perfil.active }
          : {}),
      },
    });
    return usuario;
  }
  // Desde Cajeros: sólo si ya tiene perfil de agenda.
  await p.staffProfile.updateMany({
    where: { userId: input.userId },
    data: { displayName: input.nombre },
  });
  return usuario;
}
