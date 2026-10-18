// residencia-3 (D-64) · LA FOTO DEL RESIDENTE, o sus iniciales.
//
// La pidió Matías para el mockup: ayuda a la suplente y a quien no conoce
// a cada residente, que en una planta de 25 personas con rotación de
// turnos es media plantilla.
//
// ── Y SIN CONSENTIMIENTO, LAS INICIALES ─────────────────────────────
//
// La tablet **no sabe de consentimientos**: el arranque le dice
// `tieneFoto: true` sólo cuando hay fichero Y consentimiento de imagen
// vigente, y si lo pide igual la API contesta 404. Las dos mitades
// (`tieneFoto` y el 404) existen a propósito: la primera evita una
// petición que se sabe perdida, y la segunda es la que de verdad protege
// — porque una retirada de consentimiento a mitad de turno tiene que
// notarse sin esperar a que la tablet vuelva a arrancar.
//
// Las iniciales **ocupan el mismo hueco** que la foto. Si fueran más
// pequeñas o el hueco se colapsara, la tarjeta de quien no tiene
// consentimiento se leería distinta — y lo que distingue a esas dos
// personas no es nada que tenga que verse en un pasillo.
//
// ── El binario se pide con `fetch` y se pinta desde un blob ──────────
//
// No `<img src="/api/...">`: esa URL necesita el `X-Device-Token` en una
// cabecera y un `<img>` no manda cabeceras. Es la misma razón por la que
// `apiBlobWithCashier` existe en la clínica.

import { useEffect, useState } from "react";

import { getDeviceToken } from "../storage.js";
import { leerSesionDeGuardia } from "./guardia-cache.js";

const BASE_URL = (
  (import.meta as unknown as { env?: { VITE_API_URL?: string } }).env
    ?.VITE_API_URL ?? "/api"
).replace(/\/$/, "");

export function iniciales(nombre: string): string {
  const partes = nombre.trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return "·";
  // Nombre y primer apellido. En España el segundo apellido no ayuda a
  // reconocer a nadie de un vistazo, y tres letras en un círculo se leen
  // peor que dos.
  const primera = partes[0]![0] ?? "";
  const segunda = partes.length > 1 ? (partes[1]![0] ?? "") : "";
  return (primera + segunda).toUpperCase();
}

export interface PuertaFotoProps {
  clientId: string;
  nombre: string;
  tieneFoto: boolean;
  /** Lado del cuadrado, en px. */
  lado: number;
  /**
   * residencia-4 · de qué ruta se pide. Por defecto la de la PUERTA, que
   * sólo sirve la de los residentes de SU habitación.
   *
   * El móvil de guardia pasa la suya (`/residencia/guardia/…`), que
   * filtra por otra cosa: sólo sirve la cara de un residente que **tiene
   * un aviso vivo de su canal**. Sin eso, un móvil de guardia sería una
   * ventana a la cara de los 49 residentes del centro.
   *
   * Es un parámetro y no un componente nuevo porque lo que hay que
   * escribir una sola vez es lo de abajo: el `fetch` con cabecera (un
   * `<img src>` no manda cabeceras), el blob, las iniciales del mismo
   * tamaño y el `revokeObjectURL`.
   */
  ruta?: "puerta" | "guardia";
}

export function PuertaFoto({
  clientId,
  nombre,
  tieneFoto,
  lado,
  ruta = "puerta",
}: PuertaFotoProps) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!tieneFoto) {
      setUrl(null);
      return;
    }
    let vivo = true;
    let objectUrl: string | null = null;
    const token = getDeviceToken();
    if (!token) return;
    void (async () => {
      try {
        const res = await fetch(
          `${BASE_URL}/residencia/${ruta}/residentes/${clientId}/foto`,
          {
            headers:
              ruta === "guardia"
                ? {
                    "X-Device-Token": token,
                    // La ruta de guardia va detrás de la sesión: la foto
                    // de un residente es suya, y el móvil sólo la ve
                    // mientras alguien esté de guardia en él.
                    Authorization: `Bearer ${leerSesionDeGuardia()?.token ?? ""}`,
                  }
                : { "X-Device-Token": token },
          },
        );
        if (!res.ok || !vivo) return;
        objectUrl = URL.createObjectURL(await res.blob());
        if (vivo) setUrl(objectUrl);
      } catch {
        // Sin red no hay foto, y no es un error que haya que pintar: las
        // iniciales dicen lo mismo. La caché del navegador no sirve porque
        // la respuesta va con `Cache-Control: no-store` a propósito — una
        // cara cacheada seguiría enseñándose después de retirar el
        // consentimiento.
      }
    })();
    return () => {
      vivo = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [clientId, tieneFoto, ruta]);

  const estilo = { width: lado, height: lado };
  if (url) {
    return (
      <img
        src={url}
        alt=""
        aria-hidden="true"
        style={estilo}
        className="rounded-2xl object-cover bg-slate-100 shrink-0"
      />
    );
  }
  return (
    <div
      style={estilo}
      aria-hidden="true"
      className="rounded-2xl bg-slate-200 text-slate-500 flex items-center justify-center font-semibold shrink-0"
    >
      {/* Las iniciales a un tercio del lado: se leen de pie, a un metro, y
          el círculo no parece un botón. */}
      <span style={{ fontSize: Math.round(lado / 3) }}>
        {iniciales(nombre)}
      </span>
    </div>
  );
}
