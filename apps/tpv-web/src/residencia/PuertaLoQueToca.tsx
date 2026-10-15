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
// ── EL AVISO DE «AVISAR A LA ENFERMERA» NO SE PINTA (decisión 9) ─────
//
// El aviso inmediato real (D-19) llega en residencia-4. Aquí, en su sitio,
// va la frase «Si no puede esperar, avisa a la enfermera en persona». Un
// botón que parece avisar y no avisa es peor que no tenerlo: la auxiliar
// lo pulsa, se queda tranquila y nadie va.
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
  onAlgoNoVaBien,
  onTerminar,
}: PuertaLoQueTocaProps) {
  const [ahora, setAhora] = useState(() => new Date());
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
              <button
                type="button"
                onClick={() => onAlgoNoVaBien(r.clientId)}
                className="min-h-touch-pad rounded-xl bg-amber-500 text-white px-6 text-[22px] font-semibold"
              >
                Algo no va bien
              </button>
            </div>

            {/* Decisión 9 · el hueco del aviso, con la frase que de verdad
                funciona hoy. El botón entra en residencia-4, cuando el
                aviso sea real. */}
            <p className="text-[18px] text-slate-500">
              Si no puede esperar, avisa a la enfermera en persona.
            </p>
          </section>
        ))}
      </main>
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
}: {
  toca: OcurrenciaDeLaPuerta[];
  registros: RegistroDeLaPuerta[];
  controles: LoQueToca["controles"];
  onHecho: (o: OcurrenciaDeLaPuerta, opcion?: string) => void;
  onCorregir: (o: OcurrenciaDeLaPuerta) => void;
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
                    </p>
                    <button
                      type="button"
                      onClick={() => onCorregir(o)}
                      className="mt-1 min-h-touch-pad text-[18px] underline text-slate-500"
                    >
                      Corregir
                    </button>
                  </div>
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
