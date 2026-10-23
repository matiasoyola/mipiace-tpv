// residencia-1 (D-54) · TURNOS DEL CENTRO.
//
// Tres de serie al encender el módulo: mañana 08–15, tarde 15–22 y noche
// 22–08. Esta pantalla los enseña, los deja cambiar y permite añadir uno
// más (una ronda de noche partida, por ejemplo).
//
// ── «Ahora: tarde» ───────────────────────────────────────────────────
//
// Lo pinta arriba y es la forma más barata de que la dirección vea si sus
// horas están bien puestas: un hueco en el cuadrante se nota porque ahí
// sale «ningún turno», y un hueco significa que los registros de esa hora
// se quedarían sin turno. Lo calcula EL SERVIDOR con la misma función que
// usará la puerta, no esta pantalla: dos copias de «¿en qué turno cae este
// instante?» acabarían diciendo cosas distintas el día del cambio de hora.
//
// ── La noche cruza medianoche y se dice ──────────────────────────────
//
// 22:00 → 08:00 no es un error de dedo, así que la pantalla no lo corrige
// ni lo avisa: lo etiqueta («cruza medianoche») para que quien lo lea sepa
// que el sistema lo entiende.

import { useEffect, useState } from "react";
import { Plus, Trash2, X } from "lucide-react";

import { AdminShell } from "../../AdminShell.js";
import { api, ApiError } from "../../api.js";
import {
  CenteredLoader,
  FieldError,
  OutlineButton,
  PrimaryButton,
  TextField,
} from "../../ui.js";
import type { TurnoFila } from "./lib.js";

export function TurnosPage() {
  const [turnos, setTurnos] = useState<TurnoFila[] | null>(null);
  const [ahora, setAhora] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [alta, setAlta] = useState(false);
  const [editando, setEditando] = useState<TurnoFila | null>(null);

  async function recargar() {
    try {
      const r = await api<{ turnos: TurnoFila[]; ahora: string | null }>(
        "/residencia/turnos",
      );
      setTurnos(r.turnos);
      setAhora(r.ahora);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Error inesperado");
    }
  }

  useEffect(() => {
    void recargar();
  }, []);

  async function borrar(t: TurnoFila) {
    try {
      await api(`/residencia/turnos/${t.id}`, { method: "DELETE" });
      void recargar();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Error inesperado");
    }
  }

  if (!turnos) return <CenteredLoader label="Cargando turnos…" error={error} />;

  const deAhora = turnos.find((t) => t.code === ahora) ?? null;

  return (
    <AdminShell title="Turnos">
      <p className="-mt-2 mb-5 text-[13.5px] text-slate-500">
        Los turnos del centro. Todo lo que el personal registre se apunta al
        turno en que ocurre.
      </p>

      {error && <FieldError message={error} />}

      <div className="mb-5 rounded-2xl border border-slate-200 bg-white px-5 py-4">
        <p className="text-[13px] text-slate-500">Ahora</p>
        <p className="text-[20px] font-semibold text-mipiace-ink">
          {deAhora
            ? `${deAhora.name} · ${deAhora.startsAt}–${deAhora.endsAt}`
            : "Ningún turno cubre esta hora"}
        </p>
        {!deAhora && (
          <p className="mt-1 text-[13px] text-amber-700">
            Hay un hueco en el cuadrante: lo que se registre a esta hora se
            quedaría sin turno.
          </p>
        )}
      </div>

      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-[16px] font-semibold text-mipiace-ink">
          Turnos{" "}
          <span className="font-normal tabular-nums text-slate-400">
            {turnos.length}
          </span>
        </h2>
        <PrimaryButton
          type="button"
          onClick={() => setAlta(true)}
          className="!h-10 !w-auto !px-4 !text-[13.5px]"
        >
          <Plus className="h-4 w-4" /> Añadir turno
        </PrimaryButton>
      </div>

      <ul className="space-y-2">
        {turnos.map((t) => (
          <li
            key={t.id}
            className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border border-slate-200 bg-white px-4 py-3"
          >
            <button
              type="button"
              onClick={() => setEditando(t)}
              className="min-h-[44px] min-w-0 flex-1 text-left"
            >
              <span className="block text-[14.5px] font-medium text-mipiace-ink">
                {t.name}
              </span>
              <span className="block text-[12.5px] tabular-nums text-slate-500">
                {t.startsAt}–{t.endsAt}
                {cruzaMedianoche(t) && " · cruza medianoche"}
              </span>
            </button>
            <span className="shrink-0 rounded-lg bg-slate-100 px-2.5 py-1 text-[12.5px] tabular-nums text-slate-600">
              {t.code}
            </span>
            {turnos.length > 1 && (
              <OutlineButton
                onClick={() => void borrar(t)}
                className="!h-10 !px-3"
              >
                <Trash2 className="h-4 w-4" />
              </OutlineButton>
            )}
          </li>
        ))}
      </ul>

      {(alta || editando) && (
        <ModalTurno
          turno={editando}
          onClose={() => {
            setAlta(false);
            setEditando(null);
          }}
          onHecho={() => {
            setAlta(false);
            setEditando(null);
            void recargar();
          }}
        />
      )}
    </AdminShell>
  );
}

