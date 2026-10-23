// calidad-1 (D-73, D-75, D-76) · **EL REGISTRO DE NO CONFORMIDADES.**
//
// La lista filtrable, el botón de abrir una y los dos PDF: el PAC que se
// le manda a la certificadora y el informe de no conformidades del
// periodo, que es el que se lee dentro.
//
// ── EL FILTRO Y EL PDF SON LA MISMA PREGUNTA ────────────────────────
//
// Los dos botones de descarga **arrastran el filtro de la pantalla**.
// Es deliberado: «el PAC de la auditoría externa de julio» se arma
// filtrando en pantalla y pulsando, no rellenando un segundo formulario
// que puede decir otra cosa que lo que se está viendo. Y el filtro va
// impreso en el papel, así que lo que se descarga se puede contrastar
// con lo que había delante.

import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { AdminShell } from "../../AdminShell.js";
import { api, apiBlob, ApiError } from "../../api.js";
import {
  CenteredLoader,
  FieldError,
  OutlineButton,
  PrimaryButton,
  SuccessBanner,
} from "../../ui.js";
import { dia } from "./relevo-lib.js";
import {
  NOMBRE_DEL_ESTADO,
  NOMBRE_DEL_ORIGEN,
  NOMBRE_DE_LA_CLASE_NC,
  PASOS_DEL_CICLO,
  colorDeLaClase,
  type ClaseDeNc,
  type NcDeLaLista,
  type OrigenDeNc,
  type RespuestaDelMapa,
} from "./calidad-lib.js";

const CLASES: ClaseDeNc[] = ["MAJOR", "MINOR", "OBSERVATION", "IMPROVEMENT"];
const ORIGENES: OrigenDeNc[] = [
  "INTERNAL_AUDIT",
  "EXTERNAL_AUDIT",
  "INSPECTION",
  "INCIDENT",
  "COMPLAINT",
  "INDICATOR",
  "MANAGEMENT_REVIEW",
  "OTHER",
];

