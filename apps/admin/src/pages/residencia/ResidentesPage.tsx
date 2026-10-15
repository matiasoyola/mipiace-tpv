// residencia-1 · RESIDENTES.
//
// La lista con habitación, cama, nivel de dependencia y tipo de plaza; el
// alta; la ficha; dar de alta (que se va) y cambiar de habitación.
//
// ── Poco texto, todo a un toque ──────────────────────────────────────
//
// La lista es una tabla de una línea por residente y las dos acciones que
// se usan a diario —cambiar de habitación y dar de alta— están en la
// propia línea, no dentro de la ficha. Quien las usa es la dirección a
// mediodía, con el teléfono en la otra mano.
//
// El **ingreso pendiente** (residente sin cama) se pinta como AVISO en
// ámbar y no como error: está permitido y es lo normal el día antes de que
// llegue alguien. Lo que no puede es pasar desapercibido.
//
// ── Qué no está aquí ─────────────────────────────────────────────────
//
// El DNI y el NSS sólo en la ficha, nunca en la lista: la lista se enseña
// en una pantalla que mira cualquiera que pase por el despacho. Lo mismo
// que hace la API, que no los manda en `GET /residencia/residentes`.

import { useEffect, useState } from "react";
import {
  AlertTriangle,
  BedDouble,
  ClipboardList,
  LogOut,
  Plus,
  X,
} from "lucide-react";
// residencia-2 · el enlace al plan de cuidados, desde la ficha.
import { Link } from "react-router-dom";

import { AdminShell } from "../../AdminShell.js";
import { api, ApiError } from "../../api.js";
import {
  CenteredLoader,
  FieldError,
  OutlineButton,
  PrimaryButton,
  TextField,
} from "../../ui.js";
import {
  fechaCorta,
  hoyISO,
  NIVEL_LABEL,
  PLAZA_LABEL,
  type NivelDependencia,
  type PlantaVista,
  type ResidenteFicha,
  type ResidenteFila,
  type TipoDePlaza,
} from "./lib.js";

const NIVELES: NivelDependencia[] = ["VALIDO", "SEMIASISTIDO", "DEPENDIENTE"];
const PLAZAS: TipoDePlaza[] = ["PRIVADA", "CONCERTADA", "TEMPORAL"];

