// v1.12-manos-de-camarero · confirmación de acciones destructivas
// (hallazgo H5 del 2026-08-27).
//
// Lo que había: `confirm("¿Vaciar la mesa? La cuenta se cancela.")`. En
// el terminal sale como *"mipiacetpv.com dice: ¿Vaciar la mesa?"* con
// botones azules de Chrome — rompe la marca — y, peor, con dos
// "Cancelar" que significan cosas opuestas: cancelar la cuenta y
// cancelar el diálogo. El camarero no puede leer dos veces en barra.
//
// Reglas del componente:
//   - Verbos explícitos en los dos botones. Nunca "Sí/No", nunca
//     "Aceptar/Cancelar".
//   - Los dos botones NO empiezan por la misma palabra: "Cancelar la
//     cuenta" / "Seguir con la cuenta", no "Cancelar" / "Cancelar".
//   - La acción destructiva en coral; la salida, neutra.
//   - Objetivos táctiles de la escala `touch` (48 px), que es lo que
//     mide un dedo con prisa.

// n1-hosteleria-2 · hallazgo 8 · LAS OPCIONES DE UNA MESA, EN LA MANO.
//
// Matías, 23-10: «las opciones de una mesa por recoger, muy pequeñas».
// Medido, eran tres cosas a la vez y ninguna era el alto del botón (ya
// estaba en los 48 de la escala `touch`):
//
//   · la LETRA. Título a 18 px, cuerpo a 14 y los tres botones a 14,
//     todos por debajo del suelo de R4 (15). El cuerpo es además donde
//     va el dato que se consulta para decidir («se cobró hace 12 min»);
//   · el ANCHO. `max-w-md` con `p-3` alrededor deja la hoja flotando con
//     12 px de lienzo a cada lado, que a 360 se lee como una tarjeta
//     pequeña en medio de la pantalla y no como la hoja de la mesa;
//   · el ORDEN. La tercera salida (`altLabel`) se pintaba como texto
//     gris, sin relleno y DEBAJO de la salida neutra. En la mesa por
//     recoger esa tercera salida es «Dejar libre», que es justamente la
//     acción más probable: durante el servicio el camarero mira el mapa
//     para encontrar mesas que recoger. La acción más probable era la
//     más pequeña y la última.
//
// Lo que cambia en la mano: la hoja va a todo el ancho pegada abajo, los
// tres botones miden `MIN_TOUCH_PX` y llevan relleno propio, y el orden
// pasa a ser acción · acción · salida, con la salida al final porque es
// donde cae el pulgar y porque salir tiene que ser lo barato.
//
// Por encima del umbral de mano no se mueve nada: es la restricción del
// bloque, y ahí esta hoja sale centrada como hasta ahora.

import { useAparatoDeMano } from "../hooks/useAparatoDeMano.js";
import { useBackGuard } from "../hooks/useBackGuard.js";
import { MIN_TOUCH_PX } from "../lib/hospitalityTheme.js";
import { SUELO_LETRA_MANO_PX } from "../lib/roomGrid.js";