export function NoConformidadesPage() {
  // calidad-1 (D-74) · **LA PROPUESTA LLEGA POR LA URL.** El panel
  // enlaza con `?proponer=<indicador>&mes=<YYYY-MM>` y aquí se abre el
  // formulario con el origen, el proceso y la referencia ya puestos. Si
  // hubiera que volver a teclearlos, la propuesta no ahorraría nada y
  // nadie la usaría — y una propuesta que nadie usa es peor que no
  // tenerla.
  const [busqueda] = useSearchParams();
  const proponer = busqueda.get("proponer");
  const mesPropuesto = busqueda.get("mes");
  const procesoPropuesto = busqueda.get("proceso");

  const [filas, setFilas] = useState<NcDeLaLista[] | null>(null);
  const [mapa, setMapa] = useState<RespuestaDelMapa | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [abriendo, setAbriendo] = useState(proponer != null);

  const [estado, setEstado] = useState("");
  const [clase, setClase] = useState("");
  const [origen, setOrigen] = useState("");
  const [procesoId, setProcesoId] = useState("");
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");

  const consulta = useCallback((): string => {
    const q = new URLSearchParams();
    if (estado) q.set("estado", estado);
    if (clase) q.set("clase", clase);
    if (origen) q.set("origen", origen);
    if (procesoId) q.set("procesoId", procesoId);
    if (desde) q.set("desde", desde);
    if (hasta) q.set("hasta", hasta);
    return q.toString();
  }, [estado, clase, origen, procesoId, desde, hasta]);

  const recargar = useCallback(async () => {
    try {
      const [l, m] = await Promise.all([
        api<{ noConformidades: NcDeLaLista[] }>(
          `/residencia/no-conformidades?${consulta()}`,
        ),
        api<RespuestaDelMapa>("/residencia/procesos"),
      ]);
      setFilas(l.noConformidades);
      setMapa(m);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Error inesperado");
    }
  }, [consulta]);

  useEffect(() => {
    void recargar();
  }, [recargar]);

  /** Abre el PDF en otra pestaña, como el contrato de encargado. Se abre
   *  en vez de descargarse porque lo primero que hace quien lo pide es
   *  mirarlo. */
  async function abrirPdf(cola: string): Promise<void> {
    try {
      const blob = await apiBlob(`/residencia/calidad/${cola}`);
      window.open(URL.createObjectURL(blob), "_blank", "noopener,noreferrer");
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "No se ha podido generar el PDF. Reintenta más tarde.",
      );
    }
  }

  if (filas == null || mapa == null) {
    return error ? (
      <AdminShell title="No conformidades">
        <FieldError message={error} />
      </AdminShell>
    ) : (
      <CenteredLoader label="Cargando el registro…" />
    );
  }

  const sinMapa = mapa.procesos.length === 0;

  return (
    <AdminShell title="No conformidades">
      <p className="-mt-2 mb-4 text-[13.5px] text-slate-500">
        Cada hallazgo con su clase, su origen y su proceso, y el ciclo
        entero hasta la <strong>verificación de eficacia</strong>. De
        aquí sale el PAC que se le manda a la certificadora.
      </p>

      {error && <FieldError message={error} />}
      {aviso && <SuccessBanner message={aviso} />}

      {sinMapa ? (
        <section className="rounded-2xl border border-slate-200 bg-white px-6 py-6 text-center">
          <p className="text-[13.5px] text-slate-600">
            Una no conformidad cuelga siempre de un proceso del mapa, y
            este centro todavía no tiene mapa.
          </p>
          <Link
            to="/admin/residencia/procesos"
            className="mt-3 inline-block text-[13.5px] underline"
          >
            Cargar el mapa de procesos
          </Link>
        </section>
      ) : (
        <>
          {/* ── Los filtros ───────────────────────────────────────── */}
          <section className="mb-4 flex flex-wrap items-end gap-2">
            <Filtro label="Estado" value={estado} onChange={setEstado}>
              <option value="">Todos</option>
              {PASOS_DEL_CICLO.map((e) => (
                <option key={e} value={e}>
                  {NOMBRE_DEL_ESTADO[e]}
                </option>
              ))}
            </Filtro>
            <Filtro label="Clase" value={clase} onChange={setClase}>
              <option value="">Todas</option>
              {CLASES.map((c) => (
                <option key={c} value={c}>
                  {NOMBRE_DE_LA_CLASE_NC[c]}
                </option>
              ))}
            </Filtro>
            <Filtro label="Origen" value={origen} onChange={setOrigen}>
              <option value="">Todos</option>
              {ORIGENES.map((o) => (
                <option key={o} value={o}>
                  {NOMBRE_DEL_ORIGEN[o]}
                </option>
              ))}
            </Filtro>
            <Filtro label="Proceso" value={procesoId} onChange={setProcesoId}>
              <option value="">Todos</option>
              {mapa.procesos.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre}
                </option>
              ))}
            </Filtro>
            <label className="block text-[12.5px] text-slate-600">
              Desde
              <input
                type="date"
                value={desde}
                onChange={(e) => setDesde(e.target.value)}
                className="mt-1 block h-10 rounded-xl border border-slate-300 px-2 text-[13px]"
              />
            </label>
            <label className="block text-[12.5px] text-slate-600">
              Hasta
              <input
                type="date"
                value={hasta}
                onChange={(e) => setHasta(e.target.value)}
                className="mt-1 block h-10 rounded-xl border border-slate-300 px-2 text-[13px]"
              />
            </label>
          </section>

          <div className="mb-4 flex flex-wrap items-center gap-3">
            <PrimaryButton
              type="button"
              onClick={() => setAbriendo((v) => !v)}
              className="!h-10 !w-auto !px-5 !text-[13px]"
            >
              {abriendo ? "Cancelar" : "Abrir una no conformidad"}
            </PrimaryButton>
            {/* Los dos PDF arrastran el filtro de arriba. */}
            <OutlineButton
              type="button"
              onClick={() => void abrirPdf(`pac.pdf?${consulta()}`)}
              className="!h-10 !w-auto !px-4 !text-[13px]"
            >
              PAC en PDF
            </OutlineButton>
            <OutlineButton
              type="button"
              onClick={() => void abrirPdf(`informe-nc.pdf?${consulta()}`)}
              className="!h-10 !w-auto !px-4 !text-[13px]"
            >
              Informe del periodo
            </OutlineButton>
          </div>

          {abriendo && (
            <AbrirNc
              procesos={mapa.procesos.filter((p) => p.activo)}
              propuesta={
                proponer != null && mesPropuesto != null
                  ? {
                      code: proponer,
                      mes: mesPropuesto,
                      procesoId: procesoPropuesto,
                    }
                  : null
              }
              onHecho={async (ref) => {
                setAbriendo(false);
                setAviso(`Abierta ${ref}.`);
                setTimeout(() => setAviso(null), 5000);
                await recargar();
              }}
              onError={setError}
            />
          )}

          {filas.length === 0 ? (
            <p className="text-[13.5px] text-slate-500">
              Ninguna no conformidad con este filtro.
            </p>
          ) : (
            <ul className="space-y-2">
              {filas.map((n) => (
                <li key={n.id}>
                  <Link
                    to={`/admin/residencia/no-conformidades/${n.id}`}
                    className={`block rounded-2xl border px-5 py-3 hover:border-slate-400 ${
                      n.accionesVencidas > 0
                        ? "border-red-300 bg-red-50"
                        : "border-slate-200 bg-white"
                    }`}
                  >
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                      <span className="font-mono text-[13px] font-semibold">
                        {n.referencia}
                      </span>
                      <span
                        className={`rounded-md px-2 py-0.5 text-[11px] ${colorDeLaClase(n.clase)}`}
                      >
                        {NOMBRE_DE_LA_CLASE_NC[n.clase]}
                      </span>
                      <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] text-slate-700">
                        {NOMBRE_DEL_ESTADO[n.estado]}
                      </span>
                      <span className="text-[12.5px] text-slate-500">
                        {NOMBRE_DEL_ORIGEN[n.origen]} · {dia(n.detectedOn)} ·{" "}
                        {n.proceso.name}
                        {n.isoClause && ` · ISO ${n.isoClause}`}
                      </span>
                    </div>
                    <p className="mt-1 text-[13.5px] text-slate-700">
                      {n.descripcion}
                    </p>
                    <p className="mt-1 text-[12.5px] text-slate-500">
                      {n.acciones} acción(es) · {n.verificaciones}{" "}
                      verificación(es)
                      {n.accionesVencidas > 0 && (
                        <strong className="text-red-700">
                          {" "}
                          · {n.accionesVencidas} vencida(s)
                        </strong>
                      )}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </AdminShell>
  );
}

function Filtro({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
}) {
  return (
    <label className="block text-[12.5px] text-slate-600">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 block h-10 rounded-xl border border-slate-300 px-2 text-[13px]"
      >
        {children}
      </select>
    </label>
  );
}

/** El alta. La clase y el origen **no se cambian después** (D-73), y por
 *  eso la pantalla lo dice aquí y no cuando ya es tarde. */
function AbrirNc({
  procesos,
  propuesta,
  onHecho,
  onError,
}: {
  procesos: Array<{ id: string; nombre: string }>;
  /** calidad-1 (D-74) · el indicador, el mes y el proceso del que cuelga,
   *  que vienen del panel. */
  propuesta: { code: string; mes: string; procesoId: string | null } | null;
  onHecho: (ref: string) => Promise<void>;
  onError: (m: string) => void;
}) {
  const [processId, setProcessId] = useState(
    // El proceso del que cuelga el indicador, si el panel lo mandó: es
    // el que el centro eligió para ese indicador, así que proponer otro
    // sería proponer mal.
    propuesta?.procesoId ?? procesos[0]?.id ?? "",
  );
  const [kind, setKind] = useState<ClaseDeNc>("MINOR");
  const [origin, setOrigin] = useState<OrigenDeNc>(
    propuesta != null ? "INDICATOR" : "INTERNAL_AUDIT",
  );
  const [detectedOn, setDetectedOn] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [descripcion, setDescripcion] = useState("");
  const [isoClause, setIsoClause] = useState(propuesta != null ? "9.1.3" : "");
  const [sourceNote, setSourceNote] = useState("");

  const pideIncidencia = origin === "INCIDENT" || origin === "COMPLAINT";

  async function guardar(): Promise<void> {
    if (descripcion.trim() === "") {
      onError("Una no conformidad necesita decir qué pasa.");
      return;
    }
    if (pideIncidencia) {
      onError(
        "Para elevar una incidencia del libro a no conformidad se usa el botón «elevar a NC» de la ficha de la incidencia: así se conserva el enlace en los dos sentidos.",
      );
      return;
    }
    try {
      const r = await api<{ noConformidad: { reference: string } }>(
        "/residencia/no-conformidades",
        {
          method: "POST",
          body: {
            processId,
            kind,
            origin,
            detectedOn,
            descripcion: descripcion.trim(),
            isoClause: isoClause.trim() === "" ? null : isoClause.trim(),
            sourceNote: sourceNote.trim() === "" ? null : sourceNote.trim(),
            // El indicador y el mes de la propuesta: es lo que después
            // deja volver a mirar de qué hablaba la no conformidad.
            ...(origin === "INDICATOR" && propuesta != null
              ? {
                  sourceIndicatorCode: propuesta.code,
                  sourceIndicatorMonth: propuesta.mes,
                }
              : {}),
          },
        },
      );
      await onHecho(r.noConformidad.reference);
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "Error inesperado");
    }
  }

  return (
    <section className="mb-5 rounded-2xl border border-slate-300 bg-slate-50 px-5 py-4">
      <h2 className="text-[14.5px] font-semibold">Abrir una no conformidad</h2>
      {propuesta != null && (
        <p className="mt-1 rounded-lg bg-amber-100 px-3 py-2 text-[12.5px] text-amber-900">
          Viene del panel: el indicador <strong>{propuesta.code}</strong>{" "}
          lleva dos meses seguidos fuera de umbral, el último{" "}
          {propuesta.mes}. El origen y la referencia ya van puestos; lo que
          falta es decidir la clase y escribir qué pasa.
        </p>
      )}
      <p className="mt-1 text-[12.5px] text-slate-500">
        La clase, el origen y quién la abre <strong>no se cambian después</strong>:
        subir una NC menor a mayor cuando ya está cerrada sería reescribir
        lo que el auditor dijo.
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="block text-[13px]">
          Proceso
          <select
            value={processId}
            onChange={(e) => setProcessId(e.target.value)}
            className="mt-1 block h-10 w-full rounded-xl border border-slate-300 px-3 text-[13.5px]"
          >
            {procesos.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nombre}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-[13px]">
          Clase
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as ClaseDeNc)}
            className="mt-1 block h-10 w-full rounded-xl border border-slate-300 px-3 text-[13.5px]"
          >
            {CLASES.map((c) => (
              <option key={c} value={c}>
                {NOMBRE_DE_LA_CLASE_NC[c]}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-[13px]">
          Origen
          <select
            value={origin}
            onChange={(e) => setOrigin(e.target.value as OrigenDeNc)}
            className="mt-1 block h-10 w-full rounded-xl border border-slate-300 px-3 text-[13.5px]"
          >
            {ORIGENES.map((o) => (
              <option key={o} value={o}>
                {NOMBRE_DEL_ORIGEN[o]}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-[13px]">
          Detectada el
          <input
            type="date"
            value={detectedOn}
            onChange={(e) => setDetectedOn(e.target.value)}
            className="mt-1 block h-10 w-full rounded-xl border border-slate-300 px-3 text-[13.5px]"
          />
        </label>
        <label className="block text-[13px] sm:col-span-2">
          Qué pasa
          <textarea
            value={descripcion}
            onChange={(e) => setDescripcion(e.target.value)}
            rows={3}
            className="mt-1 block w-full rounded-xl border border-slate-300 px-3 py-2 text-[13.5px]"
          />
        </label>
        <label className="block text-[13px]">
          Cláusula ISO 9001:2015
          <input
            value={isoClause}
            onChange={(e) => setIsoClause(e.target.value)}
            placeholder="4.4, 6.1, 9.1, 10.2…"
            className="mt-1 block h-10 w-full rounded-xl border border-slate-300 px-3 text-[13.5px]"
          />
        </label>
        <label className="block text-[13px]">
          Referencia del origen
          <input
            value={sourceNote}
            onChange={(e) => setSourceNote(e.target.value)}
            placeholder="AENOR · informe nº 24 · 21-07-2026"
            className="mt-1 block h-10 w-full rounded-xl border border-slate-300 px-3 text-[13.5px]"
          />
        </label>
      </div>
      {pideIncidencia && (
        <p className="mt-2 text-[12.5px] text-amber-800">
          Para una incidencia o una queja del libro, se eleva desde la
          ficha de la incidencia: así el enlace queda en los dos sentidos.
        </p>
      )}
      <PrimaryButton
        type="button"
        onClick={() => void guardar()}
        className="mt-3 !h-10 !w-auto !px-5 !text-[13px]"
      >
        Abrir
      </PrimaryButton>
    </section>
  );
}
