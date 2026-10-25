// residencia-5 (decisión de producto 5, bloque C §1-2) · **EL PANEL DE
// DIRECCIÓN.**
//
// Hoy la dirección se entera de lo que hay abierto preguntando. Esto es
// **una pantalla** que lo contesta sin preguntar a nadie, y es la pantalla
// de inicio del panel en un centro de residencia.
//
// ── cuadro-de-control · Y AHORA ES UN CUADRO DE CONTROL ─────────────
//
// Lo dijo Matías el 23-10, el día que Jardín de Gredos se encendió en
// producción y vio el panel de Carmen: «hay demasiadas opciones, no
// parece un cuadro de control». Lo que había era una columna estrecha y
// larga —`max-w-3xl`— con siete secciones una debajo de otra, donde lo
// urgente competía con veinte líneas de obligaciones a sesenta días y
// había que bajar tres veces para saber si había algo que atender.
//
// Lo que cambia (decisión 4 del bloque):
//
//   · **Todo el ancho y una sola pantalla.** `ancho="completo"` en el
//     shell, y cabe en 1366×768 sin scroll con datos normales. Lo que
//     pasa de cuatro o cinco elementos se ve con «Ver…»: una sección que
//     crece con el centro deja de caber, y entonces el panel vuelve a ser
//     una lista.
//   · **Cuatro cifras arriba**, y cada una se abre: incidencias abiertas,
//     relevos sin confirmar, obligaciones y fichas incompletas.
//   · **«Ahora» y «Hoy»**, en dos columnas: el turno por planta y lo que
//     no puede esperar a la izquierda; lo que vence hoy y los relevos sin
//     firmar a la derecha, como lista para tachar.
//   · **El mes en una fila**, los indicadores como fichas pequeñas.
//   · **«Vence en los próximos 60 días» se va** a Obligaciones: a sesenta
//     días no es de hoy, y era la sección que más alargaba la página.
//
// ── ≤ 3 TOQUES Y ≤ 10 s A CUALQUIER DATO (bloque C §1) ──────────────
//
// Sigue siendo el criterio de aceptación de la v1 y sigue decidiendo la
// forma: **una sola petición** trae el panel entero —y desde este bloque
// la comparte con la barra lateral, que pinta con ella los contadores del
// menú (ver `residencia-panel.ts`)— y **cada cifra es un enlace**. Desde
// aquí:
//
//   · una cifra de incidencias → el libro filtrado (1 toque) → la
//     incidencia (2) → el residente (3);
//   · una fila de «lo que no puede esperar» → la incidencia (1 toque);
//   · una obligación vencida → sus ocurrencias (1) → la evidencia (2) — y
//     si sólo hay que tachar, se tacha aquí sin salir.
//
// Ninguna cifra es un número muerto. Una cifra que no se puede abrir es
// una cifra que obliga a preguntar, que es justo lo que este panel existe
// para quitar.

import { useCallback, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  ArrowUpRight,
  CalendarCheck,
  Check,
  ClipboardCheck,
  FilePenLine,
  Plus,
} from "lucide-react";

import { AdminShell } from "../../AdminShell.js";
import { api, ApiError } from "../../api.js";
import { CenteredLoader, FieldError } from "../../ui.js";
import {
  recargarPanel,
  usePanelDeResidencia,
} from "../../residencia-panel.js";
import {
  dia,
  hora,
  umbralEnPalabras,
  valorEnPalabras,
  type IncidenciaQueNoEspera,
  type Panel,
} from "./relevo-lib.js";
import { colorDelNivel, type Nivel } from "./incidencias-lib.js";
// alta-minima · «ABEL RAMOS DOBLADO» → «Abel Ramos Doblado». Decisión 7.
import { nombreVisible } from "./lib.js";

/**
 * cuadro-de-control · **EL ÁREA DE TOQUE DE LA CASILLA.**
 *
 * El cuadro que se ve mide 20 px, que es lo que pide la maqueta; lo que
 * se PULSA mide 36, que es el suelo del admin. Lo encontró el bucle
 * visual con el medidor de objetivos táctiles: las dos casillas salían a
 * 20×20, y una casilla de 20 px en el portátil de la directora se falla
 * una de cada tres.
 *
 * Los márgenes negativos son lo que hace que la fila no crezca: el botón
 * ocupa 36 px pero devuelve 8 por cada lado, así que la lista de «Hoy»
 * mide exactamente lo mismo que antes. Sin ellos, seis obligaciones
 * costarían 96 px y el panel dejaría de caber en una pantalla.
 */
const AREA_DE_LA_CASILLA =
  "-my-2 -ml-2 mr-0 flex h-9 w-9 shrink-0 items-center justify-center";
const CUADRO_DE_LA_CASILLA =
  "block h-5 w-5 rounded-[7px] border-[1.5px] border-slate-300 hover:border-mipiace-coral";

/**
 * Cuántas obligaciones caben en «Hoy». El resto, «Ver obligaciones».
 *
 * **Cinco**, que es el mínimo de lo que el bloque permite («máximo 5-6
 * líneas»), y el número sale de la misma cuenta que los otros topes de
 * esta pantalla: «Ahora» y «Hoy» son dos columnas de la misma fila, así
 * que la fila mide lo que la más alta. Con seis más tres relevos, «Hoy»
 * pasaba de «Ahora» y empujaba «El mes» bajo el pliegue en el peor caso.
 */
const LINEAS_EN_HOY = 5;
/** Y cuántos relevos sin confirmar debajo, por lo mismo. */
const RELEVOS_EN_HOY = 2;

