import { useCallback, useEffect, useState } from "react";

import { superApi, SuperAdminApiError } from "./api.js";
import { SuperAdminShell } from "./SuperAdminShell.js";

// A3-distribución · Frente 5 · consola de descargas de la APK.
//
// Lo que un implantador hace aquí, en orden: mirar qué versión está publicada,
// generar un código, cantárselo por teléfono a quien está delante del terminal,
// y comprobar luego que se ha usado. La pantalla está ordenada por ese guion.
//
// El código se pinta GRANDE a propósito: se dicta en voz alta, muchas veces
// desde un bar con ruido. Y con la caducidad al lado, porque son 60 minutos y
// la pregunta siguiente siempre es "¿hasta cuándo me vale?".

interface ReleaseRow {
  versionCode: number;
  versionName: string;
  fileName: string;
  sha256: string;
  size: number;
  publishedAt: string;
  gitSha: string;
}

interface ActiveCode {
  code: string;
  versionCode: number;
  createdAt: string;
  expiresAt: string;
  maxDownloads: number;
  downloadCount: number;
  note: string | null;
}

interface ReleasesResponse {
  releases: ReleaseRow[];
  activeCodes: ActiveCode[];
}

interface CreatedCode {
  code: string;
  versionCode: number;
  versionName: string;
  expiresAt: string;
  maxDownloads: number;
  note: string | null;
}

function formatBytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("es-ES", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Minutos que le quedan de vida a un código, nunca negativo. */
function minutesLeft(expiresAt: string, now: number): number {
  return Math.max(0, Math.ceil((new Date(expiresAt).getTime() - now) / 60_000));
}

export function DescargasPage() {
  const [data, setData] = useState<ReleasesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState<number | null>(null);
  const [created, setCreated] = useState<CreatedCode | null>(null);
  const [note, setNote] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  // Reloj propio para la cuenta atrás. Sin esto los minutos restantes se
  // congelarían hasta el siguiente render por otro motivo.
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await superApi<ReleasesResponse>("/super-admin/releases"));
    } catch (err) {
      setError(
        err instanceof SuperAdminApiError
          ? err.message
          : "No se pudieron cargar las versiones publicadas.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function generarCodigo(versionCode: number): Promise<void> {
    setCreating(versionCode);
    setError(null);
    try {
      const res = await superApi<CreatedCode>(
        `/super-admin/releases/${versionCode}/download-codes`,
        { method: "POST", body: { note: note.trim() || undefined } },
      );
      setCreated(res);
      setNote("");
      await load();
    } catch (err) {
      setError(
        err instanceof SuperAdminApiError
          ? err.message
          : "No se pudo generar el código.",
      );
    } finally {
      setCreating(null);
    }
  }

  async function copiar(texto: string, etiqueta: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(texto);
      setCopied(etiqueta);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      // Portapapeles denegado (http, permisos): no es un error de la consola.
      setCopied(null);
    }
  }

  return (
    <SuperAdminShell title="Descargas">
      <div className="mx-auto max-w-5xl px-4 py-8">
        <p className="mt-1 text-sm text-slate-600">
          Versiones publicadas de la app Android y códigos de instalación. El
          instalador abre <code className="rounded bg-slate-100 px-1">mipiacetpv.com/apk</code>{" "}
          en el terminal y teclea el código de 6 dígitos.
        </p>

        {error ? (
          <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </p>
        ) : null}

        {created ? (
          <div className="mt-6 rounded-xl border-2 border-[#E97058] bg-[#FDEAE3] px-5 py-5">
            <p className="text-sm font-medium text-[#C75A45]">
              Código para {created.versionName} ({created.versionCode})
            </p>
            <p className="mt-2 font-mono text-5xl font-bold tracking-[0.2em] text-slate-900">
              {created.code}
            </p>
            <p className="mt-3 text-sm text-slate-700">
              Caduca a las {formatDateTime(created.expiresAt)} · hasta{" "}
              {created.maxDownloads} descargas
              {created.note ? ` · ${created.note}` : ""}
            </p>
            <button
              type="button"
              onClick={() => void copiar(created.code, "codigo")}
              className="mt-3 rounded-lg bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              {copied === "codigo" ? "Copiado" : "Copiar código"}
            </button>
          </div>
        ) : null}

        <div className="mt-8">
          <label
            htmlFor="nota"
            className="block text-sm font-medium text-slate-700"
          >
            Nota para el próximo código (opcional)
          </label>
          <input
            id="nota"
            type="text"
            value={note}
            maxLength={120}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Thalía, terminal barra"
            className="mt-1 w-full max-w-md rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
          <p className="mt-1 text-xs text-slate-500">
            Sirve para saber a quién se le dio cada código cuando haya varios
            vivos a la vez.
          </p>
        </div>

        <h2 className="mt-8 text-lg font-semibold text-slate-900">
          Versiones publicadas
        </h2>
        {loading ? (
          <p className="mt-4 text-sm text-slate-500">Cargando…</p>
        ) : data && data.releases.length === 0 ? (
          <p className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
            No hay ninguna versión publicada todavía. Se publican desde el Mac
            con <code>infra/publicar-apk.sh</code>.
          </p>
        ) : (
          <div className="mt-4 space-y-4">
            {data?.releases.map((r) => (
              <div
                key={r.versionCode}
                className="rounded-xl border border-slate-200 bg-white px-5 py-4"
              >
                <div className="flex flex-wrap items-baseline justify-between">
                  <div>
                    <p className="text-lg font-semibold text-slate-900">
                      {r.versionName}{" "}
                      <span className="text-sm font-normal text-slate-500">
                        (versionCode {r.versionCode})
                      </span>
                    </p>
                    <p className="mt-0.5 text-sm text-slate-600">
                      {formatDateTime(r.publishedAt)} · {formatBytes(r.size)} ·
                      commit{" "}
                      <code className="rounded bg-slate-100 px-1">
                        {r.gitSha}
                      </code>
                    </p>
                  </div>
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      disabled={creating === r.versionCode}
                      onClick={() => void generarCodigo(r.versionCode)}
                      className="rounded-lg bg-[#E97058] px-4 py-2 text-sm font-semibold text-white hover:bg-[#C75A45] disabled:opacity-50"
                    >
                      {creating === r.versionCode
                        ? "Generando…"
                        : "Generar código de instalación"}
                    </button>
                    <a
                      href={`/api/super-admin/releases/${r.versionCode}/apk`}
                      className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                    >
                      Descargar
                    </a>
                  </div>
                </div>

                <div className="mt-3 border-t border-slate-100 pt-3">
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                    SHA-256
                  </p>
                  <div className="mt-1 flex items-start gap-2">
                    <code className="break-all font-mono text-xs text-slate-700">
                      {r.sha256}
                    </code>
                    <button
                      type="button"
                      onClick={() => void copiar(r.sha256, r.sha256)}
                      className="shrink-0 rounded border border-slate-300 px-2 py-0.5 text-xs text-slate-600 hover:bg-slate-50"
                    >
                      {copied === r.sha256 ? "Copiado" : "Copiar"}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        <h2 className="mt-10 text-lg font-semibold text-slate-900">
          Códigos activos
        </h2>
        {!loading && data && data.activeCodes.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">
            Ningún código vivo ahora mismo.
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="py-2 pr-4">Código</th>
                  <th className="py-2 pr-4">Versión</th>
                  <th className="py-2 pr-4">Caduca en</th>
                  <th className="py-2 pr-4">Descargas</th>
                  <th className="py-2">Nota</th>
                </tr>
              </thead>
              <tbody>
                {data?.activeCodes.map((c) => (
                  <tr key={c.code} className="border-b border-slate-100">
                    <td className="py-2 pr-4 font-mono text-base font-semibold tracking-widest">
                      {c.code}
                    </td>
                    <td className="py-2 pr-4">{c.versionCode}</td>
                    <td className="py-2 pr-4">
                      {minutesLeft(c.expiresAt, now)} min
                    </td>
                    <td className="py-2 pr-4">
                      {c.downloadCount} / {c.maxDownloads}
                    </td>
                    <td className="py-2 text-slate-600">{c.note ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </SuperAdminShell>
  );
}
