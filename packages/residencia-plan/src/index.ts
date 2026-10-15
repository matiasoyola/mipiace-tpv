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
