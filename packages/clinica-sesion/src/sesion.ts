// clinica-3 · el cuerpo de una SESIÓN y las funciones puras que lo
// sostienen.
//
// Una sesión es lo que pasa en una visita: qué tiene el pie, qué se le
// hizo, cuánto le duele, cómo va desde la última vez, qué se lleva para
// casa y cuándo vuelve. Se escribe UNA VEZ, al cerrar, y a partir de ahí
// está firmada y no se edita (sólo anotaciones) — como todo lo que vive en
// `clinical_entries`.
//
// ── Por qué la sesión no tiene «guardar a medias» ─────────────────────
//
// Porque no hay un estado intermedio que signifique nada. El mockup
// validado no tiene «Guardar borrador»: se marca con el dedo y se cierra.
// Media sesión guardada —dos tratamientos y sin dolor— no es una sesión
// clínica incompleta, es una pantalla a medio rellenar, y meterla en una
// tabla append-only obligaría a inventar un mecanismo de mutabilidad para
// lo que de verdad es memoria de la pantalla.
//
// Es la misma decisión que clinica-2 tomó con las tres confirmaciones de
// la validación: viven en memoria y viajan con el acto.
//
// ── Lo que vive aquí es PURO ──────────────────────────────────────────
//
// Ni Prisma, ni Fastify, ni React, ni reloj. Y por la misma razón que el
// paquete de clinica-2: el MISMO cálculo lo necesitan los dos lados. La
// API decide si una sesión se puede cerrar y qué se le pasa a caja; la
// pantalla pinta el pie de la sesión con el resumen y el botón
// desactivado. Con una copia por lado, el día que cambie una regla la
// pantalla diría una cosa y el servidor otra — y la que gana es la del
// servidor, así que la podóloga vería un botón activo que falla.

// bloque iva-exento-sanitario · la ÚNICA dependencia de paquete que tiene
// este paquete, y es la del vocabulario fiscal de la casa.
//
// `@mipiacetpv/ticket-model` es igual de puro que éste —ni Prisma, ni
// Fastify, ni React, ni reloj— y es donde viven la conversión neto↔bruto,
// el cuadre del desglose y, desde este bloque, la lista L10 de causas de
// exención con su presentación. El pie de la sesión enseña texto FISCAL
// («Exento · sanitario»), así que lo lee de ahí: la alternativa era una
// segunda redacción de la misma etiqueta, y la lección que ticket-con-iva
// dejó escrita sobre las tres copias del mismo redondeo vale igual para
// las dos copias del mismo rótulo.
import { type CausaExencion, PRESENTACION } from "@mipiacetpv/ticket-model";

import {
  VERSION_DEL_MAPA,
  clavesDelMapa,
  nombreDeZona,
  type Pie,
} from "./mapa.js";
import {
  NOMBRE_DE_GRAVEDAD,
  VERSION_DE_LAS_LESIONES,
  VERSION_DE_LOS_CONSEJOS,
  consejoDe,
  esEvolucion,
  esGravedad,
  esProximaCita,
  lesionDe,
  nombreDeLesion,
  type Evolucion,
  type Gravedad,
  type ProximaCita,
} from "./listas.js";

/** La versión del CUERPO. Distinta de la de las listas a propósito: la
 *  forma del JSON y el vocabulario de las listas cambian por motivos
 *  distintos y en momentos distintos. */
export const VERSION_DEL_CUERPO = 1;

/** Lo que tiene UNA zona del pie. */
export interface MarcaDeZona {
  /** Id de la lista de lesiones. */
  lesion: string;
  /** La gravedad SÓLO existe si hay lesión. Ver `limpiarMarcas`. */
  gravedad: Gravedad | null;
}

/** El mapa marcado: `"L:h"` → qué tiene. */
export type Marcas = Readonly<Record<string, MarcaDeZona>>;

/**
 * El cuerpo de la sesión, tal como entra en `clinical_entries.body`.
 *
 * Las CUATRO versiones viajan dentro. Parece redundante y no lo es: el
 * cuerpo puede cambiar de forma sin que cambien las listas (y al revés),
 * y lo que hay que poder contestar dentro de cinco años es «con qué
 * palabras se marcó esto», no «qué palabras usamos hoy».
 */
