// Pantalla "Ticket emitido" tras un cobro exitoso (B-Print fase 1
// · Frente 5). 4 acciones disponibles según `store.ticketDelivery`:
//   1. Email enviado (badge informativo).
//   2. Mostrar QR (modal con QR generado client-side apuntando al
//      endpoint público).
//   3. Descargar PDF (genera blob local con `renderTicketPdf`).
//   4. Ver ticket (modal con preview embebido del PDF).
//
// Mantenemos el polling a Holded del SuccessOverlay original para
// pintar el `holdedDocNumber` cuando llegue (informativo — el
// ticket digital ya es válido desde el segundo del cobro).

import { useEffect, useMemo, useState } from "react";
import {
  Check,
  Download,
  Eye,
  Loader2,
  Mail,
  Printer,
  QrCode,
  X,
} from "lucide-react";
import QRCode from "qrcode";

import {
  renderTicketPdf,
} from "@mipiacetpv/ticket-pdf";
import type { TicketDocument } from "@mipiacetpv/ticket-model";

import { apiWithCashier, ApiError } from "../api.js";
import { getCachedBusinessType } from "../lib/catalog.js";
import {
  fetchTicketEscposBinary,
  getPairedUsbPrinter,
  isWebUsbSupported,
  pairUsbPrinter,
  printEscposUsb,
  printTicketWifi,
} from "../lib/escposPrint.js";
import { vocab } from "../lib/vocab.js";

interface TicketDelivery {
  emailAutoIfCustomerHasEmail: boolean;
  showQrButton: boolean;
  showDownloadButton: boolean;
  showViewButton: boolean;
  emailSubject: string;
  emailBody: string;
  qrCaption: string;
}

interface DigitalPayload {
  publicSlug: string;
  emailedTo: string | null;
  ticketDelivery: TicketDelivery;
  document: Omit<TicketDocument, "ticket"> & {
    ticket: Omit<TicketDocument["ticket"], "issuedAt"> & { issuedAt: string };
  };
}

