// Persistencia del carrito en curso (v1.5-consistencia-A §4.b).
//
// SalePage mantenía el carrito en un useState puro: cualquier remount
// (ErrorBoundary, recarga tras crash, reload del SW) perdía la venta a
// medio teclear. Este hook respalda las líneas en sessionStorage en
// cada cambio y las restaura al montar.
//
// La clave incluye el contexto (id de mesa o "quick-sale") para que el
// carrito de una mesa no se filtre a otra ni a la venta rápida. Se usa
// sessionStorage (no localStorage) a propósito: el carrito en curso es
// efímero por pestaña; los carritos aparcados ya tienen su propio flujo
// en localStorage (suspended-carts).

import { useEffect, useRef, useState } from "react";

import type { CartLine } from "./cart.js";

const STORAGE_PREFIX = "mipiacetpv-cart-in-progress:";

export function loadPersistedCartLines(storageKey: string): CartLine[] {
  try {
    const raw = sessionStorage.getItem(storageKey);
    if (!raw) return [];
    const arr = JSON.parse(raw) as CartLine[];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function savePersistedCartLines(storageKey: string, lines: CartLine[]): void {
  try {
    if (lines.length === 0) {
      sessionStorage.removeItem(storageKey);
    } else {
      sessionStorage.setItem(storageKey, JSON.stringify(lines));
    }
  } catch {
    // Cuota llena o storage no disponible — el carrito sigue en
    // memoria; sólo perdemos la red de seguridad.
  }
}

export function usePersistedCartLines(
  contextKey: string,
): [CartLine[], React.Dispatch<React.SetStateAction<CartLine[]>>] {
  const storageKey = `${STORAGE_PREFIX}${contextKey}`;
  const [lines, setLines] = useState<CartLine[]>(() =>
    loadPersistedCartLines(storageKey),
  );
  const keyRef = useRef(storageKey);
  useEffect(() => {
    if (keyRef.current !== storageKey) {
      // Cambio de contexto (otra mesa) sin remount: cargar el carrito
      // del contexto nuevo en vez de persistir el del viejo bajo la
      // clave equivocada.
      keyRef.current = storageKey;
      setLines(loadPersistedCartLines(storageKey));
      return;
    }
    savePersistedCartLines(storageKey, lines);
  }, [storageKey, lines]);
  return [lines, setLines];
}
