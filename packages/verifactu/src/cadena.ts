// La cadena de registros de una caja: su cabeza, y las dos comprobaciones
// que el art. 7.i de la Orden HAC/1177/2024 obliga a hacer ANTES de
// generar cada registro que no sea el primero.
//
//   7.i) Salvo cuando se trate del primer registro de facturación, cada vez
//   que el sistema informático vaya a generar un nuevo registro de
//   facturación, de alta o de anulación, antes deberá comprobar que se
//   cumplen los siguientes requisitos:
//     1.º El último registro de facturación generado está correctamente
//         encadenado.
//     2.º La fecha y hora de generación del último registro de facturación
//         generado no es superior en más de un minuto a la fecha y hora
//         actuales que se utilizarán para fechar el registro a generar.
//
// El 2.º se lee del revés con mucha facilidad. La FAQ de desarrolladores
// (§15.3) lo aclara: lo NORMAL es que el registro nuevo sea posterior en
// más de un minuto y eso no es ningún problema. Lo que no se admite es que
// el registro que se está generando quede más de un minuto POR DETRÁS del
// anterior — un reloj que se va hacia atrás.
//
// Y lo que NUNCA hacen estas comprobaciones es impedir facturar. La FAQ
// §15.2, literal: «será preciso generar el siguiente RF, ya que la
// facturación por este motivo NUNCA debe interrumpirse». Devuelven avisos,
// no excepciones.

import {
  fechaHoraHusoAeat,
  instanteDeFechaHoraHuso,
} from "./formato.js";
import { huellaSha256 } from "./huella.js";

/**
 * El último registro de la cadena de una caja, con lo justo para encadenar
 * el siguiente y para comprobarlo.
 *
 * Es lo que el dispositivo guarda en IndexedDB y lo que el servidor deriva
 * de su espejo (`GET /tpv/fiscal/chain-head`). Que los dos hablen de lo
 * mismo es lo que permite cambiar de tablet sin partir la cadena.
 */
export interface CabezaDeCadena {
  /** Posición del último registro, 1-based. */
  chainIndex: number;
  /** Identificación de la FACTURA del último registro. En un registro de
   *  anulación es la de la factura anulada — el anexo usa el mismo bloque
   *  `RegistroAnterior` para los dos. */
  idEmisorFactura: string;
  numSerieFactura: string;
  /** `YYYY-MM-DD`. */
  fechaExpedicion: string;
  /** Huella del último registro, hex en mayúsculas. */
  huella: string;
  /** El `FechaHoraHusoGenRegistro` del último registro, tal cual. */
  fechaHoraHusoGenRegistro: string;
  /** La cadena de entrada con la que se calculó su huella. Permite
   *  recalcularla sin volver a formatear nada. Opcional porque un cliente
   *  viejo puede no tenerla guardada; sin ella, la comprobación 1.ª no se
   *  puede hacer y se dice. */
  huellaInput?: string;
  /** Último número de factura emitido en la serie. Sirve para el
   *  correlativo; no entra en ninguna huella. */
  ultimoNumero: number;
  serie: string;
}

export type AnomaliaCadenaCodigo =
  /** La huella del último registro no es la de su propia cadena de entrada. */
  | "HUELLA_ANTERIOR_NO_CUADRA"
  /** No se pudo comprobar: falta la cadena de entrada del último registro. */
  | "HUELLA_ANTERIOR_NO_COMPROBABLE"
  /** El reloj va por detrás del último registro más de un minuto. */
  | "RELOJ_ATRASADO";

export interface AnomaliaCadena {
  codigo: AnomaliaCadenaCodigo;
  mensaje: string;
}

/** Tolerancia del art. 7.i.2.º */
export const TOLERANCIA_RELOJ_MS = 60_000;

export interface ComprobacionPrevia {
  /** El `FechaHoraHusoGenRegistro` que hay que usar para el registro nuevo.
   *  Normalmente es el reloj; si el reloj se ha ido hacia atrás, es el del
   *  registro anterior más un segundo. */
  fechaHoraHusoGenRegistro: string;
  /** Lo que se ha encontrado mal. Nunca impide generar. */
  anomalias: AnomaliaCadena[];
}

