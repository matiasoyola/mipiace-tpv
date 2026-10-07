// clinica-5 · EL CUERPO DE SESIÓN v2: la visita con varios tipos.
//
// La v1 de clinica-3 servía para una quiropodia: un mapa, unos
// tratamientos, un dolor. Esto es la misma sesión cuando la visita puede
// ser de hasta cinco clases a la vez — y cuando cada clase tiene lo suyo
// que anotar y lo suyo que cobrar.
//
// ── Por qué una VERSIÓN y no un campo más ─────────────────────────────
//
// Porque el cuerpo cambia de FORMA, no de contenido. La v1 guardaba
// `tratamientos` como «lo que la podóloga tocó»; la v2 guarda `tipos`,
// `bloques` y, derivado de ellos, el mismo `tratamientos` como «lo que
// pasa a caja». Un cuerpo con las dos lecturas conviviendo sin número de
// versión sería un JSON del que hay que adivinar qué significa cada clave,
// y eso en una historia clínica es exactamente lo que el versionado existe
// para impedir.
//
// **Las sesiones v1 se siguen leyendo igual que hoy** (prompt §1): no hay
// migración de datos, no se reescribe nada, y `esCuerpoV2` es la única
// pregunta que hace falta hacerse. Una sesión de clinica-3 sigue
// enseñándose con sus tratamientos y sin tipos, que es lo que era.
//
// ── `tratamientos` SIGUE SIENDO LA PUERTA A CAJA ──────────────────────
//
// Y es la decisión que más código ahorra en este bloque. El prompt pide
// que `lineas-de-la-sesion.ts` devuelva las líneas de **todos** los tipos
// «con el mismo camino de cobro de siempre (sin rama paralela)».
//
// Se consigue así: al cerrar, `serviciosDeLaSesion` resuelve los servicios
// de todos los tipos marcados —para la quiropodia, el producto del nivel
// elegido; para el resto, los servicios tocados— y el resultado se CONGELA
// en `tratamientos`, la misma clave que leía la v1. El camino de cobro no
// se entera de que existen los tipos: sigue leyendo una lista de ids.
//
// La alternativa era que el cobro recorriera los bloques, y entonces
// `checkout.ts` tendría que saber qué es un nivel de quiropodia. La
// derivación vive en UNA función pura con su test, y el cobro lee lo que
// esa función dejó escrito.

import type { CausaExencion } from "@mipiacetpv/ticket-model";

import {
  esOpcionDe,
  ESTADOS_DE_HERIDA,
  PISADAS,
  PUNTOS_DE_LA_HERIDA,
  TIPOS_DE_PIE_BIOMECANICA,
  VERSION_DE_LOS_BLOQUES,
} from "./bloques.js";
import {
  avisosCruzados,
  VERSION_DE_LAS_ALERTAS_CRUZADAS,
} from "./alertas-cruzadas.js";
import {
  actoDe,
  esNivelDeQuiropodia,
  nivelPropuesto,
  VERSION_DE_LA_REGLA_DE_NIVEL,
  VERSION_DE_LOS_ACTOS,
  type NivelDeQuiropodia,
} from "./niveles.js";
import { VERSION_DEL_MAPA } from "./mapa.js";
import {
  esEvolucion,
  esProximaCita,
  consejoDe,
  VERSION_DE_LAS_LESIONES,
  VERSION_DE_LOS_CONSEJOS,
  type Evolucion,
  type ProximaCita,
} from "./listas.js";
import {
  cierresAutomaticos,
  pendientesACrear,
  VERSION_DE_LOS_PENDIENTES,
  type PendienteCerrado,
  type PendienteCreado,
} from "./pendientes.js";
import {
  comprobacionesVacias,
  esPulsoPedio,
  esSensibilidad,
  esSiNo,
  riesgoDelPie,
  VERSION_DEL_RIESGO,
  type ComprobacionesDelPie,
  type RiesgoDelPie,
} from "./riesgo.js";
import {
  dolorEsValido,
  limpiarMarcas,
  textoDelIva,
  type CuerpoDeSesion,
  type LineaDelResumen,
  type MarcaDeZona,
  type Marcas,
  type TratamientoDelCatalogo,
} from "./sesion.js";
import {
  esEspecialidad,
  esTipoDeVisita,
  especialidadDeLosTipos,
  NOMBRE_DE_TIPO_DE_VISITA,
  TIPOS_DE_VISITA,
  VERSION_DE_LOS_TIPOS,
  type Especialidad,
  type TipoDeVisita,
} from "./tipos-de-visita.js";

/** La versión del cuerpo de este bloque. */
export const VERSION_DEL_CUERPO_V2 = 2;

// ── Los bloques, uno por tipo ─────────────────────────────────────────

