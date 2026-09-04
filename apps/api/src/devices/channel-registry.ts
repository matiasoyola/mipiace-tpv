// A5 · quién está conectado ahora mismo.
//
// Registro in-memory de los canales de soporte abiertos, uno por device. Vive
// en el proceso de la API igual que el bus de mesas (`realtime/store-event-bus.ts`)
// y por el mismo motivo: el despliegue corre UNA instancia de api (ADR-009).
// Cuando escalemos a más de una, esto se sustituye por Redis manteniendo la
// firma y el resto del código no se entera.
//
// Diferencia con el bus de mesas: allí un canal es un store con N suscriptores
// y se emite a todos; aquí un canal es UN terminal y se le habla a él. Por eso
// no se reutiliza el bus.
//
// Deliberadamente NO persiste nada. Estar online no es un dato del negocio: es
// una propiedad de este proceso en este instante. Si la API se reinicia, el
// panel se queda ciego los segundos que tarden los terminales en reconectar, y
// eso es correcto — lo contrario sería pintar como vivos a quince terminales
// que igual llevan una hora apagados. Lo que sí sobrevive al reinicio es la
// última instantánea, que está en `DeviceHeartbeat`.

/** Códigos de cierre. 4xxx es el rango reservado a la aplicación en RFC 6455. */
export const WS_CLOSE = {
  /** El `hello` no llegó a tiempo, o el token no vale. */
  UNAUTHORIZED: 4401,
  /** El device está revocado (al conectar o mientras estaba conectado). */
  REVOKED: 4403,
  /** El mismo device abrió un canal nuevo; éste sobra. */
  REPLACED: 4409,
} as const;

export interface DeviceChannel {
  deviceId: string;
  tenantId: string;
  registerId: string;
  connectedAt: Date;
  /** Envía un mensaje al terminal. `false` si el socket ya no está abierto. */
  send(payload: unknown): boolean;
  close(code: number, reason: string): void;
}

class DeviceChannelRegistry {
  private readonly channels = new Map<string, DeviceChannel>();

  /**
   * Registra el canal de un device y devuelve la función para darlo de baja.
   *
   * Si ese device ya tenía canal, **el viejo se cierra**. Pasa de verdad: al
   * terminal se le va la red, el servidor no se entera hasta que el TCP
   * expira, y mientras tanto el terminal ya ha reconectado. Con dos canales
   * vivos, un comando podría irse por el socket muerto y quedarse esperando un
   * resultado que no llega nunca.
   *
   * La baja es idempotente y sólo borra si el canal registrado sigue siendo el
   * suyo: así el `close` del socket viejo, que llega tarde, no desregistra al
   * nuevo.
   */
  register(channel: DeviceChannel): () => void {
    const previous = this.channels.get(channel.deviceId);
    if (previous && previous !== channel) {
      try {
        previous.close(WS_CLOSE.REPLACED, "replaced");
      } catch {
        // El socket viejo puede estar ya roto; da igual, lo estamos tirando.
      }
    }
    this.channels.set(channel.deviceId, channel);
    return () => {
      if (this.channels.get(channel.deviceId) === channel) {
        this.channels.delete(channel.deviceId);
      }
    };
  }

  get(deviceId: string): DeviceChannel | null {
    return this.channels.get(deviceId) ?? null;
  }

  isOnline(deviceId: string): boolean {
    return this.channels.has(deviceId);
  }

  /** Ids de los terminales con canal abierto. Lo pinta el panel. */
  onlineDeviceIds(): string[] {
    return [...this.channels.keys()];
  }

  /**
   * Cierra el canal de un device, si lo tiene. Lo llama la revocación: un
   * terminal revocado no puede seguir hablando por un canal que abrió cuando
   * todavía valía.
   *
   * Devuelve true si había canal que cerrar.
   */
  closeDevice(deviceId: string, code: number, reason: string): boolean {
    const channel = this.channels.get(deviceId);
    if (!channel) return false;
    this.channels.delete(deviceId);
    try {
      channel.close(code, reason);
    } catch {
      // Cerrar un socket ya roto no es un error que nadie deba atender.
    }
    return true;
  }

  size(): number {
    return this.channels.size;
  }

  /** Sólo para tests: deja el registro como recién arrancado. */
  __resetForTests(): void {
    this.channels.clear();
  }
}

const registry = new DeviceChannelRegistry();

export function getDeviceChannelRegistry(): DeviceChannelRegistry {
  return registry;
}
