// Gestión de dispositivos emparejados + generación de códigos
// (B3 §1.4). El propietario revoca dispositivos perdidos/robados y
// genera nuevos códigos para emparejar tablets.

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Calculator, Check, ChevronDown, Copy } from "lucide-react";

import { AdminShell } from "../AdminShell.js";
import { api, ApiError, clearTokens } from "../api.js";
import {
  CenteredLoader,
  FieldError,
  formatRelative,
  OutlineButton,
  PrimaryButton,
} from "../ui.js";

interface DeviceRow {
  id: string;
  name: string | null;
  pairedAt: string;
  lastSeenAt: string | null;
  userAgent: string | null;
  revokedAt: string | null;
  lastKnownIpCountry: string | null;
  registerId: string;
  registerName: string;
  storeName: string;
}

interface ActiveCodeRow {
  id: string;
  code: string;
  expiresAt: string;
  registerId: string;
  registerName: string;
}

interface RegisterRow {
  id: string;
  name: string;
  storeName: string;
}

export function DevicesPage() {
  const navigate = useNavigate();
  const [devices, setDevices] = useState<DeviceRow[] | null>(null);
  const [codes, setCodes] = useState<ActiveCodeRow[]>([]);
  const [showGenerateModal, setShowGenerateModal] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    refreshAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refreshAll() {
    try {
      const [d, c] = await Promise.all([
        api<{ devices: DeviceRow[] }>("/admin/devices"),
        api<{ codes: ActiveCodeRow[] }>("/admin/pairing-codes"),
      ]);
      setDevices(d.devices);
      setCodes(c.codes);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        clearTokens();
        navigate("/login", { replace: true });
      } else if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError("Error inesperado");
      }
    }
  }

  async function onRevoke(deviceId: string) {
    try {
      await api(`/admin/devices/${deviceId}/revoke`, { method: "POST", body: {} });
      refreshAll();
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
    }
  }

  if (!devices) return <CenteredLoader label="Cargando dispositivos…" />;

  return (
    <AdminShell title="Dispositivos">
      <p className="text-[13.5px] text-slate-500 mb-5 -mt-2">
        Tablets / navegadores emparejados a tus cajas. Revoca cualquiera que
        hayas perdido o robado: la PWA se desempareja al siguiente intento.
      </p>

      {error && <FieldError message={error} />}

      <div className="mb-5 flex items-center justify-between gap-3">
        <h2 className="text-[16px] font-semibold text-mipiace-ink">
          Códigos activos
        </h2>
        <PrimaryButton
          type="button"
          onClick={() => setShowGenerateModal(true)}
          className="!w-auto !h-10 !px-4 !text-[13.5px]"
        >
          Generar código
        </PrimaryButton>
      </div>

      {codes.length === 0 ? (
        <div className="text-[13px] text-slate-500 bg-white rounded-2xl border border-slate-200 p-5 mb-7">
          No hay códigos pendientes. Genera uno para emparejar un dispositivo
          nuevo.
        </div>
      ) : (
        <div className="space-y-2.5 mb-7">
          {codes.map((c) => (
            <PairingCodeRow key={c.id} code={c} />
          ))}
        </div>
      )}

      <h2 className="text-[16px] font-semibold text-mipiace-ink mb-3">
        Dispositivos emparejados
      </h2>
      {devices.length === 0 ? (
        <div className="text-[13px] text-slate-500 bg-white rounded-2xl border border-slate-200 p-5">
          Aún no hay ningún dispositivo emparejado.
        </div>
      ) : (
        <div className="space-y-2.5">
          {devices.map((d) => (
            <DeviceRow key={d.id} device={d} onRevoke={() => onRevoke(d.id)} />
          ))}
        </div>
      )}

      {showGenerateModal && (
        <GenerateCodeModal
          onClose={() => setShowGenerateModal(false)}
          onGenerated={() => {
            setShowGenerateModal(false);
            refreshAll();
          }}
        />
      )}
    </AdminShell>
  );
}

