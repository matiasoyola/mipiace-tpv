// Overlay de cobro (B4 §3). Sigue literal la pantalla 7 del reference:
//   - Total a cobrar (display grande).
//   - Selector de método (Efectivo, Tarjeta, Bizum, Vale) + Mixto.
//   - Calculadora de efectivo con quick keys.
//   - Resumen lateral con cambio.
//   - Checkboxes imprimir / email / regalo.
//   - Botón "Confirmar cobro" → POST /tickets → modal éxito + polling
//     hasta SYNCED (con número fiscal Holded).

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Banknote,
  Check,
  CreditCard,
  Gift,
  Loader2,
  Plus,
  Smartphone,
  X,
} from "lucide-react";

import { ApiError, apiWithCashier } from "../api.js";
import type { ContactRef } from "./SalePage.contact.js";
import type { CartLine, CartTotals } from "../lib/cart.js";
import type { BusinessType } from "../lib/catalog.js";
import { newId } from "../lib/ids.js";
import { scrollFocusIntoView } from "../lib/visualViewportSync.js";
import { SuccessOverlay } from "./CheckoutPage.successOverlay.js";

const formatEur = (n: number) => n.toFixed(2).replace(".", ",") + " €";

type Method = "CASH" | "CARD" | "BIZUM" | "VOUCHER";

interface PaymentRow {
  method: Method;
  amount: string;
  meta?: { reference?: string };
}

interface TicketResponse {
  ticket: {
    id: string;
    internalNumber: string;
    status: string;
    holdedDocNumber: string | null;
  };
  syncStatus: string;
}

