// v1.0-pilotos · Lote 6 (#22): importador de clientes desde Excel/CSV.
//
// OWNER-only. El archivo se parsea EN EL NAVEGADOR (exceljs / parser
// CSV propio) y las filas normalizadas van al backend, que encola un
// job BullMQ: los contactos se crean EN HOLDED (fuente de verdad, ~5
// req/s con reintentos) y la BD local se rellena con el upsert del
// propio flujo. Esta página hace polling del progreso y al final
// muestra creados / ya existían / con error (+ CSV de errores).

import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertCircle,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Loader2,
  Upload,
} from "lucide-react";

import { AdminShell } from "../AdminShell.js";
import { api, ApiError, clearTokens, readEffectiveAuth } from "../api.js";
import {
  buildErrorsCsv,
  buildTemplateCsv,
  ContactImportParseError,
  parseContactFile,
  MAX_IMPORT_ROWS,
  type ParsedContactRow,
} from "../lib/contactImportParse.js";
import { FieldError, PrimaryButton } from "../ui.js";

interface ImportRowError {
  row: number;
  name: string;
  nif: string | null;
  reason: string;
}

interface ImportStatus {
  jobId: string;
  state: "waiting" | "active" | "completed" | "failed" | "delayed";
  total: number;
  progress: {
    processed: number;
    total: number;
    created: number;
    existed: number;
    errors: number;
  } | null;
  result: {
    created: number;
    existed: number;
    errors: ImportRowError[];
  } | null;
  failedReason: string | null;
}

type Phase =
  | { kind: "idle" }
  | { kind: "parsed"; fileName: string; rows: ParsedContactRow[]; skippedEmpty: number }
  | { kind: "running"; jobId: string; status: ImportStatus | null }
  | { kind: "done"; status: ImportStatus };

