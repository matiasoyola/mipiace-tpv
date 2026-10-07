// v1.14-la-comanda-se-ve · las dos hojas de "Más".
//
//   - `TicketActionsSheet` (hallazgo C1 + m1): las siete acciones
//     secundarias del ticket —Cliente, Descuento, Observaciones, Mover
//     mesa, Partir cuenta, Agrupar y Cancelar— que hasta ahora ocupaban
//     135 px del mejor sitio del panel para usarse una de cada veinte
//     veces. El sitio se lo queda el desglose de artículos, que es lo
//     que se mira.
//
//   - `CategoriesSheet` (hallazgo M1): las categorías que no caben en
//     las dos filas de chips. El scroll horizontal sin affordance es un
//     anti-patrón prohibido por `docs/ux-principles.md` §1.8 ("nunca
//     horizontal — el horizontal es ilegible en táctil"), y taparlo con
//     un gradiente sería seguir teniendo el problema con una pista.
//
// Ambas son hojas de acciones secundarias, no del flujo de cobro: el
// principio §1.7 prohíbe modales en el flujo crítico, y ninguna de las
// dos lo está. El Atrás de Android las cierra (`useBackGuard`).

import { X } from "lucide-react";

import { useBackGuard } from "../hooks/useBackGuard.js";
import { type CategoryTone } from "../lib/categoryTones.js";

