// clinica-4 · LOS CONSENTIMIENTOS, firmados con el dedo en la consulta.
//
// Es el mockup validado el 08-10 (`docs/mockups/clinica-4-fotos-consentimientos-informe.html`,
// pestaña «Consentimiento») con sus piezas en su orden: la lista con lo
// que pide la cita de hoy, el texto que se lee con el paciente, la caja de
// firma y el acuse de «firmado por … delante de …».
//
// ── Lo clínico se firma AQUÍ, no por un enlace ───────────────────────
//
// S3, decidido: la ley pide que informe el profesional antes de firmar, y
// por eso un consentimiento con plantilla clínica se firma en la sala, con
// el sanitario delante. En este bloque **no hay enlace para leerlo antes**
// (eso es del bloque común de enlaces), así que esta pantalla es el único
// camino.
//
// ── La firma es un PNG, y el PDF lo hace el servidor ─────────────────
//
// El `<canvas>` recoge el trazo del dedo y manda el PNG. El PDF —con el
// texto, la fecha, el firmante y el informante— lo pinta el servidor y
// calcula su huella. La pantalla no arma ningún documento: si lo hiciera,
// el papel que firma la paciente y el que queda en la historia serían dos
// documentos distintos armados por dos sitios.
//
// ── Y no se puede firmar sin trazo ───────────────────────────────────
//
// El botón sale desactivado hasta que hay algo dibujado, y el servidor lo
// rechaza igual (`FALTA_LA_FIRMA`). Las dos mitades: la pantalla ayuda, la
// ruta garantiza.

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, FileText, Loader2, PenLine } from "lucide-react";

import { ApiError, apiBlobWithCashier, apiWithCashier } from "../api.js";
import { Mal, diaCorto } from "./piezas.js";

// ── Lo que manda la API ──────────────────────────────────────────────

export interface ConsentimientoFirmado {
  id: string;
  plantillaId: string | null;
  plantillaVersion: number | null;
  titulo: string;
  firmadoEn: string;
  revocado: boolean;
  revocadoEn: string | null;
  revocadoMotivo: string | null;
  tienePdf: boolean;
  clinico: boolean;
  firmante: {
    clase: "PACIENTE" | "REPRESENTANTE" | null;
    nombre: string | null;
    relacion: string | null;
  };
  informante: { nombre: string; colegiado: string | null } | null;
  pdfSha256: string | null;
}

interface PlantillaEnPantalla {
  id: string;
  titulo: string;
  version: number;
  parrafos: string[];
  clinica: boolean;
  pendienteDeValidar: boolean;
  laPideLaCita: boolean;
  vigente: ConsentimientoFirmado | null;
}

interface VistaDeConsentimientos {
  plantillas: PlantillaEnPantalla[];
  firmados: ConsentimientoFirmado[];
  pideLaCita: string[];
}

type Firmante = "PACIENTE" | "REPRESENTANTE";

