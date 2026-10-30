// cogecop-1 · LA TRADUCCIÓN DE COGECOP, EN EL PAQUETE PURO.
//
// Rosario lleva su clínica en COGECOP —el programa que regala el Consejo
// General de Colegios Oficiales de Podólogos: Firebird, sólo Windows— y
// nos ha dado su copia: 3.681 pacientes, 9.569 visitas, 52.003 marcas en
// el mapa del pie. Lo que hace este fichero es contestar las tres
// preguntas que convierten esa copia en historia nuestra:
//
//   1. ¿qué lesión de las nuestras es esta patología de las suyas?
//   2. ¿qué zona del pie es este píxel de su dibujo?
//   3. ¿cómo se lee en la historia una visita que viene de ahí?
//
// ── Por qué AQUÍ y no en el script ───────────────────────────────────
//
// Por la misma razón que el mapa y las listas: el script de importación
// se corre una vez por clínica y se olvida, pero **lo que escribió se
// sigue leyendo para siempre**. `visitaImportadaDeLaHistoria` la lee la
// API cada vez que alguien abre una ficha, y `estadoDeLasZonas` la usa
// para decir de dónde parten los pies. Si la traducción viviera en
// `apps/api/src/scripts/`, leer lo importado dependería de un fichero que
// nadie vuelve a mirar.
//
// Y la segunda razón es que **va a haber una segunda clínica**. COGECOP
// es el programa del Colegio: cada podóloga que venga de ahí trae la
// misma forma. El importador en el panel está fuera de alcance (lo dice
// el prompt), pero la traducción tiene que poder reutilizarse tal cual.
//
// ── Ni Prisma, ni Fastify, ni React, ni reloj ────────────────────────
//
// Como todo este paquete. Lo que necesita la fecha de hoy —el encabezado
// de la nota— la recibe por la puerta.
//
// ── NI UN DATO REAL EN ESTE FICHERO ──────────────────────────────────
//
// Los recuentos de los comentarios son agregados (cuántas marcas hay de
// cada patología, dónde caen los centroides). No hay un solo nombre, ni
// un teléfono, ni un texto clínico de nadie. Los tests usan el generador
// de datos falsos (`apps/api/src/cogecop/generador.ts`).

import {
  LESIONES_V2,
  VERSION_DE_LAS_LESIONES,
  nombreDeLesion,
  type Gravedad,
} from "./listas.js";
import {
  VERSION_DEL_MAPA,
  claveDeZona,
  zonaDe,
  type Pie,
} from "./mapa.js";
import type { Marcas } from "./sesion.js";
import type { VisitaDeLaHistoria, VisitaLegible } from "./historia.js";
import {
  NOMBRE_DE_TIPO_DE_VISITA,
  type TipoDeVisita,
} from "./tipos-de-visita.js";

/** Lo que se lee en la fila de una visita que no se hizo aquí. */
export const ETIQUETA_DE_IMPORTADA = "Importada de COGECOP";

/** Y lo que se lee en la ficha sobre las enfermedades y alergias que
 *  traía: son texto libre que nadie ha repasado con el paciente, y la
 *  valoración inicial de clinica-2 se le hace igual la primera vez que
 *  vuelva. Pero que SE VEAN. */
export const ETIQUETA_SIN_VALIDAR = "De COGECOP · sin validar";

/** El `origen` que marca un cuerpo como importado. Una cadena y no un
 *  booleano: el día que entre un segundo programa, lo que cambia es el
 *  valor y no la forma. */
export const ORIGEN_COGECOP = "cogecop";

// ── 1 · LAS PATOLOGÍAS ────────────────────────────────────────────────
//
// COGECOP tiene un catálogo CERRADO de 144 patologías (el mismo para
// todas las clínicas: es del Colegio). La tabla de abajo dice, para cada
// una, con qué lesión nuestra se corresponde — o `null`.
//
// ── `null` NO ES PERDER EL DATO ──────────────────────────────────────
//
// Cada marca importada guarda SIEMPRE `lesionOriginal` con el nombre de
// COGECOP tal cual. `null` sólo significa «esto no se pinta en el mapa
// con un color nuestro», no «esto se tira». Un carcinoma basocelular no
// es un callo y no hay ninguna de nuestras siete —ni de las doce de la
// V2— que lo diga: fingir que es una «herida» sería escribir en la
// historia de alguien un diagnóstico que nadie hizo.
//
// ── De dónde salen las filas ─────────────────────────────────────────
//
// De la partida que escribió Dirección (prompt §2), aplicada por PREFIJO
// del nombre del catálogo y revisada una a una:
//
//   · `hiperqueratosis*` y las queratodermias (Queratodermia*, QPP*) →
//     `dureza`;
//   · `heloma*` → `callo`;
//   · onicocriptosis → `unero`;
//   · `onicomicosis*` → `onico`;
//   · papilomas, verrugas y la epidermodisplasia verruciforme →
//     `verruga`;
//   · onicogrifosis → `onicogrifosis` (V2);
//   · lo que diga «ulcerativa» → `herida`;
//   · hallux valgus y deformidades → `juanete`.
//
// **Dos de esas ocho líneas no casan con nada, y hay que decirlo**: en el
// catálogo de 144 no existe ninguna «úlcera» (la única que lleva la
// palabra es la «Tinea pedís ulcerativa», que es una tiña que ulcera) ni
// ningún «hallux valgus» ni ninguna «deformidad». COGECOP tiene la
// deformidad en otro sitio de su ficha, no en el mapa. Así que `juanete`
// no lo escribe nadie en una importación, y `herida` sólo lo escribe la
// 128. No es un fallo de la tabla: es lo que hay en el catálogo.
//
// Y tres filas que parecen de `dureza` y NO lo son, por el prefijo:
// «Eczema hiperqueratósico» (87) es un eczema, «Tinea pedís
// hiperqueratósica» (127) es una tiña, y «Mal de Meleda» (72) es una
// queratodermia hereditaria cuyo nombre no lo dice. Las tres van a
// `null` y conservan su nombre. Traducir por lo que el nombre DICE, y no
// por lo que quien escribe la tabla cree saber de dermatología, es lo que
// hace que esta tabla se pueda revisar sin ser podóloga.
//
// ── Las cinco lesiones nuevas de la V2 ───────────────────────────────
//
// `onicogrifosis`, `hematoma`, `xerosis`, `onicolisis` y `distrofica`
// existen en `LESIONES_V2` por esta tabla: son 7.686 de las 52.003
// marcas de la copia de Rosario. Sin ellas, la segunda lesión más
// marcada de su clínica entraría como «sin traducir».

