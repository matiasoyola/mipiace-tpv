// residencia-2 (D-53) · PLANTILLAS POR NIVEL · qué lleva un válido, un
// semiasistido y un dependiente.
//
// Es el valor por defecto que se precarga al dar de alta a un residente y
// el que se recalcula al cambiarle el nivel. La idea entera del bloque
// cabe en una frase de esta pantalla: la dirección da de alta a un
// semiasistido y **en ese momento ya tiene su plan del día**.
//
// ── Los tres niveles a la vez, en tres columnas ──────────────────────
//
// Porque la pregunta que la dirección se hace es comparativa: «¿qué lleva
// un dependiente que no lleva un semiasistido?». Con tres pantallas habría
// que recordar la anterior. A 320 px las tres columnas se apilan y cada
// una se lee entera, que es lo mismo pero de arriba abajo.
//
// ── Guardar NO toca los planes ya abiertos ───────────────────────────
//
// Y se dice en la pantalla. Una plantilla es lo que se aplica a los
// ingresos y a los cambios de nivel **de ahí en adelante**: si cambiarla
// recalculara los 49 planes, la dirección movería una casilla y cerraría
// líneas que la DUE puso a mano hace un mes.

import { useEffect, useState } from "react";
import { Plus, Trash2, X } from "lucide-react";

import { AdminShell } from "../../AdminShell.js";
import { api, ApiError } from "../../api.js";
import {
  CenteredLoader,
  FieldError,
  OutlineButton,
  PrimaryButton,
  SuccessBanner,
} from "../../ui.js";
import {
  CAPA_LABEL,
  NIVEL_LABEL,
  frecuenciaCorta,
  type Capa,
  type FrecuenciaUI,
  type MomentoDelDia,
  type NivelDependencia,
  type TipoDeFrecuencia,
  type TurnoCorto,
} from "./lib.js";
import { Pastilla, SelectorDeFrecuencia } from "./frecuencia-ui.js";

interface LineaDePlantilla {
  id: string;
  controlCode: string;
  nombre: string;
  frecuencia: FrecuenciaUI;
  /** `false` si el centro desactivó el control. Se pinta en ámbar. */
  activo: boolean;
}

interface ControlOfrecido {
  code: string;
  nombre: string;
  layer: Capa;
  nature: "SCHEDULED" | "ON_DEMAND" | "DERIVED";
  activo: boolean;
  puedeElegir: { frecuencias: TipoDeFrecuencia[] };
  frecuenciaDeSerie: FrecuenciaUI;
}

interface Datos {
  plantillas: Record<NivelDependencia, LineaDePlantilla[]>;
  controles: ControlOfrecido[];
  turnos: TurnoCorto[];
  momentos: MomentoDelDia[];
}

const NIVELES: NivelDependencia[] = ["VALIDO", "SEMIASISTIDO", "DEPENDIENTE"];

/** Lo que cada nivel significa, para que nadie tenga que suponerlo. */
const NIVEL_AYUDA: Record<NivelDependencia, string> = {
  VALIDO: "Se vale solo: se asea, come y se mueve.",
  SEMIASISTIDO: "Necesita ayuda para algunas cosas.",
  DEPENDIENTE: "Necesita ayuda para casi todo y hay que movilizarlo.",
};

