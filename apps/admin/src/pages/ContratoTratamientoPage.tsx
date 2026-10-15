// clinica-7 · «Contrato de tratamiento de datos», en el panel.
//
// Decisión 6: la sección del propietario con la versión vigente, cuándo y
// quién la aceptó, el PDF de cada versión aceptada (para descargar
// siempre) y el botón «Revocar» con una confirmación que explica las
// consecuencias.
//
// ── Por qué vive aquí y no solo en el TPV ───────────────────────────
//
// Porque el TPV es un punto de venta y no tiene pantalla de ajustes: lo
// que la dueña hace en la tablet es trabajar. El contrato de encargado se
// lee con calma, se descarga en PDF y se le manda a un abogado — eso se
// hace en el panel, sentada, con el ordenador.
//
// En el TPV sí están las dos caras que hacen falta con la paciente
// delante: la pantalla de aceptación (si falta aceptarlo, la historia no se
// abre sin ella) y la banda de solo lectura. Ésas viven en
// `apps/tpv-web/src/clinica/ContratoDeTratamiento.tsx`.
//
// ── Y la lógica NO se duplica ───────────────────────────────────────
//
// El estado lo calcula `@mipiacetpv/contrato-encargado` —la MISMA función
// pura que usa la API y que usa el TPV— y los textos vienen de ahí. Lo que
// esta pantalla tiene propio es el HTML: dos apps que no comparten paquete
// de UI pintan distinto, y eso está bien. Lo que no puede haber es dos
// reglas sobre cuándo un contrato está vigente, y no las hay.
//
// ── Sin `CajaGate` ──────────────────────────────────────────────────
//
// Como la declaración responsable: esto no depende de que el comercio haya
// comprado la caja. Lo que decide si la sección existe es la capability de
// la historia clínica, y eso lo contesta la API con un 404 — y entonces la
// pantalla dice que el módulo no está, que es la verdad.

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  Check,
  Download,
  Lock,
  ShieldCheck,
} from "lucide-react";

import type { EstadoDelModuloClinico } from "@mipiacetpv/contrato-encargado";

import { AdminShell } from "../AdminShell.js";
import { ApiError, api, apiBlob } from "../api.js";
import { CenteredLoader, FieldError } from "../ui.js";

interface Aceptacion {
  id: string;
  version: number;
  huella: string;
  aceptadoEn: string;
  quien: string;
  aparato: string | null;
  revocado: boolean;
  revocadoEn: string | null;
  revocadoPor: string | null;
  textoDisponible: boolean;
}

interface Vista {
  estado: EstadoDelModuloClinico;
  versionVigente: number;
  pendienteDeValidar: boolean;
  titulo: string;
  apartados: { encabezado: string; parrafos: string[] }[];
  huellaVigente: string;
  aceptaciones: Aceptacion[];
  puedeAceptar: boolean;
}

