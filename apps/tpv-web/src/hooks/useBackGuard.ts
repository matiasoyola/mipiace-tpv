// v1.12-manos-de-camarero · el Atrás del sistema no puede echar al
// camarero (hallazgo H6 del 2026-08-27).
//
// Lo que pasó en el terminal: durante el arqueo, el Atrás cerró el
// modal y al siguiente toque expulsó al escritorio de Android **con el
// turno abierto**. Al volver con el icono de Chrome se abrió una
// segunda pestaña, y esa pestaña pidió el PIN otra vez (la sesión de
// cajero no viaja entre pestañas). La APK quita las pestañas, pero el
// Atrás sigue en la barra de navegación: hay que interceptarlo.
//
// `tpv-web` no tiene router: `App.tsx` es una máquina de estados y no
// hay entradas de historia, así que el PRIMER Atrás sale de la
// aplicación. El apaño es una entrada centinela y una pila de capas:
//
//   - Al arrancar se empuja un estado centinela. Cada `popstate` vuelve
//     a empujarlo, así que la historia nunca se vacía y el navegador no
//     tiene a dónde salir.
//   - Cada hoja/modal se registra al abrirse con `useBackGuard(onClose,
//     isOpen)`. El Atrás cierra la capa de MÁS ARRIBA (la última en
//     registrarse), como esperaría cualquiera.
//   - Sin capas abiertas manda el guardia de fondo (`setBackFallback`,
//     que pone `App.tsx`): dentro de una venta, vuelve al mapa de
//     mesas; con el turno abierto y sin más sitio al que ir, no hace
//     nada. Nunca al escritorio.
//
// Es deliberadamente global y no un contexto de React: quien tiene que
// llegar a esta pila es un evento del navegador, no un render.

import { useEffect, useRef } from "react";

type Layer = { id: number; close: () => void };

const SENTINEL = { mipiaceBackGuard: true } as const;

let layers: Layer[] = [];
let nextId = 1;
let installed = false;
// Guardia de fondo: qué hacer con el Atrás cuando no hay ninguna capa
// abierta. Devuelve `true` si ha gestionado la salida.
let fallback: (() => boolean) | null = null;

function pushSentinel(): void {
  try {
    history.pushState(SENTINEL, "");
  } catch {
    // Un `pushState` puede fallar por cuota en navegadores viejos. Si
    // falla, el Atrás vuelve a ser el del sistema: degradamos, no
    // rompemos.
  }
}

function onPopState(): void {
  // Pase lo que pase, reponemos el centinela: la historia no se puede
  // quedar vacía o el siguiente Atrás sale de la app.
  pushSentinel();
  const top = layers[layers.length - 1];
  if (top) {
    top.close();
    return;
  }
  fallback?.();
}

/** Arranca el guardia. Idempotente: se llama una vez desde `App.tsx`. */
export function installBackGuard(): void {
  if (installed) return;
  installed = true;
  pushSentinel();
  window.addEventListener("popstate", onPopState);
}

/**
 * Qué hace el Atrás cuando no hay capas abiertas. `App.tsx` lo
 * actualiza según la vista (venta → mapa de mesas; mapa → nada).
 */
export function setBackFallback(fn: (() => boolean) | null): void {
  fallback = fn;
}

/** Sólo para tests: deja el módulo como recién cargado. */
export function __resetBackGuardForTests(): void {
  if (installed) window.removeEventListener("popstate", onPopState);
  layers = [];
  nextId = 1;
  installed = false;
  fallback = null;
}

/** Sólo para tests: cuántas capas hay registradas ahora mismo. */
export function __backGuardLayerCount(): number {
  return layers.length;
}

/**
 * Registra una capa cerrable mientras `isOpen`. El Atrás del sistema
 * cierra la de más arriba.
 */
export function useBackGuard(onClose: () => void, isOpen = true): void {
  // La capa guarda una referencia estable y lee el callback fresco al
  // dispararse: si re-registráramos la capa en cada render (porque
  // `onClose` cambia de identidad), saltaría a lo alto de la pila y el
  // Atrás cerraría la hoja equivocada.
  const cbRef = useRef(onClose);
  cbRef.current = onClose;

  useEffect(() => {
    if (!isOpen) return;
    installBackGuard();
    const layer: Layer = { id: nextId++, close: () => cbRef.current() };
    layers.push(layer);
    return () => {
      layers = layers.filter((l) => l.id !== layer.id);
    };
  }, [isOpen]);
}
