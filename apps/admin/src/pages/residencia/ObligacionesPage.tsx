// residencia-5 (D-42) · **LAS OBLIGACIONES DE DIRECCIÓN.**
//
// «¿Qué toca este día del mes?» es la mitad de la métrica de éxito de
// dirección (bloque C §2), y hoy la respuesta vive en la cabeza de
// Carmen.
//
// Tres mitades en una pantalla:
//
//   1. **lo vencido y lo de hoy**, arriba y en rojo, porque es lo que se
//      viene a ver;
//   2. **el catálogo**, por familia, con el botón de cargar la plantilla
//      del bloque C;
//   3. **las ocurrencias de una obligación** cuando se abre, con el botón
//      de marcarla hecha y el de adjuntar la evidencia.
//
// ── CARGAR LA PLANTILLA ES UN BOTÓN, NO EL ARRANQUE (D-42) ──────────
//
// Las obligaciones son **del centro**, no del producto: el catálogo del
// bloque C §3 es una plantilla que la dirección carga de una vez y luego
// ajusta. Por eso no baja al arrancar la API como la plantilla de gravedad
// (D-65) o el catálogo de controles (D-21), y por eso **no pisa nada**: si
// alguien cambió el día de las nóminas del 25 al 28, volver a pulsar el
// botón no se lo devuelve. Es un botón que alguien va a pulsar dos veces
// por si acaso.
//
// ── LO MARCADO «POR VERIFICAR» SE VE ────────────────────────────────
//
// El catálogo original es un borrador y lo que lleva *(verificar)* es una
// periodicidad que alguien supuso en agosto. Entra igual —una obligación
// sin periodicidad confirmada sigue tocando— y la pantalla lo pinta para
// que se arregle, no para bloquear.

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Plus } from "lucide-react";

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
  colorDeLaConsecuencia,
  dia,
  hora,
  NOMBRE_DE_LA_CONSECUENCIA,
  NOMBRE_DE_LA_FAMILIA,
  type FamiliaDeObligacion,
  type Obligacion,
  type OcurrenciaPintada,
} from "./relevo-lib.js";

const FAMILIAS: FamiliaDeObligacion[] = [
  "PERSONAL",
  "DINERO",
  "COMPRAS",
  "CUMPLIMIENTO",
  "CALIDAD",
];

interface Respuesta {
  obligaciones: Obligacion[];
  hoy: OcurrenciaPintada[];
  vencidas: OcurrenciaPintada[];
  proximas: OcurrenciaPintada[];
  plantilla: number;
}

interface Ocurrencia {
  id: string;
  dueOn: string;
  hecha: boolean;
  hechaEn: string | null;
  hechaPor: string | null;
  hechaComo: string | null;
  nota: string | null;
  tieneEvidencia: boolean;
  evidenciaBytes: number | null;
  corregidaEn: string | null;
  corregidaPor: string | null;
  motivoDeCorreccion: string | null;
}

