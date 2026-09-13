// Layout reutilizable de las pantallas autenticadas del admin (B2 §4,
// ampliado en B3 con drawer móvil + activación de Dispositivos /
// Cajeros / Seguridad + modal de confirmación al cerrar sesión en
// todos los dispositivos).

import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  Building2,
  Calculator,
  CalendarClock,
  Gift,
  KeyRound,
  Menu,
  Package,
  Printer,
  RefreshCw,
  ScanBarcode,
  Settings,
  Shield,
  Tag,
  User,
  UserPlus,
  Users,
  X,
} from "lucide-react";

import { api, ApiError, readCurrentRole, readImpersonationState } from "./api.js";

import { ImpersonationBanner } from "./components/ImpersonationBanner.js";
import { LogoutEverywhereModal } from "./components/LogoutEverywhereModal.js";
import { Logo } from "./Logo.js";
import { PRODUCT_VERSION, readBuildHash } from "./version.js";
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
  // B-OnboardingV2 (Frente 7): secciones que dejaron de pertenecer al
  // propietario y pasaron al equipo mipiacetpv (super-admin). Se ocultan
  // del sidebar para OWNER/MANAGER. Las rutas backend siguen activas
  // para impersonation read-only del super-admin; ningún usuario
  // per-tenant las verá en su admin.
  superAdminOnly?: boolean;
  // B-reservas-2 (ADR-R6): la entrada sólo se muestra si el tenant tiene la
  // capability activada. H1 añade "caja" (`Tenant.cajaEnabled`) junto a la
  // "agenda" que traía B-reservas-2. Los flags se leen una vez desde
  // /admin/tenant/settings; mientras cargan, las entradas con capability
  // permanecen ocultas para no parpadear.
  //
  // Esconder NO es gatear: cada una de estas secciones tiene además su
  // puerta de servidor (`lib/caja-gate.ts`). Esto es sólo para que el
  // propietario de un colegio no vea "Comanderas" en su barra lateral.
  capability?: "agenda" | "caja" | "holded";
}