/**
 * Las 144 del catálogo de COGECOP, por su id, con el nombre tal cual lo
 * escribe el programa y la lesión nuestra que le toca.
 *
 * El nombre está aquí a propósito y no sólo el id: esta tabla hay que
 * poder revisarla sin abrir el export de nadie, y un `4: "dureza"` suelto
 * no se puede revisar. Es catálogo del Colegio, no dato de paciente.
 *
 * Las faltas de ortografía son suyas y se copian tal cual
 * («Onicigrifosis», «Tinea pedís», «Bullosis diabeticurom»): lo que esta
 * columna tiene que hacer es casar con lo que el fichero trae, no
 * corregirlo.
 */
export interface PatologiaDeCogecop {
  /** El nombre en el catálogo de COGECOP, tal cual. */
  nombre: string;
  /** La id de `LESIONES_V2`, o `null` si ninguna lo dice. */
  lesion: string | null;
}

export const PATOLOGIAS_COGECOP: Readonly<
  Record<number, PatologiaDeCogecop>
> = {
  1: { nombre: "Hiperqueratosis", lesion: "dureza" },
  2: { nombre: "Hiperqueratosis difusa", lesion: "dureza" },
  3: { nombre: "Hiperqueratosis congénita", lesion: "dureza" },
  4: { nombre: "I.P.K.", lesion: "dureza" },
  5: { nombre: "Heloma", lesion: "callo" },
  6: { nombre: "Heloma duro", lesion: "callo" },
  7: { nombre: "Heloma vascular", lesion: "callo" },
  8: { nombre: "Heloma neurofibroso", lesion: "callo" },
  9: { nombre: "Heloma de Molle", lesion: "callo" },
  10: { nombre: "Heloma periungueal", lesion: "callo" },
  11: { nombre: "Heloma en fondo de saco", lesion: "callo" },
  12: { nombre: "Heloma miliar", lesion: "callo" },
  13: { nombre: "Cuerno cutáneo", lesion: null },
  14: { nombre: "Poroqueratoma", lesion: null },
  15: { nombre: "Higroma", lesion: null },
  16: { nombre: "Tiloma", lesion: "dureza" },
  17: { nombre: "Quiste de inclusión", lesion: null },
  18: { nombre: "Ganglión", lesion: null },
  19: { nombre: "Quiste sinovial", lesion: null },
  20: { nombre: "Herniación grasa", lesion: null },
  21: { nombre: "Tumores de Koenen", lesion: null },
  22: { nombre: "Botriomicoma-Granuloma piogeno", lesion: null },
  23: { nombre: "Quiste mixoide", lesion: null },
  24: { nombre: "Tumor glómico", lesion: null },
  25: { nombre: "Angiofibroma periungueal", lesion: null },
  26: { nombre: "Granuloma", lesion: null },
  27: { nombre: "Nevus intradérmico", lesion: null },
  28: { nombre: "Nevus seborreico", lesion: null },
  29: { nombre: "Hemangioma", lesion: null },
  30: { nombre: "Nevus melanocítico", lesion: null },
  31: { nombre: "Dermatofibroma", lesion: null },
  32: { nombre: "Queratosis seborreica", lesion: null },
  33: { nombre: "Tumor de células gigantes", lesion: null },
  34: { nombre: "Lipoma", lesion: null },
  35: { nombre: "Quiste epidermoide", lesion: null },
  36: { nombre: "Angioqueratoma", lesion: null },
  37: { nombre: "Queratocantoma subungueal", lesion: null },
  38: { nombre: "Queratosis escamosa benigna", lesion: null },
  39: { nombre: "Enfermedad de Bowen", lesion: null },
  40: { nombre: "Poroma ecrino", lesion: null },
  41: { nombre: "Carcinoma verrucoso", lesion: null },
  42: { nombre: "Fibroepitelioma de Pinkus", lesion: null },
  43: { nombre: "Carcinoma de células escamosas", lesion: null },
  44: { nombre: "Carcinoma basocelular", lesion: null },
  45: { nombre: "Carcinoma epidermoide", lesion: null },
  46: { nombre: "Sarcoma de Kaposi", lesion: null },
  47: { nombre: "Melanoma", lesion: null },
  48: { nombre: "Melanoma subungueal", lesion: null },
  49: { nombre: "Melanoma amelanótico", lesion: null },
  50: { nombre: "Melanoma lentiginoso acral", lesion: null },
  51: { nombre: "Queratodermia", lesion: "dureza" },
  52: { nombre: "QPP-Difusa", lesion: "dureza" },
  53: { nombre: "QPP-Puntiforme", lesion: "dureza" },
  54: { nombre: "QPP-Focalizada", lesion: "dureza" },
  55: { nombre: "Queratodermia climatérica", lesion: "dureza" },
  56: { nombre: "Queratodermia psoriásica", lesion: "dureza" },
  57: { nombre: "QPP en liquen plano", lesion: "dureza" },
  58: { nombre: "QPP por arsénico", lesion: "dureza" },
  59: { nombre: "QPP de origen infeccioso: sífilis", lesion: "dureza" },
  60: { nombre: "QPP en pitiriasis rubra: pilaris", lesion: "dureza" },
  61: { nombre: "Queratodermia epidermolitica", lesion: "dureza" },
  62: { nombre: "Queratodermia hereditaria punctata", lesion: "dureza" },
  63: {
    nombre: "QPP difusa paraneoplásica (ca. pulmonar)",
    lesion: "dureza",
  },
  64: { nombre: "QPP tipo Vörner y QPP tipo Unna-Thost", lesion: "dureza" },
  65: { nombre: "QPP mutilante (SD. Vöhwinkel)", lesion: "dureza" },
  66: { nombre: "QPP epidermolítica focal (numular)", lesion: "dureza" },
  67: { nombre: "QPP climatérica (Haxthausen)", lesion: "dureza" },
  68: {
    nombre: "QPP de origen infeccioso: Dermatofitosis",
    lesion: "dureza",
  },
  69: { nombre: "Sarna o escabiosis", lesion: null },
  70: { nombre: "QPP con periodontitis (SD. papillon-lefèvre)", lesion: "dureza" },
  71: { nombre: "Liquen simple crónico", lesion: null },
  // Es una queratodermia palmoplantar hereditaria, y su nombre no lo
  // dice. Se queda en `null` por la regla de la cabecera: la tabla
  // traduce lo que el catálogo ESCRIBE.
  72: { nombre: "Mal de Meleda", lesion: null },
  73: {
    nombre: "Queratodermia por dermatofitos tinea pedis",
    lesion: "dureza",
  },
  74: { nombre: "Dermatitis", lesion: null },
  75: { nombre: "Dermatitis de contacto", lesion: null },
  76: { nombre: "Dermatitis atópica", lesion: null },
  77: { nombre: "Dermatitis plantar juvenil", lesion: null },
  78: { nombre: "Dermatitis por dimetil fumarato", lesion: null },
  79: { nombre: "Xerosis", lesion: "xerosis" },
  80: { nombre: "Liquen plano", lesion: null },
  81: { nombre: "Liquen simple crónico", lesion: null },
  82: { nombre: "Eczema", lesion: null },
  83: { nombre: "Eczema dishidrótico", lesion: null },
  84: { nombre: "Eczema fisurado", lesion: null },
  85: { nombre: "Eczema numular", lesion: null },
  86: { nombre: "Eczema de estasis", lesion: null },
  // Un eczema, no una hiperqueratosis. El prefijo manda.
  87: { nombre: "Eczema hiperqueratósico", lesion: null },
  88: { nombre: "Eczema fototóxico", lesion: null },
  89: { nombre: "Eczema fotoalérgico", lesion: null },
  90: { nombre: "Eczema irritativo de contacto", lesion: null },
  91: { nombre: "Ponfolix", lesion: null },
  92: { nombre: "Papilomas", lesion: "verruga" },
  93: { nombre: "Verrugas periungueales", lesion: "verruga" },
  94: { nombre: "Verrugas subungueales", lesion: "verruga" },
  95: { nombre: "Verrugas en mosaico", lesion: "verruga" },
  96: { nombre: "Molluscum contagiosum", lesion: null },
  97: { nombre: "Epidermodisplasia verruciforme", lesion: "verruga" },
  98: { nombre: "Herpes", lesion: null },
  99: { nombre: "Verruga mirmecia", lesion: "verruga" },
  100: { nombre: "Psoriasis", lesion: null },
  101: { nombre: "Psoriasis pustulosa", lesion: null },
  102: { nombre: "Acropustulosis psoriásica", lesion: null },
  103: { nombre: "Onicomicosis", lesion: "onico" },
  104: {
    nombre: "Onicomicosis subungueal distal y lateral (OMSDL)",
    lesion: "onico",
  },
  105: {
    nombre: "Onicomicosis subungueal proximal (OMSP)",
    lesion: "onico",
  },
  106: {
    nombre: "Onicomicosis blanca superficial (OMBS)",
    lesion: "onico",
  },
  107: { nombre: "Onicomicosis distrófica total (OMDT)", lesion: "onico" },
  108: { nombre: "Onicomicosis candidiásica (OMC)", lesion: "onico" },
  109: { nombre: "Uña psoriásica", lesion: null },
  110: { nombre: "Uña distrófica", lesion: "distrofica" },
  111: { nombre: "Artropatia psoriásica", lesion: null },
  112: { nombre: "Leuconiquia", lesion: null },
  // La errata es de COGECOP («Onicigrifosis»). Se copia tal cual: lo que
  // esta columna tiene que hacer es casar con lo que el fichero trae.
  113: { nombre: "Onicigrifosis", lesion: "onicogrifosis" },
  114: { nombre: "Onicolisis", lesion: "onicolisis" },
  115: { nombre: "Onicocriptosis", lesion: "unero" },
  116: { nombre: "Paroniquia", lesion: null },
  117: { nombre: "Hematoma subungueal", lesion: "hematoma" },
  118: { nombre: "Infecciones bacterianas", lesion: null },
  119: { nombre: "Melanoniquia", lesion: null },
  120: { nombre: "Exostosis subungueal", lesion: null },
  121: { nombre: "Encondroma", lesion: null },
  122: { nombre: "Liquen plano uñas", lesion: null },
  123: { nombre: "Dermatomicosis", lesion: null },
  124: { nombre: "Tinea pedís interdigital", lesion: null },
  125: { nombre: "Tinea pedís interdigital seca", lesion: null },
  126: { nombre: "Tinea pedís vesículo ampollosa", lesion: null },
  // Una tiña, no una hiperqueratosis. El prefijo manda.
  127: { nombre: "Tinea pedís hiperqueratósica", lesion: null },
  // La ÚNICA de las 144 que lleva la palabra «ulcer». Es la línea «las
  // úlceras → herida» de la partida, y es la única que casa.
  128: { nombre: "Tinea pedís ulcerativa", lesion: "herida" },
  129: { nombre: "Eritrasma", lesion: null },
  130: { nombre: "Intertrigo hiperhidrosis", lesion: null },
  131: { nombre: "Queratolisis punctata", lesion: null },
  132: { nombre: "Forúnculo", lesion: null },
  133: { nombre: "Periostitis", lesion: null },
  134: { nombre: "Erisipela", lesion: null },
  135: { nombre: "Celulitis", lesion: null },
  136: { nombre: "Impétigo", lesion: null },
  137: { nombre: "Osteomielitis", lesion: null },
  138: { nombre: "Raynaud", lesion: null },
  139: { nombre: "Vasculitis", lesion: null },
  140: { nombre: "Perniosis", lesion: null },
  141: { nombre: "Lupus eritematoso", lesion: null },
  142: { nombre: "Deficit arterial", lesion: null },
  143: { nombre: "Necrobiosis lipoidica diabética", lesion: null },
  144: { nombre: "Bullosis diabeticurom", lesion: null },
};

