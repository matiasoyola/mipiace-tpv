// clinica-4 · LAS FOTOS: la cámara, la rejilla y el comparador.
//
// Es el mockup validado el 08-10, pestaña «Fotos»: la zona se elige ANTES
// de disparar, el disparador no se puede pulsar sin zona, y abajo el
// comparador antes/última y todas las fotos por zona y fecha.
//
// ── La cámara es la de la app, nunca la del sistema ──────────────────
//
// Decisión 9: `getUserMedia` dentro de la app, **nunca un
// `<input type=file>`**. La diferencia no es de estilo: un `input file`
// abre la app de cámara del sistema, y lo que la app de cámara hace es
// guardar la foto en la galería del aparato antes de dársela a nadie.
// Entonces la foto de la uña de una paciente está en la galería de la
// tablet, que es exactamente lo que este bloque viene a arreglar.
//
// El permiso se pide por la capa de plataforma (`ensureCameraPermission`),
// igual que el escáner de códigos de v1.3: **ninguna pantalla toca
// Capacitor.** Y el permiso `CAMERA` ya está en el manifiesto de la APK
// desde A2 (el escáner lo usa), así que **esto no obliga a una APK nueva**.
//
// ── El stream se para SIEMPRE al cerrar ──────────────────────────────
//
// La lección de `SalePage.cameraScan.tsx`: si no se paran las tracks a
// mano, el LED de la cámara se queda encendido en Safari aunque el modal
// se desmonte. En una consulta, una cámara que sigue encendida después de
// hacer la foto es otra cosa además de un fallo técnico.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  Ban,
  Camera,
  EyeOff,
  Flashlight,
  FlashlightOff,
  Loader2,
  SwitchCamera,
  X,
} from "lucide-react";

import {
  NOMBRE_CORTO_DEL_PIE,
  nombreDeZona,
  type MapaDelPie as MapaVersionado,
} from "@mipiacetpv/clinica-sesion";

import { ApiError, apiBlobWithCashier, apiWithCashier } from "../api.js";
import { getPlatform } from "../platform/index.js";
import { ensureCameraPermission } from "../platform/camera/CameraPermission.js";
import { Mal, diaCorto } from "./piezas.js";

export interface FotoDeLaHistoria {
  id: string;
  zona: string;
  zonaNombre: string;
  mapaVersion: number;
  hecha: string;
  autor: string;
  retirada: boolean;
  retiradaEn: string | null;
  retiradaMotivo: string | null;
  retiradaPor: string | null;
}

export interface ComparadorDeZona {
  zona: string;
  antes: FotoDeLaHistoria | null;
  ultima: FotoDeLaHistoria | null;
  cuantas: number;
}

interface VistaDeFotos {
  fotos: FotoDeLaHistoria[];
  comparador: ComparadorDeZona[];
  consentimiento: { puede: boolean; plantillaId: string; mensaje: string };
  mapaVersion: number;
}

/** Mensaje de permiso denegado, por plataforma. El de `cameraScan`. */
function mensajeDePermiso(): string {
  if (getPlatform() === "android") {
    return "Permiso de cámara denegado. Actívalo en Ajustes de Android > Aplicaciones > mipiacetpv > Permisos > Cámara.";
  }
  return "Permiso de cámara denegado. Habilítalo en los ajustes del navegador (Cámara) y vuelve a intentarlo.";
}

/**
 * LA IMAGEN de una foto, pedida con sesión.
 *
 * Una foto clínica no tiene URL pública: sale de la API por `conHistoria`
 * y cada apertura deja su línea en el registro de accesos. Así que el
 * `<img>` no puede llevar un `src` con la ruta — hay que pedir el binario
 * con el token y darle un `blob:`.
 *
 * El `objectURL` se revoca al desmontar: una tablet que acumula veinte
 * fotos de pies en memoria durante toda la jornada es una tablet con
 * veinte datos de salud dentro que nadie sabe que están.
 */
