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
  Camera,
  EyeOff,
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

function Camara(props: {
  mapa: MapaVersionado;
  /** Las zonas que se ofrecen primero: las marcadas hoy en el mapa. */
  zonasDeHoy: readonly string[];
  onCerrar: () => void;
  onDisparo: (zona: string, jpegBase64: string) => Promise<void>;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [zona, setZona] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [estado, setEstado] = useState("Iniciando cámara…");
  const [camaras, setCamaras] = useState<MediaDeviceInfo[]>([]);
  const [cual, setCual] = useState(0);
  const [disparando, setDisparando] = useState(false);
  const [todasLasZonas, setTodasLasZonas] = useState(false);

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
        const calidad = { width: { ideal: 1600 }, height: { ideal: 1200 } };
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
    return () => {
      cancelado = true;
      pararStream();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cual, pararStream]);

  async function disparar() {
    const v = videoRef.current;
    if (!v || !zona) return;
    setDisparando(true);
    try {
      // El frame se pasa a un canvas del tamaño REAL del vídeo y se
      // codifica en JPEG al 0,85: en PNG una foto de 1600×1200 pesa 3 MB
      // y el tope de la API son 4.
      const canvas = document.createElement("canvas");
      canvas.width = v.videoWidth || 1280;
      canvas.height = v.videoHeight || 960;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("sin contexto 2d");
      ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
      const base64 = canvas.toDataURL("image/jpeg", 0.85).split(",")[1] ?? "";
      await props.onDisparo(zona, base64);
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

  return (
    <div
      className="bg-white border border-slate-200 rounded-3xl px-3 sm:px-5 py-4"
      data-test="camara"
    >
      <h2 className="m-0 text-[17px] font-bold text-mipiace-ink">Nueva foto</h2>
      <div className="text-[13px] text-slate-500 mt-0.5">
        ¿De qué zona es? Elige antes de disparar.
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
          className="absolute inset-0 w-full h-full object-cover"
        />
        {/* La guía del encuadre. No recorta nada: la foto que se guarda es
            el frame completo, y recortar por una guía sería tirar parte de
            una imagen clínica. */}
        <div className="absolute inset-y-10 inset-x-[30%] border-2 border-dashed border-white/60 rounded-[40%_40%_30%_30%] pointer-events-none" />
        <button
          type="button"
          data-test="disparar"
          aria-label="Hacer foto"
          disabled={!zona || disparando || error != null}
          onClick={() => void disparar()}
          className="absolute bottom-4 left-1/2 -translate-x-1/2 w-[76px] h-[76px] rounded-full bg-white border-[6px] border-white/40 disabled:opacity-45 flex items-center justify-center"
        >
          {disparando && (
            <Loader2 className="w-6 h-6 animate-spin motion-reduce:animate-none text-mipiace-ink" />
          )}
        </button>
        {camaras.length > 1 && !error && (
          <button
            type="button"
            onClick={() => setCual((i) => (i + 1) % camaras.length)}
            aria-label="Cambiar cámara"
            className="absolute top-3 right-3 min-h-touch px-3 rounded-xl bg-black/55 text-white text-[13px] inline-flex items-center gap-1.5"
          >
            <SwitchCamera className="w-4 h-4" /> Cambiar cámara
          </button>
        )}
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
        {!zona && (
          <span className="text-[13.5px] text-amber-700">
            Elige la zona para poder disparar.
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
