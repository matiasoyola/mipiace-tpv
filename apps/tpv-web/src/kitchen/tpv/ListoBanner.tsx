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

import { useBackGuard } from "../../hooks/useBackGuard.js";
import {
  BANDA_AVISO_PX,
  modoDeLosAvisos,
} from "../../lib/hospitalityGrid.js";
import {
  DARK_PANEL,
  DARK_TEXT,
  MIN_TOUCH_PX,
  PRESS_FEEDBACK_CLASS,
} from "../../lib/hospitalityTheme.js";
import { VERDE_LISTA, VERDE_LISTA_TEXT } from "../../lib/kitchenTheme.js";

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
  /**
   * n1-hosteleria-2 · R2 · en la mano los avisos NO se apilan.
   *
   * El hallazgo 3 de Matías del 23-10: con «T6 listo para servir» y «M5
   * listo para servir» a la vez, las dos bandas se ponían encima de la
   * comanda y la hoja quedaba baja — las seis líneas se veían de una en
   * una. Y no es que las bandas sean grandes: es que **crecen**, así que
   * el coste no tiene techo y en pleno servicio cocina decide cuánta
   * comanda ve el camarero.
   *
   * Con `deMano`, el bloque pasa a ser un CONTADOR de alto fijo
   * (`BANDA_AVISO_PX`) y la lista entera se abre con un toque, en su
   * propia capa. Ver `altoDeLosAvisos` y `modoDeLosAvisos`.
   *
   * En el terminal se queda la pila tal cual: ahí la comanda es una
   * columna de 800 px de alto y dos bandas no le quitan ninguna línea.
   */
  deMano?: boolean;
}

/** 24 px: una banda y no una barra. Dos caben sin tapar la comanda. */
const BANDA_PX = 52;

