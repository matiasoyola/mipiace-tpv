// F1 · "enviado sin conexión" (ADR-018).
//
// Colegio con sótano, obra sin señal: el toque nunca falla por red. El
// móvil encola el fichaje con SU hora y lo manda al volver la conexión.
// El servidor guarda las dos: la del toque (`*DeviceAt`) y la de llegada
// (`*ServerAt`). **La que cuenta es la del toque.**
//
// Si difieren más de diez minutos, el registro se marca para que la
// empresa lo vea. No bloquea nada: es información, no un error.
//
// Se DERIVA y no se guarda como columna. Un flag puede quedar
// desincronizado de los dos timestamps que lo justifican —una corrección,
// un backfill, un bug— y entonces la marca diría una cosa y el dato otra.
// Una función pura no puede desincronizarse de sus argumentos.

export const OFFLINE_THRESHOLD_MINUTES = 10;

export function sentOffline(
  deviceAt: Date | null | undefined,
  serverAt: Date | null | undefined,
): boolean {
  if (!deviceAt || !serverAt) return false;
  const diff = Math.abs(serverAt.getTime() - deviceAt.getTime());
  return diff > OFFLINE_THRESHOLD_MINUTES * 60_000;
}

/** ¿Alguno de los dos extremos del tramo llegó sin conexión? */
export function entrySentOffline(entry: {
  startedDeviceAt: Date | null;
  startedServerAt: Date | null;
  endedDeviceAt: Date | null;
  endedServerAt: Date | null;
}): boolean {
  return (
    sentOffline(entry.startedDeviceAt, entry.startedServerAt) ||
    sentOffline(entry.endedDeviceAt, entry.endedServerAt)
  );
}
