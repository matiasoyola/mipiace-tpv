// v1.11-cierre-de-dia · la tarjeta de resumen del día.
//
// Es LA pantalla del bloque. Hasta v1.10 este resumen existía, pero
// enterrado: era la recompensa por haber tecleado 15 denominaciones de
// pie. Aquí pasa al frente, con el efectivo esperado ya puesto y un único
// botón. Contar el cajón queda como enlace opcional.
//
// Para quién es: alguien de pie, a las diez de la mañana, con la primera
// clienta esperando. De ahí las decisiones de forma:
//   - Efectivo y tarjeta arriba y en grande; el resto sólo si tiene
//     importe (una fila de "Bizum 0,00 €" es ruido para quien no cobra
//     por Bizum).
//   - Un botón primario y nada más al mismo nivel.
//   - Importes con `tabular-nums` — las cifras no bailan al actualizarse.
//   - Objetivos táctiles ≥ 44 px, también el enlace de "Cuadrar caja".
//   - Auditabilidad: "Ver detalle" abre el desglose que PRODUCE cada
//     importe (bruto · devoluciones · neto, fondo de caja, recuentos).
//     Ninguna cifra de la tarjeta es un total opaco.

import type { ReactNode } from "react";
import { useState } from "react";
import { AlertCircle, CheckCircle2, ChevronDown, Clock, Loader2 } from "lucide-react";

import {
  formatEur,
  METHOD_LABEL,
  type ShiftDaySummary,
} from "../lib/shiftSummary.js";

