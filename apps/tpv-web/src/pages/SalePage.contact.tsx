// Sheet de cliente del ticket (B4 §2.3). Buscador que tira de
// `/contacts/search` (B2) + botón "Crear contacto" con form mini.
//
// v1.4-Buscador-Contactos · privacidad por defecto en el listado:
// el cajero ve sólo el nombre y los últimos 4 dígitos del teléfono.
// NIF, email y dirección quedan ocultos del listado para no exponer
// datos personales delante del cliente. El contactId completo sigue
// enviándose al backend cuando se asigna al ticket — los datos se
// usan en la factura de Holded, simplemente no se renderizan al
// cajero. Si necesita verlos puntualmente, el botón "Ver datos
// completos" los revela tras una confirmación explícita.

import { useEffect, useState } from "react";
import { Eye, Loader2, X } from "lucide-react";

import { ApiError, apiWithCashier } from "../api.js";
import { scrollFocusIntoView } from "../lib/visualViewportSync.js";
import { maskPhone } from "./SalePage.contact.privacy.js";

export interface ContactRef {
  id: string;
  holdedContactId: string;
  name: string;
  email?: string | null;
  nif?: string | null;
  phone?: string | null;
}

interface SearchResponse {
  results: Array<{
    id: string;
    holdedContactId: string;
    name: string;
    email: string | null;
    nif: string | null;
    phone: string | null;
  }>;
  source: "local" | "holded";
  holdedFallback: string | null;
}

