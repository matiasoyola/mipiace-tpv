// Sección "Mesas y barra" del detalle de tienda (B7 §2). Se monta
// dentro de `StoreDetailPage`. Muestra:
//  - Tabla con todas las mesas activas + estado derivado (libre /
//    abierta). El estado lo calcula el backend.
//  - Botón "+ Nueva mesa" → modal con nombre/capacidad/zona.
//  - Botón "+ Configurar barra" → modal con seatCount. Sólo se ofrece
//    si la tienda aún no tiene barra configurada.
//  - Acciones por fila: eliminar (soft) si está libre.
//
// El canvas drag-and-drop opcional (positionX/Y/width/height) queda
// fuera de B7. Las columnas viven en BD para evolutivo; el TPV renderiza
// en grid auto sin canvas.

import { useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Coffee, Sofa, Trash2, Wine } from "lucide-react";

import { api, ApiError, readEffectiveAuth, type AdminRole } from "../api.js";
import { FieldError, OutlineButton, PrimaryButton } from "../ui.js";

type TableZone = "SALON" | "TERRAZA" | "BARRA" | "RESERVADO";

interface ApiTable {
  id: string;
  name: string;
  capacity: number;
  zone: TableZone;
  barSeatIndex: number | null;
  groupedIntoTableId: string | null;
  state: "FREE" | "OPEN" | "BILLING";
  activeTicket: {
    id: string;
    total: string;
    diners: number | null;
    openedAt: string;
    openedByEmail: string | null;
    lineCount: number;
  } | null;
}

const ZONE_LABEL: Record<TableZone, string> = {
  SALON: "Salón",
  TERRAZA: "Terraza",
  BARRA: "Barra",
  RESERVADO: "Reservado",
};

const ZONE_ICON: Record<TableZone, typeof Sofa> = {
  SALON: Sofa,
  TERRAZA: Sofa,
  BARRA: Wine,
  RESERVADO: Coffee,
};

export function TablesSection({
  storeId,
  role,
}: {
  storeId: string;
  role: AdminRole | null;
}) {
  const [tables, setTables] = useState<ApiTable[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showNewTable, setShowNewTable] = useState(false);
  const [showBarSetup, setShowBarSetup] = useState(false);
  const navigate = useNavigate();
  // v1.4-Bugs-Operativos Lote 2: cap impersonation readonly.
  const canMutate = role === "OWNER" && readEffectiveAuth().canEdit;

  async function refresh() {
    try {
      const res = await api<{ tables: ApiTable[] }>(`/admin/stores/${storeId}/tables`);
      setTables(res.tables);
      setError(null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        navigate("/admin/login");
        return;
      }
      if (err instanceof ApiError) setError(err.message);
      else setError("Error inesperado");
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeId]);

  const barConfigured = tables.some(
    (t) => t.zone === "BARRA" && t.barSeatIndex !== null,
  );
  const openCount = tables.filter((t) => t.state !== "FREE").length;

  return (
    <section className="bg-white rounded-2xl border border-slate-200 p-6 md:p-7 mb-5">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h2 className="text-[17px] font-semibold text-mipiace-ink tracking-tight">
            Mesas y barra
          </h2>
          <p className="text-[13px] text-slate-500 mt-1">
            {tables.length === 0
              ? "Esta tienda aún no tiene mesas configuradas."
              : `${tables.length} ${tables.length === 1 ? "mesa" : "mesas"} · ${openCount} abiertas ahora mismo`}
          </p>
        </div>
        {canMutate && (
          <div className="flex flex-wrap gap-2">
            {!barConfigured && (
              <OutlineButton
                onClick={() => setShowBarSetup(true)}
                className="!h-10 !text-[13.5px]"
              >
                + Configurar barra
              </OutlineButton>
            )}
            <PrimaryButton
              type="button"
              onClick={() => setShowNewTable(true)}
              className="!w-auto !h-10 !px-4 !text-[13.5px]"
            >
              + Nueva mesa
            </PrimaryButton>
          </div>
        )}
      </div>

      <FieldError message={error} />

      {tables.length === 0 ? (
        <div className="text-[13px] text-slate-500 bg-mipiace-stone rounded-xl p-4">
          Para vender en modo bar, configura primero las mesas. Si la
          tienda es retail puro, puedes dejarlo en blanco.
        </div>
      ) : (
        <TableList tables={tables} canMutate={canMutate} onChanged={refresh} />
      )}

      {showNewTable && (
        <NewTableModal
          storeId={storeId}
          existingNames={tables.map((t) => t.name)}
          onClose={() => setShowNewTable(false)}
          onCreated={() => {
            setShowNewTable(false);
            refresh();
          }}
        />
      )}
      {showBarSetup && (
        <BarSetupModal
          storeId={storeId}
          onClose={() => setShowBarSetup(false)}
          onCreated={() => {
            setShowBarSetup(false);
            refresh();
          }}
        />
      )}
    </section>
  );
}