export interface CuerpoDeSesion {
  v: number;
  mapaVersion: number;
  lesionesVersion: number;
  consejosVersion: number;
  /** Lo marcado en el pie HOY. Incluye lo que venía de la visita anterior
   *  si se pulsó «Igual que la última vez» — porque entonces pasa a ser
   *  también de hoy, que es lo que ese botón significa. */
  marcas: Marcas;
  /**
   * Los tratamientos de hoy: ids de producto del catálogo (`Product.id`
   * de un `SERVICE` marcado «es un tratamiento de la sesión»).
   *
   * Y el NOMBRE de cada uno, en `tratamientosNombre`. El precio y el IVA
   * **no entran aquí**: salen del catálogo al cobrar (prompt §1). El
   * nombre sí, y la diferencia tiene su razón —
   *
   *   · el PRECIO de hoy es un dato de la venta, y la venta ya lo
   *     congela en `ticket_lines.unit_price` cuando se cobra;
   *   · el NOMBRE es lo que hace legible la historia. Una sesión que diga
   *     «se le hizo el servicio 8f3e…» no es una historia clínica, y el
   *     catálogo se renombra (o se desactiva) sin avisar a nadie.
   *
   * Es exactamente la distinción que el ticket ya hace con
   * `TicketLine.nameSnapshot`.
   */
  tratamientos: readonly string[];
  tratamientosNombre: Readonly<Record<string, string>>;
  /** 0–10, OBLIGATORIO (decisión de producto 6). Lo marca el paciente al
   *  empezar: es su dolor, no la impresión de la podóloga. */
  dolor: number;
  evolucion: Evolucion | null;
  consejos: readonly string[];
  proximaCita: ProximaCita | null;
  /** La única caja de texto de la pantalla, y plegada. `null` si está
   *  vacía: una cadena vacía en una historia clínica es ruido. */
  nota: string | null;
  /** LA FIRMA, en el cuerpo y no sólo en `author_user_id`.
   *
   *  El autor ya está en la fila, pero el nº de colegiado vive en `users`
   *  y **cambia**: se corrige una errata, se renumera un colegio. Lo que
   *  hay que poder enseñar dentro de cinco años es con qué número firmó
   *  ESE día, así que se congela aquí. Igual que `nameSnapshot`. */
  firma: {
    autorNombre: string;
    colegiado: string | null;
    firmadaEn: string;
  };
}

/** La exploración anterior y la sesión anterior, para «la siguiente parte
 *  de la última» y para pintar en naranja suave lo de la visita pasada. */
export interface SesionAnterior {
  entryId: string;
  fecha: string;
  marcas: Marcas;
  tratamientos: readonly string[];
  consejos: readonly string[];
  dolor: number;
}

// ── 1 · La gravedad se elige DESPUÉS de la lesión ─────────────────────

export interface GravedadDisponible {
  puede: boolean;
  /** El motivo, redactado AQUÍ. El mockup pide los botones de gravedad
   *  desactivados «con el motivo» al lado, y dos sitios que lo redacten
   *  acabarían discrepando — la misma lección que `puedeValidarse` de
   *  clinica-2. */
  motivo: string | null;
}

const SIN_LESION = "elige antes la lesión";

/**
 * ¿Se puede tocar la gravedad de esta zona?
 *
 * Sólo si ya tiene lesión. No es un detalle de interfaz: «moderada» sin
 * decir moderada DE QUÉ no significa nada, y una gravedad huérfana en la
 * historia es un dato que el informe PDF no puede escribir en ninguna
 * frase.
 */
export function gravedadDisponible(
  marca: MarcaDeZona | undefined,
): GravedadDisponible {
  if (!marca || !marca.lesion) return { puede: false, motivo: SIN_LESION };
  return { puede: true, motivo: null };
}

