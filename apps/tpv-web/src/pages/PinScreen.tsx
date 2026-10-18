// Pantalla 2 del reference (TpvPinScreen). Lista de cajeros recientes
// (localStorage) + keypad numérico.

import { useEffect, useRef, useState } from "react";
import { AlertCircle, ChevronRight, CircleAlert, Delete, Eye, EyeOff, Loader2, Plus } from "lucide-react";

import { apiWithDevice, ApiError } from "../api.js";
import { setCachedEnsayo } from "../lib/catalog.js";
import { Logo } from "../Logo.js";
import type { CashierRole } from "../lib/offlineAuth.js";
import { offlineLogin, type OfflineShiftState } from "../lib/offlineSession.js";
import {
  getRecentCashiers,
  rememberCashier,
  setCashierSession,
  type RecentCashier,
} from "../storage.js";

const AUTO_BLUR_MS = 30_000;
const PIN_LENGTH_TARGET = 4; // visualización mínima — el backend acepta 4-8.

interface CashierLoginResponse {
  sessionToken: string;
  sessionTtlMinutes: number;
  // puesta-en-marcha (ADR-021) · la cuenta todavía no factura. El TPV pinta
  // la banda fija de ensayo y el papel sale marcado.
  //
  // Opcional porque el login OFFLINE no pasa por el servidor: ahí la trae el
  // paquete offline (`/shift/offline-bundle`), que es quien la cachea.
  ensayo?: boolean;
  // v1.7-alias-cajeros: alias llega junto al email (que sigue en el
  // contrato como credencial y por compat con SW viejos).
  user: {
    id: string;
    email: string;
    alias: string | null;
    // clinica-1 · `CLINICIAN` es el sanitario sin caja. ES LA FUENTE del
    // rol para todo el TPV (de aquí sale `CashierUser`), así que
    // ensancharla aquí es lo que obliga a decidir en cada pantalla a la
    // que el rol llega. Se usa el tipo compartido a propósito.
    role: CashierRole;
    // clinica-2 · LA MARCA sanitaria, separada del rol (clinica-1 §2). La
    // agenda la usa para decidir si ofrece abrir la valoración de un
    // paciente: con el rol no basta, porque una cajera-sanitaria lleva
    // `CASHIER` y una propietaria sanitaria `OWNER`.
    //
    // Opcional porque una sesión abierta ANTES de este bloque (o la del
    // login offline, que no la lleva) no la trae: ausente se trata como
    // `false`, y eso es lo correcto —no se ofrece el botón— porque lo
    // clínico necesita red de todos modos.
    isClinician?: boolean;
  };
  shiftState:
    | { kind: "needsShiftOpen" }
    | { kind: "reanudar"; shift: { id: string; openedAt: string; cashOpening: string } }
    | {
        kind: "forceClose";
        shift: {
          id: string;
          openedAt: string;
          lastActivityAt: string;
          cashOpening: string;
          ownedByUserId: string;
        };
      };
  // v1.10-offline-un-terminal: cuando el login se resolvió SIN red
  // (PIN verificado en local), no hay sessionToken. `offline: true` lo
  // marca; `pin` viaja SÓLO en memoria para que App renueve el JWT real
  // al volver la conexión (nunca se persiste).
  offline?: boolean;
  pin?: string;
}

