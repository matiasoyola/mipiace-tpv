// calidad-1 (D-70, D-71, D-76) · **UN PROCESO ABIERTO, CON TODO LO QUE
// LE CUELGA.**
//
// Indicadores, riesgos y oportunidades, objetivos de calidad y no
// conformidades. Es la pantalla que la directora abre en la auditoría
// cuando el auditor pregunta «¿y de qué proceso cuelga esto?».
//
// ── LOS OBJETIVOS CABEN AQUÍ, Y POR ESO ENTRAN EN EL BLOQUE ─────────
//
// El prompt los dejaba condicionados: «entran sólo si caben sin pantalla
// nueva colgando del proceso». Caben: son una sección más de esta ficha,
// con la misma forma que los riesgos. El seguimiento anual con su
// borrador de revisión por la dirección sigue siendo calidad-2.
//
// ── DESACTIVAR OBLIGA A REASIGNAR, Y LA PANTALLA LO DICE ANTES ──────
//
// El servidor contesta 409 con la lista de lo que cuelga. La pantalla la
// pinta y ofrece el desplegable para moverlo de golpe: un error que
// sólo dice «no puedes» obliga a la dirección a adivinar qué le sobra.

import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { AdminShell } from "../../AdminShell.js";
import { api, ApiError } from "../../api.js";
import {
  CenteredLoader,
  FieldError,
  OutlineButton,
  PrimaryButton,
  SuccessBanner,
} from "../../ui.js";
import { dia } from "./relevo-lib.js";
import {
  FILAS_DEL_MAPA,
  NOMBRE_DEL_TIPO,
  NOMBRE_DE_LA_BANDA,
  NOMBRE_DE_LA_CLASE_NC,
  NOMBRE_DEL_ESTADO,
  colorDeLaBanda,
  colorDeLaClase,
  type RespuestaDelMapa,
  type RespuestaDelProceso,
  type RolDeCuidado,
  type TipoDeProceso,
} from "./calidad-lib.js";

