// n1-hosteleria-2 · hallazgo 9 · LA HOJA DE LO QUE ESTÁ LISTO.
//
// Lo que había: tocar un aviso de cocina lo daba por servido en el acto.
// El aviso desaparecía y el camarero se quedaba con el nombre de una mesa
// y sin saber qué tenía que coger del pase.
//
// Lo que hay: el aviso ABRE esta hoja —una por mesa— con las líneas
// listas (cantidad, el nombre entero y los alérgenos marcados) y un
// «Hecho» grande abajo, que es el que sirve.
//
// Va en TODOS los aparatos, porque es un cambio de flujo y no de reparto.
// Lo que cambia con el tamaño es la forma, no los pasos:
//
//   · en la mano, a pantalla completa (R1: una sola capa a la vista);
//   · en el terminal, centrada, como el resto de los diálogos de la casa.

import {
  alergenosDeLaMesa,
  hojaDeListoOcupaLaPantalla,
  rotuloDeLinea,
  type MesaLista,
} from "../../lib/avisosListos.js";
import { useBackGuard } from "../../hooks/useBackGuard.js";
import {
  DARK_PANEL,
  DARK_SURFACE_RAISED,
  DARK_TEXT,
  DARK_TEXT_MUTED,
  MIN_TOUCH_PX,
  PRESS_FEEDBACK_CLASS,
} from "../../lib/hospitalityTheme.js";
import { SUELO_LETRA_MANO_PX } from "../../lib/roomGrid.js";
import { VERDE_LISTA, VERDE_LISTA_TEXT } from "../../lib/kitchenTheme.js";

/**
 * El «Hecho» de la mano: `MIN_TOUCH_PX` + la mitad.
 *
 * El hallazgo pide «un “Hecho” grande», y grande aquí quiere decir que no
 * se falle con el aparato en una mano y una bandeja en la otra. 84 px es
 * el alto de `COBRAR_HEIGHT_PX` (68) más el margen que pide un botón que
 * se toca sin mirar — y es el objetivo más grande de la pantalla, que es
 * lo que debe ser cuando sólo hay una cosa que hacer.
 */
export const HECHO_ALTO_MANO = 84;
/** En el terminal, el mismo papel con el tamaño de la casa. */
export const HECHO_ALTO_TERMINAL = 68;

export interface HojaDeListoProps {
  mesa: MesaLista;
  deMano: boolean;
  /** Sirve TODAS las comandas de la mesa. */
  onHecho: (orderIds: string[]) => void;
  onCerrar: () => void;
}

