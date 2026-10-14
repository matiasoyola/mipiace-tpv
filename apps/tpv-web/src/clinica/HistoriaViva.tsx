// clinica-6 · LA HISTORIA VIVA.
//
// Es el mockup validado el 07-10 (`docs/mockups/clinica-historia-v2.html`)
// con sus piezas en su orden: cabecera con la franja roja, «Carmen en 10
// segundos» (Hoy toca · Dolor · Última vez · Ojo hoy), y las tres
// pestañas — Pie vivo, Visitas y Documentos.
//
// Lo que tiene que ser verdad al abrirla: **en 10 segundos** se sabe qué
// le pasa al paciente, qué le toca hoy, cómo están sus pies y qué visitas
// ha tenido.
//
// ── ES UNA PANTALLA DE LECTURA ───────────────────────────────────────
//
// No escribe en la historia. Lo único que hace salir de aquí es ABRIR
// otra pantalla: la sesión de clinica-5 (con su tipo ya marcado) o la
// valoración de clinica-2. Ni un POST propio.
//
// ── Y NADA SE CALCULA AQUÍ ───────────────────────────────────────────
//
// El estado de cada zona, «hoy toca», la tendencia del dolor, el «ojo
// hoy» y la recomendada vienen **ya calculados** por `GET
// /clinica/clients/:id/historia`, con las funciones puras de
// `@mipiacetpv/clinica-sesion`. Misma razón que en la sesión de clinica-5:
// dos cálculos son dos verdades, y en «esta zona está curada» la que
// vería la podóloga sería la del navegador.
//
// Lo único que esta pantalla decide es el COLOR de cada estado y el orden
// de las tarjetas.
//
// ── Sin importes, y no por un `if` ───────────────────────────────────
//
// Decisión 8 del prompt: es historia, no caja. La respuesta **no trae una
// sola clave de dinero** para nadie, ni para la dueña, así que aquí no hay
// nada que esconder: no hay número que pintar. Lo garantiza la API y lo
// caza su test.
//
// ── El pie es EL MISMO de clinica-3 ──────────────────────────────────
//
// `MapaDelPie` con sus once zonas y su geometría, coloreado por estado.
// No se dibuja un segundo pie con la forma del mockup de este bloque: dos
// dibujos distintos del mismo pie en el mismo producto son dos sitios
// donde una zona puede caer en distinto sitio, y lo que se marca ahí es
// una úlcera. Va dicho en el `-done`.

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CalendarPlus,
  ChevronRight,
  FileText,
  Clock,
  Footprints,
  Loader2,
  Scissors,
  Syringe,
} from "lucide-react";

import {
  COLOR_DE_TIPO_DE_VISITA,
  DESCRIPCION_DE_TIPO_DE_VISITA,
  ANCHO_DE_LOS_DOS_PIES_PX,
  NOMBRE_DE_ESTADO_DE_ZONA,
  NOMBRE_DE_PULSO,
  NOMBRE_DE_TIPO_DE_VISITA,
  TIPOS_DE_VISITA,
  type EstadoDeZonaViva,
  type MapaDelPie as MapaVersionado,
  type PendienteLegible,
  type Pie,
  type TipoDeVisita,
  type VisitaLegible,
  type ZonaViva,
} from "@mipiacetpv/clinica-sesion";

import { ApiError, apiBlobWithCashier, apiWithCashier } from "../api.js";
import { MapaDelPie, type EstadoDeZona } from "./MapaDelPie.js";
import {
  ComparadorAntesDespues,
  Fotos,
  type ComparadorDeZona,
  type FotoDeLaHistoria,
} from "./Fotos.js";
import { Informe } from "./Informe.js";
import { FranjaRoja, Mal, cuantoHace, diaCorto } from "./piezas.js";
import { SesionCerrada, type SesionCerradaView } from "./SesionCerrada.js";

// ── Lo que manda la API ──────────────────────────────────────────────

interface VistaDeLaHistoria {
  cabecera: {
    paciente: {
      id: string;
      nombre: string;
      iniciales: string;
      edad: number | null;
      telefono: string | null;
      desde: string;
    };
    alertas: string[];
    alertaIds: string[];
    alertasPorValidar: boolean;
  };
  enDiezSegundos: {
    hoyToca: {
      principal: PendienteLegible;
      otros: number;
      tipo: TipoDeVisita | null;
    } | null;
    dolor: {
      puntos: Array<{ fecha: string; dolor: number }>;
      ultimo: number | null;
      anterior: number | null;
      texto: string | null;
    };
    ultimaVez: VisitaLegible | null;
    ojoHoy: { alertaId: string; titulo: string; linea: string | null } | null;
  };
  zonas: ZonaViva[];
  sensibilidad: {
    fecha: string;
    autor: string;
    sinSensibilidad: string[];
    pulsos: Record<Pie, string>;
    tipoDePie: string;
    puntosConSensibilidad: number;
    puntosTotales: number;
  } | null;
  visitas: VisitaLegible[];
  totalDeVisitas: number;
  documentos: Array<{
    clase: string;
    titulo: string;
    fecha: string | null;
    detalles: string[];
    abre: string | null;
    id: string | null;
    revocado: boolean;
  }>;
  /** clinica-4 · las fotos y el comparador por zona, ya elegidos por el
   *  servidor: «la más antigua y la última» es una regla de la historia. */
  fotos: FotoDeLaHistoria[];
  comparador: ComparadorDeZona[];
  consentimientoDeFotos: { puede: boolean; plantillaId: string };
  recomendada: { tipo: TipoDeVisita; motivo: string } | null;
  listas: { mapa: MapaVersionado };
  ahora: string;
}

/** El detalle de una visita. Es lo que `SesionCerrada` pinta, SIN su
 *  bloque de caja: por eso `resumen` no viene (ver `SesionCerrada`). */
