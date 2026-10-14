// kds-1-cocina · sección «Cocina» del detalle de tienda.
//
// Los cuatro ajustes de la decisión 3, por RESTAURANTE:
//
//   · los dos umbrales del semáforo;
//   · el modo de órdenes de salida («Todo a la vez + Espera» o «Por tiempos»);
//   · cuándo se ve el botón de silla en la línea;
//   · el pitido del «Listo», apagado de serie.
//
// ── POR QUÉ ESTÁN EN LA TIENDA Y NO EN AJUSTES ────────────────────────
//
// Regla de alcance de Matías, 08-10: «lo que cambia de un local a otro es
// configuración por restaurante, no otro desarrollo». Una cadena con un
// bar y un restaurante a la carta necesita los dos modos de órdenes A LA
// VEZ, y eso no cabe en una columna del tenant.
//
// Y debajo, las pantallas emparejadas con su latido. Es lo que el
// propietario mira cuando el cocinero dice «no me llega nada»: si la
// pantalla no da señales, el TPV ya le está sacando el papel por la
// impresora del terminal, y lo que hay que arreglar es la wifi.

import { useEffect, useState } from "react";

import { api, ApiError, readEffectiveAuth, type AdminRole } from "../api.js";
import { FieldError, formatRelative, PrimaryButton, SuccessBanner } from "../ui.js";

interface AjustesCocina {
  greenMaxMin: number;
  amberMaxMin: number;
  courseMode: "ESPERA" | "TIEMPOS";
  seatMode: "ALERGIA" | "SIEMPRE";
  readyBeep: boolean;
}

interface Pantalla {
  id: string;
  name: string | null;
  sections: Array<"BARRA" | "COCINA" | "SALON">;
  pairedAt: string;
  lastSeenAt: string | null;
  alive: boolean;
  storeId: string;
  registerName: string;
}

const ETIQUETA_SECCION: Record<string, string> = {
  BARRA: "Barra",
  COCINA: "Cocina",
  SALON: "Sala",
};