export function SuccessOverlay({
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
  const [digital, setDigital] = useState<DigitalPayload | null>(null);
  const [digitalError, setDigitalError] = useState<string | null>(null);
  const [showQr, setShowQr] = useState(false);
  const [showView, setShowView] = useState(false);
  const [printerInfo, setPrinterInfo] = useState<{
    mode: "USB" | "WIFI";
    configId: string;
    name: string;
  } | null>(null);
  const [printState, setPrintState] = useState<
    | { phase: "idle" }
    | { phase: "printing" }
    | { phase: "done" }
    | { phase: "needs-pairing" }
    | { phase: "error"; message: string }
  >({ phase: "idle" });
  // v1.3-Servicios-Pinta · Lote 1: vertical para adaptar copy ("Ticket
  // emitido" → "Comprobante emitido", "Nueva venta" → "Nuevo servicio").
  const businessType = getCachedBusinessType();

  // Polling Holded para pintar el número fiscal cuando llegue.
  useEffect(() => {
    let cancelled = false;
    let attempts = 0;
    async function tick() {
      attempts += 1;
      try {
        const res = await apiWithCashier<{
          ticket: { holdedDocNumber: string | null; status: string };
        }>(`/tickets/${ticketId}`);
        if (cancelled) return;
        setStatus(res.ticket.status);
        if (res.ticket.holdedDocNumber) setDocNumber(res.ticket.holdedDocNumber);
      } catch {
        /* sin red — el TPV puede estar offline, ignoramos y seguimos */
      }
      if (
        !cancelled &&
        attempts < 60 &&
        status !== "SYNCED" &&
        status !== "SYNC_FAILED"
      ) {
        setTimeout(tick, 1000);
      }
    }
    tick();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticketId]);

  // Carga el payload digital — falla en silencio si la PWA está
  // offline; el QR queda deshabilitado, descargar/ver no se ofrecen
  // hasta que el doc llegue.
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await apiWithCashier<DigitalPayload>(
          `/tickets/${ticketId}/digital`,
        );
        if (!cancelled) setDigital(res);
      } catch (err) {
        if (!cancelled) {
          setDigitalError(
            err instanceof Error ? err.message : "No se pudo cargar el ticket digital",
          );
        }
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [ticketId]);

  const documentObj = useMemo<TicketDocument | null>(() => {
    if (!digital) return null;
    return {
      ...digital.document,
      ticket: {
        ...digital.document.ticket,
        issuedAt: new Date(digital.document.ticket.issuedAt),
      },
    };
  }, [digital]);

  // v1.4-Impresoras-Fase-1 Lote 3 · carga el PrinterConfig por
  // defecto (ticket de cobro) del register para decidir flujo USB vs
  // WIFI. Si no hay impresora configurada, el botón queda oculto.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiWithCashier<{
          printer: { id: string; name: string; mode: "USB" | "WIFI" } | null;
        }>("/tpv/printer-info?section=ticket");
        if (cancelled || !res.printer) return;
        setPrinterInfo({
          mode: res.printer.mode,
          configId: res.printer.id,
          name: res.printer.name,
        });
        if (res.printer.mode === "USB" && isWebUsbSupported()) {
          // Comprobamos si ya hay impresora emparejada (para no
          // ofrecer el botón "Empareja" cuando no hace falta). Esto
          // no abre diálogo — sólo lista las ya autorizadas.
          const paired = await getPairedUsbPrinter();
          if (!cancelled && !paired) {
            setPrintState({ phase: "needs-pairing" });
          }
        }
      } catch {
        // Sin impresora configurada, sin WebUSB, etc. — el botón
        // sigue oculto y el cajero usa el flujo digital.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function onPairUsb() {
    try {
      await pairUsbPrinter();
      setPrintState({ phase: "idle" });
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : "No se pudo emparejar la impresora.";
      setPrintState({ phase: "error", message: msg });
    }
  }

  async function onPrintTicket() {
    if (!printerInfo) return;
    setPrintState({ phase: "printing" });
    try {
      if (printerInfo.mode === "USB") {
        const bytes = await fetchTicketEscposBinary(ticketId);
        await printEscposUsb(bytes);
      } else {
        await printTicketWifi(ticketId, printerInfo.configId);
      }
      setPrintState({ phase: "done" });
      setTimeout(() => {
        setPrintState((s) => (s.phase === "done" ? { phase: "idle" } : s));
      }, 2000);
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Error al imprimir.";
      setPrintState({ phase: "error", message: msg });
    }
  }

  async function downloadPdf() {
    if (!documentObj) return;
    const bytes = await renderTicketPdf(documentObj);
    // El compilador estrecha Uint8Array<ArrayBufferLike> y exige
    // ArrayBuffer en BlobPart bajo lib DOM 5.x; clonamos a un
    // Uint8Array recién creado para asegurar el tipo.
    const blob = new Blob([new Uint8Array(bytes)], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ticket-${internalNumber}.pdf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5_000);
  }

  const delivery = digital?.ticketDelivery;

  return (
    <div className="fixed inset-0 z-50 bg-mipiace-ink/95 flex items-center justify-center p-5 font-sans overflow-y-auto">
      <div className="bg-white rounded-3xl border border-slate-200 w-full max-w-md p-8 text-center">
        <div className="h-16 w-16 mx-auto rounded-2xl bg-emerald-100 text-emerald-700 flex items-center justify-center mb-4">
          <Check className="w-8 h-8" strokeWidth={2.5} />
        </div>
        <h1 className="text-[22px] font-semibold text-mipiace-ink tracking-tight">
          {vocab("ticketNoun", businessType)} emitido
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
          ) : status === "TEST" ? (
            // B-TPV-Bugfix v1 · Bug-02: en modo prueba el ticket
            // nunca llega a SYNCED, así que el spinner anterior se
            // quedaba indefinido dando sensación de proceso colgado.
            // Mostramos un mensaje explícito y sin spinner.
            <div className="text-[13px] text-amber-700 flex items-center justify-center gap-2">
              <span className="inline-block px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 text-[10.5px] font-semibold uppercase tracking-wider">
                Prueba
              </span>
              No se sube a Holded ni se envía email.
            </div>
          ) : (
            <div className="text-[13px] text-slate-500 flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin text-mipiace-coral" />
              Sincronizando con Holded…
            </div>
          )}
        </div>

        {digitalError && (
          <div className="text-[12.5px] text-amber-700 bg-amber-50 rounded-xl p-3 mt-4">
            {digitalError}
          </div>
        )}

        {digital?.emailedTo && (
          <div
            data-testid="email-sent-badge"
            className="mt-4 flex items-start gap-2 bg-emerald-50 text-emerald-800 rounded-xl px-4 py-3 text-left"
          >
            <Mail className="w-4 h-4 mt-0.5 shrink-0" />
            <div className="text-[12.5px]">
              Enviado por email a{" "}
              <strong className="font-medium">{digital.emailedTo}</strong>
            </div>
          </div>
        )}

        {printerInfo && (
          <PrintTicketRow
            mode={printerInfo.mode}
            name={printerInfo.name}
            state={printState}
            onPair={onPairUsb}
            onPrint={onPrintTicket}
            onRetry={() => onPrintTicket()}
          />
        )}

        {(delivery?.showQrButton ||
          delivery?.showDownloadButton ||
          delivery?.showViewButton) && (
          <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-2">
            {delivery?.showQrButton && (
              <ActionButton
                testId="action-qr"
                icon={<QrCode className="w-4 h-4" />}
                label="Mostrar QR"
                disabled={!digital}
                disabledHint="Disponible cuando sincronice"
                onClick={() => setShowQr(true)}
              />
            )}
            {delivery?.showDownloadButton && (
              <ActionButton
                testId="action-download"
                icon={<Download className="w-4 h-4" />}
                label="Descargar PDF"
                disabled={!documentObj}
                onClick={downloadPdf}
              />
            )}
            {delivery?.showViewButton && (
              <ActionButton
                testId="action-view"
                icon={<Eye className="w-4 h-4" />}
                label={`Ver ${vocab("ticketNoun", businessType).toLowerCase()}`}
                disabled={!documentObj}
                onClick={() => setShowView(true)}
              />
            )}
          </div>
        )}

        <button
          onClick={onDone}
          className="mt-6 w-full h-12 rounded-2xl bg-mipiace-coral hover:bg-mipiace-coral-dark text-white font-medium text-[14px]"
        >
          {businessType === "SERVICES" ? "Nuevo servicio" : "Nueva venta"}
        </button>
      </div>

      {showQr && digital && (
        <QrModal
          publicSlug={digital.publicSlug}
          caption={digital.ticketDelivery.qrCaption}
          onClose={() => setShowQr(false)}
        />
      )}
      {showView && documentObj && (
        <ViewModal
          document={documentObj}
          onClose={() => setShowView(false)}
        />
      )}
    </div>
  );
}