export function ResidentesPage() {
  const [filas, setFilas] = useState<ResidenteFila[] | null>(null);
  const [alcance, setAlcance] = useState<"CENTRO" | "ZONA">("CENTRO");
  const [conAltas, setConAltas] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [alta, setAlta] = useState(false);
  const [ficha, setFicha] = useState<ResidenteFicha | null>(null);
  const [moviendo, setMoviendo] = useState<ResidenteFila | null>(null);
  const [dando, setDando] = useState<ResidenteFila | null>(null);

  async function recargar() {
    try {
      const r = await api<{
        residentes: ResidenteFila[];
        alcance: "CENTRO" | "ZONA";
      }>(`/residencia/residentes${conAltas ? "?incluirAltas=true" : ""}`);
      setFilas(r.residentes);
      setAlcance(r.alcance);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Error inesperado");
    }
  }

  useEffect(() => {
    void recargar();
    // `conAltas` entra en las dependencias: cambiar la casilla recarga.
  }, [conAltas]);

  async function abrirFicha(fila: ResidenteFila) {
    try {
      const r = await api<{ residente: ResidenteFicha }>(
        `/residencia/residentes/${fila.clientId}`,
      );
      setFicha(r.residente);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Error inesperado");
    }
  }

  if (!filas) return <CenteredLoader label="Cargando residentes…" />;

  const viven = filas.filter((f) => f.dischargeDate == null);
  const idos = filas.filter((f) => f.dischargeDate != null);
  const sinCama = viven.filter((f) => f.cama == null);

  return (
    <AdminShell title="Residentes">
      <p className="-mt-2 mb-5 text-[13.5px] text-slate-500">
        Quién vive en el centro, en qué habitación y con qué plaza.
        {alcance === "ZONA" && " Ves los residentes de tu zona."}
      </p>

      {error && <FieldError message={error} />}

      {sinCama.length > 0 && (
        <div className="mb-5 flex items-start gap-2 rounded-xl bg-amber-50 px-3.5 py-2.5 text-[13px] text-amber-800">
          <AlertTriangle className="mt-px h-4 w-4 shrink-0" />
          <span>
            {sinCama.length === 1
              ? "Hay 1 residente sin habitación asignada (ingreso pendiente)."
              : `Hay ${sinCama.length} residentes sin habitación asignada (ingreso pendiente).`}
          </span>
        </div>
      )}

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-[16px] font-semibold text-mipiace-ink">
          En el centro{" "}
          <span className="font-normal tabular-nums text-slate-400">
            {viven.length}
          </span>
        </h2>
        <div className="flex items-center gap-3">
          <label className="flex min-h-[44px] items-center gap-2 text-[13.5px] text-slate-600">
            <input
              type="checkbox"
              checked={conAltas}
              onChange={(e) => setConAltas(e.target.checked)}
              className="h-4 w-4"
            />
            Ver también los que se fueron
          </label>
          {/* «Nuevo ingreso» y NO «Dar de alta», y lo encontró su propio
              test: en una residencia **«dar de alta» significa que alguien
              SE VA**. Tener los dos actos con las mismas palabras —el de
              la cabecera y el de cada línea— era la clase de ambigüedad
              que se paga una vez, de noche, con la familia esperando. */}
          <PrimaryButton
            type="button"
            onClick={() => setAlta(true)}
            className="!h-10 !w-auto !px-4 !text-[13.5px]"
          >
            <Plus className="h-4 w-4" /> Nuevo ingreso
          </PrimaryButton>
        </div>
      </div>

      <Tabla
        filas={viven}
        onFicha={abrirFicha}
        onMover={setMoviendo}
        onDarDeAlta={setDando}
      />

      {conAltas && idos.length > 0 && (
        <>
          <h2 className="mb-3 mt-8 text-[16px] font-semibold text-mipiace-ink">
            Se fueron{" "}
            <span className="font-normal tabular-nums text-slate-400">
              {idos.length}
            </span>
          </h2>
          <Tabla filas={idos} onFicha={abrirFicha} />
        </>
      )}

      {alta && (
        <ModalAlta
          onClose={() => setAlta(false)}
          onHecho={() => {
            setAlta(false);
            void recargar();
          }}
        />
      )}
      {ficha && (
        <ModalFicha residente={ficha} onClose={() => setFicha(null)} />
      )}
      {moviendo && (
        <ModalCama
          residente={moviendo}
          onClose={() => setMoviendo(null)}
          onHecho={() => {
            setMoviendo(null);
            void recargar();
          }}
        />
      )}
      {dando && (
        <ModalDarDeAlta
          residente={dando}
          onClose={() => setDando(null)}
          onHecho={() => {
            setDando(null);
            void recargar();
          }}
        />
      )}
    </AdminShell>
  );
}

