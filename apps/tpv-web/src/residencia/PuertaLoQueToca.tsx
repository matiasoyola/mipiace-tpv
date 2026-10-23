// residencia-3 (D-64) · **PANTALLA 3: LO QUE TOCA AHORA.**
//
// La pantalla del bloque. Cabecera con el número, «Nombre · rol · turno ·
// hora», «Se cierra sola en 0:45» y «Terminar». Una columna por residente
// con su foto pequeña y su cama, y en cada una:
//
//   · **«¿Cómo está hoy?»** — «Como siempre» (coral, grande) y «No como
//     siempre». Si ya se registró en este turno, una franja verde con
//     quién y cuándo.
//   · **«Toca ahora»** — lo que `queToca` devuelve para esta franja, con
//     su pista y su botón oscuro «Hecho». Las comidas, con sus cuatro
//     opciones en fila. Lo hecho en gris discontinuo, con «Corregir».
//   · Abajo: **«+ Higiene»**, **«+ Deposición»** y **«Algo no va bien»**.
//
// ── NADA SE ANIMA ───────────────────────────────────────────────────
//
// «Hecho» no se anima: **cambia de estado**. Es una acción de alta
// frecuencia —quince, veinte veces por turno— y una animación de 200 ms
// repetida veinte veces son cuatro segundos del presupuesto de treinta
// minutos por jornada (D-05). Y lo que hace que la auxiliar sepa que
// funcionó no es el movimiento: es que el botón ya no está y en su sitio
// hay una línea gris que dice quién y cuándo.
//
// ── residencia-4 · LAS CONSTANTES ENTRAN (alcance 3) ────────────────
//
// Dos sitios, y son dos a propósito:
//
//   · una línea `MEASURE` del plan sale en «Toca ahora» con un botón
//     **«Tomar»** en vez de «Hecho». Un «Hecho» sobre una temperatura no
//     significa nada: lo que hace falta es el número;
//   · y **«+ Constante»** abajo, junto a «+ Higiene» y «+ Deposición»,
//     para tomarla a demanda — que es como se toma el 90 % de las veces,
//     porque la DUE la pide cuando ve a alguien raro y eso no está en
//     ningún plan.
//
// El botón de la enfermera NO está aquí: está dentro de la pantalla de
// la constante y de la de «algo no va bien», que es donde hay algo que
// apuntar con él. Un botón de avisar suelto en esta pantalla sería un
// aviso sin registro detrás, y la enfermera llegaría sin nada que mirar.
//
// ── Y LO QUE LA PANTALLA NO DECIDE ──────────────────────────────────
//
// Qué filas escribe cada toque lo decide `puerta-gestos.ts`, que es puro y
// está testeado como una tabla. Aquí sólo se pinta y se llama.

import { useEffect, useState } from "react";

import { PuertaFoto } from "./PuertaFoto.js";
import { colorDelTurno } from "./PuertaScreen.js";
import {
  ALGO_NO_VA_BIEN,
  observacionDelTurno,
  yaHecho,
} from "./puerta-gestos.js";
import type {
  LoQueToca,
  OcurrenciaDeLaPuerta,
  RegistroDeLaPuerta,
} from "./puerta-tipos.js";