// Estructura compartida por las dos hojas: fondo, caja, cabecera con
// título y cierre. Misma estética que `SheetWrap` de `SalePage`, pero
// con la caja más ancha (las rejillas de acciones y de categorías
// necesitan tres columnas para que los targets lleguen a 48 px).
function ActionSheetShell({
  title,
  subtitle,
  onClose,
  children,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  useBackGuard(onClose);
  return (
    <div
      className="fixed inset-0 z-50 bg-mipiace-ink/40 flex items-end sm:items-center justify-center p-4 font-sans"
      onClick={onClose}
      style={{ paddingBottom: "calc(1rem + var(--keyboard-offset, 0px))" }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="bg-white w-full max-w-lg rounded-3xl border border-slate-200 p-5 md:p-6 max-h-[88dvh] overflow-y-auto"
      >
        <div className="flex items-start justify-between mb-4">
          <div className="min-w-0">
            <h2 className="text-[18px] font-semibold text-mipiace-ink">{title}</h2>
            {subtitle && (
              <p className="text-[12.5px] text-slate-500 mt-0.5">{subtitle}</p>
            )}
          </div>
          <button
            onClick={onClose}
            className="h-11 w-11 shrink-0 rounded-xl hover:bg-slate-50 text-slate-500 flex items-center justify-center"
            aria-label="Cerrar"
          >
            <X className="w-4 h-4" strokeWidth={2.25} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export interface TicketAction {
  key: string;
  label: string;
  hint: string;
  onClick: () => void;
  disabled?: boolean;
  // "Cancelar" es la única destructiva. Va en su propia fila abajo, no
  // mezclada en la rejilla: que cueste un toque más y un vistazo más es
  // una feature (hallazgo m1 de la auditoría).
  destructive?: boolean;
}

/**
 * v2-H1 · las siete acciones secundarias, construidas en UN sitio.
 *
 * Hasta ahora la lista vivía dentro de `TicketPanel`, que es el panel
 * del TPV claro. La venta de hostelería no tiene ese panel —su comanda
 * es otro componente— y necesita las MISMAS acciones con los MISMOS
 * rótulos: mover mesa, partir cuenta, agrupar, vaciar mesa. Con la lista
 * en dos sitios, añadir una acción a la hoja del bar y olvidarla en la
 * del retail es cuestión de tiempo, y el síntoma sería «en mi TPV eso no
 * está».
 *
 * Es una extracción literal: mismas claves, mismos rótulos, mismas
 * pistas, mismo orden y las mismas tres condiciones (sin Holded no hay
 * «Cliente»; sin mesa no hay mover/partir/agrupar; «Desagrupar» sólo con
 * mesas absorbidas). El texto de la destructiva sigue dependiendo del
 * contexto, que es lo que impide etiquetar «Volver a la agenda» con el
 * aspecto de «Vaciar mesa».
 */
export function buildTicketActions(input: {
  holdedEnabled: boolean;
  hasTable: boolean;
  hasAppointment: boolean;
  hasGroupedTables: boolean;
  contactName: string | null;
  notes: string;
  lineCount: number;
  /** "Ticket" o "Comprobante", según el vertical. En minúsculas. */
  ticketNounLower: string;
  onClickContact: () => void;
  onClickDiscountGlobal: () => void;
  onClickNotes: () => void;
  onClickMoveTable: () => void;
  onClickSplitBill: () => void;
  onClickGroup: () => void;
  onClickUngroup: () => void;
  onCancel: () => void;
}): TicketAction[] {
  const actions: TicketAction[] = [];
  // catalogo-local · «Cliente» abre el ContactSheet, que sin Holded no
  // se monta. Un botón que no abre nada es peor que no tener el botón.
  //
  // OJO, no confundir con el picker de clientes del CRM (F1): ése sigue
  // funcionando sin Holded y de hecho es lo único que le queda a ese
  // comercio para saber a quién atiende.
  if (input.holdedEnabled) {
    actions.push({
      key: "contact",
      label: input.contactName
        ? `Cliente: ${input.contactName.split(" ")[0]}`
        : "Cliente",
      hint: input.contactName
        ? `Cliente: ${input.contactName}`
        : "Asignar cliente al ticket",
      onClick: input.onClickContact,
    });
  }
  actions.push(
    {
      key: "discount",
      label: "Descuento",
      hint: "Aplicar descuento global al ticket",
      onClick: input.onClickDiscountGlobal,
    },
    {
      key: "notes",
      label: `Observaciones${input.notes ? " ●" : ""}`,
      hint: `Observaciones internas del ${input.ticketNounLower}`,
      onClick: input.onClickNotes,
    },
  );
  if (input.hasTable) {
    actions.push(
      {
        key: "move",
        label: "Mover mesa",
        hint: "Llevar este ticket a otra mesa",
        onClick: input.onClickMoveTable,
      },
      {
        key: "split",
        label: "Partir cuenta",
        hint: "Cobrar parte ahora y dejar el resto pendiente",
        onClick: input.onClickSplitBill,
      },
      {
        key: "group",
        label: "Agrupar",
        hint: "Unir las cuentas de otras mesas ocupadas a esta",
        onClick: input.onClickGroup,
      },
    );
    if (input.hasGroupedTables) {
      actions.push({
        key: "ungroup",
        label: "Desagrupar",
        hint: "Separar las mesas agrupadas (cada una recupera sus líneas)",
        onClick: input.onClickUngroup,
      });
    }
  }
  actions.push({
    key: "cancel",
    // v1.9.7 · en modo mesa el botón NUNCA se deshabilita: una mesa con
    // un DRAFT vacío figura ocupada, y con "Cancelar" en gris no hay
    // forma de liberarla desde el TPV (implantación de Sirope,
    // 2026-07-08). En venta rápida sin nada que destruir sí se apaga.
    // B-reservas-5 F3 · en contexto CITA el botón NO destruye: sale a la
    // agenda y deja el borrador donde está.
    label: input.hasTable
      ? "Vaciar mesa"
      : input.hasAppointment
        ? "Volver a la agenda"
        : "Cancelar",
    hint: input.hasTable
      ? "Cancela la cuenta y libera la mesa"
      : input.hasAppointment
        ? "El borrador de la cita se queda como está"
        : `Vacía el ${input.ticketNounLower} en curso`,
    onClick: input.onCancel,
    disabled:
      !input.hasTable &&
      !input.hasAppointment &&
      input.lineCount === 0 &&
      !input.contactName &&
      !input.notes,
    destructive: !input.hasAppointment,
  });
  return actions;
}

export function TicketActionsSheet({
  actions,
  onClose,
}: {
  actions: TicketAction[];
  onClose: () => void;
}) {
  const normal = actions.filter((a) => !a.destructive);
  const destructive = actions.filter((a) => a.destructive);
  return (
    <ActionSheetShell title="Más acciones" onClose={onClose}>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {normal.map((a) => (
          <button
            key={a.key}
            type="button"
            onClick={() => {
              a.onClick();
              onClose();
            }}
            disabled={a.disabled}
            title={a.hint}
            className="min-h-touch px-3 py-2.5 rounded-2xl bg-mipiace-stone hover:bg-slate-100 disabled:opacity-50 text-[13.5px] font-medium text-mipiace-ink text-left"
          >
            {a.label}
          </button>
        ))}
      </div>
      {destructive.length > 0 && (
        <div className="mt-4 pt-4 border-t border-slate-100 space-y-2">
          {destructive.map((a) => (
            <button
              key={a.key}
              type="button"
              onClick={() => {
                a.onClick();
                onClose();
              }}
              disabled={a.disabled}
              title={a.hint}
              className="w-full min-h-touch px-4 rounded-2xl bg-red-50 hover:bg-red-100 disabled:opacity-50 text-[13.5px] font-medium text-red-700 flex items-center justify-between gap-3"
            >
              <span>{a.label}</span>
              <span className="text-[12px] font-normal text-red-600/80 text-right">
                {a.hint}
              </span>
            </button>
          ))}
        </div>
      )}
    </ActionSheetShell>
  );
}

export interface SheetCategory {
  tag: string;
  label: string;
  tone: CategoryTone;
  icon: React.ReactNode;
}

export function CategoriesSheet({
  categories,
  selectedTag,
  onSelect,
  onClose,
}: {
  categories: SheetCategory[];
  selectedTag: string | null;
  onSelect: (tag: string) => void;
  onClose: () => void;
}) {
  return (
    <ActionSheetShell
      title="Más categorías"
      subtitle={`${categories.length} ${categories.length === 1 ? "categoría" : "categorías"} que no caben en la barra`}
      onClose={onClose}
    >
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {categories.map((c) => {
          const active = selectedTag === c.tag;
          return (
            <button
              key={c.tag}
              type="button"
              onClick={() => {
                onSelect(c.tag);
                onClose();
              }}
              // v1.14.1 §2 · el fondo es neutro y el tono se queda en el
              // icono, igual que en la barra. Y el seleccionado va en
              // coral SUAVE: el coral pleno es de "Cobrar" y de nadie
              // más en esta pantalla.
              className={
                active
                  ? "min-h-touch px-3 py-2.5 rounded-2xl border bg-mipiace-coral-soft border-mipiace-coral text-mipiace-coral-dark text-[13.5px] font-medium flex items-center gap-2 text-left"
                  : "min-h-touch px-3 py-2.5 rounded-2xl border bg-white border-slate-200 text-mipiace-ink hover:border-mipiace-coral/40 text-[13.5px] font-medium flex items-center gap-2 text-left"
              }
            >
              <span className="shrink-0">{c.icon}</span>
              <span className="truncate">{c.label}</span>
            </button>
          );
        })}
      </div>
    </ActionSheetShell>
  );
}
