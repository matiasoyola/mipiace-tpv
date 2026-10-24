// clinica-9 (12) · LA AGENDA VUELVE AL DÍA EN EL QUE SE ESTABA.
//
// La pasada en hierro del 24-10 (captura 16): la recepción está en la
// agenda del lunes 26, le da la tablet a la paciente para el test, la
// paciente pulsa «Devolver la tablet al centro» — y la agenda vuelve a
// **HOY**. La cita que se estaba preparando está dos días más allá, y hay
// que volver a buscarla con la paciente delante.
//
// No es un estado perdido por descuido: el camino de la tablet es una
// NAVEGACIÓN DE VERDAD (`window.location.replace`), ida y vuelta, y tiene
// que serlo — el modo paciente no puede tener un botón «atrás» que
// devuelva al TPV con la señora delante. Lo que se pierde en esa vuelta
// es todo el estado de React, el día incluido.
//
// Así que el día se apunta fuera de React, en `sessionStorage`: misma
// pestaña, se borra al cerrarla, y no viaja a ningún sitio.
//
// ── Y SÓLO SE USA TRAS UNA RECARGA DE VERDAD ─────────────────────────
//
// «Volver al día en el que estaba» es la respuesta correcta a una
// navegación que se llevó el estado por delante, y sólo a ésa. Abrir y
// cerrar la agenda dentro de la misma pantalla no se lleva nada: ahí la
// agenda abre en HOY, como siempre, porque es lo que la recepción
// espera al tocar el botón.
//
// Se distinguen con un sello de CARGA: un identificador que nace con el
// módulo y muere con la pestaña. El recuerdo sólo vale si lo escribió
// una carga ANTERIOR — o sea, si por medio hubo un `location.replace`,
// que es exactamente el camino de la tablet.
//
// ── Por qué caduca, y en diez minutos ────────────────────────────────
//
// Porque «donde estaba» sólo significa algo si fue hace un momento. Un
// TPV que se queda encendido toda la noche y se recarga por la mañana
// tiene que abrir en HOY: la agenda de ayer no es donde está nadie. Diez
// minutos cubren de sobra una ida y vuelta a la tablet —el test son tres
// minutos— y no llegan a ninguna otra cosa.
//
// Y **nunca** se recuerda un día del pasado: si la recepción estaba
// mirando el viernes pasado y la tablet vuelve el lunes, lo que toca es
// hoy. Lo que este recuerdo existe para salvar es la cita que se está
// preparando, y ésa siempre está por delante.

const CLAVE = "mipiacetpv-agenda-dia";

/** Cuánto vale el recuerdo. Ver la cabecera. */
export const MINUTOS_DE_RECUERDO = 10;

interface Recuerdo {
  /** «2026-10-26», día de pared del centro. */
  dia: string;
  /** Cuándo se apuntó, en ms. */
  en: number;
  /** Qué CARGA de la aplicación lo apuntó. Ver la cabecera. */
  carga: string;
}

/**
 * El sello de esta carga. Nace al importar el módulo: una pestaña que se
 * recarga entera (o que navega con `location.replace`) empieza con otro.
 *
 * No hace falta que sea único en el mundo, sólo que no se repita entre
 * dos cargas seguidas de la misma pestaña.
 */
const CARGA = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

function almacen(): Storage | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    // Safari en privado tira al tocar `sessionStorage`. Sin recuerdo, la
    // agenda abre en hoy, que es lo de siempre.
    return null;
  }
}

/** Apunta el día que la agenda está enseñando. */
export function recordarDiaDeLaAgenda(dia: string, ahora = Date.now()): void {
  const s = almacen();
  if (!s) return;
  try {
    s.setItem(
      CLAVE,
      JSON.stringify({ dia, en: ahora, carga: CARGA } satisfies Recuerdo),
    );
  } catch {
    /* cuota llena: sin recuerdo */
  }
}

/**
 * Decide con qué día abre la agenda. Pura: `crudo`, `hoy` y `ahora`
 * entran como datos.
 *
 * Devuelve `hoy` siempre que el recuerdo no sirva — no hay un tercer
 * valor, porque «no sé qué día enseñar» no es un estado que la agenda
 * pueda pintar.
 */
export function diaConElQueAbrir(input: {
  crudo: string | null;
  hoy: string;
  ahora: number;
  /** El sello de ESTA carga. Si el recuerdo lo escribió ella misma, no
   *  hubo recarga por medio y no hay nada que restaurar. */
  carga: string;
}): string {
  const { crudo, hoy, ahora, carga } = input;
  if (!crudo) return hoy;
  let r: Recuerdo;
  try {
    r = JSON.parse(crudo) as Recuerdo;
  } catch {
    return hoy;
  }
  if (typeof r?.dia !== "string" || typeof r?.en !== "number") return hoy;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(r.dia)) return hoy;
  if (r.carga === carga) return hoy;
  if (ahora - r.en > MINUTOS_DE_RECUERDO * 60_000) return hoy;
  // Ni un día del pasado, ni uno anterior a hoy por el reloj del aparato.
  if (r.dia < hoy) return hoy;
  return r.dia;
}

/** Lo mismo, leyendo el almacén de verdad. */
export function diaRecordado(hoy: string, ahora = Date.now()): string {
  const s = almacen();
  let crudo: string | null = null;
  try {
    crudo = s?.getItem(CLAVE) ?? null;
  } catch {
    crudo = null;
  }
  return diaConElQueAbrir({ crudo, hoy, ahora, carga: CARGA });
}
