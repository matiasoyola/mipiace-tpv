// residencia-1 + residencia-2 · LA SEMILLA DEL CENTRO.
//
// residencia-1 sembraba los diez roles de cuidado y los tres turnos.
// residencia-2 le añade tres cosas más, y las tres por la misma razón que
// las dos primeras —que un centro recién encendido tiene que FUNCIONAR y
// no enseñar tres pantallas vacías—:
//
//   · los cinco MOMENTOS DEL DÍA (`CenterMoment`), con las horas de
//     Jardín de Gredos;
//   · un AJUSTE por cada control de serie (`CenterControlSetting`), con
//     los valores del producto: activo, sin alias, la frecuencia de serie,
//     los roles de serie e interno para la familia (D-60);
//   · la copia de las tres PLANTILLAS por nivel de dependencia
//     (`CarePlanTemplateItem`), que es la que el centro edita.
//
// Sin lo segundo, la pantalla de Controles saldría vacía y `queToca` no
// sabría si un control está activo. Sin lo tercero, dar de alta a un
// residente no le precargaría nada y habría que montarle el plan a mano,
// que es justo el trabajo que este bloque existe para quitar.
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

import { CONTROLES_DE_SERIE } from "./catalogo/controles-de-serie.js";
import { MOMENTOS_DE_SERIE } from "./catalogo/momentos-de-serie.js";
import { PLANTILLAS_DE_SERIE } from "./catalogo/plantillas-de-serie.js";
import { aColumnas } from "./frecuencia-columnas.js";
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

/**
 * Lo mínimo de Prisma (o de una transacción) que hace falta sembrar.
 *
 * Se declara el mínimo y no `PrismaClient` entero por lo mismo que
 * `residenciaIsEnabled` lee con cuidado la forma del cliente: la suite
 * tiene dobles que no exponen el modelo completo, y un doble que no sabe
 * sembrar debe fallar en el tipo y no en caliente.
 */
export interface PrismaParaSemilla {
  careRole: {
    createMany: (args: unknown) => Promise<unknown>;
  };
  centerShift: {
    createMany: (args: unknown) => Promise<unknown>;
  };
  centerMoment: {
    createMany: (args: unknown) => Promise<unknown>;
  };
  centerControlSetting: {
    createMany: (args: unknown) => Promise<unknown>;
  };
  carePlanTemplateItem: {
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

  // ── residencia-2 · los momentos del día ──────────────────────────
  await prisma.centerMoment.createMany({
    data: MOMENTOS_DE_SERIE.map((m) => ({
      tenantId,
      code: m.code,
      name: m.name,
      atTime: m.atTime,
      sortOrder: m.sortOrder,
    })),
    skipDuplicates: true,
  });

  // ── residencia-2 · un ajuste por control de serie ────────────────
  //
  // Se leen del FICHERO de datos y no de `control_types`, y es a
  // propósito: así sembrar un centro no depende de que el seed global
  // haya corrido antes, y la transacción del interruptor no tiene que
  // consultar el catálogo. Lo que el centro se encuentra es exactamente
  // lo que el producto propone.
  //
  // `careRoleCodes` nace con los roles de serie del control —y no vacío—
  // para que la pantalla de Controles enseñe quién lo registra sin tener
  // que explicar que «vacío significa todos». Estrecharlo es quitar
  // casillas, que es lo que la dirección va a hacer.
  await prisma.centerControlSetting.createMany({
    data: CONTROLES_DE_SERIE.map((c) => ({
      tenantId,
      controlCode: c.code,
      active: true,
      alias: null,
      ...aColumnas({
        kind: c.defaultFrequency.kind,
        everyNHours: c.defaultFrequency.everyNHours,
        everyNDays: c.defaultFrequency.everyNDays,
        weekdays: c.defaultFrequency.weekdays,
        monthDay: c.defaultFrequency.monthDay,
        shiftCodes: c.defaultFrequency.shiftCodes,
        momentCodes: c.defaultFrequency.momentCodes,
      }),
      careRoleCodes: c.allowedCareRoleCodes,
      // D-60: todo interno por defecto. No hay portal en la v1.
      familyVisible: c.familyVisibleDefault ?? false,
    })),
    skipDuplicates: true,
  });

  // ── residencia-2 · la copia de las tres plantillas ───────────────
  //
  // `skipDuplicates` sobre `(tenantId, dependencyLevel, controlCode)`:
  // apagar y volver a encender el módulo no duplica nada y **no
  // resucita lo que el centro quitó de su plantilla**. Mismo criterio
  // que los roles de serie desactivados.
  await prisma.carePlanTemplateItem.createMany({
    data: (Object.entries(PLANTILLAS_DE_SERIE) as Array<
      [keyof typeof PLANTILLAS_DE_SERIE, (typeof PLANTILLAS_DE_SERIE)["VALIDO"]]
    >).flatMap(([nivel, lineas]) =>
      lineas.map((l) => ({
        tenantId,
        dependencyLevel: nivel,
        controlCode: l.controlCode,
        ...aColumnas({
          kind: l.frequency.kind,
          everyNHours: l.frequency.everyNHours,
          everyNDays: l.frequency.everyNDays,
          weekdays: l.frequency.weekdays,
          monthDay: l.frequency.monthDay,
          shiftCodes: l.frequency.shiftCodes,
          momentCodes: l.frequency.momentCodes,
        }),
      })),
    ),
    skipDuplicates: true,
  });
}