export interface PuertaLoQueTocaProps {
  numeroDeHabitacion: string;
  /** Quién está dentro y con qué rol, para la cabecera. */
  quien: { nombre: string; rolName: string };
  datos: LoQueToca;
  /** Segundos que quedan de la ventana de inactividad. */
  segundosParaCerrar: number;
  /** Las dimensiones `OBS` que entran en el «como siempre», con su valor
   *  de normalidad. Las calcula `dimensionesDeLaObservacion`. */
  dimensiones: Array<{ code: string; name: string; comoSiempre: string }>;
  /** Los `ON_DEMAND` que este residente tiene en su plan, por residente. */
  aDemandaPorResidente: Record<string, Array<{ code: string; nombre: string }>>;
  onComoSiempre: (clientId: string) => void;
  onNoComoSiempre: (clientId: string) => void;
  onHecho: (clientId: string, o: OcurrenciaDeLaPuerta, opcion?: string) => void;
  onCorregir: (clientId: string, o: OcurrenciaDeLaPuerta) => void;
  onADemanda: (clientId: string, controlCode: string) => void;
  /** residencia-4 · tomar una constante. `ocurrencia` puesto cuando
   *  responde a una línea del plan, y `null` cuando es a demanda. */
  onTomarConstante: (
    clientId: string,
    controlCode: string,
    ocurrencia: OcurrenciaDeLaPuerta | null,
  ) => void;
  /** Las constantes que este centro tiene activas, para el desplegable
   *  de «+ Constante». */
  constantesDisponibles: Array<{ code: string; nombre: string }>;
  onAlgoNoVaBien: (clientId: string) => void;
  onTerminar: () => void;
}

