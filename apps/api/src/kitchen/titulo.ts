// auditoria-sirope (#25) · CÓMO SE TITULA UNA COMANDA.
//
// La implementación se mudó a `@mipiacetpv/ticket-model` en hierro-sirope
// (E): la pantalla de cocina necesita la forma CORTA («Mostr. 1») y tiene
// que salir de la misma función que escribe la larga. Aquí queda el
// reexport para que `kitchen/envio.ts` —que no tiene nada que hacer con
// el grafo de imports de una ruta— lo siga importando de su vecino.
export {
  etiquetaCortaDeMostrador,
  etiquetaDeMostrador,
  tituloDeComanda,
  tituloDeComandaEnPantalla,
} from "@mipiacetpv/ticket-model";