export function Consentimientos(props: {
  clientId: string;
  paciente: string;
  /** La cita, si se abre desde la sesión: decide qué se pide hoy. */
  appointmentId?: string;
  /** La plantilla con la que entrar abierta («Firmar consentimiento de
   *  fotos» lleva directo a su texto, como en el mockup). */
  plantillaInicial?: string | null;
  /** Se llama al firmar: la sesión recarga su puerta y las fotos la suya. */
  onFirmado?: () => void;
}) {
  const [vista, setVista] = useState<VistaDeConsentimientos | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [abierta, setAbierta] = useState<string | null>(
    props.plantillaInicial ?? null,
  );
  const [firmante, setFirmante] = useState<Firmante>("PACIENTE");
  const [nombre, setNombre] = useState("");
  const [relacion, setRelacion] = useState("");
  const [hayTrazo, setHayTrazo] = useState(false);
  const [firmando, setFirmando] = useState(false);
  const [acuse, setAcuse] = useState<ConsentimientoFirmado | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const cargar = useCallback(async () => {
    setError(null);
    try {
      const q = props.appointmentId
        ? `?appointmentId=${props.appointmentId}`
        : "";
      setVista(
        await apiWithCashier<VistaDeConsentimientos>(
          `/clinica/clients/${props.clientId}/consentimientos${q}`,
        ),
      );
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "No se pudieron abrir los consentimientos (¿sin conexión?).",
      );
    } finally {
      setCargando(false);
    }
  }, [props.clientId, props.appointmentId]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  // ── La caja de firma ───────────────────────────────────────────────
  //
  // `pointer*` y no `touch*`: el mismo código recoge el dedo en la tablet
  // y el ratón en el portátil del bucle visual, que es lo que permite
  // recorrer esta pantalla sin un dedo de verdad.
  //
  // El canvas se dimensiona al tamaño REAL en píxeles del dispositivo
  // (`devicePixelRatio`): a 1× el trazo sale pixelado, y lo que se
  // incrusta en el PDF es esta imagen.
  const prepararCanvas = useCallback(() => {
    const c = canvasRef.current;
    if (!c) return;
    const r = c.getBoundingClientRect();
    const escala = Math.min(window.devicePixelRatio || 1, 3);
    c.width = Math.round(r.width * escala);
    c.height = Math.round(r.height * escala);
    const ctx = c.getContext("2d");
    if (!ctx) return;
    // Fondo BLANCO y no transparente: el PNG se incrusta en un PDF
    // blanco, y un trazo oscuro sobre transparente sale bien… hasta que
    // alguien lo abra en un visor con fondo oscuro.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.scale(escala, escala);
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#1F2937";
  }, []);

  useEffect(() => {
    if (abierta) prepararCanvas();
  }, [abierta, prepararCanvas]);

  const borrarFirma = () => {
    prepararCanvas();
    setHayTrazo(false);
  };

  function pos(e: React.PointerEvent<HTMLCanvasElement>) {
    const c = canvasRef.current!;
    const b = c.getBoundingClientRect();
    return { x: e.clientX - b.left, y: e.clientY - b.top };
  }

  const dibujando = useRef(false);

  async function firmar(plantilla: PlantillaEnPantalla) {
    const c = canvasRef.current;
    if (!c) return;
    setFirmando(true);
    setError(null);
    try {
      // `toDataURL` → el trozo después de la coma es el base64 del PNG.
      const png = c.toDataURL("image/png").split(",")[1] ?? "";
      const r = await apiWithCashier<{ consentimiento: ConsentimientoFirmado }>(
        `/clinica/clients/${props.clientId}/consentimientos`,
        {
          method: "POST",
          body: {
            plantillaId: plantilla.id,
            firmante: {
              clase: firmante,
              nombre: firmante === "REPRESENTANTE" ? nombre.trim() : null,
              relacion: firmante === "REPRESENTANTE" ? relacion.trim() : null,
            },
            firmaPngBase64: png,
          },
        },
      );
      setAcuse(r.consentimiento);
      setHayTrazo(false);
      await cargar();
      props.onFirmado?.();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "No se pudo firmar.",
      );
    } finally {
      setFirmando(false);
    }
  }

  async function abrirPdf(consentimientoId: string) {
    try {
      const { blob } = await apiBlobWithCashier(
        `/clinica/clients/${props.clientId}/consentimientos/${consentimientoId}/pdf`,
      );
      // Se abre en una pestaña nueva y la URL se suelta: un `objectURL`
      // que no se revoca mantiene el PDF en memoria de la tablet toda la
      // sesión, y lo que hay dentro son datos de salud.
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener");
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "No se pudo abrir el documento.",
      );
    }
  }

  if (cargando) {
    return (
      <div className="flex items-center gap-2 text-[13px] text-slate-500 py-10 justify-center">
        <Loader2 className="w-4 h-4 animate-spin motion-reduce:animate-none" />
        Abriendo los consentimientos…
      </div>
    );
  }
  if (!vista) return <Mal>{error ?? "No se pudieron abrir."}</Mal>;

  const plantilla = abierta
    ? (vista.plantillas.find((p) => p.id === abierta) ?? null)
    : null;

  // ── El acuse, después de firmar ────────────────────────────────────
  if (acuse) {
    return (
      <div
        className="bg-white border border-slate-200 rounded-3xl px-3 sm:px-5 py-4"
        data-test="consentimiento-firmado"
      >
        <h2 className="m-0 text-[17px] font-bold text-mipiace-ink">
          {acuse.titulo}
        </h2>
        <div className="flex gap-2.5 items-start bg-emerald-50 text-emerald-800 rounded-2xl px-3.5 py-3 text-[14px] mt-3">
          <Check className="w-[18px] h-[18px] shrink-0 mt-0.5" />
          <span>
            Firmado por{" "}
            <b>
              {acuse.firmante.clase === "REPRESENTANTE"
                ? `${acuse.firmante.nombre} (${acuse.firmante.relacion})`
                : props.paciente}
            </b>{" "}
            el {diaCorto(acuse.firmadoEn)}
            {acuse.informante
              ? `, delante de ${acuse.informante.nombre}${acuse.informante.colegiado ? ` (Col. ${acuse.informante.colegiado})` : ""}`
              : ""}
            . El PDF queda en la historia.
          </span>
        </div>
        <div className="flex gap-3 flex-wrap mt-3.5">
          {acuse.tienePdf && (
            <button
              type="button"
              onClick={() => void abrirPdf(acuse.id)}
              className="h-touch px-4 rounded-2xl bg-mipiace-stone text-mipiace-ink font-medium text-[14px] inline-flex items-center gap-2"
            >
              <FileText className="w-4 h-4" /> Ver el documento
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setAcuse(null);
              setAbierta(null);
            }}
            className="h-touch px-4 rounded-2xl bg-mipiace-stone text-mipiace-ink font-medium text-[14px]"
          >
            Volver a la lista
          </button>
        </div>
      </div>
    );
  }

  // ── El texto y la firma ────────────────────────────────────────────
  if (plantilla) {
    const yaFirmado = plantilla.vigente != null;
    return (
      <div
        className="bg-white border border-slate-200 rounded-3xl px-3 sm:px-5 py-4"
        data-test="consentimiento-abierto"
      >
        <h2 className="m-0 text-[17px] font-bold text-mipiace-ink">
          {plantilla.titulo}
        </h2>
        <div className="text-[13px] text-slate-500 mt-0.5">
          {yaFirmado
            ? "Ya está firmado y vigente."
            : "Léelo con el paciente y que firme con el dedo."}
        </div>

        {plantilla.pendienteDeValidar && (
          <div className="mt-3 bg-amber-50 text-amber-800 rounded-2xl px-3.5 py-2.5 text-[13px]">
            Texto de ejemplo del programa, pendiente de revisar por la
            profesional del centro.
          </div>
        )}

        <div className="mt-3 bg-mipiace-stone rounded-2xl px-4 py-3.5 text-[15px] leading-relaxed max-h-[260px] overflow-y-auto space-y-3">
          {plantilla.parrafos.map((p, i) => (
            <p key={i} className="m-0">
              {p}
            </p>
          ))}
          <p className="m-0">
            Paciente: <b>{props.paciente}</b>.
          </p>
        </div>

        {!yaFirmado && (
          <>
            <div className="mt-4 text-[13px] font-medium text-mipiace-ink-soft">
              ¿Quién firma?
            </div>
            <div className="flex gap-2 flex-wrap mt-2">
              {(
                [
                  ["PACIENTE", "El paciente"],
                  ["REPRESENTANTE", "Un familiar o representante"],
                ] as ReadonlyArray<readonly [Firmante, string]>
              ).map(([k, t]) => (
                <button
                  key={k}
                  type="button"
                  aria-pressed={firmante === k}
                  onClick={() => setFirmante(k)}
                  className={`min-h-touch px-3.5 rounded-xl text-[14px] font-medium border ${
                    firmante === k
                      ? "bg-mipiace-coral-soft border-mipiace-coral text-mipiace-coral-dark"
                      : "bg-white border-slate-200 text-mipiace-ink"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>

            {firmante === "REPRESENTANTE" && (
              // Las dos cajas son obligatorias y lo dice el servidor
              // (`FALTA_EL_REPRESENTANTE`, `FALTA_LA_RELACION`): la ley
              // pide que conste quién firma por el paciente y qué es de él.
              <div className="grid gap-2.5 sm:grid-cols-2 mt-3">
                <label className="text-[13px] text-mipiace-ink-soft">
                  Nombre de quien firma
                  <input
                    value={nombre}
                    onChange={(e) => setNombre(e.target.value)}
                    maxLength={120}
                    className="mt-1 w-full h-touch px-3 rounded-xl border border-slate-200 text-[15px] text-mipiace-ink"
                  />
                </label>
                <label className="text-[13px] text-mipiace-ink-soft">
                  Qué es del paciente
                  <input
                    value={relacion}
                    onChange={(e) => setRelacion(e.target.value)}
                    maxLength={60}
                    placeholder="hija, hijo, tutor legal…"
                    className="mt-1 w-full h-touch px-3 rounded-xl border border-slate-200 text-[15px] text-mipiace-ink"
                  />
                </label>
              </div>
            )}

            <div className="mt-3.5 relative border-2 border-dashed border-slate-300 rounded-2xl bg-white touch-none">
              <canvas
                ref={canvasRef}
                data-test="caja-de-firma"
                className="block w-full h-[180px] rounded-2xl"
                onPointerDown={(e) => {
                  const ctx = canvasRef.current?.getContext("2d");
                  if (!ctx) return;
                  dibujando.current = true;
                  const p = pos(e);
                  ctx.beginPath();
                  ctx.moveTo(p.x, p.y);
                  canvasRef.current?.setPointerCapture(e.pointerId);
                }}
                onPointerMove={(e) => {
                  if (!dibujando.current) return;
                  const ctx = canvasRef.current?.getContext("2d");
                  if (!ctx) return;
                  const p = pos(e);
                  ctx.lineTo(p.x, p.y);
                  ctx.stroke();
                  if (!hayTrazo) setHayTrazo(true);
                }}
                onPointerUp={() => {
                  dibujando.current = false;
                }}
                onPointerLeave={() => {
                  dibujando.current = false;
                }}
              />
              {!hayTrazo && (
                <span className="absolute left-4 bottom-3 text-[13px] text-slate-500 pointer-events-none">
                  Firme aquí con el dedo
                </span>
              )}
            </div>

            <div className="flex gap-3 flex-wrap items-center mt-3.5">
              <button
                type="button"
                data-test="firmar"
                disabled={!hayTrazo || firmando}
                onClick={() => void firmar(plantilla)}
                className="h-[56px] px-6 rounded-[18px] bg-mipiace-coral text-white font-medium text-[16px] disabled:opacity-45 inline-flex items-center gap-2"
              >
                {firmando ? (
                  <Loader2 className="w-4 h-4 animate-spin motion-reduce:animate-none" />
                ) : (
                  <PenLine className="w-[18px] h-[18px]" />
                )}
                Firmar
              </button>
              <button
                type="button"
                onClick={borrarFirma}
                className="h-touch px-4 rounded-2xl bg-mipiace-stone text-mipiace-ink font-medium text-[14px]"
              >
                Borrar firma
              </button>
              <button
                type="button"
                onClick={() => setAbierta(null)}
                className="h-touch px-4 rounded-2xl bg-mipiace-stone text-mipiace-ink font-medium text-[14px]"
              >
                Cancelar
              </button>
              {!hayTrazo && (
                <span className="text-[13.5px] text-amber-700">
                  Falta la firma.
                </span>
              )}
            </div>
          </>
        )}

        {yaFirmado && (
          <div className="flex gap-3 flex-wrap mt-3.5">
            {plantilla.vigente!.tienePdf && (
              <button
                type="button"
                onClick={() => void abrirPdf(plantilla.vigente!.id)}
                className="h-touch px-4 rounded-2xl bg-mipiace-stone text-mipiace-ink font-medium text-[14px] inline-flex items-center gap-2"
              >
                <FileText className="w-4 h-4" /> Ver el documento
              </button>
            )}
            <button
              type="button"
              onClick={() => setAbierta(null)}
              className="h-touch px-4 rounded-2xl bg-mipiace-stone text-mipiace-ink font-medium text-[14px]"
            >
              Volver a la lista
            </button>
          </div>
        )}

        {error && (
          <div className="mt-3">
            <Mal>{error}</Mal>
          </div>
        )}
      </div>
    );
  }

  // ── La lista ───────────────────────────────────────────────────────
  return (
    <div
      className="bg-white border border-slate-200 rounded-3xl px-3 sm:px-5 py-4"
      data-test="consentimientos"
    >
      <h2 className="m-0 text-[17px] font-bold text-mipiace-ink">
        Consentimientos
      </h2>
      <div className="text-[13px] text-slate-500 mt-0.5">
        {vista.pideLaCita.length > 0
          ? "La cita de hoy pide los que salen marcados. La sesión no se puede cerrar sin ellos."
          : "Los que este paciente tiene firmados, y los que se le pueden firmar."}
      </div>

      <div className="grid gap-2.5 mt-3.5">
        {vista.plantillas.map((p) => (
          <button
            key={p.id}
            type="button"
            data-test={`plantilla-${p.id}`}
            onClick={() => {
              setAbierta(p.id);
              setHayTrazo(false);
              setFirmante("PACIENTE");
            }}
            className={`w-full text-left min-h-[72px] px-4 py-3 rounded-[18px] ${
              p.vigente
                ? "bg-emerald-50"
                : p.laPideLaCita
                  ? "bg-mipiace-coral-soft shadow-[inset_0_0_0_2px_var(--tw-shadow-color)] shadow-mipiace-coral"
                  : "bg-mipiace-stone"
            }`}
          >
            <span className="block font-bold text-[15px] text-mipiace-ink">
              {p.titulo}
              {p.vigente ? " · firmado ✓" : ""}
            </span>
            <span className="block text-[13px] text-slate-600 mt-0.5">
              {p.vigente
                ? `Firmado el ${diaCorto(p.vigente.firmadoEn)}${p.vigente.tienePdf ? " · PDF en la historia" : ""}`
                : p.laPideLaCita
                  ? "Lo pide la cita de hoy"
                  : p.id === "fotos-clinicas"
                    ? "Lo pide la primera foto del paciente"
                    : "Opcional"}
            </span>
          </button>
        ))}
      </div>

      {/* Lo que ya hay en la historia, incluidas las altas manuales y lo
          revocado: es la prueba de qué se firmó y cuándo, y eso no se
          esconde por haber dejado de valer. */}
      {vista.firmados.length > 0 && (
        <>
          <div className="mt-4 text-[13px] font-medium text-mipiace-ink-soft">
            En la historia
          </div>
          <div className="grid gap-2 mt-2">
            {vista.firmados.map((f) => (
              <div
                key={f.id}
                className="flex gap-3 items-center justify-between bg-white border border-slate-200 rounded-2xl px-3.5 py-2.5"
              >
                <div className="min-w-0">
                  <div className="text-[14px] font-medium text-mipiace-ink truncate">
                    {f.titulo}
                    {f.revocado && (
                      <span className="ml-2 text-[12px] font-bold text-red-700">
                        REVOCADO
                      </span>
                    )}
                  </div>
                  <div className="text-[12.5px] text-slate-500">
                    {diaCorto(f.firmadoEn)}
                    {f.informante ? ` · informó ${f.informante.nombre}` : ""}
                    {f.revocado && f.revocadoMotivo
                      ? ` · ${f.revocadoMotivo}`
                      : ""}
                  </div>
                </div>
                {f.tienePdf && (
                  <button
                    type="button"
                    onClick={() => void abrirPdf(f.id)}
                    aria-label={`Ver el documento de ${f.titulo}`}
                    className="h-touch min-w-touch px-3 rounded-xl bg-mipiace-stone text-mipiace-ink inline-flex items-center justify-center shrink-0"
                  >
                    <FileText className="w-[18px] h-[18px]" />
                  </button>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {error && (
        <div className="mt-3">
          <Mal>{error}</Mal>
        </div>
      )}
    </div>
  );
}
