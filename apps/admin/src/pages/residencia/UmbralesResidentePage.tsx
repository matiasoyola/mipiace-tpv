// residencia-4 (D-22) · **LA EXCEPCIÓN DE UMBRAL DE UN RESIDENTE.**
//
// Lo único que puede cambiar un umbral clínico, y **sólo la pauta un rol
// `MEDICO`**. Un hipertenso crónico, un paliativo o alguien con
// hipotermia habitual tienen rangos propios: el mecanismo es genérico, el
// valor distinto es un dato clínico suyo (rama de controles §5).
//
// ── EL BOTÓN NO SE ESCONDE: SE EXPLICA ──────────────────────────────
//
// Quien entra sin el rol de médico ve la pantalla entera —las excepciones
// vigentes, su motivo, quién las firmó— y el formulario deshabilitado con
// la frase. Esconderlo habría significado que la DUE que abre esto no
// sabe si no existe la función o si no es para ella, y acaba llamando por
// teléfono.
//
// El servidor lo rechaza igual (`EXCEPCION_ES_DEL_MEDICO`), que es donde
// vive la regla. Lo de aquí es para no llegar al rechazo.
//
// ── SUSTITUYE, NO SE SUMA ───────────────────────────────────────────
//
// Mientras está vigente, las reglas de serie de ese control **no se
// aplican** a este residente: las suyas son las que se escriben aquí. Y
// **dejarlas vacías es una pauta válida**: «a doña Carmen no le abráis
// incidencia por la tensión, la tiene así desde 2019». La pantalla lo
// dice con esas palabras, porque un formulario con cero filas parece un
// formulario a medio rellenar.

import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Plus, Trash2 } from "lucide-react";

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
  type Capacidad,
  type ExcepcionDeUmbral,
  type Nivel,
} from "./incidencias-lib.js";

/** Las constantes que la plantilla gradúa. No se piden al servidor: son
 *  los códigos del catálogo de serie, y una excepción sobre un control
 *  que no gradúa nada no tiene sentido (no habría nada que sustituir). */
const CONSTANTES = [
  { code: "TEMPERATURA", nombre: "Temperatura", unidad: "°C", tipo: "FIEBRE" },
  { code: "SATURACION_O2", nombre: "Saturación", unidad: "%", tipo: "HIPOXIA" },
  { code: "TA_SISTOLICA", nombre: "Tensión sistólica", unidad: "mmHg", tipo: "TENSION" },
  { code: "GLUCEMIA", nombre: "Glucemia", unidad: "mg/dl", tipo: "GLUCEMIA" },
];

const NIVELES: Nivel[] = ["N1", "N2", "N3", "N4"];

interface ReglaEnEdicion {
  comparador: "GTE" | "GT" | "LTE" | "LT";
  valor: string;
  nivel: Nivel;
}

