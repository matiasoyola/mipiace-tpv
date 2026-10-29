// pin-1 · LA PANTALLA DEL PIN, EN EL TPV. UNA, PARA LOS DOS CASOS.
//
//   · **modo "cambiar"** — lo abre quien quiere cambiar su PIN desde el
//     cajón del TPV («Cambiar mi PIN»). Pide el actual, el nuevo y que lo
//     repita, y llama a `/auth/me/pin` con la sesión de cajero. Es el
//     mismo endpoint que usa el panel: un solo sitio donde está escrito
//     el filtro de triviales, el contador de intentos y el registro.
//
//   · **modo "elegir"** — lo abre el LOGIN cuando el PIN era provisional.
//     No pide el actual (acaba de teclearlo y no es suyo): pide el nuevo
//     y que lo repita, y llama a `/shift/cashier-pin` con el token que
//     emitió el login. Al salir, quien abrió la pantalla reintenta el
//     login con el PIN nuevo.
//
// Una sola pantalla y no dos a propósito (decisión «mínimos clics»): lo
// que cambia entre los dos casos es UN campo y la ruta. Dos componentes
// habrían sido dos sitios donde escribir el teclado, el ojo de ver el
// PIN, el aviso de «no coinciden» y los mensajes del servidor.
//
// El teclado numérico es el mismo gesto que el del login: en el TPV se
// teclea con el dedo y la tecla de la casa mide 56 px.

import { useState } from "react";
import { AlertCircle, Delete, Eye, EyeOff, Loader2 } from "lucide-react";

import { apiWithCashier, apiWithDevice, ApiError } from "../api.js";

export type ModoPin =
  | { modo: "cambiar" }
  | { modo: "elegir"; pendingPinChangeToken: string };

const LARGO_MINIMO = 4;
const LARGO_MAXIMO = 8;

/** Qué campo está recibiendo las teclas. */
type Campo = "actual" | "nuevo" | "repetido";