/** Cuántas filas tiene que tener la tabla. El catálogo de COGECOP es
 *  cerrado y son 144: un test lo ata, porque una fila que se caiga al
 *  editar deja una patología traduciéndose a `null` sin que nadie lo
 *  note. */
export const PATOLOGIAS_DE_COGECOP = 144;

/** La lesión de una patología de COGECOP, o `null`. También `null` para
 *  una id que no está en el catálogo: una copia con una patología que no
 *  existe entra igual, con su nombre, y no revienta la importación. */
export function lesionDePatologia(id: number): string | null {
  return PATOLOGIAS_COGECOP[id]?.lesion ?? null;
}

/** El nombre de COGECOP de una patología. `null` si no está en el
 *  catálogo — y entonces quien importa escribe lo que el fichero traiga.
 */
export function nombreDePatologia(id: number): string | null {
  return PATOLOGIAS_COGECOP[id]?.nombre ?? null;
}

// ── 2 · EL MAPA: DE PÍXEL A ZONA ──────────────────────────────────────
//
// Cada marca de COGECOP es un icono de 16×16 px colocado sobre uno de
// tres dibujos, y lo que guarda la base de datos es la esquina superior
// izquierda (`x_1`, `y_1`) y la inferior derecha (`x_2`, `y_2`). Las
// 52.003 marcas de la copia miden 16×16 sin una sola excepción, así que
// el centro del icono es `x_1 + 8`, `y_1 + 8`.
//
//   · **Dibujo 0** (~320×170) · las diez UÑAS vistas desde arriba, cinco
//     grupos por mitad. 17.599 marcas.
//   · **Dibujo 2** (~330×290) · las dos PLANTAS enteras: dedos arriba,
//     antepié, zona media y talón. 34.392 marcas.
//   · **Dibujo 3** · 12 marcas en toda la copia, sin estructura que
//     agrupar. Se quedan sin pie y sin zona, con su nombre.
//
// ── Los centroides están SACADOS DE LOS DATOS ────────────────────────
//
// No se adivinaron mirando el dibujo (que no tenemos: los iconos y las
// imágenes son del programa, no de Rosario). Se sacaron agrupando las
// 52.003 marcas por dibujo y por mitad con k-medias, y el resultado se
// congeló aquí. Dos cosas dieron la confianza de que los grupos son los
// dedos y no una casualidad del algoritmo:
//
//   1. **Las dos mitades son espejo.** El eje sale en x ≈ 183 en los dos
//      dibujos, y cada centroide de una mitad tiene el suyo enfrente a
//      menos de 3 px.
//   2. **El dedo gordo es el de dentro en los dos dibujos.** En el 0 es
//      el grupo con más marcas (4.043 y 3.830 de 17.599) y el de arriba;
//      en el 2 es el de más marcas de la banda de los dedos. Que los dos
//      dibujos coincidan en eso es lo que dice que los dos usan la misma
//      disposición.
//
// En el dibujo 2 los dedos pequeños casi no se marcan (476 marcas de
// 34.392) y sólo salen dos grupos por mitad. Los otros tres centroides
// se colocaron escalando el patrón del dibujo 0 alrededor del dedo gordo
// con el factor que esos dos grupos imponen (0,57 en las cuatro medidas
// independientes: 0,538 / 0,560 / 0,572 / 0,596). Están en la tabla para
// que una marca en el 3.er dedo tenga dónde caer, no porque los datos la
// hayan visto: en la copia de Rosario ese centroide gana **una** marca.
//
// ── Y LO QUE NO SE PUEDE SACAR DE LOS DATOS ──────────────────────────
//
// **Qué mitad es el pie izquierdo.** Los dos dibujos ponen los dedos
// gordos mirándose, que es lo anatómico tanto si la vista es dorsal (de
// arriba) como plantar (de la suela) — y la vista es justo lo que decide
// si la mitad de la izquierda de la imagen es el pie izquierdo del
// paciente o el derecho. Ningún recuento lo contesta: se sabe mirando la
// pantalla de quiropodia del programa.
//
// Por eso no hay valor por defecto. `LATERALIDAD_COGECOP` entra por la
// puerta, el script la exige confirmada (`--lateralidad=…`) y se niega a
// correr sin ella. Un defecto «razonable» aquí sería meterle a 3.681
// personas la historia del pie cambiado, y nadie lo vería: el mapa se
// pintaría perfecto, en el pie que no es.