/**
 * Deja las marcas como se pueden guardar:
 *
 *   · fuera las zonas que no son de este mapa (una clave inventada no
 *     entra en la historia);
 *   · fuera las lesiones que no son de esta lista;
 *   · **y fuera la gravedad sin lesión**, que es la regla de arriba
 *     aplicada al dato y no al botón.
 *
 * Lo que llega de más se tira EN SILENCIO y no con un 400. La razón es la
 * misma que clinica-2 dio para las respuestas de preguntas que no se
 * hicieron: quien está delante de la pantalla no tiene nada que arreglar,
 * y un error ahí sería un cobro que no sale por una zona fantasma que
 * nadie tocó. Lo que importa es que **no entre en la historia**, y no
 * entra.
 */
export function limpiarMarcas(
  entrada: Readonly<Record<string, Partial<MarcaDeZona> | null | undefined>>,
  versiones: { mapa?: number; lesiones?: number } = {},
): Marcas {
  const mapaVersion = versiones.mapa ?? VERSION_DEL_MAPA;
  const lesionesVersion = versiones.lesiones ?? VERSION_DE_LAS_LESIONES;
  const validas = new Set(clavesDelMapa(mapaVersion));
  const salida: Record<string, MarcaDeZona> = {};
  for (const [clave, marca] of Object.entries(entrada)) {
    if (!validas.has(clave)) continue;
    const lesion = marca?.lesion;
    // La gravedad sin lesión NO se guarda. Ni la marca entera: una zona
    // sin lesión no está marcada.
    if (typeof lesion !== "string" || !lesionDe(lesion, lesionesVersion)) {
      continue;
    }
    const gravedad = marca?.gravedad;
    salida[clave] = {
      lesion,
      gravedad: esGravedad(gravedad) ? gravedad : null,
    };
  }
  return salida;
}

// ── 2 · «Igual que la última vez» SUMA ────────────────────────────────

export interface LoDeHoy {
  marcas: Marcas;
  tratamientos: readonly string[];
  consejos: readonly string[];
}

/**
 * «Igual que la última vez»: lo de la visita anterior SE SUMA a lo que ya
 * esté marcado hoy. **Nunca lo borra.**
 *
 * Es la decisión de producto 4 y el prompt la subraya, así que la función
 * está escrita para que no haya otra lectura posible:
 *
 *   · un tratamiento que ya estaba marcado hoy sigue marcado;
 *   · uno que sólo estaba en la anterior se añade;
 *   · y en el mapa, **lo de hoy gana**: si hoy la podóloga ya ha dicho
 *     que el callo del talón es severo, traer «leve» de la visita
 *     anterior sería deshacerle el trabajo con el botón que existe para
 *     ahorrárselo.
 *
 * El orden del resultado es estable: primero lo de hoy, después lo que la
 * anterior aporta. Así la lista de la pantalla no baila al pulsar el botón
 * dos veces — que es gratis y es idempotente.
 */
export function igualQueLaUltimaVez(
  hoy: LoDeHoy,
  anterior: Pick<SesionAnterior, "marcas" | "tratamientos" | "consejos"> | null,
): LoDeHoy {
  if (!anterior) return hoy;
  return {
    // `{...anterior, ...hoy}` y no al revés: en la colisión manda HOY.
    marcas: { ...anterior.marcas, ...hoy.marcas },
    tratamientos: unir(hoy.tratamientos, anterior.tratamientos),
    consejos: unir(hoy.consejos, anterior.consejos),
  };
}

function unir(
  primero: readonly string[],
  segundo: readonly string[],
): string[] {
  const vistos = new Set<string>();
  const salida: string[] = [];
  for (const x of [...primero, ...segundo]) {
    if (vistos.has(x)) continue;
    vistos.add(x);
    salida.push(x);
  }
  return salida;
}

// ── 3 · El dolor ──────────────────────────────────────────────────────

export const DOLOR_MINIMO = 0;
export const DOLOR_MAXIMO = 10;

export function dolorEsValido(x: unknown): x is number {
  return (
    typeof x === "number" &&
    Number.isInteger(x) &&
    x >= DOLOR_MINIMO &&
    x <= DOLOR_MAXIMO
  );
}

