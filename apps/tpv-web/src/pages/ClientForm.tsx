// Alta / edición de cliente CRM (B-koibox-1). Formulario inline (no modal
// bloqueante en flujo crítico — UX no negociable). Reutilizado por la
// sección Clientes y por el picker rápido (F1).

import { useState } from "react";
import { Loader2 } from "lucide-react";

import { ApiError } from "../api.js";
import { scrollFocusIntoView } from "../lib/visualViewportSync.js";
import {
  createClient,
  updateClient,
  clientFullName,
  type ClientRow,
} from "../lib/clients.js";

export function ClientForm({
  existing,
  onSaved,
  onCancel,
}: {
  // Si viene, es edición; si no, alta.
  existing?: ClientRow | null;
  onSaved: (c: ClientRow) => void;
  onCancel: () => void;
}) {
  const [firstName, setFirstName] = useState(existing?.firstName ?? "");
  const [lastName, setLastName] = useState(existing?.lastName ?? "");
  const [phone, setPhone] = useState(existing?.phone ?? "");
  const [email, setEmail] = useState(existing?.email ?? "");
  const [birthdate, setBirthdate] = useState(existing?.birthdate ?? "");
  const [marketingOptIn, setMarketingOptIn] = useState(
    existing?.marketingOptIn ?? false,
  );
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [phoneWarning, setPhoneWarning] = useState<
    Array<{ id: string; name: string }>
  >([]);

  async function submit() {
    setBusy(true);
    setError(null);
    setPhoneWarning([]);
    try {
      if (existing) {
        const updated = await updateClient(existing.id, {
          firstName,
          lastName,
          phone: phone.trim() || null,
          email: email.trim() || null,
          birthdate: birthdate || null,
          marketingOptIn,
          notes: notes.trim() || null,
        });
        onSaved(updated);
        return;
      }
      const res = await createClient({
        firstName,
        lastName,
        phone: phone.trim() || undefined,
        email: email.trim() || undefined,
        birthdate: birthdate || undefined,
        marketingOptIn,
        notes: notes.trim() || undefined,
      });
      // Aviso de teléfono duplicado: informativo, no bloquea — el alta ya
      // se hizo.
      if (res.phoneWarning && res.phoneWarning.length > 0) {
        setPhoneWarning(res.phoneWarning);
      }
      onSaved(res.client);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Error inesperado");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2.5">
        <Field label="Nombre" value={firstName} onChange={setFirstName} required />
        <Field label="Apellidos" value={lastName} onChange={setLastName} required />
      </div>
      <Field label="Teléfono" value={phone} onChange={setPhone} type="tel" />
      <Field label="Email" value={email} onChange={setEmail} type="email" />
      <Field label="Fecha de nacimiento" value={birthdate} onChange={setBirthdate} type="date" />
      <label className="flex items-center gap-2.5 py-1.5 cursor-pointer">
        <input
          type="checkbox"
          checked={marketingOptIn}
          onChange={(e) => setMarketingOptIn(e.target.checked)}
          className="h-4 w-4 rounded border-slate-300 text-mipiace-coral focus:ring-mipiace-coral/30"
        />
        <span className="text-[13px] text-mipiace-ink-soft">
          Acepta comunicaciones comerciales (RGPD)
        </span>
      </label>
      <div>
        <label className="block text-[12.5px] text-slate-500 mb-1">Notas</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onFocus={scrollFocusIntoView}
          rows={2}
          className="w-full px-3.5 py-2.5 rounded-xl bg-mipiace-stone border border-transparent text-[14px] focus:bg-white focus:border-mipiace-coral/30 focus:ring-2 focus:ring-mipiace-coral/30 focus:outline-none resize-none"
        />
      </div>
      {phoneWarning.length > 0 && (
        <div className="text-[12.5px] text-amber-800 bg-amber-50 rounded-xl p-3">
          Ya hay {phoneWarning.length === 1 ? "un cliente" : "clientes"} con
          ese teléfono: {phoneWarning.map((w) => w.name).join(", ")}.
        </div>
      )}
      {error && (
        <div className="text-[12.5px] text-red-700 bg-red-50 rounded-xl p-3">{error}</div>
      )}
      <div className="flex gap-2.5 pt-1">
        <button
          onClick={onCancel}
          disabled={busy}
          className="flex-1 h-12 rounded-2xl border border-slate-200 hover:bg-slate-50 text-[13.5px] text-mipiace-ink-soft font-medium"
        >
          Cancelar
        </button>
        <button
          onClick={submit}
          disabled={!firstName.trim() || !lastName.trim() || busy}
          className="flex-1 h-12 rounded-2xl bg-mipiace-coral hover:bg-mipiace-coral-dark disabled:opacity-50 text-white text-[14px] font-medium flex items-center justify-center gap-2"
        >
          {busy && <Loader2 className="w-4 h-4 animate-spin" />}
          {existing ? "Guardar" : "Crear cliente"}
        </button>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  required,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  type?: string;
}) {
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return (
    <div>
      <label htmlFor={`client-${slug}`} className="block text-[12.5px] text-slate-500 mb-1">
        {label}
        {required && <span className="text-mipiace-coral"> *</span>}
      </label>
      <input
        id={`client-${slug}`}
        name={slug}
        type={type}
        value={value}
        required={required}
        onChange={(e) => onChange(e.target.value)}
        onFocus={scrollFocusIntoView}
        autoCapitalize={type === "email" ? "off" : "words"}
        autoCorrect="off"
        className="w-full h-11 px-3.5 rounded-xl bg-mipiace-stone border border-transparent text-[14px] focus:bg-white focus:border-mipiace-coral/30 focus:ring-2 focus:ring-mipiace-coral/30 focus:outline-none"
      />
    </div>
  );
}

export { clientFullName };
