// historia-1 (D-94, D-95, D-97) · **EL INGRESO GUIADO DE UN RESIDENTE.**
//
// Hoy lo que falta de un ingreso se descubre cuando lo pide un inspector
// (R20). Esta pantalla es la lista, y lo que la hace distinta de una
// lista de tareas cualquiera es que **la mitad de los elementos no se
// marcan: se comprueban**.
//
// ── LAS DOS FORMAS DE ESTAR HECHO, Y LA PANTALLA LAS DISTINGUE ─────
//
// Un elemento `auto` —la cama, la dieta, el plan, las alergias
// revisadas— sale hecho cuando el dato existe, **y dice por qué**: «Tiene
// cama asignada», «Falta el DNI o el NSS». Eso es la mitad del valor:
// «pendiente» a secas no dice dónde se arregla.
//
// Y no tiene casilla. Pedirle a la dirección que marque «cama asignada»
// cuando la cama ya está en la base es pedirle que copie un dato que el
// sistema tiene — y entonces la lista miente el día que alguien marca sin
// haberlo hecho. El motor lo impide (CHECK
// `admission_checklist_items_hecho_completo`).
//
// ── Y LOS DOS SIN PANTALLA TODAVÍA ─────────────────────────────────
//
// «Escalas iniciales» (historia-3) y «PAI inicial» (historia-2) salen con
// su fecha límite y **sin sitio donde hacerlos**. La pantalla lo dice con
// esas palabras en vez de esconderlos: el plazo de 30 días del PAI corre
// desde el ingreso, y esconderlo sería empezar a contar tarde.

import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Check, Clock, FileUp, Lock } from "lucide-react";

import { AdminShell } from "../../AdminShell.js";
import { api, ApiError } from "../../api.js";
import {
  CenteredLoader,
  FieldError,
  OutlineButton,
  PrimaryButton,
  TextField,
} from "../../ui.js";
import { fechaLarga, type IngresoDeUnResidente } from "./ficha-lib.js";

/** Los dos que historia-2 y historia-3 van a dar. La pantalla lo dice. */
const SIN_PANTALLA_TODAVIA = new Set(["ESCALAS_INICIALES", "PAI_INICIAL"]);

/** Un consentimiento del ingreso, de la vista de clinica-4. */
interface PlantillaDelIngreso {
  id: string;
  titulo: string;
  pendienteDeValidar: boolean;
  vigente: { id: string; firmadoEn: string } | null;
}