const fecha = (iso: string) =>
  new Date(iso).toLocaleString("es-ES", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

export function ContratoTratamientoPage() {
  const [vista, setVista] = useState<Vista | null>(null);
  const [sinModulo, setSinModulo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [accion, setAccion] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState(false);
  const [trabajando, setTrabajando] = useState(false);
  const [leido, setLeido] = useState(false);

  const cargar = useCallback(() => {
    api<Vista>("/clinica/contrato")
      .then((v) => {
        setVista(v);
        setSinModulo(false);
        setError(null);
      })
      .catch((err: unknown) => {
        // 404 = este negocio no tiene el módulo clínico. No es un error:
        // es que la sección no aplica, y se dice.
        if (err instanceof ApiError && err.status === 404) {
          setSinModulo(true);
          return;
        }
        setError(
          "No se ha podido cargar el contrato de tratamiento de datos. " +
            "Recarga la página; si sigue, avisa a Mi Piace.",
        );
      });
  }, []);

  useEffect(cargar, [cargar]);

  async function aceptar() {
    setTrabajando(true);
    setAccion(null);
    try {
      await api("/clinica/contrato/aceptar", { method: "POST", body: {} });
      setLeido(false);
      cargar();
    } catch (err) {
      setAccion(
        err instanceof ApiError && err.message
          ? err.message
          : "No se ha podido aceptar. Reintenta; si sigue, avisa a Mi Piace.",
      );
    } finally {
      setTrabajando(false);
    }
  }

  async function revocar() {
    setTrabajando(true);
    setAccion(null);
    try {
      await api("/clinica/contrato/revocar", { method: "POST" });
      setConfirmando(false);
      cargar();
    } catch (err) {
      setAccion(
        err instanceof ApiError && err.message
          ? err.message
          : "No se ha podido revocar. Reintenta; si sigue, avisa a Mi Piace.",
      );
    } finally {
      setTrabajando(false);
    }
  }

  async function abrirPdf(version: number) {
    setAccion(null);
    try {
      const blob = await apiBlob(`/clinica/contrato/${version}.pdf`);
      window.open(URL.createObjectURL(blob), "_blank", "noopener,noreferrer");
    } catch {
      setAccion("No se ha podido abrir el PDF. Reintenta más tarde.");
    }
  }

  async function exportar() {
    setAccion(null);
    try {
      const blob = await apiBlob("/clinica/exportacion");
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `historias-${new Date().toISOString().slice(0, 10)}.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setAccion(
        err instanceof ApiError && err.message
          ? err.message
          : "No se ha podido preparar el paquete. Avisa a Mi Piace.",
      );
    }
  }

  if (sinModulo) {
    return (
      <AdminShell title="Contrato de tratamiento de datos">
        <p className="text-[13.5px] text-slate-600 leading-relaxed">
          Este negocio no tiene el módulo de historia clínica. Si lo
          necesitas, pídelo a Mi Piace.
        </p>
      </AdminShell>
    );
  }
  if (error) {
    return (
      <AdminShell title="Contrato de tratamiento de datos">
        <FieldError message={error} />
      </AdminShell>
    );
  }
  if (!vista) {
    return (
      <AdminShell title="Contrato de tratamiento de datos">
        <CenteredLoader label="Cargando el contrato…" />
      </AdminShell>
    );
  }

  const vigente = vista.estado.estado === "VIGENTE";
  const sinAceptar = vista.estado.estado === "SIN_CONTRATO";

  return (
    <AdminShell title="Contrato de tratamiento de datos">
      <div className="max-w-[760px] space-y-5" data-test="contrato-seccion">
        <p className="text-[13.5px] text-slate-600 leading-relaxed">
          Es el contrato por el que Mi Piace puede guardar la historia
          clínica de tus pacientes (art. 28 del RGPD). Lo acepta la dueña del
          centro, y mientras no esté aceptado la historia clínica no se
          puede usar.
        </p>

        {/* ── El estado, de un vistazo ────────────────────────────── */}
        <div
          data-test="contrato-estado"
          className={`flex items-start gap-2.5 rounded-xl border px-3.5 py-3 text-[13.5px] leading-relaxed ${
            vigente
              ? "border-emerald-200 bg-emerald-50 text-emerald-900"
              : "border-amber-200 bg-amber-50 text-amber-900"
          }`}
        >
          {vigente ? (
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          ) : (
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          )}
          <span>
            {vista.estado.estado === "VIGENTE" && (
              <>
                <strong className="font-semibold">Vigente</strong> — versión{" "}
                {vista.estado.versionAceptada}. La historia clínica funciona
                con normalidad.
              </>
            )}
            {vista.estado.estado === "SIN_CONTRATO" && (
              <>
                <strong className="font-semibold">Sin aceptar.</strong> Hasta
                que lo aceptes, la historia clínica no se puede ni leer ni
                escribir.
              </>
            )}
            {vista.estado.estado === "SOLO_LECTURA" && (
              <>
                <strong className="font-semibold">Solo lectura</strong> —{" "}
                {vista.estado.motivo === "REVOCADO"
                  ? "está revocado"
                  : "hay una versión nueva sin aceptar"}
                . Se puede leer, imprimir y exportar todo lo que ya hay; no
                se puede escribir nada nuevo. Las citas nuevas no admiten
                notas escritas a mano.
              </>
            )}
            {vista.estado.estado === "APAGADO" && (
              <strong className="font-semibold">Módulo apagado.</strong>
            )}
          </span>
        </div>

        <FieldError message={accion} />

        {/* ── El texto, y el botón si falta aceptarlo ─────────────── */}
        {(sinAceptar || vista.estado.estado === "SOLO_LECTURA") &&
          vista.puedeAceptar && (
            <section className="rounded-xl border border-slate-200 bg-white p-4">
              <h2 className="text-[14px] font-semibold text-mipiace-ink">
                {vista.titulo}
              </h2>
              <p className="mt-0.5 text-[12.5px] text-slate-500">
                Versión {vista.versionVigente}
              </p>

              {vista.pendienteDeValidar && (
                <div className="mt-3 flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-[13px] leading-relaxed text-amber-900">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                  <span>
                    <strong className="font-semibold">
                      Este texto es de ejemplo y está pendiente de que lo
                      revise un abogado.
                    </strong>{" "}
                    Puedes aceptarlo para empezar a usar la historia clínica;
                    cuando llegue el definitivo te pediremos aceptar la
                    versión nueva.
                  </span>
                </div>
              )}

              <div className="mt-4 max-h-[420px] space-y-4 overflow-y-auto pr-1">
                {vista.apartados.map((a) => (
                  <div key={a.encabezado}>
                    <h3 className="text-[13px] font-semibold leading-snug text-mipiace-ink">
                      {a.encabezado}
                    </h3>
                    <div className="mt-1.5 space-y-2">
                      {a.parrafos.map((p, i) => (
                        <p
                          key={i}
                          className="text-[13px] leading-relaxed text-slate-700"
                        >
                          {p}
                        </p>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              <p className="mt-3 break-all text-[11.5px] text-slate-400">
                Huella del texto (SHA-256): {vista.huellaVigente}
              </p>

              <label className="mt-4 flex cursor-pointer items-start gap-2.5 text-[13.5px] leading-relaxed text-mipiace-ink">
                <input
                  type="checkbox"
                  checked={leido}
                  onChange={(e) => setLeido(e.target.checked)}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-mipiace-ink"
                />
                He leído el contrato y lo acepto en nombre del centro.
              </label>

              <button
                type="button"
                disabled={!leido || trabajando}
                onClick={() => void aceptar()}
                data-test="contrato-aceptar"
                className="mt-4 inline-flex min-h-[40px] items-center gap-2 rounded-lg bg-mipiace-ink px-4 text-[13.5px] font-semibold text-white disabled:opacity-40"
              >
                <Check className="h-4 w-4" aria-hidden />
                Aceptar y activar la historia clínica
              </button>

              <p className="mt-2.5 text-[12.5px] leading-relaxed text-slate-500">
                Al aceptar queda registrado quién lo acepta, cuándo y desde
                dónde. Esa anotación no se puede editar ni borrar.
              </p>
            </section>
          )}

        {!vista.puedeAceptar && sinAceptar && (
          <div className="flex items-start gap-2.5 rounded-xl border border-slate-200 bg-white px-3.5 py-3 text-[13.5px] leading-relaxed text-slate-700">
            <Lock className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden />
            La dueña tiene que aceptar el contrato de tratamiento de datos
            antes de usar la historia clínica.
          </div>
        )}

        {/* ── El historial ───────────────────────────────────────── */}
        <section>
          <h2 className="text-[14px] font-semibold text-mipiace-ink">
            Lo que se ha aceptado
          </h2>
          {vista.aceptaciones.length === 0 ? (
            <p className="mt-2 text-[13.5px] text-slate-600">
              Todavía no se ha aceptado ninguna versión.
            </p>
          ) : (
            <ul className="mt-2.5 space-y-2.5">
              {vista.aceptaciones.map((a) => (
                <li
                  key={a.id}
                  className="rounded-xl border border-slate-200 bg-white p-3.5"
                >
                  <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                    <span className="text-[13.5px] font-semibold text-mipiace-ink">
                      Versión {a.version}
                    </span>
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[12px] font-medium ${
                        a.revocado
                          ? "border-amber-200 bg-amber-50 text-amber-800"
                          : "border-emerald-200 bg-emerald-50 text-emerald-800"
                      }`}
                    >
                      {a.revocado ? "Revocado" : "En vigor"}
                    </span>
                  </div>
                  <p className="mt-1.5 text-[13px] leading-relaxed text-slate-700">
                    Aceptado por {a.quien} el {fecha(a.aceptadoEn)}
                    {a.aparato ? ` desde ${a.aparato}` : ""}.
                  </p>
                  {a.revocado && a.revocadoEn && (
                    <p className="text-[13px] leading-relaxed text-slate-700">
                      Revocado por {a.revocadoPor} el {fecha(a.revocadoEn)}.
                    </p>
                  )}
                  <p className="mt-1.5 break-all text-[11.5px] text-slate-400">
                    Huella: {a.huella}
                  </p>
                  {a.textoDisponible ? (
                    <button
                      type="button"
                      onClick={() => void abrirPdf(a.version)}
                      className="mt-2.5 inline-flex min-h-[36px] items-center gap-2 rounded-lg border border-slate-200 px-3 text-[13px] font-medium text-mipiace-ink"
                    >
                      <Download className="h-4 w-4" aria-hidden />
                      Descargar el PDF
                    </button>
                  ) : (
                    <p className="mt-2 text-[12.5px] leading-relaxed text-slate-500">
                      Este programa ya no tiene el texto de esta versión. Lo
                      que demuestra qué se aceptó es su huella y su fecha.
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ── Revocar ────────────────────────────────────────────── */}
        {vigente && (
          <section className="rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="text-[14px] font-semibold text-mipiace-ink">
              Revocar el contrato
            </h2>
            {!confirmando ? (
              <>
                <p className="mt-1.5 text-[13.5px] leading-relaxed text-slate-600">
                  Si revocas, la historia clínica pasa a solo lectura. Puedes
                  volver a aceptarlo cuando quieras.
                </p>
                <button
                  type="button"
                  onClick={() => setConfirmando(true)}
                  data-test="contrato-revocar"
                  className="mt-3 inline-flex min-h-[40px] items-center rounded-lg border border-rose-300 px-4 text-[13.5px] font-medium text-rose-800"
                >
                  Revocar el contrato
                </button>
              </>
            ) : (
              <>
                <p className="mt-1.5 text-[13.5px] font-semibold text-mipiace-ink">
                  ¿Seguro? Esto es lo que pasa:
                </p>
                <ul className="mt-2 list-disc space-y-1.5 pl-5 text-[13px] leading-relaxed text-slate-700">
                  <li>
                    La historia clínica pasa a <strong>solo lectura</strong>:
                    se puede leer, imprimir y exportar todo lo que ya hay.
                  </li>
                  <li>
                    <strong>
                      No se podrá escribir nada clínico nuevo
                    </strong>
                    : ni sesiones, ni fotos, ni valoraciones, ni
                    consentimientos.
                  </li>
                  <li>
                    Las citas nuevas no admitirán notas escritas a mano: solo
                    hora, paciente y servicio.
                  </li>
                  <li>La agenda y la caja siguen funcionando igual.</li>
                  <li>Puedes volver a aceptarlo cuando quieras.</li>
                </ul>
                <div className="mt-3 flex flex-wrap gap-2.5">
                  <button
                    type="button"
                    disabled={trabajando}
                    onClick={() => void revocar()}
                    className="inline-flex min-h-[40px] items-center rounded-lg bg-rose-700 px-4 text-[13.5px] font-semibold text-white disabled:opacity-40"
                  >
                    Sí, revocarlo
                  </button>
                  <button
                    type="button"
                    disabled={trabajando}
                    onClick={() => setConfirmando(false)}
                    className="inline-flex min-h-[40px] items-center rounded-lg border border-slate-200 px-4 text-[13.5px] font-medium text-mipiace-ink"
                  >
                    No, dejarlo como está
                  </button>
                </div>
              </>
            )}
          </section>
        )}

        {/* ── Y la devolución de datos ───────────────────────────── */}
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="text-[14px] font-semibold text-mipiace-ink">
            Llevarte todas las historias
          </h2>
          <p className="mt-1.5 text-[13.5px] leading-relaxed text-slate-600">
            Descarga un paquete con la historia completa de cada paciente en
            PDF, sus fotos, sus consentimientos y un fichero con todos los
            datos en formato legible por máquina. Es la devolución de datos
            del art. 28.3.g del RGPD: funciona también con el contrato
            revocado, y queda registrada paciente a paciente.
          </p>
          <button
            type="button"
            onClick={() => void exportar()}
            data-test="contrato-exportar"
            className="mt-3 inline-flex min-h-[40px] items-center gap-2 rounded-lg border border-slate-200 px-4 text-[13.5px] font-medium text-mipiace-ink"
          >
            <Download className="h-4 w-4" aria-hidden />
            Descargar todas las historias
          </button>
        </section>
      </div>
    </AdminShell>
  );
}