export function ProcesoPage() {
  const { id = "" } = useParams();
  const [datos, setDatos] = useState<RespuestaDelProceso | null>(null);
  const [mapa, setMapa] = useState<RespuestaDelMapa | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [editando, setEditando] = useState(false);
  const [nuevoRiesgo, setNuevoRiesgo] = useState(false);
  const [nuevoObjetivo, setNuevoObjetivo] = useState(false);
  const [cuelga, setCuelga] = useState<Record<string, number> | null>(null);
  const [destino, setDestino] = useState("");

  const recargar = useCallback(async () => {
    try {
      const [p, m] = await Promise.all([
        api<RespuestaDelProceso>(`/residencia/procesos/${id}`),
        api<RespuestaDelMapa>("/residencia/procesos"),
      ]);
      setDatos(p);
      setMapa(m);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Error inesperado");
    }
  }, [id]);

  useEffect(() => {
    void recargar();
  }, [recargar]);

  async function desactivar(): Promise<void> {
    try {
      await api(`/residencia/procesos/${id}/desactivar`, { method: "POST" });
      setAviso("Proceso desactivado.");
      setCuelga(null);
      await recargar();
    } catch (err) {
      if (err instanceof ApiError && err.code === "PROCESO_CON_COSAS_COLGANDO") {
        // El servidor manda la cuenta de lo que cuelga; la pantalla la
        // enseña y ofrece moverlo, en vez de dejar a la dirección
        // adivinando qué sobra.
        const cuerpo = err.detail as { cuelga?: Record<string, number> } | undefined;
        setCuelga(cuerpo?.cuelga ?? {});
        setError(err.message);
        return;
      }
      setError(err instanceof ApiError ? err.message : "Error inesperado");
    }
  }

  async function reasignar(): Promise<void> {
    if (destino === "") return;
    try {
      await api(`/residencia/procesos/${id}/reasignar`, {
        method: "POST",
        body: { aProcesoId: destino },
      });
      setAviso("Movido. Ahora el proceso se puede desactivar.");
      setCuelga(null);
      setError(null);
      await recargar();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Error inesperado");
    }
  }

  if (!datos || !mapa) {
    return error ? (
      <AdminShell title="Proceso">
        <FieldError message={error} />
      </AdminShell>
    ) : (
      <CenteredLoader label="Abriendo el proceso…" />
    );
  }

  const p = datos.proceso;
  const otros = mapa.procesos.filter((o) => o.id !== id && o.activo);

  return (
    <AdminShell title={p.nombre}>
      <p className="-mt-2 mb-1 text-[13px] text-slate-500">
        <Link to="/admin/residencia/procesos" className="underline">
          Mapa de procesos
        </Link>{" "}
        · {NOMBRE_DEL_TIPO[p.tipo]} · responsable: {p.responsable.name}
        {p.deReferencia && " · del mapa de referencia"}
        {!p.activo && " · DESACTIVADO"}
      </p>
      {p.proposito && (
        <p className="mb-4 text-[13.5px] text-slate-600">{p.proposito}</p>
      )}

      {error && <FieldError message={error} />}
      {aviso && <SuccessBanner message={aviso} />}

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <OutlineButton
          type="button"
          onClick={() => setEditando((v) => !v)}
          className="!h-10 !w-auto !px-4 !text-[13px]"
        >
          {editando ? "Cancelar" : "Editar el proceso"}
        </OutlineButton>
        {p.activo && (
          <button
            type="button"
            onClick={() => void desactivar()}
            className="text-[13px] text-slate-500 underline"
          >
            desactivar
          </button>
        )}
      </div>

      {cuelga != null && (
        <section className="mb-5 rounded-2xl border border-amber-300 bg-amber-50 px-5 py-4">
          <h2 className="text-[14px] font-semibold">
            Primero hay que reasignar lo que cuelga
          </h2>
          <p className="mt-1 text-[13px] text-slate-600">
            Si se desactivara con esto dentro, dejaría de verse en el mapa
            sin que nadie lo haya cerrado.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <select
              value={destino}
              onChange={(e) => setDestino(e.target.value)}
              className="h-10 rounded-xl border border-slate-300 px-3 text-[13.5px]"
            >
              <option value="">Mover todo a…</option>
              {otros.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.nombre}
                </option>
              ))}
            </select>
            <PrimaryButton
              type="button"
              onClick={() => void reasignar()}
              className="!h-10 !w-auto !px-4 !text-[13px]"
            >
              Mover
            </PrimaryButton>
          </div>
        </section>
      )}

      {editando && (
        <EditarProceso
          proceso={p}
          roles={mapa.roles}
          onHecho={async () => {
            setEditando(false);
            setAviso("Proceso guardado.");
            await recargar();
          }}
          onError={setError}
        />
      )}

      {/* ── Los indicadores que cuelgan ─────────────────────────── */}
      <Seccion titulo={`Indicadores (${datos.indicadores.length})`}>
        {datos.indicadores.length === 0 ? (
          <p className="text-[13px] text-slate-500">
            Ninguno cuelga de este proceso.
          </p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {datos.indicadores.map((c) => (
              <li
                key={c}
                className="rounded-md bg-slate-100 px-2 py-1 text-[12.5px] text-slate-700"
              >
                {c}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-[12.5px] text-slate-500">
          La fórmula de cada indicador es del producto; de qué proceso
          cuelga y con qué umbral se mide, del centro. Se cambian en{" "}
          <Link to="/admin/residencia/indicadores" className="underline">
            Indicadores
          </Link>
          .
        </p>
      </Seccion>

      {/* ── Riesgos y oportunidades ─────────────────────────────── */}
      <Seccion
        titulo={`Riesgos y oportunidades (${datos.riesgos.length})`}
        accion={
          <OutlineButton
            type="button"
            onClick={() => setNuevoRiesgo((v) => !v)}
            className="!h-9 !w-auto !px-4 !text-[13px]"
          >
            {nuevoRiesgo ? "Cancelar" : "Añadir"}
          </OutlineButton>
        }
      >
        {nuevoRiesgo && (
          <NuevoRiesgo
            processId={id}
            onHecho={async () => {
              setNuevoRiesgo(false);
              await recargar();
            }}
            onError={setError}
          />
        )}
        {datos.riesgos.length === 0 ? (
          <p className="text-[13px] text-slate-500">Ninguno todavía.</p>
        ) : (
          <ul className="space-y-2">
            {datos.riesgos.map((r) => (
              <li
                key={r.id}
                className={`rounded-xl border px-4 py-3 ${
                  r.vencida ? "border-red-300 bg-red-50" : "border-slate-200"
                }`}
              >
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span
                    className={`rounded-md px-2 py-0.5 text-[11px] ${colorDeLaBanda(r.banda)}`}
                  >
                    nivel {r.nivel} · {NOMBRE_DE_LA_BANDA[r.banda]}
                  </span>
                  <span className="text-[12px] text-slate-500">
                    {r.tipo === "RISK" ? "Riesgo" : "Oportunidad"} ·
                    probabilidad {r.probabilidad} × impacto {r.impacto}
                    {r.deSerie && " · de serie"}
                    {r.isoClause && ` · ISO ${r.isoClause}`}
                  </span>
                </div>
                <p className="mt-1 text-[13.5px]">{r.descripcion}</p>
                {r.accionPrevista && (
                  <p className="mt-1 text-[12.5px] text-slate-600">
                    Acción prevista: {r.accionPrevista}
                  </p>
                )}
                <p className="mt-1 text-[12.5px] text-slate-500">
                  Revisión: {dia(r.reviewAt)}
                  {r.vencida && " · VENCIDA"}
                  {r.revisadoEn &&
                    ` · última revisión ${dia(r.revisadoEn.slice(0, 10))}`}
                </p>
                <RevisarRiesgo
                  riesgoId={r.id}
                  onHecho={async () => {
                    setAviso("Riesgo revisado, con quién y cuándo.");
                    await recargar();
                  }}
                  onError={setError}
                />
              </li>
            ))}
          </ul>
        )}
      </Seccion>

      {/* ── Objetivos de calidad ────────────────────────────────── */}
      <Seccion
        titulo={`Objetivos de calidad (${datos.objetivos.length})`}
        accion={
          <OutlineButton
            type="button"
            onClick={() => setNuevoObjetivo((v) => !v)}
            className="!h-9 !w-auto !px-4 !text-[13px]"
          >
            {nuevoObjetivo ? "Cancelar" : "Añadir"}
          </OutlineButton>
        }
      >
        {nuevoObjetivo && (
          <NuevoObjetivo
            processId={id}
            onHecho={async () => {
              setNuevoObjetivo(false);
              await recargar();
            }}
            onError={setError}
          />
        )}
        {datos.objetivos.length === 0 ? (
          <p className="text-[13px] text-slate-500">Ninguno todavía.</p>
        ) : (
          <ul className="space-y-2">
            {datos.objetivos.map((o) => (
              <li key={o.id} className="rounded-xl border border-slate-200 px-4 py-3">
                <div className="flex flex-wrap items-baseline gap-x-3">
                  <span className="text-[12px] text-slate-500">{o.anio}</span>
                  <h3 className="text-[13.5px] font-semibold">{o.nombre}</h3>
                </div>
                <p className="mt-1 text-[13px] text-slate-600">{o.meta}</p>
                {o.indicatorCode && (
                  <p className="mt-1 text-[12.5px] text-slate-500">
                    Lo mide el indicador {o.indicatorCode}.
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </Seccion>

      {/* ── Las no conformidades ────────────────────────────────── */}
      <Seccion titulo={`No conformidades (${datos.noConformidades.length})`}>
        {datos.noConformidades.length === 0 ? (
          <p className="text-[13px] text-slate-500">Ninguna.</p>
        ) : (
          <ul className="space-y-1.5">
            {datos.noConformidades.map((n) => (
              <li key={n.id}>
                <Link
                  to={`/admin/residencia/no-conformidades/${n.id}`}
                  className="flex flex-wrap items-baseline gap-x-3 rounded-xl border border-slate-200 px-4 py-2 hover:border-slate-400"
                >
                  <span className="font-mono text-[12.5px]">{n.referencia}</span>
                  <span
                    className={`rounded-md px-2 py-0.5 text-[11px] ${colorDeLaClase(n.clase)}`}
                  >
                    {NOMBRE_DE_LA_CLASE_NC[n.clase]}
                  </span>
                  <span className="text-[12px] text-slate-500">
                    {NOMBRE_DEL_ESTADO[n.estado]} · {dia(n.detectedOn)}
                  </span>
                  <span className="basis-full text-[13px] text-slate-700">
                    {n.descripcion}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Seccion>
    </AdminShell>
  );
}

function Seccion({
  titulo,
  accion,
  children,
}: {
  titulo: string;
  accion?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-5 rounded-2xl border border-slate-200 bg-white px-5 py-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-[14.5px] font-semibold">{titulo}</h2>
        {accion}
      </div>
      {children}
    </section>
  );
}

function EditarProceso({
  proceso,
  roles,
  onHecho,
  onError,
}: {
  proceso: RespuestaDelProceso["proceso"];
  roles: RolDeCuidado[];
  onHecho: () => Promise<void>;
  onError: (m: string) => void;
}) {
  const [name, setName] = useState(proceso.nombre);
  const [tipo, setTipo] = useState<TipoDeProceso>(proceso.tipo);
  const [purpose, setPurpose] = useState(proceso.proposito ?? "");
  const [rolId, setRolId] = useState(proceso.responsable.id);

  async function guardar(): Promise<void> {
    try {
      await api(`/residencia/procesos/${proceso.id}`, {
        method: "PUT",
        body: {
          name: name.trim(),
          type: tipo,
          purpose: purpose.trim() === "" ? null : purpose.trim(),
          responsibleCareRoleId: rolId,
        },
      });
      await onHecho();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "Error inesperado");
    }
  }

  return (
    <section className="mb-5 rounded-2xl border border-slate-200 bg-white px-5 py-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-[13px]">
          Nombre
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 block h-10 w-full rounded-xl border border-slate-300 px-3 text-[13.5px]"
          />
        </label>
        <label className="block text-[13px]">
          Tipo
          <select
            value={tipo}
            onChange={(e) => setTipo(e.target.value as TipoDeProceso)}
            className="mt-1 block h-10 w-full rounded-xl border border-slate-300 px-3 text-[13.5px]"
          >
            {FILAS_DEL_MAPA.map((t) => (
              <option key={t} value={t}>
                {NOMBRE_DEL_TIPO[t]}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-[13px]">
          Responsable
          <select
            value={rolId}
            onChange={(e) => setRolId(e.target.value)}
            className="mt-1 block h-10 w-full rounded-xl border border-slate-300 px-3 text-[13.5px]"
          >
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.nombre}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-[13px]">
          Qué hace
          <input
            value={purpose}
            onChange={(e) => setPurpose(e.target.value)}
            className="mt-1 block h-10 w-full rounded-xl border border-slate-300 px-3 text-[13.5px]"
          />
        </label>
      </div>
      {/* El nombre se puede cambiar; el CÓDIGO no, y es lo que ata lo que
          ya cuelga de este proceso. */}
      <p className="mt-2 text-[12px] text-slate-500">
        El código del proceso ({proceso.code}) no cambia al renombrarlo:
        es lo que ata los indicadores y los riesgos que ya le cuelgan.
      </p>
      <PrimaryButton
        type="button"
        onClick={() => void guardar()}
        className="mt-3 !h-10 !w-auto !px-5 !text-[13px]"
      >
        Guardar
      </PrimaryButton>
    </section>
  );
}

function NuevoRiesgo({
  processId,
  onHecho,
  onError,
}: {
  processId: string;
  onHecho: () => Promise<void>;
  onError: (m: string) => void;
}) {
  const [kind, setKind] = useState<"RISK" | "OPPORTUNITY">("RISK");
  const [description, setDescription] = useState("");
  const [probability, setProbability] = useState(2);
  const [impact, setImpact] = useState(2);
  const [plannedAction, setPlannedAction] = useState("");
  const [reviewAt, setReviewAt] = useState(() =>
    new Date(Date.now() + 182 * 86_400_000).toISOString().slice(0, 10),
  );
  const [isoClause, setIsoClause] = useState("6.1");

  async function guardar(): Promise<void> {
    if (description.trim() === "") {
      onError("Un riesgo necesita una descripción.");
      return;
    }
    try {
      await api("/residencia/riesgos", {
        method: "POST",
        body: {
          processId,
          kind,
          description: description.trim(),
          probability,
          impact,
          plannedAction: plannedAction.trim() === "" ? null : plannedAction.trim(),
          reviewAt,
          isoClause: isoClause.trim() === "" ? null : isoClause.trim(),
        },
      });
      await onHecho();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "Error inesperado");
    }
  }

  return (
    <div className="mb-4 rounded-xl border border-slate-300 bg-slate-50 px-4 py-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-[13px]">
          Tipo
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as "RISK" | "OPPORTUNITY")}
            className="mt-1 block h-10 w-full rounded-xl border border-slate-300 px-3 text-[13.5px]"
          >
            <option value="RISK">Riesgo</option>
            <option value="OPPORTUNITY">Oportunidad</option>
          </select>
        </label>
        <label className="block text-[13px]">
          Fecha de revisión
          <input
            type="date"
            value={reviewAt}
            onChange={(e) => setReviewAt(e.target.value)}
            className="mt-1 block h-10 w-full rounded-xl border border-slate-300 px-3 text-[13.5px]"
          />
        </label>
        <label className="block text-[13px] sm:col-span-2">
          Descripción
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            className="mt-1 block w-full rounded-xl border border-slate-300 px-3 py-2 text-[13.5px]"
          />
        </label>
        <label className="block text-[13px]">
          Probabilidad (1-3)
          <select
            value={probability}
            onChange={(e) => setProbability(Number(e.target.value))}
            className="mt-1 block h-10 w-full rounded-xl border border-slate-300 px-3 text-[13.5px]"
          >
            {[1, 2, 3].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-[13px]">
          Impacto (1-3)
          <select
            value={impact}
            onChange={(e) => setImpact(Number(e.target.value))}
            className="mt-1 block h-10 w-full rounded-xl border border-slate-300 px-3 text-[13.5px]"
          >
            {[1, 2, 3].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-[13px] sm:col-span-2">
          Acción prevista
          <input
            value={plannedAction}
            onChange={(e) => setPlannedAction(e.target.value)}
            className="mt-1 block h-10 w-full rounded-xl border border-slate-300 px-3 text-[13.5px]"
          />
        </label>
        <label className="block text-[13px]">
          Cláusula ISO
          <input
            value={isoClause}
            onChange={(e) => setIsoClause(e.target.value)}
            className="mt-1 block h-10 w-full rounded-xl border border-slate-300 px-3 text-[13.5px]"
          />
        </label>
      </div>
      <p className="mt-2 text-[12px] text-slate-500">
        El nivel sale de multiplicar: {probability} × {impact} ={" "}
        {probability * impact}. Las bandas (bajo 1-2, medio 3-4, alto 6-9)
        son del producto.
      </p>
      <PrimaryButton
        type="button"
        onClick={() => void guardar()}
        className="mt-3 !h-10 !w-auto !px-5 !text-[13px]"
      >
        Añadir
      </PrimaryButton>
    </div>
  );
}

/** «Revisado» es firmar, no mover una fecha: va con quién y cuándo. */
function RevisarRiesgo({
  riesgoId,
  onHecho,
  onError,
}: {
  riesgoId: string;
  onHecho: () => Promise<void>;
  onError: (m: string) => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const [proxima, setProxima] = useState(() =>
    new Date(Date.now() + 182 * 86_400_000).toISOString().slice(0, 10),
  );

  if (!abierto) {
    return (
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="mt-2 block text-[12.5px] text-slate-500 underline"
      >
        marcar como revisado
      </button>
    );
  }
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <span className="text-[12.5px] text-slate-600">Próxima revisión</span>
      <input
        type="date"
        value={proxima}
        onChange={(e) => setProxima(e.target.value)}
        className="h-9 rounded-xl border border-slate-300 px-2 text-[13px]"
      />
      <PrimaryButton
        type="button"
        onClick={async () => {
          try {
            await api(`/residencia/riesgos/${riesgoId}/revisar`, {
              method: "POST",
              body: { proximaRevision: proxima },
            });
            setAbierto(false);
            await onHecho();
          } catch (err) {
            onError(err instanceof ApiError ? err.message : "Error inesperado");
          }
        }}
        className="!h-9 !w-auto !px-4 !text-[13px]"
      >
        Revisado
      </PrimaryButton>
    </div>
  );
}

function NuevoObjetivo({
  processId,
  onHecho,
  onError,
}: {
  processId: string;
  onHecho: () => Promise<void>;
  onError: (m: string) => void;
}) {
  const [year, setYear] = useState(new Date().getFullYear());
  const [name, setName] = useState("");
  const [target, setTarget] = useState("");

  async function guardar(): Promise<void> {
    if (name.trim() === "" || target.trim() === "") {
      onError("Un objetivo necesita nombre y meta.");
      return;
    }
    try {
      await api("/residencia/objetivos", {
        method: "POST",
        body: { processId, year, name: name.trim(), target: target.trim() },
      });
      await onHecho();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "Error inesperado");
    }
  }

  return (
    <div className="mb-4 rounded-xl border border-slate-300 bg-slate-50 px-4 py-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-[13px]">
          Año
          <input
            type="number"
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            className="mt-1 block h-10 w-full rounded-xl border border-slate-300 px-3 text-[13.5px]"
          />
        </label>
        <label className="block text-[13px]">
          Objetivo
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 block h-10 w-full rounded-xl border border-slate-300 px-3 text-[13.5px]"
          />
        </label>
        <label className="block text-[13px] sm:col-span-2">
          Meta
          <input
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            className="mt-1 block h-10 w-full rounded-xl border border-slate-300 px-3 text-[13.5px]"
          />
        </label>
      </div>
      <PrimaryButton
        type="button"
        onClick={() => void guardar()}
        className="mt-3 !h-10 !w-auto !px-5 !text-[13px]"
      >
        Añadir
      </PrimaryButton>
    </div>
  );
}