function downloadCsv(filename: string, content: string): void {
  // BOM para que Excel abra el CSV con acentos correctos.
  const blob = new Blob(["\uFEFF" + content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function ContactImportPage() {
  const navigate = useNavigate();
  const effective = readEffectiveAuth();
  const canEdit = effective.canEdit;
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  // Polling del job mientras corre.
  useEffect(() => {
    if (phase.kind !== "running") return;
    let cancelled = false;
    const id = setInterval(async () => {
      try {
        const status = await api<ImportStatus>(
          `/admin/contacts/import/${phase.jobId}`,
        );
        if (cancelled) return;
        if (status.state === "completed" || status.state === "failed") {
          setPhase({ kind: "done", status });
        } else {
          setPhase({ kind: "running", jobId: phase.jobId, status });
        }
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 401) {
          clearTokens();
          navigate("/login", { replace: true });
        }
        // 404 (job expirado) u otros: dejamos de pollear con aviso.
        if (err instanceof ApiError && err.status === 404) {
          setError("La importación expiró del registro de trabajos. Revisa la lista de contactos en Holded.");
          setPhase({ kind: "idle" });
        }
      }
    }, 2_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [phase, navigate]);

  async function onFilePicked(file: File) {
    setError(null);
    try {
      const outcome = await parseContactFile(file);
      setPhase({
        kind: "parsed",
        fileName: file.name,
        rows: outcome.rows,
        skippedEmpty: outcome.skippedEmpty,
      });
    } catch (err) {
      setPhase({ kind: "idle" });
      setError(
        err instanceof ContactImportParseError
          ? err.message
          : "No se pudo leer el archivo.",
      );
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function startImport() {
    if (phase.kind !== "parsed" || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ jobId: string; total: number }>(
        "/admin/contacts/import",
        { method: "POST", body: { rows: phase.rows } },
      );
      setPhase({ kind: "running", jobId: res.jobId, status: null });
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
      else setError("Error inesperado");
    } finally {
      setBusy(false);
    }
  }

  const progress =
    phase.kind === "running" && phase.status?.progress
      ? phase.status.progress
      : null;
  const pct = progress ? Math.round((progress.processed / progress.total) * 100) : 0;

  return (
    <AdminShell title="Importar clientes">
      <p className="text-[13.5px] text-slate-500 mb-1 -mt-2">
        Sube un .xlsx o .csv con columnas <strong>nombre</strong> (obligatoria),
        NIF, email y teléfono. Máximo {MAX_IMPORT_ROWS.toLocaleString("es-ES")}{" "}
        filas por archivo.
      </p>
      <p className="text-[13px] text-slate-500 mb-5">
        Los clientes se crean en <strong>Holded</strong> (la fuente de verdad de
        contactos) y quedan disponibles en el TPV. Si un NIF o email ya existe,
        la fila se salta — releer el mismo archivo no duplica.
      </p>

      <div className="mb-5">
        <button
          type="button"
          onClick={() => downloadCsv("plantilla-clientes.csv", buildTemplateCsv())}
          className="inline-flex items-center gap-2 text-[13px] text-mipiace-coral-dark hover:underline font-medium"
        >
          <Download className="w-4 h-4" /> Descargar plantilla
        </button>
      </div>

      {!canEdit && (
        <div className="mb-4 text-[13px] text-amber-800 bg-amber-50 rounded-xl px-3.5 py-2.5">
          Sólo el propietario puede importar clientes.
        </div>
      )}

      {error && <FieldError message={error} />}

      {(phase.kind === "idle" || phase.kind === "parsed") && (
        <div className="bg-white border border-slate-200 rounded-2xl p-6 max-w-xl">
          <input
            ref={fileRef}
            id="contactImportFile"
            type="file"
            accept=".xlsx,.csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onFilePicked(f);
            }}
          />
          <button
            type="button"
            disabled={!canEdit}
            onClick={() => fileRef.current?.click()}
            className="w-full border-2 border-dashed border-slate-200 hover:border-mipiace-coral/40 rounded-2xl p-8 flex flex-col items-center gap-2 text-slate-500 disabled:opacity-50"
          >
            <FileSpreadsheet className="w-8 h-8 text-slate-300" />
            <span className="text-[13.5px] font-medium text-mipiace-ink">
              {phase.kind === "parsed" ? phase.fileName : "Elegir archivo .xlsx o .csv"}
            </span>
            <span className="text-[12px]">
              {phase.kind === "parsed"
                ? `${phase.rows.length.toLocaleString("es-ES")} filas listas para importar` +
                  (phase.skippedEmpty > 0
                    ? ` · ${phase.skippedEmpty} sin nombre (se omiten)`
                    : "")
                : "El archivo se procesa aquí — nada se importa todavía"}
            </span>
          </button>
          {phase.kind === "parsed" && (
            <div className="mt-4 flex justify-end">
              <PrimaryButton type="button" busy={busy} onClick={() => void startImport()}>
                <Upload className="w-4 h-4 mr-1.5 inline" />
                Importar {phase.rows.length.toLocaleString("es-ES")} clientes
              </PrimaryButton>
            </div>
          )}
        </div>
      )}

      {phase.kind === "running" && (
        <div className="bg-white border border-slate-200 rounded-2xl p-6 max-w-xl">
          <div className="flex items-center gap-2.5 text-[14px] font-medium text-mipiace-ink mb-3">
            <Loader2 className="w-4 h-4 animate-spin text-mipiace-coral" />
            Importando… los clientes se crean en Holded a ~5 por segundo.
          </div>
          <div className="h-2.5 rounded-full bg-mipiace-stone overflow-hidden mb-2">
            <div
              className="h-full bg-mipiace-coral transition-all"
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="text-[12.5px] text-slate-500 tabular-nums">
            {progress
              ? `${progress.processed} / ${progress.total} · ${progress.created} creados · ${progress.existed} ya existían · ${progress.errors} con error`
              : "En cola…"}
          </div>
          <p className="mt-3 text-[12px] text-slate-400">
            Puedes salir de esta página — la importación sigue en el servidor.
          </p>
        </div>
      )}

      {phase.kind === "done" && (
        <ImportResultPanel
          status={phase.status}
          onReset={() => setPhase({ kind: "idle" })}
        />
      )}
    </AdminShell>
  );
}

function ImportResultPanel({
  status,
  onReset,
}: {
  status: ImportStatus;
  onReset: () => void;
}) {
  if (status.state === "failed") {
    return (
      <div className="bg-white border border-red-200 rounded-2xl p-6 max-w-xl">
        <div className="flex items-center gap-2 text-[14.5px] font-semibold text-red-800 mb-2">
          <AlertCircle className="w-5 h-5" /> La importación falló
        </div>
        <p className="text-[13px] text-red-700 mb-4">
          {status.failedReason ?? "Error desconocido."} Las filas ya creadas en
          Holded no se duplican si reintentas con el mismo archivo.
        </p>
        <button
          type="button"
          onClick={onReset}
          className="h-10 px-4 rounded-xl border border-slate-200 hover:bg-slate-50 text-[13px] font-medium"
        >
          Volver a intentar
        </button>
      </div>
    );
  }
  const result = status.result;
  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-6 max-w-xl">
      <div className="flex items-center gap-2 text-[14.5px] font-semibold text-mipiace-ink mb-4">
        <CheckCircle2 className="w-5 h-5 text-emerald-600" /> Importación
        terminada
      </div>
      <div className="grid grid-cols-3 gap-3 mb-4">
        <Stat label="Creados" value={result?.created ?? 0} tone="ok" />
        <Stat label="Ya existían" value={result?.existed ?? 0} tone="neutral" />
        <Stat label="Con error" value={result?.errors.length ?? 0} tone="error" />
      </div>
      {result && result.errors.length > 0 && (
        <>
          <ul className="mb-3 max-h-44 overflow-y-auto space-y-1.5">
            {result.errors.slice(0, 20).map((e) => (
              <li
                key={e.row}
                className="text-[12.5px] text-red-900 bg-red-50 rounded-lg px-2.5 py-1.5 flex gap-2"
              >
                <span className="tabular-nums shrink-0 font-medium">
                  fila {e.row}
                </span>
                <span className="truncate flex-1">{e.name}</span>
                <span className="truncate text-red-700">{e.reason}</span>
              </li>
            ))}
            {result.errors.length > 20 && (
              <li className="text-[12px] text-slate-400 px-2.5">
                … y {result.errors.length - 20} más (descarga el CSV).
              </li>
            )}
          </ul>
          <button
            type="button"
            onClick={() =>
              downloadCsv("errores-importacion.csv", buildErrorsCsv(result.errors))
            }
            className="inline-flex items-center gap-2 text-[13px] text-mipiace-coral-dark hover:underline font-medium mb-4"
          >
            <Download className="w-4 h-4" /> Descargar CSV de errores
          </button>
        </>
      )}
      <div>
        <button
          type="button"
          onClick={onReset}
          className="h-10 px-4 rounded-xl border border-slate-200 hover:bg-slate-50 text-[13px] font-medium"
        >
          Importar otro archivo
        </button>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "ok" | "neutral" | "error";
}) {
  const toneClass =
    tone === "ok"
      ? "text-emerald-700 bg-emerald-50"
      : tone === "error" && value > 0
        ? "text-red-700 bg-red-50"
        : "text-mipiace-ink bg-mipiace-stone";
  return (
    <div className={`rounded-xl px-3 py-2.5 ${toneClass}`}>
      <div className="text-[20px] font-semibold tabular-nums">{value}</div>
      <div className="text-[11.5px] uppercase tracking-wider opacity-70">
        {label}
      </div>
    </div>
  );
}
