// kds-1-cocina · LA BANDA «M4 · LISTO PARA SERVIR», decisión 5.
//
// En TODOS los TPV del local, arriba, apiladas **de más antigua a más
// nueva**. Se entera cualquier camarero, también el de la terraza.
//
// **Un toque = «Servido»**: el aviso desaparece en todos los TPV (lo hace
// el evento `kitchen.order_served` del bus) y queda la marca de tiempo
// para el tiempo en el pase.
//
// ── EL PITIDO ─────────────────────────────────────────────────────────
//
// Es un ajuste por restaurante y está **APAGADO de serie**, por coherencia
// con la decisión 8 («sin sonidos; avisa el parpadeo»). Encendido, un
// pitido CORTO y uno solo por comanda: lo que avisa es la banda, y el
// pitido sólo hace que el camarero levante la vista.
//
// El audio se genera con `AudioContext` y no con un fichero: un `<audio>`
// con un mp3 necesita que el bundle lo cargue, y un bundle que carga un
// sonido tiene un sonido que alguien puede acabar reproduciendo en la
// pantalla de cocina — donde el bloque prohíbe el audio. Aquí no hay
// fichero que reproducir.

import { useEffect, useRef } from "react";

import {
  DARK_ON_CORAL,
  MIN_TOUCH_PX,
  PRESS_FEEDBACK_CLASS,
} from "../../lib/hospitalityTheme.js";
import { VERDE_LISTA } from "../../lib/kitchenTheme.js";

export interface AvisoListo {
  orderId: string;
  tableName: string | null;
  /** ISO de cuándo se puso «Lista». Ordena la pila. */
  readyAt: string;
}

export interface ListoBannerProps {
  avisos: AvisoListo[];
  /** `Store.kitchenReadyBeep`. Apagado de serie. */
  beep: boolean;
  onServido: (orderId: string) => void;
}

/** 24 px: una banda y no una barra. Dos caben sin tapar la comanda. */
const BANDA_PX = 52;

export function ListoBanner(props: ListoBannerProps) {
  // Un pitido por comanda y SÓLO al aparecer: sin esto, cada repintado de
  // la pantalla (que en venta son muchos) volvería a pitar.
  const pitadosRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!props.beep) return;
    for (const a of props.avisos) {
      if (pitadosRef.current.has(a.orderId)) continue;
      pitadosRef.current.add(a.orderId);
      pitarCorto();
    }
  }, [props.avisos, props.beep]);

  if (props.avisos.length === 0) return null;

  // De más ANTIGUA a más nueva (decisión 5): el camarero coge lo que lleva
  // más tiempo en el pase, así que lo primero que lee tiene que ser eso.
  const ordenadas = [...props.avisos].sort((a, b) =>
    a.readyAt.localeCompare(b.readyAt),
  );

  return (
    <div
      data-testid="listo-banner"
      className="shrink-0 flex flex-col gap-1 px-3 pt-2"
    >
      {ordenadas.map((a) => (
        <button
          key={a.orderId}
          type="button"
          data-testid="listo-banda"
          data-order-id={a.orderId}
          onClick={() => props.onServido(a.orderId)}
          className={`w-full rounded-[12px] px-4 flex items-center gap-3 font-bold text-left ${PRESS_FEEDBACK_CLASS}`}
          style={{
            minHeight: Math.max(BANDA_PX, MIN_TOUCH_PX),
            background: VERDE_LISTA,
            color: DARK_ON_CORAL,
            fontSize: 21,
          }}
        >
          <span>{a.tableName ?? "Comanda"} · listo para servir</span>
          <span className="ml-auto font-semibold" style={{ fontSize: 16 }}>
            Servido
          </span>
        </button>
      ))}
    </div>
  );
}

/**
 * Un pitido corto, generado.
 *
 * 880 Hz durante 120 ms con una rampa de salida: un bip limpio que se oye
 * sobre una cafetera y no se confunde con el aviso de una cocina. Falla en
 * silencio si el navegador no permite audio sin gesto del usuario — lo que
 * avisa es la banda, el pitido es el extra.
 */
function pitarCorto(): void {
  try {
    const Ctx =
      (window as unknown as { AudioContext?: typeof AudioContext }).AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 880;
    osc.type = "sine";
    gain.gain.setValueAtTime(0.12, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.12);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.13);
    osc.onended = () => void ctx.close();
  } catch {
    /* sin audio: la banda y la etiqueta verde avisan igual */
  }
}