interface DetalleDeVisita {
  entryId: string;
  cerradaEn: string;
  firma: SesionCerradaView["firma"];
  cuerpo: SesionCerradaView["cuerpo"];
  marcas: SesionCerradaView["marcas"];
}

// clinica-4 · dos pestañas más: las fotos del paciente y el informe. La
// historia LEE las fotos y los consentimientos (hacerlos y firmarlos es de
// la visita, en la sesión); el informe sí se saca desde aquí, que es donde
// se tiene delante la historia entera (decisión 15).
type Pestania = "pie" | "visitas" | "fotos" | "docs" | "informe";
type Capa = "lesiones" | "sensibilidad";

/** El color de cada estado, en las clases del mapa. Es la traducción de
 *  `EstadoDeZonaViva` (dato clínico) a `EstadoDeZona` (cómo se pinta), y
 *  está aquí porque el paquete no sabe de Tailwind. */
const PINTURA: Record<EstadoDeZonaViva, EstadoDeZona> = {
  ACTIVA: "activa",
  MEJORANDO: "mejorando",
  CURADA: "curada",
};

/**
 * El icono de cada tipo en la hoja de «¿Qué visita es hoy?».
 *
 * Los del mockup validado, con lo que la casa ya tiene: la lima de la
 * quiropodia es unas tijeras, el triángulo del pie de riesgo es el mismo,
 * la huella de la biomecánica es `Footprints` (el mismo icono con el que
 * la agenda abre la sesión), el bisturí de la cirugía es la jeringa de la
 * anestesia y el reloj de «General» es el mismo reloj. Son cinco y están
 * en un `Record`, así que un tipo nuevo sin icono no compila.
 */
const ICONO_DE_TIPO: Record<TipoDeVisita, typeof Scissors> = {
  QUIROPODIA: Scissors,
  PIE_RIESGO: AlertTriangle,
  BIOMECANICA: Footprints,
  CIRUGIA: Syringe,
  GENERAL: Clock,
};

/**
 * El padding lateral de la tarjeta del mapa, los dos lados: `sm:px-5`.
 *
 * Se nombra porque entra en la cuenta de la columna, y una cuenta con un
 * 40 suelto dentro es una cuenta que nadie puede revisar.
 */
const PADDING_DE_LA_TARJETA_PX = 40;

/**
 * LA COLUMNA DEL PIE VIVO, de `lg` para arriba: 576 px.
 *
 * Es la pareja de pies a tamaño nominal (536, del paquete) más el padding
 * de su tarjeta. No es decoración: es lo que hace que a 1024 **los dos
 * pies quepan uno al lado del otro**, que es como los pone la maqueta
 * validada.
 *
 * Antes la rejilla era `lg:grid-cols-2`, o sea 480 px a 1024, y el pie
 * derecho se iba bajo el pliegue: para ver el estado completo del pie
 * había que hacer scroll — justo lo que esta pantalla existe para no
 * pedir. Es la misma cuenta que clinica-3 hizo para la sesión (§7.2), y
 * ahora sale de una constante en vez de estar escrita dos veces.
 *
 * Se EXPORTA sólo para su test: es quien compara este número con el 576
 * que la clase de Tailwind lleva literal, y el que se pone rojo si los dos
 * se separan.
 */
export const COLUMNA_DEL_PIE_PX =
  ANCHO_DE_LOS_DOS_PIES_PX + PADDING_DE_LA_TARJETA_PX;

const INSIGNIA: Record<EstadoDeZonaViva, string> = {
  ACTIVA: "bg-red-100 text-red-800",
  MEJORANDO: "bg-amber-100 text-amber-800",
  CURADA: "bg-emerald-100 text-emerald-800",
};


