// clinica-4 · EL INFORME: se elige, se ve el papel y se entrega.
//
// Es el mockup validado el 08-10, pestaña «Informe PDF»: los cuatro tipos
// en tarjetas a la izquierda, para quién es, y el papel a la derecha tal
// como va a salir impreso.
//
// ── El papel que se ve ES el que se imprime ──────────────────────────
//
// Las secciones las arma el servidor (`construirInforme`, puro) y esta
// pantalla las pinta. No hay una versión de pantalla y otra de PDF: si las
// hubiera, lo que la podóloga enseña al paciente en la tablet y lo que se
// lleva en papel podrían decir cosas distintas, y el que viaja es el papel.
//
// ── Ni un importe ────────────────────────────────────────────────────
//
// No hay nada que esconder: la respuesta no trae una sola clave de dinero
// (regla 16, garantizada en el tipo del paquete). Así que aquí no hay
// `verImportes` que ramificar.

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Loader2, Mail, Printer } from "lucide-react";

import {
  DESCRIPCION_DE_TIPO_DE_INFORME,
  NOMBRE_DE_TIPO_DE_INFORME,
  TIPOS_DE_INFORME,
  type TipoDeInforme,
} from "@mipiacetpv/clinica-sesion";

import { ApiError, apiBlobWithCashier, apiWithCashier } from "../api.js";
import { Mal, diaCorto } from "./piezas.js";

interface SeccionDelInforme {
  id: string;
  titulo: string;
  parrafos: string[];
  filas: string[][];
  grafica: { fecha: string; dolor: number }[];
}

interface VistaDelInforme {
  informe: {
    tipo: TipoDeInforme;
    titulo: string;
    subtitulo: string;
    secciones: SeccionDelInforme[];
    piePropio: string | null;
  };
  centro: {
    nombre: string;
    nif: string | null;
    direccion: string | null;
    telefono: string | null;
  };
  profesional: { nombre: string; colegiado: string | null; titulo: string };
  paciente: { nombre: string; edad: number | null; email: string | null };
  fecha: string;
  entregas: Array<{
    id: string;
    tipo: string;
    tipoNombre: string;
    canal: string;
    destinatario: string;
    email: string | null;
    cuando: string;
    quien: string;
  }>;
}

type Destinatario = "PACIENTE" | "PROFESIONAL";

const DOLOR_MAXIMO = 10;

