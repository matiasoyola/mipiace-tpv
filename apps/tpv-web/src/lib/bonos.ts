// B-reservas-8 · los bonos, desde el TPV.
//
// Dos reglas que este fichero respeta y que conviene tener delante al
// tocarlo:
//
//   1. **Nada de saldo calculado aquí.** El navegador enseña lo que
//      devuelve el servidor: las sesiones, la frase («quedan 3 · 1
//      apartada») y el motivo de cada «no» vienen hechos. Si el front
//      restara sesiones por su cuenta, dos terminales enseñarían dos
//      saldos distintos del mismo bono.
//   2. **El precio lo pone el servidor.** Marcar una línea con un bono
//      manda SÓLO el id del bono; el importe (0 € o el prorrateo del
//      frente P5) lo decide la API desde el ajuste del centro.
//
// Y la tercera, que no es de este fichero pero se nota aquí: el sanitario
// sin caja recibe un bono **sin claves de dinero**. Por eso los importes
// son opcionales en los tipos de abajo: no es que puedan faltar por un
// error, es que a quien no ve dinero no se le mandan.

import { ApiError, apiWithCashier } from "../api.js";

/** La lista cerrada de `consultar()`. El `default` del `switch` que la
 *  consuma dice «llama al centro», y añadir un estado es tocar los dos
 *  lados a la vez — que es lo que se quiere. */
export type EstadoBono =
  | "ok"
  | "noexiste"
  | "otro_cliente"
  | "no_cubre"
  | "agotado"
  | "caducado"
  | "anulado";

/** El bono como lo devuelve la API. Los dos importes son opcionales porque
 *  al sanitario sin caja NO SE LE MANDAN (no se le ocultan). */
export interface BonoDeLaFicha {
  id: string;
  code: string;
  nombre: string;
  sesionesTotal: number;
  sesionesLibres: number;
  sesionesApartadas: number;
  sesionesConsumidas: number;
  /** «quedan 3 · 1 apartada», hecha en el servidor. */
  resumen: string;
  /** El último día bueno, `YYYY-MM-DD`. `null` = sin caducidad. */
  caducaEl: string | null;
  status: string;
  origen: string;
  esPrueba: boolean;
  creadoEl: string;
  valorCartaCents?: number;
  cobradoCents?: number;
  soldTicketId?: string | null;
}

/** Una línea del libro, legible. Sin dinero: el libro habla de sesiones. */
export interface LineaDelLibro {
  id: string;
  tipo: string;
  sesiones: number;
  detalle: string;
  motivo: string | null;
  canal: string;
  quien: string;
  appointmentId: string | null;
  ticketLineId: string | null;
  compensaA: string | null;
  esPrueba: boolean;
  cuando: string;
}

export interface DetalleDeBono {
  bono: BonoDeLaFicha;
  traza: LineaDelLibro[];
  /** El «por qué no se puede devolver», con la MISMA función que usa el
   *  servidor. `null` = se puede. */
  noDevolvible: { motivo: string; mensaje: string } | null;
}

export interface BonosDeLaFicha {
  balance: { sessionsLeft: number; amountLeftCents: number };
  vouchers: BonoDeLaFicha[];
}

/** Un bono que cubre lo que se está citando. Sin dinero: esta lista sale
 *  en la agenda, y en la agenda no se habla de euros. */
export interface BonoQueCubre {
  id: string;
  code: string;
  nombre: string;
  sesionesLibres: number;
  sesionesApartadas: number;
  caducaEl: string | null;
}

export async function getBonosDeLaFicha(
  clientId: string,
): Promise<BonosDeLaFicha> {
  return apiWithCashier<BonosDeLaFicha>(`/clients/${clientId}/vouchers`);
}

export async function getDetalleDeBono(id: string): Promise<DetalleDeBono> {
  return apiWithCashier<DetalleDeBono>(`/bonos/${id}`);
}

/**
 * Los bonos de una clienta que cubren TODOS estos servicios.
 *
 * **Puede devolver más de uno, y entonces hay que PREGUNTAR.** El servidor
 * no elige por una razón: gastar el de 10 sesiones en vez del de 1 que
 * caduca el viernes no se nota hasta que el de 1 caduca con una sesión
 * dentro. `hayQuePreguntar` viene del servidor para que la pantalla no
 * tenga que contar.
 *
 * Con el módulo apagado la ruta contesta 404 (a una peluquería sin bonos no
 * se le cuenta que existen), así que aquí eso se traduce a «ninguno» y la
 * pantalla no pinta nada. No es un error que haya que enseñar.
 */
