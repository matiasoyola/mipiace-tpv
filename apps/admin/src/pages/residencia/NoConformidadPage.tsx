// calidad-1 (D-73, D-76) · **UNA NO CONFORMIDAD, CON SU CICLO.**
//
// Abierta → causa analizada → acciones → acciones cerradas →
// verificación de eficacia → cerrada. La pantalla pinta el ciclo como
// una barra y **sólo enciende el paso que de verdad se puede dar**.
//
// ── EL BOTÓN APAGADO DICE QUÉ FALTA ─────────────────────────────────
//
// Y la frase no la escribe esta pantalla: viene del servidor, que la
// saca de `loQueFaltaPara` en `@mipiacetpv/residencia-plan` — la misma
// función que la ruta usa para rechazar. Por eso el botón no puede estar
// encendido cuando la ruta va a contestar 409: no hay dos opiniones.
//
// ── Y LO QUE NO SE PUEDE DESHACER SE DICE ANTES ─────────────────────
//
// La causa se escribe una vez. Una acción cerrada no se reabre. Una
// verificación no se edita. Son reglas del motor (triggers), y la
// pantalla las avisa **antes** de pulsar en vez de enseñar un error
// después: un formulario que acepta y luego dice que no es un
// formulario que enseña a desconfiar del sistema.

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
import { dia, hora } from "./relevo-lib.js";
import {
  NOMBRE_DEL_ESTADO,
  NOMBRE_DEL_ORIGEN,
  NOMBRE_DE_LA_CLASE_NC,
  PASOS_DEL_CICLO,
  colorDeLaClase,
  type EstadoDeNc,
  type RespuestaDeNc,
  type RolDeCuidado,
  type RespuestaDelMapa,
} from "./calidad-lib.js";

