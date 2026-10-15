// residencia-2 (D-21, D-57) · EL SEED DEL CATÁLOGO DE SERIE.
//
// Carga `CONTROLES_DE_SERIE` en `control_types` como filas GLOBALES
// (`scope = STANDARD`, `tenant_id` NULL). Corre al arrancar la API, es
// idempotente y **no es por tenant**: los controles de serie los ven todos
// los centros, que es la mitad de D-21 («se actualiza en el producto y
// baja a todos los centros»).
//
// ── Las tres cosas que hace, y en este orden ─────────────────────────
//
//   1. **Lo que falta, lo inserta.** Un código que no está en la base
//      entra con su versión y sus opciones.
//   2. **Lo que cambió de versión, lo publica.** Si el fichero trae la
//      versión 2 de `CAMBIO_POSTURAL` y en la base está la 1 vigente, se
//      inserta la 2 con su `validFrom` y se le pone `supersededAt` a la 1.
//      **La 1 no se edita ni se borra**: lo que se registró con ella sigue
//      apuntando a ella, y «¿qué decía la guía cuando se apuntó esto?» se
//      puede contestar tres años después.
//   3. **Reconduce los ajustes de los centros que se queden inválidos.**
//      Si la versión nueva retira una frecuencia que un centro había
//      elegido, su ajuste se lleva a la de serie y queda ANOTADO
//      (`reconductedAt` y las dos columnas que lo acompañan). Reconducir
//      en silencio es cambiar el plan de 49 personas sin decírselo a
//      nadie.
//
// Lo que NO hace: tocar una versión ya publicada. Si alguien edita un
// texto del fichero sin subir la versión, el seed **no lo propaga** y lo
// dice en el log. Es a propósito: una versión que ya se ha usado no se
// edita (decisión de producto 5), y la alternativa —pisar la fila— haría
// que el histórico cambiara de significado hacia atrás.
//
// ── Por qué al arrancar y no en la migración ─────────────────────────
//
// Porque los pasos 2 y 3 son lógica y no DDL, y el 3 cruza el catálogo con
// los ajustes de cada centro. Escribirlo en SQL sería un bloque PL/pgSQL
// de cien líneas por cada versión nueva; escribirlo aquí es una función
// con sus tests. Y porque el arranque ya corre `prisma migrate deploy`,
// así que no hay un paso de despliegue nuevo.

import type { Prisma } from "@mipiacetpv/db";
import { problemaDeFrecuencia } from "@mipiacetpv/residencia-plan";

import { getPrisma } from "../../context.js";
import {
  aColumnas,
  aColumnasDefault,
  deColumnasDefault,
} from "../frecuencia-columnas.js";
import { CONTROLES_DE_SERIE } from "./controles-de-serie.js";
import type { ControlDeSerie } from "./tipos.js";

/** Qué hizo el seed, para el log del arranque y para los tests. */
export interface ResultadoDelSeed {
  insertados: string[];
  versionesNuevas: string[];
  /** Códigos cuyo texto cambió sin subir la versión: se avisa y NO se toca. */
  cambiadosSinSubirVersion: string[];
  /** `tenantId:code` de cada ajuste reconducido. */
  ajustesReconducidos: string[];
}

/**
 * Comprueba el fichero de datos ANTES de escribir nada.
 *
 * Es un guardia de arranque y no un test porque el fichero lo editará
 * alguien que no corre la suite: la médica del cliente cero validando el
 * catálogo (D-57) manda un cambio por correo y lo aplica quien esté. Si
 * una frecuencia de serie es incoherente, el arranque lo dice con una
 * frase en vez de dejar que Postgres conteste un 500 de constraint a la
 * tercera fila.
 */
