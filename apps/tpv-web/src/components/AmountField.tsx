// v1.12-manos-de-camarero · el campo de importe que nunca abre el
// teclado del sistema (hallazgo H2 del 2026-08-27).
//
// La coraza anti-IME son cuatro cosas a la vez, y las cuatro hacen
// falta en el Chrome/WebView de un Android de 2020:
//   - `readOnly`      → el navegador no ofrece edición de texto.
//   - `inputMode=none`→ y si aun así enfocara, no pide teclado.
//   - `onFocus` → blur → ni siquiera se queda el foco de texto.
//   - `user-select: none` + `-webkit-touch-callout: none` → mata el
//     menú nativo "Cortar / Copiar / Seleccionar todo" que salía
//     flotando sobre el ticket al mantener el dedo.
//
// Quien escribe es el `CashPad` de la hoja: al tocar el campo, éste se
// marca como activo y el pad escribe encima.

export function AmountField({
  value,
  active,
  onActivate,
  placeholder = "0,00",
  suffix = "€",
  ariaLabel,
  id,
  disabled = false,
  align = "right",
  size = "md",
  className = "",
}: {
  value: string;
  active: boolean;
  onActivate: () => void;
  placeholder?: string;
  // "€" en importes; sin sufijo en los conteos del arqueo.
  suffix?: string | null;
  ariaLabel: string;
  id?: string;
  disabled?: boolean;
  align?: "right" | "center";
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const height =
    size === "lg" ? "h-touch-lg" : size === "sm" ? "h-touch" : "h-touch";
  const text =
    size === "lg" ? "text-[26px]" : size === "sm" ? "text-[15px]" : "text-[17px]";
  const ring = active
    ? "border-mipiace-coral bg-white ring-2 ring-mipiace-coral/30"
    : "border-slate-200 bg-white hover:bg-slate-50";

  return (
    <div className={"relative " + className}>
      <input
        id={id}
        value={value}
        placeholder={placeholder}
        aria-label={ariaLabel}
        aria-current={active ? "true" : undefined}
        disabled={disabled}
        // Sólo lectura de verdad: el pad es el único que escribe.
        readOnly
        inputMode="none"
        onFocus={(e) => e.target.blur()}
        onClick={() => {
          if (!disabled) onActivate();
        }}
        style={{
          userSelect: "none",
          WebkitUserSelect: "none",
          WebkitTouchCallout: "none",
        }}
        className={
          `w-full ${height} ${text} font-semibold tabular-nums rounded-2xl border ` +
          `px-3 ${suffix ? "pr-9" : ""} ${align === "center" ? "text-center" : "text-right"} ` +
          `text-mipiace-ink placeholder:text-slate-300 focus:outline-none cursor-pointer ` +
          `disabled:opacity-50 ${ring}`
        }
      />
      {suffix && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-[15px] font-medium text-slate-400"
        >
          {suffix}
        </span>
      )}
    </div>
  );
}
