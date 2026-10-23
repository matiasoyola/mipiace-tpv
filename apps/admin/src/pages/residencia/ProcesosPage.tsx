// calidad-1 (D-70, D-76) · **EL MAPA DE PROCESOS.**
//
// La pantalla que cierra la NC 01 de AENOR. Tres filas —estratégicos,
// operativos, de soporte— y en cada tarjeta lo que cuelga de ese
// proceso: indicadores, riesgos, objetivos y no conformidades abiertas.
//
// ── POR QUÉ UN MAPA Y NO UNA LISTA ──────────────────────────────────
//
// Porque el día de la auditoría lo que la directora tiene que poder
// hacer es **enseñar el mapa**: «éstos son nuestros procesos, y de aquí
// cuelga todo». Una tabla ordenada alfabéticamente con once filas dice
// lo mismo y no se parece a un mapa de procesos de ISO 9001, que es lo
// que el auditor espera ver y lo que el centro ya tiene en la pared.
//
// ── Y LO QUE NO HAY EN ESTA PANTALLA ────────────────────────────────
//
// **Ningún sitio donde escribir un segundo mapa.** No hay «lista de
// procesos de indicadores» ni «lista de procesos de riesgos»: hay ésta.
// Eso no es una decisión de diseño de pantalla, es la decisión D-70
// llevada hasta el final — y es la diferencia entre cerrar la NC por
// construcción y cerrarla por disciplina.

import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";

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
  FILAS_DEL_MAPA,
  NOMBRE_DEL_TIPO,
  colorDeLaBanda,
  NOMBRE_DE_LA_BANDA,
  type ProcesoDelMapa,
  type RespuestaDelMapa,
  type RolDeCuidado,
  type TipoDeProceso,
} from "./calidad-lib.js";

export function ProcesosPage() {
  const [datos, setDatos] = useState<RespuestaDelMapa | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [anadiendo, setAnadiendo] = useState(false);
  const [verInactivos, setVerInactivos] = useState(false);

  const recargar = useCallback(async () => {
    try {
      setDatos(await api<RespuestaDelMapa>("/residencia/procesos"));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Error inesperado");
    }
  }, []);

  useEffect(() => {
    void recargar();
  }, [recargar]);

  async function cargarElDeReferencia(): Promise<void> {
    try {
      const r = await api<{
        procesosCreados: number;
        riesgosCreados: number;
        indicadoresColgados: number;
      }>("/residencia/procesos/cargar-mapa", { method: "POST" });
      setAviso(
        `Mapa cargado: ${r.procesosCreados} procesos, ${r.riesgosCreados} riesgos de serie y ${r.indicadoresColgados} indicadores colgados.`,
      );
      setTimeout(() => setAviso(null), 6000);
      await recargar();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Error inesperado");
    }
  }

  if (!datos) {
    return error ? (
      <AdminShell title="Mapa de procesos">
        <FieldError message={error} />
      </AdminShell>
    ) : (
      <CenteredLoader label="Cargando el mapa…" />
    );
  }

  const visibles = datos.procesos.filter((p) => verInactivos || p.activo);
  const inactivos = datos.procesos.filter((p) => !p.activo).length;

  return (
    <AdminShell title="Mapa de procesos">
      <p className="-mt-2 mb-5 text-[13.5px] text-slate-500">
        <strong>Un solo mapa por centro.</strong> Indicadores, riesgos,
        objetivos y no conformidades cuelgan de un proceso de aquí y de
        ningún otro sitio: no hay una segunda lista de procesos en el
        sistema.
      </p>

      {error && <FieldError message={error} />}
      {aviso && <SuccessBanner message={aviso} />}

      {datos.procesos.length === 0 ? (
        <section className="rounded-2xl border border-slate-200 bg-white px-6 py-7 text-center">
          <h2 className="text-[16px] font-semibold">
            Este centro todavía no tiene mapa de procesos
          </h2>
          <p className="mx-auto mt-2 max-w-xl text-[13.5px] text-slate-500">
            El producto trae un mapa de referencia para residencias: once
            procesos y los cuatro riesgos intrínsecos de una residencia ya
            colgados de su proceso. Cárgalo y adáptalo — renombra, añade
            los tuyos y desactiva los que no uses.
          </p>
          <PrimaryButton
            type="button"
            onClick={() => void cargarElDeReferencia()}
            className="mx-auto mt-5 !w-auto !px-6"
          >
            Cargar el mapa de referencia
          </PrimaryButton>
        </section>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <OutlineButton
              type="button"
              onClick={() => setAnadiendo((v) => !v)}
              className="!h-10 !w-auto !px-4 !text-[13px]"
            >
              {anadiendo ? "Cancelar" : "Añadir un proceso"}
            </OutlineButton>
            <OutlineButton
              type="button"
              onClick={() => void cargarElDeReferencia()}
              className="!h-10 !w-auto !px-4 !text-[13px]"
            >
              Completar con el de referencia
            </OutlineButton>
            {inactivos > 0 && (
              <button
                type="button"
                onClick={() => setVerInactivos((v) => !v)}
                className="text-[13px] text-slate-500 underline"
              >
                {verInactivos
                  ? "ocultar los desactivados"
                  : `ver los ${inactivos} desactivados`}
              </button>
            )}
          </div>

          {anadiendo && (
            <FormularioDeProceso
              roles={datos.roles}
              onHecho={async () => {
                setAnadiendo(false);
                await recargar();
              }}
              onError={setError}
            />
          )}

          {FILAS_DEL_MAPA.map((tipo) => (
            <FilaDelMapa
              key={tipo}
              tipo={tipo}
              procesos={visibles.filter((p) => p.tipo === tipo)}
            />
          ))}
        </>
      )}
    </AdminShell>
  );
}

