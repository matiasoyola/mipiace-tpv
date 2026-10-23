// historia-1 (D-92, D-93, D-97) · **LAS AUSENCIAS DE UN RESIDENTE Y SUS
// DÍAS DEL MES.**
//
// Dos cosas en una pantalla porque son la misma conversación: «¿cuándo
// estuvo fuera?» y «¿cuántos días le facturamos a la Junta este mes?».
// Separarlas habría obligado a abrir dos pantallas para cuadrar un mes.
//
// ── LO QUE ESTA PANTALLA CAMBIA EN EL RESTO DEL PRODUCTO ────────────
//
// Se dice arriba, con esas palabras, porque no es obvio y es la mitad del
// valor de D-92: apuntar una ausencia **pausa los cuidados** —no salen
// como no hechos—, saca al residente del denominador de los indicadores y
// lo pinta como ausente en la puerta. Quien apunta una ausencia tiene que
// saber que está haciendo las cuatro cosas.
//
// ── Y LA REGLA DE LOS DÍAS FRONTERA, DICHA ──────────────────────────
//
// De serie se cuenta **dónde pernocta el residente** (D-93): el día del
// ingreso cuenta y el día del alta no. Es dato por comunidad autónoma y
// está por contrastar con la Junta, así que la pantalla lo dice en vez de
// dejar que alguien dé por hecho otra cosa — un número de facturación sin
// su regla al lado es un número que se copia mal.

import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { AlertTriangle } from "lucide-react";

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
  fechaLarga,
  mesDeHoy,
  mesDesplazado,
  mesEnPalabras,
  NOMBRE_DE_LA_AUSENCIA,
  type AusenciaDeLaFicha,
  type DiasDelMes,
} from "./ficha-lib.js";

const TIPOS: Array<AusenciaDeLaFicha["tipo"]> = [
  "INGRESO_HOSPITALARIO",
  "URGENCIAS",
  "VACACIONES_FAMILIA",
  "CONSULTA_EXTERNA",
  "SALIDA_NO_CONTROLADA",
];

