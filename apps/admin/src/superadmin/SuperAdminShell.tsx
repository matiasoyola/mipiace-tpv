// Shell de la consola super-admin. Independiente del shell per-tenant:
// sidebar propio, nada de las navs operativas. Visualmente distinta
// para que sea obvio en qué pantalla estás.

import { useNavigate, Link, useLocation } from "react-router-dom";
import { Building2, FileClock, Shield, ShieldAlert } from "lucide-react";

import { clearSuperAdminTokens } from "./api.js";

interface NavItem {
  to: string;
  label: string;
  icon: typeof Building2;
}

const NAV_ITEMS: NavItem[] = [
  { to: "/superadmin/tenants", label: "Tenants", icon: Building2 },
  { to: "/superadmin/audit", label: "Auditoría", icon: FileClock },
  { to: "/superadmin/me", label: "Mi cuenta", icon: Shield },
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
        <button
          onClick={onLogout}
          className="mt-auto text-[12px] text-slate-400 hover:text-amber-400 font-medium text-left px-3 py-2"
        >
          Cerrar sesión
        </button>
      </aside>

      <main className="flex-1 min-w-0 overflow-y-auto">
        <header className="h-[64px] border-b border-slate-200 bg-white flex items-center px-8 sticky top-0 z-10">
          <h1 className="text-[19px] font-semibold text-slate-900 tracking-tight">
            {title}
          </h1>
        </header>
        <div className="p-8">{children}</div>
      </main>
    </div>
  );
}
