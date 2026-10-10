// B-reservas-2 · Catálogo de servicios extendido — panel de edición.
//
// El propietario añade a cada servicio (espejo de Holded, kind=SERVICE)
// los datos que la agenda necesita y Holded no modela: duración, pausas,
// nº de profesionales, familia y flags de canal (Caja/Ticket/Agenda/
// Online). También gestiona los recursos (cabinas/salas/aparatos) y qué
// tipos de recurso necesita cada servicio.
//
// ADR-R1: es una capa de EXTENSIÓN local sobre el producto de Holded, NO
// una tabla de servicios paralela. Precio/IVA vienen de Holded y aquí NO
// se tocan (se muestran informativos). Un servicio sin duración guardada
// no es reservable: la agenda (B4) lo ignora.
//
// Gate por capability (ADR-R6): si el tenant no tiene `agendaEnabled`, el
// panel muestra un aviso y no ofrece edición. La entrada del sidebar
// también se oculta (AdminShell).

import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Trash2 } from "lucide-react";

import { AdminShell } from "../AdminShell.js";
import {
  api,
  ApiError,
  clearTokens,
  readEffectiveAuth,
  readonlyReasonLabel,
} from "../api.js";
import {
  CenteredLoader,
  FieldError,
  OutlineButton,
  PrimaryButton,
  SuccessBanner,
  TextField,
} from "../ui.js";

type ResourceKind = "CABIN" | "ROOM" | "DEVICE";

// clinica-5 · los cinco tipos de visita y los tres niveles de quiropodia,
// con sus nombres.
//
// **Duplicados aquí a propósito**, y por la misma razón que `TAX_RATES` y
// la etiqueta de la exención en `CatalogoPage`: `apps/admin` NO depende de
// ningún paquete del monorepo, y sacar cinco códigos y tres nombres a uno
// nuevo pesa más que la duplicación.
//
// La fuente de verdad es `TIPOS_DE_VISITA` / `NOMBRE_DE_NIVEL` en
// `@mipiacetpv/clinica-sesion`, y lo que no se puede es que las dos copias
// se separen: una es lo que la dueña ELIGE y la otra lo que la sesión
// ABRE. Desde el banco del admin no se puede comparar (no ve el paquete),
// así que lo comprueba `apps/api/test/clinica-tipos-panel.test.ts`
// leyendo esta fuente — la misma mecánica con la que los bancos de
// migración leen el SQL.
type TipoDeVisita =
  | "QUIROPODIA"
  | "PIE_RIESGO"
  | "CIRUGIA"
  | "BIOMECANICA"
  | "GENERAL";

const TIPOS_DE_VISITA: TipoDeVisita[] = [
  "QUIROPODIA",
  "PIE_RIESGO",
  "CIRUGIA",
  "BIOMECANICA",
  "GENERAL",
];

const NOMBRE_DE_TIPO_DE_VISITA: Record<TipoDeVisita, string> = {
  QUIROPODIA: "Quiropodia",
  PIE_RIESGO: "Pie de riesgo",
  CIRUGIA: "Cirugía · revisión",
  BIOMECANICA: "Biomecánica",
  GENERAL: "General",
};

type NivelDeQuiropodia = 1 | 2 | 3;

const NIVELES_DE_QUIROPODIA: NivelDeQuiropodia[] = [1, 2, 3];

const NOMBRE_DE_NIVEL: Record<NivelDeQuiropodia, string> = {
  1: "Básica",
  2: "Completa",
  3: "Extra",
};

// clinica-4 · LOS CONSENTIMIENTOS QUE SE PUEDEN ATAR A UN SERVICIO.
//
// Duplicados aquí por lo mismo que los tipos de arriba, y atados a la
// fuente de verdad (`PLANTILLAS_DE_SERVICIO` de
// `@mipiacetpv/consentimientos`) por `apps/api/test/clinica-tipos-panel.test.ts`,
// que lee esta fuente.
//
// **«Fotos clínicas» NO está en esta lista y no es un olvido**: no se ata
// a ningún servicio — la pide la primera foto del paciente, en la visita
// que sea (decisión 4). La ruta lo rechaza con un 409 si alguien lo manda.
type ConsentimientoId = "cirugia-ungueal" | "anestesia-local";

const CONSENTIMIENTOS_DE_SERVICIO: ConsentimientoId[] = [
  "cirugia-ungueal",
  "anestesia-local",
];

const NOMBRE_DE_CONSENTIMIENTO: Record<ConsentimientoId, string> = {
  "cirugia-ungueal": "Consentimiento para cirugía de uña (matricectomía)",
  "anestesia-local": "Consentimiento para anestesia local",
};

const RESOURCE_KINDS: ResourceKind[] = ["CABIN", "ROOM", "DEVICE"];

const RESOURCE_KIND_LABEL: Record<ResourceKind, string> = {
  CABIN: "Cabina",
  ROOM: "Sala / Box",
  DEVICE: "Aparato",
};

interface Channels {
  caja: boolean;
  ticket: boolean;
  agenda: boolean;
  online: boolean;
}

