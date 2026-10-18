// B-reservas-8 · lo PURO de los bonos, compartido por la API, el TPV y el
// panel. Aquí no hay base de datos, ni husos, ni Fastify: sólo las reglas
// que los tres lados tienen que contar igual.
//
// Lo que NO está aquí, y por qué:
//
//   · la PUERTA de canje (`apps/api/src/vouchers/gate.ts`) — necesita filas
//     bloqueadas y transacciones, y además es la única que puede escribir;
//   · la caducidad en INSTANTES (`apps/api/src/vouchers/caducidad.ts`) —
//     necesita la zona del centro;
//   · la COBERTURA (`apps/api/src/vouchers/cobertura.ts`) — la decide el
//     servidor y el front sólo enseña lo que le devuelve. Que el navegador
//     no calcule saldos ni coberturas es una restricción del bloque.

export {
  mensajeDeEstado,
  mensajeNoApartar,
  seArreglaEnElMomento,
  type EstadoConsulta,
  type MotivoNoApartar,
} from "./estados.js";

export {
  porQueNoDevolvible,
  type BonoParaDevolver,
  type MotivoNoDevolvible,
  type NoDevolvible,
} from "./devolucion.js";

export {
  derivarSaldo,
  desviacionDelInvariante,
  frasePorSesiones,
  ETIQUETA_MOTIVO,
  MOTIVOS_CORRECCION,
  type CanalMovimiento,
  type LineaDelLibro,
  type MotivoCorreccion,
  type SaldoDerivado,
  type TipoMovimiento,
} from "./saldo.js";

export {
  diaSiguiente,
  fechaCorta,
  sumarMesesDeCalendario,
} from "./calendario.js";
