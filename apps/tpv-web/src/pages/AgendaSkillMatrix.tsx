// B-reservas-9 · La matriz servicio × profesional, editable desde los dos
// lados (P7).
//
// El inventario, no la configuración: si nadie sabe hacer un servicio, ese
// servicio no se ofrece. Se llega aquí de un clic desde la tarjeta nº 1 del
// panel de salud, y sin salir de la agenda.
//
// Las dos vías, y ninguna esconde el dato:
//   · la cabecera de una COLUMNA abre la ficha del profesional (qué da);
//   · la cabecera de una FILA abre la ficha del servicio (quién lo da).
// Las dos escriben la misma matriz, contra el mismo módulo del servidor.
//
// Lo apagado que sigue gobernando el comportamiento SE VE (regla nº 1 de la
// auditoría): un servicio inactivo que conserva profesionales sale marcado,
// y un profesional sin perfil de agenda —o con el perfil inactivo— también,
// porque sus casillas están puestas y el motor no las mira.

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  Search,
  X,
} from "lucide-react";

import { ApiError } from "../api.js";
import {
  fetchSkillMatrix,
  saveServiceStaff,
  saveStaffSkills,
  type MatrixService,
  type MatrixStaff,
  type SkillMatrix,
} from "../lib/agenda-health.js";

type Sheet =
  | { kind: "service"; id: string }
  | { kind: "staff"; id: string }
  | null;