export function problemasDelCatalogo(
  controles: ControlDeSerie[] = CONTROLES_DE_SERIE,
): string[] {
  const problemas: string[] = [];
  const vistos = new Set<string>();
  for (const c of controles) {
    if (vistos.has(c.code)) problemas.push(`${c.code}: el código está dos veces.`);
    vistos.add(c.code);

    const malaFrecuencia = problemaDeFrecuencia({
      kind: c.defaultFrequency.kind,
      everyNHours: c.defaultFrequency.everyNHours,
      everyNDays: c.defaultFrequency.everyNDays,
      weekdays: c.defaultFrequency.weekdays,
      monthDay: c.defaultFrequency.monthDay,
      shiftCodes: c.defaultFrequency.shiftCodes,
      momentCodes: c.defaultFrequency.momentCodes,
    });
    if (malaFrecuencia) problemas.push(`${c.code}: ${malaFrecuencia}`);

    // La de serie tiene que estar entre las permitidas. Lo dice también el
    // CHECK `control_types_default_entre_permitidas`, y se repite aquí
    // porque es el error más fácil de cometer al añadir un control:
    // escribir la frecuencia que uno quiere y olvidarse de permitirla.
    if (!c.allowedFrequencies.includes(c.defaultFrequency.kind)) {
      problemas.push(
        `${c.code}: la frecuencia de serie (${c.defaultFrequency.kind}) no está entre las permitidas.`,
      );
    }
    if (c.allowedCareRoleCodes.length === 0) {
      problemas.push(`${c.code}: sin roles que lo registren, no lo registraría nadie.`);
    }
    if (c.valueDomain === "ORDINAL" && (c.options ?? []).length < 2) {
      problemas.push(`${c.code}: un control ordinal con menos de dos opciones no es ordinal.`);
    }
    if (c.valueDomain !== "ORDINAL" && (c.options ?? []).length > 0) {
      problemas.push(`${c.code}: tiene opciones y no es ordinal.`);
    }
    if ((c.options ?? []).filter((o) => o.asUsual).length > 1) {
      problemas.push(`${c.code}: dos opciones marcadas como «como siempre»; sólo puede haber una.`);
    }
    if (c.valueDomain === "NUMERIC" && !c.unit) {
      problemas.push(`${c.code}: una medida sin unidad es un número que nadie sabe leer.`);
    }
    if (c.version < 1) problemas.push(`${c.code}: la versión empieza en 1.`);
  }
  return problemas;
}

/** Lo que una fila del fichero manda a `control_types`. */
function datosDeLaFila(c: ControlDeSerie, validFrom: Date) {
  return {
    scope: "STANDARD" as const,
    tenantId: null,
    code: c.code,
    version: c.version,
    name: c.name,
    layer: c.layer,
    nature: c.nature,
    valueDomain: c.valueDomain,
    unit: c.unit ?? null,
    inputMin: c.inputMin ?? null,
    inputMax: c.inputMax ?? null,
    refMin: c.refMin ?? null,
    refMax: c.refMax ?? null,
    groupCode: c.groupCode ?? null,
    allowedFrequencies: c.allowedFrequencies,
    allowedCareRoleCodes: c.allowedCareRoleCodes,
    ...aColumnasDefault({
      kind: c.defaultFrequency.kind,
      everyNHours: c.defaultFrequency.everyNHours,
      everyNDays: c.defaultFrequency.everyNDays,
      weekdays: c.defaultFrequency.weekdays,
      monthDay: c.defaultFrequency.monthDay,
      shiftCodes: c.defaultFrequency.shiftCodes,
      momentCodes: c.defaultFrequency.momentCodes,
    }),
    isoIndicatorCode: c.isoIndicatorCode ?? null,
    familyVisibleDefault: c.familyVisibleDefault ?? false,
    sortOrder: c.sortOrder,
    validFrom,
  };
}

/**
 * Carga (o actualiza) el catálogo de serie.
 *
 * `ahora` entra por parámetro para que el test pueda publicar una versión
 * «el martes» y comprobar el `validFrom` sin esperar a que pase el tiempo.
 */
export async function cargarCatalogoDeSerie(
  controles: ControlDeSerie[] = CONTROLES_DE_SERIE,
  ahora: Date = new Date(),
): Promise<ResultadoDelSeed> {
  const problemas = problemasDelCatalogo(controles);
  if (problemas.length > 0) {
    // Se para en seco y no se carga a medias: un catálogo con la mitad de
    // los controles es un centro al que le falta la mitad del plan, y eso
    // se nota el primer turno pero no en el arranque.
    throw new Error(
      `El catálogo de serie de residencia tiene ${problemas.length} problema(s):\n· ${problemas.join("\n· ")}`,
    );
  }

  const prisma = getPrisma();
  const fuera: ResultadoDelSeed = {
    insertados: [],
    versionesNuevas: [],
    cambiadosSinSubirVersion: [],
    ajustesReconducidos: [],
  };

  for (const c of controles) {
    // La vigente de este código, si hay alguna.
    const vigente = await prisma.controlType.findFirst({
      where: { scope: "STANDARD", code: c.code, supersededAt: null },
      select: {
        id: true,
        version: true,
        name: true,
        allowedFrequencies: true,
        allowedCareRoleCodes: true,
      },
    });

    if (vigente && vigente.version === c.version) {
      // Misma versión: NO se toca. Si el texto cambió, se avisa y se deja
      // —una versión publicada no se edita— para que quien lo cambió sepa
      // que le falta subir la versión.
      if (vigente.name !== c.name) fuera.cambiadosSinSubirVersion.push(c.code);
      continue;
    }

    if (vigente && vigente.version > c.version) {
      // La base va por delante del fichero: es un despliegue hacia atrás.
      // No se degrada el catálogo clínico de nadie; se avisa y se sigue.
      fuera.cambiadosSinSubirVersion.push(c.code);
      continue;
    }

    // ── Insertar la versión nueva, y jubilar la anterior ─────────────
    //
    // Todo en una transacción: una versión nueva publicada sin jubilar la
    // anterior son DOS vigentes, y eso lo rechazaría el índice parcial
    // `control_types_una_vigente_estandar_key` a mitad de camino.
    await prisma.$transaction(async (tx) => {
      if (vigente) {
        await tx.controlType.update({
          where: { id: vigente.id },
          data: { supersededAt: ahora },
        });
      }
      const creado = await tx.controlType.create({
        data: datosDeLaFila(c, ahora),
        select: { id: true },
      });
      if ((c.options ?? []).length > 0) {
        await tx.controlTypeOption.createMany({
          data: (c.options ?? []).map((o, i) => ({
            controlTypeId: creado.id,
            code: o.code,
            label: o.label,
            sortOrder: (i + 1) * 10,
            isAsUsual: o.asUsual === true,
          })),
        });
      }

      // ── Y la reconducción de los ajustes que se queden inválidos ───
      //
      // Sólo si había una versión anterior: en la primera publicación no
      // hay ajustes todavía (los crea la semilla del centro al encender).
      if (vigente) {
        const reconducidos = await reconducirAjustes(tx, c, vigente.version);
        fuera.ajustesReconducidos.push(...reconducidos);
      }
    });

    if (vigente) fuera.versionesNuevas.push(`${c.code}@${c.version}`);
    else fuera.insertados.push(c.code);
  }

  return fuera;
}

