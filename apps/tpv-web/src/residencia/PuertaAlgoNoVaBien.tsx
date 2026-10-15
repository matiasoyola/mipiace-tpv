// residencia-3 (D-64) · **PANTALLA 5: ALGO NO VA BIEN.**
//
// «No hace falta saber qué es. Con decirlo basta: queda apuntado y lo verá
// el turno siguiente.» A la izquierda un botón oscuro grande «Mantén
// pulsado y cuéntalo» (nota de voz, opcional); a la derecha, «O escríbelo
// en dos palabras». Abajo «Apuntarlo para el relevo».
//
// ── LA FRASE DE ARRIBA ES LA REGLA 1 DE LA CAPA ─────────────────────
//
// «El registro no exige diagnosticar» (rama de controles §4, D-13). Si la
// pantalla obligara a categorizar —elige dimensión, elige gravedad— la
// auxiliar no registraría, y lo que se pierde no es un campo: es el aviso.
// Por eso los dos campos son opcionales y **«algo no va bien» a secas es
// un registro completo**.
//
// ── Y EL BOTÓN DE AVISAR A LA ENFERMERA NO SE PINTA (decisión 9) ─────
//
// El mockup lo tiene; este bloque no lo enciende. El aviso inmediato real
// (D-19) llega con la gravedad y las incidencias en residencia-4, y un
// botón que parece avisar y no avisa es peor que no tenerlo: se pulsa, se
// deja de buscar a la enfermera y nadie va. En su sitio, la frase que de
// verdad funciona hoy.
//
// El hueco queda preparado: `onAvisarEnfermera` existe en las props y está
// sin cablear, así que encenderlo en residencia-4 es pasar una función.
//
// ── La nota de voz ──────────────────────────────────────────────────
//
// `MediaRecorder` del WebView, WebM/Opus, **mantener pulsado** y no
// «grabar / parar»: con dos toques el riesgo es dejarse la grabación
// abierta en un bolsillo, y con uno el audio dura lo que dura el dedo.
// Tope de 60 s en la pantalla y de 2 MB en el servidor.
//
// Si el navegador no da micrófono —permiso denegado, WebView sin
// `MediaRecorder`— el botón **se dice que no está disponible** en vez de
// desaparecer: una auxiliar que lo usó ayer y hoy no lo ve creería que la
// aplicación está rota, y lo que tiene que saber es que puede escribirlo.

import { useEffect, useRef, useState } from "react";

export interface PuertaAlgoNoVaBienProps {
  nombreDelResidente: string;
  onApuntar: (input: { texto: string | null; vozBase64: string | null }) => void;
  onVolver: () => void;
  /** residencia-4 · el hueco del aviso inmediato. Mientras sea `undefined`
   *  el botón NO SE PINTA (decisión 9) y en su sitio va la frase. */
  onAvisarEnfermera?: () => void;
}

/** Tope de la grabación. Un minuto es largo para «cuéntalo» y corto para
 *  un bolsillo. */
const MAX_SEGUNDOS = 60;