/** Una de las tres bandas del mapa. */
function FilaDelMapa({
  tipo,
  procesos,
}: {
  tipo: TipoDeProceso;
  procesos: ProcesoDelMapa[];
}) {
  if (procesos.length === 0) return null;
  return (
    <section className="mb-5">
      <h2 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-slate-500">
        {NOMBRE_DEL_TIPO[tipo]}
      </h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {procesos.map((p) => (
          <TarjetaDeProceso key={p.id} proceso={p} />
        ))}
      </div>
    </section>
  );
}

function TarjetaDeProceso({ proceso: p }: { proceso: ProcesoDelMapa }) {
  const c = p.cuelgan;
  return (
    <Link
      to={`/admin/residencia/procesos/${p.id}`}
      className={`block rounded-2xl border px-4 py-3 transition hover:border-slate-400 ${
        p.activo ? "border-slate-200 bg-white" : "border-slate-200 bg-slate-50"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-[14px] font-semibold leading-tight">{p.nombre}</h3>
        {p.bandaMaxima != null && (
          <span
            className={`shrink-0 rounded-md px-2 py-0.5 text-[11px] ${colorDeLaBanda(p.bandaMaxima)}`}
          >
            riesgo {NOMBRE_DE_LA_BANDA[p.bandaMaxima]}
          </span>
        )}
      </div>
      <p className="mt-1 text-[12px] text-slate-500">
        Responsable: {p.responsable.nombre}
        {!p.responsable.activo && " (rol desactivado)"}
      </p>
      {!p.activo && (
        <p className="mt-1 text-[12px] font-medium text-slate-500">
          Desactivado
        </p>
      )}
      {/* Lo que cuelga, contado. Es lo que hace que el mapa conteste la
          pregunta de la NC 01 de un vistazo: de este proceso cuelgan
          estos indicadores y estos riesgos, y no hay otro sitio. */}
      <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-slate-600">
        <li>{c.indicadores} indicadores</li>
        <li>{c.riesgos} riesgos</li>
        {c.oportunidades > 0 && <li>{c.oportunidades} oportunidades</li>}
        <li>{c.objetivos} objetivos</li>
        <li
          className={
            c.noConformidades > 0 ? "font-semibold text-amber-700" : undefined
          }
        >
          {c.noConformidades} NC abiertas
        </li>
      </ul>
      {c.revisionesVencidas > 0 && (
        <p className="mt-1 text-[12px] font-medium text-red-700">
          {c.revisionesVencidas} revisión(es) de riesgo vencida(s)
        </p>
      )}
    </Link>
  );
}

/** El alta de un proceso propio del centro. */
function FormularioDeProceso({
  roles,
  onHecho,
  onError,
}: {
  roles: RolDeCuidado[];
  onHecho: () => Promise<void>;
  onError: (m: string) => void;
}) {
  const [name, setName] = useState("");
  const [tipo, setTipo] = useState<TipoDeProceso>("OPERATIONAL");
  const [purpose, setPurpose] = useState("");
  const [rolId, setRolId] = useState(roles[0]?.id ?? "");

  async function guardar(): Promise<void> {
    if (name.trim() === "" || rolId === "") {
      onError("Un proceso necesita nombre y responsable.");
      return;
    }
    try {
      await api("/residencia/procesos", {
        method: "POST",
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
      <h2 className="text-[14.5px] font-semibold">Un proceso más del centro</h2>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
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
          Responsable (rol de cuidado)
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
          Qué hace, en una línea
          <input
            value={purpose}
            onChange={(e) => setPurpose(e.target.value)}
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
    </section>
  );
}