function ImagenDeFoto(props: {
  clientId: string;
  foto: FotoDeLaHistoria;
  className?: string;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [fallo, setFallo] = useState(false);

  useEffect(() => {
    let vivo = true;
    let actual: string | null = null;
    (async () => {
      try {
        const { blob } = await apiBlobWithCashier(
          `/clinica/clients/${props.clientId}/fotos/${props.foto.id}/imagen`,
        );
        if (!vivo) return;
        actual = URL.createObjectURL(blob);
        setUrl(actual);
      } catch {
        if (vivo) setFallo(true);
      }
    })();
    return () => {
      vivo = false;
      if (actual) URL.revokeObjectURL(actual);
    };
  }, [props.clientId, props.foto.id]);

  if (fallo) {
    return (
      <div
        className={`bg-slate-100 flex items-center justify-center text-[12.5px] text-slate-500 ${props.className ?? ""}`}
      >
        No se pudo abrir
      </div>
    );
  }
  if (!url) {
    return (
      <div
        className={`bg-slate-100 flex items-center justify-center ${props.className ?? ""}`}
      >
        <Loader2 className="w-4 h-4 animate-spin motion-reduce:animate-none text-slate-400" />
      </div>
    );
  }
  return (
    <img
      src={url}
      alt={`${props.foto.zonaNombre} · ${diaCorto(props.foto.hecha)}`}
      className={`object-cover ${props.className ?? ""}`}
    />
  );
}

// ── La cámara ────────────────────────────────────────────────────────

/**
 * clinica-8 (fase B, 10) · ¿esta pista de vídeo tiene flash?
 *
 * `MediaStreamTrack.getCapabilities()` es lo único que lo sabe, y no
 * existe en todas partes (ni en jsdom). Todo entre `try`: una cámara que
 * no sabe decir si tiene flash es una cámara sin flash, no una excepción
 * que tumbe la pantalla con el pie delante.
 */
export function pistaConLinterna(stream: MediaStream): boolean {
  try {
    const pista = stream.getVideoTracks()[0];
    if (!pista || typeof pista.getCapabilities !== "function") return false;
    return (pista.getCapabilities() as { torch?: boolean }).torch === true;
  } catch {
    return false;
  }
}

/**
 * Enciende o apaga el flash de la pista. Devuelve si se pudo.
 *
 * `torch` va en `advanced`: es una constraint no estándar y en `basic`
 * un navegador que no la conozca rechazaría TODA la llamada, apagando de
 * paso la resolución que sí habíamos pedido.
 */
async function ponerLinterna(
  stream: MediaStream | null,
  encendida: boolean,
): Promise<boolean> {
  try {
    const pista = stream?.getVideoTracks()[0];
    if (!pista) return false;
    await pista.applyConstraints({
      advanced: [{ torch: encendida } as MediaTrackConstraintSet],
    });
    return true;
  } catch {
    return false;
  }
}

function Camara(props: {
  mapa: MapaVersionado;
  /** Las zonas que se ofrecen primero: las marcadas hoy en el mapa. */
  zonasDeHoy: readonly string[];
  onCerrar: () => void;
  onDisparo: (zona: string, jpegBase64: string) => Promise<void>;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  // clinica-8 (fase B, 10) · LA ZONA VIENE PUESTA. «Se apunta y se
  // dispara»: Matías, 18-10, sobre la cámara de clinica-4 —«elegir la
  // zona antes de disparar no es intuitivo».
  //
  // Lo que cambia NO es que la foto deje de tener zona (una foto clínica
  // sin zona no sirve: el comparador antes/después es por zona). Es
  // QUIÉN la pone por defecto. Si la sesión de hoy ha marcado una zona,
  // ésa es la zona de la foto — es lo que la podóloga acaba de tocar en
  // el mapa del pie, con el pie delante. Con varias marcadas se coge la
  // PRIMERA de las de hoy y se cambia de un toque, antes o después de
  // disparar.
  //
  // Sin nada marcado (la primera visita, antes de tocar el mapa) sigue
  // en `null` y hay que elegir: inventar una zona sería escribir en la
  // historia una zona que nadie dijo.
  const [zona, setZona] = useState<string | null>(props.zonasDeHoy[0] ?? null);
  const [error, setError] = useState<string | null>(null);
  const [estado, setEstado] = useState("Iniciando cámara…");
  const [camaras, setCamaras] = useState<MediaDeviceInfo[]>([]);
  const [cual, setCual] = useState(0);
  const [disparando, setDisparando] = useState(false);
  const [todasLasZonas, setTodasLasZonas] = useState(false);
  // clinica-8 (fase B, 10) · ¿está el vídeo pintando ya?
  //
  // Mientras no lo está, Android pinta ENCIMA del `<video>` su póster de
  // «play» —un triángulo gigante centrado— porque un `<video>` sin
  // `poster` y sin frames es, para el WebView, un vídeo parado. En la
  // tablet del 18-10 eso es lo que se veía durante el segundo que tarda
  // `getUserMedia` (punto 10 de la auditoría), y un triángulo de «play»
  // en medio de la pantalla se toca.
  //
  // Se tapa con una capa propia: negro, el texto de estado dentro y nada
  // tocable. En cuanto llega el primer frame se quita.
  //
  // Y ESTO NO PUEDE SER UNA PUERTA SIN SALIDA. `pintando` bloquea además
  // el disparador, así que un aparato donde el evento del primer frame
  // no llegara dejaría la cámara abierta y la foto imposible — peor que
  // el triángulo de «play» que se viene a tapar. Dos redes: se escuchan
  // TRES eventos distintos (ver el `<video>`), y hay un plazo de 3 s
  // tras el cual se da por pintando de todas formas. Si a los 3 s no hay
  // imagen, lo que la podóloga ve es negro y puede disparar: una foto
  // negra se repite, una cámara que no dispara no.
  const [pintando, setPintando] = useState(false);
  /** ¿La cámara de este aparato tiene flash que se pueda encender? */
  const [hayLinterna, setHayLinterna] = useState(false);
  const [linterna, setLinterna] = useState(false);
  /** El JPEG recién hecho que todavía no tiene zona. Ver `disparar`. */
  const [capturada, setCapturada] = useState<string | null>(null);
  /** Sube con «Repetir la foto»: es lo que vuelve a arrancar el stream
   *  que paramos al capturar. */
  const [reintento, setReintento] = useState(0);

  const pararStream = useCallback(() => {
    const s = streamRef.current;
    if (s) {
      for (const t of s.getTracks()) {
        try {
          t.stop();
        } catch {
          /* ignorar */
        }
      }
      streamRef.current = null;
    }
    const v = videoRef.current;
    if (v) v.srcObject = null;
  }, []);

  useEffect(() => {
    let cancelado = false;
    setPintando(false);
    setLinterna(false);
    setHayLinterna(false);
    (async () => {
      try {
        const permiso = await ensureCameraPermission();
        if (cancelado) return;
        if (permiso === "denied") {
          setError(mensajeDePermiso());
          return;
        }
        // La trasera, y a 1600×1200 ideal: lo que se fotografía es una
        // uña de 1 cm, y en una foto de 640 no se ve si el borde está
        // inflamado. `ideal` y no `exact`: si la cámara no lo soporta, el
        // navegador baja en vez de fallar.
        //
        // clinica-8 (fase B, 10) · LA EXPOSICIÓN CON POCA LUZ («imagen
        // muy oscura», auditoría del 18-10).
        //
        // `frameRate: { ideal: 15 }`. El sensor de una tablet de 200 €
        // expone en automático, y lo que limita cuánto puede abrir el
        // obturador es el frame rate: a 30 fps no puede pasar de 1/30 s
        // por frame. Pidiendo 15 se le deja llegar a 1/15, que es el
        // doble de luz, y 15 fps son de sobra para encuadrar un pie
        // apoyado en un reposapiés.
        //
        // `ideal` y no `exact` por lo mismo que la resolución: una cámara
        // que no sepa bajar sigue dando 30 en vez de fallar.
        //
        // Y lo que de verdad arregla una consulta con la persiana bajada
        // no es una constraint: es ENCENDER LA LUZ. Ver `hayLinterna`.
        const calidad = {
          width: { ideal: 1600 },
          height: { ideal: 1200 },
          frameRate: { ideal: 15 },
        };
        const elegida = camaras[cual];
        const constraints: MediaStreamConstraints = elegida?.deviceId
          ? { video: { deviceId: { exact: elegida.deviceId }, ...calidad } }
          : { video: { facingMode: { ideal: "environment" }, ...calidad } };
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        if (cancelado) {
          for (const t of stream.getTracks()) t.stop();
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => undefined);
        }
        setEstado("Encuadra la zona y dispara");
        // ¿Tiene flash esta cámara? Se pregunta a la PISTA, no a la
        // plataforma: `torch` está en las capacidades del track y es la
        // única forma honesta de saberlo. Si no está, no se ofrece el
        // botón — un botón de luz que no enciende nada es peor que no
        // tenerlo. En jsdom `getCapabilities` no existe, y entonces no
        // hay linterna, que es lo correcto.
        setHayLinterna(pistaConLinterna(stream));
        if (camaras.length === 0) {
          try {
            const devs = await navigator.mediaDevices.enumerateDevices();
            if (!cancelado) {
              setCamaras(devs.filter((d) => d.kind === "videoinput"));
            }
          } catch {
            /* sin selector, sin drama */
          }
        }
      } catch (err) {
        if (cancelado) return;
        const nombre = err instanceof Error ? err.name : "";
        if (nombre === "NotAllowedError" || nombre === "SecurityError") {
          setError(mensajeDePermiso());
        } else if (
          nombre === "NotFoundError" ||
          nombre === "OverconstrainedError"
        ) {
          setError("No se ha encontrado cámara en este aparato.");
        } else {
          setError(
            err instanceof Error
              ? err.message
              : "No se pudo abrir la cámara.",
          );
        }
      }
    })();
    // El plazo de los 3 s. Ver la nota de `pintando`.
    const plazo = setTimeout(() => {
      if (!cancelado) setPintando(true);
    }, 3000);
    return () => {
      cancelado = true;
      clearTimeout(plazo);
      pararStream();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cual, reintento, pararStream]);

  /**
   * clinica-8 (fase B, 10) · SE APUNTA Y SE DISPARA.
   *
   * El frame se coge SIEMPRE. Lo que cambia según haya zona o no es qué
   * se hace con él:
   *
   *   · con zona (la de la sesión de hoy, o una tocada antes) la foto se
   *     guarda y se cierra la cámara, como hasta ahora;
   *   · sin zona, el frame se QUEDA EN LA MANO (`capturada`) y la
   *     pantalla pregunta de qué zona es, con la foto delante.
   *
   * El segundo camino es el que el prompt pide («o se elige después de
   * la foto») y es mejor clínicamente: elegir la zona MIRANDO la foto
   * que se acaba de hacer es más fiable que elegirla de memoria antes de
   * apuntar — que es de donde salían las zonas equivocadas.
   *
   * Lo que NO se hace es guardar sin zona. Una foto sin zona no entra en
   * el comparador antes/después, que es para lo que existen las fotos.
   */
  async function disparar() {
    const v = videoRef.current;
    if (!v || disparando || error != null) return;
    // El frame se pasa a un canvas del tamaño REAL del vídeo y se
    // codifica en JPEG al 0,85: en PNG una foto de 1600×1200 pesa 3 MB
    // y el tope de la API son 4.
    let base64 = "";
    try {
      const canvas = document.createElement("canvas");
      canvas.width = v.videoWidth || 1280;
      canvas.height = v.videoHeight || 960;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("sin contexto 2d");
      ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
      base64 = canvas.toDataURL("image/jpeg", 0.85).split(",")[1] ?? "";
    } catch {
      setError("No se pudo tomar la foto. Vuelve a intentarlo.");
      return;
    }
    if (!zona) {
      // La cámara se PARA aquí: la foto ya está hecha y tener el LED
      // encendido mientras se elige una zona es la lección de
      // `cameraScan` otra vez.
      pararStream();
      setCapturada(base64);
      return;
    }
    await guardar(zona, base64);
  }

  /** Manda la foto y cierra. El único sitio que llama a `onDisparo`. */
  async function guardar(laZona: string, base64: string) {
    setDisparando(true);
    try {
      await props.onDisparo(laZona, base64);
      pararStream();
      props.onCerrar();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "No se pudo guardar la foto.",
      );
    } finally {
      setDisparando(false);
    }
  }

  // Las zonas de hoy primero y, con «Otra zona…», las 22 del mapa. El
  // mockup hace lo mismo: lo normal es fotografiar lo que se acaba de
  // marcar, y lo que no es normal tiene que poder hacerse igual.
  const todas = (["L", "R"] as const).flatMap((pie) =>
    props.mapa.zonas.map((z) => `${pie}:${z.id}`),
  );
  const ofrecidas = todasLasZonas
    ? todas
    : props.zonasDeHoy.length > 0
      ? props.zonasDeHoy
      : todas;

  // Las TRES razones por las que no se puede disparar, en una. Se calcula
  // aquí y no en el `disabled` para que el aspecto del botón y su
  // `aria-disabled` no puedan separarse de la condición real.
  const bloqueado = disparando || error != null || !pintando;

  // ── LA FOTO YA HECHA, ESPERANDO SU ZONA ────────────────────────────
  //
  // clinica-8 (fase B, 10). Se llega aquí sólo cuando se disparó sin
  // zona puesta. Es una pantalla aparte y no un panel debajo del visor a
  // propósito: lo que hay que mirar para contestar «¿de qué zona es?» es
  // LA FOTO, no el pie. Con el visor en directo encima, la podóloga
  // estaría eligiendo mirando otra cosa.
  if (capturada != null) {
    return (
      <div
        className="bg-white border border-slate-200 rounded-3xl px-3 sm:px-5 py-4"
        data-test="camara-zona-despues"
      >
        <h2 className="m-0 text-[17px] font-bold text-mipiace-ink">
          ¿De qué zona es esta foto?
        </h2>
        <div className="text-[13px] text-slate-500 mt-0.5">
          Toca la zona y se guarda en la historia. Todavía no está
          guardada.
        </div>

        <img
          src={`data:image/jpeg;base64,${capturada}`}
          alt="La foto que se acaba de hacer"
          className="mt-3 w-full h-[260px] object-cover rounded-[20px] bg-black"
        />

        {error && (
          <div className="mt-3 inline-flex items-center gap-2 bg-red-50 text-red-700 px-3.5 py-2 rounded-xl text-[13.5px]">
            <AlertCircle className="w-4 h-4 shrink-0" />
            {error}
          </div>
        )}

        <div
          className={`gap-2 mt-3 ${
            ofrecidas.length > 6
              ? "flex flex-nowrap overflow-x-auto pb-1.5"
              : "flex flex-wrap"
          }`}
        >
          {ofrecidas.map((clave) => (
            <button
              key={clave}
              type="button"
              data-test={`zona-despues-${clave}`}
              disabled={disparando}
              onClick={() => void guardar(clave, capturada)}
              className="min-h-touch px-3.5 rounded-xl text-[14px] border bg-white border-slate-200 text-mipiace-ink whitespace-nowrap shrink-0 disabled:opacity-45"
            >
              {nombreDeZona(clave, props.mapa.version)}
            </button>
          ))}
          {!todasLasZonas && props.zonasDeHoy.length > 0 && (
            <button
              type="button"
              onClick={() => setTodasLasZonas(true)}
              className="min-h-touch px-3.5 rounded-xl text-[14px] border bg-white border-slate-200 text-mipiace-ink whitespace-nowrap shrink-0"
            >
              Otra zona…
            </button>
          )}
        </div>

        <div className="flex gap-3 flex-wrap items-center mt-3.5">
          {/* «Repetir» vuelve al visor: suelta el frame y deja que el
              efecto de arranque vuelva a pedir el stream (lo paramos al
              capturar). */}
          <button
            type="button"
            data-test="repetir-foto"
            disabled={disparando}
            onClick={() => {
              setCapturada(null);
              setError(null);
              setReintento((n) => n + 1);
            }}
            className="h-touch px-4 rounded-2xl bg-mipiace-stone text-mipiace-ink font-medium text-[14px] disabled:opacity-45"
          >
            Repetir la foto
          </button>
          <button
            type="button"
            disabled={disparando}
            onClick={() => {
              setCapturada(null);
              props.onCerrar();
            }}
            className="h-touch px-4 rounded-2xl bg-white border border-slate-200 text-mipiace-ink text-[14px] disabled:opacity-45"
          >
            Descartarla
          </button>
          {disparando && (
            <span className="inline-flex items-center gap-2 text-[13.5px] text-slate-500">
              <Loader2 className="w-4 h-4 animate-spin motion-reduce:animate-none" />
              Guardando…
            </span>
          )}
        </div>
        <div className="text-[12.5px] text-slate-500 mt-2">
          La foto se guarda en la historia del paciente, nunca en la
          galería de la tablet.
        </div>
      </div>
    );
  }

  return (
    <div
      className="bg-white border border-slate-200 rounded-3xl px-3 sm:px-5 py-4"
      data-test="camara"
    >
      <h2 className="m-0 text-[17px] font-bold text-mipiace-ink">Nueva foto</h2>
      {/* clinica-8 (fase B, 10) · el subtítulo depende de si la zona ya
          está puesta. «Elige antes de disparar» era una orden para un
          caso que ahora es el raro; cuando la zona viene de la sesión lo
          que hay que decir es CUÁL es y que se puede cambiar. */}
      <div className="text-[13px] text-slate-500 mt-0.5">
        {zona
          ? `Zona: ${nombreDeZona(zona, props.mapa.version)}. Se puede cambiar antes o después de la foto.`
          : "¿De qué zona es? Elígela y se activa el disparador."}
      </div>

      {/* UNA SOLA FILA que se desliza cuando hay muchas zonas.
          Con `flex-wrap`, las 22 del mapa ocupaban cinco filas y dejaban
          el visor por debajo del pliegue a 390 — lo vio el bucle visual.
          Y hay muchas justo en el caso normal del primer día: cuando al
          paciente no se le ha marcado nada todavía, se ofrecen todas.
          Con pocas (las marcadas) se reparten en filas como siempre. */}
      <div
        className={`gap-2 mt-3 ${
          ofrecidas.length > 6
            ? "flex flex-nowrap overflow-x-auto pb-1.5"
            : "flex flex-wrap"
        }`}
      >
        {ofrecidas.map((clave) => (
          <button
            key={clave}
            type="button"
            data-test={`zona-${clave}`}
            aria-pressed={zona === clave}
            onClick={() => setZona(clave)}
            className={`min-h-touch px-3.5 rounded-xl text-[14px] border whitespace-nowrap shrink-0 ${
              zona === clave
                ? "bg-mipiace-coral-soft border-mipiace-coral text-mipiace-coral-dark font-medium"
                : "bg-white border-slate-200 text-mipiace-ink"
            }`}
          >
            {nombreDeZona(clave, props.mapa.version)}
          </button>
        ))}
        {!todasLasZonas && props.zonasDeHoy.length > 0 && (
          <button
            type="button"
            onClick={() => setTodasLasZonas(true)}
            className="min-h-touch px-3.5 rounded-xl text-[14px] border bg-white border-slate-200 text-mipiace-ink whitespace-nowrap shrink-0"
          >
            Otra zona…
          </button>
        )}
      </div>

      <div className="relative mt-3 bg-black rounded-[20px] h-[320px] overflow-hidden">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          // clinica-8 (fase B, 10) · `poster` vacío NO vale: Chrome
          // trata un `poster` que no carga como si no hubiera, y vuelve
          // a pintar su controlador. Lo que se hace es taparlo con una
          // capa propia mientras no haya frame (ver abajo), y quitarla
          // en cuanto el primero llegue.
          // TRES eventos y no uno. `loadeddata` es el que llega en
          // escritorio; en algunos WebView con autoplay restringido llega
          // `playing` y `loadeddata` no, o llega sólo `timeupdate` al
          // primer frame. Cualquiera de los tres significa lo mismo: ya
          // hay imagen.
          onLoadedData={() => setPintando(true)}
          onPlaying={() => setPintando(true)}
          onTimeUpdate={() => setPintando(true)}
          className="absolute inset-0 w-full h-full object-cover"
        />
        {/* LA CAPA QUE TAPA EL PÓSTER DE «PLAY» de Android.
            Un `<video>` sin frames es, para el WebView, un vídeo parado,
            y lo pinta con un triángulo gigante centrado que invita a
            tocarlo. Mientras `pintando` es falso —el segundo que tarda
            `getUserMedia`— aquí hay negro opaco con el estado dentro, y
            `pointer-events-none` para que el toque que de todas formas
            caiga ahí no haga nada.
            Con error no se quita nunca: no hay vídeo que enseñar y lo
            que toca ver es el mensaje. */}
        {!pintando && (
          <div
            data-test="camara-arrancando"
            aria-hidden
            className="absolute inset-0 bg-black flex items-center justify-center pointer-events-none"
          >
            <span className="inline-flex items-center gap-2 text-white/85 text-[13.5px]">
              <Loader2 className="w-4 h-4 animate-spin motion-reduce:animate-none" />
              {error ? "" : "Iniciando cámara…"}
            </span>
          </div>
        )}
        {/* La guía del encuadre. No recorta nada: la foto que se guarda es
            el frame completo, y recortar por una guía sería tirar parte de
            una imagen clínica. */}
        <div className="absolute inset-y-10 inset-x-[30%] border-2 border-dashed border-white/60 rounded-[40%_40%_30%_30%] pointer-events-none" />
        {/* EL DISPARADOR, Y QUÉ ASPECTO TIENE CUANDO NO SE PUEDE PULSAR.
            clinica-8 (fase B, 10) · «el disparador nunca parece activo
            estando bloqueado» (prompt), «el disparador parece activo y
            no lo está» (auditoría, punto 10).
            Antes era el mismo círculo blanco pleno con `opacity-45`. Un
            45 % de opacidad sobre NEGRO sigue siendo un círculo claro y
            grande, que es la única cosa redonda de la pantalla y el
            gesto aprendido de cualquier cámara: la podóloga lo tocaba.
            Ahora, bloqueado, deja de ser un disparador: fondo
            transparente, aro punteado y el icono de «no se puede»
            dentro.
            Y lo que lo bloquea ya NO es que falte la zona —eso se
            pregunta después de la foto—: son las tres cosas que de
            verdad impiden hacerla, que la cámara no esté pintando
            todavía, que se esté guardando la anterior, o que haya
            error. */}
        <button
          type="button"
          data-test="disparar"
          aria-label="Hacer foto"
          aria-disabled={bloqueado}
          disabled={bloqueado}
          onClick={() => void disparar()}
          className={`absolute bottom-4 left-1/2 -translate-x-1/2 w-[76px] h-[76px] rounded-full flex items-center justify-center ${
            bloqueado
              ? "bg-transparent border-2 border-dashed border-white/45 text-white/55"
              : "bg-white border-[6px] border-white/40"
          }`}
        >
          {disparando ? (
            <Loader2 className="w-6 h-6 animate-spin motion-reduce:animate-none text-mipiace-ink" />
          ) : (
            bloqueado && <Ban className="w-6 h-6" strokeWidth={2} />
          )}
        </button>
        <div className="absolute top-3 right-3 flex flex-col items-end gap-2">
          {camaras.length > 1 && !error && (
            <button
              type="button"
              onClick={() => setCual((i) => (i + 1) % camaras.length)}
              aria-label="Cambiar cámara"
              className="min-h-touch px-3 rounded-xl bg-black/55 text-white text-[13px] inline-flex items-center gap-1.5"
            >
              <SwitchCamera className="w-4 h-4" /> Cambiar cámara
            </button>
          )}
          {/* clinica-8 (fase B, 10) · LA LUZ. «Imagen muy oscura con poca
              luz» (auditoría). Una consulta se mira el pie con un flexo
              y el pie está a la altura de la rodilla, a la sombra de la
              propia tablet. La constraint de 15 fps ayuda; lo que
              resuelve es encender el flash.
              Sólo sale si la pista dice que lo tiene. */}
          {hayLinterna && !error && (
            <button
              type="button"
              data-test="linterna"
              aria-pressed={linterna}
              onClick={() => {
                void (async () => {
                  const quiero = !linterna;
                  const pudo = await ponerLinterna(streamRef.current, quiero);
                  // Si no se pudo, se deja de ofrecer en vez de dejar un
                  // botón que miente: la capacidad decía que sí y el
                  // aparato ha dicho que no.
                  if (pudo) setLinterna(quiero);
                  else setHayLinterna(false);
                })();
              }}
              className={`min-h-touch px-3 rounded-xl text-[13px] inline-flex items-center gap-1.5 ${
                linterna
                  ? "bg-white text-mipiace-ink font-medium"
                  : "bg-black/55 text-white"
              }`}
            >
              {linterna ? (
                <Flashlight className="w-4 h-4" />
              ) : (
                <FlashlightOff className="w-4 h-4" />
              )}
              Luz
            </button>
          )}
        </div>
        {/* ENCIMA del disparador y sin recibir toques.
            Lo cazó el bucle visual: con el aviso a `bottom-5` y el
            disparador a `bottom-4`, el texto quedaba POR DELANTE del
            botón — Playwright se negó a pulsarlo («element would receive
            the click»), y en la tablet la podóloga habría tocado el
            disparador sin que pasara nada. `pointer-events-none` y por
            encima: el aviso informa, no estorba. */}
        <div className="absolute bottom-28 left-4 right-4 text-center pointer-events-none">
          {error ? (
            <span className="inline-flex items-center gap-2 bg-red-600/90 text-white px-3.5 py-2 rounded-xl text-[13.5px]">
              <AlertCircle className="w-4 h-4 shrink-0" />
              {error}
            </span>
          ) : (
            <span className="inline-block bg-black/55 text-white px-3.5 py-2 rounded-xl text-[13.5px]">
              {estado}
            </span>
          )}
        </div>
      </div>

      <div className="flex gap-3 flex-wrap items-center mt-3.5">
        <button
          type="button"
          onClick={() => {
            pararStream();
            props.onCerrar();
          }}
          className="h-touch px-4 rounded-2xl bg-mipiace-stone text-mipiace-ink font-medium text-[14px]"
        >
          Cancelar
        </button>
        {/* clinica-8 (fase B, 10) · antes aquí ponía «Elige la zona para
            poder disparar», que era la orden que el prompt viene a
            quitar. Ahora se dispara igual y la zona se pregunta con la
            foto delante; lo que queda es decirlo, para que nadie busque
            el paso que ya no existe. */}
        {!zona && (
          <span className="text-[13.5px] text-slate-500">
            Dispara y luego eliges de qué zona es.
          </span>
        )}
      </div>
      <div className="text-[12.5px] text-slate-500 mt-2">
        La foto se guarda en la historia del paciente, nunca en la galería de
        la tablet.
      </div>
    </div>
  );
}

// ── La pieza completa ────────────────────────────────────────────────

export function Fotos(props: {
  clientId: string;
  mapa: MapaVersionado;
  /** La cita, si se abre desde la sesión. Sin ella no se puede hacer una
   *  foto: una foto clínica cuelga de la visita en la que se hizo. */
  appointmentId?: string;
  /** Las zonas marcadas hoy, para ofrecerlas primero. */
  zonasDeHoy?: readonly string[];
  /** Llevar a firmar el consentimiento de fotos. */
  onFirmarConsentimiento?: (plantillaId: string) => void;
}) {
  const [vista, setVista] = useState<VistaDeFotos | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [camaraAbierta, setCamaraAbierta] = useState(false);
  const [zonaComparada, setZonaComparada] = useState<string | null>(null);
  const [retirando, setRetirando] = useState<string | null>(null);
  /** Cuál está con su caja de motivo abierta, y qué se ha escrito. */
  const [retirandoCual, setRetirandoCual] = useState<string | null>(null);
  const [motivo, setMotivo] = useState("");

  const cargar = useCallback(async () => {
    setError(null);
    try {
      setVista(
        await apiWithCashier<VistaDeFotos>(
          `/clinica/clients/${props.clientId}/fotos`,
        ),
      );
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "No se pudieron abrir las fotos (¿sin conexión?).",
      );
    } finally {
      setCargando(false);
    }
  }, [props.clientId]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function disparo(zona: string, jpegBase64: string) {
    if (!props.appointmentId) return;
    await apiWithCashier(
      `/clinica/appointments/${props.appointmentId}/fotos`,
      { method: "POST", body: { zona, jpegBase64 } },
    );
    setZonaComparada(zona);
    await cargar();
  }

  /**
   * RETIRAR una foto, con su motivo escrito en la pantalla.
   *
   * El motivo es obligatorio en la API y se pide **en la propia tarjeta**,
   * no con un `prompt()` del navegador: el TPV no usa diálogos nativos
   * desde v1.12 (`no-native-dialogs.test.ts` lo vigila sobre todo `src/`),
   * y en un terminal un `prompt` sale como «mipiacetpv.com dice…» con
   * botones de Chrome y bloqueando el hilo.
   *
   * Y es una tarjeta y no una hoja modal porque lo que se retira es ESTA
   * foto: el motivo se escribe mirándola.
   */
  async function retirar(fotoId: string, motivo: string) {
    if (motivo.trim().length < 3) return;
    setRetirando(fotoId);
    try {
      await apiWithCashier(
        `/clinica/clients/${props.clientId}/fotos/${fotoId}/retirar`,
        { method: "POST", body: { motivo: motivo.trim() } },
      );
      setRetirandoCual(null);
      setMotivo("");
      await cargar();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "No se pudo retirar la foto.",
      );
    } finally {
      setRetirando(null);
    }
  }

  if (cargando) {
    return (
      <div className="flex items-center gap-2 text-[13px] text-slate-500 py-10 justify-center">
        <Loader2 className="w-4 h-4 animate-spin motion-reduce:animate-none" />
        Abriendo las fotos…
      </div>
    );
  }
  if (!vista) return <Mal>{error ?? "No se pudieron abrir las fotos."}</Mal>;

  // ── Sin consentimiento, la pantalla lleva a firmarlo ───────────────
  if (!vista.consentimiento.puede) {
    return (
      <div
        className="bg-white border border-slate-200 rounded-3xl px-3 sm:px-5 py-4"
        data-test="fotos-sin-consentimiento"
      >
        <h2 className="m-0 text-[17px] font-bold text-mipiace-ink">Fotos</h2>
        <div className="text-[13px] text-slate-500 mt-0.5">
          {vista.consentimiento.mensaje}
        </div>
        {props.onFirmarConsentimiento && (
          <button
            type="button"
            data-test="ir-a-firmar-fotos"
            onClick={() =>
              props.onFirmarConsentimiento!(vista.consentimiento.plantillaId)
            }
            className="mt-3.5 h-[56px] px-6 rounded-[18px] bg-mipiace-coral text-white font-medium text-[16px]"
          >
            Firmar consentimiento de fotos
          </button>
        )}
      </div>
    );
  }

  if (camaraAbierta && props.appointmentId) {
    return (
      <Camara
        mapa={props.mapa}
        zonasDeHoy={props.zonasDeHoy ?? []}
        onCerrar={() => setCamaraAbierta(false)}
        onDisparo={disparo}
      />
    );
  }

  const zonas = vista.comparador.map((c) => c.zona);
  const comparada =
    vista.comparador.find((c) => c.zona === zonaComparada) ??
    vista.comparador[0] ??
    null;

  return (
    <div
      className="bg-white border border-slate-200 rounded-3xl px-3 sm:px-5 py-4"
      data-test="fotos"
    >
      <h2 className="m-0 text-[17px] font-bold text-mipiace-ink">Fotos</h2>
      <div className="text-[13px] text-slate-500 mt-0.5">
        Por zona, en orden de fecha. Toca una zona para comparar antes y
        después.
      </div>

      {props.appointmentId ? (
        <button
          type="button"
          data-test="hacer-foto"
          onClick={() => setCamaraAbierta(true)}
          className="mt-3 h-[56px] px-6 rounded-[18px] bg-mipiace-coral text-white font-medium text-[16px] inline-flex items-center gap-2"
        >
          <Camera className="w-[18px] h-[18px]" /> Hacer foto
        </button>
      ) : (
        // Igual que «Hoy toca» en la historia de clinica-6: en vez de
        // ofrecer un botón que no puede cumplir, se dice dónde se hace.
        <div className="mt-3 text-[13px] text-slate-500">
          Las fotos se hacen desde la sesión de la visita, tocando la zona
          del pie.
        </div>
      )}

      {zonas.length > 0 && (
        <>
          <div className="mt-4 text-[13px] font-medium text-mipiace-ink-soft">
            Comparar
          </div>
          <div className="flex flex-wrap gap-2 mt-2">
            {zonas.map((z) => (
              <button
                key={z}
                type="button"
                aria-pressed={comparada?.zona === z}
                onClick={() => setZonaComparada(z)}
                className={`min-h-touch px-3.5 rounded-xl text-[14px] border ${
                  comparada?.zona === z
                    ? "bg-mipiace-coral-soft border-mipiace-coral text-mipiace-coral-dark font-medium"
                    : "bg-white border-slate-200 text-mipiace-ink"
                }`}
              >
                {nombreDeZona(z, vista.mapaVersion)}
              </button>
            ))}
          </div>

          {comparada && (
            <ComparadorAntesDespues
              clientId={props.clientId}
              comparador={comparada}
            />
          )}
        </>
      )}

      <div className="mt-4 text-[13px] font-medium text-mipiace-ink-soft">
        Todas
      </div>
      {vista.fotos.length === 0 ? (
        <div className="text-[13px] text-slate-500 mt-1.5">
          Todavía no hay ninguna foto de este paciente.
        </div>
      ) : (
        <div
          className="grid gap-3 mt-2"
          style={{
            gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
          }}
        >
          {vista.fotos.map((f) => (
            <div
              key={f.id}
              data-test="foto"
              className="rounded-2xl overflow-hidden border border-slate-200 bg-white"
            >
              <div className="relative">
                <ImagenDeFoto
                  clientId={props.clientId}
                  foto={f}
                  className={`w-full h-[110px] ${f.retirada ? "opacity-40" : ""}`}
                />
                {f.retirada && (
                  <span className="absolute top-1.5 left-1.5 bg-slate-900/80 text-white text-[11px] font-bold px-2 py-0.5 rounded-lg inline-flex items-center gap-1">
                    <EyeOff className="w-3 h-3" /> RETIRADA
                  </span>
                )}
              </div>
              <div className="px-2.5 py-2 text-[12.5px] text-mipiace-ink-soft">
                {f.zonaNombre}
                <br />
                {diaCorto(f.hecha)} · {f.autor}
                {f.retirada && f.retiradaMotivo && (
                  <>
                    <br />
                    <span className="text-slate-500">{f.retiradaMotivo}</span>
                  </>
                )}
              </div>
              {!f.retirada && retirandoCual !== f.id && (
                <button
                  type="button"
                  data-test="retirar"
                  onClick={() => {
                    setRetirandoCual(f.id);
                    setMotivo("");
                  }}
                  className="w-full min-h-touch text-[13px] text-slate-600 border-t border-slate-200 inline-flex items-center justify-center gap-1.5"
                >
                  <X className="w-3.5 h-3.5" />
                  Retirar
                </button>
              )}
              {retirandoCual === f.id && (
                <div className="border-t border-slate-200 p-2.5">
                  <label className="block text-[12.5px] text-mipiace-ink-soft">
                    ¿Por qué se retira? Queda escrito en la historia.
                    <input
                      value={motivo}
                      onChange={(e) => setMotivo(e.target.value)}
                      maxLength={200}
                      data-test="motivo-retirada"
                      autoFocus
                      className="mt-1 w-full h-touch px-2.5 rounded-xl border border-slate-200 text-[14px] text-mipiace-ink"
                    />
                  </label>
                  <div className="flex gap-2 mt-2">
                    {/* Los dos botones con VERBOS distintos y que no
                        empiezan igual, como pide `ConfirmSheet`: «Retirar
                        la foto» / «Dejarla» — nunca «Aceptar/Cancelar». */}
                    <button
                      type="button"
                      data-test="confirmar-retirada"
                      disabled={motivo.trim().length < 3 || retirando === f.id}
                      onClick={() => void retirar(f.id, motivo)}
                      className="flex-1 min-h-touch px-2 rounded-xl bg-mipiace-coral text-white text-[13px] font-medium disabled:opacity-45 inline-flex items-center justify-center gap-1.5"
                    >
                      {retirando === f.id && (
                        <Loader2 className="w-3.5 h-3.5 animate-spin motion-reduce:animate-none" />
                      )}
                      Retirar la foto
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setRetirandoCual(null);
                        setMotivo("");
                      }}
                      className="min-h-touch px-3 rounded-xl bg-mipiace-stone text-mipiace-ink text-[13px] font-medium"
                    >
                      Dejarla
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="text-[12.5px] text-slate-500 mt-3">
        Una foto no se borra: se retira con su motivo y sigue en la historia.
      </div>

      {error && (
        <div className="mt-3">
          <Mal>{error}</Mal>
        </div>
      )}
    </div>
  );
}

/**
 * EL COMPARADOR antes/última.
 *
 * Con UNA sola foto no se compara y se dice («con la segunda podrás
 * comparar») en vez de enseñar la misma foto dos veces, que es lo que
 * haría una rejilla de dos huecos rellenada a ciegas. La más antigua y la
 * última las elige el servidor (`comparadorPorZona`): es una regla de la
 * historia, no de pintar.
 */
export function ComparadorAntesDespues(props: {
  clientId: string;
  comparador: ComparadorDeZona;
}) {
  const c = props.comparador;
  if (c.cuantas === 0) {
    return (
      <div className="mt-3 h-[120px] rounded-[18px] border-2 border-dashed border-slate-200 flex items-center justify-center gap-2 text-slate-500 text-[14px]">
        <Camera className="w-[18px] h-[18px]" />
        Sin fotos de esta zona
      </div>
    );
  }
  if (c.cuantas === 1 || !c.antes) {
    return (
      <div className="mt-3" data-test="comparador-una-sola">
        <ImagenDeFoto
          clientId={props.clientId}
          foto={c.ultima!}
          className="w-full h-[220px] rounded-2xl"
        />
        <div className="text-[13px] text-mipiace-ink-soft mt-1.5">
          Única · {diaCorto(c.ultima!.hecha)}
        </div>
        <div className="text-[13px] text-slate-500">
          Sólo hay una foto de esta zona. Con la segunda podrás comparar.
        </div>
      </div>
    );
  }
  return (
    <div className="mt-3 grid gap-3 sm:grid-cols-2" data-test="comparador">
      <div>
        <ImagenDeFoto
          clientId={props.clientId}
          foto={c.antes}
          className="w-full h-[220px] rounded-2xl"
        />
        <div className="text-[13px] text-mipiace-ink-soft mt-1.5">
          Antes · {diaCorto(c.antes.hecha)}
        </div>
      </div>
      <div>
        <ImagenDeFoto
          clientId={props.clientId}
          foto={c.ultima!}
          className="w-full h-[220px] rounded-2xl"
        />
        <div className="text-[13px] text-mipiace-ink-soft mt-1.5">
          Última · {diaCorto(c.ultima!.hecha)}
        </div>
      </div>
    </div>
  );
}

export { NOMBRE_CORTO_DEL_PIE };
