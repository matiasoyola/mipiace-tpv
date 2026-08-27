// v1.12-mesas-abandonadas · las cuentas que sí tienen dinero dentro.
//
// Los DRAFT VACÍOS los suelta el barrido del corte de día de madrugada y
// nadie se entera: no hay consumo, no hay cliente, no hay nada que
// decidir. Esta sección es para los otros — una cuenta con líneas y más
// de 24 h abierta. No se anula sola JAMÁS: anularla es borrar una
// comanda, y esa decisión es de una persona.
//
// Por eso aquí sólo hay dos salidas:
//   · Cobrar  → se cobra donde se cobra, en el TPV con turno abierto. El
//               botón lleva allí; el admin NO abre un segundo camino de
//               cobro (ADR-010).
//   · Anular  → con PIN de encargado, no sólo con la sesión de admin
//               abierta en una pestaña.

import { useEffect, useState } from "react";

import { api, ApiError, readEffectiveAuth, type AdminRole } from "../api.js";
import { FieldError, OutlineButton, PrimaryButton } from "../ui.js";

interface AbandonedTicket {
  ticketId: string;
  tableId: string | null;
  tableName: string | null;
  total: string;
  lineCount: number;
  openedAt: string;
  openedByEmail: string | null;
  openedByAlias: string | null;
}

const TPV_URL = (import.meta.env.VITE_TPV_URL as string | undefined) ?? "/";

function formatEur(value: string): string {
  return new Intl.NumberFormat("es-ES", {
    style: "currency",
    currency: "EUR",
  }).format(Number(value));
}

// Mismo lenguaje que el mapa del TPV desde v1.10.3: "43 días", no
// "1032 h". El contador ya existe allí; esto es su gemelo en el admin.
function formatElapsed(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const totalH = Math.floor(Math.max(0, ms) / 3_600_000);
  if (totalH < 24) return `${totalH} h`;
  const days = Math.floor(totalH / 24);
  return days === 1 ? "1 día" : `${days} días`;
}

function openedByLabel(t: AbandonedTicket): string {
  if (t.openedByAlias) return t.openedByAlias;
  if (t.openedByEmail) return t.openedByEmail.split("@")[0] ?? t.openedByEmail;
  return "—";
}

export function AbandonedTablesSection({
  storeId,
  role,
}: {
  storeId: string;
  role: AdminRole | null;
}) {
  const [tickets, setTickets] = useState<AbandonedTicket[]>([]);
  const [thresholdHours, setThresholdHours] = useState(24);
  const [error, setError] = useState<string | null>(null);
  const [voiding, setVoiding] = useState<AbandonedTicket | null>(null);
  // El MANAGER también resuelve esto: es exactamente su trabajo. Lo que
  // no basta es la sesión — hace falta el PIN (ver modal).
  const canMutate =
    (role === "OWNER" || role === "MANAGER") && readEffectiveAuth().canEdit;

  async function refresh() {
    try {
      const res = await api<{
        thresholdHours: number;
        tickets: AbandonedTicket[];
      }>(`/admin/stores/${storeId}/tables/abandoned`);
      setTickets(res.tickets);
      setThresholdHours(res.thresholdHours);
      setError(null);
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
      else setError("Error inesperado");
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeId]);

  // Sin cuentas colgadas no hay nada que decir. Una sección vacía
  // permanente enseña a ignorar la sección.
  if (tickets.length === 0 && !error) return null;

  return (
    <section className="bg-white rounded-2xl border border-amber-300 p-6 md:p-7 mb-5">
      <div className="mb-4">
        <h2 className="text-[17px] font-semibold text-mipiace-ink tracking-tight">
          Cuentas abiertas sin cobrar
        </h2>
        <p className="text-[13px] text-slate-500 mt-1">
          {tickets.length === 1
            ? "Una mesa lleva"
            : `${tickets.length} mesas llevan`}{" "}
          más de {thresholdHours} h con consumo y sin cobrar. Las mesas
          abiertas por error y vacías se sueltan solas en el corte de día;
          estas tienen dinero dentro y las resuelve una persona.
        </p>
      </div>

      <FieldError message={error} />

      <div className="space-y-2">
        {tickets.map((t) => (
          <div
            key={t.ticketId}
            className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-slate-200 bg-mipiace-stone px-4 py-3"
          >
            <div className="min-w-[80px]">
              <div className="text-[15px] font-bold text-mipiace-ink">
                {t.tableName ?? "—"}
              </div>
              <div className="text-[11.5px] text-slate-500">
                {t.lineCount} {t.lineCount === 1 ? "línea" : "líneas"}
              </div>
            </div>
            <div className="min-w-[110px]">
              <div className="text-[17px] font-bold tabular-nums text-mipiace-ink">
                {formatEur(t.total)}
              </div>
            </div>
            <div className="min-w-[140px] text-[12.5px] text-slate-600">
              Abierta hace{" "}
              <span className="font-semibold text-amber-700">
                {formatElapsed(t.openedAt)}
              </span>
              <div className="text-[11.5px] text-slate-500">
                {new Date(t.openedAt).toLocaleString("es-ES")}
              </div>
            </div>
            <div className="min-w-[110px] text-[12.5px] text-slate-600">
              {openedByLabel(t)}
            </div>
            {canMutate && (
              <div className="ml-auto flex gap-2">
                <PrimaryButton
                  type="button"
                  onClick={() => {
                    window.open(TPV_URL, "_blank", "noopener");
                  }}
                  className="!w-auto !h-9 !px-3.5 !text-[12.5px]"
                >
                  Cobrar en el TPV
                </PrimaryButton>
                <OutlineButton
                  onClick={() => setVoiding(t)}
                  className="!h-9 !text-[12.5px]"
                >
                  Anular
                </OutlineButton>
              </div>
            )}
          </div>
        ))}
      </div>

      {voiding && (
        <VoidWithPinModal
          ticket={voiding}
          onClose={() => setVoiding(null)}
          onVoided={() => {
            setVoiding(null);
            refresh();
          }}
        />
      )}
    </section>
  );
}

