// Overlay de cobro (B4 §3).
//
// v1.4-Checkout-Redesign (2026-06-03): rediseño responsivo completo. El
// modal antiguo asumía viewport gigante (~2000px) y rompía en tablet y
// phone. Estructura nueva:
//   - Header sticky con Subtotal + IVA (no scroll).
//   - Body scrollable con listado de artículos read-only + opciones
//     (atendido por, imprimir/email/regalo, notas).
//   - Footer sticky con método tabs + atajos efectivo + TOTAL + botón
//     COBRAR. Respeta --keyboard-offset (Lote 2 v1.3-UX-Iteración) para
//     no quedar tapado por el teclado virtual.
//
// Decisiones explícitas:
//   - Listado de líneas es informativo, no editable. Edición pasa por
//     SalePage antes de cobrar.
//   - Métodos son tabs horizontales (no cards verticales).
//   - Eliminamos el display "0,00 €" gigante del panel derecho viejo y
//     el botón redundante "Efectivo · 51,00" arriba.
//   - Atajos efectivo (5/10/20/50/100/C) en 1 fila y siguen siendo
//     SET (hotfix Fix 4 de v1.3-UX-Iteración-fixes).
//   - Mantiene compatibilidad con cobro mixto, importe exacto, manager
//     authorization (B6 §2) y atendido por (v1.3-Servicios-Pinta Lote 3).

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Banknote,
  Check,
  CreditCard,
  Gift,
  Loader2,
  Smartphone,
  X,
} from "lucide-react";

