// Gestión de tiendas (B4 §0). Dos vistas:
//   - Lista de tiendas, con conteo de cajas/devices/ventas mes.
//   - Detalle (drawer/modal in-line) con sus cajas.
// Modales para crear tienda y crear caja.

import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Building2, Calculator, ChevronRight } from "lucide-react";

import { AdminShell } from "../AdminShell.js";
import { api, ApiError, clearTokens, readCurrentRole } from "../api.js";
import {
  CenteredLoader,
  FieldError,
  formatRelative,
  OutlineButton,
  PrimaryButton,
  TextField,
} from "../ui.js";

interface StoreRow {
  id: string;
  name: string;
  fiscalAddress: Record<string, unknown> | null;
  warehouseHoldedId: string | null;
  warehouseName: string | null;
  registerCount: number;
  activeDevices: number;
  salesLast30d: number;
  createdAt: string;
}

interface Warehouse {
  id: string;
  holdedWarehouseId: string;
  name: string;
}

interface RegisterRow {
  id: string;
  name: string;
  numSerieHolded: string | null;
  ticketCounter: number;
  activeDevices: number;
  lastSaleAt: string | null;
  createdAt: string;
}

interface StoreDetail {
  id: string;
  name: string;
  fiscalAddress: Record<string, unknown> | null;
  warehouseHoldedId: string | null;
  warehouseName: string | null;
  createdAt: string;
  registers: RegisterRow[];
}

function eur(n: number): string {
  return n.toFixed(2).replace(".", ",") + " €";
}

function handleAuthError(err: unknown, navigate: ReturnType<typeof useNavigate>): boolean {
  if (err instanceof ApiError && err.status === 401) {
    clearTokens();
    navigate("/login", { replace: true });
    return true;
  }
  return false;
}

export function StoresPage() {
  const navigate = useNavigate();
  const [stores, setStores] = useState<StoreRow[] | null>(null);
  const [showNewModal, setShowNewModal] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    try {
      const res = await api<{ stores: StoreRow[] }>("/admin/stores");
      setStores(res.stores);
      setError(null);
    } catch (err) {
      if (handleAuthError(err, navigate)) return;
      if (err instanceof ApiError) setError(err.message);
      else setError("Error inesperado");
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!stores) return <CenteredLoader label="Cargando tiendas…" />;

  return (
    <AdminShell title="Tiendas">
      <p className="text-[13.5px] text-slate-500 mb-5 -mt-2">
        Cada tienda agrupa una o varias cajas y se asocia a un almacén Holded.
        El stock se descuenta de ese almacén al cobrar.
      </p>
      {error && <FieldError message={error} />}
      <div className="mb-5 flex items-center justify-between gap-3">
        <h2 className="text-[16px] font-semibold text-mipiace-ink">
          {stores.length} {stores.length === 1 ? "tienda" : "tiendas"}
        </h2>
        {readCurrentRole() === "OWNER" && (
          <PrimaryButton
            type="button"
            onClick={() => setShowNewModal(true)}
            className="!w-auto !h-10 !px-4 !text-[13.5px]"
          >
            + Nueva tienda
          </PrimaryButton>
        )}
      </div>
      {stores.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-7 text-center">
          <div className="h-12 w-12 mx-auto rounded-2xl bg-mipiace-coral-soft text-mipiace-coral flex items-center justify-center mb-3">
            <Building2 className="w-6 h-6" />
          </div>
          <h2 className="text-[16px] font-semibold text-mipiace-ink">
            Aún no tienes tiendas
          </h2>
          <p className="text-[13.5px] text-slate-500 mt-1 mb-4">
            {readCurrentRole() === "OWNER"
              ? "Crea la primera tienda para empezar a dar de alta cajas."
              : "El propietario debe crear la primera tienda."}
          </p>
          {readCurrentRole() === "OWNER" && (
            <PrimaryButton
              type="button"
              onClick={() => setShowNewModal(true)}
              className="!w-auto !h-10 !px-4 !text-[13.5px]"
            >
              + Nueva tienda
            </PrimaryButton>
          )}
        </div>
      ) : (
        <div className="space-y-2.5">
          {stores.map((s) => (
            <StoreRowCard key={s.id} store={s} onOpen={() => navigate(`/admin/stores/${s.id}`)} />
          ))}
        </div>
      )}
      {showNewModal && (
        <NewStoreModal
          onClose={() => setShowNewModal(false)}
          onCreated={(id) => {
            setShowNewModal(false);
            refresh();
            navigate(`/admin/stores/${id}`);
          }}
        />
      )}
    </AdminShell>
  );
}