export function HistoriaViva(props: {
  clientId: string;
  /**
   * Abrir la sesión de clinica-5 con esos tipos ya marcados.
   *
   * `undefined` cuando no hay cita detrás. Y entonces los dos botones que
   * abren una visita **no salen**, en vez de salir y fallar: una sesión
   * clínica cuelga de una CITA desde clinica-3 (su decisión 6), y desde la
   * ficha de un cliente no hay ninguna. La pantalla lo dice con una línea
   * en vez de ofrecer un botón que no puede cumplir.
   */
  onEmpezarVisita?: (tipos: TipoDeVisita[]) => void;
  /** Abrir la valoración del paciente (clinica-2), desde Documentos. */
  onAbrirValoracion?: () => void;
}) {
  const [vista, setVista] = useState<VistaDeLaHistoria | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [pestania, setPestania] = useState<Pestania>("pie");
  const [capa, setCapa] = useState<Capa>("lesiones");
  const [zonaElegida, setZonaElegida] = useState<string | null>(null);
  const [hoja, setHoja] = useState<null | { sugerido: TipoDeVisita | null }>(
    null,
  );
  const [detalle, setDetalle] = useState<DetalleDeVisita | null>(null);
  const [abriendo, setAbriendo] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setError(null);
    try {
      setVista(
        await apiWithCashier<VistaDeLaHistoria>(
          `/clinica/clients/${props.clientId}/historia`,
        ),
      );
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "No se pudo abrir la historia (¿sin conexión?).",
      );
    } finally {
      setCargando(false);
    }
  }, [props.clientId]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  // La zona abierta en el panel de la derecha: la elegida, o la primera
  // que haya. Nunca el hueco: abrir el pie vivo y encontrarse una columna
  // vacía al lado es la pantalla pidiendo un toque para enseñar lo que ya
  // podría estar enseñando.
  const zona = useMemo<ZonaViva | null>(() => {
    if (!vista) return null;
    return (
      vista.zonas.find((z) => z.clave === zonaElegida) ?? vista.zonas[0] ?? null
    );
  }, [vista, zonaElegida]);

  const ahora = useMemo(
    () => (vista ? new Date(vista.ahora) : new Date()),
    [vista],
  );

  if (cargando) {
    return (
      <div className="flex items-center gap-2 text-[13px] text-slate-500 py-10 justify-center">
        <Loader2 className="w-4 h-4 animate-spin" /> Abriendo la historia…
      </div>
    );
  }
  if (error || !vista) {
    return <Mal>{error ?? "No se pudo abrir la historia."}</Mal>;
  }

  const { cabecera, enDiezSegundos } = vista;

  function abrirConTipo(tipo: TipoDeVisita | null) {
    setHoja(null);
    props.onEmpezarVisita?.(tipo ? [tipo] : []);
  }

  /**
   * El PDF de un consentimiento firmado.
   *
   * Pasa por la API con sesión —el volumen no lo sirve Caddy— y por tanto
   * **la apertura deja su línea en el registro de accesos**. El
   * `objectURL` se suelta al minuto: un PDF con datos de salud retenido en
   * la memoria de una tablet compartida es un dato de salud ahí dentro.
   */
  async function abrirPdfDeConsentimiento(consentimientoId: string) {
    try {
      const { blob } = await apiBlobWithCashier(
        `/clinica/clients/${props.clientId}/consentimientos/${consentimientoId}/pdf`,
      );
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener");
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "No se pudo abrir el documento.",
      );
    }
  }

  async function abrirVisita(entryId: string) {
    setAbriendo(entryId);
    try {
      setDetalle(
        await apiWithCashier<DetalleDeVisita>(
          `/clinica/clients/${props.clientId}/historia/visitas/${entryId}`,
        ),
      );
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "No se pudo abrir la visita.",
      );
    } finally {
      setAbriendo(null);
    }
  }

  if (detalle) {
    return (
      <div data-test="historia-visita">
        <button
          type="button"
          onClick={() => setDetalle(null)}
          className="min-h-touch px-4 rounded-2xl bg-white border border-slate-200 text-[14px] font-medium"
        >
          ← Volver a la historia
        </button>
        <SesionCerrada
          cerrada={{
            entryId: detalle.entryId,
            cerradaEn: detalle.cerradaEn,
            firma: detalle.firma,
            cuerpo: detalle.cuerpo,
            marcas: detalle.marcas,
          }}
          // Sin caja: aquí no hay importes, ni para la dueña. `SesionCerrada`
          // sin `resumen` no pinta el bloque de cobro — ver su cabecera.
          verImportes={false}
          paciente={cabecera.paciente.nombre}
        />
      </div>
    );
  }

  return (
    <div className="pb-6" data-test="historia-viva">
      {/* ── La cabecera ─────────────────────────────────────────── */}
      <div className="flex gap-4 items-center flex-wrap">
        <div
          aria-hidden
          className="w-[60px] h-[60px] rounded-[20px] bg-gradient-to-br from-[#F4A48F] to-mipiace-coral text-white font-bold text-[22px] flex items-center justify-center shrink-0"
        >
          {cabecera.paciente.iniciales}
        </div>
        <div className="flex-1 min-w-[220px]">
          <h1 className="m-0 text-[24px] font-bold tracking-[-0.01em] text-mipiace-ink">
            {cabecera.paciente.nombre}
          </h1>
          <div className="text-[14px] text-slate-500 mt-0.5">
            {[
              cabecera.paciente.edad != null
                ? `${cabecera.paciente.edad} años`
                : null,
              cabecera.paciente.telefono,
              `paciente desde ${mesYAno(cabecera.paciente.desde)}`,
            ]
              .filter(Boolean)
              .join(" · ")}
          </div>
        </div>
        {props.onEmpezarVisita && (
          <button
            type="button"
            data-test="historia-nueva-visita"
            onClick={() =>
              setHoja({ sugerido: vista.recomendada?.tipo ?? null })
            }
            className="h-[56px] px-5 rounded-[18px] bg-mipiace-ink text-white font-semibold text-[16px] flex items-center gap-2.5"
          >
            <span className="w-[26px] h-[26px] rounded-[9px] bg-mipiace-coral flex items-center justify-center">
              <CalendarPlus className="w-4 h-4" />
            </span>
            Nueva visita
          </button>
        )}
      </div>

      <div className="mt-4">
        <FranjaRoja alertas={cabecera.alertas} />
        {cabecera.alertas.length > 0 && cabecera.alertasPorValidar && (
          <div className="text-[12.5px] text-slate-500 mt-1.5">
            La valoración todavía no está validada: estas alertas son lo que
            contestó el paciente.
          </div>
        )}
      </div>

      {/* ── «En 10 segundos» ────────────────────────────────────── */}
      <div className="mt-4 grid gap-2.5 grid-cols-1 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_1fr]">
        <HoyToca
          hoyToca={enDiezSegundos.hoyToca}
          ahora={ahora}
          onEmpezar={
            props.onEmpezarVisita
              ? () =>
                  setHoja({
                    sugerido:
                      enDiezSegundos.hoyToca?.tipo ??
                      vista.recomendada?.tipo ??
                      null,
                  })
              : undefined
          }
        />
        <Ficha titulo="DOLOR">
          <div className="flex justify-between items-end gap-2">
            <div className="text-[17px] font-bold leading-tight">
              {enDiezSegundos.dolor.ultimo == null
                ? "—"
                : enDiezSegundos.dolor.anterior == null
                  ? enDiezSegundos.dolor.ultimo
                  : `${enDiezSegundos.dolor.anterior} → ${enDiezSegundos.dolor.ultimo}`}
            </div>
            <MiniDolor puntos={enDiezSegundos.dolor.puntos} />
          </div>
          <div className="text-[13px] text-mipiace-ink-soft">
            {enDiezSegundos.dolor.texto ?? "Sin visitas todavía"}
          </div>
        </Ficha>
        <Ficha
          titulo={
            enDiezSegundos.ultimaVez
              ? `ÚLTIMA VEZ · ${diaCorto(enDiezSegundos.ultimaVez.fecha).toUpperCase()}`
              : "ÚLTIMA VEZ"
          }
        >
          <div className="text-[17px] font-bold leading-tight">
            {enDiezSegundos.ultimaVez?.titulo ?? "Primera visita"}
          </div>
          <div className="text-[13px] text-mipiace-ink-soft">
            {enDiezSegundos.ultimaVez
              ? (enDiezSegundos.ultimaVez.chips[0] ??
                cuantoHace(enDiezSegundos.ultimaVez.fecha, ahora))
              : "Todavía no ha venido"}
          </div>
        </Ficha>
        <Ficha titulo="OJO HOY" aviso={enDiezSegundos.ojoHoy != null}>
          <div
            className={`text-[17px] font-bold leading-tight ${
              enDiezSegundos.ojoHoy ? "text-red-800" : ""
            }`}
          >
            {enDiezSegundos.ojoHoy?.titulo ?? "Nada que vigilar"}
          </div>
          <div className="text-[13px] text-mipiace-ink-soft">
            {enDiezSegundos.ojoHoy?.linea ?? "Sin alertas en la valoración"}
          </div>
        </Ficha>
      </div>

      {/* ── Las tres pestañas ───────────────────────────────────── */}
      <div
        role="tablist"
        aria-label="Historia del paciente"
        // clinica-4 · ya son CINCO. `max-w-full` con su propio scroll
        // horizontal: lo que no puede pasar es que la tira empuje el ancho
        // de la página y la historia entera se mueva a lo ancho a 390.
        className="mt-5 inline-flex max-w-full overflow-x-auto bg-white border border-slate-200 rounded-2xl p-1 gap-1"
      >
        {(
          [
            ["pie", "Pie"],
            ["visitas", "Visitas"],
            ["fotos", "Fotos"],
            ["docs", "Documentos"],
            ["informe", "Informe"],
          ] as ReadonlyArray<readonly [Pestania, string]>
        ).map(([id, texto]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={pestania === id}
            onClick={() => setPestania(id)}
            className={`h-touch px-4 rounded-xl text-[15px] ${
              pestania === id
                ? "bg-mipiace-ink text-white font-medium"
                : "text-slate-500"
            }`}
          >
            {texto}
          </button>
        ))}
      </div>

      {pestania === "pie" && (
        <div
          // El 576 va LITERAL y no interpolado: Tailwind genera las clases
          // leyendo el fichero, y una clase construida en tiempo de
          // ejecución no existiría en el CSS. La copia la ata su test, que
          // la compara con `COLUMNA_DEL_PIE_PX` — el mismo trato que
          // `clinica-tipos-panel.test.ts` le da a las listas duplicadas del
          // panel.
          className="mt-3.5 grid gap-3.5 grid-cols-1 lg:grid-cols-[576px_minmax(0,1fr)]"
          data-test="historia-pie-vivo"
        >
          <div className="bg-white border border-slate-200 rounded-3xl px-3 sm:px-5 py-4">
            <h2 className="m-0 text-[17px] font-bold text-mipiace-ink">
              Cómo están sus pies
            </h2>
            <div className="text-[13px] text-slate-500 mt-0.5">
              {vista.zonas.length === 0
                ? "Nunca se le ha marcado nada en el pie"
                : "Toca una zona para ver su historia"}
            </div>
            <div className="flex gap-1.5 mt-3">
              {(
                [
                  ["lesiones", "Lesiones"],
                  ["sensibilidad", "Sensibilidad"],
                ] as ReadonlyArray<readonly [Capa, string]>
              ).map(([id, texto]) => (
                <button
                  key={id}
                  type="button"
                  aria-pressed={capa === id}
                  onClick={() => setCapa(id)}
                  // `min-h-touch` (48) y no el `height: 40px` del mockup:
                  // la MEDICIÓN de la captura los pilló en 40 px, por
                  // debajo del 44 del prompt y del 48 de la casa. El
                  // mockup es la spec de lo que se ve, no del peldaño
                  // táctil — ése lo pone `docs/design/tokens.md` §4.
                  className={`min-h-touch px-3.5 rounded-xl text-[14px] font-medium ${
                    capa === id
                      ? "bg-mipiace-coral-soft text-mipiace-coral-dark"
                      : "bg-mipiace-stone text-mipiace-ink-soft"
                  }`}
                >
                  {texto}
                </button>
              ))}
            </div>
            <div className="mt-2">
              <MapaDelPie
                // Los dos pies en UNA fila de `lg` para arriba. A 390 se
                // apilan a propósito: ver `COLUMNA_DEL_PIE_PX`.
                unaFilaDesdeLg
                mapa={vista.listas.mapa}
                estadoDe={(clave) => {
                  if (capa === "sensibilidad") {
                    return vista.sensibilidad?.sinSensibilidad.includes(clave)
                      ? "sinSensibilidad"
                      : "libre";
                  }
                  const z = vista.zonas.find((x) => x.clave === clave);
                  return z ? PINTURA[z.estado] : "libre";
                }}
                seleccionada={capa === "lesiones" ? (zona?.clave ?? null) : null}
                onTocar={(clave) => {
                  if (capa !== "lesiones") return;
                  if (vista.zonas.some((z) => z.clave === clave)) {
                    setZonaElegida(clave);
                  }
                }}
                soloLectura={capa === "sensibilidad"}
              />
            </div>
            <Leyenda capa={capa} />
          </div>

          {capa === "lesiones" ? (
            <PanelDeZona
              zona={zona}
              clientId={props.clientId}
              // clinica-4 · el comparador de ESTA zona. El hueco de
              // clinica-6 («Sin fotos de esta zona») deja de ser un hueco
              // cuando hay fotos (decisión 14).
              comparador={
                zona
                  ? (vista.comparador.find((c) => c.zona === zona.clave) ??
                    null)
                  : null
              }
            />
          ) : (
            <PanelDeSensibilidad sensibilidad={vista.sensibilidad} />
          )}
        </div>
      )}

      {pestania === "visitas" && (
        <div className="mt-3.5 grid gap-2.5" data-test="historia-visitas">
          {vista.visitas.length === 0 && (
            <Vacio>Todavía no tiene ninguna visita cerrada.</Vacio>
          )}
          {vista.visitas.map((v) => (
            <FilaDeVisita
              key={v.entryId}
              visita={v}
              abriendo={abriendo === v.entryId}
              onAbrir={() => void abrirVisita(v.entryId)}
            />
          ))}
          {vista.totalDeVisitas > vista.visitas.length && (
            <div className="text-[13px] text-slate-500 text-center py-2">
              Y {vista.totalDeVisitas - vista.visitas.length} visitas más
              antiguas, que no caben en esta pantalla.
            </div>
          )}
        </div>
      )}

      {/* clinica-4 · LAS FOTOS del paciente, de solo lectura: aquí no hay
          cámara porque no hay cita detrás (las fotos se hacen desde la
          sesión, decisión 9). La pieza es la MISMA que la de la sesión y
          se le pasa sin `appointmentId`: ella dice dónde se hacen, en vez
          de ofrecer un botón que no puede cumplir — la decisión que
          clinica-6 tomó con «Hoy toca». */}
      {pestania === "fotos" && (
        <div className="mt-3.5" data-test="historia-fotos">
          <Fotos clientId={props.clientId} mapa={vista.listas.mapa} />
        </div>
      )}

      {pestania === "docs" && (
        <div className="mt-3.5 grid gap-2.5" data-test="historia-documentos">
          {vista.documentos.length === 0 && (
            <Vacio>
              Todavía no hay documentos: ni valoración, ni consentimientos
              firmados, ni informes entregados.
            </Vacio>
          )}
          {vista.documentos.map((d) => {
            // Qué hace la fila al tocarla. Tres clases, tres destinos, y
            // la que no abre nada sale sin flecha en vez de parecer que se
            // puede abrir: una fila que no hace nada al tocarla es la que
            // la podóloga toca tres veces.
            const abreValoracion =
              d.abre === "VALORACION" && props.onAbrirValoracion != null;
            const abrePdf = d.abre === "PDF_CONSENTIMIENTO" && d.id != null;
            return (
              <button
                key={`${d.clase}-${d.id ?? d.titulo}`}
                type="button"
                data-test={`documento-${d.clase}`}
                disabled={!abreValoracion && !abrePdf}
                onClick={() => {
                  if (abreValoracion) props.onAbrirValoracion!();
                  else if (abrePdf) void abrirPdfDeConsentimiento(d.id!);
                }}
                className="w-full text-left grid grid-cols-[112px_1fr_auto] gap-3.5 items-center bg-white border border-slate-200 rounded-[20px] px-4 py-3 disabled:cursor-default"
              >
                <span
                  className={`justify-self-start rounded-xl px-2.5 py-1.5 text-[13px] font-bold ${
                    d.clase === "VALORACION"
                      ? "bg-emerald-100 text-emerald-800"
                      : d.clase === "CONSENTIMIENTO"
                        ? d.revocado
                          ? "bg-slate-200 text-slate-600"
                          : "bg-mipiace-coral-soft text-mipiace-coral-dark"
                        : "bg-slate-100 text-slate-700"
                  }`}
                >
                  {d.clase === "VALORACION"
                    ? "Valoración"
                    : d.clase === "CONSENTIMIENTO"
                      ? "Consent."
                      : "Informe"}
                </span>
                <span>
                  <span className="font-bold text-[16px]">{d.titulo}</span>
                  {d.fecha && (
                    <span className="text-slate-500 text-[13px] ml-1.5">
                      {diaCorto(d.fecha)}
                    </span>
                  )}
                  <span className="flex flex-wrap gap-1.5 mt-1.5">
                    {d.detalles.map((x) => (
                      <span
                        key={x}
                        className="bg-mipiace-stone rounded-[10px] px-2.5 py-1 text-[13px]"
                      >
                        {x}
                      </span>
                    ))}
                  </span>
                </span>
                {(abreValoracion || abrePdf) &&
                  (abrePdf ? (
                    <FileText className="w-5 h-5 text-slate-400" />
                  ) : (
                    <ChevronRight className="w-5 h-5 text-slate-400" />
                  ))}
              </button>
            );
          })}
        </div>
      )}

      {/* clinica-4 · EL INFORME. Se saca desde aquí (decisión 15): es
          donde se tiene delante la historia entera, que es lo que el
          informe resume. */}
      {pestania === "informe" && (
        <div className="mt-3.5" data-test="historia-informe">
          <Informe clientId={props.clientId} />
        </div>
      )}

      {hoja && (
        <HojaDeTipo
          sugerido={hoja.sugerido}
          motivo={
            hoja.sugerido === enDiezSegundos.hoyToca?.tipo
              ? "Lo que toca hoy"
              : (vista.recomendada?.motivo ?? null)
          }
          onElegir={abrirConTipo}
          onCerrar={() => setHoja(null)}
        />
      )}
    </div>
  );
}

