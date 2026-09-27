// holded-desconectar · vaciar de Redis lo que ya no tiene destino. ADR-020.
//
// Vive aparte de `dejar-holded.ts` por una razón y no por orden: Redis NO
// entra en la transacción de Postgres. Si estuvieran en la misma función
// alguien acabaría metiendo el vaciado dentro del `$transaction` y un
// rollback dejaría las colas barridas con el corte sin hacer.
//
// Así que el reparto es:
//
//   · Postgres — atómico. O está el corte entero o no está nada.
//   · Redis    — DESPUÉS, y re-ejecutable. Relanzar la acción sobre un
//                comercio ya cortado vuelve a pasar por aquí.
//
// Y el orden importa: primero el corte, después las colas. Al revés
// quedaría una ventana en la que las colas están vacías y la clave sigue
// puesta, y el repeatable del sync incremental volvería a encolar solo a
// los quince minutos.
//
// ── Qué se barre, y qué NO ─────────────────────────────────────────────
//
// Se barre lo que lleva `tenantId` en el payload o lo que se puede resolver
// a un tenant sin llamar a Holded. Lo que NO se barre, y por qué:
//
//   · `reconciliation` y `shift-day-cut` son repeatables GLOBALES, un job
//     por pasada y no por tenant. Borrar el repeatable dejaría sin
//     conciliación a los otros cinco comercios. Sus runners ya se saltan
//     al comercio sin clave (y con este bloque, además, al que tiene el
//     interruptor apagado).
//   · `agenda-hold-ttl` no habla con Holded.
//   · `ticket-email` tampoco desde que el PDF lo generamos nosotros
//     (`send-ticket-email.ts`): un envío pendiente SIGUE su curso, y debe.
//     Ana manda tickets por email y el corte no se los quita.
//
// Nada de esto es la garantía de que no se llame a Holded — eso lo
// sostienen el borrado de la clave, el CHECK de la base y los guards de
// cada runner. Esto es higiene: evita cinco minutos de jobs que se
// ejecutan para no hacer nada y de líneas de log que asustan.

import { getCatalogIncrementalQueue, unregisterTenantRepeatable } from "../queues/catalog-incremental.js";
import { getContactImportQueue } from "../queues/contact-import.js";
import { getInitialSyncQueue } from "../queues/initial-sync.js";
import { getProductImageCacheQueue } from "../queues/product-image-cache.js";
import { getRefundUploadQueue } from "../queues/refund-upload.js";
import { getTicketUploadQueue } from "../queues/ticket-upload.js";

/** Lo mínimo de una `Queue` de BullMQ que este módulo usa. Inyectable
 *  para poder probarlo sin Redis, igual que hace `upload-sweeper.ts`. */
export interface ColaBarrible {
  name: string;
  getJobs(
    types: string[],
    start?: number,
    end?: number,
  ): Promise<Array<{ id?: string | null; data?: unknown; remove(): Promise<void> }>>;
}

export interface VaciadoDeColas {
  /** Nombre de cola → cuántos jobs se han quitado. */
  porCola: Record<string, number>;
  repeatableQuitado: boolean;
  errores: string[];
}

/** Estados de los que se quitan jobs. Los terminales (`completed`,
 *  `failed`) se dejan: son el histórico que mira el super-admin cuando
 *  algo salió mal, y borrarlos sería tapar la única huella que queda. */
const ESTADOS_VIVOS = ["waiting", "delayed", "paused", "prioritized", "waiting-children"];

export interface VaciarColasOptions {
  tenantId: string;
  /** Inyectable para el test. En producción, las seis colas reales. */
  colas?: ColaBarrible[];
  quitarRepeatable?: (tenantId: string) => Promise<void>;
  log?: (msg: string, extra?: Record<string, unknown>) => void;
}

/**
 * Deja las colas sin un solo job de este comercio que pueda acabar
 * llamando a Holded.
 *
 * Nunca lanza: un Redis caído no puede dejar el corte a medias, porque el
 * corte ya está hecho y comprometido en Postgres antes de llegar aquí. Los
 * fallos se devuelven en `errores` para que la ruta los cuente y el
 * super-admin pueda relanzar.
 */
export async function vaciarColasDeHolded(
  options: VaciarColasOptions,
): Promise<VaciadoDeColas> {
  const { tenantId } = options;
  const log =
    options.log ??
    ((msg, extra) => console.log(`[dejar-holded/colas] ${msg}`, extra ?? ""));
  const resultado: VaciadoDeColas = {
    porCola: {},
    repeatableQuitado: false,
    errores: [],
  };

  // El repeatable del sync incremental es lo PRIMERO: mientras exista,
  // cada quince minutos vuelve a poner un job en la cola que acabamos de
  // vaciar. Los demás son jobs de una vez.
  const quitar = options.quitarRepeatable ?? unregisterTenantRepeatable;
  try {
    await quitar(tenantId);
    resultado.repeatableQuitado = true;
  } catch (err) {
    resultado.errores.push(
      `repeatable del sync incremental: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const colas = options.colas ?? colasPorDefecto();
  for (const cola of colas) {
    resultado.porCola[cola.name] = 0;
    try {
      const jobs = await cola.getJobs(ESTADOS_VIVOS, 0, 5000);
      for (const job of jobs) {
        if (!esDeEsteTenant(job.data, tenantId)) continue;
        try {
          await job.remove();
          resultado.porCola[cola.name] = (resultado.porCola[cola.name] ?? 0) + 1;
        } catch (err) {
          // Un job que se está ejecutando justo ahora no se puede quitar.
          // No es un fallo del corte: ese job va a bajarse a Holded con la
          // clave ya borrada y su runner lo saltará.
          resultado.errores.push(
            `${cola.name}/${job.id ?? "?"}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    } catch (err) {
      resultado.errores.push(
        `${cola.name}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  log("colas vaciadas", { tenantId, ...resultado.porCola, errores: resultado.errores.length });
  return resultado;
}

/**
 * ¿Este job es de este comercio?
 *
 * Los payloads no son iguales: `catalog-incremental`, `initial-sync` y
 * `contact-import` llevan `tenantId`; `ticket-upload` y `refund-upload`
 * llevan sólo `externalId`; `product-image-cache` lleva `productId`.
 *
 * Los dos últimos NO se resuelven aquí y se dejan pasar a propósito, y es
 * la decisión de este helper: para saber de quién es un `externalId` habría
 * que consultar la base por cada job, y un job de subida de un comercio
 * cortado ya no hace daño —`uploadTicket` mira la clave antes de construir
 * el cliente y sale sin llamar a nadie—. Barrer por `tenantId` cuando
 * está, y no inventar cuando no está.
 */
function esDeEsteTenant(data: unknown, tenantId: string): boolean {
  if (data == null || typeof data !== "object") return false;
  const t = (data as { tenantId?: unknown }).tenantId;
  return typeof t === "string" && t === tenantId;
}

function colasPorDefecto(): ColaBarrible[] {
  return [
    getCatalogIncrementalQueue() as unknown as ColaBarrible,
    getInitialSyncQueue() as unknown as ColaBarrible,
    getContactImportQueue() as unknown as ColaBarrible,
    getProductImageCacheQueue() as unknown as ColaBarrible,
    getTicketUploadQueue() as unknown as ColaBarrible,
    getRefundUploadQueue() as unknown as ColaBarrible,
  ];
}
