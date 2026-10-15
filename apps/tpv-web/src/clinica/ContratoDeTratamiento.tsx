// clinica-7 · EL CONTRATO DE TRATAMIENTO DE DATOS, EN PANTALLA.
//
// Tres piezas, y las tres se deciden con el MISMO estado que la API usa
// para contestar:
//
//   `PantallaDeAceptacion`  lo que la dueña ve cuando falta aceptarlo, con
//                           el texto entero y el botón. Y lo que el resto
//                           ve: el aviso de la decisión 2, sin botón.
//   `BandaDeSoloLectura`    la banda fija de las pantallas clínicas cuando
//                           el contrato no está vigente.
//   `SeccionDelContrato`    la sección del panel del propietario: versión
//                           vigente, quién la aceptó y cuándo, el PDF de
//                           cada versión y el botón de revocar.
//
// ── Nada se decide aquí ─────────────────────────────────────────────
//
// El estado lo calcula `@mipiacetpv/contrato-encargado` —la MISMA función
// pura que usa la API— sobre lo que devuelve `GET /clinica/contrato`. Esta
// pantalla no mira versiones ni revocaciones: pregunta al paquete.
//
// Es la razón entera por la que el paquete existe. Con un `if` propio
// aquí, el día que cambie la regla la pantalla diría «puedes escribir»
// sobre algo que el servidor considera revocado — y la podóloga estaría
// escribiendo una sesión que se va a rechazar con la paciente delante.
//
// Y `puedeAceptar` lo decide el SERVIDOR (comprobando el rol en la base,
// no en el token) y viaja en la respuesta: así el botón y la ruta no
// pueden discrepar sobre quién acepta.
//
// ── El texto NO está en este fichero ────────────────────────────────
//
// Llega en la respuesta, desde el paquete versionado. Misma regla que la
// declaración responsable y que las plantillas de consentimiento: un texto
// dentro de una pantalla es un texto que nadie versiona, del que no se
// puede sacar una huella y del que no sale un PDF igual al que se aceptó.

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import {
  AlertTriangle,
  Check,
  Download,
  Loader2,
  Lock,
  ShieldCheck,
} from "lucide-react";

import {
  AVISO_SOLO_LA_DUENA,
  BANDA_SOLO_LECTURA,
  permiteEscribirHistoria,
  type EstadoDelModuloClinico,
} from "@mipiacetpv/contrato-encargado";

import { ApiError, apiBlobWithCashier, apiWithCashier } from "../api.js";

// ── Lo que la API devuelve ──────────────────────────────────────────

export interface AceptacionEnPantalla {
  id: string;
  version: number;
  huella: string;
  aceptadoEn: string;
  quien: string;
  aparato: string | null;
  revocado: boolean;
  revocadoEn: string | null;
  revocadoPor: string | null;
  textoDisponible: boolean;
}

export interface VistaDelContrato {
  estado: EstadoDelModuloClinico;
  versionVigente: number;
  pendienteDeValidar: boolean;
  titulo: string;
  apartados: readonly { encabezado: string; parrafos: readonly string[] }[];
  huellaVigente: string;
  aceptaciones: readonly AceptacionEnPantalla[];
  puedeAceptar: boolean;
}

/** Carga la vista del contrato. `null` mientras va, y el error si falla. */
export function useContrato(): {
  vista: VistaDelContrato | null;
  error: string | null;
  recargar: () => void;
} {
  const [vista, setVista] = useState<VistaDelContrato | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let vivo = true;
    void (async () => {
      try {
        const v = await apiWithCashier<VistaDelContrato>("/clinica/contrato");
        if (vivo) {
          setVista(v);
          setError(null);
        }
      } catch (err) {
        if (!vivo) return;
        // Un 404 aquí significa «este negocio no tiene el módulo»: no es un
        // error que enseñar, es que la sección no existe.
        if (err instanceof ApiError && err.status === 404) {
          setVista(null);
          setError(null);
          return;
        }
        setError(
          err instanceof ApiError && err.message
            ? err.message
            : "No se ha podido cargar el contrato. Reintenta; si sigue, avisa a Mi Piace.",
        );
      }
    })();
    return () => {
      vivo = false;
    };
  }, [tick]);

  return { vista, error, recargar: useCallback(() => setTick((t) => t + 1), []) };
}

