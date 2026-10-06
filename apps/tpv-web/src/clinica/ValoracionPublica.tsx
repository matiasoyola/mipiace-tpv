// clinica-2 · la pantalla que abre el enlace. Y la de la tablet.
//
// LAS DOS PUERTAS ENTRAN POR AQUÍ. La URL es `/valoracion/<token>` en los
// dos casos:
//
//   · el paciente la abre desde el email, en su móvil;
//   · la tablet de la sala navega a ella con un token de cuatro horas que
//     le acaba de dar `POST /clinica/clients/:id/valoracion/tablet`.
//
// Lo que las distingue es el `canal` que devuelve la propia API (del
// token), y lo único que cambia es la despedida. Un solo test, dos
// puertas, una sola ruta y una sola forma de caducar.
//
// ── Por qué vive en la PWA del TPV y no en una página del servidor ────
//
// Porque el test ES una pantalla, y es LA MISMA que la de la tablet. Una
// página servida por Fastify habría obligado a escribir el test dos veces
// (una en HTML y otra en React) o a renunciar a la tablet.
//
// Y no hace falta tocar el Caddyfile: el `try_files {path} /index.html`
// del sitio de la PWA ya devuelve el `index.html` para cualquier ruta que
// no sea un fichero, así que `/valoracion/<token>` llega a React. La
// llamada a la API va por `/api/valoracion/<token>`, que `handle_path
// /api/*` proxea al backend.
//
// ── Sin sesión, sin device, sin nada ──────────────────────────────────
//
// `apiPublic`: ni `X-Device-Token` ni `Authorization`. El paciente no es
// un usuario del sistema y su móvil no es un terminal emparejado. La
// credencial es la URL.

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import type {
  CanalValoracion,
  Cuestionario,
} from "@mipiacetpv/clinica-valoracion";

import { ApiError, apiPublic } from "../api.js";
import { TestPaciente, type RespuestasDelTest } from "./TestPaciente.js";

/** Lo que la ruta pública devuelve. TRES cosas y nada más: ni una
 *  respuesta, ni una alerta, ni el apellido del paciente. */
interface TestAbierto {
  clinica: string;
  nombrePila: string;
  canal: CanalValoracion;
  cuestionario: Cuestionario;
}

/**
 * El token de la URL, si la ruta es la del test.
 *
 * Se lee del `pathname` y se valida contra el mismo patrón que el
 * servidor (43 caracteres de base64url). Así una URL recortada por un
 * cliente de correo no llega a pedirle nada a la API.
 */
export function tokenDeLaUrl(pathname = window.location.pathname): string | null {
  const m = /^\/valoracion\/([A-Za-z0-9_-]{43})\/?$/.exec(pathname);
  return m?.[1] ?? null;
}

export function ValoracionPublica({ token }: { token: string }) {
  const [estado, setEstado] = useState<
    | { kind: "cargando" }
    | { kind: "listo"; test: TestAbierto }
    | { kind: "noSirve"; mensaje: string }
  >({ kind: "cargando" });

  useEffect(() => {
    let vivo = true;
    void (async () => {
      try {
        const test = await apiPublic<TestAbierto>(`/valoracion/${token}`);
        if (vivo) setEstado({ kind: "listo", test });
      } catch (err) {
        if (!vivo) return;
        // El mensaje lo escribe el SERVIDOR, que es el único que sabe qué
        // decirle sin contarle a nadie más si el token existía. Aquí no se
        // interpreta: se pinta.
        setEstado({
          kind: "noSirve",
          mensaje:
            err instanceof ApiError && err.message
              ? err.message
              : "No hemos podido abrir sus preguntas. Inténtelo más tarde o llame a la clínica.",
        });
      }
    })();
    return () => {
      vivo = false;
    };
  }, [token]);

  if (estado.kind === "cargando") {
    return (
      <div className="min-h-dvh bg-mipiace-stone font-sans flex items-center justify-center gap-3 text-[18px] text-mipiace-ink-soft px-6">
        <Loader2 className="w-6 h-6 animate-spin motion-reduce:animate-none" />
        Un momento…
      </div>
    );
  }

  if (estado.kind === "noSirve") {
    // La misma pantalla para «no existe», «caducado» y «ya usado»: el
    // servidor contesta lo mismo en los tres casos a propósito (tres
    // respuestas distintas le dirían a un escáner que el token existía), y
    // esta pantalla no puede ni debe adivinar cuál era.
    //
    // Y por eso el texto NO dice «su enlace ha caducado»: dice qué hacer.
    // En la clínica sí saben cuál es su situación, y allí puede contestarlo
    // en la tablet.
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
    <TestPaciente
      clinica={estado.test.clinica}
      nombrePila={estado.test.nombrePila}
      canal={estado.test.canal}
      cuestionario={estado.test.cuestionario}
      onEnviar={async (r: RespuestasDelTest) => {
        try {
          await apiPublic(`/valoracion/${token}`, {
            method: "POST",
            body: {
              respuestas: r.respuestas,
              detalles: r.detalles,
              respondioPor: r.respondioPor,
            },
          });
          return null;
        } catch (err) {
          // El mensaje del servidor, que está escrito para esta persona.
          // Y nunca una excepción cruda: «Request failed» delante de un
          // paciente de 78 años es una pantalla rota.
          return err instanceof ApiError && err.message
            ? err.message
            : "No hemos podido guardar sus respuestas. Inténtelo otra vez; si sigue, llame a la clínica.";
        }
      }}
    />
  );
}
