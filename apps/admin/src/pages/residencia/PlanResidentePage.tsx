// residencia-2 (D-53) · EL PLAN DE UN RESIDENTE, y la vista «HOY».
//
// Se llega desde su ficha. Dos mitades:
//
//   · **el plan**: sus líneas vivas agrupadas por turno, con el histórico
//     de lo cerrado detrás de un botón. Añadir, quitar y cambiar la
//     frecuencia.
//   · **«hoy»**: lo que `queToca` dice que le tocaría, turno por turno.
//     **Es la prueba de que el plan está bien ANTES de que la puerta
//     exista** — y es la razón por la que esta vista está en este bloque y
//     no en residencia-3.
//
// ── Por qué una pantalla propia y no el modal de la ficha ────────────
//
// El prompt dice «en su ficha», y de ahí se llega. Pero el plan de un
// dependiente son veinte líneas en cuatro grupos más una vista de hoy con
// ocho rondas nocturnas: dentro de un modal, a 320 px, eso es un scroll
// que no acaba. La ficha lleva el botón; el plan tiene su sitio.
//
// ── Lo que una línea cerrada significa ───────────────────────────────
//
// Que ya no toca, no que no haya pasado. Las cerradas se quedan y se
// pueden ver: «¿qué le tocaba a doña Carmen el 3 de marzo?» es una
// pregunta que una residencia tiene que poder contestar a una familia, a
// la Consejería o a un juzgado.

import { useEffect, useState } from "react";
import { ArrowLeft, History, Plus, Trash2, X } from "lucide-react";
import { Link, useParams } from "react-router-dom";

import { AdminShell } from "../../AdminShell.js";
import { api, ApiError } from "../../api.js";
import {
  CenteredLoader,
  FieldError,
  OutlineButton,
  PrimaryButton,
} from "../../ui.js";
import {
  CAPA_LABEL,
  NIVEL_LABEL,
  frecuenciaCorta,
  horaDe,
  type Capa,
  type ControlDisponible,
  type FrecuenciaUI,
  type LineaDelPlan,
  type MomentoDelDia,
  type NivelDependencia,
  type OcurrenciaDeHoy,
  type TipoDeFrecuencia,
  type TurnoCorto,
} from "./lib.js";
import { Pastilla, SelectorDeFrecuencia } from "./frecuencia-ui.js";

interface Plan {
  residente: {
    // alta-minima · los dos pueden ser `null`: un residente creado con
    // sólo el nombre no tiene nivel, y sin nivel no se precarga plan.
    dependencyLevel: NivelDependencia | null;
    admissionDate: string | null;
    dischargeDate: string | null;
  };
  lineas: LineaDelPlan[];
  cerradas: LineaDelPlan[];
  disponibles: ControlDisponible[];
  turnos: TurnoCorto[];
  momentos: MomentoDelDia[];
}

interface Hoy {
  dia: string;
  porTurno: Array<{
    code: string;
    name: string;
    desde: string;
    hasta: string;
    ocurrencias: OcurrenciaDeHoy[];
  }>;
  sinTurno: OcurrenciaDeHoy[];
  total: number;
  aDemanda: Array<{ controlCode: string; nombre: string }>;
}

