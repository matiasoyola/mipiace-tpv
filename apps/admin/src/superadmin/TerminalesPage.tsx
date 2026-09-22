import type { ReactElement, ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { superApi, superApiBlob, SuperAdminApiError } from "./api.js";
import { SuperAdminShell } from "./SuperAdminShell.js";

// A5 · Frente 2 · los terminales se dejan ver.
//
// Antes de esto no había forma de saber si un terminal estaba encendido, qué
// versión llevaba o qué le pasaba cuando alguien llamaba. La pantalla está
// ordenada por las preguntas reales del soporte, en el orden en que se hacen:
//
//   1. ¿Está encendido?            → el punto verde
//   2. ¿Cuál es?                   → nombre, tienda y caja, nunca un UUID
//   3. ¿Qué versión lleva?         → y si está desactualizado contra la última
//   4. ¿Está subiendo las ventas?  → cola pendiente y desde cuándo
//   5. ¿Por qué le pasan cosas raras? → red, IP, desvío de reloj
//
// La lista se refresca sola cada 15 s. El canal de los terminales late cada
// 30 s, así que refrescar más rápido sólo repintaría lo mismo.

interface Heartbeat {
  reportedAt: string;
  appVersionName: string | null;
  appVersionCode: number | null;
  bundleBuildHash: string | null;
  bundleTarget: string | null;
  platform: string | null;
  foreignBundle: boolean;
  shiftOpen: boolean;
  shiftOpenedAt: string | null;
  outboxPending: number;
  outboxRejected: number;
  outboxStuckSince: string | null;
  network: string | null;
  localIp: string | null;
  clockSkewSeconds: number | null;
  bootedAt: string | null;
}

interface TerminalRow {
  id: string;
  name: string | null;
  tenantId: string;
  tenantName: string;
  storeId: string;
  storeName: string;
  registerId: string;
  registerName: string;
  pairedAt: string;
  lastSeenAt: string | null;
  revokedAt: string | null;
  online: boolean;
  stale: boolean;
  outdated: boolean | null;
  heartbeat: Heartbeat | null;
}

interface TerminalesResponse {
  latestRelease: { versionCode: number; versionName: string } | null;
  devices: TerminalRow[];
}

const REFRESCO_MS = 15_000;

/** "hace 12 s" / "hace 4 min" / "hace 3 h" / "hace 2 d". Nunca una fecha suelta. */
function hace(iso: string | null, now: number): string {
  if (!iso) return "nunca";
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return `hace ${s} s`;
  if (s < 3600) return `hace ${Math.floor(s / 60)} min`;
  if (s < 86_400) return `hace ${Math.floor(s / 3600)} h`;
  return `hace ${Math.floor(s / 86_400)} d`;
}

/** El desvío de reloj sólo se pinta cuando ya explica algo. */
function desvioRelevante(segundos: number | null): string | null {
  if (segundos == null || Math.abs(segundos) < 60) return null;
  const abs = Math.abs(segundos);
  const magnitud =
    abs < 3600 ? `${Math.round(abs / 60)} min` : `${Math.round(abs / 3600)} h`;
  return segundos > 0 ? `reloj +${magnitud}` : `reloj −${magnitud}`;
}

const RED_LEGIBLE: Record<string, string> = {
  wifi: "wifi",
  cellular: "datos móviles",
  ethernet: "cable",
  none: "sin red",
  unknown: "red desconocida",
};

/** El nombre con el que un humano llama a este terminal. */
export function nombreTerminal(t: {
  name: string | null;
  storeName: string;
  registerName: string;
}): string {
  // "el de la barra de Sirope": si el device tiene nombre propio se respeta;
  // si no, la caja y la tienda son lo más parecido que hay a un nombre.
  return t.name?.trim() || `${t.registerName} · ${t.storeName}`;
}

export function TerminalesPage() {
  const [data, setData] = useState<TerminalesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tenantId, setTenantId] = useState<string>("");
  const [storeId, setStoreId] = useState<string>("");
  const [incluirRevocados, setIncluirRevocados] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    setError(null);
    try {
      const params = new URLSearchParams();
      if (tenantId) params.set("tenantId", tenantId);
      if (storeId) params.set("storeId", storeId);
      if (incluirRevocados) params.set("incluirRevocados", "true");
      const qs = params.toString();
      setData(
        await superApi<TerminalesResponse>(
          `/super-admin/devices${qs ? `?${qs}` : ""}`,
        ),
      );
    } catch (err) {
      setError(
        err instanceof SuperAdminApiError
          ? err.message
          : "No se pudo cargar el inventario de terminales.",
      );
    } finally {
      setLoading(false);
    }
  }, [tenantId, storeId, incluirRevocados]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const id = setInterval(() => {
      setNow(Date.now());
      void load();
    }, REFRESCO_MS);
    return () => clearInterval(id);
  }, [load]);

  // Las opciones de los filtros salen de los propios terminales: no hace falta
  // otra llamada, y no se pueden elegir combinaciones que den lista vacía.
  const tenants = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of data?.devices ?? []) m.set(d.tenantId, d.tenantName);
    return [...m].sort((a, b) => a[1].localeCompare(b[1], "es"));
  }, [data]);

  const stores = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of data?.devices ?? []) {
      if (tenantId && d.tenantId !== tenantId) continue;
      m.set(d.storeId, d.storeName);
    }
    return [...m].sort((a, b) => a[1].localeCompare(b[1], "es"));
  }, [data, tenantId]);

  const devices = data?.devices ?? [];
  const online = devices.filter((d) => d.online).length;
  const desactualizados = devices.filter((d) => d.outdated === true).length;

  return (
    <SuperAdminShell title="Terminales">
      <div className="mx-auto max-w-6xl px-4 py-8">
        <p className="mt-1 text-sm text-slate-600">
          Los terminales de la flota, con lo que cada uno cuenta de sí mismo por
          su canal de soporte. {online} de {devices.length} online
          {data?.latestRelease
            ? ` · última versión publicada ${data.latestRelease.versionName} (${data.latestRelease.versionCode})`
            : " · sin versiones publicadas todavía"}
          .
        </p>

        {desactualizados > 0 ? (
          <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            <strong>{desactualizados}</strong>{" "}
            {desactualizados === 1
              ? "terminal lleva una versión anterior"
              : "terminales llevan una versión anterior"}{" "}
            a la última publicada. Es la lista que decide a qué local hay que ir.
          </p>
        ) : null}

        {error ? (
          <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </p>
        ) : null}

        <div className="mt-6 flex flex-wrap items-end gap-4">
          <div>
            <label
              htmlFor="filtro-tenant"
              className="block text-xs font-medium text-slate-600"
            >
              Cuenta
            </label>
            <select
              id="filtro-tenant"
              value={tenantId}
              onChange={(e) => {
                setTenantId(e.target.value);
                setStoreId("");
              }}
              className="mt-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="">Todas</option>
              {tenants.map(([id, nombre]) => (
                <option key={id} value={id}>
                  {nombre}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="filtro-store"
              className="block text-xs font-medium text-slate-600"
            >
              Tienda
            </label>
            <select
              id="filtro-store"
              value={storeId}
              onChange={(e) => setStoreId(e.target.value)}
              className="mt-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="">Todas</option>
              {stores.map(([id, nombre]) => (
                <option key={id} value={id}>
                  {nombre}
                </option>
              ))}
            </select>
          </div>

          <label className="flex items-center gap-2 pb-2 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={incluirRevocados}
              onChange={(e) => setIncluirRevocados(e.target.checked)}
            />
            Ver también los revocados
          </label>
        </div>

        {loading ? (
          <p className="mt-8 text-sm text-slate-500">Cargando…</p>
        ) : devices.length === 0 ? (
          <p className="mt-8 rounded-lg border border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-600">
            No hay terminales vinculados con estos filtros.
          </p>
        ) : (
          <ul className="mt-6 space-y-3">
            {devices.map((t) => (
              <TerminalCard key={t.id} t={t} now={now} />
            ))}
          </ul>
        )}
      </div>
    </SuperAdminShell>
  );
}

// La lista blanca, tal cual la aplica el servidor. Se repite aquí sólo para
// pintar botones: si alguien añade uno que el servidor no conoce, el servidor
// lo rechaza y lo audita. El orden es el del uso real — lo barato y reversible
// primero, lo que interrumpe al camarero al final.
const COMANDOS: Array<{ accion: string; etiqueta: string; ayuda: string }> = [
  { accion: "decir-version", etiqueta: "Decir versión", ayuda: "Estado al momento, sin esperar al latido" },
  { accion: "volcar-logs", etiqueta: "Volcar logs", ayuda: "Consola del WebView + logcat de la app" },
  { accion: "captura-de-pantalla", etiqueta: "Captura de pantalla", ayuda: "Se borra a las 24 h · el terminal avisa" },
  { accion: "forzar-sync", etiqueta: "Forzar sync", ayuda: "Vacía la cola pendiente ahora" },
  { accion: "recargar", etiqueta: "Recargar", ayuda: "Recarga la pantalla del TPV" },
  { accion: "reiniciar-app", etiqueta: "Reiniciar app", ayuda: "Recrea la app; la cola no se pierde" },
];

interface RespuestaComando {
  commandId: string;
  action: string;
  status: "ok" | "error" | "sin-respuesta";
  data: unknown;
  error: string | null;
}

function AccionesSoporte({ t }: { t: TerminalRow }): ReactElement {
  const [motivo, setMotivo] = useState("");
  const [enviando, setEnviando] = useState<string | null>(null);
  const [respuesta, setRespuesta] = useState<RespuestaComando | null>(null);
  const [errorEnvio, setErrorEnvio] = useState<string | null>(null);
  const [capturaUrl, setCapturaUrl] = useState<string | null>(null);

  // El object URL de una captura no puede quedarse colgado: es una foto con
  // datos de un cliente y sólo debe vivir mientras se está mirando.
  useEffect(() => {
    return () => {
      if (capturaUrl) URL.revokeObjectURL(capturaUrl);
    };
  }, [capturaUrl]);

  async function mandar(accion: string): Promise<void> {
    setEnviando(accion);
    setErrorEnvio(null);
    setRespuesta(null);
    if (capturaUrl) {
      URL.revokeObjectURL(capturaUrl);
      setCapturaUrl(null);
    }
    try {
      const res = await superApi<RespuestaComando>(
        `/super-admin/devices/${t.id}/commands`,
        { method: "POST", body: { action: accion, reason: motivo.trim() } },
      );
      setRespuesta(res);
      if (
        accion === "captura-de-pantalla" &&
        res.status === "ok" &&
        res.data &&
        typeof res.data === "object" &&
        "screenshotId" in res.data
      ) {
        const id = String((res.data as { screenshotId: unknown }).screenshotId);
        const blob = await superApiBlob(
          `/super-admin/devices/screenshots/${id}`,
        );
        setCapturaUrl(URL.createObjectURL(blob));
      }
    } catch (err) {
      setErrorEnvio(
        err instanceof SuperAdminApiError
          ? err.message
          : "No se pudo mandar el comando.",
      );
    } finally {
      setEnviando(null);
    }
  }

  const motivoValido = motivo.trim().length >= 3;

  return (
    <div className="mt-4 border-t border-slate-100 pt-3">
      <label
        htmlFor={`motivo-${t.id}`}
        className="block text-xs font-medium text-slate-600"
      >
        Motivo (obligatorio)
      </label>
      <input
        id={`motivo-${t.id}`}
        type="text"
        value={motivo}
        maxLength={300}
        onChange={(e) => setMotivo(e.target.value)}
        placeholder="Thalía llama: dice que no le imprime"
        className="mt-1 w-full max-w-lg rounded-lg border border-slate-300 px-3 py-2 text-sm"
      />
      <p className="mt-1 text-xs text-slate-500">
        Queda en el registro de auditoría junto al comando. Sin motivo no se
        manda nada.
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        {COMANDOS.map((c) => (
          <button
            key={c.accion}
            type="button"
            title={c.ayuda}
            disabled={!t.online || !motivoValido || enviando !== null}
            onClick={() => void mandar(c.accion)}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {enviando === c.accion ? "Enviando…" : c.etiqueta}
          </button>
        ))}
      </div>

      {!t.online ? (
        <p className="mt-2 text-xs text-slate-500">
          El terminal no tiene canal abierto: no se le puede mandar nada hasta
          que vuelva.
        </p>
      ) : null}

      {errorEnvio ? (
        <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {errorEnvio}
        </p>
      ) : null}

      {respuesta ? (
        <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
          <p className="font-medium text-slate-700">
            {respuesta.action} ·{" "}
            {respuesta.status === "ok"
              ? "hecho"
              : respuesta.status === "error"
                ? `error: ${respuesta.error ?? "sin detalle"}`
                : "no volvió (el terminal no contestó a tiempo)"}
          </p>
          {capturaUrl ? (
            <>
              <img
                src={capturaUrl}
                alt={`Captura del terminal ${nombreTerminal(t)}`}
                className="mt-2 max-w-full rounded border border-slate-300"
              />
              <p className="mt-1 text-xs text-slate-500">
                Se borra sola a las 24 h. El terminal ha avisado en pantalla de
                que se ha tomado.
                {(respuesta.data as { via?: string } | null)?.via === "software"
                  ? " Capturada por la vía de respaldo (dibujado software): puede no reflejar capas de hardware."
                  : ""}
              </p>
            </>
          ) : null}
          {respuesta.status === "ok" &&
          respuesta.action !== "captura-de-pantalla" ? (
            <pre className="mt-2 max-h-72 overflow-auto rounded bg-white p-2 text-xs text-slate-700">
              {JSON.stringify(respuesta.data, null, 2)}
            </pre>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function TerminalCard({ t, now }: { t: TerminalRow; now: number }): ReactElement {
  const hb = t.heartbeat;
  const desvio = desvioRelevante(hb?.clockSkewSeconds ?? null);
  const revocado = t.revokedAt != null;

  return (
    <li
      className={`rounded-xl border px-5 py-4 ${
        revocado
          ? "border-slate-200 bg-slate-50 opacity-70"
          : t.online
            ? "border-slate-200 bg-white"
            : "border-slate-200 bg-slate-50"
      }`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex items-center gap-2">
          <span
            aria-hidden
            className={`inline-block h-2.5 w-2.5 rounded-full ${
              revocado
                ? "bg-slate-400"
                : t.online
                  ? "bg-emerald-500"
                  : "bg-slate-300"
            }`}
          />
          <span className="font-medium text-slate-900">{nombreTerminal(t)}</span>
          <span className="text-sm text-slate-500">· {t.tenantName}</span>
        </div>
        <span className="text-sm text-slate-500">
          {revocado
            ? `revocado ${hace(t.revokedAt, now)}`
            : t.online
              ? "online"
              : `visto ${hace(t.lastSeenAt, now)}`}
        </span>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
        <Dato etiqueta="Versión">
          {hb?.appVersionName
            ? `${hb.appVersionName} (${hb.appVersionCode})`
            : hb?.bundleBuildHash
              ? `build ${hb.bundleBuildHash}`
              : "—"}
          {t.outdated === true ? (
            <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800">
              desactualizado
            </span>
          ) : null}
          {hb?.foreignBundle ? (
            <span className="ml-2 rounded bg-red-100 px-1.5 py-0.5 text-xs font-medium text-red-800">
              bundle ajeno
            </span>
          ) : null}
        </Dato>

        <Dato etiqueta="Turno">
          {hb == null
            ? "—"
            : hb.shiftOpen
              ? `abierto ${hace(hb.shiftOpenedAt, now)}`
              : "cerrado"}
        </Dato>

        <Dato etiqueta="Cola pendiente">
          {hb == null ? (
            "—"
          ) : hb.outboxPending === 0 && hb.outboxRejected === 0 ? (
            "vacía"
          ) : (
            <span className={hb.outboxPending > 0 ? "text-amber-800" : ""}>
              {hb.outboxPending} pendiente{hb.outboxPending === 1 ? "" : "s"}
              {hb.outboxRejected > 0 ? ` · ${hb.outboxRejected} rechazada(s)` : ""}
              {hb.outboxStuckSince ? ` · desde ${hace(hb.outboxStuckSince, now)}` : ""}
            </span>
          )}
        </Dato>

        <Dato etiqueta="Red">
          {hb == null
            ? "—"
            : `${RED_LEGIBLE[hb.network ?? ""] ?? "—"}${
                hb.localIp ? ` · ${hb.localIp}` : ""
              }`}
        </Dato>
      </dl>

      <p className="mt-3 text-xs text-slate-500">
        {t.storeName} · {t.registerName}
        {hb?.bootedAt ? ` · encendido ${hace(hb.bootedAt, now)}` : ""}
        {hb ? ` · último latido ${hace(hb.reportedAt, now)}` : " · nunca se ha anunciado"}
        {desvio ? (
          <span className="ml-1 font-medium text-amber-700">· {desvio}</span>
        ) : null}
      </p>

      {revocado ? null : <AccionesSoporte t={t} />}
    </li>
  );
}

function Dato({
  etiqueta,
  children,
}: {
  etiqueta: string;
  children: ReactNode;
}): ReactElement {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-slate-400">
        {etiqueta}
      </dt>
      <dd className="mt-0.5 text-slate-800">{children}</dd>
    </div>
  );
}
