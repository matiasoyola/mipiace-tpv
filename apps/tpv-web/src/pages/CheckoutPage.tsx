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
import { openCashDrawerIfAvailable } from "../lib/escposPrint.js";
import { formatAmount, formatEur, parseAmount } from "../lib/money.js";
import { scrollFocusIntoView } from "../lib/visualViewportSync.js";
import {
  PendingSaleOverlay,
  SuccessOverlay,
} from "./CheckoutPage.successOverlay.js";

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
  // v1.0-mesas-frontend: si el cobro es de una MESA, el destino es
  // POST /tickets/:id/checkout (las líneas ya viven en el DRAFT
  // server-side; aquí sólo van pagos + intents + externalId de
  // idempotencia). tableId acompaña al item del outbox para que el
  // mapa local bloquee la mesa mientras el cobro esté en tránsito.
  tableTicketId?: string | null;
  tableId?: string | null;
  // v1.8-Fiado · si el tenant tiene la venta a crédito activada, se
  // muestra el botón "Fiado" (sólo en venta rápida, no en mesa).
  creditSalesEnabled?: boolean;
  // v1.9.2-mesas-concurrencia · Frente 1.4/2: refetch de la proyección
  // del DRAFT de mesa. Se llama tras PAYMENTS_MISMATCH (otra caja cambió
  // la cuenta) para recalcular el total del modal in situ.
  onRefetchTable?: () => Promise<void>;
  // Frente 2: 409 TICKET_ALREADY_PAID — la mesa la cobró otra caja.
  // El modal se cierra y el padre sale al mapa con banner.
  onTableClosedElsewhere?: (notice: string) => void;
  // Frente 3.1: cobro de mesa OK → salir directo al mapa con banner de
  // éxito (sustituye al modal "Ticket emitido" sólo en contexto mesa).
  onTablePaidExit?: (opts: {
    notice: string;
    ticketId: string;
    ticketQuery: string | null;
  }) => void;
  onClose: () => void;
  onConfirmed: () => void;
}) {
  // externalId = UUIDv4 de idempotencia (ADR-005). Generado al abrir el
  // overlay; si el cajero pulsa "Cobrar" dos veces, el backend devuelve
  // el ticket existente.
  const externalIdRef = useRef<string>(newId());

  const [payments, setPayments] = useState<PaymentRow[]>([
    { method: "CASH", amount: formatAmount(props.totals.total) },
  ]);
  // v1.10.3-barra · hallazgo #1 de la simulación de hora punta: el
  // reparto mixto vivía en un mini-step (`MixedSplitStep`) montado al
  // final del BODY scrollable. Con el panel inferior fijo midiendo más
  // que el modal, ese bloque quedaba fuera de pantalla: el cajero no
  // veía el reparto, nunca pulsaba "Aplicar mixto" y la segunda fila de
  // pago no llegaba a existir → "Falta 4,00 €" eterno. Ahora el cobro
  // (métodos + filas + atajos) es lo PRIMERO del body, siempre visible
  // al abrir, y "Mixto" añade la segunda fila ahí mismo.
  //
  // `lastRowPinned` = el cajero ha escrito a mano en la última fila, así
  // que dejamos de autocompletarla con el resto.
  const [lastRowPinned, setLastRowPinned] = useState(false);
  const [printIntent, setPrintIntent] = useState(true);
  const [emailIntent, setEmailIntent] = useState<string>(props.contact?.email ?? "");
  const [emailEnabled, setEmailEnabled] = useState(!!props.contact?.email);
  const [giftReceipt, setGiftReceipt] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // v1.9.2-mesas-concurrencia · Frente 1.4/2: el total con el que se
  // construyeron las filas de pago. Si `props.totals.total` se separa
  // (otra caja añadió/quitó líneas → refetch en el padre, o el server
  // rechazó con PAYMENTS_MISMATCH y refetcheamos aquí), pintamos un
  // aviso inline bajo el total y "Actualizar" recalcula el modal.
  const [ackTotal, setAckTotal] = useState(props.totals.total);
  const [serverMismatch, setServerMismatch] = useState(false);
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
  // v1.10.3-barra · hallazgo #7: la lista de artículos se cortaba sin
  // avisar (6 líneas, se veían 2). Ahora tiene alto acotado propio y
  // decimos cuántas quedan por debajo del pliegue.
  const linesBoxRef = useRef<HTMLDivElement | null>(null);
  const bodyRef = useRef<HTMLElement | null>(null);
  const [linesHidden, setLinesHidden] = useState(0);

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
    setPayment(firstCashIdx, {
      amount: formatAmount(exactCashForFirstCashRow),
    });
  }
  // v1.3-UX-Iteración-fixes Fix 4: los atajos SET (no SUM). Antes el
  // piloto se confundía al ver 10 + tap 20 = 30. C = limpiar a 0.
  function setCashTo(amount: number): void {
    if (firstCashIdx === -1) return;
    setPayment(firstCashIdx, { amount: formatAmount(amount) });
  }
  // v1.10.3-barra · una sola línea de verdad sobre el reparto, debajo
  // de las filas. Antes cada fila CASH pintaba su propio "Falta X" que
  // contradecía al resto y no explicaba por qué Cobrar seguía gris.
  const missing = Math.max(0, total - paymentsSum);
  const over = Math.max(0, paymentsSum - total);
  const isMixed = payments.length > 1;
  // v1.10.3-addendum (review 2026-08-26) · un exceso SÓLO es legítimo
  // si sale del cajón: el cambio se devuelve en efectivo. 20 en
  // efectivo sobre 14 son 6 de cambio; 15 en TARJETA sobre 14 son 1 €
  // cobrado de más al cliente, y la tarjeta no devuelve cambio. El
  // server no lo para —sólo rechaza que la suma sea MENOR que el
  // total— así que lo tiene que parar la caja.
  const overNotRefundable = over > 0.005 && cashAmount < over - 0.005;
  // B5 §3.2: ready cuando Σ payments ≥ total (con tolerancia 0.01€).
  // Antes exigíamos match exacto y bloqueaba overpayments cash.
  const ready = paymentsSum >= total - 0.01 && !overNotRefundable;

  // v1.9.2-mesas-concurrencia · Frente 1.4/2: la cuenta cambió desde
  // otra caja (o el server rechazó por total desactualizado). Mientras
  // el aviso está activo, "Cobrar" queda bloqueado: el cajero debe
  // pulsar "Actualizar" para aceptar el total nuevo.
  const accountChanged =
    Math.abs(total - ackTotal) > 0.001 || serverMismatch;
  function acceptNewTotal(): void {
    setPayments([{ method: "CASH", amount: formatAmount(total) }]);
    setLastRowPinned(false);
    setAckTotal(total);
    setServerMismatch(false);
    setError(null);
  }

  // v1.10.3-barra · cuántas líneas quedan fuera del cuadro. Medimos
  // contra las <li> reales en vez de estimar altura: las líneas con
  // modificadores son más altas y una estimación mentiría.
  function measureHiddenLines(): void {
    const box = linesBoxRef.current;
    if (!box) return;
    // Medimos con rects y no con offsetTop: el cuadro no es
    // `position: relative`, así que offsetTop apuntaría a un ancestro
    // cualquiera y contaría como ocultas líneas que se ven de sobra.
    //
    // Y el pliegue es el MÁS ALTO de los dos que pueden cortar: el
    // propio cuadro (muchas líneas) o el borde inferior del body
    // scrollable (pocas líneas pero el modal no llega). El bug original
    // era del segundo tipo — 6 líneas, se veían 2 — así que contar sólo
    // contra el cuadro habría dicho "no falta nada" mintiendo otra vez.
    const boxBottom = box.getBoundingClientRect().bottom;
    const bodyBottom =
      bodyRef.current?.getBoundingClientRect().bottom ?? Number.POSITIVE_INFINITY;
    const fold = Math.min(boxBottom, bodyBottom);
    const items = Array.from(box.querySelectorAll("li"));
    const hidden = items.filter(
      (li) => li.getBoundingClientRect().bottom > fold + 2,
    );
    setLinesHidden(hidden.length);
  }
  useEffect(() => {
    measureHiddenLines();
    // El pliegue se mueve al girar la tablet, al abrir el teclado
    // virtual (--keyboard-offset encoge el body) y al pasar de aside a
    // handheld. Sin volver a medir, el aviso se quedaría contando lo
    // que sobraba en el layout anterior.
    const body = bodyRef.current;
    if (typeof ResizeObserver === "undefined" || !body) return;
    const ro = new ResizeObserver(() => measureHiddenLines());
    ro.observe(body);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.lines.length, confirmed]);

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

  // v1.9.2-mesas-concurrencia · Frente 3.1: en contexto mesa NO mostramos
  // el modal "Ticket emitido". Al confirmar el cobro salimos directo al
  // mapa con un banner de éxito ("Ver ticket" abre el detalle). El resto
  // de acciones (QR/PDF/email) siguen en Tickets.
  useEffect(() => {
    if (
      confirmed?.kind === "synced" &&
      props.tableTicketId &&
      props.onTablePaidExit
    ) {
      const internal = confirmed.res.ticket.internalNumber;
      props.onTablePaidExit({
        notice: internal
          ? `Mesa cobrada · Ticket ${internal}`
          : "Mesa cobrada",
        ticketId: confirmed.res.ticket.id,
        ticketQuery: internal ?? null,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [confirmed]);

  // Reparte el resto en la ÚLTIMA fila mientras el cajero no la haya
  // escrito a mano. Es lo que hace que "Mixto → Efectivo 10" deje
  // Tarjeta en 4,00 € sin que nadie tenga que restar en la barra.
  function rebalanceLast(rows: PaymentRow[], pinned: boolean): PaymentRow[] {
    const last = rows.length - 1;
    if (last <= 0 || pinned) return rows;
    const others = rows.reduce(
      (acc, p, j) => (j === last ? acc : acc + parseAmount(p.amount)),
      0,
    );
    const next = rows.slice();
    next[last] = {
      ...next[last]!,
      amount: formatAmount(Math.max(0, total - others)),
    };
    return next;
  }

  function setPayment(i: number, patch: Partial<PaymentRow>): void {
    const isLast = i === payments.length - 1;
    const touchesAmount = patch.amount !== undefined;
    // Escribir en la última fila la "fija": a partir de ahí manda el
    // cajero y no volvemos a tocarla.
    const pinned = lastRowPinned || (touchesAmount && isLast);
    if (pinned !== lastRowPinned) setLastRowPinned(pinned);
    setPayments((curr) => {
      const next = curr.map((p, j) => (j === i ? { ...p, ...patch } : p));
      return touchesAmount && !isLast ? rebalanceLast(next, pinned) : next;
    });
  }

  function pickMethod(m: Method): void {
    // En modo simple cambia el método de la única row sin perder
    // importe. En modo mixto colapsa a 1 row con el importe = total.
    if (payments.length === 1) {
      setPayment(0, { method: m });
    } else {
      setLastRowPinned(false);
      setPayments([{ method: m, amount: formatAmount(total) }]);
    }
  }

  // Cambia el método de una fila concreta (sólo visible en mixto, donde
  // cada fila lleva su propio selector).
  function setRowMethod(i: number, m: Method): void {
    setPayment(i, { method: m });
  }

  function toggleMixed(): void {
    if (payments.length > 1) {
      // Volver a simple: una fila con el método de la primera.
      setLastRowPinned(false);
      setPayments([
        { method: payments[0]!.method, amount: formatAmount(total) },
      ]);
      return;
    }
    // El primario arranca VACÍO (el cajero teclea lo que le ponen en la
    // mano) y el secundario lleva el resto — que con el primario a 0 es
    // el total entero. En cuanto escribe 10 en efectivo, tarjeta pasa a
    // 4,00 € sola. Caso típico de barra: "mitad y mitad".
    const current = payments[0]?.method ?? "CASH";
    const secondary: Method = current === "CASH" ? "CARD" : "CASH";
    setLastRowPinned(false);
    setPayments([
      { method: current, amount: "" },
      { method: secondary, amount: formatAmount(total) },
    ]);
  }

  // v1.3-piloto-feedback · Lote 3: nudge "Servicio sin cliente" eliminado.
  // Mantenemos el opts en la firma por si vuelve.
  async function submit(
    overrideToken?: string,
    _opts?: { skipClientNudge?: boolean; credit?: boolean },
  ) {
    const isCredit = _opts?.credit === true;
    // v1.9.2-mesas-concurrencia · Frente 1.4/2: la cuenta cambió desde
    // otra caja. No dejamos cobrar hasta que el cajero acepte el total
    // nuevo con "Actualizar".
    if (accountChanged) return;
    // v1.8-Fiado · un fiado exige deudor. Sin contacto, abrimos el
    // selector en vez de mandar un POST que el backend rechazaría (400).
    if (isCredit && !props.contact?.holdedContactId) {
      setError("Un fiado necesita un cliente (el deudor). Selecciónalo antes de continuar.");
      props.onRequestAssignContact?.();
      return;
    }
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
      // v1.8-Fiado · un fiado nace SIN pagos (se cobra luego en Deudas).
      const paymentsPayload = isCredit
        ? []
        : payments
            .map((p) => ({
              method: p.method,
              amount: parseAmount(p.amount),
              meta:
                p.meta && Object.keys(p.meta).length > 0 ? p.meta : undefined,
            }))
            // v1.10.3-addendum (review 2026-08-26) · fuera las filas a
            // cero. El reparto automático deja la última fila en 0,00 €
            // en cuanto el cajero teclea en otra un importe ≥ total
            // (cliente que paga los 14 con un billete de 20 después de
            // haber pulsado Mixto). Mandar un pago de 0,00 € en tarjeta
            // ensucia el ticket, el desglose del Z y el recibo de
            // Holded con un cobro que no existió.
            .filter((p) => p.amount > 0.005);
      const commonFields = {
        externalId: externalIdRef.current,
        payments: paymentsPayload,
        ...(isCredit ? { creditSale: true } : {}),
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
      // Mesa: el DRAFT ya tiene las líneas en el servidor; el checkout
      // sólo manda pagos + intents (+ externalId de idempotencia, Lote 2
      // v1.0-mesas-frontend). Venta rápida: POST /tickets con todo.
      const path = props.tableTicketId
        ? `/tickets/${props.tableTicketId}/checkout`
        : "/tickets";
      const body = props.tableTicketId
        ? commonFields
        : {
            ...commonFields,
            registerId: props.registerId,
            shiftId: props.shiftId,
            lines: linesPayload,
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
            path,
            body,
            label: isCredit
              ? "Fiado"
              : props.tableTicketId
                ? "Mesa"
                : props.businessType === "SERVICES"
                  ? "Servicio"
                  : "Venta",
            total,
            tableId: props.tableId ?? undefined,
          },
          { lock: true },
        );
      } catch {
        persisted = false;
      }
      // A1-Android · Frente 3: venta en efectivo → abrir el cajón ya, sin
      // esperar a la sincronización con Holded (funciona offline). Sólo si
      // hay impresora USB emparejada; best-effort, no bloquea el cobro.
      if (!isCredit && cashAmount > 0) {
        void openCashDrawerIfAvailable();
      }
      const res = await apiWithCashier<TicketResponse>(path, {
        method: "POST",
        body,
      });
      if (persisted) {
        await outboxDelete(externalIdRef.current).catch(() => {});
      }
      setConfirmed({ kind: "synced", res });
    } catch (err) {
      if (err instanceof ApiError) {
        // v1.9.2-mesas-concurrencia · Frente 2: 409 la mesa la cobró otra
        // caja (doble cobro físico). Cerrar el modal y salir al mapa con
        // banner — NUNCA dejarlo mudo. El item del outbox se descarta
        // (el ticket ya existe en el server, no hay que reintentar).
        if (
          err.code === "TICKET_ALREADY_PAID" &&
          props.tableTicketId &&
          props.onTableClosedElsewhere
        ) {
          await outboxDelete(externalIdRef.current).catch(() => {});
          setSubmitting(false);
          props.onTableClosedElsewhere(
            "Esta mesa ya fue cobrada desde otra caja",
          );
          return;
        }
        // Frente 2: 400 PAYMENTS_MISMATCH — otra caja cambió la cuenta
        // entre que este cajero abrió el modal y pulsó Cobrar. No cerrar
        // el modal: refetcheamos la proyección y pintamos el aviso con
        // "Actualizar" (el efecto de props.totals lo activará; forzamos
        // el flag por si el total refetcheado coincide).
        if (
          err.code === "PAYMENTS_MISMATCH" &&
          props.tableTicketId &&
          props.onRefetchTable
        ) {
          await outboxDelete(externalIdRef.current).catch(() => {});
          setServerMismatch(true);
          await props.onRefetchTable().catch(() => {});
          setSubmitting(false);
          return;
        }
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
      // Frente 3.1: mesa → sin modal de éxito (el efecto de arriba ya
      // disparó la salida al mapa con banner). Render vacío mientras el
      // padre desmonta la SalePage.
      if (props.tableTicketId && props.onTablePaidExit) return null;
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
            {/* Contrapeso del botón Volver para que el título quede
                centrado. El nº de líneas se cuenta en el encabezado de
                "Artículos" (v1.10.3-barra · hallazgo #7). */}
            <span className="w-10" aria-hidden="true" />
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
        <main
          ref={bodyRef}
          onScroll={measureHiddenLines}
          className="flex-1 min-h-0 overflow-y-auto px-4 sm:px-6 py-4"
        >
          {/* ── 1 · COBRO ───────────────────────────────────────────
              v1.10.3-barra · hallazgo #1. Métodos, filas de pago y
              atajos son lo PRIMERO del body: al abrir el modal el
              cajero ve el reparto entero sin scrollear, y "Mixto"
              añade la segunda fila aquí mismo en vez de en un panel
              que quedaba debajo del pie fijo. */}
          <div className="text-[11.5px] uppercase tracking-wider font-medium text-slate-400 mb-2.5">
            Cobro
          </div>

          {/* Métodos como tabs horizontales (5 cols: 4 métodos + Mixto). */}
          <div className="grid grid-cols-5 gap-1.5 mb-2.5">
            {(["CASH", "CARD", "BIZUM", "VOUCHER"] as Method[]).map((m) => {
              const active = !isMixed && payments[0]!.method === m;
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
              title="Cobrar la misma cuenta con dos métodos (mitad y mitad)"
              className={
                isMixed
                  ? "h-11 rounded-xl bg-mipiace-coral-soft border border-mipiace-coral text-[12px] font-medium text-mipiace-coral-dark"
                  : "h-11 rounded-xl bg-white border border-slate-200 hover:bg-slate-50 text-[12px] font-medium text-mipiace-ink"
              }
            >
              Mixto
            </button>
          </div>

          {/* Filas de pago. En mixto cada fila lleva su propio selector
              de método; en simple, el icono del método elegido arriba. */}
          <div className="space-y-2 mb-2.5">
            {payments.map((p, i) => (
              <PaymentRowEditor
                key={i}
                payment={p}
                index={i}
                showMethodPicker={isMixed}
                autoFilled={isMixed && i === payments.length - 1 && !lastRowPinned}
                onChange={(patch) => setPayment(i, patch)}
                onMethodChange={(m) => setRowMethod(i, m)}
              />
            ))}
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
              className="w-full h-11 mb-2.5 rounded-xl bg-mipiace-coral-soft hover:bg-mipiace-coral-soft/70 border border-mipiace-coral/30 text-mipiace-coral-dark text-[12.5px] font-medium flex items-center justify-center gap-2"
            >
              <span>Importe exacto</span>
              <span className="text-slate-400">·</span>
              <span className="tabular-nums">
                {formatEur(exactCashForFirstCashRow)}
              </span>
            </button>
          )}

          {/* Estado del reparto: una sola frase, siempre cierta. Es la
              que explica por qué "Cobrar" está gris. */}
          <div
            role="status"
            className={
              missing > 0.005
                ? "mb-5 rounded-xl bg-mipiace-coral-soft border border-mipiace-coral/30 px-3 py-2 text-[12.5px] text-mipiace-coral-dark flex items-baseline justify-between gap-3"
                : overNotRefundable
                  ? "mb-5 rounded-xl bg-mipiace-coral-soft border border-mipiace-coral/30 px-3 py-2 text-[12.5px] text-mipiace-coral-dark flex items-baseline justify-between gap-3"
                  : "mb-5 rounded-xl bg-emerald-50 border border-emerald-200 px-3 py-2 text-[12.5px] text-emerald-800 flex items-baseline justify-between gap-3"
            }
          >
            <span className="min-w-0">
              {isMixed
                ? payments.map((p) => labelFor(p.method)).join(" + ")
                : "Pagado"}
            </span>
            <span className="tabular-nums font-semibold shrink-0">
              {missing > 0.005
                ? `Falta ${formatEur(missing)}`
                : overNotRefundable
                  ? `Sobran ${formatEur(over)} · baja el importe`
                  : over > 0.005
                    ? `${formatEur(paymentsSum)} · sobran ${formatEur(over)}`
                    : `${formatEur(paymentsSum)} · cuadra`}
            </span>
          </div>

          {/* ── 2 · ARTÍCULOS ──────────────────────────────────────
              v1.10.3-barra · hallazgo #7: caja de alto acotado con
              scroll propio y contador honesto de lo que queda fuera. */}
          <div className="flex items-baseline justify-between mb-2.5">
            <span className="text-[11.5px] uppercase tracking-wider font-medium text-slate-400">
              Artículos
            </span>
            {/* El aviso va en la CABECERA, no debajo del cuadro: debajo
                caería fuera de pantalla justo cuando hace falta. */}
            <span className="text-[11.5px] tabular-nums">
              <span className="text-slate-400">
                {lineCount} {lineCount === 1 ? "línea" : "líneas"}
              </span>
              {linesHidden > 0 && (
                <span className="text-mipiace-coral-dark font-medium">
                  {" · ↓ "}
                  {linesHidden} sin ver
                </span>
              )}
            </span>
          </div>
          <div
            ref={linesBoxRef}
            onScroll={measureHiddenLines}
            className={
              linesHidden > 0
                ? "max-h-[168px] overflow-y-auto overscroll-contain [mask-image:linear-gradient(to_bottom,black_calc(100%-28px),transparent)]"
                : "max-h-[168px] overflow-y-auto overscroll-contain"
            }
          >
          <ul className="space-y-2">
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
          </div>
          <div className="mb-5" />

          {props.notes && (
            <div className="rounded-xl bg-mipiace-stone p-3 text-[12.5px] text-slate-600 mb-4">
              <span className="font-medium text-mipiace-ink">Notas: </span>
              {props.notes}
            </div>
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
          {/* v1.10.3-barra · el pie se queda SÓLO con lo que nunca
              puede quedar fuera de pantalla: cambio, total y Cobrar.
              Métodos, filas de pago y atajos viven arriba del body, que
              es scrollable de verdad. Antes el pie medía ~360 px y
              estrangulaba el body hasta dejarlo en 0 (hallazgos #1
              y #7 de la simulación de hora punta). */}

          {/* Lo que falta, también en el pie: en 320x568 el estado del
              reparto queda por encima del pliegue, y "Cobrar" en gris
              sin decir por qué es justo el pecado del hallazgo #1. */}
          {missing > 0.005 && (
            <div className="flex items-baseline justify-between mb-1.5">
              <span className="text-[12.5px] text-mipiace-coral-dark">
                Falta
              </span>
              <span className="text-[15px] font-semibold text-mipiace-coral-dark tabular-nums">
                {formatEur(missing)}
              </span>
            </div>
          )}

          {/* Y el exceso que no se puede devolver, por el mismo motivo:
              "Cobrar" en gris sin decir por qué es el pecado del
              hallazgo #1. (addendum de la review 2026-08-26) */}
          {overNotRefundable && (
            <div className="flex items-baseline justify-between mb-1.5">
              <span className="text-[12.5px] text-mipiace-coral-dark">
                Sobran
              </span>
              <span className="text-[15px] font-semibold text-mipiace-coral-dark tabular-nums">
                {formatEur(over)}
              </span>
            </div>
          )}

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

          {/* v1.9.2-mesas-concurrencia · Frente 1.4/2: la cuenta cambió
              desde otra caja. Aviso inline bajo el total con "Actualizar"
              que recalcula el modal. Bloquea "Cobrar" hasta aceptarlo. */}
          {accountChanged && (
            <div className="mb-2.5 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2.5 text-[12.5px] text-amber-900">
              <div className="font-semibold">
                La cuenta ha cambiado desde otra caja.
              </div>
              <div className="mt-0.5 flex items-center justify-between gap-3">
                <span className="tabular-nums">
                  Total actual: {formatEur(total)}
                </span>
                <button
                  type="button"
                  onClick={acceptNewTotal}
                  className="shrink-0 h-8 px-3 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-[12px] font-semibold"
                >
                  Actualizar
                </button>
              </div>
            </div>
          )}

          {/* COBRAR sticky bottom. */}
          <button
            onClick={() => submit()}
            disabled={!ready || submitting || accountChanged}
            className="w-full h-14 bg-mipiace-coral hover:bg-mipiace-coral-dark text-white font-medium text-[15px] rounded-2xl flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
            {cobrarLabel}
          </button>
          {/* v1.8-Fiado · venta a crédito. Sólo venta rápida (no mesa) y
              sólo con el flag activado. El cliente se lleva el género y
              paga otro día; la deuda se cobra desde la pantalla Deudas. */}
          {props.creditSalesEnabled && !props.tableTicketId && (
            <button
              onClick={() => submit(undefined, { credit: true })}
              disabled={submitting}
              className="mt-2 w-full h-12 bg-white border-2 border-mipiace-coral text-mipiace-coral font-medium text-[14px] rounded-2xl flex items-center justify-center gap-2 disabled:opacity-50"
            >
              Fiado{props.contact?.name ? ` · ${props.contact.name}` : ""}
            </button>
          )}
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
  showMethodPicker,
  autoFilled,
  onChange,
  onMethodChange,
}: {
  payment: PaymentRow;
  index: number;
  // v1.10.3-barra · en mixto cada fila elige su método aquí mismo; en
  // simple lo eligen los tabs de arriba y la fila sólo lo enseña.
  showMethodPicker: boolean;
  // La última fila se autocompleta con el resto mientras el cajero no
  // la escriba. Lo decimos en voz alta: un importe que se mueve solo
  // sin explicación asusta más que ayuda.
  autoFilled: boolean;
  onChange: (patch: Partial<PaymentRow>) => void;
  onMethodChange: (m: Method) => void;
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
    <div>
      <div className="flex items-stretch gap-2">
        {showMethodPicker ? (
          <div className="relative h-12 w-[96px] sm:w-[108px] shrink-0">
            <Icon
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 w-[16px] h-[16px] text-mipiace-coral-dark"
              strokeWidth={2.1}
            />
            <select
              value={payment.method}
              onChange={(e) => onMethodChange(e.target.value as Method)}
              aria-label={`Método del pago ${index + 1}`}
              className="h-12 w-full pl-8 pr-2 rounded-xl bg-mipiace-coral-soft border border-mipiace-coral/25 text-[13px] font-medium text-mipiace-coral-dark appearance-none focus:outline-none focus:ring-2 focus:ring-mipiace-coral/40"
            >
              {(["CASH", "CARD", "BIZUM", "VOUCHER"] as Method[]).map((m) => (
                <option key={m} value={m}>
                  {labelFor(m)}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <div
            className="h-12 w-12 shrink-0 rounded-xl bg-mipiace-coral-soft border border-mipiace-coral/25 flex items-center justify-center text-mipiace-coral-dark"
            aria-label={labelFor(payment.method)}
          >
            <Icon className="w-[18px] h-[18px]" strokeWidth={2.1} />
          </div>
        )}
        <input
          value={payment.amount}
          onChange={(e) => onChange({ amount: e.target.value })}
          onFocus={(e) => {
            e.target.select();
            scrollFocusIntoView(e);
          }}
          inputMode="decimal"
          placeholder="0,00"
          aria-label={`Importe ${labelFor(payment.method)}`}
          className="flex-1 min-w-[84px] h-12 px-3 text-[16px] font-semibold bg-white border border-slate-200 rounded-xl tabular-nums text-right focus:border-mipiace-coral/30 focus:ring-2 focus:ring-mipiace-coral/40 focus:outline-none"
        />
        {(payment.method === "CARD" || payment.method === "BIZUM") && (
          <input
            value={payment.meta?.reference ?? ""}
            onChange={(e) => onChange({ meta: { reference: e.target.value } })}
            placeholder={payment.method === "CARD" ? "últ. 4" : "ref."}
            aria-label={`Referencia ${labelFor(payment.method)}`}
            className="w-16 sm:w-24 shrink-0 h-12 px-2.5 sm:px-3 text-[12.5px] bg-white border border-slate-200 rounded-xl focus:border-mipiace-coral/30 focus:ring-2 focus:ring-mipiace-coral/40 focus:outline-none"
          />
        )}
      </div>
      {autoFilled && (
        <div className="mt-1 text-[11.5px] text-slate-500 text-right pr-1">
          Resto de la cuenta · escribe encima si no cuadra
        </div>
      )}
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
