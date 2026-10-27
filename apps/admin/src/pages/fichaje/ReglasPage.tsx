// personal-1 (decisiones 4 y 7) · LAS REGLAS DEL CUADRANTE Y SUS TURNOS.
//
// Dos cosas en una pantalla porque se miran juntas: los parámetros que
// `comprobarCuadrante` usa, y la **cobertura mínima** de cada turno, que
// es el otro número que la primera regla necesita.
//
// Lo que esta pantalla deja claro, y es la mitad de su trabajo: **de qué
// norma sale cada número**. Un centro que vea «12 horas» sin el art. 34.3
// al lado lo baja a ocho el día que le cuadre mal el cuadrante.
//
// Y los dos ajustes del super-admin salen aquí de SÓLO LECTURA: quien
// dirige el centro tiene que poder ver por qué le avisan a las 12:00 y no
// a las 14:00, aunque no pueda cambiarlo.

import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Scale, TriangleAlert } from "lucide-react";

import { AdminShell } from "../../AdminShell.js";
import { api, ApiError } from "../../api.js";
import {
  CenteredLoader,
  FieldError,
  PrimaryButton,
  SuccessBanner,
} from "../../ui.js";
import type { AvisoDeTurnosRow, TurnoRow } from "./lib.js";

interface ReglasResponse {
  reglas: {
    ratioAtencionDirecta: number;
    minutosDeJornadaCompleta: number;
    horasDescansoDiario: number;
    horasDescansoSemanal: number;
    diasComputoSemanal: number;
    minutosDeTolerancia: number;
  };
  conRatioDeResidencia: boolean;
  delSuperAdmin: {
    fichajeMaxOpenHours: number;
    fichajeShiftMarginHours: number;
  };
}