export interface BloqueQuiropodia {
  /** Los actos tocados, ids de `ACTOS_QUIROPODIA_V1`. */
  actos: readonly string[];
  /** Lo que el programa propuso por esos actos. */
  nivelPropuesto: NivelDeQuiropodia;
  /** Lo que se cobra. Distinto del propuesto = se cambió a mano, y queda
   *  escrito: «propuesto completa, cobrado extra» (decisión 4). */
  nivelElegido: NivelDeQuiropodia;
  /** El producto del catálogo del nivel elegido, o `null` si el centro no
   *  ha dicho cuál es el servicio de ese nivel. `null` es «sin cobro» para
   *  la quiropodia, no un cobro a cero. */
  productoDelNivel: string | null;
  /** Los OTROS servicios de quiropodia tocados (una cura, un papiloma, el
   *  domicilio): los que el centro tiene en la categoría y no son uno de
   *  los tres niveles. */
  servicios: readonly string[];
}

export interface BloquePieDeRiesgo extends ComprobacionesDelPie {
  /** El veredicto, CONGELADO. `null` si faltaba alguna comprobación.
   *
   *  Se guarda y no se recalcula al leer, y es la misma razón que la
   *  versión de las listas: el criterio puede cambiar, y lo que hay que
   *  poder contestar dentro de cinco años es «qué riesgo se le dijo ese
   *  día», no «qué riesgo tendría hoy con ese pie». */
  riesgo: RiesgoDelPie | null;
  servicios: readonly string[];
}

export interface BloqueCirugia {
  /** Estado de la herida, id de `ESTADOS_DE_HERIDA`. */
  herida: string | null;
  /** Puntos, id de `PUNTOS_DE_LA_HERIDA`. */
  puntos: string | null;
  servicios: readonly string[];
}

export interface BloqueBiomecanica {
  tipoDePie: string | null;
  pisada: string | null;
  plantillas: boolean;
  servicios: readonly string[];
}

export interface BloqueGeneral {
  servicios: readonly string[];
}

/**
 * Los bloques de la sesión, uno por tipo marcado.
 *
 * Un objeto con cinco claves opcionales y no un array de `{tipo, datos}`:
 * así el typecheck sabe que `bloques.QUIROPODIA` tiene actos y
 * `bloques.CIRUGIA` tiene herida, que es justo lo que un array de uniones
 * no puede decir sin un `switch` en cada lectura.
 */
export interface BloquesDeLaSesion {
  QUIROPODIA?: BloqueQuiropodia;
  PIE_RIESGO?: BloquePieDeRiesgo;
  CIRUGIA?: BloqueCirugia;
  BIOMECANICA?: BloqueBiomecanica;
  GENERAL?: BloqueGeneral;
}

/**
 * Las versiones de las listas NUEVAS, agrupadas.
 *
 * Las cuatro de la v1 (`mapaVersion`, `lesionesVersion`,
 * `consejosVersion`) siguen sueltas en el cuerpo y no se mueven aquí: hay
 * código que las lee por su nombre (`marcasLegibles`, la vista de la
 * sesión cerrada) y moverlas habría sido romper la lectura de las v1 para
 * ganar simetría. Las nuevas van juntas porque son siete y porque nacen
 * juntas.
 */
export interface VersionesDeLasListas {
  tipos: number;
  actos: number;
  reglaDeNivel: number;
  riesgo: number;
  bloques: number;
  alertasCruzadas: number;
  pendientes: number;
}

export function versionesDeHoy(): VersionesDeLasListas {
  return {
    tipos: VERSION_DE_LOS_TIPOS,
    actos: VERSION_DE_LOS_ACTOS,
    reglaDeNivel: VERSION_DE_LA_REGLA_DE_NIVEL,
    riesgo: VERSION_DEL_RIESGO,
    bloques: VERSION_DE_LOS_BLOQUES,
    alertasCruzadas: VERSION_DE_LAS_ALERTAS_CRUZADAS,
    pendientes: VERSION_DE_LOS_PENDIENTES,
  };
}

