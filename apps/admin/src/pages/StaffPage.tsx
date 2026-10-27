// Panel de Personal + horarios (B-reservas-3). Gestiona los profesionales
// (extensión del `user` existente — ADR-R1), la matriz de servicios que da
// cada uno y sus turnos (semana tipo `rrule` + validez). Gate por
// `agendaEnabled` (ADR-R6). Vocabulario neutro: "profesional".

import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { useNavigate } from "react-router-dom";

import { AdminShell } from "../AdminShell.js";
import { api, ApiError, clearTokens, readEffectiveAuth } from "../api.js";
import {
  CenteredLoader,
  FieldError,
  OutlineButton,
  PrimaryButton,
} from "../ui.js";
import {
  COLOR_PRESETS,
  colorPropuesto,
  coloresEnUso,
} from "./StaffPage.colors.js";
// residencia-1 · la sección de residencia, en su propio fichero.
import { CuidadoEditor } from "./StaffPage.residencia.js";

// ── Tipos del contrato de la API ─────────────────────────────────────
interface StaffProfile {
  userId: string;
  displayName: string;
  active: boolean;
  color: string | null;
}
// clinica-1 · los tres nombres que se ven en pantalla. Los deriva LA API
// (`staff/routes.ts::puestoVisible`) de cruzar el rol de negocio con la
// marca sanitaria, y no esta pantalla: si cada pantalla lo dedujera por su
// cuenta, dos acabarían llamando distinto a la misma persona.
type PuestoVisible =
  | "cajero"
  | "cajero-sanitario"
  | "sanitario"
  | "propietaria"
  | "propietaria-sanitaria"
  | "encargado"
  | "encargado-sanitario";

interface ClinicaDelProfesional {
  esSanitario: boolean;
  colegiado: string | null;
  alcance: "ALL" | "SELECTION";
  puesto: PuestoVisible;
}

interface StaffRow {
  userId: string;
  alias: string | null;
  email: string;
  role: "OWNER" | "MANAGER" | "CASHIER" | "CLINICIAN";
  profile: StaffProfile | null;
  serviceIds: string[];
  skillCount: number;
  // clinica-1 · la API SIEMPRE la manda (son columnas del user). Opcional
  // en el tipo por la ventana del despliegue: los estáticos y la API se
  // publican juntos pero no se recargan a la vez, y un `row.clinica.puesto`
  // sobre un `undefined` es una pantalla en blanco. Ver `puestoDe`.
  clinica?: ClinicaDelProfesional;
}

// clinica-1 · un paciente de la selección de un sanitario.
interface PacienteAsignado {
  accessId: string;
  clientId: string;
  name: string;
  source: "APPOINTMENT" | "MANUAL";
  grantedAt: string;
}

/**
 * El puesto a pintar. Si la API es de antes del bloque (ventana de
 * despliegue), se deriva del rol: el resultado es el mismo que daba la
 * pantalla de ayer.
 */
function puestoDe(row: StaffRow): PuestoVisible {
  if (row.clinica) return row.clinica.puesto;
  switch (row.role) {
    case "OWNER":
      return "propietaria";
    case "MANAGER":
      return "encargado";
    case "CLINICIAN":
      return "sanitario";
    default:
      return "cajero";
  }
}

const PUESTO_LABEL: Record<PuestoVisible, string> = {
  cajero: "Cajero",
  "cajero-sanitario": "Cajero-sanitario",
  sanitario: "Sanitario",
  propietaria: "Propietaria",
  "propietaria-sanitaria": "Propietaria · sanitaria",
  encargado: "Encargado",
  "encargado-sanitario": "Encargado · sanitario",
};

// De dónde vino cada paciente de la selección. Es la pregunta que la
// dueña hace al mirar la lista: «¿éste lo metí yo o salió de una cita?».
const ORIGEN_LABEL: Record<PacienteAsignado["source"], string> = {
  APPOINTMENT: "De la agenda",
  MANUAL: "A mano",
};
interface ServiceRow {
  id: string;
  name: string;
}
type ShiftKind = "REGULAR" | "REINFORCEMENT" | "SWAP";
interface Shift {
  id: string;
  rrule: string;
  startTime: string;
  endTime: string;
  validFrom: string;
  validUntil: string | null;
  kind: ShiftKind;
}

// Días RFC 5545 en orden L→D con etiqueta corta ES.
const WEEKDAYS: Array<{ code: string; label: string }> = [
  { code: "MO", label: "L" },
  { code: "TU", label: "M" },
  { code: "WE", label: "X" },
  { code: "TH", label: "J" },
  { code: "FR", label: "V" },
  { code: "SA", label: "S" },
  { code: "SU", label: "D" },
];
const KIND_LABEL: Record<ShiftKind, string> = {
  REGULAR: "Regular",
  REINFORCEMENT: "Refuerzo",
  SWAP: "Cambio",
};
// Paleta de colores sugeridos para pintar la columna en la agenda.
function parseByday(rrule: string): string[] {
  const m = /BYDAY=([^;]+)/i.exec(rrule);
  return m ? m[1]!.split(",").map((d) => d.trim().toUpperCase()) : [];
}

function shiftSummary(s: Shift): string {
  const days = parseByday(s.rrule)
    .map((code) => WEEKDAYS.find((w) => w.code === code)?.label ?? code)
    .join(" ");
  const range = s.validUntil
    ? `${s.validFrom} → ${s.validUntil}`
    : `desde ${s.validFrom}`;
  return `${days || "(sin días)"} · ${s.startTime}–${s.endTime} · ${range}`;
}

// ── clinica-8 · NINGÚN GUARDADO DE PERSONAL FALLA EN SILENCIO ───────
//
// Esta pantalla tiene cuatro botones de guardar (perfil, historia clínica,
// servicios, turnos) y hasta este bloque **ninguno decía nada**: el acierto
// se notaba porque los datos se refrescaban solos, y el fallo salía como un
// aviso rojo en la CABECERA DE LA PÁGINA, lejos del botón que se acaba de
// pulsar y fuera de la pantalla si la tarjeta está desplegada.
//
// La auditoría del 18-10 lo pagó con la marca «Es sanitario»: se marcó, se
// escribió el colegiado, se pulsó guardar y la casilla volvió sola a su
// sitio sin una palabra. Sin esa marca la cita no enseña nada clínico, así
// que un guardado mudo paró el recorrido entero.
//
// Lo que hace falta no es un aviso más bonito: es que el resultado aparezca
// **donde está el dedo**, y que aparezca también cuando sale bien — un
// «Guardado» es lo que distingue «no se ha enterado» de «se ha guardado y
// se ve igual».
type Guardado = { que: "ok" } | { que: "error"; mensaje: string } | null;

