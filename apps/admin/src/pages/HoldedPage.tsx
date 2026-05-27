// v1.3-Operativa-Extra · Lote 2: panel para que el OWNER fuerce el
// sync con Holded sin pasar por super-admin. Muestra estado del último
// sync y un botón que pollea /catalog/sync-status durante 90s tras
// disparar el sync, refrescando el progreso.

import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Check, RotateCcw } from "lucide-react";

import { AdminShell } from "../AdminShell.js";
import { api, ApiError, clearTokens } from "../api.js";
import {
  CenteredLoader,
  FieldError,
  formatRelative,
  PrimaryButton,
  SuccessBanner,
} from "../ui.js";

interface SyncStatusResponse {
  lastIncrementalSyncAt: string | null;
  stats: Record<string, unknown> | null;
  errors: unknown[];
}

const POLL_DURATION_MS = 90_000;
const POLL_INTERVAL_MS = 5_000;

export function HoldedPage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<SyncStatusResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [polling, setPolling] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollingRef = useRef<{ cancelled: boolean } | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<SyncStatusResponse>("/catalog/sync-status")
      .then((res) => {
        if (!cancelled) setStatus(res);
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) {
          clearTokens();
          navigate("/login", { replace: true });
        } else if (err instanceof ApiError) {
          setError(err.message);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  // Garantiza que abandonar la página cancela el polling.
  useEffect(() => {
    return () => {
      if (pollingRef.current) pollingRef.current.cancelled = true;
    };
  }, []);

  async function onForceSync() {
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      await api<{ jobId: string; queuedAt: string }>("/catalog/sync-now", {
        method: "POST",
        body: {},
      });
      setSuccess("Sync encolado. Refrescando estado…");
      startPolling();
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
      else setError("Error inesperado");
    } finally {
      setBusy(false);
    }
  }

  function startPolling() {
    if (pollingRef.current) pollingRef.current.cancelled = true;
    const ref = { cancelled: false };
    pollingRef.current = ref;
    setPolling(true);
    const startedAt = Date.now();
    const tick = async () => {
      if (ref.cancelled) return;
      try {
        const res = await api<SyncStatusResponse>("/catalog/sync-status");
        if (ref.cancelled) return;
        setStatus(res);
      } catch {
        // Tolera errores puntuales del polling — sigue intentando.
      }
      if (ref.cancelled) return;
      if (Date.now() - startedAt >= POLL_DURATION_MS) {
        setPolling(false);
        return;
      }
      setTimeout(tick, POLL_INTERVAL_MS);
    };
    setTimeout(tick, POLL_INTERVAL_MS);
  }

  if (!status) return <CenteredLoader label="Cargando estado…" />;

  const stats = status.stats ?? {};
  const productsUpdated = numberOrNull(stats.productsUpdated);
  const productsSeen = numberOrNull(stats.productsSeen);
  const durationMs = numberOrNull(stats.durationMs);

  return (
    <AdminShell title="Sincronización con Holded">
      <p className="text-[13.5px] text-slate-500 mb-5 -mt-2">
        El TPV se sincroniza automáticamente cada 15 minutos. Si has hecho
        un cambio importante en Holded (nuevo producto, ajuste de precio,
        nuevo modificador) y necesitas verlo ya, fuerza una sincronización
        desde aquí. Sólo permitimos una manual por minuto para no
        machacar la API de Holded.
      </p>

      {success && <SuccessBanner message={success} />}
      {error && <FieldError message={error} />}

      <section className="bg-white rounded-2xl border border-slate-200 p-6 md:p-7 mb-5">
        <h2 className="text-[16px] font-semibold text-mipiace-ink tracking-tight mb-1">
          Último sync
        </h2>
        <p className="text-[13px] text-slate-500 mb-4">
          {status.lastIncrementalSyncAt
            ? `Completado ${formatRelative(status.lastIncrementalSyncAt)}.`
            : "Aún sin sincronización incremental."}
        </p>

        {(productsSeen !== null || productsUpdated !== null) && (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
            {productsSeen !== null && <Stat value={productsSeen} label="vistos" />}
            {productsUpdated !== null && (
              <Stat value={productsUpdated} label="actualizados" />
            )}
            {durationMs !== null && (
              <Stat value={Math.round(durationMs / 1000)} label="segundos" />
            )}
          </div>
        )}

        {status.errors.length > 0 && (
          <div className="mt-4 rounded-xl bg-amber-50 text-amber-800 text-[13px] p-3.5">
            El último sync registró {status.errors.length} error{status.errors.length === 1 ? "" : "es"}.
          </div>
        )}
      </section>

      <section className="bg-white rounded-2xl border border-slate-200 p-6 md:p-7 mb-5">
        <h2 className="text-[16px] font-semibold text-mipiace-ink tracking-tight mb-1">
          Forzar sincronización
        </h2>
        <p className="text-[13px] text-slate-500 mb-4">
          Encola un sync inmediato del catálogo y contactos. El proceso
          tarda unos segundos; el botón quedará deshabilitado durante 60
          segundos para evitar reintentos en cascada.
        </p>
        <PrimaryButton
          type="button"
          onClick={onForceSync}
          busy={busy || polling}
          className="!w-auto"
        >
          {polling ? (
            <>
              <RotateCcw className="w-3.5 h-3.5 animate-spin" />
              Sincronizando…
            </>
          ) : (
            <>
              <Check className="w-3.5 h-3.5" />
              Forzar sync ahora
            </>
          )}
        </PrimaryButton>
      </section>
    </AdminShell>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 px-4 py-3 bg-mipiace-stone/40">
      <div className="text-[20px] font-semibold text-mipiace-ink tabular-nums leading-none">
        {value}
      </div>
      <div className="text-[12px] text-slate-500 mt-1">{label}</div>
    </div>
  );
}

function numberOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