/** El cuerpo de la sesión v2, tal como entra en `clinical_entries.body`. */
export interface CuerpoDeSesionV2 {
  v: 2;
  mapaVersion: number;
  lesionesVersion: number;
  consejosVersion: number;
  listas: VersionesDeLasListas;
  /**
   * LA ESPECIALIDAD CON LA QUE SE HIZO, congelada (S5, regla 2 de la
   * respuesta de clínica).
   *
   * Si mañana Rosario cambia las etiquetas de sus servicios, esta sesión
   * no cambia de significado ni de pantalla. `null` no debería darse —no
   * hay tipos sin especialidad— y se admite porque un cuerpo leído de la
   * base puede traer cualquier cosa y una historia no se esconde por eso.
   */
  especialidad: Especialidad | null;
  /** Los tipos marcados, en el orden de `TIPOS_DE_VISITA`. Al menos uno. */
  tipos: readonly TipoDeVisita[];
  bloques: BloquesDeLaSesion;
  marcas: Marcas;
  /** LO QUE PASA A CAJA, ya resuelto. Ver la cabecera del fichero. */
  tratamientos: readonly string[];
  tratamientosNombre: Readonly<Record<string, string>>;
  dolor: number;
  evolucion: Evolucion | null;
  consejos: readonly string[];
  proximaCita: ProximaCita | null;
  nota: string | null;
  /**
   * Los avisos cruzados que SE LE ENSEÑARON. Se guardan, y no se
   * recalculan al leer la historia.
   *
   * Porque la pregunta que hay que poder contestar es «¿se le avisó de
   * que era anticoagulada antes de cortar?», y eso es un hecho de ese
   * día. Recalculándolo con la tabla de hoy, una fila nueva en la tabla
   * haría que la historia dijera que se avisó de algo que en 2026 nadie
   * avisó.
   */
  avisos: readonly string[];
  /** Lo que queda para la próxima visita (decisión 10). */
  pendientesCreados: readonly PendienteCreado[];
  /** Y lo que esta sesión cerró de lo que venía. */
  pendientesCerrados: readonly PendienteCerrado[];
  firma: {
    autorNombre: string;
    colegiado: string | null;
    firmadaEn: string;
  };
}

/**
 * El cuerpo de UNA sesión, de la versión que sea.
 *
 * Es el tipo con el que se lee `clinical_entries.body` de una sesión, y es
 * una unión y no una interfaz con todo opcional a propósito: con todo
 * opcional, `cuerpo.tipos` compilaría sobre una v1 y devolvería
 * `undefined` en producción. Con la unión, quien quiera los tipos tiene
 * que pasar por `tiposDeLaSesion`, que sabe contestar las dos.
 *
 * Lo que las dos versiones comparten —`tratamientos`, `dolor`, `marcas`,
 * `firma`, las tres versiones de listas de clinica-3— se puede leer sin
 * preguntar nada, y por eso el camino de cobro y la vista de la sesión
 * cerrada no cambiaron una línea.
 */
export type CuerpoDeSesionV1 = CuerpoDeSesion;
export type CuerpoDeSesionCualquiera = CuerpoDeSesionV1 | CuerpoDeSesionV2;

/**
 * ¿Es un cuerpo v2? La ÚNICA pregunta que hay que hacerse para leer la
 * historia de una clínica que lleva dos bloques.
 *
 * `>= 2` y no `=== 2` a propósito: el día que haya una v3, un despliegue
 * viejo que lea una v3 acertará más tratándola como v2 (tiene tipos, tiene
 * bloques) que como v1 (no los tiene). Lo que no se hace nunca es pintar
 * una v1 como v2: ahí sí se inventarían datos.
 */
export function esCuerpoV2(
  cuerpo: { v?: unknown } | null | undefined,
): boolean {
  return typeof cuerpo?.v === "number" && cuerpo.v >= VERSION_DEL_CUERPO_V2;
}

// ── El catálogo, con el tipo y el nivel ───────────────────────────────

/**
 * Lo que el catálogo dice de un servicio de sesión, ampliado con lo que
 * este bloque necesita.
 *
 * Los dos campos nuevos son opcionales porque la v1 de la pantalla y de
 * los tests siguen construyendo `TratamientoDelCatalogo` sin ellos, y
 * porque un servicio de un centro no clínico no tiene ninguno de los dos.
 */
export interface ServicioDeSesion extends TratamientoDelCatalogo {
  /** El tipo de visita que hereda de su categoría (S5). */
  tipo?: TipoDeVisita | null;
  /** Si es uno de los tres niveles de quiropodia, cuál. */
  nivelQuiropodia?: NivelDeQuiropodia | null;
}

/**
 * El producto del catálogo que cobra un nivel de quiropodia, o `null`.
 *
 * `null` no es un error que haya que gritar: es un centro que todavía no
 * ha dicho qué servicio es «quiropodia extra», y lo correcto entonces es
 * que la sesión se pueda cerrar y se vea «sin cobro» (regla 11 del
 * prompt). Un 409 habría sido no poder registrar lo que se le hizo a una
 * persona por una casilla del catálogo.
 */
export function productoDelNivel(
  catalogo: readonly ServicioDeSesion[],
  nivel: NivelDeQuiropodia,
): string | null {
  return (
    catalogo.find((s) => s.nivelQuiropodia === nivel)?.serviceId ?? null
  );
}

/**
 * Los servicios que cada tipo ofrece como botón, agrupados.
 *
 * Los tres niveles de quiropodia NO salen aquí: ésos los elige el nivel, y
 * un chip suelto de «Quiropodia extra» al lado del selector de nivel sería
 * la misma línea cobrable por dos caminos.
 */
