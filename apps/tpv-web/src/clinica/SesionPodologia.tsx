// clinica-5 · LA SESIÓN POR TIPO DE VISITA.
//
// Es el mockup validado el 07-10 (`docs/mockups/clinica-sesion-v2.html`)
// con sus piezas en su orden: cabecera y FRANJA ROJA de alertas, chips de
// tipo en multiselección, banda de «Hoy toca», el pie fijo a la izquierda
// —con su capa de sensibilidad si hay pie de riesgo—, las tarjetas de cada
// tipo apiladas a la derecha, el dolor y la evolución, la barra de caja y
// el diálogo del pendiente.
//
// Lo de clinica-3 que sigue aquí: la pestaña de exploración
// (monofilamento, pulsos, tipo de pie), que escribe su propia entrada
// `FOOT_EXAM` y su propio endpoint. El mockup de este bloque no la pinta
// porque habla de la sesión, pero la exploración es la pieza que se puede
// registrar SIN la valoración validada (prompt §2 de clinica-3) y quitarla
// habría sido quitar una pantalla que funciona por un mockup que no la
// menciona. Va dicho en el `-done`.
//
// ── La forma del trabajo: mucho clic, poco escribir ──────────────────
//
// Decisión de producto 1 de clinica-3, y aquí se dobla: cinco tarjetas y
// ni un `input` de texto fuera de la nota plegada y la línea del pendiente
// «Otro». El estado vive en memoria hasta que se cierra.
//
// ── Quién decide, y por qué nada se calcula dos veces ────────────────
//
// `nivelPropuesto`, `riesgoDelPie`, `avisosCruzados`, `resumenPorTipos`,
// `seCierraSolo` y `pendientesQuePreguntar` son las MISMAS funciones puras
// que usa la API (`@mipiacetpv/clinica-sesion`). El servidor manda —vuelve
// a decidirlo al recibir el cierre— y aquí se usan para pintar el nivel,
// el riesgo, los avisos, la barra de caja y el diálogo sin ir y volver.
//
// Con dos cálculos, el día que se separaran la podóloga vería «riesgo
// moderado» en pantalla y la historia guardaría «bajo». En una
// clasificación que decide cada cuánto se revisa el pie de un diabético,
// eso no es una discrepancia de interfaz.
//
// Lo único que esta pantalla NO calcula es el dinero: `verImportes` viene
// del servidor y, cuando es `false`, **las claves de precio no están en la
// respuesta**. No hay un `?? 0` posible porque no hay nada que caiga a 0.
//
// ── Las listas vienen del servidor ───────────────────────────────────
//
// El mapa, las lesiones, los consejos, los actos, los estados de herida,
// los pendientes y la cita de la guía del riesgo los manda
// `GET …/sesion` con su versión. No se importan del paquete para pintar:
// son la versión con la que se va a ESCRIBIR, y una pantalla que pintara
// «la que tiene compilada» podría ofrecer un acto que el servidor va a
// tirar.

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, Loader2 } from "lucide-react";

import {
  COLOR_DE_TIPO_DE_VISITA,
  EVOLUCIONES,
  GRAVEDADES,
  NOMBRE_DE_EVOLUCION,
  NOMBRE_DE_GRAVEDAD,
  NOMBRE_DE_PROXIMA_CITA,
  NOMBRE_DE_PULSO,
  NOMBRE_DE_TIPO_DE_PIE,
  NOMBRE_DE_TIPO_DE_VISITA,
  PROXIMAS_CITAS,
  PULSOS,
  TIPOS_DE_PIE,
  TIPOS_DE_VISITA,
  avisosCruzados,
  claveDePendiente,
  comprobacionesVacias,
  gravedadDisponible,
  igualQueLaUltimaVez,
  nivelPropuesto,
  pendientesQuePreguntar,
  productoDelNivel,
  resumenPorTipos,
  seCierraSolo,
  serviciosPorTipo,
  textoSinCobro,
  type ComprobacionesDelPie,
  type Consejo,
  type Evolucion,
  type ExploracionEnPantalla,
  type Gravedad,
  type Lesion,
  type ListaDeActos,
  type ListaDeConsejos,
  type ListaDeLesiones,
  type ListaDeOpciones,
  type ListaDePendientes,
  type MapaDelPie as MapaVersionado,
  type MarcaDeZona,
  type Marcas,
  type NivelDeQuiropodia,
  type PendienteCerrado,
  type PendienteCreado,
  type Pie,
  type ProximaCita,
  type Pulso,
  type PulsoPedio,
  type Sensibilidad,
  type ServicioDeSesion,
  type SiNo,
  type TipoDeVisita,
} from "@mipiacetpv/clinica-sesion";

import { ApiError, apiWithCashier } from "../api.js";
import { LeyendaDelMapa, MapaDelPie, type EstadoDeZona } from "./MapaDelPie.js";
import { GraficaDolor, type PuntoDeDolor } from "./GraficaDolor.js";
import { SesionCerrada, type SesionCerradaView } from "./SesionCerrada.js";
import {
  BandaDeHoyToca,
  DialogoDePendiente,
  ParaLaProxima,
  type PendienteEnPantalla,
  type PendienteNuevo,
} from "./Pendientes.js";
import {
  AvisoCruzado,
  TarjetaBiomecanica,
  TarjetaCirugia,
  TarjetaGeneral,
  TarjetaPieDeRiesgo,
  TarjetaQuiropodia,
  type ServiciosDelTipo,
} from "./TarjetasDeTipo.js";
import {
  Chip,
  Mal,
  Seccion,
  Segmentos,
  Tarjeta,
  diaCorto,
  euros,
  hora,
} from "./piezas.js";

