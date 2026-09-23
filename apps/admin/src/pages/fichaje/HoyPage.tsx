// F1 · "Hoy": la pantalla de entrada del control horario (ADR-018).
//
// Contesta tres preguntas de un vistazo y nada más: quién está dentro y
// desde qué hora, quién no ha fichado, y qué hay que mirar.
//
// Los avisos son del MES, no del día: una salida olvidada de ayer no
// aparece en "hoy" por definición, y es justo la que hay que ver.

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CloudOff, PencilLine, TriangleAlert } from "lucide-react";

import { AdminShell } from "../../AdminShell.js";
import { api, ApiError } from "../../api.js";
import { CenteredLoader, FieldError } from "../../ui.js";
import { diaLargo, duracion, horaLocal, type TodayResponse } from "./lib.js";

export function HoyPage() {
  const [data, setData] = useState<TodayResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ahora, setAhora] = useState(() => Date.now());

  useEffect(() => {
    let vivo = true;
    api<TodayResponse>("/admin/fichaje/today")
      .then((r) => vivo && setData(r))
      .catch((err) => {
        if (!vivo) return;
        setError(err instanceof ApiError ? err.message : "Error inesperado");
      });
    return () => {
      vivo = false;
    };
  }, []);

  // El "lleva dentro" corre: es la única cifra de esta pantalla que
  // cambia sola, y verla parada haría dudar de si está actualizada.
  useEffect(() => {
    const t = window.setInterval(() => setAhora(Date.now()), 30_000);
    return () => window.clearInterval(t);
  }, []);

  if (error) {
    return (
      <AdminShell title="Control horario">
        <FieldError message={error} />
      </AdminShell>
    );
  }
  if (!data) return <CenteredLoader label="Cargando…" />;

  const avisos =
    data.alerts.missingExit.length +
    data.alerts.corrected.length +
    data.alerts.sentOffline.length;

  return (
    <AdminShell title="Control horario">
      <p className="-mt-2 mb-5 text-[13.5px] text-slate-500">
        {diaLargo(data.date, data.timeZone)}. Quién está dentro, quién no ha
        fichado y lo que conviene mirar.
      </p>

      <div className="grid gap-5 lg:grid-cols-2">
        <section>
          <h2 className="mb-3 text-[16px] font-semibold text-mipiace-ink">
            Dentro ahora{" "}
            <span className="font-normal tabular-nums text-slate-400">
              {data.inside.length}
            </span>
          </h2>
          {data.inside.length === 0 ? (
            <Vacio texto="Nadie ha fichado la entrada todavía." />
          ) : (
            <ul className="space-y-2.5">
              {data.inside.map((p) => (
                <li
                  key={p.entryId}
                  className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3"
                >
                  <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500" />
                  <span className="text-[14.5px] font-medium text-mipiace-ink">
                    {p.employeeName}
                  </span>
                  <span className="ml-auto text-right">
                    <span className="block text-[14px] tabular-nums text-mipiace-ink">
                      {horaLocal(p.startedAt, data.timeZone)}
                    </span>
                    <span className="block text-[12px] tabular-nums text-slate-400">
                      {duracion(
                        Math.max(
                          0,
                          Math.floor(
                            (ahora - new Date(p.startedAt).getTime()) / 60_000,
                          ),
                        ),
                      )}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h2 className="mb-3 text-[16px] font-semibold text-mipiace-ink">
            Sin fichar hoy{" "}
            <span className="font-normal tabular-nums text-slate-400">
              {data.notClockedIn.length}
            </span>
          </h2>
          {data.notClockedIn.length === 0 ? (
            <Vacio texto="Todo el mundo ha fichado." />
          ) : (
            <ul className="space-y-2.5">
              {data.notClockedIn.map((p) => (
                <li
                  key={p.employeeId}
                  className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3"
                >
                  <span className="h-2 w-2 shrink-0 rounded-full bg-slate-300" />
                  <span className="text-[14.5px] text-mipiace-ink-soft">
                    {p.employeeName}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <h2 className="mb-3 mt-8 text-[16px] font-semibold text-mipiace-ink">
        Avisos{" "}
        <span className="font-normal tabular-nums text-slate-400">{avisos}</span>
      </h2>
      {avisos === 0 ? (
        <Vacio texto="Nada que mirar este mes." />
      ) : (
        <div className="space-y-2.5">
          {data.alerts.missingExit.map((a) => (
            <Aviso
              key={`e-${a.entryId}`}
              icono={<TriangleAlert className="h-4 w-4 text-mipiace-coral-dark" />}
              tono="coral"
              quien={a.employeeName}
              que="no fichó la salida"
              cuando={`${diaLargo(a.date, data.timeZone)} · entró a las ${horaLocal(a.startedAt, data.timeZone)}`}
              mes={a.date.slice(0, 7)}
              empleado={a.employeeId}
            />
          ))}
          {data.alerts.corrected.map((a) => (
            <Aviso
              key={`c-${a.entryId}`}
              icono={<PencilLine className="h-4 w-4 text-slate-500" />}
              tono="neutro"
              quien={a.employeeName}
              que={a.corrections === 1 ? "corrigió un fichaje" : `corrigió un fichaje ${a.corrections} veces`}
              cuando={diaLargo(a.date, data.timeZone)}
              mes={a.date.slice(0, 7)}
              empleado={a.employeeId}
            />
          ))}
          {data.alerts.sentOffline.map((a) => (
            <Aviso
              key={`o-${a.entryId}`}
              icono={<CloudOff className="h-4 w-4 text-slate-500" />}
              tono="neutro"
              quien={a.employeeName}
              que="fichó sin conexión"
              cuando={diaLargo(a.date, data.timeZone)}
              mes={a.date.slice(0, 7)}
              empleado={a.employeeId}
            />
          ))}
        </div>
      )}
    </AdminShell>
  );
}

function Vacio({ texto }: { texto: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 text-[13px] text-slate-500">
      {texto}
    </div>
  );
}

function Aviso({
  icono,
  tono,
  quien,
  que,
  cuando,
  mes,
  empleado,
}: {
  icono: React.ReactNode;
  tono: "coral" | "neutro";
  quien: string;
  que: string;
  cuando: string;
  mes: string;
  empleado: string;
}) {
  return (
    <Link
      to={`/admin/fichaje/registro?mes=${mes}&empleado=${empleado}`}
      className={`flex items-center gap-3 rounded-2xl border px-4 py-3 transition-colors ${
        tono === "coral"
          ? "border-mipiace-coral/30 bg-mipiace-coral-soft hover:bg-mipiace-coral-soft/70"
          : "border-slate-200 bg-white hover:bg-mipiace-stone"
      }`}
    >
      {icono}
      <span className="text-[14px] text-mipiace-ink">
        <span className="font-medium">{quien}</span> {que}
      </span>
      <span className="ml-auto text-right text-[12.5px] text-slate-500">
        {cuando}
      </span>
    </Link>
  );
}