type PrintState =
  | { phase: "idle" }
  | { phase: "printing" }
  | { phase: "done" }
  | { phase: "needs-pairing" }
  | { phase: "error"; message: string };

function PrintTicketRow({
  mode,
  name,
  state,
  onPair,
  onPrint,
  onRetry,
}: {
  mode: "USB" | "WIFI";
  name: string;
  state: PrintState;
  onPair: () => void;
  onPrint: () => void;
  onRetry: () => void;
}) {
  const baseClass =
    "mt-4 rounded-2xl border px-4 py-3 flex items-center gap-3 text-left";
  if (state.phase === "needs-pairing") {
    return (
      <div
        data-testid="print-needs-pairing"
        className={`${baseClass} bg-amber-50 border-amber-200 text-amber-900`}
      >
        <Printer className="w-4 h-4 shrink-0" />
        <div className="flex-1 text-[12.5px]">
          Empareja la impresora <strong>{name}</strong> para imprimir
          el ticket.
        </div>
        <button
          type="button"
          onClick={onPair}
          className="h-9 px-3 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-[12.5px] font-medium"
        >
          Conectar
        </button>
      </div>
    );
  }
  if (state.phase === "error") {
    return (
      <div
        data-testid="print-error"
        className={`${baseClass} bg-red-50 border-red-200 text-red-800`}
      >
        <Printer className="w-4 h-4 shrink-0" />
        <div className="flex-1 text-[12.5px]">
          No se pudo imprimir: {state.message}
        </div>
        <button
          type="button"
          onClick={onRetry}
          className="h-9 px-3 rounded-xl bg-red-600 hover:bg-red-700 text-white text-[12.5px] font-medium"
        >
          Reintentar
        </button>
      </div>
    );
  }
  if (state.phase === "done") {
    return (
      <div
        data-testid="print-done"
        className={`${baseClass} bg-emerald-50 border-emerald-200 text-emerald-800`}
      >
        <Check className="w-4 h-4 shrink-0" />
        <div className="flex-1 text-[12.5px]">Ticket impreso.</div>
      </div>
    );
  }
  return (
    <button
      type="button"
      data-testid="action-print"
      onClick={onPrint}
      disabled={state.phase === "printing"}
      className="mt-4 w-full h-12 rounded-2xl border border-slate-200 bg-white hover:bg-slate-50 text-[13.5px] font-medium text-mipiace-ink disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
    >
      {state.phase === "printing" ? (
        <Loader2 className="w-4 h-4 animate-spin text-mipiace-coral" />
      ) : (
        <Printer className="w-4 h-4" />
      )}
      {state.phase === "printing"
        ? "Imprimiendo…"
        : `Imprimir ticket (${mode})`}
    </button>
  );
}

function ActionButton({
  icon,
  label,
  onClick,
  disabled,
  disabledHint,
  testId,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  disabledHint?: string;
  testId?: string;
}) {
  return (
    <button
      data-testid={testId}
      onClick={onClick}
      disabled={disabled}
      title={disabled && disabledHint ? disabledHint : undefined}
      className="h-12 rounded-2xl bg-mipiace-stone hover:bg-slate-100 text-[13px] font-medium text-mipiace-ink disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
    >
      {icon}
      {label}
    </button>
  );
}

