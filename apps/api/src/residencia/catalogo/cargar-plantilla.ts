// residencia-4 (D-65) · EL SEED DE LA PLANTILLA DE GRAVEDAD.
//
// Carga `PLANTILLA_DE_GRAVEDAD` en `severity_rules` como filas GLOBALES
// (sin `tenant_id`). Corre al arrancar la API, es idempotente y **no es
// por tenant**: la plantilla la ven todos los centros, que es la mitad de
// D-21 y entera de D-65.
//
// Hermano de `cargar-catalogo.ts` y deliberadamente más simple, porque el
// problema es más simple: aquí no hay ajustes de centro que reconducir
// (un centro no toca la plantilla), así que publicar una versión nueva es
//
//   1. jubilar TODAS las filas vigentes de la versión anterior
//      (`superseded_at`), sin tocarlas; y
//   2. insertar las de la nueva.
//
// Las dos cosas en UNA transacción, por lo mismo que en el catálogo: con
// la mitad publicada, un centro graduaría una fiebre con la plantilla
// nueva y una caída con la vieja — y «¿qué decía la plantilla cuando pasó
// esto?» dejaría de tener una respuesta.
//
// ── LA VERSIÓN ES DE LA PLANTILLA ENTERA ────────────────────────────
//
// Y por eso el seed mira UNA cosa para decidir si hay trabajo: qué
// versión está vigente en la base. Si es la del fichero, no se toca nada
// —ni aunque alguien haya editado un umbral sin subir la versión, y
// entonces se avisa—. Si es menor, se publica. Si es mayor, es un
// despliegue hacia atrás y **no se degrada la plantilla clínica de
// nadie**: se avisa y se sigue.
//
// Es la misma regla que el catálogo de controles, y la misma razón: una
// versión que ya se ha usado no se edita, porque el histórico apunta a
// ella (`incidents.template_version`).

import { getPrisma } from "../../context.js";
import {
  PLANTILLA_DE_GRAVEDAD,
  VERSION_DE_LA_PLANTILLA,
  problemasDeLaPlantilla,
  type ReglaDeSerie,
} from "./plantilla-de-gravedad.js";

/** Qué hizo el seed, para el log del arranque y para los tests. */
export interface ResultadoDeLaPlantilla {
  /** `"nada"` si ya estaba, `"publicada"` si se publicó una versión. */
  accion: "nada" | "publicada" | "despliegue-hacia-atras";
  version: number;
  /** Cuántas filas se insertaron y cuántas se jubilaron. */
  insertadas: number;
  jubiladas: number;
}

function datosDeLaFila(r: ReglaDeSerie, version: number, validFrom: Date) {
  return {
    scope: "STANDARD" as const,
    version,
    kind: r.kind,
    controlCode: r.kind === "THRESHOLD" ? r.controlCode : null,
    comparator: r.kind === "THRESHOLD" ? r.comparador : null,
    value: r.kind === "THRESHOLD" ? r.valor : null,
    eventType: r.kind === "EVENT" ? r.evento : null,
    qualifier: r.kind === "EVENT" ? r.matiz : null,
    severity: r.nivel,
    incidentType: r.tipo,
    sortOrder: r.sortOrder,
    validFrom,
  };
}

/**
 * Publica (o no) la plantilla de serie.
 *
 * `ahora` entra por parámetro para que el test pueda publicar «el
 * martes» y comprobar el `validFrom` sin esperar a que pase el tiempo —
 * mismo criterio que `cargarCatalogoDeSerie`.
 */
export async function cargarPlantillaDeGravedad(
  reglas: ReglaDeSerie[] = PLANTILLA_DE_GRAVEDAD,
  version: number = VERSION_DE_LA_PLANTILLA,
  ahora: Date = new Date(),
): Promise<ResultadoDeLaPlantilla> {
  const problemas = problemasDeLaPlantilla(reglas);
  if (problemas.length > 0) {
    // Se para en seco y no se carga a medias: media plantilla es un
    // centro que gradúa la fiebre y no la saturación, y eso no se nota en
    // el arranque sino la noche que alguien tenga 85 de saturación.
    throw new Error(
      `La plantilla de gravedad tiene ${problemas.length} problema(s):\n· ${problemas.join("\n· ")}`,
    );
  }

  const prisma = getPrisma();
  const vigentes = await prisma.severityRule.findMany({
    where: { scope: "STANDARD", supersededAt: null },
    select: { id: true, version: true },
  });

  if (vigentes.length > 0) {
    const maxima = Math.max(...vigentes.map((v) => v.version));
    if (maxima === version) {
      return { accion: "nada", version, insertadas: 0, jubiladas: 0 };
    }
    if (maxima > version) {
      // La base va por delante del fichero: despliegue hacia atrás. No se
      // degrada la plantilla clínica de un centro por un rollback de la
      // imagen; se avisa y se sigue.
      return {
        accion: "despliegue-hacia-atras",
        version: maxima,
        insertadas: 0,
        jubiladas: 0,
      };
    }
  }

  await prisma.$transaction(async (tx) => {
    if (vigentes.length > 0) {
      await tx.severityRule.updateMany({
        where: { scope: "STANDARD", supersededAt: null },
        data: { supersededAt: ahora },
      });
    }
    await tx.severityRule.createMany({
      data: reglas.map((r) => datosDeLaFila(r, version, ahora)),
    });
  });

  return {
    accion: "publicada",
    version,
    insertadas: reglas.length,
    jubiladas: vigentes.length,
  };
}