function Tabla({
  filas,
  onFicha,
  onMover,
  onDarDeAlta,
}: {
  filas: ResidenteFila[];
  onFicha: (f: ResidenteFila) => void;
  onMover?: (f: ResidenteFila) => void;
  onDarDeAlta?: (f: ResidenteFila) => void;
}) {
  if (filas.length === 0) {
    return (
      <p className="rounded-2xl border border-slate-200 bg-white px-5 py-6 text-[13.5px] text-slate-500">
        Todavía no hay residentes. Dale a «Nuevo ingreso».
      </p>
    );
  }
  return (
    <ul className="space-y-2">
      {filas.map((f) => (
        <li
          key={f.clientId}
          className="rounded-2xl border border-slate-200 bg-white px-4 py-3"
        >
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            {/* EL NOMBRE SE LLEVA LA LÍNEA ENTERA en estrecho, y lo
                encontró la captura de 320 px, no un test: con el nombre
                compartiendo línea con los dos distintivos y los dos
                botones, la columna del nombre se quedaba en noventa
                píxeles y «Manuel Cano Álvarez» salía como «Manuel Ca…» —
                lo único que esta pantalla existe para decir. Es el mismo
                arreglo que clinica-1 le hizo a la cabecera de Personal, y
                por la misma razón: trunca el que sobra, y aquí no sobra el
                nombre.

                `basis-full` hasta `sm`, y a partir de ahí comparte línea
                con el resto. */}
            <button
              type="button"
              onClick={() => onFicha(f)}
              className="min-h-[44px] w-full min-w-0 text-left sm:w-auto sm:flex-1 sm:basis-48"
            >
              <span className="block truncate text-[14.5px] font-medium text-mipiace-ink">
                {f.nombre}
              </span>
              <span className="block text-[12.5px] text-slate-500">
                {f.cama
                  ? `Hab. ${f.cama.roomNumber} · cama ${f.cama.bedLabel} · ${f.cama.floorName}`
                  : "Sin habitación · ingreso pendiente"}
              </span>
            </button>
            <span className="shrink-0 rounded-lg bg-slate-100 px-2.5 py-1 text-[12.5px] text-slate-600">
              {NIVEL_LABEL[f.dependencyLevel]}
              {f.dependencyGrade ? ` · grado ${f.dependencyGrade}` : ""}
            </span>
            <span className="shrink-0 rounded-lg bg-slate-100 px-2.5 py-1 text-[12.5px] text-slate-600">
              {PLAZA_LABEL[f.placeType]}
            </span>
            {f.dischargeDate ? (
              <span className="shrink-0 text-[12.5px] text-slate-400">
                Alta {fechaCorta(f.dischargeDate)}
              </span>
            ) : (
              <div className="flex shrink-0 gap-2">
                {onMover && (
                  <OutlineButton onClick={() => onMover(f)} className="!h-10 !px-3">
                    <BedDouble className="h-4 w-4" /> Habitación
                  </OutlineButton>
                )}
                {onDarDeAlta && (
                  <OutlineButton
                    onClick={() => onDarDeAlta(f)}
                    className="!h-10 !px-3"
                  >
                    <LogOut className="h-4 w-4" /> Dar de alta
                  </OutlineButton>
                )}
              </div>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

function Modal({
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
          <h3 className="text-[16px] font-semibold text-mipiace-ink">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="flex h-11 w-11 items-center justify-center rounded-xl text-slate-400 hover:bg-slate-50"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Los dos o tres botones de una elección corta, a un toque. */
function Eleccion<T extends string>({
  label,
  valor,
  opciones,
  etiquetas,
  onChange,
}: {
  label: string;
  valor: T | null;
  opciones: T[];
  etiquetas: Record<string, string>;
  onChange: (v: T) => void;
}) {
  return (
    <div className="mb-4">
      <p className="mb-1.5 text-[13px] text-slate-500">{label}</p>
      <div className="flex flex-wrap gap-2">
        {opciones.map((o) => (
          <button
            key={o}
            type="button"
            onClick={() => onChange(o)}
            className={`min-h-[44px] rounded-xl border px-4 text-[13.5px] transition-colors ${
              valor === o
                ? "border-mipiace-coral bg-mipiace-coral/10 text-mipiace-ink font-medium"
                : "border-slate-200 text-slate-600 hover:bg-slate-50"
            }`}
          >
            {etiquetas[o] ?? o}
          </button>
        ))}
      </div>
    </div>
  );
}

function ModalAlta({
  onClose,
  onHecho,
}: {
  onClose: () => void;
  onHecho: () => void;
}) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [admissionDate, setAdmissionDate] = useState(hoyISO());
  const [nivel, setNivel] = useState<NivelDependencia | null>(null);
  const [grado, setGrado] = useState<"I" | "II" | "III" | null>(null);
  const [plaza, setPlaza] = useState<TipoDePlaza | null>(null);
  const [responsable, setResponsable] = useState("");
  const [responsableTel, setResponsableTel] = useState("");
  const [parentesco, setParentesco] = useState("");
  const [dni, setDni] = useState("");
  const [bedId, setBedId] = useState<string>("");
  const [libres, setLibres] = useState<
    Array<{ id: string; etiqueta: string }> | null
  >(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ plantas: PlantaVista[] }>("/residencia/edificio")
      .then((r) => setLibres(camasLibres(r.plantas)))
      .catch(() => setLibres([]));
  }, []);

  // El aviso sale ANTES de llegar al 400, igual que el nº de colegiado en
  // la pantalla de Personal de clinica-1.
  const faltan = [
    firstName.trim() ? null : "el nombre",
    nivel ? null : "el nivel de dependencia",
    plaza ? null : "el tipo de plaza",
  ].filter((x): x is string => x != null);

  async function guardar() {
    setBusy(true);
    setError(null);
    try {
      await api("/residencia/residentes", {
        method: "POST",
        body: {
          firstName: firstName.trim(),
          ...(lastName.trim() ? { lastName: lastName.trim() } : {}),
          ...(phone.trim() ? { phone: phone.trim() } : {}),
          admissionDate,
          dependencyLevel: nivel,
          ...(grado ? { dependencyGrade: grado } : {}),
          placeType: plaza,
          ...(responsable.trim() ? { responsibleName: responsable.trim() } : {}),
          ...(responsableTel.trim()
            ? { responsiblePhone: responsableTel.trim() }
            : {}),
          ...(parentesco.trim() ? { responsibleRelation: parentesco.trim() } : {}),
          ...(dni.trim() ? { dni: dni.trim() } : {}),
          ...(bedId ? { bedId } : {}),
        },
      });
      onHecho();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Error inesperado");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Nuevo ingreso" onClose={onClose}>
      <TextField id="nombre" label="Nombre" value={firstName} onChange={setFirstName} />
      <TextField id="apellidos" label="Apellidos" value={lastName} onChange={setLastName} />
      <TextField
        id="tel"
        label="Teléfono (opcional)"
        value={phone}
        onChange={setPhone}
        inputMode="tel"
      />
      <TextField
        id="ingreso"
        label="Fecha de ingreso"
        type="date"
        value={admissionDate}
        onChange={setAdmissionDate}
      />
      <Eleccion
        label="Nivel de dependencia"
        valor={nivel}
        opciones={NIVELES}
        etiquetas={NIVEL_LABEL}
        onChange={setNivel}
      />
      <Eleccion
        label="Grado reconocido (opcional)"
        valor={grado}
        opciones={["I", "II", "III"]}
        etiquetas={{ I: "Grado I", II: "Grado II", III: "Grado III" }}
        onChange={setGrado}
      />
      <Eleccion
        label="Tipo de plaza"
        valor={plaza}
        opciones={PLAZAS}
        etiquetas={PLAZA_LABEL}
        onChange={setPlaza}
      />
      <div className="mb-4">
        <label
          htmlFor="cama"
          className="mb-1.5 block text-[13px] text-slate-500"
        >
          Habitación y cama (opcional · se puede asignar después)
        </label>
        <select
          id="cama"
          value={bedId}
          onChange={(e) => setBedId(e.target.value)}
          className="h-12 w-full rounded-2xl border border-slate-200 bg-white px-3.5 text-[14.5px]"
        >
          <option value="">Sin asignar · ingreso pendiente</option>
          {(libres ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.etiqueta}
            </option>
          ))}
        </select>
      </div>
      <TextField
        id="responsable"
        label="Familiar responsable (opcional)"
        value={responsable}
        onChange={setResponsable}
      />
      <TextField
        id="responsable-tel"
        label="Su teléfono"
        value={responsableTel}
        onChange={setResponsableTel}
        inputMode="tel"
      />
      <TextField
        id="parentesco"
        label="Parentesco"
        value={parentesco}
        onChange={setParentesco}
      />
      <TextField id="dni" label="DNI (opcional)" value={dni} onChange={setDni} />

      {faltan.length > 0 && (
        <p className="mb-3 text-[13px] text-slate-500">
          Falta {faltan.join(", ")}.
        </p>
      )}
      <FieldError message={error} />
      <div className="mt-4">
        <PrimaryButton
          type="button"
          busy={busy}
          disabled={faltan.length > 0}
          onClick={() => void guardar()}
        >
          Registrar ingreso
        </PrimaryButton>
      </div>
    </Modal>
  );
}

function ModalFicha({
  residente,
  onClose,
}: {
  residente: ResidenteFicha;
  onClose: () => void;
}) {
  return (
    <Modal title={residente.nombre} onClose={onClose}>
      <dl className="space-y-2.5 text-[13.5px]">
        <Dato k="Habitación">
          {residente.cama
            ? `${residente.cama.roomNumber} · cama ${residente.cama.bedLabel} · ${residente.cama.floorName}`
            : "Sin asignar · ingreso pendiente"}
        </Dato>
        <Dato k="Ingreso">{fechaCorta(residente.admissionDate)}</Dato>
        {residente.dischargeDate && (
          <Dato k="Alta">
            {fechaCorta(residente.dischargeDate)}
            {residente.dischargeReason ? ` · ${residente.dischargeReason}` : ""}
          </Dato>
        )}
        <Dato k="Dependencia">
          {NIVEL_LABEL[residente.dependencyLevel]}
          {residente.dependencyGrade ? ` · grado ${residente.dependencyGrade}` : ""}
        </Dato>
        <Dato k="Plaza">{PLAZA_LABEL[residente.placeType]}</Dato>
        <Dato k="Teléfono">{residente.phone ?? "—"}</Dato>
        <Dato k="Familiar">
          {residente.responsible
            ? `${residente.responsible.name}${
                residente.responsible.relation
                  ? ` (${residente.responsible.relation})`
                  : ""
              }${residente.responsible.phone ? ` · ${residente.responsible.phone}` : ""}`
            : "—"}
        </Dato>
        <Dato k="DNI">{residente.dni ?? "—"}</Dato>
        <Dato k="NSS">{residente.nss ?? "—"}</Dato>
      </dl>

      {/* residencia-2 · de aquí se llega al plan de cuidados. El botón va
          en la ficha y el plan tiene su propia pantalla: veinte líneas en
          cuatro grupos más la vista de «hoy» dentro de un modal, a 320 px,
          es un scroll que no acaba. */}
      <div className="mt-5">
        <Link
          to={`/admin/residencia/residentes/${residente.clientId}/plan`}
          className="flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-slate-200 px-4 text-[13.5px] text-mipiace-ink hover:bg-slate-50"
        >
          <ClipboardList className="h-4 w-4" /> Su plan de cuidados
        </Link>
      </div>

      {residente.ocupaciones.length > 1 && (
        <>
          <h4 className="mb-2 mt-6 text-[14px] font-semibold text-mipiace-ink">
            Habitaciones anteriores
          </h4>
          <ul className="space-y-1.5 text-[13px] text-slate-600">
            {residente.ocupaciones.map((o) => (
              <li key={o.id}>
                Hab. {o.habitacion} · cama {o.cama} ·{" "}
                {new Date(o.desde).toLocaleDateString("es-ES")} →{" "}
                {o.hasta
                  ? new Date(o.hasta).toLocaleDateString("es-ES")
                  : "ahora"}
                {o.motivo ? ` · ${o.motivo}` : ""}
              </li>
            ))}
          </ul>
        </>
      )}
    </Modal>
  );
}

function Dato({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <dt className="w-32 shrink-0 text-slate-500">{k}</dt>
      <dd className="min-w-0 flex-1 text-mipiace-ink">{children}</dd>
    </div>
  );
}

function ModalCama({
  residente,
  onClose,
  onHecho,
}: {
  residente: ResidenteFila;
  onClose: () => void;
  onHecho: () => void;
}) {
  const [libres, setLibres] = useState<
    Array<{ id: string; etiqueta: string }> | null
  >(null);
  const [bedId, setBedId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ plantas: PlantaVista[] }>("/residencia/edificio")
      .then((r) => setLibres(camasLibres(r.plantas)))
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : "Error inesperado"),
      );
  }, []);

  async function guardar() {
    setBusy(true);
    setError(null);
    try {
      await api(`/residencia/residentes/${residente.clientId}/cama`, {
        method: "POST",
        body: { bedId },
      });
      onHecho();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Error inesperado");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`Habitación de ${residente.nombre}`} onClose={onClose}>
      <p className="mb-4 text-[13.5px] text-slate-500">
        {residente.cama
          ? `Ahora está en la ${residente.cama.roomNumber}, cama ${residente.cama.bedLabel}. Cambiarla cierra esa ocupación y abre otra: queda el histórico.`
          : "No tiene habitación asignada todavía."}
      </p>
      <div className="mb-4">
        <label htmlFor="nueva-cama" className="mb-1.5 block text-[13px] text-slate-500">
          Cama libre
        </label>
        <select
          id="nueva-cama"
          value={bedId}
          onChange={(e) => setBedId(e.target.value)}
          className="h-12 w-full rounded-2xl border border-slate-200 bg-white px-3.5 text-[14.5px]"
        >
          <option value="">Elige una cama…</option>
          {(libres ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.etiqueta}
            </option>
          ))}
        </select>
      </div>
      <FieldError message={error} />
      <div className="mt-4">
        <PrimaryButton
          type="button"
          busy={busy}
          disabled={!bedId}
          onClick={() => void guardar()}
        >
          Mover
        </PrimaryButton>
      </div>
    </Modal>
  );
}

