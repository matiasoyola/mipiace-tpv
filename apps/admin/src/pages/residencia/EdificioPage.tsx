// residencia-1 · EDIFICIO.
//
// Plantas → habitaciones → camas, con quién ocupa cada una y qué tablet es
// la puerta de cada habitación.
//
// ── Un árbol y no tres listas ────────────────────────────────────────
//
// Porque así es el edificio y así lo nombra el personal: «la 112 de la
// primera». Tres pantallas con un selector arriba habrían obligado a la
// dirección a saber en qué planta está la 112 antes de poder abrirla.
//
// ── El alta de una habitación crea sus camas ─────────────────────────
//
// «¿Cuántas camas?» en el mismo formulario, y de ahí salen A, B, C. Montar
// Jardín de Gredos son 30 habitaciones y 49 camas: pedirlas de una en una
// después era media mañana de alguien.
//
// ── Y la tablet de la puerta ─────────────────────────────────────────
//
// El código de 6 dígitos se genera desde la propia habitación, que es
// donde se está mirando cuando hace falta. Es el MISMO código de siempre
// (seis dígitos, una hora, un solo uso), por una ruta propia porque la de
// la caja exige caja y una residencia no la tiene.

import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Plus, Tablet, X } from "lucide-react";

import { AdminShell } from "../../AdminShell.js";
import { api, ApiError } from "../../api.js";
import {
  CenteredLoader,
  FieldError,
  OutlineButton,
  PrimaryButton,
  TextField,
} from "../../ui.js";
import type { PlantaVista } from "./lib.js";

