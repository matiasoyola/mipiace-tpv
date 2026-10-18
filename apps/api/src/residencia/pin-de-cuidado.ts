// residencia-4 · **EL PIN DE CUIDADO, EN UN SOLO SITIO.**
//
// residencia-3 escribió la resolución del PIN dentro de la ruta de la
// puerta: la huella HMAC encuentra la fila, argon2id la verifica contra
// ESA fila y nada más. Este bloque necesita exactamente lo mismo en el
// móvil de guardia —«al empezar el turno, quien coge el móvil entra con
// su PIN» (D-66)— y lo que no se puede hacer es escribirlo dos veces.
//
// Dos implementaciones de «encontrar a alguien por cuatro cifras» son dos
// sitios donde la huella se puede calcular con un salt distinto, y
// entonces el PIN de la plantilla abre la puerta y no abre el móvil. Eso
// es un turno entero sin nadie de guardia.
//
// Lo que **no** se mueve aquí y sigue en cada ruta, porque es distinto en
// cada una:
//
//   · **el rate-limit**, porque la clave es el aparato y los números son
//     de la pantalla. La puerta se canda dos minutos a los diez intentos
//     (residencia-3 §2: un candado largo bloquea el registro de cuidados
//     de una habitación). El móvil de guardia se canda igual, y la razón
//     es la misma por el otro lado: un móvil candado es un móvil que no
//     se puede poner de guardia;
//   · **qué pasa después**: la puerta abre una sesión de pantalla; el
//     móvil abre una GUARDIA, que es otra cosa.

import type { PrismaClient } from "@mipiacetpv/db";

import { verifyPassword } from "../auth/passwords.js";
import { dekONada } from "../clinica/claves.js";
import {
  huellaDePinDePuerta,
  subclaveDePinDePuerta,
} from "../clinica/cripto.js";

/** Una capacidad vigente de quien tecleó el PIN. */
export interface CapacidadDelPin {
  assignmentId: string;
  code: string;
  name: string;
  category: string;
}

/** Quién tecleó, con sus capacidades vigentes. */
export interface QuienTecleo {
  userId: string;
  nombre: string;
  roles: CapacidadDelPin[];
}

export type ResultadoDelPin =
  | { ok: true; quien: QuienTecleo }
  /** El centro no tiene clave clínica: no puede tener PIN de cuidado.
   *  No es «PIN incorrecto» — ni éste ni ninguno va a entrar. */
  | { ok: false; motivo: "SIN_CLAVE" }
  /** No hay nadie con ese PIN, o el PIN no es el suyo. La misma
   *  respuesta para las dos: decir cuál es permite barrer el espacio de
   *  cuatro cifras aprendiendo qué PIN existen. */
  | { ok: false; motivo: "NO_CUADRA" }
  /** El PIN es bueno y esa persona ya no tiene rol de cuidado vigente. */
  | { ok: false; motivo: "SIN_ROL" };

/**
 * Encuentra a quien tecleó, y lo verifica.
 *
 * La huella es una consulta indexada; argon2id corre **una sola vez**,
 * contra la fila que la huella encontró. Probarlo contra los veinte de la
 * plantilla serían cinco segundos y 1,3 GB por intento (residencia-3 §2).
 *
 * Y se verifica igual aunque la huella cuadre, porque una huella escrita
 * a mano en la base no debe abrir nada.
 */
export async function resolverPinDeCuidado(
  prisma: PrismaClient,
  input: { tenantId: string; pin: string; ahora: Date },
): Promise<ResultadoDelPin> {
  const dek = await dekONada(input.tenantId, prisma);
  if (dek == null) return { ok: false, motivo: "SIN_CLAVE" };

  const huella = huellaDePinDePuerta(
    input.pin,
    subclaveDePinDePuerta(dek, input.tenantId),
    input.tenantId,
  );
  const fila = await prisma.carePin.findUnique({
    where: {
      tenantId_pinLookup: { tenantId: input.tenantId, pinLookup: huella },
    },
    select: {
      userId: true,
      pinHash: true,
      user: {
        select: {
          id: true,
          alias: true,
          email: true,
          careRoleAssignments: {
            where: {
              revokedAt: null,
              careRole: { active: true, recordsCare: true },
            },
            select: {
              id: true,
              fromAt: true,
              toAt: true,
              careRole: { select: { code: true, name: true, category: true } },
            },
          },
        },
      },
    },
  });
  if (!fila || !(await verifyPassword(fila.pinHash, input.pin))) {
    return { ok: false, motivo: "NO_CUADRA" };
  }

  const vivos = fila.user.careRoleAssignments.filter(
    (a) => a.fromAt <= input.ahora && (a.toAt == null || a.toAt > input.ahora),
  );
  if (vivos.length === 0) return { ok: false, motivo: "SIN_ROL" };

  return {
    ok: true,
    quien: {
      userId: fila.user.id,
      nombre: fila.user.alias ?? (fila.user.email.split("@")[0] ?? fila.user.email),
      roles: vivos.map((a) => ({
        assignmentId: a.id,
        code: a.careRole.code,
        name: a.careRole.name,
        category: a.careRole.category,
      })),
    },
  };
}
