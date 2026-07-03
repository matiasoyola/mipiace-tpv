// v1.8-Fiado · pantalla "Deudas" (venta a crédito).
//
// Lista las deudas vivas agregadas por cliente (GET /credits), permite
// cobrar total o parcial (POST /tickets/:id/credit-payments) e imprime un
// justificante de cobro no fiscal. ONLINE-ONLY: sin red no se puede cobrar
// (el saldo se consulta server-side). El checkout de un fiado SÍ funciona
// offline (va por el outbox como cualquier venta).

import { ArrowLeft, Loader2, WifiOff } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { ApiError, apiWithCashier } from "../api.js";
import { newId } from "../lib/ids.js";
import {
  fetchCreditReceiptEscpos,
  getPairedUsbPrinter,
  printEscposUsb,
} from "../lib/escposPrint.js";

const formatEur = (n: number) => n.toFixed(2).replace(".", ",") + " €";

type Method = "CASH" | "CARD" | "BIZUM";

const METHOD_LABEL: Record<string, string> = {
  CASH: "Efectivo",
  CARD: "Tarjeta",
  BIZUM: "Bizum",
  VOUCHER: "Vale",
  OTHER: "Otro",
};

interface CreditTicket {
  id: string;
  internalNumber: string;
  total: number;
  creditPending: number;
  createdAt: string;
}
interface CreditContact {
  contactHoldedId: string;
  name: string;
  balance: number;
  ticketCount: number;
  tickets: CreditTicket[];
}
interface CreditReceiptData {
  debtorName: string | null;
  internalNumber: string;
  amount: number;
  method: string;
  remaining: number;
  collectedAt: string;
  // Añadidos client-side para poder pedir el recibo ESC/POS al backend.
  ticketId: string;
  paymentExternalId: string;
}

export function DebtsScreen(props: {
  shiftId: string;
  storeName: string;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(!navigator.onLine);
  const [contacts, setContacts] = useState<CreditContact[]>([]);
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [lastReceipt, setLastReceipt] = useState<CreditReceiptData | null>(null);

  async function load(term?: string): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      const qs = term ? `?search=${encodeURIComponent(term)}` : "";
      const res = await apiWithCashier<{ contacts: CreditContact[] }>(`/credits${qs}`);
      setContacts(res.contacts);
      setOffline(false);
    } catch (err) {
      if (!navigator.onLine) {
        setOffline(true);
      } else {
        setError(err instanceof ApiError ? err.message : "No se pudo cargar la lista de deudas.");
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="fixed inset-0 z-50 bg-mipiace-ink/95 flex items-stretch sm:items-center justify-center sm:p-4 font-sans">
      <div className="w-full sm:max-w-[700px] h-full sm:max-h-[90vh] bg-white sm:rounded-3xl shadow-2xl flex flex-col overflow-hidden">
        <header className="flex-shrink-0 px-4 sm:px-6 pt-4 pb-3 border-b border-slate-100 flex items-center justify-between">
          <button
            onClick={props.onClose}
            className="h-10 w-10 rounded-xl bg-mipiace-stone hover:bg-slate-100 flex items-center justify-center text-slate-600"
            aria-label="Volver"
          >
            <ArrowLeft className="w-[18px] h-[18px]" strokeWidth={2.25} />
          </button>
          <div className="text-[14px] font-medium text-mipiace-ink">Deudas</div>
          <span className="w-10" />
        </header>

        <div className="flex-shrink-0 px-4 sm:px-6 py-2 border-b border-slate-100">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void load(search.trim() || undefined);
            }}
          >
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar cliente…"
              aria-label="Buscar cliente"
              className="w-full h-11 px-3 rounded-xl bg-mipiace-stone text-[14px] outline-none"
            />
          </form>
        </div>

        <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-3">
          {offline && (
            <div className="flex items-center gap-2 text-[13px] text-amber-700 bg-amber-50 rounded-xl px-3 py-3 mb-3">
              <WifiOff className="w-4 h-4" />
              Sin conexión: cobrar deudas requiere red. Vuelve a intentarlo cuando
              recuperes internet.
            </div>
          )}
          {error && (
            <div className="text-[13px] text-red-700 bg-red-50 rounded-xl px-3 py-3 mb-3">
              {error}
            </div>
          )}
          {loading ? (
            <div className="flex items-center justify-center py-10 text-slate-400">
              <Loader2 className="w-5 h-5 animate-spin" />
            </div>
          ) : contacts.length === 0 && !offline ? (
            <div className="text-center py-10 text-slate-400 text-[14px]">
              No hay deudas pendientes.
            </div>
          ) : (
            <ul className="space-y-2">
              {contacts.map((c) => (
                <ContactRow
                  key={c.contactHoldedId}
                  contact={c}
                  open={expanded === c.contactHoldedId}
                  disabled={offline}
                  onToggle={() =>
                    setExpanded(expanded === c.contactHoldedId ? null : c.contactHoldedId)
                  }
                  shiftId={props.shiftId}
                  onCollected={(receipt) => {
                    setLastReceipt(receipt);
                    void load(search.trim() || undefined);
                  }}
                />
              ))}
            </ul>
          )}
        </div>

        {lastReceipt && (
          <ReceiptPanel
            receipt={lastReceipt}
            storeName={props.storeName}
            onDismiss={() => setLastReceipt(null)}
          />
        )}
      </div>
    </div>
  );
}