// ── Las piezas ───────────────────────────────────────────────────────

function Ficha(props: {
  titulo: string;
  aviso?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`rounded-[20px] px-4 py-3.5 border flex flex-col gap-1.5 min-h-[104px] ${
        props.aviso
          ? "bg-red-50 border-red-200"
          : "bg-white border-slate-200"
      }`}
    >
      <div
        className={`text-[12px] font-medium ${
          props.aviso ? "text-red-800" : "text-slate-500"
        }`}
      >
        {props.titulo}
      </div>
      {props.children}
    </div>
  );
}

/**
 * LA TARJETA GRANDE. Doble ancho, coral, con el punto que late.
 *
 * Y **se pulsa**: abre la hoja con el tipo del pendiente ya recomendado.
 * Sin pendientes dice «Nada pendiente» y no late — un punto latiendo sobre
 * «nada que hacer» es exactamente la clase de alarma que enseña a no mirar
 * las alarmas.
 */
function HoyToca(props: {
  hoyToca: {
    principal: PendienteLegible;
    otros: number;
    tipo: TipoDeVisita | null;
  } | null;
  ahora: Date;
  onEmpezar?: () => void;
}) {
  if (!props.hoyToca) {
    return (
      <div className="rounded-[20px] px-4 py-3.5 bg-white border border-slate-200 flex flex-col gap-1.5 min-h-[104px]">
        <div className="text-[12px] font-medium text-slate-500">HOY TOCA</div>
        <div className="text-[17px] font-bold leading-tight">
          Nada pendiente
        </div>
        <div className="text-[13px] text-mipiace-ink-soft">
          La última visita no dejó nada apuntado.
        </div>
      </div>
    );
  }
  const { principal, otros } = props.hoyToca;
  const cuerpo = (
    <>
      <div className="flex items-center gap-1.5 text-[12px] font-bold">
        {/* EL PUNTO QUE LATE. Dos capas: el punto y su onda. Con
            `prefers-reduced-motion` se queda el punto y se va la onda —
            la información (hay algo pendiente) está en el punto, no en
            el movimiento. */}
        <span aria-hidden className="relative flex w-2.5 h-2.5">
          <span className="absolute inset-0 rounded-full bg-white opacity-75 animate-ping motion-reduce:hidden" />
          <span className="relative inline-flex w-2.5 h-2.5 rounded-full bg-white" />
        </span>
        HOY TOCA
      </div>
      <div className="text-[19px] font-bold leading-tight">
        {principal.titulo}
        {otros > 0 && (
          <span className="ml-2 text-[14px] font-semibold opacity-90">
            +{otros}
          </span>
        )}
      </div>
      <div className="text-[13px] text-[#FFF1EC]">
        {[
          cuantoHace(principal.desde, props.ahora),
          principal.zona,
          principal.nota,
        ]
          .filter(Boolean)
          .join(" · ")}
      </div>
    </>
  );
  if (!props.onEmpezar) {
    return (
      <div
        data-test="historia-hoy-toca"
        className="rounded-[20px] px-4 py-3.5 bg-gradient-to-br from-[#FF9A76] to-mipiace-coral text-white flex flex-col gap-1.5 min-h-[104px]"
      >
        {cuerpo}
        <div className="text-[12.5px] text-[#FFF1EC] mt-auto">
          Para empezarla, ábrela desde su cita en la agenda.
        </div>
      </div>
    );
  }
  return (
    <button
      type="button"
      data-test="historia-hoy-toca"
      onClick={props.onEmpezar}
      className="text-left rounded-[20px] px-4 py-3.5 bg-gradient-to-br from-[#FF9A76] to-mipiace-coral text-white flex flex-col gap-1.5 min-h-[104px] shadow-[0_10px_24px_rgba(233,112,88,.35)]"
    >
      {cuerpo}
      <span className="mt-auto self-start bg-white text-mipiace-coral-dark font-bold text-[15px] rounded-2xl px-4 min-h-touch inline-flex items-center">
        Empezar esta revisión →
      </span>
    </button>
  );
}