const NAV_ITEMS: NavItem[] = [
  // B5 activa Holded como sección "Sync errors". B6 añade Ajustes y
  // Tickets regalo. B-OnboardingV2 quita del OWNER las secciones
  // técnicas: la gestión de Holded, los dispositivos, los ajustes
  // técnicos y la bandeja de errores de sync ahora son responsabilidad
  // del equipo mipiacetpv (super-admin). El OWNER mantiene la operativa
  // de negocio: tiendas, cajeros, tickets regalo, su cuenta, seguridad.
  // H1 · "Tiendas" NO lleva `capability: "caja"`: la ficha fiscal del
  // local (razón social, dirección) vale para cualquier empresa. Lo que
  // cuelga de la caja dentro de la tienda —cajas registradoras, mesas,
  // entrega de ticket— se esconde dentro de la propia pantalla.
  { to: "/admin/stores", label: "Tiendas", icon: Building2 },
  // v1.3-piloto-feedback · Lote 1: Dispositivos era visible sólo a
  // super-admin por un error histórico — el backend del endpoint de
  // pairing codes ya acepta OWNER/MANAGER. Lo abrimos al OWNER y al
  // MANAGER para que generen el pairing sin escalar a soporte.
  { to: "/admin/devices", label: "Dispositivos", icon: Calculator, capability: "caja" },
  // v1.4-Impresoras-Fase-1 Lote 1: gestor de impresoras térmicas
  // (USB / WIFI) por register. OWNER + MANAGER pueden tocarlo
  // porque es operativa diaria (cambiar IP del router, etc.).
  { to: "/admin/printers", label: "Impresoras", icon: Printer, capability: "caja" },
  { to: "/admin/cashiers", label: "Cajeros", icon: Users, capability: "caja" },
  // B-reservas-3: panel de personal (profesionales + skills + turnos) de la
  // agenda. Sólo visible con la capability `agenda` activada (misma puerta
  // que el catálogo de agenda); la página además se auto-gatea.
  {
    to: "/admin/staff",
    label: "Personal",
    icon: CalendarClock,
    capability: "agenda",
  },
  // v1.0-pilotos · Lote 6 (#22): importador de clientes desde Excel/CSV.
  // OWNER-only — crea contactos en Holded, que es la fuente de verdad.
  // H1 · el importador crea contactos EN HOLDED, que es la fuente de
  // verdad. Sin Holded no tiene destino: el endpoint aborta y el
  // propietario se queda mirando un error. Se esconde.
  { to: "/admin/contacts-import", label: "Importar clientes", icon: UserPlus, ownerOnly: true, capability: "holded" },
  // catalogo-local · el CRUD del catálogo propio. Es "dónde están mis
  // productos" para cualquier comercio con caja, tenga Holded o no: con
  // Holded se listan en sólo lectura, sin Holded se dan de alta aquí.
  { to: "/admin/catalog", label: "Catálogo", icon: Package, capability: "caja" },
  // catalogo-local · esta entrada se llamaba "Productos" y llevaba a la
  // bandeja de SKUs que Holded silenció. Dos cambios y ninguno toca la
  // pantalla por dentro:
  //
  //   · **El nombre.** Con "Catálogo" al lado, "Productos" era ambiguo:
  //     dos etiquetas que significan lo mismo para cualquiera que no
  //     haya escrito el código. "Revisión de SKU" dice lo que es, y
  //     coincide con el título que ya se lee al entrar ("Productos
  //     pendientes de SKU").
  //   · **La capability pasa de `caja` a `holded`.** La bandeja existe
  //     porque el auto-SKU subió un SKU a Holded y Holded lo descartó en
  //     silencio (ADR-010). Sin Holded no puede tener ni una fila, y su
  //     texto entero habla de Holded. Enseñarle al comercio de catálogo
  //     local una sección permanentemente vacía que le habla de un ERP
  //     que no usa es justo lo que H1 vino a quitar del panel.
  { to: "/admin/products", label: "Revisión de SKU", icon: ScanBarcode, capability: "holded" },
  // B-reservas-2: catálogo de agenda (duración/pausas/canales + recursos).
  // Sólo visible si el tenant tiene la capability `agenda` activada.
  {
    to: "/admin/agenda-catalog",
    label: "Agenda · Catálogo",
    icon: CalendarClock,
    capability: "agenda",
  },
  // B-reservas-7a: el horario del centro, los días especiales y la
  // retícula. Misma puerta que el resto del módulo (`agendaEnabled`); la
  // página además se auto-gatea.
  {
    to: "/admin/agenda-hours",
    label: "Agenda · Horario",
    icon: CalendarClock,
    capability: "agenda",
  },
  // v1.3-Operativa-Extra · Lote 1: editor de aliases de tags. Visible
  // a OWNER y MANAGER porque la operativa (renombrar categorías) es de
  // negocio, no técnica.
  { to: "/admin/tag-aliases", label: "Etiquetas", icon: Tag, capability: "caja" },
  // v1.4-Bar-Operativa-MVP Lote 2: mapa tag → sección de cocina/barra.
  // Sólo lo usan los tenants HOSPITALITY; en otros verticales queda
  // visible pero vacío sin perjudicar la operativa.
  { to: "/admin/tag-sections", label: "Comanderas", icon: Printer, capability: "caja" },
  // v1.3-Operativa-Extra · Lote 2: panel para que el OWNER fuerce sync
  // con Holded sin pasar por super-admin.
  { to: "/admin/holded", label: "Sync Holded", icon: RefreshCw, capability: "caja" },
  { to: "/admin/gift-receipts", label: "Tickets regalo", icon: Gift, capability: "caja" },
  { to: "/admin/account", label: "Mi cuenta", icon: User },
  { to: "/admin/security", label: "Seguridad", icon: Shield },
  { to: "/admin/tickets-errors", label: "Holded", icon: KeyRound, badge: "syncErrors", superAdminOnly: true, capability: "caja" },
  { to: "/admin/settings", label: "Ajustes", icon: Settings, superAdminOnly: true, capability: "caja" },
];

