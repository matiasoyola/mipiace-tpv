// kds-1-cocina · «Bravas −1 · Deshacer», decisión 6.
//
// ── POR QUÉ DESHACER Y NO CONFIRMAR ───────────────────────────────────
//
// Decisión de diseño de Claude, validada en la decisión 6: **un «¿Seguro?»
// cuesta un toque SIEMPRE; el deshacer sólo cuesta cuando hay error**. En
// una barra en hora punta, el camarero anula una unidad diez veces al día y
// se equivoca una vez al mes: pedirle confirmación es cobrarle 300 toques
// al mes para ahorrarle uno.
//
// ── LOS 5 SEGUNDOS, Y DÓNDE VIVEN ─────────────────────────────────────
//
// El temporizador vive AQUÍ, en el TPV, y no en el servidor. Un «deshacer»
// que necesite red no es un deshacer: con el 4G del bar a medio gas, el
// camarero tocaría «Deshacer», no pasaría nada visible, y la anulación
// saldría igual.
//
// Así que la secuencia es: el `−` baja la unidad **en la pantalla** y
// arranca la cuenta; si se deshace a tiempo, la pantalla vuelve y **no se
// llama a ninguna ruta** — la cocina no ve ni un parpadeo. Si pasan los 5 s,
// se llama a `POST /tickets/:id/kitchen/void-units` y la anulación sale a
// cocina sola, sin esperar al siguiente «Enviar»: el cocinero tiene que
// saberlo YA.
//
// Y si el camarero cobra o cierra la mesa dentro de esos 5 s, la anulación
// se manda **antes** de salir (`vaciar()`): lo que no puede pasar es que un
// plato desaparezca de la cuenta y se quede en la plancha.

import { useEffect, useRef, useState } from "react";

import {
  DARK_SURFACE_RAISED,
  DARK_TEXT,
  MIN_TOUCH_PX,
  PRESS_FEEDBACK_CLASS,
} from "../../lib/hospitalityTheme.js";
import { ROJO_ANULADO } from "../../lib/kitchenTheme.js";

/** Los 5 segundos de la decisión 6. */
export const DESHACER_MS = 5_000;

export interface AnulacionPendiente {
  /** Clave de esta anulación. Dos `−` seguidos son dos pendientes. */
  key: string;
  lineId: string;
  nombre: string;
  units: number;
  /**
   * kds-2-wifi · el id de LA OPERACIÓN, un UUID generado al encolar.
   *
   * Es por lo que la tablet descarta el duplicado si la anulación le llega
   * por la nube y por la wifi. Va aquí y no se genera al mandar porque
   * tiene que ser EL MISMO en los dos caminos, y los dos salen del mismo
   * sitio: el temporizador de 5 s.
   *
   * Opcional para tolerar una cola ya en memoria de antes del bloque.
   */
  opId?: string;
}

export interface DeshacerToastProps {
  pendientes: AnulacionPendiente[];
  onDeshacer: (key: string) => void;
}

export function DeshacerToast(props: DeshacerToastProps) {
  if (props.pendientes.length === 0) return null;
  return (
    <div
      data-testid="deshacer-toast"
      className="shrink-0 flex flex-col gap-1 px-3 pt-2"
    >
      {props.pendientes.map((p) => (
        <div
          key={p.key}
          data-testid="deshacer-aviso"
          data-line-id={p.lineId}
          className="w-full rounded-[12px] px-4 flex items-center gap-3"
          style={{
            minHeight: MIN_TOUCH_PX,
            background: DARK_SURFACE_RAISED,
            color: DARK_TEXT,
            // Sólo el CONTORNO rojo (decisión 6): el `−` de lo enviado se
            // pinta distinto del `−` normal, pero la regla del rojo dice
            // que el relleno rojo se reserva para lo que no puede esperar.
            border: `2px solid ${ROJO_ANULADO}`,
          }}
        >
          <span className="font-semibold" style={{ fontSize: 19 }}>
            {p.nombre} −{p.units}
          </span>
          <button
            type="button"
            data-testid="deshacer-boton"
            onClick={() => props.onDeshacer(p.key)}
            className={`ml-auto rounded-[10px] px-5 font-bold ${PRESS_FEEDBACK_CLASS}`}
            style={{
              minHeight: MIN_TOUCH_PX - 8,
              background: ROJO_ANULADO,
              color: "#FFFFFF",
              fontSize: 18,
            }}
          >
            Deshacer
          </button>
        </div>
      ))}
    </div>
  );
}

/**
 * La cola de anulaciones con su cuenta de 5 s.
 *
 * `enviar` se llama cuando una anulación cumple sus 5 s sin deshacerse, y
 * `vaciar` las manda todas ya — es lo que hay que llamar antes de cobrar o
 * de salir de la mesa.
 */
export function useAnulacionesPendientes(enviar: (a: AnulacionPendiente) => void) {
  const [pendientes, setPendientes] = useState<AnulacionPendiente[]>([]);
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  // `enviar` se guarda en un ref: si entrara en las dependencias del
  // temporizador, cada repintado de la comanda reiniciaría la cuenta de
  // 5 s y la anulación no saldría nunca.
  const enviarRef = useRef(enviar);
  enviarRef.current = enviar;

  const encolar = (a: AnulacionPendiente) => {
    setPendientes((prev) => [...prev, a]);
    const t = setTimeout(() => {
      timers.current.delete(a.key);
      setPendientes((prev) => prev.filter((p) => p.key !== a.key));
      enviarRef.current(a);
    }, DESHACER_MS);
    timers.current.set(a.key, t);
  };

  const deshacer = (key: string) => {
    const t = timers.current.get(key);
    if (t) clearTimeout(t);
    timers.current.delete(key);
    setPendientes((prev) => prev.filter((p) => p.key !== key));
  };

  /** Manda YA todo lo pendiente. Antes de cobrar o de salir de la mesa. */
  const vaciar = () => {
    const ahora = pendientes;
    for (const [, t] of timers.current) clearTimeout(t);
    timers.current.clear();
    setPendientes([]);
    for (const a of ahora) enviarRef.current(a);
  };

  useEffect(
    () => () => {
      for (const [, t] of timers.current) clearTimeout(t);
      timers.current.clear();
    },
    [],
  );

  return { pendientes, encolar, deshacer, vaciar };
}
