// v2-H1-venta-y-sala · el campo de búsqueda de la venta, extraído.
//
// POR QUÉ SE EXTRAE
//
// Este input es el aterrizaje del lector de códigos USB-HID y, desde
// v1.22 (hallazgo N1), la **segunda capa** del arreglo del teclado del
// sistema: plegado sigue montado y enfocable pero con
// `inputMode="none"`, así que Android no saca el QWERTY al enfocarlo, y
// el lector escribe igual porque entra como eventos de teclado y no por
// el IME.
//
// v2-H1 pinta la venta de hostelería con un componente propio y sin
// barra superior. Con el input dentro del `<header>` del TPV claro, la
// pantalla del bar se quedaba **sin el sitio donde aterriza el lector y
// sin la protección del IME** — una regresión directa de v1.22, que el
// prompt de este bloque nombra como la primera cosa que no se puede
// regresar.
//
// Copiar el input en los dos sitios era la otra salida, y es peor: v1.22
// dejó escrito que la condición «plegado» estaba repetida en tres puntos
// del JSX y que una cuarta copia desincronizada volvería a abrir el
// teclado. Así que vive aquí, una vez, y los dos la montan.
//
// Las dos ramas nunca coexisten (`isHospitality` las excluye), así que
// el `ref` que las dos pasan apunta siempre a un único input montado.

import { Search } from "lucide-react";
import type { RefObject } from "react";

import type { BusinessType } from "../lib/catalog.js";

export interface SaleSearchInputProps {
  inputRef: RefObject<HTMLInputElement | null>;
  value: string;
  onChange: (v: string) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  /**
   * `true` mientras el buscador está plegado. Es la condición de la que
   * depende TODO el comportamiento de N1: posición fuera de cuadro,
   * `inputMode`, `aria-hidden` y `tabIndex`. Llega con un nombre y no
   * recalculada aquí para que siga habiendo una sola fuente.
   */
  collapsed: boolean;
  businessType: BusinessType | null;
  /** `"light"` es el campo de hoy; `"dark"` el de la venta de hostelería. */
  tone?: "light" | "dark";
}

export function SaleSearchInput({
  inputRef,
  value,
  onChange,
  onKeyDown,
  collapsed,
  businessType,
  tone = "light",
}: SaleSearchInputProps) {
  const placeholder =
    businessType === "SERVICES"
      ? "Buscar servicio o cliente…"
      : "Buscar producto, código de barras o SKU…";
  const dark = tone === "dark";
  return (
    <>
      <Search
        className={
          dark
            ? "absolute left-4 top-1/2 -translate-y-1/2 w-[18px] h-[18px]"
            : "absolute left-4 md:left-5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400"
        }
        style={dark ? { color: "#8B93A1" } : undefined}
        strokeWidth={2.25}
      />
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        type="search"
        // v1.22 · hallazgo N1 · SEGUNDA capa del arreglo del teclado del
        // sistema, y la que protege aunque la detección de táctil vuelva
        // a fallar con el WebView del próximo fabricante.
        //
        // Mientras el buscador está PLEGADO el input sigue montado y
        // enfocable —es donde aterriza el lector USB-HID, que es toda su
        // razón de existir—, pero con `inputMode="none"` Android no saca
        // el QWERTY al enfocarlo. El lector escribe igual: entra como
        // eventos de teclado, no por el IME.
        //
        // Al DESPLEGARLO vuelve a `search`, que es cuando el camarero
        // acaba de pedir escribir y el teclado es lo que espera ver.
        inputMode={collapsed ? "none" : "search"}
        enterKeyHint="search"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        // Sólo cuando está plegado: emitir `aria-hidden="false"` en
        // retail sería ruido en el árbol de accesibilidad.
        aria-hidden={collapsed ? true : undefined}
        tabIndex={collapsed ? -1 : undefined}
        placeholder={placeholder}
        className={
          dark
            ? "h-[56px] w-full min-w-0 pl-11 pr-4 text-[16px] rounded-2xl border focus:outline-none"
            : "h-12 md:h-14 w-full min-w-0 pl-11 md:pl-12 pr-4 text-[14px] md:text-[14.5px] bg-mipiace-stone border border-transparent rounded-2xl focus:outline-none focus:ring-2 focus:ring-mipiace-coral/40 focus:bg-white focus:border-mipiace-coral/30"
        }
        style={
          dark
            ? {
                background: "#1C2026",
                borderColor: "#2C313A",
                color: "#F1F3F5",
              }
            : undefined
        }
      />
    </>
  );
}
