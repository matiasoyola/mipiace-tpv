// residencia-4 (D-35, D-38) · **EL LIBRO DE INCIDENCIAS.**
//
// «Una sola pantalla de qué hay abierto hoy en la residencia» — que es
// literalmente la métrica de éxito de dirección (rama de controles §6.3).
//
// ── LAS ABIERTAS, Y SIN PEDIRLO ─────────────────────────────────────
//
// El filtro llega puesto en «abiertas». No es un atajo de usabilidad: es
// la pantalla. Una lista que por defecto enseña el histórico entero
// obliga a filtrar cada mañana para ver lo que importa, y a la tercera
// mañana nadie filtra.
//
// Dentro: las más graves primero y, a igual nivel, las más antiguas. Un
// N4 de hace una hora va por delante de un N1 de hace cinco minutos, y un
// N1 que lleva tres días abierto va por delante de uno de esta mañana —
// porque lo que una auditoría pregunta no es cuántas hubo, es cuánto
// tardaron en cerrarse.
//
// ── Y UN SOLO LIBRO, CON EL SUJETO COMO FILTRO ──────────────────────
//
// Residente, queja y avería en la misma lista (D-35, D-38). Tres
// pantallas habrían significado tres sitios donde mirar por la mañana y
// —lo que de verdad importa— la pérdida del caso cruzado: la caída de la
// 112 y el asidero suelto de la 112 se enlazan desde la ficha, y para
// enlazarlas hay que verlas juntas.
//
// ── LO QUE ESTA PANTALLA NO DESCIFRA ────────────────────────────────
//
// La descripción. Son cien filas y la descripción es salud: se descifra
// al abrir la ficha, que es cuando alguien la está mirando de verdad. La
// lista enseña el tipo, el nivel, de quién es y en qué estado está — que
// es lo que hace falta para decidir a cuál entrar.

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Plus } from "lucide-react";

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
  colorDelNivel,
  fechaYHora,
  nombreDelCanal,
  nombreDelOrigen,
  nombreDelSujeto,
  type Capacidad,
  type IncidenciaEnLaLista,
  type Nivel,
  type Sujeto,
} from "./incidencias-lib.js";

const NIVELES: Nivel[] = ["N0", "N1", "N2", "N3", "N4"];
const SUJETOS: Sujeto[] = ["RESIDENT", "COMPLAINT", "MAINTENANCE"];

/** Lo que el admin puede declarar desde el despacho. Es un subconjunto
 *  de la plantilla: lo de la puerta (una caída, un vómito) lo declara
 *  quien está delante del residente, no quien está en el despacho. */
const DECLARABLES = [
  { sujeto: "COMPLAINT" as Sujeto, evento: "QUEJA", etiqueta: "Queja de familia o residente", pregunta: null },
  {
    sujeto: "MAINTENANCE" as Sujeto,
    evento: "AVERIA",
    etiqueta: "Avería",
    pregunta: {
      texto: "¿Afecta a la seguridad? (asidero, timbre, cama)",
      opciones: [
        { matiz: "PELIGROSA", etiqueta: "Sí" },
        { matiz: "SIN_RIESGO", etiqueta: "No" },
      ],
    },
  },
];