// ── La forma que devuelve la API ─────────────────────────────────────

/** Un servicio del catálogo tal como llega. `precio` e `iva` NO VIENEN si
 *  `verImportes` es `false`; `tipo` y `nivelQuiropodia` vienen siempre
 *  (no son importes, son en qué tarjeta va el botón). */
export type ServicioEnPantalla = Pick<
  ServicioDeSesion,
  "serviceId" | "nombre"
> &
  Partial<Pick<ServicioDeSesion, "precio" | "iva" | "causaExencion">> & {
    tipo: TipoDeVisita | null;
    nivelQuiropodia: NivelDeQuiropodia | null;
  };

export interface VistaDeLaSesion {
  cita: {
    id: string;
    clientId: string;
    empieza: string;
    status: string;
    servicios: string[];
    servicioIds: string[];
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
    /** Las IDS, para las alertas cruzadas. Ver `alertas-cruzadas.ts`. */
    alertaIds: string[];
  };
  puerta:
    | { puede: true; valoracionId: string; validadaEn: string }
    | { puede: false; motivo: string; mensaje: string };
  tratamientos: ServicioEnPantalla[];
  tiposSugeridos: TipoDeVisita[];
  pendientes: PendienteCreado[];
  ultimaCirugia: {
    fecha: string;
    tecnica: string[];
    zonas: string[];
  } | null;
  anterior: {
    entryId: string;
    fecha: string;
    marcas: Marcas;
    tratamientos: string[];
    consejos: string[];
    dolor: number;
    pendientesCreados?: PendienteCreado[];
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
    actos: ListaDeActos;
    estadosDeHerida: ListaDeOpciones;
    puntos: ListaDeOpciones;
    tiposDePieBiomecanica: ListaDeOpciones;
    pisadas: ListaDeOpciones;
    pendientes: ListaDePendientes;
    versiones: Record<string, number>;
    fuenteDelRiesgo: string;
  };
  verImportes: boolean;
}

type Pestana = "sesion" | "exploracion";
type Capa = "lesiones" | "sensibilidad";

/** El estado de los bloques, uno por tipo. Plano y no anidado: lo que la
 *  pantalla hace con él es un `set` por campo, y un objeto anidado habría
 *  obligado a un spread de dos niveles en cada toque. */
interface EstadoDeLosBloques {
  actos: string[];
  /** `null` = se queda con el propuesto, y así el nivel SIGUE moviéndose
   *  al tocar más actos. Con una copia del propuesto, el primer toque lo
   *  habría congelado. */
  nivelAMano: NivelDeQuiropodia | null;
  riesgo: ComprobacionesDelPie;
  herida: string | null;
  puntos: string | null;
  bioTipoDePie: string | null;
  bioPisada: string | null;
  bioPlantillas: boolean;
  /** Los servicios tocados, por tipo. */
  servicios: Partial<Record<TipoDeVisita, string[]>>;
}

function bloquesVacios(): EstadoDeLosBloques {
  return {
    actos: [],
    nivelAMano: null,
    riesgo: comprobacionesVacias(),
    herida: null,
    puntos: null,
    bioTipoDePie: null,
    bioPisada: null,
    bioPlantillas: false,
    servicios: {},
  };
}