function ModalDarDeAlta({
  residente,
  onClose,
  onHecho,
}: {
  residente: ResidenteFila;
  onClose: () => void;
  onHecho: () => void;
}) {
  const [fecha, setFecha] = useState(hoyISO());
  const [motivo, setMotivo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function guardar() {
    setBusy(true);
    setError(null);
    try {
      await api(`/residencia/residentes/${residente.clientId}/alta`, {
        method: "POST",
        body: {
          dischargeDate: fecha,
          ...(motivo.trim() ? { dischargeReason: motivo.trim() } : {}),
        },
      });
      onHecho();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Error inesperado");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`Dar de alta a ${residente.nombre}`} onClose={onClose}>
      {/* La frase importa: en una residencia «dar de alta» es que alguien se
          va, y la dirección tiene que leer que su ficha NO se borra. */}
      <p className="mb-4 text-[13.5px] text-slate-500">
        Su ficha y su historia se conservan: dar de alta no borra nada.
        {residente.cama && " Se libera su cama."}
      </p>
      <TextField
        id="alta-fecha"
        label="Fecha de alta"
        type="date"
        value={fecha}
        onChange={setFecha}
      />
      <TextField
        id="alta-motivo"
        label="Motivo (opcional)"
        value={motivo}
        onChange={setMotivo}
      />
      <FieldError message={error} />
      <div className="mt-4">
        <PrimaryButton type="button" busy={busy} onClick={() => void guardar()}>
          Dar de alta
        </PrimaryButton>
      </div>
    </Modal>
  );
}

/**
 * Las camas LIBRES del centro, como opciones de un `select`.
 *
 * Se calcula en el cliente a partir de la vista del edificio —que ya trae
 * quién ocupa cada cama— en vez de pedir una ruta propia: es una petición
 * menos y la vista del edificio es la misma que la pantalla de al lado ya
 * usa. Con 49 camas no hay nada que optimizar.
 */
function camasLibres(
  plantas: PlantaVista[],
): Array<{ id: string; etiqueta: string }> {
  const out: Array<{ id: string; etiqueta: string }> = [];
  for (const p of plantas) {
    for (const h of p.habitaciones) {
      if (!h.active) continue;
      for (const c of h.camas) {
        if (!c.active || c.ocupa != null) continue;
        out.push({
          id: c.id,
          etiqueta: `Hab. ${h.number} · cama ${c.label} · ${p.name}`,
        });
      }
    }
  }
  return out;
}