export function PlanResidentePage() {
  const { clientId } = useParams<{ clientId: string }>();
  const [plan, setPlan] = useState<Plan | null>(null);
  const [hoy, setHoy] = useState<Hoy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [verHistorico, setVerHistorico] = useState(false);
  const [anadiendo, setAnadiendo] = useState(false);
  const [editando, setEditando] = useState<LineaDelPlan | null>(null);

  async function recargar() {
    try {
      const [p, h] = await Promise.all([
        api<Plan>(`/residencia/residentes/${clientId}/plan`),
        api<Hoy>(`/residencia/residentes/${clientId}/plan/hoy`),
      ]);
      setPlan(p);
      setHoy(h);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Error inesperado");
    }
  }

  useEffect(() => {
    void recargar();
  }, [clientId]);

  if (error && !plan) {
    return (
      <AdminShell title="Plan de cuidados">
        <FieldError message={error} />
        <div className="mt-4">
          <Link
            to="/admin/residencia/residentes"
            className="text-[13.5px] text-mipiace-ink underline"
          >
            Volver a Residentes
          </Link>
        </div>
      </AdminShell>
    );
  }
  if (!plan || !hoy) return <CenteredLoader label="Cargando el plan…" />;

  async function quitar(l: LineaDelPlan) {
    try {
      await api(`/residencia/residentes/${clientId}/plan/${l.id}`, { method: "DELETE" });
      void recargar();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Error inesperado");
    }
  }

  // Las líneas agrupadas por el turno en que caen. Un control que cuelga de
  // momentos o de un reloj (`EVERY_N_HOURS`) no tiene un turno propio: va
  // en «a lo largo del día», que es donde la auxiliar lo busca.
  const porTurno = plan.turnos.map((t) => ({
    turno: t,
    lineas: plan.lineas.filter((l) => (l.frecuencia.shiftCodes ?? []).includes(t.code)),
  }));
  const sueltas = plan.lineas.filter((l) => (l.frecuencia.shiftCodes ?? []).length === 0);

  return (
    <AdminShell title="Plan de cuidados">
      <div className="-mt-2 mb-5">
        <Link
          to="/admin/residencia/residentes"
          className="inline-flex min-h-[44px] items-center gap-1.5 text-[13.5px] text-slate-500 hover:text-mipiace-ink"
        >
          <ArrowLeft className="h-4 w-4" /> Residentes
        </Link>
        {/* residencia-4 (D-22) · la excepción de umbral cuelga de AQUÍ y
            no del menú del centro, porque es una prescripción de esta
            persona y no una configuración. La pauta sólo el médico; la
            pantalla lo dice y el servidor lo rechaza. */}
        <Link
          to={`/admin/residencia/residentes/${clientId}/umbrales`}
          className="ml-4 inline-flex min-h-[44px] items-center gap-1.5 text-[13.5px] text-slate-500 hover:text-mipiace-ink"
        >
          Umbrales propios
        </Link>
        <p className="text-[13.5px] text-slate-500">
          {/* alta-minima · los dos con su hueco. Un `NIVEL_LABEL[null]` es
              `undefined` y un `new Date(null)` es el 1 de enero de 1970:
              lo que salía era «ingresó el 1/1/1970», que parece un dato y
              no lo es. La frase dice qué hacer, porque el plan de este
              residente depende de ello. */}
          {plan.residente.dependencyLevel
            ? NIVEL_LABEL[plan.residente.dependencyLevel]
            : "Sin nivel de dependencia · ponlo en su ficha para poder precargar el plan"}
          {plan.residente.admissionDate && (
            <>
              {" · ingresó el "}
              {new Date(plan.residente.admissionDate).toLocaleDateString("es-ES")}
            </>
          )}
          {plan.residente.dischargeDate && (
            <>
              {" "}
              · <span className="text-amber-700">
                dado de alta el{" "}
                {new Date(plan.residente.dischargeDate).toLocaleDateString("es-ES")}
              </span>
            </>
          )}
        </p>
      </div>

      {error && <FieldError message={error} />}

      {/* ══ HOY · lo que `queToca` dice ═══════════════════════════════ */}
      <section className="mb-7">
        <h2 className="mb-1 text-[16px] font-semibold text-mipiace-ink">
          Hoy le tocaría{" "}
          <span className="font-normal tabular-nums text-slate-400">{hoy.total}</span>
        </h2>
        <p className="mb-3 text-[12.5px] text-slate-500">
          Esto es exactamente lo que la tablet de su puerta va a pedir. Si algo
          sobra o falta, se arregla en el plan de abajo.
        </p>

        {hoy.total === 0 && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-[13.5px] text-amber-900">
            Hoy no le toca nada. Si es un residente nuevo, mira el plan de abajo:
            puede estar vacío o tener todos los controles desactivados.
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {hoy.porTurno.map((t) => (
            <div
              key={t.code}
              className="rounded-2xl border border-slate-200 bg-white px-4 py-3"
            >
              <p className="text-[14px] font-semibold text-mipiace-ink">
                {t.name}{" "}
                <span className="font-normal tabular-nums text-slate-400">
                  {t.desde}–{t.hasta}
                </span>
              </p>
              {t.ocurrencias.length === 0 ? (
                <p className="mt-1.5 text-[13px] text-slate-400">Nada en este turno.</p>
              ) : (
                <ul className="mt-1.5 space-y-1">
                  {t.ocurrencias.map((o, i) => (
                    <li
                      key={`${o.controlCode}-${o.at}-${i}`}
                      className="flex items-baseline gap-2 text-[13px]"
                    >
                      {/* La hora sólo en las ocurrencias de instante. Una
                          franja («durante la mañana») con hora haría creer
                          que la hidratación cutánea se incumple a las
                          08:01. */}
                      <span className="w-11 shrink-0 tabular-nums text-slate-400">
                        {o.esFranja ? "—" : horaDe(o.at)}
                      </span>
                      <span className="min-w-0 text-mipiace-ink">{o.nombre}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>

        {hoy.sinTurno.length > 0 && (
          <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4">
            <p className="text-[14px] font-semibold text-amber-900">
              {hoy.sinTurno.length} de estas cosas no caen en ningún turno
            </p>
            <p className="mt-1 text-[13px] text-amber-800">
              Hay un hueco en el cuadrante de turnos: lo que se registre a esa
              hora se quedaría sin turno. Revisa la pantalla de Turnos.
            </p>
            <ul className="mt-1.5 space-y-1 text-[13px] text-amber-800">
              {hoy.sinTurno.map((o, i) => (
                <li key={`${o.controlCode}-${i}`} className="tabular-nums">
                  {horaDe(o.at)} · {o.nombre}
                </li>
              ))}
            </ul>
          </div>
        )}

        {hoy.aDemanda.length > 0 && (
          <p className="mt-3 text-[12.5px] text-slate-500">
            Y a demanda (el botón está en la puerta, no «toca» a ninguna hora):{" "}
            {hoy.aDemanda.map((a) => a.nombre).join(", ")}.
          </p>
        )}
      </section>

      {/* ══ EL PLAN ═══════════════════════════════════════════════════ */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-[16px] font-semibold text-mipiace-ink">
          Su plan{" "}
          <span className="font-normal tabular-nums text-slate-400">
            {plan.lineas.length}
          </span>
        </h2>
        <div className="flex flex-wrap gap-2">
          {plan.cerradas.length > 0 && (
            <OutlineButton
              onClick={() => setVerHistorico(!verHistorico)}
              className="!h-10 !w-auto !px-4 !text-[13.5px]"
            >
              <History className="h-4 w-4" />{" "}
              {verHistorico ? "Ocultar" : `Histórico (${plan.cerradas.length})`}
            </OutlineButton>
          )}
          <PrimaryButton
            type="button"
            onClick={() => setAnadiendo(true)}
            className="!h-10 !w-auto !px-4 !text-[13.5px]"
          >
            <Plus className="h-4 w-4" /> Añadir control
          </PrimaryButton>
        </div>
      </div>

      {plan.lineas.length > 0 && (
        // Una línea de «cada turno» cae en los tres grupos, así que la
        // lista de abajo tiene más filas que líneas tiene el plan. Se dice
        // en vez de dejar que alguien las cuente y crea que sobran:
        // agrupar por turno es lo que la auxiliar de la tarde necesita, y
        // no se va a cambiar por el recuento.
        <p className="-mt-2 mb-3 text-[12.5px] text-slate-500">
          Una línea que toca en varios turnos aparece en cada uno de ellos.
        </p>
      )}

      {plan.lineas.length === 0 && (
        <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-[13.5px] text-amber-900">
          Su plan está vacío. Si acaba de ingresar, puede que la plantilla de su
          nivel no lleve nada: míralo en Plantillas por nivel.
        </div>
      )}

      {porTurno.map(({ turno, lineas }) =>
        lineas.length === 0 ? null : (
          <GrupoDePlan
            key={turno.code}
            titulo={turno.name}
            subtitulo={`${turno.startsAt ?? ""}–${turno.endsAt ?? ""}`}
            lineas={lineas}
            onEditar={setEditando}
            onQuitar={(l) => void quitar(l)}
          />
        ),
      )}
      {sueltas.length > 0 && (
        <GrupoDePlan
          titulo="A lo largo del día"
          subtitulo="momentos del día, cada N horas o a demanda"
          lineas={sueltas}
          onEditar={setEditando}
          onQuitar={(l) => void quitar(l)}
        />
      )}

      {verHistorico && (
        <section className="mt-6">
          <h3 className="mb-2 text-[15px] font-semibold text-mipiace-ink">
            Líneas cerradas
          </h3>
          <p className="mb-2 text-[12.5px] text-slate-500">
            Ya no tocan, pero no se borran: así se puede reconstruir qué le
            tocaba cualquier día de atrás.
          </p>
          <ul className="space-y-1.5">
            {plan.cerradas.map((l) => (
              <li
                key={l.id}
                className="rounded-xl border border-slate-100 bg-slate-50/60 px-3 py-2 text-[13px]"
              >
                <span className="font-medium text-slate-600">{l.nombre}</span>{" "}
                <span className="text-slate-500">· {l.frecuenciaEnPalabras}</span>
                <span className="block text-[12px] tabular-nums text-slate-400">
                  {new Date(l.desde).toLocaleDateString("es-ES")} →{" "}
                  {l.hasta ? new Date(l.hasta).toLocaleDateString("es-ES") : "—"}
                  {l.motivoDeCierre ? ` · ${l.motivoDeCierre}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {anadiendo && (
        <ModalAnadirAlPlan
          disponibles={plan.disponibles}
          turnos={plan.turnos}
          momentos={plan.momentos}
          onClose={() => setAnadiendo(false)}
          onGuardar={async (controlCode, frecuencia) => {
            try {
              await api(`/residencia/residentes/${clientId}/plan`, {
                method: "POST",
                body: { controlCode, frecuencia },
              });
              setAnadiendo(false);
              void recargar();
            } catch (err) {
              setError(err instanceof ApiError ? err.message : "Error inesperado");
            }
          }}
        />
      )}

      {editando && (
        <ModalCambiarFrecuencia
          linea={editando}
          // Las que el control admite, de la lista de disponibles si está, y
          // si no (porque ya está en el plan) las que la API dijo del
          // control. Se recalcula al recargar.
          permitidas={
            plan.disponibles.find((d) => d.code === editando.controlCode)?.puedeElegir
              .frecuencias ?? [editando.frecuencia.kind]
          }
          turnos={plan.turnos}
          momentos={plan.momentos}
          onClose={() => setEditando(null)}
          onGuardar={async (frecuencia, motivo) => {
            try {
              await api(`/residencia/residentes/${clientId}/plan`, {
                method: "POST",
                body: { controlCode: editando.controlCode, frecuencia, motivo },
              });
              setEditando(null);
              void recargar();
            } catch (err) {
              setError(err instanceof ApiError ? err.message : "Error inesperado");
            }
          }}
        />
      )}
    </AdminShell>
  );
}

function GrupoDePlan({
  titulo,
  subtitulo,
  lineas,
  onEditar,
  onQuitar,
}: {
  titulo: string;
  subtitulo: string;
  lineas: LineaDelPlan[];
  onEditar: (l: LineaDelPlan) => void;
  onQuitar: (l: LineaDelPlan) => void;
}) {
  return (
    <section className="mb-4">
      <h3 className="mb-2 text-[14.5px] font-semibold text-mipiace-ink">
        {titulo}{" "}
        <span className="font-normal tabular-nums text-slate-400">{subtitulo}</span>
      </h3>
      <ul className="space-y-2">
        {lineas.map((l) => (
          <li
            key={l.id}
            className="flex items-start gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3"
          >
            <button
              type="button"
              onClick={() => onEditar(l)}
              className="min-h-[44px] min-w-0 flex-1 text-left"
            >
              <span className="block text-[14.5px] font-medium text-mipiace-ink">
                {l.nombre}
              </span>
              <span className="block text-[12.5px] text-slate-500">
                {l.frecuenciaEnPalabras}
                {/* De dónde salió. Importa porque es lo que decide qué
                    sobrevive a un cambio de nivel: lo manual no se toca. */}
                {l.source === "MANUAL"
                  ? " · puesto a mano"
                  : ` · de la plantilla de ${
                      l.sourceLevel ? NIVEL_LABEL[l.sourceLevel].toLowerCase() : "su nivel"
                    }`}
              </span>
              {l.controlDesactivado && (
                <span className="block text-[12.5px] text-amber-700">
                  El centro ha desactivado este control: no le toca.
                </span>
              )}
              {(l.turnoDesconocido || l.momentoDesconocido) && (
                <span className="block text-[12.5px] text-amber-700">
                  {l.turnoDesconocido
                    ? "Apunta a un turno que ya no existe: no le toca."
                    : "Apunta a un momento del día que ya no existe: no le toca."}
                </span>
              )}
            </button>
            <button
              type="button"
              aria-label={`Quitar ${l.nombre}`}
              onClick={() => onQuitar(l)}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-slate-400 hover:bg-slate-50"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Marco({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/30 px-3 py-8">
      <div className="w-full max-w-lg rounded-3xl border border-slate-200 bg-white p-6">
        <div className="mb-4 flex items-start justify-between gap-3">
          <h3 className="min-w-0 text-[16px] font-semibold text-mipiace-ink">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-slate-400 hover:bg-slate-50"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function ModalAnadirAlPlan({
  disponibles,
  turnos,
  momentos,
  onClose,
  onGuardar,
}: {
  disponibles: ControlDisponible[];
  turnos: TurnoCorto[];
  momentos: MomentoDelDia[];
  onClose: () => void;
  onGuardar: (controlCode: string, f: FrecuenciaUI) => void;
}) {
  const [elegido, setElegido] = useState<ControlDisponible | null>(null);
  const [frecuencia, setFrecuencia] = useState<FrecuenciaUI | null>(null);

  if (elegido && frecuencia) {
    return (
      <Marco title={elegido.nombre} onClose={onClose}>
        <SelectorDeFrecuencia
          valor={frecuencia}
          permitidas={elegido.puedeElegir.frecuencias}
          turnos={turnos}
          momentos={momentos}
          onChange={setFrecuencia}
        />
        <div className="mt-5">
          <PrimaryButton
            type="button"
            onClick={() => onGuardar(elegido.code, frecuencia)}
          >
            Añadir al plan
          </PrimaryButton>
        </div>
      </Marco>
    );
  }

  return (
    <Marco title="Añadir un control" onClose={onClose}>
      {(["EXEC", "OBS", "MEASURE"] as Capa[]).map((capa) => {
        const deLaCapa = disponibles.filter((c) => c.layer === capa);
        if (deLaCapa.length === 0) return null;
        return (
          <div key={capa} className="mb-4">
            <p className="mb-1.5 text-[13px] text-slate-500">{CAPA_LABEL[capa]}</p>
            <div className="flex flex-wrap gap-2">
              {deLaCapa.map((c) => (
                <Pastilla
                  key={c.code}
                  activo={false}
                  onClick={() => {
                    setElegido(c);
                    // La frecuencia que el CENTRO tiene puesta para ese
                    // control, no la de serie: es la que la dirección ya
                    // decidió, y la que se materializa en la línea.
                    setFrecuencia(c.frecuenciaPropuesta);
                  }}
                >
                  {c.nombre}
                  {c.nature === "ON_DEMAND" && (
                    <span className="ml-1 text-slate-400">· a demanda</span>
                  )}
                </Pastilla>
              ))}
            </div>
          </div>
        );
      })}
      {disponibles.length === 0 && (
        <p className="text-[13px] text-slate-500">
          Ya tiene en el plan todos los controles que el centro usa.
        </p>
      )}
    </Marco>
  );
}

/**
 * Cambiarle la frecuencia a una línea.
 *
 * Y la pantalla lo dice: **cambiarla cierra esta línea y abre otra**. No es
 * un detalle técnico que se pueda esconder — es lo que hace que «¿qué le
 * tocaba en marzo?» tenga respuesta, y lo que explica que el histórico
 * crezca cada vez que se toca algo.
 */
function ModalCambiarFrecuencia({
  linea,
  permitidas,
  turnos,
  momentos,
  onClose,
  onGuardar,
}: {
  linea: LineaDelPlan;
  permitidas: TipoDeFrecuencia[];
  turnos: TurnoCorto[];
  momentos: MomentoDelDia[];
  onClose: () => void;
  onGuardar: (f: FrecuenciaUI, motivo: string) => void;
}) {
  const [f, setF] = useState<FrecuenciaUI>(linea.frecuencia);
  const [motivo, setMotivo] = useState("");

  return (
    <Marco title={linea.nombre} onClose={onClose}>
      <SelectorDeFrecuencia
        valor={f}
        permitidas={permitidas}
        turnos={turnos}
        momentos={momentos}
        onChange={setF}
      />
      <div className="mt-4">
        <label htmlFor="plan-motivo" className="mb-1.5 block text-[13px] text-slate-500">
          Por qué (opcional)
        </label>
        <input
          id="plan-motivo"
          type="text"
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          placeholder="Lo pide la DUE"
          className="h-11 w-full rounded-xl border border-slate-200 px-3 text-[14px]"
        />
      </div>
      <p className="mt-3 text-[12.5px] text-slate-500">
        Queda como «{frecuenciaCorta(f, turnos, momentos)}». La línea de ahora se
        cierra y se abre una nueva, para que se pueda saber qué le tocaba antes.
      </p>
      <div className="mt-4">
        <PrimaryButton type="button" onClick={() => onGuardar(f, motivo.trim())}>
          Guardar
        </PrimaryButton>
      </div>
    </Marco>
  );
}
