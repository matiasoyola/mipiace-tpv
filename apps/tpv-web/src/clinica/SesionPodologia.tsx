// clinica-3 · la pantalla de la sesión y de la exploración.
//
// Es el mockup validado (`docs/mockups/clinica-3-sesion.html`) con sus
// piezas en su orden: cabecera de fichas, FRANJA ROJA de alertas, las dos
// pestañas, el mapa de los dos pies, la gráfica del dolor, el panel de la
// sesión y el pie con el resumen y el botón. Y, al cerrar, la pantalla
// «Sesión cerrada» en sus dos variantes de rol.
//
// ── La forma del trabajo: mucho clic, poco escribir ──────────────────
//
// Decisión de producto 1. **Todo son botones** menos una nota plegada, y
// eso manda en cómo está escrita esta pantalla: no hay un solo `input` de
// texto fuera del `<details>`, y el estado vive en memoria hasta que se
// cierra. La mayoría de visitas son «igual que la última vez», y para eso
// hay un botón que SUMA lo de la visita anterior a lo marcado hoy.
//
// ── Quién decide, y por qué nada se calcula dos veces ────────────────
//
// `resumenDeLaSesion`, `igualQueLaUltimaVez` y `gravedadDisponible` son
// las MISMAS funciones puras que usa la API
// (`@mipiacetpv/clinica-sesion`). El servidor manda —vuelve a decidirlo al
// recibir el cierre— y aquí se usan para pintar el pie, el botón y los
// chips de gravedad desactivados sin ir y volver. Con dos cálculos, el día
// que se separaran el botón se activaría para un cierre que la API va a
// rechazar.
//
// Lo único que esta pantalla NO calcula es el dinero: `verImportes` viene
// del servidor y, cuando es `false`, **las claves de precio no están en la
// respuesta**. No hay un `?? 0` posible porque no hay nada que caiga a 0.
//
// ── Las listas vienen del servidor ───────────────────────────────────
//
// El mapa, las lesiones y los consejos los manda `GET …/sesion` con su
// versión. No se importan del paquete para pintar: son la versión con la
// que se va a ESCRIBIR, y una pantalla que pintara «la que tiene
// compilada» podría ofrecer una zona que el servidor va a tirar.

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, Loader2 } from "lucide-react";

import {
  GRAVEDADES,
  NOMBRE_DE_EVOLUCION,
  NOMBRE_DE_GRAVEDAD,
  NOMBRE_DE_PROXIMA_CITA,
  NOMBRE_DE_PULSO,
  NOMBRE_DE_TIPO_DE_PIE,
  PROXIMAS_CITAS,
  PULSOS,
  TIPOS_DE_PIE,
  EVOLUCIONES,
  gravedadDisponible,
  igualQueLaUltimaVez,
  resumenDeLaSesion,
  type Consejo,
  type Evolucion,
  type ExploracionEnPantalla,
  type Gravedad,
  type Lesion,
  type ListaDeConsejos,
  type ListaDeLesiones,
  type MapaDelPie as MapaVersionado,
  type MarcaDeZona,
  type Marcas,
  type Pie,
  type ProximaCita,
  type Pulso,
  type TipoDePie,
  type TratamientoDelCatalogo,
} from "@mipiacetpv/clinica-sesion";

import { ApiError, apiWithCashier } from "../api.js";
import { LeyendaDelMapa, MapaDelPie, type EstadoDeZona } from "./MapaDelPie.js";
import { GraficaDolor, type PuntoDeDolor } from "./GraficaDolor.js";
import { SesionCerrada, type SesionCerradaView } from "./SesionCerrada.js";

// ── La forma que devuelve la API ─────────────────────────────────────

export interface VistaDeLaSesion {
  cita: {
    id: string;
    clientId: string;
    empieza: string;
    status: string;
    servicios: string[];
    atiende: { userId: string; nombre: string } | null;
    ticketId: string | null;
  };
  cabecera: {
    paciente: {
      id: string;
      nombre: string;
      edad: number | null;
      telefono: string | null;
    };
    citaDeHoy: { empieza: string; servicios: string[] };
    numeroDeVisita: number;
    visitaAnterior: string | null;
    atiende: { userId: string; nombre: string } | null;
    alertas: string[];
  };
  puerta:
    | { puede: true; valoracionId: string; validadaEn: string }
    | { puede: false; motivo: string; mensaje: string };
  /** `precio` e `iva` NO VIENEN si `verImportes` es `false`. */
  tratamientos: Array<
    Pick<TratamientoDelCatalogo, "serviceId" | "nombre"> &
      Partial<Pick<TratamientoDelCatalogo, "precio" | "iva">>
  >;
  anterior: {
    entryId: string;
    fecha: string;
    marcas: Marcas;
    tratamientos: string[];
    consejos: string[];
    dolor: number;
  } | null;
  dolorHistorico: PuntoDeDolor[];
  exploracion: {
    departeDe: ExploracionEnPantalla;
    ultima: { fecha: string; autor: string } | null;
  };
  cerrada: SesionCerradaView | null;
  listas: {
    mapa: MapaVersionado;
    lesiones: ListaDeLesiones;
    consejos: ListaDeConsejos;
  };
  verImportes: boolean;
}

