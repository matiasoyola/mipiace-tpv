// v1.4-Impresoras-Fase-1 Lote 1 · gestión de impresoras térmicas
// (/admin/printers).
//
// El implantador configura aquí, por register, las impresoras del
// local. SERVICES típico → una USB sin sección. HOSPITALITY típico →
// varias WIFI (BARRA / COCINA / caja).
//
// Auth lado backend: OWNER o MANAGER. En cliente repetimos el check
// para esconder los botones de mutación cuando no aplican.

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Printer, Trash2 } from "lucide-react";

import { AdminShell } from "../AdminShell.js";
import { api, ApiError, clearTokens } from "../api.js";
import {
  CenteredLoader,
  FieldError,
  OutlineButton,
  PrimaryButton,
  SuccessBanner,
  TextField,
  formatRelative,
} from "../ui.js";

type Mode = "USB" | "WIFI";
type Section = "BARRA" | "COCINA" | "SALON" | null;

interface PrinterConfig {
  id: string;
  registerId: string;
  name: string;
  mode: Mode;
  ipAddress: string | null;
  port: number | null;
  timeoutMs: number;
  section: Section;
  active: boolean;
  lastPrintOkAt: string | null;
  lastErrorAt: string | null;
  lastErrorMsg: string | null;
  createdAt: string;
}

interface StoreRow {
  id: string;
  name: string;
  registers: Array<{ id: string; name: string }>;
}

const SECTION_LABEL: Record<NonNullable<Section>, string> = {
  BARRA: "Barra",
  COCINA: "Cocina",
  SALON: "Salón",
};

const IPV4_RE =
  /^(25[0-5]|2[0-4]\d|[01]?\d?\d)(\.(25[0-5]|2[0-4]\d|[01]?\d?\d)){3}$/;

interface StoreDetail {
  id: string;
  name: string;
  registers: Array<{ id: string; name: string }>;
}

interface StoresListResp {
  stores: Array<{ id: string; name: string }>;
}

