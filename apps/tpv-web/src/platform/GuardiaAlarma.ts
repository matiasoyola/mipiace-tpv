// residencia-4 (D-66) · EL PUENTE CON EL SERVICIO QUE HACE QUE SUENE.
//
// Mismo patrón que `KitchenLan.ts` y `SupportAgent.ts`: se lee el global
// `Capacitor` que inyecta el bridge y se habla por `Capacitor.Plugins`. NO
// se importa `@capacitor/core` (ver `platform/index.ts`).
//
// **En navegador no hace nada, y lo dice.** Una pestaña de Chrome no puede
// mantener un servicio en primer plano ni levantar una notificación de
// alarma con la pantalla apagada. Lo que queda entonces es el sondeo de la
// propia pantalla, que funciona mientras la pestaña esté delante — sirve
// para probar el flujo en el portátil y no sirve para un turno de noche.
// Por eso `disponible` existe y la pantalla lo pinta.

import { getNativePlugin } from "./index.js";

export interface EstadoDeLaAlarma {
  /** `true` si el servicio quedó encendido. */
  activo: boolean;
  /**
   * `false` = Android 13+ con el permiso denegado. El servicio **sigue
   * corriendo** (el sondeo y la sesión siguen vivos) pero el móvil no
   * sonará con la pantalla apagada, y eso hay que decirlo: lo contrario
   * es descubrirlo en un turno de noche.
   */
  permisoDeNotificaciones: boolean;
}

interface PluginDeGuardia {
  empezar(opts: {
    apiBase: string;
    deviceToken: string;
    sesion: string;
    canal: string;
    quien: string;
  }): Promise<EstadoDeLaAlarma>;
  parar(): Promise<{ activo: boolean }>;
  estado(): Promise<{ permisoDeNotificaciones: boolean }>;
}

function plugin(): PluginDeGuardia | null {
  return getNativePlugin<PluginDeGuardia>("GuardiaAlarm");
}

/** `true` cuando la APK está debajo. */
export function alarmaDisponible(): boolean {
  return plugin() != null;
}

/**
 * Enciende el servicio con el token de la guardia recién abierta.
 *
 * `null` en navegador. **No lanza**: que el servicio no arranque no puede
 * impedir que alguien se ponga de guardia — lo que pasa entonces es que
 * el móvil avisa sólo con la app delante, y la pantalla lo dice.
 */
export async function empezarLaAlarma(input: {
  apiBase: string;
  deviceToken: string;
  sesion: string;
  canal: string;
  quien: string;
}): Promise<EstadoDeLaAlarma | null> {
  const p = plugin();
  if (!p) return null;
  try {
    return await p.empezar(input);
  } catch {
    return { activo: false, permisoDeNotificaciones: false };
  }
}

export async function pararLaAlarma(): Promise<void> {
  const p = plugin();
  if (!p) return;
  try {
    await p.parar();
  } catch {
    /* el servicio ya no estaba; soltar la guardia no puede fallar por
       esto */
  }
}

/** ¿Está concedido el permiso de notificaciones? `null` en navegador. */
export async function permisoDeAlarma(): Promise<boolean | null> {
  const p = plugin();
  if (!p) return null;
  try {
    return (await p.estado()).permisoDeNotificaciones;
  } catch {
    return null;
  }
}
