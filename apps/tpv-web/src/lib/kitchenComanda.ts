// kds-1-cocina · QUÉ TIENE LA COCINA DE CADA LÍNEA, ahora de verdad.
//
// Sustituye a `kitchenSentLines.ts`, que lo llevaba en `localStorage`
// porque `TicketLine` no tenía marca de envío y v2-H1 no podía migrar. Ese
// fichero dejaba escrito el caso que no acertaba:
//
//   «una línea que OTRO terminal añade DESPUÉS del último envío y antes de
//   que este terminal abra la mesa se pinta como "En cocina" sin estarlo»
//
// Con `TicketLine.sentUnits` eso desaparece: el servidor dice cuántas
// unidades de cada línea tiene la cocina, y el TPV lo lee. Nada se guarda
// en el navegador, así que dos terminales ven lo mismo y recargar no
// inventa nada.
//
// ── LA LÍNEA SE PARTE POR UNIDADES, NO POR LÍNEAS ─────────────────────
//
// Es la consecuencia de la decisión 6: «"+" sobre lo enviado = una unidad
// nueva SIN ENVIAR. La línea enseña "2 en cocina + 1 sin enviar"».
//
// O sea que una misma línea puede estar en los DOS bloques de la comanda:
// con 2 unidades en «EN COCINA» y 1 en «SIN ENVIAR». Y eso es exactamente
// lo que el camarero tiene que leer, porque las dos mitades se corrigen
// distinto:
//
//   · en «SIN ENVIAR», el `−` baja unidades y la cocina no se enteró de
//     nada (es lo de v2-H1, sin cambios);
//   · en «EN COCINA», el `−` **anula** una unidad que ya está en la
//     plancha: sale «Bravas −1 · Deshacer» y, pasados 5 s, va a cocina.
//
// Los bloques se conservan tal cual los dejó v2-H1 (§5): no se regresa
// nada. Lo único que cambia es de dónde sale la verdad y que lo enviado
// puede llevar `−`/`+` donde hay pantalla.

import type { KitchenSection } from "../kitchen/secciones.js";

/** Lo que el servidor dice de cada línea (`GET /tickets/:id/kitchen`). */
export interface EstadoLineaCocina {
  id: string;
  units: number;
  sentUnits: number;
  course: number;
  seat: number | null;
  /**
   * La sección de esta línea, resuelta por el SERVIDOR.
   *
   * No se calcula aquí a propósito: resolverla en el front obligaría a
   * bajar el mapa `etiqueta → sección` al navegador y a repetir la regla
   * de `destinos.ts`. Dos copias de esa regla es como una mesa acaba
   * ofreciendo corregir unidades de algo que está en la plancha.
   */
  section: KitchenSection;
}

export interface DestinoSeccionTpv {
  screen: boolean;
  printer: boolean;
  /**
   * La **regla por destino** de la decisión 6: el `−`/`+` sobre lo enviado
   * sólo aparece donde hay pantalla.
   *
   * v2-H1 lo quitó por una razón concreta: sin pantalla, un `−` quitaba el
   * plato de la cuenta mientras el papel seguía en la plancha y cocina
   * nunca se enteraba. Con pantalla la anulación llega, así que el motivo
   * desaparece. Sin pantalla el motivo sigue en pie y se mantiene lo de
   * v2-H1: «Anular» con el aviso «cocina ya tiene el papel: díselo».
   */
  canCorrectSent: boolean;
}

export interface EstadoCocinaMesa {
  diners: number | null;
  revision: number;
  lines: EstadoLineaCocina[];
  firedCourses: Array<{ course: number; firedAt: string }>;
  allergies: Array<{ seat: number | null; allergen: string }>;
  orders: Array<{
    id: string;
    section: KitchenSection;
    number: number;
    urgent: boolean;
    ready: boolean;
    readyAt: string | null;
    tableName: string | null;
  }>;
  destinations: Record<KitchenSection, DestinoSeccionTpv>;
}

export function estadoCocinaVacio(): EstadoCocinaMesa {
  return {
    diners: null,
    revision: 0,
    lines: [],
    firedCourses: [],
    allergies: [],
    orders: [],
    destinations: {
      BARRA: { screen: false, printer: false, canCorrectSent: false },
      COCINA: { screen: false, printer: false, canCorrectSent: false },
      SALON: { screen: false, printer: false, canCorrectSent: false },
    },
  };
}

