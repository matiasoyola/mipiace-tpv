// clinica-6 · LA HISTORIA VIVA: lo que se sabe de un paciente de un
// vistazo, calculado de lo que ya hay escrito.
//
// Hoy la historia de un paciente es una lista de sesiones: para saber cómo
// está Carmen hay que abrirlas una a una. Esto convierte esa lista en
// cuatro respuestas —qué le pasa, qué le toca hoy, cómo están sus pies, y
// qué visitas ha tenido— **sin escribir nada nuevo en la historia**.
//
// ── Es LECTURA, y por eso vive aquí ──────────────────────────────────
//
// Ni una tabla nueva, ni una columna, ni una migración. Todo lo de este
// fichero son funciones de `(lo que ya guardan clinica-2, -3 y -5) → lo
// que la pantalla enseña`, y están en el paquete PURO por la misma razón
// que las de clinica-5: **la pantalla no recalcula reglas clínicas por su
// cuenta.** Dos cálculos son dos verdades, y la que vería la podóloga
// sería la del navegador.
//
// Ni Prisma, ni Fastify, ni React, ni reloj. Lo que necesita el reloj
// —«hace cuatro semanas»— lo recibe como parámetro (`ahora`), igual que
// `pendienteLegible` ya hacía con las semanas.
//
// ── La regla de estado de zona está SIN VALIDAR ──────────────────────
//
// `estadoDeLasZonas` es la regla de partida que escribió Dirección, y
// **está pendiente de validar con Rosario** (va marcada en el `-done`).
// Vive aquí, en una función pura con su test, justo para que cambiarla
// sea cambiar una función y volver a correr nueve casos — y no buscarla
// por tres pantallas.

import {
  ALERTAS_CRUZADAS_V1,
  type TablaDeAlertasCruzadas,
} from "./alertas-cruzadas.js";
import { nombreDeOpcionDeBloque } from "./bloques.js";
import {
  GRAVEDADES,
  NOMBRE_DE_EVOLUCION,
  NOMBRE_DE_GRAVEDAD,
  nombreDeLesion,
  type Evolucion,
  type Gravedad,
} from "./listas.js";
import {
  clavesDelMapa,
  nombreDeZona,
  partirClave,
  VERSION_DEL_MAPA,
  type Pie,
} from "./mapa.js";
import {
  NOMBRE_DE_NIVEL,
  nombreDeActo,
  type NivelDeQuiropodia,
} from "./niveles.js";
import {
  pendienteLegible,
  type PendienteCreado,
  type PendienteLegible,
} from "./pendientes.js";
import { NOMBRE_DE_SENSIBILIDAD, NOMBRE_DE_SI_NO } from "./riesgo.js";
import type { CuerpoDeSesion, Marcas } from "./sesion.js";
import {
  esCuerpoV2,
  tiposDeLaSesion,
  type CuerpoDeSesionCualquiera,
  type CuerpoDeSesionV2,
} from "./sesion-v2.js";
import {
  NOMBRE_DE_TIPO_DE_VISITA,
  type TipoDeVisita,
} from "./tipos-de-visita.js";

// ── El estado de una zona del pie ─────────────────────────────────────

export const ESTADOS_DE_ZONA = ["ACTIVA", "MEJORANDO", "CURADA"] as const;
export type EstadoDeZonaViva = (typeof ESTADOS_DE_ZONA)[number];

export const NOMBRE_DE_ESTADO_DE_ZONA: Record<EstadoDeZonaViva, string> = {
  ACTIVA: "Activa",
  MEJORANDO: "Mejorando",
  CURADA: "Curada",
};

/**
 * Los tipos de visita en los que la podóloga MIRA EL PIE ENTERO.
 *
 * Es la mitad que hace falta para poder decir «curada» sin mentir: una
 * zona se da por curada cuando la última visita **que miró el pie** ya no
 * la marcó, y una visita de biomecánica o una consulta general pueden no
 * haberlo mirado.
 *
 * DATO y no un `if`, por lo mismo que la regla de niveles de clinica-5:
 * es justo lo que Rosario va a querer mover, y con una lista se mueve
 * editando una línea y el test lo comprueba desde fuera.
 */
