// Modal de cierre de turno + arqueo X intermedio.
//
// v1.3-Thalia Lote 4 lo montó como "cuenta 15 denominaciones y luego te
// enseño el informe". v1.11-cierre-de-dia INVIERTE ese orden.
//
// El addendum del bloque (Sirope, 2026-08-20) recorrió el ciclo entero en
// producción y encontró que el resumen que pedía el prompt YA ESTABA
// CONSTRUIDO — tabla por método, cash esperado, descuadre— pero enterrado
// detrás del arqueo. Así que el bloque no es construir el resumen: es que
// el resumen sea LA pantalla, con el efectivo esperado ya puesto y un botón
// de confirmar, y que contar pase a ser el enlace opcional "Cuadrar caja".
//
// Fases (mode "Z"):
//   summary → tarjeta de resumen del turno abierto (preview del server).
//             "Cerrar turno" cierra sin contar (POST /shift/:id/close-day).
//             "Cuadrar caja" lleva a `count`.
//   count   → la tabla de 15 denominaciones de siempre, ahora con el
//             efectivo ESPERADO delante. POST /shift/:id/cash-count kind Z.
//   done    → la misma tarjeta, ya del turno cerrado. Los dos caminos
//             terminan aquí (addendum, punto 2).
//
// Se entra directo por `count` en tres casos: mode "X" (arqueo
// intermedio, sin cambios respecto a v1.3), tenant con
// `requireCashCountOnClose` (el arqueo obligatorio como opción del
// negocio), y sin red (v1.10 — el cierre offline se arma con datos
// locales y no hay resumen de server que pedir).

import { useEffect, useMemo, useState } from "react";
import { AlertCircle, Loader2, WifiOff } from "lucide-react";

import { ApiError, apiWithCashier } from "../api.js";
import { outboxAdd, outboxCounts, outboxList } from "../lib/outbox.js";
import { closeLocalShift, getLocalShift } from "../lib/offlineShift.js";
import { newId } from "../lib/ids.js";
import { formatEur } from "../lib/money.js";
import {
  ackDaySummary,
  buildOfflineDaySummary,
  fetchShiftSummary,
  METHOD_LABEL,
  type ShiftDaySummary,
} from "../lib/shiftSummary.js";
import { DaySummaryCard } from "./DaySummaryCard.js";

// Mismo orden que `ALLOWED_DENOMINATIONS` del backend (de mayor a
// menor). Si el backend cambia el set, también hay que tocarlo aquí —
// son 15 valores fijos del euro, no hay mantenimiento real.
const DENOMINATIONS: readonly { key: string; valueEur: number; label: string }[] = [
  { key: "500", valueEur: 500, label: "500 €" },
  { key: "200", valueEur: 200, label: "200 €" },
  { key: "100", valueEur: 100, label: "100 €" },
  { key: "50", valueEur: 50, label: "50 €" },
  { key: "20", valueEur: 20, label: "20 €" },
  { key: "10", valueEur: 10, label: "10 €" },
  { key: "5", valueEur: 5, label: "5 €" },
  { key: "2", valueEur: 2, label: "2 €" },
  { key: "1", valueEur: 1, label: "1 €" },
  { key: "0.50", valueEur: 0.5, label: "50 cts" },
  { key: "0.20", valueEur: 0.2, label: "20 cts" },
  { key: "0.10", valueEur: 0.1, label: "10 cts" },
  { key: "0.05", valueEur: 0.05, label: "5 cts" },
  { key: "0.02", valueEur: 0.02, label: "2 cts" },
  { key: "0.01", valueEur: 0.01, label: "1 ct" },
];

interface FailedDoc {
  id: string;
  kind: "ticket" | "refund";
  internalNumber: string;
  total: number;
  createdAt: string;
  errorSummary: string;
}

// v1.0-pilotos · Lote 3 (#28): desglose por método que devuelve el
// backend (mismo cálculo que el Z PDF — bruto / devoluciones / neto).
interface ZBreakdownRow {
  method: string;
  gross: number;
  refunds: number;
  net: number;
  counted?: number;
}

interface ZBreakdownPayload {
  methods: ZBreakdownRow[];
  grossSales: number;
  refundsTotal: number;
  netSales: number;
  cashTheoretical: number;
}