export function PuertaLoQueToca({
  numeroDeHabitacion,
  quien,
  datos,
  segundosParaCerrar,
  dimensiones,
  aDemandaPorResidente,
  onComoSiempre,
  onNoComoSiempre,
  onHecho,
  onCorregir,
  onADemanda,
  onTomarConstante,
  constantesDisponibles,
  onAlgoNoVaBien,
  onTerminar,
}: PuertaLoQueTocaProps) {
  const [ahora, setAhora] = useState(() => new Date());
  /** Qué residente tiene abierto el desplegable de «+ Constante». */
  const [eligiendo, setEligiendo] = useState<string | null>(null);
  useEffect(() => {
    const id = setInterval(() => setAhora(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="min-h-screen bg-mipiace-stone text-mipiace-ink flex flex-col">
      <header className="flex items-center justify-between px-8 py-5 border-b border-slate-200 bg-white">
        <div className="flex items-baseline gap-5">
          <span className="text-[44px] font-semibold tabular-nums">
            {numeroDeHabitacion}
          </span>
          <span className="text-[22px] text-slate-600">
            {quien.nombre} · {quien.rolName}
            {datos.turno ? ` · ${datos.turno.name.toLowerCase()}` : ""} ·{" "}
            {ahora.toLocaleTimeString("es-ES", {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
          {datos.turno && (
            <span
              aria-hidden="true"
              className={`inline-block w-3 h-3 rounded-full ${colorDelTurno(
                datos.turno.code,
              )}`}
            />
          )}
        </div>
        <div className="flex items-center gap-6">
          {/* La cuenta atrás se DICE. Una pantalla con la historia de dos
              personas que se cierra sin avisar deja a quien está
              registrando sin saber por qué desapareció lo que tenía
              delante. */}
          <span className="text-[20px] text-slate-500 tabular-nums">
            Se cierra sola en {mmss(segundosParaCerrar)}
          </span>
          <button
            type="button"
            onClick={onTerminar}
            className="min-h-tap-puerta rounded-xl border-2 border-slate-400 px-7 text-[24px] font-medium"
          >
            Terminar
          </button>
        </div>
      </header>

      {!datos.turno && (
        // El hueco en el cuadrante. Se dice y no se esconde: lo que se
        // registre ahora se guarda SIN turno, y eso sale en ámbar en la
        // ficha y en el relevo. No bloquea nada — un cuidado hecho se
        // apunta.
        <p className="mx-8 mt-4 rounded-xl bg-amber-100 text-amber-900 px-6 py-3 text-[20px]">
          Los turnos del centro no cubren esta hora. Lo que registres se
          guarda igual, y quedará marcado como «sin turno» para que
          dirección lo arregle.
        </p>
      )}

      {/* ── residencia-6 · SIN RED, ESTO ES LO QUE ESTA TABLET SABE ──
          residencia-3 §15.3 dejaba la lista entera por hacer. Ahora lo
          propio consta, con su marca. Lo que sigue sin poderse saber es
          lo que se registró desde OTRA pantalla sin red, **y se dice**:
          una pantalla que se calla eso es una pantalla que afirma que no
          se hizo. */}
      {datos.residentes.some((r) =>
        r.registros.some((g) => g.enLaTablet),
      ) && (
        <p className="mx-8 mt-4 rounded-xl bg-slate-100 text-slate-700 px-6 py-3 text-[20px]">
          Lo marcado «en la tablet» está apuntado aquí y sube cuando vuelva
          la red. Lo que se haya registrado desde otra pantalla sin red no
          se puede saber todavía.
        </p>
      )}

      <main className="flex-1 px-8 py-6 grid gap-6 lg:grid-cols-2">
        {datos.residentes.map((r) => (
          <section
            key={r.clientId}
            className="rounded-2xl bg-white border border-slate-200 p-6 flex flex-col gap-6"
          >
            <div className="flex items-center gap-4">
              <PuertaFoto
                clientId={r.clientId}
                nombre={r.nombre}
                tieneFoto={r.tieneFoto}
                lado={64}
              />
              <div>
                {datos.residentes.length > 1 && (
                  <p className="text-[16px] uppercase tracking-[0.14em] text-slate-400">
                    Cama {r.bedLabel}
                  </p>
                )}
                <h2 className="text-[30px] font-semibold leading-tight">
                  {r.nombre}
                </h2>
              </div>
            </div>

            {/* ── historia-1 (D-91) · LA FRANJA DE ALERTAS ──────────
                Debajo del nombre y ANTES de todo lo demás, porque es lo
                que hay que saber antes de tocar a alguien. **Sólo la
                frase accionable**: el servidor manda `string[]` y aquí no
                hay ningún diagnóstico que pintar (ver
                `PuertaArranque.ocupantes[].alertas`).

                Y la auxiliar no gana ni un toque (D-97): es texto, no un
                desplegable. */}
            <FranjaDeAlertas frases={r.alertas ?? []} />

            {/* ── historia-1 (D-92) · EL RESIDENTE QUE NO ESTÁ ──────
                Y cuando está fuera, **nada de lo de abajo**: ni «¿cómo
                está hoy?» ni «toca ahora» ni los botones. No por
                esconderlo, sino porque pedirle a alguien que registre la
                higiene de quien está en el hospital es pedirle que
                invente un cuidado — y un «como siempre» de un residente
                ausente es un dato falso firmado con su PIN.

                Lo que sí queda es el nombre, la foto y por qué no está,
                que es lo que hace que nadie vaya a buscarla. */}
            {r.ausente ? (
              <TarjetaDeAusente ausente={r.ausente} />
            ) : (
              <>
                <ComoEstaHoy
                  registros={r.registros}
                  dimensiones={dimensiones}
                  onComoSiempre={() => onComoSiempre(r.clientId)}
                  onNoComoSiempre={() => onNoComoSiempre(r.clientId)}
                />

                <TocaAhora
                  toca={r.toca}
                  registros={r.registros}
                  controles={datos.controles}
                  onHecho={(o, opcion) => onHecho(r.clientId, o, opcion)}
                  onCorregir={(o) => onCorregir(r.clientId, o)}
                  onTomar={(o) => onTomarConstante(r.clientId, o.controlCode, o)}
                />

                <div className="flex flex-wrap gap-3 pt-2 border-t border-slate-200">
                  {(aDemandaPorResidente[r.clientId] ?? []).map((d) => (
                    <button
                      key={d.code}
                      type="button"
                      onClick={() => onADemanda(r.clientId, d.code)}
                      className="min-h-touch-pad rounded-xl border-2 border-slate-300 px-6 text-[22px] font-medium"
                    >
                      + {d.nombre}
                    </button>
                  ))}
                  {/* residencia-4 · «+ Constante». Un toque abre la lista
                      de las constantes activas del centro; el segundo
                      toque abre el teclado. Dos toques y no uno porque son
                      siete y no caben en una fila de botones de 72 px — y
                      porque la que se toma a demanda no es siempre la
                      misma. */}
                  {constantesDisponibles.length > 0 && (
                    <button
                      type="button"
                      onClick={() =>
                        setEligiendo((v) =>
                          v === r.clientId ? null : r.clientId,
                        )
                      }
                      className="min-h-touch-pad rounded-xl border-2 border-slate-300 px-6 text-[22px] font-medium"
                    >
                      + Constante
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => onAlgoNoVaBien(r.clientId)}
                    className="min-h-touch-pad rounded-xl bg-amber-500 text-white px-6 text-[22px] font-semibold"
                  >
                    Algo no va bien
                  </button>
                </div>

                {eligiendo === r.clientId && (
                  <div className="flex flex-wrap gap-3 rounded-2xl bg-slate-50 border border-slate-200 p-4">
                    {constantesDisponibles.map((c) => (
                      <button
                        key={c.code}
                        type="button"
                        onClick={() => {
                          setEligiendo(null);
                          onTomarConstante(r.clientId, c.code, null);
                        }}
                        className="min-h-touch-pad rounded-xl bg-white border-2 border-slate-300 px-6 text-[21px] font-medium"
                      >
                        {c.nombre}
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </section>
        ))}
      </main>
    </div>
  );
}

/**
 * historia-1 (D-91) · **LA FRANJA DE ALERTAS DE LA PUERTA.**
 *
 * Lo accionable, y nada más. Las frases vienen calculadas del servidor
 * (`frasesParaLaPuerta` del paquete puro), así que esta función no decide
 * qué alerta: sólo lo pinta.
 *
 * ── Rojo, y con el texto grande ────────────────────────────────────
 *
 * No es decoración: la banda tiene que ganarle la mirada al nombre, que
 * está justo encima y es lo que la auxiliar busca. 22 px —el tamaño de
 * los botones de esta pantalla— y no 16: se lee a la distancia a la que
 * alguien pasa por un pasillo con una bandeja en las manos.
 *
 * ── Y sin banda cuando no hay nada ─────────────────────────────────
 *
 * Nada de un hueco vacío que diga «sin alertas». El denominador cuenta en
 * los registros (D-16), no en una banda: una banda gris que dice «sin
 * alertas» en cuarenta puertas es la que hace que nadie mire la roja de
 * la cuarenta y una.
 */
function FranjaDeAlertas({ frases }: { frases: string[] }) {
  if (frases.length === 0) return null;
  return (
    <ul className="rounded-xl bg-rose-50 border-2 border-rose-300 px-5 py-3 flex flex-col gap-1">
      {frases.map((f) => (
        <li
          key={f}
          className="block text-[22px] font-semibold text-rose-900 leading-snug"
        >
          {f}
        </li>
      ))}
    </ul>
  );
}

/**
 * historia-1 (D-92) · **EL RESIDENTE QUE NO ESTÁ.**
 *
 * En el hueco de «¿cómo está hoy?» y «toca ahora», que no se pintan. El
 * rótulo corto grande y la frase entera debajo: la primera se lee de
 * reojo, la segunda sólo si hace falta.
 *
 * Azul y no rojo: **no es una alerta, es una explicación**. Lo que la
 * auxiliar tiene que hacer con esto es nada, y pintarlo del color de una
 * alergia grave gastaría el rojo que la franja de arriba necesita.
 */
function TarjetaDeAusente({
  ausente,
}: {
  ausente: { corta: string; frase: string };
}) {
  return (
    <div className="rounded-xl bg-sky-50 border-2 border-sky-300 px-5 py-6 flex flex-col gap-2">
      <p className="block text-[30px] font-semibold text-sky-900 leading-tight">
        {ausente.corta}
      </p>
      <p className="block text-[20px] text-sky-800">{ausente.frase}</p>
      <p className="block text-[18px] text-sky-700">
        No le toca nada mientras esté fuera.
      </p>
    </div>
  );
}

/** «¿Cómo está hoy?» · dos botones, o la franja verde de lo ya marcado. */
function ComoEstaHoy({
  registros,
  dimensiones,
  onComoSiempre,
  onNoComoSiempre,
}: {
  registros: RegistroDeLaPuerta[];
  dimensiones: Array<{ code: string; name: string; comoSiempre: string }>;
  onComoSiempre: () => void;
  onNoComoSiempre: () => void;
}) {
  const ya = observacionDelTurno(registros, dimensiones);
  return (
    <div>
      <h3 className="text-[22px] font-semibold text-slate-700">
        ¿Cómo está hoy?
      </h3>
      {ya ? (
        // La franja verde. Dice QUIÉN y A QUÉ HORA, que es lo que evita
        // que la auxiliar de la tarde lo vuelva a marcar «por si acaso» —
        // y de paso es la mitad de la evidencia que la dirección enseña.
        <p className="mt-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 px-6 py-4 text-[22px]">
          {ya.todoComoSiempre ? "Como siempre" : "No como siempre"} · lo
          marcó {ya.firmadoPor} a las {hhmm(ya.recordedAt)}
          {ya.enLaTablet && (
            <span className="text-emerald-700/70"> · en la tablet</span>
          )}
        </p>
      ) : (
        <div className="mt-3 flex gap-3">
          <button
            type="button"
            onClick={onComoSiempre}
            className="flex-1 min-h-tap-puerta rounded-2xl bg-mipiace-coral text-white text-[28px] font-semibold active:bg-mipiace-coral-dark"
          >
            Como siempre
          </button>
          <button
            type="button"
            onClick={onNoComoSiempre}
            className="min-h-tap-puerta rounded-2xl border-2 border-slate-300 px-6 text-[22px] font-medium"
          >
            No como siempre
          </button>
        </div>
      )}
    </div>
  );
}

/** «Toca ahora» · una línea por ocurrencia. */
function TocaAhora({
  toca,
  registros,
  controles,
  onHecho,
  onCorregir,
  onTomar,
}: {
  toca: OcurrenciaDeLaPuerta[];
  registros: RegistroDeLaPuerta[];
  controles: LoQueToca["controles"];
  onHecho: (o: OcurrenciaDeLaPuerta, opcion?: string) => void;
  onCorregir: (o: OcurrenciaDeLaPuerta) => void;
  onTomar: (o: OcurrenciaDeLaPuerta) => void;
}) {
  // Las `OBS` no salen aquí aunque «toquen»: su sitio es «¿Cómo está
  // hoy?», arriba, y pintarlas dos veces haría que un «como siempre» ya
  // marcado siguiera pidiéndose línea a línea.
  const porCodigo = new Map(controles.map((c) => [c.code, c]));
  const lineas = toca.filter((o) => porCodigo.get(o.controlCode)?.layer !== "OBS");

  if (lineas.length === 0) {
    return (
      <div>
        <h3 className="text-[22px] font-semibold text-slate-700">Toca ahora</h3>
        <p className="mt-3 text-[20px] text-slate-400">
          Nada pendiente en este turno.
        </p>
      </div>
    );
  }

  return (
    <div>
      <h3 className="text-[22px] font-semibold text-slate-700">Toca ahora</h3>
      <ul className="mt-3 space-y-3">
        {lineas.map((o) => {
          const hecho = yaHecho(registros, o);
          const control = porCodigo.get(o.controlCode);
          const ordinal = control?.valueDomain === "ORDINAL";
          // residencia-4 · una constante no se marca «hecha»: se TOMA.
          const numerica = control?.valueDomain === "NUMERIC";
          return (
            <li
              key={`${o.controlCode}-${o.at}`}
              className={`rounded-xl px-5 py-4 ${
                hecho
                  ? "border border-dashed border-slate-300 text-slate-400"
                  : "bg-slate-50 border border-slate-200"
              }`}
            >
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-[24px] font-medium">{o.nombre}</p>
                  <p className="text-[17px] text-slate-500">{pistaDe(o)}</p>
                </div>
                {hecho ? (
                  <div className="text-right">
                    <p className="text-[18px]">
                      {hecho.firmadoPor} · {hhmm(hecho.recordedAt)}
                      {/* residencia-6 · de dónde sale este «hecho». Sin
                          la marca, lo que está sólo en la tablet y lo que
                          consta en el servidor se verían igual — y no son
                          lo mismo: lo de aquí no lo ve el relevo todavía. */}
                      {hecho.enLaTablet && (
                        <span className="text-slate-400"> · en la tablet</span>
                      )}
                    </p>
                    <button
                      type="button"
                      onClick={() => onCorregir(o)}
                      className="mt-1 min-h-touch-pad text-[18px] underline text-slate-500"
                    >
                      Corregir
                    </button>
                  </div>
                ) : numerica ? (
                  // «Tomar» y no «Hecho»: lo que hace falta es el
                  // número, y un «hecho» sobre una temperatura no dice
                  // cuánto tenía.
                  <button
                    type="button"
                    onClick={() => onTomar(o)}
                    className="min-h-tap-puerta rounded-xl bg-mipiace-ink text-white px-9 text-[24px] font-semibold active:bg-mipiace-ink-soft"
                  >
                    Tomar
                  </button>
                ) : ordinal ? (
                  // Las cuatro opciones de una comida, EN FILA. No un
                  // desplegable: un desplegable son dos toques y una lista
                  // que tapa la pantalla, y aquí hay cuatro opciones fijas.
                  <div className="flex gap-2">
                    {(control?.opciones ?? []).map((op) => (
                      <button
                        key={op.code}
                        type="button"
                        onClick={() => onHecho(o, op.code)}
                        className="min-h-touch-pad rounded-xl bg-white border-2 border-slate-300 px-4 text-[19px] font-medium"
                      >
                        {etiquetaDeOpcion(op.code)}
                      </button>
                    ))}
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => onHecho(o)}
                    className="min-h-tap-puerta rounded-xl bg-mipiace-ink text-white px-9 text-[24px] font-semibold active:bg-mipiace-ink-soft"
                  >
                    Hecho
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * La pista de una ocurrencia: «desde las 10:00 · cada 3 h».
 *
 * Una FRANJA se pinta «desde las 10:00» y un INSTANTE «a las 10:00», y la
 * diferencia es real (residencia-2 §5): nadie pide la hidratación cutánea
 * a las 08:00 en punto, y decir «a las 08:00» haría creer que a las 08:01
 * está incumplida.
 */
export function pistaDe(o: OcurrenciaDeLaPuerta): string {
  const hora = hhmm(o.at);
  if (o.esFranja) {
    return o.until ? `desde las ${hora} hasta las ${hhmm(o.until)}` : `desde las ${hora}`;
  }
  return `a las ${hora}`;
}

/** Los textos de las cuatro opciones de una comida. Vienen del catálogo
 *  (`label`), pero la pantalla sólo recibe los códigos: `lo-que-toca`
 *  devuelve `{code, isAsUsual}` porque el nombre largo no cabe en un botón
 *  de la fila. Si un centro añade una opción propia, se pinta su código,
 *  que es mejor que no pintar nada. */
function etiquetaDeOpcion(code: string): string {
  switch (code) {
    case "TODO":
      return "Todo";
    case "MITAD":
      return "La mitad";
    case "POCO":
      return "Poco";
    case "NADA":
      return "Nada";
    default:
      return code;
  }
}

function hhmm(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
}

function mmss(segundos: number): string {
  const s = Math.max(0, Math.floor(segundos));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export { ALGO_NO_VA_BIEN };
