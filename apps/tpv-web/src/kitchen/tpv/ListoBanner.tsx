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

import { useEffect, useRef, useState } from "react";

import {
  DARK_ON_CORAL,
  MIN_TOUCH_PX,
  PRESS_FEEDBACK_CLASS,
} from "../../lib/hospitalityTheme.js";
import { VERDE_LISTA } from "../../lib/kitchenTheme.js";

/**
 * hierro-sirope (D) · lo que pinta una banda es un GRUPO: una mesa con
 * todo lo que tiene listo. Lo arma `agruparAvisos`.
 */
export interface AvisoListo {
  /** Llave estable del grupo (mesa o mostrador). */
  clave: string;
  /** La línea entera: «M3 · barra lista (cocina en marcha)». */
  texto: string;
  /** Todo lo listo de esa mesa: un toque lo sirve entero. */
  orderIds: string[];
  /** ISO del más antiguo del grupo. Ordena la pila. */
  readyAt: string;
}

export interface ListoBannerProps {
  avisos: AvisoListo[];
  /** `Store.kitchenReadyBeep`. Apagado de serie. */
  beep: boolean;
  onServido: (orderIds: string[]) => void;
}

/** 24 px: una banda y no una barra. Dos caben sin tapar la comanda. */
const BANDA_PX = 52;

/**
 * hierro-sirope (D) · CUÁNTAS BANDAS PUEDEN EMPUJAR EL TICKET.
 *
 * Dos. A 1442 × 811 (el D8) dos bandas de 52 px más la franja «Urgente»
 * todavía dejan el ticket y sus botones dentro de la pantalla; tres no
 * (captura 25: la segunda línea del ticket quedaba bajo «Urgente»).
 *
 * A partir de la tercera se pinta la más antigua —la que lleva más tiempo
 * en el pase, que es la que hay que atender— y una fila compacta «N
 * listas más · ver» que despliega el resto en su PROPIO scroll. El ticket
 * no se mueve: la pila nunca pasa de dos filas plegada.
 */
export const MAX_BANDAS = 2;

/** Alto máximo del desplegable: tres bandas y pico, y scrollea. */
const DESPLEGADO_MAX_PX = BANDA_PX * 3 + 24;

export function ListoBanner(props: ListoBannerProps) {
  // Un pitido por comanda y SÓLO al aparecer: sin esto, cada repintado de
  // la pantalla (que en venta son muchos) volvería a pitar.
  const pitadosRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!props.beep) return;
    for (const a of props.avisos) {
      // La llave del pitido es el GRUPO + lo que tiene listo: si a M3 le
      // queda lista la cocina después de la barra, eso es una comanda
      // nueva y vuelve a pitar. Lo que no pita es el mismo grupo en cada
      // repintado.
      const llave = `${a.clave}|${[...a.orderIds].sort().join(",")}`;
      if (pitadosRef.current.has(llave)) continue;
      pitadosRef.current.add(llave);
      pitarCorto();
    }
  }, [props.avisos, props.beep]);

  const [desplegado, setDesplegado] = useState(false);
  // Al bajar de tres grupos no queda nada que desplegar: el estado se
  // reinicia para que la próxima avalancha vuelva a entrar plegada.
  const sobran = props.avisos.length > MAX_BANDAS;
  useEffect(() => {
    if (!sobran) setDesplegado(false);
  }, [sobran]);

  if (props.avisos.length === 0) return null;

  // De más ANTIGUA a más nueva (decisión 5): el camarero coge lo que lleva
  // más tiempo en el pase, así que lo primero que lee tiene que ser eso.
  const ordenadas = [...props.avisos].sort((a, b) =>
    a.readyAt.localeCompare(b.readyAt),
  );

  const plegado = !desplegado && ordenadas.length > MAX_BANDAS;
  const visibles = plegado ? ordenadas.slice(0, 1) : ordenadas;
  const ocultas = ordenadas.length - visibles.length;

  const banda = (a: AvisoListo) => (
    <button
      key={a.clave}
      type="button"
      data-testid="listo-banda"
      data-clave={a.clave}
      data-order-ids={a.orderIds.join(",")}
      onClick={() => props.onServido(a.orderIds)}
      className={`w-full rounded-[12px] px-4 flex items-center gap-3 font-bold text-left ${PRESS_FEEDBACK_CLASS}`}
      style={{
        minHeight: Math.max(BANDA_PX, MIN_TOUCH_PX),
        background: VERDE_LISTA,
        color: DARK_ON_CORAL,
        fontSize: 21,
      }}
    >
      <span className="min-w-0">{a.texto}</span>
      <span className="ml-auto shrink-0 font-semibold" style={{ fontSize: 16 }}>
        Servido
      </span>
    </button>
  );

  return (
    <div
      data-testid="listo-banner"
      data-grupos={ordenadas.length}
      className="shrink-0 flex flex-col gap-1 px-3 pt-2"
    >
      {/* Desplegado, la pila tiene su PROPIO scroll: lo que no puede
          pasar es que seis mesas listas empujen el ticket fuera de la
          pantalla. Plegado no hace falta — nunca pasa de una banda más
          la fila de «ver». */}
      {desplegado && sobran ? (
        <div
          data-testid="listo-pila"
          className="flex flex-col gap-1 overflow-y-auto"
          style={{ maxHeight: DESPLEGADO_MAX_PX }}
        >
          {visibles.map(banda)}
        </div>
      ) : (
        visibles.map(banda)
      )}
      {plegado && (
        <button
          type="button"
          data-testid="listo-mas"
          onClick={() => setDesplegado(true)}
          className={`w-full rounded-[12px] px-4 flex items-center gap-3 font-bold text-left ${PRESS_FEEDBACK_CLASS}`}
          style={{
            minHeight: MIN_TOUCH_PX,
            background: VERDE_LISTA,
            color: DARK_ON_CORAL,
            fontSize: 17,
          }}
        >
          <span>
            {ocultas} {ocultas === 1 ? "mesa lista más" : "mesas listas más"}
          </span>
          <span className="ml-auto shrink-0 font-semibold" style={{ fontSize: 16 }}>
            Ver
          </span>
        </button>
      )}
      {!plegado && ordenadas.length > MAX_BANDAS && (
        <button
          type="button"
          data-testid="listo-menos"
          onClick={() => setDesplegado(false)}
          className="w-full text-center font-semibold opacity-80"
          style={{ minHeight: 32, color: VERDE_LISTA, fontSize: 14 }}
        >
          Plegar
        </button>
      )}
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