export function ConfirmSheet({
  title,
  body,
  confirmLabel,
  cancelLabel,
  altLabel,
  onConfirm,
  onCancel,
  onAlt,
}: {
  title: string;
  body?: string;
  // Verbo de lo que va a pasar: "Vaciar mesa", "Cancelar la cuenta".
  confirmLabel: string;
  // Verbo de quedarse como está: "Volver", "Seguir con la cuenta".
  cancelLabel: string;
  // auditoria-sirope (#25) · LA TERCERA SALIDA, cuando la hay.
  //
  // Algunas preguntas tienen dos respuestas buenas y una neutra: «cobrar
  // la mesa con platos sin mandar» se contesta con «enviar y cobrar» o
  // con «cobrar sin enviar» —el camarero ya se lo cantó a la cocina—, y
  // volver atrás no es ninguna de las dos. Sin esta tercera, el Atrás del
  // sistema tendría que significar una de las respuestas, y un gesto de
  // salir nunca puede decidir nada.
  altLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  onAlt?: () => void;
}) {
  // El Atrás del sistema equivale a la salida neutra, nunca a la
  // acción destructiva.
  useBackGuard(onCancel);
  const deMano = useAparatoDeMano();

  if (deMano) {
    // El alto de los tres botones y el de la letra salen de las mismas
    // constantes que la sala, no de números propios de este componente:
    // es lo que impide que «la hoja de la mesa» y «la mesa» se separen.
    const boton =
      "w-full rounded-2xl font-semibold flex items-center justify-center";
    const estiloBoton = {
      height: MIN_TOUCH_PX,
      fontSize: SUELO_LETRA_MANO_PX + 2,
    };
    return (
      <div
        className="fixed inset-0 z-[70] bg-mipiace-ink/50 flex items-end font-sans"
        onClick={onCancel}
        role="presentation"
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-label={title}
          data-testid="confirm-sheet"
          data-de-mano="true"
          onClick={(e) => e.stopPropagation()}
          className="w-full bg-white rounded-t-3xl border-t border-slate-200 px-4 pt-5 pb-4"
        >
          <h2
            className="font-semibold text-mipiace-ink tracking-tight mb-2"
            style={{ fontSize: SUELO_LETRA_MANO_PX + 4 }}
          >
            {title}
          </h2>
          {body && (
            <p
              className="text-slate-500 leading-relaxed mb-5"
              style={{ fontSize: SUELO_LETRA_MANO_PX }}
            >
              {body}
            </p>
          )}
          {/* Acción · acción · salida. Las dos acciones llevan relleno
              propio: la tercera salida dejó de ser texto gris, porque en
              la mesa por recoger es la que más se toca. */}
          <div className="flex flex-col gap-2.5">
            <button
              type="button"
              onClick={onConfirm}
              className={`${boton} bg-mipiace-coral hover:bg-mipiace-coral-dark text-white`}
              style={estiloBoton}
            >
              {confirmLabel}
            </button>
            {altLabel && onAlt && (
              <button
                type="button"
                onClick={onAlt}
                className={`${boton} border border-slate-300 hover:bg-slate-50 text-mipiace-ink`}
                style={estiloBoton}
              >
                {altLabel}
              </button>
            )}
            <button
              type="button"
              onClick={onCancel}
              className={`${boton} text-mipiace-ink-soft hover:bg-slate-50`}
              style={estiloBoton}
            >
              {cancelLabel}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-[70] bg-mipiace-ink/50 flex items-end sm:items-center justify-center p-3 sm:p-4 font-sans"
      onClick={onCancel}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        data-testid="confirm-sheet"
        data-de-mano="false"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md bg-white rounded-3xl border border-slate-200 p-5 sm:p-6"
      >
        <h2 className="text-[18px] font-semibold text-mipiace-ink tracking-tight mb-1.5">
          {title}
        </h2>
        {body && (
          <p className="text-[14px] text-slate-500 leading-relaxed mb-5">
            {body}
          </p>
        )}
        <div className="flex flex-col-reverse sm:flex-row gap-2.5">
          {/* La salida va primero en el DOM y a la izquierda en fila:
              en móvil queda ABAJO, que es donde cae el pulgar por
              defecto. Salir de una acción destructiva tiene que ser lo
              barato. */}
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 h-touch rounded-2xl border border-slate-200 hover:bg-slate-50 text-[14px] font-medium text-mipiace-ink-soft"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="flex-1 h-touch rounded-2xl bg-mipiace-coral hover:bg-mipiace-coral-dark text-white text-[14px] font-medium"
          >
            {confirmLabel}
          </button>
        </div>
        <div className={altLabel ? "mt-2.5" : "hidden"}>
          {altLabel && onAlt && (
            <button
              type="button"
              onClick={onAlt}
              className="w-full h-touch rounded-2xl text-[14px] font-medium text-slate-500 hover:bg-slate-50"
            >
              {altLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