export const TIPOS_QUE_MIRAN_EL_PIE: readonly TipoDeVisita[] = [
  "QUIROPODIA",
  "PIE_RIESGO",
  "CIRUGIA",
];

/**
 * Una visita, ya leída de `clinical_entries`, tal como la quieren las
 * funciones de este fichero.
 *
 * `v` distingue la v1 de clinica-3 de la v2 de clinica-5, y **las dos
 * entran en la misma historia**: eso es lo que hace que una paciente de
 * septiembre se lea entera en octubre.
 */
export interface VisitaDeLaHistoria {
  entryId: string;
  /** ISO-8601 del día de la visita. */
  fecha: string;
  /** 1 (clinica-3) o 2 (clinica-5). */
  v: number;
  /** Vacío en una v1: no es «de tipo desconocido», es que no existían. */
  tipos: readonly TipoDeVisita[];
  marcas: Marcas;
  mapaVersion: number;
  lesionesVersion: number;
}

/**
 * ¿Esta visita MIRÓ el pie?
 *
 * Tres caminos, y el primero es el que manda: si marcó algo en el mapa,
 * lo miró. Si no marcó nada, se mira el tipo — y una v1 siempre lo miró,
 * porque la sesión de clinica-3 era el mapa del pie y nada más.
 *
 * El caso que esto existe para no estropear: una visita de biomecánica a
 * la que nadie le quitó durezas **no cura el talón**. Y el caso contrario,
 * que es el que lo hace útil: una quiropodia en la que ya no queda nada
 * que marcar SÍ cura, porque es la visita en la que se vio que estaba
 * limpio.
 */
export function exploroElPie(visita: VisitaDeLaHistoria): boolean {
  if (Object.keys(visita.marcas ?? {}).length > 0) return true;
  if (visita.v < 2) return true;
  return visita.tipos.some((t) => TIPOS_QUE_MIRAN_EL_PIE.includes(t));
}

/** Un paso de la línea de evolución de una zona: la visita que la marcó. */
export interface PasoDeZona {
  entryId: string;
  fecha: string;
  /** Id de la lesión, y su nombre con el vocabulario de SU versión. */
  lesion: string;
  lesionNombre: string;
  gravedad: Gravedad | null;
  gravedadNombre: string | null;
  /** De qué clase fue esa visita. Vacío en una v1. */
  tipos: readonly TipoDeVisita[];
  tiposNombre: readonly string[];
}

export interface ZonaViva {
  /** `"L:h"`. */
  clave: string;
  pie: Pie;
  zonaId: string;
  /** «Pie izq. · Dedo gordo». */
  nombre: string;
  estado: EstadoDeZonaViva;
  /** La lesión de la ÚLTIMA visita que la marcó. */
  lesion: string;
  lesionNombre: string;
  gravedad: Gravedad | null;
  gravedadNombre: string | null;
  /** Cada visita que la marcó, de la más antigua a la más reciente. */
  pasos: readonly PasoDeZona[];
  /**
   * La visita en la que dejó de estar marcada, si está curada.
   *
   * Es un campo aparte y no un paso más de la lista: en esa visita la
   * zona **no tiene lesión**, y meterla como paso obligaría a inventar
   * una lesión «ninguna» que luego alguien pintaría en el mapa.
   */
  curadaEn: { entryId: string; fecha: string } | null;
}

const ORDEN_DE_GRAVEDAD: Record<Gravedad, number> = {
  LEVE: 1,
  MODERADA: 2,
  SEVERA: 3,
};

/** ¿Bajó la gravedad de `anterior` a `ultima`? Con un hueco en cualquiera
 *  de las dos, NO: «no sé si bajó» no es «bajó», y la diferencia es si la
 *  zona sale en ámbar o en rojo. */
function bajoLaGravedad(
  ultima: Gravedad | null,
  anterior: Gravedad | null,
): boolean {
  if (ultima == null || anterior == null) return false;
  return ORDEN_DE_GRAVEDAD[ultima] < ORDEN_DE_GRAVEDAD[anterior];
}