export function PanelPage() {
  // cuadro-de-control · el panel ya no se pide aquí: se pide una vez para
  // la pantalla Y para los contadores del menú (`residencia-panel.ts`).
  // Con dos peticiones los dos números podrían discrepar, que es
  // exactamente lo que la decisión 1 del bloque prohíbe.
  const { panel, error, codigo } = usePanelDeResidencia(true);
  /** El fallo de marcar una obligación desde aquí. No tumba la pantalla. */
  const [falloAlTachar, setFalloAlTachar] = useState<string | null>(null);

  const marcarHecha = useCallback(async (occurrenceId: string) => {
    try {
      setFalloAlTachar(null);
      await api(`/residencia/ocurrencias/${occurrenceId}/hecha`, {
        method: "POST",
        body: {},
      });
      // Y se recarga el panel compartido: así el contador del menú baja a
      // la vez que la casilla se pone verde.
      await recargarPanel();
    } catch (err) {
      setFalloAlTachar(
        err instanceof ApiError ? err.message : "Error inesperado",
      );
    }
  }, []);

  // El servidor dice que esto es de dirección. No es un error que haya que
  // arreglar: es la respuesta correcta para un encargado sin rol
  // directivo, y lo que se pinta es la frase.
  if (codigo === "PANEL_ES_DE_DIRECCION") {
    return (
      <AdminShell title="Panel de dirección">
        <div className="mx-auto max-w-lg rounded-2xl border border-slate-200 bg-white p-7 text-center">
          <p className="text-[14px] text-slate-600">{error}</p>
          <p className="mt-3 text-[13px] text-slate-500">
            Lo que sí puedes abrir está en la barra de la izquierda.
          </p>
        </div>
      </AdminShell>
    );
  }

  if (!panel) {
    return error ? (
      <AdminShell title="Panel de dirección">
        <FieldError message={error} />
      </AdminShell>
    ) : (
      <CenteredLoader label="Cargando el panel…" />
    );
  }

  // primer-acceso (punto 4) · **EL PANEL DEL PRIMER DÍA.**
  //
  // Un centro sin un solo residente no tiene nada abierto, ni relevo, ni
  // turno, ni indicadores: el panel de siempre son cuatro ceros y tres
  // tarjetas vacías, que es verdad y no dice qué hacer.
  //
  // Lo que sustituye a eso es UNA tarjeta con el primer trabajo de
  // verdad. Y una sola: ni una lista de diez tareas de configuración —el
  // edificio, los turnos, los controles, las plantillas— porque ninguna
  // de esas diez es lo que la directora vino a hacer, y la lista las
  // pondría todas al mismo nivel que la que importa. Desde este bloque
  // esas diez tienen su sitio: «Configuración».
  //
  // Va DESPUÉS del `if (!panel)` para que el mensaje de «esto es de
  // dirección» siga llegando antes: un encargado sin rol directivo no
  // tiene que ver una invitación a dar de alta residentes.
  if (panel.centroVacio === true) {
    return (
      <AdminShell title="Panel de dirección">
        <div
          data-test="panel-centro-vacio"
          className="mx-auto max-w-lg rounded-2xl border border-slate-200 bg-white p-7"
        >
          <h2 className="text-[17px] font-semibold text-mipiace-ink">
            Empieza dando de alta a tus residentes
          </h2>
          <p className="mt-2 text-[13.5px] leading-relaxed text-slate-600">
            En cuanto haya alguien en el centro, este panel te enseña qué hay
            abierto hoy, el último relevo, lo que toca y los indicadores del
            mes.
          </p>
          {/* Lleva al formulario ABIERTO (`?alta=1`), no a la lista: un
              toque menos, y la lista que vería sería la vacía. */}
          <Link
            to="/admin/residencia/residentes?alta=1"
            className="mt-5 inline-flex min-h-[48px] items-center gap-2 rounded-2xl bg-mipiace-coral px-5 text-[14.5px] font-medium text-white hover:bg-mipiace-coral-dark"
          >
            <Plus className="h-4 w-4" aria-hidden />
            Nuevo ingreso
          </Link>
        </div>
      </AdminShell>
    );
  }

  return (
    <AdminShell title="Panel de dirección" ancho="completo">
      <Cabecera panel={panel} />
      {error && <FieldError message={error} />}
      {falloAlTachar && <FieldError message={falloAlTachar} />}
      <LoQueHayQueArreglar panel={panel} />
      <CalidadQueNoEspera panel={panel} />
      <Cifras panel={panel} />
      <div className="mb-2.5 grid gap-2.5 lg:grid-cols-[1.35fr_1fr]">
        <Ahora panel={panel} />
        <Hoy panel={panel} onMarcar={marcarHecha} />
      </div>
      <ElMes panel={panel} />
    </AdminShell>
  );
}

// ══ LA CABECERA ═══════════════════════════════════════════════════════
//
// «Buenos días, Carmen», la fecha y el turno en curso; a la derecha,
// cuántos residentes hay en el centro.
//
// El saludo sale de la hora del navegador y el nombre del panel (`yo`).
// Si el panel viene de una API anterior a este bloque no hay nombre: se
// saluda sin él, que es mejor que «Buenos días, undefined».

/** La hora a la que deja de ser «buenos días». */
function saludo(ahora: Date): string {
  const h = ahora.getHours();
  if (h < 14) return "Buenos días";
  if (h < 21) return "Buenas tardes";
  return "Buenas noches";
}