/** Lo que mide el lado del icono de una marca, en píxeles del dibujo. */
export const LADO_DEL_ICONO = 16;

/** Las dos mitades de un dibujo. `A` es la de la izquierda de la imagen
 *  (x pequeña) y `B` la de la derecha. Nombres neutros a propósito: qué
 *  PIE es cada una lo dice `LATERALIDAD_COGECOP`, y llamarlas `L`/`R`
 *  aquí sería dar por contestada la pregunta que no tiene respuesta en
 *  los datos. */
export type MitadDelDibujo = "A" | "B";

export const LATERALIDADES_DE_COGECOP = [
  "izquierdo-a-la-izquierda",
  "izquierdo-a-la-derecha",
] as const;

export type LateralidadDeCogecop = (typeof LATERALIDADES_DE_COGECOP)[number];

export function esLateralidadDeCogecop(
  x: unknown,
): x is LateralidadDeCogecop {
  return (
    typeof x === "string" &&
    (LATERALIDADES_DE_COGECOP as readonly string[]).includes(x)
  );
}

/** Qué pie es cada mitad, según la lateralidad confirmada. */
export function pieDeLaMitad(
  mitad: MitadDelDibujo,
  lateralidad: LateralidadDeCogecop,
): Pie {
  if (lateralidad === "izquierdo-a-la-izquierda") {
    return mitad === "A" ? "L" : "R";
  }
  return mitad === "A" ? "R" : "L";
}