/**
 * Las dos comprobaciones del art. 7.i, más la decisión de qué hora usar.
 *
 * `ahora` se pasa en vez de leerse aquí dentro para que los tests puedan
 * fijar el reloj y para que el dispositivo pueda usar el suyo sin que esta
 * función sepa de dónde sale.
 */
export async function comprobarAntesDeGenerar(params: {
  cabeza: CabezaDeCadena | null;
  ahora: Date;
}): Promise<ComprobacionPrevia> {
  const { cabeza, ahora } = params;
  const anomalias: AnomaliaCadena[] = [];

  // Primer registro de la cadena: no hay nada que comprobar. El art. 7.i
  // empieza justamente diciendo «salvo cuando se trate del primer
  // registro de facturación».
  if (!cabeza) {
    return { fechaHoraHusoGenRegistro: fechaHoraHusoAeat(ahora), anomalias };
  }

  // 1.º · ¿El último registro está correctamente encadenado?
  if (cabeza.huellaInput === undefined) {
    anomalias.push({
      codigo: "HUELLA_ANTERIOR_NO_COMPROBABLE",
      mensaje:
        `No se guarda la cadena de entrada del registro ${cabeza.chainIndex} ` +
        "de esta caja, así que no se puede recalcular su huella.",
    });
  } else if ((await huellaSha256(cabeza.huellaInput)) !== cabeza.huella) {
    anomalias.push({
      codigo: "HUELLA_ANTERIOR_NO_CUADRA",
      mensaje:
        `La huella del registro ${cabeza.chainIndex} de esta caja no coincide ` +
        "con la de su propio contenido: la cadena está rota antes de este registro.",
    });
  }

  // 2.º · ¿El reloj se ha ido hacia atrás?
  const anterior = instanteDeFechaHoraHuso(cabeza.fechaHoraHusoGenRegistro);
  const atrasoMs = anterior.getTime() - ahora.getTime();
  if (atrasoMs > TOLERANCIA_RELOJ_MS) {
    anomalias.push({
      codigo: "RELOJ_ATRASADO",
      mensaje:
        `El reloj de este terminal va ${Math.round(atrasoMs / 1000)} s por detrás ` +
        `del registro ${cabeza.chainIndex} de esta caja.`,
    });
    // Se factura igual, pero no con una hora anterior a la del registro
    // previo: eso partiría la cadena para siempre. Se usa la del anterior
    // más un segundo, conservando SU huso (que es el que tenía el sistema
    // en ese momento, que es lo que el anexo define).
    const corregido = new Date(anterior.getTime() + 1000);
    return {
      fechaHoraHusoGenRegistro: conHusoDe(
        corregido,
        cabeza.fechaHoraHusoGenRegistro,
      ),
      anomalias,
    };
  }

  return { fechaHoraHusoGenRegistro: fechaHoraHusoAeat(ahora), anomalias };
}

/** Formatea un instante en el MISMO huso que otra marca ya existente.
 *
 *  Hace falta porque `fechaHoraHusoAeat` usa el huso del reloj del proceso,
 *  y aquí queremos continuar la cadena en el huso en el que venía. */
function conHusoDe(instante: Date, referencia: string): string {
  if (referencia.endsWith("Z")) {
    return `${instante.toISOString().slice(0, 19)}+00:00`;
  }
  const huso = referencia.slice(-6); // `+hh:mm` o `-hh:mm`
  const signo = huso[0] === "-" ? -1 : 1;
  const minutos =
    signo * (Number(huso.slice(1, 3)) * 60 + Number(huso.slice(4, 6)));
  const desplazado = new Date(instante.getTime() + minutos * 60_000);
  return `${desplazado.toISOString().slice(0, 19)}${huso}`;
}

/** El número que le toca a la siguiente factura de la serie. */
export function siguienteNumero(cabeza: CabezaDeCadena | null): number {
  return (cabeza?.ultimoNumero ?? 0) + 1;
}

/** La posición que le toca al siguiente registro de la cadena. */
export function siguienteChainIndex(cabeza: CabezaDeCadena | null): number {
  return (cabeza?.chainIndex ?? 0) + 1;
}
