// residencia-2 · `packages/residencia-plan`.
//
// El paquete PURO del plan de cuidados: qué le toca a quién y cuándo. Sin
// base de datos, sin reloj y sin Fastify, para que lo puedan ejecutar los
// tres sitios que lo necesitan:
//
//   · la API, en la vista «hoy» de la ficha del residente (este bloque);
//   · la pantalla de la puerta, SIN RED (residencia-3);
//   · el parte de relevo y el panel de dirección (residencia-5).
//
// Lo que vive aquí y por qué:
//
//   · `tiempo.ts`     — la hora de pared. Copia declarada de
//     `apps/api/src/agenda/time.ts`: ver su cabecera.
//   · `turnos.ts`     — «¿en qué turno cae este instante?». Se MOVIÓ desde
//     `apps/api/src/residencia/turnos.ts`, que ahora la re-exporta.
//   · `frecuencia.ts` — las ocho formas de repartir un cuidado en el
//     tiempo, su validación y su frase para la pantalla.
//   · `que-toca.ts`   — `queToca`.
//   · `relevo-confirmacion.ts` — residencia-5: cuándo un parte de relevo
//     está confirmado y qué ve cada uno de él. Lo ejecutan la tablet de
//     la sala SIN RED y el servidor.
//   · `no-hecho.ts`   — residencia-5: `loQueNoSeHizo`, el cruce entre
//     «qué tocaba» y «qué se registró». Lo ejecutan la tablet de la sala
//     y el servidor, por lo mismo que `gravedadDe`.
//   · `obligaciones.ts` — residencia-5: cuándo toca una obligación de
//     dirección, con el fin de mes y el 29 de febrero dentro.
//   · `indicadores.ts` — residencia-5: la FÓRMULA de cada indicador de
//     AENOR (el umbral es del centro, rama de controles §10). calidad-1
//     le añade siete más y el proceso de referencia de cada uno.
//   · `calidad.ts`    — calidad-1: las bandas de un riesgo, el ciclo de
//     una no conformidad y cuándo un indicador fuera de umbral propone
//     abrir una (D-71, D-73, D-74).
//   · `pin-por-alcance.ts` — residencia-6 (D-68): cuántas cifras tiene
//     que tener un PIN de cuidado según el alcance de sus roles, y
//     cuándo el que tiene puesto se quedó corto. La ejecutan la puerta
//     SIN RED, la sala, el móvil de guardia y el admin.
//   · `gravedad.ts`   — residencia-4: `gravedadDe`, la función que
//     convierte una constante o un evento en un nivel N0-N4. La ejecutan
//     la tablet (al instante y sin red) y el servidor (que es el que
//     manda), y un test de oro fija que dan lo mismo.

export {
  CENTER_TZ,
  addDays,
  daysBetween,
  isoWeekday,
  minutesToTime,
  timeToMinutes,
  utcToWallDate,
  utcToWallTime,
  wallTimeToUtc,
} from "./tiempo.js";

export {
  TURNOS_DE_SERIE,
  cruzaMedianoche,
  diaDelTurno,
  minutosEnTurno,
  turnoDe,
  type TurnoDelCentro,
} from "./turnos.js";

export {
  DIAS_SEMANA,
  frecuenciaEnPalabras,
  problemaDeFrecuencia,
  type Frecuencia,
  type MomentoDelCentro,
  type TipoDeFrecuencia,
} from "./frecuencia.js";

export {
  queToca,
  type AjusteDelCentro,
  type LineaDePlan,
  type Ocurrencia,
} from "./que-toca.js";

export {
  DESTINATARIOS_DE_SERIE,
  MINUTOS_DE_ESCALADO_DE_SERIE,
  NIVELES,
  NIVEL_MINIMO_AL_AVISAR,
  canalesDe,
  conAvisoForzado,
  excepcionVigente,
  gravedadDe,
  gravedadDeEvento,
  masGrave,
  nivelMaximo,
  type CanalDeGuardia,
  type Comparador,
  type ExcepcionDeUmbral,
  type Gravedad,
  type Nivel,
  type ReglaDeGravedad,
} from "./gravedad.js";

export {
  cuantoVaHecho,
  loQueNoSeHizo,
  type ControlParaNoHecho,
  type EntradaDeNoHecho,
  type NoHecho,
  type RegistroHecho,
} from "./no-hecho.js";

export {
  DIAS_DE_PREAVISO,
  diaRecortado,
  diasDelMes,
  diasHasta,
  ocurrenciasDeObligacion,
  periodicidadEnPalabras,
  type ObligacionParaGenerar,
  type PeriodicidadDeObligacion,
} from "./obligaciones.js";

export {
  INDICADORES,
  INDICADORES_SIN_DATO,
  PLAZO_DE_QUEJA_DIAS,
  calcularIndicadores,
  type ComparacionDeIndicador,
  type DatosDelMes,
  type DefinicionDeIndicador,
  type UnidadDeIndicador,
  type ValorDeIndicador,
} from "./indicadores.js";

// calidad-1 (D-71, D-73, D-74) · las bandas de un riesgo, el ciclo de la
// no conformidad y la propuesta de abrir NC. Aquí por lo mismo que
// `gravedadDe`: las ejecutan el servidor y la pantalla, y si no dieran lo
// mismo el botón estaría encendido y la ruta contestaría 409.
export {
  BANDA_EN_PALABRAS,
  CLASE_EN_PALABRAS,
  ESTADO_EN_PALABRAS,
  TRANSICIONES,
  accionVencida,
  bandaDeRiesgo,
  estadoTrasVerificar,
  exigeCausa,
  loQueFaltaPara,
  mesAnterior,
  nivelDeRiesgo,
  proponeNc,
  revisionVencida,
  type BandaDeRiesgo,
  type ClaseDeNc,
  type EstadoDeNc,
  type MesDeIndicador,
  type NcParaElCiclo,
  type PropuestaDeNc,
  type ResultadoDeVerificacion,
} from "./calidad.js";

export {
  alcanceDe,
  estaConfirmado,
  recortarAlAlcance,
  zonasSinConfirmar,
  type AlcanceDeUnAcuse,
  type ZonaDelAcuse,
} from "./relevo-confirmacion.js";

export {
  FRASE_PIN_POR_RENOVAR,
  LARGO_DE_ALCANCE_TOTAL,
  LARGO_MAXIMO,
  LARGO_POR_ZONA,
  largoDePinRequerido,
  pinPorRenovar,
  problemaDelPinNuevo,
  type RolParaElPin,
} from "./pin-por-alcance.js";