export interface CentroideDeCogecop {
  /** `idimagencolocada` de COGECOP. */
  dibujo: number;
  mitad: MitadDelDibujo;
  /** Id de zona de `MAPA_PIE_V1`. */
  zona: string;
  /** El centro del grupo, en píxeles del dibujo. */
  x: number;
  y: number;
}

/**
 * A cuántos píxeles de un centroide deja de estar una marca EN esa zona.
 *
 * 32 px, que es dos iconos. Con 24 se quedarían sin zona 1.098 marcas de
 * la copia (2,11 %) y con 50 sólo 91 (0,18 %) — pero 50 px en un dibujo
 * de 330 de ancho se come la mitad del pie y convierte «cerca de nada» en
 * «del talón». Con 32 se quedan fuera 294 (0,57 %), que es la cola de
 * marcas sueltas entre dos zonas.
 *
 * Esas 294 **no se pierden**: entran con su nombre, su dibujo y su
 * lesión, y sin zona. Lo que no hacen es pintarse en un sitio del pie que
 * nadie marcó.
 */
export const RADIO_DE_LA_MARCA = 32;

/**
 * Los centroides, congelados.
 *
 * Son dato en CÓDIGO y no una tabla por la misma razón que `MAPA_PIE_V1`:
 * una tabla sin pantalla que la edite no es más flexible que una
 * constante, es la misma rigidez con una migración de por medio y sin
 * revisión de código.
 */
export const CENTROIDES_COGECOP: readonly CentroideDeCogecop[] = [
  // ── Dibujo 0 · las diez uñas desde arriba ──────────────────────────
  // El dedo gordo es el de dentro (x grande en la mitad A, x pequeña en
  // la B) y el que más marcas se lleva. Entre paréntesis, cuántas marcas
  // de la copia de Rosario cayeron en cada uno.
  { dibujo: 0, mitad: "A", zona: "d5", x: 44, y: 66 }, // 1.977
  { dibujo: 0, mitad: "A", zona: "d4", x: 63, y: 43 }, //   789
  { dibujo: 0, mitad: "A", zona: "d3", x: 85, y: 25 }, //   710
  { dibujo: 0, mitad: "A", zona: "d2", x: 108, y: 16 }, //   962
  { dibujo: 0, mitad: "A", zona: "h", x: 136, y: 22 }, // 4.043
  { dibujo: 0, mitad: "B", zona: "h", x: 220, y: 28 }, // 3.830
  { dibujo: 0, mitad: "B", zona: "d2", x: 248, y: 30 }, // 1.259
  { dibujo: 0, mitad: "B", zona: "d3", x: 275, y: 37 }, //   794
  { dibujo: 0, mitad: "B", zona: "d4", x: 295, y: 53 }, //   890
  { dibujo: 0, mitad: "B", zona: "d5", x: 308, y: 82 }, // 2.245

  // ── Dibujo 2 · las dos plantas ─────────────────────────────────────
  // Los dedos (y < 65), el antepié (65–140), la zona media (140–225) y
  // el talón (> 225). Los tres metatarsianos salen en el orden que tiene
  // un pie: el primero es el más distal (y pequeña) y el quinto el más
  // proximal, y eso es lo que dice que los grupos son lo que parecen.
  { dibujo: 2, mitad: "A", zona: "h", x: 111, y: 35 }, // 2.069
  { dibujo: 2, mitad: "A", zona: "d2", x: 95, y: 34 }, //    62
  { dibujo: 2, mitad: "A", zona: "d3", x: 82, y: 33 }, //     1 (modelado)
  { dibujo: 2, mitad: "A", zona: "d4", x: 69, y: 33 }, //    73
  { dibujo: 2, mitad: "A", zona: "d5", x: 56, y: 53 }, //   337
  { dibujo: 2, mitad: "A", zona: "m1", x: 119, y: 79 }, // 1.856
  { dibujo: 2, mitad: "A", zona: "m2", x: 83, y: 88 }, // 6.239
  { dibujo: 2, mitad: "A", zona: "m35", x: 64, y: 116 }, // 3.608
  { dibujo: 2, mitad: "A", zona: "arco", x: 140, y: 183 }, //  74
  { dibujo: 2, mitad: "A", zona: "lat", x: 79, y: 165 }, //   133
  { dibujo: 2, mitad: "A", zona: "talon", x: 147, y: 253 }, // 2.723
  { dibujo: 2, mitad: "B", zona: "h", x: 259, y: 38 }, // 1.993
  { dibujo: 2, mitad: "B", zona: "d2", x: 275, y: 38 }, //    73
  { dibujo: 2, mitad: "B", zona: "d3", x: 290, y: 37 }, //     0 (modelado)
  { dibujo: 2, mitad: "B", zona: "d4", x: 300, y: 37 }, //    74
  { dibujo: 2, mitad: "B", zona: "d5", x: 309, y: 57 }, //   234
  { dibujo: 2, mitad: "B", zona: "m1", x: 249, y: 77 }, // 1.982
  { dibujo: 2, mitad: "B", zona: "m2", x: 283, y: 90 }, // 6.528
  { dibujo: 2, mitad: "B", zona: "m35", x: 303, y: 115 }, // 3.341
  { dibujo: 2, mitad: "B", zona: "arco", x: 222, y: 192 }, //  44
  { dibujo: 2, mitad: "B", zona: "lat", x: 286, y: 165 }, //   85
  { dibujo: 2, mitad: "B", zona: "talon", x: 217, y: 255 }, // 2.669
];

/** Los dibujos que esta tabla sabe traducir. El 3 no está: sus 12 marcas
 *  de toda la copia entran sin pie y sin zona. */
export const DIBUJOS_CON_ZONA: readonly number[] = [0, 2];

/** El sitio de una marca, ya traducido. Los dos a la vez o ninguno: una
 *  zona sin pie no se puede pintar, y un pie sin zona no dice dónde. */
export interface SitioDeLaMarca {
  pie: Pie | null;
  zona: string | null;
}

const SIN_SITIO: SitioDeLaMarca = { pie: null, zona: null };