export function HojaDeListo(props: HojaDeListoProps) {
  // R3 · toda hoja se cierra también con el «atrás» de Android. Y cerrar
  // NO es servir: el atrás nunca decide nada (la misma regla que
  // `ConfirmSheet`).
  useBackGuard(props.onCerrar);

  const { mesa, deMano } = props;
  const completa = hojaDeListoOcupaLaPantalla(deMano);
  const alergenos = alergenosDeLaMesa(mesa);
  const px = deMano ? SUELO_LETRA_MANO_PX : 17;

  return (
    <div
      data-testid="hoja-listo"
      data-pantalla-completa={completa ? "true" : "false"}
      className={
        completa
          ? "fixed inset-0 z-[80] flex flex-col"
          : "fixed inset-0 z-[80] flex items-center justify-center p-6"
      }
      style={completa ? { background: DARK_PANEL } : { background: "rgba(0,0,0,0.55)" }}
      onClick={completa ? undefined : props.onCerrar}
      role={completa ? undefined : "presentation"}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${mesa.tableName ?? "Comanda"} · listo para servir`}
        onClick={(e) => e.stopPropagation()}
        className={
          completa
            ? "flex flex-col h-full w-full"
            : "flex flex-col w-full max-w-[520px] rounded-3xl overflow-hidden"
        }
        style={completa ? undefined : { background: DARK_PANEL }}
      >
        {/* La cabecera dice DE QUÉ MESA es, en verde, que es el color con
            el que el aviso llegó. */}
        <div
          className="shrink-0 flex items-center gap-3 px-4"
          style={{
            height: deMano ? 72 : 68,
            background: VERDE_LISTA,
            color: VERDE_LISTA_TEXT,
          }}
        >
          <span
            className="flex-1 min-w-0 font-bold truncate"
            style={{ fontSize: deMano ? 22 : 24 }}
          >
            {mesa.tableName ?? "Comanda"} · listo
          </span>
          <button
            type="button"
            data-testid="hoja-listo-cerrar"
            onClick={props.onCerrar}
            aria-label="Cerrar sin servir"
            className={`shrink-0 rounded-xl flex items-center justify-center font-bold ${PRESS_FEEDBACK_CLASS}`}
            style={{
              width: MIN_TOUCH_PX,
              height: MIN_TOUCH_PX,
              background: "rgba(0,0,0,0.12)",
              color: VERDE_LISTA_TEXT,
              fontSize: 18,
            }}
          >
            ✕
          </button>
        </div>

        {/* Los alérgenos de la mesa, arriba del todo y en rojo: es lo
            único de esta hoja que, si se pasa por alto, hace daño. */}
        {alergenos.length > 0 && (
          <div
            data-testid="hoja-listo-alergias"
            className="shrink-0 mx-3 mt-3 rounded-[12px] px-4 py-2.5 font-bold"
            style={{ background: "#7E2318", color: "#FFFFFF", fontSize: px + 2 }}
          >
            ⚠ Alergias · {alergenos.join(", ")}
          </div>
        )}

        {/* Lo que hay que coger. El nombre ENTERO: nada de truncar. */}
        <div
          data-testid="hoja-listo-lineas"
          className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-3 py-3 flex flex-col gap-2"
        >
          {mesa.lineas.length === 0 ? (
            // Sin líneas —el camino de la wifi no las trae— la hoja sigue
            // valiendo: dice de qué mesa es y sirve. Lo que no hace es
            // mentir con una lista vacía que parezca «no hay nada».
            <p
              data-testid="hoja-listo-sin-lineas"
              className="py-8 text-center"
              style={{ fontSize: px, color: DARK_TEXT_MUTED }}
            >
              Cocina no ha mandado el detalle de esta comanda.
              <br />
              Lo que está listo es lo de {mesa.tableName ?? "esta comanda"}.
            </p>
          ) : (
            mesa.lineas.map((l) => (
              <div
                key={l.id}
                data-testid="hoja-listo-linea"
                className="rounded-[12px] px-4 py-3 flex items-start gap-3"
                style={{ background: DARK_SURFACE_RAISED, color: DARK_TEXT }}
              >
                <span
                  className="font-semibold leading-snug"
                  style={{ fontSize: px + 4 }}
                >
                  {rotuloDeLinea(l)}
                </span>
                {(l.allergens ?? []).length > 0 && (
                  <span
                    className="ml-auto shrink-0 rounded-lg px-2 py-1 font-bold"
                    style={{ background: "#7E2318", color: "#FFFFFF", fontSize: px - 1 }}
                  >
                    ⚠
                  </span>
                )}
              </div>
            ))
          )}
        </div>

        {/* El «Hecho». Lo único que sirve, y lo más grande de la hoja. */}
        <div className="shrink-0 px-3 pb-3 pt-1">
          <button
            type="button"
            data-testid="hoja-listo-hecho"
            onClick={() => props.onHecho(mesa.orderIds)}
            className={`w-full rounded-2xl font-bold ${PRESS_FEEDBACK_CLASS}`}
            style={{
              height: deMano ? HECHO_ALTO_MANO : HECHO_ALTO_TERMINAL,
              background: VERDE_LISTA,
              color: VERDE_LISTA_TEXT,
              fontSize: deMano ? 24 : 22,
            }}
          >
            Hecho
          </button>
        </div>
      </div>
    </div>
  );
}