export function NoConformidadPage() {
  const { id = "" } = useParams();
  const [datos, setDatos] = useState<RespuestaDeNc | null>(null);
  const [roles, setRoles] = useState<RolDeCuidado[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const recargar = useCallback(async () => {
    try {
      const [n, m] = await Promise.all([
        api<RespuestaDeNc>(`/residencia/no-conformidades/${id}`),
        api<RespuestaDelMapa>("/residencia/procesos"),
      ]);
      setDatos(n);
      setRoles(m.roles);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Error inesperado");
    }
  }, [id]);

  useEffect(() => {
    void recargar();
  }, [recargar]);

  if (!datos) {
    return error ? (
      <AdminShell title="No conformidad">
        <FieldError message={error} />
      </AdminShell>
    ) : (
      <CenteredLoader label="Abriendo el expediente…" />
    );
  }

  const n = datos.noConformidad;
  const ciclo = datos.ciclo.ciclo;
  const faltaPara = (destino: EstadoDeNc): string | null =>
    datos.ciclo.siguiente.find((s) => s.destino === destino)?.falta ?? null;

  async function hacer(fn: () => Promise<unknown>, ok: string): Promise<void> {
    try {
      await fn();
      setAviso(ok);
      setTimeout(() => setAviso(null), 5000);
      setError(null);
      await recargar();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Error inesperado");
    }
  }

  return (
    <AdminShell title={n.referencia}>
      <p className="-mt-2 mb-3 flex flex-wrap items-baseline gap-x-3 text-[13px] text-slate-500">
        <Link to="/admin/residencia/no-conformidades" className="underline">
          No conformidades
        </Link>
        <span
          className={`rounded-md px-2 py-0.5 text-[11px] ${colorDeLaClase(n.clase)}`}
        >
          {NOMBRE_DE_LA_CLASE_NC[n.clase]}
        </span>
        <span>
          {NOMBRE_DEL_ORIGEN[n.origen]} · detectada el {dia(n.detectedOn)}
          {n.isoClause && ` · ISO ${n.isoClause}`}
        </span>
        <Link
          to={`/admin/residencia/procesos/${n.proceso.id}`}
          className="underline"
        >
          {n.proceso.name}
        </Link>
      </p>

      {error && <FieldError message={error} />}
      {aviso && <SuccessBanner message={aviso} />}

      {/* ── El ciclo, como una barra ───────────────────────────── */}
      <ol className="mb-5 flex flex-wrap gap-1.5">
        {PASOS_DEL_CICLO.map((paso) => {
          const hecho =
            PASOS_DEL_CICLO.indexOf(paso) <= PASOS_DEL_CICLO.indexOf(n.estado);
          return (
            <li
              key={paso}
              className={`rounded-lg px-3 py-1.5 text-[12.5px] ${
                paso === n.estado
                  ? "bg-slate-900 font-semibold text-white"
                  : hecho
                    ? "bg-emerald-100 text-emerald-900"
                    : "bg-slate-100 text-slate-500"
              }`}
            >
              {NOMBRE_DEL_ESTADO[paso]}
            </li>
          );
        })}
      </ol>

      {/* ── Qué pasa y por qué ─────────────────────────────────── */}
      <section className="mb-5 rounded-2xl border border-slate-200 bg-white px-5 py-4">
        <h2 className="text-[14.5px] font-semibold">Qué pasa</h2>
        <p className="mt-1 whitespace-pre-wrap text-[13.5px]">{n.descripcion}</p>
        {(n.origenDetalle.incidencia != null ||
          n.origenDetalle.indicador != null ||
          n.origenDetalle.nota != null) && (
          <p className="mt-2 text-[12.5px] text-slate-500">
            Sale de:{" "}
            {n.origenDetalle.incidencia != null ? (
              <Link
                to={`/admin/residencia/incidencias/${n.origenDetalle.incidencia.id}`}
                className="underline"
              >
                la incidencia «{n.origenDetalle.incidencia.incidentType}» del
                libro
              </Link>
            ) : n.origenDetalle.indicador != null ? (
              <>
                el indicador {n.origenDetalle.indicador} de{" "}
                {n.origenDetalle.mes}
              </>
            ) : (
              n.origenDetalle.nota
            )}
          </p>
        )}
        <p className="mt-2 text-[12.5px] text-slate-500">
          Abierta el {dia(n.abiertaEn.slice(0, 10))} a las {hora(n.abiertaEn)}{" "}
          por {n.abiertaPor} como {n.abiertaComo}.
          {n.cerradaEn &&
            ` Cerrada el ${dia(n.cerradaEn.slice(0, 10))} por ${n.cerradaPor}.`}
        </p>

        <h3 className="mt-4 text-[13.5px] font-semibold">Por qué pasa</h3>
        {n.causa ? (
          <p className="mt-1 whitespace-pre-wrap text-[13.5px]">{n.causa}</p>
        ) : (
          <CausaNueva
            ncId={id}
            falta={faltaPara("CAUSE_ANALYSED")}
            clase={n.clase}
            onHecho={(fn) => hacer(fn, "Causa analizada.")}
          />
        )}
      </section>

      {/* ── Las acciones ───────────────────────────────────────── */}
      <section className="mb-5 rounded-2xl border border-slate-200 bg-white px-5 py-4">
        <h2 className="text-[14.5px] font-semibold">
          Acciones ({datos.acciones.length})
        </h2>
        {datos.acciones.length === 0 && (
          <p className="mt-1 text-[13px] text-slate-500">
            Ninguna todavía. Escribir la primera acción pasa la no
            conformidad a «con acciones en curso».
          </p>
        )}
        <ul className="mt-3 space-y-3">
          {datos.acciones.map((a) => (
            <li
              key={a.id}
              className={`rounded-xl border px-4 py-3 ${
                a.vencida ? "border-red-300 bg-red-50" : "border-slate-200"
              }`}
            >
              <p className="text-[13.5px]">{a.que}</p>
              <p className="mt-1 text-[12.5px] text-slate-500">
                Responsable: {a.responsable} · plazo {dia(a.dueOn)}
                {a.vencida && " · VENCIDA"}
                {a.cerradaEn &&
                  ` · cerrada el ${dia(a.cerradaEn.slice(0, 10))} por ${a.cerradaPor}`}
              </p>
              {a.notaDeCierre && (
                <p className="mt-1 text-[13px] text-slate-700">
                  {a.notaDeCierre}
                </p>
              )}
              {a.evidencias.length > 0 && (
                <ul className="mt-2 space-y-1 text-[12.5px] text-slate-600">
                  {a.evidencias.map((e) => (
                    <li key={e.id}>
                      Evidencia · {dia(e.at.slice(0, 10))} · {e.por}
                      {e.nota ? ` · ${e.nota}` : ""}
                      {e.tieneFichero && (
                        <>
                          {" · "}
                          <a
                            href={`/api/residencia/evidencias/${e.id}/fichero`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="underline"
                          >
                            documento
                          </a>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {a.cerradaEn == null && n.estado !== "CLOSED" && (
                <CerrarAccion
                  accionId={a.id}
                  onHecho={(fn) => hacer(fn, "Acción cerrada.")}
                />
              )}
              {a.cerradaEn != null && n.estado !== "CLOSED" && (
                <NuevaEvidencia
                  accionId={a.id}
                  onHecho={(fn) => hacer(fn, "Evidencia añadida.")}
                />
              )}
            </li>
          ))}
        </ul>

        {n.estado !== "CLOSED" && (
          <NuevaAccion
            ncId={id}
            roles={roles}
            bloqueada={
              ciclo.estado === "OPEN" &&
              (n.clase === "MAJOR" || n.clase === "MINOR")
                ? "Una no conformidad mayor o menor no lleva acciones hasta que se analiza la causa."
                : null
            }
            onHecho={(fn) => hacer(fn, "Acción escrita.")}
          />
        )}

        {/* Dar las acciones por cerradas: el paso que abre la
            verificación. El botón se apaga con la frase del servidor. */}
        {n.estado === "ACTIONS" && (
          <div className="mt-4 border-t border-slate-200 pt-3">
            <PrimaryButton
              type="button"
              disabled={faltaPara("ACTIONS_CLOSED") != null}
              onClick={() =>
                void hacer(
                  () =>
                    api(`/residencia/no-conformidades/${id}/estado`, {
                      method: "POST",
                      body: { estado: "ACTIONS_CLOSED" },
                    }),
                  "Acciones cerradas. Falta verificar la eficacia.",
                )
              }
              className="!h-10 !w-auto !px-5 !text-[13px]"
            >
              Dar las acciones por cerradas
            </PrimaryButton>
            {faltaPara("ACTIONS_CLOSED") && (
              <p className="mt-1 text-[12.5px] text-slate-500">
                {faltaPara("ACTIONS_CLOSED")}
              </p>
            )}
          </div>
        )}
      </section>

      {/* ── La verificación de eficacia ────────────────────────── */}
      <section className="mb-5 rounded-2xl border border-slate-200 bg-white px-5 py-4">
        <h2 className="text-[14.5px] font-semibold">
          Verificación de eficacia ({datos.verificaciones.length})
        </h2>
        <p className="mt-1 text-[12.5px] text-slate-500">
          La firma <strong>una persona distinta de quien cerró la última
          acción</strong>. Un «no eficaz» no cierra: devuelve la no
          conformidad a acciones, y las dos verificaciones quedan.
        </p>
        <ul className="mt-3 space-y-2">
          {datos.verificaciones.map((v) => (
            <li
              key={v.id}
              className={`rounded-xl border px-4 py-3 ${
                v.resultado === "EFFECTIVE"
                  ? "border-emerald-300 bg-emerald-50"
                  : "border-amber-300 bg-amber-50"
              }`}
            >
              <p className="text-[13px] font-semibold">
                {v.resultado === "EFFECTIVE" ? "Eficaz" : "NO eficaz"} ·{" "}
                {dia(v.at.slice(0, 10))} · {v.por} ({v.como})
              </p>
              <p className="mt-1 whitespace-pre-wrap text-[13.5px]">{v.nota}</p>
            </li>
          ))}
        </ul>
        {n.estado === "ACTIONS_CLOSED" && (
          <NuevaVerificacion
            ncId={id}
            onHecho={(fn) =>
              hacer(fn, "Verificación escrita. El estado se mueve solo.")
            }
          />
        )}
      </section>
    </AdminShell>
  );
}

type Hacer = (fn: () => Promise<unknown>) => void;

function CausaNueva({
  ncId,
  falta,
  clase,
  onHecho,
}: {
  ncId: string;
  falta: string | null;
  clase: string;
  onHecho: Hacer;
}) {
  const [texto, setTexto] = useState("");
  const opcional = clase === "OBSERVATION" || clase === "IMPROVEMENT";
  return (
    <div className="mt-2">
      <textarea
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        rows={3}
        placeholder={
          opcional
            ? "Opcional en una observación o una oportunidad de mejora."
            : "Obligatoria: una NC mayor o menor no pasa a acciones sin causa."
        }
        className="block w-full rounded-xl border border-slate-300 px-3 py-2 text-[13.5px]"
      />
      <p className="mt-1 text-[12px] text-slate-500">
        La causa se escribe <strong>una vez</strong> y no se reescribe: una
        causa que se reescribe es una causa que se acomoda al resultado.
      </p>
      <PrimaryButton
        type="button"
        disabled={texto.trim() === ""}
        onClick={() =>
          onHecho(() =>
            api(`/residencia/no-conformidades/${ncId}/causa`, {
              method: "POST",
              body: { causa: texto.trim() },
            }),
          )
        }
        className="mt-2 !h-10 !w-auto !px-5 !text-[13px]"
      >
        Guardar la causa
      </PrimaryButton>
      {falta && texto.trim() === "" && (
        <span className="ml-3 text-[12.5px] text-slate-500">{falta}</span>
      )}
    </div>
  );
}

function NuevaAccion({
  ncId,
  roles,
  bloqueada,
  onHecho,
}: {
  ncId: string;
  roles: RolDeCuidado[];
  bloqueada: string | null;
  onHecho: Hacer;
}) {
  const [abierto, setAbierto] = useState(false);
  const [que, setQue] = useState("");
  const [dueOn, setDueOn] = useState(() =>
    new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10),
  );
  const [tipo, setTipo] = useState<"ROL" | "ETIQUETA">("ROL");
  const [rolId, setRolId] = useState(roles[0]?.id ?? "");
  const [etiqueta, setEtiqueta] = useState("");

  if (bloqueada != null) {
    return (
      <p className="mt-4 border-t border-slate-200 pt-3 text-[12.5px] text-slate-500">
        {bloqueada}
      </p>
    );
  }
  if (!abierto) {
    return (
      <OutlineButton
        type="button"
        onClick={() => setAbierto(true)}
        className="mt-4 !h-10 !w-auto !px-4 !text-[13px]"
      >
        Escribir una acción
      </OutlineButton>
    );
  }
  return (
    <div className="mt-4 rounded-xl border border-slate-300 bg-slate-50 px-4 py-3">
      <label className="block text-[13px]">
        Qué se va a hacer
        <textarea
          value={que}
          onChange={(e) => setQue(e.target.value)}
          rows={2}
          className="mt-1 block w-full rounded-xl border border-slate-300 px-3 py-2 text-[13.5px]"
        />
      </label>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <label className="block text-[13px]">
          Plazo
          <input
            type="date"
            value={dueOn}
            onChange={(e) => setDueOn(e.target.value)}
            className="mt-1 block h-10 w-full rounded-xl border border-slate-300 px-3 text-[13.5px]"
          />
        </label>
        <label className="block text-[13px]">
          Responsable
          <select
            value={tipo}
            onChange={(e) => setTipo(e.target.value as "ROL" | "ETIQUETA")}
            className="mt-1 block h-10 w-full rounded-xl border border-slate-300 px-3 text-[13.5px]"
          >
            <option value="ROL">Un rol del centro</option>
            <option value="ETIQUETA">Alguien de fuera</option>
          </select>
        </label>
        {tipo === "ROL" ? (
          <label className="block text-[13px]">
            Rol
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
        ) : (
          <label className="block text-[13px]">
            Quién
            <input
              value={etiqueta}
              onChange={(e) => setEtiqueta(e.target.value)}
              placeholder="Gestoría, CINSA…"
              className="mt-1 block h-10 w-full rounded-xl border border-slate-300 px-3 text-[13.5px]"
            />
          </label>
        )}
      </div>
      <div className="mt-3 flex gap-2">
        <PrimaryButton
          type="button"
          disabled={que.trim() === ""}
          onClick={() => {
            onHecho(() =>
              api(`/residencia/no-conformidades/${ncId}/acciones`, {
                method: "POST",
                body: {
                  que: que.trim(),
                  dueOn,
                  responsibleCareRoleId: tipo === "ROL" ? rolId : null,
                  responsibleLabel: tipo === "ETIQUETA" ? etiqueta.trim() : null,
                },
              }),
            );
            setAbierto(false);
            setQue("");
          }}
          className="!h-10 !w-auto !px-5 !text-[13px]"
        >
          Escribir
        </PrimaryButton>
        <OutlineButton
          type="button"
          onClick={() => setAbierto(false)}
          className="!h-10 !w-auto !px-4 !text-[13px]"
        >
          Cancelar
        </OutlineButton>
      </div>
    </div>
  );
}

function CerrarAccion({
  accionId,
  onHecho,
}: {
  accionId: string;
  onHecho: Hacer;
}) {
  const [nota, setNota] = useState("");
  const [abierto, setAbierto] = useState(false);
  if (!abierto) {
    return (
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="mt-2 block text-[12.5px] text-slate-500 underline"
      >
        cerrar esta acción
      </button>
    );
  }
  return (
    <div className="mt-2">
      <textarea
        value={nota}
        onChange={(e) => setNota(e.target.value)}
        rows={2}
        placeholder="Qué se hizo exactamente."
        className="block w-full rounded-xl border border-slate-300 px-3 py-2 text-[13.5px]"
      />
      <p className="mt-1 text-[12px] text-slate-500">
        Una acción cerrada no se reabre.
      </p>
      <PrimaryButton
        type="button"
        onClick={() => {
          onHecho(() =>
            api(`/residencia/acciones/${accionId}/cerrar`, {
              method: "POST",
              body: { nota: nota.trim() === "" ? null : nota.trim() },
            }),
          );
          setAbierto(false);
        }}
        className="mt-2 !h-9 !w-auto !px-4 !text-[13px]"
      >
        Cerrar la acción
      </PrimaryButton>
    </div>
  );
}

function NuevaEvidencia({
  accionId,
  onHecho,
}: {
  accionId: string;
  onHecho: Hacer;
}) {
  const [nota, setNota] = useState("");
  const [abierto, setAbierto] = useState(false);
  if (!abierto) {
    return (
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="mt-2 block text-[12.5px] text-slate-500 underline"
      >
        añadir una evidencia
      </button>
    );
  }
  return (
    <div className="mt-2">
      <input
        value={nota}
        onChange={(e) => setNota(e.target.value)}
        placeholder="Qué lo demuestra."
        className="block h-10 w-full rounded-xl border border-slate-300 px-3 text-[13.5px]"
      />
      <PrimaryButton
        type="button"
        disabled={nota.trim() === ""}
        onClick={() => {
          onHecho(() =>
            api(`/residencia/acciones/${accionId}/evidencias`, {
              method: "POST",
              body: { nota: nota.trim() },
            }),
          );
          setAbierto(false);
          setNota("");
        }}
        className="mt-2 !h-9 !w-auto !px-4 !text-[13px]"
      >
        Añadir
      </PrimaryButton>
    </div>
  );
}

function NuevaVerificacion({
  ncId,
  onHecho,
}: {
  ncId: string;
  onHecho: Hacer;
}) {
  const [nota, setNota] = useState("");
  const [resultado, setResultado] = useState<"EFFECTIVE" | "NOT_EFFECTIVE">(
    "EFFECTIVE",
  );
  return (
    <div className="mt-4 rounded-xl border border-slate-300 bg-slate-50 px-4 py-3">
      <label className="block text-[13px]">
        Qué se comprobó y cómo
        <textarea
          value={nota}
          onChange={(e) => setNota(e.target.value)}
          rows={2}
          className="mt-1 block w-full rounded-xl border border-slate-300 px-3 py-2 text-[13.5px]"
        />
      </label>
      <label className="mt-3 block text-[13px]">
        Resultado
        <select
          value={resultado}
          onChange={(e) =>
            setResultado(e.target.value as "EFFECTIVE" | "NOT_EFFECTIVE")
          }
          className="mt-1 block h-10 w-full rounded-xl border border-slate-300 px-3 text-[13.5px] sm:w-72"
        >
          <option value="EFFECTIVE">Eficaz · cierra la no conformidad</option>
          <option value="NOT_EFFECTIVE">
            No eficaz · vuelve a acciones
          </option>
        </select>
      </label>
      <PrimaryButton
        type="button"
        disabled={nota.trim() === ""}
        onClick={() =>
          onHecho(() =>
            api(`/residencia/no-conformidades/${ncId}/verificar`, {
              method: "POST",
              body: { resultado, nota: nota.trim() },
            }),
          )
        }
        className="mt-3 !h-10 !w-auto !px-5 !text-[13px]"
      >
        Firmar la verificación
      </PrimaryButton>
    </div>
  );
}