export function serviciosPorTipo(
  catalogo: readonly ServicioDeSesion[],
): Record<TipoDeVisita, readonly ServicioDeSesion[]> {
  const salida = {} as Record<TipoDeVisita, ServicioDeSesion[]>;
  for (const t of TIPOS_DE_VISITA) salida[t] = [];
  for (const s of catalogo) {
    if (s.nivelQuiropodia != null) continue;
    if (s.tipo == null) continue;
    salida[s.tipo].push(s);
  }
  return salida;
}

// ── LA DERIVACIÓN: de los bloques a las líneas de caja ────────────────

/**
 * Los servicios que esta sesión pasa a caja, en el orden de los tipos.
 *
 * Es la función que `normalizarSesionV2` congela en `tratamientos` y la
 * que el test de «líneas a caja de dos tipos» sabotea.
 *
 * Reglas, una por tipo:
 *
 *   · **Quiropodia** · el producto del nivel elegido, más los otros
 *     servicios de quiropodia tocados (una cura, un papiloma).
 *   · **Los otros cuatro** · los servicios tocados, y nada más. Un tipo
 *     sin servicio tocado no pone línea, y entonces se ve «sin cobro»
 *     (regla 11).
 *
 * Sin repetidos: el mismo servicio tocado en dos tipos es una línea. Dos
 * líneas iguales en un ticket son dos cobros de lo mismo.
 */
export function serviciosDeLaSesion(
  tipos: readonly TipoDeVisita[],
  bloques: BloquesDeLaSesion,
): readonly string[] {
  const salida: string[] = [];
  const vistos = new Set<string>();
  const añadir = (id: string | null | undefined) => {
    if (!id || vistos.has(id)) return;
    vistos.add(id);
    salida.push(id);
  };

  for (const tipo of TIPOS_DE_VISITA) {
    if (!tipos.includes(tipo)) continue;
    if (tipo === "QUIROPODIA") {
      añadir(bloques.QUIROPODIA?.productoDelNivel);
    }
    for (const id of bloques[tipo]?.servicios ?? []) añadir(id);
  }
  return salida;
}

// ── El pie de la sesión, por tipos ────────────────────────────────────

export interface LineaPorTipo extends LineaDelResumen {
  tipo: TipoDeVisita;
}

/**
 * Un tipo marcado que no pone ninguna línea, con POR QUÉ.
 *
 * Los dos motivos son cosas distintas y la barra de caja tiene que
 * decirlas distinto —lo encontró el bucle visual, no un test:
 *
 *   · `SIN_SERVICIO` · el centro no le ha asignado ningún servicio a la
 *     categoría de ese tipo. Hay algo que arreglar en el catálogo.
 *   · `NADA_MARCADO` · sí lo hay y la podóloga no ha tocado ninguno. No
 *     hay nada que arreglar: la visita se anota y no se cobra.
 *
 * Con un solo texto, la barra decía «no hay servicio asignado» de un pie
 * de riesgo que tenía su consulta de 20 € ahí al lado, sin marcar.
 */
export interface TipoSinCobro {
  tipo: TipoDeVisita;
  motivo: "SIN_SERVICIO" | "NADA_MARCADO";
}

export interface ResumenPorTipos {
  lineas: readonly LineaPorTipo[];
  /** Los tipos marcados que no ponen ninguna línea, con su motivo. Lo que
   *  la barra de caja enseña como «sin cobro» (regla 11). */
  sinCobro: readonly TipoSinCobro[];
  /** `null` para quien no ve importes. No es 0: **la clave no está**. */
  total: number | null;
  ivaTexto: string | null;
  faltaDolor: boolean;
  /** Como mínimo un tipo (decisión 1). */
  faltaTipo: boolean;
  puedeCerrar: boolean;
  textoDelBoton: string;
}

/**
 * La barra de caja del mockup —«Pasa a caja: Quiropodia completa · 26 € +
 * Cura · 13 € = 39 €»— calculada una vez para la pantalla y para la API.
 *
 * ── Lo que cambia respecto de la v1 ──────────────────────────────────
 *
 * `resumenDeLaSesion` (v1) no dejaba cerrar sin al menos un tratamiento.
 * Aquí **sí se puede cerrar sin ninguna línea**, y no es un descuido: la
 * regla 11 dice que un tipo sin servicio asignado se ve «sin cobro». Un
 * control de pie de riesgo al que el centro no le ha puesto servicio es
 * una visita que PASÓ y que tiene que quedar escrita; no cobrarla es un
 * problema de catálogo, y negarse a registrarla sería perder la historia
 * por una casilla.
 *
 * Lo que sigue siendo obligatorio es lo clínico: un tipo y el dolor.
 */