// Anular con PIN. El texto dice lo que se pierde —el importe y las
// líneas— porque eso es lo que hace que alguien se lo piense.
function VoidWithPinModal({
  ticket,
  onClose,
  onVoided,
}: {
  ticket: AbandonedTicket;
  onClose: () => void;
  onVoided: () => void;
}) {
  const [pin, setPin] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (pin.length < 4) {
      setError("El PIN tiene al menos 4 dígitos.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api(`/admin/tables/abandoned/${ticket.ticketId}/void`, {
        method: "POST",
        body: { managerPin: pin, reason: reason.trim() || undefined },
      });
      onVoided();
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
      else setError("Error inesperado");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md bg-white rounded-2xl p-6">
        <h3 className="text-[16px] font-semibold text-mipiace-ink">
          Anular la cuenta de {ticket.tableName ?? "esta mesa"}
        </h3>
        <p className="text-[13px] text-slate-600 mt-2">
          Se anulan {formatEur(ticket.total)} en {ticket.lineCount}{" "}
          {ticket.lineCount === 1 ? "línea" : "líneas"} y la mesa queda
          libre. No se cobra nada y no se emite ticket. Queda registrado
          quién lo autorizó.
        </p>

        <label className="block mt-4 text-[12.5px] font-medium text-slate-600">
          PIN de encargado
          <input
            type="password"
            inputMode="numeric"
            autoFocus
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            className="mt-1 w-full h-11 rounded-xl border border-slate-300 px-3 text-[15px] tracking-[0.3em]"
          />
        </label>
        <label className="block mt-3 text-[12.5px] font-medium text-slate-600">
          Motivo (opcional)
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={200}
            placeholder="Mesa abierta por error el 9 de julio"
            className="mt-1 w-full h-11 rounded-xl border border-slate-300 px-3 text-[14px]"
          />
        </label>

        <FieldError message={error} />

        <div className="flex gap-2 mt-5">
          <OutlineButton onClick={onClose} className="!h-10 flex-1">
            Cancelar
          </OutlineButton>
          <PrimaryButton
            type="button"
            onClick={submit}
            disabled={busy}
            className="!h-10 flex-1"
          >
            {busy ? "Anulando…" : "Anular cuenta"}
          </PrimaryButton>
        </div>
      </div>
    </div>
  );
}
