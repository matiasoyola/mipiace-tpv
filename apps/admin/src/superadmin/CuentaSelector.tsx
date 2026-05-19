// B-Multi-Vertical SB5: dropdown global de cuentas en la cabecera del
// super-admin. Permite saltar entre tenants sin volver a la lista. La
// cabecera muestra el contexto actual: "mipiace · super-admin" para
// rutas no-tenant (`/superadmin`, `/superadmin/tenants`, `/superadmin/
// audit`, `/superadmin/me`, `/superadmin/admins`), o "Nombre + chip
// businessType" cuando estás en `/superadmin/tenants/:id`.
//
// Atajos: `/` enfoca el input, `↑↓` navega, `Enter` selecciona, `Esc`
// cierra. La lista se cachea 60s en localStorage para no re-fetchear
// en cada apertura; el ID de la última cuenta seleccionada se persiste
// también como "sugerencia visual" — no se redirige automáticamente.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { Building2, ChevronDown, Search } from "lucide-react";

import { superApi, SuperAdminApiError } from "./api.js";
import {
  BUSINESS_TYPE_LABEL,
  type BusinessType,
  type TenantListItem,
  type TenantListResponse,
} from "./types.js";

const CACHE_KEY = "super_admin_cuenta_selector_cache";
const LAST_SELECTED_KEY = "super_admin_cuenta_selector_last";
const CACHE_TTL_MS = 60 * 1000;

interface CachedList {
  fetchedAt: number;
  items: TenantListItem[];
}