export function resumenPorTipos(input: {
  tipos: readonly TipoDeVisita[];
  bloques: BloquesDeLaSesion;
  catalogo: readonly ServicioDeSesion[];
  dolor: number | null;
  verImportes: boolean;
}): ResumenPorTipos {
  const porId = new Map(input.catalogo.map((s) => [s.serviceId, s]));
  const lineas: LineaPorTipo[] = [];
  const sinCobro: TipoSinCobro[] = [];
  const vistos = new Set<string>();
  // ¿Tiene el centro ALGÚN servicio para este tipo? Para la quiropodia
  // cuentan también los tres niveles, que no son chips pero sí son línea.
  const hayServicioDe = (tipo: TipoDeVisita) =>
    input.catalogo.some(
      (s) => s.tipo === tipo || (tipo === "QUIROPODIA" && s.nivelQuiropodia != null),
    );

  for (const tipo of TIPOS_DE_VISITA) {
    if (!input.tipos.includes(tipo)) continue;
    const ids: string[] = [];
    if (tipo === "QUIROPODIA" && input.bloques.QUIROPODIA?.productoDelNivel) {
      ids.push(input.bloques.QUIROPODIA.productoDelNivel);
    }
    ids.push(...(input.bloques[tipo]?.servicios ?? []));

    let puso = false;
    for (const id of ids) {
      if (vistos.has(id)) continue;
      const s = porId.get(id);
      // Sólo los que el catálogo reconoce: un id que ya no es un servicio
      // de sesión no es una línea que se pueda cobrar (misma regla que
      // `resumenDeLaSesion`).
      if (!s) continue;
      vistos.add(id);
      puso = true;
      lineas.push({
        tipo,
        serviceId: s.serviceId,
        nombre: s.nombre,
        precio: input.verImportes ? s.precio : null,
        iva: input.verImportes ? s.iva : null,
        ...(input.verImportes && s.causaExencion
          ? { causaExencion: s.causaExencion as CausaExencion }
          : {}),
      });
    }
    if (!puso) {
      sinCobro.push({
        tipo,
        motivo: hayServicioDe(tipo) ? "NADA_MARCADO" : "SIN_SERVICIO",
      });
    }
  }

  const elegidos = lineas
    .map((l) => porId.get(l.serviceId))
    .filter((s): s is ServicioDeSesion => s != null);

  const faltaDolor = !dolorEsValido(input.dolor);
  const faltaTipo = input.tipos.length === 0;

  return {
    lineas,
    sinCobro,
    total: input.verImportes
      ? redondearCentimos(elegidos.reduce((a, s) => a + s.precio, 0))
      : null,
    ivaTexto: input.verImportes ? textoDelIva(elegidos) : null,
    faltaDolor,
    faltaTipo,
    puedeCerrar: !faltaDolor && !faltaTipo,
    textoDelBoton: input.verImportes
      ? "Cerrar sesión y cobrar"
      : "Cerrar sesión",
  };
}