function ContactRow(props: {
  contact: CreditContact;
  open: boolean;
  disabled: boolean;
  shiftId: string;
  onToggle: () => void;
  onCollected: (receipt: CreditReceiptData) => void;
}) {
  const { contact } = props;
  return (
    <li className="rounded-2xl border border-slate-100">
      <button
        onClick={props.onToggle}
        className="w-full flex items-center justify-between px-4 py-3 text-left"
      >
        <div>
          <div className="text-[14px] font-medium text-mipiace-ink">{contact.name}</div>
          <div className="text-[12px] text-slate-500">
            {contact.ticketCount} {contact.ticketCount === 1 ? "ticket" : "tickets"}
          </div>
        </div>
        <div className="text-[15px] font-semibold text-mipiace-coral">
          {formatEur(contact.balance)}
        </div>
      </button>
      {props.open && (
        <ul className="px-4 pb-3 space-y-2">
          {contact.tickets.map((t) => (
            <TicketCollect
              key={t.id}
              ticket={t}
              debtorName={contact.name}
              disabled={props.disabled}
              shiftId={props.shiftId}
              onCollected={props.onCollected}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

function TicketCollect(props: {
  ticket: CreditTicket;
  debtorName: string;
  disabled: boolean;
  shiftId: string;
  onCollected: (receipt: CreditReceiptData) => void;
}) {
  const { ticket } = props;
  const [amount, setAmount] = useState(ticket.creditPending.toFixed(2));
  const [method, setMethod] = useState<Method>("CASH");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // externalId estable por montaje: si el cajero pulsa dos veces por un
  // timeout, el backend devuelve el estado (idempotencia).
  const externalId = useMemo(() => newId(), []);

  const parsed = Number(amount.replace(",", "."));
  const valid = parsed > 0 && parsed <= ticket.creditPending + 0.005;

  async function collect(): Promise<void> {
    if (!valid) {
      setErr("Importe no válido (no puede superar la deuda).");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const res = await apiWithCashier<{ receipt: Omit<CreditReceiptData, "ticketId" | "paymentExternalId"> }>(
        `/tickets/${ticket.id}/credit-payments`,
        {
          method: "POST",
          body: { externalId, shiftId: props.shiftId, amount: parsed, method },
        },
      );
      props.onCollected({
        ...res.receipt,
        ticketId: ticket.id,
        paymentExternalId: externalId,
      });
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "No se pudo registrar el cobro.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="rounded-xl bg-mipiace-stone px-3 py-2.5">
      <div className="flex items-center justify-between text-[13px] mb-2">
        <span className="text-slate-600">#{ticket.internalNumber}</span>
        <span className="font-medium">{formatEur(ticket.creditPending)}</span>
      </div>
      <div className="flex items-center gap-2 mb-2">
        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          inputMode="decimal"
          aria-label={`Importe a cobrar del ticket ${ticket.internalNumber}`}
          className="flex-1 h-10 px-2 rounded-lg bg-white text-[14px] outline-none"
        />
        <div className="flex gap-1">
          {(["CASH", "CARD", "BIZUM"] as Method[]).map((m) => (
            <button
              key={m}
              onClick={() => setMethod(m)}
              className={`h-10 px-2 rounded-lg text-[12px] ${
                method === m ? "bg-mipiace-ink text-white" : "bg-white text-slate-600"
              }`}
            >
              {METHOD_LABEL[m]}
            </button>
          ))}
        </div>
      </div>
      {err && <div className="text-[12px] text-red-600 mb-2">{err}</div>}
      <button
        onClick={() => void collect()}
        disabled={props.disabled || busy || !valid}
        className="w-full h-10 bg-mipiace-coral text-white text-[14px] font-medium rounded-lg flex items-center justify-center gap-2 disabled:opacity-50"
      >
        {busy && <Loader2 className="w-4 h-4 animate-spin" />}
        Cobrar
      </button>
    </li>
  );
}

function ReceiptPanel(props: {
  receipt: CreditReceiptData;
  storeName: string;
  onDismiss: () => void;
}) {
  const { receipt } = props;
  const [printing, setPrinting] = useState(false);
  const [printError, setPrintError] = useState<string | null>(null);

  async function print(): Promise<void> {
    setPrinting(true);
    setPrintError(null);
    try {
      const printer = await getPairedUsbPrinter();
      if (!printer) {
        setPrintError("No hay impresora USB emparejada.");
        return;
      }
      // El recibo se construye en el backend (ESC/POS) y aquí sólo se
      // manda a la impresora, igual que la reimpresión de tickets.
      const bytes = await fetchCreditReceiptEscpos(
        receipt.ticketId,
        receipt.paymentExternalId,
      );
      await printEscposUsb(bytes);
    } catch {
      setPrintError("No se pudo imprimir el recibo.");
    } finally {
      setPrinting(false);
    }
  }

  return (
    <div className="flex-shrink-0 border-t border-slate-100 px-4 sm:px-6 py-3 bg-emerald-50">
      <div className="text-[13px] text-emerald-800 mb-2">
        Cobrado {formatEur(receipt.amount)}
        {receipt.remaining <= 0.005
          ? " · deuda saldada"
          : ` · restan ${formatEur(receipt.remaining)}`}
      </div>
      <div className="flex gap-2">
        <button
          onClick={() => void print()}
          disabled={printing}
          className="flex-1 h-11 bg-white border border-emerald-300 text-emerald-800 text-[14px] font-medium rounded-xl flex items-center justify-center gap-2 disabled:opacity-50"
        >
          {printing && <Loader2 className="w-4 h-4 animate-spin" />}
          Imprimir recibo
        </button>
        <button
          onClick={props.onDismiss}
          className="flex-1 h-11 bg-mipiace-ink text-white text-[14px] font-medium rounded-xl"
        >
          Hecho
        </button>
      </div>
      {printError && <div className="text-[12px] text-red-600 mt-2">{printError}</div>}
    </div>
  );
}