/**
 * EL ESTADO DE CADA ZONA DEL PIE, con su línea de evolución.
 *
 * La regla de partida de Dirección, **pendiente de validar con Rosario**:
 *
 *   · **Activa** · tiene marca en la última visita que la tocó y su
 *     gravedad no bajó respecto a la anterior.
 *   · **Mejorando** · tiene marca en la última visita que la tocó y su
 *     gravedad bajó.
 *   · **Curada** · tuvo marca alguna vez y NO la tiene en la última visita
 *     que miró el pie. Si no se volvió a mirar, sigue en su último estado:
 *     **no se da por curada por no mirarla.**
 *
 * Fíjate en lo que la tercera NO dice: «la última visita». Dice «la última
 * que miró el pie» (`exploroElPie`), y por eso una consulta general no
 * cura nada.
 *
 * Las visitas entran en cualquier orden y salen ordenadas por fecha: lo
 * que no puede pasar es que el orden de una consulta de Prisma cambie un
 * estado clínico.
 */
export function estadoDeLasZonas(
  visitas: readonly VisitaDeLaHistoria[],
): readonly ZonaViva[] {
  const orden = [...visitas].sort((a, b) => (a.fecha < b.fecha ? -1 : 1));
  const exploradoras = orden.filter(exploroElPie);
  const ultimaExploradora = exploradoras[exploradoras.length - 1] ?? null;

  const pasosPorClave = new Map<string, PasoDeZona[]>();
  for (const visita of orden) {
    const tiposNombre = visita.tipos.map((t) => NOMBRE_DE_TIPO_DE_VISITA[t]);
    for (const [clave, marca] of Object.entries(visita.marcas ?? {})) {
      if (marca == null || typeof marca !== "object") continue;
      const lesion = (marca as { lesion?: unknown }).lesion;
      if (typeof lesion !== "string") continue;
      const gravedad = gravedadDe((marca as { gravedad?: unknown }).gravedad);
      const lista = pasosPorClave.get(clave) ?? [];
      lista.push({
        entryId: visita.entryId,
        fecha: visita.fecha,
        lesion,
        lesionNombre: nombreDeLesion(lesion, visita.lesionesVersion),
        gravedad,
        gravedadNombre: gravedad ? NOMBRE_DE_GRAVEDAD[gravedad] : null,
        tipos: visita.tipos,
        tiposNombre,
      });
      pasosPorClave.set(clave, lista);
    }
  }

  const zonas: ZonaViva[] = [];
  for (const [clave, pasos] of pasosPorClave) {
    const ultimo = pasos[pasos.length - 1]!;
    const anterior = pasos[pasos.length - 2] ?? null;
    // Toda visita que marca una zona MIRÓ el pie (tiene marcas), así que
    // la última exploradora nunca es anterior al último paso: basta con
    // preguntar si es OTRA.
    const curada =
      ultimaExploradora != null && ultimaExploradora.entryId !== ultimo.entryId;
    const estado: EstadoDeZonaViva = curada
      ? "CURADA"
      : bajoLaGravedad(ultimo.gravedad, anterior?.gravedad ?? null)
        ? "MEJORANDO"
        : "ACTIVA";
    const curadaEn = curada
      ? (exploradoras.find((v) => v.fecha > ultimo.fecha) ?? null)
      : null;
    // La versión del mapa es la de la visita del ÚLTIMO paso: una marca
    // se lee con el vocabulario con el que se escribió.
    const version = mapaDelPaso(orden, ultimo.entryId);
    const partida = partirClave(clave, version);
    zonas.push({
      clave,
      pie: partida?.pie ?? (clave.startsWith("R:") ? "R" : "L"),
      zonaId: clave.slice(clave.indexOf(":") + 1),
      nombre: nombreDeZona(clave, version),
      estado,
      lesion: ultimo.lesion,
      lesionNombre: ultimo.lesionNombre,
      gravedad: ultimo.gravedad,
      gravedadNombre: ultimo.gravedadNombre,
      pasos,
      curadaEn: curadaEn
        ? { entryId: curadaEn.entryId, fecha: curadaEn.fecha }
        : null,
    });
  }

  return zonas.sort((a, b) => ordenDeClave(a.clave) - ordenDeClave(b.clave));
}