import { ApiError, apiWithCashier } from "../api.js";
import type { ContactRef } from "./SalePage.contact.js";
import { computeLine } from "../lib/cart.js";
import type { CartLine, CartTotals } from "../lib/cart.js";
import type { BusinessType } from "../lib/catalog.js";
import { newId } from "../lib/ids.js";
import {
  isPermanentRejection,
  outboxAdd,
  outboxDelete,
  outboxReleaseAfterFailure,
} from "../lib/outbox.js";
import { scrollFocusIntoView } from "../lib/visualViewportSync.js";
import {
  PendingSaleOverlay,
  SuccessOverlay,
} from "./CheckoutPage.successOverlay.js";

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
  // v1.3-piloto-feedback · Lote 3: nudge eliminado tras piloto Sole
  // (2026-05-25). Mantenemos la prop por compatibilidad de firma.
  onRequestAssignContact?: () => void;
  onClose: () => void;
  onConfirmed: () => void;
}) {
  // externalId = UUIDv4 de idempotencia (ADR-005). Generado al abrir el
  // overlay; si el cajero pulsa "Cobrar" dos veces, el backend devuelve
  // el ticket existente.
  const externalIdRef = useRef<string>(newId());

  const [payments, setPayments] = useState<PaymentRow[]>([
    { method: "CASH", amount: props.totals.total.toFixed(2) },
  ]);
  // v1.3 Lote 2: mini-step de cobro mixto (método primario + importe).
  // Al confirmar genera dos rows con sumas correctas. NULL = modo normal.
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
  // v1.5-consistencia-C: "synced" = el POST confirmó; "pendingLocal" =
  // la venta está a salvo en el outbox local pero el servidor aún no
  // la tiene (red caída / 5xx) — el reenvío en background la subirá.
  const [confirmed, setConfirmed] = useState<
    | null
    | { kind: "synced"; res: TicketResponse }
    | { kind: "pendingLocal"; externalId: string }
  >(null);
  // v1.3-Servicios-Pinta · Lote 3: profesional que atendió. Texto libre
  // opcional ≤60 chars, sólo visible en SERVICES.
  const [attendedBy, setAttendedBy] = useState("");
  // B6 §2: si el descuento del ticket supera el umbral del tenant, el
  // backend devuelve 403 MANAGER_AUTHORIZATION_REQUIRED. Abrimos el
  // modal del encargado, validamos PIN y reintentamos con el token.
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
  // v1.3 Lote 1.D · "Importe exacto" apunta a la primera row CASH y le
  // mete `total − Σ(otras rows)` para que la suma cierre sin cambio.
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
  // v1.3-UX-Iteración-fixes Fix 4: los atajos SET (no SUM). Antes el
  // piloto se confundía al ver 10 + tap 20 = 30. C = limpiar a 0.
  function setCashTo(amount: number): void {
    if (firstCashIdx === -1) return;
    setPayments((curr) =>
      curr.map((p, j) =>
        j === firstCashIdx ? { ...p, amount: amount.toFixed(2) } : p,
      ),
    );
  }
  // B5 §3.2: ready cuando Σ payments ≥ total (con tolerancia 0.01€).
  // Antes exigíamos match exacto y bloqueaba overpayments cash.
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
  function removePayment(i: number): void {
    setPayments((curr) => curr.filter((_, j) => j !== i));
  }

  function pickMethod(m: Method): void {
    // En modo simple cambia el método de la única row sin perder
    // importe. En modo mixto colapsa a 1 row con el importe = total.
    setMixedSplit(null);
    if (payments.length === 1) {
      setPayment(0, { method: m });
    } else {
      setPayments([{ method: m, amount: total.toFixed(2) }]);
    }
  }

  function toggleMixed(): void {
    if (mixedSplit) {
      setMixedSplit(null);
      return;
    }
    // Default: primario opuesto al método actual para que el cajero
    // sólo escriba el importe (caso típico: "tengo 10€ sueltos, resto
    // con tarjeta" → primario CASH 10, secundario CARD resto).
    const current = payments[0]?.method ?? "CASH";
    const primary: Method = current === "CASH" ? "CARD" : "CASH";
    setMixedSplit({ primaryMethod: primary, primaryAmount: "" });
  }

  // v1.3-piloto-feedback · Lote 3: nudge "Servicio sin cliente" eliminado.
  // Mantenemos el opts en la firma por si vuelve.
  async function submit(overrideToken?: string, _opts?: { skipClientNudge?: boolean }) {
    setSubmitting(true);
    setError(null);
    // ¿Quedó la venta persistida en el outbox local? Sólo si es true
    // podemos prometer "venta guardada" cuando el POST falle.
    let persisted = false;
    try {
      const linesPayload = props.lines.map((l) => ({
        productId: l.productId ?? undefined,
        variantId: l.variantId ?? undefined,
        holdedProductId: l.holdedProductId ?? undefined,
        nameSnapshot: l.nameSnapshot,
        sku: l.sku,
        units: l.units,
        unitPrice: l.unitPrice,
        unitPriceOverride:
          l.unitPriceOverride != null ? l.unitPriceOverride : undefined,
        discountPct: l.discountPct,
        taxRate: l.taxRate,
        modifiers: l.modifiers.length > 0 ? l.modifiers : undefined,
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
      const body = {
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
      };
      // v1.5-consistencia-C: persistimos en el outbox ANTES de lanzar
      // el POST. `lock: true` evita que el flush periódico reenvíe en
      // paralelo mientras este request está en vuelo. Si IndexedDB no
      // está disponible (modo privado restrictivo) degradamos al POST
      // directo de siempre.
      try {
        persisted = true;
        await outboxAdd(
          {
            externalId: externalIdRef.current,
            kind: "ticket",
            path: "/tickets",
            body,
            label:
              props.businessType === "SERVICES" ? "Servicio" : "Venta",
            total,
          },
          { lock: true },
        );
      } catch {
        persisted = false;
      }
      const res = await apiWithCashier<TicketResponse>("/tickets", {
        method: "POST",
        body,
      });
      if (persisted) {
        await outboxDelete(externalIdRef.current).catch(() => {});
      }
      setConfirmed({ kind: "synced", res });
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === "MANAGER_AUTHORIZATION_REQUIRED") {
          // La venta no es definitiva hasta que el encargado autorice:
          // fuera del outbox (si se reenviase sola volvería a dar 403).
          await outboxDelete(externalIdRef.current).catch(() => {});
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
          await outboxDelete(externalIdRef.current).catch(() => {});
          setAuthToken(null);
          setAuthorizedBy(null);
          setError(err.message);
          setSubmitting(false);
          return;
        }
        if (isPermanentRejection(err)) {
          // Error de validación con el cajero delante: lo ve inline,
          // corrige y recobra. No dejamos el item en el outbox para no
          // duplicar cuando reintente con el payload corregido.
          await outboxDelete(externalIdRef.current).catch(() => {});
          setError(err.message);
          setSubmitting(false);
          return;
        }
      }
      // Red caída, 5xx o sin sesión: la venta YA está a salvo en el
      // outbox. Soltamos el lock para que el reenvío en background la
      // suba y mostramos la pantalla de éxito en modo pendiente.
      const saved =
        persisted &&
        (await outboxReleaseAfterFailure(
          externalIdRef.current,
          err instanceof Error ? err.message : "Error de red desconocido",
        )
          .then(() => true)
          .catch(() => false));
      if (saved) {
        setConfirmed({
          kind: "pendingLocal",
          externalId: externalIdRef.current,
        });
      } else {
        setError(
          err instanceof ApiError ? err.message : "Error inesperado",
        );
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (confirmed) {
    if (confirmed.kind === "synced") {
      return (
        <SuccessOverlay
          ticketId={confirmed.res.ticket.id}
          internalNumber={confirmed.res.ticket.internalNumber}
          onDone={props.onConfirmed}
        />
      );
    }
    return (
      <PendingSaleOverlay
        externalId={confirmed.externalId}
        businessType={props.businessType}
        onDone={props.onConfirmed}
      />
    );
  }

  const lineCount = props.lines.length;
  const cobrarLabel =
    props.businessType === "SERVICES" ? "Cerrar servicio" : "Cobrar";
  const headLabel =
    props.businessType === "SERVICES" ? "Importe del servicio" : "Total a cobrar";

  return (
    <div className="fixed inset-0 z-50 bg-mipiace-ink/95 flex items-stretch sm:items-center justify-center sm:p-4 font-sans">
      <div className="w-full sm:max-w-[700px] h-full sm:max-h-[90vh] bg-white sm:rounded-3xl shadow-2xl flex flex-col overflow-hidden">
        {/* ── HEADER STICKY ───────────────────────────────────────── */}
        <header className="flex-shrink-0 px-4 sm:px-6 pt-4 pb-3 border-b border-slate-100">
          <div className="flex items-center justify-between mb-3">
            <button
              onClick={props.onClose}
              className="h-10 w-10 rounded-xl bg-mipiace-stone hover:bg-slate-100 flex items-center justify-center text-slate-600"
              aria-label="Volver"
            >
              <ArrowLeft className="w-[18px] h-[18px]" strokeWidth={2.25} />
            </button>
            <div className="text-[13px] sm:text-[14px] font-medium text-mipiace-ink">
              {headLabel}
            </div>
            <span className="text-[12px] text-slate-500 w-10 text-right">
              {lineCount}
            </span>
          </div>
          <div className="bg-mipiace-stone rounded-2xl px-3 py-2.5 grid grid-cols-2 gap-x-4 gap-y-1.5 text-[13px]">
            <div className="flex justify-between">
              <span className="text-slate-500">Subtotal</span>
              <span className="tabular-nums text-mipiace-ink">
                {formatEur(props.totals.subtotalNet)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">IVA</span>
              <span className="tabular-nums text-mipiace-ink">
                {formatEur(props.totals.tax)}
              </span>
            </div>
            {props.totals.discount > 0 && (
              <div className="col-span-2 flex justify-between border-t border-slate-200/70 pt-1.5">
                <span className="text-slate-500">Descuento</span>
                <span className="text-mipiace-coral tabular-nums">
                  −{formatEur(props.totals.discount)}
                </span>
              </div>
            )}
          </div>
        </header>

        {/* ── BODY SCROLLABLE ─────────────────────────────────────── */}
        <main className="flex-1 min-h-0 overflow-y-auto px-4 sm:px-6 py-4">
          <div className="text-[11.5px] uppercase tracking-wider font-medium text-slate-400 mb-2.5">
            Artículos
          </div>
          <ul className="space-y-2 mb-5">
            {props.lines.map((l) => {
              const t = computeLine(l);
              const modLabels = [
                ...(l.modifierSelections?.map((m) => m.label) ?? []),
                ...l.modifiers,
              ];
              return (
                <li
                  key={l.id}
                  className="flex items-baseline gap-3 text-[13.5px]"
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-mipiace-ink truncate">
                      {l.nameSnapshot}
                    </div>
                    {modLabels.length > 0 && (
                      <div className="text-[11.5px] text-slate-500 truncate">
                        {modLabels.join(" · ")}
                      </div>
                    )}
                  </div>
                  <span className="text-slate-500 tabular-nums shrink-0 w-8 text-right">
                    ×{l.units}
                  </span>
                  <span className="text-mipiace-ink font-medium tabular-nums shrink-0 w-20 text-right">
                    {formatEur(t.totalGross)}
                  </span>
                </li>
              );
            })}
          </ul>

          {props.notes && (
            <div className="rounded-xl bg-mipiace-stone p-3 text-[12.5px] text-slate-600 mb-4">
              <span className="font-medium text-mipiace-ink">Notas: </span>
              {props.notes}
            </div>
          )}

          {mixedSplit && (
            <MixedSplitStep
              total={total}
              state={mixedSplit}
              onChange={setMixedSplit}
              onCancel={() => setMixedSplit(null)}
              onConfirm={(primaryMethod, primaryAmount) => {
                // Secundario = el "otro" del par CASH↔CARD.
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

          {props.businessType === "SERVICES" && (
            <div className="bg-mipiace-stone rounded-2xl p-3.5 mb-4">
              <label
                htmlFor="checkoutAttendedBy"
                className="block text-[11.5px] uppercase tracking-wider font-medium text-slate-400 mb-2"
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
                className="w-full h-11 px-3 rounded-xl bg-white border border-transparent text-[13.5px] focus:border-mipiace-coral/30 focus:ring-2 focus:ring-mipiace-coral/30 focus:outline-none"
              />
            </div>
          )}

          <div className="space-y-2 mb-4">
            <Checkbox
              checked={printIntent}
              onChange={setPrintIntent}
              label="Imprimir ticket"
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
        </main>

        {/* ── FOOTER STICKY ───────────────────────────────────────── */}
        <footer
          className="flex-shrink-0 bg-mipiace-stone border-t border-slate-200 px-4 sm:px-6 pt-3"
          // El padding-bottom dinámico empuja el contenido hacia arriba
          // cuando sube el teclado virtual (helper visualViewportSync del
          // Lote 2 v1.3-UX-Iteración).
          style={{ paddingBottom: "calc(1rem + var(--keyboard-offset, 0px))" }}
        >
          {/* Payment rows (importes + ref tarjeta/bizum) */}
          <div className="space-y-2 mb-2.5">
            {payments.map((p, i) => {
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
          </div>

          {/* Atajos efectivo en 1 fila (5/10/20/50/100/C). Sólo si hay
              alguna row CASH. SET, no SUM (hotfix Fix 4). */}
          {firstCashIdx !== -1 && (
            <div className="grid grid-cols-6 gap-1.5 mb-2">
              {[5, 10, 20, 50, 100].map((n) => (
                <button
                  key={n}
                  onClick={() => setCashTo(n)}
                  className="h-11 rounded-xl bg-white border border-slate-200 hover:bg-slate-50 text-[14px] font-medium text-mipiace-ink tabular-nums"
                >
                  {n}
                </button>
              ))}
              <button
                onClick={() => setCashTo(0)}
                className="h-11 rounded-xl bg-white border border-slate-200 hover:bg-slate-50 text-[14px] font-medium text-slate-500"
                aria-label="Limpiar importe efectivo"
              >
                C
              </button>
            </div>
          )}

          {/* Importe exacto (sólo si hay row CASH). 1 tap → change=0. */}
          {firstCashIdx !== -1 && (
            <button
              onClick={applyExactCash}
              className="w-full h-10 mb-2.5 rounded-xl bg-mipiace-coral-soft hover:bg-mipiace-coral-soft/70 border border-mipiace-coral/30 text-mipiace-coral-dark text-[12.5px] font-medium flex items-center justify-center gap-2"
            >
              <span>Importe exacto</span>
              <span className="text-slate-400">·</span>
              <span className="tabular-nums">
                {formatEur(exactCashForFirstCashRow)}
              </span>
            </button>
          )}

          {/* Métodos como tabs horizontales (5 cols: 4 métodos + Mixto). */}
          <div className="grid grid-cols-5 gap-1.5 mb-3">
            {(["CASH", "CARD", "BIZUM", "VOUCHER"] as Method[]).map((m) => {
              const active =
                payments.length === 1 && payments[0]!.method === m && !mixedSplit;
              return (
                <button
                  key={m}
                  onClick={() => pickMethod(m)}
                  className={
                    active
                      ? "h-11 rounded-xl bg-mipiace-coral-soft border border-mipiace-coral text-[12px] font-medium text-mipiace-coral-dark"
                      : "h-11 rounded-xl bg-white border border-slate-200 hover:bg-slate-50 text-[12px] font-medium text-mipiace-ink"
                  }
                >
                  {labelFor(m)}
                </button>
              );
            })}
            <button
              onClick={toggleMixed}
              className={
                mixedSplit || payments.length > 1
                  ? "h-11 rounded-xl bg-mipiace-coral-soft border border-mipiace-coral text-[12px] font-medium text-mipiace-coral-dark"
                  : "h-11 rounded-xl bg-white border border-slate-200 hover:bg-slate-50 text-[12px] font-medium text-mipiace-ink"
              }
            >
              Mixto
            </button>
          </div>

          {/* Cambio (sólo si hay overpayment efectivo). */}
          {cashAmount > 0 && change > 0 && (
            <div className="flex items-baseline justify-between mb-1.5">
              <span className="text-[12.5px] text-slate-500">Cambio</span>
              <span className="text-[15px] font-semibold text-mipiace-coral tabular-nums">
                {formatEur(change)}
              </span>
            </div>
          )}

          {/* TOTAL grande. */}
          <div className="flex items-baseline justify-between mb-2.5">
            <span className="text-[12.5px] uppercase tracking-wider font-medium text-slate-500">
              Total
            </span>
            <span className="text-[26px] sm:text-[30px] font-semibold text-mipiace-ink tabular-nums leading-none">
              {formatEur(total)}
            </span>
          </div>

          {/* COBRAR sticky bottom. */}
          <button
            onClick={() => submit()}
            disabled={!ready || submitting}
            className="w-full h-14 bg-mipiace-coral hover:bg-mipiace-coral-dark text-white font-medium text-[15px] rounded-2xl flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
            {cobrarLabel}
          </button>
        </footer>
      </div>

      {authPrompt && (
        <ManagerAuthorizationModal
          context={authPrompt}
          onClose={() => setAuthPrompt(null)}
          onAuthorized={(token, managerEmail) => {
            setAuthToken(token);
            setAuthorizedBy(managerEmail);
            setAuthPrompt(null);
            // Reintentamos automáticamente con el token explícito para
            // evitar condicionar la llamada al state en vuelo.
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
  // v1.3 Lote 1.C: cuánto falta para cubrir el total con esta row.
  // Sólo se pinta alerta visual en CASH; en otros métodos el guard
  // fuerte está en backend.
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
  const showShort = payment.method === "CASH" && missingForThisRow > 0.005;
  return (
    <div>
      <div className="flex items-stretch gap-2">
        <div
          className="h-12 w-12 shrink-0 rounded-xl bg-mipiace-coral-soft border border-mipiace-coral/25 flex items-center justify-center text-mipiace-coral-dark"
          aria-label={labelFor(payment.method)}
        >
          <Icon className="w-[18px] h-[18px]" strokeWidth={2.1} />
        </div>
        <input
          value={payment.amount}
          onChange={(e) => onChange({ amount: e.target.value })}
          onFocus={(e) => {
            e.target.select();
            scrollFocusIntoView(e);
          }}
          inputMode="decimal"
          aria-label={`Importe ${labelFor(payment.method)}`}
          className={
            showShort
              ? "flex-1 min-w-0 h-12 px-3 text-[16px] font-semibold bg-white border-2 border-mipiace-coral-dark rounded-xl tabular-nums text-right focus:ring-2 focus:ring-mipiace-coral/40 focus:outline-none"
              : "flex-1 min-w-0 h-12 px-3 text-[16px] font-semibold bg-white border border-slate-200 rounded-xl tabular-nums text-right focus:border-mipiace-coral/30 focus:ring-2 focus:ring-mipiace-coral/40 focus:outline-none"
          }
        />
        {(payment.method === "CARD" || payment.method === "BIZUM") && (
          <input
            value={payment.meta?.reference ?? ""}
            onChange={(e) => onChange({ meta: { reference: e.target.value } })}
            placeholder={payment.method === "CARD" ? "últ. 4" : "ref."}
            className="w-20 sm:w-24 h-12 px-3 text-[12.5px] bg-white border border-slate-200 rounded-xl focus:border-mipiace-coral/30 focus:ring-2 focus:ring-mipiace-coral/40 focus:outline-none"
          />
        )}
        {canRemove && index > 0 && (
          <button
            onClick={onRemove}
            aria-label="Quitar pago"
            className="h-12 w-12 shrink-0 rounded-xl bg-white border border-slate-200 hover:bg-slate-50 flex items-center justify-center text-slate-500"
          >
            <X className="w-4 h-4" strokeWidth={2.1} />
          </button>
        )}
      </div>
      {showShort && (
        <div className="mt-1 text-[11.5px] text-mipiace-coral-dark tabular-nums text-right pr-1">
          Falta {formatEur(missingForThisRow)}
        </div>
      )}
    </div>
  );
}

// v1.3 Lote 2: step rápido para configurar cobro mixto. Vive dentro
// del body (no es una librería de modales nueva). Default UX:
// 3 taps para "tengo 10€ sueltos, el resto con tarjeta" — vs 4 taps
// del flujo viejo.
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
  // total (el secundario quedaría 0 o negativo).
  const capped = Math.min(Math.max(0, parsed), total);
  const remaining = Math.max(0, total - capped);
  function bump(delta: number) {
    const next = Math.min(total, parsed + delta);
    onChange({ ...state, primaryAmount: next.toFixed(2) });
  }
  return (
    <div className="mb-4 rounded-2xl border border-mipiace-coral/30 bg-mipiace-coral-soft/40 p-4">
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
      <div className="grid grid-cols-[140px_1fr] gap-2 mb-3">
        <select
          value={state.primaryMethod}
          onChange={(e) =>
            onChange({ ...state, primaryMethod: e.target.value as Method })
          }
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
          onChange={(e) =>
            onChange({ ...state, primaryAmount: e.target.value })
          }
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
  // (comportamiento nativo); no añadimos onClick en el span visual
  // (B-UX-Pulido F0 disparaba onChange dos veces).
  return (
    <label className="flex items-center gap-3 p-3 bg-mipiace-stone rounded-xl cursor-pointer">
      <span
        aria-hidden="true"
        className={
          checked
            ? "w-4 h-4 rounded border-2 border-mipiace-coral bg-mipiace-coral flex items-center justify-center shrink-0"
            : "w-4 h-4 rounded border-2 border-slate-300 shrink-0"
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
      {/* stopPropagation evita que el click en el input de email
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