export function ObligacionesPage() {
  const [params, setParams] = useSearchParams();
  const abierta = params.get("duty");
  const [datos, setDatos] = useState<Respuesta | null>(null);
  const [ocurrencias, setOcurrencias] = useState<Ocurrencia[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  const recargar = useCallback(async () => {
    try {
      setDatos(await api<Respuesta>("/residencia/obligaciones"));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Error inesperado");
    }
  }, []);

  useEffect(() => {
    void recargar();
  }, [recargar]);

  const verOcurrencias = useCallback(async (dutyId: string) => {
    try {
      const r = await api<{ ocurrencias: Ocurrencia[] }>(
        `/residencia/obligaciones/${dutyId}/ocurrencias`,
      );
      setOcurrencias(r.ocurrencias);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Error inesperado");
    }
  }, []);

  useEffect(() => {
    if (abierta) void verOcurrencias(abierta);
    else setOcurrencias(null);
  }, [abierta, verOcurrencias]);

  async function cargarPlantilla(): Promise<void> {
    setCargando(true);
    try {
      const r = await api<{ creadas: number; yaEstaban: number }>(
        "/residencia/obligaciones/cargar-plantilla",
        { method: "POST", body: {} },
      );
      setAviso(
        `Cargadas ${r.creadas}. ${r.yaEstaban} ya estaban y no se han tocado.`,
      );
      setTimeout(() => setAviso(null), 6000);
      await recargar();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Error inesperado");
    } finally {
      setCargando(false);
    }
  }

  async function marcarHecha(occurrenceId: string): Promise<void> {
    try {
      await api(`/residencia/ocurrencias/${occurrenceId}/hecha`, {
        method: "POST",
        body: {},
      });
      setAviso("Marcada como hecha, con tu nombre, tu rol y la hora.");
      setTimeout(() => setAviso(null), 4000);
      if (abierta) await verOcurrencias(abierta);
      await recargar();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Error inesperado");
    }
  }

  async function corregir(occurrenceId: string): Promise<void> {
    // El motivo es obligatorio y lo pide el motor (el trigger
    // `duty_occurrences_hecha_no_vuelve`). Un `prompt` y no un modal
    // porque es la excepción, no el camino: una obligación se marca
    // muchas veces y se corrige casi nunca.
    const motivo = window.prompt(
      "¿Por qué se deshace? Queda firmado con tu nombre y la hora.",
    );
    if (motivo == null || motivo.trim().length === 0) return;
    try {
      await api(`/residencia/ocurrencias/${occurrenceId}/corregir`, {
        method: "POST",
        body: { motivo },
      });
      setAviso("Vuelve a estar pendiente, con la corrección firmada.");
      setTimeout(() => setAviso(null), 4000);
      if (abierta) await verOcurrencias(abierta);
      await recargar();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Error inesperado");
    }
  }

  async function subirEvidencia(
    occurrenceId: string,
    fichero: File,
  ): Promise<void> {
    try {
      const base64 = await aBase64(fichero);
      await api(`/residencia/ocurrencias/${occurrenceId}/evidencia`, {
        method: "POST",
        body: { pdfBase64: base64 },
      });
      setAviso("Documento adjuntado.");
      setTimeout(() => setAviso(null), 4000);
      if (abierta) await verOcurrencias(abierta);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Error inesperado");
    }
  }

  if (!datos) {
    return error ? (
      <AdminShell title="Obligaciones">
        <FieldError message={error} />
      </AdminShell>
    ) : (
      <CenteredLoader label="Cargando las obligaciones…" />
    );
  }

  const laAbierta = datos.obligaciones.find((o) => o.id === abierta) ?? null;

  return (
    <AdminShell title="Obligaciones">
      <p className="-mt-2 mb-5 text-[13.5px] text-slate-500">
        Lo que toca cada día, cada mes y cada año, con quién es responsable
        y qué pasa si no se hace. Una vencida sale en rojo aquí y en el
        panel; <strong>no abre incidencia</strong>.
      </p>

      {error && <FieldError message={error} />}
      {aviso && <SuccessBanner message={aviso} />}

      {/* ── Cargar la plantilla del bloque C ──────────────────────── */}
      {datos.plantilla > 0 && (
        <div className="mb-5 rounded-2xl border-2 border-mipiace-coral bg-white px-5 py-4">
          <p className="text-[13.5px]">
            Hay <strong>{datos.plantilla}</strong> obligación(es) del catálogo
            base que este centro todavía no tiene (nóminas, extintores,
            certificado de PCI, los 23 indicadores…).
          </p>
          <p className="mt-1 text-[13px] text-slate-500">
            Se cargan de una vez y después se ajustan. Pulsarlo dos veces no
            duplica nada ni pisa lo que hayas cambiado.
          </p>
          <PrimaryButton
            type="button"
            onClick={() => void cargarPlantilla()}
            disabled={cargando}
            className="mt-3 !h-10 !w-auto !px-5 !text-[13.5px]"
          >
            <Plus className="h-4 w-4" /> Cargar el catálogo base
          </PrimaryButton>
        </div>
      )}

      {/* ── Lo vencido y lo de hoy ────────────────────────────────── */}
      {datos.vencidas.length > 0 && (
        <section className="mb-5 rounded-2xl border-2 border-red-300 bg-red-50 px-5 py-4">
          <h2 className="text-[15px] font-semibold text-red-800">
            Vencidas ({datos.vencidas.length})
          </h2>
          <ul className="mt-2 space-y-1.5">
            {datos.vencidas.map((o) => (
              <li key={o.id} className="text-[13.5px] text-red-900">
                <span
                  className={`mr-2 inline-block rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${colorDeLaConsecuencia(
                    o.consequence,
                  )}`}
                >
                  {NOMBRE_DE_LA_CONSECUENCIA[
                    o.consequence as keyof typeof NOMBRE_DE_LA_CONSECUENCIA
                  ] ?? o.consequence}
                </span>
                <button
                  type="button"
                  onClick={() => setParams({ duty: o.dutyId })}
                  className="underline"
                >
                  {o.nombre}
                </button>{" "}
                — tocaba el {dia(o.dueOn)} ({Math.abs(o.diasRestantes)} día(s)
                de retraso) · {o.responsable}
                <PrimaryButton
                  type="button"
                  onClick={() => void marcarHecha(o.id)}
                  className="ml-3 !inline-flex !h-8 !w-auto !px-3 !text-[12px]"
                >
                  Hecha
                </PrimaryButton>
              </li>
            ))}
          </ul>
        </section>
      )}

      {datos.hoy.length > 0 && (
        <section className="mb-5 rounded-2xl border border-slate-200 bg-white px-5 py-4">
          <h2 className="text-[15px] font-semibold">Hoy</h2>
          <ul className="mt-2 space-y-1.5">
            {datos.hoy.map((o) => (
              <li key={o.id} className="text-[13.5px]">
                {o.nombre} <span className="text-slate-500">· {o.responsable}</span>
                <PrimaryButton
                  type="button"
                  onClick={() => void marcarHecha(o.id)}
                  className="ml-3 !inline-flex !h-8 !w-auto !px-3 !text-[12px]"
                >
                  Hecha
                </PrimaryButton>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ── El catálogo, por familia ──────────────────────────────── */}
      {FAMILIAS.map((familia) => {
        const suyas = datos.obligaciones.filter((o) => o.family === familia);
        if (suyas.length === 0) return null;
        return (
          <section key={familia} className="mb-5">
            <h2 className="mb-2 text-[15px] font-semibold text-mipiace-ink">
              {NOMBRE_DE_LA_FAMILIA[familia]}
            </h2>
            <ul className="space-y-2">
              {suyas.map((o) => (
                <li
                  key={o.id}
                  className={`rounded-2xl border px-4 py-3 text-[13.5px] ${
                    o.active
                      ? "border-slate-200 bg-white"
                      : "border-slate-200 bg-slate-50 text-slate-400"
                  }`}
                >
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span
                      className={`shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${colorDeLaConsecuencia(
                        o.consequence,
                      )}`}
                    >
                      {NOMBRE_DE_LA_CONSECUENCIA[o.consequence]}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setParams(abierta === o.id ? {} : { duty: o.id })
                      }
                      className="font-medium underline"
                    >
                      {o.name}
                    </button>
                    <span className="text-slate-500">
                      {o.periodicidadEnPalabras}
                    </span>
                    {o.periodicityToVerify && (
                      <span className="rounded-md bg-amber-100 px-2 py-0.5 text-[11.5px] text-amber-900">
                        periodicidad por verificar
                      </span>
                    )}
                    <span className="ml-auto text-slate-500">
                      {o.responsable}
                    </span>
                  </div>
                  {o.notes && (
                    <p className="mt-1 text-[12.5px] text-slate-500">{o.notes}</p>
                  )}

                  {/* Las ocurrencias de la que está abierta */}
                  {abierta === o.id && (
                    <div className="mt-3 border-t border-slate-200 pt-3">
                      {ocurrencias == null ? (
                        <p className="text-[13px] text-slate-500">Cargando…</p>
                      ) : ocurrencias.length === 0 ? (
                        <p className="text-[13px] text-slate-500">
                          Todavía no hay ninguna ocurrencia generada.
                        </p>
                      ) : (
                        <ul className="space-y-1.5">
                          {ocurrencias.slice(0, 40).map((oc) => (
                            <li
                              key={oc.id}
                              className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]"
                            >
                              <span className="w-24 shrink-0 tabular-nums">
                                {dia(oc.dueOn)}
                              </span>
                              {oc.hecha ? (
                                <>
                                  <span className="rounded-md bg-emerald-100 px-2 py-0.5 text-[11.5px] text-emerald-800">
                                    Hecha
                                  </span>
                                  <span className="text-slate-600">
                                    {oc.hechaPor}
                                    {/* **La capacidad, no sólo la
                                        persona** (D-31): «la marcó Ana
                                        Isabel, como responsable de
                                        calidad» es lo que es evidencia. */}
                                    {oc.hechaComo ? `, como ${oc.hechaComo}` : ""}
                                    {oc.hechaEn ? ` · ${hora(oc.hechaEn)}` : ""}
                                  </span>
                                  {oc.tieneEvidencia ? (
                                    <a
                                      href={`/api/residencia/ocurrencias/${oc.id}/evidencia`}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="underline"
                                    >
                                      ver el documento
                                    </a>
                                  ) : (
                                    <label className="cursor-pointer underline">
                                      adjuntar PDF
                                      <input
                                        type="file"
                                        accept="application/pdf"
                                        className="hidden"
                                        onChange={(e) => {
                                          const f = e.target.files?.[0];
                                          if (f) void subirEvidencia(oc.id, f);
                                        }}
                                      />
                                    </label>
                                  )}
                                  <button
                                    type="button"
                                    onClick={() => void corregir(oc.id)}
                                    className="text-slate-400 underline"
                                  >
                                    deshacer
                                  </button>
                                </>
                              ) : (
                                <>
                                  <OutlineButton
                                    type="button"
                                    onClick={() => void marcarHecha(oc.id)}
                                    className="!inline-flex !h-8 !w-auto !px-3 !text-[12px]"
                                  >
                                    Marcar hecha
                                  </OutlineButton>
                                  {oc.corregidaEn && (
                                    <span className="text-[12.5px] text-slate-500">
                                      se deshizo el {hora(oc.corregidaEn)} ·{" "}
                                      {oc.corregidaPor} ·{" "}
                                      {oc.motivoDeCorreccion}
                                    </span>
                                  )}
                                </>
                              )}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </section>
        );
      })}

      {laAbierta == null && datos.obligaciones.length === 0 && (
        <p className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-[13.5px] text-slate-500">
          Este centro no tiene ninguna obligación todavía. Carga el catálogo
          base y ajústalo.
        </p>
      )}
    </AdminShell>
  );
}

/** El PDF en base64, sin la cabecera `data:`. Igual que la foto de la
 *  ficha del residente (residencia-3) y por lo mismo: un `multipart`
 *  obligaría a montar el plugin de subida para un endpoint. */
function aBase64(f: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = String(r.result);
      resolve(s.slice(s.indexOf(",") + 1));
    };
    r.onerror = () => reject(r.error ?? new Error("no se pudo leer el fichero"));
    r.readAsDataURL(f);
  });
}
