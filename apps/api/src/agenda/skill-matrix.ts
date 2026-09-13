// B-reservas-9 · La matriz servicio × profesional, editable desde los dos
// lados (P7).
//
// Es el INVENTARIO, no la configuración: si nadie sabe hacer un servicio,
// ese servicio no se ofrece — y el motor lo descarta en silencio
// (`engine.ts:443`). La tarjeta 1 del panel de salud señala el problema;
// esto es donde se arregla, a un clic.
//
// Dos reglas gobiernan este módulo:
//
//  1. **Ninguna de las dos vistas esconde el dato** (regla nº 1 de la
//     auditoría del §7.1: "lo oculto no existe"). Un servicio apagado que
//     CONSERVA sus profesionales se sigue enseñando, marcado como apagado,
//     porque esas filas siguen ahí. Un profesional con skills y sin perfil
//     de agenda —o con el perfil inactivo— también sale: el motor lo ignora
//     y nadie lo decía.
//  2. **Los dos lados escriben LO MISMO.** Las dos vías caen en
//     `replaceSkills`, que es una sola escritura; no hay dos
//     implementaciones que puedan divergir. Lo mide un test.

import type { PrismaClient } from "@mipiacetpv/db";

export interface SkillMatrixService {
  id: string;
  name: string;
  /** Tiene ficha de agenda (`service_scheduling`): el motor lo puede ofrecer. */
  agendable: boolean;
  /** Está activo en el catálogo. Un servicio apagado se enseña igual. */
  active: boolean;
  /** Cuántos profesionales exige a la vez (`staff_required`). */
  staffRequired: number;
  /** Quién lo da hoy. Incluye a los que no tienen perfil activo. */
  staffUserIds: string[];
}

export interface SkillMatrixStaff {
  userId: string;
  displayName: string;
  /** Perfil de agenda activo: si no, el motor NO lo tiene en cuenta. */
  active: boolean;
  /** Sin perfil de agenda: sus skills no cuentan para ningún hueco. */
  hasProfile: boolean;
}

export interface SkillMatrix {
  services: SkillMatrixService[];
  staff: SkillMatrixStaff[];
}

export class SkillMatrixError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/**
 * La matriz entera de un centro. Una lectura por tabla: cinco consultas
 * planas y el cruce se hace aquí, no con N+1.
 */
export async function loadSkillMatrix(
  prisma: PrismaClient,
  tenantId: string,
): Promise<SkillMatrix> {
  const [products, scheduling, skills, profiles, users] = await Promise.all([
    prisma.product.findMany({
      where: { tenantId, kind: "SERVICE" },
      orderBy: { name: "asc" },
      select: { id: true, name: true, active: true },
    }),
    prisma.serviceScheduling.findMany({
      where: { tenantId },
      select: { productId: true, staffRequired: true },
    }),
    prisma.staffSkill.findMany({
      where: { tenantId },
      select: { userId: true, serviceId: true },
    }),
    prisma.staffProfile.findMany({
      where: { tenantId },
      orderBy: { displayName: "asc" },
      select: { userId: true, displayName: true, active: true },
    }),
    prisma.user.findMany({
      where: { tenantId, deletedAt: null },
      select: { id: true, alias: true, email: true },
    }),
  ]);

  const schedById = new Map(scheduling.map((s) => [s.productId, s]));
  const byService = new Map<string, string[]>();
  for (const s of skills) {
    const arr = byService.get(s.serviceId) ?? [];
    arr.push(s.userId);
    byService.set(s.serviceId, arr);
  }

  // Un servicio apagado SIN nadie asignado no dice nada y sólo hace ruido;
  // uno apagado que conserva profesionales sí, porque ése es el dato que
  // Koibox escondía. Los activos salen siempre.
  const services: SkillMatrixService[] = products
    .filter((p) => p.active || (byService.get(p.id)?.length ?? 0) > 0)
    .map((p) => ({
      id: p.id,
      name: p.name,
      agendable: schedById.has(p.id),
      active: p.active,
      staffRequired: schedById.get(p.id)?.staffRequired ?? 1,
      staffUserIds: (byService.get(p.id) ?? []).slice().sort(),
    }));

  const profileByUser = new Map(profiles.map((p) => [p.userId, p]));
  const userById = new Map(users.map((u) => [u.id, u]));
  // Columnas = los perfiles de agenda + cualquiera que tenga skills sin
  // perfil (sus filas gobiernan la matriz aunque el motor las ignore).
  const columnIds = new Set<string>([
    ...profiles.map((p) => p.userId),
    ...skills.map((s) => s.userId),
  ]);
  const staff: SkillMatrixStaff[] = [...columnIds]
    .map((userId) => {
      const profile = profileByUser.get(userId);
      const user = userById.get(userId);
      return {
        userId,
        displayName:
          profile?.displayName ?? user?.alias ?? user?.email ?? "Sin nombre",
        active: profile?.active ?? false,
        hasProfile: profile !== undefined,
      };
    })
    .sort((a, b) => a.displayName.localeCompare(b.displayName, "es"));

  return { services, staff };
}

