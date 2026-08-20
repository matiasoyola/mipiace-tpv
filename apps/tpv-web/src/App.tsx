// Orquestador de estados del TPV en B3:
//   1. unpaired → PairScreen
//   2. paired + no session → PinScreen
//   3. session + shift del día anterior → ShiftResumeScreen
//   4. session + needsShiftOpen → tarjeta del día (si la hay) → ShiftOpenScreen
//   5. session + reanudar → TpvHome (venta)
//
// v1.11-cierre-de-dia · el paso 3 dejó de ser un muro: "Reanudar turno" es
// la acción primaria y el cajero puede vender antes de arquear. Y el paso 4
// enseña el resumen del día cerrado —lo cerrase una persona o el corte de
// día— antes de pedir el fondo de caja del turno nuevo.

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import {
  apiWithCashier,
  apiWithDevice,
  ApiError,
  registerSessionExpiredHandler,
} from "./api.js";
import { ReloginPinModal } from "./components/ReloginPinModal.js";
import { TestModeBanner } from "./components/TestModeBanner.js";
import { useDeviceBootstrap } from "./hooks/useDeviceBootstrap.js";
import { useInactivityLogout } from "./hooks/useInactivityLogout.js";
import { getCachedBusinessType } from "./lib/catalog.js";
import {
  flushOutbox,
  registerLocalShiftLookup,
  registerShiftResolvedCallback,
  startOutboxSync,
} from "./lib/outbox.js";
import { refreshOfflineBundle } from "./lib/offlineSession.js";
import {
  clearLocalShift,
  localShiftIdForOutbox,
  mirrorServerShift,
  resolveLocalShift,
} from "./lib/offlineShift.js";
import {
  mapServerDraftLines,
  tableErrorMessage,
  type ServerDraft,
} from "./lib/tableDraft.js";
import type { CartLine } from "./lib/cart.js";
import {
  ackDaySummary,
  fetchPendingDaySummary,
  type ShiftDaySummary,
} from "./lib/shiftSummary.js";
import { clearTestMode, isTestModeActive } from "./lib/test-mode.js";
import { startVisualViewportSync } from "./lib/visualViewportSync.js";
import { OutboxChip } from "./pages/CheckoutPage.outboxChip.js";
import { PairScreen } from "./pages/PairScreen.js";
import { PinScreen, type CashierLoginResponse } from "./pages/PinScreen.js";
import { SalePage, type TableContext } from "./pages/SalePage.js";
import { CloseShiftModal } from "./pages/CloseShiftModal.js";
import { DaySummaryCard } from "./pages/DaySummaryCard.js";
import { ShiftResumeScreen } from "./pages/ShiftResumeScreen.js";
import { ShiftOpenScreen } from "./pages/ShiftOpenScreen.js";
import {
  TableMapScreen,
  type ApiTable,
  type MapNotice,
} from "./pages/TableMapScreen.js";
import {
  cashierDisplayLabel,
  clearCashierSession,
  setCashierSession,
} from "./storage.js";

type CashierUser = CashierLoginResponse["user"] & { sessionTtlMinutes: number };

type CashierState =
  | { kind: "needsLogin" }
  | { kind: "needsShiftOpen"; cashier: CashierUser }
  | {
      kind: "forceClose";
      cashier: CashierUser;
      shift: {
        id: string;
        openedAt: string;
        lastActivityAt: string;
        cashOpening: string;
      };
    }
  | {
      kind: "active";
      cashier: CashierUser;
      shift: { id: string; openedAt: string; cashOpening: string };
    };