export function IncidenciasPage() {
  const [filas, setFilas] = useState<IncidenciaEnLaLista[] | null>(null);
  const [capacidades, setCapacidades] = useState<Capacidad[]>([]);
  const [abiertas, setAbiertas] = useState<"si" | "no" | "todas">("si");
  const [sujeto, setSujeto] = useState<Sujeto | "">("");
  const [nivel, setNivel] = useState<Nivel | "">("");
  const [error, setError] = useState<string | null>(null);
  const [declarando, setDeclarando] = useState(false);

  async function recargar() {
    try {
      const q = new URLSearchParams({ abiertas });
      if (sujeto) q.set("sujeto", sujeto);
      if (nivel) q.set("nivel", nivel);
      const r = await api<{
        incidencias: IncidenciaEnLaLista[];
        capacidades: Capacidad[];
      }>(`/residencia/incidencias?${q.toString()}`);
      setFilas(r.incidencias);
      setCapacidades(r.capacidades);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Error inesperado");
      setFilas([]);
    }
  }

  useEffect(() => {
    void recargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abiertas, sujeto, nivel]);

  if (!filas) return <CenteredLoader label="Cargando el libro…" />;

  return (
    <AdminShell title="Incidencias">
      <p className="-mt-2 mb-5 text-[13.5px] text-slate-500">
        El libro del centro: lo de los residentes, las quejas y las averías,
        todo junto. Lo que la puerta declara y lo que el sistema deriva
        aparece aquí solo.
      </p>

      {error && <FieldError message={error} />}

      <div className="mb-5 flex flex-wrap items-center gap-2">
        {(
          [
            ["si", "Abiertas"],
            ["no", "Cerradas"],
            ["todas", "Todas"],
          ] as const
        ).map(([v, etiqueta]) => (
          <button
            key={v}
            type="button"
            onClick={() => setAbiertas(v)}
            className={`h-9 rounded-full px-4 text-[13.5px] ${
              abiertas === v
                ? "bg-mipiace-ink text-white"
                : "border border-slate-300 text-slate-600"
            }`}
          >
            {etiqueta}
          </button>
        ))}
        <span className="mx-2 h-6 w-px bg-slate-200" />
        <select
          value={sujeto}
          onChange={(e) => setSujeto(e.target.value as Sujeto | "")}
          className="h-9 rounded-lg border border-slate-300 px-3 text-[13.5px]"
        >
          <option value="">Todos los sujetos</option>
          {SUJETOS.map((s) => (
            <option key={s} value={s}>
              {nombreDelSujeto(s)}
            </option>
          ))}
        </select>
        <select
          value={nivel}
          onChange={(e) => setNivel(e.target.value as Nivel | "")}
          className="h-9 rounded-lg border border-slate-300 px-3 text-[13.5px]"
        >
          <option value="">Todos los niveles</option>
          {NIVELES.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
        <div className="ml-auto">
          <PrimaryButton
            type="button"
            onClick={() => setDeclarando(true)}
            className="!h-10 !w-auto !px-4 !text-[13.5px]"
          >
            <Plus className="h-4 w-4" /> Declarar
          </PrimaryButton>
        </div>
      </div>

      {filas.length === 0 ? (
        <p className="rounded-2xl border border-slate-200 bg-white px-5 py-6 text-[14px] text-slate-500">
          {abiertas === "si"
            ? "No hay nada abierto. Es la respuesta que se quiere ver."
            : "No hay ninguna incidencia con esos filtros."}
        </p>
      ) : (
        <ul className="space-y-2">
          {filas.map((i) => (
            <li
              key={i.id}
              className="rounded-2xl border border-slate-200 bg-white px-4 py-3"
            >
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <span
                  className={`rounded-md px-2 py-0.5 text-[12.5px] font-semibold tabular-nums ${colorDelNivel(i.nivel)}`}
                >
                  {i.nivel}
                </span>
                <Link
                  to={`/admin/residencia/incidencias/${i.id}`}
                  className="text-[15px] font-semibold text-mipiace-ink hover:underline"
                >
                  {i.nombreDelTipo}
                </Link>
                <span className="text-[13px] text-slate-500">
                  {nombreDelSujeto(i.sujeto)}
                  {i.residente ? ` · ${i.residente.nombre}` : ""}
                  {i.habitacion ? ` · hab. ${i.habitacion}` : ""}
                </span>
                {!i.abierta && (
                  <span className="rounded-md bg-emerald-50 px-2 py-0.5 text-[12.5px] text-emerald-800">
                    cerrada{i.autocierre ? " · autocierre" : ""}
                  </span>
                )}
                {/* El autocierre se MARCA (D-28) y se pinta: es lo que
                    distingue «la cerró dirección» de «la cerró quien la
                    abrió porque no había nadie más». */}
                <span className="ml-auto text-[13px] tabular-nums text-slate-400">
                  {fechaYHora(i.abiertaEn)}
                </span>
              </div>
              <p className="mt-1 text-[13px] text-slate-500">
                {nombreDelOrigen(i.origen)} · la abrió {i.abiertaPor} (
                {i.abiertaComo})
                {i.acciones > 0 ? ` · ${i.acciones} acción(es)` : ""}
              </p>
              {i.avisos.length > 0 && (
                <p className="mt-1 text-[13px]">
                  {i.avisos.map((a) => (
                    <span key={a.canal} className="mr-3">
                      {nombreDelCanal(a.canal)}:{" "}
                      {a.acusadoPor ? (
                        <span className="text-emerald-700">
                          lo cogió {a.acusadoPor}
                        </span>
                      ) : (
                        <span className="text-amber-700">
                          sin acusar ({a.estado.toLowerCase()})
                        </span>
                      )}
                    </span>
                  ))}
                </p>
              )}
              {/* La constancia de familia que falta, dicha en la LISTA y
                  no sólo al intentar cerrar: así dirección ve de un
                  vistazo cuál no se va a poder cerrar esta mañana. */}
              {i.abierta &&
                i.sujeto === "RESIDENT" &&
                i.constanciasDeFamilia === 0 && (
                  <p className="mt-1 text-[13px] text-amber-700">
                    Falta la constancia de familia: no se puede cerrar hasta
                    que se diga si se comunicó o por qué no.
                  </p>
                )}
            </li>
          ))}
        </ul>
      )}

      {declarando && (
        <DeclararModal
          capacidades={capacidades}
          onCerrar={() => setDeclarando(false)}
          onHecho={() => {
            setDeclarando(false);
            void recargar();
          }}
        />
      )}
    </AdminShell>
  );
}

/**
 * Declarar desde el despacho: una queja o una avería.
 *
 * Lo del residente no está aquí a propósito —se declara en la puerta, que
 * es donde está quien lo ve— salvo que haga falta añadirlo después, y
 * para eso está «añadir acción» en la ficha de la que ya exista.
 */
function DeclararModal({
  capacidades,
  onCerrar,
  onHecho,
}: {
  capacidades: Capacidad[];
  onCerrar: () => void;
  onHecho: () => void;
}) {
  const [elegido, setElegido] = useState(DECLARABLES[0]!);
  const [matiz, setMatiz] = useState<string | null>(null);
  const [descripcion, setDescripcion] = useState("");
  const [capacidad, setCapacidad] = useState(
    capacidades[0]?.assignmentId ?? "",
  );
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  async function declarar() {
    setGuardando(true);
    setError(null);
    try {
      await api("/residencia/incidencias", {
        method: "POST",
        body: {
          sujeto: elegido.sujeto,
          evento: elegido.evento,
          matiz,
          descripcion: descripcion.trim() || null,
          careRoleAssignmentId: capacidad || undefined,
        },
      });
      onHecho();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Error inesperado");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 p-4">
      <div className="w-full max-w-lg rounded-2xl bg-white p-6">
        <h2 className="text-[17px] font-semibold text-mipiace-ink">
          Declarar una incidencia
        </h2>
        <div className="mt-4 space-y-4">
          <div className="flex flex-wrap gap-2">
            {DECLARABLES.map((d) => (
              <button
                key={d.evento}
                type="button"
                onClick={() => {
                  setElegido(d);
                  setMatiz(null);
                }}
                className={`h-10 rounded-lg px-4 text-[13.5px] ${
                  elegido.evento === d.evento
                    ? "bg-mipiace-ink text-white"
                    : "border border-slate-300 text-slate-700"
                }`}
              >
                {d.etiqueta}
              </button>
            ))}
          </div>

          {elegido.pregunta && (
            <div>
              <p className="text-[13.5px] font-medium text-slate-700">
                {elegido.pregunta.texto}
              </p>
              <div className="mt-2 flex gap-2">
                {elegido.pregunta.opciones.map((o) => (
                  <button
                    key={o.matiz}
                    type="button"
                    onClick={() => setMatiz(o.matiz)}
                    className={`h-10 rounded-lg px-6 text-[13.5px] ${
                      matiz === o.matiz
                        ? "bg-mipiace-coral text-white"
                        : "border border-slate-300 text-slate-700"
                    }`}
                  >
                    {o.etiqueta}
                  </button>
                ))}
              </div>
            </div>
          )}

          <TextField
            id="declarar-descripcion"
            label="Qué ha pasado"
            value={descripcion}
            onChange={setDescripcion}
            placeholder="el asidero del baño de la 112 está suelto"
          />

          {capacidades.length > 1 && (
            <label className="block text-[13.5px]">
              <span className="text-slate-600">Firmas como</span>
              <select
                value={capacidad}
                onChange={(e) => setCapacidad(e.target.value)}
                className="mt-1 h-10 w-full rounded-lg border border-slate-300 px-3"
              >
                {capacidades.map((c) => (
                  <option key={c.assignmentId} value={c.assignmentId}>
                    {c.code}
                  </option>
                ))}
              </select>
            </label>
          )}

          {error && <FieldError message={error} />}
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <OutlineButton
            type="button"
            onClick={onCerrar}
            className="!h-10 !w-auto !px-4 !text-[13.5px]"
          >
            Cancelar
          </OutlineButton>
          <PrimaryButton
            type="button"
            disabled={guardando}
            onClick={() => void declarar()}
            className="!h-10 !w-auto !px-4 !text-[13.5px]"
          >
            Declarar
          </PrimaryButton>
        </div>
      </div>
    </div>
  );
}
