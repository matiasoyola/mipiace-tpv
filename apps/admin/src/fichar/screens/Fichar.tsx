// F1 · la pantalla de fichar: una pantalla y un botón (ADR-018).
//
// Fuera: "Entrar". Dentro: "Salir", desde qué hora, y un contador vivo
// (Holded pone 00h00m mientras el tramo está en curso; aquí se ve correr).
//
// El toque NO espera a la red. Se persiste en la cola local y la pantalla
// lo da por hecho — si el empleado mata la app en ese instante, el fichaje
// sobrevive y se envía al arrancar. Cuatro segundos de "Deshacer" para el
// toque sin querer; pasados, un cambio ya es una corrección.

import { useEffect, useRef, useState } from "react";
import { CloudOff, Undo2 } from "lucide-react";

import {
  flushOutbox,
  outboxAdd,
  outboxList,
  outboxUndo,
  subscribeOutbox,
  type FicharOutboxItem,
} from "../lib/outbox.js";
import { horaLocal, transcurrido } from "../lib/format.js";
import { MisFichajes } from "./MisFichajes.js";
import { CorregirSheet } from "./CorregirSheet.js";
import type { EntryView, MeResponse } from "../lib/tipos.js";

function nuevoId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `f-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function Fichar({
  me,
  onRecargar,
}: {
  me: MeResponse;
  onRecargar: () => void;
}) {
  const [ahora, setAhora] = useState(() => Date.now());
  const [pendientes, setPendientes] = useState<FicharOutboxItem[]>([]);
  const [corrigiendo, setCorrigiendo] = useState<EntryView | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  // Lo que el empleado acaba de tocar y todavía puede deshacer.
  const [porDeshacer, setPorDeshacer] = useState<FicharOutboxItem | null>(null);
  const recargar = useRef(onRecargar);
  recargar.current = onRecargar;

  // El contador vivo. Un tick por segundo mientras esté dentro; si no, no
  // hay nada que contar y no se gasta batería.
  useEffect(() => {
    if (!me.openEntry && pendientes.length === 0) return;
    const t = window.setInterval(() => setAhora(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [me.openEntry, pendientes.length]);

  useEffect(() => {
    let vivo = true;
    const refrescar = () => {
      void outboxList().then((items) => vivo && setPendientes(items));
    };
    refrescar();
    const off = subscribeOutbox((e) => {
      refrescar();
      if (e.type === "sent") recargar.current();
      if (e.type === "failed") {
        setAviso("Ese fichaje no ha podido entrar. Mira abajo, en tus fichajes.");
        recargar.current();
      }
    });
    return () => {
      vivo = false;
      off();
    };
  }, []);

  // El banner de deshacer se retira solo al vencer el plazo.
  useEffect(() => {
    if (!porDeshacer) return;
    const restante = porDeshacer.holdUntil - Date.now();
    if (restante <= 0) {
      setPorDeshacer(null);
      void flushOutbox();
      return;
    }
    const t = window.setTimeout(() => {
      setPorDeshacer(null);
      void flushOutbox();
    }, restante);
    return () => window.clearTimeout(t);
  }, [porDeshacer]);

  // Lo que la pantalla enseña es el estado OPTIMISTA: la cola local manda
  // sobre lo que diga el servidor, porque el toque ya está dado.
  const entradaPendiente = pendientes.find((p) => p.kind === "in") ?? null;
  const salidaPendiente = pendientes.find((p) => p.kind === "out") ?? null;
  const dentro = salidaPendiente
    ? false
    : entradaPendiente !== null || me.openEntry !== null;
  const desdeIso = entradaPendiente
    ? new Date(entradaPendiente.tappedAt).toISOString()
    : (me.openEntry?.startedAt ?? null);

  async function tocar() {
    setAviso(null);
    const tappedAt = Date.now();
    const externalId = nuevoId();
    const item = dentro
      ? await outboxAdd({
          externalId,
          kind: "out",
          path: `/fichaje/v1/entries/${me.openEntry?.id ?? ""}/close`,
          body: { externalId, deviceAt: new Date(tappedAt).toISOString() },
          tappedAt,
        })
      : await outboxAdd({
          externalId,
          kind: "in",
          path: "/fichaje/v1/entries",
          body: { externalId, deviceAt: new Date(tappedAt).toISOString() },
          tappedAt,
        });
    setPorDeshacer(item);
  }

  async function deshacer() {
    if (!porDeshacer) return;
    const ok = await outboxUndo(porDeshacer.externalId);
    setPorDeshacer(null);
    if (!ok) {
      // El plazo venció entre el toque y el dedo: ya está en el servidor.
      setAviso("Ya se había enviado. Puedes corregirlo desde tus fichajes.");
      recargar.current();
    }
  }

  const sinRed = typeof navigator !== "undefined" && navigator.onLine === false;
  const hayPendientes = pendientes.length > 0;

  return (
    <div className="mx-auto w-full max-w-md px-5 pb-10 pt-6">
      <header className="mb-8 flex items-baseline justify-between">
        <div>
          <div className="text-[19px] font-semibold tracking-[-0.01em] text-mipiace-ink">
            {me.employee.name}
          </div>
          <div className="text-[13px] text-slate-400">{me.tenant.name}</div>
        </div>
      </header>

      <div className="flex flex-col items-center">
        <button
          type="button"
          onClick={tocar}
          aria-label={dentro ? "Fichar salida" : "Fichar entrada"}
          className={`flex h-tap-fichar w-tap-fichar flex-col items-center justify-center rounded-full text-white shadow-sm transition-transform active:scale-[0.97] ${
            dentro
              ? "bg-mipiace-ink hover:bg-mipiace-ink-soft"
              : "bg-mipiace-coral hover:bg-mipiace-coral-dark"
          }`}
        >
          <span className="text-[34px] font-semibold tracking-[-0.02em]">
            {dentro ? "Salir" : "Entrar"}
          </span>
          {dentro && desdeIso && ahora - new Date(desdeIso).getTime() >= 60_000 && (
            // El contador no aparece hasta el primer minuto. Lo encontró el
            // bucle visual: al tocar "Entrar" se leía "0h 00m" bajo el
            // botón — que es EXACTAMENTE lo que hace Holded y lo que este
            // bloque no quiere hacer. La hora de entrada ya está debajo.
            <span className="mt-1 text-[15px] tabular-nums text-white/80">
              {transcurrido(desdeIso, ahora)}
            </span>
          )}
        </button>

        <p className="mt-5 min-h-[24px] text-center text-[15px] text-slate-500">
          {dentro && desdeIso ? (
            <>
              Dentro desde las{" "}
              <span className="tabular-nums text-mipiace-ink">
                {horaLocal(desdeIso, me.timeZone)}
              </span>
            </>
          ) : (
            "Toca para fichar tu entrada"
          )}
        </p>

        {(hayPendientes || sinRed) && (
          <div className="mt-3 inline-flex items-center gap-1.5 rounded-xl bg-mipiace-stone px-3 py-1.5 text-[12px] text-slate-500">
            <CloudOff className="h-3.5 w-3.5" />
            {hayPendientes ? "Pendiente de enviar" : "Sin conexión"}
          </div>
        )}

        {aviso && (
          <p
            role="status"
            className="mt-3 text-center text-[13.5px] text-mipiace-coral-dark"
          >
            {aviso}
          </p>
        )}
      </div>

      <MisFichajes
        month={me.month}
        timeZone={me.timeZone}
        onTocar={setCorrigiendo}
      />

      {porDeshacer && (
        <BannerDeshacer
          item={porDeshacer}
          timeZone={me.timeZone}
          onDeshacer={deshacer}
        />
      )}

      {corrigiendo && (
        <CorregirSheet
          entry={corrigiendo}
          timeZone={me.timeZone}
          onClose={() => setCorrigiendo(null)}
          onHecho={() => {
            setCorrigiendo(null);
            recargar.current();
          }}
        />
      )}
    </div>
  );
}

/** La confirmación que se lee de un vistazo, con la salida para el toque
 *  sin querer. Cuatro segundos: lo que se tarda en darse cuenta. */
function BannerDeshacer({
  item,
  timeZone,
  onDeshacer,
}: {
  item: FicharOutboxItem;
  timeZone: string;
  onDeshacer: () => void;
}) {
  const hora = horaLocal(new Date(item.tappedAt).toISOString(), timeZone);
  return (
    <div
      role="status"
      className="fixed inset-x-0 bottom-0 z-30 px-4 pb-5"
      style={{ animation: "none" }}
    >
      <div className="mx-auto flex max-w-md items-center gap-3 rounded-2xl bg-mipiace-ink px-4 py-3 text-white shadow-lg">
        <span className="text-[16px] font-medium">
          {item.kind === "in" ? "Entrada" : "Salida"}{" "}
          <span className="tabular-nums">{hora}</span>
        </span>
        <button
          type="button"
          onClick={onDeshacer}
          className="ml-auto inline-flex min-h-touch items-center gap-1.5 rounded-xl px-3 text-[15px] font-medium text-white/90 hover:bg-white/10"
        >
          <Undo2 className="h-4 w-4" />
          Deshacer
        </button>
      </div>
    </div>
  );
}
