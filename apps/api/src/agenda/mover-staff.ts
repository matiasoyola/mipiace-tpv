// mover-con-otra · la puerta de «cambiar de peluquera al mover».
//
// POR QUÉ ESTO VIVE EN LA RUTA Y NO EN EL MOTOR. El motor ya sabe fijar a
// quien le pasen (agenda-lista §2b: `reschedule(..., staffUserId)` alimenta
// los dos sitios que fijan y también `computeSlots`). Lo que NO sabe es
// DISTINGUIR por qué no cabe: medido antes de escribir una línea, fijar a
// una peluquera sin la skill devuelve
//
//     { ok: false, reason: "NO_SLOT", alternatives: [] }
//
// exactamente igual que si estuviera llena todo el día. La causa está en
// `engine.ts:222`: `loadContext` filtra los skilled por la fijada, se queda
// con un conjunto vacío, y a partir de ahí el motor no tiene a nadie a
// quien mirar. `HoldFailureReason` no tiene —ni va a tener en este bloque—
// un miembro de skill: tocar esa lógica estaba fuera de alcance.
//
// Así que el «no» de skill se decide AQUÍ, con la matriz, ANTES de llamar
// al motor. Dos consecuencias buenas:
//
//   · la cajera lee "Ana no hace Tinte", que es lo que le dice a la
//     clienta, en vez de "no se pudo mover a ese hueco";
//   · y la peluquera de OTRO centro deja de salir como un «no hay hueco».
//     Hoy ya es segura —`getSkilledStaff` filtra por `tenant_id`, así que
//     nunca hubo asignación cruzada ni 500—, pero era muda.
//
// Esta función es PURA a propósito: los tres datos que necesita se leen en
// la ruta y el cruce se prueba sin BD ni Fastify.

/** Un perfil de agenda del centro, tal y como lo da `getStaffProfiles`. */
export interface PerfilDeAgenda {
  userId: string;
  displayName: string;
  active: boolean;
}

/** El rechazo ya redactado, listo para `reply.code(...).send(...)`. */
export interface RechazoDeProfesional {
  status: 404 | 409;
  error: "STAFF_NOT_FOUND" | "STAFF_NO_SKILL";
  message: string;
}

export interface ComprobarProfesionalInput {
  /** La peluquera que el cuerpo del PATCH pide fijar. */
  staffUserId: string;
  /** Los perfiles de agenda de ESTE tenant (activos e inactivos). */
  perfiles: PerfilDeAgenda[];
  /** Los servicios de la cita, en su orden, sin repetir. */
  serviceIds: string[];
  /** serviceId -> quién lo sabe hacer hoy (perfil activo). */
  sabenHacer: Map<string, Set<string>>;
  /** serviceId -> nombre de catálogo. Puede faltar alguno. */
  nombres: Map<string, string>;
}

/** "Tinte", "Tinte y Mechas", "Tinte, Mechas y Corte". */
function enumerar(partes: string[]): string {
  if (partes.length <= 1) return partes[0] ?? "";
  return `${partes.slice(0, -1).join(", ")} y ${partes[partes.length - 1]!}`;
}

/**
 * ¿Se le puede fijar esta peluquera a esta cita? `null` = adelante.
 *
 * El orden importa: primero QUIÉN es (si no es del centro, hablar de skills
 * sería hablar de alguien que no existe), después QUÉ sabe hacer.
 */
export function comprobarProfesional(
  input: ComprobarProfesionalInput,
): RechazoDeProfesional | null {
  const { staffUserId, perfiles, serviceIds, sabenHacer, nombres } = input;

  // 1 · ¿es personal de este centro, y con perfil de agenda vivo?
  //
  // Los dos casos son 404 porque desde el mostrador son lo mismo: esa
  // peluquera no está ahí para darle la cita. Se separan en el MENSAJE
  // porque de la inactiva sí sabemos el nombre, y "Ana ya no está en la
  // agenda" se entiende; "no existe" sobre una Ana que la cajera acaba de
  // ver en la pantalla, no.
  const perfil = perfiles.find((p) => p.userId === staffUserId);
  if (!perfil) {
    return {
      status: 404,
      error: "STAFF_NOT_FOUND",
      message: "Esa profesional no es de este centro.",
    };
  }
  if (!perfil.active) {
    return {
      status: 404,
      error: "STAFF_NOT_FOUND",
      message: `${perfil.displayName} ya no está activa en la agenda.`,
    };
  }

  // 2 · ¿sabe hacer TODOS los servicios de la cita?
  //
  // Todos, no alguno: una cita de corte + tinte la tiene que poder hacer
  // ella entera. El motor encadena los items sobre la fijada, así que
  // media cita no es media respuesta: es un NO_SLOT sin explicación.
  const sinSkill = serviceIds.filter(
    (sid) => !(sabenHacer.get(sid) ?? new Set()).has(staffUserId),
  );
  if (sinSkill.length > 0) {
    const falta = enumerar(sinSkill.map((sid) => nombres.get(sid) ?? "ese servicio"));
    return {
      status: 409,
      error: "STAFF_NO_SKILL",
      message: `${perfil.displayName} no hace ${falta}.`,
    };
  }

  return null;
}