// ── 4 · El resumen del pie de la sesión, SEGÚN ROL ────────────────────

/** Lo que el catálogo dice de un tratamiento. Lo arma la API; aquí entra
 *  ya resuelto para que esta función siga sin saber qué es Prisma. */
export interface TratamientoDelCatalogo {
  serviceId: string;
  nombre: string;
  /** En euros. Un tratamiento «incluido» es uno a 0, y eso lo dice el
   *  catálogo: no hay una marca de «incluido» en ningún sitio. */
  precio: number;
  /** El tipo de IVA del catálogo, en %. **De aquí sale el texto del IVA
   *  de la pantalla**, y no de una constante. */
  iva: number;
  /** bloque iva-exento-sanitario · la causa de exención del catálogo
   *  (lista L10 de la AEAT), o null si la operación es sujeta.
   *
   *  clinica-3 dejó aquí escrito por qué esta pantalla NO podía decir
   *  «exento» todavía: «el IVA exento en Verifactu está fuera de alcance
   *  (`registro.ts` sigue declarando `S1`), así que escribir "exento" en
   *  una pantalla cuyo ticket va a declarar otra cosa sería escribirlo en
   *  el sitio donde más se cree».
   *
   *  Ya no es verdad: `registro.ts` declara `OperacionExenta` y el papel
   *  lleva su leyenda. Así que la pantalla puede decirlo —y TIENE que
   *  decirlo, porque el pie de la sesión de Rosario diría «IVA 0 %» de
   *  una operación exenta, que es exactamente la confusión que este
   *  bloque existe para cerrar. */
  causaExencion?: CausaExencion | null;
}

export interface LineaDelResumen {
  serviceId: string;
  nombre: string;
  /** `null` para quien no ve importes. No es 0: **la clave no está**, así
   *  que no hay nada que un `?? 0` pueda convertir en un precio. */
  precio: number | null;
  iva: number | null;
  /** bloque iva-exento-sanitario · la causa de exención de la línea.
   *
   *  Va con los importes y no al lado: dice CÓMO se tributa lo que se
   *  cobra, así que a quien no ve importes tampoco le llega —misma regla
   *  que `precio` e `iva`, y por el mismo motivo de forma (la clave no
   *  está, no vale 0). */
  causaExencion?: CausaExencion | null;
}

export interface ResumenDeLaSesion {
  tratamientos: number;
  lineas: readonly LineaDelResumen[];
  /** `null` para quien no ve importes. */
  total: number | null;
  /**
   * El texto del IVA, sacado del catálogo. `null` para quien no ve
   * importes.
   *
   * Un solo tipo en todas las líneas → «IVA 0 %». Varios → se dice que
   * depende, porque un total con dos tipos dentro no se puede etiquetar
   * con uno.
   */
  ivaTexto: string | null;
  /** Falta el dolor de hoy: es obligatorio. */
  faltaDolor: boolean;
  /** Falta marcar algún tratamiento. */
  faltaTratamiento: boolean;
  /** El botón de cerrar, activo o no. */
  puedeCerrar: boolean;
  /** Lo que dice el botón. Cambia con el rol: quien no cobra no «cobra». */
  textoDelBoton: string;
}

/**
 * El pie de la sesión del mockup, calculado una vez para la pantalla y
 * para la API.
 *
 * `verImportes` es LA pregunta de la regla 8 (decisión de producto 8,
 * Matías 06-10): dueña, encargado y cajero-sanitario ven importes y pueden
 * «Cobrar ahora»; el **sanitario sin caja no ve importes en ninguna
 * parte**, ni aquí ni al cerrar, y su botón dice «Cerrar sesión».
 *
 * Y se nota en la FORMA del resultado, no en un 0: cuando no ve importes,
 * `total`, `ivaTexto` y los `precio` de las líneas son `null`. La API
 * serializa eso quitando las claves, así que en la respuesta que llega a
 * un `CLINICIAN` no hay ningún número que sea un precio. Un 0 sería un
 * precio que alguien podría pintar.
 */
