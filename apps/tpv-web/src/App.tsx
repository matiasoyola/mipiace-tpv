// Orquestador de estados del TPV en B3:
//   1. unpaired → PairScreen
//   2. paired + no session → PinScreen
//   3. session + shift forceClose → ShiftForceCloseScreen
//   4. session + needsShiftOpen → ShiftOpenScreen
//   5. session + reanudar → ShiftActiveScreen
//
// La venta llega en B4 y reemplaza ShiftActiveScreen.

import { useState } from "react";
import { Loader2 } from "lucide-react";

import { apiWithCashier } from "./api.js";
import { useDeviceBootstrap } from "./hooks/useDeviceBootstrap.js";
import { useInactivityLogout } from "./hooks/useInactivityLogout.js";
import { PairScreen } from "./pages/PairScreen.js";
import { PinScreen, type CashierLoginResponse } from "./pages/PinScreen.js";
import { ShiftActiveScreen } from "./pages/ShiftActiveScreen.js";
import { ShiftForceCloseScreen } from "./pages/ShiftForceCloseScreen.js";
import { ShiftOpenScreen } from "./pages/ShiftOpenScreen.js";
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
          onOpened={() => {
            // B4 traerá GET /shift/current; hasta entonces marcamos
            // como activo con datos provisionales que la pantalla
            // de venta refrescará al montarse.
            setCashier({
              kind: "active",
              cashier: cashier.cashier,
              shift: {
                id: "pending-refresh",
                openedAt: new Date().toISOString(),
                cashOpening: "0,00",
              },
            });
          }}
          onBack={() => {
            clearCashierSession();
            setCashier({ kind: "needsLogin" });
          }}
        />
      ) : cashier.kind === "active" ? (
        <ShiftActiveScreen
          shiftId={cashier.shift.id}
          cashOpening={cashier.shift.cashOpening}
          openedAt={cashier.shift.openedAt}
          cashierEmail={cashier.cashier.email}
          cashierRole={cashier.cashier.role}
          registerName={register.name}
          storeName={store.name}
          autoLogoutMinutes={tenant.cashierAutoLogoutMinutes}
          onClosed={() =>
            setCashier({ kind: "needsShiftOpen", cashier: cashier.cashier })
          }
          onLogoutCashier={async () => {
            try {
              await apiWithCashier("/shift/cashier-logout", { method: "POST", body: {} });
            } catch {
              // El backend invalida la sesión al expirar el token; si
              // falla en red ignoramos. Lo importante es limpiar local.
            }
            clearCashierSession();
            setCashier({ kind: "needsLogin" });
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

export default App;