/** La mini-gráfica de la tarjeta del dolor: las últimas barras y nada
 *  más. La gráfica con números y etiquetas es la de la sesión. */
function MiniDolor(props: { puntos: Array<{ fecha: string; dolor: number }> }) {
  if (props.puntos.length === 0) return null;
  return (
    <div
      className="flex items-end gap-1.5 h-[30px]"
      role="img"
      aria-label={`Dolor: ${props.puntos.map((p) => p.dolor).join(", ")} de 10`}
    >
      {props.puntos.map((p, i) => (
        <i
          key={`${p.fecha}-${i}`}
          className={`block w-4 rounded-[5px] ${colorDeDolor(p.dolor)}`}
          style={{ height: Math.max(4, p.dolor * 3) }}
        />
      ))}
    </div>
  );
}

function colorDeDolor(n: number): string {
  return n >= 7 ? "bg-red-600" : n >= 4 ? "bg-amber-500" : "bg-emerald-500";
}

function Leyenda(props: { capa: Capa }) {
  const items =
    props.capa === "lesiones"
      ? ([
          ["bg-red-600", "Activa"],
          ["bg-amber-500", "Mejorando"],
          ["bg-emerald-500", "Curada"],
        ] as const)
      : ([["bg-red-500", "No siente el monofilamento"]] as const);
  return (
    <div className="flex gap-4 flex-wrap justify-center text-[13px] text-mipiace-ink-soft mt-2.5">
      {items.map(([clase, texto]) => (
        <span key={texto} className="inline-flex items-center gap-1.5">
          <i className={`inline-block w-3 h-3 rounded-full ${clase}`} />
          {texto}
        </span>
      ))}
    </div>
  );
}