function cruzaMedianoche(t: { startsAt: string; endsAt: string }): boolean {
  return t.endsAt <= t.startsAt;
}

function ModalTurno({
  turno,
  onClose,
  onHecho,
}: {
  turno: TurnoFila | null;
  onClose: () => void;
  onHecho: () => void;
}) {
  const [code, setCode] = useState(turno?.code ?? "");
  const [name, setName] = useState(turno?.name ?? "");
  const [startsAt, setStartsAt] = useState(turno?.startsAt ?? "08:00");
  const [endsAt, setEndsAt] = useState(turno?.endsAt ?? "15:00");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function guardar() {
    setBusy(true);
    setError(null);
    try {
      if (turno) {
        await api(`/residencia/turnos/${turno.id}`, {
          method: "PATCH",
          body: { name: name.trim(), startsAt, endsAt },
        });
      } else {
        await api("/residencia/turnos", {
          method: "POST",
          body: { code: code.trim().toUpperCase(), name: name.trim(), startsAt, endsAt },
        });
      }
      onHecho();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Error inesperado");
    } finally {
      setBusy(false);
    }
  }

  const igual = startsAt === endsAt;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/30 px-3 py-8">
      <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-6">
        <div className="mb-4 flex items-start justify-between gap-3">
          <h3 className="text-[16px] font-semibold text-mipiace-ink">
            {turno ? turno.name : "Añadir turno"}
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="flex h-11 w-11 items-center justify-center rounded-xl text-slate-400 hover:bg-slate-50"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {!turno && (
          <TextField
            id="turno-code"
            label="Código corto (M, T, N…)"
            value={code}
            onChange={setCode}
          />
        )}
        <TextField id="turno-name" label="Nombre" value={name} onChange={setName} />
        <TextField
          id="turno-inicio"
          label="Empieza"
          type="time"
          value={startsAt}
          onChange={setStartsAt}
        />
        <TextField
          id="turno-fin"
          label="Acaba"
          type="time"
          value={endsAt}
          onChange={setEndsAt}
        />

        {cruzaMedianoche({ startsAt, endsAt }) && !igual && (
          <p className="mb-3 text-[13px] text-slate-500">
            Este turno cruza la medianoche. Es correcto: así es el de noche.
          </p>
        )}
        {igual && (
          <p className="mb-3 text-[13px] text-amber-700">
            La hora de inicio y la de fin no pueden ser la misma.
          </p>
        )}
        <FieldError message={error} />
        <div className="mt-4">
          <PrimaryButton
            type="button"
            busy={busy}
            disabled={igual || !name.trim() || (!turno && !code.trim())}
            onClick={() => void guardar()}
          >
            Guardar
          </PrimaryButton>
        </div>
      </div>
    </div>
  );
}
