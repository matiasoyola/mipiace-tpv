// Sección Clientes del TPV (B-reservas-1). Lista A–Z con buscador instantáneo
// (feedback <100 ms sobre el caché local Dexie; sync en background), ficha
// de cliente con pestañas Historial / Ficha técnica / Bonos, y alta/edición
// inline (sin modal bloqueante). Se monta como overlay a pantalla completa
// desde el TPV, sólo si la capability CRM está activa (ADR-R6).

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowLeft,
  CalendarClock,
  Loader2,
  Plus,
  ReceiptText,
  ShieldCheck,
  Stethoscope,
  Ticket as TicketIcon,
  X,
} from "lucide-react";

import { getCachedClinicaEnabled } from "../lib/catalog.js";
import { scrollFocusIntoView } from "../lib/visualViewportSync.js";
import { formatEur } from "../lib/money.js";
import {
  addClientConsent,
  addClientTechnicalNote,
  clientFullName,
  getClientDetail,
  getClientHistory,
  loadClientsFromCache,
  refreshClients,
  searchClientsLocal,
  type ClientDetail,
  type ClientHistory,
  type ClientRow,
} from "../lib/clients.js";
// B-reservas-8 · los bonos de la ficha. El saldo, la caducidad y la traza
// vienen HECHOS del servidor: aquí no se calcula ninguna sesión.
import {
  diaCorto,
  getBonosDeLaFicha,
  getDetalleDeBono,
  sesiones,
  type BonoDeLaFicha,
  type BonosDeLaFicha,
  type DetalleDeBono,
} from "../lib/bonos.js";
import { HistoriaViva } from "../clinica/HistoriaViva.js";
import { ValoracionSanitario } from "../clinica/ValoracionSanitario.js";
import { ClientForm } from "./ClientForm.js";

