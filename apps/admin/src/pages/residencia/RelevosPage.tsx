// residencia-5 (D-18, D-67) · **LOS PARTES DE RELEVO: LA LISTA.**
//
// Lo que la dirección mira aquí es una sola cosa: **cuáles no se
// confirmaron**. De ahí que el filtro «sólo sin confirmar» esté arriba y
// que el estado sea la primera columna que se lee.
//
// ── Y DESDE AQUÍ SE EMPAREJA LA TABLET DE LA SALA ───────────────────
//
// Porque es donde se mira el relevo. El botón está junto a la lista y no
// en «Dispositivos» por la misma razón por la que el del móvil de guardia
// está en «Guardia»: quien empareja la tablet de la sala es quien está
// montando el relevo, no quien administra aparatos.

import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Plus } from "lucide-react";

import { AdminShell } from "../../AdminShell.js";
import { api, ApiError } from "../../api.js";
import { CenteredLoader, FieldError, OutlineButton } from "../../ui.js";
import { dia, hora, type RelevoDeLaLista } from "./relevo-lib.js";

export function RelevosPage() {
  const [relevos, setRelevos] = useState<RelevoDeLaLista[] | null>(null);
  const [soloSinConfirmar, setSoloSinConfirmar] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [codigo, setCodigo] = useState<string | null>(null);

  const recargar = useCallback(async () => {
    try {
      const r = await api<{ relevos: RelevoDeLaLista[] }>(
        `/residencia/relevos${soloSinConfirmar ? "?soloSinConfirmar=1" : ""}`,
      );
      setRelevos(r.relevos);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Error inesperado");
    }
  }, [soloSinConfirmar]);

  useEffect(() => {
    void recargar();
  }, [recargar]);

  async function emparejarLaSala(): Promise<void> {
    try {
      const r = await api<{ code: string }>("/residencia/sala/pairing-codes", {
        method: "POST",
        body: {},
      });
      setCodigo(r.code);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Error inesperado");
    }
  }

  return (
    <AdminShell title="Relevos">
      <p className="-mt-2 mb-5 text-[13.5px] text-slate-500">
        El parte de cada turno, con quién lo recibió. Se genera solo al
        cerrar el turno y no se edita: lo que llega tarde se añade aparte,
        con su hora.
      </p>

      {error && <FieldError message={error} />}

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-[13.5px]">
          <input
            type="checkbox"
            checked={soloSinConfirmar}
            onChange={(e) => setSoloSinConfirmar(e.target.checked)}
            className="h-4 w-4"
          />
          Sólo los que nadie ha confirmado
        </label>
        <Link
          to="/admin/residencia/relevos/vivo"
          className="text-[13px] text-mipiace-coral underline"
        >
          Ver el del turno en curso
        </Link>
        <OutlineButton
          type="button"
          onClick={() => void emparejarLaSala()}
          className="ml-auto !h-10 !w-auto !px-4 !text-[13.5px]"
        >
          <Plus className="h-4 w-4" /> Tablet de sala
        </OutlineButton>
      </div>

      {codigo && (
        <div className="mb-4 rounded-2xl border-2 border-mipiace-coral bg-white px-5 py-4">
          <p className="text-[13px] text-slate-500">
            Código para emparejar la tablet de la sala. Caduca en una hora y
            se usa una vez.
          </p>
          <p className="mt-1 text-[40px] font-semibold tabular-nums tracking-[0.2em]">
            {codigo}
          </p>
          <p className="mt-1 text-[13px] text-slate-500">
            Instala la app en la tablet y teclea este código. Arranca en modo
            relevo: no cobra, no abre turno y no registra cuidados.
          </p>
        </div>
      )}

      {relevos == null ? (
        <CenteredLoader label="Cargando los relevos…" />
      ) : relevos.length === 0 ? (
        <p className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-[13.5px] text-slate-500">
          {soloSinConfirmar
            ? "Todos los relevos están confirmados."
            : "Todavía no hay ningún parte de relevo. Se genera solo en cuanto cierre un turno."}
        </p>
      ) : (
        <ul className="space-y-2">
          {relevos.map((r) => (
            <li key={r.id}>
              <Link
                to={`/admin/residencia/relevos/${r.id}`}
                className={`flex flex-wrap items-center gap-x-4 gap-y-1 rounded-2xl border px-4 py-3 text-[13.5px] ${
                  r.confirmadoEn
                    ? "border-slate-200 bg-white"
                    : "border-red-200 bg-red-50"
                }`}
              >
                <span
                  className={`shrink-0 rounded-md px-2 py-0.5 text-[11.5px] font-semibold ${
                    r.confirmadoEn
                      ? "bg-emerald-100 text-emerald-800"
                      : "bg-red-100 text-red-800"
                  }`}
                >
                  {r.confirmadoEn ? "Confirmado" : "Sin confirmar"}
                </span>
                <span className="font-medium tabular-nums">{dia(r.careDay)}</span>
                <span>{r.turno.name}</span>
                <span className="text-slate-500">
                  {r.sinNovedades ? "Turno sin novedades" : `${r.lineas} línea(s)`}
                  {r.zonas > 0 ? ` · ${r.zonas} zona(s)` : ""}
                </span>
                {r.tardios > 0 && (
                  <span className="rounded-md bg-amber-100 px-2 py-0.5 text-[11.5px] text-amber-900">
                    {r.tardios} llegó después
                  </span>
                )}
                <span className="ml-auto text-slate-500">
                  Congelado {hora(r.congeladoEn)}
                  {r.confirmaciones > 0
                    ? ` · ${r.confirmaciones} confirmación(es)`
                    : ""}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </AdminShell>
  );
}
