// Formato de los valores que van al registro de facturación, a la huella
// y al QR (V1-verifactu, ADR-019).
//
// Todo lo de este fichero es texto, y lo es a propósito: la huella se
// calcula sobre una cadena de caracteres, no sobre números. En cuanto un
// importe vuelve a ser `number` después de formatearse, la huella deja de
// poder recalcularse igual. Se formatea UNA vez, al generar el registro,
// y a partir de ahí viaja como string.

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * Importe con el formato de la AEAT: punto decimal, dos posiciones, sin
 * separador de miles.
 *
 * El documento de la huella (v0.1.2 §3) dice que «se tratarán
 * indistintamente los valores con una o dos posiciones en los decimales,
 * sin tener relevancia los ceros a la derecha»: `123.1` y `123.10` valen
 * los dos. Esa permisividad es para QUIEN VALIDA. Nosotros emitimos
 * siempre dos decimales — si no, el mismo importe se escribiría de dos
 * formas distintas según el día y nadie sabría cuál se usó para la huella.
 *
 * `-0` se normaliza a `0.00`: un importe negativo cero no existe, y
 * `(-0).toFixed(2)` devuelve `"-0.00"`.
 */
export function importeAeat(value: number): string {
  if (!Number.isFinite(value)) {
    throw new RangeError(`importeAeat: valor no finito (${value})`);
  }
  const rounded = Math.round(value * 100) / 100;
  const normalized = rounded === 0 ? 0 : rounded;
  return normalized.toFixed(2);
}

/**
 * Porcentaje (tipo impositivo, recargo) con el formato del diseño de
 * registro: `Decimal (3,2)`. Mismo criterio que `importeAeat` — dos
 * decimales siempre.
 */
export function porcentajeAeat(value: number): string {
  return importeAeat(value);
}

/** `YYYY-MM-DD` a partir de la hora LOCAL del reloj que se pasa.
 *
 *  La fecha de expedición de una factura es la del calendario de quien la
 *  expide, no la de UTC: un cobro a las 00:30 de Madrid en julio es del
 *  día que marca la tablet, no del anterior. Por eso se leen los
 *  componentes locales y no los `getUTC*`.
 *
 *  Es el formato con el que la fecha viaja y se guarda (`DATE` en
 *  Postgres). El formato de la AEAT (`dd-mm-yyyy`) sale de
 *  `fechaAeatDeIso`, que es una transformación de texto sin zonas horarias
 *  de por medio — así el servidor nunca vuelve a interpretar un instante.
 */
export function fechaCivilLocal(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** `YYYY-MM-DD` → `DD-MM-YYYY`, el formato `Fecha (dd-mm-yyyy)` del anexo.
 *
 *  Sólo texto: no construye un `Date` en medio, que es donde se cuelan los
 *  desplazamientos de un día por zona horaria.
 */
export function fechaAeatDeIso(isoDate: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate.trim());
  if (!m) {
    throw new RangeError(`fechaAeatDeIso: se esperaba YYYY-MM-DD (${isoDate})`);
  }
  return `${m[3]}-${m[2]}-${m[1]}`;
}

/** `DD-MM-YYYY` → `YYYY-MM-DD`. El camino de vuelta, para el servidor. */
export function isoDeFechaAeat(fecha: string): string {
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(fecha.trim());
  if (!m) {
    throw new RangeError(`isoDeFechaAeat: se esperaba DD-MM-YYYY (${fecha})`);
  }
  return `${m[3]}-${m[2]}-${m[1]}`;
}

/**
 * `FechaHoraHusoGenRegistro`: ISO 8601 con huso, al segundo.
 *
 *   2026-09-24T10:11:12+02:00
 *
 * Sin milisegundos — el ejemplo del anexo no los lleva y el campo es
 * `DateTime. Formato: YYYY-MM-DDThh:mm:ssTZD`.
 *
 * El huso es el del reloj que se pasa, que en el dispositivo es el de la
 * tablet. Eso es exactamente lo que pide el anexo: «El huso horario es el
 * que está usando el sistema informático de facturación en el momento de
 * generar el registro».
 */
export function fechaHoraHusoAeat(d: Date): string {
  if (Number.isNaN(d.getTime())) {
    throw new RangeError("fechaHoraHusoAeat: fecha inválida");
  }
  // getTimezoneOffset devuelve minutos que hay que SUMAR a la hora local
  // para llegar a UTC; el signo del huso es el contrario.
  const offsetMinutes = -d.getTimezoneOffset();
  const sign = offsetMinutes < 0 ? "-" : "+";
  const abs = Math.abs(offsetMinutes);
  const huso = `${sign}${pad2(Math.floor(abs / 60))}:${pad2(abs % 60)}`;
  return (
    `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}` +
    `T${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}` +
    huso
  );
}

/** El instante que codifica un `FechaHoraHusoGenRegistro`.
 *
 *  Se usa para comparar dos registros (el chequeo del art. 7.i, §4.4 del
 *  plan), nunca para volver a escribir el campo: el texto original es el
 *  dato y es lo que entró en la huella.
 */
export function instanteDeFechaHoraHuso(value: string): Date {
  const m =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})([+-]\d{2}:\d{2}|Z)$/.exec(
      value.trim(),
    );
  if (!m) {
    throw new RangeError(
      `instanteDeFechaHoraHuso: formato inesperado (${value})`,
    );
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new RangeError(`instanteDeFechaHoraHuso: fecha inválida (${value})`);
  }
  return parsed;
}

/** `C1` + `123` → `C1/000123`.
 *
 *  Es el `NumSerieFactura` del anexo: «Nº Serie+Nº Factura que identifica a
 *  la factura emitida», un solo campo de hasta 60 caracteres. Se guarda
 *  entero y no se vuelve a componer a trozos en ningún otro sitio.
 */
export const NUMERO_FACTURA_DIGITOS = 6;

export function formatNumSerieFactura(serie: string, numero: number): string {
  const s = serie.trim();
  if (!s) throw new RangeError("formatNumSerieFactura: serie vacía");
  if (!Number.isInteger(numero) || numero < 1) {
    throw new RangeError(`formatNumSerieFactura: número inválido (${numero})`);
  }
  return `${s}/${String(numero).padStart(NUMERO_FACTURA_DIGITOS, "0")}`;
}
