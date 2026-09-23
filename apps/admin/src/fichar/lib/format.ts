// F1 · cómo se leen las horas en la pantalla de fichar.
//
// El servidor manda instantes ISO y la zona (`Europe/Madrid`). Aquí sólo
// se pintan. Nada de aritmética de calendario en el cliente: los totales
// vienen calculados del servidor, que es el mismo cálculo que va al PDF
// que se firma.

export function horaLocal(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("es-ES", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone,
  }).format(new Date(iso));
}

export function diaLargo(fecha: string, timeZone: string): string {
  // `fecha` ya viene como día local "YYYY-MM-DD": se ancla a mediodía para
  // que ningún desfase de huso lo mueva de día al formatearlo.
  const d = new Date(`${fecha}T12:00:00Z`);
  const s = new Intl.DateTimeFormat("es-ES", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone,
  }).format(d);
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Día local de HOY en la zona del registro, como "YYYY-MM-DD". */
export function hoyLocal(timeZone: string, ahora = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone }).format(ahora);
}

/**
 * "Hoy", "Ayer" o "mar 22".
 *
 * Lo pidió el bucle visual: con doce filas idénticas de "lun 21 · 08:00 →
 * 17:30", encontrar la de hoy costaba leerlas todas. Los dos días que
 * importan son los dos que tienen nombre.
 */
export function diaCorto(
  fecha: string,
  timeZone: string,
  ahora = new Date(),
): string {
  const hoy = hoyLocal(timeZone, ahora);
  if (fecha === hoy) return "Hoy";
  const ayer = hoyLocal(timeZone, new Date(ahora.getTime() - 86_400_000));
  if (fecha === ayer) return "Ayer";
  const d = new Date(`${fecha}T12:00:00Z`);
  return new Intl.DateTimeFormat("es-ES", {
    weekday: "short",
    day: "numeric",
    timeZone,
  }).format(d);
}

/** "8h 07m". Nunca "8.12 h": nadie lee su jornada en decimales. */
export function duracion(minutos: number): string {
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

/** El contador vivo de "llevas dentro". Holded pone 00h00m mientras el
 *  tramo está en curso; aquí se ve correr. */
export function transcurrido(desdeIso: string, ahora: number): string {
  const ms = Math.max(0, ahora - new Date(desdeIso).getTime());
  return duracion(Math.floor(ms / 60_000));
}
