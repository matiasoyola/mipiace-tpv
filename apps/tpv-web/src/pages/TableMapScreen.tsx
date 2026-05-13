// Mapa de sala del vertical bar (B7 §3). Punto de entrada del cajero
// cuando la tienda tiene mesas configuradas. Render:
//   - Header reuso del TPV (logo + Sale topbar reducida).
//   - Cinta de zonas: Salón / Terraza / Barra / Reservados / Todos.
//   - Grid de mesas con estado derivado (libre / abierta / cobrando).
//   - Barra como fila horizontal numerada (B1, B2, ...).
//   - Botón "Nueva venta rápida" arriba a la derecha (no FAB — el
//     reference-app lo coloca ahí, menos invasivo en tablet).
//
// Hasta tener WebSockets (F6), refrescamos cada 5 s con polling.
//
// El tap-flow se delega al padre (`App`) vía callbacks:
//   - onOpenTable(tableId, diners?) cuando el cajero toca una mesa libre
//   - onResumeTable(ticketId, tableId) cuando toca una ocupada
//   - onQuickSale() para venta rápida
// El padre decide cómo navegar (SalePage con `tableContext`, etc.).

import { useCallback, useEffect, useState } from "react";
import { Plus, WifiOff } from "lucide-react";

import { apiWithCashier, ApiError } from "../api.js";
import { Logo } from "../Logo.js";
import { useElapsedTime } from "../hooks/useElapsedTime.js";
import { useStoreEventStream } from "../hooks/useStoreEventStream.js";

type TableZone = "SALON" | "TERRAZA" | "BARRA" | "RESERVADO";

export interface ApiTable {
  id: string;
  name: string;
  capacity: number;
  zone: TableZone;
  positionX: number | null;
  positionY: number | null;
  width: number | null;
  height: number | null;
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
  createdAt: string;
}

interface ApiResponse {
  storeId: string | null;
  registerId: string;
  tables: ApiTable[];
}

const ZONE_LABEL: Record<TableZone | "ALL", string> = {
  ALL: "Todos",
  SALON: "Salón",
  TERRAZA: "Terraza",
  BARRA: "Barra",
  RESERVADO: "Reservados",
};

export interface TableMapScreenProps {
  cashierEmail: string;
  storeName: string;
  registerName: string;
  onPickTable: (table: ApiTable) => void;
  onQuickSale: () => void;
  onLogoutCashier: () => void;
  onCloseShift: () => void;
}

