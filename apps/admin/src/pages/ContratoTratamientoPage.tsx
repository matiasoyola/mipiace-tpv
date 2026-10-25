// clinica-7 · «Contrato de tratamiento de datos», en el panel.
//
// Decisión 6: la sección del propietario con la versión vigente, cuándo y
// quién la aceptó, el PDF de cada versión aceptada (para descargar
// siempre) y el botón «Revocar» con una confirmación que explica las
// consecuencias.
//
// ── Por qué vive aquí y no solo en el TPV ───────────────────────────
//
// Porque el TPV es un punto de venta y no tiene pantalla de ajustes: lo
// que la dueña hace en la tablet es trabajar. El contrato de encargado se
// lee con calma, se descarga en PDF y se le manda a un abogado — eso se
// hace en el panel, sentada, con el ordenador.
//
// En el TPV sí están las dos caras que hacen falta con la paciente
// delante: la pantalla de aceptación (si falta aceptarlo, la historia no se
// abre sin ella) y la banda de solo lectura. Ésas viven en
// `apps/tpv-web/src/clinica/ContratoDeTratamiento.tsx`.
//
// ── Y la lógica NO se duplica ───────────────────────────────────────
//
// El estado lo calcula `@mipiacetpv/contrato-encargado` —la MISMA función
// pura que usa la API y que usa el TPV— y los textos vienen de ahí. Lo que
// esta pantalla tiene propio es el HTML: dos apps que no comparten paquete
// de UI pintan distinto, y eso está bien. Lo que no puede haber es dos
// reglas sobre cuándo un contrato está vigente, y no las hay.
//
// ── contrato-lectura-completa · NO SE ACEPTA SIN RECORRER EL TEXTO ──
//
// Antes el texto completo iba PLEGADO detrás de «Leer el contrato
// completo», y se podía marcar la casilla y pulsar «Acepto» sin haberlo
// abierto. Ahora el texto está desplegado en un recuadro con su propio
// scroll, y la casilla y el botón **no se activan hasta que el final del
// texto ha pasado por la pantalla**.
//
// ¿Y qué?: el día que alguien diga «yo eso no lo leí», la fila guardada
// dice que el texto completo se mostró y se recorrió hasta el final antes
// de aceptar, con su huella, quién, cuándo y desde dónde.
//
// La mitad que vale es la de la API (`aceptarContrato` da 400 sin
// `textoMostradoCompleto`): ésta es la que se ve. Las dos, porque una
// regla que sólo vive en el navegador la salta un `curl`, y una que sólo
// vive en el servidor deja un botón que da error.
//
// ── Sin `CajaGate` ──────────────────────────────────────────────────
//
// Como la declaración responsable: esto no depende de que el comercio haya
// comprado la caja. Lo que decide si la sección existe es la capability de
// la historia clínica, y eso lo contesta la API con un 404 — y entonces la
// pantalla dice que el módulo no está, que es la verdad.

import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  Check,
  Download,
  Lock,
  ShieldCheck,
} from "lucide-react";

import type { EstadoDelModuloClinico } from "@mipiacetpv/contrato-encargado";

import { AdminShell } from "../AdminShell.js";
import { ApiError, api, apiBlob } from "../api.js";
import { useTenantCapabilities } from "../capabilities.js";
import { CenteredLoader, FieldError } from "../ui.js";

interface Aceptacion {
  id: string;
  version: number;
  huella: string;
  aceptadoEn: string;
  quien: string;
  aparato: string | null;
  revocado: boolean;
  revocadoEn: string | null;
  revocadoPor: string | null;
  textoDisponible: boolean;
  /** contrato-lectura-completa · cuándo llegó el final del texto a la
   *  pantalla antes de aceptar. `null` en las aceptaciones anteriores a la
   *  regla: no se midió, y entonces la pantalla no afirma nada. */
  textoRecorridoEn: string | null;
}

interface Vista {
  estado: EstadoDelModuloClinico;
  versionVigente: number;
  pendienteDeValidar: boolean;
  titulo: string;
  apartados: { encabezado: string; parrafos: string[] }[];
  huellaVigente: string;
  aceptaciones: Aceptacion[];
  puedeAceptar: boolean;
}

