// Sección Clientes del TPV (B-koibox-1). Lista A–Z con buscador instantáneo
// (feedback <100 ms sobre el caché local Dexie; sync en background), ficha
// de cliente con pestañas Historial / Ficha técnica / Bonos, y alta/edición
// inline (sin modal bloqueante). Se monta como overlay a pantalla completa
// desde el TPV, sólo si la capability CRM está activa (ADR-K6).

import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Loader2,
  Plus,
  ReceiptText,
  ShieldCheck,
  Stethoscope,
  Ticket as TicketIcon,
  X,
} from "lucide-react";

import { scrollFocusIntoView } from "../lib/visualViewportSync.js";
import {
  addClientConsent,
  addClientTechnicalNote,
  clientFullName,
  getClientDetail,
  getClientHistory,
  getClientVouchers,
  loadClientsFromCache,
  refreshClients,
  searchClientsLocal,
  type ClientDetail,
  type ClientHistory,
  type ClientRow,
  type ClientVouchers,
} from "../lib/clients.js";
import { ClientForm } from "./ClientForm.js";

export function ClientsPage({ onClose }: { onClose: () => void }) {
  const [all, setAll] = useState<ClientRow[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  async function reload() {
    const cached = await loadClientsFromCache();
    setAll(cached);
    setLoading(false);
    try {
      const fresh = await refreshClients();
      setAll(fresh);
    } catch {
      /* offline: caché */
    }
  }

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const results = useMemo(() => searchClientsLocal(all, query, 200), [all, query]);

  return (
    <div className="fixed inset-0 z-40 bg-mipiace-stone flex flex-col font-sans">
      {/* Cabecera */}
      <div className="flex items-center gap-3 px-4 md:px-6 h-16 bg-white border-b border-slate-200 shrink-0">
        <button
          onClick={onClose}
          className="h-11 w-11 rounded-2xl hover:bg-slate-100 flex items-center justify-center text-mipiace-ink"
          aria-label="Volver"
        >
          <ArrowLeft className="w-5 h-5" strokeWidth={2.25} />
        </button>
        <h1 className="text-[18px] font-semibold text-mipiace-ink flex-1">Clientes</h1>
        <button
          onClick={() => setCreating(true)}
          className="h-11 px-4 rounded-2xl bg-mipiace-coral hover:bg-mipiace-coral-dark text-white text-[14px] font-medium flex items-center gap-2"
        >
          <Plus className="w-[18px] h-[18px]" strokeWidth={2.25} />
          <span className="hidden sm:inline">Nuevo</span>
        </button>
      </div>

      {/* Buscador */}
      <div className="px-4 md:px-6 py-3 bg-white border-b border-slate-100 shrink-0">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={scrollFocusIntoView}
          type="search"
          inputMode="search"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          placeholder="Buscar por nombre, teléfono o email…"
          className="w-full h-11 px-3.5 rounded-xl bg-mipiace-stone border border-transparent text-[14px] focus:bg-white focus:border-mipiace-coral/30 focus:ring-2 focus:ring-mipiace-coral/30 focus:outline-none"
        />
      </div>

      {/* Lista A–Z */}
      <div className="flex-1 overflow-y-auto px-4 md:px-6 py-4">
        {loading ? (
          <div className="flex items-center gap-2 text-[13px] text-slate-500 py-8 justify-center">
            <Loader2 className="w-4 h-4 animate-spin" /> Cargando clientes…
          </div>
        ) : results.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center text-[14px] text-slate-500 max-w-md mx-auto">
            {query
              ? "Ningún cliente coincide con la búsqueda."
              : "Todavía no hay clientes. Pulsa «Nuevo» para dar de alta el primero."}
          </div>
        ) : (
          <ul className="space-y-2 max-w-2xl mx-auto">
            {results.map((c) => (
              <li key={c.id}>
                <button
                  onClick={() => setSelectedId(c.id)}
                  className="w-full text-left bg-white rounded-2xl border border-slate-200 hover:border-mipiace-coral/40 p-3.5 flex items-center gap-3"
                >
                  <div className="h-10 w-10 rounded-full bg-mipiace-coral-soft text-mipiace-coral-dark flex items-center justify-center text-[14px] font-semibold shrink-0">
                    {initials(c)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[14.5px] font-medium text-mipiace-ink truncate flex items-center gap-2">
                      {clientFullName(c)}
                      {c.syncState === "pending" && (
                        <span className="text-[10.5px] text-amber-700 bg-amber-50 rounded-full px-1.5 py-0.5 shrink-0">
                          sin conexión
                        </span>
                      )}
                    </div>
                    <div className="text-[12.5px] text-slate-500 truncate">
                      {c.phone ?? c.email ?? "Sin datos de contacto"}
                    </div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Alta (panel lateral) */}
      {creating && (
        <SidePanel title="Nuevo cliente" onClose={() => setCreating(false)}>
          <ClientForm
            onSaved={(c) => {
              setAll((prev) => [c, ...prev.filter((x) => x.id !== c.id)]);
              setCreating(false);
              setSelectedId(c.id);
            }}
            onCancel={() => setCreating(false)}
          />
        </SidePanel>
      )}

      {/* Ficha del cliente */}
      {selectedId && (
        <ClientDetailDrawer
          clientId={selectedId}
          onClose={() => setSelectedId(null)}
          onUpdated={(c) =>
            setAll((prev) => prev.map((x) => (x.id === c.id ? c : x)))
          }
        />
      )}
    </div>
  );
}

function initials(c: { firstName: string; lastName: string }): string {
  return `${c.firstName[0] ?? ""}${c.lastName[0] ?? ""}`.toUpperCase() || "?";
}

// Panel lateral genérico (deslizante en móvil, centrado en escritorio).
// No es un modal bloqueante del flujo crítico: es un panel de la propia
// sección Clientes.
function SidePanel({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 bg-mipiace-ink/40 flex items-end sm:items-center justify-end p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white w-full sm:max-w-md sm:rounded-3xl border border-slate-200 p-6 md:p-7 max-h-[100vh] sm:max-h-[92vh] overflow-y-auto"
        style={{ paddingBottom: "calc(1.5rem + var(--keyboard-offset, 0px))" }}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-[18px] font-semibold text-mipiace-ink">{title}</h2>
          <button
            onClick={onClose}
            className="h-9 w-9 rounded-xl hover:bg-slate-50 text-slate-500 flex items-center justify-center"
            aria-label="Cerrar"
          >
            <X className="w-4 h-4" strokeWidth={2.25} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

type Tab = "history" | "technical" | "vouchers";

function ClientDetailDrawer({
  clientId,
  onClose,
  onUpdated,
}: {
  clientId: string;
  onClose: () => void;
  onUpdated: (c: ClientRow) => void;
}) {
  const [detail, setDetail] = useState<ClientDetail | null>(null);
  const [editing, setEditing] = useState(false);
  const [tab, setTab] = useState<Tab>("history");
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setError(null);
    try {
      setDetail(await getClientDetail(clientId));
    } catch {
      setError("No se pudo cargar la ficha (¿sin conexión?).");
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  return (
    <SidePanel
      title={detail ? clientFullName(detail.client) : "Ficha de cliente"}
      onClose={onClose}
    >
      {error && (
        <div className="text-[12.5px] text-red-700 bg-red-50 rounded-xl p-3 mb-3">
          {error}
        </div>
      )}
      {!detail ? (
        <div className="flex items-center gap-2 text-[13px] text-slate-500 py-8 justify-center">
          <Loader2 className="w-4 h-4 animate-spin" /> Cargando…
        </div>
      ) : editing ? (
        <ClientForm
          existing={detail.client}
          onSaved={(c) => {
            setDetail({ ...detail, client: c });
            onUpdated(c);
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <>
          <ClientSummary detail={detail} onEdit={() => setEditing(true)} />
          <ConsentsSection
            clientId={clientId}
            detail={detail}
            onChanged={() => void load()}
          />
          <div className="flex gap-1 mt-4 mb-3 bg-mipiace-stone rounded-xl p-1">
            <TabButton active={tab === "history"} onClick={() => setTab("history")}>
              Historial
            </TabButton>
            <TabButton active={tab === "technical"} onClick={() => setTab("technical")}>
              Ficha técnica
            </TabButton>
            <TabButton active={tab === "vouchers"} onClick={() => setTab("vouchers")}>
              Bonos
            </TabButton>
          </div>
          {tab === "history" && <HistoryTab clientId={clientId} />}
          {tab === "technical" && (
            <TechnicalTab
              clientId={clientId}
              detail={detail}
              onAdded={() => void load()}
            />
          )}
          {tab === "vouchers" && <VouchersTab clientId={clientId} />}
        </>
      )}
    </SidePanel>
  );
}

function ClientSummary({
  detail,
  onEdit,
}: {
  detail: ClientDetail;
  onEdit: () => void;
}) {
  const c = detail.client;
  return (
    <div className="bg-mipiace-stone rounded-2xl p-4 space-y-1.5">
      <Row label="Teléfono" value={c.phone} />
      <Row label="Email" value={c.email} />
      <Row label="Nacimiento" value={c.birthdate} />
      <Row label="RGPD marketing" value={c.marketingOptIn ? "Sí" : "No"} />
      {c.holdedContactId && <Row label="Contacto Holded" value="Enlazado" />}
      {c.notes && <Row label="Notas" value={c.notes} />}
      {detail.consents.length > 0 && (
        <div className="flex items-center gap-1.5 text-[12px] text-emerald-700 pt-1">
          <ShieldCheck className="w-3.5 h-3.5" strokeWidth={2.25} />
          {detail.consents.length} consentimiento(s) registrado(s)
        </div>
      )}
      <button
        onClick={onEdit}
        className="mt-2 h-9 px-3.5 rounded-xl bg-white border border-slate-200 hover:bg-slate-50 text-[13px] font-medium text-mipiace-ink"
      >
        Editar datos
      </button>
    </div>
  );
}

// Consentimientos RGPD: alta manual (la firma digital es fase 2, fuera
// de alcance). Sólo registrar DATA / TREATMENT con fecha `now`.
function ConsentsSection({
  clientId,
  detail,
  onChanged,
}: {
  clientId: string;
  detail: ClientDetail;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState<"DATA" | "TREATMENT" | null>(null);
  const has = (kind: "DATA" | "TREATMENT") =>
    detail.consents.some((c) => c.kind === kind);

  async function register(kind: "DATA" | "TREATMENT") {
    setBusy(kind);
    try {
      await addClientConsent(clientId, kind);
      onChanged();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mt-3 bg-white rounded-2xl border border-slate-200 p-3.5">
      <div className="text-[12.5px] font-medium text-slate-500 mb-2">
        Consentimientos RGPD
      </div>
      <div className="flex gap-2">
        {(["DATA", "TREATMENT"] as const).map((kind) => (
          <button
            key={kind}
            disabled={has(kind) || busy !== null}
            onClick={() => register(kind)}
            className={`flex-1 h-10 rounded-xl text-[12.5px] font-medium flex items-center justify-center gap-1.5 ${
              has(kind)
                ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                : "bg-mipiace-stone hover:bg-slate-100 text-mipiace-ink border border-transparent"
            }`}
          >
            {busy === kind ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              has(kind) && <ShieldCheck className="w-3.5 h-3.5" strokeWidth={2.25} />
            )}
            {kind === "DATA" ? "Datos" : "Tratamiento"}
          </button>
        ))}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div className="flex justify-between gap-3 text-[13px]">
      <span className="text-slate-500 shrink-0">{label}</span>
      <span className="text-mipiace-ink text-right break-words">{value}</span>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 h-9 rounded-lg text-[12.5px] font-medium transition-colors ${
        active
          ? "bg-white text-mipiace-ink shadow-sm"
          : "text-slate-500 hover:text-mipiace-ink"
      }`}
    >
      {children}
    </button>
  );
}

function HistoryTab({ clientId }: { clientId: string }) {
  const [data, setData] = useState<ClientHistory | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let cancelled = false;
    getClientHistory(clientId)
      .then((d) => !cancelled && setData(d))
      .catch(() => !cancelled && setError(true));
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  if (error)
    return <Empty>No se pudo cargar el historial.</Empty>;
  if (!data) return <TabLoading />;
  if (data.entries.length === 0)
    return (
      <Empty>
        Sin compras registradas. Las citas y bonos aparecerán aquí cuando estén
        disponibles.
      </Empty>
    );
  return (
    <ul className="space-y-2">
      {data.entries.map((e) => (
        <li
          key={e.id}
          className="bg-white rounded-xl border border-slate-200 p-3 flex items-center gap-3"
        >
          <TicketIcon className="w-4 h-4 text-slate-400 shrink-0" strokeWidth={2.25} />
          <div className="flex-1 min-w-0">
            <div className="text-[13.5px] font-medium text-mipiace-ink">
              Ticket {e.holdedDocNumber ?? e.internalNumber}
            </div>
            <div className="text-[12px] text-slate-500">
              {new Date(e.at).toLocaleDateString("es-ES", {
                day: "2-digit",
                month: "short",
                year: "numeric",
              })}
            </div>
          </div>
          <div className="text-[14px] font-semibold text-mipiace-ink">
            {e.total.toLocaleString("es-ES", { style: "currency", currency: "EUR" })}
          </div>
        </li>
      ))}
    </ul>
  );
}

function TechnicalTab({
  clientId,
  detail,
  onAdded,
}: {
  clientId: string;
  detail: ClientDetail;
  onAdded: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!body.trim()) return;
    setBusy(true);
    try {
      await addClientTechnicalNote(clientId, body.trim());
      setBody("");
      setAdding(false);
      onAdded();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      {detail.technicalNotes.length === 0 && !adding && (
        <Empty>Sin notas de ficha técnica.</Empty>
      )}
      {detail.technicalNotes.map((n) => (
        <div
          key={n.id}
          className="bg-white rounded-xl border border-slate-200 p-3 flex gap-3"
        >
          <Stethoscope className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" strokeWidth={2.25} />
          <div className="flex-1 min-w-0">
            <div className="text-[13.5px] text-mipiace-ink whitespace-pre-wrap break-words">
              {n.body}
            </div>
            <div className="text-[12px] text-slate-400 mt-0.5">
              {new Date(n.createdAt).toLocaleDateString("es-ES")}
            </div>
          </div>
        </div>
      ))}
      {adding ? (
        <div className="space-y-2">
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onFocus={scrollFocusIntoView}
            rows={3}
            placeholder="Fórmula, parámetros del tratamiento, observaciones…"
            className="w-full px-3.5 py-2.5 rounded-xl bg-mipiace-stone border border-transparent text-[14px] focus:bg-white focus:border-mipiace-coral/30 focus:ring-2 focus:ring-mipiace-coral/30 focus:outline-none resize-none"
          />
          <div className="flex gap-2">
            <button
              onClick={() => {
                setAdding(false);
                setBody("");
              }}
              className="flex-1 h-10 rounded-xl border border-slate-200 hover:bg-slate-50 text-[13px] text-mipiace-ink-soft font-medium"
            >
              Cancelar
            </button>
            <button
              onClick={save}
              disabled={!body.trim() || busy}
              className="flex-1 h-10 rounded-xl bg-mipiace-coral hover:bg-mipiace-coral-dark disabled:opacity-50 text-white text-[13px] font-medium flex items-center justify-center gap-2"
            >
              {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Guardar
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="w-full h-10 rounded-xl border-2 border-dashed border-slate-200 hover:border-mipiace-coral/40 text-slate-500 hover:text-mipiace-coral-dark text-[13px] font-medium"
        >
          + Añadir nota técnica
        </button>
      )}
    </div>
  );
}

function VouchersTab({ clientId }: { clientId: string }) {
  const [data, setData] = useState<ClientVouchers | null>(null);
  useEffect(() => {
    let cancelled = false;
    getClientVouchers(clientId)
      .then((d) => !cancelled && setData(d))
      .catch(() => !cancelled && setData({ balance: { sessionsLeft: 0, amountLeftCents: 0 }, vouchers: [] }));
    return () => {
      cancelled = true;
    };
  }, [clientId]);
  if (!data) return <TabLoading />;
  // B5 rellenará este contrato; hoy es un placeholder informativo.
  return (
    <Empty>
      <ReceiptText className="w-5 h-5 mx-auto mb-2 text-slate-300" strokeWidth={2} />
      Disponible con el módulo de bonos.
    </Empty>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-6 text-center text-[13px] text-slate-500">
      {children}
    </div>
  );
}

function TabLoading() {
  return (
    <div className="flex items-center gap-2 text-[13px] text-slate-500 py-6 justify-center">
      <Loader2 className="w-4 h-4 animate-spin" /> Cargando…
    </div>
  );
}
