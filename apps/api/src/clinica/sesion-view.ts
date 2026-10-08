// clinica-3 · LA serialización de la sesión, y el único sitio donde se
// decide si un importe sale por el cable.
//
// La regla 8 del prompt, comprobada EN LA API y no sólo escondida en
// pantalla: *las respuestas que llegan a un `CLINICIAN` no llevan precios
// ni totales.*
//
// ── Por qué quitar la CLAVE y no poner 0 ni null ─────────────────────
//
// Porque un 0 es un precio. Si la respuesta llevara `precio: 0`, cualquier
// pantalla —la de hoy o la que alguien escriba en dos bloques— podría
// pintar «0,00 €» y estaría pintando un importe falso delante de una
// paciente. Y un `null` invita al `?? 0`, que es la misma cosa con un paso
// de más.
//
// Con la clave FUERA no hay nada que pintar: `linea.precio` es `undefined`
// y el TypeScript del front lo dice. Es la misma forma que clinica-1 usó
// con la ficha técnica escondida (`technicalNotesHidden: true` en vez de un
// array vacío): **un dato que no está y un dato que vale cero no son lo
// mismo, y la respuesta tiene que poder decir cuál de los dos es.**
//
// ── Y por qué un fichero propio ──────────────────────────────────────
//
// Porque es el guardián, y un guardián repartido por tres handlers es tres
// sitios donde olvidarse. Aquí hay UNA función por forma y un test que
// recorre la respuesta entera buscando cualquier número que parezca
// dinero. El día que la vista gane un campo con importe, o pasa por aquí o
// el test lo caza.

import type {
  LineaDelResumen,
  ResumenDeLaSesion,
  ServicioDeSesion,
} from "@mipiacetpv/clinica-sesion";

import type { SesionCerradaView, VistaDeLaSesion } from "./sesion.js";

/** Un tratamiento tal como sale por el cable. Sin `precio` ni `iva` para
 *  quien no los ve: las claves no están. */
type TratamientoSerializado =
  | ServicioDeSesion
  | Pick<
      ServicioDeSesion,
      "serviceId" | "nombre" | "tipo" | "nivelQuiropodia"
    >;

function serializarTratamiento(
  t: ServicioDeSesion,
  verImportes: boolean,
): TratamientoSerializado {
  if (verImportes) return t;
  // clinica-5 · `tipo` y `nivelQuiropodia` SÍ salen siempre, y no es una
  // grieta en la regla 8: no son importes, son en qué tarjeta va el botón
  // y si es uno de los tres niveles. Sin ellos, la pantalla del sanitario
  // sin caja no sabría agrupar nada y pintaría los seis botones en una
  // lista plana — o sea, la regla de «no ve importes» le quitaría la
  // pantalla entera.
  //
  // La frontera sigue siendo la misma y se lee en el `Pick`: lo que no
  // está es `precio`, `iva` y `causaExencion`.
  return {
    serviceId: t.serviceId,
    nombre: t.nombre,
    tipo: t.tipo ?? null,
    nivelQuiropodia: t.nivelQuiropodia ?? null,
  };
}

type LineaSerializada =
  | LineaDelResumen
  | Pick<LineaDelResumen, "serviceId" | "nombre">;

function serializarLinea(
  l: LineaDelResumen,
  verImportes: boolean,
): LineaSerializada {
  if (verImportes) return l;
  return { serviceId: l.serviceId, nombre: l.nombre };
}

/**
 * El resumen del pie de la sesión y del ticket.
 *
 * `total` e `ivaTexto` desaparecen; lo que SÍ se queda es `tratamientos`
 * (cuántos son), `puedeCerrar`, `faltaDolor`, `faltaTratamiento` y
 * `textoDelBoton`. Nada de eso es un importe: son el estado del botón y lo
 * que dice, y el sanitario sin caja necesita las cinco cosas para poder
 * cerrar su sesión.
 */