/** La línea de evolución de una zona, y su comparador de fotos. */
function PanelDeZona(props: {
  zona: ZonaViva | null;
  clientId: string;
  comparador: ComparadorDeZona | null;
}) {
  const z = props.zona;
  if (!z) {
    return (
      <div className="bg-white border border-slate-200 rounded-3xl px-3 sm:px-5 py-4">
        <Vacio>
          Cuando se le marque algo en el pie, aquí sale cómo ha ido cada zona.
        </Vacio>
      </div>
    );
  }
  const pasos: Array<{
    clave: string;
    fecha: string;
    titulo: string;
    sub: string;
    punto: string;
  }> = z.pasos.map((p) => ({
    clave: `${p.entryId}-${p.fecha}`,
    fecha: p.fecha,
    titulo: p.gravedadNombre ?? p.lesionNombre,
    sub: p.tiposNombre.join(" + ") || "Sesión",
    punto:
      p.gravedad === "SEVERA"
        ? "bg-red-600"
        : p.gravedad === "MODERADA"
          ? "bg-red-500"
          : p.gravedad === "LEVE"
            ? "bg-amber-500"
            : "bg-slate-400",
  }));
  if (z.curadaEn) {
    pasos.push({
      clave: z.curadaEn.entryId,
      fecha: z.curadaEn.fecha,
      titulo: "Curada",
      sub: "Ya no estaba marcada",
      punto: "bg-emerald-500",
    });
  }
  return (
    <div
      className="bg-white border border-slate-200 rounded-3xl px-3 sm:px-5 py-4"
      data-test="historia-zona"
    >
      <div className="flex justify-between items-start gap-2.5">
        <div>
          <h2 className="m-0 text-[17px] font-bold text-mipiace-ink">
            {z.lesionNombre}
          </h2>
          <div className="text-[13px] text-slate-500 mt-0.5">{z.nombre}</div>
        </div>
        <span
          className={`rounded-xl px-3 py-1.5 font-bold text-[14px] ${INSIGNIA[z.estado]}`}
        >
          {NOMBRE_DE_ESTADO_DE_ZONA[z.estado]}
        </span>
      </div>

      <ol className="flex gap-0 mt-3.5 overflow-x-auto list-none p-0 m-0">
        {pasos.map((p) => (
          <li
            key={p.clave}
            className="flex-1 min-w-[110px] relative pt-6 text-center"
          >
            {/* La línea va ANTES que el punto en el DOM para que el
                punto la tape, y no al revés: un `z-index` aquí crearía un
                contexto de apilado dentro de una tarjeta que ya vive en
                un overlay, y ésa es la trampa que clinica-3 §7.1 pagó. */}
            <span
              aria-hidden
              className="absolute top-[9px] left-0 right-0 h-[3px] bg-slate-200"
            />
            <span
              aria-hidden
              className={`absolute top-0.5 left-1/2 -translate-x-1/2 w-[17px] h-[17px] rounded-full border-[3px] border-white ring-1 ring-slate-200 ${p.punto}`}
            />
            <div className="text-[12px] text-slate-500">
              {diaCorto(p.fecha)}
            </div>
            <div className="text-[14px] font-semibold mt-0.5">{p.titulo}</div>
            <div className="text-[12.5px] text-mipiace-ink-soft">{p.sub}</div>
          </li>
        ))}
      </ol>

      {/* clinica-4 · EL COMPARADOR de esta zona. Con dos fotos o más,
          antes y última con su fecha; con una, la que hay y por qué no se
          compara; sin ninguna, el hueco que clinica-6 dejó escrito.
          Las tres variantes las decide `ComparadorAntesDespues`, que es la
          MISMA pieza que usa la pestaña de fotos — un comparador con dos
          implementaciones es el que un día enseña distinto en cada sitio. */}
      <div className="mt-4">
        <ComparadorAntesDespues
          clientId={props.clientId}
          comparador={
            props.comparador ?? {
              zona: props.zona?.clave ?? "",
              antes: null,
              ultima: null,
              cuantas: 0,
            }
          }
        />
      </div>
    </div>
  );
}