const fecha = (iso: string) =>
  new Date(iso).toLocaleString("es-ES", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

// ── 1 · LA BANDA DE SOLO LECTURA ────────────────────────────────────

/**
 * La banda fija de las pantallas clínicas cuando el contrato no está
 * vigente. Decisión 5, con el texto del paquete palabra por palabra.
 *
 * Devuelve `null` cuando no toca, así que las pantallas la ponen arriba
 * sin preguntar nada.
 */
export function BandaDeSoloLectura({
  estado,
}: {
  estado: EstadoDelModuloClinico | null | undefined;
}) {
  if (estado?.estado !== "SOLO_LECTURA") return null;
  return (
    <div
      role="status"
      // Ámbar y no rojo: no es un error, es un estado. El rojo de esta
      // casa es la franja de alertas clínicas, y una banda roja aquí le
      // quitaría fuerza a aquélla.
      className="flex items-start gap-3 px-4 py-3 bg-amber-50 border-b border-amber-200 text-[16px] text-amber-900 leading-snug"
    >
      <Lock className="w-5 h-5 mt-0.5 shrink-0" aria-hidden />
      <span>
        <strong className="font-semibold">{BANDA_SOLO_LECTURA}</strong>{" "}
        {estado.motivo === "VERSION_ANTIGUA"
          ? "Hay una versión nueva del contrato sin aceptar."
          : "La dueña lo revocó."}{" "}
        Se puede leer, imprimir y exportar todo; no se puede escribir nada
        nuevo.
      </span>
    </div>
  );
}

// ── 2 · LA PANTALLA DE ACEPTACIÓN ───────────────────────────────────

/**
 * Lo que se ve con el contrato SIN ACEPTAR.
 *
 * Dos caras, y las decide `puedeAceptar` del servidor:
 *
 *   · la dueña ve el texto entero y el botón;
 *   · el encargado, los cajeros y los sanitarios ven el aviso de la
 *     decisión 2 y **no** el texto. No es secreto —está en el repo— pero
 *     ponerles delante nueve apartados de contrato que no pueden aceptar
 *     es pedirles que lean algo que no es suyo.
 */
export function PantallaDeAceptacion({
  vista,
  onAceptado,
}: {
  vista: VistaDelContrato;
  onAceptado: () => void;
}) {
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [leido, setLeido] = useState(false);

  if (!vista.puedeAceptar) {
    return (
      <div className="min-h-dvh bg-mipiace-stone flex items-center justify-center px-5 py-10">
        <div className="max-w-[560px] w-full bg-white rounded-3xl border border-slate-200 px-6 py-8">
          <h1 className="text-[24px] md:text-[28px] font-semibold tracking-[-0.02em] text-mipiace-ink m-0 mb-4 flex items-start gap-3">
            <Lock className="w-7 h-7 mt-1 shrink-0 text-mipiace-ink-soft" aria-hidden />
            La historia clínica todavía no está activa
          </h1>
          <p className="text-[18px] text-mipiace-ink-soft leading-snug m-0">
            {AVISO_SOLO_LA_DUENA}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-mipiace-stone px-5 py-8 md:py-10">
      <div className="max-w-[760px] mx-auto">
        <h1 className="text-[26px] md:text-[32px] font-semibold tracking-[-0.02em] text-mipiace-ink m-0 mb-2">
          {vista.titulo}
        </h1>
        <p className="text-[15px] text-mipiace-ink-soft m-0 mb-6">
          Versión {vista.versionVigente}
        </p>

        {/* El aviso de texto pendiente va ARRIBA y no en el pie: lo que
            dice es «no se lo des a un abogado como si estuviera
            revisado», y eso se lee antes del texto. */}
        {vista.pendienteDeValidar && (
          <div
            role="status"
            className="flex items-start gap-3 px-4 py-3 mb-6 bg-amber-50 border border-amber-200 rounded-2xl text-[16px] text-amber-900 leading-snug"
          >
            <AlertTriangle className="w-5 h-5 mt-0.5 shrink-0" aria-hidden />
            <span>
              <strong className="font-semibold">
                Este texto es de ejemplo y está pendiente de que lo revise un
                abogado.
              </strong>{" "}
              Lo puedes aceptar para empezar a usar la historia clínica, y
              cuando llegue el texto definitivo te pediremos aceptar la
              versión nueva.
            </span>
          </div>
        )}

        <div className="bg-white rounded-3xl border border-slate-200 px-5 py-6 md:px-7">
          {vista.apartados.map((a) => (
            <section key={a.encabezado} className="mb-6 last:mb-0">
              <h2 className="text-[18px] md:text-[19px] font-semibold text-mipiace-ink m-0 mb-2">
                {a.encabezado}
              </h2>
              {a.parrafos.map((p, i) => (
                <p
                  key={i}
                  className="text-[16px] md:text-[17px] text-mipiace-ink-soft leading-relaxed m-0 mb-3 last:mb-0"
                >
                  {p}
                </p>
              ))}
            </section>
          ))}
        </div>

        {/* La huella, debajo del texto: es lo que demuestra QUÉ se aceptó,
            y la fila que se escribe guarda ésta misma. */}
        <p className="text-[13px] text-mipiace-ink-soft break-all mt-4 mb-0">
          Huella del texto (SHA-256): {vista.huellaVigente}
        </p>

        <label className="flex items-start gap-3 mt-7 text-[17px] text-mipiace-ink leading-snug cursor-pointer">
          <input
            type="checkbox"
            checked={leido}
            onChange={(e) => setLeido(e.target.checked)}
            // 24 px: se marca con el dedo en la tablet.
            className="w-6 h-6 mt-0.5 shrink-0 accent-mipiace-ink"
          />
          <span>
            He leído el contrato y lo acepto en nombre del centro.
          </span>
        </label>

        {error && (
          <p role="alert" className="text-[17px] text-rose-700 leading-snug mt-4 mb-0">
            {error}
          </p>
        )}

        <button
          type="button"
          disabled={!leido || enviando}
          onClick={() => {
            void (async () => {
              setEnviando(true);
              setError(null);
              try {
                await apiWithCashier("/clinica/contrato/aceptar", {
                  method: "POST",
                  body: {},
                });
                onAceptado();
              } catch (err) {
                setError(
                  err instanceof ApiError && err.message
                    ? err.message
                    : "No se ha podido aceptar. Reintenta; si sigue, avisa a Mi Piace.",
                );
              } finally {
                setEnviando(false);
              }
            })();
          }}
          className="w-full md:w-auto min-h-[56px] px-7 mt-6 rounded-2xl bg-mipiace-ink text-white text-[19px] font-semibold flex items-center justify-center gap-3 disabled:opacity-40"
        >
          {enviando ? (
            <Loader2 className="w-5 h-5 animate-spin motion-reduce:animate-none" />
          ) : (
            <Check className="w-5 h-5" aria-hidden />
          )}
          Aceptar y activar la historia clínica
        </button>

        <p className="text-[15px] text-mipiace-ink-soft leading-snug mt-4 mb-0">
          Al aceptar queda registrado quién lo acepta, cuándo y desde qué
          aparato. Esa anotación no se puede editar ni borrar.
        </p>
      </div>
    </div>
  );
}

// ── 3 · LA SECCIÓN DEL PANEL ────────────────────────────────────────

/**
 * «Contrato de tratamiento de datos» en el panel del propietario.
 *
 * Decisión 6: versión vigente, cuándo y quién la aceptó, el PDF de cada
 * versión aceptada (para descargar SIEMPRE) y el botón «Revocar» con una
 * confirmación que explica las consecuencias.
 *
 * Las revocaciones NO salen como filas propias: marcan su aceptación. Dos
 * líneas por el mismo contrato se leerían como dos contratos — misma
 * decisión que las revocaciones de consentimiento de clinica-4.
 */
export function SeccionDelContrato() {
  const { vista, error, recargar } = useContrato();
  const [confirmando, setConfirmando] = useState(false);
  const [revocando, setRevocando] = useState(false);
  const [errorAccion, setErrorAccion] = useState<string | null>(null);

  if (error) {
    return (
      <p role="alert" className="text-[17px] text-rose-700 leading-snug">
        {error}
      </p>
    );
  }
  if (!vista) {
    return (
      <div className="flex items-center gap-3 text-[17px] text-mipiace-ink-soft">
        <Loader2 className="w-5 h-5 animate-spin motion-reduce:animate-none" />
        Cargando…
      </div>
    );
  }

  const vigente = vista.estado.estado === "VIGENTE";

  return (
    <section>
      <h2 className="text-[22px] md:text-[26px] font-semibold tracking-[-0.02em] text-mipiace-ink m-0 mb-1">
        Contrato de tratamiento de datos
      </h2>
      <p className="text-[16px] text-mipiace-ink-soft leading-snug m-0 mb-5">
        Es el contrato por el que Mi Piace puede guardar la historia clínica
        de tus pacientes (art. 28 del RGPD).
      </p>

      {/* El estado, de un vistazo. */}
      <div
        className={`flex items-start gap-3 px-4 py-3 rounded-2xl border text-[17px] leading-snug mb-6 ${
          vigente
            ? "bg-emerald-50 border-emerald-200 text-emerald-900"
            : "bg-amber-50 border-amber-200 text-amber-900"
        }`}
      >
        {vigente ? (
          <ShieldCheck className="w-5 h-5 mt-0.5 shrink-0" aria-hidden />
        ) : (
          <AlertTriangle className="w-5 h-5 mt-0.5 shrink-0" aria-hidden />
        )}
        <span>
          {vista.estado.estado === "VIGENTE" && (
            <>
              <strong className="font-semibold">Vigente.</strong> La historia
              clínica funciona con normalidad.
            </>
          )}
          {vista.estado.estado === "SIN_CONTRATO" && (
            <>
              <strong className="font-semibold">Sin aceptar.</strong> Hasta
              que lo aceptes, la historia clínica no se puede usar.
            </>
          )}
          {vista.estado.estado === "SOLO_LECTURA" && (
            <>
              <strong className="font-semibold">Solo lectura.</strong>{" "}
              {vista.estado.motivo === "REVOCADO"
                ? "Está revocado."
                : "Hay una versión nueva sin aceptar."}{" "}
              Se puede leer, imprimir y exportar todo; no se puede escribir
              nada nuevo.
            </>
          )}
          {vista.estado.estado === "APAGADO" && (
            <>
              <strong className="font-semibold">Módulo apagado.</strong>
            </>
          )}
        </span>
      </div>

      {/* El historial. Una fila por ACEPTACIÓN, con su revocación al lado
          si la hay. */}
      {vista.aceptaciones.length === 0 ? (
        <p className="text-[17px] text-mipiace-ink-soft m-0 mb-6">
          Todavía no se ha aceptado ninguna versión.
        </p>
      ) : (
        <ul className="list-none p-0 m-0 mb-6 flex flex-col gap-3">
          {vista.aceptaciones.map((a) => (
            <li
              key={a.id}
              className="bg-white rounded-2xl border border-slate-200 px-4 py-4"
            >
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="text-[18px] font-semibold text-mipiace-ink">
                  Versión {a.version}
                </span>
                {a.revocado ? (
                  <span className="text-[15px] font-medium text-amber-800 bg-amber-50 border border-amber-200 rounded-full px-2.5 py-0.5">
                    Revocado
                  </span>
                ) : (
                  <span className="text-[15px] font-medium text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-full px-2.5 py-0.5">
                    En vigor
                  </span>
                )}
              </div>
              <p className="text-[16px] text-mipiace-ink-soft leading-snug m-0 mt-2">
                Aceptado por {a.quien} el {fecha(a.aceptadoEn)}
                {a.aparato ? ` desde ${a.aparato}` : ""}.
              </p>
              {a.revocado && a.revocadoEn && (
                <p className="text-[16px] text-mipiace-ink-soft leading-snug m-0 mt-1">
                  Revocado por {a.revocadoPor} el {fecha(a.revocadoEn)}.
                </p>
              )}
              <p className="text-[13px] text-mipiace-ink-soft break-all m-0 mt-2">
                Huella: {a.huella}
              </p>
              {a.textoDisponible ? (
                <button
                  type="button"
                  onClick={() => {
                    void (async () => {
                      try {
                        const { blob } = await apiBlobWithCashier(
                          `/clinica/contrato/${a.version}.pdf`,
                        );
                        window.open(
                          URL.createObjectURL(blob),
                          "_blank",
                          "noopener,noreferrer",
                        );
                      } catch {
                        setErrorAccion(
                          "No se ha podido abrir el PDF. Reintenta; si sigue, avisa a Mi Piace.",
                        );
                      }
                    })();
                  }}
                  className="min-h-[48px] px-4 mt-3 rounded-xl border border-slate-300 text-[17px] font-medium text-mipiace-ink flex items-center gap-2"
                >
                  <Download className="w-5 h-5" aria-hidden />
                  Descargar el PDF
                </button>
              ) : (
                // Una versión que este despliegue ya no sabe enseñar. Se
                // dice, y se deja la huella y la fecha, que es verdad.
                <p className="text-[15px] text-mipiace-ink-soft leading-snug m-0 mt-3">
                  Este programa ya no tiene el texto de esta versión. Lo que
                  demuestra qué se aceptó es su huella y su fecha.
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      {errorAccion && (
        <p role="alert" className="text-[17px] text-rose-700 leading-snug mb-4">
          {errorAccion}
        </p>
      )}

      {/* Revocar, con la confirmación que explica QUÉ pasa. */}
      {vigente && !confirmando && (
        <button
          type="button"
          onClick={() => setConfirmando(true)}
          className="min-h-[48px] px-4 rounded-xl border border-rose-300 text-[17px] font-medium text-rose-800"
        >
          Revocar el contrato
        </button>
      )}

      {confirmando && (
        <div className="bg-white rounded-2xl border border-rose-200 px-5 py-5">
          <h3 className="text-[19px] font-semibold text-mipiace-ink m-0 mb-3">
            ¿Revocar el contrato de tratamiento de datos?
          </h3>
          <ul className="list-disc pl-5 m-0 mb-4 text-[17px] text-mipiace-ink-soft leading-snug flex flex-col gap-1.5">
            <li>
              La historia clínica pasa a <strong>solo lectura</strong>: se
              puede leer, imprimir y exportar todo lo que ya hay.
            </li>
            <li>
              <strong>No se podrá escribir nada clínico nuevo</strong>: ni
              sesiones, ni fotos, ni valoraciones, ni consentimientos.
            </li>
            <li>
              Las citas nuevas no admitirán notas escritas a mano: solo hora,
              paciente y servicio.
            </li>
            <li>La agenda y la caja siguen funcionando igual.</li>
            <li>
              Puedes volver a aceptarlo cuando quieras y todo vuelve a la
              normalidad.
            </li>
          </ul>
          <div className="flex flex-col sm:flex-row gap-3">
            <button
              type="button"
              disabled={revocando}
              onClick={() => {
                void (async () => {
                  setRevocando(true);
                  setErrorAccion(null);
                  try {
                    await apiWithCashier("/clinica/contrato/revocar", {
                      method: "POST",
                    });
                    setConfirmando(false);
                    recargar();
                  } catch (err) {
                    setErrorAccion(
                      err instanceof ApiError && err.message
                        ? err.message
                        : "No se ha podido revocar. Reintenta; si sigue, avisa a Mi Piace.",
                    );
                  } finally {
                    setRevocando(false);
                  }
                })();
              }}
              className="min-h-[48px] px-5 rounded-xl bg-rose-700 text-white text-[17px] font-semibold flex items-center justify-center gap-2 disabled:opacity-40"
            >
              {revocando && (
                <Loader2 className="w-5 h-5 animate-spin motion-reduce:animate-none" />
              )}
              Sí, revocarlo
            </button>
            <button
              type="button"
              disabled={revocando}
              onClick={() => setConfirmando(false)}
              className="min-h-[48px] px-5 rounded-xl border border-slate-300 text-[17px] font-medium text-mipiace-ink"
            >
              No, dejarlo como está
            </button>
          </div>
        </div>
      )}

      {/* Y la devolución de datos, aquí al lado: es lo que se hace cuando
          se termina con Mi Piace, y es del contrato y no de la historia. */}
      <div className="mt-8 pt-6 border-t border-slate-200">
        <h3 className="text-[19px] font-semibold text-mipiace-ink m-0 mb-2">
          Llevarte todas las historias
        </h3>
        <p className="text-[16px] text-mipiace-ink-soft leading-snug m-0 mb-4">
          Descarga un paquete con la historia completa de cada paciente en
          PDF, sus fotos, sus consentimientos y un fichero con todos los
          datos. Funciona también con el contrato revocado, y queda
          registrado.
        </p>
        <button
          type="button"
          onClick={() => {
            void (async () => {
              setErrorAccion(null);
              try {
                const { blob } = await apiBlobWithCashier(
                  "/clinica/exportacion",
                );
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `historias-${new Date().toISOString().slice(0, 10)}.zip`;
                a.click();
                URL.revokeObjectURL(url);
              } catch (err) {
                setErrorAccion(
                  err instanceof ApiError && err.message
                    ? err.message
                    : "No se ha podido preparar el paquete. Avisa a Mi Piace.",
                );
              }
            })();
          }}
          className="min-h-[48px] px-4 rounded-xl border border-slate-300 text-[17px] font-medium text-mipiace-ink flex items-center gap-2"
        >
          <Download className="w-5 h-5" aria-hidden />
          Descargar todas las historias
        </button>
      </div>
    </section>
  );
}

// ── 4 · LA GUARDA, que es lo que las pantallas clínicas usan ────────

/**
 * Envuelve una pantalla clínica y decide qué se ve, con el MISMO estado
 * que la API usa para contestar:
 *
 *   `SIN_CONTRATO`  → la pantalla de aceptación (o el aviso), y la
 *                     pantalla de dentro **no se monta**: no tiene datos
 *                     que pintar porque la API no los da.
 *   `SOLO_LECTURA`  → la banda arriba y la pantalla debajo.
 *   `VIGENTE`       → la pantalla, tal cual.
 *   `APAGADO`       → la pantalla, tal cual. Un tenant sin el módulo no
 *                     llega aquí (el botón no se pinta), y si llegara la
 *                     API contesta 404.
 *
 * ── Por qué una guarda y no un `if` en cada pantalla ───────────────
 *
 * Por la razón de `conHistoria` en la API: hoy hay tres pantallas clínicas
 * y vendrán más, y la cuarta la escribirá alguien con prisa. Con la guarda,
 * una pantalla clínica nueva nace respetando el contrato envolviéndose, y
 * el que se olvide lo ve en cuanto la abre con el contrato revocado.
 *
 * Mientras carga NO se pinta nada de la historia: enseñarla y tacharla
 * medio segundo después es peor que esperar medio segundo.
 */
export function GuardaDelContrato({
  children,
}: {
  children: React.ReactNode;
}) {
  const { vista, recargar } = useContrato();

  // ── FALLA ABIERTA, y es deliberado ────────────────────────────────
  //
  // Sin un estado de contrato LEGIBLE —porque está cargando, porque este
  // negocio no tiene el módulo (404), o porque la petición falló— se pinta
  // lo de dentro.
  //
  // Puede sonar al revés de todo lo demás de este bloque, y no lo es: **la
  // autorización no está aquí**. Está en `conHistoria`, que contesta 423
  // a cualquier lectura o escritura clínica sin contrato vigente, y en el
  // gate, que contesta 404 sin el módulo. Esta guarda es la mitad que
  // AYUDA: enseña la pantalla de aceptación en vez de un 423 crudo, y la
  // banda en vez de que la podóloga descubra el bloqueo al pulsar
  // «Cerrar».
  //
  // Fallar cerrada aquí sería dejar a la podóloga sin pantalla por una
  // petición que no respondió, con la paciente delante, mientras la
  // historia se puede leer perfectamente. Es la misma dirección del fallo
  // que `puedeVerImportes` de clinica-3: «la pantalla ayuda, la ruta
  // garantiza».
  //
  // Y la comprobación es de FORMA (`vista?.estado?.estado`) y no solo de
  // presencia: lo encontró la suite de pantallas, que mockea la API y le
  // devolvía a esta guarda la respuesta de la historia. Una guarda que
  // asume la forma de lo que le llega es una guarda que revienta la
  // pantalla el día que la ruta cambie.
  const estado = vista?.estado?.estado;
  if (estado == null) return <>{children}</>;

  if (estado === "SIN_CONTRATO") {
    return <PantallaDeAceptacion vista={vista!} onAceptado={recargar} />;
  }

  return (
    <ContextoDelContrato.Provider value={vista!.estado}>
      <BandaDeSoloLectura estado={vista!.estado} />
      {children}
    </ContextoDelContrato.Provider>
  );
}

// ── Lo que las pantallas de dentro preguntan ────────────────────────
//
// El estado que la guarda ya ha traído, para que lo de dentro no vuelva a
// pedirlo. Una pantalla clínica que necesitara saber si se puede escribir
// y llamara otra vez a `/clinica/contrato` sería una segunda petición por
// pantalla y, peor, una segunda respuesta que puede discrepar de la que
// decidió la banda.
const ContextoDelContrato = createContext<EstadoDelModuloClinico | null>(null);

/**
 * ¿Se puede escribir en la historia?
 *
 * **Sin contexto devuelve `true`**, por lo mismo que la guarda falla
 * abierta: la autorización está en `conHistoria`, que contesta 423, y esto
 * es la mitad que AYUDA — esconder el botón que no va a poder cumplir.
 * Devolver `false` sin saberlo dejaría a la podóloga sin «Nueva visita» por
 * una petición que no respondió.
 *
 * Lo encontró el bucle visual del bloque: con el contrato revocado, la
 * banda decía «no se puede escribir nada nuevo» y justo debajo seguía el
 * botón «Nueva visita», en negro y encendido. Media hora de sesión para un
 * 423 al cerrarla.
 */
export function useSePuedeEscribirHistoria(): boolean {
  const estado = useContext(ContextoDelContrato);
  return estado == null ? true : permiteEscribirHistoria(estado);
}
