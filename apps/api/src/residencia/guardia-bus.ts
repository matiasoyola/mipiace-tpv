// residencia-4 (D-66) · **EL EMPUJE AL MÓVIL DE GUARDIA.**
//
// Un bus en memoria por `(tenant, canal)`, copia estructural de
// `realtime/store-event-bus.ts` y con la misma limitación declarada: vive
// en el proceso de la API, y el despliegue es una sola instancia
// (ADR-009). El día que haya dos, esto se sustituye por Redis pub/sub
// manteniendo la firma.
//
// ── POR QUÉ UN BUS PROPIO Y NO EL DE MESAS ──────────────────────────
//
// El de mesas reparte por `storeId` y lleva un throttle de cinco eventos
// por segundo que descarta en silencio los que sobran. Las dos cosas son
// correctas allí —un cajero que pulsa «añadir línea» treinta veces— y las
// dos son inaceptables aquí: el canal no es una tienda, y **un aviso que
// se descarta es un aviso que no suena**. Nada de lo que pasa por este
// bus se tira.
//
// ── Y LO QUE DE VERDAD HACE QUE SUENE NO ES ESTO ────────────────────
//
// El socket es el camino rápido. El que no falla es el otro: el móvil
// pide `GET /residencia/guardia/avisos` al conectar, al reconectar y cada
// quince segundos, y el servicio en primer plano de Android mantiene el
// socket abierto con la pantalla apagada. Un socket caído retrasa un
// aviso hasta el siguiente sondeo; **no lo pierde**. Es la misma regla
// que kds-1 escribió para la cocina («la verdad sigue estando en el
// GET»), y aquí importa más.

import type { CanalDeGuardia } from "@mipiacetpv/residencia-plan";

/** Lo que viaja por el socket. */
export type EventoDeGuardia =
  | {
      type: "aviso";
      /** El id del `GuardAlert`. El móvil pide el detalle con el GET. */
      alertId: string;
      incidentId: string;
      severity: string;
      /** Cuándo lo apuntó la tablet. Con retraso, el móvil lo pinta. */
      queuedAt: string;
      at: string;
    }
  | {
      type: "acuse";
      alertId: string;
      incidentId: string;
      /** Quién lo acusó, para que los otros móviles del canal lo quiten
       *  de la pantalla en vez de seguir sonando. */
      porNombre: string;
      at: string;
    }
  | {
      type: "cerrada";
      incidentId: string;
      at: string;
    };

export interface SuscriptorDeGuardia {
  send(evento: EventoDeGuardia): void;
}

function clave(tenantId: string, canal: CanalDeGuardia): string {
  return `${tenantId}|${canal}`;
}

class BusDeGuardia {
  private readonly suscriptores = new Map<string, Set<SuscriptorDeGuardia>>();

  suscribir(
    tenantId: string,
    canal: CanalDeGuardia,
    s: SuscriptorDeGuardia,
  ): () => void {
    const k = clave(tenantId, canal);
    let set = this.suscriptores.get(k);
    if (!set) {
      set = new Set();
      this.suscriptores.set(k, set);
    }
    set.add(s);
    return () => {
      const actual = this.suscriptores.get(k);
      if (!actual) return;
      actual.delete(s);
      if (actual.size === 0) this.suscriptores.delete(k);
    };
  }

  emitir(tenantId: string, canal: CanalDeGuardia, evento: EventoDeGuardia): void {
    const set = this.suscriptores.get(clave(tenantId, canal));
    if (!set) return;
    for (const s of set) {
      try {
        s.send(evento);
      } catch {
        // Un socket que falla al enviar (cerrado entre el dispatch y el
        // send) no puede tumbar al resto: el móvil de al lado tiene que
        // recibirlo igual.
      }
    }
  }

  /** Cuántos móviles de ese canal están escuchando. Lo usa el GET de
   *  estado del admin y los tests. */
  cuantos(tenantId: string, canal: CanalDeGuardia): number {
    return this.suscriptores.get(clave(tenantId, canal))?.size ?? 0;
  }
}

const bus = new BusDeGuardia();
export function getBusDeGuardia(): BusDeGuardia {
  return bus;
}

/** Empuja una tanda de avisos recién creados a los móviles de su canal. */
export function empujarAvisos(
  tenantId: string,
  avisos: Array<{
    id: string;
    canal: CanalDeGuardia;
    nivel: string;
    incidentId: string;
  }>,
  queuedAt: Date,
): void {
  const at = new Date().toISOString();
  for (const a of avisos) {
    bus.emitir(tenantId, a.canal, {
      type: "aviso",
      alertId: a.id,
      incidentId: a.incidentId,
      severity: a.nivel,
      queuedAt: queuedAt.toISOString(),
      at,
    });
  }
}