interface Scheduling {
  durationMin: number;
  bufferBeforeMin: number;
  bufferAfterMin: number;
  staffRequired: number;
  onlineBookable: boolean;
  family: string | null;
  channels: Channels;
  // clinica-2 · «este servicio es la primera valoración». Dar una cita de
  // un servicio marcado así a un paciente sin valoración le manda el test
  // del cuestionario de crónicas.
  primeraValoracion: boolean;
  tratamientoSesion: boolean;
  // clinica-5 · «este servicio ES el nivel N de la quiropodia» (1 básica,
  // 2 completa, 3 extra). `null` = ninguno, que es lo normal.
  nivelQuiropodia: number | null;
  // clinica-4 · qué consentimientos pide este servicio. Una cita suya no
  // se puede cerrar sin ellos firmados y vigentes.
  consentimientos: string[];
  updatedAt: string;
}

interface ServiceRow {
  productId: string;
  holdedProductId: string;
  name: string;
  sku: string | null;
  basePrice: number;
  taxRate: number;
  active: boolean;
  scheduling: Scheduling | null;
  // clinica-5 · el tipo de visita que HEREDA de sus categorías (S5). De
  // sólo lectura aquí: se edita en el mapa de categorías de abajo.
  tipoDeVisita: TipoDeVisita | null;
  /** El motivo por el que no tiene tipo, cuando es que dos categorías se
   *  pelean. `null` si simplemente no tiene ninguna con tipo. */
  tipoDeVisitaMotivo: string | null;
}

interface ResourceRow {
  id: string;
  name: string;
  kind: ResourceKind;
}

interface ResourceNeed {
  resourceKind: ResourceKind;
  qty: number;
}

const DEFAULT_CHANNELS: Channels = {
  caja: true,
  ticket: true,
  agenda: true,
  online: false,
};

function blankScheduling(): Scheduling {
  return {
    durationMin: 30,
    bufferBeforeMin: 0,
    bufferAfterMin: 0,
    staffRequired: 1,
    onlineBookable: false,
    family: null,
    channels: { ...DEFAULT_CHANNELS },
    primeraValoracion: false,
    tratamientoSesion: false,
    nivelQuiropodia: null,
    consentimientos: [],
    updatedAt: "",
  };
}

