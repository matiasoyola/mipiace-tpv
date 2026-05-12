// Layout reutilizable de las pantallas autenticadas del admin (B2 §4).
// Sigue el mockup pantalla 9 de docs/design/reference-app.tsx:
// sidebar 240px + header 72px + main scrollable.

import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  Building2,
  Calculator,
  KeyRound,
  Package,
  Shield,
  User,
  Users,
} from "lucide-react";

import { Logo } from "./Logo.js";
import { api, clearTokens } from "./api.js";

interface NavItem {
  to: string;
  label: string;
  icon: typeof User;
  disabled?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  // En B2 sólo "Mi cuenta" y "Productos" (bandeja SKU) están vivos.
  // El resto aparece grisado para que el propietario sepa qué viene
  // en B3+.
  { to: "/admin/stores", label: "Tiendas", icon: Building2, disabled: true },
  { to: "/admin/devices", label: "Dispositivos", icon: Calculator, disabled: true },
  { to: "/admin/cashiers", label: "Cajeros", icon: Users, disabled: true },
  { to: "/admin/products", label: "Productos", icon: Package },
  { to: "/admin/account", label: "Mi cuenta", icon: User },
  { to: "/admin/security", label: "Seguridad", icon: Shield, disabled: true },
  { to: "/admin/holded", label: "Holded", icon: KeyRound, disabled: true },
];

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
  const location = useLocation();

  async function onLogout() {
    clearTokens();
    navigate("/login", { replace: true });
  }

  async function onLogoutEverywhere() {
    try {
      await api("/auth/logout-everywhere", { method: "POST", body: {} });
    } catch {
      // Aunque falle el backend, limpiamos local. El siguiente refresh
      // fallará y la sesión queda cerrada.
    }
    clearTokens();
    navigate("/login", { replace: true });
  }

  return (
    <div className="min-h-screen bg-mipiace-stone flex font-sans">
      <aside className="hidden md:flex w-[240px] shrink-0 border-r border-slate-200 bg-white flex-col px-5 py-6">
        <div className="mb-8">
          <Logo />
        </div>
        <nav className="space-y-1.5">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = location.pathname.startsWith(item.to);
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
            return (
              <Link
                key={item.label}
                to={item.to}
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
              </Link>
            );
          })}
        </nav>
        <button
          onClick={onLogoutEverywhere}
          className="mt-auto text-[12px] text-slate-400 hover:text-mipiace-coral-dark font-medium text-left px-4 py-2"
        >
          Cerrar sesión en todos los dispositivos
        </button>
      </aside>
      <main className="flex-1 min-w-0 overflow-y-auto">
        <header className="h-[72px] border-b border-slate-200 bg-white flex items-center px-5 md:px-8 sticky top-0 z-10">
          <h1 className="text-[20px] font-semibold text-mipiace-ink tracking-tight">{title}</h1>
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
    </div>
  );
}