/** «Viernes 23 de octubre», con la inicial en mayúscula. */
function fechaLarga(careDay: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(careDay)) return careDay;
  const [a, m, d] = careDay.split("-").map(Number);
  const texto = new Date(a!, m! - 1, d!).toLocaleDateString("es-ES", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

function Cabecera({ panel }: { panel: Panel }) {
  const generado = new Date(panel.generadoEn);
  const turno = panel.turno.turno;
  const centro = panel.centro;
  return (
    <div className="mb-3 flex flex-wrap items-end justify-between gap-x-6 gap-y-1.5">
      <div>
        <h2 className="text-[21px] font-semibold leading-tight tracking-tight text-mipiace-ink">
          {saludo(generado)}
          {panel.yo?.nombre ? `, ${nombreVisible(panel.yo.nombre)}` : ""}
        </h2>
        <p className="mt-0.5 text-[13.5px] text-slate-500">
          {fechaLarga(panel.turno.careDay)}
          {turno
            ? ` · turno de ${turno.name.toLowerCase()}${
                turno.terminaEn ? `, hasta las ${turno.terminaEn}` : ""
              }`
            : " · los turnos del centro no cubren esta hora"}
        </p>
      </div>
      {centro && (
        <div className="flex gap-5 text-[13.5px] text-slate-700 tabular-nums">
          <span>
            <strong className="font-semibold">{centro.dentro}</strong>{" "}
            {centro.dentro === 1 ? "residente" : "residentes"} en el centro
          </span>
          {/* Las ausencias todavía no existen, así que `fuera` es `null` y
              no se enseña: un «0 fuera» afirmaría que no hay nadie en el
              hospital, y eso hoy no se sabe. */}
          {centro.fuera != null && (
            <span>
              <strong className="font-semibold">{centro.fuera}</strong> fuera
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// ══ residencia-6 · LO QUE HAY QUE ARREGLAR, EN UNA BANDA ══════════════
//
// En residencia-6 esto era una sección con dos tarjetas. En un cuadro de
// control que tiene que caber en una pantalla no cabe una sección entera
// para algo que casi siempre está a cero, así que es una banda de una o
// dos líneas **y sólo cuando hay algo**: una tarjeta vacía con un «0»
// enseña a no mirar la sección.
//
// Y sigue arriba, delante de las cifras, por lo mismo que decía
// residencia-6: no es una urgencia de hoy —nadie está en el hospital por
// esto— pero un PIN que no abre nada es una persona que no puede
// registrar, y eso no puede quedar detrás de tres tarjetas.

function LoQueHayQueArreglar({ panel }: { panel: Panel }) {
  const porArreglar = panel.porArreglar;
  const pines = porArreglar?.pinesPorRenovar ?? [];
  const sinPlan = porArreglar?.residentesSinPlan ?? [];
  if (pines.length === 0 && sinPlan.length === 0) return null;
  return (
    <div
      data-test="panel-por-arreglar"
      className="mb-3 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-[13px] text-amber-900"
    >
      {pines.length > 0 && (
        <p>
          <strong className="font-semibold">
            {pines.length === 1
              ? "1 PIN por renovar"
              : `${pines.length} PIN por renovar`}
          </strong>
          : con un rol que ve todo el centro hace falta uno de 6 cifras, así
          que ahora mismo <strong>no entran</strong> en la puerta, en la sala
          ni en el móvil de guardia.{" "}
          <Link to="/admin/staff" className="underline">
            {pines.map((p) => p.nombre).join(", ")}
          </Link>
        </p>
      )}
      {sinPlan.length > 0 && (
        <p className={pines.length > 0 ? "mt-1" : undefined}>
          <strong className="font-semibold">
            {sinPlan.length === 1
              ? "1 residente sin plan de cuidados"
              : `${sinPlan.length} residentes sin plan de cuidados`}
          </strong>
          : no les toca nada, así que no salen en «lo que toca» de su puerta
          y lo que se les haga no queda registrado.{" "}
          {sinPlan.slice(0, 6).map((r, i) => (
            <span key={r.clientId}>
              {i > 0 && ", "}
              <Link
                to={`/admin/residencia/residentes/${r.clientId}/plan`}
                className="underline"
              >
                {nombreVisible(r.nombre)}
              </Link>
            </span>
          ))}
          {sinPlan.length > 6 && ` y ${sinPlan.length - 6} más`}
        </p>
      )}
    </div>
  );
}

// ══ calidad-1 · LO QUE CALIDAD NO PUEDE DEJAR PASAR, EN UNA BANDA ═════
//
// Una acción correctiva vencida, una revisión de riesgo pasada de fecha y
// un indicador que lleva dos meses fuera de umbral (D-74). Las tres son
// «alguien tiene que hacer algo», y las tres son de calidad.
//
// ── POR QUÉ UNA BANDA Y NO UNA SECCIÓN ──────────────────────────────
//
// Porque calidad-1 traía una sección de tres tarjetas y
// cuadro-de-control la midió: **el panel tiene que caber en 1366×768 sin
// scroll**, y una sección entera para algo que casi siempre está a cero
// es justo lo que ese bloque quitó de «lo que hay que arreglar». Así que
// esto es su misma forma — una o dos líneas, y `null` cuando no hay nada.
//
// En un centro al día el panel mide exactamente lo que medía. En uno con
// una acción vencida crece una línea, que es cuando hay algo que leer.
//
// ── Y EL REGISTRO DE NC NO SALE AQUÍ ────────────────────────────────
//
// «Cuatro no conformidades sin cerrar» no es una urgencia: una NC vive
// semanas y tiene su plazo dentro. Lo que no puede esperar es el plazo
// VENCIDO, y eso es lo que se pinta. El recuento está en su pantalla, a
// un toque desde «Configuración».

function CalidadQueNoEspera({ panel }: { panel: Panel }) {
  const calidad = panel.calidad;
  if (calidad == null || !calidad.mapaCargado) return null;
  const acciones = calidad.accionesVencidas;
  const revisiones = calidad.revisionesVencidas;
  const propuestas = calidad.propuestas;
  if (
    acciones.length === 0 &&
    revisiones.length === 0 &&
    propuestas.length === 0
  ) {
    return null;
  }
  return (
    <div
      data-test="panel-calidad"
      className="mb-3 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-[13px] text-amber-900"
    >
      {acciones.length > 0 && (
        <p>
          <strong className="font-semibold">
            {acciones.length === 1
              ? "1 acción correctiva vencida"
              : `${acciones.length} acciones correctivas vencidas`}
          </strong>
          : el plazo pasó y la no conformidad sigue abierta.{" "}
          {acciones.slice(0, 3).map((a, i) => (
            <span key={a.id}>
              {i > 0 && ", "}
              <Link
                to={`/admin/residencia/no-conformidades/${a.ncId}`}
                className="underline"
              >
                {a.referencia}
              </Link>
              {` · ${a.responsable}`}
            </span>
          ))}
          {acciones.length > 3 && ` y ${acciones.length - 3} más`}
        </p>
      )}
      {revisiones.length > 0 && (
        <p className={acciones.length > 0 ? "mt-1.5" : undefined}>
          <strong className="font-semibold">
            {revisiones.length === 1
              ? "1 revisión de riesgo vencida"
              : `${revisiones.length} revisiones de riesgo vencidas`}
          </strong>
          :{" "}
          {revisiones.slice(0, 3).map((r, i) => (
            <span key={r.id}>
              {i > 0 && ", "}
              <Link
                to={`/admin/residencia/procesos/${r.procesoId}`}
                className="underline"
              >
                {r.proceso}
              </Link>
            </span>
          ))}
          {revisiones.length > 3 && ` y ${revisiones.length - 3} más`}
        </p>
      )}
      {propuestas.length > 0 && (
        <p className={acciones.length + revisiones.length > 0 ? "mt-1.5" : undefined}>
          <strong className="font-semibold">
            {propuestas.length === 1
              ? "1 indicador lleva dos meses fuera de umbral"
              : `${propuestas.length} indicadores llevan dos meses fuera de umbral`}
          </strong>
          : el sistema <strong>propone</strong> abrir una no conformidad con
          el origen ya relleno —la decide una persona—.{" "}
          {propuestas.slice(0, 3).map((p, i) => (
            <span key={p.code}>
              {i > 0 && ", "}
              <Link
                to={`/admin/residencia/no-conformidades?proponer=${p.code}&mes=${p.mesDeReferencia}${p.procesoId ? `&proceso=${p.procesoId}` : ""}`}
                className="underline"
              >
                {p.nombre}
              </Link>
            </span>
          ))}
          {propuestas.length > 3 && ` y ${propuestas.length - 3} más`}
        </p>
      )}
    </div>
  );
}

// ══ LAS CUATRO CIFRAS ═════════════════════════════════════════════════

type Tono = "rojo" | "ambar" | "coral" | "tranquilo";

const FONDO: Record<Tono, string> = {
  rojo: "border-red-300 bg-red-50",
  ambar: "border-amber-300 bg-amber-50",
  coral: "border-mipiace-coral/35 bg-white",
  tranquilo: "border-slate-200 bg-white",
};
const ETIQUETA: Record<Tono, string> = {
  rojo: "text-red-700",
  ambar: "text-amber-700",
  coral: "text-mipiace-coral-dark",
  tranquilo: "text-slate-500",
};

function Cifra({
  a,
  icono: Icono,
  etiqueta,
  cifra,
  tono,
  marca,
  children,
}: {
  a: string;
  icono: typeof AlertTriangle;
  etiqueta: string;
  cifra: number;
  tono: Tono;
  marca: string;
  children?: React.ReactNode;
}) {
  return (
    <Link
      to={a}
      data-test={`cifra-${marca}`}
      /* **ALTO FIJO, Y SÓLO EN LA FILA DE CUATRO.**
         En el escritorio son cuatro tarjetas en una fila y la fila mide
         lo que la más alta, así que un detalle de tres renglones en UNA
         se los cobra a las cuatro — y lo que se cae por abajo es «Hoy»,
         que es la mitad del panel. Con el alto puesto, ningún centro
         puede empujar la fila: lo que no cabe se corta y el dato entero
         está a un toque.
         En la mano (`lg:` no aplica) **el alto es libre**: ahí son dos
         filas de dos, la tarjeta es la mitad de ancha, no hay nada que
         empujar bajo el pliegue —la pantalla ya hace scroll— y recortar
         sólo serviría para partir «sin grado no se factura a la Junta»
         a media frase. Lo vio el bucle visual a 390. */
      className={`relative flex flex-col rounded-2xl border px-4 py-2 hover:shadow-sm lg:h-[112px] lg:overflow-hidden ${FONDO[tono]}`}
    >
      <ArrowUpRight
        aria-hidden
        className="absolute right-4 top-4 h-4 w-4 text-slate-400"
      />
      <span className={`flex items-center gap-2 text-[12.5px] ${ETIQUETA[tono]}`}>
        <Icono aria-hidden className="h-4 w-4" strokeWidth={2.25} />
        {etiqueta}
      </span>
      {/* El número solo no se lee en voz alta: el `aria-label` lo dice con
          su sustantivo, y el dígito queda oculto para que no se diga dos
          veces. Es la misma regla que el contador del menú. */}
      <span
        aria-label={`${cifra} · ${etiqueta.toLocaleLowerCase("es-ES")}`}
        className="text-[27px] font-semibold leading-[1.2] tracking-tight tabular-nums"
      >
        <span aria-hidden>{cifra}</span>
      </span>
      <span className="text-[12.5px] leading-snug text-slate-600">{children}</span>
    </Link>
  );
}

/**
 * Las frases de detalle de la cifra de incidencias, **las dos primeras**.
 *
 * Hay tres cosas que decir —cuántas graves, cuántas sin comunicar a la
 * familia, cuántos avisos sin acusar— y en una tarjeta de este tamaño
 * caben dos. Se escogen por orden de gravedad y se ignoran las que están
 * a cero: una tarjeta que dice «0 sin comunicar a la familia» gasta su
 * única línea en decir que no pasa nada.
 */
function detalleDeIncidencias(panel: Panel): string[] {
  const { porNivel, sinConstanciaDeFamilia, avisosSinAcuse } = panel.abierto;
  const graves = porNivel
    .filter((n) => n.nivel === "N3" || n.nivel === "N4")
    .reduce((t, n) => t + n.cuantas, 0);
  const frases: string[] = [];
  if (graves > 0) frases.push(`${graves} grave${graves === 1 ? "" : "s"}`);
  if (sinConstanciaDeFamilia > 0) {
    frases.push(`${sinConstanciaDeFamilia} sin comunicar a la familia`);
  }
  if (avisosSinAcuse > 0) {
    frases.push(
      `${avisosSinAcuse} aviso${avisosSinAcuse === 1 ? "" : "s"} sin acuse`,
    );
  }
  return frases.slice(0, 2);
}

function Cifras({ panel }: { panel: Panel }) {
  const { abierto, relevos, obligaciones } = panel;
  const fichas = panel.fichasIncompletas ?? null;
  const graves = abierto.porNivel
    .filter((n) => n.nivel === "N3" || n.nivel === "N4")
    .reduce((t, n) => t + n.cuantas, 0);
  const sinConfirmar = relevos.sinConfirmar.length;
  const vencidas = obligaciones.vencidas.length;
  const hoyPendientes = obligaciones.hoy.filter((o) => !o.hecha).length;
  const incompletas = fichas?.incompletas ?? 0;

  // ── EL PANEL TRANQUILO ───────────────────────────────────────────
  //
  // Con todo a cero, cuatro tarjetas con un «0» cada una son cuatro
  // avisos de que no pasa nada, y eso es ruido: quien abre el panel y ve
  // cuatro números grandes los lee antes de leer que son ceros. Una línea
  // lo dice mejor y deja la pantalla para «Ahora» y «Hoy», que es lo que
  // en un día tranquilo sí tiene contenido (el turno va por la mitad y
  // hay obligaciones que tachar).
  //
  // Las cuatro secciones siguen a un toque desde el menú, así que esto no
  // esconde nada: lo que quita es la alarma falsa.
  if (
    abierto.total === 0 &&
    sinConfirmar === 0 &&
    vencidas === 0 &&
    hoyPendientes === 0 &&
    incompletas === 0
  ) {
    return (
      <div
        data-test="panel-tranquilo"
        className="mb-3 flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4"
      >
        <Check aria-hidden className="h-5 w-5 text-emerald-700" strokeWidth={2.5} />
        <p className="text-[14.5px] font-medium text-emerald-900">
          Nada abierto. Todo al día.
        </p>
      </div>
    );
  }

  const frases = detalleDeIncidencias(panel);
  const primerRelevo = relevos.sinConfirmar[0];
  return (
    <div className="mb-2.5 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
      <Cifra
        marca="incidencias"
        a="/admin/residencia/incidencias?abiertas=1"
        icono={AlertTriangle}
        etiqueta="Incidencias abiertas"
        cifra={abierto.total}
        tono={graves > 0 ? "rojo" : abierto.total > 0 ? "ambar" : "tranquilo"}
      >
        {frases.length > 0 ? frases.join(" · ") : "Ninguna grave."}
      </Cifra>
      <Cifra
        marca="relevos"
        a="/admin/residencia/relevos"
        icono={ClipboardCheck}
        etiqueta="Relevos sin confirmar"
        cifra={sinConfirmar}
        tono={sinConfirmar > 0 ? "ambar" : "tranquilo"}
      >
        {primerRelevo
          ? `El de ${primerRelevo.turno.toLowerCase()} del ${dia(primerRelevo.careDay)}`
          : "Todos firmados."}
      </Cifra>
      <Cifra
        marca="obligaciones"
        a="/admin/residencia/obligaciones"
        icono={CalendarCheck}
        etiqueta="Obligaciones"
        cifra={vencidas > 0 ? vencidas : hoyPendientes}
        tono={vencidas > 0 ? "rojo" : hoyPendientes > 0 ? "ambar" : "tranquilo"}
      >
        {vencidas > 0 ? (
          <>
            <strong className="font-medium">
              {vencidas === 1 ? "vencida" : "vencidas"}
            </strong>
            {hoyPendientes > 0 ? ` · ${hoyPendientes} para hoy` : ""}
          </>
        ) : hoyPendientes > 0 ? (
          "para hoy · nada vencido"
        ) : (
          "Nada vencido ni para hoy."
        )}
      </Cifra>
      <Cifra
        marca="fichas"
        a={`/admin/residencia/residentes${
          fichas?.primeras[0] ? `?completar=${fichas.primeras[0].clientId}` : ""
        }`}
        icono={FilePenLine}
        etiqueta="Fichas incompletas"
        cifra={incompletas}
        tono={
          incompletas === 0
            ? "tranquilo"
            : (fichas?.conImprescindibles ?? 0) > 0
              ? "rojo"
              : "coral"
        }
      >
        {fichas == null ? (
          ""
        ) : incompletas === 0 ? (
          "Todas completas."
        ) : (
          <>
            de {fichas.total} · faltan {fichas.datosPendientes}{" "}
            {fichas.datosPendientes === 1 ? "dato" : "datos"} ·{" "}
            <strong className="font-medium text-mipiace-coral-dark">
              Completar
            </strong>
            {/* alta-minima · **LA CONSECUENCIA, Y SÓLO CUANDO LA HAY.**
                Esta línea es lo único que la tarjeta hereda del muro de
                texto que era en alta-minima, y se queda porque es el POR
                QUÉ: «nueve fichas a medias» es trabajo de oficina,
                «nueve sin grado reconocido» es dinero que la Junta no
                paga y un expediente que no pasa una inspección. Sin
                imprescindibles no se pinta: lo que falta entonces es el
                NSS o la cama, y eso no tiene consecuencia. */}
            {(fichas.conImprescindibles ?? 0) > 0 && (
              // Corta a propósito: son cuatro tarjetas en una fila y la
              // fila crece con la más alta, así que cada renglón de más
              // aquí se los come el panel entero. Lo que no se puede
              // perder son los dos datos — cuántas y la consecuencia —, y
              // los dos caben.
              <span className="mt-0.5 block font-medium text-red-700">
                {fichas.conImprescindibles} sin DNI, grado o familiar — sin
                grado no se factura a la Junta.
              </span>
            )}
          </>
        )}
      </Cifra>
    </div>
  );
}

// ══ «AHORA» ═══════════════════════════════════════════════════════════

/**
 * El estado de una incidencia, en una línea.
 *
 * Los HECHOS los manda el servidor (ver `IncidenciaQueNoEspera` en
 * `panel.ts`); la frase se compone aquí, igual que en el libro. Dos
 * cláusulas como mucho: esto es una fila de una tarjeta, no una ficha.
 */
function estadoDeLaIncidencia(i: IncidenciaQueNoEspera): string {
  const frases: string[] = [];
  if (i.esperaCierreDeOtro) frases.push("Pendiente de que la cierre otra persona");
  if (i.sinConstanciaDeFamilia) frases.push("Sin comunicar a la familia");
  if (i.avisosSinAcuse.length > 0) {
    frases.push(
      i.avisosSinAcuse.includes("ENFERMERIA")
        ? "Enfermería avisada, sin acuse"
        : "Dirección avisada, sin acuse",
    );
  }
  if (frases.length === 0) {
    frases.push(i.sujeto === "MAINTENANCE" ? "Avería · mantenimiento" : "Abierta");
  }
  return frases.slice(0, 2).join(" · ");
}

function Ahora({ panel }: { panel: Panel }) {
  const { turno } = panel;
  const noPuedeEsperar = panel.abierto.noPuedeEsperar ?? [];
  return (
    <section className="min-w-0 rounded-2xl border border-slate-200 bg-white px-5 py-2.5">
      <h3 className="mb-2 flex items-baseline justify-between gap-3 text-[16px] font-semibold tracking-tight text-mipiace-ink">
        <span>
          Ahora
          <em className="ml-2 text-[13px] font-normal not-italic text-slate-500">
            {turno.turno
              ? `turno de ${turno.turno.name.toLowerCase()} · ${hora(panel.generadoEn)}`
              : "sin turno en el cuadrante"}
          </em>
        </span>
      </h3>
      {turno.turno == null ? (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-900">
          Los turnos del centro no cubren esta hora: hay un hueco en el
          cuadrante. Lo que se registre ahora se guarda <strong>sin turno</strong>{" "}
          y sale en el relevo como aviso.
        </p>
      ) : (
        <>
          {turno.plantas.length === 0 ? (
            <p className="text-[13px] text-slate-500">
              Nada planificado para este turno.
            </p>
          ) : (
            // **A DOS COLUMNAS A PARTIR DE CUATRO PLANTAS.** Jardín de
            // Gredos tiene dos y cabe de sobra; un centro de cinco se
            // comería 78 px del panel en una lista de una columna y
            // dejaría «El mes» bajo el pliegue. A dos columnas, cinco
            // plantas cuestan lo que tres.
            <ul
              className={
                turno.plantas.length > 3
                  ? "grid gap-x-6 sm:grid-cols-2"
                  : "space-y-1"
              }
            >
              {turno.plantas.map((p) => (
                <li
                  key={p.floorId ?? "sin"}
                  className="grid grid-cols-[minmax(0,84px)_minmax(0,1fr)_auto] items-center gap-3 text-[13px] leading-6"
                >
                  <span className="truncate text-slate-600">{p.nombre}</span>
                  {/* Sin animación, que es la regla de la casa para lo que
                      se repinta. */}
                  <span className="h-2 overflow-hidden rounded-full bg-slate-200">
                    <span
                      className="block h-full rounded-full bg-mipiace-coral"
                      style={{
                        width: `${
                          p.tocan === 0
                            ? 0
                            : Math.round((p.hechas / p.tocan) * 100)
                        }%`,
                      }}
                    />
                  </span>
                  <span className="text-right tabular-nums text-slate-700">
                    {p.hechas} de {p.tocan}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {turno.noHechoDeTurnosCerrados > 0 && (
            <p className="mt-2 text-[12.5px] text-slate-500">
              De los turnos ya cerrados de hoy quedaron{" "}
              <strong className="font-medium tabular-nums">
                {turno.noHechoDeTurnosCerrados}
              </strong>{" "}
              sin registrar.{" "}
              <Link to="/admin/residencia/relevos" className="underline">
                Se ven en su parte.
              </Link>
            </p>
          )}
        </>
      )}

      <div className="mt-3 flex items-baseline justify-between gap-3">
        <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-slate-500">
          Lo que no puede esperar
        </p>
        {panel.abierto.total > noPuedeEsperar.length && (
          <Link
            to="/admin/residencia/incidencias?abiertas=1"
            className="text-[12.5px] text-mipiace-coral-dark underline"
          >
            Ver las {panel.abierto.total}
          </Link>
        )}
      </div>
      {noPuedeEsperar.length === 0 ? (
        // `total > 0` y la lista vacía es el panel de una API anterior a
        // este bloque: no trae `noPuedeEsperar`. Decir «no hay ninguna
        // incidencia abierta» debajo de un «10» sería mentir durante los
        // minutos de un despliegue, así que se dice lo que SÍ se sabe.
        <p className="mt-1 text-[13px] text-slate-500">
          {panel.abierto.total > 0 ? (
            <>
              Las {panel.abierto.total} abiertas se ven en{" "}
              <Link
                to="/admin/residencia/incidencias?abiertas=1"
                className="underline"
              >
                el libro
              </Link>
              .
            </>
          ) : (
            "No hay ninguna incidencia abierta."
          )}
        </p>
      ) : (
        <ul>
          {noPuedeEsperar.map((i) => (
            <li key={i.id}>
              <Link
                to={`/admin/residencia/incidencias/${i.id}`}
                className="flex items-center gap-3 border-t border-slate-100 py-1.5 first:border-t-0 hover:bg-slate-50"
              >
                <span
                  className={`min-w-[30px] rounded-md px-1.5 py-0.5 text-center text-[11px] font-semibold ${colorDelNivel(
                    i.nivel as Nivel,
                  )}`}
                >
                  {i.nivel}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-medium leading-tight text-mipiace-ink">
                    {i.nombreDelTipo}
                    {i.habitacion ? ` · hab. ${i.habitacion}` : ""}
                    {!i.habitacion && i.residente
                      ? ` · ${nombreVisible(i.residente)}`
                      : ""}
                  </span>
                  <span className="block truncate text-[12.5px] leading-tight text-slate-500">
                    {estadoDeLaIncidencia(i)}
                  </span>
                </span>
                <span className="shrink-0 text-[12.5px] tabular-nums text-slate-500">
                  {hora(i.abiertaEn)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ══ «HOY» ═════════════════════════════════════════════════════════════
//
// Lo que vence hoy y lo vencido, como lista con su casilla, y los relevos
// sin confirmar con «Abrir».
//
// ── LA CASILLA TACHA DESDE AQUÍ, SALVO SI HAY QUE ADJUNTAR ──────────
//
// «Marcar hecho desde aquí si la obligación lo permite; si pide
// evidencia, la casilla abre la obligación» (decisión 4).
//
// Y no hay ninguna columna que diga «pide evidencia»: `ManagementDuty`
// tiene familia, periodicidad, consecuencia y responsable, y la evidencia
// es un adjunto opcional de la ocurrencia. Así que el proxy es la
// **consecuencia LEGAL**, y es el proxy honesto: una obligación legal es
// la revisión de extintores, la desinfección, la inspección — las que
// dejan un certificado, y las que alguien va a pedir dentro de dos años.
// Tacharlas sin el papel es dejar media evidencia.
//
// Las ISO y las internas se tachan aquí, que es el caso de todos los días
// (el registro de jornada, el pedido de alimentación). Queda anotado en
// el done como duda abierta: si Carmen echa de menos tachar una legal
// desde aquí, lo que falta es la columna, no el botón.

function Hoy({
  panel,
  onMarcar,
}: {
  panel: Panel;
  onMarcar: (occurrenceId: string) => void | Promise<void>;
}) {
  const { obligaciones, relevos } = panel;
  // Lo vencido delante: es lo que hay que hacer hoy aunque tocara el 20.
  const lista = [...obligaciones.vencidas, ...obligaciones.hoy];
  const visibles = lista.slice(0, LINEAS_EN_HOY);
  return (
    <section className="min-w-0 rounded-2xl border border-slate-200 bg-white px-5 py-2.5">
      <h3 className="mb-2 flex items-baseline justify-between gap-3 text-[16px] font-semibold tracking-tight text-mipiace-ink">
        <span>Hoy</span>
        <Link
          to="/admin/residencia/obligaciones"
          className="text-[12.5px] font-medium text-mipiace-coral-dark underline"
        >
          Ver obligaciones
        </Link>
      </h3>
      {visibles.length === 0 ? (
        <p className="text-[13px] text-slate-500">
          Nada vencido y nada para hoy.
        </p>
      ) : (
        <ul>
          {visibles.map((o) => {
            const pideEvidencia = o.consequence === "LEGAL";
            return (
              <li
                key={o.id}
                className="flex items-center gap-3 border-t border-slate-100 py-1.5 first:border-t-0"
              >
                {o.hecha ? (
                  <span
                    aria-label="hecha"
                    className="grid h-5 w-5 shrink-0 place-items-center rounded-[7px] border-[1.5px] border-emerald-300 bg-emerald-50"
                  >
                    <Check
                      aria-hidden
                      className="h-3 w-3 text-emerald-700"
                      strokeWidth={3}
                    />
                  </span>
                ) : pideEvidencia ? (
                  <Link
                    to={`/admin/residencia/obligaciones?duty=${o.dutyId}`}
                    aria-label={`${o.nombre}: adjuntar la evidencia y marcarla hecha`}
                    data-test="casilla-con-evidencia"
                    className={AREA_DE_LA_CASILLA}
                  >
                    <span className={CUADRO_DE_LA_CASILLA} />
                  </Link>
                ) : (
                  <button
                    type="button"
                    onClick={() => void onMarcar(o.id)}
                    aria-label={`Marcar «${o.nombre}» como hecha`}
                    data-test="casilla-tachable"
                    className={AREA_DE_LA_CASILLA}
                  >
                    <span className={CUADRO_DE_LA_CASILLA} />
                  </button>
                )}
                <span className="min-w-0 flex-1">
                  <Link
                    to={`/admin/residencia/obligaciones?duty=${o.dutyId}`}
                    className={`block truncate text-[13.5px] ${
                      o.vencida && !o.hecha
                        ? "font-medium text-red-700"
                        : "font-medium text-mipiace-ink"
                    }`}
                  >
                    {o.nombre}
                  </Link>
                  <span
                    className={`block truncate text-[12.5px] ${
                      o.vencida && !o.hecha ? "text-red-700" : "text-slate-500"
                    }`}
                  >
                    {o.hecha
                      ? `Hecha${o.hechaEn ? ` · ${hora(o.hechaEn)}` : ""}${
                          o.hechaPor ? ` · ${o.hechaPor}` : ""
                        }`
                      : o.vencida
                        ? `Venció el ${dia(o.dueOn)} (${Math.abs(
                            o.diasRestantes,
                          )} ${
                            Math.abs(o.diasRestantes) === 1 ? "día" : "días"
                          }) · ${o.responsable}`
                        : o.responsable}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {lista.length > visibles.length && (
        <p className="mt-1.5 text-[12.5px] text-slate-500">
          y {lista.length - visibles.length} más en{" "}
          <Link to="/admin/residencia/obligaciones" className="underline">
            Obligaciones
          </Link>
          .
        </p>
      )}

      {(relevos.sinConfirmar.length > 0 || relevos.ultimo?.confirmado) && (
        <>
          <p className="mt-3 text-[11px] font-medium uppercase tracking-[0.08em] text-slate-500">
            Relevos
          </p>
          <ul>
            {relevos.sinConfirmar.slice(0, RELEVOS_EN_HOY).map((r) => (
              <li
                key={r.id}
                className="flex items-center gap-3 border-t border-slate-100 py-1.5 first:border-t-0"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-medium text-mipiace-ink">
                    {r.turno} del {dia(r.careDay)}
                  </span>
                  <span className="block truncate text-[12.5px] text-slate-500">
                    {r.lineas} {r.lineas === 1 ? "línea" : "líneas"} ·{" "}
                    {r.zonasPorConfirmar > 0
                      ? `${r.zonasPorConfirmar} ${
                          r.zonasPorConfirmar === 1 ? "zona" : "zonas"
                        } sin recibir`
                      : "nadie lo ha confirmado"}
                  </span>
                </span>
                <Link
                  to={`/admin/residencia/relevos/${r.id}`}
                  className="inline-flex h-9 shrink-0 items-center rounded-xl bg-mipiace-stone px-3.5 text-[13px] font-medium text-mipiace-ink hover:bg-slate-200"
                >
                  Abrir
                </Link>
              </li>
            ))}
          </ul>
          {relevos.sinConfirmar.length > RELEVOS_EN_HOY && (
            <p className="mt-1.5 text-[12.5px] text-slate-500">
              y {relevos.sinConfirmar.length - RELEVOS_EN_HOY} más en{" "}
              <Link to="/admin/residencia/relevos" className="underline">
                Relevos
              </Link>
              .
            </p>
          )}
          {/* residencia-5 · **EL ÚLTIMO, CUANDO YA ESTÁ FIRMADO**, con
              quién lo recibió y a qué hora. Es la línea tranquila del
              bloque y hace falta: una lista que sólo enseña lo que falta
              no dice si el cambio de turno de esta mañana se dio o no, y
              «quién lo recibió» es la evidencia que la dirección busca
              cuando algo sale mal. Una línea, no la tarjeta de
              residencia-5: el parte entero está a un toque. */}
          {relevos.ultimo?.confirmado && (
            <div className="flex items-center gap-3 border-t border-slate-100 py-1.5 text-[13px]">
              <span
                aria-label="confirmado"
                className="grid h-5 w-5 shrink-0 place-items-center rounded-[7px] border-[1.5px] border-emerald-300 bg-emerald-50"
              >
                <Check
                  aria-hidden
                  className="h-3 w-3 text-emerald-700"
                  strokeWidth={3}
                />
              </span>
              <Link
                to={`/admin/residencia/relevos/${relevos.ultimo.id}`}
                className="min-w-0 flex-1"
              >
                <span className="block truncate font-medium text-mipiace-ink">
                  {relevos.ultimo.turno} del {dia(relevos.ultimo.careDay)}
                </span>
                <span className="block truncate text-[12.5px] text-slate-500">
                  {relevos.ultimo.confirmadoPor.length === 0
                    ? "Confirmado"
                    : `Confirmado por ${relevos.ultimo.confirmadoPor
                        .map((c) => `${c.nombre} (${c.rol})`)
                        .join(", ")} · ${hora(
                        relevos.ultimo.confirmadoPor[0]!.at,
                      )}`}
                </span>
              </Link>
            </div>
          )}
        </>
      )}
    </section>
  );
}

// ══ EL MES, EN UNA FILA ═══════════════════════════════════════════════

function ElMes({ panel }: { panel: Panel }) {
  const { indicadores } = panel;
  const conDato = indicadores.filter((i) => i.valor != null);
  const fuera = conDato.filter((i) => i.dentro === false);
  return (
    <section className="min-w-0 rounded-2xl border border-slate-200 bg-white px-5 py-2.5">
      <h3 className="mb-2 flex items-baseline justify-between gap-3 text-[16px] font-semibold tracking-tight text-mipiace-ink">
        <span>
          {mesEnPalabras(panel.mes)}
          <em className="ml-2 text-[13px] font-normal not-italic text-slate-500">
            {conDato.length === 0
              ? "todavía sin datos"
              : fuera.length === 0
                ? `${conDato.length} ${
                    conDato.length === 1 ? "indicador" : "indicadores"
                  } dentro de objetivo`
                : `${fuera.length} de ${conDato.length} ${
                    fuera.length === 1 ? "indicador" : "indicadores"
                  } fuera de objetivo`}
          </em>
        </span>
        <Link
          to="/admin/residencia/indicadores"
          className="text-[12.5px] font-medium text-mipiace-coral-dark underline"
        >
          Ver indicadores
        </Link>
      </h3>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {indicadores.map((i) => (
          <Link
            key={i.code}
            to="/admin/residencia/indicadores"
            title={`${i.nombre} · ${valorEnPalabras(i)} · objetivo ${umbralEnPalabras(i)}`}
            /* **ALTO FIJO, Y ES LO QUE HACE QUE EL PANEL QUEPA.**
               Seis fichas en una fila: la fila mide lo que la más alta, y
               una sola con el nombre largo y «Sin dato este mes» a dos
               renglones subía las seis de 62 px a 97. Lo midió el bucle
               visual. Con el alto puesto, lo que sobra se corta y el
               nombre entero va en el `title` y en el lector de
               pantalla. */
            className={`flex h-[62px] flex-col justify-between overflow-hidden rounded-xl px-3 py-2 ${
              i.dentro === false
                ? "bg-red-50"
                : i.dentro === true
                  ? "bg-emerald-50"
                  : "bg-mipiace-stone"
            }`}
          >
            <span
              className="overflow-hidden text-[11.5px] leading-tight text-slate-600"
              style={{
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
              }}
            >
              {i.nombre}
            </span>
            <span
              className={`block truncate text-[18px] font-semibold leading-none tracking-tight tabular-nums ${
                i.dentro === false
                  ? "text-red-700"
                  : i.dentro === true
                    ? "text-emerald-700"
                    : "text-mipiace-ink"
              }`}
            >
              {/* residencia-5 · **«sin dato» no es cero**, y sigue sin
                  serlo: la raya no se puede confundir con un 0, y lo que
                  significa lo dice la frase entera, que va al `title` y
                  al lector de pantalla. En la ficha de 167 px de este
                  panel, «Sin dato este mes» partía en dos renglones. */}
              {i.valor == null ? "—" : valorEnPalabras(i)}
            </span>
            <span className="sr-only">
              {valorEnPalabras(i)} · objetivo {umbralEnPalabras(i)}
              {i.umbralDelCentro ? "" : " (de serie)"}
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}

/** «2026-10» → «Octubre». El año no se pinta: es el mes en curso. */
function mesEnPalabras(mes: string): string {
  if (!/^\d{4}-\d{2}$/.test(mes)) return mes;
  const texto = new Date(
    Number(mes.slice(0, 4)),
    Number(mes.slice(5, 7)) - 1,
    1,
  ).toLocaleDateString("es-ES", { month: "long" });
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}
