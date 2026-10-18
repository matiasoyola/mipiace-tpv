// B-reservas-8 · cómo sale un bono por la API, y para quién.
//
// ── El sanitario sin caja ve SESIONES, nunca EUROS ─────────────────────
//
// Regla del bloque y de clinica-1: **no se oculta en el front, NO SE
// MANDA.** Un `display: none` sobre un importe que ya viajó en el JSON es
// un importe que está en el DevTools de cualquier navegador, en la caché
// del service worker y en el log de la petición.
//
// Así que hay dos serializadores y uno de ellos **no construye** las claves
// de dinero. Lo que hace que esto se sostenga no es la disciplina: es que
// `BonoSinDinero` no TIENE esas propiedades, así que un campo nuevo de
// euros no se puede colar en la vista del sanitario sin que el compilador
// se queje. Y hay un test que vuelca el JSON y busca claves y VALORES de
// dinero (`bonos-sanitario.e2e.ts`), por si algún día alguien añade un
// `Record<string, unknown>` por el medio.
//
// ── Y la otra mitad: lo de PRUEBA sale aparte ──────────────────────────
//
// `07` pieza 17 · lo de prueba se marca, no se borra. Sale de la ficha y de
// los informes de gestión detrás de un filtro, nunca mezclado.

import { frasePorSesiones } from "@mipiacetpv/bonos";

import { diaDeCaducidad } from "./caducidad.js";

/** La fila del bono tal y como la leen las rutas de este módulo. */
export interface FilaDeBono {
  id: string;
  code: string;
  clientId: string;
  nameSnapshot: string;
  sessionsTotal: number;
  sessionsLeft: number;
  sessionsReserved: number;
  valorCartaCents: number;
  cobradoCents: number;
  expiresAt: Date | null;
  status: string;
  origen: string;
  esPrueba: boolean;
  soldTicketId: string | null;
  createdAt: Date;
}

/** Lo que ve TODO EL MUNDO: sesiones, fechas y estado. Ni un euro. */
export interface BonoSinDinero {
  id: string;
  code: string;
  nombre: string;
  sesionesTotal: number;
  sesionesLibres: number;
  sesionesApartadas: number;
  sesionesConsumidas: number;
  /** «quedan 3 · 1 apartada» — la frase, hecha en el servidor para que las
   *  tres pantallas la digan igual. */
  resumen: string;
  /** El ÚLTIMO DÍA BUENO en hora del centro (`YYYY-MM-DD`), no el instante
   *  exclusivo que guarda la columna: «caduca el 28-feb» incluye el 28
   *  entero. `null` = sin caducidad. */
  caducaEl: string | null;
  status: string;
  origen: string;
  esPrueba: boolean;
  creadoEl: string;
}

/** Y lo que ve quien tiene caja: lo mismo MÁS el dinero. */
export interface BonoConDinero extends BonoSinDinero {
  /** Lo que el centro DEBE (valor de carta), en céntimos. */
  valorCartaCents: number;
  /** Lo que ENTRÓ, en céntimos. Es un espejo del ticket, no una segunda
   *  contabilidad. */
  cobradoCents: number;
  /** El ticket de la venta, para poder abrirlo. `null` en un alta inicial. */
  soldTicketId: string | null;
}

export function bonoSinDinero(f: FilaDeBono): BonoSinDinero {
  const consumidas = f.sessionsTotal - f.sessionsLeft - f.sessionsReserved;
  return {
    id: f.id,
    code: f.code,
    nombre: f.nameSnapshot,
    sesionesTotal: f.sessionsTotal,
    sesionesLibres: f.sessionsLeft,
    sesionesApartadas: f.sessionsReserved,
    sesionesConsumidas: consumidas,
    resumen: frasePorSesiones(f.sessionsLeft, f.sessionsReserved),
    caducaEl: diaDeCaducidad(f.expiresAt),
    status: f.status,
    origen: f.origen,
    esPrueba: f.esPrueba,
    creadoEl: f.createdAt.toISOString(),
  };
}

export function bonoConDinero(f: FilaDeBono): BonoConDinero {
  return {
    ...bonoSinDinero(f),
    valorCartaCents: f.valorCartaCents,
    cobradoCents: f.cobradoCents,
    soldTicketId: f.soldTicketId,
  };
}

/** Una línea del libro, legible. **Sin dinero tampoco**: el libro de un bono
 *  habla de sesiones, y el cobro vive en el ticket que enlaza. */
export interface LineaLegible {
  id: string;
  tipo: string;
  sesiones: number;
  /** La frase que lee recepción. */
  detalle: string;
  motivo: string | null;
  canal: string;
  /** Quién: el nombre de la persona del centro, o «Web» / «Migración». */
  quien: string;
  appointmentId: string | null;
  ticketLineId: string | null;
  compensaA: string | null;
  esPrueba: boolean;
  cuando: string;
}