function TableList({
  tables,
  canMutate,
  onChanged,
}: {
  tables: ApiTable[];
  canMutate: boolean;
  onChanged: () => void;
}) {
  const byZone = new Map<TableZone, ApiTable[]>();
  for (const t of tables) {
    const arr = byZone.get(t.zone) ?? [];
    arr.push(t);
    byZone.set(t.zone, arr);
  }
  const order: TableZone[] = ["SALON", "TERRAZA", "BARRA", "RESERVADO"];
  return (
    <div className="space-y-5">
      {order.map((zone) => {
        const list = byZone.get(zone);
        if (!list || list.length === 0) return null;
        const Icon = ZONE_ICON[zone];
        return (
          <div key={zone}>
            <div className="flex items-center gap-2 mb-2 text-[11px] uppercase tracking-wider font-medium text-slate-500">
              <Icon className="w-3.5 h-3.5" /> {ZONE_LABEL[zone]} ·{" "}
              <span className="lowercase tracking-normal text-slate-400">
                {list.length} {list.length === 1 ? "puesto" : "puestos"}
              </span>
            </div>
            {zone === "BARRA" ? (
              <div className="grid grid-cols-4 md:grid-cols-8 gap-2">
                {list
                  .slice()
                  .sort((a, b) => (a.barSeatIndex ?? 0) - (b.barSeatIndex ?? 0))
                  .map((t) => (
                    <BarSeatChip
                      key={t.id}
                      table={t}
                      canMutate={canMutate}
                      onChanged={onChanged}
                    />
                  ))}
              </div>
            ) : (
              <div className="space-y-2">
                {list.map((t) => (
                  <TableRow
                    key={t.id}
                    table={t}
                    canMutate={canMutate}
                    onChanged={onChanged}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function BarSeatChip({
  table,
  canMutate,
  onChanged,
}: {
  table: ApiTable;
  canMutate: boolean;
  onChanged: () => void;
}) {
  const tone =
    table.state === "OPEN"
      ? "bg-mipiace-coral-soft border-mipiace-coral/40 text-mipiace-coral-dark"
      : "bg-white border-slate-200 text-slate-600";
  return (
    <div
      className={`rounded-xl border-2 p-2 text-center ${tone} relative group`}
    >
      <div className="text-[14px] font-semibold">{table.name}</div>
      {table.activeTicket && (
        <div className="text-[10.5px] tabular-nums opacity-80">
          {Number(table.activeTicket.total).toFixed(2)} €
        </div>
      )}
      {canMutate && table.state === "FREE" && (
        <button
          type="button"
          onClick={() => deleteTable(table, onChanged)}
          className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-white border border-slate-200 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
          title="Eliminar puesto"
        >
          <Trash2 className="w-3 h-3 text-slate-500" />
        </button>
      )}
    </div>
  );
}

function TableRow({
  table,
  canMutate,
  onChanged,
}: {
  table: ApiTable;
  canMutate: boolean;
  onChanged: () => void;
}) {
  const stateLabel =
    table.state === "OPEN"
      ? "Abierta"
      : table.state === "BILLING"
        ? "Cobrando"
        : "Libre";
  const stateTone =
    table.state === "FREE"
      ? "bg-slate-100 text-slate-600"
      : "bg-mipiace-coral-soft text-mipiace-coral-dark";
  return (
    <div className="flex items-center gap-4 rounded-xl border border-slate-200 p-3.5">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[15px] font-semibold text-mipiace-ink">
            {table.name}
          </span>
          <span
            className={`text-[10.5px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded ${stateTone}`}
          >
            {stateLabel}
          </span>
        </div>
        <div className="text-[12.5px] text-slate-500 mt-0.5">
          Capacidad {table.capacity}
          {table.activeTicket && (
            <>
              {" · "}Total{" "}
              <span className="tabular-nums">
                {Number(table.activeTicket.total).toFixed(2)} €
              </span>
              {table.activeTicket.lineCount > 0 && (
                <> · {table.activeTicket.lineCount} líneas</>
              )}
            </>
          )}
        </div>
      </div>
      {canMutate && table.state === "FREE" && (
        <button
          type="button"
          onClick={() => deleteTable(table, onChanged)}
          className="text-slate-400 hover:text-red-500 transition-colors"
          title="Eliminar mesa"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}

async function deleteTable(table: ApiTable, onChanged: () => void) {
  if (
    !window.confirm(
      `¿Eliminar ${table.name}? Esta acción no afecta a ningún ticket histórico.`,
    )
  ) {
    return;
  }
  try {
    await api(`/admin/tables/${table.id}`, { method: "DELETE" });
    onChanged();
  } catch (err) {
    if (err instanceof ApiError) {
      alert(err.message);
    } else {
      alert("Error inesperado");
    }
  }
}

function NewTableModal({
  storeId,
  existingNames,
  onClose,
  onCreated,
}: {
  storeId: string;
  existingNames: string[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [capacity, setCapacity] = useState(2);
  const [zone, setZone] = useState<TableZone>("SALON");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Indica un nombre");
      return;
    }
    if (existingNames.includes(trimmed)) {
      setError("Ya existe una mesa con ese nombre");
      return;
    }
    setSubmitting(true);
    try {
      await api(`/admin/stores/${storeId}/tables`, {
        method: "POST",
        body: { name: trimmed, capacity, zone },
      });
      onCreated();
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
      else setError("Error inesperado");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ModalShell onClose={onClose} title="Nueva mesa">
      <form onSubmit={onSubmit} className="space-y-3">
        <RawField
          id="table-name"
          name="tableName"
          label="Nombre"
          autoFocus
          value={name}
          onChange={setName}
          placeholder="M1, Reservado 2, …"
          maxLength={40}
        />
        <div>
          <label
            htmlFor="table-zone"
            className="block text-[13px] font-medium text-mipiace-ink-soft mb-1.5"
          >
            Zona
          </label>
          <select
            id="table-zone"
            name="tableZone"
            value={zone}
            onChange={(e) => setZone(e.target.value as TableZone)}
            className="w-full h-12 px-4 rounded-xl bg-mipiace-stone border border-transparent focus:border-mipiace-coral/30 focus:bg-white focus:ring-2 focus:ring-mipiace-coral/40 outline-none text-[14.5px]"
          >
            <option value="SALON">Salón</option>
            <option value="TERRAZA">Terraza</option>
            <option value="BARRA">Barra (puesto individual)</option>
            <option value="RESERVADO">Reservado</option>
          </select>
        </div>
        <RawField
          id="table-capacity"
          name="tableCapacity"
          label="Capacidad"
          type="number"
          min={1}
          max={50}
          value={capacity.toString()}
          onChange={(v) => setCapacity(Number(v || 1))}
        />
        <FieldError message={error} />
        <div className="flex justify-end gap-2 pt-2">
          <OutlineButton onClick={onClose} className="!h-10">
            Cancelar
          </OutlineButton>
          <PrimaryButton
            type="submit"
            disabled={submitting}
            className="!w-auto !h-10 !px-5"
          >
            {submitting ? "Creando…" : "Crear mesa"}
          </PrimaryButton>
        </div>
      </form>
    </ModalShell>
  );
}

function BarSetupModal({
  storeId,
  onClose,
  onCreated,
}: {
  storeId: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [seatCount, setSeatCount] = useState(8);
  const [baseName, setBaseName] = useState("B");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (seatCount < 1 || seatCount > 100) {
      setError("Indica entre 1 y 100 puestos");
      return;
    }
    setSubmitting(true);
    try {
      await api(`/admin/stores/${storeId}/tables/bar-setup`, {
        method: "POST",
        body: { seatCount, baseName: baseName.trim() || "B" },
      });
      onCreated();
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
      else setError("Error inesperado");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ModalShell onClose={onClose} title="Configurar barra">
      <form onSubmit={onSubmit} className="space-y-3">
        <p className="text-[13px] text-slate-500">
          Crea N puestos numerados ({baseName || "B"}1, {baseName || "B"}2,
          …). Cada puesto es una mesa de capacidad 1 con su propia comanda.
        </p>
        <RawField
          id="bar-base-name"
          name="barBaseName"
          label="Prefijo"
          value={baseName}
          onChange={setBaseName}
          maxLength={5}
          placeholder="B"
        />
        <RawField
          id="bar-seat-count"
          name="barSeatCount"
          label="Número de puestos"
          type="number"
          min={1}
          max={100}
          value={seatCount.toString()}
          onChange={(v) => setSeatCount(Number(v || 1))}
        />
        <FieldError message={error} />
        <div className="flex justify-end gap-2 pt-2">
          <OutlineButton onClick={onClose} className="!h-10">
            Cancelar
          </OutlineButton>
          <PrimaryButton
            type="submit"
            disabled={submitting}
            className="!w-auto !h-10 !px-5"
          >
            {submitting ? "Creando…" : `Crear ${seatCount} puestos`}
          </PrimaryButton>
        </div>
      </form>
    </ModalShell>
  );
}

// Input genérico para los modales de B7 (TextField del módulo `ui`
// no soporta `type=number`, `min`, `max`, `maxLength` o `autoFocus`).
// Mantiene la misma apariencia visual.
function RawField({
  id,
  name,
  label,
  type = "text",
  value,
  onChange,
  autoFocus,
  placeholder,
  maxLength,
  min,
  max,
}: {
  id: string;
  name: string;
  label: string;
  type?: "text" | "number";
  value: string;
  onChange: (v: string) => void;
  autoFocus?: boolean;
  placeholder?: string;
  maxLength?: number;
  min?: number;
  max?: number;
}) {
  return (
    <div>
      <label
        htmlFor={id}
        className="block text-[13px] font-medium text-mipiace-ink-soft mb-1.5"
      >
        {label}
      </label>
      <input
        id={id}
        name={name}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoFocus={autoFocus}
        placeholder={placeholder}
        maxLength={maxLength}
        min={min}
        max={max}
        className="w-full h-12 px-3.5 rounded-xl bg-mipiace-stone border border-transparent text-[14.5px] text-mipiace-ink focus:bg-white focus:border-mipiace-coral/30 focus:ring-2 focus:ring-mipiace-coral/30 focus:outline-none"
      />
    </div>
  );
}

function ModalShell({
  onClose,
  title,
  children,
}: {
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="fixed inset-0 bg-mipiace-ink/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl shadow-xl border border-slate-200 p-6 md:p-7 w-full max-w-md">
        <div className="flex items-start justify-between mb-4">
          <h3 className="text-[18px] font-semibold text-mipiace-ink tracking-tight">
            {title}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-mipiace-ink text-[13px]"
          >
            Cerrar
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
