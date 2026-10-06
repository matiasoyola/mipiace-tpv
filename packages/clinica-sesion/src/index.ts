// clinica-3 · la sesión y el mapa del pie, en un paquete compartido.
//
// Por qué un paquete y no un fichero del API: la MISMA razón que
// `@mipiacetpv/clinica-valoracion` (clinica-2). El cálculo lo necesitan
// los dos lados —la API decide si una sesión se puede cerrar y qué pasa a
// caja; la pantalla pinta el mapa, el pie de la sesión y el botón
// desactivado con su motivo— y una copia por lado es una regla que algún
// día estará sólo en uno.
//
// Por qué un paquete NUEVO y no dentro del de clinica-2: porque son dos
// datos versionados independientes. El cuestionario de la valoración y el
// mapa del pie cambian por motivos distintos y en momentos distintos, y la
// versión que una sesión guarda es la del MAPA, no la del cuestionario.
// Meterlos juntos habría atado dos relojes que no van a la par.
//
// Lo que vive aquí es PURO: ni Prisma, ni Fastify, ni React, ni reloj. Lo
// que necesita base de datos vive en `apps/api/src/clinica/`.

export {
  ANCHO_DEL_PIE_PX,
  CONTORNO_DEL_PIE,
  MAPA_PIE_V1,
  NOMBRE_CORTO_DEL_PIE,
  NOMBRE_DEL_PIE,
  PIES,
  RADIO_MINIMO,
  VERSION_DEL_MAPA,
  VIEWBOX,
  claveDeZona,
  clavesDelMapa,
  mapaDeVersion,
  nombreDeZona,
  partirClave,
  zonaDe,
  type MapaDelPie,
  type Pie,
  type ZonaDelPie,
} from "./mapa.js";

export {
  CONSEJOS_V1,
  EVOLUCIONES,
  GRAVEDADES,
  LESIONES_V1,
  NOMBRE_DE_EVOLUCION,
  NOMBRE_DE_GRAVEDAD,
  NOMBRE_DE_PROXIMA_CITA,
  PROXIMAS_CITAS,
  SEMANAS_DE_PROXIMA_CITA,
  VERSION_DE_LAS_LESIONES,
  VERSION_DE_LOS_CONSEJOS,
  consejoDe,
  consejosDeVersion,
  esEvolucion,
  esGravedad,
  esProximaCita,
  lesionDe,
  lesionesDeVersion,
  nombreDeConsejo,
  nombreDeLesion,
  type Consejo,
  type Evolucion,
  type Gravedad,
  type Lesion,
  type ListaDeConsejos,
  type ListaDeLesiones,
  type ProximaCita,
} from "./listas.js";

export {
  DOLOR_MAXIMO,
  DOLOR_MINIMO,
  VERSION_DEL_CUERPO,
  dolorEsValido,
  gravedadDisponible,
  igualQueLaUltimaVez,
  limpiarMarcas,
  marcasLegibles,
  marcasPorPie,
  normalizarSesion,
  resumenDeLaSesion,
  textoDelIva,
  type CuerpoDeSesion,
  type GravedadDisponible,
  type LineaDelResumen,
  type LoDeHoy,
  type MarcaDeZona,
  type MarcaLegible,
  type Marcas,
  type ResumenDeLaSesion,
  type SesionAnterior,
  type SesionNormalizada,
  type TratamientoDelCatalogo,
} from "./sesion.js";

export {
  NOMBRE_DE_PULSO,
  NOMBRE_DE_TIPO_DE_PIE,
  PULSOS,
  TIPOS_DE_PIE,
  VERSION_DE_LA_EXPLORACION,
  esPulso,
  esTipoDePie,
  exploracionVacia,
  normalizarExploracion,
  partirDeLaUltima,
  sinSensibilidadPorPie,
  type CuerpoDeExploracion,
  type ExploracionEnPantalla,
  type Pulso,
  type TipoDePie,
} from "./exploracion.js";
