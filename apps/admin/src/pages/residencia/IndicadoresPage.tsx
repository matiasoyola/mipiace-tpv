// residencia-5 (bloque C §2, rama de controles §10) · **LOS
// INDICADORES.**
//
// Los que ya salen de lo registrado, con su umbral objetivo y si el centro
// va dentro o fuera. Y los que **todavía no tienen dato**, nombrados uno
// por uno.
//
// ── FÓRMULA DEL PRODUCTO, UMBRAL DEL CENTRO ─────────────────────────
//
// La frontera de la rama §10, y aquí se ve en la pantalla: la fórmula de
// cada indicador **no se puede tocar** (ni hay botón), y el umbral sí. La
// pantalla además dice cuál es **de serie** y cuál eligió el centro: un
// umbral que nadie ha mirado y uno que la dirección decidió no son lo
// mismo delante de un auditor.
//
// ── Y LOS QUE FALTAN SE NOMBRAN ─────────────────────────────────────
//
// Es la decisión de producto 5 del prompt: «sólo los que tienen dato; los
// que dependen de bloques futuros no se pintan vacíos». Pero tampoco se
// callan: un indicador que falta y no se nombra es un indicador que
// alguien da por calculado, y en una auditoría eso es peor que el hueco.

import { useCallback, useEffect, useState } from "react";

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
  umbralEnPalabras,
  valorEnPalabras,
  type ValorDeIndicador,
} from "./relevo-lib.js";

interface Respuesta {
  mes: string;
  indicadores: ValorDeIndicador[];
  sinDato: Array<{ nombre: string; falta: string }>;
}