const fecha = (iso: string) =>
  new Date(iso).toLocaleString("es-ES", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

// primer-acceso (punto 3) · LAS TRES LÍNEAS EN LENGUAJE LLANO.
//
// Encima del texto legal, y sólo cuando falta aceptarlo. La directora de
// una residencia no tiene por qué saber qué es un contrato de encargado:
// lo que necesita leer, en el orden en que se lo preguntaría, es qué es,
// qué se compromete Mi Piace a hacer y que esto no desaparece — se puede
// descargar cuando quiera.
//
// Están aquí arriba y no dentro del JSX porque son el contenido de la
// pantalla, no su maquetación: cambiarlas es una decisión de producto.
const LAS_TRES_LINEAS = [
  "Es el permiso para que Mi Piace guarde en su programa la información de salud de las personas que atiendes. Lo exige la ley (art. 28 del RGPD) y lo acepta la propietaria del centro.",
  "Mi Piace se compromete a guardarla cifrada, a no mirarla, a no usarla para nada más y a devolvértela y destruirla cuando dejes de usar el programa.",
  "Puedes descargar el contrato en PDF cuando quieras, también más adelante: queda guardado con la fecha y el nombre de quien lo aceptó.",
];

/**
 * contrato-lectura-completa · ¿ha pasado el FINAL del texto por la
 * pantalla? Y cuándo.
 *
 * ── Un centinela, no una cuenta de píxeles ──────────────────────────
 *
 * Decisión 2 del bloque, y la razón es que los píxeles mienten: con
 * `scrollTop + clientHeight >= scrollHeight` hay que elegir un margen de
 * tolerancia, y ese margen se come la última línea en un zoom del 110 %,
 * o no llega nunca con un `scrollHeight` fraccionario. Un `<div>` de un
 * píxel al final del texto y un `IntersectionObserver` con el recuadro
 * como `root` contestan la pregunta de verdad: **¿se ha visto el final?**
 *
 * Y de paso sale gratis el caso de la pantalla grande: si el texto cabe
 * entero sin scroll, el centinela ya está visible y el observador avisa
 * en cuanto se le pide — así que «cabe» cuenta como «visto», sin un `if`
 * que lo diga.
 *
 * ── Un navegador sin `IntersectionObserver` cuenta como visto ───────
 *
 * Al revés de lo que parece prudente, y a propósito: con el observador
 * caído la casilla no se activaría NUNCA y la dueña no podría aceptar el
 * contrato — o sea, no podría usar la historia clínica. Lo que hay al otro
 * lado de esta puerta no es un cobro, pero es la misma dirección de fallo
 * que el resto de la casa: una comprobación que no se puede hacer no
 * bloquea el trabajo. La API sigue exigiendo el campo, y lo que se pierde
 * es la garantía de que el texto pasó por delante — en un navegador que
 * ninguna tablet ni ningún portátil de 2026 tiene.
 *
 * El instante se guarda una vez y no se vuelve a mirar: «cuándo llegó al
 * final» es la PRIMERA vez, no la última.
 */
function useFinalDelTexto(): {
  verCaja: (el: HTMLElement | null) => void;
  verCentinela: (el: HTMLElement | null) => void;
  finalVisto: Date | null;
} {
  const [caja, setCaja] = useState<HTMLElement | null>(null);
  const [centinela, setCentinela] = useState<HTMLElement | null>(null);
  const [finalVisto, setFinalVisto] = useState<Date | null>(null);

  useEffect(() => {
    if (finalVisto != null) return;
    if (caja == null || centinela == null) return;
    if (typeof IntersectionObserver !== "function") {
      setFinalVisto(new Date());
      return;
    }
    const observador = new IntersectionObserver(
      (entradas) => {
        if (entradas.some((e) => e.isIntersecting)) setFinalVisto(new Date());
      },
      { root: caja, threshold: 0 },
    );
    observador.observe(centinela);
    return () => observador.disconnect();
  }, [caja, centinela, finalVisto]);

  return { verCaja: setCaja, verCentinela: setCentinela, finalVisto };
}

export function ContratoTratamientoPage() {
  const navigate = useNavigate();
  const [vista, setVista] = useState<Vista | null>(null);
  const [sinModulo, setSinModulo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [accion, setAccion] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState(false);
  const [trabajando, setTrabajando] = useState(false);
  const [leido, setLeido] = useState(false);
  const { verCaja, verCentinela, finalVisto } = useFinalDelTexto();

  // punto 7 del bloque · LA PALABRA DEL CENTRO.
  //
  // «Pacientes» en una clínica, «residentes» en una residencia. Es lo que
  // la directora de Jardín de Gredos leyó el 24-10-2026 en la primera
  // pantalla del programa: «la historia clínica de tus pacientes», en un
  // centro donde no hay ninguno.
  //
  // **Sólo en pantalla.** `vista.apartados` es el texto jurídico
  // versionado y viene del paquete tal cual: cambiarlo sería una versión
  // nueva del contrato y otra aceptación (ver el -done).
  //
  // `null` mientras no se sabe se lee como «no es residencia», igual que
  // el resto de quien gatea con esto: la palabra de hoy en los quince
  // clientes es «paciente».
  const capacidades = useTenantCapabilities();
  const esResidencia = capacidades?.residencia === true;
  const PERSONA = esResidencia ? "residente" : "paciente";
  const PERSONAS = esResidencia ? "residentes" : "pacientes";

  const cargar = useCallback(() => {
    api<Vista>("/clinica/contrato")
      .then((v) => {
        setVista(v);
        setSinModulo(false);
        setError(null);
      })
      .catch((err: unknown) => {
        // 404 = este negocio no tiene el módulo clínico. No es un error:
        // es que la sección no aplica, y se dice.
        if (err instanceof ApiError && err.status === 404) {
          setSinModulo(true);
          return;
        }
        setError(
          "No se ha podido cargar el contrato de tratamiento de datos. " +
            "Recarga la página; si sigue, avisa a Mi Piace.",
        );
      });
  }, []);

  useEffect(cargar, [cargar]);

  async function aceptar() {
    setTrabajando(true);
    setAccion(null);
    try {
      await api("/clinica/contrato/aceptar", {
        method: "POST",
        // contrato-lectura-completa · lo que la pantalla AFIRMA, y lo que
        // la API exige. Si `finalVisto` fuera `null` el botón estaría
        // desactivado y no habríamos llegado aquí; mandarlo igualmente
        // como lo que hay deja que el 400 del servidor sea la red de
        // seguridad en vez de una mentira del cliente.
        body: {
          textoMostradoCompleto: finalVisto != null,
          finalDelTextoEn: finalVisto?.toISOString(),
        },
      });
      setLeido(false);
      // primer-acceso · **sigue sola a la pantalla de inicio.**
      //
      // Aceptar es lo que hace que la clínica funcione, así que lo
      // siguiente es trabajar — no quedarse mirando la pantalla del
      // contrato con un «vigente» en verde. `/` decide el destino según
      // los módulos, que es donde esa decisión vive.
      //
      // La aceptación queda escrita y la pantalla sigue en el menú: quien
      // quiera el PDF o revocar vuelve cuando quiera.
      navigate("/", { replace: true });
    } catch (err) {
      setAccion(
        err instanceof ApiError && err.message
          ? err.message
          : "No se ha podido aceptar. Reintenta; si sigue, avisa a Mi Piace.",
      );
    } finally {
      setTrabajando(false);
    }
  }

  async function revocar() {
    setTrabajando(true);
    setAccion(null);
    try {
      await api("/clinica/contrato/revocar", { method: "POST" });
      setConfirmando(false);
      cargar();
    } catch (err) {
      setAccion(
        err instanceof ApiError && err.message
          ? err.message
          : "No se ha podido revocar. Reintenta; si sigue, avisa a Mi Piace.",
      );
    } finally {
      setTrabajando(false);
    }
  }

  async function abrirPdf(version: number) {
    setAccion(null);
    try {
      const blob = await apiBlob(`/clinica/contrato/${version}.pdf`);
      window.open(URL.createObjectURL(blob), "_blank", "noopener,noreferrer");
    } catch {
      setAccion("No se ha podido abrir el PDF. Reintenta más tarde.");
    }
  }

  async function exportar() {
    setAccion(null);
    try {
      const blob = await apiBlob("/clinica/exportacion");
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `historias-${new Date().toISOString().slice(0, 10)}.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setAccion(
        err instanceof ApiError && err.message
          ? err.message
          : "No se ha podido preparar el paquete. Avisa a Mi Piace.",
      );
    }
  }

  if (sinModulo) {
    return (
      <AdminShell title="Contrato de tratamiento de datos">
        <p className="text-[13.5px] text-slate-600 leading-relaxed">
          Este negocio no tiene el módulo de historia clínica. Si lo
          necesitas, pídelo a Mi Piace.
        </p>
      </AdminShell>
    );
  }
  if (error) {
    return (
      <AdminShell title="Contrato de tratamiento de datos">
        <FieldError message={error} />
      </AdminShell>
    );
  }
  if (!vista) {
    return (
      <AdminShell title="Contrato de tratamiento de datos">
        <CenteredLoader label="Cargando el contrato…" />
      </AdminShell>
    );
  }

  const vigente = vista.estado.estado === "VIGENTE";
  const sinAceptar = vista.estado.estado === "SIN_CONTRATO";
  /** ¿Ha pasado el final del texto por la pantalla? Lo que abre la
   *  casilla y el botón. */
  const recorrido = finalVisto != null;

  return (
    <AdminShell title="Contrato de tratamiento de datos">
      <div className="max-w-[760px] space-y-5" data-test="contrato-seccion">
        <p className="text-[13.5px] text-slate-600 leading-relaxed">
          Es el contrato por el que Mi Piace puede guardar la historia
          clínica de tus {PERSONAS} (art. 28 del RGPD). Lo acepta la dueña
          del centro, y mientras no esté aceptado la historia clínica no se
          puede usar.
        </p>

        {/* ── El estado, de un vistazo ────────────────────────────── */}
        <div
          data-test="contrato-estado"
          className={`flex items-start gap-2.5 rounded-xl border px-3.5 py-3 text-[13.5px] leading-relaxed ${
            vigente
              ? "border-emerald-200 bg-emerald-50 text-emerald-900"
              : "border-amber-200 bg-amber-50 text-amber-900"
          }`}
        >
          {vigente ? (
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          ) : (
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          )}
          <span>
            {vista.estado.estado === "VIGENTE" && (
              <>
                <strong className="font-semibold">Vigente</strong> — versión{" "}
                {vista.estado.versionAceptada}. La historia clínica funciona
                con normalidad.
              </>
            )}
            {vista.estado.estado === "SIN_CONTRATO" && (
              <>
                <strong className="font-semibold">Sin aceptar.</strong> Hasta
                que lo aceptes, la historia clínica no se puede ni leer ni
                escribir.
              </>
            )}
            {vista.estado.estado === "SOLO_LECTURA" && (
              <>
                <strong className="font-semibold">Solo lectura</strong> —{" "}
                {vista.estado.motivo === "REVOCADO"
                  ? "está revocado"
                  : "hay una versión nueva sin aceptar"}
                . Se puede leer, imprimir y exportar todo lo que ya hay; no
                se puede escribir nada nuevo. Las citas nuevas no admiten
                notas escritas a mano.
              </>
            )}
            {vista.estado.estado === "APAGADO" && (
              <strong className="font-semibold">Módulo apagado.</strong>
            )}
          </span>
        </div>

        <FieldError message={accion} />

        {/* ── El texto, y el botón si falta aceptarlo ─────────────── */}
        {(sinAceptar || vista.estado.estado === "SOLO_LECTURA") &&
          vista.puedeAceptar && (
            <section className="rounded-xl border border-slate-200 bg-white p-4">
              {/* primer-acceso · las tres líneas, PRIMERO. El texto legal
                  completo está debajo y plegado: quien quiera leerlo lo
                  abre, y quien no, ya ha leído lo que importa. */}
              <ul className="mb-4 space-y-2.5" data-test="contrato-en-llano">
                {LAS_TRES_LINEAS.map((linea) => (
                  <li
                    key={linea}
                    className="text-[13.5px] leading-relaxed text-mipiace-ink"
                  >
                    {linea}
                  </li>
                ))}
              </ul>
              <h2 className="text-[14px] font-semibold text-mipiace-ink">
                {vista.titulo}
              </h2>
              <p className="mt-0.5 text-[12.5px] text-slate-500">
                Versión {vista.versionVigente}
              </p>

              {vista.pendienteDeValidar && (
                <div className="mt-3 flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-[13px] leading-relaxed text-amber-900">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                  <span>
                    <strong className="font-semibold">
                      Este texto es de ejemplo y está pendiente de que lo
                      revise un abogado.
                    </strong>{" "}
                    Puedes aceptarlo para empezar a usar la historia clínica;
                    cuando llegue el definitivo te pediremos aceptar la
                    versión nueva.
                  </span>
                </div>
              )}

              {/* contrato-lectura-completa · EL TEXTO, DESPLEGADO.
                  Antes esto era un `<details>` plegado y se podía aceptar
                  sin abrirlo. Ahora está a la vista en un recuadro con su
                  propio scroll, y el `max-h` es lo que deja la casilla y
                  el botón por encima del pliegue sin bajar la página.

                  `tabIndex={0}` y `role="region"`: con el foco dentro, las
                  flechas y AvPág lo recorren. Sin el `tabIndex` un
                  recuadro con scroll no se puede recorrer con el teclado —
                  y entonces quien no usa ratón no podría aceptar nunca el
                  contrato. */}
              <div
                ref={verCaja}
                tabIndex={0}
                role="region"
                aria-label={`${vista.titulo}, texto completo`}
                data-test="contrato-texto"
                className="mt-4 max-h-[46vh] space-y-4 overflow-y-auto rounded-lg border border-slate-200 px-3.5 py-3.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-mipiace-ink/40 md:max-h-[400px]"
              >
                {vista.apartados.map((a) => (
                  <div key={a.encabezado}>
                    <h3 className="text-[13px] font-semibold leading-snug text-mipiace-ink">
                      {a.encabezado}
                    </h3>
                    <div className="mt-1.5 space-y-2">
                      {a.parrafos.map((p, i) => (
                        <p
                          key={i}
                          className="text-[13px] leading-relaxed text-slate-700"
                        >
                          {p}
                        </p>
                      ))}
                    </div>
                  </div>
                ))}
                {/* EL CENTINELA. Un píxel al final del texto: cuando
                    entra en el recuadro, el final se ha visto. Ver
                    `useFinalDelTexto`. `aria-hidden` porque no es
                    contenido — es una marca. */}
                <div
                  ref={verCentinela}
                  data-test="contrato-final-del-texto"
                  aria-hidden
                  className="h-px"
                />
              </div>

              <p className="mt-3 break-all text-[11.5px] text-slate-400">
                Huella del texto (SHA-256): {vista.huellaVigente}
              </p>

              {/* Decisión 4 · el PDF de la versión PENDIENTE, antes de
                  aceptar y junto al recuadro. Es lo que se le manda a un
                  abogado, y pedírselo después de aceptar llega tarde. */}
              <button
                type="button"
                onClick={() => void abrirPdf(vista.versionVigente)}
                data-test="contrato-pdf-pendiente"
                className="mt-3 inline-flex min-h-[36px] items-center gap-2 rounded-lg border border-slate-200 px-3 text-[13px] font-medium text-mipiace-ink"
              >
                <Download className="h-4 w-4" aria-hidden />
                Descargar el PDF
              </button>

              {/* La casilla y «Acepto», DESACTIVADOS hasta que el final
                  del texto ha pasado por la pantalla. Las dos y no sólo el
                  botón: una casilla que se puede marcar delante de un
                  botón que no se puede pulsar es una pantalla que no se
                  entiende. */}
              <label
                className={`mt-4 flex items-start gap-2.5 text-[13.5px] leading-relaxed ${
                  recorrido
                    ? "cursor-pointer text-mipiace-ink"
                    : "cursor-not-allowed text-slate-400"
                }`}
              >
                <input
                  type="checkbox"
                  checked={leido}
                  disabled={!recorrido}
                  onChange={(e) => setLeido(e.target.checked)}
                  data-test="contrato-casilla"
                  className="mt-0.5 h-4 w-4 shrink-0 accent-mipiace-ink"
                />
                He leído el contrato y lo acepto en nombre del centro.
              </label>

              <button
                type="button"
                disabled={!recorrido || !leido || trabajando}
                onClick={() => void aceptar()}
                data-test="contrato-aceptar"
                className="mt-4 inline-flex min-h-[40px] items-center gap-2 rounded-lg bg-mipiace-ink px-4 text-[13.5px] font-semibold text-white disabled:opacity-40"
              >
                <Check className="h-4 w-4" aria-hidden />
                Acepto
              </button>

              {/* Decisión 2 y decisión 5, en un solo elemento: el aviso de
                  debajo del botón Y el anuncio al lector de pantalla.
                  Está montado desde el primer render y lo que cambia es su
                  texto — una región `aria-live` que NACE con el mensaje
                  dentro no se anuncia en varios lectores, y entonces el
                  «ya puedes aceptarlo» no se oiría. */}
              <p
                role="status"
                aria-live="polite"
                data-test="contrato-aviso-recorrer"
                className={`mt-2 text-[12.5px] font-medium leading-relaxed ${
                  recorrido ? "text-emerald-700" : "text-amber-800"
                }`}
              >
                {recorrido
                  ? "Has llegado al final del contrato: ya puedes aceptarlo."
                  : "Baja hasta el final del contrato para poder aceptarlo."}
              </p>

              <p className="mt-2.5 text-[12.5px] leading-relaxed text-slate-500">
                Al aceptar queda registrado quién lo acepta, cuándo y desde
                dónde, y que el texto completo se mostró y se recorrió hasta
                el final. Esa anotación no se puede editar ni borrar.
              </p>
            </section>
          )}

        {/* primer-acceso · quien entra y NO es la propietaria aterriza
            aquí por la redirección de `/`, así que la frase tiene que
            servir de pantalla de llegada y no sólo de aviso al pie: dice
            qué falta, quién lo hace y qué puede hacer él mientras. Sin
            botones que no puede usar. */}
        {!vista.puedeAceptar &&
          (sinAceptar || vista.estado.estado === "SOLO_LECTURA") && (
            <div
              data-test="contrato-no-es-tuyo"
              className="flex items-start gap-2.5 rounded-xl border border-slate-200 bg-white px-3.5 py-3 text-[13.5px] leading-relaxed text-slate-700"
            >
              <Lock className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden />
              <span>
                Antes de empezar, la propietaria del centro tiene que aceptar
                el contrato de datos. Hasta entonces la historia clínica no se
                puede usar; lo que sí puedes abrir está en la barra de la
                izquierda.
              </span>
            </div>
          )}

        {/* ── El historial ───────────────────────────────────────── */}
        <section>
          <h2 className="text-[14px] font-semibold text-mipiace-ink">
            Lo que se ha aceptado
          </h2>
          {vista.aceptaciones.length === 0 ? (
            <p className="mt-2 text-[13.5px] text-slate-600">
              Todavía no se ha aceptado ninguna versión.
            </p>
          ) : (
            <ul className="mt-2.5 space-y-2.5">
              {vista.aceptaciones.map((a) => (
                <li
                  key={a.id}
                  data-test="contrato-aceptacion"
                  className="rounded-xl border border-slate-200 bg-white p-3.5"
                >
                  <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                    <span className="text-[13.5px] font-semibold text-mipiace-ink">
                      Versión {a.version}
                    </span>
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[12px] font-medium ${
                        a.revocado
                          ? "border-amber-200 bg-amber-50 text-amber-800"
                          : "border-emerald-200 bg-emerald-50 text-emerald-800"
                      }`}
                    >
                      {a.revocado ? "Revocado" : "En vigor"}
                    </span>
                  </div>
                  <p className="mt-1.5 text-[13px] leading-relaxed text-slate-700">
                    Aceptado por {a.quien} el {fecha(a.aceptadoEn)}
                    {a.aparato ? ` desde ${a.aparato}` : ""}.
                  </p>
                  {a.revocado && a.revocadoEn && (
                    <p className="text-[13px] leading-relaxed text-slate-700">
                      Revocado por {a.revocadoPor} el {fecha(a.revocadoEn)}.
                    </p>
                  )}
                  {/* contrato-lectura-completa · lo que esta fila puede
                      contestar el día que alguien diga «yo eso no lo leí».
                      Las aceptaciones anteriores a la regla no lo dicen, y
                      entonces la pantalla NO afirma nada sobre ellas: no se
                      midió, y escribir que no se leyó sería inventarlo. */}
                  {a.textoRecorridoEn != null && (
                    <p className="mt-1.5 text-[13px] leading-relaxed text-slate-700">
                      El texto completo se mostró y se recorrió hasta el
                      final antes de aceptarlo ({fecha(a.textoRecorridoEn)}).
                    </p>
                  )}
                  <p className="mt-1.5 break-all text-[11.5px] text-slate-400">
                    Huella: {a.huella}
                  </p>
                  {a.textoDisponible ? (
                    <button
                      type="button"
                      onClick={() => void abrirPdf(a.version)}
                      className="mt-2.5 inline-flex min-h-[36px] items-center gap-2 rounded-lg border border-slate-200 px-3 text-[13px] font-medium text-mipiace-ink"
                    >
                      <Download className="h-4 w-4" aria-hidden />
                      Descargar el PDF
                    </button>
                  ) : (
                    <p className="mt-2 text-[12.5px] leading-relaxed text-slate-500">
                      Este programa ya no tiene el texto de esta versión. Lo
                      que demuestra qué se aceptó es su huella y su fecha.
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ── Revocar ────────────────────────────────────────────── */}
        {vigente && (
          <section className="rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="text-[14px] font-semibold text-mipiace-ink">
              Revocar el contrato
            </h2>
            {!confirmando ? (
              <>
                <p className="mt-1.5 text-[13.5px] leading-relaxed text-slate-600">
                  Si revocas, la historia clínica pasa a solo lectura. Puedes
                  volver a aceptarlo cuando quieras.
                </p>
                <button
                  type="button"
                  onClick={() => setConfirmando(true)}
                  data-test="contrato-revocar"
                  className="mt-3 inline-flex min-h-[40px] items-center rounded-lg border border-rose-300 px-4 text-[13.5px] font-medium text-rose-800"
                >
                  Revocar el contrato
                </button>
              </>
            ) : (
              <>
                <p className="mt-1.5 text-[13.5px] font-semibold text-mipiace-ink">
                  ¿Seguro? Esto es lo que pasa:
                </p>
                <ul className="mt-2 list-disc space-y-1.5 pl-5 text-[13px] leading-relaxed text-slate-700">
                  <li>
                    La historia clínica pasa a <strong>solo lectura</strong>:
                    se puede leer, imprimir y exportar todo lo que ya hay.
                  </li>
                  <li>
                    <strong>
                      No se podrá escribir nada clínico nuevo
                    </strong>
                    : ni sesiones, ni fotos, ni valoraciones, ni
                    consentimientos.
                  </li>
                  <li>
                    Las citas nuevas no admitirán notas escritas a mano: solo
                    hora, {PERSONA} y servicio.
                  </li>
                  <li>La agenda y la caja siguen funcionando igual.</li>
                  <li>Puedes volver a aceptarlo cuando quieras.</li>
                </ul>
                <div className="mt-3 flex flex-wrap gap-2.5">
                  <button
                    type="button"
                    disabled={trabajando}
                    onClick={() => void revocar()}
                    className="inline-flex min-h-[40px] items-center rounded-lg bg-rose-700 px-4 text-[13.5px] font-semibold text-white disabled:opacity-40"
                  >
                    Sí, revocarlo
                  </button>
                  <button
                    type="button"
                    disabled={trabajando}
                    onClick={() => setConfirmando(false)}
                    className="inline-flex min-h-[40px] items-center rounded-lg border border-slate-200 px-4 text-[13.5px] font-medium text-mipiace-ink"
                  >
                    No, dejarlo como está
                  </button>
                </div>
              </>
            )}
          </section>
        )}

        {/* ── Y la devolución de datos ───────────────────────────── */}
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="text-[14px] font-semibold text-mipiace-ink">
            Llevarte todas las historias
          </h2>
          <p className="mt-1.5 text-[13.5px] leading-relaxed text-slate-600">
            Descarga un paquete con la historia completa de cada {PERSONA}{" "}
            en PDF, sus fotos, sus consentimientos y un fichero con todos
            los datos en formato legible por máquina. Es la devolución de
            datos del art. 28.3.g del RGPD: funciona también con el contrato
            revocado, y queda registrada {PERSONA} a {PERSONA}.
          </p>
          <button
            type="button"
            onClick={() => void exportar()}
            data-test="contrato-exportar"
            className="mt-3 inline-flex min-h-[40px] items-center gap-2 rounded-lg border border-slate-200 px-4 text-[13.5px] font-medium text-mipiace-ink"
          >
            <Download className="h-4 w-4" aria-hidden />
            Descargar todas las historias
          </button>
        </section>
      </div>
    </AdminShell>
  );
}
