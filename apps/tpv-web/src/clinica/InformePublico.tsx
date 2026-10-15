// clinica-7 · la pantalla que abre el enlace del informe. Con su clave.
//
// `/informe/<token>`. La abre el paciente desde el email, o el otro
// profesional al que se le derivó, en su móvil o en su ordenador.
//
// ── Por qué vive en la PWA del TPV, como el test de clinica-2 ────────
//
// Por lo mismo: el documento ES una pantalla, y montar un front aparte
// para dos pantallas habría sido un despliegue más que mantener. Y no hace
// falta tocar el Caddyfile — el `try_files {path} /index.html` del sitio
// de la PWA ya devuelve el index para cualquier ruta que no sea un
// fichero.
//
// Se desvía en `main.tsx`, antes de montar `App`, por lo mismo que el
// test: `App` arranca con `useDeviceBootstrap` y un móvil sin emparejar
// caería en la pantalla de pairing.
//
// ── Lo que esta pantalla NO sabe ────────────────────────────────────
//
// Ni el tipo de informe, ni el nombre del paciente, ni ningún id. El `GET`
// devuelve tres cosas: el nombre de la clínica, que hace falta una clave, y
// cuántas aperturas quedan. Si la URL se filtra sin la clave, lo que se
// filtra es el nombre de una clínica.
//
// ── Y la clave se teclea, no viaja en la URL ────────────────────────
//
// Va en el cuerpo del POST. En la URL acabaría en el historial del
// navegador, en el `Referer` de cualquier recurso que la página cargara y
// en el log de cualquier proxy — o sea, anularía lo único que la clave
// compra: que tener la URL no baste.
//
// ── El PDF se abre en una pestaña, no se descarga a ciegas ──────────
//
// `URL.createObjectURL` + `window.open`. En el móvil eso abre el visor del
// sistema, desde donde se guarda o se imprime; una descarga forzada deja
// un fichero que la persona no encuentra. Es la misma decisión que el
// `inline` de la declaración responsable.

import { useEffect, useRef, useState } from "react";
import { FileText, Loader2, Lock } from "lucide-react";

import { ApiError, apiBlobPublic, apiPublic } from "../api.js";

/** Lo que la ruta pública devuelve del enlace. Tres cosas. */
interface EnlaceAbierto {
  clinica: string;
  pideCodigo: boolean;
  aperturasRestantes: number;
}

/**
 * El token de la URL, si la ruta es la del informe.
 *
 * Mismo patrón que el servidor (43 caracteres de base64url), así que una
 * URL recortada por un cliente de correo no llega a pedirle nada a la API.
 */
export function tokenDelInformeEnLaUrl(
  pathname = window.location.pathname,
): string | null {
  const m = /^\/informe\/([A-Za-z0-9_-]{43})\/?$/.exec(pathname);
  return m?.[1] ?? null;
}

const CIFRAS = 6;

