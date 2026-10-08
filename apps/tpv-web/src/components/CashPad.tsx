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

import { useEffect, useState } from "react";
import { Delete } from "lucide-react";

export function CashPad({
  value,
  onChange,
  onReplacingChange,
  maxDecimals = 2,
  disabled = false,
  className = "",
}: {
  value: string;
  onChange: (next: string) => void;
  // v1.22 §2 · el pad avisa de si el valor que hay está "para
  // sustituir", para que el campo que lo enseña pueda pintarlo como
  // seleccionado. Opcional: sin cablearlo el comportamiento es el mismo,
  // sólo falta la pista visual.
  onReplacingChange?: (replacing: boolean) => void;
  // 2 = importe en euros con coma decimal. 0 = conteo entero (las
  // denominaciones del arqueo son unidades, no euros: la tecla de la
  // coma ni se pinta).
  maxDecimals?: number;
  disabled?: boolean;
  className?: string;
}) {
  const withComma = maxDecimals > 0;

  // v1.22-el-terminal-del-bar · §2 (hallazgo C2).
  //
  // El pad sigue sin poseer el importe: lo posee el formulario. Lo único
  // que recuerda es el último valor que EMITIÓ él. Si el que le llega es
  // otro, ese valor viene de fuera (se acaba de abrir sobre el resto del
  // mixto, sobre el `0,00` del fondo de apertura, o el formulario ha
  // movido el objetivo a otra fila) y la primera tecla lo sustituye.
  //
  // Es una comparación y no un `pristine` que se arme al montar porque
  // el pad NO se desmonta al cambiar de fila: en el arqueo se pasa de
  // una denominación a otra con el pad abierto, y en el mixto de la
  // tarjeta al efectivo. Con un flag de montaje, la segunda fila no se
  // podría sustituir.
  const [lastEmitted, setLastEmitted] = useState<string | null>(null);
  const replacing = lastEmitted !== value;

  useEffect(() => {
    onReplacingChange?.(replacing);
  }, [replacing, onReplacingChange]);

  function press(key: string): void {
    if (disabled) return;
    const next = applyKey(value, key, maxDecimals, { replace: replacing });
    setLastEmitted(next);
    onChange(next);
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
//
// v1.22-el-terminal-del-bar · §2 · `replace` (hallazgo C2).
//
// Con el importe ya en dos decimales (`6,90` del resto del mixto,
// `0,00` del fondo de apertura) `room` era 0 y el dígito se IGNORABA:
// pulsar 4 sobre 6,90 no hacía nada, y borrando uno se pegaba detrás
// (6,9 + 4 = 6,94). Había que pulsar "C" primero, y la ayuda del campo
// decía «escribe encima si no cuadra».
//
// Con `replace`, la primera pulsación de dígito, de `00` o de la coma
// escribe sobre campo VACÍO en vez de sobre el valor. Las siguientes
// escriben normal: la sustitución dura UNA tecla, no un modo.
// "C" y borrar no la consumen ni la necesitan.
export function applyKey(
  value: string,
  key: string,
  maxDecimals = 2,
  opts: { replace?: boolean } = {},
): string {
  // `00` sobre un pre-relleno deja el campo VACÍO, no "00": el convenio
  // de arriba dice que `00` no antepone ceros sobre campo vacío, y vacío
  // es "no introducido", que es lo honesto cuando el cajero acaba de
  // borrar el importe que había. El botón de la acción se queda
  // bloqueado hasta que teclee algo.
  const v = opts.replace && key !== "C" && key !== "back" ? "" : (value ?? "");

  if (key === "C") return "";
  if (key === "back") return (value ?? "").slice(0, -1);

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