export function SesionPodologia(props: {
  appointmentId: string;
  /** Para volver a la agenda tras cobrar. */
  onCobrar?: (appointmentId: string) => void;
  /** Para llevar a la valoración cuando la puerta está cerrada: es «el
   *  camino para hacerlo» que pide el prompt §2 de clinica-3. */
  onAbrirValoracion?: (clientId: string) => void;
}) {
  const [vista, setVista] = useState<VistaDeLaSesion | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [pestana, setPestana] = useState<Pestana>("sesion");
  const [capa, setCapa] = useState<Capa>("lesiones");

  // ── El estado de la sesión, EN MEMORIA hasta que se cierra ────────
  //
  // No hay «guardar borrador» en el mockup y no hay estado intermedio que
  // signifique nada: media sesión guardada no es una sesión clínica
  // incompleta, es una pantalla a medio rellenar.
  const [tipos, setTipos] = useState<TipoDeVisita[]>([]);
  const [bloques, setBloques] = useState<EstadoDeLosBloques>(bloquesVacios);
  const [marcas, setMarcas] = useState<Record<string, MarcaDeZona>>({});
  const [zonaAbierta, setZonaAbierta] = useState<string | null>(null);
  const [dolor, setDolor] = useState<number | null>(null);
  const [evolucion, setEvolucion] = useState<Evolucion | null>(null);
  const [consejos, setConsejos] = useState<string[]>([]);
  const [proximaCita, setProximaCita] = useState<ProximaCita | null>(null);
  const [nota, setNota] = useState("");

  // ── Los pendientes ───────────────────────────────────────────────
  //
  // `cerradosAMano` guarda CÓMO se cerró cada uno —tocando la banda o
  // contestando el diálogo— porque no son lo mismo al leer la historia:
  // una es «lo marqué mientras trabajaba» y la otra «me lo preguntó al
  // salir».
  const [cerradosAMano, setCerradosAMano] = useState<
    Record<string, "MANO" | "PREGUNTA">
  >({});
  const [pendientesNuevos, setPendientesNuevos] = useState<PendienteNuevo[]>(
    [],
  );
  /** La cola de preguntas del cierre. `null` = no se está cerrando. */
  const [cola, setCola] = useState<PendienteCreado[] | null>(null);

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
      // Decisión 3: al abrir la sesión de una cita vienen marcados los
      // tipos de los servicios de la cita. Se pueden añadir o quitar.
      setTipos(v.tiposSugeridos.filter((t) => TIPOS_DE_VISITA.includes(t)));
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

  // ── Lo derivado, con las funciones puras del paquete ─────────────

  const catalogo = useMemo<ServicioDeSesion[]>(() => {
    if (!vista) return [];
    // Sin importes, `precio`/`iva` no vienen. Se rellenan a 0 para las
    // funciones puras PORQUE el resultado que se va a leer no lleva
    // dinero: `verImportes: false` pone `total`, `ivaTexto` y los precios
    // de las líneas en `null`. O sea: estos ceros no pueden llegar a
    // ninguna pantalla.
    return vista.tratamientos.map((t) => ({
      serviceId: t.serviceId,
      nombre: t.nombre,
      precio: t.precio ?? 0,
      iva: t.iva ?? 0,
      tipo: t.tipo,
      nivelQuiropodia: t.nivelQuiropodia,
      ...(t.causaExencion ? { causaExencion: t.causaExencion } : {}),
    }));
  }, [vista]);

  const porTipo = useMemo(() => serviciosPorTipo(catalogo), [catalogo]);
  const niveles = useMemo(
    () => catalogo.filter((s) => s.nivelQuiropodia != null),
    [catalogo],
  );

  /** Los bloques en la forma del paquete, para las funciones puras y para
   *  el POST. Se arma UNA vez y la usan la barra de caja, los pendientes y
   *  el cierre: así lo que se pinta y lo que se manda no pueden separarse. */
  const bloquesDelPaquete = useMemo(() => {
    const serviciosDe = (t: TipoDeVisita) => bloques.servicios[t] ?? [];
    const nivelElegido =
      bloques.nivelAMano ??
      // La propuesta se recalcula aquí y no se guarda en estado: guardarla
      // habría sido un segundo sitio desde el que puede quedar vieja.
      nivelPropuestoDe(bloques.actos);
    const salida: Parameters<typeof resumenPorTipos>[0]["bloques"] = {};
    if (tipos.includes("QUIROPODIA")) {
      salida.QUIROPODIA = {
        actos: bloques.actos,
        nivelPropuesto: nivelPropuestoDe(bloques.actos),
        nivelElegido,
        productoDelNivel: productoDelNivel(catalogo, nivelElegido),
        servicios: serviciosDe("QUIROPODIA"),
      };
    }
    if (tipos.includes("PIE_RIESGO")) {
      salida.PIE_RIESGO = {
        ...bloques.riesgo,
        riesgo: null,
        servicios: serviciosDe("PIE_RIESGO"),
      };
    }
    if (tipos.includes("CIRUGIA")) {
      salida.CIRUGIA = {
        herida: bloques.herida,
        puntos: bloques.puntos,
        servicios: serviciosDe("CIRUGIA"),
      };
    }
    if (tipos.includes("BIOMECANICA")) {
      salida.BIOMECANICA = {
        tipoDePie: bloques.bioTipoDePie,
        pisada: bloques.bioPisada,
        plantillas: bloques.bioPlantillas,
        servicios: serviciosDe("BIOMECANICA"),
      };
    }
    if (tipos.includes("GENERAL")) {
      salida.GENERAL = { servicios: serviciosDe("GENERAL") };
    }
    return salida;
  }, [tipos, bloques, catalogo]);

  const resumen = useMemo(() => {
    if (!vista) return null;
    return resumenPorTipos({
      tipos,
      bloques: bloquesDelPaquete,
      catalogo,
      dolor,
      verImportes: vista.verImportes,
    });
  }, [vista, tipos, bloquesDelPaquete, catalogo, dolor]);

  /** Los avisos cruzados, con la MISMA función que el servidor. */
  const avisos = useMemo(() => {
    if (!vista) return [];
    return avisosCruzados({
      alertaIds: vista.cabecera.alertaIds,
      tipos,
      actos: bloques.actos,
      herida: bloques.herida,
    });
  }, [vista, tipos, bloques.actos, bloques.herida]);

  /** Qué pendientes están abiertos y cómo va cada uno. */
  const loDeHoy = useMemo(
    () => ({
      zonasTocadas: Object.keys(marcas),
      herida: tipos.includes("CIRUGIA") ? bloques.herida : null,
      tipos,
    }),
    [marcas, tipos, bloques.herida],
  );

  const pendientes = useMemo<PendienteEnPantalla[]>(() => {
    if (!vista) return [];
    return vista.pendientes.map((p) => ({
      pendiente: p,
      solo: seCierraSolo(p, loDeHoy),
      aMano: cerradosAMano[claveDePendiente(p)] != null,
    }));
  }, [vista, loDeHoy, cerradosAMano]);

  // ── Los toques ───────────────────────────────────────────────────

  function alternar(lista: readonly string[], id: string): string[] {
    return lista.includes(id)
      ? lista.filter((x) => x !== id)
      : [...lista, id];
  }

  /** Marcar y desmarcar un tipo. **Como mínimo uno** (decisión 1): el
   *  último marcado no se puede quitar, igual que en el mockup. */
  function alternarTipo(t: TipoDeVisita) {
    setTipos((xs) => {
      if (!xs.includes(t)) {
        return TIPOS_DE_VISITA.filter((x) => x === t || xs.includes(x));
      }
      if (xs.length <= 1) return xs;
      const sin = xs.filter((x) => x !== t);
      // Al quitar el pie de riesgo, la capa de sensibilidad deja de tener
      // sentido: el selector desaparece y había que volver a lesiones o la
      // pantalla se quedaría en una capa sin selector.
      if (t === "PIE_RIESGO") setCapa("lesiones");
      return sin;
    });
  }

  function servicioDe(t: TipoDeVisita, serviceId: string) {
    setBloques((b) => ({
      ...b,
      servicios: {
        ...b.servicios,
        [t]: alternar(b.servicios[t] ?? [], serviceId),
      },
    }));
  }

  function serviciosDelTipo(t: TipoDeVisita): ServiciosDelTipo {
    return {
      disponibles: porTipo[t],
      elegidos: bloques.servicios[t] ?? [],
      onServicio: (id) => servicioDe(t, id),
      verImportes: vista?.verImportes ?? false,
    };
  }

  /** «Igual que la última vez»: SUMA lo de la anterior. Nunca borra. */
  function repetir() {
    if (!vista?.anterior) return;
    const sumado = igualQueLaUltimaVez(
      { marcas, tratamientos: [], consejos },
      {
        marcas: vista.anterior.marcas,
        tratamientos: [],
        consejos: vista.anterior.consejos,
      },
    );
    setMarcas({ ...sumado.marcas });
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
    // La capa de sensibilidad de la sesión SE LEE: lo que enseña es la
    // última exploración, y cambiarla es hacer una exploración nueva en su
    // pestaña.
    if (capa === "sensibilidad") return;
    setZonaAbierta((z) => (z === clave ? null : clave));
  }

  function marcarPendienteAMano(p: PendienteCreado) {
    const clave = claveDePendiente(p);
    setCerradosAMano((xs) => {
      if (xs[clave]) {
        const { [clave]: _fuera, ...resto } = xs;
        return resto;
      }
      return { ...xs, [clave]: "MANO" };
    });
  }

  function alternarPendienteNuevo(id: string) {
    const clase = vista?.listas.pendientes.clases.find((c) => c.id === id);
    if (!clase) return;
    setPendientesNuevos((xs) => {
      if (xs.some((x) => x.id === id)) return xs.filter((x) => x.id !== id);
      return [
        ...xs,
        {
          id,
          zona: clase.pideZona ? zonaAbierta : null,
          nota: null,
        },
      ];
    });
  }

  // ── Guardar y cerrar ─────────────────────────────────────────────

  async function guardarExploracion() {
    if (ocupado || !exploracion) return;
    setOcupado(true);
    setError(null);
    setAvisoExploracion(null);
    try {
      const r = await apiWithCashier<{
        exploracion: ExploracionEnPantalla | null;
        ultima: { fecha: string; autor: string } | null;
      }>(`/clinica/appointments/${props.appointmentId}/sesion/exploracion`, {
        method: "POST",
        body: {
          pulsos: exploracion.pulsos,
          sinSensibilidad: exploracion.sinSensibilidad,
          tipoDePie: exploracion.tipoDePie,
        },
      });
      // Se repinta con lo que dice EL SERVIDOR y no con lo que se mandó.
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

  /**
   * El botón de cerrar. ANTES de mandar nada, comprueba si queda algún
   * pendiente sin hacer y lo PREGUNTA, de uno en uno (decisión 10).
   *
   * Contestar «todavía no» cierra igual: lo que hace es que el pendiente
   * pase a la siguiente visita. No es un bloqueo — es que nadie se entere
   * tarde.
   */
  function pulsarCerrar() {
    if (!vista || ocupado || !resumen?.puedeCerrar) return;
    const quePreguntar = pendientesQuePreguntar(
      vista.pendientes,
      cerradosDelCuerpo(cerradosAMano, vista.pendientes),
      loDeHoy,
    );
    if (quePreguntar.length > 0) {
      setCola([...quePreguntar]);
      return;
    }
    void cerrar(cerradosAMano);
  }

  /**
   * Una respuesta del diálogo. Cuando se contesta la última, cierra.
   *
   * El mapa de cerrados se calcula AQUÍ y se le pasa a `cerrar`, en vez de
   * dejar que lo lea del estado: `setCerradosAMano` no ha corrido todavía
   * cuando toca mandar el POST, y leerlo del estado mandaba el mapa de
   * antes — o sea, un «sí, revisada» que no llegaba a la historia. Es el
   * mismo motivo por el que la cola también se calcula sin el `setState`.
   */
  function contestar(si: boolean) {
    if (!cola || cola.length === 0) return;
    const [primero, ...resto] = cola;
    const siguiente = { ...cerradosAMano };
    if (si && primero) siguiente[claveDePendiente(primero)] = "PREGUNTA";
    setCerradosAMano(siguiente);
    if (resto.length > 0) {
      setCola(resto);
      return;
    }
    setCola(null);
    void cerrar(siguiente);
  }

  async function cerrar(
    cerradosForzados: Record<string, "MANO" | "PREGUNTA"> | null,
  ) {
    if (!vista || ocupado) return;
    setOcupado(true);
    setError(null);
    try {
      const r = await apiWithCashier<{
        yaEstaba: boolean;
        cerrada: SesionCerradaView;
      }>(`/clinica/appointments/${props.appointmentId}/sesion/cerrar`, {
        method: "POST",
        body: {
          tipos,
          bloques: paraElServidor(bloquesDelPaquete),
          marcas,
          dolor,
          evolucion,
          consejos,
          proximaCita,
          nota: nota.trim() === "" ? null : nota,
          pendientesCerrados: cerradosDelCuerpo(
            cerradosForzados ?? cerradosAMano,
            vista.pendientes,
          ),
          pendientesNuevos,
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
  const hayRiesgo = tipos.includes("PIE_RIESGO");
  const sinSensibilidad = vista.exploracion.departeDe.sinSensibilidad;
  const avisosDe = (clase: "ACTO" | "TIPO" | "HERIDA") =>
    avisos.filter((a) => a.disparador.clase === clase).map((a) => a.aviso);

  return (
    <div className="space-y-4">
      <Cabecera vista={vista} />

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

      {pestana === "sesion" && (
        <>
          <ChipsDeTipo tipos={tipos} onAlternar={alternarTipo} />
          <BandaDeHoyToca
            pendientes={pendientes}
            mapaVersion={vista.listas.mapa.version}
            onMarcar={marcarPendienteAMano}
          />
        </>
      )}

      {/* DOS COLUMNAS DESDE 1024, que es el iPad apaisado — y el iPad
          apaisado manda (prompt §2). El ancho de la izquierda sale de UNA
          CUENTA y no de un gusto: **los dos pies tienen que caber en una
          fila a 1024**. Dos pies de 264 px (su ancho nominal, el que da
          los 48 px de dedo) con 8 de hueco son 536, más los 20+20 de la
          tarjeta, 576. Con 520 se partían en dos filas y en la captura de
          1024 sólo se veía el pie izquierdo. */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,584px)_1fr] items-start">
        {pestana === "sesion" ? (
          <>
            <div className="space-y-4 lg:sticky lg:top-2">
              <Tarjeta
                titulo="Qué tiene hoy"
                sub="Toca la zona del pie y elige qué tiene."
              >
                {/* El selector de capa sale SÓLO con pie de riesgo
                    marcado: en una quiropodia normal es un botón que no
                    hace falta, y el mockup lo esconde igual. */}
                {hayRiesgo && (
                  <div className="flex flex-wrap gap-2 mb-3">
                    <Chip
                      on={capa === "lesiones"}
                      onClick={() => setCapa("lesiones")}
                    >
                      Lesiones
                    </Chip>
                    <Chip
                      on={capa === "sensibilidad"}
                      onClick={() => {
                        setCapa("sensibilidad");
                        setZonaAbierta(null);
                      }}
                    >
                      Sensibilidad
                    </Chip>
                  </div>
                )}
                <MapaDelPie
                  mapa={vista.listas.mapa}
                  seleccionada={capa === "lesiones" ? zonaAbierta : null}
                  onTocar={tocarZona}
                  estadoDe={(clave) =>
                    capa === "sensibilidad"
                      ? sinSensibilidad.includes(clave)
                        ? "sinSensibilidad"
                        : "libre"
                      : estadoDeLaSesion(clave, marcas, vista.anterior?.marcas)
                  }
                />
                <LeyendaDelMapa
                  modo={capa === "sensibilidad" ? "sensibilidad" : "sesion"}
                />
                {capa === "sensibilidad" ? (
                  <p className="text-[12.5px] text-slate-500 mt-2 leading-relaxed">
                    {vista.exploracion.ultima
                      ? `De la exploración del ${diaCorto(vista.exploracion.ultima.fecha)}, de ${vista.exploracion.ultima.autor}. Para cambiarla, haz una exploración nueva en su pestaña.`
                      : "Todavía no hay ninguna exploración: hazla en su pestaña."}
                  </p>
                ) : (
                  zonaAbierta && (
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
                            ? {
                                ...m,
                                [zonaAbierta]: { ...m[zonaAbierta]!, gravedad },
                              }
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
                  )
                )}
                <ListaDeMarcas
                  marcas={marcas}
                  mapa={vista.listas.mapa}
                  lesiones={lesiones}
                />
              </Tarjeta>

              <Tarjeta
                titulo="Dolor, sesión a sesión"
                sub="Lo que marca el paciente al empezar."
              >
                <GraficaDolor historico={vista.dolorHistorico} hoy={dolor} />
              </Tarjeta>
            </div>

            {/* LAS TARJETAS DE CADA TIPO, apiladas en el orden de la
                lista y no en el que se tocaron: el orden de la lista es
                el que la podóloga tiene memorizado del programa de hoy. */}
            <div className="grid gap-4 content-start">
              {tipos.includes("QUIROPODIA") && (
                <TarjetaQuiropodia
                  lista={vista.listas.actos}
                  actos={bloques.actos}
                  nivelAMano={bloques.nivelAMano}
                  niveles={niveles}
                  servicios={serviciosDelTipo("QUIROPODIA")}
                  avisos={avisosDe("ACTO")}
                  verImportes={vista.verImportes}
                  onActo={(id) =>
                    setBloques((b) => ({
                      ...b,
                      actos: alternar(b.actos, id),
                      // Al cambiar los actos se suelta el nivel puesto a
                      // mano: si no, la propuesta dejaría de servir y la
                      // frase de «cambiado a mano» mentiría sobre qué se
                      // había propuesto.
                      nivelAMano: null,
                    }))
                  }
                  onNivel={(n) =>
                    setBloques((b) => ({
                      ...b,
                      nivelAMano:
                        n === nivelPropuestoDe(b.actos) ? null : n,
                    }))
                  }
                />
              )}
              {hayRiesgo && (
                <TarjetaPieDeRiesgo
                  comprobaciones={bloques.riesgo}
                  servicios={serviciosDelTipo("PIE_RIESGO")}
                  fuente={vista.listas.fuenteDelRiesgo}
                  onSensibilidad={(v: Sensibilidad) =>
                    setBloques((b) => ({
                      ...b,
                      riesgo: { ...b.riesgo, sensibilidad: v },
                    }))
                  }
                  onPulso={(pie: Pie, v: PulsoPedio) =>
                    setBloques((b) => ({
                      ...b,
                      riesgo: {
                        ...b.riesgo,
                        pulsos: { ...b.riesgo.pulsos, [pie]: v },
                      },
                    }))
                  }
                  onUlcera={(v: SiNo) =>
                    setBloques((b) => ({
                      ...b,
                      riesgo: { ...b.riesgo, ulcera: v },
                    }))
                  }
                  onDeformidad={(v: SiNo) =>
                    setBloques((b) => ({
                      ...b,
                      riesgo: { ...b.riesgo, deformidad: v },
                    }))
                  }
                />
              )}
              {tipos.includes("CIRUGIA") && (
                <TarjetaCirugia
                  estados={vista.listas.estadosDeHerida}
                  puntosLista={vista.listas.puntos}
                  herida={bloques.herida}
                  puntos={bloques.puntos}
                  ultimaCirugia={vista.ultimaCirugia}
                  servicios={serviciosDelTipo("CIRUGIA")}
                  avisos={[...avisosDe("HERIDA"), ...avisosDe("TIPO")]}
                  onHerida={(id) =>
                    setBloques((b) => ({
                      ...b,
                      herida: b.herida === id ? null : id,
                    }))
                  }
                  onPuntos={(id) =>
                    setBloques((b) => ({
                      ...b,
                      puntos: b.puntos === id ? null : id,
                    }))
                  }
                />
              )}
              {tipos.includes("BIOMECANICA") && (
                <TarjetaBiomecanica
                  tiposDePie={vista.listas.tiposDePieBiomecanica}
                  pisadas={vista.listas.pisadas}
                  tipoDePie={bloques.bioTipoDePie}
                  pisada={bloques.bioPisada}
                  plantillas={bloques.bioPlantillas}
                  servicios={serviciosDelTipo("BIOMECANICA")}
                  onTipoDePie={(id) =>
                    setBloques((b) => ({
                      ...b,
                      bioTipoDePie: b.bioTipoDePie === id ? null : id,
                    }))
                  }
                  onPisada={(id) =>
                    setBloques((b) => ({
                      ...b,
                      bioPisada: b.bioPisada === id ? null : id,
                    }))
                  }
                  onPlantillas={() =>
                    setBloques((b) => ({
                      ...b,
                      bioPlantillas: !b.bioPlantillas,
                    }))
                  }
                />
              )}
              {tipos.includes("GENERAL") && (
                <TarjetaGeneral servicios={serviciosDelTipo("GENERAL")} />
              )}

              {/* El aviso cruzado que no cabe en ninguna tarjeta: el que
                  dispara el TIPO cuando no hay tarjeta de cirugía abierta
                  no puede darse —el disparador de tipo es CIRUGIA— pero si
                  mañana la tabla gana una fila con otro tipo, el aviso
                  tiene que salir en algún sitio y no desaparecer. */}
              {tipos.length > 0 && !tipos.includes("CIRUGIA") && (
                <AvisoCruzado avisos={avisosDe("TIPO")} />
              )}

              <ComunDeLaSesion
                listas={vista.listas}
                dolor={dolor}
                evolucion={evolucion}
                consejos={consejos}
                proximaCita={proximaCita}
                nota={nota}
                pendientesNuevos={pendientesNuevos}
                zonaAbierta={zonaAbierta}
                hayAnterior={vista.anterior != null}
                onRepetir={repetir}
                onDolor={setDolor}
                onEvolucion={setEvolucion}
                onConsejo={(id) => setConsejos((c) => alternar(c, id))}
                onProximaCita={setProximaCita}
                onNota={setNota}
                onPendienteNuevo={alternarPendienteNuevo}
                onNotaDePendiente={(id, texto) =>
                  setPendientesNuevos((xs) =>
                    xs.map((x) => (x.id === id ? { ...x, nota: texto } : x)),
                  )
                }
              />
            </div>
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
                  e == null
                    ? e
                    : { ...e, pulsos: { ...e.pulsos, [pie]: pulso } },
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

      {/* ── LA BARRA DE CAJA ──────────────────────────────────────── */}
      {pestana === "sesion" && resumen && (
        <div
          // El gancho del banco. Sin él, un `getByText("30,00 €")` casa
          // también con la tarjeta de producto de la pantalla de VENTA que
          // hay detrás del overlay. Los ganchos se ponen donde el banco
          // tiene que mirar, no se filtra por texto.
          data-test="pie-de-sesion"
          className="flex items-center justify-between gap-4 flex-wrap bg-white border border-slate-200 rounded-3xl px-5 py-4"
        >
          <div className="text-[14px] text-mipiace-ink-soft min-w-0">
            {resumen.lineas.length === 0 ? (
              <span>
                {resumen.faltaTipo
                  ? "Marca al menos un tipo de visita"
                  : "Nada que cobrar en esta visita"}
              </span>
            ) : (
              <span>
                <b className="font-semibold text-mipiace-ink">Pasa a caja:</b>{" "}
                {resumen.lineas
                  .map(
                    (l) =>
                      `${l.nombre}${l.precio != null ? ` · ${euros(l.precio)}` : ""}`,
                  )
                  .join(" + ")}
                {/* El total sólo si viene. `total` es `null` cuando la
                    respuesta no trae precios, así que no hay nada que
                    pintar a 0. */}
                {resumen.total != null && resumen.lineas.length > 1 && (
                  <>
                    {" = "}
                    <b className="font-semibold text-mipiace-ink tabular-nums">
                      {euros(resumen.total)}
                    </b>
                  </>
                )}
                {resumen.ivaTexto && (
                  <span className="text-slate-500">
                    {" · "}
                    {resumen.ivaTexto.toLowerCase()}
                  </span>
                )}
              </span>
            )}
            <div className="text-[13px] text-slate-500 mt-0.5">
              {textoSinCobro(resumen.sinCobro) ??
                (resumen.faltaDolor
                  ? "Falta el dolor de hoy"
                  : "La sesión queda firmada y no se edita")}
            </div>
          </div>
          <button
            type="button"
            onClick={pulsarCerrar}
            disabled={!resumen.puedeCerrar || ocupado || !vista.puerta.puede}
            className="h-touch-lg px-7 rounded-[18px] bg-mipiace-coral text-white font-medium text-[16px] disabled:opacity-45 disabled:cursor-not-allowed active:scale-[0.98] transition-transform motion-reduce:transform-none"
          >
            {ocupado ? "Cerrando…" : resumen.textoDelBoton}
          </button>
        </div>
      )}

      {cola && cola.length > 0 && cola[0] && (
        <DialogoDePendiente
          pendiente={cola[0]}
          mapaVersion={vista.listas.mapa.version}
          quedan={cola.length - 1}
          ocupado={ocupado}
          onSi={() => contestar(true)}
          onNo={() => contestar(false)}
        />
      )}
    </div>
  );
}

// ── Lo derivado que no necesita estado ──────────────────────────────

/**
 * El número del nivel propuesto, sin el motivo.
 *
 * La misma función del paquete que llama la tarjeta y que llama el
 * servidor; aquí sólo hace falta el número, para decidir si el nivel que
 * la podóloga toca ES el propuesto (y entonces `nivelAMano` vuelve a
 * `null` y el nivel sigue moviéndose con los actos).
 *
 * No se guarda en estado a propósito: guardarlo habría sido un segundo
 * sitio desde el que puede quedar viejo.
 */
function nivelPropuestoDe(actos: readonly string[]): NivelDeQuiropodia {
  return nivelPropuesto(actos).nivel;
}

/**
 * Los pendientes cerrados A MANO que de verdad estaban abiertos, en la
 * forma del cuerpo.
 *
 * Se filtra por los abiertos antes de mandarlo porque el servidor lo va a
 * filtrar igual (cerrar a mano algo que nadie apuntó no cuenta), y mandar
 * lo que se va a tirar sólo sirve para que el cuerpo del POST no diga lo
 * que la pantalla cree.
 */
function cerradosDelCuerpo(
  aMano: Record<string, "MANO" | "PREGUNTA">,
  abiertos: readonly PendienteCreado[],
): PendienteCerrado[] {
  return abiertos
    .filter((p) => aMano[claveDePendiente(p)] != null)
    .map((p) => ({
      id: p.id,
      zona: p.zona,
      como: aMano[claveDePendiente(p)]!,
    }));
}

/**
 * Los bloques, listos para el POST: sin los campos que el servidor
 * calcula.
 *
 * `nivelPropuesto`, `productoDelNivel` y `riesgo` NO se mandan. Los
 * calcula el servidor con los mismos actos y las mismas comprobaciones, y
 * mandarlos habría sido dejar que la pantalla eligiera el nivel que se
 * cobra y la categoría de riesgo que consta en la historia.
 */
function paraElServidor(
  bloques: Parameters<typeof resumenPorTipos>[0]["bloques"],
): Record<string, unknown> {
  const salida: Record<string, unknown> = {};
  if (bloques.QUIROPODIA) {
    salida.QUIROPODIA = {
      actos: bloques.QUIROPODIA.actos,
      nivelElegido: bloques.QUIROPODIA.nivelElegido,
      servicios: bloques.QUIROPODIA.servicios,
    };
  }
  if (bloques.PIE_RIESGO) {
    const b = bloques.PIE_RIESGO;
    salida.PIE_RIESGO = {
      sensibilidad: b.sensibilidad,
      pulsos: b.pulsos,
      ulcera: b.ulcera,
      deformidad: b.deformidad,
      servicios: b.servicios,
    };
  }
  if (bloques.CIRUGIA) salida.CIRUGIA = bloques.CIRUGIA;
  if (bloques.BIOMECANICA) salida.BIOMECANICA = bloques.BIOMECANICA;
  if (bloques.GENERAL) salida.GENERAL = bloques.GENERAL;
  return salida;
}

function estadoDeLaSesion(
  clave: string,
  hoy: Record<string, MarcaDeZona>,
  anterior: Marcas | undefined,
): EstadoDeZona {
  if (hoy[clave]) return "hoy";
  if (anterior?.[clave]) return "anterior";
  return "libre";
}

// ── Los chips de tipo ───────────────────────────────────────────────

/**
 * Multiselección, y **como mínimo uno**: el último marcado no se puede
 * quitar (decisión 1).
 *
 * El color sale del paquete (`COLOR_DE_TIPO_DE_VISITA`) y no de una tabla
 * de esta pantalla porque clinica-6 va a pintar los mismos chips en la
 * historia viva, y dos tablas de colores son dos chips del mismo tipo de
 * distinto color.
 */
function ChipsDeTipo(props: {
  tipos: readonly TipoDeVisita[];
  onAlternar: (t: TipoDeVisita) => void;
}) {
  const ultimo = props.tipos.length <= 1;
  return (
    <div
      data-test="chips-de-tipo"
      className="flex gap-2 flex-wrap items-center"
    >
      {TIPOS_DE_VISITA.map((t) => {
        const on = props.tipos.includes(t);
        const color = COLOR_DE_TIPO_DE_VISITA[t];
        return (
          <button
            key={t}
            type="button"
            aria-pressed={on}
            disabled={on && ultimo}
            onClick={() => props.onAlternar(t)}
            style={on ? { backgroundColor: color, borderColor: color } : {}}
            className={`h-touch px-4 rounded-[15px] border-2 font-medium text-[15px] flex items-center gap-2 ${
              on
                ? "text-white"
                : "bg-white border-slate-200 text-mipiace-ink"
            } disabled:cursor-default`}
          >
            <i
              aria-hidden
              className="w-2.5 h-2.5 rounded-full"
              style={{ backgroundColor: on ? "#fff" : color }}
            />
            {on && <span aria-hidden>✓</span>}
            {NOMBRE_DE_TIPO_DE_VISITA[t]}
          </button>
        );
      })}
      <span className="text-[13px] text-slate-500 self-center">
        Puedes marcar varios: se anotan y se cobran todos
      </span>
    </div>
  );
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
 * Decisión de producto 7 de clinica-3: *aquí no prima la estética: si es
 * alerta, se ve.* Dice lo que el paciente TIENE, siempre, y se lee una vez
 * al entrar. El aviso de clinica-5 es otra cosa y va DENTRO de la tarjeta
 * que lo dispara: no «es anticoagulada», sino «vas a enuclear un heloma a
 * una anticoagulada».
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
 *  compilado. */
function nombreDeZonaConMapa(clave: string, mapa: MapaVersionado): string {
  const corte = clave.indexOf(":");
  const pie = clave.slice(0, corte) as Pie;
  const zona = mapa.zonas.find((z) => z.id === clave.slice(corte + 1));
  const lado = pie === "L" ? "Pie izq." : "Pie der.";
  return zona ? `${lado} · ${zona.label}` : clave;
}

// ── Lo común a todos los tipos: dolor, evolución y lo de siempre ────

function ComunDeLaSesion(props: {
  listas: VistaDeLaSesion["listas"];
  dolor: number | null;
  evolucion: Evolucion | null;
  consejos: string[];
  proximaCita: ProximaCita | null;
  nota: string;
  pendientesNuevos: readonly PendienteNuevo[];
  zonaAbierta: string | null;
  hayAnterior: boolean;
  onRepetir: () => void;
  onDolor: (n: number) => void;
  onEvolucion: (e: Evolucion) => void;
  onConsejo: (id: string) => void;
  onProximaCita: (p: ProximaCita) => void;
  onNota: (s: string) => void;
  onPendienteNuevo: (id: string) => void;
  onNotaDePendiente: (id: string, nota: string) => void;
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-3xl p-5">
      <button
        type="button"
        onClick={props.onRepetir}
        disabled={!props.hayAnterior}
        className="w-full h-14 bg-mipiace-coral-soft text-mipiace-coral-dark font-semibold rounded-2xl text-[15px] mb-3.5 disabled:opacity-45 disabled:cursor-not-allowed"
      >
        ↺ Igual que la última vez
      </button>

      <Seccion titulo="Dolor hoy (0 = nada · 10 = el peor)">
        {/* ONCE botones que ENVUELVEN, no una rejilla de once columnas:
            con `grid-cols-11` cada tecla salía de 30 px a 1024. Con
            `flex-wrap` y `min-w-touch`, ninguna baja del peldaño de la
            casa y la fila se parte en dos cuando no caben. */}
        <div className="flex flex-wrap gap-1">
          {Array.from({ length: 11 }, (_, i) => (
            <button
              key={i}
              type="button"
              aria-pressed={props.dolor === i}
              onClick={() => props.onDolor(i)}
              className={`h-touch min-w-touch flex-1 rounded-xl font-semibold text-[16px] ${
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
          {props.listas.consejos.consejos.map((c: Consejo) => (
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

      <ParaLaProxima
        clases={props.listas.pendientes.clases}
        elegidos={props.pendientesNuevos}
        zonaAbierta={props.zonaAbierta}
        nombreDeZona={(clave) => nombreDeZonaConMapa(clave, props.listas.mapa)}
        onAlternar={props.onPendienteNuevo}
        onNota={props.onNotaDePendiente}
      />

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

      {/* LA ÚNICA caja de texto larga del bloque, y plegada. */}
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

// ── El panel de la exploración (clinica-3, sin cambios) ─────────────

function PanelDeExploracion(props: {
  exploracion: ExploracionEnPantalla | null;
  ultima: { fecha: string; autor: string } | null;
  ocupado: boolean;
  aviso: string | null;
  onPulso: (pie: Pie, p: Pulso) => void;
  onTipoDePie: (t: (typeof TIPOS_DE_PIE)[number]) => void;
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

      {/* El botón que el mockup no pinta, y por qué está: la exploración
          se guarda APARTE —se puede registrar sin la valoración validada,
          que es su razón de existir— así que necesita su propio acto. Una
          pestaña cuyo estado no se puede guardar es una pestaña que
          miente. */}
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