export function AgendaCatalogPage() {
  const navigate = useNavigate();
  const [agendaEnabled, setAgendaEnabled] = useState<boolean | null>(null);
  // clinica-2 · sale del MISMO `GET /admin/tenant/settings` que la pantalla
  // ya pedía, así que no hay una petición más.
  const [clinicaEnabled, setClinicaEnabled] = useState(false);
  const [services, setServices] = useState<ServiceRow[] | null>(null);
  const [resources, setResources] = useState<ResourceRow[] | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const effective = readEffectiveAuth();
  const canEdit = effective.canEdit;
  const readonlyTip = readonlyReasonLabel(effective.readonlyReason);

  function handleAuthError(err: unknown) {
    if (err instanceof ApiError && err.status === 401) {
      clearTokens();
      navigate("/login", { replace: true });
    } else if (err instanceof ApiError) {
      setError(err.message);
    } else {
      setError("Error inesperado");
    }
  }

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const settings = await api<{
          settings: {
            agendaEnabled: boolean;
            clinicalRecordsEnabled?: boolean;
          };
        }>("/admin/tenant/settings");
        if (cancelled) return;
        setAgendaEnabled(settings.settings.agendaEnabled);
        setClinicaEnabled(settings.settings.clinicalRecordsEnabled === true);
        if (!settings.settings.agendaEnabled) return;
        const [svc, res] = await Promise.all([
          api<{ items: ServiceRow[] }>("/services/scheduling"),
          api<{ resources: ResourceRow[] }>("/resources"),
        ]);
        if (cancelled) return;
        setServices(svc.items);
        setResources(res.resources);
      } catch (err) {
        if (!cancelled) handleAuthError(err);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigate]);

  /** clinica-5 · al cambiar el mapa de categorías, el tipo HEREDADO de
   *  cada servicio cambia. Se vuelve a pedir la lista en vez de
   *  recalcularlo en el navegador: quien sabe cruzar etiquetas con la
   *  tabla es el servidor, y recalcularlo aquí habría sido la segunda
   *  implementación de la regla de S5. */
  const recargarServicios = useCallback(async () => {
    try {
      const svc = await api<{ items: ServiceRow[] }>("/services/scheduling");
      setServices(svc.items);
    } catch (err) {
      handleAuthError(err);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filteredServices = useMemo(() => {
    if (!services) return [];
    const n = query.trim().toLowerCase();
    if (n.length === 0) return services;
    return services.filter(
      (s) =>
        s.name.toLowerCase().includes(n) ||
        (s.sku ?? "").toLowerCase().includes(n),
    );
  }, [services, query]);

  function onSchedulingSaved(productId: string, scheduling: Scheduling) {
    setServices((curr) =>
      (curr ?? []).map((s) =>
        s.productId === productId ? { ...s, scheduling } : s,
      ),
    );
    setSuccess("Servicio guardado.");
  }

  if (agendaEnabled === null) {
    return <CenteredLoader label="Cargando catálogo de agenda…" />;
  }

  if (!agendaEnabled) {
    return (
      <AdminShell title="Agenda · Catálogo">
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-6 text-[14px] text-amber-900">
          La agenda no está activada para este negocio. Cuando se active la
          capability <strong>agenda</strong>, aquí podrás configurar la
          duración, las pausas y los recursos de cada servicio.
        </div>
      </AdminShell>
    );
  }

  return (
    <AdminShell title="Agenda · Catálogo">
      <p className="text-[13.5px] text-slate-500 mb-5 -mt-2">
        Añade a cada servicio los datos que la agenda necesita: duración,
        pausas, nº de profesionales, familia y en qué canales se ofrece. El
        precio y el IVA vienen de Holded y no se editan aquí.
        {!canEdit && readonlyTip && " " + readonlyTip + "."}
      </p>

      {success && <SuccessBanner message={success} />}
      {error && <FieldError message={error} />}

      <ResourcesSection
        resources={resources}
        canEdit={canEdit}
        onChange={setResources}
        onError={setError}
        onSuccess={setSuccess}
      />

      {/* clinica-5 · el mapa `categoría → tipo de visita` (S5). Va EN ESTA
          PANTALLA y no en una sección propia de la barra lateral por la
          misma razón que las dos casillas clínicas del servicio: la
          podóloga mantiene UNA pantalla y no dos, y lo que configura aquí
          es justo lo que va a ver al abrir cada servicio de abajo. */}
      {clinicaEnabled && (
        <TiposDeVisitaSection
          canEdit={canEdit}
          onError={setError}
          onSuccess={setSuccess}
          onCambio={() => void recargarServicios()}
        />
      )}

      <section className="bg-white rounded-2xl border border-slate-200 p-6 md:p-7 mb-5">
        <div className="flex items-baseline justify-between mb-4">
          <h2 className="text-[17px] font-semibold text-mipiace-ink tracking-tight">
            Servicios
          </h2>
          <span className="text-[12.5px] text-slate-400 tabular-nums">
            {services?.length ?? 0} servicio{(services?.length ?? 0) === 1 ? "" : "s"}
          </span>
        </div>

        {services === null ? (
          <CenteredLoader label="Cargando servicios…" />
        ) : services.length === 0 ? (
          <p className="text-[13.5px] text-slate-500">
            No hay servicios en el catálogo. Los servicios se crean en Holded
            (productos de tipo servicio); aquí sólo se les añade la duración y
            los datos de agenda.
          </p>
        ) : (
          <>
            <div className="mb-4 max-w-sm">
              <TextField
                id="service-search"
                label="Buscar servicio"
                value={query}
                onChange={setQuery}
                placeholder="Nombre o SKU…"
              />
            </div>
            <div className="space-y-3">
              {filteredServices.map((s) => (
                <ServiceCard
                  key={s.productId}
                  service={s}
                  resources={resources ?? []}
                  canEdit={canEdit}
                  clinicaEnabled={clinicaEnabled}
                  onSaved={onSchedulingSaved}
                  onError={setError}
                  onSuccess={setSuccess}
                />
              ))}
              {filteredServices.length === 0 && (
                <p className="text-[13px] text-slate-400">
                  Ningún servicio coincide con «{query}».
                </p>
              )}
            </div>
          </>
        )}
      </section>
    </AdminShell>
  );
}

// ── Recursos (CRUD) ────────────────────────────────────────────────────
function ResourcesSection({
  resources,
  canEdit,
  onChange,
  onError,
  onSuccess,
}: {
  resources: ResourceRow[] | null;
  canEdit: boolean;
  onChange: (next: ResourceRow[]) => void;
  onError: (msg: string | null) => void;
  onSuccess: (msg: string | null) => void;
}) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<ResourceKind>("CABIN");
  const [busy, setBusy] = useState(false);

  async function onAdd(e: React.FormEvent) {
    e.preventDefault();
    onError(null);
    onSuccess(null);
    if (name.trim().length === 0) return;
    setBusy(true);
    try {
      const res = await api<{ resource: ResourceRow }>("/resources", {
        method: "POST",
        body: { name: name.trim(), kind },
      });
      onChange([...(resources ?? []), res.resource]);
      setName("");
      onSuccess("Recurso creado.");
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "Error inesperado");
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(id: string) {
    if (!window.confirm("¿Eliminar este recurso?")) return;
    onError(null);
    onSuccess(null);
    try {
      await api(`/resources/${id}`, { method: "DELETE" });
      onChange((resources ?? []).filter((r) => r.id !== id));
      onSuccess("Recurso eliminado.");
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "Error inesperado");
    }
  }

  return (
    <section className="bg-white rounded-2xl border border-slate-200 p-6 md:p-7 mb-5">
      <h2 className="text-[17px] font-semibold text-mipiace-ink tracking-tight mb-1">
        Recursos
      </h2>
      <p className="text-[13px] text-slate-500 mb-4">
        Cabinas, salas/boxes y aparatos que un servicio puede necesitar. La
        agenda no reservará un servicio si no hay un recurso libre del tipo
        que requiere.
      </p>

      {canEdit && (
        <form onSubmit={onAdd} className="grid sm:grid-cols-[1fr_auto_auto] gap-3 items-end mb-5">
          <TextField
            id="resource-name"
            label="Nombre"
            value={name}
            onChange={setName}
            placeholder="Cabina 1"
            required
          />
          <div>
            <label
              htmlFor="resource-kind"
              className="block text-[13px] font-medium text-mipiace-ink mb-1.5"
            >
              Tipo
            </label>
            <select
              id="resource-kind"
              value={kind}
              onChange={(e) => setKind(e.target.value as ResourceKind)}
              className="h-11 rounded-xl border border-slate-300 px-3 text-[14px] text-mipiace-ink focus:ring-2 focus:ring-mipiace-coral/30 focus:border-mipiace-coral"
            >
              {RESOURCE_KINDS.map((k) => (
                <option key={k} value={k}>
                  {RESOURCE_KIND_LABEL[k]}
                </option>
              ))}
            </select>
          </div>
          <PrimaryButton type="submit" busy={busy}>
            <Plus className="w-3.5 h-3.5" />
            Añadir
          </PrimaryButton>
        </form>
      )}

      {resources === null ? (
        <p className="text-[13px] text-slate-400">Cargando…</p>
      ) : resources.length === 0 ? (
        <p className="text-[13px] text-slate-400">Aún no hay recursos.</p>
      ) : (
        <div className="space-y-2">
          {resources.map((r) => (
            <div
              key={r.id}
              className="flex items-center gap-3 p-3.5 rounded-xl bg-mipiace-stone"
            >
              <div className="min-w-0 flex-1">
                <div className="text-[12px] uppercase tracking-wider text-slate-400 font-medium">
                  {RESOURCE_KIND_LABEL[r.kind]}
                </div>
                <div className="text-[14.5px] font-medium text-mipiace-ink truncate">
                  {r.name}
                </div>
              </div>
              {canEdit && (
                <OutlineButton
                  onClick={() => onDelete(r.id)}
                  className="!h-9 !text-[12.5px] !text-red-600 !border-red-200 hover:!bg-red-50"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Quitar
                </OutlineButton>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ── Tarjeta de servicio (scheduling + necesidades de recurso) ───────────
function ServiceCard({
  service,
  resources,
  canEdit,
  clinicaEnabled,
  onSaved,
  onError,
  onSuccess,
}: {
  service: ServiceRow;
  resources: ResourceRow[];
  canEdit: boolean;
  /** clinica-2 · con la historia clínica apagada, la casilla de «primera
   *  valoración» no se enseña. Ver la nota junto a la casilla. */
  clinicaEnabled: boolean;
  onSaved: (productId: string, scheduling: Scheduling) => void;
  onError: (msg: string | null) => void;
  onSuccess: (msg: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Scheduling>(
    service.scheduling ?? blankScheduling(),
  );
  const [needs, setNeeds] = useState<ResourceNeed[] | null>(null);
  const [busy, setBusy] = useState(false);

  const hasScheduling = service.scheduling !== null;

  async function toggleOpen() {
    const next = !open;
    setOpen(next);
    if (next && needs === null) {
      try {
        const res = await api<{ needs: ResourceNeed[] }>(
          `/services/${service.productId}/resource-needs`,
        );
        setNeeds(res.needs);
      } catch (err) {
        onError(err instanceof ApiError ? err.message : "Error inesperado");
        setNeeds([]);
      }
    }
  }

  function setChannel(key: keyof Channels, value: boolean) {
    setForm((f) => {
      const channels = { ...f.channels, [key]: value };
      // El canal online va de la mano de `onlineBookable`.
      const onlineBookable = key === "online" ? value : f.onlineBookable;
      if (!onlineBookable) channels.online = false;
      return { ...f, channels, onlineBookable };
    });
  }

  async function onSave() {
    setBusy(true);
    onError(null);
    onSuccess(null);
    try {
      const res = await api<{ scheduling: Scheduling }>(
        `/services/${service.productId}/scheduling`,
        {
          method: "PUT",
          body: {
            durationMin: form.durationMin,
            bufferBeforeMin: form.bufferBeforeMin,
            bufferAfterMin: form.bufferAfterMin,
            staffRequired: form.staffRequired,
            onlineBookable: form.channels.online,
            primeraValoracion: form.primeraValoracion,
            tratamientoSesion: form.tratamientoSesion,
            nivelQuiropodia: form.nivelQuiropodia,
            consentimientos: form.consentimientos,
            family: form.family?.trim() || null,
            channels: form.channels,
          },
        },
      );
      setForm(res.scheduling);
      onSaved(service.productId, res.scheduling);
      // Guardar las necesidades de recurso en el mismo gesto.
      if (needs !== null) {
        await api(`/services/${service.productId}/resource-needs`, {
          method: "PUT",
          body: { needs: needs.map((n) => ({ resourceKind: n.resourceKind, qty: n.qty })) },
        });
      }
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "Error inesperado");
    } finally {
      setBusy(false);
    }
  }

  function toggleNeed(kind: ResourceKind, checked: boolean) {
    setNeeds((curr) => {
      const list = curr ?? [];
      if (checked) {
        if (list.some((n) => n.resourceKind === kind)) return list;
        return [...list, { resourceKind: kind, qty: 1 }];
      }
      return list.filter((n) => n.resourceKind !== kind);
    });
  }

  function setNeedQty(kind: ResourceKind, qty: number) {
    setNeeds((curr) =>
      (curr ?? []).map((n) => (n.resourceKind === kind ? { ...n, qty } : n)),
    );
  }

  // Tipos de recurso que existen en el negocio (para no ofrecer necesidades
  // de un tipo que no tiene ningún recurso dado de alta).
  const availableKinds = useMemo(() => {
    const set = new Set<ResourceKind>();
    for (const r of resources) set.add(r.kind);
    return set;
  }, [resources]);

  return (
    <div className="rounded-xl border border-slate-200">
      <button
        type="button"
        onClick={toggleOpen}
        className="w-full flex items-center gap-3 px-4 py-3 text-left"
      >
        <div className="min-w-0 flex-1">
          <div className="text-[14.5px] font-medium text-mipiace-ink truncate">
            {service.name}
          </div>
          <div className="text-[12.5px] text-slate-400 tabular-nums">
            {hasScheduling ? (
              <>
                {service.scheduling!.durationMin} min
                {service.scheduling!.onlineBookable ? " · reservable online" : ""}
              </>
            ) : (
              <span className="text-amber-600">Sin datos de agenda</span>
            )}
          </div>
        </div>
        <span className="text-[12px] text-slate-400">{open ? "Cerrar" : "Editar"}</span>
      </button>

      {open && (
        <div className="border-t border-slate-100 px-4 py-4 space-y-4">
          <div className="grid sm:grid-cols-2 gap-4">
            <NumberField
              id={`dur-${service.productId}`}
              label="Duración (min)"
              value={form.durationMin}
              min={1}
              max={1440}
              disabled={!canEdit}
              onChange={(v) => setForm({ ...form, durationMin: v })}
            />
            <NumberField
              id={`staff-${service.productId}`}
              label="Profesionales"
              value={form.staffRequired}
              min={1}
              max={12}
              disabled={!canEdit}
              onChange={(v) => setForm({ ...form, staffRequired: v })}
            />
            <NumberField
              id={`bb-${service.productId}`}
              label="Pausa antes (min)"
              value={form.bufferBeforeMin}
              min={0}
              max={480}
              disabled={!canEdit}
              onChange={(v) => setForm({ ...form, bufferBeforeMin: v })}
            />
            <NumberField
              id={`ba-${service.productId}`}
              label="Pausa después (min)"
              value={form.bufferAfterMin}
              min={0}
              max={480}
              disabled={!canEdit}
              onChange={(v) => setForm({ ...form, bufferAfterMin: v })}
            />
          </div>

          <TextField
            id={`family-${service.productId}`}
            label="Familia (opcional)"
            value={form.family ?? ""}
            onChange={(v) => setForm({ ...form, family: v || null })}
            placeholder="Faciales, Corte…"
          />

          <div>
            <div className="text-[13px] font-medium text-mipiace-ink mb-2">
              Canales
            </div>
            <div className="flex flex-wrap gap-4">
              {(["caja", "ticket", "agenda", "online"] as (keyof Channels)[]).map(
                (ch) => (
                  <label
                    key={ch}
                    className="flex items-center gap-2 text-[13.5px] text-mipiace-ink capitalize"
                  >
                    <input
                      type="checkbox"
                      checked={form.channels[ch]}
                      disabled={!canEdit}
                      onChange={(e) => setChannel(ch, e.target.checked)}
                      className="h-4 w-4 rounded border-slate-300 text-mipiace-coral focus:ring-mipiace-coral/30 disabled:opacity-50"
                    />
                    {ch}
                  </label>
                ),
              )}
            </div>
            <p className="text-[12px] text-slate-400 mt-1.5">
              «Online» equivale a ofrecer el servicio en la reserva online
              (contrato para B4/B6).
            </p>
          </div>

          {/* clinica-2 · la marca que convierte «dar la cita» en «el
              paciente recibe el test». Sólo se enseña con la historia
              clínica encendida: en una peluquería no significa nada, y una
              casilla que habla de valoraciones clínicas le cuenta a ese
              cliente que el sistema guarda datos de salud de otros — la
              misma razón por la que las rutas clínicas contestan 404 y no
              403 (clinica-1 §1). */}
          {clinicaEnabled && (
            <div>
              <label className="flex items-start gap-2.5 text-[13.5px] text-mipiace-ink">
                <input
                  type="checkbox"
                  checked={form.primeraValoracion}
                  disabled={!canEdit}
                  onChange={(e) =>
                    setForm({ ...form, primeraValoracion: e.target.checked })
                  }
                  className="h-4 w-4 mt-0.5 rounded border-slate-300 text-mipiace-coral focus:ring-mipiace-coral/30 disabled:opacity-50"
                />
                <span>
                  Es la primera valoración
                  <span className="block text-[12px] text-slate-400 mt-0.5">
                    Al dar una cita de este servicio a un paciente que no
                    tiene valoración, se le manda por email el test de
                    enfermedades crónicas. También se le puede abrir en la
                    tablet de la sala.
                  </span>
                </span>
              </label>
              {/* clinica-3 · la marca hermana: qué botones salen en la
                  sesión. Va PEGADA a la de arriba y en la misma pantalla
                  porque son la misma clase de decisión («qué significa este
                  servicio para la clínica») y la podóloga las mantiene de
                  una pasada. Dos pantallas serían dos sitios a los que
                  acordarse de ir. */}
              <label className="flex items-start gap-2.5 text-[13.5px] text-mipiace-ink mt-3">
                <input
                  type="checkbox"
                  checked={form.tratamientoSesion}
                  disabled={!canEdit}
                  onChange={(e) =>
                    setForm({ ...form, tratamientoSesion: e.target.checked })
                  }
                  className="h-4 w-4 mt-0.5 rounded border-slate-300 text-mipiace-coral focus:ring-mipiace-coral/30 disabled:opacity-50"
                />
                <span>
                  Es un tratamiento de la sesión
                  <span className="block text-[12px] text-slate-400 mt-0.5">
                    Sale como botón en la pantalla de la sesión, y lo que se
                    marque pasa a caja con el precio y el IVA de este
                    servicio. Un servicio sin SKU no puede cobrarse, así que
                    tampoco sale.
                  </span>
                </span>
              </label>

              {/* clinica-5 · EL TIPO DE VISITA, heredado de las categorías
                  (S5) y de sólo lectura: se cambia en «Tipos de visita por
                  categoría», arriba. Se enseña aquí para que la dueña vea
                  qué va a pasar ANTES de marcar la casilla de arriba —
                  marcarla sin tipo no se guarda, y es mejor leerlo que
                  descubrirlo con un error. */}
              <div className="mt-3 text-[12.5px]">
                {service.tipoDeVisita ? (
                  <span className="text-slate-500">
                    Tipo de visita:{" "}
                    <b className="font-medium text-mipiace-ink">
                      {NOMBRE_DE_TIPO_DE_VISITA[service.tipoDeVisita]}
                    </b>{" "}
                    · lo hereda de su categoría
                  </span>
                ) : service.tipoDeVisitaMotivo ? (
                  <span className="text-red-700">
                    {service.tipoDeVisitaMotivo}
                  </span>
                ) : (
                  <span className="text-amber-700">
                    Sin tipo de visita: márcale una categoría arriba antes de
                    hacerlo tratamiento de la sesión.
                  </span>
                )}
              </div>

              {/* Y EL NIVEL, sólo si el servicio es de quiropodia: es lo
                  que convierte el nivel que la sesión propone en una línea
                  de ticket. Los tres niveles son tres servicios, y sólo uno
                  puede ser cada nivel (lo hace cumplir el índice único). */}
              {service.tipoDeVisita === "QUIROPODIA" && (
                <div className="mt-3">
                  <label
                    htmlFor={`nivel-${service.productId}`}
                    className="block text-[13px] font-medium text-mipiace-ink mb-1.5"
                  >
                    ¿Es uno de los tres niveles de quiropodia?
                  </label>
                  <select
                    id={`nivel-${service.productId}`}
                    value={form.nivelQuiropodia ?? ""}
                    disabled={!canEdit}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        nivelQuiropodia:
                          e.target.value === ""
                            ? null
                            : (Number(e.target.value) as NivelDeQuiropodia),
                      })
                    }
                    className="w-full max-w-xs h-11 px-3 rounded-xl border border-slate-300 bg-white text-[14px] text-mipiace-ink focus:ring-2 focus:ring-mipiace-coral/40 focus:border-mipiace-coral/30 focus:outline-none disabled:opacity-50"
                  >
                    <option value="">No es ninguno</option>
                    {NIVELES_DE_QUIROPODIA.map((n) => (
                      <option key={n} value={n}>
                        {NOMBRE_DE_NIVEL[n]}
                      </option>
                    ))}
                  </select>
                  <p className="text-[12px] text-slate-400 mt-1.5">
                    En la sesión, la podóloga toca lo que hace y el programa
                    propone el nivel; el nivel elegido cobra ESTE servicio.
                    Sólo un servicio puede ser cada nivel.
                  </p>
                </div>
              )}

              {/* clinica-4 · QUÉ CONSENTIMIENTOS PIDE ESTE SERVICIO.
                  Va aquí, pegado a las otras tres marcas y en la misma
                  pantalla, porque son la misma clase de decisión («qué
                  significa este servicio para la clínica») y la podóloga
                  las mantiene de una pasada.

                  «Fotos clínicas» no sale en la lista: no se ata a un
                  servicio, la pide la primera foto. Decirlo en la línea de
                  ayuda evita la pregunta de soporte. */}
              <div className="mt-3">
                <div className="text-[13px] font-medium text-mipiace-ink mb-1.5">
                  ¿Pide algún consentimiento firmado?
                </div>
                <div className="space-y-2">
                  {CONSENTIMIENTOS_DE_SERVICIO.map((c) => (
                    <label
                      key={c}
                      className="flex items-start gap-2.5 text-[13.5px] text-mipiace-ink"
                    >
                      <input
                        type="checkbox"
                        checked={form.consentimientos.includes(c)}
                        disabled={!canEdit}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            consentimientos: e.target.checked
                              ? [...form.consentimientos, c]
                              : form.consentimientos.filter((x) => x !== c),
                          })
                        }
                        className="h-4 w-4 mt-0.5 rounded border-slate-300 text-mipiace-coral focus:ring-mipiace-coral/30 disabled:opacity-50"
                      />
                      <span>{NOMBRE_DE_CONSENTIMIENTO[c]}</span>
                    </label>
                  ))}
                </div>
                <p className="text-[12px] text-slate-400 mt-1.5">
                  La sesión de una cita de este servicio no se puede cerrar
                  hasta que estén firmados y vigentes. Se firman en la
                  consulta, con el sanitario delante. El de fotos no se pone
                  aquí: lo pide la primera foto del paciente, en la visita
                  que sea.
                </p>
              </div>
            </div>
          )}

          <div>
            <div className="text-[13px] font-medium text-mipiace-ink mb-2">
              Recursos que necesita
            </div>
            {needs === null ? (
              <p className="text-[12.5px] text-slate-400">Cargando…</p>
            ) : availableKinds.size === 0 ? (
              <p className="text-[12.5px] text-slate-400">
                Da de alta recursos arriba para poder asignarlos.
              </p>
            ) : (
              <div className="space-y-2">
                {RESOURCE_KINDS.filter((k) => availableKinds.has(k)).map((k) => {
                  const need = needs.find((n) => n.resourceKind === k);
                  return (
                    <div key={k} className="flex items-center gap-3">
                      <label className="flex items-center gap-2 text-[13.5px] text-mipiace-ink flex-1">
                        <input
                          type="checkbox"
                          checked={need != null}
                          disabled={!canEdit}
                          onChange={(e) => toggleNeed(k, e.target.checked)}
                          className="h-4 w-4 rounded border-slate-300 text-mipiace-coral focus:ring-mipiace-coral/30 disabled:opacity-50"
                        />
                        {RESOURCE_KIND_LABEL[k]}
                      </label>
                      {need != null && (
                        <input
                          type="number"
                          min={1}
                          max={20}
                          value={need.qty}
                          disabled={!canEdit}
                          onChange={(e) =>
                            setNeedQty(k, Math.max(1, Number(e.target.value) || 1))
                          }
                          className="w-20 h-9 rounded-lg border border-slate-300 px-2 text-[13.5px] tabular-nums text-mipiace-ink"
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {canEdit && (
            <div className="flex gap-2.5 pt-1">
              <PrimaryButton type="button" onClick={onSave} busy={busy}>
                Guardar servicio
              </PrimaryButton>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function NumberField({
  id,
  label,
  value,
  min,
  max,
  onChange,
  disabled,
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  return (
    <div>
      <label
        htmlFor={id}
        className="block text-[13px] font-medium text-mipiace-ink mb-1.5"
      >
        {label}
      </label>
      <input
        id={id}
        type="number"
        min={min}
        max={max}
        value={value}
        disabled={disabled}
        onChange={(e) => {
          const raw = Number(e.target.value);
          if (Number.isNaN(raw)) return;
          onChange(Math.min(max, Math.max(min, raw)));
        }}
        className="w-full h-11 rounded-xl border border-slate-300 px-3 text-[14px] tabular-nums text-mipiace-ink focus:ring-2 focus:ring-mipiace-coral/30 focus:border-mipiace-coral disabled:opacity-50 disabled:bg-slate-50"
      />
    </div>
  );
}

// ── clinica-5 · el mapa `categoría → tipo de visita` (S5) ──────────────
//
// La dueña asigna cada categoría de su catálogo a uno de los cinco tipos
// de visita, una vez, y todos los servicios de esa categoría lo heredan.
// De ahí sale qué tarjeta abre la sesión y de qué tipo se cobra cada
// línea.
//
// Mismo editor y misma forma que `TagSectionsPage` (el mapa `tag →
// sección de cocina`), porque es el mismo patrón y la dueña reconoce la
// pantalla. La diferencia es que éste vive DENTRO del catálogo de agenda:
// lo que se configura aquí es justo lo que se ve al abrir cada servicio de
// abajo, y dos pantallas habrían sido dos sitios a los que acordarse de
// ir.

interface TipoDeCategoria {
  id: string;
  slug: string;
  visitType: TipoDeVisita;
}

function TiposDeVisitaSection({
  canEdit,
  onError,
  onSuccess,
  onCambio,
}: {
  canEdit: boolean;
  onError: (msg: string | null) => void;
  onSuccess: (msg: string | null) => void;
  onCambio: () => void;
}) {
  const [items, setItems] = useState<TipoDeCategoria[] | null>(null);
  const [slug, setSlug] = useState("");
  const [tipo, setTipo] = useState<TipoDeVisita>("QUIROPODIA");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ items: TipoDeCategoria[] }>("/admin/tag-visit-types")
      .then((r) => setItems(r.items))
      .catch(() => setItems([]));
  }, []);

  async function onAdd(e: React.FormEvent) {
    e.preventDefault();
    onError(null);
    onSuccess(null);
    if (slug.trim().length === 0) return;
    setBusy(true);
    try {
      const r = await api<{ tagVisitType: TipoDeCategoria }>(
        "/admin/tag-visit-types",
        { method: "POST", body: { slug: slug.trim(), visitType: tipo } },
      );
      setItems((curr) => {
        const otros = (curr ?? []).filter((x) => x.id !== r.tagVisitType.id);
        const next = [...otros, r.tagVisitType];
        next.sort(
          (a, b) =>
            a.visitType.localeCompare(b.visitType) ||
            a.slug.localeCompare(b.slug),
        );
        return next;
      });
      setSlug("");
      onSuccess("Categoría asignada. Sus servicios heredan el tipo.");
      onCambio();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "Error inesperado");
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(id: string) {
    // Quitarlo puede dejar un servicio de sesión sin tipo, y ESO lo
    // rechaza el guardado del servicio (no este borrado): la regla se
    // aplica cuando alguien está mirando ese servicio y puede arreglarlo.
    // Mientras tanto, el servicio deja de ofrecerse en la sesión, que es
    // el fallo seguro.
    if (
      !window.confirm(
        "¿Quitar el tipo de esta categoría? Sus servicios dejarán de salir en la sesión hasta que se les ponga otro.",
      )
    ) {
      return;
    }
    onError(null);
    onSuccess(null);
    try {
      await api(`/admin/tag-visit-types/${id}`, { method: "DELETE" });
      setItems((curr) => (curr ?? []).filter((x) => x.id !== id));
      onSuccess("Tipo quitado de la categoría.");
      onCambio();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "Error inesperado");
    }
  }

  return (
    <section className="bg-white rounded-2xl border border-slate-200 p-6 md:p-7 mb-5">
      <h2 className="text-[17px] font-semibold text-mipiace-ink tracking-tight mb-1">
        Tipos de visita por categoría
      </h2>
      <p className="text-[13px] text-slate-500 mb-4">
        Marca cada categoría de tu catálogo con el tipo de visita que es
        (Quiropodia, Pie de riesgo, Cirugía, Biomecánica o General). Los
        servicios de esa categoría lo heredan: de ahí sale qué pantalla abre
        la sesión y de qué tipo se cobra cada línea. Una categoría sin tipo
        es una categoría normal. El <em>slug</em> es la etiqueta tal y como
        la usas en Holded, en minúsculas (<code>podologia</code>,{" "}
        <code>cirugia</code>).
      </p>

      <form onSubmit={onAdd} className="space-y-4">
        <div className="grid sm:grid-cols-2 gap-4">
          <TextField
            id="tipo-slug"
            label="Categoría (slug)"
            value={slug}
            onChange={setSlug}
            placeholder="podologia"
            required
          />
          <div>
            <label
              htmlFor="tipo-visita"
              className="block text-[13px] font-medium text-mipiace-ink mb-2"
            >
              Tipo de visita
            </label>
            <select
              id="tipo-visita"
              value={tipo}
              disabled={!canEdit}
              onChange={(e) => setTipo(e.target.value as TipoDeVisita)}
              className="w-full h-11 px-3 rounded-xl border border-slate-300 bg-white text-[14px] text-mipiace-ink focus:ring-2 focus:ring-mipiace-coral/40 focus:border-mipiace-coral/30 focus:outline-none disabled:opacity-50"
            >
              {TIPOS_DE_VISITA.map((t) => (
                <option key={t} value={t}>
                  {NOMBRE_DE_TIPO_DE_VISITA[t]}
                </option>
              ))}
            </select>
          </div>
        </div>
        <PrimaryButton type="submit" busy={busy} disabled={!canEdit}>
          <Plus className="w-3.5 h-3.5" />
          Asignar tipo
        </PrimaryButton>
      </form>

      {items !== null && items.length > 0 && (
        <div className="space-y-2 mt-5">
          {items.map((it) => (
            <div
              key={it.id}
              className="flex items-center gap-3 p-3.5 rounded-xl bg-mipiace-stone"
            >
              <div className="min-w-0 flex-1">
                <div className="text-[12px] uppercase tracking-wider text-slate-400 font-medium">
                  {it.slug}
                </div>
                <div className="text-[13.5px] text-mipiace-ink mt-0.5">
                  {NOMBRE_DE_TIPO_DE_VISITA[it.visitType] ?? it.visitType}
                </div>
              </div>
              <OutlineButton
                onClick={() => onDelete(it.id)}
                disabled={!canEdit}
                className="!h-9 !text-[12.5px] !text-red-600 !border-red-200 hover:!bg-red-50"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Quitar
              </OutlineButton>
            </div>
          ))}
        </div>
      )}
      {items !== null && items.length === 0 && (
        <p className="text-[13px] text-slate-400 mt-4">
          Todavía no has asignado ninguna categoría. Sin esto, los servicios
          no se pueden marcar como tratamiento de la sesión.
        </p>
      )}
    </section>
  );
}
