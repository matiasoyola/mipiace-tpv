// Layout reutilizable de las pantallas autenticadas del admin (B2 §4,
// ampliado en B3 con drawer móvil + activación de Dispositivos /
// Cajeros / Seguridad + modal de confirmación al cerrar sesión en
// todos los dispositivos).

import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  Building2,
  Calculator,
  Gift,
  KeyRound,
  Menu,
  Package,
  Settings,
  Shield,
  User,
  Users,
  X,
} from "lucide-react";

import { api, ApiError, readCurrentRole } from "./api.js";

import { LogoutEverywhereModal } from "./components/LogoutEverywhereModal.js";
import { Logo } from "./Logo.js";
import { clearTokens } from "./api.js";

interface NavItem {
  to: string;
  label: string;
  icon: typeof User;
  disabled?: boolean;
  // Si está presente, se pinta un punto rojo en la nav cuando el badge
  // sea > 0. Se usa en B5 para la bandeja de tickets `SYNC_FAILED`.
  badge?: "syncErrors";
  // B6 §1: si está restringido a OWNER, el MANAGER no ve el ítem en su
  // sidebar. Las páginas restringidas también validan el rol en cliente,
  // pero ocultarlo del sidebar evita confusión.
  ownerOnly?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  // B5 activa Holded como sección "Sync errors". B6 añade Ajustes y
  // Tickets regalo. "Ajustes" sólo lo ve el OWNER (es donde edita los
  // flags del tenant); "Tickets regalo" lo ven ambos.
  { to: "/admin/stores", label: "Tiendas", icon: Building2 },
  { to: "/admin/devices", label: "Dispositivos", icon: Calculator },
  { to: "/admin/cashiers", label: "Cajeros", icon: Users },
  { to: "/admin/products", label: "Productos", icon: Package },
  { to: "/admin/gift-receipts", label: "Tickets regalo", icon: Gift },
  { to: "/admin/account", label: "Mi cuenta", icon: User },
  { to: "/admin/security", label: "Seguridad", icon: Shield },
  { to: "/admin/tickets-errors", label: "Holded", icon: KeyRound, badge: "syncErrors" },
  { to: "/admin/settings", label: "Ajustes", icon: Settings, ownerOnly: true },
];

// Hook compartido entre desktop sidebar y mobile drawer: pollea el
// contador de tickets con error cada 60s mientras la pestaña esté
// abierta. Silencioso a errores 401 (se gestionan en api.ts).
function useSyncErrorsCount(): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let cancelled = false;
    async function tick() {
      try {
        const res = await api<{ items: unknown[]; pendingCount: number }>(
          "/admin/tickets/sync-errors?limit=1",
        );
        if (!cancelled) setCount(res.pendingCount ?? 0);
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return;
        // Silencio el resto: si el backend está mal, el badge no se mueve.
      }
      if (!cancelled) setTimeout(tick, 60_000);
    }
    tick();
    return () => {
      cancelled = true;
    };
  }, []);
  return count;
}

export function AdminShell({
  title,
  children,
  initials,
}: {
  title: string;
  children: React.ReactNode;
  initials?: string;
}) {
  const navigate = useNavigate();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [logoutAllOpen, setLogoutAllOpen] = useState(false);

  function onLogout() {
    clearTokens();
    navigate("/login", { replace: true });
  }

  return (
    <div className="min-h-screen bg-mipiace-stone flex font-sans">
      <DesktopSidebar onAskLogoutAll={() => setLogoutAllOpen(true)} />

      {drawerOpen && (
        <MobileDrawer
          onClose={() => setDrawerOpen(false)}
          onAskLogoutAll={() => {
            setDrawerOpen(false);
            setLogoutAllOpen(true);
          }}
        />
      )}

      <main className="flex-1 min-w-0 overflow-y-auto">
        <header className="h-[72px] border-b border-slate-200 bg-white flex items-center px-4 md:px-8 sticky top-0 z-10 gap-3">
          <button
            onClick={() => setDrawerOpen(true)}
            className="md:hidden h-10 w-10 rounded-xl hover:bg-slate-50 text-slate-600 flex items-center justify-center"
            aria-label="Abrir menú"
          >
            <Menu className="w-5 h-5" strokeWidth={2.1} />
          </button>
          <h1 className="text-[18px] md:text-[20px] font-semibold text-mipiace-ink tracking-tight">
            {title}
          </h1>
          <div className="ml-auto flex items-center gap-2.5">
            <button
              onClick={onLogout}
              className="h-9 px-3 rounded-lg hover:bg-slate-50 text-[13px] text-slate-600 font-medium"
            >
              Cerrar sesión
            </button>
            <span className="h-9 w-9 rounded-lg bg-mipiace-ink text-white text-[12.5px] font-medium flex items-center justify-center">
              {(initials ?? "MO").slice(0, 2).toUpperCase()}
            </span>
          </div>
        </header>
        <div className="p-5 md:p-8 max-w-3xl">{children}</div>
      </main>

      <LogoutEverywhereModal
        open={logoutAllOpen}
        onClose={() => setLogoutAllOpen(false)}
      />
    </div>
  );
}