/**
 * Lado A · desde la ficha del profesional: qué servicios da.
 * Reemplaza el set completo de ese profesional.
 */
export async function setSkillsForStaff(
  prisma: PrismaClient,
  tenantId: string,
  userId: string,
  serviceIds: string[],
): Promise<string[]> {
  await assertStaff(prisma, tenantId, [userId]);
  const services = dedupe(serviceIds);
  await assertServices(prisma, tenantId, services);
  const current = await prisma.staffSkill.findMany({
    where: { tenantId, userId },
    select: { serviceId: true },
  });
  await replaceSkills(
    prisma,
    tenantId,
    current.map((s) => ({ userId, serviceId: s.serviceId })),
    services.map((serviceId) => ({ userId, serviceId })),
  );
  return services;
}

/**
 * Lado B · desde la ficha del servicio: quién lo da. La vía que en Koibox
 * es de facto la buena porque es más rápida y menos peligrosa que la suya
 * oficial (§7.1, "lo que hace bien y se copia"). Reemplaza el set completo
 * de ese servicio.
 */
export async function setStaffForService(
  prisma: PrismaClient,
  tenantId: string,
  serviceId: string,
  staffUserIds: string[],
): Promise<string[]> {
  await assertServices(prisma, tenantId, [serviceId]);
  const users = dedupe(staffUserIds);
  await assertStaff(prisma, tenantId, users);
  const current = await prisma.staffSkill.findMany({
    where: { tenantId, serviceId },
    select: { userId: true },
  });
  await replaceSkills(
    prisma,
    tenantId,
    current.map((s) => ({ userId: s.userId, serviceId })),
    users.map((userId) => ({ userId, serviceId })),
  );
  return users;
}

// ── La única escritura ────────────────────────────────────────────────

interface SkillRow {
  userId: string;
  serviceId: string;
}

/**
 * Lleva un tramo de la matriz de `current` a `next`, en una transacción.
 * Los dos lados pasan por aquí: es lo que hace que escribir desde el
 * servicio y desde el profesional sea la misma escritura.
 *
 * Borra sólo las filas que sobran (y no el tramo entero para recrearlo):
 * así una celda que ya estaba conserva su `created_at`.
 */
async function replaceSkills(
  prisma: PrismaClient,
  tenantId: string,
  current: SkillRow[],
  next: SkillRow[],
): Promise<void> {
  const key = (r: SkillRow): string => `${r.userId}|${r.serviceId}`;
  const nextKeys = new Set(next.map(key));
  const currentKeys = new Set(current.map(key));
  const toDelete = current.filter((r) => !nextKeys.has(key(r)));
  const toCreate = next.filter((r) => !currentKeys.has(key(r)));
  if (toDelete.length === 0 && toCreate.length === 0) return;
  await prisma.$transaction([
    ...toDelete.map((r) =>
      prisma.staffSkill.deleteMany({
        where: { tenantId, userId: r.userId, serviceId: r.serviceId },
      }),
    ),
    prisma.staffSkill.createMany({
      data: toCreate.map((r) => ({ ...r, tenantId })),
    }),
  ]);
}

function dedupe(ids: string[]): string[] {
  return [...new Set(ids)];
}

/** Un id desconocido o de otro centro es un 400, nunca un ignorar en silencio. */
async function assertServices(
  prisma: PrismaClient,
  tenantId: string,
  serviceIds: string[],
): Promise<void> {
  if (serviceIds.length === 0) return;
  const found = await prisma.product.findMany({
    where: { tenantId, kind: "SERVICE", id: { in: serviceIds } },
    select: { id: true },
  });
  if (found.length !== serviceIds.length) {
    throw new SkillMatrixError(
      400,
      "INVALID_SERVICE_ID",
      "Algún servicio no existe o no pertenece a este negocio.",
    );
  }
}

/**
 * Asignar a alguien sin perfil de agenda crearía una fila que el motor
 * ignora: la celda se vería marcada y el hueco seguiría sin salir. Es
 * exactamente el fallo que este bloque persigue, así que se rechaza.
 */
async function assertStaff(
  prisma: PrismaClient,
  tenantId: string,
  userIds: string[],
): Promise<void> {
  if (userIds.length === 0) return;
  const profiles = await prisma.staffProfile.findMany({
    where: { tenantId, userId: { in: userIds } },
    select: { userId: true },
  });
  if (profiles.length !== userIds.length) {
    throw new SkillMatrixError(
      409,
      "NO_STAFF_PROFILE",
      "Da de alta el perfil de agenda del profesional antes de asignarle servicios.",
    );
  }
}
