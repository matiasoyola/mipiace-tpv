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
// ── residencia-4 · LOS TIPOS, ENCIMA DE LA NOTA (alcance 6) ─────────
//
// Una fila de botones grandes con lo que la plantilla del §3 gradúa:
// Caída · Vómito · No lo encontramos · No respira bien · Algo roto. Dos
// de ellos abren **una pregunta única** de dos botones («¿se ha dado en
// la cabeza o hay herida?», «¿es peligroso?»), que es lo que separa un
// N1 de un N3 y una avería de una urgencia.
//
// Y **sin elegir nada sigue siendo un registro completo y vale N1**
// (D-13). Eso no es una concesión: es lo que hace que el botón se use el
// día que la auxiliar no sabe qué es lo que está viendo, que es el día
// que más importa. El coste sigue siendo proporcional a la anomalía
// (D-16): el caso normal —la nota a secas— no gana ni un toque.
//
// ── Y EL BOTÓN DE LA ENFERMERA, ENCENDIDO (alcance 7) ───────────────
//
// residencia-3 dejó el hueco preparado y la frase «si no puede esperar,
// avisa a la enfermera en persona» en su sitio, porque «un botón que
// parece avisar y no avisa es peor que no tenerlo». Ya avisa: fuerza
// **como mínimo N2** sobre lo que se esté apuntando y hace sonar el móvil
// de guardia.
//
// Es un INTERRUPTOR y no una acción, y eso importa: lo que sale no es un
// aviso suelto, es el registro que se está escribiendo con su nivel
// subido. Un aviso sin registro detrás sería una llamada sin nada que
// mirar cuando la enfermera llegue.
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

import { TIPOS_DE_ALGO_NO_VA_BIEN } from "./puerta-gestos.js";

export interface PuertaAlgoNoVaBienProps {
  nombreDelResidente: string;
  onApuntar: (input: {
    texto: string | null;
    vozBase64: string | null;
    /** residencia-4 · el tipo elegido y la respuesta a su pregunta. Los
     *  dos `null` si no se tocó ningún botón. */
    evento: string | null;
    matiz: string | null;
    /** Y si se pulsó «no puede esperar». */
    avisarEnfermera: boolean;
  }) => void;
  onVolver: () => void;
}

/** Tope de la grabación. Un minuto es largo para «cuéntalo» y corto para
 *  un bolsillo. */
const MAX_SEGUNDOS = 60;

export function PuertaAlgoNoVaBien({
  nombreDelResidente,
  onApuntar,
  onVolver,
}: PuertaAlgoNoVaBienProps) {
  const [texto, setTexto] = useState("");
  const [evento, setEvento] = useState<string | null>(null);
  const [matiz, setMatiz] = useState<string | null>(null);
  const [avisar, setAvisar] = useState(false);
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

      {/* ── residencia-4 · LOS TIPOS, ENCIMA DE LA NOTA ───────────── */}
      <section className="px-8 pt-5">
        <h2 className="text-[22px] font-semibold text-slate-700">
          ¿Sabes qué ha pasado? <span className="font-normal text-slate-500">(si no, no toques nada)</span>
        </h2>
        <div className="mt-3 flex flex-wrap gap-3">
          {TIPOS_DE_ALGO_NO_VA_BIEN.map((t) => {
            const elegido = evento === t.evento;
            return (
              <button
                key={t.evento}
                type="button"
                aria-pressed={elegido}
                onClick={() => {
                  // Volver a pulsarlo lo quita. Es un error de dedo
                  // frecuente y no hay otra forma de deshacerlo sin
                  // salirse de la pantalla y perder la nota.
                  setEvento(elegido ? null : t.evento);
                  setMatiz(null);
                }}
                className={`min-h-tap-puerta rounded-2xl px-6 text-[22px] font-semibold border-2 ${
                  elegido
                    ? "bg-mipiace-ink text-white border-mipiace-ink"
                    : "bg-white border-slate-300"
                }`}
              >
                {t.etiqueta}
              </button>
            );
          })}
        </div>

        {/* LA PREGUNTA ÚNICA. Dos botones, y nada más. */}
        {(() => {
          const elegido = TIPOS_DE_ALGO_NO_VA_BIEN.find((t) => t.evento === evento);
          if (!elegido?.pregunta) return null;
          return (
            <div className="mt-4 rounded-2xl bg-white border-2 border-slate-300 px-6 py-5">
              <p className="text-[24px] font-medium">{elegido.pregunta.texto}</p>
              <div className="mt-3 flex gap-3">
                {elegido.pregunta.opciones.map((o) => (
                  <button
                    key={o.matiz}
                    type="button"
                    aria-pressed={matiz === o.matiz}
                    onClick={() => setMatiz(o.matiz)}
                    className={`min-h-tap-puerta rounded-xl px-10 text-[24px] font-semibold border-2 ${
                      matiz === o.matiz
                        ? "bg-mipiace-coral text-white border-mipiace-coral"
                        : "bg-white border-slate-300"
                    }`}
                  >
                    {o.etiqueta}
                  </button>
                ))}
              </div>
            </div>
          );
        })()}
      </section>

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
        {/* residencia-4 · el botón de la enfermera, ENCENDIDO. Es un
            interruptor: lo que hace es que lo que se apunte salga con al
            menos N2 y suene el móvil de guardia. */}
        <button
          type="button"
          aria-pressed={avisar}
          onClick={() => setAvisar((v) => !v)}
          className={`min-h-tap-puerta rounded-xl px-7 text-[22px] font-semibold border-2 ${
            avisar
              ? "bg-red-600 text-white border-red-600"
              : "border-red-500 text-red-700"
          }`}
        >
          {avisar
            ? "✓ Se avisará a la enfermera"
            : "No puede esperar: avisar a la enfermera"}
        </button>
        <button
          type="button"
          onClick={() =>
            onApuntar({
              texto: texto.trim().length > 0 ? texto.trim() : null,
              vozBase64,
              evento,
              matiz,
              avisarEnfermera: avisar,
            })
          }
          className="flex-1 min-h-tap-puerta rounded-2xl bg-mipiace-coral text-white text-[28px] font-semibold active:bg-mipiace-coral-dark"
        >
          {avisar ? "Apuntar y avisar" : "Apuntarlo para el relevo"}
        </button>
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
