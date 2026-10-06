// clinica-2 · EL TEST DEL PACIENTE. Un solo componente, dos puertas.
//
// Lo pinta el enlace del email (en el móvil de la paciente) y lo pinta la
// tablet de la sala. Es el MISMO componente porque es el mismo test: con
// dos, el día que se añada una pregunta o se cambie un texto habría que
// acordarse de los dos, y el que se olvidara enseñaría otra cosa a la
// mitad de los pacientes.
//
// Lo único que cambia entre las dos puertas es el texto de despedida («ya
// puede cerrar esta página» / «puede devolver la tablet en el mostrador»),
// y eso entra como un `canal`.
//
// ── Está escrito para una persona de 78 años ──────────────────────────
//
// Decisión de producto 4 (Matías, 05-10-2026), y cada punto tiene su
// consecuencia en este fichero:
//
//   · **Una pregunta por pantalla.** No hay scroll, no hay un formulario
//     de diez filas donde perderse, y al tocar «Sí» se avanza solo. Nada
//     que se pueda dejar a medias por no ver el final.
//   · **Letra grande.** La pregunta a 38 px (28 en móvil). El mockup
//     validado lo fija y no se negocia hacia abajo.
//   · **«Sí» / «No» enormes**, 96 px (80 en móvil), fuera de la escala
//     táctil de la casa y con token propio (`tap-valoracion`, ver
//     `docs/design/tokens.md` §4).
//   · **«No lo sé» SIEMPRE disponible.** Es la decisión más importante de
//     esta pantalla: un mayor que no sabe si toma anticoagulantes tiene
//     que poder decirlo en vez de adivinar. Si no estuviera, la mitad
//     contestaría «No» por no quedar mal — y un «No» inventado es peor que
//     un «No lo sé», porque la podóloga no sabe que tiene que preguntarlo.
//   · **Palabras de la calle.** Los textos salen del cuestionario
//     versionado (`@mipiacetpv/clinica-valoracion`), no de aquí.
//   · **Sin contraseñas.** La URL es la credencial. Pedirle una cuenta a
//     esta persona es que no contesta.
//
// ── Y «Atrás» existe ──────────────────────────────────────────────────
//
// Porque se toca mal. Avanzar solo al contestar es lo que hace el test
// rápido, y el precio es que un dedo que resbala pasa de pregunta: sin
// «Atrás», ese error se queda en una historia clínica.

import { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";

import {
  preguntasEnJuego,
  type CanalValoracion,
  type Cuestionario,
  type Pregunta,
  type RespondioPor,
  type Respuesta,
} from "@mipiacetpv/clinica-valoracion";

export interface RespuestasDelTest {
  respuestas: Record<string, Respuesta>;
  detalles: Record<string, string[]>;
  respondioPor: RespondioPor;
}

export interface TestPacienteProps {
  clinica: string;
  nombrePila: string;
  cuestionario: Cuestionario;
  canal: CanalValoracion;
  /** Manda las respuestas. Resuelve con `null` si todo fue bien, o con un
   *  mensaje para la persona si no se pudieron guardar. */
  onEnviar: (r: RespuestasDelTest) => Promise<string | null>;
}

/** Los pasos, en el orden en que se ven.
 *
 * `guardando` y `gracias` son DOS pasos y no uno, y eso lo encontró el
 * banco de pruebas con navegador: la primera versión pintaba «Gracias, ya
 * está» en cuanto se contestaba la última pregunta y mandaba las
 * respuestas en segundo plano. El capítulo 11 leyó la base justo después
 * de ver «Ya está» y la valoración seguía PENDIENTE.
 *
 * Como fallo de test era una carrera; como producto era peor: **a una
 * persona de 78 años se le estaba diciendo que había terminado antes de
 * que sus respuestas estuvieran guardadas.** Si cierra la página en ese
 * instante —y la pantalla la invita a cerrarla— pierde el test y cree que
 * lo hizo. Ahora no se le dice «ya está» hasta que el servidor lo
 * confirma. */
type Paso =
  | { tipo: "bienvenida" }
  | { tipo: "quien" }
  | { tipo: "pregunta"; pregunta: Pregunta; indice: number }
  | { tipo: "detalle"; pregunta: Pregunta; indice: number }
  | { tipo: "guardando" }
  | { tipo: "gracias" };

export function TestPaciente(props: TestPacienteProps) {
  const total = props.cuestionario.preguntas.length;

  const [respuestas, setRespuestas] = useState<Record<string, Respuesta>>({});
  const [detalles, setDetalles] = useState<Record<string, string[]>>({});
  const [respondioPor, setRespondioPor] = useState<RespondioPor | null>(null);
  const [paso, setPaso] = useState<Paso>({ tipo: "bienvenida" });
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Las preguntas que están EN JUEGO con lo contestado hasta ahora. Se
  // recalcula en cada respuesta porque el seguimiento de la insulina
  // aparece y desaparece según la diabetes, y la cuenta de «Pregunta N de
  // 10» no puede bailar: cuenta las PRINCIPALES, que son siempre diez. El
  // seguimiento se pinta con el mismo número que su madre, que es cómo lo
  // hace el mockup.
  const enJuego = useMemo(
    () => preguntasEnJuego(props.cuestionario, (id) => respuestas[id]),
    [props.cuestionario, respuestas],
  );

  /** El índice de la pregunta PRINCIPAL a la que pertenece ésta. */
  function numeroDe(pregunta: Pregunta): number {
    const i = props.cuestionario.preguntas.findIndex(
      (p) => p.id === pregunta.id || p.seguimiento?.id === pregunta.id,
    );
    return i + 1;
  }

  function irA(indice: number) {
    const p = enJuego[indice];
    if (!p) {
      void terminar();
      return;
    }
    setPaso({ tipo: "pregunta", pregunta: p, indice });
  }

  /** Manda las respuestas y SÓLO ENTONCES dice «ya está». */
  async function terminar(
    r: Record<string, Respuesta> = respuestas,
    d: Record<string, string[]> = detalles,
  ) {
    setPaso({ tipo: "guardando" });
    await enviar(r, d);
  }

  function contestar(pregunta: Pregunta, valor: Respuesta, indice: number) {
    // Lo que contestó antes se descarta SOLO si el seguimiento deja de
    // aplicar: si dice «No» a la diabetes después de haber dicho «Sí» y
    // haber contestado la insulina, esa respuesta ya no es de ninguna
    // pregunta que se le haya hecho.
    const siguientes = { ...respuestas, [pregunta.id]: valor };
    if (valor !== "SI" && pregunta.seguimiento) {
      delete siguientes[pregunta.seguimiento.id];
    }
    if (valor !== "SI" && pregunta.opciones) {
      setDetalles((d) => {
        const copia = { ...d };
        delete copia[pregunta.id];
        return copia;
      });
    }
    setRespuestas(siguientes);

    // Si este «Sí» abre una pantalla de detalle, va antes de seguir.
    if (valor === "SI" && pregunta.opciones) {
      setPaso({ tipo: "detalle", pregunta, indice });
      return;
    }
    // Con las respuestas nuevas, recalcular qué toca: un «Sí» a la
    // diabetes mete el seguimiento justo detrás.
    const nuevoJuego = preguntasEnJuego(
      props.cuestionario,
      (id) => siguientes[id],
    );
    const posicion = nuevoJuego.findIndex((p) => p.id === pregunta.id);
    const siguiente = nuevoJuego[posicion + 1];
    if (!siguiente) {
      void terminar(siguientes, detalles);
      return;
    }
    setPaso({ tipo: "pregunta", pregunta: siguiente, indice: posicion + 1 });
  }

  function atras() {
    if (paso.tipo === "quien") return setPaso({ tipo: "bienvenida" });
    if (paso.tipo === "detalle") {
      return setPaso({
        tipo: "pregunta",
        pregunta: paso.pregunta,
        indice: paso.indice,
      });
    }
    if (paso.tipo !== "pregunta") return;
    if (paso.indice === 0) return setPaso({ tipo: "quien" });
    irA(paso.indice - 1);
  }

  async function enviar(
    r: Record<string, Respuesta> = respuestas,
    d: Record<string, string[]> = detalles,
  ) {
    if (enviando) return;
    setEnviando(true);
    setError(null);
    const fallo = await props.onEnviar({
      respuestas: r,
      detalles: d,
      respondioPor: respondioPor ?? "PACIENTE",
    });
    setEnviando(false);
    if (fallo) {
      setError(fallo);
      // Se vuelve a la última pregunta: dejarle la pantalla de «ya está»
      // con un error debajo le diría que ha terminado cuando no.
      setPaso({
        tipo: "pregunta",
        pregunta: enJuego[enJuego.length - 1]!,
        indice: enJuego.length - 1,
      });
      return;
    }
    setPaso({ tipo: "gracias" });
  }

  const sinSaber = Object.values(respuestas).filter((v) => v === "NO_SE").length;
  const progreso =
    paso.tipo === "bienvenida"
      ? null
      : paso.tipo === "quien"
        ? 3
        : paso.tipo === "gracias" || paso.tipo === "guardando"
          ? 100
          : Math.round((numeroDe(paso.pregunta) - 0.5) * (100 / total));

  return (
    <div className="min-h-dvh bg-mipiace-stone font-sans text-mipiace-ink flex flex-col px-5 py-5 md:px-7 md:py-7">
      {/* Cabecera: la clínica, y para qué es esto */}
      <div>
        <div className="flex items-center justify-between gap-3 text-[14px] md:text-[15px] text-mipiace-ink-soft">
          <span className="font-medium">{props.clinica}</span>
          <span className="text-right">Antes de su primera visita</span>
        </div>
        {progreso != null && (
          <div className="mt-3.5 h-2 rounded-lg bg-[#E7E2DB] overflow-hidden">
            <div
              className="h-full rounded-lg bg-mipiace-coral transition-[width] duration-200 ease-out motion-reduce:transition-none"
              style={{ width: `${progreso}%` }}
            />
          </div>
        )}
      </div>

      <div className="flex-1 flex flex-col justify-center w-full max-w-[720px] mx-auto">
        {error && (
          <div
            role="alert"
            className="mb-5 rounded-2xl bg-red-50 text-red-700 text-[17px] leading-relaxed px-5 py-4"
          >
            {error}
          </div>
        )}

        {paso.tipo === "bienvenida" && (
          <>
            <p className="text-[16px] md:text-[17px] text-slate-500 mb-3">
              Le llevará unos 3 minutos
            </p>
            <h1 className="text-[28px] md:text-[38px] font-semibold leading-tight tracking-[-0.02em] m-0 mb-3.5">
              Hola, {props.nombrePila}.
            </h1>
            <p className="text-[17px] md:text-[20px] text-mipiace-ink-soft leading-snug m-0 mb-8">
              Antes de su primera visita, la podóloga necesita saber unas cosas
              de su salud. Son {total} preguntas y se contestan con «Sí» o
              «No».
            </p>
            <div className="flex items-center justify-between mt-6">
              <span />
              <Siguiente onClick={() => setPaso({ tipo: "quien" })}>
                Empezar
              </Siguiente>
            </div>
          </>
        )}

        {paso.tipo === "quien" && (
          <>
            <h1 className="text-[28px] md:text-[38px] font-semibold leading-tight tracking-[-0.02em] m-0 mb-3.5">
              ¿Quién está respondiendo?
            </h1>
            <p className="text-[17px] md:text-[20px] text-mipiace-ink-soft leading-snug m-0 mb-8">
              Así la podóloga sabe quién ha contestado.
            </p>
            <div className="grid gap-3.5">
              {(
                [
                  ["PACIENTE", `Soy ${props.nombrePila}`],
                  ["FAMILIAR", "Un familiar o acompañante"],
                ] as const
              ).map(([valor, texto]) => (
                <button
                  key={valor}
                  type="button"
                  onClick={() => setRespondioPor(valor)}
                  aria-pressed={respondioPor === valor}
                  className={`w-full text-left min-h-[76px] px-[22px] rounded-[18px] text-[20px] md:text-[22px] font-medium border-2 transition-colors ${
                    respondioPor === valor
                      ? "bg-mipiace-coral-soft border-mipiace-coral text-mipiace-coral-dark"
                      : "bg-white border-slate-200 text-mipiace-ink"
                  }`}
                >
                  {texto}
                </button>
              ))}
            </div>
            <div className="flex items-center justify-between mt-6">
              <Atras onClick={atras} />
              <Siguiente disabled={!respondioPor} onClick={() => irA(0)}>
                Seguir
              </Siguiente>
            </div>
          </>
        )}

        {paso.tipo === "pregunta" && (
          <>
            <p className="text-[16px] md:text-[17px] text-slate-500 mb-3">
              Pregunta {numeroDe(paso.pregunta)} de {total}
            </p>
            <h1 className="text-[28px] md:text-[38px] font-semibold leading-tight tracking-[-0.02em] m-0 mb-3.5">
              {paso.pregunta.texto}
            </h1>
            {/* El hueco se mantiene aunque no haya ayuda: sin él, la
                pregunta salta de sitio entre pantallas y la vista tiene que
                volver a buscarla. */}
            <p className="text-[17px] md:text-[20px] text-mipiace-ink-soft leading-snug m-0 mb-8 min-h-[1.4em]">
              {paso.pregunta.ayuda || " "}
            </p>
            <div className="grid grid-cols-2 gap-3 md:gap-4">
              <Respuestas
                pregunta={paso.pregunta}
                valor={respuestas[paso.pregunta.id]}
                onElegir={(v) => contestar(paso.pregunta, v, paso.indice)}
              />
            </div>
            <div className="flex items-center justify-between mt-6">
              <Atras onClick={atras} />
              <span />
            </div>
          </>
        )}

        {paso.tipo === "detalle" && (
          <>
            <p className="text-[16px] md:text-[17px] text-slate-500 mb-3">
              Pregunta {numeroDe(paso.pregunta)} de {total}
            </p>
            <h1 className="text-[28px] md:text-[38px] font-semibold leading-tight tracking-[-0.02em] m-0 mb-3.5">
              ¿A qué es alérgico?
            </h1>
            <p className="text-[17px] md:text-[20px] text-mipiace-ink-soft leading-snug m-0 mb-8">
              Toque todas las que sean. Si no lo sabe, siga: la podóloga lo
              mirará con usted.
            </p>
            <div className="flex flex-wrap gap-3 mt-2">
              {(paso.pregunta.opciones ?? []).map((opcion) => {
                const puesta = (detalles[paso.pregunta.id] ?? []).includes(
                  opcion,
                );
                return (
                  <button
                    key={opcion}
                    type="button"
                    aria-pressed={puesta}
                    onClick={() =>
                      setDetalles((d) => {
                        const actuales = d[paso.pregunta.id] ?? [];
                        return {
                          ...d,
                          [paso.pregunta.id]: puesta
                            ? actuales.filter((x) => x !== opcion)
                            : [...actuales, opcion],
                        };
                      })
                    }
                    className={`min-h-touch-lg px-[22px] rounded-[18px] text-[18px] md:text-[20px] font-medium border-2 transition-colors ${
                      puesta
                        ? "bg-mipiace-coral-soft border-mipiace-coral text-mipiace-coral-dark"
                        : "bg-white border-slate-200 text-mipiace-ink"
                    }`}
                  >
                    {opcion}
                  </button>
                );
              })}
            </div>
            <div className="flex items-center justify-between mt-6">
              <Atras onClick={atras} />
              <Siguiente
                onClick={() => {
                  const nuevoJuego = preguntasEnJuego(
                    props.cuestionario,
                    (id) => respuestas[id],
                  );
                  const pos = nuevoJuego.findIndex(
                    (p) => p.id === paso.pregunta.id,
                  );
                  const siguiente = nuevoJuego[pos + 1];
                  if (!siguiente) {
                    void terminar();
                    return;
                  }
                  setPaso({
                    tipo: "pregunta",
                    pregunta: siguiente,
                    indice: pos + 1,
                  });
                }}
              >
                Seguir
              </Siguiente>
            </div>
          </>
        )}

        {/* GUARDANDO. No dice «ya está» todavía, y no invita a cerrar la
            página: todavía no se ha guardado nada. Ver la nota de `Paso`. */}
        {paso.tipo === "guardando" && (
          <>
            <div className="w-[88px] h-[88px] rounded-3xl bg-mipiace-coral-soft flex items-center justify-center mb-6">
              <Loader2
                className="w-11 h-11 text-mipiace-coral animate-spin motion-reduce:animate-none"
                strokeWidth={2.25}
                aria-hidden="true"
              />
            </div>
            <h1 className="text-[28px] md:text-[38px] font-semibold leading-tight tracking-[-0.02em] m-0 mb-3.5">
              Estamos guardando sus respuestas…
            </h1>
            <p className="text-[17px] md:text-[20px] text-mipiace-ink-soft leading-snug m-0">
              Un momento, por favor. No cierre esta página.
            </p>
          </>
        )}

        {paso.tipo === "gracias" && (
          <>
            <div className="w-[88px] h-[88px] rounded-3xl bg-emerald-50 flex items-center justify-center mb-6">
              <svg
                width="44"
                height="44"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#047857"
                strokeWidth="2.25"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M20 6 9 17l-5-5" />
              </svg>
            </div>
            <h1 className="text-[28px] md:text-[38px] font-semibold leading-tight tracking-[-0.02em] m-0 mb-3.5">
              Gracias, {props.nombrePila}. Ya está.
            </h1>
            <p className="text-[17px] md:text-[20px] text-mipiace-ink-soft leading-snug m-0">
              La podóloga lo revisará con usted al empezar la visita.
              {sinSaber > 0 && (
                <>
                  {" "}
                  Hay {sinSaber}{" "}
                  {sinSaber === 1 ? "pregunta" : "preguntas"} que ha marcado
                  como «No lo sé»: no se preocupe,{" "}
                  {sinSaber === 1 ? "la mirarán" : "las mirarán"} juntos.
                </>
              )}
            </p>
            <div className="mt-6 bg-white rounded-3xl border border-slate-200 px-6 py-5 text-[18px] md:text-[19px] leading-relaxed">
              {props.canal === "TABLET"
                ? "Puede devolver la tablet en el mostrador."
                : "Ya puede cerrar esta página. Le esperamos en su cita."}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** Los tres botones de una pregunta: «Sí», «No» y «No lo sé». */
function Respuestas(props: {
  pregunta: Pregunta;
  valor: Respuesta | undefined;
  onElegir: (v: Respuesta) => void;
}) {
  const base =
    "min-h-tap-valoracion-sm md:min-h-tap-valoracion rounded-[24px] text-[26px] md:text-[30px] font-semibold border-2 transition-[background-color,border-color] duration-150 active:scale-[0.97] motion-reduce:active:scale-100 motion-reduce:transition-none";
  return (
    <>
      <button
        type="button"
        onClick={() => props.onElegir("SI")}
        aria-pressed={props.valor === "SI"}
        // El borde coral del «Sí» está en el mockup y no es decorativo:
        // marca de antemano el que tiene consecuencias.
        className={`${base} ${
          props.valor === "SI"
            ? "bg-mipiace-coral border-mipiace-coral text-white"
            : "bg-white border-mipiace-coral text-mipiace-ink"
        }`}
      >
        Sí
      </button>
      <button
        type="button"
        onClick={() => props.onElegir("NO")}
        aria-pressed={props.valor === "NO"}
        className={`${base} ${
          props.valor === "NO"
            ? "bg-mipiace-coral border-mipiace-coral text-white"
            : "bg-white border-slate-200 text-mipiace-ink"
        }`}
      >
        No
      </button>
      {/* SIEMPRE disponible, y a ancho completo. Es la decisión de producto
          más importante de esta pantalla: sin ella, quien no sabe contesta
          «No» por no quedar mal, y un «No» inventado es peor que un «No lo
          sé» — la podóloga no sabe que tiene que preguntarlo. Punteado y
          sin relleno para que no compita con los dos de arriba: es una
          salida, no una tercera opción al mismo nivel. */}
      <button
        type="button"
        onClick={() => props.onElegir("NO_SE")}
        aria-pressed={props.valor === "NO_SE"}
        className={`col-span-2 min-h-touch-lg rounded-[24px] text-[18px] md:text-[20px] font-medium border-2 border-dashed transition-colors active:scale-[0.97] motion-reduce:active:scale-100 ${
          props.valor === "NO_SE"
            ? "bg-mipiace-coral border-mipiace-coral text-white"
            : "bg-transparent border-slate-300 text-mipiace-ink-soft"
        }`}
      >
        No lo sé
      </button>
    </>
  );
}

function Siguiente(props: {
  children: React.ReactNode;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={props.disabled}
      onClick={props.onClick}
      className="min-h-[72px] px-9 rounded-[20px] bg-mipiace-coral text-white text-[20px] md:text-[22px] font-semibold disabled:opacity-45 disabled:cursor-not-allowed active:scale-[0.97] motion-reduce:active:scale-100 transition-transform"
    >
      {props.children}
    </button>
  );
}

function Atras(props: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      className="min-h-touch-pad px-3 rounded-2xl bg-transparent text-mipiace-ink-soft text-[17px] md:text-[18px]"
    >
      ‹ Atrás
    </button>
  );
}
