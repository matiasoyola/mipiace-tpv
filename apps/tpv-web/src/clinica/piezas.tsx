// clinica-5 · las piezas sueltas de las pantallas clínicas.
//
// Tarjeta, sección, chip, segmentos, el aviso de error y los tres
// formateadores. Vivían dentro de `SesionPodologia.tsx` cuando la sesión
// era una pantalla; ahora son cinco tarjetas en tres ficheros y las cinco
// usan las mismas piezas.
//
// Se mueven aquí y no se copian por lo de siempre, que en una pantalla
// táctil se nota más que en otras: el `min-h-touch` de un chip y el
// `h-touch` de un segmento son el peldaño de 48 px de la casa
// (`docs/design/tokens.md` §4), y la segunda copia es la que un día sale
// a 44 y nadie lo mide.

import type React from "react";

export function Tarjeta(props: {
  titulo: string;
  sub?: string;
  /** El chip de color del tipo de visita, a la derecha del título. */
  insignia?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    // `px-3` por debajo de 640 px y no `px-5`, Y LA CUENTA ESTÁ MEDIDA:
    // a 320 px de ancho, con los 16 px de la página a cada lado quedan
    // 288, y con 20 px de tarjeta a cada lado quedaban 248 — o sea un pie
    // de 248 px en vez de los 264 nominales, y una zona de **45,1 px**.
    // Pasaba el mínimo del prompt (44) y no el de la casa (48).
    //
    // Lo cazó la MEDICIÓN DE LA CAPTURA, no un test: el test del mapa
    // calcula sobre el ancho nominal y el ancho nominal era correcto. Con
    // 12 px a cada lado quedan exactamente 264 y la zona vuelve a 48,4.
    <div className="bg-white border border-slate-200 rounded-3xl px-3 sm:px-5 py-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-[16.5px] font-semibold m-0 text-mipiace-ink">
            {props.titulo}
          </h2>
          {props.sub && (
            <div className="text-[13px] text-slate-500 mt-0.5">{props.sub}</div>
          )}
        </div>
        {props.insignia}
      </div>
      <div className="mt-3">{props.children}</div>
    </div>
  );
}

export function Seccion(props: {
  titulo: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-4 first:mt-0">
      <div className="text-[13px] font-medium text-mipiace-ink-soft mb-2">
        {props.titulo}
      </div>
      {props.children}
    </div>
  );
}

export function Chip(props: {
  on: boolean;
  suave?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  const activo = props.suave
    ? "bg-mipiace-coral-soft text-mipiace-coral-dark border-mipiace-coral"
    : "bg-mipiace-coral text-white border-mipiace-coral font-medium";
  return (
    <button
      type="button"
      aria-pressed={props.on}
      disabled={props.disabled}
      onClick={props.onClick}
      className={`min-h-touch px-3.5 rounded-2xl border-[1.5px] text-[14px] ${
        props.on ? activo : "bg-white border-slate-200 text-mipiace-ink"
      } disabled:opacity-45 disabled:cursor-not-allowed`}
    >
      {props.children}
    </button>
  );
}

export function Segmentos<T extends string>(props: {
  opciones: ReadonlyArray<readonly [T, string]>;
  valor: T | null;
  onElegir: (v: T) => void;
}) {
  return (
    <div className="flex gap-2">
      {props.opciones.map(([id, texto]) => (
        <button
          key={id}
          type="button"
          aria-pressed={props.valor === id}
          onClick={() => props.onElegir(id)}
          className={`flex-1 h-touch rounded-2xl font-medium text-[14px] ${
            props.valor === id
              ? "bg-mipiace-ink text-white"
              : "bg-mipiace-stone text-mipiace-ink"
          }`}
        >
          {texto}
        </button>
      ))}
    </div>
  );
}

/**
 * Los botones grandes de acto del mockup: dos líneas, con la palabra del
 * paciente debajo de la de la podóloga («Fresado · uñas gruesas»).
 *
 * Son más altos que un chip a propósito: se tocan con el guante puesto y
 * con la paciente delante, y son lo que la podóloga más va a pulsar de
 * toda la pantalla.
 */
export function BotonDeActo(props: {
  on: boolean;
  titulo: string;
  sub?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={props.on}
      onClick={props.onClick}
      className={`relative min-h-[76px] rounded-[18px] border-2 px-2 py-2 flex flex-col items-center justify-center gap-0.5 text-center font-medium text-[15px] ${
        props.on
          ? "bg-mipiace-coral-soft border-mipiace-coral text-mipiace-coral-dark"
          : "bg-mipiace-stone border-transparent text-mipiace-ink"
      }`}
    >
      {props.on && (
        <span
          aria-hidden
          className="absolute top-1.5 right-2 text-[13px] leading-none"
        >
          ✓
        </span>
      )}
      {props.titulo}
      {props.sub && (
        <span className="font-normal text-[12px] text-slate-500">
          {props.sub}
        </span>
      )}
    </button>
  );
}

export function Mal(props: { children: React.ReactNode }) {
  return (
    <div className="bg-red-50 text-red-700 rounded-2xl px-4 py-3 text-[13.5px]">
      {props.children}
    </div>
  );
}

export function euros(n: number): string {
  return `${n.toFixed(2).replace(".", ",")} €`;
}

export function hora(iso: string): string {
  return new Date(iso).toLocaleTimeString("es-ES", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function diaCorto(iso: string): string {
  return new Date(iso).toLocaleDateString("es-ES", {
    day: "numeric",
    month: "short",
  });
}

/**
 * «4 semanas», «ayer», «hace 3 días» · cuánto lleva algo apuntado.
 *
 * Lo usa la banda de «Hoy toca», y existe porque el pendiente guarda la
 * fecha en la que se apuntó POR PRIMERA VEZ (`desde`) y lo que la podóloga
 * necesita leer de un vistazo no es la fecha: es cuánto tiempo lleva eso
 * sin hacerse. «4 semanas desde la cirugía» es la frase del mockup.
 *
 * El reloj entra por parámetro para poder probarla sin esperar un mes.
 */
export function cuantoHace(iso: string, ahora: Date = new Date()): string {
  const dias = Math.floor((+ahora - +new Date(iso)) / 86_400_000);
  if (!Number.isFinite(dias) || dias < 0) return diaCorto(iso);
  if (dias === 0) return "hoy";
  if (dias === 1) return "ayer";
  if (dias < 14) return `hace ${dias} días`;
  const semanas = Math.floor(dias / 7);
  if (semanas < 9) return `hace ${semanas} semanas`;
  const meses = Math.floor(dias / 30);
  return meses === 1 ? "hace un mes" : `hace ${meses} meses`;
}