export function CheckoutOverlay(props: {
  shiftId: string;
  registerId: string;
  lines: CartLine[];
  totals: CartTotals;
  contact: ContactRef | null;
  notes: string;
  // v1.3-Servicios-Pinta · Lote 1: vertical del tenant. Determina copy
  // (Cobrar vs Cerrar servicio, A cobrar vs Importe del servicio) y
  // habilita el campo "Atendido por" + nudge cliente para SERVICES.
  businessType: BusinessType | null;
  // v1.3-Servicios-Pinta · Lote 4: callback opcional para abrir el
  // modal de búsqueda de cliente desde el aviso "Servicio sin cliente".
  // SalePage cierra el overlay y abre el ContactSheet existente.
  // v1.3-piloto-feedback · Lote 3: el nudge fue eliminado tras el
  // piloto en Peluquería Sole (2026-05-25) — un click extra por venta
  // que no compensaba (walk-ins sin cliente son la operativa normal).
  // Mantenemos la prop en la firma para no romper callers.
  onRequestAssignContact?: () => void;
  onClose: () => void;
  onConfirmed: () => void;
}) {
  // El externalId es el UUIDv4 de idempotencia (ADR-005). Lo generamos
  // una vez al abrir el overlay; si el cajero pulsa "Confirmar" dos
  // veces sin cambiar nada, el backend devuelve el ticket existente.
  const externalIdRef = useRef<string>(newId());

  const [payments, setPayments] = useState<PaymentRow[]>([
    { method: "CASH", amount: props.totals.total.toFixed(2) },
  ]);
  // v1.3 Lote 2 · cobro mixto en 1 tap. Cuando el cajero entra a mixto,
  // en vez de crear las dos rows con `total/2` y obligar a editar una,
  // abrimos un mini-step donde elige método primario + importe y al
  // confirmar generamos las dos rows con sumas correctas. NULL = modo
  // normal (vista rows o método único).
  const [mixedSplit, setMixedSplit] = useState<
    | null
    | {
        primaryMethod: Method;
        primaryAmount: string;
      }
  >(null);
  const [printIntent, setPrintIntent] = useState(true);
  const [emailIntent, setEmailIntent] = useState<string>(props.contact?.email ?? "");
  const [emailEnabled, setEmailEnabled] = useState(!!props.contact?.email);
  const [giftReceipt, setGiftReceipt] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState<TicketResponse | null>(null);
  // v1.3-Servicios-Pinta · Lote 3: profesional que atendió. Texto libre
  // opcional ≤60 chars, sólo visible en SERVICES. El backend ignora el
  // campo si llega vacío.
  const [attendedBy, setAttendedBy] = useState("");
  // B6 §2: si el descuento del ticket supera el umbral del tenant, el
  // backend devuelve 403 MANAGER_AUTHORIZATION_REQUIRED en el primer
  // intento. Abrimos el modal de autorización; al validar el PIN del
  // encargado guardamos `authorizationToken` y reintentamos la misma
  // request con el token adjunto.
  const [authPrompt, setAuthPrompt] = useState<
    | null
    | {
        effectiveDiscountPct: number;
        thresholdPct: number;
      }
  >(null);
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [authorizedBy, setAuthorizedBy] = useState<string | null>(null);

  const total = props.totals.total;
  const paymentsSum = useMemo(
    () => payments.reduce((acc, p) => acc + parseAmount(p.amount), 0),
    [payments],
  );
  const cashAmount = useMemo(
    () =>
      payments
        .filter((p) => p.method === "CASH")
        .reduce((acc, p) => acc + parseAmount(p.amount), 0),
    [payments],
  );
  const change = cashAmount > 0 ? Math.max(0, paymentsSum - total) : 0;
  // v1.3 Lote 1.D · botón "Importe exacto". Apunta a la primera row CASH
  // si existe y le mete `total − Σ(otras rows)` para que la suma cierre
  // sin cambio. Si la única CASH row YA cubre el total exacto, igual lo
  // re-aplica (idempotente) — el cajero ve confirmado el "Justo".
  const firstCashIdx = payments.findIndex((p) => p.method === "CASH");
  const sumNonCash = payments.reduce(
    (acc, p, j) => (j === firstCashIdx ? acc : acc + parseAmount(p.amount)),
    0,
  );
  const exactCashForFirstCashRow = Math.max(0, total - sumNonCash);
  function applyExactCash(): void {
    if (firstCashIdx === -1) return;
    setPayments((curr) =>
      curr.map((p, j) =>
        j === firstCashIdx
          ? { ...p, amount: exactCashForFirstCashRow.toFixed(2) }
          : p,
      ),
    );
  }
  // B5 §3.2: el botón se habilita siempre que Σ payments ≥ total (con
  // tolerancia 0.01€). Antes exigíamos match exacto y eso bloqueaba
  // overpayments en efectivo (el cambio se calcula aparte).
  const ready = paymentsSum >= total - 0.01;

  // ── atajos teclado ─────────────────────────────────────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (confirmed) return;
      if (e.key === "Escape") {
        e.preventDefault();
        props.onClose();
      } else if (e.key === "Enter" && ready && !submitting) {
        e.preventDefault();
        submit();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [confirmed, ready, submitting]);

  function setPayment(i: number, patch: Partial<PaymentRow>): void {
    setPayments((curr) => curr.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  }
  function addPayment(method: Method): void {
    const remaining = Math.max(0, total - paymentsSum);
    setPayments((curr) => [
      ...curr,
      { method, amount: remaining.toFixed(2) },
    ]);
  }
  function removePayment(i: number): void {
    setPayments((curr) => curr.filter((_, j) => j !== i));
  }

  // v1.3-piloto-feedback · Lote 3: la firma mantiene `opts` por
  // compatibilidad con el reintento tras autorización del encargado;
  // el nudge "Servicio sin cliente" ya no se renderiza.
  async function submit(overrideToken?: string, _opts?: { skipClientNudge?: boolean }) {
    setSubmitting(true);
    setError(null);
    try {
      const linesPayload = props.lines.map((l) => ({
        productId: l.productId ?? undefined,
        variantId: l.variantId ?? undefined,
        holdedProductId: l.holdedProductId ?? undefined,
        nameSnapshot: l.nameSnapshot,
        sku: l.sku,
        units: l.units,
        unitPrice: l.unitPrice,
        // v1.2-Lite Lote 4.B: override del cajero, sólo enviar si está
        // presente. El backend usa este valor como base de cálculo y
        // lo envía a Holded como precio unitario. unitPrice queda como
        // histórico del catálogo.
        unitPriceOverride:
          l.unitPriceOverride != null ? l.unitPriceOverride : undefined,
        discountPct: l.discountPct,
        taxRate: l.taxRate,
        modifiers: l.modifiers.length > 0 ? l.modifiers : undefined,
        // B-Bar-Modifiers · selecciones estructuradas. El backend valida
        // y re-snapshotsea — el front sólo envía groupId/modifierId, los
        // labels y precios los resuelve el backend desde el catálogo.
        modifierSelections:
          l.modifierSelections && l.modifierSelections.length > 0
            ? l.modifierSelections.map((s) => ({
                groupId: s.groupId,
                modifierId: s.modifierId,
              }))
            : undefined,
      }));
      const paymentsPayload = payments.map((p) => ({
        method: p.method,
        amount: parseAmount(p.amount),
        meta: p.meta && Object.keys(p.meta).length > 0 ? p.meta : undefined,
      }));
      const res = await apiWithCashier<TicketResponse>("/tickets", {
        method: "POST",
        body: {
          externalId: externalIdRef.current,
          registerId: props.registerId,
          shiftId: props.shiftId,
          lines: linesPayload,
          payments: paymentsPayload,
          contactHoldedId: props.contact?.holdedContactId,
          notes: props.notes || undefined,
          cashAmount: cashAmount > 0 ? cashAmount : undefined,
          printIntent,
          emailIntent: emailEnabled && emailIntent ? emailIntent : undefined,
          giftReceiptIntent: giftReceipt,
          authorizationToken: overrideToken ?? authToken ?? undefined,
          attendedBy:
            props.businessType === "SERVICES" && attendedBy.trim()
              ? attendedBy.trim()
              : undefined,
        },
      });
      setConfirmed(res);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === "MANAGER_AUTHORIZATION_REQUIRED") {
          const data = err.data as
            | { effectiveDiscountPct?: number; thresholdPct?: number }
            | null;
          setAuthPrompt({
            effectiveDiscountPct: data?.effectiveDiscountPct ?? 0,
            thresholdPct: data?.thresholdPct ?? 0,
          });
          setSubmitting(false);
          return;
        }
        if (
          err.code === "MANAGER_AUTHORIZATION_INVALID" ||
          err.code === "MANAGER_AUTHORIZATION_INSUFFICIENT"
        ) {
          // Token caducó o no cubre el descuento. Limpia y vuelve a pedir.
          setAuthToken(null);
          setAuthorizedBy(null);
          setError(err.message);
          setSubmitting(false);
          return;
        }
        setError(err.message);
      } else setError("Error inesperado");
    } finally {
      setSubmitting(false);
    }
  }

  if (confirmed) {
    return (
      <SuccessOverlay
        ticketId={confirmed.ticket.id}
        internalNumber={confirmed.ticket.internalNumber}
        onDone={props.onConfirmed}
      />
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 min-h-screen bg-mipiace-ink/95 flex items-center justify-center p-4 md:p-7 font-sans overflow-y-auto"
      // v1.3-UX-Iteración Lote 2: el bloque "Confirmar cobro" vive al
      // pie del card derecho. En apaisado tablet el teclado lo tapa
      // al enfocar "Efectivo recibido" o "Email cliente". El
      // padding-bottom dinámico empuja el card hacia arriba justo lo
      // necesario para que el botón quede visible.
      style={{ paddingBottom: "calc(1rem + var(--keyboard-offset, 0px))" }}
    >
      <div className="w-full max-w-5xl bg-white rounded-3xl overflow-hidden grid lg:grid-cols-[1fr_460px]">
        <div className="p-7 md:p-10 flex flex-col">
          <div className="flex items-center justify-between mb-6">
            <button
              onClick={props.onClose}
              className="h-10 w-10 rounded-xl bg-mipiace-stone hover:bg-slate-100 flex items-center justify-center text-slate-600"
              aria-label="Volver"
            >
              <ArrowLeft className="w-[18px] h-[18px]" strokeWidth={2.25} />
            </button>
            <span className="text-[13px] text-slate-500">
              {props.lines.length} línea{props.lines.length === 1 ? "" : "s"}
            </span>
          </div>
          <div className="mb-6">
            <div className="text-[14px] text-slate-500 mb-1">
              {props.businessType === "SERVICES" ? "Importe del servicio" : "A cobrar"}
            </div>
            <div className="text-[56px] md:text-[64px] font-semibold text-mipiace-ink tracking-tight leading-none tabular-nums">
              {formatEur(total)}
            </div>
          </div>

          {mixedSplit && (
            <MixedSplitStep
              total={total}
              state={mixedSplit}
              onChange={setMixedSplit}
              onCancel={() => setMixedSplit(null)}
              onConfirm={(primaryMethod, primaryAmount) => {
                // El método secundario es el "otro" del par CASH↔CARD.
                // Si el primario es CARD/BIZUM/VOUCHER, el secundario
                // es CASH por defecto (es el caso real: "tengo 10 €
                // sueltos y el resto con tarjeta" o viceversa).
                const secondary: Method =
                  primaryMethod === "CASH" ? "CARD" : "CASH";
                const remaining = Math.max(0, total - primaryAmount);
                setPayments([
                  { method: primaryMethod, amount: primaryAmount.toFixed(2) },
                  { method: secondary, amount: remaining.toFixed(2) },
                ]);
                setMixedSplit(null);
              }}
            />
          )}
          <div className="mb-5">
            <div className="text-[13px] font-medium text-mipiace-ink mb-3">Métodos de pago</div>
            <div className="space-y-3">
              {payments.map((p, i) => {
                // v1.3 Lote 1.C · cuanto le falta por meter esta row para
                // que paymentsSum cubra el total. Negativo → la row está
                // por encima, no avisamos. Sólo se pinta rojo si CASH y
                // queda por cubrir; el cajero puede igual confirmar
                // (overpayment efectivo = cambio; underpayment = el
                // guard fuerte está en backend).
                const sumOthers = payments.reduce(
                  (acc, q, j) => (j === i ? acc : acc + parseAmount(q.amount)),
                  0,
                );
                const missingForThisRow = Math.max(
                  0,
                  total - sumOthers - parseAmount(p.amount),
                );
                return (
                  <PaymentRowEditor
                    key={i}
                    payment={p}
                    index={i}
                    canRemove={payments.length > 1}
                    onChange={(patch) => setPayment(i, patch)}
                    onRemove={() => removePayment(i)}
                    missingForThisRow={missingForThisRow}
                  />
                );
              })}
              {/* B-UX-Pulido F4: dos modos.
                  - Modo simple (1 payment row): los 4 botones son
                    excluyentes — cambian el método de la única row,
                    NO añaden otra. Resuelve la confusión que veía el
                    user: "si marco tarjeta, efectivo sigue activo".
                  - Modo mixto (≥2 rows): vuelven a ser "+Método" como
                    siempre y suman al cobro existente.
                  El botón "Cobro mixto" abajo activa el modo mixto
                  desde el modo simple. */}
              {payments.length === 1 && payments[0] ? (
                <>
                  <div className="grid grid-cols-4 gap-2">
                    {(["CASH", "CARD", "BIZUM", "VOUCHER"] as Method[]).map((m) => {
                      const active = payments[0]!.method === m;
                      return (
                        <button
                          key={m}
                          onClick={() => setPayment(0, { method: m })}
                          className={
                            active
                              ? "h-11 rounded-xl bg-mipiace-coral-soft border border-mipiace-coral text-[12.5px] font-medium text-mipiace-coral-dark flex items-center justify-center"
                              : "h-11 rounded-xl bg-mipiace-stone hover:bg-slate-100 text-[12.5px] font-medium text-mipiace-ink flex items-center justify-center"
                          }
                        >
                          {labelFor(m)}
                        </button>
                      );
                    })}
                  </div>
                  <button
                    onClick={() => {
                      // v1.3 Lote 2 · entrar a mixto abre el step
                      // rápido (método primario + importe + atajos),
                      // no se crean dos rows hasta confirmar. Default:
                      // el método primario es el opuesto al actual
                      // para que el cajero sólo escriba el importe.
                      const current = payments[0]!.method;
                      const primary: Method =
                        current === "CASH" ? "CARD" : "CASH";
                      setMixedSplit({ primaryMethod: primary, primaryAmount: "" });
                    }}
                    className="mt-2 h-9 w-full rounded-xl border border-dashed border-slate-300 hover:border-mipiace-coral/50 hover:bg-mipiace-coral-soft/40 text-[12px] font-medium text-slate-500 hover:text-mipiace-coral-dark flex items-center justify-center gap-1.5"
                  >
                    <Plus className="w-3 h-3" />
                    Cobro mixto (partir entre métodos)
                  </button>
                </>
              ) : (
                <div className="grid grid-cols-4 gap-2">
                  {(["CASH", "CARD", "BIZUM", "VOUCHER"] as Method[]).map((m) => (
                    <button
                      key={m}
                      onClick={() => addPayment(m)}
                      className="h-11 rounded-xl bg-mipiace-stone hover:bg-slate-100 text-[12.5px] font-medium text-mipiace-ink flex items-center justify-center gap-1.5"
                    >
                      <Plus className="w-3 h-3" />
                      {labelFor(m)}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* v1.3 Lote 1.D · "Importe exacto" destacado debajo del input
              recibido. Sólo aparece si hay row CASH (el botón actúa sobre
              la primera). Sustituye al antiguo "Justo" enterrado en la
              fila de atajos — 1 tap deja change=0. */}
          {firstCashIdx !== -1 && (
            <button
              onClick={applyExactCash}
              className="mb-5 w-full h-12 rounded-2xl bg-mipiace-coral-soft hover:bg-mipiace-coral-soft/70 border border-mipiace-coral/30 text-mipiace-coral-dark text-[14px] font-medium flex items-center justify-center gap-2"
            >
              <span>Importe exacto</span>
              <span className="text-slate-400">·</span>
              <span className="tabular-nums">{formatEur(exactCashForFirstCashRow)}</span>
            </button>
          )}

          <CashQuickKeys
            payments={payments}
            total={total}
            onChange={setPayments}
          />
        </div>
        <div className="bg-mipiace-stone p-7 md:p-10 flex flex-col">
          {cashAmount > 0 && (
            <div className="mb-6">
              <div className="text-[13px] text-slate-500 mb-1">Cambio</div>
              <div className="text-[44px] md:text-[52px] font-semibold text-mipiace-coral tracking-tight leading-none tabular-nums">
                {formatEur(change)}
              </div>
            </div>
          )}
          <div className="bg-white rounded-2xl p-5 mb-6">
            <div className="text-[12px] uppercase tracking-wider font-medium text-slate-400 mb-3">
              Resumen
            </div>
            <div className="space-y-2 text-[13.5px]">
              <div className="flex justify-between">
                <span className="text-slate-500">Subtotal</span>
                <span className="tabular-nums">{formatEur(props.totals.subtotalNet)}</span>
              </div>
              {props.totals.discount > 0 && (
                <div className="flex justify-between">
                  <span className="text-slate-500">Descuento</span>
                  <span className="text-mipiace-coral tabular-nums">
                    −{formatEur(props.totals.discount)}
                  </span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-slate-500">IVA</span>
                <span className="tabular-nums">{formatEur(props.totals.tax)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Recibido</span>
                <span className="tabular-nums">{formatEur(paymentsSum)}</span>
              </div>
              <div className="pt-2 border-t border-slate-100 flex justify-between font-medium text-mipiace-ink">
                <span>Total</span>
                <span className="tabular-nums">{formatEur(total)}</span>
              </div>
            </div>
          </div>

          {/* v1.3-Servicios-Pinta · Lote 3: profesional que atendió.
              Sólo visible en SERVICES. Texto libre opcional ≤60 chars
              que se imprime en el ticket como "Atendido por: María".
              Hint con el `cliente` actual para que el cajero recuerde
              vincular ambos datos. */}
          {props.businessType === "SERVICES" && (
            <div className="bg-white rounded-2xl p-4 mb-4">
              <label
                htmlFor="checkoutAttendedBy"
                className="block text-[12.5px] uppercase tracking-wider font-medium text-slate-400 mb-2"
              >
                Atendido por (opcional)
              </label>
              <input
                id="checkoutAttendedBy"
                value={attendedBy}
                onChange={(e) => setAttendedBy(e.target.value.slice(0, 60))}
                onFocus={scrollFocusIntoView}
                maxLength={60}
                placeholder="Nombre del profesional"
                className="w-full h-11 px-3 rounded-xl bg-mipiace-stone border border-transparent text-[13.5px] focus:bg-white focus:border-mipiace-coral/30 focus:ring-2 focus:ring-mipiace-coral/30 focus:outline-none"
              />
            </div>
          )}

          <div className="space-y-2 mb-6">
            <Checkbox
              checked={printIntent}
              onChange={setPrintIntent}
              label="Imprimir ticket"
              hint="La impresión real llega en B5."
            />
            <Checkbox
              checked={emailEnabled}
              onChange={setEmailEnabled}
              label="Enviar por email"
              right={
                emailEnabled ? (
                  <input
                    value={emailIntent}
                    onChange={(e) => setEmailIntent(e.target.value)}
                    onFocus={scrollFocusIntoView}
                    type="email"
                    inputMode="email"
                    autoCapitalize="off"
                    autoCorrect="off"
                    spellCheck={false}
                    placeholder="cliente@ejemplo.com"
                    className="h-8 px-2.5 rounded-md bg-mipiace-stone border border-transparent text-[12.5px] focus:bg-white focus:border-mipiace-coral/30 focus:ring-1 focus:ring-mipiace-coral/30 focus:outline-none"
                  />
                ) : null
              }
            />
            <Checkbox
              checked={giftReceipt}
              onChange={setGiftReceipt}
              label="Ticket regalo"
              hint="Genera intent; la impresión llega en B5."
            />
          </div>
          {error && (
            <div className="text-[12.5px] text-red-700 bg-red-50 rounded-xl p-3 mb-3">
              {error}
            </div>
          )}
          {authorizedBy && (
            <div className="text-[12px] text-emerald-700 bg-emerald-50 rounded-xl px-3 py-2 mb-3 flex items-center gap-2">
              <Check className="w-3.5 h-3.5" />
              Descuento autorizado por {authorizedBy}
            </div>
          )}
          {/* v1.3-piloto-feedback · Lote 3: el nudge "Servicio sin
              cliente" fue eliminado tras el piloto en Peluquería Sole
              (2026-05-25). Cobrar walk-ins sin cliente es la operativa
              normal en SERVICES; el aviso añadía un tap extra por venta
              sin un beneficio claro. */}
          <button
            onClick={() => submit()}
            disabled={!ready || submitting}
            className="mt-auto w-full h-16 bg-mipiace-coral hover:bg-mipiace-coral-dark text-white font-medium text-[16px] rounded-2xl flex items-center justify-between px-6 disabled:opacity-50"
          >
            <span className="flex items-center gap-2">
              {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
              {props.businessType === "SERVICES" ? "Cobrar" : "Confirmar cobro"}
            </span>
            <span className="tabular-nums">{formatEur(total)}</span>
          </button>
        </div>
      </div>
      {authPrompt && (
        <ManagerAuthorizationModal
          context={authPrompt}
          onClose={() => setAuthPrompt(null)}
          onAuthorized={(token, managerEmail) => {
            setAuthToken(token);
            setAuthorizedBy(managerEmail);
            setAuthPrompt(null);
            // Reintentamos automáticamente — el cajero no debe pulsar
            // dos veces. Pasamos el token explícitamente para evitar
            // condicionar la llamada al state ya en vuelo.
            submit(token);
          }}
        />
      )}
    </div>
  );
}

function ManagerAuthorizationModal({
  context,
  onClose,
  onAuthorized,
}: {
  context: { effectiveDiscountPct: number; thresholdPct: number };
  onClose: () => void;
  onAuthorized: (token: string, managerEmail: string) => void;
}) {
  const [email, setEmail] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await apiWithCashier<{
        authorizationToken: string;
        managerEmail: string;
      }>("/admin/auth/manager-authorize", {
        method: "POST",
        body: {
          managerEmail: email,
          managerPin: pin,
          reason: "discount_over_threshold",
          ticketContext: {
            discountPct: context.effectiveDiscountPct,
          },
        },
      });
      onAuthorized(res.authorizationToken, res.managerEmail);
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
      else setError("Error inesperado");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] bg-mipiace-ink/70 flex items-center justify-center p-4">
      <form
        onSubmit={onSubmit}
        className="bg-white w-full max-w-md rounded-3xl p-6 md:p-7"
      >
        <h2 className="text-[18px] font-semibold text-mipiace-ink mb-1">
          Autorización del encargado
        </h2>
        <p className="text-[13px] text-slate-500 mb-5">
          El descuento aplicado del{" "}
          <strong className="text-mipiace-ink">
            {context.effectiveDiscountPct.toFixed(2)}%
          </strong>{" "}
          supera el umbral del tenant ({context.thresholdPct.toFixed(2)}%).
          Pide al encargado que introduzca su PIN para autorizar este cobro.
        </p>
        <div className="space-y-3">
          <div>
            <label
              htmlFor="managerEmail"
              className="block text-[13px] font-medium text-mipiace-ink-soft mb-1"
            >
              Email del encargado
            </label>
            <input
              id="managerEmail"
              name="managerEmail"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full h-12 px-3.5 rounded-xl bg-mipiace-stone border border-transparent text-[14.5px] focus:bg-white focus:border-mipiace-coral/30 focus:ring-2 focus:ring-mipiace-coral/30 focus:outline-none"
            />
          </div>
          <div>
            <label
              htmlFor="managerPin"
              className="block text-[13px] font-medium text-mipiace-ink-soft mb-1"
            >
              PIN
            </label>
            <input
              id="managerPin"
              name="managerPin"
              type="password"
              autoComplete="off"
              inputMode="numeric"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              required
              minLength={4}
              maxLength={16}
              className="w-full h-12 px-3.5 rounded-xl bg-mipiace-stone border border-transparent text-[14.5px] tabular-nums tracking-widest focus:bg-white focus:border-mipiace-coral/30 focus:ring-2 focus:ring-mipiace-coral/30 focus:outline-none"
            />
          </div>
        </div>
        {error && (
          <div className="text-[12.5px] text-red-700 bg-red-50 rounded-xl p-3 mt-4">
            {error}
          </div>
        )}
        <div className="flex gap-2.5 mt-5">
          <button
            type="submit"
            disabled={busy || !email || !pin}
            className="flex-1 h-12 bg-mipiace-coral hover:bg-mipiace-coral-dark text-white text-[14px] font-medium rounded-2xl disabled:opacity-50"
          >
            {busy ? "Validando…" : "Autorizar"}
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="h-12 px-5 bg-mipiace-stone hover:bg-slate-100 text-mipiace-ink text-[14px] font-medium rounded-2xl disabled:opacity-50"
          >
            Cancelar
          </button>
        </div>
      </form>
    </div>
  );
}

function PaymentRowEditor({
  payment,
  index,
  canRemove,
  onChange,
  onRemove,
  missingForThisRow,
}: {
  payment: PaymentRow;
  index: number;
  canRemove: boolean;
  onChange: (patch: Partial<PaymentRow>) => void;
  onRemove: () => void;
  // v1.3 Lote 1.C · cuánto falta por meter en esta row para que la suma
  // global cubra el total. 0 = ya cubierta o por encima. Sólo se pinta
  // alerta visual en CASH; en otros métodos un underpayment es
  // típicamente porque el cajero piensa partir el cobro y la suma queda
  // en otra row.
  missingForThisRow: number;
}) {
  const Icon =
    payment.method === "CASH"
      ? Banknote
      : payment.method === "CARD"
      ? CreditCard
      : payment.method === "BIZUM"
      ? Smartphone
      : Gift;
  const showShort =
    payment.method === "CASH" && missingForThisRow > 0.005;
  return (
    <div>
      <div className="flex items-stretch gap-2">
        <div className="flex-1 h-14 rounded-2xl bg-mipiace-coral-soft border border-mipiace-coral/25 px-4 flex items-center gap-2.5 text-mipiace-coral-dark">
          <Icon className="w-[17px] h-[17px]" strokeWidth={2.1} />
          <span className="text-[13.5px] font-medium">{labelFor(payment.method)}</span>
        </div>
        <input
          value={payment.amount}
          onChange={(e) => onChange({ amount: e.target.value })}
          onFocus={(e) => {
            e.target.select();
            scrollFocusIntoView(e);
          }}
          inputMode="decimal"
          className={
            showShort
              ? "w-32 h-14 px-3 text-[18px] font-semibold bg-white border-2 border-mipiace-coral-dark rounded-2xl tabular-nums text-right focus:ring-2 focus:ring-mipiace-coral/40 focus:outline-none"
              : "w-32 h-14 px-3 text-[18px] font-semibold bg-mipiace-stone border border-transparent rounded-2xl tabular-nums text-right focus:bg-white focus:border-mipiace-coral/30 focus:ring-2 focus:ring-mipiace-coral/40 focus:outline-none"
          }
        />
        {(payment.method === "CARD" || payment.method === "BIZUM") && (
          <input
            value={payment.meta?.reference ?? ""}
            onChange={(e) => onChange({ meta: { reference: e.target.value } })}
            placeholder={payment.method === "CARD" ? "últ. 4" : "ref."}
            className="w-28 h-14 px-3 text-[13px] bg-mipiace-stone border border-transparent rounded-2xl focus:bg-white focus:border-mipiace-coral/30 focus:ring-2 focus:ring-mipiace-coral/40 focus:outline-none"
          />
        )}
        {canRemove && index > 0 && (
          <button
            onClick={onRemove}
            aria-label="Quitar pago"
            className="h-14 w-14 rounded-2xl bg-mipiace-stone hover:bg-slate-100 flex items-center justify-center text-slate-500"
          >
            <X className="w-4 h-4" strokeWidth={2.1} />
          </button>
        )}
      </div>
      {showShort && (
        <div className="mt-1 text-[12px] text-mipiace-coral-dark tabular-nums text-right pr-1">
          Falta {formatEur(missingForThisRow)}
        </div>
      )}
    </div>
  );
}

// v1.3 Lote 2 · step rápido para configurar cobro mixto. Vive dentro
// del mismo card del modal (no es una librería de modales nueva). Se
// renderiza arriba de la lista de payment rows mientras `mixedSplit !=
// null`; al confirmar, el caller crea las dos rows con la suma
// correcta. Default UX: 3 taps para "tengo 10 € sueltos, el resto con
// tarjeta" (mixto → input 10 → confirmar) — vs 4 taps del flujo viejo.
function MixedSplitStep({
  total,
  state,
  onChange,
  onConfirm,
  onCancel,
}: {
  total: number;
  state: { primaryMethod: Method; primaryAmount: string };
  onChange: (next: { primaryMethod: Method; primaryAmount: string }) => void;
  onConfirm: (primaryMethod: Method, primaryAmount: number) => void;
  onCancel: () => void;
}) {
  const parsed = parseAmount(state.primaryAmount);
  // Capeamos al total: no tiene sentido que el primario supere el
  // total (el secundario quedaría 0 o negativo). Si el cajero teclea
  // más, mostramos un capeado visual al confirmar.
  const capped = Math.min(Math.max(0, parsed), total);
  const remaining = Math.max(0, total - capped);
  function bump(delta: number) {
    // +20 sobre 0 → 20; +20 sobre 20 → 40; capeado al total para no
    // pedir al cliente más del importe. Si el cajero quiere
    // overpayment en efectivo del primario, lo hace en la vista rows.
    const next = Math.min(total, parsed + delta);
    onChange({ ...state, primaryAmount: next.toFixed(2) });
  }
  return (
    <div className="mb-5 rounded-2xl border border-mipiace-coral/30 bg-mipiace-coral-soft/40 p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="text-[13px] font-medium text-mipiace-coral-dark">
          Partir cobro
        </div>
        <button
          onClick={onCancel}
          className="h-7 w-7 rounded-lg hover:bg-white text-slate-500 flex items-center justify-center"
          aria-label="Cancelar mixto"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="grid grid-cols-[160px_1fr] gap-2 mb-3">
        <select
          value={state.primaryMethod}
          onChange={(e) => onChange({ ...state, primaryMethod: e.target.value as Method })}
          className="h-12 px-3 rounded-xl bg-white border border-slate-200 text-[13.5px] font-medium text-mipiace-ink focus:outline-none focus:ring-2 focus:ring-mipiace-coral/30"
        >
          {(["CASH", "CARD", "BIZUM", "VOUCHER"] as Method[]).map((m) => (
            <option key={m} value={m}>
              {labelFor(m)}
            </option>
          ))}
        </select>
        <input
          value={state.primaryAmount}
          onChange={(e) => onChange({ ...state, primaryAmount: e.target.value })}
          onFocus={(e) => {
            e.target.select();
            scrollFocusIntoView(e);
          }}
          inputMode="decimal"
          placeholder="0,00"
          className="h-12 px-3 text-[18px] font-semibold bg-white border border-slate-200 rounded-xl tabular-nums text-right focus:outline-none focus:ring-2 focus:ring-mipiace-coral/40"
        />
      </div>
      <div className="grid grid-cols-4 gap-2 mb-3">
        {[5, 10, 20, 50].map((n) => (
          <button
            key={n}
            onClick={() => bump(n)}
            className="h-10 rounded-xl bg-white hover:bg-slate-50 text-[13px] font-medium text-mipiace-ink border border-slate-200"
          >
            +{n}
          </button>
        ))}
      </div>
      <div className="flex items-center justify-between text-[12.5px] text-slate-600 mb-3">
        <span>
          Resto con{" "}
          <span className="font-medium text-mipiace-ink">
            {labelFor(state.primaryMethod === "CASH" ? "CARD" : "CASH")}
          </span>
        </span>
        <span className="tabular-nums font-medium text-mipiace-ink">
          {remaining.toFixed(2).replace(".", ",")} €
        </span>
      </div>
      <button
        onClick={() => onConfirm(state.primaryMethod, capped)}
        disabled={capped <= 0}
        className="w-full h-11 rounded-xl bg-mipiace-coral hover:bg-mipiace-coral-dark text-white text-[13.5px] font-medium disabled:opacity-50"
      >
        Aplicar mixto
      </button>
    </div>
  );
}

function CashQuickKeys({
  payments,
  onChange,
}: {
  payments: PaymentRow[];
  total: number;
  onChange: (payments: PaymentRow[]) => void;
}) {
  const cashIdx = payments.findIndex((p) => p.method === "CASH");
  if (cashIdx === -1) return null;
  // v1.3 Lote 1.D · "Justo" se eliminó de esta fila — la acción vive
  // arriba como botón ancho destacado "Importe exacto". Aquí sólo
  // quedan los billetes típicos y la C de borrar.
  //
  // v1.3-UX-Iteración-fixes Fix 4: los atajos SOBREESCRIBEN el campo.
  // Antes 5/10/20/50 sumaban al valor actual (10 + tap "+20" = 30) lo
  // que confundía al cajero del piloto y dejaba cobros mal calculados.
  // Sólo 100 ya hacía SET; ahora todos lo hacen. La C sigue siendo
  // limpiar a 0.
  function setCash(action: number | "C") {
    onChange(
      payments.map((p, i) => {
        if (i !== cashIdx) return p;
        const next = action === "C" ? 0 : action;
        return { ...p, amount: next.toFixed(2) };
      }),
    );
  }
  return (
    <div className="mt-4">
      <div className="text-[13px] font-medium text-mipiace-ink mb-3">
        Atajos efectivo
      </div>
      <div className="grid grid-cols-3 gap-2">
        {[5, 10, 20, 50, 100].map((n) => (
          <button
            key={n}
            onClick={() => setCash(n)}
            className="h-12 rounded-xl bg-mipiace-stone hover:bg-slate-100 text-[14px] font-medium text-mipiace-ink"
          >
            {n}
          </button>
        ))}
        <button
          onClick={() => setCash("C")}
          className="h-12 rounded-xl bg-mipiace-stone hover:bg-slate-100 text-[14px] font-medium text-mipiace-ink"
        >
          C
        </button>
      </div>
    </div>
  );
}

function Checkbox({
  checked,
  onChange,
  label,
  hint,
  right,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
  right?: React.ReactNode;
}) {
  // El <label> propaga el click al <input type="checkbox"> anidado
  // (comportamiento nativo), así que no necesitamos onClick redundante
  // en el <span> "visual". El bug previo (B-UX-Pulido F0) era
  // exactamente eso: span.onClick + input.onChange disparaban onChange
  // dos veces y el estado se quedaba como estaba.
  return (
    <label className="flex items-center gap-3 p-3 bg-white rounded-xl cursor-pointer">
      <span
        aria-hidden="true"
        className={
          checked
            ? "w-4 h-4 rounded border-2 border-mipiace-coral bg-mipiace-coral flex items-center justify-center"
            : "w-4 h-4 rounded border-2 border-slate-300"
        }
      >
        {checked && <Check className="w-3 h-3 text-white" strokeWidth={3} />}
      </span>
      <input
        type="checkbox"
        className="sr-only"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <div className="flex-1 min-w-0">
        <div className="text-[13.5px] text-mipiace-ink font-medium">{label}</div>
        {hint && <div className="text-[11.5px] text-slate-400">{hint}</div>}
      </div>
      {/* stopPropagation evita que un click en el input de email
          (cuando emailEnabled) propague al <label> y toggle el
          checkbox al intentar escribir. */}
      {right && (
        <span onClick={(e) => e.stopPropagation()} className="flex-shrink-0">
          {right}
        </span>
      )}
    </label>
  );
}

function labelFor(m: Method): string {
  if (m === "CASH") return "Efectivo";
  if (m === "CARD") return "Tarjeta";
  if (m === "BIZUM") return "Bizum";
  return "Vale";
}

function parseAmount(s: string): number {
  const n = Number(s.replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}
