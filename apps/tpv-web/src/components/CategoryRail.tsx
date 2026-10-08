// v1.22-el-terminal-del-bar · §4 (hallazgo N2 de la auditoría del
// 2026-10-06; decisión de producto tomada el 02-09 y sin construir).
//
// El problema, medido en el AP13 con la carta de La Maestranza: nueve
// categorías, se veían seis chips y Platos, Raciones, Refrescos y Vinos
// quedaban detrás de «Más (4)». Refrescos tiene 21 productos y en un bar
// es de lo que más sale. Y al elegir una del sheet, la fila seguía
// diciendo «Más (4)» resaltado: el camarero no veía en qué categoría
// estaba.
//
// Por qué un rail VERTICAL y no dos filas de chips ni scroll horizontal:
//
//   · El scroll horizontal está prohibido por `ux-principles` §1.8 y un
//     gradiente no lo arregla (v1.14 ya lo intentó).
//   · Dos filas de chips costaban ~100 px de ALTO —media fila de
//     producto— y con «Más (3)» seguían sin verse todas: v1.14.1 las
//     quitó por eso. El eje que sobra en una pantalla apaisada es el
//     HORIZONTAL, no el vertical: a 1443 px de ancho el catálogo tiene
//     1003 y la rejilla cabe en 843.
//   · Y si el rail se queda corto de alto, scrollea en VERTICAL, que es
//     lo que §1.8 sí permite.
//
// Por qué el reparto depende del DISPOSITIVO y no del número de
// categorías: el layout no puede cambiar de forma por un dato que el
// propietario toca en Holded sin saber lo que provoca. Añadir la décima
// categoría un martes no puede mover de sitio todo lo que el camarero
// ya tiene aprendido. El rail es de tablet (≥ lg, el mismo umbral con
// el que el layout decide panel lateral contra handheld) y la fila de
// chips es de handheld. Siempre.

import type { ReactNode } from "react";
import { Star } from "lucide-react";

export interface RailCategory {
  tag: string;
  label: string;
  icon: ReactNode;
}

/**
 * Ancho del rail, en px. Medido en el navegador con la carta de La
 * Maestranza: la etiqueta más larga ("Bocadillos", "Desayunos",
 * "Refrescos") pide 92 px a 14 px / 500, más el icono (18), el hueco
 * (10) y el padding horizontal (2 × 14) son 144.
 *
 * `w-36` de Tailwind, no un `w-[144px]` suelto.
 */
export const CATEGORY_RAIL_WIDTH = 144;

const ITEM_BASE =
  "h-touch w-full px-3.5 rounded-2xl border text-[14px] font-medium flex items-center gap-2.5 shrink-0 text-left";
// Mismo lenguaje de selección que los chips de v1.14.1: coral SUAVE. El
// coral pleno del área de trabajo es de "Cobrar" y de nadie más.
const ITEM_IDLE =
  "bg-white border-slate-200 text-mipiace-ink hover:border-mipiace-coral/40";
const ITEM_SELECTED =
  "bg-mipiace-coral-soft border-mipiace-coral text-mipiace-coral-dark";

export function CategoryRail({
  categories,
  selectedTag,
  onSelect,
  leading,
  className = "",
}: {
  categories: RailCategory[];
  selectedTag: string | null;
  onSelect: (tag: string | null) => void;
  // El toggle Servicios/Productos de los verticales SERVICES, que en la
  // fila de chips va delante de las categorías. Es navegación fija, no
  // una categoría: va arriba y separado por un divisor.
  leading?: ReactNode;
  className?: string;
}) {
  return (
    <nav
      data-testid="category-rail"
      aria-label="Categorías"
      // `overflow-y-auto` y NUNCA `overflow-x`: si las categorías no
      // caben en alto, el rail scrollea hacia abajo. Un scroll
      // horizontal escondido es una función que no existe (§1.8).
      className={
        "shrink-0 flex flex-col gap-2 overflow-y-auto overflow-x-hidden pr-0.5 " +
        className
      }
      style={{ width: CATEGORY_RAIL_WIDTH }}
    >
      {leading && (
        <>
          {leading}
          <div className="h-px bg-slate-200 my-0.5 shrink-0" aria-hidden />
        </>
      )}
      {/* "Todos" primero y siempre: es la salida de cualquier filtro. */}
      <button
        type="button"
        onClick={() => onSelect(null)}
        aria-pressed={selectedTag === null}
        className={`${ITEM_BASE} ${selectedTag === null ? ITEM_SELECTED : ITEM_IDLE}`}
      >
        <Star
          className={
            selectedTag === null
              ? "w-[18px] h-[18px] shrink-0 fill-mipiace-coral text-mipiace-coral"
              : "w-[18px] h-[18px] shrink-0 text-slate-400"
          }
          strokeWidth={2.25}
        />
        <span className="truncate">Todos</span>
      </button>
      {categories.map((c) => {
        const active = selectedTag === c.tag;
        return (
          <button
            key={c.tag}
            type="button"
            onClick={() => onSelect(c.tag)}
            aria-pressed={active}
            data-tone-item="true"
            className={`${ITEM_BASE} ${active ? ITEM_SELECTED : ITEM_IDLE}`}
          >
            {c.icon}
            <span className="truncate">{c.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