function QrModal({
  publicSlug,
  caption,
  onClose,
}: {
  publicSlug: string;
  caption: string;
  onClose: () => void;
}) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  // Construir la URL absoluta — el backend la sirve detrás del proxy.
  const publicUrl = useMemo(() => {
    const base = window.location.origin.replace(":5174", ":3001");
    return `${base}/tickets/${publicSlug}/pdf`;
  }, [publicSlug]);

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(publicUrl, { width: 320, margin: 1 }).then((url) => {
      if (!cancelled) setDataUrl(url);
    });
    return () => {
      cancelled = true;
    };
  }, [publicUrl]);

  return (
    <div className="fixed inset-0 z-[60] bg-mipiace-ink/80 flex items-center justify-center p-5">
      <div className="bg-white rounded-3xl p-6 max-w-sm w-full text-center">
        <div className="flex justify-end -mt-2 -mr-2 mb-1">
          <button
            onClick={onClose}
            className="h-9 w-9 rounded-full bg-mipiace-stone text-slate-500 flex items-center justify-center"
            aria-label="Cerrar"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <h2 className="text-[18px] font-semibold text-mipiace-ink mb-3">
          Escanea para descargar
        </h2>
        {dataUrl ? (
          <img
            data-testid="qr-image"
            src={dataUrl}
            alt="QR del ticket"
            className="mx-auto w-64 h-64"
          />
        ) : (
          <div className="h-64 flex items-center justify-center">
            <Loader2 className="w-6 h-6 animate-spin text-mipiace-coral" />
          </div>
        )}
        <p className="text-[13px] text-slate-500 mt-3">{caption}</p>
        <p className="text-[11px] text-slate-400 mt-1 break-all">{publicUrl}</p>
      </div>
    </div>
  );
}

function ViewModal({
  document,
  onClose,
}: {
  document: TicketDocument;
  onClose: () => void;
}) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  // B-TPV-Bugfix v1 · Bug-03: si renderTicketPdf lanza (datos
  // inesperados, font no carga, lo que sea), antes la promesa
  // quedaba rejected silenciosamente y el modal se quedaba con
  // spinner permanente. Ahora capturamos y mostramos el error.
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let url: string | null = null;
    (async () => {
      try {
        const bytes = await renderTicketPdf(document);
        if (cancelled) return;
        // El compilador estrecha Uint8Array<ArrayBufferLike> y exige
        // ArrayBuffer en BlobPart bajo lib DOM 5.x; clonamos a un
        // Uint8Array recién creado para asegurar el tipo.
        const blob = new Blob([new Uint8Array(bytes)], { type: "application/pdf" });
        url = URL.createObjectURL(blob);
        setBlobUrl(url);
      } catch (err) {
        if (cancelled) return;
        // Log a consola por si el desarrollador quiere debuggear
        // y mensaje visible al cajero.
        console.error("ViewModal · renderTicketPdf falló", err);
        setError(
          err instanceof Error
            ? `No se pudo generar el preview: ${err.message}`
            : "No se pudo generar el preview del ticket.",
        );
      }
    })();
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [document]);

  return (
    <div className="fixed inset-0 z-[60] bg-mipiace-ink/80 flex items-center justify-center p-5">
      <div className="bg-white rounded-3xl p-4 max-w-md w-full">
        <div className="flex justify-between items-center mb-2 px-2">
          <h2 className="text-[16px] font-semibold text-mipiace-ink">
            {vocab("ticketNoun", getCachedBusinessType())}
          </h2>
          <button
            onClick={onClose}
            className="h-9 w-9 rounded-full bg-mipiace-stone text-slate-500 flex items-center justify-center"
            aria-label="Cerrar"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        {blobUrl ? (
          <embed
            data-testid="ticket-preview"
            src={blobUrl}
            type="application/pdf"
            className="w-full h-[70vh] rounded-xl"
          />
        ) : error ? (
          // Bug-03: el spinner ya no se queda infinito en caso de fallo.
          <div className="h-[70vh] flex items-center justify-center p-6">
            <div className="text-center max-w-sm">
              <div className="text-[14px] font-medium text-red-700 mb-2">
                No se pudo generar el preview
              </div>
              <div className="text-[12.5px] text-slate-500">{error}</div>
            </div>
          </div>
        ) : (
          <div className="h-[70vh] flex items-center justify-center">
            <Loader2 className="w-6 h-6 animate-spin text-mipiace-coral" />
          </div>
        )}
      </div>
    </div>
  );
}