function PanelDeSensibilidad(props: {
  sensibilidad: VistaDeLaHistoria["sensibilidad"];
}) {
  const s = props.sensibilidad;
  return (
    <div
      className="bg-white border border-slate-200 rounded-3xl px-3 sm:px-5 py-4"
      data-test="historia-sensibilidad"
    >
      <div className="flex justify-between items-start gap-2.5">
        <div>
          <h2 className="m-0 text-[17px] font-bold text-mipiace-ink">
            Sensibilidad
          </h2>
          <div className="text-[13px] text-slate-500 mt-0.5">
            {s
              ? `Monofilamento · ${diaCorto(s.fecha)} · ${s.autor}`
              : "Sin explorar"}
          </div>
        </div>
        {s && (
          <span
            className={`rounded-xl px-3 py-1.5 font-bold text-[14px] ${
              s.sinSensibilidad.length === 0
                ? "bg-emerald-100 text-emerald-800"
                : "bg-red-100 text-red-800"
            }`}
          >
            {s.sinSensibilidad.length === 0 ? "Normal" : "Pérdida"}
          </span>
        )}
      </div>
      {!s ? (
        <Vacio>
          A este paciente no se le ha hecho ninguna exploración todavía. Se hace
          desde la sesión, en su pestaña.
        </Vacio>
      ) : (
        <>
          <div className="mt-3.5 text-[15px]">
            <b className="text-[17px]">
              {s.puntosConSensibilidad} de {s.puntosTotales}
            </b>{" "}
            puntos con sensibilidad
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5 text-[13px]">
            <span className="bg-mipiace-stone rounded-[10px] px-2.5 py-1">
              Pulso izquierdo: {NOMBRE_DE_PULSO[s.pulsos.L as "PRESENTE"]}
            </span>
            <span className="bg-mipiace-stone rounded-[10px] px-2.5 py-1">
              Pulso derecho: {NOMBRE_DE_PULSO[s.pulsos.R as "PRESENTE"]}
            </span>
          </div>
          <div className="mt-3 text-[13px] text-slate-500">
            Es de LECTURA: para cambiarla, haz una exploración nueva desde la
            sesión.
          </div>
        </>
      )}
    </div>
  );
}