export async function bonosQueCubren(
  clientId: string,
  serviceIds: string[],
): Promise<{ bonos: BonoQueCubre[]; hayQuePreguntar: boolean }> {
  if (serviceIds.length === 0) return { bonos: [], hayQuePreguntar: false };
  try {
    return await apiWithCashier<{
      bonos: BonoQueCubre[];
      hayQuePreguntar: boolean;
    }>(
      `/clients/${clientId}/bonos-que-cubren?serviceIds=${encodeURIComponent(
        serviceIds.join(","),
      )}`,
    );
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      return { bonos: [], hayQuePreguntar: false };
    }
    throw err;
  }
}

// ── El canje en caja ──────────────────────────────────────────────────

export interface PropuestaDeCanje {
  ticketLineId: string;
  serviceId: string;
  nameSnapshot: string;
  bonos: BonoQueCubre[];
  /** El bono con el que la línea YA está marcada, si lo está. */
  marcadoCon: string | null;
}

export async function propuestasDeCanje(
  ticketId: string,
): Promise<PropuestaDeCanje[]> {
  try {
    const res = await apiWithCashier<{ propuestas: PropuestaDeCanje[] }>(
      `/tickets/${ticketId}/bonos`,
    );
    return res.propuestas;
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return [];
    throw err;
  }
}

export type ResultadoCanje =
  | { ok: true }
  | { ok: false; message: string };

/** Marca una línea para pagarse con un bono. Del navegador sale SÓLO el id:
 *  el importe lo pone el servidor. */
export async function marcarCanje(
  ticketId: string,
  lineId: string,
  voucherId: string,
): Promise<ResultadoCanje> {
  try {
    await apiWithCashier(`/tickets/${ticketId}/lines/${lineId}/bono`, {
      method: "POST",
      body: { voucherId },
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, message: mensajeDeError(err) };
  }
}

/** Quita el bono de una línea: lo apartado se libera y la línea vuelve a su
 *  precio (el del producto, puesto por el servidor). */
export async function quitarCanje(
  ticketId: string,
  lineId: string,
): Promise<ResultadoCanje> {
  try {
    await apiWithCashier(`/tickets/${ticketId}/lines/${lineId}/bono`, {
      method: "DELETE",
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, message: mensajeDeError(err) };
  }
}

// ── La puerta, por código ─────────────────────────────────────────────

export interface ResultadoConsulta {
  estado: EstadoBono;
  /** La frase, hecha en el servidor. Vacía con `ok`. */
  mensaje: string;
  /** Si esto se arregla aquí y ahora en el mostrador. Ordena la pantalla. */
  seArreglaEnElMomento: boolean;
  porQueCubre: "servicio" | "categoria" | null;
  bono: { id: string; code: string; nombre: string } | null;
}

export async function consultarBono(
  texto: string,
  opts: { clienteId?: string; servicioId?: string } = {},
): Promise<ResultadoConsulta> {
  const q = new URLSearchParams({ texto });
  if (opts.clienteId) q.set("clienteId", opts.clienteId);
  if (opts.servicioId) q.set("servicioId", opts.servicioId);
  return apiWithCashier<ResultadoConsulta>(`/bonos/consultar?${q.toString()}`);
}

/** «Ningún botón gris mudo»: si algo no se puede, se dice qué falta. La
 *  frase la escribe el servidor; esto sólo la saca de la excepción. */
function mensajeDeError(err: unknown): string {
  if (err instanceof ApiError) {
    return err.message || "No se pudo hacer. Vuelve a intentarlo.";
  }
  return "No se pudo hacer: sin conexión con el servidor.";
}

/** «3 sesiones» / «1 sesión». Lo único que este fichero redacta, y es
 *  gramática, no saldo. */
export function sesiones(n: number): string {
  return `${n} ${n === 1 ? "sesión" : "sesiones"}`;
}

/** «28-feb-2027» a partir de `YYYY-MM-DD`. La hora de una caducidad no se
 *  enseña nunca: el día entra entero. */
const MESES = [
  "ene", "feb", "mar", "abr", "may", "jun",
  "jul", "ago", "sep", "oct", "nov", "dic",
];

export function diaCorto(fecha: string | null): string | null {
  if (!fecha) return null;
  const [y, m, d] = fecha.split("-").map(Number);
  if (!y || !m || !d) return null;
  return `${d}-${MESES[m - 1]}-${y}`;
}