export function TableMapScreen(props: TableMapScreenProps) {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await apiWithCashier<ApiResponse>("/tpv/tables");
      setData(res);
      setError(null);
      setOffline(false);
    } catch (err) {
      if (err instanceof ApiError && err.status === 0) setOffline(true);
      else if (err instanceof ApiError) setError(err.message);
      else setError("Error inesperado");
    }
  }, []);

  useEffect(() => {
    void load();
    // Polling de respaldo cada 30s. Con WebSocket sano apenas hace
    // falta; en degraded confirma que el render no quede congelado.
    const id = setInterval(() => void load(), 30_000);
    return () => clearInterval(id);
  }, [load]);

  // WebSocket multi-terminal: cada vez que llega un evento del store
  // refrescamos el listado. Es el patrón más simple y mantiene el
  // mapa coherente sin lógica de merge granular en el cliente.
  const wsStatus = useStoreEventStream(data?.storeId ?? null, () => {
    void load();
  });
  useEffect(() => {
    if (wsStatus === "degraded") setOffline(true);
    else if (wsStatus === "open") setOffline(false);
  }, [wsStatus]);

  const tables = data?.tables ?? [];
  const [zoneFilter, setZoneFilter] = useState<TableZone | "ALL">("ALL");

  const counts = countByZone(tables);
  const openCount = tables.filter((t) => t.state !== "FREE").length;
  const visible =
    zoneFilter === "ALL"
      ? tables
      : tables.filter((t) => t.zone === zoneFilter);

  const salonLike = visible.filter((t) => t.zone !== "BARRA");
  const bar = visible.filter((t) => t.zone === "BARRA");

  return (
    <div className="min-h-screen bg-mipiace-stone flex flex-col font-sans">
      <header className="bg-white border-b border-slate-200 px-5 md:px-7 py-3.5 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Logo />
          <div className="hidden sm:block text-[12.5px] text-slate-500">
            {props.storeName} · {props.registerName}
          </div>
        </div>
        <div className="flex items-center gap-3">
          {offline && (
            <span className="hidden md:flex items-center gap-1.5 text-[12px] text-red-600">
              <WifiOff className="w-3.5 h-3.5" /> Sin conexión
            </span>
          )}
          <button
            type="button"
            onClick={props.onCloseShift}
            className="hidden md:block h-9 px-3 text-[12.5px] text-slate-500 hover:text-mipiace-ink"
          >
            Cerrar turno
          </button>
          <button
            type="button"
            onClick={props.onLogoutCashier}
            className="h-9 px-3 rounded-lg bg-mipiace-stone hover:bg-slate-100 text-[12.5px] text-mipiace-ink"
          >
            {props.cashierEmail.split("@")[0]}
          </button>
        </div>
      </header>

      <main className="flex-1 p-4 md:p-7 overflow-y-auto">
        {offline && (
          <div className="mb-5 flex items-start gap-3 rounded-2xl border border-red-300 bg-red-50 text-red-800 px-4 py-3">
            <WifiOff className="w-5 h-5 mt-0.5 shrink-0" />
            <div className="text-[13.5px] leading-snug">
              <div className="font-semibold">
                Sin conexión · mesas en modo lectura
              </div>
              <div className="text-[12.5px] opacity-90 mt-0.5">
                No se pueden abrir mesas nuevas ni añadir líneas hasta que
                vuelva la red. La venta rápida sigue funcionando offline.
              </div>
            </div>
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between mb-5 gap-3">
          <div>
            <h1 className="text-[22px] md:text-[24px] font-semibold text-mipiace-ink tracking-tight">
              Mapa de sala
            </h1>
            <p className="text-[13px] text-slate-500 mt-0.5">
              {openCount}{" "}
              {openCount === 1 ? "mesa abierta" : "mesas abiertas"} ·{" "}
              {tables.length - openCount} libres
            </p>
          </div>
          <button
            type="button"
            onClick={props.onQuickSale}
            className="h-11 px-4 rounded-2xl bg-mipiace-coral hover:bg-mipiace-coral-dark text-white text-[13.5px] font-medium flex items-center gap-2"
          >
            <Plus className="w-4 h-4" strokeWidth={2.25} />
            Nueva venta rápida
          </button>
        </div>

        <ZoneStrip
          zoneFilter={zoneFilter}
          setZoneFilter={setZoneFilter}
          counts={counts}
        />

        {/* Leyenda */}
        <div className="flex flex-wrap items-center gap-4 mb-6 text-[12.5px] text-slate-500">
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-md border border-slate-300 bg-white" />{" "}
            Libre
          </div>
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-md bg-mipiace-coral-soft border border-mipiace-coral/40" />{" "}
            Ocupada
          </div>
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-md bg-amber-50 border border-amber-300/60" />{" "}
            Pidiendo cuenta
          </div>
        </div>

        {error && (
          <div className="mb-4 text-[13px] text-red-700 bg-red-50 rounded-xl px-3.5 py-2.5">
            {error}
          </div>
        )}

        {tables.length === 0 ? (
          <EmptyState />
        ) : (
          <>
            {salonLike.length > 0 && (
              <RoomGrid
                title={
                  zoneFilter === "ALL"
                    ? "Salón · Terraza · Reservados"
                    : ZONE_LABEL[zoneFilter]
                }
                tables={salonLike}
                offline={offline}
                onPick={props.onPickTable}
              />
            )}
            {bar.length > 0 && (
              <BarStrip
                tables={bar}
                offline={offline}
                onPick={props.onPickTable}
              />
            )}
          </>
        )}
      </main>
    </div>
  );
}

function ZoneStrip({
  zoneFilter,
  setZoneFilter,
  counts,
}: {
  zoneFilter: TableZone | "ALL";
  setZoneFilter: (z: TableZone | "ALL") => void;
  counts: Record<TableZone, number>;
}) {
  const items: Array<{ id: TableZone | "ALL"; label: string; count?: number }> = [
    { id: "ALL", label: ZONE_LABEL.ALL },
    { id: "SALON", label: ZONE_LABEL.SALON, count: counts.SALON },
    { id: "TERRAZA", label: ZONE_LABEL.TERRAZA, count: counts.TERRAZA },
    { id: "BARRA", label: ZONE_LABEL.BARRA, count: counts.BARRA },
    { id: "RESERVADO", label: ZONE_LABEL.RESERVADO, count: counts.RESERVADO },
  ];
  return (
    <div className="flex flex-wrap gap-2 mb-5">
      {items.map((item) => {
        if (item.id !== "ALL" && (item.count ?? 0) === 0) return null;
        const active = zoneFilter === item.id;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => setZoneFilter(item.id)}
            className={`h-9 px-3.5 rounded-xl text-[13px] font-medium transition-colors ${
              active
                ? "bg-mipiace-coral-soft text-mipiace-coral-dark"
                : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-50"
            }`}
          >
            {item.label}
            {typeof item.count === "number" && (
              <span className="ml-1.5 text-[11px] opacity-60">
                {item.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function RoomGrid({
  title,
  tables,
  offline,
  onPick,
}: {
  title: string;
  tables: ApiTable[];
  offline: boolean;
  onPick: (t: ApiTable) => void;
}) {
  return (
    <div className="mb-7">
      <div className="text-[11px] uppercase tracking-wider font-medium text-slate-400 mb-3">
        {title}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
        {tables.map((t) => (
          <TableCard key={t.id} table={t} offline={offline} onPick={onPick} />
        ))}
      </div>
    </div>
  );
}

function TableCard({
  table,
  offline,
  onPick,
}: {
  table: ApiTable;
  offline: boolean;
  onPick: (t: ApiTable) => void;
}) {
  // Bloqueamos abrir mesa nueva cuando estamos offline (no podemos
  // reservar de forma coherente en el resto de terminales). Las mesas
  // ya abiertas siguen clicables → SalePage se encarga del modo
  // pesimista local.
  const disabled = offline && table.state === "FREE";
  const elapsed = useElapsedTime(table.activeTicket?.openedAt);
  const stateClass =
    table.state === "FREE"
      ? "bg-white border-slate-200 text-slate-500 hover:border-slate-300"
      : table.state === "BILLING"
        ? "bg-amber-50 border-amber-300/60 text-amber-800"
        : "bg-mipiace-coral-soft border-mipiace-coral/40 text-mipiace-coral-dark";
  return (
    <button
      type="button"
      onClick={() => onPick(table)}
      disabled={disabled}
      title={disabled ? "Sin conexión · no se pueden abrir mesas" : undefined}
      className={`relative aspect-[7/6] rounded-2xl border-2 ${stateClass} flex flex-col p-3.5 text-left transition-all hover:scale-[1.02] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100`}
    >
      <div className="flex justify-between items-start">
        <span className="text-[18px] font-semibold tracking-tight">
          {table.name}
        </span>
        <span className="text-[10.5px] uppercase tracking-wider font-medium opacity-80">
          {table.capacity} pax
        </span>
      </div>
      {table.state !== "FREE" && table.activeTicket && (
        <div className="mt-auto">
          <div className="flex items-center gap-1.5 text-[11.5px] opacity-90 mb-1">
            <span className="tabular-nums">{elapsed}</span>
            {table.activeTicket.diners ? (
              <>
                <span className="opacity-50">·</span>
                <span>{table.activeTicket.diners}p</span>
              </>
            ) : null}
            {table.activeTicket.openedByEmail && (
              <>
                <span className="opacity-50">·</span>
                <span>{initials(table.activeTicket.openedByEmail)}</span>
              </>
            )}
          </div>
          <div className="text-[18px] font-semibold tabular-nums tracking-tight">
            {Number(table.activeTicket.total).toFixed(2)} €
          </div>
        </div>
      )}
      {table.state === "BILLING" && (
        <span className="absolute top-2 right-2 text-[9.5px] font-semibold uppercase tracking-wider bg-amber-200/70 text-amber-900 px-1.5 py-0.5 rounded">
          cuenta
        </span>
      )}
    </button>
  );
}

function BarStrip({
  tables,
  offline,
  onPick,
}: {
  tables: ApiTable[];
  offline: boolean;
  onPick: (t: ApiTable) => void;
}) {
  const sorted = tables.slice().sort(
    (a, b) => (a.barSeatIndex ?? 0) - (b.barSeatIndex ?? 0),
  );
  return (
    <div className="mb-3">
      <div className="text-[11px] uppercase tracking-wider font-medium text-slate-400 mb-3">
        Barra · {sorted.length} puestos
      </div>
      <div className="grid grid-cols-4 md:grid-cols-8 gap-2.5">
        {sorted.map((t) => (
          <BarSeat key={t.id} table={t} offline={offline} onPick={onPick} />
        ))}
      </div>
    </div>
  );
}

function BarSeat({
  table,
  offline,
  onPick,
}: {
  table: ApiTable;
  offline: boolean;
  onPick: (t: ApiTable) => void;
}) {
  const stateClass =
    table.state === "FREE"
      ? "bg-white border-slate-200 text-slate-500 hover:border-slate-300"
      : table.state === "BILLING"
        ? "bg-amber-50 border-amber-300/60 text-amber-800"
        : "bg-mipiace-coral-soft border-mipiace-coral/40 text-mipiace-coral-dark";
  const disabled = offline && table.state === "FREE";
  return (
    <button
      type="button"
      onClick={() => onPick(table)}
      disabled={disabled}
      title={disabled ? "Sin conexión · no se pueden abrir mesas" : undefined}
      className={`aspect-square rounded-xl border-2 ${stateClass} flex flex-col items-center justify-center p-2 transition-all hover:scale-[1.05] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100`}
    >
      <span className="text-[14px] font-semibold">{table.name}</span>
      {table.activeTicket && (
        <span className="text-[11px] tabular-nums mt-0.5">
          {Number(table.activeTicket.total).toFixed(2)} €
        </span>
      )}
    </button>
  );
}

function EmptyState() {
  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-6 text-center text-[13.5px] text-slate-500">
      Esta tienda aún no tiene mesas. Pide al propietario que las
      configure desde el panel de admin.
    </div>
  );
}

function countByZone(tables: ApiTable[]): Record<TableZone, number> {
  const acc: Record<TableZone, number> = {
    SALON: 0,
    TERRAZA: 0,
    BARRA: 0,
    RESERVADO: 0,
  };
  for (const t of tables) acc[t.zone] += 1;
  return acc;
}

// Iniciales del cajero a partir del email para los chips de tarjeta.
// Usamos "MO" para "matias.oyola@..." y "L" para "lucia@..." (un sólo
// carácter cuando no hay separador).
function initials(email: string): string {
  const local = (email.split("@")[0] ?? "").trim();
  const parts = local.split(/[._-]/).filter(Boolean);
  const first = parts[0]?.[0];
  const second = parts[1]?.[0];
  if (first && second) return (first + second).toUpperCase();
  if (first) return first.toUpperCase();
  return "?";
}
