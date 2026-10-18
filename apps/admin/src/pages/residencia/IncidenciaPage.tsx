// residencia-4 · **LA FICHA DE UNA INCIDENCIA.**
//
// Cronología, acciones, enlaces, cierre y comunicación a familia. Es el
// documento que se enseña en una auditoría, así que se lee de arriba
// abajo y en orden: qué pasó, qué sonó, qué se hizo, qué se le dijo a la
// familia y quién la cerró.
//
// ── TODO ES APPEND-ONLY, Y LA PANTALLA LO DICE ──────────────────────
//
// No hay un botón de editar en ninguna parte, y no es un olvido: ni las
// acciones ni las comunicaciones se editan (los triggers tampoco lo
// dejarían). Lo que hay es «añadir». Si algo está mal, se escribe otra
// línea que lo diga — igual que una corrección de un `CareRecord`.
//
// ── LAS DOS CONSTANCIAS DE FAMILIA, JUNTAS (D-32 a D-34) ────────────
//
// «Comunicado» y «no comunicado» son el mismo formulario con dos
// respuestas, y están en la misma tarjeta a propósito. Si «no comunicado»
// fuera un enlace pequeño debajo, nadie lo usaría y el libro quedaría con
// la mitad de las incidencias sin constancia — que es exactamente lo que
// la observación 10 de AENOR pide que no pase.
//
// Y el botón de cerrar sale DESHABILITADO cuando falta, con la frase al
// lado. El servidor lo rechaza igual (es la regla, no una validación de
// pantalla); lo de aquí es para que no haya que llegar al rechazo.

import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { AdminShell } from "../../AdminShell.js";
import { api, ApiError } from "../../api.js";
import {
  CenteredLoader,
  FieldError,
  OutlineButton,
  PrimaryButton,
} from "../../ui.js";
import {
  colorDelNivel,
  fechaYHora,
  nombreDelCanal,
  nombreDelEstadoDelAviso,
  nombreDelOrigen,
  nombreDelSujeto,
  type FichaDeIncidencia,
} from "./incidencias-lib.js";

