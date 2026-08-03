// v1.3-Thalia Lote 5 · Lector de código de barras vía cámara.
//
// Pensado para iPad sin USB scanner (Thalía tiene un USB-HID OK pero
// quería fallback con la cámara cuando vende fuera del mostrador).
// Usa @zxing/browser que es 15kb gzipped y mantiene a EAN-13/UPC-A/
// EAN-8/Code-128 — los formatos reales de los libros y papelería.
//
// Decisiones:
//   - Modal full-screen para minimizar interferencia del DOM con el
//     stream y permitir un cuadro guía grande (mejor lectura).
//   - Llamamos a `addByBarcode` (la misma función que usa el USB-HID
//     scanner) para no duplicar lógica de catalog lookup + modal de
//     modifiers.
//   - Stop EXPLÍCITO del stream al cerrar — si no, el LED de la
//     cámara del iPad queda encendido aunque el modal se desmonte
//     (bug clásico de getUserMedia en Safari).
//   - Feedback háptico al detectar (navigator.vibrate) si está
//     disponible. iPad Safari no lo soporta, pero los Android sí.

import { useCallback, useEffect, useRef, useState } from "react";
import { X, AlertCircle, ScanLine, SwitchCamera } from "lucide-react";
import { BrowserMultiFormatReader, type IScannerControls } from "@zxing/browser";

import { getPlatform } from "../platform/index.js";
import { ensureCameraPermission } from "../platform/camera/CameraPermission.js";

// Mensaje de permiso denegado, adaptado a la plataforma: en la app
// Android la ruta de ajustes es distinta a la del navegador/iPad.
function deniedMessage(): string {
  if (getPlatform() === "android") {
    return "Permiso de cámara denegado. Actívalo en Ajustes de Android > Aplicaciones > mipiacetpv > Permisos > Cámara.";
  }
  return "Permiso de cámara denegado. Habilítalo en los ajustes del navegador (Cámara) y vuelve a intentarlo.";
}