/**
 * Normaliza lo que llega de `GET /tickets/:id/kitchen` a un estado COMPLETO.
 *
 * No es paranoia defensiva: es que **la comanda es la pantalla de la venta
 * y no puede caerse por una respuesta rara**. Tres caminos reales dan un
 * 200 con la forma incompleta:
 *
 *   · un terminal con el bundle nuevo contra una API vieja, que es lo
 *     normal durante los minutos de un despliegue;
 *   · un proxy o una pantalla cautiva que devuelve un 200 con otro cuerpo;
 *   · un banco de pruebas que no conoce esta ruta.
 *
 * Sin esto, un `allergies` ausente tiraba el render entero de la comanda
 * —`estado.allergies.length` sobre `undefined`— y el camarero se quedaba
 * con la pantalla en blanco en mitad de una mesa. Lo encontraron dos
 * ficheros de tests de v1.12 al correr la suite completa.
 */
export function normalizarEstado(raw: unknown): EstadoCocinaMesa {
  const vacio = estadoCocinaVacio();
  if (!raw || typeof raw !== "object") return vacio;
  const r = raw as Partial<EstadoCocinaMesa>;
  const destinos = { ...vacio.destinations };
  if (r.destinations && typeof r.destinations === "object") {
    for (const sec of ["BARRA", "COCINA", "SALON"] as const) {
      const d = (r.destinations as Record<string, unknown>)[sec];
      if (d && typeof d === "object") {
        const x = d as Partial<DestinoSeccionTpv>;
        destinos[sec] = {
          screen: x.screen === true,
          printer: x.printer === true,
          canCorrectSent: x.canCorrectSent === true,
        };
      }
    }
  }
  return {
    diners: typeof r.diners === "number" ? r.diners : null,
    revision: typeof r.revision === "number" ? r.revision : 0,
    lines: Array.isArray(r.lines) ? r.lines : [],
    firedCourses: Array.isArray(r.firedCourses) ? r.firedCourses : [],
    allergies: Array.isArray(r.allergies) ? r.allergies : [],
    orders: Array.isArray(r.orders) ? r.orders : [],
    destinations: destinos,
  };
}

/** Cuántas unidades de esta línea tiene la cocina. 0 si no la conoce. */
export function unidadesEnCocina(
  estado: EstadoCocinaMesa,
  lineId: string,
): number {
  return estado.lines.find((l) => l.id === lineId)?.sentUnits ?? 0;
}

export interface TrozoComanda<T> {
  line: T;
  /** Las unidades de ESTE trozo, no las de la línea. */
  units: number;
}

export interface ComandaPartida<T> {
  /** Lo que la cocina ya tiene. Atenuado. */
  sent: Array<TrozoComanda<T>>;
  /** Lo que todavía no ha salido. Destacado, con `−`/`+`. */
  pending: Array<TrozoComanda<T>>;
}

/**
 * Parte la comanda en los dos bloques, **por unidades**.
 *
 * Conserva el ORDEN de la lista original dentro de cada bloque, y por la
 * misma razón que lo conservaba v2-H1: la comanda se lee de arriba abajo y
 * el camarero reconoce lo que acaba de marcar por donde está. Reordenar
 * dentro de un bloque convertiría «la última que toqué» en «búscala».
 */
export function partirComanda<T extends { id: string; units: number }>(
  lines: readonly T[],
  estado: EstadoCocinaMesa,
): ComandaPartida<T> {
  const sent: Array<TrozoComanda<T>> = [];
  const pending: Array<TrozoComanda<T>> = [];
  for (const line of lines) {
    const enCocina = Math.min(line.units, unidadesEnCocina(estado, line.id));
    const sinEnviar = Math.round((line.units - enCocina) * 1000) / 1000;
    if (enCocina > 0) sent.push({ line, units: enCocina });
    if (sinEnviar > 0) pending.push({ line, units: sinEnviar });
  }
  return { sent, pending };
}

/**
 * «EN COCINA · hh:mm» con la hora del último envío.
 *
 * Hora y no «hace 12 min», igual que en v2-H1: lo que el camarero compara
 * es contra el reloj de la cocina («¿el de las 10:07 ya salió?»), no contra
 * un contador que cambia cada minuto. Los minutos son cosa de la pantalla
 * de cocina, que es quien tiene que decidir qué sacar primero.
 */
