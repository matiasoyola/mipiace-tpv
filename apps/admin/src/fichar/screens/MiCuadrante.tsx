// personal-1 (punto 10) · «MI CUADRANTE», en el móvil de cada persona.
//
// «Deja de preguntarse por WhatsApp "¿qué tengo el sábado?"». Es la mitad
// del valor del bloque para quien trabaja; la otra es que la dirección
// deje de contestarlo doce veces al día.
//
// SÓLO LECTURA, y tres decisiones de pantalla:
//
//   1. **Los cambios desde la última vez, arriba y marcados.** Lo primero
//      que alguien quiere saber al abrir esto no es qué tiene el martes:
//      es si le han cambiado algo. Con su motivo, que es lo que la
//      empresa escribió al cambiarlo.
//
//   2. **Se marcan como vistos con un toque, no al abrir.** Si se
//      marcaran al abrir, recargar la pantalla —que es lo que uno hace
//      para volver a mirarlos— los borraría.
//
//   3. **Los días vacíos no se pintan**, y en el mes en curso **tampoco
//      los que ya han pasado**. Un mes de 31 filas en las que veinte son
//      pasado es una pantalla que hay que recorrer hasta la mitad para
//      ver qué toca mañana — y la pregunta que esto contesta es «¿qué
//      tengo el sábado?», no «¿qué tuve el 3?». Lo que pasó está en «Mis
//      fichajes», que es donde se mira y donde además se corrige. Lo
//      enseñó el bucle visual: la captura del 27 de octubre abría por el
//      día 1.

import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, BellRing, CalendarDays } from "lucide-react";

import { ficharApi, FicharApiError } from "../lib/api.js";
import { diaLargo } from "../lib/format.js";

interface MiCuadranteResponse {
  month: string;
  timeZone: string;
  publicado: boolean;
  publishedAt?: string | null;
  dias: Array<{
    dia: string;
    turnos: Array<{ code: string; name: string; startsAt: string; endsAt: string }>;
    ausencia: string | null;
  }>;
  cambios: Array<{
    id: string;
    dia: string;
    antes: string | null;
    despues: string | null;
    motivo: string;
    cuando: string;
    nuevo: boolean;
  }>;
  vistoHasta: string | null;
}

const AUSENCIAS: Record<string, string> = {
  LIBRE: "Libre",
  VACACIONES: "Vacaciones",
  IT: "Baja",
  ASUNTOS_PROPIOS: "Asuntos propios",
  PERMISO: "Permiso",
};

/** El mes actual «YYYY-MM» en la zona del centro. */
function mesDe(timeZone: string, delta = 0): string {
  const hoy = new Date();
  const d = new Date(hoy.getFullYear(), hoy.getMonth() + delta, 15);
  return new Intl.DateTimeFormat("en-CA", { timeZone })
    .format(d)
    .slice(0, 7);
}