export function PuertaAlgoNoVaBien({
  nombreDelResidente,
  onApuntar,
  onVolver,
  onAvisarEnfermera,
}: PuertaAlgoNoVaBienProps) {
  const [texto, setTexto] = useState("");
  const [grabando, setGrabando] = useState(false);
  const [segundos, setSegundos] = useState(0);
  const [vozBase64, setVozBase64] = useState<string | null>(null);
  const [sinMicro, setSinMicro] = useState(false);
  const rec = useRef<MediaRecorder | null>(null);
  const trozos = useRef<Blob[]>([]);

  useEffect(() => {
    if (!grabando) return;
    const id = setInterval(() => setSegundos((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [grabando]);

  useEffect(() => {
    if (grabando && segundos >= MAX_SEGUNDOS) void parar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segundos, grabando]);

  async function empezar() {
    if (grabando) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream, { mimeType: "audio/webm" });
      trozos.current = [];
      mr.ondataavailable = (e) => {
        if (e.data.size > 0) trozos.current.push(e.data);
      };
      mr.onstop = () => {
        // Se para el stream a mano: un `MediaRecorder` parado deja el
        // micrófono abierto, y una tablet de pasillo con el punto rojo del
        // micro encendido es exactamente lo que no puede pasar.
        for (const t of stream.getTracks()) t.stop();
        void (async () => {
          const blob = new Blob(trozos.current, { type: "audio/webm" });
          setVozBase64(await aBase64(blob));
        })();
      };
      rec.current = mr;
      mr.start();
      setSegundos(0);
      setGrabando(true);
    } catch {
      setSinMicro(true);
    }
  }

  async function parar() {
    if (!grabando) return;
    setGrabando(false);
    try {
      rec.current?.stop();
    } catch {
      /* ya estaba parado */
    }
  }

  return (
    <div className="min-h-screen bg-mipiace-stone text-mipiace-ink flex flex-col">
      <header className="px-8 pt-7">
        <h1 className="text-[40px] font-semibold leading-tight">
          {nombreDelResidente}
        </h1>
        <p className="mt-2 text-[24px] text-slate-600 max-w-[900px]">
          No hace falta saber qué es. Con decirlo basta: queda apuntado y lo
          verá el turno siguiente.
        </p>
      </header>

      <main className="flex-1 px-8 py-6 grid gap-8 lg:grid-cols-2 content-start">
        <div>
          <button
            type="button"
            // Mantener pulsado: ratón, dedo y «se va el dedo fuera del
            // botón» (`onPointerLeave`), que en una tablet de pared pasa.
            onPointerDown={() => void empezar()}
            onPointerUp={() => void parar()}
            onPointerLeave={() => void parar()}
            disabled={sinMicro}
            className={`w-full min-h-[200px] rounded-2xl text-white text-[32px] font-semibold ${
              grabando ? "bg-red-600" : "bg-mipiace-ink"
            } disabled:bg-slate-300 disabled:text-slate-500`}
          >
            {grabando
              ? `Grabando… ${segundos}s — suelta para parar`
              : "Mantén pulsado y cuéntalo"}
          </button>
          {sinMicro && (
            <p className="mt-3 text-[20px] text-slate-600">
              Esta tablet no deja grabar audio. Escríbelo aquí al lado: se
              apunta igual.
            </p>
          )}
          {vozBase64 && !grabando && (
            <p className="mt-3 flex items-center gap-4 text-[20px] text-emerald-800">
              Nota de voz lista.
              <button
                type="button"
                onClick={() => setVozBase64(null)}
                className="min-h-touch-pad underline text-slate-500"
              >
                Quitarla
              </button>
            </p>
          )}
        </div>

        <div>
          <label
            htmlFor="algo-texto"
            className="block text-[24px] font-medium text-slate-700"
          >
            O escríbelo en dos palabras
          </label>
          <textarea
            id="algo-texto"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            rows={4}
            maxLength={500}
            placeholder="le huele raro el pie"
            className="mt-3 w-full rounded-2xl border-2 border-slate-300 p-5 text-[24px]"
          />
        </div>
      </main>

      <footer className="px-8 pb-7 flex flex-wrap items-center gap-4">
        <button
          type="button"
          onClick={onVolver}
          className="min-h-tap-puerta rounded-xl border-2 border-slate-300 px-7 text-[22px]"
        >
          Volver
        </button>
        <button
          type="button"
          onClick={() =>
            onApuntar({
              texto: texto.trim().length > 0 ? texto.trim() : null,
              vozBase64,
            })
          }
          className="flex-1 min-h-tap-puerta rounded-2xl bg-mipiace-coral text-white text-[28px] font-semibold active:bg-mipiace-coral-dark"
        >
          Apuntarlo para el relevo
        </button>
        {onAvisarEnfermera ? (
          // residencia-4. Hoy no llega aquí nadie.
          <button
            type="button"
            onClick={onAvisarEnfermera}
            className="min-h-tap-puerta rounded-xl bg-red-600 text-white px-7 text-[22px] font-semibold"
          >
            No puede esperar: avisar a la enfermera
          </button>
        ) : (
          <p className="w-full text-[20px] text-slate-500">
            Si no puede esperar, avisa a la enfermera en persona.
          </p>
        )}
      </footer>
    </div>
  );
}

/** El blob a base64, sin la cabecera `data:`. `FileReader` y no
 *  `arrayBuffer` + `btoa` porque un audio de un minuto en un bucle de
 *  `String.fromCharCode` desborda la pila en una tablet vieja. */
function aBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => {
      const s = String(fr.result);
      resolve(s.slice(s.indexOf(",") + 1));
    };
    fr.onerror = () => reject(fr.error ?? new Error("no se pudo leer el audio"));
    fr.readAsDataURL(blob);
  });
}
