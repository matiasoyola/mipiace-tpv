// Picker de cliente reutilizable (B-reservas-1). Lo consumen el carrito del
// TPV (asignar cliente a ticket, atajo F1) y — cuando llegue — la agenda
// (B4, asignar cliente a cita). Búsqueda instantánea sobre el caché local
// Dexie (feedback <100 ms) con sync en background; alta rápida inline.
//
// B-reservas-mostrador F6 · el buscador encuentra TAMBIÉN a los contactos de
// Holded. El 13-09 la recepcionista buscó «Dem…» en el AP11, no salió nadie y
// la clienta llevaba tres años en Holded: son dos listas —`clients` (el CRM
// local) y `contacts` (lo sincronizado)— y no tiene por qué saberlo.
//
// El equilibrio: **el selector sigue siendo local y sin esperas.** Los del CRM
// salen del caché como hasta ahora, al instante. Los de Holded llegan después,
// por red, con debounce, y en una sección aparte y discreta debajo — nunca
// mezclados, porque elegir uno de ellos CREA una ficha y elegir un cliente no.
//
// Uso:
//   const picker = useClientPicker();
//   // en el JSX: {picker.element}
//   // al pulsar F1: picker.open((client) => { ...asignar... })

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, WifiOff, X } from "lucide-react";

import { scrollFocusIntoView } from "../lib/visualViewportSync.js";
import {
  loadClientsFromCache,
  refreshClients,
  searchClientsLocal,
  clientFullName,
  type ClientRow,
} from "../lib/clients.js";
import {
  buscarContactosHolded,
  clienteDesdeContacto,
  MINIMO_PARA_BUSCAR_EN_HOLDED,
  type ContactoHolded,
} from "../lib/contacts.js";
import { maskPhone } from "../pages/SalePage.contact.privacy.js";
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
  // B-reservas-mostrador F6 · los de Holded. `null` = todavía no se sabe (o
  // no se ha podido preguntar); `[]` = se ha preguntado y no hay nadie. No es
  // lo mismo y no se dice igual.
  const [holded, setHolded] = useState<ContactoHolded[] | null>(null);
  const [sinRed, setSinRed] = useState(false);
  const [enlazando, setEnlazando] = useState<string | null>(null);
  const [errorEnlace, setErrorEnlace] = useState<string | null>(null);

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

  // B-reservas-mostrador F6 · la búsqueda en Holded, con debounce y a partir
  // de dos letras. NO bloquea nada: mientras llega, los del CRM ya están en
  // pantalla y se pueden tocar.
  useEffect(() => {
    const q = query.trim();
    setErrorEnlace(null);
    if (q.length < MINIMO_PARA_BUSCAR_EN_HOLDED) {
      setHolded(null);
      setSinRed(false);
      return;
    }
    let vivo = true;
    const t = setTimeout(async () => {
      const res = await buscarContactosHolded(q);
      if (!vivo) return;
      // `null` es «no se ha podido preguntar». La sección NO aparece y un
      // aviso pequeño lo dice: un hueco vacío se leería como «no está», y
      // mandaría a la recepcionista a crear una ficha duplicada.
      setSinRed(res === null);
      setHolded(res);
    }, 250);
    return () => {
      vivo = false;
      clearTimeout(t);
    };
  }, [query]);

  // Un contacto que YA está enlazado a un cliente del CRM no sale dos veces:
  // sale como cliente, que es lo que es.
  const yaEnlazados = useMemo(
    () => new Set(all.map((c) => c.holdedContactId).filter(Boolean)),
    [all],
  );
  const contactosNuevos = useMemo(
    () => (holded ?? []).filter((c) => !yaEnlazados.has(c.holdedContactId)),
    [holded, yaEnlazados],
  );

  async function elegirContacto(c: ContactoHolded) {
    setEnlazando(c.id);
    setErrorEnlace(null);
    try {
      const { client } = await clienteDesdeContacto(c.id);
      onSelect(client);
    } catch {
      setErrorEnlace("No se ha podido traer ese contacto. Inténtalo otra vez.");
    } finally {
      setEnlazando(null);
    }
  }

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
          // B-reservas-mostrador F3 · alta RÁPIDA: hay una clienta delante
          // esperando. La fecha de nacimiento no sale aquí — al reservar o al
          // cobrar no permite tomar ninguna decisión. Vive en la ficha
          // (ClientsPage), que es donde se rellena sin prisa.
          <ClientForm
            modo="rapido"
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
              // B-reservas-mostrador F6 · «Sin coincidencias» se calla si hay
              // contactos de Holded debajo: decir que no hay nadie y a
              // continuación enseñar tres es lo que hace dudar a la cajera.
              contactosNuevos.length > 0 ? null : (
                <div className="text-[13px] text-slate-500 text-center py-4">
                  {query
                    ? "Sin coincidencias."
                    : "Aún no hay clientes. Crea el primero."}
                </div>
              )
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
            {/* B-reservas-mostrador F6 · los de Holded, DEBAJO y en su
                sección. Nunca mezclados con los clientes: tocar uno de aquí
                crea una ficha, y tocar un cliente no. */}
            {contactosNuevos.length > 0 && (
              <div className="mb-3" data-seccion-holded>
                <div className="text-[11.5px] font-medium text-slate-400 uppercase tracking-wide mb-1.5">
                  De Holded
                </div>
                <ul className="space-y-1.5">
                  {contactosNuevos.map((c) => (
                    <li key={c.id}>
                      <button
                        onClick={() => void elegirContacto(c)}
                        disabled={enlazando !== null}
                        data-contacto-holded={c.id}
                        className="w-full text-left p-3 rounded-xl bg-mipiace-stone border border-dashed border-slate-300 hover:border-mipiace-coral/40 disabled:opacity-50 flex items-center gap-2"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="text-[14px] font-medium text-mipiace-ink truncate">
                            {c.name}
                          </div>
                          {/* v1.4-Buscador-Contactos · el listado NUNCA enseña
                              el teléfono completo. Delante de la clienta hay
                              más gente mirando la tablet. */}
                          <div className="text-[12.5px] text-slate-500 truncate">
                            {maskPhone(c.phone) ?? "Sin teléfono"}
                          </div>
                        </div>
                        {enlazando === c.id && (
                          <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-400 shrink-0" />
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {/* Sin red la sección NO aparece vacía: un hueco vacío se leería
                como «no está» y mandaría a crear una ficha duplicada. */}
            {sinRed && (
              <div
                data-aviso-sin-red
                className="mb-3 flex items-center gap-1.5 text-[12px] text-slate-400"
              >
                <WifiOff className="w-3.5 h-3.5 shrink-0" />
                Sin conexión: no se buscan contactos de Holded.
              </div>
            )}
            {errorEnlace && (
              <div className="mb-3 text-[12.5px] text-red-700 bg-red-50 rounded-xl p-3">
                {errorEnlace}
              </div>
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
