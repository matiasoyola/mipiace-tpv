// F1 · "Empleados" (ADR-018).
//
// Alta, edición, baja, y el estado del móvil de cada uno. La empresa
// genera aquí el enlace personal y lo copia o lo comparte — el servidor NO
// manda nada: ni SMS, ni WhatsApp, ni email. La empresa sabe mejor que
// nosotros por dónde habla con su gente, y mandar mensajes desde el
// servidor es un producto entero (plantillas, rebotes, bajas) que este
// bloque no compra.
//
// La baja DESACTIVA y revoca el móvil. No hay borrar: los registros se
// conservan cuatro años, y si alguien intentara borrarlos los triggers de
// la base lo pararían.

import { useEffect, useState } from "react";
import { Check, Copy, Link2, Share2, Smartphone, X } from "lucide-react";

import { AdminShell } from "../../AdminShell.js";
import { api, ApiError } from "../../api.js";
import {
  CenteredLoader,
  FieldError,
  OutlineButton,
  PrimaryButton,
  TextField,
} from "../../ui.js";
import { type EmployeeRow } from "./lib.js";

export function EmpleadosPage() {
  const [rows, setRows] = useState<EmployeeRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [alta, setAlta] = useState(false);
  const [enlace, setEnlace] = useState<{
    nombre: string;
    url: string;
    expiresAt: string;
  } | null>(null);

  async function recargar() {
    try {
      const r = await api<{ employees: EmployeeRow[] }>(
        "/admin/fichaje/employees",
      );
      setRows(r.employees);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Error inesperado");
    }
  }

  useEffect(() => {
    void recargar();
  }, []);

  async function generarEnlace(e: EmployeeRow) {
    try {
      const r = await api<{ url: string; expiresAt: string }>(
        `/admin/fichaje/employees/${e.id}/pairing-links`,
        { method: "POST", body: {} },
      );
      setEnlace({ nombre: e.name, url: r.url, expiresAt: r.expiresAt });
      void recargar();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Error inesperado");
    }
  }

  async function revocar(e: EmployeeRow) {
    try {
      await api(`/admin/fichaje/employees/${e.id}/devices/revoke`, {
        method: "POST",
        body: {},
      });
      void recargar();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Error inesperado");
    }
  }

  async function cambiarAlta(e: EmployeeRow, active: boolean) {
    try {
      await api(`/admin/fichaje/employees/${e.id}`, {
        method: "PATCH",
        body: { active },
      });
      void recargar();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Error inesperado");
    }
  }

  if (!rows) return <CenteredLoader label="Cargando empleados…" />;

  const activos = rows.filter((r) => r.active);
  const bajas = rows.filter((r) => !r.active);

  return (
    <AdminShell title="Control horario · Empleados">
      <p className="-mt-2 mb-5 text-[13.5px] text-slate-500">
        Quién ficha en tu empresa. Genera el enlace personal de cada uno y
        pásaselo por donde habléis: se usa una sola vez y caduca a los 7 días.
      </p>

      {error && <FieldError message={error} />}

      <div className="mb-5 flex items-center justify-between gap-3">
        <h2 className="text-[16px] font-semibold text-mipiace-ink">
          En alta{" "}
          <span className="font-normal tabular-nums text-slate-400">
            {activos.length}
          </span>
        </h2>
        <PrimaryButton
          type="button"
          onClick={() => setAlta(true)}
          className="!h-10 !w-auto !px-4 !text-[13.5px]"
        >
          Dar de alta
        </PrimaryButton>
      </div>

      {activos.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 text-[13px] text-slate-500">
          Todavía no hay nadie. Da de alta a tu primer empleado y genérale su
          enlace.
        </div>
      ) : (
        <div className="space-y-2.5">
          {activos.map((e) => (
            <Fila
              key={e.id}
              e={e}
              onEnlace={() => generarEnlace(e)}
              onRevocar={() => revocar(e)}
              onBaja={() => cambiarAlta(e, false)}
            />
          ))}
        </div>
      )}

      {bajas.length > 0 && (
        <>
          <h2 className="mb-3 mt-8 text-[16px] font-semibold text-mipiace-ink">
            De baja{" "}
            <span className="font-normal tabular-nums text-slate-400">
              {bajas.length}
            </span>
          </h2>
          <p className="mb-3 -mt-2 text-[12.5px] text-slate-500">
            Ya no fichan, pero su registro se conserva cuatro años y sigue en
            el histórico.
          </p>
          <div className="space-y-2.5">
            {bajas.map((e) => (
              <Fila
                key={e.id}
                e={e}
                onEnlace={() => generarEnlace(e)}
                onRevocar={() => revocar(e)}
                onBaja={() => cambiarAlta(e, true)}
              />
            ))}
          </div>
        </>
      )}

      {alta && (
        <AltaModal
          onClose={() => setAlta(false)}
          onHecho={() => {
            setAlta(false);
            void recargar();
          }}
        />
      )}
      {enlace && (
        <EnlaceModal enlace={enlace} onClose={() => setEnlace(null)} />
      )}
    </AdminShell>
  );
}

