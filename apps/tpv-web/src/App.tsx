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

import { useCallback, useEffect, useState } from "react";
import { Loader2, Lock } from "lucide-react";

import {
  apiWithCashier,
  apiWithDevice,
  ApiError,
  registerSessionExpiredHandler,
} from "./api.js";
import { CambiarPinSheet } from "./components/CambiarPinSheet.js";
import { ReloginPinModal } from "./components/ReloginPinModal.js";
import { EnsayoBanner } from "./components/EnsayoBanner.js";
import { TestModeBanner } from "./components/TestModeBanner.js";
import { useDeviceBootstrap } from "./hooks/useDeviceBootstrap.js";
import { startSupportChannel } from "./lib/supportChannel/index.js";
import { useInactivityLogout } from "./hooks/useInactivityLogout.js";
import {
  getCachedBusinessType,
  getCachedClinicaEnabled,
  getCachedEnsayo,
} from "./lib/catalog.js";
import {
  flushOutbox,
  registerLocalShiftLookup,
  registerShiftResolvedCallback,
  startOutboxSync,
  subscribeOutbox,
} from "./lib/outbox.js";
import { refreshOfflineBundle } from "./lib/offlineSession.js";
import {
  abrirTurnoDeClinicaEnLocal,
  adoptarTurnoDelServidor,
} from "./lib/turnoDeClinica.js";
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
import { installBackGuard, setBackFallback } from "./hooks/useBackGuard.js";
import { OutboxChip } from "./pages/CheckoutPage.outboxChip.js";
import { KitchenScreen } from "./kitchen/KitchenScreen.js";
import { PuertaApp } from "./residencia/PuertaApp.js";
// residencia-4 (D-66) · el móvil de guardia. La MISMA APK en otro modo,
// igual que la cocina y la puerta: lo que decide qué pantalla arranca es
// qué contesta `/devices/me`.
import { GuardiaApp } from "./residencia/GuardiaApp.js";
// residencia-5 (D-67) · la tablet de la sala. La MISMA APK en otro modo.
import { SalaApp } from "./residencia/SalaApp.js";
import { useAvisosListo } from "./kitchen/tpv/useAvisosListo.js";
import { useCaminoDirecto } from "./kitchen/tpv/useCaminoDirecto.js";
import { PairScreen } from "./pages/PairScreen.js";
import { PinScreen, type CashierLoginResponse } from "./pages/PinScreen.js";
import {
  SalePage,
  type AppointmentContext,
  type TableContext,
} from "./pages/SalePage.js";
// B-reservas-5 F1 · la agenda es una vista hermana del mapa de sala: la
// pinta quien manda en la navegación, no la pantalla de venta.
import { AgendaPage } from "./pages/AgendaPage.js";
import { completeAppointment } from "./lib/agenda.js";
import { CloseShiftModal } from "./pages/CloseShiftModal.js";
import { DaySummaryCard } from "./pages/DaySummaryCard.js";
import { daySummaryTitle } from "./lib/daySummaryTitle.js";
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
import type { CashierRole } from "./lib/offlineAuth.js";

type CashierUser = CashierLoginResponse["user"] & { sessionTtlMinutes: number };

/**
 * v2-H1 §5 · el estado de envío a cocina de un DRAFT, tal como lo
 * devuelven los endpoints que abren un borrador.
 *
 * Se extrae aquí, en una línea, para que no haya dos sitios leyendo los
 * mismos dos campos con criterios distintos: la comanda del TPV parte
 * sus líneas en «En cocina» y «Sin enviar» a partir de esto, y si una
 * rama dijera `0` donde la otra dice `null` el camarero vería −/+ sobre
 * algo que ya está en la plancha.
 *
 * Los `?? null` / `?? 0` cubren la respuesta de una API sin desplegar
 * todavía: ahí el campo no viene, y «no viene» es «no se ha enviado».
 */