type Pestana = "sesion" | "exploracion";

export function SesionPodologia(props: {
  appointmentId: string;
  /** Para volver a la agenda tras cobrar. */
  onCobrar?: (appointmentId: string) => void;
  /** Para llevar a la valoración cuando la puerta está cerrada: es «el
   *  camino para hacerlo» que pide el prompt §2. */
  onAbrirValoracion?: (clientId: string) => void;
}) {
  const [vista, setVista] = useState<VistaDeLaSesion | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [pestana, setPestana] = useState<Pestana>("sesion");

  // ── El estado de la sesión, EN MEMORIA hasta que se cierra ────────
  //
  // No hay «guardar borrador» en el mockup y no hay estado intermedio que
  // signifique nada: media sesión guardada no es una sesión clínica
  // incompleta, es una pantalla a medio rellenar. Es la misma decisión que
  // clinica-2 tomó con las tres confirmaciones de la validación.
  const [marcas, setMarcas] = useState<Record<string, MarcaDeZona>>({});
  const [zonaAbierta, setZonaAbierta] = useState<string | null>(null);
  const [tratamientos, setTratamientos] = useState<string[]>([]);
  const [dolor, setDolor] = useState<number | null>(null);
  const [evolucion, setEvolucion] = useState<Evolucion | null>(null);
  const [consejos, setConsejos] = useState<string[]>([]);
  const [proximaCita, setProximaCita] = useState<ProximaCita | null>(null);
  const [nota, setNota] = useState("");

  // ── Y el de la exploración, que SÍ parte de la última ─────────────
  const [exploracion, setExploracion] =
    useState<ExploracionEnPantalla | null>(null);
  const [avisoExploracion, setAvisoExploracion] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setError(null);
    try {
      const v = await apiWithCashier<VistaDeLaSesion>(
        `/clinica/appointments/${props.appointmentId}/sesion`,
      );
      setVista(v);
      // «La siguiente parte de la última» (decisión de producto 5): el
      // estado de la exploración arranca con lo que el servidor dice, no
      // en blanco.
      setExploracion(v.exploracion.departeDe);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "No se pudo abrir la sesión.",
      );
    } finally {
      setCargando(false);
    }
  }, [props.appointmentId]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  // ── El resumen del pie: la MISMA función que usa la API ───────────
  const resumen = useMemo(() => {
    if (!vista) return null;
    return resumenDeLaSesion({
      tratamientos,
      // Sin importes, los `precio`/`iva` no vienen. Se rellenan a 0 para
      // la función pura PORQUE el resultado que se va a leer no lleva
      // dinero: `verImportes: false` pone `total` e `ivaTexto` en `null`
      // y los precios de las líneas también. O sea: estos ceros no pueden
      // llegar a ninguna pantalla.
      catalogo: vista.tratamientos.map((t) => ({
        serviceId: t.serviceId,
        nombre: t.nombre,
        precio: t.precio ?? 0,
        iva: t.iva ?? 0,
      })),
      dolor,
      verImportes: vista.verImportes,
    });
  }, [vista, tratamientos, dolor]);

  function alternar(lista: string[], id: string): string[] {
    return lista.includes(id)
      ? lista.filter((x) => x !== id)
      : [...lista, id];
  }

  /** «Igual que la última vez»: SUMA lo de la anterior. Nunca borra. */
  function repetir() {
    if (!vista?.anterior) return;
    const sumado = igualQueLaUltimaVez(
      { marcas, tratamientos, consejos },
      {
        marcas: vista.anterior.marcas,
        tratamientos: vista.anterior.tratamientos,
        consejos: vista.anterior.consejos,
      },
    );
    setMarcas({ ...sumado.marcas });
    setTratamientos([...sumado.tratamientos]);
    setConsejos([...sumado.consejos]);
  }

  function tocarZona(clave: string) {
    if (pestana === "exploracion") {
      setExploracion((e) =>
        e == null
          ? e
          : {
              ...e,
              sinSensibilidad: e.sinSensibilidad.includes(clave)
                ? e.sinSensibilidad.filter((x) => x !== clave)
                : [...e.sinSensibilidad, clave],
            },
      );
      return;
    }
    setZonaAbierta((z) => (z === clave ? null : clave));
  }

  async function guardarExploracion() {
    if (ocupado || !exploracion) return;
    setOcupado(true);
    setError(null);
    setAvisoExploracion(null);
    try {
      const r = await apiWithCashier<{
        exploracion: ExploracionEnPantalla | null;
        ultima: { fecha: string; autor: string } | null;
      }>(
        `/clinica/appointments/${props.appointmentId}/sesion/exploracion`,
        {
          method: "POST",
          body: {
            pulsos: exploracion.pulsos,
            sinSensibilidad: exploracion.sinSensibilidad,
            tipoDePie: exploracion.tipoDePie,
          },
        },
      );
      // Se repinta con lo que dice EL SERVIDOR y no con lo que se mandó:
      // lo que se guardó pasó por `normalizar`, así que puede no ser
      // idéntico. Misma razón por la que corregir una valoración devuelve
      // la pantalla entera en clinica-2.
      if (r.exploracion) setExploracion(r.exploracion);
      setAvisoExploracion("Exploración guardada en la historia.");
      setVista((v) =>
        v == null
          ? v
          : {
              ...v,
              exploracion: {
                departeDe: r.exploracion ?? v.exploracion.departeDe,
                ultima: r.ultima,
              },
            },
      );
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "No se pudo guardar la exploración.",
      );
    } finally {
      setOcupado(false);
    }
  }

  async function cerrar() {
    if (ocupado || !resumen?.puedeCerrar) return;
    setOcupado(true);
    setError(null);
    try {
      const r = await apiWithCashier<{
        yaEstaba: boolean;
        cerrada: SesionCerradaView;
      }>(`/clinica/appointments/${props.appointmentId}/sesion/cerrar`, {
        method: "POST",
        body: {
          marcas,
          tratamientos,
          dolor,
          evolucion,
          consejos,
          proximaCita,
          nota: nota.trim() === "" ? null : nota,
        },
      });
      setVista((v) => (v == null ? v : { ...v, cerrada: r.cerrada }));
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "No se pudo cerrar la sesión. Vuelve a intentarlo.",
      );
    } finally {
      setOcupado(false);
    }
  }

  if (cargando) {
    return (
      <div className="flex items-center gap-2 text-[13px] text-slate-500 py-10 justify-center">
        <Loader2 className="w-4 h-4 animate-spin motion-reduce:animate-none" />
        Abriendo la sesión…
      </div>
    );
  }
  if (error && !vista) return <Mal>{error}</Mal>;
  if (!vista) return null;

  // ── SESIÓN YA CERRADA: su propia pantalla ─────────────────────────
  if (vista.cerrada) {
    return (
      <SesionCerrada
        cerrada={vista.cerrada}
        verImportes={vista.verImportes}
        paciente={vista.cabecera.paciente.nombre}
        onCobrar={
          props.onCobrar && vista.verImportes && !vista.cerrada.yaCobrada
            ? () => props.onCobrar!(props.appointmentId)
            : undefined
        }
      />
    );
  }

  const lesiones = vista.listas.lesiones.lesiones;
  const marcaAbierta = zonaAbierta ? marcas[zonaAbierta] : undefined;

  return (
    <div className="space-y-4">
      <Cabecera vista={vista} />

      {/* La puerta de la valoración. Cuando está cerrada, la sesión no se
          puede cerrar — y lo que se enseña es qué falta y el camino para
          hacerlo (prompt §2). La EXPLORACIÓN sí se puede guardar, así que
          la pantalla no se bloquea: se bloquea el cierre. */}
      {!vista.puerta.puede && (
        <PuertaCerrada
          mensaje={vista.puerta.mensaje}
          onAbrirValoracion={
            props.onAbrirValoracion
              ? () => props.onAbrirValoracion!(vista.cabecera.paciente.id)
              : undefined
          }
        />
      )}

      <Pestanas
        valor={pestana}
        onCambiar={(p) => {
          setPestana(p);
          setZonaAbierta(null);
        }}
      />

      <div className="grid gap-4 xl:grid-cols-[560px_1fr]">
        {pestana === "sesion" ? (
          <>
            <div className="space-y-4">
              <Tarjeta
                titulo="Mapa del pie"
                sub="Toca la zona y elige qué tiene."
              >
                <MapaDelPie
                  mapa={vista.listas.mapa}
                  seleccionada={zonaAbierta}
                  onTocar={tocarZona}
                  estadoDe={(clave) =>
                    estadoDeLaSesion(clave, marcas, vista.anterior?.marcas)
                  }
                />
                <LeyendaDelMapa modo="sesion" />
                {zonaAbierta && (
                  <PanelDeZona
                    clave={zonaAbierta}
                    mapa={vista.listas.mapa}
                    lesiones={lesiones}
                    marca={marcaAbierta}
                    onLesion={(lesion) =>
                      setMarcas((m) => ({
                        ...m,
                        [zonaAbierta]: {
                          lesion,
                          gravedad: m[zonaAbierta]?.gravedad ?? null,
                        },
                      }))
                    }
                    onGravedad={(gravedad) =>
                      setMarcas((m) =>
                        m[zonaAbierta]
                          ? { ...m, [zonaAbierta]: { ...m[zonaAbierta]!, gravedad } }
                          : m,
                      )
                    }
                    onQuitar={() =>
                      setMarcas((m) => {
                        const { [zonaAbierta]: _fuera, ...resto } = m;
                        return resto;
                      })
                    }
                  />
                )}
                <ListaDeMarcas marcas={marcas} mapa={vista.listas.mapa} lesiones={lesiones} />
              </Tarjeta>

              <Tarjeta
                titulo="Dolor, sesión a sesión"
                sub="Lo que marca el paciente al empezar."
              >
                <GraficaDolor historico={vista.dolorHistorico} hoy={dolor} />
              </Tarjeta>
            </div>

            <PanelDeLaSesion
              vista={vista}
              tratamientos={tratamientos}
              dolor={dolor}
              evolucion={evolucion}
              consejos={consejos}
              proximaCita={proximaCita}
              nota={nota}
              hayAnterior={vista.anterior != null}
              onRepetir={repetir}
              onTratamiento={(id) => setTratamientos((t) => alternar(t, id))}
              onDolor={setDolor}
              onEvolucion={setEvolucion}
              onConsejo={(id) => setConsejos((c) => alternar(c, id))}
              onProximaCita={setProximaCita}
              onNota={setNota}
            />
          </>
        ) : (
          <>
            <Tarjeta
              titulo="Sensibilidad (monofilamento)"
              sub="Toca los puntos donde NO siente el filamento."
            >
              <MapaDelPie
                mapa={vista.listas.mapa}
                seleccionada={null}
                onTocar={tocarZona}
                estadoDe={(clave) =>
                  exploracion?.sinSensibilidad.includes(clave) ? "hoy" : "libre"
                }
              />
              <LeyendaDelMapa modo="exploracion" />
            </Tarjeta>
            <PanelDeExploracion
              exploracion={exploracion}
              ultima={vista.exploracion.ultima}
              ocupado={ocupado}
              aviso={avisoExploracion}
              onPulso={(pie, pulso) =>
                setExploracion((e) =>
                  e == null ? e : { ...e, pulsos: { ...e.pulsos, [pie]: pulso } },
                )
              }
              onTipoDePie={(tipoDePie) =>
                setExploracion((e) => (e == null ? e : { ...e, tipoDePie }))
              }
              onGuardar={guardarExploracion}
            />
          </>
        )}
      </div>

      {error && <Mal>{error}</Mal>}

      {/* ── El pie de la sesión ───────────────────────────────────── */}
      {pestana === "sesion" && resumen && (
        <div className="flex items-center justify-between gap-4 flex-wrap bg-white border border-slate-200 rounded-3xl px-5 py-4">
          <div className="text-[14px] text-mipiace-ink-soft">
            {resumen.faltaTratamiento
              ? "Marca al menos un tratamiento"
              : `${resumen.tratamientos} ${
                  resumen.tratamientos === 1 ? "tratamiento" : "tratamientos"
                }`}
            {/* El importe sólo si viene. `total` es `null` cuando la
                respuesta no trae precios, así que no hay nada que pintar
                a 0. */}
            {resumen.total != null && (
              <>
                {" · "}
                <b className="font-semibold text-mipiace-ink tabular-nums">
                  {euros(resumen.total)}
                </b>
                {resumen.ivaTexto && ` · ${resumen.ivaTexto.toLowerCase()}`}
              </>
            )}
            {resumen.faltaDolor && " · falta el dolor de hoy"}
          </div>
          <button
            type="button"
            onClick={() => void cerrar()}
            disabled={!resumen.puedeCerrar || ocupado || !vista.puerta.puede}
            className="h-touch-lg px-7 rounded-[18px] bg-mipiace-coral text-white font-medium text-[16px] disabled:opacity-45 disabled:cursor-not-allowed active:scale-[0.98] transition-transform motion-reduce:transform-none"
          >
            {ocupado ? "Cerrando…" : resumen.textoDelBoton}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Cómo se pinta cada zona en la pestaña de sesión ─────────────────

function estadoDeLaSesion(
  clave: string,
  hoy: Record<string, MarcaDeZona>,
  anterior: Marcas | undefined,
): EstadoDeZona {
  if (hoy[clave]) return "hoy";
  if (anterior?.[clave]) return "anterior";
  return "libre";
}

// ── La cabecera: fichas con título y la FRANJA ROJA ─────────────────

function Cabecera(props: { vista: VistaDeLaSesion }) {
  const c = props.vista.cabecera;
  return (
    <>
      <div className="flex justify-between gap-4 items-start flex-wrap">
        <div>
          <h1 className="text-[23px] font-semibold tracking-[-0.01em] text-mipiace-ink m-0">
            {c.paciente.nombre}
          </h1>
          {/* Las FICHAS CON TÍTULO del mockup (decisión de producto 7):
              cada dato con su etiqueta encima, para que no haya que
              adivinar si «3.ª» es la visita o la sala. */}
          <div className="flex flex-wrap gap-2 mt-2.5">
            {c.paciente.edad != null && (
              <Ficha titulo="Edad">{c.paciente.edad} años</Ficha>
            )}
            <Ficha titulo="Cita de hoy">
              {hora(c.citaDeHoy.empieza)}
              {c.citaDeHoy.servicios.length > 0 &&
                ` · ${c.citaDeHoy.servicios.join(" + ")}`}
            </Ficha>
            <Ficha titulo="Visita">
              {c.numeroDeVisita}.ª
              {c.visitaAnterior
                ? ` · la anterior, ${diaCorto(c.visitaAnterior)}`
                : " · la primera"}
            </Ficha>
            {c.atiende && <Ficha titulo="Atiende">{c.atiende.nombre}</Ficha>}
            {c.paciente.telefono && (
              <Ficha titulo="Teléfono">{c.paciente.telefono}</Ficha>
            )}
          </div>
        </div>
        <span className="shrink-0 inline-flex rounded-xl px-3 py-1.5 text-[12.5px] font-medium bg-mipiace-coral-soft text-mipiace-coral-dark">
          Sesión en curso
        </span>
      </div>
      <FranjaRoja alertas={c.alertas} />
    </>
  );
}

function Ficha(props: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl px-3 py-1.5 text-[14px] text-mipiace-ink">
      <span className="block text-[11px] text-slate-500 tracking-[0.04em]">
        {props.titulo}
      </span>
      {props.children}
    </div>
  );
}

/**
 * LA FRANJA ROJA INTENSA, con icono, «Cuidado» y letra grande.
 *
 * Decisión de producto 7, y el prompt la subraya: *aquí no prima la
 * estética: si es alerta, se ve.* Por eso el fondo es rojo pleno
 * (`red-700`) y no el `red-50` discreto que usa la pantalla de la
 * valoración — es la misma información y son dos momentos distintos: allí
 * se está revisando el test, aquí se está a punto de meter un bisturí en
 * el pie de una persona anticoagulada.
 *
 * `role="alert"` para que un lector de pantalla la anuncie sin que haya
 * que llegar a ella navegando.
 */
function FranjaRoja(props: { alertas: string[] }) {
  if (props.alertas.length === 0) {
    return (
      <div className="bg-mipiace-stone text-slate-500 rounded-2xl px-4 py-3 text-[13px]">
        Sin alertas
      </div>
    );
  }
  return (
    <div
      role="alert"
      className="flex flex-wrap gap-2.5 items-center bg-red-700 rounded-2xl px-4 py-3.5 text-white"
    >
      <span className="flex items-center gap-2 text-[15px] font-semibold mr-1.5">
        <AlertTriangle className="w-[22px] h-[22px]" strokeWidth={2.25} />
        Cuidado
      </span>
      {props.alertas.map((a) => (
        <span
          key={a}
          className="bg-white text-red-800 rounded-xl px-3.5 py-2 text-[16px] font-semibold"
        >
          {a}
        </span>
      ))}
    </div>
  );
}

function PuertaCerrada(props: {
  mensaje: string;
  onAbrirValoracion?: () => void;
}) {
  return (
    <div className="bg-amber-50 text-amber-700 rounded-2xl px-4 py-3.5 text-[14px] leading-snug space-y-3">
      <div className="font-medium text-[15px]">
        Falta validar la valoración inicial
      </div>
      <div>{props.mensaje}</div>
      {props.onAbrirValoracion && (
        <button
          type="button"
          onClick={props.onAbrirValoracion}
          className="h-touch px-4 rounded-2xl bg-white text-amber-800 font-medium text-[14px] border border-amber-200"
        >
          Ir a la valoración
        </button>
      )}
      <div className="text-[13px]">
        La exploración del pie sí se puede registrar: es parte de la primera
        visita.
      </div>
    </div>
  );
}

// ── Las dos pestañas ────────────────────────────────────────────────

function Pestanas(props: {
  valor: Pestana;
  onCambiar: (p: Pestana) => void;
}) {
  const items: Array<[Pestana, string]> = [
    ["sesion", "Sesión de hoy"],
    ["exploracion", "Exploración"],
  ];
  return (
    <div
      role="tablist"
      className="inline-flex gap-1.5 bg-white border border-slate-200 rounded-2xl p-1.5 w-max"
    >
      {items.map(([id, texto]) => (
        <button
          key={id}
          type="button"
          role="tab"
          aria-selected={props.valor === id}
          onClick={() => props.onCambiar(id)}
          className={`h-touch px-4 rounded-xl font-medium text-[14.5px] ${
            props.valor === id
              ? "bg-mipiace-coral-soft text-mipiace-coral-dark"
              : "text-slate-500"
          }`}
        >
          {texto}
        </button>
      ))}
    </div>
  );
}

// ── El panel de la zona tocada ──────────────────────────────────────

function PanelDeZona(props: {
  clave: string;
  mapa: MapaVersionado;
  lesiones: readonly Lesion[];
  marca: MarcaDeZona | undefined;
  onLesion: (id: string) => void;
  onGravedad: (g: Gravedad) => void;
  onQuitar: () => void;
}) {
  // LA GRAVEDAD SE ELIGE DESPUÉS DE LA LESIÓN, y el motivo lo redacta la
  // función pura — la misma que usa la API. Dos sitios que lo redactaran
  // acabarían discrepando.
  const gravedad = gravedadDisponible(props.marca);
  return (
    <div className="mt-3 bg-mipiace-stone rounded-2xl p-3">
      <div className="text-[13.5px] font-medium mb-2 text-mipiace-ink">
        {nombreDeZonaConMapa(props.clave, props.mapa)}
      </div>
      <div className="flex flex-wrap gap-2">
        {props.lesiones.map((l) => (
          <Chip
            key={l.id}
            on={props.marca?.lesion === l.id}
            suave
            onClick={() => props.onLesion(l.id)}
          >
            {l.label}
          </Chip>
        ))}
      </div>
      <div className="text-[13px] font-medium text-mipiace-ink-soft mt-3 mb-2">
        Gravedad
        {gravedad.motivo && (
          <span className="font-normal text-slate-500"> · {gravedad.motivo}</span>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {GRAVEDADES.map((g) => (
          <Chip
            key={g}
            on={props.marca?.gravedad === g}
            suave
            disabled={!gravedad.puede}
            onClick={() => props.onGravedad(g)}
          >
            {NOMBRE_DE_GRAVEDAD[g]}
          </Chip>
        ))}
        {props.marca && (
          <Chip on={false} onClick={props.onQuitar}>
            Quitar
          </Chip>
        )}
      </div>
    </div>
  );
}

function ListaDeMarcas(props: {
  marcas: Record<string, MarcaDeZona>;
  mapa: MapaVersionado;
  lesiones: readonly Lesion[];
}) {
  const entradas = Object.entries(props.marcas);
  if (entradas.length === 0) return null;
  const nombreLesion = (id: string) =>
    props.lesiones.find((l) => l.id === id)?.label ?? id;
  return (
    <div className="mt-2.5 text-[13px] leading-relaxed">
      {entradas.map(([clave, m]) => (
        <div key={clave}>
          · <b className="font-medium">{nombreDeZonaConMapa(clave, props.mapa)}</b>
          : {nombreLesion(m.lesion)}
          {m.gravedad && ` (${NOMBRE_DE_GRAVEDAD[m.gravedad].toLowerCase()})`}
        </div>
      ))}
    </div>
  );
}

/** El nombre de la zona con el mapa QUE MANDA EL SERVIDOR, no con el
 *  compilado: si la versión no coincidiera, el nombre saldría del mapa de
 *  la respuesta y no del que esta pantalla trae dentro. */
function nombreDeZonaConMapa(clave: string, mapa: MapaVersionado): string {
  const corte = clave.indexOf(":");
  const pie = clave.slice(0, corte) as Pie;
  const zona = mapa.zonas.find((z) => z.id === clave.slice(corte + 1));
  const lado = pie === "L" ? "Pie izq." : "Pie der.";
  return zona ? `${lado} · ${zona.label}` : clave;
}

// ── El panel de la sesión ───────────────────────────────────────────

function PanelDeLaSesion(props: {
  vista: VistaDeLaSesion;
  tratamientos: string[];
  dolor: number | null;
  evolucion: Evolucion | null;
  consejos: string[];
  proximaCita: ProximaCita | null;
  nota: string;
  hayAnterior: boolean;
  onRepetir: () => void;
  onTratamiento: (id: string) => void;
  onDolor: (n: number) => void;
  onEvolucion: (e: Evolucion) => void;
  onConsejo: (id: string) => void;
  onProximaCita: (p: ProximaCita) => void;
  onNota: (s: string) => void;
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-3xl p-5">
      {/* «Igual que la última vez» SUMA. Desactivado en la primera visita,
          porque no hay última. */}
      <button
        type="button"
        onClick={props.onRepetir}
        disabled={!props.hayAnterior}
        className="w-full h-14 bg-mipiace-coral-soft text-mipiace-coral-dark font-semibold rounded-2xl text-[15px] mb-3.5 disabled:opacity-45 disabled:cursor-not-allowed"
      >
        ↺ Igual que la última vez
      </button>

      <Seccion titulo="Tratamientos de hoy">
        <div className="flex flex-wrap gap-2">
          {props.vista.tratamientos.map((t) => (
            <Chip
              key={t.serviceId}
              on={props.tratamientos.includes(t.serviceId)}
              onClick={() => props.onTratamiento(t.serviceId)}
            >
              {t.nombre}
            </Chip>
          ))}
        </div>
        {props.vista.tratamientos.length === 0 && (
          <p className="text-[13px] text-slate-500 leading-relaxed">
            No hay tratamientos marcados en el catálogo. Márcalos en Catálogo
            de agenda con «Es un tratamiento de la sesión».
          </p>
        )}
      </Seccion>

      <Seccion titulo="Dolor hoy (0 = nada · 10 = el peor)">
        <div className="grid grid-cols-11 gap-1">
          {Array.from({ length: 11 }, (_, i) => (
            <button
              key={i}
              type="button"
              aria-pressed={props.dolor === i}
              onClick={() => props.onDolor(i)}
              className={`h-touch rounded-xl font-semibold text-[16px] ${
                props.dolor === i
                  ? "bg-mipiace-coral text-white"
                  : "bg-mipiace-stone text-mipiace-ink-soft"
              }`}
            >
              {i}
            </button>
          ))}
        </div>
      </Seccion>

      <Seccion titulo="Desde la última visita">
        <Segmentos
          opciones={EVOLUCIONES.map((e) => [e, NOMBRE_DE_EVOLUCION[e]])}
          valor={props.evolucion}
          onElegir={props.onEvolucion}
        />
      </Seccion>

      <Seccion titulo="Consejos para casa">
        <div className="flex flex-wrap gap-2">
          {props.vista.listas.consejos.consejos.map((c: Consejo) => (
            <Chip
              key={c.id}
              suave
              on={props.consejos.includes(c.id)}
              onClick={() => props.onConsejo(c.id)}
            >
              {c.label}
            </Chip>
          ))}
        </div>
      </Seccion>

      <Seccion titulo="Próxima cita">
        <Segmentos
          opciones={PROXIMAS_CITAS.map((p) => [p, NOMBRE_DE_PROXIMA_CITA[p]])}
          valor={props.proximaCita}
          onElegir={props.onProximaCita}
        />
        <p className="text-[12.5px] text-slate-500 mt-2 leading-relaxed">
          Queda como propuesta. La recepción elige el hueco con el paciente.
        </p>
      </Seccion>

      {/* LA ÚNICA caja de texto del bloque, y plegada. */}
      <details className="mt-3">
        <summary className="cursor-pointer text-[13.5px] text-slate-500 min-h-touch flex items-center">
          + Añadir una nota (opcional)
        </summary>
        <textarea
          value={props.nota}
          onChange={(e) => props.onNota(e.target.value)}
          maxLength={2000}
          placeholder="Solo si algo no cabe en los botones"
          className="w-full min-h-[80px] rounded-2xl border border-slate-200 bg-mipiace-stone p-3 text-[16px] mt-2"
        />
      </details>
    </div>
  );
}

// ── El panel de la exploración ──────────────────────────────────────

function PanelDeExploracion(props: {
  exploracion: ExploracionEnPantalla | null;
  ultima: { fecha: string; autor: string } | null;
  ocupado: boolean;
  aviso: string | null;
  onPulso: (pie: Pie, p: Pulso) => void;
  onTipoDePie: (t: TipoDePie) => void;
  onGuardar: () => void;
}) {
  if (!props.exploracion) return null;
  const e = props.exploracion;
  return (
    <div className="bg-white border border-slate-200 rounded-3xl p-5">
      <Seccion titulo="Pulso del pie">
        {(["L", "R"] as const).map((pie) => (
          <div
            key={pie}
            className="grid grid-cols-[110px_1fr] gap-2 items-center mb-2 text-[14px]"
          >
            <span>Pie {pie === "L" ? "izquierdo" : "derecho"}</span>
            <Segmentos
              opciones={PULSOS.map((p) => [p, NOMBRE_DE_PULSO[p]])}
              valor={e.pulsos[pie]}
              onElegir={(p) => props.onPulso(pie, p)}
            />
          </div>
        ))}
      </Seccion>

      <Seccion titulo="Tipo de pie">
        <Segmentos
          opciones={TIPOS_DE_PIE.map((t) => [t, NOMBRE_DE_TIPO_DE_PIE[t]])}
          valor={e.tipoDePie}
          onElegir={props.onTipoDePie}
        />
      </Seccion>

      <p className="text-[12.5px] text-slate-500 leading-relaxed mt-3">
        Se hace en la primera visita y cuando la podóloga lo vea necesario (en
        diabéticos, una vez al año). La siguiente exploración parte de esta.
        {props.ultima && (
          <>
            {" "}
            La última es del {diaCorto(props.ultima.fecha)}, de{" "}
            {props.ultima.autor}.
          </>
        )}
      </p>

      {/* El botón que el mockup no pinta, y por qué está.
          El mockup sólo tiene pie de página en la pestaña de sesión. Pero
          la exploración se guarda APARTE —se puede registrar sin la
          valoración validada, que es su razón de existir (prompt §2)— así
          que necesita su propio acto. Una pestaña cuyo estado no se puede
          guardar es una pestaña que miente. Va declarado en el done. */}
      <button
        type="button"
        onClick={props.onGuardar}
        disabled={props.ocupado}
        className="mt-4 w-full h-touch-lg rounded-[18px] bg-mipiace-coral text-white font-medium text-[16px] disabled:opacity-45"
      >
        {props.ocupado ? "Guardando…" : "Guardar exploración"}
      </button>
      {props.aviso && (
        <div className="flex gap-2 items-center bg-emerald-50 text-emerald-700 rounded-2xl px-3.5 py-3 text-[14px] mt-3">
          <Check className="w-5 h-5 shrink-0" strokeWidth={2.25} />
          {props.aviso}
        </div>
      )}
    </div>
  );
}

// ── Piezas sueltas ──────────────────────────────────────────────────

function Tarjeta(props: {
  titulo: string;
  sub: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-3xl px-5 py-4">
      <h2 className="text-[16.5px] font-semibold m-0 text-mipiace-ink">
        {props.titulo}
      </h2>
      <div className="text-[13px] text-slate-500 mt-0.5 mb-3">{props.sub}</div>
      {props.children}
    </div>
  );
}

function Seccion(props: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="mt-4 first:mt-0">
      <div className="text-[13px] font-medium text-mipiace-ink-soft mb-2">
        {props.titulo}
      </div>
      {props.children}
    </div>
  );
}

function Chip(props: {
  on: boolean;
  suave?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  const activo = props.suave
    ? "bg-mipiace-coral-soft text-mipiace-coral-dark border-mipiace-coral"
    : "bg-mipiace-coral text-white border-mipiace-coral font-medium";
  return (
    <button
      type="button"
      aria-pressed={props.on}
      disabled={props.disabled}
      onClick={props.onClick}
      className={`min-h-touch px-3.5 rounded-2xl border-[1.5px] text-[14px] ${
        props.on ? activo : "bg-white border-slate-200 text-mipiace-ink"
      } disabled:opacity-45 disabled:cursor-not-allowed`}
    >
      {props.children}
    </button>
  );
}

function Segmentos<T extends string>(props: {
  opciones: ReadonlyArray<readonly [T, string]>;
  valor: T | null;
  onElegir: (v: T) => void;
}) {
  return (
    <div className="flex gap-2">
      {props.opciones.map(([id, texto]) => (
        <button
          key={id}
          type="button"
          aria-pressed={props.valor === id}
          onClick={() => props.onElegir(id)}
          className={`flex-1 h-touch rounded-2xl font-medium text-[14px] ${
            props.valor === id
              ? "bg-mipiace-ink text-white"
              : "bg-mipiace-stone text-mipiace-ink"
          }`}
        >
          {texto}
        </button>
      ))}
    </div>
  );
}

function Mal(props: { children: React.ReactNode }) {
  return (
    <div className="bg-red-50 text-red-700 rounded-2xl px-4 py-3 text-[13.5px]">
      {props.children}
    </div>
  );
}

export function euros(n: number): string {
  return `${n.toFixed(2).replace(".", ",")} €`;
}

function hora(iso: string): string {
  return new Date(iso).toLocaleTimeString("es-ES", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function diaCorto(iso: string): string {
  return new Date(iso).toLocaleDateString("es-ES", {
    day: "numeric",
    month: "short",
  });
}