export function KitchenSection({
  storeId,
  role,
}: {
  storeId: string;
  role: AdminRole | null;
}) {
  const [ajustes, setAjustes] = useState<AjustesCocina | null>(null);
  const [form, setForm] = useState<AjustesCocina | null>(null);
  const [moduloEncendido, setModuloEncendido] = useState(false);
  const [pantallas, setPantallas] = useState<Pantalla[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const canEdit =
    (role === "OWNER" || role === "MANAGER") && readEffectiveAuth().canEdit;

  useEffect(() => {
    let cancelado = false;
    api<{ moduleEnabled: boolean; settings: AjustesCocina }>(
      `/admin/stores/${storeId}/kitchen`,
    )
      .then((res) => {
        if (cancelado) return;
        setModuloEncendido(res.moduleEnabled);
        setAjustes(res.settings);
        setForm(res.settings);
      })
      .catch((err) => {
        if (err instanceof ApiError) setError(err.message);
      });
    api<{ screens: Pantalla[] }>("/admin/kitchen/screens")
      .then((res) => {
        if (!cancelado) {
          setPantallas(res.screens.filter((p) => p.storeId === storeId));
        }
      })
      .catch(() => {
        // Sin pantallas o sin permiso: la lista no aparece. No se inventa
        // un «0 pantallas» que podría ser mentira.
      });
    return () => {
      cancelado = true;
    };
  }, [storeId]);

  async function onSave() {
    if (!form) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await api<{ settings: AjustesCocina }>(
        `/admin/stores/${storeId}/kitchen`,
        { method: "PUT", body: form },
      );
      setAjustes(res.settings);
      setForm(res.settings);
      setSuccess("Ajustes de cocina guardados.");
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
      else setError("Error inesperado");
    } finally {
      setBusy(false);
    }
  }

  if (!form || !ajustes) return null;
  // Con el módulo apagado la sección NO se pinta. No es esconder un
  // error: es que los umbrales de un semáforo que no existe no significan
  // nada, y ofrecerlos haría creer que la pantalla está comprada.
  if (!moduloEncendido) return null;

  const dirty = JSON.stringify(form) !== JSON.stringify(ajustes);
  const semaforoMal = form.amberMaxMin <= form.greenMaxMin;

  return (
    <section
      data-testid="cocina-ajustes"
      className="bg-white rounded-2xl border border-slate-200 p-6 md:p-7 mb-5"
    >
      <div className="mb-4">
        <h2 className="text-[17px] font-semibold text-mipiace-ink tracking-tight">
          Cocina
        </h2>
        <p className="text-[13px] text-slate-500 mt-1">
          Cómo se comporta la pantalla de comandas de este restaurante.
          {!canEdit && " Sólo el propietario o el encargado pueden editarlo."}
        </p>
      </div>

      {success && <SuccessBanner message={success} />}
      <FieldError message={error} />

      {/* ── El semáforo ──────────────────────────────────────────────── */}
      <h3 className="text-[14px] font-semibold text-mipiace-ink mt-1 mb-1">
        Semáforo de tiempos
      </h3>
      <p className="text-[12.5px] text-slate-500 mb-3">
        La cabecera de la comanda cambia de color según los minutos que lleva
        esperando. Cuenta desde que el plato <strong>marcha</strong> a cocina,
        no desde que se tomó la nota.
      </p>
      <div className="flex flex-wrap gap-4 mb-2">
        <Minutos
          id="verde"
          label="Verde por debajo de"
          valor={form.greenMaxMin}
          disabled={!canEdit}
          onChange={(v) => setForm({ ...form, greenMaxMin: v })}
        />
        <Minutos
          id="ambar"
          label="Ámbar hasta"
          valor={form.amberMaxMin}
          disabled={!canEdit}
          onChange={(v) => setForm({ ...form, amberMaxMin: v })}
        />
        <div className="text-[12.5px] text-slate-500 self-end pb-2">
          Por encima de {form.amberMaxMin} min, rojo.
        </div>
      </div>
      {semaforoMal && (
        <p
          data-testid="cocina-semaforo-mal"
          className="text-[12.5px] text-amber-700 mb-3"
        >
          El ámbar tiene que ser mayor que el verde: con los dos cruzados, el
          cocinero vería tarjetas rojas a los dos minutos y dejaría de mirar el
          color.
        </p>
      )}

      {/* ── Órdenes de salida ───────────────────────────────────────── */}
      <h3 className="text-[14px] font-semibold text-mipiace-ink mt-5 mb-1">
        Órdenes de salida
      </h3>
      <p className="text-[12.5px] text-slate-500 mb-3">
        Las dos formas usan los mismos datos por debajo: cambiar de modo no
        pierde nada.
      </p>
      <Eleccion
        testid="cocina-course-mode"
        valor={form.courseMode}
        disabled={!canEdit}
        onChange={(v) => setForm({ ...form, courseMode: v as "ESPERA" | "TIEMPOS" })}
        opciones={[
          {
            v: "ESPERA",
            t: "Todo a la vez + Espera",
            d: "Un botón «Espera» en la línea. Cero toques más en el caso normal. Es lo de un bar.",
          },
          {
            v: "TIEMPOS",
            t: "Por tiempos",
            d: "Fila 1º · 2º · 3º · Postre que se queda puesta. Dos o tres toques más por mesa. Es lo de un restaurante a la carta.",
          },
        ]}
      />

      {/* ── Plato por silla ─────────────────────────────────────────── */}
      <h3 className="text-[14px] font-semibold text-mipiace-ink mt-5 mb-1">
        Plato por silla
      </h3>
      <Eleccion
        testid="cocina-seat-mode"
        valor={form.seatMode}
        disabled={!canEdit}
        onChange={(v) => setForm({ ...form, seatMode: v as "ALERGIA" | "SIEMPRE" })}
        opciones={[
          {
            v: "ALERGIA",
            t: "Sólo cuando hay alergia",
            d: "El botón «→ Silla n» aparece en la línea si la mesa tiene una alergia declarada.",
          },
          {
            v: "SIEMPRE",
            t: "Siempre visible",
            d: "Cocina y camarero saben de quién es cada plato. Mañana sirve además para partir la cuenta por silla.",
          },
        ]}
      />

      {/* ── El pitido ───────────────────────────────────────────────── */}
      <h3 className="text-[14px] font-semibold text-mipiace-ink mt-5 mb-1">
        Aviso de «Listo»
      </h3>
      <label
        className={
          "flex items-start gap-3 p-3 rounded-xl bg-mipiace-stone border border-transparent " +
          (canEdit ? "cursor-pointer hover:bg-slate-100" : "opacity-60 cursor-not-allowed")
        }
      >
        <input
          type="checkbox"
          data-testid="cocina-beep"
          checked={form.readyBeep}
          disabled={!canEdit}
          onChange={(e) => setForm({ ...form, readyBeep: e.target.checked })}
          className="mt-0.5 h-4 w-4 rounded border-slate-300 text-mipiace-coral focus:ring-mipiace-coral"
        />
        <div className="flex-1 min-w-0">
          <div className="text-[13.5px] font-medium text-mipiace-ink">
            Pitar en los TPV cuando una comanda esté lista
          </div>
          <div className="text-[12px] text-slate-500 mt-0.5">
            Apagado de serie. La banda «M4 · listo para servir» y la etiqueta
            verde de la mesa avisan igual, sin ruido. En la pantalla de cocina
            no hay sonido en ningún caso.
          </div>
        </div>
      </label>

      {canEdit && (
        <div className="mt-5 flex items-center gap-3">
          <PrimaryButton
            type="button"
            onClick={onSave}
            busy={busy}
            disabled={!dirty || semaforoMal}
          >
            Guardar
          </PrimaryButton>
          {dirty && !semaforoMal && (
            <span className="text-[12.5px] text-slate-500">Sin guardar</span>
          )}
        </div>
      )}

      {/* ── Las pantallas y su latido ───────────────────────────────── */}
      <div className="mt-6 pt-5 border-t border-slate-200">
        <h3 className="text-[15px] font-semibold text-mipiace-ink tracking-tight">
          Pantallas de esta tienda ({pantallas.length})
        </h3>
        {pantallas.length === 0 ? (
          <p className="text-[12.5px] text-slate-500 mt-1">
            Ninguna emparejada todavía. Se empareja desde{" "}
            <a
              className="text-mipiace-coral-dark font-medium hover:underline"
              href="/admin/devices"
            >
              Dispositivos
            </a>
            , eligiendo «Pantalla de cocina».
          </p>
        ) : (
          <ul className="divide-y divide-slate-100 mt-2">
            {pantallas.map((p) => (
              <li
                key={p.id}
                data-testid="cocina-pantalla"
                data-viva={p.alive ? "1" : "0"}
                className="py-2.5 flex items-center gap-3 text-[13px]"
              >
                <span
                  className="h-2.5 w-2.5 rounded-full shrink-0"
                  style={{ background: p.alive ? "#059669" : "#B91C1C" }}
                />
                <span className="font-medium text-mipiace-ink shrink-0">
                  {p.name ?? "Pantalla sin nombre"}
                </span>
                <span className="text-slate-500 shrink-0">
                  {p.sections.map((x) => ETIQUETA_SECCION[x] ?? x).join(" + ")}
                </span>
                <span className="flex-1 min-w-0" />
                <span
                  className={
                    p.alive
                      ? "text-emerald-700 shrink-0"
                      : "text-red-700 shrink-0 font-medium"
                  }
                >
                  {p.alive
                    ? "recibiendo"
                    : p.lastSeenAt
                      ? `sin señal desde ${formatRelative(p.lastSeenAt)}`
                      : "nunca ha dado señal"}
                </span>
              </li>
            ))}
          </ul>
        )}
        {pantallas.some((p) => !p.alive) && (
          <p className="text-[12.5px] text-slate-500 mt-2">
            Una pantalla sin señal no pierde comandas: se le quedan guardadas y
            le llegan marcadas «llegó tarde» cuando vuelva. Mientras tanto, el
            TPV saca la comanda en papel por la impresora del terminal.
          </p>
        )}
      </div>
    </section>
  );
}