export function UmbralesResidentePage() {
  const { clientId } = useParams<{ clientId: string }>();
  const [excepciones, setExcepciones] = useState<ExcepcionDeUmbral[] | null>(
    null,
  );
  const [capacidades, setCapacidades] = useState<Capacidad[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [control, setControl] = useState(CONSTANTES[0]!.code);
  const [motivo, setMotivo] = useState("");
  const [hasta, setHasta] = useState("");
  const [reglas, setReglas] = useState<ReglaEnEdicion[]>([
    { comparador: "GTE", valor: "", nivel: "N2" },
  ]);

  const recargar = useCallback(async () => {
    try {
      const r = await api<{
        excepciones: ExcepcionDeUmbral[];
        capacidades: Capacidad[];
      }>(`/residencia/residentes/${clientId}/umbrales`);
      setExcepciones(r.excepciones);
      setCapacidades(r.capacidades);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Error inesperado");
      setExcepciones([]);
    }
  }, [clientId]);

  useEffect(() => {
    void recargar();
  }, [recargar]);

  if (!excepciones) return <CenteredLoader label="Cargando los umbrales…" />;

  const esMedico = capacidades.some((c) => c.code === "MEDICO");
  const elegida = CONSTANTES.find((c) => c.code === control)!;

  async function pautar() {
    try {
      await api(`/residencia/residentes/${clientId}/umbrales`, {
        method: "POST",
        body: {
          control,
          motivo: motivo.trim(),
          hasta: hasta ? new Date(hasta).toISOString() : null,
          reglas: reglas
            .filter((r) => r.valor.trim() !== "")
            .map((r) => ({
              comparador: r.comparador,
              valor: Number(r.valor.replace(",", ".")),
              nivel: r.nivel,
              tipo: elegida.tipo,
            })),
          careRoleAssignmentId: capacidades.find((c) => c.code === "MEDICO")
            ?.assignmentId,
        },
      });
      setMotivo("");
      setHasta("");
      setReglas([{ comparador: "GTE", valor: "", nivel: "N2" }]);
      await recargar();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Error inesperado");
    }
  }

  async function retirar(id: string) {
    try {
      await api(`/residencia/residentes/${clientId}/umbrales/${id}`, {
        method: "DELETE",
      });
      await recargar();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Error inesperado");
    }
  }

  return (
    <AdminShell title="Umbrales propios">
      <Link
        to={`/admin/residencia/residentes/${clientId}/plan`}
        className="mb-4 inline-block text-[13.5px] text-slate-500 hover:underline"
      >
        ← Volver al plan de cuidados
      </Link>

      <p className="-mt-1 mb-5 text-[13.5px] text-slate-500">
        Los umbrales de serie valen para todos. Aquí se pauta la excepción
        de esta persona: sustituye a la de serie mientras esté vigente y,
        cuando caduque, vuelve la de serie sin que nadie haga nada.
      </p>

      {error && <FieldError message={error} />}

      {excepciones.length === 0 ? (
        <p className="rounded-2xl border border-slate-200 bg-white px-5 py-4 text-[13.5px] text-slate-500">
          Sin excepciones: a esta persona se le aplican los umbrales de
          serie.
        </p>
      ) : (
        <ul className="space-y-2">
          {excepciones.map((e) => (
            <li
              key={e.id}
              className={`rounded-2xl border px-4 py-3 text-[13.5px] ${
                e.revocadaEn
                  ? "border-slate-200 bg-slate-50 text-slate-500"
                  : "border-slate-200 bg-white"
              }`}
            >
              <div className="flex flex-wrap items-center gap-3">
                <span className="font-medium">{e.control}</span>
                {e.revocadaEn ? (
                  <span className="rounded-md bg-slate-200 px-2 py-0.5 text-[12.5px]">
                    retirada
                  </span>
                ) : (
                  <span className="rounded-md bg-emerald-50 px-2 py-0.5 text-[12.5px] text-emerald-800">
                    vigente
                  </span>
                )}
                <span className="text-slate-500">
                  desde {fechaYHora(e.desde)}
                  {e.hasta ? ` hasta ${fechaYHora(e.hasta)}` : " · sin fin"}
                </span>
                {!e.revocadaEn && (
                  <button
                    type="button"
                    onClick={() => void retirar(e.id)}
                    className="ml-auto flex items-center gap-1 text-[13px] text-slate-500 underline"
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Retirar
                  </button>
                )}
              </div>
              {e.motivo && <p className="mt-1">{e.motivo}</p>}
              <p className="mt-1">
                {e.reglas.length === 0 ? (
                  <span className="text-slate-500">
                    Sin reglas: esta constante no abre incidencia para esta
                    persona.
                  </span>
                ) : (
                  e.reglas.map((r, i) => (
                    <span key={i} className="mr-3">
                      {simbolo(r.comparador)}{" "}
                      {String(r.valor).replace(".", ",")} →{" "}
                      <span
                        className={`rounded px-1.5 py-0.5 text-[12.5px] font-semibold ${colorDelNivel(r.nivel)}`}
                      >
                        {r.nivel}
                      </span>
                    </span>
                  ))
                )}
              </p>
              <p className="mt-1 text-slate-500">
                La firmó {e.firmadaPor} ({e.firmadaComo}) el{" "}
                {fechaYHora(e.firmadaEn)}
              </p>
            </li>
          ))}
        </ul>
      )}

      {/* ── Pautar una nueva ─────────────────────────────────────── */}
      <section className="mt-6 rounded-2xl border border-slate-200 bg-white px-5 py-4">
        <h2 className="text-[16px] font-semibold text-mipiace-ink">
          Pautar una excepción
        </h2>
        {!esMedico && (
          <p className="mt-2 rounded-xl bg-amber-50 px-4 py-3 text-[13.5px] text-amber-900">
            Una excepción de umbral es una prescripción médica:{" "}
            <strong>sólo la pauta quien entra con el rol de médico</strong>{" "}
            (D-22). Puedes ver las que haya, no crear una.
          </p>
        )}

        <fieldset disabled={!esMedico} className="mt-3 space-y-3">
          <label className="block text-[13px] text-slate-600">
            Constante
            <select
              value={control}
              onChange={(e) => setControl(e.target.value)}
              className="ml-2 h-10 rounded-lg border border-slate-300 px-3 text-[13.5px]"
            >
              {CONSTANTES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.nombre} ({c.unidad})
                </option>
              ))}
            </select>
          </label>

          <TextField
            id="excepcion-motivo"
            label="Pauta (por qué)"
            value={motivo}
            onChange={setMotivo}
            placeholder="paliativo, febrícula basal de 37,8"
          />

          <TextField
            id="excepcion-hasta"
            label="Hasta (opcional)"
            type="date"
            value={hasta}
            onChange={setHasta}
          />

          <div>
            <p className="text-[13px] font-medium text-mipiace-ink-soft">
              Sus bandas
            </p>
            <p className="text-[12.5px] text-slate-500">
              Déjalo vacío para que esta constante no le abra ninguna
              incidencia.
            </p>
            <div className="mt-2 space-y-2">
              {reglas.map((r, i) => (
                <div key={i} className="flex flex-wrap items-center gap-2">
                  <select
                    value={r.comparador}
                    onChange={(e) =>
                      setReglas((prev) =>
                        prev.map((x, j) =>
                          j === i
                            ? { ...x, comparador: e.target.value as ReglaEnEdicion["comparador"] }
                            : x,
                        ),
                      )
                    }
                    className="h-10 rounded-lg border border-slate-300 px-2 text-[14px]"
                  >
                    <option value="GTE">≥</option>
                    <option value="GT">&gt;</option>
                    <option value="LTE">≤</option>
                    <option value="LT">&lt;</option>
                  </select>
                  <input
                    value={r.valor}
                    onChange={(e) =>
                      setReglas((prev) =>
                        prev.map((x, j) =>
                          j === i ? { ...x, valor: e.target.value } : x,
                        ),
                      )
                    }
                    inputMode="decimal"
                    placeholder="38,5"
                    className="h-10 w-24 rounded-lg border border-slate-300 px-3 text-center text-[14px] tabular-nums"
                  />
                  <span className="text-[13px] text-slate-500">
                    {elegida.unidad} →
                  </span>
                  <select
                    value={r.nivel}
                    onChange={(e) =>
                      setReglas((prev) =>
                        prev.map((x, j) =>
                          j === i ? { ...x, nivel: e.target.value as Nivel } : x,
                        ),
                      )
                    }
                    className="h-10 rounded-lg border border-slate-300 px-2 text-[14px]"
                  >
                    {NIVELES.map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() =>
                      setReglas((prev) => prev.filter((_, j) => j !== i))
                    }
                    className="text-[13px] text-slate-500 underline"
                  >
                    Quitar
                  </button>
                </div>
              ))}
            </div>
            <OutlineButton
              type="button"
              onClick={() =>
                setReglas((prev) => [
                  ...prev,
                  { comparador: "GTE", valor: "", nivel: "N2" },
                ])
              }
              className="mt-2 !h-9 !w-auto !px-3 !text-[13px]"
            >
              <Plus className="h-3.5 w-3.5" /> Otra banda
            </OutlineButton>
          </div>

          <div className="flex justify-end">
            <PrimaryButton
              type="button"
              disabled={!esMedico || motivo.trim() === ""}
              onClick={() => void pautar()}
              className="!h-10 !w-auto !px-4 !text-[13.5px]"
            >
              Pautar
            </PrimaryButton>
          </div>
        </fieldset>
      </section>
    </AdminShell>
  );
}

function simbolo(c: string): string {
  switch (c) {
    case "GTE":
      return "≥";
    case "GT":
      return ">";
    case "LTE":
      return "≤";
    default:
      return "<";
  }
}
