import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Copy, CheckCircle2 } from "lucide-react";

import { superApi, SuperAdminApiError } from "./api.js";
import { SuperAdminShell } from "./SuperAdminShell.js";
import type { CreateTenantResponse } from "./types.js";

export function CreateTenantPage() {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CreateTenantResponse | null>(null);
  const [copied, setCopied] = useState(false);

  const [name, setName] = useState("");
  const [fiscalNif, setFiscalNif] = useState("");
  const [fiscalAddress, setFiscalAddress] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [plan, setPlan] = useState("pilot");

  async function onSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await superApi<CreateTenantResponse>("/super-admin/tenants", {
        method: "POST",
        body: {
          name,
          fiscalNif,
          fiscalAddress: fiscalAddress || undefined,
          ownerEmail,
          ownerName,
          plan,
        },
      });
      setResult(res);
    } catch (err) {
      setError(err instanceof SuperAdminApiError ? err.message : "Error inesperado");
    } finally {
      setBusy(false);
    }
  }

  async function copyPassword(): Promise<void> {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.tempPassword);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      /* clipboard puede fallar en contextos no-secure */
    }
  }

  if (result) {
    return (
      <SuperAdminShell title="Tenant creado">
        <div className="max-w-xl bg-white rounded-xl border border-emerald-200 p-6 shadow-sm">
          <div className="flex items-center gap-2 mb-3">
            <CheckCircle2 className="w-5 h-5 text-emerald-600" />
            <h2 className="font-semibold text-slate-900 text-[15px]">
              Tenant {result.tenant.name} creado correctamente
            </h2>
          </div>
          <div className="space-y-3 text-[13.5px]">
            <div>
              <div className="text-[11.5px] uppercase tracking-wide text-slate-500 mb-1">
                Email del OWNER
              </div>
              <div className="font-mono text-slate-900">{result.ownerEmail}</div>
            </div>
            <div>
              <div className="text-[11.5px] uppercase tracking-wide text-slate-500 mb-1">
                Contraseña temporal
              </div>
              <div className="flex items-center gap-2">
                <code className="font-mono bg-slate-900 text-white rounded-lg px-3 py-2 text-[14px] tracking-wide">
                  {result.tempPassword}
                </code>
                <button
                  onClick={copyPassword}
                  className="inline-flex items-center gap-1 h-9 px-3 border border-slate-300 rounded-lg text-[12.5px] hover:bg-slate-50"
                >
                  <Copy className="w-3.5 h-3.5" />
                  {copied ? "Copiado" : "Copiar"}
                </button>
              </div>
              <p className="text-[12px] text-slate-500 mt-2">
                Esta es la única vez que se muestra. Se la hemos enviado por
                email al OWNER. El OWNER deberá cambiarla en su primer login.
              </p>
            </div>
          </div>
          <div className="flex gap-2 mt-6">
            <button
              onClick={() => navigate(`/superadmin/tenants/${result.tenant.id}`)}
              className="h-10 px-4 bg-slate-900 text-white rounded-lg text-[13px] font-medium hover:bg-slate-800"
            >
              Ver detalle
            </button>
            <button
              onClick={() => navigate("/superadmin/tenants")}
              className="h-10 px-4 border border-slate-300 rounded-lg text-[13px] hover:bg-slate-50"
            >
              Volver al listado
            </button>
          </div>
        </div>
      </SuperAdminShell>
    );
  }

  return (
    <SuperAdminShell title="Crear tenant">
      <form
        onSubmit={onSubmit}
        className="max-w-xl bg-white rounded-xl border border-slate-200 p-6 shadow-sm space-y-4"
      >
        <Field
          label="Nombre del tenant"
          value={name}
          onChange={setName}
          required
          maxLength={200}
        />
        <Field
          label="NIF / CIF / NIE"
          value={fiscalNif}
          onChange={(v) => setFiscalNif(v.toUpperCase())}
          required
          maxLength={32}
          help="NIF (8 dígitos+letra), CIF (letra+7 dígitos+control), NIE (X/Y/Z+7 dígitos+letra)"
        />
        <Field
          label="Dirección fiscal (opcional)"
          value={fiscalAddress}
          onChange={setFiscalAddress}
          maxLength={300}
        />
        <Field
          label="Email del OWNER"
          type="email"
          value={ownerEmail}
          onChange={(v) => setOwnerEmail(v.toLowerCase())}
          required
        />
        <Field
          label="Nombre del OWNER"
          value={ownerName}
          onChange={setOwnerName}
          required
          maxLength={200}
        />
        <div>
          <label className="block text-[12.5px] font-medium text-slate-700 mb-1.5">
            Plan
          </label>
          <select
            value={plan}
            onChange={(e) => setPlan(e.target.value)}
            className="w-full h-11 px-3 border border-slate-300 rounded-lg text-[14px] bg-white"
          >
            <option value="pilot">Piloto</option>
            <option value="free">Free</option>
            <option value="paid">Paid</option>
          </select>
        </div>
        {error && (
          <p className="text-[12.5px] text-red-600 font-medium">{error}</p>
        )}
        <button
          type="submit"
          disabled={busy}
          className="w-full h-11 bg-slate-900 text-white text-[14px] font-medium rounded-lg hover:bg-slate-800 disabled:opacity-50"
        >
          {busy ? "Creando…" : "Crear tenant y enviar email"}
        </button>
      </form>
    </SuperAdminShell>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  required = false,
  maxLength,
  help,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean;
  maxLength?: number;
  help?: string;
}) {
  return (
    <div>
      <label className="block text-[12.5px] font-medium text-slate-700 mb-1.5">
        {label}
        {required && <span className="text-red-500"> *</span>}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        maxLength={maxLength}
        className="w-full h-11 px-3 border border-slate-300 rounded-lg text-[14px] focus:outline-none focus:border-slate-500"
      />
      {help && <p className="text-[11.5px] text-slate-500 mt-1">{help}</p>}
    </div>
  );
}
