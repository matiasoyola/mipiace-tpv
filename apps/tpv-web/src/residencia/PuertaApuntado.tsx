// residencia-3 (D-64) · **PANTALLA 6: APUNTADO.**
//
// Check verde, «Apuntado», «Firmado por Ana López · 10:42 · turno de
// mañana», la lista de lo apuntado con su estado («en la tablet» /
// «enviado»), «Deshacer el último» y «Seguir en la 112». Vuelve a reposo a
// los 10 s sin tocar nada.
//
// Y si no hay red, la banda ámbar de arriba: **«Sin red. Lo guarda la
// tablet y lo envía sola cuando vuelva. No hay que repetir nada.»**
//
// ── POR QUÉ ESA BANDA ES LA PANTALLA ────────────────────────────────
//
// Porque es lo único que hace que una auxiliar con el wifi caído no
// vuelva a apuntarlo en un papel «por si acaso». La promesa del bloque es
// que no se pierde nada; esta frase es donde se dice. Y dice las tres
// cosas en orden: qué pasa (lo guarda la tablet), qué va a pasar (lo envía
// sola) y qué tiene que hacer ella (nada).
//
// ── «en la tablet» / «enviado», fila a fila ─────────────────────────
//
// No un resumen. Lo que el mockup pide es ver CADA cosa con su estado, y
// la razón es la confianza: «3 registros pendientes» no dice si el que le
// preocupa es uno de ellos.
//
// ── «Deshacer el último» ────────────────────────────────────────────
//
// Sólo quien lo firmó y sólo aquí (decisión 1). Es «me he equivocado de
// botón», no «quiero que esto no conste»: pasada esta pantalla lo que hay
// es una corrección, que deja las dos cosas a la vista. Y **anula, no
// borra**: la fila se queda con quién la deshizo y cuándo.

export interface LineaApuntada {
  /** El uuid que generó la tablet. */
  id: string;
  /** Lo que se lee: «Como siempre», «Cambio postural», «Algo no va bien». */
  texto: string;
  /** `true` mientras siga en la cola de esta tablet. */
  enLaTablet: boolean;
  /** Puesto si el servidor lo rechazó: la frase que mandó. */
  rechazo?: string | null;
}

export interface PuertaApuntadoProps {
  numeroDeHabitacion: string;
  firmadoPor: string;
  hora: string;
  nombreDelTurno: string | null;
  /** `false` = banda ámbar. Es `navigator.onLine` más lo que diga la cola:
   *  una tablet «online» detrás de un punto muerto de wifi también tiene
   *  cosas en la tablet, y lo que la auxiliar necesita saber es si lo suyo
   *  ha salido. */
  hayRed: boolean;
  lineas: LineaApuntada[];
  /** `null` = no se puede deshacer (no es suyo, o ya salió de la ventana). */
  onDeshacer: (() => void) | null;
  onSeguir: () => void;
}

export function PuertaApuntado({
  numeroDeHabitacion,
  firmadoPor,
  hora,
  nombreDelTurno,
  hayRed,
  lineas,
  onDeshacer,
  onSeguir,
}: PuertaApuntadoProps) {
  const pendientes = lineas.filter((l) => l.enLaTablet).length;
  const rechazados = lineas.filter((l) => l.rechazo);

  return (
    <div className="min-h-screen bg-mipiace-stone text-mipiace-ink flex flex-col">
      {(!hayRed || pendientes > 0) && (
        <p
          role="status"
          className="bg-amber-100 text-amber-900 px-8 py-5 text-[24px]"
        >
          Sin red. Lo guarda la tablet y lo envía sola cuando vuelva.{" "}
          <strong>No hay que repetir nada.</strong>
        </p>
      )}

      {/* Lo rechazado va ARRIBA y en rojo, no escondido al final: es lo
          único de esta pantalla que alguien tiene que mirar. */}
      {rechazados.length > 0 && (
        <div
          role="alert"
          className="bg-red-50 text-red-800 px-8 py-5 text-[22px]"
        >
          {rechazados.length === 1
            ? "Una cosa no se pudo apuntar:"
            : `${rechazados.length} cosas no se pudieron apuntar:`}
          <ul className="mt-2 list-disc pl-6">
            {rechazados.map((l) => (
              <li key={l.id}>
                {l.texto} — {l.rechazo}
              </li>
            ))}
          </ul>
          <p className="mt-2">Avisa a dirección: no se arregla reintentando.</p>
        </div>
      )}

      <main className="flex-1 flex flex-col items-center justify-center px-8 py-8">
        <span
          aria-hidden="true"
          className="w-24 h-24 rounded-full bg-emerald-500 text-white text-[56px] leading-[96px] text-center font-bold"
        >
          ✓
        </span>
        <h1 className="mt-6 text-[52px] font-semibold">Apuntado</h1>
        <p className="mt-3 text-[24px] text-slate-600">
          Firmado por {firmadoPor} · {hora}
          {nombreDelTurno ? ` · turno de ${nombreDelTurno.toLowerCase()}` : ""}
        </p>

        <ul className="mt-8 w-full max-w-[720px] space-y-3">
          {lineas.map((l) => (
            <li
              key={l.id}
              className="flex items-center justify-between rounded-xl bg-white border border-slate-200 px-6 py-4 text-[22px]"
            >
              <span>{l.texto}</span>
              <span
                className={
                  l.rechazo
                    ? "text-red-700"
                    : l.enLaTablet
                      ? "text-amber-700"
                      : "text-emerald-700"
                }
              >
                {l.rechazo
                  ? "no se pudo"
                  : l.enLaTablet
                    ? "en la tablet"
                    : "enviado"}
              </span>
            </li>
          ))}
        </ul>
      </main>

      <footer className="px-8 pb-8 flex flex-wrap items-center gap-4 justify-center">
        {onDeshacer && (
          <button
            type="button"
            onClick={onDeshacer}
            className="min-h-tap-puerta rounded-xl border-2 border-slate-400 px-8 text-[24px]"
          >
            Deshacer el último
          </button>
        )}
        <button
          type="button"
          onClick={onSeguir}
          className="min-h-tap-puerta rounded-2xl bg-mipiace-coral text-white px-10 text-[26px] font-semibold active:bg-mipiace-coral-dark"
        >
          Seguir en la {numeroDeHabitacion}
        </button>
      </footer>
    </div>
  );
}