function redondearCentimos(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Cómo se lee «sin cobro» en la barra.
 *
 * Se redacta aquí y no en la pantalla porque es una frase que explica un
 * NO-cobro, y eso es de las cosas que no pueden tener dos redacciones. Y
 * se agrupa por MOTIVO porque los dos motivos piden cosas distintas: uno
 * es ir al catálogo, el otro es tocar un botón (o no, si de verdad no hay
 * nada que cobrar).
 */
export function textoSinCobro(
  sinCobro: readonly TipoSinCobro[],
): string | null {
  if (sinCobro.length === 0) return null;
  const partes: string[] = [];
  const porMotivo = (motivo: TipoSinCobro["motivo"]) =>
    sinCobro
      .filter((x) => x.motivo === motivo)
      .map((x) => NOMBRE_DE_TIPO_DE_VISITA[x.tipo]);
  const sinServicio = porMotivo("SIN_SERVICIO");
  if (sinServicio.length > 0) {
    partes.push(
      `${sinServicio.join(" y ")}: sin cobro, no hay servicio en su categoría`,
    );
  }
  const nadaMarcado = porMotivo("NADA_MARCADO");
  if (nadaMarcado.length > 0) {
    partes.push(`${nadaMarcado.join(" y ")}: sin cobro, no has marcado nada`);
  }
  return partes.join(" · ");
}

// ── La normalización del cierre ───────────────────────────────────────

/** Lo que llega de la pantalla, tal cual. Todo `unknown` o parcial: el
 *  schema de Fastify ya rechazó lo que tiene mala FORMA, y esto comprueba
 *  lo que tiene mal SENTIDO. */
export interface EntradaDeCierreV2 {
  tipos: readonly unknown[];
  bloques: {
    QUIROPODIA?: {
      actos?: readonly unknown[];
      nivelElegido?: unknown;
      servicios?: readonly unknown[];
    } | null;
    PIE_RIESGO?: {
      sensibilidad?: unknown;
      pulsos?: { L?: unknown; R?: unknown } | null;
      ulcera?: unknown;
      deformidad?: unknown;
      servicios?: readonly unknown[];
    } | null;
    CIRUGIA?: {
      herida?: unknown;
      puntos?: unknown;
      servicios?: readonly unknown[];
    } | null;
    BIOMECANICA?: {
      tipoDePie?: unknown;
      pisada?: unknown;
      plantillas?: unknown;
      servicios?: readonly unknown[];
    } | null;
    GENERAL?: { servicios?: readonly unknown[] } | null;
  };
  marcas: Readonly<Record<string, Partial<MarcaDeZona> | null | undefined>>;
  catalogo: readonly ServicioDeSesion[];
  dolor: unknown;
  evolucion: unknown;
  consejos: readonly string[];
  proximaCita: unknown;
  nota: unknown;
  /** Las ids de las alertas vigentes de la valoración (clinica-2). */
  alertaIds: readonly string[];
  /** Los pendientes que venían abiertos de la última sesión. */
  pendientesAbiertos: readonly PendienteCreado[];
  /** Los que la podóloga ha cerrado a mano o contestando el diálogo. */
  pendientesCerradosAMano: readonly PendienteCerrado[];
  /** Lo que apunta para la próxima visita. */
  pendientesNuevos: readonly {
    id: string;
    zona: string | null;
    nota: string | null;
  }[];
  /** ISO-8601 de hoy. Entra como dato: este paquete no tiene reloj. */
  hoy: string;
}

export type SesionV2Normalizada =
  | { ok: true; cuerpo: Omit<CuerpoDeSesionV2, "firma"> }
  | {
      ok: false;
      motivo: "SIN_TIPOS" | "FALTA_DOLOR";
      mensaje: string;
    };

/**
 * Valida y normaliza el cierre de una sesión v2. La MISMA función que usa
 * la pantalla para el botón y la API para escribir.
 *
 * Lo que rechaza:
 *
 *   · **sin tipos** · «como mínimo uno» (decisión 1). Una visita sin tipo
 *     no se sabe qué fue.
 *   · **sin dolor** · igual que la v1 (decisión de producto 6 de
 *     clinica-3): lo marca el paciente y es obligatorio.
 *
 * Lo que NO rechaza, y conviene saberlo: que no haya ni una línea de caja
 * (ver `resumenPorTipos`), y que queden pendientes sin contestar. Lo
 * segundo es a propósito: el diálogo del cierre es de la pantalla y la API
 * no puede comprobar que se preguntó. Lo que la API SÍ garantiza —y es la
 * garantía que importa— es que **un pendiente sin cerrar nunca se cae**:
 * `pendientesACrear` lo arrastra a la sesión de hoy haga lo que haga la
 * pantalla.
 */
export function normalizarSesionV2(
  input: EntradaDeCierreV2,
): SesionV2Normalizada {
  // 1 · los tipos, en el orden de la lista y sin repetidos.
  const tipos = TIPOS_DE_VISITA.filter((t) =>
    input.tipos.some((x) => esTipoDeVisita(x) && x === t),
  );
  if (tipos.length === 0) {
    return {
      ok: false,
      motivo: "SIN_TIPOS",
      mensaje:
        "Marca al menos un tipo de visita (quiropodia, pie de riesgo, cirugía, biomecánica o general).",
    };
  }
  if (!dolorEsValido(input.dolor)) {
    return {
      ok: false,
      motivo: "FALTA_DOLOR",
      mensaje: "Falta el dolor de hoy (de 0 a 10). Pregúntaselo al paciente.",
    };
  }

  const servicioValido = new Set(input.catalogo.map((s) => s.serviceId));
  const limpiarServicios = (
    xs: readonly unknown[] | undefined,
    tipo: TipoDeVisita,
  ): readonly string[] => {
    const salida: string[] = [];
    for (const x of xs ?? []) {
      if (typeof x !== "string" || !servicioValido.has(x)) continue;
      const s = input.catalogo.find((c) => c.serviceId === x)!;
      // Un servicio de OTRO tipo no entra en este bloque. Se tira en
      // silencio, como las marcas de una zona que no existe: quien está
      // delante de la pantalla no tiene nada que arreglar, y lo que
      // importa es que no entre en la historia.
      if (s.tipo != null && s.tipo !== tipo) continue;
      // Y los tres niveles de quiropodia tampoco: ésos los pone el nivel.
      if (s.nivelQuiropodia != null) continue;
      if (!salida.includes(x)) salida.push(x);
    }
    return salida;
  };

  const bloques: BloquesDeLaSesion = {};

  if (tipos.includes("QUIROPODIA")) {
    const b = input.bloques.QUIROPODIA ?? {};
    const actos = limpiarActos(b.actos);
    const propuesto = nivelPropuesto(actos).nivel;
    const elegido = esNivelDeQuiropodia(b.nivelElegido)
      ? b.nivelElegido
      : propuesto;
    bloques.QUIROPODIA = {
      actos,
      nivelPropuesto: propuesto,
      nivelElegido: elegido,
      productoDelNivel: productoDelNivel(input.catalogo, elegido),
      servicios: limpiarServicios(b.servicios, "QUIROPODIA"),
    };
  }

  if (tipos.includes("PIE_RIESGO")) {
    const b = input.bloques.PIE_RIESGO ?? {};
    const comprobaciones: ComprobacionesDelPie = {
      ...comprobacionesVacias(),
      sensibilidad: esSensibilidad(b.sensibilidad) ? b.sensibilidad : null,
      pulsos: {
        L: esPulsoPedio(b.pulsos?.L) ? b.pulsos.L : null,
        R: esPulsoPedio(b.pulsos?.R) ? b.pulsos.R : null,
      },
      ulcera: esSiNo(b.ulcera) ? b.ulcera : null,
      deformidad: esSiNo(b.deformidad) ? b.deformidad : null,
    };
    bloques.PIE_RIESGO = {
      ...comprobaciones,
      // CALCULADO AQUÍ y congelado. La pantalla también lo calcula para
      // pintarlo, pero lo que entra en la historia es lo que dice el
      // servidor: la misma regla que el nivel.
      riesgo: riesgoDelPie(comprobaciones),
      servicios: limpiarServicios(b.servicios, "PIE_RIESGO"),
    };
  }

  if (tipos.includes("CIRUGIA")) {
    const b = input.bloques.CIRUGIA ?? {};
    bloques.CIRUGIA = {
      herida: esOpcionDe(ESTADOS_DE_HERIDA, b.herida)
        ? (b.herida as string)
        : null,
      puntos: esOpcionDe(PUNTOS_DE_LA_HERIDA, b.puntos)
        ? (b.puntos as string)
        : null,
      servicios: limpiarServicios(b.servicios, "CIRUGIA"),
    };
  }

  if (tipos.includes("BIOMECANICA")) {
    const b = input.bloques.BIOMECANICA ?? {};
    bloques.BIOMECANICA = {
      tipoDePie: esOpcionDe(TIPOS_DE_PIE_BIOMECANICA, b.tipoDePie)
        ? (b.tipoDePie as string)
        : null,
      pisada: esOpcionDe(PISADAS, b.pisada) ? (b.pisada as string) : null,
      plantillas: b.plantillas === true,
      servicios: limpiarServicios(b.servicios, "BIOMECANICA"),
    };
  }

  if (tipos.includes("GENERAL")) {
    bloques.GENERAL = {
      servicios: limpiarServicios(
        input.bloques.GENERAL?.servicios,
        "GENERAL",
      ),
    };
  }

  const marcas = limpiarMarcas(input.marcas);
  const tratamientos = serviciosDeLaSesion(tipos, bloques);
  const porId = new Map(input.catalogo.map((s) => [s.serviceId, s]));

  // ── Los pendientes ────────────────────────────────────────────────
  //
  // El cierre automático se vuelve a calcular AQUÍ con lo que de verdad se
  // ha marcado, y no se cree lo que diga la pantalla: un pendiente cerrado
  // porque «ya lo marqué» sin haber tocado la zona sería una revisión que
  // consta hecha y no se hizo.
  const loDeHoy = {
    zonasTocadas: Object.keys(marcas),
    herida: bloques.CIRUGIA?.herida ?? null,
    tipos,
  };
  const abiertos = input.pendientesAbiertos;
  const automaticos = cierresAutomaticos(abiertos, loDeHoy);
  const clavesAbiertas = new Set(
    abiertos.map((p) => `${p.id}|${p.zona ?? ""}`),
  );
  const yaCerrados = new Set(automaticos.map((p) => `${p.id}|${p.zona ?? ""}`));
  const pendientesCerrados: PendienteCerrado[] = [...automaticos];
  for (const p of input.pendientesCerradosAMano) {
    const clave = `${p.id}|${p.zona ?? ""}`;
    // Sólo se puede cerrar lo que estaba abierto. Cerrar a mano un
    // pendiente que nadie apuntó es un dato inventado en una historia.
    if (!clavesAbiertas.has(clave) || yaCerrados.has(clave)) continue;
    yaCerrados.add(clave);
    pendientesCerrados.push({
      id: p.id,
      zona: p.zona,
      como: p.como === "PREGUNTA" ? "PREGUNTA" : "MANO",
    });
  }

  const pendientesCreados = pendientesACrear({
    nuevos: input.pendientesNuevos,
    abiertos,
    cerrados: pendientesCerrados,
    hoy: input.hoy,
  });

  const avisos = avisosCruzados({
    alertaIds: input.alertaIds,
    tipos,
    actos: bloques.QUIROPODIA?.actos ?? [],
    herida: bloques.CIRUGIA?.herida ?? null,
  }).map((a) => a.aviso);

  const nota =
    typeof input.nota === "string" && input.nota.trim().length > 0
      ? input.nota.trim()
      : null;

  return {
    ok: true,
    cuerpo: {
      v: VERSION_DEL_CUERPO_V2,
      mapaVersion: VERSION_DEL_MAPA,
      lesionesVersion: VERSION_DE_LAS_LESIONES,
      consejosVersion: VERSION_DE_LOS_CONSEJOS,
      listas: versionesDeHoy(),
      especialidad: especialidadDeLosTipos(tipos),
      tipos,
      bloques,
      marcas,
      tratamientos,
      tratamientosNombre: Object.fromEntries(
        tratamientos.map((id) => [id, porId.get(id)!.nombre]),
      ),
      dolor: input.dolor,
      evolucion: esEvolucion(input.evolucion) ? input.evolucion : null,
      consejos: [
        ...new Set(
          input.consejos.filter(
            (id) => consejoDe(id, VERSION_DE_LOS_CONSEJOS) != null,
          ),
        ),
      ],
      proximaCita: esProximaCita(input.proximaCita) ? input.proximaCita : null,
      nota,
      avisos,
      pendientesCreados,
      pendientesCerrados,
    },
  };
}

/** Los actos de la lista de hoy, sin repetidos y en el orden en que la
 *  podóloga los tocó. Lo que no es de la lista se tira en silencio, igual
 *  que `limpiarMarcas` con una zona que no existe. */
function limpiarActos(xs: readonly unknown[] | undefined): readonly string[] {
  const salida: string[] = [];
  for (const x of xs ?? []) {
    if (typeof x !== "string") continue;
    if (!actoDe(x, VERSION_DE_LOS_ACTOS)) continue;
    if (!salida.includes(x)) salida.push(x);
  }
  return salida;
}

// ── Leer una sesión escrita, sea v1 o v2 ──────────────────────────────

export interface TiposDeLaSesion {
  /** Los tipos marcados, o vacío en una v1. */
  tipos: readonly TipoDeVisita[];
  especialidad: Especialidad | null;
  bloques: BloquesDeLaSesion;
  pendientesCreados: readonly PendienteCreado[];
  pendientesCerrados: readonly PendienteCerrado[];
  avisos: readonly string[];
}

/**
 * Lee la parte de tipos de un cuerpo cualquiera.
 *
 * Para una v1 devuelve todo vacío, y es la lectura honesta: una sesión de
 * clinica-3 no es «una sesión de tipo desconocido», es una sesión escrita
 * cuando los tipos no existían. La pantalla de sesión cerrada la enseña
 * como siempre (tratamientos, dolor, mapa) y no pinta chips de tipo.
 *
 * Es la función que hace verdad el «las sesiones v1 se siguen leyendo».
 */
export function tiposDeLaSesion(
  cuerpo: CuerpoDeSesion | CuerpoDeSesionV2 | null | undefined,
): TiposDeLaSesion {
  const vacio: TiposDeLaSesion = {
    tipos: [],
    especialidad: null,
    bloques: {},
    pendientesCreados: [],
    pendientesCerrados: [],
    avisos: [],
  };
  if (!cuerpo || !esCuerpoV2(cuerpo)) return vacio;
  const c = cuerpo as CuerpoDeSesionV2;
  // Cada campo con su `Array.isArray` / su comprobación de objeto, y no un
  // `?? []`: lo que se lee aquí es un JSON de la base, y un `body` de una
  // versión futura (o escrito a mano en una implantación) puede traer
  // cualquier forma. Lo que no puede pasar es que abrir una historia
  // reviente — es un registro legal al que el paciente tiene derecho de
  // acceso, y una excepción ahí es una historia inaccesible.
  return {
    tipos: Array.isArray(c.tipos) ? c.tipos.filter(esTipoDeVisita) : [],
    especialidad: esEspecialidad(c.especialidad) ? c.especialidad : null,
    bloques:
      c.bloques != null && typeof c.bloques === "object" ? c.bloques : {},
    pendientesCreados: Array.isArray(c.pendientesCreados)
      ? c.pendientesCreados
      : [],
    pendientesCerrados: Array.isArray(c.pendientesCerrados)
      ? c.pendientesCerrados
      : [],
    avisos: Array.isArray(c.avisos) ? c.avisos : [],
  };
}