function readCache(): CachedList | null {
  const raw = localStorage.getItem(CACHE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as CachedList;
    if (Date.now() - parsed.fetchedAt > CACHE_TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(items: TenantListItem[]): void {
  const payload: CachedList = { fetchedAt: Date.now(), items };
  localStorage.setItem(CACHE_KEY, JSON.stringify(payload));
}

export function getLastSelectedTenantId(): string | null {
  return localStorage.getItem(LAST_SELECTED_KEY);
}

function setLastSelectedTenantId(id: string): void {
  localStorage.setItem(LAST_SELECTED_KEY, id);
}

function useTenantIdFromRoute(): string | null {
  const params = useParams<{ id?: string }>();
  const location = useLocation();
  // Sólo consideramos un tenant "activo" cuando la ruta es exactamente
  // `/superadmin/tenants/:id`. Otras rutas con :id no existen en este
  // namespace, pero defensivo.
  if (!location.pathname.startsWith("/superadmin/tenants/")) return null;
  // params.id viene undefined en la lista (sin id en la URL). El
  // siguiente check evita matchear `/superadmin/tenants/new`.
  if (!params.id || params.id === "new") return null;
  return params.id;
}

function BusinessTypeChip({ type }: { type: BusinessType }) {
  const cls =
    type === "HOSPITALITY"
      ? "bg-amber-100 text-amber-800 border-amber-200"
      : type === "RETAIL"
        ? "bg-sky-100 text-sky-800 border-sky-200"
        : "bg-violet-100 text-violet-800 border-violet-200";
  return (
    <span
      className={
        "inline-flex items-center px-1.5 py-0.5 rounded text-[10.5px] font-medium border " +
        cls
      }
    >
      {BUSINESS_TYPE_LABEL[type]}
    </span>
  );
}

export function CuentaSelector() {
  const navigate = useNavigate();
  const currentTenantId = useTenantIdFromRoute();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<TenantListItem[] | null>(() => {
    const cached = readCache();
    return cached?.items ?? null;
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [highlightedIdx, setHighlightedIdx] = useState(0);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  const loadTenants = useCallback(
    async (force: boolean): Promise<void> => {
      if (!force) {
        const cached = readCache();
        if (cached) {
          setItems(cached.items);
          return;
        }
      }
      setLoading(true);
      setError(null);
      try {
        const res = await superApi<TenantListResponse>(
          "/super-admin/tenants",
        );
        setItems(res.items);
        writeCache(res.items);
      } catch (err) {
        setError(
          err instanceof SuperAdminApiError ? err.message : "Error al cargar",
        );
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  // Cuando se abre el dropdown, refrescamos si la cache caducó.
  useEffect(() => {
    if (!open) return;
    loadTenants(false);
  }, [open, loadTenants]);

  // Cuando se abre, autoenfocamos el input. Reset query + highlight.
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setHighlightedIdx(0);
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [open]);

  // Click fuera cierra. Listener documento.
  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      const target = e.target as Node | null;
      if (!target) return;
      if (popoverRef.current?.contains(target)) return;
      if (buttonRef.current?.contains(target)) return;
      setOpen(false);
    }
    window.addEventListener("mousedown", onClickOutside);
    return () => window.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  // Atajo global `/` para abrir y enfocar. No se activa cuando ya hay
  // foco en otro input (no robar tipeos), ni con modificadores.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "/") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable
      ) {
        return;
      }
      e.preventDefault();
      setOpen(true);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const currentTenant = useMemo(() => {
    if (!currentTenantId || !items) return null;
    return items.find((t) => t.id === currentTenantId) ?? null;
  }, [currentTenantId, items]);

  const filtered = useMemo(() => {
    if (!items) return [];
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        (t.ownerEmail ?? "").toLowerCase().includes(q),
    );
  }, [items, query]);

  useEffect(() => {
    if (highlightedIdx >= filtered.length) {
      setHighlightedIdx(0);
    }
  }, [filtered.length, highlightedIdx]);

  const selectTenant = useCallback(
    (id: string) => {
      setLastSelectedTenantId(id);
      setOpen(false);
      navigate(`/superadmin/tenants/${id}`);
    },
    [navigate],
  );

  function onInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightedIdx((i) =>
        filtered.length === 0 ? 0 : (i + 1) % filtered.length,
      );
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightedIdx((i) =>
        filtered.length === 0 ? 0 : (i - 1 + filtered.length) % filtered.length,
      );
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const target = filtered[highlightedIdx];
      if (target) selectTenant(target.id);
    }
  }

  const triggerLabel = currentTenant ? (
    <span className="flex items-center gap-2 min-w-0">
      <Building2 className="w-4 h-4 text-slate-500 shrink-0" />
      <span className="font-medium text-slate-900 truncate">
        {currentTenant.name}
      </span>
      <BusinessTypeChip type={currentTenant.businessType} />
    </span>
  ) : (
    <span className="flex items-center gap-2 min-w-0">
      <Building2 className="w-4 h-4 text-slate-500 shrink-0" />
      <span className="font-medium text-slate-900">mipiace</span>
      <span className="text-slate-400">·</span>
      <span className="text-slate-500 text-[12.5px]">super-admin</span>
    </span>
  );

  return (
    <div className="relative inline-block" data-cuenta-selector>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="h-9 inline-flex items-center gap-2 pl-3 pr-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-[13px] max-w-[380px]"
      >
        {triggerLabel}
        <ChevronDown
          className={
            "w-4 h-4 text-slate-400 transition-transform " +
            (open ? "rotate-180" : "")
          }
        />
      </button>
      {open && (
        <div
          ref={popoverRef}
          className="absolute left-0 top-[44px] w-[420px] max-w-[calc(100vw-32px)] bg-white border border-slate-200 rounded-xl shadow-lg z-50 overflow-hidden"
          role="dialog"
          aria-label="Selector de cuenta"
        >
          <div className="px-3 pt-3 pb-2 border-b border-slate-100">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setHighlightedIdx(0);
                }}
                onKeyDown={onInputKeyDown}
                placeholder="Buscar por nombre u owner…"
                className="w-full h-9 pl-8 pr-2 text-[13px] border border-slate-200 rounded-lg focus:outline-none focus:border-slate-400"
              />
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              navigate("/superadmin/tenants");
            }}
            className="w-full text-left px-3 py-2 text-[12.5px] text-slate-500 hover:bg-slate-50 border-b border-slate-100"
          >
            → Volver a super-admin (lista de cuentas)
          </button>
          <div className="max-h-[360px] overflow-y-auto">
            {loading && (
              <div className="px-3 py-4 text-[12.5px] text-slate-500">
                Cargando…
              </div>
            )}
            {!loading && error && (
              <div className="px-3 py-4 text-[12.5px] text-red-600">
                {error}
              </div>
            )}
            {!loading && !error && filtered.length === 0 && (
              <div className="px-3 py-4 text-[12.5px] text-slate-500">
                Sin resultados.
              </div>
            )}
            {!loading &&
              filtered.map((t, idx) => {
                const isHighlighted = idx === highlightedIdx;
                const isCurrent = t.id === currentTenantId;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onMouseEnter={() => setHighlightedIdx(idx)}
                    onClick={() => selectTenant(t.id)}
                    className={
                      "w-full text-left px-3 py-2.5 flex items-center gap-2 border-b border-slate-50 last:border-b-0 " +
                      (isHighlighted ? "bg-slate-50" : "bg-white")
                    }
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-medium text-slate-900 text-[13px] truncate">
                          {t.name}
                        </span>
                        <BusinessTypeChip type={t.businessType} />
                        {isCurrent && (
                          <span className="text-[10.5px] text-emerald-700 font-medium uppercase tracking-wider">
                            actual
                          </span>
                        )}
                      </div>
                      <div className="text-[11.5px] text-slate-500 truncate mt-0.5">
                        {t.ownerEmail ?? "—"}
                      </div>
                    </div>
                  </button>
                );
              })}
          </div>
          <div className="px-3 py-1.5 text-[10.5px] text-slate-400 bg-slate-50 border-t border-slate-100 flex justify-between">
            <span>↑↓ navegar · Enter abrir · Esc cerrar</span>
            <span>/ enfocar</span>
          </div>
        </div>
      )}
    </div>
  );
}