export function InformePublico({ token }: { token: string }) {
  const [estado, setEstado] = useState<
    | { kind: "cargando" }
    | { kind: "listo"; enlace: EnlaceAbierto }
    | { kind: "noSirve"; mensaje: string }
  >({ kind: "cargando" });
  const [codigo, setCodigo] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [abierto, setAbierto] = useState(false);
  const campo = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let vivo = true;
    void (async () => {
      try {
        const enlace = await apiPublic<EnlaceAbierto>(`/informe/${token}`);
        if (vivo) setEstado({ kind: "listo", enlace });
      } catch (err) {
        if (!vivo) return;
        // El mensaje lo escribe el SERVIDOR, que es el único que sabe qué
        // decir sin contarle a nadie si el token existía. Aquí no se
        // interpreta: se pinta.
        setEstado({
          kind: "noSirve",
          mensaje:
            err instanceof ApiError && err.message
              ? err.message
              : "No hemos podido abrir el documento. Inténtelo más tarde o llame a la clínica.",
        });
      }
    })();
    return () => {
      vivo = false;
    };
  }, [token]);

  // El foco en el campo en cuanto la pantalla está: lo único que hay que
  // hacer aquí es teclear seis cifras.
  useEffect(() => {
    if (estado.kind === "listo") campo.current?.focus();
  }, [estado.kind]);

  async function abrir() {
    if (codigo.length !== CIFRAS || enviando) return;
    setEnviando(true);
    setError(null);
    try {
      // `apiBlobPublic` y no `apiPublic`: un PDF leído con `res.text()`
      // llega corrupto.
      const { blob } = await apiBlobPublic(`/informe/${token}`, {
        method: "POST",
        body: { codigo },
      });
      const url = URL.createObjectURL(blob);
      // Pestaña nueva y no `location.href`: así esta pantalla se queda
      // detrás y la persona puede volver a abrirlo si cierra el visor sin
      // gastar otra apertura buscando el correo otra vez.
      window.open(url, "_blank", "noopener,noreferrer");
      setAbierto(true);
    } catch (err) {
      // LA MISMA 404 para el código erróneo, el caducado, el gastado y el
      // anulado — el servidor no los distingue a propósito, y esta
      // pantalla tampoco puede. Lo que se pinta es su mensaje.
      setError(
        err instanceof ApiError && err.message
          ? err.message
          : "No hemos podido abrir el documento. Compruebe la clave o llame a la clínica.",
      );
      setCodigo("");
      campo.current?.focus();
    } finally {
      setEnviando(false);
    }
  }

  if (estado.kind === "cargando") {
    return (
      <div className="min-h-dvh bg-mipiace-stone font-sans flex items-center justify-center gap-3 text-[18px] text-mipiace-ink-soft px-6">
        <Loader2 className="w-6 h-6 animate-spin motion-reduce:animate-none" />
        Un momento…
      </div>
    );
  }

  if (estado.kind === "noSirve") {
    // La misma pantalla para los cinco casos. Y el texto NO dice «ha
    // caducado»: dice qué hacer. En la clínica sí saben cuál es su
    // situación.
    return (
      <div className="min-h-dvh bg-mipiace-stone font-sans flex items-center justify-center px-6 py-10">
        <div className="max-w-[560px] w-full bg-white rounded-3xl border border-slate-200 px-7 py-8">
          <h1 className="text-[26px] md:text-[30px] font-semibold tracking-[-0.02em] text-mipiace-ink m-0 mb-4">
            Este enlace ya no sirve
          </h1>
          <p className="text-[18px] md:text-[20px] text-mipiace-ink-soft leading-snug m-0">
            {estado.mensaje}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-mipiace-stone font-sans flex items-center justify-center px-5 py-10">
      <div className="max-w-[560px] w-full bg-white rounded-3xl border border-slate-200 px-6 py-8 md:px-8">
        <p className="text-[15px] text-mipiace-ink-soft m-0 mb-1">
          {estado.enlace.clinica}
        </p>
        <h1 className="text-[26px] md:text-[30px] font-semibold tracking-[-0.02em] text-mipiace-ink m-0 mb-5 flex items-start gap-3">
          <Lock
            className="w-7 h-7 mt-1 shrink-0 text-mipiace-ink-soft"
            aria-hidden
          />
          Su documento está protegido con una clave
        </h1>

        <p className="text-[18px] md:text-[19px] text-mipiace-ink-soft leading-snug m-0 mb-6">
          Escriba la clave de 6 cifras que le han dado en la clínica. No va
          en el correo: se la dan en mano o por teléfono.
        </p>

        <label
          className="block text-[15px] font-medium text-mipiace-ink mb-2"
          htmlFor="codigo-informe"
        >
          Clave de 6 cifras
        </label>
        <input
          ref={campo}
          id="codigo-informe"
          // `tel` y no `number`: en el móvil abre el teclado numérico sin
          // las flechitas de incremento, y no se come los ceros de
          // delante. Un código `042318` con `number` se convierte en
          // `42318` y la persona no entiende por qué falla.
          type="tel"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={CIFRAS}
          value={codigo}
          disabled={enviando}
          onChange={(e) => {
            setCodigo(e.target.value.replace(/\D/g, "").slice(0, CIFRAS));
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") void abrir();
          }}
          // 56 px de alto y 28 px de fuente con `tracking`: se teclea con
          // el pulgar y se lee lo que se ha escrito. Es el tamaño de los
          // campos del PIN del TPV.
          className="w-full min-h-[56px] px-4 text-[28px] tracking-[0.35em] text-center font-semibold text-mipiace-ink bg-mipiace-stone border border-slate-300 rounded-2xl outline-none focus:border-mipiace-ink disabled:opacity-60"
          placeholder="······"
          aria-describedby={error ? "codigo-error" : undefined}
          aria-invalid={error != null}
        />

        {error && (
          <p
            id="codigo-error"
            role="alert"
            className="text-[17px] text-rose-700 leading-snug mt-3 mb-0"
          >
            {error}
          </p>
        )}

        <button
          type="button"
          onClick={() => void abrir()}
          disabled={codigo.length !== CIFRAS || enviando}
          className="w-full min-h-[56px] mt-6 rounded-2xl bg-mipiace-ink text-white text-[19px] font-semibold flex items-center justify-center gap-3 disabled:opacity-40"
        >
          {enviando ? (
            <Loader2 className="w-5 h-5 animate-spin motion-reduce:animate-none" />
          ) : (
            <FileText className="w-5 h-5" aria-hidden />
          )}
          {abierto ? "Volver a abrir el documento" : "Abrir el documento"}
        </button>

        {abierto && (
          <p className="text-[16px] text-mipiace-ink-soft leading-snug mt-4 mb-0">
            Se ha abierto en otra pestaña. Si no lo ve, compruebe si su
            navegador ha bloqueado la ventana.
          </p>
        )}

        <p className="text-[15px] text-mipiace-ink-soft leading-snug mt-6 mb-0">
          Es un documento confidencial: no comparta este enlace ni la clave.
          {estado.enlace.aperturasRestantes <= 1 && (
            <>
              {" "}
              <strong className="font-semibold text-mipiace-ink">
                Le queda una apertura.
              </strong>{" "}
              Si lo necesita otra vez, llame a la clínica y se lo preparan.
            </>
          )}
        </p>
      </div>
    </div>
  );
}
