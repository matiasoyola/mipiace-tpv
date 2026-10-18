// B-reservas-8 · EL CHIP DEL BONO en la línea del ticket.
//
// Lo que la cajera ve, y por qué está así:
//
//   · Una línea que se paga con bono lleva **«Con bono B87 · quedan 3 → 2»**
//     y su importe a 0 €. La flecha es la mitad que importa: dice qué va a
//     pasar al cobrar, no qué pasó.
//   · Una línea que SE PODRÍA pagar con bono lleva el chip apagado y se
//     toca para marcarla. Si hay DOS bonos que la cubren, se pregunta —el
//     servidor no elige, y el front tampoco.
//   · El chip marcado se toca para QUITARLO: entonces lo apartado se libera
//     y la línea vuelve a su precio.
//
// **Ningún botón gris mudo.** Si el servidor dice que no, la frase que
// escribió el servidor se pinta debajo del chip, no en un toast que se va.
//
// Y nada de saldo calculado aquí: `quedan 3 → 2` sale de lo que devuelve
// `GET /tickets/:id/bonos`, que lo lee de la base.

import { useState } from "react";
import { Loader2, Ticket } from "lucide-react";

import {
  marcarCanje,
  quitarCanje,
  sesiones,
  type PropuestaDeCanje,
} from "../lib/bonos.js";

export interface BonoDeLaLineaProps {
  ticketId: string;
  propuesta: PropuestaDeCanje;
  /** La palabra del centro: «bono» por defecto, «programa» en el spa. */
  etiqueta: string;
  /** Se llama al terminar para que el carrito se recargue del servidor:
   *  el importe de la línea y el total los ha cambiado la API. */
  onCambiado: () => Promise<void> | void;
}

export function BonoDeLaLinea({
  ticketId,
  propuesta,
  etiqueta,
  onCambiado,
}: BonoDeLaLineaProps) {
  const [trabajando, setTrabajando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [eligiendo, setEligiendo] = useState(false);

  const marcado = propuesta.marcadoCon;
  const elMarcado = propuesta.bonos.find((b) => b.id === marcado);

  async function marcar(voucherId: string) {
    setTrabajando(true);
    setError(null);
    const res = await marcarCanje(ticketId, propuesta.ticketLineId, voucherId);
    setTrabajando(false);
    setEligiendo(false);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    await onCambiado();
  }

  async function quitar() {
    setTrabajando(true);
    setError(null);
    const res = await quitarCanje(ticketId, propuesta.ticketLineId);
    setTrabajando(false);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    await onCambiado();
  }

  // ── Ya marcada ────────────────────────────────────────────────────
  if (marcado) {
    return (
      <div className="mt-1">
        <button
          type="button"
          disabled={trabajando}
          onClick={(ev) => {
            ev.stopPropagation();
            void quitar();
          }}
          className="inline-flex items-center gap-1.5 h-7 px-2 rounded-lg bg-emerald-50 border border-emerald-300 text-[11px] text-emerald-800 font-medium disabled:opacity-60"
        >
          {trabajando ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <Ticket className="w-3 h-3" strokeWidth={2.5} />
          )}
          Con {etiqueta} {codigoDe(propuesta, marcado)}
          {elMarcado
            ? ` · quedan ${elMarcado.sesionesLibres} → ${Math.max(
                0,
                elMarcado.sesionesLibres - 1,
              )}`
            : ""}
        </button>
        <span className="text-[11px] text-slate-400 ml-2">toca para quitarlo</span>
        {error && <Aviso>{error}</Aviso>}
      </div>
    );
  }

  if (propuesta.bonos.length === 0) return null;

  // ── Un solo bono: un toque ────────────────────────────────────────
  if (propuesta.bonos.length === 1 && !eligiendo) {
    const b = propuesta.bonos[0]!;
    return (
      <div className="mt-1">
        <button
          type="button"
          disabled={trabajando}
          onClick={(ev) => {
            ev.stopPropagation();
            void marcar(b.id);
          }}
          className="inline-flex items-center gap-1.5 h-7 px-2 rounded-lg bg-white border border-dashed border-emerald-300 text-[11px] text-emerald-800 disabled:opacity-60"
        >
          {trabajando ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <Ticket className="w-3 h-3" strokeWidth={2.5} />
          )}
          Pagar con {etiqueta} {b.code} · le quedan {b.sesionesLibres}
        </button>
        {error && <Aviso>{error}</Aviso>}
      </div>
    );
  }

  // ── Dos o más: SE PREGUNTA ────────────────────────────────────────
  //
  // El servidor devuelve todos los que cubren y no elige. Gastar el de 10
  // sesiones en vez del de 1 que caduca el viernes no se nota hasta que el
  // de 1 caduca con una sesión dentro.
  return (
    <div className="mt-1">
      <div className="text-[11px] text-slate-500 mb-1">
        Tiene {propuesta.bonos.length} {etiqueta}s que valen para esto. ¿Con
        cuál?
      </div>
      <div className="flex flex-wrap gap-1.5">
        {propuesta.bonos.map((b) => (
          <button
            key={b.id}
            type="button"
            disabled={trabajando}
            onClick={(ev) => {
              ev.stopPropagation();
              void marcar(b.id);
            }}
            className="inline-flex items-center gap-1 h-7 px-2 rounded-lg bg-white border border-emerald-300 text-[11px] text-emerald-800 disabled:opacity-60"
          >
            {b.code} · quedan {b.sesionesLibres}
            {b.caducaEl ? ` · caduca ${b.caducaEl.slice(8, 10)}-${b.caducaEl.slice(5, 7)}` : ""}
          </button>
        ))}
      </div>
      {error && <Aviso>{error}</Aviso>}
    </div>
  );
}

function Aviso({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-1 text-[11px] text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-2 py-1">
      {children}
    </div>
  );
}

/** El código del bono marcado. Si el bono ya no está en la lista de los que
 *  cubren —porque al apartarse se quedó sin libres— se enseña el id corto
 *  antes que nada: la cajera tiene que poder leer CON QUÉ se está pagando
 *  aunque el saldo haya cambiado. */
function codigoDe(propuesta: PropuestaDeCanje, voucherId: string): string {
  return propuesta.bonos.find((b) => b.id === voucherId)?.code ?? "";
}

/** La frase del pie del ticket: «1 sesión de bono en este ticket». Sale
 *  cuando hay al menos una línea marcada, para que al cobrar a 0 € nadie se
 *  pregunte por qué el total es cero. */
export function resumenDeCanjes(
  propuestas: PropuestaDeCanje[],
  etiqueta: string,
): string | null {
  const marcadas = propuestas.filter((p) => p.marcadoCon != null).length;
  if (marcadas === 0) return null;
  return `${sesiones(marcadas)} de ${etiqueta} en este ticket`;
}
