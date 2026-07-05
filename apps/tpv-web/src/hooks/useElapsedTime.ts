import { useEffect, useState } from "react";

// Devuelve la duración transcurrida desde `startIso` como string corto
// ("3 min", "1 h 04 m"). Recalcula cada 30s — es lo que pide UX §3.2:
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

export function formatElapsed(ms: number): string {
  const totalMin = Math.floor(ms / 60_000);
  if (totalMin < 1) return "ahora";
  if (totalMin < 60) return `${totalMin} min`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${h} h ${m.toString().padStart(2, "0")} m`;
}