export function AgendaSkillMatrix(props: {
  onClose: () => void;
  /** El servicio que venía señalado desde la tarjeta nº 1. */
  focusServiceId: string | null;
}) {
  const { onClose, focusServiceId } = props;
  const [data, setData] = useState<SkillMatrix | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [texto, setTexto] = useState("");
  // Filtro «sólo los que no tienen a nadie»: la ruta de un clic desde la
  // tarjeta nº 1. Viene encendido cuando se llega desde ella.
  const [soloSinNadie, setSoloSinNadie] = useState(focusServiceId !== null);
  const [sheet, setSheet] = useState<Sheet>(
    focusServiceId ? { kind: "service", id: focusServiceId } : null,
  );
  const [guardando, setGuardando] = useState<string | null>(null);
  const [avisoGuardado, setAvisoGuardado] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await fetchSkillMatrix());
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "No se ha podido leer la matriz.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const servicios = useMemo(() => {
    const t = texto.trim().toLowerCase();
    return (data?.services ?? []).filter((s) => {
      if (soloSinNadie && cuentaUtil(s, data?.staff ?? []) >= s.staffRequired)
        return false;
      return t === "" || s.name.toLowerCase().includes(t);
    });
  }, [data, texto, soloSinNadie]);

  const editable = data?.editable ?? false;

  // Pesimista y con estado visible (§H7 d): la celda dice «guardando…» y no
  // se puede tocar dos veces. Nada de que parezca guardado y no lo esté.
  const escribirServicio = useCallback(
    async (service: MatrixService, staffUserIds: string[]) => {
      setGuardando(service.id);
      setError(null);
      try {
        const saved = await saveServiceStaff(service.id, staffUserIds);
        setData((prev) =>
          prev
            ? {
                ...prev,
                services: prev.services.map((s) =>
                  s.id === service.id ? { ...s, staffUserIds: saved } : s,
                ),
              }
            : prev,
        );
        setAvisoGuardado(`Guardado: ${service.name}`);
      } catch (err) {
        setError(
          err instanceof ApiError ? err.message : "No se ha podido guardar.",
        );
      } finally {
        setGuardando(null);
      }
    },
    [],
  );

  const escribirProfesional = useCallback(
    async (staff: MatrixStaff, serviceIds: string[]) => {
      setGuardando(staff.userId);
      setError(null);
      try {
        const saved = await saveStaffSkills(staff.userId, serviceIds);
        const puestos = new Set(saved);
        setData((prev) =>
          prev
            ? {
                ...prev,
                services: prev.services.map((s) => ({
                  ...s,
                  staffUserIds: puestos.has(s.id)
                    ? [...new Set([...s.staffUserIds, staff.userId])]
                    : s.staffUserIds.filter((u) => u !== staff.userId),
                })),
              }
            : prev,
        );
        setAvisoGuardado(`Guardado: ${staff.displayName}`);
      } catch (err) {
        setError(
          err instanceof ApiError ? err.message : "No se ha podido guardar.",
        );
      } finally {
        setGuardando(null);
      }
    },
    [],
  );

  useEffect(() => {
    if (!avisoGuardado) return;
    const t = window.setTimeout(() => setAvisoGuardado(null), 2500);
    return () => window.clearTimeout(t);
  }, [avisoGuardado]);

  const servicioAbierto =
    sheet?.kind === "service"
      ? (data?.services.find((s) => s.id === sheet.id) ?? null)
      : null;
  const staffAbierto =
    sheet?.kind === "staff"
      ? (data?.staff.find((s) => s.userId === sheet.id) ?? null)
      : null;

  return (
    <div className="fixed inset-0 z-[55] bg-mipiace-stone flex flex-col font-sans">
      <div className="flex items-center gap-2 px-3 md:px-6 h-16 bg-white border-b border-slate-200 shrink-0">
        <button
          onClick={onClose}
          className="h-11 w-11 shrink-0 rounded-2xl hover:bg-slate-100 flex items-center justify-center text-mipiace-ink"
          aria-label="Volver"
        >
          <ArrowLeft className="w-5 h-5" strokeWidth={2.25} />
        </button>
        <h1 className="text-[17px] font-semibold text-mipiace-ink truncate">
          Quién da cada servicio
        </h1>
      </div>

      {/* Buscador + el filtro que trae la tarjeta nº 1 */}
      <div className="px-3 md:px-6 py-2 bg-white border-b border-slate-100 shrink-0 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[180px]">
          <Search
            className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
            strokeWidth={2.25}
            aria-hidden
          />
          <input
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder="Buscar servicio"
            aria-label="Buscar servicio"
            className="w-full min-h-touch pl-9 pr-3 rounded-2xl bg-mipiace-stone border border-slate-200 text-[14px]"
          />
        </div>
        <button
          onClick={() => setSoloSinNadie((v) => !v)}
          aria-pressed={soloSinNadie}
          className={`min-h-touch px-4 rounded-2xl text-[13px] font-medium border ${
            soloSinNadie
              ? "bg-mipiace-ink text-white border-mipiace-ink"
              : "bg-white text-mipiace-ink border-slate-200 hover:bg-slate-50"
          }`}
        >
          Sólo los que no tienen a nadie
        </button>
      </div>

      {!editable && !loading && (
        <p className="px-3 md:px-6 py-2 text-[13px] text-slate-600 bg-amber-50 border-b border-amber-200 shrink-0">
          Esta sesión puede mirar la matriz pero no cambiarla: la cambia el
          propietario o la encargada.
        </p>
      )}
      {error && (
        <div className="px-3 md:px-6 py-2 bg-red-50 border-b border-red-200 shrink-0 flex flex-wrap items-center gap-3">
          <span className="text-[13px] text-red-800">{error}</span>
          <button
            onClick={() => void load()}
            className="h-11 px-4 rounded-2xl bg-white border border-red-200 hover:bg-red-100 text-[13px] font-medium text-red-700"
          >
            Reintentar
          </button>
        </div>
      )}
      {avisoGuardado && (
        <p
          data-test="aviso-guardado"
          className="px-3 md:px-6 py-2 text-[13px] text-emerald-800 bg-emerald-50 border-b border-emerald-200 shrink-0"
        >
          {avisoGuardado}
        </p>
      )}

      {/* `relative`: la ficha se pinta `absolute` en compacto y sin esto se
          anclaba al overlay entero, tapando la cabecera y el buscador — el
          contexto de dónde estás desaparecía al abrir un servicio. */}
      <div className="relative flex-1 flex overflow-hidden">
        <div className="flex-1 overflow-auto">
          {loading && !data ? (
            <EsqueletoMatriz />
          ) : (data?.staff.length ?? 0) === 0 ? (
            <SinProfesionales />
          ) : servicios.length === 0 ? (
            <p className="p-8 text-center text-[14px] text-slate-600 max-w-md mx-auto">
              {soloSinNadie
                ? "Ningún servicio se ha quedado sin profesional. Eso es una buena noticia."
                : "No hay servicios que casen con la búsqueda."}
            </p>
          ) : (
            <Rejilla
              servicios={servicios}
              staff={data?.staff ?? []}
              editable={editable}
              guardando={guardando}
              onAbrirServicio={(id) => setSheet({ kind: "service", id })}
              onAbrirStaff={(id) => setSheet({ kind: "staff", id })}
              onToggle={(service, userId) =>
                void escribirServicio(
                  service,
                  service.staffUserIds.includes(userId)
                    ? service.staffUserIds.filter((u) => u !== userId)
                    : [...service.staffUserIds, userId],
                )
              }
            />
          )}
        </div>

        {/* Panel al lado SIN scrim (decisión de B4): no tapa la matriz. */}
        {servicioAbierto && (
          <FichaServicio
            service={servicioAbierto}
            staff={data?.staff ?? []}
            editable={editable}
            guardando={guardando === servicioAbierto.id}
            onClose={() => setSheet(null)}
            onGuardar={(ids) => void escribirServicio(servicioAbierto, ids)}
          />
        )}
        {staffAbierto && (
          <FichaProfesional
            staff={staffAbierto}
            services={data?.services ?? []}
            editable={editable}
            guardando={guardando === staffAbierto.userId}
            onClose={() => setSheet(null)}
            onGuardar={(ids) => void escribirProfesional(staffAbierto, ids)}
          />
        )}
      </div>
    </div>
  );
}