// v1.5-consistencia-B §3.b: salud de la integración Holded para el
// banner grande del admin. Pollea /catalog/sync-status cada 60s; sólo
// nos interesa el caso `blocked` (sin API key o >48h sin sync) — el
// propietario tiene que enterarse aunque el TPV siga operando.
interface HoldedHealth {
  level: "ok" | "warning" | "blocked";
  reason: string;
  lastSyncAgeMs: number | null;
}

function useHoldedHealth(enabled = true): HoldedHealth | null {
  const [health, setHealth] = useState<HoldedHealth | null>(null);
  useEffect(() => {
    // H1 · ver `HoldedHealthBanner`.
    if (!enabled) return;
    let cancelled = false;
    async function tick() {
      try {
        const res = await api<{ health?: HoldedHealth }>("/catalog/sync-status");
        if (!cancelled) setHealth(res.health ?? null);
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return;
        // Silencio el resto — el banner simplemente no se pinta.
      }
      if (!cancelled) setTimeout(tick, 60_000);
    }
    tick();
    return () => {
      cancelled = true;
    };
  }, [enabled]);
  return health;
}

// Banner a ancho completo, imposible de pasar por alto (§3.b: "el admin
// debe mostrarlo en grande"). Sólo nivel blocked; el warning de 24h ya
// lo cubre el TPV.
// H1 · el banner rojo "Holded está desconectado" es una ALARMA para
// quien depende de Holded. En una empresa que nunca lo tuvo no es una
// alarma, es una mentira: `getTenantHealthStatus` devuelve
// `blocked / no_api_key` en cuanto no hay clave, y el colegio lo vería
// a ancho completo, en rojo y para siempre.
//
// El gate es `cajaEnabled`: sin caja no hay tickets que subir, así que
// no hay nada que Holded pueda estar dejando de recibir. La empresa CON
// caja y sin clave sí lo sigue viendo — ésa es exactamente la que tiene
// un problema.
function HoldedHealthBanner({ cajaEnabled }: { cajaEnabled: boolean }) {
  const health = useHoldedHealth(cajaEnabled);
  if (!cajaEnabled) return null;
  if (!health || health.level !== "blocked") return null;
  const noKey = health.reason === "no_api_key";
  const hours = health.lastSyncAgeMs
    ? Math.round(health.lastSyncAgeMs / 3_600_000)
    : null;
  return (
    <div
      role="alert"
      className="bg-red-600 text-white px-4 md:px-8 py-4 text-[15px] md:text-[16px] font-medium flex items-start gap-3"
    >
      <span aria-hidden className="text-[20px] leading-none mt-0.5">⚠</span>
      <span>
        {noKey ? (
          <>
            <strong>Holded está desconectado.</strong> El TPV sigue cobrando y
            guarda los tickets, pero NO se están subiendo a Holded. Reconecta
            la API Key (o avisa a soporte) cuanto antes: al reconectar, los
            tickets pendientes se subirán solos.
          </>
        ) : (
          <>
            <strong>
              Sin conexión con Holded desde hace {hours ?? "+48"} h.
            </strong>{" "}
            El TPV sigue operando y los tickets se guardan; se subirán solos
            al recuperar la conexión. Si persiste, contacta soporte.
          </>
        )}
      </span>
    </div>
  );
}