function Fila({
  e,
  onEnlace,
  onRevocar,
  onBaja,
}: {
  e: EmployeeRow;
  onEnlace: () => void;
  onRevocar: () => void;
  onBaja: () => void;
}) {
  return (
    // Una fila = una línea en escritorio. Lo enseñó el bucle visual: con
    // `flex-wrap` los tres botones caían a una segunda línea y cada
    // empleado ocupaba 180 px, así que una plantilla de diez no cabía en
    // pantalla.
    <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 sm:flex-row sm:items-center sm:gap-4">
      <div className="min-w-0 sm:w-[210px]">
        <div className="truncate text-[14.5px] font-medium text-mipiace-ink">
          {e.name}
        </div>
        <div className="truncate text-[12.5px] text-slate-400">
          {e.email ?? "—"}
        </div>
      </div>

      {/* `min-w` y `nowrap`: con `flex-1` a secas la columna se encogía por
          debajo de su texto y "Móvil desde el 17 sept" caía en tres líneas
          encima del botón. Segunda pasada del bucle visual. */}
      <div className="min-w-0 whitespace-nowrap text-[12.5px] sm:flex-1 sm:min-w-[165px]">
        {e.device ? (
          <span className="inline-flex items-center gap-1.5 text-emerald-700">
            <Smartphone className="h-3.5 w-3.5" />
            Móvil desde el{" "}
            {new Date(e.device.pairedAt).toLocaleDateString("es-ES", {
              day: "numeric",
              month: "short",
            })}
          </span>
        ) : e.pendingLink ? (
          <span className="inline-flex items-center gap-1.5 text-slate-500">
            <Link2 className="h-3.5 w-3.5" />
            Enlace pendiente de abrir
          </span>
        ) : (
          <span className="text-slate-400">Sin móvil emparejado</span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
        {e.active && (
          <OutlineButton
            type="button"
            onClick={onEnlace}
            className="!h-9 !w-auto !px-3 !text-[13px]"
          >
            {e.device ? "Cambiar de móvil" : "Generar enlace"}
          </OutlineButton>
        )}
        {e.device && (
          <button
            type="button"
            onClick={onRevocar}
            className="h-9 rounded-2xl px-3 text-[13px] text-slate-500 hover:bg-mipiace-stone hover:text-mipiace-ink"
          >
            Revocar móvil
          </button>
        )}
        <button
          type="button"
          onClick={onBaja}
          className="h-9 rounded-2xl px-3 text-[13px] text-slate-500 hover:bg-mipiace-stone hover:text-mipiace-ink"
        >
          {e.active ? "Dar de baja" : "Volver a dar de alta"}
        </button>
      </div>
    </div>
  );
}

function AltaModal({
  onClose,
  onHecho,
}: {
  onClose: () => void;
  onHecho: () => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function guardar() {
    if (!name.trim()) {
      setError("Escribe el nombre.");
      return;
    }
    setBusy(true);
    try {
      await api("/admin/fichaje/employees", {
        method: "POST",
        body: {
          name: name.trim(),
          ...(email.trim() ? { email: email.trim() } : {}),
          ...(phone.trim() ? { phone: phone.trim() } : {}),
        },
      });
      onHecho();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Error inesperado");
      setBusy(false);
    }
  }

  return (
    <Modal title="Dar de alta a un empleado" onClose={onClose}>
      <div className="space-y-3">
        <TextField id="emp-nombre" label="Nombre" value={name} onChange={setName} />
        <TextField
          id="emp-email"
          label="Email (opcional)"
          value={email}
          onChange={setEmail}
          type="email"
        />
        <TextField
          id="emp-telefono"
          label="Teléfono (opcional)"
          value={phone}
          onChange={setPhone}
        />
        {error && <FieldError message={error} />}
        <PrimaryButton type="button" onClick={guardar} disabled={busy}>
          {busy ? "Guardando…" : "Dar de alta"}
        </PrimaryButton>
      </div>
    </Modal>
  );
}

function EnlaceModal({
  enlace,
  onClose,
}: {
  enlace: { nombre: string; url: string; expiresAt: string };
  onClose: () => void;
}) {
  const [copiado, setCopiado] = useState(false);
  const puedeCompartir =
    typeof navigator !== "undefined" && typeof navigator.share === "function";

  async function copiar() {
    try {
      await navigator.clipboard.writeText(enlace.url);
      setCopiado(true);
      window.setTimeout(() => setCopiado(false), 2000);
    } catch {
      /* sin portapapeles: el enlace está a la vista para seleccionarlo */
    }
  }

  async function compartir() {
    try {
      await navigator.share({
        title: "Fichar",
        text: `${enlace.nombre}, este es tu enlace para fichar:`,
        url: enlace.url,
      });
    } catch {
      /* el usuario canceló */
    }
  }

  return (
    <Modal title={`Enlace de ${enlace.nombre}`} onClose={onClose}>
      <p className="mb-3 text-[13.5px] text-slate-500">
        Pásaselo por donde habléis. Se usa <strong>una sola vez</strong> y
        caduca el{" "}
        {new Date(enlace.expiresAt).toLocaleDateString("es-ES", {
          day: "numeric",
          month: "long",
        })}
        . Al abrirlo, ese móvil queda emparejado con él.
      </p>
      <div className="mb-3 break-all rounded-2xl bg-mipiace-stone px-4 py-3 text-[13px] text-mipiace-ink-soft">
        {enlace.url}
      </div>
      <div className="flex gap-2">
        <PrimaryButton type="button" onClick={copiar}>
          <span className="inline-flex items-center gap-2">
            {copiado ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            {copiado ? "Copiado" : "Copiar enlace"}
          </span>
        </PrimaryButton>
        {puedeCompartir && (
          <OutlineButton type="button" onClick={compartir}>
            <span className="inline-flex items-center gap-2">
              <Share2 className="h-4 w-4" />
              Compartir
            </span>
          </OutlineButton>
        )}
      </div>
    </Modal>
  );
}

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-mipiace-ink/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
    >
      <div
        className="max-h-[88vh] w-full max-w-md overflow-y-auto rounded-3xl bg-white p-6"
        onClick={(ev) => ev.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <h2 className="text-[18px] font-semibold text-mipiace-ink">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="-mr-2 -mt-1 flex h-9 w-9 items-center justify-center rounded-2xl text-slate-400 hover:bg-mipiace-stone hover:text-mipiace-ink"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
