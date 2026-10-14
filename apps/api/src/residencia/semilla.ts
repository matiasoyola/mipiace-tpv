// residencia-1 · LA SEMILLA DEL CENTRO: los diez roles de cuidado de
// serie y los tres turnos.
//
// Corre UNA VEZ, al encender `Tenant.residenciaEnabled`, y dentro de la
// misma transacción que el `update` del interruptor y su línea de
// auditoría. Las dos cosas que eso compra:
//
//   · Un centro con el interruptor encendido y sin roles de cuidado es un
//     centro donde **nadie puede ver a nadie**: la función de acceso exige
//     rol de cuidado vigente. La dirección llamaría el primer día diciendo
//     que el producto está roto, y tendría razón.
//   · Un centro sin turnos deja todos los registros de residencia-3 sin
//     turno, y el turno es la unidad del relevo. Mejor tres de serie que
//     una pantalla vacía con un «añade tu primer turno».
//
// **Idempotente**: `skipDuplicates` sobre `(tenantId, code)`. Apagar y
// volver a encender el interruptor no duplica nada y no resucita lo que el
// centro desactivó — un rol de serie que la dirección apagó se queda
// apagado, porque la semilla no pisa filas, sólo añade las que faltan.
//
// ── Por qué por tenant y no un catálogo global ───────────────────────
//
// El prompt pide que un centro pueda **desactivar** roles de serie y
// **añadir** los suyos. Con un catálogo global (`tenantId` nulo) hacen
// falta dos tablas: el catálogo y una de excepciones por centro, y toda
// consulta de roles pasa a ser una unión con un `NOT EXISTS`. Con la
// semilla por centro es una tabla y un `active`.
//
// Lo que se pierde: distribuir un rol nuevo de serie a los centros que ya
// existen deja de ser un INSERT y pasa a ser un backfill. Se acepta: es
// una vez al año como mucho (D-57 revisa el catálogo clínico anualmente) y
// el día que pase, un script lo resuelve. Lo que no se puede permitir es
// que la consulta de «¿tiene rol de cuidado vigente?» —que corre en cada
// apertura de ficha, 49 veces por turno— sea una unión.

import type { CareRoleCategory } from "@mipiacetpv/db";

import { TURNOS_DE_SERIE } from "./turnos.js";

/**
 * Los diez roles de serie (D-50), con los tres flags de los que cuelga el
 * acceso. Las decisiones, una por columna:
 *
 * · `recordsCare` · **todos salvo administración**. Es la lista del prompt
 *   (§4) y la razón es física: en una residencia, la limpiadora y la
 *   cocinera registran («habitación hecha», «comió la mitad»), y la
 *   administrativa no entra en las habitaciones. Quien registra queda
 *   `isClinician = true` (D-51); quien no, no.
 *
 * · `requiresLicense` · **DUE, médico, fisio y TO**, los cuatro que el
 *   prompt nombra. Son las profesiones con colegio profesional obligatorio
 *   (Ley 44/2003 para las sanitarias). La auxiliar y la limpiadora
 *   registran y no tienen número de colegiado, y pedírselo habría dejado a
 *   media plantilla sin poder entrar en la puerta.
 *
 * · `fullScope` · **DUE, médico, calidad y dirección** (D-51). Los dos
 *   primeros porque la clínica de un residente no se parte por plantas: la
 *   DUE de guardia atiende el centro. Calidad porque su trabajo es
 *   justamente mirar el conjunto (ISO 9001), y dirección porque responde
 *   de todo él ante AENOR y la Consejería.
 *
 * Y la combinación que llama la atención y es correcta: **calidad y
 * dirección ven todo el centro y además registran**. Registran poco —una
 * revisión, una obligación cumplida— pero lo hacen, y lo que firmen tiene
 * que llevar su capacidad.
 */
export const ROLES_DE_SERIE: Array<{
  code: string;
  name: string;
  category: CareRoleCategory;
  recordsCare: boolean;
  requiresLicense: boolean;
  fullScope: boolean;
  sortOrder: number;
}> = [
  {
    code: "AUXILIAR",
    name: "Auxiliar / gerocultora",
    category: "OPERATIVO",
    recordsCare: true,
    requiresLicense: false,
    fullScope: false,
    sortOrder: 1,
  },
  {
    code: "DUE",
    name: "DUE (enfermería)",
    category: "SUPERVISOR",
    recordsCare: true,
    requiresLicense: true,
    fullScope: true,
    sortOrder: 2,
  },
  {
    code: "MEDICO",
    name: "Médico",
    category: "SUPERVISOR",
    recordsCare: true,
    requiresLicense: true,
    fullScope: true,
    sortOrder: 3,
  },
  {
    code: "TO",
    name: "Terapeuta ocupacional",
    category: "OPERATIVO",
    recordsCare: true,
    requiresLicense: true,
    fullScope: false,
    sortOrder: 4,
  },
  {
    code: "FISIO",
    name: "Fisioterapeuta",
    category: "OPERATIVO",
    recordsCare: true,
    requiresLicense: true,
    fullScope: false,
    sortOrder: 5,
  },
  {
    code: "LIMPIEZA",
    name: "Limpieza",
    category: "OPERATIVO",
    recordsCare: true,
    requiresLicense: false,
    fullScope: false,
    sortOrder: 6,
  },
  {
    code: "COCINA",
    name: "Cocina",
    category: "OPERATIVO",
    recordsCare: true,
    requiresLicense: false,
    fullScope: false,
    sortOrder: 7,
  },
  {
    code: "CALIDAD",
    name: "Calidad",
    category: "SUPERVISOR",
    recordsCare: true,
    requiresLicense: false,
    fullScope: true,
    sortOrder: 8,
  },
  {
    code: "DIRECCION",
    name: "Dirección",
    category: "DIRECTIVO",
    recordsCare: true,
    requiresLicense: false,
    fullScope: true,
    sortOrder: 9,
  },
  {
    // El único que NO registra. Lleva facturas, plazas y expedientes; no
    // entra en las habitaciones y no tiene por qué ver la salud de nadie.
    code: "ADMINISTRACION",
    name: "Administración",
    category: "OPERATIVO",
    recordsCare: false,
    requiresLicense: false,
    fullScope: false,
    sortOrder: 10,
  },
];

/** Lo mínimo de Prisma (o de una transacción) que hace falta sembrar. */
export interface PrismaParaSemilla {
  careRole: {
    createMany: (args: unknown) => Promise<unknown>;
  };
  centerShift: {
    createMany: (args: unknown) => Promise<unknown>;
  };
}

/**
 * Siembra los roles de cuidado y los turnos de un centro.
 *
 * `skipDuplicates` en los dos: la unicidad es `(tenantId, code)`, así que
 * volver a sembrar no duplica ni pisa. Se puede llamar dos veces.
 */
export async function sembrarResidencia(
  prisma: PrismaParaSemilla,
  tenantId: string,
): Promise<void> {
  await prisma.careRole.createMany({
    data: ROLES_DE_SERIE.map((r) => ({
      tenantId,
      code: r.code,
      name: r.name,
      category: r.category,
      isStandard: true,
      active: true,
      sortOrder: r.sortOrder,
      recordsCare: r.recordsCare,
      requiresLicense: r.requiresLicense,
      fullScope: r.fullScope,
    })),
    skipDuplicates: true,
  });
  await prisma.centerShift.createMany({
    data: TURNOS_DE_SERIE.map((t) => ({
      tenantId,
      code: t.code,
      name: t.name,
      startsAt: t.startsAt,
      endsAt: t.endsAt,
      sortOrder: t.sortOrder,
    })),
    skipDuplicates: true,
  });
}