function DesktopSidebar({ onAskLogoutAll }: { onAskLogoutAll: () => void }) {
  const location = useLocation();
  return (
    <aside className="hidden md:flex w-[240px] shrink-0 border-r border-slate-200 bg-white flex-col px-5 py-6">
      <div className="mb-8">
        <Logo />
      </div>
      <NavList currentPath={location.pathname} />
      <button
        onClick={onAskLogoutAll}
        className="mt-auto text-[12px] text-slate-400 hover:text-mipiace-coral-dark font-medium text-left px-4 py-2"
      >
        Cerrar sesión en todos los dispositivos
      </button>
    </aside>
  );
}

function MobileDrawer({
  onClose,
  onAskLogoutAll,
}: {
  onClose: () => void;
  onAskLogoutAll: () => void;
}) {
  const location = useLocation();
  return (
    <div
      className="fixed inset-0 z-40 md:hidden"
      role="dialog"
      aria-modal="true"
    >
      <div
        className="absolute inset-0 bg-mipiace-ink/40 animate-in fade-in"
        onClick={onClose}
      />
      <aside className="absolute inset-y-0 left-0 w-[260px] bg-white border-r border-slate-200 flex flex-col px-5 py-6 shadow-xl animate-in slide-in-from-left">
        <div className="flex items-center justify-between mb-8">
          <Logo />
          <button
            onClick={onClose}
            className="h-9 w-9 rounded-xl hover:bg-slate-50 text-slate-500 flex items-center justify-center"
            aria-label="Cerrar menú"
          >
            <X className="w-4 h-4" strokeWidth={2.25} />
          </button>
        </div>
        <NavList currentPath={location.pathname} onNavigate={onClose} />
        <button
          onClick={onAskLogoutAll}
          className="mt-auto text-[12.5px] text-slate-400 hover:text-mipiace-coral-dark font-medium text-left px-4 py-2"
        >
          Cerrar sesión en todos los dispositivos
        </button>
      </aside>
    </div>
  );
}

function NavList({
  currentPath,
  onNavigate,
}: {
  currentPath: string;
  onNavigate?: () => void;
}) {
  const syncErrorsCount = useSyncErrorsCount();
  const role = readCurrentRole();
  const visibleItems = NAV_ITEMS.filter((item) =>
    item.ownerOnly ? role === "OWNER" : true,
  );
  return (
    <nav className="space-y-1.5">
      {visibleItems.map((item) => {
        const Icon = item.icon;
        const active = currentPath.startsWith(item.to);
        const base =
          "w-full h-11 flex items-center gap-3 px-4 rounded-xl text-[14px] font-medium transition-colors";
        if (item.disabled) {
          return (
            <button
              key={item.label}
              disabled
              title="Disponible en bloques posteriores"
              className={`${base} text-slate-300 cursor-not-allowed`}
            >
              <Icon className="w-[17px] h-[17px] text-slate-300" strokeWidth={2.1} />
              <span>{item.label}</span>
            </button>
          );
        }
        const badgeCount = item.badge === "syncErrors" ? syncErrorsCount : 0;
        return (
          <Link
            key={item.label}
            to={item.to}
            onClick={onNavigate}
            className={
              active
                ? `${base} bg-mipiace-coral-soft text-mipiace-coral-dark`
                : `${base} text-slate-600 hover:bg-slate-50 hover:text-mipiace-ink`
            }
          >
            <Icon
              className={
                active
                  ? "w-[17px] h-[17px] text-mipiace-coral"
                  : "w-[17px] h-[17px] text-slate-500"
              }
              strokeWidth={2.1}
            />
            <span>{item.label}</span>
            {badgeCount > 0 && (
              <span
                aria-label={`${badgeCount} pendiente${badgeCount === 1 ? "" : "s"}`}
                className="ml-auto inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[11px] font-medium tabular-nums"
              >
                {badgeCount > 99 ? "99+" : badgeCount}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