export function ClientsPage({
  onClose,
  esSanitario = false,
}: {
  onClose: () => void;
  // clinica-2 · LA MARCA sanitaria de quien está mirando. De ella depende
  // que la pestaña «Valoración» pida las respuestas o enseñe sólo los dos
  // botones que la recepcionista sí puede usar. Ver la nota del mount.
  esSanitario?: boolean;
}) {
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
          clinicaEncendida={getCachedClinicaEnabled()}
          esSanitario={esSanitario}
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

// clinica-8 · «historia» ya no es una pestaña del cajón: la historia se
// abre a pantalla completa (ver `historiaAbierta`). El valor sale del tipo
// para que no quede una rama muerta que alguien reviva sin darse cuenta.
type Tab = "history" | "technical" | "vouchers" | "valoracion";

function ClientDetailDrawer({
  clientId,
  onClose,
  onUpdated,
  clinicaEncendida,
  esSanitario,
}: {
  clientId: string;
  onClose: () => void;
  onUpdated: (c: ClientRow) => void;
  // clinica-2 · la pestaña de la valoración sólo existe con el módulo
  // encendido. En un bar o en una peluquería no hay nada que enseñar, y
  // una pestaña vacía que diga «Valoración» le cuenta a ese cliente que
  // el sistema guarda datos de salud de otros — es la misma razón por la
  // que las rutas clínicas contestan 404 y no 403 (clinica-1 §1).
  clinicaEncendida: boolean;
  esSanitario: boolean;
}) {
  const [detail, setDetail] = useState<ClientDetail | null>(null);
  const [editing, setEditing] = useState(false);
  const [tab, setTab] = useState<Tab>("history");
  const [error, setError] = useState<string | null>(null);
  // clinica-8 · LA HISTORIA SIEMPRE A PANTALLA COMPLETA, venga de donde
  // venga. Desde la cita ya abría así (clinica-6); desde la ficha del
  // cliente se pintaba DENTRO del cajón lateral de 420 px, y ahí la
  // historia sale cortada y el mapa de los dos pies se desborda — la
  // auditoría del 18-10 lo fotografió (capturas 77–80).
  //
  // No es un problema de anchos que se arregle con un `max-width`: la
  // historia es una pantalla entera de iPad apaisado (clinica-6 §3 hace la
  // cuenta: 576 px sólo para la columna de los pies). Dos sitios donde la
  // misma pantalla se ve distinta son dos sitios donde una úlcera cae en
  // distinto punto del pie.
  const [historiaAbierta, setHistoriaAbierta] = useState(false);

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
            {/* clinica-6 · AL SANITARIO se le da LA HISTORIA, que ya
                lleva la valoración dentro (en Documentos). A quien no
                lleva la marca sanitaria se le sigue dando la pestaña de
                la valoración, y por la razón de clinica-2: la
                recepcionista usa ahí los dos botones que SÍ puede usar
                (mandar el test, abrir la tablet) sin pedir una sola
                respuesta — y por tanto sin dejar una línea DENIED en el
                registro cada vez que toca la pestaña. La historia viva
                pide SANITARIO en la API, así que ofrecérsela sería
                ofrecerle un 403 con su línea. */}
            {clinicaEncendida &&
              (esSanitario ? (
                // clinica-8 · abre el OVERLAY, no una pestaña del cajón.
                // `active` se queda en `false` a propósito: la pestaña no
                // es un sitio en el que quedarse, es una puerta.
                <TabButton
                  active={historiaAbierta}
                  onClick={() => setHistoriaAbierta(true)}
                >
                  Historia
                </TabButton>
              ) : (
                <TabButton
                  active={tab === "valoracion"}
                  onClick={() => setTab("valoracion")}
                >
                  Valoración
                </TabButton>
              ))}
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
          {tab === "valoracion" && clinicaEncendida && esSanitario && (
            // Al sanitario la pestaña «Valoración» ya no existe: llega
            // aquí desde Documentos, así que lo que necesita es la vuelta.
            <button
              type="button"
              onClick={() => setHistoriaAbierta(true)}
              className="min-h-touch px-4 mb-3 rounded-2xl bg-white border border-slate-200 text-[14px] font-medium"
            >
              ← Volver a la historia
            </button>
          )}
          {tab === "valoracion" && clinicaEncendida && (
            <ValoracionSanitario
              clientId={clientId}
              // La recepcionista abre la pestaña y ve los dos botones que
              // SÍ puede usar (mandar el test, abrir la tablet), sin pedir
              // las respuestas. Así no se le deja una línea DENIED en el
              // registro por cada vez que toca la pestaña, que es ruido
              // justo en la lista de «quién ha abierto esta historia».
              puedeLeer={esSanitario}
            />
          )}
        </>
      )}
      {/* clinica-8 · LA HISTORIA, A PANTALLA COMPLETA. Mismo overlay que
          desde la cita (clinica-6), con portal a `document.body`: el
          cajón de la ficha es un `fixed` con z-index propio, y una hoja
          que pidiera estar encima desde dentro sólo subiría dentro de ese
          peldaño — es la trampa que clinica-3 pagó con la barra de cobro
          (§7.1 de su done). */}
      {historiaAbierta &&
        clinicaEncendida &&
        esSanitario &&
        typeof document !== "undefined" &&
        createPortal(
          <div className="fixed inset-0 z-[70] bg-mipiace-stone flex flex-col font-sans">
            <div className="flex items-center gap-3 px-4 md:px-6 h-16 bg-white border-b border-slate-200 shrink-0">
              <button
                onClick={() => setHistoriaAbierta(false)}
                className="h-11 w-11 rounded-2xl hover:bg-slate-100 flex items-center justify-center text-mipiace-ink"
                aria-label="Volver a la ficha"
              >
                <ArrowLeft className="w-5 h-5" strokeWidth={2.25} />
              </button>
              <h1 className="text-[18px] font-semibold text-mipiace-ink flex-1">
                Historia
                {detail ? ` · ${clientFullName(detail.client)}` : ""}
              </h1>
            </div>
            <div
              data-test="historia-pantalla-completa"
              className="flex-1 overflow-y-auto px-4 md:px-6 py-4"
            >
              <div className="max-w-[1180px] mx-auto">
                <HistoriaViva
                  clientId={clientId}
                  // Sin `onEmpezarVisita`: desde la ficha de un cliente no
                  // hay CITA, y una sesión clínica cuelga de una cita desde
                  // clinica-3 (§8.6). La tarjeta de «Hoy toca» se ve igual
                  // —que es lo que hace falta saber— y dice dónde se
                  // empieza, en vez de ofrecer un botón que no puede
                  // cumplir.
                  onAbrirValoracion={() => {
                    setHistoriaAbierta(false);
                    setTab("valoracion");
                  }}
                />
              </div>
            </div>
          </div>,
          document.body,
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

/**
 * clinica-8 · el estado de una cita, en la palabra del mostrador.
 *
 * `CONFIRMED` no lleva etiqueta a propósito: es el estado de casi todas y
 * escribirlo en cada línea sería ruido. Lo que hay que poder leer de un
 * vistazo es lo que NO es normal — y sobre todo «Cancelada», que es el
 * único estado en el que la cita no está en la agenda.
 *
 * El diccionario es el mismo de `lib/agenda.ts::STATUS_LABEL`; aquí se
 * escribe aparte porque esta pantalla no importa la agenda y porque lo que
 * se quiere es justamente dejar fuera la etiqueta de «Confirmada».
 */
const ESTADO_DE_LA_CITA: Record<string, string> = {
  PENDING: "pendiente",
  IN_SERVICE: "en sala",
  COMPLETED: "hecha",
  NO_SHOW: "no vino",
  CANCELLED: "cancelada",
};

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
        Sin compras ni citas registradas. Los bonos aparecerán aquí cuando
        estén disponibles.
      </Empty>
    );
  // El historial trae DOS clases de línea (`crm/routes.ts` las une desde
  // B-reservas-4): compras y citas. Pintarlas todas como compras leía
  // `e.total` en una cita, que no lo tiene, y tiraba la ficha entera a la
  // pantalla del ErrorBoundary. Ver la nota del tipo en `lib/clients.ts`.
  return (
    <ul className="space-y-2">
      {data.entries.map((e) => (
        <li
          key={e.id}
          className="bg-white rounded-xl border border-slate-200 p-3 flex items-center gap-3"
        >
          {e.kind === "PURCHASE" ? (
            <TicketIcon
              className="w-4 h-4 text-slate-400 shrink-0"
              strokeWidth={2.25}
            />
          ) : (
            <CalendarClock
              className="w-4 h-4 text-slate-400 shrink-0"
              strokeWidth={2.25}
            />
          )}
          <div className="flex-1 min-w-0">
            <div className="text-[13.5px] font-medium text-mipiace-ink">
              {e.kind === "PURCHASE"
                ? `Ticket ${e.holdedDocNumber ?? e.internalNumber}`
                : // clinica-8 · EL ESTADO SE DICE. Hasta este bloque toda
                  // cita se pintaba «Cita» a secas, también una cancelada —
                  // y una cancelada no sale en la agenda. Así que el
                  // historial era el único sitio donde aparecía, y aparecía
                  // como si estuviera viva: en la auditoría del 18-10 fue
                  // justo eso lo que hizo pensar que la agenda «había
                  // perdido» una cita que en realidad estaba cancelada.
                  `Cita${
                    ESTADO_DE_LA_CITA[e.status]
                      ? ` · ${ESTADO_DE_LA_CITA[e.status]}`
                      : ""
                  }`}
            </div>
            <div className="text-[12px] text-slate-500">
              {new Date(e.at).toLocaleDateString("es-ES", {
                day: "2-digit",
                month: "short",
                year: "numeric",
              })}
              {e.kind === "APPOINTMENT" &&
                ` · ${new Date(e.at).toLocaleTimeString("es-ES", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}`}
            </div>
          </div>
          <div className="text-[14px] font-semibold text-mipiace-ink">
            {e.kind === "PURCHASE"
              ? e.total.toLocaleString("es-ES", {
                  style: "currency",
                  currency: "EUR",
                })
              : null}
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

// ─── B-reservas-8 · los BONOS de la ficha ────────────────────────────
//
// Lo que esta pestaña tiene que contestar, en este orden:
//
//   1. **¿Cuántas sesiones le quedan?** Con la frase que hace el servidor
//      («quedan 3 · 1 apartada») y no una que calcule el navegador: dos
//      terminales no pueden enseñar dos saldos del mismo bono.
//   2. **¿Hasta cuándo?** El último día bueno, sin hora: «caduca el 28 de
//      febrero» incluye el 28 entero.
//   3. **LA TRAZA.** Qué cita apartó, qué ticket consumió, quién corrigió y
//      por qué. Es lo que recepción necesita cuando una clienta dice «yo
//      tenía cinco».
//
// Y los de PRUEBA, detrás de un filtro y nunca mezclados (`07` pieza 17).

function VouchersTab({ clientId }: { clientId: string }) {
  const [data, setData] = useState<BonosDeLaFicha | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [verPruebas, setVerPruebas] = useState(false);
  const [abierto, setAbierto] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    getBonosDeLaFicha(clientId)
      .then((d) => !cancelled && setData(d))
      .catch(() => {
        if (cancelled) return;
        // El contrato de esta ruta es estable desde B-reservas-1: con el
        // módulo apagado contesta saldo cero y lista vacía, así que un
        // error aquí es de verdad (sin red, o 500) y se dice.
        setError("No se pudieron cargar los bonos. Vuelve a intentarlo.");
      });
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  if (error) {
    return <Empty>{error}</Empty>;
  }
  if (!data) return <TabLoading />;

  const dePrueba = data.vouchers.filter((b) => b.esPrueba);
  const reales = data.vouchers.filter((b) => !b.esPrueba);
  const lista = verPruebas ? [...reales, ...dePrueba] : reales;

  if (reales.length === 0 && dePrueba.length === 0) {
    return (
      <Empty>
        <ReceiptText className="w-5 h-5 mx-auto mb-2 text-slate-300" strokeWidth={2} />
        Esta ficha no tiene bonos. Aparecerán aquí al venderle uno en caja o
        al darlo de alta a mano si venía en papel.
      </Empty>
    );
  }

  return (
    <div className="space-y-3">
      {/* El saldo agregado, que es lo primero que se mira. No cuenta los
          de prueba ni los muertos: lo decide el servidor. */}
      <div className="bg-white rounded-xl border border-slate-200 px-4 py-3 flex items-baseline gap-2">
        <span className="text-[22px] font-semibold text-slate-900 tabular-nums">
          {data.balance.sessionsLeft}
        </span>
        <span className="text-[13px] text-slate-500">
          {data.balance.sessionsLeft === 1
            ? "sesión libre en total"
            : "sesiones libres en total"}
        </span>
      </div>

      {lista.map((b) => (
        <TarjetaDeBono
          key={b.id}
          bono={b}
          abierto={abierto === b.id}
          onToggle={() => setAbierto(abierto === b.id ? null : b.id)}
        />
      ))}

      {dePrueba.length > 0 && (
        <button
          onClick={() => setVerPruebas(!verPruebas)}
          className="w-full h-9 rounded-xl border border-dashed border-slate-200 text-[12px] text-slate-500 hover:text-slate-700"
        >
          {verPruebas ? "Ocultar" : "Ver"} {dePrueba.length}{" "}
          {dePrueba.length === 1 ? "bono de prueba" : "bonos de prueba"}
        </button>
      )}
    </div>
  );
}

function TarjetaDeBono({
  bono,
  abierto,
  onToggle,
}: {
  bono: BonoDeLaFicha;
  abierto: boolean;
  onToggle: () => void;
}) {
  const [detalle, setDetalle] = useState<DetalleDeBono | null>(null);
  useEffect(() => {
    if (!abierto || detalle) return;
    let cancelled = false;
    getDetalleDeBono(bono.id)
      .then((d) => !cancelled && setDetalle(d))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [abierto, bono.id, detalle]);

  const muerto = bono.status === "ANULADO" || bono.status === "CADUCADO";
  const caduca = diaCorto(bono.caducaEl);
  return (
    <div
      className={`bg-white rounded-xl border p-4 ${
        muerto ? "border-slate-200 opacity-70" : "border-slate-200"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-[14px] text-slate-900 truncate">
              {bono.nombre}
            </span>
            <span className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">
              {bono.code}
            </span>
            {bono.esPrueba && (
              <span className="text-[11px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200">
                prueba
              </span>
            )}
            {muerto && (
              <span className="text-[11px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">
                {bono.status === "ANULADO" ? "anulado" : "caducado"}
              </span>
            )}
          </div>
          {/* La frase del servidor, tal cual. */}
          <div className="text-[13px] text-slate-700 mt-1">{bono.resumen}</div>
          <div className="text-[12px] text-slate-500 mt-0.5">
            {sesiones(bono.sesionesConsumidas)} usadas de{" "}
            {sesiones(bono.sesionesTotal)}
            {caduca ? ` · caduca el ${caduca}` : " · sin caducidad"}
            {bono.origen === "ALTA_INICIAL" ? " · venía en papel" : ""}
          </div>
          {/* Los euros sólo si la API los mandó: al sanitario sin caja NO
              se le mandan, así que aquí simplemente no están. */}
          {bono.valorCartaCents != null && (
            <div className="text-[12px] text-slate-500 mt-0.5">
              vale {formatEur(bono.valorCartaCents / 100)}
              {bono.cobradoCents != null
                ? ` · se cobraron ${formatEur(bono.cobradoCents / 100)}`
                : ""}
            </div>
          )}
        </div>
        <button
          onClick={onToggle}
          className="shrink-0 h-8 px-3 rounded-lg border border-slate-200 text-[12px] text-slate-600 hover:bg-slate-50"
        >
          {abierto ? "Ocultar" : "Ver qué pasó"}
        </button>
      </div>

      {abierto && (
        <div className="mt-3 pt-3 border-t border-slate-100">
          {!detalle ? (
            <TabLoading />
          ) : (
            <>
              {/* El «por qué no se puede devolver», con la MISMA frase que
                  el servidor: ningún botón gris mudo. */}
              {detalle.noDevolvible && (
                <div className="mb-3 text-[12px] text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                  {detalle.noDevolvible.mensaje}
                </div>
              )}
              <ol className="space-y-2">
                {detalle.traza.map((l) => (
                  <li key={l.id} className="text-[12px] leading-snug">
                    <div className="flex items-baseline gap-2">
                      <span className="font-mono text-[11px] text-slate-400 shrink-0">
                        {new Date(l.cuando).toLocaleDateString("es-ES", {
                          day: "2-digit",
                          month: "2-digit",
                          year: "2-digit",
                        })}
                      </span>
                      <span className="text-slate-700">{l.detalle}</span>
                    </div>
                    <div className="text-[11px] text-slate-400 pl-[52px]">
                      {l.quien}
                      {l.motivo ? ` · motivo: ${l.motivo}` : ""}
                      {l.canal !== "tpv" ? ` · ${l.canal}` : ""}
                    </div>
                  </li>
                ))}
              </ol>
            </>
          )}
        </div>
      )}
    </div>
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