export function App() {
  const { state, refresh, unpair } = useDeviceBootstrap();
  const [cashier, setCashier] = useState<CashierState>({ kind: "needsLogin" });
  const testMode = isTestModeActive();

  // v1.10-offline-un-terminal: credenciales del login offline, SÓLO en
  // memoria (nunca se persisten). Presente ⇒ la sesión se abrió sin red
  // y todavía no hay JWT real; al volver la conexión renovamos contra el
  // server para obtener el JWT que el outbox necesita.
  const [offlineCreds, setOfflineCreds] = useState<{
    email: string;
    pin: string;
  } | null>(null);

  // v1.0-pilotos · Lote 4 addendum: 401 a mitad de acción → modal de
  // re-login in situ. Mientras haya cajero logueado, apiWithCashier
  // delega aquí; el modal pide el PIN sin desmontar nada (carrito y
  // checkout intactos) y al validar se reintenta la request original.
  const [reloginPrompt, setReloginPrompt] = useState<{
    email: string;
    alias: string | null;
    resolve: (renewed: boolean) => void;
  } | null>(null);
  const cashierEmail =
    cashier.kind !== "needsLogin" ? cashier.cashier.email : null;
  const cashierAlias =
    cashier.kind !== "needsLogin" ? cashier.cashier.alias : null;
  useEffect(() => {
    if (!cashierEmail) {
      registerSessionExpiredHandler(null);
      return;
    }
    registerSessionExpiredHandler(
      () =>
        new Promise<boolean>((resolve) => {
          setReloginPrompt({ email: cashierEmail, alias: cashierAlias, resolve });
        }),
    );
    return () => registerSessionExpiredHandler(null);
  }, [cashierEmail, cashierAlias]);

  // v1.3-hotfix2 · ocultar teclado virtual de Android/iOS al tocar fuera
  // de un input. Por defecto el navegador mantiene el teclado abierto
  // mientras el activeElement sea editable, lo que en tablets táctiles
  // bloquea la mitad inferior del grid del TPV. Cuando el cajero pulsa
  // un producto, un botón del sidebar o cualquier zona no editable,
  // forzamos blur del input activo y el teclado se cierra.
  useEffect(() => {
    function autoBlur(e: PointerEvent) {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const isEditable = target.matches(
        'input, textarea, select, [contenteditable="true"], [contenteditable=""]',
      );
      if (isEditable) return;
      const active = document.activeElement;
      if (
        active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement
      ) {
        active.blur();
      }
    }
    document.addEventListener("pointerdown", autoBlur);
    return () => document.removeEventListener("pointerdown", autoBlur);
  }, []);

  // v1.3-UX-Iteración Lote 2: mantener --keyboard-offset sincronizado
  // con la altura del teclado virtual. Cualquier elemento que necesite
  // permanecer visible cuando abra el teclado (footer del ticket,
  // dropdown de búsqueda) usa `padding-bottom: var(--keyboard-offset)`
  // para empujarse hacia arriba en lugar de quedar oculto.
  useEffect(() => startVisualViewportSync(), []);

  // v1.5-consistencia-C · reenvío del outbox offline: al arrancar, al
  // evento `online` y cada N segundos mientras haya pendientes.
  useEffect(() => startOutboxSync(), []);

  // v1.10-offline-un-terminal §3: el outbox etiqueta/reescribe los items
  // de un turno local a través de estos hooks (evita que outbox importe
  // offlineShift → sin ciclo de dependencias).
  useEffect(() => {
    registerLocalShiftLookup(localShiftIdForOutbox);
    registerShiftResolvedCallback(resolveLocalShift);
    return () => {
      registerLocalShiftLookup(null);
      registerShiftResolvedCallback(null);
    };
  }, []);

  // v1.10-offline-un-terminal §1: en cada arranque online descargamos y
  // cacheamos el paquete offline (roster + config). Best-effort: sin red
  // seguimos con el reflejo local anterior.
  useEffect(() => {
    if (testMode || state.kind !== "paired") return;
    void refreshOfflineBundle().catch(() => {});
  }, [testMode, state.kind]);

  // v1.10-offline-un-terminal §2: al volver la red tras un login offline,
  // renovamos contra /shift/cashier-login (con el PIN retenido en
  // memoria) para obtener el JWT real; entonces el outbox puede subir el
  // turno + ventas. Si la PWA se recarga antes, el PIN se pierde y el
  // cajero vuelve a loguear online con normalidad.
  useEffect(() => {
    if (!offlineCreds) return;
    let stopped = false;
    async function renew() {
      if (stopped || !navigator.onLine) return;
      try {
        const res = await apiWithDevice<CashierLoginResponse>(
          "/shift/cashier-login",
          { method: "POST", body: { email: offlineCreds!.email, pin: offlineCreds!.pin } },
        );
        setCashierSession({
          sessionToken: res.sessionToken,
          sessionTtlMinutes: res.sessionTtlMinutes,
          userId: res.user.id,
          email: res.user.email,
          alias: res.user.alias,
          role: res.user.role,
        });
        setOfflineCreds(null);
        void flushOutbox();
        void refreshOfflineBundle().catch(() => {});
      } catch {
        /* seguimos offline; reintentaremos en el próximo tick/online */
      }
    }
    void renew();
    const onOnline = () => void renew();
    window.addEventListener("online", onOnline);
    const timer = window.setInterval(() => void renew(), 20_000);
    return () => {
      stopped = true;
      window.removeEventListener("online", onOnline);
      window.clearInterval(timer);
    };
  }, [offlineCreds]);

  // En modo prueba, hacemos un bootstrap único contra el backend para
  // obtener user/shift/store/register sin pasar por PinScreen.
  const [testBootstrap, setTestBootstrap] = useState<TestBootstrap | null>(null);
  const [testError, setTestError] = useState<string | null>(null);

  useEffect(() => {
    if (!testMode || testBootstrap) return;
    let cancelled = false;
    apiWithCashier<TestBootstrap>("/shift/cashier-bootstrap")
      .then((res) => {
        if (cancelled) return;
        setTestBootstrap(res);
        if (res.shift) {
          setCashier({
            kind: "active",
            cashier: {
              ...res.user,
              sessionTtlMinutes: res.tenant.cashierAutoLogoutMinutes,
            },
            shift: res.shift,
          });
        } else {
          setCashier({
            kind: "needsShiftOpen",
            cashier: {
              ...res.user,
              sessionTtlMinutes: res.tenant.cashierAutoLogoutMinutes,
            },
          });
        }
      })
      .catch((err) => {
        if (cancelled) return;
        const message =
          err instanceof ApiError ? err.message : "Bootstrap modo prueba falló";
        setTestError(message);
      });
    return () => {
      cancelled = true;
    };
  }, [testMode, testBootstrap]);

  if (testMode) {
    if (testError) {
      return (
        <div className="min-h-screen bg-mipiace-stone">
          <TestModeBanner tenantName={null} />
          <div className="p-8 text-center text-red-700 text-[14px]">
            {testError}
          </div>
        </div>
      );
    }
    if (!testBootstrap) {
      return (
        <div className="min-h-screen flex flex-col bg-mipiace-stone">
          <TestModeBanner tenantName={null} />
          <div className="flex-1 flex items-center justify-center">
            <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
          </div>
        </div>
      );
    }
    return (
      <div className="min-h-screen flex flex-col bg-mipiace-stone">
        <TestModeBanner tenantName={testBootstrap.tenant.name} />
        <div className="flex-1">
          <TestModeTpv
            cashier={cashier}
            setCashier={setCashier}
            bootstrap={testBootstrap}
          />
        </div>
      </div>
    );
  }

  if (state.kind === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-mipiace-stone">
        <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
      </div>
    );
  }
  if (state.kind === "unpaired") {
    return <PairScreen onPaired={refresh} />;
  }

  const { register, store, tenant } = state.data;

  // v1.10-offline: sincroniza el estado de turno LOCAL con lo que dice el
  // login, y guarda las credenciales offline (si aplica) para renovar el
  // JWT al volver la red.
  async function handleLoggedIn(res: CashierLoginResponse) {
    if (!res.offline) {
      // Login online: espejamos el turno del server a local (para que un
      // cierre posterior sin red pueda leer el fondo de caja) o limpiamos
      // el turno local viejo si no hay ninguno abierto.
      if (res.shiftState.kind === "reanudar") {
        await mirrorServerShift(res.shiftState.shift).catch(() => {});
      } else if (res.shiftState.kind === "needsShiftOpen") {
        await clearLocalShift().catch(() => {});
      }
    }
    setOfflineCreds(res.offline && res.pin ? { email: res.user.email, pin: res.pin } : null);
    applyShiftState(res, setCashier);
  }

  if (cashier.kind === "needsLogin") {
    return (
      <PinScreen
        registerName={`${register.name} · ${store.name}`}
        onLoggedIn={(res) => handleLoggedIn(res)}
        onDeviceRevoked={unpair}
      />
    );
  }

  return (
    <LoggedInWrapper
      autoLogoutMinutes={tenant.cashierAutoLogoutMinutes}
      onAutoLogout={() => {
        clearCashierSession();
        setCashier({ kind: "needsLogin" });
      }}
    >
      {reloginPrompt && (
        <ReloginPinModal
          email={reloginPrompt.email}
          alias={reloginPrompt.alias}
          onDone={(renewed) => {
            reloginPrompt.resolve(renewed);
            setReloginPrompt(null);
            if (!renewed) {
              // El cajero canceló: la acción falló con su 401 y
              // volvemos al PinScreen clásico.
              clearCashierSession();
              setCashier({ kind: "needsLogin" });
            }
          }}
        />
      )}
      {cashier.kind === "forceClose" ? (
        <ShiftResumeScreen
          shift={cashier.shift}
          cashierRole={cashier.cashier.role}
          requireCashCountOnClose={tenant.requireCashCountOnClose === true}
          onResumed={(shift) => {
            // v1.11 · reanudar es la acción primaria: a vender, sin arquear.
            void mirrorServerShift(shift).catch(() => {});
            setCashier({ kind: "active", cashier: cashier.cashier, shift });
          }}
          onClosed={() =>
            setCashier({ kind: "needsShiftOpen", cashier: cashier.cashier })
          }
        />
      ) : cashier.kind === "needsShiftOpen" ? (
        <ShiftOpenWithDaySummary
          cashierRole={cashier.cashier.role}
          cashierLabel={cashierDisplayLabel(cashier.cashier)}
          registerName={register.name}
          storeName={store.name}
          offline={offlineCreds !== null}
          onOpened={(shift, openedOffline) => {
            // Turno abierto con red → espejamos a local para que un cierre
            // posterior sin red lea el fondo de caja. Offline: ShiftOpen
            // ya creó el turno local.
            if (!openedOffline) void mirrorServerShift(shift).catch(() => {});
            setCashier({
              kind: "active",
              cashier: cashier.cashier,
              shift,
            });
          }}
          onBack={() => {
            clearCashierSession();
            setCashier({ kind: "needsLogin" });
          }}
        />
      ) : cashier.kind === "active" ? (
        <TpvHome
          cashier={cashier.cashier}
          shiftId={cashier.shift.id}
          registerName={register.name}
          registerId={register.id}
          storeName={store.name}
          onLogoutCashier={async () => {
            try {
              await apiWithCashier("/shift/cashier-logout", { method: "POST", body: {} });
            } catch {
              /* token expira solo */
            }
            clearCashierSession();
            setCashier({ kind: "needsLogin" });
          }}
          onCloseShift={() => {
            setCashier({ kind: "needsShiftOpen", cashier: cashier.cashier });
          }}
        />
      ) : null}
    </LoggedInWrapper>
  );
}

