// residencia-1 (D-54) · «¿EN QUÉ TURNO CAE ESTE INSTANTE?»
//
// ── residencia-2 LA MOVIÓ, y este fichero la re-exporta ──────────────
//
// El cuerpo vive ahora en `packages/residencia-plan` porque `queToca` la
// necesita en bucle y un paquete puro no puede importar de `apps/api`. Lo
// que se podía hacer era copiarla por TERCERA vez —ya estaba aquí y en la
// tablet— o traerla al paquete y re-exportarla desde aquí. Lo segundo deja
// dos copias en vez de tres, y la que queda (la de la tablet) es
// deliberada: en residencia-3 la puerta tendrá que adscribir un registro a
// un turno **sin red**, y el servidor no puede contestar eso.
//
// Este fichero sigue exportando exactamente lo que exportaba, así que
// ninguno de los sitios que importaban de aquí —`turnos-routes.ts`,
// `puerta-routes.ts`, `semilla.ts` y `residencia-turnos.test.ts`— cambia
// una línea. Es la frontera: si mañana el paquete se reorganiza, se toca
// este fichero y nadie más.
//
// Las dos razones por las que esto no es un `>=` y un `<` están escritas
// en la cabecera del fichero del paquete: la noche cruza medianoche
// (disyunción, no rango) y la hora es de pared en `Europe/Madrid`.

export {
  TURNOS_DE_SERIE,
  cruzaMedianoche,
  minutosEnTurno,
  turnoDe,
  type TurnoDelCentro,
} from "@mipiacetpv/residencia-plan";
