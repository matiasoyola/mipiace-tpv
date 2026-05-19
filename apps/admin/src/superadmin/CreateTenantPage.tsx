import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowRight,
  Briefcase,
  Coffee,
  Eye,
  EyeOff,
  KeyRound,
  Package,
} from "lucide-react";

import { superApi, SuperAdminApiError } from "./api.js";
import { SuperAdminShell } from "./SuperAdminShell.js";
import type { BusinessType, CreateTenantDraftResponse } from "./types.js";
import {
  BUSINESS_TYPE_DESCRIPTION,
  BUSINESS_TYPE_LABEL,
} from "./types.js";

// B-OnboardingV2 · Frente 8.
//
// Form simplificado al máximo: el super-admin sólo introduce la API key
// Holded del cliente. Opcionalmente, taxId si lo conoce. El backend
// extrae razón social/dirección del warehouse default (Holded no expone
// /account/me, spike §08) y crea un tenant DRAFT sin OWNER todavía.
// El equipo mipiacetpv probará el TPV antes de activar al propietario.
export function CreateTenantPage() {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [holdedApiKey, setHoldedApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [taxId, setTaxId] = useState("");
  const [legalName, setLegalName] = useState("");
  // B-Multi-Vertical: default RETAIL (alineado con el default del
  // schema). El implantador lo cambia si la cuenta es de hostelería
  // o servicios. Afecta TPV (mapa de mesas, placeholder, modificadores).
  const [businessType, setBusinessType] = useState<BusinessType>("RETAIL");

  async function onSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await superApi<CreateTenantDraftResponse>("/super-admin/tenants", {
        method: "POST",
        body: {
          holdedApiKey: holdedApiKey.trim(),
          taxId: taxId.trim() || undefined,
          legalName: legalName.trim() || undefined,
          businessType,
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
    <SuperAdminShell title="Conectar Holded">
      <form
        onSubmit={onSubmit}
        className="max-w-xl bg-white rounded-xl border border-slate-200 p-6 shadow-sm space-y-4"
      >
        <p className="text-[13px] text-slate-600">
          Conecta la cuenta Holded del cliente con su API key. El equipo
          probará el TPV en modo prueba; el propietario sólo recibirá email
          cuando hayamos validado que todo funciona.
        </p>
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
            Validamos contra Holded antes de guardar (GET /invoicing/v1/warehouses).
            La key se cifra con AES-GCM en BD.
          </p>
        </div>
        {/* B-Multi-Vertical: 3 chips visuales para escoger el tipo de
            negocio. Necesario para que el TPV pinte el placeholder
            correcto y muestre/oculte el mapa de mesas. */}
        <div>
          <label className="block text-[12.5px] font-medium text-slate-700 mb-1.5">
            Tipo de negocio <span className="text-red-500">*</span>
          </label>
          <div className="grid grid-cols-3 gap-2">
            {(["HOSPITALITY", "RETAIL", "SERVICES"] as BusinessType[]).map((t) => {
              const Icon = BUSINESS_ICONS[t];
              const active = businessType === t;
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => setBusinessType(t)}
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
          label="Razón social (opcional)"
          value={legalName}
          onChange={setLegalName}
          maxLength={200}
          help="Sobrescribe la del almacén default de Holded si necesitas la legal exacta."
        />
        {error && (
          <p className="text-[12.5px] text-red-600 font-medium">{error}</p>
        )}
        <button
          type="submit"
          disabled={busy || !holdedApiKey.trim()}
          className="w-full h-11 bg-slate-900 text-white text-[14px] font-medium rounded-lg hover:bg-slate-800 disabled:opacity-50 inline-flex items-center justify-center gap-2"
        >
          {busy ? "Validando con Holded…" : "Crear cuenta"}
          {!busy && <ArrowRight className="w-4 h-4" />}
        </button>
      </form>
    </SuperAdminShell>
  );
}

function Field({
  label,
  value,
  onChange,
  maxLength,
  help,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  maxLength?: number;
  help?: string;
}) {
  return (
    <div>
      <label className="block text-[12.5px] font-medium text-slate-700 mb-1.5">
        {label}
      </label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={maxLength}
        className="w-full h-11 px-3 border border-slate-300 rounded-lg text-[14px] focus:outline-none focus:border-slate-500"
      />
      {help && <p className="text-[11.5px] text-slate-500 mt-1">{help}</p>}
    </div>
  );
}