export function PrintersPage() {
  const navigate = useNavigate();
  const [stores, setStores] = useState<StoreRow[] | null>(null);
  const [printers, setPrinters] = useState<PrinterConfig[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [modal, setModal] = useState<ModalState | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await api<StoresListResp>("/admin/stores");
        const detailed: StoreRow[] = [];
        for (const s of list.stores) {
          const det = await api<{ store: StoreDetail }>(`/admin/stores/${s.id}`);
          detailed.push({
            id: det.store.id,
            name: det.store.name,
            registers: det.store.registers.map((r) => ({
              id: r.id,
              name: r.name,
            })),
          });
        }
        if (cancelled) return;
        setStores(detailed);
        const res = await api<{ items: PrinterConfig[] }>("/admin/printer-configs");
        if (cancelled) return;
        setPrinters(res.items);
      } catch (err) {
        if (handleAuthError(err, navigate)) return;
        if (err instanceof ApiError) setError(err.message);
        else setError("Error inesperado");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  async function reloadPrinters() {
    const res = await api<{ items: PrinterConfig[] }>("/admin/printer-configs");
    setPrinters(res.items);
  }

  async function onCreate(data: ModalSubmit, registerId: string) {
    setError(null);
    setSuccess(null);
    try {
      await api("/admin/printer-configs", {
        method: "POST",
        body: { registerId, ...data },
      });
      await reloadPrinters();
      setSuccess("Impresora añadida.");
      setModal(null);
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
      else setError("Error inesperado");
    }
  }

  async function onEdit(id: string, data: ModalSubmit) {
    setError(null);
    setSuccess(null);
    try {
      await api(`/admin/printer-configs/${id}`, {
        method: "PATCH",
        body: data,
      });
      await reloadPrinters();
      setSuccess("Impresora actualizada.");
      setModal(null);
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
      else setError("Error inesperado");
    }
  }

  async function onDelete(p: PrinterConfig) {
    if (!window.confirm(`¿Desactivar "${p.name}"?`)) return;
    setError(null);
    setSuccess(null);
    try {
      await api(`/admin/printer-configs/${p.id}`, { method: "DELETE" });
      await reloadPrinters();
      setSuccess("Impresora desactivada.");
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
      else setError("Error inesperado");
    }
  }

  async function onTest(p: PrinterConfig) {
    setError(null);
    setSuccess(null);
    try {
      const res = await api<{ ok: boolean; mode: Mode; note?: string }>(
        `/admin/printer-configs/${p.id}/test`,
        { method: "POST" },
      );
      if (res.mode === "USB") {
        setSuccess(
          res.note ??
            "ESC/POS generado OK. Para impresoras USB, prueba desde el TPV.",
        );
      } else {
        setSuccess("Prueba enviada correctamente. Comprueba el papel.");
      }
      await reloadPrinters();
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
      else setError("Error inesperado");
    }
  }

  const printersByRegister = useMemo(() => {
    const map = new Map<string, PrinterConfig[]>();
    for (const p of printers) {
      const arr = map.get(p.registerId) ?? [];
      arr.push(p);
      map.set(p.registerId, arr);
    }
    return map;
  }, [printers]);

  if (!stores) return <CenteredLoader label="Cargando impresoras…" />;

  return (
    <AdminShell title="Impresoras">
      <p className="text-[13.5px] text-slate-500 mb-5 -mt-2">
        Configura las impresoras térmicas de cada caja. USB se enchufa a
        la tablet del cajero; WIFI vive en la LAN del local y el backend
        manda el ticket por TCP a su IP.
      </p>

      {success && <SuccessBanner message={success} />}
      {error && <FieldError message={error} />}

      {stores.length === 0 && (
        <div className="bg-white rounded-2xl border border-slate-200 p-7 text-center">
          <p className="text-[13.5px] text-slate-500">
            No hay tiendas creadas. Crea una tienda y una caja primero.
          </p>
        </div>
      )}

      {stores.map((store) => (
        <section
          key={store.id}
          className="bg-white rounded-2xl border border-slate-200 p-6 md:p-7 mb-5"
        >
          <h2 className="text-[16px] font-semibold text-mipiace-ink tracking-tight mb-3">
            {store.name}
          </h2>
          {store.registers.length === 0 && (
            <p className="text-[13px] text-slate-500">
              Esta tienda no tiene cajas. Crea una caja para añadirle
              impresoras.
            </p>
          )}
          {store.registers.map((reg) => {
            const list = printersByRegister.get(reg.id) ?? [];
            return (
              <div key={reg.id} className="mb-5 last:mb-0">
                <div className="flex items-center justify-between mb-2.5">
                  <h3 className="text-[14.5px] font-medium text-mipiace-ink">
                    {reg.name}
                  </h3>
                  <OutlineButton
                    onClick={() =>
                      setModal({
                        kind: "create",
                        registerId: reg.id,
                        registerName: reg.name,
                      })
                    }
                    className="!h-9 !text-[12.5px]"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Añadir impresora
                  </OutlineButton>
                </div>
                {list.length === 0 ? (
                  <p className="text-[12.5px] text-slate-400 italic">
                    Sin impresoras configuradas.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {list.map((p) => (
                      <PrinterCard
                        key={p.id}
                        printer={p}
                        onEdit={() => setModal({ kind: "edit", printer: p })}
                        onDelete={() => onDelete(p)}
                        onTest={() => onTest(p)}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </section>
      ))}

      {modal && (
        <PrinterModal
          state={modal}
          onClose={() => setModal(null)}
          onSubmit={(data) => {
            if (modal.kind === "create") {
              return onCreate(data, modal.registerId);
            }
            return onEdit(modal.printer.id, data);
          }}
        />
      )}
    </AdminShell>
  );
}

function PrinterCard({
  printer,
  onEdit,
  onDelete,
  onTest,
}: {
  printer: PrinterConfig;
  onEdit: () => void;
  onDelete: () => void;
  onTest: () => void;
}) {
  const status = statusOf(printer);
  return (
    <div className="flex flex-wrap items-center gap-3 p-3.5 rounded-xl bg-mipiace-stone">
      <div className="h-9 w-9 rounded-lg bg-white border border-slate-200 flex items-center justify-center text-slate-500">
        <Printer className="w-4 h-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[14px] font-medium text-mipiace-ink">
            {printer.name}
          </span>
          <span
            className={
              printer.mode === "USB"
                ? "inline-block px-1.5 py-0.5 rounded text-[11px] font-medium bg-slate-200 text-slate-700"
                : "inline-block px-1.5 py-0.5 rounded text-[11px] font-medium bg-blue-100 text-blue-700"
            }
          >
            {printer.mode}
          </span>
          {printer.section && (
            <span className="inline-block px-1.5 py-0.5 rounded text-[11px] font-medium bg-amber-50 text-amber-800">
              {SECTION_LABEL[printer.section]}
            </span>
          )}
          {!printer.active && (
            <span className="inline-block px-1.5 py-0.5 rounded text-[11px] font-medium bg-red-50 text-red-700">
              desactivada
            </span>
          )}
        </div>
        <div className="text-[12px] text-slate-500 mt-0.5">
          {printer.mode === "WIFI"
            ? `${printer.ipAddress}:${printer.port}`
            : "USB · empareja desde TPV"}
          {" · "}
          <span className={status.color}>{status.label}</span>
          {printer.lastPrintOkAt && (
            <> · última impresión {formatRelative(printer.lastPrintOkAt)}</>
          )}
        </div>
        {printer.lastErrorMsg && (
          <div className="text-[12px] text-red-700 mt-0.5 truncate">
            Último error: {printer.lastErrorMsg}
          </div>
        )}
      </div>
      <div className="flex items-center gap-2">
        <OutlineButton onClick={onTest} className="!h-9 !text-[12.5px]">
          Probar
        </OutlineButton>
        <OutlineButton onClick={onEdit} className="!h-9 !text-[12.5px]">
          Editar
        </OutlineButton>
        <OutlineButton
          onClick={onDelete}
          className="!h-9 !text-[12.5px] !text-red-600 !border-red-200 hover:!bg-red-50"
        >
          <Trash2 className="w-3.5 h-3.5" />
          Quitar
        </OutlineButton>
      </div>
    </div>
  );
}

function statusOf(p: PrinterConfig): { label: string; color: string } {
  if (!p.active) return { label: "desactivada", color: "text-red-600" };
  if (p.lastPrintOkAt) {
    const ageMs = Date.now() - new Date(p.lastPrintOkAt).getTime();
    if (ageMs < 24 * 3600 * 1000) {
      return { label: "OK", color: "text-emerald-600" };
    }
  }
  if (p.lastErrorAt) {
    return { label: "con error", color: "text-amber-600" };
  }
  return { label: "sin uso reciente", color: "text-slate-500" };
}

type ModalState =
  | { kind: "create"; registerId: string; registerName: string }
  | { kind: "edit"; printer: PrinterConfig };

interface ModalSubmit {
  name: string;
  mode: Mode;
  ipAddress?: string;
  port?: number;
  section: NonNullable<Section> | null;
  active: boolean;
}

function PrinterModal({
  state,
  onClose,
  onSubmit,
}: {
  state: ModalState;
  onClose: () => void;
  onSubmit: (data: ModalSubmit) => Promise<void>;
}) {
  const editing = state.kind === "edit" ? state.printer : null;
  const [name, setName] = useState(editing?.name ?? "");
  const [mode, setMode] = useState<Mode>(editing?.mode ?? "USB");
  const [ipAddress, setIpAddress] = useState(editing?.ipAddress ?? "");
  const [port, setPort] = useState(String(editing?.port ?? 9100));
  const [section, setSection] = useState<"BARRA" | "COCINA" | "SALON" | "">(
    editing?.section ?? "",
  );
  const [active, setActive] = useState(editing?.active ?? true);
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLocalError(null);
    if (name.trim().length === 0) {
      setLocalError("Pon un nombre a la impresora.");
      return;
    }
    if (mode === "WIFI" && !IPV4_RE.test(ipAddress.trim())) {
      setLocalError("La IP no es válida (ejemplo: 192.168.1.50).");
      return;
    }
    const portNum = mode === "WIFI" ? Number(port) : undefined;
    if (mode === "WIFI" && (!Number.isFinite(portNum) || portNum! < 1 || portNum! > 65535)) {
      setLocalError("Puerto inválido.");
      return;
    }
    setBusy(true);
    try {
      await onSubmit({
        name: name.trim(),
        mode,
        ipAddress: mode === "WIFI" ? ipAddress.trim() : undefined,
        port: mode === "WIFI" ? portNum : undefined,
        section: section === "" ? null : section,
        active,
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-mipiace-ink/50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="bg-white rounded-2xl border border-slate-200 w-full max-w-md p-6 shadow-xl">
        <h2 className="text-[16px] font-semibold text-mipiace-ink mb-1">
          {state.kind === "create"
            ? `Nueva impresora en ${state.registerName}`
            : "Editar impresora"}
        </h2>
        <p className="text-[12.5px] text-slate-500 mb-4">
          Selecciona el modo según cómo está conectada al local.
        </p>
        {localError && <FieldError message={localError} />}
        <form onSubmit={submit} className="space-y-3.5">
          <TextField
            id="printer-name"
            label="Nombre"
            value={name}
            onChange={setName}
            placeholder="Comanda BARRA"
            required
          />
          <div>
            <label className="block text-[13px] font-medium text-mipiace-ink mb-2">
              Modo
            </label>
            <div className="flex gap-3">
              <label className="flex items-center gap-2 text-[14px]">
                <input
                  type="radio"
                  name="mode"
                  value="USB"
                  checked={mode === "USB"}
                  onChange={() => setMode("USB")}
                />
                USB
              </label>
              <label className="flex items-center gap-2 text-[14px]">
                <input
                  type="radio"
                  name="mode"
                  value="WIFI"
                  checked={mode === "WIFI"}
                  onChange={() => setMode("WIFI")}
                />
                WIFI
              </label>
            </div>
          </div>
          {mode === "WIFI" && (
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <TextField
                  id="printer-ip"
                  label="IP de la impresora"
                  value={ipAddress}
                  onChange={setIpAddress}
                  placeholder="192.168.1.50"
                  required
                />
              </div>
              <TextField
                id="printer-port"
                label="Puerto"
                value={port}
                onChange={setPort}
                placeholder="9100"
              />
            </div>
          )}
          <div>
            <label
              htmlFor="printer-section"
              className="block text-[13px] font-medium text-mipiace-ink mb-2"
            >
              Sección
            </label>
            <select
              id="printer-section"
              value={section}
              onChange={(e) =>
                setSection(e.target.value as "BARRA" | "COCINA" | "SALON" | "")
              }
              className="w-full h-11 px-3 rounded-xl border border-slate-300 bg-white text-[14px] text-mipiace-ink focus:ring-2 focus:ring-mipiace-coral/40 focus:border-mipiace-coral/30 focus:outline-none"
            >
              <option value="">Ticket de cobro (sin sección)</option>
              <option value="BARRA">Barra</option>
              <option value="COCINA">Cocina</option>
              <option value="SALON">Salón</option>
            </select>
          </div>
          <label className="flex items-center gap-2 text-[14px] text-mipiace-ink">
            <input
              type="checkbox"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
            />
            Activa
          </label>
          <div className="flex gap-2.5 pt-2">
            <PrimaryButton type="submit" busy={busy}>
              Guardar
            </PrimaryButton>
            <OutlineButton type="button" onClick={onClose}>
              Cancelar
            </OutlineButton>
          </div>
        </form>
      </div>
    </div>
  );
}

function handleAuthError(
  err: unknown,
  navigate: ReturnType<typeof useNavigate>,
): boolean {
  if (err instanceof ApiError && err.status === 401) {
    clearTokens();
    navigate("/login", { replace: true });
    return true;
  }
  return false;
}
