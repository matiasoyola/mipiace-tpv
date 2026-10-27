// personal-1 (decisiones 5, 6 y 7) · EL CUADRANTE DEL MES.
//
// Personas × días, y cada celda es un turno o una ausencia. Se rellena **a
// toques**: se elige el turno de la paleta y se pintan celdas. Nada de
// escribir.
//
// ── LAS TRES COSAS QUE HACEN QUE ESTO SEA USABLE ────────────────────
//
//   1. **Los avisos se pintan AL MOMENTO**, en el mismo toque, porque
//      `comprobarCuadrante` corre aquí (es el paquete puro, la MISMA
//      función que el servidor usa al publicar). Esperar al servidor para
//      saber si el sábado se queda sin gente sería un viaje por celda
//      sobre una rejilla de 651.
//
//   2. **El aviso lleva a la celda que lo arregla.** Tocar un aviso del
//      resumen enfoca su celda en la rejilla. Es el filtro «¿y qué?» de
//      este bloque: una lista que sólo dice que algo está mal obliga a
//      buscarlo en 21 × 31.
//
//   3. **Se guarda al soltar, no al terminar.** Cada pincelada va al
//      servidor en cuanto se levanta el dedo. No hay botón de guardar que
//      alguien pueda no pulsar.
//
// Y una cosa que NO hace: el turno partido. El modelo lo admite (la base
// guarda una fila por turno) y la rejilla lo PINTA si existe —«M+T»—, pero
// no hay forma de crearlo desde aquí. Es lo que el prompt deja para más
// adelante.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Copy,
  Eraser,
  Lock,
  Send,
  TriangleAlert,
} from "lucide-react";

import {
  comprobarCuadrante,
  resumenDeAvisos,
  type AvisoDelCuadrante,
  type CeldaDelCuadrante,
} from "@mipiacetpv/cuadrante";

import { AdminShell } from "../../AdminShell.js";
import { api, ApiError } from "../../api.js";
import { CenteredLoader, FieldError, OutlineButton } from "../../ui.js";
import {
  AUSENCIAS_CORTO,
  AUSENCIAS_LABEL,
  REGLAS_LABEL,
  esFinDeSemana,
  inicialDeDiaSemana,
  mesActual,
  mesLargo,
  mesVecino,
  numeroDeDia,
  type CuadranteResponse,
} from "./lib.js";

/** Lo que el pincel pinta: un turno, una ausencia o el borrador. */
type Pincel =
  | { tipo: "TURNO"; turnoId: string; code: string }
  | { tipo: "AUSENCIA"; ausencia: string }
  | { tipo: "BORRAR" };