/**
 * En qué pie y en qué zona de `MAPA_PIE_V1` cae una marca de COGECOP.
 *
 * `x1`/`y1` son la ESQUINA del icono, tal como vienen en el export; el
 * centro se calcula aquí para que ningún llamante tenga que acordarse de
 * sumarle los ocho píxeles.
 *
 * Fuera del radio, o en un dibujo sin tabla, `{pie: null, zona: null}`.
 */
export function sitioDeLaMarca(input: {
  dibujo: number;
  x1: number;
  y1: number;
  lateralidad: LateralidadDeCogecop;
  /** Para probar el borde sin recompilar la constante. */
  radio?: number;
}): SitioDeLaMarca {
  const radio = input.radio ?? RADIO_DE_LA_MARCA;
  const cx = input.x1 + LADO_DEL_ICONO / 2;
  const cy = input.y1 + LADO_DEL_ICONO / 2;

  let mejor: CentroideDeCogecop | null = null;
  let mejorD2 = Infinity;
  for (const c of CENTROIDES_COGECOP) {
    if (c.dibujo !== input.dibujo) continue;
    const d2 = (cx - c.x) ** 2 + (cy - c.y) ** 2;
    if (d2 < mejorD2) {
      mejorD2 = d2;
      mejor = c;
    }
  }
  if (mejor == null || mejorD2 > radio * radio) return SIN_SITIO;
  return {
    pie: pieDeLaMitad(mejor.mitad, input.lateralidad),
    zona: mejor.zona,
  };
}

// ── 3 · LA VISITA IMPORTADA ───────────────────────────────────────────
//
// Lo importado es **historia, no sesión** (decisión de Dirección): no se
// edita, no genera cobros, no cuenta como sesión cerrada para caja ni
// para bonos, y se ve con su etiqueta en su fecha real. Por eso su cuerpo
// tiene forma propia y no finge ser un `CuerpoDeSesionV2`: un cuerpo que
// pareciera una sesión acabaría cobrándose el día que alguien añadiera
// una consulta sin filtrar por `kind`.
//
// Lo que SÍ comparte es la salida: `visitaImportadaLegible` devuelve una
// `VisitaLegible` y `visitaImportadaDeLaHistoria` una
// `VisitaDeLaHistoria`, que son las dos formas que la historia viva ya
// sabe leer. Así `estadoDeLasZonas` las trata como lo que son —visitas
// que miraron el pie— sin un solo `if` nuevo dentro.

/** Las cuatro clases de visita que COGECOP distingue. Minúsculas y no el
 *  `TipoDeVisita` de la casa: es lo que trae SU fichero, y traducirlo al
 *  guardar habría dejado el cuerpo mintiendo sobre de dónde salió. */
export const TIPOS_IMPORTADOS = [
  "quiropodia",
  "cirugia",
  "biomecanica",
  "general",
] as const;

export type TipoImportado = (typeof TIPOS_IMPORTADOS)[number];

export function esTipoImportado(x: unknown): x is TipoImportado {
  return (
    typeof x === "string" && (TIPOS_IMPORTADOS as readonly string[]).includes(x)
  );
}

/** Con qué tipo de los nuestros se lee cada uno. COGECOP no tiene «pie de
 *  riesgo» como clase de visita: lo suyo es una pestaña de la ficha, no
 *  una visita. */
export const TIPO_DE_VISITA_IMPORTADO: Record<TipoImportado, TipoDeVisita> = {
  quiropodia: "QUIROPODIA",
  cirugia: "CIRUGIA",
  biomecanica: "BIOMECANICA",
  general: "GENERAL",
};

/** Una marca del mapa de COGECOP, ya traducida y guardada. */
export interface MarcaImportada {
  /** `idimagencolocada`: sobre qué dibujo se puso. Se guarda porque es lo
   *  único que permite volver a traducirla el día que la tabla de
   *  centroides mejore. */
  dibujo: number;
  pie: Pie | null;
  /** Id de zona de `MAPA_PIE_V1`, o `null`. */
  zona: string | null;
  /** Id de `LESIONES_V2`, o `null` si ninguna de las doce lo dice. */
  lesion: string | null;
  /** **SIEMPRE.** El nombre de COGECOP, traducido o no. Es lo que hace
   *  que `null` no sea perder el dato. */
  lesionOriginal: string;
  /** Lo que COGECOP marcaba como «curado». `null` en 51.662 de las
   *  52.003: la columna casi no se usó, y `null` es «no lo dijo», que no
   *  es «no». */
  curado: boolean | null;
}

/**
 * El cuerpo de una visita importada, tal como entra cifrado en
 * `clinical_entries.body` con `kind = IMPORTED_VISIT`.
 *
 * Las dos versiones viajan dentro por lo mismo que en una sesión: lo
 * marcado se lee con el vocabulario con el que se escribió. Una
 * importación hecha hoy traduce con `MAPA_PIE_V1` y `LESIONES_V2`, y
 * dentro de dos años se seguirá leyendo así aunque la V3 renombre media
 * lista.
 */
export interface CuerpoImportado {
  origen: typeof ORIGEN_COGECOP;
  /** El id de la visita en COGECOP. Es la mitad de la idempotencia: con
   *  él, correr el script dos veces reconoce lo que ya entró. */
  cogecopId: number;
  tipo: TipoImportado;
  motivo: string | null;
  evolucion: string | null;
  diagnostico: string | null;
  recomendacion: string | null;
  /** COGECOP tenía una casilla «alerta» por visita. Entra como booleano:
   *  lo que decía no está en ninguna parte de su base. */
  alerta: boolean;
  /** Los nombres de los tratamientos de su catálogo, congelados — igual
   *  que `tratamientosNombre` en una sesión nuestra, y por lo mismo. */
  tratamientos: readonly string[];
  marcas: readonly MarcaImportada[];
  mapaVersion: number;
  lesionesVersion: number;
}

/** ¿Este cuerpo es una visita importada? Lo preguntan la API y la
 *  pantalla antes de leerlo como una sesión. */
export function esCuerpoImportado(x: unknown): x is CuerpoImportado {
  return (
    typeof x === "object" &&
    x !== null &&
    (x as { origen?: unknown }).origen === ORIGEN_COGECOP
  );
}

