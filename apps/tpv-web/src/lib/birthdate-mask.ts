// B-reservas-mostrador F3 · la fecha de nacimiento, escrita con los dedos.
//
// Hasta este bloque era un `<input type="date">`. En el AP11 (Chrome de
// Android) ese control abre un calendario **en el mes actual**, y una fecha de
// nacimiento está treinta o cuarenta años atrás: son decenas de toques en la
// flechita, o pelearse con el selector de año. Para una recepcionista que está
// dando de alta a una clienta con la clienta delante, eso no es un campo: es
// un obstáculo.
//
// Se cambia por un campo de texto con máscara `dd/mm/aaaa` e
// `inputMode="numeric"` (teclado numérico en el hierro). La API sigue
// recibiendo `YYYY-MM-DD` — el contrato no cambia, sólo cómo se teclea.
//
// Todo esto es lógica pura a propósito: se prueba sin jsdom y sin montar nada.

/** El texto vacío, sin fecha. */
export interface FechaVacia {
  vacio: true;
}
/** Una fecha buena, ya en el formato que quiere la API. */
export interface FechaBuena {
  iso: string;
}
/** Una fecha que no se puede mandar, con la frase que se le enseña. */
export interface FechaMala {
  error: string;
}

export type ResultadoFecha = FechaVacia | FechaBuena | FechaMala;

/**
 * Lo que se pinta en el campo mientras se teclea.
 *
 * Se queda con los dígitos (así da igual que el usuario escriba las barras, las
 * borre, o pegue "07-03-1961") y las vuelve a colocar. Nunca deja más de ocho
 * dígitos: una fecha no da para más, y un campo que se traga lo que no puede
 * usar miente.
 */
export function aplicarMascara(raw: string): string {
  const d = raw.replace(/\D/g, "").slice(0, 8);
  if (d.length <= 2) return d;
  if (d.length <= 4) return `${d.slice(0, 2)}/${d.slice(2)}`;
  return `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}`;
}

/** "1961-03-07" → "07/03/1961", para arrancar la edición de una ficha. */
export function formatearDesdeIso(iso: string | null | undefined): string {
  if (!iso) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return "";
  return `${m[3]}/${m[2]}/${m[1]}`;
}

// El año más antiguo que se acepta. Por debajo casi siempre es un dedazo en el
// año (1061 por 1961), y decirlo es más útil que guardarlo.
const ANO_MINIMO = 1900;

// El mes POR SU NOMBRE. Lo cogió el bucle visual: «El 02 no tiene 31 días» es
// una frase de programador — hay que traducir el 02 antes de entenderla, y
// eso es justo lo que no se hace con una clienta delante.
const MESES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

/**
 * "07/03/1961" → `{ iso: "1961-03-07" }`, o la razón por la que no.
 *
 * `hoy` se pasa a propósito (no se lee el reloj aquí dentro): así el test de
 * «fecha futura» no depende del día en que corra el CI.
 */
export function parsearFecha(texto: string, hoy: Date = new Date()): ResultadoFecha {
  const d = texto.replace(/\D/g, "");
  if (d.length === 0) return { vacio: true };
  if (d.length < 8) {
    return { error: "Escribe la fecha entera: dd/mm/aaaa." };
  }
  const dia = Number(d.slice(0, 2));
  const mes = Number(d.slice(2, 4));
  const ano = Number(d.slice(4, 8));

  if (ano < ANO_MINIMO) {
    return { error: `Comprueba el año: ${ano} es demasiado atrás.` };
  }
  if (mes < 1 || mes > 12) {
    return { error: "El mes tiene que ir del 01 al 12." };
  }
  // El truco de siempre: se construye la fecha en UTC y se comprueba que los
  // tres campos han sobrevivido. Un 31 de febrero se desborda al 2 o 3 de
  // marzo y aquí se cae.
  const fecha = new Date(Date.UTC(ano, mes - 1, dia));
  if (
    fecha.getUTCFullYear() !== ano ||
    fecha.getUTCMonth() !== mes - 1 ||
    fecha.getUTCDate() !== dia
  ) {
    return { error: `${MESES[mes - 1]} no tiene ${dia} días.` };
  }
  // Futuro: se compara por FECHA, no por instante. Cumplir años hoy vale.
  const hoyIso = new Date(
    Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), hoy.getUTCDate()),
  );
  if (fecha.getTime() > hoyIso.getTime()) {
    return { error: "Esa fecha todavía no ha llegado." };
  }
  const iso = `${String(ano).padStart(4, "0")}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
  return { iso };
}

export function esFechaMala(r: ResultadoFecha): r is FechaMala {
  return "error" in r;
}