interface CashCountResponse {
  kind: "X" | "Z";
  cashCounted: number;
  cashTheoretical: number;
  descuadre: number;
  breakdown?: ZBreakdownPayload;
  shift?: { id: string; closedAt: string; zReportPdfPath: string | null };
}

type Phase = "summary" | "count" | "done";

export function CloseShiftModal(props: {
  shiftId: string;
  cashierRole: "MANAGER" | "CASHIER";
  // "Z" (default) = cierre real. "X" = arqueo intermedio sin cerrar.
  mode?: "X" | "Z";
  // v1.11 · el negocio exige cuadrar caja para cerrar. Entra directo por
  // la tabla de denominaciones. Default false: contar es opcional.
  requireCashCountOnClose?: boolean;
  onClose: () => void;
  onClosed: () => void;
}) {
  const mode = props.mode ?? "Z";
  const isZ = mode === "Z";
  const mustCount = props.requireCashCountOnClose === true;

  // v1.11 · el arqueo X y el cierre obligado arrancan en la tabla; el
  // cierre normal arranca en el resumen.
  const [phase, setPhase] = useState<Phase>(
    isZ && !mustCount ? "summary" : "count",
  );
  // Resumen del server: previsualización (turno abierto) en `summary`, y
  // el del turno ya cerrado en `done`.
  const [summary, setSummary] = useState<ShiftDaySummary | null>(null);
  // Sólo bloqueamos la UI esperando el resumen cuando el resumen ES la
  // pantalla. En `count` (arqueo X, arqueo obligatorio, post-cierre) la
  // tabla se pinta ya y el efectivo esperado aparece cuando llega.
  const [summaryLoading, setSummaryLoading] = useState(isZ && !mustCount);
  // Sin red: lo poco que sabemos con certeza desde la cola local.
  const [offlineSummary, setOfflineSummary] = useState<{
    cashOpening: number;
    cashFromQueue: number;
    cashTheoretical: number;
    ticketsInQueue: number;
  } | null>(null);

  // Estado: contador por denominación (entero >= 0). Vacío equivale a 0.
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [syncFailureAccepted, setSyncFailureAccepted] = useState(false);
  const [managerPin, setManagerPin] = useState("");
  const [needsManager, setNeedsManager] = useState(false);
  const [pinReason, setPinReason] = useState<"sync_failed" | "force_close" | null>(null);
  const [failedDocs, setFailedDocs] = useState<FailedDoc[]>([]);
  // v1.9.5-formacion · Frente 3: el checkbox «cerrar igualmente» sólo
  // aparece cuando HAY un motivo, y el copy dice CUÁL es. Dos fuentes:
  //   - syncPendingCount: docs sin sincronizar en el servidor
  //     (PENDING_SYNC + SYNC_FAILED del turno), que reporta el 409
  //     SYNC_PENDING del backend.
  //   - outboxPending: cobros aún en la cola local del dispositivo (no
  //     han llegado al servidor).
  const [syncPendingCount, setSyncPendingCount] = useState(0);
  const [outboxPending, setOutboxPending] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Resultado del POST X — para mostrar el descuadre sin cerrar.
  const [xResult, setXResult] = useState<CashCountResponse | null>(null);
  // Cierre resuelto SIN resumen de server (offline, o el GET del resumen
  // falló justo después de cerrar). Panel local de v1.0-pilotos.
  const [zResult, setZResult] = useState<CashCountResponse | null>(null);

  // v1.11 · previsualización del resumen antes de decidir si se cuenta.
  // Sin red no hay nada que pedir: caemos a la tabla con los datos
  // locales, que es exactamente el camino que montó v1.10.
  useEffect(() => {
    let alive = true;
    if (!navigator.onLine) {
      setSummaryLoading(false);
      setPhase("count");
      void buildOfflineDaySummary(props.shiftId)
        .then((s) => alive && setOfflineSummary(s))
        .catch(() => undefined);
      return () => {
        alive = false;
      };
    }
    void fetchShiftSummary(props.shiftId)
      .then((s) => {
        if (!alive) return;
        setSummary(s);
        setSummaryLoading(false);
      })
      .catch(() => {
        if (!alive) return;
        // Sin resumen no bloqueamos el cierre: se puede seguir contando.
        setSummaryLoading(false);
        setPhase("count");
        void buildOfflineDaySummary(props.shiftId)
          .then((s) => alive && setOfflineSummary(s))
          .catch(() => undefined);
      });
    return () => {
      alive = false;
    };
  }, [isZ, mustCount, props.shiftId]);

  // v1.9.5-formacion · Frente 3: al abrir el cierre Z consultamos la cola
  // local (outbox). Si hay cobros en vuelo que aún no llegaron al
  // servidor, es un motivo para mostrar el aviso de cierre. Best-effort:
  // un fallo de IDB no debe bloquear el modal.
  useEffect(() => {
    if (!isZ) return;
    let alive = true;
    void outboxCounts()
      .then((c) => {
        if (alive) setOutboxPending(c.pending + c.rejected);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [isZ]);

  // Suma local para feedback inmediato del cajero. El total
  // autoritativo lo calcula el backend (ese va al ShiftCashCount).
  // Mantenemos céntimos para evitar el clásico 0.1+0.2=0.30000004.
  const totalEur = useMemo(() => {
    let cents = 0;
    for (const d of DENOMINATIONS) {
      const n = parseInt(counts[d.key] ?? "", 10);
      if (Number.isFinite(n) && n > 0) {
        cents += Math.round(d.valueEur * 100) * n;
      }
    }
    return cents / 100;
  }, [counts]);

  // v1.11 · el efectivo esperado va DELANTE mientras se cuenta, no
  // después. Contar a ciegas y descubrir el descuadre al final es
  // exactamente lo que este bloque quita.
  const expectedCash =
    summary?.cashTheoretical ?? offlineSummary?.cashTheoretical ?? null;
  const liveDescuadre =
    expectedCash != null ? Math.round((totalEur - expectedCash) * 100) / 100 : null;

  function setCount(key: string, raw: string): void {
    // Sólo dígitos. Vacío permitido para que el cajero pueda borrar.
    const cleaned = raw.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
    setCounts((curr) => ({ ...curr, [key]: cleaned }));
  }

  function buildDenominationsPayload(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const d of DENOMINATIONS) {
      const n = parseInt(counts[d.key] ?? "", 10);
      if (Number.isFinite(n) && n > 0) out[d.key] = n;
    }
    return out;
  }

  // Traduce el error del backend a estado de UI. Compartido por el
  // cierre sin conteo (close-day) y el cierre con arqueo (cash-count Z):
  // los dos pasan por los mismos guards del server.
  function applyCloseError(err: ApiError): void {
    if (err.code === "CASH_COUNT_REQUIRED") {
      // v1.11 · el tenant exige arqueo (el flag pudo cambiar entre que se
      // pintó la tarjeta y se pulsó confirmar). A contar, sin drama.
      setPhase("count");
      setError(err.message);
      return;
    }
    if (err.code === "MANAGER_PIN_REQUIRED") {
      setNeedsManager(true);
      const reason = (err.data as { reason?: string } | undefined)?.reason;
      setPinReason(reason === "sync_failed" ? "sync_failed" : "force_close");
      setError(
        reason === "sync_failed"
          ? "Hay tickets rechazados por Holded. Pide al encargado que introduzca su PIN para cerrar el turno."
          : "Este cierre requiere PIN de encargado.",
      );
      return;
    }
    if (err.code === "SYNC_PENDING") {
      const detail = err.data as
        | {
            failedTickets?: FailedDoc[];
            failedRefunds?: FailedDoc[];
            pendingSync?: number;
            failed?: number;
          }
        | undefined;
      setFailedDocs([...(detail?.failedTickets ?? []), ...(detail?.failedRefunds ?? [])]);
      // Frente 3: total de docs sin sincronizar en el servidor, para
      // que el copy del checkbox diga cuántos son.
      setSyncPendingCount((detail?.pendingSync ?? 0) + (detail?.failed ?? 0));
      // v1.5-B §3.c: mismo copy que la pantalla de turno colgado —
      // cerrar no es un problema, sólo requiere aceptación explícita.
      setError(
        "Hay tickets sin sincronizar con Holded. Puedes cerrar el turno igualmente: las ventas no se ven afectadas y los tickets pendientes se recuperarán automáticamente. Marca el aviso para confirmar.",
      );
      return;
    }
    setError(err.message);
  }

  // Cierre resuelto: los dos caminos terminan en la MISMA tarjeta. Si el
  // GET del resumen falla justo ahora, caemos al panel local en vez de
  // dejar al cajero sin ver nada — cerrar ya está hecho.
  async function finishWithSummary(fallback: CashCountResponse | null): Promise<void> {
    try {
      setSummary(await fetchShiftSummary(props.shiftId));
      setPhase("done");
    } catch {
      if (fallback) setZResult(fallback);
      setPhase("done");
    }
  }

  // v1.11 · cerrar SIN contar. El caso normal.
  async function confirmWithoutCount(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await apiWithCashier(`/shift/${props.shiftId}/close-day`, {
        method: "POST",
        body: {
          syncFailureAccepted: syncFailureAccepted || undefined,
          managerPin: managerPin || undefined,
        },
      });
      await finishWithSummary(null);
    } catch (err) {
      if (err instanceof ApiError) {
        applyCloseError(err);
      } else {
        setError("No se pudo cerrar el turno. Revisa la conexión.");
      }
    } finally {
      setBusy(false);
    }
  }

  // v1.10-offline-un-terminal §3: cierre/arqueo SIN red. El informe Z se
  // arma con datos LOCALES (fondo de caja del turno local + efectivo neto
  // de las ventas que siguen en la cola local) y el POST se encola como
  // cash-count. Al recuperar la red, el outbox lo sube (idempotente).
  async function submitOffline() {
    const local = await getLocalShift().catch(() => null);
    const cashOpening = local?.cashOpening ?? 0;
    let cashSales = 0;
    try {
      const items = await outboxList();
      for (const it of items) {
        const bodyShiftId =
          typeof it.body.shiftId === "string" ? it.body.shiftId : undefined;
        const belongs =
          it.shiftLocalId === props.shiftId || bodyShiftId === props.shiftId;
        if (!belongs) continue;
        const payments = Array.isArray(it.body.payments)
          ? (it.body.payments as Array<{ method?: string; amount?: unknown }>)
          : [];
        for (const p of payments) {
          if (p?.method !== "CASH") continue;
          const amt =
            typeof p.amount === "number" ? p.amount : parseFloat(String(p.amount));
          if (Number.isFinite(amt)) cashSales += it.kind === "refund" ? -amt : amt;
        }
      }
    } catch {
      /* best-effort: el Z local puede quedar sin el neto de ventas */
    }
    const cashTheoretical = Math.round((cashOpening + cashSales) * 100) / 100;
    const descuadre = Math.round((totalEur - cashTheoretical) * 100) / 100;
    // Sólo etiquetamos con turno local si aún no resolvió (para que el
    // outbox reescriba el :id del path local → server al sincronizar).
    const shiftLocalId =
      local && local.serverId === null && local.localId === props.shiftId
        ? local.localId
        : undefined;
    await outboxAdd({
      externalId: newId(),
      kind: "cash-count",
      path: `/shift/${props.shiftId}/cash-count`,
      body: { kind: mode, denominations: buildDenominationsPayload() },
      label: mode === "Z" ? "Cierre de turno (Z)" : "Arqueo X",
      total: totalEur,
      shiftLocalId,
    });
    const result: CashCountResponse = {
      kind: mode,
      cashCounted: totalEur,
      cashTheoretical,
      descuadre,
    };
    if (mode === "Z") {
      await closeLocalShift().catch(() => {});
      setZResult(result);
      setPhase("done");
    } else {
      setXResult(result);
    }
  }

  async function submit() {
    if (busy) return;
    setBusy(true);
    setError(null);
    // Sin red: cierre/arqueo offline directo.
    if (!navigator.onLine) {
      try {
        await submitOffline();
      } catch {
        setError("No se pudo registrar el cierre offline.");
      } finally {
        setBusy(false);
      }
      return;
    }
    try {
      const res = await apiWithCashier<CashCountResponse>(
        `/shift/${props.shiftId}/cash-count`,
        {
          method: "POST",
          body: {
            kind: mode,
            denominations: buildDenominationsPayload(),
            syncFailureAccepted: mode === "Z" ? syncFailureAccepted : undefined,
            managerPin: mode === "Z" && managerPin ? managerPin : undefined,
          },
        },
      );
      if (mode === "X") {
        setXResult(res);
      } else {
        await finishWithSummary(res);
      }
    } catch (err) {
      if (err instanceof ApiError && err.code === "UNAUTHENTICATED") {
        // Sesión offline sin JWT todavía: registramos el cierre en local.
        await submitOffline().catch(() =>
          setError("No se pudo registrar el cierre offline."),
        );
      } else if (err instanceof ApiError) {
        applyCloseError(err);
      } else {
        // Error de red a mitad del cierre (la sesión era online pero cayó
        // la conexión): degradamos a cierre offline.
        await submitOffline().catch(() =>
          setError("No se pudo registrar el cierre offline."),
        );
      }
    } finally {
      setBusy(false);
    }
  }

  // El cajero confirmó la tarjeta final. Sellamos el ack para que no le
  // vuelva a aparecer mañana y salimos. Best-effort: si el ack falla, el
  // turno ya está cerrado y la tarjeta reaparecerá una vez más — molesto,
  // no grave.
  async function confirmDone(): Promise<void> {
    if (summary?.shift.id) {
      await ackDaySummary(summary.shift.id).catch(() => undefined);
    }
    props.onClosed();
  }

  // Aviso visual fuerte si el descuadre del X supera 5€ en valor absoluto.
  const showXDescuadreAlert = xResult && Math.abs(xResult.descuadre) > 5;

  // v1.9.5-formacion · Frente 3: motivos concretos por los que ofrecemos
  // el aviso «cerrar igualmente». Si la lista está vacía, no hay checkbox
  // (antes aparecía siempre, sin explicar el motivo — bug B3 del mapa de
  // simulaciones 2026-07-05).
  const closeReasons: string[] = [];
  if (syncPendingCount > 0) {
    closeReasons.push(
      syncPendingCount === 1
        ? "1 documento pendiente de subir a Holded"
        : `${syncPendingCount} documentos pendientes de subir a Holded`,
    );
  }
  if (outboxPending > 0) {
    closeReasons.push(
      outboxPending === 1
        ? "1 cobro en la cola local del dispositivo"
        : `${outboxPending} cobros en la cola local del dispositivo`,
    );
  }
  const hasCloseReason = closeReasons.length > 0;

  const syncBlock = isZ && (
    <>
      {failedDocs.length > 0 && (
        <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 px-3 py-3">
          <div className="flex items-center gap-2 text-[13px] font-semibold text-red-800 mb-2">
            <AlertCircle className="w-4 h-4" />
            {failedDocs.length} documento{failedDocs.length === 1 ? "" : "s"} rechazado
            {failedDocs.length === 1 ? "" : "s"} por Holded en este turno
          </div>
          <ul className="space-y-1.5 max-h-40 overflow-y-auto">
            {failedDocs.map((d) => (
              <li
                key={`${d.kind}-${d.id}`}
                className="flex items-center justify-between gap-2 text-[12.5px] text-red-900 bg-white/60 rounded-lg px-2.5 py-1.5"
              >
                <span className="tabular-nums font-medium shrink-0">
                  {d.kind === "refund" ? "↩ " : ""}
                  {d.internalNumber}
                </span>
                <span className="truncate flex-1 text-red-700">{d.errorSummary}</span>
                <span className="tabular-nums shrink-0">{formatEur(d.total)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11.5px] text-red-700">
            Avisa al encargado. Si cierra, tendrá que introducir su PIN.
          </p>
        </div>
      )}

      {/* v1.9.5-formacion · Frente 3: sólo si hay motivo, y el copy
          dice cuál. Sin nada pendiente no hay checkbox. */}
      {hasCloseReason && (
        <label
          htmlFor="syncFailureAccepted"
          className="flex items-start gap-2 text-[12.5px] text-slate-600 mb-4 cursor-pointer"
        >
          <input
            id="syncFailureAccepted"
            name="syncFailureAccepted"
            type="checkbox"
            checked={syncFailureAccepted}
            onChange={(e) => setSyncFailureAccepted(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-slate-300 text-mipiace-coral focus:ring-mipiace-coral/30"
          />
          <span>
            Lo entiendo, cerrar el turno igualmente. Hay {closeReasons.join(" y ")}. Las
            ventas no se ven afectadas y los tickets pendientes se recuperarán
            automáticamente.
          </span>
        </label>
      )}

      {(needsManager || props.cashierRole === "CASHIER" || pinReason === "sync_failed") && (
        <>
          <label
            htmlFor="managerPin"
            className="block text-[13px] font-medium text-mipiace-ink mb-2"
          >
            {pinReason === "sync_failed"
              ? "PIN de encargado (requerido por tickets fallados)"
              : "PIN de encargado (si aplica)"}
          </label>
          <input
            id="managerPin"
            name="managerPin"
            value={managerPin}
            onChange={(e) => setManagerPin(e.target.value.replace(/\D/g, "").slice(0, 8))}
            inputMode="numeric"
            placeholder="••••"
            className="w-full h-14 mb-4 px-4 text-[18px] font-semibold tracking-[0.3em] bg-mipiace-stone border border-transparent rounded-2xl focus:ring-2 focus:ring-mipiace-coral/40 focus:border-mipiace-coral/30 focus:bg-white tabular-nums focus:outline-none"
          />
        </>
      )}
    </>
  );

  // ── Fase `summary`: la tarjeta ES la pantalla. ──────────────────────
  if (phase === "summary") {
    return (
      <Shell onClose={props.onClose}>
        {summaryLoading || !summary ? (
          <div className="flex items-center justify-center gap-2 py-14 text-[14px] text-slate-500">
            <Loader2 className="w-4 h-4 animate-spin" />
            Preparando el resumen…
          </div>
        ) : (
          <>
            <DaySummaryCard
              summary={summary}
              title="Cerrar el día"
              busy={busy}
              confirmLabel="Cerrar turno"
              // v1.5-hotfix2 sigue vigente en su casa nueva: con tickets sin
              // sincronizar hay que marcar la aceptación antes de cerrar.
              confirmDisabled={hasCloseReason && !syncFailureAccepted}
              onConfirm={confirmWithoutCount}
              onCountCash={() => {
                setError(null);
                setPhase("count");
              }}
              error={error}
            />
            {(failedDocs.length > 0 || hasCloseReason || needsManager) && (
              <div className="mt-4">{syncBlock}</div>
            )}
            <button
              type="button"
              onClick={props.onClose}
              disabled={busy}
              className="mt-2 w-full min-h-[44px] text-[13.5px] text-slate-500 hover:text-mipiace-ink disabled:opacity-50"
            >
              Cancelar
            </button>
          </>
        )}
      </Shell>
    );
  }

  // ── Fase `done`: la misma tarjeta, ya del turno cerrado. ────────────
  if (phase === "done") {
    return (
      <Shell onClose={confirmDone}>
        {summary ? (
          <DaySummaryCard
            summary={summary}
            title="Turno cerrado"
            confirmLabel="Hecho"
            onConfirm={confirmDone}
          />
        ) : (
          // Sin resumen de server (cierre offline, o el GET falló justo
          // después). El panel local de v1.0-pilotos sigue diciendo la
          // verdad de lo que este dispositivo sabe.
          <div className="bg-white rounded-3xl border border-slate-200 p-5 sm:p-7">
            <h2 className="text-[18px] font-semibold text-mipiace-ink mb-1">
              Turno cerrado
            </h2>
            <p className="text-[13px] text-slate-500 mb-4 flex items-start gap-1.5">
              <WifiOff className="w-4 h-4 mt-px shrink-0 text-slate-400" />
              Sin conexión: estas cifras salen de este dispositivo. El resumen
              completo estará disponible al recuperar la red.
            </p>
            {zResult && <ResultPanel result={zResult} alert={Math.abs(zResult.descuadre) > 5} />}
            <button
              type="button"
              onClick={props.onClosed}
              className="w-full h-14 rounded-2xl bg-mipiace-coral hover:bg-mipiace-coral-dark text-white text-[15px] font-medium"
            >
              Hecho
            </button>
          </div>
        )}
      </Shell>
    );
  }

  // ── Fase `count`: la tabla de siempre, con el esperado delante. ─────
  return (
    <Shell onClose={props.onClose}>
      <div className="bg-white w-full rounded-3xl border border-slate-200 p-5 sm:p-7">
        <h2 className="text-[18px] font-semibold text-mipiace-ink mb-1">
          {isZ ? "Cuadrar caja y cerrar turno" : "Arqueo X (control)"}
        </h2>
        <p className="text-[13px] text-slate-500 mb-4">
          {isZ
            ? "Cuenta el efectivo del cajón por denominaciones. Generamos el informe Z y se archiva el turno."
            : "Cuenta el efectivo del cajón sin cerrar el turno. Útil para arqueos intermedios."}
        </p>

        {xResult ? (
          <ResultPanel result={xResult} alert={showXDescuadreAlert ?? false} />
        ) : (
          <>
            {/* v1.11 · el esperado va DELANTE, mientras se cuenta. */}
            {expectedCash != null && (
              <div className="mb-4 rounded-2xl bg-mipiace-stone px-4 py-3">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-[12.5px] text-slate-600">
                    Efectivo esperado en el cajón
                  </span>
                  <span className="text-[18px] font-semibold tabular-nums text-mipiace-ink">
                    {formatEur(expectedCash)}
                  </span>
                </div>
                {liveDescuadre != null && totalEur > 0 && (
                  <div
                    className={
                      "mt-1.5 flex items-baseline justify-between gap-3 text-[12.5px] font-medium " +
                      (Math.abs(liveDescuadre) > 5 ? "text-red-700" : "text-slate-600")
                    }
                  >
                    <span>Llevas contado {formatEur(totalEur)} · descuadre</span>
                    <span className="tabular-nums">
                      {liveDescuadre >= 0 ? "+" : ""}
                      {formatEur(liveDescuadre)}
                    </span>
                  </div>
                )}
                {offlineSummary && (
                  <div className="mt-1.5 flex items-start gap-1.5 text-[11.5px] text-slate-500">
                    <WifiOff className="w-3.5 h-3.5 mt-px shrink-0" />
                    Sin conexión: fondo de caja {formatEur(offlineSummary.cashOpening)} +
                    efectivo de {offlineSummary.ticketsInQueue} cobro
                    {offlineSummary.ticketsInQueue === 1 ? "" : "s"} en la cola local.
                    Las ventas ya subidas no cuentan aquí.
                  </div>
                )}
              </div>
            )}

            <div className="rounded-2xl border border-slate-200 overflow-x-auto mb-4">
              <table className="w-full min-w-[280px] text-[13.5px]">
                <thead className="bg-mipiace-stone text-slate-500 text-[12px] uppercase tracking-wider">
                  <tr>
                    <th className="text-left py-2 px-3 font-medium">Denominación</th>
                    <th className="text-center py-2 px-2 font-medium w-20">Cant.</th>
                    <th className="text-right py-2 px-3 font-medium w-28">Subtotal</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {DENOMINATIONS.map((d) => {
                    const n = parseInt(counts[d.key] ?? "", 10);
                    const subtotal = Number.isFinite(n) && n > 0 ? d.valueEur * n : 0;
                    return (
                      <tr key={d.key} className="hover:bg-slate-50">
                        <td className="py-1.5 px-3 text-mipiace-ink">{d.label}</td>
                        <td className="py-1.5 px-2">
                          <input
                            value={counts[d.key] ?? ""}
                            onChange={(e) => setCount(d.key, e.target.value)}
                            onFocus={(e) => e.target.select()}
                            inputMode="numeric"
                            placeholder="0"
                            aria-label={`Cantidad de ${d.label}`}
                            className="w-full h-11 px-2 text-center tabular-nums bg-mipiace-stone border border-transparent rounded-lg focus:bg-white focus:border-mipiace-coral/30 focus:ring-1 focus:ring-mipiace-coral/40 focus:outline-none"
                          />
                        </td>
                        <td className="py-1.5 px-3 text-right tabular-nums text-slate-500">
                          {subtotal > 0 ? formatEur(subtotal) : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot className="bg-mipiace-stone">
                  <tr>
                    <td
                      colSpan={2}
                      className="py-2.5 px-3 text-[13px] font-medium text-mipiace-ink"
                    >
                      Total contado
                    </td>
                    <td className="py-2.5 px-3 text-right text-[15px] font-semibold tabular-nums text-mipiace-ink">
                      {formatEur(totalEur)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {syncBlock}
          </>
        )}

        <div className="flex gap-2.5 pt-1">
          <button
            type="button"
            onClick={
              // v1.11 · si venimos del resumen, "Volver" regresa allí en vez
              // de tirar el cierre entero.
              summary && !xResult && isZ && !mustCount
                ? () => {
                    setError(null);
                    setPhase("summary");
                  }
                : props.onClose
            }
            disabled={busy}
            className="flex-1 h-12 rounded-2xl border border-slate-200 hover:bg-slate-50 text-[13.5px] text-mipiace-ink-soft font-medium"
          >
            {xResult ? "Cerrar" : summary && isZ && !mustCount ? "Volver" : "Cancelar"}
          </button>
          {!xResult && (
            <button
              type="button"
              onClick={submit}
              disabled={busy}
              className="flex-1 h-12 rounded-2xl bg-mipiace-coral hover:bg-mipiace-coral-dark text-white text-[14px] font-medium disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {busy && <Loader2 className="w-4 h-4 animate-spin" />}
              {isZ ? "Cerrar turno" : "Guardar arqueo X"}
            </button>
          )}
        </div>
        {error && (
          <div className="mt-4 flex items-start gap-2 text-[13px] text-red-700 bg-red-50 rounded-xl px-3.5 py-2.5">
            <AlertCircle className="w-4 h-4 mt-px shrink-0" />
            <span>{error}</span>
          </div>
        )}
      </div>
    </Shell>
  );
}

// Contenedor del modal. Extraído para que las tres fases compartan el
// mismo marco (y el mismo cierre al tocar fuera).
function Shell({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 bg-mipiace-ink/40 flex items-end sm:items-center justify-center p-3 sm:p-4 font-sans overflow-y-auto"
      onClick={onClose}
    >
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-lg my-auto">
        {children}
      </div>
    </div>
  );
}

// Panel de resultado del arqueo X y del cierre offline. Es el de
// v1.0-pilotos Lote 3: cuando hay server, la tarjeta de resumen lo
// sustituye; cuando no, este sigue siendo lo más honesto que podemos
// pintar con datos del dispositivo.
function ResultPanel({
  result,
  alert,
}: {
  result: CashCountResponse;
  alert: boolean;
}) {
  return (
    <div className="rounded-2xl bg-mipiace-stone p-4 mb-4">
      {result.breakdown && (
        <div className="mb-3 rounded-xl bg-white border border-slate-200 overflow-x-auto">
          <table className="w-full min-w-[280px] text-[12.5px]">
            <thead className="text-slate-400 text-[10.5px] uppercase tracking-wider">
              <tr>
                <th className="text-left py-1.5 px-2.5 font-medium">Método</th>
                <th className="text-right py-1.5 px-2 font-medium">Bruto</th>
                <th className="text-right py-1.5 px-2 font-medium">Devol.</th>
                <th className="text-right py-1.5 px-2.5 font-medium">Neto</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {result.breakdown.methods.map((m) => (
                <tr key={m.method}>
                  <td className="py-1.5 px-2.5 text-mipiace-ink">
                    {METHOD_LABEL[m.method] ?? m.method}
                  </td>
                  <td className="py-1.5 px-2 text-right tabular-nums text-slate-600">
                    {formatEur(m.gross)}
                  </td>
                  <td className="py-1.5 px-2 text-right tabular-nums text-slate-600">
                    {m.refunds > 0 ? `−${formatEur(m.refunds)}` : "—"}
                  </td>
                  <td className="py-1.5 px-2.5 text-right tabular-nums font-medium text-mipiace-ink">
                    {formatEur(m.net)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-mipiace-stone/60">
              <tr className="text-[12.5px]">
                <td className="py-1.5 px-2.5 font-medium text-mipiace-ink">Ventas netas</td>
                <td className="py-1.5 px-2 text-right tabular-nums text-slate-500">
                  {formatEur(result.breakdown.grossSales)}
                </td>
                <td className="py-1.5 px-2 text-right tabular-nums text-slate-500">
                  {result.breakdown.refundsTotal > 0
                    ? `−${formatEur(result.breakdown.refundsTotal)}`
                    : "—"}
                </td>
                <td className="py-1.5 px-2.5 text-right tabular-nums font-semibold text-mipiace-ink">
                  {formatEur(result.breakdown.netSales)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      <div className="space-y-1.5 text-[14px]">
        <div className="flex justify-between">
          <span className="text-slate-500">Cash esperado</span>
          <span className="tabular-nums text-mipiace-ink">
            {formatEur(result.cashTheoretical)}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-500">Cash contado</span>
          <span className="tabular-nums text-mipiace-ink">
            {formatEur(result.cashCounted)}
          </span>
        </div>
        <div
          className={
            "flex justify-between pt-2 border-t border-slate-200 font-medium " +
            (alert ? "text-red-700" : "text-mipiace-ink")
          }
        >
          <span>Descuadre</span>
          <span className="tabular-nums">
            {result.descuadre >= 0 ? "+" : ""}
            {formatEur(result.descuadre)}
          </span>
        </div>
      </div>
      {alert && (
        <div className="mt-3 text-[12.5px] text-red-700 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          Descuadre &gt; 5 €. Recuento de control sugerido.
        </div>
      )}
    </div>
  );
}