/** «YYYY-MM-DDTHH:MM» para un `datetime-local`, de ahora. */
function ahoraLocal(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function AusenciasResidentePage() {
  const { clientId } = useParams<{ clientId: string }>();
  const [ausencias, setAusencias] = useState<AusenciaDeLaFicha[] | null>(null);
  const [mes, setMes] = useState(mesDeHoy());
  const [dias, setDias] = useState<DiasDelMes | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [tipo, setTipo] = useState<AusenciaDeLaFicha["tipo"]>(
    "INGRESO_HOSPITALARIO",
  );
  const [desde, setDesde] = useState(ahoraLocal());
  const [finPrevisto, setFinPrevisto] = useState("");
  const [destino, setDestino] = useState("");
  const [motivo, setMotivo] = useState("");

  const recargar = useCallback(async () => {
    try {
      const [a, d] = await Promise.all([
        api<{ ausencias: AusenciaDeLaFicha[] }>(
          `/residencia/residentes/${clientId}/ausencias`,
        ),
        api<{ dias: DiasDelMes }>(
          `/residencia/residentes/${clientId}/dias?mes=${mes}`,
        ),
      ]);
      setAusencias(a.ausencias);
      setDias(d.dias);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Error inesperado");
      setAusencias([]);
    }
  }, [clientId, mes]);

  useEffect(() => {
    void recargar();
  }, [recargar]);

  if (!ausencias) return <CenteredLoader label="Cargando las ausencias…" />;

  const abierta = ausencias.find((a) => a.abierta) ?? null;

  async function llamar(ruta: string, body?: unknown) {
    try {
      await api(`/residencia/residentes/${clientId}${ruta}`, {
        method: "POST",
        ...(body === undefined ? {} : { body }),
      });
      setError(null);
      await recargar();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Error inesperado");
    }
  }

  return (
    <AdminShell title="Ausencias">
      <Link
        to={`/admin/residencia/residentes/${clientId}/ficha`}
        className="mb-4 inline-block text-[13.5px] text-slate-500 hover:underline"
      >
        ← Volver a la ficha clínica
      </Link>

      <p className="-mt-1 mb-5 text-[13.5px] text-slate-500">
        Mientras una ausencia está abierta, a esta persona{" "}
        <strong>no le toca nada</strong>: no salen cuidados sin hacer, sale
        como ausente en la puerta y no entra en el denominador de los
        indicadores. Los días quedan contados abajo.
      </p>

      {error && <FieldError message={error} />}

      {/* ── LA ABIERTA, ARRIBA ──────────────────────────────────── */}
      {abierta ? (
        <section className="mb-6 rounded-2xl border-2 border-sky-300 bg-sky-50 px-5 py-4">
          <h2 className="text-[15px] font-semibold text-sky-900">
            Ahora mismo está fuera: {NOMBRE_DE_LA_AUSENCIA[abierta.tipo]}
          </h2>
          <p className="mt-1 text-[13.5px] text-sky-900">
            Desde el {fechaLarga(abierta.desde)}
            {abierta.destino ? ` · ${abierta.destino}` : ""}
            {abierta.finPrevisto
              ? ` · se esperaba de vuelta el ${fechaLarga(abierta.finPrevisto)}`
              : ""}
          </p>
          <div className="mt-3">
            <PrimaryButton
              onClick={() => {
                const cuando = window.prompt(
                  "¿Cuándo ha vuelto? (AAAA-MM-DDTHH:MM)",
                  ahoraLocal(),
                );
                if (cuando == null || cuando.trim() === "") return;
                void llamar(`/ausencias/${abierta.id}/vuelta`, {
                  vueltaEn: new Date(cuando).toISOString(),
                });
              }}
            >
              Ha vuelto
            </PrimaryButton>
          </div>
        </section>
      ) : (
        /* ── ABRIR UNA ──────────────────────────────────────────── */
        <section className="mb-6 rounded-2xl border border-slate-300 bg-white px-5 py-4">
          <h2 className="mb-3 text-[15px] font-semibold">Apuntar una salida</h2>
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-[13px] font-medium text-slate-600">
              Tipo
              <select
                value={tipo}
                onChange={(e) =>
                  setTipo(e.target.value as AusenciaDeLaFicha["tipo"])
                }
                className="rounded-lg border border-slate-300 px-3 py-2 text-[14px] text-slate-900"
              >
                {TIPOS.map((t) => (
                  <option key={t} value={t}>
                    {NOMBRE_DE_LA_AUSENCIA[t]}
                  </option>
                ))}
              </select>
            </label>
            {/* **La salida no controlada abre una incidencia N4 y suena
                en el móvil de guardia** (D-92). Se avisa ANTES de pulsar:
                un botón que hace sonar un teléfono tiene que decirlo. */}
            {tipo === "SALIDA_NO_CONTROLADA" && (
              <p className="flex items-start gap-2 rounded-lg bg-rose-50 px-3 py-2 text-[13.5px] text-rose-900">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                Esto abre una incidencia de nivel N4 en el libro y{" "}
                <strong>suena en el móvil de guardia</strong>. Es lo que hay
                que hacer si alguien se ha ido sin que nadie lo autorizara.
              </p>
            )}
            <div className="flex flex-wrap gap-4">
              <TextField
                id="ausencia-desde"
                label="Se fue"
                type="datetime-local"
                value={desde}
                onChange={setDesde}
              />
              <TextField
                id="ausencia-fin-previsto"
                label="Vuelta prevista (opcional)"
                type="datetime-local"
                value={finPrevisto}
                onChange={setFinPrevisto}
              />
            </div>
            <TextField
              id="ausencia-destino"
              label="Adónde (opcional)"
              value={destino}
              onChange={setDestino}
              placeholder="Hospital Nuestra Señora del Prado"
            />
            <TextField
              id="ausencia-motivo"
              label="Por qué (opcional)"
              value={motivo}
              onChange={setMotivo}
            />
            <div>
              <PrimaryButton
                onClick={() => {
                  void llamar("/ausencias", {
                    tipo,
                    desde: new Date(desde).toISOString(),
                    ...(finPrevisto
                      ? { finPrevisto: new Date(finPrevisto).toISOString() }
                      : {}),
                    ...(destino.trim() ? { destino: destino.trim() } : {}),
                    ...(motivo.trim() ? { motivo: motivo.trim() } : {}),
                  });
                  setDestino("");
                  setMotivo("");
                  setFinPrevisto("");
                }}
              >
                Apuntar
              </PrimaryButton>
            </div>
          </div>
        </section>
      )}

      {/* ── LOS DÍAS DEL MES (D-93) ──────────────────────────────── */}
      <section className="mb-7">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="text-[16px] font-semibold">
            Días de {mesEnPalabras(mes)}
          </h2>
          <span className="flex gap-2">
            <OutlineButton onClick={() => setMes(mesDesplazado(mes, -1))}>
              ← Mes anterior
            </OutlineButton>
            <OutlineButton onClick={() => setMes(mesDesplazado(mes, 1))}>
              Mes siguiente →
            </OutlineButton>
          </span>
        </div>
        {dias && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <Numero valor={dias.ordinarios} titulo="Ordinarios" />
            <Numero valor={dias.hospital} titulo="Hospital" />
            <Numero valor={dias.vacaciones} titulo="Con la familia" />
            <Numero valor={dias.otros} titulo="Otros" />
            <Numero valor={dias.presencia} titulo="Total con plaza" destacado />
          </div>
        )}
        <p className="mt-2 text-[13px] text-slate-500">
          Se cuenta <strong>dónde pernocta</strong>: el día del ingreso cuenta
          y el día del alta no. La regla de los días frontera es de cada
          comunidad autónoma y está por confirmar con la Junta.
        </p>
      </section>

      {/* ── EL HISTÓRICO ─────────────────────────────────────────── */}
      <h2 className="mb-2 text-[16px] font-semibold">Todas las ausencias</h2>
      {ausencias.length === 0 ? (
        <p className="rounded-2xl border border-slate-200 bg-white px-5 py-4 text-[13.5px] text-slate-500">
          No ha salido del centro desde que ingresó.
        </p>
      ) : (
        <ul className="space-y-2">
          {ausencias.map((a) => (
            <li
              key={a.id}
              className={`rounded-xl border px-4 py-3 text-[13.5px] ${
                a.abierta
                  ? "border-sky-200 bg-sky-50"
                  : "border-slate-200 bg-white"
              }`}
            >
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="font-medium">
                  {NOMBRE_DE_LA_AUSENCIA[a.tipo]}
                </span>
                <span className="text-slate-500">
                  {fechaLarga(a.desde)}
                  {a.hasta ? ` → ${fechaLarga(a.hasta)}` : " → sigue fuera"}
                </span>
                {a.incidentId && (
                  <Link
                    to={`/admin/residencia/incidencias/${a.incidentId}`}
                    className="rounded-md bg-rose-100 px-2 py-0.5 text-[12.5px] text-rose-900 underline"
                  >
                    incidencia N4
                  </Link>
                )}
                {/* **La revisión de la vuelta** (D-92): la confirma la DUE
                    y queda quién y cuándo. */}
                {a.pideRevision && a.revisadaEn == null && (
                  <button
                    type="button"
                    onClick={() => void llamar(`/ausencias/${a.id}/revisada`)}
                    className="ml-auto rounded-md bg-amber-100 px-2 py-1 text-[12.5px] text-amber-900 underline"
                  >
                    Pendiente de revisar tras el ingreso · confirmar
                  </button>
                )}
              </div>
              {a.destino && <p className="mt-1 text-slate-600">{a.destino}</p>}
              {a.motivo && <p className="text-slate-600">{a.motivo}</p>}
              {a.revisadaEn && (
                <p className="mt-1 text-[13px] text-emerald-800">
                  Revisada por {a.revisadaPor} ({a.revisadaComo}) el{" "}
                  {fechaLarga(a.revisadaEn)}
                </p>
              )}
              <p className="mt-1 text-[13px] text-slate-500">
                La apuntó {a.firmadaPor} ({a.firmadaComo})
                {a.corregidaEn
                  ? ` · fechas corregidas: ${a.motivoDeCorreccion ?? ""}`
                  : ""}
              </p>
            </li>
          ))}
        </ul>
      )}
    </AdminShell>
  );
}

function Numero({
  valor,
  titulo,
  destacado = false,
}: {
  valor: number;
  titulo: string;
  destacado?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border px-4 py-3 ${
        destacado
          ? "border-slate-300 bg-slate-50"
          : "border-slate-200 bg-white"
      }`}
    >
      <p className="text-[26px] font-semibold leading-none">{valor}</p>
      <p className="mt-1 text-[13px] text-slate-500">{titulo}</p>
    </div>
  );
}