export function CameraScanModal({
  onClose,
  onScanned,
}: {
  onClose: () => void;
  // Devuelve true si el código matcheó un producto (modal se cierra),
  // false si no — modal queda abierto para reintentar con otro código.
  onScanned: (code: string) => boolean;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  // Anti-rebote: zxing dispara varios hits por segundo sobre el mismo
  // código mientras enfoca. Si ya estamos procesando uno, ignoramos
  // duplicados durante 1.2s — suficiente para que el usuario aleje y
  // re-apunte si quiere escanear otro distinto.
  const lastHitRef = useRef<{ code: string; at: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("Iniciando cámara…");
  const [hint, setHint] = useState<string | null>(null);
  // A2 · Frente 1 · selección de cámara. Por defecto la trasera
  // ("environment"); si el terminal tiene varias, `camIndex` deja
  // ciclarlas. Guardamos la lista en un ref (no re-render al enumerar) y
  // exponemos sólo el contador para decidir si mostrar el botón.
  const camerasRef = useRef<MediaDeviceInfo[]>([]);
  const [cameraCount, setCameraCount] = useState(0);
  const [camIndex, setCamIndex] = useState(0);

  const stopStream = useCallback(() => {
    if (controlsRef.current) {
      controlsRef.current.stop();
      controlsRef.current = null;
    }
    const v = videoRef.current;
    if (v?.srcObject instanceof MediaStream) {
      // Belt-and-suspenders: zxing.stop() debería apagar las tracks,
      // pero hemos visto en Safari que a veces el LED se queda
      // encendido si no las paramos a mano.
      for (const t of v.srcObject.getTracks()) {
        try {
          t.stop();
        } catch {
          /* ignorar */
        }
      }
      v.srcObject = null;
    }
  }, []);

  const handleDetected = useCallback(
    (rawCode: string) => {
      // EAN-13/UPC-A/EAN-8/Code-128 siempre vienen con >=8 dígitos.
      // Filtramos cosas raras (códigos de 4 chars de QR experimentales)
      // para no provocar lookups inesperados.
      const code = rawCode.trim();
      if (code.length < 8) return;
      const now = Date.now();
      if (
        lastHitRef.current &&
        lastHitRef.current.code === code &&
        now - lastHitRef.current.at < 1200
      ) {
        return;
      }
      lastHitRef.current = { code, at: now };
      const matched = onScanned(code);
      if (matched) {
        try {
          navigator.vibrate?.(40);
        } catch {
          /* algunos navegadores tiran si la API no existe */
        }
        stopStream();
        onClose();
      } else {
        setHint(`Código ${code} no encontrado en catálogo`);
        window.setTimeout(() => setHint(null), 2500);
      }
    },
    [onClose, onScanned, stopStream],
  );

  useEffect(() => {
    let cancelled = false;
    const reader = new BrowserMultiFormatReader();
    (async () => {
      try {
        // A2 · Frente 1 · en la app Android hay que asegurar el permiso
        // NATIVO antes de abrir el stream. En navegador es no-op ("web") y
        // el propio getUserMedia gestiona su prompt. Ver platform/camera.
        const perm = await ensureCameraPermission();
        if (cancelled) return;
        if (perm === "denied") {
          setError(deniedMessage());
          return;
        }
        // Cámara elegida: si el usuario ya cicló, usamos su deviceId
        // exacto; en el arranque (lista aún vacía) pedimos la trasera por
        // facingMode — la frontal sería absurda para escanear un código.
        const selected = camerasRef.current[camIndex];
        const constraints: MediaStreamConstraints = selected?.deviceId
          ? { video: { deviceId: { exact: selected.deviceId } } }
          : { video: { facingMode: { ideal: "environment" } } };
        const controls = await reader.decodeFromConstraints(
          constraints,
          videoRef.current!,
          (result) => {
            if (!result || cancelled) return;
            handleDetected(result.getText());
          },
        );
        if (cancelled) {
          controls.stop();
          return;
        }
        controlsRef.current = controls;
        setStatus("Apunta al código de barras");
        // Enumeramos las cámaras UNA vez, ya con el stream abierto (antes
        // los labels/deviceId vienen vacíos por privacidad). Sólo para
        // decidir si ofrecer el botón "cambiar cámara".
        if (camerasRef.current.length === 0) {
          try {
            const devs = await navigator.mediaDevices.enumerateDevices();
            if (cancelled) return;
            camerasRef.current = devs.filter((d) => d.kind === "videoinput");
            setCameraCount(camerasRef.current.length);
          } catch {
            /* enumerateDevices no disponible: sin selector, sin drama. */
          }
        }
      } catch (err) {
        if (cancelled) return;
        const name = err instanceof Error ? err.name : "";
        if (name === "NotAllowedError" || name === "SecurityError") {
          setError(deniedMessage());
        } else if (name === "NotFoundError" || name === "OverconstrainedError") {
          setError("No se ha encontrado cámara trasera en este dispositivo.");
        } else {
          setError(
            err instanceof Error ? err.message : "No se pudo acceder a la cámara",
          );
        }
      }
    })();
    return () => {
      cancelled = true;
      stopStream();
    };
  }, [handleDetected, stopStream, camIndex]);

  return (
    <div className="fixed inset-0 z-[55] bg-black flex flex-col font-sans">
      <header className="h-14 flex items-center justify-between px-4 bg-black/60 text-white">
        <div className="text-[14.5px] font-medium flex items-center gap-2">
          <ScanLine className="w-5 h-5" strokeWidth={2.1} />
          Escanear código
        </div>
        <button
          onClick={() => {
            stopStream();
            onClose();
          }}
          aria-label="Cerrar escaneo"
          className="h-10 w-10 rounded-xl hover:bg-white/10 flex items-center justify-center"
        >
          <X className="w-5 h-5" />
        </button>
      </header>
      <div className="flex-1 relative overflow-hidden">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="absolute inset-0 w-full h-full object-cover"
        />
        {/* Cuadro guía centrado. NO bloquea la decodificación (zxing
            lee el frame completo) pero ayuda al usuario a centrar. */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="w-[78%] max-w-[420px] aspect-[2/1] border-2 border-white/80 rounded-2xl shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]" />
        </div>
        {/* A2 · Frente 1 · si el terminal tiene varias cámaras, permitir
            elegir. El botón cicla por la lista y reinicia el lector
            (cambia camIndex → re-corre el efecto). */}
        {cameraCount > 1 && !error && (
          <button
            onClick={() =>
              setCamIndex((i) => (i + 1) % camerasRef.current.length)
            }
            aria-label="Cambiar cámara"
            className="absolute top-3 right-3 h-10 px-3 rounded-xl bg-black/55 text-white text-[13px] flex items-center gap-1.5 hover:bg-black/70"
          >
            <SwitchCamera className="w-4 h-4" strokeWidth={2} />
            Cambiar cámara
          </button>
        )}
        <div className="absolute bottom-6 left-0 right-0 text-center text-white text-[14px] px-6">
          {error ? (
            <div className="inline-flex items-center gap-2 bg-red-600/90 px-4 py-2 rounded-xl text-[13.5px]">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          ) : hint ? (
            <div className="inline-block bg-amber-500/90 px-4 py-2 rounded-xl text-[13.5px] font-medium">
              {hint}
            </div>
          ) : (
            <div className="inline-block bg-black/55 px-4 py-2 rounded-xl text-[13.5px]">
              {status}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Utilidad para que el padre decida si mostrar o no el botón "Escanear":
// si el navegador no expone getUserMedia, ocultarlo en vez de mostrar
// un botón que siempre va a fallar.
export function hasCameraSupport(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.mediaDevices?.getUserMedia === "function"
  );
}
