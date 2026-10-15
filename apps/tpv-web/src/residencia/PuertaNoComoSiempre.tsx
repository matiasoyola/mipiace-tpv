// residencia-3 (D-64) · **PANTALLA 4: NO ESTÁ COMO SIEMPRE.**
//
// «Toca solo lo que no está como siempre. Lo demás se guarda como
// siempre.» Las siete dimensiones `OBS` como tarjetas con «como siempre»
// debajo del nombre; la que se toca se abre con sus opciones ordinales en
// fila y la elegida en coral. Abajo «Además, algo no va bien» y «Guardar ·
// 1 cambio».
//
// ── LA FRASE DE ARRIBA ES LA PROMESA, Y SE CUMPLE EN LA BASE ────────
//
// «Lo demás se guarda como siempre» no es un consuelo: `noComoSiempre()`
// escribe `1 + (N−1)` filas, las cambiadas con su valor y **las demás con
// su valor de normalidad**. Si sólo se guardara la cambiada, el día que
// doña Carmen está inquieta su ánimo constaría y su piel no — y la piel
// sin registrar no significa «estaba bien», significa «nadie la miró»,
// que es justo la distinción que D-16 existe para no perder.
//
// ── EL COSTE ES PROPORCIONAL A LA ANOMALÍA (D-16) ───────────────────
//
// Siete tarjetas cerradas, y sólo se abre la que se toca. Un día con algo
// son dos toques más que un día normal, no catorce. Y por eso las
// opciones de la dimensión abierta van EN FILA y no en una lista: una
// lista son un toque para abrirla, uno para elegir y la pantalla tapada.
//
// ── Y EL BOTÓN DICE CUÁNTOS CAMBIOS LLEVA ───────────────────────────
//
// «Guardar · 1 cambio». Es la confirmación de que lo que se ha tocado es
// lo que se va a guardar, antes de guardarlo: en una pantalla de siete
// tarjetas con las opciones dentro, el error fácil es tocar una sin querer.

import { useState } from "react";

import type { ControlDeLaPuerta } from "./puerta-tipos.js";

export interface PuertaNoComoSiempreProps {
  nombreDelResidente: string;
  /** Las dimensiones `OBS` activas, con su valor «como siempre». */
  dimensiones: Array<ControlDeLaPuerta & { comoSiempre: string }>;
  onGuardar: (cambiadas: Record<string, string>) => void;
  onTambienAlgoNoVaBien: (cambiadas: Record<string, string>) => void;
  onVolver: () => void;
}

export function PuertaNoComoSiempre({
  nombreDelResidente,
  dimensiones,
  onGuardar,
  onTambienAlgoNoVaBien,
  onVolver,
}: PuertaNoComoSiempreProps) {
  const [abierta, setAbierta] = useState<string | null>(null);
  const [cambiadas, setCambiadas] = useState<Record<string, string>>({});
  const cuantos = Object.keys(cambiadas).length;

  function elegir(code: string, opcion: string) {
    setCambiadas((c) => {
      const copia = { ...c };
      // Volver a tocar la opción elegida la quita: es el «me he
      // equivocado» sin tener que salir y entrar, y sin un botón «quitar»
      // que ocuparía sitio en cada tarjeta.
      if (copia[code] === opcion) delete copia[code];
      else copia[code] = opcion;
      return copia;
    });
  }

  return (
    <div className="min-h-screen bg-mipiace-stone text-mipiace-ink flex flex-col">
      <header className="px-8 pt-7 pb-4">
        <h1 className="text-[40px] font-semibold leading-tight">
          {nombreDelResidente}
        </h1>
        <p className="mt-2 text-[24px] text-slate-600">
          Toca solo lo que no está como siempre. Lo demás se guarda como
          siempre.
        </p>
      </header>

      <main className="flex-1 px-8 pb-4 grid gap-4 md:grid-cols-2 lg:grid-cols-3 content-start">
        {dimensiones.map((d) => {
          const elegida = cambiadas[d.code];
          const estaAbierta = abierta === d.code;
          return (
            <section
              key={d.code}
              className={`rounded-2xl border-2 p-5 ${
                elegida
                  ? "border-mipiace-coral bg-mipiace-coral-soft"
                  : "border-slate-200 bg-white"
              }`}
            >
              <button
                type="button"
                onClick={() => setAbierta(estaAbierta ? null : d.code)}
                className="w-full min-h-touch-pad text-left"
              >
                <span className="block text-[26px] font-medium">{d.name}</span>
                <span className="block text-[19px] text-slate-500">
                  {elegida
                    ? etiquetaDe(d, elegida)
                    : etiquetaDe(d, d.comoSiempre)}
                </span>
              </button>
              {estaAbierta && (
                <div className="mt-4 flex flex-wrap gap-2">
                  {d.opciones
                    // El «como siempre» no se ofrece: esta pantalla existe
                    // para decir qué se desvía, y su valor por defecto ya
                    // es la normalidad. Ofrecerlo sería pedir que alguien
                    // confirme lo que ya está confirmado.
                    .filter((o) => !o.isAsUsual)
                    .map((o) => (
                      <button
                        key={o.code}
                        type="button"
                        onClick={() => elegir(d.code, o.code)}
                        className={`min-h-touch-pad rounded-xl px-5 text-[20px] font-medium border-2 ${
                          elegida === o.code
                            ? "bg-mipiace-coral text-white border-mipiace-coral"
                            : "bg-white border-slate-300"
                        }`}
                      >
                        {o.label}
                      </button>
                    ))}
                </div>
              )}
            </section>
          );
        })}
      </main>

      <footer className="px-8 pb-7 flex flex-wrap items-center gap-4">
        <button
          type="button"
          onClick={onVolver}
          className="min-h-tap-puerta rounded-xl border-2 border-slate-300 px-7 text-[22px]"
        >
          Volver
        </button>
        <button
          type="button"
          onClick={() => onTambienAlgoNoVaBien(cambiadas)}
          className="min-h-tap-puerta rounded-xl bg-amber-500 text-white px-7 text-[22px] font-semibold"
        >
          Además, algo no va bien
        </button>
        <button
          type="button"
          onClick={() => onGuardar(cambiadas)}
          className="flex-1 min-h-tap-puerta rounded-2xl bg-mipiace-coral text-white text-[28px] font-semibold active:bg-mipiace-coral-dark"
        >
          Guardar{cuantos > 0 ? ` · ${cuantos} cambio${cuantos > 1 ? "s" : ""}` : ""}
        </button>
      </footer>
    </div>
  );
}

function etiquetaDe(d: ControlDeLaPuerta, code: string): string {
  return d.opciones.find((o) => o.code === code)?.label ?? code;
}