function PairingCodeRow({ code }: { code: ActiveCodeRow }) {
  const [copied, setCopied] = useState(false);
  const minutesLeft = Math.max(
    0,
    Math.round((new Date(code.expiresAt).getTime() - Date.now()) / 60_000),
  );
  function onCopy() {
    navigator.clipboard?.writeText(code.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-4 flex items-center gap-4">
      <div className="font-semibold text-[22px] tracking-[0.18em] tabular-nums text-mipiace-ink">
        {code.code}
      </div>
      <div className="flex-1 min-w-0 text-[13px] text-slate-500">
        <div className="text-mipiace-ink font-medium text-[14px]">
          {code.registerName}
        </div>
        <div className="mt-0.5 text-[12.5px]">Caduca en {minutesLeft} min</div>
      </div>
      <button
        onClick={onCopy}
        className="h-9 px-3 rounded-lg hover:bg-slate-50 text-slate-500 flex items-center gap-1.5 text-[13px] font-medium"
      >
        {copied ? (
          <>
            <Check className="w-3.5 h-3.5 text-emerald-600" />
            Copiado
          </>
        ) : (
          <>
            <Copy className="w-3.5 h-3.5" />
            Copiar
          </>
        )}
      </button>
    </div>
  );
}

function DeviceRow({
  device,
  onRevoke,
}: {
  device: DeviceRow;
  onRevoke: () => void;
}) {
  const revoked = device.revokedAt != null;
  return (
    <div
      className={
        revoked
          ? "bg-white rounded-2xl border border-slate-200 p-4 flex items-center gap-4 opacity-60"
          : "bg-white rounded-2xl border border-slate-200 p-4 flex items-center gap-4"
      }
    >
      <span className="h-10 w-10 rounded-xl bg-mipiace-stone text-mipiace-ink flex items-center justify-center">
        <Calculator className="w-[18px] h-[18px]" strokeWidth={2.1} />
      </span>
      <div className="flex-1 min-w-0">
        <div className="text-[14px] font-medium text-mipiace-ink truncate">
          {device.name ?? device.userAgent ?? "Dispositivo sin nombre"}
        </div>
        <div className="text-[12.5px] text-slate-500 mt-0.5 truncate">
          {device.storeName} · {device.registerName}
          {device.lastKnownIpCountry && ` · ${device.lastKnownIpCountry}`}
          {" · "}
          {device.lastSeenAt
            ? `vista ${formatRelative(device.lastSeenAt)}`
            : `emparejado ${formatRelative(device.pairedAt)}`}
        </div>
      </div>
      {revoked ? (
        <span className="text-[11px] font-medium uppercase tracking-wider px-2 py-0.5 bg-slate-100 text-slate-500 rounded">
          revocado
        </span>
      ) : (
        <OutlineButton
          onClick={onRevoke}
          className="!h-9 !text-[12.5px] !text-mipiace-coral-dark hover:!bg-mipiace-coral-soft !border-mipiace-coral/30"
        >
          Revocar
        </OutlineButton>
      )}
    </div>
  );
}

function GenerateCodeModal({
  onClose,
  onGenerated,
}: {
  onClose: () => void;
  onGenerated: () => void;
}) {
  const [registers, setRegisters] = useState<RegisterRow[] | null>(null);
  const [registerId, setRegisterId] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generated, setGenerated] = useState<{ code: string; expiresAt: string } | null>(null);

  useEffect(() => {
    // B4 introdujo `/admin/registers` con la gestión de Tiendas. Antes
    // (B3) derivábamos del listado de devices; eso queda obsoleto porque
    // permitía crear pairings sólo para cajas que ya tenían device, y
    // no servía para emparejar la primera tablet.
    api<{
      registers: Array<{ id: string; name: string; storeName: string }>;
    }>("/admin/registers").then((res) => {
      const arr = res.registers.map((r) => ({
        id: r.id,
        name: r.name,
        storeName: r.storeName,
      }));
      setRegisters(arr);
      if (arr.length === 1) setRegisterId(arr[0]!.id);
    });
  }, []);

  async function onGenerate() {
    if (!registerId) {
      setError("Selecciona una caja.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ code: string; expiresAt: string }>(
        `/admin/registers/${registerId}/pairing-codes`,
        { method: "POST", body: {} },
      );
      setGenerated(res);
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
      else setError("Error inesperado");
    } finally {
      setBusy(false);
    }
  }

  const minutesLeft = useMemo(() => {
    if (!generated) return 0;
    return Math.max(
      0,
      Math.round((new Date(generated.expiresAt).getTime() - Date.now()) / 60_000),
    );
  }, [generated]);

  return (
    <div
      className="fixed inset-0 z-50 bg-mipiace-ink/40 flex items-end sm:items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white w-full max-w-md rounded-3xl border border-slate-200 p-6 md:p-7"
      >
        {generated ? (
          <>
            <h2 className="text-[18px] font-semibold text-mipiace-ink mb-1">
              Código generado
            </h2>
            <p className="text-[13px] text-slate-500 mb-5">
              Introdúcelo en la pantalla de emparejamiento del dispositivo.
              Caduca en {minutesLeft} min.
            </p>
            <div className="bg-mipiace-stone rounded-2xl p-6 text-center mb-5">
              <div className="text-[36px] font-semibold tabular-nums tracking-[0.2em] text-mipiace-ink">
                {generated.code}
              </div>
            </div>
            <OutlineButton
              onClick={() => {
                navigator.clipboard?.writeText(generated.code);
              }}
              className="!w-full mb-2.5"
            >
              <Copy className="w-3.5 h-3.5" /> Copiar al portapapeles
            </OutlineButton>
            <PrimaryButton type="button" onClick={onGenerated}>
              Cerrar
            </PrimaryButton>
          </>
        ) : (
          <>
            <h2 className="text-[18px] font-semibold text-mipiace-ink mb-1">
              Generar código de emparejamiento
            </h2>
            <p className="text-[13px] text-slate-500 mb-5">
              Elige la caja a la que se va a asociar. El código vivirá 1 hora.
            </p>
            <label className="block text-[13px] font-medium text-mipiace-ink-soft mb-2">
              Caja
            </label>
            {!registers ? (
              <div className="text-[13px] text-slate-400 mb-5">Cargando…</div>
            ) : registers.length === 0 ? (
              <div className="text-[13px] text-slate-500 bg-mipiace-stone rounded-xl p-4 mb-5">
                No hay cajas creadas todavía. Crea una desde{" "}
                <a className="text-mipiace-coral-dark font-medium hover:underline" href="/admin/stores">
                  Tiendas
                </a>{" "}
                antes de emparejar dispositivos.
              </div>
            ) : (
              <div className="relative mb-5">
                <select
                  value={registerId}
                  onChange={(e) => setRegisterId(e.target.value)}
                  className="w-full h-12 px-3.5 pr-9 rounded-xl bg-mipiace-stone border border-transparent text-[14.5px] text-mipiace-ink appearance-none focus:bg-white focus:border-mipiace-coral/30 focus:ring-2 focus:ring-mipiace-coral/30 focus:outline-none"
                >
                  <option value="" disabled>
                    Selecciona…
                  </option>
                  {registers.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.storeName} · {r.name}
                    </option>
                  ))}
                </select>
                <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
              </div>
            )}
            <div className="flex gap-2.5">
              <OutlineButton onClick={onClose} disabled={busy} className="!w-full">
                Cancelar
              </OutlineButton>
              <PrimaryButton type="button" onClick={onGenerate} busy={busy}>
                Generar
              </PrimaryButton>
            </div>
            <FieldError message={error} />
          </>
        )}
      </div>
    </div>
  );
}

// Re-export por si algún otro page reusa la lista.
export type { DeviceRow };
