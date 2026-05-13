import { useEffect, useRef } from "react";

// Hook que dispara onLogout tras N minutos sin actividad. Escucha
// pointerdown, keydown, scroll en el document. Cualquier evento resetea
// el contador. Cuando dispara, llama al callback — el caller decide si
// invalida sesión, redirige, etc. (B3 §17.2).

export function useInactivityLogout(
  enabled: boolean,
  timeoutMinutes: number,
  onLogout: () => void,
): void {
  const onLogoutRef = useRef(onLogout);
  onLogoutRef.current = onLogout;

  useEffect(() => {
    if (!enabled) return;
    const ms = Math.max(1, timeoutMinutes) * 60 * 1000;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const reset = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => onLogoutRef.current(), ms);
    };
    const events: Array<keyof DocumentEventMap> = [
      "pointerdown",
      "keydown",
      "scroll",
      "visibilitychange",
    ];
    events.forEach((e) => document.addEventListener(e, reset, { passive: true }));
    reset();
    return () => {
      events.forEach((e) => document.removeEventListener(e, reset));
      if (timer) clearTimeout(timer);
    };
  }, [enabled, timeoutMinutes]);
}