export function ReglasPage() {
  const [data, setData] = useState<ReglasResponse | null>(null);
  const [turnos, setTurnos] = useState<TurnoRow[]>([]);
  const [avisosDeTurnos, setAvisosDeTurnos] = useState<AvisoDeTurnosRow[]>([]);
  const [form, setForm] = useState<ReglasResponse["reglas"] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const cargar = useCallback(() => {
    Promise.all([
      api<ReglasResponse>("/admin/fichaje/reglas"),
      api<{ turnos: TurnoRow[]; avisos: AvisoDeTurnosRow[] }>(
        "/admin/fichaje/turnos",
      ),
    ])
      .then(([r, t]) => {
        setData(r);
        setForm(r.reglas);
        setTurnos(t.turnos);
        setAvisosDeTurnos(t.avisos);
      })
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : "Error inesperado"),
      );
  }, []);

  useEffect(cargar, [cargar]);

  async function guardar() {
    if (!form) return;
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      await api("/admin/fichaje/reglas", { method: "PATCH", body: form });
      setOk("Guardado. El cuadrante se comprueba con estas reglas desde ahora.");
      cargar();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Error inesperado");
    } finally {
      setBusy(false);
    }
  }

  async function cambiarCobertura(turno: TurnoRow, valor: string) {
    const n = valor.trim() === "" ? null : Number(valor);
    setBusy(true);
    try {
      const r = await api<{ avisos: AvisoDeTurnosRow[] }>(
        `/admin/fichaje/turnos/${turno.id}`,
        { method: "PATCH", body: { minCoverage: n } },
      );
      setTurnos((ts) =>
        ts.map((t) => (t.id === turno.id ? { ...t, coberturaMinima: n } : t)),
      );
      setAvisosDeTurnos(r.avisos);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Error inesperado");
      cargar();
    } finally {
      setBusy(false);
    }
  }

  if (error && !data) {
    return (
      <AdminShell title="Reglas del cuadrante">
        <FieldError message={error} />
      </AdminShell>
    );
  }
  if (!data || !form) return <CenteredLoader label="Cargando…" />;

  return (
    <AdminShell title="Reglas del cuadrante">
      <Link
        to="/admin/settings"
        className="-mt-2 mb-4 inline-flex items-center gap-1.5 text-[13px] text-slate-500 hover:text-mipiace-ink"
      >
        <ArrowLeft className="h-4 w-4" />
        Ajustes
      </Link>

      {ok && <SuccessBanner message={ok} />}
      {error && <FieldError message={error} />}

      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="flex items-center gap-2 text-[15px] font-semibold text-mipiace-ink">
          <Scale className="h-4 w-4 text-slate-400" />
          Lo que el cuadrante comprueba
        </h2>
        <p className="mt-1 text-[12.5px] text-slate-500">
          Cada regla dice de dónde sale. Los avisos{" "}
          <strong>no impiden publicar</strong>: publicar con avisos pide
          confirmarlo y los deja apuntados.
        </p>

        <div className="mt-4 space-y-5">
          {data.conRatioDeResidencia && (
            <Numero
              etiqueta="Ratio de atención directa"
              ayuda="Jornadas completas de atención directa por plaza ocupada. 0,20 es el Decreto 2/2022 de Castilla-La Mancha; cambia por comunidad y por acreditación, y por eso es un parámetro y no una constante."
              valor={String(form.ratioAtencionDirecta).replace(".", ",")}
              onChange={(v) =>
                setForm({
                  ...form,
                  ratioAtencionDirecta: Number(v.replace(",", ".")) || 0,
                })
              }
              sufijo="jornadas por plaza"
            />
          )}
          <Numero
            etiqueta="Qué es una jornada completa"
            ayuda="En minutos. Es el divisor de la ratio: tres auxiliares de cuatro horas no son tres jornadas."
            valor={String(form.minutosDeJornadaCompleta)}
            onChange={(v) =>
              setForm({ ...form, minutosDeJornadaCompleta: Number(v) || 480 })
            }
            sufijo="minutos"
          />
          <Numero
            etiqueta="Descanso entre jornadas"
            ayuda="Art. 34.3 del Estatuto de los Trabajadores: doce horas entre el fin de una jornada y el inicio de la siguiente. Una noche que acaba a las 08:00 y una mañana que empieza a las 08:00 dejan cero."
            valor={String(form.horasDescansoDiario)}
            onChange={(v) =>
              setForm({ ...form, horasDescansoDiario: Number(v) || 0 })
            }
            sufijo="horas"
          />
          <Numero
            etiqueta="Descanso semanal"
            ayuda="Art. 37.1 del ET: día y medio ininterrumpido, o sea treinta y seis horas."
            valor={String(form.horasDescansoSemanal)}
            onChange={(v) =>
              setForm({ ...form, horasDescansoSemanal: Number(v) || 0 })
            }
            sufijo="horas"
          />
          <Numero
            etiqueta="Período de cómputo del descanso semanal"
            ayuda="El mismo artículo permite computarlo «por períodos de hasta catorce días». Con 7, cada semana tiene que tener su día y medio; con 14, cada quincena."
            valor={String(form.diasComputoSemanal)}
            onChange={(v) =>
              setForm({ ...form, diasComputoSemanal: Number(v) || 7 })
            }
            sufijo="días (de 7 a 14)"
          />
          <Numero
            etiqueta="Tolerancia de «no ha fichado»"
            ayuda="Cuántos minutos después del inicio de su turno se avisa en «Hoy» de que alguien no ha fichado. Con cero, el aviso sale cada mañana a las 08:01 y se apaga a las 08:06."
            valor={String(form.minutosDeTolerancia)}
            onChange={(v) =>
              setForm({ ...form, minutosDeTolerancia: Number(v) || 0 })
            }
            sufijo="minutos"
          />
        </div>

        <div className="mt-5 sm:max-w-[220px]">
          <PrimaryButton type="button" onClick={guardar} busy={busy}>
            Guardar reglas
          </PrimaryButton>
        </div>
      </section>

      {/* ── La cobertura mínima de cada turno ────────────────────────── */}
      <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="text-[15px] font-semibold text-mipiace-ink">
          Cuánta gente necesita cada turno
        </h2>
        <p className="mt-1 text-[12.5px] text-slate-500">
          Personas de <strong>atención directa</strong>. En blanco significa
          «no lo he declarado», y entonces el cuadrante no comprueba la
          cobertura de ese turno — no es lo mismo que un cero.
        </p>

        {avisosDeTurnos.length > 0 && (
          <ul className="mt-3 space-y-1.5">
            {avisosDeTurnos.map((a) => (
              <li
                key={a.problema}
                className={`flex items-start gap-2 rounded-xl px-3 py-2 text-[12.5px] ${
                  a.problema === "SIN_COBERTURA"
                    ? "bg-mipiace-stone text-slate-600"
                    : "bg-amber-50 text-slate-700"
                }`}
              >
                {a.problema !== "SIN_COBERTURA" && (
                  <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
                )}
                {a.mensaje}
              </li>
            ))}
          </ul>
        )}

        <ul className="mt-4 space-y-2.5">
          {turnos.map((t) => (
            <li
              key={t.id}
              className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 px-3.5 py-2.5"
            >
              <span className="text-[14px] font-semibold text-mipiace-ink">
                {t.code}
              </span>
              <span className="text-[13.5px] text-mipiace-ink-soft">
                {t.name}
              </span>
              <span className="text-[12.5px] tabular-nums text-slate-500">
                {t.startsAt}–{t.endsAt}
              </span>
              <label className="ml-auto flex items-center gap-2 text-[12.5px] text-slate-600">
                mínimo
                <input
                  type="number"
                  min={0}
                  max={200}
                  value={t.coberturaMinima ?? ""}
                  placeholder="—"
                  onChange={(e) =>
                    setTurnos((ts) =>
                      ts.map((x) =>
                        x.id === t.id
                          ? {
                              ...x,
                              coberturaMinima:
                                e.target.value === ""
                                  ? null
                                  : Number(e.target.value),
                            }
                          : x,
                      ),
                    )
                  }
                  onBlur={(e) => void cambiarCobertura(t, e.target.value)}
                  className="h-9 w-16 rounded-xl border border-slate-300 px-2 text-center text-[14px] tabular-nums text-mipiace-ink outline-none focus:border-mipiace-coral"
                />
              </label>
            </li>
          ))}
        </ul>
      </section>

      {/* ── Lo que no se toca desde aquí ─────────────────────────────── */}
      <section className="mt-6 rounded-2xl border border-slate-200 bg-mipiace-stone p-5">
        <h2 className="text-[15px] font-semibold text-mipiace-ink">
          Lo que decide cuándo se pregunta por una salida olvidada
        </h2>
        <p className="mt-1 text-[12.5px] text-slate-600">
          Estos dos los ajusta Mi Piace, no el centro. Están aquí para que
          sepas por qué el programa pregunta cuando pregunta.
        </p>
        <dl className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <dt className="text-[12px] font-medium text-slate-500">
              Sin turno en el cuadrante
            </dt>
            <dd className="mt-0.5 text-[13.5px] text-mipiace-ink">
              Se pregunta cuando un fichaje lleva abierto más de{" "}
              {data.delSuperAdmin.fichajeMaxOpenHours} horas.
            </dd>
          </div>
          <div>
            <dt className="text-[12px] font-medium text-slate-500">
              Con turno publicado
            </dt>
            <dd className="mt-0.5 text-[13.5px] text-mipiace-ink">
              {data.delSuperAdmin.fichajeShiftMarginHours} horas después de que
              acabe su turno. La auxiliar de noche que sale a las 08:00 y sigue
              dentro, a las{" "}
              {String(8 + data.delSuperAdmin.fichajeShiftMarginHours).padStart(
                2,
                "0",
              )}
              :00.
            </dd>
          </div>
        </dl>
      </section>
    </AdminShell>
  );
}

function Numero({
  etiqueta,
  ayuda,
  valor,
  onChange,
  sufijo,
}: {
  etiqueta: string;
  ayuda: string;
  valor: string;
  onChange: (v: string) => void;
  sufijo: string;
}) {
  return (
    <div>
      <div className="flex items-center justify-between gap-4">
        <span className="text-[14px] font-medium text-mipiace-ink">
          {etiqueta}
        </span>
        <span className="flex items-center gap-2">
          <input
            value={valor}
            onChange={(e) => onChange(e.target.value)}
            className="h-9 w-20 rounded-xl border border-slate-300 px-2 text-right text-[14px] tabular-nums text-mipiace-ink outline-none focus:border-mipiace-coral"
          />
          <span className="min-w-[110px] text-[12px] text-slate-400">
            {sufijo}
          </span>
        </span>
      </div>
      <p className="mt-1 max-w-2xl text-[12px] text-slate-400">{ayuda}</p>
    </div>
  );
}