// Los dos que van arriba y en grande. El orden importa: en un bar y en
// una peluquería el efectivo es lo que hay que cuadrar.
const HEADLINE_METHODS = ["CASH", "CARD"] as const;

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("es-ES", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function DaySummaryCard({
  summary,
  title,
  busy = false,
  confirmDisabled = false,
  confirmLabel = "Confirmar",
  onConfirm,
  onCountCash,
  onCancel,
  error,
  notice,
}: {
  summary: ShiftDaySummary;
  title?: string;
  busy?: boolean;
  // Hay algo que aceptar antes de poder confirmar (tickets sin
  // sincronizar). Distinto de `busy`: aquí no hay nada en vuelo, hay algo
  // pendiente de leer.
  confirmDisabled?: boolean;
  confirmLabel?: string;
  // v1.22 §5 · bloque que se pinta justo ANTES del botón de confirmar
  // (hoy: el aviso de mesas abiertas del cierre). Va aquí dentro y no
  // debajo de la tarjeta porque lo que cuelga debajo del botón se lee
  // cuando ya se ha pulsado.
  notice?: ReactNode;
  onConfirm: () => void;
  // Ausente = este contexto no ofrece contar (p. ej. el turno ya está
  // cerrado y contado). Presente = enlace discreto "Cuadrar caja".
  onCountCash?: () => void;
  /** auditoria-sirope (#29) · la salida, DENTRO de la hoja. Fuera
   *  asomaba cortada por el borde inferior a 811 px de alto. */
  onCancel?: () => void;
  error?: string | null;
}) {
  const [showDetail, setShowDetail] = useState(false);
  const { shift, breakdown } = summary;
  // hierro-sirope (C) · puede no venir si la API es anterior al bloque.
  const vaciadas = summary.mesasVaciadas;

  const byMethod = new Map(breakdown.methods.map((m) => [m.method, m]));
  const headline = HEADLINE_METHODS.map((m) => ({
    method: m,
    net: byMethod.get(m)?.net ?? 0,
  }));
  // El resto sólo si tiene importe. Cero no es información.
  const rest = breakdown.methods.filter(
    (m) => !HEADLINE_METHODS.includes(m.method as (typeof HEADLINE_METHODS)[number]) && m.net !== 0,
  );

  const autoClosed = shift.closeReason === "AUTO_DAY_CUT";

  return (
    <div className="bg-white rounded-3xl border border-slate-200 p-5 sm:p-7">
      {/* Cabecera: qué turno es esto, sin obligar a deducirlo. */}
      <div className="flex items-start justify-between gap-3 mb-1">
        <h2 className="text-[20px] sm:text-[22px] font-semibold text-mipiace-ink tracking-tight">
          {title ?? "Resumen del día"}
        </h2>
        {shift.closedAt && (
          <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-1" />
        )}
      </div>
      <p className="text-[12.5px] text-slate-500 mb-5 leading-relaxed">
        {shift.registerName} · abierto {formatDateTime(shift.openedAt)}
        {shift.closedAt ? ` · cerrado ${formatDateTime(shift.closedAt)}` : ""}
      </p>

      {/* v1.11 · el turno lo cerramos nosotros. Decirlo es parte del trato:
          el cajero se encuentra el día de ayer ya cerrado y tiene derecho a
          saber que no lo cerró nadie. */}
      {autoClosed && (
        <div className="flex items-start gap-2 mb-4 rounded-xl bg-mipiace-stone px-3.5 py-2.5 text-[12.5px] text-slate-600">
          <Clock className="w-4 h-4 mt-px shrink-0 text-slate-400" />
          <span>
            Cerramos este turno automáticamente al cambiar el día. No hizo
            falta que lo cerrases tú.
          </span>
        </div>
      )}

      {/* El Z se archivó y después entraron ventas (terminal que estuvo sin
          red). Callarlo sería peor que decirlo. */}
      {shift.zReportStale && (
        <div className="flex items-start gap-2 mb-4 rounded-xl bg-amber-50 border border-amber-200 px-3.5 py-2.5 text-[12.5px] text-amber-800">
          <AlertCircle className="w-4 h-4 mt-px shrink-0" />
          <span>
            Se registraron ventas después de generar el informe Z (llegaron
            de un terminal sin conexión). Las cifras de abajo son las buenas;
            el PDF archivado se quedó corto.
          </span>
        </div>
      )}

      {/* Ventas del día. El importe grande, y debajo de dónde sale. */}
      <div className="mb-5">
        <div className="text-[12px] uppercase tracking-wider text-slate-500 mb-1">
          Ventas del día
        </div>
        <div className="text-[34px] sm:text-[38px] leading-none font-semibold tabular-nums text-mipiace-ink whitespace-nowrap">
          {formatEur(breakdown.netSales)}
        </div>
        {/* hierro-sirope (C) · LAS MESAS VACIADAS, EN EL MISMO GOLPE DE
            VISTA. Vaciar una mesa con platos dentro es comida que salió
            y no se cobró, igual que una devolución es dinero que salió:
            va en la misma línea y con el mismo peso. Si es 0 no sale —
            llenar la línea de ceros esconde el día en que no lo es. */}
        <div
          data-testid="resumen-recuentos"
          className="mt-1.5 text-[12.5px] text-slate-500 tabular-nums"
        >
          {summary.ticketsCount} {summary.ticketsCount === 1 ? "ticket" : "tickets"}
          {summary.refundsCount > 0
            ? ` · ${summary.refundsCount} ${summary.refundsCount === 1 ? "devolución" : "devoluciones"}`
            : ""}
          {vaciadas && vaciadas.count > 0 && (
            <span data-testid="resumen-mesas-vaciadas">
              {` · ${vaciadas.count} ${
                vaciadas.count === 1 ? "mesa vaciada" : "mesas vaciadas"
              } (${formatEur(vaciadas.total)})`}
            </span>
          )}
        </div>
      </div>

      {/* Efectivo y tarjeta, arriba y en grande. */}
      <div className="grid grid-cols-2 gap-2.5 mb-3">
        {headline.map((h) => (
          <div key={h.method} className="rounded-2xl bg-mipiace-stone px-3.5 py-3 min-w-0">
            <div className="text-[11.5px] uppercase tracking-wider text-slate-500 mb-1 truncate">
              {METHOD_LABEL[h.method] ?? h.method}
            </div>
            <div className="text-[19px] sm:text-[22px] font-semibold tabular-nums text-mipiace-ink whitespace-nowrap">
              {formatEur(h.net)}
            </div>
          </div>
        ))}
      </div>

      {rest.length > 0 && (
        <div className="mb-4 space-y-1 text-[13px]">
          {rest.map((m) => (
            <div key={m.method} className="flex justify-between gap-3">
              <span className="text-slate-500 min-w-0">
                {METHOD_LABEL[m.method] ?? m.method}
              </span>
              <span className="tabular-nums text-mipiace-ink shrink-0 whitespace-nowrap">
                {formatEur(m.net)}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* v1.8-Fiado convive: un fiado no entró en caja y decirlo aquí evita
          que el cajero busque un dinero que nadie ha pagado todavía. */}
      {breakdown.creditSales && breakdown.creditSales.count > 0 && (
        <div className="mb-4 flex justify-between gap-3 text-[13px]">
          <span className="text-slate-500 min-w-0">
            A crédito ({breakdown.creditSales.count}) · no cobrado
          </span>
          <span className="tabular-nums text-slate-500 shrink-0 whitespace-nowrap">
            {formatEur(breakdown.creditSales.total)}
          </span>
        </div>
      )}

      {/* El número operativo: lo que debería haber en el cajón. */}
      <div className="rounded-2xl border border-slate-200 px-4 py-3.5 mb-4">
        {/* A 320 px la etiqueta necesita dos líneas; el importe NUNCA se
            parte (un "€" solo en la línea siguiente se lee como otra cifra). */}
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-[13px] text-slate-600 min-w-0">
            Efectivo esperado en el cajón
          </span>
          <span className="text-[19px] font-semibold tabular-nums text-mipiace-ink shrink-0 whitespace-nowrap">
            {formatEur(summary.cashTheoretical)}
          </span>
        </div>
        <div className="mt-1 text-[11.5px] text-slate-400 tabular-nums">
          fondo <span className="whitespace-nowrap">{formatEur(shift.cashOpening)}</span> +
          efectivo neto{" "}
          <span className="whitespace-nowrap">
            {formatEur(byMethod.get("CASH")?.net ?? 0)}
          </span>
        </div>
        {summary.descuadre != null && shift.cashCounted != null && (
          <div
            className={
              "mt-2.5 pt-2.5 border-t border-slate-100 flex justify-between gap-3 text-[13px] font-medium " +
              (Math.abs(summary.descuadre) > 5 ? "text-red-700" : "text-mipiace-ink")
            }
          >
            <span className="min-w-0">
              Contado {formatEur(shift.cashCounted)} · descuadre
            </span>
            <span className="tabular-nums shrink-0 whitespace-nowrap">
              {summary.descuadre >= 0 ? "+" : ""}
              {formatEur(summary.descuadre)}
            </span>
          </div>
        )}
      </div>

      {/* Auditabilidad: de dónde sale cada cifra de arriba. */}
      <button
        type="button"
        onClick={() => setShowDetail((v) => !v)}
        aria-expanded={showDetail}
        className="w-full min-h-[44px] flex items-center justify-center gap-1.5 text-[13px] text-slate-500 hover:text-mipiace-ink"
      >
        {showDetail ? "Ocultar detalle" : "Ver detalle"}
        <ChevronDown
          className={"w-4 h-4 transition-transform " + (showDetail ? "rotate-180" : "")}
        />
      </button>

      {showDetail && (
        <div className="mb-4 rounded-2xl border border-slate-200 overflow-x-auto">
          <table className="w-full min-w-[300px] text-[12.5px]">
            <thead className="bg-mipiace-stone text-slate-500 text-[10.5px] uppercase tracking-wider">
              <tr>
                <th className="text-left py-2 px-2.5 font-medium">Método</th>
                <th className="text-right py-2 px-2 font-medium">Bruto</th>
                <th className="text-right py-2 px-2 font-medium">Devol.</th>
                <th className="text-right py-2 px-2.5 font-medium">Neto</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {breakdown.methods.map((m) => (
                <tr key={m.method}>
                  <td className="py-2 px-2.5 text-mipiace-ink">
                    {METHOD_LABEL[m.method] ?? m.method}
                  </td>
                  <td className="py-2 px-2 text-right tabular-nums text-slate-600">
                    {formatEur(m.gross)}
                  </td>
                  <td className="py-2 px-2 text-right tabular-nums text-slate-600">
                    {m.refunds > 0 ? `−${formatEur(m.refunds)}` : "—"}
                  </td>
                  <td className="py-2 px-2.5 text-right tabular-nums font-medium text-mipiace-ink">
                    {formatEur(m.net)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-mipiace-stone/60">
              <tr>
                <td className="py-2 px-2.5 font-medium text-mipiace-ink">Ventas netas</td>
                <td className="py-2 px-2 text-right tabular-nums text-slate-500">
                  {formatEur(breakdown.grossSales)}
                </td>
                <td className="py-2 px-2 text-right tabular-nums text-slate-500">
                  {breakdown.refundsTotal > 0 ? `−${formatEur(breakdown.refundsTotal)}` : "—"}
                </td>
                <td className="py-2 px-2.5 text-right tabular-nums font-semibold text-mipiace-ink">
                  {formatEur(breakdown.netSales)}
                </td>
              </tr>
            </tfoot>
          </table>
          {/* hierro-sirope (C) · el desglose por motivo, con los mismos
              números y las mismas palabras que el PDF del Z (el servidor
              manda la etiqueta ya resuelta). */}
          {vaciadas && vaciadas.count > 0 && (
            <div
              data-testid="detalle-mesas-vaciadas"
              className="px-2.5 py-2.5 text-[12px] border-t border-slate-200 space-y-0.5 tabular-nums"
            >
              <div className="flex justify-between gap-3 font-medium text-mipiace-ink">
                <span>
                  Mesas vaciadas ({vaciadas.count}) · comida que salió y no se
                  cobró
                </span>
                <span className="shrink-0 whitespace-nowrap">
                  {formatEur(vaciadas.total)}
                </span>
              </div>
              {vaciadas.porMotivo.map((m) => (
                <div
                  key={m.motivo ?? "sin-motivo"}
                  className="flex justify-between gap-3 text-slate-600"
                >
                  <span className="min-w-0">
                    {m.label} ({m.count})
                  </span>
                  <span className="shrink-0 whitespace-nowrap">
                    {formatEur(m.total)}
                  </span>
                </div>
              ))}
            </div>
          )}
          <div className="px-2.5 py-2.5 text-[11.5px] text-slate-500 border-t border-slate-200 space-y-0.5 tabular-nums">
            <div>Fondo de caja al abrir: {formatEur(shift.cashOpening)}</div>
            <div>Turno de {shift.cashierLabel}</div>
            {shift.closedByLabel && <div>Cerrado por {shift.closedByLabel}</div>}
            {shift.cashCounted == null && shift.closedAt && (
              <div>Nadie contó el efectivo: el descuadre es desconocido, no cero.</div>
            )}
          </div>
        </div>
      )}

      {error && (
        <div className="mt-1 mb-3 flex items-start gap-2 text-[13px] text-red-700 bg-red-50 rounded-xl px-3.5 py-2.5">
          <AlertCircle className="w-4 h-4 mt-px shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {notice && <div className="mb-3">{notice}</div>}

      {/* auditoria-sirope (#29) · «CANCELAR» DENTRO DE LA HOJA.
          Vivía fuera de la tarjeta, debajo del todo, y a 811 px de alto
          asomaba cortado por el borde inferior de la pantalla (captura
          82): la única salida de «Cerrar el día» era medio visible.
          Dentro de la hoja y encima de las acciones, que es donde se
          busca. */}

      {/* auditoria-sirope (#27) · «CUADRAR CAJA» ES UN BOTÓN.
          Era un enlace subrayado en gris debajo del botón coral, o sea
          la jerarquía de «esto no hace falta». Y hace falta: es lo
          único que convierte el descuadre en un número conocido —sin
          contar, el descuadre no es cero, es desconocido—.

          Lo que NO cambia, porque es decisión de v1.11 y de Matías:
          «Cerrar turno» sigue siendo la acción principal y sigue
          cerrando sin contar. Encender `requireCashCountOnClose` en una
          cuenta concreta es otra conversación, y no es código.

          Las dos en la misma fila: el primario con más peso (coral,
          56 px, 1,4 fr) y el secundario visible a su lado. */}
      <div className={onCountCash ? "mt-1 flex gap-2.5" : "mt-1"}>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            data-testid="cerrar-dia-cancelar"
            className="h-14 px-5 rounded-2xl text-[14px] font-medium text-slate-500 hover:bg-slate-50 disabled:opacity-50"
          >
            Cancelar
          </button>
        )}
        {onCountCash && (
          <button
            type="button"
            onClick={onCountCash}
            disabled={busy}
            data-testid="cuadrar-caja"
            className="flex-1 h-14 rounded-2xl border border-slate-300 hover:bg-slate-50 text-mipiace-ink font-medium text-[15px] disabled:opacity-50"
          >
            Cuadrar caja
          </button>
        )}
        <button
          type="button"
          onClick={onConfirm}
          disabled={busy || confirmDisabled}
          data-testid="cerrar-turno"
          className={`h-14 bg-mipiace-coral hover:bg-mipiace-coral-dark text-white font-medium text-[15px] rounded-2xl disabled:opacity-50 flex items-center justify-center gap-2 ${
            onCountCash ? "flex-[1.4]" : "w-full"
          }`}
        >
          {busy && <Loader2 className="w-4 h-4 animate-spin" />}
          {confirmLabel}
        </button>
      </div>
    </div>
  );
}