function gravedadDe(x: unknown): Gravedad | null {
  return typeof x === "string" && (GRAVEDADES as readonly string[]).includes(x)
    ? (x as Gravedad)
    : null;
}

/** Con qué versión del mapa se marcó la visita de ese paso. Es lo que hace
 *  que una marca de hace dos años se lea con SU vocabulario. */
function mapaDelPaso(
  visitas: readonly VisitaDeLaHistoria[],
  entryId: string,
): number {
  return (
    visitas.find((v) => v.entryId === entryId)?.mapaVersion ?? VERSION_DEL_MAPA
  );
}

const ORDEN_DE_CLAVE = new Map(clavesDelMapa().map((c, i) => [c, i]));

function ordenDeClave(clave: string): number {
  return ORDEN_DE_CLAVE.get(clave) ?? Number.MAX_SAFE_INTEGER;
}

// ── «Hoy toca» ────────────────────────────────────────────────────────

export interface HoyToca {
  /** El más antiguo: el que lleva más tiempo sin hacerse. */
  principal: PendienteLegible;
  /** Cuántos quedan además del principal («+2»). */
  otros: number;
  /** Con qué tipo de visita se abre la sesión al pulsar la tarjeta.
   *  `null` para «Otro», que no dice de qué es. */
  tipo: TipoDeVisita | null;
}

/**
 * Con qué tipo de visita se abre lo que toca hoy.
 *
 * DATO y no un `switch`, y separado de `PENDIENTES_V1` a propósito: lo que
 * cierra un pendiente (`cierraCon`) y lo que PROPONE abrir son dos
 * preguntas distintas. Revisar una uña operada se cierra valorando la
 * herida o tocando la zona, y se abre marcando «Cirugía» — meter las dos
 * cosas en la misma fila habría atado el vocabulario de clinica-5 a una
 * pantalla de clinica-6.
 */
export const TIPO_SUGERIDO_POR_PENDIENTE: Readonly<
  Record<string, TipoDeVisita>
> = {
  revisar_una: "CIRUGIA",
  retirar_puntos: "CIRUGIA",
  revisar_plantillas: "BIOMECANICA",
  control_riesgo: "PIE_RIESGO",
  // `otro` NO está, y es lo honesto: una nota que dice «pedirle la
  // analítica» no sabe de qué clase es la visita que viene.
};

/**
 * Lo que toca hoy, de los pendientes que dejó la última sesión cerrada.
 *
 * `null` sin ninguno — y entonces la tarjeta dice «Nada pendiente» y no
 * late. Con varios, **el más antiguo es el grande** (es el que lleva más
 * tiempo sin hacerse, y el que de verdad se puede olvidar) y el resto se
 * cuentan en un «+N».
 */
export function hoyToca(
  pendientes: readonly PendienteCreado[],
  versiones: { pendientes?: number; mapa?: number } = {},
): HoyToca | null {
  if (pendientes.length === 0) return null;
  const orden = [...pendientes].sort((a, b) => (a.desde < b.desde ? -1 : 1));
  const principal = orden[0]!;
  return {
    principal: pendienteLegible(principal, versiones),
    otros: orden.length - 1,
    tipo: TIPO_SUGERIDO_POR_PENDIENTE[principal.id] ?? null,
  };
}

// ── «Nueva visita»: cuál se recomienda ────────────────────────────────

export interface Recomendada {
  tipo: TipoDeVisita;
  /** Lo que se lee en la etiqueta de la tarjeta recomendada. */
  motivo: string;
}

/**
 * Qué tipo de visita se recomienda al abrir «Nueva visita».
 *
 * El orden es el del prompt (§7) y es un orden de URGENCIA, no de
 * frecuencia: lo que quedó apuntado manda sobre la condición del
 * paciente, y la condición sobre la costumbre.
 *
 *   1. el del pendiente, si lo hay;
 *   2. pie de riesgo, si tiene diabetes;
 *   3. el de la última visita.
 *
 * La diabetes se mira por el `preguntaId` del cuestionario (`diab`) y no
 * por el texto de la alerta, por la misma razón que la tabla de alertas
 * cruzadas: el texto se puede reescribir mañana.
 */
