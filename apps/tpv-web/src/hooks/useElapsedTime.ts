import { useEffect, useState } from "react";

// Devuelve la duración transcurrida desde `startIso` como string corto
// ("3 min", "1 h 04 m", "42 días"). Recalcula cada 30s — es lo que pide UX §3.2:
// suficiente para detectar mesas olvidadas sin gastar render-loops.
//
// `startIso` puede ser null/undefined (mesa libre) y entonces devuelve
// una cadena vacía, lo que simplifica el render condicional en el mapa.
export function useElapsedTime(startIso: string | null | undefined): string {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  if (!startIso) return "";
  const start = new Date(startIso).getTime();
  if (Number.isNaN(start)) return "";
  return formatElapsed(Math.max(0, now - start));
}

// v1.9.3-mapa-visual · variante numérica del hook para decidir la
// alerta de "mesa olvidada" (>45 min sin cambios). Mismo tick de 30 s
// que useElapsedTime; devuelve minutos enteros o null si no hay ticket.
export function useElapsedMinutes(
  startIso: string | null | undefined,
): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  if (!startIso) return null;
  const start = new Date(startIso).getTime();
  if (Number.isNaN(start)) return null;
  return Math.floor(Math.max(0, now - start) / 60_000);
}

// v1.10.3-barra · hallazgo #5 de la simulación de hora punta: una mesa
// zombi abierta desde hacía 43 días pintaba "1013 h 28 m", que ocupaba
// la línea entera de la tarjeta y no dice nada útil. A partir de un día
// la unidad humana es el día: nadie cuenta 1013 horas.
//
// Escala: "ahora" → "45 min" → "3 h 20 m" → "1 día" → "42 días".
// Ancho máximo del resultado: 8 caracteres ("999 días" es el peor caso
// realista), frente a los 11-12 de la versión en horas.
export function formatElapsed(ms: number): string {
  const totalMin = Math.floor(ms / 60_000);
  if (totalMin < 1) return "ahora";
  if (totalMin < 60) return `${totalMin} min`;
  const totalH = Math.floor(totalMin / 60);
  if (totalH < 24) {
    const m = totalMin % 60;
    return `${totalH} h ${m.toString().padStart(2, "0")} m`;
  }
  const days = Math.floor(totalH / 24);
  return days === 1 ? "1 día" : `${days} días`;
}