export function ContactSheet({
  current,
  onClose,
  onSelect,
  onClear,
}: {
  current: ContactRef | null;
  onClose: () => void;
  onSelect: (c: ContactRef) => void;
  onClear: () => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ContactRef[]>([]);
  const [source, setSource] = useState<"local" | "holded" | null>(null);
  const [fallback, setFallback] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  // v1.4-Buscador-Contactos: revelado "data on demand". Por defecto
  // el listado oculta NIF y email. El cajero puede pulsar "Ver datos
  // completos" en una fila concreta para mostrarlos puntualmente
  // (caso raro: confirmar identidad antes de cobrar una factura).
  // Reseteamos al cambiar la query para que el revelado no persista
  // entre búsquedas distintas.
  const [revealedId, setRevealedId] = useState<string | null>(null);
  useEffect(() => {
    setRevealedId(null);
  }, [query]);

  useEffect(() => {
    if (query.trim().length === 0) {
      setResults([]);
      setSource(null);
      setFallback(null);
      return;
    }
    const handle = setTimeout(async () => {
      setBusy(true);
      try {
        const res = await apiWithCashier<SearchResponse>(
          `/contacts/search?q=${encodeURIComponent(query)}`,
        );
        setResults(res.results);
        setSource(res.source);
        setFallback(res.holdedFallback);
      } catch (err) {
        setFallback(err instanceof ApiError ? err.message : "Error inesperado");
      } finally {
        setBusy(false);
      }
    }, 250);
    return () => clearTimeout(handle);
  }, [query]);

  return (
    <div
      className="fixed inset-0 z-50 bg-mipiace-ink/40 flex items-end sm:items-center justify-center p-4 font-sans"
      onClick={onClose}
      // v1.3-UX-Iteración Lote 2: empuja la sheet por encima del
      // teclado para que el buscador y el dropdown de resultados sigan
      // visibles cuando el cajero teclea.
      style={{ paddingBottom: "calc(1rem + var(--keyboard-offset, 0px))" }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white w-full max-w-md rounded-3xl border border-slate-200 p-6 md:p-7 max-h-[85vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-[18px] font-semibold text-mipiace-ink">Cliente</h2>
          <button
            onClick={onClose}
            className="h-9 w-9 rounded-xl hover:bg-slate-50 text-slate-500 flex items-center justify-center"
            aria-label="Cerrar"
          >
            <X className="w-4 h-4" strokeWidth={2.25} />
          </button>
        </div>
        {current && (
          <div className="bg-mipiace-coral-soft rounded-xl p-3 mb-4 flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <div className="text-[14px] font-medium text-mipiace-coral-dark truncate">
                {current.name}
              </div>
              <div className="text-[12.5px] text-mipiace-coral-dark/80">
                {maskPhone(current.phone) ?? "Asociado al ticket"}
              </div>
            </div>
            <button onClick={onClear} className="text-[13px] text-mipiace-coral-dark hover:underline">
              Quitar
            </button>
          </div>
        )}
        {showCreate ? (
          <CreateContactForm
            onCreated={(c) => onSelect(c)}
            onCancel={() => setShowCreate(false)}
          />
        ) : (
          <>
            <input
              id="contactSearch"
              name="contactSearch"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onFocus={scrollFocusIntoView}
              type="search"
              inputMode="search"
              enterKeyHint="search"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              placeholder="Buscar por nombre, NIF o teléfono…"
              className="w-full h-12 px-3.5 rounded-xl bg-mipiace-stone border border-transparent text-[14px] focus:bg-white focus:border-mipiace-coral/30 focus:ring-2 focus:ring-mipiace-coral/30 focus:outline-none mb-3"
            />
            {busy && (
              <div className="flex items-center gap-2 text-[13px] text-slate-500 mb-3">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Buscando…
              </div>
            )}
            {source === "holded" && (
              <div className="text-[12px] text-slate-500 mb-2">
                Resultados de Holded (sólo búsqueda por teléfono).
              </div>
            )}
            {/* `name_search_not_supported` desapareció en B7 §8:
                ahora el sync incremental trae todos los contactos
                del tenant a BD local, así que la búsqueda local cubre
                el caso por completo. */}
            {fallback === "no_holded_key" && (
              <div className="text-[12.5px] text-red-700 bg-red-50 rounded-xl p-3 mb-3">
                Holded no está conectado.
              </div>
            )}
            {results.length === 0 && query.length > 0 && !busy ? (
              <div className="text-[13px] text-slate-500 text-center py-4">
                Sin coincidencias.
              </div>
            ) : (
              <ul className="space-y-1.5 mb-3" data-testid="contact-results">
                {results.map((r) => {
                  const isRevealed = revealedId === r.id;
                  const maskedPhone = maskPhone(r.phone);
                  return (
                    <li key={r.id}>
                      <div className="w-full text-left p-3 rounded-xl bg-white border border-slate-200 hover:border-mipiace-coral/40">
                        <button
                          onClick={() => onSelect(r)}
                          className="w-full text-left"
                          data-testid="contact-result"
                        >
                          <div className="text-[14px] font-medium text-mipiace-ink">
                            {r.name}
                          </div>
                          <div className="text-[12.5px] text-slate-500">
                            {maskedPhone ?? "Sin teléfono"}
                          </div>
                        </button>
                        {isRevealed && (
                          <div className="mt-2 pt-2 border-t border-slate-100 text-[12px] text-slate-500 space-y-0.5">
                            {r.phone && <div>Tel: {r.phone}</div>}
                            {r.email && <div>Email: {r.email}</div>}
                            {r.nif && <div>NIF: {r.nif}</div>}
                          </div>
                        )}
                        {!isRevealed && (r.email || r.nif) && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setRevealedId(r.id);
                            }}
                            className="mt-1.5 inline-flex items-center gap-1 text-[11.5px] text-slate-400 hover:text-mipiace-coral-dark"
                            data-testid="contact-reveal"
                          >
                            <Eye className="w-3 h-3" strokeWidth={2.25} />
                            Ver datos completos
                          </button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            <button
              onClick={() => setShowCreate(true)}
              className="w-full h-12 rounded-2xl border-2 border-dashed border-slate-200 hover:border-mipiace-coral/40 text-slate-500 hover:text-mipiace-coral-dark text-[13.5px] font-medium"
            >
              + Crear contacto nuevo
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function CreateContactForm({
  onCreated,
  onCancel,
}: {
  onCreated: (c: ContactRef) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [nif, setNif] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  // T-7 (v1.1 Thalia): dirección para facturas. Opcional. Una línea
  // libre — Holded acepta el contenido tal cual.
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, string> = { name };
      if (nif) body.nif = nif;
      if (email) body.email = email;
      if (phone) body.phone = phone;
      if (address.trim()) body.address = address.trim();
      const res = await apiWithCashier<{ contact: ContactRef }>("/contacts", {
        method: "POST",
        body,
      });
      onCreated(res.contact);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Error inesperado");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <Input label="Nombre" value={name} onChange={setName} required />
      <Input label="NIF / CIF" value={nif} onChange={setNif} />
      <Input label="Email" value={email} onChange={setEmail} />
      <Input label="Teléfono" value={phone} onChange={setPhone} />
      <Input label="Dirección (para facturas)" value={address} onChange={setAddress} />
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
          disabled={!name || busy}
          className="flex-1 h-12 rounded-2xl bg-mipiace-coral hover:bg-mipiace-coral-dark disabled:opacity-50 text-white text-[14px] font-medium flex items-center justify-center gap-2"
        >
          {busy && <Loader2 className="w-4 h-4 animate-spin" />}
          Crear y asociar
        </button>
      </div>
    </div>
  );
}

function Input({
  label,
  value,
  onChange,
  required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
}) {
  // id determinístico a partir del label para asociar label↔input y
  // dar autofill nativo (B5 §3.3).
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return (
    <div>
      <label htmlFor={`contact-${slug}`} className="block text-[12.5px] text-slate-500 mb-1">
        {label}
      </label>
      <input
        id={`contact-${slug}`}
        name={slug}
        value={value}
        required={required}
        onChange={(e) => onChange(e.target.value)}
        onFocus={scrollFocusIntoView}
        className="w-full h-11 px-3.5 rounded-xl bg-mipiace-stone border border-transparent text-[14px] focus:bg-white focus:border-mipiace-coral/30 focus:ring-2 focus:ring-mipiace-coral/30 focus:outline-none"
      />
    </div>
  );
}