export function Informe(props: { clientId: string }) {
  const [tipo, setTipo] = useState<TipoDeInforme>("RESUMEN");
  const [destinatario, setDestinatario] = useState<Destinatario>("PACIENTE");
  const [motivo, setMotivo] = useState("");
  const [emailProfesional, setEmailProfesional] = useState("");
  const [vista, setVista] = useState<VistaDelInforme | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [entregado, setEntregado] = useState<string | null>(null);
  const [trabajando, setTrabajando] = useState(false);

  // El motivo de la derivación viaja en la vista previa para que el papel
  // lo enseñe mientras se escribe. Se manda con retardo: un GET por cada
  // tecla sobre una historia entera es una historia leída treinta veces, y
  // cada lectura deja su línea en el registro de accesos.
  const motivoDebounced = useRef(motivo);
  const [motivoParaElPapel, setMotivoParaElPapel] = useState("");
  useEffect(() => {
    motivoDebounced.current = motivo;
    const t = window.setTimeout(() => {
      setMotivoParaElPapel(motivoDebounced.current);
    }, 700);
    return () => window.clearTimeout(t);
  }, [motivo]);

  const cargar = useCallback(async () => {
    setError(null);
    try {
      const q = new URLSearchParams({ tipo });
      if (tipo === "DERIVACION" && motivoParaElPapel.trim()) {
        q.set("motivo", motivoParaElPapel.trim());
      }
      setVista(
        await apiWithCashier<VistaDelInforme>(
          `/clinica/clients/${props.clientId}/informe?${q.toString()}`,
        ),
      );
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "No se pudo preparar el informe (¿sin conexión?).",
      );
    } finally {
      setCargando(false);
    }
  }, [props.clientId, tipo, motivoParaElPapel]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function imprimir() {
    setTrabajando(true);
    setError(null);
    try {
      const { blob, headers } = await apiBlobWithCashier(
        `/clinica/clients/${props.clientId}/informe`,
        {
          method: "POST",
          body: {
            tipo,
            canal: "PRINT",
            destinatario,
            motivo: tipo === "DERIVACION" ? motivo.trim() : undefined,
          },
        },
      );
      // Se abre el PDF en una pestaña y se deja que la tablet imprima con
      // su propio diálogo: el TPV no habla con la impresora de red del
      // iPad (eso es una decisión abierta del frente, `decisiones.md`), y
      // el visor del sistema sí.
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener");
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setEntregado(
        headers.get("X-Entrega-Id")
          ? "Informe preparado para imprimir. Queda apuntado en la historia y en el registro de accesos."
          : "Informe preparado para imprimir.",
      );
      await cargar();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "No se pudo imprimir.",
      );
    } finally {
      setTrabajando(false);
    }
  }

  async function enviar() {
    setTrabajando(true);
    setError(null);
    try {
      const r = await apiWithCashier<{ entregaId: string; enviadoA: string }>(
        `/clinica/clients/${props.clientId}/informe`,
        {
          method: "POST",
          body: {
            tipo,
            canal: "EMAIL",
            destinatario,
            email:
              destinatario === "PROFESIONAL"
                ? emailProfesional.trim() || undefined
                : undefined,
            motivo: tipo === "DERIVACION" ? motivo.trim() : undefined,
          },
        },
      );
      setEntregado(
        `Enviado a ${r.enviadoA}. El correo no lleva ningún dato de salud: el informe va en el PDF adjunto. Queda apuntado en la historia y en el registro de accesos.`,
      );
      await cargar();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo enviar.");
    } finally {
      setTrabajando(false);
    }
  }

  if (cargando) {
    return (
      <div className="flex items-center gap-2 text-[13px] text-slate-500 py-10 justify-center">
        <Loader2 className="w-4 h-4 animate-spin motion-reduce:animate-none" />
        Preparando el informe…
      </div>
    );
  }
  if (!vista) return <Mal>{error ?? "No se pudo preparar el informe."}</Mal>;

  return (
    <div
      // DOS COLUMNAS DESDE 1024, que es el iPad apaisado y el que manda. La
      // izquierda a 360 px —lo que piden las cuatro tarjetas con su texto
      // de dos líneas— y el papel se queda con el resto. A 390 se apila:
      // el papel A4 en una columna de 150 px no es un papel, es una
      // textura.
      className="grid gap-4 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)] items-start"
      data-test="informe"
    >
      <div className="bg-white border border-slate-200 rounded-3xl px-3 sm:px-5 py-4">
        <h2 className="m-0 text-[17px] font-bold text-mipiace-ink">Informe</h2>
        <div className="text-[13px] text-slate-500 mt-0.5">
          Elige qué necesitas.
        </div>

        <div className="grid gap-2 mt-3.5">
          {TIPOS_DE_INFORME.map((t) => (
            <button
              key={t}
              type="button"
              data-test={`informe-${t}`}
              aria-pressed={tipo === t}
              onClick={() => {
                setTipo(t);
                setEntregado(null);
              }}
              className={`w-full text-left min-h-[64px] px-3.5 py-3 rounded-2xl ${
                tipo === t
                  ? "bg-mipiace-coral-soft shadow-[inset_0_0_0_2px_var(--tw-shadow-color)] shadow-mipiace-coral"
                  : "bg-mipiace-stone"
              }`}
            >
              <span className="block font-bold text-[15px] text-mipiace-ink">
                {NOMBRE_DE_TIPO_DE_INFORME[t]}
              </span>
              <span className="block text-[13px] text-slate-600">
                {DESCRIPCION_DE_TIPO_DE_INFORME[t]}
              </span>
            </button>
          ))}
        </div>

        {tipo === "DERIVACION" && (
          <label className="block mt-3.5 text-[13px] font-medium text-mipiace-ink-soft">
            Motivo de la derivación
            <textarea
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              maxLength={1000}
              rows={3}
              data-test="motivo-derivacion"
              placeholder="Qué le pasa y para qué lo derivas."
              className="mt-1 w-full px-3 py-2 rounded-xl border border-slate-200 text-[15px] text-mipiace-ink"
            />
            <span className="block text-[12.5px] text-slate-500 mt-1">
              Es lo primero que lee quien reciba el informe. Sin él no se
              entrega.
            </span>
          </label>
        )}

        <div className="mt-4 text-[13px] font-medium text-mipiace-ink-soft">
          ¿Para quién?
        </div>
        <div className="flex flex-wrap gap-2 mt-2">
          {(
            [
              ["PACIENTE", "El paciente"],
              ["PROFESIONAL", "Otro profesional"],
            ] as ReadonlyArray<readonly [Destinatario, string]>
          ).map(([k, t]) => (
            <button
              key={k}
              type="button"
              aria-pressed={destinatario === k}
              onClick={() => {
                setDestinatario(k);
                setEntregado(null);
              }}
              className={`min-h-touch px-3.5 rounded-xl text-[14px] border ${
                destinatario === k
                  ? "bg-mipiace-coral-soft border-mipiace-coral text-mipiace-coral-dark font-medium"
                  : "bg-white border-slate-200 text-mipiace-ink"
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {destinatario === "PROFESIONAL" && (
          <label className="block mt-3 text-[13px] font-medium text-mipiace-ink-soft">
            Email del profesional
            <input
              type="email"
              value={emailProfesional}
              onChange={(e) => setEmailProfesional(e.target.value)}
              maxLength={200}
              data-test="email-profesional"
              className="mt-1 w-full h-touch px-3 rounded-xl border border-slate-200 text-[15px] text-mipiace-ink"
            />
          </label>
        )}

        {destinatario === "PACIENTE" && (
          <div className="mt-2 text-[12.5px] text-slate-500">
            {vista.paciente.email
              ? `Se manda a ${vista.paciente.email}, el email de su ficha.`
              : "Este paciente no tiene email en su ficha: sólo se puede imprimir."}
          </div>
        )}

        <div className="flex gap-3 flex-wrap mt-4">
          <button
            type="button"
            data-test="imprimir"
            disabled={trabajando}
            onClick={() => void imprimir()}
            className="h-[56px] px-5 rounded-[18px] bg-mipiace-coral text-white font-medium text-[16px] inline-flex items-center gap-2 disabled:opacity-45"
          >
            {trabajando ? (
              <Loader2 className="w-4 h-4 animate-spin motion-reduce:animate-none" />
            ) : (
              <Printer className="w-[18px] h-[18px]" />
            )}
            Imprimir
          </button>
          <button
            type="button"
            data-test="enviar-email"
            disabled={
              trabajando ||
              (destinatario === "PACIENTE" && !vista.paciente.email)
            }
            onClick={() => void enviar()}
            className="h-touch px-4 rounded-2xl bg-mipiace-stone text-mipiace-ink font-medium text-[14px] inline-flex items-center gap-2 disabled:opacity-45"
          >
            <Mail className="w-4 h-4" /> Enviar por email
          </button>
        </div>

        {entregado && (
          <div
            data-test="informe-entregado"
            className="flex gap-2.5 items-start bg-emerald-50 text-emerald-800 rounded-2xl px-3.5 py-3 text-[14px] mt-3.5"
          >
            <Check className="w-[18px] h-[18px] shrink-0 mt-0.5" />
            <span>{entregado}</span>
          </div>
        )}

        {error && (
          <div className="mt-3">
            <Mal>{error}</Mal>
          </div>
        )}

        {vista.entregas.length > 0 && (
          <>
            <div className="mt-4 text-[13px] font-medium text-mipiace-ink-soft">
              Ya entregados
            </div>
            <div className="grid gap-1.5 mt-2">
              {vista.entregas.map((e) => (
                <div key={e.id} className="text-[12.5px] text-slate-600">
                  {diaCorto(e.cuando)} · {e.tipoNombre} ·{" "}
                  {e.canal === "EMAIL" ? `email a ${e.email}` : "impreso"} ·{" "}
                  {e.quien}
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* ── EL PAPEL ──────────────────────────────────────────────── */}
      <div
        className="bg-white border border-slate-200 rounded-lg px-5 sm:px-8 py-7 text-[13px] leading-[1.55] min-h-[520px] shadow-sm"
        data-test="papel"
      >
        <div className="flex justify-between gap-4 border-b border-slate-200 pb-2.5 mb-3.5 flex-wrap">
          <div>
            <h3 className="m-0 text-[16px] font-semibold text-mipiace-ink">
              {vista.centro.nombre}
            </h3>
            <div className="text-[12px] text-slate-500">
              {vista.profesional.nombre} · {vista.profesional.titulo}
              {vista.profesional.colegiado
                ? ` · Col. ${vista.profesional.colegiado}`
                : ""}
            </div>
            {(vista.centro.nif || vista.centro.direccion) && (
              <div className="text-[12px] text-slate-500">
                {[vista.centro.nif, vista.centro.direccion]
                  .filter(Boolean)
                  .join(" · ")}
              </div>
            )}
          </div>
          <div className="text-[12px] text-slate-500 sm:text-right">
            <div className="font-semibold text-mipiace-ink text-[13px]">
              {vista.informe.titulo}
            </div>
            {vista.fecha}
          </div>
        </div>

        <div className="font-semibold text-[15px] text-mipiace-ink">
          {vista.paciente.nombre}
          {vista.paciente.edad != null ? ` · ${vista.paciente.edad} años` : ""}
        </div>
        <div className="text-[12px] text-slate-500">
          {vista.informe.subtitulo}
        </div>

        {vista.informe.secciones.map((s) => (
          <div key={s.id} className="mt-3.5">
            <div className="text-[11px] tracking-[0.06em] uppercase text-slate-500 mb-1">
              {s.titulo}
            </div>
            {s.parrafos.map((p, i) => (
              <p key={i} className="m-0 mb-1 text-mipiace-ink">
                {p}
              </p>
            ))}
            {s.filas.length > 0 && (
              // La tabla scrollea en su propia caja: un informe con una
              // fila larga no puede hacer que la PÁGINA scrollee a lo
              // ancho — eso rompe el resto de la pantalla.
              <div className="overflow-x-auto">
                <table className="w-full border-collapse tabular-nums">
                  <tbody>
                    {s.filas.map((fila, i) => (
                      <tr key={i}>
                        {fila.map((celda, j) => (
                          <td
                            key={j}
                            className={`py-1 border-b border-slate-100 align-top pr-3 ${
                              j === 0 ? "font-medium whitespace-nowrap" : ""
                            }`}
                          >
                            {celda}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {s.grafica.length > 0 && <GraficaDelPapel puntos={s.grafica} />}
          </div>
        ))}

        <div className="mt-5">
          <div className="text-[11px] tracking-[0.06em] uppercase text-slate-500 mb-1">
            Firma
          </div>
          <div className="text-mipiace-ink">
            {vista.profesional.nombre} · {vista.profesional.titulo}
            {vista.profesional.colegiado
              ? ` · Nº de colegiado ${vista.profesional.colegiado}`
              : ""}
          </div>
        </div>

        {vista.informe.piePropio && (
          <div className="mt-3 text-[12px] text-slate-500">
            {vista.informe.piePropio}
          </div>
        )}
      </div>
    </div>
  );
}

/** Las barras del dolor, las mismas que el PDF pinta. */
function GraficaDelPapel(props: {
  puntos: { fecha: string; dolor: number }[];
}) {
  return (
    <div className="flex items-end gap-2 h-[90px] mt-2">
      {props.puntos.map((p, i) => (
        <div key={i} className="flex-1 max-w-[56px] text-center">
          <div className="text-[11px] font-bold text-mipiace-ink">
            {p.dolor}
          </div>
          <div
            className="bg-mipiace-coral rounded-t-[4px] mx-auto w-full"
            style={{
              height: `${(Math.max(0, Math.min(DOLOR_MAXIMO, p.dolor)) / DOLOR_MAXIMO) * 56}px`,
            }}
          />
          <div className="text-[11px] text-slate-500 mt-0.5">
            {diaCorto(p.fecha)}
          </div>
        </div>
      ))}
    </div>
  );
}
