// B-reservas-8 · los estados de la puerta de canje y lo que se LEE de cada
// uno.
//
// Vive en un paquete compartido y no en la API por la razón del bloque:
// «ningún botón gris mudo». El TPV tiene que poder decir por qué no se
// puede canjear un bono sin inventarse la frase, y el servidor tiene que
// decir exactamente la misma — si cada lado escribe la suya, el día que
// cambie una el cliente leerá dos cosas distintas según dónde mire.
//
// La lista es CERRADA de verdad: `mensajeDeEstado` la cubre entera y el
// compilador se queja si aparece un estado nuevo sin mensaje.

/** La lista cerrada de `consultar()`. */
export type EstadoConsulta =
  | "ok"
  | "noexiste"
  | "otro_cliente"
  | "no_cubre"
  | "agotado"
  | "caducado"
  | "anulado";

/** Qué se le dice a quien está delante del mostrador. */
const MENSAJES: Record<EstadoConsulta, string> = {
  ok: "",
  noexiste: "No existe ningún bono con ese número en este negocio.",
  otro_cliente:
    "Ese bono es de otra ficha. Comprueba el número, o busca la ficha a la que pertenece.",
  no_cubre:
    "Ese bono no vale para este servicio. Mira en la ficha para qué sirve.",
  agotado: "Ese bono no tiene sesiones libres.",
  caducado:
    "Ese bono está caducado. El encargado puede prolongarlo desde la ficha, dejando el motivo.",
  anulado: "Ese bono se anuló al devolver su venta.",
};

export function mensajeDeEstado(estado: EstadoConsulta): string {
  return MENSAJES[estado];
}

/** `true` si lo que falla se arregla AQUÍ Y AHORA en el mostrador, sin que
 *  nadie tenga que mirar nada. Ordena la pantalla: estos salen primero y
 *  con la acción al lado. */
export function seArreglaEnElMomento(estado: EstadoConsulta): boolean {
  return estado === "otro_cliente" || estado === "no_cubre";
}

/** Los motivos por los que una sesión no se puede APARTAR. Es la lista de
 *  `consultar()` más uno: un solo bono por cita (S6). */
export type MotivoNoApartar = Exclude<EstadoConsulta, "ok"> | "ya_aplicado";

export function mensajeNoApartar(motivo: MotivoNoApartar): string {
  if (motivo === "ya_aplicado") {
    return "Esta cita ya tiene un bono aplicado. Una cita gasta un bono, no dos.";
  }
  return mensajeDeEstado(motivo);
}
