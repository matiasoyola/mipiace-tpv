// Orquestador de estados del TPV en B3:
//   1. unpaired → PairScreen
//   2. paired + no session → PinScreen
//   3. session + shift forceClose → ShiftForceCloseScreen
//   4. session + needsShiftOpen → ShiftOpenScreen
//   5. session + reanudar → ShiftActiveScreen
//
// La venta llega en B4 y reemplaza ShiftActiveScreen.

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import { apiWithCashier, ApiError } from "./api.js";
import { useDeviceBootstrap } from "./hooks/useDeviceBootstrap.js";
import { useInactivityLogout } from "./hooks/useInactivityLogout.js";
import { PairScreen } from "./pages/PairScreen.js";
import { PinScreen, type CashierLoginResponse } from "./pages/PinScreen.js";
import { SalePage, type TableContext } from "./pages/SalePage.js";
import { ShiftForceCloseScreen } from "./pages/ShiftForceCloseScreen.js";
import { ShiftOpenScreen } from "./pages/ShiftOpenScreen.js";
import { TableMapScreen, type ApiTable } from "./pages/TableMapScreen.js";
import { clearCashierSession } from "./storage.js";

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

  if (cashier.kind === "needsLogin") {
    return (
      <PinScreen
        registerName={`${register.name} · ${store.name}`}
        onLoggedIn={(res) => onLoggedIn(res, setCashier)}
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
      {cashier.kind === "forceClose" ? (
        <ShiftForceCloseScreen
          shift={cashier.shift}
          cashierRole={cashier.cashier.role}
          onClosed={() =>
            setCashier({ kind: "needsShiftOpen", cashier: cashier.cashier })
          }
        />
      ) : cashier.kind === "needsShiftOpen" ? (
        <ShiftOpenScreen
          cashierEmail={cashier.cashier.email}
          registerName={register.name}
          storeName={store.name}
          onOpened={(shift) => {
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

function onLoggedIn(
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
  return <>{children}</>;
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
  const [hasTables, setHasTables] = useState<boolean | null>(null);
  const [view, setView] = useState<
    | { kind: "map" }
    | { kind: "sale"; tableContext: TableContext | null }
  >({ kind: "map" });

  useEffect(() => {
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
  }, []);

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
        cashierEmail={props.cashier.email}
        storeName={props.storeName}
        registerName={props.registerName}
        onPickTable={(table) => {
          setView({
            kind: "sale",
            tableContext: tableContextFromApi(table),
          });
        }}
        onQuickSale={() => {
          setView({ kind: "sale", tableContext: null });
        }}
        onLogoutCashier={props.onLogoutCashier}
        onCloseShift={props.onCloseShift}
      />
    );
  }

  return (
    <SalePage
      shiftId={props.shiftId}
      cashierEmail={props.cashier.email}
      cashierRole={props.cashier.role}
      registerName={props.registerName}
      registerId={props.registerId}
      storeName={props.storeName}
      tableContext={view.tableContext}
      onBackToMap={
        hasTables ? () => setView({ kind: "map" }) : null
      }
      onLogoutCashier={props.onLogoutCashier}
      onCloseShift={props.onCloseShift}
    />
  );
}

function tableContextFromApi(table: ApiTable): TableContext {
  return {
    id: table.id,
    name: table.name,
    zone: table.zone,
    capacity: table.capacity,
    diners: table.activeTicket?.diners ?? null,
    openedAt: table.activeTicket?.openedAt ?? null,
    openedByEmail: table.activeTicket?.openedByEmail ?? null,
    activeTicketId: table.activeTicket?.id ?? null,
  };
}

export default App;
