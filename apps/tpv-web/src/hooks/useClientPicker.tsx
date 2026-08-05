// Picker de cliente reutilizable (B-koibox-1). Lo consumen el carrito del
// TPV (asignar cliente a ticket, atajo F1) y — cuando llegue — la agenda
// (B4, asignar cliente a cita). Búsqueda instantánea sobre el caché local
// Dexie (feedback <100 ms) con sync en background; alta rápida inline.
//
// Uso:
//   const picker = useClientPicker();
//   // en el JSX: {picker.element}
//   // al pulsar F1: picker.open((client) => { ...asignar... })

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, X } from "lucide-react";

import { scrollFocusIntoView } from "../lib/visualViewportSync.js";
import {
  loadClientsFromCache,
  refreshClients,
  searchClientsLocal,
  clientFullName,
  type ClientRow,
} from "../lib/clients.js";
import { ClientForm } from "../pages/ClientForm.js";

interface PickerState {
  onSelect: (client: ClientRow) => void;
}

export interface ClientPicker {
  open: (onSelect: (client: ClientRow) => void) => void;
  close: () => void;
  isOpen: boolean;
  element: React.ReactNode;
}

export function useClientPicker(): ClientPicker {
  const [state, setState] = useState<PickerState | null>(null);

  const open = useCallback((onSelect: (client: ClientRow) => void) => {
    setState({ onSelect });
  }, []);
  const close = useCallback(() => setState(null), []);

  const element = state ? (
    <ClientPickerSheet
      onClose={close}
      onSelect={(c) => {
        state.onSelect(c);
        close();
      }}
    />
  ) : null;

  return { open, close, isOpen: state !== null, element };
}

function ClientPickerSheet({
  onClose,
  onSelect,
}: {
  onClose: () => void;
  onSelect: (client: ClientRow) => void;
}) {
  const [all, setAll] = useState<ClientRow[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Carga inmediata del caché (sin red) + refresh en background.
  useEffect(() => {
    let cancelled = false;
    loadClientsFromCache().then((cached) => {
      if (cancelled) return;
      setAll(cached);
      setLoading(false);
    });
    refreshClients()
      .then((fresh) => {
        if (!cancelled) setAll(fresh);
      })
      .catch(() => {
        /* offline: nos quedamos con el caché */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Esc cierra.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const results = useMemo(
    () => searchClientsLocal(all, query, 50),
    [all, query],
  );

  return (
    <div
      className="fixed inset-0 z-50 bg-mipiace-ink/40 flex items-end sm:items-center justify-center p-4 font-sans"
      onClick={onClose}
      style={{ paddingBottom: "calc(1rem + var(--keyboard-offset, 0px))" }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white w-full max-w-md rounded-3xl border border-slate-200 p-6 md:p-7 max-h-[85vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-[18px] font-semibold text-mipiace-ink">
            {showCreate ? "Nuevo cliente" : "Cliente"}
          </h2>
          <button
            onClick={onClose}
            className="h-9 w-9 rounded-xl hover:bg-slate-50 text-slate-500 flex items-center justify-center"
            aria-label="Cerrar"
          >
            <X className="w-4 h-4" strokeWidth={2.25} />
          </button>
        </div>

        {showCreate ? (
          <ClientForm
            onSaved={(c) => onSelect(c)}
            onCancel={() => setShowCreate(false)}
          />
        ) : (
          <>
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onFocus={scrollFocusIntoView}
              type="search"
              inputMode="search"
              enterKeyHint="search"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              placeholder="Buscar por nombre, teléfono o email…"
              className="w-full h-12 px-3.5 rounded-xl bg-mipiace-stone border border-transparent text-[14px] focus:bg-white focus:border-mipiace-coral/30 focus:ring-2 focus:ring-mipiace-coral/30 focus:outline-none mb-3"
            />
            {loading ? (
              <div className="flex items-center gap-2 text-[13px] text-slate-500 py-4 justify-center">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Cargando…
              </div>
            ) : results.length === 0 ? (
              <div className="text-[13px] text-slate-500 text-center py-4">
                {query
                  ? "Sin coincidencias."
                  : "Aún no hay clientes. Crea el primero."}
              </div>
            ) : (
              <ul className="space-y-1.5 mb-3" data-testid="client-picker-results">
                {results.map((c) => (
                  <li key={c.id}>
                    <button
                      onClick={() => onSelect(c)}
                      className="w-full text-left p-3 rounded-xl bg-white border border-slate-200 hover:border-mipiace-coral/40"
                      data-testid="client-picker-result"
                    >
                      <div className="text-[14px] font-medium text-mipiace-ink flex items-center gap-2">
                        {clientFullName(c)}
                        {c.syncState === "pending" && (
                          <span className="text-[10.5px] text-amber-700 bg-amber-50 rounded-full px-1.5 py-0.5">
                            sin conexión
                          </span>
                        )}
                      </div>
                      <div className="text-[12.5px] text-slate-500">
                        {c.phone ?? c.email ?? "Sin contacto"}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <button
              onClick={() => setShowCreate(true)}
              className="w-full h-12 rounded-2xl border-2 border-dashed border-slate-200 hover:border-mipiace-coral/40 text-slate-500 hover:text-mipiace-coral-dark text-[13.5px] font-medium"
            >
              + Nuevo cliente
            </button>
          </>
        )}
      </div>
    </div>
  );
}