export function ListoBanner(props: ListoBannerProps) {
  // La lista entera, cuando el contador de la mano está desplegado.
  const [desplegado, setDesplegado] = useState(false);
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

  if (modoDeLosAvisos(props.deMano === true) === "contador") {
    return (
      <ContadorDeAvisos
        avisos={ordenadas}
        desplegado={desplegado}
        onDesplegar={setDesplegado}
        onServido={props.onServido}
      />
    );
  }

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
          // n1-hosteleria-2 · R4 · `DARK_ON_CORAL` es blanco, y blanco
          // sobre `VERDE_LISTA` da **1,66:1**. Es el mismo fallo que la
          // etiqueta «LISTO» de la mesa, con la misma causa: la constante
          // correcta (`VERDE_LISTA_TEXT`) existe y estaba sin usar. Con
          // ella, 10,82:1.
          style={{
            minHeight: Math.max(BANDA_PX, MIN_TOUCH_PX),
            background: VERDE_LISTA,
            color: VERDE_LISTA_TEXT,
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
 * n1-hosteleria-2 · R1 y R2 · EL CONTADOR DE AVISOS DE LA MANO.
 *
 * Una franja de alto FIJO —`BANDA_AVISO_PX`, pase lo que pase— con el
 * número de comandas listas y el nombre de la que lleva más tiempo en el
 * pase. Un toque abre la lista entera.
 *
 * Por qué el nombre va dentro del contador y no sólo el número: la
 * decisión 5 de kds-1 dice que el camarero coge lo que lleva más tiempo
 * esperando, así que con «2 listos» a secas habría que abrir la lista
 * para saber si cae de camino. Con «T6 y 1 más», el caso normal —un solo
 * aviso— se resuelve sin abrir nada.
 *
 * Y el «Servido» NO está en el contador. Está dentro de la lista, con su
 * objetivo de 56 px por aviso. Un «Servido» en la franja, con dos
 * comandas listas, no podría decir cuál se ha servido — y un toque que
 * adivina cuál de dos platos ha salido es peor que un toque más.
 */
function ContadorDeAvisos({
  avisos,
  desplegado,
  onDesplegar,
  onServido,
}: {
  /** Ya ordenados de más antigua a más nueva. */
  avisos: AvisoListo[];
  desplegado: boolean;
  onDesplegar: (v: boolean) => void;
  onServido: (orderId: string) => void;
}) {
  // R3 · toda hoja se cierra también con el «atrás» de Android.
  useBackGuard(() => onDesplegar(false), desplegado);

  const primera = avisos[0]!;
  const resto = avisos.length - 1;
  const rotulo =
    resto > 0
      ? `${primera.tableName ?? "Comanda"} y ${resto} más`
      : `${primera.tableName ?? "Comanda"} · listo para servir`;

  return (
    <>
      <div
        data-testid="listo-banner"
        data-modo="contador"
        className="shrink-0 px-3 pt-2"
      >
        <button
          type="button"
          data-testid="listo-contador"
          data-avisos={avisos.length}
          onClick={() => onDesplegar(true)}
          aria-label={`${avisos.length} ${
            avisos.length === 1 ? "comanda lista" : "comandas listas"
          }`}
          className={`w-full rounded-[12px] px-4 flex items-center gap-3 font-bold text-left ${PRESS_FEEDBACK_CLASS}`}
          style={{
            // Fijo, no mínimo: es lo que acota el coste. Ver
            // `altoDeLosAvisos`.
            height: BANDA_AVISO_PX,
            background: VERDE_LISTA,
            color: VERDE_LISTA_TEXT,
            fontSize: 17,
          }}
        >
          {/* El número primero y en grande: es lo que se lee de lejos. */}
          <span
            className="shrink-0 tabular-nums"
            style={{ fontSize: 22, lineHeight: 1 }}
          >
            {avisos.length}
          </span>
          <span className="flex-1 min-w-0 truncate">{rotulo}</span>
          <span
            className="shrink-0 font-semibold"
            style={{ fontSize: 15, opacity: 0.75 }}
          >
            Ver
          </span>
        </button>
      </div>

      {/* La lista entera, a pantalla completa: R1 pide una sola capa, y
          una hoja a media altura sobre la comanda sería justo el apilado
          del hallazgo 4. */}
      {desplegado && (
        <div
          data-testid="listo-lista"
          className="fixed inset-0 z-[60] flex flex-col"
          style={{ background: DARK_PANEL }}
        >
          <div className="shrink-0 flex items-center gap-3 px-4 h-16 border-b" style={{ borderColor: "#23272E" }}>
            <span
              className="flex-1 min-w-0 font-semibold truncate"
              style={{ fontSize: 19, color: DARK_TEXT }}
            >
              {avisos.length} {avisos.length === 1 ? "listo" : "listos"} para
              servir
            </span>
            <button
              type="button"
              data-testid="listo-lista-cerrar"
              onClick={() => onDesplegar(false)}
              aria-label="Cerrar los avisos"
              className={`shrink-0 rounded-xl flex items-center justify-center font-semibold ${PRESS_FEEDBACK_CLASS}`}
              style={{
                // R3 · 48 px. Ver la nota del cierre de la comanda.
                width: MIN_TOUCH_PX,
                height: MIN_TOUCH_PX,
                background: "#23272E",
                color: DARK_TEXT,
                fontSize: 17,
              }}
            >
              ✕
            </button>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-3 flex flex-col gap-2">
            {avisos.map((a) => (
              <button
                key={a.orderId}
                type="button"
                data-testid="listo-banda"
                data-order-id={a.orderId}
                onClick={() => {
                  onServido(a.orderId);
                  // Servida la última, la capa se va sola: dejarla
                  // abierta y vacía obligaría a un toque para salir de
                  // una pantalla que ya no dice nada.
                  if (avisos.length <= 1) onDesplegar(false);
                }}
                className={`w-full rounded-[12px] px-4 flex items-center gap-3 font-bold text-left ${PRESS_FEEDBACK_CLASS}`}
                style={{
                  minHeight: Math.max(BANDA_PX, MIN_TOUCH_PX),
                  background: VERDE_LISTA,
                  color: VERDE_LISTA_TEXT,
                  fontSize: 19,
                }}
              >
                <span className="flex-1 min-w-0">
                  {a.tableName ?? "Comanda"} · listo para servir
                </span>
                <span
                  className="shrink-0 font-semibold"
                  style={{ fontSize: 16 }}
                >
                  Servido
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </>
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