export function MiCuadrante({
  timeZone,
  onVolver,
}: {
  timeZone: string;
  onVolver: () => void;
}) {
  const [mes, setMes] = useState(() => mesDe(timeZone));
  const [data, setData] = useState<MiCuadranteResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async (m: string) => {
    setData(null);
    setError(null);
    try {
      setData(
        await ficharApi<MiCuadranteResponse>(`/fichaje/v1/cuadrante?month=${m}`),
      );
    } catch (err) {
      setError(
        err instanceof FicharApiError
          ? err.message
          : "No hemos podido cargar tu cuadrante. Prueba otra vez en un momento.",
      );
    }
  }, []);

  useEffect(() => {
    void cargar(mes);
  }, [cargar, mes]);

  async function marcarVistos() {
    try {
      await ficharApi("/fichaje/v1/cuadrante/visto", { method: "POST" });
      setData((d) =>
        d
          ? { ...d, cambios: d.cambios.map((c) => ({ ...c, nuevo: false })) }
          : d,
      );
    } catch {
      // Si falla, los cambios siguen marcados. Es lo correcto: lo peor que
      // puede pasar es que se vuelvan a ver, no que desaparezcan sin que
      // nadie los haya leído.
    }
  }

  const nuevos = data?.cambios.filter((c) => c.nuevo) ?? [];

  // El día de HOY en la zona del centro, para cortar el pasado.
  const hoy = new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date());
  const dias = (data?.dias ?? []).filter((d) => d.dia >= hoy);
  const pasados = (data?.dias.length ?? 0) - dias.length;

  return (
    <div className="min-h-full px-5 pb-10 pt-4">
      <div className="mb-4 flex items-center gap-3">
        <button
          type="button"
          onClick={onVolver}
          className="grid h-10 w-10 place-items-center rounded-2xl bg-white text-slate-500"
          aria-label="Volver"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h1 className="flex items-center gap-2 text-[18px] font-semibold tracking-[-0.01em] text-mipiace-ink">
          <CalendarDays className="h-5 w-5 text-slate-400" />
          Mi cuadrante
        </h1>
      </div>

      {/* Los dos meses que importan: éste y el que viene. Ni un selector
          de doce: nadie consulta su turno de marzo en noviembre. */}
      <div className="mb-4 flex gap-2">
        {[mesDe(timeZone), mesDe(timeZone, 1)].map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMes(m)}
            className={`h-10 flex-1 rounded-2xl text-[14px] transition-colors ${
              mes === m
                ? "bg-mipiace-ink text-white"
                : "bg-white text-slate-600"
            }`}
          >
            {new Intl.DateTimeFormat("es-ES", {
              month: "long",
              timeZone: "UTC",
            })
              .format(new Date(`${m}-15T12:00:00Z`))
              .replace(/^./, (c) => c.toUpperCase())}
          </button>
        ))}
      </div>

      {error && (
        <p className="rounded-2xl bg-mipiace-coral-soft px-4 py-3 text-[14px] text-mipiace-ink">
          {error}
        </p>
      )}

      {!data && !error && (
        <p className="py-8 text-center text-[15px] text-slate-400">Un momento…</p>
      )}

      {data && !data.publicado && (
        <div className="rounded-3xl bg-white px-5 py-6 text-center">
          <p className="text-[15px] text-mipiace-ink">
            Tu empresa todavía no ha publicado el cuadrante de este mes.
          </p>
          <p className="mt-1.5 text-[13px] text-slate-400">
            Cuando lo publique, aparecerá aquí con tus turnos.
          </p>
        </div>
      )}

      {data?.publicado && (
        <>
          {/* ── Lo que ha cambiado desde la última vez ───────────────── */}
          {nuevos.length > 0 && (
            <div className="mb-4 rounded-3xl bg-mipiace-coral-soft px-5 py-4">
              <p className="flex items-center gap-2 text-[15px] font-medium text-mipiace-ink">
                <BellRing className="h-4 w-4 text-mipiace-coral-dark" />
                {nuevos.length === 1
                  ? "Te han cambiado un día"
                  : `Te han cambiado ${nuevos.length} días`}
              </p>
              <ul className="mt-2 space-y-2">
                {nuevos.map((c) => (
                  <li key={c.id} className="text-[13.5px] text-slate-700">
                    <span className="font-medium text-mipiace-ink">
                      {diaLargo(c.dia, timeZone)}
                    </span>
                    : {etiqueta(c.antes)} → {etiqueta(c.despues)}
                    <span className="block text-[12.5px] text-slate-500">
                      «{c.motivo}»
                    </span>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                onClick={() => void marcarVistos()}
                className="mt-3 h-11 w-full rounded-2xl bg-white text-[14.5px] font-medium text-mipiace-ink"
              >
                Entendido
              </button>
            </div>
          )}

          {dias.length === 0 ? (
            <div className="rounded-3xl bg-white px-5 py-6 text-center">
              <p className="text-[15px] text-mipiace-ink">
                {pasados > 0
                  ? "No te queda nada este mes."
                  : "Este mes no tienes nada puesto."}
              </p>
              <p className="mt-1.5 text-[13px] text-slate-400">
                {pasados > 0
                  ? "Mira el mes que viene ahí arriba."
                  : "Si crees que debería haber algo, pregúntale a tu empresa."}
              </p>
            </div>
          ) : (
            <ul className="space-y-2">
              {dias.map((d) => (
                <li
                  key={d.dia}
                  className="flex items-center gap-3 rounded-2xl bg-white px-4 py-3"
                >
                  <span className="min-w-0 flex-1 truncate text-[14.5px] text-mipiace-ink">
                    {diaLargo(d.dia, timeZone)}
                  </span>
                  {d.ausencia ? (
                    <span className="shrink-0 rounded-xl bg-mipiace-stone px-2.5 py-1 text-[13px] text-slate-600">
                      {AUSENCIAS[d.ausencia] ?? d.ausencia}
                    </span>
                  ) : (
                    <span className="shrink-0 text-right">
                      {d.turnos.map((t) => (
                        <span
                          key={t.code}
                          className="block text-[13.5px] tabular-nums text-mipiace-ink"
                        >
                          {t.startsAt}–{t.endsAt}
                          <span className="ml-1.5 text-[12px] text-slate-400">
                            {t.code}
                          </span>
                        </span>
                      ))}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}

          <p className="mt-4 text-center text-[12px] text-slate-400">
            {pasados > 0 && (
              <>
                Los {pasados} día{pasados === 1 ? "" : "s"} que ya{" "}
                {pasados === 1 ? "pasó" : "han pasado"} están en «Mis
                fichajes».
                <br />
              </>
            )}
            Esto es lo que tu empresa ha publicado. Si algo no cuadra,
            díselo: desde aquí no se cambia.
          </p>
        </>
      )}
    </div>
  );
}

function etiqueta(valor: string | null): string {
  if (valor == null) return "nada";
  return AUSENCIAS[valor] ?? valor;
}
