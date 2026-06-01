import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Building2,
  CheckCircle2,
  Circle,
  ExternalLink,
  RefreshCw,
} from "lucide-react";

import { formatRelative } from "../ui.js";

import { superApi, SuperAdminApiError } from "./api.js";
import { SuperAdminShell } from "./SuperAdminShell.js";
import type {
  BusinessType,
  HubResponse,
  HubTenantCard,
} from "./types.js";
import { BUSINESS_TYPE_LABEL } from "./types.js";

// v1.3-SuperAdmin-Hub · Lote 2 · pantalla de inicio del super-admin.
//
// Aglutina tres bloques que el implantador mira al abrir consola:
//   1. Tareas comunes — atajos al onboarding/audit pre-cocinados por
//      el endpoint según el estado del sistema (tickets fallando,
//      drafts pendientes, etc.).
//   2. Estado del sistema — Redis, conteo de tenants por estado,
//      tickets globales en SYNC_FAILED, último incremental.
//   3. Tarjetas por tenant — lista compacta con métricas y deep-link
//      al panel Holded cuando el tenant tiene holdedAccountId.
//
// Sin filtros ni paginación: en el piloto tenemos pocos tenants y el
// implantador prefiere verlos todos a la vez. Si crece la lista,
// el endpoint ya está preparado para añadir paginación.
export function HubPage() {
  const [data, setData] = useState<HubResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  async function load(): Promise<void> {
    setError(null);
    try {
      const res = await superApi<HubResponse>("/super-admin/hub");
      setData(res);
    } catch (err) {
      setError(err instanceof SuperAdminApiError ? err.message : "Error inesperado");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function onRefresh(): Promise<void> {
    if (refreshing) return;
    setRefreshing(true);
    await load();
  }

  if (loading) {
    return (
      <SuperAdminShell title="Hub">
        <div className="text-slate-500 text-[13.5px]">Cargando…</div>
      </SuperAdminShell>
    );
  }
  if (error || !data) {
    return (
      <SuperAdminShell title="Hub">
        <div className="text-red-600 text-[13.5px]">{error ?? "Sin datos"}</div>
      </SuperAdminShell>
    );
  }

  return (
    <SuperAdminShell title="Hub">
      <div className="flex items-center justify-between mb-5">
        <div className="text-[12.5px] text-slate-500">
          Actualizado {formatRelative(data.generatedAt)}
        </div>
        <button
          onClick={onRefresh}
          disabled={refreshing}
          className="inline-flex items-center gap-1.5 h-9 px-3 border border-slate-300 rounded-lg text-[12.5px] hover:bg-slate-50 disabled:opacity-40"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} />
          {refreshing ? "Actualizando…" : "Refrescar"}
        </button>
      </div>

      <TaskList tasks={data.tasks} />

      <SystemStatusPanel system={data.system} />

      <TenantsGrid cards={data.cards} />
    </SuperAdminShell>
  );
}

function TaskList({ tasks }: { tasks: HubResponse["tasks"] }) {
  if (tasks.length === 0) {
    return null;
  }
  return (
    <section className="mb-6">
      <h2 className="text-[14px] font-semibold text-slate-900 mb-3">
        Tareas comunes
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {tasks.map((task) => (
          <Link
            key={task.id}
            to={task.href}
            target={task.target ?? "_self"}
            className="bg-white border border-slate-200 rounded-xl p-4 hover:border-slate-400 hover:bg-slate-50 transition-colors group"
          >
            <div className="flex items-start gap-3">
              <ArrowRight className="w-4 h-4 mt-0.5 text-slate-400 group-hover:text-slate-700 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-[13.5px] font-medium text-slate-900">
                  {task.label}
                </div>
                <div className="text-[12px] text-slate-500 mt-0.5 leading-snug">
                  {task.hint}
                </div>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}

function SystemStatusPanel({ system }: { system: HubResponse["system"] }) {
  return (
    <section className="mb-6">
      <h2 className="text-[14px] font-semibold text-slate-900 mb-3">
        Estado del sistema
      </h2>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatusTile
          label="Redis"
          ok={system.redis.ok}
          value={
            system.redis.ok
              ? `OK${system.redis.latencyMs != null ? ` · ${system.redis.latencyMs} ms` : ""}`
              : "Caído"
          }
          hint={system.redis.error ?? undefined}
        />
        <StatusTile
          label="Tenants"
          ok={system.tenants.blocked === 0}
          value={`${system.tenants.active} activos · ${system.tenants.draft} draft`}
          hint={
            system.tenants.blocked > 0
              ? `${system.tenants.blocked} bloqueado(s)`
              : `${system.tenants.total} en total`
          }
        />
        <StatusTile
          label="Tickets en SYNC_FAILED"
          ok={system.globalTicketsSyncFailed === 0}
          value={
            system.globalTicketsSyncFailed === 0
              ? "Ninguno"
              : `${system.globalTicketsSyncFailed}`
          }
          hint={
            system.globalTicketsSyncFailed === 0
              ? "Holded acepta todos los tickets."
              : "Revisa la bandeja del tenant afectado."
          }
        />
        <StatusTile
          label="Último incremental"
          ok={system.lastIncrementalSyncAt != null}
          value={
            system.lastIncrementalSyncAt
              ? formatRelative(system.lastIncrementalSyncAt)
              : "Nunca"
          }
          hint={
            system.lastIncrementalSyncAt
              ? "Mejor marca de cualquier tenant."
              : "Espera al primer cron de 15 min."
          }
        />
      </div>
    </section>
  );
}

function StatusTile({
  label,
  value,
  hint,
  ok,
}: {
  label: string;
  value: string;
  hint?: string;
  ok: boolean;
}) {
  const Icon = ok ? CheckCircle2 : AlertTriangle;
  const tone = ok
    ? "border-emerald-200 bg-emerald-50"
    : "border-amber-200 bg-amber-50";
  const iconTone = ok ? "text-emerald-600" : "text-amber-600";
  return (
    <div className={`rounded-xl border p-4 ${tone}`}>
      <div className="flex items-center gap-1.5 mb-1">
        <Icon className={`w-4 h-4 ${iconTone}`} />
        <div className="text-[11.5px] uppercase tracking-wide text-slate-500 font-medium">
          {label}
        </div>
      </div>
      <div className="text-[16px] font-semibold text-slate-900 tabular-nums">
        {value}
      </div>
      {hint && <div className="text-[11.5px] text-slate-500 mt-1">{hint}</div>}
    </div>
  );
}

function TenantsGrid({ cards }: { cards: HubTenantCard[] }) {
  if (cards.length === 0) {
    return (
      <section>
        <h2 className="text-[14px] font-semibold text-slate-900 mb-3">
          Cuentas
        </h2>
        <div className="bg-white border border-dashed border-slate-300 rounded-xl p-6 text-center text-[13px] text-slate-500">
          Sin tenants todavía. Crea la primera cuenta desde "Tareas comunes".
        </div>
      </section>
    );
  }
  return (
    <section>
      <h2 className="text-[14px] font-semibold text-slate-900 mb-3">
        Cuentas ({cards.length})
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {cards.map((c) => (
          <TenantCardView key={c.id} card={c} />
        ))}
      </div>
    </section>
  );
}

const BUSINESS_TYPE_ICON: Record<BusinessType, string> = {
  HOSPITALITY: "·",
  RETAIL: "·",
  SERVICES: "·",
};

function TenantCardView({ card }: { card: HubTenantCard }) {
  const accent =
    card.status === "blocked"
      ? "border-red-200"
      : card.status === "warning"
        ? "border-amber-300"
        : "border-slate-200";
  const holdedUrl = card.holdedAccountId
    ? `https://app.holded.com/accounts/${encodeURIComponent(card.holdedAccountId)}`
    : null;

  return (
    <div className={`bg-white rounded-xl border ${accent} p-5 flex flex-col gap-3`}>
      <div className="flex items-start gap-2">
        <Building2 className="w-4 h-4 mt-0.5 text-slate-400 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <Link
            to={`/superadmin/tenants/${card.id}`}
            className="block text-[14px] font-semibold text-slate-900 hover:underline truncate"
          >
            {card.name}
          </Link>
          <div className="text-[11.5px] text-slate-500 mt-0.5 flex items-center gap-2 flex-wrap">
            <StateBadge state={card.onboardingState} />
            <span>{BUSINESS_TYPE_LABEL[card.businessType]}</span>
            {card.plan && (
              <>
                <span aria-hidden="true">{BUSINESS_TYPE_ICON[card.businessType]}</span>
                <span>plan {card.plan}</span>
              </>
            )}
          </div>
        </div>
        <StatusDot status={card.status} />
      </div>

      {card.blocked && card.blockedReason && (
        <div className="text-[12px] text-red-700 bg-red-50 border border-red-200 rounded-lg p-2">
          Bloqueado: {card.blockedReason}
        </div>
      )}

      <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[12px]">
        <Datum label="OWNER" value={card.ownerEmail ?? "—"} mono />
        <Datum
          label="Sync"
          value={
            card.lastIncrementalSyncAt
              ? formatRelative(card.lastIncrementalSyncAt)
              : card.holdedConnected
                ? "Pendiente"
                : "Sin Holded"
          }
        />
        <Datum
          label="Tickets 7d"
          value={card.ticketsLast7d.toString()}
        />
        <Datum
          label="Turnos abiertos"
          value={card.activeShifts.toString()}
        />
        {(card.ticketsSyncFailed > 0 || card.ticketsEmailFailed > 0) && (
          <div className="col-span-2 text-[11.5px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2 mt-1">
            {card.ticketsSyncFailed > 0 &&
              `${card.ticketsSyncFailed} ticket(s) SYNC_FAILED`}
            {card.ticketsSyncFailed > 0 && card.ticketsEmailFailed > 0 && " · "}
            {card.ticketsEmailFailed > 0 &&
              `${card.ticketsEmailFailed} email fallido(s)`}
          </div>
        )}
      </dl>

      <div className="flex gap-2 mt-auto pt-2 border-t border-slate-100 flex-wrap">
        <Link
          to={`/superadmin/tenants/${card.id}`}
          className="h-8 px-3 inline-flex items-center gap-1 border border-slate-300 rounded-lg text-[12px] text-slate-700 hover:bg-slate-50"
        >
          <Activity className="w-3.5 h-3.5" />
          Detalle
        </Link>
        {holdedUrl ? (
          <a
            href={holdedUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="h-8 px-3 inline-flex items-center gap-1 border border-slate-300 rounded-lg text-[12px] text-slate-700 hover:bg-slate-50"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            Holded
          </a>
        ) : (
          <Link
            to={`/superadmin/tenants/${card.id}`}
            className="h-8 px-3 inline-flex items-center gap-1 border border-dashed border-amber-300 rounded-lg text-[12px] text-amber-800 hover:bg-amber-50"
            title="Sin ID Holded — añádelo en el detalle del tenant"
          >
            <AlertTriangle className="w-3.5 h-3.5" />
            Sin ID Holded
          </Link>
        )}
      </div>
    </div>
  );
}

function StateBadge({ state }: { state: "DRAFT" | "ACTIVE" }) {
  const cls =
    state === "DRAFT"
      ? "bg-slate-100 text-slate-700"
      : "bg-emerald-100 text-emerald-800";
  return (
    <span className={`px-1.5 py-0.5 rounded text-[10.5px] font-medium uppercase tracking-wide ${cls}`}>
      {state}
    </span>
  );
}

function StatusDot({ status }: { status: "ok" | "warning" | "blocked" }) {
  const cls =
    status === "blocked"
      ? "text-red-500 fill-red-500"
      : status === "warning"
        ? "text-amber-500 fill-amber-500"
        : "text-emerald-500 fill-emerald-500";
  return <Circle className={`w-2.5 h-2.5 ${cls} flex-shrink-0 mt-1`} />;
}

function Datum({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <div className="text-[10.5px] uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <div
        className={`text-slate-900 truncate ${mono ? "font-mono text-[11.5px]" : "text-[12.5px]"}`}
        title={value}
      >
        {value}
      </div>
    </div>
  );
}
