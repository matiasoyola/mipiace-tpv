// residencia-6 · **DESDE DÓNDE SE ESTABA LEYENDO.**
//
// Una sola cosa: cuando un valor cifrado no se descifra, la línea del log
// tiene que decir **desde qué ruta se intentó leer**. Sin eso, la línea
// dice que `clinical_entries.body` de la fila X no se lee, y quien la mira
// no sabe si eso lo vio una podóloga en la historia, el informe en PDF, la
// exportación del art. 20 o la pasada del relevo a las tres de la mañana —
// que es justo lo que decide si hay alguien delante de una pantalla con un
// hueco o si es un trabajo de fondo.
//
// ── POR QUÉ UN `AsyncLocalStorage` Y NO UN PARÁMETRO MÁS ────────────
//
// `configurarAvisoDeIlegible` es un gancho de MÓDULO: `cripto-campos.ts`
// avisa desde dentro de `leerTexto`, y `leerTexto` lo llaman unas setenta
// líneas repartidas por la historia, el informe, la exportación, el libro
// de incidencias y el relevo. Pasarle la petición a cada una habría sido
// tocar esas setenta líneas y, lo que es peor, dejar abierta la siguiente:
// la número setenta y uno se escribe sin el parámetro y la línea del log
// se queda sin sitio sin que nadie lo note.
//
// El `AsyncLocalStorage` es de `node:async_hooks` —no entra una
// dependencia— y se pone **una sola vez**, en un `onRequest` de la raíz.
// Fastify propaga el contexto a todo lo que cuelga de `done()`, que es
// toda la petición.
//
// ── Y FUERA DE UNA PETICIÓN NO SE INVENTA NADA ──────────────────────
//
// Los workers de BullMQ y los scripts (`clinica:cifrar`, el barrido de
// huérfanos) leen valores cifrados sin petición de nadie. Ahí el sitio es
// la constante `FUERA_DE_PETICION`, y es información: una línea con ese
// sitio dice que el hueco lo encontró una pasada y no una persona.

import { AsyncLocalStorage } from "node:async_hooks";
import type { FastifyInstance } from "fastify";

/** Lo que se apunta cuando no hay petición: un worker, un script, un
 *  test. No es «desconocido» — es un sitio concreto y dice bastante. */
export const FUERA_DE_PETICION = "fuera-de-peticion";

const almacen = new AsyncLocalStorage<string>();

/** Desde dónde se está leyendo, ahora mismo. */
export function sitioDeLectura(): string {
  return almacen.getStore() ?? FUERA_DE_PETICION;
}

/** Marca un tramo de código como «esto pasa aquí». Lo usa el hook de
 *  Fastify, y lo puede usar un worker que quiera nombrarse. */
export function enSitioDeLectura<T>(sitio: string, fn: () => T): T {
  return almacen.run(sitio, fn);
}

/**
 * El hook. Se registra en la raíz y **antes de las rutas**: así cubre
 * todo lo que se registre después, incluidos los plugins encapsulados.
 *
 * El sitio es `MÉTODO /la/ruta/:con/sus/comodines` — **el patrón de la
 * ruta, no la URL**. La URL lleva los ids dentro (`/clients/<uuid>`) y
 * eso es un dato de alguien en una línea de log; el patrón no lleva
 * ninguno y es lo que identifica la pantalla. Cuando Fastify no tiene
 * ruta (un 404), se cae a `request.method` solo.
 */
export function registrarSitioDeLectura(app: FastifyInstance): void {
  app.addHook("onRequest", (request, _reply, done) => {
    const patron = request.routeOptions?.url;
    enSitioDeLectura(
      patron ? `${request.method} ${patron}` : request.method,
      done,
    );
  });
}