// Hook compartido entre desktop sidebar y mobile drawer: pollea el
// contador de tickets con error cada 60s mientras la pestaña esté
// abierta. Silencioso a errores 401 (se gestionan en api.ts).
function useSyncErrorsCount(enabled = true): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    // H1 · sin caja no hay tickets, así que no hay errores de sync que
    // contar. Además la ruta devuelve 403 CAJA_DISABLED: pollearla cada
    // 60 s sería ruido en los logs y un badge que nunca se mueve.
    if (!enabled) return;
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
  }, [enabled]);
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
  // H1 · `null` mientras carga. El banner no se pinta hasta saberlo: es
  // una alarma, y una alarma que parpadea mientras carga es peor que una
  // alarma que tarda medio segundo. Ojo, aquí `=== true` y no
  // `!== false` (ver `useSyncErrorsCount`): pollear antes de saber si hay
  // caja dispara un 403 por nada.
  const shellCaps = useTenantCapabilities();

  function onLogout() {
    clearTokens();
    navigate("/login", { replace: true });
  }

  const impersonating = readImpersonationState() != null;

  return (
    <div className="min-h-screen bg-mipiace-stone flex flex-col font-sans">
      {impersonating && <ImpersonationBanner />}
      <HoldedHealthBanner cajaEnabled={shellCaps?.caja === true} />
      <div className="flex flex-1 min-h-0">
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
      <VersionFooter />
    </aside>
  );
}

// v1.0-pilotos · Lote 7: versión de producto visible. Misma constante
// que /version.json (src/version.ts).
function VersionFooter() {
  const hash = readBuildHash();
  return (
    <div className="px-4 pt-2 text-[11px] text-slate-300 tabular-nums select-all">
      mipiacetpv {PRODUCT_VERSION}
      {hash ? ` · ${hash.slice(0, 7)}` : ""}
    </div>
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
        <VersionFooter />
      </aside>
    </div>
  );
}

// B-reservas-2, generalizado por H1: lee las capabilities del tenant una
// vez para gatear las entradas del sidebar. `null` mientras carga → las
// entradas con capability quedan ocultas hasta saber el valor real.
//
// Los defaults al fallar reproducen master: agenda apagada (era `false`
// antes del bloque) y caja ENCENDIDA, porque `caja_enabled` es
// `@default(true)` y esconderle la caja a quien cobra por un error de red
// sería el peor fallo posible. Mismo criterio que `lib/caja-gate.ts`.
interface TenantCapabilities {
  caja: boolean;
  agenda: boolean;
  // H1 · no es una columna: es "tiene clave de Holded", que sale de
  // `/auth/me`. Se trata igual que las otras para gatear el sidebar.
  holded: boolean;
}

function useTenantCapabilities(): TenantCapabilities | null {
  const [caps, setCaps] = useState<TenantCapabilities | null>(null);
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api<{ settings: { agendaEnabled?: boolean; cajaEnabled?: boolean } }>(
        "/admin/tenant/settings",
      ),
      api<{ tenant: { hasHoldedKey?: boolean } }>("/auth/me"),
    ])
      .then(([s, me]) => {
        if (cancelled) return;
        setCaps({
          agenda: s.settings.agendaEnabled ?? false,
          caja: s.settings.cajaEnabled !== false,
          holded: me.tenant.hasHoldedKey === true,
        });
      })
      .catch(() => {
        if (!cancelled) setCaps({ agenda: false, caja: true, holded: true });
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return caps;
}

function NavList({
  currentPath,
  onNavigate,
}: {
  currentPath: string;
  onNavigate?: () => void;
}) {
  const caps = useTenantCapabilities();
  // H1 · `=== true`, no `!== false`: mientras `caps` es null NO sabemos si
  // hay caja, y pollear "por si acaso" dispara un 403 antes de tener la
  // respuesta. Cuando el flag llega, el efecto vuelve a correr.
  const syncErrorsCount = useSyncErrorsCount(caps?.caja === true);
  const role = readCurrentRole();
  const impersonating = readImpersonationState() != null;
  const visibleItems = NAV_ITEMS.filter((item) => {
    if (item.superAdminOnly && !impersonating) return false;
    if (item.ownerOnly && role !== "OWNER") return false;
    // H1 · las capabilities se evalúan DESPUÉS de rol e impersonación, y
    // se combinan en vez de excluirse: la bandeja "Holded" es a la vez
    // `superAdminOnly` y de caja, y antes el primer `return` se comía la
    // segunda condición.
    if (item.capability === "agenda") return caps?.agenda === true;
    if (item.capability === "caja") return caps?.caja === true;
    if (item.capability === "holded") return caps?.holded === true;
    return true;
  });
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
