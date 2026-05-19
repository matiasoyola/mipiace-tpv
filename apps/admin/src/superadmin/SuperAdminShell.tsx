// Shell de la consola super-admin. Independiente del shell per-tenant:
// sidebar propio, nada de las navs operativas. Visualmente distinta
// para que sea obvio en qué pantalla estás.

import { useNavigate, Link, useLocation } from "react-router-dom";
import {
  Activity,
  Building2,
  ExternalLink,
  FileClock,
  Home,
  Shield,
  ShieldAlert,
  ShoppingCart,
} from "lucide-react";

import { clearSuperAdminTokens } from "./api.js";
import { CuentaSelector } from "./CuentaSelector.js";

interface NavItem {
  to: string;
  label: string;
  icon: typeof Building2;
}

const NAV_ITEMS: NavItem[] = [
  { to: "/superadmin/tenants", label: "Cuentas", icon: Building2 },
  { to: "/superadmin/audit", label: "Auditoría", icon: FileClock },
  { to: "/superadmin/me", label: "Mi cuenta", icon: Shield },
];

// B-SuperAdmin-Shortcuts: atajos a otras URLs del proyecto. Abren en
// pestaña nueva (no rompemos la sesión super-admin actual). Las URLs
// son inyectadas en build por Vite desde `infra/Dockerfile`:
//   VITE_TPV_URL  → PWA pública del TPV
//   VITE_API_URL  → backend Fastify directo
// Defaults defensivos por si la build no las define (dev local).
const TPV_URL = (import.meta.env.VITE_TPV_URL as string | undefined) ?? "/";
const API_URL =
  (import.meta.env.VITE_API_URL as string | undefined) ?? "/api";

interface ExternalLinkItem {
  href: string;
  label: string;
  icon: typeof Building2;
  hint: string;
}

const EXTERNAL_LINKS: ExternalLinkItem[] = [
  {
    href: "/",
    label: "Admin (login)",
    icon: Home,
    hint: "Login per-tenant en este mismo dominio",
  },
  {
    href: TPV_URL,
    label: "TPV público",
    icon: ShoppingCart,
    hint: "PWA del TPV — abrir para inspección o pruebas",
  },
  {
    href: `${API_URL.replace(/\/$/, "")}/health`,
    label: "API health",
    icon: Activity,
    hint: "Ping al backend directo · debe devolver 200",
  },
];

export function SuperAdminShell({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  const navigate = useNavigate();
  const location = useLocation();

  function onLogout() {
    clearSuperAdminTokens();
    navigate("/superadmin/login", { replace: true });
  }

  return (
    <div className="min-h-screen bg-slate-50 flex font-sans">
      <aside className="w-[240px] shrink-0 border-r border-slate-200 bg-slate-900 text-slate-100 flex flex-col px-5 py-6">
        <div className="mb-8 flex items-center gap-2">
          <ShieldAlert className="w-5 h-5 text-amber-400" />
          <span className="font-semibold text-[15px] tracking-tight">
            Super-admin
          </span>
        </div>
        <nav className="space-y-1">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = location.pathname.startsWith(item.to);
            return (
              <Link
                key={item.label}
                to={item.to}
                className={
                  "w-full h-10 flex items-center gap-3 px-3 rounded-lg text-[13.5px] transition-colors " +
                  (active
                    ? "bg-slate-800 text-white"
                    : "text-slate-300 hover:bg-slate-800 hover:text-white")
                }
              >
                <Icon className="w-[16px] h-[16px]" strokeWidth={2} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* B-SuperAdmin-Shortcuts: separador + bloque de enlaces externos.
            Visualmente atenuado para no competir con la nav principal. */}
        <div className="mt-6 pt-4 border-t border-slate-800">
          <div className="px-3 mb-2 text-[10.5px] uppercase tracking-wider text-slate-500 font-semibold">
            Enlaces externos
          </div>
          <div className="space-y-1">
            {EXTERNAL_LINKS.map((item) => {
              const Icon = item.icon;
              return (
                <a
                  key={item.label}
                  href={item.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={item.hint}
                  className="w-full h-9 flex items-center gap-3 px-3 rounded-lg text-[13px] text-slate-400 hover:bg-slate-800 hover:text-white transition-colors group"
                >
                  <Icon className="w-[15px] h-[15px]" strokeWidth={2} />
                  <span className="flex-1">{item.label}</span>
                  <ExternalLink
                    className="w-[12px] h-[12px] opacity-0 group-hover:opacity-60"
                    strokeWidth={2}
                  />
                </a>
              );
            })}
          </div>
        </div>

        <button
          onClick={onLogout}
          className="mt-auto text-[12px] text-slate-400 hover:text-amber-400 font-medium text-left px-3 py-2"
        >
          Cerrar sesión
        </button>
      </aside>

      <main className="flex-1 min-w-0 overflow-y-auto">
        {/* B-Multi-Vertical SB5: header bar con selector global. La
            cabecera con el title de cada página queda debajo — el
            selector es navegacional, el título contextual. */}
        <div className="h-[52px] border-b border-slate-200 bg-white flex items-center px-8 sticky top-0 z-20">
          <CuentaSelector />
        </div>
        <header className="h-[64px] border-b border-slate-200 bg-white flex items-center px-8 sticky top-[52px] z-10">
          <h1 className="text-[19px] font-semibold text-slate-900 tracking-tight">
            {title}
          </h1>
        </header>
        <div className="p-8">{children}</div>
      </main>
    </div>
  );
}