function Minutos({
  id,
  label,
  valor,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  valor: number;
  disabled?: boolean;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <label
        htmlFor={`cocina-${id}`}
        className="block text-[13px] font-medium text-mipiace-ink-soft mb-1.5"
      >
        {label}
      </label>
      <div className="flex items-center gap-2">
        <input
          id={`cocina-${id}`}
          data-testid={`cocina-${id}`}
          type="number"
          min={1}
          max={240}
          value={valor}
          disabled={disabled}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-24 h-11 px-3 rounded-xl bg-mipiace-stone border border-transparent text-[14.5px] tabular-nums text-mipiace-ink focus:bg-white focus:border-mipiace-coral/30 focus:ring-2 focus:ring-mipiace-coral/30 focus:outline-none disabled:opacity-60"
        />
        <span className="text-[13px] text-slate-500">min</span>
      </div>
    </div>
  );
}

function Eleccion({
  testid,
  valor,
  opciones,
  disabled,
  onChange,
}: {
  testid: string;
  valor: string;
  opciones: Array<{ v: string; t: string; d: string }>;
  disabled?: boolean;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-2" data-testid={testid}>
      {opciones.map((o) => (
        <label
          key={o.v}
          data-opcion={o.v}
          data-elegida={valor === o.v ? "1" : "0"}
          className={
            "flex items-start gap-3 p-3 rounded-xl border " +
            (valor === o.v
              ? "bg-mipiace-coral-soft border-mipiace-coral/40"
              : "bg-mipiace-stone border-transparent") +
            (disabled ? " opacity-60 cursor-not-allowed" : " cursor-pointer")
          }
        >
          <input
            type="radio"
            name={testid}
            checked={valor === o.v}
            disabled={disabled}
            onChange={() => onChange(o.v)}
            className="mt-0.5 h-4 w-4 border-slate-300 text-mipiace-coral focus:ring-mipiace-coral"
          />
          <div className="flex-1 min-w-0">
            <div className="text-[13.5px] font-medium text-mipiace-ink">{o.t}</div>
            <div className="text-[12px] text-slate-500 mt-0.5">{o.d}</div>
          </div>
        </label>
      ))}
    </div>
  );
}