export function resumenDeLaSesion(input: {
  tratamientos: readonly string[];
  catalogo: readonly TratamientoDelCatalogo[];
  dolor: number | null;
  verImportes: boolean;
}): ResumenDeLaSesion {
  const porId = new Map(input.catalogo.map((t) => [t.serviceId, t]));
  // Sólo los que el catálogo reconoce: un id que ya no es un tratamiento
  // de sesión no es una línea que se pueda cobrar.
  const elegidos = input.tratamientos
    .map((id) => porId.get(id))
    .filter((t): t is TratamientoDelCatalogo => t != null);

  const lineas: LineaDelResumen[] = elegidos.map((t) => ({
    serviceId: t.serviceId,
    nombre: t.nombre,
    precio: input.verImportes ? t.precio : null,
    iva: input.verImportes ? t.iva : null,
    ...(input.verImportes && t.causaExencion
      ? { causaExencion: t.causaExencion }
      : {}),
  }));

  const total = input.verImportes
    ? redondearCentimos(elegidos.reduce((a, t) => a + t.precio, 0))
    : null;

  const faltaDolor = !dolorEsValido(input.dolor);
  const faltaTratamiento = elegidos.length === 0;

  return {
    tratamientos: elegidos.length,
    lineas,
    total,
    ivaTexto: input.verImportes ? textoDelIva(elegidos) : null,
    faltaDolor,
    faltaTratamiento,
    puedeCerrar: !faltaDolor && !faltaTratamiento,
    textoDelBoton: input.verImportes
      ? "Cerrar sesión y cobrar"
      : "Cerrar sesión",
  };
}

/**
 * El texto del IVA del pie de la sesión. Sale del catálogo y no de una
 * constante (ver `TratamientoDelCatalogo`).
 *
 * bloque iva-exento-sanitario · un tramo EXENTO y un 0 % SUJETO valen los
 * dos cero y son dos operaciones distintas, así que la clave del conjunto
 * es el par (tipo, causa) y no el tipo solo — la misma clave que
 * `claveTramo` usa para el desglose. Sin ella, «IVA 0 %» sería el texto de
 * los dos y el pie de la sesión de Rosario diría que su quiropodia lleva
 * un 0 % de IVA cuando lo que lleva es una exención del art. 20.
 *
 * La etiqueta sale de `PRESENTACION` en `@mipiacetpv/ticket-model`, que es
 * de donde la saca el chip del catálogo: dos sitios que redacten
 * «Exento · sanitario» acabarían discrepando, y uno de los dos es la
 * pantalla donde la podóloga comprueba lo que va a cobrar.
 */
export function textoDelIva(
  lineas: readonly { iva: number; causaExencion?: CausaExencion | null }[],
): string | null {
  if (lineas.length === 0) return null;
  const tramos = new Set(
    lineas.map((l) => `${l.iva}|${l.causaExencion ?? ""}`),
  );
  if (tramos.size > 1) return "IVA según cada tratamiento";
  const primera = lineas[0]!;
  if (primera.causaExencion) {
    return PRESENTACION[primera.causaExencion].etiqueta;
  }
  return `IVA ${formatearPorcentaje(primera.iva)} %`;
}

function formatearPorcentaje(n: number): string {
  return Number.isInteger(n) ? String(n) : String(n).replace(".", ",");
}

/** Los céntimos, sin el arrastre del binario. La misma cuenta que hace
 *  `tickets/totals.ts` al construir el ticket de verdad. */
function redondearCentimos(n: number): number {
  return Math.round(n * 100) / 100;
}

// ── 5 · Cómo se lee una sesión escrita ────────────────────────────────

export interface MarcaLegible {
  clave: string;
  /** «Pie izq. · Dedo gordo» */
  zona: string;
  /** «Uña encarnada» */
  lesion: string;
  /** «Moderada», o `null` si no se marcó gravedad. */
  gravedad: string | null;
}

/**
 * Las marcas en palabras, con el vocabulario de la VERSIÓN con la que se
 * escribieron. Es la función que hace que una sesión de hace dos años se
 * lea con las palabras de hace dos años.
 */
