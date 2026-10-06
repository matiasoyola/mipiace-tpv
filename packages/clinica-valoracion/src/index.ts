// clinica-2 · la valoración inicial, en un paquete compartido.
//
// Por qué un paquete y no un fichero del API: el MISMO cálculo lo necesitan
// los dos lados. La API decide si una valoración se puede validar y qué
// alertas tiene; el test del paciente y la pantalla del sanitario (en
// `tpv-web`) pintan el botón desactivado con su motivo y la franja de
// alertas. Si cada lado llevara su copia, el día que cambie una regla la
// pantalla diría una cosa y el servidor otra — y la que gana es la del
// servidor, así que el usuario vería un botón activo que falla.
//
// Lo que vive aquí es PURO: ni Prisma, ni Fastify, ni React, ni reloj. Lo
// que necesita base de datos (buscar la valoración de un paciente, crear
// el token del enlace) vive en `apps/api/src/clinica/`.

export {
  CUESTIONARIO_V1,
  VERSION_VIGENTE,
  cuestionarioDeVersion,
  preguntaDe,
  preguntasEnJuego,
  type CanalValoracion,
  type Cuestionario,
  type EstadoValoracion,
  type Pregunta,
  type RespondioPor,
  type Respuesta,
} from "./cuestionario.js";

export {
  correccionesVigentes,
  resolverVigente,
  valorVigente,
  type Correccion,
  type EstadoRespuestas,
  type RespuestaVigente,
  type RespuestasPaciente,
} from "./vigente.js";

export {
  alertasDe,
  type Alerta,
  type Alertas,
  type EntradaAlertas,
} from "./alertas.js";

export {
  CONFIRMACIONES_VACIAS,
  TEXTO_CONFIRMACION,
  puedeValidarse,
  type Confirmaciones,
  type EntradaValidar,
  type MotivoNoValidable,
  type Validable,
} from "./validar.js";

export {
  puedeRecibirPrimerTratamiento,
  type MotivoSinTratamiento,
  type PuertaPrimerTratamiento,
  type ValoracionParaPuerta,
} from "./primer-tratamiento.js";