/**
 * La transacción, con el tipo de Prisma y no un mínimo a mano.
 *
 * Aquí sí, al contrario que en `semilla.ts`: esta función corre siempre
 * contra la base de verdad (la llama el seed del arranque y su test con
 * una base real), nunca contra un doble, así que un mínimo a mano sólo
 * añadiría una forma que mantener. `Prisma.TransactionClient` es lo que ya
 * usan `tables/operativa.ts` y `holded/dejar-holded.ts`.
 */
type TxParaReconducir = Prisma.TransactionClient;

/**
 * Lleva a la de serie los ajustes de centro que la versión nueva deja
 * inválidos, y lo anota.
 *
 * Dos cosas pueden quedar inválidas, y se arreglan distinto:
 *
 *   · **la frecuencia**, si la versión nueva la retira de
 *     `allowedFrequencies`. Se pone la de serie de la versión nueva.
 *   · **los roles**, si la versión nueva retira alguno de
 *     `allowedCareRoleCodes`. Se QUITAN los que ya no valen y se
 *     conservan los que sí — el centro había estrechado la lista a
 *     propósito, y devolverla entera a la de serie sería ensancharla, que
 *     es justo lo que la frontera prohíbe.
 *
 * Si el estrechamiento se queda sin ningún rol, se vuelve a la lista de
 * serie: un control que no puede registrar nadie es un control que no se
 * registra, y eso sí es peor que ensanchar.
 */
async function reconducirAjustes(
  tx: TxParaReconducir,
  c: ControlDeSerie,
  versionAnterior: number,
): Promise<string[]> {
  const ajustes = await tx.centerControlSetting.findMany({
    where: { controlCode: c.code },
    select: { id: true, tenantId: true, frequencyKind: true, careRoleCodes: true },
  });
  const deSerie = deColumnasDefault(
    aColumnasDefault({
      kind: c.defaultFrequency.kind,
      everyNHours: c.defaultFrequency.everyNHours,
      everyNDays: c.defaultFrequency.everyNDays,
      weekdays: c.defaultFrequency.weekdays,
      monthDay: c.defaultFrequency.monthDay,
      shiftCodes: c.defaultFrequency.shiftCodes,
      momentCodes: c.defaultFrequency.momentCodes,
    }),
  );

  const tocados: string[] = [];
  for (const a of ajustes) {
    const motivos: string[] = [];
    const data: Record<string, unknown> = {};

    if (!c.allowedFrequencies.includes(a.frequencyKind)) {
      motivos.push(
        `la versión ${c.version} retiró la frecuencia «${a.frequencyKind}», que este centro tenía elegida`,
      );
      Object.assign(data, aColumnas(deSerie));
    }

    const rolesQueSobran = a.careRoleCodes.filter(
      (r) => !c.allowedCareRoleCodes.includes(r),
    );
    if (rolesQueSobran.length > 0) {
      const quedan = a.careRoleCodes.filter((r) => c.allowedCareRoleCodes.includes(r));
      motivos.push(
        `la versión ${c.version} ya no permite registrarlo a ${rolesQueSobran.join(", ")}`,
      );
      data.careRoleCodes = quedan.length > 0 ? quedan : c.allowedCareRoleCodes;
    }

    if (motivos.length === 0) continue;

    await tx.centerControlSetting.update({
      where: { id: a.id },
      data: {
        ...data,
        reconductedAt: new Date(),
        reconductedFromVersion: versionAnterior,
        reconductedReason: motivos.join("; "),
      },
    });
    tocados.push(`${a.tenantId}:${c.code}`);
  }
  return tocados;
}