export function EdificioPage() {
  const [plantas, setPlantas] = useState<PlantaVista[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [abiertas, setAbiertas] = useState<Set<string>>(new Set());
  const [altaPlanta, setAltaPlanta] = useState(false);
  const [altaHab, setAltaHab] = useState<PlantaVista | null>(null);
  const [emparejando, setEmparejando] = useState<{
    roomId: string;
    number: string;
  } | null>(null);

  async function recargar() {
    try {
      const r = await api<{ plantas: PlantaVista[] }>("/residencia/edificio");
      setPlantas(r.plantas);
      // La primera vez se abren todas: un centro tiene dos o tres plantas y
      // verlo entero es lo que la dirección viene a hacer.
      setAbiertas((previo) =>
        previo.size === 0 ? new Set(r.plantas.map((p) => p.id)) : previo,
      );
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Error inesperado");
    }
  }

  useEffect(() => {
    void recargar();
  }, []);

  function alternar(id: string) {
    setAbiertas((previo) => {
      const siguiente = new Set(previo);
      if (siguiente.has(id)) siguiente.delete(id);
      else siguiente.add(id);
      return siguiente;
    });
  }

  if (!plantas) return <CenteredLoader label="Cargando el edificio…" error={error} />;

  const camas = plantas.flatMap((p) => p.habitaciones.flatMap((h) => h.camas));
  const ocupadas = camas.filter((c) => c.ocupa != null).length;

  return (
    <AdminShell title="Edificio">
      <p className="-mt-2 mb-5 text-[13.5px] text-slate-500">
        Plantas, habitaciones y camas. {ocupadas} de {camas.length} plazas
        ocupadas.
      </p>

      {error && <FieldError message={error} />}

      <div className="mb-5 flex items-center justify-between gap-3">
        <h2 className="text-[16px] font-semibold text-mipiace-ink">
          Plantas{" "}
          <span className="font-normal tabular-nums text-slate-400">
            {plantas.length}
          </span>
        </h2>
        <PrimaryButton
          type="button"
          onClick={() => setAltaPlanta(true)}
          className="!h-10 !w-auto !px-4 !text-[13.5px]"
        >
          <Plus className="h-4 w-4" /> Añadir planta
        </PrimaryButton>
      </div>

      {plantas.length === 0 && (
        <p className="rounded-2xl border border-slate-200 bg-white px-5 py-6 text-[13.5px] text-slate-500">
          Empieza por las plantas del centro: «Baja», «Primera»… Después, sus
          habitaciones.
        </p>
      )}

      <div className="space-y-3">
        {plantas.map((p) => {
          const abierta = abiertas.has(p.id);
          return (
            <section
              key={p.id}
              className="overflow-hidden rounded-2xl border border-slate-200 bg-white"
            >
              <div className="flex items-center gap-2 px-3 py-2">
                <button
                  type="button"
                  onClick={() => alternar(p.id)}
                  className="flex min-h-[44px] flex-1 items-center gap-2 text-left"
                  aria-expanded={abierta}
                >
                  {abierta ? (
                    <ChevronDown className="h-4 w-4 text-slate-400" />
                  ) : (
                    <ChevronRight className="h-4 w-4 text-slate-400" />
                  )}
                  <span className="text-[14.5px] font-medium text-mipiace-ink">
                    {p.name}
                  </span>
                  <span className="text-[12.5px] text-slate-400">
                    {p.habitaciones.length} hab.
                  </span>
                </button>
                <OutlineButton onClick={() => setAltaHab(p)} className="!h-10 !px-3">
                  <Plus className="h-4 w-4" /> Habitación
                </OutlineButton>
              </div>

              {abierta && p.habitaciones.length > 0 && (
                <ul className="border-t border-slate-100">
                  {p.habitaciones.map((h) => (
                    <li
                      key={h.id}
                      className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-slate-100 px-4 py-3 last:border-b-0"
                    >
                      <span className="w-20 shrink-0 text-[14.5px] font-medium tabular-nums text-mipiace-ink">
                        {h.number}
                        {!h.active && (
                          <span className="ml-1 text-[11.5px] font-normal text-amber-700">
                            fuera
                          </span>
                        )}
                      </span>
                      <ul className="min-w-0 flex-1 space-y-1">
                        {h.camas.map((c) => (
                          <li key={c.id} className="text-[13px]">
                            <span className="mr-2 tabular-nums text-slate-400">
                              {c.label}
                            </span>
                            {/* Nombre y nada más: ni dependencia ni plaza.
                                Esta pantalla se mira de pie. */}
                            {c.ocupa ? (
                              <span className="text-mipiace-ink">
                                {c.ocupa.nombre}
                              </span>
                            ) : (
                              <span className="text-slate-400">libre</span>
                            )}
                          </li>
                        ))}
                        {h.camas.length === 0 && (
                          <li className="text-[13px] text-slate-400">
                            sin camas
                          </li>
                        )}
                      </ul>
                      <div className="shrink-0">
                        {h.puerta ? (
                          <span className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 px-2.5 py-1 text-[12.5px] text-emerald-700">
                            <Tablet className="h-3.5 w-3.5" />
                            Tablet emparejada
                          </span>
                        ) : (
                          <OutlineButton
                            onClick={() =>
                              setEmparejando({ roomId: h.id, number: h.number })
                            }
                            className="!h-10 !px-3"
                          >
                            <Tablet className="h-4 w-4" /> Emparejar tablet
                          </OutlineButton>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>

      {altaPlanta && (
        <ModalPlanta
          onClose={() => setAltaPlanta(false)}
          onHecho={() => {
            setAltaPlanta(false);
            void recargar();
          }}
        />
      )}
      {altaHab && (
        <ModalHabitacion
          planta={altaHab}
          onClose={() => setAltaHab(null)}
          onHecho={() => {
            setAltaHab(null);
            void recargar();
          }}
        />
      )}
      {emparejando && (
        <ModalEmparejar
          habitacion={emparejando}
          onClose={() => {
            setEmparejando(null);
            void recargar();
          }}
        />
      )}
    </AdminShell>
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
      <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-6">
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

function ModalPlanta({
  onClose,
  onHecho,
}: {
  onClose: () => void;
  onHecho: () => void;
}) {
  const [name, setName] = useState("");
  const [orden, setOrden] = useState("0");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function guardar() {
    setBusy(true);
    setError(null);
    try {
      await api("/residencia/plantas", {
        method: "POST",
        body: { name: name.trim(), sortOrder: Number(orden) || 0 },
      });
      onHecho();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Error inesperado");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Añadir planta" onClose={onClose}>
      <TextField id="planta-nombre" label="Nombre" value={name} onChange={setName} />
      {/* El orden existe porque «Baja» va antes que «Primera» y
          alfabéticamente no. */}
      <TextField
        id="planta-orden"
        label="Orden (0 primero)"
        value={orden}
        onChange={setOrden}
        inputMode="numeric"
      />
      <FieldError message={error} />
      <div className="mt-4">
        <PrimaryButton
          type="button"
          busy={busy}
          disabled={!name.trim()}
          onClick={() => void guardar()}
        >
          Añadir
        </PrimaryButton>
      </div>
    </Modal>
  );
}

function ModalHabitacion({
  planta,
  onClose,
  onHecho,
}: {
  planta: PlantaVista;
  onClose: () => void;
  onHecho: () => void;
}) {
  const [number, setNumber] = useState("");
  const [name, setName] = useState("");
  const [camas, setCamas] = useState("1");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function guardar() {
    setBusy(true);
    setError(null);
    try {
      await api("/residencia/habitaciones", {
        method: "POST",
        body: {
          floorId: planta.id,
          number: number.trim(),
          ...(name.trim() ? { name: name.trim() } : {}),
          camas: Number(camas) || 0,
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
    <Modal title={`Habitación en ${planta.name}`} onClose={onClose}>
      <TextField
        id="hab-numero"
        label="Número"
        value={number}
        onChange={setNumber}
        placeholder="112"
      />
      <TextField
        id="hab-nombre"
        label="Nombre (opcional)"
        value={name}
        onChange={setName}
      />
      <div className="mb-4">
        <p className="mb-1.5 text-[13px] text-slate-500">Camas</p>
        <div className="flex gap-2">
          {[1, 2, 3, 4].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setCamas(String(n))}
              className={`min-h-[44px] w-12 rounded-xl border text-[14.5px] tabular-nums transition-colors ${
                camas === String(n)
                  ? "border-mipiace-coral bg-mipiace-coral/10 font-medium text-mipiace-ink"
                  : "border-slate-200 text-slate-600 hover:bg-slate-50"
              }`}
            >
              {n}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-[12.5px] text-slate-400">
          Se crean como A, B, C…
        </p>
      </div>
      <FieldError message={error} />
      <div className="mt-4">
        <PrimaryButton
          type="button"
          busy={busy}
          disabled={!number.trim()}
          onClick={() => void guardar()}
        >
          Añadir
        </PrimaryButton>
      </div>
    </Modal>
  );
}

function ModalEmparejar({
  habitacion,
  onClose,
}: {
  habitacion: { roomId: string; number: string };
  onClose: () => void;
}) {
  const [code, setCode] = useState<string | null>(null);
  const [expira, setExpira] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generar() {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ code: string; expiresAt: string }>(
        `/residencia/habitaciones/${habitacion.roomId}/pairing-codes`,
        { method: "POST", body: {} },
      );
      setCode(r.code);
      setExpira(r.expiresAt);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Error inesperado");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`Tablet de la ${habitacion.number}`} onClose={onClose}>
      {code ? (
        <>
          <p className="mb-2 text-[13.5px] text-slate-500">
            Teclea este código en la tablet de la habitación:
          </p>
          <p className="mb-2 text-center text-[48px] font-semibold tabular-nums tracking-[0.12em] text-mipiace-ink">
            {code}
          </p>
          <p className="text-center text-[12.5px] text-slate-400">
            Caduca a las{" "}
            {expira
              ? new Date(expira).toLocaleTimeString("es-ES", {
                  hour: "2-digit",
                  minute: "2-digit",
                })
              : "—"}
            . Se usa una sola vez.
          </p>
        </>
      ) : (
        <>
          <p className="mb-4 text-[13.5px] text-slate-500">
            La tablet de la puerta enseña el número de habitación y quién la
            ocupa. Si ya había una emparejada, la nueva la releva.
          </p>
          <FieldError message={error} />
          <PrimaryButton type="button" busy={busy} onClick={() => void generar()}>
            Generar código
          </PrimaryButton>
        </>
      )}
    </Modal>
  );
}
