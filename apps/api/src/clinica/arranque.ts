// clinica-7 · LA API NO ARRANCA SI NO PUEDE LEER LO QUE VA A ESCRIBIR.
//
// Decisión 17: si existe algún tenant clínico y falta la KEK, o la KEK no
// descifra una fila canario, **la API no arranca** y lo dice en el log.
//
// ── Por qué fallar al arrancar y no al primer uso ────────────────────
//
// Porque el daño de las dos cosas no se parece:
//
//   · Fallar al arrancar es un despliegue que no sube, con un mensaje en el
//     log que dice exactamente qué falta. Se arregla en dos minutos
//     poniendo la variable y volviendo a desplegar, y mientras tanto el
//     contenedor anterior sigue sirviendo.
//   · Arrancar sin la KEK buena es un sistema que **escribe historias
//     clínicas que después nadie puede leer**. Se descubre días más tarde,
//     cuando una podóloga abre la historia de una paciente y no está. Y a
//     esas alturas no hay arreglo: lo escrito con la clave que no era
//     queda ilegible.
//
// Es la decisión contraria a la de la venta («cobrar siempre se puede»), y
// a propósito. Ahí una invariante rota no tumba un cobro porque el dinero
// ya cambió de manos; aquí la escritura ES el daño.
//
// ── Y no arranca ni para los que no tienen clínica ───────────────────
//
// Sí: un bar del mismo despliegue se queda sin TPV porque a una clínica le
// falta la clave. Es deliberado — arrancar «a medias», con las rutas
// clínicas apagadas y el resto vivo, habría significado una clínica
// abierta con la historia dando 500 toda la mañana y nadie mirando el log.
// Un despliegue que no sube se ve; uno que sube roto, no.
//
// ── Qué cuenta como «hay clínica» ────────────────────────────────────
//
// Dos cosas, y la segunda es la que importa: un tenant con el módulo
// encendido **o** una fila en `clinical_tenant_keys`. Lo segundo cubre la
// clínica a la que le apagaron el módulo y cuyos datos cifrados siguen ahí:
// sin la KEK, esa historia no se puede ni exportar para devolvérsela, y la
// ley obliga a conservarla cinco años.

import type { FastifyBaseLogger } from "fastify";

import { getPrisma } from "../context.js";
import { hayKek, revisarCanarios } from "./claves.js";

export interface RevisionDelArranque {
  /** `true` si la API puede arrancar. */
  puedeArrancar: boolean;
  /** Para el log. Una línea por motivo. */
  motivos: string[];
  tenantsClinicos: number;
  clavesRevisadas: number;
  clavesQueNoCuadran: string[];
  /** La revisión NO SE PUDO HACER (base sin migrar, o la consulta falló).
   *  No es lo mismo que «comprobado y está mal»: ver abajo. */
  noSePudoComprobar?: string;
}

/**
 * Mira si este despliegue puede manejar lo clínico que tiene delante.
 *
 * Devuelve el veredicto en vez de reventar: así `server.ts` decide (y
 * escribe el log con su `app.log`), y el test puede comprobar los cuatro
 * casos sin levantar un proceso.
 */