export function CuadrantePage() {
  const [mes, setMes] = useState(() => {
    const url = new URLSearchParams(window.location.search).get("mes");
    return url && /^\d{4}-\d{2}$/.test(url) ? url : mesActual();
  });
  const [data, setData] = useState<CuadranteResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pincel, setPincel] = useState<Pincel | null>(null);
  const [guardando, setGuardando] = useState(0);
  const [foco, setFoco] = useState<string | null>(null);
  const [verAvisos, setVerAvisos] = useState(true);
  // personal-1 · lo que «Publicar» devuelve cuando hay avisos. Un panel y
  // no un `window.confirm`: el nativo no puede enseñar CUÁLES son, y
  // publicar un mes sabiendo que el sábado falta una auxiliar es una
  // decisión que se toma leyendo, no aceptando.
  const [confirmando, setConfirmando] = useState<{
    mensaje: string;
    rojos: number;
    ambares: number;
  } | null>(null);
  const pintando = useRef(false);

  const cargar = useCallback(() => {
    setData(null);
    api<CuadranteResponse>(`/admin/fichaje/cuadrante?month=${mes}`)
      .then(setData)
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : "Error inesperado"),
      );
  }, [mes]);

  useEffect(cargar, [cargar]);

  const publicado = data?.cabecera?.state === "PUBLICADO";

  // ── Los avisos, recalculados AQUÍ en cada cambio ─────────────────
  //
  // Con la misma función que el servidor. Lo que llega del servidor en
  // `data.avisos` es la foto del momento de la lectura; esto es la del
  // momento del toque, y las dos salen del mismo código.
  const avisos = useMemo<AvisoDelCuadrante[]>(() => {
    if (!data) return [];
    return comprobarCuadrante(
      {
        mes: data.month,
        turnos: data.turnos,
        personas: data.personas.filter((p) => p.active),
        celdas: data.celdas as CeldaDelCuadrante[],
        ocupacionPorDia: data.ocupacionPorDia ?? undefined,
      },
      data.reglas,
    );
  }, [data]);
  const resumen = useMemo(() => resumenDeAvisos(avisos), [avisos]);

  /** Los avisos de cada celda, para pintarle el borde y su título. */
  const avisosPorCelda = useMemo(() => {
    const m = new Map<string, AvisoDelCuadrante[]>();
    for (const a of avisos) {
      if (!a.celda) continue;
      const k = `${a.celda.employeeId}|${a.celda.dia}`;
      const l = m.get(k);
      if (l) l.push(a);
      else m.set(k, [a]);
    }
    return m;
  }, [avisos]);

  /** Y los de cada (día, turno), que son los de cobertura y ratio. */
  const avisosPorDia = useMemo(() => {
    const m = new Map<string, AvisoDelCuadrante[]>();
    for (const a of avisos) {
      if (a.celda || a.dia == null) continue;
      const l = m.get(a.dia);
      if (l) l.push(a);
      else m.set(a.dia, [a]);
    }
    return m;
  }, [avisos]);

  const porCelda = useMemo(() => {
    const m = new Map<string, { codes: string[]; ausencia: string | null }>();
    if (data) {
      for (const c of data.celdas) {
        const k = `${c.employeeId}|${c.dia}`;
        const ya = m.get(k) ?? { codes: [], ausencia: null };
        if (c.ausencia) ya.ausencia = c.ausencia;
        else if (c.turnoId) {
          const t = data.turnos.find((x) => x.id === c.turnoId);
          if (t) ya.codes.push(t.code);
        }
        m.set(k, ya);
      }
    }
    return m;
  }, [data]);

  /** Pinta una celda: optimista en la pantalla y en el servidor detrás. */
  async function pintar(employeeId: string, dia: string) {
    if (!pincel || !data) return;
    const motivo = publicado ? motivoDelCambio.current : null;
    if (publicado && (motivo == null || motivo.trim() === "")) {
      setError(
        "Este cuadrante está publicado: escribe arriba por qué lo cambias antes de tocar una celda.",
      );
      return;
    }
    const cuerpo = {
      employeeId,
      dia,
      turnoIds: pincel.tipo === "TURNO" ? [pincel.turnoId] : [],
      ausencia: pincel.tipo === "AUSENCIA" ? pincel.ausencia : null,
    };
    // Optimista: la celda cambia YA. Sobre una rejilla que se pinta
    // arrastrando, esperar al 200 de cada celda haría que el dedo fuera
    // por delante de lo que se ve.
    setData((d) =>
      d
        ? {
            ...d,
            celdas: [
              ...d.celdas.filter(
                (c) => !(c.employeeId === employeeId && c.dia === dia),
              ),
              ...(pincel.tipo === "BORRAR"
                ? []
                : [
                    {
                      employeeId,
                      dia,
                      turnoId: pincel.tipo === "TURNO" ? pincel.turnoId : null,
                      ausencia:
                        pincel.tipo === "AUSENCIA" ? pincel.ausencia : null,
                    },
                  ]),
            ],
          }
        : d,
    );
    setGuardando((n) => n + 1);
    try {
      const r = await api<{ celdas: CuadranteResponse["celdas"] }>(
        `/admin/fichaje/cuadrante/${mes}/celdas`,
        {
          method: "PUT",
          body: { celdas: [cuerpo], ...(motivo ? { motivo } : {}) },
        },
      );
      // Y la verdad del servidor manda: si rechazó algo, la rejilla vuelve
      // a lo que hay de verdad en vez de quedarse con lo que se pintó.
      // `?? d.celdas`: una respuesta sin celdas dejaría la rejilla en
      // `undefined` y `comprobarCuadrante` reventaría al recorrerla — o
      // sea, pantalla en blanco por un campo que faltó. Lo enseñó la
      // medida de toques, cuyo doble del servidor no lo devolvía.
      setData((d) => (d ? { ...d, celdas: r.celdas ?? d.celdas } : d));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Error inesperado");
      cargar();
    } finally {
      setGuardando((n) => n - 1);
    }
  }

  const motivoDelCambio = useRef<string | null>(null);
  const [motivo, setMotivo] = useState("");
  useEffect(() => {
    motivoDelCambio.current = motivo;
  }, [motivo]);

  async function copiarSemana(desde: string, hasta: string) {
    setGuardando((n) => n + 1);
    try {
      const r = await api<{ celdas: CuadranteResponse["celdas"] }>(
        `/admin/fichaje/cuadrante/${mes}/copiar-semana`,
        {
          method: "POST",
          body: { desde, hasta, dias: 7, ...(motivo ? { motivo } : {}) },
        },
      );
      setData((d) => (d ? { ...d, celdas: r.celdas ?? d.celdas } : d));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Error inesperado");
    } finally {
      setGuardando((n) => n - 1);
    }
  }

  async function publicar(confirmarAvisos: boolean) {
    setGuardando((n) => n + 1);
    try {
      await api(`/admin/fichaje/cuadrante/${mes}/publicar`, {
        method: "POST",
        body: { confirmarAvisos },
      });
      setError(null);
      setConfirmando(null);
      cargar();
    } catch (err) {
      if (err instanceof ApiError && err.code === "CUADRANTE_CON_AVISOS") {
        // **Publicar con avisos pide confirmarlo** (decisión 7). No
        // bloquea: un cuadrante con un hueco real publicado es mejor que
        // uno perfecto que nadie ve — el hueco se cubre llamando a
        // alguien, no escondiéndolo.
        setConfirmando({
          mensaje: err.message,
          rojos: resumen.rojos,
          ambares: resumen.ambares,
        });
      } else {
        setError(err instanceof ApiError ? err.message : "Error inesperado");
      }
    } finally {
      setGuardando((n) => n - 1);
    }
  }

  if (error && !data) {
    return (
      <AdminShell title="Cuadrante">
        <FieldError message={error} />
      </AdminShell>
    );
  }
  if (!data) return <CenteredLoader label="Cargando el mes…" />;

  const personas = data.personas.filter((p) => p.active);
  // Las semanas que se pueden copiar: los lunes del mes y el anterior.
  const lunes = data.dias.filter((d) => inicialDeDiaSemana(d) === "L");

  return (
    <AdminShell title="Cuadrante">
      {/* ── La cabecera: el mes, el estado y el resumen ──────────────── */}
      <div className="-mt-2 mb-4 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setMes(mesVecino(mes, -1))}
            className="grid h-9 w-9 place-items-center rounded-xl border border-slate-200 bg-white text-slate-500 hover:text-mipiace-ink"
            aria-label="Mes anterior"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="min-w-[150px] text-center text-[15px] font-semibold text-mipiace-ink">
            {mesLargo(mes)}
          </span>
          <button
            type="button"
            onClick={() => setMes(mesVecino(mes, 1))}
            className="grid h-9 w-9 place-items-center rounded-xl border border-slate-200 bg-white text-slate-500 hover:text-mipiace-ink"
            aria-label="Mes siguiente"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        {publicado ? (
          <span className="flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-[12.5px] text-emerald-800">
            <Lock className="h-3.5 w-3.5" />
            Publicado por {data.cabecera?.publishedBy}
            {data.cabecera?.warningsAtPublish
              ? ` · con ${data.cabecera.warningsAtPublish} aviso(s) apuntados`
              : ""}
          </span>
        ) : (
          <span className="rounded-full bg-slate-100 px-3 py-1 text-[12.5px] text-slate-600">
            Borrador
          </span>
        )}

        <div className="ml-auto flex items-center gap-2.5">
          {guardando > 0 && (
            <span className="text-[12px] text-slate-400">guardando…</span>
          )}
          <Link to={`/admin/fichaje/cuadrante/cambios?mes=${mes}`}>
            <OutlineButton className="!w-auto px-3 !h-9">
              <ClipboardList className="h-4 w-4" />
              Cambios
            </OutlineButton>
          </Link>
          {!publicado && (
            <OutlineButton
              className="!w-auto px-3 !h-9"
              onClick={() => void publicar(false)}
              busy={guardando > 0}
            >
              <Send className="h-4 w-4" />
              Publicar
            </OutlineButton>
          )}
        </div>
      </div>

      {error && <FieldError message={error} />}

      {/* ── PUBLICAR CON AVISOS ─────────────────────────────────────────
          Los avisos NO bloquean (decisión 7). Lo que se pide es que quien
          publica lea cuántos hay y de qué clase, y que quede apuntado. */}
      {confirmando && (
        <div className="mb-4 rounded-2xl border border-mipiace-coral/40 bg-mipiace-coral-soft px-4 py-4">
          <p className="flex items-center gap-2 text-[15px] font-semibold text-mipiace-ink">
            <TriangleAlert className="h-4 w-4 text-mipiace-coral-dark" />
            Este cuadrante tiene avisos
          </p>
          <p className="mt-1 text-[13.5px] text-slate-700">{confirmando.mensaje}</p>
          <p className="mt-2 text-[12.5px] text-slate-600">
            Puedes publicarlo igual: los avisos no lo impiden. Lo que pasa es
            que quedan <strong>apuntados</strong> en el cuadrante, con la
            fecha y tu nombre — y eso es lo que a los seis meses contesta
            «¿se publicó sabiendo que faltaba gente?».
          </p>
          <div className="mt-3 flex flex-wrap gap-2.5">
            <OutlineButton
              className="!w-auto px-4"
              onClick={() => void publicar(true)}
              busy={guardando > 0}
            >
              Publicarlo igual
            </OutlineButton>
            <OutlineButton
              className="!w-auto px-4"
              onClick={() => {
                setConfirmando(null);
                setVerAvisos(true);
              }}
            >
              Volver a mirarlo
            </OutlineButton>
          </div>
        </div>
      )}

      {/* Si está publicado, el motivo es obligatorio ANTES de tocar nada.
          Pedirlo después de cada celda haría que nadie pintara dos. */}
      {publicado && (
        <div className="mb-4 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3.5">
          <p className="text-[14px] font-medium text-mipiace-ink">
            Este cuadrante ya está publicado y su gente lo ha visto.
          </p>
          <p className="mt-0.5 text-[12.5px] text-slate-700">
            Puedes cambiarlo, y cada cambio queda registrado con tu nombre, la
            hora y el motivo. Escríbelo antes de tocar una celda.
          </p>
          <input
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Por qué lo cambias. Por ejemplo: «Ana se pone de baja, la cubre Bea»."
            className="mt-2 h-10 w-full rounded-xl border border-amber-300 bg-white px-3 text-[13.5px] text-mipiace-ink outline-none focus:border-mipiace-coral"
          />
        </div>
      )}

      {/* ── La paleta ────────────────────────────────────────────────── */}
      <div className="mb-4 rounded-2xl border border-slate-200 bg-white p-3.5">
        <p className="mb-2 text-[12px] font-medium uppercase tracking-wide text-slate-400">
          Elige qué pintar y toca las celdas
        </p>
        <div className="flex flex-wrap gap-2">
          {data.turnos.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() =>
                setPincel({ tipo: "TURNO", turnoId: t.id, code: t.code })
              }
              className={`flex h-10 items-center gap-2 rounded-xl border px-3 text-[13.5px] transition-colors ${
                pincel?.tipo === "TURNO" && pincel.turnoId === t.id
                  ? "border-mipiace-coral bg-mipiace-coral-soft text-mipiace-ink"
                  : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
              }`}
            >
              <span className="font-semibold">{t.code}</span>
              <span className="text-[12px] text-slate-500">
                {t.startsAt}–{t.endsAt}
              </span>
            </button>
          ))}
          <span className="mx-1 w-px self-stretch bg-slate-200" />
          {data.ausencias.map((a) => (
            <button
              key={a}
              type="button"
              onClick={() => setPincel({ tipo: "AUSENCIA", ausencia: a })}
              className={`h-10 rounded-xl border px-3 text-[13.5px] transition-colors ${
                pincel?.tipo === "AUSENCIA" && pincel.ausencia === a
                  ? "border-mipiace-coral bg-mipiace-coral-soft text-mipiace-ink"
                  : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
              }`}
            >
              {AUSENCIAS_LABEL[a] ?? a}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setPincel({ tipo: "BORRAR" })}
            className={`flex h-10 items-center gap-1.5 rounded-xl border px-3 text-[13.5px] transition-colors ${
              pincel?.tipo === "BORRAR"
                ? "border-mipiace-coral bg-mipiace-coral-soft text-mipiace-ink"
                : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
            }`}
          >
            <Eraser className="h-4 w-4" />
            Dejar en blanco
          </button>
        </div>

        {lunes.length > 1 && (
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
            <span className="flex items-center gap-1.5 text-[12.5px] text-slate-500">
              <Copy className="h-3.5 w-3.5" />
              Copiar la semana del
            </span>
            {lunes.slice(0, -1).map((l, i) => (
              <button
                key={l}
                type="button"
                onClick={() => void copiarSemana(l, lunes[i + 1]!)}
                className="h-8 rounded-xl border border-slate-200 bg-white px-2.5 text-[12.5px] text-slate-600 hover:border-slate-300"
              >
                {numeroDeDia(l)} → {numeroDeDia(lunes[i + 1]!)}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── El resumen de avisos ─────────────────────────────────────── */}
      <div
        className={`mb-4 rounded-2xl border px-4 py-3.5 ${
          resumen.rojos > 0
            ? "border-mipiace-coral/30 bg-mipiace-coral-soft"
            : resumen.total > 0
              ? "border-amber-200 bg-amber-50"
              : "border-emerald-200 bg-emerald-50"
        }`}
      >
        <button
          type="button"
          onClick={() => setVerAvisos((v) => !v)}
          className="flex w-full items-center gap-2 text-left"
        >
          {resumen.total > 0 && (
            <TriangleAlert className="h-4 w-4 shrink-0 text-mipiace-coral-dark" />
          )}
          <span className="text-[14.5px] font-medium text-mipiace-ink">
            {resumen.total === 0
              ? "Sin avisos: el mes cumple las reglas del centro."
              : `${resumen.total} aviso${resumen.total === 1 ? "" : "s"}` +
                (resumen.rojos > 0
                  ? ` · ${resumen.rojos} incumple${resumen.rojos === 1 ? "" : "n"} una norma`
                  : "")}
          </span>
          {resumen.total > 0 && (
            <span className="ml-auto text-[12.5px] text-slate-500">
              {verAvisos ? "ocultar" : "ver"}
            </span>
          )}
        </button>
        {resumen.total > 0 && verAvisos && (
          <ul className="mt-2.5 max-h-56 space-y-1 overflow-y-auto">
            {avisos.slice(0, 120).map((a, i) => (
              <li key={`${a.regla}-${a.dia}-${a.employeeId}-${i}`}>
                <button
                  type="button"
                  onClick={() => {
                    if (a.celda) {
                      setFoco(`${a.celda.employeeId}|${a.celda.dia}`);
                      // `?.()` en el desplazamiento: jsdom no lo
                      // implementa y algún WebView viejo tampoco, y lo
                      // que importa —el foco de la celda— ya está puesto.
                      document
                        .getElementById(
                          `celda-${a.celda.employeeId}-${a.celda.dia}`,
                        )
                        ?.scrollIntoView?.({
                          behavior: "smooth",
                          block: "center",
                          inline: "center",
                        });
                    } else if (a.dia) {
                      document
                        .getElementById(`col-${a.dia}`)
                        ?.scrollIntoView?.({ behavior: "smooth", inline: "center" });
                    }
                  }}
                  className="w-full text-left text-[12.5px] text-slate-700 hover:text-mipiace-ink"
                >
                  <span
                    className={`mr-1.5 inline-block h-1.5 w-1.5 rounded-full ${
                      a.gravedad === "ROJO" ? "bg-mipiace-coral" : "bg-amber-400"
                    }`}
                  />
                  <span className="text-slate-500">
                    {REGLAS_LABEL[a.regla] ?? a.regla}:
                  </span>{" "}
                  {a.mensaje}
                </button>
              </li>
            ))}
            {avisos.length > 120 && (
              <li className="pt-1 text-[12px] text-slate-500">
                …y {avisos.length - 120} más. Se enseñan los 120 primeros, que
                van ordenados: lo rojo y lo más temprano arriba.
              </li>
            )}
          </ul>
        )}
      </div>

      {/* ── LA REJILLA ───────────────────────────────────────────────── */}
      {personas.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 text-[13px] text-slate-500">
          No hay nadie de alta en la plantilla.{" "}
          <Link to="/admin/fichaje/personal" className="underline">
            Da de alta a tu gente
          </Link>{" "}
          y vuelve.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
          <table className="min-w-full border-separate border-spacing-0 text-[12.5px]">
            <thead>
              <tr>
                {/* La columna de nombres se queda pegada: con 31 columnas,
                    desplazarse a la derecha sin ella es pintar a ciegas. */}
                <th className="sticky left-0 z-20 min-w-[170px] border-b border-slate-200 bg-white px-3 py-2 text-left font-medium text-slate-500">
                  Persona
                </th>
                {data.dias.map((d) => (
                  <th
                    key={d}
                    id={`col-${d}`}
                    className={`border-b border-slate-200 px-0 py-1 text-center font-normal ${
                      esFinDeSemana(d) ? "bg-mipiace-stone" : "bg-white"
                    }`}
                  >
                    <span
                      className={`block text-[12px] tabular-nums ${
                        avisosPorDia.has(d)
                          ? "font-semibold text-mipiace-coral-dark"
                          : "text-slate-600"
                      }`}
                      title={(avisosPorDia.get(d) ?? [])
                        .map((a) => a.mensaje)
                        .join("\n")}
                    >
                      {numeroDeDia(d)}
                    </span>
                    <span className="block text-[10px] uppercase text-slate-400">
                      {inicialDeDiaSemana(d)}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {personas.map((p) => (
                <tr key={p.employeeId}>
                  <th className="sticky left-0 z-10 border-b border-slate-100 bg-white px-3 py-1.5 text-left font-normal">
                    <span className="block truncate text-[13px] text-mipiace-ink">
                      {p.nombre}
                    </span>
                    <span className="block truncate text-[11px] text-slate-400">
                      {p.categoria ?? "sin categoría"}
                      {p.atencionDirecta ? " · AD" : ""}
                    </span>
                  </th>
                  {data.dias.map((d) => {
                    const k = `${p.employeeId}|${d}`;
                    const v = porCelda.get(k);
                    const avs = avisosPorCelda.get(k) ?? [];
                    const rojo = avs.some((a) => a.gravedad === "ROJO");
                    const etiqueta = v?.ausencia
                      ? (AUSENCIAS_CORTO[v.ausencia] ?? "?")
                      : (v?.codes.slice().sort().join("+") ?? "");
                    return (
                      <td
                        key={d}
                        className={`border-b border-slate-100 p-0 ${
                          esFinDeSemana(d) ? "bg-mipiace-stone/60" : ""
                        }`}
                      >
                        <button
                          id={`celda-${p.employeeId}-${d}`}
                          type="button"
                          disabled={pincel == null}
                          title={
                            avs.length > 0
                              ? avs.map((a) => a.mensaje).join("\n")
                              : undefined
                          }
                          onMouseDown={() => {
                            pintando.current = true;
                            void pintar(p.employeeId, d);
                          }}
                          onMouseEnter={() => {
                            if (pintando.current) void pintar(p.employeeId, d);
                          }}
                          onMouseUp={() => {
                            pintando.current = false;
                          }}
                          className={`h-9 w-9 text-[12px] tabular-nums transition-colors disabled:cursor-default ${
                            foco === k ? "ring-2 ring-mipiace-coral ring-inset" : ""
                          } ${
                            rojo
                              ? "bg-mipiace-coral-soft text-mipiace-ink"
                              : avs.length > 0
                                ? "bg-amber-50 text-mipiace-ink"
                                : v?.ausencia
                                  ? "text-slate-500"
                                  : "text-mipiace-ink"
                          } ${pincel ? "hover:bg-mipiace-coral-soft/70" : ""}`}
                        >
                          {etiqueta}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-3 text-[12px] text-slate-400">
        {personas.length} persona{personas.length === 1 ? "" : "s"} ×{" "}
        {data.dias.length} días. Se guarda al soltar: no hay botón de guardar.
      </p>
    </AdminShell>
  );
}