export function etiquetaEnCocina(lastSentAt: string | null): string {
  if (!lastSentAt) return "EN COCINA";
  const d = new Date(lastSentAt);
  if (Number.isNaN(d.getTime())) return "EN COCINA";
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `EN COCINA · ${hh}:${mm}`;
}

/**
 * ¿Está retenido este tiempo?
 *
 * La ausencia de fila en `firedCourses` es «retenido» (ver `TicketCourse`
 * en el esquema). El tiempo 1 marcha al enviar, así que antes del primer
 * envío no hay ninguna fila y nada está marchado — que es correcto: nada
 * ha salido.
 */
export function tiempoRetenido(
  estado: EstadoCocinaMesa,
  course: number,
): boolean {
  return !estado.firedCourses.some((c) => c.course === course);
}

/**
 * Los tiempos de esta mesa que están RETENIDOS y tienen algo dentro.
 *
 * Es lo que alimenta el botón «Marchar 2º» del TPV: si no hay ningún
 * tiempo retenido con líneas, el botón no se pinta — un botón que no hace
 * nada ocupa 56 px de una pantalla donde no sobran.
 */
export function tiemposPorMarchar(estado: EstadoCocinaMesa): number[] {
  const conLineas = new Set<number>();
  for (const l of estado.lines) {
    if (l.course > 1) conLineas.add(l.course);
  }
  return [...conLineas]
    .filter((c) => tiempoRetenido(estado, c))
    .sort((a, b) => a - b);
}

/** «Marchar 2º» · «Marchar 3º» · «Marchar postre». */
export function etiquetaMarchar(course: number): string {
  return `Marchar ${course}º`;
}

/**
 * Las alergias que afectan a una silla: las suyas más las de TODA LA MESA.
 *
 * Una alergia sin silla aplica a todo el mundo: es lo que se marca cuando
 * el camarero no sabe quién es, y «vale igual» (decisión 3).
 */
export function alergenosDeSilla(
  estado: EstadoCocinaMesa,
  seat: number | null,
): string[] {
  const deLaMesa = estado.allergies
    .filter((a) => a.seat == null)
    .map((a) => a.allergen);
  if (seat == null) return [...new Set(deLaMesa)];
  const deEsa = estado.allergies
    .filter((a) => a.seat === seat)
    .map((a) => a.allergen);
  return [...new Set([...deEsa, ...deLaMesa])];
}

/** Las sillas con alguna alergia declarada, ordenadas. */
export function sillasConAlergia(estado: EstadoCocinaMesa): number[] {
  return [
    ...new Set(
      estado.allergies
        .map((a) => a.seat)
        .filter((s): s is number => s != null),
    ),
  ].sort((a, b) => a - b);
}

/** ¿Tiene esta mesa alguna alergia declarada, de silla o de toda la mesa? */
export function mesaConAlergia(estado: EstadoCocinaMesa): boolean {
  return estado.allergies.length > 0;
}

/**
 * **La regla por destino** de la decisión 6, resuelta para UNA línea.
 *
 * El `−`/`+` sobre lo enviado sólo aparece si la sección de ESA línea
 * tiene pantalla. Por sección y no por mesa porque una mesa puede tener
 * las dos cosas: las bravas a la pantalla de cocina (con `−`/`+`) y las
 * cañas a la impresora de la barra (sin).
 *
 * Una línea que el servidor todavía no conoce —acabada de añadir y aún no
 * confirmada— devuelve `false`. Es lo prudente: sin saber a dónde va, no
 * se ofrece corregir algo que podría estar en la plancha.
 */
export function puedeCorregirEnviado(
  estado: EstadoCocinaMesa,
  lineId: string,
): boolean {
  const linea = estado.lines.find((l) => l.id === lineId);
  if (!linea) return false;
  return estado.destinations[linea.section]?.canCorrectSent === true;
}

/** La silla de una línea según el servidor. `null` = para la mesa. */
export function sillaDeLinea(
  estado: EstadoCocinaMesa,
  lineId: string,
): number | null {
  return estado.lines.find((l) => l.id === lineId)?.seat ?? null;
}

/** El tiempo de una línea según el servidor. 1 si no lo conoce. */
export function tiempoDeLinea(
  estado: EstadoCocinaMesa,
  lineId: string,
): number {
  return estado.lines.find((l) => l.id === lineId)?.course ?? 1;
}