export async function revisarArranqueClinico(): Promise<RevisionDelArranque> {
  const prisma = getPrisma();
  const motivos: string[] = [];

  // ── SI NO SE PUEDE PREGUNTAR, NO SE TUMBA LA API ──────────────────
  //
  // El smoke de CI arranca la imagen contra una base **sin migrar**, y
  // `prisma.clinicalTenantKey.count()` lanza `P2021: la tabla no existe`.
  // Esa excepción salía del arranque y mataba el proceso: el contenedor no
  // llegaba a servir `/health` y el smoke se caía con la API «parada antes
  // de servir», que no dice nada de lo que pasó.
  //
  // «No pude comprobar» NO es «comprobado y está mal», y solo lo segundo
  // justifica no arrancar. Una base sin tablas no tiene ninguna historia
  // clínica que proteger — y en un despliegue de verdad las tablas están,
  // así que esta rama no tapa el caso que la decisión 17 cubre.
  //
  // Es la regla de la casa: nada del arranque puede lanzar.
  let tenantsClinicos: number;
  let clavesExistentes: number;
  try {
    [tenantsClinicos, clavesExistentes] = await Promise.all([
      prisma.tenant.count({ where: { clinicalRecordsEnabled: true } }),
      prisma.clinicalTenantKey.count(),
    ]);
  } catch (err) {
    return {
      puedeArrancar: true,
      motivos: [],
      tenantsClinicos: 0,
      clavesRevisadas: 0,
      clavesQueNoCuadran: [],
      noSePudoComprobar:
        "No se pudo mirar si hay clínicas (¿base sin migrar?): " +
        (err instanceof Error ? err.message.split("\n")[0] : String(err)),
    };
  }

  const hayAlgoClinico = tenantsClinicos > 0 || clavesExistentes > 0;
  if (!hayAlgoClinico) {
    // Ni una clínica. No se pide KEK, y no se toca nada más.
    return {
      puedeArrancar: true,
      motivos: [],
      tenantsClinicos,
      clavesRevisadas: 0,
      clavesQueNoCuadran: [],
    };
  }

  if (!hayKek()) {
    motivos.push(
      `Hay ${tenantsClinicos} clínica(s) con el módulo encendido y ${clavesExistentes} clave(s) de clínica en la base, y FALTA CLINICAL_KEK. ` +
        "Sin ella no se puede leer ni escribir nada clínico. Ponla en el entorno y vuelve a desplegar; " +
        "si la has perdido, NO despliegues: las historias cifradas con ella son ilegibles y hay que recuperarla de donde esté guardada.",
    );
    return {
      puedeArrancar: false,
      motivos,
      tenantsClinicos,
      clavesRevisadas: 0,
      clavesQueNoCuadran: [],
    };
  }

  const revisados = await revisarCanarios(prisma);
  const noCuadran = revisados.filter((r) => !r.cuadra).map((r) => r.tenantId);

  if (noCuadran.length > 0) {
    motivos.push(
      `La CLINICAL_KEK de este entorno NO descifra la fila canario de ${noCuadran.length} clínica(s): ${noCuadran.join(", ")}. ` +
        "O la KEK es de otro entorno, o la rotación se quedó a medias. NO se arranca: escribir con la clave equivocada deja historias que nadie podrá leer.",
    );
  }

  return {
    puedeArrancar: noCuadran.length === 0,
    motivos,
    tenantsClinicos,
    clavesRevisadas: revisados.length,
    clavesQueNoCuadran: noCuadran,
  };
}

/**
 * La revisión, escrita en el log, y `process.exit(1)` si no cuadra.
 *
 * El `exit` va aquí y no en `server.ts` para que el mensaje y la decisión
 * vivan juntos: con la decisión en el arranque y el mensaje aquí, el día
 * que alguien añada un motivo se le olvidaría cambiar el otro lado.
 *
 * **Ni la KEK ni ninguna DEK entran en el log.** Lo que se escribe son
 * cuántas clínicas hay y qué ids no cuadran, que es lo que hace falta para
 * arreglarlo.
 */
export async function exigirArranqueClinico(
  log: FastifyBaseLogger,
): Promise<void> {
  const revision = await revisarArranqueClinico();
  if (revision.puedeArrancar) {
    if (revision.noSePudoComprobar != null) {
      // Un WARN, no un fatal, y la API sigue. Que quede en el log para que
      // nadie lea «arrancó» como «la KEK está bien».
      log.warn(
        { event: "clinica_kek_sin_comprobar" },
        revision.noSePudoComprobar,
      );
    }
    if (revision.clavesRevisadas > 0) {
      log.info(
        {
          event: "clinica_kek_ok",
          tenantsClinicos: revision.tenantsClinicos,
          clavesRevisadas: revision.clavesRevisadas,
        },
        "clinica · la KEK descifra el canario de todas las clínicas",
      );
    }
    return;
  }
  for (const motivo of revision.motivos) {
    log.fatal({ event: "clinica_kek_invalida" }, motivo);
  }
  // Y por `stderr` además del logger: si el logger está configurado a un
  // nivel que se come el `fatal`, el operador se queda sin el único
  // mensaje que explica por qué no arranca.
  for (const motivo of revision.motivos) console.error(`[clinica-7] ${motivo}`);
  process.exit(1);
}
