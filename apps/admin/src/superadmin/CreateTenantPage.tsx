import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowRight,
  Briefcase,
  CalendarClock,
  Calculator,
  Coffee,
  Eye,
  EyeOff,
  KeyRound,
  Package,
  Users,
} from "lucide-react";

import { superApi, SuperAdminApiError } from "./api.js";
import { SuperAdminShell } from "./SuperAdminShell.js";
import type { BusinessType, CreateTenantDraftResponse } from "./types.js";
import {
  BUSINESS_TYPE_DESCRIPTION,
  BUSINESS_TYPE_LABEL,
} from "./types.js";

// B-OnboardingV2 · Frente 8, reescrito por H1 (ADR-016).
//
// Antes: el super-admin sólo introducía la API key Holded del cliente y
// el backend derivaba razón social y dirección del almacén default.
//
// Ahora hay DOS altas, y la primera pregunta del formulario es cuál:
//
//   · CON Holded  → lo de siempre, intacto. Clave + id de cuenta, el
//     backend valida contra Holded y deriva los datos fiscales.
//   · SIN Holded  → no se toca la red. La razón social se teclea (es lo
//     que antes salía del almacén), el sync queda en NOT_APPLICABLE y
//     nadie le pedirá Holded al propietario.
//
// Y en las dos se eligen los MÓDULOS de la empresa. La caja se enciende
// y se apaga sólo aquí y en el detalle: es una decisión comercial, no un
// ajuste que el cliente pueda tocar desde su panel.
export function CreateTenantPage() {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // H1 · la bifurcación. Por defecto "ahora", que es el alta de hoy y la
  // de los cuatro clientes con caja.
  //
  // catalogo-local (addendum 3) · eran DOS opciones y hacían falta TRES.
  // "No, sin Holded" significaba a la vez "lo conectará más adelante" y
  // "no lo va a usar nunca", y esas dos empresas necesitan cosas
  // opuestas: la primera tiene que ver la pantalla de conectar Holded, y
  // la segunda no puede verla jamás o se queda encerrada en ella.
  //
  //   ahora     → holdedEnabled true,  con clave
  //   mas-tarde → holdedEnabled true,  sin clave   (el alta "sin Holded"
  //               de H1, que siempre quiso decir esto)
  //   nunca     → holdedEnabled false, sin clave   (el comercio de este
  //               bloque: su catálogo nace en la BD)
  const [holdedModo, setHoldedModo] = useState<"ahora" | "mas-tarde" | "nunca">(
    "ahora",
  );
  // Derivados, para que el resto del formulario siga leyéndose igual.
  const usesHolded = holdedModo === "ahora";
  const holdedEnabled = holdedModo !== "nunca";

  const [holdedApiKey, setHoldedApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [taxId, setTaxId] = useState("");
  const [legalName, setLegalName] = useState("");
  // v1.3-SuperAdmin-Hub Lote 3: id de la cuenta Holded del cliente.
  // Lo encuentra el implantador mirando la URL del admin Holded
  // (https://app.holded.com/accounts/<id>/…). Obligatorio cuando hay
  // Holded — sin él el hub no puede ofrecer el botón "Abrir en Holded".
  const [holdedAccountId, setHoldedAccountId] = useState("");
  // B-Multi-Vertical: default RETAIL (alineado con el default del
  // schema). El implantador lo cambia si la cuenta es de hostelería
  // o servicios. Afecta TPV (mapa de mesas, placeholder, modificadores).
  const [businessType, setBusinessType] = useState<BusinessType>("RETAIL");
  // H1 (ADR-016) · los módulos. Defaults = lo de hoy.
  const [cajaEnabled, setCajaEnabled] = useState(true);
  const [crmEnabled, setCrmEnabled] = useState(false);
  const [agendaEnabled, setAgendaEnabled] = useState(false);

  const sinModulos = !cajaEnabled && !crmEnabled && !agendaEnabled;
  // Sin Holded la razón social es obligatoria: es lo que antes derivaba
  // del almacén default de la cuenta.
  const faltaRazonSocial = !usesHolded && legalName.trim().length === 0;

  // Si el implantador pega la URL completa del panel Holded, extraemos
  // el id automáticamente — pasa con suficiente frecuencia como para no
  // hacer que tenga que recortar a mano. Si lo que pegó ya es sólo el
  // id, lo dejamos intacto.
  function normalizeAccountIdInput(raw: string): string {
    const match = raw.match(/accounts\/([^/?#]+)/i);
    if (match && match[1]) return match[1];
    return raw.trim().replace(/\/+$/, "");
  }

  async function onSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await superApi<CreateTenantDraftResponse>("/super-admin/tenants", {
        method: "POST",
        body: {
          // H1 · la pareja de Holded viaja entera o no viaja: el backend
          // rechaza media configuración con HOLDED_PARTIAL_CONFIG.
          ...(usesHolded
            ? {
                holdedApiKey: holdedApiKey.trim(),
                holdedAccountId: normalizeAccountIdInput(holdedAccountId),
              }
            : {}),
          taxId: taxId.trim() || undefined,
          legalName: legalName.trim() || undefined,
          businessType,
          cajaEnabled,
          crmEnabled,
          agendaEnabled,
          // catalogo-local (addendum 3) · el interruptor. Se manda
          // siempre, también cuando va encendido: que el alta diga
          // explícitamente qué empresa está creando es lo que evita que
          // el default se convierta en una suposición.
          holdedEnabled,
        },
      });
      navigate(`/superadmin/tenants/${res.tenant.id}`, { replace: true });
    } catch (err) {
      setError(err instanceof SuperAdminApiError ? err.message : "Error inesperado");
    } finally {
      setBusy(false);
    }
  }

  const BUSINESS_ICONS: Record<BusinessType, typeof Coffee> = {
    HOSPITALITY: Coffee,
    RETAIL: Package,
    SERVICES: Briefcase,
  };

  return (
    <SuperAdminShell title="Crear cuenta">
      {/* H1 · `min-w-0` + grids que apilan: el shell del super-admin tiene
          una barra lateral fija de 240 px sin variante móvil (es una
          herramienta de escritorio, ver `SuperAdminShell.tsx`). No la
          arreglamos aquí, pero al menos este formulario no añade
          desbordamiento horizontal por su cuenta. */}
      <form
        onSubmit={onSubmit}
        className="max-w-xl min-w-0 bg-white rounded-xl border border-slate-200 p-4 sm:p-6 shadow-sm space-y-5"
      >
        {/* H1 · la primera pregunta, porque decide el resto del formulario. */}
        <fieldset>
          <legend className="block text-[12.5px] font-medium text-slate-700 mb-1.5">
            ¿La empresa tiene Holded? <span className="text-red-500">*</span>
          </legend>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <ChoiceCard
              active={holdedModo === "ahora"}
              onClick={() => setHoldedModo("ahora")}
              title="Sí, ahora"
              hint="Validamos la API key y el catálogo se sincroniza."
              testId="holded-si"
            />
            <ChoiceCard
              active={holdedModo === "mas-tarde"}
              onClick={() => setHoldedModo("mas-tarde")}
              title="Sí, más adelante"
              hint="Lo ha contratado y aún no lo conecta."
              testId="holded-mas-tarde"
            />
            <ChoiceCard
              active={holdedModo === "nunca"}
              onClick={() => setHoldedModo("nunca")}
              title="No lo usa"
              hint="Su catálogo se gestiona en el TPV."
              testId="holded-no"
            />
          </div>
        </fieldset>

        <p className="text-[13px] text-slate-600">
          {holdedModo === "ahora"
            ? "Conecta la cuenta Holded del cliente con su API key. El equipo probará el TPV en modo prueba; el propietario sólo recibirá email cuando hayamos validado que todo funciona."
            : holdedModo === "mas-tarde"
              ? "La empresa se crea sin clave y el propietario verá la pantalla para conectar Holded al entrar. Hasta que la conecte, lo que cobre NO se subirá a su contabilidad: sale avisado en la salud del onboarding."
              : "La empresa no usa Holded y no verá la pantalla de conectarlo. Da de alta sus productos en el TPV y sus tickets se quedan cobrados, sin subir a ningún sitio. Se puede encender después desde el detalle, pero es forward-only: lo cobrado en el periodo local no se sube."}
        </p>

        {usesHolded && (
          <>
            <div>
              <label className="block text-[12.5px] font-medium text-slate-700 mb-1.5">
                API Key Holded
                <span className="text-red-500"> *</span>
              </label>
              <div className="relative">
                <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  type={showKey ? "text" : "password"}
                  value={holdedApiKey}
                  onChange={(e) => setHoldedApiKey(e.target.value)}
                  required
                  minLength={10}
                  maxLength={512}
                  autoComplete="off"
                  className="w-full h-11 pl-10 pr-10 border border-slate-300 rounded-lg text-[14px] focus:outline-none focus:border-slate-500 font-mono"
                  placeholder="abc123…"
                />
                <button
                  type="button"
                  onClick={() => setShowKey((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-slate-400 hover:text-slate-600"
                  aria-label={showKey ? "Ocultar clave" : "Mostrar clave"}
                >
                  {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <p className="text-[11.5px] text-slate-500 mt-1.5">
                {/* B-Hardening A · U6: lenguaje accesible para implantadores
                    no técnicos. La explicación técnica original queda en
                    el comentario para el desarrollador, pero el user del
                    admin lee algo humano. */}
                Comprobamos que la API key funciona antes de guardar. Se
                almacena cifrada en nuestra base de datos.
              </p>
            </div>
            {/* v1.3-SuperAdmin-Hub Lote 3: id de la cuenta Holded. Obligatorio
                cuando hay Holded. Si el implantador pega la URL completa del
                panel, el handler de onSubmit la recorta a sólo el id. */}
            <div>
              <label className="block text-[12.5px] font-medium text-slate-700 mb-1.5">
                ID de cuenta Holded
                <span className="text-red-500"> *</span>
              </label>
              <input
                type="text"
                value={holdedAccountId}
                onChange={(e) => setHoldedAccountId(e.target.value)}
                required
                maxLength={300}
                autoComplete="off"
                spellCheck={false}
                className="w-full h-11 px-3 border border-slate-300 rounded-lg text-[14px] focus:outline-none focus:border-slate-500 font-mono"
                placeholder="65f1234567890abcdef… o pega la URL completa"
              />
              <p className="text-[11.5px] text-slate-500 mt-1.5">
                Lo encuentras en la URL del panel Holded del cliente
                (<code className="font-mono">app.holded.com/accounts/<strong>&lt;id&gt;</strong>/…</code>).
                Puedes pegar la URL entera, recortamos al id automáticamente.
                Lo necesitamos para que el hub abra Holded directamente.
              </p>
            </div>
          </>
        )}

        {/* H1 (ADR-016) · los módulos de la empresa. */}
        <fieldset>
          <legend className="block text-[12.5px] font-medium text-slate-700 mb-1.5">
            Módulos <span className="text-red-500">*</span>
          </legend>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <ModuleCard
              icon={Calculator}
              label="Caja"
              hint="TPV, turnos, tickets"
              active={cajaEnabled}
              onToggle={() => setCajaEnabled((v) => !v)}
              testId="modulo-caja"
            />
            <ModuleCard
              icon={Users}
              label="CRM"
              hint="Ficha de cliente"
              active={crmEnabled}
              onToggle={() => setCrmEnabled((v) => !v)}
              testId="modulo-crm"
            />
            <ModuleCard
              icon={CalendarClock}
              label="Agenda"
              hint="Reservas y personal"
              active={agendaEnabled}
              onToggle={() => setAgendaEnabled((v) => !v)}
              testId="modulo-agenda"
            />
          </div>
          <p className="text-[11.5px] text-slate-500 mt-1.5">
            La caja sólo se enciende y se apaga desde aquí: el cliente no la
            ve en sus ajustes. El CRM y la agenda también puede moverlos el
            propietario desde su panel.
          </p>
          {sinModulos && (
            <p
              role="alert"
              className="text-[12px] text-amber-700 mt-1.5 font-medium"
            >
              Enciende al menos un módulo. Una empresa sin ninguno no puede
              activarse ni entrar a su panel.
            </p>
          )}
        </fieldset>

        {/* B-Multi-Vertical: 3 chips visuales para escoger el tipo de
            negocio. Necesario para que el TPV pinte el placeholder
            correcto y muestre/oculte el mapa de mesas. */}
        <div>
          <label className="block text-[12.5px] font-medium text-slate-700 mb-1.5">
            Tipo de negocio <span className="text-red-500">*</span>
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {(["HOSPITALITY", "RETAIL", "SERVICES"] as BusinessType[]).map((t) => {
              const Icon = BUSINESS_ICONS[t];
              const active = businessType === t;
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => setBusinessType(t)}
                  aria-pressed={active}
                  className={
                    active
                      ? "border-2 border-slate-900 bg-slate-50 rounded-lg p-3 text-left"
                      : "border border-slate-200 hover:border-slate-400 bg-white rounded-lg p-3 text-left"
                  }
                >
                  <Icon className="w-5 h-5 mb-1.5 text-slate-700" strokeWidth={1.7} />
                  <div className="text-[13px] font-medium text-slate-900">
                    {BUSINESS_TYPE_LABEL[t]}
                  </div>
                  <div className="text-[11px] text-slate-500 mt-0.5 leading-tight">
                    {BUSINESS_TYPE_DESCRIPTION[t]}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
        <Field
          label="NIF / CIF / NIE (opcional)"
          value={taxId}
          onChange={(v) => setTaxId(v.toUpperCase())}
          maxLength={32}
          help="Si lo conoces. Si lo dejas vacío, el propietario lo completa tras activar."
        />
        <Field
          label={
            usesHolded ? "Razón social (opcional)" : "Razón social"
          }
          required={!usesHolded}
          value={legalName}
          onChange={setLegalName}
          maxLength={200}
          help={
            usesHolded
              ? "Sobrescribe la del almacén default de Holded si necesitas la legal exacta."
              : "Sin Holded no hay de dónde derivarla: es el nombre con el que se crea la empresa."
          }
        />
        {error && (
          <p role="alert" className="text-[12.5px] text-red-600 font-medium">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={
            busy ||
            sinModulos ||
            faltaRazonSocial ||
            (usesHolded && (!holdedApiKey.trim() || !holdedAccountId.trim()))
          }
          className="w-full h-11 bg-slate-900 text-white text-[14px] font-medium rounded-lg hover:bg-slate-800 disabled:opacity-50 inline-flex items-center justify-center gap-2"
        >
          {busy
            ? usesHolded
              ? "Validando con Holded…"
              : "Creando…"
            : "Crear cuenta"}
          {!busy && <ArrowRight className="w-4 h-4" />}
        </button>
      </form>
    </SuperAdminShell>
  );
}

function ChoiceCard({
  active,
  onClick,
  title,
  hint,
  testId,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  hint: string;
  testId: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      data-testid={testId}
      className={
        active
          ? "border-2 border-slate-900 bg-slate-50 rounded-lg p-3 text-left"
          : "border border-slate-200 hover:border-slate-400 bg-white rounded-lg p-3 text-left"
      }
    >
      <div className="text-[13px] font-medium text-slate-900">{title}</div>
      <div className="text-[11px] text-slate-500 mt-0.5 leading-tight">{hint}</div>
    </button>
  );
}

function ModuleCard({
  icon: Icon,
  label,
  hint,
  active,
  onToggle,
  testId,
}: {
  icon: typeof Coffee;
  label: string;
  hint: string;
  active: boolean;
  onToggle: () => void;
  testId: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={active}
      data-testid={testId}
      className={
        active
          ? "border-2 border-slate-900 bg-slate-50 rounded-lg p-3 text-left"
          : "border border-slate-200 hover:border-slate-400 bg-white rounded-lg p-3 text-left opacity-70"
      }
    >
      <Icon
        className={`w-5 h-5 mb-1.5 ${active ? "text-slate-700" : "text-slate-400"}`}
        strokeWidth={1.7}
      />
      <div className="text-[13px] font-medium text-slate-900">{label}</div>
      <div className="text-[11px] text-slate-500 mt-0.5 leading-tight">{hint}</div>
      <div
        className={`text-[11px] mt-1 font-medium ${
          active ? "text-emerald-700" : "text-slate-400"
        }`}
      >
        {active ? "Encendido" : "Apagado"}
      </div>
    </button>
  );
}

function Field({
  label,
  value,
  onChange,
  maxLength,
  help,
  required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  maxLength?: number;
  help?: string;
  required?: boolean;
}) {
  return (
    <div>
      <label className="block text-[12.5px] font-medium text-slate-700 mb-1.5">
        {label}
        {required && <span className="text-red-500"> *</span>}
      </label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={maxLength}
        required={required}
        className="w-full h-11 px-3 border border-slate-300 rounded-lg text-[14px] focus:outline-none focus:border-slate-500"
      />
      {help && <p className="text-[11.5px] text-slate-500 mt-1">{help}</p>}
    </div>
  );
}