// ── clinica-8 (fase B, 16) · UN SOLO GUARDADO POR TARJETA ───────────
//
// La tarjeta de una profesional tenía CUATRO botones de guardar (perfil,
// historia clínica, servicios, turnos). La auditoría del 18-10 lo anotó
// como «Personal: cuatro botones de guardar» (punto 23), y lo que se
// paga no es la estética: se cambia el nombre, se marca «Es sanitario»,
// se marcan los servicios, se pulsa UN botón y los otros dos cambios se
// quedan en la pantalla. La dueña sale creyendo que guardó.
//
// Ahora hay UNO, al final de la tarjeta, y guarda las tres secciones que
// son un formulario. Cada sección sigue siendo su componente con su
// estado —que es lo correcto: son tres rutas distintas del servidor— y
// lo que sube es esta pareja de funciones.
//
// Los TURNOS se quedan aparte, y es una decisión, no un olvido: «Crear
// turno» no edita la tarjeta, crea una fila en una lista (y hay un botón
// de borrar al lado de cada una). Meterlo en el guardado de la tarjeta
// obligaría a que «guardar» a veces cree un turno y a veces no.
/**
 * Lo que una sección lanza cuando falta un dato suyo. Se distingue de un
 * fallo de red o del servidor porque el mensaje ya está escrito para la
 * persona y no hay que envolverlo: «Falta el nº de colegiado…» no se
 * lee mejor con «la historia clínica:» delante.
 */
class FaltaUnDato extends Error {}

export interface SeccionGuardable {
  /** Nombre de la sección, para decir cuál falló. */
  nombre: string;
  /** ¿Hay cambios sin guardar? Lo que no está sucio no se manda: tres
   *  peticiones por cada toque de «Guardar» serían tres sitios donde
   *  fallar sin motivo. */
  sucio: () => boolean;
  /** Guarda. Lanza con el mensaje si no pudo. */
  guardar: () => Promise<void>;
}

function ResultadoGuardado({ estado }: { estado: Guardado }) {
  if (!estado) return null;
  if (estado.que === "ok") {
    return (
      <p
        role="status"
        data-guardado="ok"
        className="text-[12.5px] text-emerald-700 mt-2"
      >
        Guardado.
      </p>
    );
  }
  return (
    <p
      role="alert"
      data-guardado="error"
      className="text-[12.5px] text-mipiace-coral-dark mt-2"
    >
      {estado.mensaje}
    </p>
  );
}

/** El mensaje de un fallo de guardado, sea del servidor o de la red. */
function mensajeDeFallo(err: unknown): string {
  return err instanceof ApiError
    ? err.message
    : "No se ha podido guardar. Revisa la conexión y vuelve a intentarlo.";
}

export function StaffPage() {
  const navigate = useNavigate();
  const [agendaEnabled, setAgendaEnabled] = useState<boolean | null>(null);
  // clinica-1 · sale del MISMO `GET /admin/tenant/settings` que ya se
  // pedía para la agenda, así que la pantalla no hace una petición más.
  const [clinicaEncendida, setClinicaEncendida] = useState(false);
  // residencia-1 · la sección de residencia (roles de cuidado y zona) se
  // pinta sólo con el módulo encendido. En Sole, en la clínica de podología
  // y en los bares, Personal es exactamente la de hoy.
  const [residenciaEncendida, setResidenciaEncendida] = useState(false);
  const [staff, setStaff] = useState<StaffRow[] | null>(null);
  const [services, setServices] = useState<ServiceRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  const canEdit = readEffectiveAuth().canEdit;

  const refresh = useCallback(async () => {
    const res = await api<{ staff: StaffRow[] }>("/staff");
    setStaff(res.staff);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const settings = await api<{
          settings: {
            agendaEnabled: boolean;
            clinicalRecordsEnabled?: boolean;
            residenciaEnabled?: boolean;
          };
        }>("/admin/tenant/settings");
        setAgendaEnabled(settings.settings.agendaEnabled);
        setClinicaEncendida(
          settings.settings.clinicalRecordsEnabled === true,
        );
        // residencia-1 · del MISMO `GET` que ya se pedía, igual que la
        // clínica: esta pantalla no hace una petición más por el bloque.
        setResidenciaEncendida(
          settings.settings.residenciaEnabled === true,
        );
        if (!settings.settings.agendaEnabled) return;
        const [staffRes, svcRes] = await Promise.all([
          api<{ staff: StaffRow[] }>("/staff"),
          api<{ services: ServiceRow[] }>("/staff/services"),
        ]);
        setStaff(staffRes.staff);
        setServices(svcRes.services);
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          clearTokens();
          navigate("/login", { replace: true });
        } else if (err instanceof ApiError) {
          setError(err.message);
        } else throw err;
      }
    })();
  }, [navigate]);

  if (agendaEnabled === null) return <CenteredLoader label="Cargando…" />;

  if (!agendaEnabled) {
    return (
      <AdminShell title="Personal">
        <div className="bg-white rounded-2xl border border-slate-200 p-7 text-center">
          <h2 className="text-[16px] font-semibold text-mipiace-ink">
            El módulo de agenda está desactivado
          </h2>
          <p className="text-[13.5px] text-slate-500 mt-1 mb-4">
            Actívalo en Ajustes para gestionar profesionales, servicios que da
            cada uno y sus turnos.
          </p>
          <PrimaryButton type="button" onClick={() => navigate("/admin/settings")}>
            Ir a Ajustes
          </PrimaryButton>
        </div>
      </AdminShell>
    );
  }

  return (
    <AdminShell title="Personal">
      <p className="text-[13.5px] text-slate-500 mb-5 -mt-2">
        Da de alta a tus profesionales, marca qué servicios da cada uno y
        define su semana tipo. Es la base de la agenda.
      </p>
      {error && <FieldError message={error} />}
      {!staff ? (
        <CenteredLoader label="Cargando personal…" />
      ) : staff.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-7 text-center text-[13.5px] text-slate-500">
          No hay usuarios en este negocio todavía. Crea cajeros o encargados en
          la sección Cajeros.
        </div>
      ) : (
        <div className="space-y-3">
          {staff.map((row) => (
            <ProfessionalCard
              key={row.userId}
              row={row}
              // B-reservas-mostrador · el perfil necesita saber qué colores
              // están ya pillados para no proponer el mismo a todas.
              personal={staff}
              services={services}
              canEdit={canEdit}
              clinicaEncendida={clinicaEncendida}
              residenciaEncendida={residenciaEncendida}
              onChanged={refresh}
              onError={setError}
            />
          ))}
        </div>
      )}
    </AdminShell>
  );
}