// ── La rejilla ────────────────────────────────────────────────────────
//
// Una sola rejilla con scroll horizontal, también a 320 px: la columna del
// servicio se queda fija y las de profesionales pasan por debajo del dedo.
// Nada de una segunda implementación "para móvil" que se desincronice.
//
// Y la cabecera se queda fija también HACIA ARRIBA. Con el catálogo real de
// un centro —decenas de servicios, no los tres de las capturas— a la quinta
// fila ya no se ve de quién es cada columna, y marcar una casilla pasa a ser
// adivinar. Es el filo del §4.4 del cierre: la rejilla no se había mirado
// nunca a escala de catálogo de verdad.

function Rejilla(props: {
  servicios: MatrixService[];
  staff: MatrixStaff[];
  editable: boolean;
  guardando: string | null;
  onAbrirServicio: (id: string) => void;
  onAbrirStaff: (id: string) => void;
  onToggle: (service: MatrixService, userId: string) => void;
}) {
  const { servicios, staff, editable, guardando } = props;
  return (
    <table className="border-collapse text-[13px]">
      <thead>
        <tr>
          <th className="sticky left-0 top-0 z-30 bg-mipiace-stone text-left p-2 min-w-[180px] max-w-[240px]">
            <span className="text-[12px] font-medium text-slate-500">
              Servicio
            </span>
          </th>
          {staff.map((s) => (
            <th
              key={s.userId}
              className="sticky top-0 z-20 bg-mipiace-stone p-1 align-bottom"
            >
              <button
                onClick={() => props.onAbrirStaff(s.userId)}
                className="w-14 min-h-touch px-1 rounded-xl hover:bg-slate-200 flex flex-col items-center justify-end gap-0.5"
                title={undefined}
              >
                <span className="text-[12px] font-medium text-mipiace-ink truncate w-full">
                  {s.displayName}
                </span>
                {!s.active && (
                  <span className="text-[10px] text-amber-700 leading-tight">
                    {s.hasProfile ? "inactiva" : "sin perfil"}
                  </span>
                )}
              </button>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {servicios.map((svc) => {
          const utiles = cuentaUtil(svc, staff);
          const falta = utiles < svc.staffRequired;
          return (
            <tr key={svc.id} className="border-t border-slate-200">
              <th
                scope="row"
                className={`sticky left-0 z-10 text-left p-1 min-w-[180px] max-w-[240px] ${
                  falta ? "bg-mipiace-coral-soft" : "bg-mipiace-stone"
                }`}
              >
                <button
                  onClick={() => props.onAbrirServicio(svc.id)}
                  className="w-full min-h-touch px-2 py-1 rounded-xl hover:bg-white/70 text-left"
                >
                  <span className="block text-[13.5px] font-medium text-mipiace-ink">
                    {svc.name}
                  </span>
                  <span className="block text-[11.5px] text-slate-600 tabular-nums">
                    {utiles}/{svc.staffRequired}
                    {!svc.agendable && " · sin ficha de agenda"}
                    {!svc.active && " · apagado"}
                  </span>
                </button>
              </th>
              {staff.map((s) => {
                const puesto = svc.staffUserIds.includes(s.userId);
                const ocupado = guardando === svc.id;
                return (
                  <td key={s.userId} className="p-1 text-center">
                    <button
                      onClick={() => props.onToggle(svc, s.userId)}
                      disabled={!editable || ocupado}
                      aria-pressed={puesto}
                      aria-label={`${svc.name} · ${s.displayName}`}
                      className={`w-14 h-touch rounded-xl border flex items-center justify-center disabled:opacity-50 ${
                        puesto
                          ? s.active
                            ? "bg-emerald-50 border-emerald-300 text-emerald-700"
                            : "bg-amber-50 border-amber-300 text-amber-700"
                          : "bg-white border-slate-200 text-slate-300 hover:bg-slate-50"
                      }`}
                    >
                      {puesto ? (
                        s.active ? (
                          <Check className="w-5 h-5" strokeWidth={2.25} />
                        ) : (
                          <AlertTriangle className="w-5 h-5" strokeWidth={2.25} />
                        )
                      ) : (
                        <X className="w-4 h-4" strokeWidth={2.25} />
                      )}
                    </button>
                  </td>
                );
              })}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// ── Lado B · la ficha del servicio: quién lo da ───────────────────────

function FichaServicio(props: {
  service: MatrixService;
  staff: MatrixStaff[];
  editable: boolean;
  guardando: boolean;
  onClose: () => void;
  onGuardar: (staffUserIds: string[]) => void;
}) {
  const { service, staff, editable, guardando } = props;
  return (
    <Ficha
      titulo={service.name}
      subtitulo={`Quién lo da · necesita ${service.staffRequired} a la vez`}
      guardando={guardando}
      onClose={props.onClose}
      avisos={[
        staff.length === 0
          ? "Todavía no hay ningún profesional con perfil de agenda: dalos de alta en el panel de administración, en Profesionales."
          : null,
        !service.agendable
          ? "Sin ficha de agenda: aunque tenga profesionales, no se puede reservar."
          : null,
        !service.active
          ? "Servicio apagado en el catálogo. Sus profesionales siguen puestos y se enseñan."
          : null,
      ]}
    >
      {staff.map((s) => {
        const puesto = service.staffUserIds.includes(s.userId);
        return (
          <FilaCheck
            key={s.userId}
            label={s.displayName}
            detail={
              s.active
                ? null
                : s.hasProfile
                  ? "Perfil de agenda inactivo: el motor no la tiene en cuenta"
                  : "Sin perfil de agenda: el motor no la tiene en cuenta"
            }
            checked={puesto}
            disabled={!editable || guardando}
            onToggle={() =>
              props.onGuardar(
                puesto
                  ? service.staffUserIds.filter((u) => u !== s.userId)
                  : [...service.staffUserIds, s.userId],
              )
            }
          />
        );
      })}
    </Ficha>
  );
}

// ── Lado A · la ficha del profesional: qué servicios da ───────────────

function FichaProfesional(props: {
  staff: MatrixStaff;
  services: MatrixService[];
  editable: boolean;
  guardando: boolean;
  onClose: () => void;
  onGuardar: (serviceIds: string[]) => void;
}) {
  const { staff, services, editable, guardando } = props;
  const suyos = services
    .filter((s) => s.staffUserIds.includes(staff.userId))
    .map((s) => s.id);
  // El lado A es la vía EN BLOQUE, y es la que se usa de verdad el primer
  // día: una peluquería con decenas de servicios y tres profesionales que
  // los dan casi todos. Sin esto, arreglar lo que la tarjeta 1 señala son
  // cientos de toques en una tablet y una petición por toque — "se arregla
  // en un clic" sólo sería verdad para el caso de un servicio.
  //
  // Sólo suma, nunca vacía: quitar en bloque lo que alguien ya daba borra
  // trabajo de verdad y no lo pide nadie. Quitar se hace casilla a casilla.
  const enBloque = services
    .filter((s) => s.agendable && s.active && !suyos.includes(s.id))
    .map((s) => s.id);
  return (
    <Ficha
      titulo={staff.displayName}
      subtitulo="Qué servicios da"
      guardando={guardando}
      onClose={props.onClose}
      avisos={[
        staff.hasProfile
          ? staff.active
            ? null
            : "Perfil de agenda inactivo: lo que marques aquí no dará huecos hasta que se active."
          : "Sin perfil de agenda: lo que marques aquí no dará huecos hasta que se dé de alta.",
      ]}
    >
      {editable && enBloque.length > 0 && (
        <button
          data-test="marcar-agendables"
          onClick={() => props.onGuardar([...suyos, ...enBloque])}
          disabled={guardando}
          className="w-full min-h-touch px-3 rounded-xl bg-mipiace-ink text-white text-[13.5px] font-medium disabled:opacity-50"
        >
          {enBloque.length === 1
            ? "Marcar también el servicio agendable que le falta"
            : `Marcar también los ${enBloque.length} servicios agendables que le faltan`}
        </button>
      )}
      {services.map((s) => {
        const puesto = suyos.includes(s.id);
        return (
          <FilaCheck
            key={s.id}
            label={s.name}
            detail={
              !s.agendable
                ? "Sin ficha de agenda"
                : !s.active
                  ? "Apagado en el catálogo"
                  : null
            }
            checked={puesto}
            disabled={!editable || guardando}
            onToggle={() =>
              props.onGuardar(
                puesto ? suyos.filter((id) => id !== s.id) : [...suyos, s.id],
              )
            }
          />
        );
      })}
    </Ficha>
  );
}

// ── Piezas compartidas por las dos fichas ─────────────────────────────

function Ficha(props: {
  titulo: string;
  subtitulo: string;
  guardando: boolean;
  avisos: Array<string | null>;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <aside
      data-test="ficha-matriz"
      className="w-full max-w-full sm:w-[360px] shrink-0 bg-white border-l border-slate-200 flex flex-col absolute sm:static inset-0 sm:inset-auto z-10"
    >
      <div className="flex items-start gap-2 p-3 border-b border-slate-200 shrink-0">
        <div className="flex-1 min-w-0">
          <h2 className="text-[15px] font-semibold text-mipiace-ink truncate">
            {props.titulo}
          </h2>
          <p className="text-[12.5px] text-slate-600">{props.subtitulo}</p>
        </div>
        <button
          onClick={props.onClose}
          className="h-11 w-11 shrink-0 rounded-2xl hover:bg-slate-100 flex items-center justify-center"
          aria-label="Cerrar"
        >
          <X className="w-5 h-5" strokeWidth={2.25} />
        </button>
      </div>
      {props.avisos.filter(Boolean).map((aviso) => (
        <p
          key={aviso}
          className="px-3 py-2 text-[12.5px] text-amber-900 bg-amber-50 border-b border-amber-200 shrink-0"
        >
          {aviso}
        </p>
      ))}
      {props.guardando && (
        <p className="px-3 py-2 text-[12.5px] text-slate-600 bg-mipiace-stone border-b border-slate-200 shrink-0">
          Guardando…
        </p>
      )}
      <div className="flex-1 overflow-auto p-2 flex flex-col gap-1">
        {props.children}
      </div>
    </aside>
  );
}

function FilaCheck(props: {
  label: string;
  detail: string | null;
  checked: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      onClick={props.onToggle}
      disabled={props.disabled}
      aria-pressed={props.checked}
      className={`w-full min-h-touch-pad px-3 py-2 rounded-xl border flex items-center gap-3 text-left disabled:opacity-50 ${
        props.checked
          ? "bg-emerald-50 border-emerald-300"
          : "bg-white border-slate-200 hover:bg-slate-50"
      }`}
    >
      <span
        className={`w-6 h-6 shrink-0 rounded-lg border flex items-center justify-center ${
          props.checked
            ? "bg-emerald-600 border-emerald-600 text-white"
            : "border-slate-300 text-transparent"
        }`}
        aria-hidden
      >
        <Check className="w-4 h-4" strokeWidth={2.5} />
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-[14px] text-mipiace-ink">{props.label}</span>
        {props.detail && (
          <span className="block text-[12px] text-slate-600">
            {props.detail}
          </span>
        )}
      </span>
    </button>
  );
}

/**
 * Sin una sola columna la matriz no es una pantalla difícil de leer: es una
 * pantalla en la que no se puede hacer nada. Y es exactamente el estado de
 * un centro el día que enciende la agenda —ningún `staff_profile` todavía—,
 * que es justo cuando más falta hace que lo diga en vez de dejar una lista
 * en rojo sin una sola casilla que tocar.
 */
function SinProfesionales() {
  return (
    <div
      data-test="matriz-sin-profesionales"
      className="p-8 max-w-md mx-auto text-center flex flex-col gap-2"
    >
      <p className="text-[15px] font-semibold text-mipiace-ink">
        Todavía no hay ningún profesional con perfil de agenda.
      </p>
      <p className="text-[14px] text-slate-600">
        Hasta que lo haya, ningún servicio se puede dar: la agenda no
        ofrecerá ni una hora, por completo que esté el catálogo.
      </p>
      <p className="text-[14px] text-slate-600">
        Los perfiles se dan de alta en el panel de administración, en
        Profesionales. Cuando estén, aquí se dice quién da cada servicio.
      </p>
    </div>
  );
}

function EsqueletoMatriz() {
  return (
    <div data-test="esqueleto-matriz" className="p-3 flex flex-col gap-2" aria-hidden>
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <div key={i} className="flex items-center gap-2">
          <div className="h-11 w-[180px] rounded-xl bg-white border border-slate-200 animate-pulse" />
          {[0, 1, 2].map((j) => (
            <div
              key={j}
              className="h-11 w-14 rounded-xl bg-white border border-slate-200 animate-pulse"
            />
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * Cuántos profesionales de los marcados CUENTAN de verdad: los que tienen
 * perfil de agenda activo. Es la misma cuenta que hace el motor, y por eso
 * una casilla marcada de alguien inactivo no llena el hueco.
 */
function cuentaUtil(service: MatrixService, staff: MatrixStaff[]): number {
  const activos = new Set(staff.filter((s) => s.active).map((s) => s.userId));
  return service.staffUserIds.filter((u) => activos.has(u)).length;
}
