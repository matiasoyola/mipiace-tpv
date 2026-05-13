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
  onClose: () => void;
  onConfirmed: () => void;
}) {
  // El externalId es el UUIDv4 de idempotencia (ADR-005). Lo generamos
  // una vez al abrir el overlay; si el cajero pulsa "Confirmar" dos
  // veces sin cambiar nada, el backend devuelve el ticket existente.
  const externalIdRef = useRef<string>(crypto.randomUUID());

  const [payments, setPayments] = useState<PaymentRow[]>([
    { method: "CASH", amount: props.totals.total.toFixed(2) },
  ]);
  const [printIntent, setPrintIntent] = useState(true);
  const [emailIntent, setEmailIntent] = useState<string>(props.contact?.email ?? "");
  const [emailEnabled, setEmailEnabled] = useState(!!props.contact?.email);
  const [giftReceipt, setGiftReceipt] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState<TicketResponse | null>(null);
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

  async function submit(overrideToken?: string) {
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
        discountPct: l.discountPct,
        taxRate: l.taxRate,
        modifiers: l.modifiers.length > 0 ? l.modifiers : undefined,
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
    <div className="fixed inset-0 z-50 min-h-screen bg-mipiace-ink/95 flex items-center justify-center p-4 md:p-7 font-sans overflow-y-auto">
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
            <div className="text-[14px] text-slate-500 mb-1">A cobrar</div>
            <div className="text-[56px] md:text-[64px] font-semibold text-mipiace-ink tracking-tight leading-none tabular-nums">
              {formatEur(total)}
            </div>
          </div>

          <div className="mb-5">
            <div className="text-[13px] font-medium text-mipiace-ink mb-3">Métodos de pago</div>
            <div className="space-y-3">
              {payments.map((p, i) => (
                <PaymentRowEditor
                  key={i}
                  payment={p}
                  index={i}
                  canRemove={payments.length > 1}
                  onChange={(patch) => setPayment(i, patch)}
                  onRemove={() => removePayment(i)}
                />
              ))}
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
            </div>
          </div>

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
          <button
            onClick={() => submit()}
            disabled={!ready || submitting}
            className="mt-auto w-full h-16 bg-mipiace-coral hover:bg-mipiace-coral-dark text-white font-medium text-[16px] rounded-2xl flex items-center justify-between px-6 disabled:opacity-50"
          >
            <span className="flex items-center gap-2">
              {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
              Confirmar cobro
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
}: {
  payment: PaymentRow;
  index: number;
  canRemove: boolean;
  onChange: (patch: Partial<PaymentRow>) => void;
  onRemove: () => void;
}) {
  const Icon =
    payment.method === "CASH"
      ? Banknote
      : payment.method === "CARD"
      ? CreditCard
      : payment.method === "BIZUM"
      ? Smartphone
      : Gift;
  return (
    <div className="flex items-stretch gap-2">
      <div className="flex-1 h-14 rounded-2xl bg-mipiace-coral-soft border border-mipiace-coral/25 px-4 flex items-center gap-2.5 text-mipiace-coral-dark">
        <Icon className="w-[17px] h-[17px]" strokeWidth={2.1} />
        <span className="text-[13.5px] font-medium">{labelFor(payment.method)}</span>
      </div>
      <input
        value={payment.amount}
        onChange={(e) => onChange({ amount: e.target.value })}
        inputMode="decimal"
        className="w-32 h-14 px-3 text-[18px] font-semibold bg-mipiace-stone border border-transparent rounded-2xl tabular-nums text-right focus:bg-white focus:border-mipiace-coral/30 focus:ring-2 focus:ring-mipiace-coral/40 focus:outline-none"
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
  );
}

function CashQuickKeys({
  payments,
  total,
  onChange,
}: {
  payments: PaymentRow[];
  total: number;
  onChange: (payments: PaymentRow[]) => void;
}) {
  const cashIdx = payments.findIndex((p) => p.method === "CASH");
  if (cashIdx === -1) return null;
  function bump(addEur: number | "justo" | "C" | "100") {
    onChange(
      payments.map((p, i) => {
        if (i !== cashIdx) return p;
        const curr = parseAmount(p.amount);
        let next = curr;
        if (addEur === "justo") next = total;
        else if (addEur === "C") next = 0;
        else if (addEur === "100") next = 100;
        else next = curr + addEur;
        return { ...p, amount: next.toFixed(2) };
      }),
    );
  }
  return (
    <div className="mt-4">
      <div className="text-[13px] font-medium text-mipiace-ink mb-3">
        Atajos efectivo
      </div>
      <div className="grid grid-cols-4 gap-2">
        {[5, 10, 20, 50].map((n) => (
          <button
            key={n}
            onClick={() => bump(n)}
            className="h-12 rounded-xl bg-mipiace-stone hover:bg-slate-100 text-[14px] font-medium text-mipiace-ink"
          >
            +{n}
          </button>
        ))}
        <button
          onClick={() => bump("justo")}
          className="h-12 rounded-xl bg-mipiace-stone hover:bg-slate-100 text-[14px] font-medium text-mipiace-ink"
        >
          Justo
        </button>
        <button
          onClick={() => bump("100")}
          className="h-12 rounded-xl bg-mipiace-stone hover:bg-slate-100 text-[14px] font-medium text-mipiace-ink"
        >
          100
        </button>
        <button
          onClick={() => bump("C")}
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
  return (
    <label className="flex items-center gap-3 p-3 bg-white rounded-xl cursor-pointer">
      <span
        onClick={() => onChange(!checked)}
        className={
          checked
            ? "w-4 h-4 rounded border-2 border-mipiace-coral bg-mipiace-coral flex items-center justify-center cursor-pointer"
            : "w-4 h-4 rounded border-2 border-slate-300 cursor-pointer"
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
      {right}
    </label>
  );
}

function SuccessOverlay({
  ticketId,
  internalNumber,
  onDone,
}: {
  ticketId: string;
  internalNumber: string;
  onDone: () => void;
}) {
  const [docNumber, setDocNumber] = useState<string | null>(null);
  const [status, setStatus] = useState("PENDING_SYNC");

  useEffect(() => {
    let cancelled = false;
    let attempts = 0;
    async function tick() {
      attempts += 1;
      try {
        const res = await apiWithCashier<{ ticket: { holdedDocNumber: string | null; status: string } }>(
          `/tickets/${ticketId}`,
        );
        if (cancelled) return;
        setStatus(res.ticket.status);
        if (res.ticket.holdedDocNumber) {
          setDocNumber(res.ticket.holdedDocNumber);
        }
      } catch {
        /* ignore — seguimos polleando */
      }
      if (!cancelled && attempts < 60 && status !== "SYNCED" && status !== "SYNC_FAILED") {
        setTimeout(tick, 1000);
      }
    }
    tick();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticketId]);

  return (
    <div className="fixed inset-0 z-50 bg-mipiace-ink/95 flex items-center justify-center p-5 font-sans">
      <div className="bg-white rounded-3xl border border-slate-200 w-full max-w-md p-8 text-center">
        <div className="h-16 w-16 mx-auto rounded-2xl bg-emerald-100 text-emerald-700 flex items-center justify-center mb-4">
          <Check className="w-8 h-8" strokeWidth={2.5} />
        </div>
        <h1 className="text-[22px] font-semibold text-mipiace-ink tracking-tight">
          Ticket cobrado
        </h1>
        <div className="text-[14px] text-slate-500 mt-1">
          Número interno <span className="tabular-nums">#{internalNumber}</span>
        </div>
        <div className="mt-5 bg-mipiace-stone rounded-xl p-4">
          {docNumber ? (
            <>
              <div className="text-[12px] uppercase tracking-wider text-slate-400">
                Número fiscal Holded
              </div>
              <div className="text-[24px] font-semibold tabular-nums text-mipiace-ink mt-1">
                {docNumber}
              </div>
            </>
          ) : status === "SYNC_FAILED" ? (
            <div className="text-[13px] text-red-700">
              Holded rechazó el envío. El ticket queda en la bandeja de errores.
            </div>
          ) : (
            <div className="text-[13px] text-slate-500 flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin text-mipiace-coral" />
              Sincronizando con Holded…
            </div>
          )}
        </div>
        <button
          onClick={onDone}
          className="mt-6 w-full h-12 rounded-2xl bg-mipiace-coral hover:bg-mipiace-coral-dark text-white font-medium text-[14px]"
        >
          Nueva venta
        </button>
      </div>
    </div>
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
