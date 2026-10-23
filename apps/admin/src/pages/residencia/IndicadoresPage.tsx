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
  umbralEnPalabras,
  valorEnPalabras,
  type ValorDeIndicador,
} from "./relevo-lib.js";

/** calidad-1 (D-72) · el indicador, con el proceso del que cuelga en
 *  ESTE centro. `null` mientras no se haya cargado el mapa. */
interface IndicadorConProceso extends ValorDeIndicador {
  proceso?: { id: string; nombre: string } | null;
}

interface Respuesta {
  mes: string;
  indicadores: IndicadorConProceso[];
  sinDato: Array<{ nombre: string; falta: string }>;
  /** calidad-1 (R9) · la cumplimentación abierta por turno y zona. */
  cumplimentacionPorTurnoYZona?: Array<{
    shiftCode: string | null;
    turno: string;
    floorId: string | null;
    zona: string;
    tocan: number;
    hechas: number;
  }>;
}

/** La tabla de «de qué registros sale», tal y como la manda la ruta. */
interface TablaDeRegistros {
  titulo: string;
  nota: string;
  columnas: string[];
  filas: string[][];
  total: number;
}

export function IndicadoresPage() {
  const [mes, setMes] = useState<string>(() => new Date().toISOString().slice(0, 7));
  const [datos, setDatos] = useState<Respuesta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [editando, setEditando] = useState<string | null>(null);
  const [valor, setValor] = useState("");
  // calidad-1 · qué indicador está abierto hasta sus registros, y la
  // tabla que contestó la ruta.
  const [abierto, setAbierto] = useState<string | null>(null);
  const [tabla, setTabla] = useState<TablaDeRegistros | null>(null);

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

  /**
   * **ABRIR UN INDICADOR HASTA SUS REGISTROS** (07-calidad-iso §2).
   *
   * Es lo que convierte un número que hay que creerse en un número que
   * se puede contrastar delante de un auditor. La tabla es genérica —
   * columnas y filas de texto— porque cada indicador sale de una tabla
   * distinta y trece componentes serían trece sitios donde acordarse
   * del catorce.
   */
  async function abrir(code: string): Promise<void> {
    if (abierto === code) {
      setAbierto(null);
      setTabla(null);
      return;
    }
    setAbierto(code);
    setTabla(null);
    try {
      setTabla(
        await api<TablaDeRegistros>(
          `/residencia/indicadores/${code}/registros?mes=${mes}`,
        ),
      );
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
              Sale de: {i.deDonde}.{" "}
              <button
                type="button"
                onClick={() => void abrir(i.code)}
                className="underline"
              >
                {abierto === i.code ? "cerrar" : "ver los registros"}
              </button>
            </p>
            {/* calidad-1 (D-72) · de qué proceso cuelga EN ESTE CENTRO.
                Sin mapa cargado no hay proceso, y la pantalla lo dice en
                vez de pintar un hueco. */}
            <p className="mt-0.5 text-[12.5px] text-slate-500">
              {i.proceso != null ? (
                <>
                  Proceso:{" "}
                  <Link
                    to={`/admin/residencia/procesos/${i.proceso.id}`}
                    className="underline"
                  >
                    {i.proceso.nombre}
                  </Link>
                </>
              ) : (
                <>
                  Sin proceso:{" "}
                  <Link to="/admin/residencia/procesos" className="underline">
                    carga el mapa
                  </Link>{" "}
                  para colgarlo.
                </>
              )}
            </p>

            {abierto === i.code && (
              <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                {tabla == null ? (
                  <p className="text-[13px] text-slate-500">Cargando…</p>
                ) : (
                  <>
                    <h3 className="text-[13.5px] font-semibold">
                      {tabla.titulo} ({tabla.total})
                    </h3>
                    <p className="mt-1 text-[12.5px] text-slate-500">
                      {tabla.nota}
                    </p>
                    {tabla.filas.length === 0 ? (
                      <p className="mt-2 text-[13px] text-slate-500">
                        Ninguno este mes.
                      </p>
                    ) : (
                      <div className="mt-2 overflow-x-auto">
                        <table className="w-full text-left text-[12.5px]">
                          <thead>
                            <tr className="text-slate-500">
                              {tabla.columnas.map((c) => (
                                <th key={c} className="pr-4 pb-1 font-medium">
                                  {c}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {tabla.filas.map((f, n) => (
                              <tr key={n} className="border-t border-slate-200">
                                {f.map((celda, j) => (
                                  <td key={j} className="pr-4 py-1">
                                    {celda}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                    {tabla.total > tabla.filas.length && (
                      <p className="mt-2 text-[12px] text-slate-500">
                        Se enseñan las primeras {tabla.filas.length} de{" "}
                        {tabla.total}.
                      </p>
                    )}
                  </>
                )}
              </div>
            )}

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

      {/* ── calidad-1 (R9) · LA CUMPLIMENTACIÓN, POR TURNO Y ZONA ── */}
      {/*
          El acta de la inspección del 08-10-2026 habla de «anotaciones
          vacías puntuales», y la respuesta del centro comprometió que la
          supervisora compruebe al final de cada turno que no quedan
          casillas sin anotar. Un porcentaje del mes no sirve para eso:
          lo que hace falta es ver QUÉ turno y QUÉ planta se quedan
          cortos, y eso es esta tabla — lo peor arriba.
      */}
      {datos.cumplimentacionPorTurnoYZona != null &&
        datos.cumplimentacionPorTurnoYZona.length > 0 && (
          <section className="mt-7 rounded-2xl border border-slate-200 bg-white px-5 py-4">
            <h2 className="text-[14.5px] font-semibold">
              Cumplimentación por turno y zona
            </h2>
            <p className="mt-1 text-[13px] text-slate-500">
              R9 de la inspección. Sale del mismo cruce que el parte de
              relevo, así que esta tabla y el parte no se pueden
              contradecir para el mismo turno. Lo peor, arriba.
            </p>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-left text-[13px]">
                <thead>
                  <tr className="text-slate-500">
                    <th className="pr-4 pb-1 font-medium">Turno</th>
                    <th className="pr-4 pb-1 font-medium">Zona</th>
                    <th className="pr-4 pb-1 font-medium">Tocaban</th>
                    <th className="pr-4 pb-1 font-medium">Anotadas</th>
                    <th className="pr-4 pb-1 font-medium">%</th>
                  </tr>
                </thead>
                <tbody>
                  {datos.cumplimentacionPorTurnoYZona.map((f) => {
                    const pct = Math.round((f.hechas / f.tocan) * 1000) / 10;
                    return (
                      <tr
                        key={`${f.shiftCode}|${f.floorId}`}
                        className="border-t border-slate-200"
                      >
                        <td className="pr-4 py-1">{f.turno}</td>
                        <td className="pr-4 py-1">{f.zona}</td>
                        <td className="pr-4 py-1 tabular-nums">{f.tocan}</td>
                        <td className="pr-4 py-1 tabular-nums">{f.hechas}</td>
                        <td
                          className={`pr-4 py-1 tabular-nums ${
                            pct < 98 ? "font-semibold text-red-700" : ""
                          }`}
                        >
                          {String(pct).replace(".", ",")} %
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}

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