function applyShiftState(
  res: CashierLoginResponse,
  setCashier: (s: CashierState) => void,
) {
  const cashierUser: CashierUser = {
    ...res.user,
    sessionTtlMinutes: res.sessionTtlMinutes,
  };
  if (res.shiftState.kind === "forceClose") {
    setCashier({
      kind: "forceClose",
      cashier: cashierUser,
      shift: res.shiftState.shift,
    });
  } else if (res.shiftState.kind === "needsShiftOpen") {
    setCashier({ kind: "needsShiftOpen", cashier: cashierUser });
  } else {
    setCashier({
      kind: "active",
      cashier: cashierUser,
      shift: res.shiftState.shift,
    });
  }
}

function LoggedInWrapper({
  autoLogoutMinutes,
  onAutoLogout,
  children,
}: {
  autoLogoutMinutes: number;
  onAutoLogout: () => void;
  children: React.ReactNode;
}) {
  useInactivityLogout(true, autoLogoutMinutes, onAutoLogout);
  // v1.5-consistencia-C: el chip de cobros pendientes acompaña a todas
  // las pantallas con cajero logueado (incluido modo prueba).
  return (
    <>
      {children}
      <OutboxChip />
    </>
  );
}

// Cuando hay sesión + turno abierto, el cajero entra al "home" del TPV.
// En modo bar (la tienda tiene al menos una mesa), el home es el mapa
// de sala y la venta rápida se accede con botón superior derecha. En
// modo retail puro (tienda sin mesas), seguimos directos a SalePage
// como en B4-B6 — sin coste para los clientes que no usan bar.
function TpvHome(props: {
  cashier: CashierUser;
  shiftId: string;
  registerName: string;
  registerId: string;
  storeName: string;
  onLogoutCashier: () => void | Promise<void>;
  onCloseShift: () => void;
}) {
  // B-Multi-Vertical SB3: el vertical manda sobre `hasTables`. Si el
  // tenant es RETAIL o SERVICES no entramos al mapa aunque la tienda
  // tenga mesas legacy (Thalia no debería tener, pero defensivo).
  // Sólo HOSPITALITY (o un cliente sin businessType cacheado aún, p.ej.
  // primera sesión post-deploy) pregunta a /tpv/tables.
  const businessType = getCachedBusinessType();
  const skipTables = businessType !== null && businessType !== "HOSPITALITY";
  const [hasTables, setHasTables] = useState<boolean | null>(
    skipTables ? false : null,
  );
  const [view, setView] = useState<
    | { kind: "map" }
    | {
        kind: "sale";
        tableContext: TableContext | null;
        // v1.0-mesas-frontend: proyección inicial del DRAFT server-side
        // (las líneas que ya tenía la mesa al retomarla). null en venta
        // rápida.
        initialTableLines?: CartLine[];
      }
  >(skipTables ? { kind: "sale", tableContext: null } : { kind: "map" });
  // v1.0-mesas-frontend: tocar una mesa abre (o retoma) el DRAFT
  // server-side ANTES de entrar a SalePage — así la mesa aparece
  // ocupada en el mapa de las demás cajas desde el primer toque.
  const [openingTableId, setOpeningTableId] = useState<string | null>(null);
  const [openTableError, setOpenTableError] = useState<string | null>(null);
  // v1.9.2-mesas-concurrencia · Frente 1/2/3: aviso que el mapa muestra
  // cuando el cajero vuelve por una expulsión (mesa cobrada/absorbida
  // desde otra caja) o tras cobrar una mesa desde este dispositivo.
  const [mapNotice, setMapNotice] = useState<MapNotice | null>(null);

  async function pickTable(table: ApiTable): Promise<void> {
    if (openingTableId) return;
    setMapNotice(null);
    setOpeningTableId(table.id);
    setOpenTableError(null);
    try {
      const res = await apiWithCashier<{ ticket: ServerDraft }>(
        `/tables/${table.id}/open`,
        { method: "POST", body: {} },
      );
      setView({
        kind: "sale",
        tableContext: {
          id: table.id,
          name: table.name,
          zone: table.zone,
          capacity: table.capacity,
          diners: res.ticket.diners ?? table.activeTicket?.diners ?? null,
          openedAt: res.ticket.createdAt ?? table.activeTicket?.openedAt ?? null,
          openedByEmail: table.activeTicket?.openedByEmail ?? null,
          openedByAlias: table.activeTicket?.openedByAlias ?? null,
          activeTicketId: res.ticket.id,
        },
        initialTableLines: mapServerDraftLines(res.ticket.lines),
      });
    } catch (err) {
      // 409 TABLE_GROUPED / SHIFT_NOT_OPEN llegan con mensaje en
      // español; un fallo de red es el gate online-only.
      setOpenTableError(tableErrorMessage(err));
    } finally {
      setOpeningTableId(null);
    }
  }

  useEffect(() => {
    if (skipTables) return;
    let cancelled = false;
    apiWithCashier<{ tables: ApiTable[] }>("/tpv/tables")
      .then((res) => {
        if (cancelled) return;
        const any = res.tables.length > 0;
        setHasTables(any);
        if (!any) setView({ kind: "sale", tableContext: null });
      })
      .catch((err) => {
        if (cancelled) return;
        // Si el endpoint falla (offline al arrancar, register sin store
        // accesible), caemos al flujo retail. F7 trata el degradado.
        if (err instanceof ApiError && err.status >= 500) {
          setHasTables(false);
          setView({ kind: "sale", tableContext: null });
        } else {
          setHasTables(false);
          setView({ kind: "sale", tableContext: null });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [skipTables]);

  if (hasTables === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-mipiace-stone">
        <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
      </div>
    );
  }

  if (view.kind === "map") {
    return (
      <TableMapScreen
        cashierLabel={cashierDisplayLabel(props.cashier)}
        storeName={props.storeName}
        registerName={props.registerName}
        registerId={props.registerId}
        shiftId={props.shiftId}
        cashierRole={props.cashier.role}
        notice={mapNotice}
        onPickTable={(table) => void pickTable(table)}
        onQuickSale={() => {
          setMapNotice(null);
          setView({ kind: "sale", tableContext: null });
        }}
        pickBusyTableId={openingTableId}
        pickError={openTableError}
        onLogoutCashier={props.onLogoutCashier}
        onCloseShift={props.onCloseShift}
      />
    );
  }

  return (
    <SalePage
      key={view.tableContext?.id ?? "quick-sale"}
      shiftId={props.shiftId}
      cashierLabel={cashierDisplayLabel(props.cashier)}
      cashierRole={props.cashier.role}
      registerName={props.registerName}
      registerId={props.registerId}
      storeName={props.storeName}
      tableContext={view.tableContext}
      initialTableLines={view.initialTableLines}
      onBackToMap={
        hasTables
          ? () => {
              setMapNotice(null);
              setView({ kind: "map" });
            }
          : null
      }
      // v1.9.2-mesas-concurrencia · salida al mapa CON aviso inline:
      // expulsión por cobro/absorción remota, o confirmación tras
      // cobrar la mesa desde este dispositivo (banner de éxito con
      // "Ver ticket"). Reemplaza el modal "Ticket emitido" en mesa.
      onExitToMap={
        hasTables
          ? (notice) => {
              setMapNotice(notice);
              setView({ kind: "map" });
            }
          : null
      }
      onTicketMovedToTable={
        hasTables
          ? async (newTableId) => {
              // v1.4-Bar-Operativa-MVP Lote 3 · tras un mover-mesa
              // exitoso, recargamos `/tpv/tables` y reconstruimos el
              // tableContext apuntando a la mesa destino (vía pickTable,
              // que además trae las líneas del DRAFT — el SalePage se
              // remonta con key nueva). Si la recarga falla (offline),
              // caemos al mapa: el usuario verá la mesa nueva ya
              // ocupada y podrá tocarla.
              try {
                const res = await apiWithCashier<{ tables: ApiTable[] }>(
                  "/tpv/tables",
                );
                const fresh = res.tables.find((t) => t.id === newTableId);
                if (fresh) {
                  await pickTable(fresh);
                } else {
                  setView({ kind: "map" });
                }
              } catch {
                setView({ kind: "map" });
              }
            }
          : null
      }
      onLogoutCashier={props.onLogoutCashier}
      onCloseShift={props.onCloseShift}
    />
  );
}

// v1.11-cierre-de-dia · antes de pedir el fondo de caja del turno nuevo,
// enseñamos el resumen del día que se acaba de cerrar — lo cerrase una
// persona anoche o el corte de día de madrugada. Es la parte del bloque que
// le devuelve a Sole la información que hasta ahora sólo veía quien cerraba
// desde el menú (addendum, punto 2: el cierre del turno colgado no enseñaba
// NADA, y era el único que ella ejecutaba).
//
// "Confirmar" sella `summaryAckAt` en el server, así que la tarjeta aparece
// UNA vez y no todas las mañanas. Sin red no hay resumen que pedir: se pasa
// derecho a abrir turno, como en v1.10.
function ShiftOpenWithDaySummary({
  cashierRole,
  ...props
}: React.ComponentProps<typeof ShiftOpenScreen> & {
  cashierRole: "MANAGER" | "CASHIER";
}) {
  const [pending, setPending] = useState<ShiftDaySummary | null>(null);
  const [checking, setChecking] = useState(() => navigator.onLine);
  const [acking, setAcking] = useState(false);
  // "Cuadrar caja" sobre un turno que cerró el corte de día: arqueo a
  // posteriori (kind X). Opcional y nunca bloqueante — el cajero puede
  // pulsar Confirmar y abrir caja sin contar nada.
  const [counting, setCounting] = useState(false);

  useEffect(() => {
    if (!navigator.onLine) return;
    let alive = true;
    void fetchPendingDaySummary()
      .then((s) => {
        if (!alive) return;
        setPending(s);
        setChecking(false);
      })
      .catch(() => {
        // Sin resumen no bloqueamos la apertura de caja. Nunca.
        if (alive) setChecking(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-mipiace-stone">
        <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
      </div>
    );
  }

  if (pending) {
    // El arqueo a posteriori sólo tiene sentido si lo cerró el corte de día
    // y nadie ha contado todavía. Si lo cerró una persona, ya tuvo su
    // momento de contar.
    const canCount =
      pending.shift.closeReason === "AUTO_DAY_CUT" &&
      pending.shift.cashCounted == null;
    return (
      <div className="min-h-screen bg-mipiace-stone flex items-center justify-center p-5 font-sans">
        <div className="w-full max-w-lg">
          <DaySummaryCard
            summary={pending}
            title="Así fue el día de ayer"
            busy={acking}
            confirmLabel="Confirmar"
            onConfirm={async () => {
              setAcking(true);
              // Si el ack falla, la tarjeta reaparecerá mañana: molesto, no
              // grave. Lo que no puede pasar es que el cajero se quede
              // atrapado aquí sin poder abrir caja.
              await ackDaySummary(pending.shift.id).catch(() => undefined);
              setPending(null);
              setAcking(false);
            }}
            {...(canCount ? { onCountCash: () => setCounting(true) } : {})}
          />
        </div>
        {counting && (
          <CloseShiftModal
            shiftId={pending.shift.id}
            cashierRole={cashierRole}
            mode="X"
            onClose={() => {
              setCounting(false);
              // Al volver del arqueo, el resumen ya conoce el descuadre.
              void fetchPendingDaySummary()
                .then((s) => s && setPending(s))
                .catch(() => undefined);
            }}
            onClosed={() => setCounting(false)}
          />
        )}
      </div>
    );
  }

  return <ShiftOpenScreen {...props} />;
}

// ─── Modo prueba (B-OnboardingV2) ──────────────────────────────────

interface TestBootstrap {
  user: {
    id: string;
    email: string;
    alias: string | null;
    role: "MANAGER" | "CASHIER";
  };
  tenant: { id: string; name: string; cashierAutoLogoutMinutes: number };
  register: { id: string; name: string; numSerieHolded: string | null };
  store: { id: string; name: string };
  shift: { id: string; openedAt: string; cashOpening: string } | null;
}

function TestModeTpv({
  cashier,
  setCashier,
  bootstrap,
}: {
  cashier: CashierState;
  setCashier: (s: CashierState) => void;
  bootstrap: TestBootstrap;
}) {
  if (cashier.kind === "needsLogin") {
    // No debería ocurrir en modo prueba — bootstrap siempre rellena.
    return null;
  }
  return (
    <LoggedInWrapper
      autoLogoutMinutes={bootstrap.tenant.cashierAutoLogoutMinutes}
      onAutoLogout={() => {
        // En modo prueba no cerramos sesión por inactividad — la
        // pestaña es supervisada por el super-admin. No-op.
      }}
    >
      {cashier.kind === "needsShiftOpen" ? (
        <ShiftOpenScreen
          cashierLabel={cashierDisplayLabel(bootstrap.user)}
          registerName={bootstrap.register.name}
          storeName={bootstrap.store.name}
          onOpened={(shift) => {
            setCashier({
              kind: "active",
              cashier: cashier.cashier,
              shift,
            });
          }}
          onBack={() => {
            clearTestMode();
            window.location.reload();
          }}
        />
      ) : cashier.kind === "active" ? (
        <TpvHome
          cashier={cashier.cashier}
          shiftId={cashier.shift.id}
          registerName={bootstrap.register.name}
          registerId={bootstrap.register.id}
          storeName={bootstrap.store.name}
          onLogoutCashier={async () => {
            // "Salir" en el banner es la salida canónica del modo
            // prueba. El cashier-logout aquí cierra el shift no
            // bloquea — los tickets generados son TEST.
            try {
              await apiWithCashier("/shift/cashier-logout", { method: "POST", body: {} });
            } catch {
              /* sin sesión real */
            }
            clearTestMode();
            window.close();
          }}
          onCloseShift={() => {
            setCashier({ kind: "needsShiftOpen", cashier: cashier.cashier });
          }}
        />
      ) : (
        <ShiftResumeScreen
          shift={cashier.shift}
          cashierRole={cashier.cashier.role}
          onResumed={(shift) =>
            setCashier({ kind: "active", cashier: cashier.cashier, shift })
          }
          onClosed={() =>
            setCashier({ kind: "needsShiftOpen", cashier: cashier.cashier })
          }
        />
      )}
    </LoggedInWrapper>
  );
}

export default App;
