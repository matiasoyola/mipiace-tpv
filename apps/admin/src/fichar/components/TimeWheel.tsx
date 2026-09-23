// F1 · el selector de hora. NADA DE TECLEAR (ADR-018).
//
// Un `<input type="time">` abre el teclado del sistema en Android y un
// picker distinto en cada navegador, y en los dos hay que apuntar a un
// campo de dos dígitos. Aquí se elige a dedo: dos columnas, pasos de
// cinco minutos, filas de 56 px (`touch-pad`, la misma medida que las
// teclas del CashPad).
//
// Cinco minutos y no uno: nadie recuerda que salió a las 17:23, y darle a
// elegir entre sesenta filas es peor que darle doce. Si alguna vez hace
// falta el minuto exacto, lo pone la empresa desde el panel.

import { useEffect, useRef } from "react";

const HORAS = Array.from({ length: 24 }, (_, i) => i);
const MINUTOS = Array.from({ length: 12 }, (_, i) => i * 5);

function Columna({
  valores,
  valor,
  onChange,
  etiqueta,
  render,
}: {
  valores: number[];
  valor: number;
  onChange: (v: number) => void;
  etiqueta: string;
  render: (v: number) => string;
}) {
  const caja = useRef<HTMLDivElement>(null);
  const activoRef = useRef<HTMLButtonElement>(null);

  // Lo encontró el bucle visual: la columna abría en 00 y la hora elegida
  // (08) quedaba fuera de vista, así que el selector parecía vacío. Se
  // centra la fila activa al abrir. `block: "nearest"` y contenedor
  // propio para no arrastrar el scroll de la página.
  useEffect(() => {
    const c = caja.current;
    const a = activoRef.current;
    if (!c || !a) return;
    // En el frame siguiente: al abrir la hoja el contenedor todavía puede
    // no tener alto medido y el centrado saldría a cero.
    const id = requestAnimationFrame(() => {
      c.scrollTop = a.offsetTop - c.clientHeight / 2 + a.clientHeight / 2;
    });
    return () => cancelAnimationFrame(id);
  }, [valor]);

  return (
    <div className="flex-1">
      <div className="mb-1.5 text-center text-[11px] font-medium uppercase tracking-[0.08em] text-slate-400">
        {etiqueta}
      </div>
      <div
        ref={caja}
        // `relative` no es decoración: sin él, `offsetTop` de la fila se
        // mide contra la hoja entera y el centrado deja la columna en
        // mitad de la lista. Lo enseñó la segunda pasada del bucle visual.
        className="relative h-[224px] snap-y snap-mandatory overflow-y-auto rounded-2xl bg-mipiace-stone"
        role="listbox"
        aria-label={etiqueta}
      >
        {valores.map((v) => {
          const activo = v === valor;
          return (
            <button
              key={v}
              ref={activo ? activoRef : undefined}
              type="button"
              role="option"
              aria-selected={activo}
              onClick={() => onChange(v)}
              className={`flex h-touch-pad w-full snap-center items-center justify-center text-[22px] tabular-nums transition-colors ${
                activo
                  ? "bg-mipiace-coral font-semibold text-white"
                  : "text-mipiace-ink-soft hover:bg-slate-100"
              }`}
            >
              {render(v)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function TimeWheel({
  value,
  onChange,
}: {
  /** "HH:MM" */
  value: string;
  onChange: (next: string) => void;
}) {
  const [hh, mm] = value.split(":").map(Number);
  const hora = Number.isFinite(hh) ? hh! : 0;
  // El valor puede venir de una hora real (17:23) que no cae en la
  // rejilla: se ancla al múltiplo de cinco más cercano por abajo para que
  // la columna tenga siempre una fila marcada.
  const minuto = Math.floor((Number.isFinite(mm) ? mm! : 0) / 5) * 5;
  const dos = (n: number) => String(n).padStart(2, "0");

  return (
    <div>
      <div className="mb-4 text-center">
        <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-slate-400">
          Nueva hora
        </div>
        <div className="text-[40px] font-semibold leading-tight tabular-nums tracking-[-0.025em] text-mipiace-ink">
          {dos(hora)}:{dos(minuto)}
        </div>
      </div>
      <div className="flex gap-3">
        <Columna
          etiqueta="Hora"
          valores={HORAS}
          valor={hora}
          onChange={(v) => onChange(`${dos(v)}:${dos(minuto)}`)}
          render={dos}
        />
        <Columna
          etiqueta="Minutos"
          valores={MINUTOS}
          valor={minuto}
          onChange={(v) => onChange(`${dos(hora)}:${dos(v)}`)}
          render={dos}
        />
      </div>
    </div>
  );
}