/** Las versiones con las que se traduce HOY. Las escribe el importador y
 *  las lee el test que ata el cuerpo a las listas. */
export function versionesDeLaImportacion(): {
  mapaVersion: number;
  lesionesVersion: number;
} {
  return {
    mapaVersion: VERSION_DEL_MAPA,
    lesionesVersion: VERSION_DE_LAS_LESIONES,
  };
}

/**
 * Lo marcado en el pie, en la forma que la historia viva ya sabe leer.
 *
 * De la lista de marcas al diccionario `"L:h" → {lesion, gravedad}`. Tres
 * cosas que esta función decide, y las tres se ven desde fuera:
 *
 *   · **sin zona o sin lesión, fuera del diccionario.** Una marca sin
 *     zona no se puede pintar en ningún sitio del mapa y una sin lesión
 *     no tiene color. Siguen en el cuerpo con su nombre: lo que no hacen
 *     es inventarse un punto.
 *   · **dos marcas en la misma zona: manda la PRIMERA.** El diccionario
 *     no admite dos, y COGECOP sí (una uña con micosis y onicogrifosis a
 *     la vez). La primera es la del orden del fichero, que es el de
 *     inserción. La segunda sigue en `marcas` del cuerpo, que es donde la
 *     pantalla de la visita la enseña.
 *   · **`gravedad: null` siempre.** COGECOP no la pedía. Fingirla sería
 *     inventarse una escala que nadie midió, y `estadoDeLasZonas` ya sabe
 *     qué hacer con el hueco: sin gravedad no dice «mejorando».
 */
export function marcasDeLoImportado(cuerpo: CuerpoImportado): Marcas {
  const marcas: Record<string, { lesion: string; gravedad: Gravedad | null }> =
    {};
  for (const m of cuerpo.marcas) {
    if (m.pie == null || m.zona == null || m.lesion == null) continue;
    if (zonaDe(m.zona, cuerpo.mapaVersion) == null) continue;
    const clave = claveDeZona(m.pie, m.zona);
    if (clave in marcas) continue;
    marcas[clave] = { lesion: m.lesion, gravedad: null };
  }
  return marcas;
}

/**
 * Una visita importada, como fila de la lista de visitas.
 *
 * El título es el tipo («Quiropodia», «Cirugía · revisión») y la etiqueta
 * `importada` es lo que hace que la pantalla pinte «Importada de
 * COGECOP» al lado de la fecha. No va en el título: el título dice qué
 * visita fue, y de dónde salió es otra cosa.
 *
 * Los chips son los tratamientos de SU catálogo, congelados, más las
 * lesiones que no se tradujeron — que es justo lo que la podóloga
 * necesita leer para saber qué le hizo, porque el mapa no las pinta.
 */
export function visitaImportadaLegible(
  cuerpo: CuerpoImportado,
  meta: { entryId: string; fecha: string },
): VisitaLegible {
  const tipo = TIPO_DE_VISITA_IMPORTADO[cuerpo.tipo];
  const nombre = NOMBRE_DE_TIPO_DE_VISITA[tipo];
  const chips: string[] = [...cuerpo.tratamientos];
  const vistos = new Set(chips.map((c) => c.toLowerCase()));
  for (const m of cuerpo.marcas) {
    if (m.lesion != null) continue;
    const k = m.lesionOriginal.toLowerCase();
    if (vistos.has(k)) continue;
    vistos.add(k);
    chips.push(m.lesionOriginal);
  }
  return {
    entryId: meta.entryId,
    fecha: meta.fecha,
    tipos: [tipo],
    tiposNombre: [nombre],
    titulo: nombre,
    nivel: null,
    nivelNombre: null,
    dolor: null,
    evolucion: null,
    evolucionNombre: null,
    chips,
    importada: true,
  };
}

/**
 * Y la misma visita para el pie vivo.
 *
 * `v: 2` y con su tipo, que es lo que hace que `exploroElPie` acierte:
 * una quiropodia importada SÍ miró el pie (y por eso puede curar una
 * zona), y una consulta general importada no.
 */
export function visitaImportadaDeLaHistoria(
  cuerpo: CuerpoImportado,
  meta: { entryId: string; fecha: string },
): VisitaDeLaHistoria {
  return {
    entryId: meta.entryId,
    fecha: meta.fecha,
    v: 2,
    tipos: [TIPO_DE_VISITA_IMPORTADO[cuerpo.tipo]],
    marcas: marcasDeLoImportado(cuerpo),
    mapaVersion: cuerpo.mapaVersion,
    lesionesVersion: cuerpo.lesionesVersion,
    importada: true,
  };
}

/** Cómo se lee una lesión de una marca importada: la nuestra si se
 *  tradujo, y si no el nombre de COGECOP tal cual. Es la función que hace
 *  que una patología sin traducir siga diciendo algo en pantalla. */
export function nombreDeLaMarcaImportada(
  m: MarcaImportada,
  lesionesVersion: number = VERSION_DE_LAS_LESIONES,
): string {
  if (m.lesion == null) return m.lesionOriginal;
  return nombreDeLesion(m.lesion, lesionesVersion);
}

// ── 4 · LA NOTA DE LA FICHA ───────────────────────────────────────────
//
// Decisión de Dirección: **sin pérdida.** Lo que tiene sitio propio en
// `Client` (nombre, teléfono, email, fecha de nacimiento) va a su
// columna; **todo lo demás que tenga contenido va a `notesCifradas`**,
// como texto legible y cifrado con la clave de la clínica.
//
// ── Por qué el texto tiene FORMA ─────────────────────────────────────
//
// Porque hay dos de esos campos —enfermedades y alergias— que la ficha
// tiene que poder ENSEÑAR aparte, con la etiqueta «De COGECOP · sin
// validar». «Nadie trata a un diabético anticoagulado sin saberlo», y eso
// vale también el primer día, antes de que nadie le haya hecho la
// valoración de clinica-2.
//
// Así que la nota se escribe con una línea por campo, `Etiqueta: valor`,
// y **la misma función que la escribe sabe volver a leerla**. Un test
// hace el viaje de ida y vuelta. La alternativa era una columna nueva en
// `clients` para dos textos que sólo existen en las clínicas que vengan
// de COGECOP, y eso es una migración para un caso de importación.
//
// ── Lo que esto cuesta, dicho ────────────────────────────────────────
//
// Los saltos de línea de dentro de un valor se convierten en « · » al
// escribir. Si no, una enfermedad escrita en tres líneas rompería la
// línea siguiente al leerla. No se pierde ni un carácter de contenido —
// se pierde el salto, que es formato de un campo de texto libre de un
// programa de 2013.