function kitchenFromDraft(t: ServerDraft): {
  lastSentAt: string | null;
  revision: number;
} {
  return {
    lastSentAt: t.lastSentAt ?? null,
    revision: t.lastSentRevision ?? 0,
  };
}

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

  // v1.12-manos-de-camarero · el Atrás del sistema deja de sacar del TPV
  // (hallazgo H6). El centinela de historia se instala aquí, una vez,
  // antes de que nadie registre capas.
  useEffect(() => installBackGuard(), []);

  // v1.5-consistencia-C · reenvío del outbox offline: al arrancar, al
  // evento `online` y cada N segundos mientras haya pendientes.
  useEffect(() => startOutboxSync(), []);

  // v1.10-offline-un-terminal §3: el outbox etiqueta/reescribe los items
  // de un turno local a través de estos hooks (evita que outbox importe
  // offlineShift → sin ciclo de dependencias).
  useEffect(() => {
    registerLocalShiftLookup(localShiftIdForOutbox);
    // clinica-11 · el callback hace DOS cosas y hasta hoy hacía una.
    //
    // `resolveLocalShift` fija el `serverId` en IndexedDB, pero el
    // `shiftId` que esta pantalla le pasa a la venta, al cierre y al
    // arqueo vive en el estado de React y se quedaba con el `localId`.
    // Consecuencia, que ya existía antes de este bloque en el camino
    // offline: abrir turno sin red, volver la red y cerrar el turno en la
    // MISMA sesión pedía `/shift/<localId>/close-day` y recibía un 404.
    //
    // En una clínica eso pasaría todos los días —el turno nace siempre
    // local— así que se arregla aquí, donde vive el estado.
    registerShiftResolvedCallback(async (localId, serverId) => {
      await resolveLocalShift(localId, serverId);
      setCashier((prev) =>
        prev.kind === "active" && prev.shift.id === localId
          ? { ...prev, shift: { ...prev.shift, id: serverId } }
          : prev,
      );
    });
    return () => {
      registerLocalShiftLookup(null);
      registerShiftResolvedCallback(null);
    };
  }, []);

  // clinica-11 · EL PASO 3 DEL TURNO DE UNA CLÍNICA.
  //
  // El turno de una clínica nace local y lo abre el SERVIDOR en el primer
  // cobro. Quien se entera del id real es este `GET /shift/current` de
  // después de cada cobro que sale de la cola — no hay ningún `shift-open`
  // encolado del que leerlo (ver `lib/turnoDeClinica.ts`).
  //
  // Va sobre el evento `sent` del outbox porque TODO cobro pasa por la
  // cola (la venta suelta, el cobro de una mesa y el de una cita), así que
  // es el único sitio que los cubre los tres. `adoptarTurnoDelServidor` no
  // toca la red si el turno local ya está resuelto, así que en los catorce
  // comercios sin clínica esto no cuesta nada: su turno nace del servidor
  // y nace resuelto.
  useEffect(() => {
    return subscribeOutbox((e) => {
      if (e.type !== "sent") return;
      void adoptarTurnoDelServidor();
    });
  }, []);

  // A5 · canal de soporte. Se abre cuando el terminal está vinculado (antes
  // no hay device token que presentar) y se cierra al desvincular. Es
  // deliberadamente invisible: no pinta nada, no bloquea nada y ninguna
  // pantalla espera a que esté conectado. Si la API está caída, reintenta en
  // segundo plano y el TPV sigue vendiendo.
  //
  // `testMode` queda fuera a propósito: el "Probar TPV" del super-admin no es
  // un terminal, y el inventario tiene que ser de terminales de verdad.
  useEffect(() => {
    if (testMode || state.kind !== "paired") return;
    const channel = startSupportChannel();
    return () => channel.stop();
  }, [testMode, state.kind]);

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
  // H1 (ADR-016) · la empresa no tiene caja. Una frase, y se acabó: ni
  // spinner, ni vuelta al PIN, ni reintento en bucle. El terminal sigue
  // emparejado; el día que le enciendan la caja, recargar basta.
  if (state.kind === "cajaDisabled") {
    return <CajaDisabledScreen message={state.message} onRetry={refresh} />;
  }
  // kds-1-cocina (decisión 1) · LA MISMA APK EN «MODO COCINA».
  //
  // Se corta ANTES del PIN y antes de cualquier cosa de la caja, y eso es
  // la mitad de la decisión: una pantalla de cocina **no abre turno, no
  // cobra y no emite registro de facturación**, así que no tiene por qué
  // pasar por el login de cajero. Su identidad es el dispositivo.
  //
  // Nada de lo que hay debajo de esta línea se monta en una pantalla de
  // cocina: ni el outbox, ni el canal de soporte del terminal, ni el
  // cierre de día. El servidor lo garantiza igual (403 en todas las rutas
  // del TPV), pero el front tampoco lo intenta.
  if (state.kind === "kitchen") {
    return <KitchenScreen me={state.data} />;
  }
  // residencia-1 (D-52) · LA MISMA APK EN «MODO PUERTA».
  //
  // Se corta en el mismo sitio y por lo mismo que la cocina: una tablet de
  // habitación **no abre turno, no cobra y no emite registro de
  // facturación**, así que no tiene por qué pasar por el login de cajero.
  // Su identidad es el dispositivo.
  //
  // Nada de lo que hay debajo de esta línea se monta en una puerta: ni el
  // canal de soporte del terminal, ni el cierre de día, ni el outbox DEL
  // TERMINAL. El servidor lo garantiza igual (403 en todas las rutas del
  // TPV), pero el front tampoco lo intenta.
  //
  // residencia-3 · la puerta sí tiene cola, y se monta DENTRO de
  // `PuertaApp` con el mismo `startOutboxSync` de siempre. El corte sigue
  // estando aquí: lo que no se monta es el outbox de la venta con su chip,
  // su bloqueo de mesas y su cierre de día.
  // residencia-4 · «modo guardia». Igual que la puerta, ANTES de montar
  // nada del terminal: un móvil de guardia no cobra, no abre turno y no
  // emite registro de facturación.
  if (state.kind === "guard") {
    return <GuardiaApp me={state.data} onRefresh={refresh} />;
  }
  if (state.kind === "room") {
    return <PuertaApp me={state.data} onRefresh={refresh} />;
  }
  // residencia-5 (D-67) · «modo relevo». Igual que la puerta y el móvil
  // de guardia, ANTES de montar nada del terminal: la tablet de la sala
  // no cobra, no abre turno y no emite registro de facturación.
  if (state.kind === "sala") {
    return <SalaApp me={state.data} onRefresh={refresh} />;
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

  // ── clinica-1 · EL TPV DEL SANITARIO SIN CAJA ──────────────────────
  //
  // Un `CLINICIAN` entra por la misma puerta que un cajero (PIN, sesión
  // de cajero) y ve **sólo su agenda**. Ni venta, ni turno, ni cajón, ni
  // informes.
  //
  // El desvío es ESTE `if` y nada más, y está aquí por lo que evita:
  //
  //   · **El turno era la puerta obligatoria.** Tras el login, un cajero
  //     cae en `needsShiftOpen` → `ShiftOpenScreen`, y de ahí a
  //     `SalePage`. Un sanitario que no cobra no tiene fondo de caja que
  //     declarar, así que pedirle que abra turno para llegar a su agenda
  //     es pedirle que haga un arqueo de una caja que no toca. Este `if`
  //     va ANTES de toda la maquinaria de turno, así que se la salta
  //     entera — no se desactiva nada, simplemente no se entra.
  //   · **La pantalla de venta ya NO es la puerta a la agenda**, y eso no
  //     lo arregla este bloque: lo arregló B-reservas-5 F1, que subió
  //     `showAgenda` de `SalePage` a `App`. La agenda es un overlay
  //     `fixed inset-0` colgado de aquí. Lo único que seguía viviendo en
  //     `SalePage` era el BOTÓN de abrirla, y eso es un botón, no una
  //     puerta: `AgendaPage` se monta igual sin que `SalePage` exista.
  //     Por eso el mínimo de verdad son estas líneas y no un rediseño.
  //
  // Lo que NO hace este `if`: cerrar la caja. La caja la cierra la API
  // (`ensureCajaEnabled`), y tiene que seguir siendo así — esconder la
  // pantalla no es gatear, y un sanitario con curiosidad y la consola del
  // navegador abierta llega a `/tickets` igual.
  if (cashier.cashier.role === "CLINICIAN") {
    return (
      <AgendaDelSanitario
        cashier={cashier.cashier}
        autoLogoutMinutes={tenant.cashierAutoLogoutMinutes}
        bonoEtiqueta={tenant.bonoEtiqueta}
        onSalir={() => {
          clearCashierSession();
          setCashier({ kind: "needsLogin" });
        }}
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
          clinica={getCachedClinicaEnabled()}
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
          kitchenDisplayEnabled={tenant.kitchenDisplayEnabled === true}
          // B-reservas-8 · la palabra del centro para los bonos. `undefined`
          // en un terminal bootstrapeado antes del bloque → «bono».
          bonoEtiqueta={tenant.bonoEtiqueta}
          kitchenSettings={state.data.kitchen ?? null}
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
          // clinica-8 · la marca sanitaria viene con el refresco de la
          // agenda y se guarda EN LA SESIÓN DE MEMORIA, que es de donde
          // la leen la venta y la agenda. No abre ninguna puerta: cada
          // ruta clínica la vuelve a comprobar contra la base.
          onMarcaSanitaria={(esSanitario) =>
            setCashier((prev) =>
              prev.kind === "needsLogin" ||
              prev.cashier.isClinician === esSanitario
                ? prev
                : {
                    ...prev,
                    cashier: { ...prev.cashier, isClinician: esSanitario },
                  },
            )
          }
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

// ── clinica-1 · EL TPV DEL SANITARIO, EN SU PROPIO COMPONENTE ───────
//
// Era el cuerpo de un `if` dentro de `App`. Sale aquí porque necesita
// estado propio —si tiene la hoja del PIN abierta— y un `useState` dentro
// de un `if` sería un hook condicional.
//
// Lo que pinta es la agenda y nada más: ni venta, ni turno, ni cajón, ni
// informes. La caja la cierra la API (`ensureCajaEnabled`); esconder la
// pantalla no es gatear, y un sanitario con curiosidad y la consola del
// navegador abierta llega a `/tickets` igual.
//
// Exportado por lo mismo que `TpvHome`: lo que hay que poder medir es que
// esta rama PASA `onCambiarMiPin`, y eso no se ve desde `AgendaPage`
// (pin-1 · «verde pero nadie la llama»). En producción sólo lo monta
// `App`.
export function AgendaDelSanitario({
  cashier,
  autoLogoutMinutes,
  bonoEtiqueta,
  onSalir,
}: {
  cashier: CashierUser;
  autoLogoutMinutes: number;
  bonoEtiqueta?: string;
  /** Salir de la sesión. Sin `SalePage` detrás, «Volver» no tiene a dónde
   *  volver: es la misma decisión que el botón Bloquear del cajero, con
   *  el único botón que esta pantalla tiene. */
  onSalir: () => void;
}) {
  // pin-1 · «Cambiar mi PIN». El estado vive AQUÍ y el botón lo pinta la
  // cabecera de la agenda (`onCambiarMiPin`): es la única pantalla que
  // esta persona tiene, así que es donde tiene que estar.
  const [cambiandoPin, setCambiandoPin] = useState(false);
  return (
    <LoggedInWrapper
      autoLogoutMinutes={autoLogoutMinutes}
      onAutoLogout={onSalir}
    >
      <AgendaPage
        // B-reservas-8 · la palabra del centro para los bonos. El
        // sanitario sin caja ve la agenda y puede dar la próxima cita,
        // así que necesita la etiqueta igual que el mostrador — lo que
        // no ve son los euros, y eso lo decide la API.
        bonoEtiqueta={bonoEtiqueta}
        // clinica-2 · lleva la marca por construcción: `role=CLINICIAN`
        // implica `isClinician` por CHECK de la base
        // (`users_clinician_implies_flag`). Se lee del login de todos
        // modos en vez de darlo por hecho — el día que el rol y la marca
        // se desacoplaran, esta pantalla no tendría que acordarse.
        esSanitario={cashier.isClinician ?? true}
        // Su día, de entrada. La decisión de producto es «ve su agenda,
        // con sus citas por defecto»: el filtro arranca puesto en él y
        // se puede quitar — las citas de las compañeras no son datos de
        // salud (la agenda sólo enseña contacto), y necesita verlas para
        // saber si la sala está ocupada.
        staffFilterInicial={cashier.id}
        onClose={onSalir}
        // pin-1 · EL PIN, EN LA CABECERA DE LA AGENDA.
        //
        // En la primera pasada del bloque era un botón flotante colgado
        // de `LoggedInWrapper`, porque `AgendaPage` era de la rama
        // `agenda-1` esa tarde. Ya no: el prop existe, lo pinta la
        // cabecera junto al ⋯ de las ausencias, y sólo se pinta cuando se
        // pasa — la cajera no pierde píxeles por un botón que ya tiene en
        // el cajón de la venta.
        onCambiarMiPin={() => setCambiandoPin(true)}
        // Y cobrar una cita no se le ofrece: el botón no se pinta. Si
        // alguien llamara al endpoint a mano, la API lo rechaza igual
        // — esconder el botón es por no ofrecer una acción que siempre
        // falla, no por seguridad.
        puedeCobrar={false}
      />
      {cambiandoPin && (
        <CambiarPinSheet
          contexto={{ modo: "cambiar" }}
          nombre={cashierDisplayLabel(cashier)}
          onHecho={() => setCambiandoPin(false)}
          onCancelar={() => setCambiandoPin(false)}
        />
      )}
    </LoggedInWrapper>
  );
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
  // puesta-en-marcha (ADR-021) · la banda del ensayo, encima de TODAS las
  // pantallas con cajero dentro: venta, mapa de sala, apertura y cierre de
  // turno, agenda. Va aquí y no en cada pantalla por lo mismo que el chip
  // del outbox — que no dependa de que la siguiente pantalla se acuerde.
  //
  // Se lee de la caché y no de una llamada: lo escribe el login (y lo
  // refresca el catálogo y el paquete offline), así que está puesto antes de
  // que esta pantalla exista y vale sin red. El default de la caché es «no
  // está en ensayo»: ver la nota de `ENSAYO_KEY`.
  const ensayo = getCachedEnsayo();
  // v1.5-consistencia-C: el chip de cobros pendientes acompaña a todas
  // las pantallas con cajero logueado (incluido modo prueba).
  return (
    <>
      {ensayo ? (
        <div className="min-h-screen flex flex-col">
          <EnsayoBanner />
          <div className="flex-1">{children}</div>
        </div>
      ) : (
        children
      )}
      <OutboxChip />
    </>
  );
}

// Cuando hay sesión + turno abierto, el cajero entra al "home" del TPV.
// En modo bar (la tienda tiene al menos una mesa), el home es el mapa
// de sala y la venta rápida se accede con botón superior derecha. En
// modo retail puro (tienda sin mesas), seguimos directos a SalePage
// como en B4-B6 — sin coste para los clientes que no usan bar.
// Exportado para los tests del addendum de v1.12: la salida al mapa
// (botón, Atrás de Android e historial) vive aquí, así que se prueba
// aquí. En producción sólo lo monta `LoggedInWrapper`.
export function TpvHome(props: {
  cashier: CashierUser;
  shiftId: string;
  registerName: string;
  registerId: string;
  storeName: string;
  // kds-1-cocina · el módulo «Cocina» y los ajustes de ESTA tienda, tal
  // como los trae `/devices/me`. Bajan por props y no por un contexto
  // nuevo porque son dos valores que no cambian durante la sesión: los
  // pone el super-admin y el panel del restaurante, y el terminal los
  // relee al arrancar.
  kitchenDisplayEnabled?: boolean;
  /** B-reservas-8 · la palabra del centro para los bonos. */
  bonoEtiqueta?: string;
  kitchenSettings?: {
    courseMode: "ESPERA" | "TIEMPOS";
    seatMode: "ALERGIA" | "SIEMPRE";
    greenMaxMin: number;
    amberMaxMin: number;
    readyBeep: boolean;
  } | null;
  onLogoutCashier: () => void | Promise<void>;
  onCloseShift: () => void;
  // clinica-8 · la marca sanitaria que el servidor acaba de decir, cuando
  // no es la que traía el login. Quien manda en la sesión la guarda; aquí
  // sólo se pasa hacia abajo. Sin esto, marcar a alguien sanitario desde
  // el panel no le llegaba al TPV hasta cerrar sesión y volver a entrar.
  onMarcaSanitaria?: (esSanitario: boolean) => void;
}) {
  // B-Multi-Vertical SB3: el vertical manda sobre `hasTables`. Si el
  // tenant es RETAIL o SERVICES no entramos al mapa aunque la tienda
  // tenga mesas legacy (Thalia no debería tener, pero defensivo).
  // Sólo HOSPITALITY (o un cliente sin businessType cacheado aún, p.ej.
  // primera sesión post-deploy) pregunta a /tpv/tables.
  const businessType = getCachedBusinessType();
  const skipTables = businessType !== null && businessType !== "HOSPITALITY";
  // kds-1-cocina (decisión 5) · LO QUE ESTÁ LISTO, de toda la tienda.
  //
  // Vive AQUÍ, en `TpvHome`, y no dentro de la sala ni dentro de la venta,
  // porque las dos pantallas enseñan el mismo aviso y tienen que decir lo
  // mismo: la banda «M4 · listo para servir» arriba de la comanda y la
  // etiqueta «LISTO» verde en la mesa de la sala. Dos fuentes para el mismo
  // aviso acabarían en una banda encendida sobre una mesa sin etiqueta.
  // kds-2-wifi · el camino directo por la wifi del local. Se monta AQUÍ,
  // una sola vez, porque es de la TIENDA y porque trae la clave con la que
  // se firma: dos consumidores pidiéndola por separado podrían firmar con
  // claves distintas el minuto en que se rota (al revocar un aparato).
  const camino = useCaminoDirecto({
    moduloEncendido: props.kitchenDisplayEnabled === true,
  });
  const avisosListo = useAvisosListo({
    moduloEncendido: props.kitchenDisplayEnabled === true,
    camino,
  });
  const comandaListaPorMesa = new Map<string, string>();
  for (const l of avisosListo.listas) {
    // La más ANTIGUA de cada mesa, que es la primera de la lista (viene
    // ordenada por `readyAt` ascendente): tocar la etiqueta sirve lo que
    // lleva más tiempo en el pase.
    if (l.tableId && !comandaListaPorMesa.has(l.tableId)) {
      comandaListaPorMesa.set(l.tableId, l.orderId);
    }
  }
  const [hasTables, setHasTables] = useState<boolean | null>(
    skipTables ? false : null,
  );
  const [view, setView] = useState<
    | { kind: "map" }
    | {
        kind: "sale";
        tableContext: TableContext | null;
        // B-reservas-5 F3 · el otro borrador que se puede estar cobrando.
        // Excluyente con `tableContext`: o mesa, o cita, o venta rápida.
        appointmentContext?: AppointmentContext | null;
        // v1.0-mesas-frontend: proyección inicial del DRAFT server-side
        // (las líneas que ya tenía la mesa al retomarla). null en venta
        // rápida.
        initialDraftLines?: CartLine[];
        // v2-H1 §5 · con qué comanda salió ya este DRAFT hacia cocina.
        // Viaja desde el endpoint que abrió el borrador para que la
        // comanda del TPV pueda partirse en «En cocina · hh:mm» y «Sin
        // enviar» SIN pedir otra vez el ticket: la respuesta de
        // `POST /tables/:id/open` ya lo trae.
        initialKitchen?: { lastSentAt: string | null; revision: number };
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
  // B-reservas-5 F1 · la agenda. Vivía como estado local de `SalePage`;
  // sube aquí sin tocar el componente ni su aspecto (es un overlay
  // `fixed inset-0`, se pinta igual colgado de un sitio que del otro).
  // clinica-8 · EN UNA CLÍNICA SE ENTRA POR LA AGENDA, NO POR LA CAJA.
  //
  // Decisión de producto de Matías (18-10): en una clínica todo va con
  // cita previa, al cerrar la sesión el ticket sale hecho y quien cobra
  // sólo lo confirma. A la vista de cajero se va **para añadir algo
  // aparte** (unas plantillas, un producto), no para empezar.
  //
  // Se decide con la caché del catálogo —la misma que ya decide si hay
  // mesas y si la cuenta está en ensayo—, así que vale sin red y está
  // puesta antes de que esta pantalla exista. Su default es `false`: en
  // los catorce comercios sin clínica el TPV abre donde abría ayer.
  //
  // Y es la vista INICIAL, no una cárcel: «Volver» cierra la agenda y deja
  // la venta suelta debajo, que sigue existiendo entera.
  const [showAgenda, setShowAgenda] = useState(() =>
    getCachedClinicaEnabled(),
  );
  // B-reservas-5 F4 · aviso que la agenda enseña al abrirse. Se usa
  // cuando el paso a COMPLETED no salió: el cobro es válido igual y la
  // cajera tiene que saber que le queda pulsar "Finalizar".
  const [agendaNotice, setAgendaNotice] = useState<string | null>(null);

  // B-reservas-5 F3 · LA entrada al contexto de borrador. Una sola
  // función, porque aquí es donde vive el cambio de vista — igual que
  // `goToMap` es LA salida. Tocar una mesa y cobrar una cita hacen lo
  // mismo: hay un ticket DRAFT en el servidor, se carga su proyección
  // con el mapper que ya existe y se entra a vender sobre él.
  //
  // Las líneas NUNCA se reconstruyen a mano: o vienen ya mapeadas del
  // endpoint que abrió el borrador (mesa), o se piden con
  // `GET /tickets/:id` (cita). El mapeo vive en un solo sitio.
  async function enterDraft(entry: {
    tableContext?: TableContext | null;
    appointmentContext?: AppointmentContext | null;
    lines?: CartLine[];
    ticketId?: string;
    // v2-H1 §5 · lo trae quien ya tenga el DRAFT en la mano (la mesa);
    // en la rama que lo pide con GET se lee de la respuesta.
    kitchen?: { lastSentAt: string | null; revision: number };
  }): Promise<void> {
    let lines = entry.lines;
    let kitchen = entry.kitchen;
    if (!lines && entry.ticketId) {
      const res = await apiWithCashier<{ ticket: ServerDraft }>(
        `/tickets/${entry.ticketId}`,
      );
      lines = mapServerDraftLines(res.ticket.lines);
      kitchen = kitchenFromDraft(res.ticket);
    }
    setView({
      kind: "sale",
      tableContext: entry.tableContext ?? null,
      appointmentContext: entry.appointmentContext ?? null,
      initialDraftLines: lines ?? [],
      initialKitchen: kitchen,
    });
  }

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
      await enterDraft({
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
        lines: mapServerDraftLines(res.ticket.lines),
        kitchen: kitchenFromDraft(res.ticket),
      });
    } catch (err) {
      // 409 TABLE_GROUPED / SHIFT_NOT_OPEN llegan con mensaje en
      // español; un fallo de red es el gate online-only.
      setOpenTableError(tableErrorMessage(err));
    } finally {
      setOpeningTableId(null);
    }
  }

  // v1.12-addendum · LA salida al mapa. Una sola función, aquí, porque
  // aquí es donde vive el cambio de vista: el botón "Mapa", el Atrás de
  // Android y el "Mesas" del historial de tickets salen todos por el
  // mismo sitio y sueltan la mesa igual.
  //
  // Antes había dos caminos. `SalePage` envolvía su `onBackToMap` para
  // soltar el draft vacío, pero el guardia del Atrás y el historial
  // llamaban al cambio de vista a pelo: salir con el Atrás dejaba la
  // mesa ocupada con un DRAFT sin líneas — la mesa zombi que v1.12-B
  // vino a matar. Envolver cada llamada es cómo se llegó a eso; la
  // limpieza vive donde vive la navegación.
  //
  // QUIÉN DECIDE QUE ESTÁ VACÍA: EL SERVIDOR (v1.12-B). `onlyIfEmpty=true`
  // se comprueba dentro del WHERE de la reclamación: si otra caja comandó
  // hace tres segundos, responde 409 y no toca nada. Desde aquí ni
  // siquiera conocemos las líneas, que es justo la razón de no decidirlo
  // en el cliente.
  //
  // Si no procede —409, mesa ya cobrada, sin red— se traga en silencio y
  // se va al mapa igual: el cajero pidió ir al mapa, no gestionar un
  // draft del que no sabe nada. El barrido de madrugada recoge el resto.
  const goToMap = useCallback(async () => {
    const ticketId =
      view.kind === "sale" ? view.tableContext?.activeTicketId ?? null : null;
    if (ticketId) {
      try {
        await apiWithCashier(
          `/tickets/${ticketId}?onlyIfEmpty=true&reason=${encodeURIComponent(
            "Salió del detalle sin añadir nada",
          )}`,
          { method: "DELETE" },
        );
      } catch {
        // Silencio a propósito, incluido el 409 "la mesa tiene líneas":
        // esa es la respuesta correcta, no un error que enseñar.
      }
    }
    setMapNotice(null);
    setView({ kind: "map" });
  }, [view]);

  // v1.12-manos-de-camarero · guardia de fondo del Atrás (H6). Cuando
  // no hay ninguna hoja abierta: dentro de una venta se vuelve al mapa
  // de mesas; en el mapa no se hace nada (el turno está abierto y no
  // hay ningún sitio al que ir que no sea el escritorio de Android).
  useEffect(() => {
    setBackFallback(() => {
      if (view.kind === "sale" && hasTables) {
        void goToMap();
        return true;
      }
      return false;
    });
    return () => setBackFallback(null);
  }, [view.kind, hasTables, goToMap]);

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

  // v1.12-manos-de-camarero · guardia del Atrás del sistema (H6). Sin
  // capas abiertas, dentro de una venta el Atrás vuelve al mapa de
  // mesas; en el mapa, con el turno abierto, no hace nada. Nunca al
  // escritorio de Android.
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
        mesasListas={avisosListo.mesasListas}
        comandaListaPorMesa={comandaListaPorMesa}
        onServido={(orderId) => void avisosListo.marcarServido(orderId)}
        onLogoutCashier={props.onLogoutCashier}
        onCloseShift={props.onCloseShift}
      />
    );
  }

  return (
    <>
      {showAgenda && (
        <AgendaPage
          notice={agendaNotice}
          onNoticeShown={() => setAgendaNotice(null)}
          onClose={() => setShowAgenda(false)}
          bonoEtiqueta={props.bonoEtiqueta}
          // clinica-2 · la agenda del mostrador. Aquí la marca SÍ hay que
          // leerla: una cajera-sanitaria y una propietaria sanitaria pasan
          // por esta rama con rol `CASHIER` y `OWNER`, y son las que de
          // verdad usan la clínica en el piloto (la podóloga es la dueña).
          // `false` si no viene: una sesión vieja o la del login offline no
          // la traen, y no ofrecer la valoración es el lado correcto.
          esSanitario={props.cashier.isClinician ?? false}
          onMarcaSanitaria={props.onMarcaSanitaria}
          // B-reservas-5 F3 · cobrar una cita entra en contexto de
          // borrador por la MISMA puerta que abrir una mesa. No se
          // rehidratan líneas en el cliente: `enterDraft` las pide.
          onEnterDraft={(entry) =>
            void enterDraft({
              ticketId: entry.ticketId,
              appointmentContext: {
                appointmentId: entry.appointmentId,
                activeTicketId: entry.ticketId,
                clientName: entry.clientName,
                serviceLabel: entry.serviceLabel,
                // clinica-9 (15) · «Atendido por» ya puesto en el cobro.
                atendidoPor: entry.atendidoPor ?? null,
              },
            })
          }
        />
      )}
      <SalePage
        // B-reservas-5 F3 · la cita también remonta. Sin su id en la
        // key, pasar de venta rápida a cobrar una cita reusaría la
        // instancia y el carrito se quedaría con lo de antes: el
        // estado de líneas se inicializa UNA vez, en el montaje.
        key={
          view.tableContext?.id ??
          view.appointmentContext?.activeTicketId ??
          "quick-sale"
        }
        onOpenAgenda={() => setShowAgenda(true)}
        // n1-vertical · la agenda es un overlay y la venta sigue montada
        // debajo. Sin esto, su barra inferior fija se pinta ENCIMA de la
        // agenda y tapa el pie de «Nueva cita», donde está «Reservar»
        // (pasada del N1, captura `22-nueva-cita`).
        agendaAbierta={showAgenda}
        // kds-1-cocina · el módulo «Cocina» y los ajustes de ESTA tienda,
        // tal como los trae `/devices/me`. Van por props y no por un
        // contexto nuevo porque son dos valores que no cambian durante la
        // sesión: los pone el super-admin y el panel del restaurante, y el
        // terminal los relee al arrancar.
        kitchenDisplayEnabled={props.kitchenDisplayEnabled === true}
        bonoEtiqueta={props.bonoEtiqueta}
        camino={camino}
        kitchenSettings={props.kitchenSettings ?? null}
        // La banda «M4 · listo para servir» de TODA la tienda, no sólo de
        // la mesa abierta: se entera cualquier camarero (decisión 5).
        avisosListo={avisosListo.listas}
        onServido={(orderId) => void avisosListo.marcarServido(orderId)}
        appointmentContext={view.appointmentContext ?? null}
        // Salir del cobro de una cita devuelve a la agenda, que es de
        // donde se vino. En SERVICES no hay mapa al que caer.
        onBackToAgenda={() => {
          setView({ kind: "sale", tableContext: null });
          setShowAgenda(true);
        }}
        // B-reservas-5 F4 · la cita se finaliza sola al cobrarse. EL
        // DINERO MANDA: esto corre DESPUÉS del cobro y no puede tumbarlo.
        // Si falla, se avisa y queda "Finalizar" a mano en el detalle.
        onAppointmentPaid={(appointmentId) => {
          void completeAppointment(appointmentId).then((res) => {
            if (!res.ok) {
              setAgendaNotice(
                `El cobro se hizo bien, pero la cita no se pudo marcar como finalizada (${res.message}). Márcala a mano con "Finalizar".`,
              );
            } else if (res.queuedOffline) {
              setAgendaNotice(
                "Sin conexión: la cita se marcará como finalizada al reconectar.",
              );
            }
          });
        }}
        shiftId={props.shiftId}
        cashierLabel={cashierDisplayLabel(props.cashier)}
        cashierRole={props.cashier.role}
        // clinica-2 · la marca, no el rol: en el piloto la podóloga es la
        // dueña, y un `OWNER` no se distingue de otro por el rol.
        esSanitario={props.cashier.isClinician ?? false}
        registerName={props.registerName}
        registerId={props.registerId}
        storeName={props.storeName}
        tableContext={view.tableContext}
        initialDraftLines={view.initialDraftLines}
        initialKitchen={view.initialKitchen}
        // La salida al mapa ya viene con la limpieza dentro: `SalePage` no
        // envuelve nada, sólo llama.
        onBackToMap={hasTables ? () => void goToMap() : null}
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
    </>
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
// clinica-11 · exportado para el banco. Lo que hay que poder medir es la
// DECISIÓN —en una clínica no sale «Abrir turno», en un bar sí— y esa
// decisión vive aquí (pin-1 · «verde pero nadie la llama»). En producción
// sólo lo monta `LoggedInWrapper`.
export function ShiftOpenWithDaySummary({
  cashierRole,
  clinica,
  ...props
}: React.ComponentProps<typeof ShiftOpenScreen> & {
  // clinica-1 · el tipo compartido (ver la nota de CloseShiftModal).
  cashierRole: CashierRole;
  // clinica-11 · en una clínica no hay pantalla de abrir turno. Lo decide
  // la caché del catálogo, la misma que ya decide si se entra por la
  // agenda — así que vale sin red y está puesta antes de que esta pantalla
  // exista.
  clinica: boolean;
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
            title={daySummaryTitle(pending.shift.closedAt)}
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

  // clinica-11 · EN UNA CLÍNICA NO SALE LA PANTALLA.
  //
  // La tarjeta del día de arriba SÍ sale: es el resumen del cierre de
  // ayer y no se le quita a nadie («el cierre del día sigue igual»). Lo
  // que se va es el paso siguiente, el de teclear el fondo de caja, que es
  // el que no le sirve de nada a quien no tiene mostrador.
  if (clinica) return <AperturaDeClinica onOpened={props.onOpened} />;

  return <ShiftOpenScreen {...props} />;
}

/**
 * clinica-11 · el puente sin pantalla entre el login y la agenda.
 *
 * Pinta un spinner y nada más, y dura lo que tarda un `GET
 * /shift/current`. No es una pantalla: es el hueco de la que se ha ido.
 *
 * `openedOffline: true` en el `onOpened` a propósito: el turno ya está
 * escrito en local (`abrirTurnoDeClinicaEnLocal`), así que `App` no tiene
 * que volver a espejarlo — y espejarlo lo pisaría con un turno del
 * servidor que todavía no existe.
 *
 * Exportado para el banco: lo que hay que poder medir es que esta rama se
 * monta y que NO monta «Abrir turno» (pin-1 · «verde pero nadie la
 * llama»). En producción sólo lo monta `ShiftOpenWithDaySummary`.
 */
export function AperturaDeClinica({
  onOpened,
}: {
  onOpened: (
    shift: { id: string; openedAt: string; cashOpening: string },
    openedOffline: boolean,
  ) => void;
}) {
  const [fallo, setFallo] = useState<string | null>(null);
  useEffect(() => {
    let vivo = true;
    void abrirTurnoDeClinicaEnLocal()
      .then((shift) => {
        if (vivo) onOpened(shift, true);
      })
      .catch(() => {
        // `abrirTurnoDeClinicaEnLocal` ya se come los fallos de red; si
        // llega aquí es que IndexedDB no está (modo privado restrictivo).
        // No se deja a la podóloga mirando un spinner para siempre.
        if (vivo) setFallo("No se pudo preparar la caja. Vuelve a entrar.");
      });
    return () => {
      vivo = false;
    };
    // Dependencias VACÍAS a propósito: `onOpened` cambia en cada render de
    // `App`, y meterlo aquí abriría un turno local por render.
  }, []);
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-mipiace-stone">
      {fallo ? (
        <p className="text-[14px] text-red-700 px-6 text-center">{fallo}</p>
      ) : (
        <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
      )}
    </div>
  );
}

// ─── Modo prueba (B-OnboardingV2) ──────────────────────────────────

interface TestBootstrap {
  user: {
    id: string;
    email: string;
    alias: string | null;
    // El cajero técnico del modo prueba es siempre MANAGER, pero el tipo
    // sale del mismo sitio que el del login para que no vuelvan a
    // divergir.
    role: CashierRole;
  };
  tenant: {
    id: string;
    name: string;
    cashierAutoLogoutMinutes: number;
    // kds-1-cocina · el modo prueba es con lo que se DEMUESTRA el
    // producto. Una demo sin la pantalla de comandas en una cuenta que la
    // tiene comprada es una demo que miente, así que el flag viaja también
    // por aquí.
    kitchenDisplayEnabled?: boolean;
  /** B-reservas-8 · la palabra del centro para los bonos. */
  bonoEtiqueta?: string;
  };
  register: { id: string; name: string; numSerieHolded: string | null };
  store: { id: string; name: string };
  shift: { id: string; openedAt: string; cashOpening: string } | null;
  kitchen?: {
    courseMode: "ESPERA" | "TIEMPOS";
    seatMode: "ALERGIA" | "SIEMPRE";
    greenMaxMin: number;
    amberMaxMin: number;
    readyBeep: boolean;
  } | null;
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
          kitchenDisplayEnabled={bootstrap.tenant.kitchenDisplayEnabled === true}
          bonoEtiqueta={bootstrap.tenant.bonoEtiqueta}
          kitchenSettings={bootstrap.kitchen ?? null}
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

// H1 (ADR-016) · lo que ve un terminal cuya empresa no tiene caja.
//
// Deliberadamente sobrio y sin salidas falsas: no ofrecemos "iniciar
// sesión" ni "emparejar otra vez", porque ninguna de las dos arregla
// nada y las dos invitan a un bucle. Sólo "Reintentar", que sirve para
// el caso real: acaban de encenderle la caja y quiere entrar sin
// reinstalar nada.
function CajaDisabledScreen({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-mipiace-stone px-6">
      <div
        role="alert"
        className="w-full max-w-sm bg-white rounded-2xl border border-slate-200 p-7 text-center"
      >
        <div className="w-12 h-12 rounded-full bg-amber-100 flex items-center justify-center mx-auto mb-4">
          <Lock className="w-6 h-6 text-amber-700" strokeWidth={1.8} />
        </div>
        <h1 className="text-[17px] font-semibold text-mipiace-ink tracking-tight">
          Esta caja no está activada
        </h1>
        <p className="text-[13.5px] text-slate-500 mt-2 leading-relaxed">{message}</p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-5 h-11 w-full rounded-xl border border-slate-300 text-[14px] font-medium text-slate-700 hover:bg-slate-50"
        >
          Reintentar
        </button>
      </div>
    </div>
  );
}
