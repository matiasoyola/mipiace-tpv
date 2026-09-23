// Sección "Comunicación de ticket" del detalle de tienda
// (B-Print fase 1 · Frente 6). Permite al OWNER configurar:
//   - Si enviamos automáticamente el ticket por email al cliente con
//     dirección registrada.
//   - Qué botones aparecen en la pantalla post-cobro del TPV
//     (QR / Descargar / Ver).
//   - Plantillas del asunto / cuerpo del email + caption del QR, con
//     variables `{tienda}`, `{numero}`, `{total}`, `{fecha}`.

import { useEffect, useState } from "react";
import { MailWarning } from "lucide-react";

import { api, ApiError, readEffectiveAuth, type AdminRole } from "../api.js";
import { FieldError, OutlineButton, PrimaryButton, SuccessBanner } from "../ui.js";

interface EmailFailure {
  id: string;
  internalNumber: string;
  total: number;
  createdAt: string;
  registerName: string;
  email: { to: string | null; status: string | null; reason: string | null };
}

interface TicketDeliverySettings {
  emailAutoIfCustomerHasEmail: boolean;
  showQrButton: boolean;
  showDownloadButton: boolean;
  showViewButton: boolean;
  emailSubject: string;
  emailBody: string;
  qrCaption: string;
}

export function TicketDeliverySection({
  storeId,
  role,
}: {
  storeId: string;
  role: AdminRole | null;
}) {
  const [settings, setSettings] = useState<TicketDeliverySettings | null>(null);
  const [form, setForm] = useState<TicketDeliverySettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // v1.4-Bugs-Operativos Lote 2: durante impersonation readonly el
  // JWT lleva role=OWNER pero las mutaciones están bloqueadas por el
  // backend; usamos readEffectiveAuth para no ofrecer botones que
  // fallarían con IMPERSONATION_READONLY.
  const canEdit = role === "OWNER" && readEffectiveAuth().canEdit;

  useEffect(() => {
    api<{ ticketDelivery: TicketDeliverySettings }>(
      `/admin/stores/${storeId}/ticket-delivery`,
    )
      .then((res) => {
        setSettings(res.ticketDelivery);
        setForm(res.ticketDelivery);
      })
      .catch((err) => {
        if (err instanceof ApiError) setError(err.message);
      });
  }, [storeId]);

  async function onSave() {
    if (!form) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await api<{ ticketDelivery: TicketDeliverySettings }>(
        `/admin/stores/${storeId}/ticket-delivery`,
        { method: "PATCH", body: form },
      );
      setSettings(res.ticketDelivery);
      setForm(res.ticketDelivery);
      setSuccess("Comunicación de ticket guardada.");
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
      else setError("Error inesperado");
    } finally {
      setBusy(false);
    }
  }

  if (!form || !settings) return null;
  const dirty = JSON.stringify(form) !== JSON.stringify(settings);

  return (
    <section className="bg-white rounded-2xl border border-slate-200 p-6 md:p-7 mb-5">
      <div className="mb-4">
        <h2 className="text-[17px] font-semibold text-mipiace-ink tracking-tight">
          Comunicación de ticket
        </h2>
        <p className="text-[13px] text-slate-500 mt-1">
          Cómo entregamos el ticket digital al cliente: email automático,
          QR para escanear y botones disponibles en el TPV tras el cobro.
          {!canEdit && " Sólo el propietario puede editarlo."}
        </p>
      </div>

      {success && <SuccessBanner message={success} />}
      <FieldError message={error} />

      <div className="space-y-3 mb-5">
        <Toggle
          label="Enviar automáticamente al cliente con email"
          hint="Si el contacto vinculado al ticket tiene email, le mandamos el PDF sin que el cajero tenga que escribirlo."
          checked={form.emailAutoIfCustomerHasEmail}
          disabled={!canEdit}
          onChange={(v) => setForm({ ...form, emailAutoIfCustomerHasEmail: v })}
        />
        <Toggle
          label="Mostrar botón “Mostrar QR” tras el cobro"
          hint="El cliente escanea el QR con su móvil y descarga el PDF sin email."
          checked={form.showQrButton}
          disabled={!canEdit}
          onChange={(v) => setForm({ ...form, showQrButton: v })}
        />
        <Toggle
          label="Mostrar botón “Descargar PDF”"
          hint="El cajero descarga el PDF al dispositivo (útil si quiere imprimirlo desde otra impresora más adelante)."
          checked={form.showDownloadButton}
          disabled={!canEdit}
          onChange={(v) => setForm({ ...form, showDownloadButton: v })}
        />
        <Toggle
          label="Mostrar botón “Ver ticket”"
          hint="Abre el PDF en pantalla — útil para revisar antes de enviar."
          checked={form.showViewButton}
          disabled={!canEdit}
          onChange={(v) => setForm({ ...form, showViewButton: v })}
        />
      </div>

      <div className="space-y-4">
        <TextArea
          id="emailSubject"
          label="Asunto del email"
          hint="Variables disponibles: {tienda}, {numero}, {total}, {fecha}."
          value={form.emailSubject}
          rows={1}
          disabled={!canEdit}
          onChange={(v) => setForm({ ...form, emailSubject: v })}
        />
        <TextArea
          id="emailBody"
          label="Cuerpo del email"
          hint="Texto plano. Las mismas variables se sustituyen al enviar."
          value={form.emailBody}
          rows={5}
          disabled={!canEdit}
          onChange={(v) => setForm({ ...form, emailBody: v })}
        />
        <TextArea
          id="qrCaption"
          label="Texto bajo el QR"
          hint="Se muestra al cliente cuando ve el QR en pantalla."
          value={form.qrCaption}
          rows={1}
          disabled={!canEdit}
          onChange={(v) => setForm({ ...form, qrCaption: v })}
        />
      </div>

      {canEdit && (
        <div className="flex gap-2.5 mt-5">
          <PrimaryButton onClick={onSave} busy={busy} disabled={!dirty}>
            Guardar cambios
          </PrimaryButton>
          {dirty && (
            <OutlineButton onClick={() => setForm(settings)} disabled={busy}>
              Descartar
            </OutlineButton>
          )}
        </div>
      )}

      <EmailFailures storeId={storeId} />
    </section>
  );
}