export function IndicadoresPage() {
  const [mes, setMes] = useState<string>(() => new Date().toISOString().slice(0, 7));
  const [datos, setDatos] = useState<Respuesta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [editando, setEditando] = useState<string | null>(null);
  const [valor, setValor] = useState("");

  const recargar = useCallback(async () => {
    try {
      setDatos(await api<Respuesta>(`/residencia/indicadores?mes=${mes}`));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Error inesperado");
    }
  }, [mes]);

  useEffect(() => {
    void recargar();
  }, [recargar]);

  async function guardarUmbral(i: ValorDeIndicador): Promise<void> {
    const n = Number(valor.replace(",", "."));
    if (!Number.isFinite(n) || n < 0) {
      setError("El umbral tiene que ser un número de cero para arriba.");
      return;
    }
    try {
      await api(`/residencia/indicadores/${i.code}`, {
        method: "PUT",
        body: { target: n, comparison: i.comparacion },
      });
      setAviso("Umbral del centro guardado.");
      setTimeout(() => setAviso(null), 3000);
      setEditando(null);
      await recargar();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Error inesperado");
    }
  }

  async function volverAlDeSerie(code: string): Promise<void> {
    try {
      await api(`/residencia/indicadores/${code}`, { method: "DELETE" });
      setAviso("Vuelve al umbral de serie del producto.");
      setTimeout(() => setAviso(null), 3000);
      await recargar();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Error inesperado");
    }
  }

  if (!datos) {
    return error ? (
      <AdminShell title="Indicadores">
        <FieldError message={error} />
      </AdminShell>
    ) : (
      <CenteredLoader label="Calculando los indicadores…" />
    );
  }

  return (
    <AdminShell title="Indicadores">
      <p className="-mt-2 mb-5 text-[13.5px] text-slate-500">
        Salen de lo que las puertas registran: no los redacta nadie. La
        fórmula es del producto; el <strong>umbral objetivo</strong> lo pone
        el centro.
      </p>

      {error && <FieldError message={error} />}
      {aviso && <SuccessBanner message={aviso} />}

      <label className="mb-4 flex items-center gap-2 text-[13.5px]">
        Mes
        <input
          type="month"
          value={mes}
          onChange={(e) => setMes(e.target.value)}
          className="h-10 rounded-xl border border-slate-300 px-3 text-[13.5px]"
        />
      </label>

      <ul className="space-y-2">
        {datos.indicadores.map((i) => (
          <li
            key={i.code}
            className={`rounded-2xl border px-5 py-4 ${
              i.dentro === false
                ? "border-red-300 bg-red-50"
                : i.dentro === true
                  ? "border-emerald-200 bg-emerald-50"
                  : "border-slate-200 bg-white"
            }`}
          >
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <h2 className="text-[14.5px] font-semibold">{i.nombre}</h2>
              <span className="text-[22px] font-semibold tabular-nums">
                {valorEnPalabras(i)}
              </span>
              <span className="text-[13px] text-slate-600">
                Objetivo {umbralEnPalabras(i)}
                {i.umbralDelCentro ? " (del centro)" : " (de serie)"}
              </span>
              {i.dentro === true && (
                <span className="rounded-md bg-emerald-100 px-2 py-0.5 text-[11.5px] text-emerald-800">
                  Dentro
                </span>
              )}
              {i.dentro === false && (
                <span className="rounded-md bg-red-100 px-2 py-0.5 text-[11.5px] text-red-800">
                  Fuera
                </span>
              )}
              {i.dentro === null && (
                <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[11.5px] text-slate-600">
                  Sin dato
                </span>
              )}
            </div>
            {/* **De qué registros sale** (07-calidad-iso §2): es lo que
                permite abrirlo en una auditoría en vez de creérselo. */}
            <p className="mt-1 text-[12.5px] text-slate-500">
              Sale de: {i.deDonde}.
            </p>

            {editando === i.code ? (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <input
                  value={valor}
                  onChange={(e) => setValor(e.target.value)}
                  inputMode="decimal"
                  className="h-10 w-28 rounded-xl border border-slate-300 px-3 text-[13.5px] tabular-nums"
                  aria-label={`Umbral de ${i.nombre}`}
                />
                <span className="text-[13px] text-slate-500">
                  {i.comparacion === "AT_LEAST" ? "como mínimo" : "como máximo"}
                  {i.unidad === "PORCENTAJE" ? " %" : ""}
                </span>
                <PrimaryButton
                  type="button"
                  onClick={() => void guardarUmbral(i)}
                  className="!h-10 !w-auto !px-4 !text-[13px]"
                >
                  Guardar
                </PrimaryButton>
                <OutlineButton
                  type="button"
                  onClick={() => setEditando(null)}
                  className="!h-10 !w-auto !px-4 !text-[13px]"
                >
                  Cancelar
                </OutlineButton>
              </div>
            ) : (
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <OutlineButton
                  type="button"
                  onClick={() => {
                    setEditando(i.code);
                    setValor(String(i.umbral).replace(".", ","));
                  }}
                  className="!h-9 !w-auto !px-4 !text-[13px]"
                >
                  Cambiar el umbral
                </OutlineButton>
                {i.umbralDelCentro && (
                  <button
                    type="button"
                    onClick={() => void volverAlDeSerie(i.code)}
                    className="text-[13px] text-slate-500 underline"
                  >
                    volver al de serie
                  </button>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>

      {/* ── Los que todavía no se pueden calcular ─────────────────── */}
      <section className="mt-7 rounded-2xl border border-slate-200 bg-white px-5 py-4">
        <h2 className="text-[14.5px] font-semibold">
          Todavía sin dato ({datos.sinDato.length})
        </h2>
        <p className="mt-1 text-[13px] text-slate-500">
          Estos no se pintan vacíos: se nombran. Cada uno espera a su
          bloque, y hasta entonces se declaran a AENOR como hasta ahora.
        </p>
        <ul className="mt-2 space-y-1 text-[13px] text-slate-600">
          {datos.sinDato.map((s) => (
            <li key={s.nombre}>
              <strong>{s.nombre}</strong> — falta {s.falta}
            </li>
          ))}
        </ul>
      </section>
    </AdminShell>
  );
}