export function PlantillasPage() {
  const [datos, setDatos] = useState<Datos | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [guardado, setGuardado] = useState<string | null>(null);
  const [anadiendo, setAnadiendo] = useState<NivelDependencia | null>(null);
  const [editando, setEditando] = useState<
    { nivel: NivelDependencia; linea: LineaDePlantilla } | null
  >(null);

  // El estado local de las tres plantillas: se edita aquí y se guarda por
  // nivel, que es como la API lo acepta (un `PUT` de la lista completa).
  const [borrador, setBorrador] = useState<
    Record<NivelDependencia, LineaDePlantilla[]> | null
  >(null);

  async function recargar() {
    try {
      const r = await api<Datos>("/residencia/plantillas");
      setDatos(r);
      setBorrador(r.plantillas);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Error inesperado");
    }
  }

  useEffect(() => {
    void recargar();
  }, []);

  if (!datos || !borrador) return <CenteredLoader label="Cargando plantillas…" />;

  async function guardar(nivel: NivelDependencia) {
    setError(null);
    setGuardado(null);
    try {
      await api(`/residencia/plantillas/${nivel}`, {
        method: "PUT",
        body: {
          lineas: borrador![nivel].map((l) => ({
            controlCode: l.controlCode,
            frecuencia: l.frecuencia,
          })),
        },
      });
      setGuardado(
        `Plantilla de ${NIVEL_LABEL[nivel].toLowerCase()} guardada. Se aplicará a los próximos ingresos y a los cambios de nivel.`,
      );
      void recargar();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Error inesperado");
    }
  }

  const cambiado = (nivel: NivelDependencia) =>
    JSON.stringify(borrador[nivel].map((l) => [l.controlCode, l.frecuencia])) !==
    JSON.stringify(datos.plantillas[nivel].map((l) => [l.controlCode, l.frecuencia]));

  return (
    <AdminShell title="Plantillas por nivel">
      <p className="-mt-2 mb-5 text-[13.5px] text-slate-500">
        Lo que se precarga al dar de alta a un residente, según cuánta ayuda
        necesite. Guardar no cambia los planes que ya están abiertos: se
        aplica a los próximos ingresos y a los cambios de nivel.
      </p>

      {error && <FieldError message={error} />}
      {guardado && <SuccessBanner message={guardado} />}

      <div className="grid gap-5 lg:grid-cols-3">
        {NIVELES.map((nivel) => (
          <section
            key={nivel}
            className="rounded-2xl border border-slate-200 bg-white px-4 py-4"
          >
            <h2 className="text-[15.5px] font-semibold text-mipiace-ink">
              {NIVEL_LABEL[nivel]}{" "}
              <span className="font-normal tabular-nums text-slate-400">
                {borrador[nivel].length}
              </span>
            </h2>
            <p className="mb-3 text-[12.5px] text-slate-500">{NIVEL_AYUDA[nivel]}</p>

            <ul className="space-y-1.5">
              {borrador[nivel].map((l) => (
                <li
                  key={l.controlCode}
                  className="flex items-start gap-2 rounded-xl border border-slate-100 px-3 py-2"
                >
                  <button
                    type="button"
                    onClick={() => setEditando({ nivel, linea: l })}
                    className="min-h-[44px] min-w-0 flex-1 text-left"
                  >
                    <span className="block text-[13.5px] font-medium text-mipiace-ink">
                      {l.nombre}
                    </span>
                    <span className="block text-[12px] text-slate-500">
                      {frecuenciaCorta(l.frecuencia, datos.turnos, datos.momentos)}
                    </span>
                    {!l.activo && (
                      // Ni error ni se quita sola: el centro desactivó el
                      // control y volver a activarlo tiene que devolverlo
                      // al plan.
                      <span className="block text-[12px] text-amber-700">
                        El control está desactivado: no tocaría.
                      </span>
                    )}
                  </button>
                  <button
                    type="button"
                    aria-label={`Quitar ${l.nombre}`}
                    onClick={() =>
                      setBorrador({
                        ...borrador,
                        [nivel]: borrador[nivel].filter(
                          (x) => x.controlCode !== l.controlCode,
                        ),
                      })
                    }
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-slate-400 hover:bg-slate-50"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </li>
              ))}
              {borrador[nivel].length === 0 && (
                <li className="rounded-xl bg-slate-50 px-3 py-3 text-[13px] text-slate-500">
                  Sin nada precargado. Un residente de este nivel entrará con el
                  plan vacío y habrá que montárselo a mano.
                </li>
              )}
            </ul>

            <div className="mt-3 flex flex-wrap gap-2">
              <OutlineButton
                onClick={() => setAnadiendo(nivel)}
                className="!h-10 !w-auto !px-3 !text-[13px]"
              >
                <Plus className="h-4 w-4" /> Añadir
              </OutlineButton>
              {cambiado(nivel) && (
                <PrimaryButton
                  type="button"
                  onClick={() => void guardar(nivel)}
                  className="!h-10 !w-auto !px-4 !text-[13px]"
                >
                  Guardar
                </PrimaryButton>
              )}
            </div>
          </section>
        ))}
      </div>

      {anadiendo && (
        <ModalAnadir
          nivel={anadiendo}
          yaPuestos={borrador[anadiendo].map((l) => l.controlCode)}
          controles={datos.controles}
          turnos={datos.turnos}
          momentos={datos.momentos}
          onClose={() => setAnadiendo(null)}
          onAnadir={(linea) => {
            setBorrador({ ...borrador, [anadiendo]: [...borrador[anadiendo], linea] });
            setAnadiendo(null);
          }}
        />
      )}

      {editando && (
        <ModalFrecuencia
          titulo={editando.linea.nombre}
          valor={editando.linea.frecuencia}
          permitidas={
            datos.controles.find((c) => c.code === editando.linea.controlCode)
              ?.puedeElegir.frecuencias ?? []
          }
          turnos={datos.turnos}
          momentos={datos.momentos}
          onClose={() => setEditando(null)}
          onGuardar={(f) => {
            setBorrador({
              ...borrador,
              [editando.nivel]: borrador[editando.nivel].map((l) =>
                l.controlCode === editando.linea.controlCode ? { ...l, frecuencia: f } : l,
              ),
            });
            setEditando(null);
          }}
        />
      )}
    </AdminShell>
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

/**
 * Qué control se añade a la plantilla de un nivel.
 *
 * No se ofrecen los que ya están, ni los que el centro desactivó, ni los
 * `ON_DEMAND`: un control a demanda en una plantilla no hace daño pero no
 * hace nada —`queToca` no devuelve ocurrencias suyas— y el servidor lo
 * rechaza con un 400. Mejor no ofrecerlo que explicar por qué no vale.
 */
function ModalAnadir({
  nivel,
  yaPuestos,
  controles,
  turnos,
  momentos,
  onClose,
  onAnadir,
}: {
  nivel: NivelDependencia;
  yaPuestos: string[];
  controles: ControlOfrecido[];
  turnos: TurnoCorto[];
  momentos: MomentoDelDia[];
  onClose: () => void;
  onAnadir: (l: LineaDePlantilla) => void;
}) {
  const [elegido, setElegido] = useState<ControlOfrecido | null>(null);
  const [frecuencia, setFrecuencia] = useState<FrecuenciaUI | null>(null);

  const ofrecidos = controles.filter(
    (c) => !yaPuestos.includes(c.code) && c.activo && c.nature !== "ON_DEMAND",
  );

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
            onClick={() =>
              onAnadir({
                id: `nuevo-${elegido.code}`,
                controlCode: elegido.code,
                nombre: elegido.nombre,
                frecuencia,
                activo: true,
              })
            }
          >
            Añadir a {NIVEL_LABEL[nivel].toLowerCase()}
          </PrimaryButton>
        </div>
      </Marco>
    );
  }

  return (
    <Marco title={`Añadir a ${NIVEL_LABEL[nivel].toLowerCase()}`} onClose={onClose}>
      {(["EXEC", "OBS", "MEASURE"] as Capa[]).map((capa) => {
        const deLaCapa = ofrecidos.filter((c) => c.layer === capa);
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
                    setFrecuencia(c.frecuenciaDeSerie);
                  }}
                >
                  {c.nombre}
                </Pastilla>
              ))}
            </div>
          </div>
        );
      })}
      {ofrecidos.length === 0 && (
        <p className="text-[13px] text-slate-500">
          Esta plantilla ya lleva todo lo que se puede agendar.
        </p>
      )}
    </Marco>
  );
}

/** Cambiarle la frecuencia a una línea que ya está. */
function ModalFrecuencia({
  titulo,
  valor,
  permitidas,
  turnos,
  momentos,
  onClose,
  onGuardar,
}: {
  titulo: string;
  valor: FrecuenciaUI;
  permitidas: TipoDeFrecuencia[];
  turnos: TurnoCorto[];
  momentos: MomentoDelDia[];
  onClose: () => void;
  onGuardar: (f: FrecuenciaUI) => void;
}) {
  const [f, setF] = useState<FrecuenciaUI>(valor);
  return (
    <Marco title={titulo} onClose={onClose}>
      <SelectorDeFrecuencia
        valor={f}
        permitidas={permitidas}
        turnos={turnos}
        momentos={momentos}
        onChange={setF}
      />
      <div className="mt-5">
        <PrimaryButton type="button" onClick={() => onGuardar(f)}>
          Hecho
        </PrimaryButton>
      </div>
    </Marco>
  );
}