export function IncidenciaPage() {
  const { id } = useParams<{ id: string }>();
  const [ficha, setFicha] = useState<FichaDeIncidencia | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [capacidad, setCapacidad] = useState("");
  const [nota, setNota] = useState("");
  const [cerrando, setCerrando] = useState(false);

  const recargar = useCallback(async () => {
    try {
      const r = await api<FichaDeIncidencia>(`/residencia/incidencias/${id}`);
      setFicha(r);
      setCapacidad((c) => c || (r.capacidades[0]?.assignmentId ?? ""));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Error inesperado");
    }
  }, [id]);

  useEffect(() => {
    void recargar();
  }, [recargar]);

  if (!ficha) {
    return error ? (
      <AdminShell title="Incidencia">
        <FieldError message={error} />
      </AdminShell>
    ) : (
      <CenteredLoader label="Cargando la incidencia…" />
    );
  }

  async function añadirAccion() {
    if (nota.trim().length === 0) return;
    try {
      await api(`/residencia/incidencias/${id}/acciones`, {
        method: "POST",
        body: { texto: nota.trim(), careRoleAssignmentId: capacidad || undefined },
      });
      setNota("");
      await recargar();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Error inesperado");
    }
  }

  async function cerrar() {
    setCerrando(true);
    setError(null);
    try {
      await api(`/residencia/incidencias/${id}/cerrar`, {
        method: "POST",
        body: { careRoleAssignmentId: capacidad || undefined },
      });
      await recargar();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Error inesperado");
    } finally {
      setCerrando(false);
    }
  }

  return (
    <AdminShell title="Incidencia">
      <Link
        to="/admin/residencia/incidencias"
        className="mb-4 inline-block text-[13.5px] text-slate-500 hover:underline"
      >
        ← Volver al libro
      </Link>

      {error && <FieldError message={error} />}

      {/* ── La cabecera ───────────────────────────────────────────── */}
      <div className="rounded-2xl border border-slate-200 bg-white px-5 py-4">
        <div className="flex flex-wrap items-center gap-3">
          <span
            className={`rounded-md px-2 py-0.5 text-[13px] font-semibold ${colorDelNivel(ficha.nivel)}`}
          >
            {ficha.nivel}
          </span>
          <h2 className="text-[19px] font-semibold text-mipiace-ink">
            {ficha.nombreDelTipo}
          </h2>
          <span className="text-[13.5px] text-slate-500">
            {ficha.nombreDelNivel}
          </span>
          {ficha.abierta ? (
            <span className="rounded-md bg-amber-50 px-2 py-0.5 text-[12.5px] text-amber-800">
              abierta
            </span>
          ) : (
            <span className="rounded-md bg-emerald-50 px-2 py-0.5 text-[12.5px] text-emerald-800">
              cerrada{ficha.autocierre ? " · autocierre" : ""}
            </span>
          )}
        </div>
        <p className="mt-2 text-[13.5px] text-slate-600">
          {nombreDelSujeto(ficha.sujeto)}
          {ficha.residente ? ` · ${ficha.residente.nombre}` : ""}
          {ficha.habitacion ? ` · hab. ${ficha.habitacion.numero}` : ""} ·{" "}
          {nombreDelOrigen(ficha.origen)}
        </p>
        <p className="mt-1 text-[13px] text-slate-500">
          Abierta el {fechaYHora(ficha.abiertaEn)} por {ficha.abiertaPor} (
          {ficha.abiertaComo}) · día del centro {ficha.careDay}
          {ficha.turno ? ` · ${ficha.turno}` : ""}
        </p>
        {ficha.descripcion && (
          <p className="mt-3 rounded-xl bg-mipiace-stone px-4 py-3 text-[14px]">
            {ficha.descripcion}
          </p>
        )}
        {/* La versión de la plantilla con la que se graduó. Es lo que
            contesta «¿por qué esto fue N2?» tres años después. */}
        {ficha.versionDeLaPlantilla != null && (
          <p className="mt-2 text-[12.5px] text-slate-400">
            Graduada con la versión {ficha.versionDeLaPlantilla} de la
            plantilla de gravedad.
          </p>
        )}
        {ficha.cerradaEn && (
          <p className="mt-2 text-[13px] text-emerald-800">
            Cerrada el {fechaYHora(ficha.cerradaEn)} por {ficha.cerradaPor} (
            {ficha.cerradaComo})
            {ficha.autocierre
              ? " — autocierre: la cerró quien la abrió."
              : ""}
          </p>
        )}
      </div>

      {/* ── Los avisos ────────────────────────────────────────────── */}
      {ficha.avisos.length > 0 && (
        <section className="mt-5">
          <h3 className="mb-2 text-[15px] font-semibold text-mipiace-ink">
            Avisos
          </h3>
          <ul className="space-y-2">
            {ficha.avisos.map((a) => (
              <li
                key={a.id}
                className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-[13.5px]"
              >
                <span className="font-medium">{nombreDelCanal(a.canal)}</span>{" "}
                · {a.nivel}
                {a.escalado ? " · escalado" : ""} · salió{" "}
                {fechaYHora(a.salidoEn)}
                {/* Los DOS instantes. Si se separan, la puerta estaba sin
                    red y el aviso salió tarde — y eso tiene que constar,
                    porque es la mitad de «sin red no se finge». */}
                {new Date(a.salidoEn).getTime() -
                  new Date(a.apuntadoEn).getTime() >
                  60_000 && (
                  <span className="text-amber-700">
                    {" "}
                    (se apuntó a las {fechaYHora(a.apuntadoEn)}: la tablet
                    estaba sin red)
                  </span>
                )}
                <br />
                {a.acusadoPor ? (
                  <span className="text-emerald-800">
                    Lo cogió {a.acusadoPor} ({a.acusadoComo}) el{" "}
                    {fechaYHora(a.acusadoEn!)}
                  </span>
                ) : (
                  <span className="text-amber-700">
                    Sin acusar · {nombreDelEstadoDelAviso(a.estado)}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ── La cronología ─────────────────────────────────────────── */}
      <section className="mt-5">
        <h3 className="mb-2 text-[15px] font-semibold text-mipiace-ink">
          Qué se hizo
        </h3>
        {ficha.acciones.length === 0 ? (
          <p className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-[13.5px] text-slate-500">
            Todavía no hay ninguna acción apuntada.
          </p>
        ) : (
          <ol className="space-y-2">
            {ficha.acciones.map((a) => (
              <li
                key={a.id}
                className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-[13.5px]"
              >
                <span className="text-slate-400 tabular-nums">
                  {fechaYHora(a.en)}
                </span>{" "}
                · <span className="font-medium">{claseDeAccion(a.clase)}</span>
                {a.clase === "SEVERITY" && (
                  <> · de {a.nivelDesde} a {a.nivelHasta}</>
                )}
                {a.clase === "CALL" && (
                  <> · {a.llamado ? "se llamó" : "se decidió no llamar"}</>
                )}
                {a.texto && <p className="mt-1">{a.texto}</p>}
                <p className="mt-1 text-slate-500">
                  {a.por} ({a.como})
                </p>
              </li>
            ))}
          </ol>
        )}

        {ficha.abierta && (
          <div className="mt-3 rounded-2xl border border-slate-200 bg-white px-4 py-3">
            <label
              htmlFor="accion-nueva"
              className="block text-[13px] font-medium text-mipiace-ink-soft"
            >
              Apuntar qué se hizo
            </label>
            <textarea
              id="accion-nueva"
              value={nota}
              onChange={(e) => setNota(e.target.value)}
              rows={2}
              maxLength={2000}
              className="mt-1.5 w-full rounded-xl border border-slate-300 px-3 py-2 text-[14px]"
              placeholder="la DUE le ha dado paracetamol y la vuelve a mirar a las 14:00"
            />
            <div className="mt-2 flex items-center justify-between gap-3">
              <CapacidadSelect
                capacidades={ficha.capacidades}
                valor={capacidad}
                onCambio={setCapacidad}
              />
              <OutlineButton
                type="button"
                onClick={() => void añadirAccion()}
                className="!h-10 !w-auto !px-4 !text-[13.5px]"
              >
                Apuntar
              </OutlineButton>
            </div>
          </div>
        )}
      </section>

      {/* ── La familia (D-32 a D-34) ──────────────────────────────── */}
      {ficha.sujeto === "RESIDENT" && (
        <Familia
          ficha={ficha}
          capacidad={capacidad}
          onCambioDeCapacidad={setCapacidad}
          onHecho={() => void recargar()}
          onError={setError}
        />
      )}

      {/* ── Los enlaces (D-35) ────────────────────────────────────── */}
      <Enlaces ficha={ficha} onHecho={() => void recargar()} onError={setError} />

      {/* ── El cierre (D-27, D-28) ────────────────────────────────── */}
      {ficha.abierta && (
        <section className="mt-6 rounded-2xl border border-slate-200 bg-white px-5 py-4">
          <h3 className="text-[15px] font-semibold text-mipiace-ink">
            Cerrar la incidencia
          </h3>
          <p className="mt-1 text-[13px] text-slate-500">
            La cierra un rol de categoría directiva.{" "}
            {ficha.nivel === "N3" || ficha.nivel === "N4"
              ? "Y en N3 y N4, una persona distinta de quien la abrió: si no la hay, se queda abierta."
              : "En N1 y N2 puede cerrarla quien la abrió, y se marca como autocierre."}
          </p>
          {!ficha.puedeCerrarse && (
            <p className="mt-2 text-[13px] text-amber-700">
              Falta la constancia de familia: di si se comunicó o por qué no
              antes de cerrar.
            </p>
          )}
          <div className="mt-3 flex items-center gap-3">
            <CapacidadSelect
              capacidades={ficha.capacidades}
              valor={capacidad}
              onCambio={setCapacidad}
            />
            <PrimaryButton
              type="button"
              disabled={!ficha.puedeCerrarse || cerrando}
              onClick={() => void cerrar()}
              className="!h-10 !w-auto !px-4 !text-[13.5px]"
            >
              Cerrar
            </PrimaryButton>
          </div>
        </section>
      )}
    </AdminShell>
  );
}

function claseDeAccion(c: string): string {
  switch (c) {
    case "EVIDENCE":
      return "Se adjuntó una medida";
    case "SEVERITY":
      return "Cambió el nivel";
    case "ALERT":
      return "Alguien acusó el aviso";
    case "CALL":
      return "Servicio sanitario de guardia";
    case "CLOSE":
      return "Cierre";
    default:
      return "Nota";
  }
}

function CapacidadSelect({
  capacidades,
  valor,
  onCambio,
}: {
  capacidades: FichaDeIncidencia["capacidades"];
  valor: string;
  onCambio: (v: string) => void;
}) {
  if (capacidades.length <= 1) {
    return (
      <span className="text-[13px] text-slate-500">
        Firmas como {capacidades[0]?.code ?? "—"}
      </span>
    );
  }
  return (
    <label className="text-[13px] text-slate-500">
      Firmas como{" "}
      <select
        value={valor}
        onChange={(e) => onCambio(e.target.value)}
        className="h-9 rounded-lg border border-slate-300 px-2 text-[13px]"
      >
        {capacidades.map((c) => (
          <option key={c.assignmentId} value={c.assignmentId}>
            {c.code}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Las dos constancias, en la misma tarjeta. Ver la cabecera. */
function Familia({
  ficha,
  capacidad,
  onCambioDeCapacidad,
  onHecho,
  onError,
}: {
  ficha: FichaDeIncidencia;
  capacidad: string;
  onCambioDeCapacidad: (v: string) => void;
  onHecho: () => void;
  onError: (m: string) => void;
}) {
  const [clase, setClase] = useState<"COMUNICADO" | "NO_COMUNICADO">(
    "COMUNICADO",
  );
  const [via, setVia] = useState<"TELEFONO" | "PRESENCIAL" | "EMAIL" | "OTRA">(
    "TELEFONO",
  );
  const [contacto, setContacto] = useState("");
  const [contenido, setContenido] = useState("");
  const [respuesta, setRespuesta] = useState("");

  async function guardar() {
    try {
      await api(`/residencia/incidencias/${ficha.id}/familia`, {
        method: "POST",
        body: {
          clase,
          via: clase === "COMUNICADO" ? via : null,
          contacto: contacto.trim() || null,
          contenido: contenido.trim(),
          respuesta:
            clase === "COMUNICADO" && respuesta.trim() ? respuesta.trim() : null,
          careRoleAssignmentId: capacidad || undefined,
        },
      });
      setContenido("");
      setRespuesta("");
      setContacto("");
      onHecho();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "Error inesperado");
    }
  }

  return (
    <section className="mt-5">
      <h3 className="mb-2 text-[15px] font-semibold text-mipiace-ink">
        La familia
      </h3>
      {ficha.familia.length === 0 ? (
        <p className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13.5px] text-amber-900">
          Sin constancia. Una incidencia de residente no se cierra sin decir
          si se comunicó o por qué no.
        </p>
      ) : (
        <ul className="space-y-2">
          {ficha.familia.map((c) => (
            <li
              key={c.id}
              className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-[13.5px]"
            >
              <span className="font-medium">
                {c.clase === "COMUNICADO" ? "Comunicado" : "No comunicado"}
              </span>
              {c.via ? ` · ${c.via.toLowerCase()}` : ""}
              {c.contacto ? ` · ${c.contacto}` : ""} ·{" "}
              <span className="text-slate-400">{fechaYHora(c.en)}</span>
              {c.contenido && <p className="mt-1">{c.contenido}</p>}
              {c.respuesta && (
                <p className="mt-1 text-slate-600">
                  Contestaron: {c.respuesta}
                </p>
              )}
              <p className="mt-1 text-slate-500">
                {c.por} ({c.como})
              </p>
            </li>
          ))}
        </ul>
      )}

      {ficha.abierta && (
        <div className="mt-3 rounded-2xl border border-slate-200 bg-white px-4 py-3">
          <div className="flex flex-wrap gap-2">
            {(
              [
                ["COMUNICADO", "Se le ha comunicado"],
                ["NO_COMUNICADO", "No se le comunica"],
              ] as const
            ).map(([v, etiqueta]) => (
              <button
                key={v}
                type="button"
                onClick={() => setClase(v)}
                className={`h-10 rounded-lg px-4 text-[13.5px] ${
                  clase === v
                    ? "bg-mipiace-ink text-white"
                    : "border border-slate-300 text-slate-700"
                }`}
              >
                {etiqueta}
              </button>
            ))}
          </div>

          {clase === "COMUNICADO" && (
            <div className="mt-3 flex flex-wrap gap-3">
              <label className="text-[13px] text-slate-500">
                Por{" "}
                <select
                  value={via}
                  onChange={(e) => setVia(e.target.value as typeof via)}
                  className="h-9 rounded-lg border border-slate-300 px-2 text-[13px]"
                >
                  <option value="TELEFONO">teléfono</option>
                  <option value="PRESENCIAL">en persona</option>
                  <option value="EMAIL">correo</option>
                  <option value="OTRA">otra vía</option>
                </select>
              </label>
              <input
                value={contacto}
                onChange={(e) => setContacto(e.target.value)}
                placeholder="con quién se habló"
                className="h-9 flex-1 min-w-[180px] rounded-lg border border-slate-300 px-3 text-[13.5px]"
              />
            </div>
          )}

          <textarea
            value={contenido}
            onChange={(e) => setContenido(e.target.value)}
            rows={2}
            maxLength={2000}
            className="mt-3 w-full rounded-xl border border-slate-300 px-3 py-2 text-[14px]"
            placeholder={
              clase === "COMUNICADO"
                ? "qué se le dijo"
                : "por qué no se le comunica (hace falta: es la constancia)"
            }
          />
          {clase === "COMUNICADO" && (
            <textarea
              value={respuesta}
              onChange={(e) => setRespuesta(e.target.value)}
              rows={2}
              maxLength={2000}
              className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2 text-[14px]"
              placeholder="qué contestó (opcional)"
            />
          )}

          <div className="mt-2 flex items-center justify-between gap-3">
            <CapacidadSelect
              capacidades={ficha.capacidades}
              valor={capacidad}
              onCambio={onCambioDeCapacidad}
            />
            <OutlineButton
              type="button"
              onClick={() => void guardar()}
              className="!h-10 !w-auto !px-4 !text-[13.5px]"
            >
              Dejar constancia
            </OutlineButton>
          </div>
        </div>
      )}
    </section>
  );
}

/** Enlazar dos incidencias: la caída y el asidero suelto (D-35). */
function Enlaces({
  ficha,
  onHecho,
  onError,
}: {
  ficha: FichaDeIncidencia;
  onHecho: () => void;
  onError: (m: string) => void;
}) {
  const [otraId, setOtraId] = useState("");

  async function enlazar() {
    if (!otraId.trim()) return;
    try {
      await api(`/residencia/incidencias/${ficha.id}/enlaces`, {
        method: "POST",
        body: { otraId: otraId.trim() },
      });
      setOtraId("");
      onHecho();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "Error inesperado");
    }
  }

  async function quitar(id: string) {
    try {
      await api(`/residencia/incidencias/${ficha.id}/enlaces/${id}`, {
        method: "DELETE",
      });
      onHecho();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "Error inesperado");
    }
  }

  return (
    <section className="mt-5">
      <h3 className="mb-2 text-[15px] font-semibold text-mipiace-ink">
        Enlazada con
      </h3>
      <p className="mb-2 text-[13px] text-slate-500">
        Una caída por un asidero suelto son dos incidencias: la del residente
        y la avería. Enlazarlas es lo que deja escrita la causa.
      </p>
      {ficha.enlaces.length > 0 && (
        <ul className="mb-2 space-y-2">
          {ficha.enlaces.map((e) => (
            <li
              key={e.enlaceId}
              className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-[13.5px]"
            >
              <Link
                to={`/admin/residencia/incidencias/${e.id}`}
                className="hover:underline"
              >
                {nombreDelSujeto(e.sujeto)} · {e.nombreDelTipo} · {e.nivel}
                {e.abierta ? " · abierta" : ""}
              </Link>
              <button
                type="button"
                onClick={() => void quitar(e.id)}
                className="text-[13px] text-slate-500 underline"
              >
                Quitar
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <input
          value={otraId}
          onChange={(e) => setOtraId(e.target.value)}
          placeholder="pega aquí el id de la otra incidencia"
          className="h-10 flex-1 rounded-lg border border-slate-300 px-3 text-[13.5px]"
        />
        <OutlineButton
          type="button"
          onClick={() => void enlazar()}
          className="!h-10 !w-auto !px-4 !text-[13.5px]"
        >
          Enlazar
        </OutlineButton>
      </div>
    </section>
  );
}