function ProfessionalCard({
  row,
  personal,
  services,
  canEdit,
  clinicaEncendida,
  residenciaEncendida,
  onChanged,
  onError,
}: {
  row: StaffRow;
  personal: readonly StaffRow[];
  services: ServiceRow[];
  canEdit: boolean;
  clinicaEncendida: boolean;
  residenciaEncendida: boolean;
  onChanged: () => Promise<void>;
  onError: (m: string | null) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const displayName =
    row.profile?.displayName ?? row.alias ?? row.email.split("@")[0] ?? "—";
  const isPro = row.profile !== null;

  // clinica-8 (fase B, 16) · las tres secciones que el botón único
  // guarda. Ver `SeccionGuardable`.
  const refPerfil = useRef<SeccionGuardable | null>(null);
  const refClinica = useRef<SeccionGuardable | null>(null);
  const refSkills = useRef<SeccionGuardable | null>(null);
  const [guardandoTarjeta, setGuardandoTarjeta] = useState(false);
  const [guardadoTarjeta, setGuardadoTarjeta] = useState<Guardado>(null);

  async function guardarTarjeta() {
    onError(null);
    setGuardadoTarjeta(null);
    setGuardandoTarjeta(true);
    try {
      // El orden importa: dar de alta el perfil es lo que hace que
      // existan los servicios que se van a guardar después.
      for (const ref of [refPerfil, refClinica, refSkills]) {
        const seccion = ref.current;
        if (!seccion || !seccion.sucio()) continue;
        try {
          await seccion.guardar();
        } catch (err) {
          // El nombre de la sección delante: «No se pudo guardar» a
          // secas no dice si entró el nombre y no el colegiado.
          const mensaje =
            err instanceof FaltaUnDato
              ? err.message
              : `${seccion.nombre}: ${mensajeDeFallo(err)}`;
          setGuardadoTarjeta({ que: "error", mensaje });
          onError(mensaje);
          return;
        }
      }
      setGuardadoTarjeta({ que: "ok" });
    } finally {
      setGuardandoTarjeta(false);
    }
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="w-full flex items-center gap-3 p-4 text-left hover:bg-slate-50"
      >
        <span
          className="h-9 w-9 rounded-xl flex items-center justify-center text-white text-[13px] font-medium shrink-0"
          style={{ backgroundColor: row.profile?.color ?? "#94a3b8" }}
        >
          {displayName.slice(0, 2).toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[14.5px] font-medium text-mipiace-ink truncate">
            {displayName}
            {isPro && !row.profile!.active && (
              <span className="ml-2 text-[11px] text-slate-400">(inactivo)</span>
            )}
          </div>
          <div className="text-[12.5px] text-slate-500 truncate">
            {/* clinica-1 · el PUESTO y no `row.role.toLowerCase()`. En un
                tenant clínico, "cashier" no distingue a la cajera de la
                cajera-sanitaria, y es la distinción que esta pantalla
                existe para hacer. Fuera de la clínica el texto sale
                igual de legible —"Cajero", "Propietaria"— así que se usa
                siempre y no hay dos caminos que mantener. */}
            {/* El PUESTO va delante del email, y a 320 px se ve por qué:
                esta línea trunca con `truncate`, y con el email delante lo
                que se cortaba era justo el puesto — lo único que esta
                pantalla existe para decir. El email es largo y variable;
                el puesto es corto y fijo. Trunca el que sobra. */}
            {PUESTO_LABEL[puestoDe(row)]} · {row.email}
          </div>
        </div>
        {isPro ? (
          <span className="text-[11.5px] text-slate-500 shrink-0">
            {row.skillCount} servicio{row.skillCount === 1 ? "" : "s"}
          </span>
        ) : (
          <span className="text-[11.5px] text-mipiace-coral-dark font-medium shrink-0">
            Sin perfil
          </span>
        )}
      </button>

      {expanded && (
        <div className="border-t border-slate-100 p-4 space-y-6">
          <ProfileEditor
            row={row}
            personal={personal}
            canEdit={canEdit}
            onChanged={onChanged}
            onError={onError}
            handle={refPerfil}
          />
          {/* clinica-1 · sólo en tenants con la clínica encendida. En Sole
              y en los demás, esta tarjeta es exactamente la de hoy. */}
          {clinicaEncendida && (
            <ClinicaEditor
              row={row}
              canEdit={canEdit}
              onChanged={onChanged}
              onError={onError}
              handle={refClinica}
            />
          )}
          {/* residencia-1 · roles de cuidado y zona. Va DEBAJO de la
              sección clínica y no la sustituye: en un centro mixto
              —residencia con una consulta de podología dentro— las dos
              significan cosas distintas y las dos se tocan. */}
          {residenciaEncendida && (
            <CuidadoEditor
              userId={row.userId}
              canEdit={canEdit}
              onError={onError}
            />
          )}
          {isPro && (
            <>
              <SkillsEditor
                row={row}
                services={services}
                canEdit={canEdit}
                onChanged={onChanged}
                onError={onError}
                handle={refSkills}
              />
              <ShiftsEditor
                userId={row.userId}
                canEdit={canEdit}
                onError={onError}
              />
            </>
          )}

          {/* clinica-8 (fase B, 16) · EL BOTÓN. Uno, al final, y guarda
              lo que esté sucio en el orden en que las secciones dependen
              unas de otras: primero el PERFIL —porque darla de alta como
              profesional es lo que hace aparecer los servicios—, después
              la historia clínica y después los servicios.
              Para y lo dice en la primera que falla, nombrándola: con un
              «no se pudo guardar» a secas, la dueña no sabe si el nombre
              entró y el colegiado no, o al revés. */}
          {canEdit && (
            <div className="pt-1">
              <PrimaryButton
                type="button"
                data-test="guardar-tarjeta"
                onClick={guardarTarjeta}
                busy={guardandoTarjeta}
                className="!w-auto px-5 !h-10 !text-[13.5px]"
              >
                Guardar
              </PrimaryButton>
              <ResultadoGuardado estado={guardadoTarjeta} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ProfileEditor({
  row,
  personal,
  canEdit,
  onChanged,
  onError,
  handle,
}: {
  row: StaffRow;
  personal: readonly StaffRow[];
  canEdit: boolean;
  onChanged: () => Promise<void>;
  onError: (m: string | null) => void;
  /** clinica-8 (fase B, 16) · lo que el botón único de la tarjeta usa. */
  handle?: React.RefObject<SeccionGuardable | null>;
}) {
  const [displayName, setDisplayName] = useState(
    row.profile?.displayName ?? row.alias ?? "",
  );
  // B-reservas-mostrador · el color que se PROPONE a quien no tiene perfil es
  // el primero de la paleta que no esté usando ya otra profesional activa. Con
  // `COLOR_PRESETS[0]` a secas, dar de alta a SOLE, ANA e ISA sin tocar el
  // selector las dejaba a las tres en el mismo coral, y el tinte de la agenda
  // dejaba de distinguir sus citas.
  //
  // `useState` con función: se calcula UNA vez, al abrir el editor. Recalcular
  // en cada render movería el color bajo el dedo de quien lo está eligiendo.
  //
  // El color YA GUARDADO de una profesional no se toca: esto sólo rellena el
  // formulario de una que todavía no tiene perfil.
  const [color, setColor] = useState(
    () => row.profile?.color ?? colorPropuesto(coloresEnUso(personal, row.userId)),
  );
  const [active, setActive] = useState(row.profile?.active ?? true);

  const [altaEnCurso, setAltaEnCurso] = useState(false);
  const [altaFallida, setAltaFallida] = useState<Guardado>(null);

  // clinica-8 (fase B, 16) · SIN PERFIL, EL GUARDADO DE LA TARJETA NO
  // DA DE ALTA.
  //
  // Dar de alta como profesional no es guardar: es CREAR una columna en
  // la agenda. Si el guardado único la creara, marcar «Es sanitario» a
  // la propietaria —que es el gesto del punto 5 de la fase A, y es
  // clínico, no de agenda— le pondría de paso una columna que nadie
  // pidió. Así que esta sección sólo está «sucia» cuando ya hay perfil
  // y sus campos han cambiado, y el alta tiene su propio botón, igual
  // que «Crear turno».
  //
  // Siguen siendo UN guardado y DOS creaciones, que es lo que la
  // auditoría pedía (y no cuatro guardados).
  const sucio =
    row.profile != null &&
    (displayName.trim() !== (row.profile.displayName ?? "") ||
      color !== row.profile.color ||
      active !== row.profile.active ||
      // clinica-10 (H1) · Y CUANDO EL ALIAS TODAVÍA NO ES EL NOMBRE.
      //
      // clinica-9 (5) puso el puente: guardar en Personal escribe las dos
      // columnas, `staff_profiles.display_name` y `users.alias`, y para
      // las cuentas que ya existían «el primer guardado lo arregla».
      // Sólo que ese guardado no llegaba a salir: esta sección se salta
      // cuando no está sucia, y en una cuenta vieja no hay NADA que
      // cambiar en el formulario — el nombre de la agenda ya es
      // «Rosario». La pasada del 27-10 lo resolvió a mano cambiando el
      // nombre, guardando, y volviéndolo a cambiar (H1).
      //
      // Así que la pregunta correcta no es «¿has tecleado algo?», es
      // «¿dicen las dos columnas lo mismo?». Mientras no lo digan, hay
      // algo que guardar, y el gesto que la dueña ya hace —entrar a su
      // ficha y pulsar Guardar— lo arregla a la primera.
      (row.alias ?? "") !== (row.profile.displayName ?? ""));

  async function save() {
    if (displayName.trim().length === 0) {
      throw new FaltaUnDato("Pon el nombre con el que sale en la agenda.");
    }
    await api(`/staff/${row.userId}`, {
      method: "PUT",
      body: { displayName: displayName.trim(), color, active },
    });
    await onChanged();
  }

  async function darDeAlta() {
    onError(null);
    setAltaFallida(null);
    setAltaEnCurso(true);
    try {
      await save();
    } catch (err) {
      const mensaje =
        err instanceof FaltaUnDato ? err.message : mensajeDeFallo(err);
      setAltaFallida({ que: "error", mensaje });
      onError(mensaje);
    } finally {
      setAltaEnCurso(false);
    }
  }

  useImperativeHandle(handle, () => ({
    nombre: "el perfil",
    sucio: () => sucio,
    guardar: save,
  }));

  return (
    <section>
      <h3 className="text-[13px] font-semibold text-mipiace-ink mb-3">Perfil</h3>
      <div className="grid sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-[13px] font-medium text-mipiace-ink-soft mb-1.5">
            Nombre en la agenda
          </label>
          <input
            value={displayName}
            disabled={!canEdit}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder={row.alias ?? "Nombre"}
            className="w-full h-11 px-3.5 rounded-xl bg-mipiace-stone border border-transparent text-[14px] focus:bg-white focus:border-mipiace-coral/30 focus:ring-2 focus:ring-mipiace-coral/30 focus:outline-none disabled:opacity-50"
          />
        </div>
        <div>
          <label className="block text-[13px] font-medium text-mipiace-ink-soft mb-1.5">
            Color
          </label>
          <div className="flex items-center gap-2 flex-wrap">
            {COLOR_PRESETS.map((c) => (
              <button
                key={c}
                type="button"
                disabled={!canEdit}
                onClick={() => setColor(c)}
                aria-label={`Color ${c}`}
                className={
                  "h-8 w-8 rounded-lg border-2 " +
                  (color === c ? "border-mipiace-ink" : "border-transparent")
                }
                style={{ backgroundColor: c }}
              />
            ))}
            <input
              type="color"
              value={color}
              disabled={!canEdit}
              onChange={(e) => setColor(e.target.value)}
              className="h-8 w-10 rounded-lg border border-slate-200 bg-white disabled:opacity-50"
            />
          </div>
        </div>
      </div>
      <label className="flex items-center gap-2.5 mt-4 text-[13.5px] text-mipiace-ink cursor-pointer">
        <input
          type="checkbox"
          checked={active}
          disabled={!canEdit}
          onChange={(e) => setActive(e.target.checked)}
          className="h-4.5 w-4.5 rounded border-slate-300 text-mipiace-coral focus:ring-mipiace-coral/30"
        />
        Activo en la agenda
      </label>
      {/* clinica-8 (fase B, 16) · con perfil, no hay botón aquí: guarda
          el único de la tarjeta. Sin perfil, el ALTA es su propia
          acción — ver la nota de `sucio`. */}
      {canEdit && row.profile == null && (
        <div className="mt-4">
          <PrimaryButton
            type="button"
            data-test="dar-de-alta"
            onClick={darDeAlta}
            busy={altaEnCurso}
            className="!w-auto px-5 !h-10 !text-[13.5px]"
          >
            Dar de alta como profesional
          </PrimaryButton>
          <ResultadoGuardado estado={altaFallida} />
        </div>
      )}
    </section>
  );
}

// ── clinica-1 · la sección clínica del profesional ──────────────────
//
// Tres decisiones y una lista, en el orden en que se toman:
//
//   1. El PUESTO. Para un cajero, tres botones a un toque (cajero /
//      cajero-sanitario / sanitario). Para la propietaria y el encargado,
//      una casilla «es sanitario» — su puesto no se cambia desde aquí.
//   2. El Nº DE COLEGIADO. Aparece al marcar sanitario y es obligatorio:
//      va en la historia y en los informes que firma.
//   3. El ALCANCE. Dos botones: todos los pacientes / sólo los suyos.
//   4. Y si es «sólo los suyos», SU LISTA: de dónde vino cada paciente
//      (agenda o a mano), añadir y revocar.
//
// Regla de Matías («mucho clic, poco escribir» y «que todo fluya»): lo
// único que se teclea es el colegiado y el nombre al buscar un paciente.
// Todo lo demás son botones.
function ClinicaEditor({
  row,
  canEdit,
  onChanged,
  onError,
  handle,
}: {
  row: StaffRow;
  canEdit: boolean;
  onChanged: () => Promise<void>;
  onError: (m: string | null) => void;
  handle?: React.RefObject<SeccionGuardable | null>;
}) {
  const clinica = row.clinica ?? {
    esSanitario: false,
    colegiado: null,
    alcance: "SELECTION" as const,
    puesto: puestoDe(row),
  };
  const [esSanitario, setEsSanitario] = useState(clinica.esSanitario);
  const [colegiado, setColegiado] = useState(clinica.colegiado ?? "");
  const [alcance, setAlcance] = useState(clinica.alcance);
  const [puesto, setPuesto] = useState<"CASHIER" | "CLINICIAN">(
    row.role === "CLINICIAN" ? "CLINICIAN" : "CASHIER",
  );
  const [aviso, setAviso] = useState<string | null>(null);

  // El puesto sólo se elige para quien no es propietaria ni encargado:
  // cambiarle el rol de negocio a la dueña no es una decisión de esta
  // pantalla, y la API lo rechaza con 409 si se intenta.
  const puestoEditable = row.role === "CASHIER" || row.role === "CLINICIAN";

  // Elegir «sanitario» implica la marca, así que la casilla no se ofrece
  // por separado: sería un estado que la base rechaza por CHECK.
  const sanitarioFinal = puestoEditable
    ? puesto === "CLINICIAN" || esSanitario
    : esSanitario;

  const faltaColegiado = sanitarioFinal && colegiado.trim().length === 0;

  const sucio =
    sanitarioFinal !== clinica.esSanitario ||
    colegiado.trim() !== (clinica.colegiado ?? "") ||
    alcance !== clinica.alcance ||
    (puestoEditable && puesto !== (row.role === "CLINICIAN" ? "CLINICIAN" : "CASHIER"));

  async function guardar() {
    setAviso(null);
    // clinica-8 · lo que falta se dice y no se manda para que el
    // servidor conteste 400 desde la cabecera de la página. Es el único
    // campo que se teclea en toda la tarjeta.
    if (faltaColegiado) {
      throw new FaltaUnDato(
        "Falta el nº de colegiado: va en la historia y en los informes que firma. Escríbelo como lo tengas (45/0123, 45-0123, COL-450123…).",
      );
    }
    const res = await api<{ sesionesInvalidadas: boolean }>(
      `/staff/${row.userId}/clinica`,
      {
        method: "PATCH",
        body: {
          ...(puestoEditable ? { puesto } : {}),
          esSanitario: sanitarioFinal,
          colegiado: colegiado.trim() || null,
          alcance,
        },
      },
    );
    // Cambiar el puesto tira las sesiones. Decirlo evita el susto de
    // «me ha echado del TPV sin avisar».
    if (res.sesionesInvalidadas) {
      setAviso(
        "Guardado. Esta persona tendrá que volver a entrar en el TPV con su PIN.",
      );
    }
    await onChanged();
  }

  useImperativeHandle(handle, () => ({
    nombre: "la historia clínica",
    sucio: () => sucio,
    guardar,
  }));

  void onError;

  return (
    <section>
      <h3 className="text-[13px] font-semibold text-mipiace-ink mb-3">
        Historia clínica
      </h3>

      {puestoEditable ? (
        <div>
          <label className="block text-[13px] font-medium text-mipiace-ink-soft mb-1.5">
            Puesto
          </label>
          <div className="flex flex-wrap gap-2">
            {(
              [
                ["CASHIER", false, "Cajero", "Cobra. No ve historias."],
                [
                  "CASHIER",
                  true,
                  "Cajero-sanitario",
                  "Cobra y ve historias.",
                ],
                [
                  "CLINICIAN",
                  true,
                  "Sanitario",
                  "Su agenda y las historias. No toca la caja.",
                ],
              ] as const
            ).map(([p, marca, label, ayuda]) => {
              const activo = puesto === p && sanitarioFinal === marca;
              return (
                <button
                  key={`${p}-${String(marca)}`}
                  type="button"
                  disabled={!canEdit}
                  title={ayuda}
                  onClick={() => {
                    setPuesto(p);
                    setEsSanitario(marca);
                  }}
                  className={
                    // 44 px de alto: área tocable del estándar de la casa
                    // (docs/ux-principles.md §1.2). Esta pantalla se usa
                    // en tablet.
                    "h-11 px-4 rounded-xl text-[13.5px] font-medium border transition-colors disabled:opacity-50 " +
                    (activo
                      ? "bg-mipiace-coral text-white border-mipiace-coral"
                      : "bg-mipiace-stone text-mipiace-ink border-transparent hover:border-slate-300")
                  }
                >
                  {label}
                </button>
              );
            })}
          </div>
          <p className="text-[12px] text-slate-500 mt-1.5">
            Un sanitario entra en el TPV con su PIN y ve sólo su agenda: ni
            venta, ni turno, ni caja.
          </p>
        </div>
      ) : (
        <label className="flex items-center gap-2.5 text-[13.5px] text-mipiace-ink cursor-pointer">
          <input
            type="checkbox"
            checked={esSanitario}
            disabled={!canEdit}
            onChange={(e) => setEsSanitario(e.target.checked)}
            className="h-4.5 w-4.5 rounded border-slate-300 text-mipiace-coral focus:ring-mipiace-coral/30"
          />
          Es sanitario (ve las historias de sus pacientes)
        </label>
      )}

      {sanitarioFinal && (
        <>
          <div className="mt-4 max-w-xs">
            <label className="block text-[13px] font-medium text-mipiace-ink-soft mb-1.5">
              Nº de colegiado
            </label>
            <input
              value={colegiado}
              disabled={!canEdit}
              onChange={(e) => setColegiado(e.target.value)}
              placeholder="28/1234"
              data-colegiado
              className="w-full h-11 px-3.5 rounded-xl bg-mipiace-stone border border-transparent text-[14px] focus:bg-white focus:border-mipiace-coral/30 focus:ring-2 focus:ring-mipiace-coral/30 focus:outline-none disabled:opacity-50"
            />
            {faltaColegiado ? (
              <p className="text-[12px] text-mipiace-coral-dark mt-1.5">
                Hace falta: va en la historia y en los informes que firma.
              </p>
            ) : (
              // clinica-8 · el 18-10 se escribió «45-0123», el guardado no
              // salió y se dio por hecho que el guion no valía. Vale: el
              // número se guarda tal cual, sin formato. Decirlo aquí quita
              // la duda antes de que cueste un intento.
              <p className="text-[12px] text-slate-500 mt-1.5">
                Como lo tengas: 45/0123, 45-0123, COL-450123… se guarda tal
                cual y así sale en la historia.
              </p>
            )}
          </div>

          <div className="mt-4">
            <label className="block text-[13px] font-medium text-mipiace-ink-soft mb-1.5">
              Qué historias ve
            </label>
            <div className="flex flex-wrap gap-2">
              {(
                [
                  ["ALL", "Todos los pacientes"],
                  ["SELECTION", "Sólo los suyos"],
                ] as const
              ).map(([valor, label]) => (
                <button
                  key={valor}
                  type="button"
                  disabled={!canEdit}
                  onClick={() => setAlcance(valor)}
                  className={
                    "h-11 px-4 rounded-xl text-[13.5px] font-medium border transition-colors disabled:opacity-50 " +
                    (alcance === valor
                      ? "bg-mipiace-coral text-white border-mipiace-coral"
                      : "bg-mipiace-stone text-mipiace-ink border-transparent hover:border-slate-300")
                  }
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      {aviso && (
        <p className="text-[12.5px] text-mipiace-ink-soft mt-3">{aviso}</p>
      )}

      {/* clinica-8 (fase A) · el botón ya no se desactivaba cuando
          faltaba el colegiado; en la fase B ya no hay botón aquí. Lo que
          sobrevive es la razón: se pulsa el único de la tarjeta y
          `guardar()` contesta qué falta y en qué formatos vale el
          número, en vez de dejar un botón apagado que en una tablet se
          lee como «esto está roto». */}

      {/* La lista de pacientes sólo tiene sentido con «sólo los suyos», y
          sólo para quien YA está guardado como sanitario: con la marca sin
          guardar, la API devolvería 409 NOT_A_CLINICIAN y la dueña no
          entendería por qué. */}
      {clinica.esSanitario && clinica.alcance === "SELECTION" && (
        <PacientesDelSanitario
          userId={row.userId}
          canEdit={canEdit}
          onError={onError}
        />
      )}
    </section>
  );
}

// ── clinica-1 · la selección de pacientes de un sanitario ───────────
//
// Se carga al abrirla y no con la tarjeta: un tenant con seis sanitarios
// haría seis peticiones al desplegar la pantalla, y la lista sólo se mira
// cuando se va a tocar.
function PacientesDelSanitario({
  userId,
  canEdit,
  onError,
}: {
  userId: string;
  canEdit: boolean;
  onError: (m: string | null) => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const [lista, setLista] = useState<PacienteAsignado[] | null>(null);
  const [busqueda, setBusqueda] = useState("");
  const [candidatos, setCandidatos] = useState<
    Array<{ id: string; firstName: string; lastName: string }>
  >([]);
  const [busy, setBusy] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    try {
      const res = await api<{ clients: PacienteAsignado[] }>(
        `/clinica/clinicians/${userId}/clients`,
      );
      setLista(res.clients);
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "Error al cargar");
    }
  }, [userId, onError]);

  useEffect(() => {
    if (abierto && lista === null) void cargar();
  }, [abierto, lista, cargar]);

  // Buscar por nombre reusa `GET /clients?query=`, que es la búsqueda del
  // CRM que ya existe. No se escribe una segunda.
  useEffect(() => {
    const q = busqueda.trim();
    if (q.length < 2) {
      setCandidatos([]);
      return;
    }
    let cancelado = false;
    const t = setTimeout(() => {
      api<{ clients: Array<{ id: string; firstName: string; lastName: string }> }>(
        `/clients?query=${encodeURIComponent(q)}&limit=8`,
      )
        .then((res) => {
          if (!cancelado) setCandidatos(res.clients);
        })
        .catch(() => {
          if (!cancelado) setCandidatos([]);
        });
    }, 250);
    return () => {
      cancelado = true;
      clearTimeout(t);
    };
  }, [busqueda]);

  async function dar(clientId: string) {
    onError(null);
    setBusy(clientId);
    try {
      await api(`/clinica/clinicians/${userId}/clients`, {
        method: "POST",
        body: { clientId },
      });
      setBusqueda("");
      setCandidatos([]);
      await cargar();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "Error al dar acceso");
    } finally {
      setBusy(null);
    }
  }

  async function revocar(clientId: string) {
    onError(null);
    setBusy(clientId);
    try {
      await api(`/clinica/clinicians/${userId}/clients/${clientId}`, {
        method: "DELETE",
      });
      await cargar();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "Error al revocar");
    } finally {
      setBusy(null);
    }
  }

  const yaEstan = new Set((lista ?? []).map((p) => p.clientId));

  return (
    <div className="mt-5 pt-4 border-t border-slate-100">
      <button
        type="button"
        onClick={() => setAbierto((a) => !a)}
        className="text-[13px] font-semibold text-mipiace-ink hover:text-mipiace-coral-dark"
      >
        Sus pacientes{lista ? ` (${lista.length})` : ""}
        <span className="ml-1.5 text-slate-400">{abierto ? "▴" : "▾"}</span>
      </button>

      {abierto && (
        <div className="mt-3">
          {lista === null ? (
            <p className="text-[13px] text-slate-500">Cargando…</p>
          ) : lista.length === 0 ? (
            <p className="text-[13px] text-slate-500">
              Todavía ninguno. Se añaden solos al asignarle una cita, o a mano
              aquí abajo.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {lista.map((p) => (
                <li
                  key={p.accessId}
                  className="flex items-center gap-2 bg-mipiace-stone rounded-xl px-3 py-2"
                >
                  <span className="text-[13.5px] text-mipiace-ink flex-1 truncate">
                    {p.name}
                  </span>
                  <span className="text-[11.5px] text-slate-500 shrink-0">
                    {ORIGEN_LABEL[p.source]}
                  </span>
                  {canEdit && (
                    <button
                      type="button"
                      disabled={busy === p.clientId}
                      onClick={() => void revocar(p.clientId)}
                      className="h-9 px-3 rounded-lg text-[12.5px] font-medium text-mipiace-coral-dark hover:bg-white disabled:opacity-50 shrink-0"
                    >
                      Revocar
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}

          {canEdit && (
            <div className="mt-3">
              <input
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                placeholder="Añadir paciente por nombre…"
                data-buscar-paciente
                className="w-full h-11 px-3.5 rounded-xl bg-white border border-slate-200 text-[14px] focus:border-mipiace-coral/30 focus:ring-2 focus:ring-mipiace-coral/30 focus:outline-none"
              />
              {candidatos.length > 0 && (
                <ul className="mt-1.5 space-y-1">
                  {candidatos.map((c) => {
                    const nombre = `${c.firstName} ${c.lastName}`.trim();
                    const puesto = yaEstan.has(c.id);
                    return (
                      <li key={c.id}>
                        <button
                          type="button"
                          disabled={puesto || busy === c.id}
                          onClick={() => void dar(c.id)}
                          className="w-full h-11 px-3.5 rounded-xl text-left text-[13.5px] bg-mipiace-stone hover:bg-white border border-transparent hover:border-slate-200 disabled:opacity-40"
                        >
                          {nombre}
                          {puesto && (
                            <span className="ml-2 text-[11.5px] text-slate-500">
                              ya lo tiene
                            </span>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
              <p className="text-[12px] text-slate-500 mt-1.5">
                Revocar no borra nada: queda escrito quién pudo ver qué y
                hasta cuándo.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SkillsEditor({
  row,
  services,
  canEdit,
  onChanged,
  onError,
  handle,
}: {
  row: StaffRow;
  services: ServiceRow[];
  canEdit: boolean;
  onChanged: () => Promise<void>;
  onError: (m: string | null) => void;
  handle?: React.RefObject<SeccionGuardable | null>;
}) {
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(row.serviceIds),
  );
  const dirty = useMemo(() => {
    const a = new Set(row.serviceIds);
    if (a.size !== selected.size) return true;
    for (const id of selected) if (!a.has(id)) return true;
    return false;
  }, [row.serviceIds, selected]);

  // clinica-8 (fase B, 16) · ¿están TODOS marcados? Decide qué hace el
  // botón de «Todos los servicios» y cómo se lee.
  const todos = services.length > 0 && selected.size === services.length;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function save() {
    await api(`/staff/${row.userId}/skills`, {
      method: "PUT",
      body: { serviceIds: [...selected] },
    });
    await onChanged();
  }

  useImperativeHandle(handle, () => ({
    nombre: "los servicios",
    sucio: () => dirty,
    guardar: save,
  }));

  void onError;

  return (
    <section>
      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <h3 className="text-[13px] font-semibold text-mipiace-ink">
          Servicios que da
        </h3>
        {/* clinica-8 (fase B, 16) · «TODOS LOS SERVICIOS», de un toque.
            Auditoría del 18-10: «sin "marcar todos" en servicios»
            (punto 23). En Rosario son 17 casillas, y en la clínica de
            una sola profesional las 17 son suyas: el alta costaba 17
            toques para llegar al estado por defecto de ese centro.
            Es un interruptor y no un botón suelto: con todo marcado
            dice «Ninguno», porque el gesto contrario —empezar de cero
            para marcar tres— cuesta los mismos 17 toques al revés. */}
        {canEdit && services.length > 0 && (
          <button
            type="button"
            data-test="todos-los-servicios"
            onClick={() =>
              setSelected(todos ? new Set() : new Set(services.map((x) => x.id)))
            }
            className="h-9 px-3 rounded-lg bg-mipiace-stone text-[12.5px] font-medium text-mipiace-ink hover:bg-slate-200"
          >
            {todos ? "Ninguno" : "Todos los servicios"}
          </button>
        )}
      </div>
      {services.length === 0 ? (
        <p className="text-[13px] text-slate-500">
          No hay servicios en el catálogo. Márcalos como servicio en Holded y
          sincroniza.
        </p>
      ) : (
        <div className="grid sm:grid-cols-2 gap-x-4 gap-y-2">
          {services.map((svc) => (
            <label
              key={svc.id}
              className="flex items-center gap-2.5 text-[13.5px] text-mipiace-ink cursor-pointer"
            >
              <input
                type="checkbox"
                checked={selected.has(svc.id)}
                disabled={!canEdit}
                onChange={() => toggle(svc.id)}
                className="h-4 w-4 rounded border-slate-300 text-mipiace-coral focus:ring-mipiace-coral/30"
              />
              <span className="truncate">{svc.name}</span>
            </label>
          ))}
        </div>
      )}
      {/* clinica-8 (fase B, 16) · sin botón propio: guarda el único de
          la tarjeta. */}
      {services.length > 0 && (
        <p className="text-[12px] text-slate-500 mt-2.5">
          {selected.size} de {services.length} marcados
        </p>
      )}
    </section>
  );
}

function ShiftsEditor({
  userId,
  canEdit,
  onError,
}: {
  userId: string;
  canEdit: boolean;
  onError: (m: string | null) => void;
}) {
  const [shifts, setShifts] = useState<Shift[] | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api<{ shifts: Shift[] }>(`/staff/${userId}/shifts`);
      setShifts(res.shifts);
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "Error al cargar turnos");
    }
  }, [userId, onError]);

  useEffect(() => {
    void load();
  }, [load]);

  async function remove(shiftId: string) {
    if (!window.confirm("¿Borrar este turno?")) return;
    onError(null);
    try {
      await api(`/staff/${userId}/shifts/${shiftId}`, { method: "DELETE" });
      await load();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "Error al borrar");
    }
  }

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[13px] font-semibold text-mipiace-ink">
          Turnos (semana tipo)
        </h3>
        {canEdit && !adding && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="text-[12.5px] text-mipiace-coral-dark font-medium hover:underline"
          >
            + Añadir turno
          </button>
        )}
      </div>
      {shifts === null ? (
        <p className="text-[13px] text-slate-400">Cargando turnos…</p>
      ) : shifts.length === 0 && !adding ? (
        <p className="text-[13px] text-slate-500">
          Sin turnos. Añade la semana tipo del profesional.
        </p>
      ) : (
        <div className="space-y-2">
          {shifts.map((s) => (
            <div
              key={s.id}
              className="flex items-center gap-3 rounded-xl bg-mipiace-stone px-3.5 py-2.5"
            >
              <span className="text-[11px] uppercase tracking-wide text-slate-500 shrink-0">
                {KIND_LABEL[s.kind]}
              </span>
              <span className="text-[13px] text-mipiace-ink flex-1 min-w-0 truncate tabular-nums">
                {shiftSummary(s)}
              </span>
              {canEdit && (
                <button
                  type="button"
                  onClick={() => remove(s.id)}
                  className="text-[12px] text-slate-400 hover:text-red-600 shrink-0"
                >
                  Borrar
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      {adding && (
        <ShiftForm
          userId={userId}
          onError={onError}
          onDone={async (saved) => {
            setAdding(false);
            if (saved) await load();
          }}
        />
      )}
    </section>
  );
}

function ShiftForm({
  userId,
  onError,
  onDone,
}: {
  userId: string;
  onError: (m: string | null) => void;
  onDone: (saved: boolean) => Promise<void>;
}) {
  const [days, setDays] = useState<Set<string>>(new Set());
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("14:00");
  // clinica-8 (fase B, 16) · «VÁLIDO DESDE» NACE CON HOY.
  //
  // Auditoría del 18-10, punto 22: «"Crear turno" sin "Válido desde" no
  // hace nada y no avisa». La fase A puso el aviso; lo que faltaba es
  // que casi nunca haga falta. Un turno que se crea un lunes por la
  // mañana rige desde ese lunes: es la respuesta en el 95 % de las
  // veces, y la otra —un turno que empieza el mes que viene— se teclea
  // igual encima.
  //
  // La fecha es la del CENTRO (Europe/Madrid) y no la del navegador:
  // `validFrom` se compara contra el calendario de la agenda, que vive
  // en esa zona. En un portátil con la zona cambiada, «hoy» del
  // navegador puede ser otro día.
  const [validFrom, setValidFrom] = useState(hoyEnElCentro);
  const [validUntil, setValidUntil] = useState("");
  const [kind, setKind] = useState<ShiftKind>("REGULAR");
  const [busy, setBusy] = useState(false);
  const [guardado, setGuardado] = useState<Guardado>(null);

  function toggleDay(code: string) {
    setDays((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }

  async function save() {
    onError(null);
    setGuardado(null);
    // clinica-8 · lo que falta se dice AQUÍ, al lado del botón. Antes iba
    // a la cabecera de la página: con la tarjeta desplegada, el aviso
    // caía fuera de la pantalla y «Crear turno» parecía no hacer nada.
    if (days.size === 0) {
      setGuardado({
        que: "error",
        mensaje: "Elige al menos un día de la semana.",
      });
      return;
    }
    if (!validFrom) {
      setGuardado({
        que: "error",
        mensaje: "Indica desde cuándo rige el turno.",
      });
      return;
    }
    // Orden canónico L→D en la rrule.
    const byday = WEEKDAYS.filter((w) => days.has(w.code))
      .map((w) => w.code)
      .join(",");
    setBusy(true);
    try {
      await api(`/staff/${userId}/shifts`, {
        method: "POST",
        body: {
          rrule: `FREQ=WEEKLY;BYDAY=${byday}`,
          startTime,
          endTime,
          validFrom,
          validUntil: validUntil || null,
          kind,
        },
      });
      setGuardado({ que: "ok" });
      await onDone(true);
    } catch (err) {
      const mensaje = mensajeDeFallo(err);
      setGuardado({ que: "error", mensaje });
      onError(mensaje);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 rounded-xl border border-slate-200 p-4">
      <div className="mb-3">
        <div className="text-[12.5px] font-medium text-mipiace-ink-soft mb-2">
          Días
        </div>
        <div className="flex gap-1.5">
          {WEEKDAYS.map((w) => (
            <button
              key={w.code}
              type="button"
              onClick={() => toggleDay(w.code)}
              className={
                "h-9 w-9 rounded-lg text-[13px] font-medium " +
                (days.has(w.code)
                  ? "bg-mipiace-coral text-white"
                  : "bg-mipiace-stone text-slate-500 hover:bg-slate-100")
              }
            >
              {w.label}
            </button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Field label="Desde (hora)">
          <input
            type="time"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
            className="w-full h-10 px-3 rounded-lg bg-mipiace-stone border border-transparent text-[13.5px] tabular-nums focus:bg-white focus:border-mipiace-coral/30 focus:outline-none"
          />
        </Field>
        <Field label="Hasta (hora)">
          <input
            type="time"
            value={endTime}
            onChange={(e) => setEndTime(e.target.value)}
            className="w-full h-10 px-3 rounded-lg bg-mipiace-stone border border-transparent text-[13.5px] tabular-nums focus:bg-white focus:border-mipiace-coral/30 focus:outline-none"
          />
        </Field>
        <Field label="Válido desde">
          <input
            type="date"
            value={validFrom}
            onChange={(e) => setValidFrom(e.target.value)}
            className="w-full h-10 px-3 rounded-lg bg-mipiace-stone border border-transparent text-[13.5px] tabular-nums focus:bg-white focus:border-mipiace-coral/30 focus:outline-none"
          />
        </Field>
        <Field label="Válido hasta (opcional)">
          <input
            type="date"
            value={validUntil}
            onChange={(e) => setValidUntil(e.target.value)}
            className="w-full h-10 px-3 rounded-lg bg-mipiace-stone border border-transparent text-[13.5px] tabular-nums focus:bg-white focus:border-mipiace-coral/30 focus:outline-none"
          />
        </Field>
      </div>
      <div className="mt-3">
        <Field label="Tipo">
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as ShiftKind)}
            className="w-full sm:w-48 h-10 px-3 rounded-lg bg-mipiace-stone border border-transparent text-[13.5px] focus:bg-white focus:border-mipiace-coral/30 focus:outline-none"
          >
            <option value="REGULAR">Regular</option>
            <option value="REINFORCEMENT">Refuerzo</option>
            <option value="SWAP">Cambio</option>
          </select>
        </Field>
      </div>
      <div className="flex gap-2.5 mt-4">
        <PrimaryButton
          type="button"
          onClick={save}
          busy={busy}
          className="!w-auto px-5 !h-10 !text-[13.5px]"
        >
          Crear turno
        </PrimaryButton>
        <OutlineButton
          type="button"
          onClick={() => void onDone(false)}
          className="!w-auto px-5 !h-10 !text-[13.5px]"
        >
          Cancelar
        </OutlineButton>
      </div>
      <ResultadoGuardado estado={guardado} />
    </div>
  );
}

/**
 * clinica-8 (fase B, 16) · el día de hoy en el centro, en `YYYY-MM-DD`.
 *
 * `sv-SE` porque es el locale que formatea ISO sin montar una librería,
 * y es el truco que ya usa el resto de la casa para esto mismo.
 */
export function hoyEnElCentro(ahora: Date = new Date()): string {
  return ahora.toLocaleDateString("sv-SE", { timeZone: "Europe/Madrid" });
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-[12px] font-medium text-slate-500 mb-1">
        {label}
      </label>
      {children}
    </div>
  );
}