export function serializarResumen(
  r: ResumenDeLaSesion,
  verImportes: boolean,
): Record<string, unknown> {
  const base = {
    tratamientos: r.tratamientos,
    lineas: r.lineas.map((l) => serializarLinea(l, verImportes)),
    faltaDolor: r.faltaDolor,
    faltaTratamiento: r.faltaTratamiento,
    puedeCerrar: r.puedeCerrar,
    textoDelBoton: r.textoDelBoton,
  };
  if (!verImportes) return base;
  return { ...base, total: r.total, ivaTexto: r.ivaTexto };
}

export function serializarSesionCerrada(
  c: SesionCerradaView,
  verImportes: boolean,
): Record<string, unknown> {
  return {
    entryId: c.entryId,
    cerradaEn: c.cerradaEn,
    firma: c.firma,
    // El cuerpo entero SÍ sale: es la historia, y el sanitario es quien la
    // escribió. Lo que NO lleva el cuerpo es ni un importe, y eso está
    // garantizado en origen (`CuerpoDeSesion` guarda el nombre del
    // tratamiento y nunca su precio — ver `normalizarSesion`), no aquí.
    cuerpo: c.cuerpo,
    marcas: c.marcas,
    resumen: serializarResumen(c.resumen, verImportes),
    yaCobrada: c.yaCobrada,
  };
}

export function serializarVista(
  v: VistaDeLaSesion,
  verImportes: boolean,
): Record<string, unknown> {
  return {
    cita: v.cita,
    cabecera: v.cabecera,
    puerta: v.puerta,
    tratamientos: v.tratamientos.map((t) =>
      serializarTratamiento(t, verImportes),
    ),
    // clinica-5 · ninguno de los tres es un importe, así que los tres
    // salen igual para los dos roles: qué tipos vienen marcados, qué
    // quedó pendiente de la última visita y de qué cirugía habla la
    // tarjeta de revisión.
    tiposSugeridos: v.tiposSugeridos,
    pendientes: v.pendientes,
    ultimaCirugia: v.ultimaCirugia,
    anterior: v.anterior,
    dolorHistorico: v.dolorHistorico,
    exploracion: v.exploracion,
    cerrada: v.cerrada
      ? serializarSesionCerrada(v.cerrada, verImportes)
      : null,
    listas: v.listas,
    // Y se dice, en vez de dejar que la pantalla lo deduzca de la ausencia
    // de `total`. Deducirlo de un hueco es cómo se escribe un `?? 0`.
    verImportes,
  };
}

// ── La lista de cobros pendientes de la recepción ─────────────────────
//
// La otra mitad de la regla 8, mirada del otro lado: la recepción ve la
// cita, el paciente y las líneas con precio, y **nada de la historia** —
// ni lesiones, ni dolor, ni evolución, ni consejos, ni la nota, ni las
// alertas (prompt §4).
//
// Vive aquí y no en `agenda/` porque es la MISMA decisión que las de
// arriba, al revés: lo que sale y lo que no. Que las dos caras se lean en
// el mismo fichero es lo que hace difícil que una de las dos se olvide.

export interface CobroPendiente {
  appointmentId: string;
  /** ISO-8601 de la cita. */
  empieza: string;
  paciente: { id: string; nombre: string };
  /** Los servicios de la cita, para que la recepción sepa qué venía a
   *  hacerse. Es lo mismo que la agenda ya enseña. */
  servicios: readonly string[];
  /** Lo que se le hizo, con su precio. Son LÍNEAS DE TICKET, no historia:
   *  el nombre de un tratamiento y su importe. */
  lineas: readonly { nombre: string; precio: number; iva: number }[];
  total: number;
  ivaTexto: string | null;
  /** Cuándo se firmó la sesión, para ordenar la lista y para que la
   *  recepción sepa si es de hace un rato o de ayer. */
  cerradaEn: string;
}

// Fíjate en lo que ese tipo NO tiene sitio para llevar: ni marcas, ni
// dolor, ni evolución, ni consejos, ni nota, ni alertas. No es que se
// filtren — es que no caben. `cobros-pendientes.ts` lo construye leyendo
// del cuerpo de la sesión SÓLO la lista de `tratamientos` (ids), y los
// nombres y precios los saca del catálogo.
//
// Es la misma forma que `valoracionesPendientesDe` de clinica-2, que
// devuelve una lista de ids de paciente y nada más: **lo que no cabe en el
// tipo no se puede filtrar mal.**