export function IngresoResidentePage() {
  const { clientId } = useParams<{ clientId: string }>();
  const [ingreso, setIngreso] = useState<IngresoDeUnResidente | null>(null);
  const [sinLista, setSinLista] = useState(false);
  const [plantillas, setPlantillas] = useState<PlantillaDelIngreso[]>([]);
  const [error, setError] = useState<string | null>(null);
  /** Qué plantilla está abierta para firmar. `null` = ninguna. */
  const [firmando, setFirmando] = useState<string | null>(null);
  const fichero = useRef<HTMLInputElement>(null);

  const recargar = useCallback(async () => {
    try {
      const [r, c] = await Promise.all([
        api<{ ingreso: IngresoDeUnResidente | null; sinLista: boolean }>(
          `/residencia/residentes/${clientId}/ingreso`,
        ),
        api<{ plantillas: PlantillaDelIngreso[] }>(
          `/residencia/residentes/${clientId}/consentimientos`,
        ),
      ]);
      setIngreso(r.ingreso);
      setSinLista(r.sinLista);
      setPlantillas(c.plantillas);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Error inesperado");
    }
  }, [clientId]);

  useEffect(() => {
    void recargar();
  }, [recargar]);

  if (!ingreso && !sinLista && error == null) {
    return <CenteredLoader label="Cargando el ingreso…" />;
  }

  async function llamar(ruta: string, body?: unknown) {
    try {
      await api(`/residencia/residentes/${clientId}${ruta}`, {
        method: "POST",
        ...(body === undefined ? {} : { body }),
      });
      setError(null);
      await recargar();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Error inesperado");
    }
  }

  /** El contrato, en base64 por el cuerpo — igual que la foto del
   *  residente y la evidencia de una obligación. */
  async function subirContrato(f: File) {
    try {
      const buf = await f.arrayBuffer();
      let bin = "";
      const bytes = new Uint8Array(buf);
      for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]!);
      await api(`/residencia/residentes/${clientId}/ingreso/contrato`, {
        method: "PUT",
        body: { pdfBase64: btoa(bin) },
      });
      setError(null);
      await recargar();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Error inesperado");
    }
  }

  return (
    <AdminShell title="Ingreso guiado">
      <Link
        to={`/admin/residencia/residentes/${clientId}/ficha`}
        className="mb-4 inline-block text-[13.5px] text-slate-500 hover:underline"
      >
        ← Volver a la ficha clínica
      </Link>

      {error && <FieldError message={error} />}

      {sinLista && (
        <div className="mb-6 rounded-2xl border border-amber-300 bg-amber-50 px-5 py-4 text-[13.5px] text-amber-900">
          <p>
            <strong>Esta persona ingresó antes de que la lista existiera.</strong>{" "}
            No se le ha inventado ninguna: los plazos se cuentan desde el
            ingreso, y uno inventado nacería vencido.
          </p>
          <p className="mt-2">
            Si la creas ahora, los dos elementos con plazo —las escalas y el
            PAI— cuentan <strong>desde hoy</strong>.
          </p>
          <div className="mt-3">
            <PrimaryButton onClick={() => void llamar("/ingreso")}>
              Crear la lista
            </PrimaryButton>
          </div>
        </div>
      )}

      {ingreso && (
        <>
          <p className="-mt-1 mb-5 text-[13.5px] text-slate-500">
            Ingresó el {fechaLarga(ingreso.ingreso)} ·{" "}
            {ingreso.pendientes === 0
              ? "expediente completo"
              : `${ingreso.pendientes} sin cerrar`}
            {ingreso.vencidos > 0 ? ` · ${ingreso.vencidos} con el plazo pasado` : ""}
          </p>

          <ul className="space-y-2">
            {ingreso.elementos.map((e) => (
              <li
                key={e.code}
                className={`rounded-xl border px-4 py-3 text-[13.5px] ${
                  e.hecho
                    ? "border-emerald-200 bg-emerald-50"
                    : e.vencido
                      ? "border-rose-300 bg-rose-50"
                      : "border-slate-200 bg-white"
                }`}
              >
                <div className="flex flex-wrap items-baseline gap-2">
                  {e.hecho ? (
                    <Check className="h-4 w-4 shrink-0 text-emerald-700" />
                  ) : e.vencido ? (
                    <Clock className="h-4 w-4 shrink-0 text-rose-700" />
                  ) : (
                    <span className="h-4 w-4 shrink-0 rounded-full border border-slate-300" />
                  )}
                  <span className="font-medium">{e.nombre}</span>
                  {e.auto && (
                    <span className="flex items-center gap-1 rounded-md bg-slate-100 px-2 py-0.5 text-[12.5px] text-slate-600">
                      <Lock className="h-3 w-3" /> se comprueba solo
                    </span>
                  )}
                  {e.dueOn && (
                    <span
                      className={`rounded-md px-2 py-0.5 text-[12.5px] ${
                        e.vencido
                          ? "bg-rose-100 text-rose-900"
                          : "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {e.vencido ? "venció" : "antes del"} {fechaLarga(e.dueOn)}
                    </span>
                  )}
                  {/* Sólo lo de MARCAR A MANO tiene botón. Lo `auto` no:
                      ver la cabecera. */}
                  {!e.auto && !e.hecho && (
                    <button
                      type="button"
                      onClick={() => {
                        const nota = window.prompt(
                          "Nota (opcional). Queda con tu nombre y la hora.",
                        );
                        void llamar(`/ingreso/${e.code}/hecho`, {
                          ...(nota?.trim() ? { nota: nota.trim() } : {}),
                        });
                      }}
                      className="ml-auto text-[13px] text-slate-600 underline"
                    >
                      Marcar hecho
                    </button>
                  )}
                </div>

                {/* **El porqué de un `auto`**: «Falta el DNI o el NSS» se
                    arregla; «pendiente» no se sabe dónde. */}
                {e.porque && (
                  <p className="mt-1 text-slate-600">{e.porque}</p>
                )}
                {e.nota && <p className="mt-1 text-slate-600">{e.nota}</p>}
                {e.hechoEn && (
                  <p className="mt-1 text-[13px] text-slate-500">
                    Lo marcó {e.hechoPor} ({e.hechoComo}) el{" "}
                    {fechaLarga(e.hechoEn)}
                  </p>
                )}
                {SIN_PANTALLA_TODAVIA.has(e.code) && (
                  <p className="mt-1 text-[13px] text-slate-500">
                    Todavía no hay pantalla donde hacerlo: llega con el
                    bloque siguiente. El plazo ya corre, y por eso está aquí.
                  </p>
                )}

                {/* ── EL CONTRATO FIRMADO, EN PDF ──────────────────── */}
                {e.adjunto && (
                  <div className="mt-2 flex flex-wrap items-center gap-3">
                    <input
                      ref={fichero}
                      type="file"
                      accept="application/pdf"
                      className="hidden"
                      onChange={(ev) => {
                        const f = ev.target.files?.[0];
                        if (f) void subirContrato(f);
                        ev.target.value = "";
                      }}
                    />
                    <OutlineButton onClick={() => fichero.current?.click()}>
                      <span className="flex items-center gap-1">
                        <FileUp className="h-3.5 w-3.5" />
                        {e.tieneFichero ? "Cambiar el PDF" : "Adjuntar el PDF"}
                      </span>
                    </OutlineButton>
                    {e.tieneFichero && (
                      <a
                        href={`/api/residencia/residentes/${clientId}/ingreso/contrato`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[13px] text-slate-600 underline"
                      >
                        Ver el contrato
                      </a>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </>
      )}

      {/* ── LOS CONSENTIMIENTOS DEL INGRESO (D-95) ───────────────── */}
      <section className="mt-7">
        <h2 className="mb-2 text-[16px] font-semibold">
          Consentimientos del ingreso
        </h2>
        <p className="mb-3 text-[13px] text-slate-500">
          Se firman con el dedo y quedan en PDF, como los de la clínica. Los
          informa quien hace el ingreso: no hace falta que sea sanitario.
        </p>
        {plantillas.length === 0 ? (
          <p className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-[13.5px] text-slate-500">
            No hay plantillas de ingreso en este despliegue.
          </p>
        ) : (
          <ul className="space-y-2">
            {plantillas.map((p) => (
              <li
                key={p.id}
                className={`rounded-xl border px-4 py-3 text-[13.5px] ${
                  p.vigente
                    ? "border-emerald-200 bg-emerald-50"
                    : "border-slate-200 bg-white"
                }`}
              >
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="font-medium">{p.titulo}</span>
                  {p.vigente ? (
                    <span className="rounded-md bg-emerald-100 px-2 py-0.5 text-[12.5px] text-emerald-900">
                      firmado el {fechaLarga(p.vigente.firmadoEn)}
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() =>
                        setFirmando(firmando === p.id ? null : p.id)
                      }
                      className="ml-auto text-[13px] text-slate-600 underline"
                    >
                      {firmando === p.id ? "Cerrar" : "Leer y firmar"}
                    </button>
                  )}
                </div>
                {p.pendienteDeValidar && (
                  <p className="mt-1 text-[13px] text-amber-800">
                    Texto de ejemplo del programa, pendiente de revisar por un
                    jurista del centro.
                  </p>
                )}
                {firmando === p.id && (
                  <CajaDeFirma
                    plantillaId={p.id}
                    clientId={clientId!}
                    onFirmado={() => {
                      setFirmando(null);
                      void recargar();
                    }}
                    onError={setError}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </AdminShell>
  );
}

// ── historia-1 (D-95) · **LA FIRMA CON EL DEDO, EN EL ADMIN** ────────
//
// El mecanismo es el de clinica-4 sin tocar una línea: se manda el PNG
// del trazo a `POST /clinica/clients/:id/consentimientos` y el servidor
// pinta el PDF, lo guarda cifrado en el volumen clínico y escribe la fila
// con la plantilla, su versión y las dos huellas congeladas.
//
// ── Por qué el pad está AQUÍ y no en una tablet ────────────────────
//
// Porque el ingreso de un residente **se hace en el despacho** (D-97),
// con la familia delante y el contrato encima de la mesa: no hay una
// tablet de pasillo en esa conversación. La pantalla de la clínica
// (`tpv-web/src/clinica/Consentimientos.tsx`) vive dentro de una sesión
// de podología, que es otro flujo entero.
//
// Y «con el dedo» sigue siendo verdad: son eventos `pointer*`, no
// `touch*`, así que el mismo código recoge el dedo cuando el admin se
// abre en una tablet y el ratón cuando se abre en el portátil — que es,
// además, lo que permite recorrer esta pantalla en el bucle visual sin un
// dedo de verdad.
//
// El canvas se dimensiona al tamaño REAL en píxeles (`devicePixelRatio`)
// y el fondo se pinta BLANCO y no transparente, por lo mismo que en la
// clínica: lo que se incrusta en el PDF es esta imagen, y un trazo oscuro
// sobre transparente sale bien hasta que alguien lo abre en un visor con
// fondo oscuro.
function CajaDeFirma({
  plantillaId,
  clientId,
  onFirmado,
  onError,
}: {
  plantillaId: string;
  clientId: string;
  onFirmado: () => void;
  onError: (m: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const dibujando = useRef(false);
  const [hayTrazo, setHayTrazo] = useState(false);
  const [clase, setClase] = useState<"PACIENTE" | "REPRESENTANTE">("PACIENTE");
  const [nombre, setNombre] = useState("");
  const [relacion, setRelacion] = useState("");
  const [enviando, setEnviando] = useState(false);

  const prepararCanvas = useCallback(() => {
    const c = canvasRef.current;
    if (!c) return;
    const r = c.getBoundingClientRect();
    const escala = Math.min(window.devicePixelRatio || 1, 3);
    c.width = Math.round(r.width * escala);
    c.height = Math.round(r.height * escala);
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.scale(escala, escala);
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#1F2937";
  }, []);

  useEffect(() => {
    prepararCanvas();
  }, [prepararCanvas]);

  function pos(e: React.PointerEvent<HTMLCanvasElement>) {
    const c = canvasRef.current!;
    const b = c.getBoundingClientRect();
    return { x: e.clientX - b.left, y: e.clientY - b.top };
  }

  async function firmar() {
    const c = canvasRef.current;
    if (!c) return;
    setEnviando(true);
    try {
      const png = c.toDataURL("image/png").split(",")[1] ?? "";
      await api(`/clinica/clients/${clientId}/consentimientos`, {
        method: "POST",
        body: {
          plantillaId,
          firmante: {
            clase,
            nombre: clase === "REPRESENTANTE" ? nombre.trim() : null,
            relacion: clase === "REPRESENTANTE" ? relacion.trim() : null,
          },
          firmaPngBase64: png,
        },
      });
      onFirmado();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "Error inesperado");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="mt-3 flex flex-col gap-3 rounded-xl border border-slate-300 bg-white px-4 py-4">
      <div className="flex flex-wrap gap-4">
        <label className="flex flex-col gap-1 text-[13px] font-medium text-slate-600">
          Quién firma
          <select
            value={clase}
            onChange={(e) =>
              setClase(e.target.value as "PACIENTE" | "REPRESENTANTE")
            }
            className="rounded-lg border border-slate-300 px-3 py-2 text-[14px] text-slate-900"
          >
            <option value="PACIENTE">El residente</option>
            <option value="REPRESENTANTE">Su representante</option>
          </select>
        </label>
        {/* El nombre y la relación **sólo con representante**: con el
            residente firmando, su nombre ya está en la ficha, y una fila
            que dice las dos cosas a la vez se leería mal dentro de cinco
            años (`firmanteCompleto` lo rechaza). */}
        {clase === "REPRESENTANTE" && (
          <>
            <TextField
              id="firmante-nombre"
              label="Nombre de quien firma"
              value={nombre}
              onChange={setNombre}
            />
            <TextField
              id="firmante-relacion"
              label="Qué es del residente"
              value={relacion}
              onChange={setRelacion}
              placeholder="hija, hijo, tutor legal…"
            />
          </>
        )}
      </div>
      <div className="relative touch-none rounded-2xl border-2 border-dashed border-slate-300 bg-white">
        <canvas
          ref={canvasRef}
          data-test="caja-de-firma"
          className="block h-[180px] w-full rounded-2xl"
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
          <span className="pointer-events-none absolute bottom-3 left-4 text-[13px] text-slate-500">
            Firme aquí
          </span>
        )}
      </div>
      <div className="flex flex-wrap gap-3">
        <PrimaryButton
          disabled={!hayTrazo || enviando}
          onClick={() => void firmar()}
        >
          {enviando ? "Guardando…" : "Firmar"}
        </PrimaryButton>
        <OutlineButton
          onClick={() => {
            prepararCanvas();
            setHayTrazo(false);
          }}
        >
          Borrar el trazo
        </OutlineButton>
      </div>
    </div>
  );
}