// Sole (23-09-2026) · los tickets de esta tienda cuyo email no salió.
//
// Va DEBAJO de la configuración que lo gobierna y no en una pantalla
// nueva: el propietario que acaba de mirar "¿mando el ticket por email?"
// es el mismo que tiene que enterarse de que alguno no llegó.
//
// Esto es el RESUMEN. El sitio donde se arregla es el histórico del TPV:
// allí está Ana, allí está el botón de corregir la dirección y reenviar,
// y allí es donde se trabaja en la peluquería. Si esta lista está vacía
// no se pinta nada — una sección que dice "todo bien" todos los días
// acaba siendo una sección que nadie lee.
function EmailFailures({ storeId }: { storeId: string }) {
  const [items, setItems] = useState<EmailFailure[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<{ items: EmailFailure[] }>(
      `/admin/stores/${storeId}/email-failures`,
    )
      .then((res) => {
        if (!cancelled) setItems(res.items);
      })
      .catch(() => {
        // Sin conexión o sin permiso: la sección no aparece. No se
        // inventa un "0 fallos" que podría ser mentira.
        if (!cancelled) setItems(null);
      });
    return () => {
      cancelled = true;
    };
  }, [storeId]);

  if (!items || items.length === 0) return null;

  return (
    <div
      data-testid="email-failures"
      className="mt-6 pt-5 border-t border-slate-200"
    >
      <h3 className="text-[15px] font-semibold text-mipiace-ink tracking-tight flex items-center gap-2">
        <MailWarning className="w-4 h-4 text-amber-600" />
        No se pudieron enviar ({items.length})
      </h3>
      <p className="text-[12.5px] text-slate-500 mt-1 mb-3">
        Se corrigen desde el TPV: abre el ticket en el historial, escribe
        el email bueno y vuelve a enviarlo.
      </p>
      <ul className="divide-y divide-slate-100">
        {items.map((t) => (
          <li
            key={t.id}
            className="py-2.5 flex items-baseline gap-3 text-[13px]"
          >
            <span className="tabular-nums font-medium text-mipiace-ink shrink-0">
              #{t.internalNumber}
            </span>
            <span className="tabular-nums text-slate-500 shrink-0">
              {t.total.toFixed(2).replace(".", ",")} €
            </span>
            <span className="text-slate-500 shrink-0">
              {new Date(t.createdAt).toLocaleDateString("es-ES", {
                day: "2-digit",
                month: "short",
              })}
            </span>
            <span className="flex-1 min-w-0 truncate text-slate-600">
              {t.email.to ?? "—"}
            </span>
            <span className="text-amber-700 shrink-0 text-[12.5px]">
              {t.email.reason ?? "No se pudo enviar"}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label
      className={
        "flex items-start gap-3 p-3 rounded-xl bg-mipiace-stone border border-transparent " +
        (disabled ? "opacity-60 cursor-not-allowed" : "cursor-pointer hover:bg-slate-100")
      }
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 rounded border-slate-300 text-mipiace-coral focus:ring-mipiace-coral"
      />
      <div className="flex-1 min-w-0">
        <div className="text-[13.5px] font-medium text-mipiace-ink">{label}</div>
        {hint && (
          <div className="text-[12px] text-slate-500 mt-0.5">{hint}</div>
        )}
      </div>
    </label>
  );
}

function TextArea({
  id,
  label,
  hint,
  value,
  rows,
  onChange,
  disabled,
}: {
  id: string;
  label: string;
  hint?: string;
  value: string;
  rows: number;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <div>
      <label
        htmlFor={id}
        className="block text-[13px] font-medium text-mipiace-ink-soft mb-1.5"
      >
        {label}
      </label>
      <textarea
        id={id}
        rows={rows}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3.5 py-2.5 rounded-xl bg-mipiace-stone border border-transparent text-[14px] text-mipiace-ink focus:bg-white focus:border-mipiace-coral/30 focus:ring-2 focus:ring-mipiace-coral/30 focus:outline-none disabled:opacity-60"
      />
      {hint && (
        <div className="text-[12px] text-slate-500 mt-1">{hint}</div>
      )}
    </div>
  );
}