export function tipoRecomendado(input: {
  pendientes: readonly PendienteCreado[];
  alertaIds: readonly string[];
  /** Los tipos de la última visita (vacío si fue una v1 o no hay). */
  ultimosTipos: readonly TipoDeVisita[];
}): Recomendada | null {
  const orden = [...input.pendientes].sort((a, b) =>
    a.desde < b.desde ? -1 : 1,
  );
  for (const p of orden) {
    const tipo = TIPO_SUGERIDO_POR_PENDIENTE[p.id];
    if (tipo) return { tipo, motivo: "Lo que toca hoy" };
  }
  if (input.alertaIds.includes("diab")) {
    return { tipo: "PIE_RIESGO", motivo: "Recomendada · tiene diabetes" };
  }
  const ultimo = input.ultimosTipos[0];
  if (ultimo) return { tipo: ultimo, motivo: "Como la última visita" };
  return null;
}

// ── «Ojo hoy» ─────────────────────────────────────────────────────────

export interface OjoDeHoy {
  /** El `preguntaId` del cuestionario de clinica-2. */
  alertaId: string;
  /** La alerta, con el texto que escribió el cuestionario. */
  titulo: string;
  /** Por qué importa HOY, en una línea. `null` si esta alerta no tiene
   *  ninguna regla cruzada todavía: se enseña la alerta y nada más, en vez
   *  de inventarle una consecuencia clínica. */
  linea: string | null;
}

/**
 * La alerta que más va a cambiar lo que se haga hoy.
 *
 * No es una escala de gravedad inventada: es **el orden de la tabla de
 * alertas cruzadas de clinica-5**, que es la única lista de la casa que ya
 * dice qué alerta choca con qué se hace. La primera alerta del paciente
 * que aparece en esa tabla gana, y su aviso ES la línea de la tarjeta.
 *
 * Sin ninguna que cruce, se enseña la primera alerta que tenga (en el
 * orden del cuestionario, que ya pone delante lo que cambia el tratamiento
 * de hoy) y sin línea. Sin alertas, `null`.
 */
export function ojoDeHoy(
  alertas: readonly { preguntaId: string; texto: string }[],
  tabla: TablaDeAlertasCruzadas = ALERTAS_CRUZADAS_V1,
): OjoDeHoy | null {
  if (alertas.length === 0) return null;
  for (const regla of tabla.reglas) {
    const a = alertas.find((x) => x.preguntaId === regla.alertaId);
    if (a) {
      return { alertaId: a.preguntaId, titulo: a.texto, linea: regla.aviso };
    }
  }
  const primera = alertas[0]!;
  return { alertaId: primera.preguntaId, titulo: primera.texto, linea: null };
}

// ── El dolor y su tendencia ───────────────────────────────────────────

export interface PuntoDeDolor {
  fecha: string;
  dolor: number;
}

export interface TendenciaDelDolor {
  /** Los puntos, de la más antigua a la más reciente. */
  puntos: readonly PuntoDeDolor[];
  ultimo: number | null;
  anterior: number | null;
  /** «Mejora en cada visita», «Igual que la última vez»… */
  texto: string | null;
}

/**
 * El último dolor y hacia dónde va.
 *
 * «Mejora en cada visita» sólo se dice cuando es verdad en TODAS las
 * visitas de la gráfica, con tres o más: con dos puntos, lo que hay es una
 * comparación, no una tendencia, y decir «en cada visita» de dos visitas
 * es vender una mejoría que nadie ha medido.
 */
export function tendenciaDelDolor(
  puntos: readonly PuntoDeDolor[],
): TendenciaDelDolor {
  const ultimo = puntos.length > 0 ? puntos[puntos.length - 1]!.dolor : null;
  const anterior = puntos.length > 1 ? puntos[puntos.length - 2]!.dolor : null;
  let texto: string | null = null;
  if (puntos.length === 1) texto = "Primera medida";
  else if (ultimo != null && anterior != null) {
    const siempreBaja =
      puntos.length >= 3 &&
      puntos.every((p, i) => i === 0 || p.dolor < puntos[i - 1]!.dolor);
    texto = siempreBaja
      ? "Mejora en cada visita"
      : ultimo < anterior
        ? "Mejor que la última vez"
        : ultimo > anterior
          ? "Peor que la última vez"
          : "Igual que la última vez";
  }
  return { puntos, ultimo, anterior, texto };
}