export function marcasLegibles(cuerpo: {
  marcas: Marcas;
  mapaVersion: number;
  lesionesVersion: number;
}): MarcaLegible[] {
  return Object.entries(cuerpo.marcas).map(([clave, m]) => ({
    clave,
    zona: nombreDeZona(clave, cuerpo.mapaVersion),
    lesion: nombreDeLesion(m.lesion, cuerpo.lesionesVersion),
    gravedad: m.gravedad ? (NOMBRE_DE_GRAVEDAD[m.gravedad] ?? m.gravedad) : null,
  }));
}

/** Cuántas zonas hay marcadas en cada pie. Lo usa la cabecera de la
 *  pantalla y el resumen del informe. */
export function marcasPorPie(marcas: Marcas): Record<Pie, number> {
  const cuenta: Record<Pie, number> = { L: 0, R: 0 };
  for (const clave of Object.keys(marcas)) {
    const pie = clave.slice(0, clave.indexOf(":"));
    if (pie === "L" || pie === "R") cuenta[pie] += 1;
  }
  return cuenta;
}

/**
 * Valida y normaliza lo que llega de la pantalla para cerrar una sesión.
 *
 * Devuelve el cuerpo listo para escribir o la lista de lo que falta. El
 * schema de Fastify ya rechaza lo que tiene mala FORMA; esto comprueba lo
 * que tiene mal SENTIDO, que es otra cosa y vive aquí para que la
 * pantalla pueda hacer la misma cuenta.
 */
export type SesionNormalizada =
  | { ok: true; cuerpo: Omit<CuerpoDeSesion, "firma"> }
  | { ok: false; motivo: "FALTA_DOLOR" | "SIN_TRATAMIENTOS"; mensaje: string };

export function normalizarSesion(input: {
  marcas: Readonly<Record<string, Partial<MarcaDeZona> | null | undefined>>;
  tratamientos: readonly string[];
  /** Los ids que el catálogo reconoce HOY como tratamientos de sesión. */
  tratamientosDelCatalogo: readonly TratamientoDelCatalogo[];
  dolor: unknown;
  evolucion: unknown;
  consejos: readonly string[];
  proximaCita: unknown;
  nota: unknown;
}): SesionNormalizada {
  const porId = new Map(
    input.tratamientosDelCatalogo.map((t) => [t.serviceId, t]),
  );
  const tratamientos = unir(
    input.tratamientos.filter((id) => porId.has(id)),
    [],
  );
  if (tratamientos.length === 0) {
    return {
      ok: false,
      motivo: "SIN_TRATAMIENTOS",
      mensaje:
        "Marca al menos un tratamiento de hoy antes de cerrar la sesión.",
    };
  }
  if (!dolorEsValido(input.dolor)) {
    return {
      ok: false,
      motivo: "FALTA_DOLOR",
      mensaje: "Falta el dolor de hoy (de 0 a 10). Pregúntaselo al paciente.",
    };
  }
  const nota =
    typeof input.nota === "string" && input.nota.trim().length > 0
      ? input.nota.trim()
      : null;
  return {
    ok: true,
    cuerpo: {
      v: VERSION_DEL_CUERPO,
      mapaVersion: VERSION_DEL_MAPA,
      lesionesVersion: VERSION_DE_LAS_LESIONES,
      consejosVersion: VERSION_DE_LOS_CONSEJOS,
      marcas: limpiarMarcas(input.marcas),
      tratamientos,
      tratamientosNombre: Object.fromEntries(
        tratamientos.map((id) => [id, porId.get(id)!.nombre]),
      ),
      dolor: input.dolor,
      evolucion: esEvolucion(input.evolucion) ? input.evolucion : null,
      consejos: unir(
        input.consejos.filter(
          (id) => consejoDe(id, VERSION_DE_LOS_CONSEJOS) != null,
        ),
        [],
      ),
      proximaCita: esProximaCita(input.proximaCita) ? input.proximaCita : null,
      nota,
    },
  };
}