function FilaDeVisita(props: {
  visita: VisitaLegible;
  abriendo: boolean;
  onAbrir: () => void;
}) {
  const v = props.visita;
  const tipo = v.tipos[0] ?? null;
  const color = tipo ? COLOR_DE_TIPO_DE_VISITA[tipo] : "#64748B";
  return (
    <button
      type="button"
      onClick={props.onAbrir}
      data-test="historia-visita-fila"
      className="w-full text-left grid grid-cols-[1fr_auto] sm:grid-cols-[128px_1fr_auto] gap-3.5 items-center bg-white border border-slate-200 rounded-[20px] px-4 py-3"
    >
      <span
        className="col-span-2 sm:col-span-1 justify-self-start rounded-xl px-2.5 py-1.5 text-[13px] font-bold whitespace-nowrap"
        style={{ color, backgroundColor: `${color}1A` }}
      >
        {tipo ? NOMBRE_DE_TIPO_DE_VISITA[tipo] : "Sesión"}
      </span>
      <span>
        <span className="font-bold text-[16px]">{v.titulo}</span>
        {v.nivel != null && <Barras nivel={v.nivel} />}
        <span className="text-slate-500 text-[13px] ml-1.5 font-normal">
          {diaCorto(v.fecha)}
        </span>
        {v.chips.length > 0 && (
          <span className="flex flex-wrap gap-1.5 mt-1.5">
            {v.chips.map((c) => (
              <span
                key={c}
                className="bg-mipiace-stone rounded-[10px] px-2.5 py-1 text-[13px]"
              >
                {c}
              </span>
            ))}
          </span>
        )}
      </span>
      <span className="flex items-center gap-2">
        {props.abriendo && <Loader2 className="w-4 h-4 animate-spin" />}
        {v.dolor != null && (
          <span
            className={`w-[52px] h-[52px] rounded-2xl text-white text-[24px] font-bold flex items-center justify-center ${colorDeDolor(v.dolor)}`}
            aria-label={`Dolor ${v.dolor} de 10`}
          >
            {v.dolor}
          </span>
        )}
      </span>
    </button>
  );
}

/** Las tres barras del nivel de quiropodia, del mockup. */
function Barras(props: { nivel: number }) {
  return (
    <span className="inline-flex items-center gap-[3px] ml-2 align-middle">
      {[1, 2, 3].map((i) => (
        <i
          key={i}
          className={`inline-block w-3.5 h-2 rounded-[4px] ${
            i <= props.nivel ? "bg-mipiace-coral" : "bg-[#F1E6E1]"
          }`}
        />
      ))}
    </span>
  );
}

/**
 * LA HOJA de «¿Qué visita es hoy?», con las cinco tarjetas y una
 * recomendada.
 *
 * El tipo elegido se le pasa a la sesión de clinica-5 ya marcado — que es
 * todo lo que este bloque hace con ella. La sesión no cambia.
 */
function HojaDeTipo(props: {
  sugerido: TipoDeVisita | null;
  motivo: string | null;
  onElegir: (tipo: TipoDeVisita) => void;
  onCerrar: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 bg-[rgba(17,24,39,.45)] flex items-end justify-center"
      role="dialog"
      aria-modal="true"
      aria-label="¿Qué visita es hoy?"
      onClick={props.onCerrar}
    >
      <div
        className="bg-mipiace-stone w-full max-w-[1200px] rounded-t-[28px] px-5 pt-5 pb-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="m-0 text-[20px] font-bold">¿Qué visita es hoy?</h3>
        <div className="text-[14px] text-slate-500 mt-0.5">
          Cada tipo abre su pantalla, con sus botones. Nada que escribir.
        </div>
        <div className="mt-4 grid gap-2.5 grid-cols-2 lg:grid-cols-5">
          {TIPOS_DE_VISITA.map((t) => {
            const esSugerido = t === props.sugerido;
            const Icono = ICONO_DE_TIPO[t];
            return (
              <button
                key={t}
                type="button"
                data-test={`historia-tipo-${t}`}
                onClick={() => props.onElegir(t)}
                className={`relative bg-white rounded-[22px] px-3 py-4 text-center flex flex-col items-center gap-2 min-h-[150px] border-2 ${
                  esSugerido
                    ? "border-mipiace-coral shadow-[0_8px_22px_rgba(233,112,88,.25)]"
                    : "border-slate-200"
                }`}
              >
                {esSugerido && props.motivo && (
                  <span className="absolute -top-[11px] left-1/2 -translate-x-1/2 bg-mipiace-coral text-white text-[12px] font-bold rounded-[10px] px-2.5 py-0.5 whitespace-nowrap">
                    {props.motivo}
                  </span>
                )}
                <span
                  className="w-[52px] h-[52px] rounded-[17px] flex items-center justify-center"
                  style={{
                    backgroundColor: `${COLOR_DE_TIPO_DE_VISITA[t]}1A`,
                    color: COLOR_DE_TIPO_DE_VISITA[t],
                  }}
                  aria-hidden
                >
                  <Icono className="w-6 h-6" strokeWidth={2.2} />
                </span>
                <span className="font-bold text-[16px]">
                  {NOMBRE_DE_TIPO_DE_VISITA[t]}
                </span>
                <span className="text-[12.5px] text-slate-500 leading-snug">
                  {DESCRIPCION_DE_TIPO_DE_VISITA[t]}
                </span>
              </button>
            );
          })}
        </div>
        <button
          type="button"
          onClick={props.onCerrar}
          className="mt-3.5 w-full h-[50px] rounded-2xl bg-white border border-slate-200 font-semibold"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}

function Vacio(props: { children: React.ReactNode }) {
  return (
    <div className="text-[13.5px] text-slate-500 bg-mipiace-stone rounded-2xl px-4 py-5 text-center">
      {props.children}
    </div>
  );
}

/** «sep 2026». La fecha de alta del paciente no se enseña al día: lo que
 *  significa es «lleva viniendo desde entonces». */
function mesYAno(iso: string): string {
  return new Date(iso).toLocaleDateString("es-ES", {
    month: "short",
    year: "numeric",
  });
}