// ── Una visita, en palabras ───────────────────────────────────────────

export interface VisitaLegible {
  entryId: string;
  fecha: string;
  /** Vacío en una v1. La lista pinta «Sesión» y no se inventa un tipo. */
  tipos: readonly TipoDeVisita[];
  tiposNombre: readonly string[];
  /** «Quiropodia completa», «Cirugía», «Sesión». */
  titulo: string;
  nivel: NivelDeQuiropodia | null;
  nivelNombre: string | null;
  dolor: number | null;
  evolucion: Evolucion | null;
  evolucionNombre: string | null;
  /** Lo que se hizo, en chips. NUNCA el nombre de un tipo (eso ya está en
   *  la columna de la izquierda, y repetirlo es ruido). */
  chips: readonly string[];
}

/**
 * Una visita tal como se lee en la lista, de la versión que sea.
 *
 * Una sesión v1 (clinica-3) sale como **«Sesión»**, con sus tratamientos
 * de chips y sin tipo. No se le finge uno: no es una visita de tipo
 * desconocido, es una visita escrita cuando los tipos no existían.
 */
export function visitaLegible(
  cuerpo: CuerpoDeSesionCualquiera | null | undefined,
  meta: { entryId: string; fecha: string },
): VisitaLegible {
  const leido = tiposDeLaSesion(cuerpo ?? null);
  const tiposNombre = leido.tipos.map((t) => NOMBRE_DE_TIPO_DE_VISITA[t]);
  const c = (cuerpo ?? {}) as Partial<CuerpoDeSesionV2 & CuerpoDeSesion>;
  const nivel = leido.bloques.QUIROPODIA?.nivelElegido ?? null;
  const nivelNombre =
    nivel != null ? (NOMBRE_DE_NIVEL[nivel] ?? null) : null;

  const titulo =
    tiposNombre.length === 0
      ? "Sesión"
      : nivel != null && leido.tipos.includes("QUIROPODIA")
        ? [
            `Quiropodia ${NOMBRE_DE_NIVEL[nivel].toLowerCase()}`,
            ...tiposNombre.filter((n) => n !== "Quiropodia"),
          ].join(" + ")
        : tiposNombre.join(" + ");

  return {
    entryId: meta.entryId,
    fecha: meta.fecha,
    tipos: leido.tipos,
    tiposNombre,
    titulo,
    nivel,
    nivelNombre,
    dolor: typeof c.dolor === "number" ? c.dolor : null,
    evolucion: (c.evolucion as Evolucion | null) ?? null,
    evolucionNombre: c.evolucion
      ? (NOMBRE_DE_EVOLUCION[c.evolucion as Evolucion] ?? null)
      : null,
    chips: chipsDeLaVisita(cuerpo, leido, tiposNombre, [
      titulo,
      ...(nivel != null ? [`Quiropodia ${NOMBRE_DE_NIVEL[nivel]}`] : []),
    ]),
  };
}

