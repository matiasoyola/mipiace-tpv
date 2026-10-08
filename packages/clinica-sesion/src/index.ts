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

// ── clinica-5 · la sesión por tipo de visita ──────────────────────────

export {
  COLOR_DE_TIPO_DE_VISITA,
  DESCRIPCION_DE_TIPO_DE_VISITA,
  ESPECIALIDADES,
  ESPECIALIDAD_DE_TIPO,
  NOMBRE_DE_ESPECIALIDAD,
  NOMBRE_DE_TIPO_DE_VISITA,
  TIPOS_DE_VISITA,
  VERSION_DE_LOS_TIPOS,
  esEspecialidad,
  esTipoDeVisita,
  especialidadDeLosTipos,
  normalizarSlug,
  tipoDelServicio,
  type Especialidad,
  type ServicioPorEtiquetas,
  type TipoDeVisita,
  type TipoDelServicio,
} from "./tipos-de-visita.js";

export {
  ACTOS_QUIROPODIA_V1,
  NIVELES_DE_QUIROPODIA,
  NOMBRE_DE_NIVEL,
  REGLA_DE_NIVEL_V1,
  VERSION_DE_LA_REGLA_DE_NIVEL,
  VERSION_DE_LOS_ACTOS,
  actoDe,
  actosDeVersion,
  esNivelDeQuiropodia,
  nivelPropuesto,
  nombreDeActo,
  textoDelCambioDeNivel,
  type ActoDeQuiropodia,
  type ListaDeActos,
  type NivelDeQuiropodia,
  type NivelPropuesto,
  type ReglaDeNivel,
} from "./niveles.js";

export {
  ESCALONES_DE_RIESGO,
  FUENTE_DEL_RIESGO,
  NOMBRE_DE_PULSO_PEDIO,
  NOMBRE_DE_SENSIBILIDAD,
  NOMBRE_DE_SI_NO,
  PULSOS_PEDIOS,
  SENSIBILIDADES,
  SI_NO,
  VERSION_DEL_RIESGO,
  comprobacionesVacias,
  esPulsoPedio,
  esSensibilidad,
  esSiNo,
  escalonDe,
  faltaPorComprobar,
  riesgoDelPie,
  type CategoriaDeRiesgo,
  type ComprobacionesDelPie,
  type EscalonDeRiesgo,
  type PulsoPedio,
  type RiesgoDelPie,
  type Sensibilidad,
  type SiNo,
} from "./riesgo.js";

export {
  ESTADOS_DE_HERIDA,
  PISADAS,
  PUNTOS_DE_LA_HERIDA,
  TIPOS_DE_PIE_BIOMECANICA,
  VERSION_DE_LOS_BLOQUES,
  esOpcionDe,
  nombreDeOpcion,
  nombreDeOpcionDeBloque,
  opcionValida,
  type ListaDeOpciones,
  type Opcion,
} from "./bloques.js";

export {
  ALERTAS_CRUZADAS_V1,
  VERSION_DE_LAS_ALERTAS_CRUZADAS,
  alertasCruzadasDeVersion,
  avisosCruzados,
  type AvisoCruzado,
  type Disparador,
  type LoQueSeHaceHoy,
  type ReglaCruzada,
  type TablaDeAlertasCruzadas,
} from "./alertas-cruzadas.js";

export {
  PENDIENTES_V1,
  VERSION_DE_LOS_PENDIENTES,
  cierresAutomaticos,
  claseDePendiente,
  claveDePendiente,
  pendienteLegible,
  pendientesACrear,
  pendientesAbiertos,
  pendientesDeVersion,
  pendientesQuePreguntar,
  seCierraSolo,
  type ClaseDePendiente,
  type FormaDeCierre,
  type FormaDeCierreAMano,
  type ListaDePendientes,
  type LoDeHoyParaPendientes,
  type PendienteCerrado,
  type PendienteCreado,
  type PendienteLegible,
} from "./pendientes.js";

export {
  VERSION_DEL_CUERPO_V2,
  esCuerpoV2,
  normalizarSesionV2,
  productoDelNivel,
  resumenPorTipos,
  serviciosDeLaSesion,
  serviciosPorTipo,
  textoSinCobro,
  tiposDeLaSesion,
  versionesDeHoy,
  type BloqueBiomecanica,
  type BloqueCirugia,
  type BloqueGeneral,
  type BloquePieDeRiesgo,
  type BloqueQuiropodia,
  type BloquesDeLaSesion,
  type CuerpoDeSesionCualquiera,
  type CuerpoDeSesionV1,
  type CuerpoDeSesionV2,
  type EntradaDeCierreV2,
  type LineaPorTipo,
  type ResumenPorTipos,
  type ServicioDeSesion,
  type SesionV2Normalizada,
  type TipoSinCobro,
  type TiposDeLaSesion,
  type VersionesDeLasListas,
} from "./sesion-v2.js";

// ── clinica-6 · la historia viva ──────────────────────────────────────

export {
  ESTADOS_DE_ZONA,
  NOMBRE_DE_ESTADO_DE_ZONA,
  TIPOS_QUE_MIRAN_EL_PIE,
  TIPO_SUGERIDO_POR_PENDIENTE,
  estadoDeLasZonas,
  exploroElPie,
  hoyToca,
  ojoDeHoy,
  tendenciaDelDolor,
  tipoRecomendado,
  ultimaVisita,
  visitaDeLaHistoria,
  visitaLegible,
  type EstadoDeZonaViva,
  type HoyToca,
  type OjoDeHoy,
  type PasoDeZona,
  type PuntoDeDolor,
  type Recomendada,
  type TendenciaDelDolor,
  type VisitaDeLaHistoria,
  type VisitaLegible,
  type ZonaViva,
} from "./historia.js";