export function PinScreen({
  registerName,
  onLoggedIn,
  onDeviceRevoked,
}: {
  registerName: string;
  onLoggedIn: (res: CashierLoginResponse) => void;
  onDeviceRevoked: () => void;
}) {
  const [recent, setRecent] = useState<RecentCashier[]>([]);
  const [selectedEmail, setSelectedEmail] = useState<string | null>(null);
  const [otherEmail, setOtherEmail] = useState<string>("");
  const [pin, setPin] = useState("");
  // v1.0-pilotos · Lote 4 (#6): toggle ojo para ver el PIN tecleado.
  const [pinVisible, setPinVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // v1.3-piloto-feedback · Lote 4: el backend devuelve `attemptsRemaining`
  // en 401 INVALID_CREDENTIALS para avisar antes de que entre el rate
  // limit. NULL = aún no hemos visto un fallo (o ya se reseteó).
  const [attemptsRemaining, setAttemptsRemaining] = useState<number | null>(null);
  // Timestamp en ms en el que vence el bloqueo. NULL = no bloqueado.
  // Tickea 1× por segundo mientras esté activo para mostrar countdown.
  const [lockedUntilMs, setLockedUntilMs] = useState<number | null>(null);
  const [nowMs, setNowMs] = useState<number>(Date.now());
  // n1-vertical · EN COMPACTO ESTA PANTALLA SON DOS PASOS, NO UNA COLUMNA
  // LARGA.
  //
  // Medido en el N1 (viewport de 360×648): las dos tarjetas apiladas
  // suman ~860 px, así que la fila del 0 salía cortada y había que bajar
  // para llegar a «Entrar» — y el aviso de PIN incorrecto, que vivía
  // debajo del botón, no se veía nunca (pasada del 2026-10-16, punto 8).
  // El teclado solo mide ~490 px y cabe entero.
  //
  // Es un paso explícito y no `activeEmail.length > 0` a propósito: con
  // la condición derivada, la tarjeta del cajero desaparecía en cuanto
  // se teclea la PRIMERA letra del email, con el teclado abierto y el
  // campo a medias.
  //
  // De `md` (768 px) hacia arriba no existe: las dos tarjetas se pintan
  // en paralelo como siempre, que es lo que ven los quince terminales de
  // 10" y 15" en producción.
  const [pasoCompacto, setPasoCompacto] = useState<"cajero" | "pin">("cajero");

  useEffect(() => {
    setRecent(getRecentCashiers());
  }, []);

  // Auto-blur del PIN tras inactividad — limpia el PIN para evitar que
  // quede visible en pantalla si el cajero se aleja.
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!selectedEmail && !otherEmail) return;
    if (blurTimer.current) clearTimeout(blurTimer.current);
    blurTimer.current = setTimeout(() => setPin(""), AUTO_BLUR_MS);
    return () => {
      if (blurTimer.current) clearTimeout(blurTimer.current);
    };
  }, [pin, selectedEmail, otherEmail]);

  // v1.3-piloto-feedback · Lote 4: tick 1×/s mientras estemos en lock
  // para refrescar el countdown. En cuanto vence, limpiamos el estado
  // (el cajero puede volver a probar) y reseteamos attemptsRemaining
  // — el rate-limit del backend habrá expirado al mismo tiempo.
  useEffect(() => {
    if (lockedUntilMs == null) return;
    const tick = setInterval(() => {
      const now = Date.now();
      setNowMs(now);
      if (now >= lockedUntilMs) {
        setLockedUntilMs(null);
        setAttemptsRemaining(null);
        setError(null);
      }
    }, 1000);
    return () => clearInterval(tick);
  }, [lockedUntilMs]);
  const lockSecondsRemaining =
    lockedUntilMs != null ? Math.max(0, Math.ceil((lockedUntilMs - nowMs) / 1000)) : 0;
  const isLocked = lockedUntilMs != null && lockSecondsRemaining > 0;

  const activeEmail = selectedEmail ?? otherEmail.trim().toLowerCase();
  const canSubmit =
    !isLocked && activeEmail.length > 0 && pin.length >= PIN_LENGTH_TARGET;

  async function submit() {
    if (!canSubmit || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiWithDevice<CashierLoginResponse>(
        "/shift/cashier-login",
        { method: "POST", body: { email: activeEmail, pin } },
      );
      // puesta-en-marcha (ADR-021) · ANTES de dar la sesión por buena. La
      // banda tiene que estar puesta antes de que la pantalla de venta
      // pueda pintarse: si esto se hiciera después, habría un instante en
      // el que se puede cobrar sin que el papel diga nada.
      if (res.ensayo !== undefined) setCachedEnsayo(res.ensayo);
      rememberCashier({
        email: res.user.email,
        alias: res.user.alias,
        initials: initialsOf(res.user.alias ?? res.user.email),
        lastSeenAt: new Date().toISOString(),
      });
      setCashierSession({
        sessionToken: res.sessionToken,
        sessionTtlMinutes: res.sessionTtlMinutes,
        userId: res.user.id,
        email: res.user.email,
        alias: res.user.alias,
        role: res.user.role,
      });
      // Login OK → limpiamos cualquier rastro del avisador de intentos
      // que hubiera quedado de un intento previo en este mismo device.
      setAttemptsRemaining(null);
      setLockedUntilMs(null);
      onLoggedIn(res);
    } catch (err) {
      setPin("");
      if (err instanceof ApiError) {
        if (err.code === "DEVICE_REVOKED" || err.status === 401 && err.code === "DEVICE_TOKEN_REQUIRED") {
          onDeviceRevoked();
          return;
        }
        // v1.3-piloto-feedback · Lote 4: extraemos los campos que el
        // backend manda para avisar antes del bloqueo. ApiError.data
        // contiene el body JSON completo.
        const data = err.data as
          | { attemptsRemaining?: number; retryAfterSeconds?: number }
          | null;
        if (err.status === 429 && err.code === "RATE_LIMITED") {
          const secs = Math.max(1, data?.retryAfterSeconds ?? 0);
          setLockedUntilMs(Date.now() + secs * 1000);
          setAttemptsRemaining(0);
          setError(null); // El bloque de error se renderiza desde lockedUntilMs.
          return;
        }
        if (typeof data?.attemptsRemaining === "number") {
          setAttemptsRemaining(data.attemptsRemaining);
          setError(null);
          return;
        }
        setError(err.message);
      } else {
        // Sin red (fetch lanza TypeError, no ApiError): intentamos el
        // login offline contra el paquete cacheado.
        await tryOfflineLogin();
      }
    } finally {
      setBusy(false);
    }
  }

  // v1.10-offline-un-terminal §2: verificación del PIN en local cuando
  // no hay red. Reutiliza el mismo aviso de intentos/bloqueo que el
  // camino online (attemptsRemaining / lockedUntilMs).
  async function tryOfflineLogin() {
    const res = await offlineLogin(activeEmail, pin);
    if (res.ok) {
      rememberCashier({
        email: res.user.email,
        alias: res.user.alias,
        initials: initialsOf(res.user.alias ?? res.user.email),
        lastSeenAt: new Date().toISOString(),
      });
      setAttemptsRemaining(null);
      setLockedUntilMs(null);
      onLoggedIn({
        sessionToken: "",
        sessionTtlMinutes: res.sessionTtlMinutes,
        user: {
          id: res.user.id,
          email: res.user.email,
          alias: res.user.alias,
          role: res.user.role,
        },
        shiftState: res.shiftState as OfflineShiftState,
        offline: true,
        pin,
      });
      return;
    }
    if (res.reason === "rate_limited") {
      setLockedUntilMs(res.lockedUntilMs ?? Date.now() + 15 * 60_000);
      setAttemptsRemaining(0);
      setError(null);
    } else if (res.reason === "invalid") {
      if (typeof res.attemptsRemaining === "number") {
        setAttemptsRemaining(res.attemptsRemaining);
        setError(null);
      } else {
        setError("Email o PIN incorrectos");
      }
    } else {
      // no_bundle: nunca se hizo un arranque online con este cajero.
      setError(
        "Sin conexión y sin datos guardados para operar offline. Conéctate una vez para habilitar el modo sin conexión.",
      );
    }
  }

  function pressDigit(d: string) {
    if (pin.length >= 8 || busy) return;
    setPin(pin + d);
  }
  function pressBack() {
    setPin(pin.slice(0, -1));
  }

  return (
    <div className="min-h-screen bg-mipiace-stone flex flex-col font-sans">
      <header className="h-[72px] md:h-[88px] [@media(max-height:560px)]:h-11 border-b border-slate-200 flex items-center justify-between px-5 md:px-7 bg-white">
        <Logo size={26} />
        <div className="text-[12.5px] text-slate-500">{registerName}</div>
      </header>
      <main className="flex-1 flex items-center justify-center p-5 [@media(max-height:560px)]:p-2">
        {/* n1-vertical · `grid-cols-1` NO es decorativo, y sin él esta
            pantalla se sale por la derecha en un móvil.
            Medido en el N1 el 2026-10-18 con el cajero de pruebas, cuyo
            email es `mipiacetpv-test-64a68dc7@internal.mipiacetpv.tech`:
            `document.documentElement.scrollWidth` = 581 con una ventana
            de 360, y la tarjeta de cajeros midiendo 561.
            El motivo: sin `grid-template-columns`, la única columna por
            debajo de `md` es IMPLÍCITA y de tamaño `auto`, o sea
            `max-content`, así que una cadena larga sin espacios —un
            email— estira la columna y empuja la página entera. Con
            `grid-cols-1` (que es `repeat(1, minmax(0,1fr))`) la columna
            no puede pasar del ancho disponible y el texto trunca como
            siempre estuvo previsto. Comprobado en el aparato: 581 → 360
            y la tarjeta 561 → 320.
            En el banco no salía porque la cajera de pruebas se llama
            `marta@peluqueriademo.local`, que cabe. */}
        <div className="w-full max-w-5xl grid grid-cols-1 md:grid-cols-2 gap-5 md:gap-8 [@media(max-height:560px)]:gap-2">
          {/* Recent cashiers */}
          <div
            data-testid="pin-cajeros"
            className={`bg-white rounded-3xl border border-slate-200 p-6 md:p-8 [@media(max-height:560px)]:p-3 ${
              pasoCompacto === "pin" ? "hidden md:block" : "block"
            }`}
          >
            <h2 className="text-[14px] font-medium text-slate-500 uppercase tracking-wider mb-5">
              Cajeros recientes
            </h2>
            {recent.length === 0 ? (
              <div className="text-[13.5px] text-slate-500 bg-mipiace-stone rounded-2xl p-4">
                Aún no se ha registrado ningún cajero en este dispositivo.
                Introduce email y PIN abajo.
              </div>
            ) : (
              <div className="space-y-2.5">
                {recent.map((c) => (
                  <button
                    key={c.email}
                    onClick={() => {
                      setSelectedEmail(c.email);
                      setOtherEmail("");
                      setPin("");
                      setError(null);
                      setPasoCompacto("pin");
                    }}
                    className={
                      selectedEmail === c.email
                        ? "w-full p-4 rounded-2xl bg-mipiace-coral-soft border border-mipiace-coral/30 flex items-center gap-4 text-left"
                        : "w-full p-4 rounded-2xl bg-white border border-slate-200 hover:border-slate-300 flex items-center gap-4 text-left"
                    }
                  >
                    <span
                      className={
                        selectedEmail === c.email
                          ? "h-12 w-12 rounded-xl bg-mipiace-coral text-white text-[15px] font-semibold flex items-center justify-center shrink-0"
                          : "h-12 w-12 rounded-xl bg-mipiace-stone text-mipiace-ink text-[15px] font-semibold flex items-center justify-center shrink-0"
                      }
                    >
                      {c.initials ?? initialsOf(c.alias ?? c.email)}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div
                        className={
                          selectedEmail === c.email
                            ? "text-[15px] font-medium text-mipiace-coral-dark truncate"
                            : "text-[15px] font-medium text-mipiace-ink truncate"
                        }
                      >
                        {c.alias ?? c.email}
                      </div>
                      <div className="text-[12.5px] text-slate-500 mt-0.5 truncate">
                        {c.alias ? `${c.email} · ` : ""}
                        Último acceso {formatShortDate(c.lastSeenAt)}
                      </div>
                    </div>
                    <ChevronRight
                      className={
                        selectedEmail === c.email
                          ? "w-4 h-4 text-mipiace-coral"
                          : "w-4 h-4 text-slate-300"
                      }
                    />
                  </button>
                ))}
              </div>
            )}

            <div className="mt-4">
              <label htmlFor="cashierEmail" className="block text-[13px] font-medium text-mipiace-ink-soft mb-1.5">
                {recent.length === 0 ? "Email del cajero" : "O usar otro cajero"}
              </label>
              <input
                id="cashierEmail"
                name="email"
                type="email"
                autoComplete="username"
                inputMode="email"
                value={otherEmail}
                onChange={(e) => {
                  setOtherEmail(e.target.value);
                  setSelectedEmail(null);
                  setPin("");
                  setError(null);
                }}
                placeholder="cajero@negocio.com"
                className="w-full h-12 px-3.5 rounded-xl bg-mipiace-stone border border-transparent text-[14.5px] text-mipiace-ink focus:bg-white focus:border-mipiace-coral/30 focus:ring-2 focus:ring-mipiace-coral/30 focus:outline-none"
              />
              {!selectedEmail && otherEmail.length === 0 && recent.length > 0 && (
                <div className="mt-3 text-[12.5px] text-slate-400 flex items-center gap-1.5">
                  <Plus className="w-3.5 h-3.5" />
                  Empieza a teclear el email del cajero
                </div>
              )}
              {/* n1-vertical · en compacto el teclado de PIN está en el
                  paso siguiente, así que hace falta una puerta. En `md`
                  hacia arriba no existe: las dos tarjetas ya están una
                  al lado de la otra y el teclado se usa directamente. */}
              <button
                type="button"
                data-testid="pin-continuar"
                onClick={() => setPasoCompacto("pin")}
                disabled={otherEmail.trim().length === 0}
                className="md:hidden mt-3 w-full h-12 rounded-xl bg-mipiace-ink text-white text-[14.5px] font-medium disabled:opacity-40"
              >
                Continuar
              </button>
            </div>
          </div>

          {/* Keypad */}
          {/* n1-vertical · LA TARJETA DEL PIN TIENE QUE CABER EN UNA
              PANTALLA DE MÓVIL, Y TAMBIÉN EN UNA BAJA Y ANCHA.

              Dos tamaños, dos repartos distintos:

              · **360×648** (el N1 en vertical, que es como se usará).
                La tarjeta sola mide ~490 px y cabe entera; lo que no
                cabía era tenerla DEBAJO de la de cajeros, y de eso se
                encarga `pasoCompacto`.

              · **720×360** (el N1 en apaisado, y cualquier móvil que
                alguien gire antes de que esta pantalla sepa que no debe
                girar). Con 360 px de alto no hay reparto en columna que
                valga: el teclado solo son 4 filas. Así que por debajo de
                560 px de alto la tarjeta pasa a DOS columnas —teclado a
                la izquierda, estado y «Entrar» a la derecha—, con lo que
                el alto baja a ~230 px y sobra sitio.

              El `grid` es siempre `grid` (antes era `flex flex-col`) para
              no cambiar de `display` dentro de una media query: con una
              columna, las filas salen en el orden del DOM y el resultado
              en `md` es idéntico al de antes del bloque.

              Y el AVISO DE PIN INCORRECTO SUBE: vivía debajo de
              «Entrar», que en el N1 era el único sitio de la pantalla que
              no se veía (punto 8 de la pasada). Ahora va pegado a los
              puntos del PIN, que es donde el cajero está mirando cuando
              acaba de teclearlo. */}
          <div
            data-testid="pin-teclado"
            className={`bg-white rounded-3xl border border-slate-200 p-6 md:p-8 [@media(max-height:560px)]:p-3 grid grid-cols-1 [@media(max-height:560px)]:grid-cols-[auto_minmax(0,1fr)] [@media(max-height:560px)]:gap-x-4 [@media(max-height:560px)]:items-start ${
              pasoCompacto === "cajero" ? "hidden md:grid" : "grid"
            }`}
          >
            {/* Estado: de quién es el PIN, los puntos y el aviso. En
                pantalla baja se va a la columna derecha. */}
            <div className="min-w-0 [@media(max-height:560px)]:col-start-2 [@media(max-height:560px)]:row-start-1">
              <div className="text-center mb-6 [@media(max-height:560px)]:mb-2">
                <div className="text-[14px] text-slate-500 mb-1">Introduce el PIN</div>
                <div className="text-[20px] font-semibold text-mipiace-ink tracking-tight truncate">
                  {(selectedEmail
                    ? recent.find((c) => c.email === selectedEmail)?.alias ??
                      selectedEmail
                    : activeEmail) || "—"}
                </div>
                {/* n1-vertical · la vuelta al paso del cajero. Sólo en
                    compacto: en `md` las dos tarjetas están a la vista. */}
                <button
                  type="button"
                  data-testid="pin-cambiar-cajero"
                  onClick={() => {
                    setPasoCompacto("cajero");
                    setPin("");
                    setError(null);
                  }}
                  className="md:hidden mt-1 text-[12.5px] text-slate-400 underline underline-offset-2"
                >
                  Cambiar de cajero
                </button>
              </div>
              <div className="flex justify-center items-center gap-3 mb-7 [@media(max-height:560px)]:mb-3">
                {pinVisible ? (
                  <span className="text-[22px] font-semibold tracking-[0.35em] tabular-nums text-mipiace-ink min-w-[96px] text-center">
                    {pin.length > 0 ? pin : "····"}
                  </span>
                ) : (
                  [0, 1, 2, 3].map((i) => (
                    <div
                      key={i}
                      className={
                        i < pin.length
                          ? "w-3.5 h-3.5 rounded-full bg-mipiace-coral"
                          : "w-3.5 h-3.5 rounded-full bg-slate-200"
                      }
                    />
                  ))
                )}
                <button
                  type="button"
                  onClick={() => setPinVisible((v) => !v)}
                  aria-label={pinVisible ? "Ocultar PIN" : "Mostrar PIN"}
                  aria-pressed={pinVisible}
                  className="h-8 w-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-mipiace-ink"
                >
                  {pinVisible ? (
                    <EyeOff className="w-[18px] h-[18px]" />
                  ) : (
                    <Eye className="w-[18px] h-[18px]" />
                  )}
                </button>
              </div>
              {/* v1.3-piloto-feedback · Lote 4: tres estados visuales.
                    isLocked → bloque ámbar con countdown, sin botón.
                    attemptsRemaining ≤ 3 → aviso slate (suave) con
                      intentos restantes. No rojo: el primer fallo no
                      debe asustar.
                    error (resto) → rojo clásico (auth fallida con
                      attemptsRemaining=4 cae aquí como mensaje plano si
                      el backend no manda data). */}
              {isLocked && (
                <div
                  data-testid="pin-aviso"
                  className="mb-6 [@media(max-height:560px)]:mb-2 flex items-start gap-2 text-[13px] text-amber-900 bg-amber-50 border border-amber-200 rounded-xl px-3.5 py-2.5"
                >
                  <CircleAlert className="w-4 h-4 mt-px shrink-0 text-amber-600" />
                  <span>
                    Cuenta bloqueada por demasiados intentos. Vuelve a probar en{" "}
                    <strong>{formatCountdown(lockSecondsRemaining)}</strong>.
                  </span>
                </div>
              )}
              {/* n1-vertical · ESTO ERA `attemptsRemaining <= 3`, y por eso en
                    la pasada del N1 «el aviso de PIN incorrecto no se veía»:
                    el backend contesta `attemptsRemaining: 4` en el PRIMER
                    fallo (medido contra la API el 2026-10-18), así que el
                    primer PIN mal no pintaba NADA — el PIN se borraba solo y
                    el cajero no sabía si había fallado él o la máquina.
                    Sigue siendo el aviso suave en gris, que es la decisión
                    de v1.3 («el primer fallo no debe asustar»): lo que
                    cambia es que ahora existe. */}
              {!isLocked && attemptsRemaining != null && (
                <div
                  data-testid="pin-aviso"
                  className="mb-6 [@media(max-height:560px)]:mb-2 flex items-start gap-2 text-[13px] text-slate-600 bg-slate-50 rounded-xl px-3.5 py-2.5"
                >
                  <CircleAlert className="w-4 h-4 mt-px shrink-0 text-amber-500" />
                  <span>
                    Email o PIN incorrecto · Te quedan{" "}
                    <strong>{attemptsRemaining}</strong>{" "}
                    intento{attemptsRemaining === 1 ? "" : "s"} antes del bloqueo.
                  </span>
                </div>
              )}
              {!isLocked && error && (
                <div
                  data-testid="pin-aviso"
                  className="mb-6 [@media(max-height:560px)]:mb-2 flex items-start gap-2 text-[13px] text-red-700 bg-red-50 rounded-xl px-3.5 py-2.5"
                >
                  <AlertCircle className="w-4 h-4 mt-px shrink-0" />
                  <span>{error}</span>
                </div>
              )}
            </div>
            {/* El teclado. En pantalla baja ocupa la columna izquierda y
                las dos filas. */}
            <div className="grid grid-cols-3 gap-2.5 md:gap-3 [@media(max-height:560px)]:gap-1.5 max-w-xs mx-auto w-full [@media(max-height:560px)]:col-start-1 [@media(max-height:560px)]:row-start-1 [@media(max-height:560px)]:row-span-2 [@media(max-height:560px)]:w-auto">
              {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => pressDigit(n)}
                  className="h-14 md:h-16 [@media(max-height:560px)]:h-11 [@media(max-height:560px)]:w-16 bg-mipiace-stone hover:bg-slate-100 rounded-2xl text-[22px] md:text-[24px] [@media(max-height:560px)]:text-[19px] font-medium text-mipiace-ink tabular-nums disabled:opacity-50"
                  disabled={busy}
                >
                  {n}
                </button>
              ))}
              <button
                type="button"
                onClick={() => {
                  setPin("");
                  setError(null);
                }}
                className="h-14 md:h-16 [@media(max-height:560px)]:h-11 rounded-2xl text-[14px] text-slate-400 hover:text-mipiace-ink font-medium"
              >
                Borrar
              </button>
              <button
                type="button"
                onClick={() => pressDigit("0")}
                disabled={busy}
                className="h-14 md:h-16 [@media(max-height:560px)]:h-11 bg-mipiace-stone hover:bg-slate-100 rounded-2xl text-[22px] md:text-[24px] [@media(max-height:560px)]:text-[19px] font-medium text-mipiace-ink tabular-nums disabled:opacity-50"
              >
                0
              </button>
              <button
                type="button"
                onClick={pressBack}
                className="h-14 md:h-16 [@media(max-height:560px)]:h-11 bg-mipiace-stone hover:bg-slate-100 rounded-2xl flex items-center justify-center text-slate-500"
                aria-label="Borrar último dígito"
              >
                <Delete className="w-5 h-5" strokeWidth={2.25} />
              </button>
            </div>
            <button
              type="button"
              onClick={submit}
              disabled={!canSubmit}
              className="mt-6 [@media(max-height:560px)]:mt-0 w-full h-14 [@media(max-height:560px)]:h-12 bg-mipiace-coral hover:bg-mipiace-coral-dark text-white font-medium text-[15px] rounded-2xl disabled:opacity-50 flex items-center justify-center gap-2 [@media(max-height:560px)]:col-start-2 [@media(max-height:560px)]:row-start-2 [@media(max-height:560px)]:self-end"
            >
              {busy && <Loader2 className="w-4 h-4 animate-spin" />}
              Entrar
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}

function initialsOf(email: string): string {
  const local = email.split("@")[0] ?? "";
  return local
    .split(/[._-]/)
    .map((s) => s[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

// v1.3-piloto-feedback · Lote 4: formato compacto del countdown del
// rate-limit. < 60 s = "Ns", >= 60 s = "Mmin Ns" para que el cajero
// entienda de un vistazo cuánto falta sin tener que hacer matemática.
function formatCountdown(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s === 0 ? `${m} min` : `${m} min ${s}s`;
}

function formatShortDate(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  if (
    d.getUTCFullYear() === today.getUTCFullYear() &&
    d.getUTCMonth() === today.getUTCMonth() &&
    d.getUTCDate() === today.getUTCDate()
  ) {
    return `hoy ${d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}`;
  }
  return d.toLocaleDateString("es-ES", { day: "2-digit", month: "short" });
}

export type { CashierLoginResponse };