function chipsDeLaVisita(
  cuerpo: CuerpoDeSesionCualquiera | null | undefined,
  leido: ReturnType<typeof tiposDeLaSesion>,
  tiposNombre: readonly string[],
  /** Lo que ya se lee en el título de la fila y no se repite de chip. */
  extra: readonly string[] = [],
): readonly string[] {
  const c = (cuerpo ?? {}) as Partial<CuerpoDeSesionV2 & CuerpoDeSesion>;
  const chips: string[] = [];
  const versionDeActos = esCuerpoV2(cuerpo as { v?: unknown })
    ? ((c as CuerpoDeSesionV2).listas?.actos ?? undefined)
    : undefined;

  const q = leido.bloques.QUIROPODIA;
  if (q) {
    for (const acto of q.actos ?? []) {
      chips.push(nombreDeActo(acto, versionDeActos));
    }
  }
  const r = leido.bloques.PIE_RIESGO;
  if (r) {
    if (r.sensibilidad) {
      chips.push(`Sensibilidad: ${NOMBRE_DE_SENSIBILIDAD[r.sensibilidad]}`);
    }
    const pulsos = r.pulsos ?? { L: null, R: null };
    if (pulsos.L && pulsos.R) {
      chips.push(
        pulsos.L === "PRESENTE" && pulsos.R === "PRESENTE"
          ? "Pulsos presentes"
          : "Pulsos: falta alguno",
      );
    }
    if (r.ulcera) chips.push(`Úlcera: ${NOMBRE_DE_SI_NO[r.ulcera]}`);
    if (r.riesgo) chips.push(r.riesgo.nombre);
  }
  const cir = leido.bloques.CIRUGIA;
  if (cir) {
    if (cir.herida) chips.push(nombreDeOpcionDeBloque(cir.herida));
    if (cir.puntos) chips.push(`Puntos: ${nombreDeOpcionDeBloque(cir.puntos)}`);
  }
  const bio = leido.bloques.BIOMECANICA;
  if (bio) {
    if (bio.tipoDePie) chips.push(nombreDeOpcionDeBloque(bio.tipoDePie));
    if (bio.pisada) chips.push(`Pisada ${nombreDeOpcionDeBloque(bio.pisada).toLowerCase()}`);
    if (bio.plantillas) chips.push("Plantillas");
  }

  // Y los SERVICIOS, con el nombre congelado en el cuerpo. Es lo que hace
  // legible una v1 (que no tiene bloques) y lo que añade «Matricectomía
  // parcial» a una cirugía.
  for (const nombre of Object.values(c.tratamientosNombre ?? {})) {
    if (typeof nombre === "string") chips.push(nombre);
  }

  // Nunca lo que ya está escrito en la fila, y sin duplicados.
  //
  // Son DOS cosas y las dos las encontró el bucle visual: el nombre del
  // TIPO (la columna de la izquierda ya dice «Quiropodia») y el del
  // NIVEL, que es un servicio del catálogo llamado «Quiropodia completa»
  // — exactamente el título de la visita, con sus tres barras al lado.
  // Un chip que repite el título no es información: es ruido en la fila
  // que la podóloga lee de un vistazo.
  const fuera = new Set(
    [...tiposNombre, ...extra].map((n) => n.toLowerCase()),
  );
  const vistos = new Set<string>();
  return chips.filter((ch) => {
    const k = ch.toLowerCase();
    if (fuera.has(k) || vistos.has(k)) return false;
    vistos.add(k);
    return true;
  });
}

/** La última visita, ya legible. `null` sin ninguna. */
export function ultimaVisita(
  visitas: readonly VisitaLegible[],
): VisitaLegible | null {
  if (visitas.length === 0) return null;
  return [...visitas].sort((a, b) => (a.fecha < b.fecha ? 1 : -1))[0]!;
}

/** El punto de `marcas` que convierte un cuerpo en una `VisitaDeLaHistoria`.
 *  Vive aquí para que la API y los tests lo lean igual. */
export function visitaDeLaHistoria(
  cuerpo: CuerpoDeSesionCualquiera | null | undefined,
  meta: { entryId: string; fecha: string },
): VisitaDeLaHistoria {
  const c = (cuerpo ?? {}) as Partial<CuerpoDeSesionV2 & CuerpoDeSesion>;
  return {
    entryId: meta.entryId,
    fecha: meta.fecha,
    v: typeof c.v === "number" ? c.v : 1,
    tipos: tiposDeLaSesion(cuerpo ?? null).tipos,
    marcas:
      c.marcas != null && typeof c.marcas === "object"
        ? (c.marcas as Marcas)
        : {},
    mapaVersion:
      typeof c.mapaVersion === "number" ? c.mapaVersion : VERSION_DEL_MAPA,
    lesionesVersion:
      typeof c.lesionesVersion === "number" ? c.lesionesVersion : 1,
  };
}