/** Los campos de la nota, en el orden en que se escriben. Las etiquetas
 *  son el contrato: cambiar una deja de leer lo ya escrito, igual que
 *  renombrar una id de zona. */
export const CAMPOS_DE_LA_NOTA = [
  "Enfermedades",
  "Alergias",
  "Comentarios",
  "Otros datos",
  "Alerta",
  "Difunto",
  "Nº de historial antiguo",
  "Nº en COGECOP",
  "NIF",
  "Sexo",
  "Profesión",
  "Domicilio",
  "Población",
  "Código postal",
  "Provincia",
  "País",
  "Otros teléfonos",
  "Otro email",
  "Forma de pago",
  "LOPD",
  "Fecha de nacimiento no válida",
  "Primera visita",
  "Última visita",
  "Visitas en COGECOP",
  "Especialista",
] as const;

export type CampoDeLaNota = (typeof CAMPOS_DE_LA_NOTA)[number];

/** La primera línea. El `%s` es la fecha en dd/mm/aaaa. */
const CABECERA = "Importado de COGECOP el ";

/** La segunda. Es la que dice que esto no es una valoración. */
export const AVISO_DE_LA_NOTA =
  "Sin validar: lo de abajo viene del programa anterior y nadie lo ha repasado con el paciente.";

const RE_CABECERA = /^Importado de COGECOP el (\d{2})\/(\d{2})\/(\d{4})$/;

export interface DatosDeCogecopEnLaFicha {
  /** ISO-8601 `aaaa-mm-dd` del día en que se importó. */
  importadoEl: string;
  /** Campo → valor, sólo los que tenían contenido. */
  campos: Readonly<Partial<Record<CampoDeLaNota, string>>>;
}

/** Una línea de un valor, sin saltos y sin bordes. `null` si no queda
 *  nada: un campo vacío no se escribe. */
function unaLinea(valor: string | null | undefined): string | null {
  if (valor == null) return null;
  const limpio = valor
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "")
    .join(" · ")
    .trim();
  return limpio === "" ? null : limpio;
}

/**
 * La nota de la ficha, entera. `null` si no había NADA que escribir — y
 * entonces la ficha se queda sin nota, en vez de con un encabezado que
 * no encabeza nada.
 *
 * `hoy` entra por la puerta: este paquete no mira el reloj.
 */
export function notaDeCogecop(input: {
  hoy: Date;
  campos: Readonly<Partial<Record<CampoDeLaNota, string | null | undefined>>>;
}): string | null {
  const lineas: string[] = [];
  for (const campo of CAMPOS_DE_LA_NOTA) {
    const valor = unaLinea(input.campos[campo]);
    if (valor == null) continue;
    lineas.push(`${campo}: ${valor}`);
  }
  if (lineas.length === 0) return null;
  const d = input.hoy;
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const aaaa = String(d.getUTCFullYear());
  return [
    `${CABECERA}${dd}/${mm}/${aaaa}`,
    AVISO_DE_LA_NOTA,
    "",
    ...lineas,
  ].join("\n");
}

/**
 * Y al revés: lo que la ficha necesita sacar de la nota.
 *
 * `null` para una nota que no es de COGECOP (la que escribió la
 * recepcionista a mano, por ejemplo): esta función no adivina, mira el
 * encabezado. Y una etiqueta que no está en `CAMPOS_DE_LA_NOTA` se
 * ignora en vez de romper la lectura — una nota a la que alguien le
 * añadió una línea a mano sigue enseñando las alergias.
 */
export function datosDeCogecopDeLaNota(
  nota: string | null | undefined,
): DatosDeCogecopEnLaFicha | null {
  if (nota == null) return null;
  const lineas = nota.replace(/\r\n?/g, "\n").split("\n");
  const cabecera = RE_CABECERA.exec(lineas[0] ?? "");
  if (cabecera == null) return null;
  const campos: Partial<Record<CampoDeLaNota, string>> = {};
  const conocidos = new Set<string>(CAMPOS_DE_LA_NOTA);
  for (const linea of lineas.slice(1)) {
    const corte = linea.indexOf(": ");
    if (corte < 0) continue;
    const etiqueta = linea.slice(0, corte);
    if (!conocidos.has(etiqueta)) continue;
    campos[etiqueta as CampoDeLaNota] = linea.slice(corte + 2);
  }
  return {
    importadoEl: `${cabecera[3]}-${cabecera[2]}-${cabecera[1]}`,
    campos,
  };
}

/** Lo que la ficha enseña bajo «De COGECOP · sin validar». `null` si no
 *  hay nada de lo uno ni de lo otro: la banda no se pinta vacía. */
export interface SinValidarDeCogecop {
  importadoEl: string;
  enfermedades: string | null;
  alergias: string | null;
}

export function sinValidarDeLaNota(
  nota: string | null | undefined,
): SinValidarDeCogecop | null {
  const datos = datosDeCogecopDeLaNota(nota);
  if (datos == null) return null;
  const enfermedades = datos.campos["Enfermedades"] ?? null;
  const alergias = datos.campos["Alergias"] ?? null;
  if (enfermedades == null && alergias == null) return null;
  return { importadoEl: datos.importadoEl, enfermedades, alergias };
}

/** Las doce de la V2, para quien quiera comprobar que una id traducida
 *  existe de verdad. Un test lo recorre: una fila de
 *  `PATOLOGIAS_COGECOP` que apunte a una lesión que no está es una marca
 *  que la pantalla pintaría sin nombre. */
export const LESIONES_DE_LA_IMPORTACION = LESIONES_V2;