function StoreRowCard({ store, onOpen }: { store: StoreRow; onOpen: () => void }) {
  return (
    <button
      onClick={onOpen}
      className="w-full text-left bg-white rounded-2xl border border-slate-200 p-5 hover:border-mipiace-coral/40 transition-colors flex items-center gap-4"
    >
      <span className="h-10 w-10 rounded-xl bg-mipiace-coral-soft text-mipiace-coral flex items-center justify-center shrink-0">
        <Building2 className="w-[18px] h-[18px]" strokeWidth={2.1} />
      </span>
      <div className="flex-1 min-w-0">
        <div className="text-[15px] font-medium text-mipiace-ink truncate">{store.name}</div>
        <div className="text-[12.5px] text-slate-500 mt-0.5 truncate">
          {store.warehouseName ?? "— Sin almacén"}
          {" · "}
          {store.registerCount} {store.registerCount === 1 ? "caja" : "cajas"}
          {" · "}
          {store.activeDevices} {store.activeDevices === 1 ? "dispositivo" : "dispositivos"}
          {" · "}
          <span className="tabular-nums">{eur(store.salesLast30d)} en 30d</span>
        </div>
      </div>
      <ChevronRight className="w-4 h-4 text-slate-300 shrink-0" />
    </button>
  );
}

function NewStoreModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (storeId: string) => void;
}) {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [warehouses, setWarehouses] = useState<Warehouse[] | null>(null);
  const [warehouseHoldedId, setWarehouseHoldedId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ warehouses: Warehouse[] }>("/admin/warehouses")
      .then((res) => {
        setWarehouses(res.warehouses);
        if (res.warehouses.length === 1) {
          setWarehouseHoldedId(res.warehouses[0]!.holdedWarehouseId);
        }
      })
      .catch((err) => {
        if (handleAuthError(err, navigate)) return;
        if (err instanceof ApiError) setError(err.message);
      });
  }, [navigate]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ store: { id: string } }>("/admin/stores", {
        method: "POST",
        body: { name, warehouseHoldedId },
      });
      onCreated(res.store.id);
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
      else setError("Error inesperado");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-mipiace-ink/40 flex items-end sm:items-center justify-center p-4"
      onClick={onClose}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={onSubmit}
        className="bg-white w-full max-w-md rounded-3xl border border-slate-200 p-6 md:p-7"
      >
        <h2 className="text-[18px] font-semibold text-mipiace-ink mb-1">Nueva tienda</h2>
        <p className="text-[13px] text-slate-500 mb-5">
          Asóciala a un almacén Holded para que el TPV descuente stock al cobrar.
        </p>
        <div className="space-y-4">
          <TextField
            id="storeName"
            label="Nombre"
            value={name}
            onChange={setName}
            required
            placeholder="Tienda principal"
          />
          <div>
            <label className="block text-[13px] font-medium text-mipiace-ink-soft mb-1.5">
              Almacén Holded
            </label>
            {!warehouses ? (
              <div className="h-12 rounded-xl bg-mipiace-stone text-[13px] text-slate-400 flex items-center px-3.5">
                Cargando…
              </div>
            ) : warehouses.length === 0 ? (
              <div className="text-[13px] text-slate-500 bg-mipiace-stone rounded-xl p-4">
                No hay almacenes Holded sincronizados. Lanza un sync incremental desde Mi cuenta.
              </div>
            ) : (
              <select
                value={warehouseHoldedId}
                onChange={(e) => setWarehouseHoldedId(e.target.value)}
                required
                className="w-full h-12 px-3.5 rounded-xl bg-mipiace-stone border border-transparent text-[14.5px] text-mipiace-ink focus:bg-white focus:border-mipiace-coral/30 focus:ring-2 focus:ring-mipiace-coral/30 focus:outline-none"
              >
                <option value="" disabled>
                  Selecciona…
                </option>
                {warehouses.map((w) => (
                  <option key={w.holdedWarehouseId} value={w.holdedWarehouseId}>
                    {w.name}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>
        <div className="flex gap-2.5 mt-6">
          <OutlineButton onClick={onClose} disabled={busy}>
            Cancelar
          </OutlineButton>
          <PrimaryButton type="submit" busy={busy} disabled={!name || !warehouseHoldedId}>
            Crear tienda
          </PrimaryButton>
        </div>
        <FieldError message={error} />
      </form>
    </div>
  );
}

export function StoreDetailPage() {
  const navigate = useNavigate();
  const { storeId } = useParams<{ storeId: string }>();
  const [store, setStore] = useState<StoreDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showNewRegister, setShowNewRegister] = useState(false);
  const [editing, setEditing] = useState(false);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);

  async function refresh() {
    if (!storeId) return;
    try {
      const res = await api<{ store: StoreDetail }>(`/admin/stores/${storeId}`);
      setStore(res.store);
      setError(null);
    } catch (err) {
      if (handleAuthError(err, navigate)) return;
      if (err instanceof ApiError) setError(err.message);
      else setError("Error inesperado");
    }
  }

  useEffect(() => {
    refresh();
    api<{ warehouses: Warehouse[] }>("/admin/warehouses")
      .then((res) => setWarehouses(res.warehouses))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeId]);

  if (!store) return <CenteredLoader label="Cargando tienda…" />;

  const canDelete = store.registers.length === 0;

  return (
    <AdminShell title={store.name}>
      <button
        onClick={() => navigate("/admin/stores")}
        className="inline-flex items-center gap-1.5 text-[13px] text-slate-500 hover:text-mipiace-ink font-medium mb-4 -mt-1"
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        Tiendas
      </button>

      {error && <FieldError message={error} />}

      <section className="bg-white rounded-2xl border border-slate-200 p-6 md:p-7 mb-5">
        <div className="flex items-start justify-between mb-1">
          <div className="flex-1 min-w-0">
            <h2 className="text-[17px] font-semibold text-mipiace-ink tracking-tight">
              Almacén Holded
            </h2>
            <p className="text-[13px] text-slate-500 mt-1">
              {store.warehouseName ?? "Sin almacén asignado"}
            </p>
          </div>
          {!editing && (
            <OutlineButton onClick={() => setEditing(true)} className="!h-9 text-[13px]">
              Editar
            </OutlineButton>
          )}
        </div>
        {editing && (
          <EditStoreForm
            store={store}
            warehouses={warehouses}
            onCancel={() => setEditing(false)}
            onSaved={() => {
              setEditing(false);
              refresh();
            }}
          />
        )}
      </section>

      <section className="bg-white rounded-2xl border border-slate-200 p-6 md:p-7 mb-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-[17px] font-semibold text-mipiace-ink tracking-tight">
              Cajas
            </h2>
            <p className="text-[13px] text-slate-500 mt-1">
              {store.registers.length} {store.registers.length === 1 ? "caja" : "cajas"} en esta tienda
            </p>
          </div>
          <PrimaryButton
            type="button"
            onClick={() => setShowNewRegister(true)}
            className="!w-auto !h-10 !px-4 !text-[13.5px]"
          >
            + Nueva caja
          </PrimaryButton>
        </div>
        {store.registers.length === 0 ? (
          <div className="text-[13px] text-slate-500 bg-mipiace-stone rounded-xl p-4">
            Esta tienda aún no tiene cajas. Crea la primera para poder emparejar dispositivos.
          </div>
        ) : (
          <div className="space-y-2.5">
            {store.registers.map((r) => (
              <RegisterRowCard
                key={r.id}
                register={r}
                onChanged={refresh}
              />
            ))}
          </div>
        )}
      </section>

      <DeleteStoreSection
        storeId={store.id}
        canDelete={canDelete}
        onDeleted={() => navigate("/admin/stores")}
      />

      {showNewRegister && (
        <NewRegisterModal
          storeId={store.id}
          suggestedName={`Caja ${store.registers.length + 1}`}
          onClose={() => setShowNewRegister(false)}
          onCreated={() => {
            setShowNewRegister(false);
            refresh();
          }}
        />
      )}
    </AdminShell>
  );
}

function EditStoreForm({
  store,
  warehouses,
  onCancel,
  onSaved,
}: {
  store: StoreDetail;
  warehouses: Warehouse[];
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(store.name);
  const [warehouseHoldedId, setWarehouseHoldedId] = useState(store.warehouseHoldedId ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(`/admin/stores/${store.id}`, {
        method: "PATCH",
        body: { name, warehouseHoldedId },
      });
      onSaved();
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
      else setError("Error inesperado");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4 mt-4">
      <TextField id="editName" label="Nombre" value={name} onChange={setName} required />
      <div>
        <label className="block text-[13px] font-medium text-mipiace-ink-soft mb-1.5">
          Almacén Holded
        </label>
        <select
          value={warehouseHoldedId}
          onChange={(e) => setWarehouseHoldedId(e.target.value)}
          required
          className="w-full h-12 px-3.5 rounded-xl bg-mipiace-stone border border-transparent text-[14.5px] text-mipiace-ink focus:bg-white focus:border-mipiace-coral/30 focus:ring-2 focus:ring-mipiace-coral/30 focus:outline-none"
        >
          {warehouses.map((w) => (
            <option key={w.holdedWarehouseId} value={w.holdedWarehouseId}>
              {w.name}
            </option>
          ))}
        </select>
      </div>
      <div className="flex gap-2.5">
        <PrimaryButton type="submit" busy={busy}>
          Guardar
        </PrimaryButton>
        <OutlineButton onClick={onCancel}>Cancelar</OutlineButton>
      </div>
      <FieldError message={error} />
    </form>
  );
}

function RegisterRowCard({
  register,
  onChanged,
}: {
  register: RegisterRow;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-4">
      <div className="flex items-center gap-4">
        <span className="h-10 w-10 rounded-xl bg-mipiace-stone text-mipiace-ink flex items-center justify-center shrink-0">
          <Calculator className="w-[18px] h-[18px]" strokeWidth={2.1} />
        </span>
        <div className="flex-1 min-w-0">
          <div className="text-[14.5px] font-medium text-mipiace-ink truncate">
            {register.name}
            {register.numSerieHolded && (
              <span className="ml-2 text-[12px] text-slate-400 font-normal tabular-nums">
                #{register.numSerieHolded}
              </span>
            )}
          </div>
          <div className="text-[12.5px] text-slate-500 mt-0.5 truncate">
            Ticket #{String(register.ticketCounter).padStart(6, "0")}
            {" · "}
            {register.activeDevices}{" "}
            {register.activeDevices === 1 ? "dispositivo activo" : "dispositivos activos"}
            {register.lastSaleAt &&
              ` · última venta ${formatRelative(register.lastSaleAt)}`}
          </div>
        </div>
        <OutlineButton onClick={() => setEditing((v) => !v)} className="!h-9 !text-[12.5px]">
          {editing ? "Cerrar" : "Editar"}
        </OutlineButton>
      </div>
      {editing && (
        <EditRegisterForm
          register={register}
          onCancel={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            onChanged();
          }}
          onDeleted={onChanged}
        />
      )}
    </div>
  );
}

function EditRegisterForm({
  register,
  onCancel,
  onSaved,
  onDeleted,
}: {
  register: RegisterRow;
  onCancel: () => void;
  onSaved: () => void;
  onDeleted: () => void;
}) {
  const [name, setName] = useState(register.name);
  const [numSerieHolded, setNumSerieHolded] = useState(register.numSerieHolded ?? "");
  const [busy, setBusy] = useState(false);
  const [busyDelete, setBusyDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, string> = { name };
      if (numSerieHolded) body.numSerieHolded = numSerieHolded;
      await api(`/admin/registers/${register.id}`, { method: "PATCH", body });
      onSaved();
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
      else setError("Error inesperado");
    } finally {
      setBusy(false);
    }
  }

  async function onDelete() {
    if (!confirm(`¿Eliminar la caja "${register.name}"? Sólo se permite si no tiene devices ni tickets.`)) return;
    setBusyDelete(true);
    setError(null);
    try {
      await api(`/admin/registers/${register.id}`, { method: "DELETE" });
      onDeleted();
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
      else setError("Error inesperado");
    } finally {
      setBusyDelete(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="mt-4 pt-4 border-t border-slate-100 space-y-3">
      <TextField id={`name-${register.id}`} label="Nombre" value={name} onChange={setName} required />
      <TextField
        id={`numSerie-${register.id}`}
        label="Serie Holded (opcional)"
        value={numSerieHolded}
        onChange={setNumSerieHolded}
        placeholder="ID interno de la serie Holded — déjalo vacío para usar la default"
      />
      <div className="flex flex-wrap gap-2.5">
        <PrimaryButton type="submit" busy={busy}>
          Guardar
        </PrimaryButton>
        <OutlineButton onClick={onCancel} disabled={busy}>
          Cancelar
        </OutlineButton>
        <OutlineButton
          onClick={onDelete}
          busy={busyDelete}
          className="!text-mipiace-coral-dark !border-mipiace-coral/30 hover:!bg-mipiace-coral-soft"
        >
          Eliminar caja
        </OutlineButton>
      </div>
      <FieldError message={error} />
    </form>
  );
}

function NewRegisterModal({
  storeId,
  suggestedName,
  onClose,
  onCreated,
}: {
  storeId: string;
  suggestedName: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState(suggestedName);
  const [numSerieHolded, setNumSerieHolded] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, string> = { name };
      if (numSerieHolded) body.numSerieHolded = numSerieHolded;
      await api(`/admin/stores/${storeId}/registers`, { method: "POST", body });
      onCreated();
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
      else setError("Error inesperado");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-mipiace-ink/40 flex items-end sm:items-center justify-center p-4"
      onClick={onClose}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={onSubmit}
        className="bg-white w-full max-w-md rounded-3xl border border-slate-200 p-6 md:p-7"
      >
        <h2 className="text-[18px] font-semibold text-mipiace-ink mb-1">Nueva caja</h2>
        <p className="text-[13px] text-slate-500 mb-5">
          Dale un nombre y, si lo tienes a mano, el ID de la serie Holded que esta caja usará para
          numerar fiscalmente sus tickets. Si lo dejas vacío, Holded usa la serie default.
        </p>
        <div className="space-y-4">
          <TextField id="regName" label="Nombre" value={name} onChange={setName} required />
          <TextField
            id="regNumSerie"
            label="Serie Holded (opcional)"
            value={numSerieHolded}
            onChange={setNumSerieHolded}
            placeholder="ID de la serie en Holded"
          />
        </div>
        <div className="flex gap-2.5 mt-6">
          <OutlineButton onClick={onClose} disabled={busy}>
            Cancelar
          </OutlineButton>
          <PrimaryButton type="submit" busy={busy} disabled={!name}>
            Crear caja
          </PrimaryButton>
        </div>
        <FieldError message={error} />
      </form>
    </div>
  );
}

function DeleteStoreSection({
  storeId,
  canDelete,
  onDeleted,
}: {
  storeId: string;
  canDelete: boolean;
  onDeleted: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onDelete() {
    if (!confirm("¿Eliminar esta tienda? Sólo se permite si no tiene cajas activas.")) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/admin/stores/${storeId}`, { method: "DELETE" });
      onDeleted();
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
      else setError("Error inesperado");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="bg-white rounded-2xl border border-slate-200 p-6 md:p-7">
      <h2 className="text-[17px] font-semibold text-mipiace-ink tracking-tight mb-1">
        Eliminar tienda
      </h2>
      <p className="text-[13px] text-slate-500 mb-4">
        {canDelete
          ? "Esta tienda no tiene cajas activas. Se puede eliminar (soft-delete)."
          : "Esta tienda aún tiene cajas activas. Elimínalas primero."}
      </p>
      <OutlineButton
        onClick={onDelete}
        busy={busy}
        disabled={!canDelete}
        className="!text-mipiace-coral-dark !border-mipiace-coral/30 hover:!bg-mipiace-coral-soft"
      >
        Eliminar tienda
      </OutlineButton>
      <FieldError message={error} />
    </section>
  );
}

