// B-reservas-8 · EL BONO AL DAR LA CITA.
//
// Lo que la recepcionista ve en la superficie de alta, y por qué:
//
//   · Si la clienta tiene un bono que cubre lo que se está citando, sale
//     **YA MARCADO** con «quedan 3 libres → 2». Es lo normal: si tiene
//     bono, la cita es de bono; obligarla a marcarlo cada vez es pedirle
//     que se acuerde de lo que el sistema ya sabe.
//   · Si tiene DOS que valen, **se pregunta** y no se marca ninguno hasta
//     que elija. Gastar el de 10 sesiones en vez del de 1 que caduca el
//     viernes no se nota hasta que el de 1 caduca con una sesión dentro.
//   · Se puede desmarcar: entonces la cita nace normal y se cobra normal.
//
// Y la pieza que no se ve: **lo que se aparta lo decide el servidor**, en
// la misma transacción que la cita. Si no queda sesión libre, la cita NO
// NACE como cita de bono y el 409 lo dice con su motivo — el alta se
// repite sin bono con un toque.

import { useEffect, useState } from "react";
import { Loader2, Ticket } from "lucide-react";

import { bonosQueCubren, diaCorto, type BonoQueCubre } from "../lib/bonos.js";

export interface BonoDeLaCitaProps {
  clientId: string | null;
  serviceIds: string[];
  /** El bono elegido, o `null`. Lo manda el alta como `voucherId`. */
  elegido: string | null;
  onElegir: (voucherId: string | null) => void;
  /** La palabra del centro: «bono» por defecto, «programa» en el spa. */
  etiqueta: string;
}

export function BonoDeLaCita({
  clientId,
  serviceIds,
  elegido,
  onElegir,
  etiqueta,
}: BonoDeLaCitaProps) {
  const [bonos, setBonos] = useState<BonoQueCubre[] | null>(null);
  const [hayQuePreguntar, setHayQuePreguntar] = useState(false);
  const clave = `${clientId ?? ""}|${[...serviceIds].sort().join(",")}`;

  useEffect(() => {
    let cancelado = false;
    if (!clientId || serviceIds.length === 0) {
      setBonos([]);
      setHayQuePreguntar(false);
      // Cambiar de clienta o de servicio deja sin sentido el bono elegido:
      // se suelta aquí y no al guardar, para que la pantalla no diga «con
      // bono B87» de un bono que ya no cubre lo que hay delante.
      if (elegido) onElegir(null);
      return;
    }
    setBonos(null);
    bonosQueCubren(clientId, serviceIds)
      .then((r) => {
        if (cancelado) return;
        setBonos(r.bonos);
        setHayQuePreguntar(r.hayQuePreguntar);
        // UNO solo → se marca. DOS o más → se pregunta y no se marca
        // ninguno. Y si el que estaba elegido ya no está en la lista, se
        // suelta.
        if (r.bonos.length === 1 && !r.hayQuePreguntar) {
          onElegir(r.bonos[0]!.id);
        } else if (elegido && !r.bonos.some((b) => b.id === elegido)) {
          onElegir(null);
        }
      })
      .catch(() => {
        if (cancelado) return;
        // Un fallo aquí no puede impedir dar la cita: sin bonos, la cita
        // es normal. Lo que no se hace es enseñar un error que la
        // recepcionista no puede arreglar con una clienta delante.
        setBonos([]);
        setHayQuePreguntar(false);
      });
    return () => {
      cancelado = true;
    };
    // `clave` resume cliente + servicios: con las dependencias sueltas, un
    // array nuevo con los mismos ids relanzaría la consulta en cada render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clave]);

  if (!clientId || serviceIds.length === 0) return null;
  if (bonos === null) {
    return (
      <div className="flex items-center gap-2 text-[12px] text-slate-500">
        <Loader2 className="w-3.5 h-3.5 animate-spin" /> Buscando {etiqueta}s…
      </div>
    );
  }
  if (bonos.length === 0) return null;

  return (
    <div>
      <label className="text-[12px] font-medium text-slate-500">
        {hayQuePreguntar
          ? `Tiene ${bonos.length} ${etiqueta}s que valen para esto. ¿Con cuál?`
          : `Con ${etiqueta}`}
      </label>
      <div className="mt-1 space-y-1">
        {bonos.map((b) => {
          const marcado = elegido === b.id;
          const caduca = diaCorto(b.caducaEl);
          return (
            <button
              key={b.id}
              type="button"
              onClick={() => onElegir(marcado ? null : b.id)}
              className={
                "w-full h-11 px-3 rounded-xl border text-left text-[13px] flex items-center gap-2 " +
                (marcado
                  ? "bg-emerald-50 border-emerald-300 text-emerald-900"
                  : "bg-white border-slate-200 text-slate-700")
              }
            >
              <Ticket
                className={`w-4 h-4 shrink-0 ${marcado ? "text-emerald-600" : "text-slate-400"}`}
                strokeWidth={2.5}
              />
              <span className="min-w-0 truncate">
                <span className="font-medium">{b.code}</span>{" "}
                <span className="text-slate-500">· {b.nombre}</span>
                {/* La caducidad SÓLO cuando hay que elegir: es el dato que
                    decide cuál se gasta primero. Con un solo bono sobra. */}
                {hayQuePreguntar && caduca && (
                  <span className="text-slate-400"> · caduca {caduca}</span>
                )}
              </span>
              <span className="ml-auto shrink-0 tabular-nums text-[12px]">
                {/* LA FLECHA es la mitad que importa: dice qué va a pasar
                    al guardar, no qué pasó. */}
                quedan {b.sesionesLibres}
                {marcado ? ` → ${Math.max(0, b.sesionesLibres - 1)}` : " libres"}
                {b.sesionesApartadas > 0 ? ` · ${b.sesionesApartadas} apartada${b.sesionesApartadas === 1 ? "" : "s"}` : ""}
              </span>
            </button>
          );
        })}
      </div>
      {elegido && (
        <p className="mt-1 text-[11px] text-slate-500">
          Se apartará una sesión al guardar la cita. Si la anulas, vuelve.
        </p>
      )}
      {!elegido && !hayQuePreguntar && (
        <p className="mt-1 text-[11px] text-slate-500">
          Sin {etiqueta}: la cita se cobrará normal.
        </p>
      )}
    </div>
  );
}
