// v1.12-manos-de-camarero · teclado numérico propio (hallazgo H2 de las
// pruebas físicas del 2026-08-27 sobre el AP11).
//
// El problema: al tocar cualquier importe salía el teclado de Android.
// Ocupaba el 52 % inferior de la pantalla, tapaba métodos de pago y el
// botón Cobrar, sacaba un menú nativo "Cortar / Copiar / Seleccionar
// todo" sobre el ticket, y encima abría el teclado de símbolos
// (`- + . * / , ( ) =`), no un pad de caja. Es del sistema operativo:
// la APK no lo arregla. El arreglo es este pad, con el campo en
// sólo-lectura (ver `AmountField`) para que el IME no aparezca jamás.
//
// La referencia visual y de comportamiento es el keypad del PIN
// (`pages/PinScreen.tsx`): mismo grid de 3 columnas, mismos radios,
// mismos fondos. No es un teclado nuevo, es el mismo teclado.
//
// El pad NO tiene estado: el importe lo posee el formulario. Aquí sólo
// se aplican las reglas de escritura.

import { Delete } from "lucide-react";

export function CashPad({
  value,
  onChange,
  maxDecimals = 2,
  disabled = false,
  className = "",
}: {
  value: string;
  onChange: (next: string) => void;
  // 2 = importe en euros con coma decimal. 0 = conteo entero (las
  // denominaciones del arqueo son unidades, no euros: la tecla de la
  // coma ni se pinta).
  maxDecimals?: number;
  disabled?: boolean;
  className?: string;
}) {
  const withComma = maxDecimals > 0;

  function press(key: string): void {
    if (disabled) return;
    onChange(applyKey(value, key, maxDecimals));
  }

  const keyClass =
    "h-touch-pad rounded-2xl bg-mipiace-stone hover:bg-slate-100 active:bg-slate-200 text-[22px] font-medium text-mipiace-ink tabular-nums disabled:opacity-40 select-none";

  return (
    <div className={"w-full " + className} data-testid="cash-pad">
      <div className="grid grid-cols-3 gap-2">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((n) => (
          <button
            key={n}
            type="button"
            disabled={disabled}
            onClick={() => press(n)}
            className={keyClass}
          >
            {n}
          </button>
        ))}
        <button
          type="button"
          disabled={disabled}
          onClick={() => press("00")}
          className={keyClass}
        >
          00
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => press("0")}
          // Sin coma, el 0 se queda con el hueco de la coma: una tecla
          // muerta bajo el pulgar es peor que una tecla grande.
          className={keyClass + (withComma ? "" : " col-span-2")}
        >
          0
        </button>
        {withComma && (
          <button
            type="button"
            disabled={disabled}
            onClick={() => press(",")}
            aria-label="Coma decimal"
            className={keyClass}
          >
            ,
          </button>
        )}
      </div>
      {/* Borrar y limpiar en su propia fila: son las dos teclas que se
          pulsan con prisa y sin mirar. */}
      <div className="grid grid-cols-2 gap-2 mt-2">
        <button
          type="button"
          disabled={disabled}
          onClick={() => press("C")}
          aria-label="Limpiar importe"
          className="h-touch-pad rounded-2xl bg-mipiace-stone hover:bg-slate-100 active:bg-slate-200 text-[15px] font-medium text-slate-500 disabled:opacity-40 select-none"
        >
          C
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => press("back")}
          aria-label="Borrar último dígito"
          className="h-touch-pad rounded-2xl bg-mipiace-stone hover:bg-slate-100 active:bg-slate-200 flex items-center justify-center text-slate-500 disabled:opacity-40 select-none"
        >
          <Delete className="w-5 h-5" strokeWidth={2.25} />
        </button>
      </div>
    </div>
  );
}

// Reglas de escritura del pad. Exportada aparte porque es lo que se
// prueba: el componente sólo la llama.
//
// Convenios:
//   - Se teclea en euros con COMA decimal, nunca punto.
//   - `maxDecimals` decimales como máximo; los siguientes se ignoran
//     (no redondean: el cajero ve exactamente lo que ha metido).
//   - Campo vacío ≠ "0,00". Vacío significa "no introducido" y el
//     formulario mantiene bloqueado su botón de acción.
export function applyKey(value: string, key: string, maxDecimals = 2): string {
  const v = value ?? "";

  if (key === "C") return "";
  if (key === "back") return v.slice(0, -1);

  if (key === ",") {
    if (maxDecimals <= 0) return v; // conteos enteros: no hay coma
    if (v.includes(",")) return v; // sólo una coma
    // Coma sobre campo vacío: "0," se lee mejor que "," y `parseAmount`
    // entiende las dos.
    return v === "" ? "0," : v + ",";
  }

  if (key !== "00" && !/^[0-9]$/.test(key)) return v;

  // `00` sobre campo vacío no antepone ceros: se queda vacío.
  if (key === "00" && v === "") return "";

  const commaAt = v.indexOf(",");
  if (commaAt >= 0) {
    const decimals = v.length - commaAt - 1;
    const room = maxDecimals - decimals;
    if (room <= 0) return v; // el tercer decimal se ignora
    // "00" con hueco para un solo decimal mete un cero, no dos.
    const digits = key === "00" ? "00".slice(0, room) : key;
    return v + digits;
  }

  // Parte entera: sin ceros a la izquierda ("0" + "5" = "5", no "05").
  const next = v === "0" ? key : v + key;
  return stripLeadingZeros(next);
}

function stripLeadingZeros(s: string): string {
  const trimmed = s.replace(/^0+(?=\d)/, "");
  return trimmed === "" ? "0" : trimmed;
}