export function CambiarPinSheet({
  contexto,
  nombre,
  onHecho,
  onCancelar,
}: {
  contexto: ModoPin;
  /** Cómo se llama quien está delante, para que la pantalla lo salude. */
  nombre: string;
  /** El PIN ya está guardado. En modo "elegir" llega el PIN nuevo, que es
   *  lo que el llamante necesita para reintentar el login sin pedirlo
   *  otra vez. */
  onHecho: (pinNuevo: string) => void;
  /** `null` cuando no hay salida: en modo "elegir" la pantalla ES la
   *  puerta — se puede volver al login, pero no entrar sin elegir. */
  onCancelar: () => void;
}) {
  const esElegir = contexto.modo === "elegir";
  const [campo, setCampo] = useState<Campo>(esElegir ? "nuevo" : "actual");
  const [actual, setActual] = useState("");
  const [nuevo, setNuevo] = useState("");
  const [repetido, setRepetido] = useState("");
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const valorDe = (c: Campo) =>
    c === "actual" ? actual : c === "nuevo" ? nuevo : repetido;
  const ponerEn = (c: Campo, v: string) => {
    if (c === "actual") setActual(v);
    else if (c === "nuevo") setNuevo(v);
    else setRepetido(v);
  };

  // n1-vertical · ACTUALIZACIÓN FUNCIONAL, igual que en `PinScreen`: dos
  // pulsaciones dentro del mismo tick leen el mismo valor del cierre y la
  // segunda pisa a la primera. En un teclado de PIN se teclea rápido.
  // El tope de 8 se mira DENTRO del actualizador por lo mismo.
  function pulsar(d: string) {
    if (busy) return;
    setError(null);
    ponerEn(
      campo,
      valorDe(campo).length >= LARGO_MAXIMO ? valorDe(campo) : valorDe(campo) + d,
    );
  }
  function borrarUno() {
    if (busy) return;
    ponerEn(campo, valorDe(campo).slice(0, -1));
  }

  const noCoinciden = repetido.length > 0 && nuevo !== repetido;
  const puedeGuardar =
    !busy &&
    nuevo.length >= LARGO_MINIMO &&
    nuevo === repetido &&
    (esElegir || actual.length >= LARGO_MINIMO);

  async function guardar() {
    if (!puedeGuardar) return;
    setBusy(true);
    setError(null);
    try {
      if (contexto.modo === "elegir") {
        // Con el device token, no con una sesión: todavía no hay sesión.
        await apiWithDevice("/shift/cashier-pin", {
          method: "POST",
          body: {
            pendingPinChangeToken: contexto.pendingPinChangeToken,
            newPin: nuevo,
          },
        });
      } else {
        await apiWithCashier("/auth/me/pin", {
          method: "POST",
          body: { currentPin: actual, newPin: nuevo },
        });
      }
      onHecho(nuevo);
    } catch (err) {
      // El mensaje del servidor es el que dice POR QUÉ: el PIN actual no
      // es correcto y cuántos intentos quedan, o por qué el elegido es
      // demasiado fácil. No se reescribe aquí — sería decirlo peor y en
      // otro sitio.
      setError(err instanceof ApiError ? err.message : "Error inesperado");
      // Lo que se borra es el PIN que falló, no lo que ya estaba bien.
      if (contexto.modo === "cambiar") {
        setActual("");
        setCampo("actual");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      data-testid="cambiar-pin"
      className="fixed inset-0 z-[80] bg-mipiace-stone flex flex-col font-sans overflow-y-auto"
    >
      {/* `items-start` por debajo de `md`, y no `items-center`: con la
          tarjeta más alta que la ventana —el N1 en vertical mide 648 y
          la tarjeta 857— centrar la desborda por ARRIBA y el título
          queda fuera de alcance. Centrada sólo donde cabe. */}
      <div className="flex-1 flex items-start md:items-center justify-center p-5 md:p-5">
        {/* pin-1 · EN UN TERMINAL DE MOSTRADOR, EL TECLADO VA AL LADO.
            Medido a 1280×800 con el banco visual: en una columna, el
            modo «cambiar» —que tiene TRES campos— dejaba «Guardar mi
            PIN» cortado por abajo y «Cancelar» bajo el pliegue. Y el
            pliegue en esta pantalla es caro: quien la está mirando
            acaba de teclear dos veces cuatro cifras y lo único que le
            queda es pulsar.
            De `md` hacia arriba, dos columnas —campos a la izquierda,
            teclado a la derecha— y la altura baja de ~880 px a ~520.
            Por debajo sigue siendo una columna: en la mano se baja con
            el pulgar y el teclado tiene que estar debajo de lo que se
            rellena, no al lado. */}
        <div className="w-full max-w-md md:max-w-2xl bg-white rounded-3xl border border-slate-200 p-5 sm:p-6 md:p-7 grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_auto] md:gap-x-7 md:items-start">
          <div className="min-w-0 md:col-start-1 md:row-start-1">
          {/* El ojo va en la CABECERA y no en una fila propia: es del
              formulario entero, no de un campo. Y su fila suelta eran 44
              px que en el N1 (360×648) empujaban la última fila del
              teclado fuera de la pantalla. */}
          <div className="flex items-start justify-between gap-3">
            <h1 className="text-[20px] font-semibold text-mipiace-ink tracking-tight">
              {esElegir ? `Hola ${nombre}, elige tu PIN` : "Cambiar mi PIN"}
            </h1>
            <button
              type="button"
              onClick={() => setVisible((v) => !v)}
              aria-label={visible ? "Ocultar PIN" : "Mostrar PIN"}
              aria-pressed={visible}
              className="shrink-0 inline-flex min-h-11 items-center gap-2 px-2 -mr-2 text-[13px] text-slate-500"
            >
              {visible ? (
                <EyeOff className="w-[18px] h-[18px]" />
              ) : (
                <Eye className="w-[18px] h-[18px]" />
              )}
              <span className="hidden sm:inline">
                {visible ? "Ocultar" : "Ver lo que tecleo"}
              </span>
            </button>
          </div>
          {/* EL TEXTO LARGO, SÓLO DONDE CABE.
              En el N1 (360×648) la explicación del modo «elegir» son
              CUATRO líneas —104 px— y es lo que empujaba el teclado
              fuera de la pantalla. Lo que no se puede perder en compacto
              es el dato (4 a 8 cifras); el porqué se queda para las
              pantallas de mostrador, que es donde hay sitio para
              leerlo. No es esconder la explicación: el título ya dice
              «elige tu PIN», y el PIN prestado se lo acaba de dar su
              encargada en persona. */}
          <p className="text-[13px] text-slate-500 mt-1 mb-4 sm:mb-5">
            <span className="hidden sm:inline">
              {esElegir
                ? "El PIN con el que acabas de entrar te lo pusieron y sólo valía para esto. Elige el tuyo: de 4 a 8 cifras, las que quieras. Es el que usarás a partir de ahora."
                : "De 4 a 8 cifras, las que tú quieras. El anterior deja de funcionar al guardar."}
            </span>
            <span className="sm:hidden">
              {esElegir
                ? "De 4 a 8 cifras, las que quieras. Es el que usarás a partir de ahora."
                : "De 4 a 8 cifras. El anterior deja de funcionar al guardar."}
            </span>
          </p>

          <div className="space-y-2 sm:space-y-2.5 mb-3 sm:mb-5">
            {!esElegir && (
              <CampoPin
                etiqueta="PIN actual"
                valor={actual}
                activo={campo === "actual"}
                visible={visible}
                onFoco={() => setCampo("actual")}
              />
            )}
            <CampoPin
              etiqueta="PIN nuevo"
              valor={nuevo}
              activo={campo === "nuevo"}
              visible={visible}
              onFoco={() => setCampo("nuevo")}
            />
            <CampoPin
              etiqueta="Repite el PIN nuevo"
              valor={repetido}
              activo={campo === "repetido"}
              visible={visible}
              onFoco={() => setCampo("repetido")}
            />
          </div>

          {/* El aviso de «no coinciden» va pegado a los campos y no debajo
              del botón: es donde está mirando quien acaba de teclear.
              Misma razón que el aviso de PIN incorrecto de `PinScreen`. */}
          {noCoinciden && (
            <div
              data-testid="pin-no-coinciden"
              className="mb-4 flex items-start gap-2 text-[13px] text-slate-600 bg-slate-50 rounded-xl px-3.5 py-2.5"
            >
              <AlertCircle className="w-4 h-4 mt-px shrink-0 text-amber-500" />
              <span>Los dos PIN nuevos no son iguales.</span>
            </div>
          )}
          {error && (
            <div
              data-testid="pin-error"
              className="mb-4 flex items-start gap-2 text-[13px] text-red-700 bg-red-50 rounded-xl px-3.5 py-2.5"
            >
              <AlertCircle className="w-4 h-4 mt-px shrink-0" />
              <span>{error}</span>
            </div>
          )}
          </div>

          <div className="grid grid-cols-3 gap-2 sm:gap-2.5 max-w-xs mx-auto w-full mb-3 sm:mb-5 md:mb-0 md:col-start-2 md:row-start-1 md:row-span-2 md:w-auto md:mx-0">
            {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => pulsar(n)}
                disabled={busy}
                className="h-12 sm:h-14 bg-mipiace-stone hover:bg-slate-100 rounded-2xl text-[22px] font-medium text-mipiace-ink tabular-nums disabled:opacity-50"
              >
                {n}
              </button>
            ))}
            <button
              type="button"
              onClick={() => ponerEn(campo, "")}
              className="h-12 sm:h-14 rounded-2xl text-[14px] text-slate-400 hover:text-mipiace-ink font-medium"
            >
              Borrar
            </button>
            <button
              type="button"
              onClick={() => pulsar("0")}
              disabled={busy}
              className="h-12 sm:h-14 bg-mipiace-stone hover:bg-slate-100 rounded-2xl text-[22px] font-medium text-mipiace-ink tabular-nums disabled:opacity-50"
            >
              0
            </button>
            <button
              type="button"
              onClick={borrarUno}
              aria-label="Borrar último dígito"
              className="h-12 sm:h-14 bg-mipiace-stone hover:bg-slate-100 rounded-2xl flex items-center justify-center text-slate-500"
            >
              <Delete className="w-5 h-5" strokeWidth={2.25} />
            </button>
          </div>

          {/* EN LA MANO, «GUARDAR» NO SE VA BAJO EL PLIEGUE.
              Medido en el banco a 360×648: la tarjeta mide 857 px, así
              que el botón caía a 790 y había que bajar para pulsarlo
              después de teclear ocho cifras. `sticky bottom-0` lo deja
              siempre a la vista mientras el resto se desplaza; de `md`
              hacia arriba no hace falta, porque entra entera. */}
          <div className="md:col-start-1 md:row-start-2 md:self-end sticky bottom-0 md:static bg-white pt-2 -mx-5 px-5 sm:-mx-6 sm:px-6 md:mx-0 md:px-0 md:pt-0 md:bg-transparent border-t border-slate-100 md:border-0">
          <button
            type="button"
            data-testid="pin-guardar"
            onClick={guardar}
            disabled={!puedeGuardar}
            className="w-full h-14 bg-mipiace-coral hover:bg-mipiace-coral-dark text-white font-medium text-[15px] rounded-2xl disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {busy && <Loader2 className="w-4 h-4 animate-spin" />}
            Guardar mi PIN
          </button>
          {/* La salida. En modo «elegir» NO entra en el TPV: vuelve al
              login, que es de donde venía. Un PIN provisional no abre la
              caja, y esconder este botón no cambiaría eso — lo único que
              haría es atrapar a quien se ha equivocado de persona. */}
          <button
            type="button"
            data-testid="pin-cancelar"
            onClick={onCancelar}
            className="mt-3 w-full inline-flex min-h-11 items-center justify-center text-[13px] text-slate-500"
          >
            {esElegir ? "Volver al inicio de sesión" : "Cancelar"}
          </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function CampoPin({
  etiqueta,
  valor,
  activo,
  visible,
  onFoco,
}: {
  etiqueta: string;
  valor: string;
  activo: boolean;
  visible: boolean;
  onFoco: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onFoco}
      // `block` y ancho completo: dos `<button>` seguidos son inline y
      // saldrían en la misma línea.
      className={
        activo
          ? "block w-full text-left px-4 py-2 sm:py-3 rounded-2xl bg-white border-2 border-mipiace-coral"
          : "block w-full text-left px-4 py-2 sm:py-3 rounded-2xl bg-mipiace-stone border-2 border-transparent"
      }
    >
      <div className="text-[12px] text-slate-500">{etiqueta}</div>
      <div className="text-[20px] font-semibold tracking-[0.3em] tabular-nums text-mipiace-ink min-h-[26px] sm:min-h-[28px]">
        {valor.length === 0
          ? " "
          : visible
            ? valor
            : "•".repeat(valor.length)}
      </div>
    </button>
  );
}
