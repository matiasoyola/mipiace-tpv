// v1.22-el-terminal-del-bar · §5 (hallazgo B2).
//
// El aviso de mesas abiertas, en un solo sitio para que el cierre, el
// arqueo y la apertura de turno digan lo MISMO. No es un modal y no
// bloquea nada: va DELANTE del botón de cerrar, como un bloque de la
// propia tarjeta.
//
// Ámbar y no rojo: cerrar el día con una mesa abierta no es un error del
// cajero —la mesa puede seguir cenando— es un dato que tiene que ver
// antes de decidir. `tokens.md` §2 reserva el ámbar para "atención /
// pidiendo cuenta", que es exactamente esto.
//
// Enumera mesa e importe en vez de decir sólo "hay 3 abiertas": con el
// nombre, el encargado sabe si es la terraza que todavía está o la M4
// que alguien abrió por error hace seis horas.

import { AlertTriangle } from "lucide-react";

import { formatEur } from "../lib/money.js";
import type { OpenTablesSummary } from "../lib/openTables.js";

export function OpenTablesNotice({
  summary,
  variant = "close",
  className = "",
}: {
  summary: OpenTablesSummary | null;
  // "close"  → se está cerrando el día: las mesas se quedan abiertas.
  // "open"   → se está abriendo turno: las mesas vienen heredadas.
  variant?: "close" | "open";
  className?: string;
}) {
  // `null` es "no se ha podido preguntar" (sin red, o el GET falló) y
  // cero es "no hay ninguna". En los dos casos no se pinta nada: un
  // aviso que dice "puede que haya mesas abiertas" no sirve para decidir.
  if (!summary || summary.count === 0) return null;

  const plural = summary.count === 1 ? "" : "s";
  return (
    <div
      data-testid="open-tables-notice"
      role="status"
      className={
        "rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-amber-900 " +
        className
      }
    >
      <div className="flex items-start gap-2">
        <AlertTriangle className="w-4 h-4 mt-px shrink-0" strokeWidth={2.25} />
        <p className="text-[13px] font-medium">
          {variant === "open"
            ? `Vienes con ${summary.count} mesa${plural} abierta${plural} del turno anterior · ${formatEur(summary.total)} en sala`
            : `Queda${plural} ${summary.count} mesa${plural} abierta${plural} en sala · ${formatEur(summary.total)}`}
        </p>
      </div>
      <ul className="mt-2 space-y-1">
        {summary.rows.map((r) => (
          <li
            key={r.id}
            className="flex items-baseline justify-between gap-3 rounded-lg bg-white/60 px-2.5 py-1.5 text-[12.5px]"
          >
            <span className="font-medium truncate">{r.name}</span>
            <span className="tabular-nums shrink-0">{formatEur(r.total)}</span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[11.5px] text-amber-800">
        {variant === "open"
          ? "Siguen en el mapa con su cuenta: se pueden cobrar en este turno."
          : "El cierre no las cobra ni las vacía: siguen abiertas en el mapa."}
      </p>
    </div>
  );
}
